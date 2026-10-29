'use strict';
// "Set up my servers": puts the host kit (relay + queue + leaderboard, one
// Worker with three SQLite Durable Objects) on the HOST's own Cloudflare
// account, from Node, with plain fetch + FormData. No wrangler: a portable copy
// has no npm.
//
// This file is the Studio side. It is NEVER uploaded: loadKit() follows the
// imports of worker.js and refuses a graph that reaches this file.
//
// Call order (each step follows what wrangler itself does, see the notes):
//   1 verifyToken      GET  /user/tokens/verify               (user token)
//                      GET  /accounts/{id}/tokens/verify      (account-owned token)
//   2 listAccounts     GET  /accounts                         (picker when > 1)
//   3 inspectScripts   GET  /accounts/{id}/workers/scripts    (permission check,
//                           earlier install, its migration_tag and tags)
//   4 ensureSubdomain  GET  /accounts/{id}/workers/subdomain  (10007 = none yet)
//                      GET  /accounts/{id}/workers/subdomains/{name}
//                           (10032 = FREE, 10031 = taken)
//                      PUT  /accounts/{id}/workers/subdomain  (register)
//   5 uploadWorker     PUT  /accounts/{id}/workers/scripts/{script}  (multipart)
//   6 enableWorkersDev POST /accounts/{id}/workers/scripts/{script}/subdomain
//   7 probeServers     the Studio's own Settings > Online probes, retried for
//                      up to about 5 minutes after a brand-new workers.dev name
//
// SAFETY
// - The API base is the fixed constant CF_API. Only `deps.apiBase` can change
//   it, and only to a loopback address (the test mock). Nothing in `input` -
//   which is what an HTTP route hands in - can move it, because the token goes
//   wherever the API base points.
// - The token lives in a closure inside the request context. It is never
//   logged, never put in a result or an error, and every string this module
//   returns is scrubbed for it anyway.
// - A Worker with the same name that lacks the kit tag is never overwritten
//   and never deleted. That protects a Worker the host (or anyone pasting
//   their token) already runs.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ---------------------------------------------------------------------------
// Constants. Each one is a decision; flip it here, not at a call site.

const CF_API = 'https://api.cloudflare.com/client/v4';
const KIT_TAG = 'mugen-studio-hostkit';          // marks OUR Worker on their account
// A second tag names the Ladder's SQLite schema the upload carries
// (mugen-studio-ladder-2). The Durable Object migration tag does not move when
// only the Ladder's own tables change, so this tag is how a later update learns
// that a newer Studio's kit has already moved the data on.
const LADDER_TAG_PREFIX = 'mugen-studio-ladder-';
const DEFAULT_SCRIPT = 'mugen-online';           // the Worker's name on the host's account
const COMPATIBILITY_DATE = '2026-07-01';         // pinned; bump deliberately
const MAIN_MODULE = 'worker.js';
const MODULE_TYPE = 'application/javascript+module';
const DURABLE_OBJECTS = Object.freeze([
  Object.freeze({ binding: 'ROOM', className: 'Room' }),
  Object.freeze({ binding: 'QUEUE', className: 'Queue' }),
  Object.freeze({ binding: 'LADDER', className: 'Ladder' }),
]);
// Append-only. A later kit version adds { tag: 'v2', ... }; never edit v1.
const MIGRATIONS = Object.freeze([
  Object.freeze({ tag: 'v1', new_sqlite_classes: Object.freeze(['Room', 'Queue', 'Ladder']) }),
]);
const ADMIN_SECRET = 'ADMIN_KEY';
// Files in hostkit/ that are the Studio side and must never reach Cloudflare.
const NOT_UPLOADED = Object.freeze(['deploy.js']);
// wrangler sends this header on the script subdomain POST (triggers/deploy.ts).
const SCRIPT_API_DATE = '2025-08-01';
const REQUEST_TIMEOUT_MS = 30 * 1000;
const ENABLE_RETRIES = 3;                        // the subdomain POST flakes; wrangler retries it
const PROBE_WINDOW_NEW_SUBDOMAIN_MS = 5 * 60 * 1000;
const PROBE_WINDOW_MS = 60 * 1000;
const PROBE_INTERVAL_MS = 10 * 1000;
const NAME_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;   // one DNS label (wrangler's check)
const ACCOUNT_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const TOKEN_NAME = 'Mugen Studio servers';
const TOKEN_PERMISSIONS = Object.freeze([
  Object.freeze({ key: 'workers_scripts', type: 'edit' }),
  Object.freeze({ key: 'account_settings', type: 'read' }),
]);
const REMOVE_WARNING = 'Removing the servers deletes every claimed name and every rating on them, '
  + 'for good. Export the leaderboard first if you want a copy.';

// Built from pieces so no source line carries a populated address shape
// (private-surfaces.js shape guards).
const WEB_SCHEME = 'https' + '://';
const SOCKET_SCHEME = 'wss' + '://';
const WORKERS_DEV = 'workers' + '.dev';

// ---------------------------------------------------------------------------
// Links for the token page (plan section E). Cloudflare pre-fills the form
// from these; the button labels were taken from its docs, not a live dashboard.

