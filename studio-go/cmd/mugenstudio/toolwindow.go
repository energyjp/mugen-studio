// TOOL WINDOWS ARE WINDOWS THIS PROGRAM OWNS.
//
// The Studio's tool pages - the Select Screen editor, Moves, Palettes, the
// animation editor and player - open with window.open(). Left alone, WebView2
// answers that with its own stock popup, a window the runtime owns. On a 1440p
// monitor at 125% the text in those popups came out soft next to the browser's
// own tab and address text: MEASURED, not guessed - the popup draws text with
// grayscale smoothing, letters landing between pixels with no per-channel
// sharpening, while the same page in this program's main window (and in
// headless Chrome) gets ClearType. The popup is the only difference, and the
// stock popup has no setting that changes it.
//
// So every window.open() for our own origin now lands in a window created here,
// hosting its own WebView2 controller exactly the way the main window does. The
// page still gets a real window back: the new WebView is handed over through
// put_NewWindow, so a NAME still finds the window you already have, `opener`
// still reaches the Studio, and close() from either side still closes it.
//
// A web address that is not ours (a link in the guide) goes to the real
// browser instead, the way "test in browser" does, and a mail link to the mail
// program.
//
// A tool window's page can also ask for the Studio's main window back
// (studio:raise-main, below). Its `opener` is that window's page, but
// opener.focus() from script does not bring a window of this program forward
// the way it brings a browser tab, so the program does that itself. And it can
// ask to be asked before its window closes (studio:guard-close, closeGuard),
// which is how E-Select keeps its unsaved work from going with an X or Alt+F4.
//
// Every failure falls back to the stock popup - soft text, but a window - by
// completing the request without a window of our own.
package main

import (
	"strings"
	"syscall"
	"unsafe"

	"github.com/jchv/go-webview2"
	"github.com/jchv/go-webview2/pkg/edge"
)

// Vtable slots, each the running total of its interface chain including the
// three IUnknown slots. Checked twice: against WebView2.h's declaration order,
// and (toolwindow_test.go) against the struct go-webview2 itself calls through
// in production, for the two interfaces the library declares.
const (
	idxAddRef = 1

	// ICoreWebView2
	idxAddNavigationStarting   = 7
	idxPostWebMessageAsString  = 33
	idxAddNewWindowRequested   = 44
	idxAddDocumentTitleChanged = 46
	idxGetDocumentTitle        = 48
	idxAddWindowCloseRequested = 59

	// ICoreWebView2Controller
	idxControllerClose = 24

	// ICoreWebView2NewWindowRequestedEventArgs
	idxNWGetUri             = 3
	idxNWPutNewWindow       = 4
	idxNWPutHandled         = 6
	idxNWGetIsUserInitiated = 8
	idxNWGetDeferral        = 9
	idxNWGetWindowFeatures  = 10

	// ICoreWebView2WindowFeatures
	idxWFHasSize = 4
	idxWFHeight  = 7
	idxWFWidth   = 8

	// ICoreWebView2Deferral
	idxDeferralComplete = 3
)

const (
	wmDestroy     = 0x0002
	wmMove        = 0x0003
	wmSize        = 0x0005
	wmActivate    = 0x0006
	wmClose       = 0x0010
	wmMoving      = 0x0216
	wmDpiChanged  = 0x02E0
	waInactive    = 0
	wsOverlapped  = 0x00CF0000 // WS_OVERLAPPEDWINDOW
	swShowNormal  = 1
	swRestore     = 9
	swpNoZOrder   = 0x0004
	swpNoActivate = 0x0010
	idcArrow      = 32512
	monitorNear   = 2
	eNoInterface  = 0x80004002
)

