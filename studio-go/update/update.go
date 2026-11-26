// Package update swaps a downloaded Mugen Studio into a portable copy.
//
// THE STUDIO DOWNLOADS, THE WINDOW SWAPS. The Studio's server (updater.js)
// fetches GitHub's latest release on the person's click, checks it every way
// it can and unpacks it into <copy>/.update/staged/, writing staged.json last.
// It never touches the running program. This package is the other half: run
// by MugenStudio.exe after its window closed ("Restart to update") or at the
// start of a launch that finds a whole staging, BEFORE any server starts.
//
// Everything it owns is in <copy>/.update/, on the same drive as the copy, so
// every step is a rename:
//
//	staged/ staged.json  the new program, put there by the Studio
//	backup/              the old program, until the new one has started once
//	failed/              a new program that was rolled back (deleted at once)
//	journal.json         where an update is; written BEFORE every step
//	result.json          the last word for the page (applied, rolled back...)
//
// THE PROGRAM is MugenStudio.exe, the three .txt files beside it and app/.
// Settings/, Content/ and what is inside the two Export folders are never
// touched. What the person keeps inside app/ - the window's preferences in
// app/webview-data, an engine zip they put in app/Dependencies - is carried
// into the new app/: everything the OLD app/program-files.json does not list
// and the new app/ does not have.
//
// THE STEPS (journal "step"):
//
//	A  checked: a portable copy, a whole staging newer than this version
//	B  app/ -> backup/app            (held open: retried 20 s, then nothing changed)
//	C  the top files -> backup/
//	D  staged/app -> app/, the staged top files -> the copy; then staged.json
//	   and what is left of staged/ go
//	E  the person's files carried from backup/app into app/
//	F  the two Export folders made if missing
//	G  the NEW app/studio-server.exe started on a free port, inside a job
//	   object (it dies with this process): it must answer /api/update with
//	   its own version within 40 s
//	H  the new MugenStudio.exe started (--after-update) inside a job object;
//	   this process waits up to 90 s for it to write "confirmed"
//
// Any failure after B, a crash or a power cut included, is ROLLED BACK by
// state, not by memory: Rollback looks at what is where and puts the old
// program back, so it can be run again after it was itself interrupted.
// Before a rollback the journal is marked failed, so one that cannot finish
// (Stuck) is finished by the next start and never confirmed. Recover runs at
// the top of every launch of a portable copy and finishes whatever an
// earlier launch left; while Pending, no server may start from app/.
package update

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

const (
	dirName    = ".update"
	ServerExe  = "studio-server.exe"
	LauncherEx = "MugenStudio.exe"
)

// TopFiles are the program's files beside app/.
var TopFiles = []string{"MugenStudio.exe", "READ ME.txt", "LICENSE.txt", "THIRD-PARTY-NOTICES.txt"}

// ExportDirs are made when missing and never touched otherwise.
var ExportDirs = []string{"Desktop Export", "Website Export"}

// Journal is .update/journal.json.
type Journal struct {
	From      string   `json:"from"`
	To        string   `json:"to"`
	SHA256    string   `json:"sha256,omitempty"`
	Step      string   `json:"step"`
	TopMoved  []string `json:"topMoved,omitempty"`
	TopPlaced []string `json:"topPlaced,omitempty"`
	Carried   []string `json:"carried,omitempty"`
	Handoffs  int      `json:"handoffs,omitempty"`
	Failed    string   `json:"failed,omitempty"`
	At        string   `json:"at"`
}

// Result is .update/result.json, read once by the Studio (updater.js).
type Result struct {
	Result string `json:"result"` // applied | rolledBack | interrupted | blocked
	From   string `json:"from"`
	To     string `json:"to"`
	Reason string `json:"reason,omitempty"`
	At     string `json:"at"`
}

type paths struct{ root, upd string }

func at(root string) paths { return paths{root: root, upd: filepath.Join(root, dirName)} }

