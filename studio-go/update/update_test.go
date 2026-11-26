package update

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"
)

// Fake copies in temp folders; the "server" is this test binary started
// again as a stand-in (STUDIO_UPD_STANDIN), on 127.0.0.1:9630-9639 only.

func TestMain(m *testing.M) {
	if mode := os.Getenv("STUDIO_UPD_STANDIN"); mode != "" {
		standIn(mode)
		return
	}
	os.Exit(m.Run())
}

func standIn(mode string) {
	switch {
	case mode == "crash":
		fmt.Fprintln(os.Stderr, "Stopped: Error: stand-in could not start")
		os.Exit(4)
	case mode == "sleep":
		time.Sleep(60 * time.Second)
		os.Exit(0)
	case strings.HasPrefix(mode, "server:"):
		l, err := net.Listen("tcp", "127.0.0.1:"+os.Args[len(os.Args)-1])
		if err != nil {
			os.Exit(3)
		}
		v := strings.TrimPrefix(mode, "server:")
		go http.Serve(l, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path == "/api/update" {
				fmt.Fprintf(w, `{"version":%q}`, v)
				return
			}
			http.NotFound(w, r)
		}))
		_, _ = io.Copy(io.Discard, os.Stdin)
		l.Close()
		os.Exit(0)
	case mode == "listen-then-sleep":
		// A launcher whose "server" holds a port: proves the job ends both.
		l, err := net.Listen("tcp", "127.0.0.1:"+os.Args[len(os.Args)-1])
		if err != nil {
			os.Exit(3)
		}
		defer l.Close()
		cmd := exec.Command(os.Args[0], "-test.run=^$")
		cmd.Env = append(os.Environ(), "STUDIO_UPD_STANDIN=sleep")
		_ = cmd.Start()
		time.Sleep(60 * time.Second)
	}
	os.Exit(9)
}

var portMu sync.Mutex
var nextPort = 9630

// testPort hands out 9630-9639 in turn, each one checked free.
func testPort() (int, error) {
	portMu.Lock()
	defer portMu.Unlock()
	for i := 0; i < 10; i++ {
		p := nextPort
		nextPort++
		if nextPort > 9639 {
			nextPort = 9630
		}
		if l, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", p)); err == nil {
			l.Close()
			return p, nil
		}
	}
	return 0, errors.New("no free port in 9630-9639")
}

// ---- fake copies ----------------------------------------------------------------

func write(t *testing.T, p, s string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(p, []byte(s), 0o644); err != nil {
		t.Fatal(err)
	}
}

// programFiles writes app/program-files.json for what is in app/ now,
// leaving out webview-data (the user's, as make-portable does).
func programFiles(t *testing.T, app string) {
	t.Helper()
	type it struct {
		Path string `json:"path"`
		Size int64  `json:"size"`
	}
	var list []it
	filepath.Walk(app, func(p string, fi os.FileInfo, err error) error {
		if err != nil || fi.IsDir() {
			return nil
		}
		rel := filepath.ToSlash(strings.TrimPrefix(p, app+string(filepath.Separator)))
		if strings.HasPrefix(rel, "webview-data/") || rel == "program-files.json" {
			return nil
		}
		list = append(list, it{rel, fi.Size()})
		return nil
	})
	b, _ := json.Marshal(list)
	write(t, filepath.Join(app, "program-files.json"), string(b))
}

func program(t *testing.T, dir, version, tag string) {
	t.Helper()
	write(t, filepath.Join(dir, "MugenStudio.exe"), "launcher "+tag)
	write(t, filepath.Join(dir, "READ ME.txt"), "read me "+tag)
	write(t, filepath.Join(dir, "LICENSE.txt"), "license")
	app := filepath.Join(dir, "app")
	write(t, filepath.Join(app, ServerExe), "server "+tag)
	write(t, filepath.Join(app, "server.js"), "// server.js "+tag)
	write(t, filepath.Join(app, "layout.js"), "// layout.js "+tag)
	write(t, filepath.Join(app, "program-layout.json"), `{"settings":"../Settings","contentRoot":"../Content"}`)
	write(t, filepath.Join(app, "studio-version.json"), `{"version":"`+version+`"}`)
	write(t, filepath.Join(app, "public", "studio.html"), "<html>"+tag)
	write(t, filepath.Join(app, "Dependencies", "Ikemen_GO-v1-windows.zip"), "engine "+tag)
	if tag == "new" {
		write(t, filepath.Join(app, "public", "only-new.js"), "new file")
		write(t, filepath.Join(dir, "THIRD-PARTY-NOTICES.txt"), "notices new")
	} else {
		write(t, filepath.Join(app, "public", "only-old.js"), "old file")
	}
	programFiles(t, app)
}

