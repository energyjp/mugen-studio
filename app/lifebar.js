'use strict';
//
// THE FIGHT SCREEN - fight.def, and the build's own copy of it.
//
// system.def is the menus; fight.def is everything drawn while a round is
// running: the life, power, guard and stun bars, the two portraits, the names,
// the timer, the combo counters, and the fonts they are written in. It is
// found through the motif's `[Files] fight` key and belongs to the screenpack,
// not to the engine's configuration - which is why nothing in the settings
// schema reaches it.
//
// WHAT THE ENGINE DOES WITH THE FILE (source at ikemen-go-src/src, 96413d2):
//
//  * A SECTION NAME IS SPLIT AT ITS FIRST SPACE, AND THE SPACE IS KEPT.
//    SectionName (common.go:793-811) returns `("simul ", "lifebar")` for
//    `[Simul Lifebar]`, and the loader's switch has `case "simul "` with that
//    trailing space (fightscreen.go:5032). A writer that normalizes section
//    names breaks every team section in the file, so this module never
//    rewrites a header - it only ever replaces the bytes of a value.
//  * THE FIRST SECTION OF A KIND WINS, not the last: every case is guarded by
//    `if fs.lifeBars[0][0] == nil` and its siblings (fightscreen.go:4944-5290).
//    So a second `[Lifebar]` lower down is read by nothing, the same way a
//    repeated key inside one section is (common.go:1010-1019).
//  * SOME MISSING TEAM SECTIONS ARE SEEDED, FOURTEEN ARE NOT. The loader
//    pre-seeds a map of the sections it can do without (the tag and 3p/4p
//    variants, simul/turns powerbars, every guardbar and stunbar, action,
//    timer, score, match, ailevel, wincount, mode; fightscreen.go:4775-4800)
//    and copies a working layout into those (:5337-5425). [Lifebar],
//    [Powerbar], [Face], [Name], the Simul and Turns Lifebar/Face/Name,
//    [Time], [Combo], [Round] and [WinIcon] are NOT seeded, and reset() and
//    draw() call into every slot with no nil check (:5616-5671), so a def
//    lacking one stops at match start. lifebars.js refuses such a def.
//  * ...AND WHAT THEY INHERIT IS NOT UNIFORM. lifebar, face and name copy
//    index 3 (Tag) into 6 and 7 and index 1 (Simul) into everything else, so a
//    missing `[Tag Lifebar]` inherits from SIMUL; powerbar, guardbar and
//    stunbar copy 1 into 4 and 5, 3 into 6 and 7, and 0 into the rest
//    (fightscreen.go:5307, 5319, 5333, 5348, 5363, 5375). That is why the team
//    sections are shown here and not edited: an edit to one of them is a
//    different question from an edit to the single-player section, and the
//    answer depends on which family it belongs to.
//  * `anim` BEATS `spr`. AnimLayout.Read takes `spr` first and then `anim`
//    over it, but only when the fight.def's own animation table has that
//    action - an `anim` naming one it does not define is ignored in silence
//    (common.go:1385-1407).
//  * A `[Files]` PATH IS SEARCHED IN FOUR PLACES: the fight.def's own folder,
//    the motif's, the build root, then data/ (fightscreen.go:4858-4941). Fonts
//    add a `font/` probe inside each of those (font.go:413, common.go:660-681).
//  * `font` IS EIGHT NUMBERS: index, bank, align, r, g, b, a, height
//    (fightscreen.go:250-251). An index the `[Files]` section does not declare
//    is logged and turned into -1, which draws nothing.
//  * A MISSING FONT FILE IS ONLY LOGGED - the text it would draw is
//    invisible (fightscreen.go:4957-4976 discards the load error and stores
//    an empty font). The one fatal case is a bitmap font .def whose File=
//    glyph SFF is missing: LoadFntSff panics (font.go:411-418), on both
//    platforms. Font PATHS are therefore listed here, never written.
//
// WHERE AN EDIT GOES.
//
// Never into the engine's installation, and never into a screenpack folder the
// engine ships: both are replaced wholesale by the next engine version, and a
// desktop export re-extracts them from the official zip whenever its stamp
// changes. The build's own copy lives with the build's CONTENT
// (layout.dir('engine')) and is mounted into a build at the FIRST place the
// engine looks - the motif's own folder, under the name the motif's `fight`
// key gives. The engine's data/fight.def and the pack's own copy are left
// exactly as they are, and dropping the override puts the build back on them.
//
// Everything above the file section is pure text in, text out.
const charedit = require('./charedit.js');

// ---- the fields ----------------------------------------------------------------
//
// `sec` is the section as the engine names it (lowercased, no trailing space:
// only the single-player sections are written here). `cite` is where the engine
// reads the key.
//
// kinds:
//   ipair  two whole numbers      fpair  two decimals
//   int    one whole number       bool   0 or 1
//   spr    group, number          font   up to eight whole numbers
// The first of the three lines of each bar's reader; they run pos, range.x,
// range.y in that order.
const BARS = [
  ['lifebar', 'Life bars', 491, 'the life bar'],
  ['powerbar', 'Power bars', 868, 'the super meter'],
  ['guardbar', 'Guard bars', 1248, 'the guard meter'],
  ['stunbar', 'Stun bars', 1496, 'the stun meter'],
];

