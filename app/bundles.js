'use strict';
// CONTENT BUNDLES: list them, make a new one, choose which one opens next.
//
// A bundle is a whole set of content - characters, stages, music, themes and
// the roster that picks among them. layout.js already resolves every folder
// through the active bundle; this is the part a person uses.
//
// WHERE THEY LIVE (layout.ACTIVE_BUNDLE.mode):
//   checkout  "Main" is the content beside the program, exactly where it has
//             always been. Other bundles are folders under Content/ and are
//             reached by `"content": "Content/<name>"` in studio-layout.json;
//             switching back to Main removes that key.
//   portable  Content/ holds `default` and its siblings; switching sets
//             `"bundle": "<name>"`.
//
// SWITCHING APPLIES ON RESTART. Every module reads its folders once, at start,
// and the desktop window starts the server once. So a switch only writes the
// choice; the Studio says "close and reopen" and nothing moves under a running
// server.
//
// A NEW BUNDLE starts empty with one stage - the engine's own Mountainside
// Temple from release-v2 - so its build is valid before anything is added.
//
// THAT STAGE IS A FLOOR, NOT A GIFT. It is there because the engine needs a
// stage to start and an empty bundle has none of its own. A caller that is
// about to fill the bundle from somewhere that brings stages - the whole-build
// import - asks for it not to be laid down (`create(name, L, { seedStage:
// false })`), because a stage nobody chose sitting in somebody else's roster is
// a bug, not a safety net: the engine stage turned up in an imported CvS roster
// under a neighboring stage's name, and a build of its own called kfm.def
// would have been shadowed by it. seedStage() is the same copy either way, so
// whoever ends up with no stage at all can still be handed one afterwards.
const fs = require('fs');
const path = require('path');

// 1-40 characters, ASCII only (Node's own delete skips a non-ASCII path without
// a word), starting with a letter or digit and NOT ending in a dot or a space:
// Node makes exactly the "Build v1." folder asked for, and most Windows tools
// cannot open or delete it.
const NAME_RE = /^[A-Za-z0-9](?:[A-Za-z0-9 _.-]{0,38}[A-Za-z0-9_-])?$/;
const RESERVED = new Set(['main', 'default', 'content']);

function hasRoster(dir) {
  try { return fs.statSync(path.join(dir, 'roster.json')).isFile(); } catch (e) { return false; }
}
// An external build's record (openExternal below), or null for a bundle of
// the Studio's own. One that is there and cannot be read still marks the
// bundle external - and read-only - with no root.
function externalOf(dir) {
  let text;
  try { text = fs.readFileSync(path.join(dir, 'external.json'), 'utf8'); } catch (e) { return e.code === 'ENOENT' ? null : { root: '' }; }
  try {
    const v = JSON.parse(text.replace(/^﻿/, ''));
    return { root: v && typeof v.root === 'string' ? v.root : '' };
  } catch (e) { return { root: '' }; }
}
function counts(dir, L) {
  try {
    const r = JSON.parse(fs.readFileSync(path.join(dir, 'roster.json'), 'utf8').replace(/^\uFEFF/, ''));
    return { characters: (r.chars || []).filter((c) => !c.kind).length, stages: (r.stages || []).length };
  } catch (e) { return { characters: null, stages: null }; }
}

// Where named bundles are made and found, and how a bundle is chosen.
function home(L) {
  if (L.ACTIVE_BUNDLE.mode === 'portable') return L.CONTENT_ROOT;
  return path.join(L.APP, 'Content');
}

