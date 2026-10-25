'use strict';
// A SCREENPACK'S STATE FILE WRITTEN FOR AN OLDER ENGINE, UPDATED WHERE THE
// NEW FORM MEANS EXACTLY THE SAME THING.
//
// Ikemen GO changed one trigger's syntax under the packs written for it:
// upstream commit 329624f ("refactor: mugenversion and ikemenversion type and
// syntax") made MugenVersion take an argument - MugenVersion(major),
// MugenVersion(minor) - and the bare word stopped compiling ("Missing '('
// after mugenversion"). PotS's Active Tag, as Infinite Legacy X and Anime
// Cross Arena ship it, says `if mugenVersion >= 1.0 {` once; that one line is
// the whole reason the file fails, and a [Common] States file that fails stops
// every character loading.
//
// WHAT THE OLD TRIGGER RETURNED (329624f^, bytecode.go OC_ex_mugenversion ->
// PushF(gi.mugenverF); common.go ParseMugenVersion): a float32 that is 1.1 for
// a 1.1 character (and every Ikemen character), 1.0 for a 1.0 character, 0.5
// for any other version that parses with a non-zero major, and 0 for none or
// an unparsable one. Literals compile to float32 too (appendValue), and the
// comparison runs on float32 (ge/eq -> ToF). WHAT THE NEW ONE RETURNS
// (common.go ParseMugenVersion today): {1,1}, {1,0}, or {0,5} for everything
// else, so major is 1 or 0 and minor is 1, 0 or 5. Old 0 and old 0.5 both
// became {0,5}: a comparison that told those two apart has no new form and is
// never rewritten. Every other comparison against a number is a set of the
// three new classes, written below as the expression that is true for exactly
// that set.
//
// ONLY WHERE THE REWRITE IS CERTAIN. The comparison must stand on its own in
// the expression: what comes before it is the start of the condition, a
// bracket, a logical operator, an assignment or a parameter, and what comes
// after it ends it. `x + mugenVersion >= 1.0` or `mugenVersion >= 1.0 + y`
// mean something else and are left alone, as are a two-part form after a
// redirect's comma (the compiler takes no bracket there), text inside a
// string, and anything else this does
// not recognize - the lint (zsslint.js) then still refuses the file, which is
// the safe answer. Only the installed copy is ever rewritten; the pack itself
// is never touched.

// The old trigger's four possible values, as float32, and the new class each
// one landed in.
const OLD_VALUES = [
  { v: 0, cls: 'A' },               // no version / unparsable -> {0,5}
  { v: 0.5, cls: 'A' },             // WinMugen and anything else -> {0,5}
  { v: 1.0, cls: 'B' },             // MUGEN 1.0 -> {1,0}
  { v: Math.fround(1.1), cls: 'C' },// MUGEN 1.1 and every Ikemen char -> {1,1}
];

// The new expression that is true for exactly this set of classes. Parenthesized
// whenever it is more than one comparison, so it can replace one in place.
const BY_SET = {
  'BC': 'mugenVersion(major) >= 1',
  'A': 'mugenVersion(major) < 1',
  'C': '(mugenVersion(major) = 1 && mugenVersion(minor) = 1)',
  'B': '(mugenVersion(major) = 1 && mugenVersion(minor) = 0)',
  'AB': '(mugenVersion(major) < 1 || mugenVersion(minor) = 0)',
  'AC': '(mugenVersion(major) < 1 || mugenVersion(minor) = 1)',
};

const CMP = {
  '>=': (a, b) => a >= b, '<=': (a, b) => a <= b, '>': (a, b) => a > b,
  '<': (a, b) => a < b, '=': (a, b) => a === b, '!=': (a, b) => a !== b,
};

// The exact new form of `mugenVersion <op> <number>`, or null when there is none.
function mapComparison(op, literal) {
  const n = Math.fround(parseFloat(literal));
  if (!Number.isFinite(n) || !CMP[op]) return null;
  const truth = OLD_VALUES.map((o) => CMP[op](o.v, n));
  if (truth[0] !== truth[1]) return null;            // old 0 vs 0.5: no new form
  const set = ['A', 'B', 'C'].filter((c, i) => truth[i === 0 ? 0 : i + 1]).join('');
  return BY_SET[set] || null;                       // always true/false: left alone
}

