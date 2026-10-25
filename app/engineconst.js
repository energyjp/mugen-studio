'use strict';
//
// THE GAME-WIDE CONSTANTS - data/common.const, and the build's own copy of it.
//
// A character's constants file says what THAT character is. This file says what
// the GAME is: the multipliers that turn a HitDef's damage into dizzy points,
// guard points, red life and power, the two backward-compatibility switches,
// the input toggles, and the on/off keys the engine's own common states read.
// Every character in the build is affected by one number here.
//
// WHERE THE VALUE COMES FROM, in the order the engine builds it up
// (source at ikemen-go-src/src, 96413d2):
//
//   1. initConstants (char.go:8011-8028) writes fifteen literals into
//      gi.constants. Anything NOT in that list starts as the Go zero value,
//      which is 0 - so a key only the common states read (const(...) compiles
//      to a map lookup, bytecode.go:2963) is OFF until a file sets it.
//   2. Every file in [Common] Const, in SortedKeys order - Const, then Const1,
//      Const2... (common.go:1629-1644) - is read and its keys assigned with
//      `gi.constants[key] = value` (char.go:3967-3983). A PLAIN ASSIGNMENT, so
//      across files the LAST one wins. That is the whole mechanism this module
//      uses: the build's own file is listed after the engine's.
//   3. The character's own first [Constants] section (char.go:4224-4229)
//      overrides both, for that character only.
//
// WHAT THE READER DOES AND DOES NOT DO:
//
//   * ONLY THE FIRST SECTION OF A CONST FILE IS READ. char.go:3971 calls
//     ReadIniSection once with the index at 0 and throws the section's name
//     away, and Parse stops at the next `[`. So the section can be called
//     anything, and every key after a SECOND header is silently ignored.
//   * KEYS ARE LOWERCASED AND THE FIRST ONE WINS inside a file
//     (IniSection.Parse, common.go:1010-1019).
//   * THE VALUE ENDS AT THE FIRST `;` (common.go:1007), and is read by Atof,
//     which accumulates digits and stops at the first character that is not
//     one - returning 0 for junk, with no diagnostic anywhere.
//   * A LISTED FILE THAT IS NOT THERE FAILS CHARACTER LOADING. LoadFile's
//     error is returned straight out of the loader (char.go:3969-3982), the
//     same rule the desktop sandbox's States1 line lives under.
//
// WHY THE BUILD GETS ITS OWN FILE RATHER THAN AN EDIT IN PLACE.
//
// data/common.const belongs to the engine's installation: in a checkout it is
// release/data, release-v2/data and the engine checkout; in a desktop export it
// is whatever the official zip unpacked. All four are replaced wholesale by the
// next engine update, and the export re-extracts the zip whenever the stamp
// changes. An edit there would be silently lost, and in the meantime it would
// make the installation differ from the release it claims to be.
//
// So the build's overrides live with the build's CONTENT - layout.dir('engine'),
// beside characters, stages, music and themes - and are carried into a build as
// a SECOND const file listed after the engine's own. It holds only the keys the
// build changes, so an engine update still brings its own new defaults with it.
//
// Everything here is pure text in, text out. No file IO and no roster, so the
// server wrapper and the tests use the same functions.
const charedit = require('./charedit.js');

// The path the build's own const file takes inside a build, and the [Common]
// key that lists it. `Const1` sorts after `Const`, which is what makes it an
// override rather than a replacement.
const BUILD_CONST_VPATH = 'data/build.const';
const BUILD_CONST_KEY = 'Const1';
// The file's name in the content folder. One name in both places keeps a
// question like "which file am I looking at" from ever coming up.
const BUILD_CONST_FILE = 'common.const';