// newCopy: a used copy at 2.5.90 with the person's things in and around it.
func newCopy(t *testing.T) string {
	t.Helper()
	root := filepath.Join(t.TempDir(), "Mugen Studio")
	program(t, root, "2.5.90", "old")
	write(t, filepath.Join(root, "app", "webview-data", "EBWebView", "Default", "Local Storage", "leveldb", "000003.log"), "look=booklet")
	write(t, filepath.Join(root, "app", "Dependencies", "Ikemen_GO-user-windows.zip"), "the person's own engine zip")
	write(t, filepath.Join(root, "Settings", "local-config.json"), `{"token":"secret"}`)
	write(t, filepath.Join(root, "Settings", "studio-settings.json"), `{"bundle":"h-build"}`)
	write(t, filepath.Join(root, "Content", "default", "roster.json"), `{"chars":[{"folder":"kfm"}]}`)
	write(t, filepath.Join(root, "Content", "h-build", "roster.json"), `{"chars":[]}`)
	write(t, filepath.Join(root, "Desktop Export", "save", "config.ini"), "[Video]")
	if err := os.MkdirAll(filepath.Join(root, "Website Export"), 0o755); err != nil {
		t.Fatal(err)
	}
	return root
}

func stage(t *testing.T, root, version string) {
	t.Helper()
	st := filepath.Join(root, dirName, "staged")
	program(t, st, version, "new")
	if err := os.MkdirAll(filepath.Join(st, "Desktop Export"), 0o755); err != nil {
		t.Fatal(err)
	}
	write(t, filepath.Join(root, dirName, "staged.json"), `{"version":"`+version+`","sha256":"abc"}`)
}