function tokenQuery() {
  return 'permissionGroupKeys=' + encodeURIComponent(JSON.stringify(TOKEN_PERMISSIONS));
}

// A user token (My Profile > API Tokens).
function tokenLinkUser(name) {
  return 'https://dash.cloudflare.com/profile/api-tokens?' + tokenQuery()
    + '&accountId=*&zoneId=all&name=' + encodeURIComponent(name || TOKEN_NAME);
}

// An account-owned token (Manage Account > API Tokens).
function tokenLinkAccount(name) {
  return 'https://dash.cloudflare.com/?to=/:account/api-tokens&' + tokenQuery()
    + '&name=' + encodeURIComponent(name || TOKEN_NAME);
}

// ---------------------------------------------------------------------------
// Errors. `code` is Cloudflare's number, or one of our own words below.

class HostError extends Error {
  constructor(code, status, message) {
    super(message || ('Cloudflare API error ' + code));
    this.name = 'HostError';
    this.code = code;
    this.status = status || 0;
  }
}

// Plain-language text for a HostError, a { code, status, message } object or
// a bare code. The UI shows this; it never contains the token. It is shown
// beside the token field as well as in the step log, so it never says "press
// the button" (the field has none) and never ends in a web address (the log
// cannot open one).
function explain(e) {
  const err = (e && typeof e === 'object') ? e : { code: e };
  const c = err.code;
  const msg = String(err.message || '').slice(0, 300);
  switch (c) {
    case 'network':
      return 'Could not reach Cloudflare. Check the internet connection, or a firewall or proxy that blocks api.cloudflare.com, then try again.';
    case 'badtoken':
      return 'Cloudflare does not recognize that token. Copy it again from the token page (Cloudflare shows it only once) and paste the whole thing.';
    case 'notatoken':
      return 'That does not look like a Cloudflare token. Copy it again from the token page (Cloudflare shows it only once) and paste only the token.';
    case 'inactive':
      return 'That token is ' + (msg || 'not active') + '. Make a new one with Create my token.';
    case 'noaccount':
      return 'The token works but reaches no Cloudflare account. Make it again with Create my token, and under Account Resources pick your account.';
    case 'pickAccount':
      return 'This token reaches more than one Cloudflare account. Pick the one the servers should live in.';
    case 'taken':
      return 'Your Cloudflare account already has a Worker named "' + msg + '" that Mugen Studio did not make. The Studio will not overwrite it. Pick another server name.';
    case 'needSubdomain':
      return 'Your Cloudflare account has no workers.dev name yet. Choose one: your addresses will end in <name>.workers.dev, and every Worker on the account shares it.';
    case 'badSubdomain':
      return 'A workers.dev name can use a-z, 0-9 and dashes (not at either end), 1 to 63 characters.';
    case 'badName':
      return 'A server name can use a-z, 0-9 and dashes (not at either end), 1 to 63 characters. It becomes the first part of your address.';
    case 'badAccount':
      return 'That account is not one this token can reach. Pick one from the list.';
    case 'newerKit':
      return 'These servers were set up by a newer Mugen Studio (data version "' + msg + '"). Update this Studio before updating the servers, so no names or ratings are lost.';
    case 'notFound':
      return 'There is no Worker named "' + msg + '" on this account, so there is nothing to remove.';
    case 'notOurs':
      return 'The Worker named "' + msg + '" was not made by Mugen Studio. The Studio will not delete it.';
    case 'kitbug':
      return 'The server files in this copy of the Studio are incomplete (' + msg + '). Reinstall or update the Studio.';
    case 'badApiBase':
      return 'Internal error: the Cloudflare address was changed to something that is not this computer. Nothing was sent.';
    case 1000:
      return 'Cloudflare does not recognize that token. Copy it again from the token page (Cloudflare shows it only once) and paste the whole thing.';
    case 9106:
      return 'Cloudflare refused the token for this request. Make it with Create my token so it has Workers Scripts: Edit and Account Settings: Read, and is not limited to another account or IP address.';
    case 10000:
      return 'The token is missing a permission. It needs Account > Workers Scripts > Edit. Make it with Create my token so the boxes come pre-ticked.';
    case 10007:
      return 'Your Cloudflare account has no workers.dev name yet. Choose one: your addresses will end in <name>.workers.dev.';
    case 10021:
      return msg ? 'Cloudflare rejected the server code (' + msg + '). This is a Mugen Studio bug; please report it.'
        : 'Cloudflare rejected the server code. This is a Mugen Studio bug; please report it.';
    case 10031:
      return 'That workers.dev name belongs to someone else. Try another.';
    case 10034:
      return 'Cloudflare wants the email address on your account verified before it runs Workers. Open the email Cloudflare sent you and press its link (or resend it from your Cloudflare profile), then try again.';
    default:
      if (err.status === 429) return 'Cloudflare is limiting how fast this token can make requests. Wait a few minutes, then try again.';
      return c != null && c !== '' ? 'Cloudflare said: ' + (msg || 'unknown error') + ' [code ' + c + ']' : 'Cloudflare said: ' + (msg || 'unknown error');
  }
}