func (p paths) app() string            { return filepath.Join(p.root, "app") }
func (p paths) staged() string         { return filepath.Join(p.upd, "staged") }
func (p paths) stagedJSON() string     { return filepath.Join(p.upd, "staged.json") }
func (p paths) backup() string         { return filepath.Join(p.upd, "backup") }
func (p paths) failed() string         { return filepath.Join(p.upd, "failed") }
func (p paths) journal() string        { return filepath.Join(p.upd, "journal.json") }
func (p paths) result() string         { return filepath.Join(p.upd, "result.json") }
func (p paths) backupApp() string      { return filepath.Join(p.backup(), "app") }
func (p paths) part() string           { return filepath.Join(p.upd, "download.part") }
func exists(p string) bool             { _, err := os.Lstat(p); return err == nil }
func now() string                      { return time.Now().UTC().Format(time.RFC3339) }
func (p paths) stamp(j *Journal) error { j.At = now(); return writeJSON(p.journal(), j) }

// ---- versions -------------------------------------------------------------------

// ParseVersion reads "v2.5.1" or "2.5.1": one to four dotted numbers.
func ParseVersion(s string) ([]int, bool) {
	s = strings.TrimPrefix(strings.TrimSpace(s), "v")
	parts := strings.Split(s, ".")
	if s == "" || len(parts) > 4 {
		return nil, false
	}
	out := make([]int, 4)
	for i, x := range parts {
		if x == "" || len(x) > 6 {
			return nil, false
		}
		n, err := strconv.Atoi(x)
		if err != nil || n < 0 || strings.TrimLeft(x, "0123456789") != "" {
			return nil, false
		}
		out[i] = n
	}
	return out, true
}

// Compare is -1, 0 or 1; ok is false when either is not a version.
func Compare(a, b string) (int, bool) {
	x, ok1 := ParseVersion(a)
	y, ok2 := ParseVersion(b)
	if !ok1 || !ok2 {
		return 0, false
	}
	for i := 0; i < 4; i++ {
		if x[i] != y[i] {
			if x[i] < y[i] {
				return -1, true
			}
			return 1, true
		}
	}
	return 0, true
}

func versionIn(app string) string {
	var v struct {
		Version string `json:"version"`
	}
	if readJSON(filepath.Join(app, "studio-version.json"), &v) != nil {
		return ""
	}
	if _, ok := ParseVersion(v.Version); !ok {
		return ""
	}
	return strings.TrimPrefix(strings.TrimSpace(v.Version), "v")
}

// ---- json -----------------------------------------------------------------------

func readJSON(file string, v any) error {
	b, err := readShared(file)
	if err != nil {
		return err
	}
	return json.Unmarshal(bytes.TrimPrefix(b, []byte("\xef\xbb\xbf")), v)
}

// writeRetry is how long a journal or result write keeps trying while
// another process has the file open (the other launcher reading it, an
// antivirus scan): the rename over it is refused while it is open.
var writeRetry = 3 * time.Second

// writeJSON writes the whole file and then renames it over the old one, so a
// reader - or a crash - sees the old file or the new one, never half. The
// rename is retried (writeRetry): one refused write used to leave a confirmed
// update at step H, and its watchdog then rolled a working Studio back.
func writeJSON(file string, v any) error {
	b, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(file), 0o755); err != nil {
		return err
	}
	tmp := file + ".tmp"
	if err := os.WriteFile(tmp, append(b, '\n'), 0o644); err != nil {
		return err
	}
	if err := replaceRetry(tmp, file, writeRetry); err != nil {
		return fmt.Errorf("could not write %s: %w", file, err)
	}
	return nil
}

func readJournal(p paths) *Journal {
	var j Journal
	if readJSON(p.journal(), &j) != nil {
		if exists(p.journal()) {
			// There but unreadable: treat it as an interrupted update, which
			// Rollback can finish from the state of the folders alone.
			return &Journal{Step: "?"}
		}
		return nil
	}
	return &j
}

// ---- what a copy is --------------------------------------------------------------

func hasSettings(app string) bool {
	var l struct {
		Settings string `json:"settings"`
	}
	return readJSON(filepath.Join(app, "program-layout.json"), &l) == nil && strings.TrimSpace(l.Settings) != ""
}

// IsPortable: a copy this package may change. app/program-layout.json names
// a Settings folder (in the middle of an update, the backup's does) and no
// studio.path steers the window elsewhere. The checkout has neither.
func IsPortable(root string) bool {
	p := at(root)
	if exists(filepath.Join(root, "studio.path")) {
		return false
	}
	if hasSettings(p.app()) {
		return true
	}
	return exists(p.journal()) && hasSettings(p.backupApp())
}

