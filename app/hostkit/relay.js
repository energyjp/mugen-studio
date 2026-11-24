// Mugen Studio host kit: the lobby relay (Room) and the matchmaking queue
// (Queue), two Durable Object classes of the kit's one Worker.
//
// It implements the Studio's lobby protocol byte for byte, so the game page
// (public/ikemen/webrtc.js) talks to it unchanged: rooms, watching a room's
// matches, winner-stays lobbies of up to 8 and the list of open lobbies (kit
// 1.2.0; kit 1.1.0 made plain two-player rooms only). Left out on purpose:
// every chat-channel notice, the hand-offs to a separate ranked server, and
// every hardcoded address. Added:
//   - names are verified, and ranked pairings recorded, by the kit's own
//     Ladder object (hostkit/ladder.js) through the call shape below;
//   - a ranked pairing is recorded BEFORE either player hears 'match', so the
//     Ladder can count only results from pairings this queue really made;
//   - a name is never paired with itself (two tabs, one name);
//   - the queue bucket's build must be short lowercase hex, like the Build ID
//     the client sends (vfs.js ikemenBuildHex), so a client string cannot
//     mint unbounded queue objects;
//   - a Ladder that fails says 'identdown', not 'badident', so a player is
//     not told their name is wrong when the server is the problem;
//   - waits that nobody answers are capped ('timeout'): an unmatched queue
//     waiter and a room host nobody joined (a watch room too, and the
//     reference caps those the same way). A pair that is mid-setup (after
//     'match' or 'peer') is never cut off.
//
// PROTOCOL (what a client sees on /ws):
//   ?create=1[&pass=...]   -> {t:'room', code}
//   ?join=CODE[&pass=...]  -> guest {t:'joined'}, host {t:'peer'}
//                             {t:'deny', reason:'badcode'|'badpass'|'full'|'busy'}
//   ?create=1&watchers=1[&pass=...]  a room that takes watchers
//   ?watch=CODE[&pass=...] -> a watcher (WATCHERS, at the Room class)
//   ?lobby=new|CODE&build=..&nc=1&name=..[&pass=][&streak=N][&bid=]
//                          -> a winner-stays lobby (the LOBBY CORE below)
//   ?queue=1&mode=ranked|casual&build=HEX&nc=0|1&name=NAME&code=RECOVERYCODE
//                          -> {t:'qcount', n} while waiting
//                             {t:'match', role:'host'|'guest', opponent, at, mode}
//                             {t:'deny', reason:'badident'|'identdown'}
//   either wait, when nobody answers in time: {t:'deny', reason:'timeout'}
//   Then {t:'sdp', ...} is relayed verbatim between the two peers, and a peer
//   leaving sends {t:'bye'} to the other. On the queue path {t:'playing'}
//   from either peer marks the handoff to the game and is never relayed.
//   Room and lobby codes are lowercased. One Queue object per mode+build+netcode.
// And on plain HTTP (router.js serves it): GET /lobbies -> {t:'lobbies', list},
// GET /lobbies?build=HEX16 -> {t:'lobbies', build, other, list}
// (THE LIST, below).
//
// THE SAME AS THE REFERENCE SERVER. The rooms with watchers, the lobbies and
// the list are the reference relay's (its worker.js), with the same limits:
// the LOBBY CORE block is copied byte for byte (its comments still say
// "worker.js and server.js": the reference's two servers; here it lives in
// this file), and the Room class and the directory are the same code. The
// deliberate differences, each kept as small as it can be:
//   1. the Room takes the kit's test hooks (constructor opts: now, roomWaitMs)
//      and reads its clock through this.now(); the wait cap comes from
//      opts, then the Worker's ROOM_WAIT_MS var, then ROOM_WAIT_MS (30 min,
//      the reference's number);
//   2. a plain room nobody joined is closed with {t:'deny', reason:'timeout'}
//      when its wait is over (kit 1.1.0 did this; the reference only stops
//      counting such a room as active): the Room sets its alarm for it, and
//      a guest joining clears it;
//   3. the per-address read limit on GET /lobbies and the limit on joins by
//      code (code guessing) live in router.js's RATE_LIMITS, keyed by
//      addrHash below, with the reference's numbers; the create gate and the
//      per-creator cap stay in the directory object, as there;
//   4. an unknown request on /ws answers 400 'missing create/join/watch/queue/lobby'
//      (the reference's text; kit 1.1.0 said 'missing create/join/queue').
//
// LADDER CALL SHAPE (the Queue's only dependency on hostkit/ladder.js). The
// Queue receives one async function, ladder(op, body) -> parsed JSON reply;
// in the Worker it is ladderViaStub(env), which does exactly:
//   stub = env.LADDER.get(env.LADDER.idFromName('ladder'))
//   stub.fetch('https://ladder.internal/internal/' + op, {
//     method: 'POST', headers: {'content-type': 'application/json'},
//     body: JSON.stringify(body) })
// with op and body:
//   'verify'  {name, code}  -> 200 {ok:true[, name]} when the recovery code
//                              matches the name (name = its claimed casing,
//                              used on the opponent's plate), 200 {ok:false}
//                              when it does not
//   'pairing' {a, b, at}    -> 200 {ok:true} once recordPairing(a, b, at) is
//                              stored, 200 {ok:false[, reason]} when it is
//                              refused; a and b are the two verified names
//                              (host first), at is the server's pairing time in
//                              ms, the same number both players receive in
//                              'match'. Anything but {ok:true} means no match.
// A throw, a status other than 200, a body without a boolean ok, or no answer
// within LADDER_TIMEOUT_MS all mean the Ladder is down. hostkit/ladder.js
// answers exactly this (its verifyIdentity / recordPairing helpers are the
// same two calls). The Worker must never forward a public request to the
// Ladder's /internal/ paths: they trust their caller, and only this file
// calls them. Nor to a Room's /dir/ paths (THE LIST): only Room objects call
// those, Durable Object to Durable Object.
//
// WIRING (hostkit/worker.js):
//   import { Room, Queue, handleRelay } from './relay.js';
//   export { Room, Queue };
//   ...in fetch: if (url.pathname === '/ws') return handleRelay(request, env);
//   Bindings: ROOM, QUEUE and LADDER (durable_object_namespace). Optional
//   plain-text vars QUEUE_WAIT_MS and ROOM_WAIT_MS override the wait caps
//   (the test suite uses them); leave them unset in a real deploy.
//
// The Queue's sockets use accept() without hibernation, like the reference
// queue: a lost Queue object empties its queue, and a match already handed
// off is peer to peer and unaffected. The Room's sockets hibernate (see
// HIBERNATION at the Room class).
//
// Tests: node tools/test-hostkit-relay.js, node tools/test-hostkit-lobby.mjs,
// node tools/test-hostkit-lobby-live.mjs

// ---------------------------------------------------------------- settings --
// Host settings, each in one place.

// How long an unmatched player may sit in the queue. Keep the queue text in
// webrtc.js (the 'timeout' deny in startQueue) in step with this.
export const QUEUE_WAIT_MS = 10 * 60 * 1000;
// How long a room may wait for its guest. Keep friendlyDeny's 'timeout' text
// in webrtc.js (and the 30 minutes its 'badcode' text mentions) in step
// with this.
export const ROOM_WAIT_MS = 30 * 60 * 1000;
// A ranked pair whose pairing the Ladder could not record is not started:
// both players get 'identdown' instead of a set that would never count. Flip
// to false only together with the Ladder's rule that counts a ranked result
// only for a pairing this queue recorded.
export const PAIRING_MUST_RECORD = true;
// Longest build string a queue bucket accepts. The client's Build ID is 12
// hex characters today.
export const MAX_BUILD_HEX = 64;
// How long a Ladder call may take before the Ladder counts as down.
export const LADDER_TIMEOUT_MS = 5000;
// The Ladder object's name and the origin its internal requests use. The
// origin is never dialed: a Durable Object stub's fetch goes to the object.
export const LADDER_NAME = 'ladder';
export const LADDER_ORIGIN = 'https://ladder.internal';

const MAX_MESSAGE = 65000;
// Longer than any real name or recovery code, so an oversized one is simply
// wrong credentials and never reaches the Ladder.
const MAX_NAME = 64;
const MAX_CODE = 128;
const BUILD_RE = new RegExp('^[0-9a-f]{1,' + MAX_BUILD_HEX + '}$');

// ----------------------------------------------------------------- helpers --
const ADJ = ['spicy', 'sneaky', 'mighty', 'rapid', 'golden', 'silver', 'crimson', 'cosmic',
  'frosty', 'blazing', 'shadow', 'lucky', 'rowdy', 'brave', 'wild', 'iron',
  'neon', 'turbo', 'mega', 'hyper', 'sonic', 'plasma', 'thunder', 'stellar',
  'savage', 'noble', 'mystic', 'raging', 'silent', 'fierce', 'jade', 'royal'];
const NOUN = ['tiger', 'dragon', 'falcon', 'wolf', 'panda', 'cobra', 'raptor', 'shark',
  'phoenix', 'mantis', 'jaguar', 'viper', 'eagle', 'lynx', 'kraken', 'golem',
  'ronin', 'ninja', 'samurai', 'wizard', 'knight', 'pirate', 'bandit', 'sensei',
  'fist', 'blade', 'storm', 'comet', 'ember', 'frost', 'spark', 'nova'];

export function newCode() {
  const r = new Uint32Array(3);
  crypto.getRandomValues(r);
  return ADJ[r[0] % ADJ.length] + '-' + NOUN[r[1] % NOUN.length] + '-' + (10 + (r[2] % 90));
}

// A wait cap from the test options, then the Worker's vars, then the default.
// Only a positive finite number counts; anything else keeps the fallback.
function pickMs(fromOpts, fromEnv, fallback) {
  for (const v of [fromOpts, fromEnv]) {
    if (v === undefined || v === null || v === '') continue;
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return fallback;
}

function capOn(ms) { return Number.isFinite(ms) && ms > 0; }

function withTimeout(promise, ms, what) {
  let t = null;
  const limit = new Promise((_, reject) => {
    t = setTimeout(() => reject(new Error(what + ' took longer than ' + ms + ' ms')), ms);
  });
  return Promise.race([promise, limit]).finally(() => clearTimeout(t));
}

// The Worker's Ladder caller. Throws for every kind of "down" so the Queue
// has a single place that tells a wrong name from a broken server.
export function ladderViaStub(env, timeoutMs) {
  const ms = timeoutMs || LADDER_TIMEOUT_MS;
  return async function ladder(op, body) {
    const ns = env && env.LADDER;
    if (!ns) throw new Error('no LADDER binding');
    const stub = ns.get(ns.idFromName(LADDER_NAME));
    const res = await withTimeout(stub.fetch(LADDER_ORIGIN + '/internal/' + op, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }), ms, 'ladder ' + op);
    if (!res || res.status !== 200) throw new Error('ladder ' + op + ' answered ' + (res && res.status));
    return withTimeout(res.json(), ms, 'ladder ' + op);
  };
}

function timersFrom(o) {
  return {
    now: o.now || (() => Date.now()),
    setTimer: o.setTimer || ((fn, ms) => setTimeout(fn, ms)),
    clearTimer: o.clearTimer || ((t) => clearTimeout(t)),
  };
}

const nameKey = (n) => String(n || '').toLowerCase();

