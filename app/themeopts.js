'use strict';
// WHAT A SCREENPACK BRINGS BESIDES ITS SCREENS, read once at install and kept
// with the pack.
//
// Some packs ship more than a skin: their own common-state files (the action
// and tag code their lifebars were drawn for), game systems the engine does
// not have (a shadow assist, clashing), a debug font their text expects.
// Their instructions say "edit your config.ini" - the Studio has no config to
// hand-edit, so it reads what the pack asks for at install, records it in a
// small manifest inside the theme folder, and the exports write the lines
// (themecommon.js). The manifest travels with the folder, so a copy of the
// pack in another bundle keeps its choices.
//
//   themes/<folder>/studio-pack.json   the manifest (never shipped)
//   themes/<folder>/studio-states/     state files the pack kept outside its
//                                      motif folder, carried in at install
//
// THE PACK ITSELF IS NEVER EDITED. A file written for an older engine is
// updated in the INSTALLED copy only, and only where the new form is certain
// (zsscompat.js); every rewrite is recorded here and shown on the Theme tab.
//
// No manifest means today's behavior, byte for byte: an ordinary pack gets
// none, and nothing reads further than its absence. Packs installed before
// this existed have none either; removing and adding one again reads it.
//
// The same manifest holds the pack's own variants (slot counts, announcers,
// "made for"): `groups` with the current choice of each, `combos` (which
// files each choice puts where), `edited` (the user's changes, kept per
// combination of choices). See "the pack's own variants" below.
//
//   themes/<folder>/studio-options/    variant files kept outside the motif
//                                      folder (overlays, a split pack's defs)

const fs = require('fs');
const path = require('path');

const MANIFEST = 'studio-pack.json';
const OPTIONS_DIR = 'studio-options';
const STATES_DIR = 'studio-states';
// [Common] States, States1, States2... are one keyed map, sorted by key and
// each key merged in (common.go SortedKeys). States0 ties with States, States1
// is the desktop export's hook, States2 an imported MUGEN build's, States7 the
// H gallery's - States3 is free, and this is the only writer of it.
const THEME_STATES_KEY = 'States3';
const EXCLUDED_SEG = /^(backup|bak|old|orig|work|__MACOSX|old version)$/i;
const STCOMMON = /^common1\.cns(\.zss)?$/i;
const ENGINE_DATA_FILES = ['common.const', 'common.air', 'common.cmd', 'common1.cns', 'common1.cns.zss', 'functions.zss'];
const STATE_EXT = /\.(zss|cns)$/i;
const DEFAULT_DEBUG_FONT = 'font/debug.def';

const posix = (p) => String(p || '').replace(/\\/g, '/');
const clean = (v) => posix(String(v || '').trim().replace(/^"|"$/g, '').trim()).replace(/^(\.\/)+/, '');
const kindOf = (name) => (/\.cns$/i.test(name) ? 'cns' : 'zss');
const base = (p) => posix(p).split('/').pop();
const stem = (p) => base(p).replace(/\.[^.]*$/, '');

// ---- the manifest ------------------------------------------------------------

function manifestPath(themeDir) { return path.join(themeDir, MANIFEST); }

function readManifestRaw(themeDir) {
  let text;
  try { text = fs.readFileSync(manifestPath(themeDir), 'utf8'); } catch (e) { return null; }
  try {
    const m = JSON.parse(text);
    return m && typeof m === 'object' && m.version === 1 ? m : null;
  } catch (e) { return null; }
}

// The manifest with the lint run again on every state file it lists, so a
// rule added later also covers a pack installed earlier. A file that is gone
// from the folder reads as refused (`why: 'missing'`): it can never be listed.
function readManifest(themeDir, opts) {
  const m = readManifestRaw(themeDir);
  if (!m) return null;
  if (m.common && !(opts && opts.lint === false)) relint(themeDir, m.common);
  return m;
}

function relint(themeDir, common) {
  const lint = require('./zsslint.js');
  const tables = lint.tables();
  const check = (entry) => {
    if (entry.why === 'training' || entry.why === 'comma') { entry.ok = false; return; }
    let text = null;
    // Only a file inside the theme folder: the manifest may not be ours (a
    // pack that shipped one into an older install, a copy from another bundle).
    if (insideTheme(themeDir, entry.file)) {
      try { text = fs.readFileSync(path.join(themeDir, ...posix(entry.file).split('/')), 'latin1'); } catch (e) { text = null; }
    }
    if (text === null) { entry.ok = false; entry.why = 'missing'; entry.line = null; return; }
    const r = lint.lint(text, kindOf(entry.file), tables);
    entry.ok = !!r.ok;
    if (r.ok) { delete entry.why; delete entry.line; delete entry.name; }
    else { entry.why = r.why; entry.line = r.line == null ? null : r.line; if (r.name) entry.name = r.name; }
  };
  for (const role of common.roles || []) for (const c of role.choices || []) check(c);
  for (const a of common.additions || []) check(a);
}

// Written whole, through a temporary file renamed over the old one.
function writeManifest(themeDir, m) {
  const p = manifestPath(themeDir);
  const tmp = p + '.__new';
  fs.writeFileSync(tmp, JSON.stringify(m, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, p);
}

// ---- reading the pack (install time, read-only) ------------------------------

// A pack-relative path as the disk spells it, matched without case the way the
// engine's file lookup does. Null when any part is missing.
function findCI(root, rel) {
  let cur = root, real = '';
  for (const part of posix(rel).split('/').filter((p) => p && p !== '.')) {
    if (part === '..') return null;
    let ents;
    try { ents = fs.readdirSync(cur, { withFileTypes: true }); } catch (e) { return null; }
    const hit = ents.find((e) => e.name === part) || ents.find((e) => e.name.toLowerCase() === part.toLowerCase());
    if (!hit) return null;
    cur = path.join(cur, hit.name);
    real = real ? real + '/' + hit.name : hit.name;
  }
  return { abs: cur, rel: real };
}

const listDir = (abs) => { try { return fs.readdirSync(abs, { withFileTypes: true }); } catch (e) { return []; } };

// The image a font .def names (`file =`), looked for the engine's way
// (font.go LoadFntSff -> SearchFile: beside the .def, then the motif folder,
// each also under font/), in `roots` only. Null when it is in none of them: a
// font whose image does not load stops the game at boot.
function fontImage(defAbs, roots) {
  let text = '';
  try { text = fs.readFileSync(defAbs, 'latin1'); } catch (e) { return null; }
  const fm = /^\s*file\s*=\s*([^\r\n;]+)/im.exec(text);
  const want = fm ? clean(fm[1]) : '';
  if (!want) return null;
  for (const root of roots) {
    for (const rel of /^font\//i.test(want) ? [want] : [want, 'font/' + want]) {
      const hit = findCI(root, rel);
      try { if (hit && fs.statSync(hit.abs).isFile()) return { abs: hit.abs, want }; } catch (e) { /* not this one */ }
    }
  }
  return null;
}

// A folder that holds the engine's own data (common.const, common1.cns...):
// at least two of them, directly inside. Legacy's and ACA's data/ are; a
// MUGEN fullgame motif folder with only its common1.cns is not.
function isEngineDataFolder(abs) {
  const names = new Set(listDir(abs).filter((e) => e.isFile()).map((e) => e.name.toLowerCase()));
  return ENGINE_DATA_FILES.filter((n) => names.has(n)).length >= 2;
}

// The folder that holds data/ above the chosen def: the pack's game root,
// where its save/ and README live and its config's paths start. The pack
// root when no folder above the def has a data/.
function gameRootOf(packRoot, chosenRel) {
  const segs = posix(chosenRel).split('/').slice(0, -1);
  for (let n = segs.length; n >= 0; n--) {
    const rel = segs.slice(0, n).join('/');
    const abs = rel ? path.join(packRoot, ...rel.split('/')) : packRoot;
    if (listDir(abs).some((e) => e.isDirectory() && e.name.toLowerCase() === 'data')) return rel;
  }
  return '';
}
const join = (a, b) => (a ? a + '/' + b : b);

// The pack's own engine config, when it ships one: save/config.ini (1.0 and
// the late nightlies) or save/config.json (earlier). States* in the engine's
// key order (Go's sort of the key names), Motif, and the debug font.
function readPackConfig(packRoot, gameRoot) {
  const ini = findCI(packRoot, join(gameRoot, 'save/config.ini'));
  if (ini) {
    let text = '';
    try { text = fs.readFileSync(ini.abs, 'latin1'); } catch (e) { text = ''; }
    let sec = '';
    const states = new Map();
    let motif = null, font = null;
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.replace(/^\s*;.*$/, '');
      const s = /^\s*\[([^\]]+)\]/.exec(line);
      if (s) { sec = s[1].trim().toLowerCase(); continue; }
      const kv = /^\s*([^=;]+?)\s*=\s*(.*?)\s*$/.exec(line);
      if (!kv) continue;
      const key = kv[1].trim();
      if (sec === 'config' && /^motif$/i.test(key)) motif = clean(kv[2]);
      else if (sec === 'debug' && /^font$/i.test(key)) font = clean(kv[2]);
      else if (sec === 'common' && /^states\d*$/i.test(key)) states.set(key, kv[2]);
    }
    const keys = [...states.keys()].sort();
    const list = [];
    for (const k of keys) for (const v of String(states.get(k)).split(/[,;]/)) if (clean(v)) list.push(clean(v));
    return { file: ini.rel, motif, states: list, font };
  }
  const js = findCI(packRoot, join(gameRoot, 'save/config.json'));
  if (js) {
    let o = null;
    try { o = JSON.parse(fs.readFileSync(js.abs, 'utf8').replace(/^﻿/, '')); } catch (e) { o = null; }
    if (!o || typeof o !== 'object') return null;
    const list = Array.isArray(o.CommonStates) ? o.CommonStates.map(clean).filter(Boolean) : [];
    return { file: js.rel, motif: o.Motif ? clean(o.Motif) : null, states: list, font: o.DebugFont ? clean(o.DebugFont) : null };
  }
  return null;
}

// The pack's instructions: every .txt at the game root or one folder down.
function readmeTexts(packRoot, gameRoot) {
  const out = [];
  const rootAbs = gameRoot ? path.join(packRoot, ...gameRoot.split('/')) : packRoot;
  const take = (dir) => {
    for (const e of listDir(dir)) {
      if (e.isFile() && /\.txt$/i.test(e.name)) {
        try { out.push(fs.readFileSync(path.join(dir, e.name), 'latin1')); } catch (err) { /* unreadable */ }
      }
    }
  };
  take(rootAbs);
  for (const e of listDir(rootAbs)) if (e.isDirectory() && !EXCLUDED_SEG.test(e.name)) take(path.join(rootAbs, e.name));
  return out;
}