// HasJournal says an update is under way or was interrupted.
func HasJournal(root string) bool { return exists(at(root).journal()) }

// Pending: a journal that is not "confirmed" - an update being applied, or
// one whose rollback has not finished. No server may start from app/ then.
// A confirmed journal only waits for the next start to delete the backup.
func Pending(root string) bool {
	j := readJournal(at(root))
	return j != nil && j.Step != "confirmed"
}

type staging struct {
	Version string `json:"version"`
	SHA256  string `json:"sha256"`
}

// Staged is the version of a whole staging newer than this copy, or "".
func Staged(root string) string {
	p := at(root)
	var s staging
	if readJSON(p.stagedJSON(), &s) != nil {
		return ""
	}
	if c, ok := Compare(s.Version, versionIn(p.app())); !ok || c <= 0 {
		return ""
	}
	if versionIn(filepath.Join(p.staged(), "app")) != strings.TrimPrefix(s.Version, "v") {
		return ""
	}
	for _, f := range []string{"MugenStudio.exe", "app/" + ServerExe, "app/server.js", "app/program-files.json"} {
		if !exists(filepath.Join(p.staged(), filepath.FromSlash(f))) {
			return ""
		}
	}
	if !hasSettings(filepath.Join(p.staged(), "app")) {
		return ""
	}
	if !wholeApp(filepath.Join(p.staged(), "app")) {
		return ""
	}
	return strings.TrimPrefix(s.Version, "v")
}

// wholeApp: every file the staged app/program-files.json lists is there, at
// its listed size. staged.json says the Studio finished unpacking, but a
// half-deleted older staging under a staged.json that outlived it (a power
// cut while a new download cleared it) must never be swapped in.
func wholeApp(app string) bool {
	var list []struct {
		Path string `json:"path"`
		Size int64  `json:"size"`
	}
	if readJSON(filepath.Join(app, "program-files.json"), &list) != nil || len(list) == 0 {
		return false
	}
	for _, it := range list {
		rel := filepath.FromSlash(it.Path)
		if it.Path == "" || filepath.IsAbs(rel) || strings.HasPrefix(filepath.Clean(rel), "..") {
			return false
		}
		fi, err := os.Lstat(filepath.Join(app, rel))
		if err != nil || fi.IsDir() || fi.Size() != it.Size {
			return false
		}
	}
	return true
}

// ---- options ----------------------------------------------------------------------

// Child is the new launcher, started by Spawn.
type Child interface {
	Exited() <-chan struct{}
	Kill()    // ends it and everything it started
	Release() // lets it run on after this process is gone
}

// Options are what tests and the harness change. Zero values are the real
// thing (Defaults).
type Options struct {
	Log      func(format string, a ...any)
	Retry    time.Duration // how long a held file is waited for (20 s)
	Wait     time.Duration // how long the new launcher has to confirm (90 s)
	HealthIn time.Duration // how long the new server has to answer (40 s)
	// Health starts the new app/studio-server.exe and asks it (health.go).
	Health func(app, want string) error
	// HealthPort picks the port for Health (a free one).
	HealthPort func() (int, error)
	// Spawn starts the new launcher (root/MugenStudio.exe --after-update).
	Spawn func(root string) (Child, error)
	// Relaunch starts the launcher that is there after a rollback or a
	// refused swap (--after-rollback). Nil: nothing is started.
	Relaunch func(root string) error
	// CrashAfter stops right after that step's work, as a crash would
	// (tests and the harness only).
	CrashAfter string
}

func (o *Options) defaults() {
	if o.Log == nil {
		o.Log = func(string, ...any) {}
	}
	if o.Retry == 0 {
		o.Retry = 20 * time.Second
	}
	if o.Wait == 0 {
		o.Wait = 90 * time.Second
	}
	if o.HealthIn == 0 {
		o.HealthIn = 40 * time.Second
	}
	if o.HealthPort == nil {
		o.HealthPort = FreePort
	}
	if o.Health == nil {
		o.Health = func(app, want string) error { return Health(app, want, o.HealthPort, o.HealthIn) }
	}
}

// ErrCrash is what CrashAfter returns.
var ErrCrash = errors.New("stopped on purpose after a step (test)")