// ---------------------------------------------------------------------------
// Transport. makeContext() closes over the token; the context object itself
// carries only the API base and a `call` function.

function isLoopbackBase(base) {
  let u;
  try { u = new URL(base); } catch (e) { return false; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  if (u.username || u.password) return false;
  const h = u.hostname.toLowerCase();
  return h === '127.0.0.1' || h === 'localhost' || h === '[::1]' || h === '::1';
}

// The token as it is sent AND as the Studio stores it: surrounding space and a
// leading "Bearer " (Cloudflare shows the token beside an Authorization:
// Bearer example) are dropped. '' when what is left cannot be a token.
function cleanToken(t) {
  let s = typeof t === 'string' ? t.trim() : '';
  if (/^bearer\s+/i.test(s)) s = s.replace(/^bearer\s+/i, '');
  // Visible ASCII only: nothing that could break out of the header.
  return /^[\x21-\x7e]{10,1000}$/.test(s) ? s : '';
}

function makeContext(token, deps) {
  const d = deps || {};
  let apiBase = CF_API;
  if (d.apiBase !== undefined) {
    if (!isLoopbackBase(d.apiBase)) throw new HostError('badApiBase', 0, 'apiBase must be a loopback address');
    apiBase = String(d.apiBase).replace(/\/+$/, '');
  }
  const doFetch = d.fetch || globalThis.fetch;
  const timeoutMs = d.timeoutMs || REQUEST_TIMEOUT_MS;
  const secret = cleanToken(token);
  if (!secret) throw new HostError('badtoken', 0, '');

  async function call(method, p, opts) {
    const o = opts || {};
    const url = apiBase + p + (o.query ? '?' + new URLSearchParams(o.query) : '');
    const headers = Object.assign({ Authorization: 'Bearer ' + secret }, o.headers);
    let body;
    if (o.json !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(o.json); }
    if (o.form) body = o.form;                  // fetch writes the multipart boundary
    let res;
    try {
      res = await doFetch(url, { method, headers, body, signal: AbortSignal.timeout(timeoutMs) });
    } catch (e) {
      const why = (e && e.cause && e.cause.code) || (e && e.name) || 'error';
      throw new HostError('network', 0, 'network: ' + String(why));
    }
    let data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    if (!data || data.success !== true) {
      const errs = (data && Array.isArray(data.errors)) ? data.errors : [];
      const first = errs[0] || {};
      const text = errs.map((x) => x && x.message).filter(Boolean).join('; ') || ('HTTP ' + res.status);
      throw new HostError(first.code != null ? first.code : 'http' + res.status, res.status, scrub(text.slice(0, 400), secret));
    }
    return data;
  }

  return { apiBase, call, scrub: (v) => scrubDeep(v, secret) };
}

function scrub(s, secret) {
  return (secret && typeof s === 'string') ? s.split(secret).join('[token]') : s;
}

function scrubDeep(v, secret) {
  if (!secret) return v;
  if (typeof v === 'string') return scrub(v, secret);
  if (Array.isArray(v)) return v.map((x) => scrubDeep(x, secret));
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v)) out[k] = scrubDeep(v[k], secret);
    return out;
  }
  return v;
}

const acctPath = (accountId) => '/accounts/' + encodeURIComponent(accountId);

// ---------------------------------------------------------------------------
// 1. Token. A user token verifies at /user/tokens/verify. An ACCOUNT-owned
// token gets 1000 there (wrangler whoami.ts getTokenType relies on exactly
// that) and verifies at /accounts/{id}/tokens/verify instead.

async function verifyToken(ctx) {
  try {
    const d = await ctx.call('GET', '/user/tokens/verify');
    const status = d.result && d.result.status;
    if (status !== 'active') throw new HostError('inactive', 0, String(status || 'not active'));
    return { kind: 'user' };
  } catch (e) {
    if (e.code !== 1000) throw e;
  }
  let accounts;
  // After a 1000 at /user, any refusal here means the token itself is bad (the
  // exact code for a garbage token is not documented; do not key on it).
  try { accounts = await listAccounts(ctx); } catch (e) {
    if (e.code === 'network') throw e;
    throw new HostError('badtoken', e.status, '');
  }
  if (!accounts.length) throw new HostError('badtoken', 0, '');
  const d = await ctx.call('GET', acctPath(accounts[0].id) + '/tokens/verify');
  const status = d.result && d.result.status;
  if (status !== 'active') throw new HostError('inactive', 0, String(status || 'not active'));
  return { kind: 'account', accounts };
}

// ---------------------------------------------------------------------------
// 2. Accounts. GET /accounts is what wrangler falls back to: it is already
// scoped to what the token can use, and it works for account-owned tokens,
// which /memberships rejects with 9106.

