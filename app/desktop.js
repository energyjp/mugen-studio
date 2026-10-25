'use strict';
//
// THE DESKTOP BUILD: this project as a CONTENT MANAGER for stock Ikemen GO.
//
// The web export ships our own wasm engine - our work, carrying elements of
// Ikemen GO v1.0.0-rc.2 - and nothing here touches it. A desktop build is a
// different thing entirely: the LATEST OFFICIAL Ikemen GO, unmodified, with the
// roster this Studio manages laid into it. Netplay and ranked live only in the
// wasm build; putting them in the native engine is later work that may not pan
// out, so a desktop build makes no claim to them.
//
// THE ENGINE IS SHIPPED INTACT. Its own data/, external/, font/ and lib/ are
// extracted from the official zip and never overwritten, because our repo's
// data/ and external/ come from the V2 branch our wasm is built from and would
// quietly replace a stock file (rc.5, 1.0.0, whichever zip is here) with a
// different engine's version. Only USER
// CONTENT is laid on top:
//
//   cache/<folder>  -> chars/<mountAs>     the roster's characters
//   stages/         -> stages/             the roster's stages
//   music/          -> sound/              the music library
//   (generated)     -> data/select.def     the roster itself
//   themes/<f>      -> data/<f>            the chosen screenpack
//   (generated)     -> save/config.ini     pointing at that screenpack
//
// which is exactly the set a player would drop into an install by hand.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const vfslib = require('./vfslib');
// The control sections this build decides (Settings > Controls).
const keylib = require('./keylib.js');
const modlib = require('./modlib');
const priv = require('./private-surfaces');

const layout = require('./layout');
const CACHE = layout.dir('cache');
const THEMES = layout.dir('themes');

// The official release to build against, newest first by name. Kept as a
// pattern rather than a constant so dropping the next rc in beside it is all
// that upgrading takes.
// One rule for every caller (enginezip.js via layout.engineZip): newest by
// version, which the Settings > Engine card reports.
function findEngineZip() {
  return layout.engineZip();
}

// Checked deletes (lifebars.js): the export folder is the owner's install, and
// fs.rmSync can return without deleting anything in it when the path holds a
// non-ASCII character - chars/ then kept a removed character, and the
// reconcile below never removed a stale file named with an accent.
function rmrf(p) { require('./lifebars.js').rmTree(p); }
function rmFile(p) { require('./lifebars.js').rmFile(p); }

// EVERY WRITE INTO THE EXPORT FOLDER GOES THROUGH HERE (2026-09-20).
//
// A file this export copied on an earlier run keeps the attributes of the file
// it was copied FROM, and MUGEN packs routinely ship theirs Hidden - the CvS
// screenpack's do. Windows then refuses to open that destination for writing:
// "EPERM: operation not permitted, open '...\\common1.cns'", which is what a
// re-export into an existing folder started failing with the moment a packed
// file began arriving through the generated layer instead of being copied.
// CopyFileW never minded, which is why copying the same file always worked and
// only the generated ones broke.
//
// Removing the destination first sidesteps the attribute entirely, and the
// fresh file carries none. Read-only would refuse the removal too, so that is
// cleared and retried before giving up and letting the write report.
//
// AND THEY KEEP THE LIST. Every file an export puts down goes through one of
// these two, so between them they know exactly what this build ships - which
// is what reconcileBuildFolder needs to tell this build's files from another
// build's leftovers. Cleared at the start of each export.
//
// GENERATED is the part of it this export MADE (writeOut) rather than copied
// (copyOut) - its own select.def, config, add-ons, edited screenpack files:
// the website build's generated layer, which a mod of the bundle's never
// replaces (syncUserMods). A copied file a mod has too is the mod's, as on
// the website, where a mod sits above the content it shares a name with.
const WRITTEN = new Set();
const GENERATED = new Set();
const writtenKey = (p) => path.resolve(p).toLowerCase();     // the file system is case-insensitive
function removeFile(p) {
  try {
    rmFile(p);
  } catch (e) {
    try { fs.chmodSync(p, 0o666); rmFile(p); } catch (e2) { /* the caller reports */ }
  }
}
function writeOut(dest, data, enc) {
  removeFile(dest);
  if (enc === undefined) fs.writeFileSync(dest, data);
  else fs.writeFileSync(dest, data, enc);
  WRITTEN.add(writtenKey(dest));
  GENERATED.add(writtenKey(dest));
}

// COPYING HAS THE SAME PROBLEM, one step further in. CopyFileW is happy to
// write over a hidden file only when the source carries the attribute too; a
// plain file copied over a hidden one of the same name fails the same way (a
// re-export hit it on the screenpack's select.def, which the import rewrites
// and so does not ship hidden, over a destination an older export left
// hidden). Same remedy, same reasoning as writeOut.
function copyOut(src, dest) {
  removeFile(dest);
  fs.copyFileSync(src, dest);
  WRITTEN.add(writtenKey(dest));
  GENERATED.delete(writtenKey(dest));
}

// ---- THE LICENSE NOTICES ------------------------------------------------------
//
// Every build carries its licenses. The engine zip's own LICENSES.txt, which
// the export unpacks beside Ikemen_GO.exe, is Ikemen GO's: the engine, its
// art, FFmpeg, libvpx, libxmp and SDL2. What the zip also carries and that
// file does not name - the Go runtime and modules compiled into
// Ikemen_GO.exe, the GCC runtime and winpthreads DLLs in lib\ - and the MIT
// text for the scripts this export adds are in THIRD-PARTY-NOTICES.txt, which
// scripts/make-notices.js makes from the same zip into
// public/licenses/desktop/. The same shape as a Website export's notices.
//
// A program folder without the file still exports (the owner's choice: a
// warning, not a stop, as for a Website export and a portable copy), and the
// result says so; so does a file made for another engine zip.
const NOTICES_DIR = path.join(__dirname, 'public', 'licenses', 'desktop');
const NOTICE_FILES = ['THIRD-PARTY-NOTICES.txt'];
function copyNotices(dest, engineName, dir) {
  const from = dir || NOTICES_DIR;
  const out = { copied: [], missing: [], otherEngine: false };
  for (const f of NOTICE_FILES) {
    const src = path.join(from, f);
    if (!fs.existsSync(src)) {
      out.missing.push(f);
      console.warn('desktop: ' + f + ' is missing from ' + from + ' - the build goes out without it (node scripts/make-notices.js makes it)');
      continue;
    }
    copyOut(src, path.join(dest, f));
    out.copied.push(f);
    if (engineName && !fs.readFileSync(src, 'utf8').includes(engineName)) {
      out.otherEngine = true;
      console.warn('desktop: ' + f + ' was made for another engine zip than ' + engineName + ' - node scripts/make-notices.js brings it up to date');
    }
  }
  return out;
}

// ---- WHAT ANOTHER BUILD LEFT IN THIS FOLDER ---------------------------------
//
// The export folder is merge-only: files are put down over whatever is there,
// and only chars/ is cleared first. That is right for one bundle kept current
// and wrong the moment a second bundle is exported into the same install -
// which the folder picker allows and a content manager will do. The first
// bundle's stages stayed, its screenpack folder stayed (100 MB), and its music
// stayed in sound/ - where the STOCK screenpack's own line, vs.bgm =
// sound/Versus.mp3, found the other pack's versus.mp3 and played its announcer
// on this build's loading screen. Nothing in this build named that file; the
// file was simply there.
//
// So after everything is written, the areas this exporter owns are brought
// back to exactly this build plus the engine:
//   sound/, stages/         whole trees
//   data/<folder>/          every folder that holds a system.def - a screenpack -
//                           this build's included, so an older version of the
//                           same pack leaves nothing behind either
// A file stays if the engine zip ships it (its entry list, read without
// extracting) or this export wrote it; anything else is removed and REPORTED.
// Never touched: chars/ (cleared by its own step), save/ (the engine's own
// state and the player's settings), external/ (mods the user may add by hand),
// font/, lib/, video/, and any data/ folder that is not a screenpack.
// Comparison is case-insensitive, like the file system the build runs on -
// the file that played was versus.mp3 and the line asked for Versus.mp3.
function reconcileBuildFolder(dest, zipNames, written) {
  const norm = (p) => String(p).replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '').toLowerCase();
  let names = (zipNames || []).map(norm).filter(Boolean);
  // a zip that wraps everything in one folder was flattened on extraction
  const tops = new Set(names.map((n) => n.split('/')[0]));
  if (tops.size === 1) {
    const top = [...tops][0];
    if (!fs.existsSync(path.join(dest, top))) names = names.map((n) => n.slice(top.length + 1)).filter(Boolean);
  }
  const engine = new Set(names);
  const rel = (abs) => norm(path.relative(dest, abs));
  const ours = (abs) => written.has(writtenKey(abs));
  const removed = []; let bytes = 0;
  const drop = (p) => {
    try { bytes += fs.statSync(p).size; } catch (e) { /* counted as 0 */ }
    removeFile(p);
    if (fs.existsSync(p)) return;                       // refused: leave it, say nothing false
    removed.push(rel(p));
  };
  // -> true when the directory is empty afterwards
  const sweep = (dir) => {
    let ents;
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return false; }
    for (const e of ents) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (sweep(p) && !engine.has(rel(p))) { try { fs.rmdirSync(p); } catch (err) { /* kept */ } }
        continue;
      }
      if (engine.has(rel(p)) || ours(p)) continue;
      drop(p);
    }
    try { return fs.readdirSync(dir).length === 0; } catch (e) { return false; }
  };
  for (const d of ['sound', 'stages']) sweep(path.join(dest, d));
  const data = path.join(dest, 'data');
  let ents = [];
  try { ents = fs.readdirSync(data, { withFileTypes: true }); } catch (e) { ents = []; }
  for (const e of ents) {
    if (!e.isDirectory()) continue;
    const p = path.join(data, e.name);
    let inner = [];
    try { inner = fs.readdirSync(p); } catch (err) { inner = []; }
    if (!inner.some((n) => /^system\.def$/i.test(n))) continue;   // not a screenpack: not this exporter's to judge
    if (sweep(p) && !engine.has(rel(p))) { try { fs.rmdirSync(p); } catch (err) { /* kept */ } }
  }
  return { removed, bytes };
}

// The Studio's boot logo lives in its own subfolder of the motif so it can never
// collide with the engine's logo.def/logo.sff - which is what made "use the
// default again" impossible to honor on a warm export folder.
const STUDIO_LOGO_DIR = 'studio-logo';

// `gen` is the VFS's generated layer keyed by vpath. Where it has a file, that
// is the authoritative content for a build and the copy on disk is only its
// starting point - see the screenpack copy for why this matters.
function copyDir(src, dest, vprefix, gen, keep, rel) {
  if (!fs.existsSync(src)) return 0;
  let n = 0;
  fs.mkdirSync(dest, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dest, e.name);
    const vp = vprefix ? vprefix + e.name : null;
    const r = rel ? rel + '/' + e.name : e.name;
    if (e.isDirectory()) n += copyDir(s, d, vp ? vp + '/' : null, gen, keep, r);
    // A BACKUP IS ANYTHING WE PARKED BESIDE THE FILE WE WERE EDITING.
    // vfslib has this guard (BACKUP_FILE, vfslib.js:351) but only inside
    // walkDir, which is the WEB build's path. This function is the desktop
    // build's own copier and never consulted it, so stages/, music/ and the
    // screenpack folder were walked unfiltered and their .orig/.bak siblings
    // shipped - 11.4 MB of pre-edit originals in a folder handed to a tester.
    // stageKeepFilter made it worse rather than better: its same-basename
    // companion loop (vfslib.js:443) allowlists anything starting `<base>.`,
    // so CLUB_MOTVN.sff.orig was explicitly kept. Tested before `keep` for
    // exactly that reason.
    else if (/\.(orig|bak|preSquare)$/i.test(e.name)) continue;
    else if (keep && !keep(r)) continue;          // not loaded: leave it behind
    else if (gen && vp && gen[vp] != null) { writeOut(d, gen[vp]); n++; }
    else { copyOut(s, d); n++; }
  }
  // A directory that ended up empty because everything in it was filtered.
  try { if (!fs.readdirSync(dest).length) fs.rmdirSync(dest); } catch (e) { /* kept */ }
  return n;
}

// Where this build goes. Overwriting is the default because a content manager
// is normally pointed at one install and kept up to date; turning it off gives
// each export its own dated folder, which is what you want when comparing two
// rosters or keeping a build you have already handed out.
// THE MOTIF MUST EXIST IN THE BUILD. The stock zip (rc.5 and 1.0.0 alike)
// ships data/ikemen1/system.def and
// NO data/system.def. With no screenpack resolved this used to write
// `Motif = data/system.def` regardless, and the exported game died on
// launch: "Can't load motif: data/system.def: The system cannot find the
// file specified." Prefer what the roster asked for, then what the engine
// actually unpacked, then any screenpack folder that is there.
function motifInBuild(dest, screenpack) {
  const cands = [];
  if (screenpack) cands.push('data/' + screenpack + '/system.def');
  cands.push('data/system.def', 'data/ikemen1/system.def');
  for (const c of cands) if (fs.existsSync(path.join(dest, c))) return c;
  try {
    for (const e of fs.readdirSync(path.join(dest, 'data'), { withFileTypes: true })) {
      if (e.isDirectory() && fs.existsSync(path.join(dest, 'data', e.name, 'system.def'))) {
        return 'data/' + e.name + '/system.def';
      }
    }
  } catch (err) { /* no data/ yet */ }
  return cands[0];
}

function resolveDest(opts) {
  const base = opts.dest || layout.DESKTOP_EXPORT;
  if (opts.overwrite === false) {
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    return base + '-' + stamp;
  }
  return base;
}

// A CHOSEN FOLDER IS EMPTIED ONLY WHEN IT IS AN IKEMEN GO BUILD. The engine is
// unpacked into an emptied folder whenever the folder has no engine or a
// different one, and "Export to..." hands over whatever folder was picked -
// so picking D:\Games emptied D:\Games. A chosen folder has to be missing,
// empty, or an Ikemen GO build (Ikemen_GO.exe, or the save/.engine stamp this
// exporter leaves); anything else is refused before a file is touched. An
// Ikemen GO install is still replaced whole when its engine changes: that is
// what the stamp is for. The default folder (dist-desktop beside the program,
// Desktop Export in a portable copy) is the exporter's own and is not checked.
function checkBuildFolder(dest) {
  let st = null;
  try { st = fs.statSync(dest); } catch (e) { if (e.code === 'ENOENT') return; throw e; }
  if (!st.isDirectory()) throw new Error('"' + dest + '" is a file, not a folder');
  if (!fs.readdirSync(dest).length) return;
  if (fs.existsSync(path.join(dest, 'Ikemen_GO.exe')) || fs.existsSync(path.join(dest, 'save', '.engine'))) return;
  throw new Error('"' + dest + '" already has other files in it and is not an Ikemen GO build. A desktop export'
    + ' would replace everything in it, so it only goes into an empty folder or an existing Ikemen GO build'
    + ' - pick another folder.');
}

