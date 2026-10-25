// Mugen Studio host kit: the Worker's HTTP layer. worker.js (the main module)
// hands every request to the handler createWorker() returns; this file holds
// the routes, CORS, the body cap and the rate limits. They live apart from
// worker.js because workerd refuses a main module whose named exports include
// anything but handlers and classes (a constant such as KIT_VERSION stops the
// Worker from starting), and the tests need these settings and createWorker.
//
// ONE ADDRESS SERVES EVERYTHING. With the Worker at <worker>.<sub>.workers.dev:
//   Settings > Online relay URL        = wss://<that host>/ws
//   the bundle's leaderboard address   = https://<that host>
// and the game's pages append the /mugen/... routes themselves.
//
// ROUTES
//   GET  /                          health: {kit, version, parts} (wakes no object)
//   OPTIONS <any>                   CORS preflight, 204, the request headers reflected
//   /ws                             relay.js: rooms and the queue (WebSocket)
//   GET  /mugen/identity/check      -> the Ladder object (ladder.js)
//   POST /mugen/identity/claim      -> the Ladder, rate limited per IP
//   POST /mugen/identity/recover    -> the Ladder, rate limited per IP
//   GET  /mugen/leaderboard         -> the Ladder
//   GET  /mugen/leaderboard/stats   -> the Ladder
//   GET  /mugen/leaderboard/me      -> the Ladder, rate limited per IP + name
//   POST /mugen/leaderboard/report  -> the Ladder, rate limited per IP + name
//   /admin/mugen/*                  -> the Ladder, only with the x-admin-key
//                                      header (checked here AND in the Ladder)
//   anything else                   404 {error:'notfound'}
// Only these exact paths reach the Ladder. Its /internal/* calls (verify and
// pairing, used by the Queue) trust their caller, so no public request is
// ever forwarded there.
//
// REPLIES keep the shapes the game's pages already read from the reference
// server: 429 {ok:false, reason:'ratelimited'}, the Ladder's own 403
// {ok:false, reason:'badident'} and 400 {ok:false, reason:'noname'}, admin 403
// {error:'forbidden'}. Every reply outside /ws carries
// Access-Control-Allow-Origin: *, since the pages run on the host's own site.
//
// RATE LIMITS use the reference server's numbers (one hour windows): claim 10
// and recover 20 per IP; queue admissions 60, leaderboard/me 600 and report
// 200 per IP + name. The IP is Cloudflare's CF-Connecting-IP. The reference
// counted the last three per NAME alone; here the client's real address is
// known, and keying on it too means a stranger cannot use up somebody else's
// allowance (a report refused as rate limited would never count), while
// players behind one address still do not share one. The counts live in
// this Worker instance's memory, as the reference kept them in its process:
// they stop a script hammering from one place and are not an exact global
// count across Cloudflare's machines.
//
// No `cloudflare:workers` import and no Node APIs, so Node can load this file
// for tests (tools/test-hostkit-worker.js).

import { handleRelay } from './relay.js';
import { ladderStub } from './ladder.js';
import { sameSecret, KIT_NAME } from './ladder-core.js';

// ---------------------------------------------------------------- settings --
// Read by hostkit/deploy.js (kitVersion in its result) and by GET /.
export const KIT_VERSION = '1.0.0';
export const KIT_PARTS = Object.freeze(['relay', 'queue', 'ladder']);

// Largest request body accepted, in bytes. A report is well under 1 KiB; the
// Ladder has the same number as a backstop. A declared Content-Length over it
// is refused unread; a body without one is counted as it arrives and refused
// the moment it passes the cap.
export const MAX_BODY_BYTES = 16 * 1024;

