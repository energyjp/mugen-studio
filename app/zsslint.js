'use strict';
// WILL THIS STATE FILE COMPILE ON OUR ENGINE? A static answer, for the one
// place it matters most: a screenpack's own common-state files.
//
// A file listed under [Common] States is compiled into EVERY character, and a
// file that fails to compile fails every character - the build loads no one.
// The Studio cannot run the compiler at build time, so it lists a pack's file
// only when this says yes. The rules were checked against the real compiler
// (the fork's own compiler.go, run on the files) on every state file the
// reference packs and the engine ship: the same verdict, at the same line.
//
//   1. MugenVersion / IkemenVersion without an argument. Since upstream 329624f
//      both take one - MugenVersion(major) - and the bare word stops with
//      "Missing '(' after mugenversion". `.major` after it is the stage
//      variable's new name and is fine. (zsscompat.js updates the forms that
//      have an exact new spelling before this runs.)
//   2. RatioLevel. The ratio team mode is gone from the engine, and so is the
//      trigger ("Invalid data: ratiolevel"); nothing replaces it.
//   3. ZSS: a controller name at the start of a statement that the compiler's
//      own controller table (enginedata.stateControllers) does not have
//      ("Invalid state controller"). Skipped when the engine source is not in
//      this copy to read the table from.
//   4. ZSS: an attack attribute compared with something that is not one. The
//      attribute triggers (getHitVar(attr), hitDefAttr, reversalDefAttr) read
//      the letters after them (`= SCA, HA`); a range (`[a, b]`), a number or a
//      const() there stops the compiler ("No comparison operator", "Invalid
//      attr value"), and so does a `case` holding one under a `switch` on such
//      a trigger. Older Ikemen builds compared the attribute as a number.
//   5. A trigger the compiler does not know: a word called like one
//      (`getPlayerId(...)`, ZSS) that no string in the compiler source names -
//      a generous allowance - or a trigger that is gone (RatioLevel, as rule 2,
//      and LocalScale): "Invalid data". The call form is skipped without the
//      engine source.
//   A ZSS file's answer is the EARLIEST line any rule finds, the line the
//   compiler stops at.
//   CNS: the whole controller and trigger table check the build importer uses
//      (buildimport.readCommonStates). Without the tables nothing vouches for a
//      CNS file, so it is refused as unchecked.

const ZSS_WORDS = new Set(['if', 'else', 'switch', 'case', 'default', 'for', 'while',
  'ignorehitpause', 'persistent', 'let', 'call', 'break', 'continue', 'return']);

// The code of each line: string literals blanked, the comment cut.
function codeLines(text, kind) {
  const mark = kind === 'cns' ? ';' : '#';
  return String(text == null ? '' : text).split(/\r?\n/).map((line) => {
    let out = '', inStr = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inStr = !inStr; out += ch; continue; }
      if (inStr) continue;
      if (ch === mark) break;
      out += ch;
    }
    return out;
  });
}

