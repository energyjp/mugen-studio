// Dev server for the Ikemen GO web build.
//   /ikemen/index.html   - play the game (VFS assembled live from roster.json)
//   /studio.html         - Mod Studio: drag-drop characters/stages/music
//   /api/*               - Studio backend (roster edits, uploads, export)

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const os = require('os');
const { pipeline } = require('stream');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const localConfig = require('./local-config.js');
const stagegen = require('./stagegen.js');

// The project targets the V2 engine (rollback/delay netcode, INI config,
// ikemen-v2.wasm). Default to it so a plain `node server.js` Studio previews
// AND exports V2. Pass --v1 only to work with the legacy master-branch build.
// (--v2 still accepted as a harmless explicit opt-in.)
if (!process.argv.includes('--v1')) process.env.IKEMEN_V2 = '1';
const layout = require('./layout');
// A BUILD OPENED READ-ONLY (an external bundle, layout.js): from here on any
// write under it fails with EROFS, whatever code asks - installed before the
// other modules load, so none of them ever holds an unguarded fs. The 409
// table below answers the routes that change content before they get that
// far; this is what keeps the promise for everything the table cannot see.
if (layout.readOnly && layout.externalRoot) {
  require('./readonlyfs.js').install({
    root: layout.externalRoot,
    onRefuse: (e) => console.error('  Read-only: refused ' + e.syscall + ' on ' + e.path),
  });
}
const stagethumb = require('./stagethumb');
const vfslib = require('./vfslib');
const modlib = require('./modlib');
const { exportSite, makeBoardArt } = require('./export');

// The VFS index is rebuilt lazily whenever Studio edits invalidate it.
let vfs = null;
function getVfs() {
  // privateMenu: this Studio is its host's own - the author's, or a host
  // running a shareable copy - and the play page it serves is that host's
  // private web build, so ranked and casual belong in it when their roster
  // ticks Online menu. Nothing served here leaves the machine. desktop.js and
  // make-kit.js never pass this flag (the kit also disables the injector at
  // source); a shareable portable copy ships it live, and its host's roster
  // decides, the same way the author's does.
  // In a build open read-only this is the match view (vfslib.js): the engine,
  // the screenpack and the match chosen at /api/readonly/match, never the
  // whole build.
  if (!vfs) vfs = vfslib.build({ privateMenu: true });
  return vfs;
}
// A TEMP file or folder this server made, removed with the checked delete
// (lifebars.js rmTree / rmFile): the Node the Studio ships returns from its
// own rm without deleting anything when the path holds a non-ASCII character,
// and TEMP does exactly that for a Windows user named with an accent. A miss
// only leaves litter in TEMP, so it never fails the request.
function rmTemp(p, isFile) {
  try { const lb = require('./lifebars.js'); if (isFile) lb.rmFile(p); else lb.rmTree(p); } catch (e) { /* litter, not a failure */ }
}

// Remove staging directories left by drops that never committed. Called on
// the first part of a new drop, so it costs one readdir of a directory that
// is normally empty.
function sweepStaging(base, keep) {
  try {
    const cutoff = Date.now() - 60 * 60 * 1000;
    for (const name of fs.readdirSync(base)) {
      if (name === keep) continue;
      const p = path.join(base, name);
      try {
        if (fs.statSync(p).mtimeMs < cutoff) rmTemp(p);
      } catch (e) { /* raced with another sweep */ }
    }
  } catch (e) { /* nothing staged yet */ }
}

function invalidateVfs() { vfs = null; }
// The build's file list in lower case, per VFS index (/api/stage-attachfix
// asks it whether the game folder or data/ holds a stage's attached
// character); a rebuilt index is a new key, so it is never stale.
const attachIndex = new WeakMap();

// A BUILD OPEN READ-ONLY IS PLAYED ONE MATCH AT A TIME (vfslib.js, the match
// view): the engine's file list is the two characters and the stage chosen at
// POST /api/readonly/match, never the whole roster. Until one is chosen the
// list is not made at all, and the game page shows this instead (vfs.js shows
// a plain-text answer as it is).
const NO_MATCH_YET = 'This build is open read-only, and a whole build is too big to load in a browser'
  + ' - choose two characters and a stage in the Studio to play a match.';