// The training team-menu mod, verbatim. Wrappers, not edits: the stock
// functions run first, then Training gets Simul on the dummy side and every
// AI level the stock setup handed out is zeroed - the training pause menu
// re-applies the dummy's own level to P2 at each round start (menu.lua
// 'loop#training'), so only players 3-8 stay at 0, which is the point:
// stock hands every Simul member past the leaders a difficulty level, and a
// Simul dummy team fought back. The fork does the same with an engine clamp
// (System.aiLevelAllowed); a stock binary cannot have that, a mod can.
const TRAINING_TEAM_LUA = [
  '-- Training team menus (Mugen Studio). Delete this file to go back to stock.',
  '--',
  '-- Stock Training offers only Single on the dummy side, which caps the room at',
  '-- five characters; with both sides on Simul the engine allows four per side,',
  '-- which is what the Scene Viewer (sceneviewer.lua) cycles through. Stock also',
  '-- hands every Simul member past the leaders an AI level at match setup, so a',
  '-- Simul dummy team would fight back; in Training only the dummy\'s own menu',
  '-- setting may set an AI level (the pause menu re-applies it to P2 at every',
  '-- round start), so everyone is zeroed right after the stock setup runs.',
  '-- Mods load after main.lua has built its tables, so these are wrappers, not',
  '-- edits: the stock functions still run first.',
  "if main and main.t_itemname and main.t_itemname['training'] then",
  "\tlocal stockTraining = main.t_itemname['training']",
  "\tmain.t_itemname['training'] = function(t, item)",
  '\t\tlocal r = stockTraining(t, item)',
  '\t\tmain.teamMenu[2].simul = true',
  '\t\treturn r',
  '\tend',
  'end',
  'if start and start.f_remapAI then',
  '\tlocal stockRemapAI = start.f_remapAI',
  '\tstart.f_remapAI = function(ai)',
  '\t\tstockRemapAI(ai)',
  "\t\tif gameMode('training') then",
  '\t\t\tfor pn = 1, 8 do',
  '\t\t\t\tsetCom(pn, 0)',
  '\t\t\tend',
  '\t\tend',
  '\tend',
  'end',
  '',
].join('\n');

// The sandbox's files as text: the generated Scene Viewer with its web-build
// marker stripped (the export refuses if the marker is not where it expects
// it - shipping `main.webBuild = true` into a stock build would be wrong in
// OUR main.lua and meaningless in the stock one), the team mod, and the
// Lock-On block lifted from the fork's data/training.zss (everything from its
// banner to the end of the file) under its own header. Pure, so it can be
// tested without an export.
//
// `roster` (optional) is the bundle's: an add-on its Mods tab switched off
// (modmgr.js, roster.modsOff) comes back null whatever `generated` holds, so
// syncSandboxFiles removes its files. The Training sandbox switched off is
// all three of its files (`trainingOff`: the hook goes too, and with it the
// States1 line), where a Scene Viewer that only failed to generate leaves the
// team mod and the hook in place.
function sandboxAssets(generated, forkTrainingZss, roster) {
  const out = { sceneviewer: null, team: TRAINING_TEAM_LUA, zss: null, teamPlay: null, galleryLua: null, galleryZss: null, selectAnn: null, netMenu: null, netMenuFont: null, trainingOff: false, framebar: null };
  const V = require('./modmgr.js').VPATHS;
  // The team play mod (teamplay.js) is the same text in both builds: nothing in
  // it is web-only, so it is carried as generated.
  const tp = generated && generated[V.teamPlay];
  if (tp) out.teamPlay = Buffer.isBuffer(tp) ? tp.toString('latin1') : String(tp);
  // The frame meter, when the Mods tab switched it on (the build made it).
  const fb = generated && generated[V.framebar];
  if (fb) out.framebar = Buffer.isBuffer(fb) ? fb.toString('latin1') : String(fb);
  // The select-screen announcer (selectann.js), likewise; only a bundle with
  // mugenhook's cursor table has one.
  const sa = generated && generated[require('./selectann.js').SELECT_ANN_VPATH];
  if (sa) out.selectAnn = Buffer.isBuffer(sa) ? sa.toString('latin1') : String(sa);
  // The online menu (netmenu.js), likewise: a desktop build's generated layer
  // (build() with no options) has it without the website's online items, and
  // a text that names one is refused rather than shipped.
  let nm = null;
  try { nm = generated && generated[require('./netmenu.js').NET_MENU_VPATH]; } catch (e) { nm = null; }
  if (nm) {
    out.netMenu = Buffer.isBuffer(nm) ? nm.toString('latin1') : String(nm);
    if (/rankedmatch|casualmatch|yourrank|playername/.test(out.netMenu)) {
      throw new Error('desktop: the online menu mod carries the website\'s online items - a desktop build must not');
    }
    // and its font, the engine's 6x9 under a name no screenpack ships
    let nf = null;
    try { nf = generated[require('./netmenu.js').NET_MENU_FONT_VPATH]; } catch (e) { nf = null; }
    if (nf) out.netMenuFont = Buffer.isBuffer(nf) ? nf.toString('latin1') : String(nf);
  }
  // The H gallery (gallery.js) likewise: stock Lua and ZSS, both or neither.
  const g = require('./gallery.js');
  const gl = generated && generated[g.GALLERY_LUA_VPATH], gz = generated && generated[g.GALLERY_ZSS_VPATH];
  if (gl && gz) {
    out.galleryLua = Buffer.isBuffer(gl) ? gl.toString('latin1') : String(gl);
    out.galleryZss = Buffer.isBuffer(gz) ? gz.toString('latin1') : String(gz);
  }
  const svLua = generated && generated[V.sceneViewer];
  if (svLua) {
    let text = Buffer.isBuffer(svLua) ? svLua.toString('latin1') : String(svLua);
    const marker = /^-- Mark this as the web build:[^\n]*\n(?:--[^\n]*\n)*main\.webBuild = true\n/m;
    if (!marker.test(text)) {
      throw new Error('desktop: the Scene Viewer mod no longer carries the web marker where '
        + 'desktop.js expects it - update the strip before shipping it in a stock build');
    }
    text = text.replace(marker, '-- (desktop build: no web marker - this is the stock engine)\n');
    if (/main\.webBuild/.test(text)) throw new Error('desktop: web marker survived the strip');
    out.sceneviewer = text;
  }
  const MARK = '# Scene Viewer sandbox: facing lock-on';
  let src = null;
  try { src = fs.readFileSync(forkTrainingZss, 'latin1'); } catch (e) { src = null; }
  if (src) {
    const at = src.indexOf(MARK);
    if (at >= 0) {
      const banner = src.lastIndexOf('#====', at);
      const block = src.slice(banner >= 0 ? banner : at).replace(/\r?\n/g, '\n');
      out.zss = '# Mugen Studio: the Scene Viewer\'s facing lock-on, listed in save/config.ini as\n'
        + '# [Common] States1 beside the engine\'s own common states. Inert unless\n'
        + '# ' + V.sceneViewer + ' sets map(_sv_target). To remove\n'
        + '# it, delete this file AND the States1 line - a listed file that is missing\n'
        + '# fails character loading.\n\n'
        + block;
    }
  }
  if (roster) {
    const mm = require('./modmgr.js');
    const off = (id) => !mm.builtinOn(roster, id);
    if (off('training')) { out.sceneviewer = null; out.team = null; out.zss = null; out.trainingOff = true; }
    if (off('team-play')) out.teamPlay = null;
    if (off('framebar')) out.framebar = null;
    if (off('select-announcer')) out.selectAnn = null;
    if (off('net-menu')) { out.netMenu = null; out.netMenuFont = null; }
    if (off('hgallery')) { out.galleryLua = null; out.galleryZss = null; }
  }
  return out;
}

// Lay the sandbox files into the build and report what is there. A re-export
// into the same folder does not wipe external/mods, so a Scene Viewer that
// could not be generated this time (vfslib.build() threw for an unrelated
// reason and the generated layer collapsed) must not leave the PREVIOUS
// roster's mod autoloading - it is removed. The hook is the opposite case:
// an existing data/sceneviewer.zss stays valid and inert without the mod,
// so it is kept, and `hook` reports the file that is actually there, which
// is what decides the config's States1 line - unless the bundle's Mods tab
// switched the sandbox off (assets.trainingOff), when all three go.
//
// EVERY ADD-ON LIVES IN ONE FOLDER, external/mods/mugen-studio/ (modmgr.js),
// beside the mods a player adds. Exports before that wrote them loose in
// external/mods/, and the engine loads every .lua under it at any depth, so
// those loose copies (modmgr LEGACY_VPATHS) are removed here: left, each
// add-on would run twice, and one switched off would still run.
function syncSandboxFiles(dest, assets) {
  let written = 0;
  const V = require('./modmgr.js').VPATHS;
  const at = (vpath) => path.join(dest, ...vpath.split('/'));
  const legacy = [];
  for (const vp of require('./modmgr.js').LEGACY_VPATHS) {
    const p = at(vp);
    if (!fs.existsSync(p)) continue;
    rmFile(p);
    legacy.push(vp);
  }
  const modsDir = path.dirname(at(V.sceneViewer));
  fs.mkdirSync(modsDir, { recursive: true });
  const svPath = at(V.sceneViewer);
  if (assets.sceneviewer) { writeOut(svPath, assets.sceneviewer, 'latin1'); written++; }
  else rmFile(svPath);
  const teamPath = at(V.trainingTeam);
  if (assets.team) { writeOut(teamPath, assets.team, 'latin1'); written++; }
  else rmFile(teamPath);
  // Removed when this export could not generate it, like the Scene Viewer: a
  // previous build's add004 partner-control must not autoload into a build
  // that is not one.
  const tpPath = at(V.teamPlay);
  if (assets.teamPlay) { writeOut(tpPath, assets.teamPlay, 'latin1'); written++; }
  else rmFile(tpPath);
  // The frame meter: written when switched on, removed otherwise.
  const fbPath = at(V.framebar);
  if (assets.framebar) { writeOut(fbPath, assets.framebar, 'latin1'); written++; }
  else rmFile(fbPath);
  // The announcer names cells of THIS roster's grid: removed when this
  // export has none, so another bundle's clips never play here.
  const saVpath = require('./selectann.js').SELECT_ANN_VPATH;
  const saPath = path.join(dest, ...saVpath.split('/'));
  if (assets.selectAnn) { writeOut(saPath, assets.selectAnn, 'latin1'); written++; }
  else rmFile(saPath);
  // The online menu, removed when this export could not generate it, like the
  // team mod: an earlier export's copy must not outlive the text that replaced
  // it. modmgr's path for a copy whose netmenu.js is missing.
  let nmVpath = V.netMenu;
  try { nmVpath = require('./netmenu.js').NET_MENU_VPATH; } catch (e) { /* modmgr's */ }
  const nmPath = path.join(dest, ...nmVpath.split('/'));
  if (assets.netMenu) { writeOut(nmPath, assets.netMenu, 'latin1'); written++; }
  else rmFile(nmPath);
  // Its font goes with it (the mod falls back to f-6x9.def without it).
  let nfVpath = 'font/net-menu-6x9.def';
  try { nfVpath = require('./netmenu.js').NET_MENU_FONT_VPATH; } catch (e) { /* the literal */ }
  const nfPath = path.join(dest, ...nfVpath.split('/'));
  if (assets.netMenu && assets.netMenuFont) { fs.mkdirSync(path.dirname(nfPath), { recursive: true }); writeOut(nfPath, assets.netMenuFont, 'latin1'); written++; }
  else rmFile(nfPath);
  const zssPath = at(V.trainingZss);
  if (assets.zss) { fs.mkdirSync(path.dirname(zssPath), { recursive: true }); writeOut(zssPath, assets.zss, 'latin1'); written++; }
  else if (assets.trainingOff) rmFile(zssPath);
  // The H gallery goes whole or not at all: a previous build's gallery names
  // that build's characters, and a pair it cannot load stops the engine. Its
  // hook goes with it, and the config line follows the hook (see
  // exportDesktop).
  const g = require('./gallery.js');
  const galLua = path.join(dest, ...g.GALLERY_LUA_VPATH.split('/'));
  const galZss = path.join(dest, ...g.GALLERY_ZSS_VPATH.split('/'));
  if (assets.galleryLua && assets.galleryZss) {
    writeOut(galLua, assets.galleryLua, 'latin1');
    fs.mkdirSync(path.dirname(galZss), { recursive: true });
    writeOut(galZss, assets.galleryZss, 'latin1');
    written += 2;
  } else {
    rmFile(galLua);
    rmFile(galZss);
  }
  return { written, legacyRemoved: legacy, sandbox: {
    mod: assets.sceneviewer ? V.sceneViewer : null,
    team: assets.team ? V.trainingTeam : null,
    teamPlay: assets.teamPlay ? V.teamPlay : null,
    framebar: assets.framebar ? V.framebar : null,
    selectAnn: assets.selectAnn ? saVpath : null,
    netMenu: assets.netMenu ? nmVpath : null,
    hook: fs.existsSync(zssPath) ? V.trainingZss : null,
    gallery: assets.galleryLua && assets.galleryZss ? g.GALLERY_LUA_VPATH : null,
    galleryHook: fs.existsSync(galZss) ? g.GALLERY_ZSS_VPATH : null,
  } };
}