// Every bundle, with the one running now and the one that opens next.
function list(L) {
  L = L || require('./layout.js');
  const mode = L.ACTIVE_BUNDLE.mode;
  const file = L.readLayoutFile();
  const out = [];
  if (mode === 'checkout') out.push({ id: '', name: 'Main', dir: L.APP, main: true });
  let names = [];
  try { names = fs.readdirSync(home(L), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch (e) { names = []; }
  for (const n of names.sort((a, b) => a.localeCompare(b))) {
    const dir = path.join(home(L), n);
    if (!hasRoster(dir)) continue;
    const ext = externalOf(dir);
    out.push(Object.assign({ id: n, name: n, dir, main: mode === 'portable' && n === 'default' },
      ext ? { external: true, readOnly: true, root: ext.root } : {}));
  }
  // Which id the layout file names now (applies on restart).
  let next;
  if (mode === 'portable') next = String(file.bundle || 'default');
  else next = file.content ? path.basename(path.resolve(L.APP, String(file.content))) : '';
  const activeId = mode === 'portable' ? L.BUNDLE : (L.ACTIVE_BUNDLE.main ? '' : path.basename(L.CONTENT));
  for (const b of out) Object.assign(b, counts(b.dir, L), { active: b.id === activeId, next: b.id === next });
  return { mode, active: activeId, next, pending: next !== activeId, bundles: out,
    exportSuffix: L.EXPORT_SUFFIX, desktopExport: L.DESKTOP_EXPORT };
}

// WHERE A CHOSEN EXPORT FOLDER MAY NOT BE. Both exporters empty their folder
// first, and their own checks (export.js checkExportFolder, desktop.js
// checkBuildFolder) know the shape of a build, not whose it is: an Ikemen GO
// install opened read-only keeps the stock Ikemen_GO.exe, so the desktop
// export took it for a build it may replace and emptied it. So a chosen folder
// is held against every bundle too: refused when it is, or lies under, a build
// open read-only or a bundle's folder. The checkout's Main is the exception:
// its folder is the program folder, which server.js exportDest refuses by
// equality only, so <program>/dist-* keeps working. And refused when it HOLDS
// any of them, or the program, the Settings folder or the bundles folder: a
// Studio copy extracted inside the Ikemen GO install it exports to would see
// the install emptied with the copy in it.
// Every path is asked by name AND by real path, on both sides: a build opened
// through a junction and picked by its real path (or the other way round) is
// the same build. A folder not made yet is asked by its nearest existing
// parent's real path.
// -> '' when the folder is free, else the sentence that says whose it is.
function exportClash(dest, L) {
  L = L || require('./layout.js');
  const fold = (p) => { const r = path.resolve(p); return process.platform === 'win32' ? r.toLowerCase() : r; };
  const atOrUnder = (p, dir) => {
    const rel = path.relative(fold(dir), fold(p));
    return rel === '' || (rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel));
  };
  const realOf = (p) => {
    const tail = [];
    for (let head = path.resolve(p); ;) {
      try { return path.join(fs.realpathSync.native(head), ...tail); } catch (e) { /* not there: ask its parent */ }
      const up = path.dirname(head);
      if (up === head) return path.resolve(p);
      tail.unshift(path.basename(head));
      head = up;
    }
  };
  const forms = (p) => { const a = path.resolve(String(p)), r = realOf(a); return fold(r) === fold(a) ? [a] : [a, r]; };
  const asked = forms(dest);
  const under = (dir) => forms(dir).some((d) => asked.some((p) => atOrUnder(p, d)));
  const holds = (dir) => forms(dir).some((d) => asked.some((p) => atOrUnder(d, p)));
  const cur = list(L);
  for (const b of cur.bundles) {
    if (!b.external || !b.root || !under(b.root)) continue;
    return forms(b.root).some((r) => asked.some((p) => fold(p) === fold(r)))
      ? 'that is the Ikemen GO build "' + b.name + '" the Studio has open read-only - an export would replace it; pick another folder'
      : 'that folder is inside the Ikemen GO build "' + b.name + '" the Studio has open read-only - an export would write into it; pick another folder';
  }
  for (const b of cur.bundles) {
    if (b.main && cur.mode === 'checkout') continue;
    if (under(b.dir)) return 'that folder belongs to the bundle "' + b.name + '" - pick a folder outside it';
  }
  for (const own of [L.APP, L.SETTINGS_DIR, home(L), L.CONTENT_ROOT, L.CONTENT]) {
    if (own && holds(own)) return 'that folder holds this Studio\'s own folders (' + own + ') - an export would empty it; pick a folder outside them';
  }
  for (const b of cur.bundles) {
    if (holds(b.dir)) return 'that folder holds the bundle "' + b.name + '" - an export would empty it; pick a folder outside it';
  }
  for (const b of cur.bundles) {
    if (b.external && b.root && holds(b.root)) return 'that folder holds the Ikemen GO build "' + b.name + '" the Studio has open read-only - an export would empty it; pick another folder';
  }
  return '';
}

// Choose the bundle that opens next. Nothing moves until the program restarts.
function switchTo(id, L) {
  L = L || require('./layout.js');
  const cur = list(L);
  const b = cur.bundles.find((x) => x.id === String(id == null ? '' : id));
  if (!b) throw new Error('no such bundle: ' + id);
  if (cur.mode === 'portable') L.writeLayoutKeys({ bundle: b.id === 'default' ? undefined : b.id });
  else L.writeLayoutKeys({ content: b.id ? 'Content/' + b.id : undefined });
  return list(L);
}

// THE ENGINE'S OWN STAGE, laid into a bundle. Kept as a function of its own
// because two callers need it: a new bundle, and an import whose build turned
// out to bring no stage of its own after all.
const SEED_STAGE_FILES = ['kfm.def', 'kfm.sff'];
const SEED_STAGE_NAME = 'Mountainside Temple';

function seedStageSource(L) {
  const src = path.join(L.dir('release-v2'), 'stages');
  const files = SEED_STAGE_FILES.map((f) => path.join(src, f));
  for (const f of files) if (!fs.existsSync(f)) throw new Error('cannot find the engine stage to start from: ' + f);
  return files;
}

// Copies the files and returns the roster entry for them; the caller decides
// where in roster.stages it goes.
function seedStage(dir, L) {
  L = L || require('./layout.js');
  const files = seedStageSource(L);
  const to = path.join(dir, L.folderName('stages'));
  fs.mkdirSync(to, { recursive: true });
  for (const f of files) fs.copyFileSync(f, path.join(to, path.basename(f)));
  return { file: SEED_STAGE_FILES[0], name: SEED_STAGE_NAME, music: '' };
}

// THE BUNDLE'S ONLINE SETUP: the five Settings > Online values a bundle keeps
// in its own roster.json - the leaderboard address, the online-menu switch,
// the match mode, the leaderboard page and the board's look. The relay and
// TURN live in local-config.json (this install), and so does a leaderboard's
// admin key (per address), so those carry to every bundle on their own. A new
// bundle takes these five from the open one when asked (create opts.online), and
// Settings > Online copies them from any bundle that has them, so a small
// test bundle does not mean typing the setup in again.
const ONLINE_KEYS = ['identityUrl', 'onlineName', 'queueMode', 'leaderboardPage', 'leaderboardLook'];
function onlineOf(roster) {
  const out = {};
  for (const k of ONLINE_KEYS) {
    const v = roster ? roster[k] : undefined;
    if (v !== undefined && v !== null && v !== '' && v !== false) out[k] = JSON.parse(JSON.stringify(v));
  }
  return out;
}
// Every bundle whose roster.json holds an online setup: [{ id, name, active, online }].
function onlineSetups(L) {
  L = L || require('./layout.js');
  const out = [];
  for (const b of list(L).bundles) {
    let r = null;
    try { r = JSON.parse(fs.readFileSync(path.join(b.dir, 'roster.json'), 'utf8')); } catch (e) { r = null; }
    const online = onlineOf(r);
    if (Object.keys(online).length) out.push({ id: b.id, name: b.name, active: !!b.active, online });
  }
  return out;
}

// Make an empty bundle with one stage. Does not switch to it.
// `opts.seedStage === false` leaves the stage out - see the note at the top.
// `opts.online` (a roster, or what onlineOf gives) is the online setup it starts with.
function create(name, L, opts) {
  L = L || require('./layout.js');
  const wantSeed = !(opts && opts.seedStage === false);
  const n = String(name || '').trim();
  if (!NAME_RE.test(n)) throw new Error('a bundle name is 1-40 characters from A-Z, 0-9, space, dot, dash or underscore, starting with a letter or digit and not ending in a dot or space');
  if (RESERVED.has(n.toLowerCase())) throw new Error('"' + n + '" is reserved - pick another name');
  const dir = path.join(home(L), n);
  const exists = (() => { try { return fs.readdirSync(home(L)).some((x) => x.toLowerCase() === n.toLowerCase()); } catch (e) { return false; } })();
  if (exists) throw new Error('a bundle or folder called "' + n + '" already exists');
  // Checked BEFORE the folder is made, so a missing engine stage never gets as
  // far as leaving one behind.
  if (wantSeed) seedStageSource(L);
  // The folder names inside a bundle follow the layout's physical names, so a
  // portable copy's bundle has characters/ where a checkout's has cache/.
  const phys = (logical) => L.folderName(logical);
  fs.mkdirSync(dir, { recursive: true });
  try {
    for (const k of ['cache', 'stages', 'music', 'themes', 'portraits', 'palettes']) fs.mkdirSync(path.join(dir, phys(k)), { recursive: true });
    const seeded = wantSeed ? seedStage(dir, L) : null;
    const roster = {
      publicChars: [], publicStages: seeded ? [seeded.file] : [],
      stages: seeded ? [seeded] : [],
      chars: [], titleMusic: '', selectMusic: '',
      siteTitle: n,
      // made since the H-MUGEN module: it asks before any H side shows (hmodule.js)
      hModule: 'unasked',
    };
    Object.assign(roster, onlineOf(opts && opts.online));
    fs.writeFileSync(path.join(dir, 'roster.json'), JSON.stringify(roster, null, 2) + '\n');
  } catch (e) {
    // Half a bundle is worse than none: it would list, open, and have no roster.
    // A checked delete (lifebars.js); if even that fails, the error says so.
    try { require('./lifebars.js').rmTree(dir); } catch (e2) {
      e.message = e.message + ' - and the half-made folder "' + n + '" could not be removed (' + e2.message + ')';
    }
    throw e;
  }
  return list(L);
}

// ---- an external build, opened where it is -----------------------------------
//
// A whole MUGEN or Ikemen GO install can be IMPORTED (buildimport.run), which
// copies it into a bundle of its own - the right thing for a build that is
// going to be edited, and forty-seven gigabytes of copying for one that is
// only going to be looked at and played. OPENING it instead copies nothing:
// the bundle folder gets external.json, which names the build's folder, and a
// roster.json made from the build's own select.def, and layout.js points the
// bundle's characters, stages, music and screenpacks into the build itself.
// Such a bundle is read-only (layout.js, readonlyfs.js): the build is
// somebody's game, so the Studio inspects it and never writes to it.
//
// THE ROSTER IS THE IMPORT'S, MINUS EVERY COPY. Each roster line is the entry
// buildimport.runInspected would write - the same mount names, the same cell
// walk, the same params carried and the same ones held back - except that
// `folder` is the character's folder in the build's chars/ as the disk spells
// it, a stage's `file` is its path under the build's stages/, and the
// screenpack is the build's own, read where it is. What the Studio's readers
// cannot reach in place is listed as skipped rather than refused: a zipped
// character, a def that will not read, a stage kept outside stages/, a
// screenpack outside data/.
//
// THE RECORD AND THE ROSTER LIVE IN THE STUDIO'S CONTENT FOLDER, never in the
// build - which is also why a build that holds the Studio's own folders is
// refused: with those inside it, the Studio could not write its own files.

// The build's own spelling of a top-level folder, or the usual name.
function spelled(bi, root, name, ls) {
  const hit = bi.resolve(root, name, ls);
  return hit && !hit.rel.includes('/') ? hit.rel : name;
}

// `music = sound/x.mp3 80 100 200` names a path and then volume and loop
// numbers; the path ends at its last audio extension (buildimport's rule).
function musicParamPath(v) {
  const str = String(v || '').replace(/;.*$/, '').trim();
  const re = /\.(ogg|mp3|wav|flac|midi?|xm|mod|it|s3m)/ig;
  let end = -1, m;
  while ((m = re.exec(str))) end = Math.max(end, m.index + m[0].length);
  return (end < 0 ? str : str.slice(0, end)).replace(/^"|"$/g, '').trim();
}

// inspect()'s reading of a build -> { roster, skipped, folders, common }.
// Pure: reads nothing the inventory has not already read, writes nothing.
function externalRoster(inv, name) {
  const bi = require('./buildimport.js');
  const modlib = require('./modlib.js');
  const ls = bi.lister();
  const root = inv.root;
  const folders = {
    cache: spelled(bi, root, 'chars', ls), stages: spelled(bi, root, 'stages', ls),
    music: spelled(bi, root, 'sound', ls), themes: spelled(bi, root, 'data', ls),
  };
  const under = (rel, folder) => {
    const pre = folder.toLowerCase() + '/';
    return String(rel || '').toLowerCase().startsWith(pre) ? rel.slice(pre.length) : null;
  };
  const skipped = [];
  const roster = {
    publicChars: [], publicStages: [], stages: [], chars: [],
    titleMusic: '', selectMusic: '',
    siteTitle: (inv.motif && inv.motif.name) || String(name),
    // a build opened read-only asks before any H side shows (hmodule.js)
    hModule: 'unasked',
  };

  // ---- characters ---------------------------------------------------------
  for (const u of inv.unresolved || []) {
    if (u.meant) skipped.push({ what: u.name, why: u.why });
  }
  const mountOf = new Map();
  const takenMount = new Set();
  for (const c of inv.chars) {
    // inspect() names a character only when its def read; one that did not
    // has no display name.
    if (c.displayName === undefined) {
      skipped.push({ what: folders.cache + '/' + c.folder + '/' + c.def, why: 'its .def could not be read' });
      continue;
    }
    const key = c.folder.toLowerCase();
    if (!mountOf.has(key)) {
      let mount = modlib.slugify(c.folder);
      let n = 2;
      while (takenMount.has(mount.toLowerCase())) mount = modlib.slugify(c.folder) + '_' + n++;
      takenMount.add(mount.toLowerCase());
      mountOf.set(key, mount);
    }
    const mount = mountOf.get(key);
    const e = { folder: c.folder, select: mount + '/' + c.def, mountAs: mount };
    if (c.displayName) e.name = c.displayName;
    if (c.exclude) e.exclude = 1;
    if (c.locked) e.locked = '1';
    e.cell = c.cell;
    if (c.slot) e.slot = 'imported' + c.slot;
    const p = c.params || new Map();
    for (const k of ['order', 'ordersurvival', 'includestage', 'ai', 'hidden', 'next', 'previous']) {
      if (p.has(k)) e[k] = p.get(k);
    }
    if (c.slot && p.has('select')) e.select_ = p.get('select');
    const HANDLED = new Set(['stage', 'music', 'exclude', 'select', 'order', 'ordersurvival', 'includestage', 'ai',
      'hidden', 'next', 'previous']);
    for (const [k, v] of p) {
      if (HANDLED.has(k) || !/^[a-z0-9_.]+$/.test(k)) continue;
      if (/path$/.test(k) || /^music/.test(k)) {
        skipped.push({ what: k + '=' + v, why: 'a file ' + c.folder + '/' + c.def + ' names, which the roster cannot carry' });
        continue;
      }
      if (!e.params) e.params = {};
      e.params[k] = v;
    }
    // A character's own song, when it is in the build's music folder - the
    // folder this bundle's music library IS.
    if (p.has('music')) {
      const ref = musicParamPath(p.get('music'));
      const hit = ref ? bi.resolveMotifMusic(root, (inv.motif && inv.motif.rel) || '', ref, ls) : null;
      const inLib = hit && under(hit.rel, folders.music);
      if (inLib) e.music = inLib;
      else if (ref) skipped.push({ what: ref, why: hit ? 'the song ' + c.folder + '/' + c.def + ' asks for is outside ' + folders.music + '/' : 'the song ' + c.folder + '/' + c.def + ' asks for, not in the build' });
    }
    roster.chars.push(e);
  }
  // The grid the author drew, placeholders in their own cells (the import's
  // walk, buildimport.runInspected).
  {
    const placed = [];
    const byCell = new Map();
    for (const e of roster.chars) if (e.cell != null) { if (!byCell.has(e.cell)) byCell.set(e.cell, []); byCell.get(e.cell).push(e); }
    for (const cell of inv.cells || []) {
      if (cell.kind === 'char') { for (const e of (byCell.get(cell.cell) || [])) placed.push(e); continue; }
      placed.push(Object.assign({ kind: cell.kind === 'random' ? 'random' : 'skip' }, cell.locked ? { locked: '1' } : {}));
    }
    for (const e of roster.chars) if (e.cell == null) placed.push(e);
    const kept = placed.filter((x) => !x.kind).length;
    if (kept === roster.chars.length) roster.chars = placed;
    for (const e of roster.chars) delete e.cell;
  }

  // ---- stages -------------------------------------------------------------
  const stageFileFor = new Map();
  const listed = new Set();
  for (const s of inv.stages) {
    if (!s.found) { skipped.push({ what: s.ref, why: 'named by the roster, not in the build' }); continue; }
    const file = under(s.rel, folders.stages);
    if (!file) { skipped.push({ what: s.rel, why: 'a stage kept outside ' + folders.stages + '/, where the Studio reads stages' }); continue; }
    stageFileFor.set(String(s.ref).replace(/\\/g, '/').toLowerCase(), file);
    if (listed.has(file.toLowerCase())) continue;
    listed.add(file.toLowerCase());
    // No music of the roster's: the stage plays what its own def names.
    roster.stages.push({ file, name: s.name || path.posix.basename(file, path.posix.extname(file)), music: '' });
  }
  for (const c of inv.chars) {
    if (!c.stage) continue;
    const file = stageFileFor.get(String(c.stage).replace(/\\/g, '/').toLowerCase());
    const mount = mountOf.get(c.folder.toLowerCase());
    if (!file || !mount) continue;
    const e = roster.chars.find((x) => x.select === mount + '/' + c.def);
    if (e) e.stage = file;
  }
  roster.publicStages = roster.stages.map((s) => s.file);

  // ---- the screenpack -----------------------------------------------------
  // Read where it is: the bundle's screenpack folder IS the build's data/, so
  // the roster names the motif by its path in there. A roster spells it
  // data/... whatever the disk calls the folder (modlib.motifDefPath).
  if (inv.motif) {
    const inData = under(inv.motif.rel, folders.themes);
    if (inData && inData.includes('/')) roster.motif = 'data/' + inData;
    else skipped.push({ what: inv.motif.rel, why: 'the screenpack is not in a folder inside ' + folders.themes + '/, where the Studio reads screenpacks - the Studio\'s default one is shown instead' });
  }

  // ---- the ladder and the build's rules -----------------------------------
  if (inv.maxMatches && inv.maxMatches.arcade.some((x) => x)) {
    roster.maxMatches = { arcade: inv.maxMatches.arcade, team: inv.maxMatches.team };
  }
  const rules = Object.assign(bi.rulesFromCfg(inv.cfg), bi.fightShapeRule(inv.cfg));
  if (Object.keys(rules).length) roster.settings = rules;

  // The build's own [Common] lists (an Ikemen GO build's), as root-relative
  // paths: they are in the build and run from there, so the record says
  // where, and the roster does not pretend the bundle carries them.
  let common = null;
  if (inv.commonFiles) {
    const cf = inv.commonFiles;
    const one = (f) => ({ ref: f.ref, rel: f.found ? f.rel : null, stock: !!f.stock });
    common = { States: cf.states.map(one), Air: cf.air.map(one), Cmd: cf.cmd.map(one), Fx: cf.fx.map(one), Const: cf.const ? one(cf.const) : null };
  }
  return { roster, skipped, folders, common };
}

// A bundle name from the build's folder name, held to NAME_RE, and free.
function externalName(root, L) {
  let n = path.basename(root).replace(/[^A-Za-z0-9 _.-]+/g, ' ').replace(/\s+/g, ' ')
    .replace(/^[^A-Za-z0-9]+/, '').slice(0, 40).replace(/[ .]+$/, '');
  if (!n) n = 'External build';
  let names = [];
  try { names = fs.readdirSync(home(L)).map((x) => x.toLowerCase()); } catch (e) { names = []; }
  let out = n;
  for (let i = 2; RESERVED.has(out.toLowerCase()) || names.includes(out.toLowerCase()); i++) {
    const tail = ' ' + i;
    out = n.slice(0, 40 - tail.length).replace(/[ .]+$/, '') + tail;
  }
  return out;
}

// Make the record for the build at `dir`. Does not switch to it: switchTo
// and a restart do, the same as for any bundle.
// -> list(L), plus `opened`: { name, dir, root, kind, characters, stages, skipped }.
function openExternal(dir, name, L) {
  L = L || require('./layout.js');
  const raw = String(dir || '').trim();
  if (!raw || !path.isAbsolute(raw)) throw new Error('give the build\'s whole folder path, e.g. G:\\Games\\My Build');
  const root = path.resolve(raw);
  const bi = require('./buildimport.js');
  const inv = bi.inspect(root);
  if (!inv.ok) {
    const e = new Error('that folder is not a MUGEN or Ikemen GO build: ' + inv.why.join('; '));
    e.why = inv.why;
    throw e;
  }
  // A build whose roster and screenpack live inside its program (boxedapp.js)
  // has nothing on disk to read in place.
  if (inv.unpacked) throw new Error('this build keeps its files packed inside ' + inv.unpacked.exe + ', so there is nothing to open in place - import it instead');

  // NOT A FOLDER THAT HOLDS THE STUDIO'S OWN. The guard refuses every write
  // under the build - and under whatever a link at its top leads to - and the
  // bundle's roster, the Settings folder and the program are written all the
  // time. Asked with the guard's own list of what it would hold.
  const fold = (p) => { const r = path.resolve(p); return process.platform === 'win32' ? r.toLowerCase() : r; };
  const inside = (p, r) => { const a = fold(p), b = fold(r); return a === b || a.startsWith(b.endsWith(path.sep) ? b : b + path.sep); };
  const held = require('./readonlyfs.js').rootsOf(root);
  // By name AND by real path: a bundles folder that is a junction into the
  // build reads as somewhere else by name, and the record would be written
  // into the build itself.
  const realOf = (p) => { const r = path.resolve(p); try { return fs.realpathSync.native(r); } catch (e) { return r; } };
  for (const own of [L.APP, home(L), L.SETTINGS_DIR, L.CONTENT_ROOT]) {
    if (own && held.some((r) => inside(own, r) || inside(realOf(own), r))) throw new Error('that build folder holds this Studio\'s own folders (' + own + '), which it must write - open a build outside them');
  }
  const already = list(L).bundles.find((b) => b.external && b.root && fold(b.root) === fold(root));
  if (already) throw new Error('that build is already open as the bundle "' + already.name + '"');

  const n = name === undefined || name === null || !String(name).trim() ? externalName(root, L) : String(name).trim();
  if (!NAME_RE.test(n)) throw new Error('a bundle name is 1-40 characters from A-Z, 0-9, space, dot, dash or underscore, starting with a letter or digit and not ending in a dot or space');
  if (RESERVED.has(n.toLowerCase())) throw new Error('"' + n + '" is reserved - pick another name');
  const exists = (() => { try { return fs.readdirSync(home(L)).some((x) => x.toLowerCase() === n.toLowerCase()); } catch (e) { return false; } })();
  if (exists) throw new Error('a bundle or folder called "' + n + '" already exists');

  const made = externalRoster(inv, n);
  const at = path.join(home(L), n);
  fs.mkdirSync(at, { recursive: true });
  try {
    const record = {
      root, readOnly: true, kind: inv.kind, folders: made.folders,
      motif: inv.motif ? inv.motif.rel : null, common: made.common,
      opened: new Date().toISOString(), skipped: made.skipped,
    };
    fs.writeFileSync(path.join(at, 'external.json'), JSON.stringify(record, null, 2) + '\n');
    // The roster goes last: list() counts a folder as a bundle only once it
    // has one, so a stop half way leaves nothing that opens.
    fs.writeFileSync(path.join(at, 'roster.json'), JSON.stringify(made.roster, null, 2) + '\n');
  } catch (e) {
    try { require('./lifebars.js').rmTree(at); } catch (e2) {
      e.message = e.message + ' - and the half-made folder "' + n + '" could not be removed (' + e2.message + ')';
    }
    throw e;
  }
  return Object.assign(list(L), {
    opened: {
      name: n, dir: at, root, kind: inv.kind,
      characters: made.roster.chars.filter((c) => !c.kind).length,
      stages: made.roster.stages.length,
      skipped: made.skipped,
    },
  });
}

// FORGET A BUILD OPENED IN PLACE (the owner: "There's no way to delete a
// read-only bundle from the bundle list"). Its bundle folder is the Studio's
// own record of the build - external.json, the roster made from it, and any
// per-bundle folder the Studio keeps beside them - so removing it deletes that
// folder and not one file of the build, which openExternal never lets hold
// the Studio's folders. Only an external bundle, and not the one running now
// nor the one chosen to open next: every folder the program uses is resolved
// from that choice at start.
//
// NOTHING IS FOLLOWED. A link anywhere in the folder (a junction someone put
// there) is unlinked as a link first, by itself, before the rest is removed
// (the 2026-09-27 junction loss came from a recursive delete going through
// one); and every other path is asked once more against the build and
// whatever its top links lead to (readonlyfs.rootsOf) - one that resolves
// inside it stops the removal before anything is deleted.
// -> list(L), plus `removed`: { name, dir, root }.
function removeExternal(id, L) {
  L = L || require('./layout.js');
  const key = String(id == null ? '' : id);
  const b = list(L).bundles.find((x) => x.id === key);
  if (!b) throw new Error('no such bundle: ' + key);
  // Main (default) is the Studio's own whatever a stray external.json in it
  // says - layout.js never reads one there.
  const own = '"' + b.name + '" is a bundle of the Studio\'s own - only a build opened read-only can be removed here';
  if (!b.external || b.main || RESERVED.has(b.id.toLowerCase())) throw new Error(own);
  const openNow = '"' + b.name + '" is the bundle open now - switch to another one first';
  const openNext = '"' + b.name + '" is chosen to open next - choose another bundle first';
  if (b.active) throw new Error(openNow);
  if (b.next) throw new Error(openNext);
  const top = path.resolve(home(L));
  const dir = path.resolve(top, b.id);
  if (!b.id || path.dirname(dir) !== top) throw new Error('bad bundle name: ' + key);

  const fold = (p) => (process.platform === 'win32' ? p.toLowerCase() : p);
  const inside = (p, r) => { const a = fold(p), c = fold(r); return a === c || a.startsWith(c.endsWith(path.sep) ? c : c + path.sep); };
  // THE SAME FOLDER BY ANOTHER SPELLING. list() knows the running and the next
  // bundle by the name the layout gives, and a layout written by hand can
  // spell that folder otherwise - another case, "./x", an 8.3 short name, a
  // junction to it, a "content" path - which reads as some other bundle there.
  // So both are asked again by real path (the next one by layout.js's rule).
  const realOf = (p) => { const r = path.resolve(p); try { return fs.realpathSync.native(r); } catch (e) { return r; } };
  const file = L.readLayoutFile();
  const at = (v) => path.resolve(L.APP, String(v));
  const nextDir = file.content ? at(file.content) : file.contentRoot ? path.join(at(file.contentRoot), String(file.bundle || 'default')) : L.APP;
  if (inside(realOf(L.CONTENT), realOf(dir))) throw new Error(openNow);
  if (inside(realOf(nextDir), realOf(dir))) throw new Error(openNext);
  const held = b.root ? require('./readonlyfs.js').rootsOf(b.root) : [];
  // A link into the build open now, or to a folder that holds it, is one that
  // build's guard (readonlyfs.js) will not let go of: refused here, before
  // anything is removed, rather than by the guard half way through the links.
  const running = L.readOnly && L.externalRoot ? require('./readonlyfs.js').rootsOf(L.externalRoot) : [];
  const links = [];
  const walk = (d) => {
    let real = d;
    try { real = fs.realpathSync.native(d); } catch (e) { /* asked by name below */ }
    for (const r of held) {
      if (inside(d, r) || inside(real, r)) throw new Error('"' + b.name + '"\'s folder reaches into its build (' + d + ') - nothing was removed');
    }
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const q = path.join(d, e.name);
      if (e.isSymbolicLink()) {
        let to = '';
        try { to = fs.realpathSync.native(q); } catch (x) { /* leads nowhere */ }
        if (to && running.some((r) => inside(to, r) || inside(r, to))) throw new Error('"' + b.name + '"\'s folder holds a link into the build open now (' + q + ') - nothing was removed');
        links.push(q);
      } else if (e.isDirectory()) walk(q);
    }
  };
  walk(dir);
  // Links by themselves first: unlinkSync takes a junction or a symlink away
  // as the link, file or folder alike, and never what it leads to.
  for (const q of links) {
    fs.unlinkSync(q);
    let still = true;
    try { fs.lstatSync(q); } catch (e) { still = false; }
    if (still) throw new Error('could not remove the link ' + q + ' - nothing else was removed');
  }
  require('./lifebars.js').rmTree(dir);
  return Object.assign(list(L), { removed: { name: b.name, dir, root: b.root } });
}

module.exports = { list, exportClash, switchTo, create, seedStage, ONLINE_KEYS, onlineOf, onlineSetups, openExternal, removeExternal, externalRoster, externalName, NAME_RE, SEED_STAGE_FILES, SEED_STAGE_NAME };
