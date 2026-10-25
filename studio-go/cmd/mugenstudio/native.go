// The things a browser tab cannot do: a real folder picker that hands back an
// absolute path, and a taskbar progress bar.
//
// Both are COM, reached through syscall rather than cgo - the same reason the
// window itself needs no C compiler. Calling a COM method by hand means
// indexing its vtable, so every index below is written next to the interface it
// belongs to; get one wrong and you call a different method with the same
// argument count.
//
// For the shell interfaces below that only misbehaves. It is NOT true of the
// WebView2 vtable in download.go, where the neighboring slot hands back a
// string pointer and calling a method on it crashes - which is why the index
// there is proven with a read-only getter before anything writes through it.
package main

import (
	"runtime"
	"syscall"
	"unsafe"
)

var (
	ole32                = syscall.NewLazyDLL("ole32.dll")
	procCoInitializeEx   = ole32.NewProc("CoInitializeEx")
	procCoUninitialize   = ole32.NewProc("CoUninitialize")
	procCoCreateInstance = ole32.NewProc("CoCreateInstance")
	procCoTaskMemFree    = ole32.NewProc("CoTaskMemFree")
)

type guid struct {
	Data1 uint32
	Data2 uint16
	Data3 uint16
	Data4 [8]byte
}

var (
	clsidFileOpenDialog = guid{0xDC1C5A9C, 0xE88A, 0x4DDE, [8]byte{0xA5, 0xA1, 0x60, 0xF8, 0x2A, 0x20, 0xAE, 0xF7}}
	iidFileOpenDialog   = guid{0xD57C7288, 0xD4AD, 0x4768, [8]byte{0xBE, 0x02, 0x9D, 0x96, 0x95, 0x32, 0xD9, 0x60}}
	clsidTaskbarList    = guid{0x56FDF344, 0xFD6D, 0x11D0, [8]byte{0x95, 0x8A, 0x00, 0x60, 0x97, 0xC9, 0xA0, 0x90}}
	iidTaskbarList3     = guid{0xEA1AFB91, 0x9E28, 0x4B86, [8]byte{0x90, 0xE9, 0x9E, 0x9F, 0x8A, 0x5E, 0xEF, 0xAF}}
)

// vcall invokes method `idx` of the COM object at `obj`. The object pointer is
// always the first argument - that is what `this` is at the ABI level.
// The window is 192 slots because ICoreWebView2_13 is a long derived chain and
// get_Profile sits at 105 (download.go). `idx` is a runtime value, so Go bounds-
// checks this rather than the compiler: too small a window is a clean panic, not
// a wild read.
func vcall(obj uintptr, idx int, args ...uintptr) uintptr {
	vtbl := *(**[192]uintptr)(unsafe.Pointer(obj))
	r, _, _ := syscall.SyscallN(vtbl[idx], append([]uintptr{obj}, args...)...)
	return r
}

const (
	sOK = 0

	// IUnknown
	idxRelease = 2
	// IModalWindow
	idxShow = 3
	// IFileDialog
	idxSetOptions = 9
	idxGetOptions = 10
	idxSetTitle   = 17
	idxGetResult  = 20
	// IShellItem
	idxGetDisplayName = 5
	// ITaskbarList3
	idxHrInit           = 3
	idxSetProgressValue = 9
	idxSetProgressState = 10

	fosPickFolders     = 0x00000020
	fosForceFileSystem = 0x00000040 // no virtual folders: we need a real path
	sigdnFileSysPath   = 0x80058000
)

// comScope initializes COM for the calling thread and returns the matching
// teardown. CoUninitialize must be called ONLY when this call is what
// initialized the apartment - S_FALSE means someone else already had, and
// tearing down theirs would break the caller.
func comScope() func() {
	hr, _, _ := procCoInitializeEx.Call(0, 2) // COINIT_APARTMENTTHREADED
	if hr == sOK {
		return func() { procCoUninitialize.Call() }
	}
	return func() {}
}

