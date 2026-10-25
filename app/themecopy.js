'use strict';
//
// TAKING A SCREENPACK FROM ANOTHER BUNDLE.
//
// A screenpack installed in one bundle can be wanted in another: the same
// pack under a different roster, or a pack set up (options chosen, E-Select
// edits made) in one bundle and wanted as it is in the next. This copies the
// installed folder, whole, from <other bundle>/themes/<folder> into this
// bundle's themes/. The other bundle is only ever read.
//
// WHAT TRAVELS is the whole folder: E-Select's edits, system.def.orig and the
// .bak copies, the options manifest (studio-pack.json, so the option choices
// and the common-state switches arrive as they were), studio-options/,
// studio-states/ and any common1.cns. WHAT STAYS BEHIND is everything the
// other bundle keeps about the pack outside its folder: which screenpack its
// roster uses, the slot layout its roster wears, its lifebar mix and the
// lifebars lifted from the pack, the portraits fitted to the pack, its fight
// screen edits from Settings > Engine (engine/<folder>/), its imported
// build's common states and its startup logo. A copy never switches the pack
// in use and never touches either bundle's roster.json.
//
// COPIES, NEVER LINKS. A link (a symlink or a junction - lstat reports both)
// anywhere in the folder refuses the whole copy: a recursive delete through a
// junction once emptied what it pointed at, and a pack that is half a link
// would share its files with the other bundle without saying so. Files are
// copied one at a time (mkdirSync + copyFileSync, never cpSync, which follows
// whatever it is handed).
//
// STAGED OUTSIDE themes/. The theme walk mounts every folder under themes/
// (vfslib.js) and listThemes offers any folder holding a system.def, so a
// half-copied folder there would be served and offered if anything stopped
// the copy. The copy is built in <bundle>/.studio-themecopy-<pid>/ beside
// themes/ (the same volume, so the last step is one rename) and only then
// renamed into themes/. Any failure deletes the staging folder, which this
// call made, and nothing under themes/ has changed.
//
// A COPIED common1.cns IS EVERY MUGEN CHARACTER'S COMMON STATES once the pack
// is chosen (stcommon = common1.cns resolves in the character's folder, the
// build root, the motif folder, then data/), so a pack that brings one is
// flagged before and after the copy.
const fs = require('fs');
const path = require('path');

function layout() { return require('./layout.js'); }
function lifebars() { return require('./lifebars.js'); }
function modlib() { return require('./modlib.js'); }

// The names the exports never ship and the comparison below leaves out: the
// one-time .orig insurance, the combo .bak copies, E-Select's .preSquare.
// The same pattern as vfslib.js BACKUP_FILE (not exported there).
const BACKUP_FILE = /\.(orig|bak|preSquare)$/i;
const MANIFEST = 'studio-pack.json';
const STAGE_PREFIX = '.studio-themecopy-';

// The pack's own name from its [Info]. A copy of modlib.themeName (one
// regex; modlib does not export it), so the rows here read like the
// screenpack list.
function themeName(defText, fallback) {
  const m = /^\s*name\s*=\s*"?([^"\r\n;]+)/mi.exec(defText || '');
  return (m && m[1].trim()) || fallback;
}

// The calls a test replaces: a link reported by lstat, a full drive by
// statfs, a copy that fails part of the way. The server never passes any.
const IO = {
  lstatSync: (p) => fs.lstatSync(p),
  statfsSync: (p) => fs.statfsSync(p),
  copyFileSync: (a, b, mode) => fs.copyFileSync(a, b, mode),
  renameSync: (a, b) => fs.renameSync(a, b),
};
const ioOf = (opts) => Object.assign({}, IO, (opts && opts.io) || {});

function readHead(p, n) {
  try {
    const fd = fs.openSync(p, 'r');
    try {
      const buf = Buffer.alloc(n);
      const got = fs.readSync(fd, buf, 0, n, 0);
      return buf.slice(0, got).toString('latin1');
    } finally { fs.closeSync(fd); }
  } catch (e) { return ''; }
}
const bytesOf = (p) => { try { return fs.readFileSync(p); } catch (e) { return null; } };
const sameBytes = (a, b) => (a === null && b === null) || (a !== null && b !== null && a.equals(b));

