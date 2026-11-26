'use strict';
// THE UPDATER: About > Check for updates, the daily look on start, and the
// download with every check on it. MugenStudio.exe does the rest - it swaps
// the program in on the next start (studio-go/update). docs/LAYOUT.md
// "Updating itself" and GRAIL ("The updater") have the whole design.
//
// WHAT IT ASKS: GitHub's latest release of energyjp/mugen-studio
// (/releases/latest, which never lists a draft or a pre-release), with a
// plain User-Agent and nothing else - no cookie, no token, nothing about
// this computer. At most once in 20 hours on its own (the "Check on start"
// setting, layout.UPDATE_CHECK), whenever the person presses the button, and
// never before the time GitHub's rate limit names. The answer is kept in
// Settings/update-check.json (memory only in the checkout) with its ETag, so a
// second look costs GitHub nothing.
//
// WHAT IT TAKES: one release whose tag is a plain version above this one,
// with exactly one asset named Mugen-Studio-<version>-windows.zip, uploaded,
// with GitHub's sha256 digest, by energyjp. Anything else is "no update".
//
// THE DOWNLOAD only on the person's click, over HTTPS from github.com and the
// hosts GitHub sends release downloads to (every redirect checked), into
// <copy>/.update/download.part. Then, in this order, any miss deleting what
// was written: the byte count, the sha256 against GitHub's digest, the zip's
// PK header, every name in it (one "Mugen Studio/" folder, no way out of it,
// no Windows-reserved or odd names, no links, no duplicates), the sizes, the
// files a copy must have and nothing a user owns, the version inside equal to
// the tag, and every file against the copy's own app/program-files.json. Each
// file is then unpacked with its CRC checked into .update/staged/, and
// .update/staged.json is written LAST: it is what says the staging is whole.
//
// NOTHING HERE TOUCHES THE RUNNING PROGRAM, Settings/ or Content/. Only
// <copy>/.update/ is written, and only in a portable copy (app/ beside
// MugenStudio.exe, a Settings folder, no studio.path). The checkout shows the
// check and nothing else.
//
// Test seam: MUGEN_STUDIO_UPDATE_API (tests only, like MUGEN_STUDIO_LAYOUT)
// replaces the API with a loopback mock, and is honored only as
// http://127.0.0.1:96xx - it can never point anywhere else.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const { once } = require('events');
const layout = require('./layout.js');

const REPO = 'energyjp/mugen-studio';
const OWNER = 'energyjp';
const UA = 'MugenStudio-Updater';
const AUTO_EVERY = 20 * 3600 * 1000;
const ZIP_TOP = 'Mugen Studio';
const MIN_SIZE = 10 * 1000 * 1000;
const MAX_SIZE = 2 * 1000 * 1000 * 1000;
const MAX_ENTRIES = 5000;
const MAX_TOTAL = 2 * 1024 * 1024 * 1024;
const MAX_RATIO = 200;
// The hosts a release download may pass through: GitHub's own, and where it
// redirects release assets (release-assets.githubusercontent.com today,
// objects.githubusercontent.com before).
const DOWNLOAD_HOSTS = new Set(['github.com', 'api.github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com']);
// What this copy unpacks from the top of a zip, under "Mugen Studio/".
// Anything else at the top is SKIPPED, not refused: these lists are frozen
// into every copy that ships, and it is the OLD copy that judges the NEW zip,
// so a later release that adds a top-level file must not be refused by every
// copy before it. (MugenStudio.exe only places the top files it knows, so a
// new one reaches an updated copy one release late: keep what the program
// needs inside app/.) REQUIRED is the part of the layout every future
// release must keep, by name (docs/LAYOUT.md "Updating itself").
const TOP_ALLOWED = new Set(['MugenStudio.exe', 'READ ME.txt', 'LICENSE.txt', 'THIRD-PARTY-NOTICES.txt', 'Desktop Export', 'Website Export', 'app']);
const TOP_USERS = new Set(['settings', 'content']);
const REQUIRED = ['MugenStudio.exe', 'app/studio-server.exe', 'app/server.js', 'app/program-layout.json',
  'app/program-files.json', 'app/studio-version.json'];

function apiConfig() {
  const env = process.env.MUGEN_STUDIO_UPDATE_API;
  const m = env ? /^http:\/\/127\.0\.0\.1:(96\d\d)\/?$/.exec(env) : null;
  return m ? { base: 'http://127.0.0.1:' + m[1], test: true } : { base: 'https://api.github.com', test: false };
}