// ---- THE ENGINE'S OWN COPY OF A FILE ------------------------------------------
//
// Read out of the engine zip without unpacking the rest: the central directory
// (Zip64 followed, as enginezip.zipEntries does), each entry's local header,
// then its data - stored or deflated, the two methods a zip of the engine
// uses - checked against the CRC the directory records. A zip that wraps
// everything in one folder is read as the export flattened it (the same rule
// as reconcileBuildFolder). -> { names: Set of every file and folder the zip
// has, lowercased, as the install has them; files: Map(lowercased name ->
// Buffer) for each wanted name it has }. Null for a file that is not a zip.
function zipRead(zipFile, wanted, dest) {
  const zlib = require('zlib');
  let fd;
  try { fd = fs.openSync(zipFile, 'r'); } catch (e) { return null; }
  try {
    const size = fs.fstatSync(fd).size;
    const read = (len, at) => { const b = Buffer.alloc(len); fs.readSync(fd, b, 0, len, at); return b; };
    const tailLen = Math.min(size, 22 + 65535 + 20);
    const tail = read(tailLen, size - tailLen);
    let e = -1;
    for (let i = tailLen - 22; i >= 0; i--) if (tail.readUInt32LE(i) === 0x06054b50) { e = i; break; }
    if (e < 0) return null;
    let count = tail.readUInt16LE(e + 10), cdSize = tail.readUInt32LE(e + 12), cdOff = tail.readUInt32LE(e + 16);
    if (count === 0xffff || cdSize === 0xffffffff || cdOff === 0xffffffff) {
      const loc = e - 20;
      if (loc < 0 || tail.readUInt32LE(loc) !== 0x07064b50) return null;
      const z = read(56, Number(tail.readBigUInt64LE(loc + 8)));
      if (z.readUInt32LE(0) !== 0x06064b50) return null;
      count = Number(z.readBigUInt64LE(32)); cdSize = Number(z.readBigUInt64LE(40)); cdOff = Number(z.readBigUInt64LE(48));
    }
    if (cdOff + cdSize > size) return null;
    const cd = read(cdSize, cdOff);
    const entries = [];
    for (let p = 0, k = 0; k < count && p + 46 <= cd.length; k++) {
      if (cd.readUInt32LE(p) !== 0x02014b50) return null;
      const nl = cd.readUInt16LE(p + 28), xl = cd.readUInt16LE(p + 30), cl = cd.readUInt16LE(p + 32);
      const ent = { name: cd.slice(p + 46, p + 46 + nl).toString('utf8').replace(/\\/g, '/'), method: cd.readUInt16LE(p + 10),
        crc: cd.readUInt32LE(p + 16), csize: cd.readUInt32LE(p + 20), usize: cd.readUInt32LE(p + 24), off: cd.readUInt32LE(p + 42) };
      // Zip64: the sizes and the offset that did not fit, in that order.
      for (let x = p + 46 + nl, end = x + xl; x + 4 <= end;) {
        const id = cd.readUInt16LE(x), len = cd.readUInt16LE(x + 2);
        if (id === 0x0001) {
          let q = x + 4;
          if (ent.usize === 0xffffffff) { ent.usize = Number(cd.readBigUInt64LE(q)); q += 8; }
          if (ent.csize === 0xffffffff) { ent.csize = Number(cd.readBigUInt64LE(q)); q += 8; }
          if (ent.off === 0xffffffff) ent.off = Number(cd.readBigUInt64LE(q));
        }
        x += 4 + len;
      }
      entries.push(ent);
      p += 46 + nl + xl + cl;
    }
    let strip = '';
    const tops = new Set(entries.map((x) => x.name.replace(/^\/+/, '').split('/')[0]));
    if (tops.size === 1) {
      const top = [...tops][0];
      if (!dest || !fs.existsSync(path.join(dest, top))) strip = top + '/';
    }
    const rel = (n) => (strip && n.startsWith(strip) ? n.slice(strip.length) : n).replace(/^\/+/, '').replace(/\/+$/, '').toLowerCase();
    const names = new Set();
    for (const x of entries) {
      const r = rel(x.name);
      const segs = r.split('/');
      for (let i = 1; i <= segs.length; i++) if (segs.slice(0, i).join('/')) names.add(segs.slice(0, i).join('/'));
    }
    const want = new Set((wanted || []).map((w) => String(w).toLowerCase()));
    const files = new Map();
    for (const x of entries) {
      const r = rel(x.name);
      if (!want.has(r) || x.name.endsWith('/') || files.has(r)) continue;
      const lh = read(30, x.off);
      if (lh.readUInt32LE(0) !== 0x04034b50) continue;
      const raw = read(x.csize, x.off + 30 + lh.readUInt16LE(26) + lh.readUInt16LE(28));
      let buf = null;
      try { buf = x.method === 0 ? raw : (x.method === 8 ? zlib.inflateRawSync(raw) : null); } catch (err) { buf = null; }
      if (!buf || buf.length !== x.usize) continue;
      if (typeof zlib.crc32 === 'function' && (zlib.crc32(buf) >>> 0) !== x.crc) continue;
      files.set(r, buf);
    }
    return { names, files };
  } catch (err) {
    return null;
  } finally {
    fs.closeSync(fd);
  }
}

// ---- THE BUNDLE'S OWN MODS ---------------------------------------------------
//
// modmgr.js keeps them in <bundle>/mods/<folder>/, and the Mods tab switches
// each one on or off. Every file of every mod that is on goes into the build
// at the path the website build mounts it at (modmgr.userModFiles: a Lua mod
// under external/mods/<folder>/, a mod laid out like the game where it says),
// over whatever the install has there - the engine's own file included, as on
// the website, where a mod replaces the file it names.
//
// NEVER OVER A FILE THIS EXPORT MADE ITSELF. On the website the generated
// layer always wins over a mod; here that is every file the export made
// (opts.generated, its GENERATED) by the time this runs, which is why the
// export runs it last; the result names each one. A file it only copied - a
// screenpack's, a song - is the mod's to replace, as on the website.
//
// AND WHAT AN EARLIER EXPORT WROTE FOR THEM GOES. Different bundles are
// exported into ONE install, so a mod one bundle had would outlive the export
// that put it there and load in the next bundle's build. The files written for
// mods are listed in external/mods/mugen-studio/user-mods.json - JSON, so the
// engine never loads it - and every export, of any bundle, takes back each
// listed file it does not write again (and that the export did not put down
// itself this time, opts.written): an engine file a mod replaced is put
// back from the engine zip (opts.zip), anything else is deleted, and a folder
// that leaves empty goes too (never one the zip ships, nor a top folder or
// external/mods). An engine file the zip cannot give back stays as the mod
// left it and stays listed, for the next export to try. A file put in by hand
// is not on the list and is never touched.
//
// `mods` is modmgr.userModFiles' list ({ vpath, abs, folder }). -> { files
// (the vpaths written), mods (their folders), skipped [{ vpath, folder }],
// removed, restored, kept }.
const BACKUP_NAME = /\.(orig|bak|preSquare)$/i;
function syncUserMods(dest, mods, opts) {
  const o = opts || {};
  const V = require('./modmgr.js').VPATHS;
  const made = new Set(o.generated || GENERATED);   // never written over
  const own = new Set(o.written || WRITTEN);       // never taken back
  const root = path.resolve(dest);
  // A vpath as a path inside the build, or null: no '..', no drive, no stream.
  const inBuild = (vpath) => {
    const segs = String(vpath || '').split('/');
    if (!vpath || segs.some((s) => !s || s === '.' || s === '..' || /[:\0\\]/.test(s))) return null;
    const p = path.resolve(root, ...segs);
    return p.startsWith(root + path.sep) ? p : null;
  };
  const manifestPath = inBuild(V.userModsManifest);
  let before = [];
  try {
    const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8').replace(/^﻿/, ''));
    if (m && Array.isArray(m.files)) before = m.files.filter((v) => typeof v === 'string' && v);
  } catch (e) { before = []; }

  const out = { files: [], mods: [], skipped: [], removed: [], restored: [], kept: [] };
  const now = new Set();
  for (const m of mods || []) {
    const p = inBuild(m.vpath);
    const low = String(m.vpath).toLowerCase();
    if (!p || now.has(low) || low === V.userModsManifest.toLowerCase() || BACKUP_NAME.test(m.vpath)) continue;
    if (made.has(writtenKey(p))) { out.skipped.push({ vpath: m.vpath, folder: m.folder }); continue; }
    fs.mkdirSync(path.dirname(p), { recursive: true });
    copyOut(m.abs, p);
    now.add(low);
    out.files.push(m.vpath);
    if (!out.mods.includes(m.folder)) out.mods.push(m.folder);
  }

  const gone = [...new Set(before.filter((v) => !now.has(v.toLowerCase())))];
  const engine = gone.length && o.zip ? zipRead(o.zip, gone, root) : null;
  // An engine zip that cannot be read cannot say which of these were the
  // engine's own files: none is deleted, and the list keeps them.
  if (gone.length && o.zip && !engine) {
    out.kept.push(...gone.filter((v) => { const p = inBuild(v); return p && !own.has(writtenKey(p)) && fs.existsSync(p); }));
    gone.length = 0;
  }
  const relOf = (abs) => path.relative(root, abs).split(path.sep).join('/').toLowerCase();
  const prune = (dir) => {
    for (let d = dir; d.startsWith(root + path.sep); d = path.dirname(d)) {
      const r = relOf(d);
      if (r.split('/').length < 2 || r === 'external/mods' || (engine && engine.names.has(r))) return;
      try { if (fs.readdirSync(d).length) return; fs.rmdirSync(d); } catch (e) { return; }
    }
  };
  for (const v of gone) {
    const p = inBuild(v);
    if (!p || own.has(writtenKey(p))) continue;      // the export's own file now
    const low = v.toLowerCase();
    if (engine && engine.names.has(low)) {
      const buf = engine.files.get(low);
      if (buf) {
        fs.mkdirSync(path.dirname(p), { recursive: true });
        writeOut(p, buf);
        out.restored.push(v);
      } else {
        out.kept.push(v);
      }
      continue;
    }
    if (!fs.existsSync(p)) continue;
    removeFile(p);
    if (fs.existsSync(p)) { out.kept.push(v); continue; }
    out.removed.push(v);
    prune(path.dirname(p));
  }

  const list = out.files.concat(out.kept);
  if (list.length) {
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    writeOut(manifestPath, JSON.stringify({
      about: 'The files Mugen Studio wrote into this build for the mods switched on in its Mods tab. The next export'
        + ' removes the ones it does not write again (an engine file a mod replaced is put back). Not a mod itself.',
      files: list,
    }, null, 2) + '\n', 'utf8');
  } else {
    rmFile(manifestPath);
  }
  return out;
}

// The config's States1 line must match the file. A listed common-states file
// that is missing fails character compilation (compiler.go), and the export
// preserves a player's config in place - so when the hook file is not in the
// build, any States1 line naming it is dropped from the text.
function stripStates1Line(cfgText, hookPresent) {
  if (hookPresent) return cfgText;
  return cfgText.split(/\r?\n/).filter((l) => !/^\s*States1\s*=\s*data\/sceneviewer\.zss\s*$/i.test(l)).join('\r\n');
}

// The key a screenpack's added systems ride on (themeopts.THEME_STATES_KEY) is
// reserved for them: a preserved config from an export with another pack, or
// with them switched on, still names its files, which this build may not have.
// So the line goes whenever this build adds none. (A stale States or
// Debug.Font is already written over: the settings set is complete.)
function stripThemeStatesLine(cfgText, present) {
  if (present) return cfgText;
  const key = require('./themeopts.js').THEME_STATES_KEY;
  const re = new RegExp('^\\s*' + key + '\\s*=', 'i');
  return cfgText.split(/\r?\n/).filter((l) => !re.test(l)).join('\r\n');
}

// WHERE THE BUILD'S OWN fight.def GOES INSIDE AN EXPORT, as a vpath - or null
// when there is nowhere safe for it.
//
// The engine looks for the file the motif's `fight` key names in the motif's
// own folder first, then the build root, then data/ (motif.go:82
// `lookup:"def,,data/"`). The motif's own folder is therefore both where an
// override is picked up and where it leaves the engine's own data/fight.def
// alone - unless the motif itself lives at the data/ root, when the two are the
// same file. That case gets nothing: the export re-extracts the engine only
// when its stamp changes, so a file written over the engine's own would outlive
// the override that asked for it.
//
// THE WHOLE RELATIVE PATH, NOT ITS BASENAME. The engine joins the motif's
// `fight` value, subfolders and all, under the motif folder (fightscreen.go
// 5966 -> SearchFile, common.go:668-680). An add004 pack names
// `fight = res/fight_720p.def`, so a copy written at data/<pack>/fight_720p.def
// was never read: the desktop export silently lacked every Settings > Engine
// edit on such a pack, while the website build, which mounts the full path,
// had them.
function lifebarTarget(motifInBuildPath, fightRel) {
  const folder = path.posix.dirname(String(motifInBuildPath || '').replace(/\\/g, '/'));
  if (!folder || folder === '.' || folder.toLowerCase() === 'data') return null;
  const rel = path.posix.normalize(String(fightRel || 'fight.def').replace(/\\/g, '/')).replace(/^(\.\/)+/, '');
  if (!rel || rel.startsWith('../') || rel === '..' || rel.startsWith('/')) return null;
  return folder + '/' + rel;
}

// The same rule for any other [Common] entry this exporter writes: the line and
// the file have to agree, and a preserved config from an earlier export can be
// carrying a line whose file is no longer in the build.
function stripCommonLine(cfgText, key, vpath, present) {
  if (present) return cfgText;
  const re = new RegExp('^\\s*' + key.replace(/[.]/g, '\\.') + '\\s*=\\s*'
    + vpath.replace(/[.\\/]/g, (c) => '\\' + c) + '\\s*$', 'i');
  return cfgText.split(/\r?\n/).filter((l) => !re.test(l)).join('\r\n');
}

// AN IKEMEN GO BUILD'S OWN LISTS are written on the base keys (States, Air,
// Cmd, Fx), over the engine's, and name files under data/build/. A preserved
// config from an export of THAT bundle still carries those lines when another
// bundle is exported into the folder, and data/build/ is emptied by then - so
// a base-key line naming data/build/ goes when this bundle brings none, and
// the engine's own default for the key stands again.
function stripBuildLines(cfgText, present) {
  if (present) return cfgText;
  const vdir = require('./buildimport.js').BUILD_COMMON_VDIR;
  const re = new RegExp('^\\s*(States|Air|Cmd|Fx)\\s*=.*' + vdir.replace(/[.\\/]/g, (c) => '\\' + c) + '\\/', 'i');
  return cfgText.split(/\r?\n/).filter((l) => !re.test(l)).join('\r\n');
}