// ---- the fields --------------------------------------------------------------
//
// `cite` is where the engine READS the value. `def` is what it would be with no
// const file at all: the initConstants literal, or 0 for a key the Go code
// never seeds. `zero` marks the second kind, because "default 0" and "the
// engine has no default for this" are different things to say to someone.
//
// `does` is what the number moves; `risk` is what goes wrong. The line between
// REFUSED and WARNED is the one charstats.js draws: a value is refused when the
// engine's own arithmetic breaks on it or it inverts a system (healing on a
// hit, a meter that fills when it should empty); it is written with a warning
// when it is merely extreme. The engine accepts both and reports neither.
const FIELDS = [
  // ---- damage into meters ---------------------------------------------------
  {
    id: 'default.attack.lifetopowermul', key: 'Default.Attack.LifeToPowerMul',
    kind: 'float', group: 'Damage into meters', label: 'Power to the attacker',
    def: 0.7, sane: [0, 2], cite: 'char.go:950', defCite: 'char.go:8012',
    does: 'How much super meter a normal or special hit gives the attacker, as a multiple of the hit damage. A HitDef that names getpower itself ignores it.',
    risk: 'Guard power is half of hit power and follows this too (char.go:964). A negative number drains the attacker\'s meter on every hit.',
    refuse: (v) => (v < 0 ? 'a negative multiplier drains the attacker\'s meter on every hit' : v > 100 ? 'above 100x the damage is not a meter gain' : null),
    warn: (v) => (v === 0 ? 'attacking will never build meter' : null),
  },
  {
    id: 'super.attack.lifetopowermul', key: 'Super.Attack.LifeToPowerMul',
    kind: 'float', group: 'Damage into meters', label: 'Power to the attacker, on a super',
    def: 0, sane: [0, 2], cite: 'char.go:937', defCite: 'char.go:8013',
    does: 'The same, for a hit whose attr carries the super (A) class. Shipped at 0 so a super does not pay for itself.',
    risk: 'Raise it and a super that connects starts refilling the meter it cost.',
    refuse: (v) => (v < 0 ? 'a negative multiplier drains the attacker\'s meter on every super hit' : v > 100 ? 'above 100x the damage is not a meter gain' : null),
  },
  {
    id: 'default.gethit.lifetopowermul', key: 'Default.GetHit.LifeToPowerMul',
    kind: 'float', group: 'Damage into meters', label: 'Power to the receiver',
    def: 0.6, sane: [0, 2], cite: 'char.go:952', defCite: 'char.go:8014',
    does: 'How much super meter being hit gives the RECEIVER. A HitDef that names givepower itself ignores it.',
    risk: 'This is the comeback lever. At 0 the player being combo\'d gets nothing back; high values make long combos pay the victim.',
    refuse: (v) => (v < 0 ? 'a negative multiplier drains the meter of whoever is being hit' : v > 100 ? 'above 100x the damage is not a meter gain' : null),
  },
  {
    id: 'super.gethit.lifetopowermul', key: 'Super.GetHit.LifeToPowerMul',
    kind: 'float', group: 'Damage into meters', label: 'Power to the receiver, on a super',
    def: 0.6, sane: [0, 2], cite: 'char.go:939', defCite: 'char.go:8015',
    does: 'The same, for a hit carrying the super class.',
    risk: 'Leaving this above 0 while the attacker\'s super gain is 0 means a super feeds the opponent and not its owner - which is the shipped balance.',
    refuse: (v) => (v < 0 ? 'a negative multiplier drains the meter of whoever is being hit' : v > 100 ? 'above 100x the damage is not a meter gain' : null),
  },
  {
    id: 'default.lifetodizzypointsmul', key: 'Default.LifeToDizzyPointsMul',
    kind: 'float', group: 'Damage into meters', label: 'Dizzy points per point of damage',
    def: 1.8, sane: [0, 5], cite: 'char.go:954', defCite: 'char.go:8019',
    does: 'How much stun a normal or special hit deals, as a multiple of its damage. Only used while Dizzy is on in the match rules.',
    risk: 'A character\'s stun meter defaults to its own life, so 1.8 means a full life bar of damage dizzies someone about twice over.',
    refuse: (v) => (v < 0 ? 'a negative multiplier heals the stun meter on every hit' : v > 100 ? 'above 100x the damage is not a stun value' : null),
    warn: (v) => (v === 0 ? 'nothing will ever cause a dizzy' : null),
  },
  {
    id: 'super.lifetodizzypointsmul', key: 'Super.LifeToDizzyPointsMul',
    kind: 'float', group: 'Damage into meters', label: 'Dizzy points, on a super',
    def: 0, sane: [0, 5], cite: 'char.go:941', defCite: 'char.go:8020',
    does: 'The same for a super hit. Shipped at 0, so supers do not stun.',
    risk: 'Raising it lets a super both take the round and set up the dizzy for the next one.',
    refuse: (v) => (v < 0 ? 'a negative multiplier heals the stun meter on every super hit' : v > 100 ? 'above 100x the damage is not a stun value' : null),
  },
  {
    id: 'default.lifetoguardpointsmul', key: 'Default.LifeToGuardPointsMul',
    kind: 'float', group: 'Damage into meters', label: 'Guard points per point of damage',
    def: 1.5, sane: [0, 5], cite: 'char.go:956', defCite: 'char.go:8017',
    does: 'How much guard meter a blocked normal or special takes, as a multiple of the hit damage. Only used while Guard Break is on in the match rules.',
    risk: 'Blocking is the only thing this touches, so it decides how long a defensive player can hold out.',
    refuse: (v) => (v < 0 ? 'a negative multiplier refills the guard meter on every blocked hit' : v > 100 ? 'above 100x the damage is not a guard value' : null),
    warn: (v) => (v === 0 ? 'blocking will never break a guard' : null),
  },
  {
    id: 'super.lifetoguardpointsmul', key: 'Super.LifeToGuardPointsMul',
    kind: 'float', group: 'Damage into meters', label: 'Guard points, on a super',
    def: -0.33, sane: [0, 5], cite: 'char.go:943', defCite: 'char.go:8018',
    does: 'The same for a blocked super.',
    risk: 'The engine\'s built-in for this one is NEGATIVE (-0.33) while the file the engine ships sets it to 0.33. Deleting the line does not restore the shipped behavior - it flips the sign, and a blocked super starts refilling the guard meter.',
    refuse: (v) => (v > 100 ? 'above 100x the damage is not a guard value' : v < -100 ? 'below -100x the damage is not a guard value' : null),
    warn: (v) => (v < 0 ? 'negative here refills the guard meter when a super is blocked' : null),
  },
  {
    id: 'default.lifetoredlifemul', key: 'Default.LifeToRedLifeMul',
    kind: 'float', group: 'Damage into meters', label: 'Red life kept',
    def: 0.75, sane: [0, 1], cite: 'char.go:958', defCite: 'char.go:8021',
    does: 'How much of a normal hit\'s damage stays as recoverable red life. Used for the hit and, with the guard damage, for a block. Only while Red Life is on in the match rules.',
    risk: 'At 1 nothing is ever lost for good in a tag match; at 0 red life does nothing.',
    refuse: (v) => (v < 0 ? 'a negative multiplier takes red life away instead of leaving it' : v > 10 ? 'more than ten times the damage is not red life' : null),
  },
  {
    id: 'super.lifetoredlifemul', key: 'Super.LifeToRedLifeMul',
    kind: 'float', group: 'Damage into meters', label: 'Red life kept, on a super',
    def: 0.75, sane: [0, 1], cite: 'char.go:945', defCite: 'char.go:8022',
    does: 'The same for a super hit. Also the multiplier the engine uses when a super drains a target\'s red life directly (char.go:8470).',
    risk: 'Lower than the normal value and supers become the way to take life that cannot be recovered.',
    refuse: (v) => (v < 0 ? 'a negative multiplier takes red life away instead of leaving it' : v > 10 ? 'more than ten times the damage is not red life' : null),
  },
  {
    id: 'super.targetdefencemul', key: 'Super.TargetDefenceMul',
    kind: 'float', group: 'Damage into meters', label: 'Defence during a super',
    def: 1.5, sane: [1, 3], cite: 'bytecode.go:10476', defCite: 'char.go:8016',
    does: 'How much a SuperPause raises the opponent\'s defence for the combo that follows. A SuperPause with its own p2defmul ignores it.',
    risk: 'This is the anti-infinite on supers: at 1 a super combo does its full damage, and the whole cast gets more dangerous at once.',
    refuse: (v) => (v <= 0 ? 'damage is divided by this, so 0 or less makes a super combo an instant KO' : v > 100 ? 'above 100 is not a defence multiplier' : null),
    warn: (v) => (v < 1 ? 'below 1 a super combo does MORE damage, not less' : null),
  },

  // ---- what the engine's own common states read -------------------------------
  {
    id: 'default.enable.action', key: 'Default.Enable.Action', zero: true,
    kind: 'bool', group: 'Common state modules', label: 'Action module',
    def: 0, cite: 'data/action.zss:6',
    does: 'Turns on the engine\'s own action module, the negative-state code behind its extra global behavior.',
    risk: 'The engine has NO built-in value for this: with no const file setting it the map reads 0 and the module is off. Turning it off in a build that expects it removes behavior every character relies on.',
  },
  {
    id: 'default.enable.dizzy', key: 'Default.Enable.Dizzy', zero: true,
    kind: 'bool', group: 'Common state modules', label: 'Dizzy module',
    def: 0, cite: 'data/dizzy.zss:186',
    does: 'Lets data/dizzy.zss run. The Dizzy match rule is the other half: both have to be on for a stun to happen.',
    risk: 'Off here and the Dizzy rule does nothing at all, with no message anywhere.',
  },
  {
    id: 'default.enable.guardbreak', key: 'Default.Enable.GuardBreak', zero: true,
    kind: 'bool', group: 'Common state modules', label: 'Guard break module',
    def: 0, cite: 'data/guardbreak.zss:145',
    does: 'Lets data/guardbreak.zss run, the same way Dizzy works - with the Guard Break match rule as the other half.',
    risk: 'Off here and the Guard Break rule does nothing, silently.',
  },
  {
    id: 'default.enable.score', key: 'Default.Enable.Score', zero: true,
    kind: 'bool', group: 'Common state modules', label: 'Score module',
    def: 0, cite: 'data/score.zss:6',
    does: 'Lets data/score.zss run, which is what puts a score on the fight screen.',
    risk: 'Off here and the fight screen\'s score elements have nothing to show.',
  },
  {
    id: 'default.enable.tag', key: 'Default.Enable.Tag', zero: true,
    kind: 'bool', group: 'Common state modules', label: 'Tag module',
    def: 0, cite: 'data/tag.zss:241',
    does: 'Lets data/tag.zss run, which is the whole tag-team switch.',
    risk: 'Off here and Tag mode still starts but nobody can switch out.',
  },

  // ---- tag tuning -------------------------------------------------------------
  {
    id: 'tagintime', key: 'TagInTime', zero: true, kind: 'int', group: 'Tag team',
    label: 'Switch-in time', unit: 'ticks', def: 0, sane: [10, 60], cite: 'data/tag.zss:92',
    does: 'How many ticks the incoming partner takes to reach its position. The run-in speed is the distance divided by this.',
    risk: 'The engine divides by it: 0 is a divide by zero in the incoming partner\'s velocity.',
    refuse: (v) => (v <= 0 ? 'the incoming partner\'s speed is the distance divided by this, so 0 or less is a divide by zero' : v > 600 ? 'above 600 ticks is ten seconds to walk on' : null),
  },
  {
    id: 'taginvelx', key: 'TagInVelX', zero: true, kind: 'float', group: 'Tag team',
    label: 'Switch-in top speed', unit: 'px/tick', def: 0, sane: [5, 25], cite: 'data/tag.zss:92',
    does: 'The fastest the incoming partner may run in, whatever the distance says.',
    risk: 'Read through const240p, so it is in 240p space and scales to the stage.',
    refuse: (v) => (v < 0 ? 'a negative top speed sends the incoming partner the wrong way' : v > 200 ? 'above 200 px per tick is not a run-in' : null),
  },
  {
    id: 'tagcommandaichance', key: 'TagCommandAIChance', zero: true, kind: 'int', group: 'Tag team',
    label: 'AI switch chance', unit: '%', def: 0, sane: [0, 100], cite: 'data/tag.zss:31',
    does: 'How often an AI-controlled side takes a tag when it could, out of 100.',
    risk: 'Compared against randomRange(1, 100), so 0 means the AI never tags and 100 means it always does.',
    refuse: (v) => (v < 0 ? 'a chance cannot be negative' : v > 100 ? 'the roll is 1 to 100, so anything above 100 is just "always"' : null),
  },
  {
    id: 'tagredliferegenframes', key: 'TagRedLifeRegenFrames', zero: true, kind: 'int', group: 'Tag team',
    label: 'Red life tick', unit: 'ticks', def: 0, sane: [10, 120], cite: 'data/tag.zss:347',
    does: 'How often a waiting partner recovers red life: the regen runs when gameTime divides by this.',
    risk: 'The engine takes gameTime modulo this number. 0 is a division by zero on the first tick of every match in Tag mode.',
    refuse: (v) => (v <= 0 ? 'the engine takes the game time modulo this, so 0 or less is a divide by zero' : v > 10000 ? 'above 10000 ticks is longer than any round' : null),
  },
  {
    id: 'tagredliferegenpercent', key: 'TagRedLifeRegenPercent', zero: true, kind: 'float', group: 'Tag team',
    label: 'Red life per tick', unit: 'of max life', def: 0, sane: [0, 0.05], cite: 'data/tag.zss:348',
    does: 'How much red life comes back each time, as a fraction of the character\'s maximum life.',
    risk: 'The shipped 0.005 is half a percent every half second. At 1 a partner is whole again the moment it leaves.',
    refuse: (v) => (v < 0 ? 'a negative amount takes life away while the partner waits' : v > 1 ? 'more than the whole life bar per tick is not a regeneration rate' : null),
  },
  {
    id: 'tagswitchcooldown', key: 'TagSwitchCooldown', zero: true, kind: 'int', group: 'Tag team',
    label: 'Switch cooldown', unit: 'ticks', def: 0, sane: [0, 180], cite: 'data/tag.zss:302',
    does: 'How long after a switch before the next one is allowed.',
    risk: '0 is the shipped value and allows switching as fast as the input can be entered.',
    refuse: (v) => (v < 0 ? 'a cooldown cannot be negative' : v > 10000 ? 'above 10000 ticks is longer than any round' : null),
  },

  // ---- compatibility and input -------------------------------------------------
  {
    id: 'default.legacygamedistancespec', key: 'Default.LegacyGameDistanceSpec',
    kind: 'bool', group: 'Compatibility', label: 'Legacy GameWidth and GameHeight',
    def: 0, cite: 'bytecode.go:2227, 2237', defCite: 'char.go:8023',
    does: 'With this on, a character declaring mugenversion 1.0 reads GameWidth and GameHeight as the SCREEN size, unaffected by the stage\'s zoom.',
    risk: 'Only applies to mugenversion 1.0 characters - the test is on the version AND this key. Off, a zooming stage moves every distance check those characters make.',
  },
  {
    id: 'default.legacyfallyvelyaccel', key: 'Default.LegacyFallYVelYAccel',
    kind: 'bool', group: 'Compatibility', label: 'Legacy fall velocity defaults',
    def: 0, cite: 'char.go:687, 1121', defCite: 'char.go:8024',
    does: 'With this on, a HitDef that leaves out fall.yvelocity and fall.yaccel gets fixed numbers instead of ones scaled to the character\'s own coordinate space.',
    risk: 'Turning it on changes how far every unspecified knockdown throws a character in a 640-wide cast.',
  },
  {
    id: 'input.pauseonhitpause', key: 'Input.PauseOnHitPause',
    kind: 'bool', group: 'Input', label: 'Buffer commands during hit pause',
    def: 1, cite: 'char.go:13431', defCite: 'char.go:8026',
    does: 'Whether command input keeps being buffered while the hit pause freezes both players.',
    risk: 'Marked deprecated in the engine\'s own source: a command\'s own parameters are the supported way to say this now. Off, combos entered during the freeze are dropped.',
  },
  {
    id: 'input.fbflipenemydistance', key: 'Input.FBFlipEnemyDistance',
    kind: 'float', group: 'Input', label: 'Back and forward flip distance',
    def: -1, sane: [-1, 100], cite: 'char.go:6536', defCite: 'char.go:8027',
    does: 'Any value of 0 or more makes B and F swap when the opponent is behind by more than that distance, instead of following the character\'s own facing.',
    risk: 'Negative (the default) is the MUGEN behavior: the flip follows facing and nothing else. This is a control change every player will feel, on every character.',
    refuse: (v) => (v > 10000 ? 'above 10000 is further than any stage' : null),
  },
];

