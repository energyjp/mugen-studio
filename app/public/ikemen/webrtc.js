// WebRTC netplay bridge for the Ikemen GO wasm build.
//
// The engine's lockstep netplay speaks a byte stream (TCP on desktop).
// Here the same stream rides an ordered+reliable RTCDataChannel, so the
// two players connect DIRECTLY to each other - no game server involved.
// Signaling is manual copy-paste (v1): the host sends an offer code to
// their friend over any chat, the friend pastes it, sends back an answer
// code, done. STUN by Google's free public server.
//
// Go side: src/netconn_js.go calls globalThis.ikemenNet.
(function () {
  'use strict';

  // The page's netplay dev switch: ?devnet=1 (off by default) turns on the
  //
  const qp = new URLSearchParams(location.search);
  const devnet = qp.get('devnet') === '1';
  // Watchers in this room (see "watching"); null when not a room that takes them.
  let watchCount = null;

  // metered.ca TURN relay (for router pairings that can't connect
  // directly). Fresh short-lived credentials are fetched per session from
  // their API. Set METERED_APP to the account's app subdomain (the
  // "xxxx.metered.live" name from the dashboard). Note: the API key is
  // public in this file by design (client-side fetch) - fine for a
  // friends-only site, but it does mean strangers could burn the quota.
  const METERED_APP = '';
  const METERED_KEY = '';

  // Lobby signaling server: swaps the WebRTC offer/answer blobs so players
  // trade a short room code instead of the giant copy-paste strings. Set this
  // to your own deployed endpoint, e.g. wss://<host>/ws — it is any WebSocket
  // relay speaking:
  //   ?create=1[&pass=...]  -> {t:'room', code}
  //   ?join=CODE[&pass=...] -> {t:'joined'} | {t:'peer'}
  //                            {t:'deny', reason:'badcode'|'badpass'|'full'}
  // then {t:'sdp',...} relayed verbatim both ways, {t:'bye'} on disconnect.
  // Empty = no lobby; the manual copy-paste flow still works and is always
  // available as a fallback. ?signal=<url> on the page URL overrides (dev).
  const SIGNAL_URL = '';
  function signalUrl() {
    const q = new URLSearchParams(location.search).get('signal');
    if (q) return q;
    if (SIGNAL_URL) return SIGNAL_URL;
    // Local dev convenience: the reference server's default port.
    if (/^(localhost|127\.)/.test(location.hostname)) return 'ws://localhost:8940/ws';
    return '';
  }

  async function fetchIceServers() {
    const base = [
      // One Google STUN hostname. With three (stun, stun1, stun2), a page that
      // had gathered and then idled through a fight often never reached
      // 'complete', so every later lobby match waited gatherComplete's 4 s
      // (plan 1.24). They are the same service; one is enough to find the
      // public address.
      { urls: ['stun:stun.l.google.com:19302'] },
    ];
    if (!METERED_APP) return base;
    try {
      const res = await fetch(`https://${METERED_APP}.metered.live/api/v1/turn/credentials?apiKey=${METERED_KEY}`);
      const servers = await res.json();
      if (Array.isArray(servers) && servers.length) {
        console.log('[netplay] TURN relay credentials loaded (' + servers.length + ' servers)');
        return base.concat(servers);
      }
    } catch (e) {
      console.warn('[netplay] TURN credential fetch failed, direct-only:', e.message);
    }
    return base;
  }

  let pc = null, dc = null;
  // Rollback datagram channel (V2 engine): unordered/unreliable, UDP
  // semantics for GGPO. Whole datagrams are queued; boundaries preserved.
  let gdc = null, gQueue = [];
  let isConnected = false, isFailed = false, isClosed = false;
  // The engine's rollback loop as its own datagrams show it (ggpoTrack): when
  // it last sent one, its newest input frame and when that last moved on.
  const ggpoLive = { sentAt: 0, top: -1, topAt: 0 };
  // This page dropped the match it plays because the other player is gone
  // (lobbyPlayDrop, lobbyGone). An engine that asks (matchGone, every turn of
  // its rollback loop: the modern-input engine) ends the match itself, so the
  // page presses no Esc for it (lobbyUnstick); goneAskedAt says when it last
  // asked.
  let matchDropped = false, goneAskedAt = 0;
  // Incoming bytes: queue of Uint8Array chunks + read offset into first.
  let chunks = [], chunkOff = 0;
  let panel = null;

  // Live counters so a freeze is diagnosable on-screen (F12 is unreliable
  // when a tab locks up). bytesRecv advancing but bytesReadByEngine stuck
  // = engine wedged; both stuck = peer went silent.
  let bytesRecv = 0, bytesReadByEngine = 0, bytesSent = 0;
  let pingMs = -1; // rollback round-trip, fed by the engine via setPing
  let nd = null;   // the ping diagnostics (makePingDiag), live only during a session

  // Always-visible on-screen diagnostic log - the game canvas can freeze
  // with F12 unavailable, but this DOM overlay keeps updating and can be
  // screenshotted. Ring-buffered to the last lines.
  let diag = null, diagLines = [], diagOpen = false;
  function netLog(msg) {
    console.log('[netplay]', msg);
    diagLines.push('[' + (performance.now() / 1000).toFixed(1) + 's] ' + msg);
    if (diagLines.length > 12) diagLines.shift();
    renderDiag();
  }
  function renderDiag() {
    if (!diag) {
      // Sits in the PAGE FLOW directly under the game, collapsed to its
      // summary line. It used to be position:fixed at the viewport bottom
      // with the canvas shrunk above it (ikemenReserveBottom) - fine on a
      // tall window, but inside itch's short iframe the bar was permanently
      // glued over the bottom of the play area and the reserved strip ate
      // the picture. In flow it can never cover the match; click the header
      // to expand the log when a connection actually needs debugging.
      diag = document.createElement('div');
      diag.style.cssText =
        'display:block;margin:6px auto 0;max-width:1280px;background:#000d;color:#6f6;' +
        'border:1px solid #363;border-radius:4px;padding:4px 8px;box-sizing:border-box;' +
        'font:11px monospace;white-space:pre;line-height:1.3;cursor:pointer;' +
        'overflow:hidden;max-height:1.9em';
      diag.title = 'Netplay diagnostics - click to expand/collapse';
      diag.addEventListener('click', function () {
        diagOpen = !diagOpen;
        diag.style.maxHeight = diagOpen ? '38vh' : '1.9em';
        diag.style.overflowY = diagOpen ? 'auto' : 'hidden';
      });
      // Keep clicks/keys off the engine, which listens document-wide.
      for (const t of ['mousedown', 'mouseup', 'click', 'dblclick', 'keydown', 'keyup', 'wheel']) {
        diag.addEventListener(t, function (e) { e.stopPropagation(); });
      }
      // The Game only page (index.html) fills the window with the picture,
      // so under it would be off the page: it has a place for this line in
      // its options panel instead.
      const slot = globalThis.ikemenGameOnly && document.getElementById('netdiag-slot');
      const canvas = document.querySelector('body > canvas');
      if (slot) slot.appendChild(diag);
      else if (canvas) canvas.insertAdjacentElement('afterend', diag);
      else document.body.appendChild(diag);
    }
    diag.textContent = (diagOpen ? '▼ ' : '▶ ') +
      'NETPLAY' + (pingMs >= 0 ? ' [ping ' + pingMs + 'ms' + (nd ? nd.header(pingMs) : '') + ']'
        : nd && nd.net() >= 0 ? ' [net ' + nd.net() + 'ms]' : '') +
      ' (recv ' + bytesRecv + 'B / engine-read ' + bytesReadByEngine + 'B / sent ' + bytesSent + 'B)' +
      (watchCount === null ? '' : ' | ' + watchCount + ' watching') + '\n' +
      diagLines.join('\n');
  }
  function hideDiag() {
    if (diag) { diag.remove(); diag = null; }
    diagLines = [];
    diagOpen = false;
  }

  function resetState() {
    isConnected = false; isFailed = false; isClosed = false;
    chunks = []; chunkOff = 0;
    bytesRecv = 0; bytesReadByEngine = 0; bytesSent = 0;
    peerHash = null; hashVerdict = null;
    peerNetcode = null; ncVerdict = null;
    gdc = null; gQueue = []; pingMs = -1;
    ggpoLive.sentAt = 0; ggpoLive.top = -1; ggpoLive.topAt = 0;
    matchDropped = false; goneAskedAt = 0;
    queueRole = ''; queueP1 = ''; queueP2 = ''; queueStartedAt = 0; queueMatchSeq = 0;
    queueRated = false; // re-armed only by a {t:'match'} that says mode:'ranked'
    queueLobby = false; // set again only by lobbyPlates, at a lobby match's start
    if (!localHash) computeBuildHash();
  }

  function maybeJudgeNetcode() {
    if (ncVerdict !== null || peerNetcode === null) return;
    const same = peerNetcode === localNetcode();
    ncVerdict = same;
    if (same) {
      netLog('netcode check OK - both on ' + ncName(localNetcode()));
    } else {
      netLog('NETCODE MISMATCH - local ' + ncName(localNetcode()) + ' vs peer ' + ncName(peerNetcode));
      setStatus('Netcode mismatch: you picked ' + ncName(localNetcode()) + ', your opponent picked '
        + ncName(peerNetcode) + '. Both must choose the same "Online netcode" on the start screen.');
      ikemenNet.close();
    }
  }

  // Bridge-level handshake ping: sent by each side the moment the channel
  // opens, filtered out before the engine sees it. Proves the transport
  // carries data in BOTH directions independent of the engines - the
  // field-observed failure is a channel that reports OPEN but silently
  // black-holes data one way.
  const PING = new Uint8Array([0x49, 0x4b, 0x4d, 0x4e, 0x50, 0x49, 0x4e, 0x47]); // "IKMNPING"
  let pingSeen = false, pingFilterArmed = false;

  // Build-content check: right after the ping, each side sends a hash
  // of the game manifest ("IKMH" + 8 bytes, filtered from the engine).
  // Lockstep netplay DESYNCS if the two players have different characters
  // or stages, so a mismatch (stale cache, old upload) refuses the match
  // with a clear message instead of corrupting it mid-game.
  const HASH_MAGIC = [0x49, 0x4b, 0x4d, 0x48]; // "IKMH"
  let localHash = null, peerHash = null, hashVerdict = null;

  // Netcode check: each side also sends its chosen netcode ("IKNC" + 1 byte,
  // 0=delay 1=rollback, filtered from the engine). Delay and rollback are
  // incompatible on the wire, so a mismatch refuses the match with a clear
  // message instead of a broken/instant-desync session. The choice comes from
  // the boot-page selector (globalThis.ikemenNetcode).
  const NC_MAGIC = [0x49, 0x4b, 0x4e, 0x43]; // "IKNC"
  let peerNetcode = null, ncVerdict = null;
  function localNetcode() { return globalThis.ikemenNetcode === 'rollback' ? 1 : 0; }
  function ncName(v) { return v ? 'Rollback' : 'Delay'; }

  // Deterministic content hash (cyrb64), 8 bytes. Deliberately NOT
  // crypto.subtle: that Web Crypto API is undefined over plain http://
  // (non-secure context) and its absence silently DISABLED the desync check
  // by degrading every hash to zeros ("always match"). Pure JS works in any
  // context and both players run identical code, so the result stays
  // consistent between them.
  function contentHash64(bytes) {
    let h1 = 0xdeadbeef ^ bytes.length, h2 = 0x41c6ce57 ^ bytes.length;
    for (let i = 0; i < bytes.length; i++) {
      h1 = Math.imul(h1 ^ bytes[i], 2654435761);
      h2 = Math.imul(h2 ^ bytes[i], 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    const out = new Uint8Array(8), dv = new DataView(out.buffer);
    dv.setUint32(0, h2 >>> 0); dv.setUint32(4, h1 >>> 0);
    return out;
  }

  async function computeBuildHash() {
    try {
      // Preferred: the combined Build ID computed by vfs.js during boot -
      // covers the shipped pack, every browser-side mod's bytes, and the
      // theme pick, so mismatched mods or themes are refused up front
      // instead of desyncing mid-match.
      if (globalThis.ikemenBuildHash instanceof Uint8Array && globalThis.ikemenBuildHash.length === 8) {
        localHash = globalThis.ikemenBuildHash;
      } else {
        // Fallback (page without the VFS, e.g. the dev harness): manifest only.
        const res = await fetch('./ikemen-fs/manifest.json', { cache: 'no-cache' });
        const buf = new Uint8Array(await res.arrayBuffer());
        localHash = contentHash64(buf);
      }
    } catch (e) {
      netLog('build hash unavailable: ' + e.message);
      localHash = new Uint8Array(8); // degrade to "always match" rather than block play
    }
    // FOLD IN THE ENGINE ID. The Build ID hashes CONTENT and the wasm is not
    // content, so before this a player on a different engine matched cleanly and
    // the pair simply desynced later, with nothing on either screen able to say
    // the engines differed. index.html hashes the bytes it actually loaded; this
    // mixes that in so a mismatch is REFUSED at the build check.
    //
    // Mixed in rather than replacing the hash, so an engine change and a content
    // change are both caught by the one existing comparison and the existing
    // "hard-refresh and retry" message still reads correctly for either.
    //
    // Safe to read here: this runs at netplay setup, long after go.run() started
    // the engine, and the id is assigned before that. An empty id (the hash
    // failed) still mixes deterministically - both peers failing the same way
    // still match, which is the pre-existing degrade-rather-than-block posture.
    try {
      const eng = String(globalThis.ikemenEngineId || '');
      const mixed = new Uint8Array(localHash.length + eng.length + 1);
      mixed.set(localHash, 0);
      mixed[localHash.length] = 0x7c; // '|' - keeps the two fields from blurring
      for (let i = 0; i < eng.length; i++) mixed[localHash.length + 1 + i] = eng.charCodeAt(i) & 0xff;
      localHash = contentHash64(mixed);
      netLog('engine id ' + (eng || '(unavailable)'));
      //
      // page on a "different build" without a second build.
      const salt = devnet ? qp.get('buildsalt') : '';
      if (salt) {
        const salted = new Uint8Array(localHash.length + salt.length);
        salted.set(localHash, 0);
        for (let i = 0; i < salt.length; i++) salted[localHash.length + i] = salt.charCodeAt(i) & 0xff;
        localHash = contentHash64(salted);
        netLog('build id salted (test hook)');
      }
    } catch (e) {
      netLog('engine id not folded in: ' + e.message);
    }
    maybeJudgeHashes();
  }

  function maybeJudgeHashes() {
    if (hashVerdict !== null || !localHash || !peerHash) return;
    const same = localHash.every((b, i) => b === peerHash[i]);
    hashVerdict = same;
    if (same) {
      netLog('build check OK - same characters/stages on both sides');
    } else {
      netLog('BUILD MISMATCH - refusing match to prevent desync');
      // Name the usual cause, not just the usual remedy. This used to say only
      // "hard-refresh (Ctrl+F5)", which cannot fix the most common mismatch
      // there is: anything done in the Mod Studio lives in browser storage and
      // survives a hard refresh entirely. A player whose only difference was a
      // rearranged select screen could refresh forever and never connect, with
      // nothing telling them where to look.
      // The one check covers the game files AND the engine (the Engine ID is
      // folded in above), so the text names both: after an engine update the
      // usual cause is one player still on the older page.
      setStatus('Game contents differ between players! Either the game files or the game engine '
        + 'are not the same (compare the Build ID and the Engine ID on both loading screens). '
        + 'Different Engine IDs: one of you is on an older version of the site - that player '
        + 'refreshes the page (Ctrl+F5). Same Engine ID: usually one of you added, removed, '
        + 'edited or rearranged something in the Mod Studio - that has to match too. '
        + 'Fix: make both sides identical, or use Reset on the loading page to go back '
        + 'to the shipped roster. A hard refresh alone will NOT clear a Mod Studio change.');
      ikemenNet.close();
    }
  }

  // Every handler here acts only for the session's CURRENT channel or
  // connection. A page runs sessions back to back in a winner-stays lobby, and
  // a finished session's channels report their close later, sometimes after
  // the next session wired its own: before this, that late close nulled the
  // new 'ggpo' channel (gdc) and the next match never started (field: the
  // player whose opponent's tab closed mid-match, in the following match).
  function wireChannel(channel) {
    dc = channel;
    dc.binaryType = 'arraybuffer';
    pingSeen = false; pingFilterArmed = true;
    dc.onopen = () => {
      if (dc !== channel) return;
      isConnected = true;
      netLog('data channel OPEN');
      try { dc.send(PING); netLog('handshake ping sent'); } catch (e) { netLog('ping send FAILED: ' + e.message); }
      // send our build hash once computed (may still be in flight)
      const sendHash = () => {
        if (!localHash) { setTimeout(sendHash, 100); return; }
        try {
          const msg = new Uint8Array(4 + localHash.length);
          msg.set(HASH_MAGIC, 0); msg.set(localHash, 4);
          dc.send(msg);
        } catch (e) { netLog('hash send failed: ' + e.message); }
      };
      sendHash();
      // send our chosen netcode ("IKNC" + 1 byte)
      try {
        const nc = new Uint8Array(5);
        nc.set(NC_MAGIC, 0); nc[4] = localNetcode();
        dc.send(nc);
      } catch (e) { netLog('netcode send failed: ' + e.message); }
      setStatus('Connected! Return to the game window.');
      setTimeout(hidePanel, 2500);
      watchTransport();
    };
    dc.onmessage = (e) => {
      if (dc !== channel) return;
      const u = new Uint8Array(e.data);
      if (pingFilterArmed && !pingSeen && u.length === PING.length && u.every((b, i) => b === PING[i])) {
        pingSeen = true;
        netLog('peer handshake ping RECEIVED - transport alive both ways');
        return; // never expose the ping to the engine
      }
      if (!peerHash && u.length === 12 && HASH_MAGIC.every((b, i) => u[i] === b)) {
        peerHash = u.subarray(4);
        maybeJudgeHashes();
        return; // bridge-level message, not for the engine
      }
      if (peerNetcode === null && u.length === 5 && NC_MAGIC.every((b, i) => u[i] === b)) {
        peerNetcode = u[4];
        maybeJudgeNetcode();
        return; // bridge-level message, not for the engine
      }
      bytesRecv += u.length; chunks.push(u); renderDiag();
    };
    dc.onclose = () => { if (dc !== channel) return; isClosed = true; isConnected = false; netLog('data channel CLOSED by peer'); };
    dc.onerror = (e) => { if (dc !== channel) return; isFailed = true; netLog('data channel ERROR: ' + (e && e.error && e.error.message || 'unknown')); };
  }

  function wireGGPO(channel) {
    gdc = channel;
    gdc.binaryType = 'arraybuffer';
    gdc.onmessage = (e) => { if (gdc === channel) gQueue.push(new Uint8Array(e.data)); };
    gdc.onopen = () => netLog('ggpo datagram channel OPEN');
    gdc.onclose = () => { if (gdc === channel) gdc = null; };
  }

  // Periodically report the send-buffer depth and which network path ICE
  // chose (direct vs TURN relay). bufferedAmount growing = our data is NOT
  // leaving this machine.
  //
  //
  // exactly as long as the session's channel is open: it ticks once a second
  // for the network round trip, and the path line keeps its 3 s cadence.
  let watchTimer = null;
  function watchTransport() {
    clearInterval(watchTimer);
    ndStop();
    const mine = nd = makePingDiag(ndEnv);
    let lastLine = '';
    let tick = 0, busy = false;
    watchTimer = setInterval(async () => {
      if (!pc || !dc || dc.readyState !== 'open') { clearInterval(watchTimer); if (nd === mine) ndStop(); return; }
      if (busy) return; // a slow getStats: skip this second rather than pile up
      busy = true;
      const pathTick = ++tick % 3 === 0;
      let path = '?';
      try {
        const stats = await pc.getStats();
        let pair = null;
        stats.forEach((s) => { if (s.type === 'transport' && s.selectedCandidatePairId) pair = stats.get(s.selectedCandidatePairId); });
        if (!pair) stats.forEach((s) => { if (s.type === 'candidate-pair' && (s.selected || s.nominated) && s.state === 'succeeded') pair = pair || s; });
        if (nd === mine) mine.netFromPair(pair);
        if (pair) {
          const loc = stats.get(pair.localCandidateId), rem = stats.get(pair.remoteCandidateId);
          path = (loc ? loc.candidateType : '?') + '->' + (rem ? rem.candidateType : '?');
        }
      } catch { /* stats unavailable */ }
      busy = false;
      if (!pathTick || !dc) return;
      const line = 'path ' + path + ', send-buffer ' + dc.bufferedAmount + 'B' + (pingSeen ? '' : ', NO peer ping yet');
      if (line !== lastLine) { lastLine = line; netLog(line); }
    }, 1000);
  }

  // ---- PING DIAGNOSTICS (2.4.1) ----
  // The rollback ping in the header is ONE GGPO quality-report round trip,
  // sampled about once a second, and the other engine answers it only from
  // inside its frame loop (requestAnimationFrame). So a ~1 s freeze of EITHER
  // page (a hidden window, a garbage-collection pause, a heavy round
  // transition) reads as a ~900 ms ping on a perfect network. While a session
  // is live this page watches what it can see for itself: its own window
  // hidden and shown, its own frame gaps, and the network-only round trip from
  // getStats (the selected candidate pair's currentRoundTripTime); the header
  // shows that next to the game ping with the peak of the last 5 s, and a
  // spike gets one line naming the likely side. Page only: it sends nothing
  // to the other player and never touches the engine's channels.
  //
  // tools/test-netdiag-ping.js runs the block between the two marker lines
  // under a fake clock, so keep it self-contained (everything through env).
  // --- netdiag block begin ---
  function makePingDiag(env) {
    const SPIKE_MS = 250;   // a ping at or above this gets a verdict line
    const GAP_MS = 250;     // a frame gap at or above this is logged
    const RECENT_MS = 2500; // a pause that ended this recently explains a spike
    const PEAK_MS = 5000;   // the header's peak covers this long
    const SAME_MS = 3000;   // GGPO repeats its last reading until a new reply
    const QUIET_MS = 15000; // one verdict line per kind this often, so a steady
                            // high-ping pairing cannot push the bar's 12 lines off
    const N = 8;            // ping samples kept (about one a second)
    const pT = new Float64Array(N).fill(-1e12), pV = new Float64Array(N);
    let pI = 0;
    let netMs = -1;         // -1 = this browser or path gives none
    let lastTs = 0, visSeq = 0, seenVis = 0;
    let hiddenAt = env.doc.visibilityState === 'hidden' ? env.now() : -1;
    let pauseEnd = -1e12, pauseMs = 0, pauseHidden = false;
    let spikeMs = -1, spikeAt = -1e12;
    const said = { self: -1e12, net: -1e12, peer: -1e12 };
    let rafId = 0, live = true;
    const fmt = (ms) => ms < 1000 ? Math.round(ms) + ' ms' : (ms / 1000).toFixed(1) + ' s';

    // One callback per browser frame: compare numbers, write nothing. A
    // hidden window stops frames altogether; that gap is the hidden line's,
    // so a frame that sees a visibility change since the last one starts over.
    function frame(ts) {
      if (!live) return;
      rafId = env.raf(frame);
      if (visSeq !== seenVis) { seenVis = visSeq; lastTs = ts; return; }
      const gap = ts - lastTs;
      if (lastTs > 0 && gap >= GAP_MS) {
        pauseEnd = ts; pauseMs = gap; pauseHidden = false;
        env.log('frame gap ' + fmt(gap) + ' on this side - the game paused that long');
      }
      lastTs = ts;
    }
    function onVis() {
      if (!live) return;
      visSeq++;
      const now = env.now();
      if (env.doc.visibilityState === 'hidden') {
        if (hiddenAt < 0) {
          hiddenAt = now;
          env.log('window hidden - the game pauses until it is shown again');
        }
      } else if (hiddenAt >= 0) {
        const d = now - hiddenAt;
        hiddenAt = -1;
        pauseEnd = now; pauseMs = d; pauseHidden = true;
        env.log('window hidden ' + fmt(d) + ' - the game pauses while its window is hidden');
      }
    }
    env.doc.addEventListener('visibilitychange', onVis);
    rafId = env.raf(frame);

    return {
      net() { return netMs; },
      // The selected candidate pair from getStats (or null): seconds -> ms.
      netFromPair(pair) {
        const r = pair && pair.currentRoundTripTime;
        netMs = typeof r === 'number' && isFinite(r) && r >= 0 ? Math.round(r * 1000) : -1;
      },
      // Each game ping sample (setPing): keep it for the peak, and name the
      // likely side of a spike in one line.
      ping(ms) {
        const now = env.now();
        pT[pI] = now; pV[pI] = ms; pI = (pI + 1) % N;
        if (!(ms >= SPIKE_MS)) return;
        if (ms === spikeMs && now - spikeAt < SAME_MS) return; // the same reading again
        spikeMs = ms; spikeAt = now;
        // "This side" only when our own pause is big enough to explain the
        // spike (at least half of it): the short gap every match load logs
        // must not pin the other player's freeze on us.
        let why, kind;
        if (hiddenAt >= 0) { why = 'our window is hidden -> this side'; kind = 'self'; }
        else if (now - pauseEnd <= RECENT_MS && pauseMs * 2 >= ms) { why = 'our game paused ' + fmt(pauseMs) + (pauseHidden ? ' (window hidden)' : ' (frame gap)') + ' -> this side'; kind = 'self'; }
        else if (netMs >= SPIKE_MS || (netMs >= 0 && netMs * 2 >= ms)) { why = 'the network itself was slow'; kind = 'net'; }
        else { why = 'we ran steady -> their game paused or the path stalled'; kind = 'peer'; }
        if (now - said[kind] < QUIET_MS) return;
        said[kind] = now;
        env.log('ping ' + ms + ' ms, ' + (netMs >= 0 ? 'network ' + netMs + ' ms' : 'no network time') + ': ' + why);
      },
      // What the header adds after "ping Nms": the network time, and the
      // peak of the last 5 s when it is higher than the current ping.
      header(cur) {
        const now = env.now();
        let peak = -1;
        for (let i = 0; i < N; i++) if (now - pT[i] <= PEAK_MS && pV[i] > peak) peak = pV[i];
        // Compact: the Game only bar is about 100 characters wide and cuts the
        // tail (the byte counters, watchers) of anything longer.
        return (netMs >= 0 ? ' net ' + netMs : '') + (peak > cur ? ' peak ' + peak : '');
      },
      stop() {
        live = false;
        env.doc.removeEventListener('visibilitychange', onVis);
        if (rafId) env.caf(rafId);
        rafId = 0;
      },
    };
  }
  // --- netdiag block end ---
  const ndEnv = {
    now: () => performance.now(),
    log: (m) => netLog(m),
    raf: (f) => requestAnimationFrame(f),
    caf: (id) => cancelAnimationFrame(id),
    doc: document,
  };
  function ndStop() { if (nd) { nd.stop(); nd = null; } }

  async function makePeer() {
    const conn = pc = new RTCPeerConnection({ iceServers: await fetchIceServers() });
    let discTimer = null;
    pc.onconnectionstatechange = () => {
      if (conn !== pc) return; // a finished session's connection
      const st = pc.connectionState;
      netLog('connectionState: ' + st);
      if (st === 'failed') {
        // Do NOT hard-latch isClosed here. Chromium reports a transient
        // 'failed' MID-NEGOTIATION over the real internet and then recovers
        // to 'connected' - but latching isClosed=true poisoned the recovered
        // channel so read() returned null ("connection closed") even though
        // the transport was demonstrably alive (channel open, pings crossing).
        // Give 'failed' the same recovery grace as 'disconnected'.
        setStatus('Connection trouble - waiting for it to recover...');
        clearTimeout(discTimer);
        discTimer = setTimeout(() => {
          if (pc === conn && pc.connectionState === 'failed') {
            isFailed = true; isClosed = true;
            setStatus('Connection failed. Both players should retry (a VPN or hotspot can help stubborn routers).');
          }
        }, 12000);
      } else if (st === 'disconnected') {
        // Transient dips are normal (NAT remapping); give it time to
        // recover before declaring death. Killing instantly here is what
        // ended sessions that would have self-healed.
        setStatus('Connection unstable - waiting for it to recover...');
        clearTimeout(discTimer);
        discTimer = setTimeout(() => {
          if (pc === conn && pc.connectionState === 'disconnected') {
            isFailed = true; isClosed = true;
            setStatus('Connection lost and did not recover. Both players should retry.');
          }
        }, 12000);
      } else if (st === 'connected') {
        clearTimeout(discTimer);
        // Reaching 'connected' means the transport is genuinely alive (a
        // closed peer connection goes to 'closed', never back to 'connected'),
        // so clear any transient failure flags a mid-negotiation blip set.
        isFailed = false; isClosed = false;
        if (isConnected) setStatus('Connected! Return to the game window.');
      }
    };
    pc.oniceconnectionstatechange = () => { if (conn === pc) netLog('iceConnectionState: ' + pc.iceConnectionState); };
  }

  // Wait for ICE gathering so the offer/answer strings are complete
  // (avoids needing trickle-ICE signaling): 'complete', or GATHER_CAP_MS when
  // gathering never finishes (an unreachable STUN server).
  //
  // Never earlier than 'complete' (2026-11-17, plan 1.24): a rule that sent
  // the offer once a host and a srflx candidate were in, 250 ms later, broke
  // about one lobby match in three whose select screen lasted ~45 s (the
  // match host's engine stayed on select while the other went on, and the
  // session closed). Every failing offer went out just before 'complete', with
  // the same candidates the final description had; why that breaks the match
  // is not known, so this waits for 'complete' as 2.4.1 did. The 4 s wait it was meant to remove came from the old three Google STUN
  // hostnames, which after an idle fight often never reach 'complete'; the
  // single hostname in fetchIceServers completes in about 0.12 s.
  const GATHER_CAP_MS = 4000;
  function gatherComplete(conn) {
    const c = conn || pc; // a watcher's connection, or the players'
    return new Promise((resolve) => {
      if (c.iceGatheringState === 'complete') return resolve();
      const check = () => {
        if (c.iceGatheringState === 'complete') {
          c.removeEventListener('icegatheringstatechange', check);
          resolve();
        }
      };
      c.addEventListener('icegatheringstatechange', check);
      setTimeout(resolve, GATHER_CAP_MS); // fallback: use whatever gathered
    });
  }

  const enc = (o) => btoa(JSON.stringify(o));
  const dec = (s) => JSON.parse(atob(s.trim()));

  // ---------- signaling panel UI ----------
  function el(tag, style, text) {
    const e = document.createElement(tag);
    e.style.cssText = style || '';
    if (text) e.textContent = text;
    return e;
  }

  function showPanel(mode) {
    hidePanel();
    panel = el('div',
      'position:fixed;top:8px;right:8px;z-index:1000;background:#1c1c22;color:#eee;' +
      'border:1px solid #555;border-radius:8px;padding:12px;width:340px;' +
      'font:13px monospace;box-shadow:0 4px 16px #000a');
    // The engine listens for mouse/keyboard on the whole document; without
    // this, clicks can't focus the textareas and typing feeds the game.
    for (const t of ['mousedown', 'mouseup', 'click', 'dblclick', 'keydown', 'keyup', 'keypress', 'wheel', 'contextmenu']) {
      panel.addEventListener(t, (e) => e.stopPropagation());
    }
    panel.appendChild(el('div', 'font-weight:bold;margin-bottom:6px',
      // 'queue' covers BOTH queues, so the title has to read queueMode rather
      //
      // and the heading was never updated. startQueue() sets queueMode before
      // it calls showPanel(), so the value is already correct here.
      mode === 'host' ? 'NETPLAY - You are hosting'
        : mode === 'watch' ? 'NETPLAY - Watching a match'
        : mode === 'queue'
          ? 'NETPLAY - ' + (queueMode === 'casual' ? 'Casual match' : 'Ranked match')
          : 'NETPLAY - Joining a host'));
    // pre-line so a status can carry a second paragraph (the queue's
    // build-mismatch hint) without needing markup.
    const status = el('div', 'color:#9fd;margin-bottom:8px;min-height:16px;white-space:pre-line', 'Preparing connection...');
    panel.appendChild(status);
    panel.__status = status;

    const mkArea = (label, readonly) => {
      panel.appendChild(el('div', 'margin-top:6px;color:#aaa', label));
      const ta = el('textarea',
        'width:100%;height:64px;background:#111;color:#cfc;border:1px solid #444;' +
        'font:11px monospace;resize:none;box-sizing:border-box');
      ta.readOnly = !!readonly;
      panel.appendChild(ta);
      return ta;
    };

    const mkBtn = (label, fn) => {
      const b = el('button',
        'margin-top:6px;margin-right:6px;background:#333;color:#eee;border:1px solid #666;' +
        'border-radius:4px;padding:4px 10px;cursor:pointer;font:12px monospace', label);
      b.onclick = fn;
      panel.appendChild(b);
      return b;
    };

    const mkInput = (label, placeholder) => {
      panel.appendChild(el('div', 'margin-top:6px;color:#aaa', label));
      const inp = el('input',
        'width:100%;background:#111;color:#cfc;border:1px solid #444;' +
        'font:13px monospace;padding:4px 6px;box-sizing:border-box');
      inp.type = 'text';
      inp.placeholder = placeholder || '';
      inp.autocomplete = 'off';
      inp.spellcheck = false;
      panel.appendChild(inp);
      return inp;
    };

    //
    // the manual fallback in place).
    const clearBody = () => {
      while (panel.lastChild && panel.lastChild !== status) panel.removeChild(panel.lastChild);
    };

    document.body.appendChild(panel);
    return { mkArea, mkBtn, mkInput, clearBody, status };
  }

  function setStatus(msg) { if (panel && panel.__status) panel.__status.textContent = msg; }

  // One-click paste (clipboard permission prompt on first use). Falls back
  // to manual: the panel swallows its own events, so click + Ctrl+V works.
  function pasteInto(area) {
    if (navigator.clipboard && navigator.clipboard.readText) {
      navigator.clipboard.readText()
        .then((t) => { area.value = t.trim(); setStatus('Pasted from clipboard.'); })
        .catch(() => { area.focus(); setStatus('Clipboard blocked - click the box and press Ctrl+V.'); });
    } else {
      area.focus();
      setStatus('Click the box and press Ctrl+V.');
    }
  }
  function hidePanel() { if (panel) { panel.remove(); panel = null; } }

  // ---------- manual copy-paste flow (the original v1 path, kept as the
  // always-available fallback: works with zero infrastructure) ----------

  async function manualHostUI(ui) {
    const outArea = ui.mkArea('1. Send this OFFER code to your friend:', true);
    ui.mkBtn('Copy offer', () => { outArea.select(); document.execCommand('copy'); });
    const inArea = ui.mkArea("2. Paste your friend's ANSWER code:");
    ui.mkBtn('Paste answer', () => pasteInto(inArea));
    ui.mkBtn('Connect', async () => {
      try {
        await pc.setRemoteDescription(dec(inArea.value));
        setStatus('Answer accepted - connecting...');
      } catch (e) { setStatus('Bad answer code: ' + e.message); }
    });
    await makePeer();
    wireChannel(pc.createDataChannel('ikemen', { ordered: true }));
    wireGGPO(pc.createDataChannel('ggpo', { ordered: false, maxRetransmits: 0 }));
    await pc.setLocalDescription(await pc.createOffer());
    await gatherComplete();
    outArea.value = enc(pc.localDescription);
    setStatus('Waiting for answer code...');
  }

  async function manualJoinUI(ui) {
    const inArea = ui.mkArea("1. Paste the host's OFFER code:");
    ui.mkBtn('Paste offer', () => pasteInto(inArea));
    const outArea = ui.mkArea('2. Send this ANSWER code back to the host:', true);
    ui.mkBtn('Copy answer', () => { outArea.select(); document.execCommand('copy'); });
    await makePeer();
    pc.ondatachannel = (e) => {
      if (e.channel.label === 'ggpo') wireGGPO(e.channel);
      else wireChannel(e.channel);
    };
    ui.mkBtn('Generate answer', async () => {
      try {
        await pc.setRemoteDescription(dec(inArea.value));
        await pc.setLocalDescription(await pc.createAnswer());
        await gatherComplete();
        outArea.value = enc(pc.localDescription);
        setStatus('Send the answer to the host, then wait...');
      } catch (e) { setStatus('Bad offer code: ' + e.message); }
    });
    setStatus("Waiting for the host's offer code...");
  }

  // ---------- room-code flow (lobby signaling server) ----------
  // The server only swaps the SDP blobs; everything after the data channel
  // opens (ping, build hash, netcode check, the match) is identical to the
  // manual path.

  // 'identdown' and 'timeout' come from the Studio's host kit
  // (hostkit/relay.js); a relay that never sends them loses nothing. The 30
  // minutes in the 'timeout' text is the kit's room cap (ROOM_WAIT_MS there):
  // keep the two in step.
  function friendlyDeny(reason) {
    if (reason === 'identdown') return 'The online name server did not answer. Try again in a minute.';
    if (reason === 'timeout') return 'Nobody joined within 30 minutes, so the room closed. Create a new room to keep waiting.';
    return reason === 'badcode' ? 'No room with that code. Check the spelling - codes also expire about 30 minutes after being created.'
      : reason === 'badpass' ? 'Wrong password.'
        : reason === 'full' ? 'That room already has two players.'
          : reason === 'busy' ? 'The lobby hiccuped - press the button again.'
            : 'Denied: ' + reason;
  }

  // After the SDP exchange the signaling socket has done its job: close it
  // once the peer connection resolves either way, so the room frees up.
  //
  //
  //
  // signal that a set died is a socket closing while the pair is still mated -
  // which is exactly what this function does one second into every HEALTHY
  // match. Announce the handoff first so the DO can tell the two apart.
  //
  // Only on the isConnected branch: closing because the peer connection FAILED
  // is a real teardown and must still reach announceEnded().
  function releaseSignal(ws, queue) {
    const t = setInterval(() => {
      if (isConnected || isClosed || isFailed) {
        clearInterval(t);
        if (queue && isConnected) {
          try { ws.send(JSON.stringify({ t: 'playing' })); } catch { /* already gone */ }
        }
        ws.__done = true;
        try { ws.close(); } catch { /* already gone */ }
      }
    }, 1000);
  }

  function switchToManual(ui, mode, note) {
    try { if (pc) pc.close(); } catch { /* fresh one below */ }
    pc = null;
    ui.clearBody();
    if (mode === 'host') manualHostUI(ui); else manualJoinUI(ui);
    if (note) setStatus(note);
  }

  // The host's "Allow watchers" switch and watcher count: a square box and a
  // plain line (no pill), one click, live while the room waits. The switch
  // goes to the lobby ({t:'allow'}); the count comes back from it.
  function watchControls(ui) {
    //
    // to allow or count, so no switch.
    if (lobbyCan.state === 'no') return null;
    const row = el('label', 'display:flex;align-items:center;gap:8px;margin-top:8px;color:#ddd;cursor:pointer;user-select:none');
    const box = el('input', 'width:16px;height:16px;margin:0;accent-color:#5a5;cursor:pointer');
    box.type = 'checkbox';
    box.checked = watchAllow;
    box.title = 'Let people with the room code watch your matches';
    box.onchange = () => setWatchAllow(box.checked);
    row.appendChild(box);
    row.appendChild(el('span', '', 'Allow watchers'));
    const count = el('span', 'margin-left:auto;padding:1px 6px;background:#223;border:1px solid #446;color:#9cf;font:12px monospace',
      (watchCount || 0) + ' watching');
    row.appendChild(count);
    panel.appendChild(row);
    panel.__wcount = count;
    panel.__wallow = box;
    return box;
  }

  function roomHost(ui, url) {
    const mine = panel;   // the panel this room draws on (see the deny below)
    const passInp = ui.mkInput('Optional room password:', 'leave blank for none');
    watchControls(ui);
    let ws = null;
    const createBtn = ui.mkBtn('Create room', () => {
      createBtn.disabled = true;
      setStatus('Creating room...');
      let gotRoom = false;
      // Every room made here can take watchers (the switch says whether it
      // does now): the lobby keeps the room while this socket is open.
      ws = new WebSocket(url + (url.includes('?') ? '&' : '?') +
        'create=1&watchers=1&pass=' + encodeURIComponent(passInp.value.trim()));
      hostWs = ws;
      ws.onmessage = async (e) => {
        let m; try { m = JSON.parse(e.data); } catch { return; }
        try {
          if (hostWs === ws && wLobby(m)) return; // a watcher's handshake
          if (m.t === 'room') {
            gotRoom = true;
            if (globalThis.ikemenTest) globalThis.ikemenTest.room = m.code;
            netLog('room created: ' + m.code);
            if (!watchAllow) lobbySend({ t: 'allow', on: false });
            setWatchCount(0);
            ui.clearBody();
            panel.appendChild(el('div', 'margin-top:8px;color:#aaa', 'Give this room code to your friend:'));
            const codeEl = el('div',
              'margin-top:4px;padding:8px;background:#111;border:1px solid #464;border-radius:6px;' +
              'font:bold 20px monospace;color:#8f8;text-align:center;user-select:all', m.code);
            panel.appendChild(codeEl);
            ui.mkBtn('Copy code', () => {
              const r = document.createRange(); r.selectNodeContents(codeEl);
              const s = getSelection(); s.removeAllRanges(); s.addRange(r);
              document.execCommand('copy'); s.removeAllRanges();
              setStatus('Code copied.');
            });
            if (passInp.value.trim()) panel.appendChild(el('div', 'margin-top:6px;color:#886', "Don't forget to tell them the password too."));
            watchControls(ui);
            if (lobbyCan.state !== 'no') panel.appendChild(el('div', 'margin-top:4px;color:#888;font-size:11px', 'Watchers use the same code (and password) with "Watch a match".'));
            setStatus('Waiting for your friend to join...');
          } else if (m.t === 'peer') {
            setStatus('Friend joined! Connecting...');
            netLog('guest joined the room - sending offer');
            await makePeer();
            wireChannel(pc.createDataChannel('ikemen', { ordered: true }));
            wireGGPO(pc.createDataChannel('ggpo', { ordered: false, maxRetransmits: 0 }));
            await pc.setLocalDescription(await pc.createOffer());
            await gatherComplete();
            ws.send(JSON.stringify({ t: 'sdp', sdp: pc.localDescription }));
          } else if (m.t === 'sdp') {
            await pc.setRemoteDescription(m.sdp);
            setStatus('Connecting...');
            // The lobby socket stays open for the session: watchers reach the
            // host through it for their own handshake, and closing it ends
            // the room (ikemenNet.close).
          } else if (m.t === 'deny') {
            if (ws === hostWs && m.reason === 'timeout' && isConnected) { ws.__done = true; hostWs = null; return; }
            ws.__done = true;
            // A deny after the room was made (the host kit closes a room
            // nobody joined) ends that room: the code shown is dead and the
            // Create room button went with the body, so the panel starts
            // over. roomHost sets its own status, so the reason goes after.
            // Only on this room's own panel: closing the session leaves the
            // room's socket open, and its late deny must not redraw whatever
            // panel came after it (or none).
            if (panel !== mine) return;
            if (gotRoom) { ui.clearBody(); roomHost(ui, url); }
            else createBtn.disabled = false;
            setStatus(friendlyDeny(m.reason));
          } else if (m.t === 'bye') {
            // The guest's lobby socket closed. Once connected that is normal;
            // before, the guest left, and its seat stays taken (the lobby
            // lets one guest in per room), so the room starts over.
            if (!isConnected && panel === mine) {
              ws.__done = true;
              if (hostWs === ws) endHosting();
              try { if (pc) pc.close(); } catch { /* fresh one later */ }
              ui.clearBody();
              roomHost(ui, url);
              setStatus('Your friend left before the connection was made. Create a new room.');
            }
          }
        } catch (err) {
          netLog('room host error: ' + err.message);
          setStatus('Connection setup failed: ' + err.message);
        }
      };
      ws.onclose = () => {
        if (!ws.__done && !gotRoom) {
          switchToManual(ui, 'host', 'Lobby server unreachable - using manual connect instead.');
        }
      };
    });
    ui.mkBtn('Manual connect instead', () => {
      if (ws) { ws.__done = true; try { ws.close(); } catch { /* fine */ } }
      switchToManual(ui, 'host');
    });
    setStatus('Create a room and read the short code to your friend.');
    if (devnet && qp.get('nethost')) createBtn.click(); // dev switch, see "watching"
  }

  function roomJoin(ui, url) {
    const codeInp = ui.mkInput("Your friend's room code:", 'e.g. spicy-tiger-42');
    const passInp = ui.mkInput('Room password (if they set one):', '');
    let ws = null;
    const joinBtn = ui.mkBtn('Join room', () => {
      const code = codeInp.value.trim().toLowerCase();
      if (!code) { setStatus('Enter the room code first.'); return; }
      joinBtn.disabled = true;
      setStatus('Joining ' + code + '...');
      let joined = false;
      ws = new WebSocket(url + (url.includes('?') ? '&' : '?') +
        'join=' + encodeURIComponent(code) + '&pass=' + encodeURIComponent(passInp.value.trim()));
      ws.onmessage = async (e) => {
        let m; try { m = JSON.parse(e.data); } catch { return; }
        try {
          if (m.t === 'joined') {
            joined = true;
            // A room that takes watchers says so: this socket then stays
            // open for the count ({t:'wcount'}), and closes with the session.
            if (Number.isInteger(m.watchers)) { guestWs = ws; setWatchCount(m.watchers); }
            netLog('joined room ' + code);
            setStatus('In the room - waiting for the host to connect...');
            await makePeer();
            pc.ondatachannel = (ev) => {
              if (ev.channel.label === 'ggpo') wireGGPO(ev.channel);
              else wireChannel(ev.channel);
            };
          } else if (m.t === 'sdp') {
            await pc.setRemoteDescription(m.sdp);
            await pc.setLocalDescription(await pc.createAnswer());
            await gatherComplete();
            ws.send(JSON.stringify({ t: 'sdp', sdp: pc.localDescription }));
            setStatus('Connecting...');
            if (guestWs !== ws) releaseSignal(ws);
          } else if (m.t === 'wcount') {
            setWatchCount(m.n);
          } else if (m.t === 'deny') {
            ws.__done = true;
            joinBtn.disabled = false;
            setStatus(friendlyDeny(m.reason));
          } else if (m.t === 'bye') {
            if (!isConnected) { joinBtn.disabled = false; setStatus('The host left the room.'); }
          }
        } catch (err) {
          netLog('room join error: ' + err.message);
          setStatus('Connection setup failed: ' + err.message);
        }
      };
      ws.onclose = () => {
        if (!ws.__done && !joined) {
          joinBtn.disabled = false;
          switchToManual(ui, 'join', 'Lobby server unreachable - using manual connect instead.');
        }
      };
    });
    ui.mkBtn('Manual connect instead', () => {
      if (ws) { ws.__done = true; try { ws.close(); } catch { /* fine */ } }
      switchToManual(ui, 'join');
    });
    setStatus('Type the room code your friend gave you.');
    if (devnet && qp.get('netjoin')) { codeInp.value = qp.get('netjoin'); joinBtn.click(); } // dev switch
  }
  let guestWs = null; // a guest's lobby socket kept for the watcher count

  function startHost() {
    installHostWatchBridge(); // watchers are on by default; the switch turns them off
    const ui = showPanel('host');
    const url = signalUrl();
    if (url) roomHost(ui, url); else manualHostUI(ui);
  }

  function startJoin() {
    const ui = showPanel('join');
    const url = signalUrl();
    if (url) roomJoin(ui, url); else manualJoinUI(ui);
  }

  //
  // Strangers auto-paired by the signaling server, bucketed by build+netcode
  // so only byte-identical clients meet. Queueing requires a claimed online
  // name (identity.js): the server verifies name+recovery-code before
  // admitting, and each side receives the OPPONENT'S VERIFIED name - that is
  // what the in-match name plates show, never the raw config field. The
  // engine drives this via ikemenNet.start('queue') and polls queueRole()
  // to learn which side it is once the server pairs us.

  // queueMatchSeq counts MATCHES within one pairing. queueStartedAt is fixed
  // for the whole session, so on its own it keyed every match of a session to
  // the same id and the server discarded matches 2..N as duplicates - a pair
  // who played five games had one counted (field-hit 2026-08-11).
  let queueRole = '', queueP1 = '', queueP2 = '', queueStartedAt = 0, queueMatchSeq = 0;
  // Which queue we asked for, and whether the SERVER said this pairing is
  // rated. They are separate on purpose: queueMode is a local intent that
  // could be stale or wrong, queueRated is the server's answer and is the
  // only thing the report gate trusts.
  let queueMode = 'ranked', queueRated = false;
  // queueP1/queueP2 came from a lobby match (lobbyPlates), not the queue: the
  //
  // has no business in a lobby, so queueNames() leaves it off.
  let queueLobby = false;
  //
  //
  // on the result page is the whole set's swing, not just the last match -
  //
  let rankedBase = null, rankedStatusLine = '';

  //
  // module uses, so a build with identity disabled reports nowhere.
  const IDENTITY_URL = ((globalThis.IKEMEN_BRAND && globalThis.IKEMEN_BRAND.identityUrl) || '').replace(/\/+$/, '');

  //
  //
  // Everything here is best-effort DISPLAY data. It never gates a match, never
  // feeds reporting, and every failure path degrades to 'st=wait' so the page
  // prints "RATING UPDATE PENDING" rather than a wrong number. On the public
  // build IDENTITY_URL is blank, so all of it no-ops and the line is never
  // appended.
  function rankedIdentity() {
    try {
      const id = JSON.parse(localStorage.getItem('ikemen-identity'));
      return (id && id.name) ? id : null;
    } catch (e) { return null; }
  }

  //
  // null.
  function rankedSetLine(st, cur, rules) {
    const id = rankedIdentity();
    if (!IDENTITY_URL || !id) { rankedStatusLine = 'st=off'; return; }
    // 'you' is which ENGINE SIDE this player is: host is always side 1. The
    // Lua needs it to say "YOU WIN" instead of naming a player.
    const you = queueRole === 'host' ? 1 : (queueRole === 'guest' ? 2 : 0);
    const parts = ['you=' + you, 'st=' + st];
    if (st === 'ok' && cur) {
      const base = rankedBase || {};
      const delta = (typeof base.rating === 'number')
        ? (cur.rating - base.rating)
        : (cur.delta || 0);
      const ev = rankedTierEvents(base, cur, rules || null);
      parts.push('elo=' + cur.rating);
      parts.push('d=' + delta);
      parts.push('tier=' + (ev.tier || '?'));
      if (ev.placed) parts.push('placed=1');
      if (ev.ptier) parts.push('ptier=' + ev.ptier);
      if (ev.dtier) parts.push('dtier=' + ev.dtier);
      if (ev.pl) parts.push('pl=' + ev.pl);
    }
    rankedStatusLine = parts.join(';');
  }

  // The set's rank change for the result page, from the standing at pairing
  //
  //
  // promotion. Three DISTINCT events, which the first version conflated
  //
  //
  //
  //
  //
  // The host sets the ranks, so with the server's rules in hand both ends are
  //
  //
  // nobody played for, and the host's own names are ordered by the host's own
  // list. With no rules (a server from before them, or a failed read) it is
  // the built-in ladder, and a name not on it never reads as a climb or a fall.
  //
  function rankedTierEvents(base, cur, rules) {
    var LADDER = ['GRANDMASTER', 'MASTER', 'DIAMOND', 'PLATINUM', 'GOLD', 'SILVER', 'BRONZE'];
    var names = LADDER, from = base.tier, to = cur.tier, pl = cur.placement || 0;
    if (rules) {
      names = rules.ranks.map(function (r) { return r.name; });
      var cut = function (rating, games) {
        if (games < rules.placementGames) return 'UNRANKED';
        for (var i = 0; i < rules.ranks.length; i++) if (rating >= rules.ranks[i].min) return rules.ranks[i].name;
        return rules.ranks[rules.ranks.length - 1].name;
      };
      if (typeof base.rating === 'number' && typeof base.games === 'number') from = cut(base.rating, base.games);
      if (typeof cur.rating === 'number' && typeof cur.games === 'number') {
        to = cut(cur.rating, cur.games);
        pl = Math.max(0, rules.placementGames - cur.games);
      }
    }
    var out = { tier: to, pl: pl };
    if (from && to && from !== to) {
      // names run high to low: a smaller index is the higher rank.
      var a = names.indexOf(from), b = names.indexOf(to);
      if (from === 'UNRANKED') out.placed = true;
      else if (a >= 0 && b >= 0) {
        if (b < a) out.ptier = from;
        else out.dtier = from;
      }
    }
    return out;
  }

  //
  // min }] high to low }, or null. Public, no key. A server from before the
  // rules has no such route (404), and a failed read is no reason to hold the
  // result page, so both are null.
  function rankedFetchRules() {
    if (!IDENTITY_URL) return Promise.resolve(null);
    return fetch(IDENTITY_URL + '/mugen/leaderboard/rules')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (r) {
        const rules = r && r.ok ? r.rules : null;
        return (rules && Array.isArray(rules.ranks) && rules.ranks.length && typeof rules.placementGames === 'number') ? rules : null;
      })
      .catch(function () { return null; });
  }

  function rankedFetchMe() {
    const id = rankedIdentity();
    if (!IDENTITY_URL || !id) return Promise.resolve(null);
    return fetch(IDENTITY_URL + '/mugen/leaderboard/me?name=' + encodeURIComponent(id.name))
      .then(function (r) { return r.json(); })
      .then(function (r) { return (r && r.ok) ? r : null; })
      .catch(function () { return null; });
  }

  // --- NETWORK > YOUR RANK -------------------------------------------------
  //
  // Cached, never blocking. The Lua menu handler is synchronous and cannot
  // await a fetch, and main.f_warning bakes its text once before its input
  // loop - so a screen that waited would either freeze the menu or print
  // 'loading' forever. Instead the standing is fetched in the background and
  // this returns whatever is known RIGHT NOW, kicking a refresh when stale.
  //
  // The text is built HERE rather than in Lua on purpose: webrtc.js is a page
  // script served outside the pak, so wording changes need only a re-upload of
  // this file - no pak re-export and no Build ID change.
  let rankCache = null, rankFetchedAt = 0, rankInFlight = false;
  const RANK_STALE_MS = 30000;

  function rankRefresh(force) {
    if (rankInFlight) return;
    if (!force && rankCache && Date.now() - rankFetchedAt < RANK_STALE_MS) return;
    if (!IDENTITY_URL || !rankedIdentity()) return;
    rankInFlight = true;
    rankedFetchMe().then(function (r) {
      if (r) { rankCache = r; rankFetchedAt = Date.now(); }
      rankInFlight = false;
    }).catch(function () { rankInFlight = false; });
  }

  function rankLines(r) {
    const out = [];
    if (r.placement > 0) {
      out.push('UNRANKED');
      out.push('');
      out.push(r.placement + ' more ' + (r.placement === 1 ? 'match' : 'matches') + ' to be ranked');
      out.push('RATING  ' + Math.round(r.rating));
    } else {
      out.push(String(r.tier || '?'));
      out.push('');
      out.push('RATING  ' + Math.round(r.rating) +
        (typeof r.peakRating === 'number' && r.peakRating > r.rating
          ? '   PEAK ' + Math.round(r.peakRating) : ''));
    }
    out.push('RECORD  ' + (r.wins || 0) + '-' + (r.losses || 0) +
      '   ' + (r.games || 0) + ' played');
    // A streak is only worth a line when there IS one; +-1 is just the last
    // result restated and would read as noise on every single visit.
    const s = Number(r.streak) || 0;
    if (s >= 2) out.push('STREAK  ' + s + ' wins');
    else if (s <= -2) out.push('STREAK  ' + (-s) + ' losses');
    return out.join('\n');
  }

  // Snapshot at pairing. pairing == set, so this is the set's starting rating.
  function rankedSnapshot() {
    const id = rankedIdentity();
    if (!IDENTITY_URL || !id) { rankedStatusLine = 'st=off'; return; }
    rankedSetLine('wait', null);
    rankedFetchMe().then(function (r) {
      if (r) { rankedBase = { rating: r.rating, tier: r.tier, games: r.games }; }
    });
  }

  // Called after each report resolves. The SECOND reporter of a match gets the
  // numbers straight back; the FIRST gets state:'pending' with nothing
  // attached, because the rating has not moved yet - so it polls /me until the
  // opponent's half lands. A rage-quitting opponent never reports at all, so
  // this is capped and then simply stays 'wait'.
  function rankedResolve(reply) {
    if (!IDENTITY_URL || !rankedIdentity()) return;
    if (reply && reply.state === 'counted' && typeof reply.rating === 'number') {
      rankedFetchRules().then(function (rules) { rankedSetLine('ok', reply, rules); });
        // The rating just moved; refresh the cached standing so YOUR RANK
        // shows the new number rather than the pre-match one.
        rankRefresh(true);
      return;
    }
    let tries = 0;
    const poll = function () {
      if (++tries > 4) return;                 // ~6s, then leave it pending
      rankedFetchMe().then(function (r) {
        if (!r) { setTimeout(poll, 1500); return; }
        const base = rankedBase;
        // Only trust it once the opponent's half has actually landed, i.e. our
        // game count has moved past where the set began.
        if (base && typeof base.games === 'number' && r.games <= base.games) {
          setTimeout(poll, 1500);
          return;
        }
        rankedFetchRules().then(function (rules) { rankedSetLine('ok', r, rules); });
      });
    };
    poll();
  }

  //
  // never reported, never rated). It goes on the socket so the SERVER buckets
  // on it - the two queues are separate pools and never pair with each other.
  function startQueue(mode) {
    queueMode = mode === 'casual' ? 'casual' : 'ranked';
    const ui = showPanel('queue');
    const url = signalUrl();
    if (!url) {
      setStatus('No matchmaking server configured for this build. Use Host/Join with a friend instead.');
      return;
    }
    let identity = null;
    try { identity = JSON.parse(localStorage.getItem('ikemen-identity')) || null; } catch (e) { /* fall through */ }
    if (!identity || !identity.name || !identity.code) {
      setStatus((queueMode === 'casual' ? 'Casual match' : 'Ranked match') +
        ' needs a claimed online name. Set NETWORK > PLAYER NAME first, save the recovery code, then try again.');
      return;
    }
    // Fail CLOSED on a missing build hash: with strangers, "can't check"
    // must mean "can't queue", or mismatched builds meet and desync.
    // (Friend matches keep the lenient fallback - they can coordinate.)
    if (!(globalThis.ikemenBuildHash instanceof Uint8Array) || typeof globalThis.ikemenBuildHex !== 'string') {
      setStatus('Build ID unavailable - hard-refresh the page (Ctrl+F5) and try again.');
      return;
    }
    // THE BUCKET IS THE BUILD CHECK'S OWN HEX: the Build ID with the Engine ID
    // folded in (computeBuildHash), the same 16 hex digits a lobby is opened
    // and listed with. The content-only Build ID (ikemenBuildHex) put two
    // pages on different engines in one bucket after an engine-only update,
    // and the pair was then refused by the build check at connect. The relay
    // takes it as it is (lowercase hex of up to 64 digits), so no server
    // changes.
    if (!localHash) computeBuildHash();
    const queueBuild = localHash ? hex8(localHash) : '';
    if (!/^[0-9a-f]{16}$/.test(queueBuild)) {
      setStatus('Build ID unavailable - hard-refresh the page (Ctrl+F5) and try again.');
      return;
    }
    setStatus('Joining the queue as ' + identity.name + '...');
    const ws = new WebSocket(url + (url.includes('?') ? '&' : '?') +
      'queue=1&mode=' + queueMode +
      '&build=' + encodeURIComponent(queueBuild) +
      '&nc=' + localNetcode() +
      '&name=' + encodeURIComponent(identity.name) +
      '&code=' + encodeURIComponent(identity.code));
    let matched = false;
    // The queue is bucketed by Build ID (only byte-identical clients may be
    // paired, or lockstep desyncs instantly). That means a roster update
    // silently SPLITS the pool: someone on yesterday's cached build and
    // someone on today's each sit alone seeing "1 player waiting" with no
    // clue why. After a long wait alone, say so.
    let lonely = false;
    const lonelyTimer = setTimeout(() => { if (!matched) { lonely = true; renderQueueStatus(); } }, 20000);
    let lastCount = 1;
    function renderQueueStatus() {
      if (matched) return;
      let s = 'In queue as ' + identity.name + ' - ' + lastCount +
        (lastCount === 1 ? ' player waiting (that\'s you). Leave this open.' : ' players waiting...');
      if (lonely && lastCount === 1) {
        s += '\n\nNobody else is on your version of the build. If someone should be online, BOTH of you refresh the page (Ctrl+F5): updating the roster or the engine changes the Build ID or the Engine ID, and only identical builds on the same engine can be matched.';
      }
      setStatus(s);
    }

    ws.onmessage = async (e) => {
      let m; try { m = JSON.parse(e.data); } catch { return; }
      try {
        if (m.t === 'qcount') {
          lastCount = m.n;
          renderQueueStatus();
        } else if (m.t === 'match') {
          clearTimeout(lonelyTimer);
          matched = true;
          queueRole = m.role === 'host' ? 'host' : 'guest';
          // Server-supplied pairing time: both peers must key their result
          // report identically, so this must NOT come from a local clock.
          // NO local-clock fallback: the two peers must key their reports
          // identically, and Date.now() at millisecond precision would differ
          // per peer, silently filing the two halves of every match under
          // different ids so nothing ever agreed. Absent server time = don't
          // report (guarded in reportResult).
          queueStartedAt = Number(m.at) || 0;
          queueMatchSeq = 0;
          // RATEDNESS COMES FROM THE SERVER, never from the local button.
          //
          //
          //
          // failing closed loses a result, failing open corrupts the board.
          queueRated = m.mode === 'ranked';
          // New pairing == new set: re-baseline the rating snapshot and clear
          // the previous set's numbers so a stale delta can never be shown.
          rankedBase = null;
          rankedStatusLine = '';
          rankedSnapshot();
          const opp = String(m.opponent || 'opponent');
          // Host is always engine side 1.
          queueP1 = queueRole === 'host' ? identity.name : opp;
          queueP2 = queueRole === 'host' ? opp : identity.name;
          netLog('queue matched: ' + queueP1 + ' (P1) vs ' + queueP2 + ' (P2) - we are ' + queueRole);
          setStatus('Matched against ' + opp + '! Connecting...');
          if (queueRole === 'host') {
            await makePeer();
            wireChannel(pc.createDataChannel('ikemen', { ordered: true }));
            wireGGPO(pc.createDataChannel('ggpo', { ordered: false, maxRetransmits: 0 }));
            await pc.setLocalDescription(await pc.createOffer());
            await gatherComplete();
            ws.send(JSON.stringify({ t: 'sdp', sdp: pc.localDescription }));
          } else {
            await makePeer();
            pc.ondatachannel = (ev) => {
              if (ev.channel.label === 'ggpo') wireGGPO(ev.channel);
              else wireChannel(ev.channel);
            };
          }
        } else if (m.t === 'sdp') {
          if (queueRole === 'host') {
            await pc.setRemoteDescription(m.sdp);
          } else {
            await pc.setRemoteDescription(m.sdp);
            await pc.setLocalDescription(await pc.createAnswer());
            await gatherComplete();
            ws.send(JSON.stringify({ t: 'sdp', sdp: pc.localDescription }));
          }
          setStatus('Connecting...');
          releaseSignal(ws, true);
        } else if (m.t === 'deny') {
          ws.__done = true;
          clearTimeout(lonelyTimer);
          // 'timeout' here is the host kit's queue cap (QUEUE_WAIT_MS in
          // hostkit/relay.js), not the room one friendlyDeny describes.
          setStatus(m.reason === 'badident'
            ? 'Your online name could not be verified. Re-set NETWORK > PLAYER NAME (or recover it), then try again.'
            : m.reason === 'timeout' ? 'No opponent was found within 10 minutes, so the search stopped. Enter the queue again to keep looking.'
            : friendlyDeny(m.reason));
        } else if (m.t === 'bye') {
          if (!isConnected) setStatus('Your opponent disconnected during setup. Re-enter the queue to search again.');
        }
      } catch (err) {
        netLog('queue error: ' + err.message);
        setStatus('Connection setup failed: ' + err.message);
      }
    };
    ws.onclose = () => {
      clearTimeout(lonelyTimer);
      if (!ws.__done && !matched && !isConnected) {
        setStatus('Matchmaking server unreachable. Try again in a minute, or use Host/Join with a friend.');
      }
    };
    // Leaving netplay (Esc in-game) closes the session; take the queue
    // socket down with it so the server frees the slot.
    const leaveWatch = setInterval(() => {
      if (isClosed) {
        clearInterval(leaveWatch); clearTimeout(lonelyTimer);
        ws.__done = true; try { ws.close(); } catch { /* gone */ }
      }
      if (ws.readyState > 1) clearInterval(leaveWatch);
    }, 1000);
  }

  // Prime the standing shortly after boot so the first NETWORK > YOUR RANK
  // visit already has something to show. Cheap, once, and silent on failure.
  setTimeout(function () { rankRefresh(true); }, 9000);
  // A finished set moves the rating, so invalidate rather than serve a stale
  // number to a player who just went to look at it.
  globalThis.addEventListener('ikemen-rank-dirty', function () { rankRefresh(true); });

  // ---------- watching (spectating) ----------
  // A watcher runs the players' match from the host's confirmed inputs (the
  // engine half is src/watch.go). The host's page holds one RTCPeerConnection
  // per watcher, separate from the players' `pc`, with two channels: 'ggpo'
  // (unordered, the watcher's GGPO datagrams, addressed by slot) and 'ctl'
  // (ordered: the build check and the engine's select/start/drop/end
  // messages). Match setup never goes through the lobby, which only swaps the
  // watcher's SDP with the host. A watcher's connection failing, closing or
  // lagging touches nothing of the players' (no shared state with `pc`, `dc`,
  // `gdc` or their flags), and the engine drops a watcher on its own.
  //
  // THE UI. Host: the room panel's "Allow watchers" switch (on by default; one
  // click, changeable while waiting; off refuses new watchers and lets go of
  // the ones there) and the watcher count, in the panel while waiting and on
  // the NETPLAY line during the match. The guest sees the count on its NETPLAY
  // line. Watcher: the online menu's WATCH A MATCH calls ikemenNet.start('watch'),
  // which shows the watch panel (room code, password, Watch, Leave) and the
  // engine's waiting screen until the host's next match starts.
  //
  //
  // &watchers=1 takes watchers. ?watch=CODE[&pass=] -> watcher {t:'watching'},
  // host {t:'watcher', id}; host {t:'sdp', to:id, sdp} -> watcher {t:'sdp',
  // sdp}; watcher {t:'sdp', sdp} -> host {t:'sdp', from:id, sdp}; host {t:'wdeny',
  // to:id, reason} -> watcher {t:'deny', reason}; host {t:'allow', on}; a
  // watcher leaving -> host {t:'wbye', id}; both players {t:'wcount', n}.
  //
  // DEV SWITCH (?devnet=1, off by default; the tests use it). Only with it:
  //   ?nethost=1               index.html starts a quick match (?p1=) as the
  //                            netplay host and this page creates its room
  //                            without a click
  //   ?netjoin=CODE            the quick match's guest; joins room CODE
  //   ?watch=CODE              the engine starts with -watch and this page
  //                            watches room CODE without the panel's click
  //   ?crctrail=1              records the per-frame checksum trail, read with
  //                            globalThis.ikemenTest.trail(): a player's from the
  //                            GGPO input datagrams it sends (each carries the
  //                            checksum of its frame - 16), a watcher's from the
  //                            engine (ikemenWatch.trail)
  //   ?buildsalt=TEXT          mixes TEXT into this page's Build ID (a watcher on
  //                            a "different build", to see it refused)
  //   globalThis.ikemenTest    what a test driver reads (room, trail, slots,
  //                            refused, closed, count)
  // Watchers per room: hard cap 32 (GGPO's MaxSpectators), 8 by default (the
  // lobby's cap too).
  const WATCH_CAP = 32, WATCH_DEFAULT = 8;
  const WATCH_MAX = Math.min(WATCH_CAP, WATCH_DEFAULT);
  // The only ctl messages each side accepts; anything else is dropped, and a
  // watcher that keeps sending junk is cut off.
  const CTL_FROM_WATCHER = ['hello'];
  const CTL_FROM_HOST = ['verified', 'refused', 'select', 'nowatch', 'start', 'drop', 'end', 'late'];
  const CTL_MAX_BYTES = 64 * 1024; // an end message carries 256 frames of input
  const GGPO_MAX_BYTES = 1024;     // no GGPO message is bigger
  // What one watcher may send on its GGPO channel. An honest watcher sent
  // about 200 datagrams a second in a full match, with or without a 500 ms
  // round trip (an ack per frame it takes in, its own input packet every
  // poll, keep-alives, quality reports); the budget is twice that, spent
  // first and refilled continuously. Past it a datagram is dropped unread, and a
  // watcher that keeps going past it (more than WATCH_RATE drops within a
  // second) is cut off: each datagram costs the host's page an event, so it
  // must not get to send many.
  const WATCH_RATE = 400, WATCH_BURST = 800;            // datagrams/s, burst
  const WATCH_BYTES = 64 * 1024, WATCH_BYTES_BURST = 128 * 1024;
  const WATCH_QUEUE = 256;         // datagrams held per watcher for the engine
  const hex8 = (u8) => Array.from(u8 || [], (b) => b.toString(16).padStart(2, '0')).join('');

  // ---- checksum trail (dev switch) ----
  const crcTrail = new Map();
  const trailOn = devnet && !!qp.get('crctrail');
  function trailFromDatagram(u) {
    // An outgoing GGPO input message (internal/messages InputPacket.ToBytes):
    // header 5 (type at [4] = 3), status count n at [5], n x 5 bytes, start
    // frame 4, disconnect 1, ack 4, checksum 4, bit count 2, input size 1,
    // byte count 1, inputs. The checksum is that of (last frame - 16).
    if (u.length < 23 || u[4] !== 3) return;
    const dv = new DataView(u.buffer, u.byteOffset, u.byteLength);
    let o = 6 + 5 * u[5];
    if (u.length < o + 17) return;
    const start = dv.getUint32(o), crc = dv.getUint32(o + 9), size = u[o + 15], bytes = u[o + 16];
    if (!size || !bytes) return;
    const f = start + bytes / size - 1 - 16;
    if (f >= 0) trailSet(f, crc);
  }
  // Every datagram the engine hands sendGGPO, open channel or not. While its
  // rollback loop runs it sends at least every 200 ms (GGPO's keep-alive);
  // the newest frame of its input messages (the layout above) stops moving
  // when the loop waits for the other player's inputs.
  function ggpoTrack(u) {
    const now = Date.now();
    ggpoLive.sentAt = now;
    if (!u || u.length < 23 || u[4] !== 3) return;
    const o = 6 + 5 * u[5];
    if (u.length < o + 17) return;
    const size = u[o + 15], bytes = u[o + 16];
    if (!size || !bytes) return;
    const last = new DataView(u.buffer, u.byteOffset, u.byteLength).getUint32(o) + bytes / size - 1;
    if (last > ggpoLive.top) { ggpoLive.top = last; ggpoLive.topAt = now; }
  }

  // ---- what the players see: the watcher count ----
  // null: not a room that takes watchers (nothing shown). Set from the
  // lobby's {t:'wcount', n}, which reaches the host and a guest that keeps its
  // lobby socket (a guest of a watch room does).
  function setWatchCount(n) {
    watchCount = Number.isInteger(n) && n >= 0 ? n : 0;
    if (panel && panel.__wcount) panel.__wcount.textContent = watchCount + ' watching';
    if (diag) renderDiag();
  }
  function watchCountLabel() { return watchCount === null ? '' : ' | ' + watchCount + ' watching'; }

  // ---- host side ----
  // slot -> the watcher in it now: { id, pc, ctl, g, verified, closed,
  // offered, bad, q (its datagrams for the engine), budget state }. A slot is
  // reused once its watcher closes, so everything the engine does for a match
  // goes by the watcher OBJECT the match registered (wReg), never by whoever
  // holds the slot now: a newcomer in a reused slot can neither speak for the
  // watcher the match registered nor make the engine think it closed.
  const wslots = [];
  let wOffer = null, wOfferMatch = 0, wStarted = 0;
  // The lobby match this page was playing when its engine made that offer
  // (0: none, or a room): an offer left from an earlier lobby match is not
  // the watcher's match.
  let wOfferLobby = 0;
  let wReg = [], wRegList = [], wRR = 0; // this match's watchers: by slot, in order; round-robin
  let hostWs = null;      // the host's lobby socket (watchers reach the host through it)
  let watchAllow = true;  // the host's "Allow watchers" switch

  function lobbySend(obj) {
    // In a winner-stays lobby the match host's watcher handshakes go through
    // the lobby socket (same messages: {t:'sdp', to}, {t:'wdeny', to}).
    const ws = lobbyOn() ? lobby.ws : hostWs;
    try { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); } catch { /* gone */ }
  }
  function wCtlSend(s, obj) {
    const raw = typeof obj === 'string' ? obj : JSON.stringify(obj);
    if (!s || s.closed || !s.ctl || s.ctl.readyState !== 'open') return false;
    try { s.ctl.send(raw); return true; } catch { return false; }
  }
  function wClose(slot, why) {
    const s = wslots[slot];
    if (!s || s.closed) return;
    s.closed = true;
    s.q.length = 0;
    netLog('watcher ' + slot + ' closed: ' + why);
    // The engine learns it from readAny (its match registration says closed).
    try { s.pc.close(); } catch { /* gone */ }
  }
  // The host's switch. Off: the lobby refuses new watchers, and the ones in
  // the room are let go with the reason.
  function setWatchAllow(on) {
    watchAllow = !!on;
    lobbySend({ t: 'allow', on: watchAllow });
    netLog('watchers ' + (watchAllow ? 'allowed' : 'not allowed'));
    if (!watchAllow) {
      wslots.forEach((s, i) => {
        if (!s || s.closed) return;
        wCtlSend(s, { t: 'refused', why: 'off' });
        lobbySend({ t: 'wdeny', to: s.id, reason: 'nowatch' });
        setTimeout(() => wClose(i, 'the host turned watching off'), 500);
      });
    }
  }
  // Spends one datagram of a watcher's budget; false when it is over (the
  // datagram is dropped), and a watcher that stays over is cut off.
  function wBudget(slot, s, bytes) {
    const now = performance.now();
    const dt = Math.max(0, now - s.bAt) / 1000;
    s.bAt = now;
    s.tok = Math.min(WATCH_BURST, s.tok + dt * WATCH_RATE);
    s.btok = Math.min(WATCH_BYTES_BURST, s.btok + dt * WATCH_BYTES);
    if (s.tok >= 1 && s.btok >= bytes) { s.tok -= 1; s.btok -= bytes; return true; }
    if (now - s.overAt > 1000) { s.overAt = now; s.over = 0; }
    s.dropped++;
    if (++s.over > WATCH_RATE) wClose(slot, 'sent too much (over its datagram budget)');
    return false;
  }
  function wOfferTo(s, slot) {
    // A watcher that verifies during a match waits for the next one. A lobby
    // watcher is told so when the match it was put to watch is the one that
    // already started (page only, its engine never sees it): before that it
    // cannot know whether the select is still to come.
    if (!wOffer) return;
    if (wStarted >= wOfferMatch) {
      if (s.lmatch && s.lmatch === wOfferLobby && s.late !== s.lmatch && wCtlSend(s, { t: 'late', match: s.lmatch })) s.late = s.lmatch;
      return;
    }
    if (wCtlSend(s, wOffer)) s.offered = wOfferMatch;
  }
  function wOnCtl(slot, e) {
    const s = wslots[slot];
    if (!s || s.closed) return;
    let m = null;
    if (typeof e.data === 'string' && e.data.length <= 4096) {
      try { m = JSON.parse(e.data); } catch { m = null; }
    }
    if (!m || typeof m !== 'object' || !CTL_FROM_WATCHER.includes(m.t)) {
      if (++s.bad > 20) wClose(slot, 'too many invalid messages');
      return;
    }
    if (m.t === 'hello') {
      if (s.verified || s.helloSeen) { // one hello per watcher
        if (++s.bad > 20) wClose(slot, 'too many invalid messages');
        return;
      }
      s.helloSeen = true;
      const judge = () => {
        if (!localHash) { setTimeout(judge, 100); return; }
        const build = typeof m.build === 'string' ? m.build : '';
        if (build !== hex8(localHash)) {
          netLog('watcher ' + slot + ': BUILD MISMATCH, refused');
          wCtlSend(s, { t: 'refused', why: 'build' });
          setTimeout(() => wClose(slot, 'different build'), 1500);
          return;
        }
        if (m.nc !== 1 || localNetcode() !== 1) {
          wCtlSend(s, { t: 'refused', why: 'netcode' });
          setTimeout(() => wClose(slot, 'not rollback'), 1500);
          return;
        }
        s.verified = true;
        netLog('watcher ' + slot + ': build check OK');
        wCtlSend(s, { t: 'verified' });
        wOfferTo(s, slot);
      };
      judge();
    }
  }
  async function wAdd(id, lmatch) {
    let slot = -1;
    for (let i = 0; i < WATCH_MAX; i++) if (!wslots[i] || wslots[i].closed) { slot = i; break; }
    if (slot < 0) { lobbySend({ t: 'wdeny', to: id, reason: 'watchfull' }); return; }
    const s = { id, pc: null, ctl: null, g: null, verified: false, closed: false, offered: 0, bad: 0,
      q: [], reg: 0, out: 0, bAt: performance.now(), tok: WATCH_BURST, btok: WATCH_BYTES_BURST,
      over: 0, overAt: 0, rx: 0, dropped: 0, lmatch: lmatch || 0 };
    wslots[slot] = s;
    s.pc = new RTCPeerConnection({ iceServers: await fetchIceServers() });
    s.ctl = s.pc.createDataChannel('ctl', { ordered: true });
    s.g = s.pc.createDataChannel('ggpo', { ordered: false, maxRetransmits: 0 });
    s.g.binaryType = 'arraybuffer';
    s.ctl.onmessage = (e) => wOnCtl(slot, e);
    s.ctl.onclose = () => wClose(slot, 'control channel closed');
    s.g.onclose = () => wClose(slot, 'ggpo channel closed');
    s.g.onmessage = (e) => {
      if (s.closed) return;
      const d = e.data;
      s.rx++;
      if (!wBudget(slot, s, typeof d === 'string' ? d.length : (d && d.byteLength) || 0)) return;
      // Forwarded only while this watcher is registered in the running match
      // and the engine has not dropped it from it.
      if (!s.verified || s.reg !== wStarted || s.out === wStarted || !(d instanceof ArrayBuffer)) return;
      if (d.byteLength < 5 || d.byteLength > GGPO_MAX_BYTES || s.q.length >= WATCH_QUEUE) return;
      const out = new Uint8Array(d.byteLength + 1);
      out[0] = slot; out.set(new Uint8Array(d), 1);
      s.q.push(out);
    };
    s.pc.onconnectionstatechange = () => {
      const st = s.pc.connectionState;
      if (st === 'failed' || st === 'closed') wClose(slot, 'connection ' + st);
    };
    await s.pc.setLocalDescription(await s.pc.createOffer());
    await gatherComplete(s.pc);
    lobbySend({ t: 'sdp', to: id, sdp: s.pc.localDescription });
    netLog('watcher ' + slot + ' joining (lobby id ' + id + ')');
  }
  // Lobby messages about watchers, on the host's socket. True when handled.
  function wLobby(m) {
    if (m.t === 'watcher' && Number.isInteger(m.id)) {
      if (!watchAllow) { lobbySend({ t: 'wdeny', to: m.id, reason: 'nowatch' }); return true; }
      wAdd(m.id).catch((e) => netLog('watcher setup failed: ' + e.message));
      return true;
    }
    if (m.t === 'sdp' && m.from !== undefined) {
      const s = wslots.find((x) => x && !x.closed && x.id === m.from);
      if (s) s.pc.setRemoteDescription(m.sdp).catch((e) => netLog('watcher answer refused: ' + e.message));
      return true;
    }
    if (m.t === 'wbye') {
      const i = wslots.findIndex((x) => x && !x.closed && x.id === m.id);
      if (i >= 0) wClose(i, 'left the room');
      return true;
    }
    if (m.t === 'wcount') { setWatchCount(m.n); return true; }
    return false;
  }
  function installHostWatchBridge() {
    if (globalThis.ikemenWatch && globalThis.ikemenWatch.role === 'host') return;
    globalThis.ikemenWatch = {
      role: 'host',
      offer(match, raw) {
        wOffer = String(raw); wOfferMatch = match;
        wOfferLobby = lobbyOn() && lobby && lobby.inMatch ? lobby.playing || 0 : 0;
        wslots.forEach((s, i) => { if (s && s.verified && !s.closed) wOfferTo(s, i); });
      },
      // Asked once per GGPO session: a Turns match asks again with the SAME
      // match for each turn (the engine keeps one watch match across its
      // turns), and a watcher dropped from an earlier turn of it stays out.
      start(match) {
        wStarted = match;
        wReg = []; wRegList = []; wRR = 0;
        const out = [];
        wslots.forEach((s, i) => {
          if (!s || !s.verified || s.closed || s.offered !== match || s.out === match) return;
          s.reg = match; s.q.length = 0;
          wReg[i] = s; wRegList.push({ slot: i, s, goneSent: false });
          out.push(i);
        });
        return out;
      },
      // To the watcher this match registered in that slot (the start, drop
      // and end messages), else to the slot's watcher.
      ctl(slot, raw) {
        const s = wReg[slot] || wslots[slot];
        raw = String(raw);
        // Dropped from this match: its datagrams are no longer forwarded. It
        // keeps its connection and may watch the next match.
        if (s && raw.startsWith('{"t":"drop"')) { s.out = wStarted; s.q.length = 0; }
        wCtlSend(s, raw);
      },
      sendTo(slot, u8) {
        const s = wReg[slot];
        if (!s || s.closed || s.out === wStarted || !s.g || s.g.readyState !== 'open') return false;
        try { s.g.send(u8); return true; } catch { return false; }
      },
      // One datagram from this match's watchers, taking turns; [slot] alone
      // when the watcher registered in that slot has closed (said once).
      // numEmpty: answer 0 instead of an empty array when nothing waits (an engine
      // that asks polls this every millisecond; a number costs it no JS object).
      readAny(numEmpty) {
        const n = wRegList.length;
        for (let k = 0; k < n; k++) {
          const i = (wRR + k) % n, r = wRegList[i];
          if (r.s.q.length) { wRR = (i + 1) % n; return r.s.q.shift(); }
          if (r.s.closed && !r.goneSent) { r.goneSent = true; wRR = (i + 1) % n; return new Uint8Array([r.slot]); }
        }
        return numEmpty ? 0 : new Uint8Array(0);
      },
      log(msg) { netLog('watch: ' + msg); },
      slots() {
        return wslots.map((s, i) => s && { slot: i, verified: s.verified, closed: s.closed, offered: s.offered,
          reg: s.reg, out: s.out, rx: s.rx, dropped: s.dropped, queued: s.q.length });
      },
    };
  }
  // The room is over (the netplay session closed): the lobby socket goes, so
  // the room ends there too, and every watcher's connection with it.
  function endHosting() {
    if (hostWs) { hostWs.__done = true; try { hostWs.close(); } catch { /* gone */ } }
    hostWs = null;
    // A lobby page that already has its next match to host keeps that match's
    // watchers (they arrived while this one was ending).
    const keep = lobby && lobby.assign && lobby.assign.kind === 'play' && lobby.assign.role === 'host' &&
      lobby.assign.match !== lobby.playing ? lobby.assign.match : -1;
    wslots.forEach((s, i) => { if (s && !s.closed && !(keep > 0 && s.lmatch === keep)) wClose(i, 'the session ended'); });
    watchAllow = true;
  }

  // ---- watcher side ----
  const wq = [], wg = [];
  let wpc = null, wctl = null, wgdc = null, wClosed = false, wWs = null, wSeen = false;
  // The match a Turns select offered (0: none). Its ends are turns, each a
  // GGPO session of the same match, and the page cannot tell the last one
  // from the others, so each says "Turn over".
  let wTurnsMatch = 0;
  function watchStatus(msg) { setStatus(msg); netLog('watch: ' + msg); }
  function installWatcherBridge() {
    wq.length = 0; wg.length = 0; wClosed = false;
    globalThis.ikemenWatch = {
      role: 'watcher',
      next() { return wq.length ? wq.shift() : (wClosed ? null : ''); },
      sendGGPO(u8) {
        if (!wgdc || wgdc.readyState !== 'open') return false;
        try { wgdc.send(u8); return true; } catch { return false; }
      },
      readGGPO(numEmpty) { return wg.length ? wg.shift() : (wClosed ? null : (numEmpty ? 0 : new Uint8Array(0))); },
      log(msg) { netLog('watch: ' + msg); },
      leave() { leaveWatch('You left.'); },
    };
    if (trailOn) globalThis.ikemenWatch.trail = (f, crc) => { trailSet(f, crc); };
  }
  function dropWatchConn() {
    try { if (wWs) { wWs.__done = true; wWs.close(); } } catch { /* gone */ }
    try { if (wpc) wpc.close(); } catch { /* gone */ }
    wWs = null; wpc = null; wctl = null; wgdc = null;
  }
  // The end of watching: the engine goes back to its menu (next() says the
  // host is gone), and the panel says why (or goes, when the watcher left).
  function leaveWatch(why, keepPanel) {
    if (wClosed && !keepPanel) { hidePanel(); return; }
    wClosed = true;
    dropWatchConn();
    if (keepPanel) {
      watchStatus(why);
      if (panel && panel.__leave) panel.__leave.textContent = 'Close';
    } else {
      netLog('watch: ' + why);
      hidePanel();
    }
  }
  function friendlyWatchDeny(reason) {
    return reason === 'badcode' ? 'No room with that code. Check the spelling, or ask the host for a fresh one.'
      : reason === 'badpass' ? 'Wrong password (this room has one: ask the host).'
        : reason === 'nowatch' ? 'The host is not taking watchers in this room.'
          : reason === 'watchfull' ? 'This room already has as many watchers as it takes (' + WATCH_MAX + ').'
            : reason === 'slowdown' ? 'Too many people tried to watch this room in the last minute. Try again shortly.'
              : reason === 'timeout' ? 'The room closed.'
                : reason === 'build' ? 'Game contents differ from the host\'s, so this match cannot be watched. Both sides need the same build (and the same engine).'
                  : reason === 'netcode' ? 'The host is not on rollback netcode, so this match cannot be watched.'
                    : 'Refused: ' + reason;
  }
  // What the host's engine said about a match, on the panel.
  function watchNote(mm) {
    if (mm.t === 'select') {
      wTurnsMatch = Array.isArray(mm.teamMode) && mm.teamMode.includes(2) ? mm.match : 0; // 2: TM_Turns
      watchStatus('A match is starting - watching.');
      setTimeout(() => { if (!wClosed) hidePanel(); }, 2500);
    } else if (mm.t === 'nowatch') { watchStatus('This match cannot be watched: ' + (mm.why || '') + '. Waiting for the next match.'); showWatchPanelAgain(); }
    else if (mm.t === 'drop') { watchStatus('Dropped from this match: ' + (mm.why || 'no reason given') + '. Waiting for the next match.'); showWatchPanelAgain(); }
    else if (mm.t === 'end') { watchStatus(wTurnsMatch && mm.match === wTurnsMatch ? 'Turn over.' : 'Match over. Waiting for the next match.'); }
  }
  function showWatchPanelAgain() { if (!panel && !wClosed && !(lobby && lobby.watch)) watchPanel(true); }
  function startWatch(code, pass) {
    dropWatchConn();
    wq.length = 0; wg.length = 0; wSeen = false;
    const url = signalUrl();
    if (!url) { watchStatus('Watching needs the lobby server, and this build has none.'); return false; }
    watchStatus('Looking for room ' + code + '...');
    const ws = wWs = new WebSocket(url + (url.includes('?') ? '&' : '?') + 'watch=' + encodeURIComponent(code) +
      (pass ? '&pass=' + encodeURIComponent(pass) : ''));
    ws.onmessage = async (e) => {
      if (ws !== wWs) return;
      let m; try { m = JSON.parse(e.data); } catch { return; }
      try {
        if (m.t === 'deny') {
          ws.__done = true;
          if (wSeen) leaveWatch(friendlyWatchDeny(m.reason), true);
          else { watchStatus(friendlyWatchDeny(m.reason)); if (panel && panel.__watchBtn) panel.__watchBtn.disabled = false; }
          return;
        }
        if (m.t === 'bye') { leaveWatch('The host closed the room.', true); return; }
        if (m.t === 'watching') { wSeen = true; watchStatus('In the room - connecting to the host...'); return; }
        if (m.t !== 'sdp' || wpc) return;
        await watchAnswer(m.sdp, (sdp) => ws.send(JSON.stringify({ t: 'sdp', sdp })));
      } catch (err) { netLog('watch setup failed: ' + err.message); }
    };
    ws.onclose = () => {
      if (ws === wWs && !ws.__done && !wpc) {
        watchStatus('The lobby server could not be reached.');
        if (panel && panel.__watchBtn) panel.__watchBtn.disabled = false;
      }
    };
    return true;
  }
  // The watcher's side of the host's offer: its connection, the build check
  // (hello), the host's control messages for the engine; the answer goes back
  // through `send` (the watch socket, or a lobby's).
  async function watchAnswer(offer, send) {
    const conn = wpc = new RTCPeerConnection({ iceServers: await fetchIceServers() });
    conn.onconnectionstatechange = () => {
      const st = conn.connectionState;
      netLog('watch connectionState: ' + st);
      if (conn === wpc && (st === 'failed' || st === 'closed')) leaveWatch('The connection to the host was lost.', true);
    };
    conn.ondatachannel = (ev) => {
      const ch = ev.channel;
      if (ch.label === 'ggpo') {
        wgdc = ch; ch.binaryType = 'arraybuffer';
        ch.onmessage = (x) => {
          if (!(x.data instanceof ArrayBuffer) || x.data.byteLength > GGPO_MAX_BYTES) return;
          wg.push(new Uint8Array(x.data));
        };
        ch.onclose = () => { if (conn === wpc) leaveWatch('The host closed the connection.', true); };
      } else if (ch.label === 'ctl') {
        wctl = ch;
        ch.onopen = () => {
          const hello = () => {
            if (!localHash) { setTimeout(hello, 100); return; }
            ch.send(JSON.stringify({ t: 'hello', build: hex8(localHash), nc: localNetcode() }));
            watchStatus('Connected - checking the build...');
          };
          hello();
        };
        ch.onmessage = (x) => {
          if (typeof x.data !== 'string' || x.data.length > CTL_MAX_BYTES) return;
          let mm; try { mm = JSON.parse(x.data); } catch { return; }
          if (!mm || !CTL_FROM_HOST.includes(mm.t)) return;
          if (mm.t === 'verified') { watchStatus('Waiting for the next match.'); return; }
          if (mm.t === 'late') {
            if (lobby && lobby.watch && mm.match === lobby.watch.match && !lobby.watch.started) {
              lobby.watch.late = true;
              netLog('watch: this match started before you joined. You are in line for the next one.');
              lobbyRender();
            }
            return;
          }
          if (mm.t === 'refused') {
            const why = mm.why === 'off' ? 'The host turned watching off.' : friendlyWatchDeny(mm.why === 'build' ? 'build' : 'netcode');
            globalThis.ikemenWatchRefused = why;
            leaveWatch(why, true);
            return;
          }
          if (mm.t === 'select' && lobby && lobby.watch) lobby.watch.started = true;
          watchNote(mm);
          wq.push(x.data);
        };
        ch.onclose = () => { if (conn === wpc) leaveWatch('The host closed the connection.', true); };
      }
    };
    await conn.setRemoteDescription(offer);
    await conn.setLocalDescription(await conn.createAnswer());
    await gatherComplete(conn);
    send(conn.localDescription);
  }
  // The watch panel (ikemenNet.start('watch')): room code, password, Watch,
  // Leave. `again`: redrawn during a session to show a status (no inputs).
  function watchPanel(again) {
    const ui = showPanel('watch');
    if (!again) {
      const codeInp = ui.mkInput('Room code of the match to watch:', 'e.g. spicy-tiger-42');
      const passInp = ui.mkInput('Room password (if it has one):', '');
      const watchBtn = ui.mkBtn('Watch', () => {
        const code = codeInp.value.trim().toLowerCase();
        if (!code) { watchStatus('Enter the room code first.'); return; }
        watchBtn.disabled = true;
        startWatch(code, passInp.value.trim());
      });
      panel.__watchBtn = watchBtn;
      panel.__code = codeInp;
      setStatus('Type the room code of the match you want to watch.');
    }
    panel.__leave = ui.mkBtn('Leave', () => leaveWatch('You left.'));
    return ui;
  }
  function startWatchFlow() {
    installWatcherBridge();
    watchPanel(false);
  }

  // ---------- winner-stays lobby ----------
  //
  // CORE has the rules): two play, the winner stays, the loser goes to the
  // back of the line, everyone else watches the match live. The SERVER decides
  // every match; this page carries out what it is told:
  //   {t:'match', role, opp}  this page plays the match, as its netplay host
  //                           (engine side 1, it carries the watchers) or guest:
  //                           the same connection as a room's (makePeer, the
  //                           two channels, the build and netcode checks), with
  //                           the SDP going through the lobby socket;
  //   {t:'watch', host}       this page watches it: P1's watcher (the watcher
  //                           bridge, its own connection to the match host),
  //                           the handshake through the lobby socket;
  //   {t:'watcher', id}       (match host) a member to carry: P1's wAdd.
  // The engine runs the lobby loop (main.lua main.f_lobby) and asks through
  // ikemenNet.lobby(cmd, arg): 'avail', 'open', 'next', 'text', 'stale',
  // 'result', 'leave', 'rounds', 'mode'. An assignment reaches the engine only when it
  // is free (between matches), so the page never swaps a bridge under a match
  // that is still running; a watch that has not started is let go when a newer
  // assignment comes (the engine goes back to the lobby screen and takes it).
  //
  // THE SIDEBAR. The lobby lives beside the game, never over it: the picture
  // keeps its aspect and shrinks to make room (index.html ikemenReserveRight);
  // narrower than LOBBY_NARROW px it overlays the right edge and starts
  // folded to a tab. It exists only from the moment LOBBY is picked until the
  // lobby is left. Style (the owner's rule): no rounded corners on anything,
  // no translucency, no soft shadows; solid fills, 2px hard borders, the Game
  // only page's palette and type. Chat: plain text (textContent, so markup and
  // links are inert), 200 characters, the server's rate limit, nothing kept
  // (a member sees what is said after it joins); MUTE hides a member's lines on
  // this page only; the lobby host can KICK.
  //
  // DEV SWITCH (?devnet=1): &lobbyrounds=N makes every lobby match first to N
  // rounds (short test matches; both players' pages need the same value), and
  // ikemenTest.lobby() / trail(match) read the state and each match's trail.
  const LOBBY_W = 300, LOBBY_NARROW = 760;
  const LOBBY_CONNECT_MS = 90 * 1000; // a lobby match's players must connect within this
  let lobby = null;
  const lobbyTrails = new Map(); // lobby match -> (frame -> checksum), dev switch
  // A Turns match is one lobby match but a new GGPO session every turn, whose
  // frames start again at 0: a lobby match's trail is cut into one segment per
  // session, keyed k, then k/1, k/2... A frame of 30 or less after the segment
  // held one of 120 or more starts the next (frames only move forward inside a
  // session: a player's newest sent frame, a watcher's simulated one).
  const trailSegs = new Map(); // lobby match -> { n, key, max }
  function lobbyOn() { return !!(lobby && lobby.code && lobby.ws && lobby.ws.readyState === 1); }
  function lobbyTrailKey() {
    if (!lobby) return 0;
    if (lobby.inMatch && lobby.playing) return lobby.playing;
    if (lobby.watch) return lobby.watch.match;
    return 0;
  }
  function trailSet(f, crc) {
    const k = lobbyTrailKey();
    if (!k) { crcTrail.set(f, crc >>> 0); return; }
    let seg = trailSegs.get(k);
    if (!seg) { seg = { n: 0, key: k, max: -1 }; trailSegs.set(k, seg); }
    if (f <= 30 && seg.max >= 120) { seg.n++; seg.key = k + '/' + seg.n; seg.max = -1; }
    if (!lobbyTrails.has(seg.key)) lobbyTrails.set(seg.key, new Map());
    lobbyTrails.get(seg.key).set(f, crc >>> 0);
    if (f > seg.max) seg.max = f;
  }
  function lobbyRaw(obj) {
    try { if (lobby && lobby.ws && lobby.ws.readyState === 1) lobby.ws.send(JSON.stringify(obj)); } catch { /* gone */ }
  }
  // THE MATCH MODE (the lobby server's LOBBY CORE has the rules). A lobby
  // plays one mode, set once by its creator on the Create form: 'single'
  // (1 vs 1) or a team mode at a team size: 'simul2'..'simul4', 'tag2'..,
  // 'turns2'... The form starts on the build's Match mode (the Studio's
  // Online tab; the Website export writes it as IKEMEN_BRAND.matchMode). This
  // page says it plays modes (&modes=1) on every lobby socket and list read,
  // and the server sends each lobby's mode in {t:'state'} and in the list.
  // Before each lobby match the engine asks for it (netLobby 'mode', the
  // online mod's main.f_lobbyPlay), so both players set the same mode at the
  // same size: the one the SERVER reports, never this page's own default. A
  //
  // sends none: its lobbies are 1 vs 1 for everyone in them, and a creator who
  // picked a team mode is told so.
  const LOBBY_MODE_KINDS = ['single', 'simul', 'tag', 'turns'];
  const LOBBY_MODE_NAMES = { single: '1v1', simul: 'Simul', tag: 'Tag', turns: 'Turns' };
  function lobbyModeOk(v) { return v === 'single' || (typeof v === 'string' && /^(simul|tag|turns)[234]$/.test(v)); }
  function lobbyModeOf(v) { return lobbyModeOk(v) ? v : 'single'; }
  // '1v1', 'Simul 3', 'Tag 2', 'Turns 4'
  function lobbyModeLabel(v) {
    const m = lobbyModeOf(v);
    return m === 'single' ? LOBBY_MODE_NAMES.single : LOBBY_MODE_NAMES[m.slice(0, -1)] + ' ' + m.slice(-1);
  }
  function lobbyModeDefault() { const b = globalThis.IKEMEN_BRAND; return lobbyModeOf(b && b.matchMode); }
  // What this page's lobby plays: the server's word, or 1 vs 1 when it has none.
  function lobbyModeNow() { const v = lobby && lobby.view; return v && lobbyModeOk(v.mode) ? v.mode : 'single'; }
  function lobbyName(id) {
    const v = lobby && lobby.view;
    const m = v && v.members.find((x) => x.id === id);
    return m ? m.name : (lobby && lobby.names[id]) || '?';
  }
  // The engine draws printable ASCII only.
  const asciiName = (s) => String(s || '').replace(/[^\x20-\x7e]/g, '?').slice(0, 24);
  // The name this player last used in a lobby, under its own key so a lobby
  //
  // can throw (private windows, blocked site data): no name is the fallback.
  const LOBBY_NAME_KEY = 'ikemen-lobby-name';
  function lobbySavedName() {
    try { return String(localStorage.getItem(LOBBY_NAME_KEY) || '').slice(0, 24); } catch (e) { return ''; }
  }
  function lobbySaveName(n) {
    try { localStorage.setItem(LOBBY_NAME_KEY, String(n || '').slice(0, 24)); } catch (e) { /* not kept */ }
  }
  // The in-fight name plates for a lobby match, on both players' pages and on
  // every watcher's. The Lua draws whatever queueNames() hands it (line 1 on
  // engine side 1, line 2 on side 2), and the lobby server makes match.a the
  // host = side 1, so every page derives the same two lines from the lobby's
  // own state without a word on the wire (an older page simply draws none).
  // Taken once at the start: a member who leaves mid-match drops out of the
  // lobby's member list, and re-reading would turn the plate into '?'.
  // queueRated stays false, so the pairing token stays '' and neither the
  //
  function lobbyPlates(c) {
    if (!c || !c.a || !c.b) return;
    queueP1 = asciiName(lobbyName(c.a));
    queueP2 = asciiName(lobbyName(c.b));
    queueRated = false;
    queueLobby = true;
  }
  function lobbyStatusOf(id) {
    const v = lobby.view;
    if (!v) return '';
    if (v.match && v.match.a === id) return 'PLAYING P1';
    if (v.match && v.match.b === id) return 'PLAYING P2';
    if (v.stay === id) return 'WINNER, WAITING';
    const me = v.members.find((x) => x.id === id);
    if (me && me.spec) return 'SPECTATING ONLY';
    const i = v.line.indexOf(id);
    if (i >= 0) return 'IN LINE #' + (i + 1) + (v.match ? ', WATCHING' : '');
    return 'WATCHING';
  }
  function lobbyNowNext(ascii) {
    const v = lobby.view;
    const nm = (id) => ascii ? asciiName(lobbyName(id)) : lobbyName(id);
    const out = [];
    if (v.match) out.push('NOW: ' + nm(v.match.a) + ' vs ' + nm(v.match.b));
    const n = v.next;
    if (n) {
      out.push('NEXT: ' + (n.a ? nm(n.a) : 'WINNER') + ' vs ' + nm(n.b) +
        (n.rotate ? ' (' + nm(n.rotate) + ' rotates out on a win)' : ''));
    } else if (!v.match) {
      out.push('NEXT: waiting for players');
    }
    return out;
  }
  function lobbyReason(r) {
    return r === 'badcode' ? 'No lobby with that code. Check the spelling.'
      : r === 'badpass' ? 'Wrong password.'
        : r === 'build' ? 'Your game differs from this lobby\'s (Build ID): everyone needs the same build and engine.'
          : r === 'netcode' ? 'Lobbies are rollback only: pick Rollback as the online netcode on the start screen.'
            : r === 'full' ? 'This lobby is full (8).'
              : r === 'name' ? 'Type a name first.'
                : r === 'kicked' ? 'The lobby host removed you from this lobby.'
                  : r === 'slowdown' ? 'Too many tries on this lobby in the last minute. Try again shortly.'
                    : r === 'timeout' ? 'The lobby closed (an hour with nothing happening).'
                      : r === 'busy' ? 'The lobby server hiccuped. Try again.'
                        : 'Refused: ' + r;
  }

  // ---- the sidebar ----
  //
  // today's look as their defaults. The defaults sit at :where(:root), which
  // weighs nothing, so the host's look (Settings > Online > Lobby look,
  // public/ikemen/lobby-look.js, a :root rule of its own) always wins over
  // them whichever style sheet comes first. The last six are not chosen by
  // anyone: lobby-look.js mixes them from the eight colors when a look sets
  // them (lines, faint text, a disabled button, the warning line). New lobby
  // UI uses these tokens and nothing else for its colors and fonts.
  const LOBBY_CSS = [
    ':where(:root) { --lob-bg: #0b0d12; --lob-panel: #10141c; --lob-text: #d6e6ff; --lob-dim: #9fb3cc; --lob-accent: #6af;',
    '  --lob-accent-text: #0b0d12; --lob-border: #6af; --lob-chat-bg: #05070a; --lob-font: monospace; --lob-head-font: monospace;',
    '  --lob-rule: #1e2a3a; --lob-rule-soft: #141c28; --lob-faint: #5d6f86; --lob-off-border: #2a3a52; --lob-off-text: #3d5a80; --lob-warn: #fc6; }',
    '#lobbybar, #lobbybar *, #lobbytab { border-radius: 0 !important; box-shadow: none !important; box-sizing: border-box; }',
    '#lobbybar { position: fixed; top: 0; right: 0; bottom: 0; z-index: 940; width: ' + LOBBY_W + 'px; max-width: 100vw;',
    '  display: flex; flex-direction: column; background: var(--lob-bg); border-left: 2px solid var(--lob-border); color: var(--lob-text);',
    '  font: 12px var(--lob-font); }',
    '#lobbybar[hidden], #lobbytab[hidden], #lobbybar [hidden] { display: none !important; }',
    '#lobbybar .lb-head { flex: none; display: flex; align-items: center; gap: 6px; background: var(--lob-accent); color: var(--lob-accent-text); padding: 3px 3px 3px 10px; }',
    '#lobbybar .lb-t { font: bold 12px var(--lob-head-font); text-transform: uppercase; letter-spacing: .2em; margin-right: auto; }',
    '#lobbybar button { font: bold 11px var(--lob-font); text-transform: uppercase; letter-spacing: .12em; cursor: pointer; margin: 0;',
    '  padding: 4px 8px; border: 2px solid var(--lob-accent); background: var(--lob-bg); color: var(--lob-accent); }',
    '#lobbybar button:hover, #lobbybar button:focus-visible { background: var(--lob-accent); color: var(--lob-accent-text); outline: none; }',
    '#lobbybar button:disabled { border-color: var(--lob-off-border); color: var(--lob-off-text); background: var(--lob-bg); cursor: default; }',
    '#lobbybar .lb-head button { border-color: var(--lob-accent-text); background: var(--lob-accent-text); color: var(--lob-accent); padding: 3px 8px; }',
    '#lobbybar .lb-head button:hover { background: var(--lob-text); color: var(--lob-bg); }',
    '#lobbybar .lb-body { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 8px 10px; }',
    '#lobbybar .lb-sec { font: bold 11px var(--lob-head-font); text-transform: uppercase; letter-spacing: .16em; color: var(--lob-accent);',
    '  border-bottom: 2px solid var(--lob-rule); padding: 8px 0 3px; margin-bottom: 4px; }',
    '#lobbybar .lb-ltitle { font: bold 15px var(--lob-head-font, var(--lob-font)); color: var(--lob-text); overflow-wrap: anywhere; margin-bottom: 4px; }',
    '#lobbybar .lb-code { display: flex; align-items: center; gap: 6px; }',
    '#lobbybar .lb-code b { flex: 1; font: bold 15px var(--lob-font); color: var(--lob-text); background: var(--lob-chat-bg); border: 2px solid var(--lob-rule);',
    '  padding: 4px 6px; user-select: all; overflow-wrap: anywhere; }',
    '#lobbybar .lb-line { color: var(--lob-dim); padding: 1px 0; overflow-wrap: anywhere; }',
    '#lobbybar .lb-now { color: var(--lob-text); font-weight: bold; }',
    '#lobbybar .lb-mem { display: flex; align-items: center; gap: 4px; padding: 3px 0; border-bottom: 1px solid var(--lob-rule-soft); }',
    '#lobbybar .lb-mem .lb-who { flex: 1; min-width: 0; }',
    '#lobbybar .lb-mem .lb-nm { color: var(--lob-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: block; }',
    '#lobbybar .lb-mem .lb-st { color: var(--lob-faint); font-size: 11px; display: block; }',
    '#lobbybar .lb-mem.lb-play .lb-st { color: var(--lob-accent); }',
    '#lobbybar .lb-tag { font: bold 10px var(--lob-font); letter-spacing: .1em; padding: 0 3px; margin-left: 4px; background: var(--lob-accent); color: var(--lob-accent-text); }',
    '#lobbybar .lb-tag.lb-you { background: var(--lob-text); color: var(--lob-bg); }',
    '#lobbybar .lb-mem button { padding: 2px 5px; font-size: 10px; letter-spacing: .06em; }',
    '#lobbybar .lb-row { display: flex; align-items: center; gap: 6px; margin-top: 6px; flex-wrap: wrap; }',
    '#lobbybar .lb-check { display: inline-flex; align-items: center; gap: 7px; }',
    '#lobbybar .lb-check i { display: inline-block; width: 12px; height: 12px; border: 2px solid currentColor; background: var(--lob-bg); }',
    '#lobbybar .lb-check[aria-pressed="true"] i { background: currentColor; box-shadow: inset 0 0 0 2px var(--lob-bg) !important; }',
    '#lobbybar .lb-check:hover i { background: var(--lob-bg); }',
    '#lobbybar .lb-check[aria-pressed="true"]:hover i { background: var(--lob-bg); box-shadow: inset 0 0 0 2px var(--lob-bg), inset 0 0 0 6px var(--lob-bg) !important; }',
    '#lobbybar .lb-step b { display: inline-block; min-width: 34px; text-align: center; color: var(--lob-text); border-top: 2px solid var(--lob-rule);',
    '  border-bottom: 2px solid var(--lob-rule); padding: 3px 0; }',
    '#lobbybar label.lb-f { display: block; margin-top: 6px; color: var(--lob-dim); text-transform: uppercase; letter-spacing: .1em; font-size: 11px; }',
    '#lobbybar input { display: block; width: 100%; margin-top: 2px; padding: 4px 6px; font: 13px var(--lob-font); color: var(--lob-text);',
    '  background: var(--lob-chat-bg); border: 2px solid var(--lob-rule); outline: none; }',
    '#lobbybar input:focus { border-color: var(--lob-accent); }',
    '#lobbybar .lb-tabs { display: flex; margin-bottom: 4px; }',
    '#lobbybar .lb-tabs button { flex: 1; }',
    '#lobbybar .lb-tabs button[aria-selected="true"] { background: var(--lob-accent); color: var(--lob-accent-text); }',
    '#lobbybar .lb-mm { display: flex; }',
    '#lobbybar .lb-mm button { flex: 1; padding: 4px 2px; }',
    '#lobbybar .lb-mm button + button { border-left-width: 0; }',
    '#lobbybar .lb-mm button[aria-pressed="true"] { background: var(--lob-accent); color: var(--lob-accent-text); }',
    '#lobbybar .lb-msg { color: var(--lob-warn); margin-top: 6px; white-space: pre-line; min-height: 14px; }',
    '#lobbybar .lb-chat { flex: none; display: flex; flex-direction: column; height: 38%; min-height: 150px; border-top: 2px solid var(--lob-border); }',
    '#lobbybar .lb-log { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 4px 10px; background: var(--lob-chat-bg); line-height: 15px; }',
    '#lobbybar .lb-log div { overflow-wrap: anywhere; white-space: pre-wrap; }',
    '#lobbybar .lb-log .lb-sys { color: var(--lob-faint); }',
    '#lobbybar .lb-log .lb-cn { color: var(--lob-accent); font-weight: bold; }',
    '#lobbybar .lb-say { flex: none; display: flex; gap: 0; border-top: 2px solid var(--lob-rule); }',
    '#lobbybar .lb-say input { margin: 0; border: 0; flex: 1; }',
    '#lobbybar .lb-say button { border-width: 0 0 0 2px; }',
    '#lobbybar ::-webkit-scrollbar { width: 10px; height: 10px; background: var(--lob-chat-bg); }',
    '#lobbybar ::-webkit-scrollbar-thumb { background: var(--lob-accent); border: 2px solid var(--lob-chat-bg); border-radius: 0; }',
    '#lobbybar ::-webkit-scrollbar-button { display: none; }',
    '#lobbybar ::-webkit-scrollbar-corner { background: var(--lob-chat-bg); }',
    '@supports not selector(::-webkit-scrollbar) { #lobbybar, #lobbybar * { scrollbar-color: var(--lob-accent) var(--lob-chat-bg); } }',
    // The folded tab: invisible at rest, square and solid when shown (lb-on,
    //
    '#lobbytab { position: fixed; right: 0; top: 50%; transform: translateY(-50%); z-index: 940; cursor: pointer; margin: 0;',
    '  writing-mode: vertical-rl; padding: 10px 4px; font: bold 11px var(--lob-head-font); letter-spacing: .25em; text-transform: uppercase;',
    '  background: var(--lob-bg); color: var(--lob-accent); border: 2px solid var(--lob-border); border-right: 0;',
    '  opacity: 0; transition: opacity .25s linear; }',
    '#lobbytab.lb-on, #lobbytab:hover, #lobbytab:focus-visible { opacity: 1; transition: opacity .12s linear; }',
    '#lobbytab:hover, #lobbytab:focus-visible { background: var(--lob-accent); color: var(--lob-accent-text); outline: none; }',
    '@media (prefers-reduced-motion: reduce) { #lobbytab, #lobbytab.lb-on { transition: none; } }',
    // One line over the game for a few seconds (lobbyNote): a player left.
    '#lobbynote { position: fixed; top: 14px; transform: translateX(-50%); z-index: 945; max-width: calc(100vw - 40px); pointer-events: none;',
    '  padding: 6px 12px; background: var(--lob-bg); color: var(--lob-text); border: 2px solid var(--lob-warn); border-radius: 0 !important;',
    '  box-shadow: none !important; box-sizing: border-box; font: bold 13px var(--lob-font); text-align: center; overflow-wrap: anywhere; }',
  ].join('\n');

  function lbEl(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }
  function lbButton(label, fn, cls) {
    const b = lbEl('button', cls || '', label);
    b.type = 'button';
    b.addEventListener('mousedown', (e) => e.preventDefault()); // never keep focus from the game
    b.addEventListener('click', (e) => { fn(e); });
    return b;
  }
  function lbShield(el) {
    for (const t of ['mousedown', 'mouseup', 'click', 'dblclick', 'keydown', 'keyup', 'keypress', 'wheel', 'contextmenu',
      'pointerdown', 'pointerup', 'touchstart', 'touchend']) el.addEventListener(t, (e) => e.stopPropagation());
  }
  function lbFocusGame() {
    const a = document.activeElement;
    if (a && a !== document.body && a.blur) a.blur();
  }

  function lobbyUiMake() {
    if (lobby.ui) return lobby.ui;
    if (!document.getElementById('lobbybar-style')) {
      const st = lbEl('style'); st.id = 'lobbybar-style'; st.textContent = LOBBY_CSS;
      document.head.appendChild(st);
    }
    const bar = lbEl('aside'); bar.id = 'lobbybar'; bar.setAttribute('aria-label', 'Lobby');
    const head = lbEl('div', 'lb-head');
    const title = lbEl('span', 'lb-t', 'Lobby');
    const fold = lbButton('Fold', () => lobbyFold(true));
    fold.title = 'Fold the lobby away (the tab on the right brings it back)';
    head.appendChild(title); head.appendChild(fold);
    const body = lbEl('div', 'lb-body');
    const chat = lbEl('div', 'lb-chat');
    const log = lbEl('div', 'lb-log'); log.setAttribute('role', 'log'); log.setAttribute('aria-live', 'polite');
    const say = lbEl('div', 'lb-say');
    const inp = lbEl('input'); inp.type = 'text'; inp.maxLength = 200; inp.placeholder = 'Say something'; inp.autocomplete = 'off'; inp.spellcheck = false;
    inp.setAttribute('aria-label', 'Chat message');
    const send = lbButton('Send', () => lobbyChatSend());
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); lobbyChatSend(); } if (e.key === 'Escape') { e.preventDefault(); inp.blur(); } });
    say.appendChild(inp); say.appendChild(send);
    chat.appendChild(log); chat.appendChild(say);
    bar.appendChild(head); bar.appendChild(body); bar.appendChild(chat);
    lbShield(bar);
    const tab = lbButton('Lobby', () => lobbyTabClick()); tab.id = 'lobbytab'; tab.hidden = true;
    tab.title = 'Show the lobby';
    lbShield(tab);
    document.body.appendChild(bar);
    document.body.appendChild(tab);
    lobby.ui = { bar, tab, body, chat, log, inp, send, title, folded: false, tabTimer: 0, tabNear: false, tabGuard: 0 };
    // The host's look (lobby-look.js): its page colors, fonts and background
    // while this sidebar exists.
    if (globalThis.ikemenLobbyLook) globalThis.ikemenLobbyLook.enter();
    const narrow = document.documentElement.clientWidth < LOBBY_NARROW;
    lobbyFold(narrow);
    window.addEventListener('resize', lobbyFit);
    for (const t of LOBBY_TAB_EVENTS) window.addEventListener(t, lobbyTabWake, { capture: true, passive: true });
    document.addEventListener('mouseout', lobbyTabOut);
    tab.addEventListener('mouseleave', lobbyTabArm);
    tab.addEventListener('focus', () => lobbyTabShow(true));
    tab.addEventListener('blur', lobbyTabArm);
    return lobby.ui;
  }
  // THE FOLDED TAB keeps out of the way (the owner, 2026-11-14: folded, it sat
  // on the right edge at full opacity beside a game smaller than the screen).
  // At rest it is invisible (opacity 0; it is still there for Tab and a screen
  // reader). It shows while the mouse is within LOBBY_TAB_NEAR px of the right
  // edge, on a tap there, and while it has keyboard focus; it fades out
  // LOBBY_TAB_REST ms after the mouse leaves that strip (or the window), never
  // while hovered or focused, as Game only's MENU button does (index.html).
  // A tap on it while it is hidden only shows it: a finger never opens the
  // lobby by touching an edge where nothing could be seen. Folding shows it
  // too, so it is seen going there.
  const LOBBY_TAB_NEAR = 96, LOBBY_TAB_REST = 2000;
  const LOBBY_TAB_EVENTS = ['mousemove', 'pointermove', 'pointerdown', 'touchstart'];
  function lobbyTabShow(on) {
    const ui = lobby && lobby.ui;
    if (ui) ui.tab.classList.toggle('lb-on', !!on);
  }
  function lobbyTabArm() {
    const ui = lobby && lobby.ui;
    if (!ui) return;
    clearTimeout(ui.tabTimer);
    ui.tabTimer = setTimeout(() => {
      if (!lobby || lobby.ui !== ui) return;
      // these arm it again when they end (mouseleave, blur, leaving the strip)
      if (ui.tabNear || ui.tab.matches(':hover') || document.activeElement === ui.tab) return;
      ui.tab.classList.remove('lb-on');
    }, LOBBY_TAB_REST);
  }
  function lobbyTabWake(e) {
    const ui = lobby && lobby.ui;
    if (!ui || !ui.folded) return;
    const p = e.touches && e.touches[0] ? e.touches[0] : e;
    if (typeof p.clientX !== 'number') return;
    const near = p.clientX >= document.documentElement.clientWidth - LOBBY_TAB_NEAR;
    const press = e.type === 'pointerdown' || e.type === 'touchstart';
    if (e.type === 'touchstart' || e.pointerType === 'touch' || e.pointerType === 'pen'
      || (e.sourceCapabilities && e.sourceCapabilities.firesTouchEvents)) {
      if (!press) return;
      if (ui.tab.contains(e.target) && !ui.tab.classList.contains('lb-on')) ui.tabGuard = Date.now();
      ui.tabNear = false;   // a finger does not rest anywhere
      if (near) { lobbyTabShow(true); lobbyTabArm(); }
      return;
    }
    const was = ui.tabNear;
    ui.tabNear = near;
    if (near) { lobbyTabShow(true); clearTimeout(ui.tabTimer); } else if (was) lobbyTabArm();
  }
  function lobbyTabOut(e) {
    const ui = lobby && lobby.ui;
    if (!ui || e.relatedTarget) return;   // still in the page
    ui.tabNear = false;
    if (ui.folded) lobbyTabArm();
  }
  function lobbyTabClick() {
    const ui = lobby && lobby.ui;
    if (!ui) return;
    if (ui.tabGuard && Date.now() - ui.tabGuard < 1500) { ui.tabGuard = 0; return; }   // the tap that showed it
    ui.tabGuard = 0;
    lobbyFold(false);
  }
  // The room the picture leaves for the bar: its width when open and wide
  // enough; nothing when folded or narrow (it overlays the edge then).
  function lobbyFit() {
    if (!lobby || !lobby.ui) { if (globalThis.ikemenReserveRight) globalThis.ikemenReserveRight(0); return; }
    const narrow = document.documentElement.clientWidth < LOBBY_NARROW;
    const r = lobby.ui.folded || narrow ? 0 : LOBBY_W;
    if (globalThis.ikemenReserveRight) globalThis.ikemenReserveRight(r);
  }
  function lobbyFold(on) {
    const ui = lobby && lobby.ui;
    if (!ui) return;
    ui.folded = !!on;
    ui.bar.hidden = ui.folded;
    ui.tab.hidden = !ui.folded;
    clearTimeout(ui.tabTimer);
    lobbyTabShow(ui.folded);
    if (ui.folded) lobbyTabArm();
    lobbyFit();
    lbFocusGame();
  }
  function lobbyUiDrop() {
    if (!lobby || !lobby.ui) return;
    window.removeEventListener('resize', lobbyFit);
    for (const t of LOBBY_TAB_EVENTS) window.removeEventListener(t, lobbyTabWake, { capture: true, passive: true });
    document.removeEventListener('mouseout', lobbyTabOut);
    clearTimeout(lobby.ui.tabTimer);
    lobby.ui.bar.remove(); lobby.ui.tab.remove();
    lobby.ui = null;
    if (globalThis.ikemenLobbyLook) globalThis.ikemenLobbyLook.leave();
    if (globalThis.ikemenReserveRight) globalThis.ikemenReserveRight(0);
  }
  function lobbyLog(text, cls, from) {
    const ui = lobby && lobby.ui;
    if (!ui) return;
    const d = lbEl('div', cls || '');
    if (from) {
      d.dataset.from = String(from.id);
      d.appendChild(lbEl('span', 'lb-cn', from.name + ': '));
      d.appendChild(document.createTextNode(text));
      if (lobby.muted.has(from.id)) d.hidden = true;
    } else {
      d.textContent = text;
    }
    const atEnd = ui.log.scrollTop + ui.log.clientHeight >= ui.log.scrollHeight - 4;
    ui.log.appendChild(d);
    while (ui.log.childNodes.length > 200) ui.log.removeChild(ui.log.firstChild);
    if (atEnd) ui.log.scrollTop = ui.log.scrollHeight;
  }
  function lobbyChatSend() {
    const ui = lobby && lobby.ui;
    if (!ui || !lobbyOn()) return;
    const t = ui.inp.value.trim();
    if (!t) return;
    lobbyRaw({ t: 'chat', text: t.slice(0, 200) });
    ui.inp.value = '';
  }

  // THE LOOK'S PREVIEW: public/ikemen/lobby-preview.html (the Studio's
  // Settings > Online > Lobby look) sets IKEMEN_LOBBY_PREVIEW before this file
  // loads and draws this very sidebar with a made-up lobby: { view (a 'state'
  // message), you, chat: [{ text, sys } | { text, from, name }], folded }.
  // No socket is opened. The game page never sets it.
  if (globalThis.IKEMEN_LOBBY_PREVIEW === true) {
    globalThis.ikemenLobbyPreview = (st) => {
      if (lobby && lobby.ui) lobbyUiDrop();
      lobby = { names: {}, muted: new Set(st.muted || []), form: {}, code: st.view.code, you: st.you, view: st.view, note: st.note || '' };
      for (const x of st.view.members) lobby.names[x.id] = x.name;
      lobbyUiMake();
      lobbyFold(!!st.folded);
      lobbyRender();
      for (const c of st.chat || []) lobbyLog(c.text, c.sys ? 'lb-sys' : '', c.sys ? null : { id: c.from, name: c.name });
    };
  }

  // The form: create or join (the setup view, before the lobby socket is up).
  function lobbySetupView(msg) {
    const ui = lobbyUiMake();
    ui.title.textContent = 'Lobby';
    ui.chat.hidden = true;
    const b = ui.body;
    b.textContent = '';
    let mode = lobby.mode || 'create';
    lobbyBrowseStop();
    const tabs = lbEl('div', 'lb-tabs');
    tabs.setAttribute('role', 'tablist');
    const tc = lbButton('Create', () => { lobby.mode = 'create'; lobbySetupView(); });
    const tj = lbButton('Join', () => { lobby.mode = 'join'; lobbySetupView(); });
    const tb = lbButton('Browse', () => { lobby.mode = 'browse'; lobbySetupView(); });
    tc.setAttribute('aria-selected', String(mode === 'create')); tj.setAttribute('aria-selected', String(mode === 'join'));
    tb.setAttribute('aria-selected', String(mode === 'browse'));
    tc.className = 'lb-create-tab'; tj.className = 'lb-join-tab'; tb.className = 'lb-browse-tab';
    tb.title = 'The open lobbies (every lobby without a password)';
    tabs.appendChild(tc); tabs.appendChild(tj); tabs.appendChild(tb);
    b.appendChild(tabs);
    const field = (label, name, val, ph) => {
      const l = lbEl('label', 'lb-f', label);
      const i = lbEl('input'); i.type = 'text'; i.name = name; i.value = val || ''; i.placeholder = ph || '';
      i.autocomplete = 'off'; i.spellcheck = false;
      l.appendChild(i); b.appendChild(l);
      return i;
    };
    //
    // name (a lobby is open to anyone and that name is the one the
    //
    const nameInp = field('Your name', 'lbname', lobby.form.name || lobbySavedName(), 'shown to the lobby');
    nameInp.maxLength = 24;
    if (mode === 'browse') { lobbyBrowseView(b, nameInp, msg); return; }
    let codeInp = null, titleInp = null;
    if (mode === 'join') codeInp = field('Lobby code', 'lbcode', lobby.form.code || '', 'e.g. spicy-tiger-42');
    // THE TITLE: what the lobby list and the panel call this lobby. Optional;
    // the code stays the random one people type to join.
    if (mode === 'create') { titleInp = field('Lobby title (optional)', 'lbtitle', lobby.form.title || '', 'e.g. Friday Night CvS'); titleInp.maxLength = 32; }
    const passInp = field(mode === 'create' ? 'Password (optional)' : 'Password (if it has one)', 'lbpass', '', mode === 'create' ? 'leave blank for none' : '');
    passInp.maxLength = 64;
    if (mode === 'create') lobbyModeForm(b);
    if (mode === 'create') {
      b.appendChild(lbEl('div', 'lb-sec', 'Winner leaves after'));
      const row = lbEl('div', 'lb-row lb-step');
      const val = lbEl('b', '', lobby.form.streak ? String(lobby.form.streak) : 'OFF');
      const set = (n) => { lobby.form.streak = Math.max(0, Math.min(9, n)); val.textContent = lobby.form.streak ? String(lobby.form.streak) : 'OFF'; };
      row.appendChild(lbButton('-', () => set((lobby.form.streak || 0) - 1), 'lb-minus'));
      row.appendChild(val);
      row.appendChild(lbButton('+', () => set((lobby.form.streak || 0) + 1), 'lb-plus'));
      row.appendChild(lbEl('span', 'lb-line', 'wins (OFF: stays until beaten)'));
      b.appendChild(row);
    }
    const go = lbButton(mode === 'create' ? 'Create lobby' : 'Join lobby', () => {
      lobby.form.name = nameInp.value.trim();
      if (codeInp) lobby.form.code = codeInp.value.trim().toLowerCase();
      if (titleInp) lobby.form.title = titleInp.value.trim();
      if (!lobby.form.name) { msgEl.textContent = lobbyReason('name'); return; }
      lobbySaveName(lobby.form.name);
      if (mode === 'join' && !lobby.form.code) { msgEl.textContent = 'Type the lobby code.'; return; }
      go.disabled = true;
      msgEl.textContent = mode === 'create' ? 'Creating...' : 'Joining...';
      lobbyConnect(mode, lobby.form.code, passInp.value, lobby.form.name, lobby.form.streak || 0, (err) => {
        go.disabled = false;
        msgEl.textContent = err;
      });
    }, 'lb-go');
    const row2 = lbEl('div', 'lb-row');
    row2.appendChild(go);
    row2.appendChild(lbButton('Cancel', () => lobbyLeave('You closed the lobby panel.'), 'lb-cancel'));
    b.appendChild(row2);
    const msgEl = lbEl('div', 'lb-msg', msg || '');
    b.appendChild(msgEl);
    b.appendChild(lbEl('div', 'lb-line', 'Up to 8 people. Two play; the winner stays, the loser goes to the back of the line; everyone else watches live.'));
    if (globalThis.ikemenNetcode !== 'rollback') msgEl.textContent = lobbyReason('netcode');
  }

  // THE MATCH MODE on the Create form: 1v1 / Simul / Tag / Turns and, for a
  // team mode, the team size (2-4), starting on the build's Match mode. Kept
  // in lobby.form.mm ('single', 'simul3'...) while the form is redrawn (the
  // tabs), and the team size a team mode last had in lobby.form.mmSize.
  function lobbyModeForm(b) {
    const f = lobby.form;
    if (!lobbyModeOk(f.mm)) f.mm = lobbyModeDefault();
    if (![2, 3, 4].includes(f.mmSize)) f.mmSize = f.mm === 'single' ? 2 : Number(f.mm.slice(-1));
    b.appendChild(lbEl('div', 'lb-sec', 'Match mode'));
    const row = lbEl('div', 'lb-mm');
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', 'Match mode');
    const size = lbEl('div', 'lb-row lb-step lb-mmsize');
    const val = lbEl('b', '', '');
    const kinds = {};
    const draw = () => {
      const k = f.mm === 'single' ? 'single' : f.mm.slice(0, -1);
      for (const x of LOBBY_MODE_KINDS) kinds[x].setAttribute('aria-pressed', String(x === k));
      size.hidden = k === 'single';
      val.textContent = String(f.mmSize);
    };
    const pick = (k) => { f.mm = k === 'single' ? 'single' : k + f.mmSize; draw(); };
    for (const k of LOBBY_MODE_KINDS) {
      kinds[k] = lbButton(LOBBY_MODE_NAMES[k], () => pick(k), 'lb-mm-' + k);
      kinds[k].title = k === 'single' ? 'One fighter each' : LOBBY_MODE_NAMES[k] + ': both players get a team of the size below';
      row.appendChild(kinds[k]);
    }
    const step = (d) => {
      f.mmSize = Math.max(2, Math.min(4, f.mmSize + d));
      if (f.mm !== 'single') f.mm = f.mm.slice(0, -1) + f.mmSize;
      draw();
    };
    size.appendChild(lbButton('-', () => step(-1), 'lb-minus'));
    size.appendChild(val);
    size.appendChild(lbButton('+', () => step(1), 'lb-plus'));
    size.appendChild(lbEl('span', 'lb-line', 'a side'));
    b.appendChild(row);
    b.appendChild(size);
    draw();
  }

  //
  function lobbyRender() {
    if (!lobby || !lobby.ui || !lobby.view) return;
    const ui = lobby.ui, v = lobby.view, b = ui.body;
    ui.chat.hidden = false;
    ui.title.textContent = 'Lobby ' + v.members.length + '/' + v.max;
    b.textContent = '';
    if (v.title) b.appendChild(lbEl('div', 'lb-ltitle', v.title));
    const code = lbEl('div', 'lb-code');
    code.appendChild(lbEl('b', 'lb-codetext', v.code));
    const copy = lbButton('Copy', () => {
      const done = () => { copy.textContent = 'Copied'; setTimeout(() => { copy.textContent = 'Copy'; }, 1500); };
      try { navigator.clipboard.writeText(v.code).then(done, done); } catch (e) { done(); }
    }, 'lb-copy');
    copy.title = 'Copy the lobby code' + (v.pass ? ' (it has a password: tell them that too)' : '');
    code.appendChild(copy);
    b.appendChild(code);
    if (v.pass) b.appendChild(lbEl('div', 'lb-line lb-pass', 'Password set: tell your friends the password too.'));
    b.appendChild(lbEl('div', 'lb-line lb-mode', 'MODE: ' + lobbyModeLabel(lobbyModeNow())));
    // lb-now / lb-next / lb-streak and each member's data-st (play, line,
    // spec, watch) and data-p are hooks for the look's panel themes
    // (lobby-look.js); the text is the same in every theme.
    for (const [i, t] of lobbyNowNext(false).entries()) b.appendChild(lbEl('div', i === 0 && v.match ? 'lb-line lb-now' : 'lb-line lb-next', t));
    const holder = v.streak && v.streak.id ? lobbyName(v.streak.id) + ' ' + v.streak.n + ' in a row' : 'none';
    b.appendChild(lbEl('div', 'lb-line lb-streak', 'STREAK: ' + holder + '   LIMIT: ' + (v.limit ? v.limit + ' wins' : 'OFF')));
    if (v.host === lobby.you) {
      const row = lbEl('div', 'lb-row lb-step lb-limit');
      row.appendChild(lbEl('span', 'lb-line', 'Winner leaves after'));
      row.appendChild(lbButton('-', () => lobbyRaw({ t: 'limit', n: Math.max(0, v.limit - 1) }), 'lb-minus'));
      row.appendChild(lbEl('b', '', v.limit ? String(v.limit) : 'OFF'));
      row.appendChild(lbButton('+', () => lobbyRaw({ t: 'limit', n: Math.min(9, v.limit + 1) }), 'lb-plus'));
      b.appendChild(row);
    }
    b.appendChild(lbEl('div', 'lb-sec', 'Members ' + v.members.length + '/' + v.max));
    for (const m of v.members) {
      const st = lobbyStatusOf(m.id);
      const row = lbEl('div', 'lb-mem' + (st.startsWith('PLAYING') ? ' lb-play' : ''));
      row.dataset.id = String(m.id);
      row.dataset.st = st.startsWith('PLAYING') ? 'play' : st.startsWith('IN LINE') ? 'line' : st.startsWith('SPECTATING') ? 'spec' : 'watch';
      if (st.startsWith('PLAYING')) row.dataset.p = /P2/.test(st) ? '2' : '1';
      const who = lbEl('div', 'lb-who');
      const nm = lbEl('span', 'lb-nm', m.name);
      if (m.id === v.host) nm.appendChild(lbEl('span', 'lb-tag', 'HOST'));
      if (m.id === lobby.you) nm.appendChild(lbEl('span', 'lb-tag lb-you', 'YOU'));
      who.appendChild(nm);
      who.appendChild(lbEl('span', 'lb-st', st + (v.streak && v.streak.id === m.id ? ' (' + v.streak.n + ' in a row)' : '')));
      row.appendChild(who);
      if (m.id !== lobby.you) {
        const muted = lobby.muted.has(m.id);
        const mute = lbButton(muted ? 'Unmute' : 'Mute', () => {
          if (lobby.muted.has(m.id)) lobby.muted.delete(m.id); else lobby.muted.add(m.id);
          for (const d of ui.log.querySelectorAll('div[data-from="' + m.id + '"]')) d.hidden = lobby.muted.has(m.id);
          lobbyRender();
        }, 'lb-mute');
        mute.title = 'Hide this member\'s chat on your screen';
        row.appendChild(mute);
        if (v.host === lobby.you) {
          const kick = lbButton('Kick', () => {
            if (kick.dataset.armed !== '1') { kick.dataset.armed = '1'; kick.textContent = 'Sure?'; setTimeout(() => { kick.dataset.armed = ''; kick.textContent = 'Kick'; }, 3000); return; }
            lobbyRaw({ t: 'kick', id: m.id });
          }, 'lb-kick');
          kick.title = 'Remove this member from the lobby';
          row.appendChild(kick);
        }
      }
      b.appendChild(row);
    }
    const me = v.members.find((x) => x.id === lobby.you);
    const rowc = lbEl('div', 'lb-row');
    const spec = lbButton('', () => lobbyRaw({ t: 'spec', on: !(me && me.spec) }), 'lb-check lb-spec');
    spec.setAttribute('aria-pressed', String(!!(me && me.spec)));
    spec.appendChild(lbEl('i'));
    spec.appendChild(document.createTextNode('Spectate only'));
    spec.title = 'Only watch: never put in line. Turning it off puts you at the back of the line.';
    rowc.appendChild(spec);
    rowc.appendChild(lbButton('Leave', () => lobbyLeave('You left the lobby.'), 'lb-leave'));
    b.appendChild(rowc);
    if (lobby.note) b.appendChild(lbEl('div', 'lb-msg', lobby.note));
  }

  function lobbySysLine(s) {
    const n = (k) => s[k + 'n'] || '?';
    switch (s.k) {
      case 'join': return n('id') + ' joined';
      case 'leave': return n('id') + ' left';
      case 'kick': return n('id') + ' was removed by the host';
      case 'host': return n('id') + ' is now the lobby host';
      case 'spec': return s.on ? n('id') + ' is spectating only' : n('id') + ' is back in line';
      case 'limit': return s.n ? 'Winner leaves after ' + s.n + ' wins' : 'Streak limit off: the winner stays until beaten';
      case 'match': return 'Match ' + s.match + ': ' + n('a') + ' vs ' + n('b');
      case 'result': return n('w') + ' beat ' + n('l') + (s.n > 1 ? ' (' + s.n + ' in a row)' : '') + (s.how === 'drop' ? ' (' + n('l') + ' left)' : '');
      case 'draw': return n('a') + ' and ' + n('b') + ' drew';
      case 'void': return 'No result for ' + n('a') + ' vs ' + n('b') + ': both go to the back of the line';
      case 'rotate': return n('id') + ' won ' + s.n + ' in a row and goes to the back of the line';
      case 'drop': return n('id') + ' left mid-match';
      case 'absent': return s.id === lobby.you
        ? 'You did not take match ' + s.match + ' in time: you are spectating only (turn it off to get back in line)'
        : n('id') + ' did not take match ' + s.match + ' in time: spectating only';
      case 'away': return s.id === lobby.you
        ? 'Your tab was in the background when match ' + s.match + ' came up: come back within ' + s.s + ' s to play it'
        : n('id') + '\'s game is in a background tab: waiting up to ' + s.s + ' s for match ' + s.match;
      case 'noconn': return n('a') + ' and ' + n('b') + ' could not connect: no contest (the streak stands)';
      case 'bench': return s.id === lobby.you
        ? 'You could not connect ' + s.n + ' times in a row: you are spectating only (turn it off when your connection is fixed)'
        : n('id') + ' could not connect ' + s.n + ' times in a row: spectating only';
      default: return '';
    }
  }

  // ---- the list of open lobbies (BROWSE in the lobby panel) ----
  //
  // without a password: its host's name, members n/8, who plays now, the
  // streak, a free seat. The page asks only while the list is on screen and
  // the tab is visible, every LOBBY_LIST_EVERY_MS, and stops asking after
  // LOBBY_LIST_FOR_MS (REFRESH resumes): a minute of browsing costs the lobby
  // server about 6 requests. Names are shown as text (textContent), never as
  // markup. JOIN takes the same path as joining by code. The new elements use
  // only the --lob-* tokens for colors and fonts (the lobby look defines them).
  //
  // BY BUILD. A lobby admits only players on its own build (the 'build' deny),
  // and on a site where players add their own characters almost every player
  // has a Build ID of their own. So the page asks with its Build ID
  // (/lobbies?build=<the hex the lobby socket sends>) and a server that knows
  // the parameter answers with only that build's lobbies plus `build` (the
  // same hex) and `other` (how many lobbies are on other builds). The list
  // then shows only lobbies this page can join, a line says how many others
  // are hidden, and SHOW ALL asks for the whole list again (no parameter): the
  // rows on another build are marked DIFFERENT BUILD and their JOIN is off
  // (the tooltip says how to match a friend's build). A server that does not
  // answer with `build` (an older one ignores the parameter) gets today's
  // list: no filter, no marks, no switch. Joining by code is unchanged (the
  // server refuses a different build with the 'build' text, as before).
  const LOBBY_LIST_EVERY_MS = 10000, LOBBY_LIST_FOR_MS = 10 * 60 * 1000;
  const LOBBY_BROWSE_CSS = [
    '#lobbybar .lb-br-bar { display: flex; align-items: center; gap: 6px; margin-top: 8px; }',
    '#lobbybar .lb-br-at { flex: 1; min-width: 0; font: 11px var(--lob-font, monospace); color: var(--lob-dim, #9fb3cc); }',
    '#lobbybar .lb-br-row { margin-top: 6px; padding: 5px 7px; border: 2px solid var(--lob-border, #6af); border-radius: 0;',
    '  background: var(--lob-panel, #10141c); color: var(--lob-text, #d6e6ff); font: 12px var(--lob-font, monospace); }',
    '#lobbybar .lb-br-title { font: bold 14px var(--lob-head-font, monospace); color: var(--lob-text, #d6e6ff); overflow-wrap: anywhere; margin-bottom: 2px; }',
    '#lobbybar .lb-br-top { display: flex; align-items: baseline; gap: 6px; }',
    '#lobbybar .lb-br-host { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;',
    '  font: bold 13px var(--lob-head-font, monospace); color: var(--lob-text, #d6e6ff); }',
    '#lobbybar .lb-br-n { font: bold 12px var(--lob-font, monospace); color: var(--lob-accent, #6af); }',
    '#lobbybar .lb-br-mode { flex: none; font: bold 11px var(--lob-font, monospace); color: var(--lob-text, #d6e6ff); white-space: nowrap; }',
    '#lobbybar .lb-br-now, #lobbybar .lb-br-streak { color: var(--lob-dim, #9fb3cc); overflow-wrap: anywhere; }',
    '#lobbybar .lb-br-row button { margin-top: 5px; }',
    '#lobbybar .lb-br-empty { margin-top: 6px; padding: 8px; border: 2px solid var(--lob-dim, #9fb3cc); border-radius: 0;',
    '  background: var(--lob-chat-bg, #05070a); color: var(--lob-dim, #9fb3cc); font: 12px var(--lob-font, monospace); }',
    '#lobbybar .lb-br-builds { display: flex; align-items: center; gap: 6px; margin-top: 6px; padding: 5px 7px; border: 2px solid var(--lob-rule, #1e2a3a);',
    '  border-radius: 0; background: var(--lob-chat-bg, #05070a); color: var(--lob-dim, #9fb3cc); font: 12px var(--lob-font, monospace); }',
    '#lobbybar .lb-br-hid { flex: 1; min-width: 0; overflow-wrap: anywhere; }',
    '#lobbybar .lb-br-builds button { flex: none; }',
    '#lobbybar .lb-br-row.lb-br-off { border-color: var(--lob-off-border, #2a3a52); }',
    '#lobbybar .lb-br-row.lb-br-off .lb-br-host { color: var(--lob-dim, #9fb3cc); }',
    '#lobbybar .lb-br-diff { flex: none; font: bold 10px var(--lob-font, monospace); letter-spacing: .1em; text-transform: uppercase;',
    '  padding: 1px 4px; border-radius: 0; background: var(--lob-warn, #fc6); color: var(--lob-bg, #0b0d12); white-space: nowrap; }',
    '#lobbybar .lb-br-why { color: var(--lob-warn, #fc6); overflow-wrap: anywhere; }',
  ].join('\n');
  // The tooltip of a JOIN that is off because the lobby is on another build.
  const LOBBY_OTHER_BUILD = 'This lobby runs a different build of the game, so it would refuse you: everyone in a lobby needs the same build and engine. '
    + 'To match a friend\'s build, one of you presses Send my build on the Studio page and the other presses Import a build.';
  // The Build ID this page sends with ?lobby= (lobbyConnect), or '' while it
  // is not known yet.
  function lobbyMyBuild() { return localHash ? hex8(localHash) : ''; }
  function lobbyListUrl() {
    const s = signalUrl();
    if (!s) return '';
    try {
      const u = new URL(s);
      u.protocol = u.protocol === 'wss:' ? 'https:' : u.protocol === 'ws:' ? 'http:' : u.protocol;
      u.pathname = u.pathname.replace(/\/ws\/?$/, '').replace(/\/$/, '') + '/lobbies';
      u.search = ''; u.hash = '';
      return u.toString();
    } catch (e) { return ''; }
  }
  function lobbyBrowseStop() {
    const br = lobby && lobby.browse;
    if (!br) return;
    clearTimeout(br.timer);
    document.removeEventListener('visibilitychange', br.onVis);
    lobby.browse = null;
  }
  function lobbyBrowseView(b, nameInp, msg) {
    if (!document.getElementById('lobbybrowse-style')) {
      const st = lbEl('style'); st.id = 'lobbybrowse-style'; st.textContent = LOBBY_BROWSE_CSS;
      document.head.appendChild(st);
    }
    const msgEl = lbEl('div', 'lb-msg', msg || '');
    const bar = lbEl('div', 'lb-br-bar');
    const at = lbEl('span', 'lb-br-at', '');
    bar.appendChild(at);
    const br = { box: lbEl('div', 'lb-br-list'), at, nameInp, msgEl, since: Date.now(), timer: 0, busy: false, list: null, err: '', polls: 0,
      // by build (above): byBuild = the server filters by build; all = SHOW ALL
      // is on (both kept in the lobby object, so a failed join or a trip to
      // another tab comes back to them: a SHOW ALL read never says byBuild)
      byBuild: !!lobby.browseByBuild, other: 0, mine: '', all: !!lobby.browseAll, hashWait: 0 };
    bar.appendChild(lbButton('Refresh', () => { br.since = Date.now(); br.paused = false; lobbyBrowsePoll(br); }, 'lb-br-refresh'));
    b.appendChild(lbEl('div', 'lb-sec', 'Open lobbies'));
    b.appendChild(bar);
    b.appendChild(msgEl);
    b.appendChild(br.box);
    br.foot = lbEl('div', 'lb-line', 'Every lobby without a password is listed here. Pick one and press JOIN.');
    b.appendChild(br.foot);
    const row = lbEl('div', 'lb-row');
    row.appendChild(lbButton('Cancel', () => lobbyLeave('You closed the lobby panel.'), 'lb-cancel'));
    b.appendChild(row);
    br.onVis = () => { if (lobby && lobby.browse === br && document.visibilityState === 'visible') lobbyBrowsePoll(br); };
    document.addEventListener('visibilitychange', br.onVis);
    lobby.browse = br;
    if (globalThis.ikemenNetcode !== 'rollback') msgEl.textContent = lobbyReason('netcode');
    lobbyBrowsePoll(br);
  }
  async function lobbyBrowsePoll(br) {
    clearTimeout(br.timer);
    br.timer = 0;
    if (!lobby || lobby.browse !== br) return;
    if (!br.box.isConnected) { lobbyBrowseStop(); return; }
    if (document.visibilityState !== 'visible') return; // visibilitychange resumes it
    if (Date.now() - br.since > LOBBY_LIST_FOR_MS) { br.paused = true; lobbyBrowseDraw(br); return; }
    if (br.busy) return;
    const url = lobbyListUrl();
    if (!url) { br.err = 'This build has no lobby server.'; lobbyBrowseDraw(br); return; }
    // the Build ID is worked out at load; wait for it a little (5 s at most,
    // then ask without it: the whole list, as before)
    if (!localHash) computeBuildHash();
    if (!localHash && br.hashWait < 50) { br.hashWait++; br.timer = setTimeout(() => lobbyBrowsePoll(br), 100); return; }
    const mine = lobbyMyBuild();
    const all = br.all;
    br.busy = true;
    try {
      // modes=1: this page plays a lobby's match mode, so the server lists
      // team-mode lobbies too (an older page is never shown one)
      const lq = new URLSearchParams();
      if (mine && !all) lq.set('build', mine);
      lq.set('modes', '1');
      const r = await fetch(url + '?' + lq.toString(), { cache: 'no-store' });
      if (r.status === 429) br.err = 'The lobby server asked to slow down; the list refreshes shortly.';
      else if (!r.ok) br.err = 'The list could not be loaded.';
      else {
        const j = await r.json();
        br.list = Array.isArray(j && j.list) ? j.list : [];
        br.err = '';
        br.got = Date.now();
        br.mine = mine;
        // only a reply to ?build= tells whether the server filters; the whole
        // list (SHOW ALL) keeps what the last one said
        if (!all) {
          br.byBuild = !!mine && !!j && j.build === mine && Number.isInteger(j.other);
          br.other = br.byBuild ? Math.max(0, j.other) : 0;
          if (lobby) lobby.browseByBuild = br.byBuild;
        }
      }
    } catch (e) { br.err = 'The lobby server could not be reached.'; }
    br.busy = false;
    br.polls++;
    if (!lobby || lobby.browse !== br) return;
    // SHOW ALL was switched while this read was out: read again for the new view
    if (all !== br.all) { br.list = null; lobbyBrowsePoll(br); return; }
    lobbyBrowseDraw(br);
    br.timer = setTimeout(() => lobbyBrowsePoll(br), LOBBY_LIST_EVERY_MS);
  }
  function lobbyBrowseDraw(br) {
    const box = br.box;
    box.textContent = '';
    br.at.textContent = br.paused ? 'Paused (10 minutes). Refresh to go on.'
      : br.got ? 'Updated ' + new Date(br.got).toLocaleTimeString() : 'Loading...';
    if (br.err) box.appendChild(lbEl('div', 'lb-msg', br.err));
    const filtered = br.byBuild && !!br.mine;
    // a row on another build (only a server that filters says which build a
    // lobby is on; a row without one is left as it is: joining it is checked)
    const diff = (e) => filtered && typeof e.build === 'string' && e.build !== br.mine;
    br.foot.textContent = filtered
      ? (br.all ? 'Every lobby without a password is listed here, and only the ones on your build can be joined. Pick one and press JOIN.'
        : 'The lobbies on your build are listed here (a lobby with a password never is). Pick one and press JOIN.')
      : 'Every lobby without a password is listed here. Pick one and press JOIN.';
    const L = br.list;
    if (!L) return;
    const rows = L.filter((e) => e && typeof e.code === 'string');
    if (filtered) {
      const n = br.all ? rows.filter(diff).length : br.other;
      if (n > 0 || br.all) {
        const line = lbEl('div', 'lb-br-builds');
        line.appendChild(lbEl('span', 'lb-br-hid', br.all
          ? (n === 1 ? '1 lobby is on another build: you cannot join it.' : n + ' lobbies are on other builds: you cannot join them.')
          : (n === 1 ? '1 lobby on another build is hidden.' : n + ' lobbies on other builds are hidden.')));
        const sw = lbButton(br.all ? 'My build only' : 'Show all', () => {
          br.all = !br.all;
          if (lobby) lobby.browseAll = br.all;
          br.list = null; br.got = 0; br.err = '';
          br.since = Date.now(); br.paused = false;
          lobbyBrowseDraw(br);
          lobbyBrowsePoll(br);
        }, 'lb-br-all');
        sw.setAttribute('aria-pressed', String(br.all));
        sw.title = br.all ? 'Show only the lobbies on your build' : 'Show the lobbies on other builds too (you cannot join them)';
        line.appendChild(sw);
        box.appendChild(line);
      }
    }
    if (!rows.length) {
      box.appendChild(lbEl('div', 'lb-br-empty', filtered
        ? 'No open lobby on your build right now. Create one: everyone on your build sees it here (a lobby with a password never does).'
        : 'No open lobbies right now. Create one: it shows up here for everyone (a lobby with a password never does).'));
      return;
    }
    // SHOW ALL: the lobbies this page can join first, in the server's order
    const show = br.all ? rows.filter((e) => !diff(e)).concat(rows.filter(diff)) : rows;
    for (const e of show) {
      const off = diff(e);
      const row = lbEl('div', off ? 'lb-br-row lb-br-off' : 'lb-br-row');
      row.dataset.code = e.code;
      if (off) { row.dataset.build = 'other'; row.title = LOBBY_OTHER_BUILD; }
      if (typeof e.title === 'string' && e.title) row.appendChild(lbEl('div', 'lb-br-title', e.title));
      const top = lbEl('div', 'lb-br-top');
      top.appendChild(lbEl('span', 'lb-br-host', String(e.host || '?')));
      if (off) top.appendChild(lbEl('span', 'lb-br-diff', 'Different build'));
      // the lobby's match mode (a server before modes lists none: 1v1)
      top.appendChild(lbEl('span', 'lb-br-mode', lobbyModeLabel(e.mode)));
      top.appendChild(lbEl('span', 'lb-br-n', (e.n | 0) + '/' + (e.max | 0)));
      row.appendChild(top);
      row.appendChild(lbEl('div', 'lb-br-now', e.a && e.b ? 'Now: ' + e.a + ' vs ' + e.b : 'Waiting for players'));
      if (e.streak && e.streak.n) row.appendChild(lbEl('div', 'lb-br-streak', 'Streak: ' + String(e.streak.name || '?') + ' ' + (e.streak.n | 0) + ' in a row'));
      if (off) row.appendChild(lbEl('div', 'lb-br-why', 'Not your build: everyone in a lobby needs the same build.'));
      const j = lbButton(e.free ? 'Join' : 'Full', () => lobbyBrowseJoin(br, e.code), 'lb-br-join');
      j.disabled = off || !e.free;
      j.title = off ? LOBBY_OTHER_BUILD : e.free ? 'Join ' + e.code : 'This lobby is full (8)';
      row.appendChild(j);
      box.appendChild(row);
    }
  }
  function lobbyBrowseJoin(br, code) {
    const name = br.nameInp.value.trim();
    lobby.form.name = name;
    if (!name) { br.msgEl.textContent = lobbyReason('name'); return; }
    lobbySaveName(name);
    lobby.form.code = code;
    br.msgEl.textContent = 'Joining ' + code + '...';
    lobbyBrowseStop();
    lobbyConnect('join', code, '', name, 0, (err) => {
      if (lobby && !lobby.code && !lobby.closed) { lobby.mode = 'browse'; lobbySetupView(err); }
    });
  }

  // THE BROWSER ID: a random id this page keeps in its own storage and sends
  // with every lobby it joins (&bid=). The lobby host's kick bars it as well as
  // the name, so a kicked person cannot come straight back from the same
  // browser under another name. It is not secret and not an account: clearing
  // the site's data or a private window makes a new one.
  let lobbyBidMem = '';
  function lobbyBid() {
    if (lobbyBidMem) return lobbyBidMem;
    let v = '';
    try { v = localStorage.getItem('ikemen-lobby-bid') || ''; } catch (e) { v = ''; }
    if (!/^[0-9a-f]{32}$/.test(v)) {
      const r = new Uint8Array(16);
      crypto.getRandomValues(r);
      v = Array.from(r, (x) => x.toString(16).padStart(2, '0')).join('');
      try { localStorage.setItem('ikemen-lobby-bid', v); } catch (e) { /* this page's id only */ }
    }
    lobbyBidMem = v;
    return v;
  }

  // A BACKGROUND TAB when this page is paired. The browser pauses the game in
  // a hidden tab, so its engine cannot take the match. The page says
  // {t:'away', match}: the lobby waits 120 s instead of 60 s and tells
  // everyone; and it calls its person back: the tab title blinks and a short
  // beep sounds. Both stop when the tab is shown again (the engine then takes
  // the match and says 'ready'). If the person does not come back in time the
  // lobby puts this member on spectate only, as before.
  let lobbyAlertTimer = 0, lobbyAlertTitle = '';
  function lobbyAwayCheck() {
    const a = lobby && lobby.assign;
    if (!a || a.kind !== 'play' || lobby.taken === a.match || document.visibilityState !== 'hidden' || lobby.awayFor === a.match) return;
    lobby.awayFor = a.match;
    lobbyRaw({ t: 'away', match: a.match });
    netLog('lobby: match ' + a.match + ' came up while this tab is hidden: told the lobby, calling you back');
    lobbyAlertStart('>> YOUR MATCH <<');
  }
  function lobbyAlertStart(text) {
    if (lobbyAlertTimer) return;
    lobbyAlertTitle = document.title;
    let on = true;
    document.title = text;
    lobbyAlertTimer = setInterval(() => { on = !on; document.title = on ? text : lobbyAlertTitle; }, 1000);
    try {
      const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
      const ac = AC ? new AC() : null;
      if (ac) {
        const o = ac.createOscillator(), g = ac.createGain();
        o.frequency.value = 880; g.gain.value = 0.08;
        o.connect(g); g.connect(ac.destination);
        o.start(); o.stop(ac.currentTime + 0.2);
        o.onended = () => { try { ac.close(); } catch (e) { /* closed */ } };
      }
    } catch (e) { /* no sound: the title still blinks */ }
  }
  function lobbyAlertStop() {
    if (!lobbyAlertTimer) return;
    clearInterval(lobbyAlertTimer);
    lobbyAlertTimer = 0;
    document.title = lobbyAlertTitle;
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') lobbyAlertStop();
    else if (lobby && !lobby.closed) lobbyAwayCheck();
  });
  //
  // instead of trusting the browser to send one (field report 2026-11-24: a
  // lobby whose page was gone stayed listed).
  addEventListener('pagehide', () => {
    if (lobby && !lobby.closed && lobby.ws) lobbyGone('The page was closed.');
  });

  // ---- the lobby heartbeat (LIVENESS in the lobby server's LOBBY CORE) ----
  // The page opens with &hb=1; a server that keeps lobbies alive this way
  // answers {t:'lobby'} with hb (its cadence in ms), and only then does the
  // page send LOBBY_HB that often, so an older server (2.5.1's lobby, a host
  // kit before 1.2.2) never gets a message it would count as junk. The
  // heartbeat keeps the socket from sitting silent while a host waits alone
  // (proxies close a silent WebSocket), and lets the server end a lobby whose
  // pages are all gone behind sockets that still look open (a silent page
  // beside someone the server hears stays: it may be a frozen background
  // tab). The server's answer and its sweep's {t:'hb'} need nothing from the
  // page.
  const LOBBY_HB = '{"t":"hb"}';
  function lobbyBeat(hb) {
    clearInterval(lobby.beat);
    lobby.beat = 0;
    if (!Number.isInteger(hb) || hb < 5000) return;
    const ws = lobby.ws;
    lobby.beat = setInterval(() => {
      try { if (ws && ws.readyState === 1) ws.send(LOBBY_HB); } catch (e) { /* closing */ }
    }, Math.min(hb, 60000));
  }

  // ---- the lobby socket ----
  function lobbyConnect(mode, code, pass, name, streak, fail) {
    const url = signalUrl();
    if (!url) { fail('This build has no lobby server.'); return; }
    if (!localHash) computeBuildHash();
    const go = () => {
      if (!localHash) { setTimeout(go, 100); return; }
      const q = new URLSearchParams();
      q.set('lobby', mode === 'create' ? 'new' : code);
      q.set('build', hex8(localHash));
      q.set('nc', String(localNetcode()));
      q.set('name', name);
      if (pass) q.set('pass', pass);
      if (mode === 'create' && streak) q.set('streak', String(streak));
      if (mode === 'create' && lobby.form && lobby.form.title) q.set('title', lobby.form.title.slice(0, 32));
      // THE MATCH MODE: the one a create asks for (none = 1 vs 1)
      lobby.asked = mode === 'create' ? lobbyModeOf(lobby.form && lobby.form.mm) : '';
      if (lobby.asked && lobby.asked !== 'single') q.set('mode', lobby.asked);
      q.set('bid', lobbyBid());
      q.set('hb', '1');
      q.set('modes', '1');
      const ws = new WebSocket(url + (url.includes('?') ? '&' : '?') + q.toString());
      lobby.ws = ws;
      let inside = false;
      ws.onmessage = (e) => { if (lobby && lobby.ws === ws) { let m; try { m = JSON.parse(e.data); } catch { return; } if (m.t === 'lobby') inside = true; lobbyOnMsg(m, fail); } };
      ws.onclose = () => {
        if (!lobby || lobby.ws !== ws) return;
        if (!inside) { if (!lobby.denied) fail('The lobby server could not be reached.'); lobby.ws = null; return; }
        lobbyGone(lobby.denied ? lobbyReason(lobby.denied) : 'The connection to the lobby was lost.');
      };
    };
    lobby.denied = '';
    go();
  }

  function lobbyOnMsg(m, fail) {
    if (m.t === 'deny') {
      lobby.denied = m.reason;
      if (!lobby.code) fail(lobbyReason(m.reason));
      return;
    }
    if (m.t === 'lobby') {
      lobby.code = m.code; lobby.you = m.you;
      lobbyBeat(m.hb);
      netLog('lobby: in ' + m.code + ' as member ' + m.you);
      lobbyUiMake();
      lobbyLog('You are in lobby ' + m.code + '.', 'lb-sys');
      return;
    }
    if (m.t === 'state') {
      const first = !lobby.view;
      lobby.view = m;
      for (const x of m.members) lobby.names[x.id] = x.name;
      if (first) lobbyUiMake();
      // a server before modes ignored the team mode its creator picked
      if (first && lobby.asked && lobby.asked !== 'single' && !lobbyModeOk(m.mode)) {
        lobby.note = 'This lobby server does not have match modes yet, so this lobby plays 1v1, not ' + lobbyModeLabel(lobby.asked) + '.';
        lobbyLog(lobby.note, 'lb-sys');
        netLog('lobby: the server sent no mode; ' + lobbyModeLabel(lobby.asked) + ' was asked, this lobby plays 1v1');
      }
      lobbyRender();
      lobbyOppCheck();
      return;
    }
    if (m.t === 'sys') {
      const t = lobbySysLine(m);
      if (t) lobbyLog(t, 'lb-sys');
      if (m.k === 'kick' && Number.isInteger(m.id)) (lobby.kickedIds || (lobby.kickedIds = new Set())).add(m.id);
      if (m.k === 'drop') lobbyDropNote(m);
      return;
    }
    if (m.t === 'chat') { if (typeof m.text === 'string') lobbyLog(m.text, '', { id: m.from, name: String(m.name || '?') }); return; }
    if (m.t === 'slow') { lobbyLog('(slow down: that line was not sent)', 'lb-sys'); return; }
    if (m.t === 'match' || m.t === 'watch') {
      const a = m.t === 'match'
        ? { match: m.match, kind: 'play', role: m.role === 'host' ? 'host' : 'guest', opp: m.opp && m.opp.id }
        : { match: m.match, kind: 'watch', host: m.host };
      lobby.assign = a;
      netLog('lobby: match ' + a.match + ' - ' + (a.kind === 'play' ? 'you play (' + a.role + ')' : 'you watch'));
      if (a.kind === 'play') lobbyAwayCheck();
      // A watch that has not started gives way at once (a newer match is up).
      if (lobby.watch && lobby.watch.match < a.match && !lobby.watch.started) lobbyEndWatch('a newer match was assigned');
      if (a.kind === 'play' && a.role === 'host' && !lobby.inMatch) {
        wslots.forEach((s, i) => { if (s && !s.closed && s.lmatch !== a.match) wClose(i, 'an earlier lobby match'); });
      }
      return;
    }
    if (m.t === 'watcher') {
      if (lobby.assign && lobby.assign.kind === 'play' && lobby.assign.role === 'host' && m.match === lobby.assign.match && Number.isInteger(m.id)) {
        wAdd(m.id, m.match).catch((e) => netLog('watcher setup failed: ' + e.message));
      }
      return;
    }
    if (m.t === 'wbye') { wLobby(m); return; }
    if (m.t === 'wdeny') {
      if (lobby.watch && m.match === lobby.watch.match) lobbyEndWatch('the match host refused: ' + m.reason);
      return;
    }
    if (m.t === 'sdp') {
      const cur = lobby.cur;
      // The other player's offer can come before this page's engine has
      // taken the match (a tab in the background, whose game is paused):
      // kept, and answered when the engine takes it (lobbyPlayStart).
      const asg = lobby.assign;
      if ((!cur || cur.match !== m.match) && asg && asg.kind === 'play' && asg.role === 'guest' && m.match === asg.match && m.from === asg.opp) {
        lobby.offer = { match: m.match, sdp: m.sdp };
        return;
      }
      // the other player's
      if (cur && cur.kind === 'play' && m.match === cur.match && m.from === cur.opp) {
        if (cur.role === 'host') {
          if (pc && lobby.inMatch) pc.setRemoteDescription(m.sdp).catch((e) => netLog('lobby: answer refused: ' + e.message));
        } else {
          lobby.offer = { match: m.match, sdp: m.sdp };
          lobbyGuestAnswer();
        }
        return;
      }
      // a watcher's answer (this page hosts the match)
      if (lobby.assign && lobby.assign.kind === 'play' && lobby.assign.role === 'host' && m.match === lobby.assign.match) {
        wLobby({ t: 'sdp', from: m.from, sdp: m.sdp });
        return;
      }
      // the match host's offer to this watcher (kept until the engine is free)
      if (lobby.assign && lobby.assign.kind === 'watch' && m.match === lobby.assign.match && m.from === lobby.assign.host) {
        lobby.woffer = { match: m.match, sdp: m.sdp };
        lobbyWatchAnswer();
      }
    }
  }

  // The lobby is over for this page (left, kicked, closed).
  function lobbyGone(why) {
    if (!lobby) return;
    const l = lobby;
    l.closed = true;
    clearInterval(l.beat);
    l.beat = 0;
    lobbyBrowseStop();
    lobbyAlertStop();
    if (l.watch) lobbyEndWatch('left the lobby');
    // This page's own match ends with it (Leave, a kick, the lobby closing):
    // its engine may be waiting on the other player inside the match.
    if (l.inMatch) { matchDropped = true; ikemenNet.close(); lobbyUnstick(); }
    try { if (l.ws) { l.ws.onclose = null; l.ws.close(); } } catch { /* gone */ }
    l.ws = null;
    netLog('lobby: ' + why);
    lobbyNoteDrop();
    lobbyUiDrop();
    lobby = { closed: true, why, names: {}, muted: new Set(), form: {} };
  }
  function lobbyLeave(why) { lobbyGone(why || 'You left the lobby.'); }

  // ---- the other player left (or was kicked) during a match ----
  // Field report (2026-11-15): "The game freezes if someone is kicked out or
  // leaves during play." The lobby server knows at once (the leaver's socket
  // closes, or the host's kick): it ends the match ('drop': the one still
  // there wins) and assigns the next. The engine did not know: a closed tab
  // does not close the WebRTC channel for seconds, so it waited on the player
  // who was gone, a frozen picture with no word on it, until one of its own
  // limits ran out:
  //   - in the fight, GGPO's DisconnectTimeout (8 s on the website);
  //   - when the fight had just ended, the post-match synchronize over the
  //     'ikemen' channel, until the browser declared the connection dead and
  //     this page's 12 s grace ran out (29 s in the test);
  //   - at the character select, the same channel wait.
  // Players pressed Esc to get out, which is what the lobby's Esc is for (it
  // ends this page's match, and the lobby puts the player back in line: kept
  // as it is). Now, when the server's state no longer lists this match's
  // other player while this page's engine is in that match (lobbyOppCheck):
  //   1. a short notice over the game says who left (lobbyDropNote / lobbyNote);
  //   2. this page closes the match's connection (lobbyPlayDrop), so every
  //      wait on the 'ikemen' channel (the select, the post-match synchronize)
  //      ends at once, the way the engine handles a lost connection;
  //   3. if the engine sits in its rollback loop waiting for the other
  //      player's inputs (lobbyUnstick: its datagrams still go out, its newest
  //      input frame has not moved for LOBBY_STUCK_MS), the page presses Esc
  //      for the player, once. The rollback loop reads it on its next turn and
  //      ends the match; that loop has no other way in from the page (true of
  //      the 2.4 engine). The modern-input engine sends a netplay Esc as
  //      synchronized input, which a stalled loop never reads; it asks the
  //      page instead (matchGone, every turn of its rollback loop) and ends
  //      the match itself, also in the post-match, so no Esc is pressed. Only
  //      while the wait is younger than LOBBY_UNSTICK_MAX_MS: past it the
  //      engine's own timeout is near, and an Esc that reached the engine
  //      after its loop ended would act in the lobby screen instead.
  // The page sends no result for the dropped match: the server settled it
  // (lobbyCmd 'result' sees the lobby has moved on). A watcher whose match host
  // left stops watching at once (lobbyOppCheck), instead of after its own
  // timeout.
  const LOBBY_STUCK_MS = 200, LOBBY_UNSTICK_MAX_MS = 5000, LOBBY_UNSTICK_FOR_MS = 6000, LOBBY_LOOP_SEEN_MS = 600;
  function lobbyOppCheck() {
    const v = lobby && lobby.view;
    if (!v) return;
    const member = (id) => v.members.some((x) => x.id === id);
    const w = lobby.watch;
    if (w && w.started && !member(w.host) && lobby.hostGone !== w.match) {
      lobby.hostGone = w.match;
      lobbyEndWatch('the match host left');
    }
    const c = lobby.cur;
    if (!c || c.kind !== 'play' || !lobby.inMatch || lobby.playing !== c.match || member(c.opp) || lobby.oppGone === c.match) return;
    lobby.oppGone = c.match;
    netLog('lobby: ' + lobbyName(c.opp) + ' left during match ' + c.match + '; ending it on this side');
    lobbyPlayDrop();
    lobbyUnstick();
  }
  // This page's end of the match's connection, closed now. The engine's own
  // exitNetPlay still closes the session (ikemenNet.close).
  function lobbyPlayDrop() {
    matchDropped = true;
    try { if (dc) dc.close(); } catch { /* gone */ }
    try { if (pc) pc.close(); } catch { /* gone */ }
    isClosed = true; isConnected = false;
  }
  // Presses Esc once if the engine's rollback loop is stuck on the other
  // player (see above); gives up when the engine is not in that loop.
  function lobbyUnstick() {
    const t0 = Date.now();
    const tick = () => {
      const now = Date.now();
      if (now - ggpoLive.sentAt > LOBBY_LOOP_SEEN_MS) return; // not in the rollback loop: the closed channel ends the rest
      // the engine asks matchGone in that loop and ends the match itself; an
      // Esc pressed now would reach it after the match, in the lobby screen
      if (goneAskedAt && now - goneAskedAt < LOBBY_LOOP_SEEN_MS) { netLog('lobby: the engine ends the dropped match itself'); return; }
      const still = ggpoLive.topAt ? now - ggpoLive.topAt : 0;
      if (still >= LOBBY_STUCK_MS) {
        if (still > LOBBY_UNSTICK_MAX_MS) return;
        netLog('lobby: the match is stuck on a connection that is gone; Esc pressed for you');
        lobbyEsc();
        return;
      }
      if (now - t0 < LOBBY_UNSTICK_FOR_MS) setTimeout(tick, 100);
    };
    tick();
  }
  function lobbyEsc() {
    const key = (type) => {
      try { document.dispatchEvent(new KeyboardEvent(type, { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true })); } catch { /* no engine listening */ }
    };
    key('keydown');
    setTimeout(() => key('keyup'), 60);
  }
  // A player left mid-match: everyone in the lobby gets one line over the
  // game for a few seconds (the chat keeps the full story).
  function lobbyDropNote(m) {
    const kicked = !!(lobby.kickedIds && lobby.kickedIds.has(m.id));
    const who = String(m.idn || lobbyName(m.id)).slice(0, 24);
    const c = lobby.cur;
    const mine = c && c.kind === 'play' && c.match === m.match && c.opp === m.id;
    lobbyNote(who + (kicked ? ' was removed by the host' : ' left') + (mine ? ': you win this match.' : ' mid-match.'));
  }
  const LOBBY_NOTE_MS = 5000;
  function lobbyNote(text) {
    let el = document.getElementById('lobbynote');
    if (!el) {
      if (!document.getElementById('lobbybar-style')) return; // no lobby sidebar, no lobby look
      el = lbEl('div'); el.id = 'lobbynote'; el.setAttribute('role', 'status');
      document.body.appendChild(el);
    }
    el.textContent = text;
    el.hidden = false;
    const narrow = document.documentElement.clientWidth < LOBBY_NARROW;
    const right = lobby && lobby.ui && !lobby.ui.folded && !narrow ? LOBBY_W : 0;
    el.style.left = 'calc((100vw - ' + right + 'px) / 2)';
    clearTimeout(lobbyNote.timer);
    lobbyNote.timer = setTimeout(lobbyNoteDrop, LOBBY_NOTE_MS);
  }
  function lobbyNoteDrop() {
    clearTimeout(lobbyNote.timer);
    const el = document.getElementById('lobbynote');
    if (el) el.remove();
  }

  // ---- this page plays a match (ikemenNet.start('lobby'), from the engine) ----
  async function lobbyPlayStart() {
    const a = lobby && lobby.cur;
    if (!a || a.kind !== 'play' || !lobbyOn()) { isFailed = true; netLog('lobby: no match to play'); return; }
    lobby.inMatch = true;
    lobby.playing = a.match;
    lobby.connectBy = Date.now() + LOBBY_CONNECT_MS;
    queueRole = a.role;
    lobbyPlates(a);
    if (a.role === 'host') {
      installHostWatchBridge();
      await makePeer();
      wireChannel(pc.createDataChannel('ikemen', { ordered: true }));
      wireGGPO(pc.createDataChannel('ggpo', { ordered: false, maxRetransmits: 0 }));
      await pc.setLocalDescription(await pc.createOffer());
      await gatherComplete();
      if (lobby.playing !== a.match) return;
      lobbyRaw({ t: 'sdp', sdp: pc.localDescription });
      netLog('lobby: offer sent to ' + lobbyName(a.opp));
    } else {
      if (globalThis.ikemenWatch) globalThis.ikemenWatch = undefined;
      await makePeer();
      pc.ondatachannel = (ev) => {
        if (ev.channel.label === 'ggpo') wireGGPO(ev.channel);
        else wireChannel(ev.channel);
      };
      lobby.guestReady = a.match;
      lobbyGuestAnswer();
    }
  }
  async function lobbyGuestAnswer() {
    const a = lobby && lobby.cur;
    const o = lobby && lobby.offer;
    if (!a || !o || o.match !== a.match || lobby.guestReady !== a.match || !pc || lobby.answered === a.match) return;
    lobby.answered = a.match;
    try {
      await pc.setRemoteDescription(o.sdp);
      await pc.setLocalDescription(await pc.createAnswer());
      await gatherComplete();
      if (lobby.playing === a.match) lobbyRaw({ t: 'sdp', sdp: pc.localDescription });
      netLog('lobby: answer sent to ' + lobbyName(a.opp));
    } catch (e) { netLog('lobby: offer refused: ' + e.message); }
  }

  // ---- this page watches a match (the engine took a 'watch' assignment) ----
  function lobbyWatchBegin(a) {
    installWatcherBridge();
    lobby.watch = { match: a.match, host: a.host, started: false };
    lobbyWatchAnswer();
  }
  function lobbyWatchAnswer() {
    const w = lobby && lobby.watch, o = lobby && lobby.woffer;
    if (!w || !o || o.match !== w.match || wpc) return;
    watchAnswer(o.sdp, (sdp) => lobbyRaw({ t: 'sdp', sdp })).catch((e) => netLog('lobby: watch setup failed: ' + e.message));
  }
  function lobbyEndWatch(why) {
    if (!lobby || !lobby.watch) return;
    netLog('lobby: watching ends (' + why + ')');
    lobby.watch = null;
    wClosed = true;
    dropWatchConn();
  }

  // What the engine asks (main.lua main.f_lobby, through netLobby).
  function lobbyCmd(cmd, arg) {
    // The online menu's LOBBY row: a lobby server that has lobbies.
    if (cmd === 'avail') return signalUrl() && lobbyServerCan() ? 'yes' : '';
    if (cmd === 'open') {
      if (!signalUrl()) return '';
      if (!lobby || lobby.closed) lobby = { names: {}, muted: new Set(), form: {}, mode: 'create', results: [] };
      if (!lobby.code) lobbySetupView();
      else lobbyFold(false);
      return 'ok';
    }
    if (!lobby || lobby.closed) return cmd === 'next' ? 'gone' : '';
    if (cmd === 'next') {
      if (!lobby.code) return lobby.ws || lobby.ui ? '' : 'gone';
      if (!lobbyOn()) return 'gone';
      const a = lobby.assign, v = lobby.view;
      if (!a || a.match === lobby.taken || !v || !v.match || v.match.id !== a.match) return '';
      lobby.taken = a.match;
      lobby.cur = Object.assign({ a: v.match.a, b: v.match.b, mode: lobbyModeNow() }, a);
      if (a.kind === 'watch') lobbyWatchBegin(a);
      // A player tells the lobby its engine took the match: one that never
      // does within a minute (its game is not in the lobby loop, or gone) is
      // put on spectate only and the other player keeps its place.
      else lobbyRaw({ t: 'ready', match: a.match });
      return a.kind + ':' + a.match;
    }
    if (cmd === 'stale') {
      const c = lobby.cur, v = lobby.view;
      if (!c || !lobbyOn() || !v || !v.match || v.match.id !== c.match) return 'yes';
      // Both took the match but the connection never came up (their networks
      // cannot reach each other): give up after LOBBY_CONNECT_MS; the engine
      // reports "no result", and the lobby voids the match and moves on
      // instead of waiting out its 15-minute cap.
      // The clock starts when BOTH players' engines took the match (the
      // lobby's state lists them in match.ready): a player whose opponent's
      // tab is in the background waits for the lobby's longer deadline
      // instead of giving up first. (A lobby without match.ready: the clock
      // starts with this page's own start, as before.)
      if (c.kind === 'play' && !isConnected) {
        const r = v.match.ready;
        if (Array.isArray(r)) {
          if (lobby.bothFor !== c.match) { lobby.bothFor = c.match; lobby.bothAt = 0; }
          if (!lobby.bothAt && r.includes(v.match.a) && r.includes(v.match.b)) lobby.bothAt = Date.now();
          lobby.connectBy = lobby.bothAt ? lobby.bothAt + LOBBY_CONNECT_MS : 0;
        }
        if (lobby.connectBy && Date.now() > lobby.connectBy) {
          lobby.connectBy = 0;
          lobby.gaveUp = c.match;
          netLog('lobby: no connection to ' + lobbyName(c.opp) + ' after ' + (LOBBY_CONNECT_MS / 1000) + ' s; giving up on match ' + c.match);
          return 'yes';
        }
      }
      return '';
    }
    if (cmd === 'result') {
      const c = lobby.cur;
      const side = parseInt(arg, 10);
      if (c) {
        const winner = side === 1 ? c.a : side === 2 ? c.b : side === 0 ? 0 : -1;
        // Only for the match the lobby is still on: one it has settled or
        // called off already (both players agreed; a player never took it)
        // takes no report, and the server counts a late one as junk.
        const v = lobby.view;
        const open = !!(v && v.match && v.match.id === c.match);
        // a page that gave up connecting says so: when both pages say so the
        // lobby calls it no contest (the stayer keeps its streak); one page
        // saying so against a win claim needs a watcher's vote for the claim,
        // or the match is void
        if (open) lobbyRaw(winner === -1 && c.kind === 'play' && lobby.gaveUp === c.match
          ? { t: 'result', match: c.match, winner, why: 'noconn' } : { t: 'result', match: c.match, winner });
        netLog('lobby: match ' + c.match + (open ? ' result sent: ' : ' is over on the lobby, not sent: ') + (winner > 0 ? lobbyName(winner) + ' won' : winner === 0 ? 'draw' : 'no result'));
        if (lobby.results) lobby.results.push({ match: c.match, kind: c.kind, side, winner, sent: open });
      }
      if (c && c.kind === 'watch') lobby.watch = null;
      lobby.cur = null;
      return '';
    }
    if (cmd === 'leave') { lobbyLeave('You left the lobby.'); return ''; }
    if (cmd === 'rounds') return devnet && /^[1-9]$/.test(qp.get('lobbyrounds') || '') ? qp.get('lobbyrounds') : '';
    // the match mode the engine sets for a lobby match (THE MATCH MODE): the
    // lobby's, as the server reports it, taken when the engine took the match
    if (cmd === 'mode') {
      const m = lobby.cur ? lobby.cur.mode : lobbyModeNow();
      netLog('lobby: the engine asks the match mode: ' + lobbyModeLabel(m));
      return m;
    }
    if (cmd === 'text') {
      if (!lobby.code) return 'LOBBY\n\nCreate, join or browse lobbies in the panel on the right.\n\nEsc: back';
      const v = lobby.view;
      if (!v) return 'LOBBY ' + lobby.code;
      const mm = lobbyModeNow();
      const L = ['LOBBY ' + v.code + '   ' + v.members.length + '/' + v.max + (mm !== 'single' ? '   ' + lobbyModeLabel(mm).toUpperCase() : '')];
      L.push(...lobbyNowNext(true));
      const c = lobby.cur;
      if (c && c.kind === 'watch') {
        // "in line" only once the match's host said it had started before
        // this page was verified ({t:'late'}): a member who joined at the
        // select still watches it from its start.
        const w = lobby.watch;
        L.push(w && w.started ? 'YOU: watching'
          : w && w.late && w.match === c.match ? 'YOU: in line (this match started before you joined)' : 'YOU: watching (waiting for it to start)');
      }
      else if (c && c.kind === 'play') L.push('YOU: connecting to ' + asciiName(lobbyName(c.opp)) + '...');
      else L.push('YOU: ' + lobbyStatusOf(lobby.you).toLowerCase());
      L.push('', 'Esc: leave the lobby');
      return L.join('\n');
    }
    return '';
  }

  // What a test driver reads (dev switch only).
  if (devnet) {
    globalThis.ikemenTest = {
      room: '',
      // trail(): the checksum trail; trail(N): lobby match N's (its first
      // GGPO session; a Turns match's later turns are 'N/1', 'N/2'...)
      trail(k) { return Array.from((k ? lobbyTrails.get(k) || new Map() : crcTrail).entries()).sort((a, b) => a[0] - b[0]); },
      trails() { return Array.from(lobbyTrails.keys()); },
      lobby() {
        if (!lobby) return null;
        return { code: lobby.code || '', you: lobby.you || 0, view: lobby.view || null, assign: lobby.assign || null,
          cur: lobby.cur || null, taken: lobby.taken || 0, inMatch: !!lobby.inMatch, playing: lobby.playing || 0,
          watch: lobby.watch || null, results: lobby.results || [], closed: !!lobby.closed, why: lobby.why || '',
          browse: lobby.browse ? { polls: lobby.browse.polls || 0, n: lobby.browse.list ? lobby.browse.list.length : -1, paused: !!lobby.browse.paused } : null,
          gaveUp: lobby.gaveUp || 0, away: lobby.awayFor || 0, alert: !!lobbyAlertTimer };
      },
      slots() { return globalThis.ikemenWatch && globalThis.ikemenWatch.slots ? globalThis.ikemenWatch.slots() : []; },
      refused() { return globalThis.ikemenWatchRefused || ''; },
      closed() { return wClosed; },
      count() { return watchCount; },
    };
  }
  if (devnet && qp.get('watch')) {
    // The engine boots with -watch (index.html) and polls ikemenWatch.next(),
    // which says "nothing yet" until the host's first message; the build
    // check needs the Build ID and the Engine ID, both set during boot, so
    // the connection waits for them.
    installWatcherBridge();
    const go = () => {
      if (!(globalThis.ikemenBuildHash instanceof Uint8Array) || globalThis.ikemenEngineId === undefined) { setTimeout(go, 200); return; }
      // the hello waits for this page's Build ID; ikemenNet.start works it
      // out (resetState), this route never calls start
      if (!localHash) computeBuildHash();
      watchPanel(false);
      startWatch(qp.get('watch'), qp.get('pass') || '');
    };
    go();
  }

  // ---- what this page's lobby server can do (LOBBY, WATCH A MATCH) ----
  // A relay that only makes rooms (the host kit before 1.2.0) has no lobbies,
  // no watching and no list of open lobbies, so the online menu must not offer
  // them there. The page asks the list's own address once, at load (GET
  // <lobby server>/lobbies, lobbyListUrl): 200 with {t:'lobbies'} is a server
  // that has them (the reference relay, the host kit 1.2.0 and later). A 404 or
  // any other answer (an older kit) hides them for good; a request that fails
  // (offline) or is refused for now (429, 5xx) hides them until the online menu
  // asks again (at most every LOBBY_CAN_RETRY_MS). Until an answer arrives the
  // menu treats them as not there. A page without a lobby server never asks.
  const LOBBY_CAN_RETRY_MS = 15000;
  const lobbyCan = { url: '', state: '', at: 0 };   // state: '' | 'asking' | 'yes' | 'no'
  function lobbyCanCheck() {
    const u = lobbyListUrl();
    if (!u) return;
    if (lobbyCan.url === u && (lobbyCan.state === 'yes' || lobbyCan.state === 'no' || lobbyCan.state === 'asking')) return;
    if (lobbyCan.url === u && Date.now() - lobbyCan.at < LOBBY_CAN_RETRY_MS) return;
    lobbyCan.url = u; lobbyCan.state = 'asking'; lobbyCan.at = Date.now();
    fetch(u, { cache: 'no-store', credentials: 'omit' }).then((r) => {
      if (r.status === 429 || r.status >= 500) return null;
      if (!r.ok) return false;
      return r.json().then((d) => !!(d && d.t === 'lobbies'), () => false);
    }).then((has) => {
      if (lobbyCan.url !== u) return;
      lobbyCan.state = has === null ? '' : has ? 'yes' : 'no';
      lobbyCan.at = Date.now();
      // the console only: netLog would open the netplay line under the game
      console.log('[netplay] lobby server: ' + (has === null ? 'busy, asks again later' : has ? 'has lobbies and watching' : 'rooms only (no LOBBY or WATCH A MATCH)'));
    }, () => {
      if (lobbyCan.url !== u) return;
      lobbyCan.state = ''; lobbyCan.at = Date.now();
    });
  }
  function lobbyServerCan() {
    lobbyCanCheck();
    return lobbyCan.state === 'yes';
  }
  lobbyCanCheck();

  globalThis.ikemenNet = {
    start(mode) {
      resetState();
      // A lobby's match: this page's role came from the lobby server.
      if (mode === 'lobby') { netLog('lobby: starting the match'); lobbyPlayStart().catch((e) => { isFailed = true; netLog('lobby: ' + e.message); }); return; }
      // A lobby's watch: the bridge is up already (lobbyWatchBegin), no panel.
      if (mode === 'watch' && lobby && lobby.watch && globalThis.ikemenWatch && globalThis.ikemenWatch.role === 'watcher') {
        netLog('lobby: watching match ' + lobby.watch.match);
        // Same plates as the two players draw; queueRole stays '' (resetState
        // above) so a watcher never reports or plays a side.
        lobbyPlates(lobby.cur);
        return;
      }
      if (mode === 'watch') { netLog('watch a match'); startWatchFlow(); return; }
      netLog(mode === 'host' ? 'hosting - generating offer'
        : mode === 'queue' ? 'entering ranked match queue'
          : mode === 'casual' ? 'entering casual match queue'
            : 'joining - awaiting offer');
      if (mode === 'host') startHost();
      else if (mode === 'queue') startQueue('ranked');
      else if (mode === 'casual') startQueue('casual');
      else startJoin();
    },
    // index.html: the engine stopped (it exited, or crashed). A lobby member
    // whose engine is gone can neither play nor watch, so the page leaves the
    // lobby: the server takes it out of the line (a player of the current
    // match loses it) and the rotation goes on instead of pairing it again.
    engineExited() {
      if (lobby && !lobby.closed && (lobby.code || lobby.ws)) lobbyGone('The game stopped, so this page left the lobby.');
    },
    //
    // server assigned us ('' until matched), and the verified display
    // names as "p1\np2" for the in-match plates.
    queueRole() { return queueRole; },
    // "p1\np2\n<pairingToken>". The third line is the server-assigned pairing
    // time, which is unique per pairing and identical on both peers.
    //
    // It exists because the Lua that draws the plates and reports results runs
    // on the engine's per-frame 'loop' hook, which fires ONLY during a fight.
    // Between matches - at the queue screen, where a NEW opponent is assigned -
    // it does not run at all, so it can never observe the transition and clear
    // its caches. Result in the field (2026-08-11): after one set, the plates
    // kept showing the PREVIOUS opponent's names on the previous sides, and the
    // report latch stayed armed so only the first pairing was ever counted.
    // Keying those caches on this token makes them invalidate on their own,
    // without needing to witness the gap.
    // LINE CONTRACT (mirrored in the Lua that parses this):
    //
    // Lines 1-3 are SHARED TRUTH - byte-identical on both peers, safe to drive
    // flow and reporting. Line 4 is this player's OWN rating and differs
    // between peers by design; it is display data only and must never be fed
    // into counting, reporting or flow.
    // NETWORK > YOUR RANK. Returns display text, or '' when there is nothing
    // to show yet (no identity, no server, or the first fetch is still in
    // flight). Never blocks: it hands back the cached standing and kicks a
    // refresh, so the menu is always instant.
    rankStatus() {
      if (!IDENTITY_URL) return '';
      const id = rankedIdentity();
      if (!id) return '';
      rankRefresh(false);
      if (!rankCache) return '';
      return id.name + '\n' + rankLines(rankCache);
    },

    queueNames() {
      if (!queueP1) return '';
      //
      //
      //
      //
      //
      // by removing the trigger rather than by adding a second flag that could
      // disagree with the first. Lines 1-2 are untouched, so the in-match name
      // plates behave identically in both modes.
      //
      // The Lua guard is `npToken == nil or npToken == ''`, so ANYTHING else -
      // including the string '0' - is a real token to it. Shipping '0' here on
      //
      // at 2 wins and dropped both players back to the menu) and then never
      //
      //
      var token = queueRated ? String(queueStartedAt || 0) : '';
      var base = queueP1 + '\n' + queueP2 + '\n' + token;
      return rankedStatusLine && !queueLobby ? base + '\n' + rankedStatusLine : base;
    },

    //
    // player's identity. Only queue matches report: a friend match has no
    // verified opponent, so counting it would let anyone inflate a record.
    // The opponent posts the mirror image of this independently, and the
    // server counts the match only when the two agree.
    // p1Char/p2Char are the characters on ENGINE SIDES 1 and 2 - not "mine"
    // and "theirs". The Lua reads them with player(1)/player(2), which is the
    // same pair of values on both peers; each side then has to pick its own
    // out of them by role.
    reportResult(winSide, p1Char, p2Char) {
      try {
        if (!queueRole || !queueP1 || !queueP2) return;      // not a queue match
        //
        // match - it has a role, both names and a pairing time, because it
        // needs them for host assignment and the name plates. So this cannot
        // be left to fall out of missing data; it has to be an explicit gate,
        // and it reads the SERVER's verdict rather than the local mode.
        if (!queueRated) return;                            // casual: never rated, never recorded
        if (winSide !== 1 && winSide !== 2) return;          // draw: nothing to record
        var id = null;
        try { id = JSON.parse(localStorage.getItem('ikemen-identity')); } catch (e) { return; }
        if (!id || !id.name || !id.code) return;
        if (!queueStartedAt) { netLog('no pairing time - result not reported'); return; }
        var iAmP1 = queueRole === 'host';                    // host is always side 1
        // Advance only AFTER every guard: a peer that bails out early must not
        // leave its counter one ahead of the other side's for the rest of the
        // session. Both peers report every match, so both counters step together.
        var seq = ++queueMatchSeq;
        var body = {
          name: id.name,
          code: id.code,
          opponent: iAmP1 ? queueP2 : queueP1,
          won: iAmP1 ? winSide === 1 : winSide === 2,
          // OUR OWN character: the host is side 1, the guest side 2. The
          // first version reported p1Char from both peers, so a guest filed
          // the host's character as their own and both rows on the board
          // showed the same fighter (field-hit on the first real match).
          character: iAmP1 ? p1Char : p2Char,
          // Both peers must derive the SAME match key without talking: the
          // queue's pairing time `at`, sent verbatim to both and used as is
          // (the server keys on the two names, this number and seq).
          startedAt: queueStartedAt,
          seq: seq,
          buildId: globalThis.ikemenBuildHex || ''
        };
        netLog('reporting result: ' + (body.won ? 'WIN' : 'LOSS') + ' vs ' + body.opponent);
        fetch(IDENTITY_URL + '/mugen/leaderboard/report', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          keepalive: true   // survive the page being closed right after
        }).then(function (r) { return r.json(); })
          .then(function (r) {
            netLog('leaderboard: ' + (r && r.state || 'no reply'));
            // Display only - never gates the match or the report itself.
            try { rankedResolve(r); } catch (e) { /* keep the match clean */ }
          })
          .catch(function (e) { netLog('leaderboard report failed: ' + e.message); });
      } catch (e) {
        netLog('report error: ' + e.message);   // never disturb the match
      }
    },
    // The online menu's WATCH A MATCH shows only where watching can work:
    // this page has a lobby server and it serves watchers (lobbyServerCan;
    // the engine reads it, watch_js.go).
    get watchSupported() { return !!signalUrl() && lobbyServerCan(); },
    // The winner-stays lobby (main.lua main.f_lobby, through netLobby).
    lobby(cmd, arg) {
      try { return lobbyCmd(String(cmd), String(arg || '')); } catch (e) { netLog('lobby: ' + e.message); return ''; }
    },
    connected() { return isConnected; },
    // The engine's rollback loop, every turn (netplay_js.go platformMatchGone):
    // true once this page dropped the match because the other player is gone.
    matchGone() { goneAskedAt = Date.now(); return matchDropped; },
    failed() { return isFailed; },
    // numEmpty (readGGPO and readAny too): 0 instead of an empty array when
    // nothing waits. The engine polls every millisecond or two, and each empty
    // array it got back was one more JS object for its garbage collector.
    read(max, numEmpty) {
      if (chunks.length === 0) return isClosed ? null : (numEmpty ? 0 : new Uint8Array(0));
      const head = chunks[0];
      const avail = head.length - chunkOff;
      const n = Math.min(avail, max);
      const out = head.subarray(chunkOff, chunkOff + n);
      if (n === avail) { chunks.shift(); chunkOff = 0; }
      else chunkOff += n;
      bytesReadByEngine += n; renderDiag();
      return out;
    },
    send(u8) {
      if (!dc || dc.readyState !== 'open') return false;
      try { dc.send(u8); bytesSent += u8.length; renderDiag(); return true; } catch { return false; }
    },
    // GGPO datagram channel (V2 rollback). readGGPO returns ONE whole
    // datagram (Uint8Array), an empty array (0 with numEmpty) when none
    // pending, or null when the channel is closed.
    sendGGPO(u8) {
      ggpoTrack(u8); // before the channel check: the engine's loop, even with no channel
      if (!gdc || gdc.readyState !== 'open') return false;
      if (trailOn) trailFromDatagram(u8); // dev switch (?devnet=1&crctrail=1)
      try { gdc.send(u8); return true; } catch { return false; }
    },
    readGGPO(numEmpty) {
      if (gQueue.length > 0) return gQueue.shift();
      return (gdc || !isClosed) ? (numEmpty ? 0 : new Uint8Array(0)) : null;
    },
    // Rollback round-trip time from the engine (shown in the overlay
    // header like any fighting game's ping counter).
    setPing(ms) {
      pingMs = ms;
      if (nd) nd.ping(ms);
      renderDiag();
    },
    // Engine-side diagnostic line onto the on-screen overlay (so handshake
    // progress is visible without opening the browser console).
    olog(msg) {
      netLog(msg);
    },
    close() {
      try { if (dc) dc.close(); } catch {}
      try { if (pc) pc.close(); } catch {}
      // The room ends with the session: the lobby socket closes, and every
      // watcher's connection with it.
      endHosting();
      if (guestWs) { guestWs.__done = true; try { guestWs.close(); } catch {} guestWs = null; }
      watchCount = null;
      isClosed = true; isConnected = false;
      if (lobby) lobby.inMatch = false;
      ndStop(); // the ping diagnostics end with the session
      netLog('session closed');
      hidePanel();
      setTimeout(hideDiag, 8000); // leave the log up briefly after teardown
    },
  };
})();
