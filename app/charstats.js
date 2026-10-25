'use strict';
// THE REST OF A CHARACTER'S CONSTANTS - the numbers the card's Advanced side
// edits beyond health, movement speed and size.
//
// Eleven values across three sections of the character's own .cns:
//
//   [Data]      attack, defence, power, dizzypoints, guardpoints
//   [Velocity]  jump.neu's y (jump height), jump.fwd, jump.back
//   [Movement]  yaccel (gravity), stand.friction, crouch.friction
//
// WHY THIS IS NOT A LINE-BASED PATCHER.
//
// A .cns is latin1 or Shift-JIS, full of the author's own comments, and the
// engine's ini reader has position-sensitive failure modes. So an edit here
// replaces exactly the bytes of the number it changes and nothing else, the
// way the move editor does (charedit.js): comments, column alignment, the
// file's own line endings and every untouched byte come back identical.
//
// THE ENGINE RULES THIS FILE ENCODES (source at ikemen-go-src/src, 96413d2):
//
//  * FIRST SECTION WINS and FIRST KEY WINS. The latches at char.go:3989 clear
//    on the first [Data]/[Size]/[Velocity]/[Movement] match, and
//    IniSection.Parse only stores a key it has not seen (common.go:1016-1019).
//    So a value is patched IN PLACE in the first section that owns it, and a
//    missing key is inserted directly under that section's header - never
//    appended at the end of the file, where a second [Data] is read into a map
//    and thrown away.
//  * `[Data ]` IS NOT `[Data]`. SectionName (common.go:793-811) splits the
//    bracket content at its first space and keeps that space in the name, so
//    `[Data ]` yields "data " and never matches - the whole block silently
//    reverts to engine defaults. A section written that way is refused rather
//    than patched, because patching it would change a number the engine does
//    not read.
//  * THE VALUE ENDS AT THE FIRST `;`. Parse strips the comment before reading
//    (common.go:1007), so the splice must stop there and leave the author's
//    note where it is.
//  * A VECTOR IS SPLIT ON COMMAS AND EACH PART READ SEPARATELY, and an empty
//    part is skipped (common.go:1039-1044, 1055-1060). `jump.neu` is two
//    numbers, and only its y is exposed - so only the y's bytes move.
//  * THE SCANNER NEVER ERRORS. Atoi/Atof (common.go:212, 243) accumulate
//    digits and stop at the first character that is not one, returning 0 for
//    junk with no diagnostic anywhere. Everything written here is validated
//    first, because the engine will not.
//
// Everything is pure text in, text out: no file IO and no roster, so the
// server wrapper and the tests use the same functions.
const charedit = require('./charedit');