// --------------------------------------------------------------- THE LIST --
// THE LIST OF OPEN LOBBIES. Every lobby without a password is listed. The
// list lives in ONE Room object in directory mode, named DIR_NAME: a name no
// client can reach, because every code a client sends is lower-cased before
// it picks a Room, and this name is not. Nothing a client sends is written
// into it: only a lobby's own Room object puts its entry (lobbyEntry in the
// LOBBY CORE: code, host's name, members n/8, the two playing, the streak, a
// free seat, the Build ID; never an address, never chat), as a Durable
// Object to Durable Object request that only this file makes
// (https://do/dir/put, a path the router never forwards a client to). A lobby puts its entry when it changes
// and refreshes it every DIR_REFRESH_MS (its alarm); the directory drops an
// entry DIR_TTL_MS after its last put, so a lobby that died without saying so
// (a failed request, a lost object) leaves the list within minutes. A lobby
// that ends, or has a password, puts null (or never puts at all). Entries: at
// most DIR_MAX kept, the list shows LOBBY_LIST_SHOW (lobbies with people in
// them first).
//
// READING IT: GET /lobbies (router.js). COST, with many viewers polling: each
// read is one Worker request; the body is cached in the isolate's memory for
// LIST_CACHE_MS, so the directory object is asked at most once per
// LIST_CACHE_MS per isolate however many viewers poll (no storage read: the
// directory keeps the list in memory and rebuilds the body at most every 2 s).
// A page asks with its Build ID (?build=, lobbyListBuild in the LOBBY CORE)
// and gets only its own build's lobbies: each build's body is cached on its
// own, the same way, so a read costs the same; at most LOBBY_LIST_BUILDS of
// them are kept at once.
// The page polls every 10 s, only while its list is on screen and the tab is
// visible, and stops after 10 minutes (a button resumes). The page also asks
// once when it loads, to know whether its server has lobbies at all (the
// online menu shows LOBBY and WATCH A MATCH only then). The directory's
// writes are one small key per lobby change, plus one refresh per listed
// lobby every DIR_REFRESH_MS (its alarm). (The Cache API is not used: it does
// nothing on a Worker's own default address, which is where the kit lives.)
//
// LIMITS, per connecting address: the address (CF-Connecting-IP; an IPv4
// address whole, an IPv6 address by its /64, lobbyAddrPrefix in the LOBBY
// CORE) is hashed with a random salt held in memory, kept only in memory for
// the window and never stored, logged or sent. 30 list reads a minute (then
// 429) and 30 joins by code a minute across all codes (code guessing; then
// 'slowdown'), both counted per isolate by router.js (RATE_LIMITS lobbies and
// seek: approximate at the edge); a new lobby CREATE_PER_10MIN times per 10
// minutes, counted by the directory object (one place for every isolate), and
// at most DIR_PER_CREATOR of one address's lobbies listed at once (the
// directory notes which address hash opened which code, in memory only; the
// notes go if the directory object is evicted, which happens only when the
// list is quiet), so one address cannot fill the list. Every lobby also needs
// its creator's socket held open.
export const DIR_NAME = 'Lobby Directory';
const DIR_TTL_MS = 12 * 60 * 1000, DIR_REFRESH_MS = 5 * 60 * 1000, DIR_MAX = 500;
const CREATE_PER_10MIN = 5, DIR_PER_CREATOR = 3;

function randomHex() {
  const r = new Uint8Array(16);
  crypto.getRandomValues(r);
  return Array.from(r, (b) => b.toString(16).padStart(2, '0')).join('');
}
export { randomHex };
// The list by build (LOBBY CORE, lobbyListBuild): router.js reads ?build= the
// same way and keeps its cache per build the same way.
export { lobbyListBuild, LOBBY_LIST_BUILDS };
// The salted hash of the connecting address, by its prefix (memory only, see
// LIMITS).
export async function addrHash(request, salt) {
  const ip = lobbyAddrPrefix(request.headers.get('CF-Connecting-IP') || '');
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + '|' + ip));
  return Array.from(new Uint8Array(d).slice(0, 8), (b) => b.toString(16).padStart(2, '0')).join('');
}
// A refusal the page can show, without waking any Room.
export function refuseSocket(reason) {
  const pair = new WebSocketPair();
  pair[1].accept();
  pair[1].send(JSON.stringify({ t: 'deny', reason }));
  pair[1].close(1000, '');
  return new Response(null, { status: 101, webSocket: pair[0] });
}

// ------------------------------------------------------------------ router --
// Everything the Worker does for /ws. Bad input is refused here, before any
// Durable Object is addressed. (The per-address limit on joins by code is
// router.js's, before this runs.)
export async function handleRelay(request, env) {
  const url = new URL(request.url);
  if ((request.headers.get('Upgrade') || '').toLowerCase() !== 'websocket') {
    return new Response('expected websocket', { status: 426 });
  }

  const pass = url.searchParams.get('pass') || '';

  // A winner-stays lobby (see the LOBBY CORE). It lives in a Room object, in
  // the rooms' code space: a code is a room or a lobby, never both.
  const lobby = url.searchParams.get('lobby');
  if (lobby) {
    const fwd = new URL('https://do/ws');
    fwd.searchParams.set('role', 'lobby');
    for (const k of ['build', 'nc', 'name', 'pass', 'streak', 'bid', 'title']) fwd.searchParams.set(k, (url.searchParams.get(k) || '').slice(0, 256));
    if (lobby === 'new') {
      for (let i = 0; i < 8; i++) {
        const code = newCode();
        const stub = env.ROOM.get(env.ROOM.idFromName(code));
        const st = await stub.fetch('https://do/status');
        if ((await st.json()).active) continue;
        // One address may open CREATE_PER_10MIN lobbies per 10 minutes,
        // counted by the directory, which also notes the code's creator for
        // DIR_PER_CREATOR (see LIMITS). If it cannot be asked, the lobby is made.
        try {
          const g = await env.ROOM.get(env.ROOM.idFromName(DIR_NAME)).fetch(new Request('https://do/dir/gate',
            { method: 'POST', headers: { 'CF-Connecting-IP': request.headers.get('CF-Connecting-IP') || '' },
              body: JSON.stringify({ code }) }));
          if (g.ok && (await g.json()).ok === false) return refuseSocket('slowdown');
        } catch { /* the gate is an abuse limit, not a lock */ }
        fwd.searchParams.set('code', code);
        fwd.searchParams.set('new', '1');
        return stub.fetch(new Request(fwd, request));
      }
      return new Response('no free room codes', { status: 503 });
    }
    const code = lobby.trim().toLowerCase();
    if (code.length > 64) return new Response('bad code', { status: 400 });
    fwd.searchParams.set('code', code);
    return env.ROOM.get(env.ROOM.idFromName(code)).fetch(new Request(fwd, request));
  }

  if (url.searchParams.has('create')) {
    // Pick an unoccupied code. The room object is the source of truth on
    // whether it is live; collisions are near impossible among short-lived
    // rooms, but check anyway.
    for (let i = 0; i < 8; i++) {
      const code = newCode();
      const stub = env.ROOM.get(env.ROOM.idFromName(code));
      const st = await stub.fetch('https://do/status');
      if ((await st.json()).active) continue;
      const fwd = new URL('https://do/ws');
      fwd.searchParams.set('role', 'host');
      fwd.searchParams.set('code', code);
      fwd.searchParams.set('pass', pass);
      fwd.searchParams.set('watchers', url.searchParams.get('watchers') === '1' ? '1' : '0');
      return stub.fetch(new Request(fwd, request));
    }
    return new Response('no free room codes', { status: 503 });
  }

  const join = url.searchParams.get('join');
  if (join) {
    const code = join.trim().toLowerCase();
    const stub = env.ROOM.get(env.ROOM.idFromName(code));
    const fwd = new URL('https://do/ws');
    fwd.searchParams.set('role', 'guest');
    fwd.searchParams.set('code', code);
    fwd.searchParams.set('pass', pass);
    return stub.fetch(new Request(fwd, request));
  }

  // A watcher of a room's matches (spectating). Same code space and the
  // same password as a join; the Room decides the rest.
  const watch = url.searchParams.get('watch');
  if (watch) {
    const code = watch.trim().toLowerCase();
    if (code.length > 64) return new Response('bad code', { status: 400 });
    const stub = env.ROOM.get(env.ROOM.idFromName(code));
    const fwd = new URL('https://do/ws');
    fwd.searchParams.set('role', 'watcher');
    fwd.searchParams.set('code', code);
    fwd.searchParams.set('pass', pass);
    return stub.fetch(new Request(fwd, request));
  }

  // Matchmaking. One Queue object per mode+build+netcode bucket, so only
  // byte-identical clients ever pair (lockstep desyncs across a mismatch),
  // and ranked and casual are separate pools.
  //
  // WHITELISTED, never passed through: an arbitrary client string here would
  // let anyone mint unlimited queue objects, and would silently split the
  // pool for anyone who sent a typo. The client refuses to queue without a
  // Build ID, so a refusal here only ever meets something that is not the
  // game.
  if (url.searchParams.has('queue')) {
    const build = (url.searchParams.get('build') || '').toLowerCase();
    if (!BUILD_RE.test(build)) return new Response('bad build', { status: 400 });
    const nc = url.searchParams.get('nc') === '1' ? '1' : '0';
    const mode = url.searchParams.get('mode') === 'casual' ? 'casual' : 'ranked';
    const bucket = 'q:' + mode + ':' + build + ':' + nc;
    const stub = env.QUEUE.get(env.QUEUE.idFromName(bucket));
    const fwd = new URL('https://do/queue');
    fwd.searchParams.set('name', url.searchParams.get('name') || '');
    fwd.searchParams.set('code', url.searchParams.get('code') || '');
    // The object is addressed BY the bucket but never learns it; the mode
    // goes along explicitly so it can tell ranked from casual.
    fwd.searchParams.set('mode', mode);
    return stub.fetch(new Request(fwd, request));
  }

  return new Response('missing create/join/watch/queue/lobby', { status: 400 });
}

// ------------------------------------------------------------------- Queue --
// Holds the waiting sockets, pairs the two longest-waiting players whose
// names differ, and then relays SDP between that pair itself: the same
// protocol as a room, with no Room object needed.
export class Queue {
  // ctx and env come from the runtime; opts is for the test suite:
  // {ladder, now, setTimer, clearTimer, queueWaitMs}.
  constructor(ctx, env, opts) {
    const o = opts || {};
    this.env = env || {};
    this.ladder = o.ladder || ladderViaStub(this.env);
    Object.assign(this, timersFrom(o));
    this.waitMs = pickMs(o.queueWaitMs, this.env.QUEUE_WAIT_MS, QUEUE_WAIT_MS);
    this.waiting = [];        // WebSocket[], insertion order = wait order
    this.mate = new Map();    // ws -> paired ws, once matched
    this.names = new Map();   // ws -> verified name
    this.since = new Map();   // ws -> admission time, for the wait cap
    this.pending = new Set(); // sockets taken out of the queue while their
                              // ranked pairing is being recorded
    // Sockets whose peer connection came up, so their close is a HANDOFF to
    // the game rather than a drop. Nothing reads it today but the marker must
    // still be consumed, never relayed; it is kept so a later version can
    // tell a healthy set from one that died during setup.
    this.playing = new Set();
    this.inflight = new Set(); // running startMatch promises, see idle()
    this.sweepTimer = null;
    // 'ranked' or 'casual', from each admission. One object only ever serves
    // one bucket, and the mode is part of the bucket name. Casual is a pairing
    // service and nothing else: the Ladder never hears about it.
    this.mode = 'ranked';
  }

  alive(ws) { return !!ws && ws.readyState === 1; }
  send(ws, obj) { try { if (this.alive(ws)) ws.send(JSON.stringify(obj)); } catch { /* dying */ } }

  // Resolves once every pairing in progress has finished. Tests await it; the
  // runtime never needs to.
  async idle() {
    while (this.inflight.size) await Promise.all([...this.inflight]);
  }

  broadcastCount() {
    this.waiting = this.waiting.filter((w) => this.alive(w));
    for (const w of this.waiting) this.send(w, { t: 'qcount', n: this.waiting.length });
  }

  // Two sockets may be paired only when they carry different names: one name
  // in two tabs must never meet itself.
  canPair(a, b) {
    return nameKey(this.names.get(a)) !== nameKey(this.names.get(b));
  }

  pair() {
    for (;;) {
      this.waiting = this.waiting.filter((w) => this.alive(w));
      if (this.waiting.length < 2) break;
      const a = this.waiting[0];
      // The longest-waiting partner a can take. When there is none, everyone
      // still waiting shares a's name, so nobody can be paired at all.
      const j = this.waiting.findIndex((w, i) => i > 0 && this.canPair(a, w));
      if (j < 0) break;
      const b = this.waiting[j];
      this.waiting.splice(j, 1);
      this.waiting.shift();
      const run = this.startMatch(a, b);
      this.inflight.add(run);
      run.finally(() => this.inflight.delete(run));
    }
    this.broadcastCount();
    this.armSweep();
  }

