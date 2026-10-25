// ONE WINDOW PER APP FOLDER.
//
// Two Studios on one folder both write the bundle's roster.json, and the
// loser's edits vanish without a word. studio-server.exe's own check (a
// running server on the port it was asked for) never meets a second window:
// choosePort hands every window a free port of its own, so a second
// double-click used to start a second server on the same bundle, silently.
//
// So the window takes a named mutex, keyed on the app folder, before it
// starts anything. Windows owns the name and drops it when the process ends,
// however it ends, so a crash never leaves a lock that refuses the next
// launch. Two copies in two folders are two names and both run.
package main

import (
	"crypto/sha1"
	"encoding/hex"
	"path/filepath"
	"strings"
	"syscall"
	"unsafe"
)

var procCreateMutexW = kernel32.NewProc("CreateMutexW")

const errorAlreadyExists = 183 // ERROR_ALREADY_EXISTS

// instanceMutex is the handle this process holds for its whole life; it is
// never closed (closing it would let a second window in).
var instanceMutex uintptr

// instanceMutexName names the folder, not the program: Local\ (this logon
// session) + the first 16 hex digits of sha1(the folder, cleaned and
// lowercased - Windows paths are not case-sensitive, so C:\X and c:\x are one).
func instanceMutexName(app string) string {
	sum := sha1.Sum([]byte(strings.ToLower(filepath.Clean(app))))
	return `Local\MugenStudio-` + hex.EncodeToString(sum[:])[:16]
}

// claimInstance creates (or opens) the named mutex. already is true when
// another process - or an earlier call in this one - holds the name. The
// handle is returned in both cases; a caller that stays keeps it.
func claimInstance(name string) (handle uintptr, already bool, err error) {
	p, err := syscall.UTF16PtrFromString(name)
	if err != nil {
		return 0, false, err
	}
	h, _, lastErr := procCreateMutexW.Call(0, 0, uintptr(unsafe.Pointer(p)))
	if h == 0 {
		return 0, false, lastErr
	}
	return h, lastErr == syscall.Errno(errorAlreadyExists), nil
}

// alreadyOpen says so in a window (there is no console) and leaves. Not an
// error: the Studio the person wanted is running.
func alreadyOpen() {
	msg, _ := syscall.UTF16PtrFromString("Mugen Studio is already open from this folder.")
	title, _ := syscall.UTF16PtrFromString("Mugen Studio")
	user32.NewProc("MessageBoxW").Call(0, uintptr(unsafe.Pointer(msg)), uintptr(unsafe.Pointer(title)), 0x40) // MB_ICONINFORMATION
}