const FIELDS = [];
for (const [sec, group, at, what] of BARS) {
  const cite = (n) => 'fightscreen.go:' + (at + n);
  for (const p of ['p1', 'p2']) {
    FIELDS.push({
      id: sec + '.' + p + '.pos', sec, key: p + '.pos', kind: 'ipair', group,
      label: (p === 'p1' ? 'Player 1' : 'Player 2') + ' position', cite: cite(0),
      does: 'Where ' + what + ' is drawn, in the fight screen’s own coordinate space. Every part of the bar is drawn relative to this.',
      risk: 'Nothing validates it: a bar put outside the screen is simply never seen.',
    });
    FIELDS.push({
      id: sec + '.' + p + '.range.x', sec, key: p + '.range.x', kind: 'ipair', group,
      label: (p === 'p1' ? 'Player 1' : 'Player 2') + ' fill range', cite: cite(1),
      does: 'The two x offsets the bar’s fill runs between as the value drops - full at the first, empty at the second. Player 2’s usually mirrors player 1’s.',
      risk: 'Both the same makes a bar with no length: it is drawn and never appears to move.',
    });
    FIELDS.push({
      id: sec + '.' + p + '.range.y', sec, key: p + '.range.y', kind: 'ipair', group,
      label: (p === 'p1' ? 'Player 1' : 'Player 2') + ' fill height', cite: cite(2),
      does: 'The vertical extent of the fill. Most packs leave it out and let the sprite decide.',
      risk: 'Setting it on a bar whose art was not drawn for it crops the fill.',
    });
  }
}
for (const p of ['p1', 'p2']) {
  const who = p === 'p1' ? 'Player 1' : 'Player 2';
  FIELDS.push({
    id: 'face.' + p + '.pos', sec: 'face', key: p + '.pos', kind: 'ipair', group: 'Portraits',
    label: who + ' portrait position', cite: 'fightscreen.go:1764',
    does: 'Where the portrait and everything behind it is drawn.',
    risk: 'The backgrounds are positioned relative to this, so moving it moves the whole plate.',
  });
  FIELDS.push({
    id: 'face.' + p + '.face.spr', sec: 'face', key: p + '.face.spr', kind: 'spr', group: 'Portraits',
    label: who + ' portrait sprite', cite: 'fightscreen.go:1772',
    does: 'Which sprite of the CHARACTER’s own .sff is drawn as the in-match face. Stock packs use 9000,0; some ask for 9000,20, which standard characters do not ship.',
    risk: 'This one is not in the pack: it is read from each character. A number a character lacks draws nothing at all for that character, and nothing says so.',
    fromChar: true,
  });
  FIELDS.push({
    id: 'face.' + p + '.face.offset', sec: 'face', key: p + '.face.offset', kind: 'fpair', group: 'Portraits',
    label: who + ' portrait offset', cite: 'common.go:1214',
    does: 'Moves the portrait within its plate, without moving the backgrounds.',
    risk: 'Characters draw their portraits at different sizes, so an offset tuned to one roster can be wrong for the next character added.',
  });
  FIELDS.push({
    id: 'face.' + p + '.face.scale', sec: 'face', key: p + '.face.scale', kind: 'fpair', group: 'Portraits',
    label: who + ' portrait scale', cite: 'common.go:1232',
    does: 'Scales the portrait sprite. 1,1 is the sprite’s own size.',
    risk: '0 in either makes the portrait vanish; a negative value mirrors it.',
    refusePair: (a, b) => (a === 0 || b === 0 ? 'a scale of 0 makes the portrait vanish' : null),
  });
  FIELDS.push({
    id: 'face.' + p + '.face.palshare', sec: 'face', key: p + '.face.palshare', kind: 'bool', group: 'Portraits',
    label: who + ' portrait follows the color pick', cite: 'fightscreen.go:1774', def: 1,
    does: 'Whether the portrait is drawn through the palette the player picked at the character select, so it changes color with the body.',
    risk: 'This is the switch behind the garbled SFF v1 lifebar face: a portrait carrying its OWN palette is resolved through the body’s when this is on, and stock packs never set it. The engine’s default is ON. Turning it off fixes those portraits and stops every portrait following its color pick.',
  });
  FIELDS.push({
    id: 'name.' + p + '.pos', sec: 'name', key: p + '.pos', kind: 'ipair', group: 'Names',
    label: who + ' name position', cite: 'fightscreen.go:2071',
    does: 'Where the character’s display name is drawn.',
    risk: 'The name’s alignment comes from its font parameter, so a position that looks centered for one name can run off for a longer one.',
  });
  FIELDS.push({
    id: 'name.' + p + '.name.font', sec: 'name', key: p + '.name.font', kind: 'font', group: 'Names',
    label: who + ' name font', cite: 'fightscreen.go:250',
    does: 'index, bank, alignment, then optionally red, green, blue, alpha and height. Alignment is -1 right, 0 centered, 1 left.',
    risk: 'An index the [Files] section does not declare is logged once and turned into -1, which draws nothing at all.',
  });
  FIELDS.push({
    id: 'name.' + p + '.name.scale', sec: 'name', key: p + '.name.scale', kind: 'fpair', group: 'Names',
    label: who + ' name scale', cite: 'common.go:1232',
    does: 'Scales the name text. 1,1 is the font’s own size.',
    risk: '0 in either makes the name vanish.',
    refusePair: (a, b) => (a === 0 || b === 0 ? 'a scale of 0 makes the name vanish' : null),
  });
}
FIELDS.push(
  {
    id: 'time.pos', sec: 'time', key: 'pos', kind: 'ipair', group: 'Timer',
    label: 'Timer position', cite: 'fightscreen.go:2351',
    does: 'Where the round clock is drawn.',
    risk: 'Everything else in the section is an offset from this.',
  },
  {
    id: 'time.counter.offset', sec: 'time', key: 'counter.offset', kind: 'fpair', group: 'Timer',
    label: 'Timer offset', cite: 'common.go:1214',
    does: 'Moves the digits within the timer’s position.',
    risk: 'A pack that also sets counter1 / counter10 offsets overrides this for those digit counts.',
  },
  {
    id: 'time.counter.font', sec: 'time', key: 'counter.font', kind: 'font', group: 'Timer',
    label: 'Timer font', cite: 'fightscreen.go:250',
    does: 'The font the clock is drawn in: index, bank, alignment, then optional color, alpha and height.',
    risk: 'When this font cannot be resolved the timer draws nothing and the round still ends on time.',
  },
  {
    id: 'time.counter.scale', sec: 'time', key: 'counter.scale', kind: 'fpair', group: 'Timer',
    label: 'Timer scale', cite: 'common.go:1232',
    does: 'Scales the digits.',
    risk: '0 in either makes the clock invisible while it still runs.',
    refusePair: (a, b) => (a === 0 || b === 0 ? 'a scale of 0 makes the clock invisible while it still runs' : null),
  },
  {
    id: 'time.framespercount', sec: 'time', key: 'framespercount', kind: 'int', group: 'Timer',
    label: 'Ticks per count', cite: 'fightscreen.go:2358', def: 60,
    does: 'How many engine ticks one displayed count lasts. 60 is one second per count at the engine’s own rate.',
    risk: 'This is the pack’s half of the round timer: the match rules say how many counts, this says how long each one is. Tag mode stretches it further. 0 is refused - a count that lasts no ticks is a timer that cannot run.',
    refuse: (v) => (v <= 0 ? 'a count has to last at least one tick' : v > 10000 ? 'above 10000 ticks is nearly three minutes for one count' : null),
    warn: (v) => (v !== 60 ? 'every displayed count now lasts ' + (v / 60).toFixed(2) + ' seconds' : null),
  },
  {
    id: 'combo.team1.pos', sec: 'combo', key: 'team1.pos', kind: 'ipair', group: 'Combo counters',
    label: 'Player 1 side position', cite: 'fightscreen.go:2459',
    does: 'Where the combo counter for hits dealt by the left side is drawn.',
    risk: 'The counter slides in from start.x, which this module does not write - the engine mirrors that value for the right side with its own arithmetic.',
  },
  {
    id: 'combo.team2.pos', sec: 'combo', key: 'team2.pos', kind: 'ipair', group: 'Combo counters',
    label: 'Player 2 side position', cite: 'fightscreen.go:2459',
    does: 'The same for the right side. With the `team2.` prefix the engine takes this position as written; the older unprefixed form is mirrored for you.',
    risk: 'Same as above.',
  },
  {
    id: 'combo.team1.counter.font', sec: 'combo', key: 'team1.counter.font', kind: 'font', group: 'Combo counters',
    label: 'Player 1 side font', cite: 'fightscreen.go:250',
    does: 'The font the hit count is drawn in. A pack often changes it per milestone with counter10, counter20 and so on, which are left as the pack wrote them.',
    risk: 'An index the [Files] section does not declare draws nothing.',
  },
  {
    id: 'combo.team2.counter.font', sec: 'combo', key: 'team2.counter.font', kind: 'font', group: 'Combo counters',
    label: 'Player 2 side font', cite: 'fightscreen.go:250',
    does: 'The same for the right side.',
    risk: 'An index the [Files] section does not declare draws nothing.',
  },
);

