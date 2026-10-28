'use strict';
//
// SETTINGS > ONLINE > PLAYERS: a leaderboard's names and records, managed from
// the Studio.
//
// A host frees a test name, gives a player who lost their recovery code a new
// one, takes someone off the board, fixes a record or starts the ladder over -
// each of which used to mean an admin request typed by hand against the
// leaderboard server. The Studio's server makes those requests (server.js
// POST /api/players); the page says what to do and is never handed the key.
//
// TWO KINDS OF SERVER, ONE LIST OF ROUTES. The host kit (hostkit/, "Set up my
// servers") answers the same admin routes as the reference leaderboard server
// it was ported from, with the same reply shapes:
//
//   GET    /admin/mugen/identity/names             {ok, count, names:[{name, createdAt, lastRecoveredAt, codeResetAt}]}
//   POST   /admin/mugen/identity/name/:name/reset  {ok, name, code} | {ok:false, reason:'invalid'|'unknown'}
//   DELETE /admin/mugen/identity/name/:name        {ok, name}       | {ok:false, reason:'invalid'|'unknown'}
//   DELETE /admin/mugen/leaderboard/player/:name   {ok}             (false: no such row)
//   PATCH  /admin/mugen/leaderboard/player/:name   {ok, name, changed, before, after, tier}
//                                                  | {ok:false, reason:'nosuchplayer'|'badvalue', field}
//   POST   /admin/mugen/leaderboard/reset          {ok, cleared}    (the names stay claimed)
//   GET    /admin/mugen/leaderboard/export         {exported, players:{key: row}, pending:{open, done}, ok}
//   a wrong or missing key                         403 {error:'forbidden'}
//
// What differs lives in ADAPTERS and the few lines that name a kind:
//   - THE KEY. The kit reads it ONLY from the x-admin-key header (router.js,
//     and again in the Ladder); the reference server ONLY from ?key= in the
//     address. So the kit never gets it in a URL, and the other kind gets it
//     where it looks. A server that answers with a redirect is refused, so
//     the key never follows one somewhere else.
//   - HOW IT IS RECOGNIZED. The kit's GET / answers {kit: KIT_NAME}
//     (router.js). The servers this Studio set up are known without asking:
//     the host record's url. Any other address is asked GET / once, and the
//     answer is remembered only when it is a 2xx JSON object. A 5xx, 429 or
//     408 there (a kit's host having a bad minute) stops the call before the
//     key goes anywhere, so a kit having a bad minute is not taken for the
//     other kind and sent its key in a URL. Any other answer (a 404, a web
//     page) is never the kit's own, whose GET / always answers JSON, so that
//     call goes the other kind's way and GET / is asked again next time. A
//     403 forgets what was learned, and so do Test and Forget key.
//   - THE BOARD PICTURE. The reference server can draw a picture of the
//     standings for chat and has an admin route to redraw it. The Studio
//     never calls it: that route renders even while the server's own switch
//     for the picture is off, so a redraw is left to the server.
//   - THE EXPORT. The kit's carries the names too; the reference's does not,
//     and from a damaged store it hands back the raw file (players: null,
//     playersRaw, corrupt: [...]). A backup here is always both replies,
//     names and export, whole. A damaged store cannot be reset by its server,
//     so 'reset' saves the copy and stops there.
//
// A RELEASED NAME TAKES ITS ROW ALONG, UNLESS ASKED NOT TO. A name claim and a
// leaderboard row are separate records on both servers, and a report from a
// name rebuilds (or reuses) the row filed under it. So a name released with
// its row left behind hands that rating and record to whoever claims the name
// next. 'release' with alsoRemove: true (the page's default when the row is
// there) deletes the row first, then releases the name; if the row cannot be
// deleted, the name is not released.
//
// A BACKUP BEFORE A RESET. 'reset' needs the word typed back, then saves both
// replies to a file and reads the file back, and only then asks the server to
// reset. No file, no reset. Backups go to the Downloads folder: the Studio's
// own download folder when one is set (layout.DOWNLOAD_FOLDER) and it is
// outside the program, the bundles and the export folders (server.js
// leaderboardBackupDir), so no build and no copy of the Studio reads them.
//
// THE KEY. Found per address by local-config.js leaderboardKeyFor: one the
// host pasted, which is stored only after the server accepted it ('test'),
// else the host record's adminKey for the servers this Studio set up (so a
// key pasted after those servers were set up again elsewhere wins). No reply
// carries a key or any part of one: the page gets redactLeaderboardKey (set
// or not, and where it came from), and error texts are written here, never
// copied from a fetch error (which can quote a URL, and the reference
// server's URLs carry the key).

