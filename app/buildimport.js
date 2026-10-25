'use strict';
//
// IMPORTING A WHOLE MUGEN BUILD AS A CONTENT BUNDLE.
//
// Point this at the folder somebody has been playing MUGEN out of - the one
// with the .exe, chars/, stages/ and data/ in it - and it reads the build,
// says what can and cannot come across, and makes a NEW bundle out of it. The
// source folder is opened read-only at every step and nothing is ever written
// into it, because it is somebody's game and this program is not entitled to
// change it.
//
// WHAT A MUGEN BUILD IS, from this module's point of view:
//
//   <root>/mugen.exe            the program. Cannot come across - see below.
//   <root>/data/mugen.cfg       the settings, and the motif the build launches
//                               (an Ikemen GO build has save/config.ini
//                               instead, and keeps its screenpack wherever
//                               that file says - see inspect)
//   <root>/data/<motif>/        the screenpack, which is a THEME here
//   <root>/data/select.def      the roster: cells, characters, stage picks
//   <root>/data/common1.cns     OPTIONAL, and the interesting one - the
//                               build's own engine logic (see below)
//   <root>/chars/<name>/        the characters
//   <root>/stages/*.def         the stages
//   <root>/sound/               music
//   <root>/font/                fonts the screenpack reaches through
//
// WHAT CANNOT COME ACROSS, and why it is not a loss:
//
//   the MUGEN executable, its DLLs, its plugins/ and its Elecbyte libraries -
//   this build runs on a different engine, and the whole point of the import
//   is to bring the CONTENT to it. Its own Lua and its shaders go the same way:
//   they are the MUGEN program's, they name MUGEN's own interfaces, and
//   nothing here would ever load them.
//
// THE PART THAT IS NOT CONTENT: data/common1.cns.
//
// MUGEN's common states are a file named by each character's `[Files]
// stcommon` key, and mods put their own engine logic in it - a tag system, an
// assist system, a custom guard - in state numbers no character defines. A
// character of that build then calls those numbers, and without the file it
// calls a state nobody defines, which the engine answers with an empty state
// and no diagnostic (§3.2b): the character freezes.
//
// THE ENGINE CAN LOAD IT, but not where MUGEN loaded it. The order a
// character's states are compiled in (compiler.go:8340-8376) is:
//
//   1. the def's own st, st0..stN
//   2. its cmd file
//   3. its stcommon file          <- MUGEN's data/common1.cns sat HERE
//   4. every [Common] States* file in the config, in SortedKeys order:
//      States (the engine's own nine .zss files), then States1, States2...
//      (common.go:1628-1643)
//
// and the FIRST definition of a positive state number wins (compiler.go:7111
// for CNS, 8048 for ZSS). So:
//
//   * THERE IS NO POSITION IN [Common] States FROM WHICH AN IMPORTED FILE CAN
//     BEAT THE ENGINE'S OWN common1.cns.zss. That file is what `stcommon =
//     common1.cns` resolves to - the CNS name is tried first and the compiler
//     retries it as .zss only when nothing answers (compiler.go:6754-6767) -
//     and step 3 runs before step 4 whatever key the file is listed under.
//     The only way to outrank it is to BE it, by shipping the imported file at
//     data/common1.cns so the .zss fallback is never reached. This import does
//     not do that: it would replace the engine's own common states for EVERY
//     character in the bundle, including characters that never came from this
//     build, and the engine's dizzy, guard-break, tag, score and training
//     states are written against the .zss it would be displacing.
//
//   * WHAT IT DOES INSTEAD is list the file under its own [Common] States key,
//     after the engine's own. Measured on a real MUGEN 1.1 mod build: of the
//     118 states in its common1.cns, 51 are the standard MUGEN numbers that
//     the engine's common1.cns.zss also defines - those keep the ENGINE's
//     version - and the remaining 67 are the mod's own (its 142xxx/152xxx tag
//     states, its 190xxx/195xxx assist and guard states, its 88xxx/90xxx
//     helpers), which no engine file defines and which therefore come through
//     exactly as written. That is the half the dependent characters call.
//
//   * A NEGATIVE STATEDEF IS APPENDED, NOT REPLACED. For a state number below
//     zero the compiler starts from the bytecode already there and adds the
//     file's controllers to it (compiler.go:6843-6844 for CNS, 8034-8035 for
//     ZSS), and always stores the result (7111 with negoverride false, which
//     is what the common-states pass passes at 8370). So the mod's
//     `[Statedef -2]` - which is where this kind of mod keeps its driver:
//     spawning its system helper, watching for a tag, installing its guard
//     HitOverride - runs on every character in the bundle, after that
//     character's own -2 and after anything listed before it.
//
//   * A LISTED FILE THAT DOES NOT COMPILE TAKES EVERY CHARACTER WITH IT. An
//     unknown controller type is Error("Invalid state controller: ")
//     (compiler.go:6891) and an unknown name in an expression is Error("Invalid
//     data: ") (compiler.go:1605, 5227); neither is behind ignoreMostErrors,
//     which this engine never turns on. So the file is checked against the
//     compiler's own two tables (enginedata.stateControllers / .triggers)
//     BEFORE it is listed, and when a name comes back unknown the file is
//     still carried into the bundle but not listed, and the report says which
//     name and what it costs. This module does not promise the mod works. It
//     says what the engine will do with it.
//
// WHERE THE FILE LIVES: layout.dir('engine'), beside the build's own
// common.const and its own fight.def, for the reason engineconst.js gives -
// the engine's installation is replaced wholesale by the next engine update,
// so a build's own decision belongs with the build's content.
const fs = require('fs');
const path = require('path');
const os = require('os');

const layout = require('./layout.js');
const enginedata = require('./enginedata.js');
const cnsexpr = require('./cnsexpr.js');

// The build's own common states, as a second [Common] States key rather than a
// replacement for the engine's list - the same shape as engineconst's Const1
// and the desktop sandbox's States1, and a key that sorts after both.
const BUILD_STATES_FILE = 'common.cns';
const BUILD_STATES_VPATH = 'data/build.cns';
const BUILD_STATES_KEY = 'States2';

// An Ikemen GO build's own [Common] files - its state files, common
// animations, commands and effects packs - as the build listed them, IN PLACE
// of the engine's own lists: the config's base keys (States, Air, Cmd, Fx)
// are written with the build's lists, which replaces the engine's default for
// each key (config.go: a keyed map merged per key). The files live in the
// bundle's engine folder and ship under data/build/.
const BUILD_COMMON_DIR = 'imported-common';
const BUILD_COMMON_VDIR = 'data/build';

function buildStatesPath(L) { return path.join((L || layout).dir('engine'), BUILD_STATES_FILE); }
function buildStatesPathIn(engineDir) { return path.join(engineDir, BUILD_STATES_FILE); }

// ---------------------------------------------------------------------------
// reading the source, without writing a byte of it
// ---------------------------------------------------------------------------

const readText = (p) => { try { return fs.readFileSync(p, 'latin1'); } catch (e) { return null; } };
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch (e) { return false; } };
const sizeOf = (p) => { try { return fs.statSync(p).size; } catch (e) { return 0; } };

// One case-insensitive listing per folder, kept for the length of one read.
function lister() {
  const cache = new Map();
  return (dir) => {
    const k = dir.toLowerCase();
    if (!cache.has(k)) {
      let ents = [];
      try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { ents = []; }
      cache.set(k, ents);
    }
    return cache.get(k);
  };
}

// A BUILD WHOSE data/ AND stages/ LIVE INSIDE ITS PROGRAM. BoxedApp Packer
// folds the files beside an .exe into the .exe itself (boxedapp.js), so such a
// build has chars/ and sound/ on disk and its screenpack, roster and stages
// only inside the program. inspect() unpacks the packed tree to a folder of
// its own under the system temp folder and registers it here, and every
// lookup into the build tries that folder FIRST and the build's own folder
// second - the order the packed program itself sees them in, since a packed
// file shadows a real one. Nothing is linked and chars/ is never copied; the
// unpacked folder is removed when the read or the import is done.
const UNPACKED = new Map();   // build root, lowercased -> { root, dir }

// The unpacked twin of a folder of a packed build (the build root or a folder
// inside it), or null.
function twinOf(dir) {
  if (!UNPACKED.size) return null;
  const abs = path.resolve(dir);
  for (const o of UNPACKED.values()) {
    const rel = path.relative(o.root, abs);
    if (rel === '') return o.dir;
    if (!rel.startsWith('..') && !path.isAbsolute(rel)) return path.join(o.dir, rel);
  }
  return null;
}

// A file's path relative to the build, whether it sits in the build's own
// folder or in the unpacked twin of it.
function relToBuild(root, abs) {
  const o = UNPACKED.get(path.resolve(root).toLowerCase());
  const inTwin = o && path.relative(o.dir, abs);
  const rel = inTwin && !inTwin.startsWith('..') && !path.isAbsolute(inTwin) ? inTwin : path.relative(root, abs);
  return rel.replace(/\\/g, '/');
}

// Resolve a root-relative path the way the engine resolves one: separators
// normalized, then a case-insensitive match per segment (GRAIL 4.13). Returns
// {abs, rel} with `rel` spelled as the disk spells it, or null. A packed
// build's unpacked twin is tried first (see UNPACKED).
function resolve(root, rel, ls) {
  const twin = twinOf(root);
  return (twin && resolveOn(twin, rel, ls)) || resolveOn(root, rel, ls);
}
// A NAME READ AS LATIN-1 MAY BE UTF-8. Every text file of a build is read as
// Latin-1 here (MUGEN's own files are), but an Ikemen GO build's select.def is
// UTF-8 and the engine opens the names in it as UTF-8. The Ikemen Fighting
// Collection names nine of its characters' defs with two invisible
// right-to-left marks (U+200F) in front - "‏‏Cvs_iori_Ikemen_GO.def", the mark a
// copy made on a right-to-left Windows leaves - and the files on disk carry
// them too, so the engine loads them; read as Latin-1, those six bytes match
// no file. The UTF-8 reading is tried second, and only when it decodes cleanly.
function asUtf8(seg) {
  if (!/[\x80-\xff]/.test(seg)) return null;
  const u = Buffer.from(seg, 'latin1').toString('utf8');
  return u.includes('�') ? null : u;
}
function resolveOn(root, rel, ls) {
  const parts = String(rel || '').replace(/\\/g, '/').split('/').filter((x) => x && x !== '.');
  if (!parts.length) return null;
  let cur = root; const out = [];
  for (const seg of parts) {
    if (seg === '..') { if (!out.length) return null; out.pop(); cur = path.join(root, ...out); continue; }
    const ents = ls(cur);
    const find = (s) => ents.find((e) => e.name === s) || ents.find((e) => e.name.toLowerCase() === s.toLowerCase());
    const utf8 = asUtf8(seg);
    const hit = find(seg) || (utf8 && find(utf8));
    if (!hit) return null;
    out.push(hit.name);
    cur = path.join(cur, hit.name);
  }
  return { abs: cur, rel: out.join('/') };
}

// mugen.cfg / system.def / a stage def all read as the same flat ini. Sections
// are kept because `motif` lives in [Options] and the video size in [Config],
// and because a screenpack repeats key names across sections.
function readIni(text) {
  const out = { sections: new Map(), flat: new Map() };
  let sec = '';
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.replace(/;.*$/, '').trim();
    if (!line) continue;
    const h = /^\[([^\]]*)\]/.exec(line);
    if (h) { sec = h[1].trim().toLowerCase(); continue; }
    const m = /^([^=]+?)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1].trim().toLowerCase();
    const val = m[2].trim().replace(/^"|"$/g, '');
    if (!out.sections.has(sec)) out.sections.set(sec, new Map());
    const s = out.sections.get(sec);
    if (!s.has(key)) s.set(key, val);
    if (!out.flat.has(key)) out.flat.set(key, val);
  }
  return out;
}
const iniGet = (ini, sec, key) => {
  const s = ini.sections.get(sec);
  const v = s && s.get(key);
  return v === undefined ? null : v;
};

// THE BUILD'S RULES, as this engine's settings. A MUGEN build is configured by
// its mugen.cfg as much as by its files, and the rules there are what its
// players know the game as - so they come across with the content, into the
// bundle's own settings, instead of the engine's defaults quietly replacing
// them. Only keys with the same meaning and scale on both sides, and only the
// ones the build actually states:
//
//   [Options] Difficulty        -> Options.Difficulty       CPU level, 1-8 on both
//   [Options] Life              -> Options.Life             percent
//   [Options] Time              -> Options.Time             round counts
//   [Options] GameSpeed         -> Options.GameSpeed        -9..9 on both
//   [Options] Team.1VS2Life     -> Options.Team.SingleVsTeamLife
//                                  percent life for one fighter facing a team
//   [Options] Team.LoseOnKO     -> Options.Simul.LoseOnKO
//                                  0: a team is out only when every member is.
//                                  The engine's default is 1, and it ends the
//                                  round the moment a HUMAN-controlled member is
//                                  KO'd, so an imported team build lost the
//                                  round with two partners still standing -
//                                  every stock mugen.cfg ships 0.
//
// AN IKEMEN GO BUILD writes its rules under the engine's own names, so every
// [Options] key it states that the Studio has a setting for comes across as
// that setting - checked against the setting's type and range, never renamed.
// Its config restates EVERY key, defaults included (the engine writes the
// whole file), so a value that is the engine's default in every product is
// not a rule the build made and is left out - the same sparse shape the
// Studio keeps its settings in.
//
// EVERY SECTION the Studio has settings for, not only [Options]: the render
// size and window ([Video] - a 1080p build exports at 1080p; the website
// build picks its own picture size at load, so it is not dragged along),
// the fight aspect (a pack's HUD code lays itself out by it), [Config],
// [Arcade], [Input], [Debug], [Sound]. Left out on purpose: [Common] (the
// file lists come across as files, above), [Netplay] (identity and netcode
// are this build's), the three volumes (the player's, and the website build
// ships its own master level), file-valued keys that would name a file this
// bundle does not have (window icon, screenshot folder, gamepad mappings,
// training character and stage, start stage, sound font, shaders), and the
// debug font, which is carried as a file with its scale (see run).
const RULES_SKIP_SECTIONS = new Set(['common', 'netplay']);
const RULES_SKIP_KEYS = new Set([
  'sound.mastervolume', 'sound.bgmvolume', 'sound.wavvolume',
  'config.windowicon', 'config.screenshotfolder', 'config.gamepadmappings', 'config.trainingchar', 'config.trainingstage',
  'debug.startstage', 'debug.font', 'debug.fontscale', 'sound.soundfont', 'video.externalshaders', 'video.rendermode',
]);
function rulesFromIkemen(sections) {
  const out = {};
  const { SETTINGS, isDefaultEverywhere } = require('./settings-schema.js');
  for (const s of SETTINGS) {
    const secName = s.sec.toLowerCase();
    if (RULES_SKIP_SECTIONS.has(secName) || RULES_SKIP_KEYS.has(secName + '.' + s.key.toLowerCase())) continue;
    const sec = sections[secName];
    if (!sec) continue;
    const raw = sec[s.key.toLowerCase()];
    if (raw === undefined || raw === null || String(raw).trim() === '') continue;
    const v = String(raw).trim();
    let ok = null;
    if (s.type === 'bool') ok = /^(1|true)$/i.test(v) ? '1' : (/^(0|false)$/i.test(v) ? '0' : null);
    else if (s.type === 'int' || s.type === 'float') {
      const n = Number(v);
      if (isFinite(n) && (s.min === undefined || n >= s.min) && (s.max === undefined || n <= s.max)) ok = String(n);
    } else if (s.type === 'enum') ok = (s.opts || []).some((o) => String(o[0]) === v) ? v : null;
    else ok = v;
    if (ok !== null && !isDefaultEverywhere(s, ok)) out[s.sec + '.' + s.key] = ok;
  }
  return out;
}

// AN IKEMEN GO BUILD IS CONFIGURED BY save/config.ini (save/config.json before
// 1.0): the motif under [Config], the rules under [Options] with the engine's
// own key names, and under [Common] the files the engine runs on every
// character. Read into the same shape the MUGEN reader fills, plus the parts
// only this kind has.
function readIkemenCfg(hit, isIni) {
  const text = readText(hit.abs) || '';
  const cfg = {
    kind: 'ikemen', path: hit.rel, motif: null, gameWidth: null, gameHeight: null,
    options: {}, sections: {}, debugFont: null,
    common: { air: [], cmd: [], const: null, states: [], fx: [], modules: [] },
  };
  const list = (v) => String(v || '').split(',').map((x) => x.trim().replace(/\\/g, '/')).filter(Boolean);
  if (isIni) {
    const ini = readIni(text);
    cfg.motif = iniGet(ini, 'config', 'motif');
    cfg.gameWidth = iniGet(ini, 'video', 'gamewidth');
    cfg.gameHeight = iniGet(ini, 'video', 'gameheight');
    for (const [sec, map] of ini.sections) cfg.sections[sec] = Object.fromEntries(map);
    cfg.options = cfg.sections.options || {};
    const dbg = cfg.sections.debug || {};
    if (dbg.font) cfg.debugFont = { file: dbg.font.replace(/\\/g, '/'), scale: dbg.fontscale || null };
    const common = ini.sections.get('common');
    if (common) for (const [k, v] of common) {
      if (/^air\d*$/.test(k)) cfg.common.air.push(...list(v));
      else if (/^cmd\d*$/.test(k)) cfg.common.cmd.push(...list(v));
      else if (k === 'const') cfg.common.const = v.replace(/\\/g, '/');
      else if (/^states\d*$/.test(k)) cfg.common.states.push(...list(v));
      else if (/^fx\d*$/.test(k)) cfg.common.fx.push(...list(v));
      else if (/^modules\d*$/.test(k)) cfg.common.modules.push(...list(v));
    }
  } else {
    let j = null;
    try { j = JSON.parse(text); } catch (e) { j = null; }
    if (j && typeof j === 'object') {
      cfg.motif = j.Motif ? String(j.Motif) : null;
      cfg.gameWidth = j.GameWidth === undefined ? null : String(j.GameWidth);
      cfg.gameHeight = j.GameHeight === undefined ? null : String(j.GameHeight);
      for (const k of ['Difficulty', 'Life', 'Time', 'GameSpeed']) if (j[k] !== undefined) cfg.options[k.toLowerCase()] = String(j[k]);
      if (j.Team1VS2Life !== undefined) cfg.options['team.singlevsteamlife'] = String(j.Team1VS2Life);
      cfg.sections.options = cfg.options;
      cfg.sections.video = {};
      if (cfg.gameWidth !== null) cfg.sections.video.gamewidth = cfg.gameWidth;
      if (cfg.gameHeight !== null) cfg.sections.video.gameheight = cfg.gameHeight;
      if (j.Fullscreen !== undefined) cfg.sections.video.fullscreen = j.Fullscreen ? '1' : '0';
      if (j.FightAspectWidth !== undefined) cfg.sections.video.fightaspectwidth = String(j.FightAspectWidth);
      if (j.FightAspectHeight !== undefined) cfg.sections.video.fightaspectheight = String(j.FightAspectHeight);
      if (j.DebugFont) cfg.debugFont = { file: String(j.DebugFont).replace(/\\/g, '/'), scale: j.DebugFontScale === undefined ? null : String(j.DebugFontScale) };
      cfg.common.air = j.CommonAir ? list(j.CommonAir) : [];
      cfg.common.cmd = j.CommonCmd ? list(j.CommonCmd) : [];
      cfg.common.const = j.CommonConst ? String(j.CommonConst) : null;
      cfg.common.states = Array.isArray(j.CommonStates) ? j.CommonStates.map(String) : list(j.CommonStates);
    }
  }
  // the fields the report reads for either kind
  cfg.difficulty = cfg.options.difficulty ?? null;
  cfg.life = cfg.options.life ?? null;
  cfg.time = cfg.options.time ?? null;
  cfg.gameSpeed = cfg.options.gamespeed ?? null;
  cfg.team1vs2Life = cfg.options['team.singlevsteamlife'] ?? null;
  cfg.teamLoseOnKO = cfg.options['simul.loseonko'] ?? null;
  return cfg;
}