const BY_ID = new Map(FIELDS.map((f) => [f.id, f]));

// The sections this module writes into, and the ones it deliberately does not.
const EDITED_SECTIONS = ['lifebar', 'powerbar', 'guardbar', 'stunbar', 'face', 'name', 'time', 'combo'];
// The prefixes that make a section a TEAM variant. The trailing space is the
// engine's own: SectionName keeps it, and the loader's switch expects it.
const TEAM_PREFIXES = ['simul ', 'simul_3p ', 'simul_4p ', 'tag ', 'tag_2p ', 'tag_3p ', 'tag_4p ', 'turns '];
// Which single section a missing team section actually inherits from. Measured
// from the loader rather than assumed, because three of the six families do
// NOT follow the obvious rule.
const TEAM_INHERITS = {
  lifebar: 'the Simul section for every family except Tag_3P and Tag_4P, which take the Tag one (fightscreen.go:5307)',
  face: 'the Simul section for every family except Tag_3P and Tag_4P, which take the Tag one (fightscreen.go:5363)',
  name: 'the Simul section for every family except Tag_3P and Tag_4P, which take the Tag one (fightscreen.go:5375)',
  powerbar: 'the single-player section, except Simul_3P/Simul_4P which take Simul and Tag_3P/Tag_4P which take Tag (fightscreen.go:5319)',
  guardbar: 'the single-player section, with the same two exceptions (fightscreen.go:5333)',
  stunbar: 'the single-player section, with the same two exceptions (fightscreen.go:5348)',
};

// ---- reading -------------------------------------------------------------------

const WS = ' \t\r\n\v\f';
function trimmed(s) {
  let a = 0, b = s.length;
  while (a < b && WS.includes(s[a])) a++;
  while (b > a && WS.includes(s[b - 1])) b--;
  return { text: s.slice(a, b), at: a };
}

// A UTF-8 byte-order mark at the very start of a file, as this module reads it
// (latin1: three characters) or as a UTF-8 reader does (one). The engine drops
// it there and only there (common.go:446-448), so the first line starts after
// it and every offset stays absolute: an edit never moves the mark.
function bomLength(text) {
  const t = String(text || '');
  if (t.startsWith('ï»¿')) return 3;
  return t.charCodeAt(0) === 0xFEFF ? 1 : 0;
}

