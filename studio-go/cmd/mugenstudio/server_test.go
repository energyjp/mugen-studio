package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

// The restart that makes a bundle switch work without closing the Studio
// (server.go), run against a stand-in for studio-server.exe: this test binary
// itself, started again with STUDIO_TEST_STANDIN set.

func TestMain(m *testing.M) {
	if mode := os.Getenv("STUDIO_TEST_STANDIN"); mode != "" {
		standIn(mode)
		return
	}
	os.Exit(m.Run())
}

// standIn serves its own pid on the port it is given and leaves the way the
// real server does, when its stdin closes. "deaf" never leaves (the kill
// after the grace period); "crash" exits before it ever listens; "dies"
// stops by itself, with code 7, when /die is asked for. It writes a line to
// each of stdout and stderr, as the real server does, for the log.
func standIn(mode string) {
	fmt.Println("stand-in starting")
	fmt.Fprintln(os.Stderr, "stand-in stderr line")
	if mode == "crash" {
		fmt.Fprintln(os.Stderr, "Stopped: Error: stand-in could not start")
		os.Exit(4)
	}
	l, err := net.Listen("tcp", "127.0.0.1:"+os.Args[len(os.Args)-1])
	if err != nil {
		os.Exit(3)
	}
	go http.Serve(l, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if mode == "dies" && r.URL.Path == "/die" {
			fmt.Fprintln(os.Stderr, "Stopped: Error: stand-in went away")
			for i := 0; i < 5; i++ {
				fmt.Fprintf(os.Stderr, "    at frame%d (stand-in.js:%d)\n", i, i)
			}
			os.Exit(7)
		}
		fmt.Fprint(w, os.Getpid())
	}))
	if mode == "deaf" {
		select {}
	}
	_, _ = io.Copy(io.Discard, os.Stdin)
	l.Close()
	os.Exit(0)
}

func standInServer(t *testing.T, mode string) *studioServer {
	t.Helper()
	port, err := freePort()
	if err != nil {
		t.Fatal(err)
	}
	s := &studioServer{port: port, spawn: func(port int) *exec.Cmd {
		cmd := exec.Command(os.Args[0], "-test.run=^$", strconv.Itoa(port))
		cmd.Env = append(os.Environ(), "STUDIO_TEST_STANDIN="+mode)
		return cmd
	}}
	t.Cleanup(s.kill)
	return s
}

func pidAt(t *testing.T, port int) int {
	t.Helper()
	r, err := http.Get(fmt.Sprintf("http://127.0.0.1:%d/", port))
	if err != nil {
		t.Fatal(err)
	}
	defer r.Body.Close()
	b, _ := io.ReadAll(r.Body)
	pid, err := strconv.Atoi(strings.TrimSpace(string(b)))
	if err != nil {
		t.Fatalf("not a pid: %q", b)
	}
	return pid
}

func TestServerRestartKeepsThePort(t *testing.T) {
	s := standInServer(t, "polite")
	url := fmt.Sprintf("http://127.0.0.1:%d/", s.port)
	if err := s.start(); err != nil {
		t.Fatal(err)
	}
	if !s.ready(url, 10*time.Second) {
		t.Fatal("the first server never answered")
	}
	first := pidAt(t, s.port)
	s.mu.Lock()
	oldExit := s.exited
	s.mu.Unlock()

	t0 := time.Now()
	if err := s.restart(url); err != nil {
		t.Fatal(err)
	}
	took := time.Since(t0)
	second := pidAt(t, s.port)
	if second == first {
		t.Fatalf("the same process (%d) answers after a restart", first)
	}
	select {
	case <-oldExit:
	default:
		t.Fatal("the old server is still running")
	}
	// The polite server leaves when asked; the grace period is for one that
	// does not, and must not be spent here.
	if took > 5*time.Second {
		t.Fatalf("a restart took %v", took)
	}
	t.Logf("restart on port %d: pid %d -> %d in %v", s.port, first, second, took.Round(time.Millisecond))
}

func TestServerStopKillsAServerThatStays(t *testing.T) {
	s := standInServer(t, "deaf")
	if err := s.start(); err != nil {
		t.Fatal(err)
	}
	if !s.ready(fmt.Sprintf("http://127.0.0.1:%d/", s.port), 10*time.Second) {
		t.Fatal("never answered")
	}
	s.mu.Lock()
	exited := s.exited
	s.mu.Unlock()
	t0 := time.Now()
	s.stop(300 * time.Millisecond)
	select {
	case <-exited:
	default:
		t.Fatal("stop returned with the server still running")
	}
	if d := time.Since(t0); d > 3*time.Second {
		t.Fatalf("stop took %v with a 300ms grace", d)
	}
}

