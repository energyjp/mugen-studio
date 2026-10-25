'use strict';
//
// WHERE THINGS ARE, IN ONE PLACE.
//
// Until now every file resolved its own folders with `path.join(ROOT, 'cache')`
// - forty-five sites across vfslib, modlib, desktop, export and two tools - so
// the program, the user's content, the engine bundles and the build outputs
// could only ever live in one flat pile beside server.js. That is why a copy
// handed to a tester had twenty items at its top level and a desktop export
// that landed inside the program folder.
//
// This module is the only file that knows the layout. Every other file asks
// it. With no studio-layout.json beside it the defaults reproduce the repo
// exactly - everything beside the program - so a checkout behaves as it always
// has. A portable copy ships app/program-layout.json and the same code reads
// and writes a layout a person can understand:
//
//   Mugen Manager/
//     app/                 this file and its siblings, plus app/Dependencies/
//       Dependencies/      release/  release-v2/  ikemen-go-src/  Ikemen_GO-*.zip
//       starter/           the content a new copy starts with (below)
//     Content/             made on the first start - never in the zip
//       default/           characters/  stages/  music/  themes/  roster.json
//     Settings/            made on the first start - never in the zip (below)
//     Desktop Export/      the Desktop export lands here unless a folder is chosen
//     Website Export/      the Website export lands here unless a folder is chosen
//     MugenStudio.exe
//     READ ME.txt
//
// Content is a folder of BUNDLES. `bundle` names the active one; a second set
// of characters, stages, music, themes and roster is another folder beside
// `default`, and switching is one key. Nothing else in the program knows the
// word "bundle" - it asks dir('cache') and gets the active bundle's characters.
//
// The layout file, every key optional, paths relative to this folder:
//   {
//     "contentRoot":   "../Content",          folder of bundles
//     "bundle":        "default",             the active one (default: "default")
//     "content":       "...",                 OR a direct path to one bundle
//     "folders":       { "cache": "characters" },   physical names for logical ones
//     "dependencies":  "./Dependencies",
//     "desktopExport": "../Desktop Export",
//     "websiteExport": "../Website Export",
//     "settings":      "../Settings",         the user's own files (below)
//     "starter":       "./starter"            what Content/default starts as
//   }
//
// LOGICAL vs PHYSICAL NAMES. Code says dir('cache') because forty-five sites,
// the API, and every doc say "cache"; the repo's folder is cache/ and its
// characters/ folder holds the source zips, so the repo cannot rename in place.
// A portable copy has no such collision and calls the folder what it is:
// `"folders": { "cache": "characters" }`. folderName('cache') gives the UI the
// name to show.
//
// THE PROGRAM'S FILES AND THE USER'S FILES ARE KEPT APART, so a new version
// can be extracted over an old one. A portable copy is updated by unzipping
// the next one over it, and an unzip replaces every file the zip holds before
// any code of ours runs. Until the Settings folder, the zip held
// Content/default/roster.json and app/studio-layout.json, so an update put
// the build back to Kung Fu Man alone (the characters stayed on disk and
// dropped out of it) and forgot the active bundle and the download folder;
// and the host's Cloudflare token and admin key lived in app/local-config.json,
// in the folder an update replaces. Now:
//
//   - The PROGRAM's layout is app/program-layout.json, shipped with every
//     version and never written by the program. It is a new name on purpose:
//     a zip that shipped app/studio-layout.json would overwrite an old copy's,
//     and the choices in it would be gone before they could be moved.
//   - Everything the USER owns lives in Settings/ beside app/ (the "settings"
//     key): local-config.json (the relay and TURN addresses, the Cloudflare
//     token and admin key, the Players panel's keys), studio-settings.json
//     (USER_KEYS: the active bundle and the download folder) and logs/ (the
//     window writes the server's log there - studio-go serverlog.go reads the
//     same key). No zip and no build ever holds it.
//   - The starter content ships in app/starter/, and Content/default is made
//     from it only when Content/default/roster.json does not exist, so an
//     update never touches a user's roster or characters.
//   - On the first start of a new version over an old copy, whatever the old
//     copy kept in app/ moves into Settings/ (settleUserFiles), and it is said
//     once: in the server's log and on the Studio page (STARTUP_NOTES).
//
// A layout file with no "settings" key - the checkout, with or without its
// studio-layout.json, an older portable copy, and every test layout - keeps
// the old arrangement exactly: one file holds every key, local-config.json
// sits beside the program, and nothing is moved or made at load.