function lineIndex(text) {
  const out = [];
  let i = bomLength(text);
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

// SectionName, exactly (common.go:793-811): the comment is cut, the brackets
// removed, and the content split at its FIRST space with that space kept on the
// name. `[Simul Lifebar]` is the name "simul " and the subname "Lifebar".
function sectionOf(lineText) {
  const cut = trimmed(String(lineText).split(';')[0]).text;
  if (!cut || cut[0] !== '[' || cut[cut.length - 1] !== ']') return null;
  const close = cut.indexOf(']');
  if (close < 0) return null;
  const inner = cut.slice(1, close);
  const sp = inner.indexOf(' ');
  return sp >= 0
    ? { name: inner.slice(0, sp + 1).toLowerCase(), sub: inner.slice(sp + 1), inner }
    : { name: inner.toLowerCase(), sub: '', inner };
}

function keyOf(text, line) {
  const raw = text.slice(line.start, line.end);
  const semi = raw.indexOf(';');
  const upto = semi >= 0 ? raw.slice(0, semi) : raw;
  const t = trimmed(upto);
  if (!t.text || t.text[0] === '[') return null;
  const eq = t.text.indexOf('=');
  if (eq < 0) return null;
  const name = trimmed(t.text.slice(0, eq)).text;
  if (!name) return null;
  const vt = trimmed(t.text.slice(eq + 1));
  const base = line.start + t.at + eq + 1;
  return { key: name.toLowerCase(), name, raw: vt.text, start: base + vt.at, end: base + vt.at + vt.text.length };
}

// The whole file as the engine reads it: the first section of each kind, and
// inside it the first copy of each key.
function readDef(text) {
  const lines = lineIndex(text);
  const out = {
    eol: eolOf(text),
    sections: new Map(),   // "lifebar" / "simul lifebar" -> {line, inner, dupe}
    keys: new Map(),       // "<section>|<key>" -> {name, raw, start, end, lineNo}
    order: [],
    dupeSections: [],
    dupeKeys: [],
  };
  let cur = null;
  for (let i = 0; i < lines.length; i++) {
    const s = sectionOf(text.slice(lines[i].start, lines[i].end));
    if (s) {
      // The switch keys on the name; the sub picks the element inside a team
      // family. One id for both, so a key is addressed the same way everywhere.
      const id = (s.name + s.sub).toLowerCase().trim().replace(/\s+/g, ' ');
      if (out.sections.has(id)) { out.dupeSections.push(s.inner); cur = null; continue; }
      out.sections.set(id, { line: i, inner: s.inner, name: s.name, sub: s.sub });
      out.order.push(id);
      cur = id;
      continue;
    }
    if (!cur) continue;
    const k = keyOf(text, lines[i]);
    if (!k) continue;
    const id = cur + '|' + k.key;
    if (out.keys.has(id)) { out.dupeKeys.push(cur + ' ' + k.name); continue; }
    out.keys.set(id, { name: k.name, raw: k.raw, start: k.start, end: k.end, lineNo: i });
  }
  return out;
}

const NUM = /^[+-]?(?:\d+\.?\d*|\.\d+)$/;
function partsOf(raw) {
  return String(raw).split(',').map((p) => p.trim());
}

// ---- values ---------------------------------------------------------------------

function parseValue(f, input, ctx) {
  const s = String(input === null || input === undefined ? '' : input).trim();
  if (s === '') return { error: 'this field cannot be left empty - clear it to go back to what the pack says' };
  if (/[eE]/.test(s)) return { error: 'write the numbers out in full: exponents belong in code, not in a screenpack' };
  const parts = partsOf(s);
  const whole = (p) => /^[+-]?\d+$/.test(p);
  const num = (p) => NUM.test(p);

  if (f.kind === 'bool') {
    if (s !== '0' && s !== '1') return { error: 'this is a switch: 0 or 1' };
    return { value: parseInt(s, 10), text: s };
  }
  if (f.kind === 'int') {
    if (!whole(s)) return { error: 'whole numbers only' };
    const n = parseInt(s, 10);
    const why = f.refuse ? f.refuse(n) : null;
    if (why) return { error: why };
    return { value: n, text: String(n), warn: f.warn ? f.warn(n) : null };
  }
  if (f.kind === 'ipair' || f.kind === 'spr') {
    if (parts.length !== 2) return { error: 'two whole numbers, separated by a comma' };
    if (!parts.every(whole)) return { error: 'two whole numbers, separated by a comma' };
    const a = parseInt(parts[0], 10), b = parseInt(parts[1], 10);
    const why = f.refusePair ? f.refusePair(a, b) : null;
    if (why) return { error: why };
    return { value: [a, b], text: a + ', ' + b };
  }
  if (f.kind === 'fpair') {
    if (parts.length !== 2 || !parts.every(num)) return { error: 'two numbers, separated by a comma' };
    const a = parseFloat(parts[0]), b = parseFloat(parts[1]);
    const why = f.refusePair ? f.refusePair(a, b) : null;
    if (why) return { error: why };
    // Each part keeps the style it was typed in, so `-.5` stays `-.5`.
    return { value: [a, b], text: parts.map((p) => (p[0] === '+' ? p.slice(1) : p)).join(', ') };
  }
  if (f.kind === 'font') {
    if (parts.length < 1 || parts.length > 8) return { error: 'between one and eight whole numbers: index, bank, alignment, then red, green, blue, alpha and height' };
    if (!parts.every(whole)) return { error: 'whole numbers only' };
    const nums = parts.map((p) => parseInt(p, 10));
    if (nums[0] !== -1 && ctx && ctx.fonts && !ctx.fonts.includes(nums[0])) {
      return {
        error: 'this pack declares no font' + nums[0] + '. The engine logs an undefined font once and draws nothing at all'
          + (ctx.fonts.length ? ' - it has ' + ctx.fonts.map((n) => 'font' + n).join(', ') : ''),
      };
    }
    if (nums.length >= 3 && (nums[2] < -1 || nums[2] > 1)) return { error: 'alignment is -1 right, 0 centered or 1 left' };
    for (let i = 3; i < Math.min(nums.length, 7); i++) {
      if (nums[i] < -1 || nums[i] > 255) return { error: 'color and alpha run from 0 to 255 (-1 leaves them alone)' };
    }
    return { value: nums, text: nums.join(', ') };
  }
  return { error: 'this value is not one the Studio writes' };
}

// ---- the plan -------------------------------------------------------------------
//
// A KEY THE FILE ALREADY HAS IS SPLICED. A KEY IT DOES NOT IS ONLY WRITTEN
// WHEN THE ENGINE'S OWN DEFAULT FOR IT IS KNOWN.
//
// fight.def has no defaults file to diff against: unlike system.def its
// defaults live in Go constructors (ENGINE-EDITING.md § 4.4). So a value the
// pack leaves out is not "unset", it is whatever the constructor put there -
// and for most of them writing a number would be inventing one with nothing to
// compare it to. Two are different, because the constructor's value is right
// there in the source and the field carries it: the portrait's palette switch
// (fightscreen.go:1749, `face_palshare: true`) and the timer's ticks per count
// (fightscreen.go:2344, 60). Those two can be added, which matters - the
// palette switch is the fix for a garbled SFF v1 lifebar face, and no stock
// pack sets it.
//
// An added key goes directly under its section's header, never at the end of
// the file: the next `[` ends the section (common.go:1010-1019), so a line
// appended after one has landed in whatever section follows.
// What each named field should read, as the file's own text, with every
// refusal raised before a byte is planned.
function targetFor(text, values, ctx) {
  const now = readDef(text);
  const target = new Map();
  const notes = [];
  for (const [id, v] of Object.entries(values || {})) {
    const f = BY_ID.get(id);
    if (!f) { const e = new Error('unknown fight screen value: ' + JSON.stringify(id)); e.code = 'invalid'; e.field = id; throw e; }
    if (v === null || v === undefined || v === '') continue;
    const p = parseValue(f, v, ctx);
    if (p.error) { const e = new Error(f.label + ': ' + p.error); e.code = 'invalid'; e.field = id; throw e; }
    if (p.warn) notes.push({ id, warn: p.warn });
    if (!now.keys.has(f.sec + '|' + f.key)) {
      if (f.def === undefined || f.def === null) {
        const e = new Error(f.label + ': this pack does not set ' + f.key + ' in its [' + f.sec
          + '] section, so the engine is using a built-in value that is not written down anywhere the Studio can read.'
          + ' The Studio changes values a pack already has rather than inventing one.');
        e.code = 'absent';
        e.field = id;
        throw e;
      }
      if (!now.sections.has(f.sec)) {
        const e = new Error(f.label + ': this pack has no [' + f.sec + '] section at all.');
        e.code = 'absent';
        e.field = id;
        throw e;
      }
    }
    target.set(id, p.text);
  }
  return { target, notes };
}

// Pass one: every value the file already holds.
function planEdits(text, target) {
  const now = readDef(text);
  const splices = [];
  for (const [id, want] of target) {
    const f = BY_ID.get(id);
    const have = now.keys.get(f.sec + '|' + f.key);
    if (have && have.raw !== want) splices.push({ start: have.start, end: have.end, text: want });
  }
  return splices;
}

// Pass two, planned against what pass one left: the two keys that may be added.
function planInserts(text, target) {
  const now = readDef(text);
  const lines = lineIndex(text);
  const add = new Map();
  for (const [id, want] of target) {
    const f = BY_ID.get(id);
    if (now.keys.has(f.sec + '|' + f.key)) continue;
    if (!add.has(f.sec)) add.set(f.sec, []);
    add.get(f.sec).push(f.key + ' = ' + want);
  }
  const out = [];
  for (const [sec, list] of add) {
    const at = lines[now.sections.get(sec).line].next;
    out.push({ start: at, end: at, text: list.join(now.eol) + now.eol, allowNewline: true });
  }
  return out;
}

function planWrite(text, values, ctx) {
  const { target, notes } = targetFor(text, values, ctx);
  const first = planEdits(text, target);
  const second = planInserts(charedit.applySplices(text, first), target);
  return { target, notes, first, second };
}

function applyEdits(text, values, ctx) {
  const plan = planWrite(text, values, ctx);
  return charedit.applySplices(charedit.applySplices(text, plan.first), plan.second);
}

// ---- the model ------------------------------------------------------------------

// The font indices the [Files] section declares, which is what a font
// parameter's first number has to be one of.
function fontsOf(read) {
  const out = [];
  for (const [id, v] of read.keys) {
    const m = /^files\|font(\d+)$/.exec(id);
    if (m && String(v.raw).trim()) out.push(parseInt(m[1], 10));
  }
  return out.sort((a, b) => a - b);
}

// `opts.sprites` is the set of "group,number" the pack's fight.sff holds, when
// it could be read. `opts.files` is {name -> resolved|null} for the [Files]
// entries, so a reference to something the pack does not ship can be named.
function describe(text, opts) {
  const o = opts || {};
  const read = readDef(text);
  const fonts = fontsOf(read);
  const fields = FIELDS.map((f) => {
    const have = read.keys.get(f.sec + '|' + f.key);
    const row = {
      id: f.id, sec: f.sec, key: f.key, kind: f.kind, group: f.group, label: f.label,
      does: f.does, risk: f.risk, cite: f.cite, def: f.def === undefined ? null : f.def,
      value: have ? have.raw : null,
      present: !!have,
      fromChar: !!f.fromChar,
      note: null,
    };
    if (!have) {
      row.note = 'this pack does not set it, so the engine uses its own built-in value';
    } else if (f.kind === 'font') {
      const n = parseInt(partsOf(have.raw)[0], 10);
      if (Number.isFinite(n) && n !== -1 && !fonts.includes(n)) {
        row.note = 'font' + n + ' is not declared in [Files], so the engine draws nothing here';
        row.bad = true;
      }
    }
    return row;
  });

  // Sprite references the pack itself owns, checked against its own .sff.
  const sprites = [];
  for (const [id, v] of read.keys) {
    const m = /^([a-z0-9_ ]+)\|(.*\.spr)$/.exec(id);
    if (!m) continue;
    const parts = partsOf(v.raw);
    if (parts.length !== 2 || !parts.every((p) => /^[+-]?\d+$/.test(p))) continue;
    // The portraits are read from the CHARACTER, not from the pack, so they
    // are not "missing" when the pack's own .sff lacks them.
    const character = /(^|\.)face\.spr$/.test(m[2]) || /teammate\.face\.spr$/.test(m[2]);
    const key = parts[0] + ',' + parts[1];
    const known = o.sprites ? o.sprites.has(key) : null;
    if (character || known !== false) continue;
    sprites.push({ section: m[1], key: v.name, value: v.raw });
  }

  // `anim` beats `spr`, but only when the file's own animation table has it.
  const anims = new Set();
  for (const id of read.sections.keys()) {
    const m = /^begin action (\d+)$/.exec(id);
    if (m) anims.add(parseInt(m[1], 10));
  }
  const badAnims = [];
  for (const [id, v] of read.keys) {
    const m = /^([a-z0-9_ ]+)\|(.*\.anim)$/.exec(id);
    if (!m) continue;
    const n = parseInt(String(v.raw).trim(), 10);
    if (!Number.isFinite(n)) continue;
    if (!anims.has(n)) badAnims.push({ section: m[1], key: v.name, value: String(n) });
  }

  // The team sections: which the pack writes, and what the engine does about
  // the rest. Listed, never written - see TEAM_INHERITS.
  const teams = [];
  for (const [sec, why] of Object.entries(TEAM_INHERITS)) {
    const present = TEAM_PREFIXES
      .filter((p) => read.sections.has((p + sec).trim()))
      .map((p) => (p + sec).trim());
    teams.push({ sec, present, missing: TEAM_PREFIXES.length - present.length, inherits: why });
  }

  const info = {};
  for (const k of ['name', 'author', 'localcoord', 'ikemenversion', 'mugenversion']) {
    const v = read.keys.get('info|' + k);
    info[k] = v ? v.raw : null;
  }

  const files = [];
  for (const [id, v] of read.keys) {
    const m = /^files\|(.+)$/.exec(id);
    if (!m) continue;
    const resolved = o.files ? o.files[v.name.toLowerCase()] : undefined;
    files.push({
      key: v.name, value: v.raw,
      found: resolved === undefined ? null : !!resolved,
      path: resolved || null,
      font: /^font\d+$/i.test(v.name),
    });
  }

  // THE ART EACH EDITED SECTION NAMES, so an element can be shown rather than
  // only described. Only the pack's own sprites: the portraits come out of each
  // character's .sff and there is no one picture of them.
  const art = [];
  for (const sec of EDITED_SECTIONS) {
    for (const [id, v] of read.keys) {
      if (!id.startsWith(sec + '|')) continue;
      const key = id.slice(sec.length + 1);
      if (!/\.spr$/.test(key) || /face\.spr$/.test(key)) continue;
      const parts = partsOf(v.raw);
      if (parts.length !== 2 || !parts.every((p) => /^[+-]?\d+$/.test(p))) continue;
      const g = parseInt(parts[0], 10), n = parseInt(parts[1], 10);
      art.push({
        sec, key: v.name, group: g, number: n,
        found: o.sprites ? o.sprites.has(g + ',' + n) : null,
      });
    }
  }

  return {
    info, fields, files, fonts, teams, art,
    sprites, badAnims,
    dupeSections: read.dupeSections,
    dupeKeys: read.dupeKeys,
    sections: [...read.sections.keys()],
    editedSections: EDITED_SECTIONS.filter((s) => read.sections.has(s)),
    missingSections: EDITED_SECTIONS.filter((s) => !read.sections.has(s)),
  };
}

// What the build's own copy differs from its source in - so the panel can show
// "changed" without keeping a second snapshot anywhere.
function changedFrom(sourceText, buildText) {
  const a = readDef(sourceText), b = readDef(buildText);
  const out = {};
  for (const f of FIELDS) {
    const x = a.keys.get(f.sec + '|' + f.key), y = b.keys.get(f.sec + '|' + f.key);
    const ax = x ? x.raw : null, by = y ? y.raw : null;
    if (ax !== by) out[f.id] = { was: ax, now: by };
  }
  return out;
}

// ---- the files on disk -------------------------------------------------------
//
// Everything above is text in, text out. This is the only part that knows where
// the files are.
const fs = require('fs');
const path = require('path');
function layout() { return require('./layout.js'); }

// Where the build looks for a screenpack, in the order the VFS merges them -
// a theme the user added wins over both engine bundles, which is the order
// modlib resolves a motif in too.
function motifBases() {
  const L = layout();
  return [L.dir('themes'), path.join(L.dir('release-v2'), 'data'), path.join(L.dir('release'), 'data')];
}

function readText(p) {
  try { return fs.readFileSync(p, 'latin1'); } catch (e) { return null; }
}

// A `[Files]`-style key out of a def, first one wins.
function defKey(text, key) {
  const re = new RegExp('^[ \\t]*' + key + '[ \\t]*=[ \\t]*([^\\r\\n;]*)', 'mi');
  const m = re.exec(String(text || ''));
  return m ? m[1].trim().replace(/"/g, '') : null;
}

// WHICH fight.def THIS BUILD ACTUALLY USES.
//
// The motif names it with `[Files] fight`, defaulting to `fight.def`
// (motif.go:82), and the engine looks in the motif's own folder, then the
// build root, then data/ - `lookup:"def,,data/"` expanded in that order
// (iniutils.go:529-547). The first candidate is also where an override has to
// go to be picked up, and putting it there leaves the engine's own
// data/fight.def and the pack's own copy untouched.
//
// WITH A LIFEBAR FROM THE LIBRARY (lifebars.js), the build uses THAT def: it is
// the source, it is mounted at data/<motif>/studio-lifebar/<def>, and the
// build's own edited copy of it is kept per library pack - so an old copy of
// another lifebar under the same file name can never shadow it.
function resolve(roster) {
  const r = roster || require('./vfslib.js').readRoster();
  const res = resolveScreenpack(r);
  let lbs = null;
  try { lbs = require('./lifebars.js'); } catch (e) { lbs = null; }
  const mix = lbs ? lbs.normalizeMix(r[lbs.MIX_KEY]) : null;
  const pick = mix && mix.lifebar ? lbs.findDef(mix.lifebar) : null;
  if (!pick || !res.motifFolder) return res;
  const defRel = String(pick.entry.def);
  const fightRel = lbs.MOUNT_DIR + '/' + defRel;
  const ownPath = lbs.ownPathFor(mix.lifebar.pack, defRel);
  // Neither the library's file nor an edited copy of it: the build keeps the
  // screenpack's own (lifebars.mounts ships nothing), so that is what this
  // edits and describes.
  if (!fs.existsSync(ownPath) && !fs.existsSync(path.join(pick.dir, ...defRel.split('/')))) return res;
  return Object.assign({}, res, {
    fightRel,
    source: path.join(pick.dir, ...defRel.split('/')),
    sourceRel: 'lifebars/' + mix.lifebar.pack + '/' + defRel,
    vpath: 'data/' + res.motifFolder + '/' + fightRel,
    ownDir: path.dirname(ownPath), ownPath,
    library: { pack: mix.lifebar.pack, def: defRel, name: pick.entry.name, packName: pick.manifest.name, packDir: pick.dir },
  });
}

// The fight def the screenpack itself names, with no lifebar from the library.
function resolveScreenpack(roster) {
  const L = layout();
  const r = roster || require('./vfslib.js').readRoster();
  let motifRel = String(r.motif || 'data/ikemen1/system.def').replace(/^data\//, '');
  let motifPath = null;
  for (const base of motifBases()) {
    const p = path.join(base, motifRel);
    if (fs.existsSync(p)) {
      motifPath = p;
      // The folder and file as the DISK spells them: builds are keyed by the
      // disk's names, and a roster may carry another spelling.
      const segs = motifRel.split('/');
      let cur = base;
      for (let i = 0; i < segs.length; i++) {
        let ents = [];
        try { ents = fs.readdirSync(cur); } catch (e) { ents = []; }
        const hit = ents.find((n) => n === segs[i]) || ents.find((n) => n.toLowerCase() === segs[i].toLowerCase());
        if (hit) segs[i] = hit;
        cur = path.join(cur, segs[i]);
      }
      motifRel = segs.join('/');
      break;
    }
  }
  const motifFolder = motifRel.includes('/') ? motifRel.slice(0, motifRel.lastIndexOf('/')) : '';
  const motifText = motifPath ? readText(motifPath) : null;
  const fightRel = (motifText && defKey(motifText, 'fight')) || 'fight.def';
  // The engine's three places, each searched across every base (each base is
  // a data/ folder): the motif's folder, the game folder - which reaches a
  // data/ file only through a value that starts with data/ (EVEREDUX's
  // `fight =data/fight.def` is the engine's own) - then data/. From the game
  // folder only what an export carries counts, as in modlib.themeBootMissing:
  // a file directly in data/, or one in the pack's own folder, never another
  // installed pack's.
  const inMotif = motifFolder ? motifFolder + '/' + fightRel : fightRel;
  const fromGame = path.posix.normalize(fightRel.replace(/\\/g, '/'));
  const rest = /^data\/./i.test(fromGame) ? fromGame.slice(5) : null;
  const atGame = rest && (!rest.includes('/') || (motifFolder && rest.toLowerCase().startsWith(motifFolder.toLowerCase() + '/'))) ? rest : null;
  let source = null, where = null;
  for (const rel of [inMotif, atGame, fightRel].filter(Boolean)) {
    for (const base of motifBases()) {
      const p = path.join(base, rel);
      if (fs.existsSync(p)) { source = p; where = rel; break; }
    }
    if (source) break;
  }
  // The override always goes at the FIRST place the engine looks, whatever the
  // pack's own copy is: the motif's own folder, under the name it asked for.
  const vpath = 'data/' + inMotif;
  const ownDir = path.join(L.dir('engine'), motifFolder || '_default');
  return {
    motif: 'data/' + motifRel, motifFolder, motifPath, fightRel,
    source, sourceRel: where ? 'data/' + where : null,
    vpath, ownDir, ownPath: path.join(ownDir, path.basename(fightRel)),
  };
}

// The pack's own fight.sff, and every [Files] entry resolved the way the engine
// resolves it - so a reference to something the pack does not ship can be named.
function filesFor(res, text) {
  const out = {};
  if (!res.source) return out;
  const read = readDef(text);
  const dirs = [path.dirname(res.source)];
  if (res.motifPath) dirs.push(path.dirname(res.motifPath));
  for (const base of motifBases()) dirs.push(base);
  for (const [id, v] of read.keys) {
    const m = /^files\|(.+)$/.exec(id);
    if (!m || !String(v.raw).trim()) continue;
    const rel = String(v.raw).trim().replace(/\\/g, '/');
    let hit = null;
    for (const d of dirs) {
      // Fonts get one more probe per directory, inside font/ (font.go:413,
      // common.go:660-681).
      for (const cand of [path.join(d, rel), path.join(d, 'font', rel)]) {
        if (fs.existsSync(cand)) { hit = cand; break; }
      }
      if (hit) break;
    }
    out[v.name.toLowerCase()] = hit;
  }
  return out;
}

let SFF_CACHE = null;
function packSff(res, files) {
  if (!res.source) return null;
  const sffPath = files && files.sff;
  if (!sffPath) return null;
  let stamp = '-';
  try { const st = fs.statSync(sffPath); stamp = st.size + '@' + st.mtimeMs; } catch (e) { /* gone */ }
  const key = sffPath + '|' + stamp;
  if (SFF_CACHE && SFF_CACHE.key === key) return SFF_CACHE.sff;
  let sff = null;
  try { sff = require('./tools/sff-decode.js').readSff(sffPath); } catch (e) { sff = null; }
  SFF_CACHE = { key, sff };
  return sff;
}

// The decoder indexes its sprites by "group,number" already, which is exactly
// how a fight.def names one.
function spriteKeys(sff) {
  if (!sff || !(sff.byKey instanceof Map)) return null;
  return new Set(sff.byKey.keys());
}

// One sprite of the pack's own fight.sff, as a PNG - so an element can be shown
// rather than only described.
function spritePng(group, index) {
  try {
    const res = resolve();
    const text = ownText(res) || (res.source && readText(res.source));
    if (!text) return null;
    const sff = packSff(res, filesFor(res, text));
    if (!sff) return null;
    return require('./tools/sff-decode.js').spritePng(sff, group, index);
  } catch (e) { return null; }
}

function ownText(res) { return readText(res.ownPath); }

// Does this build carry its own lifebars? Only when the file is there AND it
// belongs to the motif in use - the copy lives in a folder named after that
// motif, so switching screenpacks puts the build back on the pack's own.
function buildOverride(roster) {
  const r = roster || require('./vfslib.js').readRoster();
  // A lifebar mix (lifebars.js) decides the def the build ships: the library
  // def or the screenpack's own, the build's own edited copy of it when there
  // is one, then the mix's changes (coordinate space, sparks, sounds, clock).
  let mixed = null;
  try { mixed = require('./lifebars.js').mounts(r); } catch (e) { mixed = null; }
  const res = resolve(r);
  if (mixed && mixed.def) return { res, text: mixed.def.text, vpath: mixed.def.vpath, mixed };
  const text = ownText(res);
  if (text === null) return null;
  return { res, text, vpath: res.vpath };
}

// What the panel shows.
function state(roster) {
  const L = layout();
  const res = resolve(roster);
  const own = ownText(res);
  const sourceText = res.source ? readText(res.source) : null;
  const text = own !== null ? own : sourceText;
  const rel = (p) => (p ? path.relative(L.APP, p).replace(/\\/g, '/') : null);
  if (text === null) {
    return {
      ok: false,
      why: 'this build’s screenpack does not resolve a ' + res.fightRel + ' anywhere the engine would find it',
      motif: res.motif, fightRel: res.fightRel,
      sourcePath: null, ownPath: rel(res.ownPath), ownExists: false, vpath: res.vpath,
    };
  }
  const files = filesFor(res, text);
  const model = describe(text, { files, sprites: spriteKeys(packSff(res, files)) });
  return Object.assign(model, {
    ok: true,
    motif: res.motif,
    motifFolder: res.motifFolder,
    fightRel: res.fightRel,
    sourcePath: rel(res.source),
    sourceRel: res.sourceRel,
    // Whether the file the build uses belongs to the engine's own installation
    // or to a screenpack the user added. The first is never written.
    sourceIsEngine: !!res.source && !res.library && !res.source.toLowerCase().startsWith(String(L.dir('themes')).toLowerCase()),
    // A lifebar from the bundle's library (the Theme tab's choice), or null.
    library: res.library ? { pack: res.library.pack, def: res.library.def, name: res.library.name, packName: res.library.packName } : null,
    // With a library lifebar, which round clock ships (the Theme tab's round
    // clock decides between the lifebar's and the screenpack's).
    roundClock: res.library ? (() => { try { return require('./lifebars.js').clockReport(roster); } catch (e) { return null; } })() : null,
    ownPath: rel(res.ownPath),
    ownExists: own !== null,
    vpath: res.vpath,
    bundle: L.ACTIVE_BUNDLE.name,
    backup: fs.existsSync(charedit.backupPath(res.ownPath)),
    changed: own !== null && sourceText !== null ? changedFrom(sourceText, own) : {},
  });
}

// Take the build's own copy of the lifebars: a byte copy of the file the build
// resolves today, in the bundle's content, under the motif it belongs to.
function makeOwnCopy() {
  const res = resolve();
  if (fs.existsSync(res.ownPath)) return { made: false, path: res.ownPath };
  if (!res.source) throw new Error('there is no fight.def to copy: this build’s screenpack does not resolve one');
  fs.mkdirSync(res.ownDir, { recursive: true });
  fs.copyFileSync(res.source, res.ownPath);
  return { made: true, path: res.ownPath, from: res.source };
}

// Write. The first call takes the copy, so a value can be changed without
// thinking about where the file came from.
function write(values) {
  const res = resolve();
  makeOwnCopy();
  const text = readText(res.ownPath);
  const files = filesFor(res, text);
  const ctx = { fonts: fontsOf(readDef(text)) };
  const plan = planWrite(text, values, ctx);
  if (!plan.first.length && !plan.second.length) return { changed: false, notes: plan.notes };
  charedit.writeSpliced(res.ownPath, null, {
    expectText: text,
    passes: [plan.first, plan.second],
    validate: (newText) => {
      const after = readDef(newText);
      for (const [id, want] of plan.target) {
        const f = BY_ID.get(id);
        const h = after.keys.get(f.sec + '|' + f.key);
        if (!h || h.raw !== want) return f.key + ' reads back as ' + JSON.stringify(h ? h.raw : null) + ', not ' + JSON.stringify(want);
      }
      const before = readDef(text);
      for (const s of before.sections.keys()) if (!after.sections.has(s)) return 'the [' + s + '] section disappeared';
      if (after.keys.size !== before.keys.size + plan.second.reduce((n, s) => n + s.text.split('\n').filter(Boolean).length, 0)) {
        return 'the file gained or lost a key it should not have';
      }
      return null;
    },
  });
  // A library lifebar's clock ships only when the Theme tab's round clock is
  // "the lifebar's" (by default the screenpack's value is kept): an edit of it
  // here is a choice of it, so the clock follows the edit.
  if (res.library && plan.target.has('time.framespercount')) {
    try {
      const lbs = require('./lifebars.js');
      const mix = lbs.normalizeMix(require('./vfslib.js').readRoster()[lbs.MIX_KEY]);
      if (mix.clock !== 'lifebar') {
        lbs.choose({ clock: 'lifebar', clockBy: 'edit' });
        plan.notes.push({ id: 'time.framespercount', warn: 'the Theme tab’s round clock now uses this lifebar’s value, so this is what the build ships' });
      }
    } catch (e) { /* the edit stands; the Theme tab shows which clock ships */ }
  }
  return { changed: true, notes: plan.notes, files };
}

// Drop the build's own copy: back to the pack's, byte for byte, and the backup
// with it.
function revert() {
  const res = resolve();
  if (!fs.existsSync(res.ownPath)) return { reverted: false };
  // Checked deletes (lifebars.js): the build's copy that stayed would still
  // ship after a revert reported done.
  const lbs = require('./lifebars.js');
  lbs.rmFile(res.ownPath);
  lbs.rmFile(charedit.backupPath(res.ownPath));
  try { fs.rmdirSync(res.ownDir); } catch (e) { /* the folder may hold another motif's copy */ }
  // An edit of a library lifebar's Ticks per count switched the Theme tab's
  // round clock to the lifebar's (write); putting the copy back puts the
  // clock back too, so the build is where it was before the edit.
  let clockBack = false;
  if (res.library) {
    try {
      const lbs = require('./lifebars.js');
      const mix = lbs.normalizeMix(require('./vfslib.js').readRoster()[lbs.MIX_KEY]);
      if (mix.clock === 'lifebar' && mix.clockBy === 'edit') { lbs.choose({ clock: 'screenpack' }); clockBack = true; }
    } catch (e) { /* the copy is gone either way */ }
  }
  return { reverted: true, clockBack };
}

module.exports = {
  FIELDS, BY_ID, EDITED_SECTIONS, TEAM_PREFIXES, TEAM_INHERITS,
  bomLength, lineIndex, eolOf, sectionOf, keyOf, readDef, fontsOf,
  parseValue, targetFor, planEdits, planInserts, planWrite, applyEdits, describe, changedFrom,
  resolve, resolveScreenpack, filesFor, spriteKeys, spritePng, buildOverride, state, makeOwnCopy, write, revert,
};