// ---- the fields ------------------------------------------------------------
//
// `cite` is the line in ikemen-go-src/src/char.go that reads the key. `def` is
// the engine's own built-in default, installed by initConstants (char.go:7924)
// before the .cns is read - and for gravity and the jump speeds that default,
// and only the default, is scaled by localcoord[0]/320 (char.go:7847-7920),
// which is why `coord` is set on those three: a value the author wrote is in
// the character's own space and a 640-wide character's 0.44 is half the
// gravity a 320-wide character gets by default.
//
// `refuse` returns the reason a value cannot be written; `warn` returns a
// reason it is legal but will not behave. THE LINE BETWEEN THEM, and it is the
// same line everywhere in this file: a value is REFUSED when the engine's own
// arithmetic breaks on it - a division by zero, or a sign flip that turns a
// system inside out (healing on a hit, falling upward, jumping into the
// floor). A value is WARNED about when it is merely extreme or unplayable. The
// engine accepts both and reports neither.
const FIELDS = [
  {
    id: 'data.attack', sec: 'Data', key: 'attack', kind: 'int', group: 'Power',
    label: 'Attack power', unit: '%', def: 100, sane: [25, 400], cite: 'char.go:4022',
    does: 'Multiplies every point of damage this character deals: damage x (attackMul x attack/100).',
    risk: '0 makes every hit deal exactly 0 - with the hit pause, the hitstun and the state change still happening. A negative number heals the opponent instead.',
    refuse: (v) => (v < 0 ? 'a negative attack heals the opponent on every hit' : v > 1000 ? 'above 1000% is not an attack value' : null),
    warn: (v) => (v === 0 ? 'every hit will deal exactly 0 damage' : null),
  },
  {
    id: 'data.defence', sec: 'Data', key: 'defence', kind: 'int', group: 'Power',
    label: 'Defence', unit: '%', def: 100, sane: [25, 400], cite: 'char.go:4024',
    does: 'Divides every point of damage this character takes. Higher is tougher.',
    risk: '0 is an instant KO, not a crash: incoming damage is divided by it, and the result is clamped to whatever life is left. A negative number makes the character HEAL when hit.',
    refuse: (v) => (v === 0 ? 'damage is divided by defence, so 0 makes every hit an instant KO'
      : v < 0 ? 'a negative defence makes the character heal when hit'
        : v > 1000 ? 'above 1000% is not a defence value' : null),
  },
  {
    id: 'data.power', sec: 'Data', key: 'power', kind: 'int', group: 'Power',
    label: 'Super meter', unit: 'units', def: 3000, sane: [1000, 9000], cite: 'char.go:4014',
    does: 'How much super meter the character can hold. 1000 units is one meter level.',
    risk: '0 is not how you make a meterless character: the power bar computes 0/0 and draws a number that is not a number. Use 1.',
    refuse: (v) => (v <= 0 ? 'the power bar divides by this, so 0 or less draws a number that is not a number - for a meterless character use 1' : v > 100000 ? 'above 100000 units is not a meter' : null),
    warn: (v) => (v < 1000 ? 'less than one full meter level' : null),
  },
  {
    id: 'data.dizzypoints', sec: 'Data', key: 'dizzypoints', kind: 'int', group: 'Power',
    label: 'Stun meter', unit: 'points', def: null, follows: 'life', sane: [500, 4000], cite: 'char.go:4016',
    does: 'How much stun the character absorbs before being dizzied. Only used when Dizzy is on in the match rules.',
    risk: 'The default is this character\'s own life, not 1000. Writing a number here pins it: it stops following a health change.',
    refuse: (v) => (v <= 0 ? 'the stun bar divides by this, so 0 or less draws a number that is not a number' : v > 100000 ? 'above 100000 points is not a stun meter' : null),
  },
  {
    id: 'data.guardpoints', sec: 'Data', key: 'guardpoints', kind: 'int', group: 'Power',
    label: 'Guard meter', unit: 'points', def: null, follows: 'life', sane: [500, 4000], cite: 'char.go:4019',
    does: 'How much blocked damage the character absorbs before a guard break. Only used when Guard Break is on in the match rules.',
    risk: 'The default is this character\'s own life, not 1000. Writing a number here pins it: it stops following a health change.',
    refuse: (v) => (v <= 0 ? 'the guard bar divides by this, so 0 or less draws a number that is not a number' : v > 100000 ? 'above 100000 points is not a guard meter' : null),
  },

  {
    id: 'velocity.jump.neu.y', sec: 'Velocity', key: 'jump.neu', part: 1, parts: 2, kind: 'float',
    group: 'Jumping', label: 'Jump height', unit: 'px/tick', def: 0, coord: true,
    sane: [-12, -8], cite: 'char.go:4117',
    does: 'The upward speed of every ground jump, in any direction - the forward and back jump only change the horizontal speed. Negative is up.',
    risk: 'A positive number is downward: the character lands on the same tick it jumped. 0 means it never leaves the ground.',
    refuse: (v) => (v > 0 ? 'positive is downward here - the character would land on the tick it jumped' : v < -60 ? 'below -60 px per tick is not a jump' : null),
    warn: (v) => (v === 0 ? 'the character will never leave the ground' : null),
  },
  {
    id: 'velocity.jump.fwd', sec: 'Velocity', key: 'jump.fwd', kind: 'float', group: 'Jumping',
    label: 'Forward jump speed', unit: 'px/tick', def: 0, coord: true, sane: [1, 6], cite: 'char.go:4120',
    does: 'How far a forward jump carries the character. Facing-relative, so positive is toward the opponent.',
    risk: 'Negative here means a forward jump travels backwards while the forward-jump animation plays.',
    refuse: (v) => (v < 0 ? 'a negative forward jump travels backwards while the forward-jump animation plays' : v > 60 ? 'above 60 px per tick is not a jump' : null),
  },
  {
    id: 'velocity.jump.back', sec: 'Velocity', key: 'jump.back', kind: 'float', group: 'Jumping',
    label: 'Back jump speed', unit: 'px/tick', def: 0, coord: true, sane: [-4, -2], cite: 'char.go:4119',
    does: 'How far a back jump carries the character. Facing-relative, so it must be negative.',
    risk: 'Positive here means a back jump travels forwards while the back-jump animation plays.',
    refuse: (v) => (v > 0 ? 'a positive back jump travels forwards while the back-jump animation plays' : v < -60 ? 'below -60 px per tick is not a jump' : null),
  },
  {
    id: 'movement.yaccel', sec: 'Movement', key: 'yaccel', kind: 'float', group: 'Jumping',
    label: 'Gravity', unit: 'px/tick2', def: 0.44, coord: true, sane: [0.25, 1.2], cite: 'char.go:4180',
    does: 'Added to the character\'s downward speed once per tick while airborne. Higher is a shorter, snappier jump.',
    risk: '0 means the character never falls: a jump becomes permanent air time and the landing states never run. This is only the NORMAL gravity - the air tech and the floor bounce each have their own, and they do not follow it.',
    refuse: (v) => (v < 0 ? 'negative gravity accelerates the character upward - it never comes down' : v > 20 ? 'above 20 px per tick squared is not gravity' : null),
    warn: (v) => (v === 0 ? 'the character will never fall, and its landing states will never run' : null),
  },

  {
    id: 'movement.stand.friction', sec: 'Movement', key: 'stand.friction', kind: 'float', group: 'Ground',
    label: 'Standing friction', unit: 'x per tick', def: 0.85, sane: [0.5, 0.99], cite: 'char.go:4181',
    does: 'The character\'s horizontal speed is multiplied by this every tick while standing. Lower stops faster.',
    risk: '1 is frictionless ice - the character slides until the engine\'s own hard cutoff catches it. Above 1 it speeds up on its own, every tick, forever.',
    refuse: (v) => (v < 0 ? 'a negative multiplier flips the character\'s speed every tick - it jitters on the spot' : v > 10 ? 'above 10 is not a friction multiplier' : null),
    warn: (v) => (v >= 1 ? (v === 1 ? 'frictionless: the character slides until the engine\'s own cutoff stops it' : 'above 1 the character accelerates on its own, every tick') : null),
  },
  {
    id: 'movement.crouch.friction', sec: 'Movement', key: 'crouch.friction', kind: 'float', group: 'Ground',
    label: 'Crouching friction', unit: 'x per tick', def: 0.82, sane: [0.5, 0.99], cite: 'char.go:4184',
    does: 'The same multiplier while crouching.',
    risk: 'The crouch branch applies no speed cutoff at all, unlike the standing one, so a slide here never snaps to a stop.',
    refuse: (v) => (v < 0 ? 'a negative multiplier flips the character\'s speed every tick - it jitters on the spot' : v > 10 ? 'above 10 is not a friction multiplier' : null),
    warn: (v) => (v >= 1 ? (v === 1 ? 'frictionless: nothing stops a crouching slide' : 'above 1 the character accelerates on its own, every tick') : null),
  },
];