  // Never rejects. a is the longer-waiting player and becomes the host.
  async startMatch(a, b) {
    const nameA = this.names.get(a) || '', nameB = this.names.get(b) || '';
    const sinceA = this.since.get(a), sinceB = this.since.get(b);
    this.since.delete(a); this.since.delete(b);
    // The SERVER's pairing time: both peers key their result reports on it,
    // and their own clocks cannot be trusted to agree. For ranked it is also
    // the time the Ladder records, so the two must be the same number.
    const at = this.now();
    if (this.mode === 'ranked') {
      this.pending.add(a); this.pending.add(b);
      let recorded = false;
      try {
        const r = await this.ladder('pairing', { a: nameA, b: nameB, at });
        recorded = !!r && r.ok === true;
      } catch { recorded = false; }
      this.pending.delete(a); this.pending.delete(b);
      const hereA = this.alive(a) && this.names.has(a);
      const hereB = this.alive(b) && this.names.has(b);
      if (!hereA || !hereB) {
        // One of them left while the pairing was being written. The one still
        // here goes back to the head of the queue with its original wait.
        const back = hereA ? a : hereB ? b : null;
        if (back) {
          this.since.set(back, back === a ? sinceA : sinceB);
          this.waiting.unshift(back);
        }
        this.pair();
        return;
      }
      if (!recorded && PAIRING_MUST_RECORD) {
        this.refuse(a, 'identdown');
        this.refuse(b, 'identdown');
        this.broadcastCount();
        this.armSweep();
        return;
      }
    }
    this.mate.set(a, b); this.mate.set(b, a);
    // Each side learns the OPPONENT's verified name; the host is always
    // engine side 1, so both clients label the plates the same way. `mode`
    // is what makes a result rated: the client reports only when the server
    // says 'ranked' here.
    this.send(a, { t: 'match', role: 'host', opponent: nameB, at: at, mode: this.mode });
    this.send(b, { t: 'match', role: 'guest', opponent: nameA, at: at, mode: this.mode });
  }

  // Takes a socket out of every list, tells it why, and closes it. The lists
  // are cleared first: a runtime may or may not fire the close event
  // synchronously, and nothing here should depend on which.
  refuse(ws, reason) {
    this.waiting = this.waiting.filter((w) => w !== ws);
    this.names.delete(ws);
    this.since.delete(ws);
    this.pending.delete(ws);
    this.send(ws, { t: 'deny', reason });
    try { ws.close(1000); } catch { /* already gone */ }
  }

  // One timer for the whole queue, due when the longest wait runs out. Only
  // sockets still in `waiting` are ever timed out: a matched or pending pair
  // is mid-setup and is left alone.
  armSweep() {
    if (this.sweepTimer !== null) { this.clearTimer(this.sweepTimer); this.sweepTimer = null; }
    if (!capOn(this.waitMs)) return;
    let first = Infinity;
    for (const w of this.waiting) {
      const s = this.since.get(w);
      if (s !== undefined && s < first) first = s;
    }
    if (first === Infinity) return;
    const due = Math.max(0, first + this.waitMs - this.now());
    this.sweepTimer = this.setTimer(() => { this.sweepTimer = null; this.sweep(); }, due);
  }

  sweep() {
    const now = this.now();
    const late = this.waiting.filter((w) => {
      const s = this.since.get(w);
      return s !== undefined && now - s >= this.waitMs;
    });
    for (const w of late) this.refuse(w, 'timeout');
    this.broadcastCount();
    this.armSweep();
  }

  wire(ws) {
    ws.addEventListener('message', (e) => {
      const other = this.mate.get(ws);
      if (!other) return; // still waiting: nothing to relay
      if (typeof e.data !== 'string' || e.data.length > MAX_MESSAGE) return;
      let msg; try { msg = JSON.parse(e.data); } catch { return; }
      if (!msg || typeof msg.t !== 'string') return;
      // HANDOFF, not relay. Both peers close this socket about a second after
      // the data channel opens. Marks BOTH sockets: one side reporting the
      // peer connection live settles it for the pair.
      if (msg.t === 'playing') { this.playing.add(ws); this.playing.add(other); return; }
      this.send(other, msg);
    });
    const gone = () => {
      const other = this.mate.get(ws);
      if (other) {
        // Tear the maps down BEFORE closing the partner: closing it re-enters
        // this handler for that socket, and it must find itself unmated.
        this.mate.delete(other); this.mate.delete(ws);
        this.playing.delete(other);
        this.send(other, { t: 'bye' });
        try { other.close(1000); } catch { /* already gone */ }
      }
      this.waiting = this.waiting.filter((w) => w !== ws && this.alive(w));
      this.names.delete(ws);
      this.since.delete(ws);
      this.playing.delete(ws);
      this.broadcastCount();
      this.armSweep();
    };
    ws.addEventListener('close', gone);
    ws.addEventListener('error', gone);
  }

  // {verdict, name}: verdict is 'ok', 'badident' (wrong or missing
  // credentials) or 'identdown' (the Ladder failed, so nobody can tell). name
  // is what the opponent's plate shows: the claimed casing when the Ladder
  // sends it back for the same name, otherwise the name as typed.
  async check(name, code) {
    if (!name || !code || name.length > MAX_NAME || code.length > MAX_CODE) return { verdict: 'badident' };
    try {
      const r = await this.ladder('verify', { name, code });
      if (r && r.ok === true) {
        const shown = typeof r.name === 'string' && nameKey(r.name) === nameKey(name) ? r.name : name;
        return { verdict: 'ok', name: shown };
      }
      if (r && r.ok === false) return { verdict: 'badident' };
      return { verdict: 'identdown' };
    } catch {
      return { verdict: 'identdown' };
    }
  }

  async fetch(request) {
    const url = new URL(request.url);
    const name = url.searchParams.get('name') || '';
    const code = url.searchParams.get('code') || '';
    // Whitelisted again rather than trusted: a bad value must never be able to
    // turn a casual queue into a rated one.
    this.mode = url.searchParams.get('mode') === 'casual' ? 'casual' : 'ranked';

    const pair = new WebSocketPair();
    const client = pair[0], server = pair[1];
    server.accept();

    // Verify the name BEFORE the socket joins the queue. The socket is
    // accepted first so a refusal arrives as a protocol message the client
    // can show, not as an opaque connection error.
    const id = await this.check(name, code);
    if (id.verdict !== 'ok') {
      this.send(server, { t: 'deny', reason: id.verdict });
      try { server.close(1000); } catch { /* already gone */ }
      return new Response(null, { status: 101, webSocket: client });
    }
    // Left while being checked: its close event fired before anything was
    // listening, so never let it into the queue.
    if (!this.alive(server)) return new Response(null, { status: 101, webSocket: client });

    this.names.set(server, id.name);
    this.since.set(server, this.now());
    this.wire(server);
    this.waiting.push(server);
    this.pair();
    return new Response(null, { status: 101, webSocket: client });
  }
}

// -------------------------------------------------------------------- Room --
// ROOMS. One Durable Object per room code (idFromName(code)).
//
// Players: a host and ONE guest. The guest slot latches ("started") the
// moment a guest is let in, so a second guest is refused with 'full' even
// after the first guest's socket closes (players close theirs once their own
// connection is up). A watcher can never become a player, nor a player a
// watcher: the role is fixed by the URL the socket came in on.
//
// WATCHERS (spectating). A host that sends ?watchers=1 when it creates the room
// runs a page that can serve watchers; a room created without it never admits
// one ('nowatch'), and everything about it is a plain room. In a watch room:
//   ?watch=CODE[&pass=]        -> watcher {t:'watching'}, host {t:'watcher', id}
//                                 (denied: badcode, badpass, nowatch, watchfull,
//                                 slowdown)
//   host {t:'sdp', to:id, sdp} -> that watcher {t:'sdp', sdp}
//   watcher {t:'sdp', sdp}     -> host {t:'sdp', from:id, sdp} (the id is the
//                                 lobby's, whatever the watcher wrote)
//   host {t:'wdeny', to:id, reason} -> that watcher {t:'deny', reason}, closed
//   host {t:'allow', on:bool}  -> watchers allowed or not from now on (the
//                                 host's switch); refused ones get 'nowatch'
//   a watcher's socket closing -> host {t:'wbye', id}
//   any change in the number of watchers -> host and guest {t:'wcount', n}
// A watcher may send ONLY 'sdp' (WATCH_SDP_MAX of them, WATCH_MSG_MAX
// characters each); anything else is dropped, and a watcher that keeps sending
// junk (more than WATCH_JUNK_MAX) is closed. A guest can never send the
// lobby's own message types on to the host, nor anything addressed to or from
// a watcher. The lobby never carries match data: a watcher's match setup goes
// over its own WebRTC connection to the host.
//
// LIFETIME. A room lives while its host's socket is open; the host's socket
// closing ends it (the guest and every watcher get {t:'bye'} and the code is
// free). A room nobody joined is closed when its wait (this.waitMs,
// ROOM_WAIT_MS by default) is over, with {t:'deny', reason:'timeout'}. A plain
// room ends with its guest; a watch room whose guest joined lives for the
// session: until the host's socket closes (the page closes it when its netplay
// session ends, or the tab closes), at most ROOM_SESSION_MS. Closing it never
// touches a match: players and watchers already connected talk peer to peer.
//
// HIBERNATION. Every socket is accepted with state.acceptWebSocket, so the
// runtime can evict this object between messages while the sockets stay open
// (a host holding its socket for watchers costs nothing while idle). Nothing
// lives in instance fields but the watch-attempt window: the room's settings
// ride on the host socket's attachment (serializeAttachment, held with the
// socket, never written to storage), a watcher's id and counters on its own,
// and the only stored value is the alarm time for the caps. No IP address is
// read, kept or sent anywhere.
const ROOM_SESSION_MS = 12 * 60 * 60 * 1000;
const WATCH_MAX = 8;          // watchers per room (the host page's cap)
const WATCH_PER_MIN = 30;     // watch attempts per room per minute
const WATCH_MSG_MAX = 16384;  // one message from a watcher (an SDP answer is 1-4 KB)
const WATCH_SDP_MAX = 4;      // SDP messages per watcher connection
const WATCH_JUNK_MAX = 8;     // dropped messages before a watcher is closed
const PLAYER_MSG_MAX = MAX_MESSAGE;
// What a host may tell the lobby to refuse a watcher with; anything else is
// sent as 'denied'.
const WDENY_REASONS = ['watchfull', 'nowatch', 'build', 'netcode', 'mode', 'denied'];
// Only the lobby sends these to a player; a guest can never send one on.
const LOBBY_ONLY = ['room', 'joined', 'peer', 'deny', 'watching', 'watcher', 'wbye', 'wcount', 'allow', 'wdeny'];