// ---- the version -----------------------------------------------------------------
// ONE FILE says which version this is: studio-version.json beside the program.
// A tag "v2.5.1" and "2.5.1" are the same; only plain dotted numbers count.
function parseVersion(s) {
  const m = /^v?(\d{1,6}(?:\.\d{1,6}){0,3})$/.exec(String(s == null ? '' : s).trim());
  return m ? m[1].split('.').map(Number) : null;
}
function compare(a, b) {
  const x = parseVersion(a), y = parseVersion(b);
  if (!x || !y) return NaN;
  for (let i = 0; i < 4; i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}
const versionText = (s) => String(s).trim().replace(/^v/, '');
function readVersion(file) {
  try {
    const v = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')).version;
    return parseVersion(v) ? versionText(v) : '';
  } catch (e) { return ''; }
}
const VERSION = readVersion(path.join(__dirname, 'studio-version.json'));

// ---- where ---------------------------------------------------------------------------
const APP = layout.APP;
const ROOT = path.dirname(APP);
const UPD = path.join(ROOT, '.update');
const PART = path.join(UPD, 'download.part');
const STAGED = path.join(UPD, 'staged');
const STAGED_JSON = path.join(UPD, 'staged.json');
const JOURNAL = path.join(UPD, 'journal.json');
const RESULT = path.join(UPD, 'result.json');
const exists = (p) => { try { fs.lstatSync(p); return true; } catch (e) { return false; } };

// A copy this can update: the program in app/ beside MugenStudio.exe, its own
// Settings folder, no studio.path steering the window elsewhere. The
// checkout (no Settings folder) never is.
function where() {
  if (!layout.SETTINGS_DIR) return { portable: false, kind: 'checkout' };
  if (path.basename(APP).toLowerCase() !== 'app' || !exists(path.join(ROOT, 'MugenStudio.exe'))) return { portable: false, kind: 'layout' };
  if (exists(path.join(ROOT, 'studio.path'))) return { portable: false, kind: 'studio.path' };
  return { portable: true, kind: 'portable' };
}

// Delete inside .update only, and never through a link: a junction or a
// symbolic link is removed as itself, never followed (GRAIL: never
// recursive-delete through a junction). unlinkSync/rmdirSync, not rmSync: the
// Node the Studio ships returns from rmSync without deleting under a path with
// a non-ASCII character in it (lifebars.rmTree).
function removeUnder(p) {
  const base = path.resolve(UPD);
  const abs = path.resolve(p);
  if (abs !== base && !abs.startsWith(base + path.sep)) throw new Error('refusing to delete ' + abs + ': it is not in ' + base);
  let st;
  try { st = fs.lstatSync(abs); } catch (e) { if (e.code === 'ENOENT') return; throw e; }
  if (st.isSymbolicLink()) {
    try { fs.unlinkSync(abs); } catch (e) { fs.rmdirSync(abs); }
  } else if (st.isDirectory()) {
    for (const n of fs.readdirSync(abs)) removeUnder(path.join(abs, n));
    fs.rmdirSync(abs);
  } else {
    fs.unlinkSync(abs);
  }
  if (exists(abs)) throw new Error('could not delete ' + abs);
}
const quietRemove = (p) => { try { removeUnder(p); } catch (e) { console.log('Update: ' + e.message); } };

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); } catch (e) { return null; }
}
function writeWhole(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file + '.tmp', JSON.stringify(obj, null, 2) + '\n');
  fs.renameSync(file + '.tmp', file);
}

// The launcher is in the middle of an update (journal.json): this server is
// its health check or the new version's first start before it answered, and
// .update is not ours. A journal that says "confirmed" is not busy: the new
// version is running for good and the launcher only waits for the next start
// to delete the backup. That is the session that says "Updated", and it may
// download the next version. An unreadable journal is busy.
function launcherBusy() {
  if (!exists(JOURNAL)) return false;
  const j = readJson(JOURNAL);
  return !(j && j.step === 'confirmed');
}