const BY_ID = new Map(FIELDS.map((f) => [f.id, f]));
// The key the engine looks up is the file's key name lowercased, so that is
// also this table's id. Kept explicit rather than derived so a typo in one of
// them is a mismatch a test can see.
for (const f of FIELDS) {
  if (f.key.toLowerCase() !== f.id) throw new Error('engineconst: ' + f.key + ' does not lowercase to ' + f.id);
}

// The families this module deliberately does NOT offer. They are the engine's
// own vocabulary rather than settings: the common state files and every
// character's const(...) resolve their names THROUGH this file, so a changed
// number does not tune anything, it renames a state or an animation.
const READ_ONLY_PREFIXES = [
  { match: /^anim[a-z0-9_]*$/i, why: 'the reserved animation numbers - a character\'s walk, jump and get-hit actions are found by these names' },
  { match: /^state[a-z0-9_]*$/i, why: 'the reserved state numbers - the engine\'s own common states are defined at these names, and a character written for the older numbers is found through them' },
  { match: /^fx[a-z0-9_]*$/i, why: 'the common effect numbers - which action in data/fightfx.air a spark, a shockwave or a super flash plays' },
  { match: /^msg[a-z0-9_]*$/i, why: 'the fight screen\'s message numbers - which action in the lifebar definition FIRST ATTACK, COUNTER or a combo milestone plays' },
  { match: /^bit\d+$/i, why: 'the powers of two the common states shift with - arithmetic, not a setting' },
  // Measured, not assumed: the name appears in data/common.const and in
  // nothing else in the engine - not a state file, not a Lua script, not the
  // Go source. Its own comment says "used in MvCI ver only". Offering it would
  // be offering a box that does nothing.
  { match: /^tagcounterswitchpower$/i, why: 'declared in the engine’s own file and read by nothing in this engine - the counter-switch cost belongs to a tag variant it does not ship' },
];