// ---- LOBBY CORE begin ----
// WINNER-STAYS LOBBIES. This block is the same, byte for byte, in worker.js
// and server.js (test/lobby.test.mjs compares the two copies): the rules and
// the message checks live here, and each server only carries sockets, the
// clock and its own way of keeping the record (worker.js: Durable Object
// storage, so a hibernated lobby wakes up as it was; server.js: memory).
//
// A lobby holds up to LOBBY_MAX members. Two play; everyone else watches the
// match live. The SERVER alone decides who plays:
//   - the line: members who are not "spectate only", in order;
//   - a match takes the winner who stayed (if any) and the next in line, or
//     the first two in line; the loser goes to the back of the line;
//   - the winner stays, unless the lobby's streak limit ("winner leaves after
//     N wins", 0 = off) is reached: then the winner goes to the back too (after
//     the loser) and the next two in line play;
//   - spectate only: never in line; turned off, back of the line;
//   - a member leaving leaves the line; a player leaving a match that has no
//     result yet loses it (the one still there wins);
//   - a player who does not take its match (its page never says {t:'ready'}
//     and never reports) within LOBBY_READY_MS is "absent": it goes to
//     spectate only (out of the line until it turns that off), the match ends
//     with no result, and the player who did take it keeps its place: the
//     winner who stayed stays, streak and all; one from the line goes back to
//     the front of it. Two absent players both go to spectate only;
//   - a BACKGROUND TAB: a player whose page is hidden when it is paired (its
//     engine is paused by the browser, so it cannot take the match) says
//     {t:'away', match} and alerts its person (tab title, a beep); it is then
//     absent only after LOBBY_AWAY_MS, and everyone sees a line saying so. The
//     other player's page waits for both to be ready before it starts its own
//     connection clock;
//   - a FAILED CONNECTION: both players took the match but their pages could
//     not connect (a page that gives up reports {t:'result', winner:-1,
//     why:'noconn'}). BOTH players saying so is no contest: the streak and
//     the stayer's place are kept, the challenger goes to the back of the
//     line, and each player's count of failed connections in a row goes up
//     (a played match puts it back to 0). A player who reaches
//     LOBBY_FAIL_MAX failures in a row is benched (spectate only, turned off
//     by the member when its network is fixed). A champion who cannot reach
//     two challengers in a row is the one benched; a challenger who cannot
//     connect only loses its turn, twice in a row its place in the line.
//     ONE player saying so while the other claims a result (or reports none)
//     is a dispute, settled as in RESULTS except that the claim needs a
//     second vote for it (a registered watcher's): without one the match is
//     void (both to the back, the streak ends). So a losing champion keeps
//     nothing by saying "no connection", and a losing challenger gets nothing
//     a false win claim would not already get it.
// The match host (engine side 1, the page that carries the watchers) is the
// player who stayed, or the first in line for a fresh match: the champion keeps
// side 1 and the challenger comes in on side 2, as on an arcade cabinet, and a
// streak keeps the same page hosting its watchers match after match.
//
// RESULTS. Both players report {t:'result', match, winner} (winner: a member
// id, 0 = draw, -1 = "I have no result": left the match, lost the connection).
// The two agreeing settle it at once. Otherwise (they disagree, or one is
// missing) it is settled when every expected reporter has reported (the two
// players and the members who were told to watch it WHEN IT WAS ASSIGNED: their
// engines play the same match from the host's confirmed inputs and report the
// same way; a member who arrives mid-match has no vote, nor one the match
// host refused before sending it its SDP; once the host's SDP went to a
// watcher, a refusal no longer takes its vote away), or
// LOBBY_REPORT_MS after the first report, or LOBBY_MATCH_MS after the match
// was assigned (while a player has not taken the match, only LOBBY_READY_MS
// counts, see above): then the real votes (a winner or 0) are counted and a strict
// majority wins; no majority voids the match (both players to the back of the
// line, the challenger first; the streak ends). A draw both agree on: the side 1
// player stays, the challenger goes to the back, the streak is unchanged.
//
// KICKS. The host's kick bars the member's NAME KEY (lobbyKey: case, spaces,
// punctuation, accents, full-width forms and look-alike letters and digits
// folded, so "B0b", "b o b" and a Cyrillic "Воb" are all "bob") and its
// BROWSER ID (&bid=, a random id the page keeps in its own storage) while the
// lobby lives. It stops a kicked person coming straight back under a variant
// name or the same browser. It cannot stop someone who clears the page's
// storage (or opens a private window, or another browser) AND picks a
// genuinely different name: names are not verified accounts, and the lobby
// never uses addresses to ban. Two members whose names share a key cannot both
// be in (the second gets a number), so nobody can pass for another member.
//
// JOIN BUDGETS (the servers keep a `book` per lobby, in memory only, keyed by a
// salted hash of the connecting address that is never stored, logged or sent).
// An ADDRESS, here and in every per-address limit, is lobbyAddrPrefix's: an
// IPv4 address whole, an IPv6 address by its /64 prefix (one home or phone
// connection is given a whole /64 and may use any address in it).
// One address may try a lobby LOBBY_TRY_PER_MIN times a minute and give a
// wrong password LOBBY_BADPASS_PER_MIN times a minute; past either it gets
// 'slowdown' on that lobby, without its password even being checked, until
// its minute clears. Other addresses are not affected, so one connection's
// wrong-password storm slows the guesser, not the lobby. BACKSTOP: a lobby
// takes at most LOBBY_BADPASS_ALL_PER_MIN wrong passwords a minute from all
// addresses together (a guesser with many prefixes). Past it, joins get
// 'slowdown' without a password check until its minute clears, except from
// a browser id this lobby admitted before (a member coming back). It takes
// LOBBY_BADPASS_ALL_PER_MIN / LOBBY_BADPASS_PER_MIN prefixes guessing at
// once to reach it, so one connection never can; while many do, a person
// new to the lobby waits (at most a minute after they stop). So a lobby's
// password can be guessed at most LOBBY_BADPASS_ALL_PER_MIN times a minute
// however many addresses try. LOBBY_JOIN_PER_MIN caps the members a lobby
// ADMITS a minute (join/leave churn), whoever they are.
//
// THE LIST OF OPEN LOBBIES. lobbyEntry(L) is what the servers' directory shows
// of a lobby, and all it shows: the code, its title (empty if the creator gave
// none), the lobby host's name, members n/8,
// the two playing now and the streak, whether a seat is free, and its Build ID
// (the one every join is checked against). A lobby with a password has no
// entry (never listed), nor does an empty one. GET /lobbies?build=HEX16 lists
// only the lobbies on that build, plus how many are on other builds
// (lobbyListBody); without it the list is everyone's, as before.
//
// PROTOCOL (JSON text frames on the lobby socket).
//   open  ?lobby=new&build=HEX16&nc=1&name=NAME[&pass=P][&streak=N][&bid=HEX][&title=T]
//         ?lobby=CODE&build=HEX16&nc=1&name=NAME[&pass=P][&bid=HEX]   joins
//         title: the lobby's title, set once by its creator (plain text, up to
//         LOBBY_TITLE_MAX; a join's is ignored); the list and the panel show it
//         refused with {t:'deny', reason} then closed: badcode, badpass, build,
//         netcode, full, name, kicked, slowdown, busy
//   server -> member
//     {t:'lobby', code, you}                 once, on entry
//     {t:'state', ...lobbyView}              after every change, to everyone
//     {t:'sys', k, ...}                      a line for the chat: join, leave,
//                                            kick, host, spec, limit, match,
//                                            result, draw, void, rotate, drop,
//                                            absent, away, noconn, bench
//     {t:'match', match, role, opp:{id,name}} to the two players (role: host |
//                                            guest of the match)
//     {t:'watch', match, host}               to every other member
//     {t:'watcher', match, id}               to the match host, per watcher
//     {t:'wbye', id}                         to the match host: a watcher left
//     {t:'sdp', from, match, sdp}            relayed handshake
//     {t:'wdeny', match, reason}             the match host refused this watcher
//     {t:'chat', from, name, text}           relayed live, never kept
//     {t:'slow'}                             a chat line dropped by the rate limit
//   member -> server (anything else, or not allowed for its role now, is junk;
//   more than LOBBY_JUNK_MAX junk messages in a minute closes the member)
//     {t:'sdp', sdp}            a player to the other player; a watcher of the
//                               match to its host
//     {t:'sdp', to, sdp}        the match host to one of its watchers
//     {t:'wdeny', to, reason}   the match host refusing a watcher
//     {t:'ready', match}        a player: its engine took the match (once)
//     {t:'away', match}         a player whose tab is hidden: wait LOBBY_AWAY_MS
//     {t:'result', match, winner[, why:'noconn']}  a player or a watcher of
//                               that match, once (noconn: a player's page that
//                               could not connect to the other)
//     {t:'spec', on}            spectate only on/off (anyone, for itself)
//     {t:'chat', text}          LOBBY_CHAT_MAX characters, LOBBY_CHAT_BURST then
//                               one per LOBBY_CHAT_EVERY_MS
//     {t:'limit', n}            the lobby host: the streak limit, 0..LOBBY_STREAK_MAX
//     {t:'kick', id}            the lobby host: removes a member (its name key
//                               and browser id may not come back while the
//                               lobby lives; see KICKS)
// The lobby host is the creator; when it leaves, the oldest remaining member.
// STORAGE: a server writes the record (and sets its alarm) only when the core
// marks it dirty: a member, the line, the match, a report, a 'ready', the
// limit or a spectate-only flag actually changed, the match host sent a
// watcher its first SDP of the match (its vote then stands) or refused one
// it had not (its vote goes). Other chat, SDP, 'wdeny', junk and messages
// that change nothing write nothing; chat counts as activity for the idle cap
// at most once per LOBBY_SEEN_STEP_MS (one write).
// No IP address is kept or sent: the join budgets hash it in memory (see JOIN
// BUDGETS). The record holds browser ids (kicked, and the last
// LOBBY_KNOWN_MEMORY admitted; never sent to anyone). Names are
// plain text (the page escapes them); passwords never leave the server.
const LOBBY_MAX = 8;
const LOBBY_NAME_MAX = 24;
const LOBBY_TITLE_MAX = 32;
const LOBBY_PASS_MAX = 64;
const LOBBY_STREAK_MAX = 9;
const LOBBY_CHAT_MAX = 200;
const LOBBY_CHAT_BURST = 5, LOBBY_CHAT_EVERY_MS = 2000;
const LOBBY_MSG_BURST = 40, LOBBY_MSG_PER_S = 8;
const LOBBY_MSG_MAX = 32768;
const LOBBY_JUNK_MAX = 16;
const LOBBY_SDP_HOST = 24, LOBBY_SDP_OTHER = 4;
const LOBBY_JOIN_PER_MIN = 30;
const LOBBY_TRY_PER_MIN = 20, LOBBY_BADPASS_PER_MIN = 5, LOBBY_BADPASS_ALL_PER_MIN = 30;
const LOBBY_KNOWN_MEMORY = 64;
const LOBBY_REPORT_MS = 20 * 1000;
const LOBBY_READY_MS = 60 * 1000;
const LOBBY_AWAY_MS = 120 * 1000;
const LOBBY_FAIL_MAX = 2;
const LOBBY_SEEN_STEP_MS = 5 * 60 * 1000;
const LOBBY_MATCH_MS = 15 * 60 * 1000;
const LOBBY_IDLE_MS = 60 * 60 * 1000;
const LOBBY_LIFE_MS = 12 * 60 * 60 * 1000;
const LOBBY_KICK_MEMORY = 32;
const LOBBY_WDENY = ['watchfull', 'nowatch', 'build', 'netcode', 'mode', 'denied'];

// Plain one-line text: control, bidi and zero-width characters become spaces.
function lobbyClean(s, max) {
  return String(s == null ? '' : s)
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/g, ' ')
    .replace(/\s+/g, ' ').trim().slice(0, max);
}

// A name's KEY (see KICKS): compatibility forms unfolded (full-width, ligatures),
// accents dropped, lower case, look-alike letters (Cyrillic, Greek) and digits
// or symbols that pass for letters mapped to one Latin letter, and everything
// but letters and digits removed. Letters of other scripts are kept as they are.
const LOBBY_LOOK_FROM = '\u0430\u0432\u0435\u043a\u043c\u043d\u043e\u0440\u0441\u0442\u0443\u0445\u0456\u0458\u0455\u0501\u04cf\u0451' +
  '\u03b1\u03b2\u03b5\u03b7\u03b9\u03ba\u03bc\u03bd\u03bf\u03c1\u03c4\u03c5\u03c7\u03c9' + '01345789@$|i';
const LOBBY_LOOK_TO = 'abekmhopctyxljsdle' + 'abenlkuvoptuxw' + 'oleastbgas' + 'll';
function lobbyKey(name) {
  let s = String(name == null ? '' : name).normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
  let k = '';
  for (const ch of s) { const i = LOBBY_LOOK_FROM.indexOf(ch); k += i >= 0 ? LOBBY_LOOK_TO[i] : ch; }
  return k.replace(/[^\p{L}\p{N}]/gu, '');
}

function lobbyParams(get) {
  const n = parseInt(get('streak') || '0', 10);
  const bid = String(get('bid') || '').toLowerCase();
  return {
    build: String(get('build') || '').toLowerCase(),
    nc: String(get('nc') || ''),
    name: lobbyClean(get('name'), LOBBY_NAME_MAX),
    title: lobbyClean(get('title'), LOBBY_TITLE_MAX),
    pass: String(get('pass') || ''),
    limit: Number.isInteger(n) ? Math.max(0, Math.min(LOBBY_STREAK_MAX, n)) : 0,
    bid: /^[0-9a-f]{16,32}$/.test(bid) ? bid : '',
  };
}

// What the per-address limits count as one address (see JOIN BUDGETS): an
// IPv4 address whole (also when written as ::ffff:a.b.c.d), an IPv6 address
// by its /64 prefix, anything else (no address) as it is.
function lobbyAddrPrefix(ip) {
  let s = String(ip == null ? '' : ip).trim().toLowerCase();
  if (s.startsWith('[') && s.endsWith(']')) s = s.slice(1, -1);
  const pct = s.indexOf('%');
  if (pct >= 0) s = s.slice(0, pct);
  if (s.indexOf(':') < 0) return s;
  const v4 = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (v4) {
    const n = v4.slice(1).map(Number);
    if (n.some((x) => x > 255)) return s;
    s = s.slice(0, v4.index) + ((n[0] << 8) | n[1]).toString(16) + ':' + ((n[2] << 8) | n[3]).toString(16);
  }
  const halves = s.split('::');
  if (halves.length > 2) return s;
  const a = halves[0] ? halves[0].split(':') : [];
  const b = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fill = halves.length === 2 ? 8 - a.length - b.length : 0;
  const g = a.concat(new Array(Math.max(0, fill)).fill('0'), b);
  if (fill < 0 || (halves.length === 2 && fill < 1) || g.length !== 8 || !g.every((x) => /^[0-9a-f]{1,4}$/.test(x))) return s;
  const h = g.map((x) => parseInt(x, 16));
  if (h.slice(0, 5).every((x) => x === 0) && h[5] === 0xffff) return [h[6] >> 8, h[6] & 255, h[7] >> 8, h[7] & 255].join('.');
  return h.slice(0, 4).map((x) => x.toString(16)).join(':') + '::/64';
}