// Outcome of Run.
type Outcome string

const (
	Nothing    Outcome = ""           // no update was there, or it was refused before anything moved
	Blocked    Outcome = "blocked"    // app/ was held open: nothing changed, the staging is kept
	Applied    Outcome = "applied"    // the new launcher confirmed; it runs on
	RolledBack Outcome = "rolledBack" // the old program is back (and was relaunched)
	Stuck      Outcome = "stuck"      // the rollback could not finish: the journal stays, marked failed, and the next start finishes it; nothing may start from app/
	Crashed    Outcome = "crashed"    // CrashAfter (tests)
)

// ---- apply ------------------------------------------------------------------------

// Run swaps a whole staging in, hands over to the new launcher and waits for
// it. Call it with no server running from this copy, after Recover.
func Run(root string, o Options) (Outcome, error) {
	o.defaults()
	p := at(root)
	if !IsPortable(root) || HasJournal(root) {
		return Nothing, nil
	}
	to := Staged(root)
	if to == "" {
		return Nothing, nil
	}
	from := versionIn(p.app())
	var s staging
	_ = readJSON(p.stagedJSON(), &s)
	j := &Journal{From: from, To: to, SHA256: s.SHA256, Step: "A"}
	// A leftover backup with no journal is an update that finished but whose
	// clean-up did not: it can go.
	if exists(p.backup()) {
		if err := removeTree(root, p.backup()); err != nil {
			return Nothing, err
		}
	}
	if err := p.stamp(j); err != nil {
		return Nothing, fmt.Errorf("could not write %s: %w", p.journal(), err)
	}
	o.Log("update %s -> %s: start", from, to)
	if o.CrashAfter == "A" {
		return Crashed, ErrCrash
	}

	// B: the old app/ aside. The one step that can find the folder held open
	// (a server that did not stop, a lingering WebView2 process, a console
	// whose current folder is in it): waited for, then given up with nothing
	// changed.
	j.Step = "B"
	if err := p.stamp(j); err != nil {
		return Nothing, err
	}
	if err := os.MkdirAll(p.backup(), 0o755); err != nil {
		return blocked(p, j, err.Error())
	}
	if err := renameRetry(p.app(), p.backupApp(), o.Retry); err != nil {
		return blocked(p, j, err.Error())
	}
	if o.CrashAfter == "B" {
		return Crashed, ErrCrash
	}

	// undo puts the old program back. The journal is marked failed FIRST, so
	// a rollback that cannot finish (app/ held past the retry) is finished by
	// the next start and never read as a new version waiting to confirm: a
	// confirm then would delete the backup, and with it the old program and
	// the files already carried back into it.
	undo := func(kind, reason string, err error) (Outcome, error) {
		j.Failed = reason
		if j.Failed == "" {
			j.Failed = err.Error()
		}
		if serr := p.stamp(j); serr != nil {
			o.Log("update %s -> %s: could not mark the journal failed: %v", from, to, serr)
		}
		if rerr := Rollback(root, kind, reason, o); rerr != nil {
			o.Log("update %s -> %s: the rollback did not finish: %v", from, to, rerr)
			return Stuck, fmt.Errorf("%v, and putting the old version back didn't finish: %w", err, rerr)
		}
		relaunch(root, o)
		return RolledBack, err
	}
	fail := func(err error) (Outcome, error) {
		o.Log("update %s -> %s: %v, rolling back", from, to, err)
		return undo("interrupted", "", err)
	}

	// C: the top files aside.
	j.Step = "C"
	if err := p.stamp(j); err != nil {
		return fail(err)
	}
	for _, f := range TopFiles {
		if !exists(filepath.Join(root, f)) {
			continue
		}
		j.TopMoved = append(j.TopMoved, f)
		if err := p.stamp(j); err != nil {
			return fail(err)
		}
		if err := renameRetry(filepath.Join(root, f), filepath.Join(p.backup(), f), o.Retry); err != nil {
			return fail(err)
		}
	}
	if o.CrashAfter == "C" {
		return Crashed, ErrCrash
	}

	// D: the new program in.
	j.Step = "D"
	if err := p.stamp(j); err != nil {
		return fail(err)
	}
	if err := renameRetry(filepath.Join(p.staged(), "app"), p.app(), o.Retry); err != nil {
		return fail(err)
	}
	for _, f := range TopFiles {
		src := filepath.Join(p.staged(), f)
		if !exists(src) {
			continue
		}
		j.TopPlaced = append(j.TopPlaced, f)
		if err := p.stamp(j); err != nil {
			return fail(err)
		}
		if err := renameRetry(src, filepath.Join(root, f), o.Retry); err != nil {
			return fail(err)
		}
	}
	// What the staging still holds (the zip's empty Export folders) and its
	// marker go now: staged.json first, so a half-deleted staged/ is never
	// read as whole.
	for _, d := range []string{p.stagedJSON(), p.staged()} {
		if err := removeTree(root, d); err != nil {
			o.Log("update %s -> %s: could not remove %s: %v", from, to, d, err)
		}
	}
	if o.CrashAfter == "D" {
		return Crashed, ErrCrash
	}

	// E: what the person keeps in app/ comes along.
	j.Step = "E"
	if err := p.stamp(j); err != nil {
		return fail(err)
	}
	if err := carry(p, j, o); err != nil {
		return fail(err)
	}
	if o.CrashAfter == "E" {
		return Crashed, ErrCrash
	}

	// F: the Export folders, only when missing.
	j.Step = "F"
	if err := p.stamp(j); err != nil {
		return fail(err)
	}
	for _, d := range ExportDirs {
		if err := os.MkdirAll(filepath.Join(root, d), 0o755); err != nil {
			return fail(err)
		}
	}
	if o.CrashAfter == "F" {
		return Crashed, ErrCrash
	}

	// G: the new server answers, as itself.
	j.Step = "G"
	if err := p.stamp(j); err != nil {
		return fail(err)
	}
	if err := o.Health(p.app(), to); err != nil {
		o.Log("update %s -> %s: the new server did not answer: %v", from, to, err)
		return undo("rolledBack", err.Error(), err)
	}
	if o.CrashAfter == "G" {
		return Crashed, ErrCrash
	}

	// H: the new launcher, which writes "confirmed" once its server answers.
	j.Step = "H"
	if err := p.stamp(j); err != nil {
		return fail(err)
	}
	if o.CrashAfter == "H" {
		return Crashed, ErrCrash
	}
	if o.Spawn == nil {
		return fail(errors.New("no way to start the new version"))
	}
	child, err := o.Spawn(root)
	if err != nil {
		return undo("rolledBack", "it could not be started: "+err.Error(), err)
	}
	reason := watch(p, child, o.Wait)
	if reason == "" {
		child.Release()
		o.Log("update %s -> %s: confirmed", from, to)
		return Applied, nil
	}
	// The new launcher is ended (with all it started) BEFORE the journal is
	// marked failed, so it cannot write "confirmed" over that mark.
	child.Kill()
	o.Log("update %s -> %s: %s, rolling back", from, to, reason)
	return undo("rolledBack", reason, errors.New(reason))
}