var (
	gdi32                        = syscall.NewLazyDLL("gdi32.dll")
	procRegisterClassExW         = user32.NewProc("RegisterClassExW")
	procCreateWindowExW          = user32.NewProc("CreateWindowExW")
	procDefWindowProcW           = user32.NewProc("DefWindowProcW")
	procDestroyWindow            = user32.NewProc("DestroyWindow")
	procShowWindow               = user32.NewProc("ShowWindow")
	procUpdateWindow             = user32.NewProc("UpdateWindow")
	procSetWindowTextW           = user32.NewProc("SetWindowTextW")
	procSetWindowPos             = user32.NewProc("SetWindowPos")
	procGetWindowRect            = user32.NewProc("GetWindowRect")
	procGetDpiForWindow          = user32.NewProc("GetDpiForWindow")
	procAdjustWindowRectExForDpi = user32.NewProc("AdjustWindowRectExForDpi")
	procMonitorFromWindow        = user32.NewProc("MonitorFromWindow")
	procGetMonitorInfoW          = user32.NewProc("GetMonitorInfoW")
	procGetForegroundWindow      = user32.NewProc("GetForegroundWindow")
	procSetForegroundWindow      = user32.NewProc("SetForegroundWindow")
	procSetFocus                 = user32.NewProc("SetFocus")
	procGetWindowThreadProcessId = user32.NewProc("GetWindowThreadProcessId")
	procGetGUIThreadInfo         = user32.NewProc("GetGUIThreadInfo")
	procAttachThreadInput        = user32.NewProc("AttachThreadInput")
	procGetCurrentThreadIdTw     = kernel32.NewProc("GetCurrentThreadId")
	procIsIconic                 = user32.NewProc("IsIconic")
	procIsWindow                 = user32.NewProc("IsWindow")
	procPostMessageW             = user32.NewProc("PostMessageW")
	procPostQuitMessage          = user32.NewProc("PostQuitMessage")
	procLoadCursorW              = user32.NewProc("LoadCursorW")
	procCreateSolidBrush         = gdi32.NewProc("CreateSolidBrush")
	procShellExecuteW            = shell32.NewProc("ShellExecuteW")

	// IMarshal: the one well-known interface a handler must not claim to be.
	iidIMarshal = guid{0x00000003, 0, 0, [8]byte{0xC0, 0, 0, 0, 0, 0, 0, 0x46}}
)

type winRect struct{ L, T, R, B int32 }

type monitorInfo struct {
	cbSize  uint32
	monitor winRect
	work    winRect
	flags   uint32
}

type wndClassEx struct {
	cbSize        uint32
	style         uint32
	lpfnWndProc   uintptr
	cbClsExtra    int32
	cbWndExtra    int32
	hInstance     uintptr
	hIcon         uintptr
	hCursor       uintptr
	hbrBackground uintptr
	lpszMenuName  *uint16
	lpszClassName *uint16
	hIconSm       uintptr
}

// comHandler is a WebView2 event handler: IUnknown plus Invoke(sender, args).
//
// WebView2 keeps the pointer, so every handler is also kept in liveHandlers
// for the life of the program - a few dozen bytes per window ever opened,
// against a collector freeing something native code still calls into.
type comHandler struct {
	vtbl   *[4]uintptr
	invoke func(sender, args uintptr) uintptr
}

var (
	handlerVtbl = [4]uintptr{
		syscall.NewCallback(handlerQueryInterface),
		syscall.NewCallback(func(this *comHandler) uintptr { return 1 }),
		syscall.NewCallback(func(this *comHandler) uintptr { return 1 }),
		syscall.NewCallback(func(this *comHandler, sender, args uintptr) uintptr { return this.invoke(sender, args) }),
	}
	liveHandlers []*comHandler
)

// Every interface asked for is this one handler, except IMarshal, whose
// methods it does not have. go-webview2's own handlers answer S_OK to
// everything and have run in production that way; this only declines the one
// question where "yes" would be a lie with consequences.
func handlerQueryInterface(this *comHandler, riid *guid, out *uintptr) uintptr {
	if riid != nil && *riid == iidIMarshal {
		*out = 0
		return eNoInterface
	}
	*out = uintptr(unsafe.Pointer(this))
	return sOK
}

