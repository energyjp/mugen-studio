// WHERE DOWNLOADS LAND.
//
// The Studio's GIF button hands the page a blob and an <a download>, and
// WebView2 - which is Edge - does what Edge does with it: the download flyout,
// then the Windows Downloads folder. The flyout is worth keeping; "locate file"
// one click away is the whole reason it feels right. So this moves the
// DESTINATION only and leaves the download pipeline alone.
//
// The supported way to do that is ICoreWebView2Profile::put_DefaultDownloadFolderPath,
// introduced in WebView2 1.0.1210.39. Microsoft documents it as persisted in the
// user data folder across sessions, applied immediately, and creating a missing
// directory at the next download.
//
// Reaching it is the awkward part, and it is awkward in exactly one place.
// go-webview2 stores its *edge.Chromium in an unexported field of an unexported
// struct (webview.go:52) and its WebView interface exposes nothing that reaches
// it - so chromiumOf reads that field through reflect. From there everything is
// ordinary COM of the same kind native.go already does in production for the
// folder picker and the taskbar: Chromium.GetICoreWebView2_3() is EXPORTED and
// hands back a live COM pointer (ICoreWebView2_3.go:58), and every COM object
// answers QueryInterface at slot 0, so which interface it happens to be does
// not matter - it is only a way in.
//
// THE ALTERNATIVE WAS MEASURED AND REJECTED. Seeding Chromium's own Preferences
// JSON (download.default_directory) in the profile folder does work - it was
// proven end to end against this runtime, with a negative control - but it
// applies only on the NEXT launch, and default_directory alone is silently
// discarded when the chosen folder is the Desktop: DownloadPrefs gates a forced
// reset on download.directory_upgrade, and DownloadPathIsDangerous returns true
// for the desktop on Windows. Desktop is one of the two folders anyone picks.
package main

import (
	"reflect"
	"syscall"
	"unsafe"

	"github.com/jchv/go-webview2"
	"github.com/jchv/go-webview2/pkg/edge"
)

// A wrong IID is harmless: QueryInterface answers E_NOINTERFACE, we get nil and
// the feature is simply off. A wrong INDEX is not harmless, which is why the
// read-only getter below exists and is run before the setter is ever trusted.
var (
	iidCoreWebView2_13 = guid{0xF75F09A8, 0x667E, 0x4983, [8]byte{0x88, 0xD6, 0xC8, 0x77, 0x3F, 0x31, 0x5E, 0x84}}

	shell32                  = syscall.NewLazyDLL("shell32.dll")
	procSHGetKnownFolderPath = shell32.NewProc("SHGetKnownFolderPath")
	// FOLDERID_Downloads
	folderidDownloads = guid{0x374DE290, 0x123F, 0x4565, [8]byte{0x91, 0x64, 0x39, 0xC4, 0x92, 0x5E, 0x46, 0x7B}}
)

const (
	idxQueryInterface = 0 // IUnknown

	// ICoreWebView2_13::get_Profile. Every derived interface appends to the one
	// before it, so the slot is the running total of the whole chain:
	//     3 IUnknown
	//  + 58 ICoreWebView2  (counted from pkg/edge/corewebview2.go iCoreWebView2Vtbl,
	//                       and proven in production - the library itself calls
	//                       AddWebResourceRequested at 52 through this vtable)
	//  +  7 _2  +  5 _3    (ICoreWebView2_2.go, ICoreWebView2_3.go)
	//  +  4 _4  +  2 _5  + 1 _6 + 1 _7 + 7 _8
	//  +  9 _9  +  2 _10 + 3 _11 + 3 _12
	//  = 105
	idxGetProfile = 105

	// ICoreWebView2Profile, in DECLARATION order. Microsoft's reference page
	// lists members alphabetically; that is not vtable order, do not use it.
	idxGetDefaultDownloadFolderPath = 6
	idxPutDefaultDownloadFolderPath = 7
)