// STAGES THE OFFICIAL ENGINE READS DIFFERENTLY FROM MUGEN 1.1.
//
// A desktop build runs the official Ikemen GO release, untouched. Three things
// in stages from real MUGEN 1.1 builds come out wrong on it, and the browser
// build's engine has each fixed at the source (docs/UPSTREAM-1.0.0.md § 4b).
// For the official one the export rewrites ITS OWN COPY of the stage so the
// stock engine reads what MUGEN reads - the bundle and the source build are
// never touched:
//
//   orphan-bgctrl  A [BGCtrl] above every [BGCtrlDef] controls every element
//                  in MUGEN and nothing in the stock engine, so a pack's lone
//                  "PosSet y = -130" that lifts the whole background does
//                  nothing and the fighters float above the floor. An empty
//                  [BGCtrlDef] above it is MUGEN's implicit group made explicit
//                  - no ctrlID means every element, looptime -1 - and the stock
//                  engine honors that.
//   shadow-color   MUGEN 1.1 ignores [Shadow] color; the stock engine subtracts
//                  it from the floor unless the stage declares
//                  mugenversion = 1.1, which almost none do, and the shadow
//                  becomes a black slab. Written as 0,0,0 wherever the browser
//                  engine would ignore it: not on a stage that names MUGEN 1.0
//                  or declares ikemenversion.
//   triple-quote   The stock engine reads [Music] by handing the WHOLE stage to
//                  an INI library that treats a value starting with three
//                  double quotes as a multi-line value, closed only by another
//                  three on the same line - the line's own newline counts as
//                  content, so even a bare """ never closes - and the stage
//                  fails to load ("missing closing key quote").
//                  name = """; is the real case. The engine's own reader cuts
//                  every line at its first ';' (IniSection.Parse), so appending
//                  ;""" closes the value for the library while the engine
//                  still reads exactly what it read before.
//
// Returns { text, fixes: [{ kind, line, detail }] }; text is the input when
// nothing applies.
function officialEngineStageFixes(text) {
  const eol = /\r\n/.test(text) ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const fixes = [];
  const base = (header) => header.trim().split(/\s+/)[0].toLowerCase();
  const sectionOf = (line) => {
    const m = /^\s*\[\s*([^\]]*?)\s*\]/.exec(line.split(';')[0]);
    return m ? base(m[1]) : null;
  };

  // [Info] versions, parsed the way the engine parses them
  // (ParseMugenVersion / ParseIkemenVersion in src/common.go).
  let sec = null, mugenRaw = '', ikemenRaw = '';
  for (const line of lines) {
    const s = sectionOf(line);
    if (s !== null) { sec = s; continue; }
    if (sec !== 'info') continue;
    const kv = /^\s*([^=;]+?)\s*=\s*([^;]*)/.exec(line);
    if (!kv) continue;
    const key = kv[1].toLowerCase();
    if (key === 'mugenversion') mugenRaw = kv[2].trim();
    if (key === 'ikemenversion') ikemenRaw = kv[2].trim();
  }
  const mugenver = (() => {
    const v = [0, 0];
    const parts = mugenRaw.split('.').map((p) => p.trim());
    for (let i = 0; i < parts.length && i < 2; i++) {
      if (!/^\d+$/.test(parts[i])) return [0, 5];
      v[i] = +parts[i];
    }
    return v;
  })();
  const ikemen = (() => {
    for (const p of ikemenRaw.split('.').map((x) => x.trim()).slice(0, 3)) {
      if (!/^\d+$/.test(p)) break;
      if (+p) return true;
    }
    return false;
  })();
  // The browser engine drops the color when this holds (d2bd6a5); the stock
  // engine only when the stage says exactly 1.1.
  const forkIgnoresColor = !ikemen && (mugenver[0] !== 1 || mugenver[1] >= 1);
  const stockIgnoresColor = !ikemen && mugenver[0] === 1 && mugenver[1] === 1;

  const out = [];
  let seenDef = false;
  sec = null;
  lines.forEach((line, i) => {
    const s = sectionOf(line);
    if (s !== null) {
      if (s === 'bgctrldef') seenDef = true;
      if (s === 'bgctrl' && !seenDef) {
        out.push('; [BGCtrlDef] made explicit for the official Ikemen GO: MUGEN applies a');
        out.push('; [BGCtrl] written above every [BGCtrlDef] to all background elements.');
        out.push('[BGCtrlDef]');
        seenDef = true;
        fixes.push({ kind: 'orphan-bgctrl', line: i + 1, detail: line.trim() });
      }
      sec = s;
      out.push(line);
      return;
    }
    if (sec === 'shadow' && forkIgnoresColor && !stockIgnoresColor) {
      const m = /^(\s*color\s*=\s*)([^;]*?)(\s*)(;.*)?$/i.exec(line);
      if (m) {
        const rgb = m[2].split(',').map((x) => Math.max(0, Math.min(255, parseInt(x, 10) || 0)));
        if (rgb.some((v) => v > 0)) {
          out.push(m[1] + '0,0,0 ; was ' + m[2].trim() + ' - MUGEN 1.1 ignores [Shadow] color');
          fixes.push({ kind: 'shadow-color', line: i + 1, detail: m[2].trim() + ' -> 0,0,0' });
          return;
        }
      }
    }
    const tq = /^(\s*[^=;\s][^=;]*?\s*=\s*)("""[^;]*)(;.*)?$/.exec(line);
    if (tq && tq[2].slice(3).indexOf('"""') === -1 && (tq[3] || '').indexOf('"""') === -1) {
      out.push(tq[1] + tq[2].replace(/\s+$/, '') + ';"""');
      fixes.push({ kind: 'triple-quote', line: i + 1, detail: line.trim() });
      return;
    }
    out.push(line);
  });

  return fixes.length ? { text: out.join(eol), fixes } : { text, fixes };
}

// Applies officialEngineStageFixes to the stage .def files this export copied
// from the bundle (never the engine's own stock stages). Returns
// [{ file, fixes }] for the files it changed.
function fixStagesForOfficialEngine(srcStagesDir, destStagesDir, keep) {
  const changed = [];
  const walk = (dir, rel) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const e of entries) {
      const r = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) { walk(path.join(dir, e.name), r); continue; }
      if (!/\.def$/i.test(e.name) || (keep && !keep(r))) continue;
      const dest = path.join(destStagesDir, ...r.split('/'));
      let text;
      try { text = fs.readFileSync(dest, 'latin1'); } catch (err) { continue; }
      const res = officialEngineStageFixes(text);
      // ...and the one repair that is NOT about this engine: an animation
      // frame whose blend sits one field late is drawn opaque by both engines
      // (buildimport.stageAirBlend). The website build repairs its own copy in
      // vfslib; this is the same change for the copy that ships here.
      const blend = require('./buildimport.js').stageAirBlend(res.text);
      const fixes = blend.count
        ? res.fixes.concat([{ kind: 'air-blend-field', lines: blend.count }])
        : res.fixes;
      if (!fixes.length) continue;
      writeOut(dest, blend.count ? blend.text : res.text, 'latin1');
      changed.push({ file: 'stages/' + r, fixes });
    }
  };
  walk(srcStagesDir, '');
  return changed;
}

// ONLY WHAT EACH CHARACTER ACTUALLY LOADS, copied into charsDir. Returns
// { chars, files }. The cache directory is a parameter so this can be run on a
// synthetic one (tools/test-desktop-chars.js) - the export's file choice went
// untested for as long as it lived inline, which is how a rostered variant's
// own sprite file could be dropped with nothing to catch it.
function copyCharacters(roster, cacheDir, charsDir) {
  let chars = 0, files = 0;
  const copied = [];
  // A folder is copied ONCE even when the roster lists two of its .def files
  // (a boss build beside the normal one). vfslib.mountNames decides which entry
  // owns the copy; the rest just add a select.def line into it.
  const charMounts = vfslib.mountNames(roster);
  for (const c of roster.chars || []) {
    if (c.kind || !c.folder || !c.mountAs) continue;   // skipslot / randomselect
    if (!vfslib.ownsMount(c, charMounts)) continue;
    const src = path.join(cacheDir, c.folder);
    if (!fs.existsSync(src)) continue;
    // The defs the roster LOADS this folder with, exactly as the web build
    // decides (vfslib.rosteredDefNames). This used to be modlib.findMainDef's
    // guess, which cannot tell alternates apart: for a folder holding
    // Bison.def, 3v3.def and Final Bison.def it guessed 3v3.def, kept that
    // def's Sprite.sff and dropped the Sprite2.sff the rostered
    // Final Bison.def names - the export failed to start while the website ran.
    // The guess stays only as a fallback for an entry with no select path.
    const rostered = vfslib.rosteredDefNames(roster, c.folder);
    const defNames = rostered.length ? rostered : [modlib.findMainDef(src)].filter(Boolean);
    // A filter is only as good as the .def it read: when that cannot be
    // parsed charKeepFilter returns null and everything ships, which is the
    // right way round - a character missing a file is broken, one carrying a
    // spare is merely large.
    const keep = defNames.length ? vfslib.charKeepFilter(src, defNames) : null;
    files += copyDir(src, path.join(charsDir, c.mountAs), null, null,
      keep ? (rel) => keep('chars/x/' + rel) : null);
    copied.push({ dir: path.join(charsDir, c.mountAs), mountAs: c.mountAs, defNames,
      fits: require('./portraitfit.js').fitsOf(c, roster), customs: c.customPalettes || null, order: c.paletteOrder || null,
      // the owner's Command List choices per def (cmdlist.js): each def is a roster entry of its own
      cmdlists: Object.fromEntries(defNames.map((d) => [d, (require('./cmdlist.js').entryFor(roster, c.folder, d, c) || {}).commandList || null])) });
    chars++;
  }
  return { chars, files, copied };
}

// The sprite file as this build ships it, made in the COPIES this export just
// wrote - the website build does the same to its own copy in vfslib, in the
// same order: select portraits fitted to this screenpack (portraitfit.js), then
// a flag the sprite file cannot honor (futafix.js).
// Returns [{ file, kind, ... }].
function fixCopiedCharacters(copied) {
  const futafix = require('./futafix.js');
  const portraitfit = require('./portraitfit.js');
  const changed = [];
  for (const c of copied || []) {
    const fitted = new Set(), paletted = new Set(), hitDone = new Set();
    for (const defName of c.defNames) {
      // MUGEN's HitDef default (p1sprpriority = 1) in a MUGEN-authored
      // character's state files, as the website build ships them (hitprio.js):
      // the stock engine dropped it, and its scenes layer on it.
      for (const h of require('./hitprio.js').repairFor(c.dir, defName)) {
        if (hitDone.has(h.abs)) continue;
        hitDone.add(h.abs);
        writeOut(h.abs, h.text, 'latin1');
        if (h.count) changed.push({ file: 'chars/' + c.mountAs + '/' + h.rel, kind: 'mugen-hit-priority', hitdefs: h.count });
        if (h.latches) changed.push({ file: 'chars/' + c.mountAs + '/' + h.rel, kind: 'ai-switch-release', switches: h.latches });
      }
      let p = null;
      // a source that wears the costume is baked in the build's pal1: the order and the Studio's colors pick it
      try { p = c.fits ? portraitfit.fitFor(c.dir, defName, c.fits, { pictures: layout.dir('portraits'), order: c.order, customs: c.customs, palettes: layout.dir('palettes') }) : null; } catch (e) { p = null; }
      // two defs of one folder usually share a sprite file: fit it once
      if (p && p.buf && !fitted.has(p.spriteAbs)) {
        fitted.add(p.spriteAbs);
        writeOut(p.spriteAbs, p.buf);
        changed.push({ file: 'chars/' + c.mountAs + '/' + p.spriteRel, kind: 'portrait-fit', slots: p.applied, skipped: p.skipped });
      }
      // palettes the user added: into the sprite file (v2), or beside the def (v1)
      let cp = null;
      try { cp = c.customs ? require('./custompal.js').shipFor(c.dir, defName, c.customs, { palettes: layout.dir('palettes') }) : null; } catch (e) { cp = null; }
      if (cp) {
        if (cp.sprite && !paletted.has(cp.sprite.abs)) { paletted.add(cp.sprite.abs); writeOut(cp.sprite.abs, cp.sprite.buf); }
        if (cp.def) { writeOut(cp.def.abs, cp.def.text, 'latin1'); for (const f of cp.files) writeOut(path.join(c.dir, ...f.rel.split('/')), f.buf); }
        if (cp.applied.length || cp.skipped.length) changed.push({ file: 'chars/' + c.mountAs + '/' + defName, kind: 'palettes', slots: cp.applied, skipped: cp.skipped });
      }
      // the user's slot order (palorder.js), over the copy as the repairs above left it on disk
      let po = null;
      try { po = c.order ? require('./palorder.js').shipFor(c.dir, defName, c.order, {}) : null; } catch (e) { po = null; }
      if (po) {
        if (po.sprite) { paletted.add(po.sprite.abs); writeOut(po.sprite.abs, po.sprite.buf); }
        if (po.def) writeOut(po.def.abs, po.def.text, 'latin1');
        changed.push({ file: 'chars/' + c.mountAs + '/' + defName, kind: 'palette-order', moved: po.map.length });
      }
      let r = null;
      try { r = futafix.repairFor(c.dir, defName); } catch (e) { r = null; }
      if (r) {
        writeOut(r.spriteAbs, r.buf);
        changed.push({ file: 'chars/' + c.mountAs + '/' + r.spriteRel, kind: 'plus-frames', links: r.added, unfixable: r.unfixable });
      }
      // last: a v1 file whose own palette is not the character's pal1 (v1base.js), over the copy as everything above left it
      let vb = null;
      try { vb = require('./v1base.js').repairFor(c.dir, defName, {}); } catch (e) { vb = null; }
      if (vb) {
        writeOut(vb.spriteAbs, vb.buf);
        changed.push({ file: 'chars/' + c.mountAs + '/' + vb.spriteRel, kind: 'v1-base-palette', replaced: vb.replaced, axis: vb.axis || [] });
      }
      // and after that: the def's palN lines over the slots an SFF v2 file keys
      // itself (v2ownpal.js), which the official engine would draw over the
      // file's own - on the def and sprite file as everything above left them
      let op = null;
      try { op = require('./v2ownpal.js').repairFor(c.dir, defName, {}); } catch (e) { op = null; }
      if (op) {
        writeOut(op.def.abs, op.def.text, 'latin1');
        changed.push({ file: 'chars/' + c.mountAs + '/' + op.def.rel, kind: 'v2-own-palettes', slots: op.slots });
      }
      // last of all: the pause menu's Command List (cmdlist.js) - a file beside
      // the def and a movelist line in its [Files], on the def as everything
      // above left it; a character that ships her own list is never touched
      let ml = null;
      try { ml = require('./cmdlist.js').shipFor(c.dir, defName, { choices: c.cmdlists ? c.cmdlists[defName] : null }); } catch (e) { ml = null; }
      if (ml) {
        writeOut(path.join(c.dir, ...ml.file.rel.split('/')), ml.file.buf);
        writeOut(path.join(c.dir, ...ml.def.rel.split('/')), ml.def.text, 'latin1');
        changed.push({ file: 'chars/' + c.mountAs + '/' + ml.file.rel, kind: 'command-list', moves: ml.rows, def: 'chars/' + c.mountAs + '/' + ml.def.rel, names: ml.names || [] });
      }
    }
  }
  return changed;
}

