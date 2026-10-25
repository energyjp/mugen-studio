// MugenStudio.exe - a native Windows window for Mod Studio.
//
// The Studio's interface is HTML, but that is an implementation detail of the
// UI, not a reason for the program to be a browser tab. This is the window: a
// real HWND with a real title bar and a real taskbar entry, hosting the page
// through WebView2 (the runtime is part of Windows 10/11, so there is nothing
// to install). The same arrangement VS Code and Discord use.
//
// It is pure Go - no cgo, so no C compiler - and about 4MB. The server behind
// it is a separate process, spawned hidden and killed when the window closes.
//
// WHY A CHILD PROCESS AND NOT ONE BINARY: the server is the existing Node
// program, unchanged. Rewriting it in Go to get one file would mean
// reimplementing SFF decoding, the VFS, the packer and the exporters - and Mod
// Studio ships soon. This adds a window; it changes nothing about how a build
// is made.
package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"syscall"
	"time"
	"unsafe"

	"github.com/jchv/go-webview2"
)

const serverExe = "studio-server.exe"

// freePort asks the OS for a port instead of hoping 8934 is free.
//
// The whole class of "the .exe doesn't open" goes away here: there is no fixed
// port to collide with, so a second window, a running dev server, or anything
// else on 8934 simply does not matter. The kernel will not hand the same port
// to two listeners, and the gap between closing this listener and the server
// binding is small enough that nothing realistically claims it in between.
// PreferredPort keeps the Studio's URL the SAME between launches.
//
// A fresh random port every time meant a browser tab from an earlier session
// always failed - the tab said ERR_CONNECTION_REFUSED for a port nothing was on
// any more - and no bookmark could ever work. Deliberately not 8934, which the
// development server uses, so both can run at once.
const PreferredPort = 8951

// choosePort takes the preferred port when it is free and any free one when it
// is not, so the URL is stable in the normal case without ever colliding.
func choosePort() (int, error) {
	if l, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", PreferredPort)); err == nil {
		l.Close()
		return PreferredPort, nil
	}
	return freePort()
}

func freePort() (int, error) {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return 0, err
	}
	defer l.Close()
	return l.Addr().(*net.TCPAddr).Port, nil
}

// browserOpen is openInBrowser (toolwindow.go: ShellExecute); a test swaps it
// to see exactly what would reach the shell.
var browserOpen = openInBrowser

// openOwnPage hands a page of our own server to the real browser. Only our
// own server: a URL arriving from page script is not something to hand to the
// shell unexamined, however local this all looks. And never through
// "cmd /c start": cmd split the read-only build's Play a match address
// (p1=..&p2=..&stage=..&loadmotif=1) at its first &, so the browser opened
// p1 alone and cmd ran "p2" as a command.
func openOwnPage(target, origin string) bool {
	if !strings.HasPrefix(target, origin) {
		return false
	}
	browserOpen(target)
	return true
}

// afterRestart runs on the UI thread once a server restart has reloaded the
// page; set only by --selftest-restart.
var afterRestart func()

// fail puts the message in a window. There is no console in a -H windowsgui
// build, so anything written to stderr is written to nobody - which is the
// same mistake that made the first version of this look like it did not open.
func fail(format string, a ...any) {
	msg, _ := syscall.UTF16PtrFromString(fmt.Sprintf(format, a...))
	title, _ := syscall.UTF16PtrFromString("Mugen Studio")
	syscall.NewLazyDLL("user32.dll").NewProc("MessageBoxW").Call(
		0, uintptr(unsafe.Pointer(msg)), uintptr(unsafe.Pointer(title)), 0x10) // MB_ICONERROR
	os.Exit(1)
}