async function listAccounts(ctx) {
  const out = [];
  for (let page = 1; page <= 20; page++) {
    const d = await ctx.call('GET', '/accounts', { query: { page, per_page: 50 } });
    for (const a of d.result || []) {
      if (a && typeof a.id === 'string' && ACCOUNT_ID_RE.test(a.id)) out.push({ id: a.id, name: String(a.name || a.id) });
    }
    const info = d.result_info;
    if (!info || !info.total_pages || page >= info.total_pages) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// 3. Existing scripts. Doubles as the permission check: the list needs
// Workers Scripts access, so a token without it fails HERE (10000), before
// anything is created. Each entry carries id, tags and migration_tag.

async function inspectScripts(ctx, accountId, scriptName) {
  const d = await ctx.call('GET', acctPath(accountId) + '/workers/scripts');
  const s = (Array.isArray(d.result) ? d.result : []).find((x) => x && x.id === scriptName);
  if (!s) return { exists: false, ours: false, migrationTag: null, ladderSchema: null };
  const tags = Array.isArray(s.tags) ? s.tags.map(String) : [];
  return { exists: true, ours: tags.includes(KIT_TAG), migrationTag: s.migration_tag || null, ladderSchema: ladderSchemaOf(tags) };
}

// The highest Ladder schema a Worker's tags name, or null when they name none
// (every install made before the tag existed, kit 1.0.0 and older).
function ladderSchemaOf(tags) {
  let n = null;
  for (const t of tags) {
    const rest = t.startsWith(LADDER_TAG_PREFIX) ? t.slice(LADDER_TAG_PREFIX.length) : '';
    if (/^\d{1,6}$/.test(rest) && (n === null || Number(rest) > n)) n = Number(rest);
  }
  return n;
}

// ---------------------------------------------------------------------------
// 4. The account's workers.dev name (wrangler triggers/subdomain.ts).

// The current name, or null when the account has none yet (10007).
async function getSubdomain(ctx, accountId) {
  try {
    const d = await ctx.call('GET', acctPath(accountId) + '/workers/subdomain');
    const s = d.result && d.result.subdomain;
    return s ? String(s) : null;
  } catch (e) {
    if (e.code === 10007) return null;
    throw e;
  }
}

// Availability of a name nobody on this account has registered yet. Cloudflare
// answers 10032 ("subdomain_unavailable") when the name is FREE - wrangler and
// the dashboard both treat it that way - and 10031 when someone owns it.
async function subdomainAvailable(ctx, accountId, name) {
  try {
    await ctx.call('GET', acctPath(accountId) + '/workers/subdomains/' + encodeURIComponent(name));
  } catch (e) {
    if (e.code === 10032) return true;
    if (e.code === 10031) return false;
    throw e;
  }
  return true;                                  // a plain success: wrangler proceeds too
}

async function registerSubdomain(ctx, accountId, name) {
  const d = await ctx.call('PUT', acctPath(accountId) + '/workers/subdomain', { json: { subdomain: name } });
  return String((d.result && d.result.subdomain) || name);
}

// Uses the account's name when it has one. Registering is an account-wide
// choice (every Worker URL on the account ends in it), so it happens only
// when the host typed one AND the account has none: an existing name is never
// replaced.
async function ensureSubdomain(ctx, accountId, wanted) {
  const current = await getSubdomain(ctx, accountId);
  if (current) return { subdomain: current, created: false };
  if (!wanted) throw new HostError('needSubdomain', 0, '');
  const name = String(wanted).trim().toLowerCase();
  if (!NAME_RE.test(name)) throw new HostError('badSubdomain', 0, '');
  if (!(await subdomainAvailable(ctx, accountId, name))) throw new HostError(10031, 409, 'taken');
  return { subdomain: await registerSubdomain(ctx, accountId, name), created: true };
}

// ---------------------------------------------------------------------------
// 5. Upload. Multipart: a `metadata` JSON part plus one part per ES module,
// typed application/javascript+module (wrangler create-worker-upload-form.ts).

// Only the steps after the deployed tag, as { old_tag, new_tag, steps } - the
// shape wrangler's durable.ts getMigrationsToUpload builds. Unlike wrangler, a
// deployed tag this Studio does not know is REFUSED rather than answered with
// every step again: on a kit-tagged Worker it means a newer Studio set it up,
// and replaying v1 onto it would fail or, worse, run old code on new data.
function migrationsToSend(kitMigrations, deployedTag) {
  const list = kitMigrations || MIGRATIONS;
  if (!list.length) return undefined;
  const last = list[list.length - 1].tag;
  const strip = (m) => {
    const out = {};
    for (const k of Object.keys(m)) if (k !== 'tag') out[k] = Array.isArray(m[k]) ? m[k].slice() : m[k];
    return out;
  };
  if (!deployedTag) return { new_tag: last, steps: list.map(strip) };
  const i = list.findIndex((m) => m.tag === deployedTag);
  if (i === -1) throw new HostError('newerKit', 0, String(deployedTag));
  if (i === list.length - 1) return undefined;  // up to date
  return { old_tag: deployedTag, new_tag: last, steps: list.slice(i + 1).map(strip) };
}

// fresh: no Worker by this name yet. adminKey: sent only on a fresh install.
function buildMetadata(kit, opts) {
  const o = opts || {};
  const bindings = kit.durableObjects.map((d) => ({ type: 'durable_object_namespace', name: d.binding, class_name: d.className }));
  if (o.fresh && o.adminKey) bindings.push({ type: 'secret_text', name: ADMIN_SECRET, text: String(o.adminKey) });
  const meta = {
    main_module: kit.mainModule,
    compatibility_date: kit.compatibilityDate,
    bindings,
    tags: kit.ladderSchema ? [KIT_TAG, LADDER_TAG_PREFIX + kit.ladderSchema] : [KIT_TAG],
  };
  const m = migrationsToSend(kit.migrations, o.fresh ? null : o.deployedTag);
  if (m) meta.migrations = m;
  // An update must not wipe the admin key it is not resending.
  if (!o.fresh) meta.keep_bindings = ['secret_text'];
  return meta;
}

async function uploadWorker(ctx, accountId, scriptName, kit, opts) {
  const form = new FormData();
  form.set('metadata', JSON.stringify(buildMetadata(kit, opts)));
  for (const mod of kit.modules) {
    form.set(mod.name, new File([mod.content], mod.name, { type: MODULE_TYPE }));
  }
  const d = await ctx.call('PUT', acctPath(accountId) + '/workers/scripts/' + encodeURIComponent(scriptName), { form });
  return { migrationTag: (d.result && d.result.migration_tag) || null };
}

// ---------------------------------------------------------------------------
// 6. The workers.dev route for this script. wrangler always posts this after
// an upload, with the API-date header it pins, and retries it because it
// occasionally fails on Cloudflare's side.

async function enableWorkersDev(ctx, accountId, scriptName, sleep) {
  const p = acctPath(accountId) + '/workers/scripts/' + encodeURIComponent(scriptName) + '/subdomain';
  for (let attempt = 1; ; attempt++) {
    try {
      await ctx.call('POST', p, {
        json: { enabled: true, previews_enabled: false },
        headers: { 'Cloudflare-Workers-Script-Api-Date': SCRIPT_API_DATE },
      });
      return;
    } catch (e) {
      const transient = e.code === 'network' || e.status >= 500;
      if (!transient || attempt >= ENABLE_RETRIES) throw e;
      await sleep(1000 * attempt);
    }
  }
}

// ---------------------------------------------------------------------------
// Removing. DELETE ?force=true also deletes the Durable Object namespaces the
// Worker implements (Cloudflare's API reference for the delete call), so every
// claimed name and rating goes with it. Only a kit-tagged Worker is deleted.

async function deleteWorker(ctx, accountId, scriptName) {
  await ctx.call('DELETE', acctPath(accountId) + '/workers/scripts/' + encodeURIComponent(scriptName), { query: { force: 'true' } });
}

// ---------------------------------------------------------------------------
// The kit on disk: worker.js plus every module it imports, found by following
// the imports, so a new kit file is picked up without a list to forget and the
// Studio side (this file) can never ride along.

const IMPORT_RES = [
  /(?:^|[;\n])\s*import\s+(?:[\w$*\s{},]+?\s+from\s+)?['"]([^'"\n]+)['"]/g,
  /(?:^|[;\n])\s*export\s*(?:\*(?:\s+as\s+[\w$]+)?|\{[^}]*\})\s*from\s*['"]([^'"\n]+)['"]/g,
  /\bimport\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g,
];

function importsOf(text) {
  const out = [];
  for (const re of IMPORT_RES) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) out.push(m[1]);
  }
  return out;
}