// system.def's logo.storyboard pointed at `want`: the custom logo in its own
// folder, or the engine's own logo.def again - which is still there precisely
// because nothing overwrites it any more. With no logo.storyboard line at all,
// a custom logo gets one under [Files]. Function replacements: the logo's file
// name is the user's text, and in a replacement string $&, $' and $$ are
// patterns.
//
// BACK TO THE ENGINE'S LOGO (no custom one): only an ACTIVE line is pointed,
// and its trailing comment stays. A pack that commented its logo out - an
// imported build's system.def arrives byte for byte - keeps it off; the
// pattern below used to switch it back on.
function pointLogoStoryboard(t, want, custom) {
  if (!custom) {
    return t.replace(/^([ \t]*logo\.storyboard[ \t]*=)[^;\r\n]*?([ \t]*(?:;[^\r\n]*)?)$/gim, (m, k, tail) => k + ' ' + want + tail);
  }
  const re = /^[ \t]*;?[ \t]*logo\.storyboard[ \t]*=[^\r\n]*/gim;
  if (re.test(t)) return t.replace(re, () => 'logo.storyboard = ' + want);
  return t.replace(/^([ \t]*\[Files\][^\r\n]*)/mi, (m, k) => k + '\r\nlogo.storyboard = ' + want);
}