// Does a README name this file, as `<motif folder>/<file>`, slashes either way?
function readmeNames(texts, motifName, file) {
  if (!motifName) return false;
  const want = (motifName + '/' + base(file)).toLowerCase();
  return texts.some((t) => t.replace(/\\/g, '/').toLowerCase().includes(want));
}

// The font a README asks for under [Debug]: a line naming [Debug] and font,
// then within three lines a quoted .def that is not the engine's own.
function readmeFont(texts) {
  for (const t of texts) {
    const lines = t.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (!/\[debug\]/i.test(lines[i]) || !/font/i.test(lines[i])) continue;
      for (let j = i; j <= i + 3 && j < lines.length; j++) {
        for (const m of lines[j].matchAll(/"([^"]+\.def)"/gi)) {
          const v = clean(m[1]);
          if (v.toLowerCase() !== DEFAULT_DEBUG_FONT) return v;
        }
      }
    }
  }
  return null;
}

// ---- the engine's own list, and what each file is for -------------------------

// Statedef headers that say what a file is: positive numbers and const(...)
// names. Negative ones (-2, -3, -4) and the special +1 are in every system
// file and say nothing.
function headersOf(text, kind) {
  const out = new Set();
  const re = kind === 'cns'
    ? /^\s*\[\s*statedef\s+([^\];,\s]+)/gim
    : /^\s*\[\s*statedef\s+([^\];]+?)\s*[;\]]/gim;
  for (const m of String(text || '').matchAll(re)) {
    const v = m[1].trim();
    if (/^\d+$/.test(v)) out.add('n:' + parseInt(v, 10));
    else {
      const c = /^const\s*\(\s*([\w.]+)\s*\)$/i.exec(v);
      if (c) out.add('c:' + c[1].toLowerCase());
    }
  }
  return out;
}

// The engine's default [Common] States list as roles: `action` for
// data/action.zss and so on, with the engine file's bytes and headers.
function engineRoles() {
  const ed = require('./enginedata.js');
  const states = ed.commonConfig({ desktop: false }).states;
  let files = [];
  try { files = ed.commonFiles({ desktop: false }); } catch (e) { files = []; }
  const byRel = new Map(files.map((f) => [f.rel.toLowerCase(), f.path]));
  return states.map((rel) => {
    const abs = byRel.get(rel.toLowerCase()) || null;
    let bytes = null;
    try { bytes = abs ? fs.readFileSync(abs) : null; } catch (e) { bytes = null; }
    return {
      role: stem(rel).toLowerCase(), engine: rel, abs, bytes,
      headers: bytes ? headersOf(bytes.toString('latin1'), kindOf(rel)) : new Set(),
    };
  });
}

// Which engine role a pack file plays: by its name (tag.zss), else by sharing
// a statedef header with the engine's file (activetag.zss defines the
// engine's tag states). Null when it plays none.
function roleOf(file, text, roles) {
  const s = stem(file).toLowerCase();
  const byName = roles.find((r) => r.role === s);
  if (byName) return byName;
  const mine = headersOf(text, kindOf(file));
  let best = null, bestN = 0;
  for (const r of roles) {
    let n = 0;
    for (const h of mine) if (r.headers.has(h)) n++;
    if (n > bestN) { best = r; bestN = n; }
  }
  return best;
}

// A plain name for a game system, from its file name: shadowassist.zss ->
// "shadow assist".
const KNOWN_WORDS = ['shadow', 'assist', 'clash', 'clashing', 'guard', 'break', 'active', 'tag', 'dizzy', 'score', 'combo', 'parry', 'just', 'defend', 'meter', 'input', 'display', 'juggle', 'patch', 'attack', 'data', 'super', 'armor', 'counter', 'dash', 'air', 'recovery', 'stun', 'training', 'demo', 'action', 'system'];
function plainName(file) {
  let s = stem(file).replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().trim();
  if (!s.includes(' ')) {
    // One run of letters: split it on the words a system file tends to be named with.
    const out = [];
    let rest = s;
    while (rest) {
      const w = KNOWN_WORDS.filter((k) => rest.startsWith(k)).sort((a, b) => b.length - a.length)[0];
      if (!w) { out.push(rest); break; }
      out.push(w); rest = rest.slice(w.length);
    }
    if (out.every((w) => w.length > 1)) s = out.join(' ');
  }
  return s;
}

// ---- install: what the pack asks for ----------------------------------------

// Reads the pack as it sits unpacked at `packRoot`, before the installer
// hoists the chosen motif folder to the top. Writes nothing. Returns the
// manifest to keep (null for a pack with nothing to keep) and the files to
// write into the finished theme folder: state files carried in from outside
// the motif folder, and motif-folder files updated for this engine.
//
//   opts.commonStates === false   skip a pack's common states (the whole-build
//                                 import owns [Common] through engineCommon)
//   opts.defs                     every system.def in the pack (pack paths)
//   opts.cellsNeeded              the cells the roster's characters take, for
//                                 a split pack's slot-count pick
//
// Also returned: `copies` ({ from: pack path, rel: theme path }) for option
// files that live outside the folder the installer keeps, and `split` for a
// pack whose art and system.def variants sit in separate folders (cvs2):
// { rootRel, chosen, place } - the folder to keep, the variant the install
// boots, and the files laid in at the theme's top.
function scanPack(packRoot, chosenRel, opts) {
  const o = opts || {};
  const out = { manifest: null, writes: [], copies: [], split: null };
  let chosen = posix(chosenRel);
  // The variants first: a split pack changes which def the install boots.
  let opt = null;
  try { opt = scanOptions(packRoot, chosen, o); }
  catch (e) { console.warn('screenpack options not read:', e.message); opt = null; }
  if (opt && opt.split) { out.split = opt.split; chosen = opt.split.chosen; }
  if (opt) out.copies = opt.copies;
  const groups = opt ? opt.groups : [];
  const common = o.commonStates === false ? null : scanCommon(packRoot, chosen, out.writes);
  if (common || groups.length) out.manifest = { version: 1, groups, combos: opt ? opt.combos : [], edited: {}, common: common || null };
  return out;
}