const BY_ID = new Map(FIELDS.map((f) => [f.id, f]));
// The sections this file writes into, in the order the engine reads them.
const SECTIONS = ['Data', 'Velocity', 'Movement'];
// Keys the engine derives from jump.* at parse time when the character does
// not declare them (char.go:4122-4128), so editing a jump speed also moves
// these. Only true while the key is absent from [Velocity].
const JUMP_CASCADE = {
  'velocity.jump.neu.y': ['runjump.back', 'runjump.fwd', 'airjump.neu'],
  'velocity.jump.fwd': ['runjump.fwd', 'airjump.fwd'],
  'velocity.jump.back': ['runjump.back', 'airjump.back'],
};

// ---- the file ---------------------------------------------------------------

const WS = ' \t\r\n\v\f';
function trimmed(s) {
  let a = 0, b = s.length;
  while (a < b && WS.includes(s[a])) a++;
  while (b > a && WS.includes(s[b - 1])) b--;
  return { text: s.slice(a, b), at: a };
}

// Every line with its byte offsets. latin1 in means one char is one byte, so
// a string offset IS a byte offset.
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

// The file's own line ending, so an inserted line matches the rest.
function eolOf(text) {
  const crlf = (text.match(/\r\n/g) || []).length;
  const lf = (text.match(/\n/g) || []).length;
  return crlf > 0 && crlf * 2 >= lf ? '\r\n' : '\n';
}

