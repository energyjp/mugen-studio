package main

import (
	"reflect"
	"testing"
	"unsafe"

	"github.com/jchv/go-webview2/pkg/edge"
)

// The slot numbers in toolwindow.go, checked against the vtable structs
// go-webview2 calls through in production. A wrong slot is a crash, not an
// error, so the two sources have to agree before the window ever runs.
func TestToolWindowSlots(t *testing.T) {
	slot := func(iface any, method string) int {
		vt := reflect.TypeOf(iface).Field(0).Type.Elem() // *vtbl -> vtbl
		f, ok := vt.FieldByName(method)
		if !ok {
			t.Fatalf("%s has no %s", vt.Name(), method)
		}
		return int(f.Offset / unsafe.Sizeof(uintptr(0)))
	}
	for _, c := range []struct {
		iface  any
		method string
		want   int
	}{
		{edge.ICoreWebView2{}, "AddNavigationStarting", idxAddNavigationStarting},
		{edge.ICoreWebView2{}, "PostWebMessageAsString", idxPostWebMessageAsString},
		{edge.ICoreWebView2{}, "AddNewWindowRequested", idxAddNewWindowRequested},
		{edge.ICoreWebView2{}, "AddDocumentTitleChanged", idxAddDocumentTitleChanged},
		{edge.ICoreWebView2{}, "GetDocumentTitle", idxGetDocumentTitle},
		{edge.ICoreWebView2{}, "AddWindowCloseRequested", idxAddWindowCloseRequested},
		{edge.ICoreWebView2Controller{}, "Close", idxControllerClose},
	} {
		if got := slot(c.iface, c.method); got != c.want {
			t.Errorf("%s: library slot %d, toolwindow.go says %d", c.method, got, c.want)
		}
	}
}

func TestOwnURL(t *testing.T) {
	toolOrigin = "http://127.0.0.1:8951/"
	for uri, want := range map[string]bool{
		"http://127.0.0.1:8951/grid.html":           true,
		"http://127.0.0.1:8951/moves.html?char=kfm": true,
		"about:blank":                     true,
		"":                                true,
		"blob:http://127.0.0.1:8951/1f2e": true,
		"http://127.0.0.1:8952/grid.html": false, // another port is another program
		"http://127.0.0.1:89511/":         false,
		"https://itch.io/":                false,
		"file:///C:/Windows/":             false,
	} {
		if got := ownURL(uri); got != want {
			t.Errorf("ownURL(%q) = %v, want %v", uri, got, want)
		}
	}
}

// Where a window.open() or target=_blank goes. Both answers of "did a person
// click for it" for every address, because the click is the whole difference
// between the real browser and nothing.
func TestRouteNewWindow(t *testing.T) {
	toolOrigin = "http://127.0.0.1:8951/"
	names := map[newWindowRoute]string{routeRefuse: "refuse", routeToolWindow: "tool window", routeShell: "shell"}
	for _, c := range []struct {
		uri           string
		clicked, auto newWindowRoute
	}{
		// Ours: a window of this program either way - the Studio opens its
		// tools from script as well as from clicks.
		{"http://127.0.0.1:8951/grid.html", routeToolWindow, routeToolWindow},
		{"about:blank", routeToolWindow, routeToolWindow},
		{"", routeToolWindow, routeToolWindow},
		{"blob:http://127.0.0.1:8951/1f2e", routeToolWindow, routeToolWindow},

		// Someone else's page: the real browser, on a click only.
		{"https://vselect.neocities.org/", routeShell, routeRefuse},
		{"http://example.com/a?b=1&c=2", routeShell, routeRefuse},
		{"http://127.0.0.1:8952/grid.html", routeShell, routeRefuse},
		{"HTTPS://Example.com/", routeShell, routeRefuse},

		// A mail link: the mail program, on a click only.
		{"mailto:someone@example.com", routeShell, routeRefuse},
		{"mailto:someone@example.com?subject=E-Select%201.0", routeShell, routeRefuse},
		{"MAILTO:someone@example.com", routeShell, routeRefuse},
		{"mailto:", routeShell, routeRefuse},

		// Everything else: nothing, clicked or not.
		{"file:///C:/Windows/System32/", routeRefuse, routeRefuse},
		{"javascript:alert(1)", routeRefuse, routeRefuse},
		{"ms-settings:privacy", routeRefuse, routeRefuse},
		{"search-ms:query=x", routeRefuse, routeRefuse},
		{"tel:5551234", routeRefuse, routeRefuse},
		{"data:text/html,hi", routeRefuse, routeRefuse},
		{"mailtox:someone@example.com", routeRefuse, routeRefuse},
		{"mail:someone@example.com", routeRefuse, routeRefuse},
		{"httpx://example.com/", routeRefuse, routeRefuse},
		{"https:", routeRefuse, routeRefuse},
		{"ftp://example.com/", routeRefuse, routeRefuse},
	} {
		if got := routeNewWindow(c.uri, true); got != c.clicked {
			t.Errorf("routeNewWindow(%q, clicked) = %s, want %s", c.uri, names[got], names[c.clicked])
		}
		if got := routeNewWindow(c.uri, false); got != c.auto {
			t.Errorf("routeNewWindow(%q, not clicked) = %s, want %s", c.uri, names[got], names[c.auto])
		}
	}
}