// chromiumOf digs the edge.Chromium out of a webview2.WebView.
//
// There is no honest way in - the library keeps it unexported - so this reads
// the field and never writes it. Every failure returns nil, which only means
// the feature is off and downloads keep going wherever Windows sends them.
// studio-go/go.mod pins one exact version of the library, so the shape this
// depends on cannot drift underneath us by accident.
func chromiumOf(w webview2.WebView) *edge.Chromium {
	rv := reflect.ValueOf(w)
	if rv.Kind() != reflect.Ptr || rv.IsNil() {
		return nil
	}
	el := rv.Elem()
	if el.Kind() != reflect.Struct {
		return nil
	}
	f := el.FieldByName("browser")
	if !f.IsValid() || !f.CanAddr() {
		return nil
	}
	c, _ := reflect.NewAt(f.Type(), unsafe.Pointer(f.UnsafeAddr())).Elem().Interface().(*edge.Chromium)
	return c
}

// webviewProfile returns the WebView2 profile object, or 0 when this runtime is
// older than the Profile API or anything on the way failed.
//
// UI THREAD ONLY, and only once the window exists. Called once at startup and
// the handle kept; each call takes references on the interfaces it walks.
func webviewProfile(w webview2.WebView) uintptr {
	c := chromiumOf(w)
	if c == nil {
		return 0
	}
	wv3 := c.GetICoreWebView2_3()
	if wv3 == nil {
		return 0
	}
	obj := uintptr(unsafe.Pointer(wv3))

	var wv13 uintptr
	if vcall(obj, idxQueryInterface,
		uintptr(unsafe.Pointer(&iidCoreWebView2_13)),
		uintptr(unsafe.Pointer(&wv13))) != sOK || wv13 == 0 {
		return 0
	}
	defer vcall(wv13, idxRelease)

	var prof uintptr
	if vcall(wv13, idxGetProfile, uintptr(unsafe.Pointer(&prof))) != sOK {
		return 0
	}
	return prof
}

// profileDownloadFolder reads the current destination back.
//
// This is also THE PROBE that proves idxGetProfile before put_ is trusted: a
// correct chain returns the user's real Downloads path, and anything else means
// the index is wrong. It is read-only, so running it costs nothing.
func profileDownloadFolder(prof uintptr) string {
	if prof == 0 {
		return ""
	}
	var pstr uintptr
	if vcall(prof, idxGetDefaultDownloadFolderPath, uintptr(unsafe.Pointer(&pstr))) != sOK || pstr == 0 {
		return ""
	}
	defer procCoTaskMemFree.Call(pstr)
	return syscall.UTF16ToString((*[32768]uint16)(unsafe.Pointer(pstr))[:])
}

// windowsDownloadsFolder is what "Default" has to mean once the setting has
// been used: WebView2 persists its own choice in the profile, so the getter no
// longer reports the system folder and there is nothing to go back to. Ask the
// shell - the user may have moved Downloads off C: entirely, and
// %USERPROFILE%\\Downloads is a guess that is wrong exactly for the people who
// care most about where files land.
func windowsDownloadsFolder() string {
	var p uintptr
	r, _, _ := procSHGetKnownFolderPath.Call(
		uintptr(unsafe.Pointer(&folderidDownloads)), 0, 0, uintptr(unsafe.Pointer(&p)))
	if r != sOK || p == 0 {
		return ""
	}
	defer procCoTaskMemFree.Call(p)
	return syscall.UTF16ToString((*[32768]uint16)(unsafe.Pointer(p))[:])
}

// setProfileDownloadFolder points new downloads at dir. UI THREAD ONLY.
//
// E_INVALIDARG here means the path was rejected and nothing changed, which is a
// failure the caller can actually report - the thing a Preferences-file poke
// could never do.
func setProfileDownloadFolder(prof uintptr, dir string) bool {
	if prof == 0 || dir == "" {
		return false
	}
	p, err := syscall.UTF16PtrFromString(dir)
	if err != nil {
		return false
	}
	return vcall(prof, idxPutDefaultDownloadFolderPath, uintptr(unsafe.Pointer(p))) == sOK
}