// The engine's section name: bracket content up to the first `]`, split at its
// first space with the space KEPT (common.go:793-811). A name with a space in
// it therefore matches nothing - the section is dead.
function sectionOf(lineText) {
  const t = trimmed(lineText).text.split(';')[0];
  const s = trimmed(t).text;
  if (!s || s[0] !== '[' || s[s.length - 1] !== ']') return null;
  const close = s.indexOf(']');
  const inner = s.slice(1, close);
  const sp = inner.indexOf(' ');
  return { name: (sp >= 0 ? inner.slice(0, sp + 1) : inner).toLowerCase(), dead: sp >= 0, inner };
}

// The key a line declares: the name ends at the first `=`, space or tab, after
// the comment is stripped (common.go:1007-1012). Returns the key plus the byte
// span of the value, comment excluded.
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
  const key = m[0].toLowerCase();
  // The value runs from just after the `=` to the end of the comment-free part,
  // with the engine's own TrimSpace applied to decide the span.
  const valRaw = t.text.slice(eq + 1);
  const vt = trimmed(valRaw);
  const base = line.start + t.at + eq + 1;
  return { key, valueStart: base + vt.at, valueEnd: base + vt.at + vt.text.length, value: vt.text };
}

// Split a value into its comma-separated parts with byte spans. An empty part
// is a real thing to the engine: it skips that component and keeps the default
// (common.go:1039-1044).
function partsOf(text, valueStart, valueEnd) {
  const out = [];
  let at = valueStart;
  const whole = text.slice(valueStart, valueEnd);
  for (const piece of whole.split(',')) {
    const t = trimmed(piece);
    out.push({ start: at + t.at, end: at + t.at + t.text.length, text: t.text });
    at += piece.length + 1;
  }
  return out;
}