// ---- reading a const file ------------------------------------------------------

const WS = ' \t\r\n\v\f';
function trimmed(s) {
  let a = 0, b = s.length;
  while (a < b && WS.includes(s[a])) a++;
  while (b > a && WS.includes(s[b - 1])) b--;
  return { text: s.slice(a, b), at: a };
}

// Every line with its byte offsets. latin1 in means one char is one byte, so a
// string offset IS a byte offset.
function lineIndex(text) {
  const out = [];
  let i = 0;
  while (i <= text.length) {
    let nl = text.indexOf('\n', i);
    if (nl < 0) nl = text.length;
    let end = nl;
    if (end > i && text[end - 1] === '\r') end--;
    out.push({ start: i, end, next: nl + 1 });
    if (nl >= text.length) break;
    i = nl + 1;
  }
  return out;
}

function eolOf(text) {
  const crlf = (text.match(/\r\n/g) || []).length;
  const lf = (text.match(/\n/g) || []).length;
  return crlf > 0 && crlf * 2 >= lf ? '\r\n' : '\n';
}

// A key line: the name ends at the first `=`, space or tab, after the comment
// is cut (common.go:1007-1012). Returns the lowercased key and the byte span of
// the value with the comment excluded.
function keyOf(text, line) {
  const raw = text.slice(line.start, line.end);
  const semi = raw.indexOf(';');
  const upto = semi >= 0 ? raw.slice(0, semi) : raw;
  const t = trimmed(upto);
  if (!t.text || t.text[0] === '[') return null;
  const m = /^[^=\s\t]+/.exec(t.text);
  if (!m) return null;
  const eq = t.text.indexOf('=');
  if (eq < 0) return null;
  const valRaw = t.text.slice(eq + 1);
  const vt = trimmed(valRaw);
  const base = line.start + t.at + eq + 1;
  return {
    key: m[0].toLowerCase(), name: m[0],
    valueStart: base + vt.at, valueEnd: base + vt.at + vt.text.length, value: vt.text,
  };
}