function scanCommon(packRoot, chosenRel, writes) {
  const lint = require('./zsslint.js');
  const compat = require('./zsscompat.js');
  const tables = lint.tables();
  const roles = engineRoles();
  const motifDir = chosenRel.includes('/') ? chosenRel.slice(0, chosenRel.lastIndexOf('/')) : '';
  const motifAbs = motifDir ? path.join(packRoot, ...motifDir.split('/')) : packRoot;
  const motifName = motifDir ? motifDir.split('/').pop() : '';
  const gameRoot = gameRootOf(packRoot, chosenRel);
  const inMotif = (rel) => !motifDir || rel.toLowerCase().startsWith(motifDir.toLowerCase() + '/');
  const themeRelOf = (rel) => (motifDir ? rel.slice(motifDir.length + 1) : rel);

  const cands = new Map();           // pack rel (lowercase) -> candidate
  const takenNames = new Set();
  const add = (rel, origin) => {
    const key = rel.toLowerCase();
    if (cands.has(key)) { if (origin === 'config') cands.get(key).config = true; return cands.get(key); }
    let themeRel;
    if (inMotif(rel)) themeRel = themeRelOf(rel);
    else {
      // Carried in beside the screenpack's own files, suffixed on a clash.
      const b = base(rel), s = b.replace(/\.[^.]*$/, ''), ext = b.slice(s.length);
      let name = b, n = 2;
      while (takenNames.has(name.toLowerCase())) name = s + '_' + (n++) + ext;
      takenNames.add(name.toLowerCase());
      themeRel = STATES_DIR + '/' + name;
    }
    const c = { rel, themeRel, carried: !inMotif(rel), config: origin === 'config' };
    cands.set(key, c);
    return c;
  };

  // (i) the motif folder's own state files, unless it IS the engine's data folder.
  if (!isEngineDataFolder(motifAbs)) {
    for (const e of listDir(motifAbs)) {
      if (!e.isFile() || !STATE_EXT.test(e.name) || STCOMMON.test(e.name)) continue;
      add(join(motifDir, e.name), 'motif');
    }
  }
  // (ii) the pack's own config, when it boots this very motif. Entries at an
  // engine default path are the engine's own, whatever their bytes: those are
  // the files an older engine shipped, not the pack's.
  const cfg = readPackConfig(packRoot, gameRoot);
  const cfgOwn = [];
  let cfgUsed = false;
  if (cfg && cfg.motif && join(gameRoot, cfg.motif).toLowerCase() === chosenRel.toLowerCase()) {
    cfgUsed = true;
    const enginePaths = new Set(roles.map((r) => r.engine.toLowerCase()));
    for (const entry of cfg.states) {
      if (enginePaths.has(entry.toLowerCase())) continue;
      const hit = findCI(packRoot, join(gameRoot, entry));
      if (!hit || STCOMMON.test(base(hit.rel))) continue;
      if (hit.rel.split('/').some((s) => EXCLUDED_SEG.test(s))) continue;
      const c = add(hit.rel, 'config');
      cfgOwn.push(c);
    }
  }

  const rewrites = [];
  const rolesOut = new Map();
  const additions = [];
  for (const c of cands.values()) {
    let bytes;
    try { bytes = fs.readFileSync(path.join(packRoot, ...c.rel.split('/'))); } catch (e) { continue; }
    const kind = kindOf(c.rel);
    const orig = bytes.toString('latin1');
    const role = roleOf(c.rel, orig, roles);
    // The engine's own file, copied into the pack unchanged: nothing to offer.
    if (role && role.bytes && Buffer.compare(role.bytes, bytes) === 0) continue;
    if (!role && !c.config) continue;               // a motif-folder file with no role
    let text = orig;
    const entry = { file: c.themeRel };
    if (/[,;]/.test(c.themeRel)) { entry.ok = false; entry.why = 'comma'; }
    else if (role && role.role === 'training') {
      // The web build's training.zss carries this fork's own training-mode
      // additions; replacing it would make the two exports differ.
      entry.ok = false; entry.why = 'training';
    } else {
      const r = compat.rewrite(orig, kind);
      if (r.rewrites.length) {
        text = r.text;
        for (const w of r.rewrites) rewrites.push({ file: c.themeRel, line: w.line, before: w.before, after: w.after, what: w.what });
      }
      const v = lint.lint(text, kind, tables);
      entry.ok = !!v.ok;
      if (!v.ok) { entry.why = v.why; entry.line = v.line == null ? null : v.line; if (v.name) entry.name = v.name; }
    }
    if (c.carried || text !== orig) writes.push({ rel: c.themeRel, data: Buffer.from(text, 'latin1') });
    if (role) {
      if (!rolesOut.has(role.role)) rolesOut.set(role.role, { role: role.role, engine: role.engine, choices: [], picks: [] });
      const ro = rolesOut.get(role.role);
      ro.choices.push(entry);
      if (c.config) ro.picks.push(entry.file);
    } else {
      additions.push(Object.assign(entry, { label: plainName(c.themeRel), asked: true, on: false }));
    }
  }
  if (!rolesOut.size && !additions.length) return null;

  // The pick per role: the config's, else the file named for the role.
  const roleList = [];
  for (const r of roles) {
    const ro = rolesOut.get(r.role);
    if (!ro) continue;
    // The file named for the role first, then the others by name.
    ro.choices.sort((a, b) => ((stem(b.file).toLowerCase() === r.role) - (stem(a.file).toLowerCase() === r.role)) || a.file.localeCompare(b.file));
    const named = ro.choices.find((x) => stem(x.file).toLowerCase() === r.role);
    const pick = cfgUsed ? (ro.picks[0] || (named && named.file) || null) : (named ? named.file : null);
    const chosen = pick && ro.choices.find((x) => x.file === pick);
    roleList.push({
      role: ro.role, engine: ro.engine, choices: ro.choices,
      default: pick || '@engine',
      current: chosen && chosen.ok ? chosen.file : '@engine',
    });
  }

  // Does the pack ask for its files? Its own config listing them, or a README
  // naming them under the motif folder (ILX: "data/ilx/action.zss").
  const texts = readmeTexts(packRoot, gameRoot);
  let asked = null;
  if (cfgOwn.length) asked = 'config';
  else if ([...cands.values()].some((c) => readmeNames(texts, motifName, c.rel))) asked = 'readme';
  const usable = roleList.some((r) => r.current !== '@engine') || additions.some((a) => a.ok);

  // The debug font the pack asks for: its config's [Debug] Font, else a README's.
  let debugFont = null;
  const fontFrom = (value, how) => {
    if (!value || value.toLowerCase() === DEFAULT_DEBUG_FONT) return null;
    let rel = value;
    if (how === 'readme' && motifName) {
      const lead = new RegExp('^data/' + motifName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/', 'i');
      rel = rel.replace(lead, '');
      const hit = findCI(motifAbs, rel);
      // Its image must be in the folder that is installed, too.
      return hit && fontImage(hit.abs, [path.dirname(hit.abs), motifAbs]) ? { abs: hit.abs, themeRel: hit.rel } : null;
    }
    const hit = findCI(packRoot, join(gameRoot, rel));
    if (!hit) return null;
    if (inMotif(hit.rel)) return fontImage(hit.abs, [path.dirname(hit.abs), motifAbs]) ? { abs: hit.abs, themeRel: themeRelOf(hit.rel) } : null;
    // Outside the motif folder: carried in with the image its def names, found
    // where the engine would find it in the pack (the game root's font/ too).
    const gameAbs = gameRoot ? path.join(packRoot, ...gameRoot.split('/')) : packRoot;
    const img = fontImage(hit.abs, [path.dirname(hit.abs), motifAbs, gameAbs, path.join(gameAbs, 'data')]);
    if (!img) return null;
    const themeRel = STATES_DIR + '/font/' + base(hit.rel);
    writes.push({ rel: themeRel, data: fs.readFileSync(hit.abs) });
    writes.push({ rel: STATES_DIR + '/font/' + img.want, data: fs.readFileSync(img.abs) });
    return { abs: hit.abs, themeRel };
  };
  let want = null, how = null;
  if (cfgUsed && cfg.font) { want = cfg.font; how = 'config'; }
  else if (!cfgUsed) { want = readmeFont(texts); how = 'readme'; }
  const f = want ? fontFrom(want, how) : null;
  if (f && /\.def$/i.test(f.themeRel)) {
    let ft = '';
    try { ft = fs.readFileSync(f.abs, 'latin1'); } catch (e) { ft = ''; }
    if (/^\s*\[\s*def\s*\]/im.test(ft) || /^\s*type\s*=/im.test(ft)) {
      debugFont = { file: f.themeRel, bitmap: /^\s*type\s*=\s*bitmap\b/im.test(ft), scale: null, asked: how, use: true };
    }
  }

  return {
    on: !!asked && usable, onBy: 'install', asked,
    roles: roleList, additions, debugFont, rewrites,
    answered: false,
  };
}

// ---- install: the pack's own variants ----------------------------------------
//
// A pack can ship more than one version of a file and leave the choice to the
// reader: Infinite Legacy X has five system.defs for five slot counts (a
// "25 slot" folder beside the motif, the same files again under SLOTS/) and two
// announcers (fight/mvsf, fight/pocket fighter, and ANNOUNCER/); cvs2 ships its
// system.defs per engine and per slot count, beside a folder of art none of
// them sits in. The Studio offers each set as a choice and swaps the files on
// disk (choose, below), never at build time: E-Select, the lifebar editor and
// the layout reader all read the disk.
//
// Three shapes, read off the pack as it sits unpacked:
//   A. In-pack twins: a file with a live file's name in a folder below that
//      file's folder (data/ilx/25 slot/system.def under data/ilx/). The
//      choice is the folder; the group is the folder above it.
//   B. Overlays: G/O/<path of a live file> (SLOTS/25 slot/data/ilx/system.def).
//      G is the group, O the choice. One with the same bytes as an A choice
//      IS that choice (it takes the overlay's names); any other is carried
//      into studio-options/<G>/<O>/.
//   C. A split pack: no system.def finds its own sprite file where it sits,
//      one folder holds that file, and the defs' folders differ segment by
//      segment (ikemen_go|mugen / 70slots|140slots|700slots). That folder is
//      what is kept; each varying segment is a group.
//
// A variant must work where it would be put (rule d): every file it names
// resolves from the live file's place, the engine's way, or is one the live
// file leaves unresolved too. Engine-data folders, backup folders and fonts
// are never options. A group needs two distinct choices. The author's default
// is the choice byte-identical to what the pack has live; with none, the live
// files are kept as "As installed".

const OPTION_REF_KEY = /^(spr|snd|sff|fight|font\d*|[a-z0-9_.]*storyboard|[a-z0-9_.]*bgm|[a-z0-9_.]*\.sff|[a-z0-9_.]*\.air|[a-z0-9_.]*\.snd|[a-z0-9_.]*\.def|model|movelist|intro|ending)$/i;
const natural = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
const dirOf = (p) => { const s = posix(p); return s.includes('/') ? s.slice(0, s.lastIndexOf('/')) : ''; };
const eqi = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
const sha1 = (buf) => require('crypto').createHash('sha1').update(buf).digest('hex');
const KIND_LABEL = { slots: 'Character slots', announcer: 'Announcer', engine: 'Made for' };
const KIND_ID = { slots: 'slots', announcer: 'announcer', engine: 'madefor' };
const KIND_ORDER = { engine: 0, slots: 1, announcer: 2, other: 3 };

// The unpacked pack, read once: folder listings, def texts, file hashes.
function packReader(packRoot) {
  const dirs = new Map(), texts = new Map(), hashes = new Map();
  const absOf = (rel) => (rel ? path.join(packRoot, ...rel.split('/')) : packRoot);
  const list = (rel) => {
    const k = rel.toLowerCase();
    if (!dirs.has(k)) dirs.set(k, listDir(absOf(rel)));
    return dirs.get(k);
  };
  // A pack path as the disk spells it, matched without case; files only.
  const find = (rel) => {
    const parts = posix(rel).split('/').filter((p) => p && p !== '.');
    if (!parts.length || parts.includes('..')) return null;
    let cur = '';
    for (let i = 0; i < parts.length; i++) {
      const ents = list(cur);
      const hit = ents.find((e) => e.name === parts[i]) || ents.find((e) => e.name.toLowerCase() === parts[i].toLowerCase());
      if (!hit) return null;
      const last = i === parts.length - 1;
      if (last ? !hit.isFile() : !hit.isDirectory()) return null;
      cur = join(cur, hit.name);
    }
    return cur;
  };
  const text = (rel) => {
    if (!texts.has(rel)) { let t = ''; try { t = fs.readFileSync(absOf(rel), 'latin1'); } catch (e) { t = ''; } texts.set(rel, t); }
    return texts.get(rel);
  };
  const hash = (rel) => {
    if (!hashes.has(rel)) { let h = null; try { h = sha1(fs.readFileSync(absOf(rel))); } catch (e) { h = null; } hashes.set(rel, h); }
    return hashes.get(rel);
  };
  const all = () => {
    const out = [];
    const walk = (rel) => { for (const e of list(rel)) { const r = join(rel, e.name); if (e.isDirectory()) walk(r); else if (e.isFile()) out.push(r); } };
    walk('');
    return out;
  };
  return { absOf, list, find, text, hash, all };
}

// Every key = value of a def with its section, comments stripped.
function defEntries(text) {
  const out = [];
  let sec = '';
  for (const raw of String(text || '').split(/\r?\n/)) {
    const s = raw.replace(/;.*$/, '').trim();
    const m = /^\[\s*([^\]]+?)\s*\]/.exec(s);
    if (m) { sec = m[1].toLowerCase(); continue; }
    const kv = /^([^=]+?)\s*=\s*(.*)$/.exec(s);
    if (kv) out.push({ sec, key: kv[1].trim().toLowerCase(), value: kv[2].trim().replace(/^"|"$/g, '').trim() });
  }
  return out;
}

// A def's reference resolved the engine's way: the def's own folder, the
// pack's game root, the game root's data/ (motif.go "def,,data/"), and for a
// font each of those under font/ too. The pack path, or null.
function resolveRef(R, gameRoot, fromDir, value, font) {
  const v = posix(value).replace(/^(\.\/)+/, '');
  if (!v || v.startsWith('/') || /^[a-z]:/i.test(v) || v.split('/').includes('..')) return null;
  for (const r of [fromDir, gameRoot, join(gameRoot, 'data')]) {
    for (const sub of font ? ['', 'font/'] : ['']) {
      const hit = R.find(join(r, sub + v));
      if (hit) return hit;
    }
  }
  return null;
}

