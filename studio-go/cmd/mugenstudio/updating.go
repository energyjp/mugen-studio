package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"mugenstudio/update"
)

// THE WINDOW'S HALF OF THE UPDATER (studio-go/update has the steps).
//
// The Studio downloads a new version into <copy>/.update/staged/ and the page
// asks for "Restart to update" (nativeRestartToUpdate in main.go). After the
// window has closed and the server has stopped, this swaps the program and
// starts the NEW MugenStudio.exe with --after-update, then waits as a
// windowless watchdog until it says its server answered. A new version that
// does not start is rolled back and the old one is started again with
// --after-rollback. Both flags mean "the launcher before me holds this
// folder's instance lock and is handing it to me".
//
// Every launch of a portable copy first finishes whatever an earlier one left
// (update.Recover), and a launch that finds a whole staging - the person
// pressed Later, or used the Studio in a browser - swaps it in before any
// server starts. The checkout is never a portable copy, so none of this ever
// runs there.

// startupUpdate runs before the server: the lock, Recover, and a staged
// update. -> confirming: this launch is the new version's first and must
// Confirm once its server answers.
func startupUpdate(exe string) (confirming bool) {
	here := filepath.Dir(exe)
	if !update.IsPortable(here) {
		return false
	}
	afterUpdate := hasFlag("--after-update")
	takeOver := afterUpdate || hasFlag("--after-rollback")
	claimEarly(here, takeOver)
	o := updateOptions(here)
	rec, err := update.Recover(here, afterUpdate, o)
	if err != nil {
		o.Log("recover: %v", err)
		if update.Pending(here) {
			// An update or its rollback is still half done: app/ may be
			// either version, missing what was carried. Nothing starts from
			// it; the next start tries again.
			fail("Mugen Studio couldn't finish an earlier update yet:\n%v\n\n"+
				"Close anything that has the Mugen Studio folder open (or restart Windows), "+
				"then start Mugen Studio again. It finishes the update first.", err)
		}
	}
	if rec == update.Confirming {
		watchedLaunch = afterUpdate
		return true
	}
	if !takeOver && update.Staged(here) != "" {
		switch out, err := update.Run(here, o); out {
		case update.Applied, update.RolledBack, update.Crashed:
			// The new version runs (or the old one was started again).
			os.Exit(0)
		case update.Stuck:
			stuck(err)
		default:
			if err != nil {
				o.Log("update not applied: %v", err)
			}
		}
	}
	return false
}

// watchedLaunch: this is the new version's first launch AND the old
// launcher is waiting for it (--after-update), so a failure here is that
// launcher's to roll back. False on a confirming launch nobody waits for.
var watchedLaunch bool

// stuck: the new version failed and the old one could not be put back yet.
// The journal says so; the next start finishes it. Never returns.
func stuck(err error) {
	fail("The update didn't work, and putting the old version back didn't finish:\n%v\n\n"+
		"Close anything that has the Mugen Studio folder open (or restart Windows), "+
		"then start Mugen Studio again. It puts the old version back first.", err)
}

// applyAfterClose runs once the window has closed for "Restart to update".
// It never returns.
func applyAfterClose(here string) {
	o := updateOptions(here)
	out, err := update.Run(here, o)
	if err != nil {
		o.Log("update: %v", err)
	}
	if out == update.Stuck {
		stuck(err)
	}
	if out == update.Nothing || out == update.Blocked {
		// Nothing was swapped: the person asked for the Studio back, so it
		// comes back on the version it was, and its page says why.
		if err := o.Relaunch(here); err != nil {
			o.Log("could not start the Studio again: %v", err)
		}
	}
	os.Exit(0)
}

// claimEarly takes this folder's instance lock (instance.go) before anything
// is moved. A launcher handing over (takeOver) already holds it; this one
// takes a handle of its own, which keeps the name alive once that one exits.
func claimEarly(here string, takeOver bool) {
	h, already, err := claimInstance(instanceMutexName(filepath.Join(here, "app")))
	if err != nil {
		return
	}
	if already && !takeOver {
		if flagValue("--selftest") != "" {
			fmt.Println("selftest: Mugen Studio is already open from this folder")
			os.Exit(2)
		}
		// The launcher holding the folder may have no window at all: it is
		// swapping an update in (journal.json, not yet confirmed).
		if update.Pending(here) {
			infoBox("Mugen Studio is updating. It opens again in a moment.")
		} else {
			alreadyOpen()
		}
		os.Exit(0)
	}
	instanceMutex = h
}

func updateOptions(here string) update.Options {
	logPath := ""
	if s := settingsDir(filepath.Join(here, "app")); s != "" {
		logPath = filepath.Join(s, "logs", "update.log")
	}
	return update.Options{
		Log: func(format string, a ...any) {
			if logPath == "" {
				return
			}
			_ = os.MkdirAll(filepath.Dir(logPath), 0o755)
			f, err := os.OpenFile(logPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
			if err != nil {
				return
			}
			defer f.Close()
			fmt.Fprintf(f, "%s  %s\n", time.Now().Format("2006-01-02 15:04:05"), fmt.Sprintf(format, a...))
		},
		Spawn: func(root string) (update.Child, error) {
			cmd := exec.Command(filepath.Join(root, update.LauncherEx), "--after-update")
			cmd.Dir = root
			return update.StartInJob(cmd)
		},
		Relaunch: func(root string) error {
			cmd := exec.Command(filepath.Join(root, update.LauncherEx), "--after-rollback")
			cmd.Dir = root
			return cmd.Start()
		},
	}
}

// failNew is fail() for the new version's first launch. With the old
// launcher waiting (--after-update): no box for a person to dismiss, just
// the reason for it to roll back. With nobody waiting (it was killed, the PC
// restarted): this launch rolls back itself and starts the old version, so
// a double-click never ends in nothing.
func failNew(confirming bool, format string, a ...any) {
	if !confirming {
		fail(format, a...)
	}
	exe, _ := os.Executable()
	here := filepath.Dir(exe)
	reason := strings.TrimSpace(strings.SplitN(fmt.Sprintf(format, a...), "\n\nEverything it said", 2)[0])
	o := updateOptions(here)
	if err := failRetry(here, reason); err != nil {
		o.Log("fail: %v", err)
	}
	if watchedLaunch {
		os.Exit(1)
	}
	o.Log("the new version failed with nobody waiting: rolling back (%s)", reason)
	if err := update.Rollback(here, "rolledBack", reason, o); err != nil {
		stuck(err)
	}
	// The old MugenStudio.exe is back beside app/; it takes this folder's
	// instance over (--after-rollback) and its page says why.
	if err := o.Relaunch(here); err != nil {
		fail(format, a...)
	}
	os.Exit(0)
}

// confirmRetry and failRetry: the launcher waiting for this one reads the
// journal every 200 ms; a write that still loses (writeJSON retries 3 s
// itself) is tried twice more rather than let a working update be rolled
// back, or a broken one wait out the 90 s.
func confirmRetry(here string) error { return retryWrite(func() error { return update.Confirm(here) }) }
func failRetry(here, reason string) error {
	return retryWrite(func() error { return update.Fail(here, reason) })
}
func retryWrite(f func() error) error {
	var err error
	for i := 0; i < 3; i++ {
		if err = f(); err == nil {
			return nil
		}
		time.Sleep(500 * time.Millisecond)
	}
	return err
}

func hasFlag(name string) bool {
	for _, a := range os.Args[1:] {
		if a == name {
			return true
		}
	}
	return false
}