// The engine's own data files, by the names the 1.0 release ships them under.
// In an Ikemen GO build data/ is the engine's folder as much as the pack's,
// and these stay behind: this engine ships its own, and whatever the
// screenpack names of them comes across with the screenpack.
const ENGINE_DATA = new Set([
  'action.zss', 'common.air', 'common.cmd', 'common.const', 'common.snd', 'common1.cns.zss', 'demo.zss',
  'dizzy.zss', 'fight.def', 'fight.sff', 'fight.snd', 'fightfx.air', 'fightfx.sff', 'functions.zss', 'glyphs.sff',
  'guardbreak.zss', 'score.zss', 'system.base.def', 'system.snd', 'system.zss', 'tag.zss', 'training.zss',
]);

// THE MATCH TAKES THE WINDOW'S SHAPE, as it did where the build came from.
// Ikemen GO 1.0 has a fight-shape setting (FightAspectWidth/Height) and our
// exports ship it at -1,-1: a match takes the shape the STAGE declares. MUGEN
// and the older Ikemen versions behind save/config.json have no such setting -
// a match is always the window's shape - and their packs are made for that.
// MKDE_PLUS's Keirin Risui declares localcoord 960,720 with art wide enough to
// pan across 16:9; on -1,-1 the match went 4:3 and its 16:9 lifebars shrank
// into the top of the screen. So a build whose own config names no fight shape
// gets 0,0, which the engine reads as the screenpack's (the window's) shape
// (system.go getFightAspect: neither negative nor positive falls through to
// getMotifAspect). A build that sets one keeps its own (rulesFromIkemen).
function fightShapeRule(cfg) {
  if (!cfg) return {};
  const video = (cfg.sections && cfg.sections.video) || {};
  if (video.fightaspectwidth !== undefined || video.fightaspectheight !== undefined) return {};
  return { 'Video.FightAspectWidth': '0', 'Video.FightAspectHeight': '0' };
}

function rulesFromCfg(cfg) {
  const out = {};
  if (!cfg) return out;
  if (cfg.kind === 'ikemen') return rulesFromIkemen(cfg.sections || { options: cfg.options || {} });
  const num = (v) => (v === null || v === undefined || String(v).trim() === '' || !isFinite(Number(v))) ? null : Number(v);
  const put = (key, v, ok) => { const n = num(v); if (n !== null && (!ok || ok(n))) out[key] = String(n); };
  put('Options.Difficulty', cfg.difficulty, (n) => n >= 1 && n <= 8);
  put('Options.Life', cfg.life, (n) => n >= 10 && n <= 300);
  put('Options.Time', cfg.time, (n) => n >= -1 && n <= 1000);
  put('Options.GameSpeed', cfg.gameSpeed, (n) => n >= -9 && n <= 9);
  put('Options.Team.SingleVsTeamLife', cfg.team1vs2Life, (n) => n >= 10 && n <= 300);
  const ko = num(cfg.teamLoseOnKO);
  if (ko !== null) out['Options.Simul.LoseOnKO'] = ko ? '1' : '0';
  return out;
}

// ---- the roster file -------------------------------------------------------
//
// select.def's [Characters] is a sequence of CELLS, and a line can never name
// its own cell (GRAIL 4.12). Everything here follows that: placeholders consume
// a cell, `exclude = 1` does not, and a `slot = { ... }` block is one cell
// however many members it holds.
const PLACEHOLDER_LINE = /^(skipslot|dummyslot|randomselect)$/i;

// LOCKED CELLS COME ACROSS. VSelect marks a cell it must not move with a
// comment at the end of its line - `; LOCKED` unless its user chose other
// words - and E-Select writes the same label back out of the roster. Comments
// are stripped before a line is read, so the label is looked at on the RAW
// line first. `opts.lockLabels` adds labels to accept besides the default
// (motif-core lineLocked; `LOCKED` alone always counts). A label on
// `slot = {` locks the block's first member, which is the cell's lock.
function parseSelect(text, opts) {
  const out = { entries: [], extraStages: [], options: new Map(), sections: [] };
  const labels = (opts && opts.lockLabels) || [];
  const motifCore = require('./public/ikemen/motif-core.js');
  let sec = '';
  let slot = null, slotId = 0, slotLocked = false;
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.replace(/;.*$/, '').trim();
    if (!line) continue;
    const h = /^\[([^\]]+)\]/.exec(line);
    if (h) { sec = h[1].trim().toLowerCase(); out.sections.push(sec); slot = null; continue; }
    if (sec === 'characters') {
      const locked = motifCore.lineLocked(raw, labels);
      if (/^slot\s*=\s*\{$/i.test(line)) { slot = ++slotId; slotLocked = locked; continue; }
      if (line === '}') { slot = null; slotLocked = false; continue; }
      // UNLOCK FIRST, TO THE END OF THE LINE, as the engine takes it
      // (main.lua f_addChar): a Lua condition may hold commas of its own, so
      // splitting first cut `unlock=stat.x = 1, 2` in two and invented a
      // stage called "2".
      let unlock = null;
      const body = line.replace(/,\s*unlock\s*=\s*(.*?)\s*$/i, (m, u) => { unlock = u.trim(); return ''; });
      const parts = body.split(',').map((s) => s.trim());
      const head = parts[0];
      const params = new Map();
      for (const p of parts.slice(1)) {
        const m = /^([^=]+?)\s*=\s*(.*)$/.exec(p);
        if (m) params.set(m[1].trim().toLowerCase(), m[2].trim());
        else if (p) params.set('stage', p);
      }
      if (unlock !== null) params.set('unlock', unlock);
      // The second field is the stage when it is not a `key = value`.
      const stage = parts[1] && !/=/.test(parts[1]) ? parts[1] : null;
      // The block's own label goes to its first member only.
      const lockHere = locked || (slotLocked && slot !== null && !out.entries.some((e) => e.slot === slot));
      if (PLACEHOLDER_LINE.test(head)) {
        const KIND = { skipslot: 'skip', dummyslot: 'dummy', randomselect: 'random' };
        out.entries.push(Object.assign({ kind: KIND[head.toLowerCase()], raw: line, slot }, lockHere ? { locked: true } : {}));
        continue;
      }
      // Trap 8: a line whose first token is empty desynchronizes the engine's
      // two internal lists and silently corrupts every later character. It is
      // normalized to a skipslot, never carried through.
      if (!head) { out.entries.push({ kind: 'skip', raw: line, degraded: 'a line with no name in it' }); continue; }
      out.entries.push(Object.assign({ name: head, stage, params, raw: line, slot }, lockHere ? { locked: true } : {}));
    } else if (sec === 'extrastages') {
      const v = line.split(',')[0].trim();
      if (v) out.extraStages.push({ file: v, raw: line });
    } else if (sec === 'options') {
      const m = /^([^=]+?)\s*=\s*(.*)$/.exec(line);
      if (m) out.options.set(m[1].trim().toLowerCase(), m[2].trim());
    }
  }
  return out;
}

// `kfm`, `kfm/alt-kfm.def`, `suave.zip:newsuave.def`, and the absolute path
// somebody's roster editor left behind. Returns what the entry points at
// inside THIS build, or why it points at nothing.
// A NAME THAT RESOLVES TO NOTHING IS NOT AUTOMATICALLY A BREAK. Screenpack
// authors fill the cells they are keeping for themselves with a word that is
// not a character, and the cell goes blank because the character fails to load
// (the LEGACY convention modlib's themeLayout documents; this build's author
// used `donotchange` and `empty`). A reference that was MEANT to be a
// character - one with a path in it, a .def on the end, or a drive letter from
// another machine - is a break, and the two must not be reported as the same
// thing.
function looksMeant(name) {
  const n = String(name || '').trim().replace(/\\/g, '/');
  return /[/:]/.test(n) || /\.def$/i.test(n) || /\.zip/i.test(n);
}

function resolveCharEntry(root, name, ls) {
  const raw = String(name || '').trim();
  const norm = raw.replace(/\\/g, '/');
  if (/^[A-Za-z]:\//.test(norm) || norm.startsWith('//')) {
    return { ok: false, why: 'an absolute path from another machine' };
  }
  if (/\.zip(:|$)/i.test(norm)) {
    const zip = norm.split(':')[0];
    const hit = resolve(root, 'chars/' + zip, ls);
    return hit ? { ok: false, why: 'a zipped character', folder: null, zip: hit.rel }
      : { ok: false, why: 'a zipped character that is not there' };
  }
  const segs = norm.split('/').filter(Boolean);
  const folder = segs[0];
  if (!folder) return { ok: false, why: 'an empty name' };
  const dir = resolve(root, 'chars/' + folder, ls);
  if (!dir || !isDir(dir.abs)) return { ok: false, why: 'no chars/' + folder + ' folder' };
  const realFolder = path.basename(dir.rel);
  let def = segs.length > 1 ? segs.slice(1).join('/') : null;
  if (def) {
    const hit = resolve(root, 'chars/' + realFolder + '/' + def, ls);
    if (!hit) return { ok: false, why: 'chars/' + realFolder + ' has no ' + def, folder: realFolder };
    return { ok: true, folder: realFolder, def: hit.rel.split('/').slice(2).join('/'), dir: dir.abs };
  }
  // No def named: MUGEN takes <folder>.def inside the folder.
  const hit = resolve(root, 'chars/' + realFolder + '/' + folder + '.def', ls);
  if (hit) return { ok: true, folder: realFolder, def: path.basename(hit.rel), dir: dir.abs };
  // Some folders are named differently from their def; fall back to the
  // Studio's own reader rather than declaring the character missing.
  let alt = null;
  try { alt = require('./modlib.js').findMainDef(dir.abs); } catch (e) { alt = null; }
  if (alt) return { ok: true, folder: realFolder, def: alt, dir: dir.abs, renamed: true };
  return { ok: false, why: 'chars/' + realFolder + ' has no ' + folder + '.def', folder: realFolder };
}

// ---- the screenpack's own music --------------------------------------------
//
// A SCREENPACK NAMES ITS MENU MUSIC, in its own [Music] section, and those
// tracks are as much a part of the pack as its sprites. The reference build's
// pack names four:
//
//   title.bgm   = data/menu.mp3            the title screen
//   select.bgm  = sound/playerselect2.mp3  the character select screen
//   vs.bgm      = data/versus.mp3          the versus screen
//   victory.bgm = data/victory.mp3         the win screen
//
// and NONE of them is in the motif's own folder. The engine finds them anyway,
// because a motif's bgm path is resolved with `lookup:"def,,data/,sound/"`
// (motif.go BgmProperties.Bgm): the motif's own folder, the build root, then
// data/, each of those also probed under sound/, and the sound/ probe skipped
// when the reference already starts with it (common.go SearchFile). That is the
// rule below, and it is the same rule modlib.carryMotifRefs follows for the
// pack's sprites and fonts.
//
// WHAT THIS BUNDLE CAN DO WITH THEM. roster.titleMusic and roster.selectMusic
// are the two the Studio has a setting for - the Content page's "Menu music"
// card writes them, and both exports rewrite the motif's title.bgm/select.bgm
// from them (vfslib.js). There is NO roster field for vs.bgm, victory.bgm, or
// any other prefix a pack invents. Those are not dropped: the track is carried
// into the music library like any other, the installed theme's own line is
// repointed at it, and the report says the Studio cannot change it.
//
// The value is split on commas because the engine splits it on commas
// (iniutils.go parseMusicSection): a pack may name several candidates for one
// screen. The roster's single-value setting takes the first, and the report
// says when there was more than one.
const ROSTER_MUSIC_KEY = { title: 'titleMusic', select: 'selectMusic' };

