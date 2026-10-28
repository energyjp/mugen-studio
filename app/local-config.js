'use strict';
//
// THE DEPLOYMENT'S OWN ENDPOINTS, KEPT OUT OF THE SOURCE.
//
// public/ikemen/webrtc.js used to carry three live values in its source -
// METERED_APP, METERED_KEY and SIGNAL_URL - and every redistributable path
// blanked them on the way out. That is backwards twice over. It means the
// default state of the tree is "loaded", so a path that forgets to blank ships
// the author's TURN quota and lobby; and it means the file cannot be handed to
// anybody else as a starting point, which is the whole premise of the 2.0
// blueprint.
//
// Now the source ships BLANK and whoever delivers it fills it in:
//
//   local-config.json  ->  fillPrivateValues()  ->  served page / exported build
//
// There is exactly one copy of the values, it is not in any source file, and a
// build that never fills gets a working game with the lobby off and the manual
// copy-paste connect flow intact - which is precisely what a stranger should
// get.
//
// WHY NOT .gitignore ALONE. That was the first plan and it does not hold: an
// ignore line keeps a file out of COMMITS, and says nothing about the folders
// this program copies itself into - a portable copy, a kit, an export. (For a
// stretch this tree had no repository at all, which is when the point was
// made.) The guarantee is file-presence instead - local-config.json is in
// private-surfaces.PRIVATE_FILES, so no build copies it, and assertClean fails
// any finished build that contains one. The .gitignore line keeps it out of
// history; it is the second guard, not the first.
//
// WHY NOT roster.json, the seam identityUrl already uses. roster.json is mapped
// into the CONTENT directory (layout.js) and scripts/make-portable.js copies
// that wholesale in non-tester mode, so anything beside it travels with every
// portable copy. This file sits at the repo root, which make-portable copies by
// an explicit allowlist it is not on.
//
// WHERE IT IS: layout.LOCAL_CONFIG_FILE. Beside the program in the checkout,
// as it always was; in a portable copy, in Settings/ beside app/, because app/
// is what the next version's zip replaces - and the admin key "Set up my
// servers" keeps here cannot be had from the Studio again. A copy from before
// the Settings folder kept it in app/, and layout.js moves it on the first
// start of a version that has one.

const fs = require('fs');
const path = require('path');

// MUGEN_STUDIO_LOCAL_CONFIG points at another file - FOR TESTS ONLY, the same
// way MUGEN_STUDIO_LAYOUT does for layout.js: a suite that drives the Settings >
// Online routes writes a throwaway file, never the one beside the program.
const FILE = process.env.MUGEN_STUDIO_LOCAL_CONFIG
  ? path.resolve(process.env.MUGEN_STUDIO_LOCAL_CONFIG) : require('./layout.js').LOCAL_CONFIG_FILE;

// The three consts, by the name they have in webrtc.js. Keeping the mapping
// here rather than in each caller means adding a fourth endpoint is one line.
const FIELDS = [
  ['meteredApp', 'METERED_APP'],
  ['meteredKey', 'METERED_KEY'],
  ['signalUrl', 'SIGNAL_URL'],
];

// Returns {} when the file is absent or unreadable - ABSENCE IS THE NORMAL
// CASE, not an error. (problem() below says which it was.) A byte-order mark
// in front, which Notepad's "UTF-8 with BOM" writes, is not damage. A clone with no config is a working blueprint, and it
// must not have to catch anything to be one.
function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8').replace(/^\uFEFF/, ''));
    return (raw && typeof raw === 'object') ? raw : {};
  } catch (e) {
    return {};
  }
}

// WHY load() CAME BACK EMPTY, when it was not because the file is absent.
// load() stays quiet (every served page calls it), so this is asked by the
// places where empty would mislead: Settings > Online, which would show every
// field blank as if nothing were set, and the Website export, which would
// build without the relay and TURN addresses and say nothing. null when the
// file is missing or reads as a JSON object; otherwise one sentence.
function problem() {
  let text;
  try { text = fs.readFileSync(FILE, 'utf8'); } catch (e) {
    if (e.code === 'ENOENT') return null;
    const busy = e.code === 'EBUSY' || e.code === 'EPERM' || e.code === 'EACCES';
    const code = e.code || e.message;
    return busy ? FILE + ' could not be read (' + code + '): another program is holding it (an antivirus scan or a sync client, for example). Try again in a moment.'
      : FILE + ' could not be read (' + code + ').';
  }
  try {
    const raw = JSON.parse(text.replace(/^\uFEFF/, ''));
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) return null;
    return FILE + ' is not a JSON object - fix it in a text editor; nothing in it is used until then.';
  } catch (e) {
    return FILE + ' is damaged: it is not valid JSON (' + e.message + '). Fix it in a text editor; nothing in it is used until then.';
  }
}