func TestServerReadyGivesUpWhenTheServerIsGone(t *testing.T) {
	s := standInServer(t, "crash")
	if err := s.start(); err != nil {
		t.Fatal(err)
	}
	t0 := time.Now()
	if s.ready(fmt.Sprintf("http://127.0.0.1:%d/", s.port), 20*time.Second) {
		t.Fatal("ready with no server")
	}
	if d := time.Since(t0); d > 5*time.Second {
		t.Fatalf("waited %v on a server that had already exited", d)
	}
}

// THE WATCHER (watch, report): a server that stops by itself after it had
// answered is reported once, with how it ended - the window turns that into
// the box that offers Restart.

func watchInto(s *studioServer) chan error {
	got := make(chan error, 4)
	s.watch(func(err error) { got <- err })
	return got
}

func startAndWait(t *testing.T, s *studioServer) string {
	t.Helper()
	url := fmt.Sprintf("http://127.0.0.1:%d/", s.port)
	if err := s.start(); err != nil {
		t.Fatal(err)
	}
	if !s.ready(url, 10*time.Second) {
		t.Fatal("the stand-in never answered")
	}
	return url
}

// dieAndWait asks a "dies" stand-in to go and waits until it has.
func dieAndWait(t *testing.T, s *studioServer, url string) {
	t.Helper()
	s.mu.Lock()
	exited := s.exited
	s.mu.Unlock()
	if r, err := http.Get(url + "die"); err == nil {
		r.Body.Close()
	}
	select {
	case <-exited:
	case <-time.After(10 * time.Second):
		t.Fatal("the stand-in did not stop")
	}
}

func quiet(t *testing.T, got chan error, d time.Duration, what string) {
	t.Helper()
	select {
	case err := <-got:
		t.Fatalf("%s (reported: %v)", what, err)
	case <-time.After(d):
	}
}