const fs = require('fs');
const path = require('path');

const APP = __dirname;

// MUGEN_STUDIO_LAYOUT points at another layout file - for tests only, so a
// test can build a layout in a temp folder without touching this one. Then
// app/program-layout.json (a portable copy since the Settings folder), then
// studio-layout.json (the checkout, and a copy from before it).
const PROGRAM_LAYOUT_FILE = path.join(APP, 'program-layout.json');
const LAYOUT_FILE = process.env.MUGEN_STUDIO_LAYOUT
  ? path.resolve(process.env.MUGEN_STUDIO_LAYOUT)
  : (fs.existsSync(PROGRAM_LAYOUT_FILE) ? PROGRAM_LAYOUT_FILE : path.join(APP, 'studio-layout.json'));

// READING A FILE ANOTHER PROGRAM MAY BE HOLDING. An antivirus scan or a sync
// client opens a file with no sharing for a moment, and a file written with
// writeFileSync can be caught half way; a few tries 200 ms apart ride over
// both. -> { value } | { missing: true } | { error }. A byte-order mark in
// front is not damage (Notepad's "UTF-8 with BOM" writes one).
const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
function readJson(file, tries) {
  let last = null;
  for (let i = 0; i < (tries || 1); i++) {
    if (i) pause(200);
    let text;
    try { text = fs.readFileSync(file, 'utf8'); } catch (e) {
      if (e.code === 'ENOENT') return { missing: true };
      last = e;
      continue;
    }
    try { return { value: JSON.parse(text.replace(/^\uFEFF/, '')) }; } catch (e) { last = e; }
  }
  return { error: last };
}
const isObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const reasonOf = (e) => (e instanceof SyntaxError ? 'it is not valid JSON: ' + e.message : (e && (e.code || e.message)) || String(e));

// A LAYOUT FILE THAT IS THERE BUT CANNOT BE READ STOPS THE START. Reading it
// as {} used to put the Studio on the checkout's layout: a portable copy
// whose app/program-layout.json an antivirus scan held at launch looked for
// the build in app/, answered every request with app/roster.json not found,
// and stayed that way after the file was let go, until a restart - and a key
// saved meanwhile went to app/local-config.json, the folder an update
// replaces. A missing file is still the normal case (the checkout without
// studio-layout.json). The message is for a person: the window shows the
// end of the server's output, so it is the whole of what is printed.
function layoutUnreadable(file, e) {
  const program = path.resolve(file) === path.resolve(PROGRAM_LAYOUT_FILE);
  const fix = e instanceof SyntaxError || !(e instanceof Error)
    ? (program ? 'It is part of the program: extract app\\program-layout.json from the Mugen Studio zip again.'
      : 'Fix it in a text editor, or delete it to go back to the folders beside the program.')
    : 'Another program may be holding it (an antivirus scan or a sync client, for example) - close Mugen Studio and start it again.';
  const err = new Error('Could not read ' + file + ' (' + (e instanceof Error ? reasonOf(e) : 'it is not a JSON object') + '). ' + fix);
  err.stack = err.message;
  return err;
}
let cfg = {};
{
  const r = readJson(LAYOUT_FILE, 5);
  if (r.error) throw layoutUnreadable(LAYOUT_FILE, r.error);
  if (!r.missing) {
    if (!isObject(r.value)) throw layoutUnreadable(LAYOUT_FILE, null);
    cfg = r.value;
  }
}

const at = (v, fallback) => path.resolve(APP, String(v || fallback));

