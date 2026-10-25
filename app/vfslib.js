// Shared virtual-filesystem assembly for the Ikemen GO web build.
// Used by server.js (dev server + Mod Studio API) and export.js (snapshots
// everything into a static dist/ folder for plain web hosting).
//
// build() re-reads roster.json every call, so Studio edits take effect on
// the next request/export without restarting anything.
//
// The virtual root overlays these sources (later layers win):
//   4. project content: stages/, music/, and each roster character's
//      cache/<folder> (filtered to files its .def references)
//   3. the official release screenpack (menus verified against the engine)
//   2. the engine repo checkout (Lua scripts + engine data matching the
//      wasm binary's version)
//   1. generated files (select.def roster, config.json, font shims)
// and between the content and the generated files, the bundle's own mods that
// are switched on (modmgr.js: <bundle>/mods/<folder>/, the Mods tab).

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const layout = require('./layout');
// A SIBLING of the program folder in this repo, but INSIDE it in a portable
// build, where there is no repo for it to be a sibling of. The sibling is
// checked first so a checkout keeps behaving exactly as it always has and this
//
// Both resolved by layout.js: a sibling of the program in the repo, inside
// Dependencies/ and Content/ in a portable copy. See layout.js.
const IKEMEN_SRC = layout.IKEMEN_SRC;
const ROSTER_PATH = layout.dir('roster.json');

// THE MODS TAB (modmgr.js): where each of the Studio's own add-ons ships - one
// folder, external/mods/mugen-studio/ - and whether this bundle switched it off
// (roster.modsOff; webflags and onlinename never are). Lazily: modmgr asks
// this module for the roster.
const modmgr = () => require('./modmgr.js');
const addOnOn = (roster, id) => modmgr().builtinOn(roster, id);

// A byte-order mark in front is not damage: Notepad's "UTF-8 with BOM" and
// Windows PowerShell 5.1's Set-Content/Out-File -Encoding UTF8 both write one,
// and JSON.parse refuses it, so a roster that looked fine was reported
// damaged. The next save writes the file without it.
//
//
// roster every reader gets is the view's - two characters and a stage - so a
// helper three calls down that reads the roster for itself (the Scene
// Viewer's command table scans every character it lists) reads two, not the
// eight hundred of the whole build. Set and cleared by build() alone, around
// one synchronous call; a copy each time, so no reader can change the view.
let ROSTER_IN_VIEW = null;
function readRoster() {
  if (ROSTER_IN_VIEW) return JSON.parse(JSON.stringify(ROSTER_IN_VIEW));
  return JSON.parse(fs.readFileSync(ROSTER_PATH, 'utf8').replace(/^\uFEFF/, ''));
}
// Whether readRoster answers with a match view now: a reader that keeps an
// answer per stamp of roster.json (modlib charPalettes) must not keep one then.
function rosterInView() { return !!ROSTER_IN_VIEW; }

// Whole file, then one rename (layout.js writeJsonWhole's shape): closing the
// window kills the server at once, and a kill between an in-place write's
// truncate and its last byte left half a roster - the bundle's whole state. A
// reader now sees the old roster or the new one, never half of one. A rename
// onto a file another program holds for a moment (an antivirus scan, a sync
// client) can fail on Windows, so a few tries 100 ms apart - and never a
// fallback to the in-place write. A roster.json.tmp left by a kill is
// harmless: the next save replaces it.
const pauseMs = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
function writeRoster(roster) {
  const tmp = ROSTER_PATH + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(roster, null, 2) + '\n');
    for (let i = 0; ; i++) {
      try { fs.renameSync(tmp, ROSTER_PATH); return; } catch (e) {
        if (i >= 5 || !['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) throw e;
        pauseMs(100);
      }
    }
  } catch (e) {
    try { require('./lifebars.js').rmFile(tmp); } catch (e2) { /* the save's own error is the one to report */ }
    throw e;
  }
}

// A COPY OF roster.json AS IT IS NOW, before a save replaces it - E-Select's
// "Make a backup before each save". Into <bundle>/backups/, one file per save,
// named by the local time so a person can find "the one from before lunch",
// and NEVER PRUNED: the whole point is having the old one when it turns out to
// be wanted, and a roster is a few kilobytes. Two saves in the same second get
// -2, -3 rather than one overwriting the other.
//
// Returns the copy's path relative to the bundle folder (forward slashes), or
// null when there is no roster.json yet to copy.
function backupRoster(now) {
  if (!fs.existsSync(ROSTER_PATH)) return null;
  const d = now instanceof Date ? now : new Date();
  const p2 = (n) => String(n).padStart(2, '0');
  const stamp = d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate())
    + '-' + p2(d.getHours()) + p2(d.getMinutes()) + p2(d.getSeconds());
  const dir = path.join(path.dirname(ROSTER_PATH), 'backups');
  fs.mkdirSync(dir, { recursive: true });
  let name = 'roster-' + stamp + '.json';
  for (let n = 2; fs.existsSync(path.join(dir, name)); n++) name = 'roster-' + stamp + '-' + n + '.json';
  // COPYFILE_EXCL: a name that appeared between the check and the copy is
  // somebody else's backup, and this must never be the thing that loses one.
  fs.copyFileSync(ROSTER_PATH, path.join(dir, name), fs.constants.COPYFILE_EXCL);
  return 'backups/' + name;
}

// select.def [Characters] authoring lives in the shared core so the desktop
// Studio and Mod Studio Lite cannot drift on it. See GRAIL 4.12 for the
// confirmed rules; the silent ones (comma in a command value, partial
// next/previous, duplicate .def in a block, bare-comma lines) are enforced
// there.
const motifCore = require('./public/ikemen/motif-core.js');
// The [Keys_Pn] / [Joystick_Pn] sections this build writes. Top level on
// purpose: the kit's require-closure check only sees a require written this
// way, and a kit missing this file would die before serving a byte.
const keylib = require('./keylib.js');

// ONE FOLDER, ONE MOUNT.
//
// A character can ship more than one .def - a boss build beside the normal one,
// sharing the same sprites and sounds and differing only in its states. MUGEN
// lists those as separate select.def lines INTO THE SAME FOLDER, and so do we:
// the folder is copied once under the first entry's mount name, and every other
// entry that names the same folder points its select line at that same mount.
//
// Without this the second version would copy the whole character again - 18.8MB
// for the one that prompted it - to gain one text file.
function mountNames(roster) {
  const byFolder = new Map();
  for (const c of (roster.chars || [])) {
    if (c.kind || !c.folder || !c.mountAs) continue;
    if (!byFolder.has(c.folder)) byFolder.set(c.folder, c.mountAs);
  }
  return byFolder;
}

// The select.def path for one entry, pointed at whichever mount its folder got.
function selectPathFor(c, mounts) {
  if (c.kind || !c.folder || !c.select) return c.select;
  const mount = mounts.get(c.folder);
  if (!mount || mount === c.mountAs) return c.select;
  const defName = String(c.select).split('/').slice(1).join('/');
  return mount + '/' + defName;
}

// True when this entry is the one that should actually copy the folder.
function ownsMount(c, mounts) {
  return !c.kind && c.folder && c.mountAs && mounts.get(c.folder) === c.mountAs;
}

// opts.locks: write E-Select's lock labels (the DESKTOP build's select.def,
// desktop.js). The web build's select.def leaves them out: nothing in a browser
// build reads a lock, studio-lite's parseShipped does not strip comments, and a
// lock toggled in E-Select should not move the web Build ID.
function buildSelectDef(roster, opts) {
  // roster entries call the character path `select`; the core calls it `path`.
  const mounts = mountNames(roster);
  const entries = (roster.chars || []).map((c) => ({
    path: selectPathFor(c, mounts),
    kind: c.kind,
    stage: c.stage,
    music: c.music,
    order: c.order,
    ordersurvival: c.ordersurvival,
    ai: c.ai,
    hidden: c.hidden,
    includestage: c.includestage,
    exclude: c.exclude,
    params: c.params,
    slot: c.slot,
    select_: c.select_,
    next: c.next,
    previous: c.previous,
    // E-Select's cell lock, written back out as the label comment (see
    // motif-core LOCK_LABEL for why a comment on the entry's own line is safe).
    locked: opts && opts.locks ? c.locked : undefined,
  }));
  const lines = ['[Characters]', ...motifCore.buildCharacterLines(entries, { lockLabel: roster.lockLabel })];
  lines.push('', '[ExtraStages]');
  for (const s of roster.stages) {
    // No music param when neither the stage nor the roster names a track:
    // the stage falls back to its own def's bgmusic (or silence).
    //
    // A stage may name SEVERAL tracks, as an array. One `music=` param is
    // emitted per track, because the engine treats each as another candidate
    // and picks between them (src/music.go AppendParams -> matchSelection).
    // The draw comes from sys.musicRandseed, which Srand derives from the seed
    // netplay peers already exchanged and which never touches the gameplay
    // seed - so both players hear the same song and nothing desyncs. Pinned by
    // src/multibgm_test.go. A plain string stays a single track, so rosters
    // written before this change are unaffected.
    const raw = s.music || roster.music;
    const tracks = (Array.isArray(raw) ? raw : (raw ? [raw] : [])).filter(Boolean);
    lines.push(`stages/${s.file}` + tracks.map((t) => `, music=${t}`).join(''));
  }
  //
  // many characters of `order = N+1` the ladder draws. The engine reads
  // these from select.def [Options] (survival.maxmatches -1 means 'no
  // limit'), and until now they were hardcoded to a two-match arcade with
  //
  // carefully and the ladder ignored it.
  //
  // roster.maxMatches overrides, one key per mode. Anything absent keeps
  // the old value, so a roster written before this change builds the same
  // bytes it always did.
  const mm = roster.maxMatches || {};
  const row = (key, fallback) => {
    const v = Array.isArray(mm[key]) ? mm[key] : null;
    if (!v) return fallback;
    const out = [];
    for (let i = 0; i < 10; i++) out.push(Number.isFinite(+v[i]) ? Math.trunc(+v[i]) : 0);
    return out.join(',');
  };
  lines.push('', '[Options]',
    'arcade.maxmatches = ' + row('arcade', '2,0,0,0,0,0,0,0,0,0'),
    'team.maxmatches = ' + row('team', '2,0,0,0,0,0,0,0,0,0'));
  // Only emitted when set: the engine's own defaults are better than a
  // guess, and an unset mode should behave exactly as it did before.
  if (Array.isArray(mm.timeattack)) lines.push('timeattack.maxmatches = ' + row('timeattack', ''));
  if (Array.isArray(mm.survival)) lines.push('survival.maxmatches = ' + row('survival', ''));
  lines.push('');
  return Buffer.from(lines.join('\n'));
}

// V2 engine (web-upgrade branch) reads INI config instead of JSON. Both
// files are always emitted; each engine simply ignores the other's format.
// Missing keys fall back to the engine's embedded defaults, so this stays
// minimal: web-specific overrides only.
// The theme (Mugen calls it a screenpack) is just a motif path the engine
// resolves at boot. Anything under data/ with a system.def is a candidate, so a
// user-supplied pack mounts alongside the built-in ones and is chosen the same
// way. Falls back to the V2 bundle's motif when the roster names one that isn't
// there any more - a missing motif is a boot failure, not a cosmetic problem.
const DEFAULT_MOTIF = 'data/ikemen1/system.def';

//
//
// MERGED, NOT RE-STAMPED AT BOOT. save/config.ini is persisted per player, and
// once they have one it is theirs: changing a setting here and rebuilding does
// NOT reach a returning player, exactly as re-exporting a desktop build does
// not reach a copy someone already has. That is the honest behavior and it
// matches the other product. (The theme and the debug font ARE re-stamped in
// public/ikemen/vfs.js, because those have to match the build being served or
// the game boots into content it does not have.)
//
//
// leaves our own tuned default - and those defaults are deliberate, so the
// comments explaining them are worth keeping in the file the player can read.
function applyBuildSettings(lines, settings) {
  if (!settings || !settings.length) return lines;
  const out = lines.slice();
  const bySec = new Map();
  for (const st of settings) {
    if (!bySec.has(st.sec)) bySec.set(st.sec, []);
    bySec.get(st.sec).push(st);
  }
  for (const [sec, list] of bySec) {
    let at = out.findIndex((l) => new RegExp('^\\s*\\[' + sec + '\\]\\s*$', 'i').test(String(l)));
    if (at < 0) { out.push('', '[' + sec + ']'); at = out.length - 1; }
    // End of this section: the next header, or the end of the file.
    let end = at + 1;
    while (end < out.length && !/^\s*\[[^\]]+\]\s*$/.test(String(out[end]))) end++;
    for (const st of list) {
      const re = new RegExp('^\\s*' + st.key.replace(/[.]/g, '\\.') + '\\s*=', 'i');
      let hit = -1;
      for (let i = at + 1; i < end; i++) if (re.test(String(out[i]))) { hit = i; break; }
      if (hit >= 0) out[hit] = st.key + ' = ' + st.val;
      else { out.splice(end, 0, st.key + ' = ' + st.val); end++; }
    }
  }
  return out;
}

// How many player slots the engine will build, which is how many [Keys_Pn] /
// [Joystick_Pn] sections are worth writing: sysSet loops 1..Config.Players
// (config.go:407). The panel's own value if it has one, else the engine's 4.
function playersOf(roster) {
  const v = ((roster || {}).settings || {})['Config.Players'];
  const n = parseInt(v, 10);
  return Number.isInteger(n) && n >= 1 ? n : 4;
}

// `commonConst` is the vpath of a const file this build adds beside the
// engine's own, or null. It is only ever passed when that file is actually in
// the build: a [Common] Const entry naming a file that is not there fails
// character loading outright (char.go:3969-3982), the same rule the Lock-On
// hook's States1 line lives under.
function buildConfigIni(motif, settings, keys, players, commonConst, commonStates, commonLines, debugFont, galleryStates) {
  // An imported Ikemen GO build's own readout font, when it is a bitmap one
  // the browser can draw: its state code draws training and record text with
  // font -1, which is this font. Or a screenpack's, while a state file of its
  // that the build lists draws with font -1 (themecommon.js).
  const ownFont = debugFont && debugFont.bitmap && debugFont.vpath ? debugFont : null;
  return Buffer.from(applyBuildSettings([
    '[Config]',
    'Motif = ' + (motif || DEFAULT_MOTIF),
    'System = external/script/main.lua',
    'FirstRun = 0',
    'WindowTitle = Ikemen GO',
    '',
    '[Debug]',
    '; the default debug font is TrueType, which the browser build cannot render.',
    '; Swap it for a bitmap font - but the stock FontScale of 0.5 was tuned for a',
    '; 24pt TrueType face, and applying it to a 5x8 bitmap glyph renders sub-pixel',
    '; mush that is genuinely impossible to read. Use the bold 5x8 face at 2x, so',
    '; Ctrl+D (the only view that shows invalid-ANIMATION errors, which never reach',
    '; the browser console) is actually legible.',
    ownFont ? 'Font = ' + ownFont.vpath : 'Font = font/default-3x5-bold.def',
    ownFont ? 'FontScale = ' + (ownFont.scale || '0.5') : 'FontScale = 2',
    '',
    '[Sound]',
    '; Disable the BGM RAM-buffer optimization: it spawns a background',
    '; goroutine that re-reads the whole music file to cache it in RAM (a',
    '; desktop disk-seek win). On wasm the VFS is already in memory so it',
    "; buys nothing, and its async-file-IO goroutine's cross-match cleanup",
    '; broke subsequent BGM loads (music played once, then never again).',
    'BGMRAMBuffer = 0',
    '; Ship at half master volume: H-edit characters routinely abuse',
    '; PlaySnd volume/volumescale (volume = 255 all over the place) and at',
    '; 100% master the result is ear-splitting clipping. 50% is the field-',
    '; tested default; players can raise it in Options (their saved config',
    '; wins over this shipped default on every later boot).',
    'MasterVolume = 50',
    '',
    '[Common]',
    '; Pure Lua run on EVERY frame during a match. This is what calls loop(),',
    '; which is what fires hook.run("loop") - the per-frame hook every module',
    '; in external/mods draws from. The engine ships it in defaultConfig.ini,',
    '; but this generated config replaces that file wholesale, so omitting it',
    '; left the hook firing only while the pause menu ran its own loop: an',
    '; overlay would appear on pause and vanish during the fight.',
    'Lua = loop()',
    // THE BUILD'S OWN GAME-WIDE CONSTANTS, as a SECOND const file rather than
    // an edit to the engine's. SortedKeys puts Const before Const1
    // (common.go:1629-1644) and the loader assigns rather than merges
    // (char.go:3977), so every key in ours wins over the engine's and every key
    // we leave out keeps whatever the engine ships - including in a later
    // version. Absent when this build overrides nothing, so an untouched build
    // generates the file it always did.
    ...(commonConst ? [
      '; The constants this build changes, loaded after the engine’s own.',
      require('./engineconst.js').BUILD_CONST_KEY + ' = ' + commonConst,
    ] : []),
    // A WHOLE MUGEN BUILD'S OWN COMMON STATES, when this bundle was imported
    // from one. Another key of the same map, sorted after the engine's own
    // States - so its states fill numbers the engine leaves free and its
    // Statedef -2 is appended to every character's (buildimport.js has the
    // compile order and what it costs). Never named data/common1.cns: that is
    // what every MUGEN character's `stcommon` line asks for, and answering it
    // would displace the engine's own common states for the whole build.
    ...(commonStates ? [
      '; This build’s own common states, carried in from the MUGEN build it was',
      '; imported from, and loaded after the engine’s own.',
      require('./buildimport.js').BUILD_STATES_KEY + ' = ' + commonStates,
    ] : []),
    // AN IKEMEN GO BUILD'S OWN LISTS, in place of the engine's. The base keys
    // (States, Air, Cmd, Fx) are written with the build's own lists, which
    // replaces the engine's default for each - a keyed map merged per key -
    // the way that build's own config did (buildimport.js buildCommon).
    ...((commonLines || []).some((l) => l.from !== 'theme') ? [
      '; This build’s own [Common] files, from the Ikemen GO build it was imported',
      '; from, in place of the engine’s own lists.',
      ...commonLines.filter((l) => l.from !== 'theme').map((l) => l.key + ' = ' + l.value),
    ] : []),
    // A SCREENPACK'S OWN COMMON STATES (themecommon.js): its files standing in
    // the engine's list where the engine's own stood, and the systems it adds
    // on their own key. When an imported build's States was the base, this
    // line replaces it, because it was worked out from it.
    ...((commonLines || []).some((l) => l.from === 'theme') ? [
      '; This screenpack’s own common states (Theme tab), in place of the engine’s.',
      ...commonLines.filter((l) => l.from === 'theme').map((l) => l.key + ' = ' + l.value),
    ] : []),
    // THE H GALLERY'S HOOK (gallery.js), in a build that has the gallery: the
    // file and this line are decided together, like every key above.
    ...(galleryStates ? [
      '; The H gallery’s hook: holds the inputs the gallery asks for. Inert',
      '; unless the gallery is running.',
      require('./gallery.js').GALLERY_STATES_KEY + ' = ' + galleryStates,
    ] : []),
    '',
    '[Netplay]',
    '; Online display name, set in-game via NETWORK > PLAYER NAME. It MUST be',
    '; declared here even when empty: gameOption() raises "Invalid argument" on',
    '; a key the config never declared, which took the engine down on the menu',
    '; that reads it. Empty = the player has not chosen one yet.',
    'PlayerName = ',
    '; NETCODE MODE. Rollback (=1) is the DEFAULT as of 2026-08-11. The GC-freeze',
    '; rationale that kept it off dated from before the renderer rewrite, and the',
    '; one reproducible rollback desync (skipping the win pose) is now disabled',
    '; in the engine while a rollback session is live. Field-confirmed stable',
    '; across many matches since, and players prefer the feel. Delay (=0) remains',
    '; selectable on the boot page for players who want it; both peers must pick',
    '; the same mode or the match is refused.',
    'RollbackNetcode = 1',
    '; browsers jank more than native (GC, tab scheduling) - give the',
    '; disconnect detector extra patience',
    'Rollback.DisconnectNotifyStart = 2000',
    'Rollback.DisconnectTimeout = 8000',
    '; FrameDelay adds N frames (~16ms each) of input delay so more inputs are',
    '; CONFIRMED before simulating - trading a hair of input lag for far less',
    '; visible rollback "teleporting" under the jitter a browser/wasm build',
    '; produces (single thread shared by game + net + GC). 0 = purest rollback',
    '; but jumpiest; 1-2 is the sweet spot online; bump to 3 if it still snaps.',
    '; At ~60ms ping (spiking to 200) FrameDelay 1 still jittered, so 2.',
    'Rollback.FrameDelay = 2',
    "; Save/restore stage state during rollback. Off, a stage that mutates in a",
    '; way the engine cannot auto-detect diverges between machines and trips a',
    '; desync. On costs a little per-frame state copy; worth it for correctness.',
    'Rollback.SaveStageData = 1',
    '',
    '[Video]',
    'RenderMode = WebGL 2',
    // The ikemen1 motif is authored for 16:9 (localcoord 1280x720); a 4:3
    // render resolution crops the menu art and options off the right edge.
    // 854x480 keeps the validated 480p fill rate while fixing the aspect.
    // Bump both (e.g. 1280x720) for crisper HD visuals if the machine can
    // spare the fill rate.
    'GameWidth = 854',
    'GameHeight = 480',
    'KeepAspect = 1',
    'MSAA = 0',
    // 3D-model stages draw in the web build; their models' shadows do not
    // (the shadow pipeline needs geometry shaders and cube-map arrays, which
    // WebGL2 does not have). Said here so the file is true, and so a
    // returning player's saved copy is put right (vfs.js stamps both).
    'EnableModel = 1',
    'EnableModelShadow = 0',
    'VSync = 1',
    // THE CONTROLS ARE NO LONGER A LITERAL. keylib.js holds the names the
    // engine parses, this build's own layout and the shipped defaults, so the
    // Settings page, the website build and the desktop export all read one
    // table. With nothing bound in the Studio this emits exactly the two
    // sections it always did, byte for byte - a generated file that changes
    // size changes the Build ID, and an untouched build keeps its number.
    ...keylib.iniLines(keys, players),
  ].concat(buildRulesLine(settings)), settings).join('\n'));
}

