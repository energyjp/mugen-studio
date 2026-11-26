// A STRAY COMMA BETWEEN A FLAG TRIGGER AND ITS "=", dropped in the copy a
// build ships.
//
// MUGEN characters ship with typos like `(p2Movetype,=H)` (Krauser in CvS
// Rev 2, Krauser.cmd:1750). MUGEN ran them, and so did our 2.4 engine: its
// checkEquality (compiler.go), used for every movetype/statetype comparison,
// skipped any token before the `=` in a CNS file. Upstream's 15b73490 ("flag
// triggers can push strings", in the 2.5 engine) lets these triggers be used
// bare, and decides by looking at the next token: `=` or `!=` is a
// comparison, anything else bare usage. The comma makes it bare, and the
// character fails to load with "Missing ')' before ,". The desktop export's
// upstream engine has the same lookahead.
//
// So the copy a build ships drops the commas, and only those: a run of commas
// directly followed by `=` or `!=`, right after a trigger the engine reads that
// way - the flag triggers (movetype, p2movetype, prevmovetype, statetype,
// p2statetype, prevstatetype, teammode, physics), hitdefattr and
// reversaldefattr, and the flag arguments of GetHitVar (attr, guardflag),
// HitDefVar (guardflag, hitflag) and ProjVar (attr, guardflag, hitflag). The
// result is the comparison the author meant (`p2Movetype=H`), which is what
// MUGEN and the 2.4 engine compiled. A comma followed by `=` can never start an
// argument, so no expression that compiles changes; one after anything else is
// left alone - `AnimElem = 2, = 3` is MUGEN's own two-part syntax. Text inside
// a string and after a `;` is never touched, and neither are .zss files (the
// engine compiles those strict, hitprio.repairFor skips them).
//
// Not covered, on purpose (the 2.4 engine took these too, no build has them):
// `movetype >= H`, `statetype <= S`, `p2statetype := A`, a word before the
// `=` (`p2movetype x = H`). The compile census (GRAIL 3.2b2) finds them.
//
// hitprio.repairFor runs this on the same state files it already rewrites, so
// every fix lands in one shipped text per file. The character's own files are
// only read.
'use strict';

// Triggers whose comparison the engine finds by looking at the next token.
const BARE = new Set([
  'movetype', 'p2movetype', 'prevmovetype',
  'statetype', 'p2statetype', 'prevstatetype',
  'teammode', 'physics', 'hitdefattr', 'reversaldefattr',
]);
// Function triggers, and the arguments that make them a flag comparison.
const CALL = {
  gethitvar: new Set(['attr', 'guardflag']),
  hitdefvar: new Set(['guardflag', 'hitflag']),
  projvar: new Set(['attr', 'guardflag', 'hitflag']),
};

// Where a line's code ends: the ';' outside a string.
function codeEnd(line) {
  let inStr = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inStr = !inStr;
    else if (ch === ';' && !inStr) return i;
  }
  return line.length;
}

// The last top-level argument of an argument list, lowercased.
function lastArg(args) {
  let depth = 0, from = 0;
  for (let i = 0; i < args.length; i++) {
    const ch = args[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === ',' && depth === 0) from = i + 1;
  }
  return args.slice(from).trim().toLowerCase();
}

// Does the code before `at` end with a trigger whose comparison the engine
// looks ahead for? (whitespace before `at` skipped)
function flagBefore(code, at) {
  let j = at;
  while (j > 0 && /\s/.test(code[j - 1])) j--;
  if (j > 0 && code[j - 1] === ')') {
    let depth = 0, i = j - 1;
    for (; i >= 0; i--) {
      if (code[i] === ')') depth++;
      else if (code[i] === '(' && --depth === 0) break;
    }
    if (i < 0) return false;
    let k = i;
    while (k > 0 && /\s/.test(code[k - 1])) k--;
    const m = /[A-Za-z0-9_.]+$/.exec(code.slice(0, k));
    const args = CALL[m ? m[0].toLowerCase() : ''];
    return !!args && args.has(lastArg(code.slice(i + 1, j - 1)));
  }
  const m = /[A-Za-z0-9_.]+$/.exec(code.slice(0, j));
  return !!m && BARE.has(m[0].toLowerCase());
}

// One state file's text with those commas dropped. Returns { text, count,
// lines } (count 0: unchanged; lines are 1-based).
function patchText(text) {
  const src = String(text);
  const lines = src.split('\n');
  let count = 0;
  const at = [];
  const RUN = /,(?:\s*,)*(?=\s*!?=)/y;
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n];
    const end = codeEnd(line);
    const code = line.slice(0, end);
    if (code.trim()[0] === '[') continue;          // a section header
    const eq = code.indexOf('=');                   // the parameter's own '='
    if (eq < 0) continue;
    let out = code.slice(0, eq + 1), inStr = false, hit = 0;
    for (let i = eq + 1; i < code.length; i++) {
      const ch = code[i];
      if (ch === '"') inStr = !inStr;
      if (ch === ',' && !inStr) {
        RUN.lastIndex = i;
        const m = RUN.exec(code);
        if (m && flagBefore(code, i)) {
          hit++;
          i += m[0].length - 1;
          continue;
        }
      }
      out += ch;
    }
    if (!hit) continue;
    lines[n] = out + line.slice(end);
    count += hit;
    at.push(n + 1);
  }
  return { text: count ? lines.join('\n') : src, count, lines: at };
}

module.exports = { patchText, flagBefore };