// ---- the user's own files ---------------------------------------------------
//
// SETTINGS_DIR is '' without a "settings" key, and then every path below is
// what it always was: the user's choices in LAYOUT_FILE itself,
// local-config.json and logs/ beside the program.
const PROGRAM = cfg;
const SETTINGS_DIR = typeof PROGRAM.settings === 'string' && PROGRAM.settings ? at(PROGRAM.settings) : '';
// The keys a PERSON sets (the bundle switcher, Options > Downloads). In
// Settings mode only these are read from studio-settings.json: the rest of the
// layout is the program's, so a stale folder key can never outlive the version
// that wrote it.
const USER_KEYS = ['bundle', 'downloadFolder'];
const USER_FILE = SETTINGS_DIR ? path.join(SETTINGS_DIR, 'studio-settings.json') : LAYOUT_FILE;
const LOCAL_CONFIG_FILE = path.join(SETTINGS_DIR || APP, 'local-config.json');
const LOGS_DIR = path.join(SETTINGS_DIR || APP, 'logs');
const STARTER_DIR = SETTINGS_DIR && PROGRAM.starter ? at(PROGRAM.starter) : '';
// Where an older copy kept the user's files: the program folder. In a test
// that is the folder of its own layout file, never this checkout.
const OLD_APP = path.dirname(LAYOUT_FILE);

// What this start did to the user's files, for the log and the page. Filled
// only on a start that moved or made something, so it is said once.
const STARTUP_NOTES = [];
const note = (kind, text) => {
  STARTUP_NOTES.push({ kind, text, at: new Date().toISOString() });
  console.log('Settings: ' + text);
};