// pickFolder shows the standard Windows folder chooser and returns an absolute
// path, or "" if the user canceled.
//
// This is the piece a browser genuinely cannot provide: a file input hands back
// file CONTENT and a relative name, never a path on disk, which is the whole
// reason the Studio has a "paste a path" box at all.
//
// It runs on its own locked OS thread with its own apartment rather than on the
// UI thread, whose apartment belongs to WebView2. The owner window is passed to
// Show, so it is still modal to the Studio.
func pickFolder(owner uintptr, title string) string {
	out := make(chan string, 1)
	go func() {
		runtime.LockOSThread()
		defer runtime.UnlockOSThread()
		defer comScope()()
		out <- pickFolderSync(owner, title)
	}()
	return <-out
}

func pickFolderSync(owner uintptr, title string) string {
	var dlg uintptr
	hr, _, _ := procCoCreateInstance.Call(
		uintptr(unsafe.Pointer(&clsidFileOpenDialog)), 0,
		1, // CLSCTX_INPROC_SERVER
		uintptr(unsafe.Pointer(&iidFileOpenDialog)),
		uintptr(unsafe.Pointer(&dlg)))
	if hr != sOK || dlg == 0 {
		return ""
	}
	defer vcall(dlg, idxRelease)

	var opts uint32
	vcall(dlg, idxGetOptions, uintptr(unsafe.Pointer(&opts)))
	vcall(dlg, idxSetOptions, uintptr(opts|fosPickFolders|fosForceFileSystem))

	if title != "" {
		if t, err := syscall.UTF16PtrFromString(title); err == nil {
			vcall(dlg, idxSetTitle, uintptr(unsafe.Pointer(t)))
		}
	}

	// Non-zero from Show is the cancel path as much as the error path
	// (HRESULT_FROM_WIN32(ERROR_CANCELLED)); neither gives us a folder.
	if vcall(dlg, idxShow, owner) != sOK {
		return ""
	}

	var item uintptr
	if vcall(dlg, idxGetResult, uintptr(unsafe.Pointer(&item))) != sOK || item == 0 {
		return ""
	}
	defer vcall(item, idxRelease)

	var pstr uintptr
	if vcall(item, idxGetDisplayName, sigdnFileSysPath, uintptr(unsafe.Pointer(&pstr))) != sOK || pstr == 0 {
		return ""
	}
	defer procCoTaskMemFree.Call(pstr)
	return syscall.UTF16ToString((*[32768]uint16)(unsafe.Pointer(pstr))[:])
}

// ---- taskbar progress -------------------------------------------------------

type taskbar struct{ obj uintptr }

func newTaskbar() *taskbar {
	var obj uintptr
	hr, _, _ := procCoCreateInstance.Call(
		uintptr(unsafe.Pointer(&clsidTaskbarList)), 0, 1,
		uintptr(unsafe.Pointer(&iidTaskbarList3)),
		uintptr(unsafe.Pointer(&obj)))
	if hr != sOK || obj == 0 {
		return nil
	}
	// HrInit must run before any other method, and it is what actually connects
	// to the shell - skipping it makes every later call fail silently.
	if vcall(obj, idxHrInit) != sOK {
		vcall(obj, idxRelease)
		return nil
	}
	return &taskbar{obj: obj}
}

const (
	tbpfNoProgress    = 0x0
	tbpfIndeterminate = 0x1
	tbpfNormal        = 0x2
	tbpfError         = 0x4
)

// set drives the taskbar button. `pct` below zero means indeterminate - the
// scrolling bar - which is the honest display for the export, because it is one
// blocking call that reports nothing until it is finished. A determinate bar
// would need the exporter to report progress, and inventing a percentage that
// does not track anything is worse than admitting the work is unmeasured.
func (t *taskbar) set(hwnd uintptr, state string, pct float64) {
	if t == nil || hwnd == 0 {
		return
	}
	switch state {
	case "working":
		if pct < 0 {
			vcall(t.obj, idxSetProgressState, hwnd, tbpfIndeterminate)
		} else {
			vcall(t.obj, idxSetProgressState, hwnd, tbpfNormal)
			if pct > 100 {
				pct = 100
			}
			vcall(t.obj, idxSetProgressValue, hwnd, uintptr(pct*10), uintptr(1000))
		}
	case "error":
		vcall(t.obj, idxSetProgressState, hwnd, tbpfError)
		vcall(t.obj, idxSetProgressValue, hwnd, uintptr(1000), uintptr(1000))
	default: // "done", "" and anything unrecognized clear it
		vcall(t.obj, idxSetProgressState, hwnd, tbpfNoProgress)
	}
}