// WHAT THE ENGINE WOULD TAKE OUT OF THIS FILE.
//
// The first section only, whatever it is called; keys lowercased; first one
// wins; everything after a second header reported as lost rather than dropped
// in silence.
function readConsts(text) {
  const lines = lineIndex(text);
  const out = {
    eol: eolOf(text), section: null, sectionLine: -1,
    keys: new Map(),     // lowercased key -> {name, raw, lineNo, start, end}
    afterSecond: [],     // key names the engine never sees
    duplicates: [],      // second and later copies of a key, which it ignores
  };
  let seen = 0;
  for (let i = 0; i < lines.length; i++) {
    const t = trimmed(text.slice(lines[i].start, lines[i].end)).text;
    const bare = t.split(';')[0];
    if (trimmed(bare).text.startsWith('[')) {
      seen++;
      if (seen === 1) {
        const inner = trimmed(bare).text;
        out.section = inner.slice(1, inner.indexOf(']') < 0 ? undefined : inner.indexOf(']'));
        out.sectionLine = i;
      }
      continue;
    }
    if (seen === 0) continue;              // before any header: not read at all
    const k = keyOf(text, lines[i]);
    if (!k) continue;
    if (seen > 1) { out.afterSecond.push(k.name); continue; }
    if (out.keys.has(k.key)) { out.duplicates.push(k.name); continue; }
    out.keys.set(k.key, {
      name: k.name, raw: k.value, lineNo: i,
      start: k.valueStart, end: k.valueEnd,
    });
  }
  return out;
}

// Atof as the engine has it (common.go:243-278): a sign, digits, one point,
// more digits - and it stops at the first character that is not part of that,
// returning 0 when there was nothing numeric at all. No error, ever.
function atof(s) {
  const m = /^\s*([+-]?(?:\d+\.?\d*|\.\d+))/.exec(String(s));
  return m ? parseFloat(m[1]) : 0;
}

// The value the engine ends up with for a key, and where it came from, given
// the const files in the order it reads them. `files` is
// [{label, text}] - the engine's own first, the build's last.
function effective(files) {
  const out = new Map();
  for (const f of FIELDS) out.set(f.id, { value: f.def, from: f.zero ? 'nothing (the engine has no default for it)' : 'engine default', raw: null });
  for (const file of files || []) {
    const read = readConsts(file.text || '');
    for (const [k, v] of read.keys) {
      if (!BY_ID.has(k)) continue;
      out.set(k, { value: atof(v.raw), from: file.label, raw: v.raw });
    }
  }
  return out;
}

// ---- values --------------------------------------------------------------------

const INT_RE = /^[+-]?\d+$/;
const FLOAT_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)$/;

function parseValue(f, input) {
  const s = String(input === null || input === undefined ? '' : input).trim();
  if (s === '') return { error: 'this field cannot be left empty - clear it to go back to what the engine ships' };
  // Exponents are refused for the same reason the character editors refuse
  // them: the engine's Atof would read `1e3`, and every other tool that opens
  // a .const would not.
  if (/[eE]/.test(s)) return { error: 'write the number out in full: exponents belong in code, not in a constants file' };
  if (f.kind === 'bool') {
    if (s !== '0' && s !== '1') return { error: 'this is a switch: 0 or 1' };
  } else if (f.kind === 'int') {
    if (!INT_RE.test(s)) return { error: 'whole numbers only' };
  } else if (!FLOAT_RE.test(s)) {
    return { error: 'numbers only' };
  }
  const n = f.kind === 'float' ? parseFloat(s) : parseInt(s, 10);
  if (!isFinite(n)) return { error: 'not a number' };
  const why = f.refuse ? f.refuse(n) : null;
  if (why) return { error: why };
  const written = f.kind === 'float' ? (s[0] === '+' ? s.slice(1) : s) : String(n);
  return { value: n, text: written, warn: f.warn ? f.warn(n) : null };
}

// ---- the build's own file --------------------------------------------------------