function serveIkemenFs(req, res, pathname) {
  if (layout.readOnly && !vfslib.matchView() && (pathname === '/ikemen-fs/manifest.json' || pathname.startsWith('/ikemen-fs/file/'))) {
    res.writeHead(409, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(NO_MATCH_YET);
    return true;
  }
  const { generated, index } = getVfs();
  if (pathname === '/ikemen-fs/manifest.json') {
    const files = {};
    for (const [vpath, abs] of index) {
      if (abs === null) {
        files[vpath] = generated[vpath].length;
      } else {
        try { files[vpath] = fs.statSync(abs).size; } catch { /* skip */ }
      }
    }
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ files }));
    return true;
  }
  const prefix = '/ikemen-fs/file/';
  if (pathname.startsWith(prefix)) {
    const vpath = decodeURIComponent(pathname.slice(prefix.length));
    if (!index.has(vpath)) {
      res.writeHead(404); res.end('no such vfs file');
      return true;
    }
    const abs = index.get(vpath);
    // THE BUILD'S FILES ARE DATA, NEVER PAGES. They are other people's
    // downloads - a character may carry an .html or .svg its .def names - and
    // served from this origin as text/html they would run as the Studio's own
    // page, which every Origin check above takes at its word. A sandboxed
    // response has an opaque origin of its own, and nosniff keeps a file's type
    // what its extension says. The engine page reads these with fetch(), which
    // neither header touches; an <audio> preview is not affected either.
    const DATA_ONLY = { 'Content-Security-Policy': 'sandbox', 'X-Content-Type-Options': 'nosniff' };
    if (abs === null) {
      res.writeHead(200, Object.assign({ 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store' }, DATA_ONLY));
      res.end(generated[vpath]);
    } else {
      serveFile(req, res, abs, DATA_ONLY);
    }
    return true;
  }
  return false;
}

// --- Studio API -------------------------------------------------------------

// A destination has to be an absolute path, and it must not be the program
// folder itself: an export writes hundreds of megabytes and deletes what it
// replaces, and pointing that at the working tree would eat the sources it was
// built from. Nor a build open read-only, a bundle's folder, or a folder that
// holds either or the Studio's own folders (bundles.js exportClash): the
// exporters' own checks would take a read-only Ikemen GO install, or one with
// a Studio copy inside it, for a build they may replace.
function exportDest(dest) {
  if (!dest) return undefined;
  const d = String(dest);
  if (!path.isAbsolute(d)) throw new Error('export folder must be an absolute path');
  const norm = path.resolve(d);
  if (norm === path.resolve(ROOT)) throw new Error('that is the program folder itself - pick another');
  const clash = require('./bundles.js').exportClash(norm, layout);
  if (clash) throw new Error(clash);
  return norm;
}

// THE FOLDERS THIS SERVER'S EXPORTS JUST WROTE, for the export result card
// (studio.html showExportCard): Open folder, Play this export and Make .zip
// name an export by the id it was given here, never by a path. So the play
// route can serve only a folder an export of this server process wrote, and
// the zip and open routes can only reach one. In memory: a restart forgets
// them, along with the card that held the ids. The last few only.
const EXPORTS = new Map();   // id -> { dir, kind: 'web' | 'desktop' }
function rememberExport(dir, kind) {
  const id = require('crypto').randomBytes(8).toString('hex');
  EXPORTS.set(id, { dir: path.resolve(dir), kind });
  while (EXPORTS.size > 12) EXPORTS.delete(EXPORTS.keys().next().value);
  return id;
}
function exportById(id) {
  return /^[0-9a-f]{16}$/.test(String(id || '')) ? EXPORTS.get(String(id)) || null : null;
}
const zipsRunning = new Set();

// What the card shows beside an export's own result: the folder's files and
// size, its largest file, and the id. A summary that cannot be read is left
// out rather than failing an export that has already happened.
function exportCardInfo(dir, kind) {
  const card = { id: rememberExport(dir, kind) };
  try { card.summary = require('./export').folderSummary(dir); } catch (e) { card.summary = null; }
  return card;
}

// PLAY THIS EXPORT: /exported/<id>/<file> serves the folder a Website export
// just wrote, read-only, so the build runs from a web address exactly as it
// will on a host (a page opened as a file cannot fetch its own data). Only a
// folder in EXPORTS, only GET and HEAD, only files inside it: a path that
// resolves outside the folder - "..", an encoded backslash, a drive letter,
// a link - is refused, and so is a name with a colon (an NTFS stream) or a
// dotfile (.htaccess, as a host would). Only the Studio's own pages or an
// address typed in (Sec-Fetch-Site, as for /api/). The exporter's own pages
// sit at the folder's top; anything below it (ikemen-fs/, leaderboard-art/)
// is served as data, never as a page, the way /ikemen-fs/ is.
function serveExported(req, res, pathname) {
  const m = /^\/exported\/([^/]*)(\/.*)?$/.exec(pathname);
  const ex = m && exportById(m[1]);
  if (!ex || ex.kind !== 'web') { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('No such export. Export again from the Studio.'); return; }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET, HEAD' }); res.end(); return; }
  if (!ownFetch(req)) { res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('refused: the Studio only answers its own pages'); return; }
  // /exported/<id> -> /exported/<id>/, so the page's relative addresses
  // (ikemen-fs/..., ikemen.wasm) resolve inside the export.
  if (m[2] === undefined) { res.writeHead(302, { Location: '/exported/' + m[1] + '/' }); res.end(); return; }
  let rel;
  try { rel = decodeURIComponent(m[2].slice(1)); } catch (e) { res.writeHead(400); res.end('bad address'); return; }
  if (rel === '' || rel.endsWith('/')) rel += 'index.html';
  const refuse = () => { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Not found'); };
  if (/[\0:]/.test(rel) || rel.split(/[/\\]/).some((s) => s.startsWith('.'))) return refuse();
  const root = ex.dir;
  const file = path.resolve(root, rel);
  if (!file.startsWith(root + path.sep)) return refuse();
  // A link inside the folder must not lead out of it either.
  let real;
  try { real = fs.realpathSync.native(file); } catch (e) { return refuse(); }
  let realRoot;
  try { realRoot = fs.realpathSync.native(root); } catch (e) { return refuse(); }
  const fold = (p) => (process.platform === 'win32' ? p.toLowerCase() : p);
  if (!fold(real).startsWith(fold(realRoot) + path.sep)) return refuse();
  const topLevel = path.dirname(file) === root;
  serveFile(req, res, file, topLevel ? undefined : { 'Content-Security-Policy': 'sandbox', 'X-Content-Type-Options': 'nosniff' });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function json(res, status, obj) {
  // A write the read-only guard refused, wherever it was caught - a route's
  // own catch answers 400 or 500 with the error's text - is the 409 the table
  // below gives, never a failure of the route.
  if (status >= 400 && layout.readOnly && obj && /\bEROFS\b/.test(String(obj.error || ''))) {
    status = 409;
    obj = Object.assign({}, obj, readOnlyAnswer(res.apiPath || ''), { detail: String(obj.error) });
  }
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

// ROUTES THAT DO SOMETHING ON THE DESKTOP - start a program, open a folder or
// a file in another program, or put up a dialog - ANSWER ONLY THIS SERVER'S
// OWN PAGES.
//
// Binding to 127.0.0.1 keeps other machines out; it does not keep out another
// WEB PAGE open on this machine. Any site can make the browser POST to
// http://127.0.0.1:<port>/api/launch-build - a "simple" request, sent without
// asking - and without this check it would start a program on this desktop.
// A browser always sends Origin on such a cross-site POST, and its value is
// the page's origin, which a page cannot forge. So: an Origin that is not ours
// is refused; no Origin at all passes, because that is the Studio's own tools,
// curl and the tests, none of which a web page can be.
//
// Ours is http://127.0.0.1:<port> (what the desktop shell opens) or
// http://localhost:<port> (what the startup banner prints).
//
// AND EVERY OTHER ROUTE THAT WRITES. Guarding only the five that start
// something left the files they start writable from anywhere: /api/roster
// takes a whole roster, /api/motif-def writes text to the screenpack the
// roster names, and a page that could POST those could rewrite what Launch
// starts. So every /api/ request that is not a GET (or HEAD) answers only
// our own pages as well - which is every POST the Studio's pages make.
//
// A GET carries no Origin when it is a navigation or an image load, so for
// reads the browser's Sec-Fetch-Site header is the test: sent on every request
// a browser makes, 'same-origin' from our own pages and 'none' for an address
// typed in, it is 'cross-site' or 'same-site' when another page asked. Those
// are refused on every /api/ route; a request with no such header (the
// Studio's own tools, curl, the tests) is not a browser's and passes.
const DESKTOP_ACTION_ROUTES = new Set([
  '/api/open-path', '/api/launch-build', '/api/pick-file', '/api/open-folder', '/api/launch-pair',
  '/api/host-open', '/api/export-open', '/api/export-play', '/api/mods/open',
]);
function ownOrigin(req) {
  const o = req.headers && req.headers.origin;
  if (o === undefined) return true;
  const v = String(o).toLowerCase();
  return v === 'http://127.0.0.1:' + PORT || v === 'http://localhost:' + PORT;
}
function ownFetch(req) {
  const s = req.headers && req.headers['sec-fetch-site'];
  if (s === undefined) return true;
  const v = String(s).toLowerCase();
  return v === 'same-origin' || v === 'none';
}
const WRITES = (req) => req.method !== 'GET' && req.method !== 'HEAD';

// A BUILD OPENED READ-ONLY ANSWERS 409 TO EVERY ROUTE THAT WOULD CHANGE IT.
//
// An external bundle (layout.js, bundles.openExternal) is somebody's install,
// read where it is, with a roster made from the build's own select.def. So a
// change to any of it - the roster, a character, a stage, the screenpack, the
// bundle's palettes and portraits, its mods, an export of it, content added to
// or removed from it - is refused before the route runs, with the reason in
// words. Reads, previews, the desktop actions, the bundles themselves and the
// Studio's own settings go ahead. (The whole-build import is allowed: it makes
// a NEW bundle of the Studio's own, copied from wherever it is pointed.)
//
// Every route that is not a GET is in one of the two lists below, and one in
// neither is refused: a route added later starts out refused in a read-only
// bundle until somebody decides otherwise here. readonlyfs.js stands behind
// the table for whatever it does not cover.
const READ_ONLY_ALLOWED = new Set([
  '/api/bundles/switch', '/api/bundles/new', '/api/bundles/open-external', '/api/build-import',
  // forgetting ANOTHER build opened in place deletes only that record, in
  // Content/ (bundles.removeExternal refuses the one open now)
  '/api/bundles/remove-external',
  '/api/download-folder', '/api/local-config/test', '/api/players',
  '/api/open-path', '/api/open-folder', '/api/launch-build', '/api/pick-file',
  '/api/export-open', '/api/export-play', '/api/mods/open',
  // the match view: which two characters and stage the web game loads - held
  // in memory, nothing written
  '/api/readonly/match',
  // the H-MUGEN module's answers: the bundle's roster.json, the Studio's own
  // record in a read-only bundle (hmodule.js)
  '/api/h-settings',
  // the host's servers, kept in the Studio's own settings (setup, use and
  // remove also write the bundle's leaderboard address, so they are refused)
  '/api/host-open', '/api/host-token', '/api/host-subdomain', '/api/host-test', '/api/host-forget', '/api/host-export',
]);
const READ_ONLY_REFUSED = new Map(Object.entries({
  'changing the roster': ['/api/roster', '/api/build-order', '/api/max-matches', '/api/char-props', '/api/settings',
    '/api/keys', '/api/button-style', '/api/local-config', '/api/board-art', '/api/host-setup', '/api/host-use', '/api/host-remove',
    '/api/online-setup/copy', '/api/leaderboard-rank-image', '/api/leaderboard-background'],
  'editing a character': ['/api/char-rename', '/api/char-variant', '/api/char-move-edit', '/api/char-move-add',
    '/api/char-edit-revert', '/api/char-air-edit', '/api/char-hit', '/api/char-scale', '/api/char-consts',
    '/api/char-stats', '/api/char-consts-reset', '/api/add-dependency', '/api/fix-pal-applier', '/api/movelist'],
  'changing palettes': ['/api/palette-order', '/api/custom-palettes', '/api/custom-palettes-import',
    '/api/convert-png-palettes', '/api/fill-palette-gaps', '/api/fix-palettes', '/api/fix-palette-keys'],
  'changing portraits': ['/api/portrait', '/api/portrait-picture', '/api/portrait-fit', '/api/portrait-fix', '/api/portrait-revert'],
  'editing a stage': ['/api/stage-widefit', '/api/stage-thumbfit', '/api/stage-thumb-add', '/api/stage-thumb-remove',
    '/api/stage-textransform', '/api/stage-widefit3d', '/api/stage-attachfix', '/api/stage-nearfit'],
  'changing the screenpack': ['/api/motif-def', '/api/motif-describe-rows', '/api/motif-grid', '/api/theme',
    '/api/theme-layout', '/api/theme-options', '/api/theme-remove', '/api/theme-copy', '/api/remove-logo'],
  'changing the engine settings': ['/api/engine-const', '/api/lifebar', '/api/lifebars'],
  'changing mods': ['/api/mods/toggle', '/api/mods/remove'],
  'adding content': ['/api/add-local', '/api/upload', '/api/upload-part', '/api/upload-folder', '/api/stage-from-image'],
  'removing content': ['/api/remove', '/api/remove-many'],
  'exporting': ['/api/export', '/api/export-desktop', '/api/export-zip', '/api/leaderboard-art'],
  // The pair bench's launch starts THIS bundle's desktop export on two of its
  // characters (modlib.launchPair) - and a read-only bundle has none, since
  // exporting it is refused, so it could only ever answer "run Desktop Export
  // first". It copies nothing; a match is played in the browser instead
  // (/api/readonly/match). Launch Ikemen GO itself stays allowed.
  'launching a pair from a desktop export': ['/api/launch-pair'],
}).flatMap(([what, routes]) => routes.map((r) => [r, what])));
function readOnlyAnswer(pathname) {
  const what = READ_ONLY_REFUSED.get(pathname) || 'this change';
  return { error: readOnlySays(what), readOnly: true };
}
// The refusal as one sentence for each kind of change, so a page can show it
// in another language; a kind added above without one here still reads right.
function readOnlySays(what) {
  switch (what) {
    case 'changing the roster': return 'This build is open read-only - changing the roster is not available';
    case 'editing a character': return 'This build is open read-only - editing a character is not available';
    case 'changing palettes': return 'This build is open read-only - changing palettes is not available';
    case 'changing portraits': return 'This build is open read-only - changing portraits is not available';
    case 'editing a stage': return 'This build is open read-only - editing a stage is not available';
    case 'changing the screenpack': return 'This build is open read-only - changing the screenpack is not available';
    case 'changing the engine settings': return 'This build is open read-only - changing the engine settings is not available';
    case 'changing mods': return 'This build is open read-only - changing mods is not available';
    case 'adding content': return 'This build is open read-only - adding content is not available';
    case 'removing content': return 'This build is open read-only - removing content is not available';
    case 'exporting': return 'This build is open read-only - exporting is not available';
    case 'launching a pair from a desktop export': return 'This build is open read-only - launching a pair from a desktop export is not available';
    case 'this change': return 'This build is open read-only - this change is not available';
    default: return 'This build is open read-only - ' + what + ' is not available';
  }
}
const readOnlyRefuses = (req, pathname) => layout.readOnly && WRITES(req) && !READ_ONLY_ALLOWED.has(pathname);
// /api/studio's first answer in a read-only bundle (modlib.studioInfoLight),
// made once: nothing the Studio does there can change it.
let readOnlyLight = null;

// A STAGE'S FILE AS THE ROSTER NAMES IT, made a path under the stages folder.
// A bundle's own stages are bare names (kfm.def); a build opened in place
// keeps some in folders of their own (stages/<folder>/x.def, GRAIL 3.18), so
// the stage routes take a path under the folder too - forward slashes only,
// no empty, '.' or '..' part, nothing absolute, no drive or stream colon, and
// what it resolves to must still be inside the folder. -> the full path, or
// null for a name these routes refuse. A bare name passes exactly as before.
function stageFilePath(stagesDir, file) {
  const f = String(file || '');
  if (!f || !/\.def$/i.test(f) || f.includes('\\') || f.includes(':') || f.startsWith('/')) return null;
  if (f.split('/').some((seg) => !seg || seg === '.' || seg === '..')) return null;
  const root = path.resolve(stagesDir);
  const full = path.resolve(root, f);
  const rel = path.relative(root, full);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return full;
}

// EVERY PROGRAM THIS SERVER STARTS GOES THROUGH HERE - the engine, Explorer,
// Notepad and the pickers' PowerShell - so a test can swap `spawn` for a stub
// that records the call and never starts anything (module.exports._test).
// Always an argument array, never a shell string and never `cmd /c start`,
// whose own parsing of quotes and carets is its own injection surface.
const launcher = {
  spawn(cmd, args, opts) { return require('child_process').spawn(cmd, args, opts); },
};
// Start a program and let it go. The 'error' handler is not optional: a
// ChildProcess that fails to start (a vanished exe, a missing notepad.exe)
// emits 'error' after spawn returns, and an unhandled one would take this
// whole server down with it.
function startDetached(cmd, args, opts) {
  const child = launcher.spawn(cmd, args, Object.assign({ detached: true, stdio: 'ignore' }, opts || {}));
  if (child && typeof child.on === 'function') child.on('error', () => {});
  if (child && typeof child.unref === 'function') child.unref();
  return child;
}
// The OS file manager on a folder, or the OS text editor on a file.
const FOLDER_OPENER = process.platform === 'win32' ? 'explorer'
  : (process.platform === 'darwin' ? 'open' : 'xdg-open');
function textEditorFor(file) {
  if (process.platform === 'win32') return ['notepad.exe', [file]];
  if (process.platform === 'darwin') return ['open', ['-t', file]];
  return ['xdg-open', [file]];
}

// What the Settings > Online tab is shown: both files, the key redacted, and
// the facts the page words its help by - whether the identity module is even
// present (the legacy kit removes it, so the leaderboard group is not offered
// there; the author's tree and shareable portable copies carry it), whether
// the served play page carries the address (it does not: index.html is served
// raw; only the Website export brands it), and whether the board has character
// art and whether this copy can make it (the active bundle's own
// leaderboard-art/, layout.LEADERBOARD_ART).
const SETUP_GUIDE = path.join(__dirname, 'docs', 'RANKED-SETUP.md');

function hostingState() {
  const roster = vfslib.readRoster();
  return {
    exists: fs.existsSync(localConfig.FILE),
    file: localConfig.FILE,
    // The file is there but cannot be read (held, or damaged): the values
    // below are then empty, and the tab says why (local-config.js problem).
    problem: localConfig.problem(),
    rosterFile: vfslib.ROSTER_PATH,
    values: localConfig.redact(localConfig.load()),
    identityUrl: typeof roster.identityUrl === 'string' ? roster.identityUrl : '',
    onlineName: !!roster.onlineName,
    // The mode CASUAL and RANKED play (queuemode.js), and whether this bundle
    // carries add004's tag, which runs on Simul with teams of three, so the
    // tab can suggest that.
    queueMode: require('./queuemode').normalize(roster.queueMode),
    add004Tag: (() => {
      try {
        const bi = require('./buildimport');
        return !!require('./teamplay').add004TagForBundle(bi.buildStates() ? bi.buildStatesPath() : null).tag;
      } catch (e) { return false; }
    })(),
    identityAvailable: fs.existsSync(path.join(PUBLIC_DIR, 'ikemen', 'identity.js')),
    servedPageHasIdentity: false,
    // The setup guide beside the program (a portable copy carries it in
    // app/docs/), so the tab only offers the button where it opens.
    guide: fs.existsSync(SETUP_GUIDE),
    // The page the Website export writes beside the game when there is a
    // leaderboard, and the names it carries (public/ranking/).
    leaderboardPage: roster.leaderboardPage === 'board' ? 'board' : 'plain',
    // The Score Ranking board's look (leaderboardlook.js): header, format,
    // fonts, colors, the board's words and the ranks' icons, and the tables
    // the tab offers them from (textKeys: each word's key and the board's own
    // English; the limits a rank picture is held to).
    leaderboardLook: require('./leaderboardlook').normalize(roster.leaderboardLook),
    // ...and exactly what roster.json keeps for it (null: no key), which the
    // page copies into its own roster snapshot.
    leaderboardLookStored: require('./leaderboardlook').toRoster(roster.leaderboardLook),
    lookTables: (() => {
      const L = require('./leaderboardlook');
      return { formats: L.FORMATS, headers: L.HEADERS, roles: L.ROLES, fonts: L.FONTS, presets: L.PRESETS, customKeys: L.CUSTOM_KEYS,
        textKeys: L.TEXT_KEYS, textMax: L.TEXT_MAX, rankLooksMax: L.RANK_LOOKS_MAX, pipsMax: L.PIPS_MAX,
        rankImageTypes: Object.keys(L.RANK_IMAGE_TYPES), rankImageMaxBytes: L.RANK_IMAGE_MAX_BYTES,
        bgTypes: Object.keys(L.BG_TYPES), bgImageMaxBytes: L.BG_IMAGE_MAX_BYTES, bgVideoMaxBytes: L.BG_VIDEO_MAX_BYTES,
        bgFits: L.BG_FITS, bgDimDefault: L.BG_DIM_DEFAULT, bgDimMax: L.BG_DIM_MAX };
    })(),
    // The board draws portraits and win poses from leaderboard-art/: the
    // ACTIVE bundle's own folder (layout.LEADERBOARD_ART; for the checkout's
    // Main, the private site's folder beside the program). The Website export
    // of a bundle with a leaderboard makes and refreshes it, and so does the
    // Make button under the choice. boardArt: the folder has a manifest, so
    // the preview shows the art (boardArtChars characters, made boardArtMade).
    // boardArtTool: this copy can make it - the author's tree and every
    // shareable copy since 2026-09-28; only the legacy kit cannot, and only
    // there does the board always draw its rows without art.
    ...boardArtState(),
    siteTitle: typeof roster.siteTitle === 'string' ? roster.siteTitle : '',
    siteCredit: typeof roster.siteCredit === 'string' ? roster.siteCredit : '',
    // "Your own servers (Cloudflare)": offered where this copy carries the
    // host kit. values.host is the record, redacted (local-config.js
    // redactHost); hostHere says which of its addresses this install and the
    // active bundle already use, for the "Use them in this bundle" button.
    hostKit: hostKitAvailable(),
    hostDefaultName: (() => { try { return hostKitAvailable() ? hostDeploy().DEFAULT_SCRIPT : ''; } catch (e) { return ''; } })(),
    // The rule a server name is held to, for the field to check as it is
    // typed (deploy.js NAME_RE, and the text Set up would give).
    hostNameRule: (() => {
      if (!hostKitAvailable()) return null;
      try { const d = hostDeploy(); return d.NAME_RE ? { re: d.NAME_RE.source, why: d.explain('badName') } : null; } catch (e) { return null; }
    })(),
    bundleName: layout.ACTIVE_BUNDLE.name,
    hostHere: hostHere(localConfig.load(), roster),
    // Other bundles that also use the servers' leaderboard address.
    hostElsewhere: hostBundlesElsewhere(localConfig.hostAddresses(localConfig.loadHost())),
    // "Players": the admin key for this bundle's leaderboard address as the
    // page may see it (set or not, and where from; never any part of it), and
    // the folder copies of the leaderboard are saved in (players.js).
    playersKey: localConfig.redactLeaderboardKey(localConfig.load(), roster.identityUrl),
    playersBackupDir: leaderboardBackupDir(),
  };
}

// WHERE THE PLAYERS PANEL SAVES A COPY OF A LEADERBOARD (always before a
// reset): the Studio's download folder when one is set, else the Downloads
// folder in the user's home. A copy holds every name, the whole export and
// the leaderboard address, so it must stay out of everything a build or a
// copy of the Studio reads: a download folder inside the program folder, the
// bundles' folder, the active bundle or an export folder (the download folder
// takes any full path) is passed over for the home Downloads folder.
function leaderboardBackupDir() {
  const home = path.join(require('os').homedir(), 'Downloads');
  const chosen = layout.DOWNLOAD_FOLDER;
  if (!chosen) return home;
  const norm = (p) => { const r = path.resolve(p); return process.platform === 'win32' ? r.toLowerCase() : r; };
  const inside = (d, root) => { const rel = path.relative(norm(root), norm(d)); return rel === '' || (!!rel && !rel.startsWith('..') && !path.isAbsolute(rel)); };
  // Every bundle's desktop export sits beside the unsuffixed one, named
  // <base>-<bundle>: the base's parent is refused only for those names.
  const deskBase = norm(layout.EXPORT_SUFFIX && layout.DESKTOP_EXPORT.endsWith(layout.EXPORT_SUFFIX)
    ? layout.DESKTOP_EXPORT.slice(0, -layout.EXPORT_SUFFIX.length) : layout.DESKTOP_EXPORT);
  const d = norm(chosen);
  const underDesk = d === deskBase || d.startsWith(deskBase + path.sep) || d.startsWith(deskBase + '-');
  const read = [layout.APP, layout.CONTENT_ROOT, layout.CONTENT, layout.WEBSITE_EXPORT, layout.DESKTOP_EXPORT];
  return underDesk || read.some((root) => root && inside(d, root)) ? home : chosen;
}

// ---- YOUR OWN SERVERS (Cloudflare): the host kit ------------------------------
//
// hostkit/ beside this file - app/hostkit/ in a portable copy, where this file
// lives too - holds the Worker the Studio puts on the host's own Cloudflare
// account and deploy.js, the Studio side that puts it there. Loaded on first
// use, so a copy without the folder runs as it always has and the Settings >
// Online group is not offered.
const HOSTKIT_DIR = path.join(layout.APP, 'hostkit');
function hostKitAvailable() {
  return fs.existsSync(path.join(HOSTKIT_DIR, 'worker.js')) && fs.existsSync(path.join(HOSTKIT_DIR, 'deploy.js'));
}
function hostDeploy() { return require(path.join(HOSTKIT_DIR, 'deploy.js')); }

// The Mods tab's backend (modmgr.js): the Studio's own add-ons and the
// bundle's own mods. Loaded on first use, like the lifebar library.
function modmgr() { return require('./modmgr.js'); }

// FOR TESTS ONLY: MUGEN_STUDIO_HOST_TEST = {"apiBase": "...", "dns": "..."},
// both on this machine. apiBase stands in for Cloudflare's API (deploy.js
// refuses any base that is not loopback, so this cannot send a token
// anywhere); dns is where the Studio dials the workers.dev address it just set
// up, instead of the internet. Unset - always, outside the test suites -
// every call goes where it says.
const HOST_TEST = (() => {
  let t = null;
  try { t = JSON.parse(process.env.MUGEN_STUDIO_HOST_TEST || 'null'); } catch (e) { t = null; }
  if (!t || typeof t !== 'object') return null;
  let dns = null;
  try {
    const u = new URL(String(t.dns || ''));
    if (u.protocol === 'http:' && (u.hostname === '127.0.0.1' || u.hostname === 'localhost')) dns = u.host;
  } catch (e) { dns = null; }
  return { apiBase: typeof t.apiBase === 'string' ? t.apiBase : undefined, dns };
})();

// An address of the host's servers, as this Studio dials it.
function hostDial(u) {
  if (!HOST_TEST || !HOST_TEST.dns) return u;
  const x = new URL(u);
  return (/^wss?:$/.test(x.protocol) ? 'ws:' : 'http:') + '//' + HOST_TEST.dns + x.pathname.replace(/^\/$/, '') + x.search;
}
// The Studio's own Settings > Online probes (local-config.js), at hostDial.
function hostProbe(opts, deps) {
  const o = Object.assign({}, opts);
  if (o.signalUrl) o.signalUrl = hostDial(o.signalUrl);
  if (o.identityUrl) o.identityUrl = hostDial(o.identityUrl);
  return localConfig.probe(o, deps);
}
function hostDeps(extra) {
  return Object.assign({ kitDir: HOSTKIT_DIR, probe: hostProbe },
    HOST_TEST && HOST_TEST.apiBase !== undefined ? { apiBase: HOST_TEST.apiBase } : {}, extra || {});
}

const sameAddr = (a, b) => !!a && !!b && String(a).trim().replace(/\/+$/, '') === String(b).trim().replace(/\/+$/, '');

// Which of the host's addresses this install (the relay, local-config.json)
// and the active bundle (the leaderboard and the Online menu, roster.json)
// already use.
function hostHere(cfg, roster) {
  const a = localConfig.hostAddresses(localConfig.loadHost(cfg));
  return {
    signalUrl: sameAddr(cfg.signalUrl, a.signalUrl),
    identityUrl: sameAddr(roster.identityUrl, a.identityUrl),
    onlineName: !!roster.onlineName,
  };
}

// WHAT USING THE SERVERS HERE WOULD REPLACE: an address already filled in that
// is not one of `ours` (the addresses of the servers this Studio set up
// before). The page asks before any of it is overwritten; a blank field, or
// one that already holds our own address, is not asked about.
function hostReplacing(ours) {
  const cfg = localConfig.load();
  const roster = vfslib.readRoster();
  const out = [];
  if (cfg.signalUrl && !sameAddr(cfg.signalUrl, ours.signalUrl)) {
    out.push({ what: 'Lobby relay address (this computer)', value: String(cfg.signalUrl) });
  }
  if (roster.identityUrl && !sameAddr(roster.identityUrl, ours.identityUrl)) {
    out.push({ what: 'Leaderboard address (the ' + layout.ACTIVE_BUNDLE.name + ' bundle)', value: String(roster.identityUrl) });
  }
  return out;
}

// Points this install and the active bundle at the servers: the relay in
// local-config.json, the leaderboard and the Online menu in roster.json
// (setting up turns the menu on too: a leaderboard with the menu off is one
// nobody can reach). Returns what changed.
function useHostAddresses(a) {
  const changed = [];
  const cfg = localConfig.load();
  if (!sameAddr(cfg.signalUrl, a.signalUrl)) { localConfig.save({ signalUrl: a.signalUrl }); changed.push('signalUrl'); }
  const roster = vfslib.readRoster();
  let write = false;
  if (!sameAddr(roster.identityUrl, a.identityUrl)) { roster.identityUrl = a.identityUrl; changed.push('identityUrl'); write = true; }
  if (!roster.onlineName) { roster.onlineName = true; changed.push('onlineName'); write = true; }
  if (write) {
    vfslib.writeRoster(roster);
    invalidateVfs();   // onlineName is a build-time gate in vfslib
  }
  return changed;
}

// The OTHER bundles whose roster.json holds the servers' leaderboard address,
// by name. Read only: a bundle that is not open is never written (each keeps
// its own address), so Remove names these instead - in its confirmation and
// in the note after - for the host to clear there.
function hostBundlesElsewhere(ours) {
  if (!ours || !ours.identityUrl) return [];
  let list = [];
  try { list = require('./bundles.js').list(layout).bundles || []; } catch (e) { list = []; }
  const out = [];
  for (const b of list) {
    if (b.active) continue;
    let r = null;
    try { r = JSON.parse(fs.readFileSync(path.join(b.dir, 'roster.json'), 'utf8').replace(/^\uFEFF/, '')); } catch (e) { r = null; }
    if (r && sameAddr(r.identityUrl, ours.identityUrl)) out.push(String(b.name));
  }
  return out;
}

// Takes the servers' addresses back out, where they are still ours: after a
// removal they lead nowhere. Another bundle that used them keeps them until
// it is changed there; Remove names those bundles (hostBundlesElsewhere).
function dropHostAddresses(a) {
  const cfg = localConfig.load();
  if (sameAddr(cfg.signalUrl, a.signalUrl)) localConfig.save({ signalUrl: '' });
  const roster = vfslib.readRoster();
  if (sameAddr(roster.identityUrl, a.identityUrl)) {
    delete roster.identityUrl;
    delete roster.onlineName;
    vfslib.writeRoster(roster);
    invalidateVfs();
  }
}

// What the page is told of a setupServers() result: never the admin key (the
// record keeps it), never the token (deploy.js never returns it).
function hostResultForPage(r) {
  const probe = (p) => (p ? { ok: !!p.ok, note: p.note || '', why: p.why || '', ms: p.ms || 0 } : null);
  return {
    ok: !!r.ok,
    code: r.code === undefined ? null : r.code,
    why: r.why || '',
    need: r.need || null,
    choices: Array.isArray(r.choices) ? r.choices.map((c) => ({ id: c.id, name: c.name })) : undefined,
    step: r.step || null,
    fresh: !!r.fresh,
    dnsWait: !!r.dnsWait,
    scriptName: r.scriptName || null,
    subdomain: r.subdomain || null,
    signalUrl: r.signalUrl || null,
    identityUrl: r.identityUrl || null,
    probes: r.probes ? { ok: !!r.probes.ok, attempts: r.probes.attempts, lobby: probe(r.probes.lobby), identity: probe(r.probes.identity) } : null,
  };
}

// The fixed pages the host-open route may open. Never a URL from the request.
const HOST_LINKS = {
  signup: () => 'https://dash.cloudflare.com/sign-up',
  token: () => hostDeploy().tokenLinkUser(),
  tokens: () => 'https://dash.cloudflare.com/profile/api-tokens',
};
// The OS's own "open this web address": the desktop window only opens the
// Studio's own pages, so a Cloudflare page goes to the default browser.
function urlOpenerFor(u) {
  if (process.platform === 'win32') return ['rundll32.exe', ['url.dll,FileProtocolHandler', u]];
  if (process.platform === 'darwin') return ['open', [u]];
  return ['xdg-open', [u]];
}

function boardArtState() {
  let manifest = null;
  try { manifest = JSON.parse(fs.readFileSync(path.join(layout.LEADERBOARD_ART, 'manifest.json'), 'utf8')); } catch (e) { manifest = null; }
  const chars = manifest && manifest.chars && typeof manifest.chars === 'object' ? Object.keys(manifest.chars).length : 0;
  return {
    boardArt: !!manifest,
    boardArtChars: chars,
    boardArtMade: manifest && typeof manifest.generated === 'string' ? manifest.generated : '',
    boardArtTool: modlib.boardArtTool(),
  };
}

async function handleApi(req, res, pathname) {
  try {
    if ((DESKTOP_ACTION_ROUTES.has(pathname) || WRITES(req)) && !ownOrigin(req)) {
      return json(res, 403, { error: 'refused: this action only answers the Studio\'s own pages' });
    }
    if (!ownFetch(req)) {
      return json(res, 403, { error: 'refused: the Studio only answers its own pages' });
    }
    res.apiPath = pathname;
    if (readOnlyRefuses(req, pathname)) return json(res, 409, readOnlyAnswer(pathname));

    if (pathname === '/api/studio' && req.method === 'GET') {
      // A BUILD OPENED READ-ONLY answers at once with what is cheap - the
      // roster and every character's name (modlib.studioInfoLight, kept for
      // the life of the server) - and with `pending` while the full answer,
      // studioInfo itself, is worked out beside the server (readonlyscan.js);
      // once it is, that is the answer. Either way the download folder is the
      // one in force now: it is the Studio's own setting and can change.
      if (layout.readOnly) {
        // Both answers are kept for the life of the server, and the H-MUGEN
        // module's answers (hmodule.js) are written after them: the disk's are
        // laid over whichever goes out, or a reload would ask the question
        // again and undo a role (a copy - the kept answer stays as it was).
        const withH = (a) => {
          let disk = null;
          try { disk = vfslib.readRoster(); } catch (e) { disk = null; }
          if (!disk || !a || !a.roster) return a;
          const H = require('./hmodule.js');
          const byKey = new Map((disk.chars || []).map((c) => [(c.folder || '') + '|' + (c.select || ''), c]));
          const chars = (a.roster.chars || []).map((c) => {
            const d = byKey.get((c.folder || '') + '|' + (c.select || ''));
            const o = Object.assign({}, c);
            for (const k of ['hRole', 'hReviewed']) { if (d && d[k] !== undefined) o[k] = d[k]; else delete o[k]; }
            return o;
          });
          return Object.assign({}, a, { roster: Object.assign({}, a.roster, { chars, hModule: disk.hModule, hModuleSeen: disk.hModuleSeen }),
            hModule: { state: H.moduleState(disk), seen: Array.isArray(disk.hModuleSeen) ? disk.hModuleSeen : [] } });
        };
        const j = require('./readonlyscan.js').ask('studio', { fn: 'studio' });
        if (j.state === 'done') return json(res, 200, Object.assign(withH(j.value), { downloadFolder: layout.DOWNLOAD_FOLDER }));
        if (!readOnlyLight) readOnlyLight = modlib.studioInfoLight();
        return json(res, 200, Object.assign(withH(readOnlyLight), { downloadFolder: layout.DOWNLOAD_FOLDER },
          j.state === 'failed' ? { pending: false, scanError: j.error } : {}));
      }
      // A FIRST START IN A FOLDER THE PROGRAM CANNOT WRITE (extracted into
      // Program Files): layout.js could not make Settings/ or Content/default
      // and noted why, and the roster is then simply not there. The Node
      // message named a path, not the cure; this names the folder and the cure.
      // Both conditions, or the error goes out as it always has.
      try { return json(res, 200, modlib.studioInfo()); } catch (e) {
        const missingRoster = e && e.code === 'ENOENT' && /roster\.json'?$/i.test(String(e.path || e.message || ''));
        const why = layout.SETTINGS_DIR && (layout.STARTUP_NOTES || []).find((n) => n.kind === 'error' && /^could not make /.test(n.text));
        if (!missingRoster || !why) throw e;
        // Node's own text ends in the call and the path again ("ENOTDIR: not a
        // directory, mkdir '<the same folder>'"): the folder is named once
        // already, so the code and its words are enough.
        const said = why.text.replace(/, [a-z]+ '[^']*'(?: -> '[^']*')?\)$/, ')');
        return json(res, 500, {
          error: 'The Studio cannot write in ' + path.dirname(layout.SETTINGS_DIR) + ' (' + said + '). Move the Mugen Studio folder'
            + ' somewhere you own, such as Documents or the Desktop, and start it again.',
          settingsNotes: layout.STARTUP_NOTES,
        });
      }
    }

    // Every character on disk, flagged with whether it is in the build. The
    // library/build split: cache/ keeps characters you are not ready to ship,
    // roster.chars is what actually gets exported.
    if (pathname === '/api/library' && req.method === 'GET') {
      return json(res, 200, modlib.characterLibrary());
    }

    // Rewrite cell order / build membership from the grid editor.
    //   {order, backup?, lockLabel?}: E-Select's Save also asks for a copy of
    //   roster.json first (-> `backup`, its path inside the bundle) and sends
    //   the label its locked cells are written with (setBuildOrder).
    if (pathname === '/api/build-order' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)).toString('utf8'));
      if (!Array.isArray(body.order)) return json(res, 400, { error: 'order must be an array' });
      if (body.lockLabel !== undefined && body.lockLabel !== null && typeof body.lockLabel !== 'string') {
        return json(res, 400, { error: 'lockLabel must be text' });
      }
      const r = modlib.setBuildOrder(body.order, { backup: !!body.backup, lockLabel: body.lockLabel });
      invalidateVfs();
      return json(res, 200, r);
    }

    // Arcade ladder length per order tier ([Options] *.maxmatches). POST an
    // object of {arcade,team,timeattack,survival} arrays; POST {} to clear.
    if (pathname === '/api/max-matches' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)).toString('utf8'));
      const r = modlib.setMaxMatches(body || {});
      invalidateVfs();
      return json(res, 200, r);
    }

    // Per-character select.def properties (stage, music, order, ai, hidden,
    // includestage, and the slot select/next/previous keys).
    //   {keepCell: true} (E-Select, excluding while locked cells follow):
    //   the cell the character leaves is kept as an unused cell (setCharProps).
    if (pathname === '/api/char-props' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)).toString('utf8'));
      const r = modlib.setCharProps(body.mountAs, body.props || {}, { keepCell: body.keepCell === true || body.keepCell === 1 });
      if (r.error) return json(res, 404, r);
      invalidateVfs();
      return json(res, 200, r);
    }

    // Geometry + cell assignments for the real character-select grid, read
    // from the motif's [Select Info]. Lets the Studio draw what the game draws.
    if (pathname === '/api/motif-select' && req.method === 'GET') {
      return json(res, 200, modlib.motifSelectInfo());
    }

    // GET /api/sprite?char=<mountAs>&group=<n>&index=<n>
    //
    // Decodes one sprite straight out of the character's own SFF and serves it
    // as an indexed PNG. Mod Studio has never rendered a pixel of character
    // art - no <canvas>, no <img>, every card is text and badges - and a
    // VSelect-style cell grid is portraits or it is nothing.
    //
    // Decoded SERVER-side deliberately. tools/sff-decode.js is Buffer-based
    // and field-hardened (the fmt-10 SFF-palette substitution that stopped
    // dr_kira rendering as a black silhouette; the v1 portrait-vs-fight
    // palette split that stopped RyuDX rendering as noise). The browser's
    // public/lib/sff.js has NO SFF v1 support at all and a large share of
    // community characters are v1, so keeping the browser dumb avoids
    // maintaining a second decoder that would drift from this one.
    // Size and AXIS of one sprite, for positioning a static face.
    if (pathname === '/api/sprite-geom' && req.method === 'GET') {
      const q = url.parse(req.url, true).query;
      const id = String(q.char || '');
      if (!id || !/^[A-Za-z0-9_.-]+$/.test(id) || id === '.' || id === '..') {
        return json(res, 400, { error: 'bad char id' });
      }
      const group = parseInt(q.group, 10), index = parseInt(q.index, 10);
      if (!Number.isFinite(group) || !Number.isFinite(index)) {
        return json(res, 400, { error: 'bad group/index' });
      }
      let r = null;
      try { r = modlib.spriteGeomFor(id, group, index); } catch (e) { r = null; }
      if (!r) return json(res, 404, { error: 'no such sprite' });
      return json(res, 200, r);
    }

    // What a character says about itself: the read-only half of its properties.
    if (pathname === '/api/char-about' && req.method === 'GET') {
      const q = url.parse(req.url, true).query;
      const id = String(q.char || '');
      if (!id || !/^[A-Za-z0-9_.-]+$/.test(id) || id === '.' || id === '..') {
        return json(res, 400, { error: 'bad char id' });
      }
      let r = null;
      try { r = modlib.charAbout(id); } catch (e) { r = null; }
      if (!r) return json(res, 404, { error: 'no such character' });
      return json(res, 200, r);
    }

    // H-MUGEN pair bench: one giver against one receiver, raw numbers by
    // family. See modlib pairBench.
    if (pathname === '/api/pair-bench' && req.method === 'GET') {
      const q = url.parse(req.url, true).query;
      const ok = (v) => v && /^[A-Za-z0-9_.-]+$/.test(v) && v !== '.' && v !== '..';
      const giver = String(q.giver || ''), receiver = String(q.receiver || '');
      if (!ok(giver) || !ok(receiver)) return json(res, 400, { error: 'bad char id' });
      try {
        const r = modlib.pairBench(giver, receiver);
        // Whether this build can write a GIF, for the scene players' button -
        // read from the server's own answer, never assumed (the kit has no encoder).
        r.canGif = modlib.canExportGif();
        return json(res, 200, r);
      } catch (e) { return json(res, 404, { error: e.message }); }
    }
    // What the desktop export can launch (its select.def), or why not.
    if (pathname === '/api/launch-info' && req.method === 'GET') {
      try { return json(res, 200, modlib.launchInfo()); }
      catch (e) { return json(res, 500, { error: e.message }); }
    }
    // Start the desktop export's engine on a pair: giver P1, receiver P2 with
    // AI off, no round clock. Opens a game window - only ever from a click.
    if (pathname === '/api/launch-pair' && req.method === 'POST') {
      const { giver, receiver, stage } = JSON.parse((await readBody(req)).toString('utf8') || '{}');
      const ok = (v) => v && /^[A-Za-z0-9_.-]+$/.test(v) && v !== '.' && v !== '..';
      if (!ok(String(giver || '')) || !ok(String(receiver || ''))) return json(res, 400, { error: 'bad char id' });
      if (stage != null && stage !== '' && !/^[A-Za-z0-9_ .'!()\[\]-]+\/?[A-Za-z0-9_ .'!()\[\]-]*\.def$/i.test(String(stage))) {
        return json(res, 400, { error: 'bad stage' });
      }
      try { return json(res, 200, modlib.launchPair(String(giver), String(receiver), stage ? String(stage) : null)); }
      catch (e) { return json(res, 400, { error: e.message }); }
    }

    // ---- E-Select (public/grid.html): its engine and screenpack menus ------
    //
    // What the title path's two words name, as real paths: which engine Launch
    // starts and how old that build is next to the roster, and where the
    // screenpack's system.def is. ?exe= checks a program the user chose
    // (Preferences › Engine executable) without starting it. Read-only.
    if (pathname === '/api/eselect-info' && req.method === 'GET') {
      const q = url.parse(req.url, true).query;
      const exe = q.exe === undefined ? null : String(Array.isArray(q.exe) ? q.exe[0] : q.exe);
      return json(res, 200, modlib.eselectInfo(exe));
    }

    // LAUNCH IKEMEN GO, plainly: the program with no arguments, in its own
    // folder, straight to its title screen - what double-clicking it does.
    // {exe} is the Engine executable preference, checked again here (the page
    // is not trusted to have checked it); without one, the desktop export's
    // Ikemen_GO.exe. Opens a game window, so only ever from a click.
    if (pathname === '/api/launch-build' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
      if (process.platform !== 'win32') return json(res, 400, { error: 'launching Ikemen GO from here is Windows-only' });
      let exe, dir;
      if (body.exe !== undefined && body.exe !== null && String(body.exe).trim()) {
        const v = modlib.validateEngineExe(body.exe);
        if (!v.ok) return json(res, 400, { error: v.reason, exe: v.exe });
        // A BUILD OPEN READ-ONLY IS NOT STARTED FROM HERE. Its own program
        // writes its saves, its log and its screenshots into the build - the
        // one thing read-only promises never happens - and readonlyfs.js
        // cannot see another program. Double-clicking it stays the owner's.
        if (layout.readOnly && require('./readonlyfs.js').guards(v.exe)) {
          return json(res, 409, { error: 'This build is open read-only - starting its own program from here is not available (it writes its saves and log into the build); start it from its folder', readOnly: true, exe: v.exe });
        }
        exe = v.exe; dir = v.dir;
      } else {
        dir = layout.DESKTOP_EXPORT;
        exe = path.join(dir, 'Ikemen_GO.exe');
        if (!fs.existsSync(exe)) {
          return json(res, 400, { error: 'there is no desktop build at ' + dir + ' - run Export Desktop in the Studio, or choose the engine in Preferences', exe });
        }
      }
      let child;
      try { child = startDetached(exe, [], { cwd: dir }); }
      catch (e) { return json(res, 500, { error: String(e && e.message || e) }); }
      return json(res, 200, { ok: true, exe, dir, pid: child && child.pid });
    }

    // OPEN SOMETHING IN ITS OWN PROGRAM - a whitelisted NAME, never a path:
    //   system.def      the screenpack's system.def in Notepad (motifDefPath,
    //                   the same file every grid edit writes)
    //   motif-folder    Explorer on that file's folder
    //   install-folder  Explorer on the engine's folder: the folder of {exe}
    //                   when it is a valid Engine executable, else the export
    // The server resolves every path itself, so nothing a page sends can point
    // Notepad or Explorer anywhere else.
    if (pathname === '/api/open-path' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
      const which = String(body.which || '');
      let target, cmd, args, from;
      if (which === 'system.def' || which === 'motif-folder') {
        const def = modlib.motifDefPath();
        if (!def || !fs.existsSync(def)) return json(res, 404, { error: 'the screenpack\'s system.def was not found', which });
        // Notepad on a read-only build's own screenpack file is an editor on
        // it, one Save away from changing the build; its folder in Explorer
        // only shows it.
        if (which === 'system.def' && layout.readOnly && require('./readonlyfs.js').guards(def)) {
          return json(res, 409, { error: 'This build is open read-only - opening its screenpack file in Notepad is not available', readOnly: true, which });
        }
        target = which === 'system.def' ? def : path.dirname(def);
      } else if (which === 'install-folder') {
        const v = body.exe ? modlib.validateEngineExe(body.exe) : null;
        target = v && v.ok ? v.dir : layout.DESKTOP_EXPORT;
        from = v && v.ok ? 'custom' : 'export';
      } else {
        return json(res, 400, { error: 'which must be system.def, motif-folder or install-folder' });
      }
      if (!fs.existsSync(target)) return json(res, 404, { error: 'not found: ' + target, which, path: target });
      if (which === 'system.def') [cmd, args] = textEditorFor(target);
      else { cmd = FOLDER_OPENER; args = [target]; }
      try { startDetached(cmd, args); }
      catch (e) { return json(res, 500, { error: String(e && e.message || e) }); }
      return json(res, 200, Object.assign({ ok: true, which, path: target }, from ? { from } : {}));
    }

    // THE SCREENPACK LIST ALONE, for E-Select's Open Motif: what /api/studio
    // carries as themes/themesUnusable, without the rescan of every character
    // that route does to get there. The VFS index is this server's cached one.
    if (pathname === '/api/themes' && req.method === 'GET') {
      return json(res, 200, modlib.themesInfo(getVfs()));
    }

    // THE select.def A DESKTOP EXPORT WILL WRITE, lock labels included - what
    // E-Select's View select.def shows. The web build's copy
    // (/ikemen-fs/file/data/select.def) is the same file without the labels.
    // Bytes as the engine reads them; generated from roster.json on disk, so it
    // is the saved state, not the page's unsaved edits.
    if (pathname === '/api/select-def' && req.method === 'GET') {
      const body = vfslib.buildSelectDef(vfslib.readRoster(), { locks: true });
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=windows-1252', 'Cache-Control': 'no-store' });
      return res.end(body);
    }

    // ONE SPRITE OUT OF A STAGE'S OWN .sff - the stage portrait the select
    // screen draws (`stage.portrait.spr`, or E-Select's default when the pack
    // leaves it unset). ?stage= must be a stage IN THIS BUILD, spelled as
    // MI.stageList spells it - a bare name, or a path under the stages folder
    // for a build opened in place (stageFilePath) - so this can only ever read
    // a file the roster already ships. 404 when the stage has no such sprite.
    if (pathname === '/api/stage-sprite' && req.method === 'GET') {
      const q = url.parse(req.url, true).query;
      const file = String(q.stage || '');
      const stagesDir = layout.dir('stages');
      if (!stageFilePath(stagesDir, file)) {
        return json(res, 400, { error: 'bad stage name' });
      }
      const gs = String(q.g == null ? '' : q.g), is = String(q.i == null ? '' : q.i);
      if (!/^-?\d{1,6}$/.test(gs) || !/^-?\d{1,6}$/.test(is)) return json(res, 400, { error: 'bad group/index' });
      const group = parseInt(gs, 10), index = parseInt(is, 10);
      const listed = (vfslib.readRoster().stages || [])
        .find((s) => s && typeof s.file === 'string' && s.file.toLowerCase() === file.toLowerCase());
      if (!listed) return json(res, 404, { error: 'not a stage in this build' });
      const full = stageFilePath(stagesDir, listed.file);
      if (!full || !fs.existsSync(full)) {
        return json(res, 404, { error: 'no such stage' });
      }
      const png = group < 0 || index < 0 ? null : stagethumb.stageSpritePng(stagesDir, listed.file, group, index);
      if (!png) return json(res, 404, { error: 'no such sprite' });
      res.writeHead(200, {
        'Content-Type': 'image/png',
        'Content-Length': png.length,
        // Revalidated every time: the Studio can add or remove a stage's 9000,1
        // while E-Select is open, and the server-side cache already makes a
        // repeat cheap.
        'Cache-Control': 'no-cache',
      });
      return res.end(png);
    }

    // Which sounds a character's state code asks for that its .snd lacks,
    // plus loud volume literals. See modlib soundAudit.
    // The character's sounds, listed; and one of them as a WAV to play.
    if (pathname === '/api/char-sounds' && req.method === 'GET') {
      const q = url.parse(req.url, true).query;
      const id = String(q.char || '');
      if (!id || !/^[A-Za-z0-9_.-]+$/.test(id) || id === '.' || id === '..') {
        return json(res, 400, { error: 'bad char id' });
      }
      let r = null;
      try { r = modlib.charSounds(id); } catch (e) { return json(res, 500, { error: e.message }); }
      if (!r) return json(res, 404, { error: 'no such character' });
      return json(res, 200, r);
    }
    if (pathname === '/api/char-sound' && req.method === 'GET') {
      const q = url.parse(req.url, true).query;
      const id = String(q.char || '');
      if (!id || !/^[A-Za-z0-9_.-]+$/.test(id) || id === '.' || id === '..') {
        return json(res, 400, { error: 'bad char id' });
      }
      const group = parseInt(q.group, 10), index = parseInt(q.index, 10);
      if (!Number.isFinite(group) || !Number.isFinite(index)) return json(res, 400, { error: 'bad group/index' });
      let wav = null;
      try { wav = modlib.charSoundBlob(id, group, index); } catch (e) { wav = null; }
      if (!wav) return json(res, 404, { error: 'no such sound' });
      // Never stored: the server is local and a play is milliseconds, so the
      // browser keeps nothing on disk and there is nothing to clear on close.
      res.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': wav.length, 'Cache-Control': 'no-store' });
      return res.end(wav);
    }
    if (pathname === '/api/char-sound-audit' && req.method === 'GET') {
      const q = url.parse(req.url, true).query;
      const id = String(q.char || '');
      if (!id || !/^[A-Za-z0-9_.-]+$/.test(id) || id === '.' || id === '..') {
        return json(res, 400, { error: 'bad char id' });
      }
      let r = null;
      try { r = modlib.soundAudit(id); } catch (e) { return json(res, 500, { error: e.message }); }
      if (!r) return json(res, 404, { error: 'no such character' });
      return json(res, 200, r);
    }
    // The content audit (contentaudit.js): missing states and animations,
    // vanishing frames, duplicate sprite keys, size. Pixel comparison of
    // duplicate keys is on unless &dups=0; &all=1 lists the hidden tiers too.
    // Settings > Engine: which official engine zip the desktop export builds
    // against, whether a second one sits beside it, and whether it holds what
    // an export reads (enginezip.js). Read fresh on every call - dropping a
    // zip in or out needs no restart.
    // Content bundles (bundles.js): list, make an empty one, choose which one
    // opens next. A switch is written to studio-layout.json (a portable copy:
    // Settings/studio-settings.json, layout.USER_FILE) and applies when the
    // Studio restarts - every folder is resolved once, at start.
    if (pathname === '/api/bundles' && req.method === 'GET') {
      try { return json(res, 200, require('./bundles.js').list()); }
      catch (e) { return json(res, 500, { error: explainError(e) }); }
    }
    if (pathname === '/api/bundles/switch' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
      try { return json(res, 200, require('./bundles.js').switchTo(String(body.id == null ? '' : body.id))); }
      catch (e) { return json(res, 400, { error: explainError(e) }); }
    }
    // { name, carryOnline? }: with carryOnline the new bundle starts with the
    // open bundle's online setup (bundles.onlineOf: leaderboard address,
    // online menu, match mode, leaderboard page).
    if (pathname === '/api/bundles/new' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
      try {
        const B = require('./bundles.js');
        const online = body.carryOnline === true ? B.onlineOf(vfslib.readRoster()) : null;
        return json(res, 200, B.create(String(body.name || ''), undefined, online ? { online } : undefined));
      } catch (e) { return json(res, 400, { error: explainError(e) }); }
    }
    // THE ONLINE SETUP OF EVERY BUNDLE (bundles.onlineSetups): which bundles
    // hold one, for the New-bundle checkbox and Settings > Online's Copy from
    // bundle. POST /api/online-setup/copy { from } puts that bundle's five
    // values into the open one, replacing its own (a value the source has not
    // set is cleared), and answers like /api/local-config.
    if (pathname === '/api/online-setups' && req.method === 'GET') {
      try { return json(res, 200, { setups: require('./bundles.js').onlineSetups() }); }
      catch (e) { return json(res, 500, { error: explainError(e) }); }
    }
    if (pathname === '/api/online-setup/copy' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
      const B = require('./bundles.js');
      const from = String(body.from == null ? '' : body.from);
      const src = B.onlineSetups().find((s) => s.id === from);
      if (!src) return json(res, 400, { error: 'that bundle has no online setup to copy' });
      if (src.active) return json(res, 400, { error: 'that is the bundle open now' });
      const roster = vfslib.readRoster();
      for (const k of B.ONLINE_KEYS) { if (src.online[k] !== undefined) roster[k] = src.online[k]; else delete roster[k]; }
      vfslib.writeRoster(roster);
      invalidateVfs();   // onlineName and queueMode are build-time inputs to vfslib
      return json(res, 200, Object.assign(hostingState(), { copiedFrom: src.name }));
    }
    // AN EXTERNAL BUILD, OPENED WHERE IT IS (bundles.openExternal): { path,
    // name? } makes the bundle's record - nothing is copied, nothing in the
    // build is written - and answers the list, plus what was opened and what
    // could not be read in place. It does not switch; the switch is the same
    // as for any bundle. A folder that is not a build is a 400 with
    // inspect()'s own reasons (`why`).
    if (pathname === '/api/bundles/open-external' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
      try {
        const r = require('./bundles.js').openExternal(String(body.path || ''), body.name == null ? undefined : String(body.name));
        const { opened } = r;
        delete r.opened;
        return json(res, 200, { ok: true, list: r, opened });
      } catch (e) { return json(res, 400, Object.assign({ error: explainError(e) }, e.why ? { why: e.why } : {})); }
    }
    // FORGET A BUILD OPENED IN PLACE (bundles.removeExternal): { id } deletes
    // that bundle's record - its folder under Content/ - and nothing of the
    // build. Not the bundle open now, nor the one chosen to open next.
    if (pathname === '/api/bundles/remove-external' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
      try {
        const r = require('./bundles.js').removeExternal(String(body.id == null ? '' : body.id));
        const { removed } = r;
        delete r.removed;
        return json(res, 200, { ok: true, list: r, removed });
      } catch (e) { return json(res, 400, { error: explainError(e) }); }
    }
    // THE H-MUGEN MODULE (hmodule.js). POST one of:
    //   { module: 'on' | 'off' | 'notnow', seen?: [mountAs] }   the bundle's answer
    //   { char, select?, role: 'giver'|'receiver'|'both'|'none'|null }   the owner's role
    //   { char, select?, reviewed: <verdict signature> | null }    confirmed as detected
    // Writes the bundle's roster.json - in a build opened read-only that is the
    // Studio's own record of it, never the build - and answers the module's state.
    if (pathname === '/api/h-settings' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
      const H = require('./hmodule.js');
      const roster = vfslib.readRoster();
      if (body.module !== undefined) {
        if (!['on', 'off', 'notnow'].includes(body.module)) return json(res, 400, { error: 'module is on, off or notnow' });
        roster.hModule = body.module;
        if (body.module === 'notnow' && Array.isArray(body.seen)) roster.hModuleSeen = body.seen.map(String).slice(0, 5000);
        else delete roster.hModuleSeen;
      }
      let changed = null;
      if (body.char !== undefined) {
        const c = (roster.chars || []).find((x) => !x.kind && x.mountAs === String(body.char) && (body.select === undefined || x.select === String(body.select)));
        if (!c) return json(res, 404, { error: 'no such character: ' + body.char });
        if (body.role !== undefined) {
          if (body.role === null) delete c.hRole;
          else if (H.ROLES.has(body.role)) c.hRole = body.role;
          else return json(res, 400, { error: 'role is giver, receiver, both, none or null' });
        }
        if (body.reviewed !== undefined) {
          if (body.reviewed !== null && typeof body.reviewed !== 'string') return json(res, 400, { error: 'reviewed is a verdict signature (text) or null' });
          if (body.reviewed === null) delete c.hReviewed;
          else c.hReviewed = String(body.reviewed).slice(0, 200);
        }
        changed = { mountAs: c.mountAs, select: c.select, hRole: c.hRole || null, hReviewed: c.hReviewed || null };
      }
      vfslib.writeRoster(roster);
      invalidateVfs();
      return json(res, 200, { ok: true, hModule: { state: H.moduleState(roster), seen: roster.hModuleSeen || [] }, char: changed });
    }
    // The review queue: GET /api/h-review?chars=<mountAs,...> - of the
    // characters the page's reading found H, the verdicts worth a second look
    // (hmodule.reviewQueue), with a few frames of what the scan read as pair art.
    // Empty while the module is not on.
    if (pathname === '/api/h-review' && req.method === 'GET') {
      const H = require('./hmodule.js');
      const roster = vfslib.readRoster();
      if (!H.moduleOn(roster)) return json(res, 200, { state: H.moduleState(roster), items: [] });
      const q = url.parse(req.url, true).query;
      const only = new Set(String(q.chars || '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 5000));
      let items = [];
      try { items = H.reviewQueue(roster, only); } catch (e) { return json(res, 500, { error: explainError(e) }); }
      return json(res, 200, { state: 'on', items });
    }
    // Whether the RUNNING bundle is an external build open read-only, and
    // where it is. `available` is false when that folder is not there today.
    if (pathname === '/api/readonly' && req.method === 'GET') {
      const root = layout.externalRoot;
      let available = false;
      try { available = !!root && fs.statSync(root).isDirectory(); } catch (e) { available = false; }
      return json(res, 200, { readOnly: layout.readOnly, root, name: layout.ACTIVE_BUNDLE.name, available });
    }
    // ONE MATCH FROM A BUILD OPEN READ-ONLY (vfslib.js, the match view).
    // POST { p1, p2, stage, p2ai? }: two characters' mount names and a stage's
    // file as the roster lists them, checked against the roster; the web
    // game's file list becomes those two, that stage and the screenpack, in
    // memory only (a restart forgets it). -> { ok, url, files, bytes }: the
    // url opens the game straight into the fight, and files/bytes are what its
    // file list holds. 400 { error } for anything the roster does not have.
    // GET: the match chosen now, { match, url }, or { match: null }.
    if (pathname === '/api/readonly/match') {
      if (!layout.readOnly) return json(res, 400, { error: 'this bundle is not a build open read-only - its whole roster plays at /ikemen/index.html' });
      if (req.method === 'GET') {
        const m = vfslib.matchView();
        const r = m ? vfslib.matchFor(vfslib.readRoster(), m) : null;
        return json(res, 200, { match: m, url: r && !r.error ? r.url : null });
      }
      if (req.method !== 'POST') return json(res, 405, { error: 'GET or POST' });
      let body;
      try { body = JSON.parse((await readBody(req)).toString('utf8') || '{}'); } catch (e) { return json(res, 400, { error: 'the request is not JSON' }); }
      const r = vfslib.matchFor(vfslib.readRoster(), body);
      if (r.error) return json(res, 400, { error: r.error });
      vfslib.setMatchView(r.view);
      invalidateVfs();
      // Made now rather than on the game's first request, so a view that
      // cannot be made is this answer's error and not a blank game page.
      let files = 0, bytes = 0;
      try {
        const { generated, index } = getVfs();
        for (const [vpath, abs] of index) {
          let n = null;
          if (abs === null) n = generated[vpath].length;
          else { try { n = fs.statSync(abs).size; } catch (e) { n = null; } }
          if (n !== null) { files++; bytes += n; }
        }
      } catch (e) {
        vfslib.setMatchView(null);
        invalidateVfs();
        return json(res, 500, { error: 'the match could not be put together: ' + explainError(e) });
      }
      return json(res, 200, { ok: true, url: r.url, match: r.view, files, bytes });
    }

    // IMPORTING A WHOLE MUGEN BUILD (buildimport.js). GET reads the folder and
    // reports what can and cannot come across - including what depends on the
    // build's own engine logic - and writes nothing. POST makes the new bundle.
    // The source folder is opened read-only by both.
    //
    // A folder that is not a MUGEN build is a 200 with a reason, not an error:
    // "this is not a build, and here is what is missing" is an answer.
    if (pathname === '/api/build-import' && req.method === 'GET') {
      const q = url.parse(req.url, true).query;
      const dir = String(q.dir || '');
      if (!dir) return json(res, 400, { error: 'no folder given' });
      try {
        const inv = require('./buildimport.js').inspect(dir);
        return json(res, 200, inv.ok ? { ok: true, report: require('./buildimport.js').report(inv) }
          : { ok: false, why: inv.why });
      } catch (e) { return json(res, 500, { error: e.message }); }
    }
    if (pathname === '/api/build-import' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
      try {
        const r = require('./buildimport.js').run(String(body.dir || ''), String(body.name || ''));
        invalidateVfs();
        return json(res, 200, Object.assign({ ok: true }, r, { bundles: require('./bundles.js').list() }));
      } catch (e) { return json(res, 400, { error: e.message }); }
    }

    // BROWSING FOR A FOLDER (folderlib.js). The Studio's own window can open
    // the shell's folder dialog; a browser tab cannot, and its file APIs never
    // hand back a path. So the page navigates the disk through this: it asks
    // for a folder and gets back the FOLDERS inside it, and nothing else.
    //
    // It is GET because it reads, it is read-only because folderlib only ever
    // calls readdir, stat and existsSync, and it names no file - the listing is
    // filtered down to directories before it is built, so a file cannot appear
    // in a reply. Nothing here opens a file's contents, and the server this
    // rides on is bound to 127.0.0.1 (see the listen() call).
    //
    // A path that will not open is a 200 with a reason, the same judgment the
    // import's own read makes: "there is no folder there" is an answer, and the
    // page draws it. 500 is kept for this route itself going wrong.
    //
    // AWAITED, and that is the whole point of it being a promise: a path on a
    // machine that is switched off makes Windows wait the better part of a
    // minute, and this server is one thread. Asked synchronously it would hold
    // every other route - a character listing, a save - for the whole of that
    // wait. folderlib does the waiting on the threadpool and gives up on its
    // own deadline, so the worst this route costs anybody else is nothing.
    if (pathname === '/api/folders' && req.method === 'GET') {
      const q = url.parse(req.url, true).query;
      try {
        return json(res, 200, await require('./folderlib.js').browse(String(q.path == null ? '' : q.path),
          { q: String(q.q == null ? '' : q.q) }));
      } catch (e) {
        return json(res, 200, { ok: false, why: 'that folder could not be read', at: String(q.path == null ? '' : q.path), parent: '', entries: [], total: 0, more: 0 });
      }
    }

    // The languages Options > Language offers: the three built in, and the
    // packs in the languages folder laid over them by code (see serveLang).
    if (pathname === '/api/langs' && req.method === 'GET') {
      return json(res, 200, { folder: layout.LANGUAGES_DIR, langs: langList() });
    }

    if (pathname === '/api/engine-zip' && req.method === 'GET') {
      try {
        return json(res, 200, require('./enginezip.js').health({ deps: layout.DEPS, exportDir: layout.DESKTOP_EXPORT }));
      } catch (e) { return json(res, 500, { error: e.message }); }
    }

    // THE GAME-WIDE CONSTANTS - Settings > Engine. data/common.const holds the
    // rules that turn a HitDef's damage into dizzy points, guard points, red
    // life and power for EVERY character in the build. The engine's own copy is
    // never written: this build's overrides live in the bundle's content and
    // ride into a build as a second const file listed after the engine's.
    // engineconst.js carries the engine rules and the whole text model.
    if (pathname === '/api/engine-const' && req.method === 'GET') {
      const q = url.parse(req.url, true).query;
      return json(res, 200, { ok: true, consts: require('./engineconst.js').state(String(q.product || 'web')) });
    }

    if (pathname === '/api/engine-const' && req.method === 'POST') {
      const engineconst = require('./engineconst.js');
      const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
      // The panel sends the WHOLE set it wants the build to hold, so a value it
      // leaves out is taken back out of the file and goes back to the engine's.
      const result = body.revert ? engineconst.revert() : engineconst.write(body.values || {});
      invalidateVfs();
      return json(res, 200, { ok: true, result, consts: engineconst.state(String(body.product || 'web')) });
    }

    // THE FIGHT SCREEN - Settings > Engine. fight.def is the screenpack's, not
    // the engine's configuration: the bars, the portraits, the names, the timer
    // and the combo counters. Neither the engine's own data/fight.def nor a
    // screenpack the engine ships is ever written - the build takes its own
    // copy in the bundle's content, under the motif it belongs to, and that
    // copy is mounted where the engine looks first. lifebar.js has the rules.
    if (pathname === '/api/lifebar' && req.method === 'GET') {
      return json(res, 200, { ok: true, lifebar: require('./lifebar.js').state() });
    }

    if (pathname === '/api/lifebar' && req.method === 'POST') {
      const lifebar = require('./lifebar.js');
      const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
      const result = body.revert ? lifebar.revert()
        : body.copy ? lifebar.makeOwnCopy()
          : lifebar.write(body.values || {});
      invalidateVfs();
      return json(res, 200, { ok: true, result, lifebar: lifebar.state() });
    }

    // THE LIFEBAR MIX, on the Theme tab (lifebars.js has the rules): the
    // bundle's lifebar library, and which lifebars, hit sparks, hit sounds and
    // round clock the build uses. GET is the card's whole state; POST takes an
    // action. Every change rebuilds the Studio's VFS.
    if (pathname === '/api/lifebars' && req.method === 'GET') {
      return json(res, 200, require('./lifebars.js').state());
    }

    if (pathname === '/api/lifebars' && req.method === 'POST') {
      const lbs = require('./lifebars.js');
      const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
      let result;
      if (body.action === 'install') {
        if (!body.path || !fs.existsSync(String(body.path))) return json(res, 400, { error: 'that path does not exist' });
        result = lbs.install(String(body.path));
      } else if (body.action === 'lift') {
        result = lbs.lift(body.stock ? { stock: true } : { bundle: body.bundle, theme: body.theme });
      } else if (body.action === 'choose') {
        const patch = {};
        for (const k of ['lifebar', 'sparks', 'sounds', 'clock', 'fightDef']) if (k in body) patch[k] = body[k];
        result = lbs.choose(patch);
      } else if (body.action === 'remove') {
        result = lbs.removePack(body.pack);
      } else {
        return json(res, 400, { error: 'action must be install|lift|choose|remove' });
      }
      invalidateVfs();
      return json(res, 200, Object.assign({ ok: true, result }, { state: lbs.state() }));
    }

    // The lifebars a Theme card previews: the bars and frames of a library
    // def as positioned sprites, and the sprites themselves.
    if (pathname === '/api/lifebars/preview' && req.method === 'GET') {
      const q = Object.fromEntries(new URL(req.url, 'http://x').searchParams);
      return json(res, 200, { ok: true, preview: require('./lifebars.js').preview({ pack: q.pack, def: q.def }) });
    }

    if (pathname === '/api/lifebars/sprite' && req.method === 'GET') {
      const q = Object.fromEntries(new URL(req.url, 'http://x').searchParams);
      const got = require('./lifebars.js').packSpritePng(q.pack, q.sff, parseInt(q.group, 10), parseInt(q.index, 10));
      if (!got || !got.png) return json(res, 404, { error: 'no such sprite' });
      res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': got.png.length, 'Cache-Control': 'no-cache' });
      return res.end(got.png);
    }

    if (pathname === '/api/char-content-audit' && req.method === 'GET') {
      const q = url.parse(req.url, true).query;
      const id = String(q.char || '');
      if (!id || !/^[A-Za-z0-9_.-]+$/.test(id) || id === '.' || id === '..') {
        return json(res, 400, { error: 'bad char id' });
      }
      let r = null;
      try { r = modlib.contentAudit(id, { dups: q.dups !== '0', allTiers: q.all === '1' }); } catch (e) { return json(res, 500, { error: e.message }); }
      if (!r) return json(res, 404, { error: 'no such character' });
      return json(res, 200, r);
    }

    // MOVES AND ANIMATION EDITING (public/moves.html, the .air editor): the
    // read models of movelib.js / airedit.js and their one write path,
    // charedit.js - an in-place byte splice, one pristine backup per file,
    // validated by a re-parse before anything is written (STUDIO-ADVANCED.md
    // §5, §11). modlib resolves the mount name. Every write invalidates the
    // VFS so the next build packs the edited bytes.
    //
    // Errors carry movelib's code: invalid 400, notfound 404, stale 409 (the
    // file changed since the page read it), confirm 409 (a dangerous value or a
    // shared Default Clsn box - resend with confirm / scope), blocking 409
    // (triggers a structural edit cannot renumber - resend with force),
    // refused 422 (the re-parse would change something else).
    {
      const EDIT_ROUTES = new Set(['/api/char-moves', '/api/char-move-edit', '/api/char-move-add', '/api/char-edit-revert', '/api/char-air', '/api/char-air-edit', '/api/char-hit']);
      if (EDIT_ROUTES.has(pathname)) {
        const okId = (v) => !!v && /^[A-Za-z0-9_.-]+$/.test(v) && v !== '.' && v !== '..';
        const STATUS = { invalid: 400, notfound: 404, stale: 409, confirm: 409, blocking: 409, refused: 422, partial: 500 };
        const fail = (e) => json(res, STATUS[e && e.code] || 500, Object.assign({ error: (e && e.message) || String(e), code: (e && e.code) || 'error' }, (e && e.details) || {}));
        const readJson = async () => {
          try { return JSON.parse((await readBody(req)).toString('utf8') || '{}') || {}; } catch (e) { return null; }
        };
        if (req.method === 'GET' && (pathname === '/api/char-moves' || pathname === '/api/char-air')) {
          const q = url.parse(req.url, true).query;
          const id = String(q.char || '');
          if (!okId(id)) return json(res, 400, { error: 'bad char id' });
          try {
            if (pathname === '/api/char-moves') {
              const r = modlib.charMoves(id);
              if (!r) return json(res, 404, { error: 'no such character' });
              return json(res, 200, r);
            }
            if (!/^-?\d+$/.test(String(q.action || ''))) return json(res, 400, { error: 'bad action' });
            return json(res, 200, modlib.charAir(id, parseInt(q.action, 10)));
          } catch (e) { return fail(e); }
        }
        if (req.method === 'POST' && (pathname === '/api/char-move-edit' || pathname === '/api/char-move-add' || pathname === '/api/char-edit-revert' || pathname === '/api/char-air-edit' || pathname === '/api/char-hit')) {
          const body = await readJson();
          if (!body || typeof body !== 'object') return json(res, 400, { error: 'bad JSON body' });
          const id = String(body.char || '');
          if (!okId(id)) return json(res, 400, { error: 'bad char id' });
          try {
            let r;
            if (pathname === '/api/char-move-edit') {
              // The file's sha1 as the page read it is required: {file, state,
              // ordinal} is a position, and a stale one would edit another block.
              if (!body.sha1 || typeof body.sha1 !== 'string') return json(res, 400, { error: 'sha1 (the file as read) is required', code: 'invalid' });
              r = modlib.charMoveEdit(id, {
                file: body.file, state: body.state, ordinal: body.ordinal, param: body.param, index: body.index,
                value: body.value, expect: body.expect, sha1: body.sha1, confirm: body.confirm === true,
              });
            } else if (pathname === '/api/char-move-add') {
              // A parameter the block leaves out (a derived blockstun, say),
              // added as one line; the same sha1 rule as an edit.
              if (!body.sha1 || typeof body.sha1 !== 'string') return json(res, 400, { error: 'sha1 (the file as read) is required', code: 'invalid' });
              r = modlib.charMoveAdd(id, {
                file: body.file, state: body.state, ordinal: body.ordinal, param: body.param,
                value: body.value, values: Array.isArray(body.values) ? body.values : undefined, sha1: body.sha1, confirm: body.confirm === true,
              });
            } else if (pathname === '/api/char-edit-revert') {
              r = modlib.charEditRevert(id, String(body.file || ''));
              if (r.reverted) invalidateVfs();
              return json(res, 200, r);
            } else if (pathname === '/api/char-hit') {
              // Make, update or remove the hit the animation editor writes for
              // a box whose state has no HitDef (hitgen.js).
              r = modlib.charHit(id, { action: body.action, state: body.state, op: body.op, sha1: body.sha1, files: body.files });
            } else {
              r = modlib.charAirEdit(id, body);
            }
            if (r && r.changed) invalidateVfs();
            return json(res, 200, r);
          } catch (e) { return fail(e); }
        }
        return json(res, 405, { error: 'method not allowed' });
      }
    }

    // THE PAUSE MENU'S COMMAND LIST (cmdlist.js): what the export writes into
    // a character's copy, and the owner's names / hidden moves / switch for it
    // (roster key commandList). Her own folder is only read.
    //   GET  /api/movelist?char=<mountAs>   -> { ok, char, own, enabled, writes, rows, text }
    //   POST /api/movelist { char, rows: [{ state, name?, hidden? }], enabled? } -> the new GET body
    if (pathname === '/api/movelist') {
      const okId = (v) => !!v && /^[A-Za-z0-9_.-]+$/.test(v) && v !== '.' && v !== '..';
      if (req.method === 'GET') {
        const id = String(url.parse(req.url, true).query.char || '');
        if (!okId(id)) return json(res, 400, { error: 'bad char id' });
        try {
          const r = modlib.charMovelist(id);
          return r ? json(res, 200, r) : json(res, 404, { error: 'no such character' });
        } catch (e) { return json(res, 500, { error: e.message }); }
      }
      if (req.method === 'POST') {
        let body;
        try { body = JSON.parse((await readBody(req)).toString('utf8') || '{}') || {}; } catch (e) { return json(res, 400, { error: 'bad JSON body' }); }
        const id = String(body.char || '');
        if (!okId(id)) return json(res, 400, { error: 'bad char id' });
        try {
          const r = modlib.setCharMovelist(id, body);
          invalidateVfs();
          return r ? json(res, 200, r) : json(res, 404, { error: 'no such character' });
        } catch (e) { return json(res, 400, { error: e.message }); }
      }
      return json(res, 405, { error: 'method not allowed' });
    }

    // Cell-portrait geometry for the whole roster at once, so the grid can
    // lay a row out without a round trip per character.
    if (pathname === '/api/cell-portraits' && req.method === 'GET') {
      const q = url.parse(req.url, true).query;
      const group = parseInt(q.group, 10);
      const index = parseInt(q.index, 10);
      if (!Number.isFinite(group) || !Number.isFinite(index)) {
        return json(res, 400, { error: 'group and index required' });
      }
      // The motif's BIG portrait sprite, when the screenpack uses a still one.
      // Optional: a pack whose face element is an animation (ikemen1's
      // p1.face.anim = 0 is the character's stance) has no single sprite to
      // measure, and the client simply does not ask.
      const fg = parseInt(q.faceGroup, 10);
      const fi = parseInt(q.faceIndex, 10);
      // A BUILD OPENED READ-ONLY measures its roster beside the server
      // (readonlyscan.js): 202 { pending } until it has, then the same answer.
      if (layout.readOnly) {
        const j = require('./readonlyscan.js').ask('cell-portraits ' + [group, index, fg, fi].join(','),
          { fn: 'cell-portraits', args: [group, index, fg, fi] });
        if (j.state === 'queued' || j.state === 'running') return json(res, 202, { pending: true });
        if (j.state !== 'done' || !j.value) return json(res, 500, { error: 'could not read portraits' });
        return json(res, 200, j.value);
      }
      let r = null;
      try { r = modlib.cellPortraits(group, index, fg, fi); } catch (e) { r = null; }
      if (!r) return json(res, 500, { error: 'could not read portraits' });
      return json(res, 200, r);
    }

    // The three terms that decide how large a character draws: its own
    // localcoord, its portraitscale, and the [Size] scale from its CNS.
    if (pathname === '/api/char-scale' && req.method === 'GET') {
      const q = url.parse(req.url, true).query;
      const id = String(q.char || '');
      if (!id || !/^[A-Za-z0-9_.-]+$/.test(id) || id === '.' || id === '..') {
        return json(res, 400, { error: 'bad char id' });
      }
      let r = null;
      try { r = modlib.charScale(id); } catch (e) { r = null; }
      if (!r) return json(res, 404, { error: 'no such character' });
      return json(res, 200, r);
    }

    // One .air action of a character, with per-frame sprite geometry. The
    // select screen's big portrait is an ANIMATION (ikemen1: p1.face.anim=0,
    // the stance), not a still portrait.
    if (pathname === '/api/char-anim' && req.method === 'GET') {
      const q = url.parse(req.url, true).query;
      const id = String(q.char || '');
      if (!id || !/^[A-Za-z0-9_.-]+$/.test(id) || id === '.' || id === '..') {
        return json(res, 400, { error: 'bad char id' });
      }
      const action = parseInt(q.action, 10);
      if (!Number.isFinite(action)) return json(res, 400, { error: 'bad action' });
      // loop=1 asks for the repeating part only - everything from the .air's
      // Loopstart marker on. See charActions/loopStart.
      const loop = String(q.loop || '') === '1';
      // sprites=<other id>: this character's action drawn with that
      // character's sprite file (the pair bench's scene view). Same id rule.
      const sprites = q.sprites === undefined ? '' : String(q.sprites);
      if (sprites && (!/^[A-Za-z0-9_.-]+$/.test(sprites) || sprites === '.' || sprites === '..')) {
        return json(res, 400, { error: 'bad sprites id' });
      }
      let r = null;
      try { r = modlib.charAnim(id, action, { loop, spritesFrom: sprites || null }); }
      catch (e) { return json(res, 404, { error: sprites ? e.message : 'no such action' }); }
      if (!r) return json(res, 404, { error: 'no such action' });
      return json(res, 200, r);
    }

    // THE PALETTES A CHARACTER OFFERS. Not every palette in the .sff - a file
    // can hold hundreds, because palettes attach to individual sprites. Only
    // the selectable ones. See charPalettes for the rule.
    if (pathname === '/api/char-palettes' && req.method === 'GET') {
      const q = url.parse(req.url, true).query;
      const id = String(q.char || '');
      if (!id || !/^[A-Za-z0-9_.-]+$/.test(id) || id === '.' || id === '..') {
        return json(res, 400, { error: 'bad char id' });
      }
      let r = null;
      try { r = modlib.charPalettes(id); } catch (e) { r = null; }
      if (!r) return json(res, 404, { error: 'no palettes for that character' });
      return json(res, 200, r);
    }

    // The actions in a character's .air, enough to pick one from.
    if (pathname === '/api/char-actions' && req.method === 'GET') {
      const q = url.parse(req.url, true).query;
      const id = String(q.char || '');
      if (!id || !/^[A-Za-z0-9_.-]+$/.test(id) || id === '.' || id === '..') {
        return json(res, 400, { error: 'bad char id' });
      }
      let r = null;
      try { r = modlib.charActions(id); } catch (e) { r = null; }
      if (!r) return json(res, 404, { error: 'no animations for that character' });
      // Whether this build can write a GIF at all. The kit does not ship the
      // encoder, so the panel asks rather than assuming and simply leaves the
      // button out - better than a button that always errors.
      r.canGif = modlib.canExportGif();
      // The leaderboard's win pose for this character, and whether this build
      // makes leaderboard art at all (the extractor is private: absent from
      // the kit and every public build, where neither key is sent).
      if (modlib.canBoardArt()) {
        const art = modlib.boardArtFor(id);
        if (art) { r.canBoardArt = true; r.boardArt = art; }
      }
      return json(res, 200, r);
    }

    // THE LEADERBOARD'S WIN POSE AND COLORS for one character:
    //   POST /api/board-art { char, action: <n>|null, pal: <slot>|null }
    // null clears that half (the extractor then picks the engine's win pose /
    // the default colors); a key left out stays as it is. Private builds only.
    if (pathname === '/api/board-art' && req.method === 'POST') {
      let body;
      try { body = JSON.parse((await readBody(req)).toString('utf8') || '{}') || {}; } catch (e) { return json(res, 400, { error: 'bad JSON' }); }
      const id = String(body.char || '');
      if (!id || !/^[A-Za-z0-9_.-]+$/.test(id) || id === '.' || id === '..') return json(res, 400, { error: 'bad char id' });
      if (!modlib.boardArtTool()) return json(res, 404, { error: 'leaderboard art is not part of this build' });
      if (!modlib.canBoardArt()) return json(res, 400, { error: 'this bundle has no leaderboard - set its address in Settings > Online first' });
      const art = {};
      for (const k of ['action', 'pal']) {
        if (!(k in body)) continue;
        const v = body[k];
        if (v !== null && !(Number.isInteger(v) || /^[0-9]{1,10}$/.test(String(v)))) return json(res, 400, { error: 'bad ' + k });
        art[k] = v === null ? null : Number(v);
      }
      try {
        const boardArt = modlib.setBoardArt(id, art);
        invalidateVfs();
        return json(res, 200, { boardArt });
      } catch (e) { return json(res, 400, { error: e.message }); }
    }

    // THE SELECTED ACTION, AS A GIF. Not in the kit (no tools/gif.js), and not
    // in a copy made with make-portable --no-gif, which carries the encoder for
    // the leaderboard art but holds this button back: both answer false from
    // modlib.canExportGif(), so the panels never draw the button and this
    // route refuses the request a button would have sent.
    //
    // The panel passes the BOX it is drawing with, so the file is the thing that
    // was on screen rather than a second opinion about how to frame it.
    if (pathname === '/api/char-anim-gif' && req.method === 'GET') {
      if (!modlib.canExportGif()) return json(res, 404, { error: 'GIF export is not part of this build' });
      const q = url.parse(req.url, true).query;
      const id = String(q.char || '');
      if (!id || !/^[A-Za-z0-9_.-]+$/.test(id) || id === '.' || id === '..') {
        return json(res, 400, { error: 'bad char id' });
      }
      const action = parseInt(q.action, 10);
      if (!Number.isFinite(action)) return json(res, 400, { error: 'bad action' });
      const num = (v, lo, hi) => {
        const n = parseInt(v, 10);
        return Number.isFinite(n) && n >= lo && n <= hi ? n : undefined;
      };
      // sprites=<other id>: the action drawn with that character's sprite
      // file (the pair bench's scene view). Same id rule as char.
      const sprites = q.sprites === undefined ? '' : String(q.sprites);
      if (sprites && (!/^[A-Za-z0-9_.-]+$/.test(sprites) || sprites === '.' || sprites === '..')) {
        return json(res, 400, { error: 'bad sprites id' });
      }
      // The options the save popover offers. Each is optional, and a value
      // outside its set is refused rather than quietly replaced - a panel that
      // sends one has a bug worth seeing.
      //   scale=1..4      nearest upscale (the answer says the one it used)
      //   bg=rrggbb       a solid background; absent = transparent
      //   speed=1|2|4     normal, half, quarter
      //   facing=-1|1     -1 mirrors the whole picture, boxes included
      //   still=<n>       one run of the entry (0-based), as a PNG
      const pick = (v, re, name) => {
        if (v === undefined || v === '') return { v: undefined };
        return re.test(String(v)) ? { v: String(v) } : { bad: name };
      };
      const ps = { scale: pick(q.scale, /^[1-4]$/, 'scale'), bg: pick(q.bg, /^[0-9a-fA-F]{6}$/, 'bg'),
        speed: pick(q.speed, /^(1|2|4)$/, 'speed'), facing: pick(q.facing, /^(-1|1)$/, 'facing'),
        still: pick(q.still, /^[0-9]{1,6}$/, 'still') };
      const bad = Object.values(ps).find((x) => x.bad);
      if (bad) return json(res, 400, { error: 'bad ' + bad.bad });
      const opts = {
        pal: /^[0-9]{1,4}$/.test(String(q.pal || '')) ? String(q.pal) : undefined,
        loop: String(q.loop || '') === '1',
        spritesFrom: sprites || null,
        // Boxes in the export only when the panel had them on - the GIF should
        // be what was on screen, which is the same rule the l/t/w/h box follows.
        clsn: String(q.clsn || '') === '1',
        l: num(q.l, -8192, 8192), t: num(q.t, -8192, 8192),
        w: num(q.w, 1, 2048), h: num(q.h, 1, 2048),
        scale: ps.scale.v ? Number(ps.scale.v) : 1,
        bg: ps.bg.v || null,
        speed: ps.speed.v ? Number(ps.speed.v) : 1,
        facing: ps.facing.v ? Number(ps.facing.v) : 1,
      };
      const still = ps.still.v !== undefined ? Number(ps.still.v) : null;
      let r = null;
      try { r = still === null ? modlib.charAnimGif(id, action, opts) : modlib.charAnimStill(id, action, still, opts); }
      catch (e) { r = { error: e.message }; }
      if (!r || r.error) return json(res, 400, { error: (r && r.error) || 'could not build a GIF' });
      const body = still === null ? r.buf : r.png;
      // <char>-<action>[-on-<sprites>][-loop][-pal<n>][-<k>x][-left][-half|-quarter]
      const name = id.replace(/[^A-Za-z0-9_.-]/g, '') + '-' + action
        + (sprites ? '-on-' + sprites.replace(/[^A-Za-z0-9_.-]/g, '') : '')
        + (r.looped ? '-loop' : '') + (opts.pal ? '-pal' + opts.pal : '')
        + (r.scale > 1 ? '-' + r.scale + 'x' : '') + (opts.facing === -1 ? '-left' : '')
        + (opts.speed === 2 ? '-half' : opts.speed === 4 ? '-quarter' : '')
        + (still === null ? '.gif' : '.png');
      res.writeHead(200, {
        'Content-Type': still === null ? 'image/gif' : 'image/png',
        'Content-Length': body.length,
        'Content-Disposition': 'attachment; filename="' + name + '"',
        // What was saved rides along so the UI can report it without decoding
        // the file it just downloaded: frames, duration, the size factor used,
        // and what the file could not draw the engine's way (URI-encoded,
        // notes joined by "; ", empty when there are none).
        'X-Gif-Frames': String(still === null ? r.frames : 1),
        'X-Gif-Ms': String(r.ms),
        'X-Gif-Scale': String(r.scale || 1),
        'X-Gif-Notes': encodeURIComponent((r.notes || []).join('; ')),
        'Cache-Control': 'no-store',
      });
      return res.end(body);
    }

    if (pathname === '/api/sprite' && req.method === 'GET') {
      const q = url.parse(req.url, true).query;
      const id = String(q.char || '');
      // Reject traversal outright rather than normalizing: this reads from a
      // directory of third-party content and the id comes off a query string.
      if (!id || !/^[A-Za-z0-9_.-]+$/.test(id) || id === '.' || id === '..') {
        return json(res, 400, { error: 'bad char id' });
      }
      let group = q.group === undefined ? 9000 : parseInt(q.group, 10);
      let index = q.index === undefined ? 1 : parseInt(q.index, 10);
      if (!Number.isFinite(group) || !Number.isFinite(index)) {
        return json(res, 400, { error: 'bad group/index' });
      }
      // as=face: a view picturing the character (tile, list icon, Properties).
      // When the screenpack never shows its cells' portraits, the hover face
      // stands in for the asked-for sprite (modlib.portraitStandIn).
      const asFace = String(q.as || '') === 'face' && id !== '__motif__' && id !== '__lifebar__';
      if (asFace) {
        let alt = null;
        try { alt = modlib.portraitStandIn(id); } catch (e) { alt = null; }
        if (alt) { group = alt.group; index = alt.index; }
      }
      // char=__motif__ reads the screenpack's own system.sff (cell backgrounds,
      // the random-select icon) instead of a character's.
      // An optional explicit palette, for the palette browser. A distinct URL
      // per palette means the cache header below works FOR the preview instead
      // of against it.
      const palRaw = q.pal === undefined ? '' : String(q.pal);
      if (palRaw && !/^[0-9]{1,4}$/.test(palRaw)) {
        return json(res, 400, { error: 'bad palette' });
      }
      // char=__lifebar__ reads the fight screen's own .sff - the bar, portrait
      // plate and counter art - so an element can be shown rather than only
      // described by its numbers.
      const png = id === '__motif__'
        ? modlib.motifSpritePng(group, index)
        : id === '__lifebar__'
          ? require('./lifebar.js').spritePng(group, index)
          : modlib.spritePngFor(id, group, index, palRaw || undefined, String(q.raw || '') === '1');
      if (!png) return json(res, 404, { error: 'no such sprite' });
      res.writeHead(200, {
        'Content-Type': 'image/png',
        'Content-Length': png.length,
        // Content is static on disk; the Studio re-requests on every roster
        // render and a cell grid asks for hundreds at once. The portrait bank
        // is the exception: a fit saved a moment ago changes what those numbers
        // show, and five minutes of the old picture reads as "it did not work".
        // A stand-in follows the screenpack, so it is never cached either.
        'Cache-Control': (asFace || (group >= 9000 && group <= 9999 && id !== '__motif__' && id !== '__lifebar__')) ? 'no-cache' : 'public, max-age=300',
      });
      return res.end(png);
    }

    // A REAL FILE PICKER, because this drives a local machine.
    //
    // A browser file input hands back a File with no path, and the engine needs
    // the path - so the dialog is opened by the OS on the server side and only
    // the chosen path comes back. Nothing is read or copied here; the answer is
    // a string.
    //
    // The extension filter is whitelisted rather than interpolated, so nothing
    // from the page reaches the shell.
    //
    // kind 'folder' is the same idea for a FOLDER (E-Select's Open new motif…
    // installs a screenpack from one): a FolderBrowserDialog, the path back,
    // nothing read. 'exe' and 'zip' are file kinds like the rest; 'zip' shows
    // .rar and .7z too, because everything that takes a .zip takes those.
    if (pathname === '/api/pick-file' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
      const KINDS = {
        lua: { label: 'Lua scripts', ext: 'lua' },
        def: { label: 'Character definitions', ext: 'def' },
        sff: { label: 'Sprite files', ext: 'sff' },
        exe: { label: 'Programs', ext: 'exe' },
        zip: { label: 'Archives', ext: 'zip', more: ['rar', '7z'], title: 'Select a .zip, .rar or .7z file' },
        any: { label: 'All files', ext: '*' },
      };
      const wantFolder = String(body.kind || '') === 'folder';
      const kind = KINDS[String(body.kind || 'any')] || KINDS.any;
      const exts = [kind.ext].concat(kind.more || []);
      const globs = exts.map((e) => '*.' + e);
      const title = wantFolder ? 'Select a folder' : kind.title || ('Select a ' + (kind.ext === '*' ? 'file' : kind.ext + ' file'));
      const run = (cmd, args) => new Promise((resolve) => {
        let out = '';
        let child;
        try { child = launcher.spawn(cmd, args, { windowsHide: false }); }
        catch (e) { return resolve(null); }
        child.stdout.on('data', (d) => { out += d.toString('utf8'); });
        child.on('error', () => resolve(null));
        child.on('close', () => resolve(out.replace(/^﻿/, '').trim() || null));
      });
      let picked = null;
      if (process.platform === 'win32') {
        // -STA is required or the dialog never appears. The path is written
        // as UTF-8 (without a byte-order mark) because it is read as UTF-8
        // below: the console's own code page turned any accented folder name
        // into a path that does not exist.
        const utf8 = "[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false;";
        const ps = wantFolder
          ? utf8 + "Add-Type -AssemblyName System.Windows.Forms;"
            + "$d = New-Object System.Windows.Forms.FolderBrowserDialog;"
            + "$d.Description = '" + title + "';"
            + "$d.ShowNewFolderButton = $false;"
            + "if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK)"
            + " { [Console]::Out.Write($d.SelectedPath) }"
          : utf8 + "Add-Type -AssemblyName System.Windows.Forms;"
            + "$d = New-Object System.Windows.Forms.OpenFileDialog;"
            + "$d.Title = '" + title + "';"
            + "$d.Filter = '" + kind.label + " (" + globs.join(';') + ")|" + globs.join(';')
            + "|All files (*.*)|*.*';"
            + "$d.Multiselect = $false;"
            + "if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK)"
            + " { [Console]::Out.Write($d.FileName) }";
        picked = await run('powershell', ['-NoProfile', '-STA', '-Command', ps]);
      } else if (process.platform === 'darwin') {
        const of = kind.ext === '*' ? '' : ' of type {' + exts.map((e) => '"' + e + '"').join(',') + '}';
        picked = await run('osascript', ['-e', wantFolder
          ? 'POSIX path of (choose folder with prompt "' + title + '")'
          : 'POSIX path of (choose file with prompt "' + title + '"' + of + ')']);
      } else {
        picked = await run('zenity', wantFolder
          ? ['--file-selection', '--directory', '--title=' + title]
          : ['--file-selection', '--title=' + title, '--file-filter=' + kind.label + ' | ' + globs.join(' ')]);
      }
      if (!picked) return json(res, 200, { ok: true, canceled: true });
      // A path under the project is more useful to select.def as a relative one.
      let rel = null;
      try {
        const r = path.relative(__dirname, picked);
        if (r && !r.startsWith('..') && !path.isAbsolute(r)) rel = r.replace(/\\/g, '/');
      } catch (e) { rel = null; }
      return json(res, 200, { ok: true, path: picked, relative: rel });
    }

    // RENAME. Writes `displayname` in one .def and nothing else - see
    // modlib.setDisplayName for why `name` is deliberately untouchable.
    if (pathname === '/api/char-rename' && req.method === 'POST') {
      const b = JSON.parse((await readBody(req)).toString('utf8') || '{}');
      const folder = String(b.folder || '');
      if (!folder || !/^[A-Za-z0-9_.-]+$/.test(folder) || folder === '.' || folder === '..') {
        return json(res, 400, { error: 'bad character id' });
      }
      const def = String(b.def || '');
      if (!def || !/\.def$/i.test(def) || /[\\/]/.test(def)) {
        return json(res, 400, { error: 'bad .def name' });
      }
      try {
        const r = b.revert
          ? modlib.revertDisplayName(folder, def)
          : modlib.setDisplayName(folder, def, String(b.name || ''));
        return json(res, 200, { result: r });
      } catch (e) {
        return json(res, 400, { error: e.message });
      }
    }

    // ANOTHER VERSION OF A CHARACTER. One folder can hold several .def files -
    // a boss build beside the normal one, sharing all its art - and MUGEN lists
    // those as separate select.def lines into the SAME folder.
    if (pathname === '/api/char-variant' && req.method === 'POST') {
      const b = JSON.parse((await readBody(req)).toString('utf8') || '{}');
      const folder = String(b.folder || '');
      if (!folder || !/^[A-Za-z0-9_.-]+$/.test(folder) || folder === '.' || folder === '..') {
        return json(res, 400, { error: 'bad character id' });
      }
      const def = String(b.def || '');
      if (!def || !/\.def$/i.test(def) || /[\\/]/.test(def)) {
        return json(res, 400, { error: 'bad .def name' });
      }
      try {
        return json(res, 200, { result: modlib.addCharVariant(folder, def) });
      } catch (e) {
        return json(res, 400, { error: e.message });
      }
    }

    // STAGE THUMBNAILS. A stage filename is not a character id - "I'm Blue
    // Stage.def", "XX'FRANCE'XX.def" and "VA-11_HALL-A_Bar.def" all carry
    // characters the char-id validator rejects - so these take the name as a
    // query/body value and check it by RESOLVING it: it must land on a .def
    // that actually sits in the stages folder.
    // ---- select portraits fitted to the screenpack (portraitfit.js) ----
    //   GET  /api/portrait-fit?char=            what the pack wants, what she has, the candidates, the saved fits
    //   GET  /api/portrait-fit-preview?char=&from=&w=&h=&mode=&filter=&fx=&fy=   the PNG a fit would ship
    //   POST /api/portrait-fit {char, slot, fit|null}                            save or remove one slot's fit
    // ---- palettes the user added (custompal.js) ----
    //   GET  /api/custom-palettes?char=                     every slot the character has, which are added, the next free one
    //   GET  /api/sprite-indexed?char=&group=&index=         a sprite as indices, for the panel to recolor live
    //   GET  /api/palette-bytes?char=&slot=                  one palette's 768 bytes (base64)
    //   POST /api/custom-palettes {char, action: save|remove, ...}   and   POST /api/custom-palettes-import?char=&name=  (body: .act or PNG)
    // THE ORDER OF THE PALETTE SLOTS (palorder.js): { char, order: [original slots] }, or order: null for the author's.
    if (pathname === '/api/palette-order' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
      const id = String(body.char || '');
      if (!id || !/^[A-Za-z0-9_.-]+$/.test(id) || id === '.' || id === '..') return json(res, 400, { error: 'bad char id' });
      try {
        const result = modlib.setPaletteOrder(id, body.order);
        invalidateVfs();
        return json(res, 200, { result });
      } catch (e) { return json(res, 400, { error: e.message }); }
    }

    if (pathname === '/api/custom-palettes' || pathname === '/api/sprite-indexed' || pathname === '/api/palette-bytes' || pathname === '/api/custom-palettes-import') {
      const q = url.parse(req.url, true).query;
      const raw = req.method === 'POST' ? await readBody(req) : null;
      const body = raw && pathname === '/api/custom-palettes' ? JSON.parse(raw.toString('utf8') || '{}') : {};
      const id = String((pathname === '/api/custom-palettes' && req.method === 'POST' ? body.char : q.char) || '');
      if (!id || !/^[A-Za-z0-9_.-]+$/.test(id) || id === '.' || id === '..') return json(res, 400, { error: 'bad char id' });
      try {
        if (pathname === '/api/sprite-indexed') {
          const r = modlib.spriteIndexedFor(id, parseInt(q.group, 10), parseInt(q.index, 10));
          return r ? json(res, 200, { result: r }) : json(res, 404, { error: 'no such sprite' });
        }
        if (pathname === '/api/palette-bytes') {
          const pal = modlib.paletteBase64(id, parseInt(q.slot, 10));
          return pal ? json(res, 200, { result: { pal } }) : json(res, 404, { error: 'no such palette' });
        }
        let result;
        if (pathname === '/api/custom-palettes-import') result = modlib.importCustomPalette(id, raw, String(q.name || ''), q.slot ? parseInt(q.slot, 10) : undefined);
        else if (req.method !== 'POST') result = modlib.customPaletteState(id);
        else if (body.action === 'remove') result = modlib.removeCustomPalette(id, body.slot);
        else result = modlib.saveCustomPalette(id, body);
        if (req.method === 'POST') invalidateVfs();
        return json(res, result && result.error ? 404 : 200, result && result.error ? { error: result.error } : { result });
      } catch (e) {
        return json(res, 400, { error: e.message });
      }
    }

    //   POST /api/portrait-picture   (body: a PNG)   keep a picture in the bundle -> { from: 'file:<name>.png', w, h }
    //   GET  /api/portrait-picture?from=file:<name>.png   that picture
    if (pathname === '/api/portrait-picture') {
      try {
        if (req.method === 'POST') return json(res, 200, { result: modlib.savePortraitPicture(await readBody(req)) });
        const abs = modlib.portraitPicturePath(String(url.parse(req.url, true).query.from || ''));
        if (!abs) return json(res, 404, { error: 'no such picture' });
        const png = fs.readFileSync(abs);
        res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': png.length, 'Cache-Control': 'public, max-age=86400' });
        return res.end(png);
      } catch (e) {
        return json(res, 400, { error: e.message });
      }
    }
    if (pathname === '/api/portrait-fit' || pathname === '/api/portrait-fit-preview') {
      const q = url.parse(req.url, true).query;
      const body = req.method === 'POST'
        ? JSON.parse((await readBody(req)).toString('utf8') || '{}') : {};
      const id = String((req.method === 'POST' ? body.char : q.char) || '');
      if (!id || !/^[A-Za-z0-9_.-]+$/.test(id) || id === '.' || id === '..') {
        return json(res, 400, { error: 'bad char id' });
      }
      try {
        if (pathname === '/api/portrait-fit-preview') {
          const png = modlib.portraitFitPreview(id, { from: q.from, w: q.w, h: q.h, mode: q.mode, filter: q.filter, focus: [q.fx, q.fy], dither: q.dither });
          res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': png.length, 'Cache-Control': 'no-store' });
          return res.end(png);
        }
        if (req.method === 'POST') {
          const result = modlib.setPortraitFit(id, String(body.slot || ''), body.fit || null);
          invalidateVfs();
          return json(res, 200, { result });
        }
        const result = modlib.portraitFitState(id);
        return json(res, result && result.error ? 404 : 200, result && result.error ? { error: result.error } : { result });
      } catch (e) {
        return json(res, 400, { error: e.message });
      }
    }

    // ---- portrait renumbering (GRAIL 3.4d) ----
    if (pathname === '/api/portrait-state' || pathname === '/api/portrait-fix'
        || pathname === '/api/portrait-revert') {
      const q = url.parse(req.url, true).query;
      const body = req.method === 'POST'
        ? JSON.parse((await readBody(req)).toString('utf8') || '{}') : {};
      const id = String((req.method === 'POST' ? body.char : q.char) || '');
      // Same id shape the sprite route admits - a mount name, which for a
      // variant is not a directory name.
      if (!id || !/^[A-Za-z0-9_.-]+$/.test(id) || id === '.' || id === '..') {
        return json(res, 400, { error: 'bad char id' });
      }
      try {
        if (pathname === '/api/portrait-state') {
          return json(res, 200, { result: modlib.portraitState(id) });
        }
        if (pathname === '/api/portrait-fix' && req.method === 'POST') {
          const moves = Array.isArray(body.moves) ? body.moves : [];
          if (!moves.length) return json(res, 400, { error: 'no moves given' });
          for (const m of moves) {
            if (!Number.isInteger(m.from) || !Number.isInteger(m.to)
                || m.from < 0 || m.to < 0 || m.from > 65535 || m.to > 65535) {
              return json(res, 400, { error: 'bad move' });
            }
          }
          return json(res, 200, { result: modlib.applyPortraitFix(id, moves) });
        }
        if (pathname === '/api/portrait-revert' && req.method === 'POST') {
          return json(res, 200, { result: modlib.revertPortraitFix(id) });
        }
      } catch (e) {
        return json(res, 400, { error: e.message });
      }
      return json(res, 405, { error: 'method not allowed' });
    }

    // WIDESCREEN FIT (widefit.js): GET = what the fit would do to this stage,
    // POST { file, action: fit | undo } does it. Same stage-name rules as the
    // thumbnail routes below. GET ?all=1 = { results: { file: what GET ?file=
    // answers, or null where it answers an error } } for every stage of the
    // roster, in one request: the Stages tab draws a line per stage.
    if (pathname === '/api/stage-widefit') {
      const stagesDir = layout.dir('stages');
      const body = req.method === 'POST' ? JSON.parse((await readBody(req)).toString('utf8') || '{}') : {};
      const query = req.method === 'GET' ? url.parse(req.url, true).query : {};
      if (req.method === 'GET' && query.all) {
        const roster = vfslib.readRoster();
        const st = roster.settings || {};
        const aspect = 1 / stagegen.gameAspect({ GameWidth: st['Video.GameWidth'], GameHeight: st['Video.GameHeight'] });
        const widefit = require('./widefit.js');
        const results = new Map();
        for (const s of roster.stages || []) {
          const f = String((s && s.file) || '');
          if (!f || results.has(f)) continue;
          const full = stageFilePath(stagesDir, f);
          let w = null;
          if (full && fs.existsSync(full)) { try { w = widefit.status(stagesDir, f, aspect); } catch (e) { w = null; } }
          results.set(f, w);
        }
        return json(res, 200, { results: Object.fromEntries(results) });
      }
      const file = String(req.method === 'GET' ? (query.file || '') : (body.file || ''));
      const full = stageFilePath(stagesDir, file);
      if (!full) return json(res, 400, { error: 'bad stage name' });
      if (!fs.existsSync(full)) return json(res, 404, { error: 'no such stage' });
      // the build's shape, the same setting the stage-from-image dialog reads
      const st = (vfslib.readRoster().settings) || {};
      const aspect = 1 / stagegen.gameAspect({ GameWidth: st['Video.GameWidth'], GameHeight: st['Video.GameHeight'] });
      const widefit = require('./widefit.js');
      try {
        if (req.method === 'GET') return json(res, 200, { result: widefit.status(stagesDir, file, aspect) });
        const result = body.action === 'undo' ? { was: widefit.undoFile(stagesDir, file) } : widefit.fitFile(stagesDir, file, aspect);
        invalidateVfs();
        return json(res, 200, { result });
      } catch (e) {
        return json(res, 400, { error: e.message });
      }
    }

    // FIT THUMBNAIL (thumbfit.js): a stage's own select-screen picture, drawn
    // too small (or too large) for its coordinate space, gets the
    // portraitscale that fills the box. GET ?file= = what the fit would do,
    // GET ?all=1 = that for every stage of the roster in one request (the
    // Stages tab draws a line per stage, as with the widescreen fit above),
    // POST { file, action: fit | undo } does it. The picture is the one the
    // build's screenpack reads (stage.portrait.spr, else 9000,1). Same
    // stage-name rules as the routes around it.
    if (pathname === '/api/stage-thumbfit') {
      const stagesDir = layout.dir('stages');
      const body = req.method === 'POST' ? JSON.parse((await readBody(req)).toString('utf8') || '{}') : {};
      const query = req.method === 'GET' ? url.parse(req.url, true).query : {};
      const thumbfit = require('./thumbfit.js');
      const roster = vfslib.readRoster();
      let motifDef = null;
      try { motifDef = modlib.motifDefPath(roster); } catch (e) { motifDef = null; }
      const spr = thumbfit.packSpriteAt(motifDef);
      if (req.method === 'GET' && query.all) {
        const results = new Map();
        for (const s of roster.stages || []) {
          const f = String((s && s.file) || '');
          if (!f || results.has(f)) continue;
          const full = stageFilePath(stagesDir, f);
          let t = null;
          if (full && fs.existsSync(full)) { try { t = thumbfit.check(stagesDir, f, spr); } catch (e) { t = null; } }
          results.set(f, t);
        }
        return json(res, 200, { results: Object.fromEntries(results) });
      }
      const file = String(req.method === 'GET' ? (query.file || '') : (body.file || ''));
      const full = stageFilePath(stagesDir, file);
      if (!full) return json(res, 400, { error: 'bad stage name' });
      if (!fs.existsSync(full)) return json(res, 404, { error: 'no such stage' });
      try {
        if (req.method === 'GET') return json(res, 200, { result: thumbfit.check(stagesDir, file, spr) });
        if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' });
        const result = body.action === 'undo' ? thumbfit.undoFile(stagesDir, file) : thumbfit.fit(stagesDir, file, spr);
        invalidateVfs();
        return json(res, 200, { result });
      } catch (e) {
        return json(res, 400, { error: e.message });
      }
    }

    // MADE FOR IKEMEN BEFORE 2025 (textransform.js): GET = whether the stage's
    // models (its own and its round variants') carry texture transforms and
    // whether they are predicted to smear; null for a stage that names no
    // model. POST { file, action: strip | undo } rewrites the models (backed
    // up) or puts them back. GET ?all=1 = { results: { file: what ?file=
    // answers, or null } } for every stage of the roster in one request, like
    // the widescreen-fit line beside it.
    if (pathname === '/api/stage-textransform') {
      const stagesDir = layout.dir('stages');
      const textransform = require('./textransform.js');
      const body = req.method === 'POST' ? JSON.parse((await readBody(req)).toString('utf8') || '{}') : {};
      const query = req.method === 'GET' ? url.parse(req.url, true).query : {};
      if (req.method === 'GET' && query.all) {
        const results = new Map();
        for (const s of vfslib.readRoster().stages || []) {
          const f = String((s && s.file) || '');
          if (!f || results.has(f)) continue;
          const full = stageFilePath(stagesDir, f);
          let r = null;
          if (full && fs.existsSync(full)) { try { r = textransform.status(stagesDir, f); } catch (e) { r = null; } }
          results.set(f, r);
        }
        return json(res, 200, { results: Object.fromEntries(results) });
      }
      const file = String(req.method === 'GET' ? (query.file || '') : (body.file || ''));
      const full = stageFilePath(stagesDir, file);
      if (!full) return json(res, 400, { error: 'bad stage name' });
      if (!fs.existsSync(full)) return json(res, 404, { error: 'no such stage' });
      try {
        if (req.method === 'GET') return json(res, 200, { result: textransform.status(stagesDir, file) });
        if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' });
        if (body.action !== 'strip' && body.action !== 'undo') return json(res, 400, { error: 'action is strip or undo' });
        const result = body.action === 'undo' ? textransform.undo(stagesDir, file) : textransform.strip(stagesDir, file);
        invalidateVfs();
        return json(res, 200, { result });
      } catch (e) {
        return json(res, 400, { error: e.message });
      }
    }

    // FIT CAMERA TO MODEL (widefit3d.js): GET = whether a 3D-model stage's
    // camera lets the screen's sides run past its model (its own def and each
    // round variant's, each with its own model), and the bounds that keep them
    // inside; null for a stage that names no model. POST { file, action: fit |
    // undo } rewrites boundleft/boundright under a marker or puts them back.
    // GET ?all=1 = { results: { file: what ?file= answers, or null } } for every
    // stage of the roster in one request, like the lines beside it. The fight's
    // shape comes from the build's settings, as the engine picks it.
    if (pathname === '/api/stage-widefit3d') {
      const stagesDir = layout.dir('stages');
      const widefit3d = require('./widefit3d.js');
      const body = req.method === 'POST' ? JSON.parse((await readBody(req)).toString('utf8') || '{}') : {};
      const query = req.method === 'GET' ? url.parse(req.url, true).query : {};
      const roster = vfslib.readRoster();
      const settings = roster.settings || {};
      if (req.method === 'GET' && query.all) {
        const results = new Map();
        for (const s of roster.stages || []) {
          const f = String((s && s.file) || '');
          if (!f || results.has(f)) continue;
          const full = stageFilePath(stagesDir, f);
          let r = null;
          if (full && fs.existsSync(full)) { try { r = widefit3d.status(stagesDir, f, settings); } catch (e) { r = null; } }
          results.set(f, r);
        }
        return json(res, 200, { results: Object.fromEntries(results) });
      }
      const file = String(req.method === 'GET' ? (query.file || '') : (body.file || ''));
      const full = stageFilePath(stagesDir, file);
      if (!full) return json(res, 400, { error: 'bad stage name' });
      if (!fs.existsSync(full)) return json(res, 404, { error: 'no such stage' });
      try {
        if (req.method === 'GET') return json(res, 200, { result: widefit3d.status(stagesDir, file, settings) });
        if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' });
        if (body.action !== 'fit' && body.action !== 'undo') return json(res, 400, { error: 'action is fit or undo' });
        const result = body.action === 'undo' ? widefit3d.undo(stagesDir, file) : widefit3d.fit(stagesDir, file, settings);
        invalidateVfs();
        return json(res, 200, { result });
      } catch (e) {
        return json(res, 400, { error: e.message });
      }
    }

    // FIX FLICKER ON DESKTOP (nearfit.js): GET = how far a 3D-model stage's
    // [Camera] near can go without cutting off any of its model the camera
    // can show (its own def and each round variant's, each with its own
    // model); null for a stage that names no model. POST { file, action: fit |
    // undo } sets near under a marker or puts it back. GET ?all=1 answers for
    // every stage of the roster in one request, like the lines beside it.
    if (pathname === '/api/stage-nearfit') {
      const stagesDir = layout.dir('stages');
      const nearfit = require('./nearfit.js');
      const body = req.method === 'POST' ? JSON.parse((await readBody(req)).toString('utf8') || '{}') : {};
      const query = req.method === 'GET' ? url.parse(req.url, true).query : {};
      const roster = vfslib.readRoster();
      const settings = roster.settings || {};
      if (req.method === 'GET' && query.all) {
        const results = new Map();
        for (const s of roster.stages || []) {
          const f = String((s && s.file) || '');
          if (!f || results.has(f)) continue;
          const full = stageFilePath(stagesDir, f);
          let r = null;
          if (full && fs.existsSync(full)) { try { r = nearfit.status(stagesDir, f, settings); } catch (e) { r = null; } }
          results.set(f, r);
        }
        return json(res, 200, { results: Object.fromEntries(results) });
      }
      const file = String(req.method === 'GET' ? (query.file || '') : (body.file || ''));
      const full = stageFilePath(stagesDir, file);
      if (!full) return json(res, 400, { error: 'bad stage name' });
      if (!fs.existsSync(full)) return json(res, 404, { error: 'no such stage' });
      try {
        if (req.method === 'GET') return json(res, 200, { result: nearfit.status(stagesDir, file, settings) });
        if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' });
        if (body.action !== 'fit' && body.action !== 'undo') return json(res, 400, { error: 'action is fit or undo' });
        const result = body.action === 'undo' ? nearfit.undo(stagesDir, file) : nearfit.fit(stagesDir, file, settings);
        invalidateVfs();
        return json(res, 200, { result });
      } catch (e) {
        return json(res, 400, { error: e.message });
      }
    }

    // A MISSING ATTACHED CHARACTER (attachfix.js): GET = which attached
    // characters the stage's defs name, where each was found and whether the
    // game stops when the stage loads (a missing one in the main def); null
    // for a stage that names none. POST { file, action: repair | undo }
    // comments the missing lines out (backed up) or puts them back. GET
    // ?all=1 = { results: { file: what ?file= answers, or null } } for every
    // stage of the roster in one request, like the lines beside it. A path
    // outside the stages folder (the game folder, data/) is looked up in the
    // build's own file list, made only when a stage's attached character is
    // not in the stages folder.
    if (pathname === '/api/stage-attachfix') {
      const stagesDir = layout.dir('stages');
      const attachfix = require('./attachfix.js');
      const inBuild = (p) => {
        const v = getVfs();
        let low = attachIndex.get(v);
        if (!low) { low = new Set([...v.index.keys()].map((k) => String(k).toLowerCase())); attachIndex.set(v, low); }
        return low.has(String(p).toLowerCase());
      };
      const body = req.method === 'POST' ? JSON.parse((await readBody(req)).toString('utf8') || '{}') : {};
      const query = req.method === 'GET' ? url.parse(req.url, true).query : {};
      if (req.method === 'GET' && query.all) {
        const results = new Map();
        for (const s of vfslib.readRoster().stages || []) {
          const f = String((s && s.file) || '');
          if (!f || results.has(f)) continue;
          const full = stageFilePath(stagesDir, f);
          let r = null;
          if (full && fs.existsSync(full)) { try { r = attachfix.status(stagesDir, f, { inBuild }); } catch (e) { r = null; } }
          results.set(f, r);
        }
        return json(res, 200, { results: Object.fromEntries(results) });
      }
      const file = String(req.method === 'GET' ? (query.file || '') : (body.file || ''));
      const full = stageFilePath(stagesDir, file);
      if (!full) return json(res, 400, { error: 'bad stage name' });
      if (!fs.existsSync(full)) return json(res, 404, { error: 'no such stage' });
      try {
        if (req.method === 'GET') return json(res, 200, { result: attachfix.status(stagesDir, file, { inBuild }) });
        if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' });
        if (body.action !== 'repair' && body.action !== 'undo') return json(res, 400, { error: 'action is repair or undo' });
        const result = body.action === 'undo' ? attachfix.undo(stagesDir, file) : attachfix.repair(stagesDir, file, { inBuild });
        invalidateVfs();
        return json(res, 200, { result });
      } catch (e) {
        return json(res, 400, { error: e.message });
      }
    }

    if (pathname === '/api/stage-thumb' || pathname === '/api/stage-thumb-add'
        || pathname === '/api/stage-thumb-remove') {
      const stagesDir = layout.dir('stages');
      let file;
      if (req.method === 'GET') file = String(url.parse(req.url, true).query.file || '');
      else file = String(JSON.parse((await readBody(req)).toString('utf8') || '{}').file || '');
      const full = stageFilePath(stagesDir, file);
      if (!full) return json(res, 400, { error: 'bad stage name' });
      if (!fs.existsSync(full)) {
        return json(res, 404, { error: 'no such stage' });
      }
      try {
        if (pathname === '/api/stage-thumb' && req.method === 'GET') {
          // The picture alone. Nothing is written until the user presses
          // the button, so the card can show what it would get.
          // It is remembered per stage against the def and sff stamps, so the
          // no-store below still never shows a picture the files moved past.
          // A 3D-model stage has no layers to draw, so it answers its own
          // select picture instead (stagethumb ownPicture), and says so:
          // X-Thumb-From: own, X-Thumb-Sprite: 9000,1. A 2D stage's answer
          // is the composite, headers and all, exactly as before.
          const made = stagethumb.previewThumbCached(stagesDir, file);
          res.writeHead(200, Object.assign({
            'Content-Type': 'image/png',
            'Content-Length': made.png.length,
            'X-Thumb-Size': made.w + 'x' + made.h,
            'X-Thumb-Layers': String(made.layers),
            'Cache-Control': 'no-store',
          }, made.from === 'own' ? { 'X-Thumb-From': 'own', 'X-Thumb-Sprite': made.sprite.join(',') } : {}));
          return res.end(made.png);
        }
        if (pathname === '/api/stage-thumb-add' && req.method === 'POST') {
          return json(res, 200, { result: stagethumb.addThumb(stagesDir, file) });
        }
        if (pathname === '/api/stage-thumb-remove' && req.method === 'POST') {
          return json(res, 200, { result: stagethumb.removeThumb(stagesDir, file) });
        }
      } catch (e) {
        return json(res, 400, { error: e.message });
      }
    }

    // WHERE DOWNLOADS GO. The page owns this setting: it persists it here and
    // pushes it into WebView2 itself through nativeSetDownloadFolder, because
    // the window is the only process that can actually move an Edge download.
    // This route is the memory, not the mechanism.
    if (pathname === '/api/download-folder' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
      const dir = String(body.dir || '').trim();
      // Absolute only, like the export destination: a relative path here would
      // resolve against the program folder, which is never what anyone means.
      if (dir && !path.isAbsolute(dir)) {
        return json(res, 400, { error: 'give a full path, e.g. C:\\Users\\you\\Downloads' });
      }
      const now = layout.setDownloadFolder(dir);
      return json(res, 200, { dir: now });
    }

    // Show a character's folder in the OS file manager. This is a desktop
    // tool driving a local machine, so it is a reasonable thing to offer - but
    // the id is validated against the same pattern the other routes use and
    // the path is resolved under CACHE, so nothing a roster says can point the
    // command somewhere else.
    if (pathname === '/api/open-folder' && req.method === 'POST') {
      const { char } = JSON.parse((await readBody(req)).toString('utf8'));
      const id = String(char || '');
      if (!id || !/^[A-Za-z0-9_.-]+$/.test(id) || id === '.' || id === '..') {
        return json(res, 400, { error: 'bad char id' });
      }
      // RESOLVED, NOT JOINED. A library row's id is a mountAs for anything in
      // the build, and a mount name is not always a directory name - a variant's
      // never is. The raw join only worked because Windows absorbs the case
      // difference for the ordinary case (DongHwan vs donghwan); it 404s for a
      // variant on every platform.
      const dir = (() => {
        try { return modlib.charSource(id).dir; } catch (err) { return path.join(layout.dir('cache'), id); }
      })();
      if (!fs.existsSync(dir)) return json(res, 404, { error: 'no such character folder' });
      try {
        startDetached(FOLDER_OPENER, [dir]);
      } catch (e) {
        return json(res, 500, { error: String(e && e.message || e) });
      }
      return json(res, 200, { ok: true, dir });
    }

    // THE MOTIF'S system.def AS TEXT. The grid's shape lives in the screenpack
    // rather than the roster, so the session baseline has to hold this file too
    // or Revert cannot undo a change to it.
    //
    // ?motif=<vpath> ('' = the default) reads another pack than the roster's:
    // E-Select's Revert compares every pack it saw this session with what it
    // first read. Only a screenpack-shaped vpath, resolved inside the
    // screenpack folders (modlib.motifVpathOk, motifDefPath).
    if (pathname === '/api/motif-def' && req.method === 'GET') {
      const q = url.parse(req.url, true).query;
      let motif;
      if (q.motif !== undefined) {
        motif = String(Array.isArray(q.motif) ? q.motif[0] : q.motif);
        if (!modlib.motifVpathOk(motif)) return json(res, 400, { error: 'not a screenpack path: ' + motif });
      }
      const r = modlib.motifDefText(motif);
      if (!r) return json(res, 404, { error: 'motif not found' });
      return json(res, 200, r);
    }

    // Verbatim restore, used by Revert and Undo. No reformatting: what was
    // captured is what goes back. {motif} as for the GET: the roster's own
    // pack when it is absent.
    if (pathname === '/api/motif-def' && req.method === 'POST') {
      const { text, motif } = JSON.parse((await readBody(req)).toString('utf8'));
      if (typeof text !== 'string' || !text) return json(res, 400, { error: 'no text' });
      if (motif !== undefined && !modlib.motifVpathOk(motif)) return json(res, 400, { error: 'not a screenpack path: ' + motif });
      if (!modlib.writeMotifDefText(text, motif === null ? '' : motif)) return json(res, 500, { error: 'could not write the motif' });
      invalidateVfs();
      return json(res, 200, { ok: true });
    }

    // CONTINUE THE PACK'S PER-ROW GEOMETRY over rows it never described. Not
    // done for you when the grid grows - a row past the last `cell.*-N` block
    // draws flat because that is what the ENGINE draws, and an editor that
    // silently rewrote the screenpack to hide it would be lying about the
    // build. Taken from the screenpack's own menu instead.
    if (pathname === '/api/motif-describe-rows' && req.method === 'POST') {
      const r = modlib.describeMotifRows();
      if (r.error) return json(res, 400, r);
      invalidateVfs();
      return json(res, 200, r);
    }

    // The grid's shape. Rows and columns decide how many cells exist at all, so
    // this is the one edit that can change what the roster is allowed to hold.
    if (pathname === '/api/motif-grid' && req.method === 'POST') {
      const b = JSON.parse((await readBody(req)).toString('utf8'));
      const num = (v, lo, hi) => {
        const n = parseInt(v, 10);
        return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : null;
      };
      const vals = {};
      // Bounded because these are written into a file the ENGINE reads: a
      // negative or absurd count is a screenpack that will not boot.
      if (b.rows !== undefined) vals.rows = num(b.rows, 1, 64);
      if (b.columns !== undefined) vals.columns = num(b.columns, 1, 64);
      if (Array.isArray(b.cellSize)) {
        vals.cellSize = [num(b.cellSize[0], 1, 512), num(b.cellSize[1], 1, 512)];
      }
      if (Array.isArray(b.cellSpacing)) {
        vals.cellSpacing = [num(b.cellSpacing[0], 0, 512), num(b.cellSpacing[1], 0, 512)];
      }
      if (b.moveOverEmptyBoxes !== undefined) vals.moveOverEmptyBoxes = !!b.moveOverEmptyBoxes;
      if (b.showEmptyBoxes !== undefined) vals.showEmptyBoxes = !!b.showEmptyBoxes;
      for (const k of Object.keys(vals)) {
        const v = vals[k];
        if (v === null || (Array.isArray(v) && v.some((x) => x === null))) {
          return json(res, 400, { error: 'bad value for ' + k });
        }
      }
      const r = modlib.writeMotifGrid(vals);
      if (r.error) return json(res, 400, r);
      invalidateVfs();
      return json(res, 200, r);
    }

    // The roster exactly as it sits on disk. /api/studio also carries it but
    // rescans every character to get there, which is seconds of work for a
    // snapshot the editor takes on every load.
    if (pathname === '/api/roster' && req.method === 'GET') {
      return json(res, 200, vfslib.readRoster());
    }

    if (pathname === '/api/roster' && req.method === 'POST') {
      const roster = JSON.parse((await readBody(req)).toString('utf8'));
      if (!roster || typeof roster !== 'object' || Array.isArray(roster)) return json(res, 400, { error: 'a roster is an object' });
      // THE SCREENPACK IS A PATH THE SERVER WRITES TO (/api/motif-def), so it
      // has to be one: unset, or data/<folder>/system.def-shaped. What every
      // real roster holds - setTheme only ever stores a listed pack's vpath.
      if (!modlib.motifVpathOk(roster.motif)) {
        return json(res, 400, { error: 'motif must be a screenpack path like data/<folder>/system.def' });
      }
      // Strip derived fields, exactly as /api/build-order and /api/char-props do.
      // Without this the UI's own copy of each character - which carries scan
      // results like h, sffVer, palKeysBroken and missingDeps - was written
      // straight back, so roster.json accumulated 14 diagnostic fields and the
      // two save paths churned the file against each other.
      if (Array.isArray(roster.chars)) roster.chars = roster.chars.map(modlib.cleanChar);
      // A leaderboard pose chosen since the page's snapshot stays (carryBoardArt).
      let onDisk = null;
      try { onDisk = vfslib.readRoster(); } catch (e) { onDisk = null; }
      if (Array.isArray(roster.chars)) roster.chars = modlib.carryBoardArt(roster.chars, onDisk);
      // THE MOD SWITCHES ARE THE MODS TAB'S (modmgr writes roster.modsOff, read
      // and written on disk). A page's older snapshot - E-Select's Undo or
      // Revert, a tab that loaded before the switch - would otherwise turn a mod
      // back on with no message, so the key always comes from the disk.
      if (onDisk && onDisk.modsOff) roster.modsOff = onDisk.modsOff; else delete roster.modsOff;
      if (onDisk && onDisk.modsOn) roster.modsOn = onDisk.modsOn; else delete roster.modsOn;
      // THE H-MUGEN MODULE'S ANSWERS are /api/h-settings' (hmodule.js), on disk
      // the same way: the module's state and, per character, the owner's role
      // and confirmed verdict - an older page snapshot never takes one back.
      for (const k of ['hModule', 'hModuleSeen']) { if (onDisk && onDisk[k] !== undefined) roster[k] = onDisk[k]; else delete roster[k]; }
      // THE COMMAND LIST'S BUTTONS are /api/button-style's (Settings > Controls), on disk the same way.
      if (onDisk && onDisk.buttonStyle !== undefined) roster.buttonStyle = onDisk.buttonStyle; else delete roster.buttonStyle;
      if (Array.isArray(roster.chars)) {
        const disk = new Map(((onDisk && onDisk.chars) || []).map((c) => [(c.folder || '') + '|' + (c.select || ''), c]));
        for (const c of roster.chars) {
          const d = disk.get((c.folder || '') + '|' + (c.select || ''));
          for (const k of ['hRole', 'hReviewed']) { if (d && d[k] !== undefined) c[k] = d[k]; else delete c[k]; }
        }
      }
      vfslib.writeRoster(roster);
      invalidateVfs();
      return json(res, 200, { ok: true });
    }

    // Convert a character's indexed-PNG palettes to .act, which every engine
    // build reads - the desktop one has no readPngPalette. See modlib.
    if (pathname === '/api/convert-png-palettes' && req.method === 'POST') {
      const { folder, revert } = JSON.parse((await readBody(req)).toString('utf8') || '{}');
      const result = revert ? modlib.revertPngPalettes(folder) : modlib.convertPngPalettes(folder);
      invalidateVfs();
      return json(res, 200, { ok: true, result });
    }

    // Fill palette slots an external .act blanks but the .sff provides.
    if (pathname === '/api/fill-palette-gaps' && req.method === 'POST') {
      const { folder, select, revert } = JSON.parse((await readBody(req)).toString('utf8') || '{}');
      // `select`: the entry's own .def (a variant sharing the folder); none = the folder's first entry.
      const result = revert ? modlib.revertPaletteGaps(folder, { select }) : modlib.fillPaletteGaps(folder, { select });
      invalidateVfs();
      return json(res, 200, { ok: true, result });
    }

    // PRE-FLIGHT: which characters would break a build, and how badly.
    // One character that cannot be preloaded panics the engine and kills the
    // whole build, so this is what stands between a bad drop and a dead export.
    if (pathname === '/api/check-chars') {
      return json(res, 200, modlib.checkAllChars());
    }

    // A screenpack add that turns out to be a LIFEBAR pack (modlib tags it)
    // goes into the bundle's lifebar library instead: the pack is on disk and
    // it is what was meant. The Theme tab's path box and Browse always send
    // 'theme', so this is how a lifebar folder or zip on disk gets added.
    // A theme folder of the same name already existing is not a reason to
    // refuse a lifebar pack either: addTheme checks the name before it looks.
    //
    // An installed SCREENPACK's result carries `motif`, its vpath
    // (data/<folder>/system.def) - the value /api/theme takes - so a page that
    // installs a pack can select it next without knowing how the folder was
    // named. A lifebar pack has none: it is not a screenpack.
    const themeOrLifebar = (src, nameHint, source) => {
      try {
        const t = modlib.addTheme(src, nameHint);
        return Object.assign(t, { motif: t.path });
      } catch (e) {
        const lbs = require('./lifebars.js');
        const isLifebar = e && (e.code === 'LIFEBAR_PACK' || (/already exists/.test(String(e.message)) && lbs.looksLikeLifebarPack(src)));
        if (!isLifebar) throw e;
        return Object.assign(lbs.install(src, { nameHint, source }), { asLifebar: true });
      }
    };
    // E-Select's "Replace RandomSelect cells when no free cells available",
    // carried by a character add as a request field (placeInRoster): a JSON
    // body's `replaceRandom`, or for the raw-bytes upload the X-Replace-Random
    // header; the query string works for all three.
    const replaceRandomFrom = (bodyVal) => {
      const q = url.parse(req.url, true).query;
      const v = bodyVal !== undefined ? bodyVal
        : (req.headers['x-replace-random'] !== undefined ? req.headers['x-replace-random'] : q.replaceRandom);
      return v === true || v === 1 || /^\s*(1|true)\s*$/i.test(String(v == null ? '' : v));
    };
    // A mod installed by any of the three add routes answers with the Mods
    // tab's whole list as well (`list`, the GET /api/mods body), so the page
    // redraws from the answer the way the tab's own routes let it.
    const modResult = (r) => Object.assign(r, { list: modmgr().listMods() });

    // Add from a path on this machine (e.g. your G: collection).
    if (pathname === '/api/add-local' && req.method === 'POST') {
      const { kind, path: srcPath, replaceRandom, askIfBuild } = JSON.parse((await readBody(req)).toString('utf8'));
      if (!fs.existsSync(srcPath)) throw new Error('path does not exist: ' + srcPath);
      // A WHOLE BUILD IS NOT A CHARACTER OR A STAGE. The Studio's add box asks
      // (askIfBuild) and gets this back, before anything is copied, instead of
      // the build going in as one character; the page then offers the build
      // importer. Other callers do not ask, and add exactly as before.
      if (askIfBuild && (kind === 'char' || kind === 'stage')) {
        const build = require('./buildimport.js').wholeBuildAt(srcPath);
        if (build) {
          const dir = path.resolve(srcPath);
          return json(res, 200, { ok: false, wholeBuild: Object.assign({ dir, name: path.basename(dir) }, build) });
        }
      }
      const result =
        kind === 'char' ? modlib.addCharacter(srcPath, undefined, { replaceRandom: replaceRandomFrom(replaceRandom) }) :
        kind === 'stage' ? modlib.addStage(srcPath) :
        kind === 'music' ? modlib.addMusic(srcPath) :
        kind === 'theme' ? themeOrLifebar(srcPath) :
        kind === 'lifebar' ? require('./lifebars.js').install(srcPath) :
        kind === 'mod' ? modResult(modmgr().installMod(srcPath, { source: path.basename(String(srcPath)) })) :
        (() => { throw new Error('kind must be char|stage|music|theme|lifebar|mod'); })();
      invalidateVfs();
      return json(res, 200, { ok: true, result });
    }

    // Drag-and-drop upload: raw bytes + filename/kind in headers.
    // DROPPING A FOLDER, not just a .zip.
    //
    // The add* functions have always taken a directory - that is what the
    // paste-a-path field passes them - but a browser drop hands over FILES,
    // never a path, so a dropped folder had nothing to give the server and
    // silently did nothing. The pieces are staged under one token instead and
    // the finished directory goes to the same add* call a pasted path would
    // reach, so nothing downstream knows the difference.
    //
    // Two steps because a browser cannot post a directory in one piece: each
    // file arrives with its path RELATIVE to the dropped folder, then a commit
    // names the kind.
    if (pathname === '/api/upload-part' && req.method === 'POST') {
      const token = String(req.headers['x-token'] || '');
      const rel = decodeURIComponent(String(req.headers['x-relpath'] || ''));
      // The token names a directory and the relative path builds a tree inside
      // it, so both are attacker-controlled input to a filesystem write. A
      // token is a plain id, and a relative path may not climb, be absolute, or
      // carry a drive letter.
      if (!/^[a-z0-9]{6,40}$/i.test(token)) return json(res, 400, { error: 'bad token' });
      const parts = rel.split(/[\\/]+/).filter((x) => x && x !== '.');
      if (!parts.length || parts.some((x) => x === '..') || /^[a-z]:$/i.test(parts[0])) {
        return json(res, 400, { error: 'bad path' });
      }
      const root = path.join(os.tmpdir(), 'mugen-drop', token);
      // A drop that is abandoned half way - the tab closed, the network went -
      // never reaches the commit that cleans up, so its parts would sit in the
      // temp directory for ever. Anything older than an hour is somebody's
      // abandoned drop, and an hour is far longer than a folder takes to send.
      sweepStaging(path.dirname(root), token);
      const dest = path.join(root, ...parts);
      if (!path.resolve(dest).startsWith(path.resolve(root) + path.sep)) {
        return json(res, 400, { error: 'bad path' });
      }
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, await readBody(req));
      return json(res, 200, { ok: true });
    }

    if (pathname === '/api/upload-folder' && req.method === 'POST') {
      const { token, kind, replaceRandom } = JSON.parse((await readBody(req)).toString('utf8') || '{}');
      if (!/^[a-z0-9]{6,40}$/i.test(String(token || ''))) {
        return json(res, 400, { error: 'bad token' });
      }
      const root = path.join(os.tmpdir(), 'mugen-drop', String(token));
      if (!fs.existsSync(root)) return json(res, 400, { error: 'nothing was staged' });
      try {
        // The relative paths began with the dropped folder's own name, so the
        // staged tree has exactly one top entry and THAT is what was dropped -
        // its basename is the name addCharacter and addTheme derive from.
        const top = fs.readdirSync(root);
        if (top.length !== 1) return json(res, 400, { error: 'expected one folder' });
        const dir = path.join(root, top[0]);
        if (!fs.statSync(dir).isDirectory()) return json(res, 400, { error: 'not a folder' });

        // A stage and a piece of music are FILES inside the folder, not the
        // folder itself, so those two are resolved before handing over.
        const walk = (d, out = []) => {
          for (const e of fs.readdirSync(d, { withFileTypes: true })) {
            const q = path.join(d, e.name);
            if (e.isDirectory()) walk(q, out); else out.push(q);
          }
          return out;
        };
        let result;
        if (kind === 'char') result = modlib.addCharacter(dir, top[0], { replaceRandom: replaceRandomFrom(replaceRandom) });
        else if (kind === 'theme') result = themeOrLifebar(dir, top[0]);
        else if (kind === 'lifebar') result = require('./lifebars.js').install(dir, { nameHint: top[0] });
        else if (kind === 'logo') result = modlib.addLogo(dir);
        else if (kind === 'mod') result = modResult(modmgr().installMod(dir, { nameHint: top[0], source: top[0] }));
        else if (kind === 'stage') {
          const def = walk(dir).find((f) => f.toLowerCase().endsWith('.def'));
          if (!def) return json(res, 400, { error: 'no .def in that folder' });
          result = modlib.addStage(def);
        } else if (kind === 'music') {
          const songs = walk(dir).filter((f) => /\.(ogg|mp3|wav|flac|m4a)$/i.test(f));
          if (!songs.length) return json(res, 400, { error: 'no audio in that folder' });
          result = songs.map((f) => modlib.addMusic(f, path.basename(f)));
          result = { added: result.length, name: top[0] };
        } else return json(res, 400, { error: 'kind must be char|stage|music|theme|logo|lifebar|mod' });
        invalidateVfs();
        return json(res, 200, { ok: true, result });
      } finally {
        rmTemp(root);
      }
    }

    // AN IMAGE BECOMES A STAGE.
    //
    // The one thing a picture cannot tell you is where the ground is, so floorY
    // comes from the caller - the placement step in the UI, measured in IMAGE
    // PIXELS from the top. Everything else is derived from the image's size.
    // Omit it and stagegen falls back to the stock 200-of-240 ratio.
    if (pathname === '/api/stage-from-image' && req.method === 'POST') {
      const q = url.parse(req.url, true).query;
      const name = String(q.name || '').slice(0, 60);
      const buf = await readBody(req);
      if (!buf || buf.length < 24) return json(res, 400, { error: 'no image received' });
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stagegen-'));
      const src = path.join(tmpDir, 'source.png');
      try {
        fs.writeFileSync(src, buf);
        const floorY = parseFloat(q.floorY);
        const span = parseFloat(q.span);
        // The game's aspect decides how TALL one screen of picture is. It is a
        // user setting (Video.GameWidth/GameHeight on the roster), read here
        // and in the dialog the same way, so the preview rectangle and the
        // written bounds agree. Absent means the schema default, 854x480.
        const st = (vfslib.readRoster().settings) || {};
        const aspect = stagegen.gameAspect({
          GameWidth: st['Video.GameWidth'], GameHeight: st['Video.GameHeight'],
        });
        const r = stagegen.makeStage(src, tmpDir, {
          name, author: String(q.author || '').slice(0, 60),
          fileName: name,
          floorY: Number.isFinite(floorY) ? floorY : undefined,
          span: Number.isFinite(span) ? span : 1,
          aspect,
          music: String(q.music || '').slice(0, 120),
        });
        const added = modlib.addStage(path.join(tmpDir, r.def));
        invalidateVfs();
        return json(res, 200, { ok: true, result: Object.assign({}, r, { added }) });
      } catch (e) {
        return json(res, 400, { error: e.message });
      } finally {
        rmTemp(tmpDir);
      }
    }

    if (pathname === '/api/upload' && req.method === 'POST') {
      const kind = req.headers['x-kind'];
      const name = decodeURIComponent(req.headers['x-filename'] || 'upload');
      const tmp = modlib.bufferToTemp(await readBody(req), name);
      try {
        const nameHint = name.replace(/\.[^.]*$/, '');
        const result =
          kind === 'char' ? modlib.addCharacter(tmp, nameHint, { replaceRandom: replaceRandomFrom(undefined) }) :
          kind === 'stage' ? modlib.addStage(tmp) :
          kind === 'music' ? modlib.addMusic(tmp, name) :
          kind === 'theme' ? themeOrLifebar(tmp, nameHint, name) :
          kind === 'logo' ? modlib.addLogo(tmp, name) :
          kind === 'lifebar' ? require('./lifebars.js').install(tmp, { nameHint, source: name }) :
          kind === 'mod' ? modResult(modmgr().installMod(tmp, { nameHint, source: name })) :
          (() => { throw new Error('kind must be char|stage|music|theme|logo|lifebar|mod'); })();
        invalidateVfs();
        return json(res, 200, { ok: true, result });
      } catch (e) {
        // A refusal that names the file ("could not unpack ...") names the one
        // that was DROPPED, not the temp copy (mugen-upload-<ms>-<slug>.7z).
        if (e && typeof e.message === 'string') e.message = e.message.split(path.basename(tmp)).join(name);
        throw e;
      } finally {
        rmTemp(tmp, true);
      }
    }

    if (pathname === '/api/remove' && req.method === 'POST') {
      const { kind, id } = JSON.parse((await readBody(req)).toString('utf8'));
      const result =
        kind === 'char' ? modlib.removeCharacter(id) :
        kind === 'stage' ? modlib.removeStage(id) :
        kind === 'music' ? modlib.removeMusic(id) :
        (() => { throw new Error('kind must be char|stage|music'); })();
      invalidateVfs();
      return json(res, 200, { ok: true, result });
    }

    // Several at once (Select mode): the same removers, one call, one rebuild.
    if (pathname === '/api/remove-many' && req.method === 'POST') {
      const { kind, ids } = JSON.parse((await readBody(req)).toString('utf8'));
      const result = modlib.removeMany(kind, ids);
      invalidateVfs();
      return json(res, 200, { ok: true, result });
    }

    // THE MODS TAB (modmgr.js): the Studio's own add-ons and the bundle's own
    // mods. Every answer is the whole list, so the page redraws from it and
    // patches state.roster.modsOff; a switch is roster.modsOff, read and
    // written on disk (never the page's snapshot), and every write is a new
    // build. Installing goes through the add routes above with kind 'mod'.
    if (pathname === '/api/mods' && req.method === 'GET') {
      return json(res, 200, modmgr().listMods());
    }
    if (pathname === '/api/mods/toggle' && req.method === 'POST') {
      const { kind, id, on } = JSON.parse((await readBody(req)).toString('utf8') || '{}');
      if (typeof on !== 'boolean') return json(res, 400, { error: 'on must be true or false' });
      const list = modmgr().setModOn(kind, id, on);
      invalidateVfs();
      return json(res, 200, list);
    }
    if (pathname === '/api/mods/remove' && req.method === 'POST') {
      const { folder } = JSON.parse((await readBody(req)).toString('utf8') || '{}');
      const list = modmgr().removeMod(folder);
      invalidateVfs();
      return json(res, 200, list);
    }
    // A card's picture: a file inside one mod folder, a picture by its
    // extension. modmgr.imageFor refuses '..', a drive, a stream and a link
    // leading out. Served as data, never as a page, like the build's files.
    // Read me: a mod's readme, whole, as text (the page renders it).
    if (pathname === '/api/mods/readme' && req.method === 'GET') {
      const q = url.parse(req.url, true).query;
      const one = (v) => String(Array.isArray(v) ? v[0] : (v == null ? '' : v));
      const r = modmgr().readmeFor(one(q.folder));
      if (!r) return json(res, 404, { error: 'this mod has no readme' });
      return json(res, 200, r);
    }
    if (pathname === '/api/mods/image' && req.method === 'GET') {
      const q = url.parse(req.url, true).query;
      const one = (v) => String(Array.isArray(v) ? v[0] : (v == null ? '' : v));
      const img = modmgr().imageFor(one(q.folder), one(q.file));
      if (!img) return json(res, 404, { error: 'no such picture' });
      const buf = fs.readFileSync(img.abs);
      res.writeHead(200, { 'Content-Type': img.type, 'Content-Length': buf.length, 'Cache-Control': 'no-store',
        'Content-Security-Policy': 'sandbox', 'X-Content-Type-Options': 'nosniff' });
      return res.end(buf);
    }
    // Open folder: the bundle's mods folder (made when it is not there yet),
    // or one mod's, in the OS file manager - the opener a character's folder
    // uses (/api/open-folder). A folder NAME, never a path: modmgr resolves it
    // inside the bundle's mods folder.
    if (pathname === '/api/mods/open' && req.method === 'POST') {
      const { folder } = JSON.parse((await readBody(req)).toString('utf8') || '{}');
      const dir = modmgr().openTarget(folder);
      if (!dir) return json(res, 404, { error: 'there is no mod called ' + folder });
      try {
        startDetached(FOLDER_OPENER, [dir]);
      } catch (e) {
        return json(res, 500, { error: String(e && e.message || e) });
      }
      return json(res, 200, { ok: true, dir });
    }

    // SFF v1 palette repair (the "colors revert on some moves" fix).
    if (pathname === '/api/fix-palettes' && req.method === 'POST') {
      const { folder, select, revert } = JSON.parse((await readBody(req)).toString('utf8'));
      // `select`: the entry's own .def (a variant sharing the folder); none = the folder's first entry.
      const result = revert ? modlib.revertV1Palettes(folder, { select }) : modlib.fixV1Palettes(folder, { select });
      invalidateVfs();
      return json(res, 200, { ok: true, result });
    }

    // Themes (screenpacks): pick the motif the engine boots with, or add one.
    if (pathname === '/api/theme' && req.method === 'POST') {
      const { motif } = JSON.parse((await readBody(req)).toString('utf8') || '{}');
      const result = modlib.setTheme(motif);
      invalidateVfs();
      return json(res, 200, { ok: true, result });
    }
    // WHAT SHAPE THE SCREENPACK ITSELF ASKS FOR. Read-only: the editor uses it
    // to decide whether to offer the import and what to say about it.
    if (pathname === '/api/theme-layout' && req.method === 'GET') {
      const q = url.parse(req.url, true).query;
      // One folder inside themes/ (modlib.themeFolderDir), never a path.
      if (!modlib.themeFolderDir(q.folder)) return json(res, 400, { error: 'bad theme folder' });
      // fromSystemDef: also read the 0.99 cell skips of a pack with no
      // select.def (modlib.themeLayout) - E-Select asks, setTheme never does.
      const r = modlib.themeLayout(q.folder, { fromSystemDef: q.fromSystemDef === '1' || q.fromSystemDef === 'true' });
      if (!r) return json(res, 404, { error: 'no layout in this screenpack' });
      return json(res, 200, r);
    }

    // Rearrange the roster into that shape. The characters and their settings
    // are untouched - only which cell each one sits in.
    if (pathname === '/api/theme-layout' && req.method === 'POST') {
      const { folder, fromSystemDef } = JSON.parse((await readBody(req)).toString('utf8') || '{}');
      if (!modlib.themeFolderDir(folder)) return json(res, 400, { error: 'bad theme folder' });
      const r = modlib.applyThemeLayout(folder, { fromSystemDef: fromSystemDef === true });
      if (r.error) return json(res, 400, r);
      invalidateVfs();
      return json(res, 200, r);
    }

    // WHAT A SCREENPACK BRINGS BESIDES ITS SCREENS (themeopts.js): its own
    // common states, the game systems it adds, its debug font - read at
    // install, kept in the theme folder. The Theme tab's cards, the switches in
    // Settings > Engine and the extra-systems question all read and write it
    // here, so the two places always agree.
    if (pathname === '/api/theme-options' && req.method === 'GET') {
      const q = url.parse(req.url, true).query;
      if (!modlib.themeFolderDir(q.folder)) return json(res, 400, { error: 'bad theme folder' });
      try { return json(res, 200, require('./themeopts.js').view(q.folder)); }
      catch (e) { return json(res, e.status || 500, { error: e.message }); }
    }
    // The dry run of switching one of a pack's own variants (slot counts,
    // announcers): what would move, for the dialog that asks first. A GET, so
    // the page's announce-on-mutation never fires for it.
    if (pathname === '/api/theme-options/plan' && req.method === 'GET') {
      const q = url.parse(req.url, true).query;
      if (!modlib.themeFolderDir(q.folder)) return json(res, 400, { error: 'bad theme folder' });
      try { return json(res, 200, require('./themeopts.js').plan(q.folder, String(q.group || ''), String(q.choice || ''))); }
      catch (e) { return json(res, e.status || 500, { error: e.message }); }
    }
    if (pathname === '/api/theme-options' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
      if (!modlib.themeFolderDir(body.folder)) return json(res, 400, { error: 'bad theme folder' });
      // { group, choice, relay }: switch a variant, on disk (themeopts.choose).
      if (typeof body.group === 'string' && typeof body.choice === 'string') {
        let r;
        try { r = require('./themeopts.js').choose(body.folder, body.group, body.choice, body.relay === true); }
        catch (e) { return json(res, e.status || 500, { error: e.message }); }
        invalidateVfs();
        return json(res, 200, r);
      }
      if (!body.common || typeof body.common !== 'object') return json(res, 400, { error: 'nothing to change' });
      let r;
      try { r = require('./themeopts.js').setCommon(body.folder, body.common); }
      catch (e) { return json(res, e.status || 500, { error: e.message }); }
      invalidateVfs();
      return json(res, 200, r);
    }

    // EVERY ENGINE SETTING THE BUILD DECIDES. The schema is generated from an
    // audit of rc.5's own defaults against the engine source (settings-schema.js)
    // and is served rather than duplicated in the page, so the editor and the two
    // exporters can never disagree about what a key means or what it accepts.
    if (pathname === '/api/settings' && req.method === 'GET') {
      return json(res, 200, {
        schema: require('./settings-schema').SETTINGS,
        values: vfslib.readRoster().settings || {},
      });
    }

    // Stored SPARSE: only keys the user actually moved off the default are kept,
    // so an untouched setting keeps whatever the engine's own default is and a
    // later Ikemen release is free to change it under us. Writing every key
    // would silently pin all 101 to rc.5's values forever.
    if (pathname === '/api/settings' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
      const schema = require('./settings-schema');
      const known = new Map(schema.SETTINGS.map((x) => [x.sec + '.' + x.key, x]));
      const clean = {};
      for (const [k, v] of Object.entries(body.values || {})) {
        const def = known.get(k);
        if (!def || v === '' || v == null) continue;      // unknown key, or cleared
        // "At the default" has to mean at the default IN EVERY PRODUCT THIS KEY
        // REACHES, because the two do not share one. The website ships 854x480
        // and half volume by choice, so testing against the engine alone threw
        // away a deliberate 1280x720 for the web build - 1280 being exactly what
        // the engine defaults to - and the setting vanished from the panel.
        if (schema.isDefaultEverywhere(def, v)) continue;
        clean[k] = v;
      }
      const roster = vfslib.readRoster();
      if (Object.keys(clean).length) roster.settings = clean;
      else delete roster.settings;
      vfslib.writeRoster(roster);
      invalidateVfs();
      return json(res, 200, { ok: true, values: clean });
    }

    // KEY AND GAMEPAD BINDINGS - Settings > Controls. The schema deliberately
    // leaves the [Keys_Pn]/[Joystick_Pn] sections out because a text field is
    // the wrong shape for them; keylib.js holds the names the engine parses,
    // this build's own layout, and the conflict rule the engine's own
    // key-config screen uses. The page captures a press and sends the name.
    if (pathname === '/api/keys' && req.method === 'GET') {
      const keylib = require('./keylib');
      const roster = vfslib.readRoster();
      return json(res, 200, {
        ok: true,
        model: keylib.model(roster.keys, vfslib.playersOf(roster)),
        actions: keylib.ACTIONS,
        names: keylib.KEY_NAMES,
        buttons: keylib.BUTTON_NAMES,
        codes: keylib.CODE_TO_NAME,
        padButtons: keylib.PAD_BUTTON_TO_TOKEN,
        padAxes: keylib.PAD_AXIS_TO_TOKEN,
        unreachable: keylib.UNREACHABLE,
        nokey: keylib.NOKEY,
        written: keylib.sectionsWritten(roster.keys, vfslib.playersOf(roster)),
      });
    }

    // Stored SPARSE, like the engine settings: only a binding that differs
    // from what this build or the engine ships is kept, so an untouched action
    // follows the shipped default instead of being pinned to today's value.
    // A null clears one action back to that default; `reset` clears the slot.
    if (pathname === '/api/keys' && req.method === 'POST') {
      const keylib = require('./keylib');
      const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
      const slot = String(body.slot || '').toLowerCase();
      if (!/^(keys|joystick)_p[1-8]$/.test(slot)) throw new Error('no such control slot: ' + body.slot);
      const roster = vfslib.readRoster();
      const keys = Object.assign({}, roster.keys);
      if (body.reset) {
        delete keys[slot];
      } else {
        const merged = Object.assign({}, keys[slot]);
        for (const [k, v] of Object.entries(body.set || {})) {
          if (v === null) delete merged[k];
          else merged[k] = v;
        }
        keys[slot] = merged;
      }
      const clean = keylib.normalize(keys);
      if (Object.keys(clean).length) roster.keys = clean; else delete roster.keys;
      vfslib.writeRoster(roster);
      invalidateVfs();
      return json(res, 200, {
        ok: true,
        model: keylib.model(roster.keys, vfslib.playersOf(roster)),
        written: keylib.sectionsWritten(roster.keys, vfslib.playersOf(roster)),
      });
    }

    // THE COMMAND LIST'S BUTTONS - Settings > Controls (buttonstyle.js). The
    // bundle's choice of the pictures the pause menu's Command List draws for
    // a button (roster.buttonStyle; absent = the default, Arcade), and each
    // style's pictures for the eight buttons the list prints (and any punch,
    // any kick, Start), mapped through
    // Joystick_P1 as this build writes it. POST { style } saves it.
    if (pathname === '/api/button-style' && (req.method === 'GET' || req.method === 'POST')) {
      const BTN = require('./buttonstyle.js');
      let roster = vfslib.readRoster();
      if (req.method === 'POST') {
        const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
        if (!BTN.STYLE_IDS.includes(String(body.style || ''))) throw new Error('no such button style: ' + body.style);
        roster = vfslib.readRoster();
        if (body.style === BTN.DEFAULT_STYLE) delete roster.buttonStyle; else roster.buttonStyle = body.style;
        vfslib.writeRoster(roster);
        invalidateVfs();
      }
      let stock = null;
      try { stock = fs.readFileSync(path.join(layout.dir('release-v2'), 'data', 'glyphs.sff')); } catch (e) { stock = null; }
      return json(res, 200, { ok: true, style: BTN.styleOf(roster), def: BTN.DEFAULT_STYLE, styles: BTN.preview(roster.keys, stock) });
    }

    // WHERE THIS BUILD FINDS ITS RELAYS - the Settings > Online tab. Three
    // routes over two files this server already writes: the endpoint values
    // in local-config.json (the program folder, never inside any build) and
    // the leaderboard address + menu switch in roster.json (the content
    // folder), kept apart for the reason local-config.js gives. GET is
    // redacted - the page never sees the metered key, only that one is set -
    // and the test route dials whatever it is handed without persisting any
    // of it, so a value can be tried before it is saved.
    // THE ONLINE SETUP GUIDE, as text, for public/guide.html to draw. The tab's
    // steps say a relay or a leaderboard needs a server of your own; this is
    // where it says what that server has to do.
    if (pathname === '/api/setup-guide' && req.method === 'GET') {
      let text = null;
      try { text = fs.readFileSync(SETUP_GUIDE, 'utf8'); } catch (e) { text = null; }
      if (text === null) return json(res, 404, { error: 'this copy of the Studio has no setup guide' });
      res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(text);
      return;
    }

    if (pathname === '/api/local-config' && req.method === 'GET') {
      return json(res, 200, hostingState());
    }

    if (pathname === '/api/local-config' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
      // Only keys PRESENT in the body change, so the page can send one field
      // per edit and the key field stays silent unless it was typed into.
      const patch = {};
      for (const k of localConfig.KEYS) if (typeof body[k] === 'string') patch[k] = body[k];
      const check = Object.assign({}, patch);
      if (typeof body.identityUrl === 'string') check.identityUrl = body.identityUrl;
      const v = localConfig.validate(check, localConfig.load());
      if (!v.ok) {
        const field = Object.keys(v.errors)[0];
        return json(res, 400, { error: field + ': ' + v.errors[field], field });
      }
      if (Object.keys(patch).length) localConfig.save(patch);
      if (typeof body.identityUrl === 'string' || typeof body.onlineName === 'boolean'
          || typeof body.leaderboardPage === 'string' || (body.queueMode && typeof body.queueMode === 'object')
          || (body.leaderboardLook && typeof body.leaderboardLook === 'object')) {
        // Read-modify-write on disk, like /api/settings - never the page's
        // snapshot, which /api/roster warns about.
        const roster = vfslib.readRoster();
        if (typeof body.identityUrl === 'string') {
          // Trailing slashes go, the way identity.js strips them before it
          // appends a route. Blank removes the key: blank is "off".
          const u = body.identityUrl.trim().replace(/\/+$/, '');
          if (u) roster.identityUrl = u; else delete roster.identityUrl;
        }
        if (typeof body.onlineName === 'boolean') {
          if (body.onlineName) roster.onlineName = true; else delete roster.onlineName;
        }
        // Plain standings is the default and is stored as no key at all.
        if (typeof body.leaderboardPage === 'string') {
          if (body.leaderboardPage === 'board') roster.leaderboardPage = 'board'; else delete roster.leaderboardPage;
        }
        // 1 vs 1 is the default and is stored as no key at all, too.
        if (body.queueMode && typeof body.queueMode === 'object') {
          const q = require('./queuemode').toRoster(body.queueMode);
          if (q) roster.queueMode = q; else delete roster.queueMode;
        }
        // The board's look: the banner header is the default, stored as no key.
        if (body.leaderboardLook && typeof body.leaderboardLook === 'object') {
          const l = require('./leaderboardlook').toRoster(body.leaderboardLook);
          if (l) roster.leaderboardLook = l; else delete roster.leaderboardLook;
        }
        vfslib.writeRoster(roster);
        invalidateVfs();   // onlineName and queueMode are build-time inputs to vfslib
      }
      return json(res, 200, Object.assign(hostingState(), { warnings: v.warnings }));
    }

    // MAKE THE BOARD'S ART NOW, for the active bundle, exactly as its next
    // Website export would (export.js makeBoardArt, into the bundle's own
    // folder and nowhere else), so the preview shows the portraits and win
    // poses before anything is exported. Same rule as the export: this copy
    // has the extractor, and the bundle has a leaderboard address.
    if (pathname === '/api/leaderboard-art' && req.method === 'POST') {
      if (!modlib.boardArtTool()) return json(res, 404, { error: 'leaderboard art is not part of this build' });
      if (!modlib.canBoardArt()) return json(res, 400, { error: 'set a leaderboard address first - the art is made for a bundle with a leaderboard' });
      const r = makeBoardArt();
      const skipped = (r.rows || []).filter((x) => x.skipped).map((x) => ({ name: x.name, why: x.skipped }));
      return json(res, 200, Object.assign(hostingState(), { made: { chars: r.chars, skipped } }));
    }

    // A RANK'S OWN ICON, in place of its shield: one PNG, WebP or SVG the
    // host picked, kept in the active bundle's rank-picture folder
    // (layout.LEADERBOARD_RANKS) under a name made from the rank and the
    // picture's own hash, so the same picture twice is one file. Checked
    // whole first (leaderboardlook.rankImageFile: the type, 256 KB, the bytes,
    // an SVG's contents). This only keeps the file; the look names it when
    // the page saves the look (/api/local-config), as with every other part
    // of it.
    if (pathname === '/api/leaderboard-rank-image' && req.method === 'POST') {
      const raw = await readBody(req);
      // 256 KB in base64 inside a little JSON, with room to spare.
      if (raw.length > 400 * 1024) return json(res, 400, { error: 'That picture is over 256 KB. A rank icon is drawn small: save it smaller and try again.' });
      const body = JSON.parse(raw.toString('utf8') || '{}');
      let pic;
      try { pic = require('./leaderboardlook').rankImageFile(body); } catch (e) { return json(res, 400, { error: e.message }); }
      const dir = layout.LEADERBOARD_RANKS;
      const file = path.join(dir, pic.name);
      fs.mkdirSync(dir, { recursive: true });
      if (!fs.existsSync(file)) {
        // Written beside it and moved into place, so a picture cut off halfway
        // never sits under the name its hash promises.
        const part = file + '.part-' + process.pid;
        fs.writeFileSync(part, pic.buf);
        fs.renameSync(part, file);
      }
      return json(res, 200, { ok: true, file: pic.name });
    }

    // THE PAGE'S BACKGROUND: one picture, animated picture or short video,
    // sent as the file itself (its type in Content-Type), not as base64 in
    // JSON: a 20 MB video would be a 27 MB request held whole. Read only up
    // to the larger cap and refused past it, then checked like a rank picture
    // (leaderboardlook.backgroundFile: the type, the size for its kind, the
    // bytes) and kept in the bundle's background folder
    // (layout.LEADERBOARD_BG) under its hash. The look names it when the page
    // saves the look.
    if (pathname === '/api/leaderboard-background' && req.method === 'POST') {
      const L = require('./leaderboardlook');
      const cap = Math.max(L.BG_IMAGE_MAX_BYTES, L.BG_VIDEO_MAX_BYTES);
      const chunks = [];
      let got = 0, over = false;
      await new Promise((resolve, reject) => {
        req.on('data', (c) => {
          if (over) return;
          got += c.length;
          if (got > cap) { over = true; chunks.length = 0; return; }
          chunks.push(c);
        });
        req.on('end', resolve);
        req.on('error', reject);
      });
      if (over) return json(res, 400, { error: 'That file is over 20 MB. Make the loop shorter or smaller and try again.' });
      let bg;
      try { bg = L.backgroundFile(req.headers['content-type'], Buffer.concat(chunks)); } catch (e) { return json(res, 400, { error: e.message }); }
      const dir = layout.LEADERBOARD_BG;
      const file = path.join(dir, bg.name);
      fs.mkdirSync(dir, { recursive: true });
      if (!fs.existsSync(file)) {
        const part = file + '.part-' + process.pid;
        fs.writeFileSync(part, bg.buf);
        fs.renameSync(part, file);
      }
      return json(res, 200, { ok: true, file: bg.name });
    }

    if (pathname === '/api/local-config/test' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
      const stored = localConfig.load();
      const roster = vfslib.readRoster();
      // A value in the body is tried AS TYPED; one that is absent is the one
      // on disk. So "test before save" works, and so does "test what I have".
      const pick = (k, fallback) => (typeof body[k] === 'string' ? body[k]
        : (typeof fallback === 'string' ? fallback : ''));
      const r = await localConfig.probe({
        what: body.what,
        signalUrl: pick('signalUrl', stored.signalUrl),
        meteredApp: pick('meteredApp', stored.meteredApp),
        meteredKey: pick('meteredKey', stored.meteredKey),
        identityUrl: pick('identityUrl', roster.identityUrl),
      });
      return json(res, r.error ? 400 : 200, r);
    }

    // YOUR OWN SERVERS (Cloudflare): the host kit, set up from one pasted
    // token (hostkit/deploy.js). The token goes in once, through host-token,
    // and every other route uses the copy in local-config.json; no answer ever
    // carries it or the admin key.
    if (pathname.startsWith('/api/host-') && req.method === 'POST') {
      if (!hostKitAvailable()) return json(res, 404, { error: 'this copy of the Studio has no server kit (hostkit/)' });
      const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
      const deploy = hostDeploy();
      const host = localConfig.loadHost() || {};
      const ours = localConfig.hostAddresses(host);
      const needToken = () => json(res, 400, { error: 'paste your Cloudflare token first', code: 'notoken' });

      // A fixed Cloudflare page in the default browser: the sign-up page, the
      // pre-filled token page, the list of tokens.
      if (pathname === '/api/host-open') {
        const which = String(body.which || '');
        if (!Object.prototype.hasOwnProperty.call(HOST_LINKS, which)) return json(res, 400, { error: 'which must be signup, token or tokens' });
        const link = HOST_LINKS[which]();
        const [cmd, args] = urlOpenerFor(link);
        try { startDetached(cmd, args); }
        catch (e) { return json(res, 500, { error: String(e && e.message || e) }); }
        return json(res, 200, { ok: true, which, url: link });
      }

      // The pasted token: checked with Cloudflare, remembered only when it
      // works. With no token in the body, the remembered one is checked
      // again (the page does that to list the accounts after a restart).
      // What is checked, stored and compared is the token as deploy.js sends
      // it (cleanToken: no surrounding space, no "Bearer " in front), so a
      // paste Cloudflare accepts is one the Studio can keep.
      if (pathname === '/api/host-token') {
        const pasted = typeof body.token === 'string' && body.token.trim() !== '';
        const typed = pasted ? deploy.cleanToken(body.token) : '';
        const notToken = () => ({ ok: false, code: 'notatoken', why: deploy.explain('notatoken') });
        if (pasted && !typed) return json(res, 200, Object.assign(hostingState(), { check: notToken() }));
        const token = typed || host.token;
        if (!token) return needToken();
        let r = await deploy.accountsFor({ token, accountId: typeof body.accountId === 'string' ? body.accountId : '' }, hostDeps());
        if (r.ok && typed && typed !== host.token) {
          try { localConfig.saveHost({ token: typed }); } catch (e) { r = notToken(); }
        }
        return json(res, 200, Object.assign(hostingState(), { check: r }));
      }

      // The workers.dev name: what the account has, or whether a name is free.
      if (pathname === '/api/host-subdomain') {
        if (!host.token) return needToken();
        const r = await deploy.checkSubdomain({ token: host.token, accountId: String(body.accountId || host.accountId || ''), name: body.name }, hostDeps());
        return json(res, 200, r);
      }

      // Set up, or update: the steps stream back one JSON line each as they
      // happen (a new workers.dev name can take minutes to answer), then one
      // line with the result and the tab's new state.
      if (pathname === '/api/host-setup') {
        if (!host.token) return needToken();
        const replacing = hostReplacing(ours);
        if (replacing.length && body.confirmed !== true) return json(res, 409, { need: 'confirm', replacing });
        res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' });
        const line = (o) => { try { res.write(JSON.stringify(o) + '\n'); } catch (e) { /* the page went away */ } };
        let result;
        try {
          const scriptName = String(body.scriptName || '').trim() || host.worker || '';
          const r = await deploy.setupServers({
            token: host.token,
            accountId: String(body.accountId || host.accountId || ''),
            scriptName,
            subdomain: typeof body.subdomain === 'string' ? body.subdomain : '',
          }, hostDeps({ log: (ev) => line({ type: 'step', step: ev.step, text: ev.text }) }));
          if (r.ok) {
            // The admin key first, in a write of its own: Cloudflare returns
            // it from nowhere, and only a first install makes one, so a
            // record that failed to save would lose it for good. The account
            // name is Cloudflare's own text, cleaned to what the record
            // stores and dropped rather than failing the save.
            localConfig.saveHost(Object.assign({ accountId: r.accountId, worker: r.scriptName }, r.adminKey ? { adminKey: r.adminKey } : {}));
            const rest = { subdomain: r.subdomain, url: r.identityUrl, kitVersion: r.kitVersion || null, deployedAt: new Date().toISOString() };
            const name = typeof r.accountName === 'string' ? r.accountName.replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, 200).trim() : '';
            try { localConfig.saveHost(Object.assign({ accountName: name || null }, rest)); }
            catch (e) { if (e.field !== 'accountName') throw e; localConfig.saveHost(Object.assign({ accountName: null }, rest)); }
            const changed = useHostAddresses({ signalUrl: r.signalUrl, identityUrl: r.identityUrl });
            line({ type: 'step', step: 'save', text: !changed.length ? 'this computer and the ' + layout.ACTIVE_BUNDLE.name + ' bundle already used these servers'
              : changed.includes('onlineName') ? 'this computer and the ' + layout.ACTIVE_BUNDLE.name + ' bundle now use these servers, and the Online menu is on'
                : 'this computer and the ' + layout.ACTIVE_BUNDLE.name + ' bundle now use these servers' });
          } else if (r.adminKey) {
            // The upload went through and then a later step failed: the new
            // Worker holds this key, so keep it for the retry (an update).
            localConfig.saveHost({ worker: String(scriptName || deploy.DEFAULT_SCRIPT), adminKey: r.adminKey });
          }
          result = hostResultForPage(r);
        } catch (e) {
          const error = String(e && e.message || e);
          result = { ok: false, why: 'Unexpected error: ' + error };
        }
        line({ type: 'done', result, state: hostingState() });
        res.end();
        return;
      }

      // The Test buttons for the servers: each address dialed once.
      if (pathname === '/api/host-test') {
        if (!host.url) return json(res, 400, { error: 'your servers are not set up yet' });
        const r = await deploy.probeServers(ours, { windowMs: 1 }, { probe: hostProbe });
        return json(res, 200, { ok: r.ok, lobby: r.lobby, identity: r.identity });
      }

      // Point this install and the active bundle at the servers (another
      // bundle, or after an address was changed by hand).
      if (pathname === '/api/host-use') {
        if (!host.url) return json(res, 400, { error: 'your servers are not set up yet' });
        const replacing = hostReplacing(ours);
        if (replacing.length && body.confirmed !== true) return json(res, 409, { need: 'confirm', replacing });
        const changed = useHostAddresses(ours);
        return json(res, 200, Object.assign(hostingState(), { changed }));
      }

      // Forget the token: only this computer's copy. Cloudflare keeps it
      // working until it is deleted on its API Tokens page.
      if (pathname === '/api/host-forget') {
        if (host.token) localConfig.saveHost({ token: null });
        return json(res, 200, hostingState());
      }

      // A copy of every name and rating, from the servers' own backup route,
      // as a file the page saves.
      if (pathname === '/api/host-export') {
        if (!host.url || !host.adminKey) return json(res, 400, { error: 'this Studio has no admin key for these servers, so it cannot read their backup' });
        let r;
        try {
          // Never a redirect: a cross-origin one keeps a custom header like
          // this one, so the key would go wherever the answer pointed.
          r = await fetch(hostDial(ours.identityUrl) + '/admin/mugen/leaderboard/export', {
            headers: { 'x-admin-key': host.adminKey }, redirect: 'manual', signal: AbortSignal.timeout(30000),
          });
        } catch (e) {
          return json(res, 502, { error: e && e.cause && e.cause.code ? 'could not reach your servers (' + e.cause.code + ')' : 'could not reach your servers' });
        }
        const text = await r.text();
        if (r.status >= 300 && r.status < 400) {
          return json(res, 502, { error: 'your servers answered with a move to another address, and the Studio sends their admin key only to their own address' });
        }
        if (!r.ok) return json(res, 502, { error: r.status === 403 ? 'your servers answered ' + r.status + ' - they do not accept the admin key this Studio has' : 'your servers answered ' + r.status });
        const n = new Date();
        const day = n.getFullYear() + '-' + String(n.getMonth() + 1).padStart(2, '0') + '-' + String(n.getDate()).padStart(2, '0');
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
          'Content-Disposition': 'attachment; filename="' + (host.worker || 'servers') + '-leaderboard-' + day + '.json"',
        });
        res.end(text);
        return;
      }

      // Remove the servers: the Worker and, with it, every name and rating.
      // The server name typed back is the confirmation.
      if (pathname === '/api/host-remove') {
        if (!host.worker) return json(res, 400, { error: 'there are no servers to remove' });
        if (!host.token) return needToken();
        if (String(body.confirm || '').trim().toLowerCase() !== host.worker) {
          return json(res, 400, { error: 'type the server name, ' + host.worker + ', to confirm', code: 'confirm' });
        }
        const r = await deploy.removeServers({ token: host.token, accountId: host.accountId || '', scriptName: host.worker }, hostDeps());
        if (!r.ok && r.code !== 'notFound') return json(res, 200, Object.assign(hostingState(), { removed: false, why: r.why || 'Cloudflare refused', code: r.code }));
        // Named before the record goes: other bundles are never written, so
        // the page has to say which ones still point at the removed servers.
        const elsewhere = hostBundlesElsewhere(ours);
        dropHostAddresses(ours);
        localConfig.saveHost({ accountId: null, accountName: null, worker: null, subdomain: null, url: null, kitVersion: null, deployedAt: null, adminKey: null });
        return json(res, 200, Object.assign(hostingState(), { removed: true, alreadyGone: !r.ok, elsewhere }));
      }

      return json(res, 404, { error: 'unknown api route ' + pathname });
    }

    // PLAYERS (Settings > Online, under Leaderboard): list the names and the
    // board of the ACTIVE bundle's leaderboard address, and change them - a
    // new recovery code, a released name, a row removed or corrected, a reset
    // (a copy is saved first) or a copy. The address is read from the roster
    // here, never taken from the request, and this server makes every admin
    // call: the key (the host record's for the servers this Studio set up,
    // else one pasted into Test) never reaches the page. players.js has the
    // two kinds of server and the rules.
    if (pathname === '/api/players' && req.method === 'POST') {
      let players = null;
      try { players = require('./players.js'); } catch (e) { players = null; }
      if (!players) return json(res, 404, { error: 'this copy of the Studio has no Players panel' });
      const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
      const roster = vfslib.readRoster();
      const r = await players.run(body, {
        identityUrl: typeof roster.identityUrl === 'string' ? roster.identityUrl : '',
        dial: hostDial,
        fetch: globalThis.fetch,
        backupDir: leaderboardBackupDir(),
      });
      return json(res, r.status, r.body);
    }

    if (pathname === '/api/theme-remove' && req.method === 'POST') {
      const { folder } = JSON.parse((await readBody(req)).toString('utf8') || '{}');
      // removeTheme deletes recursively, so it refuses anything but one real
      // folder directly inside themes/ - a bad name, a missing folder, a file
      // or a link - and nothing is touched when it does.
      let result;
      try { result = modlib.removeTheme(folder); }
      catch (e) { return json(res, 400, { error: e.message }); }
      invalidateVfs();
      return json(res, 200, { ok: true, result });
    }

    // A SCREENPACK FROM ANOTHER BUNDLE (themecopy.js): the packs the other
    // bundles hold, and a copy of one into this bundle's themes/. The copy
    // refuses links and a drive without room, stages outside themes/, and
    // never writes the other bundle or either roster.
    if (pathname === '/api/theme-sources' && req.method === 'GET') {
      return json(res, 200, { sources: require('./themecopy.js').sources() });
    }
    if (pathname === '/api/theme-copy' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
      let result;
      try { result = require('./themecopy.js').copy({ bundle: body.bundle, folder: body.folder }); }
      catch (e) { return json(res, e.code && /^(bundle|folder|same|link|space)$/.test(e.code) ? 400 : 500, { error: e.message, code: e.code || null }); }
      invalidateVfs();
      return json(res, 200, { ok: true, result });
    }

    // Add (or revert) a 9000,20 lifebar portrait linked to the char's own.
    if (pathname === '/api/portrait' && req.method === 'POST') {
      const { folder, select, revert } = JSON.parse((await readBody(req)).toString('utf8') || '{}');
      // `select`: the entry's own .def (a variant sharing the folder); none = the folder's first entry.
      const result = revert ? modlib.revertPortrait(folder, { select }) : modlib.addPortrait(folder, { select });
      invalidateVfs();
      return json(res, 200, { ok: true, result });
    }

    // SFF v2 repair: re-key the body palette to 1,1 so palette selection applies.
    if (pathname === '/api/fix-palette-keys' && req.method === 'POST') {
      const { folder, select, revert } = JSON.parse((await readBody(req)).toString('utf8'));
      // `select`: the entry's own .def (a variant sharing the folder); none = the folder's first entry.
      // `false` is today's missing `force` (fixPalKeys checks !force).
      const result = revert ? modlib.revertPalKeys(folder, { select }) : modlib.fixPalKeys(folder, false, { select });
      invalidateVfs();
      return json(res, 200, { ok: true, result });
    }

    // Restore the RemapPal controller a character's own state 5900 discards.
    // Without it no color pick reaches the character in a match, and no
    // palette repair can compensate. Text-only; the sprite file is untouched.
    if (pathname === '/api/fix-pal-applier' && req.method === 'POST') {
      const { folder, def, revert } = JSON.parse((await readBody(req)).toString('utf8') || '{}');
      const result = revert ? modlib.revertPalApplier(folder, def) : modlib.fixPalApplier(folder, def);
      invalidateVfs();
      return json(res, 200, { ok: true, result });
    }

    // Supply a file the character references but does not ship (a character
    // lifted out of a fullgame). Body: folder, def, name, then the raw bytes.
    if (pathname === '/api/add-dependency' && req.method === 'POST') {
      const folder = decodeURIComponent(req.headers['x-folder'] || '');
      const def = decodeURIComponent(req.headers['x-def'] || '');
      const name = decodeURIComponent(req.headers['x-filename'] || '');
      if (!folder || !def || !name) throw new Error('x-folder, x-def and x-filename headers are required');
      const result = modlib.addDependency(folder, def, name, await readBody(req));
      invalidateVfs();
      return json(res, 200, { ok: true, result });
    }

    // Advanced: per-character size multiplier (patches [Size] xscale/yscale).
    if (pathname === '/api/char-scale' && req.method === 'POST') {
      const { folder, scale } = JSON.parse((await readBody(req)).toString('utf8') || '{}');
      const result = modlib.setCharScale(folder, scale);
      invalidateVfs();
      return json(res, 200, { ok: true, result });
    }

    // Advanced: per-character health and movement speed ([Data] life,
    // [Velocity] walk/run). Both patch from the values snapshotted when the
    // character was first edited, so repeated changes never compound.
    if (pathname === '/api/char-consts' && req.method === 'POST') {
      const { folder, life, speed } = JSON.parse((await readBody(req)).toString('utf8') || '{}');
      const result = modlib.setCharConsts(folder, life, speed);
      invalidateVfs();
      return json(res, 200, { ok: true, result });
    }

    // Advanced: the rest of the constants - attack, defence, the super/stun/
    // guard meters, the jump speeds, gravity and friction. One byte splice per
    // number, planned from the snapshot taken before the first write, so the
    // author's comments and the file's line endings survive and there is
    // always a way back. charstats.js carries the engine rules.
    if (pathname === '/api/char-stats' && req.method === 'GET') {
      const q = url.parse(req.url, true).query;
      return json(res, 200, { ok: true, stats: modlib.charStats(String(q.folder || '')) });
    }

    if (pathname === '/api/char-stats' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
      const result = modlib.setCharStats(body.folder, body.values);
      invalidateVfs();
      return json(res, 200, { ok: true, result, stats: modlib.charStats(body.folder) });
    }

    // Put health, speed, size and the rest of the constants back to what the
    // character shipped with.
    if (pathname === '/api/char-consts-reset' && req.method === 'POST') {
      const { folder } = JSON.parse((await readBody(req)).toString('utf8') || '{}');
      const result = modlib.resetCharConsts(folder);
      invalidateVfs();
      return json(res, 200, { ok: true, result });
    }

    // A DESKTOP BUILD IS A DIFFERENT PRODUCT FROM THE WEBSITE. The web export
    // ships our own wasm engine; this lays the same roster into the latest
    // OFFICIAL Ikemen GO, unmodified, and makes no claim to netplay or ranked -
    // those live only in the wasm build. See desktop.js.
    // The startup logo is content, not screenpack: adding is the folder drop
    // above (kind = 'logo'); this takes it back out. The next export of either
    // kind then uses the screenpack's own logo again.
    if (pathname === '/api/remove-logo' && req.method === 'POST') {
      return json(res, 200, { ok: true, logo: modlib.removeLogo() });
    }

    if (pathname === '/api/export-desktop' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
      const result = require('./desktop').exportDesktop({
        dest: exportDest(body.dest),
        // Overwriting is the default: a content manager is normally pointed at
        // one install and kept current. Turning it off dates each build.
        overwrite: body.overwrite !== false,
      });
      // The result card: the id for Open folder and Make .zip, and which
      // file starts the game.
      result.card = exportCardInfo(result.dest, 'desktop');
      result.card.exe = fs.existsSync(path.join(result.dest, 'Ikemen_GO.exe')) ? 'Ikemen_GO.exe' : '';
      // Play this export starts that file (/api/export-play): Windows only.
      result.card.play = !!result.card.exe && process.platform === 'win32';
      // The back of the booklet (exportnotes.js): each character's audit
      // breaks and what this export did to its copy, and the Studio's counts.
      try { result.notes = require('./exportnotes.js').forExport({ kind: 'desktop', roster: vfslib.readRoster(), charFixes: result.charFixes }); } catch (e) { result.notes = null; }
      return json(res, 200, { ok: true, result });
    }

    // THE EXPORT RESULT CARD'S BUTTONS. Each names an export by the id its
    // result carried (EXPORTS above), never by a path.
    //   /api/export-open {id, zip?}  the folder in Explorer, or with zip the
    //                                folder the zip was put in (beside it)
    //   /api/export-zip  {id}        the folder's contents as <folder>.zip
    //                                beside it (export.js zipFolderContents)
    if (pathname === '/api/export-open' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
      const ex = exportById(body.id);
      if (!ex) return json(res, 404, { error: 'That export is not known any more. Export again.' });
      const target = body.zip ? path.dirname(ex.dir) : ex.dir;
      if (!fs.existsSync(target)) return json(res, 404, { error: 'The folder is not there any more: ' + target });
      startDetached(FOLDER_OPENER, [target]);
      return json(res, 200, { ok: true, dir: target });
    }
    // PLAY THIS EXPORT (the back page's Play button), by id, never a path:
    //   /api/export-play {id, dryRun?}
    // A Desktop export: the Ikemen_GO.exe THIS export wrote, started in its
    // folder with no arguments - what /api/launch-build does for the engine
    // E-Select launches, and what double-clicking it does. Only a file that
    // is really inside that folder (a link leading out is refused), Windows
    // only. A Website export starts nothing here: the answer is its address
    // (/exported/<id>/, serveExported), which the page opens in a browser.
    // dryRun answers the command it would run and starts nothing: the tests
    // and the headless proofs use it, since a real Play opens a game window.
    if (pathname === '/api/export-play' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
      const ex = exportById(body.id);
      if (!ex) return json(res, 404, { error: 'That export is not known any more. Export again.' });
      const dry = body.dryRun === true;
      if (ex.kind === 'web') return json(res, 200, { ok: true, kind: 'web', url: '/exported/' + String(body.id) + '/', dryRun: dry });
      if (process.platform !== 'win32') return json(res, 400, { error: 'Playing a desktop build from here is Windows-only. Start Ikemen_GO.exe in its folder.' });
      const dir = ex.dir;
      const exe = path.join(dir, 'Ikemen_GO.exe');
      let real, realDir;
      try { real = fs.realpathSync.native(exe); realDir = fs.realpathSync.native(dir); }
      catch (e) { return json(res, 404, { error: 'Ikemen_GO.exe is not in the export folder any more: ' + dir }); }
      const fold = (p) => p.toLowerCase();
      if (path.dirname(fold(real)) !== fold(realDir) || !fs.statSync(real).isFile()) {
        return json(res, 400, { error: 'Ikemen_GO.exe in the export folder is not a program file the export wrote. Start it from its folder.' });
      }
      if (dry) return json(res, 200, { ok: true, kind: 'desktop', dryRun: true, cmd: exe, args: [], cwd: dir });
      let child;
      try { child = startDetached(exe, [], { cwd: dir }); }
      catch (e) { return json(res, 500, { error: String(e && e.message || e) }); }
      return json(res, 200, { ok: true, kind: 'desktop', cmd: exe, args: [], cwd: dir, pid: child && child.pid });
    }
    if (pathname === '/api/export-zip' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
      const ex = exportById(body.id);
      if (!ex) return json(res, 404, { error: 'That export is not known any more. Export again.' });
      if (zipsRunning.has(ex.dir)) return json(res, 409, { error: 'That zip is already being made.' });
      zipsRunning.add(ex.dir);
      try {
        const r = await require('./export').zipFolderContents(ex.dir);
        return json(res, 200, Object.assign({ ok: true }, r));
      } finally {
        zipsRunning.delete(ex.dir);
      }
    }

    if (pathname === '/api/export' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
      // Match the engine the Studio is running (V2 by default), pak by default
      // (the deployable itch/website format), and honor an optional public
      // (STUN-only, docs-bundled) build for sharing.
      const result = exportSite({
        pack: body.pack !== false,
        v2: !!process.env.IKEMEN_V2,
        public: !!body.public,
        // Where the build lands. exportSite has always taken this; nothing had
        // ever been able to ASK for a folder, so the parameter sat unused and
        // every build went to dist-pack-v2 beside the program. The native
        // window can ask now. Absolute only - a relative path here would
        // resolve against the server's cwd, which is not where the person
        // clicking the button is looking.
        dest: exportDest(body.dest),
      });
      // The result card: the id for Open folder, Play this export and Make
      // upload .zip, the folder's size, and whether this build carries a
      // leaderboard (a private build of a bundle that has one), which is when
      // the card says where names and ranked work.
      result.card = exportCardInfo(result.dest, 'web');
      // The build's own state files this engine refused (buildimport
      // checkOwnStates), for the card, as the desktop export says them.
      try { const bc = require('./buildimport.js').buildCommon(); result.commonReport = (bc && bc.report) || []; } catch (e) { result.commonReport = []; }
      if (!body.public) {
        let r = {};
        try { r = vfslib.readRoster(); } catch (e) { r = {}; }
        result.card.leaderboard = !!r.identityUrl;
      }
      // The back of the booklet, as for the desktop export (exportnotes.js),
      // over the roster the build was made from (a public build's cut).
      try {
        let r = result.builtRoster;
        if (!r) { try { r = vfslib.readRoster(); } catch (e) { r = {}; } }
        result.notes = require('./exportnotes.js').forExport({ kind: 'web', roster: r, charFixes: result.charFixes });
      } catch (e) { result.notes = null; }
      return json(res, 200, { ok: true, result });
    }

    json(res, 404, { error: 'unknown api route ' + pathname });
  } catch (e) {
    // A route that failed after its headers went out cannot answer again, and
    // trying threw from this catch - an unhandled rejection, which stopped the
    // server. explainError names roster.json when that is what is damaged.
    if (res.headersSent) { res.destroy(); return; }
    json(res, 400, { error: explainError(e) });
  }
}