function has(cfg) {
  return FIELDS.some(([k]) => cfg && typeof cfg[k] === 'string' && cfg[k]);
}

// Put the values INTO a copy of webrtc.js. The inverse of what the exporters
// used to do, and deliberately the same regex shape, so a source that has been
// edited in a way the pattern no longer matches is caught by `filled` coming
// back short rather than by silently shipping blanks.
function fillPrivateValues(text, cfg) {
  let filled = 0;
  let out = text;
  for (const [key, name] of FIELDS) {
    const v = cfg && cfg[key];
    if (typeof v !== 'string' || !v) continue;
    const re = new RegExp('(const ' + name + "\\s*=\\s*)'[^']*';");
    if (!re.test(out)) continue;
    // JSON cannot carry a raw quote or backslash through here without breaking
    // the literal it lands in, and a mangled const is a syntax error in the
    // page rather than a wrong value - so escape rather than trust the file.
    const safe = v.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    out = out.replace(re, (m, head) => head + "'" + safe + "';");
    filled++;
  }
  return { text: out, filled };
}

// Every value this deployment considers secret, for a guard to check an output
// against. Empty when there is no config, which is why the guard that uses it
// must ALSO work by shape - see assertNoPrivateValues in export.js.
// The host record's Cloudflare token and admin key are secrets too (see HOST
// below): neither is in FIELDS, so nothing fills them into a page. They belong
// in NO build, so export.js assertNoHostSecrets looks for these two, by value,
// in every text file of every finished build - a Website export public or not,
// a desktop build, the kit, a portable copy - and fails the build that carries
// either. (assertNoPrivateValues checks all of them, but only in a public
// build's webrtc.js.)
// The Players panel's admin keys (LEADERBOARD_KEYS below), one per leaderboard
// address, are the same kind of secret and are listed the same way, each as
// LEADERBOARD_ADMIN_KEY.
function secrets(cfg) {
  const c = cfg || load();
  const h = (c.host && typeof c.host === 'object') ? c.host : {};
  return FIELDS.map(([key, name]) => [name, c[key]])
    .concat([['HOST_TOKEN', h.token], ['HOST_ADMIN_KEY', h.adminKey]])
    .concat(Object.values(loadLeaderboardKeys(c)).map((v) => ['LEADERBOARD_ADMIN_KEY', v]))
    .filter(([, v]) => typeof v === 'string' && v.length >= 4);
}

// ---------------------------------------------------------------------------
// WRITING THE FILE, from the Studio's Settings > Online tab.
//
// Everything above reads the file; nothing wrote it until the tab existed and
// the only editor was Notepad. The rules for writing are the ones the readers
// impose. load() runs on EVERY request for webrtc.js and a half-written file
// parses as {} - so a write is a whole file renamed into place, never bytes
// appended to the live one. The file is optional and its keys are sparse, so a
// blank value REMOVES the key rather than storing "". And nothing in this
// module can delete the file: a Studio that could lose the one copy of its own
// endpoints on a bad click is worse than one that cannot write them.

const KEYS = FIELDS.map(([k]) => k);

// The line a fresh file starts with, so one the tab creates reads the same as
// one written by hand.
const COMMENT = "This deployment's own endpoints. NEVER copied into any build - see local-config.js and private-surfaces.PRIVATE_FILES. A clone without this file is a working blueprint with the lobby off.";