func newHandler(f func(sender, args uintptr) uintptr) *comHandler {
	h := &comHandler{vtbl: &handlerVtbl, invoke: f}
	liveHandlers = append(liveHandlers, h)
	return h
}

func addHandler(obj uintptr, idx int, h *comHandler) {
	var token int64
	vcall(obj, idx, uintptr(unsafe.Pointer(h)), uintptr(unsafe.Pointer(&token)))
}

// comString reads an LPWSTR out-parameter and frees it.
func comString(obj uintptr, idx int) string {
	var p *uint16
	if vcall(obj, idx, uintptr(unsafe.Pointer(&p))) != sOK || p == nil {
		return ""
	}
	defer procCoTaskMemFree.Call(uintptr(unsafe.Pointer(p)))
	var s []uint16
	for q := unsafe.Pointer(p); *(*uint16)(q) != 0; q = unsafe.Add(q, 2) {
		s = append(s, *(*uint16)(q))
	}
	return syscall.UTF16ToString(s)
}

type toolWindow struct {
	hwnd     uintptr
	chromium *edge.Chromium
	wv       uintptr // the window's ICoreWebView2
	guard    closeGuard
}

// A TOOL WINDOW'S CLOSE CAN BE ASKED ABOUT FIRST.
//
// E-Select popped out holds unsaved work, and its window's X or Alt+F4 used
// to close it without a word: the window is this program's, and a page cannot
// stop it closing. So a page may opt in. It posts studio:guard-close (armed);
// a close (WM_CLOSE) then becomes studio:close-request posted to the page, and
// the window stays. The page answers with its own Exit routine - the
// unsaved-changes question, or straight to window.close(), which arrives as
// WindowCloseRequested and closes the window as it always has. A page that
// decides to stay posts studio:guard-close again. Two safety valves: a second
// close while a request is still unanswered closes at once, so a page that is
// stuck, busy or gone never holds its window open; and every navigation
// disarms the guard, because the page that asked is gone - the next one asks
// again as it loads.
type closeGuard struct {
	armed   bool // the page asked to be asked
	pending bool // a close request is out and not answered yet
}

// What a WM_CLOSE does.
type closeAction int

const (
	closeNow closeAction = iota // close the window
	closeAsk                    // post the request to the page and keep the window
)

// onClose: the window was asked to close (its X, Alt+F4).
func (g *closeGuard) onClose() closeAction {
	if g.armed && !g.pending {
		g.pending = true
		return closeAsk
	}
	return closeNow
}

// arm: the page posted studio:guard-close - on load, or after staying.
func (g *closeGuard) arm() { g.armed, g.pending = true, false }

// release: the page closes itself (window.close()) - let it.
func (g *closeGuard) release() { g.armed, g.pending = false, false }

// reset: a navigation started; the page that armed the guard is going away.
func (g *closeGuard) reset() { g.armed, g.pending = false, false }

var (
	toolWins     = map[uintptr]*toolWindow{}
	toolOrigin   string
	toolDataPath string
	toolMain     uintptr
	toolClass    *uint16
	newWindowReq *comHandler

	// toolDispatch runs a function on the UI thread, later: the new window is
	// built outside the event that asked for it (WebView2 holds the request
	// open through a deferral meanwhile).
	toolDispatch func(func())

	// How a new window appears and where. Variables only so the off-screen
	// test harness can keep its windows off the desktop and unfocused.
	toolShow  = func(hwnd uintptr) { procShowWindow.Call(hwnd, swShowNormal); procUpdateWindow.Call(hwnd) }
	toolPlace = placeToolWindow

	// What studio:raise-main does. A variable so the tests can see that the
	// message reaches it, and that nothing else does, with no window to raise.
	toolRaiseMain = raiseMainWindow

	// How a guarded window's close reaches its page (closeGuard). A variable
	// so the tests can take the close path with no webview; false when the
	// message could not be posted, and the window then closes as usual.
	toolAskClose = postCloseRequest
)