const fs = require('fs');
const path = require('path');
const lc = require('./local-config.js');

// router.js GET / answers { kit: <this> } (hostkit/ladder-core.js KIT_NAME).
const KIT_NAME = 'mugen-studio-hostkit';
// A small server that sleeps while nobody plays needs a few seconds to wake.
const TIMEOUT_MS = 20000;
const CONFIRM_WORD = 'reset';
// The names rule both servers hold claims to (3-12 of these characters).
const NAME_RE = /^[A-Za-z0-9_.-]{3,12}$/;
// A leaderboard row is keyed by a claimed name; anything a URL segment can
// carry is passed on, the server decides.
const ROW_RE = /^[^\/\\\x00-\x1f\x7f]{1,40}$/;
// The numbers both servers let an admin correct (their PATCHABLE list).
const EDITABLE = ['rating', 'peakRating', 'wins', 'losses', 'games', 'streak', 'bestStreak'];
const OPS = new Set(['state', 'test', 'forget', 'list', 'newcode', 'release', 'remove', 'edit', 'reset', 'export']);

// address -> 'kit' | 'other', learned once per run of the Studio.
const kinds = new Map();

class PlayersError extends Error {
  constructor(reason, why, extra) {
    super(why);
    this.reason = reason;
    this.why = why;
    this.extra = extra || null;
  }
}

// How the key travels to each kind (see the top of this file).
const ADAPTERS = {
  kit: (base, p, key) => ({ url: base + p, headers: { 'x-admin-key': key } }),
  other: (base, p, key) => ({ url: base + p + (p.includes('?') ? '&' : '?') + 'key=' + encodeURIComponent(key), headers: {} }),
};

// An admin key crosses the internet only over https. Plain http is for a
// server on this computer or the host's own network.
function safeTransport(addr) {
  let x;
  try { x = new URL(addr); } catch (e) { return false; }
  if (x.protocol === 'https:') return true;
  if (x.protocol !== 'http:') return false;
  const h = x.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (h === 'localhost' || h === '127.0.0.1' || h === '::1' || h.endsWith('.localhost')) return true;
  return /^10\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h);
}

function downError(e, timeoutMs) {
  const timedOut = e && (e.name === 'TimeoutError' || e.name === 'AbortError');
  if (timedOut) {
    return new PlayersError('down', 'The leaderboard server did not answer within ' + Math.round(timeoutMs / 1000)
      + ' seconds. A server that sleeps while nobody plays can take a moment to wake: try again.');
  }
  // Only the error's code (ECONNREFUSED, ENOTFOUND): an undici message can
  // quote the URL, and the other kind's URLs carry the key.
  const code = e && e.cause && typeof e.cause.code === 'string' && /^[A-Z_]{2,40}$/.test(e.cause.code) ? e.cause.code : '';
  return new PlayersError('down', code ? 'The leaderboard server did not answer (' + code + '). Check the Leaderboard address above, and that the server is running.'
    : 'The leaderboard server did not answer. Check the Leaderboard address above, and that the server is running.');
}

// Which kind of server is at the address (see the top of this file). Nothing
// here carries the key: GET / is asked with no key at all.
async function kindOf(c) {
  if (c.from === 'servers' || c.ours) return 'kit';
  const known = kinds.get(c.address);
  if (known) return known;
  let res;
  try {
    res = await c.fetch(c.dial + '/', { redirect: 'manual', signal: AbortSignal.timeout(c.timeoutMs) });
  } catch (e) { throw downError(e, c.timeoutMs); }
  const st = res.status;
  let text = '';
  try { text = await res.text(); } catch (e) { text = ''; }
  // A server having a bad minute: the kit's host too can answer like this, so
  // no kind is decided and no key is sent.
  if (st >= 500 || st === 429 || st === 408) {
    throw new PlayersError(st === 429 ? 'busy' : 'server', 'The leaderboard server answered ' + st + '. Try again in a minute.');
  }
  let j = null;
  try { j = JSON.parse(text); } catch (e) { j = null; }
  const isObj = j && typeof j === 'object' && !Array.isArray(j);
  const k = isObj && j.kit === KIT_NAME ? 'kit' : 'other';
  // Remembered only from a 2xx JSON answer. Anything else is never the kit's
  // (its GET / always answers JSON), so this call goes the other way, and the
  // next one asks again.
  if (st >= 200 && st < 300 && isObj) kinds.set(c.address, k);
  return k;
}