function parses(u) {
  try { new URL(u); return true; } catch (e) { return false; }
}
// new URL() is looser than the constructors that consume these values: a
// WebSocket throws on any fragment (a bare '#' included) and Chrome on
// embedded credentials, fetch throws on credentials, and a fragment on the
// leaderboard origin would swallow the routes appended to it. Each of those
// parses, saves, and then leaves the play page stuck at "Creating room...".
function plainUrl(u) {
  try { const x = new URL(u); return !x.username && !x.password && !/#/.test(u); } catch (e) { return false; }
}

// What a value has to look like BEFORE it lands in the file. Each rule is the
// shape the value's consumer needs, not a preference: the app name becomes a
// hostname label in webrtc.js's fetch; the key is the guard's own credential
// shape, which also excludes the quote and backslash fillPrivateValues would
// have to escape; the relay URL has to be one a browser's WebSocket will open.
// `current` is the file as it stands, so a patch that sets only the app or
// only the key can still be told the pair is half.
//
// identityUrl is not one of KEYS - it lives in roster.json - but the tab's
// route takes both files' patches in one body and the probe needs the same
// rule, so its check lives here beside the others.
//
// Returns { ok, errors: { field: message }, warnings: [message] }. Only the
// fields PRESENT in the patch are checked; a blank is always accepted, because
// blank is how a piece is switched off.
// WHAT PEOPLE PASTE IS THE ADDRESS, not the name inside it. The Metered
// dashboard shows an app as yourname.metered.live, and asking for "the app
// subdomain" meant knowing what a subdomain is. yourname,
// yourname.metered.live and https://yourname.metered.live/... all come out as
// yourname; anything else is left as typed for validate() to explain.
function meteredAppName(v) {
  const s = String(v == null ? '' : v).trim();
  const m = /^(?:[a-z]+:\/\/)?([a-z0-9-]+)\.metered\.live(?:[:/?#].*)?$/i.exec(s);
  return m ? m[1] : s;
}

function validate(patch, current) {
  const errors = {};
  const warnings = [];
  const p = patch || {};
  const clean = (k) => (typeof p[k] !== 'string' ? '' : k === 'meteredApp' ? meteredAppName(p[k]) : p[k].trim());
  if ('signalUrl' in p) {
    const v = clean('signalUrl');
    if (v) {
      if (/\s/.test(v)) errors.signalUrl = 'a URL cannot contain spaces';
      else if (!/^wss?:\/\/./i.test(v)) errors.signalUrl = 'must start with wss:// (ws:// only for a relay on your own LAN or localhost)';
      else if (!parses(v) || !plainUrl(v)) errors.signalUrl = 'not a URL a browser can open (no #fragment, no user:password@)';
      else if (/^ws:\/\//i.test(v)) warnings.push('ws:// works for LAN and localhost, but a page served over https cannot open it - a relay on the internet needs wss://');
    }
  }
  if ('meteredApp' in p) {
    const v = clean('meteredApp');
    if (v && !/^[a-z0-9-]{1,63}$/i.test(v)) {
      errors.meteredApp = 'paste your app address, like yourname.metered.live (or just the yourname part)';
    }
  }
  if ('meteredKey' in p) {
    const v = clean('meteredKey');
    if (v && !/^[A-Za-z0-9_.-]{4,}$/.test(v)) {
      errors.meteredKey = 'letters, digits, dot, dash and underscore only, at least 4 of them - paste the key exactly as the dashboard shows it';
    }
  }
  if ('identityUrl' in p) {
    const v = clean('identityUrl');
    if (v) {
      if (/\s/.test(v)) errors.identityUrl = 'a URL cannot contain spaces';
      else if (!/^https?:\/\/./i.test(v)) errors.identityUrl = 'must start with https:// (http:// only for a server on your own LAN)';
      else if (!parses(v) || !plainUrl(v)) errors.identityUrl = 'not a URL a browser can open (no #fragment, no user:password@)';
    }
  }
  // Half a TURN pair does nothing: webrtc.js only checks the app, and the
  // fetch it then makes with a blank key is a refusal the player never sees.
  const merged = Object.assign({}, current || {});
  for (const k of ['meteredApp', 'meteredKey']) if (k in p) merged[k] = clean(k);
  const app = typeof merged.meteredApp === 'string' && merged.meteredApp;
  const key = typeof merged.meteredKey === 'string' && merged.meteredKey;
  if (app && !key) warnings.push('TURN app set without its API key - the relay stays off until both are filled in');
  if (key && !app) warnings.push('TURN API key set without the app name - the relay stays off until both are filled in');
  return { ok: !Object.keys(errors).length, errors, warnings };
}

// Applies a patch of KEYS to the file: a value sets the key, '' removes it, a
// key absent from the patch is untouched. Keeps _comment and any key this
// version does not know, exactly as layout.setDownloadFolder keeps
// studio-layout.json. A missing file is the normal case and starts fresh; a
// file that does not parse is NOT, and is left alone with an error rather
// than replaced - it may be the only copy of a key. Returns what is now on
// disk. `file` is for the test suite; callers write FILE.
function save(patch, file) {
  const target = file || FILE;
  const p = Object.assign({}, patch || {});
  if (typeof p.meteredApp === 'string') p.meteredApp = meteredAppName(p.meteredApp);
  const v = validate(p);
  if (!v.ok) {
    const k = Object.keys(v.errors)[0];
    const err = new Error(k + ': ' + v.errors[k]);
    err.field = k;
    throw err;
  }
  const raw = readForWrite(target);
  for (const k of KEYS) {
    if (!(k in p)) continue;
    const val = typeof p[k] === 'string' ? p[k].trim() : '';
    if (val) raw[k] = val; else delete raw[k];
  }
  return writeWhole(target, raw);
}

// The file as an object to patch: a fresh one (with the comment) when it is
// missing, an error - never a replacement - when it does not parse.
function readForWrite(target) {
  let text = null;
  try { text = fs.readFileSync(target, 'utf8'); } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  if (text === null) return { _comment: COMMENT };
  let raw;
  try { raw = JSON.parse(text.replace(/^\uFEFF/, '')); } catch (e) {
    throw new Error(path.basename(target) + ' does not parse (' + e.message + ') - fix it by hand; nothing was written');
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(path.basename(target) + ' is not a JSON object - fix it by hand; nothing was written');
  }
  return raw;
}

// Whole file, then one rename: a reader that races the write sees either the
// old file or the new one, never a torn one that parses as {}.
function writeWhole(target, raw) {
  // Settings/ is made at start (layout.js); this covers a folder removed
  // while the Studio ran.
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = target + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(raw, null, 2) + '\n');
  fs.renameSync(tmp, target);
  return raw;
}

// ---------------------------------------------------------------------------
// THE HOST RECORD: "Your own servers (Cloudflare)".
//
// When the Studio sets up the host kit (hostkit/deploy.js) on the host's own
// Cloudflare account, it remembers what it made so "Update my servers" and
// "Remove my servers" need nothing typed again:
//
//   host: { accountId, accountName, worker, subdomain, url, kitVersion,
//           deployedAt, adminKey, token }
//
// It lives in this file because this file is the one that never leaves the
// machine (PRIVATE_FILES, assertClean). It is NOT in FIELDS - FIELDS is what
// fillPrivateValues writes into every served webrtc.js - and save() above only
// writes KEYS and keeps every other key, so an older Studio saving the relay
// address leaves the record alone. The token and the admin key are secrets():
// every exporter fails a build that carries either, by value, in any text file
// (export.js assertNoHostSecrets). The page is only ever told that they are set
// and how they end (redactHost).
const HOST_FIELDS = ['accountId', 'accountName', 'worker', 'subdomain', 'url', 'kitVersion', 'deployedAt', 'adminKey', 'token'];
const DNS_LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const HOST_RULES = {
  accountId: (v) => /^[A-Za-z0-9_-]{1,64}$/.test(v),
  accountName: (v) => v.length <= 200 && !/[\x00-\x1f\x7f]/.test(v),
  worker: (v) => DNS_LABEL.test(v),
  subdomain: (v) => DNS_LABEL.test(v),
  url: (v) => /^https?:\/\/[^/]+$/i.test(v) && parses(v) && plainUrl(v),
  kitVersion: (v) => /^[\w.+-]{1,40}$/.test(v),
  deployedAt: (v) => v.length <= 40 && !isNaN(Date.parse(v)),
  adminKey: (v) => /^[A-Za-z0-9_-]{16,200}$/.test(v),
  // What deploy.js accepts as a token: visible ASCII, nothing that could
  // break out of a header. The route stores deploy.cleanToken's result, so a
  // paste of "Bearer <token>" arrives here without the prefix.
  token: (v) => /^[\x21-\x7e]{10,1000}$/.test(v),
};

// The record as stored, keeping only fields that pass their rule, or null.
function loadHost(cfg) {
  const c = cfg || load();
  const h = c && c.host;
  if (!h || typeof h !== 'object' || Array.isArray(h)) return null;
  const out = {};
  for (const k of HOST_FIELDS) if (typeof h[k] === 'string' && HOST_RULES[k](h[k])) out[k] = h[k];
  return Object.keys(out).length ? out : null;
}

// Merges `patch` into the record: a value sets the field, null or '' removes
// it, a field absent from the patch is untouched, and a record left empty is
// removed. `patch === null` removes the whole record. A value that fails its
// rule throws and nothing is written. Every other key of the file is kept.
// Returns what is now on disk. `file` is for the test suite.
function saveHost(patch, file) {
  const target = file || FILE;
  const next = {};
  if (patch !== null) {
    for (const k of Object.keys(patch || {})) {
      if (!HOST_FIELDS.includes(k)) continue;
      const v = patch[k];
      if (v === null || v === undefined || v === '') { next[k] = null; continue; }
      const s = typeof v === 'string' ? v.trim() : '';
      if (!s || !HOST_RULES[k](s)) {
        const err = new Error('host.' + k + ': not a value the Studio can store');
        err.field = k;
        throw err;
      }
      next[k] = s;
    }
  }
  const raw = readForWrite(target);
  if (patch === null) {
    delete raw.host;
  } else {
    const cur = (raw.host && typeof raw.host === 'object' && !Array.isArray(raw.host)) ? Object.assign({}, raw.host) : {};
    for (const k of Object.keys(next)) { if (next[k] === null) delete cur[k]; else cur[k] = next[k]; }
    if (Object.keys(cur).length) raw.host = cur; else delete raw.host;
  }
  return writeWhole(target, raw);
}

// The addresses one kit Worker serves: the leaderboard at its origin, the
// relay at /ws on the same host (hostkit/deploy.js addressesFor).
function hostAddresses(h) {
  const u = h && typeof h.url === 'string' ? h.url.replace(/\/+$/, '') : '';
  if (!u) return { identityUrl: '', signalUrl: '' };
  return { identityUrl: u, signalUrl: u.replace(/^http/i, 'ws') + '/ws' };
}

// A tail is a substring of a secret: four characters of one dozens long
// identify it without disclosing it; four of a short one are most of it.
const tailOf = (s) => (typeof s === 'string' && s.length >= 12 ? s.slice(-4) : '');

// What the page is shown of the record: everything but the two secrets, and
// for those only whether they are set and how the token ends.
function redactHost(cfg) {
  const h = loadHost(cfg || {});
  if (!h) return null;
  const a = hostAddresses(h);
  return {
    accountId: h.accountId || '',
    accountName: h.accountName || '',
    worker: h.worker || '',
    subdomain: h.subdomain || '',
    url: h.url || '',
    identityUrl: a.identityUrl,
    signalUrl: a.signalUrl,
    kitVersion: h.kitVersion || '',
    deployedAt: h.deployedAt || '',
    tokenSet: !!h.token,
    tokenTail: tailOf(h.token),
    adminKeySet: !!h.adminKey,
  };
}

// ---------------------------------------------------------------------------
// THE PLAYERS PANEL'S ADMIN KEYS: "leaderboardKeys".
//
// Settings > Online > Players lists a leaderboard's names and changes them
// (players.js). Every one of those calls needs the leaderboard server's admin
// key, and the key belongs to the SERVER, so it is kept per address:
//
//   leaderboardKeys: { "<leaderboard address>": "<its admin key>" }
//
// The address is normalized (leaderboardAddr) so "https://Board.example.com/"
// and "https://board.example.com" are one entry. The servers "Set up my
// servers" made need no entry: their key is the host record's adminKey, used
// while the address is the record's url and no key was pasted for it. A key
// the host pasted is stored only after the server accepted it (the route's
// Test), is in secrets() by value (LEADERBOARD_ADMIN_KEY) so every exporter's
// host-secret scan fails a build that carries it, and the page is only ever
// told that one is set and where it came from - no part of it: on some
// servers the same key opens the whole site's admin routes, and settings
// pages get screenshotted.
const LEADERBOARD_KEYS = 'leaderboardKeys';
// Visible ASCII, nothing that could break out of a header or a query value.
// A key can open more than the leaderboard on some servers (a whole site's
// admin routes), so it is held to the same care as the Cloudflare token.
// No stricter length than the server's own: a real one is five letters, the
// short password its site also unlocks with. 4 is the floor because the
// exporters' by-value secret scan (secrets(), below) looks for values of 4
// or more; a shorter key could not be caught in a build.
const LEADERBOARD_KEY_RULE = (v) => /^[\x21-\x7e]{4,500}$/.test(v);

// The one spelling of a leaderboard address the keys are filed under: http(s)
// only, the host lowercased (new URL does it), no trailing slash, no query or
// fragment. '' for anything else.
function leaderboardAddr(u) {
  const s = String(u == null ? '' : u).trim();
  if (!s) return '';
  try {
    const x = new URL(s);
    if (x.protocol !== 'https:' && x.protocol !== 'http:') return '';
    if (x.username || x.password) return '';
    return x.origin + x.pathname.replace(/\/+$/, '');
  } catch (e) { return ''; }
}

// The stored keys, keeping only entries whose address and key pass their rules.
function loadLeaderboardKeys(cfg) {
  const c = cfg || load();
  const raw = c && c[LEADERBOARD_KEYS];
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const k of Object.keys(raw)) {
    const a = leaderboardAddr(k);
    const v = raw[k];
    if (a && typeof v === 'string' && LEADERBOARD_KEY_RULE(v)) out[a] = v;
  }
  return out;
}

// Sets (a string) or removes (null / '') the key for one address. Every other
// key of the file is kept; a record left empty is removed. A value that fails
// its rule throws and nothing is written. `file` is for the test suite.
function saveLeaderboardKey(addr, key, file) {
  const target = file || FILE;
  const a = leaderboardAddr(addr);
  if (!a) {
    const err = new Error('leaderboardKeys: not a leaderboard address');
    err.field = 'address';
    throw err;
  }
  const v = typeof key === 'string' ? key.trim() : '';
  if (v && !LEADERBOARD_KEY_RULE(v)) {
    const err = new Error('leaderboardKeys: not a value the Studio can store');
    err.field = 'key';
    throw err;
  }
  const raw = readForWrite(target);
  const cur = (raw[LEADERBOARD_KEYS] && typeof raw[LEADERBOARD_KEYS] === 'object' && !Array.isArray(raw[LEADERBOARD_KEYS]))
    ? Object.assign({}, raw[LEADERBOARD_KEYS]) : {};
  // Any spelling of the same address goes, so one address is one entry.
  for (const k of Object.keys(cur)) if (leaderboardAddr(k) === a) delete cur[k];
  if (v) cur[a] = v;
  if (Object.keys(cur).length) raw[LEADERBOARD_KEYS] = cur; else delete raw[LEADERBOARD_KEYS];
  return writeWhole(target, raw);
}

// The key the Studio would use for `addr`, and where it came from: a pasted
// one ('pasted'), else the host record's own ('servers', while the address is
// the servers' url), or none. A pasted key wins because it was stored only
// after the server accepted it: for the servers this Studio set up, that
// happens only after they refused the record's key (set up again from another
// computer, which gave them a new one). Forget key goes back to the record's.
// SERVER SIDE ONLY - the page gets redactLeaderboardKey.
function leaderboardKeyFor(cfg, addr) {
  const c = cfg || load();
  const a = leaderboardAddr(addr);
  if (!a) return { key: '', from: '' };
  const k = loadLeaderboardKeys(c)[a];
  if (k) return { key: k, from: 'pasted' };
  const h = loadHost(c);
  if (h && h.adminKey && leaderboardAddr(h.url) === a) return { key: h.adminKey, from: 'servers' };
  return { key: '', from: '' };
}

// Whether a key is set and where it came from. Never any part of the key.
function redactLeaderboardKey(cfg, addr) {
  const r = leaderboardKeyFor(cfg, addr);
  return { keySet: !!r.key, keyFrom: r.from };
}

// What the page is shown. The app name and the relay URL are in every served
// webrtc.js anyway; so is the key, but a settings page that prints a
// credential in a text box gets screenshotted, so it says "set, ends in xxxx"
// and the field only ever sends a NEW value.
function redact(cfg) {
  const c = cfg || {};
  const s = (k) => (typeof c[k] === 'string' ? c[k] : '');
  const key = s('meteredKey');
  return {
    meteredApp: s('meteredApp'),
    signalUrl: s('signalUrl'),
    meteredKeySet: !!key,
    // A tail is a substring of a secret: four characters of a key dozens long
    // identify it without disclosing it; four of a short one are the key.
    meteredKeyTail: key.length >= 12 ? key.slice(-4) : '',
    host: redactHost(c),
  };
}

// ---------------------------------------------------------------------------
// DIALING THE ENDPOINTS, from the same tab's TEST buttons.
//
// Each probe is the client's own first request, made from this process: the
// relay is asked for a room the way "Create room" asks (never the queue, which
// needs a claimed identity and a build hash); TURN is the credential fetch
// webrtc.js makes, verbatim; the leaderboard is its cheapest GET. So a green
// result means "the thing at that address speaks the protocol", not "the URL
// resolves". And a probe from Node is not a probe from the browser: a proxy,
// or a mixed-content block in front of an https page, is invisible here.
//
// Nothing a probe returns contains the key. `deps` is for the test suite -
// { WebSocket, fetch, timeoutMs }; the route passes nothing and gets the
// globals (Node 22 and newer have both).
const PROBE_TIMEOUT_MS = 6000;

const PROBE_LABEL = {
  signalUrl: 'relay URL',
  meteredApp: 'App name',
  meteredKey: 'API key',
  identityUrl: 'leaderboard address',
};

// The page's friendlyDeny, shortened: a deny is still an ANSWER from a relay
// that speaks the protocol, which is what the probe is asking.
function denyText(reason) {
  return reason === 'badcode' ? 'no such room'
    : reason === 'badpass' ? 'wrong password'
      : reason === 'full' ? 'room full'
        : reason === 'busy' ? 'busy, try again'
          : reason ? 'denied (' + String(reason) + ')' : 'denied';
}

function tooSlow(timeoutMs) {
  return 'no answer within ' + Math.round(timeoutMs / 1000) + ' s';
}

// The failure a fetch reports is "fetch failed" with the real reason in
// `cause`; surface the code (ENOTFOUND, ECONNREFUSED) and nothing else, since
// an undici message can quote the URL.
function causeOf(e) {
  const c = e && e.cause && (e.cause.code || e.cause.message);
  return c ? String(c) : '';
}

function probeLobby(url, WS, timeoutMs) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    let ws = null;
    let done = false;
    const finish = (r) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      // What "Manual connect instead" does in the page: close and walk away.
      // The empty room the relay opened for us expires on its own.
      if (ws) { try { ws.close(); } catch (e) { /* already closed */ } }
      resolve(Object.assign({ ms: Date.now() - t0 }, r));
    };
    const timer = setTimeout(() => finish({ ok: false, why: tooSlow(timeoutMs) }), timeoutMs);
    try {
      // The client's own create request (webrtc.js roomHost), query joined
      // the same way so a relay URL that already carries one keeps it.
      ws = new WS(url + (url.includes('?') ? '&' : '?') + 'create=1&pass=');
    } catch (e) {
      return finish({ ok: false, why: 'could not open a socket to it (' + e.message + ')' });
    }
    ws.onmessage = (e) => {
      let m = null;
      try { m = JSON.parse(String(e.data)); } catch (err) { m = null; }
      if (m && m.t === 'room' && m.code) return finish({ ok: true, code: String(m.code), note: 'relay answered with room ' + String(m.code) });
      if (m && m.t === 'deny') return finish({ ok: true, note: 'relay answered: ' + denyText(m.reason) });
      finish({ ok: false, why: 'something answered, but not in the room protocol' });
    };
    // Node's WebSocket fires `error` and then NOTHING on a refused handshake -
    // no close, readyState stuck at CONNECTING - where a browser follows with
    // close. So the error is the verdict here, and close is the fallback for
    // a socket that opened and hung up without a word.
    ws.onerror = () => finish({ ok: false, why: 'unreachable, or not a lobby relay - the handshake was refused' });
    ws.onclose = () => finish({ ok: false, why: 'the socket opened and closed without answering' });
  });
}