const pickUser = (o) => {
  const out = {};
  if (o && typeof o === 'object' && !Array.isArray(o)) for (const k of USER_KEYS) if (k in o) out[k] = o[k];
  return out;
};
const sameBytes = (a, b) => { try { return fs.readFileSync(a).equals(fs.readFileSync(b)); } catch (e) { return false; } };
// Whole file, then one rename, like local-config.js writeWhole: a reader that
// races it sees the old file or the new one, never half of one.
function writeJsonWhole(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n');
  fs.renameSync(tmp, file);
}
// unlinkSync and a check, never rmSync (see writeLayoutKeys below).
function unlinkChecked(file) {
  try { fs.unlinkSync(file); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  if (fs.existsSync(file)) throw new Error('could not delete ' + file);
}
// A move that cannot lose the file: a rename (the two folders are siblings, so
// one volume), else a copy that is read back before the original goes.
function moveFile(from, to) {
  try { fs.renameSync(from, to); return; } catch (e) { /* a copy instead */ }
  fs.copyFileSync(from, to);
  if (!sameBytes(from, to)) throw new Error('the copy of ' + from + ' did not read back the same');
  unlinkChecked(from);
}
// A free name in Settings/ for a file set aside: name, name-2, name-3 ...
function freeName(base, ext) {
  for (let i = 1; ; i++) {
    const p = path.join(SETTINGS_DIR, base + (i === 1 ? '' : '-' + i) + ext);
    if (!fs.existsSync(p)) return p;
  }
}

// Moves what an older copy kept in app/ into Settings/, and makes
// Content/default from the starter when it has no roster. Runs at load, before
// anything reads a folder, and never throws: a failure is a note, and the
// Studio starts as best it can (a read-only folder cannot hold a Settings
// folder either way).
function settleUserFiles() {
  try { fs.mkdirSync(SETTINGS_DIR, { recursive: true }); } catch (e) {
    note('error', 'could not make the Settings folder ' + SETTINGS_DIR + ' (' + e.message + ')');
    return;
  }
  const rel = (p) => path.relative(path.dirname(SETTINGS_DIR), p);

  // local-config.json: the keys. Never lost - when Settings/ already has one
  // and app/ holds a different one (an older version was run again), the
  // app/ one is set aside in Settings/ under its own name, and the one in use
  // stays the one in use.
  try {
    const old = path.join(OLD_APP, 'local-config.json');
    const now = LOCAL_CONFIG_FILE;
    if (path.resolve(old) !== path.resolve(now) && fs.existsSync(old)) {
      if (!fs.existsSync(now)) {
        moveFile(old, now);
        note('moved', 'moved your online settings and keys (local-config.json) from ' + rel(old) + ' to ' + rel(now));
      } else if (sameBytes(old, now)) {
        unlinkChecked(old);
        note('moved', 'removed a second copy of local-config.json from ' + rel(old) + ' (the same as ' + rel(now) + ')');
      } else {
        const aside = freeName('local-config.from-app', '.json');
        moveFile(old, aside);
        note('moved', 'found an older local-config.json in ' + rel(old) + ' and kept it as ' + rel(aside)
          + '; ' + rel(now) + ' is still the one in use');
      }
    }
  } catch (e) {
    note('error', 'could not move local-config.json into ' + rel(SETTINGS_DIR) + ' (' + e.message + ')');
  }

  // The active bundle and the download folder, from an older copy's
  // app/studio-layout.json. Its other keys described that version's folders,
  // which program-layout.json now does, so the file goes once its choices are
  // kept. One that does not parse is set aside whole, never deleted.
  try {
    const old = path.join(OLD_APP, 'studio-layout.json');
    if (!fs.existsSync(USER_FILE) && path.resolve(old) !== path.resolve(LAYOUT_FILE) && fs.existsSync(old)) {
      let raw = null;
      try { raw = JSON.parse(fs.readFileSync(old, 'utf8')); } catch (e) { raw = null; }
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        const keep = pickUser(raw);
        writeJsonWhole(USER_FILE, keep);
        unlinkChecked(old);
        const what = Object.keys(keep).map((k) => k === 'bundle' ? 'the active bundle (' + keep[k] + ')' : 'the download folder').join(' and ');
        if (what) note('moved', 'moved ' + what + ' from ' + rel(old) + ' to ' + rel(USER_FILE));
        else note('tidy', 'removed ' + rel(old) + ', which held no choice of yours');
      } else {
        const aside = freeName('studio-layout.from-app', '.json');
        moveFile(old, aside);
        note('moved', rel(old) + ' could not be read, so it was kept as ' + rel(aside) + ' - the bundle and download folder start at their defaults');
      }
    }
  } catch (e) {
    note('error', 'could not move the bundle and download folder choices into ' + rel(SETTINGS_DIR) + ' (' + e.message + ')');
  }

  // Content/default from the starter, only when it has no roster. Existing
  // files are never overwritten, and the roster goes last, so a start that
  // stops half way is finished by the next one.
  if (STARTER_DIR && PROGRAM.contentRoot) {
    const target = path.join(at(PROGRAM.contentRoot), 'default');
    const roster = path.join(target, 'roster.json');
    const from = path.join(STARTER_DIR, 'roster.json');
    try {
      if (!fs.existsSync(roster) && fs.existsSync(from)) {
        fs.mkdirSync(target, { recursive: true });
        fs.cpSync(STARTER_DIR, target, { recursive: true, force: false, errorOnExist: false,
          filter: (src) => path.resolve(src) !== path.resolve(from) });
        const names = Object.assign({}, PROGRAM.folders || {});
        for (const d of [names.cache || 'cache', 'stages', 'music', 'themes']) fs.mkdirSync(path.join(target, d), { recursive: true });
        const tmp = roster + '.tmp';
        fs.copyFileSync(from, tmp);
        fs.renameSync(tmp, roster);
        note('starter', 'made ' + rel(target) + ' from the starter in ' + rel(STARTER_DIR));
      }
    } catch (e) {
      note('error', 'could not make ' + rel(target) + ' from the starter (' + e.message + ')');
    }
  }
}

if (SETTINGS_DIR) {
  settleUserFiles();
  // The user's choices over the program's layout, and only those. One that
  // cannot be read leaves both at their defaults - and is SAID, in the log
  // and on the page, never silently: the bundle switch and the download
  // folder then refuse to write over it (readUserFile).
  let user = {};
  const r = readJson(USER_FILE, 5);
  if (r.error || (!r.missing && !isObject(r.value))) {
    note('error', path.relative(path.dirname(SETTINGS_DIR), USER_FILE) + ' could not be read ('
      + (r.error ? reasonOf(r.error) : 'it is not a JSON object') + ') - the bundle and the download folder are at their'
      + ' defaults until it is fixed in a text editor or deleted');
  } else if (!r.missing) user = r.value;
  cfg = Object.assign({}, PROGRAM, pickUser(user));
}