func main() {
	exe, err := os.Executable()
	if err != nil {
		fail("Cannot locate the program: %v", err)
	}
	app := appDir(exe)

	server := filepath.Join(app, serverExe)
	if _, err := os.Stat(server); err != nil {
		fail("%s is missing.\n\nExpected it in:\n%s\n\n"+
			"Put this program in the Studio folder, or put a studio.path file\n"+
			"beside it containing that folder's path.", serverExe, app)
	}

	// One window per app folder (instance.go): a second one would start a
	// second server on the same bundle. A mutex that cannot be made at all
	// does not stop the launch - that was the old behavior, not a new risk.
	if h, already, err := claimInstance(instanceMutexName(app)); err == nil {
		if already {
			if flagValue("--selftest") != "" {
				// No box for a script to wait on.
				fmt.Println("selftest: Mugen Studio is already open from this folder")
				os.Exit(2)
			}
			alreadyOpen()
			os.Exit(0)
		}
		instanceMutex = h
	}

	port, err := choosePort()
	if err != nil {
		fail("Could not get a free port: %v", err)
	}

	// The server, which this window can also restart (server.go). Its output
	// goes to studio-server.log in a portable copy's Settings\logs\, or in
	// logs\ beside this program (serverlog.go).
	srv := newStudioServer(server, app, port)
	logPath := serverLogPath(exe, app)
	srv.logPath = logPath
	if err := srv.start(); err != nil {
		fail("Could not start %s:\n%v", serverExe, err)
	}
	// Kill the server whichever way we leave - a normal close, a panic, or a
	// failed startup. An orphaned server holding a port and a lock on the
	// content is exactly the state that makes the next launch mysterious.
	defer srv.kill()

	// The origin is what the guard below compares against; the studio page is
	// just where the window starts. Comparing against the full page URL rejected
	// /ikemen/index.html, which is the one thing the button exists to open.
	origin := fmt.Sprintf("http://127.0.0.1:%d/", port)
	url := origin + "studio.html"
	if !srv.ready(url, 25*time.Second) {
		srv.kill()
		if tail := serverLogTail(logPath, 8); tail != "" {
			fail("The Studio did not start within 25 seconds.\n\nThe last thing it said:\n%s\n\nEverything it said is in:\n%s", tail, logPath)
		}
		fail("The Studio did not start within 25 seconds.\n\nRun %s on its own to see what it says.", serverExe)
	}

	// KEEP THE BROWSER CACHE IN THE APP FOLDER.
	//
	// Left alone, go-webview2 puts it in %APPDATA%\MugenStudio.exe (pkg/edge/
	// chromium.go:84) - Roaming, not even Local - where it had already grown to
	// 38MB of EBWebView during testing. Nothing about this program should live
	// somewhere you would not think to look for it, and nothing it leaves behind
	// should survive deleting the folder it came in.
	w := webview2.NewWithOptions(webview2.WebViewOptions{
		DataPath:  filepath.Join(app, "webview-data"),
		AutoFocus: true,
		WindowOptions: webview2.WindowOptions{
			Title:  "Mugen Studio",
			Width:  1400,
			Height: 900,
			Center: true,
		},
	})
	if w == nil {
		fail("Could not create the window.\n\nWebView2 is missing - it ships with Windows 10 and 11,\nor install the Evergreen Runtime from Microsoft.")
	}
	defer w.Destroy()

	// WHERE DOWNLOADS LAND - see download.go. READ ONLY for now: this getter is
	// the probe that proves the vtable index before anything writes through it.
	// It must run after NewWithOptions (the webview is live by then, because
	// webview.go:113 dereferences it) and on this thread, which is already the
	// locked COM/UI thread.
	// PROVEN BEFORE IT WAS TRUSTED: the getter returned this machine's real
	// Downloads path, which is only possible if the whole chain - the reflect
	// into go-webview2, the QueryInterface for ICoreWebView2_13, get_Profile at
	// slot 105 - is right.
	dlProfile := webviewProfile(w)
	w.Bind("nativeDownloadFolder", func() string { return profileDownloadFolder(dlProfile) })
	w.Bind("nativeDefaultDownloadFolder", func() string { return windowsDownloadsFolder() })

	// The page owns the setting and pushes it here; nothing in this process
	// reads the Studio's JSON, so there is no second implementation of where
	// folders live to drift from layout.js. Bound callbacks already run on the
	// UI thread (see the note above), so this may call COM directly.
	//
	// Returns what the profile reports AFTERWARDS rather than a bare true: an
	// E_INVALIDARG path leaves the old value in place, and the page should show
	// what is actually in force, not what it asked for.
	w.Bind("nativeSetDownloadFolder", func(dir string) (string, error) {
		if dir == "" {
			return "", errors.New("no folder given")
		}
		// Native separators, so what the profile stores and what the Studio
		// shows look like a Windows path rather than whatever the picker or a
		// hand-typed setting happened to use.
		dir = filepath.Clean(dir)
		// Made now rather than at the next download, so a path that cannot
		// exist is an error the user sees while the picker is still in mind.
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return "", fmt.Errorf("that folder could not be created: %w", err)
		}
		if !setProfileDownloadFolder(dlProfile, dir) {
			// E_INVALIDARG: the old value is still in force.
			return "", errors.New("WebView2 rejected that path")
		}
		return profileDownloadFolder(dlProfile), nil
	})

	// WHAT THE WINDOW GIVES THE PAGE THAT A BROWSER CANNOT.
	//
	// Bound before Navigate, because a binding added afterwards is not there
	// when the page's own scripts run and feature-detect it. The page checks for
	// each of these and does without them in a browser, so studio.html stays one
	// file that works in both places.
	hwnd := uintptr(w.Window())
	// The title bar, taskbar and Alt+Tab icon, loaded from THIS BINARY'S OWN
	// icon resource so the window always matches what Explorer shows for the
	// file. Silently skipped if the resource is missing (icon.go).
	setWindowIcon(hwnd)
	// The tool windows this page opens (Select Screen, Moves, Palettes, the
	// animation editor and player) become windows of this program, drawing
	// text as crisply as this one - see toolwindow.go. Same data folder as
	// above: they share the main window's browser process and profile.
	installToolWindows(w, origin, filepath.Join(app, "webview-data"))
	tb := newTaskbar()

	// An absolute path, which is the thing an <input type=file> will not give
	// you at any price - it hands back content and a bare name. This is what
	// makes the "paste a path on this PC" box unnecessary.
	//
	// ASYNCHRONOUS, AND IT HAS TO BE. Bound callbacks run on the UI THREAD -
	// go-webview2's msgcb is the WebView2 message handler and calls straight
	// into the bound function - so waiting here for a dialog stops the window
	// pumping messages. That is not "modal", it is FROZEN: the title bar stops
	// responding, and Windows reports the process as not responding, which is
	// exactly what happened.
	//
	// So this returns a ticket immediately and the answer arrives later through
	// __folderResult. The dialog still belongs to this window and still blocks
	// input to it, which is what modal should mean; the difference is that the
	// window is alive while it is up.
	var folderSeq int64
	w.Bind("nativePickFolder", func(title string) float64 {
		if title == "" {
			title = "Choose a folder"
		}
		id := atomic.AddInt64(&folderSeq, 1)
		go func() {
			path := pickFolder(hwnd, title)
			b, _ := json.Marshal(path)
			w.Dispatch(func() {
				w.Eval(fmt.Sprintf("window.__folderResult&&window.__folderResult(%d,%s)", id, b))
			})
		}()
		return float64(id)
	})

	w.Bind("nativeProgress", func(state string, pct float64) bool {
		tb.set(hwnd, state, pct)
		return tb != nil
	})

	// THE REAL BROWSER, not another WebView. window.open() inside WebView2
	// spawns a bare popup with no address bar, no tabs and no devtools - which
	// is a poor thing to test a web build in, and was the "new window" that made
	// the last prototype feel wrong. This hands the URL to the OS instead, so
	// the game opens as a tab in whatever browser the player actually uses.
	//
	// The server is already up: the window started it before this page loaded,
	// so there is nothing to wait for.
	w.Bind("nativeOpenBrowser", func(target string) bool {
		return openOwnPage(target, origin)
	})

	// A BUNDLE SWITCH WITHOUT CLOSING THE STUDIO. The page has already chosen
	// the bundle (layout.js: studio-layout.json, or Settings\studio-settings.json
	// in a portable copy) and made sure nothing open holds unsaved
	// work; this closes the tool windows - their pages show the bundle that is
	// going away - restarts the server (server.go) and reloads the page.
	//
	// Asynchronous, for the reason nativePickFolder is: bound callbacks run on
	// the UI thread, and a restart takes a second or two. The answer is the
	// reload itself, or window.__serverRestartFailed(message) when the server
	// did not come back. False when a restart is already under way.
	var restarting int32
	w.Bind("nativeRestartServer", func() bool {
		if !atomic.CompareAndSwapInt32(&restarting, 0, 1) {
			return false
		}
		closeToolWindows()
		go func() {
			err := srv.restart(url)
			w.Dispatch(func() {
				atomic.StoreInt32(&restarting, 0)
				if err != nil {
					b, _ := json.Marshal(err.Error())
					w.Eval("window.__serverRestartFailed&&window.__serverRestartFailed(" + string(b) + ")")
					return
				}
				w.Navigate(url)
				if afterRestart != nil {
					afterRestart()
				}
			})
		}()
		return true
	})

	// THE SERVER STOPPED BY ITSELF. The window used to go on as if nothing had
	// happened - the page stayed up and every click said "Failed to fetch". Now
	// it says so and offers Restart: a new server on the same port, the pages
	// left as they are (a tool window's unsaved work included), so the next
	// click simply works. Close ends the Studio. A restart that fails asks
	// again, with what the server said.
	//
	// The box runs on a thread of its own (crash.go); crashBox keeps it to one
	// at a time, and `restarting` keeps this and a bundle switch from
	// restarting at once.
	var crashBox int32
	var offerRestart func(msg string)
	offerRestart = func(msg string) {
		if !atomic.CompareAndSwapInt32(&crashBox, 0, 1) {
			return
		}
		go func() {
			again := askRestart(hwnd, msg)
			atomic.StoreInt32(&crashBox, 0)
			if !again {
				// PostQuitMessage only ends the loop of the thread that calls it.
				w.Dispatch(func() { w.Terminate() })
				return
			}
			if !atomic.CompareAndSwapInt32(&restarting, 0, 1) {
				return
			}
			err := srv.restart(url)
			atomic.StoreInt32(&restarting, 0)
			if err != nil {
				offerRestart(crashMessage("It did not start again: "+err.Error()+".", serverLogTail(logPath, 8), logPath))
			}
		}()
	}
	srv.watch(func(err error) {
		offerRestart(crashMessage(exitWords(err), serverLogTail(logPath, 8), logPath))
	})

	// Clear the taskbar on the way out; a progress state outlives the export
	// that set it and would otherwise be the last thing left on screen if an
	// export were interrupted.
	defer func() { tb.set(hwnd, "done", 0) }()

	// --selftest evaluates one expression in the loaded page, prints the result
	// and exits.
	//
	// It exists because the window is otherwise unobservable from outside: with
	// no console and no reliable way to attach a debugger, the only ways to check
	// what the page actually did are to look at it or to ask it. This asks it, so
	// a change to the Studio's native-only behavior can be verified rather than
	// assumed.
	//
	// --selftest-restart is a second expression for a test that restarts the
	// server (nativeRestartServer): evaluated in the RELOADED page, 4 seconds
	// after the restart, and its report is the one that ends the run.
	if expr := flagValue("--selftest"); expr != "" {
		done := make(chan struct{})
		want, got := int32(1), int32(0)
		limit := 40 * time.Second
		if expr2 := flagValue("--selftest-restart"); expr2 != "" {
			want, limit = 2, 90*time.Second
			afterRestart = func() {
				go func() {
					time.Sleep(4 * time.Second)
					w.Dispatch(func() {
						w.Eval("try{Promise.resolve(" + expr2 + ").then(v=>selftestReport(JSON.stringify(v)))" +
							".catch(e=>selftestReport('REJECTED '+e.message))}catch(e){selftestReport('ERROR '+e.message)}")
					})
				}()
			}
		}
		w.Bind("selftestReport", func(v string) bool {
			fmt.Println(v)
			if atomic.AddInt32(&got, 1) == want {
				close(done)
			}
			return true
		})
		go func() {
			<-done
			// Let the bound call return before the window goes away.
			time.Sleep(150 * time.Millisecond)
			w.Dispatch(func() { w.Terminate() })
		}()
		go func() {
			// The page has to finish loading and running its own scripts first;
			// there is no load event reachable from here.
			time.Sleep(4 * time.Second)
			w.Dispatch(func() {
				// Promise.resolve so an async expression is awaited: without it a
				// promise stringifies to "{}", which looks like an empty result
				// rather than a mistake in the harness.
				w.Eval("try{Promise.resolve(" + expr + ").then(v=>selftestReport(JSON.stringify(v)))" +
					".catch(e=>selftestReport('REJECTED '+e.message))}catch(e){selftestReport('ERROR '+e.message)}")
			})
		}()
		// A window that never reports must not hang a script forever.
		go func() {
			time.Sleep(limit)
			fmt.Printf("selftest: no report within %v\n", limit)
			// The server too: os.Exit skips the deferred kill.
			srv.kill()
			os.Exit(2)
		}()
	}

	w.Navigate(url)
	w.Run() // returns when the user closes the window
}