// What a new override file looks like before anything is set. It is created
// EMPTY of values on purpose: a copy of the engine's own file would pin three
// hundred numbers to today's release and quietly freeze the build against every
// later one - the same reason the settings panel stores sparsely.
function emptyFile(eol) {
  const nl = eol || '\r\n';
  return [
    '; The constants this build changes.',
    ';',
    '; Loaded after the engine\'s own data/common.const and before each',
    '; character\'s own [Constants] section, so every key here overrides the',
    '; engine for every character that does not set it itself.',
    ';',
    '; Only the keys this build actually changes are listed. Everything else',
    '; keeps whatever the engine ships, including in a later version.',
    '',
    '[Constants]',
    '',
  ].join(nl);
}

// The splices that make the file hold exactly `wanted` - {id: text} for a value
// the build sets, and no entry at all for one it leaves to the engine.
//
// ONE PASS IS NOT ENOUGH, for the reason charstats.js gives: removing a line
// and inserting one can want the same byte. Replacements and removals are
// planned first, and the insertions against what those left.
function planEdits(text, wanted) {
  const now = readConsts(text);
  const lines = lineIndex(text);
  const splices = [];
  for (const f of FIELDS) {
    const have = now.keys.get(f.id);
    const want = Object.prototype.hasOwnProperty.call(wanted, f.id) ? wanted[f.id] : null;
    if (!have) continue;
    if (want === null || want === undefined || want === '') {
      const ln = lines[have.lineNo];
      splices.push({ start: ln.start, end: ln.next, text: '', allowNewline: true });
      continue;
    }
    if (have.raw !== want) splices.push({ start: have.start, end: have.end, text: want });
  }
  return splices;
}

function planInserts(text, wanted) {
  const now = readConsts(text);
  const lines = lineIndex(text);
  if (now.sectionLine < 0) {
    const e = new Error('this constants file has no section header at all, so the engine reads nothing out of it');
    e.code = 'refused';
    throw e;
  }
  const add = [];
  for (const f of FIELDS) {
    const want = Object.prototype.hasOwnProperty.call(wanted, f.id) ? wanted[f.id] : null;
    if (want === null || want === undefined || want === '') continue;
    if (now.keys.has(f.id)) continue;
    add.push(f.key + ' = ' + want);
  }
  if (!add.length) return [];
  // Directly under the header. A const file's keys are read only while the
  // FIRST section is still open, so anything appended at the end of a file
  // that later grows a second header would be read by nothing.
  const at = lines[now.sectionLine].next;
  return [{ start: at, end: at, text: add.join(now.eol) + now.eol, allowNewline: true }];
}

// `wanted` is the WHOLE state, not a delta: a field it does not name is
// removed from the file and goes back to the engine's own value.
function targetFor(values) {
  const target = {};
  const notes = [];
  for (const [id, v] of Object.entries(values || {})) {
    const f = BY_ID.get(id);
    if (!f) { const e = new Error('unknown engine constant: ' + JSON.stringify(id)); e.code = 'invalid'; e.field = id; throw e; }
    if (v === null || v === undefined || v === '') continue;
    const p = parseValue(f, v);
    if (p.error) { const e = new Error(f.label + ': ' + p.error); e.code = 'invalid'; e.field = id; throw e; }
    target[id] = p.text;
    if (p.warn) notes.push({ id, warn: p.warn });
  }
  return { target, notes };
}

function planConsts(text, values) {
  const { target, notes } = targetFor(values);
  const first = planEdits(text, target);
  const mid = charedit.applySplices(text, first);
  const second = planInserts(mid, target);
  return { target, notes, first, second, read: readConsts(text) };
}

function applyConsts(text, values) {
  const plan = planConsts(text, values);
  return charedit.applySplices(charedit.applySplices(text, plan.first), plan.second);
}

// ---- the panel's model ----------------------------------------------------------

// `engineText` is data/common.const as the engine's installation has it;
// `buildText` is the build's own file, or null when there is none yet.
function describe(engineText, buildText, opts) {
  const o = opts || {};
  const engineRead = readConsts(engineText || '');
  const buildRead = buildText === null || buildText === undefined ? null : readConsts(buildText);
  const files = [{ label: o.engineLabel || 'data/common.const', text: engineText || '' }];
  if (buildText !== null && buildText !== undefined) files.push({ label: o.buildLabel || BUILD_CONST_VPATH, text: buildText });
  const eff = effective(files);

  const fields = FIELDS.map((f) => {
    const e = engineRead.keys.get(f.id);
    const b = buildRead && buildRead.keys.get(f.id);
    const v = eff.get(f.id);
    return {
      id: f.id, key: f.key, kind: f.kind, group: f.group, label: f.label,
      unit: f.unit || null, does: f.does, risk: f.risk, cite: f.cite,
      defCite: f.defCite || null, sane: f.sane || null,
      def: f.def, zero: !!f.zero,
      engine: e ? e.raw : null,          // what the engine's own file says
      set: b ? b.raw : null,             // what THIS build sets
      value: v.value, from: v.from,
    };
  });

  // Everything in the engine's file this panel does not offer, so the tab can
  // say what it is leaving alone rather than pretending the file is 27 keys.
  const readOnly = [];
  for (const [k, v] of engineRead.keys) {
    if (BY_ID.has(k)) continue;
    const why = READ_ONLY_PREFIXES.find((p) => p.match.test(k));
    readOnly.push({ key: v.name, value: v.raw, why: why ? why.why : null });
  }
  return {
    fields,
    readOnly,
    readOnlyReasons: READ_ONLY_PREFIXES.map((p) => p.why),
    engine: {
      section: engineRead.section, keys: engineRead.keys.size,
      afterSecond: engineRead.afterSecond, duplicates: engineRead.duplicates,
    },
    build: buildRead ? {
      section: buildRead.section, keys: [...buildRead.keys.keys()].filter((k) => BY_ID.has(k)).length,
      unknown: [...buildRead.keys.values()].filter((v) => !BY_ID.has(v.name.toLowerCase())).map((v) => v.name),
      afterSecond: buildRead.afterSecond, duplicates: buildRead.duplicates,
    } : null,
  };
}