// THE BUILD'S RULES, NAMED FOR THE PAGE. A browser keeps the engine's whole
// config from the last visit and loads it over the shipped one (vfs.js), so a
// rule this build sets - Simul.LoseOnKO from an imported mugen.cfg, a
// difficulty chosen in the Studio - never reached anybody who had played
// before: their saved copy still held the engine's default. This comment line
// tells vfs.js which [Options] values the build itself sets, so it can put a
// changed one back without touching anything the player chose. Game rules
// only: controls and video are the player's. A build that sets none writes no
// line, so its config - and its Build ID - stay byte for byte what they were.
function buildRulesLine(settings) {
  const rules = {};
  for (const st of settings || []) {
    if (st && st.sec === 'Options' && !st.fromDefault) rules[st.sec + '.' + st.key] = String(st.val);
  }
  return Object.keys(rules).length ? ['', '; build rules: ' + JSON.stringify(rules)] : [];
}

// Whether the roster has a giver: the giver badge's own test (modlib.hScan),
// over the characters the H gallery reads (gallerydata.js rosterChars). The
// gallery takes its givers from exactly these, so a roster without one can
// only get no gallery, and reading every character to find that out cost
// 1.2-1.5 s on a first load at 150 characters. A character that cannot be
// scanned counts as a giver, so the gallery decides as it always did.
function rosterHasGiver(roster) {
  return rosterBadges(roster).givers.length > 0;
}

// Each character's two badges (modlib.hScan), over the characters the H
// gallery reads. A character that cannot be scanned counts as both, so the
// gallery decides as it always did.
// The owner's word on a character (chars[i].hRole, hmodule.js) over the scan's,
// unless `opts.detectedOnly` (whether the scan alone finds a pair: a roster
// from before the H-MUGEN module is grandfathered on that).
function rosterBadges(roster, opts) {
  const cacheDir = layout.dir('cache');
  const detectedOnly = !!(opts && opts.detectedOnly);
  const givers = [], receivers = [];
  for (const c of (roster && roster.chars) || []) {
    if (c.kind || !c.folder || !c.select) continue;
    let h;
    try { h = scannedH(path.join(cacheDir, c.folder), String(c.select).split('/').slice(1).join('/')); } catch (e) { h = detectedOnly ? { giver: false, receiver: false } : { giver: true, receiver: true }; }
    if (!detectedOnly) h = require('./hmodule.js').effectiveRole(c, h);
    const key = c.folder + '|' + c.select;
    if (h.giver) givers.push(key);
    if (h.receiver) receivers.push(key);
  }
  return { givers, receivers };
}

