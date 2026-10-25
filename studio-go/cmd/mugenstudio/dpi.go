package main

import "syscall"

// DPI AWARENESS, DECLARED BEFORE ANY WINDOW EXISTS.
//
// Without this the process is DPI-unaware, so Windows lies to it about the
// screen and then bitmap-stretches whatever it draws. On a 2560x1440 display at
// 125% the app is handed a 2048x1152 "screen", renders for that, and has the
// result scaled up by the compositor - which is why the text came out soft and
// squashed rather than merely small. Nothing in the page can fix that; the
// scaling happens after the page has drawn.
//
// PER_MONITOR_AWARE_V2 rather than plain system awareness: it also gets the
// non-client area and dialogs scaled correctly, and re-scales when the window
// moves to a monitor with different scaling, which matters on a laptop docked
// to an external screen.
//
// Called from an init() so it runs before main builds anything. The API is
// Windows 10 1703+; on anything older the call simply fails and the app behaves
// as it did before.
const dpiAwarenessPerMonitorV2 = ^uintptr(3) // -4 as an unsigned word

func init() {
	user32 := syscall.NewLazyDLL("user32.dll")
	if p := user32.NewProc("SetProcessDpiAwarenessContext"); p.Find() == nil {
		p.Call(dpiAwarenessPerMonitorV2)
	}
}