// tree: every file under root (but .update) and its sha256; folders as "dir".
func tree(t *testing.T, root string) map[string]string {
	t.Helper()
	out := map[string]string{}
	filepath.Walk(root, func(p string, fi os.FileInfo, err error) error {
		if err != nil {
			return nil
		}
		rel := filepath.ToSlash(strings.TrimPrefix(p, root))
		if strings.HasPrefix(rel, "/"+dirName) {
			if fi.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if fi.IsDir() {
			out[rel] = "dir"
			return nil
		}
		b, _ := os.ReadFile(p)
		s := sha256.Sum256(b)
		out[rel] = hex.EncodeToString(s[:])
		return nil
	})
	return out
}

func sameTree(t *testing.T, want, got map[string]string, what string) {
	t.Helper()
	var diff []string
	for k, v := range want {
		if got[k] != v {
			diff = append(diff, "changed or gone: "+k)
		}
	}
	for k := range got {
		if _, ok := want[k]; !ok {
			diff = append(diff, "new: "+k)
		}
	}
	sort.Strings(diff)
	if len(diff) > 0 {
		t.Fatalf("%s: the copy is not as it was:\n  %s", what, strings.Join(diff, "\n  "))
	}
}

func userTree(t *testing.T, root string) map[string]string {
	t.Helper()
	all := tree(t, root)
	out := map[string]string{}
	for k, v := range all {
		if strings.HasPrefix(k, "/Settings") || strings.HasPrefix(k, "/Content") || strings.HasPrefix(k, "/Desktop Export") || strings.HasPrefix(k, "/Website Export") {
			out[k] = v
		}
	}
	return out
}

func readResult(t *testing.T, root string) Result {
	t.Helper()
	var r Result
	if err := readJSON(filepath.Join(root, dirName, "result.json"), &r); err != nil {
		t.Fatalf("no result.json: %v", err)
	}
	return r
}

// ---- fake children ---------------------------------------------------------------

type fakeChild struct {
	exited          chan struct{}
	killed, release bool
	mu              sync.Mutex
}

func (c *fakeChild) Exited() <-chan struct{} { return c.exited }
func (c *fakeChild) Kill() {
	c.mu.Lock()
	c.killed = true
	c.mu.Unlock()
	select {
	case <-c.exited:
	default:
		close(c.exited)
	}
}
func (c *fakeChild) Release() { c.mu.Lock(); c.release = true; c.mu.Unlock() }

// spawnDoing: a "new launcher" that runs fn(root) in the background, the way
// MugenStudio.exe --after-update would: Recover(afterUpdate), then its word.
func spawnDoing(t *testing.T, got **fakeChild, fn func(root string, c *fakeChild)) func(string) (Child, error) {
	return func(root string) (Child, error) {
		c := &fakeChild{exited: make(chan struct{})}
		*got = c
		go func() {
			if r, err := Recover(root, true, Options{}); err != nil || r != Confirming {
				t.Errorf("the new launcher's Recover: %v %v", r, err)
			}
			fn(root, c)
		}()
		return c, nil
	}
}

func okHealth(app, want string) error {
	if versionIn(app) != want {
		return fmt.Errorf("app says %s, want %s", versionIn(app), want)
	}
	return nil
}

func opts() Options {
	return Options{Retry: 2 * time.Second, Wait: 5 * time.Second, Health: okHealth, Log: func(string, ...any) {}}
}

// ---- tests ------------------------------------------------------------------------

func TestVersions(t *testing.T) {
	for _, c := range []struct {
		a, b string
		want int
		ok   bool
	}{
		{"v2.5.1", "2.5.1", 0, true}, {"2.5", "2.5.0", 0, true}, {"2.5.1", "2.5.10", -1, true},
		{"2.10", "2.9.9", 1, true}, {"v3", "2.99", 1, true}, {"2.5.1-beta", "2.5.1", 0, false},
		{"", "1", 0, false}, {"1.2.3.4.5", "1", 0, false}, {"1..2", "1", 0, false},
	} {
		got, ok := Compare(c.a, c.b)
		if ok != c.ok || (ok && got != c.want) {
			t.Errorf("Compare(%q,%q) = %d %v, want %d %v", c.a, c.b, got, ok, c.want, c.ok)
		}
	}
}

func TestApplyThenConfirmThenNextStart(t *testing.T) {
	root := newCopy(t)
	before := userTree(t, root)
	stage(t, root, "2.5.91")
	var child *fakeChild
	o := opts()
	o.Spawn = spawnDoing(t, &child, func(root string, c *fakeChild) {
		if err := Confirm(root); err != nil {
			t.Error(err)
		}
	})
	out, err := Run(root, o)
	if out != Applied || err != nil {
		t.Fatalf("Run = %v %v", out, err)
	}
	if !child.release || child.killed {
		t.Fatalf("the confirmed child should be released, not killed (%v %v)", child.release, child.killed)
	}
	if v := versionIn(filepath.Join(root, "app")); v != "2.5.91" {
		t.Fatalf("app/ is %s", v)
	}
	if b, _ := os.ReadFile(filepath.Join(root, "MugenStudio.exe")); string(b) != "launcher new" {
		t.Fatalf("MugenStudio.exe is %q", b)
	}
	if !exists(filepath.Join(root, "THIRD-PARTY-NOTICES.txt")) {
		t.Fatal("the new top file is missing")
	}
	sameTree(t, before, userTree(t, root), "Settings, Content and the Export folders")
	// carried: the window's preferences and the person's engine zip; not
	// the old program's own engine zip, nor its files the new one dropped
	for _, f := range []string{"webview-data/EBWebView/Default/Local Storage/leveldb/000003.log", "Dependencies/Ikemen_GO-user-windows.zip"} {
		if !exists(filepath.Join(root, "app", filepath.FromSlash(f))) {
			t.Errorf("not carried: app/%s", f)
		}
	}
	if b, _ := os.ReadFile(filepath.Join(root, "app", "Dependencies", "Ikemen_GO-v1-windows.zip")); string(b) != "engine new" {
		t.Errorf("the shipped engine zip is %q", b)
	}
	if exists(filepath.Join(root, "app", "public", "only-old.js")) {
		t.Error("a file only the old program had was carried")
	}
	if !exists(filepath.Join(root, dirName, "backup", "app", "server.js")) {
		t.Fatal("the backup should stay until the next start")
	}
	if r := readResult(t, root); r.Result != "applied" || r.From != "2.5.90" || r.To != "2.5.91" {
		t.Fatalf("result %+v", r)
	}
	if exists(filepath.Join(root, dirName, "staged")) || exists(filepath.Join(root, dirName, "staged.json")) {
		t.Fatal("the staging should be gone once it is swapped in")
	}
	if Pending(root) {
		t.Fatal("a confirmed journal is not pending")
	}
	// The next start: the backup goes.
	rec, err := Recover(root, false, Options{})
	if rec != Finished || err != nil {
		t.Fatalf("Recover = %v %v", rec, err)
	}
	if exists(filepath.Join(root, dirName, "backup")) || exists(filepath.Join(root, dirName, "journal.json")) {
		t.Fatal("backup or journal left after the next start")
	}
	if rec, _ := Recover(root, false, Options{}); rec != Clean {
		t.Fatalf("a third start found %v", rec)
	}
}

func TestCrashAfterEachStepRecoversToTheOldCopy(t *testing.T) {
	for _, step := range []string{"A", "B", "C", "D", "E", "F", "G"} {
		t.Run(step, func(t *testing.T) {
			root := newCopy(t)
			before := tree(t, root)
			stage(t, root, "2.5.91")
			o := opts()
			o.CrashAfter = step
			if out, err := Run(root, o); out != Crashed || !errors.Is(err, ErrCrash) {
				t.Fatalf("Run = %v %v", out, err)
			}
			rec, err := Recover(root, false, Options{Retry: time.Second})
			if err != nil || rec != Finished {
				t.Fatalf("Recover = %v %v", rec, err)
			}
			sameTree(t, before, tree(t, root), "after a crash at "+step)
			if exists(filepath.Join(root, dirName, "journal.json")) || exists(filepath.Join(root, dirName, "backup")) {
				t.Fatal("journal or backup left")
			}
			if step == "A" {
				if Staged(root) != "2.5.91" {
					t.Fatal("a crash before anything moved should keep the staging")
				}
				return
			}
			if r := readResult(t, root); r.Result != "interrupted" || r.From != "2.5.90" || r.To != "2.5.91" {
				t.Fatalf("result %+v", r)
			}
			if exists(filepath.Join(root, dirName, "staged")) {
				t.Fatal("the staging should be gone after a rollback")
			}
		})
	}
}

// Rollback is itself interruptible: the first half of one done by hand (the
// carried files back, the new app/ aside, the old one back), then Recover
// finishes it from what is on disk.
func TestRollbackFinishesAHalfRollback(t *testing.T) {
	root := newCopy(t)
	before := tree(t, root)
	stage(t, root, "2.5.91")
	o := opts()
	o.CrashAfter = "E"
	Run(root, o)
	p := at(root)
	j := readJournal(p)
	if len(j.Carried) == 0 {
		t.Fatal("nothing was carried")
	}
	for _, c := range j.Carried {
		if err := os.Rename(filepath.Join(p.app(), filepath.FromSlash(c)), filepath.Join(p.backupApp(), filepath.FromSlash(c))); err != nil {
			t.Fatal(err)
		}
	}
	os.MkdirAll(p.failed(), 0o755)
	if err := os.Rename(p.app(), filepath.Join(p.failed(), "app")); err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(p.backupApp(), p.app()); err != nil {
		t.Fatal(err)
	}
	if rec, err := Recover(root, false, Options{Retry: time.Second}); rec != Finished || err != nil {
		t.Fatalf("Recover = %v %v", rec, err)
	}
	sameTree(t, before, tree(t, root), "after a half rollback was finished")
}

func TestCrashAfterHandOff(t *testing.T) {
	root := newCopy(t)
	before := tree(t, root)
	stage(t, root, "2.5.91")
	o := opts()
	o.CrashAfter = "H"
	Run(root, o)
	// The waiting launcher is gone. The next launch is the new version's
	// chance to confirm...
	if rec, err := Recover(root, false, Options{}); rec != Confirming || err != nil {
		t.Fatalf("first Recover = %v %v", rec, err)
	}
	if versionIn(filepath.Join(root, "app")) != "2.5.91" {
		t.Fatal("the new version should be in place while it tries")
	}
	// ...and a launch after one that never confirmed rolls back.
	if rec, err := Recover(root, false, Options{Retry: time.Second}); rec != Finished || err != nil {
		t.Fatalf("second Recover = %v %v", rec, err)
	}
	sameTree(t, before, tree(t, root), "after an unconfirmed hand-off")
	if r := readResult(t, root); r.Result != "rolledBack" {
		t.Fatalf("result %+v", r)
	}
}

func TestHealthFailureRollsBack(t *testing.T) {
	root := newCopy(t)
	before := tree(t, root)
	stage(t, root, "2.5.91")
	o := opts()
	o.Health = func(app, want string) error { return errors.New("the new server stopped as it started: Error: boom") }
	relaunched := false
	o.Relaunch = func(string) error { relaunched = true; return nil }
	o.Spawn = func(string) (Child, error) { t.Fatal("no hand-off after a failed health check"); return nil, nil }
	out, err := Run(root, o)
	if out != RolledBack || err == nil {
		t.Fatalf("Run = %v %v", out, err)
	}
	sameTree(t, before, tree(t, root), "after a failed health check")
	if r := readResult(t, root); r.Result != "rolledBack" || !strings.Contains(r.Reason, "boom") {
		t.Fatalf("result %+v", r)
	}
	if !relaunched {
		t.Fatal("the old Studio should be started again")
	}
}

func TestNewLauncherFailsExitsOrHangs(t *testing.T) {
	cases := map[string]func(root string, c *fakeChild){
		"fail": func(root string, c *fakeChild) {
			Fail(root, "Error: Cannot find module './x.js'")
			time.Sleep(50 * time.Millisecond)
			c.Kill()
		},
		"exit": func(root string, c *fakeChild) { c.Kill() },
		"hang": func(root string, c *fakeChild) {},
	}
	for name, fn := range cases {
		t.Run(name, func(t *testing.T) {
			root := newCopy(t)
			before := tree(t, root)
			stage(t, root, "2.5.91")
			var child *fakeChild
			o := opts()
			o.Wait = 1500 * time.Millisecond
			o.Spawn = spawnDoing(t, &child, fn)
			relaunched := 0
			o.Relaunch = func(string) error { relaunched++; return nil }
			out, err := Run(root, o)
			if out != RolledBack || err == nil {
				t.Fatalf("Run = %v %v", out, err)
			}
			sameTree(t, before, tree(t, root), "after "+name)
			r := readResult(t, root)
			if r.Result != "rolledBack" || relaunched != 1 {
				t.Fatalf("result %+v relaunched %d", r, relaunched)
			}
			want := map[string]string{"fail": "Cannot find module", "exit": "closed before it started", "hang": "didn't start within"}[name]
			if !strings.Contains(r.Reason, want) {
				t.Fatalf("reason %q, want %q", r.Reason, want)
			}
		})
	}
}

func TestHeldAppFolderChangesNothing(t *testing.T) {
	root := newCopy(t)
	before := tree(t, root)
	stage(t, root, "2.5.91")
	// A file inside app/ held open: Windows will not rename the folder.
	f, err := os.Open(filepath.Join(root, "app", "server.js"))
	if err != nil {
		t.Fatal(err)
	}
	o := opts()
	o.Retry = 800 * time.Millisecond
	out, err := Run(root, o)
	f.Close()
	if out != Blocked || err == nil {
		t.Fatalf("Run = %v %v", out, err)
	}
	sameTree(t, before, tree(t, root), "after a held folder")
	if Staged(root) != "2.5.91" || HasJournal(root) {
		t.Fatal("the staging should stay, with no journal")
	}
	if r := readResult(t, root); r.Result != "blocked" {
		t.Fatalf("result %+v", r)
	}
}

func TestRefusesWhatIsNotAPortableCopy(t *testing.T) {
	// a checkout: no Settings key in the layout
	root := newCopy(t)
	write(t, filepath.Join(root, "app", "program-layout.json"), `{"contentRoot":"../Content"}`)
	stage(t, root, "2.5.91")
	before := tree(t, root)
	if out, err := Run(root, opts()); out != Nothing || err != nil {
		t.Fatalf("checkout: Run = %v %v", out, err)
	}
	if rec, _ := Recover(root, false, Options{}); rec != Clean {
		t.Fatal("checkout: Recover acted")
	}
	sameTree(t, before, tree(t, root), "checkout")
	// a studio.path launcher folder
	root2 := newCopy(t)
	write(t, filepath.Join(root2, "studio.path"), `C:\somewhere`)
	stage(t, root2, "2.5.91")
	if out, _ := Run(root2, opts()); out != Nothing {
		t.Fatal("studio.path: Run acted")
	}
	// a staging that is not newer
	root3 := newCopy(t)
	stage(t, root3, "2.5.90")
	if out, _ := Run(root3, opts()); out != Nothing {
		t.Fatal("same version: Run acted")
	}
}

func TestRemoveTreeNeverFollowsAJunction(t *testing.T) {
	root := newCopy(t)
	outside := filepath.Join(t.TempDir(), "precious")
	write(t, filepath.Join(outside, "keep.txt"), "do not delete")
	link := filepath.Join(root, dirName, "failed", "app", "linked")
	if err := os.MkdirAll(filepath.Dir(link), 0o755); err != nil {
		t.Fatal(err)
	}
	if out, err := exec.Command("cmd", "/c", "mklink", "/J", link, outside).CombinedOutput(); err != nil {
		t.Fatalf("mklink: %v %s", err, out)
	}
	if !isLink(link) {
		t.Fatal("the junction is not seen as a link")
	}
	if err := removeTree(root, filepath.Join(root, dirName, "failed")); err != nil {
		t.Fatal(err)
	}
	if b, err := os.ReadFile(filepath.Join(outside, "keep.txt")); err != nil || string(b) != "do not delete" {
		t.Fatal("the junction's target was touched")
	}
	if exists(filepath.Join(root, dirName, "failed")) {
		t.Fatal("failed/ is still there")
	}
	if err := removeTree(root, filepath.Join(root, "Settings")); err == nil || !exists(filepath.Join(root, "Settings")) {
		t.Fatal("removeTree must refuse anything outside .update")
	}
	if err := removeTree(root, filepath.Join(root, dirName+"x")); err == nil {
		t.Fatal("a sibling whose name starts with .update must be refused")
	}
}

func standInCommand(mode string) func(string, int) *exec.Cmd {
	return func(app string, port int) *exec.Cmd {
		cmd := exec.Command(os.Args[0], "-test.run=^$", strconv.Itoa(port))
		cmd.Env = append(os.Environ(), "STUDIO_UPD_STANDIN="+mode)
		return cmd
	}
}

func TestHealthAgainstAStandIn(t *testing.T) {
	old := ServerCommand
	defer func() { ServerCommand = old }()
	app := filepath.Join(t.TempDir(), "Mugen Studio", "app")
	if err := os.MkdirAll(filepath.Join(filepath.Dir(app), dirName), 0o755); err != nil {
		t.Fatal(err)
	}
	ServerCommand = standInCommand("server:2.5.91")
	if err := Health(app, "2.5.91", testPort, 10*time.Second); err != nil {
		t.Fatalf("the right version: %v", err)
	}
	if err := Health(app, "2.5.92", testPort, 10*time.Second); err == nil || !strings.Contains(err.Error(), "says it is 2.5.91") {
		t.Fatalf("the wrong version: %v", err)
	}
	ServerCommand = standInCommand("crash")
	if err := Health(app, "2.5.91", testPort, 10*time.Second); err == nil || !strings.Contains(err.Error(), "stand-in could not start") {
		t.Fatalf("a server that stops: %v", err)
	}
	ServerCommand = standInCommand("sleep")
	start := time.Now()
	if err := Health(app, "2.5.91", testPort, 1500*time.Millisecond); err == nil || !strings.Contains(err.Error(), "didn't answer") {
		t.Fatalf("a server that never answers: %v", err)
	}
	if time.Since(start) > 15*time.Second {
		t.Fatal("Health did not give up in time")
	}
}

func TestJobKillEndsTheLauncherAndWhatItStarted(t *testing.T) {
	port, err := testPort()
	if err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command(os.Args[0], "-test.run=^$", strconv.Itoa(port))
	cmd.Env = append(os.Environ(), "STUDIO_UPD_STANDIN=listen-then-sleep")
	c, err := StartInJob(cmd)
	if err != nil {
		t.Fatal(err)
	}
	up := false
	for i := 0; i < 50 && !up; i++ {
		if conn, err := net.Dial("tcp", fmt.Sprintf("127.0.0.1:%d", port)); err == nil {
			conn.Close()
			up = true
		} else {
			time.Sleep(100 * time.Millisecond)
		}
	}
	if !up {
		t.Fatal("the stand-in never listened")
	}
	c.Kill()
	select {
	case <-c.Exited():
	case <-time.After(5 * time.Second):
		t.Fatal("Kill did not end it")
	}
	if l, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port)); err != nil {
		t.Fatal("its port is still held")
	} else {
		l.Close()
	}
}

