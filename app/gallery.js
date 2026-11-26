// THE H GALLERY: an Ikemen GO mode that loads each compatible giver/receiver
// pair of an H-Mugen-mode build and steps through the pair's scenes by hand.
//
// Two files go into a build, and only into a build in H-Mugen mode (a giver or
// receiver in the roster) with at least one pair that has something to show:
//   external/mods/mugen-studio/hgallery.lua
//                               the mode: a title-menu item, the pair loop and
//                               the per-frame driver, with the pair data built
//                               by gallerydata.js written into it
//   data/hgallery.zss           a common state every character compiles
//                               ([Common] States7): asserts the giver's own
//                               commands the driver asks for, sets the
//                               variables it asks for, places the pair, keeps
//                               anyone from being KO'd - inert in every other
//                               mode. It names THIS build's commands, so it is
//                               generated per build like the script.
//
// HOW A SCENE IS SHOWN, all with the engine's own means (upstream 1.0.0, so
// the desktop export's stock engine runs it too): the pair stands close and
// idle; the giver is put into his own grab state (Lua changeState - a state
// of his own table), and his grab connects exactly as when a player does it.
// Then the step's PATH runs inside that scene, one action after another, each
// finished when her state shows it took effect:
//   a command of his (.cmd name) made true with AssertCommand in the -4 hook -
//     held (every frame until it shows), pressed (one frame, again every 20),
//     or sustained (every frame while the step is on screen: a speed that
//     plays one cycle per hold);
//   a jump (Lua changeState) into a state of his, made only from the state
//     the data names, with variables set by the hook in the same frame.
// Proven headless on DongHwan x R.Mika before this was written (GRAIL 4.10b):
// AssertCommand in -4 fires his hold commands the next frame with no raw
// input (so no facing, SOCD, see-through or special-move side effects), and a
// var/fvar set from the hook is what his states read that frame.
//
// A step of the same grab as the one running is reached IN PLACE: its path
// runs from wherever the scene is (paths are absolute - a position command is
// guarded where it already is), so the grab intro never replays. A fresh grab
// happens only for another grab, a scene that ended, or an action that did
// not show within its patience (said on screen) - or at once, in place, for
// a command or a wait whose `from` does not name the state he is in (a timed
// ladder's earlier rung, which his scene is already past).
// In an ANIM HUB (FutaBT: her state stays, his animation is the pose) an
// action is finished when his animation is one of its `anim` as well, acts
// only from his `fromAnim` (in place elsewhere: grabbed again at once), and
// the step shows while his animation is one of its `anims` (out of them a
// while - a climax back at its idle - it plays again).
//
// A COMPANION's step (a helper of his his own commands drive in his stance:
// Brian's Striker Bao) opens the gate the pair's setup holds shut (its own
// setup, from the summon on, only where it plays), waits for the companion to
// spawn and stand idle, enters his stance (changeState, as any grab) and has
// the hook assert the companion's grab command in ITS command list and pin
// the variables it draws at random (its grab's family, its art variants);
// a position is then set by the hook (its counter and its state, before its
// own lines run), the path waiting for her states. Every reset removes it;
// with several pairs it plays only in an edge slot, him facing the other
// pairs, so it spawns toward the edge.
//
// A RECEIVER'S HELPER (a pair whose receiver is an assist helper of the
// receiving character, a receiver of her own: Dr. Kira's Chichi): the root is
// loaded; every read of "her" goes to the helper (Lua helper(id) inside her
// root). After the place (he in front facing the screen edge, her root behind
// him facing it too, neither turning: NoAutoTurn, or his grab's own
// ChangeState turns him to her root and his grab takes her root), the hook
// asserts her root's summon command on the root; she runs in from that edge,
// and once she stands ready (a taunt) the hook stands her in front of him and
// he grabs her. Every reset removes her; she is summoned again for every grab
// (her taunt lasts seconds; after a scene she is left in her root's states as
// her root's body). His explods on her draw from her root's table, where her
// root's bridge never reaches (his intro's 43434: Kira's close-up): the
// hook's own [Statedef +1], the file's last section, removes those the data
// lists by id, after her state runs and before anything is drawn.
//
// UP TO FOUR PAIRS side by side, as Simul teams (givers P1/P3/P5/P7 on side
// 1, receivers P2/P4/P6/P8 on side 2), each with its own driver state: every
// pair plays its own scene every frame, and the keys act on the ACTIVE one.
// The engine adds a character only when a match starts, so adding, removing
// or changing a pair reloads the match; pairs that stay keep their characters
// loaded (selectChar's existed=1) and show their scene again from a fresh
// grab, with the round intros cut and the match run fast until each shows.
// With several pairs the camera is locked at the zoom that fits them all
// (ModifyStageVar from the hook) and each stands at its place, absolute; a
// colored, numbered marker under each pair shows which is which. + and -
// zoom in on the ACTIVE pair in steps up to normal size and a bit closer
// (the camera pinned on it, following it when 1-4 changes it); zoomed, no
// fighter is pushed back into view and only the active pair moves the
// camera, so the other pairs play on beside the view. One pair alone plays
// exactly as before (zoom is for several pairs).
//
// THE MOUSE (several pairs; an engine with Lua mouseOver - the modern-input
// web engine; stock 1.0.0 has none, and there the gallery has no drag): a
// press on a pair makes it the active one and, held, drags it sideways. The
// engine gives Lua no pointer position, only "is the pointer inside this
// rectangle" (mouseOver), so the script halves a rectangle across the fight
// to find the pointer's x. The pair moves by the pointer's step from where
// it is - giver and receiver the same step in the same frame (the hook's
// _gal_dx, PosAdd), so a bound scene stays bound and plays on - and its
// place (G.dx on its slot's) is where every later grab of it stands. Pairs
// keep DRAG_SEP apart and their order, inside the view while the screen
// bounds them, and inside the stage's art; zoomed, the camera does not
// follow while a pair is dragged. A step placed from the screen's edge and a
// receiver's helper's pair are not dragged.
//
// CONTROLS are hotkeys, most on one side of the keyboard, and they move along
// each step's place (gallerydata.js NAVIGATION: position, version, speed,
// climax, stage): Left / Right the previous / next position, Up / Down its
// previous / next version (in place), Delete / End one speed slower / faster
// (auto is the top speed where he has it), Space the climax on or off, Home
// the next stage; Page Up / Page Down the previous / next pair (the only keys
// that reload); 1-4 the active pair; + / - the zoom on it (several pairs);
// Insert the overlay on or off (H too); Tab the pair picker (the fight paused
// behind it: Enter replaces the active pair or shows a position of a pair on
// screen, Insert adds one beside, Delete takes the active pair off); Esc
// leaves, as it leaves any mode with no pause menu. A key with nothing to do
// here says so on the status line. The arrows are P2's keys, and P2 is off
// in the gallery (no receiver takes a player's input). P1's controls drive
// the ACTIVE pair's giver, as the Scene Viewer
// hands them over; the other givers take none. Every key is taken when the
// mode starts and acts only in its game mode; Space, which the engine's debug
// script binds, is handed back to it as it was when the gallery is left.
//
// THE SCRIPT'S REGISTERS: gopher-lua caps a function at 200 registers (its
// locals and the temporaries of its widest expression), and the generated
// script's main chunk runs close to that cap; a script over it never loads
// ("gallery did not start"). So its top-level locals are kept few: its
// settings are fields of K, its colors of COL and its draw caches of UI (all
// three declared right after DATA's guard), its state lives in tables (G,
// MATCH, LEAN), and the -hgallery autostart runs in a function of its own. A
// new setting or piece of state is a field of one of these tables, never a
// new top-level local. tools/luacheck.go --room <marker> counts the top-level
// locals still free after a line: 44 after LEAN on the Main build when the
// rule was made (5 before it); the tests ask for at least 30.
//
// PROTOTYPE MODES (gallerymodes/: mob givers, characters that are galleries,
// KO scenes) ride inside these two files, through seams that do nothing for
// a step of no mode; with no mode on, the hook is the core's alone, byte
// for byte, and the script differs only by the seams. A mode's step or action
// carries `ext: <id>` and its own fields under step[<id>]; the build keeps it
// only while its Mods tab row is on (trimData: 'its mode is off'), and marks
// it on the overlay and in the picker ("[ko] ..."). Two step fields are the
// core's for any step: `withCtrl` (his commands act while he stands in his
// basic states with control - a command his -1 takes only on ctrl) and
// `noGrab` (no changeState: the path starts after the place, and until her
// first scene shows, being out of one is where it starts, within its
// patience). What a mode adds:
//   trimStep / trimAction  checks its fields and copies them for the runtime
//   lua(t, lib)            a chunk `MODE.add('<id>', function() ... return M
//                          end)`, placed after every core local (its own
//                          locals are its function's registers, never the
//                          main chunk's); it may add its phases to
//                          SETUP_PHASES
//   zss(t, lib)            lines in the -4 block, blocks after the companions'
//                          and in [StateDef +1], and GATES on four core lines
//                          (no KO, life refill, intro cut, receiver input:
//                          several modes' conditions ANDed)
// and its runtime hooks, each called through MODE.run (an error switches that
// mode off for the session; its steps stop with 'its mode is off'): place(s)
// stands the pair; grab(s) in place of changeState(entry); drive(s, phase)
// for its own phases '<id>:<name>' (another step's phase is placed again);
// inScene(s) widens the scene test (never narrows it); act(a, s) acts for one
// of its actions (true hands the tick on to the command or jump; done,
// patience, from and fromAnim stay the core's); status(a, phase) its overlay
// words; tick(s) every driven tick after the driver; live(s) runs the driver
// outside round state 2; inPlace(prev, s) for a move between its steps;
// reset(s) at every reset (every mode's), frame() every match tick,
// match(LOAD) before a match loads, after(won) when a match ended by itself
// ({ what = 'again' }: the same pairs again, kept). Its per-pair state is
// G.m only, its maps _gal_<id>_*. A mode that fails at build time is left
// out and the files made again without it (buildGalleryFiles).
//
// THE FIX PASS (2026-10-07; gallerydata.js THE FIX PASS reads each rule from
// the files, this file plays it; a step without the field plays as before):
//   GRAB REACH - a grab that misses from the default stand (a dash, a run, a
//     far box) carries `reach`, the distance (320-wide units) the pair stands
//     apart. One pair: that far apart around the camera, at most the view
//     less 20 a side ('place reach N' in the log). Several pairs: that far
//     apart at the pair's place, absolute; past REACH_MID (110) only in an
//     edge slot, the far left mirrored so the lunge goes toward the edge
//     (wide), past REACH_EDGE (150) only with one pair on screen (alone: said
//     on screen). Its scene ends where she stood, so it learns no lean.
//   AIR START - a grab state with air physics, entered standing, would land
//     at once; `air` { y, vx, vy } is where his own lead's arc (or his jump's
//     apex) has him. The driver asks on the frame of the grab, and the hook
//     lifts him there before the state's first tick (over its header's
//     velset). Its lines are in the hook only when a step has air.
//   COMMAND ALIASES - commands one key of his makes true together (the
//     pair's `cmdAlias`: dragon_futa2's holdfwd and holdfwd2) are one number,
//     and the hook asserts every name of it on one line: the engine's
//     AssertCommand makes only the name it is given true, and his AI detector
//     reads `holdfwd ^^ holdfwd2` (true only when one of them is). Her root's
//     command never takes his aliases; a companion's line names the primary.
//   THE HELD INTRO - an intro still running DATA.introMax (600) ticks into the
//     match, before the fight first starts (a helper that asserts the intro
//     flag every frame and goes only for an AI: FutaRB Taokaka's 256), is
//     skipped as a player's button skips it in the engine (runIntroSkip):
//     the hook's cut and purge, held until round state 2.
//   PRESS SUMMONS - a Helper of his -1 on one button with control (`noGrab`,
//     `withCtrl`: Marasama's creatures) is pressed while he stands; the
//     press is not made again while the helper it calls (`clear`) is out.
//   And for a summon's way in, the log follows its helper every 30 ticks
//     ('enter: helper <id> in <state> at x ...', him and her): a diagnostic.
//   ANOTHER STAND - a scene key that lands while a grab is on its way (the
//     place made, or the grab about to enter) takes the new step's entry
//     there; a step that stands elsewhere (LEAN.stand: its place, reach,
//     edge-only or wide flag, companion, a mode's own place) is placed again
//     first ('another stand: placed again'), so its first try is not made
//     from the old stand (Creatures' worm, reach 107, after quick ] steps).
//   THE SCENE'S END, A GRACE - she out of his states counts as the scene's
//     end only after K.GRACE (3) ticks while he is still in a state of his
//     own (not a basic one; LEAN.ended): a re-grab whose HitDef names no
//     state of hers leaves her a tick in her own get-hit state until his next
//     state's TargetState takes her back (Murakami's 2904 -> 2905 -> her 2925).
//   A STEP GIVEN UP LEAVES NOTHING PLAYING - 'stuck' asks his summoned
//     helpers gone for as long as it lasts (the kill list, as a reset does),
//     stands both up two frames on where anything still runs, and cleans his
//     leftover explods meanwhile: a Monsters creature that never arrived in
//     time walked on and played its scene under the note.
//   THE APPROACH - a signaled grab's helper that crawls to her (the step's
//     `approach`: its walking state and the body distance its own line goes
//     on at) is stood there by the hook while the driver waits for her scene;
//     with several pairs, beside her first where its P2 is another receiver.
//   A CUTSCENE INTRO - a pair's `cutscene` (a helper of his that holds the
//     intro and goes only by its own time, past INTRO_MAX: Goblin Party's
//     guild) is cut on round state 1's first frame instead of after the wait;
//     the purge takes helpers' explods and texts with them, as the engine's
//     own intro skip does.
//
// MURAKAMI'S ROUND (2026-10-08; gallerydata.js and galreach.js read each rule):
//   THE SET OUTLASTS THE HOLD - a variable the setup holds that an action
//     sets (a gauge climax: Murakami's var(25), held at 0, set to 12000 once
//     in his hold) is not held again in the hook's -1 on that frame (the set
//     marks its slot in -4, _gal_w<k>; -1 reads and clears the mark): his
//     state reads the set value. Every "gauge full" step had ended before it
//     showed since the -1 block came.
//   AN ANTI-AIR GRAB - a step's `lift` (her height, her own units, and the
//     action she is held on) has the hook hold her in the air in its own
//     common state (LIFT_STATE) from the place until his grab takes her: his
//     high grabs (484 "grab c", 419) caught nobody standing.
//   A SCENE IN THE AIR - a step's `high` (how high his feet go in its scene,
//     320 units) zooms one pair's view out while it is grabbed and shown
//     (camView), and gives the stage its own zoom back after it: his winged
//     demon's scene played above the view.
'use strict';

// The mode's file sits in the folder that holds every add-on of the Studio's:
// modmgr.js VPATHS, the add-ons' registry, names the same string
// (tools/test-mods-build.js checks the two agree), and its Mods tab can switch
// the gallery off ('hgallery').
const GALLERY_LUA_VPATH = 'external/mods/mugen-studio/hgallery.lua';
const GALLERY_ZSS_VPATH = 'data/hgallery.zss';
// THE GALLERY'S FONT (the modern-input text only: its on-screen controls).
// fontNew looks in the screenpack's folder (and its font/) before the game's
// font/, so a pack that ships its own f-6x9.def replaces the engine's under
// the gallery's text (the net menu met a 14x14 italic one: netmenu.js THE
// FONT). The build ships the engine's f-6x9.def again under a name no pack
// has; its glyphs (File = f-6x9.sff) are found beside it, the engine's
// font/f-6x9.sff. The script falls back to f-6x9.def without the file.
const GALLERY_FONT_VPATH = 'font/hgallery-6x9.def';
function galleryFontDef() {
  return [
    '; The engine\'s 6x9 font (font/f-6x9.def), under a name no screenpack ships,',
    '; for the H gallery\'s on-screen controls (' + GALLERY_LUA_VPATH + '). Written by Mugen Studio.',
    '',
    '[FNT v2]',
    'fntversion = 2,00',
    'name = "6x9 variable"',
    '',
    '[Def]',
    'Type = bitmap',
    'BankType = palette',
    'Size = 5,8',
    'Spacing = 1,2',
    'Offset = 0,0',
    'File = f-6x9.sff',
    '',
  ].join('\r\n');
}
// The gallery's own stance, a common state in that file: a receiver with no
// body at rest (gallerydata restStance) stands in it so a grab finds her.
const STANCE_STATE = 9119901;
// AN ANTI-AIR GRAB: the common state that holds her in the air for a grab
// whose box is over her head (gallerydata.js `lift`).
const LIFT_STATE = 9119902;
// Its own [Common] key: States1 is the desktop Scene Viewer's hook, States2 an
// imported build's own common states.
const GALLERY_STATES_KEY = 'States7';

// Slots the hook has for variables: the pair's setup (held every frame) and a
// path action's one-shot sets. The data asks for few; more are dropped.
const MAX_SETUP = 8;
// THE HOLD: how many ticks before a clock runs out the scene goes back in.
const K_HOLD_LEAD = 3;
const MAX_SETS = 4;
const DEFAULT_PATIENCE = 600;
// GRAB REACH: a grab that connects only from further off than the default
// stand (gallerydata.js `reach`, 320-wide units) plays, with several pairs on
// screen, only in an edge slot past REACH_MID and only alone past REACH_EDGE
// (its lunge would carry it into the pair beside it).
const REACH_MID = 110, REACH_EDGE = 150;
// THE HELD INTRO: an intro still running after this many ticks of the match
// (a helper that asserts the intro flag every frame) is skipped the way a
// player's button skips it.
const INTRO_MAX = 600;

// The overlay's font draws ASCII; anything else becomes '?'.
// The overlay's font draws ASCII, and '_' as a filled block: a space reads better.
const ascii = (s) => String(s == null ? '' : s).replace(/_/g, ' ').replace(/[^\x20-\x7e]/g, '?');

// A Lua literal for plain data: numbers, strings, booleans, arrays, objects.
// Strings keep their bytes (a JS string of latin1 bytes, as command names
// are) but the script stays ASCII: anything outside printable ASCII is a
// three-digit decimal escape.
const LUA_RESERVED = new Set(['and', 'break', 'do', 'else', 'elseif', 'end', 'false', 'for', 'function', 'goto', 'if', 'in',
  'local', 'nil', 'not', 'or', 'repeat', 'return', 'then', 'true', 'until', 'while']);
function luaStr(s) {
  return '"' + String(s).replace(/[\\"]/g, (c) => '\\' + c)
    .replace(/[^\x20-\x7e]/g, (c) => '\\' + String(c.charCodeAt(0) & 0xff).padStart(3, '0')) + '"';
}
function toLua(v, ind) {
  ind = ind || '';
  if (v === null || v === undefined) return 'nil';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '0';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'string') return luaStr(v);
  const inner = ind + '  ';
  if (Array.isArray(v)) {
    if (v.every((x) => typeof x !== 'object' || x === null)) return '{' + v.map((x) => toLua(x)).join(', ') + '}';
    return '{\n' + v.map((x) => inner + toLua(x, inner) + ',').join('\n') + '\n' + ind + '}';
  }
  const keys = Object.keys(v).filter((k) => v[k] !== undefined && v[k] !== null);
  return '{' + keys.map((k) => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(k) && !LUA_RESERVED.has(k) ? k : '[' + luaStr(k) + ']') + ' = ' + toLua(v[k], inner)).join(', ') + '}';
}

const ints = (a) => (Array.isArray(a) ? a.filter(Number.isInteger) : []);
// A HitBy/NotHitBy value the hook may write: state types, then attack types
// (`,HP`, `SCA,NA,SA`), nothing else.
const HITBY_VALUE = /^(?:[SCA]+|[SCA]*(?:\s*,\s*(?:[NSH][ATP]|A[ATP]))+)$/i;

// A command name the hook can assert: the exact bytes of the .cmd name, as a
// latin1 JS string. A double quote cannot be written inside the ZSS string, a
// line break would end it, and a character above 0xff is not a byte (a name
// that was decoded somewhere on the way no longer matches his .cmd).
const cmdOk = (c) => typeof c === 'string' && c.length > 0 && !/["\r\n\0]/.test(c) && !/[^\x00-\xff]/.test(c);

// One variable request: { k: 1 var | 2 fvar, i: index, v: value }, or null.
function varReq(e) {
  if (!e || (e.kind !== 'var' && e.kind !== 'fvar') || !Number.isInteger(e.index) || e.index < 0 || typeof e.value !== 'number' || !Number.isFinite(e.value)) return null;
  return { k: e.kind === 'var' ? 1 : 2, i: e.index, v: e.value };
}

// ---- prototype modes (gallerymodes/) -------------------------------------------
// A mode's id is a step's and an action's field (its own runtime fields sit
// under it), so it is never one of theirs. The four core lines of the hook a
// mode may gate (buildGalleryZss).
const MODE_ID = /^[a-z][a-z0-9]{1,11}$/;
const MODE_TAKEN = new Set(['entry', 'group', 'label', 'verdict', 'states', 'path', 'alsoStates', 'anims', 'endStates', 'leaf', 'place',
  'clear', 'clearAlso', 'edgeOnly', 'proj', 'setup', 'companion', 'reroll', 'ext', 'withCtrl', 'noGrab', 'nv', 'k', 'ind', 'merged',
  'show', 'set', 'hold', 'patience', 'from', 'anim', 'fromAnim', 'cmd', 'name', 'mode', 'adapt', 'jump', 'at', 'setOnly', 'wait', 'shown',
  'reach', 'reachMin', 'wide', 'alone', 'air', 'approach', 'lift', 'high']);
const MODE_GATES = ['noKo', 'refill', 'cut', 'recvInput'];
const errText = (e) => String((e && e.message) || e).split('\n')[0].slice(0, 200);
// The usable modes of a list, by id, in order (the first of an id).
function modeMap(modes) {
  const by = new Map();
  for (const M of Array.isArray(modes) ? modes : []) {
    const id = M && typeof M === 'object' ? String(M.id) : '';
    if (!MODE_ID.test(id) || MODE_TAKEN.has(id) || LUA_RESERVED.has(id)) { console.warn('H gallery: a mode without a usable id is left out (' + id + ')'); continue; }
    if (!by.has(id)) by.set(id, M);
  }
  return by;
}

// One path action for the runtime, or a reason it cannot be run. Beside the
// contract's two kinds (a command, a jump), two more are read: `set` alone
// (made once, then on - `until` optional), and `until` alone (wait for it:
// a scene that moves on by time). An action of a prototype mode (`ext`) is
// its mode's to check as well (its trimAction), and kept only while that
// mode is on (ext(id) answers its call, null when it is off).
function trimAction(a, cmdIndex, ext) {
  if (!a || typeof a !== 'object') return { bad: 'not an action' };
  const show = ints(a.until);
  const setOnly = a.cmd == null && a.jump == null && a.set != null;
  if (!show.length && !setOnly) return { bad: 'no until' };
  const out = show.length ? { show } : {};
  if (a.set != null) {
    const sets = (Array.isArray(a.set) ? a.set : []).map(varReq);
    if (!Array.isArray(a.set) || sets.some((x) => !x)) return { bad: 'bad set' };
    if (sets.length > MAX_SETS) return { bad: 'too many sets' };
    if (sets.length) out.set = sets;
  }
  // `hold`: variables of his the hook holds every frame from this action on,
  // for as long as the step is on screen - a set his own files would undo
  // (Brian's position 5, which his hub drops on its animation's end).
  if (a.hold != null) {
    const hs = (Array.isArray(a.hold) ? a.hold : []).map(varReq);
    if (!Array.isArray(a.hold) || !hs.length || hs.some((x) => !x)) return { bad: 'bad hold' };
    if (hs.length > MAX_SETS) return { bad: 'too many holds' };
    out.hold = hs;
  }
  if (Number.isInteger(a.patience) && a.patience > 0) out.patience = a.patience;
  // His states where the command acts (a button means one thing in a hub and
  // another in an insertion): elsewhere it is not asserted.
  if (ints(a.from).length) out.from = ints(a.from);
  // His animations: the action is done only when one of `anim` shows as
  // well (an anim hub: her state stays, his animation is the scene), and
  // it acts only from `fromAnim` (elsewhere, in place, he is grabbed again).
  if (ints(a.anim).length) out.anim = ints(a.anim);
  if (ints(a.fromAnim).length) out.fromAnim = ints(a.fromAnim);
  if (a.ext != null) {
    const call = ext ? ext(a.ext) : null;
    if (!call) return { bad: 'its mode is off' };
    out.ext = String(a.ext);
    const r = call('trimAction', a, out);
    if (r && r.bad) return { bad: String(r.bad) };
  }
  if (a.cmd != null && a.jump != null) return { bad: 'both a command and a jump' };
  if (a.cmd != null) {
    if (!cmdOk(a.cmd)) return { bad: 'command name the hook cannot write' };
    const mode = a.mode == null ? 'hold' : a.mode;
    if (!['hold', 'press', 'sustain', 'mash'].includes(mode)) return { bad: 'unknown mode' };
    out.cmd = cmdIndex(a.cmd);
    out.name = a.cmd;
    out.mode = mode;
    // Only a hold the data did not name may turn into a sustain when its
    // effect lets go: a named hold is a switch that must be let go (a
    // climax held on climaxes again).
    if (a.mode == null) out.adapt = true;
    return out;
  }
  if (a.jump != null) {
    if (!Number.isInteger(a.jump)) return { bad: 'bad jump' };
    out.jump = a.jump;
    if (Number.isInteger(a.at)) out.at = a.at;
    return out;
  }
  if (setOnly) {
    if (!out.set) return { bad: 'an empty set' };
    out.setOnly = true;
    return out;
  }
  out.wait = true;
  return out;
}

// ---- the keys' moves, worked out here once --------------------------------------
// Every step's `nav` (gallerydata.js NAVIGATION: its position, speed, version,
// climax and stage) becomes, for the runtime:
//   nv   { p, v, g, c, f }: its position (1-based, in order of first
//        appearance), its version and stage (1-based ranks in the position)
//        and climax; f where its climax's pictures are two finishes (his
//        climax and her orgasm);
//   k    the step each key goes to: l / r the previous / next position (the
//        same version, stage, speed and climax where the position has them,
//        else the nearest that exists; a speed by the number its label
//        names), u / d the previous / next version of this position, s / f
//        one speed slower / faster (auto is the top speed; at a climax they
//        step between its pictures where it has several, else nothing: Space
//        leaves it), c the climax on or off (off: the position's base; the
//        runtime goes back to the step the climax was turned on from where
//        it is the same position), h the next stage (it cycles). 0: the
//        position has no such axis; -1 (s / f): the slowest / fastest
//        already, (c): the position is only its climax;
//   ind  the overlay's line of what this position has, with its keys.
// Positions go around (Left from the first is the last), versions and stages
// too; speeds stop at their ends. A pair's `nav` lists its positions: the
// step each starts at (its base, what the picker's Enter shows).
const NAV_WORD = /\b(speed|phase) (\d+)\b/i;
function navFallback(p) {
  // Steps without a valid nav (a hand-written gallery): gallerydata.js's
  // deriver, on a copy.
  const steps = Array.isArray(p.steps) ? p.steps : [];
  let gd = null;
  try { gd = require('./gallerydata.js'); } catch (e) { gd = null; }
  const ok = (n) => (gd ? gd.validNav(n) : !!n && n.pos != null);
  if (steps.every((s) => !s || ok(s.nav))) return steps.map((s) => s && s.nav);
  if (gd) {
    const copy = JSON.parse(JSON.stringify({ steps }));
    gd.deriveNav(copy);
    return copy.steps.map((s) => s && s.nav);
  }
  // (No deriver: every step a position of its own.)
  return steps.map((s, i) => (s && ok(s.nav) ? s.nav : { pos: 'one-off ' + (i + 1), speed: null, ver: 0, climax: false, stage: 0 }));
}
function navTables(steps, navs) {
  const N = navs.map((n) => ({ pos: String(n.pos), speed: n.speed == null ? null : n.speed, ver: n.ver || 0, climax: n.climax === true, stage: n.stage || 0 }));
  const order = [];
  const P = new Map();
  N.forEach((n, i) => {
    if (!P.has(n.pos)) { P.set(n.pos, { p: order.length + 1, steps: [] }); order.push(n.pos); }
    P.get(n.pos).steps.push(i);
  });
  // The speed a label names ("speed 3", "phase 2").
  const said = (i) => { const m = NAV_WORD.exec(String(steps[i].label || '')); return m ? { w: m[1].toLowerCase(), n: +m[2] } : null; };
  for (const pos of P.values()) {
    const ns = pos.steps.map((i) => N[i]);
    pos.vers = [...new Set(ns.map((n) => n.ver))].sort((a, b) => a - b);
    pos.stages = [...new Set(ns.map((n) => n.stage))].sort((a, b) => a - b);
    const nums = ns.filter((n) => !n.climax && Number.isInteger(n.speed)).map((n) => n.speed);
    pos.top = nums.length ? Math.max(...nums) : 0;
    pos.auto = ns.some((n) => !n.climax && n.speed === 'auto');
    // Speeds only where there are two to step between (a base and a speed,
    // two speeds, a speed and auto): one alone is no choice (Kung Fu Girl's
    // position 7, "speed 3" only).
    pos.speeds = new Set(ns.filter((n) => !n.climax && n.speed != null).map((n) => String(n.speed))).size > 1;
    pos.climax = ns.some((n) => n.climax);
    pos.plain = ns.some((n) => !n.climax);
    // Its speeds by the numbers their labels name, where every one is named
    // so (Brian's position 5: "speed 2", "speed 3", ranked 1 and 2).
    const named = pos.steps.filter((i) => !N[i].climax && Number.isInteger(N[i].speed) && N[i].speed > 0);
    pos.byLabel = named.length > 0 && named.every((i) => said(i));
    pos.word = pos.byLabel ? said(named[0]).w : 'speed';
    pos.topSaid = named.length ? (pos.byLabel ? Math.max(...named.map((i) => said(i).n)) : pos.top) : 0;
  }
  // A speed as a number to compare: the number its label names where its
  // position names every speed so, else its rank (so Left/Right keep the
  // speed the player sees: position 4's "speed 2" -> position 5's "speed 2",
  // though that one is its first); auto after its position's top speed; a
  // climax's picture its rank; none (a climax, a position with no speeds)
  // as the base.
  const rank = (i) => {
    const n = N[i], pos = P.get(n.pos);
    if (n.speed === 'auto') return pos.topSaid + 1;
    if (!Number.isInteger(n.speed)) return null;
    return !n.climax && n.speed > 0 && pos.byLabel ? said(i).n : n.speed;
  };
  const sd = (i, j) => Math.abs((rank(i) || 0) - (rank(j) || 0));
  // Her orgasm (a finish of hers beside his climax), by its label.
  const isOrg = (j) => /^orgasm\b/i.test(String(steps[j].label || ''));
  const lex = (a, b) => { for (let x = 0; x < a.length; x++) if (a[x] !== b[x]) return a[x] - b[x]; return 0; };
  const best = (cands, key) => (cands.length ? cands.map((j) => [key(j), j]).sort((a, b) => lex(a[0], b[0]))[0][1] + 1 : 0);
  const cm = (i, j) => (N[i].climax === N[j].climax ? 0 : 1);
  const vd = (i, j) => Math.abs(N[i].ver - N[j].ver), gd = (i, j) => Math.abs(N[i].stage - N[j].stage);
  const out = steps.map((s, i) => {
    const n = N[i], pos = P.get(n.pos);
    const mine = pos.steps;
    const k = { l: 0, r: 0, u: 0, d: 0, s: 0, f: 0, c: 0, h: 0 };
    if (order.length > 1) {
      for (const [key, d] of [['l', -1], ['r', 1]]) {
        const to = P.get(order[(pos.p - 1 + d + order.length) % order.length]);
        k[key] = best(to.steps, (j) => [cm(i, j), vd(i, j), gd(i, j), sd(i, j), j]);
      }
    }
    const vi = pos.vers.indexOf(n.ver);
    // A climax of several pictures (a companion's: speed 1, 2 on its climax
    // steps) at this version and stage. His climax and her orgasm are its two
    // finishes instead: Up / Down switch between them (the owner's choice),
    // and Delete / End step only between one finisher's own pictures. At a
    // climax of one picture, Delete / End have nothing to do (Space leaves it).
    const pics = n.climax && Number.isInteger(n.speed) ? mine.filter((j) => N[j].climax && N[j].ver === n.ver && N[j].stage === n.stage && Number.isInteger(N[j].speed)) : [];
    const fin = pics.length > 1 && pics.some(isOrg) && pics.some((j) => !isOrg(j));
    const same = fin ? pics.filter((j) => isOrg(j) === isOrg(i)) : pics;
    if (fin) {
      const other = pics.filter((j) => isOrg(j) !== isOrg(i));
      k.u = k.d = best(other, (j) => [Math.abs(N[j].speed - n.speed), j]);
    } else if (pos.vers.length > 1) {
      for (const [key, d] of [['u', -1], ['d', 1]]) {
        const want = pos.vers[(vi + d + pos.vers.length) % pos.vers.length];
        k[key] = best(mine.filter((j) => N[j].ver === want), (j) => [cm(i, j), gd(i, j), sd(i, j), j]);
      }
    }
    if (same.length > 1) {
      k.s = best(same.filter((j) => N[j].speed < n.speed), (j) => [n.speed - N[j].speed, j]) || -1;
      k.f = best(same.filter((j) => N[j].speed > n.speed), (j) => [N[j].speed - n.speed, j]) || -1;
    } else if (pos.speeds && !n.climax) {
      const plain = mine.filter((j) => !N[j].climax);
      const cur = rank(i) || 0;
      k.s = best(plain.filter((j) => (rank(j) || 0) < cur), (j) => [vd(i, j), gd(i, j), cur - (rank(j) || 0), j]) || -1;
      k.f = best(plain.filter((j) => (rank(j) || 0) > cur), (j) => [vd(i, j), gd(i, j), (rank(j) || 0) - cur, j]) || -1;
    }
    // (A position that is only its climax: Space has nothing to leave to.)
    if (pos.climax && !pos.plain) k.c = -1;
    else if (pos.climax) {
      k.c = n.climax ? best(mine.filter((j) => !N[j].climax), (j) => [vd(i, j), gd(i, j), rank(j) || 0, j])
        : best(mine.filter((j) => N[j].climax), (j) => [vd(i, j), gd(i, j), rank(j) || 0, j]);
    }
    const gi = pos.stages.indexOf(n.stage);
    if (pos.stages.length > 1) {
      const want = pos.stages[(gi + 1) % pos.stages.length];
      k.h = best(mine.filter((j) => N[j].stage === want), (j) => [cm(i, j), vd(i, j), sd(i, j), j]);
    }
    // The overlay's line: only what this position has, each with its key.
    const parts = [];
    if (fin) parts.push((isOrg(i) ? 'her finish' : 'his finish') + ' Up/Dn');
    else if (pos.vers.length > 1) parts.push('ver ' + (vi + 1) + '/' + pos.vers.length + ' Up/Dn');
    if (pos.speeds && !n.climax) {
      const here = n.speed === 'auto' ? 'auto' : n.speed === 0 || n.speed == null ? 'base' : rank(i);
      parts.push(pos.word + ' ' + here + (pos.topSaid ? '/' + pos.topSaid : '') + ' Del/End');
    }
    if (same.length > 1) parts.push('picture ' + (same.map((j) => N[j].speed).sort((a, b) => a - b).indexOf(n.speed) + 1) + '/' + same.length + ' Del/End');
    if (pos.climax) parts.push(!pos.plain ? 'CLIMAX' : n.climax ? 'CLIMAX Space off' : 'Space climax');
    // (The player calls a stage MOOD - the receiver's look as it changes with
    // the finishes she takes, "stage" in the data and the nav field; the map
    // is the stage here. The level of his finish count, of the position's top one.)
    if (pos.stages.length > 1) parts.push('Home mood ' + (n.stage ? n.stage : 'base') + '/' + pos.stages[pos.stages.length - 1]);
    const nv = { p: pos.p, v: vi + 1, g: gi + 1, c: n.climax };
    if (fin) nv.f = true;   // Up / Down's note there: 'one finisher' wording
    return { nv, k, ind: parts.length ? parts.join('  ') : 'nothing more in this position' };
  });
  // Each position's base: its first version and stage, no climax, its lowest speed.
  const positions = order.map((key) => {
    const pos = P.get(key);
    const b = pos.steps.slice().sort((x, y) => lex([pos.vers.indexOf(N[x].ver), pos.stages.indexOf(N[x].stage), N[x].climax ? 1 : 0, rank(x) || 0, x],
      [pos.vers.indexOf(N[y].ver), pos.stages.indexOf(N[y].stage), N[y].climax ? 1 : 0, rank(y) || 0, y]))[0];
    return { b: b + 1 };
  });
  return { steps: out, positions };
}

// What the runtime needs of gallerydata.js's output, and nothing else: names
// made safe for the overlay, steps kept only when every action of their path
// can be run, the build's command names numbered for the hook.
//
// Version 2 (the only interface): steps carry a `path`. Version 1 data (no
// path) is read as far as it goes: a grab alone is a grab with an empty path,
// a jump is a one-action path, and a held or pressed input letter - which
// names no command - is dropped.
//
// PROTOTYPE MODES (`modes`: the modules gallerymodes/index.js enabled()
// answers; none by default). A step or action of a mode (`ext: <id>`) is kept
// only while its mode is on ('its mode is off' otherwise), and its mode's
// trimStep(s, out, T) / trimAction(a, out, T) check it and copy its own
// fields, ready for the runtime, into out[<id>] ({ bad: why } drops the
// step). T = { cmdIndex, varReq, ints, cmdOk, ascii, data(), pair }: data()
// is the mode's object for this build (t.modeData[<id>], read by its lua and
// zss), pair the data's pair. A step's `withCtrl` and `noGrab` are the
// core's (any step may carry them). A mode whose hook throws is reported in
// `failed` (its steps dropped): buildGalleryFiles then builds without it.
function trimData(data, stage, modes) {
  // COMMAND ALIASES (gallerydata.js, the pair's `cmdAlias`): the commands one
  // key of his makes true together (dragon_futa2's holdfwd and holdfwd2, both
  // `/$F`) are one number, and the hook asserts every name of it - the
  // engine's AssertCommand makes only the name it is given true, and his AI
  // detector reads `holdfwd ^^ holdfwd2`. A number is a name with its aliases
  // (sorted): `commands` keeps the names (the companions' lines and the log
  // use them), `cmdAliases` the rest, in the same order. cmdIndex(name) takes
  // the current pair's aliases of the name; cmdIndex(name, []) none (her
  // root's command is hers, never one of his).
  const commands = [], cmdAliases = [];
  let pairAlias = null;
  const cmdIndex = (name, aliases) => {
    const own = aliases !== undefined ? aliases : (pairAlias && Object.prototype.hasOwnProperty.call(pairAlias, name) ? pairAlias[name] : []);
    const al = [...new Set((Array.isArray(own) ? own : []).filter((n) => cmdOk(n) && n !== name))].sort();
    let i = commands.findIndex((n, j) => n === name && cmdAliases[j].length === al.length && cmdAliases[j].every((x, k) => x === al[k]));
    if (i < 0) { commands.push(name); cmdAliases.push(al); i = commands.length - 1; }
    return i + 1;
  };
  // (A step dropped takes back the numbers it added.)
  const cutCmds = (n) => { commands.length = n; cmdAliases.length = n; };
  // The modes: each one's hooks called with its own T, a throw switching it
  // off for the rest of this build.
  const by = modeMap(modes);
  const modeData = {}, failed = new Map();
  let curPair = null;
  const modeCall = (id) => {
    const M = by.get(String(id));
    if (!M || failed.has(M.id)) return null;
    const T = { cmdIndex, varReq, ints, cmdOk, ascii, data: () => (modeData[M.id] || (modeData[M.id] = {})), pair: curPair };
    return (fn, x, out) => {
      if (typeof M[fn] !== 'function') return null;
      try { return M[fn](x, out, T); } catch (e) { failed.set(M.id, fn + ': ' + errText(e)); return { bad: 'its mode failed' }; }
    };
  };
  // A companion's pins, numbered for the hook: one line per distinct set
  // (its id and the variables it holds on it).
  const pinSets = [];
  const pinIndex = (id, pins) => {
    if (!pins.length) return 0;
    const key = id + ':' + JSON.stringify(pins);
    let i = pinSets.findIndex((p) => p.key === key);
    if (i < 0) { pinSets.push({ key, id, pins }); i = pinSets.length - 1; }
    return i + 1;
  };
  // Its positions set by the hook, numbered the same way: one line each.
  const goSets = [];
  const goIndex = (g) => {
    const key = JSON.stringify(g);
    let i = goSets.findIndex((x) => x.key === key);
    if (i < 0) { goSets.push({ key, g }); i = goSets.length - 1; }
    return i + 1;
  };
  // Its animations held by the hook (a speed, a climax picture), numbered the
  // same way: one set of lines each.
  const holdSets = [];
  const holdIndex = (id, h) => {
    const key = JSON.stringify([id, h.state, h.anim, h.skip]);
    let i = holdSets.findIndex((x) => x.key === key);
    if (i < 0) { holdSets.push({ key, h: { id, state: h.state, anim: h.anim, skip: h.skip } }); i = holdSets.length - 1; }
    return i + 1;
  };
  // A step's re-rolls (a random branch of his that draws her root, tested on
  // the tick it is drawn: gallerydata's rootBranchShut), numbered the same
  // way: one set per distinct list, one hook line per re-roll in it.
  const rerollSets = [];
  const rerollIndex = (list) => {
    const key = JSON.stringify(list);
    let i = rerollSets.findIndex((x) => x.key === key);
    if (i < 0) { rerollSets.push({ key, list }); i = rerollSets.length - 1; }
    return i + 1;
  };
  // A signaled grab's approach (its helper, the state it walks in, the body
  // distance its line goes on at), numbered the same way: one hook block each.
  const apprSets = [];
  const apprIndex = (a) => {
    const key = [a.id, a.state, a.dist].join(':');
    let i = apprSets.findIndex((x) => x.key === key);
    if (i < 0) { apprSets.push({ key, a: { id: a.id, state: a.state, dist: a.dist } }); i = apprSets.length - 1; }
    return i + 1;
  };
  // A pair's swaps (HIS OTHER BRANCH: his action played on her in place of
  // the one his probe picks, which draws nothing of her), numbered the same
  // way: one hook block per distinct list, one line per swap in it.
  const swapSets = [];
  const swapIndex = (list) => {
    const key = JSON.stringify(list);
    let i = swapSets.findIndex((x) => x.key === key);
    if (i < 0) { swapSets.push({ key, list }); i = swapSets.length - 1; }
    return i + 1;
  };
  const companions = new Map();   // id -> the command numbers asserted on it
  const pairs = [];
  const dropped = [];
  const kills = [];
  const holdHelpers = [];   // the helpers a pair with a hold calls: they re-send her state too
  const helpers = [];    // helper receivers' ids: one hook block each
  const helperHides = new Map();   // helper receiver's id -> his explod ids removed on her
  const badgeSets = [];   // { key, id, sets }: a helper receiver's badge slots, numbered from 1
  let setupSlots = 0, setSlots = 0;
  for (const p of (data && Array.isArray(data.pairs) ? data.pairs : [])) {
    if (!p || !p.giver || !p.receiver || !p.giver.select || !p.receiver.select) continue;
    curPair = p;
    pairAlias = p.cmdAlias && typeof p.cmdAlias === 'object' && !Array.isArray(p.cmdAlias) ? p.cmdAlias : null;
    // A receiver's helper the hook cannot summon drops the pair before its
    // steps add anything to the build's lists (commands, pins, companions).
    const h = p.receiver.helper;
    if (h != null && (!h || !Number.isInteger(h.id) || h.id < 0 || !cmdOk(h.cmd) || !ints(h.ready).length)) {
      dropped.push({ label: String(p.receiver.display || p.receiver.select), why: 'a helper receiver the hook cannot summon' });
      continue;
    }
    const steps = [];
    // Each step's place on the keys' axes (derived where the data has none),
    // kept beside the steps that stay.
    const navs = navFallback(p), keptNavs = [];
    for (const [si, s] of (Array.isArray(p.steps) ? p.steps : []).entries()) {
      if (!s || !Number.isInteger(s.entry)) continue;
      const states = ints(s.states);
      if (!states.length) continue;
      let path = s.path;
      if (path === undefined) {
        // Version 1.
        if (s.input) { dropped.push({ label: s.label, why: 'a version-1 input letter names no command' }); continue; }
        path = Number.isInteger(s.jump) ? [{ jump: s.jump, at: s.at, until: states }] : [];
      }
      if (!Array.isArray(path)) continue;
      // A prototype mode's step: only while its mode is on.
      const stepCall = s.ext != null ? modeCall(s.ext) : null;
      if (s.ext != null && !stepCall) { dropped.push({ label: s.label, why: 'its mode is off' }); continue; }
      // The names this step would add, added only if the whole step is kept.
      const before = commands.length;
      const acts = path.map((a) => trimAction(a, cmdIndex, modeCall));
      const bad = acts.find((a) => a.bad);
      if (bad) {
        cutCmds(before);
        dropped.push({ label: s.label, why: bad.bad });
        continue;
      }
      // A partial step carries how much of the time she is drawn ("partial
      // 43%": the data's `shown`, the least of its partial states' shares).
      const shown = s.verdict === 'partial' && Number.isInteger(s.shown) && s.shown >= 0 && s.shown <= 100 ? ' ' + s.shown + '%' : '';
      const step = { entry: s.entry, group: ascii(s.group || ''), label: ascii(s.label || ''), verdict: ascii((s.verdict || '') + shown), states, path: acts };
      const also = ints(s.alsoStates);
      if (also.length) step.alsoStates = also;
      // An anim hub's step shows only while his animation is one of these.
      const anims = ints(s.anims);
      if (anims.length) step.anims = anims;
      // Where the step ends once shown (a scene it never leaves: Bao's
      // position 3 climax at a stage of 4 or more ends in her lie-down
      // 65069): a while there and it is grabbed again, from its start.
      const ends = ints(s.endStates).filter((C) => also.includes(C));
      if (ends.length) step.endStates = ends;
      // A leaf (her orgasm: his way back is a key no path presses): leaving
      // it grabs again at once.
      if (s.leaf === true) step.leaf = true;
      // Where the pair stands for the grab, when the default will not do
      // (Minotaur's horse walks in from the screen edge he faces): her
      // `front` px from that edge, him `gap` px behind her.
      if (s.place && Number.isFinite(s.place.front)) step.place = { front: s.place.front, gap: Number.isFinite(s.place.gap) ? s.place.gap : 60 };
      // A helper of his that must be gone before the grab (a leftover horse
      // blocks the next summon).
      if (Number.isInteger(s.clear) && s.clear >= 0) step.clear = s.clear;
      // THE APPROACH of a signaled grab's helper (gallerydata.js SIGNALED
      // GRABS): the state it walks to her in and the body distance its own
      // line goes on at. The hook stands it there (by number: one block per
      // distinct approach in the build) while the driver waits for her scene.
      if (s.approach != null) {
        const ap = s.approach, ok = (n, lo) => Number.isInteger(n) && n >= lo;
        if (!ok(ap.id, 0) || ap.id !== step.clear || !ok(ap.state, 0) || !ok(ap.dist, 0)) {
          cutCmds(before);
          dropped.push({ label: s.label, why: 'an approach the hook cannot make' });
          continue;
        }
        step.approach = { n: apprIndex(ap), id: ap.id, state: ap.state };
      }
      // (A nested summon's other helpers, the ones that spawn it: removed at
      // every reset with it.)
      const alsoIds = ints(s.clearAlso).filter((id) => id !== step.clear);
      if (alsoIds.length) step.clearAlso = alsoIds;
      // A summon whose helper walks toward her or can take his own side
      // (Kur0maru's dogs): with several pairs, only in an edge slot.
      if (s.edgeOnly === true) step.edgeOnly = true;
      // A grab that is a projectile's hit (Kur0maru's gas): the engine
      // removes a projectile past the view's edge, so zoomed on another pair
      // it is grabbed only while its pair is in view.
      if (s.proj === true) step.proj = true;
      // GRAB REACH (gallerydata.js, galreach.js): a grab that misses from the
      // default stand (a dash, a run, a far box) stands the pair `reach` apart
      // (320-wide units), `reachMin` the least that connects; never with a
      // place of its own. Past REACH_MID it plays, with several pairs, only in
      // an edge slot (wide), past REACH_EDGE only alone on screen (alone).
      if (Number.isFinite(s.reach) && s.reach > 0 && !step.place) {
        step.reach = Math.round(s.reach);
        if (Number.isFinite(s.reachMin)) step.reachMin = Math.round(s.reachMin);
        if (step.reach > REACH_MID) step.wide = true;
        if (step.reach > REACH_EDGE) step.alone = true;
      }
      // AIR START: a grab state of his with air physics starts where his lead's
      // arc (or his jump's apex) puts him, in his own units: the hook lifts him
      // there as he enters it.
      if (s.air && typeof s.air === 'object' && ['y', 'vx', 'vy'].every((k) => Number.isFinite(s.air[k]))) {
        const r3 = (x) => Math.round(x * 1000) / 1000;
        step.air = { y: r3(s.air.y), vx: r3(s.air.vx), vy: r3(s.air.vy) };
      }
      // AN ANTI-AIR GRAB: a grab whose box is over her head stands her in the
      // air (`lift`: her own units, up negative, on her action `anim`) from
      // the place until his grab takes her.
      if (s.lift && typeof s.lift === 'object' && Number.isFinite(s.lift.y) && s.lift.y < 0 && Number.isInteger(s.lift.anim) && s.lift.anim >= 0) {
        step.lift = { y: Math.round(s.lift.y * 100) / 100, anim: s.lift.anim };
      }
      // A SCENE IN THE AIR: how high his feet go in it (320 units, up
      // negative); one pair's view zooms out while it plays.
      if (Number.isFinite(s.high) && s.high < 0) step.high = Math.round(s.high);
      // His commands act while he stands in his basic states with control (a
      // command his -1 takes only on ctrl); the path starts with no grab.
      if (s.withCtrl === true) step.withCtrl = true;
      if (s.noGrab === true) step.noGrab = true;
      // A prototype mode's step: its mode checks it and adds its own fields.
      if (stepCall) {
        step.ext = String(s.ext);
        const r = stepCall('trimStep', s, step);
        if (r && r.bad) { cutCmds(before); dropped.push({ label: s.label, why: String(r.bad) }); continue; }
      }
      // The step's own setup, over the pair's (a companion's steps release
      // the gate the pair holds shut).
      if (Array.isArray(s.setup) && s.setup.length) {
        const own = s.setup.map(varReq);
        if (own.some((x) => !x)) { cutCmds(before); dropped.push({ label: s.label, why: 'bad setup' }); continue; }
        step.setup = own;
      }
      // A COMPANION's step (his helper, driven in his stance): its id, the
      // command of its own that starts its grab (asserted on it by the
      // hook), the idle states it grabs from, the variables pinned on it
      // (by number: a line of the hook's), and whether it spawns behind him.
      if (s.companion != null) {
        const c = s.companion;
        const pins = (Array.isArray(c.pins) ? c.pins : []).map(varReq);
        const ready = ints(c.ready);
        if (!Number.isInteger(c.id) || c.id < 0 || !cmdOk(c.cmd) || !ready.length || pins.some((x) => !x)) {
          cutCmds(before);
          dropped.push({ label: s.label, why: 'a companion the hook cannot drive' });
          continue;
        }
        // Its position set by the hook (its counter and the position's state,
        // from the states its counter's line names, unless already at home).
        let go = null;
        if (c.go != null) {
          const g = c.go, v = varReq(g), rng = (r) => Array.isArray(r) && r.length > 0 && r.every((x) => Array.isArray(x) && x.length === 2 && x.every((n) => Number.isInteger(n) && n >= 0) && x[0] <= x[1]);
          if (!v || !Number.isInteger(g.state) || g.state < 0 || !rng(g.in) || !rng(g.home)) {
            cutCmds(before);
            dropped.push({ label: s.label, why: 'a companion position the hook cannot set' });
            continue;
          }
          go = { id: c.id, set: v, state: g.state, in: g.in.map((r) => r.slice()), home: g.home.map((r) => r.slice()) };
        }
        // Its animation held by the hook in the position's state (a speed, a
        // climax picture): the animation, and the elements whose first tick it
        // skips ([element, to element, at elemtime]).
        let hold = null;
        if (c.hold != null) {
          const h = c.hold, n = (x, lo) => Number.isInteger(x) && x >= lo;
          const skip = Array.isArray(h.skip) ? h.skip : [];
          if (!n(h.state, 0) || !n(h.anim, 0) || !skip.every((x) => Array.isArray(x) && x.length === 3 && n(x[0], 1) && n(x[1], 1) && n(x[2], 0))) {
            cutCmds(before);
            dropped.push({ label: s.label, why: 'a companion animation the hook cannot hold' });
            continue;
          }
          hold = { state: h.state, anim: h.anim, skip: skip.map((x) => x.slice()) };
        }
        const ci = cmdIndex(c.cmd);
        step.companion = { id: c.id, cmd: ci, name: c.cmd, ready, pins, pin: pinIndex(c.id, pins), who: ascii(c.name || 'helper ' + c.id) };
        if (go) step.companion.go = goIndex(go);
        if (hold) step.companion.hold = holdIndex(c.id, hold);
        // The art variant her state reads of his only on its first tick: a
        // move in place that changes it, her state unchanged, grabs again.
        if (typeof c.art === 'string' && c.art) step.companion.art = ascii(c.art);
        if (c.behind === true) step.companion.behind = true;
        if (!companions.has(c.id)) companions.set(c.id, new Set());
        companions.get(c.id).add(ci);
      }
      // Its re-rolls: when he has gone on from `from` to `at` on the random
      // test, the hook's +1 puts him back in `from` (it draws again) and her
      // in `her`. A malformed one drops the step (it would draw her root).
      if (s.reroll != null) {
        const ok = (r) => r && [r.from, r.at, r.her].every((n) => Number.isInteger(n) && n >= 0) && r.from !== r.at;
        const list = Array.isArray(s.reroll) ? s.reroll.filter(ok).map((r) => ({ from: r.from, at: r.at, her: r.her })) : [];
        if (!Array.isArray(s.reroll) || list.length !== s.reroll.length) { cutCmds(before); dropped.push({ label: s.label, why: 'a re-roll the hook cannot make' }); continue; }
        if (list.length) step.reroll = rerollIndex(list);
      }
      for (const a of acts) if (a.set) setSlots = Math.max(setSlots, a.set.length);
      steps.push(step);
      keptNavs.push(navs[si]);
    }
    if (!steps.length) continue;
    // Where each key goes from each step, its line on the overlay, and the
    // pair's positions.
    const nt = navTables(steps, keptNavs);
    steps.forEach((st, i) => Object.assign(st, nt.steps[i]));
    // A RECEIVER'S HELPER, a receiver of her own (Dr. Kira's Chichi): her id,
    // the command of her root's that summons her (asserted on the root by
    // the hook), and the states of hers she is ready to be grabbed in
    // (checked above). The command joins the build's list only when the pair
    // is kept.
    let rhelper = null;
    if (h != null) {
      rhelper = { id: h.id, cmd: cmdIndex(h.cmd, []), name: h.cmd, ready: ints(h.ready), who: ascii(h.name || 'helper ' + h.id) };
      // (The actions her steps draw her with, and her own states', for the
      // log's check.)
      if (ints(h.art).length) rhelper.art = ints(h.art);
      if (ints(h.own).length) rhelper.own = ints(h.own);
      // His explods on her that draw from her root's table: the hook removes
      // them on her, after her state runs (never drawn).
      const hide = [...new Set(ints(h.hideExplods).filter((n) => n >= 0))].sort((a, b) => a - b);
      if (hide.length) {
        rhelper.hide = hide;
        if (!helperHides.has(h.id)) helperHides.set(h.id, new Set());
        for (const n of hide) helperHides.get(h.id).add(n);
      }
      // Her BADGE, given by the gallery to this pair's giver (her immunity
      // lets none of his grabs through otherwise): what her own states run
      // when her enemy carries it, run by the hook after her state while her
      // root's map says so (_gal_badge = the build's number for this set).
      // Only a HitBy/NotHitBy value the hook can write and a whole time.
      const bsets = (h.badge && Array.isArray(h.badge.sets) ? h.badge.sets : []).map((x) => ({ not: !!(x && x.not), value: String(x && x.value || '').trim(),
        time: x && x.time, states: ints(x && x.states) })).filter((x) => HITBY_VALUE.test(x.value) && Number.isInteger(x.time) && x.time >= 1 && x.states.length);
      if (bsets.length) {
        const key = h.id + '|' + JSON.stringify(bsets);
        let i = badgeSets.findIndex((x) => x.key === key);
        if (i < 0) { badgeSets.push({ key, id: h.id, sets: bsets }); i = badgeSets.length - 1; }
        rhelper.badge = i + 1;
      }
      if (!kills.includes(h.id)) kills.push(h.id);
      if (!helpers.includes(h.id)) helpers.push(h.id);
    }
    // The helpers his summons call, and his companion: every reset removes
    // them (the hook, by their ids), so none carries into the next scene.
    const kill = [...new Set([...steps.map((s) => s.clear), ...steps.flatMap((s) => s.clearAlso || []), ...steps.map((s) => s.companion && s.companion.id)].filter(Number.isInteger))].sort((a, b) => a - b);
    for (const id of kill) if (!kills.includes(id)) kills.push(id);
    for (const s of steps) delete s.clearAlso;
    const setup = (Array.isArray(p.setup) ? p.setup : []).map(varReq).filter(Boolean).slice(0, MAX_SETUP);
    setupSlots = Math.max(setupSlots, setup.length);
    // A step's setup is the pair's with its own on top (the same variable
    // replaced, a new one added).
    for (const s of steps) {
      if (s.setup) {
        const extra = s.setup.filter((x) => !setup.some((e) => e.k === x.k && e.i === x.i)).length;
        if (setup.length + extra > MAX_SETUP) { s.setup = s.setup.filter((x) => setup.some((e) => e.k === x.k && e.i === x.i)); }
        setupSlots = Math.max(setupSlots, setup.length + s.setup.filter((x) => !setup.some((e) => e.k === x.k && e.i === x.i)).length);
      }
      // (Its actions' holds join the same slots once they apply.)
      const holds = s.path.flatMap((a) => a.hold || []);
      if (holds.length) {
        const all = [...setup, ...(s.setup || [])];
        for (const x of holds) if (!all.some((e) => e.k === x.k && e.i === x.i)) all.push(x);
        setupSlots = Math.max(setupSlots, Math.min(MAX_SETUP, all.length));
      }
    }
    const pair = {
      giver: { select: p.giver.select, display: ascii(p.giver.display || p.giver.name || p.giver.select) },
      receiver: { select: p.receiver.select, display: ascii(p.receiver.display || p.receiver.name || p.receiver.select) },
      counts: p.counts || {},
      steps,
      nav: nt.positions,
    };
    if (rhelper) pair.receiver.helper = rhelper;
    // (Her stance: the animation the hook holds her on in its stance state -
    // a receiver with no body at rest, gallerydata restStance.)
    if (Number.isInteger(p.receiver.stance) && p.receiver.stance > 0) pair.receiver.stance = p.receiver.stance;
    if (setup.length) pair.setup = setup;
    if (kill.length) pair.kill = kill;
    // A MUGEN-authored giver: MUGEN's hit priority, except in his states whose
    // HitDef names its own.
    if (p.p1spr && Array.isArray(p.p1spr.keep)) pair.p1spr = { keep: ints(p.p1spr.keep) };
    // HIS OTHER BRANCH (gallerydata.js): per state of his, the action of his
    // the hook plays on her in place of the one his probe picks for her.
    const swap = (Array.isArray(p.swap) ? p.swap : []).filter((x) => x && [x.state, x.from, x.to].every((n) => Number.isInteger(n) && n >= 0) && x.from !== x.to)
      .map((x) => ({ state: x.state, from: x.from, to: x.to }));
    if (swap.length) pair.swapSet = swapIndex(swap);
    // A CUTSCENE INTRO of his (gallerydata.js: a helper of his that holds the
    // intro and goes only by its own time, past the held intro's wait - Goblin
    // Party's guild, a minute): cut at once rather than after INTRO_MAX.
    const cs = p.cutscene;
    if (cs && Number.isInteger(cs.helper) && Number.isInteger(cs.ends) && cs.ends > INTRO_MAX) pair.cutscene = { helper: cs.helper, ends: cs.ends };
    // THE HOLD (gallerydata.js detectHold): the clocks that end his scenes and
    // hers, which the driver and the hook go back into a few ticks before they
    // run out. His: { s: state, k: 't' (its time) | 'a' (the end of its
    // animation), at }, hers: { s: state, at }.
    const hd = p.hold;
    if (hd && typeof hd === 'object') {
      const hisH = (Array.isArray(hd.his) ? hd.his : []).filter((x) => x && Number.isInteger(x.state) && x.state >= 0 && (x.kind === 'a' || (x.kind === 't' && x.at > K_HOLD_LEAD)) && Number.isInteger(x.at) && x.at >= 0)
        .map((x) => ({ s: x.state, k: x.kind, at: x.at }));
      const herH = (Array.isArray(hd.her) ? hd.her : []).filter((x) => x && Number.isInteger(x.state) && x.state >= 0 && Number.isInteger(x.at) && x.at > K_HOLD_LEAD)
        .map((x) => ({ s: x.state, at: x.at }));
      if (hisH.length || herH.length) {
        pair.hold = { his: hisH, her: herH };
        for (const id of steps.map((s) => s.clear).filter(Number.isInteger)) if (!holdHelpers.includes(id)) holdHelpers.push(id);
      }
    }
    pairs.push(pair);
  }
  // The modes this build carries: those with a step or an action kept, in
  // their order; each one's data object.
  const present = [...by.keys()].filter((id) => !failed.has(id) && pairs.some((p) => p.steps.some((s) => s.ext === id || s.path.some((a) => a.ext === id))));
  return { stage: stage || '', pairs, commands, cmdAliases, setupSlots, setSlots, kills: kills.sort((a, b) => a - b), dropped, helpers: helpers.sort((a, b) => a - b),
    modes: present, modeData: Object.fromEntries(present.map((id) => [id, modeData[id] || {}])), failed: [...failed].map(([id, why]) => ({ id, why })),
    helperHides: [...helperHides].sort((a, b) => a[0] - b[0]).map(([id, ids]) => ({ id, ids: [...ids].sort((a, b) => a - b) })),
    badgeSets: badgeSets.map((x) => ({ id: x.id, sets: x.sets })), holdOn: pairs.some((p) => p.hold), holdHelpers: holdHelpers.sort((a, b) => a - b),
    pinSets: pinSets.map((p) => ({ id: p.id, pins: p.pins })), goSets: goSets.map((x) => x.g), holdSets: holdSets.map((x) => x.h),
    rerollSets: rerollSets.map((x) => x.list), apprSets: apprSets.map((x) => x.a), swapSets: swapSets.map((x) => x.list),
    companions: [...companions].sort((a, b) => a[0] - b[0]).map(([id, cmds]) => ({ id, cmds: [...cmds].sort((a, b) => a - b) })) };
}

// What each mode this build carries (t.modes) adds to the two files, checked:
// lua(t, lib), its chunk, ASCII and shaped `MODE.add('<id>', function() ...
// end)` (its locals are that function's, never the main chunk's); zss(t,
// lib) -> { m4, m4blocks, p1blocks: [line], gates: { noKo?, refill?, cut?,
// recvInput?: condition } }, one line per string. lib = { toLua, luaStr,
// ascii, cmdOk }. -> { parts } or { bad: { id, why } } (a hook that throws
// or answers a shape the files cannot carry).
function modeParts(t, modes) {
  const by = modeMap(modes), lib = { toLua, luaStr, ascii, cmdOk }, parts = [];
  const oneLine = (x) => typeof x === 'string' && !/[\r\n\0]/.test(x) && !/[^\x00-\xff]/.test(x);
  for (const id of (t && t.modes) || []) {
    const M = by.get(id);
    if (!M) continue;
    const part = { id, lua: '', m4: [], m4blocks: [], p1blocks: [], gates: {} };
    try {
      if (typeof M.lua === 'function') {
        const text = String(M.lua(t, lib) || '').replace(/\r\n/g, '\n').replace(/\s+$/, '');
        if (text) {
          if (/[^\t\n\x20-\x7e]/.test(text)) return { bad: { id, why: 'its Lua chunk is not plain ASCII' } };
          if (!new RegExp("^(?:--[^\\n]*\\n)*MODE\\.add\\('" + id + "', function\\(\\)").test(text) || !/\bend\)$/.test(text)) return { bad: { id, why: 'its Lua chunk is not one MODE.add(\'' + id + '\', function() ... end)' } };
          part.lua = text;
        }
      }
      if (typeof M.zss === 'function') {
        const z = M.zss(t, lib) || {};
        for (const k of ['m4', 'm4blocks', 'p1blocks']) {
          if (z[k] == null) continue;
          if (!Array.isArray(z[k]) || !z[k].every(oneLine)) return { bad: { id, why: 'its hook lines (' + k + ') are not one line each' } };
          part[k] = z[k].slice();
        }
        for (const [g, c] of Object.entries(z.gates || {})) {
          if (c == null || c === '') continue;
          if (!MODE_GATES.includes(g) || !oneLine(c) || /[{}#;]/.test(c)) return { bad: { id, why: 'its gate ' + g + ' cannot be written' } };
          part.gates[g] = c.trim();
        }
      }
    } catch (e) {
      return { bad: { id, why: errText(e) } };
    }
    parts.push(part);
  }
  return { parts };
}

// A CHARACTER'S OWN HUD (galhud.js), hidden in the gallery: opts.hud is
// { list: [{ select, ids }] } in the build's order; a character is its index
// + 1 in it (the driver's map _gal_hud on its root, UI.hudExplods). Only in
// the modern-input text (opts.v2, else IKEMEN_V2), only for characters on a
// pair of the data, and never an id below 0 (-1 names every explod).
function hudList(opts, data) {
  const v2 = opts && opts.v2 !== undefined ? !!opts.v2 : !!process.env.IKEMEN_V2;
  if (!v2 || !opts || !opts.hud || !Array.isArray(opts.hud.list)) return [];
  const on = new Set();
  for (const p of (data && data.pairs) || []) {
    if (p.giver && p.giver.select) on.add(p.giver.select);
    if (p.receiver && p.receiver.select) on.add(p.receiver.select);
  }
  const out = [];
  for (const e of opts.hud.list) {
    const ids = ints(e && e.ids).filter((n) => n >= 0);
    if (e && typeof e.select === 'string' && on.has(e.select) && ids.length) out.push({ select: e.select, ids: [...new Set(ids)].sort((a, b) => a - b) });
  }
  return out;
}
// select -> its number, for the Lua (UI.HUDX).
function hudIndex(opts, data) {
  const o = {};
  hudList(opts, data).forEach((e, i) => { o[e.select] = i + 1; });
  return o;
}
function hudZssLines(t, opts) {
  const list = hudList(opts, t);
  if (!list.length) return [];
  const out = [];
  out.push('# CHARACTERS\' OWN HUD (gallery.js hudList, galhud.js): screen-fixed explods');
  out.push('# a character keeps up from its negative states or a HUD helper (King\'s');
  out.push('# guard gauge, a power meter) are hidden in the gallery: hidewithbars,');
  out.push('# which the engine does not draw while the bars are off (noBarDisplay,');
  out.push('# above). The driver names the character on its root (_gal_hud); its');
  out.push('# helpers read the root\'s, as their explods are their own.');
  list.forEach((e, i) => {
    const n = i + 1;
    out.push('# ' + n + ': ' + e.select.replace(/[^\x20-\x7e]/g, '?') + ' (' + e.ids.length + ')');
    for (const who of ['!isHelper && map(_gal_hud) = ' + n, 'isHelper && root, map(_gal_hud) = ' + n]) {
      out.push('ignorehitpause if ' + who + ' && gameMode = "hgallery" {');
      for (const id of e.ids) out.push('\tif numExplod(' + id + ') { modifyExplod{id: ' + id + '; hidewithbars: 1} }');
      out.push('}');
    }
  });
  out.push('');
  return out;
}

// The hook: one line per command name this build's steps use, the variable
// slots, placement, and the round kept going. `ignorehitpause` on the whole
// block: without it the block is skipped while the character is in hitpause
// (ZSS blocks default to ignorehitpause -2), and his commands, the sets and
// the life refill would lapse for those frames.
// A PROTOTYPE MODE's lines (modeParts) go in three places, each under a
// comment naming the mode: m4 inside the -4 block above (before its closing
// brace), m4blocks after the companions' blocks, p1blocks at the end (in
// [StateDef +1]). Its GATES are conditions on four core lines - no KO
// (noKo), the life refill (refill), the intro cut (cut) and the receiver's
// NoInput (recvInput): the line runs only while every mode's condition
// holds. A mode's own maps are named _gal_<id>_*. Without modes the file
// is what it always was, byte for byte.
function buildGalleryZss(t, modes, opts) {
  const lines = [];
  const L = (s) => lines.push(s);
  const mp = modeParts(t, modes);
  if (mp.bad) throw new Error('mode ' + mp.bad.id + ': ' + mp.bad.why);
  const parts = mp.parts;
  const gate = (g) => parts.filter((p) => p.gates[g]).map((p) => '(' + p.gates[g] + ')').join(' && ');
  const gatedBy = (g) => parts.filter((p) => p.gates[g]).map((p) => p.id).join(', ');
  const modeHead = (p, ind) => L(ind + '# ==== prototype mode ' + p.id + ' (gallerymodes/' + p.id + '.js): inert unless its steps ask ====');
  L('# Mugen Studio: the H gallery\'s hook, listed in save/config.ini as [Common]');
  L('# ' + GALLERY_STATES_KEY + ' beside the engine\'s own common states. Inert outside the');
  L('# gallery (' + GALLERY_LUA_VPATH + '). To remove it, delete this file AND the');
  L('# ' + GALLERY_STATES_KEY + ' line - a listed file that is missing fails character');
  L('# loading. It names this build\'s characters\' commands: generated per build.');
  L('#');
  L('# -4 runs every frame, even while a character is in another player\'s custom');
  L('# state, which is where a receiver spends the whole gallery. The driver sets');
  L('# the requests (maps) on the giver only.');
  L('[StateDef -4]');
  L('');
  L('ignorehitpause if !isHelper && gameMode = "hgallery" {');
  L('\t# Nobody is KO\'d and no bars, round calls, hit counter or lifebar');
  L('\t# action texts cover the scene (a scene lands hit after hit).');
  if (gate('noKo')) {
    L('\t# (Gated by the prototype mode ' + gatedBy('noKo') + ': only while its condition holds.)');
    L('\tif ' + gate('noKo') + ' { assertSpecial{flag: globalNoKo; flag2: noKoFall; flag3: noKoVelocity} }');
  } else L('\tassertSpecial{flag: globalNoKo; flag2: noKoFall; flag3: noKoVelocity}');
  L('\tassertSpecial{flag: noBarDisplay; flag2: skipRoundDisplay; flag3: skipFightDisplay}');
  L('\tassertSpecial{flag: noComboDisplay; flag2: noLifebarAction}');
  L('\t# Every gallery match: the round intros are cut while the driver asks');
  L('\t# (it stands both of a pair in their own standing state when the fight');
  L('\t# starts anyway).');
  if (gate('cut')) L('\t# (Gated by the prototype mode ' + gatedBy('cut') + '.)');
  L('\tif ' + (gate('cut') ? gate('cut') + ' && ' : '') + 'map(_gal_cut) && roundState = 1 && stateNo != 0 {');
  L('\t\tselfState{value: 0}');
  L('\t}');
  L('\t# ... and then, once, what the cut intros left out goes, as the engine\'s');
  L('\t# own intro skip clears it (Dr. Kira\'s slime helper stood over the next');
  L('\t# pair): his and her explods here, their helpers in the block below.');
  L('\tif map(_gal_purge) {');
  L('\t\tremoveExplod{}');
  L('\t}');
  if (gate('refill')) L('\t# (The refill gated by the prototype mode ' + gatedBy('refill') + '.)');
  L('\tif ' + (gate('refill') ? gate('refill') + ' && ' : '') + 'life < lifeMax / 2 {');
  L('\t\tlifeSet{value: lifeMax}');
  L('\t}');
  L('\t# Placement, once, when the driver asks: where to stand and which way to face.');
  L('\t# PosSet x is from the camera; with _gal_abs = 1 it is from the stage\'s');
  L('\t# center (several pairs side by side, each at its place).');
  L('\tif map(_gal_place) {');
  L('\t\tposSet{x: map(_gal_x) - map(_gal_abs) * cameraPos x; y: 0}');
  L('\t\tvelSet{x: 0; y: 0}');
  L('\t\tif facing != map(_gal_face) {');
  L('\t\t\tturn{}');
  L('\t\t}');
  L('\t\tmap(_gal_place) := 0;');
  L('\t}');
  L('\t# A DRAG (several pairs, the mouse): moved by the pointer\'s step from');
  L('\t# where they are, both of a pair the same step in the same frame, so a');
  L('\t# bound scene stays bound and plays on. After the placement: a place');
  L('\t# clears what is left of a drag, and a step after it moves on from it.');
  L('\t# (PosAdd x goes the way the character faces: times facing, it is the');
  L('\t# stage\'s x, whichever way each of the two faces in the scene.)');
  L('\tif map(_gal_dx) != 0 {');
  L('\t\tposAdd{x: map(_gal_dx) * facing}');
  L('\t\tmap(_gal_dx) := 0;');
  L('\t}');
  if ((t.pairs || []).some((p) => (p.steps || []).some((s) => s.air))) {
    L('\t# AIR START: a grab state of his with air physics, entered standing, would');
    L('\t# land at once (vel y > 0 at the ground: state 52). The driver asks, on');
    L('\t# the frame it puts him in it, for the height and velocity his own lead');
    L('\t# (or his jump\'s apex) gives: here, before that state\'s first tick, over');
    L('\t# its header\'s velset.');
    L('\tif map(_gal_air) {');
    L('\t\tposSet{y: map(_gal_ay)}');
    L('\t\tvelSet{x: map(_gal_avx); y: map(_gal_avy)}');
    L('\t\tmap(_gal_air) := 0;');
    L('\t}');
  }
  L('\t# Several pairs: the camera locked where the driver asks, once, and kept');
  L('\t# level (a scene that lifts her would pan it up): the zoom that fits them');
  L('\t# all, centered, or closer (+/-) on the active pair. Both bounds at that');
  L('\t# center (_gal_cx) leave the camera room for exactly one view at that');
  L('\t# zoom, and autocenter moves it there, panning from where it is. The');
  L('\t# stage is loaded again for the next match, so none of it outlives this');
  L('\t# one.');
  L('\tif map(_gal_zoom) > 0 {');
  L('\t\tmodifyStageVar{camera.zoomout: map(_gal_zoom); camera.zoomin: map(_gal_zoom); camera.boundleft: map(_gal_cx); camera.boundright: map(_gal_cx); camera.verticalfollow: 0; camera.autocenter: 1}');
  L('\t\tmap(_gal_zoom) := 0;');
  L('\t}');
  if ((t.pairs || []).some((p) => (p.steps || []).some((s) => s.high))) {
    L('\t# A SCENE IN THE AIR (one pair): the view zoomed out while a scene that');
    L('\t# holds him high up plays, and the stage\'s own zoom back after it, once');
    L('\t# each when the driver asks (_gal_vzo, _gal_vzi: zoomout and zoomin).');
    L('\tif map(_gal_vz) > 0 {');
    L('\t\tmodifyStageVar{camera.zoomout: map(_gal_vzo); camera.zoomin: map(_gal_vzi)}');
    L('\t\tmap(_gal_vz) := 0;');
    L('\t}');
  }
  L('\t# After a reset, until the next grab: what his last scene left on screen');
  L('\t# goes. A scene cut short never runs its own RemoveExplods, and many');
  L('\t# explods never time out (removetime -1, or an animation that ends on a');
  L('\t# -1 frame): Kur0maru\'s buster hand, his tentacle chair. Only his own,');
  L('\t# never his helpers\' (a gauge) or hers; one his -2 keeps up comes back.');
  L('\tif map(_gal_clean) {');
  L('\t\tremoveExplod{}');
  L('\t}');
  L('\t# MUGEN\'s HitDef default p1sprpriority = 1, which Ikemen 1.0.0 dropped:');
  L('\t# the frame after his HitDef connects, before his state runs, as MUGEN');
  L('\t# applies it; his next statedef or SprPriority still wins. A MUGEN scene');
  L('\t# layers on it (Kur0maru\'s glory hole draws her over his tentacles).');
  L('\tif map(_gal_p1) = 1 && moveHit = 1 {');
  L('\t\tsprPriority{value: 1}');
  L('\t}');
  L('\t# No receiver takes a player\'s input: the arrow keys are the gallery\'s');
  L('\t# (P2\'s own), and her walking away would spoil the grab. The driver');
  L('\t# marks each receiver; the next frame\'s input update clears her');
  L('\t# buffers. Never a giver: the driver\'s commands and P1\'s keys are his.');
  if (gate('recvInput')) L('\t# (Gated by the prototype mode ' + gatedBy('recvInput') + '.)');
  L('\tif ' + (gate('recvInput') ? gate('recvInput') + ' && ' : '') + 'map(_gal_recv) {');
  L('\t\tassertSpecial{flag: noInput}');
  L('\t}');
  if (t.helpers && t.helpers.length) {
    L('\t# A pair whose receiver is her helper: he and her root keep the way the');
    L('\t# driver stood them, both facing the edge the helper comes from, her root');
    L('\t# behind him. Neither turns to face the other: standing, or on the grab\'s');
    L('\t# own ChangeState (MUGEN\'s face-P2 turn), he would turn to her root and');
    L('\t# his grab would take her root instead.');
    L('\tif map(_gal_nt) {');
    L('\t\tassertSpecial{flag: noAutoTurn}');
    L('\t}');
  }
  if (t.setupSlots) {
    L('\t# The pair\'s setup, held every frame while the driver keeps asking:');
    L('\t# kind 1 = var, 2 = fvar.');
    for (let k = 1; k <= t.setupSlots; k++) {
      L('\tif map(_gal_s' + k + 'k) = 1 { var(map(_gal_s' + k + 'i)) := map(_gal_s' + k + 'v); }');
      L('\tif map(_gal_s' + k + 'k) = 2 { fvar(map(_gal_s' + k + 'i)) := map(_gal_s' + k + 'v); }');
    }
  }
  if (t.setSlots) {
    L('\t# An action\'s sets, once: in place before his -3/-2/-1 and his state run');
    L('\t# this frame, and before the commands below.');
    if (t.setupSlots) L('\t# (Each one made marks its slot, _gal_w<k>, for the -1 block below: THE SET OUTLASTS THE HOLD.)');
    for (let k = 1; k <= t.setSlots; k++) {
      if (t.setupSlots) {
        for (const [kind, v] of [[1, 'var'], [2, 'fvar']]) {
          L('\tif map(_gal_v' + k + 'k) = ' + kind + ' {');
          L('\t\t' + v + '(map(_gal_v' + k + 'i)) := map(_gal_v' + k + 'v);');
          L('\t\tmap(_gal_w' + k + 'k) := ' + kind + ';');
          L('\t}');
        }
      } else {
        L('\tif map(_gal_v' + k + 'k) = 1 { var(map(_gal_v' + k + 'i)) := map(_gal_v' + k + 'v); }');
        L('\tif map(_gal_v' + k + 'k) = 2 { fvar(map(_gal_v' + k + 'i)) := map(_gal_v' + k + 'v); }');
      }
      L('\tmap(_gal_v' + k + 'k) := 0;');
    }
  }
  if (t.commands.length) {
    L('\t# His commands, by number: _gal_c is the action being held or pressed,');
    L('\t# _gal_c2 one sustained beside it. True for his states this same frame.');
    L('\t# (On a receiver whose helper is the pair\'s receiver, _gal_c is the command');
    L('\t# that summons her: after the input update, which clears her input.)');
    // (A number whose command has aliases - one key of his makes them true
    // together - asserts every one of them on the same line.)
    t.commands.forEach((name, i) => {
      const al = (t.cmdAliases && Array.isArray(t.cmdAliases[i]) ? t.cmdAliases[i] : []).filter(cmdOk);
      L('\tif map(_gal_c) = ' + (i + 1) + ' || map(_gal_c2) = ' + (i + 1) + ' { ' + [name, ...al].map((n) => 'assertCommand{name: "' + n + '"}').join(' ') + ' }');
    });
  }
  if (t.pairs.some((p) => p.receiver && p.receiver.stance)) {
    L('\t# A RECEIVER WITH NO BODY AT REST (_gal_stand on her: her stance');
    L('\t# animation; gallerydata restStance): back in her own state 0 in the');
    L('\t# round, she goes to the gallery\'s stance (the state below), where his');
    L('\t# grab finds her body. Her own 0 has none (Murakami Ryona Mob: one blank');
    L('\t# frame, and NotHitBy every throw).');
    L('\tif map(_gal_stand) > 0 && stateNo = 0 && roundState = 2 {');
    L('\t\tchangeState{value: ' + STANCE_STATE + '; ctrl: 0}');
    L('\t}');
  }
  if (t.pairs.some((p) => (p.steps || []).some((s) => s.lift))) {
    L('\t# AN ANTI-AIR GRAB (_gal_lift on her: her height, her own units, up');
    L('\t# negative; gallerydata.js `lift`): his box is over her head, so the');
    L('\t# driver has her held in the air, in the state below, from the place');
    L('\t# until his grab takes her (Murakami\'s high grabs).');
    L('\tif map(_gal_lift) < 0 && (stateNo = 0' + (t.pairs.some((p) => p.receiver && p.receiver.stance) ? ' || stateNo = ' + STANCE_STATE : '') + ') && roundState = 2 {');
    L('\t\tchangeState{value: ' + LIFT_STATE + '; ctrl: 0}');
    L('\t}');
  }
  for (const p of parts) {
    if (!p.m4.length) continue;
    modeHead(p, '\t');
    for (const x of p.m4) L(x);
  }
  L('}');
  L('');
  if (t.holdOn) {
    L('# THE HOLD (gallerydata.js detectHold, the driver\'s _gal_h* maps on him): a scene');
    L('# whose own clock would end it - his state at time N or at the end of its');
    L('# animation, her state at time N (Minotaur\'s 1050 loses var(15), her 1055');
    L('# leaves for 1095 at time > 350) - is gone back into ' + K_HOLD_LEAD + ' ticks before. His');
    L('# state goes back into itself (its time 0 lines put her in her state again),');
    L('# and hers is sent again by whoever holds her: he, or the helper he called.');
    L('# Nothing here but where the driver names a state and a time.');
    L('# A scene that plays on again must play on IN PLACE: his climaxes step him');
    L('# back (Minotaur\'s horse: PosAdd x -22 three times a pass) and her afterglow');
    L('# state throws her (velset -3.5,-3.2 with gravity), so each pass would start');
    L('# further on. The driver asks (_gal_hanc = 1) when it starts holding a state:');
    L('# the hook keeps where he stands and where she stands from him once, early in');
    L('# that pass, and every restart puts him back there, stops her, and puts her');
    L('# back at that offset from him.');
    L('ignorehitpause if !isHelper && gameMode = "hgallery" && map(_gal_hanc) = 1 && map(_gal_hk) && stateNo = map(_gal_hs) && stateTime >= 1 {');
    L('\tmap(_gal_hx) := pos x + cameraPos x;');
    L('\tmap(_gal_hv) := 1;');
    L('\tmap(_gal_hdv) := 0;');
    L('\tif numTarget > 0 {');
    L('\t\tmap(_gal_hdx) := target, pos x - pos x;');
    L('\t\tmap(_gal_hdy) := target, pos y - pos y;');
    L('\t\tmap(_gal_hdv) := 1;');
    L('\t}');
    L('\tmap(_gal_hanc) := 0;');
    L('}');
    L('ignorehitpause if !isHelper && gameMode = "hgallery" && map(_gal_hk) {');
    L('\tif (map(_gal_hk) = 1 && stateNo = map(_gal_hs) && stateTime >= map(_gal_ht)) || (map(_gal_hk) = 2 && stateNo = map(_gal_hs) && animTime >= map(_gal_ht)) {');
    L('\t\tif map(_gal_hv) {');
    L('\t\t\tposAdd{x: (map(_gal_hx) - pos x - cameraPos x) * facing}');
    L('\t\t\tif map(_gal_hdv) && numTarget > 0 {');
    L('\t\t\t\ttargetVelSet{x: 0; y: 0}');
    L('\t\t\t\ttargetBind{time: 1; pos: map(_gal_hdx) * facing, map(_gal_hdy)}');
    L('\t\t\t}');
    L('\t\t}');
    L('\t\tselfState{value: stateNo}');
    L('\t}');
    L('}');
    L('ignorehitpause if !isHelper && gameMode = "hgallery" && map(_gal_hr) > 0 && numTarget > 0 {');
    L('\tif target, stateNo = map(_gal_hr) && target, stateTime >= map(_gal_hrt) {');
    L('\t\ttargetState{value: map(_gal_hr)}');
    L('\t}');
    L('}');
    for (const id of t.holdHelpers || []) {
      L('ignorehitpause if isHelper(' + id + ') && gameMode = "hgallery" && root, map(_gal_hr) > 0 && numTarget > 0 {');
      L('\tif target, stateNo = root, map(_gal_hr) && target, stateTime >= root, map(_gal_hrt) {');
      L('\t\ttargetState{value: root, map(_gal_hr)}');
      L('\t}');
      L('}');
    }
    L('');
  }
  L('# The same purge for helpers (-4 runs for them too): a helper reads its');
  L('# root\'s request (a helper\'s own map is a copy made when it spawned). One');
  L('# his -2 keeps up is spawned again the next frame. Its explods and texts go');
  L('# with it, as in the engine\'s own intro skip (clearPlayerAssets): a helper\'s');
  L('# explods outlive it otherwise, and Goblin Party\'s intro guild drew its hall');
  L('# and desk (removetime -1) over the stage for the whole session.');
  L('ignorehitpause if isHelper && gameMode = "hgallery" && root, map(_gal_purge) {');
  L('\tdestroySelf{removeexplods: 1; removetexts: 1}');
  L('}');
  L('');
  // (The modern-input text only, and only where the build lists any.)
  for (const x of hudZssLines(t, opts)) L(x);
  if (t.kills && t.kills.length) {
    L('# A helper his summon called goes at every reset, when the driver asks');
    L('# (_gal_k<id> on its root): a dog holds her up to 896 ticks, longer than');
    L('# any wait, and a leftover one must not stand in the next scene or grab');
    L('# her again. Its own helpers and explods go with it. One that binds her');
    L('# drops her to 5050 (the engine), and the reset stands her up next frame.');
    for (const id of t.kills) {
      L('ignorehitpause if isHelper(' + id + ') && gameMode = "hgallery" && root, map(_gal_k' + id + ') {');
      L('\tdestroySelf{recursive: 1; removeexplods: 1}');
      L('}');
    }
    L('');
  }
  if (t.apprSets && t.apprSets.length) {
    L('# THE APPROACH of a signaled grab\'s helper (_gal_appr on its root: the step\'s');
    L('# number, while the driver waits for her scene): a helper that walks to her');
    L('# and signals him only once it is close (Monsters\' creatures: a VelAdd of .17');
    L('# that Ikemen\'s friction cut keeps at .17 px a tick, half a minute across the');
    L('# screen) is stood where its own line goes on - N - 2 of body distance from');
    L('# her, in its walking state only, before that state runs. Its P2, whose');
    L('# distance this reads, is the nearest receiver: with several pairs the driver');
    L('# asks it beside her first where another is nearer (_gal_apj, at _gal_apx from');
    L('# the camera, on the side it came from), and its P2 is her the same tick.');
    t.apprSets.forEach((a, i) => {
      L('ignorehitpause if isHelper(' + a.id + ') && gameMode = "hgallery" && root, map(_gal_appr) = ' + (i + 1) + ' && stateNo = ' + a.state + ' {');
      L('\tif root, map(_gal_apj) {');
      L('\t\tposSet{x: root, map(_gal_apx)}');
      L('\t}');
      L('\tif p2Dist x >= 0 && abs(p2BodyDist x) > ' + a.dist + ' {');
      L('\t\tposAdd{x: p2BodyDist x - ' + Math.max(0, a.dist - 2) + '}');
      L('\t}');
      L('}');
    });
    L('');
  }
  if (t.helpers && t.helpers.length) {
    L('# A RECEIVER\'S HELPER, a receiver of her own (Dr. Kira\'s Chichi): her root');
    L('# summons her with its own command (the driver\'s _gal_c on the root, asserted');
    L('# above), and she reads her root\'s requests: _gal_rp, stand where the driver');
    L('# asks (_gal_rx, from the camera or, with her root\'s _gal_abs, from the');
    L('# stage\'s center) facing _gal_rf, once - in front of him, her root out of his');
    L('# reach. Her life is kept over half, as her root\'s is.');
    for (const id of t.helpers) {
      L('ignorehitpause if isHelper(' + id + ') && gameMode = "hgallery" {');
      L('\tif root, map(_gal_rp) {');
      L('\t\tposSet{x: root, map(_gal_rx) - root, map(_gal_abs) * cameraPos x; y: 0}');
      L('\t\tvelSet{x: 0; y: 0}');
      L('\t\tif facing != root, map(_gal_rf) {');
      L('\t\t\tturn{}');
      L('\t\t}');
      L('\t}');
      L('\tif life < lifeMax / 2 {');
      L('\t\tlifeSet{value: lifeMax}');
      L('\t}');
      L('}');
    }
    L('');
  }
  if (t.companions && t.companions.length) {
    L('# His COMPANION: a helper of his that his own commands drive while he stands');
    L('# in his stance (Brian\'s Striker in his Command Stance). It reads its root\'s');
    L('# requests: _gal_hp, the step\'s pins on its variables (a random choice of its');
    L('# grab made certain), held every frame; _gal_hc, the command of its own that');
    L('# starts its grab, asserted in ITS command list (a helper with keyctrl reads');
    L('# the player\'s keys through a copy of his) while the driver waits for the');
    L('# grab. Its own states read his commands (parent, command) as a player\'s.');
    L('# _gal_hg, a position of its set: its counter to the position and its state');
    L('# to the position\'s own, while it holds her in a state its counter\'s line');
    L('# names and is not at home there yet. Before its own lines run, so none of');
    L('# the random draws on its own way there runs (Brian\'s line into 51488 draws');
    L('# the art variant var(33) on the tick it enters); the pins come first, so');
    L('# the state starts with them.');
    L('# _gal_ha, the animation the step holds it at in the position\'s state (a');
    L('# speed, a climax picture - Brian\'s 41488 picks its three speeds at random');
    L('# at each loop\'s end, its climax swaps pictures on elements): set when it');
    L('# plays another, restarted on its last tick before the state\'s own');
    L('# animTime = 0 lines run, and the first tick of an element where a line of');
    L('# the state swaps it away skipped (element, elemtime on). Held for as long');
    L('# as the step is selected: a step moved to in place - out of a climax too -');
    L('# shows at once.');
    const rng = (rs) => rs.map(([a, b]) => (a === b ? 'stateNo = ' + a : '(stateNo >= ' + a + ' && stateNo <= ' + b + ')')).join(' || ');
    for (const c of t.companions) {
      L('ignorehitpause if isHelper(' + c.id + ') && gameMode = "hgallery" {');
      (t.pinSets || []).forEach((p, i) => {
        if (p.id !== c.id) return;
        const sets = p.pins.map((e) => (e.k === 1 ? 'var(' : 'fvar(') + e.i + ') := ' + e.v + ';').join(' ');
        L('\tif root, map(_gal_hp) = ' + (i + 1) + ' { ' + sets + ' }');
      });
      for (const n of c.cmds) L('\tif root, map(_gal_hc) = ' + n + ' { assertCommand{name: "' + t.commands[n - 1] + '"} }');
      (t.goSets || []).forEach((g, i) => {
        if (g.id !== c.id) return;
        L('\tif root, map(_gal_hg) = ' + (i + 1) + ' && (' + rng(g.in) + ') && !(' + rng(g.home) + ') { '
          + (g.set.k === 1 ? 'var(' : 'fvar(') + g.set.i + ') := ' + g.set.v + '; selfState{value: ' + g.state + '} }');
      });
      (t.holdSets || []).forEach((h, i) => {
        if (h.id !== c.id) return;
        const on = 'root, map(_gal_ha) = ' + (i + 1) + ' && stateNo = ' + h.state;
        L('\tif ' + on + ' && anim != ' + h.anim + ' { changeAnim{value: ' + h.anim + '} }');
        L('\tif ' + on + ' && anim = ' + h.anim + ' && animTime = 0 { changeAnim{value: ' + h.anim + '} }');
        for (const [E, e, et] of h.skip) L('\tif ' + on + ' && anim = ' + h.anim + ' && animElemTime(' + E + ') = 0 { changeAnim{value: ' + h.anim + '; elem: ' + e + '; elemtime: ' + et + '} }');
      });
      L('}');
    }
    L('');
  }
  for (const p of parts) {
    if (!p.m4blocks.length) continue;
    modeHead(p, '');
    for (const x of p.m4blocks) L(x);
    L('');
  }
  // The pair's setup and an action's holds once more in -1: a common file's
  // negative states run after the character's own, so this comes after his
  // -3, -2 and -1 and right before his state, where a -4 line may already be
  // undone - Brian's -2 zeroes fvar(23) every frame his fvar(22) is 0 (out of
  // a scene), and his win state 180 reads it the frame it runs.
  // THE SET OUTLASTS THE HOLD: a variable the setup holds that an action sets
  // this frame (a GAUGE CLIMAX: Murakami's var(25), held at 0, set to 12000
  // once in his hold 1000, whose own `Var(25) >= 12000` starts the climax) is
  // not held again here on that frame - his state reads the set value, as it
  // did before this block existed. A set made in -4 marks its slot
  // (_gal_w<k>, its kind; its index stays in _gal_v<k>i) and is cleared there
  // at once, as before; this block reads the mark and clears it. (Not the
  // request itself left for here: a ChangeState in his own -1 ends the -1 the
  // engine runs, the common file's lines appended to his - bytecode.go
  // StateBlock.Run, compiler.go 7110 - so a request cleared only here would be
  // made again the next frame.) Every "gauge full" step ended before it showed
  // (headless, 2026-10-08: "this scene ends before it shows").
  if (t.setupSlots) {
    const setNow = (k, kind) => {
      const any = [];
      for (let j = 1; j <= (t.setSlots || 0); j++) any.push('(map(_gal_w' + j + 'k) = ' + kind + ' && map(_gal_v' + j + 'i) = map(_gal_s' + k + 'i))');
      return any.length ? ' && !(' + any.join(' || ') + ')' : '';
    };
    L('[StateDef -1]');
    L('');
    L('# The pair\'s setup and the holds again, after his own -3/-2/-1 (a common');
    L('# file\'s negative states run after the character\'s): his own -2 may undo');
    L('# the -4 lines every frame (Brian\'s zeroes fvar(23) whenever fvar(22) = 0),');
    L('# and his state reads them right after this. A variable an action sets');
    L('# this frame is left as the set made it (THE SET OUTLASTS THE HOLD).');
    L('ignorehitpause if !isHelper && gameMode = "hgallery" {');
    for (let k = 1; k <= t.setupSlots; k++) {
      L('\tif map(_gal_s' + k + 'k) = 1' + setNow(k, 1) + ' { var(map(_gal_s' + k + 'i)) := map(_gal_s' + k + 'v); }');
      L('\tif map(_gal_s' + k + 'k) = 2' + setNow(k, 2) + ' { fvar(map(_gal_s' + k + 'i)) := map(_gal_s' + k + 'v); }');
    }
    for (let k = 1; k <= (t.setSlots || 0); k++) L('\tmap(_gal_w' + k + 'k) := 0;');
    L('}');
    L('');
  }
  const hides = (t.helperHides || []).filter((x) => x.ids && x.ids.length);
  const rerolls = (t.rerollSets || []).filter((x) => x && x.length);
  const badges = (t.badgeSets || []).filter((x) => x.sets && x.sets.length);
  {
    L('# LAST in this file: everything below is state +1, which runs after the');
    L('# state, and after the character\'s own +1 (a common file\'s negative states');
    L('# are added to the character\'s).');
    L('#');
    L('# ZOOMED (several pairs, +/-: the camera on the active pair), _gal_free on');
    L('# each fighter: nobody is pushed back into view by the screen\'s edges - a');
    L('# pair beside the view plays its scene on, partly or fully off screen, and');
    L('# the pair the camera pans to is never pushed toward the view it leaves -');
    L('# and only the active pair (1) moves the camera, never the others (2) or');
    L('# their helpers. Here, after the state: a scene\'s own ScreenBound (value 1,');
    L('# every frame) would undo a -4 line. The engine sets a fighter\'s flags');
    L('# again each frame; a helper keeps what it was last given.');
    if (hides.length) {
      L('#');
      L('# His explods on a receiver\'s helper (Dr. Kira\'s Chichi): an Explod of his in');
      L('# a state of his she runs is hers, and its anim resolves in her ROOT\'s table,');
      L('# where her root\'s bridge (its own +1 ChangeAnims) never reaches: DongHwan\'s');
      L('# intro 7201 explods 43434, Kira\'s own close-up - a big Kira beside her.');
      L('# Removed by id here, after the state that made it and before anything is');
      L('# drawn: never on screen. Never her own explods\' ids.');
    }
    if (rerolls.length) {
      L('#');
      L('# RE-ROLLS, _gal_rr: a random branch of his that draws a receiver\'s helper as');
      L('# her root, drawn and tested on the same tick (DongHwan\'s position-1 climax');
      L('# 6005 draws var(31) and var(49) on its first tick and, on var(31) > var(49),');
      L('# gives her 72002 - Kira\'s art on Chichi - and goes on to 70002). No -4 line');
      L('# can hold a draw made after it; here, after his state, he goes back into the');
      L('# state that draws (it runs again this tick and draws again) and she into the');
      L('# step\'s own state, before she runs this frame (he runs first, attacking).');
    }
    L('[StateDef +1]');
    L('');
    L('ignorehitpause if !isHelper && gameMode = "hgallery" && map(_gal_free) {');
    L('\tif map(_gal_free) = 1 {');
    L('\t\tscreenBound{value: 0; movecamera: 1, 1}');
    L('\t}');
    L('\tif map(_gal_free) = 2 {');
    L('\t\tscreenBound{value: 0; movecamera: 0, 0}');
    L('\t}');
    L('}');
    L('ignorehitpause if isHelper && gameMode = "hgallery" && root, map(_gal_free) = 2 {');
    L('\tscreenBound{value: 0; movecamera: 0, 0}');
    L('}');
    L('');
  }
  if (hides.length) {
    for (const x of hides) {
      L('ignorehitpause if isHelper(' + x.id + ') && gameMode = "hgallery" {');
      for (const n of x.ids) L('\tremoveExplod{id: ' + n + '}');
      L('}');
    }
    L('');
  }
  if (rerolls.length) {
    L('ignorehitpause if !isHelper && gameMode = "hgallery" && map(_gal_rr) > 0 {');
    rerolls.forEach((list, i) => {
      for (const r of list) {
        L('\tif map(_gal_rr) = ' + (i + 1) + ' && stateNo = ' + r.at + ' && prevStateNo = ' + r.from + ' {');
        // (Her first: a SelfState ends the block - nothing after it runs.)
        L('\t\ttargetState{value: ' + r.her + '}');
        L('\t\tselfState{value: ' + r.from + '}');
        L('\t}');
      }
    });
    L('}');
    L('');
  }
  if (badges.length) {
    L('# Her BADGE, given by the gallery (Dr. Kira\'s Chichi: her states make her');
    L('# throw-immune unless her enemy carries her author\'s grab flag, an explod');
    L('# and an action 125234 of his). For a pair whose giver it opens (her root\'s');
    L('# _gal_badge = its number), what her own states run with the badge, run');
    L('# here after her state, in the slot her state just set: in her taunts');
    L('# NotHitBy ,HP for a tick, so his throw catches her. Not ignorehitpause, as');
    L('# her own lines. Only here: no file of anyone\'s changes, and a real fight');
    L('# never runs this mode.');
    const rng = (ns) => ns.map((n) => 'stateNo = ' + n).join(' || ');
    badges.forEach((b, i) => {
      L('if isHelper(' + b.id + ') && gameMode = "hgallery" && root, map(_gal_badge) = ' + (i + 1) + ' {');
      for (const x of b.sets) L('\tif ' + rng(x.states) + ' { ' + (x.not ? 'notHitBy' : 'hitBy') + '{value: ' + x.value.replace(/\s+/g, '') + '; time: ' + x.time + '} }');
      L('}');
    });
    L('');
  }
  const swaps = (t.swapSets || []).filter((x) => x && x.length);
  if (swaps.length) {
    L('# HIS OTHER BRANCH, _gal_sw on a receiver (her pair\'s swap set): where his');
    L('# probe SelfAnimExist(N) picks for her an action of his that draws none of');
    L('# her sprites, the action of the same probe\'s other line (his art for a');
    L('# receiver without N) in its place - here, after her state, on the tick his');
    L('# ChangeAnim2 plays it, at the same element, before anything is drawn.');
    L('# ChangeAnim2 takes the action from her state\'s owner, him, as his own line');
    L('# does. Murakami\'s winged demon on Mai: his 3606 / 3608, her 9005 pose, for');
    L('# his 3605 / 3607, the 17850 sprites she lacks (gallerydata.js).');
    swaps.forEach((list, i) => {
      L('ignorehitpause if !isHelper && gameMode = "hgallery" && map(_gal_sw) = ' + (i + 1) + ' {');
      for (const x of list) L('\tif stateNo = ' + x.state + ' && anim = ' + x.from + ' { changeAnim2{value: ' + x.to + '; elem: animElemNo(0); elemtime: animElemTime(animElemNo(0))} }');
      L('}');
    });
    L('');
  }
  for (const p of parts) {
    if (!p.p1blocks.length) continue;
    modeHead(p, '');
    for (const x of p.p1blocks) L(x);
    L('');
  }
  if (t.pairs.some((p) => p.receiver && p.receiver.stance)) {
    L('# THE GALLERY\'S STANCE, a common state: a receiver with no body at rest');
    L('# stands here on her stance animation (_gal_stand), its last frame held');
    L('# (the engine\'s own idiom, guardbreak.zss), still and out of control, so');
    L('# his grab takes her as it takes anyone in her standing state. Back to her');
    L('# 0 once the driver no longer asks or the round is not running.');
    L('[StateDef ' + STANCE_STATE + '; type: S; movetype: I; physics: S; ctrl: 0; velset: 0, 0;]');
    L('');
    L('if map(_gal_stand) <= 0 || roundState != 2 || gameMode != "hgallery" {');
    L('\tchangeState{value: 0; ctrl: 1}');
    L('}');
    L('if anim != map(_gal_stand) {');
    L('\tchangeAnim{value: map(_gal_stand)}');
    L('}');
    L('if animTime = -1 {');
    L('\tchangeAnim{value: anim; elem: animElemNo(-1)}');
    L('}');
    L('');
  }
  if (t.pairs.some((p) => (p.steps || []).some((s) => s.lift))) {
    L('# THE GALLERY\'S LIFT, a common state: for an anti-air grab (his box over');
    L('# her head, a HitDef that hits the air) she is held here at the height the');
    L('# driver asks (_gal_lift, her own units) on its animation (_gal_lifta: her');
    L('# neutral jump, else her stand), still, out of control and in the air, so');
    L('# his grab takes her as it takes a jumping partner in a fight. Back on the');
    L('# ground in her 0 once the driver no longer asks or the round is not running.');
    L('[StateDef ' + LIFT_STATE + '; type: A; movetype: I; physics: N; ctrl: 0; velset: 0, 0;]');
    L('');
    L('if map(_gal_lift) >= 0 || roundState != 2 || gameMode != "hgallery" {');
    L('\tposSet{y: 0}');
    L('\tchangeState{value: 0; ctrl: 1}');
    L('}');
    L('posSet{y: map(_gal_lift)}');
    L('velSet{x: 0; y: 0}');
    L('if anim != map(_gal_lifta) {');
    L('\tchangeAnim{value: map(_gal_lifta)}');
    L('}');
    L('');
  }
  return lines.join('\n');
}

// The script. A PROTOTYPE MODE's chunk (modeParts) goes after every core
// local and before the mode's own section (run, the autostart): it sees the
// driver's locals as upvalues and registers its hooks with MODE.add.
// opts.v2: the text for the modern-input engine (IKEMEN_V2 builds; our web
// engine and upstream's official build alike), which has no getInput or
// getInputTime: the picker reads motif actions (getAction, getActionTime) and
// a match it starts assigns the local inputs first, as upstream's quick
// versus does. Without it (the default when IKEMEN_V2 is unset) the text is
// the one every build before the modern-input engine carried, byte for byte.
function buildGalleryLua(data, modes, opts) {
  const v2 = opts && opts.v2 !== undefined ? !!opts.v2 : !!process.env.IKEMEN_V2;
  const DATA = { stage: data.stage, setupSlots: data.setupSlots || 0, setSlots: data.setSlots || 0, introMax: INTRO_MAX, pairs: data.pairs };
  // The build's stages for the MAP tile (the modern-input text only, and
  // only with more than one: a build with one has no tile). The first is the
  // default, data.stage: the gallery opens on it as it always did.
  if (v2 && opts && Array.isArray(opts.stages) && opts.stages.length > 1) DATA.stages = opts.stages.map((x) => ({ name: x.name, path: x.path }));
  // (The characters whose own HUD explods the hook hides: select -> its
  // number, galhud.js. The modern-input text only.)
  const HUDX = hudIndex(opts, data);
  const mp = modeParts(data, modes);
  if (mp.bad) throw new Error('mode ' + mp.bad.id + ': ' + mp.bad.why);
  const chunks = mp.parts.filter((p) => p.lua).map((p) => p.lua + '\n');
  const modeLua = chunks.length ? '-- ---- prototype modes (gallerymodes/): each chunk registers its mode with MODE.add ----\n' + chunks.join('\n') + '\n' : '';
  return `-- H GALLERY (generated by the Mod Studio - do not edit by hand).
-- A title-menu mode that loads compatible giver/receiver pairs of this build
-- and shows each pair's scenes, one at a time, until you move on. Up to four
-- pairs stand side by side; the keys act on the ACTIVE pair (its marker under
-- the fighters blinks). A pair's scenes are POSITIONS, each with what it has
-- of versions, speeds, a climax and stages (the overlay's gold line says
-- which, with their keys):
--   Right / Left          next / previous position
--   Down / Up             next / previous version of this position
--   End / Delete          one speed faster / slower (auto is the top speed)
--   Space                 the climax on / off
--   Home                  the next mood (her look as the finishes add up)
--   Page Down / Page Up   next / previous pair, in the active pair's place
--   1 - 4                 which pair on screen is the active one
--   + / -                 zoom in / out on the active pair (several pairs:
--                         = or Shift+=, -, and the keypad's + and -)
--   Tab                   the pair picker (the fight waits behind it)
--   Insert                hides the overlay and the markers, and shows them
--                         (H too; in the picker Insert adds a pair)
--   Esc                   leave the gallery
${v2 ? `--   Mouse (left button)   several pairs: press on a pair to make it the
--                         active one, hold and move to drag it sideways;
--                         let go and it stays there
` : ''}-- The arrow keys are P2's, and P2 is off here: no receiver takes a player's
-- input. P1's keys and first pad drive the active pair's giver (his own moves,
-- beside the gallery's), the way the Scene Viewer hands them over; the other
-- givers take none. Everything goes back when the gallery is left.
-- In the picker: Up / Down move, Right or Enter go in, Left or Backspace go
-- back. Enter puts the highlighted pair in the active pair's place (a pair
-- already on screen becomes the active one; a position of it is shown in
-- place), Insert adds it beside the others, Delete takes the active pair off
-- the screen (not the last), Tab closes.
-- The scenes are the giver's own: the gallery puts him into his grab, and
-- then asks for his own commands (data/hgallery.zss asserts them) the way a
-- player would press them, inside the running scene. Only scenes the Studio
-- found to render for the pair are listed.

local DATA = ${toLua(DATA)}

if DATA == nil or DATA.pairs == nil or #DATA.pairs == 0 then return end

-- THE REGISTER RULE: the main chunk sits near gopher-lua's cap of 200
-- registers (its top-level locals and the temporaries of its widest
-- expression), and a script over the cap never loads. So a new setting is a
-- field of K, a color one of COL, a draw cache one of UI, and new state goes
-- in a table (G, MATCH, LEAN), never in a new top-level local. The
-- room left is measured by tools/luacheck.go with --room.
local K, COL, UI = {}, {}, {}

local GIVER, RECV = 1, 2
K.SETUP_SLOTS, K.SET_SLOTS = DATA.setupSlots or 0, DATA.setSlots or 0
-- A grab that has not caught her by then missed.
K.ENTER_MAX = 240
-- Ticks an action may take by default (the data can say more: an auto mode or
-- a timed chain takes a minute). Counted from her last state change, so a
-- scene still busy with something else (a climax playing out) is waited for;
-- never more than PATIENCE_CAP times the action's patience in all.
K.PATIENCE, K.PATIENCE_CAP = ${DEFAULT_PATIENCE}, 3
-- A pressed command is pressed again this often until it shows.
K.PRESS_EVERY = 20
-- A mashed one (a hub that answers every press - Kur0maru's eating throw)
-- is pressed this often for as long as the step is selected.
K.MASH_EVERY = 10
-- A held command whose effect lets go this soon after release (a speed that
-- plays one cycle per hold) is held for as long as the step is on screen.
K.SLIP = 120
-- A step off screen this long (a climax back to its position) runs again.
K.REPLAY = 90
-- Ticks she may be out of his states while he is in one of his own before
-- it counts as the scene's end: a re-grab whose HitDef names no state of
-- hers leaves her a tick in her own get-hit state until his next state's
-- TargetState takes her back (Murakami's 2904 -> 2905).
K.GRACE = 3
-- His companion (a helper his own commands drive in his stance): ticks it may
-- take to spawn and stand in one of its idle states before its grab.
K.SUMMON_MAX = 600
-- A receiver's helper (Dr. Kira's Chichi): her root stands RBACK behind him
-- (his grab's Clsn1 reaches 5-45 in front of him and lunges on, never behind
-- him: 39 px of clearance between it and the front of her root's Clsn2, and
-- his box never reaches behind him), and she is stood HGAP in front of him
-- to be grabbed. Her root's summon is pressed until she is out.
K.RBACK, K.HGAP = 90, 36
-- A signaled grab's helper whose P2 is another pair's receiver is stood this
-- far from her (320-wide units), on its own side, before its approach: nearer
-- her than any other receiver (pairs stand SPACING apart).
K.BESIDE = 40
-- -hgallerylog on the command line prints each step to the log, for tests.
local LOG = getCommandLineValue('-hgallerylog') ~= nil
-- Tests only (with -hgallerylog): -hgalleryholdoff shuts THE HOLD (the negative
-- control: the scenes must then end by their own clocks).
K.NOHOLD = LOG and getCommandLineValue('-hgalleryholdoff') ~= nil
-- Pairs side by side: at most four (the engine's Simul teams hold four a
-- side). In 320-wide screen units (a character's own units times
-- 320 / localCoordX(): every character sees a screen 320 of them wide at zoom
-- 1, on any stage shape): pair centers SPACING apart, the two of a pair GAP
-- apart, MARGIN left at each screen edge. The camera is locked at the zoom
-- that fits them all.
local MAX_SLOTS, SPACING, GAP, MARGIN = 4, 150, 36, 90
-- A reload that keeps pairs on screen runs the match ACCEL times faster until
-- every pair shows its scene again (at most ACCEL_MAX ticks).
K.ACCEL, K.ACCEL_MAX = 4, 2400
-- Each pair's color on screen, pair 1 to 4: red, blue, yellow, green.
COL.COLORS = { { 255, 70, 70 }, { 70, 160, 255 }, { 255, 205, 40 }, { 80, 225, 100 } }
-- The zoom (+ / -, several pairs): level 1 fits every pair (the camera's
-- scale that shows them all, centered); each level after it is a scale of
-- ZOOMS past that fit, on the ACTIVE pair: up to normal size (1) and a bit
-- closer, which only shows less of what normal size shows. The camera is
-- pinned there by the hook (both bounds at one center: room for one view),
-- as near the pair's center as a camera may go at that scale - to the end of
-- the stage's art, or of the fit's frame where that reaches further - so an
-- edge pair at a middle level sits toward its edge, as fighters in a corner
-- do - and pinned again when the pair moves FOLLOW from it. One pair alone
-- keeps the stage's own camera: zoom is for several pairs.
K.ZOOMS = { 0.62, 0.8, 1, 1.25 }
-- Zoomed, the camera follows the active pair once it is this far from it
-- (320-wide units).
K.FOLLOW = 30
-- DRAGGING A PAIR WITH THE MOUSE (several pairs; the modern-input engine's
-- text only): pair centers stay DRAG_SEP apart and in their order
-- (an edge slot stays the edge slot), DRAG_EDGE inside the view's edge where
-- the screen bounds them (every pair in view), the stage's art likewise; a
-- pair is hit inside a box DRAG_BODY tall over its ground line and
-- DRAG_WIDE past its two each side (320-wide units, times the zoom). UI.drag: the button as last seen (was), the pair
-- being dragged (k), the pointer and the pair's offset where it began (x0,
-- d0), and the frames since the last release (after: the log's checks).
K.DRAG_SEP, K.DRAG_EDGE, K.DRAG_BODY, K.DRAG_WIDE = 90, 24, 100, 44
UI.drag = { was = false, k = nil, hover = nil, after = -1 }
-- A SCENE IN THE AIR (one pair; a step's 'high', his feet's height in it):
-- the view zooms out to VIEW_UP / (VIEW_BODY - high), at least VIEW_MIN.
-- VIEW_UP is about what the view shows above the floor at scale 1 (less the
-- overlay's lines), VIEW_BODY the bodies above his feet - him, and her held
-- above him (Murakami's demon at -149: 0.627).
K.VIEW_UP, K.VIEW_BODY, K.VIEW_MIN = 200, 170, 0.5
-- Several pairs: a scene leans off its pair's place (his grab carries both
-- toward her, or back: Brian's slot-3 scene about 20 to the right, Minotaur's
-- position 1 about 20 to the left), and an edge pair leaning outward stood
-- far from the others. So each scene's lean is learned a moment into its
-- show (at, in ticks: the middle of the two, from where they were placed, in
-- 320-wide units toward the way he faces), and the next place stands the
-- pair that much the other way: the scene plays on its place. Kept for the session,
-- by pair and scene (and by grab, for a scene of the same grab not seen
-- yet: by). A lean over max is a scene that carries her off, not kept. A
-- reload's fast run grabs a pair again at once when its scene leaned more
-- than min off with nothing learned, so it shows on its place from the
-- start. (One table: the register rule at K, COL and UI above.)
local LEAN = { by = {}, at = 20, max = 40, min = 6 }
-- PROTOTYPE MODES (gallerymodes/): each mode's chunk, near the end of this
-- script, registers its hooks with MODE.add; the driver calls them at its
-- seams, each a no-op for a step of no mode (its ext). A hook that errors
-- switches its mode off for the session (said in the log); its steps then
-- stop with a note and the rest of the gallery goes on. A mode keeps its
-- per-pair state in G.m only (cleared at every reset and step change), its
-- maps are _gal_<id>_*, and it works through the driver's helpers (onP,
-- mset, begin, startPath, actionFailed, log, tell). (These helpers use no
-- later local: a seam hands them the step.)
local MODE = { by = {}, list = {} }
function MODE.add(id, make)
  local ok, M = pcall(make)
  if ok and type(M) == 'table' then
    M.id = id
    MODE.by[id] = M
    MODE.list[#MODE.list + 1] = M
  else
    print('H gallery: mode ' .. id .. ' is off: ' .. tostring(M))
  end
end
function MODE.of(s) return s and s.ext and MODE.by[s.ext] end
-- One hook of a mode, guarded: its result, or nil (switched off on an error).
function MODE.run(M, f, ...)
  local fn = M[f]
  if fn == nil then return nil end
  local ok, r = pcall(fn, ...)
  if ok then return r end
  print('H gallery: mode ' .. M.id .. ' is off (' .. f .. '): ' .. tostring(r))
  MODE.by[M.id] = nil
  for i, x in ipairs(MODE.list) do if x == M then table.remove(MODE.list, i); break end end
  return nil
end
-- One hook of every mode, in order: the first answer that is not nil
-- (MODE.each: every mode's, whatever they answer).
function MODE.call(f, ...)
  local all = {}
  for i, M in ipairs(MODE.list) do all[i] = M end
  for _, M in ipairs(all) do
    if M[f] and MODE.by[M.id] == M then
      local r = MODE.run(M, f, ...)
      if r ~= nil then return r end
    end
  end
  return nil
end
function MODE.each(f, ...)
  local all = {}
  for i, M in ipairs(MODE.list) do all[i] = M end
  for _, M in ipairs(all) do if M[f] and MODE.by[M.id] == M then MODE.run(M, f, ...) end end
end
-- The step's mode answers yes (a hook that is missing answers no).
function MODE.ask(s, f, ...)
  local M = MODE.of(s)
  return M ~= nil and M[f] ~= nil and MODE.run(M, f, s, ...) == true
end
-- The step's driver runs outside the fight's round state 2 (live).
function MODE.liveOf(s) return MODE.ask(s, 'live') end
-- Two steps whose grabs differ, never one in place of the other: a step
-- with no grab, or a mode that grabs its own way beside a step not of it.
function MODE.apart(prev, s)
  if s and s.noGrab then return true end
  local M, P = MODE.of(s), MODE.of(prev)
  return ((M and M.grab) or (P and P.grab)) and M ~= P or false
end

-- One pair's driver state. Pair k on screen is the giver P(2k-1) (side 1) and
-- the receiver P(2k) (side 2); every driver function works on the pair
-- useSlot() made current (G, GIVER, RECV), so each pair plays its own scene.
local function newG()
  return { k = 1, pi = 1, si = 1, phase = 'idle', t = 0, tries = 0, note = '', restarts = 0,
    entry = nil, fresh = true, ai = 0, slot = 0, sustain = 0, hold = { hk = 0, hs = 0, hr = 0 }, sustained = {}, held = nil, before = {}, off = 0,
    lastRecv = -1, lastRecvTime = 0, recvAt = 0, jumpReady = true, lastJump = -100, lastSt = -1,
    shown = false, dwellF = 0, dwellIn = 0, mash = 0, dx = 0 }
end
local G = newG()
-- The pairs on screen, how many, and the active one.
local SLOTS, NSLOT, SEL = { G }, 1, 1
local function useSlot(k) G = SLOTS[k]; GIVER, RECV = 2 * k - 1, 2 * k end
-- The mode: running; what the next match loads, by place ({ pi = pair,
-- si = scene }); the change a key asked for; the scene each pair was left at.
local ACTIVE, CMD, LAST = false, nil, {}
local LOAD = { { pi = 1, si = 1 } }
-- This match: its ticks, and whether pairs are being restored (fast) until
-- every one shows again. Every match purges what the intros left, once.
local MATCH = { f = 0, speed = false, restored = true, rs2 = false }
-- The loop's own count (it runs while paused too): blinking and notes.
local LOOPF = 0
local MSG = { text = '', t = 0 }
-- H: the overlay and the markers hidden. Kept for the session (pairs, reloads,
-- leaving and coming back), never saved.
local HIDE = false
-- Coming back with it hidden: the hint once, when the first fight shows.
local HINT = false
-- The pair picker (Tab).
local PK = { open = false, col = 2, gi = 1, ri = 1, sc = 1, top = {}, t = 0, keepPaused = false, list = nil, msg = '', msgT = 0 }
-- The zoom: the scale asked for (0: fit every pair), kept for the session
-- (pairs, reloads, leaving and coming back) where the pairs on screen have
-- that level. CAM: what the hook was last asked (key); free, nobody bound to
-- the screen's edges (zoomed, and back at level 1 until the camera is
-- still); still, the ticks the camera has not moved; fv, the flag each
-- fighter was last given. STAGE: the stage's art, left and right, in
-- 320-wide units, read when the match starts (before the hook moves its
-- bounds).
local ZL = 0
local CAM = { key = nil, free = false, still = 0, fv = {} }
local STAGE = {}

-- Lua redirection: player(n) makes n the working character; always put the
-- previous one back, and never let an error escape (an error in a loop hook
-- stops the engine).
local function onP(n, fn)
  local old = id()
  if not player(n) then return nil end
  local ok, r = pcall(fn)
  playerId(old)
  if ok then return r end
  return nil
end
local function mset(n, k, v) onP(n, function() mapSet(k, v) end) end

local function curPair() return DATA.pairs[G.pi] end
local function curStep() local p = curPair(); return p and p.steps[G.si] end
-- The step's actions. A grab alone waits for the step's states.
local function pathOf(s)
  if s.path and #s.path > 0 then return s.path end
  return { { show = s.states, wait = true } }
end

-- The pair's receiver is a HELPER of the receiving character (Dr. Kira's
-- Chichi): every read of "her" goes to that helper (Lua helper(id) inside her
-- root makes it the working character); nil while she is not out.
local function rhelperOf(p) return p and p.receiver.helper end
local function onR(fn)
  local h = rhelperOf(curPair())
  if h == nil then return onP(RECV, fn) end
  return onP(RECV, function() if helper(h.id) then return fn() end return nil end)
end
-- The same for pair k on screen (the log's view of every pair).
local function recvOn(k, fn)
  local h = rhelperOf(DATA.pairs[SLOTS[k].pi])
  if h == nil then return onP(2 * k, fn) end
  return onP(2 * k, function() if helper(h.id) then return fn() end return nil end)
end
-- She is in one of his custom states: his scene is running. (A helper's
-- scene is his: helpers share their root's player number.) A prototype
-- mode's step may widen it (its inScene: a scene the mode plays its own way),
-- never narrow it; that hook never asks inScene or showing itself.
local function inScene()
  return onR(function() return inCustomState() and getStateOwnerPlayerNo() == GIVER end) == true
    or MODE.ask(curStep(), 'inScene')
end
local function recvState() return onR(function() return stateNo() end) or -1 end
local function recvTime() return onR(function() return time() end) or 0 end
local function giverState() return onP(GIVER, function() return stateNo() end) or -1 end
local function member(n, list)
  if list then for _, v in ipairs(list) do if v == n then return true end end end
  return false
end
local function showing(s)
  local n = recvState()
  if s.anims and not member(onP(GIVER, function() return anim() end), s.anims) then return false end
  return member(n, s.states) or member(n, s.alsoStates)
end

-- With several pairs on screen, each line carries its pair's place: [k].
local function log(what)
  if not LOG then return end
  local p = curPair()
  print('[hgallery] ' .. (NSLOT > 1 and ('[' .. G.k .. '] ') or '') .. 'pair ' .. G.pi .. '/' .. #DATA.pairs .. ' scene ' .. G.si .. '/' .. (p and #p.steps or 0)
    .. ' ' .. what .. ' recv=' .. recvState() .. ' his=' .. giverState() .. (G.note ~= '' and (' note=' .. G.note) or ''))
end
-- His summoned helpers (the pair's kill list): asked gone at every reset and
-- for a step given up on, the hook destroys them the next frame.
local function killHelpers(v)
  local p = curPair()
  for _, id in ipairs((p and p.kill) or {}) do mset(GIVER, '_gal_k' .. id, v) end
  -- A receiver's helper, on her root: whatever she is in (left in her root's
  -- own states after a scene, she is her root's body at her scale), she is
  -- removed at every reset and summoned again for the next grab.
  local h = p and p.receiver.helper
  if h then mset(RECV, '_gal_k' .. h.id, v) end
end
local function begin(phase)
  G.phase = phase; G.t = 0; G.off = 0; G.endT = 0; G.gone = 0; G.apAsked = nil
  log(phase)
  -- A STEP GIVEN UP LEAVES NOTHING PLAYING: his summoned helpers go, as at a
  -- reset (the hook, next frame), and are kept going for the whole stuck
  -- phase - one his own lines bring out again goes too; the next reset's
  -- place lets them be. The last demon girl of a Monsters step that did not
  -- start walked on to her and played its whole scene under the note 'this
  -- scene did not start', over and over. A companion's step given up on: its
  -- companion is on the list (the gate is shut again, so it stays gone).
  -- The drive stands both up two frames later.
  local s = curStep()
  if phase == 'stuck' then killHelpers(1) end
  -- Every reset: each prototype mode's own (whatever it left out goes),
  -- then its per-pair state and a step with no grab waiting to start.
  if phase == 'reset' then MODE.each('reset', s); G.m, G.pre = nil, nil end
end
local function what(a)
  if a.ext then return a.ext .. ' ' .. tostring(a.name or a.mode or '') end
  if a.wait then return 'wait' end
  if a.setOnly then return 'set' end
  if a.jump then return 'jump ' .. a.jump .. (a.at and (' at ' .. a.at) or '') end
  return (G.sustained[G.ai] and 'sustain' or a.mode) .. ' ' .. a.name
end

-- A step with a place (a summon that walks in from the screen edge he faces)
-- or an edge-only summon (a helper that walks toward her or can take his own
-- side: Kur0maru's dogs) plays only where nothing stands beyond her: alone,
-- or at the far right as he stands, or at the far left mirrored (he faces
-- left). So does a grab of a wide reach (a dash that would carry him into the
-- pair beside: wide).
local function outer(s)
  if not (s and (s.place or s.edgeOnly or s.wide)) or NSLOT == 1 then return true end
  return G.k == 1 or G.k == NSLOT
end
-- A step that needs the screen's edge - a summon that walks in from it
-- (place), a receiver's helper her root summons at it - is placed and
-- grabbed only while the view is its own: every pair in view, or zoomed on
-- this pair with the camera still. A grab that is a projectile's hit (proj:
-- the engine removes a projectile past the view's edge, 40 beyond it by
-- default) only while the camera is still with its pair in view. Zoomed on
-- another pair it waits otherwise (a scene of it already running plays on).
local function edgeReady(s)
  if not CAM.free then return true end
  if (s and s.place and outer(s)) or rhelperOf(curPair()) then return G.k == SEL and CAM.still >= 3 end
  if s and s.proj then
    local c = (G.k - (NSLOT + 1) / 2) * SPACING + (G.dx or 0)
    return CAM.still >= 3 and math.abs(c - (CAM.x or 0)) + GAP / 2 <= 160 / (CAM.z or 1) + 20
  end
  return true
end
-- (His companion is out on purpose for a step of its own: not counted there.)
local function helpersOut()
  local p, s = curPair(), curStep()
  local mine = s and s.companion and s.companion.id
  local t = {}
  for _, id in ipairs((p and p.kill) or {}) do
    if id ~= mine then t[#t + 1] = id .. '=' .. tostring(onP(GIVER, function() return numHelper(id) end) or 0) end
  end
  return table.concat(t, ',')
end
-- His companion's state (nil: not out). Lua's helper(id) makes it the working
-- character, inside his.
local function companionState(c)
  return onP(GIVER, function() if helper(c.id) then return stateNo() end return nil end)
end
-- One of the pair's companions out (any of its steps').
local function companionsOut()
  local p = curPair()
  for _, x in ipairs((p and p.steps) or {}) do
    if x.companion and companionState(x.companion) then return true end
  end
  return false
end
local function companionVar(c, e)
  return onP(GIVER, function() if helper(c.id) then if e.k == 1 then return var(e.i) end return fvar(e.i) end return nil end)
end
-- A fighter's place from the stage's center, in 320-wide units (Lua's posX
-- is his position minus the camera's).
local function absX(pn) return onP(pn, function() return (posX() + cameraPosX()) * 320 / localCoordX() end) end
-- A scene whose lean is learned and made up for: several pairs, a step that
-- needs nothing of the screen or the pairs beside it (a summon from the
-- edge, an edge-only helper, a companion, a projectile's grab keep their
-- place; a grab of its own reach ends where she stood, its lean no lean),
-- never a receiver's helper's pair.
function LEAN.ok(s)
  return NSLOT > 1 and s ~= nil and not (s.place or s.edgeOnly or s.companion or s.proj or s.reach) and not rhelperOf(curPair())
    and not (MODE.of(s) and MODE.of(s).place)
end
function LEAN.of(s)
  return LEAN.by[G.pi .. ':' .. G.si] or (s.entry and LEAN.by[G.pi .. '@' .. s.entry]) or 0
end
-- A step's stand as place() reads it (its place, its reach, edge-only or
-- wide, its companion, a mode's own place, her lift in the air): two steps
-- with the same stand grab from the same place (gotoStep).
function LEAN.stand(s)
  if s == nil then return '' end
  local p = s.place and (tostring(s.place.front) .. ',' .. tostring(s.place.gap)) or ''
  local m = MODE.of(s)
  return p .. '|' .. tostring(s.reach) .. '|' .. tostring(s.edgeOnly) .. '|' .. tostring(s.wide) .. '|' .. tostring(s.companion and s.companion.id) .. '|' .. tostring(m and m.place and s.ext)
    .. '|' .. tostring(s.lift and s.lift.y)
end
-- She is out of his states: the scene's end, unless he is still in a state
-- of his own (not a basic one) and she has been out at most K.GRACE ticks.
function LEAN.ended()
  G.gone = (G.gone or 0) + 1
  local h = giverState()
  if G.gone <= K.GRACE and h >= 200 and not (h >= 5000 and h <= 5999) then return false end
  return true
end
-- Stand them close and facing each other: most grabs connect at point blank,
-- and every one of them from here.
local function place()
  local gx, rx = -18, 18
  local s = curStep()
  local fc = 1
  local h = rhelperOf(curPair())
  G.lean = nil
  -- A prototype mode's step that stands the pair its own way.
  local M = MODE.of(s)
  if M and M.place then return MODE.run(M, 'place', s) end
  if h then
    -- A receiver's helper: her root summons her at the screen edge it
    -- faces (postype front) and she runs back toward it. So both face that
    -- edge, he in front with her root RBACK behind him - his grab lunges
    -- forward and hits all it touches (hitonce is 1 for throws only), his
    -- Clsn1 never reaches behind him - and once she is ready the hook stands
    -- her HGAP in front of him, facing him. Several pairs: an edge slot
    -- (her steps are edge-only), facing that edge (the far left mirrored).
    local m = (NSLOT > 1 and G.k == 1) and -1 or 1
    local c = 0
    local ug = onP(GIVER, function() return localCoordX() / 320 end) or 1
    local ur = onP(RECV, function() return localCoordX() / 320 end) or 1
    local abs = 0
    if NSLOT > 1 then c = (G.k - (NSLOT + 1) / 2) * SPACING; abs = 1 end
    local g = c + m * K.RBACK / 2
    log(string.format('place for her helper: him at %.0f, her root at %.0f, her at %.0f', g, g - m * K.RBACK, g + m * K.HGAP) .. (m < 0 and ' mirrored' or ''))
    mset(GIVER, '_gal_x', g * ug); mset(GIVER, '_gal_abs', abs); mset(GIVER, '_gal_face', m); mset(GIVER, '_gal_place', 1)
    mset(RECV, '_gal_x', (g - m * K.RBACK) * ur); mset(RECV, '_gal_abs', abs); mset(RECV, '_gal_face', m); mset(RECV, '_gal_place', 1)
    mset(RECV, '_gal_rx', (g + m * K.HGAP) * ur); mset(RECV, '_gal_rf', -m)
    return
  end
  if s and s.place and outer(s) then
    -- PosSet x is camera-relative, and the screen edge he faces (he faces
    -- right) is at +half his screen width - the edge his helpers' postype
    -- = front uses. The leftmost of several pairs is mirrored: he faces the
    -- left edge.
    local hw = onP(GIVER, function() return (rightEdge() - leftEdge()) / 2 end) or 160
    rx = hw - s.place.front
    gx = rx - s.place.gap
    if NSLOT > 1 and G.k == 1 then fc = -1 end
  elseif s and s.reach and NSLOT == 1 then
    -- GRAB REACH: a grab that connects only from further off (a dash, a run,
    -- a far box) stands the pair its reach apart (320-wide units), centered,
    -- never wider than the view less 20 a side; each in its own units.
    local ug = onP(GIVER, function() return localCoordX() / 320 end) or 1
    local ur = onP(RECV, function() return localCoordX() / 320 end) or 1
    local hw = (onP(GIVER, function() return (rightEdge() - leftEdge()) / 2 end) or 160 * ug) / ug
    local d = math.min(s.reach, 2 * (hw - 20))
    log(string.format('place reach %.0f', d) .. ((s.reachMin and d < s.reachMin) and ' (reach wider than the view)' or ''))
    gx, rx = -d / 2 * ug, d / 2 * ur
  elseif NSLOT > 1 then
    -- Several pairs: each at its place, from the stage's center (the hook
    -- takes the camera out), in each character's own units - where the
    -- mouse left it (dx), if it was dragged.
    local c = (G.k - (NSLOT + 1) / 2) * SPACING + (G.dx or 0)
    local ug = onP(GIVER, function() return localCoordX() / 320 end) or 1
    local ur = onP(RECV, function() return localCoordX() / 320 end) or 1
    -- An edge-only summon at the far left: mirrored, he faces the left edge
    -- (a grab of a wide reach too: its lunge goes toward the edge).
    -- A companion that spawns behind him the other way round: he faces the
    -- other pairs, so it stands between him and the screen edge (mirrored
    -- at the far right).
    local m = (s and (s.edgeOnly or s.wide) and G.k == 1) and -1 or 1
    if s and s.companion and s.companion.behind then m = (G.k == NSLOT) and -1 or 1 end
    -- Its scene's lean made up for: stood that much the other way.
    local l = LEAN.ok(s) and LEAN.of(s) or 0
    local b = c - m * l
    if LEAN.ok(s) then G.lean = { base = b, m = m, used = l } end
    -- A grab of its own reach (GRAB REACH) stands the two that far apart
    -- where it plays (an edge slot past REACH_MID).
    local gap = (s and s.reach and outer(s)) and s.reach or GAP
    log(string.format('place at %.0f', c) .. (l ~= 0 and string.format(' (its scene leans %.0f: stood at %.0f)', l, b) or '') .. (m < 0 and ' mirrored' or '')
      .. (gap ~= GAP and string.format(' reach %.0f', gap) or ''))
    mset(GIVER, '_gal_x', (b - m * gap / 2) * ug); mset(GIVER, '_gal_abs', 1); mset(GIVER, '_gal_face', m); mset(GIVER, '_gal_place', 1)
    mset(RECV, '_gal_x', (b + m * gap / 2) * ur); mset(RECV, '_gal_abs', 1); mset(RECV, '_gal_face', -m); mset(RECV, '_gal_place', 1)
    -- (This place has the whole drag in it: none of it is left to add.)
    mset(GIVER, '_gal_dx', 0); mset(RECV, '_gal_dx', 0)
    return
  end
  mset(GIVER, '_gal_x', fc * gx); mset(GIVER, '_gal_abs', 0); mset(GIVER, '_gal_face', fc); mset(GIVER, '_gal_place', 1)
  mset(RECV, '_gal_x', fc * rx); mset(RECV, '_gal_abs', 0); mset(RECV, '_gal_face', -fc); mset(RECV, '_gal_place', 1)
end

local SETUP_PHASES = { summon = true, grab = true, enter = true, act = true, show = true }
-- (A prototype mode whose own phases, '<id>:<name>', carry its step's setup
-- adds them here from its chunk.)
-- The pair's setup with the step's own on top (a companion's step releases
-- the gate the pair holds shut): the same variable replaced, a new one added.
local function setupOf(p, s)
  local su = (p and p.setup) or {}
  if not (s and s.setup) then return su end
  if s.merged then return s.merged end
  local out = {}
  for _, e in ipairs(su) do
    local r = e
    for _, x in ipairs(s.setup) do if x.k == e.k and x.i == e.i then r = x end end
    out[#out + 1] = r
  end
  for _, x in ipairs(s.setup) do
    local found = false
    for _, e in ipairs(su) do if x.k == e.k and x.i == e.i then found = true end end
    if not found then out[#out + 1] = x end
  end
  s.merged = out
  return out
end
-- THE HOLD (gallerydata.js detectHold). A pair with one has the clocks that end
-- his scenes (his state at time N or at the end of its animation: 't' and 'a')
-- and hers (her state at time N). While a step of it shows, the state each of
-- them is in is looked up and the hook is asked (the _gal_h* maps on him) to go
-- back into it ${K_HOLD_LEAD} ticks before its clock runs out: his state into itself (its
-- time 0 lines put her in hers again), hers sent again by whoever holds her.
-- Asked only while a step shows and holds no note: a scene the driver walks to
-- (grab, path) runs its own way, and one that is given up on is stood up.
function LEAN.holdBy(p)
  if p.holdBy == nil then
    local his, her = {}, {}
    for _, e in ipairs(p.hold and p.hold.his or {}) do his[e.s] = e end
    for _, e in ipairs(p.hold and p.hold.her or {}) do her[e.s] = e.at end
    p.holdBy = { his = his, her = her }
  end
  return p.holdBy
end
function LEAN.writeHold(p)
  -- (A pair with no hold asks for nothing: no map written, none to clear.)
  if K.NOHOLD or (not (p and p.hold) and G.hold.hk == 0 and G.hold.hr == 0) then return end
  local hk, hs, ht, hr, hrt = 0, 0, 0, 0, 0
  if p and p.hold and G.phase == 'show' and G.note == '' then
    local by = LEAN.holdBy(p)
    local gs = giverState()
    local e = by.his[gs]
    if e then
      hs = gs
      if e.k == 't' then hk, ht = 1, e.at - ${K_HOLD_LEAD} else hk, ht = 2, -${K_HOLD_LEAD} end
    end
    local rs = recvState()
    local at = by.her[rs]
    if at then hr, hrt = rs, at - ${K_HOLD_LEAD} end
  end
  local anchor = false
  if hk ~= G.hold.hk or hs ~= G.hold.hs or hr ~= G.hold.hr then
    -- (A new state to hold: the hook keeps where they stand, once, early in it.)
    anchor = hk ~= 0 and (hk ~= G.hold.hk or hs ~= G.hold.hs)
    G.hold.hk, G.hold.hs, G.hold.hr = hk, hs, hr
    if LOG and (hk ~= 0 or hr ~= 0) then log('hold: his ' .. hs .. (hk == 1 and (' at time ' .. ht) or hk == 2 and ' at the end of its animation' or ' (none)') .. ', hers ' .. hr .. (hr ~= 0 and (' at time ' .. hrt) or ' (none)')) end
  end
  mset(GIVER, '_gal_hk', hk); mset(GIVER, '_gal_hs', hs); mset(GIVER, '_gal_ht', ht)
  mset(GIVER, '_gal_hr', hr); mset(GIVER, '_gal_hrt', hrt)
  if anchor then mset(GIVER, '_gal_hv', 0); mset(GIVER, '_gal_hanc', 1) end
  -- (Test only, with -hgallerylog: where the two stand, now and then, while a
  -- held scene plays, so a loop that walks one of them off shows in the log.)
  if LOG and p and p.hold and G.phase == 'show' and MATCH.f % 20 == 0 then
    local function at(n) return onP(n, function() return string.format('x %.0f y %.0f air %.0f st %d t %d anim %d', screenPosX(), screenPosY(), posY(), stateNo(), time(), anim()) end) or '-' end
    log('hold pos f=' .. MATCH.f .. ' his ' .. at(GIVER) .. ' targets ' .. tostring(onP(GIVER, function() return numTarget() end)) .. ' | her ' .. at(RECV))
  end
end
-- The pair's setup, asked for every frame (the hook holds it on him).
local function writeSetup()
  local p = curPair()
  local ps = p and p.p1spr
  mset(GIVER, '_gal_p1', (ps and not member(giverState(), ps.keep)) and 1 or 0)
  -- A receiver's helper: he and her root never turn to face each other
  -- (her root stands behind him), from the first frame on.
  if p and p.receiver.helper then mset(GIVER, '_gal_nt', 1); mset(RECV, '_gal_nt', 1) end
  -- A receiver with no body at rest: the stance the hook holds her in
  -- (0 for everyone else).
  mset(RECV, '_gal_stand', (p and p.receiver.stance) or 0)
  -- HIS OTHER BRANCH: the pair's swap set, played on her by the hook's +1.
  mset(RECV, '_gal_sw', (p and p.swapSet) or 0)
  LEAN.writeHold(p)
  local s = curStep()
  -- AN ANTI-AIR GRAB: she is held in the air (the hook's own state, at the
  -- step's height, on its animation) from the place until his grab takes her.
  local up = s and s.lift and (G.phase == 'place' or G.phase == 'grab' or G.phase == 'enter') and not inScene()
  mset(RECV, '_gal_lift', up and s.lift.y or 0)
  mset(RECV, '_gal_lifta', up and s.lift.anim or 0)
  -- A step's own setup only once the pair stands where it plays (from the
  -- summon on): a companion spawns where HE stands, facing as he faces, so
  -- the gate opens after the place, never before it (a companion spawned
  -- mid-reset stood 300 px off, facing away). And only where the step plays:
  -- one refused between two pairs, or given up on, keeps the pair's gate
  -- shut, or its companion would spawn and roam into the other pairs.
  if s and s.setup and (not outer(s) or not SETUP_PHASES[G.phase]) then s = nil end
  -- His companion's pins, on it, every frame of its steps.
  mset(GIVER, '_gal_hp', (s and s.companion and s.companion.pin) or 0)
  -- ... and the animation the step holds it at (a speed, a climax picture).
  mset(GIVER, '_gal_ha', (s and s.companion and s.companion.hold) or 0)
  -- A step's re-rolls of a random branch of his (the hook's +1), every frame.
  mset(GIVER, '_gal_rr', (s and s.reroll) or 0)
  local su = setupOf(p, s)
  -- Its actions' holds, from the action that names them on, while the step
  -- plays: a set his own files would undo (Brian's position 5).
  if s and (G.phase == 'act' or G.phase == 'show') then
    local path = pathOf(s)
    local last = G.phase == 'show' and #path or math.min(G.ai or 0, #path)
    for k = 1, last do
      local a = path[k]
      if a and a.hold then
        local out = {}
        for _, e in ipairs(su) do out[#out + 1] = e end
        for _, x in ipairs(a.hold) do
          local found = false
          for i, e in ipairs(out) do if e.k == x.k and e.i == x.i then out[i] = x; found = true end end
          if not found then out[#out + 1] = x end
        end
        su = out
      end
    end
  end
  for k = 1, K.SETUP_SLOTS do
    local e = su[k]
    if e then
      mset(GIVER, '_gal_s' .. k .. 'i', e.i); mset(GIVER, '_gal_s' .. k .. 'v', e.v); mset(GIVER, '_gal_s' .. k .. 'k', e.k)
    else
      mset(GIVER, '_gal_s' .. k .. 'k', 0)
    end
  end
end
-- An action's sets, made by the hook once, next frame.
local function requestSets(sets)
  for k, e in ipairs(sets or {}) do
    if k <= K.SET_SLOTS then
      mset(GIVER, '_gal_v' .. k .. 'i', e.i); mset(GIVER, '_gal_v' .. k .. 'v', e.v); mset(GIVER, '_gal_v' .. k .. 'k', e.k)
    end
  end
end

local function startAction(k)
  local s = curStep()
  local path = pathOf(s)
  G.phase, G.ai, G.t = 'act', k, 0
  G.before, G.recvAt, G.lastRecv = {}, 0, recvState()
  G.lastRecvTime = recvTime()
  G.jumpReady, G.lastJump, G.lastSt = true, -100, giverState()
  local a = path[k]
  if a.cmd and (a.mode == 'sustain' or G.sustained[k]) then G.sustain = a.cmd end
  log('act ' .. k .. '/' .. #path .. ' ' .. what(a))
end
-- Run the step's path from the start, from wherever the scene is.
local function startPath()
  G.sustain, G.held, G.mash = 0, nil, 0
  startAction(1)
end

local function sceneEnded()
  -- The scene ended by itself. After it showed (a climax that ends the
  -- scene): grab again and run the path again. Before it showed: again, but
  -- not forever (a scene that needs one of his helpers, which a forced grab
  -- never spawns, ends every time).
  if G.phase == 'show' and G.note == '' then G.restarts = 0 else G.restarts = G.restarts + 1 end
  local s = curStep()
  if LOG and s and s.companion then
    log('ended: her previous ' .. tostring(onP(RECV, function() return prevStateNo() end)) .. ', his companion in ' .. tostring(companionState(s.companion)) .. ' at match frame ' .. MATCH.f)
  end
  if G.restarts >= 3 then G.note = 'this scene ends before it shows'; begin('stuck') else begin('reset') end
end

-- An action that did not show in time: from where the scene was, the step is
-- tried once more from a fresh grab; from a fresh grab it is reported.
local function actionFailed(why)
  if why then
    G.note = why
    log('act ' .. G.ai .. ' failed')
    begin('show')
  elseif not G.fresh then
    G.note = 'not reached in place - grabbing again'
    log('act ' .. G.ai .. ' failed')
    begin('reset')
  else
    G.note = 'did not reach this scene'
    log('act ' .. G.ai .. ' failed')
    begin('show')
  end
end

-- One tick of the current action.
local function act(s)
  local path = pathOf(s)
  local a = path[G.ai]
  -- (A step with no grab: until her first scene shows, out of one is where
  -- it starts - it waits within its patience.)
  if not inScene() then
    if not G.pre then if LEAN.ended() then return sceneEnded() end return end
  else
    G.gone = 0
    if G.pre then G.pre = false end
  end
  local r, rt = recvState(), recvTime()
  -- (A companion's way there, for the log: her state and its, as they change.)
  if LOG and s.companion then
    local cs = companionState(s.companion)
    if r ~= G.herNow or cs ~= G.compNow then G.herNow, G.compNow = r, cs; log('her state ' .. r .. ', its ' .. tostring(cs) .. ' t=' .. G.t) end
  end
  if r ~= G.lastRecv or rt < G.lastRecvTime then G.recvAt = G.t end
  G.lastRecv, G.lastRecvTime = r, rt
  -- Variables alone: made on its first frame (the hook, next frame), then on.
  if a.setOnly and G.t == 1 then requestSets(a.set); return end
  -- A command's variables go with it, even when its states already show (a
  -- step that turns a leftover auto mode off must turn it off every time).
  if a.cmd and G.t == 1 then requestSets(a.set) end
  -- (His animation, where the action names some: an anim hub's scene.)
  local ga = (a.anim or a.fromAnim) and onP(GIVER, function() return anim() end) or nil
  if (member(r, a.show) and (a.anim == nil or member(ga, a.anim))) or (a.setOnly and a.show == nil) then
    log('act ' .. G.ai .. '/' .. #path .. ' done t=' .. G.t)
    -- (A companion's art, for the test: its animation and hers as the step
    -- shows. Its pinned art variants make one step show one of them.)
    if LOG and s.companion then
      log('companion art: its anim ' .. tostring(onP(GIVER, function() if helper(s.companion.id) then return anim() end return nil end))
        .. ', her anim ' .. tostring(onP(RECV, function() return anim() end)))
    end
    if G.ai < #path then return startAction(G.ai + 1) end
    -- (A receiver's helper, for the test: the action she is drawn with as
    -- the step shows - her art, never a number of her root's own.)
    if LOG and rhelperOf(curPair()) then log('helper art: her anim ' .. tostring(onR(function() return anim() end))) end
    if a.cmd and a.mode == 'hold' and a.adapt and not G.sustained[G.ai] then G.held = { k = G.ai, cmd = a.cmd, before = G.before } end
    if a.cmd and a.mode == 'mash' then G.mash = a.cmd end
    G.note, G.tries, G.restarts = '', 0, 0
    G.shown = true
    return begin('show')
  end
  G.before[r] = true
  local pat = a.patience or K.PATIENCE
  -- Right after a fresh grab his intro plays first (DongHwan's runs about 190
  -- frames, brian's 250): the first action gets at least the default.
  if G.fresh and G.ai == 1 and pat < K.PATIENCE then pat = K.PATIENCE end
  if G.t > pat * K.PATIENCE_CAP or (G.t > pat and G.t - G.recvAt > pat) then return actionFailed(nil) end
  if (a.cmd or a.wait) and a.from then
    local st = giverState()
    if not member(st, a.from) then
      -- In place, a command that cannot act from where he is: grab again at
      -- once instead of pressing it into another meaning; so is a wait for a
      -- rung of a timed ladder his scene is already past. After a fresh grab
      -- he passes through states on the way in: wait.
      if not G.fresh and G.t <= 1 then log('act ' .. G.ai .. ' cannot act from his ' .. st); return actionFailed(nil) end
      return
    end
  end
  -- The same for his animation (an anim hub: a press acts from the idle of
  -- a position it leads on from): in place elsewhere, grabbed again.
  if a.fromAnim and not member(ga, a.fromAnim) then
    if not G.fresh and G.t <= 1 then log('act ' .. G.ai .. ' cannot act from his anim ' .. tostring(ga)); return actionFailed(nil) end
    return
  end
  -- A prototype mode's action: its mode acts this tick (true hands the tick
  -- on to the command or jump below). When it is done, its patience, from
  -- and fromAnim are the core's, above.
  if a.ext then
    local M = MODE.by[a.ext]
    if M == nil then return actionFailed('its mode is off') end
    if M.act and MODE.run(M, 'act', a, s) ~= true then return end
  end
  if a.jump then
    -- Made only from the state the data names (his hub: made during a grab
    -- intro it would read variables the scene has not set yet), and again
    -- each time he comes back there - never on the hub's own re-entries, or
    -- the jump would restart the hub before it acts.
    local st = giverState()
    -- A scene THE HOLD keeps (his state or hers is on its clocks) never comes
    -- round to the state the jump waits for: in place, grabbed again at once
    -- (Minotaur's mount, a jump from his hub 1011, out of his held 1030).
    if a.at and st ~= a.at and not G.fresh and G.t <= 1 then
      local p = curPair()
      local by = p and p.hold and LEAN.holdBy(p)
      if by and (by.her[recvState()] or by.his[st]) then log('act ' .. G.ai .. ' cannot act from his ' .. st .. ' (the scene is held)'); return actionFailed(nil) end
    end
    if st ~= G.lastSt and (a.at == nil or st == a.at) then G.jumpReady = true end
    G.lastSt = st
    if G.t == G.lastJump + 1 then
      log('act ' .. G.ai .. '/' .. #path .. ' jumped his=' .. st .. ' prev=' .. tostring(onP(GIVER, function() return prevStateNo() end))
        .. ' time=' .. tostring(onP(GIVER, function() return time() end)))
    end
    if G.jumpReady and (a.at == nil or st == a.at) and G.t - G.lastJump > 10 then
      requestSets(a.set)
      local ok = onP(GIVER, function() return changeState(a.jump) end)
      G.lastJump, G.jumpReady = G.t, false
      G.lastSt = a.jump
      if ok == false then return actionFailed('his state ' .. a.jump .. ' is missing') end
    end
  elseif a.cmd then
    if G.sustained[G.ai] or a.mode == 'sustain' then
      G.sustain = a.cmd
    elseif a.mode == 'press' then
      -- (A PRESS SUMMON, a step with no grab whose press calls his helper:
      -- not pressed again while that helper is out.)
      if (G.t - 1) % K.PRESS_EVERY == 0 and not (s.noGrab and s.clear and (onP(GIVER, function() return numHelper(s.clear) end) or 0) > 0) then G.slot = a.cmd end
    elseif a.mode == 'mash' then
      if (G.t - 1) % K.MASH_EVERY == 0 then G.slot = a.cmd end
    else
      G.slot = a.cmd
    end
  end
end

local function drive()
  local s = curStep()
  if s == nil then return end
  -- A prototype mode's step whose mode is off (an error switched it off):
  -- it stops, said once.
  if s.ext and MODE.by[s.ext] == nil then
    if G.phase ~= 'stuck' then G.note = 'its mode is off'; begin('stuck') end
    return
  end
  G.t = G.t + 1
  if G.phase == 'reset' then
    -- The commands stop first; two frames later both go back to their own
    -- standing state (a command still asserted then would act in state 0).
    G.sustain, G.held, G.mash = 0, nil, 0
    -- His summoned helpers go first (the hook, next frame): a dog holds her
    -- longer than any wait, and one left out would stand in the next scene.
    -- (A receiver's helper too: killHelpers.)
    if G.t == 1 then killHelpers(1) end
    if G.t >= 3 then
      onP(RECV, function() selfState(0) end)
      onP(GIVER, function() selfState(0) end)
      begin('place')
    end
  elseif G.phase == 'place' then
    if G.t == 1 then killHelpers(0) end
    if G.t == 2 and not edgeReady(s) then
      -- (Zoomed on another pair: it waits here, counted as settled.)
      if not G.viewWait then G.viewWait = true; log('place: waits for the view (zoomed elsewhere)') end
      G.t = 1
    elseif G.t == 2 and s.alone and NSLOT > 1 then
      -- A grab of a reach past REACH_EDGE (alone): its lunge crosses the
      -- pairs beside it, so it plays only with one pair on screen.
      G.note = 'this scene plays only with one pair on screen'
      return begin('stuck')
    elseif G.t == 2 then
      if G.viewWait then G.viewWait = false; log('place: the view is back') end
      place()
    end
    -- A helper of his still out (a horse retreating after a reset) can throw
    -- her back into his states right after the reset: out again. (A
    -- receiver's helper is still being removed here.)
    if G.t > 2 and inScene() and not rhelperOf(curPair()) then
      onP(RECV, function() selfState(0) end)
      log('place: pulled back in - out again')
      G.t = 1
    end
    local cl = (s.clear and onP(GIVER, function() return numHelper(s.clear) end)) or 0
    if G.t >= 8 and cl > 0 and G.t < 8 + 180 then
      if G.t == 8 then log('place: waiting for helper ' .. s.clear .. ' to leave') end
    elseif G.t >= 8 then
      if outer(s) then
        -- A companion's step: it must be out and idle first. A receiver's
        -- helper: her root summons her first.
        if rhelperOf(curPair()) then begin('rsummon') else begin(s.companion and 'summon' or 'grab') end
      else
        -- Between two other pairs: his summon would cross them.
        G.note = 'this scene plays only at the far left or right'
        begin('stuck')
      end
    end
  elseif G.phase == 'summon' then
    -- His companion: released by the step's setup, it spawns where his own
    -- files spawn it (behind him); its grab needs it in one of its idle
    -- states (after its entrance).
    local c = s.companion
    local st = companionState(c)
    if st and member(st, c.ready) then
      log('summon: helper ' .. c.id .. ' out in ' .. st .. ' after ' .. G.t)
      begin('grab')
    elseif G.t > K.SUMMON_MAX then
      G.note = 'his helper did not come out'
      begin('stuck')
    end
  elseif G.phase == 'rsummon' then
    -- A receiver's helper: her root's own command summons her (the hook
    -- asserts it on the root, pressed until she is out); she runs in from
    -- the edge her root faces and stands still in one of her ready states
    -- (a taunt), where the hook stands her in front of him, facing him, and
    -- he grabs her two frames later - before she runs out and leaves.
    local h = rhelperOf(curPair())
    if G.t == 1 then G.rplace = nil end
    local st = recvState()
    if st < 0 then
      if G.t >= 3 and (G.t - 3) % K.PRESS_EVERY == 0 then G.rslot = h.cmd end
    elseif member(st, h.ready) then
      if G.rplace == nil then
        G.rplace = G.t
        log('rsummon: her helper ' .. h.id .. ' ready in ' .. st .. ' after ' .. G.t)
      elseif G.t >= G.rplace + 2 then
        begin('grab')
      end
    end
    if G.phase == 'rsummon' and G.t > K.SUMMON_MAX then
      G.note = 'her helper did not come out'
      begin('stuck')
    end
  elseif G.phase == 'grab' then
    -- A scene key on the grab's one tick hands the grab the new step: a
    -- companion's step still wants it out and idle first, and another step
    -- never grabs with one out.
    if s.companion and not member(companionState(s.companion) or -1, s.companion.ready) then return begin('summon') end
    if not s.companion and companionsOut() then return begin('reset') end
    -- A receiver's helper that left her ready states on the way (her taunt
    -- ran out; a scene key on the grab's tick) is summoned again, removed at
    -- a reset first.
    local h = rhelperOf(curPair())
    if h and not member(recvState(), h.ready) then
      log('grab: her helper is in ' .. recvState() .. ', not ready - again')
      return begin('reset')
    end
    if LOG and curPair().kill then local out = helpersOut(); if out ~= '' then log('grab: his summoned helpers out ' .. out) end end
    if LOG and s.companion then
      local cx = onP(GIVER, function() if helper(s.companion.id) then return posX() end return nil end)
      log(string.format('grab: his companion %d in %s at x %s, him at %s, her at %s', s.companion.id, tostring(companionState(s.companion)), tostring(cx and math.floor(cx)),
        tostring(onP(GIVER, function() return math.floor(posX()) end)), tostring(onP(RECV, function() return math.floor(posX()) end))))
    end
    if LOG and h then
      local px = function(fn) local v = fn(function() return posX() end); return v and math.floor(v) or nil end
      log(string.format('grab: her helper %d in %s at x %s facing %s, him at %s, her root at %s', h.id, tostring(recvState()), tostring(px(onR)),
        tostring(onR(function() return facing() end)), tostring(px(function(f) return onP(GIVER, f) end)), tostring(px(function(f) return onP(RECV, f) end))))
    end
    -- A step with no grab: its path starts here (his commands from where he
    -- stands). A prototype mode's step may grab its own way.
    if s.noGrab then G.entry, G.fresh, G.pre = s.entry, true, true; return startPath() end
    local M = MODE.of(s)
    if M and M.grab then MODE.run(M, 'grab', s)
    else
      -- AIR START: a grab state with air physics, lifted by the hook next
      -- frame (before its first tick) to where his lead's arc or his jump's
      -- apex puts him, with that velocity.
      if s.air then mset(GIVER, '_gal_ay', s.air.y); mset(GIVER, '_gal_avx', s.air.vx); mset(GIVER, '_gal_avy', s.air.vy); mset(GIVER, '_gal_air', 1) end
      onP(GIVER, function() changeState(s.entry) end)
    end
    G.entry, G.fresh = s.entry, true
    begin('enter')
  elseif G.phase == 'enter' then
    -- A receiver's helper gone before his grab caught her: again.
    if rhelperOf(curPair()) and recvState() < 0 then
      G.tries = G.tries + 1
      log('enter: her helper left')
      if G.tries < 3 then return begin('reset') end
      G.note = 'this scene did not start'
      return begin('stuck')
    end
    -- (A companion's grab, for the log: its states on the way.)
    if LOG and s.companion then
      local cs = companionState(s.companion)
      if cs ~= G.compNow then G.compNow = cs; log('enter: its ' .. tostring(cs) .. ' t=' .. G.t) end
    end
    -- (A summon's helper on its way, for the test, every 30 ticks: its state
    -- and place, his and hers - camera-relative, each in its own units.)
    if LOG and s.clear and G.t % 30 == 1 then
      local px = function(pn) local v = onP(pn, function() return posX() end); return v and string.format('%.0f', v) or '?' end
      log('enter: helper ' .. s.clear .. ' ' .. tostring(onP(GIVER, function() if helper(s.clear) then return 'in ' .. stateNo() .. string.format(' at x %.0f', posX()) end return 'not out' end))
        .. ', him at x ' .. px(GIVER) .. ', her at x ' .. px(RECV) .. ' t=' .. G.t)
    end
    if inScene() then
      -- (The companion's family, as its pin left it.)
      if LOG and s.companion then
        local t = {}
        for _, e in ipairs(s.companion.pins) do t[#t + 1] = (e.k == 1 and 'var(' or 'fvar(') .. e.i .. ')=' .. tostring(companionVar(s.companion, e)) end
        log('companion ' .. s.companion.id .. ' grabbed her in its ' .. tostring(companionState(s.companion)) .. (#t > 0 and (', ' .. table.concat(t, ', ')) or '') .. ' after ' .. G.t .. ' at match frame ' .. MATCH.f)
      end
      startPath()
    elseif G.t > K.ENTER_MAX then
      G.tries = G.tries + 1
      if G.tries < 3 then begin('reset') else G.note = 'this scene did not start'; begin('stuck') end
    end
  elseif G.phase == 'act' then
    act(s)
  elseif G.phase == 'show' then
    -- (A step with no grab that never reached its scene keeps its note: no
    -- scene of it ever ran to end.)
    if not inScene() and not G.pre then if LEAN.ended() then return sceneEnded() end return end
    G.gone = 0
    if showing(s) then G.off = 0 else G.off = G.off + 1 end
    -- Its lean, learned (LEAN): where the scene plays against where they
    -- were placed.
    if G.lean and G.t == LEAN.at and G.note == '' and LEAN.ok(s) and showing(s) then
      local gx, rx = absX(GIVER), absX(RECV)
      if gx and rx then
        local d = ((gx + rx) / 2 - G.lean.base) * G.lean.m
        local key = G.pi .. ':' .. G.si
        local had = LEAN.by[key]
        if math.abs(d) <= LEAN.max then
          LEAN.by[key] = had and (had + d) / 2 or d
          if s.entry then LEAN.by[G.pi .. '@' .. s.entry] = LEAN.by[key] end
          log(string.format('lean %.0f (made up for %.0f)', d, G.lean.used))
          -- A reload's fast run: grabbed again at once, on its place.
          if had == nil and math.abs(d - G.lean.used) > LEAN.min and MATCH.speed and not MATCH.restored then
            G.shown, G.dwellF, G.dwellIn = false, 0, 0
            log('lean: placed again')
            return begin('reset')
          end
        else
          log(string.format('lean %.0f: carried off, not kept', d))
        end
      end
    end
    -- (A companion picks its speeds at random: the log says each one.)
    if LOG and s.companion then
      local r = recvState()
      if r ~= G.herNow then G.herNow = r; log('her state ' .. r) end
      -- (And her animation, as it changes: a scene that plays its phases
      -- in one state of hers - the threesome's 69229-69235.)
      local ha = onR(function() return anim() end)
      if ha ~= G.herAnim then G.herAnim = ha; log('her anim ' .. tostring(ha)) end
    end
    if G.mash ~= 0 and G.t % K.MASH_EVERY == 1 then G.slot = G.mash end
    -- A held command whose effect let go again right away: hold it for good.
    local h = G.held
    if h and G.t <= K.SLIP and h.before[recvState()] then
      G.sustained[h.k], G.sustain, G.held = true, h.cmd, nil
      log('act ' .. h.k .. ' sustain (it lets go)')
    elseif h and G.t > K.SLIP then
      G.held = nil
    end
    -- A step that ends in a state it never leaves (the data's endStates:
    -- Bao's position 3 climax at a stage of 4 or more, her lie-down 65069
    -- after it) is grabbed again once it has been there a while.
    if s.endStates and member(recvState(), s.endStates) then
      G.endT = G.endT + 1
      if G.endT > K.REPLAY then log('ended in ' .. recvState() .. ': grabbing again'); return begin('reset') end
    else
      G.endT = 0
    end
    -- A step that moved on (a climax back to its position) is played again,
    -- in place; a grab alone, or a leaf, is grabbed again.
    if G.note == '' and G.off > K.REPLAY then
      if s.path and #s.path > 0 and not s.leaf then
        G.fresh = false
        log('replay')
        startPath()
      else
        begin('reset')
      end
    end
  elseif G.phase == 'stuck' then
    -- Given up on (begin asked his summoned helpers gone): whatever still
    -- runs is stood up as a reset does, once they are gone - she in his
    -- states or dropped by a helper that held her, he in a move of his own
    -- (Colette's root stayed in her receiver state 1411 under the note). His
    -- leftover explods go meanwhile (_gal_clean, the tick).
    if G.t == 3 and (inScene() or recvState() ~= 0 or giverState() ~= 0) then
      log('stuck: stood up')
      onP(RECV, function() selfState(0) end)
      onP(GIVER, function() selfState(0) end)
    end
    -- (For the test: how many of his summoned helpers are out, the step's
    -- own companion too, a moment in and a while on.)
    if LOG and (G.t == 30 or G.t == 300) and curPair().kill then
      local out = {}
      for _, id in ipairs(curPair().kill) do out[#out + 1] = id .. '=' .. tostring(onP(GIVER, function() return numHelper(id) end) or 0) end
      log('stuck: his summoned helpers out ' .. table.concat(out, ',') .. ' t=' .. G.t)
    end
  elseif string.find(G.phase, ':', 1, true) then
    -- A prototype mode's own phase ('<id>:<name>'): its step's mode drives
    -- it; another step's (a key moved on midway) is placed again.
    local M = MODE.of(s)
    if M and M.drive and string.sub(G.phase, 1, #M.id + 1) == M.id .. ':' then MODE.run(M, 'drive', s, G.phase) else begin('reset') end
  end
end

-- ---- the overlay ------------------------------------------------------------
local W = (motif and motif.info and motif.info.localcoord and motif.info.localcoord[1]) or 320
local H = (motif and motif.info and motif.info.localcoord and motif.info.localcoord[2]) or 240
local SC = H / 240
local LINE = math.floor(10 * SC + 0.5)
local Y0 = math.floor(14 * SC + 0.5)
COL.WHITE, COL.GRAY = { 255, 255, 255 }, { 170, 170, 170 }
UI.font, UI.sprites = nil, {}
local function sprite(key)
  local s = UI.sprites[key]
  if s then return s end
  if UI.font == nil then UI.font = fontNew('f-6x9.def', -1) end
  local t = textImgNew()
  textImgSetFont(t, UI.font)
  textImgSetAlign(t, 0)
  textImgSetLocalcoord(t, W, H)
  textImgSetScale(t, SC, SC)
  textImgSetWindow(t, 0, 0, W, H)
  s = { ti = t, last = nil, col = nil }
  UI.sprites[key] = s
  return s
end
-- The font's glyphs are white: a color multiplies into them.
local function draw(key, str, y, gray, col)
  local s = sprite(key)
  if s.last ~= str then textImgSetText(s.ti, str); s.last = str end
  local c = col or (gray and COL.GRAY) or COL.WHITE
  local ck = c[1] * 65536 + c[2] * 256 + c[3]
  if s.col ~= ck then textImgSetColor(s.ti, c[1], c[2], c[3]); s.col = ck end
  textImgSetPos(s.ti, W / 2, y)
  textImgDraw(s.ti)
end
-- A note for a few seconds on the status line (a key that cannot act).
local function tell(text, t) MSG.text, MSG.t = text, t or 150 end
local function status()
  if MSG.t > 0 then return MSG.text end
  if G.note ~= '' then return G.note end
  if MATCH.speed and not MATCH.restored then return 'restoring...' end
  if G.phase == 'show' or G.phase == 'idle' then return '' end
  -- (A prototype mode's step: its own words for its phases and actions.)
  local M = MODE.of(curStep())
  if G.phase == 'act' then
    local path = pathOf(curStep())
    local a = path[G.ai]
    if a == nil then return '' end
    local n = #path > 1 and (' (' .. G.ai .. '/' .. #path .. ')') or ''
    if a.ext then return tostring((M and M.status and MODE.run(M, 'status', a, G.phase)) or 'working...') .. n end
    if (a.patience or K.PATIENCE) > K.PATIENCE then
      return (a.mode == 'press' and 'waiting for it (auto can take a minute)' or 'waiting for it (this can take a minute)') .. n
    end
    if a.wait or a.setOnly then return 'waiting for it...' .. n end
    if a.jump then return 'jumping...' .. n end
    if (a.mode == 'press' or a.mode == 'mash') and not G.sustained[G.ai] then return 'pressing...' .. n end
    return 'holding...' .. n
  end
  if M and M.status then local t = MODE.run(M, 'status', nil, G.phase); if t then return tostring(t) end end
  return 'grabbing...'
end
-- A line longer than the screen is cut, not drawn past both edges: during the
-- fight only the central 4:3 band of a wide motif reaches the screen, and the
-- 6x9 font at SC takes 6 * SC of it per character.
local FIT = math.max(20, math.floor(math.min(W, H * 4 / 3) / (6 * SC)) - 2)
local function fit(str)
  if #str <= FIT then return str end
  return str:sub(1, FIT - 2) .. '..'
end
-- A line whose end must stay (the scene's verdict and share): the rest is cut.
local function fitKeep(str, tail)
  if #str + #tail <= FIT or #tail + 12 > FIT then return fit(str .. tail) end
  return str:sub(1, FIT - #tail - 2) .. '..' .. tail
end
-- The step's line of what its position has (versions, speeds, climax, stages,
-- each with its key), split in two where it does not fit one.
local function splitInd(str)
  if #str <= FIT then return str, nil end
  local a, b = '', ''
  for part in string.gmatch(str .. '  ', '(.-)  ') do
    if part ~= '' then
      if b == '' and (a == '' or #a + 2 + #part <= FIT) then a = (a == '' and part) or (a .. '  ' .. part)
      else b = (b == '' and part) or (b .. '  ' .. part) end
    end
  end
  return a, (b ~= '' and b) or nil
end
COL.NAVC = { 255, 225, 120 }
-- A translucent box behind the overlay, inside the 4:3 band: its gray help
-- lines land on the stage's brightest art and on the scene itself (a scene
-- in the air rises under them), with one pair as with several (the owner:
-- "It gets hard to read sometimes").
UI.ovRect = nil
local function overlayBacking(lines)
  if UI.ovRect == nil then
    UI.ovRect = rectNew()
    rectSetLocalcoord(UI.ovRect, W, H)
    rectSetColor(UI.ovRect, 0, 0, 0)
    rectSetAlpha(UI.ovRect, 150, 106)
  end
  local bw = math.min(W, H * 4 / 3)
  local bm = (W - bw) / 2
  rectSetWindow(UI.ovRect, bm + bw * 0.06, Y0 - LINE * 1.1, bm + bw * 0.94, Y0 + LINE * (lines - 0.55))
  rectDraw(UI.ovRect)
end
local function overlay()
  local p, s = curPair(), curStep()
  if p == nil or s == nil then return end
  -- Hidden (H): nothing on the fight but a note while one is up (the hint
  -- that H brings it back, a key that cannot act).
  if HIDE then
    if MSG.t > 0 then draw('h', fit(MSG.text), Y0, true) end
    return
  end
  local multi = NSLOT > 1
  local ind1, ind2 = splitInd(s.ind or '')
  local two = ind2 and 1 or 0
  overlayBacking(PK.open and (4 + two + (ind2 and 0 or 1)) or (7 + two))
  -- With several pairs the title is the active pair's, in its marker's color.
  draw('a', fit((multi and ('[' .. G.k .. '] ') or 'H GALLERY  ') .. G.pi .. '/' .. #DATA.pairs .. '   ' .. p.giver.display .. ' x ' .. p.receiver.display),
    Y0, false, multi and COL.COLORS[G.k] or nil)
  -- The group on a line of its own (the data's labels do not repeat it), and
  -- which of the pair's positions this is.
  local label = s.label
  if s.group ~= '' and label:sub(1, #s.group + 2) == s.group .. ': ' then label = label:sub(#s.group + 3) end
  -- (A prototype mode's step says so: its mode's id.)
  if s.ext then label = '[' .. s.ext .. '] ' .. label end
  draw('b', fit((s.group ~= '' and (s.group .. '   ') or '') .. 'pos ' .. s.nv.p .. '/' .. #p.nav), Y0 + LINE, true)
  draw('c', fitKeep('scene ' .. G.si .. '/' .. #p.steps .. ': ' .. label, s.verdict ~= '' and ('  [' .. s.verdict .. ']') or ''), Y0 + LINE * 2)
  -- What this position has, with its keys ("ver 1/2 Up/Dn  speed 2/5 Del/End
  -- Space climax"). The font has no arrow glyphs; a line is at most 51
  -- characters (the 4:3 band at 6 px a character).
  draw('d', fit(ind1), Y0 + LINE * 3, false, COL.NAVC)
  if ind2 then draw('d2', fit(ind2), Y0 + LINE * 4, false, COL.NAVC) end
  -- Under the picker's panel while it is open.
  if PK.open and ind2 then return end
  draw('e', fit(status()), Y0 + LINE * (4 + two))
  if not PK.open then
    draw('f', fit('Left/Right pos  PgUp/PgDn pair  Tab menu  Esc leave'), Y0 + LINE * (5 + two), true)
    draw('g', fit(multi and ('1-' .. NSLOT .. ' active pair  +/- zoom  Insert hides this') or 'Insert hides the overlay'), Y0 + LINE * (6 + two), true)
  end
end

-- ---- several pairs: a colored, numbered marker under each -------------------
-- Drawn in the fight's own pixels (a rect's localcoord set to the fight's
-- size every frame: the fight's width follows the stage). Where a character
-- stands: the renderer draws a sprite at zoom * (x - camera) across and
-- GroundLevel - cameraY + zoom * y down, and screenPosX/Y leave the zoom
-- out, so x = screenPosX * zoom and the ground line is
-- (screenPosY - y + cameraY) * zoom - cameraY, y in world units.
UI.mrects, UI.mtexts = {}, {}
local function mbox(key, gw, gh, x1, y1, x2, y2, c, a1, a2)
  local r = UI.mrects[key]
  if r == nil then r = rectNew(); UI.mrects[key] = r end
  rectSetLocalcoord(r, gw, gh)
  rectSetColor(r, c[1], c[2], c[3])
  rectSetAlpha(r, a1, a2)
  rectSetWindow(r, x1, y1, x2, y2)
  rectDraw(r)
end
local function standsAt(pn)
  return onP(pn, function()
    local ls = screenWidth() / localCoordX()
    local z, cy = cameraZoom(), cameraPosY()
${v2 ? `    -- (screenPosX/Y and posY are in the character's own units: ls of the
    -- fight's pixels each - 1 on a 320-wide fight, 4/3 for a 320 character
    -- on a 16:9 stage's 427.)
    return { screenPosX() * ls * z, (screenPosY() - posY()) * ls * z + cy * z - cy }
` : `    return { screenPosX() * z, (screenPosY() - posY() * ls + cy) * z - cy }
`}  end)
end
local function markers()
  if NSLOT < 2 or HIDE${v2 ? ' or PK.open' : ''} then return end
  local gw, gh = screenWidth(), screenHeight()
  local blink = (math.floor(LOOPF / 15) % 2) == 0
  for k = 1, NSLOT do
    local gv, rv = standsAt(2 * k - 1), standsAt(2 * k)
    if gv and rv then
      local gx, rx = gv[1], rv[1]
      local cx = (gx + rx) / 2
      local act = (k == SEL)
      local c = COL.COLORS[k]
      -- A line on the ground under the pair, as wide as the pair.
      local w = math.max(30, math.abs(rx - gx) + 24)
      local ly = math.min(gv[2] + 1, gh - 14)
${v2 ? `      -- (The on-screen controls' columns, while shown: a pair in view keeps its
      -- marker between them, beside the pair, never under a button.)
      local lx1, lx2 = cx - w / 2, cx + w / 2
      if UI.hud and UI.hud.cols and not UI.hud.bars and cx > 0 and cx < gw then
        local lo, hi = UI.hud.cw + 5, gw - UI.hud.cw - 5
        cx = math.max(lo + 9, math.min(hi - 9, cx))
        lx1, lx2 = math.max(cx - w / 2, lo), math.min(cx + w / 2, hi)
      end
      -- (With the bars nothing clips to the picture (the engine's
      -- uiWindowSpace): a pair zoomed past its edge has no marker, one partly
      -- out has its line cut at the edge.)
      local off = UI.hud and UI.hud.bars and (cx < 0 or cx > gw)
      if UI.hud and UI.hud.bars then lx1, lx2 = math.max(lx1, 0), math.min(lx2, gw) end
      if off then UI.hud.mb[k] = nil else
      mbox('l' .. k, gw, gh, lx1, ly, lx2, ly + (act and 3 or 2), c, act and 255 or 170, act and 0 or 85)
` : `      mbox('l' .. k, gw, gh, cx - w / 2, ly, cx + w / 2, ly + (act and 3 or 2), c, act and 255 or 170, act and 0 or 85)
`}      -- A numbered tab in the middle of it: the active one bigger, outlined,
      -- blinking.
      local tw, th = act and 15 or 11, act and 13 or 10${v2 ? `
      if UI.hud then UI.hud.mb[k] = { math.min(lx1, cx - tw / 2 - 1), ly - 1, math.max(lx2, cx + tw / 2 + 1), math.min(ly + 2, gh - th - 1) + th + 1 } end` : ''}
      local ty = math.min(ly + 2, gh - th - 1)
      if act then mbox('o' .. k, gw, gh, cx - tw / 2 - 1, ty - 1, cx + tw / 2 + 1, ty + th + 1, COL.WHITE, 255, 0) end
      local full = not act or blink
      mbox('t' .. k, gw, gh, cx - tw / 2, ty, cx + tw / 2, ty + th, c, full and 255 or 150, full and 0 or 105)
      local t = UI.mtexts[k]
      if t == nil then
        if UI.font == nil then UI.font = fontNew('f-6x9.def', -1) end
        t = textImgNew(); textImgSetFont(t, UI.font); textImgSetAlign(t, 0); textImgSetText(t, tostring(k))
        textImgSetColor(t, 0, 0, 0)
        UI.mtexts[k] = t
      end
      textImgSetLocalcoord(t, math.floor(gw + 0.5), math.floor(gh + 0.5))
      local sc = act and 1.3 or 1
      textImgSetScale(t, sc, sc)
      textImgSetWindow(t, 0, 0, math.floor(gw + 0.5), math.floor(gh + 0.5))
      textImgSetPos(t, cx + 0.5, ty + (act and 11 or 9))
      textImgDraw(t)
${v2 ? '      end\n' : ''}    end
  end
end

-- What every pair on screen is doing (the log's view, for tests).
local function snapshot()
  local parts = {}
  for k = 1, NSLOT do
    local g = SLOTS[k]
    local own = recvOn(k, function() return inCustomState() and getStateOwnerPlayerNo() or 0 end) or -1
    parts[#parts + 1] = '[' .. k .. '] pair ' .. g.pi .. ' scene ' .. g.si .. ' ' .. (g.viewWait and 'viewwait' or g.phase)
      .. ' recv=' .. (recvOn(k, function() return stateNo() end) or -1) .. ' own=' .. own
  end
  return table.concat(parts, ' | ')
end
-- Several pairs: a receiver in a state of another pair's giver, or a giver
-- holding more than one target, is logged the frame it happens.
local WATCH = { own = {}, nt = {} }
local function watch()
  if not LOG or NSLOT < 2 then return end
  for k = 1, NSLOT do
    -- (A pair whose receiver is a helper: hers, and her root's as well.)
    local own = recvOn(k, function() return inCustomState() and getStateOwnerPlayerNo() or 0 end) or 0
    if rhelperOf(DATA.pairs[SLOTS[k].pi]) then
      local ro = onP(2 * k, function() return inCustomState() and getStateOwnerPlayerNo() or 0 end) or 0
      if ro ~= 0 then own = ro end
    end
    if own ~= WATCH.own[k] then
      if own ~= 0 and own ~= 2 * k - 1 then print('[hgallery] WRONG owner: P' .. (2 * k) .. ' in a state of P' .. own .. ' f=' .. MATCH.f) end
      WATCH.own[k] = own
    end
    local nt = onP(2 * k - 1, function() return numTarget() end) or 0
    if nt ~= WATCH.nt[k] then
      if nt > 1 then print('[hgallery] MULTI target: P' .. (2 * k - 1) .. ' has ' .. nt .. ' targets f=' .. MATCH.f) end
      WATCH.nt[k] = nt
    end
  end
end

-- ---- the pair picker (Tab) ----------------------------------------------------
-- Tab opens it over the running match and freezes the fight with the Pause
-- key's own switch (togglePause): the fighters, the stage and the drivers'
-- clocks stop; this loop and the Lua draw queue go on. Columns, left to
-- right: the pairs on screen (with two or more), giver, receiver (with her
-- scene count), scene. Read with the engine's UI input (${v2 ? 'getAction: the\n-- players\' own directions and buttons, keyboard or pad' : 'getInput: the\n-- players\' own menu keys, keyboard or pad'}), never with the fighters'
-- commands: while paused the fighters read no input at all. Esc still leaves
-- the gallery (the engine ends the match before a script could stop it).
-- Drawn inside the central 4:3 band, which the paused screen always shows.
local BW = math.min(W, H * 4 / 3)
local BM = (W - BW) / 2
COL.BLACK, COL.DIM, COL.LIGHT, COL.GOLD, COL.GREEN, COL.TITLE = { 0, 0, 0 }, { 150, 150, 150 }, { 235, 235, 235 }, { 255, 230, 120 }, { 140, 220, 140 }, { 255, 220, 90 }
COL.SELF, COL.SELU = { 40, 80, 170 }, { 60, 60, 60 }
UI.pickerSprites, UI.pickerRects = {}, {}
local function pkText(key, str, x, y, c, align)
  local s = UI.pickerSprites[key]
  if s == nil then
    if UI.font == nil then UI.font = fontNew('f-6x9.def', -1) end
    local t = textImgNew()
    textImgSetFont(t, UI.font)
    textImgSetAlign(t, align or 1)
    textImgSetLocalcoord(t, W, H)
    textImgSetScale(t, SC, SC)
    textImgSetWindow(t, 0, 0, W, H)
    s = { ti = t, last = nil, col = nil }
    UI.pickerSprites[key] = s
  end
  if s.last ~= str then textImgSetText(s.ti, str); s.last = str end
  local ck = c[1] * 65536 + c[2] * 256 + c[3]
  if s.col ~= ck then textImgSetColor(s.ti, c[1], c[2], c[3]); s.col = ck end
  textImgSetPos(s.ti, x, y)
  textImgDraw(s.ti)
end
local function pkRect(key, x1, y1, x2, y2, c, src, dst)
  local rc = UI.pickerRects[key]
  if rc == nil then
    rc = { r = rectNew(), win = nil, col = nil }
    rectSetLocalcoord(rc.r, W, H)
    rectSetAlpha(rc.r, src, dst)
    UI.pickerRects[key] = rc
  end
  local ck = c[1] * 65536 + c[2] * 256 + c[3]
  if rc.col ~= ck then rectSetColor(rc.r, c[1], c[2], c[3]); rc.col = ck end
  local w = x1 .. ',' .. y1 .. ',' .. x2 .. ',' .. y2
  if rc.win ~= w then rectSetWindow(rc.r, x1, y1, x2, y2); rc.win = w end
  rectDraw(rc.r)
end
local function pkFit(str, n)
  if #str <= n then return str end
  return str:sub(1, n - 2) .. '..'
end

-- The givers, each with his pairs, in the data's order. A giver's companion
-- (a helper of his with steps of its own: Brian's Striker Bao) is an entry of
-- its own right after him, "Bao (Brian)": the pairs where it has steps,
-- and only its steps (rows: the pair's step numbers). Its pairs are his -
-- picking one loads him, at that step.
local function pickerGivers()
  if PK.list then return PK.list end
  local list, by = {}, {}
  for i, p in ipairs(DATA.pairs) do
    local key = p.giver.select:lower()
    local g = by[key]
    if g == nil then
      g = { name = p.giver.display, select = p.giver.select, pairs = {} }
      by[key] = g
      table.insert(list, g)
    end
    table.insert(g.pairs, i)
  end
  local out = {}
  for _, g in ipairs(list) do
    out[#out + 1] = g
    local comps, order = {}, {}
    for _, pi in ipairs(g.pairs) do
      for si, s in ipairs(DATA.pairs[pi].steps) do
        local c = s.companion
        if c then
          local e = comps[c.id]
          if e == nil then
            -- (His first name when it is a word: "Bao (Brian)" fits the column
            -- with its count; the entry sits right under his full name.)
            local first = g.name:match('^(%a%a%a+)[%s%p]') or g.name
            e = { name = c.who .. ' (' .. first .. ')', select = g.select, pairs = {}, comp = c.id, rows = {} }
            comps[c.id] = e
            order[#order + 1] = e
          end
          if e.rows[pi] == nil then e.rows[pi] = {}; table.insert(e.pairs, pi) end
          table.insert(e.rows[pi], si)
        end
      end
    end
    for _, e in ipairs(order) do out[#out + 1] = e end
  end
  PK.list = out
  return out
end
-- An entry's scene rows of a pair: its POSITIONS (a companion's entry, the
-- positions of its steps), each loaded at its base step (the pair's nav):
-- its versions, speeds and climax are the keys' once it shows.
local function pkRows(g, pi)
  g.rowsOf = g.rowsOf or {}
  local rows = g.rowsOf[pi]
  if rows then return rows end
  rows = {}
  local seen = {}
  for _, s in ipairs(DATA.pairs[pi].steps) do
    if (not g.comp or (s.companion and s.companion.id == g.comp)) and not seen[s.nv.p] then seen[s.nv.p] = true; rows[#rows + 1] = s.nv.p end
  end
  table.sort(rows)
  g.rowsOf[pi] = rows
  return rows
end
local function pkRowCount(g, pi) return #pkRows(g, pi) end
local function pkStepOf(g, pi, r) local rows = pkRows(g, pi); return DATA.pairs[pi].nav[rows[r] or rows[1]].b end
local function pkRowOf(g, pi, si)
  local st = DATA.pairs[pi].steps[si]
  for r, x in ipairs(pkRows(g, pi)) do if st and x == st.nv.p then return r end end
  return 1
end
-- Which entry a pair's step belongs to: its companion's, else the giver's.
local function pkEntryFor(pi, si)
  local s = DATA.pairs[pi] and DATA.pairs[pi].steps[si]
  local sel = DATA.pairs[pi] and DATA.pairs[pi].giver.select
  for gi, g in ipairs(pickerGivers()) do
    if g.select == sel and ((s and s.companion and g.comp == s.companion.id) or (not (s and s.companion) and not g.comp)) then return gi end
  end
  return nil
end
-- Where a pair is on screen, if it is.
local function slotOf(pi)
  for k = 1, NSLOT do if SLOTS[k].pi == pi then return k end end
  return nil
end
local function pkPairIndex()
  local g = pickerGivers()[PK.gi]
  return g and g.pairs[PK.ri]
end
local function pkSceneOf(pi)
  local k = slotOf(pi)
  if k then return SLOTS[k].si end
  return LAST[pi] or 1
end
-- The cursor's scene row for a pair (a companion entry: its row of the scene
-- the pair is at, else its first), and the pair's step a row is.
local function pkRowFor(pi) local g = pickerGivers()[PK.gi]; return g and pkRowOf(g, pi, pkSceneOf(pi)) or 1 end
local function pkStep(pi, r) local g = pickerGivers()[PK.gi]; return g and pkStepOf(g, pi, r) or r end
local function pkLog(what)
  if not LOG then return end
  local g = pickerGivers()[PK.gi]
  local pi = pkPairIndex()
  print('[hgallery] picker ' .. what .. ' col=' .. PK.col .. ' slot=' .. SEL .. ' giver=' .. PK.gi .. ' recv=' .. PK.ri .. ' scene=' .. PK.sc .. ' pair=' .. tostring(pi)
    .. ' step=' .. tostring((g and pi) and pkStepOf(g, pi, PK.sc) or nil) .. ' entry=' .. (g and g.name or '?') .. ' rows=' .. tostring((g and pi) and pkRowCount(g, pi) or nil)${v2 ? `
    .. ' zone=' .. tostring(PK.zone) .. ' all=' .. (PK.all and PK.ag or 0) .. ' top=' .. tostring(PK.gtop) .. ' armed=' .. tostring(PK.armed or 0)` : ''})
end
local function pkSay(text)
  PK.msg, PK.msgT = text, 150
  if LOG then print('[hgallery] picker says: ' .. text) end
end
-- The cursor on the active pair: its giver (his companion's entry for a step
-- of its own), it, the scene it is at.
local function pkFollow()
  local want = pkEntryFor(G.pi, G.si)
  for gi, g in ipairs(pickerGivers()) do
    if want == nil or gi == want then
      for ri, pi in ipairs(g.pairs) do
        if pi == G.pi then PK.gi, PK.ri = gi, ri end
      end
    end
  end
  local g = pickerGivers()[PK.gi]
  PK.sc = g and pkRowOf(g, G.pi, G.si) or G.si
${v2 ? '  PK.all = false\n' : ''}end
local function pickerClose()
  PK.open = false${v2 ? '\n  PK.maps = false' : ''}
  -- Not unpaused yet: the key that chose (Enter, a button) is still down, and
  -- the first free frame would give it to the fighters as a press - Enter is
  -- P1's Start, DongHwan's effects toggle. The loop lets go once the keys are up.
  if not PK.keepPaused then PK.release = true end
  pkLog('close')
end
${v2 ? `-- (Action tokens: BTN:<name> is the engine button a player's Controller
-- Setup gives that name, DP_* and LS_* the directions. The mouse buttons
-- too: the tap that closed the picker reaches neither the HUD nor a drag.)
local RELEASE_KEYS = { 'BTN:start', 'BTN:a', 'BTN:b', 'BTN:c', 'BTN:x', 'BTN:y', 'BTN:z', 'DP_U', 'DP_D', 'DP_L', 'DP_R', 'LS_Y-', 'LS_Y+', 'LS_X-', 'LS_X+', 'MOUSE:LEFT', 'MOUSE:RIGHT' }
local function pickerRelease()
  if PK.release and not PK.open and getActionTime(-1, RELEASE_KEYS) == 0 then` : `local RELEASE_KEYS = { 's', 'a', 'b', 'c', 'x', 'y', 'z', 'U', 'D', 'L', 'R' }
local function pickerRelease()
  if PK.release and not PK.open and getInputTime(-1, RELEASE_KEYS) == 0 then`}
    PK.release = false
    togglePause(false)
  end
end

-- How long the step was on screen once it first showed, and how much of that
-- in its own states: the log line tests read.
local function leaving()
  log('leave frames=' .. G.dwellF .. ' in=' .. G.dwellIn)
  G.shown, G.dwellF, G.dwellIn = false, 0, 0
end
-- A change of the pairs on screen reloads the match: the engine adds or
-- removes a character only when a match starts. Pairs that stay keep their
-- characters loaded, and each shows its scene again from a fresh grab (a
-- running scene cannot outlive its match).
local function reload(cmd)
  -- The first request wins until the match ends: an arrow pressed right
  -- after Insert must not replace the add on its way.
  if CMD ~= nil then return end
  if PK.open then pickerClose() end
  useSlot(SEL)
  leaving()
  CMD = cmd
  endMatch()
end

-- ---- whose keys drive whom --------------------------------------------------
-- P2 is off: the arrow keys are the gallery's, and no receiver takes a
-- player's input - the hook asserts NoInput on each (the driver's map
-- _gal_recv), and her controls lead to a config nothing is bound to.
-- Controller 1 (P1's keys and first pad) drives the ACTIVE pair's giver, as
-- the Scene Viewer hands it over: remapInput(n, m) has player n read config
-- m's keys and pad. Every other giver reads nothing. The driver's
-- AssertCommand works on every giver whatever he reads. Applied every tick,
-- so 1-4, a reload and a delete all follow at once (and nothing else can
-- undo it mid-match); the AI is set off once per match and switch. While the picker
-- is open (or waits for keys to go up) every control is its own again: the
-- picker reads the players' menu keys, P1's Enter and P2's arrows, and the
-- fight is paused. Leaving (Esc, an error) puts them all back.
local CTL = ''
-- A config past Config.Players (at most MaxSimul * 2 = 8) has no keys and no
-- pad; remapInput takes up to MaxPlayerNo (12 in 1.0.0). None: the Scene
-- Viewer's swap, and only the hook keeps the receivers still.
local DEAD = nil
for d = 12, 9, -1 do if DEAD == nil and pcall(getRemapInput, d) then DEAD = d end end
local function wiredTo(pn)
  local act = 2 * SEL - 1
  if pn == act then return 1 end
  if pn > 2 * NSLOT then return pn end
  if DEAD then return DEAD end
  if pn == 1 then return act end
  return pn
end
local function controls()
  if PK.open or PK.release then
    if CTL ~= 'menu' then resetRemapInput(); CTL = 'menu' end
    return
  end
  for pn = 1, 2 * MAX_SLOTS do remapInput(pn, wiredTo(pn)) end
  local want = SEL .. '/' .. NSLOT
  if CTL ~= want then
    for pn = 1, 2 * NSLOT do onP(pn, function() setAILevel(0) end) end
    CTL = want
    if LOG then print('[hgallery] controls: P1 keys drive P' .. (2 * SEL - 1) .. ', receivers off' .. (DEAD and '' or ' (no spare config: swapped)')) end
  end
end
local function controlsBack()
  pcall(resetRemapInput)
  CTL = ''
  for k = 1, NSLOT do mset(2 * k, '_gal_recv', 0) end
end

-- The log's view of who takes input (for tests): each fighter's held raw
-- directions and buttons, printed when they change, and a receiver in her
-- own walk, jump, crouch or run state (she moved on a player's input).
local RAW = { 'U', 'D', 'L', 'R', 'a', 'b', 'c', 'x', 'y', 'z', 's', 'd', 'w' }
local MOVES = { [10] = true, [11] = true, [20] = true, [40] = true, [100] = true, [105] = true }
local HELD = {}
local function inputWatch()
  if not LOG then return end
  for pn = 1, 2 * NSLOT do
    local keys = onP(pn, function()
      local t = {}
      for _, k in ipairs(RAW) do if inputTime(k) > 0 then t[#t + 1] = k end end
      return table.concat(t)
    end) or ''
    if keys ~= (HELD[pn] or '') then
      print('[hgallery] input P' .. pn .. ' ' .. (keys ~= '' and keys or '-') .. ' f=' .. MATCH.f .. ' ai=' .. tostring(onP(pn, function() return aiLevel() end)))
      HELD[pn] = keys
    end
    if pn % 2 == 0 then
      local st = onP(pn, function() return (not inCustomState()) and stateNo() or -1 end) or -1
      if MOVES[st] and HELD['m' .. pn] ~= st then print('[hgallery] MOVED P' .. pn .. ' in her state ' .. st .. ' f=' .. MATCH.f) end
      HELD['m' .. pn] = st
    end
  end
end

-- Whether step s can be moved to in place from step prev, the same grab's
-- scene running. A companion's step plays in his stance: once his scene left
-- it (his threesome's own state) it is grabbed again. And one whose art
-- variant her state reads of his only on its first tick (Brian's var(23) in
-- her 51409-51412) is grabbed again where the variant changes and her state
-- would not (the same speed of position 4, under him to on top: her art kept
-- the old variant).
-- Never a step with no grab, nor across a prototype mode that grabs its own
-- way (MODE.apart); a mode's own step where its inPlace says so.
local function inPlaceOk(prev, s)
  if MODE.apart(prev, s) then return false end
  local M = MODE.of(s)
  if M and M.inPlace then return MODE.run(M, 'inPlace', prev, s) == true end
  if not (s and s.companion) then return true end
  if giverState() ~= s.entry then return false end
  local a, b = prev and prev.companion and prev.companion.art, s.companion.art
  if a and b and a ~= b and member(recvState(), s.states) then return false end
  return true
end

-- ---- controls (hotkeys, taken in run(): the gallery mode's only) -------------
-- A key that acts on the active pair's scene waits while the picker is open or
-- waits for keys to go up (it reads the arrows as menu keys), while the fight
-- is paused (the engine runs a hotkey paused or not), and while a reload is on
-- its way${v2 ? ', or the match is ending for EXIT (its fade)' : ''}.
local function keysFree() return ACTIVE and not PK.open and not PK.release and not paused() and CMD == nil${v2 ? ' and not UI.hud.exit' : ''} end
-- The active pair shows step si next. The same grab's scene running: the
-- step's path runs from where the scene is, with no new grab (paths are
-- absolute); a grab alone is shown in place only while its states are still
-- on screen. With art set: a move to another version of the scene, where her state
-- is one of the new step's already - her state would not start again, and
-- neither would what it picks of her art on its first tick (a companion's
-- position that reads his copy of its art variant): grabbed again. And
-- never in place where inPlaceOk says no (a companion's step once his scene
-- left his stance; an art-only change of a companion's variant).
local function gotoStep(si, art)
  useSlot(SEL)
  local p = curPair()
  if p == nil or p.steps[si] == nil then return end
  leaving()
  local prev = curStep()
  G.si = si
  local s = curStep()
  G.tries, G.note, G.restarts = 0, '', 0
  G.slot, G.sustain, G.sustained, G.held, G.mash, G.herNow = 0, 0, {}, nil, 0, nil
  G.m, G.pre = nil, nil
  -- A grab already on its way takes this step's entry when it grabs - from
  -- where it was placed: a step that stands elsewhere (its own reach, place,
  -- edge or companion) is placed again, once the place has been made.
  if (G.phase == 'place' and G.t >= 2) or G.phase == 'grab' then
    if prev and prev ~= s and LEAN.stand(prev) ~= LEAN.stand(s) then log('another stand: placed again'); return begin('reset') end
  end
  if G.phase == 'reset' or G.phase == 'place' or G.phase == 'rsummon' or G.phase == 'grab' or G.phase == 'start' then return end
  if G.phase == 'enter' and G.entry == s.entry and not MODE.apart(prev, s) then log('inplace'); return end
  -- Out of a leaf (her orgasm: his way back is a key no path presses, so
  -- no command of the next step acts from there): a fresh grab at once.
  if prev and prev ~= s and prev.leaf then log('out of a leaf: grabbing again'); return begin('reset') end
  if art and inScene() and member(recvState(), s.states) then log('another version of her state: grabbing again'); return begin('reset') end
  if G.entry == s.entry and inScene() and ((s.path and #s.path > 0) or showing(s)) and inPlaceOk(prev, s) then
    G.fresh = false
    log('inplace')
    startPath()
  else
    begin('reset')
  end
end
-- The pair's steps in the data's order, one on (the picker's in-place pick;
-- under -hgallerylog the tests' [ and ] walk every step with it).
function HGalleryScene(d)
  if not ACTIVE or PK.open or CMD ~= nil then return end
  useSlot(SEL)
  local p = curPair()
  if p == nil then return end
  gotoStep(((G.si - 1 + d) % #p.steps) + 1)
end
-- The keys that move along the active step's place: each goes where the
-- data worked out (gallery.js navTables: the step's k), or says why not.
local NAV_KEYS = { LEFT = 'l', RIGHT = 'r', UP = 'u', DOWN = 'd', DELETE = 's', END = 'f', SPACE = 'c', HOME = 'h' }
local NAV_NOTE = { l = 'one position in this pair', r = 'one position in this pair', u = 'one version of this position',
  d = 'one version of this position', s = 'no other speed in this position', f = 'no other speed in this position',
  c = 'no climax in this position', h = 'no moods in this position' }
function HGalleryNav(key)
  if not keysFree() then return end
  useSlot(SEL)
  local s, a = curStep(), NAV_KEYS[key]
  if s == nil or a == nil then return end
  local t = s.k[a]
  -- The climax off: back to the step it was turned on from, where that is
  -- this position, version and stage (else the data's: the base).
  if a == 'c' and s.nv.c and G.back then
    local b = curPair().steps[G.back]
    if b and b.nv.p == s.nv.p and b.nv.v == s.nv.v and b.nv.g == s.nv.g and not b.nv.c then t = G.back end
  end
  if t == nil or t <= 0 then
    local note = NAV_NOTE[a]
    local w = s.nv.f and 'finish' or 'picture'
    if t == -1 and a == 'c' then note = 'only the climax in this position'
    elseif t == -1 and s.nv.c then note = (a == 's') and ('the first ' .. w .. ' already') or ('the last ' .. w .. ' already')
    elseif t == -1 then note = (a == 's') and 'the slowest already' or 'the fastest already'
    elseif s.nv.c and (a == 's' or a == 'f') and (s.k.c or 0) > 0 then note = 'Space leaves the climax' end
    if LOG then print('[hgallery] key ' .. key .. ': ' .. note) end
    return tell(note, 90)
  end
  if LOG then print('[hgallery] key ' .. key .. ' -> scene ' .. t) end
  if a == 'c' and not s.nv.c then G.back = G.si end
  gotoStep(t, a == 'u' or a == 'd')
end
-- Page Down / Page Up: the next or previous pair in the active pair's place
-- (with several on screen, one that is not on screen already).
function HGalleryPair(d)
  if not keysFree() then return end
  useSlot(SEL)
  local pi = G.pi
  repeat pi = ((pi - 1 + d) % #DATA.pairs) + 1 until pi == G.pi or NSLOT == 1 or not slotOf(pi)
  if pi == G.pi and NSLOT > 1 then return tell('every pair is on screen') end
  LAST[G.pi] = G.si
  reload({ what = 'pair', k = SEL, pi = pi, si = 1 })
end
-- 1-4: which pair on screen the keys act on.
function HGallerySlot(k)
  if not ACTIVE or k > NSLOT then return end
  SEL = k
  useSlot(k)
  if PK.open then pkFollow() end
  -- P1's keys go to this pair's giver from this frame on.
  controls()
  if LOG then print('[hgallery] slot ' .. k .. ' active: ' .. snapshot()) end
end
-- Delete: in the picker, the active pair leaves the screen (the last one
-- stays); outside it, one speed slower.
function HGalleryDelete()
  if not ACTIVE then return end
  if not PK.open then return HGalleryNav('DELETE') end
  if CMD ~= nil${v2 ? ' or PK.maps' : ''} then return end
  if NSLOT <= 1 then return pkSay('the last pair stays: Enter changes it') end
  if LOG then print('[hgallery] delete pair ' .. SEL .. ' of ' .. NSLOT) end
  reload({ what = 'del', k = SEL })
end
-- Insert (and H): the overlay, its box and the markers hidden or shown again.
-- The picker draws itself either way (in it, Insert adds a pair).
function HGalleryOverlay(${v2 ? 'btn' : ''})
  if not ACTIVE then return end
${v2 ? `  -- (In the picker H is a letter: the next name with it.)
  if PK.open then return end
  HIDE = not HIDE
  -- (Hidden by its button, the SHOW tab it leaves is the way back: no note.
  -- By Insert or H, the key.)
  if HIDE then if not btn then tell('Insert shows the controls', 120) end else MSG.t = 0 end` : `  HIDE = not HIDE
  if HIDE then tell('Insert shows the overlay', 120) else MSG.t = 0 end`}
  HINT = false
  if LOG then print('[hgallery] overlay ' .. (HIDE and 'hidden' or 'shown')) end
end

-- Enter on a pair: in the active pair's place, at its remembered scene or the
-- scene picked. A pair on screen becomes the active one instead, and a scene
-- of it is shown in place (no reload).
local function pickerChoose(pi, si)
  if pi == nil then return end
  local k = slotOf(pi)
  if k then
    pickerClose()
    SEL = k
    useSlot(k)
    if LOG then print('[hgallery] picker picks pair ' .. pi .. ' on screen at ' .. k) end
    if si and si ~= G.si then gotoStep(si) end
    return
  end
  local want = si or pkSceneOf(pi)
  if LOG then print('[hgallery] picker load pair ' .. pi .. ' at scene ' .. want .. ' in place of ' .. SEL) end
  LAST[G.pi] = G.si
  reload({ what = 'pair', k = SEL, pi = pi, si = want })
end
-- Insert: the highlighted pair joins the ones on screen, to their right.
local function pickerAdd(pi, si)
  if pi == nil then return end
  local k = slotOf(pi)
  if k then return pkSay('that pair is on screen already (' .. k .. ')') end
  if NSLOT >= MAX_SLOTS then return pkSay('no room: ' .. MAX_SLOTS .. ' pairs is the most') end
  local want = si or pkSceneOf(pi)
  if LOG then print('[hgallery] picker add pair ' .. pi .. ' at scene ' .. want .. ' beside ' .. NSLOT) end
  reload({ what = 'add', pi = pi, si = want })
end
-- The scene a pick loads the pair at: the picked row's step; from the
-- receiver column, a companion entry's first step unless the pair is at one
-- of its steps already (the giver's own entry: the pair's remembered scene).
local function pkPickStep(pi)
  if PK.col == 3 then return pkStep(pi, PK.sc) end
  local g = pickerGivers()[PK.gi]
  if g and g.comp then return pkStep(pi, pkRowFor(pi)) end
  return nil
end
function HGalleryInsert()
  if not ACTIVE then return end
  if not PK.open then return HGalleryOverlay() end
${v2 ? `  -- (The cursor pair, at the cursor's position: no arming needed.)
  UI.pkInsert()
` : `  if PK.col < 2 then return pkSay('pick a receiver first (Right)') end
  local pi = pkPairIndex()
  pickerAdd(pi, pi and pkPickStep(pi))
`}end
function HGalleryPicker()
  if not ACTIVE${v2 ? ' or UI.hud.exit' : ''} then return end
  if PK.open then return pickerClose() end
${v2 ? "  if LOG and type(os) == 'table' and type(os.clock) == 'function' then UI.pk.t0 = os.clock() end\n" : ''}  useSlot(SEL)
  pkFollow()
  -- The cursor starts on the active pair, in the receiver column.
  PK.col, PK.t, PK.top, PK.msgT = 2, 0, {}, 0
${v2 ? '  UI.pkOpen()\n' : ''}  -- Already paused with the Pause key: it stays paused when the picker closes.
  -- (Paused only because the picker is waiting for keys to go up: not that.)
  PK.keepPaused = paused() and not PK.release
  PK.release = false
  PK.open = true
  togglePause(true)
  resetKey()
  -- The players' own controls while it is open (P1's Enter, P2's arrows).
  controls()
  pkLog('open')
end

${v2 ? `-- The menu tokens of the engine before modern-input, as actions.
local HIT = { U = { 'DP_U', 'LS_Y-' }, D = { 'DP_D', 'LS_Y+' }, L = { 'DP_L', 'LS_X-' }, R = { 'DP_R', 'LS_X+' },
  a = { 'BTN:a' }, b = { 'BTN:b' }, c = { 'BTN:c' }, s = { 'BTN:start' } }
local function hit(tok) return getAction(-1, HIT[tok]) == true end
` : `local function hit(tok) return getInput(-1, { tok }) == true end
`}${v2 ? '' : `local function pickerInput()
  local list = pickerGivers()
  local g = list[PK.gi]
  -- Keys that are no menu token: the last one pressed, counted once.
  local k = getKey()
  if k ~= '' then resetKey() end
  local first = (NSLOT > 1) and 0 or 1
  if PK.col < first then PK.col = first end
  local n
  if PK.col == 0 then n = NSLOT elseif PK.col == 1 then n = #list elseif PK.col == 2 then n = #g.pairs else n = pkRowCount(g, g.pairs[PK.ri]) end
  local move = 0
  if hit('U') then move = -1 elseif hit('D') then move = 1 elseif k == 'PAGEUP' then move = -10 elseif k == 'PAGEDOWN' then move = 10 end
  if move ~= 0 then
    -- One step wraps; a page stops at the ends.
    local function step(cur)
      if math.abs(move) == 1 then return ((cur - 1 + move) % n) + 1 end
      return math.max(1, math.min(n, cur + move))
    end
    if PK.col == 0 then
      -- The pairs on screen: the active one moves.
      SEL = step(SEL)
      useSlot(SEL)
      pkFollow()
    elseif PK.col == 1 then
      -- Another giver: keep the same receiver where he has her.
      local was = DATA.pairs[g.pairs[PK.ri]].receiver.select:lower()
      PK.gi = step(PK.gi)
      PK.ri = 1
      for ri, pi in ipairs(list[PK.gi].pairs) do
        if DATA.pairs[pi].receiver.select:lower() == was then PK.ri = ri end
      end
      PK.sc = pkRowFor(pkPairIndex())
    elseif PK.col == 2 then
      PK.ri = step(PK.ri)
      PK.sc = pkRowFor(pkPairIndex())
    else
      PK.sc = step(PK.sc)
    end
    pkLog('move ' .. move)
    return
  end
  local back = hit('b')
  if hit('L') or back or k == 'BACKSPACE' then
    if PK.col > first then PK.col = PK.col - 1; pkLog('left') elseif k == 'BACKSPACE' or back then pickerClose() end
    return
  end
  if hit('R') then
    if PK.col < 3 then PK.col = PK.col + 1; pkLog('right') end
    return
  end
  if hit('s') or hit('a') then
    if PK.col <= 1 then PK.col = PK.col + 1; pkLog('right'); return end
    local pi = pkPairIndex()
    return pickerChoose(pi, pi and pkPickStep(pi))
  end
end

-- A character's select portrait, from the motif's preloaded select data
-- (animGetPreloadedCharData: what the select screen draws), sized the way the
-- select screen sizes it; false when the motif preloaded none for him.
UI.pkPortraits = {}
local function pkPortrait(select)
  local key = select:lower()
  local v = UI.pkPortraits[key]
  if v ~= nil then return v end
  v = false
  pcall(function()
    local ps = motif.select_info and motif.select_info.portrait
    local spr = (ps and ps.spr) or { 9000, 0 }
    local ref = start.f_getCharRef(select)
    local ch = start.f_getCharData(ref) or {}
    local a = animGetPreloadedCharData(ref, spr[1], spr[2], false)
    if a then animUpdate(a) end
    local info = a and (animGetSpriteInfo(a, spr[1], spr[2]) or animGetSpriteInfo(a))
    if a and info then
      local sc = ((ps and ps.scale and ps.scale[1]) or 1) * (ch.portraitscale or 1) * W / (ch.localcoord or 320)
      animSetLocalcoord(a, W, H)
      animSetScale(a, sc, sc)
      animUpdate(a)
      v = { a = a, sc = sc, w = info.Size[1] * sc, h = info.Size[2] * sc }
    end
  end)
  UI.pkPortraits[key] = v
  return v
end
-- Drawn into a box of height bh with its top-left at x, y (scaled to fit);
-- the width it took.
local function pkDrawPortrait(select, x, y, bh)
  local p = pkPortrait(select)
  if not p then return 0 end
  local f = bh / math.max(1, p.h)
  animSetScale(p.a, p.sc * f, p.sc * f)
  animSetPos(p.a, x, y)
  animUpdate(p.a)
  animDraw(p.a)
  return p.w * f
end

local function pickerDraw()
  local list = pickerGivers()
  local g = list[PK.gi]
  local pi = pkPairIndex()
  local x1, x2 = BM + BW * 0.03, BM + BW * 0.97
  local y1, y2 = Y0 + LINE * 4.6, H - LINE * 0.8
  pkRect('panel', x1, y1, x2, y2, COL.BLACK, 200, 56)
  local CW = 6 * SC
  local pad = CW
  local titleY = y1 + LINE * 1.2
  pkText('title', 'PICK A PAIR', x1 + pad, titleY, COL.TITLE)
  local count = #DATA.pairs .. ' pairs, ' .. NSLOT .. ' on screen'
  pkText('count', count, x1 + pad, titleY + LINE * 1.1, COL.GRAY)
  if NSLOT > 1 then
    -- The pair the keys act on, in its marker's color.
    local ax = x1 + pad + (#count + 3) * CW
    local by = titleY + LINE * 1.1
    pkRect('actsw', ax, by - LINE * 0.8, ax + CW * 1.3, by - LINE * 0.1, COL.COLORS[SEL], 255, 0)
    pkText('actt', 'active: ' .. SEL, ax + CW * 2, by, COL.COLORS[SEL])
  end
  -- The highlighted pair's select portraits, top right: giver, then receiver.
  if pi then
    local pr = DATA.pairs[pi]
    local bh = LINE * 2.3
    local rp, gp = pkPortrait(pr.receiver.select), pkPortrait(pr.giver.select)
    local rx = x2 - pad
    if rp then
      rx = rx - rp.w * bh / math.max(1, rp.h)
      pkDrawPortrait(pr.receiver.select, rx, y1 + LINE * 0.35, bh)
      rx = rx - pad
    end
    if gp then pkDrawPortrait(pr.giver.select, rx - gp.w * bh / math.max(1, gp.h), y1 + LINE * 0.35, bh) end
  end
  local rowsTop = y1 + LINE * 3.7
  local helpY = y2 - LINE * 0.5
  local rows = math.max(3, math.floor((helpY - LINE * 2.2 - rowsTop) / LINE))
  -- Two columns on screen: the pairs on screen + giver, giver + receiver, or
  -- receiver + scene.
  local left = (PK.col == 0) and 0 or ((PK.col == 3) and 2 or 1)
  -- The scene column gets the wider share: its labels are the long ones.
  local avail = x2 - x1 - pad * 3
  local share = (left == 2) and 0.36 or ((left == 0) and 0.5 or 0.45)
  local function column(c, cx, colW)
    local chars = math.floor(colW / CW)
    local items, cur, focus, head = {}, 1, PK.col == c, ''
    if c == 0 then
      head = 'ON SCREEN'
      for k = 1, NSLOT do
        local pr = DATA.pairs[SLOTS[k].pi]
        table.insert(items, { t = k .. ' ' .. pr.giver.display .. ' x ' .. pr.receiver.display, slot = k })
      end
      cur = SEL
    elseif c == 1 then
      head = 'GIVER'
      for gi, gg in ipairs(list) do
        -- On screen: the active pair's place first (a companion's entry
        -- where the pair is at one of its steps).
        local on = nil
        for k = 1, NSLOT do
          if pkEntryFor(SLOTS[k].pi, SLOTS[k].si) == gi and (on == nil or k == SEL) then on = k end
        end
        table.insert(items, { t = gg.name .. '  (' .. #gg.pairs .. ')', on = on })
      end
      cur = PK.gi
    elseif c == 2 then
      head = 'RECEIVER  (with ' .. g.name .. ')'
      -- A narrow column (beside the scenes): the heading alone.
      if #head > chars then head = (chars >= 24) and ('RECEIVER  (with ' .. pkFit(g.name, chars - 17) .. ')') or 'RECEIVER' end
      for _, p in ipairs(g.pairs) do
        local pr = DATA.pairs[p]
        local count = '  (' .. pkRowCount(g, p) .. ')'
        table.insert(items, { t = pkFit(pr.receiver.display, math.max(4, chars - 2 - #count)) .. count, on = slotOf(p) })
      end
      cur = PK.ri
    else
      local pr = DATA.pairs[pi]
      local on = slotOf(pi)
      head = 'POSITION  (' .. pkFit(pr.receiver.display, math.max(6, chars - 15)) .. ')'
      local lastGroup = nil
      for r = 1, pkRowCount(g, pi) do
        local si = pkStepOf(g, pi, r)
        local s = pr.steps[si]
        local label = s.label
        if s.group ~= '' and label:sub(1, #s.group + 2) == s.group .. ': ' then label = label:sub(#s.group + 3) end
        if s.ext then label = '[' .. s.ext .. '] ' .. label end
        local t = s.nv.p .. ' ' .. ((s.group ~= '' and s.group ~= lastGroup) and (s.group .. ': ') or '') .. label
        lastGroup = s.group
        -- On screen: the pair is at a step of this position.
        local at = on and pr.steps[SLOTS[on].si]
        table.insert(items, { t = t, on = (at and at.nv.p == s.nv.p) and on or nil })
      end
      cur = PK.sc
    end
    pkText('h' .. c, pkFit(head, chars), cx, rowsTop - LINE * 0.2, focus and COL.WHITE or COL.DIM)
    -- Scroll so the cursor stays in view.
    local top = PK.top[c] or 1
    if cur < top then top = cur end
    if cur > top + rows - 1 then top = cur - rows + 1 end
    PK.top[c] = top
    for r = 1, rows do
      local i = top + r - 1
      local it = items[i]
      local ry = rowsTop + LINE * r
      if it then
        local sel = i == cur
        if sel then pkRect('sel' .. c .. (focus and 'f' or 'u'), cx - CW * 0.5, ry - LINE * 0.85, cx + colW, ry + LINE * 0.15, focus and COL.SELF or COL.SELU, 220, 36) end
        local tx, txt = cx, it.t
        if it.slot then
          -- A pair on screen: its marker's color.
          pkRect('sw' .. r, cx, ry - LINE * 0.8, cx + CW * 1.3, ry - LINE * 0.1, COL.COLORS[it.slot], 255, 0)
          tx = cx + CW * 2
        else
          -- On screen: '>' with one pair, its place with several.
          txt = ((it.on and ((NSLOT > 1) and (it.on .. ' ') or '> ')) or '  ') .. txt
        end
        local col = COL.GRAY
        if sel and focus then col = COL.GOLD
        elseif sel then col = COL.LIGHT
        elseif it.slot then col = COL.COLORS[it.slot]
        elseif it.on then col = (NSLOT > 1) and COL.COLORS[it.on] or COL.GREEN end
        pkText('r' .. c .. '_' .. r, pkFit(txt, chars - (it.slot and 2 or 0)), tx, ry, col)
      end
    end
    if top > 1 then pkText('up' .. c, '...', cx + colW - CW * 3, rowsTop + LINE * 0.8, COL.GRAY) end
    if top + rows - 1 < #items then pkText('dn' .. c, '...', cx + colW - CW * 3, rowsTop + LINE * (rows + 1), COL.GRAY) end
  end
  column(left, x1 + pad, avail * share)
  column(left + 1, x1 + pad * 2 + avail * share, avail * (1 - share))
  local help
  if PK.col == 0 then help = 'Enter change it  Del remove it  Tab close'
  elseif PK.col == 1 then help = (NSLOT > 1) and 'Enter receivers  Left on screen  Tab close' or 'Enter/Right receivers  Tab close'
  elseif PK.col == 2 then help = 'Enter load  Ins add  Right positions  Tab close'
  else help = 'Enter show  Ins add  Left back  Tab close' end
  local width = math.floor((x2 - x1) / CW) - 2
  pkText('help', pkFit(help, width), (x1 + x2) / 2, helpY, COL.GRAY, 0)
  if PK.msgT > 0 then
    PK.msgT = PK.msgT - 1
    pkText('msg', pkFit(PK.msg, width), (x1 + x2) / 2, helpY - LINE * 1.2, COL.GOLD, 0)
  end
end
`}local function pickerTick()
  if not PK.open then return end
  -- The Pause key toggles it too: the picker holds the fight still.
  if not paused() then togglePause(true) end
  PK.t = PK.t + 1
${v2 ? '  UI.pkFrame()\n' : '  pickerInput()\n  if PK.open then pickerDraw() end\n'}end

-- The engine's own Space (external/script/debug.lua, a debug key): the
-- gallery takes Space while it runs and gives this back when it is left.
local SPACE_DEBUG = 'full(1); full(2); full(3); full(4); full(5); full(6); full(7); full(8); setTime(getRoundTime())'

-- ---- the match: speed-ups and the camera ----------------------------------------
-- ---- the zoom ---------------------------------------------------------------------
-- The levels for the pairs on screen: 0 (fit every pair), then each scale of
-- ZOOMS clearly past that fit (0.62 is the fit of three).
local function fitZoom() return math.min(1, 320 / ((NSLOT - 1) * SPACING + GAP + 2 * MARGIN)) end
local function zoomLevels()
  local fz = fitZoom()
  local t = { 0 }
  for _, z in ipairs(K.ZOOMS) do if z > fz * 1.1 then t[#t + 1] = z end end
  return t, fz
end
local function zoomIndex(t)
  for i, z in ipairs(t) do if z == ZL then return i end end
  return 1
end
-- The stage's art as it loaded, in 320-wide units: a camera centers anywhere
-- between its bounds and shows 160 / its zoomout on each side of that.
local function readStage()
  STAGE = {}
  pcall(function()
    -- (Its own zoom, given back after a scene in the air: camView.)
    local z0, z1 = stageVar('camera.zoomout'), stageVar('camera.zoomin')
    if type(z0) == 'number' and z0 > 0 then STAGE.zo0 = z0 end
    if type(z1) == 'number' and z1 > 0 then STAGE.zi0 = z1 end
    local lc = stageVar('stageinfo.localcoord.x')
    local bl, br, zo = stageVar('camera.boundleft'), stageVar('camera.boundright'), stageVar('camera.zoomout')
    if type(lc) ~= 'number' or lc <= 0 or type(bl) ~= 'number' or type(br) ~= 'number' then return end
    if type(zo) ~= 'number' or zo <= 0 or zo > 1 then zo = 1 end
    STAGE.l, STAGE.r = bl * 320 / lc - 160 / zo, br * 320 / lc + 160 / zo
  end)
  if LOG then print('[hgallery] stage art from ' .. tostring(STAGE.l) .. ' to ' .. tostring(STAGE.r)) end
end
-- The active pair's center: between its giver and its receiver where they
-- stand (a grab moves them from their place); its place for a step that
-- needs the screen's edge (placed from the view's edge, it would pull the
-- camera after it) and for a receiver's helper's pair (her root stands
-- behind him, away from the scene).
local function pairCenter()
  local g = SLOTS[SEL]
  local c = (SEL - (NSLOT + 1) / 2) * SPACING + ((g and g.dx) or 0)
  local p = g and DATA.pairs[g.pi]
  local s = p and p.steps[g.si]
  if s == nil or s.place or rhelperOf(p) then return c end
  local gx, rx = absX(2 * SEL - 1), absX(2 * SEL)
  if gx and rx then return (gx + rx) / 2 end
  return c
end
-- Where the camera goes, in 320-wide units from the stage's center, and its
-- scale: at level 1 the center and the fit; zoomed, the active pair's
-- center (c), as near as a camera may go at that scale.
local function camPin()
  local _, fz = zoomLevels()
  if ZL == 0 then return 0, fz, 0 end
  local c = pairCenter()
  local half, w0 = 160 / ZL, 160 / fz
  local lo = math.min(STAGE.l or -w0, -w0) + half
  local hi = math.max(STAGE.r or w0, w0) - half
  local x = c
  if lo > hi then x = (lo + hi) / 2 elseif x < lo then x = lo elseif x > hi then x = hi end
  return x, ZL, c
end
local function camKey() return (ZL == 0) and ('0|' .. NSLOT) or (ZL .. '|' .. SEL .. '|' .. NSLOT) end
-- A SCENE IN THE AIR (one pair): a step whose scene holds him high up (its
-- 'high': Murakami's winged demon, his feet at -149 and she held above him)
-- zooms the view out while it is grabbed and shown, so both are on screen -
-- the stage's camera rises only to its boundhigh (Mountainside Temple's -25:
-- headless, only his legs were on screen). Only the zoom changes (the camera
-- still follows the pair); any other step gives the stage its own zoom back,
-- as read when the match started. (Several pairs zoom to fit already.) A
-- local, never a field of CAM: CAM is made anew at every match.
local function camView()
  local s = curStep()
  local want = nil
  if s and s.high and MATCH.rs2 and roundState() == 2 and (G.phase == 'grab' or G.phase == 'enter' or G.phase == 'act' or G.phase == 'show') then
    want = math.max(K.VIEW_MIN, math.min(1, K.VIEW_UP / (K.VIEW_BODY - s.high)))
  end
  if want == CAM.vz then return end
  CAM.vz = want
  mset(1, '_gal_vzo', want or STAGE.zo0 or 1)
  mset(1, '_gal_vzi', want or STAGE.zi0 or 1)
  mset(1, '_gal_vz', 1)
  log(want and string.format('view: zoom %.3f for a scene at %.0f', want, s.high) or 'view: the stage zoom again')
end
local function camAsk()
  local x, z, c = camPin()
  CAM.key, CAM.x, CAM.z, CAM.still, CAM.free = camKey(), x, z, -2, true
  -- (In P1's own units: the hook runs it on P1.)
  local u = onP(1, function() return localCoordX() / 320 end) or 1
  mset(1, '_gal_cx', x * u)
  mset(1, '_gal_zoom', z)
  if LOG then
    local t = zoomLevels()
    print('[hgallery] zoom ' .. zoomIndex(t) .. '/' .. #t .. string.format(' scale %.3f', z) .. (ZL == 0 and ' (every pair)' or (' on pair ' .. SEL .. string.format(' at %.1f', c)))
      .. string.format(': camera to %.1f', x) .. ': ' .. snapshot())
  end
end
-- Each fighter's place from the stage's center, in 320-wide units (the log's).
local function places()
  local t = {}
  for pn = 1, 2 * NSLOT do
    local x = absX(pn)
    t[#t + 1] = 'P' .. pn .. ' ' .. (x and string.format('%.0f', x) or '?')
  end
  return table.concat(t, ' ')
end
-- Every tick: the camera asked for again when the zoom, the active pair or
-- the pairs change (and once per match, at round state 2); how long it has
-- been still; and each fighter's flag for the hook's +1 - free while zoomed,
-- and at level 1 until the camera is still again (it pans back: a pair it
-- has not reached yet would be pushed into view).
local function camTick()
  if NSLOT > 1 and MATCH.rs2 and roundState() == 2 then
    if camKey() ~= CAM.key then camAsk()
    -- Zoomed, it follows the active pair: asked again once the pair's center
    -- is FOLLOW from the camera's (a scene that carries her off; smaller
    -- moves, a thrust, never sway it). Not while the mouse drags a pair: the
    -- view would slide under the pointer; it follows once the pair is let go.
    elseif ZL ~= 0 and not paused() and UI.drag.k == nil and math.abs(camPin() - CAM.x) > K.FOLLOW then camAsk() end
    if not paused() then
      local x, z = cameraPosX(), cameraZoom()
      if CAM.px and math.abs(x - CAM.px) < 0.01 and math.abs(z - CAM.pz) < 0.0001 then CAM.still = CAM.still + 1
      else CAM.still = math.min(CAM.still, 0) end
      CAM.px, CAM.pz = x, z
      if CAM.still == 3 then
        if ZL == 0 then CAM.free = false end
        if LOG then print(string.format('[hgallery] camera still at %.1f scale %.3f (asked %.1f scale %.3f): ', x * 320 / screenWidth(), z, CAM.x, CAM.z) .. places() .. ' | ' .. snapshot()) end
      end
    end
  elseif NSLOT < 2 then
    CAM.free = false
    camView()
  end
  for pn = 1, 2 * NSLOT do
    local v = 0
    if CAM.free then v = (math.floor((pn + 1) / 2) == SEL) and 1 or 2 end
    if CAM.fv[pn] ~= v then CAM.fv[pn] = v; mset(pn, '_gal_free', v) end
  end
end
-- + / -: the zoom on the active pair, one level in or out. The camera moves
-- next tick (camTick); the level stays when 1-4 changes the active pair.${v2 ? `
-- quiet (the mouse wheel): at a limit, or with one pair, only the log says
-- so - a wheel spun on turns no note up.` : ''}
function HGalleryZoom(d, key${v2 ? ', quiet' : ''})
  if not keysFree() then return end
  local note
  if NSLOT < 2 then note = 'zoom is for several pairs'
  else
    local t = zoomLevels()
    local i = zoomIndex(t) + d
    if i < 1 then note = 'every pair in view already'
    elseif i > #t then note = 'the closest zoom already'
    else
      ZL = t[i]
      if LOG then print('[hgallery] key ' .. key .. ' -> zoom ' .. i .. '/' .. #t) end
      return tell((i == 1) and 'zoom: every pair' or ('zoom ' .. i .. '/' .. #t .. ' on pair ' .. SEL), 90)
    end
  end
  if LOG then print('[hgallery] key ' .. key .. ': ' .. note) end
${v2 ? `  if quiet then return end
` : ''}  tell(note, 90)
end

-- Settled: its scene showed once, or it gave up (a note, stuck), or it waits
-- for the view (zoomed on another pair). A scene shown with its lean not
-- learned yet settles once it is (LEAN.at ticks in): leaning, it is grabbed
-- again within the fast run.
function LEAN.due(g) return g.lean ~= nil and LEAN.by[g.pi .. ':' .. g.si] == nil and g.phase == 'show' and g.note == '' and g.t <= LEAN.at end
local function settled(g) return (g.shown and not LEAN.due(g)) or g.phase == 'stuck' or (g.phase == 'show' and g.note ~= '') or g.viewWait == true end
local function tickMatch()
  if paused() then return end
  MATCH.f = MATCH.f + 1
  -- Every prototype mode, once a tick of the match (not per pair).
  MODE.each('frame')
  -- The stage as it loaded (the hook moves its bounds from round state 2).
  if MATCH.f == 1 then readStage() end
  local rs = roundState()
  -- Pairs being restored: the round intros are cut (the hook stands everyone
  -- in their own standing state in round state 1; the drivers reset both of
  -- a pair when the fight starts anyway). Every match: what the intros left
  -- goes when the fight starts, once - an intro's helper (Sakura's Kei) ran
  -- on through the first scene of a single pair.
  if MATCH.speed and rs <= 1 then
    for pn = 1, 2 * NSLOT do mset(pn, '_gal_cut', 1) end
  end
  if rs == 2 and not MATCH.rs2 then
    MATCH.rs2 = true
    for pn = 1, 2 * NSLOT do mset(pn, '_gal_cut', 0); mset(pn, '_gal_purge', 1) end
    MATCH.purgeAt = MATCH.f
    if LOG then print('[hgallery] round state 2 at match frame ' .. MATCH.f) end
    -- Several pairs: the camera locked at the zoom kept (at first the one that
    -- fits them all) by camTick, this tick (the hook, next frame, before any
    -- pair is placed).
    CAM.key = nil
  end
  -- THE HELD INTRO: an intro still running after DATA.introMax ticks (a
  -- helper that asserts the intro flag every frame and goes only for an AI:
  -- FutaRB Taokaka's 256) is skipped as a player's button skips it (the
  -- engine's runIntroSkip): everyone to their standing state, helpers and
  -- explods gone - the same cut and purge, held until round state 2. Only
  -- before the fight first starts (after it, round state 0 is the match's end).
  -- A CUTSCENE INTRO of a giver on screen (his pair's cutscene: a helper that
  -- holds the intro and goes only by its own time, past that wait - Goblin
  -- Party's guild, a minute) is cut the same way at once, on the first frame
  -- of round state 1, where its intro flag holds the round.
  local cs = nil
  if rs == 1 and not MATCH.rs2 and not MATCH.introCut then
    for k = 1, NSLOT do local p = DATA.pairs[SLOTS[k].pi]; if p and p.cutscene then cs = p.cutscene end end
  end
  if rs <= 1 and not MATCH.rs2 and not MATCH.introCut and (cs or MATCH.f > (DATA.introMax or 600)) then
    MATCH.introCut = true
    for pn = 1, 2 * NSLOT do mset(pn, '_gal_cut', 1); mset(pn, '_gal_purge', 1) end
    if LOG then
      if cs then print('[hgallery] cutscene intro (his helper ' .. cs.helper .. ', gone only at ' .. cs.ends .. ' ticks): cut at match frame ' .. MATCH.f)
      else print('[hgallery] intro held past ' .. (DATA.introMax or 600) .. ' ticks: skipped') end
    end
  end
  -- The purge is one frame of the hook's (it runs after this, next frame).
  if MATCH.purgeAt and MATCH.f > MATCH.purgeAt then
    for pn = 1, 2 * NSLOT do mset(pn, '_gal_purge', 0) end
    MATCH.purgeAt = nil
  end
  -- Fast until every pair shows its scene again. The engine sets the speed
  -- back to normal when a match starts, so it is asked for every tick.
  -- And SILENT meanwhile: at K.ACCEL the engine runs that many ticks a frame
  -- and every PlaySnd fires per tick - a moan a scene restarts every 15
  -- ticks came 16 times a second (Murakami Ryona Mob's at Minotaur's speed
  -- 3, the owner's "like a glitch"). toggleNoSound(on) is the engine's
  -- character-sound mute; a match start clears it, so it is asked every tick
  -- too, and cleared with the speed.
  if MATCH.speed and not MATCH.restored then
    local all = true
    for k = 1, NSLOT do if not settled(SLOTS[k]) then all = false end end
    if all or MATCH.f > K.ACCEL_MAX then
      MATCH.restored = true
      setAccel(1)
      if toggleNoSound then toggleNoSound(false) end
      if LOG then print('[hgallery] restored at match frame ' .. MATCH.f .. ': ' .. snapshot()) end
    else
      setAccel(K.ACCEL)
      if toggleNoSound then toggleNoSound(true) end
    end
  end
end

-- One pair, one tick.
local function tickSlot()
  -- Outside the fight's round state 2 the driver waits (below), unless the
  -- step's prototype mode plays there (its live: a KO's aftermath).
  -- From the first frame of the match: a setup the giver's round start
  -- reads (a helper it spawns or not) is in place before it runs.
  writeSetup()
  -- She takes no player's input (the hook), from the first frame on.
  mset(RECV, '_gal_recv', 1)
  if roundState() ~= 2 then if not MODE.liveOf(curStep()) then mset(GIVER, '_gal_c', 0); mset(GIVER, '_gal_c2', 0); mset(GIVER, '_gal_clean', 0); mset(RECV, '_gal_c', 0); mset(RECV, '_gal_rp', 0); mset(GIVER, '_gal_hc', 0); mset(GIVER, '_gal_hg', 0); mset(GIVER, '_gal_appr', 0); return end end
  -- The Pause key freezes the fighters but not this loop: the driver's
  -- clocks wait too.
  if not paused() then
    -- So does another pair's Pause or SuperPause (one clock for everyone).
    if NSLOT > 1 and (onP(GIVER, function() return pauseTime() end) or 0) > 0 then return end
    onP(GIVER, function() setPower(powerMax()) end)
    if G.phase == 'start' then G.tries, G.note, G.restarts = 0, '', 0; begin('reset') end
    G.slot, G.rslot = 0, 0
    drive()
    -- The step's prototype mode, every driven tick after the driver (its own
    -- maps on the hook).
    if MODE.of(curStep()) then MODE.run(MODE.of(curStep()), 'tick', curStep()) end
    if G.shown then
      G.dwellF = G.dwellF + 1
      local s = curStep()
      if s and showing(s) then G.dwellIn = G.dwellIn + 1 end
    end
    -- (A prototype mode's own phase, '<id>:<name>', asserts what it asks too.)
    local live = G.phase == 'act' or G.phase == 'show' or string.find(G.phase, ':', 1, true) ~= nil
    -- Never while he stands in his own basic states with control (a scene
    -- that ended while she still lies in it): a button there is an attack -
    -- except for a step whose commands act from there (withCtrl: one his -1
    -- takes only on ctrl).
    if live and not (curStep() or {}).withCtrl and onP(GIVER, function() return ctrl() and stateNo() < 200 end) == true then live = false end
    mset(GIVER, '_gal_c', live and G.slot or 0)
    mset(GIVER, '_gal_c2', live and G.sustain or 0)
    -- His companion's grab command, on it, while the driver waits for the grab.
    local s = curStep()
    mset(GIVER, '_gal_hc', (G.phase == 'enter' and s and s.companion) and s.companion.cmd or 0)
    -- Its position, set by the hook while the step's path waits for it.
    mset(GIVER, '_gal_hg', (G.phase == 'act' and s and s.companion and s.companion.go) or 0)
    -- (A step with a re-roll, for the test: his state and the one before it,
    -- each time they change - a re-roll shows as the state that draws,
    -- entered from the one the hook took him out of.)
    if LOG and s and s.reroll then
      local k = tostring(giverState()) .. ' prev ' .. tostring(onP(GIVER, function() return prevStateNo() end)) .. ' her ' .. tostring(recvState())
        .. ' prev ' .. tostring(onR(function() return prevStateNo() end))
      if k ~= G.rrKey then G.rrKey = k; log('reroll watch: his ' .. k) end
    end
    -- (For the test, while a step shows: each change of his state or hers,
    -- with the match frame - a scene that holds shows none that leaves it.)
    if LOG and G.phase == 'show' then
      local k = tostring(giverState()) .. ' her ' .. tostring(recvState())
      if k ~= G.hwKey then G.hwKey = k; log('hold watch f=' .. MATCH.f) end
    elseif G.hwKey then
      G.hwKey = nil
    end
    -- From the reset until a frame before the grab: his leftovers go, the
    -- grab's own explods never. And a step given up on, once both stand.
    mset(GIVER, '_gal_clean', ((G.phase == 'place' and G.t < 7) or (G.phase == 'stuck' and G.t >= 3 and G.t < 7)) and 1 or 0)
    -- THE APPROACH of a signaled grab's helper (the step's approach: its walk
    -- to her takes half a minute): while the driver waits for her scene, the
    -- hook stands it where its own line goes on toward its signal, in its
    -- walking state. That line reads its P2, the nearest receiver: where
    -- another pair's is nearer (several pairs), it is asked beside her first,
    -- K.BESIDE from her on the side it came from, never at that receiver.
    local ap, apj = 0, 0
    if G.phase == 'enter' and s and s.approach then
      local a = s.approach
      local q = onP(GIVER, function()
        if not helper(a.id) or stateNo() ~= a.state then return nil end
        local x = posX() * 320 / localCoordX()
        if p2() then return { x = x, p2 = id() } end
        return { x = x }
      end)
      local her = q and onP(RECV, function() return { id = id(), x = posX() * 320 / localCoordX() } end)
      if her then
        ap = a.n
        if q.p2 ~= her.id then
          local side = q.x >= her.x and 1 or -1
          apj = 1
          mset(GIVER, '_gal_apx', (her.x + side * K.BESIDE) * (onP(GIVER, function() return localCoordX() end) or 320) / 320)
          if LOG and not G.apAsked then G.apAsked = true; log(string.format('enter: helper %d beside her at %.0f (its P2 another receiver)', a.id, her.x + side * K.BESIDE)) end
        end
      end
    end
    mset(GIVER, '_gal_appr', ap); mset(GIVER, '_gal_apj', apj)
    -- A receiver's helper: her root's summon (pressed), and her place in
    -- front of him on the frame she is first seen ready.
    local rh = rhelperOf(curPair())
    if rh then
      -- Her badge, where the gallery gives it to this pair's giver: the
      -- hook's state +1 runs her badge lines on her while her root says so.
      mset(RECV, '_gal_badge', rh.badge or 0)
      mset(RECV, '_gal_c', G.rslot or 0)
      mset(RECV, '_gal_rp', (G.phase == 'rsummon' and G.rplace == G.t) and 1 or 0)
      -- (Her root is never grabbed: the log says so if it is.)
      if LOG then
        local taken = onP(RECV, function() return inCustomState() and getStateOwnerPlayerNo() or 0 end) or 0
        if taken ~= (G.rootTaken or 0) then G.rootTaken = taken; if taken ~= 0 then log('ROOT TAKEN: her root in a state of P' .. taken) end end
        -- (For the test, whenever it changes: the action she is drawn with,
        -- its sprite group - a sprite-less action gives the engine's raw nil,
        -- so it is made a string inside the pcall - and how many of the
        -- explods the hook removes on her are up.)
        local a = onR(function() return anim() end)
        local grp = onR(function() local ok, v = pcall(function() return tostring(spriteVar('group')) end); if ok then return v end return '-' end)
        local ex = 0
        if rh.hide then ex = onR(function() local n = 0; for _, e in ipairs(rh.hide) do n = n + numExplod(e) end; return n end) or 0 end
        local key = tostring(a) .. '|' .. tostring(grp) .. '|' .. ex
        if key ~= G.hwatch then G.hwatch = key; log('helper watch: her anim ' .. tostring(a) .. ' group ' .. tostring(grp) .. ' hidden explods ' .. ex) end
      end
    end
  end
end

${v2 ? `-- ---- several pairs: dragged with the mouse --------------------------------------
-- The modern-input engine reads the mouse on the game's canvas (its menus)
-- and gives Lua no pointer position: mouseOver(left, top, right, bottom,
-- width, height) says whether the pointer is inside a rectangle of a width x
-- height space - here the fight's own (screenWidth x screenHeight), the
-- markers' pixels. So the pointer's x is found by halving a rectangle from
-- the fight's left edge, and a pair is hit inside a box over its ground line.
-- The left button: its held frames (inputDeviceActionTime over every device:
-- the mouse acts for the device in use). The mouse never reaches a fighter's
-- commands (the engine's rule): a click does nothing else in a fight. An
-- engine without mouseOver (stock 1.0.0, the desktop zip) has no drag.
--   Press on a pair: it is the active one (as its digit) and follows the
--   pointer across while the button is held - both of it moved by the
--   pointer's step from where they are (the hook's _gal_dx), the scene
--   playing on, bound as it was; let go, it stays there: its place (G.dx,
--   from its slot's) is where every later grab of it stands.
function UI.mouseOn()
  return type(mouseOver) == 'function' and (type(inputDeviceActionTime) == 'function' or type(getActionTime) == 'function')
end
function UI.mouseHeld()
  local t
  if type(inputDeviceActionTime) == 'function' then t = inputDeviceActionTime(0, { 'MOUSE:LEFT' }) else t = getActionTime(-1, { 'MOUSE:LEFT' }) end
  return (tonumber(t) or 0) > 0
end
-- The pointer's x across the fight, in its pixels (0 to gw); nil when it is
-- not over the fight.
function UI.pointerX(gw, gh)
  if not mouseOver(0, 0, gw, gh, gw, gh) then return nil end
  local lo, hi = 0, gw
  for _ = 1, 11 do
    local mid = (lo + hi) / 2
    if mouseOver(0, 0, mid, gh, gw, gh) then hi = mid else lo = mid end
  end
  return (lo + hi) / 2
end
-- (Its y the same way, for the log.)
function UI.pointerY(gw, gh)
  if not mouseOver(0, 0, gw, gh, gw, gh) then return nil end
  local lo, hi = 0, gh
  for _ = 1, 10 do
    local mid = (lo + hi) / 2
    if mouseOver(0, 0, gw, mid, gw, gh) then hi = mid else lo = mid end
  end
  return (lo + hi) / 2
end
-- Pair k's box on screen (the markers' pixels): DRAG_WIDE past the two of
-- them, DRAG_BODY over the ground line down to the marker; and their middle.
function UI.pairBox(k)
  local gv, rv = standsAt(2 * k - 1), standsAt(2 * k)
  if not (gv and rv) then return nil end
  local z = cameraZoom()
  local y2 = math.max(gv[2], rv[2]) + 16
  return math.min(gv[1], rv[1]) - K.DRAG_WIDE * z, y2 - 16 - K.DRAG_BODY * z, math.max(gv[1], rv[1]) + K.DRAG_WIDE * z, y2, (gv[1] + rv[1]) / 2
end
-- Pair k's place from the stage's center (320-wide units): its slot's, and
-- the drag's.
function UI.placeOf(k) return (k - (NSLOT + 1) / 2) * SPACING + (SLOTS[k].dx or 0) end
-- How far pair k's drag may go (its offset from its slot): DRAG_SEP from
-- the pairs beside it, in their order; inside the view while the screen
-- bounds them (every pair in view: the camera stands at the stage's
-- center); inside the stage's art.
function UI.dragLimits(k, gw)
  local base = (k - (NSLOT + 1) / 2) * SPACING
  local lo, hi = -1e9, 1e9
  if k > 1 then lo = UI.placeOf(k - 1) + K.DRAG_SEP - base end
  if k < NSLOT then hi = UI.placeOf(k + 1) - K.DRAG_SEP - base end
  if not CAM.free then
    local room = gw / 2 / cameraZoom() - GAP / 2 - K.DRAG_EDGE
    lo, hi = math.max(lo, -room - base), math.min(hi, room - base)
  end
  if STAGE.l and STAGE.r then
    lo, hi = math.max(lo, STAGE.l + GAP / 2 + K.DRAG_EDGE - base), math.min(hi, STAGE.r - GAP / 2 - K.DRAG_EDGE - base)
  end
  return lo, hi
end
-- Pair k moved by step (320-wide units): both of it, in their own units,
-- on top of any earlier step the hook has not taken yet.
function UI.shift(k, step)
  local g = SLOTS[k]
  g.dx = (g.dx or 0) + step
  -- (A scene whose lean is still being learned is measured from its place.)
  if g.lean then g.lean.base = g.lean.base + step end
  for _, pn in ipairs({ 2 * k - 1, 2 * k }) do
    onP(pn, function() mapSet('_gal_dx', step * localCoordX() / 320, 'add') end)
  end
end
function UI.mouseTick()
  local D = UI.drag
  if not UI.mouseOn() then return end
  local held = UI.mouseHeld()
  local press = held and not D.was
  D.was = held
  -- Let go: the button up, or anything that takes the fight away.
  if D.k and (not held or D.k > NSLOT or not keysFree() or roundState() ~= 2) then
    local k = D.k
    D.k, D.after = nil, 0
    if SLOTS[k] then
      if LOG then print(string.format('[hgallery] mouse release pair %d: offset %.1f (from %.1f): ', k, SLOTS[k].dx or 0, D.d0 or 0) .. places() .. ' | ' .. snapshot()) end
      tell(string.format('pair %d stays here', k), 90)
    end
  end
  -- (The log: where every pair is a second and three seconds after.)
  if D.after >= 0 then
    D.after = D.after + 1
    if LOG and (D.after == 60 or D.after == 180) then print('[hgallery] mouse after release +' .. D.after .. ': ' .. places() .. ' | ' .. snapshot()) end
    if D.after >= 180 then D.after = -1 end
  end
  D.hover = nil
  if roundState() ~= 2 or not keysFree() then return end
  if NSLOT < 2 then
    if press then tell('mouse drag is for several pairs', 90) end
    return
  end
  local gw, gh = screenWidth(), screenHeight()
  for k = 1, NSLOT do
    local x1, y1, x2, y2 = UI.pairBox(k)
    if x1 and mouseOver(x1, y1, x2, y2, gw, gh) and (D.hover == nil or k == SEL) then D.hover = k end
  end
  -- (The log: where the pointer is and every pair's box, when it moves.)
  if LOG and D.k == nil and type(mouseMoved) == 'function' and mouseMoved() then
    local t = {}
    for k = 1, NSLOT do
      local x1, y1, x2, y2 = UI.pairBox(k)
      t[#t + 1] = k .. string.format(':%.1f-%.1f,%.1f-%.1f', x1 or -1, x2 or -1, y1 or -1, y2 or -1)
    end
    print(string.format('[hgallery] mouse at %.1f,%.1f over %s; boxes %s (fight %.1fx%.1f)', UI.pointerX(gw, gh) or -1, UI.pointerY(gw, gh) or -1, tostring(D.hover), table.concat(t, ' '), gw, gh))
  end
  if press then
    local k = D.hover
    if LOG then print('[hgallery] mouse press on ' .. (k and ('pair ' .. k) or 'no pair') .. string.format(' (pointer %.1f): ', UI.fightX(gw, gh) or -1) .. places()) end
    if k == nil then return end
    if k ~= SEL then HGallerySlot(k) end
    local g = SLOTS[k]
    local p = DATA.pairs[g.pi]
    local s = p and p.steps[g.si]
    -- (Placed from the screen's edge, or her root summoning her there: a
    -- drag would take the edge away from it.)
    if (s and s.place) or rhelperOf(p) then return tell('pair ' .. k .. ' plays from the screen edge: it stays', 90) end
    local px = UI.fightX(gw, gh)
    if px == nil then return end
    D.k, D.x0, D.d0 = k, px, g.dx or 0
    if LOG then print(string.format('[hgallery] mouse drag pair %d from %.1f (zoom %.3f): ', k, px, cameraZoom()) .. places() .. ' | ' .. snapshot()) end
  elseif D.k then
    local px = UI.fightX(gw, gh)
    if px then
      local lo, hi = UI.dragLimits(D.k, gw)
      local want = D.d0 + (px - D.x0) / cameraZoom()
      if lo <= hi then want = math.max(lo, math.min(hi, want)) else want = SLOTS[D.k].dx or 0 end
      local step = want - (SLOTS[D.k].dx or 0)
      if math.abs(step) >= 0.05 then UI.shift(D.k, step) end
      if LOG and LOOPF % 15 == 0 then
        print(string.format('[hgallery] mouse drag pair %d: pointer %.1f, offset %.1f, its middle on screen %.1f: ', D.k, px, SLOTS[D.k].dx or 0, select(5, UI.pairBox(D.k)) or -1) .. places())
      end
    end
  end
  -- The pair being dragged, or under the pointer (the mouse used last): a
  -- frame round it in its color, solid while dragged.
  local k = D.k or ((type(mouseActive) ~= 'function' or mouseActive()) and D.hover or nil)
  if k and not HIDE then
    local x1, y1, x2, y2 = UI.pairBox(k)
    if x1 then
      local c, a = COL.COLORS[k], D.k and 255 or 150
      mbox('dt', gw, gh, x1, y1, x2, y1 + 1, c, a, 255 - a)
      mbox('db', gw, gh, x1, y2 - 1, x2, y2, c, a, 255 - a)
      mbox('dl', gw, gh, x1, y1, x1 + 1, y2, c, a, 255 - a)
      mbox('dr', gw, gh, x2 - 1, y1, x2, y2, c, a, 255 - a)
    end
  end
end

-- ---- the on-screen controls (HUD) -------------------------------------------
-- Buttons a mouse clicks or a finger taps, drawn by this script in the fight's
-- own pixels (screenWidth x screenHeight: 240 tall, 320 wide at 4:3, about
-- 427 at 16:9; camera zoom leaves them alone). Mid-match the engine reads the
-- pointer only inside the fight's viewport, so every button sits inside it.
-- Two thumb columns at the screen's edges (a phone held sideways):
--   left   POS back, VER up, VER down, PAIRS (the picker)
--   right  POS next, SPEED (one faster per tap, around to the slowest),
--          CLIMAX (lit while on), STAGE
-- EXIT (a tap arms it: LEAVE THE GALLERY over the bar, or EXIT again, leaves)
-- and HIDE in the top corners, a two-line status bar between them, and with
-- several pairs a row of chips under it: pair 1-4 (the active one), + (the
-- picker, to add one) and the zoom out / in (magnifiers). Each button calls its key's
-- own function (HGalleryNav and the rest), so its notes, waits and in-place
-- moves are the key's; a button the position has nothing for is drawn dim
-- and a tap gives the key's note. Keys and pads are unchanged.
-- The pointer is read once a frame (UI.pointerX / pointerY) and hit-tested
-- against the layout with arithmetic. A press on a button is taken
-- (mouseTake: it never starts a pair drag) and the button acts on RELEASE
-- over it; sliding off before letting go cancels. Hidden (HIDE, the H and
-- Insert keys) only a SHOW tab stays. Nothing is drawn below y 222: the floor
-- and the pairs' markers stay clear. One rect object per piece is kept and
-- set again only when it changes (the cost line under -hgallerylog).
-- (Every table is made inside a function: the register rule at K, COL, UI.)
function UI.hudInit()
  UI.hud = { ft = 0, fid = nil, armT = 0, was = false, hold = nil, over = nil, hov = false,
    cw = 44, cmp = false, cols = false, mb = {}, rs = {}, ts = {}, wc = {}, wn = 0, lcn = 0, gk = nil, L = nil, lk = nil, exit = false, ma = false,
    bars = false, bw = 0, ox = 0, pw = 320, slim = false, bx1 = 52, bx2 = 268, help = false, helpT = 0, helpBy = 'keys', mouse = false, wsLog = nil, barsOff = false,
    WU = { 'MOUSE:WHEELUP' }, WD = { 'MOUSE:WHEELDOWN' },
    hint = { key = nil, lines = {} }, bar = {}, cost = { n = 0, hud = 0, mouse = 0, pk = 0, pkn = 0 } }
  UI.hc = { FACE = { 14, 16, 26 }, EDGE = { 210, 214, 228 }, PAPER = { 246, 240, 222 }, DIM = { 118, 120, 132 },
    RED = { 255, 70, 70 }, GOLD = { 255, 196, 52 }, CYAN = { 90, 210, 255 }, PINK = { 255, 92, 150 },
    GREEN = { 110, 230, 140 }, BONE = { 232, 228, 216 }, INK = { 10, 11, 16 }, WHITE = { 255, 255, 255 },
    BLACK = { 0, 0, 0 }, SOFT = { 190, 192, 200 } }
end
UI.hudInit()
-- Characters' own HUD explods (galhud.js): each character with any, by its
-- select path, and its number in the hook's list (map _gal_hud on its root).
UI.HUDX = ${toLua(HUDX)}
-- The driver names them: every fighter's number on its root, when it
-- changes and every 30 frames (a character loaded again starts with no map).
function UI.hudExplods()
  local H = UI.hud
  H.hx = H.hx or {}
  for k = 1, NSLOT do
    local g = SLOTS[k]
    local pr = g and DATA.pairs[g.pi]
    if pr then
      for i, sel in ipairs({ pr.giver.select, pr.receiver.select }) do
        local pn, n = 2 * k - 2 + i, UI.HUDX[sel] or 0
        if H.hx[pn] ~= n or (n > 0 and LOOPF % 30 == 0) then
          if LOG and H.hx[pn] ~= n and n > 0 then print('[hgallery] hud explods of ' .. sel .. ' hidden (P' .. pn .. ', list ' .. n .. ')') end
          H.hx[pn] = n
          mset(pn, '_gal_hud', n)
        end
      end
    end
  end
end
-- Slim columns (glyphs only) from this many pairs on, in the fight's own
-- pixels; the bars are used when each is at least BARS_MIN wide.
K.SLIM_AT, K.BARS_MIN = 4, 50
-- The map (stage) the gallery plays on: its number in DATA.stages (1, the
-- build's first, when the data has none). Kept for the session like the
-- zoom and the hidden HUD (reloads, leaving and coming back), never saved.
K.map = 1
-- The gallery's own copy of the engine's 6x9 font (a screenpack may ship
-- another f-6x9.def); the engine's where the build has none.
function UI.hudFont()
  local name = 'f-6x9.def'
  if main and main.f_fileExists and main.f_fileExists('${GALLERY_FONT_VPATH}') then name = '${GALLERY_FONT_VPATH.replace(/^font\//, '')}' end
  local ok, f = pcall(fontNew, name, -1)
  if LOG then print('[hgallery] hud font ' .. name .. ((ok and f ~= nil) and '' or ' did not load: f-6x9.def')) end
  if ok and f ~= nil then return f end
  return fontNew('f-6x9.def', -1)
end
-- Where the controls are drawn: UI.hud.gw x gh, in 240-high units. Our web
-- engine lets the script draw and read the mouse over the WHOLE window
-- during a match (uiWindowSpace: the pillarbox bars beside a fight narrower
-- than the window); there, on bars at least K.BARS_MIN wide, it is the
-- window, the fight from ox to ox + pw, and the columns stand in the bars.
-- Else (a fight as wide as the window, an engine without it: the desktop
-- exe, stock 1.0.0) it is the fight's own pixels, ox 0, and the columns
-- stand in the picture - slim (glyphs only) from K.SLIM_AT pairs on. Asked
-- every frame (the engine clears it at each match's start and end); the
-- log says when it changes. H.bx1-bx2: the status bar, '?' at its end.
function UI.hudSpace()
  local H = UI.hud
  local gw, gh = screenWidth(), screenHeight()
  local ww, why = nil, 'no engine support'
  if type(uiWindowSpace) == 'function' then
    if H.barsOff then uiWindowSpace(false); why = 'off by the test key'
    else
      ww = tonumber(uiWindowSpace(true))
      if ww == nil then why = 'the game does not keep its aspect'
      elseif (ww - gw) / 2 < K.BARS_MIN then
        why = string.format('bars %.1f wide (window %.1f, fight %.1f)', (ww - gw) / 2, ww, gw)
        uiWindowSpace(false)
        ww = nil
      end
    end
  end
  H.bars = ww ~= nil
  H.bw = H.bars and (ww - gw) / 2 or 0
  H.ox, H.pw = H.bw, gw
  H.slim = (not H.bars) and NSLOT >= K.SLIM_AT
  -- COMPACT tiles (a computer): once a mouse has hovered over the picture
  -- (a touch screen never reports a hover) every tile is about 72% of the
  -- touch size - 34 wide, words at 3/4 scale. Lua cannot read the window in
  -- pixels, so the pointer is what tells a mouse from a finger; a touch
  -- screen, or a mouse not yet moved, keeps the touch tiles.
  H.cmp = H.mouse == true
  H.cw = H.bars and math.min(H.cmp and 34 or 47, H.bw - 6) or (H.cmp and 34 or (H.slim and 30 or 44))
  if H.bars then H.bx1, H.bx2 = H.ox + 2, H.ox + gw - 2 else H.bx1, H.bx2 = H.cw + 8, math.floor(gw + 0.5) - H.cw - 8 end
  if LOG then
    local line = H.bars and string.format('on: window %.2f, fight %.2f, bars %.2f', ww, gw, H.bw) or ('off: ' .. why)
    if H.wsLog ~= line then H.wsLog = line; print('[hgallery] bars ' .. line) end
  end
  UI.hudGeom(H.bars and ww or gw, gh)
end
-- The pointer's x in the fight's pixels (past 0 or gw over the bars).
function UI.fightX(gw, gh)
  local H = UI.hud
  if not H.bars then return UI.pointerX(gw, gh) end
  local x = UI.pointerX(H.gw, H.gh)
  return x and (x - H.ox) or nil
end
-- The fight's size: the caches set their localcoord again when it changes.
function UI.hudGeom(gw, gh)
  local H = UI.hud
  local key = gw * 4096 + gh
  if H.gk ~= key then
    H.gk, H.gw, H.gh, H.gwi, H.ghi, H.lcn = key, gw, gh, math.floor(gw + 0.5), math.floor(gh + 0.5), H.lcn + 1
    H.lk = nil
  end
end
-- One rect of a piece's set (rs[i]), in the fight's pixels: color c, alpha
-- a (0-1), additive when add. Set again only what changed.
function UI.hr(rs, i, x1, y1, x2, y2, c, a, add)
  local H = UI.hud
  local e = rs[i]
  if e == nil then e = { r = rectNew() }; rs[i] = e end
  local r = e.r
  if e.lc ~= H.lcn then rectSetLocalcoord(r, H.gw, H.gh); e.lc, e.x1 = H.lcn, nil end
  if e.c ~= c then rectSetColor(r, c[1], c[2], c[3]); e.c = c end
  local src = math.floor(a * 255 + 0.5)
  local ak = add and (-1 - src) or src
  if e.a ~= ak then rectSetAlpha(r, src, add and 255 or 255 - src); e.a = ak end
  if e.x1 ~= x1 or e.y1 ~= y1 or e.x2 ~= x2 or e.y2 ~= y2 then
    rectSetWindow(r, x1, y1, x2, y2)
    e.x1, e.y1, e.x2, e.y2 = x1, y1, x2, y2
  end
  rectDraw(r)
end
-- A frame t thick inside x1,y1-x2,y2 (four rects from rs[i]).
function UI.hframe(rs, i, x1, y1, x2, y2, t, c, a, add)
  UI.hr(rs, i, x1, y1, x2, y1 + t, c, a, add)
  UI.hr(rs, i + 1, x1, y2 - t, x2, y2, c, a, add)
  UI.hr(rs, i + 2, x1, y1 + t, x1 + t, y2 - t, c, a, add)
  UI.hr(rs, i + 3, x2 - t, y1 + t, x2, y2 - t, c, a, add)
end
-- A hard shadow 2 down and right: only what shows past the box (two rects).
function UI.hshadow(rs, i, x1, y1, x2, y2, a)
  UI.hr(rs, i, x2, y1 + 2, x2 + 2, y2 + 2, UI.hc.BLACK, a)
  UI.hr(rs, i + 1, x1 + 2, y2, x2, y2 + 2, UI.hc.BLACK, a)
end
-- A play arrow from x (rs[i] on, one rect a column): n columns u wide, the
-- base n * u each way from cy and u less each way a column, so it comes to
-- a point. dir 1 points right, -1 left. The HUD's POS arrows are n 4, u 2;
-- the picker's SHOW is the same arrow at half that, n 4, u 1.
function UI.htri(rs, i, x, cy, n, u, dir, c, a)
  for j = 0, n - 1 do
    local h, cx = (n - j) * u, x + ((dir > 0) and j or (n - 1 - j)) * u
    UI.hr(rs, i + j, cx, cy - h, cx + u, cy + h, c, a)
  end
end
-- One text of a piece's set (ts[i]): at x, its baseline at y; align 0
-- centered, 1 from x, -1 up to x; win, a kept { x1, y1, x2, y2 }, clips it.
function UI.ht(ts, i, str, x, y, c, a, align, sc, win)
  local H = UI.hud
  local e = ts[i]
  if e == nil then
    local t = textImgNew()
    textImgSetFont(t, UI.font)
    e = { ti = t }
    ts[i] = e
  end
  local t = e.ti
  sc = sc or 1
  if e.lc ~= H.lcn or e.sc ~= sc then
    textImgSetLocalcoord(t, H.gwi, H.ghi)
    textImgSetScale(t, sc, sc)
    e.lc, e.sc, e.x, e.w = H.lcn, sc, nil, nil
  end
  local w = win or H
  if e.w ~= w then
    if win then textImgSetWindow(t, win[1], win[2], win[3], win[4]) else textImgSetWindow(t, 0, 0, H.gwi, H.ghi) end
    e.w = w
  end
  if e.al ~= align then textImgSetAlign(t, align); e.al = align end
  if e.s ~= str then textImgSetText(t, str); e.s = str end
  local ak = math.floor(a * 255 + 0.5)
  if e.c ~= c or e.a ~= ak then textImgSetColor(t, c[1], c[2], c[3], ak); e.c, e.a = c, ak end
  if e.x ~= x or e.y ~= y then textImgSetPos(t, x, y); e.x, e.y = x, y end
  textImgDraw(t)
end
-- A string's width in the font at scale 1 (the fight's units), measured
-- by the engine: the font is variable width.
function UI.hw(str)
  local H = UI.hud
  local w = H.wc[str]
  if w then return w end
  if H.mt == nil then H.mt = textImgNew(); textImgSetFont(H.mt, UI.font); textImgSetScale(H.mt, 1, 1) end
  w = tonumber(textImgGetTextWidth(H.mt, str)) or (#str * 6)
  if H.wn > 300 then H.wc, H.wn = {}, 0 end
  H.wc[str], H.wn = w, H.wn + 1
  return w
end
-- str cut with '..' to fit maxw (no space or opening bracket left before
-- the '..').
function UI.hcut(str, maxw)
  if UI.hw(str) <= maxw then return str end
  for n = #str - 1, 1, -1 do
    local s = string.gsub(string.sub(str, 1, n), '[%s%(%[]+$', '')
    if s ~= '' and UI.hw(s .. '..') <= maxw then return s .. '..' end
  end
  return ''
end
-- str cut at a word to fit maxw: whole words, then '..', never after a
-- space, a colon or an opening bracket, nor inside brackets it opened, and
-- a number or a one-letter key stays with the word before it ("POSITION
-- 1", "SPEED 3", "PRESS B", "HOLD Y)"). '' when not even the first word
-- fits (the caller decides what goes).
function UI.hcutw(str, maxw)
  if UI.hw(str) <= maxw then return str end
  for n = #str - 1, 1, -1 do
    if string.sub(str, n + 1, n + 1) == ' ' and not string.find(str, '^%d', n + 2)
      and not string.find(str, '^%w[%)%],.:;!?]*$', n + 2) and not string.find(str, '^%w[%)%],.:;!?]* ', n + 2) then
      local s = string.gsub(string.sub(str, 1, n), '[%s%(%[:;,/&%-]+$', '')
      local _, o = string.gsub(s, '[%(%[]', '')
      local _, c = string.gsub(s, '[%)%]]', '')
      if s ~= '' and o <= c and UI.hw(s .. '..') <= maxw then return s .. '..' end
    end
  end
  return ''
end
-- The speed line of the step's indicator ("speed 2/5 Del/End", "phase 2/3",
-- "picture 1/2", "speed auto/5"): its word, where it is, the top.
function UI.hudSpeedOf(s)
  local w, here, top = string.match(s.ind or '', '(%a+) (%w+)/?(%d*) Del/End')
  return w, here, top
end
-- The buttons for the active pair's step, made when the step, the pairs, the
-- zoom, the fight's size or the space (bars, slim) change. In the HUD's
-- space (UI.hudSpace): in the bars, a column 47 wide in each, 3 from the
-- picture (EXIT / HIDE, POS, VER / SPEED, VER / CLIMAX, PAIRS / STAGE, then
-- the pair chips in a 2 x 2 grid / zoom out and in); in the picture, the
-- columns at its edges (44 wide, 30 and glyphs only when slim) and the chips
-- and zoom in a row under the status bar. '?' (the keys' help) at the status
-- bar's right end.
function UI.hudLayout()
  local H, C = UI.hud, UI.hc
  useSlot(SEL)
  local p, s = curPair(), curStep()
  if p == nil or s == nil then return nil end
  local armed = H.armT > 0
  local key = G.pi .. '|' .. G.si .. '|' .. SEL .. '|' .. NSLOT .. '|' .. H.gwi .. '|' .. ZL .. '|' .. tostring(HIDE) .. '|' .. tostring(armed)
    .. '|' .. tostring(H.bars) .. '|' .. tostring(H.slim) .. '|' .. tostring(H.help) .. '|' .. tostring(H.cmp)
  if H.lk == key and H.L then return H.L end
  local gw, k = H.gwi, s.k
  local L = {}
  local cw, bars = H.cw, H.bars
  -- The two columns' edges: lx1-lx2 and rx1-rx2. (Compact tiles in the bars
  -- stand in the middle of each bar: the bar is wider than they are.)
  local cmp = H.cmp
  local lx1, lx2, rx1, rx2
  if bars then
    if cmp then
      lx1 = math.floor((H.ox - cw) / 2)
      lx2 = lx1 + cw
      rx1 = H.ox + H.pw + math.floor((H.bw - cw) / 2)
    else
      lx2 = H.ox - 3
      lx1, rx1 = lx2 - cw, H.ox + H.pw + 3
    end
    rx2 = rx1 + cw
  else
    lx1, lx2, rx1, rx2 = 4, 4 + cw, gw - 4 - cw, gw - 4
  end
  -- The build's maps (stages): a MAP tile where there is more than one.
  local maps = #UI.mapList() > 1
  -- Rows: the top pair, then POS, VER / SPEED, VER / CLIMAX, PAIRS / MOOD
  -- and MAP (the right column's fifth). MOOD and MAP are half-height tiles
  -- (a glyph and a word on one line). Compact: one set of rows for the
  -- bars and the picture, from under EXIT / HIDE. Touch: the bars' rows
  -- run 34-202; the picture's from 52 to 220 (nothing is drawn below 222:
  -- the floor and the pairs' markers stay clear); slim (glyphs only, from
  -- K.SLIM_AT pairs) stop at 158: four pairs at the fit stand below it, and
  -- the edge pairs' props are not covered - so its MAP stands in the top row.
  local rows, lp
  if cmp then
    rows = { { 34, 70 }, { 73, 99 }, { 102, 126 }, { 129, 151 }, { 154, 174 } }
    lp = rows[4]
  elseif bars then
    rows = { { 34, 86 }, { 90, 118 }, { 122, 150 }, { 154, 176 }, { 180, 202 } }
    lp = { 154, 182 }
  elseif H.slim then
    rows = { { 34, 74 }, { 78, 102 }, { 106, 130 }, { 134, 156 } }
    lp = { 134, 158 }
  else
    rows = { { 52, 100 }, { 104, 134 }, { 138, 168 }, { 172, 194 }, { 198, 220 } }
    lp = { 172, 220 }
  end
  -- MAP in the right column (every layout but the slim one's), else in the
  -- top row beside the zoom.
  local mapCol = maps and rows[5] ~= nil and not H.slim
  if HIDE then
    if bars then L[1] = { id = 'sh', kind = 'show', x1 = rx1, y1 = 4, x2 = rx2, y2 = 30, acc = C.BONE, word = 'SHOW' }
    else L[1] = { id = 'sh', kind = 'show', x1 = gw - 42, y1 = 4, x2 = gw - 4, y2 = 32, acc = C.BONE, word = 'SHOW' } end
  else
    L[#L + 1] = { id = 'ex', x1 = lx1, y1 = 4, x2 = lx2, y2 = 30, acc = C.BONE, side = 't', word = 'EXIT' }
    -- EXIT's first tap: its confirm over the status bar, away from EXIT
    -- itself (two taps on one spot are a phone's double-tap zoom).
    if armed then
      L[#L + 1] = { id = 'lv', kind = 'leave', x1 = H.bx1, y1 = 4, x2 = H.bx2 - 24, y2 = 30, acc = C.RED, word = UI.hcut('LEAVE THE GALLERY', H.bx2 - H.bx1 - 36) }
    end
    -- The keys' help: a small square at the status bar's end, lit while open.
    L[#L + 1] = { id = 'hp', kind = 'help', x1 = H.bx2 - 22, y1 = 4, x2 = H.bx2, y2 = 30, acc = C.GOLD, on = H.help, name = 'KEYS' }
    L[#L + 1] = { id = 'hi', x1 = rx1, y1 = 4, x2 = rx2, y2 = 30, acc = C.BONE, side = 't', word = 'HIDE' }
    -- The columns share one row grid, 3-4 apart: each edge pairs with one
    -- across the screen.
    local r1, r2, r3, r4 = rows[1], rows[2], rows[3], rows[4]
    L[#L + 1] = { id = 'pl', x1 = lx1, y1 = r1[1], x2 = lx2, y2 = r1[2], acc = C.GOLD, side = 'l', word = 'POS', name = 'POS BACK', glyph = 'tl', dim = (k.l or 0) <= 0 }
    L[#L + 1] = { id = 'vu', x1 = lx1, y1 = r2[1], x2 = lx2, y2 = r2[2], acc = C.GOLD, side = 'l', word = 'VER', name = 'VER UP', glyph = 'tu', dim = (k.u or 0) <= 0 }
    L[#L + 1] = { id = 'vd', x1 = lx1, y1 = r3[1], x2 = lx2, y2 = r3[2], acc = C.GOLD, side = 'l', word = 'VER', name = 'VER DOWN', glyph = 'td', dim = (k.d or 0) <= 0 }
    L[#L + 1] = { id = 'pa', x1 = lx1, y1 = lp[1], x2 = lx2, y2 = lp[2], acc = C.BONE, side = 'l', word = 'PAIRS', name = 'PAIRS', glyph = 'sq' }
    L[#L + 1] = { id = 'pr', x1 = rx1, y1 = r1[1], x2 = rx2, y2 = r1[2], acc = C.GOLD, side = 'r', word = 'POS', name = 'POS NEXT', glyph = 'tr', dim = (k.r or 0) <= 0 }
    -- Speed: the step's own words for it ("SPEED", "PHASE", "PICTURE");
    -- none, no speed to step here. Its value: BASE or AUTO alone (the
    -- meter gives the level), else where it is of the top ("2/3").
    local w, here, top = UI.hudSpeedOf(s)
    local word = w and string.upper(w) or 'SPEED'
    local sname = word
    if UI.hw(word) * (cmp and 0.75 or 1) > cw - 6 then word = string.sub(word, 1, 3) end
    local n, m = 0, tonumber(top) or 0
    if here == 'auto' then n = math.max(1, m) elseif tonumber(here) then n = tonumber(here) end
    if m < 1 then m = math.max(1, n) end
    -- (No speed here: three dim pips and no value, as BASE's meter - one
    -- pip over a dash read as '!'.)
    local val = ''
    if w then val = tonumber(here) and (here .. ((top ~= '') and ('/' .. top) or '')) or string.upper(here) else m, n = 3, 0 end
    L[#L + 1] = { id = 'sp', x1 = rx1, y1 = r2[1], x2 = rx2, y2 = r2[2], acc = C.CYAN, side = 'r', word = word, name = sname, glyph = 'me', val = val, segs = m, lit = n, dim = w == nil }
    -- Climax: lit while on (a position that is only its climax stays lit).
    local on = s.nv.c == true
    L[#L + 1] = { id = 'cl', x1 = rx1, y1 = r3[1], x2 = rx2, y2 = r3[2], acc = C.PINK, side = 'r', word = 'CLIMAX', name = 'CLIMAX', glyph = 'bu', dim = (k.c or 0) == 0, on = on }
    -- MOOD (the receiver's look as the finishes add up: the data's "stage"
    -- and the Home key) and MAP (the build's stages), half-height: a glyph
    -- and a word on one line.
    L[#L + 1] = { id = 'st', x1 = rx1, y1 = r4[1], x2 = rx2, y2 = r4[2], acc = C.GREEN, side = 'r', word = 'MOOD', name = 'MOOD', glyph = 'ba', row = true, dim = (k.h or 0) <= 0 }
    if mapCol then
      L[#L + 1] = { id = 'mp', x1 = rx1, y1 = rows[5][1], x2 = rx2, y2 = rows[5][2], acc = C.GREEN, side = 'r', word = 'MAP', name = 'MAP', glyph = 'ma', row = true }
    end
    -- The pairs' chips, + while there is room (green: a pair), and the zoom
    -- out / in (magnifiers): in the bars always (one pair: its chip, + and
    -- the zoom dim) at the bottom of each bar - the chips in a 2 x 2 grid,
    -- room for four with the +, the zoom side by side; in the picture in a
    -- row under the bar (one pair: its chip and +, the quick add, as in the
    -- bars; the zoom with several).
    local zi, zt = zoomIndex(zoomLevels()), #zoomLevels()
    local sq, st = 22, 25
    if cmp then sq, st = 20, 23 end
    if bars then
      local cy1 = cmp and 190 or 187
      local gx0, zx0 = lx1, rx1
      if cmp then gx0, zx0 = math.floor(H.ox / 2 - 21.5), math.floor(H.ox + H.pw + H.bw / 2 - 21.5) end
      for c = 1, math.min(NSLOT + 1, MAX_SLOTS) do
        local x, y = gx0 + ((c - 1) % 2) * st, cy1 + math.floor((c - 1) / 2) * st
        if c <= NSLOT then L[#L + 1] = { id = 'c' .. c, kind = 'chip', n = c, x1 = x, y1 = y, x2 = x + sq, y2 = y + sq }
        else L[#L + 1] = { id = 'ad', kind = 'plus', x1 = x, y1 = y, x2 = x + sq, y2 = y + sq, acc = C.GREEN } end
      end
      local zy = cy1 + st
      L[#L + 1] = { id = 'zm', kind = 'zoom', sign = -1, x1 = zx0, y1 = zy, x2 = zx0 + sq, y2 = zy + sq, acc = C.BONE, dim = NSLOT < 2 or zi <= 1 }
      L[#L + 1] = { id = 'zp', kind = 'zoom', sign = 1, x1 = zx0 + st, y1 = zy, x2 = zx0 + st + sq, y2 = zy + sq, acc = C.BONE, dim = NSLOT < 2 or zi >= zt }
    else
      -- (Tiles 28 touch / 20 compact, 30 / 22 apart.)
      local t, step = 28, 30
      if cmp then t, step = 20, 22 end
      for c = 1, NSLOT do
        local x = lx2 + 4 + (c - 1) * step
        L[#L + 1] = { id = 'c' .. c, kind = 'chip', n = c, x1 = x, y1 = 34, x2 = x + t, y2 = 34 + t }
      end
      if NSLOT < MAX_SLOTS then
        local x = lx2 + 4 + NSLOT * step
        L[#L + 1] = { id = 'ad', kind = 'plus', x1 = x, y1 = 34, x2 = x + t, y2 = 34 + t, acc = C.GREEN }
      end
      local mx2 = rx1 - 4
      if NSLOT > 1 then
        L[#L + 1] = { id = 'zm', kind = 'zoom', sign = -1, x1 = rx1 - 2 * t - 6, y1 = 34, x2 = rx1 - t - 6, y2 = 34 + t, acc = C.BONE, dim = zi <= 1 }
        L[#L + 1] = { id = 'zp', kind = 'zoom', sign = 1, x1 = rx1 - t - 4, y1 = 34, x2 = rx1 - 4, y2 = 34 + t, acc = C.BONE, dim = zi >= zt }
        mx2 = rx1 - 2 * t - 10 - (gw >= 400 and 30 or 0)
      end
      -- The slim layout's MAP: the top row, left of the zoom (and its
      -- label on a wide screen).
      if maps and not mapCol then
        local mw = cmp and 34 or 40
        L[#L + 1] = { id = 'mp', x1 = mx2 - mw, y1 = 34, x2 = mx2, y2 = 34 + t, acc = C.GREEN, side = 't', word = 'MAP', name = 'MAP', glyph = 'ma', row = true }
      end
    end
  end
  for _, b in ipairs(L) do
    H.rs[b.id] = H.rs[b.id] or {}
    H.ts[b.id] = H.ts[b.id] or {}
  end
  H.L, H.lk = L, key
  if LOG then
    local t = {}
    for _, b in ipairs(L) do
      t[#t + 1] = string.format('%s:%g,%g-%g,%g', b.id, b.x1, b.y1, b.x2, b.y2) .. (b.val and ('=' .. b.val) or '') .. (b.on and '*' or '') .. (b.dim and '(off)' or '')
    end
    print('[hgallery] hud layout ' .. string.format('%gx%g %s ', H.gw, H.gh, bars and string.format('bars(ox %.2f)', H.ox) or (H.slim and 'slim' or 'picture')) .. table.concat(t, ' '))
    if not H.wlog then
      H.wlog = true
      print(string.format('[hgallery] hud font widths POS=%g CLIMAX=%g SPEED=%g STAGE=%g PAIRS=%g BASE/3=%g I=%g M=%g', UI.hw('POS'), UI.hw('CLIMAX'), UI.hw('SPEED'), UI.hw('STAGE'), UI.hw('PAIRS'), UI.hw('BASE/3'), UI.hw('I'), UI.hw('M')))
    end
  end
  return L
end
-- The button under the fight's point x, y.
function UI.hudHit(L, x, y)
  if L == nil or x == nil or y == nil then return nil end
  for _, b in ipairs(L) do
    if x >= b.x1 and x < b.x2 and y >= b.y1 and y < b.y2 then return b end
  end
  return nil
end
-- The speed cycler: one faster; from the fastest (or the last picture)
-- around to the slowest, down the steps' own Delete chain.
function UI.hudSpeed()
  if not keysFree() then return end
  useSlot(SEL)
  local s, p = curStep(), curPair()
  if s == nil or p == nil then return end
  if s.k.f == -1 then
    local t, n = G.si, 0
    while n < 32 do
      local st = p.steps[t]
      local d = st and st.k.s
      if d == nil or d <= 0 then break end
      t, n = d, n + 1
    end
    if t ~= G.si then
      if LOG then print('[hgallery] hud speed around -> scene ' .. t) end
      return gotoStep(t)
    end
  end
  HGalleryNav('END')
end
-- EXIT, its second tap: the gallery is left as Esc leaves it - the match
-- ends with no reload asked (CMD nil), and the mode's loop ends (no prototype
-- mode is asked for another match).
function UI.hudExit()
  if not ACTIVE or CMD ~= nil then return end
  if paused() then return tell('paused: Pause first, then EXIT', 90) end
  UI.hud.exit = true
  if LOG then print('[hgallery] hud exit: leaving the gallery') end
  if PK.open then pickerClose() end
  useSlot(SEL)
  leaving()
  CMD = nil
  endMatch()
end
function UI.hudAct(b)
  local id, H = b.id, UI.hud
  if id == 'pl' then HGalleryNav('LEFT')
  elseif id == 'pr' then HGalleryNav('RIGHT')
  elseif id == 'vu' then HGalleryNav('UP')
  elseif id == 'vd' then HGalleryNav('DOWN')
  elseif id == 'sp' then UI.hudSpeed()
  elseif id == 'cl' then HGalleryNav('SPACE')
  elseif id == 'st' then HGalleryNav('HOME')
  elseif id == 'pa' then HGalleryPicker()
  elseif id == 'hp' then
    -- (A tap on '?' with no mouse ever seen hovering is a touch screen's:
    -- its help says what to tap, not the keys.)
    H.helpBy = H.mouse and 'keys' or 'touch'
    UI.hudHelp()
  elseif id == 'hi' or id == 'sh' then HGalleryOverlay(true)
  elseif id == 'zm' then HGalleryZoom(-1, 'MINUS')
  elseif id == 'zp' then HGalleryZoom(1, 'EQUALS')
  elseif id == 'mp' then HGalleryMaps()
  elseif id == 'ad' then
    -- The picker, ARMED to add a pair beside the others: the next tap on
    -- a receiver adds her pair in the next slot.
    HGalleryPicker()
    if PK.open and not PK.armed then UI.pkArm() end
  elseif b.kind == 'chip' then HGallerySlot(b.n)
  elseif id == 'ex' then
    if H.armT > 0 then H.armT = 0; return UI.hudExit() end
    H.armT = 150
    if LOG then print('[hgallery] hud exit armed') end
  elseif id == 'lv' then H.armT = 0; return UI.hudExit()
  end
end
-- One button: its state from the pointer, then the pieces.
--   rest     hard shadow, face, a lip of light along the top, edge, and a
--            stripe of its accent on the screen's side
--   hover    (the mouse) a fuller face, the edge in the accent
--   pressed  on its shadow (+1, +1), the face in the accent, dark ink
--   lit      (the climax on) a pink face and two pulsing rings
--   dim      (nothing to do here) faint, no stripe
--   armed    (EXIT's first tap) red, "SURE?"; LEAVE THE GALLERY beside it
function UI.hudBtn(b)
  local H, C = UI.hud, UI.hc
  local rs, ts = H.rs[b.id], H.ts[b.id]
  local down = (H.hold == b.id and H.over == b) or (H.fid == b.id and H.ft > 0)
  local hov = (not down) and H.hov and H.hold == nil and H.over == b
  local x1, y1, x2, y2 = b.x1, b.y1, b.x2, b.y2
  if down then x1, y1, x2, y2 = x1 + 1, y1 + 1, x2 + 1, y2 + 1 end
  local acc = b.acc or C.BONE
  local gc, ga, wc, wa = acc, 1, C.PAPER, 1
  local word = b.word
  if b.kind == 'chip' then
    -- A pair's chip: the active one filled with its color, the others on a
    -- face as solid as the keys' help, so the digit reads over whatever a
    -- character draws fixed to the screen there (King's guard gauge).
    local pc = COL.COLORS[b.n]
    if b.n == SEL then
      UI.hshadow(rs, 1, x1, y1, x2, y2, down and 0 or 0.45)
      UI.hr(rs, 3, x1, y1, x2, y2, pc, 0.95)
      UI.hframe(rs, 5, x1, y1, x2, y2, 1, C.BLACK, 1)
      wc = C.BLACK
    else
      if not down then UI.hshadow(rs, 1, x1, y1, x2, y2, 0.45) end
      UI.hr(rs, 3, x1, y1, x2, y2, down and pc or C.FACE, down and 0.95 or (hov and 0.92 or 0.85))
      UI.hframe(rs, 5, x1, y1, x2, y2, 2, pc, hov and 1 or 0.9)
      wc = down and C.INK or pc
    end
    return UI.ht(ts, 1, tostring(b.n), (x1 + x2) / 2 + 0.5, y1 + math.floor((y2 - y1) / 2) + 4, wc, 1, 0)
  end
  if b.kind == 'help' then
    -- '?': the keys' help; gold and solid while it is open.
    if b.on then
      UI.hr(rs, 3, x1, y1, x2, y2, acc, down and 1 or 0.9)
      UI.hframe(rs, 5, x1, y1, x2, y2, 1, C.BLACK, 1)
    else
      if not down then UI.hshadow(rs, 1, x1, y1, x2, y2, 0.45) end
      UI.hr(rs, 3, x1, y1, x2, y2, down and acc or C.FACE, down and 0.95 or (hov and 0.92 or 0.85))
      UI.hframe(rs, 5, x1, y1, x2, y2, 1, hov and acc or C.EDGE, hov and 0.95 or 0.35)
    end
    return UI.ht(ts, 1, '?', math.floor((x1 + x2) / 2) + 0.5, y1 + 17, (b.on or down) and C.INK or acc, 1, 0)
  end
  if b.kind == 'show' then
    UI.hshadow(rs, 1, x1, y1, x2, y2, down and 0 or 0.45)
    UI.hr(rs, 3, x1, y1, x2, y2, down and acc or C.FACE, down and 0.9 or (hov and 0.72 or 0.5))
    UI.hr(rs, 4, x1, y1, x2, y1 + 2, acc, 1)
    return UI.ht(ts, 1, word, (x1 + x2) / 2 + 0.5, y1 + 19, down and C.INK or C.PAPER, 0.9, 0)
  end
  if b.kind == 'leave' then
    -- EXIT's confirm: solid red, its words in white.
    UI.hshadow(rs, 1, x1, y1, x2, y2, down and 0 or 0.45)
    UI.hr(rs, 3, x1, y1, x2, y2, C.RED, down and 1 or (hov and 1 or 0.95))
    UI.hr(rs, 4, x1 + 1, y1 + 1, x2 - 1, y1 + 2, C.WHITE, 0.25, true)
    UI.hframe(rs, 5, x1, y1, x2, y2, 1, down and C.WHITE or C.RED, 1)
    return UI.ht(ts, 1, word, math.floor((x1 + x2) / 2) + 0.5, y1 + 17, down and C.INK or C.WHITE, 1, 0)
  end
  local armed = b.id == 'ex' and H.armT > 0
  -- (The chips' row - + and the magnifiers - on the chips' solid face.)
  local row = b.kind == 'plus' or b.kind == 'zoom'
  if b.dim then
    -- Off: the face an enabled tile has (a bright stage shows a button, not
    -- an empty square), no stripe, its edge faint, the glyph and word grey.
    UI.hshadow(rs, 1, x1, y1, x2, y2, 0.45)
    UI.hr(rs, 3, x1, y1, x2, y2, C.FACE, row and 0.85 or 0.55)
    UI.hframe(rs, 5, x1, y1, x2, y2, 1, C.EDGE, 0.18)
    gc, ga, wc, wa = C.DIM, 0.75, C.DIM, 0.75
  elseif down then
    UI.hr(rs, 3, x1, y1, x2, y2, armed and C.RED or acc, 0.9)
    UI.hframe(rs, 5, x1, y1, x2, y2, 1, armed and C.RED or acc, 1)
    gc, wc = C.INK, C.INK
    if armed then word = 'SURE?' end
  elseif armed then
    UI.hshadow(rs, 1, x1, y1, x2, y2, 0.45)
    UI.hr(rs, 3, x1, y1, x2, y2, C.RED, 0.7)
    UI.hframe(rs, 5, x1, y1, x2, y2, 1, C.RED, 1)
    gc, wc, word = C.WHITE, C.WHITE, 'SURE?'
  elseif b.on then
    -- Lit: two rings round it, pulsing (drawn over the scene, not added to
    -- it: they hold on a light stage too), its word kept, its burst solid.
    local p = 0.65 + 0.35 * math.sin(LOOPF * 6.2832 / 40)
    UI.hframe(rs, 14, x1 - 3, y1 - 3, x2 + 3, y2 + 3, 1, C.PINK, 0.6 * p)
    UI.hframe(rs, 18, x1 - 2, y1 - 2, x2 + 2, y2 + 2, 1, C.PINK, 0.3 * p)
    UI.hshadow(rs, 1, x1 - 3, y1 - 3, x2 + 3, y2 + 3, 0.45)
    UI.hr(rs, 3, x1, y1, x2, y2, C.PINK, 0.72)
    UI.hr(rs, 4, x1 + 1, y1 + 1, x2 - 1, y1 + 2, C.WHITE, 0.16, true)
    UI.hframe(rs, 5, x1, y1, x2, y2, 1, C.PINK, 1)
    gc, wc = C.WHITE, C.WHITE
  else
    UI.hshadow(rs, 1, x1, y1, x2, y2, 0.45)
    UI.hr(rs, 3, x1, y1, x2, y2, C.FACE, row and (hov and 0.92 or 0.85) or (hov and 0.72 or 0.55))
    UI.hr(rs, 4, x1 + 1, y1 + 1, x2 - 1, y1 + 2, C.WHITE, 0.16, true)
    UI.hframe(rs, 5, x1, y1, x2, y2, 1, hov and acc or C.EDGE, hov and 0.95 or 0.35)
    -- The stripe on the screen's side.
    if b.side == 'l' then UI.hr(rs, 9, x1, y1, x1 + 2, y2, acc, 1)
    elseif b.side == 'r' then UI.hr(rs, 9, x2 - 2, y1, x2, y2, acc, 1)
    elseif b.side == 't' then UI.hr(rs, 9, x1, y1, x2, y1 + 2, acc, 1) end
  end
  -- (Centered on the face less its edge and stripe: a 6-letter word fills it.)
  local cx = math.floor((x1 + x2 + ((b.side == 'l' and 1) or (b.side == 'r' and -1) or 0)) / 2)
  local g = b.glyph
  -- (Slim columns: the glyph alone, centered up and down - its name shows
  -- on the status bar's line 2 while hovered or pressed. SPEED keeps its
  -- meter and value.)
  local slim = H.slim and not H.cmp and (b.side == 'l' or b.side == 'r')
  -- (Compact, a computer's: the glyph centered over the word, which stands
  -- on the tile's last line at 3/4 scale.)
  local cm = H.cmp and (b.side == 'l' or b.side == 'r')
  local ws = H.cmp and 0.75 or nil
  -- (A tile under 32 tall - the bars' rows are 28 - has its glyph 2 up and
  -- its word 1 down, so 3 units stay between them; taller ones keep theirs.)
  local gy, ty = y1, 0
  if not slim and not cm and b.y2 - b.y1 < 32 then gy, ty = y1 - 2, 1 end
  if slim then
    local mid = math.floor((y1 + y2) / 2)
    gy = mid - (((g == 'tl' or g == 'tr') and 22) or ((g == 'tu' or g == 'td') and 9) or (g == 'bu' and 10) or 11)
  elseif cm then
    local mid = math.floor((y1 + y2 - 8) / 2)
    gy = mid - (((g == 'tl' or g == 'tr') and 22) or ((g == 'tu' or g == 'td') and 9) or (g == 'bu' and 10) or 11)
  end
  if b.row and not slim then
    -- MOOD and MAP: a glyph and the word on one line, centered together.
    local cmp = H.cmp
    local gwid = (g == 'ma') and (cmp and 10 or 14) or (cmp and 9 or 12)
    local gap = cmp and 3 or 4
    local x0 = math.floor(cx - (gwid + gap + UI.hw(word) * (ws or 1)) / 2)
    local cyr = math.floor((y1 + y2) / 2)
    if g == 'ma' then
      -- A folded map: a frame, two folds, a pin.
      local hh = cmp and 4 or 5
      UI.hframe(rs, 10, x0, cyr - hh, x0 + gwid, cyr + hh, 1, gc, ga)
      local f1, f2 = x0 + math.floor(gwid / 3), x0 + math.floor(gwid * 2 / 3)
      UI.hr(rs, 14, f1, cyr - hh + 1, f1 + 1, cyr + hh - 1, gc, ga * 0.55)
      UI.hr(rs, 15, f2, cyr - hh + 1, f2 + 1, cyr + hh - 1, gc, ga * 0.55)
      if not cmp then UI.hr(rs, 16, x0 + 6, cyr - 1, x0 + 8, cyr + 1, gc, ga) end
    else
      -- MOOD: three rising bars.
      local bw, st, by = cmp and 2 or 3, cmp and 3 or 4, cyr + (cmp and 4 or 5)
      local hs = cmp and { 3, 5, 7 } or { 4, 7, 10 }
      for i = 1, 3 do UI.hr(rs, 9 + i, x0 + (i - 1) * st, by - hs[i], x0 + (i - 1) * st + bw, by, gc, ga) end
    end
    return UI.ht(ts, 1, word, x0 + gwid + gap, cyr + (cmp and 3 or 4), wc, wa, 1, ws)
  end
  if b.kind == 'plus' then
    -- + (a pair): bars, not the font's.
    local cy = math.floor((y1 + y2) / 2)
    if not (b.dim or down) then gc = acc end
    UI.hr(rs, 10, cx - 5, cy - 1, cx + 5, cy + 1, gc, ga)
    UI.hr(rs, 11, cx - 1, cy - 5, cx + 1, cy + 5, gc, ga)
    return
  end
  if b.kind == 'zoom' then
    -- The zoom: a magnifier - a ring of 2-unit bars cut at the corners, its
    -- handle down to the right, - or + inside - so it never reads as the
    -- green + that adds a pair.
    local lx, ly = cx - 2, math.floor((y1 + y2) / 2) - 2
    if not (b.dim or down) then gc = acc end
    UI.hr(rs, 10, lx - 3, ly - 6, lx + 3, ly - 4, gc, ga)
    UI.hr(rs, 11, lx - 3, ly + 4, lx + 3, ly + 6, gc, ga)
    UI.hr(rs, 12, lx - 6, ly - 3, lx - 4, ly + 3, gc, ga)
    UI.hr(rs, 13, lx + 4, ly - 3, lx + 6, ly + 3, gc, ga)
    UI.hr(rs, 14, lx - 5, ly - 5, lx - 3, ly - 3, gc, ga)
    UI.hr(rs, 15, lx + 3, ly - 5, lx + 5, ly - 3, gc, ga)
    UI.hr(rs, 16, lx - 5, ly + 3, lx - 3, ly + 5, gc, ga)
    UI.hr(rs, 17, lx + 3, ly + 3, lx + 5, ly + 5, gc, ga)
    UI.hr(rs, 18, lx + 5, ly + 5, lx + 7, ly + 7, gc, ga)
    UI.hr(rs, 19, lx + 7, ly + 7, lx + 9, ly + 9, gc, ga)
    UI.hr(rs, 20, lx - 2, ly - 1, lx + 2, ly + 1, gc, ga)
    if b.sign > 0 then UI.hr(rs, 21, lx - 1, ly - 2, lx + 1, ly + 2, gc, ga) end
    return
  end
  if g == 'tl' or g == 'tr' then
    -- POS: a play arrow 8 wide, 16 tall.
    UI.htri(rs, 10, cx - 4, gy + 22, 4, 2, (g == 'tr') and 1 or -1, gc, ga)
    if not slim then UI.ht(ts, 1, word, cx + 0.5, cm and (y2 - 3) or (y2 - 6), wc, wa, 0, ws) end
  elseif g == 'tu' or g == 'td' then
    -- VER: a triangle of 6 rows, 12 wide.
    for i = 0, 2 do
      local hw = (g == 'tu') and (2 + 2 * i) or (6 - 2 * i)
      UI.hr(rs, 10 + i, cx - hw, gy + 6 + 2 * i, cx + hw, gy + 8 + 2 * i, gc, ga)
    end
    if not slim then UI.ht(ts, 1, word, cx + 0.5, cm and (y2 - 3) or (y2 - 5), wc, wa, 0, ws) end
  elseif g == 'sq' then
    -- PAIRS: four squares.
    UI.hr(rs, 10, cx - 5, gy + 6, cx - 1, gy + 10, gc, ga)
    UI.hr(rs, 11, cx + 1, gy + 6, cx + 5, gy + 10, gc, ga)
    UI.hr(rs, 12, cx - 5, gy + 12, cx - 1, gy + 16, gc, ga)
    UI.hr(rs, 13, cx + 1, gy + 12, cx + 5, gy + 16, gc, ga)
    if not slim then UI.ht(ts, 1, word, cx + 0.5, cm and (y2 - 3) or (y2 - 5 + ty), wc, wa, 0, ws) end
  elseif g == 'bu' then
    -- CLIMAX: a burst, 12 across.
    local cy = gy + 10 + ty
    UI.hr(rs, 10, cx - 4, cy - 4, cx + 4, cy + 4, gc, ga * ((b.on and not down) and 1 or 0.45))
    UI.hr(rs, 11, cx - 6, cy - 1, cx + 6, cy + 1, gc, ga)
    UI.hr(rs, 12, cx - 1, cy - 6, cx + 1, cy + 6, gc, ga)
    UI.hr(rs, 13, cx - 3, cy - 3, cx + 3, cy + 3, gc, ga)
    if not slim then UI.ht(ts, 1, word, cx + 0.5, cm and (y2 - 3) or (y2 - 4), wc, wa, 0, ws) end
  elseif g == 'ba' then
    -- STAGE: three rising bars.
    local by = gy + 16
    UI.hr(rs, 10, cx - 6, by - 4, cx - 3, by, gc, ga)
    UI.hr(rs, 11, cx - 2, by - 7, cx + 1, by, gc, ga)
    UI.hr(rs, 12, cx + 2, by - 10, cx + 5, by, gc, ga)
    if not slim then UI.ht(ts, 1, word, cx + 0.5, y2 - 5 + ty, wc, wa, 0) end
  elseif g == 'me' then
    -- SPEED: its word, a meter of one segment per speed, where it is - 2
    -- units between each (the font's capitals take 8 rows down to a row
    -- past their baseline: word 3-11, meter 13-16, value 18-26 from the top).
    -- Slim: no word (its name on line 2), the meter and value centered.
    local m = math.min(b.segs, 8)
    local sw = math.max(2, math.min(5, math.floor(((slim and 20 or (cm and 22 or 30)) - (m - 1)) / m)))
    local x0 = cx - math.floor((m * (sw + 1) - 1) / 2)
    local my = slim and (math.floor((y1 + y2) / 2) - 6) or (y1 + (cm and 11 or 13))
    if not slim then UI.ht(ts, 1, word, cx + 0.5, y1 + (cm and 9 or 10), wc, wa, 0, ws) end
    for i = 1, m do
      local lit = i <= b.lit
      local c = (b.dim or down) and gc or (lit and C.CYAN or C.WHITE)
      local a = b.dim and ga or ((lit or down) and 1 or 0.22)
      local x = x0 + (i - 1) * (sw + 1)
      UI.hr(rs, 21 + i, x, my, x + sw, my + 3, c, a)
    end
    UI.ht(ts, 2, b.val, cx + 0.5, my + (cm and 11 or 12), (b.dim or down) and wc or C.CYAN, wa, 0, ws)
  else
    UI.ht(ts, 1, word, cx + 0.5, (y1 + y2) / 2 + 4, wc, wa, 0)
  end
end
-- The status bar, as tall as EXIT and HIDE beside it. Line 1: the active
-- pair (with several, its number in its color; the names in paper), or a
-- note, or what the scene waits for; where it is (POS, VER) in gold. Line 2:
-- the position's name (its group and label, as the old overlay said them)
-- and which scene of the pair it is, with its verdict.
function UI.hudBar()
  local H, C = UI.hud, UI.hc
  local p, s = curPair(), curStep()
  if p == nil or s == nil then return end
  H.rs.bar = H.rs.bar or {}
  H.ts.bar = H.ts.bar or {}
  local rs, ts, B = H.rs.bar, H.ts.bar, H.bar
  local gw = H.gwi
  -- (From bx1 to the '?' square at bx2's end; the whole of it with no
  -- buttons: a screenpack with the mouse off.)
  local x1, x2 = H.bx1, H.mo and (H.bx2 - 24) or H.bx2
  local multi = NSLOT > 1
  -- (Near solid: a bright stage never stripes through its small lines.)
  UI.hr(rs, 1, x1, 4, x2, 30, C.FACE, 0.84)
  UI.hr(rs, 2, x1, 4, x1 + 3, 30, multi and COL.COLORS[G.k] or C.GOLD, 1)
  UI.hr(rs, 3, x1, 30, x2, 31, C.GOLD, 0.3)
  local st = status()
  local key = G.pi .. '|' .. G.si .. '|' .. G.k .. '|' .. NSLOT .. '|' .. gw .. '|' .. x1 .. '|' .. x2 .. '|' .. st
  if B.key ~= key then
    B.key = key
    local v1, v2 = string.match(s.ind or '', 'ver (%d+)/(%d+)')
    local right = 'POS ' .. s.nv.p .. '/' .. #p.nav
    local full = right .. '  VER ' .. (v1 or '1') .. '/' .. (v2 or '1')
    local room = (x2 - 6) - (x1 + 8)
    if v1 or room - UI.hw(full) >= 120 then right = full end
    B.num, B.nw = '', 0
    if st ~= '' then
      local left = string.upper(st)
      B.lc = (MSG.t > 0) and C.WHITE or C.SOFT
      -- (A note that does not fit beside where it is takes the whole line.)
      if UI.hw(left) > room - UI.hw(right) - 10 then right = '' end
      -- (Cut at a word, a bracketed hint whole: "WAITING FOR IT..".)
      local lw = (right == '') and room or (room - UI.hw(right) - 10)
      B.left = UI.hcutw(left, lw)
      if B.left == '' then B.left = UI.hcut(left, lw) end
    else
      B.lc = C.PAPER
      if multi then B.num = tostring(G.k); B.nw = UI.hw(B.num) + 5 end
      local nroom = room - B.nw - UI.hw(right) - 10
      local g, tail = string.upper(p.giver.display), ' X ' .. string.upper(p.receiver.display)
      -- (Short of room the giver's name is cut first, at a word: hers
      -- stays whole.)
      if UI.hw(g .. tail) <= nroom then B.left = g .. tail
      elseif nroom - UI.hw(tail) >= 24 then
        local gc = UI.hcutw(g, nroom - UI.hw(tail))
        if gc == '' then gc = UI.hcut(g, nroom - UI.hw(tail)) end
        B.left = gc .. tail
      else B.left = UI.hcut(string.upper(p.receiver.display), nroom) end
    end
    B.right = right
    local label, grp = s.label or '', s.group or ''
    if grp ~= '' and string.sub(label, 1, #grp + 2) == grp .. ': ' then label = string.sub(label, #grp + 3) end
    if s.ext then label = '[' .. s.ext .. '] ' .. label end
    label = string.upper(label)
    local whole = (grp ~= '') and (string.upper(grp) .. ': ' .. label) or label
    local sc = 'SCENE ' .. G.si .. '/' .. #p.steps
    local vd = (s.verdict and s.verdict ~= '') and ('[' .. string.upper(s.verdict) .. ']') or ''
    local r2 = (vd ~= '') and (sc .. '  ' .. vd) or sc
    -- (No buttons, no '?': the keys' help is the / key, said here.)
    if not H.mo then r2 = '? KEYS' end
    -- (A group that is only "Position n": POS a/b on line 1 says it, so a
    -- narrow bar (4:3, the bars' bar) leaves it out.)
    local pos = right ~= '' and label ~= '' and string.match(string.upper(grp), '^POSITION %d+$')
    if pos and room < 300 then whole = label end
    local fits = function(t, r) return UI.hw(t) <= room - ((r ~= '') and (UI.hw(r) + 10) or 0) end
    -- What goes first when it is short of room, nothing cut: that group,
    -- then SCENE, then the verdict; only then is the label cut, at a word.
    local tries = { r2 }
    if H.mo then
      if vd ~= '' then tries[2] = vd end
      tries[#tries + 1] = ''
    end
    -- (A "POSITION n" is written "POS n" before anything goes, so a cut
    -- keeps which one.)
    local short = (string.gsub(whole, 'POSITION (%d)', 'POS %1'))
    B.l2, B.r2 = nil, nil
    for _, r in ipairs(tries) do
      if fits(whole, r) then B.l2, B.r2 = whole, r
      elseif short ~= whole and fits(short, r) then B.l2, B.r2 = short, r
      elseif pos and fits(label, r) then B.l2, B.r2 = label, r end
      if B.l2 then break end
    end
    if B.l2 == nil then
      B.r2 = tries[#tries]
      local t = pos and label or short
      local rw = room - ((B.r2 ~= '') and (UI.hw(B.r2) + 10) or 0)
      B.l2 = UI.hcutw(t, rw)
      if B.l2 == '' then B.l2 = UI.hcut(t, rw) end
    end
    if LOG then print('[hgallery] hud bar ' .. B.num .. ' ' .. B.left .. ' | ' .. B.right .. ' / ' .. B.l2 .. ' | ' .. B.r2) end
  end
  if B.nw > 0 then UI.ht(ts, 5, B.num, x1 + 8, 15, COL.COLORS[G.k], 1, 1) end
  UI.ht(ts, 1, B.left, x1 + 8 + B.nw, 15, B.lc, 1, 1)
  UI.ht(ts, 2, B.right, x2 - 6, 15, C.GOLD, 1, -1)
  -- (Slim columns: the name of the button hovered or pressed on line 2.)
  local nb = H.slim and H.over and (H.hold == H.over.id or (H.hov and H.hold == nil)) and H.over.name and (H.over.side == 'l' or H.over.side == 'r') and H.over or nil
  if nb then
    UI.ht(ts, 3, nb.name .. (nb.dim and ': NOTHING HERE' or ''), x1 + 8, 26, C.GOLD, 1, 1)
  else
    UI.ht(ts, 3, B.l2, x1 + 8, 26, C.SOFT, 1, 1)
    UI.ht(ts, 4, B.r2, x2 - 6, 26, C.SOFT, H.mo and 0.8 or 0.55, -1)
  end
end
-- A part of the step's line of what its position has, as the keys' help
-- says it: the key first, no value (the buttons show where it is) -
-- "ver 1/2 Up/Dn" is "UP/DN VER", "speed base/3 Del/End" "DEL/END SPEED";
-- nil for a part with no key ("CLIMAX" alone).
function UI.hudKeyOf(part)
  local w, k = string.match(part, '^(%a+ finish) (Up/Dn)$')
  if w == nil then w, k = string.match(part, '^(%a+) %w+/?%w* (%a+/%a+)$') end
  if w then return string.upper(k .. ' ' .. w) end
  if part == 'Space climax' or part == 'CLIMAX Space off' then return 'SPACE CLIMAX' end
  if string.find(part, '^Home mood') then return 'HOME MOOD' end
  return nil
end
-- The keys' help, only when asked: '?' at the status bar's end or the /
-- key opens it, and the same, a tap anywhere else or 10 seconds close it.
-- Never on a key press (keyboard users know their keys). Under the status
-- bar (and the chips in the picture), as wide as the bar.
function UI.hudHelp()
  local H = UI.hud
  if not ACTIVE or PK.open or PK.release or H.exit then return end
  H.help = not H.help
  H.helpT = H.help and 600 or 0
  if LOG then print('[hgallery] keys help ' .. (H.help and 'open' or 'closed')) end
end
-- (Hotkeys run their text as a chunk of its own, where only globals are
-- seen: UI is this script's local, so the / key calls these.)
function HGalleryHelp() UI.hud.helpBy = 'keys'; UI.hudHelp() end
function HGalleryBarsTest() UI.hud.barsOff = not UI.hud.barsOff end
function UI.hudHints()
  local H, C = UI.hud, UI.hc
  local s = curStep()
  if s == nil then return end
  local gw = H.gwi
  local bx1, bx2 = H.bx1 + 4, H.bx2 - 4
  local w = bx2 - bx1 - 12
  local hk = (s.ind or '') .. '|' .. NSLOT .. '|' .. gw .. '|' .. w .. '|' .. H.helpBy .. '|' .. tostring(H.bars)
  local hint = H.hint
  if hint.key ~= hk then
    hint.key = hk
    local parts = {}
    if H.helpBy == 'touch' then
      -- A touch screen: what to tap and drag (the buttons say the rest).
      if NSLOT > 1 then parts = { 'TAP A PAIR TO MAKE IT ACTIVE', 'DRAG IT TO MOVE IT' }
      else parts = { 'POS AND VER STEP THROUGH THE SCENES' } end
      parts[#parts + 1] = '|'
      parts[#parts + 1] = 'PAIRS: PICK ANOTHER PAIR'
      if NSLOT < MAX_SLOTS then parts[#parts + 1] = '+: ONE MORE PAIR' end
      parts[#parts + 1] = 'MOOD: HER NEXT LOOK'
      if #UI.mapList() > 1 then parts[#parts + 1] = 'MAP: PICK A MAP' end
      parts[#parts + 1] = 'HIDE: THE PICTURE ALONE'
      parts[#parts + 1] = 'EXIT TWICE: LEAVE'
    else
      for part in string.gmatch((s.ind or '') .. '  ', '(.-)  ') do
        local t = (part ~= '') and UI.hudKeyOf(part) or nil
        if t then parts[#parts + 1] = t end
      end
      -- (Then the rest in one flow: no line holds one key alone.)
      parts[#parts + 1] = '|'
      for _, t in ipairs({ 'LEFT/RIGHT POS', 'PGUP/PGDN PAIR', 'TAB PAIRS', 'ESC LEAVE' }) do parts[#parts + 1] = t end
      if #UI.mapList() > 1 then parts[#parts + 1] = 'MAP TILE: PICK A MAP' end
      if NSLOT > 1 then parts[#parts + 1] = '1-' .. NSLOT .. ' ACTIVE PAIR'; parts[#parts + 1] = '+/- WHEEL ZOOM' end
      parts[#parts + 1] = 'INSERT HIDES THE HUD'
    end
    parts[#parts + 1] = '? CLOSES THIS'
    local lines, cur = {}, ''
    for _, t in ipairs(parts) do
      if t == '|' then
        if cur ~= '' then lines[#lines + 1] = cur; cur = '' end
      elseif cur == '' then cur = UI.hcut(t, w)
      elseif UI.hw(cur .. '  ' .. t) <= w then cur = cur .. '  ' .. t
      else lines[#lines + 1] = cur; cur = UI.hcut(t, w) end
    end
    if cur ~= '' then lines[#lines + 1] = cur end
    hint.lines = lines
    hint.first = #parts
    if LOG then print('[hgallery] keys help lines (' .. H.helpBy .. '): ' .. table.concat(lines, ' / ')) end
  end
  H.rs.hint = H.rs.hint or {}
  H.ts.hint = H.ts.hint or {}
  -- (On ink near solid (.92), so a bright stage's window bars never stripe
  -- through; 12 units a line.)
  local y0 = H.bars and 34 or 66
  local n = #hint.lines
  H.hintBox = { bx1, y0, bx2, y0 + n * 12 + 4 }
  UI.hr(H.rs.hint, 1, bx1, y0, bx2, y0 + n * 12 + 4, C.INK, 0.92)
  UI.hr(H.rs.hint, 2, bx1, y0, bx2, y0 + 1, C.GOLD, 0.5)
  for i, t in ipairs(hint.lines) do
    UI.ht(H.ts.hint, i, t, math.floor((bx1 + bx2) / 2) + 0.5, y0 + i * 12, (i == 1) and C.GOLD or C.SOFT, 1, 0)
  end
end
-- Hidden: a note while one is up, at the top.
function UI.hudNote()
  local H, C = UI.hud, UI.hc
  if MSG.t <= 0 then return end
  H.rs.note = H.rs.note or {}
  H.ts.note = H.ts.note or {}
  local t = UI.hcut(string.upper(MSG.text), H.gwi - 110)
  local w = UI.hw(t)
  local cx = math.floor(H.gwi / 2)
  UI.hr(H.rs.note, 1, cx - w / 2 - 6, 8, cx + w / 2 + 6, 22, C.BLACK, 0.6)
  UI.ht(H.ts.note, 1, t, cx + 0.5, 19, C.WHITE, 1, 0)
end
function UI.hudTick()
  local H = UI.hud
  if H.ft > 0 then H.ft = H.ft - 1 end
  if H.armT > 0 then H.armT = H.armT - 1 end
  -- The keys' help closes by itself after 10 seconds (or when it cannot
  -- show: the picker, EXIT).
  if H.help then
    H.helpT = H.helpT - 1
    if H.helpT <= 0 or PK.open or H.exit then
      H.help, H.helpT = false, 0
      if LOG then print('[hgallery] keys help closed (time or picker)') end
    end
  end
  -- (Which device was used last: the picker's info line words its hint by it.)
  H.ma = type(mouseActive) == 'function' and mouseActive() or false
  -- A screenpack that turns the mouse off ([Mouse] enabled = 0): no button
  -- could ever act (the engine reads no press), so none is drawn; line 2
  -- says '? KEYS' (the / key) instead.
  if H.mo == nil then
    local m = type(motif) == 'table' and motif.mouse or nil
    local off = type(m) == 'table' and (m.enabled == false or m.enabled == 0)
    H.mo = UI.mouseOn() and not off
    if LOG then print('[hgallery] hud buttons ' .. (H.mo and 'on' or 'off (the / key opens the keys help)') .. ': motif mouse enabled = ' .. tostring(type(m) == 'table' and m.enabled)) end
  end
  UI.hudSpace()
  useSlot(SEL)
  local L = nil
  -- (Nothing once EXIT ends the match: its fade plays out.)
  if (roundState() == 2 or MODE.liveOf(curStep())) and not PK.open and not PK.release and not H.exit then
    if HIDE then
      UI.hudNote()
      if roundState() == 2 and H.mo then L = UI.hudLayout() end
    else
      -- (EXIT armed: its LEAVE bar stands in the status bar's place.)
      if not (H.armT > 0 and H.mo and roundState() == 2 and CMD == nil) then UI.hudBar() end
      if H.help then UI.hudHints() end
      if roundState() == 2 and CMD == nil and H.mo then L = UI.hudLayout() end
    end
  end
  H.cols = L ~= nil and not HIDE
  -- The pointer, once a frame (when it moved, or the button is in play).
  if UI.mouseOn() and type(mouseTake) == 'function' then
    local held = UI.mouseHeld()
    local press, rel = held and not H.was, H.was and not held
    H.was = held
    local moved = type(mouseMoved) == 'function' and mouseMoved()
    -- (The picker reads the pointer itself while it is open.)
    if (press or rel or held or moved or H.px == nil) and not PK.open then H.px, H.py = UI.pointerX(H.gw, H.gh), UI.pointerY(H.gw, H.gh) end
    -- (A mouse: the pointer moved with no button held now or a frame ago. The
    -- frame a finger lifts after a drag moves it too, and is no mouse.)
    if moved and not held then
      H.hov = true
      if not rel then H.mouse = true end
    elseif press then H.hov = false end
    local over = UI.hudHit(L, H.px, H.py)
    H.over = over
    if press and LOG then print(string.format('[hgallery] hud pointer down at %.1f,%.1f on %s', H.px or -1, H.py or -1, over and over.id or 'nothing')) end
    -- (The keys' help open: a press anywhere but on '?' closes it, and goes
    -- on to what it pressed.)
    if press and H.help and not (over and over.id == 'hp') then
      H.help, H.helpT = false, 0
      if LOG then print('[hgallery] keys help closed (a tap elsewhere)') end
    end
    if press and over and mouseTake({ 'MOUSE:LEFT' }) then
      H.hold = over.id
      UI.drag.was = true
      if LOG then print('[hgallery] hud press ' .. over.id .. (over.dim and ' (nothing to do)' or '') .. ' at scene ' .. G.si) end
    elseif H.hold then
      if held then
        -- (No drag starts from a press a button took.)
        UI.drag.was = true
      else
        local id = H.hold
        H.hold = nil
        if over and over.id == id then
          H.fid, H.ft = id, 8
          if LOG then print('[hgallery] hud tap ' .. id .. (over.dim and ' (nothing to do)' or '') .. ' at scene ' .. G.si) end
          UI.hudAct(over)
          L = (L and roundState() == 2 and not PK.open and CMD == nil and not H.exit) and UI.hudLayout() or nil
        elseif LOG then print('[hgallery] hud cancel ' .. id .. ' (let go off it)') end
      end
    end
  end
  -- The wheel: the zoom, a notch up in, down out (as + and -; at a limit or
  -- with one pair only the log says so). Hidden too, like the keys. The
  -- picker reads it itself while open (its grid's pages), never both.
  if H.mo and not PK.open and not PK.release and type(inputDeviceActionTime) == 'function' and keysFree() then
    if (tonumber(inputDeviceActionTime(0, H.WU)) or 0) > 0 then HGalleryZoom(1, 'WHEELUP', true)
    elseif (tonumber(inputDeviceActionTime(0, H.WD)) or 0) > 0 then HGalleryZoom(-1, 'WHEELDOWN', true) end
  end
  if L then for _, b in ipairs(L) do UI.hudBtn(b) end end
  -- (Wide screens: ZOOM beside its two buttons.)
  if L and NSLOT > 1 and not HIDE and not H.bars and H.gwi >= 400 then
    H.ts.zl = H.ts.zl or {}
    for _, b in ipairs(L) do
      if b.id == 'zm' then UI.ht(H.ts.zl, 1, 'ZOOM', b.x1 - 4, b.y1 + (H.cmp and 14 or 18), UI.hc.SOFT, 0.85, -1, H.cmp and 0.75 or nil) end
    end
  end
  if LOG and L and not HIDE and NSLOT > 1 and LOOPF % 60 == 0 then UI.hudMarkCheck(L) end
end
-- (The log, several pairs: each pair's marker and body box against the
-- buttons, when it changes: what a button covers.)
function UI.hudMarkCheck(L)
  local gh = screenHeight()
  local t, hit = {}, {}
  for k = 1, NSLOT do
    local gv, rv = standsAt(2 * k - 1), standsAt(2 * k)
    if gv and rv then
      -- (The marker as markers() drew it this frame: its line and its tab.)
      local m = UI.hud.mb[k]
      if m == nil then
        local cx = (gv[1] + rv[1]) / 2
        local w = math.max(30, math.abs(rv[1] - gv[1]) + 24)
        local ly = math.min(gv[2] + 1, gh - 14)
        m = { cx - w / 2 - 1, ly - 1, cx + w / 2 + 1, math.min(ly + 2, gh - 14) + 14 }
      end
      local ox = UI.hud.ox
      local mx1, my1, mx2, my2 = m[1] + ox, m[2], m[3] + ox, m[4]
      t[#t + 1] = string.format('%d:%.0f-%.0f,%.0f-%.0f', k, mx1, mx2, my1, my2)
      local bx1, by1, bx2, by2 = UI.pairBox(k)
      if bx1 then bx1, bx2 = bx1 + ox, bx2 + ox end
      -- (In the bars a pair zoomed off the picture is drawn nowhere: the
      -- buttons beside it cover nothing.)
      local seen = not UI.hud.bars or ((mx1 + mx2) / 2 > ox and (mx1 + mx2) / 2 < ox + UI.hud.pw)
      for _, b in ipairs(L) do
        if seen and b.x1 < mx2 and b.x2 > mx1 and b.y1 < my2 and b.y2 > my1 then hit[#hit + 1] = b.id .. '/marker' .. k end
        if seen and bx1 and b.x1 < bx2 and b.x2 > bx1 and b.y1 < by2 and b.y2 > by1 then hit[#hit + 1] = b.id .. '/body' .. k end
      end
    end
  end
  local line = table.concat(t, ' ') .. ' covers: ' .. (#hit > 0 and table.concat(hit, ',') or 'none')
  if line ~= UI.hud.markLine then
    UI.hud.markLine = line
    print(string.format('[hgallery] hud markers (zoom %.3f) ', cameraZoom()) .. line)
  end
end
-- Every frame: the controls, then the drag (it reads a press they left).
-- (Under -hgallerylog: what the two cost, on average, every 600 frames.)
function UI.hudFrame()
  local C = UI.hud.cost
  UI.hudExplods()
  if not (LOG and type(os) == 'table' and type(os.clock) == 'function') then UI.hudTick(); UI.mouseTick(); return end
  local c0 = os.clock()
  UI.hudTick()
  local c1 = os.clock()
  UI.mouseTick()
  local c2 = os.clock()
  C.n, C.hud, C.mouse = C.n + 1, C.hud + (c1 - c0), C.mouse + (c2 - c1)
  if C.n >= 600 then
    print(string.format('[hgallery] hud cost per frame: controls %.1f us, drag %.1f us (%d frames, %d pairs, %s)', C.hud / C.n * 1e6, C.mouse / C.n * 1e6, C.n, NSLOT,
      PK.open and 'picker open' or (HIDE and 'hidden' or 'shown'))
      .. ((C.pkn or 0) > 0 and string.format('; picker %.1f us a frame while open (%d frames)', C.pk / C.pkn * 1e6, C.pkn) or ''))
    C.n, C.hud, C.mouse, C.pk, C.pkn = 0, 0, 0, 0, 0
  end
end

-- ---- the pair picker (the modern-input text): select icons, tapped or keyed --
-- Tab, the HUD's PAIRS or its + (to add) open it; it pauses the fight as
-- before and is drawn over the whole fight in its own pixels (the HUD's: gw
-- x 240). Its data is the old picker's: pickerGivers() (a giver, or a
-- companion of his, each with its pairs), pkRows (a pair's positions), and
-- pickerChoose / pickerAdd / HGalleryDelete load, add and remove.
--   header  (0-33) a slot per pair on screen (its color, its giver's and
--           its receiver's icons; the next empty one is a + that ARMS an
--           add), REMOVE (the active pair) and CLOSE, all 28 tall
--   info    (34-48) what the pointer is over - a pair, or what a button
--           does - else the cursor pair; her positions, the pair she is on
--           screen as, the selected position's name or one hint
--   rail    the givers (more than four: those on screen and the current
--           one, then ALL: every giver as a grid)
--   grid    (from 50) the giver's receivers as their select icons (9 x 4 at
--           16:9, 6 x 4 at 4:3), paged by the wheel, PgUp/PgDn, letters and
--           (more than one page) the page rail at the right
--   footer  (205-240) the cursor pair's positions, + ADD (CANCEL while
--           armed) and SHOW (GO TO for a pair on screen, ADD while armed)
-- A tap (a click) on a receiver loads her pair in the active pair's place,
-- or beside the others while armed; held 24 frames or right-clicked she is
-- only selected, and her positions wait in the footer for a tap. Hovering
-- names a tile and never moves the cursor. Every target acts on RELEASE over
-- the target its press began on (a slide-off cancels), and its press is
-- taken (mouseTake), so neither the HUD nor a drag sees it.
-- Keys, the old ones kept: the arrows across four zones (the pairs on
-- screen, the rail, the grid, the positions), Enter (pad a, start) shows,
-- Insert (pad c) adds, Delete removes, Tab closes, Backspace (pad b) goes
-- back a zone and then closes, PgUp/PgDn a page, Home/End the giver, 1-4 the
-- active pair, a letter the next name that starts with it - unless it is a
-- player's key (P1's WASD, K, L...): those move and choose, as on master.
-- Icons: the select system's preloaded small icon (9000,0; else 9000,1 cut
-- to a square; else a monogram), one Anim per character and size.
function UI.pkInit()
  UI.pk = { rs = {}, ts = {}, icons = {}, pend = {}, refs = {}, L = nil, lk = nil, was = false, rwas = false, hold = nil, holdT = 0,
    gy = 50, letter = nil, letterT = 0,
    long = false, over = nil, hov = false, fid = nil, ft = 0, px = nil, py = nil, mouse = false, ck = nil, sck = nil,
    made = 0, seek = 0, alltags = nil, first = false, budget = 6, disk = 1, t0 = nil, mono = {}, lkey = {}, inf = {},
    TL = { 'MOUSE:LEFT' }, TR = { 'MOUSE:RIGHT' }, WU = { 'MOUSE:WHEELUP' }, WD = { 'MOUSE:WHEELDOWN' },
    MONO = { { 86, 66, 104 }, { 58, 86, 116 }, { 64, 104, 84 }, { 116, 80, 60 }, { 108, 60, 78 }, { 80, 84, 98 } } }
end
UI.pkInit()
-- The zone the keys are in; PK.col keeps the old picker's number for the
-- log (0 the pairs on screen, 1 the givers, 2 the receivers, 3 positions).
function UI.pkZone(z)
  PK.zone = z
  PK.col = (z == 'strip' and 0) or (z == 'rail' and 1) or (z == 'pos' and 3) or 2
end
function UI.pkRight()
  return UI.mouseOn() and type(inputDeviceActionTime) == 'function' and (tonumber(inputDeviceActionTime(0, UI.pk.TR)) or 0) > 0 or false
end
-- Opened (HGalleryPicker): the cursor on the active pair, its page.
function UI.pkOpen()
  local P = UI.pk
  UI.pkZone('grid')
  PK.all, PK.ag, PK.gtop, PK.ptop, PK.armed, PK.kc, PK.rc = false, PK.gi, -1, 0, nil, SEL, 1
  P.was = UI.mouseOn() and UI.mouseHeld() or false
  P.rwas = UI.pkRight()
  P.hold, P.over, P.fid, P.ft, P.ck, P.sck, P.lk, P.first = nil, nil, nil, 0, nil, nil, nil, true
end
-- The cursor pair (nil in the ALL view) and its entry.
function UI.pkCur()
  local g = pickerGivers()[PK.gi]
  if PK.all or g == nil then return nil, g end
  return g.pairs[PK.ri], g
end
-- A giver's name as the picker writes it: a companion entry's own.
function UI.pkGiverName(g, pi)
  if g and g.comp then return g.name end
  return DATA.pairs[pi].giver.display
end
-- The step a tap loads a pair at: a companion entry's row of the pair's
-- scene; the giver's own, nil (the pair's remembered scene itself).
function UI.pkStepFor(pi)
  local g = pickerGivers()[PK.gi]
  if g and g.comp then return pkStep(pi, pkRowFor(pi)) end
  return nil
end
-- Position row r of the pair: its base step; its current or remembered
-- row, the remembered scene (versions and speed kept) - unless the row was
-- picked itself (a chip, the positions zone): then its base too, as Enter
-- on a position always showed it.
function UI.pkStepAt(pi, r, picked)
  local g = pickerGivers()[PK.gi]
  if g == nil or r == nil or (r == pkRowFor(pi) and not picked) then return UI.pkStepFor(pi) end
  return pkStepOf(g, pi, r)
end
function UI.pkArm()
  if PK.armed then PK.armed = nil; return pkLog('disarmed') end
  if NSLOT >= MAX_SLOTS then return pkSay('no room: ' .. MAX_SLOTS .. ' pairs is the most') end
  PK.armed = NSLOT + 1
  pkLog('armed')
end
-- Armed, a tap adds; the arming ends with the add (a refused one keeps it).
function UI.pkAdd(pi, si)
  pickerAdd(pi, si)
  if CMD ~= nil then PK.armed = nil end
end
-- SHOW (Enter): the cursor pair at row r - in the active pair's place,
-- beside the others while armed, or (on screen) made active, moved there in
-- place. picked: the row was chosen itself (a chip, the positions zone).
function UI.pkShowAt(r, picked)
  local pi = UI.pkCur()
  if pi == nil then return pkSay('pick a giver first') end
  local si = UI.pkStepAt(pi, r, picked)
  if PK.armed then return UI.pkAdd(pi, si) end
  return pickerChoose(pi, si)
end
-- Insert (pad c): the cursor pair beside the others, no arming needed.
function UI.pkInsert()
  if PK.maps then return end
  local pi = UI.pkCur()
  if pi == nil then return pkSay('pick a giver first') end
  pickerAdd(pi, UI.pkStepAt(pi, (PK.zone == 'pos') and PK.sc or nil, true))
end
-- Another giver entry in the grid: the cursor stays on the same receiver
-- where he has her (the old rule), on her page.
function UI.pkSetGiver(gi)
  local list = pickerGivers()
  if list[gi] == nil then return end
  local pi = UI.pkCur()
  local was = pi and string.lower(DATA.pairs[pi].receiver.select) or nil
  PK.gi, PK.ri, PK.all, PK.gtop = gi, 1, false, -1
  for ri, p in ipairs(list[gi].pairs) do
    if string.lower(DATA.pairs[p].receiver.select) == was then PK.ri = ri; break end
  end
  PK.sc = pkRowFor(list[gi].pairs[PK.ri])
  pkLog('giver')
end
-- Shared icons (copies of one character, a helper on her root's icon, a
-- companion on his giver's): for each such index the letter where the
-- names part (A/B/C for three Sophitias); nil where the icon is its own.
function UI.pkTags(names, sels)
  local function base(s) return (string.gsub(string.lower(s), '%s+%w%w?$', '')) end
  local nb, ns, groups, tags = {}, {}, {}, {}
  for i = 1, #names do
    local b, s = base(names[i]), string.lower(sels[i])
    nb[b], ns[s] = (nb[b] or 0) + 1, (ns[s] or 0) + 1
  end
  for i = 1, #names do
    local s, b = string.lower(sels[i]), base(names[i])
    local key = (ns[s] > 1 and ('s' .. s)) or (nb[b] > 1 and ('b' .. b)) or nil
    if key then groups[key] = groups[key] or {}; table.insert(groups[key], i) end
  end
  for _, idx in pairs(groups) do
    local first = string.lower(names[idx[1]])
    local n = #first
    for _, i in ipairs(idx) do
      local s, m = string.lower(names[i]), 0
      while m < n and m < #s and string.byte(s, m + 1) == string.byte(first, m + 1) do m = m + 1 end
      n = m
    end
    local used, free = {}, {}
    for _, i in ipairs(idx) do
      local c = string.match(string.sub(names[i], n + 1), '%w')
      if c then c = string.upper(c) end
      if c and not used[c] then used[c] = true; tags[i] = c else free[#free + 1] = i end
    end
    local l = 65
    for _, i in ipairs(free) do
      while used[string.char(l)] and l < 90 do l = l + 1 end
      tags[i] = string.char(l)
      used[string.char(l)] = true
    end
  end
  return tags
end
function UI.pkEntryTags(g)
  if g.tags == nil then
    local names, sels = {}, {}
    for i, p in ipairs(g.pairs) do names[i], sels[i] = DATA.pairs[p].receiver.display, DATA.pairs[p].receiver.select end
    g.tags = UI.pkTags(names, sels)
  end
  return g.tags
end
function UI.pkAllTags()
  local P = UI.pk
  if P.alltags == nil then
    local names, sels = {}, {}
    for i, e in ipairs(pickerGivers()) do names[i], sels[i] = e.name, e.select end
    P.alltags = UI.pkTags(names, sels)
  end
  return P.alltags
end
-- A character's select icon fitted into a sz x sz box: its 9000,0 (the cell
-- the select screen draws) scaled to fit - by a whole number between 0.9 and
-- 2.2, so a 25 x 25 icon stays crisp - else its 9000,1 cut to its top
-- square. One Anim per character and size, made the first time it shows;
-- false: none (a character not in the select list, or no such sprite: the
-- monogram). With BootLoadingMode 1 or 2 a character not preloaded yet is
-- asked for (queueCharPreload, high), polled every 30 frames, and drawn as
-- its monogram meanwhile (nil, never kept). At most six new ones a frame
-- (P.budget), and one search of the disk (P.disk: a name the select list
-- does not hold as written, a couple of ms in the browser): a page of new
-- faces comes in over a few frames, never as one long frame.
function UI.pkIcon(sel, sz)
  local P = UI.pk
  local sl = string.lower(sel)
  local key = sl .. '|' .. sz
  local e = P.icons[key]
  if e ~= nil then return e end
  -- (One waiting for its preload costs nothing until its next poll: the
  -- budget is for icons that can be made. The poll's time is the loop's
  -- frame count, which a second open of the picker does not set back.)
  local ref = P.refs[sl]
  if ref and P.pend[ref] and LOOPF < P.pend[ref] then return nil end
  if P.budget <= 0 then return nil end
  P.budget = P.budget - 1
  -- (Looked up only: a character the select list lacks is never added. The
  -- select list's own key first; the engine's search of the disk only for a
  -- name written another way.)
  P.seek = P.seek + 1
  local ok = true
  if ref == nil then
    ref = type(main.t_charDef) == 'table' and main.t_charDef[sl] or nil
    if ref == nil then
      if P.disk <= 0 then return nil end
      P.disk = P.disk - 1
      ok, ref = pcall(main.f_findCharRef, sel)
    end
    if ok and ref ~= nil then P.refs[sl] = ref end
  end
  if not ok or ref == nil then
    P.icons[key] = false
    if LOG then print('[hgallery] picker icon ' .. sel .. ' ' .. sz .. ': not in the select list (monogram)') end
    return false
  end
  if type(getCharPreloadStatus) == 'function' then
    local w = P.pend[ref]
    local st = tostring(getCharPreloadStatus(ref))
    if st ~= 'ready' then
      if (w == nil or st == 'idle') and type(queueCharPreload) == 'function' then queueCharPreload(ref, 2) end
      if LOG and w == nil then print('[hgallery] picker icon ' .. sel .. ' waits for its preload (' .. st .. ')') end
      P.pend[ref] = LOOPF + 30
      return nil
    end
    P.pend[ref] = nil
  end
  e = false
  pcall(function()
    for _, sp in ipairs({ { 9000, 0 }, { 9000, 1 } }) do
      local a = animGetPreloadedCharData(ref, sp[1], sp[2], false)
      local info = a and animGetSpriteInfo(a, sp[1], sp[2])
      if info and info.Size and (info.Size[1] or 0) > 0 and (info.Size[2] or 0) > 0 then
        local w, h = info.Size[1], info.Size[2]
        local s = math.max(sz / w, sz / h)
        if sp[2] == 0 then
          s = math.min(sz / w, sz / h)
          if s >= 0.9 and s < 2.2 then s = math.max(1, math.floor(s + 0.1)) end
        end
        animUpdate(a)
        e = { a = a, s = s, w = w * s, h = h * s, ox = ((info.Offset and info.Offset[1]) or 0) * s, oy = ((info.Offset and info.Offset[2]) or 0) * s,
          cover = sp[2] == 1, n = sp[2], pw = w, ph = h }
        return
      end
    end
  end)
  P.icons[key] = e
  P.made = P.made + 1
  if LOG then print('[hgallery] picker icon ' .. sel .. ' ' .. sz .. ': ' .. (e and string.format('9000,%d %dx%d at %.2f', e.n, e.pw, e.ph, e.s) or 'no 9000,0 or 9000,1 (monogram)')) end
  return e
end
-- Icon e in the box at x, y (its top left), sz square: centered (cut to the
-- top square: centered across, from the top), on whole pixels, clipped.
function UI.pkDrawIcon(e, x, y, sz)
  local H = UI.hud
  local a = e.a
  -- (Clipped only when it does not fit: a cut 9000,1, or a 9000,0 scaled up
  -- past the box. One that fits draws with the whole fight as its window.)
  local clip = e.cover or e.w > sz or e.h > sz
  if e.lc ~= H.lcn then
    animSetLocalcoord(a, H.gw, H.gh)
    animSetScale(a, e.s, e.s)
    if not clip then animSetWindow(a, 0, 0, H.gw, H.gh) end
    e.lc, e.x = H.lcn, nil
  end
  local dx = math.floor(x + (sz - e.w) / 2 + 0.5)
  local dy = e.cover and y or math.floor(y + (sz - e.h) / 2 + 0.5)
  if e.x ~= dx or e.y ~= dy then
    animSetPos(a, dx + e.ox, dy + e.oy)
    if clip then animSetWindow(a, x, y, x + sz, y + sz) end
    e.x, e.y = dx, dy
  end
  animDraw(a)
  if clip then UI.pkUnclip() end
end
-- (The web renderer keeps the last sprite's window as the clip until another
-- sprite sets one - a rect sets none - so every rect drawn after a clipped
-- icon or text vanished outside it, frames and tiles alike. A dot nobody
-- sees, with the whole fight as its window, puts the clip back.)
function UI.pkUnclip()
  local P = UI.pk
  P.un = P.un or {}
  UI.ht(P.un, 1, '.', 2, 9, UI.hc.BLACK, 1 / 255, 1)
end
-- No icon: a monogram - a muted face from the name, two faint diagonal
-- bands, two letters, the name's start under them (an 18 box: the face and
-- a letter). Rects ri, ri + 1 and texts ti to ti + 2 of the set. (Few
-- glyphs: a page of monograms is a page of text sprites.)
function UI.pkMono(rs, ts, ri, ti, name, x, y, sz, a, tag, bare)
  local P, C = UI.pk, UI.hc
  local m = P.mono[name]
  if m == nil then
    local h = 0
    for i = 1, #name do h = (h * 31 + string.byte(name, i)) % 9973 end
    local up = string.upper(name)
    local w1, w2 = string.match(up, '^%W*(%w)%w*%W+(%w)')
    local ini = w1 and (w1 .. w2) or string.sub(string.gsub(up, '%W', ''), 1, 2)
    -- (The name on the strip cut to its width with '..', never to a few
    -- letters that read as another name.)
    local nm = string.gsub(up, '[^%w ]', '')
    m = { face = P.MONO[(h % #P.MONO) + 1], ini = ini, one = string.sub(ini, 1, 1), strip = UI.hcut(nm, 32) }
    m.strip2 = UI.hcut(nm, 22)
    P.mono[name] = m
  end
  UI.hr(rs, ri, x, y, x + sz, y + sz, m.face, 0.95 * a)
  if sz < 30 then return UI.ht(ts, ti, m.one, x + sz / 2 + 0.5, y + 13, C.PAPER, a, 0) end
  local win = rs[1000 + ri]
  if win == nil or win[1] ~= x or win[2] ~= y then win = { x, y, x + sz, y + sz }; rs[1000 + ri] = win end
  UI.ht(ts, ti, '//', x - 4, y + 34, C.WHITE, 0.1 * a, 1, 4, win)
  -- (Unclipped: the next sprite's window puts the clip back.)
  UI.ht(ts, ti + 1, m.ini, x + sz / 2 + 0.5, y + 21, C.PAPER, a, 0, 2)
  -- (A giver's tile - the rail, ALL - has his count there instead: the
  -- info line names him.)
  if bare then return end
  UI.hr(rs, ri + 1, x, y + sz - 9, x + sz, y + sz, C.BLACK, 0.6 * a)
  -- (A tile's letter tag sits on the strip's left: the name moves over.)
  if tag then UI.ht(ts, ti + 2, m.strip2, x + 11 + (sz - 11) / 2 + 0.5, y + sz - 1, C.PAPER, 0.9 * a, 0)
  else UI.ht(ts, ti + 2, m.strip, x + sz / 2 + 0.5, y + sz - 1, C.PAPER, 0.9 * a, 0) end
end
-- Position row r of pair pi (entry g): its number, and its label as the old
-- picker's position column wrote it ("3: BENT OVER").
function UI.pkPosLabel(g, pi, r)
  local s = DATA.pairs[pi].steps[pkStepOf(g, pi, r)]
  if s == nil then return '?', '' end
  local label, grp = s.label or '', s.group or ''
  if grp ~= '' and string.sub(label, 1, #grp + 2) == grp .. ': ' then label = string.sub(label, #grp + 3) end
  if s.ext then label = '[' .. s.ext .. '] ' .. label end
  -- (No number before a group that is already named by it: "POSITION 2".)
  local pre = (string.upper(grp) == 'POSITION ' .. s.nv.p) and '' or (s.nv.p .. ': ')
  return tostring(s.nv.p), string.upper(pre .. ((grp ~= '') and (grp .. ': ') or '') .. label)
end
-- The layout (fight units; gw = the HUD's whole width): made again only
-- when what it shows changes. Keeps the cursor in view: the page that holds
-- it when it opens or the giver changes, else scrolled the least.
function UI.pkLayout()
  local P = UI.pk
  local gw = UI.hud.gwi
  local list = pickerGivers()
  local cols = math.max(1, math.floor((gw - 80) / 38))
  if list[PK.gi] == nil then PK.gi = 1 end
  local g = list[PK.gi]
  local n = PK.all and #list or #g.pairs
  if PK.all then PK.ag = math.max(1, math.min(n, PK.ag)) else PK.ri = math.max(1, math.min(n, PK.ri)) end
  local npg = math.max(1, math.ceil(math.ceil(n / cols) / 4))
  local maxTop = (npg - 1) * 4
  local idx = PK.all and PK.ag or PK.ri
  local row = math.floor((idx - 1) / cols)
  local ck = PK.all and -idx or (PK.gi * 65536 + idx)
  local moved = P.ck ~= ck
  if PK.gtop < 0 then PK.gtop = math.floor(row / 4) * 4
  elseif moved then
    if row < PK.gtop then PK.gtop = row elseif row > PK.gtop + 3 then PK.gtop = row - 3 end
  end
  PK.gtop = math.max(0, math.min(maxTop, PK.gtop))
  P.ck = ck
  local pi = (not PK.all) and g.pairs[PK.ri] or nil
  local rows = pi and pkRows(g, pi) or nil
  local maxc = math.floor((gw - 144) / 30)
  local shown = 0
  if rows then
    if moved then PK.sc, PK.ptop = pkRowFor(pi), 0 end
    PK.sc = math.max(1, math.min(#rows, PK.sc))
    shown = (#rows > maxc) and (maxc - 1) or #rows
    local sck = ck * 64 + PK.sc
    if P.sck ~= sck then
      P.sck = sck
      if PK.sc - 1 < PK.ptop then PK.ptop = PK.sc - 1 elseif PK.sc > PK.ptop + shown then PK.ptop = PK.sc - shown end
    end
    PK.ptop = math.max(0, math.min(#rows - shown, PK.ptop))
  end
  local K = P.lkey
  if P.lk and P.L and K[1] == gw and K[2] == NSLOT and K[3] == SEL and K[4] == PK.gi and K[5] == idx and K[6] == PK.all and K[7] == PK.gtop
    and K[8] == PK.ptop and K[9] == PK.armed and K[10] == PK.zone and K[11] == PK.sc then return P.L end
  K[1], K[2], K[3], K[4], K[5], K[6], K[7], K[8], K[9], K[10], K[11] = gw, NSLOT, SEL, PK.gi, idx, PK.all, PK.gtop, PK.ptop, PK.armed, PK.zone, PK.sc
  local L = { gw = gw, cols = cols, n = n, npg = npg, maxTop = maxTop, page = math.min(npg, math.floor(PK.gtop / 4 + 0.5) + 1),
    tiles = {}, rail = {}, btns = {}, pi = pi, rows = rows, g = g, railCur = 1, gy = P.gy }
  L.pgs = L.page .. '/' .. npg
  -- The header (targets 28 tall): a slot per pair on screen, the next one
  -- empty, REMOVE (the active pair), CLOSE.
  for k = 1, MAX_SLOTS do
    local x = 4 + (k - 1) * 56
    if k <= NSLOT then
      local pr = DATA.pairs[SLOTS[k].pi]
      L.btns[#L.btns + 1] = { id = 'k' .. k, kind = 'slot', k = k, ks = tostring(k), x1 = x, y1 = 3, x2 = x + 54, y2 = 31,
        gs = pr.giver.select, rsel = pr.receiver.select, gn = pr.giver.display, rn = pr.receiver.display, pi = SLOTS[k].pi }
    elseif k == NSLOT + 1 then
      L.btns[#L.btns + 1] = { id = 'k' .. k, kind = 'slotadd', k = k, x1 = x, y1 = 3, x2 = x + 54, y2 = 31 }
    end
  end
  L.btns[#L.btns + 1] = { id = 'rm', kind = 'rm', x1 = gw - 86, y1 = 3, x2 = gw - 44, y2 = 31, dim = NSLOT <= 1 }
  L.btns[#L.btns + 1] = { id = 'cl', kind = 'close', x1 = gw - 40, y1 = 3, x2 = gw - 4, y2 = 31 }
  -- The page rail (none for a single page).
  local gy = P.gy
  if npg > 1 then
    L.btns[#L.btns + 1] = { id = 'pu', kind = 'pg', d = -1, x1 = gw - 30, y1 = gy, x2 = gw - 4, y2 = gy + 36, dim = PK.gtop <= 0 }
    L.btns[#L.btns + 1] = { id = 'pd', kind = 'pg', d = 1, x1 = gw - 30, y1 = gy + 114, x2 = gw - 4, y2 = gy + 150, dim = PK.gtop >= maxTop }
    L.btns[#L.btns + 1] = { id = 'tr', kind = 'track', x1 = gw - 30, y1 = gy + 38, x2 = gw - 4, y2 = gy + 112 }
  end
  -- The footer: the cursor pair's positions (the last chip "+n" pages them).
  if rows then
    local under = pkRowFor(pi)
    for j = 1, shown do
      local r = PK.ptop + j
      local x = 24 + (j - 1) * 30
      local num, lab = UI.pkPosLabel(g, pi, r)
      L.btns[#L.btns + 1] = { id = 'c' .. r, kind = 'chip', r = r, x1 = x, y1 = 208, x2 = x + 28, y2 = 236, under = r == under, num = num, lab = lab }
    end
    if #rows > shown then
      local x = 24 + shown * 30
      L.btns[#L.btns + 1] = { id = 'cm', kind = 'more', x1 = x, y1 = 208, x2 = x + 28, y2 = 236, more = #rows - shown, ms = '+' .. (#rows - shown), step = shown }
    end
  end
  L.btns[#L.btns + 1] = { id = 'ad', kind = 'add', x1 = gw - 118, y1 = 208, x2 = gw - 70, y2 = 236, dim = PK.all or NSLOT >= MAX_SLOTS }
  L.btns[#L.btns + 1] = { id = 'sh', kind = 'show', x1 = gw - 66, y1 = 208, x2 = gw - 4, y2 = 236, dim = pi == nil, on = pi and slotOf(pi) or nil }
  -- The entries on screen (the active pair's first).
  local onE = {}
  for k = 1, NSLOT do
    local e = pkEntryFor(SLOTS[k].pi, SLOTS[k].si)
    if e and (onE[e] == nil or k == SEL) then onE[e] = k end
  end
  -- The rail: every entry (four or fewer), else those on screen (the active
  -- pair's first) and the current one, three at most, then ALL.
  local ents = {}
  if #list <= 4 then
    for gi = 1, #list do ents[gi] = gi end
  else
    local seen = {}
    local act = pkEntryFor(SLOTS[SEL].pi, SLOTS[SEL].si)
    if act then seen[act] = true; ents[1] = act end
    for k = 1, NSLOT do
      local e = pkEntryFor(SLOTS[k].pi, SLOTS[k].si)
      if e and not seen[e] then seen[e] = true; ents[#ents + 1] = e end
    end
    if not seen[PK.gi] then
      if #ents >= 3 then ents[3] = PK.gi else ents[#ents + 1] = PK.gi end
    end
    while #ents > 3 do table.remove(ents) end
  end
  local atags = UI.pkAllTags()
  for i, gi in ipairs(ents) do
    local e = list[gi]
    local y = gy + (i - 1) * 38
    L.rail[i] = { id = 'r' .. i, kind = 'rail', gi = gi, x1 = 4, y1 = y, x2 = 40, y2 = y + 36, sel = e.select, name = e.name,
      cnt = #e.pairs, cs = tostring(#e.pairs), on = onE[gi], ons = onE[gi] and tostring(onE[gi]), cur = (not PK.all) and gi == PK.gi, tag = atags[gi] }
    if L.rail[i].cur then L.railCur = i end
  end
  if #list > 4 then
    local y = gy + #ents * 38
    L.rail[#ents + 1] = { id = 'ra', kind = 'all', x1 = 4, y1 = y, x2 = 40, y2 = y + 36, cur = PK.all }
    if PK.all then L.railCur = #ents + 1 end
  end
  L.railEnd = (#L.rail > 0) and L.rail[#L.rail].y2 or gy
  -- The grid: its page. (ALL: no letters - the count badge, and the info
  -- line names each giver.)
  local tags = PK.all and {} or UI.pkEntryTags(g)
  for v = 1, 4 * cols do
    local i = PK.gtop * cols + v
    if i > n then break end
    local x, y = 48 + ((v - 1) % cols) * 38, gy + math.floor((v - 1) / cols) * 38
    local t = { id = 'g' .. i, kind = 'tile', i = i, x1 = x, y1 = y, x2 = x + 36, y2 = y + 36, tag = tags[i] }
    if PK.all then
      local e = list[i]
      t.gi, t.sel, t.name, t.cnt, t.cs, t.on = i, e.select, e.name, #e.pairs, tostring(#e.pairs), onE[i]
    else
      local p = g.pairs[i]
      local pr = DATA.pairs[p]
      t.pi, t.sel, t.name, t.on = p, pr.receiver.select, pr.receiver.display, slotOf(p)
      t.act = t.on ~= nil and t.on == SEL
    end
    if t.on then t.ons = tostring(t.on) end
    L.tiles[v] = t
  end
  P.L, P.lk = L, true
  if LOG then
    local s = {}
    for _, set in ipairs({ L.btns, L.rail, L.tiles }) do
      for _, b in ipairs(set) do
        s[#s + 1] = b.id .. ':' .. b.x1 .. ',' .. b.y1 .. '-' .. b.x2 .. ',' .. b.y2 .. (b.name and ('=' .. string.gsub(b.name, '%s', '_')) or '')
          .. (b.on and ('@' .. b.on) or '') .. (b.tag and ('#' .. b.tag) or '') .. (b.dim and '(dim)' or '')
      end
    end
    print('[hgallery] picker layout ' .. gw .. 'x240 cols=' .. cols .. ' page=' .. L.page .. '/' .. npg .. ' n=' .. n .. ' ' .. table.concat(s, ' '))
  end
  return L
end
-- The target under the fight's point x, y: the buttons and the rail from
-- their table, the grid by arithmetic (its 2-unit gaps are no tile's).
function UI.pkHit(L, x, y)
  if L == nil or x == nil or y == nil then return nil end
  for _, b in ipairs(L.btns) do
    if x >= b.x1 and x < b.x2 and y >= b.y1 and y < b.y2 then return b end
  end
  for _, b in ipairs(L.rail) do
    if x >= b.x1 and x < b.x2 and y >= b.y1 and y < b.y2 then return b end
  end
  local gy = L.gy
  if y >= gy and y < gy + 152 and x >= 48 then
    local c, r = math.floor((x - 48) / 38), math.floor((y - gy) / 38)
    if c < L.cols and r < 4 and (x - 48) - c * 38 < 36 and (y - gy) - r * 38 < 36 then return L.tiles[r * L.cols + c + 1] end
  end
  return nil
end
-- The grid scrolled by d rows (a page is 4), the cursor left where it is.
function UI.pkScroll(d)
  local L = UI.pkLayout()
  local t = math.max(0, math.min(L.maxTop, PK.gtop + d))
  if t ~= PK.gtop then PK.gtop = t; if LOG then print('[hgallery] picker scroll ' .. d .. ': page ' .. (math.min(L.npg, math.floor(t / 4 + 0.5) + 1)) .. '/' .. L.npg .. ' top row ' .. t) end end
end
-- The position chips paged ("+n", the wheel over the footer).
function UI.pkChips(d)
  local L = UI.pkLayout()
  if not L.rows then return end
  local maxc = math.floor((L.gw - 144) / 30)
  if #L.rows <= maxc then return end
  local shown = maxc - 1
  local t = PK.ptop + d * shown
  if d > 0 and PK.ptop >= #L.rows - shown then t = 0 elseif d < 0 and PK.ptop <= 0 then t = #L.rows - shown end
  PK.ptop = math.max(0, math.min(#L.rows - shown, t))
  if LOG then print('[hgallery] picker positions from ' .. (PK.ptop + 1) .. ' of ' .. #L.rows) end
end
-- Long press or right click on a tile: selected, not loaded.
function UI.pkSelect(t)
  if t.kind ~= 'tile' then return end
  if PK.all then PK.ag = t.i else PK.ri = t.i end
  UI.pkZone('grid')
  UI.pkLayout()
  pkLog('select')
end
-- A target tapped (released over where its press began).
function UI.pkAct(t)
  local k = t.kind
  if k == 'tile' then
    if PK.all then return UI.pkSetGiver(t.gi) end
    PK.ri = t.i
    UI.pkZone('grid')
    if PK.armed then return UI.pkAdd(t.pi, UI.pkStepFor(t.pi)) end
    return pickerChoose(t.pi, UI.pkStepFor(t.pi))
  elseif k == 'rail' then UI.pkZone('grid'); return UI.pkSetGiver(t.gi)
  elseif k == 'all' then
    PK.all, PK.ag, PK.gtop = true, PK.gi, -1
    UI.pkZone('grid')
    return pkLog('all')
  elseif k == 'slot' then PK.armed = nil; return HGallerySlot(t.k)
  elseif k == 'slotadd' then return UI.pkArm()
  elseif k == 'add' then
    if NSLOT >= MAX_SLOTS then return pkSay('no room: ' .. MAX_SLOTS .. ' pairs is the most') end
    if PK.all then return pkSay('pick a giver first') end
    return UI.pkArm()
  elseif k == 'rm' then return HGalleryDelete()
  elseif k == 'close' then return pickerClose()
  elseif k == 'pg' then return UI.pkScroll(4 * t.d)
  elseif k == 'track' then return UI.pkScroll((UI.pk.py or 0) < (t.mid or 123) and -4 or 4)
  elseif k == 'chip' then return UI.pkShowAt(t.r, true)
  elseif k == 'more' then return UI.pkChips(1)
  elseif k == 'show' then return UI.pkShowAt(PK.sc, PK.zone == 'pos')
  end
end
-- The pointer (one: a mouse or a finger, the engine does not tell them
-- apart): read once a frame, hit-tested against the layout.
function UI.pkPointer()
  local P = UI.pk
  if not (UI.mouseOn() and type(mouseTake) == 'function') then return end
  local L = UI.pkLayout()
  local gw, gh = UI.hud.gw, UI.hud.gh
  local held, rheld = UI.mouseHeld(), UI.pkRight()
  local press, rel, rpress = held and not P.was, P.was and not held, rheld and not P.rwas
  P.was, P.rwas = held, rheld
  local moved = type(mouseMoved) == 'function' and mouseMoved()
  if press or rel or held or moved or rpress or P.px == nil then P.px, P.py = UI.pointerX(gw, gh), UI.pointerY(gw, gh) end
  -- (Hover is the mouse's: a finger never moves without a press.)
  if moved and not held then P.hov, P.mouse = true, true elseif press then P.hov = false end
  local over = UI.pkHit(L, P.px, P.py)
  P.over = over
  if type(inputDeviceActionTime) == 'function' and P.py and not held then
    local d = ((tonumber(inputDeviceActionTime(0, P.WD)) or 0) > 0 and 1) or ((tonumber(inputDeviceActionTime(0, P.WU)) or 0) > 0 and -1) or 0
    if d ~= 0 then
      if LOG then print(string.format('[hgallery] picker wheel %d at %.1f,%.1f', d, P.px or -1, P.py)) end
      if P.py >= 205 then UI.pkChips(d) else UI.pkScroll(d) end
    end
  end
  if rpress and over and mouseTake(P.TR) then
    if LOG then print('[hgallery] picker right-click on ' .. over.id) end
    return UI.pkSelect(over)
  end
  if press then
    if LOG then print(string.format('[hgallery] picker pointer down at %.1f,%.1f on %s', P.px or -1, P.py or -1, over and over.id or 'nothing')) end
    if over and mouseTake(P.TL) then P.hold, P.long, P.holdT = over.id, false, 0 end
  elseif P.hold then
    if held then
      P.holdT = tonumber(type(inputDeviceActionTime) == 'function' and inputDeviceActionTime(0, P.TL) or getActionTime(-1, P.TL)) or 0
      if not P.long and over and over.id == P.hold and over.kind == 'tile' and P.holdT >= 24 then
        P.long = true
        if LOG then print('[hgallery] picker long press on ' .. over.id) end
        UI.pkSelect(over)
      end
    else
      local id = P.hold
      P.hold = nil
      if P.long then
        if LOG then print('[hgallery] picker let go after the long press on ' .. id) end
      elseif over and over.id == id then
        P.fid, P.ft = id, 8
        if LOG then print('[hgallery] picker tap ' .. id .. (over.dim and ' (dim)' or '')) end
        UI.pkAct(over)
      elseif LOG then print('[hgallery] picker cancel ' .. id .. ' (let go off it)') end
    end
  end
end
-- The grid's cursor moved by the arrows: across a row (Right on to the next
-- row, the last tile around to the first), Left from the first column to
-- the rail, Up from the top row to the pairs on screen (one pair: around),
-- Down from the bottom row to the positions.
function UI.pkGrid(dx, dy)
  local L = UI.pkLayout()
  local n, cols = L.n, L.cols
  local idx = PK.all and PK.ag or PK.ri
  local c = (idx - 1) % cols
  local ni = idx
  if dx > 0 then ni = (idx < n) and (idx + 1) or 1
  elseif dx < 0 then
    if c == 0 then UI.pkZone('rail'); PK.rc = L.railCur; return pkLog('left') end
    ni = idx - 1
  elseif dy < 0 then
    if idx > cols then ni = idx - cols
    elseif NSLOT > 1 then PK.kc = SEL; UI.pkZone('strip'); return pkLog('up')
    else
      local last = (math.ceil(n / cols) - 1) * cols + c + 1
      ni = (last <= n) and last or math.max(c + 1, last - cols)
    end
  elseif dy > 0 then
    if idx + cols <= n then ni = idx + cols
    elseif math.floor((idx - 1) / cols) < math.floor((n - 1) / cols) then ni = n
    elseif not PK.all then UI.pkZone('pos'); return pkLog('down')
    else ni = c + 1 end
  end
  if PK.all then PK.ag = ni else PK.ri = ni end
  pkLog('move ' .. ((dx ~= 0) and dx or (dy * cols)))
end
-- A letter: the next name that starts with it.
function UI.pkLetter(ch)
  local list = pickerGivers()
  local n = PK.all and #list or #list[PK.gi].pairs
  local cur = PK.all and PK.ag or PK.ri
  for d = 1, n do
    local i = ((cur - 1 + d) % n) + 1
    local nm = PK.all and list[i].name or DATA.pairs[list[PK.gi].pairs[i]].receiver.display
    if string.upper(string.match(nm, '%w') or '') == ch then
      if PK.all then PK.ag = i else PK.ri = i end
      UI.pkZone('grid')
      return pkLog('letter ' .. ch)
    end
  end
  return pkSay('no name starts with ' .. ch)
end
function UI.pkKeys()
  local P = UI.pk
  local k = getKey()
  if k ~= '' then resetKey() end
  local up, dn, lf, rt = hit('U'), hit('D'), hit('L'), hit('R')
  local ok, back, ins = hit('s') or hit('a'), hit('b') or k == 'BACKSPACE', hit('c')
  -- A letter jumps to a name only when it is no player's key: P1's letters
  -- are his directions and buttons (the Studio's WASD, K L ;), which move
  -- and choose here as on master. It waits two frames, and any direction or
  -- button read meanwhile (the engine may read his press a frame after the
  -- key) takes it.
  if up or dn or lf or rt or ok or back or ins then P.letter = nil
  elseif k ~= '' and string.find(k, '^%l$') then P.letter, P.letterT = string.upper(k), 3 end
  if P.letter then
    P.letterT = P.letterT - 1
    if P.letterT > 0 then return end
    local ch = P.letter
    P.letter = nil
    return UI.pkLetter(ch)
  end
  if k == 'PAGEUP' or k == 'PAGEDOWN' then
    local L = UI.pkLayout()
    local d = (k == 'PAGEUP') and -1 or 1
    UI.pkScroll(4 * d)
    local i = math.max(1, math.min(L.n, (PK.all and PK.ag or PK.ri) + 4 * L.cols * d))
    if PK.all then PK.ag = i else PK.ri = i end
    UI.pkZone('grid')
    return pkLog('page ' .. d)
  end
  if k == 'HOME' or k == 'END' then
    local list = pickerGivers()
    return UI.pkSetGiver(((PK.gi - 1 + ((k == 'HOME') and -1 or 1)) % #list) + 1)
  end
  if ins then return UI.pkInsert() end
  if not (up or dn or lf or rt or ok or back) then return end
  local z = PK.zone
  if z == 'strip' and NSLOT < 2 then UI.pkZone('grid'); z = 'grid' end
  if z == 'grid' then
    if back then
      if PK.all then PK.all, PK.gtop = false, -1; return pkLog('back') end
      UI.pkZone('rail'); PK.rc = UI.pkLayout().railCur; return pkLog('left')
    end
    if ok then
      if PK.all then return UI.pkSetGiver(PK.ag) end
      return UI.pkShowAt(PK.sc)
    end
    if lf then return UI.pkGrid(-1, 0) elseif rt then return UI.pkGrid(1, 0) elseif up then return UI.pkGrid(0, -1) end
    return UI.pkGrid(0, 1)
  elseif z == 'rail' then
    local L = UI.pkLayout()
    if back then return pickerClose() end
    if up or dn then
      PK.rc = ((PK.rc - 1 + (up and -1 or 1)) % #L.rail) + 1
      local t = L.rail[PK.rc]
      if t.kind == 'rail' then
        -- (Live: the grid follows the rail; the rail holds the current giver.)
        UI.pkSetGiver(t.gi)
        for i, r in ipairs(UI.pkLayout().rail) do if r.gi == t.gi then PK.rc = i end end
      end
      return pkLog('move ' .. (up and -1 or 1))
    end
    if rt or ok then
      local t = L.rail[PK.rc]
      if t and t.kind == 'all' then PK.all, PK.ag, PK.gtop = true, PK.gi, -1 end
      UI.pkZone('grid')
      return pkLog('right')
    end
  elseif z == 'strip' then
    if lf or rt then PK.kc = ((PK.kc - 1 + (lf and -1 or 1)) % NSLOT) + 1; return pkLog('move ' .. (lf and -1 or 1)) end
    if ok then PK.armed = nil; return HGallerySlot(PK.kc) end
    if dn or back then UI.pkZone('grid'); return pkLog('down') end
  else
    local L = UI.pkLayout()
    if not L.rows then UI.pkZone('grid'); return end
    if lf or rt then PK.sc = ((PK.sc - 1 + (lf and -1 or 1)) % #L.rows) + 1; return pkLog('move ' .. (lf and -1 or 1)) end
    if up or back then UI.pkZone('grid'); return pkLog('up') end
    if ok then return UI.pkShowAt(PK.sc, true) end
  end
end
-- Rect and text sets of one piece (cached by its key).
function UI.pkSet(key)
  local P = UI.pk
  local rs = P.rs[key]
  if rs == nil then rs = {}; P.rs[key] = rs; P.ts[key] = {} end
  return rs, P.ts[key]
end
-- A target's state: dim, down (held over it, or 8 frames after its tap),
-- hover (the mouse over it), else rest.
function UI.pkState(t)
  local P = UI.pk
  if t.dim then return 'dim' end
  if (P.hold == t.id and P.over and P.over.id == t.id) or (P.fid == t.id and P.ft > 0) then return 'down' end
  if P.hov and P.hold == nil and P.over and P.over.id == t.id then return 'hover' end
  return nil
end
-- A glass face (the HUD's tokens): rest, hover, down (+1, +1, the face in
-- its accent), dim; a 2-unit stripe of the accent on top ('t') or at the
-- left ('l'). -> the box as drawn, the words' ink and alpha.
function UI.pkGlass(rs, b, acc, st, a, stripe)
  local C = UI.hc
  local x1, y1, x2, y2 = b.x1, b.y1, b.x2, b.y2
  if st == 'down' then
    x1, y1, x2, y2 = x1 + 1, y1 + 1, x2 + 1, y2 + 1
    UI.hr(rs, 1, x1, y1, x2, y2, acc, 0.9 * a)
    UI.hframe(rs, 2, x1, y1, x2, y2, 1, acc, a)
    return x1, y1, x2, y2, C.INK, 1
  end
  if st == 'dim' then
    UI.hshadow(rs, 6, x1, y1, x2, y2, 0.2 * a)
    UI.hr(rs, 1, x1, y1, x2, y2, C.FACE, 0.28 * a)
    UI.hframe(rs, 2, x1, y1, x2, y2, 1, C.EDGE, 0.12 * a)
    return x1, y1, x2, y2, C.DIM, 0.5
  end
  local hov = st == 'hover'
  UI.hshadow(rs, 6, x1, y1, x2, y2, 0.45 * a)
  UI.hr(rs, 1, x1, y1, x2, y2, C.FACE, (hov and 0.72 or 0.55) * a)
  UI.hr(rs, 8, x1 + 1, y1 + 1, x2 - 1, y1 + 2, C.WHITE, 0.16 * a, true)
  UI.hframe(rs, 2, x1, y1, x2, y2, 1, hov and acc or C.EDGE, (hov and 0.95 or 0.35) * a)
  if stripe == 't' then UI.hr(rs, 9, x1, y1, x2, y1 + 2, acc, a)
  elseif stripe == 'l' then UI.hr(rs, 9, x1, y1, x1 + 2, y2, acc, a) end
  return x1, y1, x2, y2, C.PAPER, 1
end
function UI.pkBtn(b, L, a)
  local C = UI.hc
  local rs, ts = UI.pkSet(b.id)
  local st = UI.pkState(b)
  local k = b.kind
  if k == 'slot' then
    -- A pair on screen: its color bar, number, giver and receiver.
    local multi = NSLOT > 1
    local pc = multi and COL.COLORS[b.k] or C.BONE
    local act = b.k == SEL
    local x1, y1, x2, y2 = b.x1, b.y1, b.x2, b.y2
    if st == 'down' then x1, y1, x2, y2 = x1 + 1, y1 + 1, x2 + 1, y2 + 1 else UI.hshadow(rs, 6, x1, y1, x2, y2, 0.45 * a) end
    UI.hr(rs, 1, x1, y1, x2, y2, C.FACE, ((st == 'hover') and 0.72 or 0.55) * a)
    if st == 'down' then UI.hr(rs, 8, x1, y1, x2, y2, C.WHITE, 0.3 * a, true)
    elseif act and multi then UI.hr(rs, 8, x1, y1, x2, y2, pc, 0.3 * a) end
    UI.hr(rs, 9, x1, y1, x1 + 4, y2, pc, a)
    UI.hframe(rs, 2, x1, y1, x2, y2, act and 2 or 1, pc, (act and 1 or 0.55) * a)
    UI.ht(ts, 1, b.ks, x1 + 10, y1 + 18, pc, a, 0)
    if b.gic == nil then b.gic = UI.pkIcon(b.gs, 18) end
    if b.gic then UI.pkDrawIcon(b.gic, x1 + 15, y1 + 5, 18) else UI.pkMono(rs, ts, 20, 10, b.gn, x1 + 15, y1 + 5, 18, a) end
    if b.ric == nil then b.ric = UI.pkIcon(b.rsel, 18) end
    if b.ric then UI.pkDrawIcon(b.ric, x1 + 34, y1 + 5, 18) else UI.pkMono(rs, ts, 22, 14, b.rn, x1 + 34, y1 + 5, 18, a) end
    return
  end
  if k == 'slotadd' then
    -- The next empty slot: a dashed outline and a +; armed, in its color.
    local armed = PK.armed == b.k
    local c = armed and COL.COLORS[b.k] or C.GREEN
    local x1, y1, x2, y2 = b.x1, b.y1, b.x2, b.y2
    if st == 'down' then x1, y1, x2, y2 = x1 + 1, y1 + 1, x2 + 1, y2 + 1 end
    if armed then
      UI.hr(rs, 1, x1, y1, x2, y2, c, 0.25 * a)
      UI.hframe(rs, 2, x1, y1, x2, y2, 2, c, a)
    else
      UI.hr(rs, 1, x1, y1, x2, y2, C.FACE, ((st == 'hover' or st == 'down') and 0.6 or 0.35) * a)
      local i = 10
      for x = x1, x2 - 4, 7 do
        UI.hr(rs, i, x, y1, x + 4, y1 + 1, c, 0.8 * a)
        UI.hr(rs, i + 1, x, y2 - 1, x + 4, y2, c, 0.8 * a)
        i = i + 2
      end
      for y = y1 + 4, y2 - 5, 7 do
        UI.hr(rs, i, x1, y, x1 + 1, y + 4, c, 0.8 * a)
        UI.hr(rs, i + 1, x2 - 1, y, x2, y + 4, c, 0.8 * a)
        i = i + 2
      end
    end
    local cx, cy = math.floor((x1 + x2) / 2), math.floor((y1 + y2) / 2)
    UI.hr(rs, 6, cx - 5, cy - 1, cx + 5, cy + 1, c, a)
    UI.hr(rs, 7, cx - 1, cy - 5, cx + 1, cy + 5, c, a)
    return
  end
  if k == 'track' then
    -- The page rail's track: a thumb for the page, p/n on a black box.
    local cx = math.floor((b.x1 + b.x2) / 2)
    local t1, tl = b.y1 + 2, b.y2 - b.y1 - 4
    UI.hr(rs, 1, cx - 1, t1, cx + 1, t1 + tl, C.DIM, 0.5 * a)
    local th = math.max(8, math.floor(tl / L.npg + 0.5))
    local ty = t1 + ((L.maxTop > 0) and math.floor((tl - th) * PK.gtop / L.maxTop + 0.5) or 0)
    UI.hr(rs, 2, cx - 2, ty, cx + 2, ty + th, C.GOLD, a)
    b.mid = ty + th / 2
    local s = L.pgs
    local w = UI.hw(s)
    local my = math.floor((b.y1 + b.y2) / 2)
    UI.hr(rs, 3, cx - math.floor(w / 2) - 3, my - 6, cx + math.ceil(w / 2) + 3, my + 6, C.BLACK, 0.85 * a)
    UI.ht(ts, 1, s, cx + 0.5, my + 4, C.PAPER, a, 0)
    return
  end
  if k == 'show' then
    -- SHOW: solid gold, its word and a play arrow on one line (the HUD's
    -- POS arrow, smaller); GO TO for a pair on screen, ADD while armed; with
    -- several pairs (or armed) a strip in the color of the slot it acts on.
    local x1, y1, x2, y2 = b.x1, b.y1, b.x2, b.y2
    local word = PK.armed and 'ADD' or (b.on and 'GO TO' or 'SHOW')
    local down = st == 'down'
    local ink, ia = C.INK, a
    if st == 'dim' then
      UI.hshadow(rs, 6, x1, y1, x2, y2, 0.2 * a)
      UI.hr(rs, 1, x1, y1, x2, y2, C.GOLD, 0.2 * a)
      UI.hframe(rs, 2, x1, y1, x2, y2, 1, C.GOLD, 0.25 * a)
      ink, ia, word = C.DIM, 0.6 * a, 'SHOW'
    else
      if down then x1, y1, x2, y2 = x1 + 1, y1 + 1, x2 + 1, y2 + 1 else UI.hshadow(rs, 6, x1, y1, x2, y2, 0.45 * a) end
      UI.hr(rs, 1, x1, y1, x2, y2, C.GOLD, ((st == 'hover' or down) and 1 or 0.92) * a)
      if down then UI.hr(rs, 8, x1, y1, x2, y2, C.WHITE, 0.3 * a, true) end
    end
    local slot = (st ~= 'dim') and (PK.armed or ((NSLOT > 1) and (b.on or SEL))) or nil
    local sx = x1
    if slot then UI.hr(rs, 9, x1, y1, x1 + 6, y2, COL.COLORS[slot], a); sx = x1 + 6 end
    local w = UI.hw(word)
    local x0 = math.floor((sx + x2 - (w + 8)) / 2)
    local cy = math.floor((y1 + y2) / 2)
    UI.ht(ts, 1, word, x0, cy + 4, ink, ia, 1)
    -- (The arrow: the HUD's POS arrow at half its size, 4 wide and 8 tall,
    -- level with the word's capitals.)
    UI.htri(rs, 10, x0 + w + 4, cy + 1, 4, 1, 1, ink, ia)
    return
  end
  local acc = (k == 'add' and C.GREEN) or (k == 'rm' and C.RED) or ((k == 'chip' or k == 'more') and C.GOLD) or C.BONE
  -- (The add toggle while armed: CANCEL, its stripe the armed slot's color.)
  local armed = k == 'add' and PK.armed
  if armed then acc = COL.COLORS[PK.armed] end
  local x1, y1, x2, y2, ink, ia = UI.pkGlass(rs, b, acc, st, a, (k == 'close' or k == 'rm' or armed) and 't' or nil)
  local cx, cy = math.floor((x1 + x2) / 2), math.floor((y1 + y2) / 2)
  local gc = (st == 'dim' or st == 'down') and ink or acc
  local ga = ia * a
  if k == 'close' then
    UI.ht(ts, 1, 'CLOSE', cx + 0.5, cy + 5, ink, ia * a, 0)
  elseif k == 'rm' then
    UI.ht(ts, 1, 'REMOVE', cx + 0.5, cy + 5, ink, ia * a, 0)
  elseif k == 'pg' then
    for i = 0, 2 do
      local hw = (b.d < 0) and (1 + 2 * i) or (5 - 2 * i)
      UI.hr(rs, 10 + i, cx - hw, cy - 3 + 2 * i, cx + hw, cy - 1 + 2 * i, gc, ga)
    end
  elseif k == 'chip' then
    local under = b.under and st ~= 'down'
    UI.ht(ts, 1, b.num, cx + 0.5, y1 + 18, (under and C.GOLD) or ink, ia * a, 0)
    if under then UI.hr(rs, 10, x1 + 7, y2 - 6, x2 - 7, y2 - 4, C.GOLD, a) end
  elseif k == 'more' then
    if st ~= 'down' then UI.hframe(rs, 10, x1, y1, x2, y2, 1, C.GOLD, 0.9 * a) end
    UI.ht(ts, 1, b.ms, cx + 0.5, y1 + 18, (st == 'down') and ink or C.GOLD, ia * a, 0)
  elseif k == 'add' and armed then
    UI.ht(ts, 1, 'CANCEL', cx + 0.5, cy + 5, ink, ia * a, 0)
  elseif k == 'add' then
    local w = UI.hw('ADD')
    local x0 = math.floor(cx - (w + 14) / 2)
    UI.hr(rs, 10, x0, cy + 1, x0 + 10, cy + 3, gc, ga)
    UI.hr(rs, 11, x0 + 4, cy - 3, x0 + 6, cy + 7, gc, ga)
    UI.ht(ts, 1, 'ADD', x0 + 14, cy + 5, ink, ia * a, 1)
  end
end
-- One tile (36 x 36): its shadow, edge and backing, the icon (or the
-- monogram), its badges - on screen (the slot's color and number; the
-- active pair's also a bar along the bottom), a letter where its icon is
-- shared, the giver's pair count - and its state over it.
function UI.pkTile(key, t, a)
  local P, C = UI.pk, UI.hc
  local rs, ts = UI.pkSet(key)
  local st = UI.pkState(t)
  local x1, y1, x2, y2 = t.x1, t.y1, t.x2, t.y2
  local down = st == 'down'
  if down then x1, y1, x2, y2 = x1 + 1, y1 + 1, x2 + 1, y2 + 1
  else UI.hr(rs, 1, x1 + 2, y1 + 2, x2 + 2, y2 + 2, C.BLACK, 0.4 * a) end
  -- (Pressed: on its shadow, a white edge and a light wash - the face stays
  -- readable through a long press.)
  local edge, ea = C.WHITE, ((st == 'hover' or down) and 0.95) or 0.22
  if (t.kind == 'all' or t.cur) and not down then edge, ea = C.GOLD, 1 end
  UI.hr(rs, 2, x1, y1, x2, y2, edge, ea * a)
  UI.hr(rs, 3, x1 + 1, y1 + 1, x2 - 1, y2 - 1, C.INK, 0.85 * a)
  if t.kind == 'all' then
    local cx = math.floor((x1 + x2) / 2)
    UI.hr(rs, 12, cx - 7, y1 + 6, cx - 1, y1 + 12, C.GOLD, a)
    UI.hr(rs, 13, cx + 1, y1 + 6, cx + 7, y1 + 12, C.GOLD, a)
    UI.hr(rs, 14, cx - 7, y1 + 14, cx - 1, y1 + 20, C.GOLD, a)
    UI.hr(rs, 15, cx + 1, y1 + 14, cx + 7, y1 + 20, C.GOLD, a)
    UI.ht(ts, 1, 'ALL', cx + 0.5, y1 + 31, C.GOLD, a, 0)
  else
    -- (Kept on the tile once known; nil - not ready - is asked again.)
    if t.ic == nil then t.ic = UI.pkIcon(t.sel, 34) end
    if t.ic then UI.pkDrawIcon(t.ic, x1 + 1, y1 + 1, 34) else UI.pkMono(rs, ts, 20, 10, t.name, x1 + 1, y1 + 1, 34, a, t.tag, t.cnt ~= nil) end
  end
  if st == 'hover' or down then UI.hr(rs, 4, x1 + 1, y1 + 1, x2 - 1, y2 - 1, C.WHITE, 0.12 * a, true) end
  if t.on then
    local pc = COL.COLORS[t.on]
    if t.act then UI.hr(rs, 6, x1, y2 - 3, x2, y2, pc, a) end
    UI.hr(rs, 5, x1, y1, x1 + 10, y1 + 10, pc, a)
    UI.ht(ts, 2, t.ons, x1 + 5.5, y1 + 9, C.BLACK, a, 0)
  end
  if t.tag then
    UI.hr(rs, 7, x1, y2 - 10, x1 + 10, y2, C.BLACK, 0.82 * a)
    UI.ht(ts, 3, t.tag, x1 + 5.5, y2 - 1, C.PAPER, a, 0)
  end
  if t.cnt then
    local s = t.cs
    local w = UI.hw(s)
    UI.hr(rs, 8, x2 - w - 4, y2 - 10, x2, y2, C.BLACK, 0.78 * a)
    UI.ht(ts, 4, s, x2 - 2, y2 - 1, C.GOLD, a, -1)
  end
  -- (The rail's selected entry: a gold bar at the screen's edge.)
  if t.kind == 'rail' and t.cur then UI.hr(rs, 9, 0, y1, 2, y2, C.GOLD, a) end
  -- Held: the bar that fills up to the long press.
  if P.hold == t.id and not P.long and t.kind == 'tile' and P.holdT > 4 then
    UI.hr(rs, 11, x1, y2 - 3, x1 + math.floor(36 * math.min(1, P.holdT / 24)), y2, C.GOLD, a)
  end
end
-- The cursors: the grid's (a white frame, pulsing while the keys are in
-- the grid; never gold, which pair 3's yellow looks like), and the key
-- zone's when it is the rail, the pairs on screen or the positions.
function UI.pkCursors(L, a)
  local C = UI.hc
  local rs = UI.pkSet('cur')
  local p = 0.7 + 0.3 * math.sin(PK.t * 6.2832 / 40)
  local idx = PK.all and PK.ag or PK.ri
  local t = nil
  for _, x in ipairs(L.tiles) do if x.i == idx then t = x end end
  if t then
    UI.hframe(rs, 1, t.x1 - 3, t.y1 - 3, t.x2 + 3, t.y2 + 3, 1, C.BLACK, 0.8 * a)
    UI.hframe(rs, 5, t.x1 - 2, t.y1 - 2, t.x2 + 2, t.y2 + 2, 2, C.WHITE, ((PK.zone == 'grid') and p or 0.55) * a)
  end
  local z = nil
  if PK.zone == 'rail' then z = L.rail[PK.rc]
  else
    for _, b in ipairs(L.btns) do
      if (PK.zone == 'strip' and b.kind == 'slot' and b.k == PK.kc) or (PK.zone == 'pos' and b.kind == 'chip' and b.r == PK.sc) then z = b end
    end
  end
  if z then
    UI.hframe(rs, 9, z.x1 - 3, z.y1 - 3, z.x2 + 3, z.y2 + 3, 1, C.BLACK, 0.8 * a)
    UI.hframe(rs, 13, z.x1 - 2, z.y1 - 2, z.x2 + 2, z.y2 + 2, 2, C.WHITE, p * a)
  end
end
-- The line under the header. Left: what the pointer is over - a pair, a
-- giver, or a button and what it does ("REMOVE PAIR 2: ...") - else the
-- cursor's pair (armed: "ADD PAIR k: TAP A TILE"). Right, from the edge in:
-- the position under the keys' cursor, the chip under the pointer or (a
-- finger: no hover) the selected one, else one hint for the device used
-- last, or a note in their place; the pair she is on screen as, in its
-- color ("PAIR 1"); her number of positions ("4 POS").
function UI.pkInfo(L, a)
  local P, C = UI.pk, UI.hc
  local rs, ts = UI.pkSet('info')
  local gw = L.gw
  local o = P.hov and P.over or nil
  local I = P.inf
  local msg = PK.msgT > 0 and PK.msg or false
  if I.L ~= L or I.o ~= o or I.armed ~= PK.armed or I.msg ~= msg or I.mouse ~= P.mouse or I.ma ~= UI.hud.ma then
    I.L, I.o, I.armed, I.msg, I.mouse, I.ma = L, o, PK.armed, msg, P.mouse, UI.hud.ma
    UI.pkInfoText(L, o, I)
  end
  -- (Its baseline 3 units over the grid's cursor frames. The fields on the
  -- right from the edge in, 13 apart with a thin rule between two.)
  local x = gw - 4
  UI.ht(ts, 1, I.left, 4, 44, I.lc, a, 1)
  UI.ht(ts, 2, I.r2, x, 44, I.c2, a, -1)
  if I.w2 > 0 then x = x - I.w2 - 13 end
  if I.w2 > 0 and (I.w3 > 0 or I.r1 ~= '') then UI.hr(rs, 1, x + 6, 37, x + 7, 45, C.DIM, 0.9 * a) end
  UI.ht(ts, 4, I.r3, x, 44, I.c3, a, -1)
  if I.w3 > 0 then x = x - I.w3 - 13 end
  if I.w3 > 0 and I.r1 ~= '' then UI.hr(rs, 2, x + 6, 37, x + 7, 45, C.DIM, 0.9 * a) end
  UI.ht(ts, 3, I.r1, x, 44, C.GOLD, a, -1)
end
-- A pair's names as the line writes them, in maxw: the giver's cut first
-- (at a word), so hers stays whole; a cut that would leave him only a few
-- letters drops him.
function UI.pkNames(g, pi, maxw)
  local gn, rn = string.upper(UI.pkGiverName(g, pi)), string.upper(DATA.pairs[pi].receiver.display)
  local tail = '  X  ' .. rn
  if UI.hw(gn .. tail) <= maxw then return gn .. tail end
  local gr = maxw - UI.hw(tail)
  if gr >= 24 then
    local cut = UI.hcutw(gn, gr)
    if cut == '' then cut = UI.hcut(gn, gr) end
    if #(string.gsub(cut, '%W', '')) >= 6 then return cut .. tail end
  end
  return UI.hcut(rn, maxw)
end
function UI.pkInfoText(L, o, I)
  local P, C = UI.pk, UI.hc
  local gw = L.gw
  local pi, gi = L.pi, PK.all and PK.ag or nil
  local ok = o and o.kind
  if ok == 'tile' then pi, gi = o.pi, o.gi elseif ok == 'rail' then pi, gi = nil, o.gi end
  -- What a button does (its pair, where it has one).
  local pre, bpi, btxt = nil, nil, nil
  if ok == 'rm' then
    if NSLOT > 1 then pre, bpi = 'REMOVE PAIR ' .. SEL .. ': ', SLOTS[SEL].pi else btxt = 'THE LAST PAIR STAYS: A TILE CHANGES IT' end
  elseif ok == 'slot' then pre, bpi = 'PAIR ' .. o.k .. ': ', o.pi
  elseif ok == 'slotadd' or (ok == 'add' and PK.armed) then btxt = PK.armed and 'CANCEL THE ADD' or ('ADD PAIR ' .. o.k .. ': THEN TAP A TILE')
  elseif ok == 'add' then btxt = (NSLOT >= MAX_SLOTS) and ('NO ROOM: ' .. MAX_SLOTS .. ' PAIRS IS THE MOST') or 'ADD A PAIR: THEN TAP A TILE'
  elseif ok == 'close' then btxt = 'CLOSE THE PICKER'
  elseif ok == 'pg' or ok == 'track' then btxt = 'PAGE ' .. L.pgs
  elseif ok == 'all' then btxt = 'ALL GIVERS: ' .. #pickerGivers()
  elseif ok == 'more' then btxt = 'MORE POSITIONS'
  elseif ok == 'show' and L.pi then pre, bpi = (PK.armed and ('ADD AS PAIR ' .. PK.armed .. ': ')) or (slotOf(L.pi) and 'GO TO ') or 'SHOW ', L.pi
  end
  local left, lc = '', C.PAPER
  local r1, r2, c2, r3, c3 = '', '', C.DIM, '', C.PAPER
  if btxt or pre then
    if PK.msgT > 0 then r2, c2 = string.upper(PK.msg), C.GOLD end
  elseif PK.armed then
    lc = COL.COLORS[PK.armed]
    pre = 'ADD PAIR ' .. PK.armed .. ': '
    if ok == 'tile' and pi then bpi = pi else btxt = 'ADD PAIR ' .. PK.armed .. ': TAP A TILE' end
    if PK.msgT > 0 then r2, c2 = string.upper(PK.msg), C.GOLD end
  elseif pi then
    bpi = pi
    r1 = #pkRows(L.g, pi) .. ' POS'
    -- (Which pair she is on screen as: only with several.)
    local k = slotOf(pi)
    if k and NSLOT > 1 then r3, c3 = 'PAIR ' .. k, COL.COLORS[k] end
    -- (The selected position's name: the cursor's pair only.)
    local sel = nil
    if pi == L.pi and L.rows then
      local _, lab = UI.pkPosLabel(L.g, pi, PK.sc)
      sel = lab
    end
    if PK.msgT > 0 then r2, c2 = string.upper(PK.msg), C.GOLD
    elseif ok == 'chip' then r2, c2 = o.lab, C.PAPER
    elseif PK.zone == 'pos' and sel then r2, c2 = sel, C.PAPER
    elseif UI.hud.ma and not P.mouse and sel then r2, c2 = sel, C.SOFT
    elseif UI.hud.ma then r2 = 'CLICK: SHOW  RIGHT-CLICK: PICK POS'
    else
      r2 = 'ENTER SHOW  INS ADD  DEL REMOVE  TAB CLOSE'
      -- (A narrow screen: the keys a player could not guess.)
      if gw < 400 then r2 = 'INS ADD  DEL REMOVE  TAB CLOSE' end
    end
  elseif gi then
    local e = pickerGivers()[gi]
    btxt = string.upper(e.name) .. '  ' .. #e.pairs .. ((#e.pairs == 1) and ' PAIR' or ' PAIRS')
    if PK.msgT > 0 then r2, c2 = string.upper(PK.msg), C.GOLD end
  end
  -- (A position's name or a note: at most 40% / 60% of the line, or what
  -- the names leave when that is more; "POSITION n" written "POS n" (also
  -- when the names would be cut beside it whole), then cut at a word. Once
  -- the names are cut, it takes what they left.)
  local w1, w3 = (r1 ~= '') and UI.hw(r1) or 0, (r3 ~= '') and UI.hw(r3) or 0
  local r2w = r2
  local function fit2(m)
    local t = r2w
    if UI.hw(t) > m then t = string.gsub(t, 'POSITION (%d)', 'POS %1') end
    if UI.hw(t) > m then
      local cut = UI.hcutw(t, m)
      t = (cut ~= '') and cut or UI.hcut(t, m)
    end
    return t
  end
  local function free(nw) return gw - 20 - w1 - w3 - ((w1 > 0) and 13 or 0) - ((w3 > 0) and 13 or 0) - nw end
  if r2 ~= '' and c2 ~= C.DIM then
    local nw = 0
    if btxt then nw = UI.hw(btxt) elseif bpi then nw = UI.hw(pre or '') + UI.hw(UI.pkNames((ok == 'rm' or ok == 'slot') and nil or L.g, bpi, 9999)) end
    if UI.hw(r2w) > free(nw) then r2w = string.gsub(r2w, 'POSITION (%d)', 'POS %1') end
    r2 = fit2(math.max(gw * ((c2 == C.GOLD) and 0.6 or 0.4), free(nw)))
  end
  local w2 = (r2 ~= '') and UI.hw(r2) or 0
  -- (The fields on the right are 13 apart, a thin rule between them, and
  -- 8 from the names.)
  local function roomOf()
    local n = ((w1 > 0) and 1 or 0) + ((w2 > 0) and 1 or 0) + ((w3 > 0) and 1 or 0)
    return gw - 12 - w1 - w2 - w3 - ((n > 0) and (13 * (n - 1) + 8) or 0)
  end
  local room = roomOf()
  -- (A pair on screen is named by its own giver; one of the current entry
  -- by the entry's, a companion's own name.)
  local g = L.g
  if ok == 'rm' or ok == 'slot' then g = nil end
  -- (Short of room: the names are cut, the giver's first; the mouse's hint
  -- goes before that, the keys' one only when not even her name would fit.)
  local want = 0
  if btxt then want = UI.hw(btxt) elseif bpi then want = UI.hw(pre or '') + UI.hw(UI.pkNames(g, bpi, 9999)) end
  if c2 == C.DIM and r2 ~= '' and want > room and (UI.hud.ma or room < 70) then r2, w2 = '', 0; room = roomOf() end
  room = math.max(40, room)
  if btxt then left = UI.hcut(btxt, room)
  elseif bpi then left = (pre or '') .. UI.pkNames(g, bpi, room - UI.hw(pre or '')) end
  if r2 ~= r2w and c2 ~= C.DIM and free(UI.hw(left)) > w2 then r2 = fit2(free(UI.hw(left))); w2 = UI.hw(r2) end
  I.left, I.lc, I.r1, I.r2, I.c2, I.w2, I.r3, I.c3, I.w3 = left, lc, r1, r2, c2, w2, r3, c3, w3
  if LOG then print('[hgallery] picker info ' .. left .. ' | ' .. r1 .. ' | ' .. r3 .. ' | ' .. r2) end
end
function UI.pkDraw()
  local C = UI.hc
  local L = UI.pkLayout()
  local fw = UI.hud.gw
  local a = math.min(1, PK.t / 6)
  local rs, ts = UI.pkSet('base')
  UI.hr(rs, 1, 0, 0, fw, 240, C.BLACK, 0.55 * a)
  -- (Header 0-33, the info line 34-48, the grid from 50, the footer from
  -- 205; the rail's line ends at its last tile. The bands' ink all but
  -- solid (.98 over the .55 shade): a bright stage, its floor or a pair's
  -- marker never reads through them.)
  UI.hr(rs, 2, 0, 0, fw, 33, C.INK, 0.98 * a)
  local ac = PK.armed and COL.COLORS[PK.armed] or nil
  UI.hr(rs, 3, 0, 33, fw, 34, ac or C.GOLD, (ac and 0.9 or 0.45) * a)
  UI.hr(rs, 4, 0, 34, fw, 48, C.INK, 0.98 * a)
  UI.hr(rs, 5, 0, 205, fw, 240, C.INK, 0.98 * a)
  UI.hr(rs, 6, 0, 205, fw, 206, C.GOLD, 0.45 * a)
  UI.hr(rs, 7, 43, L.gy, 44, L.railEnd, C.GOLD, 0.3 * a)
  for _, b in ipairs(L.btns) do UI.pkBtn(b, L, a) end
  for i, t in ipairs(L.rail) do UI.pkTile(100 + i, t, a) end
  for v, t in ipairs(L.tiles) do UI.pkTile(v, t, a) end
  UI.pkCursors(L, a)
  UI.pkInfo(L, a)
  if PK.all then UI.ht(ts, 1, UI.hcut('PICK A GIVER: HIS RECEIVERS COME NEXT', L.gw - 128), 4, 226, C.SOFT, a, 1)
  elseif L.rows then UI.ht(ts, 1, 'POS', 4, 226, C.DIM, a, 1) end
end
-- ---- the map picker (the MAP tile) -------------------------------------------
-- The build's stages as a list of tiles in the pair picker's own bands: the
-- same ink header (a title, CLOSE), the same info line, the tiles on glass
-- (a stripe, a gold frame and NOW on the one playing), the same page rail
-- and wheel, a footer. Picking one loads the gallery again on that stage the
-- way a pair's change does (reload: the same fade): the pairs stay where
-- they are, at their scenes, dragged places and zoom. The pick is kept for
-- the session (K.map), like the zoom and the hidden HUD, never saved.
-- Keys: the arrows move, Enter (pad a, start) picks, PgUp / PgDn a page,
-- Tab / Backspace (pad b) close. No key opens it (every key of the arrow
-- cluster is taken): the MAP tile, mouse or touch.
function UI.mpInit()
  UI.mp = { list = nil, cur = 1, lk = nil, L = nil, cols = 2, vis = 5 }
end
UI.mpInit()
-- The usable stages: DATA.stages that the build has on disk (a trimmed
-- public build may lack some), the data's order (its first is the default).
-- Less than two: no tile.
function UI.mapList()
  local M = UI.mp
  if M.list then return M.list end
  local list = {}
  if type(DATA.stages) == 'table' then
    for _, e in ipairs(DATA.stages) do
      local ok = true
      if main and type(main.f_fileExists) == 'function' then ok = main.f_fileExists(e.path) and true or false end
      if ok then list[#list + 1] = e end
    end
  end
  M.list = list
  if LOG then
    local n = {}
    for i, e in ipairs(list) do n[#n + 1] = i .. '=' .. e.path end
    print('[hgallery] maps ' .. #list .. ' of ' .. tostring(type(DATA.stages) == 'table' and #DATA.stages or 0) .. ': ' .. table.concat(n, ' | '))
  end
  return list
end
-- The one playing: the pick, else the data's stage.
function UI.mapCur()
  local list = UI.mapList()
  if K.map and list[K.map] then return K.map end
  local want = string.lower(DATA.stage or '')
  for i, e in ipairs(list) do if string.lower(e.path) == want then return i end end
  return 1
end
-- The select path the next match plays on.
function UI.mapPath()
  local list = UI.mapList()
  local e = K.map and list[K.map]
  return e and e.path or DATA.stage
end
function UI.mapName(e) return string.upper(e and e.name or '?') end
-- Opened (HGalleryMaps): the cursor on the stage playing, its page.
function UI.mpOpen()
  local P, M = UI.pk, UI.mp
  M.cur, M.lk, M.L = UI.mapCur(), nil, nil
  PK.gtop = 0
  P.was = UI.mouseOn() and UI.mouseHeld() or false
  P.rwas = UI.pkRight()
  P.hold, P.over, P.fid, P.ft, P.ck, P.sck, P.lk, P.first = nil, nil, nil, 0, nil, nil, nil, true
end
function HGalleryMaps()
  if not ACTIVE or UI.hud.exit then return end
  if PK.open then return pickerClose() end
  if #UI.mapList() < 2 then return end
  useSlot(SEL)
  PK.msgT = 0
  PK.maps = true
  UI.mpOpen()
  -- (Paused as the pair picker pauses: the fight waits behind it.)
  PK.keepPaused = paused() and not PK.release
  PK.release = false
  PK.open = true
  togglePause(true)
  resetKey()
  controls()
  if LOG then print('[hgallery] maps open: ' .. #UI.mapList() .. ' maps, playing ' .. UI.mapCur()) end
end
-- The tiles: cols x vis (5) from the top row; 3 columns on a wide screen
-- (16:9), else 2. The page rail only when there is more than a page.
function UI.mpLayout()
  local M = UI.mp
  local gw = UI.hud.gwi
  local list = UI.mapList()
  local n = #list
  local cols = (gw >= 400) and 3 or 2
  local vis = 5
  local rowsN = math.ceil(n / cols)
  local maxTop = math.max(0, rowsN - vis)
  M.cur = math.max(1, math.min(n, M.cur))
  local crow = math.floor((M.cur - 1) / cols)
  if crow < PK.gtop then PK.gtop = crow elseif crow > PK.gtop + vis - 1 then PK.gtop = crow - vis + 1 end
  PK.gtop = math.max(0, math.min(maxTop, PK.gtop))
  local key = gw .. '|' .. PK.gtop .. '|' .. M.cur .. '|' .. tostring(K.map) .. '|' .. n
  if M.lk == key and M.L then return M.L end
  local npg = math.max(1, math.ceil(rowsN / vis))
  local L = { gw = gw, cols = cols, vis = vis, n = n, npg = npg, maxTop = maxTop, tiles = {}, btns = {}, rail = {}, gy = 52,
    page = (maxTop > 0) and (math.floor(PK.gtop / maxTop * (npg - 1) + 0.5) + 1) or 1 }
  L.pgs = L.page .. '/' .. npg
  L.btns[#L.btns + 1] = { id = 'cl', kind = 'close', x1 = gw - 40, y1 = 3, x2 = gw - 4, y2 = 31 }
  local avail = gw - 8 - ((npg > 1) and 30 or 0)
  local tw = math.floor((avail - (cols - 1) * 4) / cols)
  if npg > 1 then
    L.btns[#L.btns + 1] = { id = 'pu', kind = 'pg', d = -1, x1 = gw - 30, y1 = 52, x2 = gw - 4, y2 = 88, dim = PK.gtop <= 0 }
    L.btns[#L.btns + 1] = { id = 'pd', kind = 'pg', d = 1, x1 = gw - 30, y1 = 166, x2 = gw - 4, y2 = 202, dim = PK.gtop >= maxTop }
    L.btns[#L.btns + 1] = { id = 'tr', kind = 'track', x1 = gw - 30, y1 = 90, x2 = gw - 4, y2 = 164 }
  end
  local cur = UI.mapCur()
  for v = 1, vis * cols do
    local i = PK.gtop * cols + v
    if i > n then break end
    local x, y = 4 + ((v - 1) % cols) * (tw + 4), 52 + math.floor((v - 1) / cols) * 30
    L.tiles[#L.tiles + 1] = { id = 'm' .. i, kind = 'tile', i = i, v = v, x1 = x, y1 = y, x2 = x + tw, y2 = y + 26, name = UI.mapName(list[i]), now = i == cur }
  end
  M.L, M.lk = L, key
  if LOG then
    local s = {}
    for _, t in ipairs(L.tiles) do s[#s + 1] = t.id .. ':' .. t.x1 .. ',' .. t.y1 .. '-' .. t.x2 .. ',' .. t.y2 .. '=' .. string.gsub(t.name, '%s', '_') .. (t.now and '@1' or '') end
    for _, b in ipairs(L.btns) do s[#s + 1] = b.id .. ':' .. b.x1 .. ',' .. b.y1 .. '-' .. b.x2 .. ',' .. b.y2 end
    print('[hgallery] maps layout ' .. gw .. 'x240 cols=' .. cols .. ' page=' .. L.pgs .. ' n=' .. n .. ' cur=' .. M.cur .. ' ' .. table.concat(s, ' '))
  end
  return L
end
function UI.mpHit(L, x, y)
  if L == nil or x == nil or y == nil then return nil end
  for _, set in ipairs({ L.btns, L.tiles }) do
    for _, b in ipairs(set) do
      if x >= b.x1 and x < b.x2 and y >= b.y1 and y < b.y2 then return b end
    end
  end
  return nil
end
-- The tiles scrolled by d rows (the cursor left where it is).
function UI.mpScroll(d)
  local L = UI.mpLayout()
  local t = math.max(0, math.min(L.maxTop, PK.gtop + d))
  if t ~= PK.gtop then
    -- (The cursor goes with the rows - else the layout would bring the view back to it.)
    local M = UI.mp
    M.cur = math.max(1, math.min(L.n, M.cur + (t - PK.gtop) * L.cols))
    PK.gtop = t
    if LOG then print('[hgallery] maps scroll ' .. d .. ': top row ' .. t .. ' of ' .. L.maxTop .. ', cursor ' .. M.cur) end
  end
end
-- Pick stage i: the one playing only closes it; any other loads the
-- gallery again on it (the same fade a pair's change plays).
function UI.mpPick(i)
  local list = UI.mapList()
  local e = list[i]
  if e == nil then return end
  if i == UI.mapCur() then
    PK.msg, PK.msgT = 'THAT MAP IS PLAYING ALREADY', 150
    if LOG then print('[hgallery] maps pick ' .. i .. ': playing already') end
    return
  end
  if CMD ~= nil then return end
  if LOG then print('[hgallery] maps pick ' .. i .. ' ' .. e.name .. ' (' .. e.path .. ')') end
  K.map = i
  reload({ what = 'map' })
end
function UI.mpAct(t)
  if t.dim then return end
  if t.kind == 'tile' then UI.mpM(t.i); return UI.mpPick(t.i)
  elseif t.kind == 'close' then return pickerClose()
  elseif t.kind == 'pg' then return UI.mpScroll(t.d * UI.mp.vis)
  end
end
function UI.mpM(i) UI.mp.cur = i end
function UI.mpKeys()
  local M = UI.mp
  local k = getKey()
  if k ~= '' then resetKey() end
  local up, dn, lf, rt = hit('U'), hit('D'), hit('L'), hit('R')
  local ok, back = hit('s') or hit('a'), hit('b') or k == 'BACKSPACE'
  local L = UI.mpLayout()
  local cols, n = L.cols, L.n
  if k == 'PAGEUP' or k == 'PAGEDOWN' then
    local d = (k == 'PAGEUP') and -1 or 1
    M.cur = math.max(1, math.min(n, M.cur + d * L.vis * cols))
    if LOG then print('[hgallery] maps page ' .. d .. ' cursor ' .. M.cur) end
    return
  end
  if back then return pickerClose() end
  if ok then return UI.mpPick(M.cur) end
  if lf then M.cur = ((M.cur - 2) % n) + 1
  elseif rt then M.cur = (M.cur % n) + 1
  elseif up then M.cur = (M.cur - cols < 1) and math.min(n, M.cur + math.floor((n - M.cur) / cols) * cols) or (M.cur - cols)
  elseif dn then M.cur = (M.cur + cols > n) and (((M.cur - 1) % cols) + 1) or (M.cur + cols)
  else return end
  if LOG then print('[hgallery] maps cursor ' .. M.cur) end
end
function UI.mpPointer()
  local P = UI.pk
  if not (UI.mouseOn() and type(mouseTake) == 'function') then return end
  local L = UI.mpLayout()
  local gw, gh = UI.hud.gw, UI.hud.gh
  local held = UI.mouseHeld()
  local press, rel = held and not P.was, P.was and not held
  P.was = held
  local moved = type(mouseMoved) == 'function' and mouseMoved()
  if press or rel or held or moved or P.px == nil then P.px, P.py = UI.pointerX(gw, gh), UI.pointerY(gw, gh) end
  if moved and not held then P.hov, P.mouse = true, true elseif press then P.hov = false end
  local over = UI.mpHit(L, P.px, P.py)
  P.over = over
  if type(inputDeviceActionTime) == 'function' and P.py and not held then
    local d = ((tonumber(inputDeviceActionTime(0, P.WD)) or 0) > 0 and 1) or ((tonumber(inputDeviceActionTime(0, P.WU)) or 0) > 0 and -1) or 0
    if d ~= 0 then
      if LOG then print(string.format('[hgallery] maps wheel %d at %.1f,%.1f', d, P.px or -1, P.py)) end
      UI.mpScroll(d)
    end
  end
  if press then
    if LOG then print(string.format('[hgallery] maps pointer down at %.1f,%.1f on %s', P.px or -1, P.py or -1, over and over.id or 'nothing')) end
    if over and mouseTake(P.TL) then P.hold, P.long, P.holdT = over.id, false, 0 end
  elseif P.hold and not held then
    local id = P.hold
    P.hold = nil
    if over and over.id == id then
      P.fid, P.ft = id, 8
      if LOG then print('[hgallery] maps tap ' .. id .. (over.dim and ' (dim)' or '')) end
      UI.mpAct(over)
    elseif LOG then print('[hgallery] maps cancel ' .. id .. ' (let go off it)') end
  end
end
-- One tile: glass with the name; the one playing in a gold frame with NOW,
-- the keys' cursor a pulsing white frame.
function UI.mpTile(t, a)
  local P, C = UI.pk, UI.hc
  local rs, ts = UI.pkSet('mt' .. t.v)
  local st = UI.pkState(t)
  -- (A backing near solid, as the pair picker's tiles have, so a bright stage never washes the name out.)
  if st ~= 'down' then UI.hr(rs, 21, t.x1, t.y1, t.x2, t.y2, C.INK, 0.85 * a) end
  local x1, y1, x2, y2, ink, ia = UI.pkGlass(rs, t, t.now and C.GOLD or C.GREEN, st, a, 'l')
  if t.now and st ~= 'down' then UI.hframe(rs, 20, x1, y1, x2, y2, 2, C.GOLD, a) end
  local room = (x2 - x1) - 14 - (t.now and (UI.hw('NOW') + 8) or 0)
  UI.ht(ts, 1, UI.hcut(t.name, room), x1 + 8, y1 + 17, ink, ia * a, 1)
  if t.now then UI.ht(ts, 2, 'NOW', x2 - 5, y1 + 17, (st == 'down') and ink or C.GOLD, a, -1) end
end
function UI.mpDraw()
  local C = UI.hc
  local L = UI.mpLayout()
  local M = UI.mp
  local P = UI.pk
  local fw = UI.hud.gw
  local a = math.min(1, PK.t / 6)
  local rs, ts = UI.pkSet('mbase')
  UI.hr(rs, 1, 0, 0, fw, 240, C.BLACK, 0.55 * a)
  -- (The pair picker's bands: header 0-33, info 34-48, footer from 205.)
  UI.hr(rs, 2, 0, 0, fw, 33, C.INK, 0.98 * a)
  UI.hr(rs, 3, 0, 33, fw, 34, C.GOLD, 0.45 * a)
  UI.hr(rs, 4, 0, 34, fw, 48, C.INK, 0.98 * a)
  UI.hr(rs, 5, 0, 205, fw, 240, C.INK, 0.98 * a)
  UI.hr(rs, 6, 0, 205, fw, 206, C.GOLD, 0.45 * a)
  UI.ht(ts, 1, 'MAP', 8, 21, C.GOLD, a, 1)
  UI.ht(ts, 2, UI.mapCur() .. '/' .. L.n, 8 + UI.hw('MAP') + 10, 21, C.SOFT, a, 1)
  for _, b in ipairs(L.btns) do UI.pkBtn(b, L, a) end
  for _, t in ipairs(L.tiles) do UI.mpTile(t, a) end
  -- The keys' cursor.
  local rc = UI.pkSet('mcur')
  local p = 0.7 + 0.3 * math.sin(PK.t * 6.2832 / 40)
  for _, t in ipairs(L.tiles) do
    if t.i == M.cur then
      UI.hframe(rc, 1, t.x1 - 3, t.y1 - 3, t.x2 + 3, t.y2 + 3, 1, C.BLACK, 0.8 * a)
      UI.hframe(rc, 5, t.x1 - 2, t.y1 - 2, t.x2 + 2, t.y2 + 2, 2, C.WHITE, ((P.hov and P.mouse) and 0.45 or p) * a)
    end
  end
  -- The info line: the stage under the pointer (else the cursor's), and the
  -- way to pick.
  local list = UI.mapList()
  local o = P.hov and P.over and P.over.kind == 'tile' and P.over.i or M.cur
  local e = list[o]
  local right = UI.hud.ma and 'TAP A MAP TO PLAY ON IT' or 'ENTER PICKS  TAB CLOSES'
  if UI.hw(right) > fw * 0.45 then right = 'ENTER PICKS' end
  local left = UI.mapName(e) .. ((o == UI.mapCur()) and '  (NOW)' or '')
  left = UI.hcut(left, fw - 20 - UI.hw(right))
  local ri = UI.pkSet('minfo')
  local rsi, tsi = ri, P.ts['minfo']
  UI.ht(tsi, 1, left, 4, 44, C.PAPER, a, 1)
  UI.ht(tsi, 2, right, fw - 4, 44, C.DIM, a, -1)
  -- The footer: what stays, or a note.
  local rf, tf = UI.pkSet('mfoot')
  if PK.msgT > 0 then UI.ht(tf, 1, UI.hcut(PK.msg, fw - 12), 4, 226, C.GOLD, a, 1)
  else UI.ht(tf, 1, UI.hcut('THE PAIRS, THEIR PLACES AND THE ZOOM STAY', fw - 12), 4, 226, C.SOFT, a, 1) end
end
-- Every frame while it is open (pickerTick): the keys, the pointer, then
-- the drawing. (Under -hgallerylog: its cost, into the HUD's cost line, and
-- the first frame's alone.)
function UI.pkFrame()
  local P = UI.pk
  local clock = LOG and type(os) == 'table' and type(os.clock) == 'function'
  local c0 = clock and os.clock() or 0
  local made, seek = P.made, P.seek
  if P.ft > 0 then P.ft = P.ft - 1 end
  if PK.msgT > 0 then PK.msgT = PK.msgT - 1 end
  -- (The first frame searches no disk: it already builds the layout.)
  local first = P.first
  P.first = false
  P.budget, P.disk = 6, first and 0 or 1
  if PK.maps then UI.mpKeys() else UI.pkKeys() end
  if PK.open then if PK.maps then UI.mpPointer() else UI.pkPointer() end end
  if PK.open then if PK.maps then UI.mpDraw() else UI.pkDraw() end end
  if clock then
    local dt = os.clock() - c0
    local C = UI.hud.cost
    C.pk, C.pkn = (C.pk or 0) + dt, (C.pkn or 0) + 1
    if first then
      local L = P.L
      print(string.format('[hgallery] picker first frame %.1f us (open to drawn %.1f us): %d icons made, view %d of %d (page %d/%d, %d givers, %d pairs)', dt * 1e6,
        P.t0 and (os.clock() - P.t0) * 1e6 or -1, P.made - made, L and #L.tiles or 0, L and L.n or 0, L and L.page or 0, L and L.npg or 0, #pickerGivers(), #DATA.pairs))
    elseif dt > 0.004 then
      -- (A frame over 4 ms: its cost, for the paging proof.)
      print(string.format('[hgallery] picker slow frame %.1f us: %d icons made, %d looked up', dt * 1e6, P.made - made, P.seek - seek))
    end
  end
end

` : ''}hook.add('loop#hgallery', 'hgallery', function()
  local ok, err = pcall(function()
    if not ACTIVE then return end
    LOOPF = LOOPF + 1
    if MSG.t > 0 then MSG.t = MSG.t - 1 end
${v2 ? '    if UI.font == nil then UI.font = UI.hudFont() end\n' : ''}    tickMatch()
    camTick()
    for k = 1, NSLOT do useSlot(k); tickSlot() end
    useSlot(SEL)
    -- (The overlay also where the active step's prototype mode plays outside
    -- round state 2.)
    if roundState() == 2 or MODE.liveOf(curStep()) then
      if HINT then HINT = false; if HIDE then tell(${v2 ? "'controls hidden: SHOW or Insert'" : "'Insert shows the overlay'"}, 120) end end
      watch()
      markers()
${v2 ? '' : '      overlay()\n'}    end
${v2 ? '    UI.hudFrame()\n' : ''}    pickerRelease()
    pickerTick()
    controls()
    inputWatch()
  end)
  if not ok then
    print('H gallery: ' .. tostring(err))
    ACTIVE = false
    if PK.open or PK.release then PK.open, PK.release = false, false; togglePause(false) end
    setAccel(1)
    if toggleNoSound then toggleNoSound(false) end
    controlsBack()
  end
end)

${modeLua}-- ---- the mode ---------------------------------------------------------------
local function run()
  ACTIVE, CMD, HINT = true, nil, HIDE
${v2 ? '  UI.hud.exit, UI.hud.armT = false, 0\n' : ''}  -- Every key is taken when the mode starts and acts only in the gallery
  -- mode: a key keeps only its last binding (one per key and modifiers), and
  -- a later one would replace an earlier one. Tab opens the picker: the Scene
  -- Viewer mod (loaded after this file) binds it too, and gets it outside the
  -- gallery. Space is the engine's debug key (debug.lua), given back as it
  -- was when the gallery is left. None of them is a key of P1's; the arrows
  -- are P2's, and P2 is off here.
  addHotkey('TAB', false, false, false, true, false, 'if gameMode() == "hgallery" then HGalleryPicker() elseif SceneViewerCycle then SceneViewerCycle() end')
  local function take(key, call, shift) addHotkey(key, false, false, shift == true, true, false, 'if gameMode() == "hgallery" then ' .. call .. ' end') end
  for _, key in ipairs({ 'LEFT', 'RIGHT', 'UP', 'DOWN', 'END', 'SPACE', 'HOME' }) do take(key, 'HGalleryNav("' .. key .. '")') end
  -- + / - the zoom: = (the + key without Shift), -, the keypad's + and -
  -- (the engine's own are Ctrl+keypad, a binding of their own), and + typed
  -- with Shift on the = key.
  for _, z in ipairs({ { 'EQUALS', 1 }, { 'KP_PLUS', 1 }, { 'MINUS', -1 }, { 'KP_MINUS', -1 } }) do take(z[1], 'HGalleryZoom(' .. z[2] .. ', "' .. z[1] .. '")') end
  take('EQUALS', 'HGalleryZoom(1, "EQUALS")', true)
  take('DELETE', 'HGalleryDelete()')
  take('INSERT', 'HGalleryInsert()')
  take('h', 'HGalleryOverlay()')
${v2 ? `  -- / (and ? on it, with Shift): the keys' help, opened and closed.
  take('SLASH', 'HGalleryHelp()')
  take('SLASH', 'HGalleryHelp()', true)
` : ''}  take('PAGEUP', 'HGalleryPair(-1)')
  take('PAGEDOWN', 'HGalleryPair(1)')
  for k = 1, MAX_SLOTS do take(tostring(k), 'HGallerySlot(' .. k .. ')') end
  -- (Tests: [ and ] step through the pair's steps in the data's order.)
  if LOG then take('LBRACKET', 'HGalleryScene(-1)'); take('RBRACKET', 'HGalleryScene(1)') end
${v2 ? `  -- (Tests: backslash turns the bars off and on: the controls go back in
  -- the picture, as on an engine without uiWindowSpace.)
  if LOG then take('BACKSLASH', 'HGalleryBarsTest()') end
` : ''}  -- (A new visit: every pair at its slot again, nothing dragged.)
  for _, L in ipairs(LOAD) do L.si, L.fresh, L.dx = 1, nil, nil end
  if SEL > #LOAD then SEL = 1 end
  -- The pair each place held last match: the same pair in the same place
  -- keeps its two characters loaded (existed=1: not loaded or compiled again).
  local before = {}
  local stage = (DATA.stage ~= '' and start.f_getStageRef(DATA.stage)) or nil
${v2 ? `  -- No side select: the local inputs are assigned as upstream's quick versus
  -- does (one player a side), before remapInput below gives each fighter his
  -- controls; the menus get every device back when the gallery is left
  -- (main.f_default).
  if type(inputAutoAssign) == 'function' and type(inputBegin) == 'function' then
    inputAutoAssign(inputBegin(), 1, 1, true)
  end
` : ''}  while true do
    local n = #LOAD
    clearSelected()
    resetGameParams()
    -- Both sides are players, as in versus and training: P1's side is the
    -- home team. main.f_default leaves it at 2, the arcade CPU's side, and a
    -- character that reads IsHomeTeam on the right at round start takes
    -- itself for the CPU and fights (Yoko's var(59)).
    setHomeTeam(1)
    -- One pair: one a side. Several: Simul teams, pair k = giver P(2k-1) on
    -- side 1 and receiver P(2k) on side 2. Nobody is played by the AI.
    local tm = (n > 1) and 1 or 0
    for side = 1, 2 do
      start.p[side].teamMode, start.p[side].numChars, start.p[side].turnsOffset = tm, n, 0
      start.p[side].t_selected, start.p[side].t_selTemp = {}, {}
      setTeamMode(side, tm, n)
    end
    for pn = 1, 8 do setCom(pn, 0) end
    SLOTS = {}
    local kept, names = false, {}
    for k, L in ipairs(LOAD) do
      local p = DATA.pairs[L.pi]
      local keep = before[k] == L.pi and not L.fresh
      kept = kept or keep
      local g, r = start.f_getCharRef(p.giver.select), start.f_getCharRef(p.receiver.select)
      selectChar(1, g, 1, keep and ('p1.' .. k .. '.existed=1') or nil)
      table.insert(start.p[1].t_selected, { ref = g, pal = 1, pn = 2 * k - 1 })
      -- A MIRROR PAIR (one character on both sides): P2 takes the next free
      -- palette, as the engine's own select screen gives a mirror match
      -- (start.f_selectPal over what is already selected); anyone else 1.
      local rp = 1
      if r == g then
        local ok, v = pcall(start.f_selectPal, r, 1)
        if ok and tonumber(v) then rp = tonumber(v) end
        if LOG then print('[hgallery] [' .. k .. '] mirror pair: P2 palette ' .. rp) end
      end
      selectChar(2, r, rp, keep and ('p2.' .. k .. '.existed=1') or nil)
      table.insert(start.p[2].t_selected, { ref = r, pal = rp, pn = 2 * k })
      local c = newG()
      c.k, c.pi, c.phase = k, L.pi, 'start'
      -- Where the mouse left it, while as many pairs are on screen (a pair
      -- added or taken off makes new slots: every pair at its own again).
      if L.dxn == n then c.dx = L.dx or 0 end
      c.si = (L.si and L.si >= 1 and L.si <= #p.steps) and L.si or 1
      SLOTS[k] = c
      names[#names + 1] = '[' .. k .. '] pair ' .. L.pi .. '/' .. #DATA.pairs .. ' ' .. p.giver.select .. ' x ' .. p.receiver.select
        .. ' at scene ' .. c.si .. (keep and ' kept' or '')
    end
    NSLOT = n
    if SEL > n then SEL = n end
    useSlot(SEL)
    -- The zoom kept where these pairs have its level, else the closest one
    -- below it (one pair: none); the camera is asked again at round state 2.
    if n < 2 then ZL = 0
    elseif ZL ~= 0 then
      local keep = 0
      for _, z in ipairs(zoomLevels()) do if z <= ZL then keep = z end end
      ZL = keep
    end
    CAM, STAGE = { key = nil, free = false, still = 0, fv = {} }, {}
    UI.drag.k, UI.drag.after = nil, -1
    start.f_setRounds(-1, {})
${v2 ? `    -- (The map: the one picked with the MAP tile, else the data's; asked
    -- every match, so a pick plays from the next.)
    local sp = UI.mapPath()
    stage = (sp ~= '' and start.f_getStageRef(sp)) or nil
    if LOG then print('[hgallery] map ' .. tostring(sp)) end
` : ''}    if stage then start.f_setStage(stage, true) else start.f_setStage() end
    CMD = nil
    -- A match that brings pairs back (or has several): fast until each shows
    -- again, intros cut (tickMatch; every match purges what intros left).
    MATCH = { f = 0, speed = kept or n > 1, restored = not (kept or n > 1), rs2 = false }
    WATCH = { own = {}, nt = {} }
    -- New characters: the controls and the AI are set again. The wiring is
    -- applied before the match too: its first frame reads input before the
    -- loop's first tick, and after the title menu every control is its own.
    CTL, HELD = '', {}
    for pn = 1, 2 * MAX_SLOTS do remapInput(pn, wiredTo(pn)) end
    if LOG then
      if n == 1 then
        local p = DATA.pairs[LOAD[1].pi]
        print('[hgallery] load pair ' .. LOAD[1].pi .. '/' .. #DATA.pairs .. ' ' .. p.giver.select .. ' x ' .. p.receiver.select
          .. (SLOTS[1].si ~= 1 and (' at scene ' .. SLOTS[1].si) or '') .. (kept and ' kept' or ''))
      else
        print('[hgallery] load ' .. n .. ' pairs: ' .. table.concat(names, ' | '))
      end
      if HIDE then print('[hgallery] overlay stays hidden') end
    end
    -- Every prototype mode, before the match loads (LOAD: its pairs).
    MODE.each('match', LOAD)
    loadStart(start.f_buildLoadStartParams())
    local won = game()
    refresh()
    setAccel(1)
    if toggleNoSound then toggleNoSound(false) end
    -- Esc with the picker open: the fight is not left paused.
    if PK.open or PK.release then
      if not PK.keepPaused then togglePause(false) end
      PK.open, PK.release = false, false
    end
    -- A match that ended by itself (game() is -1 when Esc or a reload ended
    -- it): a prototype mode may ask for it again ({ what = 'again' }: a
    -- replay after the match).
    if CMD == nil and won ~= -1${v2 ? ' and not UI.hud.exit' : ''} then
      local again = MODE.call('after', won)
      if type(again) == 'table' and again.what == 'again' then CMD = again end
    end
    if CMD == nil then break end
    before = {}
    for k, L in ipairs(LOAD) do
      before[k] = L.pi
      L.si, L.fresh = SLOTS[k].si, nil
      L.dx, L.dxn = SLOTS[k].dx, NSLOT
      LAST[L.pi] = SLOTS[k].si
    end
    if CMD.what == 'pair' then
      LOAD[CMD.k] = { pi = CMD.pi, si = CMD.si or 1, fresh = true }
    elseif CMD.what == 'add' and #LOAD < MAX_SLOTS then
      table.insert(LOAD, { pi = CMD.pi, si = CMD.si or 1 })
      SEL = #LOAD
    elseif CMD.what == 'del' and #LOAD > 1 then
      table.remove(LOAD, CMD.k)
      if SEL > #LOAD then SEL = #LOAD end
${v2 ? `    elseif CMD.what == 'map' then
      -- (The same pairs again on the map picked: kept, each at its scene.)
      if LOG then print('[hgallery] map change: the match is loaded again') end
` : ''}    elseif CMD.what == 'again' then
      -- (The same pairs again, kept, each at the scene it was at.)
      if LOG then print('[hgallery] again: the match is loaded again') end
    end
  end
  ACTIVE = false
  -- Every player's own controls again (versus and training after this), and
  -- the engine's own Space.
  controlsBack()
  addHotkey('SPACE', false, false, false, false, true, SPACE_DEBUG)
  if LOG then
    local m = {}
    for pn = 1, 2 * MAX_SLOTS do m[#m + 1] = tostring(getRemapInput(pn)) end
    print('[hgallery] left remap=' .. table.concat(m, ','))
  end
  for k = 1, NSLOT do SLOTS[k].phase = 'idle' end
  bgReset(motif[main.background].BGDef)
  playBgm({ source = 'motif.title', interrupt = true })
  fadeInInit(motif[main.group].fadein.FadeData)
end

main.t_itemname.hgallery = function(t, item)
  main.pauseMenu = false
  setGameMode('hgallery')
  hook.run('main.t_itemname', t, item)
  return run
end
main.f_appendItemname(motif.title_info.menu, '', 'hgallery', 'H GALLERY', 'options')
${v2 ? `-- The line the engine draws under the title menu for the highlighted item
-- (menu.hint.text.<item>), unless the screenpack wrote one.
do
  local h = motif.title_info.menu.hint
  if type(h) == 'table' and type(h.text) == 'table' and h.text.hgallery == nil then
    h.text.hgallery = 'Watch the scenes of the character pairs in this build.'
  end
end
` : ''}
-- -hgallery on the command line opens the gallery straight
-- from the title: "1" at the first pair, or "<giver def>|<receiver def>".
-- (In a function of its own: its loop's temporaries, on top of every
-- top-level local, were the main chunk's widest point.)
do
  local function autostart()
    local want = getCommandLineValue('-hgallery')
    if want ~= nil then
      for i, p in ipairs(DATA.pairs) do
        -- (A pair whose receiver is a helper: "<giver>|<receiver>|<helper id>".)
        local name = p.giver.select .. '|' .. p.receiver.select .. (p.receiver.helper and ('|' .. p.receiver.helper.id) or '')
        if name:lower() == tostring(want):lower() then LOAD[1].pi = i end
      end
      local once = false
      hook.add('main.menu.loop', 'hgallery-autostart', function()
        if once then return end
        once = true
        main.f_default()
        local f = main.t_itemname.hgallery({}, 1)
        if f then f() end
        main.f_default()
      end)
    end
  end
  autostart()
end
`;
}

// The build's gallery files, or null when there is nothing to show: no H in
// the roster, or no pair with a scene that renders. `data` is gallerydata.js's
// output; `stage` the select path of the stage the gallery uses; `modes` the
// prototype modes that are on (gallerymodes/index.js). A mode that fails -
// a hook that throws, a chunk or a line the files cannot carry - is left
// out with a warning and the files are made again without it: never a
// broken gallery for a broken prototype.
function buildGalleryFiles(data, stage, modes, opts) {
  let use = [...modeMap(modes).values()];
  let trimmed = null;
  for (;;) {
    trimmed = trimData(data, stage, use);
    let bad = trimmed.failed[0] || null;
    if (!bad) { const mp = modeParts(trimmed, use); if (mp.bad) bad = mp.bad; }
    if (!bad) break;
    console.warn('H gallery: mode ' + bad.id + ' is off: ' + bad.why);
    use = use.filter((M) => M.id !== bad.id);
  }
  if (!trimmed.pairs.length) return null;
  return {
    lua: Buffer.from(buildGalleryLua(trimmed, use, opts), 'latin1'),
    // Its font, for the modern-input text's on-screen controls (that text only).
    font: (opts && opts.v2 !== undefined ? !!opts.v2 : !!process.env.IKEMEN_V2) ? Buffer.from(galleryFontDef(), 'latin1') : null,
    // latin1: a command name is the .cmd's own bytes (Shift-JIS names too).
    zss: Buffer.from(buildGalleryZss(trimmed, use, opts), 'latin1'),
    pairs: trimmed.pairs.length,
    steps: trimmed.pairs.reduce((n, p) => n + p.steps.length, 0),
    commands: trimmed.commands.length,
    dropped: trimmed.dropped,
    modes: trimmed.modes,
  };
}

// The same for the current roster: gallerydata.js over it, with the build's
// first stage and the prototype modes its Mods tab has on. Null whenever
// anything is missing - the build then simply has no gallery, and never a
// broken one. A failure says why in the server's log: the caller's own
// warning (vfslib) fires only when this throws, which it never does.
function buildForRoster(roster) {
  let modes = [];
  try { modes = require('./gallerymodes').enabled(roster); } catch (e) { modes = []; }
  let data = null;
  try {
    const gd = require('./gallerydata.js');
    data = gd.buildGalleryData({ roster, modes, persist: true });
  } catch (e) {
    console.warn('H gallery: ' + (e && e.message));
    return null;
  }
  const first = roster && roster.stages && roster.stages[0];
  const stage = first ? 'stages/' + String(first.file || '').replace(/^stages\//i, '') : '';
  // Every stage of the build, for the MAP tile: its select path and a name
  // the 6x9 font can draw (ASCII; the stage's own name, else its file).
  const stages = [];
  for (const x of (roster && roster.stages) || []) {
    const file = String((x && x.file) || '').replace(/^stages\//i, '');
    if (!file) continue;
    const name = String((x && x.name) || '').replace(/[^ -~]/g, '?').trim() || file.replace(/\.def$/i, '').replace(/[^ -~]/g, '?');
    stages.push({ name, path: 'stages/' + file });
  }
  let hud = null;
  try { hud = hudScan(roster, data); } catch (e) { console.warn('H gallery: HUD explods not read: ' + (e && e.message)); hud = null; }
  try {
    return buildGalleryFiles(data, stage, modes, { hud: hud || undefined, stages: stages.length > 1 ? stages : undefined });
  } catch (e) {
    console.warn('H gallery: ' + (e && e.message));
    return null;
  }
}

// The HUD explods of every character on a pair (galhud.js), for the hook: a
// giver's ids that also name an explod in a state his steps show (a cut-in
// of a scene) are kept. Each character's list is logged once per build.
function hudScan(roster, data) {
  const gd = require('./gallerydata.js');
  const galhud = require('./galhud.js');
  const chars = gd.rosterChars(roster, require('./layout.js').dir('cache'));
  const bySel = new Map(chars.map((c) => [c.select, c]));
  const shown = new Map();
  const nums = (v, set) => {
    if (Number.isInteger(v)) set.add(v);
    else if (Array.isArray(v)) v.forEach((x) => nums(x, set));
    else if (v && typeof v === 'object') for (const k of ['entry', 'states', 'until', 'at', 'path']) if (k in v) nums(v[k], set);
  };
  const order = [];
  for (const p of (data && data.pairs) || []) {
    for (const who of [p.giver, p.receiver]) if (who && who.select && !order.includes(who.select)) order.push(who.select);
    if (p.giver && p.giver.select) {
      if (!shown.has(p.giver.select)) shown.set(p.giver.select, new Set());
      for (const st of p.steps || []) nums(st, shown.get(p.giver.select));
    }
  }
  const list = [];
  for (const sel of order) {
    const c = bySel.get(sel);
    if (!c) continue;
    const r = galhud.hudExplods(c.dir, c.def, shown.get(sel));
    if (!r.ids.length && !r.kept.length) continue;
    console.log('H gallery: HUD explods of ' + sel + ': hidden ' + (r.ids.join(',') || 'none') +
      (r.both.length ? '; also in its other states (hidden there too) ' + r.both.join(',') : '') +
      (r.kept.length ? '; kept (in a scene it shows) ' + r.kept.join(',') : '') +
      (r.noId ? '; ' + r.noId + ' with no id (left)' : ''));
    if (r.ids.length) list.push({ select: sel, ids: r.ids });
  }
  return { list };
}

module.exports = {
  GALLERY_LUA_VPATH, GALLERY_ZSS_VPATH, GALLERY_FONT_VPATH, GALLERY_STATES_KEY, MAX_SETUP, MAX_SETS, DEFAULT_PATIENCE, galleryFontDef,
  buildGalleryLua, buildGalleryZss, buildGalleryFiles, buildForRoster, trimData, toLua, hudList, hudScan,
};
