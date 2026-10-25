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
    // (A stage is named as its label names it: the level of his finish
    // count, of the position's top one.)
    if (pos.stages.length > 1) parts.push('Home stage ' + (n.stage ? n.stage : 'base') + '/' + pos.stages[pos.stages.length - 1]);
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
    pairs.push(pair);
  }
  // The modes this build carries: those with a step or an action kept, in
  // their order; each one's data object.
  const present = [...by.keys()].filter((id) => !failed.has(id) && pairs.some((p) => p.steps.some((s) => s.ext === id || s.path.some((a) => a.ext === id))));
  return { stage: stage || '', pairs, commands, cmdAliases, setupSlots, setSlots, kills: kills.sort((a, b) => a - b), dropped, helpers: helpers.sort((a, b) => a - b),
    modes: present, modeData: Object.fromEntries(present.map((id) => [id, modeData[id] || {}])), failed: [...failed].map(([id, why]) => ({ id, why })),
    helperHides: [...helperHides].sort((a, b) => a[0] - b[0]).map(([id, ids]) => ({ id, ids: [...ids].sort((a, b) => a - b) })),
    badgeSets: badgeSets.map((x) => ({ id: x.id, sets: x.sets })),
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
function buildGalleryZss(t, modes) {
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
function buildGalleryLua(data, modes) {
  const DATA = { stage: data.stage, setupSlots: data.setupSlots || 0, setSlots: data.setSlots || 0, introMax: INTRO_MAX, pairs: data.pairs };
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
--   Home                  the next stage
--   Page Down / Page Up   next / previous pair, in the active pair's place
--   1 - 4                 which pair on screen is the active one
--   + / -                 zoom in / out on the active pair (several pairs:
--                         = or Shift+=, -, and the keypad's + and -)
--   Tab                   the pair picker (the fight waits behind it)
--   Insert                hides the overlay and the markers, and shows them
--                         (H too; in the picker Insert adds a pair)
--   Esc                   leave the gallery
-- The arrow keys are P2's, and P2 is off here: no receiver takes a player's
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
    entry = nil, fresh = true, ai = 0, slot = 0, sustain = 0, sustained = {}, held = nil, before = {}, off = 0,
    lastRecv = -1, lastRecvTime = 0, recvAt = 0, jumpReady = true, lastJump = -100, lastSt = -1,
    shown = false, dwellF = 0, dwellIn = 0, mash = 0 }
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
    local c = (G.k - (NSLOT + 1) / 2) * SPACING
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
    -- takes the camera out), in each character's own units.
    local c = (G.k - (NSLOT + 1) / 2) * SPACING
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
    return { screenPosX() * z, (screenPosY() - posY() * ls + cy) * z - cy }
  end)
end
local function markers()
  if NSLOT < 2 or HIDE then return end
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
      mbox('l' .. k, gw, gh, cx - w / 2, ly, cx + w / 2, ly + (act and 3 or 2), c, act and 255 or 170, act and 0 or 85)
      -- A numbered tab in the middle of it: the active one bigger, outlined,
      -- blinking.
      local tw, th = act and 15 or 11, act and 13 or 10
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
    end
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
-- scene count), scene. Read with the engine's UI input (getInput: the
-- players' own menu keys, keyboard or pad), never with the fighters'
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
    .. ' step=' .. tostring((g and pi) and pkStepOf(g, pi, PK.sc) or nil) .. ' entry=' .. (g and g.name or '?') .. ' rows=' .. tostring((g and pi) and pkRowCount(g, pi) or nil))
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
end
local function pickerClose()
  PK.open = false
  -- Not unpaused yet: the key that chose (Enter, a button) is still down, and
  -- the first free frame would give it to the fighters as a press - Enter is
  -- P1's Start, DongHwan's effects toggle. The loop lets go once the keys are up.
  if not PK.keepPaused then PK.release = true end
  pkLog('close')
end
local RELEASE_KEYS = { 's', 'a', 'b', 'c', 'x', 'y', 'z', 'U', 'D', 'L', 'R' }
local function pickerRelease()
  if PK.release and not PK.open and getInputTime(-1, RELEASE_KEYS) == 0 then
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
-- its way.
local function keysFree() return ACTIVE and not PK.open and not PK.release and not paused() and CMD == nil end
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
  c = 'no climax in this position', h = 'no stages in this position' }
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
  if CMD ~= nil then return end
  if NSLOT <= 1 then return pkSay('the last pair stays: Enter changes it') end
  if LOG then print('[hgallery] delete pair ' .. SEL .. ' of ' .. NSLOT) end
  reload({ what = 'del', k = SEL })