// The files the chosen motif boots with (spec 2.1): the system.def, its fight
// def, its storyboards, and the sprite and sound files the [Files] of both
// name. Never fonts (one font in two folders is not a choice) and never
// select.def (the installer repoints it). Lowercase path -> path.
function liveSetOf(R, gameRoot, chosenRel) {
  const live = new Map();
  const add = (rel) => { if (rel) live.set(rel.toLowerCase(), rel); };
  add(chosenRel);
  const dir = dirOf(chosenRel);
  const sys = defEntries(R.text(chosenRel));
  const files = sys.filter((e) => e.sec === 'files');
  const fight = resolveRef(R, gameRoot, dir, (files.find((e) => e.key === 'fight') || {}).value || 'fight.def', false);
  add(fight);
  for (const e of sys) if (/(^|\.)storyboard$/.test(e.key) && /\.def$/i.test(e.value)) add(resolveRef(R, gameRoot, dir, e.value, false));
  for (const e of files) if (/\.(sff|snd)$/i.test(e.value)) add(resolveRef(R, gameRoot, dir, e.value, false));
  if (fight) {
    for (const e of defEntries(R.text(fight))) {
      if (e.sec === 'files' && /\.(sff|snd)$/i.test(e.value)) add(resolveRef(R, gameRoot, dirOf(fight), e.value, false));
    }
  }
  return live;
}

// The file references rule d checks (the research's resolve.js keys).
function refsOf(text) {
  return defEntries(text)
    .filter((e) => !e.sec.startsWith('begin action') && e.key !== 'select' && OPTION_REF_KEY.test(e.key)
      && e.value && /\.\w{2,4}$/.test(e.value))
    .map((e) => ({ id: e.sec + '|' + e.key, value: posix(e.value), font: /^font/.test(e.key) }));
}

// Rule d: X, put where the live file T is, finds everything it names - or
// fails only where T fails too.
function resolvesAt(R, gameRoot, xRel, tRel, cache) {
  if (!/\.def$/i.test(xRel)) return true;
  const tDir = dirOf(tRel);
  let tu = cache.get(tRel);
  if (!tu) {
    tu = new Set();
    for (const r of refsOf(R.text(tRel))) {
      if (!resolveRef(R, gameRoot, tDir, r.value, r.font)) { tu.add(r.id); tu.add('=' + r.value.toLowerCase()); }
    }
    cache.set(tRel, tu);
  }
  for (const r of refsOf(R.text(xRel))) {
    if (resolveRef(R, gameRoot, tDir, r.value, r.font)) continue;
    if (tu.has(r.id) || tu.has('=' + r.value.toLowerCase())) continue;
    return false;
  }
  return true;
}

// A def as comparable lines: comments and spacing gone, and the lines the
// installer rewrites anyway (`select =`, the bgm lines) left out.
function normalizedDef(text) {
  return defEntries(text).filter((e) => e.key !== 'select' && !/bgm/.test(e.key))
    .map((e) => ({ sec: e.sec, line: e.key + '=' + e.value.replace(/\s+/g, ' ').toLowerCase() }));
}
const sectionText = (text, sec) => normalizedDef(text).filter((e) => e.sec === sec).map((e) => e.line).join('\n');
const outsideSection = (text, sec) => normalizedDef(text).filter((e) => e.sec !== sec).map((e) => e.sec + '|' + e.line).join('\n');

// What a group of choices is, by name first (spec 2.3): the overlay folder,
// the folder above the choices, then most of the choice names.
function kindByName(names, choiceNames) {
  const one = (n) => (/slot/i.test(n) ? 'slots' : /announcer/i.test(n) ? 'announcer' : null);
  for (const n of names.filter(Boolean)) { const k = one(n); if (k) return k; }
  if (choiceNames.some((n) => /ikemen/i.test(n)) && choiceNames.some((n) => /mugen/i.test(n))) return 'engine';
  for (const k of ['slots', 'announcer']) if (choiceNames.filter((n) => one(n) === k).length * 2 > choiceNames.length) return k;
  return null;
}
const madeForLabel = (v) => (/ikemen/i.test(v) ? 'Ikemen GO' : /mugen/i.test(v) ? 'MUGEN' : v);

function scanOptions(packRoot, chosenRel, o) {
  const R = packReader(packRoot);
  const all = R.all();
  const defs = (o.defs && o.defs.length ? o.defs.map(posix) : all.filter((p) => base(p).toLowerCase() === 'system.def'));
  const split = scanSplit(R, all, defs, o);
  if (split) return split;

  const out = { groups: [], combos: [], copies: [], split: null };
  const gameRoot = gameRootOf(packRoot, chosenRel);
  const rootRel = dirOf(chosenRel);
  // Where a pack path lands in the installed theme: under the folder the
  // installer keeps, or nowhere (null).
  const themeRel = (p) => {
    if (eqi(p, chosenRel)) return 'system.def';
    if (!rootRel) return p;
    return p.toLowerCase().startsWith(rootRel.toLowerCase() + '/') ? p.slice(rootRel.length + 1) : null;
  };
  const live = liveSetOf(R, gameRoot, chosenRel);
  const cache = new Map();
  const byBase = new Map();
  for (const p of all) {
    const k = base(p).toLowerCase();
    if (!byBase.has(k)) byBase.set(k, []);
    byBase.get(k).push(p);
  }

  // A. In-pack twins. Each X goes to the nearest live file it sits below.
  const groups = new Map();       // group folder (lowercase) -> group
  const groupOf = (key, parentName) => {
    if (!groups.has(key.toLowerCase())) groups.set(key.toLowerCase(), { key, parentName, overlayName: null, choices: [] });
    return groups.get(key.toLowerCase());
  };
  const twins = new Map();        // X -> T
  for (const T of live.values()) {
    const tDir = dirOf(T);
    if (themeRel(T) === null) continue;
    if (isEngineDataFolder(R.absOf(tDir))) continue;
    for (const X of byBase.get(base(T).toLowerCase()) || []) {
      if (live.has(X.toLowerCase())) continue;
      const xDir = dirOf(X);
      const below = tDir ? xDir.toLowerCase().startsWith(tDir.toLowerCase() + '/') : xDir !== '';
      if (!below) continue;
      const prev = twins.get(X);
      if (prev && dirOf(prev).length >= tDir.length) continue;
      twins.set(X, T);
    }
  }
  for (const [X, T] of twins) {
    const tDir = dirOf(T), xDir = dirOf(X);
    if (xDir.slice(tDir ? tDir.length + 1 : 0).split('/').some((s) => EXCLUDED_SEG.test(s))) continue;
    if (themeRel(X) === null) continue;
    if (!resolvesAt(R, gameRoot, X, T, cache)) continue;
    const gKey = dirOf(xDir);
    const g = groupOf(gKey, base(gKey) || base(tDir));
    let c = g.choices.find((x) => eqi(x.dir, xDir));
    if (!c) { c = { dir: xDir, name: base(xDir), label: base(xDir), files: [], carried: false }; g.choices.push(c); }
    if (!c.files.some((f) => eqi(f.live, T))) c.files.push({ src: X, live: T });
  }

  // B. Overlays, relative to the game root: G/O/<a live file's path>.
  const gr = gameRoot ? gameRoot + '/' : '';
  const overlays = new Map();
  for (const F of all) {
    if (gr && !F.toLowerCase().startsWith(gr.toLowerCase())) continue;
    if (live.has(F.toLowerCase()) || twins.has(F)) continue;
    const segs = F.slice(gr.length).split('/');
    if (segs.length < 3) continue;
    const T = live.get((gr + segs.slice(2).join('/')).toLowerCase());
    if (!T || themeRel(T) === null) continue;
    if (segs.slice(0, -1).some((s) => EXCLUDED_SEG.test(s))) continue;
    if (!resolvesAt(R, gameRoot, F, T, cache)) continue;
    const G = segs[0], O = segs[1];
    if (!overlays.has(G.toLowerCase())) overlays.set(G.toLowerCase(), { name: G, choices: [] });
    const og = overlays.get(G.toLowerCase());
    let c = og.choices.find((x) => eqi(x.name, O));
    if (!c) { c = { name: O, files: [] }; og.choices.push(c); }
    c.files.push({ src: F, live: T });
  }
  // The same bytes as an A choice: that choice, with the overlay's names.
  const sig = (files) => files.map((f) => f.live.toLowerCase() + '=' + R.hash(f.src)).sort().join('|');
  const aBySig = new Map();
  for (const g of groups.values()) for (const c of g.choices) aBySig.set(sig(c.files), { g, c });
  for (const og of overlays.values()) {
    const hits = new Map();
    for (const oc of og.choices) {
      oc.match = aBySig.get(sig(oc.files)) || null;
      if (oc.match) hits.set(oc.match.g, (hits.get(oc.match.g) || 0) + 1);
    }
    let into = null;
    for (const [g, n] of hits) if (!into || n > hits.get(into)) into = g;
    if (into) {
      into.overlayName = og.name;
      for (const oc of og.choices) if (oc.match && oc.match.g === into) oc.match.c.label = oc.name;
    } else into = groupOf('\u0000' + og.name, og.name);
    if (!into.overlayName) into.overlayName = og.name;
    for (const oc of og.choices) {
      if (oc.match) continue;
      // Not in the pack's own folders: carried in beside the theme.
      into.choices.push({ dir: null, name: oc.name, label: oc.name, carried: true,
        files: oc.files.map((f) => ({ src: f.src, live: f.live, carry: OPTIONS_DIR + '/' + og.name + '/' + oc.name + '/' + themeRel(f.live) })) });
    }
  }

  // Groups: two distinct choices at least, a kind and a label, a default.
  const used = new Set();
  const final = [];
  for (const g of groups.values()) {
    const seen = new Set();
    g.choices = g.choices.filter((c) => { const s = sig(c.files); if (seen.has(s)) return false; seen.add(s); return true; });
    if (g.choices.length < 2) continue;
    let kind = kindByName([g.overlayName, g.parentName], g.choices.map((c) => c.label));
    if (!kind) {
      // By what differs (spec 2.3, rule 2).
      const sysOf = (c) => c.files.find((f) => eqi(themeRel(f.live), 'system.def'));
      const fightLive = [...live.values()].find((p) => !eqi(p, chosenRel) && /\.def$/i.test(p) && /\[\s*round\s*\]/i.test(R.text(p)));
      const fightOf = (c) => c.files.find((f) => fightLive && eqi(f.live, fightLive));
      if (g.choices.every(sysOf) && new Set(g.choices.map((c) => outsideSection(R.text(sysOf(c).src), 'select info'))).size === 1) kind = 'slots';
      else if (g.choices.some((c) => c.files.some((f) => /\.snd$/i.test(f.src)))) kind = 'announcer';
      else if (g.choices.every(fightOf) && new Set(g.choices.map((c) => sectionText(R.text(fightOf(c).src), 'round'))).size > 1) kind = 'announcer';
    }
    const label = kind ? KIND_LABEL[kind] : (g.parentName || g.overlayName || 'Option');
    let id = kind ? KIND_ID[kind] : (label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'option');
    for (let n = 2; used.has(id); n++) id = (kind ? KIND_ID[kind] : 'option') + '-' + n;
    used.add(id);
    // Choice ids: the folder (or overlay) name, unique in the group.
    const ids = new Set();
    for (const c of g.choices) {
      let cid = c.name;
      for (let n = 2; ids.has(cid.toLowerCase()); n++) cid = c.name + ' (' + n + ')';
      ids.add(cid.toLowerCase());
      c.id = cid;
      if (kind === 'engine') c.label = madeForLabel(c.label);
    }
    g.choices.sort((a, b) => natural(a.label, b.label));
    const lives = [];
    for (const c of g.choices) for (const f of c.files) if (!lives.some((l) => eqi(l, f.live))) lives.push(f.live);
    let def = g.choices.find((c) => c.files.every((f) => R.hash(f.src) !== null && R.hash(f.src) === R.hash(f.live)));
    if (!def) {
      // Nothing matches what the pack has live: keep that as a choice too.
      def = { id: 'as-installed', label: 'As installed', carried: true,
        files: lives.map((T) => ({ src: T, live: T, carry: OPTIONS_DIR + '/' + id + '/as-installed/' + themeRel(T) })) };
      g.choices.unshift(def);
    }
    final.push({ g, id, kind: kind || 'other', label, def, lives });
  }
  final.sort((a, b) => (KIND_ORDER[a.kind] - KIND_ORDER[b.kind]) || natural(a.label, b.label));
  for (const { g, id, kind, label, def } of final) {
    out.groups.push({ id, label, kind, choices: g.choices.map((c) => ({ id: c.id, label: c.label })), default: def.id, defaultBy: 'author', current: def.id });
    for (const c of g.choices) {
      const files = [];
      for (const f of c.files) {
        const live = themeRel(f.live);
        if (f.carry) { out.copies.push({ from: f.src, rel: f.carry }); files.push({ src: f.carry, live }); }
        else files.push({ src: themeRel(f.src), live });
      }
      out.combos.push({ when: { [id]: c.id }, files });
    }
  }
  return out;
}