async function probeTurn(app, key, doFetch, timeoutMs) {
  const t0 = Date.now();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    // Verbatim the client's request (webrtc.js fetchIceServers), so what
    // passes here is what a player's page gets.
    const res = await doFetch('https://' + app + '.metered.live/api/v1/turn/credentials?apiKey=' + key, { signal: ctl.signal });
    let j = null;
    try { j = await res.json(); } catch (e) { j = null; }
    const n = Array.isArray(j) ? j.length : 0;
    const ms = Date.now() - t0;
    if (res.ok && n) return { ok: true, ms, status: res.status, servers: n, note: n === 1 ? '1 relay server issued' : n + ' relay servers issued' };
    return {
      ok: false, ms, status: res.status,
      why: res.ok ? 'answered, but issued no relay servers'
        : res.status === 401 || res.status === 403 ? 'answered ' + res.status + ' - the key is not accepted'
          : res.status === 404 ? 'answered ' + res.status + ' - no app with that subdomain' : 'answered ' + res.status,
    };
  } catch (e) {
    const cause = causeOf(e), host = app + '.metered.live';
    return { ok: false, ms: Date.now() - t0, why: ctl.signal.aborted ? tooSlow(timeoutMs) : cause ? 'could not reach ' + host + ' (' + cause + ')' : 'could not reach ' + host };
  } finally {
    clearTimeout(timer);
  }
}