// The join budgets (see JOIN BUDGETS). `book` maps an address hash to the
// times of its attempts and of its wrong passwords in the last minute, and
// '*' (never a hash) to the lobby's wrong passwords from everyone; it is the
// server's, in memory only. lobbyTry: 'slowdown' or '' (and counts the
// attempt); known: the joiner's browser id was admitted here before.
// lobbyMiss: a wrong password.
function lobbyTry(book, who, now, known) {
  for (const [k, v] of book) {
    v.t = v.t.filter((x) => now - x < 60000);
    v.bad = v.bad.filter((x) => now - x < 60000);
    if (!v.t.length && !v.bad.length) book.delete(k);
  }
  let v = book.get(who);
  if (!v) { v = { t: [], bad: [] }; book.set(who, v); }
  if (v.t.length >= LOBBY_TRY_PER_MIN || v.bad.length >= LOBBY_BADPASS_PER_MIN) return 'slowdown';
  const all = book.get('*');
  if (!known && all && all.bad.length >= LOBBY_BADPASS_ALL_PER_MIN) return 'slowdown';
  v.t.push(now);
  return '';
}
function lobbyMiss(book, who, now) {
  const v = book.get(who);
  if (v) v.bad.push(now);
  let all = book.get('*');
  if (!all) { all = { t: [], bad: [] }; book.set('*', all); }
  all.bad.push(now);
}
// Was this browser id admitted to the lobby before (lobbyTry's `known`)?
function lobbyKnown(L, bid) { return !!(L && bid && (L.okbid || []).includes(bid)); }

// Why this socket may not come in ('' = it may). L is null when creating.
function lobbyAdmit(L, p) {
  if (p.pass.length > LOBBY_PASS_MAX) return 'badpass';
  if (L && L.pass && L.pass !== p.pass) return 'badpass';
  if (!/^[0-9a-f]{16}$/.test(p.build) || (L && L.build !== p.build)) return 'build';
  if (p.nc !== '1') return 'netcode';
  if (!p.name) return 'name';
  if (L && L.members.length >= LOBBY_MAX) return 'full';
  if (L && (L.kicked.includes(lobbyKey(p.name)) || (p.bid && (L.kbid || []).includes(p.bid)))) return 'kicked';
  return '';
}

function lobbyCreate(code, p, now) {
  return { code, title: p.title || '', pass: p.pass, build: p.build, limit: p.limit, born: now, seen: now,
    seq: 0, mseq: 0, host: 0, members: [], line: [], stay: 0, streak: { id: 0, n: 0 },
    match: null, kicked: [], kbid: [], okbid: [] };
}

function lobbyMember(L, id) { return L.members.find((x) => x.id === id) || null; }
function lobbyPlaying(L, id) { return !!L.match && (L.match.a === id || L.match.b === id); }

function lobbyAdd(L, name, now, bid) {
  let nm = name, k = 2;
  const taken = (s) => L.members.some((x) => lobbyKey(x.name) === lobbyKey(s));
  while (taken(nm)) nm = name.slice(0, LOBBY_NAME_MAX - 3) + ' ' + (k++);
  const id = ++L.seq;
  // key: the name it asked for (a kick bars it); bid: its browser id. Neither
  // is ever sent to anyone (lobbyView leaves them out).
  L.members.push({ id, name: nm, spec: false, key: lobbyKey(name), bid: bid || '', fails: 0 });
  L.line.push(id);
  if (!L.host) L.host = id;
  L.seen = now;
  return id;
}

// To the back of the line: a member who is there, not spectate only, not
// already in line and not playing.
function lobbyBack(L, id) {
  const x = lobbyMember(L, id);
  if (x && !x.spec && !L.line.includes(id) && L.stay !== id && !lobbyPlaying(L, id)) L.line.push(id);
}

// The match is over: w = the winner's id, 0 = a draw, -1 = void.
function lobbyFinish(L, w, how) {
  const m = L.match;
  if (!m) return [];
  L.match = null;
  L.stay = 0;
  const ev = [];
  if (w === -1) {
    ev.push({ k: 'void', match: m.id, a: m.a, b: m.b });
    L.streak = { id: 0, n: 0 };
    lobbyBack(L, m.b); lobbyBack(L, m.a);
    return ev;
  }
  // a match was played: the players' failed connections in a row start over
  for (const id of [m.a, m.b]) { const x = lobbyMember(L, id); if (x) x.fails = 0; }
  let win = w, lose;
  if (w === 0) {
    win = m.a; lose = m.b;
    ev.push({ k: 'draw', match: m.id, a: m.a, b: m.b });
  } else {
    lose = w === m.a ? m.b : m.a;
    if (L.streak.id === w) L.streak.n++; else L.streak = { id: w, n: 1 };
    ev.push({ k: 'result', match: m.id, w, l: lose, n: L.streak.n, how: how || 'report' });
  }
  lobbyBack(L, lose);
  const x = lobbyMember(L, win);
  if (!x || x.spec) {
    L.streak = { id: 0, n: 0 };
    lobbyBack(L, win);
  } else if (w !== 0 && L.limit && L.streak.n >= L.limit) {
    ev.push({ k: 'rotate', id: win, n: L.streak.n });
    L.streak = { id: 0, n: 0 };
    lobbyBack(L, win);
  } else {
    L.stay = win;
  }
  return ev;
}

// The next match, if two can play now.
function lobbyNext(L, now) {
  if (L.match) return null;
  let a, b, champ = false;
  if (L.stay && lobbyMember(L, L.stay)) {
    if (!L.line.length) return null;
    a = L.stay; b = L.line.shift(); champ = true;
  } else {
    L.stay = 0;
    L.streak = { id: 0, n: 0 };
    if (L.line.length < 2) return null;
    a = L.line.shift(); b = L.line.shift();
  }
  L.stay = 0;
  const watch = L.members.filter((x) => x.id !== a && x.id !== b).map((x) => x.id);
  // watch: who is pointed at the match (a mid-match arrival is added);
  // vote: who may report on it, fixed now (the members told to watch it)
  const m = { id: ++L.mseq, a, b, at: now, first: 0, rep: {}, ready: [], away: [], nc: [], champ,
    watch, vote: watch.slice() };
  L.match = m;
  return m;
}

function lobbyRemove(L, id, why) {
  const x = lobbyMember(L, id);
  if (!x) return [];
  const ev = [{ k: why === 'kick' ? 'kick' : 'leave', id, name: x.name }];
  L.members = L.members.filter((y) => y.id !== id);
  L.line = L.line.filter((y) => y !== id);
  if (L.stay === id) { L.stay = 0; L.streak = { id: 0, n: 0 }; }
  if (L.streak.id === id) L.streak = { id: 0, n: 0 };
  if (L.match && (L.match.a === id || L.match.b === id)) {
    const other = L.match.a === id ? L.match.b : L.match.a;
    ev.push({ k: 'drop', id, name: x.name, match: L.match.id });
    // the result line names the leaver too (it is no longer a member)
    for (const e of lobbyFinish(L, other, 'drop')) { if (e.l === id) e.ln = x.name; ev.push(e); }
  }
  if (L.host === id) {
    L.host = L.members.length ? L.members[0].id : 0;
    if (L.host) ev.push({ k: 'host', id: L.host });
  }
  return ev;
}

function lobbySpec(L, id, on) {
  const x = lobbyMember(L, id);
  if (!x || x.spec === on) return [];
  x.spec = on;
  if (on) {
    L.line = L.line.filter((y) => y !== id);
    if (L.stay === id) { L.stay = 0; L.streak = { id: 0, n: 0 }; }
  } else {
    lobbyBack(L, id);
  }
  return [{ k: 'spec', id, on }];
}

// The players of match m who have not taken it ('ready' or a report).
function lobbyAbsentIds(m) {
  return [m.a, m.b].filter((id) => !Object.prototype.hasOwnProperty.call(m.rep, String(id)) &&
    !(m.ready || []).includes(id));
}
// When a player who has not taken match m counts as absent (a hidden tab that
// said 'away' gets LOBBY_AWAY_MS).
function lobbyReadyBy(m, id) { return m.at + ((m.away || []).includes(id) ? LOBBY_AWAY_MS : LOBBY_READY_MS); }

// Both players said they could not connect (see the header): no contest. Each one's
// failed connections in a row go up; at LOBBY_FAIL_MAX it is benched. The
// champion keeps its place and its streak, the challenger goes to the back.
function lobbyNoConn(L) {
  const m = L.match;
  if (!m) return [];
  L.match = null;
  L.stay = 0;
  const ev = [{ k: 'noconn', match: m.id, a: m.a, b: m.b }];
  const benched = (id) => {
    const x = lobbyMember(L, id);
    if (!x) return true;
    x.fails = (x.fails || 0) + 1;
    if (x.fails < LOBBY_FAIL_MAX) return false;
    x.spec = true;
    x.fails = 0;
    L.line = L.line.filter((y) => y !== id);
    if (L.streak.id === id) L.streak = { id: 0, n: 0 };
    ev.push({ k: 'bench', id, n: LOBBY_FAIL_MAX });
    return true;
  };
  const outA = benched(m.a), outB = benched(m.b);
  if (!outB) lobbyBack(L, m.b);
  if (!outA) { if (m.champ) L.stay = m.a; else lobbyBack(L, m.a); }
  if (outA && L.streak.id === m.a) L.streak = { id: 0, n: 0 };
  return ev;
}

// The match ends with no result because `absent` never took it: they go to
// spectate only; a player who took it keeps its place (see the header).
function lobbyAbsent(L, absent) {
  const m = L.match;
  if (!m) return [];
  L.match = null;
  L.stay = 0;
  const ev = [];
  for (const id of absent) {
    const x = lobbyMember(L, id);
    if (x) x.spec = true;
    L.line = L.line.filter((y) => y !== id);
    if (L.streak.id === id) L.streak = { id: 0, n: 0 };
    ev.push({ k: 'absent', id, match: m.id });
  }
  for (const id of [m.a, m.b]) {
    const x = lobbyMember(L, id);
    if (absent.includes(id) || !x || x.spec || L.line.includes(id)) continue;
    if (id === m.a && m.champ) L.stay = id;
    else L.line.unshift(id);
  }
  return ev;
}

// A result report: 'ok', 'dup' or 'junk'.
function lobbyReport(L, id, msg, now) {
  const m = L.match;
  if (!m || msg.match !== m.id) return 'junk';
  if (id !== m.a && id !== m.b && !(m.vote || m.watch).includes(id)) return 'junk';
  const w = msg.winner;
  if (!(w === m.a || w === m.b || w === 0 || w === -1)) return 'junk';
  if (Object.prototype.hasOwnProperty.call(m.rep, String(id))) return 'dup';
  m.rep[String(id)] = w;
  if (w === -1 && msg.why === 'noconn' && (id === m.a || id === m.b)) { if (!m.nc) m.nc = []; m.nc.push(id); }
  if (!m.first) m.first = now;
  return 'ok';
}

// The current match's result if it is settled now: a winner's id, 0, -1
// (void), { absent: [ids] } (a player never took it), { noconn: true } (the
// players could not connect), or null (not yet).
function lobbyDecision(L, now) {
  const m = L.match;
  if (!m) return null;
  const has = (id) => Object.prototype.hasOwnProperty.call(m.rep, String(id));
  const ra = m.rep[String(m.a)], rb = m.rep[String(m.b)];
  if (has(m.a) && has(m.b) && ra === rb && ra !== -1) return ra;
  const nc = (m.nc || []).length > 0;
  if ((m.nc || []).includes(m.a) && (m.nc || []).includes(m.b)) return { noconn: true };
  const absent = lobbyAbsentIds(m);
  if (absent.length) {
    const late = absent.filter((id) => now >= lobbyReadyBy(m, id));
    return late.length ? { absent: late } : null;
  }
  const due = (m.first && now >= m.first + LOBBY_REPORT_MS) || now >= m.at + LOBBY_MATCH_MS;
  const all = [m.a, m.b].concat((m.vote || m.watch).filter((id) => lobbyMember(L, id))).every(has);
  if (!due && !all) return null;
  const votes = new Map();
  for (const k of Object.keys(m.rep)) {
    const v = m.rep[k];
    if (v === -1) continue;
    votes.set(v, (votes.get(v) || 0) + 1);
  }
  let best = null, n = 0, tie = false;
  for (const [v, c] of votes) {
    if (c > n) { best = v; n = c; tie = false; } else if (c === n) tie = true;
  }
  // ONE player said it never connected (both saying so is no contest, above):
  // a result then needs two votes for it, and without them the match is void,
  // not no contest, so neither player gains by claiming either (see the header)
  if (best === null || tie || (nc && n < 2)) return -1;
  return best;
}