// ---- the check -------------------------------------------------------------------------
const CACHE_FILE = layout.SETTINGS_DIR ? path.join(layout.SETTINGS_DIR, 'update-check.json') : '';
const S = { checkedAt: 0, etag: '', release: null, rateLimitedUntil: 0, offline: false, problem: '', skipAuto: '' };
let loaded = false;
function loadCache() {
  if (loaded) return;
  loaded = true;
  const c = CACHE_FILE ? readJson(CACHE_FILE) : null;
  if (!c || typeof c !== 'object') return;
  S.checkedAt = Number(c.checkedAt) || 0;
  S.etag = typeof c.etag === 'string' ? c.etag : '';
  S.rateLimitedUntil = Number(c.rateLimitedUntil) || 0;
  S.skipAuto = typeof c.skipAuto === 'string' ? c.skipAuto : '';
  // What was kept is checked again: a cache is a file anyone can edit.
  S.release = c.release && c.release.raw ? (accept(c.release.raw).release || null) : null;
  if (!S.release) S.etag = '';
}
function saveCache() {
  if (!CACHE_FILE) return;
  try {
    writeWhole(CACHE_FILE, { checkedAt: S.checkedAt, etag: S.etag, rateLimitedUntil: S.rateLimitedUntil, skipAuto: S.skipAuto,
      release: S.release ? { raw: S.release.raw } : null });
  } catch (e) { console.log('Update: could not keep the check in ' + CACHE_FILE + ' (' + e.message + ')'); }
}

// A release this Studio would offer, or { skip } for one it will not.
function accept(r) {
  if (!r || typeof r !== 'object') return { skip: 'not a release' };
  if (r.draft || r.prerelease) return { skip: 'a draft or pre-release' };
  if (!parseVersion(r.tag_name)) return { skip: 'tag ' + r.tag_name + ' is not a plain version' };
  const version = versionText(r.tag_name);
  const want = 'Mugen-Studio-' + version + '-windows.zip';
  const hits = (Array.isArray(r.assets) ? r.assets : []).filter((a) => a && a.name === want);
  if (hits.length !== 1) return { skip: (hits.length ? 'more than one ' : 'no ') + want };
  const a = hits[0];
  if (a.state !== 'uploaded') return { skip: want + ' is not uploaded' };
  if (!(Number(a.size) >= MIN_SIZE && Number(a.size) <= MAX_SIZE)) return { skip: want + ' has an odd size (' + a.size + ')' };
  if (typeof a.digest !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(a.digest)) return { skip: want + ' has no sha256 digest' };
  if (!r.author || r.author.login !== OWNER || !a.uploader || a.uploader.login !== OWNER) return { skip: 'not published by ' + OWNER };
  if (typeof a.browser_download_url !== 'string') return { skip: 'no download address' };
  const raw = {
    tag_name: r.tag_name, name: r.name, draft: false, prerelease: false, body: r.body, published_at: r.published_at,
    author: { login: r.author.login },
    assets: [{ name: a.name, state: a.state, size: a.size, digest: a.digest, uploader: { login: a.uploader.login }, browser_download_url: a.browser_download_url }],
  };
  return {
    release: {
      tag: String(r.tag_name), version,
      name: String(r.name || '').slice(0, 200),
      body: String(r.body || '').slice(0, 20000),
      publishedAt: String(r.published_at || ''),
      asset: { name: a.name, size: Number(a.size), sha256: a.digest.slice(7), url: a.browser_download_url },
      raw,
    },
  };
}