// --- static plumbing ---------------------------------------------------------

const EXT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.def': 'text/plain; charset=utf-8',
  '.cns': 'text/plain; charset=utf-8',
  '.cmd': 'text/plain; charset=utf-8',
  '.air': 'text/plain; charset=utf-8',
  '.sff': 'application/octet-stream',
  '.snd': 'application/octet-stream',
  '.wasm': 'application/wasm',
  // The Studio's own favicon lives in public/icon/. Served as octet-stream a
  // browser will usually sniff it anyway, but a favicon is exactly the kind of
  // subresource that gets refused on a strict content-type, and it costs a line.
  '.png': 'image/png',
  '.webp': 'image/webp',
  // a leaderboard's background (public/ranking, leaderboardlook.js BG_TYPES)
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  // the booklet's bundled faces (public/fonts, booklet.css), and the Score
  // Ranking board's (public/ranking/leaderboard-fonts)
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
};

function contentTypeFor(filePath) {
  return EXT_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

// A FILE THAT CANNOT BE READ IS ONE REQUEST'S PROBLEM, NOT THE SERVER'S.
//
// An antivirus scan or a sync client holds a file open with no sharing
// (EBUSY), and a folder can refuse access (EPERM, EACCES). A read stream with
// no 'error' listener turns either into an uncaught exception, and that
// stopped the whole Studio: every click after it said "Failed to fetch". So a
// file is opened before any header goes out, and a failure answers the one
// request that asked, in words, with the file named.
const FILE_ERRORS = {
  EBUSY: [503, 'it is in use by another program (an antivirus scan or a sync client, for example). Try again in a moment'],
  EMFILE: [503, 'too many files are open at once. Try again in a moment'],
  EPERM: [403, 'Windows refused access to it'],
  EACCES: [403, 'Windows refused access to it'],
  // readonlyfs.js: a write into a build that is open read-only
  EROFS: [409, 'this build is open read-only'],
};
function fileErrorText(filePath, e) {
  const known = FILE_ERRORS[e && e.code];
  const why = known ? known[1] : String((e && e.message) || e);
  return e && e.code ? 'Could not open ' + filePath + ': ' + why + ' (' + e.code + ')' : 'Could not open ' + filePath + ': ' + why;
}

// Answers a request that failed, whatever state its response is in. Headers
// already on the wire cannot be taken back, so then the connection is cut: a
// second writeHead would throw from a callback, outside every try.
function failRequest(res, status, message) {
  if (res.headersSent) { res.destroy(); return; }
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(message);
}

// WHERE A JSON TEXT STOPS BEING JSON, as { line, column } (both from 1), or
// null when it parses. The parser's own message quotes a snippet of the text
// around the fault ("Unexpected token ',', ..."chars": [,") and only
// sometimes a position; a person with a text editor needs the line. A plain
// walk of the JSON grammar, run only on a text that has already failed.
function jsonFaultAt(text) {
  const s = String(text).replace(/^\uFEFF/, '');
  let i = 0;
  const ws = () => { while (i < s.length && (s[i] === ' ' || s[i] === '\t' || s[i] === '\n' || s[i] === '\r')) i++; };
  const fail = () => { throw { at: i }; };
  const str = () => {
    i++;
    while (i < s.length) {
      const c = s[i];
      if (c === '"') { i++; return; }
      if (c === '\\') { i += 2; continue; }
      if (c < ' ') fail();
      i++;
    }
    fail();
  };
  const value = (depth) => {
    if (depth > 500) fail();
    ws();
    const c = s[i];
    if (c === '{' || c === '[') {
      const close = c === '{' ? '}' : ']';
      i++; ws();
      if (s[i] === close) { i++; return; }
      for (;;) {
        if (c === '{') { ws(); if (s[i] !== '"') fail(); str(); ws(); if (s[i] !== ':') fail(); i++; }
        value(depth + 1); ws();
        if (s[i] === ',') { i++; continue; }
        if (s[i] === close) { i++; return; }
        fail();
      }
    }
    if (c === '"') return str();
    const m = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(s.slice(i, i + 64));
    if (m && m[0] !== '-') { i += m[0].length; return; }
    for (const w of ['true', 'false', 'null']) if (s.startsWith(w, i)) { i += w.length; return; }
    fail();
  };
  try { value(0); ws(); if (i < s.length) fail(); return null; } catch (x) {
    if (!x || typeof x.at !== 'number') throw x;
    const before = s.slice(0, x.at);
    const line = before.split('\n').length;
    return { line, column: x.at - before.lastIndexOf('\n') };
  }
}

// WHAT A FAILED REQUEST SAYS. A damaged roster.json surfaces as a bare
// SyntaxError from whichever reader reached it first, naming no file - a
// hand edit with one comma too many read as "Unexpected token". So a
// SyntaxError is checked against the roster, and when the roster is what does
// not parse, the answer says so, where in it (line and column: the parser's
// own message quoted a snippet that read as more damage), and where the
// file is - in that order, so the start of it, which is all the header
// shows, is already the useful part.
function explainError(e) {
  if (e instanceof SyntaxError) {
    try { vfslib.readRoster(); } catch (re) {
      if (re instanceof SyntaxError) {
        let at = null;
        try { at = jsonFaultAt(fs.readFileSync(vfslib.ROSTER_PATH, 'utf8')); } catch (x) { at = null; }
        return at ? 'roster.json is damaged at line ' + at.line + ', column ' + at.column
          + ': it is not valid JSON. Fix it in a text editor, or put back a copy from the backups folder'
          + ' beside it if there is one: ' + vfslib.ROSTER_PATH
          : 'roster.json is damaged: it is not valid JSON. Fix it in a text editor, or put back a copy from the backups folder'
          + ' beside it if there is one: ' + vfslib.ROSTER_PATH;
      }
    }
  }
  if (e && e.path && FILE_ERRORS[e.code] && e.syscall === 'open') return fileErrorText(e.path, e);
  return String((e && e.message) || e);
}

// `extra`: more response headers (the build's files are served sandboxed).
function serveFile(req, res, filePath, extra) {
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404);
      res.end('Not found: ' + filePath);
      return;
    }
    const range = req.headers.range;
    const type = contentTypeFor(filePath);
    // Not a byte range this understands (no match): the whole file, which is
    // what a server that ignores Range sends. match[1] on a null match threw
    // from this callback and stopped the server.
    const match = range ? /bytes=(\d*)-(\d*)/.exec(range) : null;
    let start = 0, end = stat.size - 1, head;
    if (match) {
      start = match[1] ? parseInt(match[1], 10) : 0;
      end = match[2] ? parseInt(match[2], 10) : stat.size - 1;
      if (isNaN(start)) start = 0;
      if (isNaN(end) || end >= stat.size) end = stat.size - 1;
      if (start > end || start >= stat.size) {
        res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
        res.end();
        return;
      }
      head = [206, {
        'Content-Type': type,
        'Content-Length': end - start + 1,
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-store',
      }];
    } else {
      head = [200, {
        'Content-Type': type,
        'Content-Length': stat.size,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-store',
      }];
    }
    fs.open(filePath, 'r', (openErr, fd) => {
      if (openErr) {
        const text = fileErrorText(filePath, openErr);
        console.error('  ' + text);
        failRequest(res, (FILE_ERRORS[openErr.code] || [500])[0], text);
        return;
      }
      // A player who left while the file was opening (a game tab closed after
      // an engine panic): pipeline() throws on a destroyed response, and the
      // throw would end the whole server.
      if (res.destroyed) { fs.close(fd, () => {}); return; }
      res.writeHead(head[0], Object.assign(head[1], extra || {}));
      // pipeline, not pipe: a read that fails halfway cuts this connection
      // instead of throwing, and a player who leaves mid-file has the file
      // closed (pipe() leaves its source open when the response ends early).
      const src = fs.createReadStream(null, match ? { fd, start, end } : { fd });
      try {
        pipeline(src, res, (e) => {
          if (e && e.code !== 'ERR_STREAM_PREMATURE_CLOSE') console.error('  Stopped sending ' + filePath + ': ' + e.message);
        });
      } catch (e) { src.destroy(); }
    });
  });
}