// What reaches ShellExecute: one argument, however the address was written.
func TestShellURL(t *testing.T) {
	for uri, want := range map[string]string{
		// Canonical addresses pass through untouched.
		"https://vselect.neocities.org/":                              "https://vselect.neocities.org/",
		"http://example.com/a%20b?c=1&d=%22x%22#top":                  "http://example.com/a%20b?c=1&d=%22x%22#top",
		"mailto:someone@example.com":                                  "mailto:someone@example.com",
		"mailto:someone@example.com?subject=E-Select%201.0":           "mailto:someone@example.com?subject=E-Select%201.0",
		"mailto:a@example.com,b@example.com?cc=c@example.com&body=hi": "mailto:a@example.com,b@example.com?cc=c@example.com&body=hi",

		// What would end or split the handler's argument is encoded.
		`mailto:a@example.com" /switch "x`:       "mailto:a@example.com%22%20/switch%20%22x",
		"mailto:a@example.com?subject=two words": "mailto:a@example.com?subject=two%20words",
		"mailto:a@example.com\t\r\n":             "mailto:a@example.com%09%0D%0A",
		"mailto:a@example.com\x00\x7F":           "mailto:a@example.com%00%7F",
		"mailto:jos\u00e9@example.com":           "mailto:jos%C3%A9@example.com",
	} {
		if got := shellURL(uri); got != want {
			t.Errorf("shellURL(%q) = %q, want %q", uri, got, want)
		}
	}
}

// nativeOpenBrowser's path: the read-only build's Play a match address (the
// shape vfslib.js matchView builds, p1&p2[&p2ai]&stage&loadmotif=1) reaches
// ShellExecute whole - one call, every & kept - and an address that is not
// our own server's never reaches it.
func TestOpenOwnPage(t *testing.T) {
	saved := browserOpen
	defer func() { browserOpen = saved }()
	var opened []string
	browserOpen = func(uri string) { opened = append(opened, uri) }

	origin := "http://127.0.0.1:8951/"
	play := origin + "ikemen/index.html?p1=chars%2Fkfm%2Fkfm.def&p2=kfm&p2ai=4&stage=stages%2Fstage0.def&loadmotif=1"
	if !openOwnPage(play, origin) {
		t.Fatal("our own page was refused")
	}
	if len(opened) != 1 || opened[0] != play {
		t.Fatalf("handed to the shell: %q, want exactly [%q]", opened, play)
	}
	if got := shellURL(play); got != play {
		t.Fatalf("shellURL changed the Play a match address: %q", got)
	}
	for _, other := range []string{
		"http://127.0.0.1:8952/ikemen/index.html?p1=kfm&p2=kfm",
		"https://example.com/?a=1&b=2",
		"file:///C:/Windows/",
		"",
	} {
		if openOwnPage(other, origin) {
			t.Errorf("openOwnPage(%q) = true, want false", other)
		}
	}
	if len(opened) != 1 {
		t.Fatalf("a refused address reached the shell: %q", opened[1:])
	}
}

