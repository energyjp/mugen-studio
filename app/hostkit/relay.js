// Mugen Studio host kit: the lobby relay (Room) and the matchmaking queue
// (Queue), two Durable Object classes of the kit's one Worker.
//
// It implements the Studio's lobby protocol byte for byte, so today's
// public/ikemen/webrtc.js talks to it unchanged. Left out on purpose: every
// chat-channel notice, the hand-offs to a separate ranked server, and every
// hardcoded address. Added:
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
//     waiter and a room host nobody joined. A pair that is mid-setup (after
//     'match' or 'peer') is never cut off.
//
// PROTOCOL (what a client sees on /ws):
//   ?create=1[&pass=...]   -> {t:'room', code}
//   ?join=CODE[&pass=...]  -> guest {t:'joined'}, host {t:'peer'}
//                             {t:'deny', reason:'badcode'|'badpass'|'full'|'busy'}
//   ?queue=1&mode=ranked|casual&build=HEX&nc=0|1&name=NAME&code=RECOVERYCODE
//                          -> {t:'qcount', n} while waiting
//                             {t:'match', role:'host'|'guest', opponent, at, mode}
//                             {t:'deny', reason:'badident'|'identdown'}
//   either path, when nobody answers in time: {t:'deny', reason:'timeout'}
//   Then {t:'sdp', ...} is relayed verbatim between the two peers, and a peer
//   leaving sends {t:'bye'} to the other. On the queue path {t:'playing'}
//   from either peer marks the handoff to the game and is never relayed.
//   Room codes are lowercased on join. One Queue object per mode+build+netcode.
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
// calls them.
//
// WIRING (hostkit/worker.js):
//   import { Room, Queue, handleRelay } from './relay.js';
//   export { Room, Queue };
//   ...in fetch: if (url.pathname === '/ws') return handleRelay(request, env);
//   Bindings: ROOM, QUEUE and LADDER (durable_object_namespace). Optional
//   plain-text vars QUEUE_WAIT_MS and ROOM_WAIT_MS override the wait caps
//   (the test suite uses them); leave them unset in a real deploy.
//
// Sockets use accept() without hibernation, like the reference relay.
// Everything here is in memory: a lost object empties its queue or
// room, and a match already handed off is peer to peer and unaffected.
//
// Tests: node tools/test-hostkit-relay.js

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

// ------------------------------------------------------------------ router --
// Everything the Worker does for /ws. Bad input is refused here, before any
// Durable Object is addressed.
export async function handleRelay(request, env) {
  const url = new URL(request.url);
  if ((request.headers.get('Upgrade') || '').toLowerCase() !== 'websocket') {
    return new Response('expected websocket', { status: 426 });
  }

  const pass = url.searchParams.get('pass') || '';

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

  return new Response('missing create/join/queue', { status: 400 });
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
// One object IS one room (idFromName(code)), which gives the "deny when full"
// and password checks a single consistent home.
export class Room {
  // opts is for the test suite: {now, setTimer, clearTimer, roomWaitMs}.
  constructor(ctx, env, opts) {
    const o = opts || {};
    this.env = env || {};
    Object.assign(this, timersFrom(o));
    this.waitMs = pickMs(o.roomWaitMs, this.env.ROOM_WAIT_MS, ROOM_WAIT_MS);
    this.host = null;   // WebSocket
    this.guest = null;  // WebSocket
    this.pass = '';
    this.born = 0;
    this.timer = null;  // the host's wait for a guest
  }

  alive(ws) { return !!ws && ws.readyState === 1; }

  send(ws, obj) {
    try { if (this.alive(ws)) ws.send(JSON.stringify(obj)); } catch { /* dying */ }
  }

  stopTimer() {
    if (this.timer !== null) { this.clearTimer(this.timer); this.timer = null; }
  }

  teardown(leaver) {
    this.stopTimer();
    const other = leaver === this.host ? this.guest : this.host;
    this.send(other, { t: 'bye' });
    try { if (other) other.close(1000); } catch { /* already gone */ }
    this.host = this.guest = null;
    this.pass = '';
  }

  // Nobody joined in time. Only a host that is still alone is closed; once a
  // guest is in, the pair is mid-setup and the timer is already stopped.
  hostWaitOver(ws) {
    this.timer = null;
    if (ws !== this.host || this.guest || !this.alive(ws)) return;
    this.host = null;
    this.pass = '';
    this.send(ws, { t: 'deny', reason: 'timeout' });
    try { ws.close(1000); } catch { /* already gone */ }
  }

  wire(ws, isHost) {
    ws.addEventListener('message', (e) => {
      if (typeof e.data !== 'string' || e.data.length > MAX_MESSAGE) return;
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      if (!msg || typeof msg.t !== 'string') return;
      const to = isHost ? this.guest : this.host;
      this.send(to, msg);
    });
    const bye = () => {
      if ((isHost && ws === this.host) || (!isHost && ws === this.guest)) this.teardown(ws);
    };
    ws.addEventListener('close', bye);
    ws.addEventListener('error', bye);
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === '/status') {
      // Stale-room guard: a host that vanished without a close frame stops
      // counting as active once the room's wait is over, freeing the code.
      const active = this.alive(this.host) && (this.now() - this.born) < this.waitMs;
      return new Response(JSON.stringify({ active }), { headers: { 'Content-Type': 'application/json' } });
    }

    if (url.pathname !== '/ws') return new Response('not found', { status: 404 });
    const role = url.searchParams.get('role');
    const code = url.searchParams.get('code') || '';
    const pass = url.searchParams.get('pass') || '';

    const pair = new WebSocketPair();
    const client = pair[0], server = pair[1];
    server.accept();

    if (role === 'host') {
      if (this.alive(this.host)) {
        this.send(server, { t: 'deny', reason: 'busy' });
        server.close(1013);
      } else {
        this.stopTimer();
        this.host = server;
        this.guest = null;
        this.pass = pass;
        this.born = this.now();
        this.wire(server, true);
        this.send(server, { t: 'room', code });
        if (capOn(this.waitMs)) this.timer = this.setTimer(() => this.hostWaitOver(server), this.waitMs);
      }
    } else { // guest
      if (!this.alive(this.host)) {
        this.send(server, { t: 'deny', reason: 'badcode' });
        server.close(1000);
      } else if (this.pass && this.pass !== pass) {
        this.send(server, { t: 'deny', reason: 'badpass' });
        server.close(1000);
      } else if (this.alive(this.guest)) {
        this.send(server, { t: 'deny', reason: 'full' });
        server.close(1000);
      } else {
        this.stopTimer();
        this.guest = server;
        this.wire(server, false);
        this.send(server, { t: 'joined' });
        this.send(this.host, { t: 'peer' });
      }
    }

    return new Response(null, { status: 101, webSocket: client });
  }
}