func relaunch(root string, o Options) {
	if o.Relaunch == nil {
		return
	}
	if err := o.Relaunch(root); err != nil {
		o.Log("could not start the Studio again: %v", err)
	}
}

// blocked: B could not move app/. Nothing has changed; the staging stays for
// the next try, and the page says why.
func blocked(p paths, j *Journal, why string) (Outcome, error) {
	_ = os.Remove(p.backup()) // only when empty
	_ = writeJSON(p.result(), &Result{Result: "blocked", From: j.From, To: j.To, Reason: why, At: now()})
	_ = os.Remove(p.journal())
	return Blocked, errors.New(why)
}

// watch waits for the new launcher's word: "" once it confirmed, else why
// it is being rolled back.
func watch(p paths, child Child, wait time.Duration) string {
	deadline := time.After(wait)
	tick := time.NewTicker(200 * time.Millisecond)
	defer tick.Stop()
	for {
		j := readJournal(p)
		if j != nil {
			if j.Step == "confirmed" {
				return ""
			}
			if j.Failed != "" {
				return j.Failed
			}
		}
		select {
		case <-child.Exited():
			// Its last write may have landed just before it left.
			if j := readJournal(p); j != nil {
				if j.Step == "confirmed" {
					return ""
				}
				if j.Failed != "" {
					return j.Failed
				}
			}
			return "the new version closed before it started"
		case <-deadline:
			return fmt.Sprintf("the new version didn't start within %d seconds", int(wait.Seconds()))
		case <-tick.C:
		}
	}
}