end
-- Insert (and H): the overlay, its box and the markers hidden or shown again.
-- The picker draws itself either way (in it, Insert adds a pair).
function HGalleryOverlay()
  if not ACTIVE then return end
  HIDE = not HIDE
  if HIDE then tell('Insert shows the overlay', 120) else MSG.t = 0 end
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
  if PK.col < 2 then return pkSay('pick a receiver first (Right)') end
  local pi = pkPairIndex()
  pickerAdd(pi, pi and pkPickStep(pi))
end
function HGalleryPicker()
  if not ACTIVE then return end
  if PK.open then return pickerClose() end
  useSlot(SEL)
  pkFollow()
  -- The cursor starts on the active pair, in the receiver column.
  PK.col, PK.t, PK.top, PK.msgT = 2, 0, {}, 0
  -- Already paused with the Pause key: it stays paused when the picker closes.
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

local function hit(tok) return getInput(-1, { tok }) == true end
local function pickerInput()
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
local function pickerTick()
  if not PK.open then return end
  -- The Pause key toggles it too: the picker holds the fight still.
  if not paused() then togglePause(true) end
  PK.t = PK.t + 1
  pickerInput()
  if PK.open then pickerDraw() end
end

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
  local c = (SEL - (NSLOT + 1) / 2) * SPACING
  local g = SLOTS[SEL]
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
    -- moves, a thrust, never sway it).
    elseif ZL ~= 0 and not paused() and math.abs(camPin() - CAM.x) > K.FOLLOW then camAsk() end
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
-- next tick (camTick); the level stays when 1-4 changes the active pair.
function HGalleryZoom(d, key)
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
  tell(note, 90)
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

hook.add('loop#hgallery', 'hgallery', function()
  local ok, err = pcall(function()
    if not ACTIVE then return end
    LOOPF = LOOPF + 1
    if MSG.t > 0 then MSG.t = MSG.t - 1 end
    tickMatch()
    camTick()
    for k = 1, NSLOT do useSlot(k); tickSlot() end
    useSlot(SEL)
    -- (The overlay also where the active step's prototype mode plays outside
    -- round state 2.)
    if roundState() == 2 or MODE.liveOf(curStep()) then
      if HINT then HINT = false; if HIDE then tell('Insert shows the overlay', 120) end end
      watch()
      markers()
      overlay()
    end
    pickerRelease()
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
  -- Every key is taken when the mode starts and acts only in the gallery
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
  take('PAGEUP', 'HGalleryPair(-1)')
  take('PAGEDOWN', 'HGalleryPair(1)')
  for k = 1, MAX_SLOTS do take(tostring(k), 'HGallerySlot(' .. k .. ')') end
  -- (Tests: [ and ] step through the pair's steps in the data's order.)
  if LOG then take('LBRACKET', 'HGalleryScene(-1)'); take('RBRACKET', 'HGalleryScene(1)') end
  for _, L in ipairs(LOAD) do L.si, L.fresh = 1, nil end
  if SEL > #LOAD then SEL = 1 end
  -- The pair each place held last match: the same pair in the same place
  -- keeps its two characters loaded (existed=1: not loaded or compiled again).
  local before = {}
  local stage = (DATA.stage ~= '' and start.f_getStageRef(DATA.stage)) or nil
  while true do
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
    start.f_setRounds(-1, {})
    if stage then start.f_setStage(stage, true) else start.f_setStage() end
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
    if CMD == nil and won ~= -1 then
      local again = MODE.call('after', won)
      if type(again) == 'table' and again.what == 'again' then CMD = again end
    end
    if CMD == nil then break end
    before = {}
    for k, L in ipairs(LOAD) do
      before[k] = L.pi
      L.si, L.fresh = SLOTS[k].si, nil
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
    elseif CMD.what == 'again' then
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
function buildGalleryFiles(data, stage, modes) {
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
    lua: Buffer.from(buildGalleryLua(trimmed, use), 'latin1'),
    // latin1: a command name is the .cmd's own bytes (Shift-JIS names too).
    zss: Buffer.from(buildGalleryZss(trimmed, use), 'latin1'),
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
  try {
    return buildGalleryFiles(data, stage, modes);
  } catch (e) {
    console.warn('H gallery: ' + (e && e.message));
    return null;
  }
}

module.exports = {
  GALLERY_LUA_VPATH, GALLERY_ZSS_VPATH, GALLERY_STATES_KEY, MAX_SETUP, MAX_SETS, DEFAULT_PATIENCE,
  buildGalleryLua, buildGalleryZss, buildGalleryFiles, buildForRoster, trimData, toLua,
};