function sizeText(b) {
  if (b >= 1e9) return (b / 1e9).toFixed(2) + ' GB';
  if (b >= 1e6) return (b / 1e6).toFixed(1) + ' MB';
  return Math.max(1, Math.round(b / 1e3)) + ' KB';
}

// Every file under a pack folder, with lstat, on every call: sizes are never
// cached, because a cache keyed by the folder's time would miss a write deep
// inside it (a swapped fight/fight.def). A link is listed under `links`, not
// followed and not counted. rel uses '/'.
function walk(root, io) {
  const files = [], dirs = [], links = [];
  let bytes = 0;
  const go = (abs, rel) => {
    for (const n of fs.readdirSync(abs).sort()) {
      const a = path.join(abs, n);
      const r = rel ? rel + '/' + n : n;
      const st = io.lstatSync(a);
      if (st.isSymbolicLink()) links.push(r);
      else if (st.isDirectory()) { dirs.push(r); go(a, r); }
      else if (st.isFile()) { files.push({ rel: r, size: st.size }); bytes += st.size; }
      // A device, pipe or socket is no part of a screenpack: refused as a link is.
      else links.push(r);
    }
  };
  go(root, '');
  return { files, dirs, links, bytes };
}

// The folder in `themesDir` whose name is `name` the way Windows compares
// names, whatever it is (folder, file or link), or null.
function entryCI(themesDir, name) {
  let ents = [];
  try { ents = fs.readdirSync(themesDir); } catch (e) { ents = []; }
  return ents.find((n) => n === name) || ents.find((n) => n.toLowerCase() === name.toLowerCase()) || null;
}

// THE SAME PACK, already here: the same files at the same sizes and the same
// system.def and manifest bytes (a manifest absent on both sides counts as
// equal), leaving the backup names out. The owner's two Capcom copies differ
// only by one side's system.def.orig, and they are the same pack.
function samePack(srcDir, dstDir, io) {
  let a, b;
  try { a = walk(srcDir, io); b = walk(dstDir, io); } catch (e) { return false; }
  if (b.links.length) return false;
  const list = (w) => w.files.filter((f) => !BACKUP_FILE.test(f.rel)).map((f) => f.rel + '\u0000' + f.size).sort().join('\n');
  if (list(a) !== list(b)) return false;
  for (const f of ['system.def', MANIFEST]) {
    if (!sameBytes(bytesOf(path.join(srcDir, f)), bytesOf(path.join(dstDir, f)))) return false;
  }
  return true;
}

// Where a pack named `folder` would land here: its own name, or the first
// free <folder>_2, _3... (free the way Windows compares names).
function freeName(themesDir, folder) {
  for (let i = 2; i < 10000; i++) {
    const n = folder + '_' + i;
    if (!entryCI(themesDir, n) && modlib().themeFolderDir(n, themesDir)) return n;
  }
  throw new Error('no free folder name for ' + folder);
}

function themesHere() { return layout().dir('themes'); }

// What a source pack would be here: 'new', 'same' (refused) or 'rename' (with
// the name it would take).
function fate(srcDir, folder, themesDir, io) {
  const hit = entryCI(themesDir, folder);
  if (!hit) return { state: 'new', as: folder };
  let st = null;
  try { st = io.lstatSync(path.join(themesDir, hit)); } catch (e) { st = null; }
  if (st && st.isDirectory() && !st.isSymbolicLink() && samePack(srcDir, path.join(themesDir, hit), io)) return { state: 'same', as: hit };
  return { state: 'rename', as: freeName(themesDir, folder) };
}

// The bundles other than this one, each with its themes folder.
function otherBundles() {
  const L = layout();
  const here = path.resolve(L.CONTENT);
  return lifebars().bundleDirs()
    .filter((b) => path.resolve(b.dir) !== here)
    .map((b) => Object.assign({}, b, { themes: path.join(b.dir, L.folderName('themes')) }));
}