// C. A split pack (cvs2). Only where today's installer leaves an unusable
// theme: no system.def finds its own sprite file where it sits.
function scanSplit(R, all, defs, o) {
  const excluded = (p) => p.split('/').some((s) => EXCLUDED_SEG.test(s));
  const cands = defs.filter((d) => !excluded(d));
  if (cands.length < 2) return null;
  const sprOf = (d) => { const e = defEntries(R.text(d)).find((x) => x.sec === 'files' && x.key === 'spr'); return e && e.value ? posix(e.value) : null; };
  for (const d of cands) { const s = sprOf(d); if (s && R.find(join(dirOf(d), s))) return null; }
  const names = new Set(cands.map((d) => base(sprOf(d) || '').toLowerCase()));
  if (names.size !== 1 || names.has('')) return null;
  const want = [...names][0];
  const holders = new Set(all.filter((p) => base(p).toLowerCase() === want && !excluded(p)).map((p) => dirOf(p).toLowerCase()));
  if (holders.size !== 1) return null;
  const artLower = [...holders][0];
  if (!artLower) return null;
  const art = dirOf(all.find((p) => base(p).toLowerCase() === want && dirOf(p).toLowerCase() === artLower));
  const dirs = cands.map((d) => dirOf(d));
  if (dirs.some((d) => !d || eqi(d, art) || (d + '/').toLowerCase().startsWith(artLower + '/') || (art + '/').toLowerCase().startsWith(d.toLowerCase() + '/'))) return null;
  const segs = dirs.map((d) => d.split('/'));
  const depth = segs[0].length;
  if (segs.some((s) => s.length !== depth)) return null;
  const vary = [];
  for (let p = 0; p < depth; p++) if (new Set(segs.map((s) => s[p].toLowerCase())).size > 1) vary.push(p);
  if (!vary.length) return null;

  // One group per varying segment.
  const used = new Set();
  const groups = vary.map((p) => {
    const vals = [];
    for (const s of segs) if (!vals.some((v) => eqi(v, s[p]))) vals.push(s[p]);
    vals.sort(natural);
    const parent = p > 0 && !vary.includes(p - 1) ? segs[0][p - 1] : '';
    const kind = kindByName([parent], vals) || 'other';
    const label = KIND_LABEL[kind] || parent || 'Variant';
    let id = KIND_ID[kind] || (label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'option');
    for (let n = 2; used.has(id); n++) id = (KIND_ID[kind] || 'option') + '-' + n;
    used.add(id);
    return { p, id, kind, label, vals };
  });
  const idAt = new Map(groups.map((g) => [g.p, g]));
  const valueOf = (g, seg) => g.vals.find((v) => eqi(v, seg));
  const whenOf = (parts, upto) => {
    const w = {};
    for (const p of vary) if (p < upto) w[idAt.get(p).id] = valueOf(idAt.get(p), parts[p]);
    return w;
  };
  const filesIn = (dir) => all.filter((f) => eqi(dirOf(f), dir));
  const combos = [], copies = [];
  const keep = (f) => copies.push({ from: f, rel: OPTIONS_DIR + '/' + f });
  // The variant folders' files, laid at the theme's top when chosen.
  const fullNames = new Set();
  for (const d of dirs) {
    const files = filesIn(d);
    for (const f of files) { keep(f); fullNames.add(base(f).toLowerCase()); }
    combos.push({ when: whenOf(d.split('/'), depth), files: files.map((f) => ({ src: OPTIONS_DIR + '/' + f, live: base(f) })) });
  }
  // The loose .def files of the folders above them (cvs2's ikemen_go/fight.def).
  for (let k = 1; k < depth; k++) {
    if (!vary.some((p) => p < k)) continue;
    const prefixes = [];
    for (const s of segs) { const pre = s.slice(0, k).join('/'); if (!prefixes.some((x) => eqi(x, pre))) prefixes.push(pre); }
    for (const pre of prefixes) {
      const files = filesIn(pre).filter((f) => /\.def$/i.test(f) && !fullNames.has(base(f).toLowerCase()));
      if (!files.length) continue;
      for (const f of files) keep(f);
      combos.push({ when: whenOf(pre.split('/'), k), files: files.map((f) => ({ src: OPTIONS_DIR + '/' + f, live: base(f) })) });
    }
  }
  // The Studio's picks: Ikemen GO's files, and the fewest slots that still
  // hold the roster (else the most).
  const pick = {};
  for (const g of groups) if (g.kind !== 'slots') pick[g.id] = g.kind === 'engine' ? (g.vals.find((v) => /ikemen/i.test(v)) || g.vals[0]) : g.vals[0];
  const modlib = require('./modlib.js');
  const fromOpt = (src) => src.slice(OPTIONS_DIR.length + 1);
  for (const g of groups.filter((x) => x.kind === 'slots')) {
    const need = Number.isFinite(o.cellsNeeded) ? o.cellsNeeded : 0;
    const usable = g.vals.map((v) => {
      const choice = Object.assign({}, pick, { [g.id]: v });
      for (const other of groups) if (other.kind === 'slots' && other !== g && choice[other.id] === undefined) choice[other.id] = other.vals[0];
      const c = combos.find((x) => Object.keys(x.when).length === vary.length && Object.entries(x.when).every(([k, val]) => choice[k] === val));
      const sys = c && c.files.find((f) => eqi(f.live, 'system.def'));
      const sel = c && c.files.find((f) => eqi(f.live, 'select.def'));
      const l = sel ? modlib.layoutFromSelectText(R.text(fromOpt(sel.src))) : (sys ? modlib.layoutFromSystemDefText(R.text(fromOpt(sys.src))) : null);
      return { v, usable: l ? l.usable : 0 };
    });
    const fit = usable.filter((u) => u.usable >= need).sort((a, b) => a.usable - b.usable)[0]
      || usable.slice().sort((a, b) => b.usable - a.usable)[0];
    pick[g.id] = fit.v;
  }
  const place = [];
  let chosen = null;
  for (const c of combos) {
    if (!Object.entries(c.when).every(([k, v]) => pick[k] === v)) continue;
    for (const f of c.files) {
      place.push({ from: fromOpt(f.src), rel: f.live });
      if (eqi(f.live, 'system.def') && Object.keys(c.when).length === vary.length) chosen = fromOpt(f.src);
    }
  }
  if (!chosen) return null;
  return {
    groups: groups.map((g) => ({
      id: g.id, label: g.label, kind: g.kind,
      choices: g.vals.map((v) => ({ id: v, label: g.kind === 'engine' ? madeForLabel(v) : v })),
      default: pick[g.id], defaultBy: 'studio', current: pick[g.id],
    })),
    combos, copies,
    split: { rootRel: art, chosen, place },
  };
}

// ---- what ships --------------------------------------------------------------