// Whether the roster can have an H gallery at all: a giver AND a receiver. One
// character who is both counts: he is his own receiver, the MIRROR PAIR
// (gallerydata buildGalleryData). Both the build and the Mods tab ask this, so
// the tab lists the gallery exactly where a build would look for one; the
// build then still makes it only when some pair has a scene that renders
// (gallery.buildGalleryFiles). A giver alone, or a receiver alone, gets no
// gallery and no row.
function rosterHasGalleryPair(roster, opts) {
  const { givers, receivers } = rosterBadges(roster, opts);
  // (A receiver who is no giver, another giver, or the one giver himself as
  // both: every receiver makes a pair once there is a giver.)
  return givers.length > 0 && receivers.length > 0;
}
// hScan's answer, kept per character while the files it reads keep their size
// and time: the .def and each file named on its cmd, cns, st, stcommon, anim
// and sprite lines, joined as hScan joins them. The refresh scans once per
// call anyway (modlib studioInfo), but the play build and the exports run
// outside it, where a scan of every character would cost more than it saves.
const GIVER_SEEN = new Map();
function scannedH(dir, def) {
  const defAbs = path.join(dir, def);
  const stampOf = (abs) => { try { const st = fs.statSync(abs); return st.size + '@' + st.mtimeMs; } catch (e) { return '-'; } };
  let text;
  try { text = fs.readFileSync(defAbs, 'latin1'); } catch (e) { return { giver: false, receiver: false }; } // hScan's answer too
  const parts = [stampOf(defAbs)];
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(cmd|cns|st\d*|stcommon|anim|sprite)\s*=\s*(.+?)\s*(;.*)?$/i.exec(line);
    if (m) parts.push(stampOf(path.join(dir, m[2].replace(/"/g, '').replace(/\\/g, '/'))));
  }
  const stamp = parts.join('|');
  const hit = GIVER_SEEN.get(defAbs);
  if (hit && hit.stamp === stamp) return hit.h;
  const s = require('./modlib').hScan(dir, def) || {};
  const h = { giver: !!s.giver, receiver: !!s.receiver };
  GIVER_SEEN.set(defAbs, { stamp, h });
  return h;
}

//
// stand in for an import's; null for every bundle of the Studio's own.
function makeGeneratedFiles(roster, ext) {
  // The build's own game-wide constants, when it has any. The file and the
  // config line are decided together, in one place, so the two can never
  // disagree - a listed file that is not in the build fails character loading.
  const engineconst = require('./engineconst.js');
  let ownConsts = null;
  try { ownConsts = engineconst.buildOverrides(); } catch (e) { ownConsts = null; }
  // And its own lifebars, when it has taken a copy. The copy lives under the
  //
  // pack's own fight.def without anything to remember.
  let ownFight = null;
  try { ownFight = require('./lifebar.js').buildOverride(roster); } catch (e) { ownFight = null; }
  // And the common states of the MUGEN build this bundle was imported from,
  // when there was one and it compiles (buildimport.js decides both together,
  // so the config line and the file can never disagree).
  let ownStates = null;
  try { ownStates = require('./buildimport.js').buildStates(); } catch (e) { ownStates = null; }
  // And the [Common] files of the Ikemen GO build it was imported from, in
  // place of the engine's own (the files and the lines decided together).
  let ownCommon = null;
  try { ownCommon = ext ? externalCommon(ext) : require('./buildimport.js').buildCommon(); } catch (e) { ownCommon = null; }
  // A build open read-only has no engine folder of its own to hold its
  // constants: the keys its common.const sets differently from the engine's
  // are worked out from the build itself, as the import works them out.
  if (ext && !ownConsts && ownCommon && ownCommon.consts) ownConsts = ownCommon.consts;
  // A build state file this engine would not compile gave way to the engine's
  // own (buildimport checkOwnStates), one line each.
  for (const l of (ownCommon && ownCommon.report) || []) console.log('build common states: ' + l);
  // And the screenpack's own common states (themecommon.js), worked out FROM
  // that list, so a build that brings its own file for a role keeps it. The
  // files ride the theme walk; only the lines are decided here.
  let themeCommon = null;
  try { themeCommon = require('./themecommon.js').forRoster(roster, { ownCommon }); } catch (e) {
    console.warn('screenpack common states failed:', e.message);
    themeCommon = null;
  }
  const commonLines = themeCommon && themeCommon.lines.length
    ? require('./themecommon.js').mergeLines(ownCommon ? ownCommon.lines : [], themeCommon.lines)
    : (ownCommon ? ownCommon.lines : null);
  const debugFont = (ownCommon && ownCommon.debugFont) || (themeCommon && themeCommon.debugFont) || null;
  // And the H gallery, in a build in H-Mugen mode with a pair to show: its
  // mode script and its common-state hook, and the hook's config line. Only
  // looked for when the roster has a giver and a receiver (rosterHasGalleryPair),
  // and never when the Mods tab switched it off - the file, the hook and the
  // line go together.
  let gallery = null;
  try { if (addOnOn(roster, 'hgallery') && rosterHasGalleryPair(roster)) gallery = require('./gallery.js').buildForRoster(roster); } catch (e) {
    console.warn('H gallery generation failed:', e.message);
    gallery = null;
  }
  const files = {
    'data/select.def': buildSelectDef(roster),
    'save/config.ini': buildConfigIni(roster.motif,
      require('./settings-schema').settingsFor(roster.settings, 'web'),
      roster.keys, playersOf(roster),
      ownConsts ? engineconst.BUILD_CONST_VPATH : null,
      ownStates ? ownStates.vpath : null,
      commonLines,
      debugFont,
      gallery ? require('./gallery.js').GALLERY_ZSS_VPATH : null),
    'save/config.json': Buffer.from(JSON.stringify({
      // Official release screenpack (menus verified against master engine).
      Motif: 'data/system.def',
      System: 'external/script/main.lua',
      GameWidth: 640,
      GameHeight: 480,
      Fullscreen: false,
      // The engine's first-run routine overwrites KeyConfig with its own
      // hardcoded defaults (and saves); our shipped bindings ARE the setup.
      FirstRun: false,
      // The default debug font is TrueType, which the js/wasm build cannot
      // render (LoadFntTtf panics). The 3x5 bitmap font renders corrupted
      // glyphs in this build, so use the same 6x9 font as the Scene Viewer
      // overlay - larger and known-good.
      DebugFont: 'font/f-6x9.def',
      // Button order: UP DOWN LEFT RIGHT  A B C  X Y Z  START  D W  MENU
      // P1: WASD movement, K/L/; = A/B/C (home row), I/O/P = X/Y/Z (row
      // above) - fingers rest on the home row. P2: arrows + numpad.
      // Players can remap in-game under Options (persisted via localStorage).
      KeyConfig: [
        { Joystick: -1, Buttons: ['w', 's', 'a', 'd', 'k', 'l', 'SEMICOLON', 'i', 'o', 'p', 'RETURN', 'q', 'e', 'Not used'] },
        { Joystick: -1, Buttons: ['UP', 'DOWN', 'LEFT', 'RIGHT', 'KP_1', 'KP_2', 'KP_3', 'KP_4', 'KP_5', 'KP_6', 'KP_ENTER', 'KP_7', 'KP_8', 'Not used'] },
        { Joystick: -1, Buttons: ['Not used', 'Not used', 'Not used', 'Not used', 'Not used', 'Not used', 'Not used', 'Not used', 'Not used', 'Not used', 'Not used', 'Not used', 'Not used', 'Not used'] },
        { Joystick: -1, Buttons: ['Not used', 'Not used', 'Not used', 'Not used', 'Not used', 'Not used', 'Not used', 'Not used', 'Not used', 'Not used', 'Not used', 'Not used', 'Not used', 'Not used'] },
      ],
      // Pad bindings (XInput-order indices from the glfw-js gamepad
      // bridge). Same as the engine default except C/Z swapped per field
      // test: heavy kick (C) on RT, heavy punch (Z) on RB, matching most
      // commercial fighting-game layouts. "-12" = trigger axis 5 (RT),
      // "5" = RB, "-10" = axis 4 (LT), "4" = LB.
      // Order: UP DOWN LEFT RIGHT  A B C  X Y Z  START  D W  MENU
      JoystickConfig: [0, 1, 2, 3].map((n) => ({
        Joystick: n,
        Buttons: ['10', '12', '13', '11', '0', '1', '-12', '2', '3', '5', '7', '4', '-10', '6'],
      })),
    })),
    'save/stats.json': Buffer.from('{}'),
  };
  // Beside the engine's own data/common.const, never over it: the engine's
  // file stays as its release shipped it, and this one says only what this
  // build changed.
  if (ownConsts) files[engineconst.BUILD_CONST_VPATH] = Buffer.from(ownConsts.text, 'latin1');
  if (ownStates) files[ownStates.vpath] = ownStates.text;
  if (ownCommon) for (const f of ownCommon.files) files[f.vpath] = f.text;
  // At the FIRST place the engine looks for it - the motif's own folder - so
  // the engine's data/fight.def and the pack's own copy are both left alone
  // (motif.go:82 `lookup:"def,,data/"`).
  if (ownFight) files[ownFight.vpath] = Buffer.from(ownFight.text, 'latin1');
  if (gallery) {
    const g = require('./gallery.js');
    files[g.GALLERY_LUA_VPATH] = gallery.lua;
    files[g.GALLERY_ZSS_VPATH] = gallery.zss;
  }

  // The screenpacks reference TrueType fonts (Open_Sans, infofont), which
  // the js/wasm build cannot render. Shadow them with a BITMAP font.
  if (process.env.IKEMEN_V2) {
    // The V2 ikemen1 motif is HD (localcoord 1280x720); the tiny 6x9 font
    // renders as unreadable specks. Substitute the motif's own 18px "Pixel"
    // font (full ASCII, sized for this motif) and ship its SFF under font/
    // so the .def's File reference resolves.
    const pixelSff = fs.readFileSync(path.join(layout.dir('release-v2'), 'data', 'ikemen1', 'fonts', 'pixel.sff'));
    const pixelDef = Buffer.from(
      '[FNT v2]\nfntversion = 2,00\nname = "Pixel"\n[Def]\n' +
      'Type = bitmap\nBankType = palette\nSize = 18,18\nSpacing = 0,4\nOffset = 0,0\n' +
      'File = menusub.sff\n');
    files['font/menusub.sff'] = pixelSff;
    files['font/Open_Sans.def'] = pixelDef;
    files['font/infofont.def'] = pixelDef;
  } else {
    // v1 release screenpack is low-res; f-6x9 matches its expected sizes.
    files['font/Open_Sans.def'] = fs.readFileSync(path.join(layout.dir('release'), 'font', 'f-6x9.def'));
    files['font/infofont.def'] = fs.readFileSync(path.join(layout.dir('release'), 'font', 'f-6x9.def'));
  }
  return files;
}

// A .orig sibling is this project's backup convention - the palette repair
// writes sff + '.orig', optimize-audio writes snd + '.orig' - and a backup must
// never ship. Characters were already safe by accident (charKeepFilter keeps
// only referenced files plus KEEP_EXTS, and .orig is neither), but data/,
// stages/, music/ and themes/ are walked UNFILTERED, so backups there rode
// straight into the pack: six of them, 11.1 MB, in both builds. Excluded here
// rather than per caller so no future layer can reintroduce it.
// Every backup shape, not just .orig - desktop.js has used the wider pattern
// since the stale-backup sweep, and the stage thumbnail writes
// <stage>.sff.stagethumb.orig beside a stage the user dropped in.
const BACKUP_FILE = /\.(orig|bak|preSquare)$/i;
// data/work/ (and data/<motif>/work/) is the engine's AUTHORING source - the
// .wav, .sff and .txt files the release screenpack was compiled FROM
// (common_snd, fight_sff, glyphs_sff, system_snd...). Nothing reads it at
// runtime: no .def in the release references it, the engine repo does not
// carry it, and the 1.0.0 desktop zip ships without it. The v1 release pack
// carries 1006 of them (7.4 MB), and because that layer was walked unfiltered
// they made up 1006 of the pak's ~1670 index entries in every web export from
// v1.0 to v1.8 - none of it playable. Filtered at the engine-layer walks only
// (a user's themes are theirs) and refused by tools/export-selfcheck.js so it
// cannot creep back in through a new layer.
const WORK_DIR = /^data\/(?:[^/]+\/)?work\//i;
const notWork = (vpath) => !WORK_DIR.test(vpath);
function walkDir(absDir, virtualPrefix, out, filter) {
  let entries;
  try { entries = fs.readdirSync(absDir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const abs = path.join(absDir, e.name);
    const vpath = virtualPrefix ? `${virtualPrefix}/${e.name}` : e.name;
    if (e.isDirectory()) {
      walkDir(abs, vpath, out, filter);
    } else if (e.isFile() && !BACKUP_FILE.test(e.name) && (!filter || filter(vpath))) {
      out.set(vpath, abs);
    }
  }
}

// 3D model files (glTF). A stage's model ships wherever the stage ships: the
// web renderer draws model stages (without model shadows) and the desktop
// engine draws everything. Only the engine's own two 3D demo stages
// (release-v2 stage3d*) stay out of every build, with their 24 MB of models:
//
const MODEL_FILE = /\.(glb|gltf)$/i;

// The files a .gltf names beside it: its buffers and images, by URI relative
// to the .gltf's own folder (the engine opens them with os.DirFS of that
// folder, model.go loadglTFModel). A .glb carries both inside it, and an
// embedded `data:` URI is not a file, so neither adds anything. Paths come
// back with forward slashes, percent-escapes decoded, never leaving the folder.
function gltfFiles(absPath) {
  if (!/\.gltf$/i.test(absPath)) return [];
  let doc;
  try {
    if (fs.statSync(absPath).size > 32 * 1024 * 1024) return [];
    doc = JSON.parse(fs.readFileSync(absPath, 'utf8').replace(/^﻿/, ''));
  } catch (e) { return []; }
  const out = [];
  for (const list of [doc && doc.buffers, doc && doc.images]) {
    for (const it of Array.isArray(list) ? list : []) {
      const uri = it && typeof it.uri === 'string' ? it.uri : '';
      if (!uri || /^data:/i.test(uri) || /^[a-z][\w+.-]*:/i.test(uri)) continue;
      let rel;
      try { rel = decodeURIComponent(uri); } catch (e) { rel = uri; }
      rel = path.posix.normalize(rel.replace(/\\/g, '/')).replace(/^\.\//, '');
      if (!rel || rel.startsWith('../') || rel === '..' || path.posix.isAbsolute(rel)) continue;
      if (!out.includes(rel)) out.push(rel);
    }
  }
  return out;
}

// Builds a keep-filter from a character's main .def: only files the def
// references ship, so unrelated leftovers bundled in community zips (backup
// spritesheets, alternate builds) don't bloat the export. Small text and
// palette files are always kept - only unreferenced heavy binaries drop.
const KEEP_EXTS = new Set(['.def', '.cns', '.st', '.cmd', '.air', '.act', '.txt']);
// EVERY ROSTERED DEF FOR THE FOLDER, not just the one that owns the mount.
//
// A folder is copied ONCE, by whichever entry owns the mount (ownsMount), and
// every other entry for that folder rides along on the same files. So if the
// keep filter only followed the OWNER's def, a variant's own assets were never
// added to the keep set and simply did not ship: adding CVS_Makoto's
// MakotoWin.def gave a select.def line pointing at a def whose sprite file
// (MakotoWin.sff, SFF v1, 33 MB) had been dropped, and the character failed to
// load with nothing in the export to explain why.
//
// It only bit variants that name their OWN files. An AI or gameplay variant
// shares the sprite and its .cns/.cmd/.air survive on KEEP_EXTS anyway, which
// is why this went unnoticed - those are the common case and they worked.
// The defs a folder is actually LOADED with: every roster entry that points at
// it - the owner's plus each variant's. This, not a guess at the folder's
// "main" def, is what decides which files ship, in the web build and in the
// desktop export alike. A folder of alternates (Bison.def, 3v3.def,
// Final Bison.def) has no main def the files can tell you about; only the
// roster knows that the entry is Final Bison.def and needs Sprite2.sff.
function rosteredDefNames(roster, folder) {
  return (roster && roster.chars || [])
    .filter((o) => !o.kind && o.folder === folder && o.select)
    .map((o) => o.select.split('/').slice(1).join('/'))
    .filter(Boolean);
}

function charKeepFilter(charDir, defNames) {
  const referenced = new Set();
  const seen = new Set();
  // Collect files a .def references, following referenced .def files (intro.def,
  // ending.def, ...) transitively - their assets (intro.sff, ending.sff, bgm)
  // are named inside THEM, not the main .def, so a main-def-only scan drops a
  // character's intro/ending storyboard art and it renders as a blank screen.
  const collect = (defRel) => {
    if (seen.has(defRel)) return;
    seen.add(defRel);
    let text;
    try { text = fs.readFileSync(path.join(charDir, defRel), 'latin1'); }
    catch { return; }
    const dir = path.posix.dirname(defRel.replace(/\\/g, '/'));
    for (const line of text.split(/\r?\n/)) {
      const m = /^\s*[\w.]+\s*=\s*(.+?)\s*(;.*)?$/.exec(line);
      if (!m) continue;
      const val = m[1].replace(/"/g, '').replace(/\\/g, '/');
      // resolve relative to the def that named it, then normalize to char-root
      const rel = (dir === '.' ? val : dir + '/' + val).replace(/^\.\//, '');
      referenced.add(rel.toLowerCase());
      if (/\.def$/i.test(val)) collect(rel);
    }
  };
  try {
    for (const d of [].concat(defNames)) if (d) collect(d);
  } catch {
    return null; // def unreadable: ship everything rather than break the char
  }
  return (vpath) => {
    const rel = vpath.split('/').slice(2).join('/').toLowerCase(); // strip chars/<name>/
    return referenced.has(rel) || KEEP_EXTS.has(path.extname(rel));
  };
}

//
// FLAT in one directory, so unlike a character there is no folder to scope by -
// a stage is its .def plus whatever that def names, plus same-basename
// companions. Matching references by BASENAME on purpose: a def may name its
// sprite bare ("Foo.sff", what the installer writes now) or root-relative
// ("stages/Foo.sff", how community stages ship), and both mean the same file.
// Returns a Set of lowercased vpaths.
// The sound/* tracks the SHIPPING motif's own [Music] section names, read off
// the installed theme on disk. Only the library-relative ones: a track the pack
// still keeps inside its own folder rides along with themes/ and needs nothing
// from here, and a motif that is not an installed theme (the engine's own, or a
// generated one) has no file here to read.
//
// The keys are the ones the engine treats as a screen's music - a prefix and
// .bgm/.bgmusic, the same set buildimport.motifMusicKeys reads - and the value
// is split on commas because the engine splits it on commas (iniutils.go
// parseMusicSection): a pack may name several candidates for one screen and any
// of them can be the one that plays.
function motifOwnMusic(roster) {
  const out = [];
  const motif = String((roster && roster.motif) || '').replace(/\\/g, '/');
  if (!/^data\//i.test(motif)) return out;
  let text = null;
  try {
    text = fs.readFileSync(path.join(layout.dir('themes'), motif.replace(/^data\//i, '')), 'latin1');
  } catch (e) { return out; }
  let inMusic = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/;.*$/, '').trim();
    if (!line) continue;
    const h = /^\[([^\]]*)\]/.exec(line);
    if (h) { inMusic = /^music$/i.test(h[1].trim()); continue; }
    if (!inMusic) continue;
    const m = /^([^=]+?)\s*=\s*(.*)$/.exec(line);
    if (!m || !/^(?:.+\.)?(?:bgm|bgmusic)$/i.test(m[1].trim())) continue;
    for (const v of m[2].split(',')) {
      const t = v.replace(/"/g, '').replace(/\\/g, '/').trim();
      if (/^sound\//i.test(t)) out.push(t);
    }
  }
  return out;
}

function stageKeepFilter(stages) {
  const keep = new Set();
  // A stage's round variants (round1def = stages/x1.def ...) ship with it, and
  // so does everything they name: they join the queue as they are found.
  const queue = stages.map((s) => String(s.file)), seen = new Set();
  for (let qi = 0; qi < queue.length; qi++) {
    const file = queue[qi];
    if (seen.has(file.toLowerCase())) continue;
    seen.add(file.toLowerCase());
    keep.add(`stages/${file}`.toLowerCase());
    const base = path.basename(file, path.extname(file)).toLowerCase();
    let text;
    try { text = fs.readFileSync(path.join(layout.dir('stages'), file), 'latin1'); }
    catch { continue; }   // unreadable def: it still ships, just without extras
    for (const line of text.split(/\r?\n/)) {
      const r = /^\s*round\d+def\s*=\s*([^;\r\n]+?)\s*(;.*)?$/i.exec(line);
      if (r) {
        const rn = r[1].replace(/"/g, '').replace(/\\/g, '/').split('/').pop().trim();
        if (rn) queue.push(rn);
        continue;
      }
      const m = /^\s*(spr|model|environment|bgmusic|attachedchar\d*)\s*=\s*([^;\r\n]+?)\s*(;.*)?$/i.exec(line);
      if (!m) continue;
      const name = m[2].replace(/"/g, '').replace(/\\/g, '/').split('/').pop().trim();
      if (name) keep.add(`stages/${name}`.toLowerCase());
      // A .gltf model names its buffers and images by path from its own
      // folder; they ship with it.
      if (name && /^model$/i.test(m[1])) {
        for (const f of gltfFiles(path.join(layout.dir('stages'), name))) keep.add(`stages/${f}`.toLowerCase());
      }
      // An attached character (the stage's own rules, e.g. a ring-out) ships
      // with every file its [Files] names; missing, the engine stops the game.
      if (name && /^attachedchar/i.test(m[1])) {
        let aText = null;
        try { aText = fs.readFileSync(path.join(layout.dir('stages'), name), 'latin1'); } catch { aText = null; }
        if (aText) for (const f of require('./modlib.js').attachedCharFiles(aText)) keep.add(`stages/${f.name}`.toLowerCase());
      }
    }
    // Same-basename companions, including the "<defbase>.<name>" form the
    // installer uses when two packs ship a file of the same name.
    try {
      for (const f of fs.readdirSync(layout.dir('stages'))) {
        if (f.toLowerCase().startsWith(base + '.')) keep.add(`stages/${f}`.toLowerCase());
      }
    } catch { /* no stages dir */ }
  }
  return keep;
}

// ---- a build open read-only: the match view ----------------------------------
//
// An external bundle (layout.js EXTERNAL, bundles.openExternal) is a whole
// install read where it is - the Ikemen Fighting Collection is 802 characters
// whose 1,077 sprite files come to 20.3 GB. The browser engine (vfs.js) takes
// the file list up front and then fetches EVERY file on it, whole, in the
// background (it warms its cache so nothing is fetched mid-fight), keeping
// each for the session - the list is the download. A web game of the whole
// roster of such a build cannot run in a tab, and even listing it walks every
// folder of the build (142 s for /api/themes on that one).
//
// SO IN A READ-ONLY BUNDLE THE ENGINE'S FILE LIST IS A MATCH VIEW, never the
// roster:
//   - the engine's and the Studio's own layers, exactly as every build has
//     them (release, release-v2, the engine checkout, the generated config,
//     the Lua add-ons, the gallery hook);
//   - the build's active screenpack folder, whole, and every file outside it
//     that its defs name - fonts, sounds, the fight screen, storyboards - and
//     every file THOSE name, looked for where the engine looks (viewRefs),
//     never a walk of the rest of data/;
//   - the build's own [Common] lists from external.json, run the way an
//     imported Ikemen GO build's are (externalCommon, roster.engineCommon);
//   - the two characters chosen for the match, mounted at chars/<mountAs> like
//     any character, and the chosen stage's def with the files it names;
//   - a generated data/select.def listing just those, and the screenpack's
//     select= pointed at it, so the menus see the same two.
// Nothing is copied: every file of the build in the list is served from where
// it is (server.js serveIkemenFs). Until a match is chosen the view has no
// characters and no stages, and server.js answers the file list with a 409
// that says what to do. Every bundle of the Studio's own builds exactly what
// it built before: none of this runs unless layout.readOnly.
let MATCH = null;   // { p1, p2, stage }: two select values and a stage file
function setMatchView(v) {
  MATCH = v ? { p1: String(v.p1), p2: String(v.p2), stage: String(v.stage) } : null;
}
function matchView() { return MATCH ? Object.assign({}, MATCH) : null; }

const fileThere = (p) => { try { return fs.statSync(p).isFile(); } catch (e) { return false; } };

// A match the page asks for, checked against the roster. p1 and p2 are
// characters' mount names - or a select value, <mountAs>/<def>, to pick one
// def of a folder that has several - and stage is a stage's file as the
// roster lists it (with or without stages/ in front). p2ai, optional, is the
// level of a computer-played P2 (0-8; the engine's quick match has none).
// -> { view: { p1, p2, stage }, url } or { error }. The url opens the web
// game straight into the fight (index.html passes p1/p2/stage to the engine
// as -p1/-p2/-s, main.lua f_commandLine): -p1 takes a select.def entry, which
// <mountAs>/<def> is, and -s a path, which stages/<file> is.
function matchFor(roster, ask) {
  const a = ask && typeof ask === 'object' ? ask : {};
  const str = (v) => (typeof v === 'string' ? v.trim() : '');
  const chars = ((roster && roster.chars) || []).filter((c) => c && !c.kind && c.folder && c.select && c.mountAs);
  const charOf = (who) => {
    const want = str(a[who]);
    if (!want) return { error: who + ' is missing - give a character\'s id (its mount name)' };
    if (want.length > 300 || /[\x00-\x1f,]/.test(want)) return { error: who + ': "' + want.slice(0, 80) + '" is not a character id' };
    const low = want.toLowerCase();
    const c = want.includes('/')
      ? chars.find((x) => x.select === want) || chars.find((x) => String(x.select).toLowerCase() === low)
      : chars.find((x) => x.mountAs === want) || chars.find((x) => String(x.mountAs).toLowerCase() === low);
    if (!c) return { error: who + ': "' + want + '" is not a character in this build' };
    const def = String(c.select).split('/').slice(1).join('/');
    if (!fileThere(path.join(layout.dir('cache'), c.folder, def))) {
      return { error: who + ': ' + c.folder + '/' + def + ' is not in the build any more' };
    }
    return { c };
  };
  const p1 = charOf('p1');
  if (p1.error) return p1;
  const p2 = charOf('p2');
  if (p2.error) return p2;
  const wantStage = str(a.stage).replace(/\\/g, '/').replace(/^stages\//i, '');
  if (!wantStage) return { error: 'stage is missing - give a stage\'s file as the roster lists it' };
  const s = ((roster && roster.stages) || []).find((x) => x && typeof x.file === 'string' && x.file.toLowerCase() === wantStage.toLowerCase());
  if (!s) return { error: 'stage: "' + wantStage + '" is not a stage in this build' };
  if (!fileThere(path.join(layout.dir('stages'), s.file))) return { error: 'stage: stages/' + s.file + ' is not in the build any more' };
  let p2ai = null;
  if (a.p2ai !== undefined && a.p2ai !== null && a.p2ai !== '') {
    p2ai = Number(a.p2ai);
    if (!Number.isInteger(p2ai) || p2ai < 0 || p2ai > 8) return { error: 'p2ai is a computer level from 0 to 8' };
  }
  // The select values as the view's own select.def spells them (one folder,
  // one mount): what -p1/-p2 must name to find the files.
  const mounts = mountNames({ chars: [p1.c, p2.c] });
  const sel1 = selectPathFor(p1.c, mounts), sel2 = selectPathFor(p2.c, mounts);
  const q = (k, v) => k + '=' + encodeURIComponent(v);
  // loadmotif=1 asks for the engine's -loadmotif: the screenpack loaded before
  // the fight, as in a match picked from the menus. Without it the quick
  // match draws the characters and the stage and no lifebars of the build's
  // own (measured on the Ikemen Fighting Collection, 2026-10-09); with only
  // two characters and a stage in the view, loading the screenpack first
  // costs a few seconds. index.html passes it on as -loadmotif; a page
  // that does not know it ignores it, and the match plays as above.
  const url = '/ikemen/index.html?' + [q('p1', sel1), q('p2', sel2)].concat(p2ai === null ? [] : [q('p2ai', String(p2ai))],
    [q('stage', 'stages/' + s.file), 'loadmotif=1']).join('&');
  return { view: { p1: p1.c.select, p2: p2.c.select, stage: s.file }, url };
}

// The roster as the view sees it: the two characters, the one stage, and the
// roster's own rules, ladder and screenpack. A character's own stage and song
// are left off its line (neither is in the view), and so are the cell
// properties that would hide it or fold it into a slot, so the view's own
// select screen - the menus, when the game is opened without p1/p2 - shows
// exactly the two.
function viewRoster(roster, match) {
  const r = Object.assign({}, roster, { chars: [], stages: [] });
  if (!match) return r;
  const all = (roster.chars || []).filter((c) => c && !c.kind && c.folder && c.select);
  for (const sel of [match.p1, match.p2]) {
    const c = all.find((x) => x.select === sel);
    if (!c || r.chars.some((x) => x.select === c.select)) continue;
    const e = Object.assign({}, c);
    if (e.stage && String(e.stage).toLowerCase() !== String(match.stage).toLowerCase()) delete e.stage;
    for (const k of ['music', 'hidden', 'exclude', 'slot', 'select_', 'next', 'previous', 'locked']) delete e[k];
    r.chars.push(e);
  }
  const s = (roster.stages || []).find((x) => x && typeof x.file === 'string' && x.file.toLowerCase() === String(match.stage).toLowerCase());
  if (s) r.stages = [Object.assign({}, s)];
  return r;
}

// The build's record (external.json), its folder and the match, for one build.
function externalView() {
  let record = null;
  try { record = JSON.parse(fs.readFileSync(layout.EXTERNAL_FILE, 'utf8').replace(/^\uFEFF/, '')); } catch (e) { record = null; }
  return { root: layout.externalRoot || '', record, match: MATCH };
}

// THE BUILD'S OWN [Common] LISTS, RUN WHERE THEY ARE: the lines and files
// buildimport.buildCommon hands both exports for an imported Ikemen GO build,
// made from external.json's `common` instead of from copies in the bundle's
// engine folder. An entry that is the engine's own file (stock) keeps the
// engine's path; the build's own files go in under data/build/ by name, read
// from the build into memory - nothing is written anywhere - so the Studio's
// hooks in the engine's own data/ files stay where they are. Its state files
// are checked for THIS engine (buildimport.checkOwnStates): one that would not
// compile gives way to the engine's file for its part, because a listed file
// that does not compile stops every character loading. Its effects pack brings
// the files its def names beside it. Its common.const becomes the build's
// constant overrides (`consts`): the keys it sets differently from the
// engine's, as the import works them out. Null when the record lists none.
function externalCommon(ext) {
  const c = ext && ext.record && ext.record.common;
  const root = ext && ext.root;
  if (!c || typeof c !== 'object' || !root) return null;
  const bi = require('./buildimport.js');
  const ls = bi.lister();
  const files = [], missing = [];
  const carried = new Map();   // the file's path in the build, lowercased -> its name under data/build/
  const names = new Set();
  const readIn = (rel) => {
    const hit = bi.resolve(root, rel, ls);
    if (!hit || !fileThere(hit.abs)) return null;
    try { return { abs: hit.abs, rel: hit.rel, text: fs.readFileSync(hit.abs) }; } catch (e) { return null; }
  };
  const carry = (rel) => {
    const f = readIn(rel);
    if (!f) { missing.push(rel); return null; }
    const key = f.rel.toLowerCase();
    if (carried.has(key)) return carried.get(key);
    let name = path.posix.basename(f.rel);
    if (names.has(name.toLowerCase())) name = f.rel.replace(/\//g, '_');
    names.add(name.toLowerCase());
    carried.set(key, name);
    files.push({ name, path: f.abs, vpath: bi.BUILD_COMMON_VDIR + '/' + name, text: f.text });
    return name;
  };
  const vpathOf = (f) => {
    if (!f || typeof f !== 'object') return null;
    const ref = String(f.ref || '').replace(/\\/g, '/');
    if (f.stock) return (typeof f.rel === 'string' && f.rel) || ref || null;
    if (typeof f.rel !== 'string' || !f.rel) { if (ref) missing.push(ref); return null; }
    const name = carry(f.rel);
    return name ? bi.BUILD_COMMON_VDIR + '/' + name : null;
  };
  const fileOf = (v) => files.find((f) => f.vpath.toLowerCase() === String(v).toLowerCase());
  const lines = [];
  let check = null;
  for (const key of ['States', 'Air', 'Cmd', 'Fx']) {
    let kept = (Array.isArray(c[key]) ? c[key] : []).map(vpathOf).filter(Boolean);
    if (key === 'States' && kept.length) {
      try { check = bi.checkOwnStates(kept, (v) => { const f = fileOf(v); return f ? f.text.toString('latin1') : null; }); } catch (e) { check = null; }
      if (check) {
        kept = check.entries;
        for (const [v, text] of Object.entries(check.texts)) { const f = fileOf(v); if (f) f.text = Buffer.from(text, 'latin1'); }
      }
    }
    if (kept.length) lines.push({ key, value: kept.join(', ') });
  }
  // An effects pack's def names its sprite, animation and sound files beside
  // it, so they go in beside it.
  for (const f of Array.isArray(c.Fx) ? c.Fx : []) {
    if (!f || f.stock || typeof f.rel !== 'string' || !f.rel) continue;
    const def = readIn(f.rel);
    if (!def) continue;
    const dir = path.posix.dirname(def.rel);
    for (const m of def.text.toString('latin1').matchAll(/^\s*(?:sff|air|snd)\s*=\s*([^;\r\n]+)/gim)) {
      const rel = m[1].trim().replace(/"/g, '').replace(/\\/g, '/');
      if (rel) carry(dir === '.' ? rel : dir + '/' + rel);
    }
  }
  // A refused file is listed nowhere now, so it is not served either.
  if (check && check.refused.length) {
    const listed = new Set(lines.flatMap((l) => l.value.split(',').map((s) => s.trim().toLowerCase())));
    for (let i = files.length - 1; i >= 0; i--) {
      if (check.refused.some((r) => r.entry.toLowerCase() === files[i].vpath.toLowerCase()) && !listed.has(files[i].vpath.toLowerCase())) files.splice(i, 1);
    }
  }
  let consts = null;
  const cf = c.Const;
  if (cf && typeof cf === 'object' && !cf.stock && typeof cf.rel === 'string' && cf.rel) {
    const own = readIn(cf.rel);
    if (own) {
      const engineconst = require('./engineconst.js');
      const engineData = bi.engineDataDir();
      let stockText = '';
      try { stockText = engineData ? fs.readFileSync(path.join(engineData, 'common.const'), 'latin1') : ''; } catch (e) { stockText = ''; }
      const mine = engineconst.readConsts(own.text.toString('latin1'));
      const stock = engineconst.readConsts(stockText);
      const changed = [];
      for (const [k, v] of mine.keys) {
        const s = stock.keys.get(k);
        if (!s || engineconst.atof(s.raw) !== engineconst.atof(v.raw)) changed.push(v.name + ' = ' + v.raw);
      }
      if (changed.length) {
        consts = { text: '; The constants this build changes, read from its ' + own.rel + ' where it is.\r\n[Constants]\r\n' + changed.join('\r\n') + '\r\n', set: null };
      }
    }
  }
  if (!lines.length && !files.length && !consts) return null;
  return {
    dir: root, files, lines, debugFont: null, consts, missing,
    refused: check ? check.refused : [], rewrites: check ? check.rewrites : [], report: check ? check.report : [],
  };
}

// EVERY FILE A DEF NAMES, AND EVERY FILE THOSE NAME, looked for in the build
// the way the engine looks for one (common.go SearchFile): beside the def that
// names it, beside the screenpack, at the top of the build and in data/ - each
// with font/ tried under it, or sound/ for music - case-insensitively, as the
// disk spells it (buildimport.resolve). A def found this way is read in turn:
// a screenpack names its fight screen and storyboards, the fight screen its
// fonts and effects, a storyboard its sprites and music, a font its glyph
// file. What is not in the build is left to the engine's own layers, which
// have it or not as they do for any build. Never a character's folder: a
// character is in the view because it was chosen, not because a def named one
// of its files. `skip(rel, section, key)` leaves a line out.
// No video: the browser engine cannot play one (the web build's logo is a
// sprite storyboard for that reason), and the Ikemen Fighting Collection's
// intro names a 231 MB .webm that would only sit in the list.
// A stage's 3D model is a file like any other here: [BGDef] `model =` names a
// .glb or .gltf, [Model] `environment =` an .hdr image, and a .gltf in turn
// names its buffers and images (gltfFiles), which come along with it.
// -> Map vpath -> absolute path; the top folder spelled as the engine's own
// layers spell it (data/, font/, sound/, stages/), the rest as the disk does.
const REF_EXT = 'def|sff|snd|air|fnt|act|pcx|png|ttf|otf|mp3|ogg|wav|flac|midi?|xm|mod|it|s3m|opus|zss|cns|st|cmd|lua|glb|gltf|hdr';
const REF_AUDIO = /\.(mp3|ogg|wav|flac|midi?|xm|mod|it|s3m|opus)$/i;
// The path a value names: up to its comment, before a comma, unquoted, and
// ending at its last file extension - `sound/a b.mp3 80 100` names
// `sound/a b.mp3`, the way a song line carries its volume after it.
function refValue(raw) {
  const s = String(raw).replace(/;.*$/, '').split(',')[0].replace(/"/g, '').replace(/\\/g, '/').trim();
  const re = new RegExp('\\.(?:' + REF_EXT + ')(?=\\s|$)', 'ig');
  let end = -1, m;
  while ((m = re.exec(s))) end = m.index + m[0].length;
  return end > 0 ? s.slice(0, end).trim() : '';
}
function viewRefs(root, starts, opts) {
  const o = opts || {};
  const out = new Map();
  if (!root) return out;
  const bi = require('./buildimport.js');
  const ls = o.ls || bi.lister();
  const skip = o.skip || (() => false);
  const motifDir = o.motifDir || '';
  const top = new Set(['data', 'font', 'sound', 'stages']);
  const vpathOf = (rel) => {
    const parts = rel.split('/');
    if (top.has(parts[0].toLowerCase())) parts[0] = parts[0].toLowerCase();
    return parts.join('/');
  };
  const find = (v, fromDir) => {
    const sub = REF_AUDIO.test(v) ? 'sound' : 'font';
    const bases = [];
    for (const b of [fromDir, motifDir, '', 'data']) if (!bases.includes(b)) bases.push(b);
    for (const base of bases) {
      for (const d of ['', sub]) {
        if (d && v.toLowerCase().startsWith(d + '/')) continue;
        const hit = bi.resolve(root, [base, d, v].filter(Boolean).join('/'), ls);
        if (hit && fileThere(hit.abs)) return hit;
      }
    }
    return null;
  };
  const read = new Set();
  const visit = (rel, depth) => {
    if (read.has(rel.toLowerCase()) || depth > 8) return;
    read.add(rel.toLowerCase());
    let text;
    try {
      const abs = path.join(root, ...rel.split('/'));
      if (fs.statSync(abs).size > 8 * 1024 * 1024) return;   // no def is that big
      text = fs.readFileSync(abs, 'latin1');
    } catch (e) { return; }
    const d = path.posix.dirname(rel);
    const dir = d === '.' ? '' : d;
    let sec = '';
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.replace(/;.*$/, '').trim();
      if (!line) continue;
      const h = /^\[([^\]]*)\]/.exec(line);
      if (h) { sec = h[1].trim().toLowerCase(); continue; }
      const m = /^([^=]+?)\s*=\s*(.+)$/.exec(line);
      if (!m || skip(rel, sec, m[1].trim().toLowerCase())) continue;
      const v = refValue(m[2]);
      if (!v) continue;
      const hit = find(v, dir);
      if (!hit || /^chars\//i.test(hit.rel)) continue;
      out.set(vpathOf(hit.rel), hit.abs);
      if (/\.def$/i.test(hit.rel)) visit(hit.rel, depth + 1);
      if (/\.gltf$/i.test(hit.rel)) {
        const gd = path.posix.dirname(hit.rel);
        for (const f of gltfFiles(hit.abs)) {
          const g = bi.resolve(root, (gd === '.' ? '' : gd + '/') + f, ls);
          if (g && fileThere(g.abs) && !/^chars\//i.test(g.rel)) out.set(vpathOf(g.rel), g.abs);
        }
      }
    }
  };
  for (const s of starts) {
    const hit = s ? bi.resolve(root, s, ls) : null;
    if (!hit || !fileThere(hit.abs) || /^chars\//i.test(hit.rel)) continue;
    out.set(vpathOf(hit.rel), hit.abs);
    visit(hit.rel, 0);
  }
  return out;
}

// The build's files in the view: the screenpack folder, whole; what the
// screenpack's defs name outside it; the chosen stage and what its def names.
// The screenpack's select= is not followed - the view's own select.def
// answers it (build() points the generated copy of the screenpack at it).
function viewFiles(view, roster) {
  const out = new Map();
  const root = view && view.root;
  if (!root) return out;
  const ls = require('./buildimport.js').lister();
  const motif = String(roster.motif || '').replace(/\\/g, '/');
  const m = /^data\/([^/]+)\/.+\.def$/i.exec(motif);
  const motifDir = m ? path.posix.dirname(motif) : '';
  if (m) walkDir(path.join(layout.dir('themes'), m[1]), 'data/' + m[1], out);
  const skipSelect = (rel, sec, key) => rel.toLowerCase() === motif.toLowerCase() && sec === 'files' && key === 'select';
  if (m) for (const [v, a] of viewRefs(root, [motif], { ls, motifDir, skip: skipSelect })) out.set(v, a);
  for (const s of roster.stages || []) {
    for (const [v, a] of viewRefs(root, ['stages/' + s.file], { ls, motifDir })) out.set(v, a);
  }
  return out;
}

// Returns { roster, generated, index } where index maps
// vpath -> absolutePath (or null when the file comes from `generated`).
// In a build open read-only, the match view above.
function build(opts = {}) {
  if (layout.readOnly) {
    const view = externalView();
    const roster = viewRoster(readRoster(), view.match);
    ROSTER_IN_VIEW = roster;
    try { return assemble(opts, roster, view); } finally { ROSTER_IN_VIEW = null; }
  }
  return assemble(opts, readRoster(), null);
}

// `view`: a build open read-only (externalView), or null.
function assemble(opts, roster, view) {
  // Public/redistributable builds (export --public) ship only an allowlisted
  // subset of the roster (roster.publicChars: a list of char folders). The
  // author's Studio and the private site build always see the full roster; only
  // the public export trims it. No list present = ship everything.
  if (opts.publicOnly && Array.isArray(roster.publicChars)) {
    const allow = new Set(roster.publicChars);
    roster.chars = roster.chars.filter((c) => allow.has(c.folder));

    // A public char the private roster no longer carries still ships, sourced
    // from the ENGINE RELEASE. The author's roster is theirs to edit - Kung Fu
    // Man was dropped from it, and because publicChars still named him the
    // itch build silently went from three characters to two. Anything in
    // release/chars/ is the upstream, license-safe copy, so a redistributable
    // can always fall back to it. Names that exist nowhere are skipped with a
    // warning rather than producing a half-empty roster.
    for (const folder of roster.publicChars) {
      if (roster.chars.some((c) => c.folder === folder)) continue;
      const rel = path.join(layout.dir('release'), 'chars', folder);
      if (!fs.existsSync(rel)) {
        console.warn(`  publicChars names "${folder}" but it is in neither the roster nor release/chars - skipped`);
        continue;
      }
      const def = fs.readdirSync(rel).find((f) => f.toLowerCase() === folder.toLowerCase() + '.def')
        || fs.readdirSync(rel).find((f) => /\.def$/i.test(f));
      if (!def) {
        console.warn(`  publicChars "${folder}": no .def in release/chars - skipped`);
        continue;
      }
      roster.chars.push({ folder, select: `${folder}/${def}`, mountAs: folder, __fromRelease: rel });
    }
  }
  // Stages get the same allowlist treatment as chars (roster.publicStages: a
  // list of .def filenames). Without it, stages/ mounted WHOLESALE into every
  // public export, so the author's entire private stage collection shipped to
  // itch - and one 94.7 MB stage sprite file was 54% of the whole download
  // (field-hit 2026-08-11). Characters had publicChars from the start; stages
  // never got the equivalent. No list present = ship everything, as before.
  if (opts.publicOnly && Array.isArray(roster.publicStages)) {
    const allow = new Set(roster.publicStages.map((s) => String(s).toLowerCase()));
    const kept = roster.stages.filter((s) => allow.has(String(s.file).toLowerCase()));
    for (const name of allow) {
      if (!kept.some((s) => String(s.file).toLowerCase() === name)) {
        console.warn(`  publicStages names "${name}" but the roster has no such stage - skipped`);
      }
    }
    // Never ship a stageless build: the engine has nothing to fight on, and a
    // typo in the list must not produce one silently.
    if (!kept.length) {
      console.warn('  publicStages matched no roster stage - shipping every stage instead');
    } else {
      roster.stages = kept;
      // A character can pin a starting stage. Pinning one we just dropped
      // fails at load, so unpin rather than ship a broken reference.
      for (const c of roster.chars) {
        if (c.stage && !allow.has(String(c.stage).toLowerCase())) delete c.stage;
      }
      opts.__publicStageKeep = stageKeepFilter(kept);
    }
  }
  // Public builds also drop the site's personal menu music and ship only the
  // sound files something public actually references (stage/char music
  // assignments or the default track) - the owner's own songs stay private.
  // This runs AFTER the stage filter on purpose: a dropped stage's soundtrack
  // is no longer referenced by anything, so it drops out here for free.
  if (opts.publicOnly) {
    roster.titleMusic = '';
    roster.selectMusic = '';
    const wanted = new Set();
    const want = (t) => { if (t) wanted.add(String(t).toLowerCase()); };
    want(roster.music);
    for (const s of roster.stages || []) want(s.music);
    for (const c of roster.chars) want(c.music);
    //
    // not to anybody's private song list. The two lines above clear the
    // OWNER's picks; what the pack itself scored its title, versus and victory
    // screens with still has to be in the build, or those screens go silent.
    //
    // This was free until a screenpack could arrive with its music somewhere
    // else. A pack installed by hand keeps its own copies inside the theme,
    // and themes/ walks unfiltered - but the build import carries every track
    // the motif names into the shared music library, repoints the pack's own
    // [Music] lines at sound/<name> and deletes the duplicate inside the
    // theme. Filtering the library by the roster alone then dropped every file
    // those lines name: measured on an imported bundle, four menu screens
    // playing before and none after.
    for (const t of motifOwnMusic(roster)) want(t);
    opts.__publicMusicKeep = wanted;
  }
  const generated = makeGeneratedFiles(roster, view);

  // Scene Viewer mod: generated from the current roster's giver commands.
  // Required lazily - modlib depends on this module, so a top-level require
  // would be circular; at build() time both modules are fully loaded.
  // It now speaks V2's Lua API (gameMode/connected/mapSet/roundState and the
  // textImg* sprites, which replaced v1's text:create helper), so both engines
  // get it. Its lock-on half needs the map(_sv_target) hook in
  // data/training.zss to hold facing. It is the Training sandbox's, which the
  // Mods tab can switch off ('training'): then it is not generated, and the
  // desktop export leaves out the sandbox's other files too.
  try {
    if (addOnOn(roster, 'training')) {
      const { buildSceneViewerLua } = require('./modlib');
      generated[modmgr().VPATHS.sceneViewer] = Buffer.from(buildSceneViewerLua());
    }
  } catch (e) {
    console.warn('scene viewer mod generation failed:', e.message);
  }

  // Team play mod (teamplay.js): in every build the CPU team starts at the
  // player's team size; in a build whose add004 tag system is on, a human side
  // also drives the partner it tags in. The desktop export ships this same text.
  // Not when the Mods tab switched it off ('team-play').
  try {
    if (addOnOn(roster, 'team-play')) {
      const teamplay = require('./teamplay');
      const bi = require('./buildimport');
      const statesFile = bi.buildStates() ? bi.buildStatesPath() : null;
      const tag = teamplay.add004TagForBundle(statesFile);
      generated[teamplay.TEAM_PLAY_VPATH] = Buffer.from(teamplay.teamPlayLua({ add004Tag: tag.tag }), 'latin1');
    }
  } catch (e) {
    console.warn('team play mod generation failed:', e.message);
  }

  // The Training frame meter (addons/framebar): off unless the Mods tab
  // switched it on ('framebar', roster.modsOn). Shipped as it is; the desktop
  // export carries the same file.
  try {
    if (addOnOn(roster, 'framebar')) {
      const mm = modmgr();
      generated[mm.VPATHS.framebar] = fs.readFileSync(mm.FRAMEBAR_SOURCE);
    }
  } catch (e) {
    console.warn('frame meter not added:', e.message);
  }

  // Select-screen announcer (selectann.js): only in a bundle whose build import
  // carried mugenhook's cursor table, so every other build is unchanged. The
  // desktop export ships this same text. The table is by grid cell, so a
  // public build whose grid was cut down to roster.publicChars goes without,
  // and so does a bundle whose Mods tab switched it off ('select-announcer').
  try {
    const sa = require('./selectann.js');
    const sameGrid = !opts.publicOnly || roster.chars.length === (readRoster().chars || []).length;
    const lua = sameGrid && addOnOn(roster, 'select-announcer') ? sa.luaForRoster(roster) : null;
    if (lua) generated[sa.SELECT_ANN_VPATH] = Buffer.from(lua, 'latin1');
  } catch (e) {
    console.warn('select announcer mod generation failed:', e.message);
  }

  // add004's round call, timed as in MUGEN (buildimport.add004RoundCall): the
  // copy in data/build.cns is changed by buildStates(); the copy a screenpack
  // folder carries - which answers `stcommon = common1.cns` - is changed here.
  // The desktop export copies the screenpack through this same layer.
  try {
    const bi = require('./buildimport');
    const folder = String(roster.motif || DEFAULT_MOTIF).replace(/^data\//i, '').split('/')[0];
    if (folder && !/\.def$/i.test(folder)) {
      Object.assign(generated, bi.add004RoundCallThemeFiles(path.join(layout.dir('themes'), folder), 'data/' + folder + '/'));
      // A lifebar from the library replaces add004's own HUD: its lifebar,
      // power bar, combo counter, round call and KO call are switched off in
      // the copy of its common states the build ships (lifebars.js).
      Object.assign(generated, require('./lifebars.js').add004ThemeFiles(roster, path.join(layout.dir('themes'), folder), 'data/' + folder + '/', generated));
    }
  } catch (e) {
    console.warn('round call timing failed:', e.message);
  }

  // Web build marker: main.lua checks it to route JOIN GAME straight to the
  // WebRTC connect (webjoin) instead of the server list. Kept separate from the
  // Scene Viewer so the marker survives even if mod generation ever fails.
  // Always: the Mods tab lists it, locked ('webflags').
  generated[modmgr().VPATHS.webflags] = Buffer.from(
    '-- generated: web build marker\nmain.webBuild = true\n');

  const map = new Map();
  // Later walks OVERRIDE earlier ones (map.set), so order = priority,
  // lowest first:
  //   release (v1 pack) < release-v2 (V2 bundle assets) < engine repo
  //   < PROJECT CONTENT < generated files.
  // Project content must beat the engine layers: the V2 bundle ships its
  // own stages/kfm.def, which used to shadow the user's stage of the same
  // name (wrong art, and its bgmusic pointed at a missing .mid).

  // Layer 4: official release screenpack (data/system.def + system.sff,
  // fight.def, fonts) - the menu system the master engine is tested against.
  walkDir(path.join(layout.dir('release'), 'data'), 'data', map, notWork);
  walkDir(path.join(layout.dir('release'), 'font'), 'font', map);
  // Layer 3b (V2 only): assets from the V2 nightly release bundle that the
  // source repo doesn't carry - data/gofx effects, the ikemen1 motif,
  // fight.def/fightfx, default stages. Overrides same-named v1 files.
  if (process.env.IKEMEN_V2) {
    walkDir(path.join(layout.dir('release-v2'), 'data'), 'data', map, notWork);
    walkDir(path.join(layout.dir('release-v2'), 'font'), 'font', map);
    // The V2 bundle's two 3D demo stages (stage3d, stage3d_outline) stay out,
    // models and all: 24 MB that exist to show the engine's model pipeline
    // off, which no roster names. They were first dropped because the July
    // web port had stubbed that pipeline (a scope cut in render_webgl.go, not
    // something WebGL2 cannot do); the web renderer draws models now, and
    // these stay out for their size. A user's own model stage ships its model
    //
    walkDir(path.join(layout.dir('release-v2'), 'stages'), 'stages', map,
      (vpath) => !MODEL_FILE.test(vpath) && !/(^|\/)stage3d[^/]*$/i.test(vpath));
  }
  // Layer 3: engine repo - Lua scripts, engine data, default fonts (version-
  // matched to the wasm binary; overrides same-named files from the release)
  walkDir(path.join(IKEMEN_SRC, 'data'), 'data', map, notWork);
  walkDir(path.join(IKEMEN_SRC, 'external'), 'external', map);
  for (const [v, a] of (() => { const m = new Map(); walkDir(path.join(IKEMEN_SRC, 'font'), 'font', m); return m; })()) {
    if (!map.has(v)) map.set(v, a);
  }
  // Layer 2: project content - the user's stages, music, themes and characters
  // always win over engine/bundle files of the same name.
  // In a build open read-only, the view's own files of it (viewFiles) take the
  //
  if (view) for (const [v, a] of viewFiles(view, roster)) map.set(v, a);
  if (!view) walkDir(layout.dir('stages'), 'stages', map, (vpath) =>
    (!opts.__publicStageKeep || opts.__publicStageKeep.has(vpath.toLowerCase())));
  if (!view) walkDir(layout.dir('music'), 'sound', map,
    opts.__publicMusicKeep ? (vpath) => opts.__publicMusicKeep.has(vpath.toLowerCase()) : undefined);
  // Each themes/<name>/ mounts at data/<name>/, which is where the engine looks
  // for a motif - so a dropped screenpack is selectable exactly like a built-in,
  // and a theme named after one deliberately replaces it.
  //
  // A BUILD SHIPS ONE SCREENPACK, not the shelf. The Studio needs every
  // installed pack in the index so it can list and preview them, but an EXPORT
  // has a motif and cannot switch: packing the rest is dead weight that the
  // player downloads and can never see. Measured on a working install: 171MB
  // for the pack in use and 399MB for three sitting behind it.
  //
  // `themesKeep` is set by the exporter only, so the Studio is unaffected. A
  // pack whose folder is the motif's own is always kept, even if the motif
  // resolves elsewhere, so a half-configured roster cannot drop the theme it
  // is pointing at.
  if (!view && fs.existsSync(layout.dir('themes'))) {
    const keep = opts.__themesKeep || null;
    for (const e of fs.readdirSync(layout.dir('themes'), { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      if (keep && !keep.has(e.name.toLowerCase())) continue;
      // A pack with a manifest (themeopts.js) leaves out what it only keeps for
      // the Studio: the manifest, and its own state files the build's [Common]
      // lines do not name. No manifest, no filter: the folder ships whole.
      let sf = null;
      try { sf = require('./themeopts.js').shipFilter(path.join(layout.dir('themes'), e.name), roster); } catch (err) { sf = null; }
      const pre = 'data/' + e.name + '/';
      walkDir(path.join(layout.dir('themes'), e.name), 'data/' + e.name, map, sf ? (vpath) => sf(vpath.slice(pre.length)) : undefined);
    }
  }
  // A REPLACED startup logo. Content/<bundle>/logo/ (modlib.addLogo) holds a
  // storyboard .def and its art; it lands in the active motif's folder and,
  // walking after the screenpack itself, wins over the screenpack's own
  //
  // the screenpack's own logo, which for the web build is the sprite one in
  // release-v2 (a browser cannot play the engine's ik_logo.webm).
  const LOGO_DIR = layout.dir('logo');
  const motifFolder = String(roster.motif || DEFAULT_MOTIF).replace(/^data\//, '').split('/')[0];
  let logoDef = null;
  if (fs.existsSync(LOGO_DIR) && motifFolder && !/\.def$/i.test(motifFolder)) {
    const files = fs.readdirSync(LOGO_DIR).filter((f) => fs.statSync(path.join(LOGO_DIR, f)).isFile());
    logoDef = files.find((f) => /\.def$/i.test(f)) || null;
    if (logoDef) walkDir(LOGO_DIR, 'data/' + motifFolder, map);
  }
  // THE LIFEBAR MIX (lifebars.js): a lifebar from the bundle's library, and
  // hit sparks or sounds from another source, laid into the active motif's
  // folder - studio-lifebar/ for the lifebar, studio-parts/ beside the def for
  // the rest. The composed def itself arrives through makeGeneratedFiles
  //
  // it. The desktop export lays the same files at the same paths.
  let lifebarMix = null;
  try { lifebarMix = require('./lifebars.js').mounts(roster); } catch (e) { console.warn('lifebar mix failed:', e.message); lifebarMix = null; }
  if (lifebarMix) for (const f of lifebarMix.files) map.set(f.vpath, f.abs);
  const charMounts = mountNames(roster);
  const mountedChars = [];   // what the sprite-file repair at the end walks
  for (const c of roster.chars) {
    // skipslot/randomselect placeholders occupy a CELL but are not characters:
    // no folder, no files to mount. They exist only for buildSelectDef.
    if (c.kind === 'skip' || c.kind === 'random' || !c.folder) continue;
    // __fromRelease: a publicChars entry the private roster no longer has,
    // mounted from release/chars/ instead of cache/ (see the publicOnly
    // block above).
    const charDir = c.__fromRelease || path.join(layout.dir('cache'), c.folder);
    // A second .def for a folder already mounted adds a select.def line and
    // nothing else - the files are the same files.
    if (!c.__fromRelease && !ownsMount(c, charMounts)) continue;
    const defNames = c.__fromRelease
      ? [c.select.split('/').slice(1).join('/')]
      : rosteredDefNames(roster, c.folder);
    walkDir(charDir, 'chars/' + c.mountAs, map, charKeepFilter(charDir, defNames) || undefined);
    mountedChars.push({ charDir, mountAs: c.mountAs, defNames, rosterChar: c });
  }
  // Menu music: roster.titleMusic / roster.selectMusic repoint the active
  // motif's [Music] title.bgm / select.bgm lines at an uploaded track. The
  // patched def ships as a generated file, so the motif on disk never
  // changes and clearing the setting restores the original on next build.
  // (The stock motif references sound/Title.mp3 + sound/Select.mp3, which
  // were never shipped - menus were always silently songless.)
  // Online identity is opt-in per deployment: roster.onlineName turns on the
  // PLAYER NAME entry in the NETWORK menu. It is deliberately NOT part of the
  // public/kit build - a shared queue of differently-built clients would only
  //
  // OPT-IN, NOT OPT-OUT. This used to read `!!roster.onlineName &&
  // !opts.publicOnly`, so any caller that passed no options got the private
  //
  //
  // YOUR RANK / PLAYER NAME in its system.def - dead items, since a stock
  // engine has no handlers for them.
  //
  // `publicOnly` was the wrong lever to reach for as the fix: it ALSO trims the
  // roster to roster.publicChars, trims stages to publicStages, and clears
  //
  // quietly shrunk the desktop roster and dropped its menu music.
  //
  // So the private surface now needs asking for by name. Callers that should
  // have it: export.js (a non-public Website export - the author's own site,
  // or a host's from a shareable copy, whose roster ticks Online menu) and
  // server.js (that host's own Studio). Everything else - desktop.js, the kit,
  // and any build path written later - is safe by omission.
  const wantOnlineName = !!roster.onlineName && opts.privateMenu === true && !opts.publicOnly;

  // The online menu (netmenu.js): PRESS N FOR ONLINE on every screenpack's
  // title, and a NETWORK box the screenpack's styling cannot hide. The
  // desktop export ships the same text; its online items only where
  // wantOnlineName (above) allows them. Neither it nor its font when the Mods
  // tab switched it off ('net-menu').
  try {
    if (addOnOn(roster, 'net-menu')) {
      const nm = require('./netmenu.js');
      generated[nm.NET_MENU_VPATH] = Buffer.from(nm.netMenuLua({ online: wantOnlineName }), 'latin1');
      // Its font: the engine's 6x9 under a name no screenpack can shadow.
      generated[nm.NET_MENU_FONT_VPATH] = Buffer.from(nm.netMenuFontDef(), 'latin1');
    }
  } catch (e) {
    console.warn('online menu mod generation failed:', e.message);
  }

  // The build's own copy of a screenpack's system.def (motifcompat.js), so
  // both exports get it - the desktop export ships the generated motif: a pack
  // whose select faces are per-member keys 1.0 does not read (Infinite Legacy
  // X), a pack without the hidden menu a lobby opens (every MUGEN-era pack),
  // and a pack carrying the NETWORK lines an older install grafted.
  const motifCompat = require('./motifcompat.js');
  const needsCompat = (() => {
    if (!roster.motif) return false;
    const want = String(roster.motif).toLowerCase();
    const k = map.has(roster.motif) ? roster.motif : [...map.keys()].find((x) => x.toLowerCase() === want);
    const p = k ? map.get(k) : null;
    if (!p || typeof p !== 'string') return false;
    try {
      const t = fs.readFileSync(p, 'latin1');
      return motifCompat.needsMemberFaces(t) || motifCompat.needsServerGroup(t) || motifCompat.hasNetworkGraft(t);
    } catch (e) { return false; }
  })();
  // roster.siteVersion is a reason of its own: the F1 box's version is stamped
  //
  // name, so without it the engine's screenpack was never regenerated and the
  // box said what the file said - "(v1.9)" in the 2.0 itch cut.
  if (roster.titleMusic || roster.selectMusic || wantOnlineName || logoDef || (lifebarMix && lifebarMix.fightKey) || needsCompat || view
    || roster.siteVersion) {
    // The motif config.ini names, matched without regard to case (a roster's
    // `data/<name>/system.def` may be spelled differently from the file on
    // disk, which is how the map is keyed). Never a different motif: a fight
    // key or menu music written into one the build does not load is lost.
    const wantMotif = String(roster.motif || '').toLowerCase();
    const motif = !roster.motif ? DEFAULT_MOTIF
      : (map.has(roster.motif) ? roster.motif : ([...map.keys()].find((k) => k.toLowerCase() === wantMotif) || null));
    const abs = motif ? map.get(motif) : null;
    if (abs) {
      let def = fs.readFileSync(abs, 'latin1');
      const set = (key, file) => {
        if (!file) return;
        const re = new RegExp('^(\\s*' + key + '\\s*=)[^\\r\\n]*', 'mi');
        //
        //
        // patterns.
        if (re.test(def)) def = def.replace(re, (m, k) => k + ' ' + file);
        else def = def.replace(/^(\s*\[Music\]\s*)$/mi, (m, k) => k + '\n' + key.replace(/\\/g, '') + ' = ' + file);
      };
      set('title\\.bgm', roster.titleMusic);
      set('select\\.bgm', roster.selectMusic);
      // Point the boot storyboard at a replaced logo. ikemen1 declares
      // logo.storyboard under [Files]; a third-party screenpack may not, in
      // which case it is added there rather than under [Music] (which is what
      // `set` above would do for a key it cannot find).
      if (logoDef) {
        const lre = /^([ \t]*logo\.storyboard[ \t]*=)[^\r\n]*/mi;
        if (lre.test(def)) def = def.replace(lre, (m, k) => k + ' ' + logoDef);
        else def = def.replace(/^([ \t]*\[Files\][^\r\n]*)/mi, (m, k) => k + '\nlogo.storyboard = ' + logoDef);
      }
      // A lifebar from the library: the motif's own [Files] `fight` points at
      // it (lifebars.setMotifFight edits the key the engine reads, not a
      // commented-out line like add004 packs carry).
      if (lifebarMix && lifebarMix.fightKey) def = require('./lifebars.js').setMotifFight(def, lifebarMix.fightKey);
      // The graft is dropped first, so the server group step sees the pack as
      //
      // GAME line gone they have no anchor in a MUGEN pack, and the online
      // menu add-on shows them there instead.
      if (needsCompat) def = motifCompat.serverGroup(motifCompat.dropNetworkGraft(motifCompat.memberFaces(def)));

      //
      //
      // behavior, which is the engine's documented extension point ("Can be
      //
      // flows - it's the "just play someone" button.
      // MENU ORDER (2026-08-29, set by the author):
      //
      //   HOST GAME / JOIN GAME                      <- primitive private-session
      //   PLAYER NAME / BACK                          options, kept together
      //
      // HOST GAME is MOVED, not copied: the motif declares it above JOIN GAME,
      // so its original line is cut and re-inserted next to JOIN. The line is
      // reused verbatim rather than rewritten, so a screenpack that renamed it
      // keeps its own label.
      if (wantOnlineName && !/menunetwork.playername\s*=/i.test(def)) {
        const hostLine = /^[ \t]*menu\.itemname\.menunetwork\.serverhost\s*=[^\r\n]*$/mi;
        const hostMatch = def.match(hostLine);
        const host = hostMatch ? hostMatch[0].trim() : 'menu.itemname.menunetwork.serverhost = HOST GAME';
        // NO SENTINEL. This used to mark the old HOST GAME line with \x00CUT\x00
        // and delete the marker afterwards, and the marker SHIPPED: these files
        // are CRLF, JavaScript's `m` flag treats a lone \r as a line boundary
        // too, so `^` matched BETWEEN the \r and the \n and the anchor's `\s*`
        // then ate the \n. That left the sentinel followed by a bare \r, which
        // the removal regex - needing \r?\n after it - could never match.
        //
        // The engine reads the result splitting on \n, so it saw the key
        //
        //
        // parser (studio-go/def). Removing the line outright, before inserting,
        // has no marker to leak; `[ \t]*` in the anchor keeps it on one line.
        const anchor = /^([ \t]*menu\.itemname\.menunetwork\.serverjoin\s*=[^\r\n]*)$/mi;
        if (anchor.test(def)) {
          //
          // Taken WITH its line terminator, so no blank line is left behind.
          if (hostMatch) {
            def = def.replace(/^[ \t]*menu\.itemname\.menunetwork\.serverhost\s*=[^\r\n]*\r?\n?/mi, '');
          }
          def = def.replace(anchor,
            'menu.itemname.menunetwork.casualmatch = CASUAL MATCH\n' +
            'menu.itemname.menunetwork.rankedmatch = RANKED MATCH\n' +
            //
            'menu.itemname.menunetwork.yourrank = YOUR RANK\n' +
            host + '\n$1\n' +
            'menu.itemname.menunetwork.playername = PLAYER NAME');
        }
        // No JOIN anchor: nothing was removed, so HOST GAME is still where the
        // screenpack put it and the menu is simply left alone.
      }
      // [Infobox Text] - the F1 box - opens with "Welcome to <title>! (<version>)".
      // The version is stamped from roster.siteVersion so it can never lag the
      // boot page again: v1.9 was cut with the file still saying v1.8. A blank
      // siteVersion (kit, tester copies) leaves the line alone - make-kit
      // rewrites the whole block for the kit. First match only; `[ \t]*` and
      // `[^\r\n(]*` keep it on one CRLF line (see the sentinel note above).
      if (roster.siteVersion) {
        def = def.replace(/^([ \t]*Welcome to [^\r\n(]*\()v?\d[^)\r\n]*(\))/mi, (m, a, b) => a + roster.siteVersion + b);
      }
      // A build open read-only: its screenpack's select= names the build's
      // own roster file - the whole roster, none of it in the view - so the
      // copy the view serves names the view's select.def instead (as an
      // installed theme's does, modlib.patchInstalledMotif). The value only,
      // up to any comment, on its own line.
      if (view) def = def.replace(/^([ \t]*select[ \t]*=[ \t]*)[^\r\n;]*/mi, '$1data/select.def');
      generated[motif] = Buffer.from(def, 'latin1');
    }
  }

  //
  // a mod: its post-connect sequence called enterSyncedNetplayMenu() (until
  // queue matches went straight to VERSUS) and still calls
  // showSessionWarning(), `local function`s in main.lua (lines
  // ~1854/~1189) - invisible to any external chunk. Shipping the handler as
  // a mod crashed with "attempt to call a non-function object" the moment a
  // queue match CONNECTED (field-hit twice 2026-08-10; transport-level tests
  // never reach this line, only a real two-player session does). The VFS's
  // generated layer overrides any packed file, so patch a clone of the
  // engine's own 'webjoin' handler - same body, queue address - into the
  // t_itemname table where those locals are captured as upvalues.
  if (wantOnlineName) {
    const mlAbs = map.get('external/script/main.lua');
    if (mlAbs) {
      let ml = fs.readFileSync(mlAbs, 'latin1');
      const mlAnchor = /^(\t--WEB JOIN \(WebRTC[^\r\n]*\r?\n)/m;
      if (!ml.includes("'rankedmatch'") && mlAnchor.test(ml)) {
        // The match mode both queues play (queuemode.js): set around VERSUS,
        //
        const queuemode = require('./queuemode');
        const queueSet = '\t\t\t\t' + queuemode.handlerSet(roster.queueMode);
        const queueClear = '\t\t\t\t' + queuemode.handlerClear;
        const handler = [
          "\t--RANKED MATCH (auto-pairing queue; injected by the web build)",
          "\t['rankedmatch'] = function(t, item)",
          "\t\tmain.f_waitForPreloads(true)",
          "\t\tlocal doneSnd = motif[main.group].cursor.done.snd.serverconnect or motif[main.group].cursor.done.snd.default",
          "\t\tsndPlay(motif.Snd, doneSnd[1], doneSnd[2])",
          '\t\thook.run("main.t_itemname", t, item)',
          "\t\tif main.f_connect('webrtc-queue', 'Ranked match') then",
          "\t\t\tif synchronize() then",
          "\t\t\t\t-- RANKED IS 2P VERSUS ONLY, so there is nothing to choose: both",
          "\t\t\t\t-- peers go straight to character select. The engine's synced",
          "\t\t\t\t-- lobby menu (main.menu.submenu.server, opened by",
          "\t\t\t\t-- enterSyncedNetplayMenu) is skipped: it is drawn in the",
          "\t\t\t\t-- screenpack's title menu style, and a pack whose title menu is",
          "\t\t\t\t-- art (CvS Evolution Rev 2 draws every item as a whole-screen",
          "\t\t\t\t-- glyph) showed it as a frozen title screen. These are the calls",
          "\t\t\t\t-- that menu makes when VERSUS 2P is picked, in its order; both",
          "\t\t\t\t-- peers run them on the same frame, so nothing new is synced.",
          "\t\t\t\t-- main.queueTeam is the Studio's Match mode for both queues",
          "\t\t\t\t-- (queuemode.js): 1 vs 1 by default, or one team mode at a fixed",
          "\t\t\t\t-- size, applied by the online mod's select-screen hook.",
          "\t\t\t\t-- start.f_selectMode loops match after match and returns when a",
          "\t\t\t\t-- player leaves character select or the set is decided (its",
          "\t\t\t\t-- wrapper below), and the session then ends here, as EXIT did.",
          "\t\t\t\tmain.f_clearShuffleTables()",
          "\t\t\t\tmain.f_default()",
          queueSet,
          "\t\t\t\tlocal versus = main.t_itemname.netplayversus({{itemname = 'netplayversus', displayname = 'VERSUS 2P'}}, 1)",
          "\t\t\t\tmain.f_unlock(false)",
          "\t\t\t\tif versus ~= nil then versus() end",
          queueClear,
          "\t\t\t\tmain.f_default()",
          "\t\t\t\tmain.f_unlock(false)",
          "\t\t\tend",
          "\t\t\treplayStop()",
          "\t\t\texitNetPlay()",
          "\t\t\texitReplay()",
          "\t\t\t-- Set result page. AFTER exitNetPlay(), so the connection is",
          "\t\t\t-- already down and this screen is local-only - it may block on",
          "\t\t\t-- input without desyncing anyone. Guarded because the mod that",
          "\t\t\t-- defines it is absent from non-ranked builds.",
          "\t\t\tif rankedSet ~= nil and rankedSet.f_result ~= nil then",
          "\t\t\t\tpcall(rankedSet.f_result)",
          "\t\t\tend",
          "\t\t\tshowSessionWarning()",
          "\t\tend",
          "\t\t-- LOAD-BEARING. The connect, a canceled connection and the set",
          "\t\t-- exit can leave esc set; left armed it falls through the network",
          "\t\t-- submenu's 'if not bool_main or esc() then break' into the MAIN",
          "\t\t-- menu, whose loop breaks on the same line - i.e. it would quit",
          "\t\t-- the game.",
          "\t\tesc(false)",
          "\t\treturn nil",
          "\tend,",
          "",
          "\t--CASUAL MATCH (auto-pairing queue, UNRATED; injected by the web build)",
          "\t--",
          "\t-- Same pairing service as RANKED and the same transport, so it inherits",
          "\t-- every desync fix automatically - those live in the engine and the",
          "\t-- netcode, not in ranked. What it does NOT inherit is the bookkeeping:",
          "\t-- nothing is reported, nothing is rated, nothing is written down, and",
          "\t-- there is no set limit. It runs until somebody leaves.",
          "\t--",
          "\t-- It needs no ranked opt-out of its own. The server buckets casual into a",
          "\t-- separate queue and marks the pairing unrated, and the client then",
          "\t-- withholds the pairing token - which is the single thing that arms both",
          "\t-- the set limiter and the report latch. No token, no set, no report.",
          "\t['casualmatch'] = function(t, item)",
          "\t\tmain.f_waitForPreloads(true)",
          "\t\tlocal doneSnd = motif[main.group].cursor.done.snd.serverconnect or motif[main.group].cursor.done.snd.default",
          "\t\tsndPlay(motif.Snd, doneSnd[1], doneSnd[2])",
          "\t\thook.run(\"main.t_itemname\", t, item)",
          "\t\tif main.f_connect('webrtc-casual', 'Casual match') then",
          "\t\t\tif synchronize() then",
          "\t\t\t\t-- 2P VERSUS ONLY, as ranked: straight to character select, no",
          "\t\t\t\t-- lobby menu (see the ranked handler). The session ends when a",
          "\t\t\t\t-- player leaves character select.",
          "\t\t\t\tmain.f_clearShuffleTables()",
          "\t\t\t\tmain.f_default()",
          queueSet,
          "\t\t\t\tlocal versus = main.t_itemname.netplayversus({{itemname = 'netplayversus', displayname = 'VERSUS 2P'}}, 1)",
          "\t\t\t\tmain.f_unlock(false)",
          "\t\t\t\tif versus ~= nil then versus() end",
          queueClear,
          "\t\t\t\tmain.f_default()",
          "\t\t\t\tmain.f_unlock(false)",
          "\t\t\tend",
          "\t\t\treplayStop()",
          "\t\t\texitNetPlay()",
          "\t\t\texitReplay()",
          "\t\t\t-- No result page: there is no set, no rating and no record to show.",
          "\t\t\tshowSessionWarning()",
          "\t\tend",
          "\t\t-- LOAD-BEARING, exactly as in the ranked handler: a leftover esc flag",
          "\t\t-- cascades out of the network submenu into the main menu, whose loop",
          "\t\t-- breaks on the same condition - i.e. it would QUIT THE GAME.",
          "\t\tesc(false)",
          "\t\treturn nil",
          "\tend,",
          "",
          "\t--YOUR RANK (injected by the web build)",
          "\t--",
          "\t-- Local-only: no netplay, nothing reported, nothing rated. Reads a",
          "\t-- CACHED standing the page refreshes in the background, so it never",
          "\t-- blocks the menu on a fetch. That matters because main.f_warning bakes",
          "\t-- its text ONCE before its input loop - a screen that waited would either",
          "\t-- freeze the menu or print 'loading' forever, the exact trap the post-set",
          "\t-- result page fell into.",
          "\t--",
          "\t-- Empty means the page has nothing yet: no online name, no leaderboard",
          "\t-- configured, or the first fetch has not landed. Say which, rather than",
          "\t-- showing a blank screen.",
          "\t['yourrank'] = function(t, item)",
          "\t\thook.run(\"main.t_itemname\", t, item)",
          "\t\tlocal ok, txt = pcall(netRankStatus)",
          "\t\tif not ok or txt == nil then txt = '' end",
          "\t\tif txt == '' then",
          "\t\t\ttxt = 'No standing yet.\\n\\nSet NETWORK > PLAYER NAME, play a ranked match,\\nthen check back.'",
          "\t\tend",
          "\t\t-- f_warning's DEFAULT title sprite literally reads 'WARNING', which is",
          "\t\t-- wrong for a standings screen. Passing a borrowed sprite instead",
          "\t\t-- suppresses it.",
          "\t\t--",
          "\t\t-- The HEADING still has to live in the BODY text. The post-set result",
          "\t\t-- page can re-text this sprite and have it stick, because it runs AFTER",
          "\t\t-- exitNetPlay() with no menu live. This handler runs from INSIDE the",
          "\t\t-- network menu, whose loop re-texts that same sprite every frame - so",
          "\t\t-- anything written to it is overwritten before it draws.",
          "\t\t--",
          "\t\t-- Field-checked 2026-08-31: WARNING vanished, the title never appeared.",
          "\t\t-- Do NOT 'fix' this by trusting textImgSetText from a menu handler.",
          "\t\tlocal sec, bg = motif[main.group], motif[main.background]",
          "\t\tlocal tsd = (sec ~= nil and sec.title ~= nil) and sec.title.TextSpriteData or nil",
          "\t\tlocal titled = false",
          "\t\tif tsd ~= nil then",
          "\t\t\ttitled = pcall(function()",
          "\t\t\t\ttextImgReset(tsd)",
          "\t\t\t\ttextImgSetText(tsd, 'YOUR RANK')",
          "\t\t\tend)",
          "\t\tend",
          "\t\tif titled then",
          "\t\t\tpcall(main.f_warning, 'YOUR RANK\\n\\n' .. txt, sec, bg, nil, tsd)",
          "\t\telse",
          "\t\t\tpcall(main.f_warning, 'YOUR RANK\\n\\n' .. txt, sec, bg)",
          "\t\tend",
          "\t\t-- Same esc hygiene as the other handlers: a leftover flag cascades out",
          "\t\t-- of the network submenu into the main menu and QUITS THE GAME.",
          "\t\tesc(false)",
          "\t\treturn nil",
          "\tend,",
          "",
        ].join('\n');
        ml = ml.replace(mlAnchor, handler.replace(/\$/g, '$$$$') + '$1');
        generated['external/script/main.lua'] = Buffer.from(ml, 'latin1');
      } else if (!ml.includes("'rankedmatch'")) {
        console.warn('rankedmatch: webjoin anchor not found in main.lua - RANKED MATCH will be a dead menu item');
      }
    }
  }

  // The PLAYER NAME handler. Uses the engine's own on-screen text input
  // (main.f_drawInput, the same one NEW ADDRESS uses) and stores the result
  // with the engine's own settings system, so it lands in save/config.ini -
  // which vfs.js mirrors into localStorage. That makes it browser-stored
  //
  if (wantOnlineName) {
    // The plates' font (ikemen1's Menu2Small) under names no screenpack has:
    // only ikemen1's own folder carries it, so under any other pack the
    //
    try {
      const fdir = path.join(layout.dir('release-v2'), 'data', 'ikemen1', 'fonts');
      const def = fs.readFileSync(path.join(fdir, 'Menu2Small.def'), 'latin1');
      const sff = fs.readFileSync(path.join(fdir, 'Menu2Small.sff'));
      if (!/^\s*File\s*=\s*Menu2Small\.sff\s*$/mi.test(def)) throw new Error('Menu2Small.def names another glyph file');
      generated['font/net-names.def'] = Buffer.from(def.replace(/^(\s*File\s*=\s*)Menu2Small\.sff(\s*)$/mi, '$1net-names.sff$2'), 'latin1');
      generated['font/net-names.sff'] = sff;
    } catch (e) {
      console.warn('online name plates: no font copy (' + e.message + ') - they use ikemen1\'s path');
    }
    generated[modmgr().VPATHS.onlineName] = Buffer.from(`
-- generated: online player name (NETWORK > PLAYER NAME)
local MAXLEN = 12

-- gameOption() RAISES on a key the config never declared, and an uncaught
-- error here exits the whole engine (it took the game down on a config that
-- predated this setting). vfs.js now guarantees the key exists, but a menu
-- item must never be able to kill the engine, so read defensively regardless.
function main.f_onlineName()
	local ok, n = pcall(gameOption, 'Netplay.PlayerName')
	if not ok or n == nil then return '' end
	return tostring(n)
end

-- ---------------------------------------------------------------------------
-- Online name plates: each side's ONLINE name drawn under the character name
-- in the lifebar. P1 blue (left), P2 orange (right).
--
-- Positions come from the motif's [Name] section (fight.def: p1.pos = 13,145
-- left-aligned, p2.pos = 1267,145 right-aligned, in a 1280x720 localcoord),
-- so the plate tracks the character name instead of being hardcoded to one
-- screenpack. Everything is derived from motif.info.localcoord.
--
-- main.onlineNames is the seam the netplay layer will fill once matchmaking
-- exists: p1 is this machine's player, p2 is the remote one. Until then p2
-- can be set by hand to simulate an online match.
main.onlineNames = main.onlineNames or { p1 = nil, p2 = nil }

-- Geometry MUST be read lazily, on first draw. At module load (boot) the motif
-- is not loaded yet, so motif.info.localcoord falls back to 320x240. Same class
-- of trap as the Scene Viewer's sprite creation: nothing about the screen is
-- real until the first frame draws.
--
-- In-fight, Lua sprites in a widescreen localcoord render mapped to the
-- CENTRAL 4:3 BAND (calibrated live: screen frac = (x - margin) / bandW,
-- probes at x=200/600/1000 in a 1280x720 localcoord landed at 4.3%/46.4%/
-- 87.6% of the canvas). The menu/pause flush maps the FULL width instead.
-- Anchor inside the band, or a side-anchored sprite lands off-canvas during
-- the fight and then surfaces only on pause, out in the pillarbox bars -
-- which was the original bug. The Scene Viewer never hit this because it
-- centers everything, and the band center and full-width center coincide.
local npW, npH, npX1, npX2, npY
local function npGeom()
	if npW then return end
	npW = (motif and motif.info and motif.info.localcoord and motif.info.localcoord[1]) or 320
	npH = (motif and motif.info and motif.info.localcoord and motif.info.localcoord[2]) or 240
	local bandW = npH * 4 / 3
	local margin = (npW - bandW) / 2   -- 0 on a 4:3 motif
	-- fight.def [Name] draws p1 at x=13 of 1280 through the FULL-width mapping;
	-- 13/1280 = 0.0102 converted into the band puts the plate under the name.
	npX1 = margin + bandW * 0.012
	npX2 = npW - margin - bandW * 0.012
	-- The rendered name occupies ~111-130 in a 720-tall localcoord (measured
	-- off a live frame - [Name] p1.pos y=145 is NOT the text top; the lifebar
	-- applies its own offset). 0.185 clears the name's bottom by ~3 units.
	npY = math.floor(npH * 0.185 + 0.5)
end

-- Borrow the LIFEBAR'S OWN name font (fight.def font3) so the plate reads as
-- part of the HUD instead of a debug overlay. Two things make this work:
--
--  * Color. ts.frgba's RGB never reaches a sprite font - TextSprite.Draw
--    hands DrawText only frgba[3] (alpha). But textImgSetColor ALSO does
--    palfx.setColor(r,g,b), and palfx IS passed to DrawText, landing as the
--    shader's color multiplier. So the tint is a pure MULTIPLY: it darkens
--    a channel but never brightens one. Menu2Small's glyphs are white, so
--    they take any color cleanly - do not expect this to work on a font
--    whose glyphs are already colored.
--    (Banks are useless here: the .def advertises 8, but the SFF carries 0
--    palettes and the glyphs are RGBA32, where bank is ignored outright.)
--
--  * Scale. fight.def and system.def are both localcoord 1280x720 and the
--    lifebar draws the name at scale 1,1 - so scale 1,1 here matches the
--    character name exactly. (f-6x9 needed npH/240 to reach natural size;
--    that would render this 12x20 font ~3x oversized.)
--
-- The font is ikemen1's Menu2Small, which only ikemen1's own folder has
-- (data/ikemen1/fonts). fontNew looks in the motif's folder, the game folder
-- and data/, so under any other screenpack 'fonts/Menu2Small.def' was not
-- found and fontNew handed back an EMPTY font without an error: the plates
-- drew nothing at all (Capcom vs SNK Evolution Rev 2). The build ships a copy
-- as font/net-names.def + .sff, names no screenpack has; the ikemen1 path is
-- the fallback for a build made before it.
local npFont, npSprites = nil, {}
-- Create the font at MODULE LOAD, never mid-fight. fontNew is a synchronous
-- VFS fetch + SFF decode + per-sprite texture upload (font.go -> loadFnt ->
-- cloneSpriteWithPal, which drains sys.mainThreadTask per sprite), and the old
-- lazy first-draw call ran all of that inside s.action() - on wasm, on the
-- fight's opening frames, and under rollback potentially inside a
-- re-simulation. Mods load from main.lua after the motif, so the search path
-- is ready here. pcall so a missing font degrades to no plates, not no game.
do
	local npFontName = 'fonts/Menu2Small.def'
	if main ~= nil and main.f_fileExists ~= nil and main.f_fileExists('font/net-names.def') then npFontName = 'net-names.def' end
	local ok = pcall(function() npFont = fontNew(npFontName, -1) end)
	if not ok then npFont = nil end
	print('[online] name plates in ' .. npFontName .. (npFont ~= nil and '' or ' (not loaded)'))
end
local function npSprite(key, align, r, g, b)
	local s = npSprites[key]
	if s then return s end
	if npFont == nil then return nil end
	local t = textImgNew()
	-- Font BEFORE window: SetWindow branches on fnt.Type for its scissor Y,
	-- so setting the font afterwards would leave a stale window.
	textImgSetFont(t, npFont)
	textImgSetAlign(t, align)
	textImgSetColor(t, r, g, b)
	-- localcoord FIRST: SetPos/SetScale bake localScale in, and without this
	-- a sprite defaults to the engine's native 320x240 space and lands off
	-- screen. Same trap the Scene Viewer hit on V2.
	textImgSetLocalcoord(t, npW, npH)
	textImgSetScale(t, 1, 1)
	textImgSetWindow(t, 0, 0, npW, npH)
	s = { ti = t, last = nil }
	npSprites[key] = s
	return s
end

local function npDraw(key, str, x, y, align, r, g, b)
	local s = npSprite(key, align, r, g, b)
	if s == nil then return end   -- font failed at load: degrade to no plates
	-- Only push the string when it CHANGES: this runs every frame, and
	-- re-setting an identical string just feeds the GC, which on
	-- single-threaded wasm is a visible mid-round hitch.
	if s.last ~= str then
		textImgSetText(s.ti, str)
		s.last = str
	end
	textImgSetPos(s.ti, x, y)
	textImgDraw(s.ti)
end

-- PER-FRAME DISCIPLINE (field-hit 2026-08-11): these hooks run on EVERY
-- frame of every online match, on single-threaded wasm where allocation =
-- GC pressure = hitches, and in delay lockstep a hitch on either side
-- stalls BOTH players. The first version allocated five closures per frame
-- (inline pcall(function() ... end)) and crossed the Go->JS boundary per
-- frame (netOnlineNames marshals a string through syscall/js) - reported in
-- the field as "netplay has felt laggier ever since the ranked build".
-- Rules for this file: pcall only HOISTED functions (created once, below),
-- cache anything that crosses into Go/JS, and parse strings only on change.

-- Hoisted pcall targets - allocated once, not per frame.
local function callWinTeam() return netWinTeam() end
local function callNames() return netOnlineNames() end
local function callMatchOver() return matchOver() end

-- "Are we in a netplay match?" - BOTH netcodes, guarded. The history that
-- matters, compressed (full story: NETPLAY.md, GRAIL is palette-side only):
--
--  * connected() is sys.netConnection ~= nil, and rollback MOVES that
--    connection out for the whole match (rollback.go:117-118, back at :136),
--    so connected() is false on every rollback frame. Gating on it alone made
--    these hooks delay-only: no plates, no leaderboard rows, in rollback.
--  * A first attempt at netPlay() was blamed for a rollback desync and
--    reverted. That was a CONFOUND - the real cause was the win-pose skip
--    (the only input-dependent write to sys.intro in the round transition,
--    system.go:3181), now disabled under rollback in the engine
--    (system.go:3179, s.rollback.session == nil). Skipping desynced 100% of
--    attempts; these hooks were inert at the time.
--  * The contract rollback imposes on per-frame Lua is IDEMPOTENCY under
--    re-execution: rollback re-runs s.action() - and the Common Lua block
--    with it - for every corrected frame (rollback.go:242), a count that
--    differs per peer, and Lua state is never saved/restored by snapshots.
--    An offline ggpo SyncTest (8x re-simulation, GameState.Checksum compare)
--    ran these hooks on every re-simulated frame through a full match clean,
--    while a deliberately non-idempotent control (a Lua counter gating a
--    getRandom() call) tripped Panic: RaiseDesyncError - so the harness
--    works AND these hooks pass it. What one machine cannot test is
--    branch-divergent re-execution and real-jitter GC patterns; that is what
--    netInRollback() guards below are for.
--
-- Design, three rules:
--  1. Gate on netPlay() so both netcodes get plates + reporting. This also
--     turns the hooks on during REPLAY playback (sys.netplay() includes
--     replayFile) - harmless for the plates (no queue names = nothing drawn)
--     and inert for the reporter (no queue match = doReport bails in JS).
--  2. simFrame(): do NOTHING during a rollback re-simulation. Every counter,
--     poll and draw below then advances exactly once per displayed frame in
--     every mode, and the Lua VM stops being a hidden non-rewound component
--     of the frame function.
--  3. The wasm must not predate the netInRollback binding (the PLAYER NAME
--     crash lesson: calling a missing global kills the engine at boot). If
--     it does, fall back to the old delay-only connected() gate - strictly
--     the pre-existing behavior, never a crash.
local hasInRollback = (type(netInRollback) == 'function')
local function inNetMatch()
	if hasInRollback then return netPlay() end
	return connected()
end
local function simFrame()
	if not hasInRollback then return true end
	return not netInRollback()
end

-- SHARED PAIRING IDENTITY - both hooks below key their caches on this.
--
-- netOnlineNames() returns "p1\\np2\\n<pairingToken>"; the token is the
-- server-assigned pairing time, unique per pairing and identical on both peers
-- (webrtc.js queueNames()).
--
-- Why a token instead of just clearing on "not in a netplay match": THIS HOOK
-- ONLY RUNS DURING A FIGHT. Between matches - at the queue screen, where a new
-- opponent is assigned - it does not run at all, so it can never witness the
-- transition. Field result before this (2026-08-11): after one set against one
-- opponent, the plates kept drawing that opponent's names on the old sides
-- forever, and the report latch stayed armed so only the first pairing was ever
-- counted. Keying on the token makes every cache here self-invalidating.
--
-- Polls forever (not "until it answers"), because a new pairing must be seen.
-- Once per 30 LOGICAL frames, keyed to gameTime() so both peers poll on the same
-- frame and a rollback cannot drift it; idempotent within a frame so either hook
-- may call it, in any order, without double-crossing into JS.
local npRaw, npP1, npP2 = nil, nil, nil
local npToken = nil
local npStatus = ''
local npLastPoll = -1

-- LINE CONTRACT for netOnlineNames() - read this before adding a field:
--   1 p1 name   2 p2 name   3 pairing token   4 local ranked status
--
-- Lines 1-3 are SHARED TRUTH: byte-identical on both peers, so they may drive
-- flow, counting and reporting. Line 4 is LOCAL DISPLAY DATA (this player's own
-- rating/tier, which the other peer never sees the same way) and must NEVER
-- influence flow, counting or reporting - only what is drawn.
--
-- The token capture is [^\\n]* and not (.*) on purpose: a greedy tail swallows
-- line 4 into npToken, so every latch keyed on the token would reset the
-- instant the rating string updated - re-arming repDone mid-match and
-- double-reporting the same result.
local function npParse(verified)
	-- Third field optional: an older page script sends only "p1\\np2", in which
	-- case the token stays '' and behavior degrades to the old caching.
	local p1, p2, rest = verified:match('^([^\\n]*)\\n([^\\n]*)\\n?(.*)$')
	if p1 == nil or p1 == '' then return end
	local tok, extra = rest:match('^([^\\n]*)\\n?(.*)$')
	npRaw, npP1, npP2 = verified, p1, p2
	npToken, npStatus = (tok or ''), (extra or '')
end

local function pollPairing()
	local t = gameTime()
	if t == npLastPoll or t % 30 ~= 0 then return end
	npLastPoll = t
	local okNames, verified = pcall(callNames)
	if not okNames or verified == nil or verified == '' then return end
	npParse(verified)
end

-- Forced, unthrottled poll. ONLY for post-match code that runs once per match
-- OUTSIDE the fight loop. It deliberately skips the gameTime() gate that keeps
-- the in-fight poll peer-synchronized, so calling it from a per-frame hook
-- would reintroduce exactly the drift that gate exists to prevent.
local function pollPairingNow()
	local okNames, verified = pcall(callNames)
	if not okNames or verified == nil or verified == '' then return end
	npParse(verified)
end

-- One k=v field out of line 4, e.g. 'you=1;st=ok;elo=1043;d=21;tier=GOLD'.
-- The leading ';' is prepended so the pattern anchors on a separator and
-- 'tier' cannot match inside 'ptier'.
local function rankedStatus(key)
	if npStatus == nil or npStatus == '' then return nil end
	local v = (';' .. npStatus):match(';' .. key .. '=([^;]*)')
	if v == nil or v == '' then return nil end
	return v
end

local repSide = -1
local function doReport()
	-- Character names come from the loaded characters. name() reads the
	-- WORKING character, so borrow it per side and hand it back - the
	-- same player()/playerId() dance the Scene Viewer uses.
	-- These are SIDE 1 and SIDE 2, not "mine" and "theirs": both peers
	-- compute the same pair, and the page picks its own out of them by
	-- role. Naming them mine/theirs is what led a guest to file the
	-- host's character as their own.
	local p1Char, p2Char = '', ''
	local oldid = id()
	if player(1) then p1Char = tostring(name() or '') end
	if player(2) then p2Char = tostring(name() or '') end
	playerId(oldid)
	netReportResult(repSide, p1Char, p2Char)
end

-- Leaderboard reporting. There is no match-end hook in the engine, so watch
-- for the MATCH being decided while a netplay session is live, and fire exactly
-- once per match. Both peers of a lockstep session compute the same winner by
-- construction, which is what lets each side report independently and the
-- server count only when they agree.
-- Polled every 10th frame: a result posted 150ms late is indistinguishable,
-- and the hook costs nothing on the other nine.
--
-- Two things this has to get right, both learned the hard way (2026-08-11):
--
--  * netWinTeam() is sys.winTeam, which is a PER-ROUND value - resetRound()
--    sets it back to -1 and roundEndDecision() sets it at the end of EVERY
--    round. Latching the first decided side files the winner of ROUND 1, so
--    any best-of-3 that the eventual loser opened was recorded backwards.
--    matchOver() is the match-level truth (wins >= matchWins).
--  * repDone must rearm per MATCH, not per session. A ranked session holds one
--    connection across many matches, so clearing it only on disconnect meant
--    matches 2..N were never reported at all - and because this hook only runs
--    during a fight, the disconnect branch was barely reachable anyway.
--    Rearming when the next match is no longer over is the honest edge.
local repDone = false
local lastSide = -1
local prevOver = false
local repToken = nil
hook.add('loop', 'leaderboardreport', function()
	if not inNetMatch() then
		repDone, lastSide, prevOver, repToken = false, -1, false, nil
		return
	end
	-- Never during a rollback re-simulation: the latches below are Lua state,
	-- which snapshots neither save nor restore, so advancing them on replayed
	-- frames would sample them at different sim frames on the two peers.
	if not simFrame() then return end
	-- A NEW PAIRING resets every latch. The "not inNetMatch()" branch above
	-- cannot do this job: this hook only runs during a fight, so it never sees
	-- the queue screen where the next opponent is assigned, and repDone stayed
	-- armed across pairings - only the first opponent of a session was ever
	-- reported (field-hit 2026-08-11).
	pollPairing()
	if npToken ~= nil and repToken ~= npToken then
		repToken = npToken
		repDone, lastSide, prevOver = false, -1, false
	end
	-- Poll on gameTime, not a Lua counter: gameTime() is matchTime+preMatchTime,
	-- both inside SystemStateVars, so it is restored by rollback and both peers
	-- poll on the same LOGICAL frame - a counter here drifts by rollback depth.
	if gameTime() % 10 ~= 0 then return end
	-- Latch the most recent decided ROUND every poll. Reading winTeam only
	-- once the match is over would be a race: resetRound() puts it back to -1,
	-- and at one sample per 10 frames the deciding round can pass unseen -
	-- which would cost the match its leaderboard row entirely.
	local ok, side = pcall(callWinTeam)
	if ok and side ~= nil and side >= 0 then lastSide = side end
	local overOk, over = pcall(callMatchOver)
	if not overOk then return end
	if not over then
		-- Falling out of "over" means the NEXT match has started: arm for its
		-- result and forget the previous one, so a match whose deciding round
		-- is somehow never sampled reports nothing rather than reporting stale.
		if prevOver then lastSide = -1 end
		repDone, prevOver = false, false
		return
	end
	prevOver = true
	if repDone or lastSide < 0 then return end
	repDone = true
	if lastSide == 0 then return end   -- draw: nothing to record
	repSide = lastSide
	pcall(doReport)
end)

hook.add('loop', 'onlinenames', function()
	-- ONLINE matches only (field feedback: the simulate fallback bled the
	-- plates into practice/arcade/every offline mode). inNetMatch() is the
	-- engine's own netplay truth for BOTH netcodes, and the fight-only guard
	-- keeps them off the versus/loading screens.
	if not inNetMatch() then
		npRaw, npP1, npP2 = nil, nil, nil
		return
	end
	-- Draw once per DISPLAYED frame only. During a rollback re-simulation the
	-- draw queue is not flushed anyway (it clears per rendered frame), so
	-- drawing there would just stack duplicate ops and feed the GC - and the
	-- npPoll counter below is Lua state that rollback never rewinds.
	if not simFrame() then return end
	local rs = roundState()
	if rs == nil or rs < 2 then return end
	npGeom()
	-- Only a matchmade session carries names to draw: both players'
	-- SERVER-VERIFIED names (queue admission checks name+recovery code,
	-- and the opponent's name arrives from the server, never from their
	-- config). Friend matches (host/join) have no verified names, so they
	-- draw no plates - inventing one would defeat the verification.
	-- pcall: this build's Lua must never die on a wasm that predates
	-- the binding - the exact mistake the PLAYER NAME crash taught us.
	-- NB this file is generated from a JS template literal: the \\n below
	-- MUST stay double-escaped or JS bakes real newlines into the Lua
	-- string literal, which kills the whole engine at boot with
	-- "unterminated string" (field-hit 2026-08-10).
	pollPairing()
	if npP1 then
		npDraw('p1', npP1, npX1, npY, 1, 90, 170, 255)      -- left,  blue
		npDraw('p2', npP2, npX2, npY, -1, 255, 150, 40)     -- right, orange
	end
end)

-- ---------------------------------------------------------------------------
-- RANKED SETS - first to N match wins, then a result screen, then out.
--
-- WHY THE COUNTER LIVES IN A start.f_game WRAPPER, not in a 'loop' hook:
-- f_game returns exactly ONCE per match, after game() has returned and after
-- the engine's postMatchSetup() has restored sys.netConnection - so it is
-- outside the rollback re-simulation window entirely. A per-frame hook would
-- need the simFrame() guard, and would advance a different number of times on
-- each peer if that guard ever failed. Writing flow control (start.exit) from
-- a frame that may be replayed is a risk this design simply does not take.
--
-- WHY getWinnerTeam() AND NOT netWinTeam(): netWinTeam is sys.winTeam, a
-- PER-ROUND value (see the leaderboardreport notes above - latching it filed
-- best-of-3s backwards). getWinnerTeam is match-level, derived from sys.wins
-- vs sys.matchWins, both lockstep state - so both peers compute the same
-- number by construction. That is the same property that already lets both
-- peers report independently and have the server find them in agreement.
--
-- It returns 1 or 2 for a decided match, 0 for a draw, and -1 when the match
-- was force-ended locally (endMatch, i.e. this player quit). -1 must score
-- nothing: it is not shared truth, it is one peer leaving.
rankedSet = {
	target = 2,        -- match wins needed to take the set
	wins = {0, 0},
	token = nil,       -- pairing token this set belongs to
	over = false,
	winner = 0,
	matches = 0,
}

-- Backstop only. Draws score nothing for either side, so a pathological
-- all-draw pairing would otherwise never reach the target and would sit in the
-- same endless rematch loop the set limiter exists to remove.
local RANKED_SET_MAX = 7

local function rankedSetReset()
	rankedSet.wins[1], rankedSet.wins[2] = 0, 0
	rankedSet.over, rankedSet.winner, rankedSet.matches = false, 0, 0
end

local function rankedSetTally()
	pollPairingNow()
	-- RANKED ONLY. A pairing token exists solely for matchmade sessions, so
	-- friend host/join matches keep their unlimited rematches untouched.
	if npP1 == nil or npP1 == '' then return end
	-- RANKED ONLY. A pairing token exists solely for RATED sessions, so casual
	-- and friend host/join keep their unlimited rematches untouched.
	--
	-- '0' counts as absent too. webrtc.js publishes the empty string for casual,
	-- but it briefly shipped '0' and that armed this limiter on the first casual
	-- session (field-hit 2026-08-31). Accepting both means an older or newer page
	-- script can never re-open it - webrtc.js is served separately from the pak
	-- and is NOT in the Build ID, so the two halves can legitimately differ.
	if npToken == nil or npToken == '' or npToken == '0' then return end
	-- A new pairing is a new set. Same keying as the report latch.
	if rankedSet.token ~= npToken then
		rankedSet.token = npToken
		rankedSetReset()
	end
	if rankedSet.over then return end
	rankedSet.matches = rankedSet.matches + 1
	local ok, side = pcall(getWinnerTeam)
	if ok and (side == 1 or side == 2) then
		rankedSet.wins[side] = rankedSet.wins[side] + 1
		if rankedSet.wins[side] >= rankedSet.target then
			rankedSet.over, rankedSet.winner = true, side
		end
	end
	if not rankedSet.over and rankedSet.matches >= RANKED_SET_MAX then
		rankedSet.over = true
		if rankedSet.wins[1] > rankedSet.wins[2] then
			rankedSet.winner = 1
		elseif rankedSet.wins[2] > rankedSet.wins[1] then
			rankedSet.winner = 2
		else
			rankedSet.winner = 0
		end
	end
	-- Unwinds the fight loop: launchFight breaks, f_selectMode takes its
	-- matchNo()==-1 branch and returns, and the RANKED MATCH handler ends the
	-- session (it runs VERSUS directly; there is no lobby menu to land on).
	if rankedSet.over then start.exit = true end
end

if start ~= nil and type(start.f_game) == 'function' then
	local origFGame = start.f_game
	start.f_game = function(...)
		local rets = {origFGame(...)}
		-- pcall: a fault in set bookkeeping must never take down a match that
		-- has already been played and reported.
		pcall(rankedSetTally)
		return unpack(rets)
	end
end

-- Raised once the set is decided, so both peers leave together. The RANKED
-- MATCH handler runs VERSUS directly and ends the session when f_selectMode
-- returns; the flag also ends any menu loop it could return to, and the result
-- page clears it first.
if start ~= nil and type(start.f_selectMode) == 'function' then
	local origSelectMode = start.f_selectMode
	start.f_selectMode = function(...)
		local rets = {origSelectMode(...)}
		if rankedSet.over then esc(true) end
		return unpack(rets)
	end
end

-- The result page. Runs AFTER exitNetPlay(), so the connection is already down
-- and this screen is purely local - which is the whole reason it is allowed to
-- block on input at all. main.f_warning dismisses on esc() and getKey(), both
-- of which read the LOCAL keyboard only; during a live session that would
-- desync instantly. If this is ever moved between matches of a live set it
-- must be rewritten to use getInput(-1, ...) plus a frame cap instead.
function rankedSet.f_result()
	-- Consume our own exit flag FIRST. f_warning does esc(false) then tests
	-- esc() every frame, so a set flag left armed dismisses the page instantly.
	esc(false)
	if not rankedSet.over then return end
	pollPairingNow()

	local names = {npP1 or 'P1', npP2 or 'P2'}
	local you = tonumber(rankedStatus('you') or '') or 0
	local w = rankedSet.winner
	local title
	if w == 0 then
		title = 'SET DRAWN'
	elseif you == 1 or you == 2 then
		title = (you == w) and 'YOU WIN THE SET' or 'SET LOST'
	else
		title = (names[w] or 'PLAYER') .. ' WINS THE SET'
	end

	local lines = {}
	table.insert(lines, names[1] .. '  ' .. rankedSet.wins[1] .. ' - ' ..
		rankedSet.wins[2] .. '  ' .. names[2])
	table.insert(lines, '')

	local st = rankedStatus('st')
	if st == 'ok' then
		local d = tonumber(rankedStatus('d') or '') or 0
		local sign = (d >= 0) and '+' or ''
		local tier = rankedStatus('tier') or '?'
		table.insert(lines, 'RATING  ' .. (rankedStatus('elo') or '?') ..
			'   (' .. sign .. d .. ')')
		table.insert(lines, 'RANK  ' .. tier)
		-- Three distinct events, sent as distinct keys by the page script.
		-- Finishing placement is NOT a promotion (a lost set can complete
		-- placements), and a demotion must never read as 'RANK UP!'.
		if rankedStatus('placed') ~= nil then
			table.insert(lines, 'PLACEMENT COMPLETE  ->  ' .. tier)
		end
		local pt = rankedStatus('ptier')
		if pt ~= nil then
			table.insert(lines, 'RANK UP!   ' .. pt .. '  ->  ' .. tier)
		end
		local dt = rankedStatus('dtier')
		if dt ~= nil then
			table.insert(lines, 'RANK DOWN  ' .. dt .. '  ->  ' .. tier)
		end
		local pl = tonumber(rankedStatus('pl') or '') or 0
		if pl > 0 then
			table.insert(lines, 'PLACEMENT  ' .. pl .. ' more to be ranked')
		end
	elseif st == 'off' then
		table.insert(lines, 'UNRATED SET')
	else
		-- The honest fallback. Your rating only moves once your OPPONENT's
		-- report reaches the server too, so a rage-quit or a slow connection
		-- leaves nothing to show. Print that rather than a wrong number.
		table.insert(lines, 'RATING UPDATE PENDING')
		table.insert(lines, 'opponent result not received')
	end

	local sec = motif[main.group]
	local bg = motif[main.background]
	-- Big centered headline instead of the motif's literal 'WARNING' (which is
	-- what f_warning's default title sprite displays): borrow the menu's own
	-- title sprite, which the engine re-texts every frame while the menu runs,
	-- so nothing we write here can outlive this screen. nil overlay = let
	-- f_warning pick its own default.
	local tsd = (sec ~= nil and sec.title ~= nil) and sec.title.TextSpriteData or nil
	local titled = false
	if tsd ~= nil then
		titled = pcall(function()
			textImgReset(tsd)
			textImgSetText(tsd, title)
		end)
	end
	if titled then
		pcall(main.f_warning, table.concat(lines, '\\n'), sec, bg, nil, tsd)
	else
		pcall(main.f_warning, title .. '\\n\\n' .. table.concat(lines, '\\n'), sec, bg)
	end

	-- Leave esc CLEAN. The handler calls esc(false) again after this for the
	-- same reason: a stray esc cascades out of the network menu into the main
	-- menu, whose loop breaks on the same condition - which quits the game.
	esc(false)
	rankedSetReset()
	rankedSet.token = nil
end

-- NOTE the RANKED MATCH handler does NOT live here: its post-connect call
-- showSessionWarning (and enterSyncedNetplayMenu, until queue matches went
-- straight to VERSUS) is a main.lua LOCAL that an external mod cannot see - calling them from this file crashed the engine
-- the moment a match connected. It is instead patched directly into the
-- engine's main.lua t_itemname table at build time (see vfslib.js), where
-- those locals are in scope. Nothing in this mod may reference them.

main.t_itemname['playername'] = function(t, item)
	sndPlay(motif.Snd, motif[main.group].cursor.move.snd[1], motif[main.group].cursor.move.snd[2])
	local name = main.f_drawInput(
		motif[main.group].textinput.TextSpriteData,
		'Online name: ',
		motif[main.group],
		motif[main.background],
		motif[main.group].textinput.overlay.RectData,
		main.f_onlineName()
	)
	-- Trim, cap length, and keep it to characters that survive a scoreboard
	-- and a URL without escaping surprises.
	name = tostring(name or ''):gsub('^%s+', ''):gsub('%s+$', '')
	name = name:gsub('[^%w _%-%.]', '')
	if #name > MAXLEN then name = name:sub(1, MAXLEN) end
	if name ~= '' then
		-- Same reasoning as the read: never let a settings write take the
		-- engine down from a menu. A failed save just means the name did not
		-- stick, which the player can retry.
		local ok, err = pcall(function()
			modifyGameOption('Netplay.PlayerName', name)
			saveGameOption()
		end)
		if not ok then
			-- Report, do not fail silently and do not take the engine down.
			-- The first version swallowed this and only played the cancel
			-- sound, which looked exactly like "you pressed escape" while the
			-- name was never saved.
			printConsole('[playername] save failed: ' .. tostring(err))
		end
		local snd = ok and motif[main.group].cursor.done.snd.default or motif[main.group].cancel.snd
		sndPlay(motif.Snd, snd[1], snd[2])
	else
		sndPlay(motif.Snd, motif[main.group].cancel.snd[1], motif[main.group].cancel.snd[2])
	end
	return nil
end
` + require('./queuemode').hookLua());
  }

  // A BLEND WRITTEN ONE FIELD LATE, repaired in the copy this build ships
  // (buildimport.stageAirBlend). Done over the assembled map rather than the
  // stages folder, so a build that leaves a stage out does not get its .def
  // handed back by the generated layer. The desktop export repairs its own
  // copies in the same terms (desktop.js).
  try {
    const bi = require('./buildimport.js');
    for (const [vpath, abs] of map) {
      if (abs === null || !/^stages\/.*\.def$/i.test(vpath)) continue;
      let text = null;
      try { text = fs.readFileSync(abs); } catch (e) { continue; }
      const r = bi.stageAirBlend(text);
      if (r.count) generated[vpath] = Buffer.from(r.text, 'latin1');
    }
  } catch (e) {
    console.warn('stage animation repair failed:', e.message);
  }

  // THE SPRITE FILE AS THIS BUILD SHIPS IT. Two repairs, both made in the copy
  // and never in the character's own file, which is only read:
  //   portraitfit.js  select portraits cut to the size THIS screenpack draws
  //                   them at, where the roster says so for this character
  //   custompal.js    palettes the user added: a (1, N) palette in a v2 sprite
  //                   file, an .act and a palN line in the shipped def for v1
  //   futafix.js      a flag the sprite file cannot honor: the missing frames
  //                   go in as linked sprites, 32 bytes each
  // In that order - the first rebuilds the file and keeps every index, the
  // last appends links that rely on them. Same terms as the desktop export.
  const charFixes = [];
  //
  const clNames = [];
  let commandListFont = null;
  // A FILE THE .DEF NAMES, AS THIS BUILD HOLDS IT. The map's keys have the
  // disk's spelling, and a repair may name a file the way the .def spells it:
  // modlib.resolveCI keeps that spelling wherever the exact path exists, and
  // on Windows RyuDX's `data/ryuDX.st` exists when the disk has
  // `Data/RyuDX.st`. The engine finds it either way (FileExist's
  // case-insensitive glob), and so does the desktop export, which writes
  // through the path; looked up here by the .def's spelling, RyuDX shipped
  // without his hit-priority and AI-switch repairs. Exact key first; the
  // lowercased index is made on the first miss only.
  let lowerKeys = null;
  const shippedKey = (vpath) => {
    if (map.has(vpath)) return vpath;
    if (!lowerKeys) {
      lowerKeys = new Map();
      for (const k of map.keys()) if (k.startsWith('chars/') && !lowerKeys.has(k.toLowerCase())) lowerKeys.set(k.toLowerCase(), k);
    }
    return lowerKeys.get(vpath.toLowerCase()) || null;
  };
  try {
    const futafix = require('./futafix.js');
    const portraitfit = require('./portraitfit.js');
    const custompal = require('./custompal.js');
    for (const mc of mountedChars) {
      // PER CHARACTER. One try round the whole loop meant a throw on one
      // character silently cost every character after it all of its repairs -
      // and that is exactly what happened when a new repair's output had no
      // file name to be written under. A failure now costs its own character.
      try {
      const fits = portraitfit.fitsOf(mc.rosterChar, roster);
      const customs = (mc.rosterChar && mc.rosterChar.customPalettes) || null;
      for (const defName of mc.defNames) {
        // MUGEN's HitDef default (p1sprpriority = 1) written into a MUGEN-
        // authored character's state files: Ikemen GO 1.0.0 dropped it, and
        // scenes that layer on it draw the attacker on top (hitprio.js).
        for (const h of require('./hitprio.js').repairFor(mc.charDir, defName)) {
          const hv = shippedKey('chars/' + mc.mountAs + '/' + h.rel);
          if (!hv || generated[hv]) continue;
          generated[hv] = Buffer.from(h.text, 'latin1');
          if (h.count) charFixes.push({ file: hv, kind: 'mugen-hit-priority', hitdefs: h.count });
          if (h.latches) charFixes.push({ file: hv, kind: 'ai-switch-release', switches: h.latches });
        }
        // a source that wears the costume is baked in the build's pal1: the order and the Studio's colors pick it
        const p = fits ? portraitfit.fitFor(mc.charDir, defName, fits, { pictures: layout.dir('portraits'),
          order: (mc.rosterChar && mc.rosterChar.paletteOrder) || null, customs, palettes: layout.dir('palettes') }) : null;
        let cp = customs ? custompal.shipFor(mc.charDir, defName, customs, { palettes: layout.dir('palettes'), input: p && p.buf ? p.buf : undefined }) : null;
        // the user's slot order (palorder.js), over the slots the copy has by now
        const want = mc.rosterChar && mc.rosterChar.paletteOrder;
        const po = want ? require('./palorder.js').shipFor(mc.charDir, defName, want, { input: (cp && cp.sprite && cp.sprite.buf) || (p && p.buf) || undefined, defText: cp && cp.def ? cp.def.text : undefined }) : null;
        if (po) {
          cp = Object.assign({ files: [], applied: [], skipped: [] }, cp || {});
          if (po.def) cp.def = po.def;
          if (po.sprite) cp.sprite = po.sprite;
          charFixes.push({ file: 'chars/' + mc.mountAs + '/' + defName, kind: 'palette-order', moved: po.map.length });
        }
        const soFar = (cp && cp.sprite && cp.sprite.buf) || (p && p.buf) || null;
        const r = futafix.repairFor(mc.charDir, defName, soFar ? { input: soFar } : undefined);
        // a v1 character's new slots are files beside its def, and a line in the def
        if (cp && cp.def) {
          const dv = shippedKey('chars/' + mc.mountAs + '/' + cp.def.rel);
          if (dv && !generated[dv]) {
            generated[dv] = Buffer.from(cp.def.text, 'latin1');
            for (const f of cp.files) generated['chars/' + mc.mountAs + '/' + f.rel] = f.buf;
          }
        }
        if (cp && (cp.applied.length || cp.skipped.length)) charFixes.push({ file: 'chars/' + mc.mountAs + '/' + defName, kind: 'palettes', slots: cp.applied, skipped: cp.skipped });
        // last: a v1 file whose own palette is not the character's pal1 (v1base.js), over everything above
        let vb = null;
        // (with the def as palette order / custom palettes left it: its pal1)
        try { vb = require('./v1base.js').repairFor(mc.charDir, defName, { input: (r && r.buf) || soFar || undefined, defText: cp && cp.def ? cp.def.text : undefined }); } catch (e) { vb = null; }
        if (vb) charFixes.push({ file: 'chars/' + mc.mountAs + '/' + vb.spriteRel, kind: 'v1-base-palette', replaced: vb.replaced, axis: vb.axis || [] });
        // and after that: the def's palN lines over the slots an SFF v2 file keys
        // itself (v2ownpal.js). A fight here never read them; the select
        // screen's color preview did. On the def and sprite file as everything
        // above left them.
        let op = null;
        try { op = require('./v2ownpal.js').repairFor(mc.charDir, defName, { input: (vb && vb.buf) || (r && r.buf) || soFar || undefined, defText: cp && cp.def ? cp.def.text : undefined }); } catch (e) { op = null; }
        if (op) {
          const dv = shippedKey('chars/' + mc.mountAs + '/' + op.def.rel);
          if (dv) {
            generated[dv] = Buffer.from(op.def.text, 'latin1');
            charFixes.push({ file: dv, kind: 'v2-own-palettes', slots: op.slots });
          }
        }
        // last of all: the pause menu's Command List (cmdlist.js) - a file
        // beside the def and a movelist line in its [Files], over the def as
        // everything above left it; a character that ships her own list is
        // never touched, and her own folder is only read. Same as desktop.js.
        // The def is found the way every repair above finds its file
        // (shippedKey: the roster may spell it in other letter case than the
        // disk), and the list is filed beside the def as the build holds it.
        try {
          const mv = shippedKey('chars/' + mc.mountAs + '/' + defName);
          if (mv) {
            const pre = ('chars/' + mc.mountAs + '/').toLowerCase();
            const have = new Set();
            for (const k of map.keys()) { const l = k.toLowerCase(); if (l.startsWith(pre)) have.add(l); }
            for (const k of Object.keys(generated)) { const l = k.toLowerCase(); if (l.startsWith(pre)) have.add(l); }
            const entry = require('./cmdlist.js').entryFor(roster, mc.rosterChar && mc.rosterChar.folder, defName, mc.rosterChar);
            const ml = require('./cmdlist.js').shipFor(mc.charDir, defName, {
              defText: generated[mv] ? generated[mv].toString('latin1') : undefined,
              exists: (rel) => have.has(pre + String(rel).toLowerCase()),
              choices: entry && entry.commandList,
            });
            if (ml) {
              const mlv = mv.slice(0, mv.lastIndexOf('/') + 1) + ml.file.rel.split('/').pop();
              generated[mlv] = ml.file.buf;
              generated[mv] = Buffer.from(ml.def.text, 'latin1');
              charFixes.push({ file: mlv, kind: 'command-list', moves: ml.rows, def: mv });
              clNames.push(...(ml.names || []));
            }
          }
        } catch (e) {
          console.warn('command list not written for ' + mc.mountAs + ':', e.message);
        }
        const buf = (vb && vb.buf) || (r && r.buf) || soFar;
        if (!buf) continue;
        // whichever repair ran names the file - a character with ONLY the base-palette repair has no p, cp or r
        const vpath = shippedKey('chars/' + mc.mountAs + '/' + ((vb && vb.spriteRel) || (r && r.spriteRel) || (cp && cp.sprite && cp.sprite.rel) || (p && p.spriteRel)));
        if (!vpath || generated[vpath]) continue;
        generated[vpath] = buf;
        if (p && p.buf) charFixes.push({ file: vpath, kind: 'portrait-fit', slots: p.applied, skipped: p.skipped });
        if (r) charFixes.push({ file: vpath, kind: 'plus-frames', links: r.added, unfixable: r.unfixable });
      }
      } catch (e) {
        console.warn('sprite file repair failed for ' + mc.mountAs + ':', e.message);
      }
    }
  } catch (e) {
    console.warn('sprite file repair failed:', e.message);
  }

  // THE COMMAND LIST'S FONT (jpfont.js): only when a list above prints a name
  // the stock fonts cannot draw and DotGothic16 can - the font's def (at the
  // size and spacing of the font the motif's list uses, as this build ships
  // it: in the website build that is the pixel font standing in for
  // Open_Sans.def, above), the font, its license, and the build's copy of the
  // screenpack's system.def pointed at it. Any other build: nothing at all.
  try {
    const JP = require('./jpfont.js');
    if (clNames.length && JP.needed(clNames) && JP.available()) {
      const wantMotif = String(roster.motif || '').toLowerCase();
      const motif = !roster.motif ? DEFAULT_MOTIF
        : (map.has(roster.motif) ? roster.motif : ([...map.keys()].find((k) => k.toLowerCase() === wantMotif) || null));
      const readVp = (vp) => {
        const low = String(vp).replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
        for (const k of Object.keys(generated)) if (k.toLowerCase() === low) return generated[k];
        for (const [k, a] of map) if (k.toLowerCase() === low && typeof a === 'string') { try { return fs.readFileSync(a); } catch (e) { return null; } }
        return null;
      };
      const cur = motif ? readVp(motif) : null;
      if (cur) {
        const text = cur.toString('latin1');
        const fontName = String(JP.commandListFont(text) || '').replace(/\\/g, '/');
        const dir = motif.slice(0, motif.lastIndexOf('/') + 1);
        // the engine's lookup for a motif's font: beside the motif, font/, as is, data/ (motif.go)
        const fontDef = fontName ? [dir + fontName, 'font/' + fontName, fontName, 'data/' + fontName].map(readVp).find(Boolean) : null;
        const metrics = (fontDef && JP.fontMetrics(fontDef.toString('latin1'))) || JP.DEFAULT_SIZE;
        for (const [vp, buf] of Object.entries(JP.files(metrics))) generated[vp] = buf;
        generated[motif] = Buffer.from(JP.patchMotif(text).text, 'latin1');
        // not a charFixes entry: that list is per character (the export's back page groups it by chars/<id>/)
        commandListFont = { def: JP.VPATHS.def, motif, size: metrics.size, from: fontName || null, names: clNames.filter((n) => !JP.stockDraws(n) && JP.fontDraws(n)).length };
        console.log('website build: the Command List font (DotGothic16) ships for ' + commandListFont.names + ' names; ' + motif + ' points the pause menus\' list at it');
      }
    }
  } catch (e) {
    console.warn('the Command List font was not added:', e.message);
  }

  // THE COMMAND LIST'S BUTTONS (buttonstyle.js, Settings > Controls): the
  // bundle's button style other than the default puts the style's [Glyphs]
  // keys into the build's copy of the screenpack's system.def (over the
  // DotGothic16 line above, when that ran) and, when the style needs pictures
  // the glyph file lacks, a copy of that file with them added beside the motif.
  // The default style: nothing at all, byte for byte as before.
  let commandListButtons = null;
  try {
    const BTN = require('./buttonstyle.js');
    if (BTN.styleOf(roster) !== BTN.DEFAULT_STYLE) {
      const wantMotif = String(roster.motif || '').toLowerCase();
      const motif = !roster.motif ? DEFAULT_MOTIF
        : (map.has(roster.motif) ? roster.motif : ([...map.keys()].find((k) => k.toLowerCase() === wantMotif) || null));
      // a file as the build ships it: generated, else a switched-on mod's (the
      //
      // of its own), else the content's
      let modFiles = [];
      try { modFiles = modmgr().userModFiles(roster); } catch (e) { modFiles = []; }
      const readVp = (vp) => {
        const low = String(vp).replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
        for (const k of Object.keys(generated)) if (k.toLowerCase() === low) return generated[k];
        const mod = modFiles.find((m) => String(m.vpath).toLowerCase() === low && !BACKUP_FILE.test(m.vpath));
        if (mod) { try { return fs.readFileSync(mod.abs); } catch (e) { /* the content's, below */ } }
        for (const [k, a] of map) if (k.toLowerCase() === low && typeof a === 'string') { try { return fs.readFileSync(a); } catch (e) { return null; } }
        return null;
      };
      const cur = motif ? readVp(motif) : null;
      const done = cur ? BTN.forBuild(motif, cur.toString('latin1'), readVp, roster) : null;
      if (done && done.info && Object.keys(done.info.overrides).length) {
        generated[motif] = Buffer.from(done.text, 'latin1');
        if (done.file) generated[done.file.vpath] = done.file.buf;
        commandListButtons = Object.assign({ motif }, done.info);
        console.log('website build: the Command List buttons in the ' + done.info.style + ' style (' + Object.keys(done.info.overrides).join(' ') + ')' + (done.file ? ', pictures in ' + done.file.vpath : ''));
      } else if (done && done.info) {
        commandListButtons = Object.assign({ motif }, done.info);
        console.log('website build: the Command List buttons stay as they are: ' + (done.info.notes.join('; ') || 'nothing to change'));
      }
    }
  } catch (e) {
    console.warn('the Command List buttons were not changed:', e.message);
  }

  // THE BUNDLE'S OWN MODS (modmgr.js, the Mods tab): every file of every mod
  // that is switched on, over the engine's and the content's files of the same
  // name - a mod laid out like the game replaces what it names - and under the
  // generated layer, which always wins: a file the build writes itself is not
  // the mod's to replace, and the log says so. Matched without regard to case
  // (the folder the mod came from is Windows'), so a mod's Main.lua takes the
  // place of the engine's main.lua instead of sitting beside it. Last of the
  // walked layers, after every repair above has read the map: a mod ships no
  // characters or stages, so none of them reads its files. In both website
  // builds, the public one too, and the desktop export copies the same list
  // (desktop.js syncUserMods).
  try {
    const mods = modmgr().userModFiles(roster);
    if (mods.length) {
      // The screenpack's system.def counts as the build's even when this build
      // left it as the pack has it: the desktop export always writes its own
      // copy (the boot logo's line), and the Mods tab says a mod's is not used.
      const gen = new Set(Object.keys(generated).map((k) => k.toLowerCase()));
      gen.add(String(roster.motif || DEFAULT_MOTIF).replace(/\\/g, '/').toLowerCase());
      const byLow = new Map();
      for (const k of map.keys()) byLow.set(k.toLowerCase(), k);
      for (const m of mods) {
        const low = m.vpath.toLowerCase();
        if (BACKUP_FILE.test(m.vpath)) continue;   // never shipped, from any layer
        if (gen.has(low)) {
          console.warn('mod "' + m.folder + '": ' + m.vpath + ' is a file the build writes itself - the build\'s copy ships, not the mod\'s');
          continue;
        }
        // Same name in another case (a Windows-made Start.lua over the
        // engine's start.lua): the mod's file goes in under the name the map
        // already has, which is the one the engine's own scripts ask for. A
        // second key would leave the engine looking for a name the browser
        // file system no longer has (the desktop, on Windows, ignores case).
        const was = byLow.get(low);
        const key = was !== undefined ? was : m.vpath;
        map.set(key, m.abs);
        byLow.set(low, key);
      }
    }
  } catch (e) {
    console.warn('the bundle\'s mods were not added:', e.message);
  }

  // Layer 1: generated files override everything
  for (const vpath of Object.keys(generated)) map.set(vpath, null);

  return { roster, generated, index: map, charFixes, commandListFont, commandListButtons };
}

module.exports = { buildRulesLine, mountNames, ownsMount, selectPathFor, ROOT, IKEMEN_SRC, ROSTER_PATH, readRoster, rosterInView, writeRoster, backupRoster, build, walkDir, buildSelectDef, buildConfigIni, playersOf, stageKeepFilter, gltfFiles, charKeepFilter, rosteredDefNames,
  // the gallery's test, for the Mods tab (modmgr.js presentFor)
  rosterHasGiver, rosterHasGalleryPair,
  // hScan's giver/receiver answer under its size@mtime stamp, for the scene
  // viewer's list (modlib buildSceneViewerLua), which needs only that answer
  scannedH,
  // a build open read-only: the match view (server.js /api/readonly/match)
  setMatchView, matchView, matchFor, viewRoster, viewRefs, externalCommon, refValue };
