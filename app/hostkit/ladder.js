// Ladder: the host kit's identity + leaderboard Durable Object. A thin wrapper
// that puts LadderCore (ladder-core.js) on ctx.storage.sql and
// ctx.storage.transactionSync and answers HTTP requests handed to it by the
// kit's own Worker. It has no public address of its own.
//
// ============================================================ WIRING NOTES ==
// For whoever wires worker.js (routes) and relay.js (Queue).
//
// BINDING. `LADDER`, a SQLite-backed Durable Object namespace (migration tag
// v1, new_sqlite_classes). ONE instance serves the whole Worker, addressed by
// name: ladderStub(env) === env.LADDER.get(env.LADDER.idFromName('ladder')).
// The main module must re-export the class:  export { Ladder } from './ladder.js';
// Never reach the Ladder with a global fetch to the Worker's own hostname
// (Cloudflare error 1042); always go through the stub.
//
// 1. INTERNAL API (Queue -> Ladder). Answered ONLY when the request URL's host
//    is `ladder.internal`. A public request forwarded verbatim keeps the
//    Worker's own hostname, so it can never reach these; still, worker.js must
//    only forward the whitelisted public/admin paths below, never /internal/*.
//    Use the helpers exported here, which build the right URL:
//
//      await verifyIdentity(env, name, code)
//          -> {ok:true, name:'<display casing>'} | {ok:false}
//      await recordPairing(env, a, b, at)
//          -> {ok:true} | {ok:false, reason:'invalid'|'self'}
//      await ladderHealth(env)
//          -> {ok:true, schema:<n>}
//
//    Each helper THROWS when the Ladder cannot be reached or answers non-2xx.
//    The Queue maps a throw to deny reason 'identdown' and {ok:false} from
//    verifyIdentity to 'badident'. recordPairing is for RANKED pairs only, and
//    must be awaited BEFORE `match` is sent, with the same two names and the
//    same `at` the peers get; if it throws or answers {ok:false}, do not send
//    `match` (a ranked set it did not record could never count).
//    Raw form, if needed:  POST https://ladder.internal/internal/verify  {name, code}
//                          POST https://ladder.internal/internal/pairing {a, b, at}
//                          GET  https://ladder.internal/internal/health
//
// 2. PUBLIC ROUTES. worker.js applies CORS, its rate limits (429
//    {ok:false, reason:'ratelimited'}) and its body cap, then forwards the
//    request as is: `return ladderStub(env).fetch(request)`. The reply is JSON
//    without CORS headers; copy it into a new Response to add them.
//      GET  /mugen/identity/check?name=      200 {taken}
//      POST /mugen/identity/claim   {name}         200 {ok, name, code} | {ok:false, reason:'invalid'|'taken'}
//      POST /mugen/identity/recover {name, code}   200 {ok, name} | {ok:false}
//      GET  /mugen/leaderboard?limit=        200 {updated, players:[...]}   (limit clamped 1-200, default 50)
//      GET  /mugen/leaderboard/stats         200 {players, matches, pending}
//      GET  /mugen/leaderboard/me?name=      200 {ok, found, ...} | 400 {ok:false, reason:'noname'}
//      POST /mugen/leaderboard/report {name, code, opponent, won, character, startedAt, seq, buildId}
//           200 {ok, state:'pending'|'counted'|'duplicate'} | {ok:false, state:'conflict'}
//               | {ok:false, state:'refused', reason:'unpaired'|'seq'} | {ok:false, reason:'malformed'}
//           403 {ok:false, reason:'badident'}
//
// 3. ADMIN ROUTES. worker.js checks `x-admin-key` first; the Ladder checks it
//    AGAIN against env.ADMIN_KEY (defense in depth), so forward the request
//    with its headers. 403 {error:'forbidden'} otherwise.
//      GET    /admin/mugen/identity/names               {ok, count, names:[...]}  (never a code or hash)
//      POST   /admin/mugen/identity/name/:name/reset    {ok, name, code} | {ok:false, reason}
//      DELETE /admin/mugen/identity/name/:name          {ok, name} | {ok:false, reason}
//      POST   /admin/mugen/leaderboard/reset            {ok, cleared}
//      DELETE /admin/mugen/leaderboard/player/:name     {ok}
//      PATCH  /admin/mugen/leaderboard/player/:name {rating?, peakRating?, wins?, losses?, games?, streak?, bestStreak?}
//      GET    /admin/mugen/leaderboard/export           full JSON backup
//
// Other replies: 400 {ok:false, reason:'badjson'}, 413 {ok:false,
// reason:'toolarge'}, 404 {error:'notfound'}, 500 {ok:false, reason:'server'}.
// ============================================================================
//
// Web Crypto only, no `cloudflare:workers` import, so Node can load this file
// for tests.

import { LadderCore, sameSecret } from './ladder-core.js';

export const LADDER_OBJECT_NAME = 'ladder';
export const LADDER_INTERNAL_HOST = 'ladder.internal';
const INTERNAL_ORIGIN = 'https://' + LADDER_INTERNAL_HOST;
// A backstop only; worker.js enforces the real body cap.
const MAX_BODY = 16 * 1024;

export function ladderStub(env) {
  return env.LADDER.get(env.LADDER.idFromName(LADDER_OBJECT_NAME));
}

async function internalCall(env, path, body) {
  const init = body === undefined
    ? { method: 'GET' }
    : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
  const res = await ladderStub(env).fetch(INTERNAL_ORIGIN + path, init);
  if (!res.ok) throw new Error('ladder ' + path + ' answered ' + res.status);
  return res.json();
}