// The installed packs of one bundle: real folders (lstat) holding system.def.
function packsIn(themesDir, io) {
  const out = [];
  let names = [];
  try { names = fs.readdirSync(themesDir).sort((a, b) => a.localeCompare(b)); } catch (e) { names = []; }
  for (const n of names) {
    if (!modlib().themeFolderDir(n, themesDir)) continue;
    const abs = path.join(themesDir, n);
    let st = null;
    try { st = io.lstatSync(abs); } catch (e) { st = null; }
    if (!st || !st.isDirectory() || st.isSymbolicLink()) continue;
    try { if (!fs.statSync(path.join(abs, 'system.def')).isFile()) continue; } catch (e) { continue; }
    out.push({ folder: n, dir: abs });
  }
  return out;
}

const hasStcommon = (dir) => { try { return fs.readdirSync(dir).some((n) => /^common1\.cns$/i.test(n)); } catch (e) { return false; } };

// Every screenpack the other bundles hold, as rows for the Theme tab:
// { bundle, folder, name, bytes, stcommon, state: 'new'|'same'|'rename', as }.
function sources(opts) {
  const io = ioOf(opts);
  const here = themesHere();
  const out = [];
  for (const b of otherBundles()) {
    for (const p of packsIn(b.themes, io)) {
      let w;
      try { w = walk(p.dir, io); } catch (e) { continue; }
      const f = fate(p.dir, p.folder, here, io);
      out.push({
        bundle: b.name, folder: p.folder,
        name: themeName(readHead(path.join(p.dir, 'system.def'), 4096), p.folder),
        bytes: w.bytes, stcommon: hasStcommon(p.dir), state: f.state, as: f.as,
      });
    }
  }
  return out;
}

// Rewrite data/<old>/ to data/<new>/ in the copied root .def and .bak files:
// the installer's bgm lines and E-Select's saved edits name the folder. Raw
// option sources under studio-options/ are not touched (a swap repoints
// them), nor is the .orig insurance. Byte for byte: latin-1 both ways.
function repointFolder(dir, from, to) {
  const esc = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp('(^|[^A-Za-z0-9_])(data[\\\\/])' + esc + '(?=[\\\\/])', 'gi');
  const changed = [];
  for (const n of fs.readdirSync(dir)) {
    if (!/\.(def|bak)$/i.test(n)) continue;
    const p = path.join(dir, n);
    if (!fs.lstatSync(p).isFile()) continue;
    const text = fs.readFileSync(p, 'latin1');
    const next = text.replace(re, (m, pre, data) => pre + data + to);
    if (next !== text) { fs.writeFileSync(p, next, 'latin1'); changed.push(n); }
  }
  return changed;
}