async function probeIdentity(base, doFetch, timeoutMs) {
  const t0 = Date.now();
  const b = base.replace(/\/+$/, '');
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    let route = '/mugen/leaderboard';
    let res = await doFetch(b + route + '?limit=1', { signal: ctl.signal });
    if (res.status === 404) {
      // A server that keeps identities but has no standings route yet.
      route = '/mugen/identity/check';
      res = await doFetch(b + route + '?name=probe', { signal: ctl.signal });
    }
    const ms = Date.now() - t0;
    if (res.ok) return { ok: true, ms, status: res.status, route, note: route + ' answered ' + res.status };
    return {
      ok: false, ms, status: res.status, route,
      why: res.status === 404 ? route + ' answered ' + res.status + ' - nothing at that address speaks the identity routes' : route + ' answered ' + res.status,
    };
  } catch (e) {
    const cause = causeOf(e);
    return { ok: false, ms: Date.now() - t0, why: ctl.signal.aborted ? tooSlow(timeoutMs) : cause ? 'could not reach it (' + cause + ')' : 'could not reach it' };
  } finally {
    clearTimeout(timer);
  }
}

// opts: { what: 'lobby' | 'turn' | 'identity', signalUrl, meteredApp,
// meteredKey, identityUrl } - the values to dial, already merged by the caller
// from what is typed and what is on disk. Resolves to { what, ok, ms, ... }
// with `note` on success and `why` on failure; { error } only for a `what`
// this does not know, so the route can answer 400 to a bad request and 200
// to a bad endpoint.
async function probe(opts, deps) {
  const o = opts || {};
  const d = deps || {};
  const WS = d.WebSocket || globalThis.WebSocket;
  const doFetch = d.fetch || globalThis.fetch;
  const timeoutMs = d.timeoutMs || PROBE_TIMEOUT_MS;
  const what = o.what;
  const need = what === 'lobby' ? ['signalUrl']
    : what === 'turn' ? ['meteredApp', 'meteredKey']
      : what === 'identity' ? ['identityUrl'] : null;
  if (!need) return { error: 'unknown probe ' + JSON.stringify(String(what)) + ' - lobby, turn or identity' };
  const sub = {};
  for (const k of need) sub[k] = typeof o[k] !== 'string' ? '' : k === 'meteredApp' ? meteredAppName(o[k]) : o[k].trim();
  const v = validate(sub);
  if (!v.ok) {
    const k = Object.keys(v.errors)[0];
    return { what, ok: false, ms: 0, why: PROBE_LABEL[k] + ': ' + v.errors[k] };
  }
  for (const k of need) {
    if (!sub[k]) return { what, ok: false, ms: 0, why: PROBE_LABEL[k] + ' is blank - nothing to test' };
  }
  if (what === 'lobby' && typeof WS !== 'function') {
    return { what, ok: false, ms: 0, why: 'this Node has no WebSocket - the probe needs Node 22 or newer' };
  }
  if (what !== 'lobby' && typeof doFetch !== 'function') {
    return { what, ok: false, ms: 0, why: 'this Node has no fetch - the probe needs Node 18 or newer' };
  }
  const r = what === 'lobby' ? await probeLobby(sub.signalUrl, WS, timeoutMs)
    : what === 'turn' ? await probeTurn(sub.meteredApp, sub.meteredKey, doFetch, timeoutMs)
      : await probeIdentity(sub.identityUrl, doFetch, timeoutMs);
  return Object.assign({ what }, r);
}

module.exports = {
  FILE, FIELDS, load, problem, has, fillPrivateValues, secrets,
  KEYS, validate, save, redact, probe, PROBE_TIMEOUT_MS,
  HOST_FIELDS, loadHost, saveHost, redactHost, hostAddresses,
  leaderboardAddr, loadLeaderboardKeys, saveLeaderboardKey, leaderboardKeyFor, redactLeaderboardKey, LEADERBOARD_KEY_RULE,
};