let checking = null;
let lastSkip = '';
async function check(opts) {
  if (checking) return checking;
  checking = doCheck(opts || {}).finally(() => { checking = null; });
  return checking;
}
async function doCheck({ auto }) {
  loadCache();
  const now = Date.now();
  if (auto && !layout.UPDATE_CHECK) return { asked: false };
  // The checkout keeps no cache and every test suite starts its server: it
  // only asks when the button is pressed, never on its own.
  if (auto && !where().portable) return { asked: false };
  if (now < S.rateLimitedUntil) return { asked: false };
  if (auto && S.checkedAt && now - S.checkedAt < AUTO_EVERY) return { asked: false };
  const cfg = apiConfig();
  const headers = { 'User-Agent': UA, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  if (S.etag && S.release) headers['If-None-Match'] = S.etag;
  let res;
  try {
    res = await fetch(cfg.base + '/repos/' + REPO + '/releases/latest',
      { headers, redirect: 'error', signal: AbortSignal.timeout(10000) });
  } catch (e) {
    S.offline = true;
    S.problem = 'offline';
    return { asked: true };
  }
  S.offline = false;
  S.problem = '';
  const h = (k) => res.headers.get(k);
  let body = null;
  if (res.status === 200) {
    try { body = JSON.parse(await res.text()); } catch (e) { body = null; }
  }
  if (res.status === 304) {
    S.checkedAt = now;
  } else if (res.status === 200 && body === null) {
    // Not JSON: a captive portal or a proxy's page, not GitHub. Like
    // offline: the cache stays and the daily look is not used up.
    S.offline = true;
    S.problem = 'offline';
  } else if (res.status === 200) {
    const a = accept(body);
    if (a.skip && a.skip !== lastSkip) { lastSkip = a.skip; console.log('Update: the latest release is not offered (' + a.skip + ')'); }
    S.release = a.release || null;
    S.etag = S.release ? (h('etag') || '') : '';
    S.checkedAt = now;
  } else if (res.status === 404) {
    // No release at all yet.
    S.release = null;
    S.etag = '';
    S.checkedAt = now;
  } else if ((res.status === 403 || res.status === 429) && (h('x-ratelimit-remaining') === '0' || h('retry-after'))) {
    const reset = Number(h('x-ratelimit-reset')) * 1000;
    const after = Number(h('retry-after')) * 1000;
    // Never more than two hours on GitHub's word alone.
    S.rateLimitedUntil = Math.min(now + 2 * 3600 * 1000, reset > now ? reset : now + (after > 0 ? after : 600 * 1000));
    S.problem = 'rate';
  } else {
    S.offline = res.status >= 500;
    S.problem = res.status >= 500 ? 'offline' : 'http ' + res.status;
  }
  try { await res.body?.cancel(); } catch (e) { /* read already */ }
  saveCache();
  return { asked: true };
}

// ---- what the page is told -------------------------------------------------------------
// The launcher's word on the last update (applied, rolled back, interrupted,
// blocked), read once: .update/result.json is taken in at start and deleted,
// and it stays here until the page says OK.
let OUTCOME = null;
function takeOutcome() {
  if (launcherBusy() || !where().portable) return;
  const r = readJson(RESULT);
  if (!exists(RESULT)) return;
  quietRemove(RESULT);
  if (!r || typeof r !== 'object' || !/^(applied|rolledBack|interrupted|blocked)$/.test(String(r.result))) return;
  OUTCOME = { result: r.result, from: String(r.from || ''), to: String(r.to || ''), reason: String(r.reason || '').slice(0, 600) };
  if (r.result === 'rolledBack' && OUTCOME.to) {
    // That version is not offered again on its own: only a press of Check
    // for updates brings it back.
    loadCache();
    S.skipAuto = OUTCOME.to;
    saveCache();
  }
}
function dismiss() { OUTCOME = null; }

function stagedInfo() {
  if (!where().portable || launcherBusy()) return null;
  const s = readJson(STAGED_JSON);
  if (!s || !parseVersion(s.version) || !(compare(s.version, VERSION) > 0) || !exists(path.join(STAGED, 'app'))) return null;
  return { version: String(s.version), size: Number(s.size) || 0 };
}

let D = null;
function state() {
  settleOnce();
  loadCache();
  const w = where();
  const rel = S.release;
  return {
    version: VERSION,
    portable: w.portable,
    copy: w.kind,
    canApply: w.portable && !launcherBusy(),
    autoCheck: layout.UPDATE_CHECK,
    checkedAt: S.checkedAt || null,
    latest: rel ? { version: rel.version, tag: rel.tag, name: rel.name, body: rel.body, publishedAt: rel.publishedAt, size: rel.asset.size } : null,
    newer: !!(rel && VERSION && compare(rel.version, VERSION) > 0),
    skipAuto: S.skipAuto || null,
    staged: stagedInfo(),
    download: D ? { got: D.got, total: D.total, phase: D.phase } : null,
    result: OUTCOME,
    rateLimitedUntil: S.rateLimitedUntil > Date.now() ? S.rateLimitedUntil : null,
    offline: S.offline,
    problem: S.problem || null,
  };
}

// ---- the download ------------------------------------------------------------------------
function hopAllowed(u, first) {
  let url;
  try { url = new URL(u); } catch (e) { return false; }
  if (url.username || url.password) return false;
  const firstPath = '/' + REPO + '/releases/download/';
  if (apiConfig().test) {
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !/^96\d\d$/.test(url.port)) return false;
    return !first || url.pathname.startsWith(firstPath);
  }
  if (url.protocol !== 'https:' || (url.port && url.port !== '443') || !DOWNLOAD_HOSTS.has(url.hostname)) return false;
  return !first || (url.hostname === 'github.com' && url.pathname.startsWith(firstPath));
}