func TestJobReleaseLetsItRunOn(t *testing.T) {
	cmd := exec.Command(os.Args[0], "-test.run=^$")
	cmd.Env = append(os.Environ(), "STUDIO_UPD_STANDIN=sleep")
	c, err := StartInJob(cmd)
	if err != nil {
		t.Fatal(err)
	}
	c.Release()
	time.Sleep(300 * time.Millisecond)
	select {
	case <-c.Exited():
		t.Fatal("a released child should run on")
	default:
	}
	_ = cmd.Process.Kill()
}

// The new launcher hangs, Run ends it, and the rollback cannot move app/ (a
// handle held inside it, as an orphan or a scanner would). The journal must
// say failed, so the next start finishes the rollback and never confirms the
// new version (a confirm deletes the backup: the old program and the
// person's carried files with it).
func TestRollbackThatCannotFinishIsNeverConfirmed(t *testing.T) {
	root := newCopy(t)
	before := tree(t, root)
	stage(t, root, "2.5.91")
	var child *fakeChild
	o := opts()
	o.Wait = 800 * time.Millisecond
	o.Retry = 600 * time.Millisecond
	var held *os.File
	var mu sync.Mutex
	o.Spawn = spawnDoing(t, &child, func(root string, c *fakeChild) {
		f, err := os.Open(filepath.Join(root, "app", "server.js"))
		if err == nil {
			mu.Lock()
			held = f
			mu.Unlock()
		}
	})
	relaunched := 0
	o.Relaunch = func(string) error { relaunched++; return nil }
	out, err := Run(root, o)
	if out != Stuck || err == nil || relaunched != 0 {
		t.Fatalf("Run = %v %v relaunched %d", out, err, relaunched)
	}
	j := readJournal(at(root))
	if j == nil || j.Failed == "" || !Pending(root) {
		t.Fatalf("the journal should be marked failed: %+v", j)
	}
	// Still held: the next start cannot finish, and says so.
	if rec, err := Recover(root, false, Options{Retry: 300 * time.Millisecond}); rec == Confirming || err == nil {
		t.Fatalf("Recover while held = %v %v", rec, err)
	}
	if err := Confirm(root); err != nil {
		t.Fatal(err)
	}
	if j := readJournal(at(root)); j == nil || j.Step == "confirmed" {
		t.Fatal("Confirm must never confirm a failed journal")
	}
	mu.Lock()
	if held != nil {
		held.Close()
	}
	mu.Unlock()
	if rec, err := Recover(root, false, Options{Retry: time.Second}); rec != Finished || err != nil {
		t.Fatalf("Recover = %v %v", rec, err)
	}
	sameTree(t, before, tree(t, root), "after a rollback finished by the next start")
	if r := readResult(t, root); r.Result != "rolledBack" || r.Reason == "" {
		t.Fatalf("result %+v", r)
	}
}