// The user's things: characters, stages, music, screenpacks, and the roster
// that says which of them are in the build.
const BUNDLE = String(cfg.bundle || 'default');
const CONTENT_ROOT = cfg.content ? path.dirname(at(cfg.content)) : at(cfg.contentRoot, '.');
const CONTENT = cfg.content ? at(cfg.content)
  : (cfg.contentRoot ? path.join(CONTENT_ROOT, BUNDLE) : APP);

// The engine's things: the two release bundles, the engine source subset the
// web build reads, and the official zip the desktop export unpacks.
const DEPS = at(cfg.dependencies, '.');

// WHICH BUNDLE THIS IS. "Main" is the content the program started with: in a
// checkout, the folders beside the program (no `content`, no `contentRoot`);
// in a portable copy, the `default` bundle. Anything else is a named bundle -
// in a checkout a folder under Content/ reached through `content`, in a
// portable copy a sibling of `default` reached through `bundle`.
const ACTIVE_BUNDLE = (() => {
  if (cfg.content) {
    const main = path.resolve(CONTENT) === path.resolve(APP);
    return { name: main ? 'Main' : path.basename(CONTENT), main, mode: cfg.contentRoot ? 'portable' : 'checkout' };
  }
  if (cfg.contentRoot) return { name: BUNDLE, main: BUNDLE === 'default', mode: 'portable' };
  return { name: 'Main', main: true, mode: 'checkout' };
})();
// EACH BUNDLE EXPORTS TO ITS OWN FOLDERS, so switching never overwrites
// another bundle's build. Main keeps the names it always had; a bundle adds
// its name: dist-desktop-<name>, dist-pack-v2-<name>(-public).
const bundleSlug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'bundle';
const EXPORT_SUFFIX = ACTIVE_BUNDLE.main ? '' : '-' + bundleSlug(ACTIVE_BUNDLE.name);

// Build outputs. The repo default keeps the old names beside the program.
const DESKTOP_EXPORT = at(cfg.desktopExport, 'dist-desktop') + EXPORT_SUFFIX;
const WEBSITE_EXPORT = at(cfg.websiteExport, '.');

// THE LEADERBOARD'S CHARACTER ART: the portraits and win poses the Score
// Ranking board draws (tools/extract-charart.js writes them, a manifest.json
// and a folder per character). They are made from a bundle's own characters,
// so they live WITH THE BUNDLE, in <bundle>/leaderboard-art/ - not beside the
// program (a second bundle has other characters, and the program folder holds
// only the program) and not in the Website Export folder (a Website export
// empties its folder every time, so the art would be made from nothing on
// every export). The Website export copies it beside leaderboard.html.
//
// The one exception is the checkout's Main: its art has always been the
// private site's own folder beside the program folder, which the site serves
// from its root, and it stays exactly there.
const MAIN_CHECKOUT_ART = path.resolve(APP, '..', 'leaderboard-art');
const LEADERBOARD_ART = ACTIVE_BUNDLE.main && ACTIVE_BUNDLE.mode === 'checkout'
  ? MAIN_CHECKOUT_ART : path.join(CONTENT, 'leaderboard-art');

// Whether `dir` is SOME OTHER bundle's leaderboard art: the checkout Main's
// folder beside the program, or leaderboard-art/ inside any bundle folder that
// is not the active one. The extractor refuses those, because it rebuilds the
// manifest from the ACTIVE bundle's roster - which is how a test's
// one-character bundle once left the site's board knowing only Kung Fu Man.
function isOtherBundleArt(dir) {
  const norm = (p) => { const r = path.resolve(p); return process.platform === 'win32' ? r.toLowerCase() : r; };
  const d = norm(dir);
  if (d === norm(LEADERBOARD_ART)) return false;
  if (d === norm(MAIN_CHECKOUT_ART)) return true;
  if (path.basename(d) !== 'leaderboard-art') return false;
  const holder = norm(path.dirname(path.dirname(d)));
  return holder === norm(CONTENT_ROOT) || holder === norm(path.join(APP, 'Content'));
}