// The files of a theme folder an export carries, as a test on theme-relative
// paths - or null when the folder has no manifest, so an ordinary pack ships
// exactly as it always did. Left out: the manifest, the options store, and
// every state file the pack brought that the build's [Common] lines do not
// name (themecommon.js decides those; a Settings value naming one counts).
function shipFilter(themeDir, roster) {
  const m = readManifestRaw(themeDir);
  if (!m) return null;
  const out = new Set([MANIFEST.toLowerCase()]);
  for (const c of m.combos || []) for (const f of c.files || []) {
    if (f.src && f.live && posix(f.src).toLowerCase() !== posix(f.live).toLowerCase()) out.add(posix(f.src).toLowerCase());
  }
  const listed = new Set();
  if (m.common) {
    const roleFiles = new Set();
    for (const r of m.common.roles || []) for (const c of r.choices || []) { out.add(posix(c.file).toLowerCase()); roleFiles.add(posix(c.file).toLowerCase()); }
    for (const a of m.common.additions || []) out.add(posix(a.file).toLowerCase());
    const folder = path.basename(themeDir);
    const settings = (roster && roster.settings) || {};
    const setOn = (k) => !(settings[k] === undefined || settings[k] === null || settings[k] === '');
    let tc = null;
    try { tc = require('./themecommon.js').forRoster(roster || {}); } catch (e) { tc = null; }
    if (tc && tc.folder && tc.folder.toLowerCase() === folder.toLowerCase()) {
      for (const w of tc.wired) {
        const l = w.toLowerCase();
        // A States line set in Settings replaces the one that named it.
        if (roleFiles.has(l) && setOn('Common.States')) continue;
        listed.add(l);
      }
    }
    // A Settings value naming one of them (the Settings page wins over both).
    const prefix = ('data/' + folder + '/').toLowerCase();
    for (const [k, v] of Object.entries(settings)) {
      if (!/^Common\./i.test(k)) continue;
      for (const part of String(v).split(/[,;]/)) {
        const p = clean(part).toLowerCase();
        if (p.startsWith(prefix)) listed.add(p.slice(prefix.length));
      }
    }
  }
  for (const l of listed) out.delete(l);
  return (rel) => {
    const r = posix(rel).toLowerCase();
    return !out.has(r) && !r.startsWith(OPTIONS_DIR.toLowerCase() + '/');
  };
}

// ---- the choices (Theme tab and Settings > Engine) ----------------------------

function themeDirOf(folder) {
  const modlib = require('./modlib.js');
  const dir = modlib.themeFolderDir(folder);
  if (!dir) { const e = new Error('bad theme folder'); e.status = 400; throw e; }
  return dir;
}

// One change to a pack's common states, from either place that offers it:
//   { on: bool }                       the pack's states on or off
//   { role: 'tag', current: file|'@engine' }
//   { additions: { file: bool } }      a game system on or off
//   { debugFont: bool }                the pack's debug font, or the Studio's
//   { answered: true }                 the extra-systems question was answered
// Refused files cannot be chosen; nothing else about the pack changes.
function setCommon(folder, change) {
  const dir = themeDirOf(folder);
  const m = readManifest(dir);
  if (!m || !m.common) { const e = new Error('this screenpack has no common states of its own'); e.status = 404; throw e; }
  const c = m.common;
  const ch = change || {};
  if (ch.on !== undefined) { c.on = !!ch.on; c.onBy = 'user'; }
  if (ch.role !== undefined) {
    const r = (c.roles || []).find((x) => x.role === ch.role);
    if (!r) throw Object.assign(new Error('this screenpack has no ' + ch.role + ' file'), { status: 400 });
    if (ch.current === '@engine') r.current = '@engine';
    else {
      const pick = r.choices.find((x) => x.file === ch.current);
      if (!pick) throw Object.assign(new Error('no such file: ' + ch.current), { status: 400 });
      if (!pick.ok) throw Object.assign(new Error(pick.file + ' cannot be used: ' + (require('./zsslint.js').WHY_TEXT[pick.why] || pick.why)), { status: 400 });
      r.current = pick.file;
    }
  }
  if (ch.additions && typeof ch.additions === 'object') {
    for (const [file, on] of Object.entries(ch.additions)) {
      const a = (c.additions || []).find((x) => x.file === file);
      if (!a) throw Object.assign(new Error('no such file: ' + file), { status: 400 });
      if (on && !a.ok) throw Object.assign(new Error(a.file + ' cannot be used: ' + (require('./zsslint.js').WHY_TEXT[a.why] || a.why)), { status: 400 });
      a.on = !!on;
    }
  }
  if (ch.debugFont !== undefined && c.debugFont) c.debugFont.use = !!ch.debugFont;
  if (ch.answered) c.answered = true;
  // The lint's verdicts of this read are stored with it; they mean nothing on
  // their own, because every read computes them again from the files.
  writeManifest(dir, m);
  return view(folder);
}

// What the Theme tab card, the Settings > Engine switches and the extra-systems
// question show for one installed pack: the manifest's common part with the
// lint run again, and - when it is the pack in use - what the build will
// actually write and why anything is left out.
function view(folder, roster) {
  const dir = themeDirOf(folder);
  const m = readManifest(dir);
  // modlib.themeName's own rule (modlib does not export it): the [Info] name.
  let name = folder;
  try {
    const t = fs.readFileSync(path.join(dir, 'system.def'), 'latin1').slice(0, 4096);
    const nm = /^\s*name\s*=\s*"?([^"\r\n;]+)/mi.exec(t);
    name = (nm && nm[1].trim()) || folder;
  } catch (e) { name = folder; }
  const r = roster || require('./vfslib.js').readRoster();
  const inUse = String(r.motif || '').toLowerCase() === ('data/' + folder + '/system.def').toLowerCase();
  const out = { folder, name, inUse, manifest: !!m, common: null, build: null, options: null };
  // The pack's variants (slot counts, announcers), with what each would mean.
  if (m && (m.groups || []).length) {
    try { out.options = optionsView(dir, folder, m, r, inUse); } catch (e) { out.options = null; }
    try { out.libraryLifebar = !!require('./lifebars.js').normalizeMix((r.lifebarMix) || null).lifebar; } catch (e) { out.libraryLifebar = false; }
  }
  if (!m || !m.common) return out;
  const c = m.common;
  const tc = require('./themecommon.js');
  out.common = c;
  // What draws with the debug font, per file (font -1).
  const drawsDebug = (file) => {
    if (!insideTheme(dir, file)) return false;
    try { return tc.drawsWithDebugFont(fs.readFileSync(path.join(dir, ...posix(file).split('/')), 'latin1'), kindOf(file)); } catch (e) { return false; }
  };
  for (const ro of c.roles || []) for (const x of ro.choices || []) x.debugText = drawsDebug(x.file);
  for (const a of c.additions || []) a.debugText = drawsDebug(a.file);
  if (inUse) {
    let res = null;
    try { res = tc.forRoster(r); } catch (e) { res = null; }
    out.build = res ? { lines: res.lines, report: res.report, debugFont: res.debugFont, engagedIfUsed: res.engagedIfUsed } : null;
    try { out.libraryLifebar = !!require('./lifebars.js').normalizeMix((r.lifebarMix) || null).lifebar; } catch (e) { out.libraryLifebar = false; }
  }
  const lint = require('./zsslint.js');
  out.whyText = lint.WHY_TEXT;
  out.tagNote = tagNote(dir, c);
  return out;
}

// What the screenpack's own tag.zss changes against the engine's, from a
// table of files measured once and keyed by their bytes - a file not in it
// gets no claim at all, so the card never guesses.
const KNOWN_TAG_DIFFS = {
  // Infinite Legacy X 1.1.2's tag.zss against the 1.0 engine's data/tag.zss
  // (sha1 f4838005...): no [StateDef -4] (players turn only toward the enemy
  // tag leader), and a red-life regeneration block of its own (ILX
  // tag.zss:150-154).
  '79c1f060c38434e16791fa3b2889226efd808a4a': {
    engine: 'f4838005cf80e5d04a794bff13ac5d2d0a41a347',
    lacks: 'it keeps everyone turned toward the tag leader', adds: 'red-life regeneration',
  },
};
function tagNote(dir, c) {
  const r = (c.roles || []).find((x) => x.role === 'tag');
  if (!r) return null;
  const crypto = require('crypto');
  const sha1 = (p) => crypto.createHash('sha1').update(fs.readFileSync(p)).digest('hex');
  const named = r.choices.find((x) => stem(x.file).toLowerCase() === 'tag');
  if (!named || !insideTheme(dir, named.file)) return null;
  try {
    const known = KNOWN_TAG_DIFFS[sha1(path.join(dir, ...posix(named.file).split('/')))];
    if (!known) return null;
    // Only against the engine file it was measured against.
    const eng = engineRoles().find((x) => x.role === 'tag');
    if (!eng || !eng.abs || sha1(eng.abs) !== known.engine) return null;
    return { lacks: known.lacks, adds: known.adds };
  } catch (e) { return null; }
}

// ---- switching a variant (Theme tab) -----------------------------------------
//
// ON DISK, ALWAYS. The new files are written over the live ones, the way the
// author's instructions say to copy them, because everything that reads a
// screenpack reads the disk: E-Select, the lifebar editor, the layout reader,
// both exports. What the user changed in the live files is kept per
// COMBINATION of choices (`edited`, keyed by every group that writes the
// file - cvs2's system.def depends on both "made for" and the slot count) as
// <file>.<combination>.bak, never shipped, and comes back when that
// combination is chosen again. The menu music an imported build wrote into
// the system.def stays across every switch. The roster is re-laid only when
// asked; the fight-screen edits from Settings > Engine move onto the new fight
// def, in the SCREENPACK's own copy only (lifebar.resolveScreenpack), never a
// library lifebar's.

const curChoices = (m) => { const o = {}; for (const g of m.groups || []) o[g.id] = g.current; return o; };
const comboMatches = (when, choices) => Object.entries(when || {}).every(([k, v]) => choices[k] === v);
function writersOf(m, live) {
  const s = new Set();
  for (const c of m.combos || []) if ((c.files || []).some((f) => eqi(f.live, live))) for (const k of Object.keys(c.when || {})) s.add(k);
  return [...s].sort();
}
const comboKey = (m, live, choices) => writersOf(m, live).map((g) => g + '=' + choices[g]).join('|');
const comboSlug = (key) => key.replace(/=/g, '-').replace(/\|/g, '+').replace(/[^A-Za-z0-9_.+-]+/g, '_');
function srcFor(m, choices, live) {
  for (const c of m.combos || []) {
    if (!comboMatches(c.when, choices)) continue;
    const f = (c.files || []).find((x) => eqi(x.live, live));
    if (f) return f.src;
  }
  return null;
}
function livesOf(m, gid) {
  const out = [];
  for (const c of m.combos || []) {
    if (!c.when || !(gid in c.when)) continue;
    for (const f of c.files || []) if (!out.some((l) => eqi(l, f.live))) out.push(f.live);
  }
  return out;
}
const absIn = (dir, rel) => path.join(dir, ...posix(rel).split('/'));
// A manifest path that stays inside the theme folder. The installer writes
// only such paths, but a manifest is a file in a folder a pack came from:
// nothing it names is read or written outside that folder.
const insideTheme = (dir, rel) => {
  if (typeof rel !== 'string' || !rel || /^[a-z]:|^[\\/]/i.test(rel)) return false;
  const r = path.relative(dir, path.resolve(dir, ...posix(rel).split('/')));
  return !!r && !r.startsWith('..') && !path.isAbsolute(r);
};
const readBuf = (p) => { try { return fs.readFileSync(p); } catch (e) { return null; } };
function writeAtomic(p, buf) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = p + '.__new';
  fs.writeFileSync(tmp, buf);
  fs.renameSync(tmp, p);
}
// The theme's own file of that name, as the disk spells it.
function themeFile(dir, name) {
  const hit = listDir(dir).find((e) => e.isFile() && eqi(e.name, name));
  return hit ? path.join(dir, hit.name) : null;
}