// What the build sets right now, as {id: text} - the shape a write takes back.
function setValues(buildText) {
  const out = {};
  if (buildText === null || buildText === undefined) return out;
  const read = readConsts(buildText);
  for (const f of FIELDS) {
    const v = read.keys.get(f.id);
    if (v) out[f.id] = v.raw;
  }
  return out;
}

// ---- the files on disk -----------------------------------------------------------
//
// Everything above is text in, text out. This is the only part that knows where
// the files are, and it asks layout.js rather than joining paths itself.
const fs = require('fs');
const path = require('path');
function layout() { return require('./layout.js'); }

// The build's own file, in the active bundle's content.
function buildFilePath() { return path.join(layout().dir('engine'), BUILD_CONST_FILE); }

// THE ENGINE'S OWN COPY, per product.
//
// There are three of them in a checkout and they are not the same file:
// release/data is the v1 pack, release-v2/data is the V2 bundle, and the engine
// checkout is what the wasm binary was built from. vfslib walks them in that
// order with map.set, so the LAST one wins and the website build reads the
// engine checkout's. A desktop export reads whatever the official zip
// unpacked, which is the export's own data/common.const.
function engineFileFor(product) {
  const L = layout();
  const cands = product === 'desktop'
    ? [path.join(L.DESKTOP_EXPORT, 'data', 'common.const'), path.join(L.dir('ikemen-go-src'), 'data', 'common.const'),
      path.join(L.dir('release-v2'), 'data', 'common.const')]
    : [path.join(L.dir('ikemen-go-src'), 'data', 'common.const'), path.join(L.dir('release-v2'), 'data', 'common.const'),
      path.join(L.dir('release'), 'data', 'common.const')];
  for (const c of cands) if (fs.existsSync(c)) return c;
  return null;
}

function readFile(p) {
  try { return fs.readFileSync(p, 'latin1'); } catch (e) { return null; }
}

// Does this build override anything? An override file with no keys left in it
// is the same as none, and must NOT be listed in a build's config: a [Common]
// Const entry naming a file is fine, but an empty override is dead weight and
// one more thing to keep in step.
function buildOverrides() {
  const text = readFile(buildFilePath());
  if (text === null) return null;
  const set = setValues(text);
  // A key the panel does not offer still counts: an imported Ikemen GO
  // build's constants can set any key the engine reads, and the engine
  // assigns every key in the file (char.go:3967-3983).
  return Object.keys(set).length || readConsts(text).keys.size ? { text, set } : null;
}

// THE COMMON STATE FILES THIS BUILD LOADS.
//
// Read-only, and listed for the same reason the const rows exist: these files
// are compiled into EVERY character, after its own states and its stcommon,
// with the first definition of a positive state winning (compiler.go:8367-8375,
// 7111). So a character that defines state 5150 keeps its own, and one that
// does not gets the engine's - and a file listed here that is not in the build
// fails character loading outright (compiler.go:6770-6773).
//
// The list is assembled the way the engine assembles it, from [Common] States,
// States1, States2... in SortedKeys order. Each entry says which key it came
// from, so another file can be added to the list later - an imported MUGEN
// build's own common1.cns is exactly that case - by appending an entry with a
// free key and putting the file in the build.
function commonStateFiles(product) {
  const desktop = product === 'desktop';
  const enginedata = require('./enginedata.js');
  const cfg = enginedata.commonConfig({ desktop });
  const resolved = enginedata.commonFiles({ desktop });
  const byRel = new Map(resolved.map((r) => [r.rel, r.path]));
  const L = layout();
  // A bundle imported from a whole MUGEN build carries that build's own
  // common1.cns as another key of the same map, after the engine's own - the
  // case this function's comment named before there was anything to list.
  let imported = null;
  try { imported = require('./buildimport.js').buildStates(L); } catch (e) { imported = null; }
  // A bundle imported from an Ikemen GO build lists that build's own files ON
  // the base keys, in place of the engine's own lists - so when it does, the
  // engine's `States` entries are not what this build loads, and its line is.
  let common = null;
  try { common = require('./buildimport.js').buildCommon(L); } catch (e) { common = null; }
  // And the screenpack in use can stand its own files in that list
  // (themecommon.js, worked out FROM the build's list): the merged line is what
  // this build loads, and its added systems ride on their own key.
  let theme = null;
  try { theme = require('./themecommon.js').forRoster(require('./vfslib.js').readRoster(), { ownCommon: common }); } catch (e) { theme = null; }
  const merged = theme && theme.lines.length
    ? require('./themecommon.js').mergeLines(common ? common.lines : [], theme.lines)
    : (common ? common.lines : []);
  const themeFrom = theme ? 'this screenpack (' + theme.name + ', Theme tab)' : null;
  const themePrefix = theme ? ('data/' + theme.folder + '/').toLowerCase() : null;
  const themeEntry = (key, rel) => {
    const p = path.join(theme.dir, ...rel.slice(themePrefix.length).split('/'));
    return { key, rel, found: fs.existsSync(p), from: themeFrom, path: path.relative(L.APP, p).replace(/\\/g, '/') };
  };
  const replaced = merged.find((l) => l.key === 'States');
  const engineEntries = cfg.states.map((rel) => {
    // Everything from defaultConfig.ini is one `States` entry; the Lock-On
    // hook a desktop export adds is its own key, which is what lets it ride
    // beside the engine's list instead of replacing it.
    const own = desktop && rel === enginedata.DESKTOP_STATES;
    const p = byRel.get(rel) || null;
    return {
      key: own ? 'States1' : 'States',
      rel,
      found: !!p,
      from: own ? 'this build (the training sandbox’s facing hook)' : 'the engine',
      path: p ? path.relative(L.APP, p).replace(/\\/g, '/') : null,
    };
  });
  const ownEntries = replaced ? replaced.value.split(',').map((s) => s.trim()).filter(Boolean).map((rel) => {
    if (themePrefix && rel.toLowerCase().startsWith(themePrefix)) return themeEntry('States', rel);
    const f = common && common.files.find((x) => x.vpath.toLowerCase() === rel.toLowerCase());
    const p = f ? f.path : (byRel.get(rel) || null);
    return {
      key: 'States',
      rel,
      found: !!p,
      from: f ? 'this build (the Ikemen GO build it was imported from)' : 'the engine',
      path: p ? path.relative(L.APP, p).replace(/\\/g, '/') : null,
    };
  }) : [];
  const airLine = common && common.lines.find((l) => l.key === 'Air');
  const themeKey = require('./themeopts.js').THEME_STATES_KEY;
  const addLine = theme && theme.lines.find((l) => l.key === themeKey);
  const addEntries = addLine ? addLine.value.split(',').map((s) => s.trim()).filter(Boolean).map((rel) => themeEntry(themeKey, rel)) : [];
  return {
    source: cfg.source,
    files: (replaced ? engineEntries.filter((e) => e.key !== 'States') : engineEntries)
      .concat(ownEntries)
      .concat(addEntries)
      .concat(imported ? [{
        key: imported.key,
        rel: imported.vpath,
        found: true,
        from: 'this build (the MUGEN build it was imported from)',
        path: path.relative(L.APP, imported.path).replace(/\\/g, '/'),
      }] : []),
    air: airLine ? airLine.value.split(',').map((s) => s.trim()).filter(Boolean) : cfg.air.slice(),
    consts: cfg.consts.slice(),
  };
}