// One admin call. Resolves to the reply's JSON object; every failure becomes a
// PlayersError with a sentence for the page.
async function remote(c, method, p, body, timeoutMs) {
  const t = timeoutMs || c.timeoutMs;
  const a = ADAPTERS[c.kind](c.dial, p, c.key);
  const init = { method, headers: Object.assign({}, a.headers), redirect: 'manual', signal: AbortSignal.timeout(t) };
  // A body only where there is one: a JSON content type with no body is a 400
  // on the reference server.
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers['content-type'] = 'application/json';
  }
  let res;
  try { res = await c.fetch(a.url, init); } catch (e) { throw downError(e, t); }
  let text = '';
  try { text = await res.text(); } catch (e) { text = ''; }
  const st = res.status;
  if (st >= 300 && st < 400) {
    throw new PlayersError('redirect', 'The leaderboard server answered with a move to another address. Put its final address in'
      + ' Leaderboard address above: the Studio sends the admin key only to the address it is saved for.');
  }
  if (st === 403) {
    // Asked again next time: a refusal can also mean the kind was wrong.
    kinds.delete(c.address);
    throw new PlayersError('badkey', c.from === 'servers'
      ? 'Your servers refused the admin key this Studio saved when it set them up. If they were set up again from another computer, only that computer has their key.'
      : c.from === 'typed' ? 'The leaderboard server refused that key. Check it and paste it again.'
        : 'The leaderboard server refused the saved admin key. If the key was changed on the server, press Forget key and paste the new one.');
  }
  if (st === 404) {
    throw new PlayersError('noadmin', 'The server at this address has no player admin routes. It may be an older leaderboard server, or not a leaderboard server at all.');
  }
  if (st === 429) throw new PlayersError('busy', 'The leaderboard server says it is too busy. Try again in a minute.');
  if (st >= 500) throw new PlayersError('server', 'The leaderboard server had an error (' + st + '). Try again in a minute.');
  let j = null;
  try { j = JSON.parse(text); } catch (e) { j = null; }
  if (st < 200 || st >= 300) throw new PlayersError('server', 'The leaderboard server answered ' + st + '.');
  if (!j || typeof j !== 'object' || Array.isArray(j)) {
    throw new PlayersError('garbled', 'The leaderboard server answered, but not with anything the Studio can read.');
  }
  return j;
}

const seg = (name) => encodeURIComponent(String(name));

// Whether an export reply says the server could not read its own store:
// players (the standings) and pending (reports waiting for their match).
function damageOf(exp) {
  const corrupt = exp && Array.isArray(exp.corrupt) ? exp.corrupt.map(String) : [];
  const players = !exp || !exp.players || typeof exp.players !== 'object' || Array.isArray(exp.players) || corrupt.includes('players');
  return { any: players || corrupt.length > 0, players, parts: corrupt };
}

// The names and the board, one row per name (claimed, on the board, or both).
function rowsOf(namesReply, exportReply) {
  const byKey = new Map();
  const list = namesReply && Array.isArray(namesReply.names) ? namesReply.names : [];
  for (const n of list) {
    if (!n || typeof n.name !== 'string' || !n.name) continue;
    byKey.set(n.name.toLowerCase(), {
      name: n.name, claimed: true, onBoard: false,
      createdAt: n.createdAt || null, lastRecoveredAt: n.lastRecoveredAt || null, codeResetAt: n.codeResetAt || null,
    });
  }
  const players = exportReply && exportReply.players && typeof exportReply.players === 'object' && !Array.isArray(exportReply.players)
    ? exportReply.players : {};
  for (const k of Object.keys(players)) {
    const p = players[k];
    if (!p || typeof p !== 'object') continue;
    const shown = typeof p.name === 'string' && p.name ? p.name : k;
    const key = String(k).toLowerCase();
    const row = byKey.get(key) || { name: shown, claimed: false, onBoard: false };
    row.onBoard = true;
    for (const f of EDITABLE) { const v = Number(p[f]); row[f] = Number.isFinite(v) ? v : 0; }
    row.lastPlayed = typeof p.lastPlayed === 'string' ? p.lastPlayed : null;
    row.character = typeof p.lastChar === 'string' ? p.lastChar.slice(0, 40) : '';
    byKey.set(key, row);
  }
  return [...byKey.values()].sort((a, b) => (Number(b.onBoard) - Number(a.onBoard))
    || ((b.rating || 0) - (a.rating || 0)) || a.name.localeCompare(b.name));
}