// installToolWindows routes the main window's window.open() here. Called once,
// before the first page loads. If the webview cannot be reached this does
// nothing, and tool windows are stock popups as before.
func installToolWindows(w webview2.WebView, origin, dataPath string) {
	c := chromiumOf(w)
	if c == nil {
		return
	}
	wv := c.GetICoreWebView2_3()
	if wv == nil {
		return
	}
	toolOrigin, toolDataPath, toolMain = origin, dataPath, uintptr(w.Window())
	toolDispatch = w.Dispatch
	hookNewWindows(uintptr(unsafe.Pointer(wv)))
}

func hookNewWindows(wv uintptr) {
	if newWindowReq == nil {
		newWindowReq = newHandler(onNewWindowRequested)
	}
	addHandler(wv, idxAddNewWindowRequested, newWindowReq)
}

// ownURL: a page of ours, or a blank window a page of ours will fill.
func ownURL(uri string) bool {
	return uri == "" || uri == "about:blank" ||
		strings.HasPrefix(uri, toolOrigin) || strings.HasPrefix(uri, "blob:"+toolOrigin)
}

// What a new-window request becomes.
type newWindowRoute int

const (
	routeRefuse     newWindowRoute = iota // handled, and nothing opens
	routeToolWindow                       // a page of ours: a window of this program
	routeShell                            // the OS: the real browser, or the mail program
)

// routeNewWindow decides from the address and from whether a person asked for
// it - no window involved, so toolwindow_test.go checks every rule.
//
// Someone else's web page goes to the real browser and a mailto: link (the
// credit in E-Select's About box) to the mail program, both only when a person
// clicked for them: a page script cannot open browser tabs or compose windows
// on its own. Every other scheme is refused, clicked or not. file:, an app's
// registered protocol, a script URL - a link in these pages has no reason to
// open any of them, and ShellExecute would open all of them.
func routeNewWindow(uri string, userInitiated bool) newWindowRoute {
	if ownURL(uri) {
		return routeToolWindow
	}
	if userInitiated && (hasScheme(uri, "https://") || hasScheme(uri, "http://") || hasScheme(uri, "mailto:")) {
		return routeShell
	}
	return routeRefuse
}

// hasScheme is a prefix test blind to case. WebView2 hands the address over in
// canonical form, scheme in lower case, so this only matters for one made by
// hand; it keeps "MAILTO:" from being refused for its spelling.
func hasScheme(uri, prefix string) bool {
	return len(uri) >= len(prefix) && strings.EqualFold(uri[:len(prefix)], prefix)
}

func onNewWindowRequested(sender, args uintptr) uintptr {
	uri := comString(args, idxNWGetUri)
	var user int32
	vcall(args, idxNWGetIsUserInitiated, uintptr(unsafe.Pointer(&user)))
	switch routeNewWindow(uri, user != 0) {
	case routeShell:
		openInBrowser(uri)
		vcall(args, idxNWPutHandled, 1)
		return sOK
	case routeRefuse:
		// Handled with no window, or WebView2 would open its stock popup.
		vcall(args, idxNWPutHandled, 1)
		return sOK
	}

	// The size the page asked for, in CSS pixels ("width=820,height=720").
	cssW, cssH := 0, 0
	var feat uintptr
	if vcall(args, idxNWGetWindowFeatures, uintptr(unsafe.Pointer(&feat))) == sOK && feat != 0 {
		var has int32
		if vcall(feat, idxWFHasSize, uintptr(unsafe.Pointer(&has))) == sOK && has != 0 {
			var w, h uint32
			vcall(feat, idxWFWidth, uintptr(unsafe.Pointer(&w)))
			vcall(feat, idxWFHeight, uintptr(unsafe.Pointer(&h)))
			cssW, cssH = int(w), int(h)
		}
		vcall(feat, idxRelease)
	}

	var deferral uintptr
	if vcall(args, idxNWGetDeferral, uintptr(unsafe.Pointer(&deferral))) != sOK || deferral == 0 {
		return sOK
	}
	vcall(args, idxAddRef)
	toolDispatch(func() {
		if tw := openToolWindow(cssW, cssH); tw != nil {
			vcall(args, idxNWPutNewWindow, tw.wv)
		}
		vcall(deferral, idxDeferralComplete)
		vcall(deferral, idxRelease)
		vcall(args, idxRelease)
	})
	return sOK
}