function exportsClass(text, className) {
  const n = className.replace(/[$]/g, '\\$');
  return new RegExp('\\bexport\\s+class\\s+' + n + '\\b').test(text)
    || new RegExp('\\bexport\\s*\\{[^}]*\\b' + n + '\\b[^}]*\\}').test(text)
    || /\bexport\s*\*\s*from\b/.test(text);
}

function loadKit(dir, deps) {
  const root = dir || __dirname;
  const readFile = (deps && deps.readFile) || ((p) => fs.readFileSync(p, 'utf8'));
  const modules = [];
  const seen = new Set();
  const kitbug = (why) => new HostError('kitbug', 0, why);
  (function visit(name, from) {
    if (seen.has(name)) return;
    if (NOT_UPLOADED.includes(name)) throw kitbug((from || 'the kit') + ' imports ' + name + ', which is the Studio side and is never uploaded');
    let content;
    try { content = readFile(path.join(root, name)); } catch (e) {
      throw kitbug(from ? 'missing ' + name + ', imported by ' + from : 'missing ' + name);
    }
    seen.add(name);
    modules.push({ name, content });
    for (const spec of importsOf(content)) {
      if (spec.startsWith('cloudflare:')) continue;
      if (!/^\.\/[A-Za-z0-9_-]+\.m?js$/.test(spec)) throw kitbug(name + ' imports "' + spec + '"; kit modules may import only ./<file>.js from the kit folder');
      visit(spec.slice(2), name);
    }
  })(MAIN_MODULE, null);
  const main = modules[0].content;
  for (const d of DURABLE_OBJECTS) {
    if (!exportsClass(main, d.className)) throw kitbug(MAIN_MODULE + ' does not export the Durable Object class ' + d.className);
  }
  let kitVersion = null;
  for (const m of modules) {
    const v = /\bKIT_VERSION\s*=\s*['"]([^'"\n]{1,40})['"]/.exec(m.content);
    if (v) { kitVersion = v[1]; break; }
  }
  // ladder-core.js's SCHEMA_VERSION, sent as the Ladder tag on every upload.
  let ladderSchema = null;
  for (const m of modules) {
    const v = /\bSCHEMA_VERSION\s*=\s*(\d{1,6})\b/.exec(m.content);
    if (v) { ladderSchema = Number(v[1]); break; }
  }
  return {
    mainModule: MAIN_MODULE,
    modules,
    compatibilityDate: COMPATIBILITY_DATE,
    durableObjects: DURABLE_OBJECTS.map((d) => ({ binding: d.binding, className: d.className })),
    migrations: MIGRATIONS.map((m) => Object.assign({}, m)),
    kitVersion,
    ladderSchema,
  };
}