// A system.def's [Music] bgm keys (title.bgm, title.bgm.loop...): lowercase
// key -> { key, value }.
function musicOf(text) {
  const out = new Map();
  let sec = '';
  for (const raw of String(text || '').split(/\r?\n/)) {
    const s = /^\s*\[\s*([^\]]+?)\s*\]/.exec(raw);
    if (s) { sec = s[1].toLowerCase(); continue; }
    if (sec !== 'music') continue;
    const kv = /^\s*([^=;\s][^=;]*?)\s*=\s*([^;\r\n]*?)\s*(;.*)?$/.exec(raw);
    if (kv && /bgm/i.test(kv[1]) && !out.has(kv[1].toLowerCase())) out.set(kv[1].toLowerCase(), { key: kv[1], value: kv[2] });
  }
  return out;
}
// The same file without those lines: a switch carries them over itself, so
// they are not an edit to keep.
function withoutMusic(text) {
  let sec = '';
  return String(text || '').split(/\r?\n/).filter((raw) => {
    const s = /^\s*\[\s*([^\]]+?)\s*\]/.exec(raw);
    if (s) { sec = s[1].toLowerCase(); return true; }
    if (sec !== 'music') return true;
    const k = /^\s*([^=;]+?)\s*=/.exec(raw);
    return !(k && /bgm/i.test(k[1]));
  }).join('\n');
}
// What themeLayout(folder, { fromSystemDef: true }) would read from these texts.
function layoutOfTexts(sysText, selText) {
  const modlib = require('./modlib.js');
  if (selText !== null && selText !== undefined) {
    const l = modlib.layoutFromSelectText(selText);
    return l ? Object.assign(l, { source: 'select.def' }) : null;
  }
  return sysText ? modlib.layoutFromSystemDefText(sysText) : null;
}
const sameCells = (a, b) => (!a && !b) || (!!a && !!b && a.cells.length === b.cells.length && a.cells.every((c, i) => c === b.cells[i]));
// The engine's grid: rows x columns of the first [Select Info].
function gridOf(sysText) {
  const l = sysText ? require('./modlib.js').layoutFromSystemDefText(sysText) : null;
  return l ? { rows: l.rows, columns: l.columns, cells: l.rows * l.columns } : null;
}
const latin = (b) => (b ? b.toString('latin1') : '');
const libraryLifebarOf = (roster) => {
  try { const lbs = require('./lifebars.js'); return !!lbs.normalizeMix((roster || {})[lbs.MIX_KEY] || null).lifebar; } catch (e) { return false; }
};
const isLocked = (c) => require('./public/ikemen/motif-core.js').isLockOn(c && c.locked);

// Everything a switch would write, worked out without writing it.
function switchWork(folder, gid, cid) {
  const modlib = require('./modlib.js');
  const dir = themeDirOf(folder);
  const m = readManifest(dir);
  if (!m || !(m.groups || []).length) throw Object.assign(new Error('this screenpack has no options'), { status: 404 });
  const g = m.groups.find((x) => x.id === gid);
  if (!g) throw Object.assign(new Error('this screenpack has no option ' + JSON.stringify(gid)), { status: 400 });
  const ch = (g.choices || []).find((x) => x.id === cid);
  if (!ch) throw Object.assign(new Error(g.label + ' has no choice ' + JSON.stringify(cid)), { status: 400 });
  m.edited = m.edited && typeof m.edited === 'object' ? m.edited : {};
  const cur = curChoices(m);
  const next = Object.assign({}, cur, { [gid]: cid });
  const items = [];
  const outside = (rel) => rel && !insideTheme(dir, rel);
  if (cur[gid] !== cid) {
    for (const live of livesOf(m, gid)) {
      const newSrc = srcFor(m, next, live);
      if (!newSrc) continue;
      const oldSrc = srcFor(m, cur, live);
      const oldKey = comboKey(m, live, cur), newKey = comboKey(m, live, next);
      const bak = (m.edited[live] || {})[newKey];
      if ([live, newSrc, oldSrc, bak, (m.edited[live] || {})[oldKey]].some(outside)) {
        throw Object.assign(new Error('this screenpack’s options name a file outside its folder, so nothing was switched'), { status: 409 });
      }
      const isRoot = eqi(live, 'system.def');
      const liveBuf = readBuf(absIn(dir, live));
      const fromBak = bak && fs.existsSync(absIn(dir, bak)) ? bak : null;
      const inBuf = readBuf(absIn(dir, fromBak || newSrc));
      // Every file must be there before anything is written.
      if (!inBuf) throw Object.assign(new Error('this choice is missing ' + (fromBak || newSrc) + ' in the screenpack folder, so nothing was switched'), { status: 409 });
      // What the current choice would have put here: the user's edits are the difference.
      let produced = null;
      const ob = oldSrc ? readBuf(absIn(dir, oldSrc)) : null;
      if (ob) produced = isRoot ? Buffer.from(modlib.patchInstalledMotif(dir, folder, latin(ob)), 'latin1') : ob;
      let edited = false;
      if (liveBuf && produced) edited = isRoot ? withoutMusic(latin(liveBuf)) !== withoutMusic(latin(produced)) : !liveBuf.equals(produced);
      else if (liveBuf && !oldSrc) edited = true;
      // Menu music that differs from what the pack's own text gives: kept.
      const music = [];
      if (isRoot && liveBuf && produced) {
        const was = musicOf(latin(produced));
        for (const [k, v] of musicOf(latin(liveBuf))) { const p = was.get(k); if (p && p.value !== v.value) music.push(v); }
      }
      let incoming = inBuf;
      if (isRoot) {
        let t = modlib.patchInstalledMotif(dir, folder, latin(inBuf));
        const bi = require('./buildimport.js');
        for (const mk of music) t = bi.setMotifBgm(t, mk.key, mk.value);
        incoming = Buffer.from(t, 'latin1');
      }
      items.push({ live, oldSrc, newSrc, oldKey, newKey, isRoot, liveBuf, edited, oldBak: (m.edited[live] || {})[oldKey] || null, music, fromBak, incoming });
    }
  }
  return { dir, m, g, ch, cur, next, items };
}

// What the switch does to the grid: the layout read from the files before and
// after, and the engine's grid size after.
function gridWork(w, folder, roster) {
  if (!w.items.some((it) => eqi(it.live, 'system.def') || eqi(it.live, 'select.def'))) return null;
  const modlib = require('./modlib.js');
  const sysIt = w.items.find((it) => eqi(it.live, 'system.def'));
  const selIt = w.items.find((it) => eqi(it.live, 'select.def'));
  const sysNow = latin(readBuf(path.join(w.dir, 'system.def')));
  const selPath = themeFile(w.dir, 'select.def');
  const selNow = selPath ? latin(readBuf(selPath)) : null;
  const sysIn = sysIt ? latin(sysIt.incoming) : sysNow;
  const selIn = selIt ? latin(selIt.incoming) : selNow;
  return {
    inUse: eqi(String((roster && roster.motif) || ''), 'data/' + folder + '/system.def'),
    before: modlib.themeLayout(folder, { fromSystemDef: true }),
    after: layoutOfTexts(sysIn, selIn),
    grid: gridOf(sysIn),
    selectInfoChanged: sectionText(sysNow, 'select info') !== sectionText(sysIn, 'select info'),
  };
}

// The screenpack's own fight def among the files a switch writes, and its
// copy from Settings > Engine (lifebar.resolveScreenpack - never resolve(),
// which answers with a library lifebar's copy when one is chosen).
function fightWork(w, folder) {
  let res = null;
  try { res = require('./lifebar.js').resolveScreenpack({ motif: 'data/' + folder + '/system.def' }); } catch (e) { res = null; }
  if (!res || !res.source) return null;
  const rel = posix(path.relative(w.dir, res.source));
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  const it = w.items.find((x) => eqi(x.live, rel));
  if (!it) return null;
  return { res, it, own: fs.existsSync(res.ownPath) };
}
function rebaseOf(fw) {
  if (!fw || !fw.own) return null;
  const lifebar = require('./lifebar.js');
  const ownText = latin(readBuf(fw.res.ownPath));
  const newLive = latin(fw.it.incoming);
  const values = {};
  const notCarried = [];
  for (const [id, v] of Object.entries(lifebar.changedFrom(latin(fw.it.liveBuf), ownText))) {
    if (v.now !== null) values[id] = v.now; else notCarried.push(id);
  }
  try {
    const newOwn = lifebar.applyEdits(newLive, values, { fonts: lifebar.fontsOf(lifebar.readDef(newLive)) });
    return { ok: true, fields: Object.keys(values).length, notCarried, newOwn };
  } catch (e) {
    return { ok: false, why: e.code || e.message, field: e.field || null, fields: Object.keys(values).length, notCarried };
  }
}

// The cells characters take that lie past the grid's last cell.
function pastGrid(chars, cells) {
  if (!cells) return 0;
  const { at } = require('./modlib.js').cellIndexes(chars || []);
  const past = new Set();
  (chars || []).forEach((c, i) => { if (c && !c.kind && at[i] !== null && at[i] >= cells) past.add(at[i]); });
  return past.size;
}