// A failed health check whose rollback cannot finish: the next start rolls
// back (as "rolledBack", with the reason), it does not call it interrupted.
func TestHealthFailureRollbackFinishedLater(t *testing.T) {
	root := newCopy(t)
	before := tree(t, root)
	stage(t, root, "2.5.91")
	o := opts()
	o.Retry = 500 * time.Millisecond
	var held *os.File
	o.Health = func(app, want string) error {
		held, _ = os.Open(filepath.Join(app, "server.js"))
		return errors.New("the new server stopped as it started: Error: boom")
	}
	out, err := Run(root, o)
	if out != Stuck || err == nil {
		t.Fatalf("Run = %v %v", out, err)
	}
	if held != nil {
		held.Close()
	}
	if rec, err := Recover(root, false, Options{Retry: time.Second}); rec != Finished || err != nil {
		t.Fatalf("Recover = %v %v", rec, err)
	}
	sameTree(t, before, tree(t, root), "after a health failure finished later")
	if r := readResult(t, root); r.Result != "rolledBack" || !strings.Contains(r.Reason, "boom") {
		t.Fatalf("result %+v", r)
	}
}

// The waiting launcher is gone and the new version's first launch fails: the
// launcher (failNew) marks it failed and rolls back at once, the way it does.
func TestUnwatchedFirstLaunchRollsBackAtOnce(t *testing.T) {
	root := newCopy(t)
	before := tree(t, root)
	stage(t, root, "2.5.91")
	o := opts()
	o.CrashAfter = "H"
	Run(root, o)
	if rec, err := Recover(root, false, Options{}); rec != Confirming || err != nil {
		t.Fatalf("Recover = %v %v", rec, err)
	}
	if err := Fail(root, "Could not start studio-server.exe"); err != nil {
		t.Fatal(err)
	}
	if err := Rollback(root, "rolledBack", "Could not start studio-server.exe", Options{Retry: time.Second}); err != nil {
		t.Fatal(err)
	}
	sameTree(t, before, tree(t, root), "after an unwatched failed first launch")
	if r := readResult(t, root); r.Result != "rolledBack" || !strings.Contains(r.Reason, "studio-server.exe") {
		t.Fatalf("result %+v", r)
	}
	if HasJournal(root) {
		t.Fatal("journal left")
	}
}