// WHERE THE BROWSER PUTS A DOWNLOAD (the animation panel's GIF button).
//
// The odd one out, and deliberately: every other location above has a default,
// because something has to be there. This one's default is NOTHING - empty
// means "leave it to Windows", which is the behavior everyone already has and
// the right answer for anyone who never opens the setting.
//
// It is also a key a USER writes (USER_KEYS), so in a portable copy it lives
// in Settings/studio-settings.json, which no update replaces; in the checkout
// it is in studio-layout.json as it always was.
const downloadFolder = () => (cfg.downloadFolder ? at(cfg.downloadFolder, '.') : '');

// Writes one key back, keeping everything else in the file byte-for-byte in
// meaning - including keys a future version adds. Pass '' to clear it.
function setDownloadFolder(value) {
  const file = USER_FILE;
  // No file is the repo's normal state; a CORRUPT file is not, and starting
  // over would silently relocate every folder this app uses - readUserFile
  // refuses it, naming the file.
  const raw = readUserFile();
  if (value) raw.downloadFolder = String(value);
  else delete raw.downloadFolder;
  if (SETTINGS_DIR) writeJsonWhole(file, raw);
  else fs.writeFileSync(file, JSON.stringify(raw, null, 2) + '\n');
  if (value) cfg.downloadFolder = String(value);
  else delete cfg.downloadFolder;
  return value ? path.resolve(APP, String(value)) : '';
}

// A SIBLING of the program folder in the repo, INSIDE Dependencies/ in a
// portable copy. The repo sibling is checked first so a checkout keeps
// behaving exactly as it always has.
const IKEMEN_SRC = [
  path.join(APP, '..', 'ikemen-go-src'),
  path.join(DEPS, 'ikemen-go-src'),
  path.join(APP, 'ikemen-go-src'),
].find((p) => fs.existsSync(p)) || path.join(DEPS, 'ikemen-go-src');

const FOLDERS = Object.assign({}, cfg.folders || {});
const folderName = (name) => String(FOLDERS[name] || name);

// AN EXTERNAL BUILD, OPENED WHERE IT IS (bundles.openExternal). Somebody's
// MUGEN or Ikemen GO install - forty-seven gigabytes of it, on the owner's -
// is inspected and played without being copied: its bundle folder holds
// external.json, naming the build's folder, and a roster.json made from the
// build's own select.def, and the build's chars/, stages/, sound/ and data/
// ARE that bundle's characters, stages, music and screenpacks. Every reader
// asks dir('cache') and gets <root>/chars, so nothing else in the program
// needs to know.
//
// ONLY THE CONTENT FOLDERS POINT INTO IT. What the Studio keeps per bundle -
// the roster, portraits, palettes, lifebars, the logo, the engine overrides,
// mods, backups, the leaderboard art - stays in the bundle folder, because
// those are the Studio's own files and the build is not the Studio's to write.
//
// AND IT IS READ-ONLY, always, in this version: the build is somebody's game.
// server.js installs readonlyfs.js when `readOnly` is true, so a write that
// reaches into the build fails with EROFS whatever code asked for it, and
// every route that changes content answers 409 before it gets that far.
//
// A record that is there but cannot be read is still read-only - with no root
// to point at, the folders stay in the bundle folder, and the start says why
// (STARTUP_NOTES), never silently. So does a build that is not there today (a
// drive not plugged in): the bundle opens empty rather than not at all, so
// the bundle switch is still there to leave it.
//
// Never Main: openExternal makes a named bundle (Main and default are
// reserved names), and the checkout's Main is the program folder itself.
const EXTERNAL_FILE = path.join(CONTENT, 'external.json');
const EXTERNAL_FOLDERS = { cache: 'chars', stages: 'stages', music: 'sound', themes: 'data' };
const EXTERNAL = (() => {
  if (ACTIVE_BUNDLE.main) return null;
  const r = readJson(EXTERNAL_FILE, 5);
  if (r.missing) return null;
  const say = (text) => {
    STARTUP_NOTES.push({ kind: 'error', text, at: new Date().toISOString() });
    console.log('External build: ' + text);
  };
  const v = r.value;
  if (r.error || !isObject(v) || typeof v.root !== 'string' || !path.isAbsolute(v.root)) {
    say(EXTERNAL_FILE + ' could not be read (' + (r.error ? reasonOf(r.error) : 'it names no build folder')
      + ') - this bundle opens read-only and empty until it is fixed, or switch to another bundle');
    return { root: '', folders: {} };
  }
  // The build's own spelling of each folder, as openExternal found it; one
  // path segment each, or the usual name.
  const folders = {};
  for (const k of Object.keys(EXTERNAL_FOLDERS)) {
    const f = isObject(v.folders) && typeof v.folders[k] === 'string' ? v.folders[k] : '';
    folders[k] = f && !/[\\/:]/.test(f) && f !== '.' && f !== '..' ? f : EXTERNAL_FOLDERS[k];
  }
  const root = path.resolve(v.root);
  let there = false;
  try { there = fs.statSync(root).isDirectory(); } catch (e) { there = false; }
  if (!there) say('the build this bundle opens, ' + root + ', is not there (a drive not connected?) - it opens empty until it is');
  return { root, folders };
})();
const EXTERNAL_ROOT = EXTERNAL ? EXTERNAL.root : '';
const READ_ONLY = !!EXTERNAL;