// When the lobby next needs the clock (the alarm).
function lobbyDue(L) {
  let t = Math.min(L.seen + LOBBY_IDLE_MS, L.born + LOBBY_LIFE_MS);
  const m = L.match;
  if (m) {
    const absent = lobbyAbsentIds(m);
    t = Math.min(t, absent.length ? Math.min(...absent.map((id) => lobbyReadyBy(m, id)))
      : m.first ? m.first + LOBBY_REPORT_MS : m.at + LOBBY_MATCH_MS);
  }
  return t;
}
function lobbyExpired(L, now) { return now >= L.seen + LOBBY_IDLE_MS || now >= L.born + LOBBY_LIFE_MS; }

// What next after a match (the stayer and the first in line, or the first
// two), for the page's "next: A vs B"; a = 0 means "the winner of this match".
function lobbyPreview(L) {
  if (L.match) {
    const m = L.match;
    const hold = L.limit && (L.streak.id === m.a || L.streak.id === m.b) && L.streak.n + 1 >= L.limit;
    return L.line.length ? { a: 0, b: L.line[0], rotate: hold ? L.streak.id : 0 } : null;
  }
  if (L.stay && L.line.length) return { a: L.stay, b: L.line[0] };
  if (!L.stay && L.line.length >= 2) return { a: L.line[0], b: L.line[1] };
  return null;
}

function lobbyView(L) {
  const m = L.match;
  return { t: 'state', code: L.code, title: L.title || '', host: L.host, limit: L.limit, pass: !!L.pass, max: LOBBY_MAX,
    members: L.members.map((x) => ({ id: x.id, name: x.name, spec: x.spec })),
    line: L.line.slice(), stay: L.stay, streak: { id: L.streak.id, n: L.streak.n },
    match: m ? { id: m.id, a: m.a, b: m.b, ready: (m.ready || []).slice(), away: (m.away || []).slice() } : null,
    next: lobbyPreview(L) };
}

// What the list of open lobbies shows of this lobby, or null: never listed
// (a password) or nothing to list. Nothing else leaves the lobby this way.
function lobbyEntry(L) {
  if (!L || L.pass || !L.members.length) return null;
  const nm = (id) => { const x = lobbyMember(L, id); return x ? x.name : ''; };
  const m = L.match;
  return { code: L.code, title: L.title || '', host: nm(L.host), n: L.members.length, max: LOBBY_MAX,
    a: m ? nm(m.a) : '', b: m ? nm(m.b) : '',
    streak: L.streak.n && lobbyMember(L, L.streak.id) ? { name: nm(L.streak.id), n: L.streak.n } : null,
    free: L.members.length < LOBBY_MAX, build: L.build };
}

// The list as served: entries ({e, born}) with people in them first (a flood of
// one-member lobbies sorts below every lobby that has a crowd), then the
// oldest, at most LOBBY_LIST_SHOW of them.
const LOBBY_LIST_SHOW = 100;
function lobbyList(items) {
  return items.filter((x) => x && x.e).sort((x, y) => (y.e.n - x.e.n) || (x.born - y.born) || (x.e.code < y.e.code ? -1 : 1))
    .slice(0, LOBBY_LIST_SHOW).map((x) => x.e);
}

// The list for one build. A player can join only a lobby on their own build
// (the 'build' deny), so the page asks GET /lobbies?build=<its Build ID>:
// lobbyListBuild(value of ?build) is that Build ID, or '' when the request has
// none or not one shaped like a Build ID (an older page: the whole list, as
// before). lobbyListBody is the reply: with a build, only that build's
// lobbies (sorted and capped as above) and `other`, how many listed lobbies
// are on another build; without, every lobby. A server keeps the reply per
// build for its cache time, for at most LOBBY_LIST_BUILDS builds at once (the
// oldest made goes first).
const LOBBY_LIST_BUILDS = 64;
function lobbyListBuild(v) {
  const s = String(v || '').toLowerCase();
  return /^[0-9a-f]{16}$/.test(s) ? s : '';
}
function lobbyListBody(items, build) {
  const all = items.filter((x) => x && x.e);
  if (!build) return { t: 'lobbies', list: lobbyList(all) };
  const mine = all.filter((x) => x.e.build === build);
  return { t: 'lobbies', build, other: all.length - mine.length, list: lobbyList(mine) };
}
function lobbyListCache(cache, build, now, maxAgeMs, make) {
  let c = cache.get(build);
  if (!c || now - c.at >= maxAgeMs) {
    c = { at: now, body: make() };
    cache.delete(build);
    cache.set(build, c);
    while (cache.size > LOBBY_LIST_BUILDS) cache.delete(cache.keys().next().value);
  }
  return c.body;
}

// ---- what a server does with it. `out` collects what to send ([member id,
// message]) and whom to close ([member id, code]), in order; the server
// carries them out. `st` is the member's own counters (the server keeps them
// with its socket). `dirty`: the record changed, so the server writes it and
// sets its alarm (`changed` also sends everyone the new state).
function lobbyOut() { return { send: [], close: [], ev: [], changed: false, dirty: false }; }

function lobbyJunk(st, now, out, id) {
  if (now - (st.jat || 0) > 60000) { st.jat = now; st.junk = 0; }
  st.junk = (st.junk || 0) + 1;
  if (st.junk > LOBBY_JUNK_MAX && !out.close.some((c) => c[0] === id)) out.close.push([id, 1008]);
}

function lobbyBucket(st, k, now, burst, perMs) {
  const at = st[k + 'at'] || now;
  let tok = st[k] === undefined ? burst : st[k];
  tok = Math.min(burst, tok + (now - at) / perMs);
  st[k + 'at'] = now;
  if (tok < 1) { st[k] = tok; return false; }
  st[k] = tok - 1;
  return true;
}

// A member joins (after lobbyAdmit). Returns its id.
function lobbyEnter(L, name, now, out, bid) {
  const id = lobbyAdd(L, name, now, bid);
  if (bid) {
    if (!L.okbid) L.okbid = [];
    if (!L.okbid.includes(bid)) L.okbid.push(bid);
    while (L.okbid.length > LOBBY_KNOWN_MEMORY) L.okbid.shift();
  }
  out.send.push([id, { t: 'lobby', code: L.code, you: id }]);
  out.ev.push({ k: 'join', id, name: lobbyMember(L, id).name });
  if (L.match) {
    // Arriving mid-match: pointed at it like everyone else; the match host
    // takes no watcher once its match has started, so this one watches the
    // next match. It has no vote on this one (m.vote is fixed).
    L.match.watch.push(id);
    out.send.push([id, { t: 'watch', match: L.match.id, host: L.match.a }]);
    out.send.push([L.match.a, { t: 'watcher', match: L.match.id, id }]);
  }
  out.changed = true;
  return id;
}

function lobbyLeave(L, id, why, now, out) {
  const m = L.match;
  if (m && m.watch.includes(id) && m.a !== id) out.send.push([m.a, { t: 'wbye', id }]);
  out.ev.push(...lobbyRemove(L, id, why));
  out.changed = true;
}

function lobbyMessage(L, id, st, raw, now) {
  const out = lobbyOut();
  const me = lobbyMember(L, id);
  if (!me) return out;
  let msg = null;
  if (typeof raw === 'string' && raw.length <= LOBBY_MSG_MAX) {
    try { msg = JSON.parse(raw); } catch (e) { msg = null; }
  }
  if (!msg || typeof msg !== 'object' || Array.isArray(msg) || typeof msg.t !== 'string' ||
      !lobbyBucket(st, 'tok', now, LOBBY_MSG_BURST, 1000 / LOBBY_MSG_PER_S)) {
    lobbyJunk(st, now, out, id);
    return out;
  }
  const m = L.match;
  const junk = () => { lobbyJunk(st, now, out, id); return out; };
  if (msg.t === 'chat') {
    const text = lobbyClean(msg.text, LOBBY_CHAT_MAX);
    if (!text) return out;
    if (!lobbyBucket(st, 'chat', now, LOBBY_CHAT_BURST, LOBBY_CHAT_EVERY_MS)) {
      if (now - (st.slowat || 0) > 2000) { st.slowat = now; out.send.push([id, { t: 'slow' }]); }
      return out;
    }
    if (now - L.seen >= LOBBY_SEEN_STEP_MS) { L.seen = now; out.dirty = true; }
    for (const x of L.members) out.send.push([x.id, { t: 'chat', from: id, name: me.name, text }]);
    return out;
  }
  if (msg.t === 'spec') {
    if (typeof msg.on !== 'boolean') return junk();
    const ev = lobbySpec(L, id, msg.on);
    if (!ev.length) return out;
    out.ev.push(...ev);
    L.seen = now;
    out.changed = true;
    return out;
  }
  if (msg.t === 'sdp') {
    if (!m || !msg.sdp || typeof msg.sdp !== 'object' || Array.isArray(msg.sdp)) return junk();
    const hasTo = Object.prototype.hasOwnProperty.call(msg, 'to');
    let dest = 0;
    if ((id === m.a || id === m.b) && !hasTo) dest = id === m.a ? m.b : m.a;
    else if (id === m.a && Number.isInteger(msg.to) && m.watch.includes(msg.to)) dest = msg.to;
    else if (m.watch.includes(id) && (!hasTo || msg.to === m.a)) dest = m.a;
    if (!dest || !lobbyMember(L, dest)) return junk();
    if (st.sm !== m.id) { st.sm = m.id; st.sn = 0; }
    if (++st.sn > (id === m.a ? LOBBY_SDP_HOST : LOBBY_SDP_OTHER)) return junk();
    // the match host's SDP went to this watcher: a refusal no longer takes its
    // vote (see wdeny)
    if (id === m.a && hasTo) {
      if (!m.fed) m.fed = [];
      if (!m.fed.includes(dest)) { m.fed.push(dest); out.dirty = true; }
    }
    out.send.push([dest, { t: 'sdp', from: id, match: m.id, sdp: msg.sdp }]);
    return out;
  }
  if (msg.t === 'wdeny') {
    if (!m || id !== m.a || !Number.isInteger(msg.to) || !m.watch.includes(msg.to)) return junk();
    out.send.push([msg.to, { t: 'wdeny', match: m.id, reason: LOBBY_WDENY.includes(msg.reason) ? msg.reason : 'denied' }]);
    // a watcher the match host refused before sending it its SDP never saw
    // the match: no vote. One the host sent its SDP keeps its vote, so a match
    // host cannot strip the votes of the watchers it let in.
    if (m.vote && m.vote.includes(msg.to) && !(m.fed || []).includes(msg.to)) {
      m.vote = m.vote.filter((x) => x !== msg.to);
      out.dirty = true;
    }
    return out;
  }
  if (msg.t === 'ready') {
    if (!m || msg.match !== m.id || (id !== m.a && id !== m.b)) return junk();
    if (!m.ready) m.ready = [];
    // everyone's state shows who is ready: the other player's page starts its
    // connection clock only when both are
    if (!m.ready.includes(id)) { m.ready.push(id); L.seen = now; out.changed = true; }
    return out;
  }
  if (msg.t === 'away') {
    if (!m || msg.match !== m.id || (id !== m.a && id !== m.b)) return junk();
    if (!m.away) m.away = [];
    if (m.away.includes(id) || (m.ready || []).includes(id) || now >= m.at + LOBBY_READY_MS) return out;
    m.away.push(id);
    out.ev.push({ k: 'away', id, match: m.id, s: Math.round(LOBBY_AWAY_MS / 1000) });
    out.changed = true;
    return out;
  }
  if (msg.t === 'result') {
    const r = lobbyReport(L, id, msg, now);
    if (r === 'junk') return junk();
    if (r === 'ok') { L.seen = now; out.dirty = true; }
    return out;
  }
  if (msg.t === 'limit') {
    if (id !== L.host || !Number.isInteger(msg.n) || msg.n < 0 || msg.n > LOBBY_STREAK_MAX) return junk();
    if (L.limit !== msg.n) { L.limit = msg.n; L.seen = now; out.ev.push({ k: 'limit', n: msg.n }); out.changed = true; }
    return out;
  }
  if (msg.t === 'kick') {
    if (id !== L.host || msg.id === id || !Number.isInteger(msg.id)) return junk();
    const x = lobbyMember(L, msg.id);
    if (!x) return out;
    for (const k of [x.key || lobbyKey(x.name), lobbyKey(x.name)]) if (k && !L.kicked.includes(k)) L.kicked.push(k);
    while (L.kicked.length > LOBBY_KICK_MEMORY) L.kicked.shift();
    if (!L.kbid) L.kbid = [];
    if (x.bid && !L.kbid.includes(x.bid)) L.kbid.push(x.bid);
    while (L.kbid.length > LOBBY_KICK_MEMORY) L.kbid.shift();
    out.send.push([x.id, { t: 'deny', reason: 'kicked' }]);
    out.close.push([x.id, 1000]);
    lobbyLeave(L, x.id, 'kick', now, out);
    L.seen = now;
    return out;
  }
  return junk();
}