// What the Engine tab shows.
function state(product) {
  const enginePath = engineFileFor(product === 'desktop' ? 'desktop' : 'web');
  const engineText = enginePath === null ? '' : readFile(enginePath);
  const bp = buildFilePath();
  const buildText = readFile(bp);
  const L = layout();
  const model = describe(engineText, buildText, {
    engineLabel: 'the engine’s own data/common.const',
    buildLabel: 'this build’s ' + BUILD_CONST_VPATH,
  });
  return Object.assign(model, {
    enginePath: enginePath ? path.relative(L.APP, enginePath).replace(/\\/g, '/') : null,
    engineReadable: enginePath !== null && engineText !== null,
    buildPath: path.relative(L.APP, bp).replace(/\\/g, '/'),
    buildExists: buildText !== null,
    buildVPath: BUILD_CONST_VPATH,
    commonKey: BUILD_CONST_KEY,
    bundle: L.ACTIVE_BUNDLE.name,
    backup: fs.existsSync(charedit.backupPath(bp)),
    common: commonStateFiles(product),
  });
}

// Write the whole set. `values` is every key the build sets; one that is absent
// leaves the file and goes back to the engine's own value.
//
// The write is the move editor's: a pristine backup taken the first time the
// file is touched, the bytes of the numbers spliced, the result read again with
// the same scanner, and a temporary file renamed over the original. The
// "pristine" state for this file is the one with no overrides in it, which is
// exactly what Revert should give back.
function write(values) {
  const p = buildFilePath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  if (!fs.existsSync(p)) fs.writeFileSync(p, Buffer.from(emptyFile('\r\n'), 'latin1'));
  const text = readFile(p);
  const plan = planConsts(text, values);
  if (!plan.first.length && !plan.second.length) return { changed: false, notes: plan.notes };
  charedit.writeSpliced(p, null, {
    expectText: text,
    passes: [plan.first, plan.second],
    validate: (newText) => {
      const after = readConsts(newText);
      if (after.afterSecond.length) return 'the write would have put a key past a second section header, where the engine never reads it';
      for (const [id, want] of Object.entries(plan.target)) {
        const h = after.keys.get(id);
        if (!h || h.raw !== want) return BY_ID.get(id).key + ' reads back as ' + JSON.stringify(h ? h.raw : null) + ', not ' + JSON.stringify(want);
      }
      for (const f of FIELDS) {
        if (Object.prototype.hasOwnProperty.call(plan.target, f.id)) continue;
        if (after.keys.has(f.id)) return f.key + ' should have been taken out of the file';
      }
      return null;
    },
  });
  return { changed: true, notes: plan.notes };
}

// Put the file back to the copy taken before the first write - no overrides -
// and drop the backup. With no backup there is nothing to undo, so the file
// itself is removed and the build goes back to the engine's own constants.
function revert() {
  const p = buildFilePath();
  if (!fs.existsSync(p)) return { reverted: false };
  if (fs.existsSync(charedit.backupPath(p))) return Object.assign({ reverted: true }, charedit.revert(p));
  require('./lifebars.js').rmFile(p);           // checked: see lifebars.js
  return { reverted: true, removed: true };
}

module.exports = {
  FIELDS, BY_ID, READ_ONLY_PREFIXES,
  BUILD_CONST_VPATH, BUILD_CONST_KEY, BUILD_CONST_FILE,
  lineIndex, eolOf, keyOf, readConsts, atof, effective,
  parseValue, targetFor, planEdits, planInserts, planConsts, applyConsts,
  emptyFile, describe, setValues,
  buildFilePath, engineFileFor, buildOverrides, commonStateFiles, state, write, revert,
};