// LANGUAGE PACKS FROM THE LANGUAGES FOLDER (Options > Language).
//
// A pack a person drops into the languages folder (layout.LANGUAGES_DIR:
// Settings/languages/ in a portable copy) is offered beside the shipped ones
// without touching the program's files, and one with a shipped code
// (es-419.json) is used instead of the shipped pack, so a fix from the
// community needs no update. GET /lang/<code>.json reads the folder first,
// then public/lang/ as before. The code is i18n.js's own pattern (a language
// and up to two subtags): a name with a dot, a slash or anything else is 404,
// so no path is ever built from a request. A folder pack is used only when it
// parses and its "lang" is that code; one that does not is passed over (the
// shipped pack answers, or nothing does). An optional flag beside it,
// <code>.png or <code>.svg, is served as an image for the Options row's <img>
// - never inlined - and an SVG goes out sandboxed, so one opened on its own
// cannot run script on the Studio's origin. i18n.js checks every pack again
// as it reads it (its tags against the English), whichever folder it came from.
const I18N_RULES = require('./public/i18n.js');
function folderPack(code) {
  if (!I18N_RULES.CODE.test(code)) return null;
  let text, pack;
  try { text = fs.readFileSync(path.join(layout.LANGUAGES_DIR, code + '.json'), 'utf8').replace(/^\uFEFF/, ''); } catch (e) { return null; }
  try { pack = JSON.parse(text); } catch (e) { return null; }
  if (!pack || typeof pack !== 'object' || pack.lang !== code || !pack.strings || typeof pack.strings !== 'object' || Array.isArray(pack.strings)) return null;
  return { text, pack };
}
function folderFlag(code, only) {
  for (const ext of only ? [only] : ['png', 'svg']) {
    const file = path.join(layout.LANGUAGES_DIR, code + '.' + ext);
    try { if (fs.statSync(file).isFile()) return { file, url: '/lang/' + code + '.' + ext }; } catch (e) { /* not there */ }
  }
  return null;
}
// [{ code, name, english, source: 'built-in' | 'folder', flag: URL | null }]:
// the built-in three in their order, then the folder's new codes by code. A
// pack's own names are cut to 40 characters (a button shows one). An English
// pack is never asked for (i18n.js: English is no pack), so en.json is not one.
function langList() {
  const cut = (s) => String(s == null ? '' : s).trim().slice(0, 40);
  const out = new Map();
  for (const code of Object.keys(I18N_RULES.LANGS)) {
    let english = 'English';
    if (code !== 'en') {
      try { english = cut(JSON.parse(fs.readFileSync(path.join(PUBLIC_DIR, 'lang', code + '.json'), 'utf8').replace(/^\uFEFF/, '')).english); } catch (e) { english = ''; }
    }
    out.set(code, { code, name: I18N_RULES.LANGS[code].name, english, source: 'built-in', flag: null });
  }
  let names = [];
  try { names = fs.readdirSync(layout.LANGUAGES_DIR); } catch (e) { names = []; }
  for (const f of names.sort()) {
    const m = /^(.+)\.json$/i.exec(f);
    if (!m || m[1] === 'en') continue;
    const own = folderPack(m[1]);
    if (!own) continue;
    const was = out.get(m[1]);
    const flag = folderFlag(m[1]);
    out.set(m[1], { code: m[1], name: cut(own.pack.name) || (was ? was.name : m[1]), english: cut(own.pack.english) || (was ? was.english : ''),
      source: 'folder', flag: flag ? flag.url : null });
  }
  return [...out.values()];
}
// /lang/<code>.json and the flags. true when it answered; false leaves the
// request to the static files (the shipped packs, README.md, the glossaries).
function serveLang(req, res, pathname) {
  const m = /^\/lang\/([^/]+)\.(json|png|svg)$/.exec(pathname);
  if (!m) return false;
  const code = m[1], ext = m[2];
  if (!I18N_RULES.CODE.test(code)) { res.writeHead(404); res.end(); return true; }
  if (ext === 'json') {
    const own = folderPack(code);
    if (!own) return false;
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(own.text);
    return true;
  }
  const flag = folderFlag(code, ext);
  if (!flag) { res.writeHead(404); res.end(); return true; }
  serveFile(req, res, flag.file, ext === 'svg'
    ? { 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox", 'X-Content-Type-Options': 'nosniff' }
    : { 'X-Content-Type-Options': 'nosniff' });
  return true;
}

// API requests still being answered. A restart waits for these (see
// quitWhenIdle below): a request is where the Studio writes, and a write cut
// off halfway is a damaged roster or a half-copied character.
let apiInFlight = 0;

// ONE BAD REQUEST ANSWERS ITSELF, AND THE SERVER GOES ON. What routeRequest
// does outside the API runs synchronously in here: the web game's file list
// reads roster.json, a file URL is %-decoded, the build is assembled from
// every character's folder. A damaged roster.json, a malformed escape or a
// file another program holds used to throw straight out of this callback and
// stop the Studio. (The API has its own catch, in handleApi.)
const server = http.createServer((req, res) => {
  try {
    routeRequest(req, res);
  } catch (e) {
    const text = explainError(e);
    console.error('  ' + req.method + ' ' + req.url + ' failed: ' + text);
    failRequest(res, e instanceof URIError ? 400 : ((e && FILE_ERRORS[e.code]) || [500])[0], text);
  }
});

function routeRequest(req, res) {
  const parsed = url.parse(req.url);
  let pathname = parsed.pathname;

  if (pathname.startsWith('/api/')) {
    apiInFlight++;
    let counted = true;
    const done = () => { if (counted) { counted = false; apiInFlight--; } };
    res.on('finish', done);
    res.on('close', done);
    handleApi(req, res, pathname);
    return;
  }

  // The boot page uses relative URLs (./ikemen-fs/...) so the static export
  // works from any subfolder; in dev the page lives at /ikemen/, so accept
  // the prefixed form too.
  if (pathname.startsWith('/ikemen/ikemen-fs/')) pathname = pathname.slice('/ikemen'.length);
  if (pathname.startsWith('/ikemen-fs/')) {
    if (serveIkemenFs(req, res, pathname)) return;
  }
  if (pathname === '/ikemen/ikemen.wasm') {
    // IKEMEN_V2=1 serves the V2 engine build (web-upgrade branch).
    const wasmName = process.env.IKEMEN_V2 ? 'ikemen-v2.wasm' : 'ikemen.wasm';
    serveFile(req, res, path.join(vfslib.IKEMEN_SRC, 'bin', wasmName));
    return;
  }

  // The Score Ranking board looks for leaderboard-art/ beside itself, so its
  // preview in Settings > Online gets the active bundle's art folder here
  // (layout.LEADERBOARD_ART - for the checkout's Main, the site's own, the
  // portraits and win poses the live board shows). No folder = the board
  // draws its rows without art.
  if (pathname.startsWith('/ranking/leaderboard-art/')) {
    const ART = path.resolve(layout.LEADERBOARD_ART);
    let file = null;
    try { file = path.resolve(ART, decodeURIComponent(pathname.slice('/ranking/leaderboard-art/'.length))); } catch (e) { /* bad escape */ }
    if (file && file.startsWith(ART + path.sep) && /\.(png|json)$/i.test(file)) serveFile(req, res, file);
    else { res.writeHead(404); res.end(); }
    return;
  }

  // ...and leaderboard-ranks/ the same way: the rank icons the host gave
  // (layout.LEADERBOARD_RANKS). Only a name the look can hold - one file
  // directly in the folder, a PNG, a WebP or an SVG - and only while it is
  // really in there, not a link out of it. An SVG goes out under the same
  // policy as a language pack's flag: nothing in it runs or loads.
  if (pathname.startsWith('/ranking/leaderboard-ranks/')) {
    const L = require('./leaderboardlook');
    let name = '';
    try { name = decodeURIComponent(pathname.slice('/ranking/leaderboard-ranks/'.length)); } catch (e) { /* bad escape */ }
    const dir = path.resolve(layout.LEADERBOARD_RANKS);
    let inside = false;
    if (L.RANK_IMAGE_RE.test(name)) {
      try {
        const fold = (p) => (process.platform === 'win32' ? p.toLowerCase() : p);
        inside = path.dirname(fold(fs.realpathSync.native(path.join(dir, name)))) === fold(fs.realpathSync.native(dir));
      } catch (e) { inside = false; }
    }
    if (!inside) { res.writeHead(404); res.end(); return; }
    serveFile(req, res, path.join(dir, name), /\.svg$/.test(name)
      ? { 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox", 'X-Content-Type-Options': 'nosniff' }
      : { 'X-Content-Type-Options': 'nosniff' });
    return;
  }

  // ...and leaderboard-bg/: the page's background (layout.LEADERBOARD_BG),
  // by the same rules - a name the look can hold, really in the folder.
  // serveFile answers byte ranges, which a video needs to loop and seek.
  if (pathname.startsWith('/ranking/leaderboard-bg/')) {
    const L = require('./leaderboardlook');
    let name = '';
    try { name = decodeURIComponent(pathname.slice('/ranking/leaderboard-bg/'.length)); } catch (e) { /* bad escape */ }
    const dir = path.resolve(layout.LEADERBOARD_BG);
    let inside = false;
    if (L.BG_FILE_RE.test(name)) {
      try {
        const fold = (p) => (process.platform === 'win32' ? p.toLowerCase() : p);
        inside = path.dirname(fold(fs.realpathSync.native(path.join(dir, name)))) === fold(fs.realpathSync.native(dir));
      } catch (e) { inside = false; }
    }
    if (!inside) { res.writeHead(404); res.end(); return; }
    serveFile(req, res, path.join(dir, name), { 'X-Content-Type-Options': 'nosniff' });
    return;
  }

  // Play this export (the export result card): the folder an export just
  // wrote, read-only. See serveExported.
  if (pathname === '/exported' || pathname.startsWith('/exported/')) {
    serveExported(req, res, pathname);
    return;
  }

  // A language pack: the languages folder's first (serveLang).
  if (pathname.startsWith('/lang/') && serveLang(req, res, pathname)) return;

  if (pathname === '/') pathname = '/studio.html';
  const staticPath = path.join(PUBLIC_DIR, path.normalize(pathname).replace(/^(\.\.[/\\])+/, ''));
  if (staticPath.startsWith(PUBLIC_DIR)) {
    // THE AUTHOR'S OWN ENDPOINTS, FILLED IN ON THE WAY OUT.
    //
    // public/ikemen/webrtc.js ships BLANK now - its TURN and lobby constants
    // live in local-config.json, outside every source file (see
    // local-config.js). This is a raw static server, so without this the
    // Studio's own TEST IN BROWSER would load the blank file and quietly lose
    // the lobby and the TURN relay on the one machine that is supposed to have
    // them.
    //
    // Nothing leaves this process: the server is bound to 127.0.0.1 and this is
    // the author's machine. Every path that DELIVERS webrtc.js fills it - this
    // one and the private branch of export.js - and every path that
    // redistributes leaves it blank.
    if (/[/\\]ikemen[/\\]webrtc\.js$/i.test(staticPath)) {
      const cfg = localConfig.load();
      if (localConfig.has(cfg)) {
        let body;
        try { body = fs.readFileSync(staticPath, 'utf8'); } catch (e) { body = null; }
        if (body !== null) {
          const r = localConfig.fillPrivateValues(body, cfg);
          res.writeHead(200, {
            'Content-Type': 'application/javascript; charset=utf-8',
            'Cache-Control': 'no-store',
          });
          res.end(r.text);
          return;
        }
      }
    }
    serveFile(req, res, staticPath);
    return;
  }

  res.writeHead(404);
  res.end('Not found');
}

// Last numeric CLI arg overrides the port (the --v2 server runs on 8937
// alongside the stable one on 8934).
const portArg = process.argv.slice(2).find((a) => /^\d+$/.test(a));
const PORT = portArg ? parseInt(portArg, 10) : 8934;
// LOOPBACK ONLY. listen(PORT) with no host binds every interface, so the
// Studio was reachable from anything on the network - and its API takes an
// absolute path straight from the request body and copies whole trees with it.
// That was defensible for a dev server someone starts by hand and indefensible
// the moment this became a program you double-click.
//
// 127.0.0.1 rather than 'localhost': the name can resolve to ::1 first, and
// binding by name would pick one family and quietly refuse the other.
server.listen(PORT, '127.0.0.1', () => {
  console.log(`Ikemen web dev server:`);
  console.log(`  Mod Studio: http://localhost:${PORT}/studio.html`);
  console.log(`  Play:       http://localhost:${PORT}/ikemen/index.html`);
  // The startup check: one line when the engine zip is fine, the warnings when
  // it is not. Never fatal - the web build does not need the zip at all.
  try {
    const h = require('./enginezip.js').health({ deps: layout.DEPS, exportDir: layout.DESKTOP_EXPORT });
    if (h.picked) console.log('  Engine zip: ' + h.picked + (h.ok ? '' : ' (NOT USABLE)'));
    for (const w of h.warnings) if (w.level !== 'info') console.log('  engine zip ' + w.level + ': ' + w.text);
  } catch (e) { console.log('  engine zip check failed: ' + e.message); }
  // THE H-MUGEN MODULE'S ONE-TIME MIGRATION (hmodule.js): a roster with no
  // answer yet - one from before the module - is given its answer once, the
  // first time its bundle opens: 'on' where its scan already makes a gallery
  // pair in a bundle of the Studio's own (Main, as it was), else 'unasked'.
  // Decided live forever instead, a bundle that later gained a false pair
  // would switch itself on with nobody asked. After the listen line, so the
  // page's first read is never kept waiting; until it lands, hmodule answers
  // the same thing live.
  setImmediate(() => {
    try {
      const r = vfslib.readRoster();
      if (r && r.hModule === undefined) {
        r.hModule = require('./hmodule.js').moduleState(r) === 'on' ? 'on' : 'unasked';
        vfslib.writeRoster(r);
        invalidateVfs();
        console.log('  H-MUGEN module: no answer on record - ' + r.hModule + (r.hModule === 'on' ? ' (its roster already pairs a giver and a receiver)' : ''));
      }
    } catch (e) { console.log('  H-MUGEN module migration skipped: ' + e.message); }
  });
});

// THE DESKTOP WINDOW CAN RESTART THIS SERVER, and a restart is how a bundle
// switch takes effect without closing the Studio: every folder is resolved once
// at start (layout.js, and the modules that keep paths from it), so the one
// way to edit another bundle is a new server process. The window starts this
// one with --exit-on-stdin-close and holds its stdin; closing it is the
// request to go. So is the window dying, which is the other thing it is for:
// a crashed window used to leave this process behind, holding the port.
//
// Going means: stop taking connections, let the API requests already in
// flight finish, then exit. Fifteen seconds at most - the window kills what is
// still here after twenty, and waiting on an answer nobody will read serves
// nothing. A server started by hand (npm start, node server.js) never reads
// stdin and runs as it always has.
function quitWhenIdle() {
  server.close();
  const t0 = Date.now();
  (function wait() {
    if (apiInFlight <= 0 || Date.now() - t0 > 15000) process.exit(0);
    setTimeout(wait, 50);
  })();
}
if (process.argv.includes('--exit-on-stdin-close')) {
  process.stdin.on('end', quitWhenIdle);
  process.stdin.on('error', quitWhenIdle);
  process.stdin.resume();
}

// server: for the .exe's entry (scripts/sea-entry.cjs), which stops the
// program on an uncaught error only until this is listening.
//
// FOR TESTS ONLY (tools/test-eselect-server.js): the route handler, the Origin
// rule, and the launcher whose spawn a test replaces so that nothing is ever
// started. Requiring this file still starts the server, as it always has.
// readOnly: the 409 table as [route, what] pairs and the allowed list
// (tools/test-readonly-build.js walks every route in it).
module.exports = { server, _test: { handleApi, launcher, ownOrigin, DESKTOP_ACTION_ROUTES,
  readOnly: { refused: [...READ_ONLY_REFUSED], allowed: [...READ_ONLY_ALLOWED] } } };