// What the file holds for every exposed field, plus where each one lives.
//
// `life` comes back too: dizzypoints and guardpoints default to it, not to
// 1000 (char.go:4016, 4019), so a panel cannot state their default without it.
function readStats(text) {
  const lines = lineIndex(text);
  const secs = new Map();      // lowercase name -> {index, dead, headerLine}
  let cur = null;
  const rows = [];             // {sec, key, line, ...} in file order
  for (let i = 0; i < lines.length; i++) {
    const s = sectionOf(text.slice(lines[i].start, lines[i].end));
    if (s) {
      cur = s;
      if (!secs.has(s.name)) secs.set(s.name, { line: i, dead: s.dead, inner: s.inner });
      continue;
    }
    if (!cur) continue;
    const k = keyOf(text, lines[i]);
    if (k) rows.push(Object.assign({ sec: cur.name, lineNo: i }, k));
  }
  const firstOf = (secName, key) => rows.find((r) => r.sec === secName && r.key === key);

  const out = { eol: eolOf(text), sections: {}, fields: {}, life: null };
  for (const name of SECTIONS) {
    const low = name.toLowerCase();
    const s = secs.get(low);
    // A section whose name carries a space never matches: its whole block is
    // dead to the engine. Report the spelling so the panel can say which.
    const dead = [...secs.entries()].find(([n, v]) => v.dead && n.trim() === low);
    out.sections[name] = s
      ? { present: true, line: s.line, dead: false }
      : { present: false, dead: dead ? '[' + dead[1].inner + ']' : null };
  }
  {
    const r = firstOf('data', 'life');
    if (r && /^-?\d+$/.test(r.value)) out.life = parseInt(r.value, 10);
  }
  for (const f of FIELDS) {
    const low = f.sec.toLowerCase();
    const r = firstOf(low, f.key);
    if (!r) { out.fields[f.id] = { present: false }; continue; }
    const parts = partsOf(text, r.valueStart, r.valueEnd);
    const idx = f.part || 0;
    const p = parts[idx];
    out.fields[f.id] = {
      present: !!(p && p.text !== ''),
      keyPresent: true,
      lineNo: r.lineNo,
      raw: p ? p.text : '',
      wholeRaw: r.value,
      start: p ? p.start : r.valueEnd,
      end: p ? p.end : r.valueEnd,
      parts: parts.length,
    };
  }
  // Which of the jump-derived keys the character declares for itself. A key it
  // does NOT declare takes its value from jump.* at parse time, so editing a
  // jump speed moves that one too.
  out.declares = {};
  for (const k of ['runjump.back', 'runjump.fwd', 'airjump.neu', 'airjump.back', 'airjump.fwd']) {
    out.declares[k] = !!firstOf('velocity', k);
  }
  return out;
}

// ---- values ----------------------------------------------------------------

// What the engine would read for a field when the file does not say. `life` is
// the character's own, because that is what dizzypoints and guardpoints fall
// back to.
function defaultFor(f, life) {
  if (f.follows === 'life') return life === null || life === undefined ? 1000 : life;
  return f.def;
}

const INT_RE = /^[+-]?\d+$/;
const FLOAT_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)$/;

// Text in, a number and a written form out - or a reason it cannot be written.
//
// The engine would take almost anything here and quietly read 0 out of it, so
// this is the only place that says no. Exponents are refused rather than
// converted: the engine's own Atof does read them (common.go:264-278), but a
// .cns is read by other tools too and `1e3` in a constants file is a bug
// report waiting to happen - the same rule the move editor uses.
function parseValue(f, input) {
  const s = String(input === null || input === undefined ? '' : input).trim();
  if (s === '') return { error: 'this field cannot be left empty - use Put these back to restore what the character shipped with' };
  if (/[eE]/.test(s)) return { error: 'write the number out in full: exponents belong in code, not in a .cns' };
  if (f.kind === 'int') {
    if (!INT_RE.test(s)) return { error: 'whole numbers only' };
  } else if (!FLOAT_RE.test(s)) {
    return { error: 'numbers only' };
  }
  const n = f.kind === 'int' ? parseInt(s, 10) : parseFloat(s);
  if (!isFinite(n)) return { error: 'not a number' };
  const why = f.refuse ? f.refuse(n) : null;
  if (why) return { error: why };
  // Whole numbers are written plainly; a decimal keeps the author's style, so
  // `-.8` typed back stays `-.8` rather than becoming `-0.8`.
  const written = f.kind === 'int' ? String(n) : (s[0] === '+' ? s.slice(1) : s);
  return { value: n, text: written, warn: f.warn ? f.warn(n) : null };
}

// ---- the plan ---------------------------------------------------------------