const WHERE = {
  cache: CONTENT, stages: CONTENT, music: CONTENT, themes: CONTENT,
  'roster.json': CONTENT, 'backup-music': CONTENT,
  // A replaced startup logo: a storyboard .def and its art. Part of the bundle,
  // because it is the user's content the same way a screenpack is.
  logo: CONTENT,
  // Pictures the user supplied as select portraits (portraitfit.js). Content:
  // they belong to the bundle whose roster names them, and travel with it.
  portraits: CONTENT,
  // Palettes the user added to characters (custompal.js), as .act files.
  palettes: CONTENT,
  // Lifebars the bundle can use (lifebars.js): downloaded packs and fight
  // screens taken from other screenpacks, each only the files it needs.
  lifebars: CONTENT,
  // WHAT THIS BUILD CHANGES ABOUT THE ENGINE ITSELF: the game-wide constants
  // (engineconst.js) and the lifebar definition (lifebar.js), each as a file
  // that overrides the engine's own rather than an edit to it.
  //
  // It is CONTENT, not Dependencies, and that is the whole point. The engine's
  // installation - release/, release-v2/, the engine checkout and whatever the
  // official zip unpacks into an export - is replaced wholesale by the next
  // engine update, so an edit made there is silently lost. A build's own
  // decision belongs beside its characters, stages, music and themes: it
  // switches with the bundle, it survives an engine update, and both exports
  // carry it.
  engine: CONTENT,
  // The bundle's own Ikemen mods (modmgr.js), one folder per mod: Lua files,
  // or files laid out like the game's own folders. A bundle without the
  // folder simply has none; which are switched off is in its roster.json.
  mods: CONTENT,
  release: DEPS, 'release-v2': DEPS,
  public: APP, tools: APP, docs: APP,
};

// dir('cache') -> the active bundle's characters folder, wherever the layout
// puts it and whatever it is called there.
function dir(name) {
  if (name === 'ikemen-go-src') return IKEMEN_SRC;
  if (name === 'leaderboard-art') return LEADERBOARD_ART;
  if (EXTERNAL_ROOT && EXTERNAL_FOLDERS[name]) return path.join(EXTERNAL_ROOT, EXTERNAL.folders[name]);
  const base = WHERE[name];
  if (!base) throw new Error('layout.dir: unknown location "' + name + '"');
  return path.join(base, folderName(name));
}

// The official engine release, newest by VERSION (enginezip.js holds the one
// rule: by name, "v0.99.0" sorted above "v0.100.0"). Kept as a pattern rather
// than a constant so dropping the next rc beside it is all upgrading takes.
function engineZip() {
  return require('./enginezip.js').engineZipIn(DEPS);
}

