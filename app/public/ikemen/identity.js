// Online identity for the browser MUGEN site: unique player names,
// first-come-first-served, backed by the identity endpoints on the site's
// own server (see roster.json identityUrl -> IKEMEN_BRAND.identityUrl).
//
// Flow: the player sets NETWORK > PLAYER NAME in-game; the engine writes it
// to save/config.ini; vfs.js persists that and fires 'ikemen-config-persisted';
// this module notices the name, claims it with the server, and shows the
// recovery code ONCE in an HTML overlay. The code is stored (with the name)
// in localStorage and is the only proof of ownership - it will also be the
// credential attached to ranked reports later. If the name is taken, the
// overlay offers a recovery-code prompt instead, which re-attaches the
// identity on a new browser/machine.
//
// Public/kit builds get identityUrl = '' from the exporter, which turns this
// whole file into a no-op: no server calls, no overlay, no storage.
(function () {
  'use strict';

  const BASE = (globalThis.IKEMEN_BRAND && globalThis.IKEMEN_BRAND.identityUrl || '').replace(/\/+$/, '');
  if (!BASE) return;

  const STORE_KEY = 'ikemen-identity';

  // Mirrors the server's rules (identity.js there) and the in-game input's
  // MAXLEN of 12. Rejecting locally avoids pointless requests for names the
  // server would bounce anyway.
  function validName(name) {
    return typeof name === 'string' && /^[A-Za-z0-9_.\-]{3,12}$/.test(name);
  }

  function stored() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || null; }
    catch (e) { return null; }
  }

  function store(identity) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(identity)); } catch (e) { /* quota */ }
    try { window.dispatchEvent(new CustomEvent('ikemen-identity-changed', { detail: identity })); } catch (e) { /* old browser */ }
  }

  // --- Overlay UI ------------------------------------------------------
  // One shared panel, repopulated per situation. Deliberately plain DOM,
  // no dependencies, styled to sit over the game canvas without stealing
  // input except while it's open.
  let panel = null;

  function closePanel() {
    if (panel) { panel.remove(); panel = null; }
  }

  function openPanel() {
    closePanel();
    panel = document.createElement('div');
    panel.style.cssText =
      'position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:9999;' +
      'background:#101418;color:#dde3ea;border:1px solid #2c3946;border-radius:10px;' +
      'padding:16px 20px;max-width:420px;width:calc(100vw - 40px);box-sizing:border-box;' +
      'font:14px/1.5 system-ui,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.55)';
    // The engine listens for mouse/keyboard on the whole document; without
    // this, typing a recovery code feeds the GAME instead of the input and
    // Ctrl+V never reaches it (field-hit: only right-click > Paste worked).
    // Same event-swallowing the netplay panel (webrtc.js) uses.
    for (const t of ['mousedown', 'mouseup', 'click', 'dblclick', 'keydown', 'keyup', 'keypress', 'wheel', 'contextmenu']) {
      panel.addEventListener(t, function (e) { e.stopPropagation(); });
    }
    document.body.appendChild(panel);
    return panel;
  }

  function el(tag, css, text) {
    const n = document.createElement(tag);
    if (css) n.style.cssText = css;
    if (text != null) n.textContent = text;
    return n;
  }

  const BTN = 'margin:10px 8px 0 0;padding:7px 14px;border-radius:6px;border:1px solid #3a4a5c;' +
    'background:#1a2530;color:#dde3ea;font:inherit;cursor:pointer';

  function showClaimed(name, code) {
    const p = openPanel();
    p.appendChild(el('div', 'font-weight:700;font-size:15px;color:#7fb3ff', 'Name claimed: ' + name));
    p.appendChild(el('div', 'margin-top:8px', 'Your recovery code - shown only this once:'));
    const codeBox = el('div',
      'margin-top:8px;padding:10px;background:#060a0e;border:1px dashed #3a4a5c;border-radius:6px;' +
      'font:700 18px/1.3 ui-monospace,monospace;text-align:center;letter-spacing:1px;user-select:all', code);
    p.appendChild(codeBox);
    p.appendChild(el('div', 'margin-top:8px;color:#93a3b4',
      'Write it down. If your browser data is ever cleared, the code is the only way to get this name back.'));
    const copy = el('button', BTN, 'Copy code');
    copy.onclick = function () {
      try { navigator.clipboard.writeText(code); copy.textContent = 'Copied!'; }
      catch (e) { copy.textContent = 'Select + copy above'; }
    };
    const done = el('button', BTN, 'I saved it');
    done.onclick = closePanel;
    p.appendChild(copy);
    p.appendChild(done);
  }

  function showTaken(name) {
    const p = openPanel();
    p.appendChild(el('div', 'font-weight:700;font-size:15px;color:#ffb36b', '"' + name + '" is already taken'));
    p.appendChild(el('div', 'margin-top:8px',
      'If this name is yours, enter its recovery code. Otherwise pick a different name in NETWORK > PLAYER NAME.'));
    const input = el('input',
      'margin-top:10px;width:100%;box-sizing:border-box;padding:8px;border-radius:6px;' +
      'border:1px solid #3a4a5c;background:#060a0e;color:#dde3ea;font:16px ui-monospace,monospace;text-align:center');
    input.placeholder = 'XXXX-XXXX-XXXX';
    input.maxLength = 20;
    p.appendChild(input);
    setTimeout(function () { try { input.focus(); } catch (e) { /* fine */ } }, 50);
    const status = el('div', 'margin-top:6px;min-height:18px;color:#ff8484', '');
    p.appendChild(status);
    const rec = el('button', BTN, 'Recover name');
    rec.onclick = async function () {
      status.textContent = '';
      rec.disabled = true;
      try {
        const r = await api('/mugen/identity/recover', { name: name, code: input.value });
        if (r && r.ok) {
          store({ name: r.name, code: input.value.toUpperCase().replace(/[^A-Z0-9]/g, '') });
          const q = openPanel();
          q.appendChild(el('div', 'font-weight:700;color:#7fff9e', 'Welcome back, ' + r.name + '!'));
          const ok = el('button', BTN, 'Close');
          ok.onclick = closePanel;
          q.appendChild(ok);
        } else {
          status.textContent = (r && r.reason === 'ratelimited')
            ? 'Too many attempts - try again later.'
            : 'That code does not match this name.';
        }
      } catch (e) {
        status.textContent = 'Could not reach the server - try again in a minute.';
      }
      rec.disabled = false;
    };
    const dismiss = el('button', BTN, 'Not mine');
    dismiss.onclick = function () {
      // Remember the refusal so the same taken name doesn't reopen the
      // panel every time the config re-persists.
      dismissedName = name.toLowerCase();
      closePanel();
    };
    p.appendChild(rec);
    p.appendChild(dismiss);
  }

  function showInvalid(name) {
    const p = openPanel();
    p.appendChild(el('div', 'font-weight:700;color:#ffb36b', 'Online name not claimable'));
    p.appendChild(el('div', 'margin-top:8px',
      '"' + name + '" cannot be registered: names are 3-12 characters, letters/numbers/dot/dash/underscore only.'));
    const ok = el('button', BTN, 'OK');
    ok.onclick = function () { dismissedName = name.toLowerCase(); closePanel(); };
    p.appendChild(ok);
  }

  // --- Server calls ------------------------------------------------------
  async function api(path, body) {
    const res = await fetch(BASE + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return res.json();
  }

  // --- Claim loop ------------------------------------------------------
  let busy = false;
  let dismissedName = ''; // lowercased names the player said aren't theirs
  let lastFailAt = 0;     // network-failure backoff

  async function maybeClaim() {
    if (busy) return;
    const getName = globalThis.ikemenPlayerName;
    if (typeof getName !== 'function') return;
    const name = getName();
    if (!name) return;
    const lower = name.toLowerCase();
    if (lower === dismissedName) return;
    const id = stored();
    if (id && id.name && id.name.toLowerCase() === lower) return; // already ours
    if (!validName(name)) { showInvalid(name); return; }
    if (Date.now() - lastFailAt < 60000) return; // server unreachable - back off
    busy = true;
    try {
      const r = await api('/mugen/identity/claim', { name: name });
      if (r && r.ok) {
        store({ name: r.name, code: r.code });
        showClaimed(r.name, r.code);
      } else if (r && r.reason === 'taken') {
        showTaken(name);
      } else if (r && r.reason === 'ratelimited') {
        lastFailAt = Date.now();
      }
      // 'invalid' is unreachable here (validated above); anything else
      // just retries on the next persist event.
    } catch (e) {
      lastFailAt = Date.now(); // offline / server asleep - stay quiet, retry later
    }
    busy = false;
  }

  // The engine persists save/config.ini through vfs.js on every options
  // save; that event is the primary trigger. The boot-time sweep catches a
  // name that was set in an earlier session before this module existed.
  window.addEventListener('ikemen-config-persisted', function () { maybeClaim(); });
  setTimeout(maybeClaim, 8000);

  // Seam for the netplay/ranked layer (and for testing): current identity
  // plus a way to re-run the claim check on demand.
  globalThis.ikemenIdentity = {
    get: stored,
    recheck: maybeClaim,
    serverUrl: BASE,
  };
})();