// Where a line's code ends: the comment character outside a string.
function codeEnd(line, kind) {
  const mark = kind === 'cns' ? ';' : '#';
  let inStr = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inStr = !inStr;
    else if (ch === mark && !inStr) return i;
  }
  return line.length;
}

// The code with every string's contents blanked, at the same length, so a
// match's place is its place in the line: text a file shows is never rewritten.
function blankStrings(code) {
  let out = '', inStr = false;
  for (let i = 0; i < code.length; i++) {
    const ch = code[i];
    if (ch === '"') inStr = !inStr;
    out += inStr && ch !== '"' ? ' ' : ch;
  }
  return out;
}

// What may stand before the comparison (the trimmed code to its left) and what
// may follow it, so that it is a whole operand of a logical expression.
const BEFORE_ZSS = /(?:^|&&|\|\||\^\^|[({},;:]|:=|\bif|\bwhile|\blet\s+\w+\s*=)$/i;
const BEFORE_CNS = /(?:^[\w.]+\s*=|&&|\|\||\^\^|[(,])$/i;
const AFTER_SAME_LINE = /^(?:&&|\|\||\^\^|[)}{;,])/;
const AFTER_NEXT_LINE = /^(?:&&|\|\||\^\^|[)}{;,[#]|[A-Za-z_]|$)/;
const PREV_LINE_OPEN = /(?:&&|\|\||\^\^|[({},;])$/;

const FORM = /\bmugenversion\b\s*(>=|<=|!=|=|>|<)\s*(\d+(?:\.\d*)?|\.\d+)(?![\w.])/gi;

function rewrite(text, kind) {
  const src = String(text == null ? '' : text);
  // Lines and their own line ends, so every byte not rewritten comes back as it was.
  const parts = src.split(/(\r?\n)/);
  const lines = parts.filter((p, k) => k % 2 === 0);
  const ends = parts.filter((p, k) => k % 2 === 1);
  const code = lines.map((l) => blankStrings(l.slice(0, codeEnd(l, kind))));
  const rewrites = [];
  const near = (from, step) => {
    for (let i = from; i >= 0 && i < code.length; i += step) if (code[i].trim()) return code[i].trim();
    return '';
  };
  for (let i = 0; i < lines.length; i++) {
    const c = code[i];
    if (!/mugenversion/i.test(c)) continue;
    let out = '', last = 0, changed = false;
    for (const m of c.matchAll(FORM)) {
      const at = m.index;
      if (at > 0 && c[at - 1] === '.') continue;                 // stageVar(info.mugenversion...)
      const before = c.slice(0, at).trimEnd();
      const after = c.slice(at + m[0].length).trimStart();
      const okBefore = before
        ? (kind === 'cns' ? BEFORE_CNS : BEFORE_ZSS).test(before)
        : (kind !== 'cns' && (i === 0 || !near(i - 1, -1) || PREV_LINE_OPEN.test(near(i - 1, -1))));
      const okAfter = after ? AFTER_SAME_LINE.test(after) : AFTER_NEXT_LINE.test(near(i + 1, 1));
      if (!okBefore || !okAfter) continue;
      const repl = mapComparison(m[1], m[2]);
      if (!repl) continue;
      // A redirect (`enemy, mugenVersion = 1.1`) takes only the next value, and
      // the compiler refuses a bracket there ("Parentheses cannot be used within
      // a trigger redirection"): a two-part form after a comma is left alone,
      // and the lint refuses the file.
      if (repl.startsWith('(') && /,$/.test(before || (i > 0 ? near(i - 1, -1) : ''))) continue;
      out += lines[i].slice(last, at) + repl;
      last = at + m[0].length;
      changed = true;
    }
    if (!changed) continue;
    const newLine = out + lines[i].slice(last);
    rewrites.push({ line: i + 1, before: lines[i].trim(), after: newLine.trim(), what: 'mugenVersion' });
    lines[i] = newLine;
  }
  return { text: rewrites.length ? lines.map((l, k) => l + (ends[k] || '')).join('') : src, rewrites };
}

module.exports = { rewrite, mapComparison };