// studio:raise-main reaches the raise, from the window that sent it, and no
// other message does.
func TestToolMessage(t *testing.T) {
	var raised []uintptr
	saved := toolRaiseMain
	toolRaiseMain = func(from uintptr) { raised = append(raised, from) }
	defer func() { toolRaiseMain = saved }()

	for _, msg := range []string{
		"", "studio:raise", "studio:raise-main ", " studio:raise-main",
		"Studio:Raise-Main", `"studio:raise-main"`, `{"type":"studio:raise-main"}`,
		"studio:close-main", "studio:raise-main\x00",
	} {
		onToolMessage(0x1234, msg)
	}
	if len(raised) != 0 {
		t.Fatalf("other messages raised the main window %d time(s)", len(raised))
	}
	onToolMessage(0x1234, "studio:raise-main")
	if len(raised) != 1 || raised[0] != 0x1234 {
		t.Fatalf("studio:raise-main: raised %v, want [0x1234]", raised)
	}
}

// The close guard, step by step: a WM_CLOSE on an armed window asks the page
// once; staying re-arms it; a second close while the request is unanswered
// closes; the page closing itself, and every navigation, disarm it.
func TestCloseGuard(t *testing.T) {
	var g closeGuard
	if g.onClose() != closeNow {
		t.Fatal("a window whose page never asked closes at once")
	}
	g.arm()
	if g.onClose() != closeAsk {
		t.Fatal("armed: the first close is a request to the page")
	}
	if g.onClose() != closeNow {
		t.Fatal("a second close while the request is unanswered closes at once")
	}
	g.arm()
	if g.onClose() != closeAsk {
		t.Fatal("the page stayed and asked again: the next close is a request again")
	}
	g.arm() // stayed (Cancel)
	g.release()
	if g.onClose() != closeNow {
		t.Fatal("the page closing itself (window.close) is not asked about")
	}
	g.arm()
	g.reset()
	if g.onClose() != closeNow {
		t.Fatal("a navigation disarms the guard: the next page has not asked")
	}
}

// The guard through the program's own paths: the page's message arms the
// window it came from (and only that one, and only that exact message), a
// close then posts the request instead of closing, and a request that cannot
// be posted closes as usual.
func TestCloseGuardMessages(t *testing.T) {
	savedAsk := toolAskClose
	defer func() { toolAskClose = savedAsk }()
	var asked []uintptr
	post := true
	toolAskClose = func(tw *toolWindow) bool { asked = append(asked, tw.hwnd); return post }

	a, b := &toolWindow{hwnd: 0xA1}, &toolWindow{hwnd: 0xB2}
	toolWins[a.hwnd], toolWins[b.hwnd] = a, b
	defer func() { delete(toolWins, a.hwnd); delete(toolWins, b.hwnd) }()

	for _, msg := range []string{"studio:guard-close ", "Studio:Guard-Close", `"studio:guard-close"`,
		"studio:close-request", "studio:guard", ""} {
		onToolMessage(a.hwnd, msg)
	}
	if a.guard.armed {
		t.Fatal("only the exact studio:guard-close arms the guard")
	}
	if toolCloseDeferred(a) || len(asked) != 0 {
		t.Fatal("an unarmed window closes without asking its page")
	}
	onToolMessage(a.hwnd, msgGuardClose)
	if !a.guard.armed || b.guard.armed {
		t.Fatal("studio:guard-close arms the window that sent it, and no other")
	}
	onToolMessage(0xC3, msgGuardClose) // not a window of ours: nothing, and no panic
	if !toolCloseDeferred(a) || len(asked) != 1 || asked[0] != a.hwnd {
		t.Fatalf("an armed window's close is posted to its page instead: asked %v", asked)
	}
	if toolCloseDeferred(a) {
		t.Fatal("a second close while the request is unanswered closes at once")
	}
	if toolCloseDeferred(b) {
		t.Fatal("the other window was never armed")
	}
	onToolMessage(a.hwnd, msgGuardClose)
	post = false
	if toolCloseDeferred(a) {
		t.Fatal("a request that cannot be posted closes the window as usual")
	}
	if a.guard.armed {
		t.Fatal("and the guard is off after it")
	}
	if toolCloseDeferred(nil) {
		t.Fatal("a window this program does not know closes as usual")
	}
	// The raise message still does only the raise.
	savedRaise := toolRaiseMain
	defer func() { toolRaiseMain = savedRaise }()
	raised := 0
	toolRaiseMain = func(uintptr) { raised++ }
	onToolMessage(b.hwnd, msgRaiseMain)
	if raised != 1 || b.guard.armed {
		t.Fatal("studio:raise-main raises and arms nothing")
	}
}