// carry moves into the new app/ everything in the old one that the old
// app/program-files.json does not list and the new app/ does not have. A
// folder nothing listed lives under moves whole (app/webview-data).
func carry(p paths, j *Journal, o Options) error {
	old := p.backupApp()
	var list []struct {
		Path string `json:"path"`
	}
	listed := map[string]bool{}
	dirs := map[string]bool{}
	haveList := readJSON(filepath.Join(old, "program-files.json"), &list) == nil
	for _, it := range list {
		rel := strings.ToLower(filepath.ToSlash(it.Path))
		listed[rel] = true
		for d := filepath.ToSlash(filepath.Dir(rel)); d != "." && d != "/"; d = filepath.ToSlash(filepath.Dir(d)) {
			dirs[d] = true
		}
	}
	listed["program-files.json"] = true
	var walk func(rel string) error
	walk = func(rel string) error {
		ents, err := os.ReadDir(filepath.Join(old, filepath.FromSlash(rel)))
		if err != nil {
			return err
		}
		for _, e := range ents {
			r := e.Name()
			if rel != "" {
				r = rel + "/" + e.Name()
			}
			key := strings.ToLower(r)
			src := filepath.Join(old, filepath.FromSlash(r))
			dst := filepath.Join(p.app(), filepath.FromSlash(r))
			isDir := e.IsDir() && !isLink(src)
			if haveList && (listed[key] || (isDir && dirs[key])) {
				if isDir {
					if err := walk(r); err != nil {
						return err
					}
				}
				continue
			}
			if exists(dst) {
				if isDir {
					if err := walk(r); err != nil {
						return err
					}
				}
				continue
			}
			j.Carried = append(j.Carried, r)
			if err := p.stamp(j); err != nil {
				return err
			}
			if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
				return err
			}
			if err := renameRetry(src, dst, o.Retry); err != nil {
				return err
			}
		}
		return nil
	}
	return walk("")
}

// ---- rollback ---------------------------------------------------------------------

// Rollback puts the old program back from what is on disk, so it can run
// again after being interrupted itself. kind goes into result.json
// (rolledBack, interrupted). The journal is deleted only when everything is
// back.
func Rollback(root, kind, reason string, o Options) error {
	o.defaults()
	p := at(root)
	j := readJournal(p)
	if j == nil {
		j = &Journal{}
	}
	// 1. the carried files back into the old app/, newest first
	for i := len(j.Carried) - 1; i >= 0; i-- {
		src := filepath.Join(p.app(), filepath.FromSlash(j.Carried[i]))
		dst := filepath.Join(p.backupApp(), filepath.FromSlash(j.Carried[i]))
		if exists(src) && !exists(dst) && exists(p.backupApp()) {
			if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
				return err
			}
			if err := renameRetry(src, dst, o.Retry); err != nil {
				return err
			}
		}
	}
	// 2. the old app/ back
	if exists(p.backupApp()) {
		if exists(p.app()) {
			if err := os.MkdirAll(p.failed(), 0o755); err != nil {
				return err
			}
			if err := removeTree(root, filepath.Join(p.failed(), "app")); err != nil {
				return err
			}
			if err := renameRetry(p.app(), filepath.Join(p.failed(), "app"), o.Retry); err != nil {
				return err
			}
		}
		if err := renameRetry(p.backupApp(), p.app(), o.Retry); err != nil {
			return err
		}
	}
	// 3. the top files back; one the new version added and the old did not
	// have goes
	moved := map[string]bool{}
	for _, f := range j.TopMoved {
		moved[f] = true
	}
	for _, f := range TopFiles {
		bak := filepath.Join(p.backup(), f)
		cur := filepath.Join(root, f)
		if exists(bak) {
			if exists(cur) {
				if err := aside(p, root, f, o); err != nil {
					return err
				}
			}
			if err := renameRetry(bak, cur, o.Retry); err != nil {
				return err
			}
			continue
		}
		placed := false
		for _, x := range j.TopPlaced {
			placed = placed || x == f
		}
		if placed && !moved[f] && exists(cur) {
			if err := aside(p, root, f, o); err != nil {
				return err
			}
		}
	}
	// 4. clean up: the failed program and the staging go; the backup only
	// when it is empty (never a file of the old program)
	for _, d := range []string{p.failed(), p.staged(), p.stagedJSON(), p.part()} {
		if err := removeTree(root, d); err != nil {
			o.Log("rollback: could not remove %s: %v", d, err)
		}
	}
	_ = os.Remove(p.backup())
	if kind == "" {
		kind = "rolledBack"
	}
	if j.Failed != "" && reason == "" {
		reason = j.Failed
	}
	if err := writeJSON(p.result(), &Result{Result: kind, From: j.From, To: j.To, Reason: reason, At: now()}); err != nil {
		return err
	}
	return os.Remove(p.journal())
}