export const RATE_WINDOW_MS = 60 * 60 * 1000;
// by: 'ip' counts per client address; 'ip+name' per address and lowercased
// player name. Numbers from the reference server.
export const RATE_LIMITS = Object.freeze({
  claim: Object.freeze({ limit: 10, by: 'ip' }),
  recover: Object.freeze({ limit: 20, by: 'ip' }),
  verify: Object.freeze({ limit: 60, by: 'ip+name' }),   // queue admissions on /ws
  me: Object.freeze({ limit: 600, by: 'ip+name' }),
  report: Object.freeze({ limit: 200, by: 'ip+name' }),
});
// Keys held at most, per rule: every rule has its own table. Past the cap,
// expired keys go first, then the least recently used, so a flood of fresh
// addresses cannot grow memory without bound. Separate tables mean a flood of
// fresh names on /me or report (keyed per IP + name, so cheap to mint) only
// ever pushes out other /me or report keys, never the claim and recover
// counts that stop one address from minting names.
export const RATE_MAX_KEYS = 5000;

const CORS_METHODS = 'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS';
const PREFLIGHT_MAX_AGE = '86400';

// ----------------------------------------------------------------- helpers --
function withCors(headers) {
  const h = new Headers(headers || {});
  h.set('Access-Control-Allow-Origin', '*');
  return h;
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: withCors({ 'content-type': 'application/json; charset=utf-8' }),
  });
}

// The Ladder's reply is JSON without CORS headers; copy it and add them.
function corsCopy(res) {
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: withCors(res.headers) });
}

function preflight(request) {
  const h = withCors();
  h.set('Access-Control-Allow-Methods', CORS_METHODS);
  const asked = request.headers.get('Access-Control-Request-Headers');
  if (asked) h.set('Access-Control-Allow-Headers', asked);
  h.set('Access-Control-Max-Age', PREFLIGHT_MAX_AGE);
  h.set('Vary', 'Access-Control-Request-Headers');
  return new Response(null, { status: 204, headers: h });
}

