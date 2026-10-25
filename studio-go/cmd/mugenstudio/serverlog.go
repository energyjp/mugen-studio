package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// THE SERVER'S OWN WORDS, KEPT.
//
// The server is a hidden child with no console, so everything it printed - the
// startup lines, and the one line that says why it stopped - used to go
// nowhere. Its output is appended to a log now, and the message that offers a
// restart quotes the end of it. Where: a portable copy's Settings\logs\ (the
// folder of everything its user owns, which no update replaces - layout.js),
// else logs\ beside this program (the checkout).
//
// Each run starts with a "=== time, port ===" line, so the end of the file is
// always the current run. Past serverLogLimit the file is moved to
// studio-server.old.log when a run starts: two files, never more.

const serverLogLimit = 1 << 20

// serverLogPath is where the log lives: logs\ in the Settings folder that the
// program's own layout names (app\program-layout.json "settings", resolved
// against app\ - the same key layout.js reads, and the only one this program
// reads from that file), else a logs folder beside the window program.
func serverLogPath(exe, app string) string {
	if s := settingsDir(app); s != "" {
		return filepath.Join(s, "logs", "studio-server.log")
	}
	return filepath.Join(filepath.Dir(exe), "logs", "studio-server.log")
}

// settingsDir is the "settings" folder app\program-layout.json names, or ""
// when there is no such file or key (the checkout, an older copy).
func settingsDir(app string) string {
	b, err := os.ReadFile(filepath.Join(app, "program-layout.json"))
	if err != nil {
		return ""
	}
	var layout struct {
		Settings string `json:"settings"`
	}
	if json.Unmarshal(bytes.TrimPrefix(b, []byte("\xef\xbb\xbf")), &layout) != nil || strings.TrimSpace(layout.Settings) == "" {
		return ""
	}
	p := filepath.FromSlash(strings.TrimSpace(layout.Settings))
	if !filepath.IsAbs(p) {
		p = filepath.Join(app, p)
	}
	return filepath.Clean(p)
}

// openServerLog opens the log for one run, or returns nil when it cannot be
// written (a read-only folder): the server then runs without one, as it
// always had.
func openServerLog(path string, port int) *os.File {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil
	}
	if st, err := os.Stat(path); err == nil && st.Size() > serverLogLimit {
		ext := filepath.Ext(path)
		// Replaces the older copy. When it fails the log just keeps growing.
		_ = os.Rename(path, strings.TrimSuffix(path, ext)+".old"+ext)
	}
	f, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		return nil
	}
	fmt.Fprintf(f, "\n=== %s  studio-server on port %d ===\n", time.Now().Format("2006-01-02 15:04:05"), port)
	return f
}

// serverLogTail is the end of the current run's output, for a message box:
// at most max lines, each trace cut to its first two frames (the frames say
// where, the line above them says what).
func serverLogTail(path string, max int) string {
	f, err := os.Open(path)
	if err != nil {
		return ""
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil {
		return ""
	}
	const window = 16 << 10
	off := st.Size() - window
	if off < 0 {
		off = 0
	}
	buf := make([]byte, st.Size()-off)
	n, _ := f.ReadAt(buf, off)
	text := strings.ReplaceAll(string(buf[:n]), "\r", "")
	if i := strings.LastIndex(text, "\n=== "); i >= 0 {
		text = text[i+1:]
	}
	var out []string
	frames := 0
	for _, l := range strings.Split(text, "\n") {
		l = strings.TrimRight(strings.ReplaceAll(l, "\x00", ""), " \t")
		if strings.TrimSpace(l) == "" || strings.HasPrefix(l, "=== ") {
			continue
		}
		if strings.HasPrefix(strings.TrimSpace(l), "at ") {
			if frames++; frames > 2 {
				continue
			}
		} else {
			frames = 0
		}
		if r := []rune(l); len(r) > 200 {
			l = string(r[:200]) + "..."
		}
		out = append(out, l)
	}
	if len(out) > max {
		out = out[len(out)-max:]
	}
	return strings.Join(out, "\n")
}

// exitWords says how a server process ended.
func exitWords(err error) string {
	var ee *exec.ExitError
	switch {
	case err == nil:
		return "It exited with code 0."
	case errors.As(err, &ee):
		code := ee.ExitCode()
		if code < 0 || code > 255 {
			return fmt.Sprintf("It exited with code 0x%08X.", uint32(code))
		}
		return fmt.Sprintf("It exited with code %d.", code)
	default:
		return "It stopped: " + err.Error()
	}
}

// crashMessage is the text of the box that offers a restart.
func crashMessage(why, tail, logPath string) string {
	var b strings.Builder
	b.WriteString("Mugen Studio's server stopped, so nothing can be loaded or saved right now.\n\n")
	b.WriteString(why)
	if tail != "" {
		b.WriteString("\n\nThe last thing it said:\n" + tail)
	}
	b.WriteString("\n\nRestart starts it again. Open pages stay as they are; if one looks stuck, " +
		"press F5 in it. Close ends Mugen Studio.")
	if logPath != "" {
		b.WriteString("\n\nEverything it said is in:\n" + logPath)
	}
	b.WriteString("\n\nRestart it now?")
	return strings.ReplaceAll(b.String(), "\x00", "")
}