// The splices that make the file hold exactly `wanted`, starting from what
// `base` says the file held when the character was first edited.
//
// `base` is the SNAPSHOT - {id: {present, keyPresent, raw}} - taken before the
// first write, so a field the user has not set is restored to what the
// character shipped with rather than left at whatever the last edit made it.
// That is the same contract health, speed and size already keep: repeated
// changes never compound, and there is always a way back.
//
// SO `wanted` IS THE WHOLE STATE, NOT A DELTA. A field it does not name goes
// back to the snapshot. A caller that has other fields set must pass them all;
// that is what makes one reset able to undo everything at once.
//
// A missing key is inserted directly under its section's header. A missing
// SECTION is appended at the end of the file, which is the one place a new
// section can go and be read (there is no earlier one to win over it).
//
// TWO PASSES, because a removal and an insertion can want the same byte. A
// field put back to "shipped" is removed by deleting the line it was written
// on, and that line can be exactly where another field's new line goes - one
// splice list cannot hold both without overlapping. So the replacements and
// removals go first, the file is re-read, and the insertions are planned
// against what that left. Both passes are text in, text out; only one file is
// ever written.
function targetFor(base, wanted) {
  const target = {};
  const notes = [];
  for (const f of FIELDS) {
    if (Object.prototype.hasOwnProperty.call(wanted || {}, f.id)) {
      const w = wanted[f.id];
      if (w === null || w === undefined || w === '') {
        // Cleared: back to the snapshot, i.e. to what the character shipped.
        target[f.id] = (base && base[f.id] && base[f.id].present) ? base[f.id].raw : null;
      } else {
        const p = parseValue(f, w);
        if (p.error) { const e = new Error(f.label + ': ' + p.error); e.code = 'invalid'; e.field = f.id; throw e; }
        target[f.id] = p.text;
        if (p.warn) notes.push({ id: f.id, warn: p.warn });
      }
    } else if (base && base[f.id]) {
      target[f.id] = base[f.id].present ? base[f.id].raw : null;
    }
  }
  return { target, notes };
}

// Pass one: every value that is already in the file, and every line to remove.
function planEdits(text, base, target) {
  const now = readStats(text);
  const lines = lineIndex(text);
  const splices = [];
  // A line may only be deleted when NOTHING exposed still wants that key - a
  // vector shared by two fields keeps its line while either is set.
  const keyWanted = new Map();
  for (const f of FIELDS) {
    const k = f.sec + '|' + f.key;
    if (target[f.id] !== null && target[f.id] !== undefined) keyWanted.set(k, true);
    else if (!keyWanted.has(k)) keyWanted.set(k, false);
  }
  for (const [id, want] of Object.entries(target)) {
    const f = BY_ID.get(id);
    const have = now.fields[id];
    if (want === null) {
      if (!have.keyPresent) continue;
      // The key was in the file when the character was added: put the
      // component's own bytes back to blank only if it shipped blank.
      const shippedKey = base && base[id] && base[id].keyPresent;
      if (!shippedKey && !keyWanted.get(f.sec + '|' + f.key)) {
        const ln = lines[have.lineNo];
        splices.push({ start: ln.start, end: ln.next, text: '', allowNewline: true });
      } else if (have.present) {
        splices.push({ start: have.start, end: have.end, text: '' });
      }
      continue;
    }
    if (!have.keyPresent) continue;              // pass two writes it
    if (have.raw !== want) splices.push({ start: have.start, end: have.end, text: want });
  }
  return splices;
}

// Pass two: the keys and sections that are still missing.
function planInserts(text, target) {
  const now = readStats(text);
  const lines = lineIndex(text);
  const splices = [];
  const inserts = new Map();
  const newSections = [];
  for (const [id, want] of Object.entries(target)) {
    if (want === null) continue;
    const f = BY_ID.get(id);
    const have = now.fields[id];
    if (have.keyPresent) {
      // The key is there but this component is empty. Fill just that part.
      if (!have.present) splices.push({ start: have.start, end: have.end, text: want });
      continue;
    }
    const sec = now.sections[f.sec];
    // The other components of a vector are written at the engine's own
    // default, so nothing is invented.
    let line;
    if (f.parts && f.parts > 1) {
      const vals = [];
      for (let i = 0; i < f.parts; i++) vals.push(i === (f.part || 0) ? want : String(f.def === null ? 0 : f.def));
      line = f.key + ' = ' + vals.join(', ');
    } else {
      line = f.key + ' = ' + want;
    }
    if (!sec.present) {
      if (sec.dead) {
        const e = new Error('this character writes its ' + f.sec + ' section as ' + sec.dead
          + ' - the space makes the engine skip the whole block, so every value in it is already being ignored. Fix the spelling in the file first.');
        e.code = 'refused';
        throw e;
      }
      if (!newSections.includes(f.sec)) newSections.push(f.sec);
    }
    if (!inserts.has(f.sec)) inserts.set(f.sec, []);
    inserts.get(f.sec).push(line);
  }
  for (const [secName, add] of inserts) {
    const sec = now.sections[secName];
    if (!sec.present) continue;
    const at = lines[sec.line].next;
    splices.push({ start: at, end: at, text: add.join(now.eol) + now.eol, allowNewline: true });
  }
  if (newSections.length) {
    const tailEol = text.length === 0 || /\r?\n$/.test(text) ? '' : now.eol;
    const block = newSections.map((s) => now.eol + '[' + s + ']' + now.eol
      + (inserts.get(s) || []).join(now.eol) + now.eol).join('');
    splices.push({ start: text.length, end: text.length, text: tailEol + block, allowNewline: true });
  }
  return splices;
}