// staged.json alone is not enough: every file the staged program list names
// must be there at its size (a staging half deleted under its marker).
func TestStagedNeedsEveryListedFile(t *testing.T) {
	root := newCopy(t)
	stage(t, root, "2.5.91")
	if Staged(root) != "2.5.91" {
		t.Fatal("a whole staging")
	}
	f := filepath.Join(root, dirName, "staged", "app", "public", "studio.html")
	if err := os.Remove(f); err != nil {
		t.Fatal(err)
	}
	if Staged(root) != "" {
		t.Fatal("a staging missing a listed file was taken as whole")
	}
	write(t, f, "<html>new but longer")
	if Staged(root) != "" {
		t.Fatal("a staged file of the wrong size was taken as whole")
	}
	before := tree(t, root)
	if out, _ := Run(root, opts()); out != Nothing {
		t.Fatalf("Run on a broken staging = %v", out)
	}
	sameTree(t, before, tree(t, root), "a broken staging is never swapped in")
}

// The waiting launcher reads journal.json every 200 ms. A write over it
// while it is open must still land: readers open it sharing delete, and
// the rename is retried for a reader that does not (os.Open, a scanner).
func TestJournalWriteWhileItIsRead(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "journal.json")
	if err := writeJSON(p, &Journal{Step: "H"}); err != nil {
		t.Fatal(err)
	}
	// 1. held the way this package reads it, the whole time
	name, _ := syscall.UTF16PtrFromString(p)
	h, err := syscall.CreateFile(name, syscall.GENERIC_READ,
		syscall.FILE_SHARE_READ|syscall.FILE_SHARE_WRITE|syscall.FILE_SHARE_DELETE, nil, syscall.OPEN_EXISTING, 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	start := time.Now()
	err = writeJSON(p, &Journal{Step: "confirmed"})
	took := time.Since(start)
	syscall.CloseHandle(h)
	if err != nil {
		t.Fatalf("a write while a sharing reader holds it: %v", err)
	}
	t.Logf("write over a sharing reader took %v", took)
	// 2. held by a plain os.Open for a moment
	f, err := os.Open(p)
	if err != nil {
		t.Fatal(err)
	}
	go func() { time.Sleep(600 * time.Millisecond); f.Close() }()
	if err := writeJSON(p, &Journal{Step: "H", Failed: "x"}); err != nil {
		t.Fatalf("a write while os.Open holds it for 0.6 s: %v", err)
	}
	var j Journal
	if err := readJSON(p, &j); err != nil || j.Failed != "x" {
		t.Fatalf("read back %+v %v", j, err)
	}
	// 3. a reader polling as fast as it can while Confirm writes, many times
	root := newCopy(t)
	p2 := at(root)
	for i := 0; i < 30; i++ {
		if err := p2.stamp(&Journal{From: "2.5.90", To: "2.5.91", Step: "H"}); err != nil {
			t.Fatal(err)
		}
		stop := make(chan struct{})
		done := make(chan struct{})
		go func() {
			defer close(done)
			for {
				select {
				case <-stop:
					return
				default:
					readJournal(p2)
				}
			}
		}()
		err := Confirm(root)
		close(stop)
		<-done
		if err != nil {
			t.Fatalf("Confirm under a busy reader (round %d): %v", i, err)
		}
		if j := readJournal(p2); j == nil || j.Step != "confirmed" {
			t.Fatalf("round %d: journal %+v", i, j)
		}
	}
}