function exportDesktop(opts = {}) {
  // A desktop build is always V2. The V2 bundle - release-v2/data, which is
  // where the ikemen1 motif lives - is only walked into the VFS index when
  // IKEMEN_V2 is set (vfslib.js:565). server.js sets it for every Studio
  // session, so an export from the UI always had it; a bare
  // require('./desktop').exportDesktop() did not, and silently produced a build
  // whose system.def still named sound/Title.mp3 - the stock name, not in the
  // build - because the motif it should have rewritten was never indexed.
  if (!process.env.IKEMEN_V2) process.env.IKEMEN_V2 = '1';
  // Before anything is built or read: a chosen folder that is not a build is
  // refused here, untouched (see checkBuildFolder).
  if (opts.dest) checkBuildFolder(resolveDest(opts));
  // vfslib's reader: a roster saved with a byte-order mark reads like any other.
  const roster = vfslib.readRoster();
  // The generated layer, for the screenpack copy below. Nothing else is taken
  // from it: main.lua, the web-only mods and the browser font definitions are
  // all built for OUR wasm engine and have no business in a stock build.
  let generated = {};
  // NO privateMenu FLAG HERE, DELIBERATELY. vfslib's RANKED / CASUAL / YOUR
  // RANK / PLAYER NAME injection is now opt-in, so a plain build() cannot
  // produce it. Previously the gate was `!opts.publicOnly` and this call passed
  // nothing, so `undefined` opened it and every desktop export carried those
  // four items in its system.def - as DEAD entries, because the screenpack
  // block below deliberately does NOT take main.lua from the generated layer.
  //
  // Passing publicOnly instead would have silenced the menu and ALSO trimmed
  // the roster to roster.publicChars, trimmed stages to publicStages, and
  // cleared titleMusic/selectMusic - a quietly smaller desktop build with no
  // menu music. assertClean() at the end of this function is the backstop.
  // vfsListFont: the Command List font the build decided on (jpfont.js; below)
  let vfsListFont = null;
  // vfsButtons: the Command List buttons the build decided on (buttonstyle.js; below)
  let vfsButtons = null;
  try { const built = vfslib.build(); generated = built.generated || {}; vfsListFont = built.commandListFont || null; vfsButtons = built.commandListButtons || null; } catch (e) { generated = {}; }

  WRITTEN.clear();
  GENERATED.clear();
  const zip = opts.engineZip || findEngineZip();
  if (!zip || !fs.existsSync(zip)) {
    throw new Error('no official Ikemen GO zip found - put Ikemen_GO-<version>-windows.zip'
      + ' in the project folder');
  }
  const dest = resolveDest(opts);
  const engineName = path.basename(zip, '.zip');

  // THE ENGINE IS EXTRACTED ONCE. Re-extracting 60MB on every export to change
  // a character is wasteful, so it is redone only when the folder has no engine
  // or a DIFFERENT one - which is also what makes dropping in the next rc work:
  // the stamp changes, so the engine is replaced rather than half-updated.
  const stampFile = path.join(dest, 'save', '.engine');
  const have = fs.existsSync(stampFile) ? fs.readFileSync(stampFile, 'utf8').trim() : null;
  let extracted = false;
  // An export folder that still carries the 2026-09-13 TEXT patches to the
  // stock scripts (main.lua/start.lua/training.zss, superseded the same day by
  // the sandbox's own files) goes back to the zip, so the scripts are stock.
  const stalePatch = (() => {
    try {
      const m = fs.readFileSync(path.join(dest, 'external', 'script', 'main.lua'), 'latin1');
      const z = fs.readFileSync(path.join(dest, 'data', 'training.zss'), 'latin1');
      return /Simul on the dummy side too \(Mugen Studio\)/.test(m) || /# Scene Viewer sandbox: facing lock-on/.test(z);
    } catch (e) { return false; }
  })();
  if (stalePatch) console.log('desktop: export folder carries superseded script patches - re-extracting the engine');
  if (have !== engineName || stalePatch || !fs.existsSync(path.join(dest, 'Ikemen_GO.exe'))) {
    rmrf(dest);
    fs.mkdirSync(dest, { recursive: true });
    // THE PATHS GO IN AS DATA, through the environment (modlib's extractZip
    // does the same, and says why). Pasted into the command text, a folder
    // named D:\Games\$Mugen became D:\Games\ - PowerShell expands $Mugen to
    // nothing - so the engine unpacked into the PARENT folder, over whatever
    // was there, after the real one had just been emptied.
    execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command',
      "$ProgressPreference = 'SilentlyContinue'; Expand-Archive -LiteralPath $env:MS_ZIP -DestinationPath $env:MS_DEST -Force"], {
      env: Object.assign({}, process.env, { MS_ZIP: String(zip), MS_DEST: String(dest) }),
      windowsHide: true,
    });
    if (!fs.readdirSync(dest).length) {
      throw new Error('The engine zip unpacked to nothing: ' + zip + '. It may be damaged - download it again.');
    }
    // Some releases wrap everything in one folder; flatten it if so.
    const top = fs.readdirSync(dest);
    if (top.length === 1 && fs.statSync(path.join(dest, top[0])).isDirectory()) {
      const inner = path.join(dest, top[0]);
      for (const e of fs.readdirSync(inner)) {
        fs.renameSync(path.join(inner, e), path.join(dest, e));
      }
      fs.rmdirSync(inner);
    }
    extracted = true;
  }

  // ---- the roster's characters -------------------------------------------
  // Cleared first: a character removed from the roster has to leave the build
  // too, and copying over the top would keep it for ever.
  const charsDir = path.join(dest, 'chars');
  rmrf(charsDir);
  fs.mkdirSync(charsDir, { recursive: true });
  // ONLY WHAT THE CHARACTER ACTUALLY LOADS. cache/ is a working directory, not
  // a shipping one: every palette and portrait fix leaves a full .sff or .cns
  // backup beside the original, and on this roster that alone is 252MB of the
  // 776MB there. The web build has always filtered these out; the desktop
  // export was copying the lot, which is most of why it came out at 914MB
  // against the website's 514MB. Same filter, same result.
  const copied = copyCharacters(roster, CACHE, charsDir);
  let chars = copied.chars, files = copied.files;
  const charFixes = fixCopiedCharacters(copied.copied);
  // One line for MUGEN's hit priority: it touches most characters' files.
  const hitPrio = charFixes.filter((c) => c.kind === 'mugen-hit-priority');
  if (hitPrio.length) {
    console.log('desktop: MUGEN\'s HitDef default (p1sprpriority = 1) written into ' + hitPrio.reduce((n, c) => n + c.hitdefs, 0)
      + ' HitDefs in ' + hitPrio.length + ' state files of MUGEN-authored characters');
  }
  // And one for the MUGEN AI switches released under player control (ailatch.js).
  const aiSwitch = charFixes.filter((c) => c.kind === 'ai-switch-release');
  if (aiSwitch.length) {
    console.log('desktop: MUGEN AI switch released under player control in ' + aiSwitch.length + ' state files ('
      + aiSwitch.map((c) => c.file.split('/')[1]).join(', ') + ')');
  }
  // And one for the pause menu's Command List (cmdlist.js).
  const cmdLists = charFixes.filter((c) => c.kind === 'command-list');
  if (cmdLists.length) {
    console.log('desktop: the pause menu\'s Command List written for ' + cmdLists.length + ' characters ('
      + cmdLists.reduce((n, c) => n + c.moves, 0) + ' moves)');
  }
  for (const c of charFixes) {
    // Every kind this loop does not name falls through to the last branch,
    // which reads the Plus-frames repair's fields - a new kind must be named
    // here (a missing one failed the export with "reading 'length'").
    if (c.kind === 'mugen-hit-priority' || c.kind === 'ai-switch-release' || c.kind === 'command-list') continue;
    if (c.kind === 'palettes') console.log('desktop: ' + c.file + ' palettes added: ' + (c.slots.join(', ') || 'none') + (c.skipped.length ? ' (skipped ' + c.skipped.map((s) => s.slot + ': ' + s.why).join('; ') + ')' : ''));
    else if (c.kind === 'portrait-fit') console.log('desktop: ' + c.file + ' portraits fitted to this screenpack: ' + c.slots.map((s) => s.slot + ' ' + s.w + 'x' + s.h).join(', '));
    else if (c.kind === 'palette-order') console.log('desktop: ' + c.file + ' palette slots renumbered: ' + c.moved + ' moved');
    else if (c.kind === 'v2-own-palettes') console.log('desktop: ' + c.file + ' pal' + c.slots.join(', pal') + ' commented out: the sprite file has its own, which this engine would draw the def\'s files over');
    else if (c.kind === 'v1-base-palette') {
      const said = [];
      if (c.replaced > 0) said.push('base palette written as pal1 (' + c.replaced + ' palettes), so the select screen hovers in the character\'s own colors');
      for (const a of (c.axis || [])) said.push('select portrait ' + a.sprite + ' re-anchored from ' + a.from.join(',') + ' to 0,0, so it draws in its own cell');
      if (said.length) console.log('desktop: ' + c.file + ' ' + said.join('; '));
    }
    else if (c.kind === 'plus-frames' || c.links !== undefined) console.log('desktop: ' + c.file + ' repaired: ' + c.links + ' linked sprites added'
      + (c.unfixable && c.unfixable.length ? ', ' + c.unfixable.length + ' frames have no art to stand in' : ''));
    else console.log('desktop: ' + c.file + ' fixed in the build\'s copy (' + c.kind + ')');
  }

  // ---- stages and music ---------------------------------------------------
  // Added to what the engine ships rather than replacing it: the stock kfm and
  // training stages are what its stock characters reference.
  // Stages sit flat in one directory, so the allowlist is by vpath rather than
  // by folder. A stage's 3D model ships with it (the def's `model =`, and a
  // .gltf's own buffers and images: stageKeepFilter), here as in the web build.
  const stageKeep = vfslib.stageKeepFilter(roster.stages || []);
  files += copyDir(layout.dir('stages'), path.join(dest, 'stages'), null, null,
    (rel) => stageKeep.has(('stages/' + rel).toLowerCase()));
  const stageFixes = fixStagesForOfficialEngine(layout.dir('stages'), path.join(dest, 'stages'),
    (rel) => stageKeep.has(('stages/' + rel).toLowerCase()));
  for (const s of stageFixes) {
    console.log('desktop: ' + s.file + ' adjusted for the official engine: '
      + s.fixes.map((f) => f.kind).join(', '));
  }
  files += copyDir(layout.dir('music'), path.join(dest, 'sound'));

  // ---- the Training sandbox: Scene Viewer, Lock-On, team menus ------------
  // Everything the sandbox needs goes in as FILES OF ITS OWN, never as edits
  // to the engine's scripts ("what's wrong with making them Luas in the mod
  // folder that users can delete if they want?" - 2026-09-13). Every add-on's
  // .lua sits in one folder, external/mods/mugen-studio/ (modmgr.js), beside
  // the mods a player adds:
  //   mugen-studio/sceneviewer.lua     the Scene Viewer, generated from the
  //                                    roster, web-build marker stripped
  //   mugen-studio/training-team.lua   Simul on the dummy side, and no AI for
  //                                    anyone the training menu did not set -
  //                                    wrappers around main.t_itemname.training
  //                                    and start.f_remapAI, which exist by the
  //                                    time mods load (main.lua loads them last)
  //   mugen-studio/team-play.lua       the CPU team starts at the player's team
  //                                    size, and in an add004 tag build a human
  //                                    side drives the partner it tags in
  //                                    (teamplay.js; the website ships the same)
  //   mugen-studio/select-announcer.lua  mugenhook's per-cell select clips,
  //                                    only for a bundle that has the table
  //                                    (selectann.js), removed otherwise
  //   mugen-studio/net-menu.lua        PRESS N FOR ONLINE on every screenpack's
  //                                    title and its NETWORK box (netmenu.js;
  //                                    the website ships the same, its online
  //                                    items only there)
  //   data/sceneviewer.zss             the Lock-On facing hook, a [StateDef -2]
  //                                    block in plain ZSS, listed in the config
  //                                    as [Common] States1
  //   mugen-studio/hgallery.lua        the H GALLERY title-menu mode, and its
  //   data/hgallery.zss                hook as [Common] States7 - only in a
  //                                    build in H-Mugen mode with a pair to
  //                                    show, and removed from one without
  //                                    (gallery.js)
  // The stock engine loads every .lua under external/mods, at any depth
  // (main.lua's getDirectoryFiles walk; the zip ships the folder with a
  // .keep), and Common.States is a keyed map (config.go `map:^States[0-9]*$`,
  // merged per key with the defaults), so States1 adds our file without
  // restating the engine's own list. Delete the two .lua files to remove the
  // sandbox; the .zss is inert without the mod (it acts only while
  // map(_sv_target) is set), and to drop it as well remove the States1 line
  // from save/config.ini - a LISTED file that is missing fails character
  // loading. See sandboxAssets for the texts.
  //
  // The bundle's Mods tab can switch each add-on off (roster.modsOff): the
  // generated layer then has none of it, and sandboxAssets drops the
  // sandbox's own files too, so the hook and its config line go with them.
  let sandbox = null;
  let legacyRemoved = [];
  {
    const assets = sandboxAssets(generated, path.join(layout.IKEMEN_SRC, 'data', 'training.zss'), roster);
    const synced = syncSandboxFiles(dest, assets);
    files += synced.written;
    sandbox = synced.sandbox;
    legacyRemoved = synced.legacyRemoved;
    if (legacyRemoved.length) {
      console.log('desktop: the Studio\'s add-ons moved into external/mods/mugen-studio/ - removed ' + legacyRemoved.length
        + ' loose copies an earlier export left in external/mods (' + legacyRemoved.map((v) => v.split('/').pop()).join(', ') + ')');
    }
  }

  // ---- the roster itself --------------------------------------------------
  // With the lock labels: an install is where VSelect, or a later build
  // import, reads them back (GRAIL 3.1b).
  const selectDef = vfslib.buildSelectDef(roster, { locks: true });
  writeOut(path.join(dest, 'data', 'select.def'), selectDef);

  // ---- the screenpack -----------------------------------------------------
  // Only the one in use, for the same reason the web export ships one: a build
  // has its motif fixed and the others are download nobody can reach.
  // A roster with no motif keeps the ENGINE ZIP's own ikemen1 (release-v2's
  // copy is the website's, with its own welcome text and layout); what the
  // build needs changed in it is edited in place below, the fight key first.
  // The folder is spelled as the disk spells it: the generated layer is keyed
  // by the disk's names, and a roster may carry another spelling.
  const motif = String(roster.motif || '').replace(/^data\//, '');
  const rawFolder = motif.split('/')[0];
  let folder = rawFolder;
  if (roster.motif && rawFolder && rawFolder !== 'system.def') {
    try { folder = require('./lifebars.js').motifFolderOf(roster) || rawFolder; } catch (e) { folder = rawFolder; }
  }
  let screenpack = null;
  // THE LIFEBAR MIX's own folders (lifebars.staleDirs: studio-lifebar/ and
  // the studio-parts/ beside the screenpack's fight def), emptied BEFORE the
  // screenpack is copied, whatever the mix is now: an earlier export's files
  // go, a screenpack that ships a folder of that name gets it back from the
  // copy, and the mix's files are laid over it below - the website build's
  // overlay, in the same order.
  let lbStale = [];
  try { lbStale = require('./lifebars.js').staleDirs(roster); } catch (e) { lbStale = []; }
  // The screenpack's own fight def path too: an earlier export may have
  // written an edited or composed copy there (lifebar.buildOverride) that this
  // one does not; the copy below puts back a file the pack itself ships.
  try {
    const fr = require('./lifebar.js').resolveScreenpack(roster).fightRel;
    if (fr && folder && folder !== 'system.def') lbStale.push('data/' + folder + '/' + String(fr).replace(/\\/g, '/'));
  } catch (e) { /* no screenpack def */ }
  const clearLifebarMix = (inFolder, extra) => {
    if (!inFolder || inFolder === '.' || inFolder.toLowerCase() === 'data') return;
    for (const vp of [...lbStale, ...(extra || [])]) {
      const rel = String(vp).replace(/^data\/[^/]+\//, '');
      if (!rel || rel.split('/').includes('..')) continue;
      rmrf(path.join(dest, ...(inFolder + '/' + rel).split('/')));
    }
  };
  if (folder && folder !== 'system.def') clearLifebarMix('data/' + folder);
  if (folder && folder !== 'system.def') {
    for (const base of [THEMES, path.join(layout.dir('release-v2'), 'data'),
      path.join(layout.dir('release'), 'data')]) {
      const src = path.join(base, folder);
      if (fs.existsSync(path.join(src, 'system.def'))) {
        // PREFER THE GENERATED MOTIF. A screenpack's own system.def names the
        // music it shipped with - ikemen1 asks for sound/Title.mp3 and
        // sound/Select.mp3 - and vfslib rewrites those to whatever the roster
        // actually assigns before the web build sees them. Copying the file off
        // disk shipped the original names, so a desktop build pointed its menu
        // and character-select music at files that were never in it and played
        // nothing. The roster's choice is the build's, in both products.
        // NOT THE WEB BUILD'S LOGO. release-v2/data/ikemen1 is the web build's
        // copy of the engine's own screenpack, with one deliberate change: the
        // engine's video boot logo (ik_logo.webm) is swapped for a sprite one
        // (logo.def + logo.sff) because a browser cannot play the video. Copying
        // the folder wholesale put the web build's branded boot logo into every
        // desktop export, over the engine's own. For the engine-release sources
        // the logo/intro storyboards are left out, so the engine's stay; a
        // screenpack the user added under themes/ ships whole - its logo is
        // theirs. A logo the user REPLACED (Content/<bundle>/logo/) is laid on
        // afterwards, below.
        const fromEngineRelease = base !== THEMES;
        // A pack with a manifest (themeopts.js) ships what the website build
        // ships: not the manifest, not its own state files the config does not
        // list. Null for any other pack, which ships whole as before.
        let themeKeep = null;
        if (!fromEngineRelease) { try { themeKeep = require('./themeopts.js').shipFilter(src, roster); } catch (e) { themeKeep = null; } }
        files += copyDir(src, path.join(dest, 'data', folder), 'data/' + folder + '/', generated,
          fromEngineRelease ? (rel) => !/^(logo|intro)\.[^/]+$/i.test(rel) : themeKeep);
        screenpack = folder;
        break;
      }
    }
  }

  // ---- an earlier export's Command List font line ---------------------------
  // A motif this export did NOT just write (the engine zip's own, unpacked
  // only when the engine changes, edited in place below) may still point the
  // Command List at DotGothic16 from an earlier export into this folder
  // (jpfont.js, the font section further down). It goes back to the engine
  // zip's copy HERE, before anything below edits it in place (the fight key,
  // the boot logo), so those edits land on the clean file and the font
  // section re-adds the line only when this build needs it. A motif the
  // screenpack copy above wrote is this export's own (vfslib's generated
  // copy, with the roster's menu music, its lifebar and the font line when
  // this build needs it) and is never replaced.
  {
    const rel = motifInBuild(dest, screenpack);
    const abs = rel ? path.join(dest, ...rel.split('/')) : null;
    let stale = false;
    // ...or the Command List's buttons at an earlier export's style (buttonstyle.js, below)
    let staleFont = false;
    try { if (abs && !WRITTEN.has(writtenKey(abs))) { const t = fs.readFileSync(abs, 'latin1'); staleFont = /^font\d+ = DotGothic16\.def ;/m.test(t); stale = staleFont || require('./buttonstyle.js').patched(t); } } catch (e) { stale = false; }
    if (stale) {
      const z = zip ? zipRead(zip, [rel], dest) : null;
      const orig = z && z.files && z.files.get(rel.toLowerCase());
      if (orig) writeOut(abs, orig);
      else if (staleFont) console.log('desktop: ' + rel + ' still points the Command List at DotGothic16 from an earlier export, and the engine zip has no copy of it to put back');
      else console.log('desktop: ' + rel + ' still names an earlier export\'s Command List buttons, and the engine zip has no copy of it to put back');
    }
  }

  // ---- the build's own lifebars --------------------------------------------
  //
  // lifebar.js keeps the copy in the bundle's content, under the motif it
  // belongs to. It lands in the motif's own folder in the build, which is the
  // FIRST place the engine looks for the file the motif's `fight` key names -
  // so the engine's own data/fight.def and the screenpack's own copy are both
  // left exactly as they came out of the zip.
  //
  // Written AFTER the screenpack copy above, because that copy would overwrite
  // it, and cleared when there is no override so a re-export cannot leave a
  // stale one behind.
  {
    const lifebar = require('./lifebar.js');
    let own = null;
    try { own = lifebar.buildOverride(roster); } catch (e) { own = null; }
    // The motif folder in the build is not always the one the roster names -
    // motifInBuild picks what the engine actually unpacked - so the override
    // goes beside the system.def the config will point at.
    const inBuild = motifInBuild(dest, screenpack);
    // THE LIFEBAR MIX (lifebars.js): a lifebar from the bundle's library lands
    // in data/<motif>/studio-lifebar/, swapped hit sparks and sounds under
    // studio-parts/ beside the def that names them. The same vpaths as the
    // website build; each folder is emptied first (above, before the
    // screenpack copy), so switching back or choosing another lifebar leaves
    // nothing of the old one behind. The system.def that points `fight` at it
    // arrives with the generated motif.
    {
      const spFolder = path.posix.dirname(String(inBuild || '').replace(/\\/g, '/'));
      const own2 = own && own.mixed ? own.mixed : null;
      const toBuild = (vp) => {
        const rel = String(vp).replace(/^data\/[^/]+\//, '');
        return spFolder && spFolder !== '.' && spFolder.toLowerCase() !== 'data' ? path.join(dest, ...(spFolder + '/' + rel).split('/')) : null;
      };
      // The engine's own motif (no screenpack copied) was not cleared above:
      // its folder is only known now. The engine release never ships these
      // folders, so clearing after the zip's files is safe there.
      if (!screenpack) {
        const lbs = require('./lifebars.js');
        clearLifebarMix(spFolder, [spFolder + '/' + lbs.MOUNT_DIR, spFolder + '/' + lbs.PARTS_DIR].concat(own2 ? own2.clean : []));
        // Its system.def is the zip's, not a generated one: the fight key is
        // set in place - the library lifebar's, or back to the engine's own
        // name when an earlier export pointed it at one.
        const sysAbs = inBuild ? path.join(dest, ...String(inBuild).split('/')) : null;
        if (sysAbs && fs.existsSync(sysAbs)) {
          const was = fs.readFileSync(sysAbs, 'latin1');
          const k = require('./lifebar.js').readDef(was).keys.get('files|fight');
          const cur = k ? String(k.raw).trim() : null;
          const want = own2 && own2.fightKey ? own2.fightKey
            : (cur && cur.toLowerCase().startsWith(lbs.MOUNT_DIR + '/') ? 'fight.def' : null);
          if (want && want !== cur) writeOut(sysAbs, Buffer.from(lbs.setMotifFight(was, want), 'latin1'));
        }
      }
      if (own2) {
        for (const f of own2.files) {
          const p = toBuild(f.vpath);
          if (!p) continue;
          fs.mkdirSync(path.dirname(p), { recursive: true });
          copyOut(f.abs, p);
          files++;
        }
      }
    }
    // res.fightRel is always relative to the motif folder: the screenpack's
    // fight key, 'studio-lifebar/<def>' for a library lifebar, and 'fight.def'
    // for a screenpack at the data/ root.
    const vpath = lifebarTarget(inBuild, own ? own.res.fightRel : 'fight.def');
    if (own && !vpath) {
      console.log('desktop: this build’s screenpack sits at the data/ root, which is also where the'
        + ' engine’s own ' + path.basename(own.res.fightRel) + ' lives - the lifebar override is not'
        + ' written into this export. Put the screenpack in a folder of its own to use it.');
    }
    const target = own && vpath ? path.join(dest, vpath.replace(/\//g, path.sep)) : null;
    if (target) {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      writeOut(target, Buffer.from(own.text, 'latin1'));
      files++;
    }
    // The engine's own motif: an edited or composed def an earlier export wrote
    // at its fight path goes when this one writes it elsewhere or not at all.
    if (!screenpack) {
      let stock = null;
      try { stock = lifebarTarget(inBuild, require('./lifebar.js').resolveScreenpack(roster).fightRel); } catch (e) { stock = null; }
      if (stock && stock !== (target ? vpath : null)) {
        const names = new Set((require('./enginezip.js').zipEntries(zip) || []).map((n) => String(n).replace(/\\/g, '/').toLowerCase()));
        const inZip = [...names].some((n) => n === stock.toLowerCase() || n.endsWith('/' + stock.toLowerCase()));
        const abs = path.join(dest, ...stock.split('/'));
        if (!inZip && fs.existsSync(abs)) removeFile(abs);
      }
    }
    if (!target && screenpack && vpath) {
      const stale = path.join(dest, vpath.replace(/\//g, path.sep));
      // Only a copy THIS exporter put there: a pack that ships its own
      // fight.def inside its folder keeps it.
      const relInPack = vpath.split('/').slice(2);
      const packOwn = THEMES && fs.existsSync(path.join(THEMES, screenpack, ...relInPack));
      if (!packOwn && fs.existsSync(stale)) rmFile(stale);
    }
  }

  // ---- the build's own game-wide constants ---------------------------------
  //
  // engineconst.js writes the file in the bundle's content; it lands here as a
  // SECOND const file beside the engine's own, listed after it. The engine's
  // data/common.const - which the zip unpacked and the next engine version
  // will replace - is never touched, and the override states only the keys
  // this build changed.
  //
  // Cleared when there are none, so a re-export into a folder that carried an
  // override and no longer should does not leave one behind. The config line
  // goes with it: a listed const file that is missing fails character loading.
  const engineconst = require('./engineconst.js');
  let ownConsts = null;
  try { ownConsts = engineconst.buildOverrides(); } catch (e) { ownConsts = null; }
  const ownConstPath = path.join(dest, engineconst.BUILD_CONST_VPATH);
  if (ownConsts) {
    fs.mkdirSync(path.dirname(ownConstPath), { recursive: true });
    writeOut(ownConstPath, Buffer.from(ownConsts.text, 'latin1'));
    files++;
  } else if (fs.existsSync(ownConstPath)) {
    rmFile(ownConstPath);
  }

  // ---- the build's own common states ---------------------------------------
  //
  // A bundle imported from a whole MUGEN build carries that build's own
  // common1.cns. It rides in exactly the way the const file above does - a
  // second key of the [Common] map, its file beside the engine's own rather
  // than over it - and under a name that is NOT common1.cns, because that is
  // the name every MUGEN character's `stcommon` line asks for and answering it
  // would displace the engine's own common states for the whole build. See
  // buildimport.js for the compile order this rides on and what it costs.
  const buildimport = require('./buildimport.js');
  let ownStates = null;
  try { ownStates = buildimport.buildStates(); } catch (e) { ownStates = null; }
  const ownStatesPath = path.join(dest, buildimport.BUILD_STATES_VPATH);
  if (ownStates) {
    fs.mkdirSync(path.dirname(ownStatesPath), { recursive: true });
    writeOut(ownStatesPath, ownStates.text);
    files++;
  } else if (fs.existsSync(ownStatesPath)) {
    rmFile(ownStatesPath);
  }
  // And the [Common] files of an Ikemen GO build it was imported from, under
  // data/build/ - a folder that is entirely this export's, emptied first so a
  // previous bundle's files never linger beside this one's.
  let ownCommon = null;
  try { ownCommon = buildimport.buildCommon(); } catch (e) { ownCommon = null; }
  // A build state file this engine would not compile gave way to the engine's
  // own (buildimport checkOwnStates); said here and on the result card.
  for (const l of (ownCommon && ownCommon.report) || []) console.log('desktop: ' + l);
  const buildDir = path.join(dest, ...buildimport.BUILD_COMMON_VDIR.split('/'));
  rmrf(buildDir);
  if (ownCommon) {
    fs.mkdirSync(buildDir, { recursive: true });
    for (const f of ownCommon.files) { writeOut(path.join(dest, ...f.vpath.split('/')), f.text); files++; }
  }

  // ---- config -------------------------------------------------------------
  // Partial on purpose: the engine fills in every key it does not find, so this
  // says only what this build actually decides.
  const saveDir = path.join(dest, 'save');
  fs.mkdirSync(saveDir, { recursive: true });
  // WHAT CARRIES ACROSS AND WHAT MUST NOT.
  //
  // The engine merges a partial config into its own defaults - it kept our
  // Motif and filled in the other 550 lines itself - so this says only what
  // this build actually decides, and every line it does say has to be true
  // natively. The controls do: the stock [Keys_P1] takes the same names and values
  // ours does, so the bindings you set in the Studio are the bindings you get.
  //
  // Most of the web config does NOT. `RenderMode = WebGL 2` is meaningless to a
  // native renderer, the debug font is a bitmap face chosen because browsers
  // cannot draw the TrueType default, EnableModelShadow = 0 exists because the
  // WebGL renderer draws no model shadows, and the whole Netplay block is our rollback
  // build. Copying those over would be shipping browser workarounds to a
  // desktop that does not need them.
  // The sections keylib decides for this build, which is the two keyboard
  // layouts plus anything bound in Settings > Controls. A slot nobody touched
  // is not listed and therefore not written, so the engine's own default for
  // it stands - which is the whole reason a partial config works at all
  // (config.go:311-315).
  const carry = keylib.sectionsWritten(roster.keys, vfslib.playersOf(roster));
  // EVERY key this build owns, not only the overridden ones - see the note on
  // settingsFor. Anything the panel can set, the exported config states.
  const settings = require('./settings-schema').settingsFor(roster.settings, 'desktop', true);
  //
  // FirstRun MUST BE 0 OR THE CONTROLS ARE THROWN AWAY BEFORE THE PLAYER SEES A
  // MENU. The stock zip ships FirstRun = 1 (rc.5 and 1.0.0 embed the same
  // defaultConfig.ini, checked 2026-09-12); options.lua runs f_keyDefault() at module
  // load when it is set, which calls uiSetConfigDefaults and rewrites every
  // Keys_P<n> and Joystick_P<n> button from the engine's own table, then saves.
  // Measured on the shipped export: our w/s/a/d + k/l/SEMICOLON came back as
  // UP/DOWN/LEFT/RIGHT + z/x/c, and the 39-line file came back as 543. Motif and
  // MasterVolume survived, because first-run only touches input - which is
  // exactly what made it look like the config was being honored.
  //
  // The web build has always set this (vfslib's save/config.json, with the same
  // note); the fix simply never reached this product.
  const lines = [];
  //
  // Sections are COLLECTED rather than appended, because the engine's ini reader
  // is first-wins on a repeated key: emitting [Sound] twice - once carried from
  // the web config, once from the settings panel - would quietly hand the win to
  // whichever was written first instead of to the deliberate choice.
  // THE THREE THE PLAYER OWNS ONCE THEY HAVE SET THEM.
  //
  // The Studio owns every key its panel exposes - that is what makes the
  // exported config equal what the panel shows. These three are the exception,
  // and the engine's own options menu is what defines them: options.lua:205-208
  // adjusts exactly Sound.MasterVolume, Sound.WavVolume and Sound.BGMVolume,
  // and deliberately leaves PauseMasterVolume and MaxBGMVolume commented out.
  // A volume slider a player moved in game is theirs.
  //
  // "Preserve if PRESENT", not "never write": a fresh folder has no player
  // preference to protect, so a first export still states the panel's choice.
  // Only an existing line is left alone.
  const PLAYER_OWNED = new Set([
    'Sound.MasterVolume', 'Sound.WavVolume', 'Sound.BGMVolume',
  ]);

  const bySec = new Map();
  const put = (sec, key, val) => {
    if (!bySec.has(sec)) bySec.set(sec, new Map());
    bySec.get(sec).set(key, val);
  };

  // THE SCREENPACK IS A DECISION THIS BUILD MAKES, so it goes through `bySec`
  // like every other key the build decides - which is the whole point.
  //
  // It used to live in `lines`, and `lines` is only used when the destination
  // has NO config yet. So exporting over an existing build never rewrote
  // `Motif`: you could change the screenpack in the Studio, export to the same
  // folder, and the old one was still there, because save/config.ini kept the
  // line it already had. A fresh folder looked correct and the folder you
  // actually use did not, which is the worst shape a bug can have.
  //
  // Same fault as Debug.Font carrying a dead font path into every re-export:
  // preserving the player's file is right, but a key the BUILD owns is not the
  // player's to keep. Put first, so [Config] leads the file the way it did.
  put('Config', 'Motif',
      motifInBuild(dest, screenpack));
  put('Config', 'FirstRun', '0');
  // The Lock-On hook rides beside the engine's own common states, not inside
  // them: States1 is a second key of the same map (see the sandbox note).
  if (sandbox && sandbox.hook) put('Common', 'States1', sandbox.hook);
  // The H gallery's hook the same way, under a key of its own.
  const gallery = require('./gallery.js');
  if (sandbox && sandbox.galleryHook) put('Common', gallery.GALLERY_STATES_KEY, sandbox.galleryHook);
  // Const1 rides the same way: a second key of the same map, sorted after the
  // engine's own Const, so its keys win and everything it leaves out keeps the
  // engine's value (char.go:3967-3983, common.go:1629-1644).
  if (ownConsts) put('Common', engineconst.BUILD_CONST_KEY, engineconst.BUILD_CONST_VPATH);
  // And an imported build's own common states, the same way.
  if (ownStates) put('Common', buildimport.BUILD_STATES_KEY, buildimport.BUILD_STATES_VPATH);
  try {
    const web = (generated['save/config.ini'] || '').toString('latin1').split(/\r?\n/);
    const vol = web.find((l) => /^\s*MasterVolume\s*=/i.test(l));
    if (vol) put('Sound', 'MasterVolume', vol.split('=').slice(1).join('=').trim());
    let on = null;
    for (const l of web) {
      const sec = /^\s*\[([^\]]+)\]/.exec(l);
      if (sec) { on = carry.includes(sec[1]) ? sec[1] : null; continue; }
      const kv = on && /^\s*([^=;#\[][^=]*?)\s*=\s*(.*)$/.exec(l);
      if (kv) put(on, kv[1], kv[2].trimEnd());
    }
  } catch (e) { /* no web config to carry from: the engine's defaults stand */ }

  // THE SETTINGS PANEL IS THE LAST WORD, and for a reason: it is the only
  // surface where a value was chosen FOR this product. `applies` keeps the two
  // apart in both directions - a native build has no use for a browser
  // workaround, and Fullscreen means nothing to a canvas.
  for (const st of settings) put(st.sec, st.key, st.val);
  // AN IKEMEN GO BUILD'S OWN LISTS go on the BASE keys, over the engine's -
  // and AFTER the settings, because the desktop set is written complete:
  // settings-schema carries Common.States, Air, Cmd and Fx with the engine's
  // defaults, and put earlier the build's lines were overwritten by those
  // defaults on the way out (the web build writes only overridden settings,
  // which is why it had the build's systems and the desktop export did not).
  // A value the Settings page set for one of these keys on purpose still
  // wins: that is the one surface where a choice was made for this product.
  //
  // A SCREENPACK'S OWN COMMON STATES the same way (themecommon.js, the website
  // build's answer): its States worked out from the build's, so it stands in
  // for it, and its added systems on States3. Its debug font too, while a
  // listed file draws with font -1 - unless Settings chose one.
  let themeCommon = null;
  try { themeCommon = require('./themecommon.js').forRoster(roster, { ownCommon }); } catch (e) { themeCommon = null; }
  const commonLines = themeCommon && themeCommon.lines.length
    ? require('./themecommon.js').mergeLines(ownCommon ? ownCommon.lines : [], themeCommon.lines)
    : (ownCommon ? ownCommon.lines : []);
  {
    const chosen = (roster.settings || {});
    for (const l of commonLines) if (chosen['Common.' + l.key] === undefined) put('Common', l.key, l.value);
    if (themeCommon && themeCommon.debugFont && chosen['Debug.Font'] === undefined) put('Debug', 'Font', themeCommon.debugFont.vpath);
  }

  // WHAT HAPPENS ON THE SECOND EXPORT.
  //
  // The engine merges a partial config into its own defaults exactly ONCE: our
  // 51 lines went in and 559 came back out, because it saves the whole resolved
  // set on exit. Everything the player then changes in-game - their volume, a
  // key they remapped from the pause menu, the AI level they settled on - lives
  // in that file and nowhere else.
  //
  // So re-exporting must not hand back the 51-line file. Doing that silently
  // reverted every in-game change the player had made, which is a strange thing
  // for a CONTENT manager to do to someone's settings. Instead the keys this
  // build actually decides are written INTO the existing config, in place, and
  // everything else is left exactly as the player left it. The Studio still
  // wins on the keys it names - it is the build's authority - it just no longer
  // has an opinion about the several hundred it was never asked about.
  const cfgPath = path.join(saveDir, 'config.ini');
  let cfg;
  const prior = fs.existsSync(cfgPath) ? fs.readFileSync(cfgPath, 'latin1') : null;
  if (prior && /\[Config\]/i.test(prior)) {
    const out = prior.split(/\r?\n/);
    for (const [sec, kv] of bySec) {
      let at = out.findIndex((l) => new RegExp('^\\s*\\[' + sec + '\\]\\s*$', 'i').test(l));
      if (at < 0) { out.push('', '[' + sec + ']'); at = out.length - 1; }
      let end = at + 1;
      while (end < out.length && !/^\s*\[[^\]]+\]\s*$/.test(out[end])) end++;
      for (const [k, v] of kv) {
        // Replace only the VALUE, so the engine's own column alignment survives
        // and the file still reads like the one it wrote.
        const re = new RegExp('^(\\s*' + k.replace(/[.]/g, '\\.') + '\\s*=\\s*).*$', 'i');
        let hit = -1;
        for (let i = at + 1; i < end; i++) if (re.test(out[i])) { hit = i; break; }
        // Already in the destination AND the player's to set: leave it.
        if (hit >= 0 && PLAYER_OWNED.has(sec + '.' + k)) continue;
        if (hit >= 0) out[hit] = out[hit].replace(re, '$1' + v);
        else { out.splice(end, 0, k + ' = ' + v); end++; }
      }
    }
    cfg = out.join('\r\n');
    if (!cfg.endsWith('\r\n')) cfg += '\r\n';
  } else {
    for (const [sec, kv] of bySec) {
      lines.push('', '[' + sec + ']');
      for (const [k, v] of kv) lines.push(k + ' = ' + v);
    }
    // `lines` opens with the separator that used to sit between [Config] and
    // the first carried section; with Config now coming from bySec there is
    // nothing before it to separate.
    while (lines.length && lines[0] === '') lines.shift();
    cfg = lines.join('\r\n') + '\r\n';
  }
  // THE SANDBOX HOOK LINE MUST MATCH THE FILE - see stripStates1Line.
  cfg = stripStates1Line(cfg, !!(sandbox && sandbox.hook));
  // And the H gallery's hook line, when this build has no gallery.
  cfg = stripCommonLine(cfg, gallery.GALLERY_STATES_KEY, gallery.GALLERY_ZSS_VPATH, !!(sandbox && sandbox.galleryHook));
  // And so must the build's own const file, for the same reason.
  cfg = stripCommonLine(cfg, engineconst.BUILD_CONST_KEY, engineconst.BUILD_CONST_VPATH, !!ownConsts);
  // And an imported build's own common states: a LISTED states file that is
  // not in the build fails every character, so the line goes when the file does.
  cfg = stripCommonLine(cfg, buildimport.BUILD_STATES_KEY, buildimport.BUILD_STATES_VPATH, !!ownStates);
  // And an Ikemen GO build's lists on the base keys: the same rule, and the
  // engine's own default for each key stands again once the line is gone.
  cfg = stripBuildLines(cfg, !!ownCommon);
  // And the screenpack's added systems, keyed on their own reserved key.
  cfg = stripThemeStatesLine(cfg, !!(themeCommon && themeCommon.lines.some((l) => l.key === require('./themeopts.js').THEME_STATES_KEY)));
  // A PRESERVED CONFIG MUST NOT BE ALLOWED TO CARRY A BOOT-TIME KILL.
  //
  // Keeping the player's file (above) is right, but it means every value this
  // build does not name survives forever - including ones that stop the engine
  // starting at all. Debug.Font is the sharp one: main.lua:642 calls
  // loadDebugFont(Debug.Font, ...), loadFnt raises a Lua error from the
  // top-level chunk, and src/main.go panics on any DoFile error. The result is
  // a modal "Engine error ... File not found" before a single frame, from a
  // key nobody remembers setting, in a file the exporter deliberately does not
  // reset - so re-exporting cannot clear it and only a new folder appears to
  // "fix" it.
  //
  // Found the hard way: a folder was carrying `font/should-not-reach-web.def`,
  // a test sentinel, and every export into it produced an unbootable build.
  //
  // So: if the font the config asks for is not in the build, put the engine's
  // own default back and SAY SO. Checked against what was actually exported,
  // not against a list of names.
  const repaired = [];
  const fontRe = /^(\s*Font\s*=\s*)(.+?)\s*$/im;
  const fm = fontRe.exec(cfg);
  if (fm && !fs.existsSync(path.join(dest, fm[2].replace(/[\\]/g, '/')))) {
    const fallback = 'font/debug.def';
    if (fs.existsSync(path.join(dest, fallback))) {
      cfg = cfg.replace(fontRe, '$1' + fallback);
      repaired.push('Debug.Font was ' + fm[2] + ' - not in this build, reset to ' + fallback);
    }
  }

  writeOut(cfgPath, cfg, 'latin1');
  writeOut(stampFile, engineName);
  // Beside Ikemen_GO.exe and the zip's own LICENSES.txt (copyNotices).
  const licenses = copyNotices(dest, engineName);

  // ---- private-surface sweep ----------------------------------------------
  // data/ is never cleared: rmrf(dest) is gated on the engine stamp changing
  // and rmrf(charsDir) only takes chars/. So changing the roster's motif
  // STRANDS the previous screenpack folder in full, and a system.def written
  // by an older build keeps its injected NETWORK items for ever - fixing the
  // publicOnly bug above does not reach a file this export no longer writes.
  // Sweep every system.def in the output, not just the live one.
  // ---- a REPLACED startup logo --------------------------------------------
  // Content/<bundle>/logo/ (modlib.addLogo) holds a storyboard .def and its
  // art. It goes into the screenpack folder the build will actually load, and
  // logo.storyboard is pointed at the .def - both occurrences, since ikemen1
  // declares it twice. With nothing there, the engine's own logo plays.
  const logo = modlib.logoInfo();
  let logoNote = '(engine default)';
  // ---- the custom boot logo, in its OWN folder ------------------------------
  //
  // IT USED TO BE COPIED STRAIGHT INTO THE MOTIF FOLDER, which destroyed the
  // engine's own logo.def and logo.sff - same names - and there was no `else`
  // branch at all. So "use the default again" was advertised in the UI, did
  // nothing on a warm export folder, and the report still said
  // "(engine default)" while the custom logo kept playing. Worse, the engine's
  // originals were already gone, so there was nothing left to fall back TO.
  //
  // A subfolder fixes both halves: the engine's files are never touched, and
  // reverting is deleting one directory. A storyboard's own relative references
  // (`spr = logo.sff`) still resolve because SearchFile searches the def's own
  // directory first, which is how every other def finds its art.
  //
  // The web build needs none of this - vfslib rebuilds its VFS map from scratch
  // on every export, so it has no stale state to undo (vfslib.js:654-663).
  const motifRel = motifInBuild(dest, screenpack);            // data/ikemen1/system.def
  const spDir = path.join(dest, path.dirname(motifRel));
  const logoSub = path.join(spDir, STUDIO_LOGO_DIR);
  const sysDef = path.join(dest, motifRel);

  // Whatever a previous export left behind, in either shape.
  rmrf(logoSub);
  if (logo.custom) {
    fs.mkdirSync(logoSub, { recursive: true });
    for (const f of logo.files) { copyOut(path.join(logo.dir, f), path.join(logoSub, f)); files++; }
  }
  if (fs.existsSync(sysDef)) {
    const want = logo.custom ? STUDIO_LOGO_DIR + '/' + logo.def : 'logo.def';
    writeOut(sysDef, pointLogoStoryboard(fs.readFileSync(sysDef, 'latin1'), want, logo.custom), 'latin1');
  }
  if (logo.custom) logoNote = logo.def + ' -> ' + path.dirname(motifRel) + '/' + STUDIO_LOGO_DIR;

  // ---- the Command List's font (jpfont.js) ---------------------------------
  // Only when a list fixCopiedCharacters wrote prints a name the stock fonts
  // cannot draw and DotGothic16 can: font/DotGothic16.def at the size and
  // spacing of the font this build's motif draws the list in (the engine's
  // Open_Sans.def, 13,27, unless the pack names another), the font and its
  // license beside it, and the motif pointed at it - vfslib.build() already
  // pointed the generated motif the copy above wrote; a motif it did not
  // generate is pointed here. Otherwise none of it, and none left over from
  // an earlier export into this folder.
  let commandListFont = null;
  {
    const JP = require('./jpfont.js');
    const clNames = charFixes.filter((c) => c.kind === 'command-list').flatMap((c) => c.names || []);
    const outFiles = Object.values(JP.VPATHS).map((v) => path.join(dest, ...v.split('/')));
    if (clNames.length && JP.needed(clNames) && JP.available() && fs.existsSync(sysDef)) {
      let text = fs.readFileSync(sysDef, 'latin1');
      const fontName = String(JP.commandListFont(text) || '').replace(/\\/g, '/');
      const ours = fontName.toLowerCase() === JP.DEF_FILE.toLowerCase();
      // the font the list was drawn in: when vfslib already pointed the motif, the one it named before
      const orig = (ours ? (vfsListFont && vfsListFont.from) : fontName) || 'Open_Sans.def';
      const isFile = (f) => { try { return fs.statSync(f).isFile(); } catch (e) { return false; } };
      const found = [path.join(spDir, orig), path.join(dest, 'font', orig), path.join(dest, orig), path.join(dest, 'data', orig)].find(isFile);
      const metrics = (found && JP.fontMetrics(fs.readFileSync(found, 'latin1'))) || JP.DEFAULT_SIZE;
      for (const [vp, buf] of Object.entries(JP.files(metrics))) { writeOut(path.join(dest, ...vp.split('/')), buf); files++; }
      if (!ours) { text = JP.patchMotif(text).text; writeOut(sysDef, text, 'latin1'); }
      commandListFont = { def: JP.VPATHS.def, motif: motifRel, size: metrics.size, from: orig, names: clNames.filter((n) => !JP.stockDraws(n) && JP.fontDraws(n)).length };
      console.log('desktop: the Command List font (DotGothic16, ' + metrics.size.join(',') + ') ships for ' + commandListFont.names + ' names; ' + motifRel + ' points the pause menus\' list at it');
    } else {
      // An install several bundles export into (one folder, a screenpack folder
      // per bundle): another bundle's motif may still point its list at the
      // font - then it stays, or that build's whole list would print blank.
      const usedElsewhere = (() => {
        const data = path.join(dest, 'data');
        let hit = false;
        const walk = (d, depth) => {
          let ents = [];
          try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
          for (const e of ents) {
            if (hit) return;
            const p = path.join(d, e.name);
            if (e.isDirectory() && depth < 2) walk(p, depth + 1);
            else if (/^system\.def$/i.test(e.name)) { try { if (/^font\d+ = DotGothic16\.def ;/m.test(fs.readFileSync(p, 'latin1'))) hit = true; } catch (err) { /* unreadable: not ours */ } }
          }
        };
        walk(data, 0);
        return hit;
      })();
      if (!usedElsewhere) for (const f of outFiles) if (fs.existsSync(f)) removeFile(f);
    }
  }

  // ---- the Command List's buttons (buttonstyle.js) -------------------------
  // The bundle's button style, when it is not the default: the motif's
  // [Glyphs] keys for the button tokens and, when the style needs pictures the
  // glyph file lacks, cmdlist-buttons-<style>.sff beside the motif (a copy of
  // the glyph file this build uses, with them added). vfslib.build() already
  // patched the generated motif the screenpack copy above wrote (its picture
  // file is written here: the copy only writes files the pack has); a motif it
  // did not generate (the engine zip's own) is patched here, in place - the
  // "earlier export" block above put it back first. Any picture file of ours
  // beside the motif that the motif does not name is an earlier export's and goes.
  let commandListButtons = null;
  {
    const BTN = require('./buttonstyle.js');
    if (fs.existsSync(sysDef)) {
      let text = fs.readFileSync(sysDef, 'latin1');
      // a file as the build ships it: a switched-on mod's (syncUserMods lays them
      // over the build further down - a mod may be a glyph file of its own), else the folder's
      let modFiles = [];
      try { modFiles = require('./modmgr.js').userModFiles(roster); } catch (e) { modFiles = []; }
      const readDest = (rel) => {
        const p = path.join(dest, ...String(rel).split('/'));
        const mod = GENERATED.has(writtenKey(p)) ? null : modFiles.find((m) => String(m.vpath).toLowerCase() === String(rel).toLowerCase());
        if (mod) { try { return fs.readFileSync(mod.abs); } catch (e) { /* the folder's, below */ } }
        try { return fs.statSync(p).isFile() ? fs.readFileSync(p) : null; } catch (e) { return null; }
      };
      if (BTN.styleOf(roster) !== BTN.DEFAULT_STYLE) {
        if (BTN.patched(text)) {
          // vfslib's generated copy: its picture file, from the same build
          const vb = vfsButtons && vfsButtons.file ? vfsButtons : null;
          const buf = vb && generated[vb.file];
          if (vb && buf) { writeOut(path.join(dest, ...vb.file.split('/')), buf); files++; }
          commandListButtons = vb || (vfsButtons ? Object.assign({}, vfsButtons) : { style: BTN.styleOf(roster) });
        } else {
          const done = BTN.forBuild(motifRel, text, readDest, roster);
          if (done && done.info && Object.keys(done.info.overrides).length) {
            text = done.text;
            writeOut(sysDef, text, 'latin1');
            if (done.file) { writeOut(path.join(dest, ...done.file.vpath.split('/')), done.file.buf); files++; }
            commandListButtons = Object.assign({ motif: motifRel }, done.info);
          } else if (done && done.info) {
            commandListButtons = Object.assign({ motif: motifRel }, done.info);
          }
        }
        if (commandListButtons) console.log('desktop: the Command List buttons in the ' + commandListButtons.style + ' style' + (commandListButtons.file ? ', pictures in ' + commandListButtons.file : '') + (commandListButtons.notes && commandListButtons.notes.length ? ' (' + commandListButtons.notes.join('; ') + ')' : ''));
      }
      // an earlier export's picture files the motif does not name now
      const named = /^[ \t]*glyphs[ \t]*=[ \t]*([^;\r\n]*?)[ \t]*;/mi.exec(BTN.patched(text) ? text : '');
      const keep = named ? named[1].trim().toLowerCase() : null;
      try {
        for (const e of fs.readdirSync(spDir, { withFileTypes: true })) {
          if (e.isFile() && BTN.FILE_RE.test(e.name) && e.name.toLowerCase() !== keep) removeFile(path.join(spDir, e.name));
        }
      } catch (e) { /* no folder */ }
    }
  }

  const cleaned = [];
  let staleBackups = 0, staleBytes = 0;
  (function sweep(d) {
    let ents;
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { sweep(p); continue; }
      // Stale backups from an EARLIER export. The copier above skips these now,
      // but skipping only stops new ones arriving - the folder is merge-only,
      // so 11.9 MB of .orig siblings written by previous builds sat here
      // untouched. A build output is not a place to keep undo history.
      if (/\.(orig|bak|preSquare)$/i.test(e.name)) {
        try { staleBytes += fs.statSync(p).size; fs.unlinkSync(p); staleBackups++; } catch (err) { /* leave it */ }
        continue;
      }
      if (!/^system\.def$/i.test(e.name)) continue;
      const r = priv.stripRankedMenu(fs.readFileSync(p, 'latin1'));
      if (!r.changed) continue;
      writeOut(p, r.text, 'latin1');
      cleaned.push(path.relative(dest, p).split(path.sep).join('/') + ' (' + r.removed + ')');
    }
  })(dest);

  // ---- the bundle's own mods (syncUserMods) ---------------------------------
  // After every file the export writes itself, so the build's copy of any file
  // a mod also has is the one that ships, and before the sweep below, which
  // then keeps a mod's music or screenpack files as this build's own.
  const userMods = syncUserMods(dest, require('./modmgr.js').userModFiles(roster), { zip });
  files += userMods.files.length;
  if (userMods.files.length) {
    console.log('desktop: ' + userMods.files.length + ' file(s) from ' + userMods.mods.length + ' mod(s) of this bundle: ' + userMods.mods.join(', '));
  }
  for (const s of userMods.skipped) {
    console.log('desktop: mod "' + s.folder + '": ' + s.vpath + ' is a file this export writes itself - the build\'s copy ships, not the mod\'s');
  }
  // A mod's own system.def or +system.def gets the ranked-menu sweep above,
  // which ran before the mods were copied: a pack copied out of an older
  // Studio-made install would otherwise stop the export at the private check.
  for (const v of userMods.files) {
    if (!/(^|\/)\+?system\.def$/i.test(v)) continue;
    const p = path.join(dest, ...v.split('/'));
    let t = null;
    try { t = fs.readFileSync(p, 'latin1'); } catch (e) { t = null; }
    if (t === null) continue;
    const r = priv.stripRankedMenu(t);
    if (!r.changed) continue;
    writeOut(p, r.text, 'latin1');
    cleaned.push(v + ' (' + r.removed + ', from a mod)');
  }
  if (userMods.removed.length || userMods.restored.length) {
    console.log('desktop: took back what an earlier export wrote for mods that are off or gone: ' + userMods.removed.length + ' removed'
      + (userMods.restored.length ? ', ' + userMods.restored.length + ' engine file(s) put back (' + userMods.restored.join(', ') + ')' : ''));
  }
  if (userMods.kept.length) {
    console.log('desktop: ' + userMods.kept.length + ' file(s) an earlier export wrote for a mod could not be taken back and stay listed: ' + userMods.kept.join(', '));
  }

  // What another build left here (see reconcileBuildFolder). Last, so that
  // everything this export writes is on the list by now.
  const leftovers = reconcileBuildFolder(dest, require('./enginezip.js').zipEntries(zip) || [], WRITTEN);
  if (leftovers.removed.length) {
    console.log('desktop: removed ' + leftovers.removed.length + ' file(s) another build had left in this folder ('
      + (leftovers.bytes / 1048576).toFixed(1) + ' MB): ' + leftovers.removed.slice(0, 6).join(', ') + (leftovers.removed.length > 6 ? ', ...' : ''));
  }

  // The backstop. A desktop build that still contains a private surface is not
  // reported as a success - the previous failure mode was a silent one, and the
  // person who discovers it otherwise is whoever the folder was sent to.
  priv.assertClean(dest, 'desktop build ' + dest);
  // And neither of the host's own secrets (Settings > Online, Your own
  // servers), by value, in any text file of it (export.js).
  require('./export.js').assertNoHostSecrets(dest, 'desktop build ' + dest);

  return {
    sandbox,
    // the add-ons' loose copies an earlier export left in external/mods, now gone
    legacyRemoved,
    // the bundle's own mods (syncUserMods): the files written, the mods they
    // came from, a file the build wrote itself instead, and what an earlier
    // export wrote for a mod that is off or gone - removed, put back from the
    // engine zip, or kept listed
    userMods,
    strippedMenus: cleaned,
    logo: logoNote,
    staleBackupsRemoved: staleBackups,
    staleBackupMb: +(staleBytes / 1048576).toFixed(1),
    // files another build had left in this folder, now gone
    leftovers: { removed: leftovers.removed.length, mb: +(leftovers.bytes / 1048576).toFixed(1), files: leftovers.removed },
    dest,
    engine: engineName,
    engineExtracted: extracted,
    characters: chars,
    // The count people care about is what THEY changed, not the 130 keys the
    // build now states outright.
    settings: settings.filter((s) => !s.fromDefault).length,
    screenpack: screenpack || '(engine default)',
    stageFixes,
    charFixes,
    commandListFont,
    commandListButtons,
    // the build's own state files this engine refused, one plain line each
    commonReport: (ownCommon && ownCommon.report) || [],
    files,
    repaired,
    // the license notices put beside the engine: { copied, missing, otherEngine }
    licenses,
    mb: +(dirSize(dest) / 1048576).toFixed(1),
  };
}

function dirSize(p) {
  let n = 0;
  for (const e of fs.readdirSync(p, { withFileTypes: true })) {
    const q = path.join(p, e.name);
    if (e.isDirectory()) n += dirSize(q);
    else { try { n += fs.statSync(q).size; } catch (err) { /* vanished */ } }
  }
  return n;
}

module.exports = {
  sandboxAssets, syncSandboxFiles, syncUserMods, zipRead, stripStates1Line, stripCommonLine, stripBuildLines, stripThemeStatesLine, lifebarTarget,
  TRAINING_TEAM_LUA, exportDesktop, findEngineZip, copyCharacters, checkBuildFolder,
  officialEngineStageFixes, fixStagesForOfficialEngine, fixCopiedCharacters, pointLogoStoryboard,
  // exported for the tests: every file this export puts down goes through one
  // of these two, and the reason is a Windows attribute (see writeOut)
  writeOut, copyOut, reconcileBuildFolder, writtenPaths: () => WRITTEN, generatedPaths: () => GENERATED,
  // the license notices beside the engine, and where they come from
  copyNotices, NOTICES_DIR, NOTICE_FILES };