const pad = (n, w) => String(n).padStart(w || 2, '0');
function stampOf(t) {
  const d = new Date(t);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
}
function hostSlug(addr) {
  const x = new URL(addr);
  return (x.hostname.replace(/^\[|\]$/g, '') + (x.port ? '-' + x.port : '')).replace(/[^a-z0-9.-]+/gi, '-');
}

// Both replies to one new file in the backup folder, read back before it
// counts. Resolves to { file, dir, name, names, players }.
async function saveBackup(c, reason) {
  const names = await remote(c, 'GET', '/admin/mugen/identity/names');
  const exp = await remote(c, 'GET', '/admin/mugen/leaderboard/export');
  const doc = {
    savedAt: new Date(c.now()).toISOString(),
    reason,
    leaderboard: c.address,
    server: c.kind === 'kit' ? 'host kit' : 'other',
    names,
    export: exp,
  };
  const text = JSON.stringify(doc, null, 2) + '\n';
  const dir = c.backupDir;
  const refusal = (e) => {
    const why = String((e && (e.code || e.message)) || e);
    return new PlayersError('backup', reason === 'before-reset' ? 'Could not save the copy in ' + dir + ' (' + why + '), so nothing was reset.'
      : 'Could not save the copy in ' + dir + ' (' + why + ').');
  };
  if (!dir) throw refusal(new Error('no folder'));
  try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { throw refusal(e); }
  const base = 'leaderboard-' + hostSlug(c.address) + '-' + stampOf(c.now()) + (reason === 'before-reset' ? '-before-reset' : '');
  let file = null;
  for (let i = 1; i < 100 && !file; i++) {
    const f = path.join(dir, base + (i > 1 ? '-' + i : '') + '.json');
    try { fs.writeFileSync(f, text, { flag: 'wx' }); file = f; } catch (e) { if (e.code !== 'EEXIST') throw refusal(e); }
  }
  if (!file) throw refusal(new Error('too many copies with the same name'));
  let back = null;
  try { back = fs.readFileSync(file, 'utf8'); } catch (e) { throw refusal(e); }
  if (back !== text) throw refusal(new Error('the file read back differs'));
  const nPlayers = exp.players && typeof exp.players === 'object' ? Object.keys(exp.players).length : 0;
  return { file, dir, name: path.basename(file), names: Array.isArray(names.names) ? names.names.length : 0, players: nPlayers,
    damaged: damageOf(exp).any };
}

function cleanFields(fields) {
  const f = fields && typeof fields === 'object' && !Array.isArray(fields) ? fields : {};
  const out = {};
  for (const k of Object.keys(f)) {
    if (!EDITABLE.includes(k)) return { error: 'unknown field ' + JSON.stringify(k) + ' - ' + EDITABLE.join(', ') };
    const raw = f[k];
    if (raw === undefined || raw === null || raw === '') continue;
    const v = Number(raw);
    if (!Number.isFinite(v) || Math.round(v) !== v || v < 0 || v > 1000000) {
      return { error: k + ' must be a whole number from 0 to 1000000', field: k };
    }
    out[k] = v;
  }
  if (!Object.keys(out).length) return { error: 'nothing to change' };
  return { fields: out };
}

