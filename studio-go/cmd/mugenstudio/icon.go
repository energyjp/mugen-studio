// The window's icon, taken from the executable's own icon resource.
//
// The .exe carries an RT_GROUP_ICON (cmd/mugenstudio/rsrc_windows_amd64.syso,
// generated from winres/icon.png by go-winres), which is what Explorer,
// shortcuts and pinned taskbar items show. A WINDOW does not automatically wear
// it: its icon comes from the window class or from WM_SETICON, and WebView2
// registers a class with none - which is why the title bar, the taskbar button
// and Alt+Tab were blank.
//
// SO THIS LOADS THE SAME RESOURCE the file icon comes from, rather than a
// second .ico on disk. Pointing the window at its own embedded icon means the
// two can never drift: change winres/icon.png, rebuild, and both follow. An
// earlier version read an .ico out of public/, which worked but left two places
// to keep in agreement and one of them shipped separately from the binary.
package main

import "syscall"

var (
	user32          = syscall.NewLazyDLL("user32.dll")
	kernel32        = syscall.NewLazyDLL("kernel32.dll")
	procLoadImageW  = user32.NewProc("LoadImageW")
	procSendMessage = user32.NewProc("SendMessageW")
	procGetModuleH  = kernel32.NewProc("GetModuleHandleW")
)

const (
	wmSetIcon = 0x0080
	iconSmall = 0
	iconBig   = 1
	imageIcon = 1
	// go-winres names the group icon #1, which is also what Windows picks as
	// the file's icon: the lowest-numbered RT_GROUP_ICON wins.
	iconResourceID = 1
)

// setWindowIcon points the window at the executable's own icon resource.
//
// SMALL AND BIG ARE LOADED SEPARATELY, at 16 and 32, rather than loading once
// and letting Windows pick. A multi-size group asked for at a single size hands
// back one image that is then scaled for the other slot, and a downscaled 32 in
// the title bar is visibly softer than the 16 the resource already contains.
//
// Every failure is silent on purpose: a missing or malformed icon is worth
// nothing more than the default one, and this runs while the user is waiting
// for a window to appear.
func setWindowIcon(hwnd uintptr) {
	if hwnd == 0 {
		return
	}
	hInst, _, _ := procGetModuleH.Call(0)
	if hInst == 0 {
		return
	}
	for _, spec := range []struct {
		size  uintptr
		which uintptr
	}{
		{16, iconSmall},
		{32, iconBig},
	} {
		// MAKEINTRESOURCE(id): the integer goes where a name POINTER goes, and
		// Windows reads anything below 0x10000 as an ordinal rather than an
		// address. No unsafe.Pointer is involved - it is a value, not a cast.
		h, _, _ := procLoadImageW.Call(
			hInst, uintptr(iconResourceID), imageIcon, spec.size, spec.size, 0)
		if h != 0 {
			procSendMessage.Call(hwnd, wmSetIcon, spec.which, h)
		}
	}
}