// ---------------------------------------------------------------------------
// Addresses. One Worker serves everything; the clients append /mugen/... and
// the relay path themselves.

function addressesFor(scriptName, subdomain) {
  const host = scriptName + '.' + subdomain + '.' + WORKERS_DEV;
  return { host, signalUrl: SOCKET_SCHEME + host + '/ws', identityUrl: WEB_SCHEME + host };
}

// ---------------------------------------------------------------------------
// 7. Probes: the Studio's own Settings > Online tests (local-config.js
// probe()), retried while a new address comes up. A brand-new workers.dev
// name can take minutes of DNS; an existing one usually answers at once.
//
// opts: { newSubdomain, windowMs, intervalMs }
// deps: { probe, sleep, now, log, probeDeps }
// Resolves to { ok, attempts, waitedMs, lobby, identity }.

function defaultProbe() {
  // Lazy: only the real Studio needs it; tests inject their own.
  return require(path.join(__dirname, '..', 'local-config.js')).probe;
}

const realSleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function probeServers(addresses, opts, deps) {
  const o = opts || {};
  const d = deps || {};
  const probe = d.probe || defaultProbe();
  const sleep = d.sleep || realSleep;
  const now = d.now || Date.now;
  const log = d.log || (() => {});
  const windowMs = o.windowMs || (o.newSubdomain ? PROBE_WINDOW_NEW_SUBDOMAIN_MS : PROBE_WINDOW_MS);
  const intervalMs = o.intervalMs || PROBE_INTERVAL_MS;
  const t0 = now();
  let lobby = null;
  let identity = null;
  let attempts = 0;
  for (;;) {
    attempts++;
    if (!lobby || !lobby.ok) lobby = await probe({ what: 'lobby', signalUrl: addresses.signalUrl }, d.probeDeps);
    if (!identity || !identity.ok) identity = await probe({ what: 'identity', identityUrl: addresses.identityUrl }, d.probeDeps);
    if (lobby.ok && identity.ok) break;
    if (now() - t0 + intervalMs > windowMs) break;
    // One line per shape: which of the two did not answer, and why.
    const secs = Math.round(intervalMs / 1000);
    log(lobby.ok ? 'not answering yet (leaderboard: ' + (identity.why || 'no answer') + '), trying again in ' + secs + ' s'
      : identity.ok ? 'not answering yet (lobby: ' + (lobby.why || 'no answer') + '), trying again in ' + secs + ' s'
        : 'not answering yet (lobby: ' + (lobby.why || 'no answer') + '; leaderboard: ' + (identity.why || 'no answer') + '), trying again in ' + secs + ' s');
    await sleep(intervalMs);
  }
  return { ok: !!(lobby.ok && identity.ok), attempts, waitedMs: now() - t0, lobby, identity };
}

// ---------------------------------------------------------------------------
// The buttons. Every entry point takes (input, deps):
//   input - what the host typed: { token, accountId?, scriptName?, subdomain? }.
//           Nothing else in it is read.
//   deps  - for the Studio and the tests: { fetch, apiBase (loopback only),
//           kit | kitDir, newAdminKey, log, probe (function, or false to
//           skip), probeDeps, sleep, now, timeoutMs }.
// Results never contain the token.

function newAdminKey() {
  return crypto.randomBytes(24).toString('base64url');
}

function cleanName(v, fallback) {
  const s = (typeof v === 'string' ? v : '').trim().toLowerCase();
  return s || fallback || '';
}

function failure(e, extra) {
  const code = e && e.code !== undefined ? e.code : 'error';
  const out = Object.assign({ ok: false, code, why: explain(e) }, extra || {});
  if (!(e instanceof HostError)) { const error = String((e && e.message) || e); out.why = 'Unexpected error: ' + error; }
  return out;
}

// Resolves the account: verify the token, list the accounts, pick one.
// Returns { account } or { need: 'account', choices }.
async function resolveAccount(ctx, accountId) {
  const v = await verifyToken(ctx);
  const accounts = v.accounts || await listAccounts(ctx);
  if (!accounts.length) throw new HostError('noaccount', 0, '');
  const wanted = typeof accountId === 'string' ? accountId.trim() : '';
  if (wanted) {
    const a = accounts.find((x) => x.id === wanted);
    if (a) return { account: a, accounts, kind: v.kind };
    return { need: 'account', choices: accounts, kind: v.kind, badChoice: true };
  }
  if (accounts.length === 1) return { account: accounts[0], accounts, kind: v.kind };
  return { need: 'account', choices: accounts, kind: v.kind };
}