// input: the request body { op, name?, fields?, confirm?, key?, alsoRemove? }.
// env:   { identityUrl, fetch, dial(u), backupDir, now(), timeoutMs } - the
//        active bundle's leaderboard address and how to reach it.
// Resolves to { status, body }: 400 { error, code } for a request the page
// should never have sent, else 200 with { ok, ... } or { ok:false, reason,
// why }, and always `playersKey`, the key as the page may see it.
async function run(input, env) {
  const b = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const e = env || {};
  const op = String(b.op || '');
  const address = lc.leaderboardAddr(e.identityUrl);
  // The servers this Studio set up: the kit, whichever key is used.
  const ours = () => { const h = lc.loadHost(lc.load()); return !!(h && h.url && lc.leaderboardAddr(h.url) === address); };
  const view = () => {
    const k = lc.redactLeaderboardKey(lc.load(), address);
    return Object.assign({ address, kind: kinds.get(address) || (ours() ? 'kit' : null) }, k);
  };
  const bad = (error, code) => ({ status: 400, body: { error, code: code || 'bad' } });
  const done = (extra) => ({ status: 200, body: Object.assign({ ok: true }, extra || {}, { playersKey: view() }) });
  const failed = (reason, why, extra) => ({ status: 200, body: Object.assign({ ok: false, reason, why }, extra || {}, { playersKey: view() }) });

  if (!OPS.has(op)) return bad('op must be one of ' + [...OPS].join(', '));
  if (!address) return bad('this bundle has no leaderboard address', 'noaddress');
  if (op === 'state') return done();
  if (op === 'forget') {
    // A pasted key only; the servers' own key belongs to their record.
    if (lc.loadLeaderboardKeys(lc.load())[address]) lc.saveLeaderboardKey(address, null);
    kinds.delete(address);
    return done({ forgot: true });
  }

  // Asked before anything goes out.
  const name = typeof b.name === 'string' ? b.name.trim() : '';
  if (op === 'newcode' || op === 'release') {
    if (!NAME_RE.test(name)) return bad('name must be a player name (3 to 12 letters, digits, _ . -)', 'name');
  }
  if (op === 'remove' || op === 'edit') {
    if (!ROW_RE.test(name)) return bad('name must be the name of a leaderboard row', 'name');
  }
  let fields = null;
  if (op === 'edit') {
    const cf = cleanFields(b.fields);
    if (cf.error) return bad(cf.error, 'fields');
    fields = cf.fields;
  }
  if (op === 'reset' && String(b.confirm || '').trim().toLowerCase() !== CONFIRM_WORD) {
    return bad('type ' + CONFIRM_WORD + ' to confirm', 'confirm');
  }
  if (!safeTransport(address)) {
    return failed('insecure', 'This leaderboard address starts with http://, so the admin key would cross the internet unprotected.'
      + ' Use the server\'s https:// address.');
  }

  // The key: one typed into Test, else the one this Studio keeps for the address.
  let key = '';
  let from = '';
  if (op === 'test' && typeof b.key === 'string' && b.key.trim()) {
    key = b.key.trim();
    from = 'typed';
    if (!lc.LEADERBOARD_KEY_RULE(key)) {
      return failed('notakey', 'That does not look like an admin key: it has to be 4 or more letters, digits or symbols, with no spaces.');
    }
  } else {
    const k = lc.leaderboardKeyFor(lc.load(), address);
    key = k.key;
    from = k.from;
  }
  if (!key) return failed('nokey', 'Paste this leaderboard\'s admin key first.');

  const c = {
    address, key, from, ours: ours(),
    dial: (typeof e.dial === 'function' ? e.dial(address) : address).replace(/\/+$/, ''),
    fetch: e.fetch || globalThis.fetch,
    timeoutMs: e.timeoutMs || TIMEOUT_MS,
    now: typeof e.now === 'function' ? e.now : () => Date.now(),
    backupDir: e.backupDir || '',
    kind: null,
  };
  try {
    // Test always asks the server what it is.
    if (op === 'test') kinds.delete(address);
    c.kind = await kindOf(c);

    if (op === 'test') {
      const r = await remote(c, 'GET', '/admin/mugen/identity/names');
      if (!Array.isArray(r.names)) throw new PlayersError('garbled', 'The leaderboard server answered, but not with a list of names.');
      // Remembered only once the server has accepted it.
      if (from === 'typed') lc.saveLeaderboardKey(address, key);
      return done({ count: r.names.length, kind: c.kind, saved: from === 'typed' });
    }

    if (op === 'list') {
      const names = await remote(c, 'GET', '/admin/mugen/identity/names');
      const exp = await remote(c, 'GET', '/admin/mugen/leaderboard/export');
      const rows = rowsOf(names, exp);
      const dmg = damageOf(exp);
      return done({
        kind: c.kind,
        rows,
        counts: { names: rows.filter((r) => r.claimed).length, onBoard: rows.filter((r) => r.onBoard).length },
        // The page labels each row "record unreadable" while this is true.
        damaged: dmg.players,
        warning: dmg.players
          ? 'The server says its leaderboard file is damaged, so only the names are listed and no record can be read.'
            + ' The server cannot reset a file it cannot read. Save a copy: it holds the file\'s raw contents.'
          : dmg.any ? 'The server says the file of reports waiting for their match is damaged. Save a copy: it holds the file\'s raw contents.' : '',
      });
    }

    if (op === 'newcode') {
      const r = await remote(c, 'POST', '/admin/mugen/identity/name/' + seg(name) + '/reset');
      if (r.ok === true && typeof r.code === 'string' && r.code) return done({ name: String(r.name || name), code: r.code });
      if (r.reason === 'unknown') return failed('unknown', 'Nobody has claimed the name ' + name + '.');
      if (r.reason === 'invalid') return failed('invalid', name + ' is not a name the server accepts.');
      throw new PlayersError('garbled', 'The leaderboard server did not send a new code.');
    }

    if (op === 'release') {
      // The row first (see the top of this file): a name released with its
      // row left behind hands the row to whoever claims the name next. A
      // failure here throws, and the name is not released.
      let removed = false;
      if (b.alsoRemove === true) {
        let rr;
        try { rr = await remote(c, 'DELETE', '/admin/mugen/leaderboard/player/' + seg(name)); }
        catch (err) {
          if (err instanceof PlayersError) return failed(err.reason, 'Nothing was changed: the name stays claimed and the record stays on the leaderboard. ' + err.why);
          throw err;
        }
        removed = rr.ok === true;
      }
      let r;
      try { r = await remote(c, 'DELETE', '/admin/mugen/identity/name/' + seg(name)); }
      catch (err) {
        if (err instanceof PlayersError && removed) {
          return failed(err.reason, name + '\'s rating and record are off the leaderboard, but the name was not released. ' + err.why, { removed });
        }
        throw err;
      }
      if (r.ok === true) return done({ name: String(r.name || name), removed });
      // Said whole, with or without the record already taken off.
      if (r.reason === 'unknown') {
        return failed('unknown', removed ? 'Nobody has claimed the name ' + name + ', so there is nothing to release. Their rating and record were taken off the leaderboard.'
          : 'Nobody has claimed the name ' + name + ', so there is nothing to release.', { removed });
      }
      if (r.reason === 'invalid') {
        return failed('invalid', removed ? name + ' is not a name the server accepts. Their rating and record were taken off the leaderboard.'
          : name + ' is not a name the server accepts.', { removed });
      }
      throw new PlayersError('garbled', removed ? 'The leaderboard server did not say whether the name was released. Their rating and record were taken off the leaderboard.'
        : 'The leaderboard server did not say whether the name was released.');
    }

    if (op === 'remove') {
      const r = await remote(c, 'DELETE', '/admin/mugen/leaderboard/player/' + seg(name));
      if (r.ok !== true) return failed('notonboard', name + ' is not on the leaderboard.');
      return done({ name });
    }

    if (op === 'edit') {
      const r = await remote(c, 'PATCH', '/admin/mugen/leaderboard/player/' + seg(name), fields);
      if (r.ok === true) {
        return done({ name: String(r.name || name), changed: !!r.changed, before: r.before || {}, after: r.after || {} });
      }
      if (r.reason === 'nosuchplayer') return failed('notonboard', name + ' is not on the leaderboard, so there are no numbers to change.');
      if (r.reason === 'badvalue') return failed('badvalue', 'The server refused the value for ' + String(r.field || 'a field') + '.');
      throw new PlayersError('garbled', 'The leaderboard server did not say whether the numbers changed.');
    }

    if (op === 'export') {
      const backup = await saveBackup(c, 'copy');
      return done({ backup });
    }

    if (op === 'reset') {
      // The copy first; saveBackup throws, and nothing is reset, unless the
      // file is on the disk and reads back whole.
      const backup = await saveBackup(c, 'before-reset');
      // A store its server cannot read cannot be reset by it either (the
      // reference server answers 500). The copy holds the raw file.
      if (backup.damaged) {
        return failed('damaged', 'Nothing was reset: the server says its leaderboard file is damaged, and it cannot reset a file it cannot read.'
          + ' The copy just saved holds the file\'s raw contents: ' + backup.file + '. The file has to be repaired or replaced on the server itself.', { backup });
      }
      let r;
      try { r = await remote(c, 'POST', '/admin/mugen/leaderboard/reset'); }
      catch (err) {
        if (err instanceof PlayersError) return failed(err.reason, err.why + ' The copy saved before the reset is in ' + backup.file + '.', { backup });
        throw err;
      }
      if (r.ok !== true) return failed('server', 'The leaderboard server did not confirm the reset. The copy saved first is in ' + backup.file + '.', { backup });
      return done({ cleared: true, backup });
    }
  } catch (err) {
    if (err instanceof PlayersError) return failed(err.reason, err.why, err.extra || undefined);
    throw err;
  }
  return bad('unhandled op');
}

module.exports = {
  run, rowsOf, safeTransport, ADAPTERS, KIT_NAME, CONFIRM_WORD, EDITABLE, TIMEOUT_MS,
  // For the tests: forget what was learned about each address.
  _forgetKinds: () => kinds.clear(),
};
