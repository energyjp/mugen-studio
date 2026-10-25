package main

import (
	"runtime"
	"syscall"
	"unsafe"
)

// THE BOX THAT OFFERS A RESTART when the server stops by itself (main.go).
//
// A plain Windows message box, because it has to work whatever state the page
// is in - including the error page a WebView shows when its server went away
// mid-load. Its Yes and No are renamed Restart and Close as it opens (a CBT
// hook on the thread that shows it, the standard way to relabel a message
// box). If the renaming ever fails, the box still reads right: its last line
// is the question "Restart it now?".
//
// Shown on a thread of its own, owned by the Studio window, the way
// pickFolder shows the folder dialog: the window's own thread keeps pumping
// messages - a modal loop on it drops the thread messages w.Dispatch posts -
// while the box still blocks input to the window.

var (
	procMessageBoxW         = user32.NewProc("MessageBoxW")
	procSetWindowsHookExW   = user32.NewProc("SetWindowsHookExW")
	procUnhookWindowsHookEx = user32.NewProc("UnhookWindowsHookEx")
	procCallNextHookEx      = user32.NewProc("CallNextHookEx")
	procSetDlgItemTextW     = user32.NewProc("SetDlgItemTextW")
	procGetClassNameW       = user32.NewProc("GetClassNameW")
)

const (
	whCBT           = 5
	hcbtActivate    = 5
	mbYesNo         = 0x04
	mbIconWarning   = 0x30
	mbSetForeground = 0x10000
	idYes           = 6
	idNo            = 7
)

// relabelButtons runs for every CBT event on the box's thread while the box is
// up; HCBT_ACTIVATE on a dialog-class window is the box, its buttons made.
var relabelButtons = syscall.NewCallback(func(code, wparam, lparam uintptr) uintptr {
	if int32(code) == hcbtActivate && isDialogWindow(wparam) {
		setDlgText(wparam, idYes, "&Restart")
		setDlgText(wparam, idNo, "&Close")
	}
	r, _, _ := procCallNextHookEx.Call(0, code, wparam, lparam)
	return r
})

func isDialogWindow(hwnd uintptr) bool {
	var name [16]uint16
	n, _, _ := procGetClassNameW.Call(hwnd, uintptr(unsafe.Pointer(&name[0])), uintptr(len(name)))
	return syscall.UTF16ToString(name[:n]) == "#32770"
}

func setDlgText(hwnd uintptr, id int, text string) {
	p, err := syscall.UTF16PtrFromString(text)
	if err != nil {
		return
	}
	procSetDlgItemTextW.Call(hwnd, uintptr(id), uintptr(unsafe.Pointer(p)))
}

// askRestart shows the box and reports whether Restart was chosen. It blocks
// until the box is answered, so call it from a goroutine of its own.
func askRestart(owner uintptr, text string) bool {
	// The hook and the box must share one OS thread.
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	tid, _, _ := procGetCurrentThreadIdTw.Call()
	if hook, _, _ := procSetWindowsHookExW.Call(whCBT, relabelButtons, 0, tid); hook != 0 {
		defer procUnhookWindowsHookEx.Call(hook)
	}
	msg, _ := syscall.UTF16PtrFromString(text)
	title, _ := syscall.UTF16PtrFromString("Mugen Studio")
	r, _, _ := procMessageBoxW.Call(owner, uintptr(unsafe.Pointer(msg)), uintptr(unsafe.Pointer(title)),
		mbYesNo|mbIconWarning|mbSetForeground)
	return r == idYes
}