// The body's bytes, or null once they pass `max`. Read as a stream and counted
// chunk by chunk, so a body without a Content-Length (chunked) is refused as
// soon as it crosses the cap and the rest of it is never read.
async function readBytesCapped(request, max) {
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

class RateLimiter {
  constructor(now, maxKeys) {
    this.now = now;
    this.maxKeys = maxKeys;
    this.log = new Map(); // key -> timestamps inside the window, oldest first
  }

  // True when this call is over the limit (and then it is not recorded). The
  // reference server's sliding window: every allowed call counts.
  limited(key, limit, windowMs) {
    const t = this.now();
    const recent = (this.log.get(key) || []).filter((x) => t - x < windowMs);
    this.log.delete(key); // re-inserted below, so Map order = least recently used first
    if (recent.length >= limit) {
      this.log.set(key, recent);
      return true;
    }
    recent.push(t);
    this.log.set(key, recent);
    if (this.log.size > this.maxKeys) this.trim(t, windowMs);
    return false;
  }

  trim(t, windowMs) {
    for (const [k, times] of this.log) {
      if (!times.length || t - times[times.length - 1] >= windowMs) this.log.delete(k);
    }
    for (const k of this.log.keys()) {
      if (this.log.size <= this.maxKeys) break;
      this.log.delete(k);
    }
  }
}

// Public paths that go to the Ladder, by normalized path -> the rate rule
// (null: not limited) and the method it applies to.
const LADDER_ROUTES = new Map([
  ['/mugen/identity/check', null],
  ['/mugen/identity/claim', { rule: 'claim', method: 'POST' }],
  ['/mugen/identity/recover', { rule: 'recover', method: 'POST' }],
  ['/mugen/leaderboard', null],
  ['/mugen/leaderboard/stats', null],
  ['/mugen/leaderboard/me', { rule: 'me', method: 'GET' }],
  ['/mugen/leaderboard/report', { rule: 'report', method: 'POST' }],
]);

const HAS_BODY = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// ------------------------------------------------------------------ router --
// opts (tests): { now, rateLimits, rateWindowMs, maxBodyBytes, rateMaxKeys }.
export function createWorker(opts) {
  const o = opts || {};
  const now = o.now || (() => Date.now());
  const limits = o.rateLimits || RATE_LIMITS;
  const windowMs = o.rateWindowMs || RATE_WINDOW_MS;
  const maxBody = o.maxBodyBytes || MAX_BODY_BYTES;
  const maxKeys = o.rateMaxKeys || RATE_MAX_KEYS;
  // One table per rule (see RATE_MAX_KEYS).
  const limiters = {};
  for (const ruleName of Object.keys(limits)) limiters[ruleName] = new RateLimiter(now, maxKeys);

  const clientIp = (request) => request.headers.get('CF-Connecting-IP') || 'unknown';

  function over(ruleName, request, name) {
    const rule = limits[ruleName];
    if (!rule) return false;
    let key = ruleName + '|' + clientIp(request);
    if (rule.by === 'ip+name') key += '|' + String(name || '').toLowerCase();
    return limiters[ruleName].limited(key, rule.limit, windowMs);
  }

  // Reads a body under the cap. Resolves to {text, data} or a Response to send.
  async function readCapped(request) {
    const declared = Number(request.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > maxBody) return json({ ok: false, reason: 'toolarge' }, 413);
    const bytes = await readBytesCapped(request, maxBody);
    if (!bytes) return json({ ok: false, reason: 'toolarge' }, 413);
    const text = new TextDecoder().decode(bytes);
    let data = {};
    if (text.trim()) {
      try {
        data = JSON.parse(text);
      } catch {
        return json({ ok: false, reason: 'badjson' }, 400);
      }
    }
    return { text, data: data && typeof data === 'object' && !Array.isArray(data) ? data : {} };
  }

  async function toLadder(env, request, text) {
    const fwd = text === undefined ? request
      : new Request(request.url, { method: request.method, headers: request.headers, body: text });
    return corsCopy(await ladderStub(env).fetch(fwd));
  }

  // The queue's credential check runs in the Queue object, which cannot see
  // the client's address; the limit is applied here instead. Over it, the
  // request goes on with the code blanked, so the player hears 'badident'
  // over the socket without the Ladder being asked, exactly what the
  // reference relay answered when its verify call was rate limited.
  function relay(request, env) {
    const url = new URL(request.url);
    const upgrade = (request.headers.get('Upgrade') || '').toLowerCase() === 'websocket';
    const name = url.searchParams.get('name') || '';
    const code = url.searchParams.get('code') || '';
    if (upgrade && url.searchParams.has('queue') && name && code && over('verify', request, name)) {
      url.searchParams.set('code', '');
      return handleRelay(new Request(url.toString(), request), env);
    }
    return handleRelay(request, env);
  }

  async function route(request, env) {
    const method = request.method.toUpperCase();
    if (method === 'OPTIONS') return preflight(request);

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (path === '/ws') return relay(request, env);

    if (path === '/' && (method === 'GET' || method === 'HEAD')) {
      return json({ kit: KIT_NAME, version: KIT_VERSION, parts: KIT_PARTS });
    }

    if (path.startsWith('/admin/mugen/')) {
      if (!(await sameSecret(request.headers.get('x-admin-key') || '', env && env.ADMIN_KEY))) {
        return json({ error: 'forbidden' }, 403);
      }
      if (!HAS_BODY.has(method)) return toLadder(env, request);
      const body = await readCapped(request);
      if (body instanceof Response) return body;
      return toLadder(env, request, body.text);
    }

    if (LADDER_ROUTES.has(path)) {
      const limit = LADDER_ROUTES.get(path);
      const applies = limit && limit.method === method;
      if (!HAS_BODY.has(method)) {
        if (applies) {
          // /me without a name is the Ladder's 400 noname, and not counted.
          const name = url.searchParams.get('name') || '';
          if (name && over(limit.rule, request, name)) return json({ ok: false, reason: 'ratelimited' }, 429);
        }
        return toLadder(env, request);
      }
      const body = await readCapped(request);
      if (body instanceof Response) return body;
      if (applies && over(limit.rule, request, body.data.name)) return json({ ok: false, reason: 'ratelimited' }, 429);
      return toLadder(env, request, body.text);
    }

    return json({ error: 'notfound' }, 404);
  }

  return {
    async fetch(request, env) {
      try {
        return await route(request, env || {});
      } catch {
        return json({ ok: false, reason: 'server' }, 500);
      }
    },
  };
}