// Members the core asked to close and that are still in: they leave first.
function lobbyFlush(L, now, out) {
  for (const [id] of out.close) if (lobbyMember(L, id)) lobbyLeave(L, id, 'leave', now, out);
  return lobbySettle(L, now, out);
}

// After any change: a settled match ends, the next one is assigned, and
// everyone gets the chat lines and the new state.
function lobbySettle(L, now, out) {
  const w = lobbyDecision(L, now);
  if (w !== null) {
    out.ev.push(...(typeof w === 'object' ? (w.noconn ? lobbyNoConn(L) : lobbyAbsent(L, w.absent)) : lobbyFinish(L, w, 'report')));
    out.changed = true;
  }
  const nm = lobbyNext(L, now);
  if (nm) { out.ev.push({ k: 'match', match: nm.id, a: nm.a, b: nm.b }); out.changed = true; }
  if (out.changed || out.ev.length) {
    const ids = L.members.map((x) => x.id);
    const named = (id) => { const x = lobbyMember(L, id); return x ? x.name : ''; };
    for (const e of out.ev) {
      const line = Object.assign({ t: 'sys' }, e);
      for (const k of ['id', 'a', 'b', 'w', 'l']) if (line[k] && !line[k + 'n']) line[k + 'n'] = (k === 'id' && e.name) || named(line[k]);
      delete line.name;
      for (const id of ids) out.send.push([id, line]);
    }
    const view = lobbyView(L);
    for (const id of ids) out.send.push([id, view]);
    out.dirty = true;
  }
  if (nm) {
    const named = (id) => { const x = lobbyMember(L, id); return x ? x.name : ''; };
    out.send.push([nm.a, { t: 'match', match: nm.id, role: 'host', opp: { id: nm.b, name: named(nm.b) } }]);
    out.send.push([nm.b, { t: 'match', match: nm.id, role: 'guest', opp: { id: nm.a, name: named(nm.a) } }]);
    for (const id of nm.watch) {
      out.send.push([id, { t: 'watch', match: nm.id, host: nm.a }]);
      out.send.push([nm.a, { t: 'watcher', match: nm.id, id }]);
    }
  }
  out.ev = [];
  out.changed = false;
  return out;
}
// ---- LOBBY CORE end ----

// A directory entry as a lobby put it, rebuilt field by field (only this
// file's Room objects put entries; this is defense in depth).
function dirClean(code, e) {
  if (!e || typeof e !== 'object' || e.code !== code) return null;
  const s = (v) => lobbyClean(v, LOBBY_NAME_MAX);
  const n = Number.isInteger(e.n) && e.n >= 1 && e.n <= LOBBY_MAX ? e.n : 0;
  if (!n) return null;
  const st = e.streak && typeof e.streak === 'object' && Number.isInteger(e.streak.n) && e.streak.n >= 1 && e.streak.n <= 9999
    ? { name: s(e.streak.name), n: e.streak.n } : null;
  const out = { code, title: lobbyClean(e.title, LOBBY_TITLE_MAX), host: s(e.host), n, max: LOBBY_MAX, a: s(e.a), b: s(e.b), streak: st, free: n < LOBBY_MAX };
  if (typeof e.build === 'string' && /^[0-9a-f]{16}$/.test(e.build)) out.build = e.build;
  return out;
}

export class Room {
  // state and env come from the runtime; opts is for the test suite:
  // {now, roomWaitMs}.
  constructor(state, env, opts) {
    const o = opts || {};
    this.state = state;
    this.env = env || {};
    this.now = o.now || (() => Date.now());
    this.waitMs = pickMs(o.roomWaitMs, this.env.ROOM_WAIT_MS, ROOM_WAIT_MS);
    // Watch attempts (a lobby: members admitted) in the last minute. In
    // memory on purpose: the object is only evicted after a quiet spell,
    // which is a low rate by definition.
    this.attempts = [];
    // A lobby's join budgets per address hash (LOBBY CORE, JOIN BUDGETS) and
    // the salt for those hashes: memory only, never stored.
    this.book = new Map();
    this.salt = '';
  }
  async addr(request) {
    if (!this.salt) this.salt = randomHex();
    return addrHash(request, this.salt);
  }

  open(tag, except) {
    return this.state.getWebSockets(tag).filter((w) => w !== except && w.readyState === 1);
  }
  host(except) { return this.open('host', except)[0] || null; }
  guest(except) { return this.open('guest', except)[0] || null; }
  watchers(except) { return this.open('watcher', except); }
  info(ws) {
    try { return (ws && ws.deserializeAttachment()) || {}; } catch { return {}; }
  }
  save(ws, a) { try { ws.serializeAttachment(a); } catch { /* closing */ } }