function planStats(text, base, wanted) {
  const { target, notes } = targetFor(base, wanted);
  const first = planEdits(text, base, target);
  const mid = charedit.applySplices(text, first);
  const second = planInserts(mid, target);
  return { target, notes, first, second, read: readStats(text) };
}

function applyStats(text, base, wanted) {
  const plan = planStats(text, base, wanted);
  return charedit.applySplices(charedit.applySplices(text, plan.first), plan.second);
}

// The snapshot taken before the first write: what the character shipped with,
// for every exposed field, as the file's own text. `keyPresent` is kept apart
// from `present` because a vector can ship with an empty component, and a line
// that shipped must never be deleted on the way back.
function snapshot(text) {
  const now = readStats(text);
  const out = {};
  for (const f of FIELDS) {
    const h = now.fields[f.id];
    out[f.id] = h.present
      ? { present: true, raw: h.raw, keyPresent: true }
      : { present: false, keyPresent: !!h.keyPresent };
  }
  return out;
}

// The panel's model: what the file says now, what it shipped with, what the
// engine would use if the key were absent, and what each value moves.
function describe(text, base, set, localcoord) {
  const now = readStats(text);
  const life = now.life;
  const coordScale = localcoord && localcoord > 0 ? localcoord / 320 : 1;
  const fields = FIELDS.map((f) => {
    const h = now.fields[f.id];
    const b = base && base[f.id];
    const shipped = b ? (b.present ? b.raw : null) : (h.present ? h.raw : null);
    const cascade = (JUMP_CASCADE[f.id] || []).filter((k) => !now.declares[k]);
    const sane = f.sane && f.coord && coordScale !== 1
      ? f.sane.map((n) => +(n * coordScale).toFixed(3))
      : f.sane;
    return {
      id: f.id, sec: f.sec, key: f.key, part: f.part || 0, parts: f.parts || 1,
      kind: f.kind, group: f.group, label: f.label, unit: f.unit,
      does: f.does, risk: f.risk, cite: f.cite, sane,
      value: h.present ? h.raw : null,
      shipped,
      set: set && Object.prototype.hasOwnProperty.call(set, f.id) ? String(set[f.id]) : null,
      def: defaultFor(f, life),
      follows: f.follows || null,
      sectionPresent: now.sections[f.sec].present,
      sectionDead: now.sections[f.sec].dead || null,
      cascade,
      coord: !!f.coord,
    };
  });
  return {
    fields, life, localcoord: localcoord || null,
    // A character with no [Velocity] section at all has no run jump and no air
    // jump either - the copy that gives them the jump speeds happens inside
    // that section's own branch (char.go:4122-4128). Adding the section is
    // therefore more than the one value, and the panel says so.
    noVelocitySection: !now.sections.Velocity.present,
    sections: now.sections,
  };
}

module.exports = {
  FIELDS, BY_ID, SECTIONS, JUMP_CASCADE,
  lineIndex, eolOf, sectionOf, keyOf, partsOf,
  readStats, parseValue, defaultFor, targetFor, planEdits, planInserts,
  planStats, applyStats, snapshot, describe,
};