// The layout file as it is on disk NOW, not as it was at startup - the bundle
// switcher writes it, and the switch only applies when the program restarts.
// In a portable copy that is the program's layout with the user's choices
// from Settings/ over it, read fresh.
//
// A file that does not parse is refused with its name - never read as {} and
// written over, which would lose what the person had chosen. A read error
// (a program holding it) goes up as it is: server.js names the file.
function readJsonFile(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); }
  catch (e) { if (e.code === 'ENOENT') return {}; throw e; }
  let v;
  try { v = JSON.parse(text.replace(/^\uFEFF/, '')); } catch (e) {
    throw new Error(file + ' is damaged: it is not valid JSON (' + e.message + '). Fix it in a text editor,'
      + ' or delete it to go back to the defaults.');
  }
  if (v === null) return {};
  if (!isObject(v)) throw new Error(file + ' is not a JSON object. Fix it in a text editor, or delete it to go back to the defaults.');
  return v;
}
function readUserFile() { return readJsonFile(USER_FILE); }
function readLayoutFile() {
  if (SETTINGS_DIR) return Object.assign({}, PROGRAM, pickUser(readUserFile()));
  return readJsonFile(LAYOUT_FILE);
}
// Merge-write: set a key, or remove it with undefined. Every other key -
// downloadFolder, anything a future version adds - is kept. In a portable
// copy the write goes to Settings/studio-settings.json, never to the
// program's layout, and the file stays even when it is left empty.
function writeLayoutKeys(patch) {
  if (SETTINGS_DIR) {
    const raw = readUserFile();
    for (const k of Object.keys(patch)) { if (patch[k] === undefined) delete raw[k]; else raw[k] = patch[k]; }
    writeJsonWhole(USER_FILE, raw);
    return Object.assign({}, PROGRAM, pickUser(raw));
  }
  const raw = readLayoutFile();
  for (const k of Object.keys(patch)) { if (patch[k] === undefined) delete raw[k]; else raw[k] = patch[k]; }
  if (Object.keys(raw).length) fs.writeFileSync(LAYOUT_FILE, JSON.stringify(raw, null, 2) + '\n');
  else {
    // unlinkSync and a check, never rmSync: the Studio's Node runtime returns
    // from rmSync without deleting when the path holds a non-ASCII character
    // (an install under a name with an accent), and the file then kept the
    // key just removed - switching back to Main came back on the other bundle
    // after a restart. The same promise as lifebars.rmFile, without making
    // this module require anything.
    try { fs.unlinkSync(LAYOUT_FILE); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (fs.existsSync(LAYOUT_FILE)) throw new Error('could not delete ' + LAYOUT_FILE);
  }
  return raw;
}

module.exports = {
  APP, CONTENT_ROOT, BUNDLE, CONTENT, DEPS, DESKTOP_EXPORT, WEBSITE_EXPORT, IKEMEN_SRC,
  LAYOUT_FILE, ACTIVE_BUNDLE, EXPORT_SUFFIX, bundleSlug, readLayoutFile, writeLayoutKeys,
  LEADERBOARD_ART, isOtherBundleArt,
  // The user's own files (see the top): '' / beside the program without a
  // "settings" key, in Settings/ with one.
  SETTINGS_DIR, USER_FILE, USER_KEYS, LOCAL_CONFIG_FILE, LOGS_DIR, STARTER_DIR, STARTUP_NOTES,
  dir, folderName, engineZip,
  // An external build opened in place (see EXTERNAL above): readOnly is true
  // for every such bundle, externalRoot its folder ('' for every other bundle,
  // and for a record that could not be read).
  readOnly: READ_ONLY, externalRoot: EXTERNAL_ROOT, EXTERNAL_FILE, EXTERNAL_FOLDERS,
  // A getter, not a constant: setDownloadFolder changes it while running, and
  // a captured constant answered with the OLD folder after a reset - the file
  // said {} and /api/studio still reported the path. Read cfg every time.
  get DOWNLOAD_FOLDER() { return downloadFolder(); },
  setDownloadFolder,
};