func aside(p paths, root, f string, o Options) error {
	if err := os.MkdirAll(p.failed(), 0o755); err != nil {
		return err
	}
	dst := filepath.Join(p.failed(), f)
	if err := removeTree(root, dst); err != nil {
		return err
	}
	return renameRetry(filepath.Join(root, f), dst, o.Retry)
}

// ---- recover, confirm, fail ---------------------------------------------------

// Recovery is what Recover found.
type Recovery string

const (
	Clean      Recovery = ""           // nothing to do
	Confirming Recovery = "confirming" // this launch is the new version's first: Confirm once its server answers
	Finished   Recovery = "finished"   // an earlier update was finished or rolled back now
)

// Recover finishes what an earlier launch left: it runs at the top of every
// launch of a portable copy, before the server starts. afterUpdate is the
// --after-update launch the old launcher is waiting for.
func Recover(root string, afterUpdate bool, o Options) (Recovery, error) {
	o.defaults()
	if !IsPortable(root) {
		return Clean, nil
	}
	p := at(root)
	j := readJournal(p)
	if j == nil {
		// Leftovers: a rollback's failed/, a confirmed update's backup whose
		// clean-up did not finish, and a staging that was never finished.
		for _, d := range []string{p.failed(), p.backup()} {
			if exists(d) {
				if err := removeTree(root, d); err != nil {
					return Clean, err
				}
			}
		}
		if exists(p.staged()) && !exists(p.stagedJSON()) {
			_ = removeTree(root, p.staged())
		}
		return Clean, nil
	}
	switch {
	case j.Step == "A":
		return Finished, os.Remove(p.journal())
	case j.Step == "confirmed":
		// The new version has started cleanly once: the old one can go.
		if err := removeTree(root, p.backup()); err != nil {
			return Finished, err
		}
		_ = removeTree(root, p.failed())
		return Finished, os.Remove(p.journal())
	case j.Step == "H" && j.Failed == "":
		if afterUpdate {
			return Confirming, nil
		}
		// The launcher that was waiting is gone. This launch is the new
		// version's chance to confirm; a second launch that finds it still
		// unconfirmed rolls back.
		if j.Handoffs >= 1 {
			return Finished, Rollback(root, "rolledBack", "the new version didn't start", o)
		}
		j.Handoffs++
		if err := p.stamp(j); err != nil {
			return Clean, err
		}
		return Confirming, nil
	case j.Step == "H", j.Step == "G" && j.Failed != "":
		// A new version that failed (its health check, its window), whose
		// rollback did not finish then.
		return Finished, Rollback(root, "rolledBack", j.Failed, o)
	default:
		return Finished, Rollback(root, "interrupted", "", o)
	}
}

// Confirm: the new version's server answered. The result goes first, so
// the page that loads next can say "You're on <version>".
func Confirm(root string) error {
	p := at(root)
	j := readJournal(p)
	if j == nil || j.Step != "H" || j.Failed != "" {
		return nil
	}
	if err := writeJSON(p.result(), &Result{Result: "applied", From: j.From, To: j.To, At: now()}); err != nil {
		return err
	}
	j.Step = "confirmed"
	return p.stamp(j)
}

// Fail: the new version could not start its server; the launcher waiting
// for it rolls back with this reason.
func Fail(root, reason string) error {
	p := at(root)
	j := readJournal(p)
	if j == nil || j.Step != "H" {
		return nil
	}
	if reason == "" {
		reason = "the new version couldn't start"
	}
	j.Failed = reason
	return p.stamp(j)
}