function preflight(size) {
  const folder = ROOT;
  try {
    fs.mkdirSync(UPD, { recursive: true });
    const probe = path.join(UPD, 'probe.tmp');
    fs.writeFileSync(probe, 'probe');
    fs.unlinkSync(probe);
  } catch (e) {
    const why = e.code || e.message;
    throw new Error('The Studio can\'t update itself in ' + folder + ' (' + why + '). Move the Mugen Studio folder somewhere you own, such as Documents or the Desktop.');
  }
  let free = Infinity;
  try { const st = fs.statfsSync(ROOT); free = Number(st.bavail) * Number(st.bsize); } catch (e) { free = Infinity; }
  const need = Math.ceil(size * 2.5);
  if (free < need) {
    const drive = path.parse(ROOT).root || ROOT;
    const mb = Math.ceil(need / 1e6);
    throw new Error('Not enough free space on ' + drive + ' for the update (it needs about ' + mb + ' MB).');
  }
}

async function fetchAsset(asset, d) {
  let url = asset.url;
  for (let hop = 0; ; hop++) {
    if (hop > 5 || !hopAllowed(url, hop === 0)) {
      throw new Error('The download was sent somewhere other than GitHub, so the Studio stopped it.');
    }
    let res;
    try {
      res = await fetch(url, { redirect: 'manual', signal: d.ctrl.signal,
        headers: { 'User-Agent': UA, Accept: 'application/octet-stream', 'Accept-Encoding': 'identity' } });
    } catch (e) {
      if (d.cancelled) throw new Error('Download cancelled.');
      throw new Error('Couldn\'t reach GitHub for the download. Try again later.');
    }
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const loc = res.headers.get('location');
      try { await res.body?.cancel(); } catch (e) { /* nothing to read */ }
      if (!loc) throw new Error('The download was sent somewhere other than GitHub, so the Studio stopped it.');
      url = new URL(loc, url).href;
      continue;
    }
    if (res.status !== 200) {
      try { await res.body?.cancel(); } catch (e) { /* nothing to read */ }
      const status = res.status;
      throw new Error('GitHub answered ' + status + ' for the download. Try again later.');
    }
    const len = Number(res.headers.get('content-length'));
    if (len !== asset.size) {
      try { await res.body?.cancel(); } catch (e) { /* nothing to read */ }
      throw new Error('The download\'s size doesn\'t match what GitHub lists, so the Studio stopped it.');
    }
    return res;
  }
}

async function streamTo(res, file, d, onProgress) {
  const hash = crypto.createHash('sha256');
  const out = fs.createWriteStream(file);
  let idle = null;
  const poke = () => { clearTimeout(idle); idle = setTimeout(() => { d.stalled = true; d.ctrl.abort(); }, 60000); };
  let last = 0;
  try {
    poke();
    for await (const chunk of res.body) {
      poke();
      d.got += chunk.length;
      if (d.got > d.total) throw new Error('The download was bigger than GitHub lists, so the Studio stopped it.');
      hash.update(chunk);
      if (!out.write(chunk)) await once(out, 'drain');
      const now = Date.now();
      if (now - last >= 250) { last = now; onProgress && onProgress({ got: d.got, total: d.total }); }
    }
  } catch (e) {
    if (d.cancelled) throw new Error('Download cancelled.');
    if (/bigger than GitHub/.test(e.message)) throw e;
    throw new Error('The download was cut short. Try again.');
  } finally {
    clearTimeout(idle);
    out.end();
    try { await once(out, 'close'); } catch (e) { /* closed */ }
  }
  onProgress && onProgress({ got: d.got, total: d.total });
  return hash.digest('hex');
}