// openInBrowser hands an address to the OS: a web page to the real browser, a
// mailto: link to the mail program. ShellExecute, not "cmd /c start": a URL
// from a page must never pass through a command line, where an & in it would
// start a second command.
//
// It does still reach ONE command line, the handler's own: Windows starts the
// program registered for the scheme with the address in place of its "%1". So
// the address goes over as a single argument (shellURL).
func openInBrowser(uri string) {
	verb, _ := syscall.UTF16PtrFromString("open")
	target, err := syscall.UTF16PtrFromString(shellURL(uri))
	if err != nil {
		return
	}
	procShellExecuteW.Call(0, uintptr(unsafe.Pointer(verb)), uintptr(unsafe.Pointer(target)), 0, 0, swShowNormal)
}

// shellURL percent-encodes every byte that could end or split an argument on
// the handler's command line - a quote, a space, a control character - and
// every byte past ASCII, as UTF-8, the way an address is written anyway.
//
// A canonical web address already arrives like that, so for http(s) this
// changes nothing. A mailto: address is canonicalized more loosely, and
// `mailto:a@b" /switch` must reach the mail program as one address, not as an
// address and a switch. %22 and %20 are what RFC 6068 has a mailto: link carry
// in the first place, so a well-formed one is not changed either. A % already
// in the address is left alone: it is an escape the page wrote.
func shellURL(uri string) string {
	const hex = "0123456789ABCDEF"
	var b strings.Builder
	for i := 0; i < len(uri); i++ {
		if c := uri[i]; c <= ' ' || c == '"' || c >= 0x7F {
			b.WriteByte('%')
			b.WriteByte(hex[c>>4])
			b.WriteByte(hex[c&15])
		} else {
			b.WriteByte(c)
		}
	}
	return b.String()
}

func registerToolClass() bool {
	if toolClass != nil {
		return true
	}
	hInst, _, _ := procGetModuleH.Call(0)
	name, _ := syscall.UTF16PtrFromString("MugenStudioTool")
	cursor, _, _ := procLoadCursorW.Call(0, idcArrow)
	// The Studio's own ground, so a window never flashes white before the
	// controller is up.
	brush, _, _ := procCreateSolidBrush.Call(0x0C0607) // COLORREF is 0x00BBGGRR: #07060c
	wc := wndClassEx{
		lpfnWndProc:   syscall.NewCallback(toolWndProc),
		hInstance:     hInst,
		hCursor:       cursor,
		hbrBackground: brush,
		lpszClassName: name,
	}
	wc.cbSize = uint32(unsafe.Sizeof(wc))
	if r, _, _ := procRegisterClassExW.Call(uintptr(unsafe.Pointer(&wc))); r == 0 {
		return false
	}
	toolClass = name
	return true
}