// appDir is where the Studio's files live: normally beside this program, but
// somewhere else when a studio.path file says so.
//
// That file exists so the program can sit in a folder of its own. The working
// tree it is built in has forty other things in it - three dist directories, a
// dozen documents, the content library - and "which of these do I click" is a
// fair question to be annoyed by. With studio.path the answer can be a folder
// holding exactly two files, without copying a gigabyte of content to get there
// or letting a second copy drift away from the first.
//
// One line, the path, nothing else. A missing or unreadable file just means
// "beside me", which is what a portable build wants.
func appDir(exe string) string {
	here := filepath.Dir(exe)
	b, err := os.ReadFile(filepath.Join(here, "studio.path"))
	if err != nil {
		// No studio.path. A portable copy keeps the program in app/ beside
		// this window, so its top level reads as a product - app, Content,
		// the two Export folders, the exe, a read-me - and nothing else. A
		// checkout keeps the server beside the exe. Whichever holds it wins;
		// studio.path stays honored for anyone who already wrote one.
		for _, sub := range []string{"app", "Program"} {
			p := filepath.Join(here, sub)
			if _, err := os.Stat(filepath.Join(p, serverExe)); err == nil {
				return p
			}
		}
		return here
	}
	// First non-empty, non-comment line.
	for _, line := range strings.Split(string(b), "\n") {
		p := strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(line), "\ufeff"))
		if p == "" || strings.HasPrefix(p, "#") {
			continue
		}
		if !filepath.IsAbs(p) {
			p = filepath.Join(here, p)
		}
		if st, err := os.Stat(p); err == nil && st.IsDir() {
			return p
		}
		fail("studio.path points at\n%s\n\nwhich is not a folder.", p)
	}
	return here
}

// flagValue returns the value of --name=value or --name value.
func flagValue(name string) string {
	for i, a := range os.Args {
		if a == name && i+1 < len(os.Args) {
			return os.Args[i+1]
		}
		if strings.HasPrefix(a, name+"=") {
			return a[len(name)+1:]
		}
	}
	return ""
}