function motifMusicKeys(ini) {
  const sec = ini.sections.get('music');
  const out = [];
  if (!sec) return out;
  for (const [key, val] of sec) {
    const m = /^(?:(.+)\.)?(bgm|bgmusic)$/.exec(key);
    if (!m) continue;
    const refs = String(val || '').split(',')
      .map((s) => s.replace(/"/g, '').replace(/\\/g, '/').trim()).filter(Boolean);
    if (!refs.length) continue;
    const prefix = (m[1] || '').toLowerCase();
    out.push({ key, prefix, field: ROSTER_MUSIC_KEY[prefix] || null, refs });
  }
  return out;
}

// One motif reference, resolved the way the engine resolves a motif's bgm.
function resolveMotifMusic(root, motifRel, ref, ls) {
  const dir = path.posix.dirname(String(motifRel || '').replace(/\\/g, '/'));
  const lower = String(ref || '').toLowerCase();
  for (const base of [dir === '.' ? '' : dir, '', 'data']) {
    for (const sub of ['', 'sound']) {
      if (sub && lower.startsWith('sound/')) continue;       // SearchFile's hasDirPrefix
      const hit = resolve(root, [base, sub, ref].filter(Boolean).join('/'), ls);
      if (hit && !isDir(hit.abs)) return hit;
    }
  }
  return null;
}

// Repoint ONE [Music] line in an installed theme's system.def, keyed by the
// exact key that was read - so nothing else in the file is touched and the
// line keeps whatever comment was sitting on the end of it. Returns the text
// unchanged when the pack does not have that line (it was read from this same
// file, so that only happens if something else rewrote it first).
// THE KEY IS DATA, NOT A PATTERN. It is read out of a third-party screenpack's
// own [Music] section - every prefix ending in .bgm/.bgmusic reaches this - so
// it holds whatever the pack's author typed. Escaping only '.' left the rest of
// the punctuation live: an unbalanced '(' threw "Invalid regular expression"
// out of run(), which killed the import after the bundle had been created and
// filled, and a BALANCED one was worse than a throw - 'v(1).bgm' matched the
// unrelated line 'v1.bgm = keepme.mp3', and the key's own group renumbered the
// comment backreference on top of it, leaving 'sound/versus.mp31' in the file
// with no error anywhere.
const reEscape = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function setMotifBgm(text, key, value) {
  const re = new RegExp('^([ \\t]*' + reEscape(key) + '[ \\t]*=)[^\\r\\n;]*((?:[ \\t]*;[^\\r\\n]*)?)$', 'mi');
  // A FUNCTION replacement: the comment is group 2 whatever the key holds, and
  // a '$' in the value is a dollar sign rather than a substitution.
  return re.test(text) ? text.replace(re, (m, head, tail) => head + ' ' + value + tail) : text;
}

// ---- one library name per FILE ---------------------------------------------
//
// Every track a build brings lands in music/ as modlib.slugify(stem) + ext, and
// THREE sweeps put tracks there: a stage's own bgmusic, the build's sound/
// folder, and the screenpack's [Music] section. Two DIFFERENT files can ask for
// the same library name - slugify turns each run of punctuation into one '_',
// so "Menu Theme.mp3", "Menu.Theme.mp3" and "Menu-Theme.mp3" all want
// Menu_Theme.mp3, and data/menu.mp3 and sound/menu.mp3 want the same name with
// no help from slugify at all.
//
// SHARING ONE COPY IS THE POINT when it really is one song: a stage that names
// the build's own sound/ruins.mp3 must not put a second copy in the bundle. But
// the test has to be the FILE and not the name. "The name is taken" used to
// mean "skip the copy", so the loser's references all pointed at somebody
// else's song and the loser's own bytes were in the bundle under no name at
// all - and since the menu carry runs last, the screenpack's own title track
// was always the one that lost.
//
// Same name and same bytes: one copy, shared. Same name, different bytes:
// <slug>_2.ext, <slug>_3.ext, the way the character mount loop already
// disambiguates two folders that slug alike. The placer returns the vpath it
// actually wrote, so the stage rewrite map, wrote.music, the roster's stage and
// character lines and the theme's repointed [Music] lines all quote the name
// that copy landed under.
function trackPlacer(musicDir) {
  const modlib = require('./modlib.js');
  const sameBytes = (a, b) => {
    try { return fs.readFileSync(a).equals(fs.readFileSync(b)); } catch (e) { return false; }
  };
  // Seeded from what is already there, so a name is never overwritten by a
  // sweep that did not put it there - and so a Windows listing, which is
  // case-insensitive, cannot hide one under a different spelling.
  const landed = new Map();
  let ents = [];
  try { ents = fs.readdirSync(musicDir, { withFileTypes: true }); } catch (e) { ents = []; }
  for (const e of ents) {
    if (!e.isFile()) continue;
    const abs = path.join(musicDir, e.name);
    landed.set(e.name.toLowerCase(), { name: e.name, abs, bytes: sizeOf(abs) });
  }
  return function place(absSrc, diskName) {
    const ext = path.extname(diskName).toLowerCase();
    const stem = modlib.slugify(path.basename(diskName, path.extname(diskName)));
    const bytes = sizeOf(absSrc);
    for (let i = 1; ; i++) {
      const name = (i === 1 ? stem : stem + '_' + i) + ext;
      const had = landed.get(name.toLowerCase());
      if (!had) {
        const abs = path.join(musicDir, name);
        fs.copyFileSync(absSrc, abs);
        landed.set(name.toLowerCase(), { name, abs, bytes });
        return 'sound/' + name;
      }
      // The same song: one copy, and the caller is handed the spelling that is
      // on the disk rather than the one it asked for.
      if (had.bytes === bytes && sameBytes(had.abs, absSrc)) return 'sound/' + had.name;
    }
  };
}

// `music = sound/x.mp3 80 100 200` is a path followed by volume and loop
// numbers - select_params.go splitMusicParamValue ends the path at the last
// audio extension in the value. Only the path is carried: the numbers are the
// engine's own parameters and a library holds paths.
const MUSIC_PARAM_EXT = /\.(ogg|mp3|wav|flac|midi?|xm|mod|it|s3m)/ig;
function musicParamPath(v) {
  const str = String(v || '').replace(/;.*$/, '').trim();
  let end = -1, m;
  MUSIC_PARAM_EXT.lastIndex = 0;
  while ((m = MUSIC_PARAM_EXT.exec(str))) end = Math.max(end, m.index + m[0].length);
  return (end < 0 ? str : str.slice(0, end)).replace(/^"|"$/g, '').trim();
}

// Does anything in an installed theme still NAME this file? By whole value,
// over every .def in the folder - a `key = value` whose value is the path,
// which is the only way a screenpack references a file at all.
function namedByTheme(themeDir, ref) {
  const want = String(ref || '').replace(/\\/g, '/').trim().toLowerCase();
  if (!want) return true;
  const defs = [];
  const walk = (d) => {
    let ents = [];
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
    for (const e of ents) {
      if (e.isDirectory()) walk(path.join(d, e.name));
      else if (/\.def$/i.test(e.name)) defs.push(path.join(d, e.name));
    }
  };
  walk(themeDir);
  for (const f of defs) {
    const text = readText(f);
    if (text === null) continue;
    for (const raw of text.split(/\r?\n/)) {
      const m = /^[^;=\r\n]+=([^;\r\n]*)/.exec(raw);
      if (!m) continue;
      if (m[1].replace(/"/g, '').replace(/\\/g, '/').trim().toLowerCase() === want) return true;
    }
  }
  return false;
}

// ---- the build's own common states ----------------------------------------

// Every [Statedef N] in a CNS, with the lines that belong to it - so a
// controller or a trigger can be reported with the state it sits in.
//
// `type` IS TWO DIFFERENT KEYS. In the [Statedef] header it is the state TYPE
// (S, C, A, L - char.go); inside a [State ...] block it is the CONTROLLER
// name. Reading both as controllers reported five of the language's own
// letters as unknown controllers on the first real file this was run against,
// which is why the header and the blocks are tracked apart.
function cnsStates(text) {
  const lines = String(text || '').split(/\r?\n/);
  const out = [];
  let cur = null, inCtrl = false;
  for (let i = 0; i < lines.length; i++) {
    const bare = lines[i].replace(/;.*$/, '').trim();
    const m = /^\[\s*statedef\s+(-?\d+)/i.exec(bare);
    if (m) { cur = { no: parseInt(m[1], 10), line: i + 1, ctrls: [], triggers: [] }; out.push(cur); inCtrl = false; continue; }
    if (bare.startsWith('[')) { inCtrl = /^\[\s*state\s/i.test(bare); continue; }
    if (!cur) continue;
    const kv = /^([\w.()]+)\s*=\s*(.*)$/.exec(bare);
    if (!kv) continue;
    const key = kv[1].toLowerCase();
    if (key === 'type' && inCtrl) cur.ctrls.push({ type: kv[2].trim().toLowerCase(), line: i + 1 });
    else if (/^trigger(all|\d+)$/.test(key)) cur.triggers.push({ expr: kv[2], line: i + 1 });
  }
  return out;
}

// The names an expression asks the engine for. cnsexpr tokenizes the same
// grammar the compiler reads; a name followed by `(` or standing alone is a
// trigger, and a name after a `,` redirection is one too.
// WHICH IDENTIFIERS IN AN EXPRESSION ARE TRIGGERS, and which are not.
//
// The compiler parses several triggers' arguments itself rather than as
// expressions, so an identifier is not automatically a name the engine has to
// know. Three kinds are not:
//
//   * THE SECOND WORD OF A TWO-WORD TRIGGER - `vel x`, `pos y`, `p2bodydist x`,
//     `screenpos y`. The axis is part of the trigger, not a trigger.
//   * THE ARGUMENT OF A TRIGGER THAT TAKES A NAME - `const(movement.stand.
//     friction.threshold)`, `gethitvar(ctrltime)`, `stagevar(info.name)`,
//     `map(_sv_target)`, `animelemvar(...)`. Those names are the const table's
//     and the hit vars', not the trigger table's.
//   * THE VALUE SIDE OF A COMPARISON AGAINST A KEYWORD - `movetype != H`,
//     `statetype = A`, `hitdefattr = SCA, NA`, `teammode = simul`.
//
// Reading every identifier as a trigger flagged forty-two of these on the
// first real file, none of them real. The rule below reports only an
// identifier standing where a trigger stands.
const NAME_ARG = new Set(['const', 'gethitvar', 'stagevar', 'animelemvar', 'map', 'hitbyattr', 'command']);
const EXPR_WORDS = new Set([
  'and', 'or', 'xor', 'not', 'e', 'pi', 'inf', 'nan',
  // the letters a state type, a move type, a physics setting and a hit
  // attribute are written with
  's', 'c', 'a', 'n', 'h', 'l', 'i', 'u', 'd', 'b', 'f', 'p', 'm', 'r', 'x', 'y', 'z',
  'na', 'nt', 'np', 'sa', 'st', 'sp', 'ha', 'ht', 'hp', 'at', 'aa', 'ap',
  'sca', 'sc', 'ca', 'simul', 'turns', 'single', 'tag',
]);

function namesIn(expr) {
  let toks;
  try { toks = cnsexpr.tokenize(String(expr || '')); } catch (e) { return []; }
  const out = [];
  const argOf = [];                        // the call each open paren belongs to
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (!t) continue;
    if (t.k === 'op' && t.v === '(') { const prev = toks[i - 1]; argOf.push(prev && prev.k === 'id' ? prev.v.toLowerCase() : ''); continue; }
    if (t.k === 'op' && t.v === ')') { argOf.pop(); continue; }
    if (t.k !== 'id' || typeof t.v !== 'string') continue;
    const name = t.v.toLowerCase();
    const prev = toks[i - 1];
    if (prev && prev.k === 'id') continue;                       // an axis or member
    if (argOf.length && NAME_ARG.has(argOf[argOf.length - 1])) continue;  // a name argument
    if (EXPR_WORDS.has(name)) continue;
    out.push(name);
  }
  return out;
}

// THE STATE NUMBERS A CHARACTER'S CODE ASKS FOR, by the controller that
// carries one. Which parameter holds a state number depends on the controller
// (§3.2b): a state change carries `value`, a helper and a hit override carry
// `stateno`, a HitDef carries both sides. Reading every integer in the file
// instead would count damage, velocities and variable values as states, which
// is how a scan like this usually goes wrong.
const STATE_PARAM = {
  changestate: ['value'], selfstate: ['value'], targetstate: ['value'],
  helper: ['stateno'], hitoverride: ['stateno'], reversaldef: ['p1stateno', 'p2stateno'],
  hitdef: ['p1stateno', 'p2stateno'], modifyhitdef: ['p1stateno', 'p2stateno'],
  modifyreversaldef: ['p1stateno', 'p2stateno'],
};
function stateRefsIn(text) {
  const out = new Set();
  let type = null, pending = new Map();
  const flush = () => {
    const keys = type && STATE_PARAM[type];
    if (keys) for (const k of keys) { const v = pending.get(k); if (v !== undefined) out.add(v); }
    type = null; pending = new Map();
  };
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.replace(/;.*$/, '').trim();
    if (!line) continue;
    if (line[0] === '[') { flush(); continue; }
    const m = /^([\w.]+)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase();
    if (key === 'type') { type = m[2].trim().toLowerCase(); continue; }
    const num = /^\s*(-?\d+)\s*$/.exec(m[2]);
    if (num) pending.set(key, parseInt(num[1], 10));
  }
  flush();
  return out;
}

// WHAT THE ENGINE WOULD DO WITH THIS FILE. Pure: text in, model out.
function readCommonStates(text, engine) {
  const states = cnsStates(text);
  const scmap = engine && engine.controllers;
  const trmap = engine && engine.triggers;
  const badCtrls = [], badTriggers = [];
  const seenCtrl = new Set(), seenTrig = new Set();
  for (const st of states) {
    for (const c of st.ctrls) {
      if (!scmap || scmap.has(c.type) || seenCtrl.has(c.type)) continue;
      seenCtrl.add(c.type);
      badCtrls.push({ name: c.type, state: st.no, line: c.line });
    }
    for (const t of st.triggers) {
      for (const n of namesIn(t.expr)) {
        if (!trmap || trmap.has(n) || EXPR_WORDS.has(n) || seenTrig.has(n)) continue;
        seenTrig.add(n);
        badTriggers.push({ name: n, state: st.no, line: t.line });
      }
    }
  }
  const numbers = [...new Set(states.map((s) => s.no))].sort((a, b) => a - b);
  const own = engine && engine.stcommon ? numbers.filter((n) => n >= 0 && engine.stcommon.has(n)) : [];
  const shadowed = engine && engine.commonStates ? numbers.filter((n) => n >= 0 && engine.commonStates.has(n)) : [];
  const taken = new Set([...own, ...shadowed]);
  return {
    statedefs: states.length,
    numbers,
    negative: numbers.filter((n) => n < 0),
    // The numbers the engine already defines keep the ENGINE's version; the
    // rest are the mod's own and come through as written.
    keptByEngine: [...taken].sort((a, b) => a - b),
    ownStates: numbers.filter((n) => n >= 0 && !taken.has(n)),
    controllers: [...new Set(states.flatMap((s) => s.ctrls.map((c) => c.type)))].sort(),
    unknownControllers: badCtrls,
    unknownTriggers: badTriggers,
    checked: !!(scmap && trmap),
    // The one hard gate: a file listed in [Common] States that does not
    // compile fails EVERY character, so it is only listed when every name in
    // it is one the compiler knows.
    listable: !!(scmap && trmap) && !badCtrls.length && !badTriggers.length,
  };
}

// Which characters of this build call the states only that file defines.
//
// Read from each character's own state files, resolved through its [Files]
// section - a character's code is whatever [Files] names and never what the
// folder happens to hold (§3.2b, and the .def rule this project already lost a
// call to once).
//
// AND ONLY THE NUMBERS THE CHARACTER DOES NOT DEFINE HERSELF. The first
// definition of a state wins and a character's own files are compiled first
// (compiler.go:7111, 8340-8356), so a character with her own state 1000 is not
// depending on the common file's 1000 - she never reaches it. Counting every
// call instead made all 118 characters of the reference build look dependent,
// because state 1000 is a number half of them happen to use.
function dependents(root, chars, wanted, ls) {
  const want = new Set(wanted);
  const out = [];
  const done = new Set();
  let stcommon = 0, read = 0;
  for (const c of chars) {
    // A def named in two cells is one character, counted once.
    if (!c.dir || done.has(c.dir.toLowerCase() + '/' + c.def.toLowerCase())) continue;
    done.add(c.dir.toLowerCase() + '/' + c.def.toLowerCase());
    let text = '';
    const defText = readText(path.join(c.dir, c.def));
    if (defText === null) continue;
    read++;
    const files = [];
    {
      // Only the first [Files] section counts, and a repeated key keeps its
      // first value (§3.2b).
      let inFiles = false; const seen = new Set();
      for (const raw of defText.split(/\r?\n/)) {
        const line = raw.replace(/;.*$/, '').trim();
        const h = /^\[([^\]]+)\]/.exec(line);
        if (h) { if (inFiles) break; inFiles = /^files$/i.test(h[1].trim()); continue; }
        if (!inFiles) continue;
        // WHICH COMMON STATES THIS CHARACTER ASKS FOR. `stcommon = common1.cns`
        // is the standard line, and it is why an imported file must NOT be
        // shipped under that name: it would answer this key instead of the
        // engine's own common1.cns.zss, for every character in the bundle.
        const sc = /^stcommon\s*=\s*(\S+)/i.exec(line);
        if (sc && !seen.has('stcommon')) { seen.add('stcommon'); if (/^common1\.cns$/i.test(sc[1])) stcommon++; }
        const m = /^(st\d*|cmd)\s*=\s*(.+)$/i.exec(line);
        if (!m) continue;
        const k = m[1].toLowerCase();
        if (seen.has(k)) continue;
        seen.add(k);
        files.push(m[2].trim());
      }
    }
    if (!want.size) continue;
    for (const rel of files) {
      const hit = resolve(c.dir, rel, ls);
      const t = hit && readText(hit.abs);
      if (t) text += '\n' + t;
    }
    if (!text) continue;
    const mine = new Set(cnsStates(text).map((s) => s.no));
    const hits = [...stateRefsIn(text)].filter((n) => want.has(n) && !mine.has(n)).sort((a, b) => a - b);
    if (hits.length) out.push({ folder: c.folder, name: c.displayName || c.folder, states: hits });
  }
  return { list: out, stcommon, read };
}

// ---------------------------------------------------------------------------
// wholeBuildAt: is this a build at all? The add path's question, not the import's
// ---------------------------------------------------------------------------
//
// A whole build handed to the add path as a character or a stage is offered
// to the importer instead (/api/add-local's askIfBuild). The rule is
// public/ikemen/wholebuild-core.js, shared with the page, which answers a
// dropped folder from its entries; this reads what the rule looks at from
// disk - the folder's top and the names in its data/ and save/, any case - and
// asks it. At most three directory reads and nothing opened, so it is asked
// before a byte is copied. inspect() below is still what says whether the
// build can be imported.
const wholeBuildRule = require('./public/ikemen/wholebuild-core.js');

function wholeBuildAt(dir) {
  const root = path.resolve(String(dir || ''));
  if (!isDir(root)) return null;
  const ls = lister();
  // A junction or a link to a folder counts as the folder it leads to: a
  // build's chars/ can be one.
  const top = ls(root).map((e) => ({ name: e.name,
    dir: e.isDirectory() || (e.isSymbolicLink() && isDir(path.join(root, e.name))) }));
  const listing = { top };
  for (const sub of wholeBuildRule.LOOKS_IN) {
    const hit = top.find((e) => e.dir && e.name.toLowerCase() === sub);
    listing[sub] = hit ? ls(path.join(root, hit.name)).map((e) => e.name) : null;
  }
  return wholeBuildRule.fromListing(listing);
}

// ---------------------------------------------------------------------------
// inspect: the whole read, and the report that comes out of it
// ---------------------------------------------------------------------------

const AUDIO = /\.(ogg|mp3)$/i;
const OTHER_AUDIO = /\.(wav|flac|m4a|aiff?)$/i;
const PROGRAM = /\.(exe|dll|so|dylib|com|bat|cmd|ps1|sh)$/i;
const SHADER = /\.(frag|vert|glsl|fx)$/i;

// The packed tree of a build that keeps data/ inside its program, unpacked to
// a temp folder and registered as the build's twin (see UNPACKED). Null when
// the build has data/select.def on disk or no program of it is packed - such a
// build is read exactly as before. Throws when a packed program's layout is
// not the one boxedapp.js reads.
function unpackBuild(root) {
  if (!isDir(root)) return null;
  const ls = lister();
  if (resolveOn(root, 'data/select.def', ls)) return null;
  let boxedapp;
  try { boxedapp = require('./boxedapp.js'); } catch (e) { return null; }   // a copy without the reader reads as before
  const exe = ls(root).filter((e) => e.isFile() && /\.exe$/i.test(e.name))
    .map((e) => path.join(root, e.name)).find((p) => boxedapp.isPacked(p));
  if (!exe) return null;
  if (!boxedapp.list(exe).files.some((f) => !f.dir)) return null;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mugen-build-unpacked-'));
  const rm = () => require('./lifebars.js').rmTree(dir);
  let r;
  try { r = boxedapp.extract(exe, dir); } catch (e) { rm(); throw e; }
  const key = root.toLowerCase();
  UNPACKED.set(key, { root, dir });
  return {
    exe: r.exe, files: r.files, bytes: r.bytes, refused: r.refused, dir,
    release: () => { UNPACKED.delete(key); rm(); },
  };
}

// inspect, for a packed build too: the packed tree is unpacked for the length
// of the read and removed after it - or, with opts.keepUnpacked, kept until
// the caller calls inv.release() (run() does, when the import is done).
function inspect(dir, opts) {
  const o = opts || {};
  const root = path.resolve(String(dir || ''));
  let box;
  try { box = unpackBuild(root); } catch (e) {
    return Object.assign(inspectAt(dir, o), { ok: false, why: ['its program carries the build’s files packed inside it, in a layout this Studio does not read - ' + e.message] });
  }
  if (!box) return inspectAt(dir, o);
  let keep = false;
  try {
    const inv = inspectAt(dir, o);
    inv.unpacked = { exe: box.exe, files: box.files, bytes: box.bytes, refused: box.refused };
    keep = !!(o.keepUnpacked && inv.ok);
    if (keep) Object.defineProperty(inv, 'release', { value: box.release, enumerable: false });
    return inv;
  } finally { if (!keep) box.release(); }
}

function inspectAt(dir, opts) {
  const o = opts || {};
  const root = path.resolve(String(dir || ''));
  const ls = lister();
  const out = {
    root, ok: false, why: [], warnings: [],
    cfg: null, motif: null, select: null,
    chars: [], stages: [], music: [], fonts: [], sounds: [],
    menuMusic: [],
    dropped: [], unclassified: [], common: null, dependents: [],
  };
  if (!isDir(root)) { out.why.push('that is not a folder'); return out; }

  const top = ls(root);
  const has = (n) => top.some((e) => e.name.toLowerCase() === n);
  // TWO KINDS OF BUILD, one door. A MUGEN build is configured by data/mugen.cfg;
  // an Ikemen GO build by save/config.ini (save/config.json before 1.0), and
  // it keeps its screenpack wherever that file says - beside data/, on the
  // reference one. Both are read through their config from here on.
  const cfgHit = resolve(root, 'data/mugen.cfg', ls);
  const ikemenIni = cfgHit ? null : resolve(root, 'save/config.ini', ls);
  const ikemenJson = cfgHit || ikemenIni ? null : resolve(root, 'save/config.json', ls);
  const kind = cfgHit ? 'mugen' : (ikemenIni || ikemenJson) ? 'ikemen' : null;
  if (!kind) out.why.push('no data/mugen.cfg and no save/config.ini - a MUGEN build is configured by the first, an Ikemen GO build by the second');
  if (!has('chars')) out.why.push('no chars/ folder');
  if (out.why.length) return out;
  out.ok = true;
  out.kind = kind;
  const program = kind === 'ikemen' ? 'the Ikemen GO program' : 'the MUGEN program';

  // ---- the program, and everything of it that stays behind ----------------
  const exe = top.filter((e) => e.isFile() && /\.exe$/i.test(e.name)).map((e) => e.name);
  for (const e of top) {
    if (e.isFile() && PROGRAM.test(e.name)) out.dropped.push({ what: e.name, why: program });
  }
  const dropFolder = (folder, why) => {
    const hit = resolve(root, folder, ls);
    if (hit && isDir(hit.abs)) out.dropped.push({ what: hit.rel + '/', why, files: ls(hit.abs).length });
  };
  for (const folder of ['plugins', 'Elecbyte.MUGEN.libs', 'Microsoft.VC90.CRT']) dropFolder(folder, 'the MUGEN program’s libraries');
  if (kind === 'ikemen') {
    // An Ikemen GO install is the engine and the content in one folder. The
    // engine's half stays: this Studio ships its own program, scripts and
    // modules, and a build's copies of them describe the engine it ran on.
    dropFolder('lib', 'the Ikemen GO program’s libraries');
    dropFolder('external/script', 'the build’s copy of the engine’s scripts - this Studio ships its own');
    dropFolder('script', 'the build’s copy of the engine’s scripts - this Studio ships its own');
    dropFolder('external/mods', 'modules written for the engine’s script hooks; this bundle runs the Studio’s own set');
    dropFolder('external/shaders', 'the program’s shaders');
    dropFolder('shaders', 'the program’s shaders');
    dropFolder('cache', 'the program’s shader cache');
    dropFolder('save', 'the program’s save folder - its config is read; logs, replays and stats stay');
  }
  const dataDir = resolve(root, 'data', ls);
  if (dataDir) {
    for (const e of ls(dataDir.abs)) {
      if (!e.isFile()) continue;
      if (/\.lua$/i.test(e.name)) out.dropped.push({ what: 'data/' + e.name, why: kind === 'ikemen' ? 'the engine’s own script - this Studio ships its own' : 'MUGEN’s own script - it names MUGEN’s interfaces, not this engine’s' });
      else if (SHADER.test(e.name)) out.dropped.push({ what: 'data/' + e.name, why: kind === 'ikemen' ? 'the program’s shader' : 'a MUGEN shader' });
      else if (kind === 'ikemen' && ENGINE_DATA.has(e.name.toLowerCase())) out.dropped.push({ what: 'data/' + e.name, why: 'the engine’s own data file - this engine ships its own; what the screenpack names comes with the screenpack' });
    }
  }
  out.engine = {
    exe: exe[0] || null,
    kind,
    // MUGEN 1.1 is the version that added the [Video] section and the
    // stage-zoom keys; 1.0 has neither. Read, never guessed from the exe name.
    version: null,
  };

  // ---- data/mugen.cfg, or save/config.ini --------------------------------
  if (kind === 'mugen') {
    const cfgIni = readIni(readText(cfgHit.abs));
    out.cfg = {
      kind,
      path: cfgHit.rel,
      motif: iniGet(cfgIni, 'options', 'motif'),
      gameWidth: iniGet(cfgIni, 'config', 'gamewidth'),
      gameHeight: iniGet(cfgIni, 'config', 'gameheight'),
      difficulty: iniGet(cfgIni, 'options', 'difficulty'),
      life: iniGet(cfgIni, 'options', 'life'),
      time: iniGet(cfgIni, 'options', 'time'),
      gameSpeed: iniGet(cfgIni, 'options', 'gamespeed') ?? iniGet(cfgIni, 'config', 'gamespeed'),
      team1vs2Life: iniGet(cfgIni, 'options', 'team.1vs2life'),
      teamLoseOnKO: iniGet(cfgIni, 'options', 'team.loseonko'),
    };
    out.engine.version = cfgIni.sections.has('video') ? '1.1' : '1.0';
  } else {
    out.cfg = readIkemenCfg(ikemenIni || ikemenJson, !!ikemenIni);
    out.engine.version = ikemenIni ? 'GO 1.0' : 'GO 0.9';
  }

  // ---- the screenpack ------------------------------------------------------
  const motifRel = (out.cfg.motif || 'data/system.def').replace(/\\/g, '/');
  const motifHit = resolve(root, motifRel, ls);
  if (!motifHit) {
    out.warnings.push('data/mugen.cfg launches ' + motifRel + ', which is not in this build');
  } else {
    const mIni = readIni(readText(motifHit.abs));
    // `dir` is the screenpack's folder as the build has it (data/main, or r2
    // beside data/ on an Ikemen GO build); `folder` is its name under data/
    // when it is there, the whole thing when it is not, null when the motif
    // sits in data/ itself.
    const mdir = path.posix.dirname(motifHit.rel);
    out.motif = {
      rel: motifHit.rel,
      dir: mdir,
      folder: mdir === 'data' || mdir === '.' ? null : (mdir.startsWith('data/') ? mdir.slice(5) : mdir),
      name: iniGet(mIni, 'info', 'name'),
      author: iniGet(mIni, 'info', 'author'),
      localcoord: iniGet(mIni, 'info', 'localcoord'),
      mugenversion: iniGet(mIni, 'info', 'mugenversion'),
      fight: iniGet(mIni, 'files', 'fight'),
      spr: iniGet(mIni, 'files', 'spr'),
      bytes: 0,
    };
    const folderHit = out.motif.folder && resolve(root, out.motif.dir, ls);
    if (folderHit) {
      const walk = (d) => { let n = 0; for (const e of ls(d)) n += e.isDirectory() ? walk(path.join(d, e.name)) : sizeOf(path.join(d, e.name)); return n; };
      out.motif.bytes = walk(folderHit.abs);
    }
    // The pack's own menu music, resolved where the engine would find it.
    for (const k of motifMusicKeys(mIni)) {
      const tracks = k.refs.map((ref) => {
        const hit = resolveMotifMusic(root, motifHit.rel, ref, ls);
        return { ref, found: !!hit, rel: hit ? hit.rel : null, abs: hit ? hit.abs : null, bytes: hit ? sizeOf(hit.abs) : 0 };
      });
      out.menuMusic.push({ key: k.key, prefix: k.prefix, field: k.field, tracks });
    }
  }

  // ---- the roster ----------------------------------------------------------
  // WHERE THE ROSTER IS. The motif names it (`select = select.def`) and the
  // engine resolves that against the motif's own folder first, then data/,
  // then the root - so a build that keeps its whole screenpack in data/main/
  // has its select.def there too, and "no data/select.def" was refusing a
  // perfectly good build. data/select.def stays as the fallback for a cfg
  // that names no motif.
  let selHit = null;
  {
    const named = (out.motif && iniGet(readIni(readText(resolve(root, out.motif.rel, ls).abs)), 'files', 'select')) || 'select.def';
    const mdir = out.motif ? path.posix.dirname(out.motif.rel) : 'data';
    for (const cand of [mdir + '/' + named, 'data/' + named, named, 'data/select.def']) {
      selHit = resolve(root, cand, ls);
      if (selHit && isDir(selHit.abs)) selHit = null;
      if (selHit) break;
    }
  }
  if (!selHit) {
    out.ok = false;
    out.why.push('no select.def - that is the roster; looked beside the screenpack' + (out.motif ? ' (' + path.posix.dirname(out.motif.rel) + '/)' : '') + ' and in data/');
    return out;
  }
  out.select = selHit.rel;
  // The label this Studio writes locks with, when the active bundle chose its
  // own (roster.lockLabel), is accepted too; the default always is.
  let lockLabels = [];
  try { const rl = require('./vfslib.js').readRoster().lockLabel; if (rl) lockLabels = [rl]; } catch (e) { lockLabels = []; }
  const sel = parseSelect(readText(selHit.abs), { lockLabels });
  const cells = [];
  const chars = [];
  const unresolved = [];
  const usedFolders = new Map();
  // A CELL IS A POSITION, NOT A LINE. A placeholder consumes one, an
  // `exclude = 1` entry consumes none, and a whole `slot = { ... }` block is
  // ONE cell whatever it holds (GRAIL 4.12). `cells` is the grid as the engine
  // would lay it out; `chars` is the flat list of characters behind it.
  let cellNo = 0, openSlot = null;
  // `locked` rides on the cell for a placeholder or a hole, and on the
  // character for a character, which is where each lives in a roster.
  const lk = (e) => (e.locked ? { locked: true } : {});
  for (const e of sel.entries) {
    if (e.kind) { cells.push(Object.assign({ cell: cellNo++, kind: e.kind, degraded: e.degraded || null }, lk(e))); openSlot = null; continue; }
    const excluded = String((e.params && e.params.get('exclude')) || '') === '1';
    const r = resolveCharEntry(root, e.name, ls);
    if (excluded) {
      if (r.ok) chars.push(Object.assign({ name: e.name, cell: null, exclude: true, params: e.params, stage: e.stage }, r, lk(e)));
      else unresolved.push({ name: e.name, why: r.why, cell: null });
      continue;
    }
    let cell;
    if (e.slot && openSlot && openSlot.id === e.slot) cell = openSlot.cell;
    else { cell = cellNo++; openSlot = e.slot ? { id: e.slot, cell } : null; }
    // One entry in `cells` per cell, whatever the block holds. A cell only a
    // broken reference lands in is a hole - the engine draws it as one
    // (GRAIL 4.12 trap 9) - and one member of a block resolving makes the
    // whole cell a character's.
    const at = cells.length && cells[cells.length - 1].cell === cell ? cells[cells.length - 1] : null;
    if (!r.ok) {
      unresolved.push({ name: e.name, why: r.why, cell, meant: looksMeant(e.name) });
      if (!at) cells.push(Object.assign({ cell, kind: 'dummy', from: e.name, slot: e.slot }, lk(e)));
      continue;
    }
    const key = r.folder.toLowerCase() + '/' + r.def.toLowerCase();
    if (!usedFolders.has(key)) usedFolders.set(key, chars.length);
    chars.push(Object.assign({ name: e.name, cell, params: e.params, stage: e.stage, slot: e.slot }, r, lk(e)));
    if (!at) cells.push({ cell, kind: 'char', from: e.name, slot: e.slot });
    else if (at.kind === 'dummy') {
      // A locked block whose first member did not resolve: the lock was the
      // cell's, so it moves to the member that now holds the cell.
      if (at.locked) chars[chars.length - 1].locked = true;
      at.kind = 'char'; at.from = e.name; delete at.locked;
    }
  }
  // Display names, read from each def the way the Studio reads one.
  const modlib = require('./modlib.js');
  for (const c of chars) {
    const t = readText(path.join(c.dir, c.def));
    if (t === null) continue;
    const kv = modlib.parseDefSections(t);
    c.displayName = modlib.reencodeName(kv['displayname'] || kv['name']) || c.folder;
  }

  // ---- stages --------------------------------------------------------------
  const wantStages = new Map();
  const addStageRef = (ref, from) => {
    const v = String(ref || '').trim().replace(/\\/g, '/');
    if (!v || /^random$/i.test(v)) return;
    const k = v.toLowerCase();
    if (!wantStages.has(k)) wantStages.set(k, { ref: v, from: [] });
    wantStages.get(k).from.push(from);
  };
  for (const c of chars) if (c.stage) addStageRef(c.stage, c.name);
  for (const s of sel.extraStages) addStageRef(s.file, '[ExtraStages]');
  for (const [, v] of wantStages) {
    const hit = resolve(root, v.ref, ls);
    const st = { ref: v.ref, from: v.from, found: !!hit, rel: hit ? hit.rel : null, abs: hit ? hit.abs : null };
    if (hit) {
      const kv = modlib.parseDefSections(readText(hit.abs) || '');
      st.name = modlib.reencodeName(kv['name']) || path.basename(hit.rel, '.def');
    }
    out.stages.push(st);
  }
  // Stage files sitting in stages/ that no entry names: content, still worth
  // saying, because a build's extra stages are usually a deliberate library.
  const stageDir = resolve(root, 'stages', ls);
  let onDiskStages = 0;
  if (stageDir) {
    for (const e of ls(stageDir.abs)) {
      if (!e.isFile() || !/\.def$/i.test(e.name)) continue;
      onDiskStages++;
      const k = ('stages/' + e.name).toLowerCase();
      if (!wantStages.has(k)) out.unclassified.push({ what: 'stages/' + e.name, why: 'a stage no roster entry names' });
    }
  }

  // ---- music, sounds, fonts -----------------------------------------------
  const soundDir = resolve(root, 'sound', ls);
  if (soundDir) {
    for (const e of ls(soundDir.abs)) {
      if (!e.isFile()) continue;
      const p = path.join(soundDir.abs, e.name);
      if (AUDIO.test(e.name)) out.music.push({ rel: 'sound/' + e.name, abs: p, bytes: sizeOf(p) });
      else if (OTHER_AUDIO.test(e.name)) out.dropped.push({ what: 'sound/' + e.name, why: 'the music library takes .ogg and .mp3 only' });
    }
  }
  if (dataDir) {
    for (const e of ls(dataDir.abs)) {
      if (!e.isFile()) continue;
      const p = path.join(dataDir.abs, e.name);
      // Only .snd here. data/*.mp3 is the SCREENPACK's music - its menu,
      // versus and victory tracks - and it reaches the song library through
      // the motif's own [Music] section instead (the menu-music block in
      // run()), which is the only place the KEY that names a track, and so the
      // name the library must carry it under, is known. Sweeping data/ blind
      // would put tracks in the library that nothing in the bundle names.
      if (/\.snd$/i.test(e.name)) out.sounds.push({ rel: 'data/' + e.name, bytes: sizeOf(p) });
    }
  }
  const fontDir = resolve(root, 'font', ls);
  if (fontDir) for (const e of ls(fontDir.abs)) if (e.isFile()) out.fonts.push('font/' + e.name);

  // ---- the build's own engine logic ---------------------------------------
  const commonHit = resolve(root, 'data/common1.cns', ls);
  if (commonHit) {
    const text = readText(commonHit.abs);
    const engine = o.engine || {
      controllers: enginedata.stateControllers(),
      triggers: enginedata.triggers(),
      stcommon: enginedata.stcommonStates(),
      commonStates: enginedata.commonStates({}),
    };
    out.common = Object.assign({ rel: commonHit.rel, abs: commonHit.abs, bytes: sizeOf(commonHit.abs) },
      readCommonStates(text, engine));
    const d = dependents(root, chars, out.common.ownStates, ls);
    out.dependents = d.list;
    out.common.stcommonChars = d.stcommon;
    out.common.charsRead = d.read;
  }

  // ---- an Ikemen GO build's own common files -------------------------------
  //
  // Its config names the files the engine runs on every character: [Common]
  // States (ZSS or CNS), Air, Cmd, Const and Fx. In that build they take the
  // place of the engine's own lists, and they do here too (run below). Each
  // entry is resolved where the engine would find it, and an entry that is
  // the engine's own file - a stock name under data/, byte for byte the
  // engine's copy, or the engine's effects pack - is kept as the engine's
  // path rather than carried: the build did not change it.
  if (kind === 'ikemen' && out.cfg.common) {
    const engineData = engineDataDir(o.layout || layout);
    const entry = (ref) => {
      const hit = resolve(root, ref, ls);
      const found = !!(hit && !isDir(hit.abs));
      const e = { ref, found, rel: hit ? hit.rel : null, abs: hit ? hit.abs : null, bytes: found ? sizeOf(hit.abs) : 0, stock: false };
      // The engine's own: its effects pack by name; a stock-named data/ file
      // when the build's copy is the engine's byte for byte - or when the
      // build does not even carry one, since the engine here does.
      const m = /^data\/(.+)$/i.exec(found ? e.rel : ref.replace(/\\/g, '/'));
      if (m) {
        const inner = m[1];
        if (/^gofx\//i.test(inner)) e.stock = true;
        else if (ENGINE_DATA.has(inner.toLowerCase())) {
          if (!found) e.stock = true;
          else if (engineData) { try { e.stock = fs.readFileSync(path.join(engineData, inner)).equals(fs.readFileSync(e.abs)); } catch (err) { e.stock = false; } }
        }
      }
      return e;
    };
    const c = out.cfg.common;
    out.commonFiles = {
      states: c.states.map(entry), air: c.air.map(entry), cmd: c.cmd.map(entry), fx: c.fx.map(entry),
      const: c.const ? entry(c.const) : null,
      font: null,
    };
    out.commonFiles.files = out.commonFiles.states;
    // The debug font is a readout font as much as a debug one: a build's own
    // state code draws its training and record text with font -1, which is
    // this. The engine's own fonts stay the engine's; the build's own comes
    // across as a file, with its scale. Only a bitmap font can be drawn by
    // the browser build, so the def says which kind it is.
    if (out.cfg.debugFont && out.cfg.debugFont.file) {
      const f = entry(out.cfg.debugFont.file);
      const engineFont = (() => { try { return path.join((o.layout || layout).dir('ikemen-go-src'), 'font'); } catch (e) { return null; } })();
      const m = /^font\/(.+)$/i.exec(f.found ? f.rel : f.ref);
      if (m && engineFont && fs.existsSync(path.join(engineFont, m[1]))) f.stock = true;
      f.scale = out.cfg.debugFont.scale;
      f.bitmap = false;
      f.sff = null;
      if (f.found && !f.stock) {
        const text = readText(f.abs) || '';
        f.bitmap = !/^\s*type\s*=\s*truetype/im.test(text);
        const fm = /^\s*file\s*=\s*([^;\r\n]+)/im.exec(text);
        if (fm) { const hit = resolve(path.dirname(f.abs), fm[1].trim().replace(/\\/g, '/'), ls); if (hit && !isDir(hit.abs)) f.sff = { rel: relToBuild(root, hit.abs), abs: hit.abs }; }
      }
      out.commonFiles.font = f;
    }
  }

  // ---- what is left over ---------------------------------------------------
  const KNOWN_TOP = new Set(['chars', 'stages', 'sound', 'font', 'data', 'plugins', 'elecbyte.mugen.libs', 'microsoft.vc90.crt']);
  if (kind === 'ikemen') {
    for (const n of ['save', 'external', 'lib', 'cache', 'shaders', 'script', 'video']) KNOWN_TOP.add(n);
    // the folder the screenpack lives in, wherever the config put it
    if (out.motif) KNOWN_TOP.add(out.motif.rel.split('/')[0].toLowerCase());
  }
  for (const e of top) {
    const n = e.name.toLowerCase();
    if (KNOWN_TOP.has(n)) continue;
    if (e.isFile() && (PROGRAM.test(e.name) || /\.(log|txt|md|cfg)$/i.test(e.name))) {
      if (!PROGRAM.test(e.name)) out.unclassified.push({ what: e.name, why: 'a note or a log from the build' });
      continue;
    }
    out.unclassified.push({ what: e.name + (e.isDirectory() ? '/' : ''), why: 'nothing here reads this' });
  }

  const charDir = resolve(root, 'chars', ls);
  const folders = charDir ? ls(charDir.abs).filter((e) => e.isDirectory()).length : 0;
  out.chars = chars;
  out.unresolved = unresolved;
  out.counts = {
    cells: cellNo,
    placeholders: cells.filter((c) => c.kind === 'skip' || c.kind === 'dummy').length,
    random: cells.filter((c) => c.kind === 'random').length,
    entries: sel.entries.length,
    characters: chars.length,
    unresolved: unresolved.length,
    // The two halves of "resolves to nothing": a cell the author kept blank
    // on purpose, and a reference that meant a character and lost it.
    reserved: unresolved.filter((u) => !u.meant).length,
    broken: unresolved.filter((u) => u.meant).length,
    charFolders: folders,
    unrostered: Math.max(0, folders - new Set(chars.map((c) => c.folder.toLowerCase())).size),
    stagesNamed: out.stages.length,
    stagesFound: out.stages.filter((s) => s.found).length,
    stagesOnDisk: onDiskStages,
    music: out.music.length,
    fonts: out.fonts.length,
    // The tracks the SCREENPACK names, which are a different set from the
    // build's sound/ library: some of them live in data/ and never reach it.
    menuNamed: out.menuMusic.reduce((n, e) => n + e.tracks.length, 0),
    menuFound: out.menuMusic.reduce((n, e) => n + e.tracks.filter((t) => t.found).length, 0),
    menuSettable: out.menuMusic.filter((e) => e.field && e.tracks.some((t) => t.found)).length,
  };
  out.maxMatches = {
    arcade: (sel.options.get('arcade.maxmatches') || '').split(',').map((x) => parseInt(x, 10) || 0),
    team: (sel.options.get('team.maxmatches') || '').split(',').map((x) => parseInt(x, 10) || 0),
  };
  out.cells = cells;
  return out;
}

// WHAT THE PERSON READS BEFORE ANYTHING IS WRITTEN. One list of what comes
// across, one of what does not, and the engine-logic paragraph - the only part
// of an import that is not simply "copy the files".
// A build this big is usually better opened where it is (GRAIL 3.18): an import
// copies every character into a writable bundle (47 GB for an 810-character
// install). The owner's threshold.
const BIG_BUILD = 150;
function report(inv) {
  if (!inv.ok) return { ok: false, why: inv.why };
  const c = inv.counts;
  const brings = [
    { what: 'characters', n: c.characters, note: c.broken ? c.broken + ' more roster lines meant a character and point at nothing' : '' },
    { what: 'stages', n: c.stagesFound, note: c.stagesNamed - c.stagesFound ? (c.stagesNamed - c.stagesFound) + ' named stages are not in the build' : '' },
    { what: 'music tracks', n: c.music, note: '' },
    { what: 'roster cells', n: c.cells, note: c.placeholders + ' of them empty (' + c.reserved + ' the author kept blank), ' + c.random + ' random' },
  ];
  if (inv.motif) brings.push({ what: 'screenpack', n: 1, note: (inv.motif.name || inv.motif.folder) + ', installed as this bundle’s theme' });
  const menu = menuMusicReport(inv);
  if (menu.named) {
    brings.push({ what: 'menu tracks the screenpack names', n: menu.found, note: menu.note });
  }
  const notes = [];
  if (c.characters >= BIG_BUILD) {
    notes.push(c.characters + ' characters - a build this size is usually better opened where it is'
      + ' (Bundles > Open a build where it is, which copies nothing) unless you mean to edit it');
  }
  if (inv.unpacked) {
    const u = inv.unpacked;
    notes.push(u.files + ' files unpacked from ' + u.exe + ' - this build keeps its data/ and stages/ packed inside its program'
      + (u.refused.length ? '; ' + u.refused.length + ' packed path' + (u.refused.length === 1 ? ' was' : 's were') + ' refused as unsafe' : ''));
  }
  for (const t of menu.notes) notes.push(t);
  if (c.unrostered) {
    // run() copies the roster's characters only (inv.chars), so these stay behind.
    const one = c.unrostered === 1;
    notes.push(c.unrostered + (one ? ' character folder is' : ' character folders are') + ' in chars/ but on no roster line; '
      + (one ? 'it is' : 'they are') + ' not imported (files the imported characters use from ' + (one ? 'it' : 'them') + ' still come across)'
      + ' - add ' + (one ? 'it' : 'them') + ' afterwards from the build\'s chars/ folder');
  }
  const rules = rulesFromCfg(inv.cfg);
  if (Object.keys(rules).length) {
    notes.push('the build\'s own rules come across as this bundle\'s settings: '
      + Object.entries(rules).map(([k, v]) => k.replace(/^Options\./, '') + ' ' + v).join(', '));
  }
  if (inv.cfg && inv.cfg.gameWidth) {
    notes.push(inv.kind === 'ikemen'
      ? 'the build runs at ' + inv.cfg.gameWidth + 'x' + inv.cfg.gameHeight + ' - the desktop export takes that render size with the rest of its video settings; the website build picks its own picture size at load'
      : 'the build runs at ' + inv.cfg.gameWidth + 'x' + inv.cfg.gameHeight + ' - a render size, not content, and this Studio sets its own in Settings');
  }
  if (inv.kind === 'ikemen') {
    notes.push('an Ikemen GO build: its content comes across the same way, and the engine half of the folder - the program, '
      + 'its copies of the engine’s scripts and modules - stays, because this Studio ships its own');
    const f = inv.commonFiles && inv.commonFiles.font;
    if (f && f.found && !f.stock) {
      notes.push('its readout font (' + f.ref + ', the debug font its training and record text draws with) comes across as a file of this bundle'
        + (f.bitmap ? ', for the desktop export and the website build alike' : '; the website build cannot draw a TrueType font and keeps its own'));
    }
  }
  // The starter stage is a decision this import makes, and it is made from
  // what the build brings - so it can be said before anything is written.
  if (!c.stagesFound) {
    notes.push('no stage of this build could be read, so the bundle keeps the engine’s own '
      + 'Mountainside Temple: the engine needs a stage to start');
  }
  return {
    ok: true, root: inv.root, engine: inv.engine, cfg: inv.cfg, motif: inv.motif,
    unpacked: inv.unpacked ? { exe: inv.unpacked.exe, files: inv.unpacked.files } : null,
    brings, notes, dropped: inv.dropped, unclassified: inv.unclassified,
    warnings: inv.warnings,
    menuMusic: menu,
    starterStage: c.stagesFound ? null : 'kfm.def',
    logic: commonReport(inv),
  };
}

// WHAT THE SCREENPACK ASKS FOR AND WHAT THIS BUNDLE CAN GIVE IT. Three
// different answers, and the person reads all three: a track the Studio has a
// setting for, a track that comes across and plays but that the Studio cannot
// change, and a track the pack names and the build does not have.
function menuMusicReport(inv) {
  const list = inv.menuMusic || [];
  const named = list.reduce((n, e) => n + e.tracks.length, 0);
  const found = list.reduce((n, e) => n + e.tracks.filter((t) => t.found).length, 0);
  const settable = list.filter((e) => e.field && e.tracks.some((t) => t.found));
  const noSetting = list.filter((e) => !e.field && e.tracks.some((t) => t.found));
  const missing = [];
  for (const e of list) for (const t of e.tracks) if (!t.found) missing.push({ key: e.key, ref: t.ref });
  const notes = [];
  if (settable.length) {
    notes.push('the screenpack’s ' + settable.map((e) => e.key).join(' and ')
      + ' become this bundle’s menu music, and you can change them on the Content page');
  }
  if (noSetting.length) {
    notes.push(noSetting.map((e) => e.key).join(' and ') + ' come across and keep playing, but this Studio '
      + 'has no setting for them: the only menu music it can change is the title and character-select tracks, '
      + 'so those are the screenpack’s own choice until you edit its system.def');
  }
  for (const m of missing) notes.push(m.key + ' names ' + m.ref + ', which is not in this build - that screen stays silent');
  const multi = settable.filter((e) => e.tracks.filter((t) => t.found).length > 1);
  for (const e of multi) {
    notes.push(e.key + ' names ' + e.tracks.filter((t) => t.found).length + ' tracks; the Studio’s setting holds one, '
      + 'so the first is used and the rest sit in the music library');
  }
  const note = named === found ? 'all of them are in the build'
    : (named - found) + ' of them ' + (named - found === 1 ? 'is' : 'are') + ' not in the build';
  return { named, found, note, notes, settable: settable.map((e) => e.key), noSetting: noSetting.map((e) => e.key), missing };
}

// The engine-logic paragraph, in the terms the engine decides it in.
function commonReport(inv) {
  if (inv.commonFiles) {
    const k = inv.commonFiles;
    const all = [...k.states, ...k.air, ...k.cmd, ...k.fx];
    const missing = all.filter((f) => !f.found && !f.stock);
    const own = (list) => list.filter((f) => f.found && !f.stock);
    const lines = [];
    // A config with no [Common] States line (save/config.ini holding only
    // [Config]) lists none: said plainly, not as "lists 0 ...: ." followed by
    // what files that do not exist would do.
    if (!k.states.length) lines.push('This build’s config lists no common state files ([Common] States), so its characters run on this engine’s own common states.');
    else lines.push('This build’s config lists ' + k.states.length + ' common state file' + (k.states.length === 1 ? '' : 's')
      + ' ([Common] States): ' + k.states.map((f) => f.ref).join(', ')
      + '. In that build they take the place of the engine’s own list - the author’s versions of the engine’s files, and extras on top - '
      + 'and they do here too: the ' + own(k.states).length + ' that are the build’s own are carried into the bundle under engine/' + BUILD_COMMON_DIR
      + '/ and listed in place of this engine’s own States, so the build’s systems run as its author wrote them, on the website build and the desktop export alike.'
      + (k.states.some((f) => f.stock) ? ' The rest are the engine’s own files, byte for byte, and stay the engine’s.' : ''));
    const extras = [];
    if (own(k.air).length) extras.push('its common animations (' + own(k.air).map((f) => f.ref).join(', ') + ')');
    if (own(k.cmd).length) extras.push('its common commands (' + own(k.cmd).map((f) => f.ref).join(', ') + ')');
    if (own(k.fx).length) extras.push('the effects pack' + (own(k.fx).length === 1 ? '' : 's') + ' it lists beside the engine’s (' + own(k.fx).map((f) => f.ref).join(', ') + ')');
    if (extras.length) lines.push('The same goes for ' + extras.join(', ') + '.');
    if (k.const && k.const.found && !k.const.stock) lines.push('Its own common.const (' + k.const.ref + ') becomes this build’s constant overrides: only the keys it sets differently from the engine’s, on the Engine tab, where you can change them.');
    if (missing.length) lines.push(missing.length + ' of the files it lists ' + (missing.length === 1 ? 'is' : 'are') + ' not in the build and ' + (missing.length === 1 ? 'is' : 'are') + ' left off the line: ' + missing.map((f) => f.ref).join(', ') + '.');
    // The same check every export makes (checkOwnStates), said now.
    let refused = [];
    try {
      const listed = k.states.filter((f) => f.found || f.stock).map((f) => (f.found ? f.rel : f.ref).replace(/\\/g, '/'));
      const byRel = new Map(k.states.filter((f) => f.found && !f.stock).map((f) => [f.rel.replace(/\\/g, '/').toLowerCase(), f.abs]));
      refused = checkOwnStates(listed, (v) => (byRel.has(v.toLowerCase()) ? readText(byRel.get(v.toLowerCase())) || '' : null)).report;
    } catch (e) { refused = []; }
    if (refused.length) lines.push('Written for the engine inside that build, ' + refused.length + ' of them would stop every character loading on this one: ' + refused.join('; ') + '.');
    if (k.states.length) {
      lines.push('Its ZSS files are checked against this engine’s compiler rules on every export, and one that would not compile gives way to the engine’s file for its part. '
        + 'The check is not the compiler itself, so the first thing to do with this bundle is still to start a match. If nothing loads, the Engine tab is where to take a file off the list.');
    }
    return {
      has: true, ikemen: true, listable: true, checked: false,
      files: k.states, missing: missing.map((f) => f.ref), text: lines.join(' '),
    };
  }
  if (!inv.common) {
    return { has: false, text: 'This build has no data/common1.cns of its own, so it adds no engine logic: every character runs on this engine’s own common states.' };
  }
  const k = inv.common;
  const deps = inv.dependents.length;
  const lines = [];
  lines.push(k.rel + ' is ' + Math.round(k.bytes / 1024) + ' KB and defines ' + k.statedefs
    + ' states. That is this build’s own engine logic, not content: '
    + deps + ' of its ' + (k.charsRead || 0) + ' characters call states only this file defines, and without it '
    + 'they reach a state nobody defines - which the engine answers with an empty state and no message, so they freeze where they called it.');
  lines.push('It is NOT installed as data/common1.cns: ' + (k.stcommonChars || 0) + ' of this build’s characters say '
    + '"stcommon = common1.cns", and a file under that name would answer them instead of this engine’s own '
    + 'common1.cns.zss - for every character in the bundle, including any added later.');
  if (!k.checked) {
    lines.push('It could not be checked against the engine’s compiler (this copy has no engine source), so it is carried into the bundle and left unlisted.');
  } else if (!k.listable) {
    const bad = k.unknownControllers.concat(k.unknownTriggers).slice(0, 6)
      .map((b) => b.name + ' (state ' + b.state + ', line ' + b.line + ')').join(', ');
    lines.push('It names ' + (k.unknownControllers.length + k.unknownTriggers.length)
      + ' things this engine’s compiler has no name for: ' + bad + '.');
    lines.push('A file listed in [Common] States that does not compile fails EVERY character in the build, '
      + 'so it is carried into the bundle and left unlisted, and those ' + deps + ' characters will freeze '
      + 'where they call it. The file is in the bundle if you want to edit those names out.');
  } else {
    lines.push('Every controller and trigger in it is one this engine’s compiler knows, so it is listed as '
      + '[Common] ' + BUILD_STATES_KEY + ' = ' + BUILD_STATES_VPATH + ', after this engine’s own common states.');
    lines.push('What that gets you: ' + k.ownStates.length + ' of its states are numbers no engine file defines - '
      + 'this build’s own tag, assist and system states - and they come through exactly as written. '
      + 'The other ' + k.keptByEngine.length + ' are standard MUGEN numbers this engine defines too, and those keep '
      + 'the ENGINE’s version: a character’s stcommon is compiled before any [Common] States file, so nothing '
      + 'listed there can outrank data/common1.cns.zss. There is no position in the list that changes that.');
    if (k.negative.length) {
      lines.push('Its ' + k.negative.map((n) => 'Statedef ' + n).join(' and ')
        + ' is APPENDED to each character’s own rather than replacing it, so this build’s per-frame driver runs on '
        + 'every character in the bundle - and on top of the copy a character already carries, where it carries one.');
    }
    lines.push('This is what the engine will do with the file. It is not a promise that the mod works: '
      + 'anything of it that lived in the MUGEN program rather than in this file did not come across.');
  }
  return {
    has: true, listable: k.listable, checked: k.checked,
    file: k.rel, bytes: k.bytes, statedefs: k.statedefs,
    kept: k.keptByEngine, own: k.ownStates, negative: k.negative,
    unknownControllers: k.unknownControllers, unknownTriggers: k.unknownTriggers,
    dependents: inv.dependents, key: BUILD_STATES_KEY, vpath: BUILD_STATES_VPATH,
    text: lines.join(' '),
  };
}

// ---------------------------------------------------------------------------
// the import
// ---------------------------------------------------------------------------

// Characters, stages and music go into the NEW bundle's folders, never the one
// being edited, and the source is only ever read. bundles.create makes the
// bundle - one creation path, so an imported bundle is the same shape as an
// empty one and is valid the moment it exists.
// A packed build's unpacked tree (see UNPACKED) stays for the length of the
// import and is removed after it, whatever happens.
function run(dir, name, opts) {
  const o = opts || {};
  if (o.inspected) return runInspected(name, o, o.inspected);
  const inv = inspect(dir, Object.assign({}, o, { keepUnpacked: true }));
  try { return runInspected(name, o, inv); } finally { if (inv.release) inv.release(); }
}

function runInspected(name, o, inv) {
  const L = o.layout || layout;
  const bundles = o.bundles || require('./bundles.js');
  const modlib = require('./modlib.js');
  if (!inv.ok) throw new Error('that folder is not a MUGEN or Ikemen GO build: ' + inv.why.join('; '));

  const before = bundles.list(L);
  // THE STARTER STAGE IS NOT WANTED HERE when the build brings its own. A new
  // bundle is seeded with the engine's Mountainside Temple so that it is
  // playable before anything is added (bundles.js), and an import that brings
  // twenty-eight stages has no use for a twenty-ninth nobody picked - it turned
  // up in an imported CvS roster and read as one of the pack's own stages. It
  // is also a NAME COLLISION waiting to happen: a build with a stages/kfm.def
  // of its own found the seeded file already sitting there, kept it, and never
  // copied its own or gave it a roster line.
  //
  // Asked for up front rather than deleted afterwards, so the build's own files
  // are never written into a folder that already has a stranger's. A build that
  // brings NO stage still needs one - the engine needs a stage to start - and
  // gets it below, after the copying, from the same seed.
  const bringsStage = inv.stages.some((s) => s.found);
  bundles.create(name, L, { seedStage: !bringsStage });
  const entry = bundles.list(L).bundles.find((b) => b.name === String(name).trim());
  if (!entry) throw new Error('the bundle was made but cannot be found again: ' + name);
  // HALF AN IMPORT IS WORSE THAN NONE. Everything below copies into the new
  // bundle, and roster.json is written last; a locked file or a full disk
  // half way left a bundle that listed with 0 characters, held the name
  // against a second try, and had no Remove. So a throw takes the folder away
  // again - only this call's: create() refuses a name whose folder is already
  // there, and the folder must be the named, non-Main, Studio-made one it
  // listed.
  const ours = !entry.main && !entry.external && path.resolve(entry.dir) !== path.resolve(L.APP)
    && path.basename(entry.dir).toLowerCase() === String(name).trim().toLowerCase()
    && !before.bundles.some((b) => path.resolve(b.dir).toLowerCase() === path.resolve(entry.dir).toLowerCase());
  try {
    return fillImport(name, inv, { L, bundles, modlib, before, bringsStage, entry });
  } catch (e) {
    if (!ours) throw e;
    let tail;
    try { require('./lifebars.js').rmTree(entry.dir); tail = ' - nothing was kept; the half-made bundle "' + entry.name + '" was removed'; }
    catch (e2) { tail = ' - could not remove ' + entry.dir + ': ' + e2.message; }
    throw new Error(String((e && e.message) || e) + tail, { cause: e });
  }
}

function fillImport(name, inv, { L, bundles, modlib, before, bringsStage, entry }) {
  const dest = entry.dir;
  const phys = (logical) => path.join(dest, L.folderName(logical));
  const wrote = { characters: [], stages: [], music: [], theme: null, common: null, skipped: [] };
  if (inv.unpacked) {
    wrote.unpacked = { exe: inv.unpacked.exe, files: inv.unpacked.files };
    for (const r of inv.unpacked.refused) wrote.skipped.push({ what: r.packed, why: 'a path packed in ' + inv.unpacked.exe + ' refused as unsafe: ' + r.why });
  }

  const roster = JSON.parse(fs.readFileSync(path.join(dest, 'roster.json'), 'utf8'));
  roster.siteTitle = (inv.motif && inv.motif.name) || String(name);

  // The music library and the one case-insensitive listing, both made before
  // the characters: a character's own song is resolved and carried in that
  // loop, and every later sweep shares this placer, so the bundle holds one
  // copy per FILE and every reference quotes the name that copy landed under.
  const musicDir = phys('music');
  fs.mkdirSync(musicDir, { recursive: true });
  const ls = lister();
  const place = trackPlacer(musicDir);

  // ---- characters ---------------------------------------------------------
  // One copy per source folder; a second roster line for the same folder is
  // another entry riding the same files (§3.3f), which is what a build with
  // two defs in one folder already is.
  const charsDir = phys('cache');
  fs.mkdirSync(charsDir, { recursive: true });
  const mountOf = new Map();
  const takenMount = new Set();
  for (const c of inv.chars) {
    const key = c.folder.toLowerCase();
    if (!mountOf.has(key)) {
      let mount = modlib.slugify(c.folder);
      let n = 2;
      while (takenMount.has(mount.toLowerCase())) mount = modlib.slugify(c.folder) + '_' + n++;
      takenMount.add(mount.toLowerCase());
      const to = path.join(charsDir, mount.toLowerCase());
      try {
        fs.cpSync(c.dir, to, { recursive: true });
      } catch (e) {
        wrote.skipped.push({ what: 'chars/' + c.folder, why: e.message });
        mountOf.set(key, null);
        continue;
      }
      mountOf.set(key, mount);
      wrote.characters.push({ folder: mount.toLowerCase(), from: c.folder });
    }
    const mount = mountOf.get(key);
    if (!mount) continue;
    const e = { folder: mount.toLowerCase(), select: mount + '/' + c.def, mountAs: mount };
    if (c.displayName) e.name = c.displayName;
    if (c.exclude) e.exclude = 1;
    if (c.locked) e.locked = '1';
    // Carried on the entry for the cell walk below, then dropped: the roster
    // has no cell field, because a cell is a position over the list.
    e.cell = c.cell;
    if (c.slot) e.slot = 'imported' + c.slot;
    const p = c.params || new Map();
    for (const k of ['order', 'ordersurvival', 'includestage', 'ai', 'hidden', 'next', 'previous']) {
      if (p.has(k)) e[k] = p.get(k);
    }
    // A slot member's own select command is the roster's select_ (`select`
    // is the entry's path field there).
    if (c.slot && p.has('select')) e.select_ = p.get('select');
    // EVERY OTHER PARAM RIDES ALONG, in the entry's passthrough bag - the one
    // charLine writes back generically: unlock=, vsscreen=, victoryscreen=,
    // rounds=, time=, single=, bonus= and whatever a build invents. Dropping
    // them turned a boss that unlocks into one that is always there. Keys the
    // import handles itself stay out, and so do keys that name a FILE in the
    // old build (arcadepath=, ratiopath=, the music prefixes): quoted
    // unchanged they would point at files this bundle does not have, which
    // the engine can stop on. Those are reported instead.
    const HANDLED = new Set(['stage', 'music', 'exclude', 'select', 'order', 'ordersurvival', 'includestage', 'ai',
      'hidden', 'next', 'previous']);
    for (const [k, v] of p) {
      if (HANDLED.has(k) || !/^[a-z0-9_.]+$/.test(k)) continue;
      if (/path$/.test(k) || /^music/.test(k)) {
        wrote.skipped.push({ what: k + '=' + v, why: 'a file in the old build that ' + c.folder + '/' + c.def + ' names; set it again in the Studio' });
        continue;
      }
      if (!e.params) e.params = {};
      e.params[k] = v;
    }
    // A CHARACTER'S OWN SONG IS RESOLVED, NOT QUOTED. select.def spells the
    // track the way the build's disk spells it and the music library spells it
    // the way slugify does, so carrying the param across unchanged wrote a path
    // this bundle does not contain for every name with a space, an apostrophe
    // or a bracket in it - and for a data/ path it named a file the sound/
    // sweep never even looks at. The engine resolves a select.def track with
    // SearchFile over the motif's folder, the root, data/ and sound/
    // (script.go:5449), which is the walk resolveMotifMusic already does.
    if (p.has('music')) {
      const ref = musicParamPath(p.get('music'));
      const hit = ref ? resolveMotifMusic(inv.root, (inv.motif && inv.motif.rel) || '', ref, ls) : null;
      if (hit) {
        e.music = place(hit.abs, path.basename(hit.rel));
        if (!wrote.music.includes(e.music)) wrote.music.push(e.music);
      } else if (ref) {
        wrote.skipped.push({ what: ref, why: 'the song ' + c.folder + '/' + c.def + ' asks for, not in the build' });
      }
    }
    roster.chars.push(e);
  }
  // THE GRID THE AUTHOR DREW, kept. Placeholders are re-emitted in their own
  // cells, so a roster laid out around a screenpack's artwork keeps its shape
  // rather than collapsing into the first N cells. A cell that resolved to
  // nothing becomes a HOLE and not a character: the engine would have drawn it
  // as one anyway (GRAIL 4.12 trap 9), and saying so is the whole point.
  // Members of one `slot = { }` block share a cell, so they are re-emitted
  // consecutively with the block's id on them.
  {
    const placed = [];
    const byCell = new Map();
    for (const e of roster.chars) if (e.cell != null) { if (!byCell.has(e.cell)) byCell.set(e.cell, []); byCell.get(e.cell).push(e); }
    for (const cell of inv.cells) {
      if (cell.kind === 'char') { for (const e of (byCell.get(cell.cell) || [])) placed.push(e); continue; }
      placed.push(Object.assign({ kind: cell.kind === 'random' ? 'random' : 'skip' }, cell.locked ? { locked: '1' } : {}));
    }
    for (const e of roster.chars) if (e.cell == null) placed.push(e);   // exclude = 1 entries
    // Only take the walk when it accounts for every character that was copied:
    // a mismatch means the cell walk and the copy disagree, and a flat list is
    // the safer of the two.
    const kept = placed.filter((x) => !x.kind).length;
    if (kept === roster.chars.length) roster.chars = placed;
    for (const e of roster.chars) delete e.cell;
  }

  // ---- stages -------------------------------------------------------------
  const stagesDir = phys('stages');
  fs.mkdirSync(stagesDir, { recursive: true });
  const stageFileFor = new Map();
  // A STAGE'S FILE IS A FILE. Looked for the way the engine looks - each root
  // in turn, the path as written and then the bare name - and a name that
  // finds only a FOLDER finds nothing: the engine's FileExist takes no folder,
  // so a real build's stage that says "bgmusic = stages/" plays without a song
  // of its own. Copied as a file, that folder stopped the whole import.
  const findFile = (bases, val, name) => {
    let folder = false;
    for (const b of bases) {
      for (const v of [val, name]) {
        const r = resolve(b, v, ls);
        if (r && !isDir(r.abs)) return { hit: r, folder };
        if (r) folder = true;
      }
    }
    return { hit: null, folder };
  };
  const notThere = (folder) => (folder ? ' - a folder, not a file; the engine finds nothing there either' : ', not in the build');
  for (const s of inv.stages) {
    if (!s.found) { wrote.skipped.push({ what: s.ref, why: 'named by the roster, not in the build' }); continue; }
    const base = path.basename(s.rel);
    if (fs.existsSync(path.join(stagesDir, base))) { stageFileFor.set(s.ref.toLowerCase(), base); continue; }
    const text = readText(s.abs);
    if (text === null) { wrote.skipped.push({ what: s.ref, why: 'unreadable' }); continue; }
    const srcDir = path.dirname(s.abs);
    const rewritten = new Map();
    for (const dep of modlib.scanStageDeps(text)) {
      // The engine resolves a stage's files from the def's own folder, then
      // the build root, then data/ - the same roots this copies from.
      const { hit, folder } = findFile([srcDir, inv.root, path.join(inv.root, 'data')], dep.val, dep.name);
      if (!hit) { wrote.skipped.push({ what: dep.val, why: 'named by ' + base + notThere(folder) }); continue; }
      if (/\.(ogg|mp3)$/i.test(dep.name)) {
        // Named as the DISK spells it, not as the def does: a def routinely
        // writes a track in a case the file does not have (§4.13), and the two
        // spellings would land in the library as two tracks on a case-sensitive
        // filesystem and as one confusingly-named one here.
        const v = place(hit.abs, path.basename(hit.rel));
        if (!wrote.music.includes(v)) wrote.music.push(v);
        rewritten.set(dep.val, v);
      } else if (dep.key.startsWith('attachedchar')) {
        // A character the stage attaches (CVS-P's ring-out: VP_Ringout.def and
        // its .zss/.sff/.snd), with every file its own [Files] names, found
        // where the engine looks - beside it, then the build root, then data/ -
        // and placed flat beside the stage, the def rewritten to match.
        const aText = readText(hit.abs) || '';
        const aDir = path.dirname(hit.abs);
        const renamed = new Map();
        for (const f of modlib.attachedCharFiles(aText)) {
          const { hit: fh, folder: fFolder } = findFile([aDir, inv.root, path.join(inv.root, 'data')], f.val, f.name);
          if (!fh) { wrote.skipped.push({ what: f.val, why: 'named by ' + path.basename(hit.rel) + ' (attached to ' + base + ')' + notThere(fFolder) }); continue; }
          const fto = path.basename(fh.rel);
          if (!fs.existsSync(path.join(stagesDir, fto))) fs.copyFileSync(fh.abs, path.join(stagesDir, fto));
          if (fto !== f.val) renamed.set(f.val, fto);
        }
        const to = path.basename(hit.rel);
        if (!fs.existsSync(path.join(stagesDir, to))) {
          fs.writeFileSync(path.join(stagesDir, to), renamed.size ? modlib.rewriteAttachedCharFiles(aText, (v) => renamed.get(v) || null) : fs.readFileSync(hit.abs));
        }
        rewritten.set(dep.val, to);
      } else {
        const to = path.basename(hit.rel);
        if (!fs.existsSync(path.join(stagesDir, to))) fs.copyFileSync(hit.abs, path.join(stagesDir, to));
        rewritten.set(dep.val, to);
        // A .gltf model names its buffers and images by path from its own
        // folder: they go beside the copy at the same relative paths.
        for (const g of require('./vfslib.js').gltfFiles(hit.abs)) {
          const { hit: gh, folder: gFolder } = findFile([path.dirname(hit.abs)], g, null);
          if (!gh) { wrote.skipped.push({ what: g, why: 'named by ' + to + ' (the model of ' + base + ')' + notThere(gFolder) }); continue; }
          const gto = path.join(stagesDir, ...g.split('/'));
          fs.mkdirSync(path.dirname(gto), { recursive: true });
          if (!fs.existsSync(gto)) fs.copyFileSync(gh.abs, gto);
        }
      }
    }
    fs.writeFileSync(path.join(stagesDir, base),
      modlib.rewriteStageDeps(text, (_k, val) => (rewritten.has(val) ? rewritten.get(val) : null)), 'latin1');
    stageFileFor.set(s.ref.toLowerCase(), base);
    const track = rewritten.get((modlib.parseDefSections(text)['bgmusic'] || '').replace(/\\/g, '/').trim()) || '';
    roster.stages.push({ file: base, name: s.name || path.basename(base, '.def'), music: track });
    wrote.stages.push(base);
  }
  // A BUNDLE ALWAYS HAS A STAGE. Either the build brought none and bundles.
  // create already laid the engine's own down, or it promised some and not one
  // of them could be read - and then the seed that was held back goes in after
  // all, because the engine needs somewhere to fight.
  wrote.seededStage = bringsStage ? null : (roster.stages[0] && roster.stages[0].file) || null;
  if (!roster.stages.length) {
    const seeded = bundles.seedStage(dest, L);
    roster.stages.push(seeded);
    wrote.seededStage = seeded.file;
  }
  // A character's own stage pick, once the file it names is installed.
  for (const c of inv.chars) {
    if (!c.stage) continue;
    const file = stageFileFor.get(String(c.stage).replace(/\\/g, '/').toLowerCase());
    if (!file) continue;
    const mount = mountOf.get(c.folder.toLowerCase());
    if (!mount) continue;
    const e = roster.chars.find((x) => x.select === mount + '/' + c.def);
    if (e) e.stage = file;
  }

  // ---- music --------------------------------------------------------------
  for (const m of inv.music) {
    const v = place(m.abs, path.basename(m.rel));
    if (!wrote.music.includes(v)) wrote.music.push(v);
  }

  // ---- the screenpack -----------------------------------------------------
  //
  // Installed by the ONE screenpack installer, so a MUGEN build's motif gets
  // the Survival Guide treatment (§3.6) the same as a pack dropped in by hand:
  // the right motif inside the pack, the hoist, the select repoint, the fonts
  // and storyboards carried. It is handed a STAGED COPY holding the pack-shaped
  // part of the build - data/, font/, sound/ - because the installer copies
  // what it is given and chars/ is gigabytes it has no use for.
  if (inv.motif) {
    const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'mugen-build-theme-'));
    try {
      for (const sib of ['data', 'font', 'sound', 'video']) {
        const hit = resolve(inv.root, sib, ls);
        if (!hit || !isDir(hit.abs)) continue;
        fs.cpSync(hit.abs, path.join(stage, sib), {
          recursive: true,
          // The build's own music is already in the music library and the
          // sound folder of a full install is usually the largest thing in it.
          filter: (src) => !(sib === 'sound' && AUDIO.test(src)),
        });
      }
      // AN IKEMEN GO BUILD keeps its screenpack wherever its config says - r2/
      // beside data/ on the reference one - and has no mugen.cfg for the
      // installer to read the choice from. The motif's top folder is staged
      // beside data/ and a one-line mugen.cfg is written into the STAGED copy
      // (never the source) naming it, so the one installer picks it the way
      // it picks a MUGEN pack's, hoists it and carries what it names.
      if (inv.kind === 'ikemen') {
        const topSeg = inv.motif.rel.split('/')[0];
        if (inv.motif.rel.includes('/') && topSeg.toLowerCase() !== 'data') {
          const hit = resolve(inv.root, topSeg, ls);
          if (hit && isDir(hit.abs) && !fs.existsSync(path.join(stage, hit.rel))) fs.cpSync(hit.abs, path.join(stage, hit.rel), { recursive: true });
        }
        fs.mkdirSync(path.join(stage, 'data'), { recursive: true });
        fs.writeFileSync(path.join(stage, 'data', 'mugen.cfg'), '[Options]\nmotif = ' + inv.motif.rel + '\n', 'latin1');
      }
      // commonStates: false - this import owns [Common] through engineCommon,
      // so the screenpack's own state files are not read as options here.
      // cellsNeeded: the imported roster, for a split pack's slot-count pick.
      // mugenFonts: a MUGEN build's fonts are carried from where MUGEN found
      // them (modlib.carryMotifRefs), not from a font/ beside the motif.
      const t = modlib.addTheme(stage, String(name), { themesDir: phys('themes'), commonStates: false,
        cellsNeeded: modlib.rosterCellsNeeded(roster.chars || []), mugenFonts: inv.kind === 'mugen' });
      roster.motif = t.path;
      wrote.theme = t;
    } catch (e) {
      wrote.skipped.push({ what: inv.motif.rel, why: 'the screenpack would not install: ' + e.message });
    } finally {
      // The checked delete: fs.rmSync returns without deleting under a
      // non-ASCII TEMP (a user named with an accent), and this stage is the
      // build's whole data/ (7.45 GB on the IFC). A miss never fails the import.
      try { require('./lifebars.js').rmTree(stage); } catch (e) { /* litter in TEMP, not a failed import */ }
    }
  }

  // ---- what a character reaches for OUTSIDE its folder --------------------
  //
  // A fullgame's characters lean on the install around them: `st3 =
  // ../../data/main/basicmoves.st` (shared state files kept beside the
  // screenpack), `sprite = ../../chars/ninja/male_ninja.sff` (one generic
  // sprite file that five recolored ninjas share, in a folder no roster line
  // names). The copy above brings the character's own folder and nothing it
  // points at, so those characters would not load - and the first kind broke
  // for a reason that is this import's own: the screenpack folder is carried
  // under the pack's NAME (data/main -> data/Mortal_Kombat_II_Remix), so a
  // line that was right in the source names a folder the build does not have.
  //
  // Each such line is resolved where the engine found it in the source - the
  // def's own folder - and then, in the copy:
  //   inside the motif folder   repointed at the theme's name; the file is
  //                             already there (the whole folder was carried)
  //                             or is copied in beside it
  //   anywhere else             copied INTO the character's folder under its
  //                             last two path segments (ninja/male_ninja.sff)
  //                             and the line rewritten to that. One copy per
  //                             character that names it: plain, and it works
  //                             in every engine.
  //   not in the source at all  left as written and reported
  // Storyboards (intro/ending) are not followed: what they name is theirs.
  {
    const OUT_KEYS = /^(\s*(?:cmd|cns|st\d*|stcommon|anim|sprite|sound|pal\d+)\s*=\s*)([^;\r\n]+?)(\s*(?:;.*)?)$/i;
    const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const themeFolder = wrote.theme && wrote.theme.folder;
    const themeDir = themeFolder ? path.join(phys('themes'), themeFolder) : null;
    // The screenpack's folder as the build has it - data/main, or r2 beside
    // data/ on an Ikemen GO build - is what a reference into it starts with.
    const motifDir = inv.motif && inv.motif.dir;
    const motifRe = motifDir && motifDir !== 'data' ? new RegExp('^' + reEsc(motifDir) + '/(.+)$', 'i') : null;
    wrote.refs = { repointed: 0, carried: [], missing: [] };
    const seen = new Set();
    for (const c of inv.chars) {
      const mount = mountOf.get(String(c.folder).toLowerCase());
      if (!mount || !c.def) continue;
      const tag = mount.toLowerCase() + '|' + String(c.def).toLowerCase();
      if (seen.has(tag)) continue;
      seen.add(tag);
      const charDir = path.join(charsDir, mount.toLowerCase());
      const defRel = String(c.def).replace(/\\/g, '/');
      const defAbs = path.join(charDir, ...defRel.split('/'));
      let text;
      try { text = fs.readFileSync(defAbs, 'latin1'); } catch (e) { continue; }
      const eol = /\r\n/.test(text) ? '\r\n' : '\n';
      const defDir = path.posix.dirname(defRel);
      const up = '../'.repeat(2 + (defDir === '.' ? 0 : defDir.split('/').length));
      let changed = 0;
      const lines = text.split(/\r?\n/).map((line) => {
        const m = OUT_KEYS.exec(line);
        if (!m) return line;
        const val = m[2].replace(/"/g, '').replace(/\\/g, '/').trim();
        if (!val.startsWith('../')) return line;
        const srcAbs = path.resolve(c.dir, defDir === '.' ? val : defDir + '/' + val);
        const relToRoot = path.relative(inv.root, srcAbs).replace(/\\/g, '/');
        const hit = relToRoot.startsWith('..') ? null : resolve(inv.root, relToRoot, ls);
        if (!hit || isDir(hit.abs)) { wrote.refs.missing.push({ char: mount, key: m[1].trim(), ref: val }); return line; }
        const inMotif = motifRe && themeDir && motifRe.exec(hit.rel);
        if (inMotif) {
          const inner = inMotif[1];
          const dst = path.join(themeDir, ...inner.split('/'));
          if (!fs.existsSync(dst)) {
            fs.mkdirSync(path.dirname(dst), { recursive: true });
            fs.copyFileSync(hit.abs, dst);
            wrote.refs.carried.push({ char: mount, from: hit.rel, to: 'data/' + themeFolder + '/' + inner, bytes: sizeOf(hit.abs) });
          }
          changed++;
          return m[1] + up + 'data/' + themeFolder + '/' + inner + m[3];
        }
        const local = hit.rel.split('/').slice(-2).join('/');
        const dst = path.join(charDir, ...(defDir === '.' ? [] : defDir.split('/')), ...local.split('/'));
        if (!fs.existsSync(dst)) {
          fs.mkdirSync(path.dirname(dst), { recursive: true });
          fs.copyFileSync(hit.abs, dst);
          wrote.refs.carried.push({ char: mount, from: hit.rel, to: 'chars/' + mount + '/' + (defDir === '.' ? '' : defDir + '/') + local, bytes: sizeOf(hit.abs) });
        }
        changed++;
        return m[1] + local + m[3];
      });
      if (changed) { fs.writeFileSync(defAbs, lines.join(eol), 'latin1'); wrote.refs.repointed += changed; }
    }
  }

  // ---- mugenhook's animated portraits, as Ikemen's own face keys ---------
  //
  // A MUGEN build can run mugenhook, a DLL that among other things replaces
  // the select screen's still portrait with the character's own animation
  // (cfg/animatedPortraits.dat: an idle action while hovered, a select action
  // once picked, recolored with the pick). The DLL does not come across; the
  // pack's system.def still says `p1.face.spr = 9000,1`, which on this engine
  // is a still of the win pose in the file's own colors. Ikemen has keys for
  // exactly what the hook did - p1.face.anim, p1.face.done.anim,
  // p1.face.applypal - so the .dat is read and the theme told. One action
  // number for everyone: the idle every row can play (0 when any row names
  // it; a character always has action 0) and the select action most rows
  // share. Only when the hook is switched on in mugenhook.ini.
  if (wrote.theme) try {
    const ini = resolve(inv.root, 'mugenhook.ini', ls), dat = resolve(inv.root, 'cfg/animatedPortraits.dat', ls);
    const iniText = ini ? readText(ini.abs) : '';
    const on = /^\s*bHookAnimatedPortraits\s*=\s*true/im.test(iniText);
    if (on && dat) {
      const mode = /^\s*iAnimatedPortraitsOperationType\s*=\s*1/im.test(iniText) ? 1 : 0;
      const rows = readText(dat.abs).split(/\r?\n/).map((l) => l.replace(/;.*$/, '').trim()).filter(Boolean).map((l) => l.split(/\s+/).map((x) => parseInt(x, 10)));
      // mode 0: row col idle idleP2 select selectP2 file ; mode 1: id idle idleP2 select selectP2 file
      const idle = rows.map((r) => r[mode ? 1 : 2]).filter(Number.isFinite), done = rows.map((r) => r[mode ? 3 : 4]).filter(Number.isFinite);
      const common = (xs) => { const c = new Map(); for (const x of xs) c.set(x, (c.get(x) || 0) + 1); return [...c].sort((a, b) => b[1] - a[1])[0]; };
      if (idle.length && done.length) {
        const idleAnim = idle.includes(0) ? 0 : common(idle)[0], doneAnim = common(done)[0];
        const sysDef = path.join(phys('themes'), wrote.theme.folder, 'system.def');
        let text = readText(sysDef);
        const eol = /\r\n/.test(text) ? '\r\n' : '\n';
        const lines = text.split(/\r?\n/);
        let s = lines.findIndex((l) => /^\s*\[Select Info\]/i.test(l));
        if (s >= 0) {
          let e = s + 1;
          while (e < lines.length && !/^\s*\[/.test(lines[e])) e++;
          const set = (key, value) => {
            const re = new RegExp('^(\\s*' + key.replace(/\./g, '\\.') + '\\s*=\\s*)[^;\\r\\n]*?(\\s*(?:;.*)?)$', 'i');   // the value, then the author's own comment with its space
            for (let k = s + 1; k < e; k++) { const m = re.exec(lines[k]); if (m) { lines[k] = m[1] + value + m[2]; return; } }
            lines.splice(e, 0, key + ' = ' + value); e++;
          };
          for (const p of ['p1', 'p2']) { set(p + '.face.anim', String(idleAnim)); set(p + '.face.done.anim', String(doneAnim)); set(p + '.face.applypal', '1'); }
          fs.writeFileSync(sysDef, lines.join(eol), 'latin1');
          wrote.faces = { from: 'mugenhook', anim: idleAnim, done: doneAnim, rows: rows.length };
        }
      }
    }
  } catch (e) { wrote.skipped.push({ what: 'cfg/animatedPortraits.dat', why: 'the animated portraits were not carried: ' + e.message }); }

  // ---- mugenhook's select-screen announcer --------------------------------
  //
  // The hook's cursor table (cfg/soundAnn.dat, `bHookCursorTable = true`)
  // plays a clip from the screenpack's system.snd when a cursor lands on a
  // cell, in place of the move sound. The table becomes
  // roster.selectAnnouncer, one row per cell that holds a character, and both
  // exports ship it as external/mods/mugen-studio/select-announcer.lua (selectann.js).
  // Each clip is looked up in the screenpack's sound file; a missing one is
  // reported, not dropped (the hook would play nothing there too).
  if (wrote.theme) try {
    const sa = require('./selectann.js');
    const ini = resolve(inv.root, 'mugenhook.ini', ls), dat = resolve(inv.root, 'cfg/soundAnn.dat', ls);
    const sw = sa.hookSwitches(ini ? readText(ini.abs) : '');
    if (sw.on && dat && sw.mode > 1) {
      wrote.skipped.push({ what: 'cfg/soundAnn.dat', why: 'mugenhook reads it in mode ' + sw.mode + ' (each character\'s own sound), which is not carried' });
    } else if (sw.on && dat) {
      const themeDir = path.join(phys('themes'), wrote.theme.folder);
      const sysText = readText(path.join(themeDir, 'system.def')) || '';
      const t = sa.toCells(sa.parseSoundAnn(readText(dat.abs), sw.mode), sw.mode, inv.cells, sa.selectColumns(sysText));
      if (t.cells.length) {
        const sndRef = sa.motifSnd(sysText);
        let keys = null;
        if (sndRef) {
          const want = sndRef.replace(/\\/g, '/').split('/').pop().toLowerCase();
          const hit = (fs.readdirSync(themeDir).find((n) => n.toLowerCase() === want));
          if (hit) keys = modlib.sndKeySet(path.join(themeDir, hit));
        }
        const missing = [];
        if (keys) for (const c of t.cells) for (const k of [c[2] + ',' + c[3], c[4] + ',' + c[5]]) if (!keys.has(k) && !missing.includes(k)) missing.push(k);
        roster.selectAnnouncer = { from: 'mugenhook cfg/soundAnn.dat', cells: t.cells };
        wrote.selectAnnouncer = { mode: sw.mode, cells: t.cells.length, dropped: t.dropped, checked: !!keys, missing };
        if (missing.length) wrote.skipped.push({ what: 'cfg/soundAnn.dat', why: 'clips not in the screenpack\'s sound file: ' + missing.join(' ') });
      }
    }
  } catch (e) { wrote.skipped.push({ what: 'cfg/soundAnn.dat', why: 'the select-screen announcer was not carried: ' + e.message }); }

  // ---- a team menu the build can see -------------------------------------
  //
  // A pack with no team modes on its title menu blanks the team menu: item
  // fonts -1, empty titles, a cursor pointing at an animation it never
  // defines (MK2 Remix). On MUGEN nobody reaches it. On this build Training
  // does - the training-team mod turns Simul on for the dummy side, and with
  // two choices the engine shows the menu for both players - so the player
  // stands at an invisible menu pressing buttons blind, twice. The engine's
  // own team menu is brought over whole, scaled to the pack (teammenu.js):
  // its keys, its font, its cursor animations, its count icons. The pack's
  // sounds for the menu stay its own. A pack whose menu is visible is left
  // exactly as it is.
  if (wrote.theme) try {
    const stockDir = path.join(L.dir('release-v2'), 'data');
    const stock = { def: path.join(stockDir, 'ikemen1', 'system.def'), dir: stockDir, sff: path.join(stockDir, 'ikemen1', 'system.sff') };
    if (fs.existsSync(stock.def)) {
      const r = require('./teammenu.js').bring(path.join(phys('themes'), wrote.theme.folder), stock);
      if (r) wrote.teamMenu = { from: 'the engine\'s own screenpack', scale: +r.k.toFixed(4), fonts: r.fonts, actions: r.actions, sprites: r.sprites, skipped: r.skipped };
    }
  } catch (e) { wrote.skipped.push({ what: 'the team menu', why: 'could not be brought over: ' + e.message }); }

  // ---- the screenpack's own music -----------------------------------------
  //
  // Every track the motif's [Music] section names, carried into the music
  // library from wherever the engine would have found it, and then:
  //
  //   * title.bgm and select.bgm become roster.titleMusic / roster.selectMusic,
  //     which is the pair the Studio has a setting for and the pair both
  //     exports rewrite the motif from (vfslib.js);
  //   * every other prefix - vs, victory, whatever a pack invents - has no
  //     setting to become, so the theme's OWN line is repointed at the carried
  //     file instead. The pack keeps its choice, the report says the Studio
  //     cannot change it, and nothing is dropped silently.
  //
  // The theme's title/select lines are repointed as well, so clearing the
  // setting later gives the pack's own track back rather than silence.
  wrote.menuMusic = { set: [], noSetting: [], missing: [], tracks: [] };
  // INSIDE A TRY, the same way the screenpack install above is. Everything in
  // here is driven by a third-party pack's own [Music] keys and values, and by
  // this point the bundle exists and holds the characters, the stages and the
  // library - so a pack this block cannot handle must cost the menu music and
  // nothing else. Losing the import here left a bundle on disk whose
  // roster.json was still the empty one bundles.create wrote.
  if (inv.menuMusic && inv.menuMusic.length) try {
    const themeDir = wrote.theme ? path.join(phys('themes'), wrote.theme.folder) : null;
    const sysPath = themeDir ? path.join(themeDir, 'system.def') : null;
    let sysText = sysPath ? readText(sysPath) : null;
    for (const e of inv.menuMusic) {
      const got = [];
      for (const t of e.tracks) {
        if (!t.found) { wrote.menuMusic.missing.push({ key: e.key, ref: t.ref }); continue; }
        const v = place(t.abs, path.basename(t.rel));
        if (!wrote.music.includes(v)) wrote.music.push(v);
        got.push(v);
      }
      if (!got.length) continue;
      wrote.menuMusic.tracks.push({ key: e.key, tracks: got.slice() });
      if (e.field) {
        roster[e.field] = got[0];
        wrote.menuMusic.set.push({ key: e.key, field: e.field, track: got[0], extra: got.length - 1 });
      } else {
        wrote.menuMusic.noSetting.push({ key: e.key, tracks: got.slice() });
      }
      if (sysText !== null) sysText = setMotifBgm(sysText, e.key, got.join(', '));
    }
    if (sysText !== null) {
      fs.writeFileSync(sysPath, sysText, 'latin1');
      // THE SECOND COPY OF THE SAME SONG. The screenpack installer carries any
      // file the motif names from outside the folder it hoists
      // (modlib.carryMotifRefs), and an .mp3 named by title.bgm is one of
      // those - so data/menu.mp3 landed in the theme as well as in the music
      // library, and on the reference build that is 3.2 MB of song shipped
      // twice. The lines above no longer point at those copies, so they are
      // download and nothing else.
      //
      // Only ever a path the installer itself reports carrying, and only once
      // NOTHING in the theme still names it - checked against every .def in
      // there and by whole value, not by substring, because a line repointed to
      // "sound/versus.mp3" still has "versus.mp3" inside it.
      const carried = (wrote.theme && wrote.theme.carried) || [];
      for (const e of inv.menuMusic) {
        for (const t of e.tracks) {
          if (!t.found || !carried.includes(t.ref) || namedByTheme(themeDir, t.ref)) continue;
          const at = path.join(themeDir, t.ref);
          try { fs.unlinkSync(at); } catch (err) { continue; }
          try { fs.rmdirSync(path.dirname(at)); } catch (err) { /* not empty: kept */ }
        }
      }
    }
  } catch (e) {
    wrote.skipped.push({
      what: (inv.motif && inv.motif.rel) || 'the screenpack',
      why: 'its menu music could not be carried: ' + e.message,
    });
  }

  // ---- the build's own common states --------------------------------------
  if (inv.common) {
    const to = buildStatesPathIn(phys('engine'));
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(inv.common.abs, to);
    wrote.common = { file: path.relative(dest, to).replace(/\\/g, '/'), listed: inv.common.listable };
    // The config line is decided by the file AND by whether it compiles; the
    // exports read both back from here, so the two can never disagree. A file
    // that would not compile is carried and simply never listed - listing one
    // fails EVERY character in the build.
    if (inv.common.listable) roster.commonStates = { file: BUILD_STATES_FILE, vpath: BUILD_STATES_VPATH, key: BUILD_STATES_KEY };
  }
  // ---- an Ikemen GO build's own common files, in place of the engine's -----
  //
  // In the build they replaced the engine's whole lists: the author's
  // versions of the engine's state files and extras on top (its own tag
  // system, a clash system, an input display), its own common animations,
  // and effects packs beside the engine's. They do the same here. Every
  // listed file that is the build's own is carried into the bundle's engine
  // folder, and the config's base keys are written with the build's lists,
  // engine paths for the entries that are the engine's own files and
  // data/build/ paths for the rest - so the build's systems run as its author
  // wrote them, on both exports (buildCommon hands the files and the lines to
  // vfslib and desktop together, so they can never disagree).
  //
  // Its constants ride the Studio's own mechanism instead: the keys its
  // common.const sets differently from the engine's become this build's
  // overrides (engineconst.js, Const1), where the Engine tab shows them.
  //
  // What is NOT checked: a ZSS file cannot be checked against the compiler
  // the way the CNS reader checks a common1.cns, and a listed file that does
  // not compile fails every character - the report says so, and a match is
  // the check.
  const fontRules = {};
  if (inv.commonFiles) {
    const cf = inv.commonFiles;
    const dir = path.join(phys('engine'), BUILD_COMMON_DIR);
    const carried = [], missing = [], taken = new Set();
    const carry = (f) => {
      if (!f.found) { missing.push(f.ref); return null; }
      let name = path.basename(f.rel);
      if (taken.has(name.toLowerCase())) name = f.rel.replace(/\//g, '_');
      taken.add(name.toLowerCase());
      fs.mkdirSync(dir, { recursive: true });
      fs.copyFileSync(f.abs, path.join(dir, name));
      carried.push(name);
      return name;
    };
    const vpathOf = (f) => {
      if (f.stock) return f.found ? f.rel : f.ref.replace(/\\/g, '/');
      if (!f.found) { missing.push(f.ref); return null; }
      const name = carry(f);
      return name ? BUILD_COMMON_VDIR + '/' + name : null;
    };
    const lines = {};
    for (const [key, list] of [['States', cf.states], ['Air', cf.air], ['Cmd', cf.cmd], ['Fx', cf.fx]]) {
      if (!list.length) continue;
      const v = list.map(vpathOf).filter(Boolean);
      if (v.length) lines[key] = v.join(', ');
    }
    // An effects pack's def names its sprite, animation and sound files
    // beside it, so they come along and land beside the def.
    for (const f of cf.fx) {
      if (!f.found || f.stock) continue;
      const text = readText(f.abs) || '';
      for (const m of text.matchAll(/^\s*(?:sff|air|snd)\s*=\s*([^;\r\n]+)/gim)) {
        const rel = m[1].trim().replace(/\\/g, '/');
        const hit = resolve(path.dirname(f.abs), rel, ls);
        if (hit && !isDir(hit.abs)) carry({ found: true, ref: rel, rel: relToBuild(inv.root, hit.abs), abs: hit.abs });
      }
    }
    let consts = 0;
    if (cf.const && cf.const.found && !cf.const.stock) {
      const engineconst = require('./engineconst.js');
      const engineData = engineDataDir(L);
      const own = engineconst.readConsts(readText(cf.const.abs) || '');
      const stock = engineconst.readConsts((engineData && readText(path.join(engineData, 'common.const'))) || '');
      const changed = [];
      for (const [k, v] of own.keys) {
        const s = stock.keys.get(k);
        if (!s || engineconst.atof(s.raw) !== engineconst.atof(v.raw)) changed.push(v.name + ' = ' + v.raw);
      }
      if (changed.length) {
        const p = path.join(phys('engine'), engineconst.BUILD_CONST_FILE);
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, '; The constants this build changes, from the Ikemen GO build it was imported from.\r\n[Constants]\r\n' + changed.join('\r\n') + '\r\n', 'latin1');
        consts = changed.length;
      }
    }
    // Its readout font (the debug font its state code draws text with): the
    // def and the sprite file it names, carried beside the rest; the desktop
    // export reads it as a setting, the website build as a file it can draw
    // only when the font is a bitmap one.
    let debugFont = null;
    const f = cf.font;
    if (f && f.found && !f.stock) {
      const name = carry(f);
      if (f.sff) carry({ found: true, ref: f.sff.rel, rel: f.sff.rel, abs: f.sff.abs });
      if (name) {
        debugFont = { file: name, scale: f.scale || null, bitmap: !!f.bitmap };
        fontRules['Debug.Font'] = BUILD_COMMON_VDIR + '/' + name;
        if (f.scale !== null && f.scale !== undefined && String(f.scale).trim() !== '' && isFinite(Number(f.scale))) fontRules['Debug.FontScale'] = String(Number(f.scale));
      }
    } else if (f && f.stock) {
      fontRules['Debug.Font'] = f.found ? f.rel : f.ref.replace(/\\/g, '/');
      if (f.scale !== null && f.scale !== undefined && isFinite(Number(f.scale))) fontRules['Debug.FontScale'] = String(Number(f.scale));
    }
    if (Object.keys(lines).length || carried.length) roster.engineCommon = { dir: BUILD_COMMON_DIR, files: carried, lines, debugFont };
    wrote.commonFiles = { carried: carried.map((n) => 'engine/' + BUILD_COMMON_DIR + '/' + n), missing, listed: Object.keys(lines).length > 0, lines, consts, debugFont };
  }

  // ---- the ladder ---------------------------------------------------------
  if (inv.maxMatches && inv.maxMatches.arcade.some((x) => x)) {
    roster.maxMatches = { arcade: inv.maxMatches.arcade, team: inv.maxMatches.team };
  }
  // ---- the build's rules ----------------------------------------------------
  const rules = Object.assign(rulesFromCfg(inv.cfg), fontRules, fightShapeRule(inv.cfg));
  if (Object.keys(rules).length) {
    roster.settings = Object.assign({}, roster.settings || {}, rules);
    wrote.rules = rules;
  }

  roster.publicChars = [];
  roster.publicStages = roster.stages.map((s) => s.file);
  // an imported build asks before any H side shows (hmodule.js)
  roster.hModule = 'unasked';
  fs.writeFileSync(path.join(dest, 'roster.json'), JSON.stringify(roster, null, 2) + '\n');

  return {
    bundle: entry.name, dir: dest, wrote,
    // The switch is the person's to make, and it applies on restart.
    switched: false,
    was: before.active,
    report: report(inv),
  };
}

// ADD004'S ROUND CALL, on MUGEN's clock.
//
// add004 draws its own "ROUND 1 ... FIGHT!!!" call: a helper spawned at
// roundstate=2 that counts while roundstate=2 and calls FIGHT 101 ticks in. In
// MUGEN, RoundState 2 begins when the Fight screen appears and control comes
// ctrl.time ticks later (120 in the builds that carry it), so the call ends
// before anyone can move. This engine starts RoundState 2 only when control is
// handed out, so the call started at the same moment as control and the
// fighters were trading hits under it.
//
// The ticks MUGEN counts as RoundState 2 before control are this engine's
// IntroState 4 ("Fight called"). Only the call's own two tests move there - the
// trigger that spawns the helper and every roundstate=2 inside the helper's
// state - so control is still the engine's to give, and everything else add004
// keys on RoundState 2 (partners leaving for standby, tag commands, team order)
// runs when it always did. An earlier version moved EVERY RoundState test and
// broke that: partners went to standby before control and the engine's own
// reset at control sent them back to state 0, so they ran off twice.
//
//   roundstate=2   ->   (roundstate=2||introstate=4)
//
// IntroState exists in every Ikemen GO 1.0 release, so the same text runs on
// the browser engine and on the official desktop engine. The bundle's file
// stays byte-identical to the build's; this is applied as it ships.
const ROUND_CALL_TEST = /\broundstate\s*=\s*2(?![\d.])(?!\s*\|\|\s*introstate\s*=\s*4)/gi;

function add004RoundCall(text) {
  const src = Buffer.isBuffer(text) ? text.toString('latin1') : String(text || '');
  const lines = src.split(/(?<=\n)/);
  const code = (l) => l.replace(/\r?\n$/, '').split(';')[0];
  const isHeader = (l) => /^\s*\[\s*state/i.test(code(l));
  const statedefNo = (l) => { const m = /^\s*\[\s*statedef\s+(-?\d+)\s*\]/i.exec(code(l)); return m ? Number(m[1]) : null; };
  // controller and statedef blocks as [start, end) line ranges
  const blocks = [];
  for (let i = 0; i < lines.length; i++) {
    if (!isHeader(lines[i])) continue;
    if (blocks.length) blocks[blocks.length - 1].end = i;
    blocks.push({ start: i, end: lines.length, def: statedefNo(lines[i]) });
  }
  const param = (b, name) => {
    for (let i = b.start + 1; i < b.end; i++) {
      const m = new RegExp('^\\s*' + name + '\\s*=\\s*(.*?)\\s*$', 'i').exec(code(lines[i]));
      if (m) return m[1];
    }
    return null;
  };
  // the helper controller that spawns the call: add004 gives it id 180000 and
  // labels it sys::helper::round_call
  const spawns = blocks.filter((b) => b.def === null && /^helper$/i.test(param(b, 'type') || '') && (
    param(b, 'id') === '180000' ||
    lines.slice(Math.max(0, b.start - 3), b.start).some((l) => /sys::helper::round_call/i.test(l))));
  let count = 0;
  const rewrite = (from, to) => {
    for (let i = from; i < to; i++) {
      const l = lines[i];
      if (!/^\s*trigger/i.test(l)) continue;
      const eol = (/\r?\n$/.exec(l) || [''])[0];
      const body = l.slice(0, l.length - eol.length);
      const cut = body.indexOf(';');
      const head = cut < 0 ? body : body.slice(0, cut);
      const next = head.replace(ROUND_CALL_TEST, () => { count++; return '(roundstate=2||introstate=4)'; });
      if (next !== head) lines[i] = next + (cut < 0 ? '' : body.slice(cut)) + eol;
    }
  };
  const states = new Set();
  for (const b of spawns) {
    rewrite(b.start + 1, b.end);
    const no = Number(param(b, 'stateno'));
    if (Number.isInteger(no)) states.add(no);
  }
  for (let k = 0; k < blocks.length; k++) {
    if (blocks[k].def === null || !states.has(blocks[k].def)) continue;
    let end = blocks.length;
    for (let j = k + 1; j < blocks.length; j++) if (blocks[j].def !== null) { end = j; break; }
    rewrite(blocks[k].start + 1, end < blocks.length ? blocks[end].start : lines.length);
  }
  return { text: lines.join(''), count, spawns: spawns.length };
}

// A BLEND WRITTEN ONE FIELD LATE (2026-09-20). An animation frame is
// `group, index, x, y, time, flip, blend`. The rain layer of the CvS pack's
// CVS_Rain_HR writes its twenty frames with one comma too many -
// `50,0, 0,0, 1,, ,A` against the `28,0,0,0,4,, A` every other layer in the
// same file uses - so the blend lands in an eighth field that nothing reads.
// This engine takes the seventh field, finds it empty and draws the layer
// OPAQUE: hard gray streaks over the whole stage. MUGEN evidently rejects the
// frames outright and draws no rain at all, which is why the stage has always
// looked rainless in the build it came from and the author never saw the `A`
// take effect.
//
// So the line is repaired as the stage ships, in our copy only: the empty
// fields between the flip flags and the blend are dropped, putting the blend
// where both engines read it. Nothing else about the frame changes, and a
// frame that is already well formed is left exactly as it is. Only a stage's
// own .def is touched - a character's .air is its author's.
const AIR_BLEND = /^(a1|a|s|sa|as\d+d\d+|as\d+|sas\d+d\d+|sas\d+)$/i;

function stageAirBlend(text) {
  const src = Buffer.isBuffer(text) ? text.toString('latin1') : String(text || '');
  let count = 0;
  const out = src.split(/(\r?\n)/).map((piece) => {
    if (/^\r?\n$/.test(piece)) return piece;
    const cut = piece.indexOf(';');
    const code = cut < 0 ? piece : piece.slice(0, cut);
    const rest = cut < 0 ? '' : piece.slice(cut);
    // an animation frame: starts with a number, at least five fields
    if (!/^\s*-?\d/.test(code)) return piece;
    const f = code.split(',');
    if (f.length <= 7) return piece;
    // the flip field and everything after it up to the blend must be empty,
    // and exactly one field past it may carry the blend
    if (f[6].trim() !== '') return piece;
    const tail = f.slice(7);
    const filled = tail.filter((x) => x.trim() !== '');
    if (filled.length !== 1 || !AIR_BLEND.test(filled[0].trim())) return piece;
    count++;
    return f.slice(0, 6).concat(filled[0]).join(',') + rest;
  }).join('');
  return { text: out, count };
}

// THE OTHER COPY OF THE ROUND CALL. A character's `stcommon = common1.cns` is
// looked up in its own folder, the build root, the MOTIF's folder and data/,
// in that order (compiler.go:8362), and the stcommon file is compiled before
// any [Common] States file, so its numbered states win. An imported build's
// screenpack is its whole data/ folder, which still holds the build's own
// common1.cns - so for every character that asks for common1.cns, add004's
// round call is the one in the screenpack folder, not the one in
// data/build.cns. Both copies get the same change as they ship, or the fix
// reaches only the characters with some other stcommon.
//
// Returns { vpath: Buffer } for each .cns under the motif's folder that carries
// the call; both exports lay these over the files they pack.
function add004RoundCallThemeFiles(themeDir, vprefix) {
  const out = {};
  const walk = (dir, rel) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      const r = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) { walk(abs, r); continue; }
      if (!/\.cns$/i.test(e.name) || sizeOf(abs) > 8 * 1024 * 1024) continue;
      const raw = readText(abs);
      if (raw === null || raw.indexOf('180000') < 0 && !/sys::helper::round_call/i.test(raw)) continue;
      const call = add004RoundCall(raw);
      if (call.count) out[vprefix + r] = Buffer.from(call.text, 'latin1');
    }
  };
  if (themeDir && isDir(themeDir)) walk(themeDir, '');
  return out;
}

// WHAT A BUILD LISTS IN [Common] States, read back out of a bundle. The
// exports ask for this; it is a getter so a bundle that never imported a build
// answers null and generates exactly the config it always did. Both exports
// ship the text this returns, so add004's round call (above) is timed the same
// on the website and in the desktop build.
function buildStates(L) {
  L = L || layout;
  const p = buildStatesPath(L);
  let raw = null;
  try { raw = fs.readFileSync(p); } catch (e) { return null; }
  let roster = null;
  try { roster = JSON.parse(fs.readFileSync(path.join(L.CONTENT, 'roster.json'), 'utf8')); } catch (e) { roster = null; }
  if (!roster || !roster.commonStates) return null;
  const call = add004RoundCall(raw);
  let text = call.count ? Buffer.from(call.text, 'latin1') : raw;
  // A lifebar from the bundle's library replaces add004's own HUD: switched
  // off in this shipped copy too, the same as in the screenpack folder's copy
  // (lifebars.add004ThemeFiles), because characters may run either.
  let hudOff = [];
  try {
    const lbs = require('./lifebars.js');
    if (lbs.add004Off(roster)) {
      const sw = lbs.add004Switches(text.toString('latin1'));
      if (sw.changed.length || sw.flags.length) { text = Buffer.from(sw.text, 'latin1'); hudOff = sw.changed; }
    }
  } catch (e) { hudOff = []; }
  return { path: p, text, vpath: BUILD_STATES_VPATH, key: BUILD_STATES_KEY, roundCallRewrites: call.count, hudOff };
}

// The engine's own data folder, for telling a build's copy of an engine file
// from the engine's: the checkout the browser engine was built from, which is
// upstream 1.0.0 plus the carry list, none of which touches these files.
function engineDataDir(L) {
  try { const d = path.join((L || layout).dir('ikemen-go-src'), 'data'); return isDir(d) ? d : null; } catch (e) { return null; }
}

// AN IKEMEN GO BUILD'S OWN [Common] FILES, for both exports: the files to put
// in the build under data/build/, and the config lines that list them in
// place of the engine's own. A line names only files that are there - a
// listed file that is missing fails every character - so a file gone from the
// bundle's engine folder drops off its line rather than taking the build
// down. Null when this bundle has none.
function buildCommon(L) {
  L = L || layout;
  let roster = null;
  try { roster = JSON.parse(fs.readFileSync(path.join(L.CONTENT, 'roster.json'), 'utf8')); } catch (e) { return null; }
  const ec = roster && roster.engineCommon;
  if (!ec || ((!ec.lines || !Object.keys(ec.lines).length) && !(ec.files || []).length)) return null;
  const dir = path.join(L.dir('engine'), ec.dir || BUILD_COMMON_DIR);
  const files = [];
  const have = new Set();
  for (const name of ec.files || []) {
    const p = path.join(dir, name);
    let text;
    try { text = fs.readFileSync(p); } catch (e) { continue; }
    files.push({ name, path: p, vpath: BUILD_COMMON_VDIR + '/' + name, text });
    have.add(name.toLowerCase());
  }
  const re = new RegExp('^' + BUILD_COMMON_VDIR.replace(/\//g, '\\/') + '/(.+)$', 'i');
  const lines = [];
  let check = null;
  for (const [key, value] of Object.entries(ec.lines || {})) {
    let kept = String(value).split(',').map((s) => s.trim()).filter((v) => { const m = re.exec(v); return !m || have.has(m[1].toLowerCase()); });
    // The build's own state files, checked for THIS engine (checkOwnStates):
    // one that would not compile gives way to the engine's file for its part.
    if (key.toLowerCase() === 'states') {
      const fileOf = (v) => { const m = re.exec(v); return m ? files.find((f) => f.name.toLowerCase() === m[1].toLowerCase()) : null; };
      try {
        check = checkOwnStates(kept, (v) => { const f = fileOf(v); return f ? f.text.toString('latin1') : null; });
      } catch (e) { check = null; }
      if (check) {
        kept = check.entries;
        for (const [v, text] of Object.entries(check.texts)) { const f = fileOf(v); if (f) f.text = Buffer.from(text, 'latin1'); }
      }
    }
    if (kept.length) lines.push({ key, value: kept.join(', ') });
  }
  // A refused file is listed nowhere now, so it is not shipped either.
  if (check && check.refused.length) {
    const listed = new Set(lines.flatMap((l) => l.value.split(',').map((s) => s.trim().toLowerCase())));
    for (let i = files.length - 1; i >= 0; i--) {
      if (check.refused.some((r) => r.entry.toLowerCase() === files[i].vpath.toLowerCase()) && !listed.has(files[i].vpath.toLowerCase())) files.splice(i, 1);
    }
  }
  // The readout font, only while its file is there.
  const df = ec.debugFont && ec.debugFont.file && have.has(String(ec.debugFont.file).toLowerCase())
    ? { vpath: BUILD_COMMON_VDIR + '/' + ec.debugFont.file, scale: ec.debugFont.scale || null, bitmap: !!ec.debugFont.bitmap } : null;
  return lines.length || files.length ? {
    dir, files, lines, debugFont: df,
    refused: check ? check.refused : [], rewrites: check ? check.rewrites : [], report: check ? check.report : [],
  } : null;
}

// A BUILD'S OWN STATE FILES, ON THIS ENGINE. An Ikemen GO build's own copies
// of the engine's state files were written for the engine inside that build,
// and the one both exports run can refuse a construct they use - a listed
// file that does not compile stops every character loading. So each ZSS file
// is put through the screenpack gate (zsslint.js; zsscompat.js first, which
// updates only forms whose new spelling means exactly the same): a refused
// file gives way to the ENGINE's file for its part (by name, else by the
// statedefs it shares with one, themeopts.roleOf), or leaves the list when
// the engine has none or already lists it. The engine's file for that part
// may call the engine's own functions, which a build that renamed them does
// not define: then the engine's functions file goes on the list before it
// (a call to a function nothing defines does nothing, with a console warning
// every frame). Re-run on every export, so a bundle imported before this
// check is covered without a new import.
//   entries: the States list; readOwn(entry) -> the build's text, or null for
//   an engine path. -> { entries, texts: {entry: rewritten}, refused, rewrites, report }
function checkOwnStates(entries, readOwn) {
  const lint = require('./zsslint.js');
  const compat = require('./zsscompat.js');
  const themeopts = require('./themeopts.js');
  const tables = lint.tables();
  let roles = null;
  const rolesOf = () => roles || (roles = themeopts.engineRoles());
  const out = { entries: [], texts: {}, refused: [], rewrites: [], report: [] };
  const textOf = new Map();
  const slots = [];
  for (const e of entries) {
    const own = readOwn(e);
    if (own === null || !/\.zss$/i.test(e)) { slots.push(e); if (own !== null) textOf.set(e.toLowerCase(), own); continue; }
    const rw = compat.rewrite(own, 'zss');
    for (const w of rw.rewrites) out.rewrites.push({ entry: e, line: w.line, before: w.before, after: w.after });
    if (rw.rewrites.length) out.texts[e] = rw.text;
    const v = lint.lint(rw.text, 'zss', tables);
    if (v.ok) { slots.push(e); textOf.set(e.toLowerCase(), rw.text); continue; }
    const role = themeopts.roleOf(e, rw.text, rolesOf());
    const r = { entry: e, line: v.line == null ? null : v.line, why: v.why, name: v.name || null, standIn: null, functions: null, already: false };
    out.refused.push(r);
    slots.push({ r, role });
  }
  const lower = (x) => String(x).toLowerCase();
  const onList = (rel) => slots.some((s) => typeof s === 'string' ? lower(s) === lower(rel) : s.r.standIn && lower(s.r.standIn) === lower(rel));
  for (const s of slots) {
    if (typeof s === 'string' || !s.role) continue;
    if (onList(s.role.engine)) { s.r.already = true; continue; }
    s.r.standIn = s.role.engine;
  }
  // The functions every file on the list defines, and what a stand-in calls.
  const engineText = (rel) => { const x = rolesOf().find((ro) => lower(ro.engine) === lower(rel)); return x && x.bytes ? x.bytes.toString('latin1') : ''; };
  const defs = (text) => new Set([...lint.codeLines(text, 'zss').join('\n').matchAll(/^\s*\[\s*function\s+([A-Za-z_]\w*)/gim)].map((m) => m[1].toLowerCase()));
  const calls = (text) => new Set([...lint.codeLines(text, 'zss').join('\n').matchAll(/\bcall\s+([A-Za-z_]\w*)\s*\(/gi)].map((m) => m[1].toLowerCase()));
  const listText = (s) => (typeof s === 'string' ? (textOf.get(lower(s)) !== undefined ? textOf.get(lower(s)) : engineText(s)) : (s.r.standIn ? engineText(s.r.standIn) : ''));
  const fnRole = rolesOf().find((ro) => ro.role === 'functions');
  let fnAdded = false;
  for (const s of slots) {
    if (typeof s !== 'string' && s.r.standIn) {
      const defined = new Set();
      for (const t of slots) for (const d of defs(listText(t))) defined.add(d);
      const missing = [...calls(listText(s))].filter((c) => !defined.has(c));
      if (missing.length && fnRole && fnRole.bytes && !fnAdded && !onList(fnRole.engine)) {
        const offer = defs(fnRole.bytes.toString('latin1'));
        if (missing.some((c) => offer.has(c))) { s.r.functions = fnRole.engine; fnAdded = true; }
      }
    }
    if (typeof s === 'string') out.entries.push(s);
    else {
      if (s.r.functions) out.entries.push(s.r.functions);
      if (s.r.standIn) out.entries.push(s.r.standIn);
    }
  }
  const WHY = lint.WHY_TEXT;
  for (const r of out.refused) {
    const named = r.name && (r.why === 'trigger' || r.why === 'controller') ? ' (' + r.name + ')' : '';
    out.report.push(r.entry + (r.line ? ' (line ' + r.line + ')' : '') + ' is not used: ' + (WHY[r.why] || r.why) + named + '. '
      + (r.standIn ? 'The engine’s ' + r.standIn + ' stands in for it'
        + (r.functions ? ', with the engine’s ' + r.functions + ' listed before it for the functions it calls' : '')
        : r.already ? 'The engine’s file for its part is already on the list'
          : 'No engine file plays its part, so it is left off the list'));
  }
  return out;
}

module.exports = {
  inspect, report, run, buildStates, buildStatesPath, buildCommon, checkOwnStates, engineDataDir, wholeBuildAt,
  BUILD_COMMON_DIR, BUILD_COMMON_VDIR,
  // pure, for the tests and for anything that wants the rules without the disk
  parseSelect, readCommonStates, cnsStates, readIni, resolveCharEntry, resolve, lister, rulesFromCfg, fightShapeRule, add004RoundCall, add004RoundCallThemeFiles, stageAirBlend,
  motifMusicKeys, resolveMotifMusic, setMotifBgm, menuMusicReport,
  BUILD_STATES_FILE, BUILD_STATES_VPATH, BUILD_STATES_KEY,
};