// openToolWindow builds a window and its WebView and returns it UNNAVIGATED:
// WebView2 navigates it itself once the request that asked for it completes.
func openToolWindow(cssW, cssH int) *toolWindow {
	if !registerToolClass() {
		return nil
	}
	x, y, w, h := toolPlace(cssW, cssH)
	hInst, _, _ := procGetModuleH.Call(0)
	title, _ := syscall.UTF16PtrFromString("Mugen Studio")
	hwnd, _, _ := procCreateWindowExW.Call(0, uintptr(unsafe.Pointer(toolClass)), uintptr(unsafe.Pointer(title)),
		wsOverlapped, uintptr(x), uintptr(y), uintptr(w), uintptr(h), 0, 0, hInst, 0)
	if hwnd == 0 {
		return nil
	}
	setWindowIcon(hwnd)
	tw := &toolWindow{hwnd: hwnd}
	toolWins[hwnd] = tw
	toolShow(hwnd)

	c := edge.NewChromium()
	c.DataPath = toolDataPath
	c.SetPermission(edge.CoreWebView2PermissionKindClipboardRead, edge.CoreWebView2PermissionStateAllow)
	ok := c.Embed(hwnd)
	// Embed pumps its own message loop until the controller exists, and that
	// loop swallows two things the main loop needs to see: a dispatch wake-up
	// (the queued work stays queued, so wake it again) and WM_QUIT (the main
	// window closed meanwhile - pass it on, or the program never exits).
	toolDispatch(func() {})
	if !ok || c.GetController() == nil {
		procDestroyWindow.Call(hwnd)
		if r, _, _ := procIsWindow.Call(toolMain); r == 0 {
			procPostQuitMessage.Call(0)
		}
		return nil
	}
	tw.chromium = c
	c.Resize()
	// The same settings as the main window: no browser context menu, no
	// devtools.
	if s, err := c.GetSettings(); err == nil {
		_ = s.PutAreDefaultContextMenusEnabled(false)
		_ = s.PutAreDevToolsEnabled(false)
	}
	tw.wv = uintptr(unsafe.Pointer(c.GetICoreWebView2_3()))
	if tw.wv == 0 {
		vcall(uintptr(unsafe.Pointer(c.GetController())), idxControllerClose)
		procDestroyWindow.Call(hwnd)
		return nil
	}

	// A tool window's own window.open() lands here too.
	hookNewWindows(tw.wv)
	// The page's <title> is the window's title.
	addHandler(tw.wv, idxAddDocumentTitleChanged, newHandler(func(sender, _ uintptr) uintptr {
		t := comString(sender, idxGetDocumentTitle)
		if t == "" {
			t = "Mugen Studio"
		}
		if p, err := syscall.UTF16PtrFromString(t); err == nil {
			procSetWindowTextW.Call(hwnd, uintptr(unsafe.Pointer(p)))
		}
		return sOK
	}))
	// window.close(), from the page or from its opener. The page is closing
	// itself, so its own close guard stands down first.
	addHandler(tw.wv, idxAddWindowCloseRequested, newHandler(func(_, _ uintptr) uintptr {
		tw.guard.release()
		procPostMessageW.Call(hwnd, wmClose, 0, 0)
		return sOK
	}))
	// A navigation takes the page that armed the close guard away.
	addHandler(tw.wv, idxAddNavigationStarting, newHandler(func(_, _ uintptr) uintptr {
		tw.guard.reset()
		return sOK
	}))
	// chrome.webview.postMessage() from the page (onToolMessage). go-webview2
	// already listens for web messages on every Chromium it embeds and hands
	// each one to this callback as a string, on the UI thread.
	c.MessageCallback = func(msg string) { onToolMessage(hwnd, msg) }
	// A second press for a window that is already open reopens its page by
	// NAME, which reloads it here - and the stock popup came to the front when
	// that happened. It still does, but only while this program has the
	// foreground, so a page loading in the background never pulls focus from
	// another app.
	c.NavigationCompletedCallback = func(*edge.ICoreWebView2, *edge.ICoreWebView2NavigationCompletedEventArgs) {
		fg, _, _ := procGetForegroundWindow.Call()
		if fg == hwnd || (fg != toolMain && toolWins[fg] == nil) {
			return
		}
		if r, _, _ := procIsIconic.Call(hwnd); r != 0 {
			procShowWindow.Call(hwnd, swRestore)
		}
		procSetForegroundWindow.Call(hwnd)
	}
	c.Focus()
	return tw
}

// msgRaiseMain is a tool window's page asking for the Studio's main window:
// E-Select's way back to the Studio, which must not close the editor.
// window.opener.focus() is what does that in a browser, and the page still
// falls back to it there.
const msgRaiseMain = "studio:raise-main"

// msgGuardClose arms the window's close guard (closeGuard); msgCloseRequest
// is what the program posts back when the guarded window is asked to close.
const (
	msgGuardClose   = "studio:guard-close"
	msgCloseRequest = "studio:close-request"
)