function refusal(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

// Copy <bundle>/themes/<folder> into this bundle's themes/. Returns
// { folder, from, renamed, bundle, name, bytes, fightEdits, stcommon,
//   additions, repointed }.
function copy(req, opts) {
  const io = ioOf(opts);
  const L = layout();
  const r = req || {};
  const want = String(r.bundle == null ? '' : r.bundle);
  const b = otherBundles().find((x) => (want && x.name === want) || (want && x.id === want));
  if (!b) {
    const self = lifebars().bundleDirs().find((x) => x.name === want && path.resolve(x.dir) === path.resolve(L.CONTENT));
    throw refusal('bundle', self ? 'that screenpack is already in this bundle' : 'no such bundle: ' + want);
  }
  const folder = typeof r.folder === 'string' ? r.folder : '';
  const src = modlib().themeFolderDir(folder, b.themes);
  let sst = null;
  try { sst = src && io.lstatSync(src); } catch (e) { sst = null; }
  if (!src || !sst || !sst.isDirectory() || sst.isSymbolicLink() || !fs.existsSync(path.join(src, 'system.def'))) {
    throw refusal('folder', 'no such screenpack in ' + b.name + ': ' + (folder || '(none)'));
  }
  const themesDir = themesHere();
  fs.mkdirSync(themesDir, { recursive: true });
  const name = themeName(readHead(path.join(src, 'system.def'), 4096), folder);
  const f = fate(src, folder, themesDir, io);
  if (f.state === 'same') {
    throw refusal('same', 'Not copied: this bundle already has ' + name + ' (themes/' + f.as + '), with the same files.');
  }
  const dest = f.as;
  const destDir = modlib().themeFolderDir(dest, themesDir);
  if (!destDir) throw refusal('folder', 'cannot copy into themes/' + dest);

  const w = walk(src, io);
  if (w.links.length) {
    throw refusal('link', 'Not copied: ' + folder + '/' + w.links[0] + ' is a link, and links are never copied.');
  }
  const sf = io.statfsSync(themesDir);
  const free = Number(sf.bavail) * Number(sf.bsize);
  if (free < w.bytes * 1.1) {
    throw refusal('space', 'Not copied: it needs ' + sizeText(w.bytes) + (free >= w.bytes ? ', plus a little room to spare,' : '')
      + ' and the drive has ' + sizeText(free) + ' free.');
  }

  // The staging root: made by THIS call (a plain mkdir fails on one that is
  // already there, so a folder left by something else is never reused or
  // deleted).
  const bundleDir = path.dirname(themesDir);
  let stageRoot = null;
  for (let i = 0; i < 100 && !stageRoot; i++) {
    const p = path.join(bundleDir, STAGE_PREFIX + process.pid + (i ? '-' + i : ''));
    try { fs.mkdirSync(p); stageRoot = p; } catch (e) { if (e.code !== 'EEXIST') throw e; }
  }
  if (!stageRoot) throw new Error('could not make a staging folder in ' + bundleDir);
  const staged = path.join(stageRoot, dest);
  let repointed = [];
  try {
    fs.mkdirSync(staged);
    for (const d of w.dirs) fs.mkdirSync(path.join(staged, ...d.split('/')), { recursive: true });
    for (const x of w.files) {
      const parts = x.rel.split('/');
      io.copyFileSync(path.join(src, ...parts), path.join(staged, ...parts), fs.constants.COPYFILE_EXCL);
    }
    if (dest !== folder) repointed = repointFolder(staged, folder, dest);
    // Nothing of that name may have appeared meanwhile: a rename onto an
    // existing folder is refused on Windows and merges on some systems.
    if (fs.existsSync(destDir)) throw new Error('themes/' + dest + ' appeared during the copy');
    // A folder just written can be held for a moment (an indexer, an
    // antivirus scan), and Windows then refuses the rename with EPERM. Five
    // tries 100 ms apart ride over that; a lasting lock still lands in the
    // cleanup below, about 0.4 s later.
    for (let tries = 1; ; tries++) {
      try { io.renameSync(staged, destDir); break; } catch (e) {
        if (tries >= 5 || !['EPERM', 'EBUSY', 'EACCES'].includes(e && e.code)) throw e;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
      }
    }
  } catch (e) {
    try { lifebars().rmTree(stageRoot); } catch (e2) { e.message += ' - and the staging folder ' + stageRoot + ' could not be removed (' + e2.message + ')'; }
    throw e;
  }
  // Empty now: rmdir, which refuses a folder that is not.
  try { fs.rmdirSync(stageRoot); } catch (e) { /* left for a person to see; it holds nothing of the pack */ }

  let additions = 0;
  try {
    const m = JSON.parse(fs.readFileSync(path.join(destDir, MANIFEST), 'utf8').replace(/^﻿/, ''));
    additions = Array.isArray(m && m.common && m.common.additions) ? m.common.additions.length : 0;
  } catch (e) { additions = 0; }
  // The other bundle's fight screen edits for this pack (lifebar.js keeps
  // them in engine/<motif folder>/): they stay there, and the toast says so.
  const engineSrc = path.join(b.dir, L.folderName('engine'));
  const own = entryCI(engineSrc, folder);
  let fightEdits = false;
  try { fightEdits = !!own && fs.statSync(path.join(engineSrc, own)).isDirectory(); } catch (e) { fightEdits = false; }
  return {
    folder: dest, from: folder, renamed: dest !== folder, bundle: b.name, name,
    bytes: w.bytes, fightEdits, stcommon: hasStcommon(destDir), additions, repointed,
  };
}

module.exports = { sources, copy, walk, samePack, STAGE_PREFIX, MANIFEST };
