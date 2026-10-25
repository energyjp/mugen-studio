package main

import (
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"strconv"
	"sync"
	"syscall"
	"time"
)

// THE SERVER UNDER THE WINDOW, WHICH THE WINDOW CAN RESTART.
//
// A bundle switch needs a new server process: server.js resolves every folder
// once, at start (layout.js, and the modules that keep paths from it). That
// used to mean closing the Studio and opening it again. The window owns the
// process, so it does that part itself now - asks the server to go, starts a
// fresh one, and reloads the page (nativeRestartServer in main.go).
//
// ON THE SAME PORT. The page keeps its settings per address - the look, the
// last tab, E-Select's preferences - so a server on a new port would be a
// Studio that had forgotten all of them.
//
// Asking to go is closing the server's stdin (--exit-on-stdin-close): it stops
// listening, lets the API requests in flight finish, and exits. A request is
// where the Studio writes, and a write cut off halfway is a damaged roster.
// Only a server still here after the grace period is killed.
//
// A SERVER THAT STOPS BY ITSELF IS NEWS (watch). A file another program held
// open, or one bad request, used to end the process, and the window never
// noticed: the page stayed up and every click after it said "Failed to
// fetch". The window is told now, and offers a restart (main.go).
type studioServer struct {
	port int
	// spawn makes the command for one run; a field so the tests can start a
	// stand-in instead of studio-server.exe.
	spawn func(port int) *exec.Cmd
	// logPath is the file the server's output is appended to (openServerLog).
	// Empty: its output goes nowhere, as it always had.
	logPath string

	mu     sync.Mutex
	cmd    *exec.Cmd
	stdin  io.WriteCloser
	exited chan struct{}
	run    *serverRun
	// onExit hears about a run that ended by itself (watch, report).
	onExit func(err error)
}

// serverRun is what the watcher knows about one server process.
type serverRun struct {
	done  bool  // the process has exited
	err   error // what Wait said about it
	up    bool  // it answered once (ready): a Studio was running on it
	asked bool  // stop or kill ended it, so its end is no news
	told  bool  // its end has been reported
}

func newStudioServer(path, dir string, port int) *studioServer {
	return &studioServer{port: port, spawn: func(port int) *exec.Cmd {
		// --no-open: the server has its own browser-opening path for when it is
		// run on its own. This window IS the browser, so that must stay off.
		cmd := exec.Command(path, strconv.Itoa(port), "--no-open", "--exit-on-stdin-close")
		cmd.Dir = dir
		// No console window for the child. Without this a -H windowsgui parent
		// still pops a black window for the console-subsystem child.
		cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000} // CREATE_NO_WINDOW
		return cmd
	}}
}

// start runs a new server. It does not wait for it to answer (ready).
func (s *studioServer) start() error {
	cmd := s.spawn(s.port)
	var logf *os.File
	if s.logPath != "" {
		if logf = openServerLog(s.logPath, s.port); logf != nil {
			cmd.Stdout, cmd.Stderr = logf, logf
		}
	}
	in, err := cmd.StdinPipe()
	if err == nil {
		err = cmd.Start()
	}
	// The child holds its own handle to the log now, or never will.
	if logf != nil {
		logf.Close()
	}
	if err != nil {
		return err
	}
	exited := make(chan struct{})
	run := &serverRun{}
	go func() {
		werr := cmd.Wait()
		s.mu.Lock()
		run.done, run.err = true, werr
		s.mu.Unlock()
		close(exited)
		s.report(run)
	}()
	s.mu.Lock()
	s.cmd, s.stdin, s.exited, s.run = cmd, in, exited, run
	s.mu.Unlock()
	return nil
}

// watch names who hears about a server that stops by itself, and tells them
// at once about one that already has: the server can go in the moment
// between answering and the window being there to say so.
func (s *studioServer) watch(fn func(err error)) {
	s.mu.Lock()
	s.onExit = fn
	run := s.run
	s.mu.Unlock()
	if run != nil {
		s.report(run)
	}
}

// report tells onExit, once, about a run that ended although nobody asked it
// to - and only one that had answered. A server that never came up is not
// news here: whoever started it is waiting in ready() and says why itself
// (the startup message, or a restart that failed).
func (s *studioServer) report(run *serverRun) {
	s.mu.Lock()
	fn := s.onExit
	tell := fn != nil && run.done && run.up && !run.asked && !run.told
	if tell {
		run.told = true
	}
	err := run.err
	s.mu.Unlock()
	if tell {
		go fn(err)
	}
}

// ready polls until the server answers, so the window never shows a
// connection error that is really just "not started yet". False at once when
// the server has already exited: waiting out the clock on a process that is
// gone only makes the error slower to arrive.
func (s *studioServer) ready(url string, d time.Duration) bool {
	s.mu.Lock()
	exited, run := s.exited, s.run
	s.mu.Unlock()
	deadline := time.Now().Add(d)
	c := &http.Client{Timeout: 400 * time.Millisecond}
	for time.Now().Before(deadline) {
		if r, err := c.Get(url); err == nil {
			r.Body.Close()
			if r.StatusCode == 200 {
				if run != nil {
					s.mu.Lock()
					run.up = true
					s.mu.Unlock()
					// It may have gone again already.
					s.report(run)
				}
				return true
			}
		}
		select {
		case <-exited:
			return false
		case <-time.After(80 * time.Millisecond):
		}
	}
	return false
}

// stop asks the server to go and waits until it has; after grace it is
// killed.
func (s *studioServer) stop(grace time.Duration) {
	s.mu.Lock()
	cmd, in, exited := s.cmd, s.stdin, s.exited
	s.cmd, s.stdin = nil, nil
	if s.run != nil {
		s.run.asked = true
	}
	s.mu.Unlock()
	if cmd == nil {
		return
	}
	_ = in.Close()
	select {
	case <-exited:
	case <-time.After(grace):
		_ = cmd.Process.Kill()
		<-exited
	}
}

// kill ends the server at once: the window is closing. An orphaned server
// holding a port and a lock on the content is exactly the state that makes
// the next launch mysterious.
func (s *studioServer) kill() {
	s.mu.Lock()
	cmd := s.cmd
	s.cmd, s.stdin = nil, nil
	if s.run != nil {
		s.run.asked = true
	}
	s.mu.Unlock()
	if cmd != nil && cmd.Process != nil {
		_ = cmd.Process.Kill()
	}
}

// restart stops the server, starts a new one on the same port and waits until
// it answers at url.
func (s *studioServer) restart(url string) error {
	s.stop(20 * time.Second)
	// The old process is gone, so the port is free - but wait for the listener
	// to be released rather than race it.
	if !portFree(s.port, 5*time.Second) {
		return fmt.Errorf("port %d is still in use", s.port)
	}
	if err := s.start(); err != nil {
		return err
	}
	if !s.ready(url, 25*time.Second) {
		return errors.New("the server did not start again")
	}
	return nil
}

// portFree waits until a listener can take the port.
func portFree(port int, d time.Duration) bool {
	deadline := time.Now().Add(d)
	for {
		if l, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port)); err == nil {
			l.Close()
			return true
		}
		if time.Now().After(deadline) {
			return false
		}
		time.Sleep(100 * time.Millisecond)
	}
}