// onToolMessage answers a tool window's chrome.webview.postMessage(). The
// messages it knows must arrive exactly as written; anything else - other
// spelling, the same words sent as JSON, a message from a page that has
// nothing to ask - is ignored, so no page drives the program by accident.
// (go-webview2 also echoes every message back to the page that sent it; a
// page listens only for studio:close-request, which it never sends itself.)
func onToolMessage(from uintptr, msg string) {
	switch msg {
	case msgRaiseMain:
		toolRaiseMain(from)
	case msgGuardClose:
		if tw := toolWins[from]; tw != nil {
			tw.guard.arm()
		}
	}
}

// closeToolWindows closes every tool window, guard or no guard: a bundle
// switch restarts the server under them, and their pages show the bundle that
// is going away. The main window's page has already asked (studio.html's
// bundle switch) whether any of them holds unsaved work.
func closeToolWindows() {
	for hwnd, tw := range toolWins {
		tw.guard.release()
		procPostMessageW.Call(hwnd, wmClose, 0, 0)
	}
}

// toolCloseDeferred decides a WM_CLOSE for a tool window: true when the close
// went to the page as a request and the window stays for now.
func toolCloseDeferred(tw *toolWindow) bool {
	if tw == nil || tw.guard.onClose() != closeAsk {
		return false
	}
	if toolAskClose(tw) {
		return true
	}
	tw.guard.release() // nobody to ask: close as usual
	return false
}

// postCloseRequest hands studio:close-request to the window's page, where
// chrome.webview's "message" event delivers it.
func postCloseRequest(tw *toolWindow) bool {
	if tw.wv == 0 || tw.chromium == nil {
		return false
	}
	p, err := syscall.UTF16PtrFromString(msgCloseRequest)
	if err != nil {
		return false
	}
	return vcall(tw.wv, idxPostWebMessageAsString, uintptr(unsafe.Pointer(p))) == sOK
}

// raiseMainWindow restores the main window if it is minimized and brings it
// to the front. Only while this program has the foreground, the rule
// openToolWindow already keeps for a reload: the message comes from a click in
// `from`, so that window has it, and a page posting on its own while another
// app is in use never pulls the Studio over that app - or unminimizes it
// behind it.
func raiseMainWindow(from uintptr) {
	if r, _, _ := procIsWindow.Call(toolMain); toolMain == 0 || r == 0 {
		return
	}
	fg, _, _ := procGetForegroundWindow.Call()
	if fg != from && fg != toolMain && toolWins[fg] == nil {
		return
	}
	if r, _, _ := procIsIconic.Call(toolMain); r != 0 {
		procShowWindow.Call(toolMain, swRestore)
	}
	// FOCUS HAS TO BE OURS FIRST. After a click in the page, keyboard focus
	// sits in WebView2's own child window, which belongs to the msedgewebview2
	// process; Windows then counts THAT process as the foreground one and
	// refuses this program's SetForegroundWindow (measured: the call did
	// nothing, the editor stayed in front). Taking focus back to the tool
	// window - ours, and on this thread - first makes the request ours to make.
	if from != 0 && toolWins[from] != nil {
		procSetFocus.Call(from)
	}
	if r, _, _ := procSetForegroundWindow.Call(toolMain); r != 0 {
		return
	}
	// Still refused: share the focus thread's input state for the one call,
	// the documented way for two threads to hand the foreground between them.
	var gti guiThreadInfo
	gti.cbSize = uint32(unsafe.Sizeof(gti))
	fgTid, _, _ := procGetWindowThreadProcessId.Call(fg, 0)
	if r, _, _ := procGetGUIThreadInfo.Call(fgTid, uintptr(unsafe.Pointer(&gti))); r != 0 && gti.hwndFocus != 0 {
		fgTid, _, _ = procGetWindowThreadProcessId.Call(gti.hwndFocus, 0)
	}
	me, _, _ := procGetCurrentThreadIdTw.Call()
	if fgTid == 0 || fgTid == me {
		return
	}
	procAttachThreadInput.Call(me, fgTid, 1)
	procSetForegroundWindow.Call(toolMain)
	procAttachThreadInput.Call(me, fgTid, 0)
}