// THE DRY RUN (GET /api/theme-options/plan): what switching would do, for the
// dialog that asks first. Writes nothing.
function plan(folder, gid, cid) {
  const modlib = require('./modlib.js');
  const roster = require('./vfslib.js').readRoster();
  const w = switchWork(folder, gid, cid);
  const gw = gridWork(w, folder, roster);
  const fw = fightWork(w, folder);
  const chars = roster.chars || [];
  const { at } = modlib.cellIndexes(chars);
  const cellsNeeded = modlib.rosterCellsNeeded(chars);
  const wears = roster.layoutFrom === folder;
  const moves = !!gw && gw.inUse && !sameCells(gw.before, gw.after);
  const cells = gw && gw.grid ? gw.grid.cells : null;
  const eff = {
    entries: chars.filter((c, i) => c && !c.kind && at[i] !== null).length,
    cellsNeeded,
    cells, usable: gw && gw.after ? gw.after.usable : null,
    reserved: gw && gw.after ? gw.after.holes : null,
    pastGrid: 0, pastGridRelay: 0,
    // Offered only onto a layout that reserves cells: that is what it lays out.
    relayOffered: moves && !!gw.after && gw.after.holes > 0, relayDefault: false, relayMoves: 0, lockedMoving: 0, ownPlaceholders: 0,
    clearsLayout: moves && wears,
    fits: 0, editedKept: [], editedBack: [], musicKept: [], rebase: null, rebaseLibrary: false,
  };
  if (gw && gw.inUse) {
    // Without a re-lay: the roster stays, minus the old layout's empty cells
    // when it wears this pack's layout.
    const kept = moves && wears ? chars.filter((c) => c.kind !== 'skip' || isLocked(c)) : chars;
    eff.pastGrid = pastGrid(kept, cells);
    if (eff.relayOffered) {
      eff.relayDefault = wears;
      const placed = modlib.relayChars(chars, gw.after).placed;
      eff.pastGridRelay = pastGrid(placed, cells);
      const now = new Map(), then = new Map();
      chars.forEach((c, i) => now.set(c, at[i]));
      const at2 = modlib.cellIndexes(placed).at;
      placed.forEach((c, i) => then.set(c, at2[i]));
      eff.relayMoves = chars.filter((c) => c && !c.kind && then.has(c) && then.get(c) !== now.get(c)).length;
      eff.lockedMoving = chars.filter((c) => isLocked(c) && (!then.has(c) || then.get(c) !== now.get(c))).length;
      eff.ownPlaceholders = chars.filter((c) => c && (c.kind === 'random' || c.kind === 'dummy')).length;
    }
  }
  if (gw && gw.selectInfoChanged) {
    eff.fits = chars.filter((c) => c && c.portraitFit && Object.keys(c.portraitFit).some((k) => eqi(k, folder) && c.portraitFit[k] && Object.keys(c.portraitFit[k]).length)).length;
  }
  for (const it of w.items) {
    if (it.edited) eff.editedKept.push(it.live);
    if (it.fromBak) eff.editedBack.push(it.live);
    for (const mk of it.music) if (!eff.musicKept.includes(mk.key)) eff.musicKept.push(mk.key);
  }
  const rb = rebaseOf(fw);
  if (rb) eff.rebase = { ok: rb.ok, fields: rb.fields, notCarried: rb.notCarried, why: rb.why || null };
  eff.rebaseLibrary = !!rb && libraryLifebarOf(roster);
  const needsConfirm = eff.pastGrid > 0 || eff.relayDefault || eff.clearsLayout || eff.fits > 0
    || eff.editedKept.length > 0 || eff.musicKept.length > 0 || !!eff.rebase || eff.rebaseLibrary;
  return {
    folder, group: gid, choice: cid, label: w.ch.label, groupLabel: w.g.label, changes: w.items.length > 0,
    files: w.items.map((it) => it.live), needsConfirm, effects: eff,
  };
}

// THE SWITCH (POST /api/theme-options { folder, group, choice, relay }).
function choose(folder, gid, cid, relay) {
  const modlib = require('./modlib.js');
  const vfs = require('./vfslib.js');
  const lbs = require('./lifebars.js');
  const roster = vfs.readRoster();
  const w = switchWork(folder, gid, cid);
  if (w.cur[gid] === cid) return { ok: true, changed: false, group: gid, choice: cid, label: w.ch.label };
  const gw = gridWork(w, folder, roster);
  const fw = fightWork(w, folder);
  // 1-2. What the user changed in the outgoing files is kept for their combination.
  const saved = [];
  for (const it of w.items) {
    if (it.edited && it.liveBuf) {
      const bak = posix(it.live) + '.' + comboSlug(it.oldKey) + '.bak';
      writeAtomic(absIn(w.dir, bak), it.liveBuf);
      (w.m.edited[it.live] = w.m.edited[it.live] || {})[it.oldKey] = bak;
      saved.push(it.live);
    } else if (!it.edited && it.oldBak) {
      // Back to the pack's own text since then: those edits are gone, and so
      // is their copy, or choosing this again would bring them back.
      try { lbs.rmFile(absIn(w.dir, it.oldBak)); } catch (e) { /* left behind; never shipped (.bak) */ }
      delete w.m.edited[it.live][it.oldKey];
      if (!Object.keys(w.m.edited[it.live]).length) delete w.m.edited[it.live];
    }
  }
  // 3-4. The new files, then the manifest; a failure puts back what was written.
  const done = [];
  try {
    for (const it of w.items) {
      const p = absIn(w.dir, it.live);
      writeAtomic(p, it.incoming);
      done.push({ p, prev: it.liveBuf });
    }
    w.g.current = cid;
    writeManifest(w.dir, w.m);
  } catch (e) {
    for (const d of done.reverse()) {
      try { if (d.prev) writeAtomic(d.p, d.prev); else lbs.rmFile(d.p); } catch (err) { /* reported below */ }
    }
    throw e;
  }
  // 5. The roster, when it uses this pack and the grid's shape changed.
  let layout = null;
  if (gw && gw.inUse) {
    const afterNow = modlib.themeLayout(folder, { fromSystemDef: true });
    if (sameCells(gw.before, afterNow)) layout = { how: 'same' };
    else if (relay) {
      const r = modlib.applyThemeLayout(folder, { fromSystemDef: true });
      layout = r.error ? { how: 'none', error: r.error } : Object.assign({ how: 'relaid' }, r);
    } else {
      const r = vfs.readRoster();
      if (r.layoutFrom === folder) {
        // The old layout's reserved cells no longer match: taken out (a
        // locked one stays, the setTheme rule), and the roster closes up.
        const before = (r.chars || []).length;
        r.chars = (r.chars || []).filter((c) => c.kind !== 'skip' || isLocked(c));
        delete r.layoutFrom;
        vfs.writeRoster(r);
        layout = { how: 'cleared', dropped: before - r.chars.length };
      } else layout = { how: 'kept' };
    }
  }
  // 6. The screenpack's own fight-def copy follows the new fight def.
  let rebase = null;
  const rb = rebaseOf(fw);
  if (rb && rb.ok) {
    const charedit = require('./charedit.js');
    writeAtomic(charedit.backupPath(fw.res.ownPath), fw.it.incoming);
    writeAtomic(fw.res.ownPath, Buffer.from(rb.newOwn, 'latin1'));
    rebase = { ok: true, fields: rb.fields, notCarried: rb.notCarried };
  } else if (rb) rebase = { ok: false, why: rb.why, field: rb.field, fields: rb.fields, notCarried: rb.notCarried };
  return {
    ok: true, changed: true, group: gid, choice: cid, label: w.ch.label, groupLabel: w.g.label,
    files: w.items.map((it) => it.live),
    saved, restored: w.items.filter((it) => it.fromBak).map((it) => it.live),
    music: [...new Set([].concat(...w.items.map((it) => it.music.map((mk) => mk.key))))],
    layout, rosterMoved: !!layout && (layout.how === 'relaid' || layout.how === 'cleared'),
    rebase, rebaseLibrary: !!rebase && libraryLifebarOf(roster),
  };
}

// The options part of view(): per group, its choices and what each means.
function optionsView(dir, folder, m, roster, inUse) {
  const modlib = require('./modlib.js');
  const cur = curChoices(m);
  const edited = m.edited || {};
  const sysNow = latin(readBuf(path.join(dir, 'system.def')));
  const selPath = themeFile(dir, 'select.def');
  const selNow = selPath ? latin(readBuf(selPath)) : null;
  const liveLayout = modlib.themeLayout(folder, { fromSystemDef: true });
  const cellsNeeded = modlib.rosterCellsNeeded(roster.chars || []);
  const factsOf = (layout, sysText) => {
    const g = gridOf(sysText);
    return g && layout ? { rows: g.rows, columns: g.columns, cells: g.cells, reserved: layout.holes, usable: layout.usable, source: layout.source || 'select.def' } : null;
  };
  return {
    cellsNeeded, inUse, wears: roster.layoutFrom === folder,
    groups: m.groups.map((g) => {
      const lives = livesOf(m, g.id);
      return {
        id: g.id, label: g.label, kind: g.kind, default: g.default, defaultBy: g.defaultBy, current: g.current, files: lives,
        choices: (g.choices || []).map((c) => {
          const next = Object.assign({}, cur, { [g.id]: c.id });
          // "(your edits)": a kept copy for the combination this choice makes.
          const yours = c.id !== g.current && lives.some((l) => { const b = (edited[l] || {})[comboKey(m, l, next)]; return !!b && insideTheme(dir, b) && fs.existsSync(absIn(dir, b)); });
          let grid = null;
          if (g.kind === 'slots') {
            if (c.id === g.current) grid = factsOf(liveLayout, sysNow);
            else {
              const sys = srcFor(m, next, 'system.def'), sel = srcFor(m, next, 'select.def');
              const sysText = sys && insideTheme(dir, sys) ? latin(readBuf(absIn(dir, sys))) : sysNow;
              const selText = sel && insideTheme(dir, sel) ? latin(readBuf(absIn(dir, sel))) : selNow;
              grid = factsOf(layoutOfTexts(sysText, selText), sysText);
            }
          }
          return { id: c.id, label: c.label, edited: yours, grid };
        }),
      };
    }),
  };
}

module.exports = {
  MANIFEST, OPTIONS_DIR, STATES_DIR, THEME_STATES_KEY,
  readManifest, readManifestRaw, writeManifest, scanPack, shipFilter, setCommon, view,
  plan, choose, comboKey, comboSlug, insideTheme, fontImage,
  // pure, for the tests
  headersOf, roleOf, engineRoles, gameRootOf, readPackConfig, readmeFont, readmeNames, isEngineDataFolder, plainName, findCI,
};