// ---- the zip -------------------------------------------------------------------------
// The central directory, read once: every entry with what extraction needs.
// No zip64 (a copy is far below 4 GB), no spanning, no encryption.
function readCentral(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const read = (len, at) => { const b = Buffer.alloc(len); fs.readSync(fd, b, 0, len, at); return b; };
    if (size < 22) return null;
    const head = read(4, 0);
    if (head.readUInt32LE(0) !== 0x04034b50) return { bad: 'pk' };
    const tailLen = Math.min(size, 22 + 65535);
    const tail = read(tailLen, size - tailLen);
    let e = -1;
    for (let i = tailLen - 22; i >= 0; i--) if (tail.readUInt32LE(i) === 0x06054b50) { e = i; break; }
    if (e < 0) return null;
    const disk = tail.readUInt16LE(e + 4), cdDisk = tail.readUInt16LE(e + 6);
    const count = tail.readUInt16LE(e + 10), cdSize = tail.readUInt32LE(e + 12), cdOff = tail.readUInt32LE(e + 16);
    if (disk || cdDisk || count === 0xffff || cdSize === 0xffffffff || cdOff === 0xffffffff) return null;
    if (count > MAX_ENTRIES) return { bad: 'many' };
    if (cdOff + cdSize > size) return null;
    const cd = read(cdSize, cdOff);
    const entries = [];
    let p = 0;
    for (let k = 0; k < count; k++) {
      if (p + 46 > cd.length || cd.readUInt32LE(p) !== 0x02014b50) return null;
      const nl = cd.readUInt16LE(p + 28), xl = cd.readUInt16LE(p + 30), cl = cd.readUInt16LE(p + 32);
      const raw = cd.slice(p + 46, p + 46 + nl);
      entries.push({
        name: raw.toString('utf8'),
        made: cd.readUInt16LE(p + 4), flags: cd.readUInt16LE(p + 8), method: cd.readUInt16LE(p + 10),
        crc: cd.readUInt32LE(p + 16), csize: cd.readUInt32LE(p + 20), usize: cd.readUInt32LE(p + 24),
        ext: cd.readUInt32LE(p + 38), off: cd.readUInt32LE(p + 42), raw,
      });
      p += 46 + nl + xl + cl;
    }
    return { entries, size };
  } finally {
    fs.closeSync(fd);
  }
}