const VERSION_WORD = /\b(mugenversion|ikemenversion)\b(?!\s*[(.])/i;

// Triggers this engine no longer has, wherever they stand - but not a name
// the file gives something itself: a `let` variable, a map, a function's
// header.
const GONE_WORD = /(?<![\w.$])(ratiolevel|localscale)\b/ig;
function goneWord(line) {
  if (/^\s*\[\s*function\b/i.test(line)) return null;
  for (const m of line.matchAll(GONE_WORD)) {
    const before = line.slice(0, m.index);
    if (/\blet\s+(?:[\w$]+\s*,\s*)*$/i.test(before) || /\bmap\s*\(\s*$/i.test(before)) continue;
    return m;
  }
  return null;
}

// Rule 4: the attribute triggers, and the start of a value they can read.
const ATTR_TRIGGER = /(?<![\w.$])(gethitvar\s*\(\s*attr\s*\)|hitdefattr|reversaldefattr)/i;
const attrValueOk = (v) => /^\s*[SCA]+\s*(?:,\s*[A-Za-z]+\s*)*$/i.test(v);
// The value after `<attr trigger> =` / `!=` on one line: refused when it opens
// with a bracket or its first word is not stance letters (const, a number).
function badAttrCompare(line) {
  const re = new RegExp(ATTR_TRIGGER.source + '\\s*(!=|=)\\s*(\\S[^&|]*)?', 'ig');
  for (const m of line.matchAll(re)) {
    const v = m[3] || '';
    if (/^\[/.test(v)) return m[1];
    const w = /^([A-Za-z0-9_$.]+)/.exec(v);
    if (w && !/^[SCA]+$/i.test(w[1])) return m[1];
  }
  return null;
}

// The compiler reads a controller's parameters when its block closes, so a
// fault in one is reported at the line of the closing brace: for each line
// inside a controller block (`name{ ... }` at a statement start), that line.
function controllerEnds(lines) {
  const at = new Array(lines.length).fill(null);
  const stack = [];
  lines.forEach((l, i) => {
    let seg = '';
    for (const ch of l) {
      if (ch === '{') {
        const w = /^\s*([A-Za-z_]\w*)\s*$/.exec(seg);
        stack.push({ ctrl: !!w && !ZSS_WORDS.has(w[1].toLowerCase()), start: i });
        seg = '';
      } else if (ch === '}') {
        const b = stack.pop();
        if (b && b.ctrl) for (let k = b.start; k <= i; k++) at[k] = i;
        seg = '';
      } else if (ch === ';') seg = '';
      else seg += ch;
    }
  });
  return at;
}

function zssFindings(lines, t) {
  const found = [];
  const ends = controllerEnds(lines);
  const first = (fn, inBlock) => {
    for (let i = 0; i < lines.length; i++) {
      const r = fn(lines[i], i);
      if (r) { found.push(Object.assign({ line: (inBlock && ends[i] !== null ? ends[i] : i) + 1 }, r)); return; }
    }
  };
  if (t.controllers) {
    first((l) => {
      const m = /^\s*([A-Za-z_]\w*)\s*\{/.exec(l);
      if (!m) return null;
      const w = m[1].toLowerCase();
      return ZSS_WORDS.has(w) || t.controllers.has(w) ? null : { why: 'controller', name: m[1] };
    });
  }
  // Rule 4, in a switch: the brace depth each attribute switch opened at.
  {
    const open = [];
    let depth = 0;
    first((l) => {
      let hit = null;
      const sw = /^\s*switch\s+(.*?)\s*\{?\s*$/i.exec(l);
      if (sw && new RegExp('^(?:.*,\\s*)?' + ATTR_TRIGGER.source + '$', 'i').test(sw[1].trim())) open.push(depth + 1);
      const c = /^\s*case\s+([^:]*):/i.exec(l);
      if (c && open.length && open[open.length - 1] === depth) {
        const bad = c[1].split(';').find((v) => !attrValueOk(v));
        if (bad !== undefined) hit = { why: 'attr', name: c[1].trim() };
      }
      if (!hit) { const a = badAttrCompare(l); if (a) hit = { why: 'attr', name: a }; }
      for (const ch of l) {
        if (ch === '{') depth++;
        else if (ch === '}') { depth--; while (open.length && open[open.length - 1] > depth) open.pop(); }
      }
      return hit;
    }, true);
  }
  // Rule 5: a word called like a trigger that the compiler has no string for.
  if (t.words) {
    first((l) => {
      if (/^\s*\[\s*function\b/i.test(l)) return null;
      for (const m of l.matchAll(/(?<![\w.$])([A-Za-z_]\w*)\(/g)) {
        const w = m[1].toLowerCase();
        if (ZSS_WORDS.has(w) || t.words.has(w) || (t.triggers && t.triggers.has(w))) continue;
        if (/\bcall\s*$/i.test(l.slice(0, m.index))) continue;
        return { why: 'trigger', name: m[1] };
      }
      return null;
    }, true);
  }
  return found;
}

function lint(text, kind, tables) {
  const k = kind === 'cns' ? 'cns' : 'zss';
  const lines = codeLines(text, k);
  let early = null;
  for (let i = 0; i < lines.length && !early; i++) {
    const v = VERSION_WORD.exec(lines[i]);
    if (v) early = { ok: false, why: /^mugen/i.test(v[1]) ? 'mugenVersion' : 'ikemenVersion', line: i + 1, name: v[1] };
    const g = !early && goneWord(lines[i]);
    if (g) early = { ok: false, why: /^ratio/i.test(g[1]) ? 'ratio' : 'trigger', line: i + 1, name: /^ratio/i.test(g[1]) ? 'ratioLevel' : 'localScale' };
  }
  const t = tables || {};
  if (k === 'zss') {
    // The earliest line any rule finds; on the same line, the rules' order.
    if (early) { const e = controllerEnds(lines)[early.line - 1]; if (e !== null) early.line = e + 1; }
    const all = (early ? [early] : []).concat(zssFindings(lines, t));
    if (!all.length) return { ok: true };
    const best = all.reduce((a, b) => (b.line < a.line ? b : a));
    return { ok: false, why: best.why, line: best.line, name: best.name };
  }
  if (early) return early;
  if (!t.controllers || !t.triggers) return { ok: false, why: 'unchecked', line: null };
  const r = require('./buildimport.js').readCommonStates(String(text || ''), { controllers: t.controllers, triggers: t.triggers });
  if (r.listable) return { ok: true };
  const c = r.unknownControllers[0], g = r.unknownTriggers[0];
  if (c) return { ok: false, why: 'controller', line: c.line || null, name: c.name };
  if (g) return { ok: false, why: 'trigger', line: g.line || null, name: g.name };
  return { ok: false, why: 'unchecked', line: null };
}

// The compiler's own tables, from the engine source this copy carries (null
// when it carries none). `words` is every lower-case string the compiler
// source holds - each trigger name it reads, wherever it reads it, and more.
let wordsMemo;
function compilerWords(ed) {
  if (wordsMemo !== undefined) return wordsMemo;
  wordsMemo = null;
  try {
    const src = require('path').join(ed.engineDir(), 'src');
    const out = new Set();
    for (const f of ['compiler.go', 'compiler_functions.go']) {
      const text = require('fs').readFileSync(require('path').join(src, f), 'utf8');
      for (const m of text.matchAll(/"([A-Za-z_][\w.]*)"/g)) out.add(m[1].toLowerCase());
    }
    wordsMemo = out.size ? out : null;
  } catch (e) { wordsMemo = null; }
  return wordsMemo;
}
function tables() {
  try {
    const ed = require('./enginedata.js');
    return { controllers: ed.stateControllers(), triggers: ed.triggers(), words: compilerWords(ed) };
  } catch (e) { return { controllers: null, triggers: null, words: null }; }
}

// The words a person reads for each refusal.
const WHY_TEXT = {
  mugenVersion: 'it checks MugenVersion the old way',
  ikemenVersion: 'it checks IkemenVersion the old way',
  ratio: 'it uses RatioLevel, which this engine no longer has',
  controller: 'it uses a state controller this engine does not have',
  trigger: 'it uses a trigger this engine does not have',
  attr: 'it compares a hit attribute with a number or a range, which this engine does not accept',
  unchecked: 'there is no engine source here to check it against',
  training: 'the training state file stays the engine’s own',
  comma: 'its path has a comma or a semicolon, which the engine would split',
  missing: 'its file is not in the screenpack’s folder',
};

module.exports = { lint, tables, codeLines, WHY_TEXT, ZSS_WORDS };