export function verifyIdentity(env, name, code) {
  return internalCall(env, '/internal/verify', { name: String(name || ''), code: String(code || '') });
}

export function recordPairing(env, a, b, at) {
  return internalCall(env, '/internal/pairing', { a: String(a || ''), b: String(b || ''), at });
}

export function ladderHealth(env) {
  return internalCall(env, '/internal/health');
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

class HttpError extends Error {
  constructor(status, body) {
    super(body.reason || body.error || String(status));
    this.status = status;
    this.body = body;
  }
}

async function readBody(request) {
  const text = await request.text();
  if (text.length > MAX_BODY) throw new HttpError(413, { ok: false, reason: 'toolarge' });
  if (!text.trim()) return {};
  let v;
  try {
    v = JSON.parse(text);
  } catch {
    throw new HttpError(400, { ok: false, reason: 'badjson' });
  }
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
}

function pathName(segment) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return '';
  }
}

export class Ladder {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env || {};
    this.core = null;
    this.bootError = null;
    try {
      this.core = new LadderCore(ctx.storage.sql, (fn) => ctx.storage.transactionSync(fn));
    } catch (e) {
      // A schema from a newer kit, or a class deployed without SQLite. Every
      // request then answers 500 instead of the object failing to construct.
      this.bootError = String((e && e.message) || e);
    }
  }

  async fetch(request) {
    try {
      if (!this.core) return json({ ok: false, reason: 'server', error: this.bootError }, 500);
      return await this.route(request);
    } catch (e) {
      if (e instanceof HttpError) return json(e.body, e.status);
      return json({ ok: false, reason: 'server' }, 500);
    }
  }

  async route(request) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const method = request.method.toUpperCase();
    const core = this.core;

    if (path.startsWith('/internal/')) {
      if (url.host !== LADDER_INTERNAL_HOST) return json({ error: 'notfound' }, 404);
      if (path === '/internal/verify' && method === 'POST') {
        const b = await readBody(request);
        const name = await core.verifiedName(b.name, b.code);
        return json(name ? { ok: true, name } : { ok: false });
      }
      if (path === '/internal/pairing' && method === 'POST') {
        const b = await readBody(request);
        return json(core.recordPairing(b.a, b.b, b.at));
      }
      if (path === '/internal/health' && method === 'GET') {
        return json({ ok: true, schema: core.schemaVersion() });
      }
      return json({ error: 'notfound' }, 404);
    }

    if (path.startsWith('/admin/mugen/')) {
      if (!(await sameSecret(request.headers.get('x-admin-key') || '', this.env.ADMIN_KEY))) {
        return json({ error: 'forbidden' }, 403);
      }
      return this.admin(request, path, method);
    }

    if (path === '/mugen/identity/check' && method === 'GET') {
      return json({ taken: core.isTaken(url.searchParams.get('name')) });
    }
    if (path === '/mugen/identity/claim' && method === 'POST') {
      const b = await readBody(request);
      return json(await core.claim(b.name));
    }
    if (path === '/mugen/identity/recover' && method === 'POST') {
      const b = await readBody(request);
      return json(await core.recover(b.name, b.code));
    }
    if (path === '/mugen/leaderboard' && method === 'GET') {
      return json(core.leaderboard(Number(url.searchParams.get('limit')) || 50));
    }
    if (path === '/mugen/leaderboard/stats' && method === 'GET') {
      return json(core.stats());
    }
    if (path === '/mugen/leaderboard/me' && method === 'GET') {
      const nameKey = String(url.searchParams.get('name') || '').toLowerCase();
      if (!nameKey) return json({ ok: false, reason: 'noname' }, 400);
      return json(core.me(nameKey));
    }
    if (path === '/mugen/leaderboard/report' && method === 'POST') {
      const b = await readBody(request);
      // A result can only ever be filed AS yourself.
      if (!(await core.verify(b.name, b.code))) return json({ ok: false, reason: 'badident' }, 403);
      return json(await core.report({
        name: b.name,
        opponent: b.opponent,
        won: b.won === true,
        character: b.character,
        startedAt: b.startedAt,
        seq: b.seq,
        buildId: b.buildId,
      }));
    }
    return json({ error: 'notfound' }, 404);
  }

  async admin(request, path, method) {
    const core = this.core;
    let m;
    if (path === '/admin/mugen/identity/names' && method === 'GET') return json(core.adminList());
    if ((m = path.match(/^\/admin\/mugen\/identity\/name\/([^/]+)\/reset$/)) && method === 'POST') {
      return json(await core.adminResetCode(pathName(m[1])));
    }
    if ((m = path.match(/^\/admin\/mugen\/identity\/name\/([^/]+)$/)) && method === 'DELETE') {
      return json(core.adminRelease(pathName(m[1])));
    }
    if (path === '/admin/mugen/leaderboard/reset' && method === 'POST') return json(core.resetAll());
    if (path === '/admin/mugen/leaderboard/export' && method === 'GET') return json(core.exportAll());
    if ((m = path.match(/^\/admin\/mugen\/leaderboard\/player\/([^/]+)$/))) {
      if (method === 'DELETE') return json(core.removePlayer(pathName(m[1])));
      if (method === 'PATCH') return json(core.setPlayer(pathName(m[1]), await readBody(request)));
    }
    return json({ error: 'notfound' }, 404);
  }
}