const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9]|conin\$|conout\$)(\..*)?$/i;
function badSegment(s) {
  if (!s || s === '.' || s === '..') return true;
  if (/[\x00-\x1f\\:*?"<>|]/.test(s)) return true;
  if (/[. ]$/.test(s)) return true;
  return RESERVED.test(s);
}

// Every check that needs no unpacking. -> { files, dirs } (paths under the top
// folder) or throws the sentence that says which check failed.
function validateZip(file, version) {
  const notCopy = () => new Error('The download isn\'t a Mugen Studio copy, so the Studio didn\'t use it.');
  const z = readCentral(file);
  if (z && z.bad === 'pk') throw new Error('The download isn\'t a zip file, so the Studio didn\'t use it.');
  if (!z) throw new Error('The download\'s zip can\'t be read, so the Studio didn\'t use it.');
  if (z.bad === 'many') throw notCopy();
  const seen = new Set();
  const files = [], dirs = [];
  let total = 0;
  for (const e of z.entries) {
    const n = e.name;
    if (e.flags & 1) throw notCopy();
    if (e.method !== 0 && e.method !== 8) throw notCopy();
    if (!n.startsWith(ZIP_TOP + '/')) throw notCopy();
    const rest = n.slice(ZIP_TOP.length + 1);
    if (!rest) { if (e.usize) throw notCopy(); continue; }
    const isDir = rest.endsWith('/');
    const rel = isDir ? rest.slice(0, -1) : rest;
    const segs = rel.split('/');
    if (segs.some(badSegment)) throw new Error('The download holds a file name the Studio won\'t write, so it didn\'t use it.');
    // A link stored by a Unix zip tool (made by 3, S_IFLNK in the high bits).
    if ((e.made >> 8) === 3 && ((e.ext >>> 16) & 0xf000) === 0xa000) throw notCopy();
    const key = rel.toLowerCase();
    if (seen.has(key)) throw notCopy();
    seen.add(key);
    const folder = segs[0];
    if (TOP_USERS.has(folder.toLowerCase())) {
      throw new Error('The download holds a ' + folder + ' folder, which only you should have, so the Studio didn\'t use it.');
    }
    // Not one this copy knows: left in the zip, never unpacked (above).
    if (!TOP_ALLOWED.has(segs[0])) continue;
    if (isDir) { if (e.usize) throw notCopy(); dirs.push(rel); continue; }
    total += e.usize;
    if (total > MAX_TOTAL) throw notCopy();
    if (e.usize > 1024 * 1024 && e.usize > MAX_RATIO * Math.max(1, e.csize)) throw notCopy();
    files.push({ rel, e });
  }
  const have = new Set(files.map((f) => f.rel));
  for (const r of REQUIRED) if (!have.has(r)) throw notCopy();
  return { files, dirs, total };
}

// One entry's bytes (small JSON files only).
function entryBuffer(file, e) {
  const fd = fs.openSync(file, 'r');
  try {
    const lh = Buffer.alloc(30);
    fs.readSync(fd, lh, 0, 30, e.off);
    if (lh.readUInt32LE(0) !== 0x04034b50) return null;
    const at = e.off + 30 + lh.readUInt16LE(26) + lh.readUInt16LE(28);
    const raw = Buffer.alloc(e.csize);
    fs.readSync(fd, raw, 0, e.csize, at);
    const buf = e.method === 0 ? raw : zlib.inflateRawSync(raw);
    if (buf.length !== e.usize || (crc32(buf, 0) >>> 0) !== e.crc) return null;
    return buf;
  } catch (err) {
    return null;
  } finally {
    fs.closeSync(fd);
  }
}
const jsonEntry = (file, e) => { const b = entryBuffer(file, e); try { return b ? JSON.parse(b.toString('utf8').replace(/^﻿/, '')) : null; } catch (x) { return null; } };

// What is inside, checked against itself: the version it says it is, a
// program layout with a Settings folder, and every app/ file the size its
// own program-files.json says.
function checkInside(file, z, version) {
  const notCopy = () => new Error('The download isn\'t a Mugen Studio copy, so the Studio didn\'t use it.');
  const by = new Map(z.files.map((f) => [f.rel, f.e]));
  const v = jsonEntry(file, by.get('app/studio-version.json'));
  if (!v || !parseVersion(v.version) || compare(v.version, version) !== 0) {
    throw new Error('The download says it is a different version than GitHub lists, so the Studio didn\'t use it.');
  }
  const pl = jsonEntry(file, by.get('app/program-layout.json'));
  if (!pl || typeof pl.settings !== 'string' || !pl.settings) throw notCopy();
  const list = jsonEntry(file, by.get('app/program-files.json'));
  if (!Array.isArray(list)) throw notCopy();
  const listed = new Map();
  for (const it of list) {
    if (!it || typeof it.path !== 'string' || !Number.isFinite(it.size)) throw notCopy();
    listed.set('app/' + it.path, it.size);
  }
  for (const f of z.files) {
    if (!f.rel.startsWith('app/') || f.rel === 'app/program-files.json') continue;
    if (listed.get(f.rel) !== f.e.usize) throw notCopy();
  }
  for (const p of listed.keys()) if (!by.has(p)) throw notCopy();
}

let CRC_TABLE = null;
function crc32(buf, prev) {
  if (typeof zlib.crc32 === 'function') return zlib.crc32(buf, prev >>> 0);
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC_TABLE[n] = c; }
  }
  let c = (prev >>> 0) ^ 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function extractTo(file, z, dest, d) {
  const root = path.resolve(dest);
  fs.mkdirSync(root, { recursive: true });
  const inside = (rel) => {
    const p = path.resolve(root, ...rel.split('/'));
    if (!p.startsWith(root + path.sep)) throw new Error('The download holds a file name the Studio won\'t write, so it didn\'t use it.');
    return p;
  };
  for (const rel of z.dirs) fs.mkdirSync(inside(rel), { recursive: true });
  const fd = fs.openSync(file, 'r');
  try {
    for (const { rel, e } of z.files) {
      if (d.cancelled) throw new Error('Download cancelled.');
      const out = inside(rel);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      const lh = Buffer.alloc(30);
      fs.readSync(fd, lh, 0, 30, e.off);
      const nl = lh.readUInt16LE(26), xl = lh.readUInt16LE(28);
      const lname = Buffer.alloc(nl);
      fs.readSync(fd, lname, 0, nl, e.off + 30);
      if (lh.readUInt32LE(0) !== 0x04034b50 || !lname.equals(e.raw)) {
        throw new Error('The download\'s zip can\'t be read, so the Studio didn\'t use it.');
      }
      const at = e.off + 30 + nl + xl;
      let crc = 0, n = 0;
      const ws = fs.createWriteStream(out, { flags: 'wx' });
      const src = e.csize ? fs.createReadStream(null, { fd, autoClose: false, start: at, end: at + e.csize - 1 }) : null;
      const body = !src ? [] : (e.method === 8 ? src.pipe(zlib.createInflateRaw()) : src);
      try {
        for await (const chunk of body) {
          crc = crc32(chunk, crc);
          n += chunk.length;
          if (n > e.usize) throw new Error('size');
          if (!ws.write(chunk)) await once(ws, 'drain');
        }
      } catch (err) {
        ws.destroy();
        throw new Error('A file in the download is damaged (' + rel + '), so the Studio didn\'t use it.');
      } finally {
        ws.end();
        try { await once(ws, 'close'); } catch (x) { /* closed */ }
      }
      if (n !== e.usize || (crc >>> 0) !== e.crc) {
        throw new Error('A file in the download is damaged (' + rel + '), so the Studio didn\'t use it.');
      }
    }
  } finally {
    fs.closeSync(fd);
  }
}

// THE DOWNLOAD, on the person's click. Single-flight. onProgress hears
// { got, total } at most every 250 ms. -> the staged version.
async function download(onProgress) {
  if (D) throw new Error('The update is already downloading.');
  settleOnce();
  const w = where();
  if (!w.portable) throw new Error('This copy updates by hand.');
  if (launcherBusy()) throw new Error('An update is still finishing. Restart the Studio first.');
  loadCache();
  const rel = S.release;
  if (!rel || !(compare(rel.version, VERSION) > 0)) throw new Error('There is no newer version to download.');
  const st = stagedInfo();
  if (st && st.version === rel.version) return st;
  preflight(rel.asset.size);
  D = { got: 0, total: rel.asset.size, phase: 'download', ctrl: new AbortController(), cancelled: false };
  const d = D;
  try {
    quietRemove(PART);
    const res = await fetchAsset(rel.asset, d);
    const sum = await streamTo(res, PART, d, onProgress);
    if (d.cancelled) throw new Error('Download cancelled.');
    if (d.got !== rel.asset.size) throw new Error('The download was cut short. Try again.');
    d.phase = 'verify';
    if (sum !== rel.asset.sha256) throw new Error('The download doesn\'t match what GitHub lists for it, so the Studio didn\'t use it.');
    const z = validateZip(PART, rel.version);
    checkInside(PART, z, rel.version);
    d.phase = 'unpack';
    onProgress && onProgress({ got: d.got, total: d.total, phase: 'unpack' });
    // The marker first: a staged/ half deleted under a staged.json that
    // outlived it would read as whole.
    removeUnder(STAGED_JSON);
    removeUnder(STAGED);
    await extractTo(PART, z, STAGED, d);
    if (d.cancelled) throw new Error('Download cancelled.');
    writeWhole(STAGED_JSON, { version: rel.version, tag: rel.tag, sha256: sum, size: rel.asset.size, files: z.files.length, stagedAt: new Date().toISOString() });
    removeUnder(PART);
    console.log('Update: ' + rel.version + ' is downloaded, checked and staged in ' + STAGED);
    return stagedInfo();
  } catch (e) {
    quietRemove(PART);
    quietRemove(STAGED_JSON);
    quietRemove(STAGED);
    console.log('Update: the download stopped (' + e.message + ')');
    throw e;
  } finally {
    D = null;
  }
}

function cancel() {
  if (D) { D.cancelled = true; D.ctrl.abort(); return true; }
  settleOnce();
  // Nothing running: a staged update the person no longer wants goes too.
  if (where().portable && !launcherBusy()) {
    quietRemove(PART);
    quietRemove(STAGED_JSON);
    quietRemove(STAGED);
  }
  return false;
}

// Once, with no update under way: what a stopped download or an older
// staging left behind goes, and the launcher's last word is read. Tried at
// load and again on every look at the state: the new version's first server
// loads BEFORE its launcher confirms (journal at step H), and its "Updated"
// must still show in that same session.
let settled = false;
function settleOnce() {
  if (settled) return;
  try { settle(); } catch (e) { console.log('Update: ' + e.message); }
}
function settle() {
  if (!where().portable || launcherBusy()) return;
  settled = true;
  if (!exists(UPD)) return;
  quietRemove(PART);
  quietRemove(path.join(UPD, 'probe.tmp'));
  const s = readJson(STAGED_JSON);
  if (!s || !(compare(s.version, VERSION) > 0)) {
    quietRemove(STAGED_JSON);
    quietRemove(STAGED);
  }
  takeOutcome();
}
settleOnce();

function setAuto(on) { return layout.setUpdateCheck(!!on); }

module.exports = {
  VERSION, parseVersion, compare, accept, check, state, download, cancel, dismiss, setAuto,
  // for tests and the release gate (tools/check-update-zip.js)
  validateZip, checkInside, readCentral, hopAllowed, where, UPD, ROOT,
};