// GUITHREADINFO, for the thread that owns the focused window.
type guiThreadInfo struct {
	cbSize        uint32
	flags         uint32
	hwndActive    uintptr
	hwndFocus     uintptr
	hwndCapture   uintptr
	hwndMenuOwner uintptr
	hwndMoveSize  uintptr
	hwndCaret     uintptr
	rcCaret       winRect
}

// placeToolWindow sizes a new window from the CSS size the page asked for (or,
// asking nothing, the main window's size) and sets it down a step below and to
// the right of the window it was opened from, kept on that window's screen.
func placeToolWindow(cssW, cssH int) (x, y, w, h int32) {
	from := toolMain
	if fg, _, _ := procGetForegroundWindow.Call(); fg != 0 && toolWins[fg] != nil {
		from = fg
	}
	dpi, _, _ := procGetDpiForWindow.Call(from)
	if dpi == 0 {
		dpi = 96
	}
	var src winRect
	procGetWindowRect.Call(from, uintptr(unsafe.Pointer(&src)))
	if cssW > 0 && cssH > 0 {
		r := winRect{0, 0, int32(cssW * int(dpi) / 96), int32(cssH * int(dpi) / 96)}
		procAdjustWindowRectExForDpi.Call(uintptr(unsafe.Pointer(&r)), wsOverlapped, 0, 0, dpi)
		w, h = r.R-r.L, r.B-r.T
	} else {
		w, h = src.R-src.L, src.B-src.T
	}
	step := int32(32 * int(dpi) / 96)
	x, y = src.L+step, src.T+step

	mi := monitorInfo{}
	mi.cbSize = uint32(unsafe.Sizeof(mi))
	mon, _, _ := procMonitorFromWindow.Call(from, monitorNear)
	if r, _, _ := procGetMonitorInfoW.Call(mon, uintptr(unsafe.Pointer(&mi))); r != 0 {
		wa := mi.work
		w, h = min(w, wa.R-wa.L), min(h, wa.B-wa.T)
		x = max(wa.L, min(x, wa.R-w))
		y = max(wa.T, min(y, wa.B-h))
	}
	return
}

func toolWndProc(hwnd, msg, wp, lp uintptr) uintptr {
	tw := toolWins[hwnd]
	var c *edge.Chromium
	if tw != nil {
		c = tw.chromium
	}
	switch msg {
	case wmSize:
		if c != nil {
			c.Resize()
		}
	case wmMove, wmMoving:
		if c != nil {
			_ = c.NotifyParentWindowPositionChanged()
		}
	case wmActivate:
		if c != nil && wp&0xFFFF != waInactive {
			c.Focus()
		}
	case wmDpiChanged:
		// Per-monitor V2 (dpi.go): moving to a screen with other scaling
		// hands us the size to become. The main window leaves this to
		// DefWindowProc; a window of ours can do it properly.
		r := (*winRect)(unsafe.Pointer(lp))
		procSetWindowPos.Call(hwnd, 0, uintptr(r.L), uintptr(r.T), uintptr(r.R-r.L), uintptr(r.B-r.T), swpNoZOrder|swpNoActivate)
		return 0
	case wmClose:
		// A page that asked to be asked (closeGuard) is asked instead.
		if toolCloseDeferred(tw) {
			return 0
		}
		if c != nil {
			vcall(uintptr(unsafe.Pointer(c.GetController())), idxControllerClose)
			tw.chromium = nil
		}
		procDestroyWindow.Call(hwnd)
		return 0
	case wmDestroy:
		delete(toolWins, hwnd)
		return 0
	}
	r, _, _ := procDefWindowProcW.Call(hwnd, msg, wp, lp)
	return r
}