func TestServerExitIsReported(t *testing.T) {
	s := standInServer(t, "dies")
	got := watchInto(s)
	url := startAndWait(t, s)
	quiet(t, got, 300*time.Millisecond, "reported while it was still running")
	dieAndWait(t, s, url)
	select {
	case err := <-got:
		if w := exitWords(err); w != "It exited with code 7." {
			t.Fatalf("said %q", w)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("a server that stopped by itself was not reported")
	}
	quiet(t, got, 300*time.Millisecond, "reported twice")
}

// NEGATIVE CONTROLS: an end this program asked for - a restart (a bundle
// switch), a kill (the window closing) - is not news, and neither is a server
// that never came up: whoever started it is waiting in ready() and says why.
func TestServerAskedExitsAreNotReported(t *testing.T) {
	s := standInServer(t, "polite")
	got := watchInto(s)
	url := startAndWait(t, s)
	if err := s.restart(url); err != nil {
		t.Fatal(err)
	}
	s.mu.Lock()
	exited := s.exited
	s.mu.Unlock()
	s.kill()
	<-exited
	quiet(t, got, 500*time.Millisecond, "a restart or a kill was reported as a crash")
}

func TestServerThatNeverAnsweredIsNotReported(t *testing.T) {
	s := standInServer(t, "crash")
	got := watchInto(s)
	if err := s.start(); err != nil {
		t.Fatal(err)
	}
	if s.ready(fmt.Sprintf("http://127.0.0.1:%d/", s.port), 5*time.Second) {
		t.Fatal("ready with no server")
	}
	quiet(t, got, 300*time.Millisecond, "a server that never started was reported")
}

// The window is made after the server answers, so the server can go before
// anyone watches; watch reports that at once.
func TestServerWatchReportsAnEarlierExit(t *testing.T) {
	s := standInServer(t, "dies")
	url := startAndWait(t, s)
	dieAndWait(t, s, url)
	got := watchInto(s)
	select {
	case <-got:
	case <-time.After(5 * time.Second):
		t.Fatal("an exit before watch was never reported")
	}
}

// The server's output lands in the log, each run under its own header; an
// oversized log is moved aside when a run starts; the tail a message box
// quotes is this run's lines only, each trace cut to two frames.
func TestServerOutputGoesToTheLog(t *testing.T) {
	logPath := filepath.Join(t.TempDir(), "logs", "studio-server.log")
	oldPath := filepath.Join(filepath.Dir(logPath), "studio-server.old.log")
	if err := os.MkdirAll(filepath.Dir(logPath), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(logPath, bytes.Repeat([]byte("x"), serverLogLimit+1), 0o644); err != nil {
		t.Fatal(err)
	}

	first := standInServer(t, "crash")
	first.logPath = logPath
	if err := first.start(); err != nil {
		t.Fatal(err)
	}
	first.mu.Lock()
	gone := first.exited
	first.mu.Unlock()
	<-gone
	if st, err := os.Stat(oldPath); err != nil || st.Size() <= serverLogLimit {
		t.Fatalf("the oversized log was not moved aside: %v", err)
	}

	s := standInServer(t, "dies")
	s.logPath = logPath
	dieAndWait(t, s, startAndWait(t, s))

	b, err := os.ReadFile(logPath)
	if err != nil {
		t.Fatal(err)
	}
	text := string(b)
	for _, want := range []string{
		"studio-server on port " + strconv.Itoa(first.port), "Stopped: Error: stand-in could not start",
		"studio-server on port " + strconv.Itoa(s.port), "stand-in starting", "stand-in stderr line",
		"Stopped: Error: stand-in went away", "at frame4",
	} {
		if !strings.Contains(text, want) {
			t.Fatalf("the log has no %q:\n%s", want, text)
		}
	}
	want := "stand-in starting\nstand-in stderr line\nStopped: Error: stand-in went away\n" +
		"    at frame0 (stand-in.js:0)\n    at frame1 (stand-in.js:1)"
	if tail := serverLogTail(logPath, 8); tail != want {
		t.Fatalf("tail:\n%s\nwant:\n%s", tail, want)
	}
	if tail := serverLogTail(logPath, 2); tail != "    at frame0 (stand-in.js:0)\n    at frame1 (stand-in.js:1)" {
		t.Fatalf("tail of 2:\n%s", tail)
	}
	if serverLogTail(filepath.Join(t.TempDir(), "none.log"), 8) != "" {
		t.Fatal("a missing log has a tail")
	}
}

func TestCrashMessage(t *testing.T) {
	m := crashMessage(exitWords(nil), "Stopped: boom", `C:\x\logs\studio-server.log`)
	for _, want := range []string{"It exited with code 0.", "The last thing it said:\nStopped: boom",
		`C:\x\logs\studio-server.log`, "Restart starts it again", "Close ends Mugen Studio"} {
		if !strings.Contains(m, want) {
			t.Fatalf("no %q in:\n%s", want, m)
		}
	}
	if !strings.HasSuffix(m, "Restart it now?") {
		t.Fatalf("does not end with the question:\n%s", m)
	}
	if m := crashMessage("It stopped.", "", ""); strings.Contains(m, "last thing") || strings.Contains(m, "Everything it said") {
		t.Fatalf("an empty tail or path still shows:\n%s", m)
	}
	if p := serverLogPath(`C:\Studio\MugenStudio.exe`, `C:\Studio`); p != `C:\Studio\logs\studio-server.log` {
		t.Fatalf("log path %s", p)
	}
}

// A portable copy's log goes in the Settings folder its program layout names
// (app\program-layout.json "settings", the key layout.js reads), so an update
// that replaces app\ and the exe keeps it; with no such file or key it stays
// beside the exe, as in the checkout.
func TestServerLogPathSettings(t *testing.T) {
	top := t.TempDir()
	exe := filepath.Join(top, "MugenStudio.exe")
	app := filepath.Join(top, "app")
	if err := os.MkdirAll(app, 0o755); err != nil {
		t.Fatal(err)
	}
	beside := filepath.Join(top, "logs", "studio-server.log")
	if p := serverLogPath(exe, app); p != beside {
		t.Fatalf("no program-layout.json: %s, want %s", p, beside)
	}
	write := func(s string) {
		if err := os.WriteFile(filepath.Join(app, "program-layout.json"), []byte(s), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	// Negative controls: a layout with no "settings", and one that does not
	// parse, keep the log beside the exe.
	write(`{"contentRoot": "../Content"}`)
	if p := serverLogPath(exe, app); p != beside {
		t.Fatalf("no settings key: %s", p)
	}
	write(`{"settings": `)
	if p := serverLogPath(exe, app); p != beside {
		t.Fatalf("unparsable layout: %s", p)
	}
	// What make-portable writes (with a BOM, as a hand edit in Notepad may
	// leave one).
	write("\xef\xbb\xbf" + `{"contentRoot": "../Content", "settings": "../Settings"}`)
	want := filepath.Join(top, "Settings", "logs", "studio-server.log")
	if p := serverLogPath(exe, app); p != want {
		t.Fatalf("settings ../Settings: %s, want %s", p, want)
	}
	abs := filepath.Join(t.TempDir(), "Elsewhere")
	b, _ := json.Marshal(map[string]string{"settings": abs})
	write(string(b))
	if p := serverLogPath(exe, app); p != filepath.Join(abs, "logs", "studio-server.log") {
		t.Fatalf("absolute settings: %s", p)
	}
	// And the log really opens there, making the folders.
	write(`{"settings": "../Settings"}`)
	f := openServerLog(serverLogPath(exe, app), 8934)
	if f == nil {
		t.Fatal("the log did not open in Settings\\logs")
	}
	f.Close()
	if _, err := os.Stat(want); err != nil {
		t.Fatalf("no log at %s: %v", want, err)
	}
}