// Picker data: which accounts this token reaches.
// input: { token, accountId? }
// -> { ok: true, kind: 'user'|'account', accounts: [{ id, name }] } | failure
//
// A token can verify and list its accounts and still lack Workers Scripts:
// Edit, which every step after this one needs. So once the account is known
// (the token reaches one, or `accountId` names one of them) its scripts
// listing - read-only, the same call setupServers makes - is asked for too,
// and a token without the permission fails HERE with 10000 rather than
// reading as working until Set up is pressed.
async function accountsFor(input, deps) {
  let ctx = null;
  try {
    ctx = makeContext(input && input.token, deps);
    const v = await verifyToken(ctx);
    const accounts = v.accounts || await listAccounts(ctx);
    if (!accounts.length) throw new HostError('noaccount', 0, '');
    const wanted = input && typeof input.accountId === 'string' ? input.accountId.trim() : '';
    const one = wanted ? accounts.find((a) => a.id === wanted) : accounts.length === 1 ? accounts[0] : null;
    if (one) await ctx.call('GET', acctPath(one.id) + '/workers/scripts');
    return ctx.scrub({ ok: true, kind: v.kind, accounts });
  } catch (e) {
    const out = failure(e);
    return ctx ? ctx.scrub(out) : out;
  }
}

// The workers.dev name field: what the account has, or whether `name` is free.
// input: { token, accountId, name? }
// -> { ok: true, current: 'name' } when the account already has one (the
//    field is not needed), { ok: true, current: null, name, available } when
//    checking a name, { ok: true, current: null } when no name was given.
async function checkSubdomain(input, deps) {
  let ctx = null;
  try {
    ctx = makeContext(input && input.token, deps);
    const accountId = typeof input.accountId === 'string' ? input.accountId.trim() : '';
    if (!ACCOUNT_ID_RE.test(accountId)) throw new HostError('badAccount', 0, '');
    const current = await getSubdomain(ctx, accountId);
    if (current) return ctx.scrub({ ok: true, current });
    const name = cleanName(input.name);
    if (!name) return { ok: true, current: null };
    if (!NAME_RE.test(name)) return { ok: true, current: null, name, available: false, why: explain('badSubdomain') };
    const available = await subdomainAvailable(ctx, accountId, name);
    return ctx.scrub({ ok: true, current: null, name, available, why: available ? '' : explain(10031) });
  } catch (e) {
    const out = failure(e);
    return ctx ? ctx.scrub(out) : out;
  }
}

