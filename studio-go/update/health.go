package update

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"
)

// FreePort is a port nothing listens on, from the OS.
func FreePort() (int, error) {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return 0, err
	}
	defer l.Close()
	return l.Addr().(*net.TCPAddr).Port, nil
}

// ServerCommand makes the command Health runs; a variable so the tests can
// start a stand-in.
var ServerCommand = func(app string, port int) *exec.Cmd {
	cmd := exec.Command(filepath.Join(app, ServerExe), strconv.Itoa(port), "--no-open", "--exit-on-stdin-close")
	cmd.Dir = app
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000} // CREATE_NO_WINDOW
	return cmd
}

// Health starts the new app/studio-server.exe on a port of its own and asks
// it GET /api/update: it must answer 200, as the version it was downloaded
// as, within d. Not /api/studio, which reads the whole build first and can
// take as long as a big build takes. Started inside a job object; stopped
// by closing its stdin (--exit-on-stdin-close), the job ended after 10 s. Its output goes to
// .update/health.log, whose end is the reason when it fails.
func Health(app, want string, port func() (int, error), d time.Duration) error {
	pt, err := port()
	if err != nil {
		return err
	}
	logPath := filepath.Join(filepath.Dir(app), dirName, "health.log")
	logf, _ := os.Create(logPath)
	cmd := ServerCommand(app, pt)
	if logf != nil {
		cmd.Stdout, cmd.Stderr = logf, logf
	}
	// In a job object, like the new launcher at step H: if this launcher
	// dies during the check, Windows ends the new server with it. A new build
	// that hangs before it reads its stdin would otherwise outlive us and
	// hold app/, and the next start could not put the old program back.
	in, err := cmd.StdinPipe()
	var child Child
	if err == nil {
		child, err = StartInJob(cmd)
	}
	if logf != nil {
		logf.Close()
	}
	if err != nil {
		return fmt.Errorf("the new server couldn't start (%v)", err)
	}
	exited := child.Exited()
	defer func() {
		_ = in.Close()
		select {
		case <-exited:
		case <-time.After(10 * time.Second):
		}
		// Ends it if it is still there, and anything it started, and lets
		// go of the job.
		child.Kill()
		_ = os.Remove(logPath)
	}()
	url := fmt.Sprintf("http://127.0.0.1:%d/api/update", pt)
	c := &http.Client{Timeout: 2 * time.Second}
	deadline := time.Now().Add(d)
	got := ""
	for time.Now().Before(deadline) {
		if r, err := c.Get(url); err == nil {
			b, _ := io.ReadAll(io.LimitReader(r.Body, 1<<20))
			r.Body.Close()
			var s struct {
				Version string `json:"version"`
			}
			if r.StatusCode == 200 && json.Unmarshal(b, &s) == nil {
				if s.Version == want {
					return nil
				}
				got = s.Version
				break
			}
		}
		select {
		case <-exited:
			return errors.New(lastWords(logPath, "the new server stopped as it started"))
		case <-time.After(150 * time.Millisecond):
		}
	}
	if got != "" {
		return fmt.Errorf("the new server says it is %s, not %s", got, want)
	}
	return errors.New(lastWords(logPath, fmt.Sprintf("the new server didn't answer within %d seconds", int(d.Seconds()))))
}

// lastWords is the last line the server printed that says something, or
// fallback.
func lastWords(logPath, fallback string) string {
	b, err := os.ReadFile(logPath)
	if err != nil {
		return fallback
	}
	lines := strings.Split(strings.ReplaceAll(string(b), "\r\n", "\n"), "\n")
	for i := len(lines) - 1; i >= 0; i-- {
		l := strings.TrimSpace(lines[i])
		if l == "" || strings.HasPrefix(l, "at ") {
			continue
		}
		if len(l) > 300 {
			l = l[:300]
		}
		return fallback + ": " + l
	}
	return fallback
}