  send(ws, obj) {
    try { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); } catch { /* dying */ }
  }
  shut(ws, code) { try { ws.close(code || 1000); } catch { /* already gone */ } }

  // A refusal arrives as a protocol message the page can show, then the close.
  refuse(server, reason, code) {
    server.accept();
    this.send(server, { t: 'deny', reason });
    this.shut(server, code || 1000);
  }

  // The watcher count, to both players (watch rooms only).
  count(except) {
    const n = this.watchers(except).length;
    for (const p of [this.host(except), this.guest(except)]) this.send(p, { t: 'wcount', n });
  }

  // The host's socket is gone: the room ends.
  end(except, msg) {
    for (const ws of [this.guest(except)].concat(this.watchers(except))) {
      if (!ws) continue;
      this.send(ws, msg || { t: 'bye' });
      this.shut(ws, 1000);
    }
    this.state.storage.deleteAlarm().catch(() => {});
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === '/status') {
      // Stale-room guard: a room nobody joined stops counting as "active"
      // once its wait is over, freeing the code; a watch room is active while
      // its host's socket is open.
      const h = this.host();
      const r = this.info(h);
      const L = await this.lobbyLoad();
      const active = (!!L && L.members.length > 0) ||
        (!!h && (!!r.watch || (this.now() - (r.born || 0)) < this.waitMs));
      return new Response(JSON.stringify({ active }), { headers: { 'Content-Type': 'application/json' } });
    }

    if (url.pathname.startsWith('/dir/')) return this.dirFetch(url, request);
    if (url.pathname !== '/ws') return new Response('not found', { status: 404 });
    const role = url.searchParams.get('role');
    const code = url.searchParams.get('code') || '';
    const pass = url.searchParams.get('pass') || '';

    const pair = new WebSocketPair();
    const client = pair[0], server = pair[1];

    if (role === 'lobby') await this.lobbyOpen(server, url.searchParams, request);
    else if (role === 'host') this.openHost(server, code, pass, url.searchParams.get('watchers') === '1');
    else if (role === 'watcher') this.openWatcher(server, pass);
    else this.openGuest(server, pass);

    return new Response(null, { status: 101, webSocket: client });
  }

  openHost(server, code, pass, watch) {
    if (this.host()) { this.refuse(server, 'busy', 1013); return; }
    const now = this.now();
    this.state.acceptWebSocket(server, ['host']);
    this.save(server, { role: 'host', code, pass, born: now, watch, on: watch, started: false });
    this.send(server, { t: 'room', code });
    // Every room waits this.waitMs for its guest (a plain room too: the
    // kit's cap, difference 2 in the header).
    if (capOn(this.waitMs)) this.state.storage.setAlarm(now + this.waitMs).catch(() => {});
  }

  openGuest(server, pass) {
    const h = this.host();
    if (!h) { this.refuse(server, 'badcode'); return; }
    const r = this.info(h);
    if (r.pass && r.pass !== pass) { this.refuse(server, 'badpass'); return; }
    if (this.guest() || r.started) { this.refuse(server, 'full'); return; }
    this.state.acceptWebSocket(server, ['guest']);
    this.save(server, { role: 'guest' });
    r.started = true;
    this.save(h, r);
    // A watch room tells its guest so (and the count), so a page that knows
    // about watchers can keep its socket open for the count; other pages
    // read only t.
    this.send(server, r.watch ? { t: 'joined', watchers: this.watchers().length } : { t: 'joined' });
    this.send(h, { t: 'peer' });
    // A plain room is mid-setup now and never timed out; a watch room's cap
    // becomes the session's.
    if (r.watch) this.state.storage.setAlarm(r.born + ROOM_SESSION_MS).catch(() => {});
    else this.state.storage.deleteAlarm().catch(() => {});
  }

  openWatcher(server, pass) {
    const now = this.now();
    this.attempts = this.attempts.filter((t) => now - t < 60000);
    if (this.attempts.length >= WATCH_PER_MIN) { this.refuse(server, 'slowdown'); return; }
    this.attempts.push(now);
    const h = this.host();
    if (!h) { this.refuse(server, 'badcode'); return; }
    const r = this.info(h);
    if (r.pass && r.pass !== pass) { this.refuse(server, 'badpass'); return; }
    if (!r.watch || !r.on) { this.refuse(server, 'nowatch'); return; }
    const ws = this.watchers();
    if (ws.length >= WATCH_MAX) { this.refuse(server, 'watchfull'); return; }
    // A random id rather than a counter: nothing to keep across an eviction,
    // and an id is never reused while its watcher is in the room.
    const ids = new Set(ws.map((w) => this.info(w).id));
    let id = 0;
    const rnd = new Uint32Array(1);
    while (!id || ids.has(id)) { crypto.getRandomValues(rnd); id = (rnd[0] >>> 1) || 1; }
    this.state.acceptWebSocket(server, ['watcher']);
    this.save(server, { role: 'watcher', id, sdp: 0, junk: 0 });
    this.send(server, { t: 'watching' });
    this.send(h, { t: 'watcher', id });
    this.count();
  }

  watcherById(id) {
    if (!Number.isInteger(id)) return null;
    return this.watchers().find((w) => this.info(w).id === id) || null;
  }

  async webSocketMessage(ws, data) {
    const a = this.info(ws);
    if (a.role === 'member') { await this.lobbyOnMessage(ws, a, data); return; }
    if (a.role === 'watcher') { this.fromWatcher(ws, a, data); return; }
    if (typeof data !== 'string' || data.length > PLAYER_MSG_MAX) return;
    let msg;
    try { msg = JSON.parse(data); } catch { return; }
    if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return;
    if (a.role === 'host') this.fromHost(ws, msg);
    else if (a.role === 'guest') {
      // Relayed verbatim, except what only the lobby may say.
      if (LOBBY_ONLY.includes(msg.t) || 'from' in msg || 'to' in msg) return;
      this.send(this.host(), msg);
    }
  }

  fromHost(ws, msg) {
    if ('to' in msg) {
      const w = this.watcherById(msg.to);
      if (!w) return;
      if (msg.t === 'sdp' && msg.sdp && typeof msg.sdp === 'object') {
        this.send(w, { t: 'sdp', sdp: msg.sdp });
      } else if (msg.t === 'wdeny') {
        const reason = WDENY_REASONS.includes(msg.reason) ? msg.reason : 'denied';
        this.send(w, { t: 'deny', reason });
        this.left(w, this.info(w));
        this.shut(w, 1000);
      }
      return;
    }
    if (msg.t === 'allow') {
      const r = this.info(ws);
      if (!r.watch) return;
      r.on = msg.on === true;
      this.save(ws, r);
      return;
    }
    if (msg.t === 'wdeny') return;
    this.send(this.guest(), msg);
  }

  fromWatcher(ws, a, data) {
    let msg = null;
    if (typeof data === 'string' && data.length <= WATCH_MSG_MAX) {
      try { msg = JSON.parse(data); } catch { msg = null; }
    }
    if (msg && typeof msg === 'object' && msg.t === 'sdp' && msg.sdp && typeof msg.sdp === 'object' &&
        !Array.isArray(msg.sdp) && a.sdp < WATCH_SDP_MAX) {
      a.sdp++;
      this.save(ws, a);
      this.send(this.host(), { t: 'sdp', from: a.id, sdp: msg.sdp });
      return;
    }
    a.junk++;
    this.save(ws, a);
    if (a.junk > WATCH_JUNK_MAX) {
      this.left(ws, a);
      this.shut(ws, 1008);
    }
  }

  // A watcher is gone: the host hears it once, the players get the count.
  // Called before the lobby closes a watcher itself, so the close event that
  // may follow finds it marked.
  left(ws, a) {
    if (a.gone) return;
    a.gone = true;
    this.save(ws, a);
    this.send(this.host(), { t: 'wbye', id: a.id });
    this.count(ws);
  }

  async webSocketClose(ws) {
    const a = this.info(ws);
    this.shut(ws, 1000);
    if (a.role === 'member') { await this.lobbyGone(ws, a); return; }
    if (a.role === 'host') {
      this.end(ws);
    } else if (a.role === 'guest') {
      const h = this.host(ws);
      if (!h) return;
      this.send(h, { t: 'bye' });
      // A plain room ends with its guest; a watch room stays for its
      // watchers, and the started latch keeps the guest slot shut.
      if (!this.info(h).watch) { this.shut(h, 1000); this.end(h); }
    } else if (a.role === 'watcher') {
      this.left(ws, a);
    }
  }

  async webSocketError(ws) { return this.webSocketClose(ws); }


  // ---- lobbies (winner stays; the LOBBY CORE above has the rules) ----
  // A lobby is a Room object in another mode: same code space (a code is a
  // room or a lobby, never both), no new class or binding. Its record lives in
  // this object's storage ('lobby'), so a lobby whose object was evicted while
  // its members' sockets stayed open (hibernation) wakes up as it was; each
  // member's own counters ride on its socket's attachment. Chat is never
  // stored. The record is deleted when the last member leaves; the alarm
  // carries the result timeouts and the idle and lifetime caps.
  async lobbyLoad() {
    if (this.L === undefined) {
      let v = null;
      try { v = (await this.state.storage.get('lobby')) || null; } catch { v = null; }
      if (this.L === undefined) this.L = v;
    }
    return this.L;
  }

  lobbySocks() {
    const m = new Map();
    for (const w of this.state.getWebSockets('lobby')) {
      if (w.readyState !== 1) continue;
      const a = this.info(w);
      if (a.role === 'member' && !a.gone) m.set(a.id, w);
    }
    return m;
  }

  // Carry out what the core decided, then keep (or end) the record: written,
  // and its alarm set, only when the core marked it dirty (rearm: the alarm
  // fired, so it is set again even when nothing changed).
  async lobbyCommit(out, now, rearm) {
    const L = this.L;
    lobbyFlush(L, now, out);
    const socks = this.lobbySocks();
    for (const [id, msg] of out.send) this.send(socks.get(id), msg);
    for (const [id, code] of out.close) {
      const w = socks.get(id);
      if (!w) continue;
      this.save(w, Object.assign(this.info(w), { gone: true }));
      this.shut(w, code);
    }
    if (!L.members.length) {
      this.L = null;
      await this.state.storage.delete('lobby').catch(() => {});
      await this.state.storage.deleteAlarm().catch(() => {});
      await this.dirGone(L);
      return;
    }
    const put = this.dirWant(L, now);
    if (out.dirty || put) await this.state.storage.put('lobby', L).catch(() => {});
    if (out.dirty || rearm || put) await this.state.storage.setAlarm(this.lobbyWake(L)).catch(() => {});
    if (put) await this.dirPut(L, put);
  }

  // ---- this lobby's entry in the list of open lobbies (THE LIST, above
  // the router). dirWant: the entry to put now (it changed, or a refresh is
  // due), or null; it notes what was put in the record, which the caller
  // writes. A put that fails is retried at the next change or refresh.
  dirWant(L, now) {
    const e = lobbyEntry(L);
    const sig = JSON.stringify(e);
    if (sig === (L.dirSig || 'null') && (!e || now - (L.dirAt || 0) < DIR_REFRESH_MS)) return null;
    L.dirSig = sig;
    L.dirAt = now;
    L.dirV = (L.dirV || 0) + 1;
    return { e, v: L.dirV };
  }
  lobbyWake(L) {
    return Math.min(lobbyDue(L), L.dirSig && L.dirSig !== 'null' ? (L.dirAt || 0) + DIR_REFRESH_MS : Infinity);
  }
  async dirPut(L, put) {
    const ns = this.env.ROOM;
    if (!ns) return;
    try {
      await ns.get(ns.idFromName(DIR_NAME)).fetch(new Request('https://do/dir/put', {
        method: 'POST', body: JSON.stringify({ code: L.code, born: L.born, v: put.v, e: put.e }) }));
    } catch { /* the next change or refresh puts it again */ }
  }
  // The lobby ended: off the list now (the TTL would take it off anyway).
  async dirGone(L) {
    if (L.dirSig && L.dirSig !== 'null') await this.dirPut(L, { e: null, v: (L.dirV || 0) + 1 });
  }

  // ---- directory mode (only the Room named DIR_NAME is ever sent these) ----
  async dirLoad() {
    if (this.dir === undefined) {
      let v = null;
      try { v = await this.state.storage.list({ prefix: 'd:' }); } catch { v = null; }
      if (this.dir === undefined) {
        this.dir = new Map();
        if (v) for (const [k, x] of v) this.dir.set(k.slice(2), x);
      }
    }
    return this.dir;
  }
  async dirFetch(url, request) {
    const now = this.now();
    const json = (o, s) => new Response(JSON.stringify(o), { status: s || 200, headers: { 'Content-Type': 'application/json' } });
    if (url.pathname === '/dir/gate') {
      if (!this.salt) this.salt = randomHex();
      const who = await addrHash(request, this.salt);
      if (!this.gates) this.gates = new Map();
      for (const [k, v] of this.gates) {
        while (v.length && now - v[0] >= 600000) v.shift();
        if (!v.length) this.gates.delete(k);
      }
      const v = this.gates.get(who) || [];
      if (v.length >= CREATE_PER_10MIN) return json({ ok: false });
      v.push(now);
      this.gates.set(who, v);
      // which address hash opened this code (memory only; for DIR_PER_CREATOR)
      let b = null;
      try { b = await request.json(); } catch { b = null; }
      if (b && typeof b.code === 'string' && b.code && b.code.length <= 64) {
        if (!this.owners) this.owners = new Map();
        this.owners.set(b.code, who);
        while (this.owners.size > DIR_MAX * 4) this.owners.delete(this.owners.keys().next().value);
      }
      return json({ ok: true });
    }
    const D = await this.dirLoad();
    const drop = [];
    for (const [k, x] of D) if (x.exp <= now) { D.delete(k); drop.push('d:' + k); if (this.owners) this.owners.delete(k); }
    for (let i = 0; i < drop.length; i += 128) await this.state.storage.delete(drop.slice(i, i + 128)).catch(() => {});
    if (drop.length) this.lists = null;
    if (url.pathname === '/dir/put') {
      let b = null;
      try { b = await request.json(); } catch { b = null; }
      if (!b || typeof b.code !== 'string' || !b.code || b.code.length > 64 || !Number.isFinite(b.born) || !Number.isInteger(b.v)) return json({ ok: false }, 400);
      const cur = D.get(b.code);
      if (cur && (cur.born > b.born || (cur.born === b.born && cur.v >= b.v))) return json({ ok: true, stale: true });
      const e = b.e === null ? null : dirClean(b.code, b.e);
      if (b.e !== null && !e) return json({ ok: false }, 400);
      if (e && !(cur && cur.e)) {
        const listed = Array.from(D.entries()).filter(([, x]) => x.e);
        if (listed.length >= DIR_MAX) return json({ ok: false, full: true });
        // at most DIR_PER_CREATOR listed per creating address (see LIMITS)
        const who = this.owners && this.owners.get(b.code);
        if (who && listed.filter(([k]) => this.owners.get(k) === who).length >= DIR_PER_CREATOR) return json({ ok: false, cap: true });
      }
      if (!e && this.owners) this.owners.delete(b.code);
      // null is kept as a marker until its TTL, so a late put from the same
      // lobby (an older version) cannot bring it back
      const x = { e, born: b.born, v: b.v, exp: now + DIR_TTL_MS };
      D.set(b.code, x);
      await this.state.storage.put('d:' + b.code, x).catch(() => {});
      this.lists = null;
      return json({ ok: true });
    }
    if (url.pathname === '/dir/list') {
      // ?build= (lobbyListBuild): one build's lobbies; each build's body is
      // kept apart and rebuilt at most every 2 s, all of them dropped on a change
      const build = lobbyListBuild(url.searchParams.get('build'));
      if (!this.lists) this.lists = new Map();
      const body = lobbyListCache(this.lists, build, now, 2000, () => JSON.stringify(lobbyListBody(Array.from(D.values()), build)));
      return new Response(body, { headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('not found', { status: 404 });
  }

  async lobbyOpen(server, q, request) {
    const now = this.now();
    const p = lobbyParams((k) => q.get(k));
    let L = await this.lobbyLoad();
    if (q.get('new') === '1') {
      if (L || this.host()) { this.refuse(server, 'busy', 1013); return; }
      const why = lobbyAdmit(null, p);
      if (why) { this.refuse(server, why); return; }
      L = this.L = lobbyCreate(q.get('code') || '', p, now);
    } else {
      if (!L) { this.refuse(server, 'badcode'); return; }
      // this address's budget on this lobby first (a wrong-password storm
      // slows the guesser only, see JOIN BUDGETS), then the lobby's own cap
      // on members admitted a minute
      const who = request ? await this.addr(request) : '';
      if (lobbyTry(this.book, who, now, lobbyKnown(L, p.bid))) { this.refuse(server, 'slowdown'); return; }
      L = this.L;
      if (!L) { this.refuse(server, 'badcode'); return; }
      const why = lobbyAdmit(L, p);
      if (why === 'badpass') lobbyMiss(this.book, who, now);
      if (why) { this.refuse(server, why); return; }
      this.attempts = this.attempts.filter((t) => now - t < 60000);
      if (this.attempts.length >= LOBBY_JOIN_PER_MIN) { this.refuse(server, 'slowdown'); return; }
      this.attempts.push(now);
    }
    const out = lobbyOut();
    const id = lobbyEnter(L, p.name, now, out, p.bid);
    this.state.acceptWebSocket(server, ['lobby']);
    this.save(server, { role: 'member', id, st: {} });
    await this.lobbyCommit(out, now);
  }

  async lobbyOnMessage(ws, a, data) {
    const L = await this.lobbyLoad();
    if (!L || !lobbyMember(L, a.id)) { this.shut(ws, 1000); return; }
    const now = this.now();
    const st = a.st || {};
    const out = lobbyMessage(L, a.id, st, typeof data === 'string' ? data : null, now);
    a.st = st;
    this.save(ws, a);
    await this.lobbyCommit(out, now);
  }

  async lobbyGone(ws, a) {
    const L = await this.lobbyLoad();
    if (!L || !lobbyMember(L, a.id)) return;
    const now = this.now();
    const out = lobbyOut();
    lobbyLeave(L, a.id, 'leave', now, out);
    await this.lobbyCommit(out, now);
  }

  async lobbyAlarm() {
    const L = this.L;
    const now = this.now();
    if (lobbyExpired(L, now)) {
      for (const w of this.lobbySocks().values()) { this.send(w, { t: 'deny', reason: 'timeout' }); this.shut(w, 1000); }
      this.L = null;
      await this.state.storage.delete('lobby').catch(() => {});
      await this.dirGone(L);
      return;
    }
    await this.lobbyCommit(lobbyOut(), now, true);
  }

  // The caps of a room (this.waitMs unjoined, ROOM_SESSION_MS for a joined
  // watch room), or a lobby's timeouts and caps.
  async alarm() {
    if (await this.lobbyLoad()) { await this.lobbyAlarm(); return; }
    const h = this.host();
    if (!h) return;
    const r = this.info(h);
    // a joined plain room is mid-setup: never timed out
    if (!r.watch && r.started) return;
    const due = r.born + (r.started ? ROOM_SESSION_MS : this.waitMs);
    if (this.now() < due) { await this.state.storage.setAlarm(due); return; }
    this.send(h, { t: 'deny', reason: 'timeout' });
    this.shut(h, 1000);
    this.end(h);
  }
}