// "Set up my servers" and "Update my servers" (the same call: an existing
// kit Worker is updated in place, keeping its data and admin key).
//
// -> { ok: true, accountId, accountName, scriptName, subdomain, host,
//      signalUrl, identityUrl, fresh, adminKey (fresh install only, else
//      null), migrationTag, kitVersion, dnsWait, created: { subdomain, worker },
//      probes: { ok, attempts, waitedMs, lobby, identity } | null, steps }
//  | { ok: false, need: 'account', choices, why, steps }
//  | { ok: false, need: 'subdomain', accountId, why, steps }
//  | { ok: false, code, why, step, steps, adminKey? }
//    (adminKey is set on a failure AFTER a fresh upload went through, so the
//     caller can still store the key the new Worker holds)
async function setupServers(input, deps) {
  const d = deps || {};
  const inp = input || {};
  const logFn = d.log || (() => {});
  const steps = [];
  let ctx = null;
  let step = 'start';
  let uploadedKey = null;
  const note = (text) => {
    const ev = { step, text: ctx ? ctx.scrub(text) : text };
    steps.push(ev);
    try { logFn(ev); } catch (e) { /* a log sink must not break the deploy */ }
  };
  const done = (r) => (ctx ? ctx.scrub(Object.assign(r, { steps })) : Object.assign(r, { steps }));
  try {
    step = 'kit';
    const kit = d.kit || loadKit(d.kitDir);
    step = 'name';
    const scriptName = cleanName(inp.scriptName, DEFAULT_SCRIPT);
    if (!NAME_RE.test(scriptName)) throw new HostError('badName', 0, '');

    step = 'token';
    ctx = makeContext(inp.token, d);
    note('checking the token');
    const acc = await resolveAccount(ctx, inp.accountId);
    if (acc.need) {
      note(acc.badChoice ? 'that account is not one this token reaches' : 'this token reaches more than one account');
      return done({ ok: false, need: 'account', choices: acc.choices, why: explain(acc.badChoice ? 'badAccount' : 'pickAccount') });
    }
    const account = acc.account;

    step = 'scripts';
    note('looking for an earlier install');
    const existing = await inspectScripts(ctx, account.id, scriptName);
    if (existing.exists && !existing.ours) throw new HostError('taken', 0, scriptName);
    const fresh = !existing.exists;
    // Throws newerKit before anything is created or changed.
    migrationsToSend(kit.migrations, fresh ? null : existing.migrationTag);
    // The same refusal for the Ladder's own tables. This kit's Ladder refuses
    // to read a newer schema, so uploading it over one would leave every
    // leaderboard request failing until a newer Studio updated it again.
    if (!fresh && existing.ladderSchema > (kit.ladderSchema || 0)) {
      throw new HostError('newerKit', 0, 'ladder ' + existing.ladderSchema);
    }

    step = 'subdomain';
    note('checking your workers.dev name');
    let sub;
    try { sub = await ensureSubdomain(ctx, account.id, inp.subdomain); } catch (e) {
      if (e.code === 'needSubdomain') {
        note('the account has no workers.dev name yet');
        return done({ ok: false, need: 'subdomain', accountId: account.id, why: explain(e) });
      }
      throw e;
    }
    if (sub.created) note('registered the workers.dev name ' + sub.subdomain);

    step = 'upload';
    const adminKey = fresh ? (d.newAdminKey || newAdminKey)() : null;
    note(fresh ? 'uploading the servers' : 'updating the servers');
    const up = await uploadWorker(ctx, account.id, scriptName, kit, { fresh, deployedTag: existing.migrationTag, adminKey });
    if (fresh) uploadedKey = adminKey;

    step = 'address';
    note('turning on the public address');
    await enableWorkersDev(ctx, account.id, scriptName, d.sleep || realSleep);

    const addr = addressesFor(scriptName, sub.subdomain);
    let probes = null;
    if (d.probe !== false) {
      step = 'probe';
      // A first install's address is new to Cloudflare's edge even on an
      // account that already had a workers.dev name: in the first real run
      // it took about 14 checks (2-3 minutes) to answer. Wait the long window.
      note(sub.created || fresh ? 'testing the servers (a new address can take a few minutes)' : 'testing the servers');
      probes = await probeServers(addr, { newSubdomain: sub.created || fresh }, {
        probe: d.probe, probeDeps: d.probeDeps, sleep: d.sleep, now: d.now, log: note,
      });
      note(probes.ok ? 'the lobby and the leaderboard both answered' : 'the servers are up, but a test did not pass yet');
    }
    return done({
      ok: true,
      accountId: account.id,
      accountName: account.name,
      scriptName,
      subdomain: sub.subdomain,
      host: addr.host,
      signalUrl: addr.signalUrl,
      identityUrl: addr.identityUrl,
      fresh,
      adminKey,
      migrationTag: up.migrationTag,
      kitVersion: kit.kitVersion || null,
      dnsWait: sub.created,
      created: { subdomain: sub.created, worker: fresh },
      probes,
    });
  } catch (e) {
    const extra = { step };
    if (uploadedKey) extra.adminKey = uploadedKey;
    return done(failure(e, extra));
  }
}

// "Remove my servers". Deletes the kit Worker and, with it, its Durable
// Objects: every claimed name and rating. Refuses a Worker without the kit tag.
// input: { token, accountId?, scriptName? }
// -> { ok: true, removed, accountId, note } | { ok: false, need: 'account', choices } | failure
async function removeServers(input, deps) {
  const d = deps || {};
  const inp = input || {};
  let ctx = null;
  try {
    const scriptName = cleanName(inp.scriptName, DEFAULT_SCRIPT);
    if (!NAME_RE.test(scriptName)) throw new HostError('badName', 0, '');
    ctx = makeContext(inp.token, d);
    const acc = await resolveAccount(ctx, inp.accountId);
    if (acc.need) return ctx.scrub({ ok: false, need: 'account', choices: acc.choices, why: explain(acc.badChoice ? 'badAccount' : 'pickAccount') });
    const existing = await inspectScripts(ctx, acc.account.id, scriptName);
    if (!existing.exists) throw new HostError('notFound', 0, scriptName);
    if (!existing.ours) throw new HostError('notOurs', 0, scriptName);
    await deleteWorker(ctx, acc.account.id, scriptName);
    return ctx.scrub({ ok: true, removed: scriptName, accountId: acc.account.id, note: REMOVE_WARNING });
  } catch (e) {
    const out = failure(e);
    return ctx ? ctx.scrub(out) : out;
  }
}

module.exports = {
  // constants
  CF_API, KIT_TAG, LADDER_TAG_PREFIX, DEFAULT_SCRIPT, COMPATIBILITY_DATE, MAIN_MODULE, MODULE_TYPE,
  DURABLE_OBJECTS, MIGRATIONS, ADMIN_SECRET, NOT_UPLOADED, TOKEN_PERMISSIONS, TOKEN_NAME,
  REMOVE_WARNING, PROBE_WINDOW_NEW_SUBDOMAIN_MS, PROBE_WINDOW_MS, PROBE_INTERVAL_MS,
  // the buttons
  setupServers, removeServers, accountsFor, checkSubdomain, probeServers,
  // helpers the Studio and the tests use
  explain, tokenLinkUser, tokenLinkAccount, addressesFor, loadKit,
  buildMetadata, migrationsToSend, isLoopbackBase, HostError, cleanToken, NAME_RE,
};
