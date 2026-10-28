// H-MUGEN SCENE ANALYSIS: for every custom state a giver puts a victim into,
// what the victim is asked for and what the giver himself shows.
//
// The unit is the SCENE - a custom state plus the edge that enters it -
// never the number: one registry number (18300, 19230) is asked in a dozen
// custom states of one giver, each with its own pose. Built from a survey of
// 36 givers (DEVLOG 2026-09-13); the rules, in the survey's letters:
//
//   A  the state that issues TargetState holds a literal header anim and
//      stays: that anim is the pose.
//   B  same-tick handoff: the issuer also ChangeStates away on the same
//      trigger (a launcher on MoveHit, an entry shell on trigger1 = 1), so
//      its header is on screen for no tick of the scene - the pose is the
//      state it moves to. Followed through transients, three hops.
//   C  computed TargetState (`6195+(var(40)*5)+(1+var(39))`): solved for the
//      variables over the domains the file assigns them, the paired
//      ChangeState evaluated under the same assignment, and every ChangeAnim
//      of the pose state judged by its triggers under it - so var(40) = 4
//      selects 7230 and nothing else. An expression that cannot be solved is
//      reported, never attributed. A TargetState value that reads his own
//      StateNo is solved with the statedef's number, one that reads his
//      PrevStateNo once per state of his that ChangeStates into it
//      (ero_helper_gs' 3990, `PrevStateNo + 2000 * var(var(59)) - 1000`
//      after 3010 gives 4010); an index that is a variable is solved over the
//      variable it names (cnsexpr).
//   D  helper context: a pose state reached from a Helper's stateno is
//      flagged; the root idles meanwhile.
//   E  HitDef / Projectile / ReversalDef p2stateno enters a custom state
//      with no TargetState at all; the pose is p1stateno's state, or the
//      HitDef's own state when it does not leave on hit.
//   F  the victim chains custom states herself (ChangeState in the custom
//      state): F1 when the trigger names the giver's state, F2 otherwise
//      (the previous scene's giver states and what they move on to, any-of).
//      A RELAY her chain passes through whose animation is `PrevStateNo +
//      K` asks its number of the state that hands her on, one per
//      predecessor (demandsOf).
//   G  per-victim branches (`target,SelfAnimExist(N)`) evaluated against the
//      receiver's action list when one is given.
//   H  timed ChangeAnims (`time = N`) listed as phases with their tick.
//   K  `random` in a header or value: every distinct result, labeled.
//   L  a pose anim absent from the giver's .air, `AssertSpecial invisible`,
//      or the giver idling in state 0: flagged, not drawn as a body.
//   P  engine fidelity: state files in the engine's order (st files, cmd,
//      stcommon; the constants file only if also listed as st), first
//      definition of a state wins, comments stripped, parameter lines split
//      the compiler's way (`trigger1 != x` is read as trigger1 = x; a line
//      it cannot read as a parameter is dropped).
//
// Everything unresolved is labeled. Nothing here is a verdict on the match;
// it is what the files say, read the way the engine reads them.
'use strict';
const fs = require('fs');
const path = require('path');
const X = require('./cnsexpr.js');

// ---- engine text helpers ------------------------------------------------------
// The compiler splits on "\n" and trims every line with Go's TrimSpace
// (common.go:730 SplitAndTrim), which decodes UTF-8 from both ends. Our text
// is latin1, one char per byte, so a space is an ASCII one or the bytes of a
// VALID UTF-8 space (U+0085, U+00A0, U+1680, U+2000-200A, U+2028/2029/202F/
// 205F, U+3000): a lone 0xA0 byte is not a space to Go and JS trim() would
// eat it; a UTF-8 full-width space after a header's `]` is one. A Shift-JIS
// full-width space (81 40) is not valid UTF-8 and stays - `[State -1, x]　`
// in a Shift-JIS file does not end in `]` to the engine.
const GO_WS = '(?:[ \\t\\n\\v\\f\\r]|\\xC2[\\x85\\xA0]|\\xE1\\x9A\\x80|\\xE2\\x80[\\x80-\\x8A\\xA8\\xA9\\xAF]|\\xE2\\x81\\x9F|\\xE3\\x80\\x80)';
const GO_TRIM = new RegExp('^' + GO_WS + '+|' + GO_WS + '+$', 'g');
const trimGo = (s) => s.replace(GO_TRIM, '');
const noComment = (s) => { const k = s.indexOf(';'); return trimGo(k < 0 ? s : s.slice(0, k)); };
// LoadText drops a leading UTF-8 BOM (common.go:446-448) from the def, the
// constants file and every state file before anything reads a line. Only line
// NUMBERS come out of this module, and the BOM is on line 1, so they stay right.
const stripBom = (t) => (t.charCodeAt(0) === 0xef && t.charCodeAt(1) === 0xbb && t.charCodeAt(2) === 0xbf ? t.slice(3) : t);
const lowerAscii = (s) => s.replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32));

// Go's strings.ToLower over a byte string (our latin1 text, one char per
// byte). An all-ASCII string takes the ASCII fast path; anything else goes
// through strings.Map(unicode.ToLower): valid UTF-8 is decoded and each rune
// takes its SIMPLE lowercase mapping, re-encoded; an invalid byte decodes as
// RuneError and is written as U+FFFD. So `tr\xC4\xB0gger1` (U+0130) is
// `trigger1` and `H\xC4\xB0tDef` is `hitdef` to the compiler (names at
// compiler.go:5916/5980, the controller type at 6889), where JS toLowerCase
// on the latin1 text gives `h\xE4\xB0tdef`. U+0130 is the one rune whose full
// lowercase (JS) differs from Go's simple one (`i`).
function decodeRuneGo(s, i) {
  const b = (k) => (i + k < s.length ? s.charCodeAt(i + k) : -1);
  const cont = (x, lo = 0x80, hi = 0xbf) => x >= lo && x <= hi;
  const c0 = b(0);
  if (c0 >= 0xc2 && c0 <= 0xdf && cont(b(1))) return [((c0 & 0x1f) << 6) | (b(1) & 0x3f), 2];
  if (c0 >= 0xe0 && c0 <= 0xef) {
    const lo = c0 === 0xe0 ? 0xa0 : 0x80, hi = c0 === 0xed ? 0x9f : 0xbf;
    if (cont(b(1), lo, hi) && cont(b(2))) return [((c0 & 0x0f) << 12) | ((b(1) & 0x3f) << 6) | (b(2) & 0x3f), 3];
  }
  if (c0 >= 0xf0 && c0 <= 0xf4) {
    const lo = c0 === 0xf0 ? 0x90 : 0x80, hi = c0 === 0xf4 ? 0x8f : 0xbf;
    if (cont(b(1), lo, hi) && cont(b(2)) && cont(b(3))) return [((c0 & 0x07) << 18) | ((b(1) & 0x3f) << 12) | ((b(2) & 0x3f) << 6) | (b(3) & 0x3f), 4];
  }
  return [0xfffd, 1];
}
const utf8Latin1 = (cp) => Buffer.from(String.fromCodePoint(cp), 'utf8').toString('latin1');
function lowerGo(sIn) {
  const s = String(sIn);
  if (!/[\x80-￿]/.test(s)) return lowerAscii(s);
  let out = '';
  for (let i = 0; i < s.length;) {
    const c = s.charCodeAt(i);
    if (c < 0x80) { out += c >= 65 && c <= 90 ? String.fromCharCode(c + 32) : s[i]; i++; continue; }
    const [cp, size] = decodeRuneGo(s, i);
    let low = cp;
    if (cp === 0x130) low = 0x69;
    else if (cp !== 0xfffd) {
      const l = String.fromCodePoint(cp).toLowerCase();
      const cps = [...l];
      if (cps.length === 1) low = cps[0].codePointAt(0);
    }
    out += utf8Latin1(low);
    i += size;
  }
  return out;
}

// ONE PARAMETER LINE, AS parseSection SPLITS IT (compiler.go:5943-5982, with
// ignoreMostErrors on, system.go:208). The line is already comment-stripped and
// trimmed. The split is the first `=` outside parentheses (findTopLevelEqual,
// 5850-5867); the name is the text before it, trimmed, cut at the first space
// or tab and lowercased - so `damage x = 99` is damage and `trigger1 != 0` is
// trigger1 = 0 - except a var/fvar/sysvar/sysfvar/map name, which runs to its
// closing parenthesis (parseSpecialParamName, 5870-5916); any other name with
// a `(` is skipped as invalid syntax (5953-5961). The value is the rest,
// trimmed. A lone 0xA0 byte is not a space to Go's TrimSpace, so
// `damage\xA0= 99` names the unknown parameter `damage\xA0`.
// -> { name, value, eq } (eq: offset of that `=` in the line) | null
function paramLine(lineIn) {
  const line = String(lineIn);
  let depth = 0, ia = -1;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '(') depth++;
    else if (c === ')') { if (depth > 0) depth--; }
    else if (c === '=' && depth === 0) { ia = i; break; }
  }
  if (ia <= 0) return null;
  const lhs = trimGo(line.slice(0, ia));
  const value = trimGo(line.slice(ia + 1));
  let name = '';
  const p = lhs.indexOf('(');
  if (p > 0 && ['var', 'fvar', 'sysvar', 'sysfvar', 'map'].includes(lowerGo(trimGo(lhs.slice(0, p))))) {
    let u = 0, end = -1;
    for (let j = p; j < lhs.length; j++) {
      if (lhs[j] === '(') u++;
      else if (lhs[j] === ')') { u--; if (u === 0) { end = j; break; } }
    }
    if (end >= 0) name = lowerGo(trimGo(lhs.slice(0, end + 1)));
  }
  if (!name) {
    if (p >= 0) return null;
    const sp = lhs.search(/[ \t]/);
    name = lowerGo(sp >= 0 ? lhs.slice(0, sp) : lhs);
  }
  return name ? { name, value, eq: ia } : null;
}

// Go's Atoi (common.go:212-240): optional sign, then digits up to the first
// non-digit - `211，ヒット` is 211, `abc` is 0.
function atoiGo(str) {
  const s = trimGo(String(str));
  if (!s) return 0;
  const a = s[0] === '-' || s[0] === '+' ? s.slice(1) : s;
  let n = 0;
  for (let i = 0; i < a.length; i++) {
    const c = a.charCodeAt(i);
    if (c < 48 || c > 57) break;
    n = n * 10 + (c - 48);
    if (n > 2147483647) return s[0] === '-' ? -2147483648 : 2147483647;
  }
  return s[0] === '-' ? -n : n;
}

// The compiler's tokenizer (compiler.go:490-625), enough of it to read a
// statedef header: two-char operators, one-char symbols, a number (digits,
// one dot, an exponent), otherwise a word up to the next special symbol.
const SPECIAL = ' !=<>()|&+-*/%,[]^:;{}#"\t\r\n';
function tokenGo(st) {
  st.s = trimGo(st.s);
  const s = st.s;
  if (!s) return '';
  const two = s.slice(0, 2);
  if ([':=', '!=', '>=', '<=', '&&', '^^', '||', '**'].includes(two)) { st.s = s.slice(2); return two; }
  if ('=:;!><~&^|+-*/%,()[]"{}'.includes(s[0])) { st.s = s.slice(1); return s[0]; }
  let i = 0, ten = false;
  for (; i < s.length; i++) {
    if (s[i] === '.') { if (ten) break; ten = true; } else if (s[i] < '0' || s[i] > '9') break;
  }
  if (i > 0 && i < s.length && (s[i] === 'e' || s[i] === 'E')) {
    const j = i + 1;
    for (i++; i < s.length; i++) if ((s[i] < '0' || s[i] > '9') && (i !== j || (s[i] !== '-' && s[i] !== '+'))) break;
  }
  if (i === 0) { i = 0; while (i < s.length && !SPECIAL.includes(s[i])) i++; }
  st.s = s.slice(i);
  return s.slice(0, i).toLowerCase();
}

// How many chars of Go whitespace (the TrimSpace set above) start `s` at `from`.
const GO_WS_RUN = new RegExp(GO_WS + '+', 'y');
function goWsLead(s, from) {
  GO_WS_RUN.lastIndex = from || 0;
  const m = GO_WS_RUN.exec(s);
  return m ? m[0].length : 0;
}

// The tokenizer again (tokenizerCS, compiler.go:490-625), WITH POSITIONS, for
// the readers that have to name the byte span of a token (an element number
// to renumber). Each token is { tok (lowercased, as tokenizer returns it),
// start, end } in `s`; the walk stops where the compiler would get an empty
// token (the end, or a character that starts no token, such as `#`).
function* tokensGo(sIn, from) {
  const s = String(sIn);
  let p = from || 0;
  for (;;) {
    p += goWsLead(s, p);
    if (p >= s.length) return;
    const c = s[p], n = s[p + 1];
    let len = 0;
    if (c === '=' || c === ';' || c === '~' || c === '+' || c === '-' || c === '/' || c === '%' || c === ','
      || c === '(' || c === ')' || c === '[' || c === ']' || c === '"' || c === '{' || c === '}') len = 1;
    else if (c === ':' || c === '!' || c === '>' || c === '<') len = n === '=' ? 2 : 1;
    else if (c === '&' || c === '^' || c === '|' || c === '*') len = n === c ? 2 : 1;
    else {
      let i = p, ten = false;
      for (; i < s.length; i++) {
        if (s[i] === '.') { if (ten) break; ten = true; } else if (s[i] < '0' || s[i] > '9') break;
      }
      if (i > p && i < s.length && (s[i] === 'e' || s[i] === 'E')) {
        const j = i + 1;
        for (i++; i < s.length; i++) if ((s[i] < '0' || s[i] > '9') && (i !== j || (s[i] !== '-' && s[i] !== '+'))) break;
      }
      if (i === p) { while (i < s.length && !SPECIAL.includes(s[i])) i++; }
      len = i - p;
    }
    if (len <= 0) return;
    yield { tok: lowerGo(s.slice(p, p + len)), start: p, end: p + len };
    p += len;
  }
}

// parseTriggerNumber (compiler.go:5828-5845) with readDigit (common.go:382-392):
// `triggerall`, or `trigger` + 1-65536 written without a leading zero.
// -> { all: true } | { n } | null
function parseTriggerName(name) {
  const m = /^trigger(.*)$/.exec(String(name));
  if (!m) return null;
  if (m[1] === 'all') return { all: true };
  if (!/^[0-9]+$/.test(m[1]) || (m[1].length >= 2 && m[1][0] === '0')) return null;
  const n = Number(m[1]);
  return n >= 1 && n <= 65536 ? { n } : null;
}

// scanStateDef (compiler.go:7332-7362) over what follows `statedef `:
// `const(name)` through the constants map, `+1` -> -10 (the +1 state), a
// `-` glued to a digit is negative, anything else is Atoi of the first
// token - which is how `[Statedef 211，ヒット硬直]` is state 211 and a word is
// state 0. Returns { no } or { unresolved: name } when a const() cannot be
// looked up (the engine refuses to load the character then).
function scanStateDefNo(rest, consts) {
  const st = { s: String(rest) };
  let t = tokenGo(st);
  if (t === 'const') {
    tokenGo(st);
    const k = tokenGo(st);
    if (!consts) return { unresolved: k };
    const v = consts.has(k) ? consts.get(k) : consts.has(k.toLowerCase()) ? consts.get(k.toLowerCase()) : undefined;
    if (v === undefined || !Number.isFinite(Number(v))) return { unresolved: k };
    return { no: Math.trunc(Number(v)) };
  }
  if (t === '+') {
    const next = tokenGo(st);
    if (next === '1') return { no: -10 };
    t += next;
  }
  if (t === '-' && st.s.length && st.s[0] >= '0' && st.s[0] <= '9') t += tokenGo(st);
  return { no: atoiGo(t) };
}

// A [Files] value as the engine sees it: decodeShiftJIS (common.go:471-484)
// keeps valid UTF-8 and decodes anything else as Shift-JIS
// (compiler.go:8162, 8167). Our def text is latin1, so the byte string is
// tried first (every ASCII path), then the decoded name.
function decodeFilesValue(latin1) {
  const bytes = Buffer.from(latin1, 'latin1');
  if (bytes.every((b) => b < 0x80)) return latin1;
  const utf8 = bytes.toString('utf8');
  if (Buffer.from(utf8, 'utf8').equals(bytes)) return utf8;
  try { return new TextDecoder('shift_jis').decode(bytes); } catch (e) { return latin1; }
}

// TEXT SHOWN TO A PERSON (a move's name, a controller's label, a comment): our
// file text is latin1, one char per byte, and must never reach a page as is -
// a Shift-JIS lead byte (0x81-0x9F) is a C1 control there, which a browser
// draws as nothing, so `アマゲドバスター` showed as `A}QhoX^[`. Decoded here
// for display only (comparisons stay on the bytes): ASCII as is, valid UTF-8
// as UTF-8, accented Latin words as Windows-1252 (`Médio`, below), then the
// first STRICT decode that fits: Shift-JIS (not when it
// needs the user-defined/IBM rows, lead 0xF0-0xFC, or reads as nothing but
// half-width katakana that is valid Korean), Korean (EUC-KR/CP949: Balrog's,
// Honda's and Senti's comments, which Shift-JIS turned into half-width kana
// and U+FFFD), Windows-1252 (`pública`), and only then a lenient Shift-JIS.
// A string that already holds a character above U+00FF is not latin1 text
// and is returned unchanged.
const STRICT = {};
const strictDecode = (enc, bytes) => {
  try {
    if (!STRICT[enc]) STRICT[enc] = new TextDecoder(enc, { fatal: true });
    return STRICT[enc].decode(bytes);
  } catch (e) { return null; }
};
// ACCENTED LATIN THAT ALSO READS AS SHIFT-JIS. Windows-1252's à-ï (0xE0-0xEF)
// are Shift-JIS lead bytes and the letter after them a valid trail byte, so
// `Médio` (4D E9 64 69 6F) reads as `M馘io`, `Ação` as `A鈬o` and `EXPLOSÃO`
// as `EXPLOSﾃO` - strict Shift-JIS, in kanji DotGothic16 draws, so the page
// and a build showed the garble (1,476 comment and label fields of 182
// characters, mostly Portuguese, 2026-10-19). The Windows-1252 reading wins
// first when it reads as Latin words and the Shift-JIS one does not read as
// Japanese:
//  - every character above ASCII is a Latin letter, in a word of 3+ letters
//    cased like a word (Médio, médio, MÉDIO: not EXâS), at most 3 in a row;
//  - the Shift-JIS reading has no kana, CJK punctuation or full-width form,
//    and each of its non-ASCII runs touches an ASCII letter (a misread
//    accent sits inside a word; a real kanji name stands on its own:
//    Akuma's 禊 = E2 53 would read `âS`, Makoto's 颪 `éC` - both kept).
const LATIN_ONLY = /^[\x00-\x7fÀ-ÖØ-öø-ÿŒœŠšŽžŸ]*$/;
const LATIN_WORD = /[A-Za-zÀ-ÖØ-öø-ÿŒœŠšŽžŸ]+/g;
const WORD_LOWER = /^[A-ZÀ-ÖØ-ÞŒŠŽŸ]?[a-zß-öø-ÿœšž]+$/;
const WORD_UPPER = /^[A-ZÀ-ÖØ-ÞŒŠŽŸ]+$/;
function latinWords(t) {
  if (!/[^\x00-\x7f]/.test(t) || !LATIN_ONLY.test(t)) return false;
  for (const m of t.matchAll(LATIN_WORD)) {
    const w = m[0];
    if (!/[^\x00-\x7f]/.test(w)) continue;
    if (w.length < 3 || /[^\x00-\x7f]{4}/.test(w) || !(WORD_LOWER.test(w) || WORD_UPPER.test(w))) return false;
  }
  return true;
}
function insideWords(sj) {
  for (const m of sj.matchAll(/[^\x00-\x7f]+/g)) {
    const before = sj[m.index - 1] || '', after = sj[m.index + m[0].length] || '';
    if (!/[A-Za-z]/.test(before) && !/[A-Za-z]/.test(after)) return false;
  }
  return true;
}
const JP_TEXT = /[\u3000-\u30ff\uff01-\uff60]/;
function decodeText(latin1) {
  const s = String(latin1 == null ? '' : latin1);
  if (!/[\x80-\xff]/.test(s) || /[^\x00-\xff]/.test(s)) return s;
  const bytes = Buffer.from(s, 'latin1');
  const utf8 = bytes.toString('utf8');
  if (Buffer.from(utf8, 'utf8').equals(bytes)) return utf8;
  const sj = strictDecode('shift_jis', bytes);
  const cp1252 = strictDecode('windows-1252', bytes);
  if (cp1252 !== null && !/[\x80-\x9f]/.test(cp1252) && latinWords(cp1252)) {
    let sjAny = sj;
    if (sjAny === null) { try { sjAny = new TextDecoder('shift_jis').decode(bytes); } catch (e) { sjAny = ''; } }
    if (!JP_TEXT.test(sjAny) && insideWords(sjAny)) return cp1252;
  }
  let rareLead = false;
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if ((b >= 0x81 && b <= 0x9f) || (b >= 0xe0 && b <= 0xfc)) { if (b >= 0xf0) rareLead = true; i++; }
  }
  // Korean only as plain EUC-KR (every byte above ASCII in 0xA1-0xFE, as
  // KS X 1001 writes it): CP949's extension rows overlap Shift-JIS's lead bytes.
  const eucBytes = bytes.every((b) => b < 0x80 || (b >= 0xa1 && b <= 0xfe));
  const kr = eucBytes ? strictDecode('euc-kr', bytes) : null;
  const hangul = kr !== null && /[가-힣]/.test(kr) && !/[^\x00-\x7f가-힣ㄱ-ㆎ　-〿！-～]/.test(kr);
  if (sj !== null && !rareLead) {
    const high = sj.replace(/[\x00-\x7f]/g, '');
    const halfKana = (high.match(/[｡-ﾟ]/g) || []).length;
    if (!(hangul && halfKana === high.length)) return sj;
  }
  if (hangul) return kr;
  let loose = s;
  try { loose = new TextDecoder('shift_jis').decode(bytes); } catch (e) { /* no Shift-JIS in this Node */ }
  const jp = (loose.match(/[぀-ヿ一-鿿ｦ-ﾟ]/g) || []).length;
  const bad = (loose.match(/�/g) || []).length;
  if (jp >= 2 && jp >= 2 * bad) return loose;
  const cp = strictDecode('windows-1252', bytes);
  if (cp !== null && !/[\x80-\x9f]/.test(cp)) return cp;
  return loose;
}

// ---- files, in the engine's order -------------------------------------------
// CharCompiler.Compile (compiler.go:8129-8170): the def is read as ini
// sections (ReadIniSection/SectionName/IniSection.Parse, common.go:793-812,
// 984-1025). Only the FIRST [Files] section counts (the `files` flag at
// 8158-8160), a key's FIRST value wins even when it is empty, a key is the
// text up to the first `=`, space or tab, and a section ends at any line
// starting `[`. State files are every key matching ^st[0-9]*$ in natural
// order, then cmd, then stcommon (8346-8371). A file that is not found is
// retried as `<name>.zss` (stateCompile, compiler.go:6754-6770): that is how
// `stcommon = common1.cns` becomes common1.cns.zss.
function stateFiles(charDir, defName, resolve) {
  let text;
  try { text = stripBom(fs.readFileSync(path.join(charDir, defName), 'latin1')); } catch (e) { return []; }
  const lines = text.split('\n').map(trimGo);
  let files = null;
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (!ln || ln[0] !== '[') continue;
    const sec = noComment(ln);
    if (!sec || sec[sec.length - 1] !== ']') continue;
    let name = sec.slice(1, sec.indexOf(']'));
    const sp = name.indexOf(' ');
    if (sp >= 0) name = name.slice(0, sp + 1);
    if (name.toLowerCase() !== 'files') continue;
    files = new Map();
    for (i++; i < lines.length; i++) {
      if (lines[i] && lines[i][0] === '[') { i--; break; }
      const line = noComment(lines[i]);
      const ia = line.search(/[= \t]/);
      if (ia <= 0) continue;
      const key = line.slice(0, ia).toLowerCase();
      const eq = line.indexOf('=');
      const data = eq >= 0 ? trimGo(line.slice(eq + 1)) : '';
      if (!files.has(key)) files.set(key, data);
    }
    break;
  }
  if (!files) return [];
  const clean = (v) => v.replace(/"/g, '').replace(/\\/g, '/').trim();
  // "st" first, then st0, st1, ... by number (compareNatural, common.go:1604-1628;
  // `st` and `st0` compare equal there, `st` is kept first as before).
  const st = [...files.keys()].filter((k) => /^st[0-9]*$/.test(k))
    .sort((a, b) => (a === 'st' ? -1 : b === 'st' ? 1 : (atoiGo(a.slice(2)) - atoiGo(b.slice(2))) || (a < b ? -1 : a > b ? 1 : 0)));
  const out = [];
  for (const k of st) out.push({ key: k, raw: files.get(k) });
  if (files.has('cmd')) out.push({ key: 'cmd', raw: files.get('cmd') });
  if (files.has('stcommon')) out.push({ key: 'stcommon', raw: files.get('stcommon') });
  const seen = new Set();
  const res = [];
  for (const f of out) {
    const rel = clean(f.raw);
    if (!rel) continue;
    const decoded = clean(decodeFilesValue(f.raw));
    let abs = null, used = rel;
    for (const cand of decoded !== rel ? [rel, decoded] : [rel]) {
      abs = resolve(cand);
      if (!abs && !/\.zss$/i.test(cand)) abs = resolve(cand + '.zss');
      if (abs) { used = cand; break; }
    }
    if (!abs) { res.push({ key: f.key, rel: decoded, abs: null }); continue; }
    if (seen.has(abs)) continue;
    seen.add(abs);
    res.push({ key: f.key, rel: used, abs });
  }
  return res;
}

// ---- parse ----------------------------------------------------------------
// State: { no, file, line, header: Map(name -> raw), headerLines: Map(name -> line),
//          anim: raw|null, movetype: 'i'|'a'|'h'|'u'|null, sctrls, zss? }
// Sctrl: { type, params: Map, paramLines: Map(name -> line), trig: { all: [], groups: [[...]] },
//          dropped, line ([State] header line), file, label, tag, state, gap?, neverTrue? }
//
// Read the way stateCompileCNS reads it (compiler.go:6786-7117):
//  - a statedef is a line `[statedef <anything>]` - lowercased, comment
//    stripped, with the space - and nothing else (6806-6812); its number is
//    scanStateDef's (above). A `[Statedef200]` is not a header at all.
//  - inside it, a bracket line that does not end in `]` is skipped with the
//    parameters under it (6853-6856): that controller is lost, the statedef
//    goes on. A closed bracket line that does not start `[state ` ENDS the
//    statedef (6857-6860), and every controller after it is lost until the
//    next statedef header.
//  - a statedef repeated in the SAME file is skipped whole (6821-6833). A
//    positive statedef defined in an earlier file wins (7111). A negative one
//    defined again in a later file is built on a copy of the first
//    (6843-6845) and stored only when `negoverride` is off (7111) - i.e. only
//    for a character with ikemenversion (8347/8355/8362): for a MUGEN
//    character the later block is dropped whole.
//  - trigger numbers: the triggers are indexed by number, and the build loop
//    stops at the first number that has no line (7026-7030), so trigger3
//    without trigger2 drops trigger3 and everything after it. A literal `0`
//    in a group makes that group false (7068-7085). trigger01 / trigger0 are
//    not trigger names (readDigit, common.go:382-392) and are ignored.
//  - the [State x, label] text is a label only: a controller belongs to the
//    statedef above it whatever number the label says.
// opts: { consts: Map(lowercased name -> number) | undefined, ikemenVersion: bool }
function parseStates(files, opts) {
  opts = opts || {};
  const consts = opts.consts instanceof Map ? opts.consts : null;
  const ikv = !!opts.ikemenVersion;
  const states = new Map(), shadowed = [], read = [], lost = [], strayNegative = [], droppedNegative = [], zssFiles = [], unresolvedHeaders = [];
  const negHeaders = new Set();
  const strayCandidates = [];
  const isLiteralZero = (e) => /^0+$/.test(trimGo(String(e)));
  // A controller header, closed or not (`[State`, `[State -1, x]　`), for
  // counting what is lost - not a statedef.
  const isStateLine = (low) => low.startsWith('[state') && !low.startsWith('[statedef');
  // Trigger groups after a numbering gap never compile; mirror it.
  const finishCtrl = (sc) => {
    const nums = [...sc.groupIdx.keys()].map(Number);
    if (nums.length) {
      const have = new Set(nums);
      const max = Math.max(...nums);
      let k = 1;
      while (k <= max && have.has(k)) k++;
      if (k <= max) {
        sc.gap = k;
        // No trigger1 at all is a LOAD error (compiler.go:7012-7015), not a
        // silent drop: the groups are kept so nothing reads it as always-on.
        if (k > 1) {
          const keep = [];
          const idx = new Map();
          for (const [n, gi] of sc.groupIdx) if (Number(n) < k) { idx.set(n, keep.length); keep.push(sc.trig.groups[gi]); }
          sc.trig.groups = keep;
          sc.groupIdx = idx;
        }
      }
    }
    if (sc.trig.all.some(isLiteralZero) || (sc.trig.groups.length && sc.trig.groups.every((g) => g.some(isLiteralZero)))) sc.neverTrue = true;
  };
  for (const f of files) {
    if (!f.abs) continue;
    let text;
    try { if (fs.statSync(f.abs).size > 8e6) continue; text = stripBom(fs.readFileSync(f.abs, 'latin1')); } catch (e) { continue; }
    read.push(f.rel);
    const lines = text.split('\n');
    const inFile = new Set();
    if (/\.zss$/i.test(f.abs)) {
      // ZSS: statedef NUMBERS only (`[StateDef 200; type: S; ...]`, `#`
      // comments). Positive: first file wins; negative: always stored
      // (compiler.go:8047); a repeat in one file is a load error (8012-8020).
      zssFiles.push(f.rel);
      for (let i = 0; i < lines.length; i++) {
        const k = lines[i].indexOf('#');
        const line = trimGo(k < 0 ? lines[i] : lines[i].slice(0, k));
        const m = /^\[\s*statedef(?![a-z0-9_])(.*)$/i.exec(line);
        if (!m) continue;
        const r = scanStateDefNo(m[1], consts);
        if (r.unresolved !== undefined) { unresolvedHeaders.push({ file: f.rel, line: i + 1, header: line, name: r.unresolved }); continue; }
        const no = r.no;
        if (no < 0) negHeaders.add(no);
        if (inFile.has(no) || (states.has(no) && no >= 0)) { shadowed.push({ no, file: f.rel, line: i + 1 }); continue; }
        inFile.add(no);
        if (states.has(no)) continue;
        states.set(no, { no, file: f.rel, line: i + 1, zss: true, header: new Map(), headerLines: new Map(), anim: null, movetype: null, sctrls: [] });
      }
      continue;
    }
    let cur = null;        // the state controllers go to (a scratch one when dropped)
    let stored = false;    // cur is (part of) the table
    let mode = 'seek';     // seek | header | ctrl | ctrlseek
    let sc = null;
    let lostRec = null;    // counting [State lines after a statedef-ending line
    for (let i = 0; i < lines.length; i++) {
      const line = noComment(lines[i]);
      if (!line) continue;
      const low = line.toLowerCase();
      if (mode === 'seek') {
        const isDef = low.length >= 11 && low[0] === '[' && low[low.length - 1] === ']' && low.slice(1, 10) === 'statedef ';
        if (!isDef) { if (lostRec && isStateLine(low)) lostRec.controllers++; continue; }
        lostRec = null;
        const r = scanStateDefNo(low.slice(10), consts);
        if (r.unresolved !== undefined) { unresolvedHeaders.push({ file: f.rel, line: i + 1, header: line, name: r.unresolved }); continue; }
        const no = r.no;
        if (no < 0) negHeaders.add(no);
        if (inFile.has(no)) { shadowed.push({ no, file: f.rel, line: i + 1 }); continue; }
        inFile.add(no);
        const fresh = { no, file: f.rel, line: i + 1, header: new Map(), headerLines: new Map(), anim: null, movetype: null, sctrls: [] };
        if (!states.has(no)) { cur = fresh; stored = true; states.set(no, cur); }
        else if (no < 0 && ikv) {
          // Appended to the first definition; its header stays the first's.
          const base = states.get(no);
          cur = { no, file: f.rel, line: i + 1, header: new Map(), headerLines: new Map(), anim: null, movetype: null, sctrls: base.sctrls };
          stored = true;
        } else if (no < 0) {
          cur = fresh; stored = false;
          droppedNegative.push({ no, file: f.rel, line: i + 1, controllers: 0, _ref: cur });
        } else { cur = fresh; stored = false; shadowed.push({ no, file: f.rel, line: i + 1 }); }
        mode = 'header'; sc = null;
        continue;
      }
      if (low[0] === '[') {
        if (sc) { finishCtrl(sc); sc = null; }
        if (low[low.length - 1] !== ']') {
          if (stored && isStateLine(low)) lost.push({ file: f.rel, line: i + 1, header: line, controllers: 1, unclosed: true });
          mode = 'ctrlseek';
          continue;
        }
        if (low.length < 7 || low.slice(1, 7) !== 'state ') {
          const isDef = low.length >= 11 && low.slice(1, 10) === 'statedef ';
          // The ending line counts itself when it is a controller written
          // without the space (`[State-1]`): its block is lost too.
          if (!isDef && stored) { lostRec = { file: f.rel, line: i + 1, header: line, controllers: isStateLine(low) ? 1 : 0 }; lost.push(lostRec); }
          cur = null; stored = false; mode = 'seek';
          if (isDef) i--;
          continue;
        }
        const inner = line.slice(1, -1);
        const comma = inner.indexOf(',');
        const tag = trimGo(comma < 0 ? inner.slice(6) : inner.slice(6, comma));
        const label = comma < 0 ? '' : trimGo(inner.slice(comma + 1));
        sc = { type: '', params: new Map(), paramLines: new Map(), trig: { all: [], groups: [] }, groupIdx: new Map(), dropped: 0, line: i + 1, file: f.rel, label, tag, state: cur.no };
        cur.sctrls.push(sc);
        if (stored && cur.no >= 0 && /^-[123]$/.test(tag)) strayCandidates.push({ file: f.rel, line: i + 1, label, state: cur.no, no: parseInt(tag, 10) });
        mode = 'ctrl';
        continue;
      }
      if (mode === 'ctrlseek') continue;
      // The engine's own name/value split (paramLine above). Names include
      // `var(39)` (a VarSet's inline form). A trigger line it cannot read as a
      // parameter (`trigger1 x`, `trigger1(2) = 1`) is dropped.
      const kv = paramLine(line);
      if (!kv) { if (sc && /^trigger/i.test(line)) sc.dropped++; continue; }
      const name = kv.name, val = kv.value;
      if (mode === 'header') {
        if (!cur.header.has(name)) { cur.header.set(name, val); cur.headerLines.set(name, i + 1); }
        if (name === 'anim' && cur.anim === null) cur.anim = val;
        continue;
      }
      const tm = /^trigger(all|\d+)$/.exec(name);
      if (tm) {
        if (tm[1] !== 'all' && (tm[1] === '0' || tm[1][0] === '0')) continue;
        if (!sc.paramLines.has(name)) sc.paramLines.set(name, i + 1);
        if (tm[1] === 'all') sc.trig.all.push(val);
        else { if (!sc.groupIdx.has(tm[1])) { sc.groupIdx.set(tm[1], sc.trig.groups.length); sc.trig.groups.push([]); } sc.trig.groups[sc.groupIdx.get(tm[1])].push(val); }
        continue;
      }
      if (!sc.paramLines.has(name)) sc.paramLines.set(name, i + 1);
      if (name === 'type') { if (!sc.type) sc.type = lowerGo(val); continue; }
      if (!sc.params.has(name)) sc.params.set(name, val);
    }
    if (sc) finishCtrl(sc);
  }
  // The header's movetype, first letter (stateDef, compiler.go:6590-6605).
  for (const s of states.values()) if (!s.zss) { const mt = s.header.get('movetype'); s.movetype = mt ? mt[0].toLowerCase() : null; }
  for (const d of droppedNegative) { d.controllers = d._ref.sctrls.length; delete d._ref; }
  for (const c of strayCandidates) if (!negHeaders.has(c.no)) strayNegative.push(c);
  return { states, shadowed, read, lost, strayNegative, droppedNegative, zssFiles, unresolvedHeaders };
}

// ---- reachability ---------------------------------------------------------------
// WHAT IS EVER ENTERED. A state named by no ChangeState / SelfState /
// TargetState value, no HitDef p1stateno, no Helper stateno, outside every
// computed value's reach, and not one the engine enters by itself (0-199,
// the 5000s, negatives) is dead code - an issuer left over from an older
// edit. Reachability is transitive: a family whose only entry is a dead
// state is dead with it. Walk from what the engine enters by itself through
// every literal reference of a reached state.
//   live - reached through literal edges only;
//   soft - reached only through a computed reference somewhere on the way:
//          its reach (every state from base-40 to base+200, base = the value
//          with its variables at 0) or its literal leaves.
//   via  - every edge into a number from a reached state.
// opts: { roots: [numbers] }
const STATE_EDGE_TYPES = new Set(['changestate', 'selfstate', 'targetstate', 'hitdef', 'projectile', 'reversaldef', 'helper', 'hitoverride', 'tagin', 'tagout']);
const STATE_EDGE_PARAMS = ['value', 'p1stateno', 'p2stateno', 'stateno'];
function reachable(states, opts) {
  const edgeCache = new Map();
  const edgesOf = (s) => {
    if (edgeCache.has(s.no)) return edgeCache.get(s.no);
    const out = [];
    for (const sc of s.sctrls) {
      if (!STATE_EDGE_TYPES.has(sc.type)) continue;
      for (const k of STATE_EDGE_PARAMS) {
        const raw = sc.params.get(k);
        if (raw === undefined) continue;
        const n = lit(raw);
        if (n !== null) { out.push({ to: n, from: s.no, type: sc.type, param: k, soft: false }); continue; }
        if (!X.parses(raw)) continue;
        const base = X.evalExpr(raw, Object.fromEntries(X.varsOf(raw).map((v) => [v, 0])));
        if (Number.isFinite(base)) { for (const s2 of states.values()) if (s2.no >= base - 40 && s2.no <= base + 200) out.push({ to: s2.no, from: s.no, type: sc.type, param: k, soft: true }); }
        else for (const t of X.leavesOf(raw)) out.push({ to: t, from: s.no, type: sc.type, param: k, soft: true });
      }
    }
    edgeCache.set(s.no, out);
    return out;
  };
  const live = new Set(), soft = new Set(), via = new Map();
  const q = [];
  for (const s of states.values()) if (s.no <= 199 || (s.no >= 5000 && s.no <= 5999)) { live.add(s.no); q.push(s.no); }
  for (const r of (opts && opts.roots) || []) { const n = Number(r); if (Number.isFinite(n) && !live.has(n)) { live.add(n); q.push(n); } }
  while (q.length) {
    const s = states.get(q.shift());
    if (!s) continue;
    for (const e of edgesOf(s)) if (!e.soft && !live.has(e.to)) { live.add(e.to); q.push(e.to); }
  }
  const q2 = [...live];
  while (q2.length) {
    const s = states.get(q2.shift());
    if (!s) continue;
    for (const e of edgesOf(s)) if (!live.has(e.to) && !soft.has(e.to)) { soft.add(e.to); q2.push(e.to); }
  }
  for (const no of [...live, ...soft]) {
    const s = states.get(no);
    if (!s) continue;
    for (const e of edgesOf(s)) { if (!via.has(e.to)) via.set(e.to, []); via.get(e.to).push({ from: e.from, type: e.type, param: e.param, soft: e.soft }); }
  }
  return { live, soft, via };
}

const lit = (raw) => (raw !== undefined && raw !== null && /^-?\d+$/.test(String(raw).trim()) ? parseInt(String(raw).trim(), 10) : null);
const normTrig = (t) => [...(t.all || []).map((x) => 'A:' + x), ...(t.groups || []).map((g, i) => 'G' + i + ':' + g.join('&&'))]
  .map((s) => s.toLowerCase().replace(/\s+/g, '')).sort().join('|');
// Fires on the first tick of the state: `1`, `time = 0`, `time <= 5`,
// `!time`. A state whose exit is one of these is a zero-tick shell.
const isImmediate = (t) => X.evalTriggerSet(t, { time: 0 }) === true;
// A demand number: the registry windows start at 1000 and the 5000s are the
// engine's gethit anims. A custom STATE can carry any number the engine does
// not own itself (0-199, the 5000s): Sanae's are 334, 456.
const isScene = (n) => Number.isFinite(n) && n >= 1000 && !(n >= 5000 && n <= 5999);
const isBasic = (n) => !Number.isFinite(n) || n <= 199 || (n >= 5000 && n <= 5999);
// SAME TICK: a ChangeState fires with the TargetState when it is immediate,
// or when every one of its trigger atoms is among the TargetState's (a
// launcher issues on `movehit = 1 && numtarget` and leaves on `movehit = 1`).
// `movehit` implies `movecontact`; `time > 0` is true on every tick after
// the first and says nothing.
const atomsOf = (t) => {
  const out = new Set();
  const norm = (x) => {
    let s = x.toLowerCase().replace(/\s+/g, '');
    if (/^time>=?0$/.test(s)) return null;
    if (/^movehit(=1|>=1|>0)?$/.test(s)) return 'movehit';
    if (/^movecontact(=1|>=1|>0)?$/.test(s)) return 'movecontact';
    return s;
  };
  // A line `NumTarget && Time = 409` is two atoms.
  const each = (e) => { for (const part of String(e).split('&&')) { const a = norm(part); if (a) out.add(a); } };
  for (const e of t.all || []) each(e);
  for (const g of t.groups || []) for (const e of g) each(e);
  return out;
};
const sameTick = (targetTrig, changeTrig) => {
  if (isImmediate(changeTrig)) return true;
  if (normTrig(targetTrig) === normTrig(changeTrig)) return true;
  const ta = atomsOf(targetTrig), ca = atomsOf(changeTrig);
  if (!ca.size) return false;
  for (const a of ca) { if (ta.has(a)) continue; if (a === 'movecontact' && ta.has('movehit')) continue; return false; }
  return true;
};

// ---- variable domains (Rule C) ------------------------------------------------
// Every literal a variable is ever assigned in the loaded files: VarSet
// `v = 40` + `value = 2`, VarSet `var(40) = 2`, and `var(40) := 2` inside an
// expression. A variable with no literal assignment gets 0..15.
// opts.computed (the move model's animation candidates): a VarSet whose value
// is computed also gives the literal leaves of its ifelse branches
// (`var(10) = ifelse(command = "z", 3, ifelse(command = "y", 2, 1))` sets 3, 2
// or 1 - the value is evaluated each time the controller runs,
// bytecode.go:9636-9646), and a plain copy `var(10) = var(54)` gives var(54)'s
// values. Without them `1099 + var(10)` never offers 1101 and a state that
// plays it is invisible to an .air renumber. A value with no literal leaf
// (VarAdd, a trigger read, `Random < 500`) still adds nothing.
function domainsOf(states, opts) {
  const computed = !!(opts && opts.computed);
  const dom = {};
  const add = (name, v) => { if (v === null) return; (dom[name] = dom[name] || []); if (!dom[name].includes(v)) dom[name].push(v); };
  const copies = [];
  const assign = (name, raw) => {
    const n = lit(raw);
    if (n !== null || !computed || raw === undefined || raw === null) { add(name, n); return; }
    const m = /^\s*(var|fvar|sysvar|sysfvar)\s*\(\s*(\d+)\s*\)\s*$/i.exec(String(raw));
    if (m) { copies.push([name, m[1].toLowerCase() + '(' + m[2] + ')']); return; }
    let leaves = [];
    try { leaves = X.leavesOf(raw); } catch (e) { leaves = []; }
    for (const v of leaves) if (Number.isInteger(v)) add(name, v);
  };
  // VarAdd is a delta, not a value: a counter that starts at 0 and adds 1
  // reaches every count, and a domain of {1} would hide all but the first.
  for (const s of states.values()) for (const sc of s.sctrls) {
    if (sc.type === 'varset') {
      const v = lit(sc.params.get('v')), fv = lit(sc.params.get('fv'));
      if (v !== null) assign('var(' + v + ')', sc.params.get('value'));
      if (fv !== null) assign('fvar(' + fv + ')', sc.params.get('value'));
      for (const [k, val] of sc.params) { const m = /^(var|fvar|sysvar|sysfvar)\((\d+)\)$/.exec(k); if (m) assign(m[1] + '(' + m[2] + ')', val); }
    }
    const scan = (e) => { for (const m of String(e).matchAll(/\b(var|fvar|sysvar|sysfvar)\((\d+)\)\s*:=\s*(-?\d+)/g)) add(m[1] + '(' + m[2] + ')', parseInt(m[3], 10)); };
    for (const e of sc.trig.all) scan(e);
    for (const g of sc.trig.groups) for (const e of g) scan(e);
    for (const val of sc.params.values()) scan(val);
  }
  // Copies carry values along a chain; a variable only ever copied gets its
  // sources' values. Bounded: each pass adds at least one value or stops.
  for (let pass = 0, changed = true; changed && pass < 64; pass++) {
    changed = false;
    for (const [to, from] of copies) {
      for (const v of dom[from] || []) { if (!(dom[to] && dom[to].includes(v))) { add(to, v); changed = true; } }
    }
  }
  for (const k in dom) dom[k].sort((a, b) => a - b);
  return dom;
}

// ---- a trigger that REQUIRES ishelper ----------------------------------------
// One trigger expression, lowercased with its spaces gone: does it require
// ishelper? `ishelper`, `ishelper(22)`, with `= 1` or `!= 0`, or one conjunct
// of an expression with no top-level `||`. -> { id } (null id = any helper) or
// null. `!ishelper` and an ishelper inside another function are not. Brackets
// around the whole expression or around one conjunct change nothing:
// `(ishelper(7))` is `ishelper(7)`. Used by modlib charBodyAction (a helper's
// ChangeAnim) and movelib helperRunStates.
function ishelperNeed(expr) {
  // `( ... )` around the whole of s, as many times as it is there
  const unwrap = (s) => {
    for (;;) {
      if (s.length < 2 || s[0] !== '(' || s[s.length - 1] !== ')') return s;
      let depth = 0, whole = true;
      for (let i = 0; i < s.length - 1; i++) {
        if (s[i] === '(') depth++;
        else if (s[i] === ')') depth--;
        if (depth === 0) { whole = false; break; }
      }
      if (!whole) return s;
      s = s.slice(1, -1);
    }
  };
  const atom = (s) => {
    const m = /^ishelper(?:\((\d+)\))?(?:=1|!=0)?$/.exec(unwrap(s));
    return m ? { id: m[1] !== undefined ? Number(m[1]) : null } : null;
  };
  const e = unwrap(String(expr || ''));
  const whole = atom(e);
  if (whole) return whole;
  const parts = [];
  let depth = 0, from = 0;
  for (let i = 0; i < e.length; i++) {
    const c = e[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (depth === 0 && c === '|' && e[i + 1] === '|') return null;
    else if (depth === 0 && c === '&' && e[i + 1] === '&') { parts.push(e.slice(from, i)); from = i + 2; i++; }
  }
  parts.push(e.slice(from));
  if (parts.length < 2) return null;
  for (const p of parts) { const a = atom(p); if (a) return a; }
  return null;
}

// ---- helper context (Rule D) ------------------------------------------------
function helperStates(states) {
  const roots = [];
  for (const s of states.values()) for (const sc of s.sctrls) if (sc.type === 'helper') { const n = lit(sc.params.get('stateno')); if (n !== null) roots.push(n); }
  const seen = new Set();
  const q = [...roots];
  while (q.length) {
    const n = q.shift();
    if (seen.has(n) || !states.has(n)) continue;
    seen.add(n);
    for (const sc of states.get(n).sctrls) if (sc.type === 'changestate') { const t = lit(sc.params.get('value')); if (t !== null && !seen.has(t)) q.push(t); }
  }
  return seen;
}

// A COMPUTED VICTIM ANIMATION THAT CAN STILL BE READ: "the giver's current
// action number, plus a constant". The Futa brand's whole protocol is this one
// line - `ChangeAnim2 value = StateOwner,anim + 1000` - so its givers name no
// victim number by literal and the bench saw one demand where there are
// dozens. In a custom state the victim runs the giver's code, so StateOwner,
// enemynear, enemy, p2, root and parent all name him. Two shapes:
//   <giver>,anim + K [+ K2 ...]
//   ifelse(selfanimexist(F) [= 1], <giver>,anim + A, <giver>,anim + B)
// the second being the brand's flag: a victim who SHIPS action F gets the
// giver's other table bank. -> { expr, flag, offset } with flag null, or
// { expr, flag, whenShipped, otherwise }; null for anything else, which stays
// in `derived` as the text it was.
const REL_GIVER = '(?:stateowner|enemynear(?:\\(\\s*\\d*\\s*\\))?|enemy(?:\\(\\s*\\d*\\s*\\))?|p2|root|parent)';
const REL_TERM = REL_GIVER + '\\s*,\\s*anim\\s*((?:\\+\\s*\\d+\\s*)+)';
const REL_ONE = new RegExp('^\\s*' + REL_TERM + '$', 'i');
const REL_FLAG = new RegExp('^\\s*ifelse\\s*\\(\\s*selfanimexist\\s*\\(\\s*(\\d+)\\s*\\)\\s*(?:(!=|=)\\s*(\\d+)\\s*)?,\\s*' + REL_TERM + ',\\s*' + REL_TERM + '\\)\\s*$', 'i');
function relativeDemand(raw) {
  const e = String(raw === undefined || raw === null ? '' : raw);
  const sum = (terms) => terms.split('+').map((x) => x.trim()).filter(Boolean).reduce((a, b) => a + parseInt(b, 10), 0);
  const one = REL_ONE.exec(e);
  if (one) return { expr: e.trim(), flag: null, offset: sum(one[1]) };
  const f = REL_FLAG.exec(e);
  if (!f) return null;
  // `= 1`, `!= 0` and a bare call all mean "she ships it"; `= 0` and `!= 1` the reverse
  const op = f[2] || '!=', val = f[2] ? parseInt(f[3], 10) : 0;
  const firstWhenShipped = op === '=' ? val !== 0 : val === 0;
  const a = sum(f[4]), b = sum(f[5]);
  return { expr: e.trim(), flag: parseInt(f[1], 10), whenShipped: firstWhenShipped ? a : b, otherwise: firstWhenShipped ? b : a };
}

// A RELAY'S ANIMATION, `PrevStateNo`, `PrevStateNo + K` or `PrevStateNo - K`
// (un-redirected, nothing else in it): K, else null.
function prevOffset(raw) {
  const m = /^\s*prevstateno\s*(?:([+-])\s*(\d+))?\s*$/i.exec(String(raw === undefined || raw === null ? '' : raw));
  if (!m) return null;
  return m[1] ? (m[1] === '-' ? -1 : 1) * parseInt(m[2], 10) : 0;
}
// The numbers a trigger set probes of the runner's own table
// (`SelfAnimExist(PrevStateNo + 3200005)`), each argument read under ctx.
function relayProbes(trig, ctx) {
  const out = new Set();
  const each = (e) => {
    const str = String(e);
    for (const m of str.matchAll(/\bselfanimexist\s*\(([^()]*)\)/gi)) {
      if (/,\s*$/.test(str.slice(0, m.index))) continue;
      const v = X.evalExpr(m[1], ctx);
      if (Number.isFinite(v)) out.add(v);
    }
  };
  for (const e of trig.all || []) each(e);
  for (const g of trig.groups || []) for (const e of g) each(e);
  return out;
}

// ---- the analysis --------------------------------------------------------------
// opts: { resolve: rel -> abs|null (required), victimActions: Set|null, giverActions: Set|null,
//         consts: Map|undefined, ikemenVersion: bool (both passed to parseStates) }
function analyzeGiver(charDir, defName, opts) {
  const resolve = opts && opts.resolve ? opts.resolve : (rel) => { const p = path.join(charDir, rel); return fs.existsSync(p) ? p : null; };
  const files = stateFiles(charDir, defName, resolve);
  const parsed = parseStates(files, { consts: opts && opts.consts, ikemenVersion: opts && opts.ikemenVersion });
  const { states, read } = parsed;
  // A later negative block the engine drops is as dead as a shadowed
  // duplicate: report both where the pair bench always showed them, in the
  // order the files were read.
  const shadowed = [...parsed.shadowed, ...parsed.droppedNegative.map((d) => ({ no: d.no, file: d.file, line: d.line }))]
    .sort((a, b) => (read.indexOf(a.file) - read.indexOf(b.file)) || (a.line - b.line));
  const domains = domainsOf(states);
  const helpers = helperStates(states);
  const victimHas = opts && opts.victimActions instanceof Set ? opts.victimActions : null;
  const giverHas = opts && opts.giverActions instanceof Set ? opts.giverActions : null;
  const ctxBase = {};
  if (victimHas) ctxBase.victimHas = victimHas;
  if (giverHas) ctxBase.selfHas = giverHas;
  // The animations a state can hold: its header and its ChangeAnim literals.
  // `anim = N` in a trigger with N outside that set never holds (a guard
  // copied from another state and left dead).
  const animSetOf = (s) => {
    const set = new Set();
    const h = lit(s.anim); if (h !== null) set.add(h);
    for (const sc of s.sctrls) if (sc.type === 'changeanim') { const n = lit(sc.params.get('value')); if (n !== null) set.add(n); }
    return set;
  };
  // WHAT IS EVER ENTERED (reachable, above): an issuer nothing reaches is
  // dead code and a scene it "issues" cannot happen. A computed reference's
  // reach counts as entered here.
  const reach = reachable(states);
  const live = new Set([...reach.live, ...reach.soft]);
  const deadState = (no) => states.has(no) && !live.has(no);

  // -- entry edges into custom states (rules A/B/C/E), then victim chains (F)
  const edges = [];            // { to, from, kind, sc, assignments?, expr?, p1?, prev? }
  const unsolvable = [];       // { state, expr, reason }
  // RELATIVE TO HIS OWN STATE (rule C, the director's idiom): a TargetState
  // value that reads his StateNo or PrevStateNo, un-redirected
  // (ero_helper_gs' 3000 `StateNo + 1000`, its 3990 `PrevStateNo + 2000 *
  // var(var(59)) - 1000`). StateNo is the statedef's own number (a state
  // >= 0; in -1/-2/-3 it is wherever he is, unknown). PrevStateNo is each
  // state of his that ChangeStates into it by a literal value (3010, 3020,
  // ... into 3990), one solve per predecessor, the edge carrying it as
  // `prev`; a state nothing enters that way leaves it unsolvable. HitDef
  // and Projectile p2stateno values stay as they were.
  const predsOf = (() => {
    let byTo = null;
    return (no) => {
      if (!byTo) {
        byTo = new Map();
        for (const s of states.values()) for (const sc of s.sctrls) {
          if (sc.type !== 'changestate') continue;
          const t = lit(sc.params.get('value'));
          if (t === null || t === s.no) continue;
          if (!byTo.has(t)) byTo.set(t, []);
          if (!byTo.get(t).includes(s.no)) byTo.get(t).push(s.no);
        }
      }
      return (byTo.get(no) || []).slice(0, 64);
    };
  })();
  const relRead = (raw) => {
    const r = { stateno: false, prev: false };
    let rd = [];
    try { rd = X.readsOf(String(raw)); } catch (e) { rd = []; }
    for (const x of rd) if (x.via === null) { if (x.field === 'stateno') r.stateno = true; else if (x.field === 'prevstateno') r.prev = true; }
    return r.stateno || r.prev ? r : null;
  };
  for (const s of states.values()) for (const sc of s.sctrls) {
    if (sc.type === 'targetstate') {
      const raw = sc.params.get('value');
      const n = lit(raw);
      if (n !== null) { edges.push({ to: n, from: s.no, kind: 'targetstate', sc }); continue; }
      if (raw === undefined) continue;
      const rel = X.parses(raw) && s.no >= 0 ? relRead(raw) : null;
      if (rel) {
        // (Only the predecessors the TargetState's own triggers allow:
        // Minotaur 1_1's horse 7200 on `prevstateno = [7201,7204]`.)
        const fixeds = (rel.prev ? predsOf(s.no).map((p) => (rel.stateno ? { stateno: s.no, prevstateno: p } : { prevstateno: p })) : [{ stateno: s.no }])
          .filter((f) => { try { return X.evalTriggerSet(sc.trig, f) !== false; } catch (e) { return true; } });
        // Unsolvable as it always read, unless a solve below reaches a state.
        const u = { state: s.no, expr: raw, reason: X.varsOf(raw).length ? 'no state number in reach under the variables\' domains' : 'no variable to solve' };
        unsolvable.push(u);
        for (const fixed of fixeds) edges.push({ kind: 'targetstate-expr', from: s.no, sc, expr: raw, fixed, u });
        continue;
      }
      if (!X.parses(raw) || !X.varsOf(raw).length) { unsolvable.push({ state: s.no, expr: raw, reason: X.parses(raw) ? 'no variable to solve' : 'unreadable' }); continue; }
      edges.push({ kind: 'targetstate-expr', from: s.no, sc, expr: raw });
    } else if (sc.type === 'hitdef' || sc.type === 'projectile' || sc.type === 'reversaldef') {
      const raw = sc.params.get('p2stateno');
      if (raw === undefined) continue;
      const n = lit(raw);
      const p1 = lit(sc.params.get('p1stateno'));
      if (n !== null) { if (!isBasic(n)) edges.push({ to: n, from: s.no, kind: 'hitdef', sc, p1 }); continue; }
      // Computed: solved like a TargetState below, or its ifelse leaves.
      if (X.parses(raw) && X.varsOf(raw).length) { edges.push({ kind: 'hitdef-expr', from: s.no, sc, expr: raw, p1 }); continue; }
      const leaves = X.parses(raw) ? [...new Set([...X.evalRandom(raw, {}), ...X.leavesOf(raw)])].filter((t) => !isBasic(t)) : [];
      if (leaves.length) for (const t of leaves) edges.push({ to: t, from: s.no, kind: 'hitdef', sc, p1, expr: raw });
      else unsolvable.push({ state: s.no, expr: raw, reason: X.parses(raw) ? 'p2stateno has no literal to reach' : 'p2stateno is unreadable' });
    }
  }
  // Computed targets: which custom states exist is only known once the
  // literal ones are in, so solve against every state number in the file
  // that lies within the expression's reach (base .. base+40 is plenty).
  const custom = new Set(edges.filter((e) => e.to !== undefined).map((e) => e.to));
  // One enumeration per expression (a giver can carry hundreds of computed
  // targets), then every value that names an existing state is an edge.
  // (A value relative to his state is solved once per predecessor; its
  // unsolvable line goes once one of them reaches a state.)
  // A value solved that way that lands on a state of his - one that acts
  // itself (hits, issues a scene, spawns) or one his helpers run (rule D's
  // reach) - is his, not hers: ero_helper_gs' 3990 after 3100 with
  // var(var(59)) at 0 reads 2100, its helper's grab; 3991 after 3101 reads
  // 2101-2105, its helper's own states.
  const relHits = new Map();
  const acts = (no) => helpers.has(no) || states.get(no).sctrls.some((sc) => ['hitdef', 'projectile', 'reversaldef', 'targetstate', 'helper'].includes(sc.type));
  // A value relative to his state is also solved over the computed domains
  // (an ifelse's leaves: ero_helper_zero's member sets `var(4) =
  // ifelse(Random % Parent,var(1) < var(5), 5, 0)` in its 7000, so 5 as well
  // as 0), with a read of its ROOT's variable (`Parent,var(9)`, `Root,var(N)`)
  // at the root's round-start 0, where the gallery's setup holds it. Its hub
  // 7002 gives her `3220000 + PrevStateNo + var(4) + Parent,var(9) * 100`:
  // with neither read the value is unknown, her 3227010-3227029 are no scenes
  // of his and he has no pair. Only these edges are read so.
  const domainsRel = domainsOf(states, { computed: true });
  const rootAtRest = (name) => (/^(parent|root)$/i.test(String(name)) ? 0 : undefined);
  for (const e of edges.filter((e) => e.kind === 'targetstate-expr' || e.kind === 'hitdef-expr')) {
    const values = e.fixed ? X.solveAll(e.expr, domainsRel, Object.assign({}, e.fixed, { redirVar: rootAtRest })) : X.solveAll(e.expr, domains, e.fixed);
    const prev = e.fixed && e.fixed.prevstateno !== undefined ? { prev: e.fixed.prevstateno } : {};
    let hits = 0;
    for (const [v, sols] of values) {
      if (isBasic(v) || !states.has(v) || (e.fixed && acts(v))) continue;
      hits++;
      if (e.kind === 'targetstate-expr') edges.push(Object.assign({ to: v, from: e.from, kind: 'targetstate', sc: e.sc, assignments: sols, expr: e.expr }, prev, e.fixed ? { fixed: e.fixed } : {}));
      else edges.push({ to: v, from: e.from, kind: 'hitdef', sc: e.sc, assignments: sols, expr: e.expr, p1: e.p1 });
      custom.add(v);
    }
    if (e.u) { if (hits) relHits.set(e.u, true); continue; }
    if (!hits) unsolvable.push({ state: e.from, expr: e.expr, reason: 'no state number in reach under the variables\' domains' });
  }
  if (relHits.size) for (let i = unsolvable.length - 1; i >= 0; i--) if (relHits.has(unsolvable[i])) unsolvable.splice(i, 1);
  // THE CUSTOM STATE NUMBER ENCODES THE POSE. When a computed TargetState
  // reaches C under var(40)=1, var(39)=0, that is what C means for every
  // edge into it - the entry shell that targets 6201 by literal after the
  // grab does so because var(40) is 1. Implied assignments per state.
  const implied = new Map();
  const postKO = (no) => (no >= 180 && no <= 199) || no < 0;
  // (An edge solved with no variable - `StateNo + 1000` - implies nothing.)
  for (const e of edges) if (e.kind === 'targetstate' && e.assignments && !postKO(e.from)) {
    const named = e.assignments.filter((a) => Object.keys(a).length);
    if (!named.length) continue;
    if (!implied.has(e.to)) implied.set(e.to, []);
    const list = implied.get(e.to);
    for (const a of named) if (!list.some((b) => nameOfAssign(b) === nameOfAssign(a))) list.push(a);
  }
  // `var(40)=1` beside `var(40)=1, var(39)=0` says nothing more: keep the
  // fuller assignment when a shorter one agrees with it on every variable.
  for (const [c, list] of implied) {
    const keep = list.filter((a) => !list.some((b) => b !== a && Object.keys(a).length < Object.keys(b).length && Object.keys(a).every((k) => b[k] === a[k])));
    implied.set(c, keep.length ? keep : list);
  }
  // Victim chains: a custom state that ChangeStates / SelfStates to another.
  // A value of `<giver>,StateNo + k` (Sanae: the victim's state is always
  // the giver's plus 8) is the same offset the HitDef used (p2stateno -
  // p1stateno), so every giver state G reachable from the HitDef's own state
  // with G + k defined is a scene, entered when the giver is in G.
  const offsetChains = [];
  const chained = new Set();
  const growChains = () => {
  let grew = true;
  while (grew) {
    grew = false;
    for (const c of [...custom]) {
      const s = states.get(c);
      if (!s) continue;
      for (const sc of s.sctrls) {
        // A SelfState returns her to HER OWN states: the giver's state of
        // that number never runs, so it is a release, never a chain. A
        // ChangeState into a basic state (0-199, the 5000s) is the scene's
        // end for the same reason.
        if (sc.type !== 'changestate') continue;
        const raw = sc.params.get('value');
        const om = raw !== undefined && /\b(?:enemy|enemynear|p2|target|playerid\([^)]*\))\s*,\s*stateno\s*\+\s*(\d+)\s*$/i.exec(String(raw).trim());
        if (om) { const k = parseInt(om[1], 10); if (!offsetChains.some((o) => o.from === c && o.k === k)) offsetChains.push({ from: c, k }); continue; }
        const t = lit(raw);
        if (t === null || t === c || isBasic(t)) continue;
        const key = c + '>' + t;
        if (chained.has(key)) continue;
        chained.add(key);
        edges.push({ to: t, from: c, kind: 'chain', sc });
        if (!custom.has(t)) { custom.add(t); grew = true; }
      }
    }
    for (const o of offsetChains) {
      // The giver states this chain can follow: from the HitDef issuer's
      // p1 state (or the issuer itself) through ChangeState, four hops.
      const starts = edges.filter((e) => e.kind === 'hitdef' && e.to === o.from).map((e) => (e.p1 !== null ? e.p1 : e.from));
      const seen = new Set(), q = [...starts];
      while (q.length) {
        const g = q.shift();
        if (seen.has(g) || !states.has(g) || seen.size > 64) continue;
        seen.add(g);
        const to = g + o.k;
        if (states.has(to) && to !== o.from && !edges.some((e) => e.kind === 'follows' && e.to === to && e.from === g)) {
          edges.push({ to, from: g, kind: 'follows', sc: null, target: g, offset: o.k });
          if (!custom.has(to)) { custom.add(to); grew = true; }
        }
        for (const sc of states.get(g).sctrls) if (sc.type === 'changestate') { const t = lit(sc.params.get('value')); if (t !== null && !seen.has(t)) q.push(t); }
      }
    }
  }
  };
  growChains();
  // THE GIVER FOLLOWING THE VICTIM: a GIVER state (never a custom one - a
  // custom state's `enemy,stateno = G` is her chain, rule F1) entered on
  // `enemynear,StateNo = C` (kuromaru_Lite's dog moves to 6090 when she
  // reaches 6095 by her own chain) is C's pose too.
  const issuesScenes = (no) => { const s = states.get(no); return !!s && s.sctrls.some((sc) => sc.type === 'targetstate' || ((sc.type === 'hitdef' || sc.type === 'projectile') && sc.params.has('p2stateno'))); };
  for (const s of states.values()) {
    if (custom.has(s.no)) continue;
    for (const sc of s.sctrls) {
      if (sc.type !== 'changestate') continue;
      const t = lit(sc.params.get('value'));
      if (t === null) continue;
      const txt = [...sc.trig.all, ...sc.trig.groups.flat()].join(' ');
      for (const m of txt.matchAll(/\b(?:enemy|enemynear|p2|target)\s*,\s*stateno\s*=\s*(\d+)/gi)) {
        const c = parseInt(m[1], 10);
        // The named state must be hers: a state that itself issues scenes is
        // the giver's own (brian's 7001 grab), not a custom state she is in.
        if (isBasic(c) || c === s.no || issuesScenes(c)) continue;
        edges.push({ to: c, from: s.no, kind: 'follows', sc, target: t, command: s.no < 0 });
        custom.add(c);
      }
    }
  }
  growChains();

  // -- the pose of one giver state under an assignment
  function nameOfAssign(a) { return Object.keys(a).map((k) => k + '=' + a[k]).join(', '); }
  const animExists = (n) => (giverHas ? giverHas.has(n) : null);
  // A time-triggered ChangeAnim is a phase (Rule H); the tick is the literal.
  // Only `time = N` is a tick: an AnimElem number orders phases but is not
  // on the tick scale and clips nothing.
  const tickOf = (t) => {
    const scan = (e) => { const m = /(?:^|&&)\s*time\s*=\s*(\d+)\s*(?:&&|$)/i.exec(e); return m ? parseInt(m[1], 10) : null; };
    for (const g of t.groups) for (const e of g) { const k = scan(e); if (k !== null) return k; }
    for (const e of t.all) { const k = scan(e); if (k !== null) return k; }
    return null;
  };
  const elemOf = (t) => {
    const scan = (e) => { const m = /(?:^|&&)\s*animelem\s*=\s*(\d+)\s*(?:&&|$)/i.exec(e); return m ? parseInt(m[1], 10) : null; };
    for (const g of t.groups) for (const e of g) { const k = scan(e); if (k !== null) return k; }
    for (const e of t.all) { const k = scan(e); if (k !== null) return k; }
    return null;
  };
  const unknownAtoms = (t) => {
    const out = [];
    const each = (e) => { if (X.evalExpr(e, ctxBase) === null && X.parses(e) && out.length < 3) out.push(e.replace(/\s+/g, ' ').trim()); };
    for (const e of t.all) each(e);
    for (const g of t.groups) for (const e of g) each(e);
    return out;
  };
  const valuesOf = (raw, ctx) => {
    const n = lit(raw);
    if (n !== null) return { vals: [n], random: false };
    if (!X.parses(raw)) return { vals: [], random: false };
    if (X.usesRandom(raw)) return { vals: X.evalRandom(raw, ctx).filter(Number.isFinite), random: true };
    const v = X.evalExpr(raw, ctx);
    return { vals: Number.isFinite(v) ? [v] : [], random: false };
  };
  const pushPose = (list, anim, kind, label, source, extra) => {
    if (!Number.isFinite(anim)) return;
    const dup = list.find((p) => p.anim === anim && p.source === source);
    if (dup) { if (kind === 'certain' && dup.kind !== 'certain') { dup.kind = 'certain'; dup.label = label; } return; }
    list.push(Object.assign({ anim, kind, label, source, exists: animExists(anim) }, extra || {}));
  };
  // posesOf: the header (if the state persists), then its ChangeAnims judged
  // by trigger. Transients (an unconditional ChangeState) are followed.
  const posesOf = (no, assignments, depth, seen, persists) => {
    const out = { poses: [], flags: new Set(), via: [] };
    if (depth > 3 || seen.has(no)) return out;
    seen.add(no);
    // A basic state (0, the 5000s) REACHED BY FOLLOWING is the giver's own
    // idle or gethit, not a pose of the scene: flag it and draw nothing from
    // it - whether or not the character's own files define it (state 0 is
    // usually the engine's common file). An issuer evaluated as itself (a
    // win state 182 holding the pose) is read like any other.
    if (isBasic(no) && !persists) { out.via.push(no); out.flags.add(no === 0 ? 'idle' : 'basic'); return out; }
    if (!states.has(no)) return out;
    const s = states.get(no);
    out.via.push(no);
    if (helpers.has(no)) out.flags.add('helper');
    // Invisible for the state, not for one tick: `trigger1 = 1` (every tick)
    // counts, `time = 0` alone does not.
    const oneTick = (t) => isImmediate(t) && X.evalTriggerSet(t, { time: 1 }) === false;
    for (const sc of s.sctrls) if (sc.type === 'assertspecial' && /invisible/i.test([...sc.params.values()].join(' ')) && !oneTick(sc.trig)) out.flags.add('invisible');
    const assigns = (assignments && assignments.length ? assignments : [{}]).slice(0, 16);
    const animSet = animSetOf(s);
    // A zero-tick shell: an exit that fires on the first tick (`1`,
    // `time = 0`) means the header never draws; follow it.
    const exit = s.sctrls.find((sc) => sc.type === 'changestate' && isImmediate(sc.trig) && sc.params.get('value') !== undefined);
    const transient = !!exit && !persists;
    // A ChangeAnim that fires on the first tick, certainly, replaces the
    // header before it is ever drawn: the header is not a pose then.
    const zeroAnim = s.sctrls.some((sc) => sc.type === 'changeanim' && isImmediate(sc.trig));
    if (!transient && !zeroAnim && s.anim !== null) {
      for (const a of assigns) {
        const ctx = Object.assign({}, ctxBase, a, { animSet });
        const { vals, random } = valuesOf(s.anim, ctx);
        if (!vals.length) { if (!out.poses.some((p) => p.label === 'header ' + s.anim)) out.poses.push({ anim: null, kind: 'unresolved', label: 'header ' + s.anim, source: no, exists: null }); continue; }
        for (const v of vals) pushPose(out.poses, v, random ? 'random' : 'certain', random ? 'random' : (Object.keys(a).length && assigns.length > 1 ? nameOfAssign(a) : 'header'), no);
      }
    }
    for (const sc of s.sctrls) {
      if (sc.type !== 'changeanim') continue;
      const raw = sc.params.get('value');
      if (raw === undefined) continue;
      const tick = tickOf(sc.trig), elem = tick === null ? elemOf(sc.trig) : null;
      for (const a of assigns) {
        const ctx = Object.assign({}, ctxBase, a, { animSet });
        // Judged at its own tick when it has one, so `time = 0` alone is
        // certain and `time = 76 && var(29) = 2` is conditional on var(29).
        const t = X.evalTriggerSet(sc.trig, tick !== null ? Object.assign({ time: tick }, ctx) : ctx);
        if (t === false) continue;
        const { vals, random } = valuesOf(raw, ctx);
        if (!vals.length) { if (!out.poses.some((p) => p.label === 'ChangeAnim ' + raw)) out.poses.push({ anim: null, kind: 'unresolved', label: 'ChangeAnim ' + raw, source: no, exists: null }); continue; }
        const atoms = t === null ? unknownAtoms(sc.trig) : [];
        const kind = tick !== null ? (tick === 0 && t === true && !random ? 'certain' : 'timed') : elem !== null ? 'timed' : random ? 'random' : t === true ? 'certain' : 'conditional';
        const when = tick !== null && kind === 'timed' ? 'at tick ' + tick : elem !== null ? 'at frame ' + elem : null;
        const label = (Object.keys(a).length && assigns.length > 1 ? nameOfAssign(a) + (atoms.length ? '; ' : '') : '') + (when ? when + (atoms.length ? ', if ' + atoms.join(' and ') : '') : random ? 'random' : atoms.length ? 'if ' + atoms.join(' and ') : 'certain');
        // Only a real tick is a `tick`: an AnimElem phase carries `elem`.
        // The trigger atoms ride along, for the co-firing rule.
        const extra = tick !== null ? { tick } : elem !== null ? { elem } : { tick: 0 };
        extra.atoms = [...atomsOf(sc.trig)];
        for (const v of vals) pushPose(out.poses, v, kind, label, no, extra);
      }
    }
    if (transient) {
      // The shell's exit value: a literal, or an expression under the
      // assignment, or the literal leaves of an ifelse.
      const raw = exit.params.get('value');
      let targets = [];
      const n = lit(raw);
      if (n !== null) targets = [n];
      else { for (const a of assigns) { const v = X.evalExpr(raw, Object.assign({}, ctxBase, a)); if (Number.isFinite(v) && !targets.includes(v)) targets.push(v); } if (!targets.length) targets = X.leavesOf(raw); }
      for (const t of targets.filter((t) => states.has(t) || isBasic(t))) {
        const next = posesOf(t, assignments, depth + 1, seen, false);
        out.poses.push(...next.poses);
        for (const f of next.flags) out.flags.add(f);
        out.via.push(...next.via);
      }
    }
    return out;
  };
  // CO-FIRING (Rule C2). In a state that issues several scenes as phases
  // (Science for Adults' thrust staircase: TargetState 1806071 and ChangeAnim
  // 1802011 both on `anim = 1802010 && var(1) >= 1`, then 1806072 with
  // 1802012...), a ChangeAnim whose trigger atoms are all among the
  // TargetState's fires with it and is that scene's certain pose; one whose
  // atoms are those of ANOTHER TargetState of the same state belongs to that
  // other scene and is not this one's.
  const coFire = (poses, P, tsSc) => {
    if (!P || !tsSc) return poses;
    const sub = (a, b) => [...a].every((x) => b.has(x) || (x === 'movecontact' && b.has('movehit')));
    // A per-victim probe (`target,SelfAnimExist(N) = 1`) picks the variant,
    // not the tick: it is judged against the receiver elsewhere and is no
    // part of the pairing.
    const strip = (set) => new Set([...set].filter((a) => !/animexist/.test(a)));
    const here = strip(atomsOf(tsSc.trig));
    const others = P.sctrls.filter((sc) => sc.type === 'targetstate' && sc !== tsSc).map((sc) => strip(atomsOf(sc.trig))).filter((a) => a.size);
    return poses.filter((p) => {
      if (!p.atoms || p.source !== P.no || p.anim === null) return true;
      const pa = strip(new Set(p.atoms));
      if (!pa.size) return true;
      if (sub(pa, here)) { if (p.kind === 'conditional') { p.kind = 'certain'; p.label = 'with the TargetState'; } return true; }
      return !others.some((o) => sub(pa, o));
    });
  };
  // THE PHASES OF A HOLDING STATE, CLIPPED TO THE SCENE. A state that
  // holds through several scenes (Abe's 1806: 1806 at tick 0, then at 76 it
  // shows 1808 and throws the victim into 1812) issues them at ticks; the
  // pose of the scene entered at T is the animation in effect at T, plus the
  // timed changes after T and before the next exit or re-target.
  const clipToWindow = (poses, I, tIn) => {
    // Only an exit that CERTAINLY fires at its tick closes the window; a
    // `parent,var(13) < 2 && time = 379` may not fire, and the state goes on.
    const exits = [];
    for (const sc of I.sctrls) if (sc.type === 'targetstate' || sc.type === 'changestate') { const k = tickOf(sc.trig); if (k !== null && k > (tIn || 0) && X.evalTriggerSet(sc.trig, { time: k }) === true) exits.push(k); }
    const tOut = exits.length ? Math.min(...exits) : Infinity;
    const timed = poses.filter((p) => p.anim !== null && (p.kind === 'timed' || p.kind === 'certain') && p.tick !== undefined);
    const before = timed.filter((p) => p.tick <= (tIn || 0));
    const atTick = before.length ? Math.max(...before.map((p) => p.tick)) : null;
    // Every animation set at that tick is in effect (two ChangeAnims at
    // time 0 keyed on a variable the file does not fix are alternatives).
    const inEffect = new Set(before.filter((p) => p.tick === atTick));
    return poses.filter((p) => {
      if (p.anim === null || p.tick === undefined || (p.kind !== 'timed' && p.kind !== 'certain')) return true;
      if (inEffect.has(p)) return true;
      return p.tick > (tIn || 0) && p.tick < tOut;
    }).map((p) => (inEffect.has(p) && (tIn || 0) > 0 ? Object.assign({}, p, { kind: 'certain', label: 'in effect at tick ' + tIn }) : p));
  };
  // B2 MOVE-ON: a later exit on time / animtime into another scene state is a
  // later phase. An exit to a basic state is the scene's end, not a phase.
  const laterPhases = (I, r, assignments, fromNo) => {
    if (!I) return;
    for (const sc of I.sctrls) {
      if (sc.type !== 'changestate') continue;
      const t = lit(sc.params.get('value'));
      if (t === null || t === fromNo || isBasic(t)) continue;
      const txt = [...sc.trig.all, ...sc.trig.groups.flat()].join(' ').toLowerCase();
      if (!/\b(animtime|time)\s*[=<>]/.test(txt)) continue;
      const later = posesOf(t, assignments, 1, new Set([fromNo]), false);
      for (const p of later.poses) {
        if (p.anim !== null) r.poses.push(Object.assign({}, p, { kind: 'later', label: p.label && p.label !== 'header' && p.label !== 'certain' ? 'then, state ' + t + ' (' + p.label + ')' : 'then, state ' + t }));
      }
    }
  };
  const order = { certain: 0, conditional: 1, timed: 2, random: 3, later: 4, unresolved: 5 };
  const sortPoses = (list) => list.sort((p, q) => (order[p.kind] - order[q.kind]) || ((p.tick || 0) - (q.tick || 0)));
  // A literal TargetState's OWN triggers often fix the variables that pick
  // the pose (`trigger1 = var(40) = 1` on `value = 6201`): every assignment
  // over the domains under which the trigger set is not false. null when
  // the triggers mention no variable, or constrain nothing.
  const assignmentsFromTriggers = (trig) => {
    const names = [];
    const collect = (e) => { for (const v of X.varsOf(e)) if (!names.includes(v)) names.push(v); };
    for (const e of trig.all) collect(e);
    for (const g of trig.groups) for (const e of g) collect(e);
    if (!names.length || names.length > 3) return null;
    const dom = (n) => (domains[n] && domains[n].length ? domains[n] : Array.from({ length: 16 }, (_, i) => i));
    let total = 1;
    for (const n of names) total *= dom(n).length;
    if (total > 4096) return null;
    const out = [];
    const rec = (i, ctx) => {
      if (i === names.length) { if (X.evalTriggerSet(trig, Object.assign({}, ctxBase, ctx)) !== false) out.push(Object.assign({}, ctx)); return; }
      for (const v of dom(names[i])) { ctx[names[i]] = v; rec(i + 1, ctx); }
      delete ctx[names[i]];
    };
    rec(0, {});
    // Thousands of surviving assignments is a trigger that selects nothing
    // (three unconstrained variables); a few is a selection.
    return (!out.length || out.length === total || out.length > 32) ? null : out;
  };

  // -- resolve one edge into a scene entry
  const entryOf = (e) => {
    const ent = { kind: e.kind, from: e.from, giverState: null, poses: [], flags: [], via: [], label: '' };
    const finish = (r) => { ent.poses = sortPoses(r.poses); ent.flags = [...r.flags]; ent.via = r.via; ent.giverState = r.via[0] !== undefined ? r.via[0] : null; return ent; };
    if (e.kind === 'targetstate') {
      const I = states.get(e.from);
      // A win / post-KO issuer (state 180-199, -2, -3) is a real edge but a
      // different moment; listed after the fight-time entries.
      if ((e.from >= 180 && e.from <= 199) || e.from < 0) ent.tag = 'post-KO / win state ' + e.from;
      let assignments = e.assignments || null;
      if (assignments) {
        // The computed edge's solutions, narrowed by the TargetState's own
        // triggers (a solution the triggers contradict never fires) - read
        // with his StateNo / PrevStateNo where the value was solved with them.
        const keep = assignments.filter((a) => X.evalTriggerSet(e.sc.trig, Object.assign({}, ctxBase, a, e.fixed || {})) !== false);
        if (keep.length) assignments = keep;
      } else {
        assignments = assignmentsFromTriggers(e.sc.trig);
        // A VarSet on the SAME trigger set is the same tick: the pose-change
        // command targets 6201 on `var(40) != 1` and sets var(40) = 1 right
        // there. The new value is the one the scene runs under.
        if (assignments && I) {
          const tn = normTrig(e.sc.trig);
          for (const sc of I.sctrls) {
            if (sc.type !== 'varset' || normTrig(sc.trig) !== tn) continue;
            const sets = {};
            const v = lit(sc.params.get('v'));
            if (v !== null) sets['var(' + v + ')'] = lit(sc.params.get('value'));
            for (const [k, val] of sc.params) { const m = /^(var|fvar|sysvar|sysfvar)\((\d+)\)$/.exec(k); if (m) sets[m[1] + '(' + m[2] + ')'] = lit(val); }
            const out = [];
            for (const a of assignments) { const b = Object.assign({}, a); for (const k in sets) if (sets[k] !== null && k in b) b[k] = sets[k]; if (!out.some((x) => nameOfAssign(x) === nameOfAssign(b))) out.push(b); }
            assignments = out;
          }
        }
        // No assignment of its own: what the custom state number implies.
        if (!assignments && implied.has(e.to)) { assignments = implied.get(e.to); ent.implied = true; }
      }
      if (e.expr) {
        ent.expr = e.expr; ent.assignments = assignments.slice(0, 8).map(nameOfAssign);
        // (Relative to his state: which one he came from, and no arrow when
        // nothing else was solved.)
        if (e.prev !== undefined) ent.prev = e.prev;
        const named = ent.assignments.filter(Boolean);
        const to = named.length || !e.fixed ? named.join(' | ') + (assignments.length > 8 ? ' | ...' : '') : null;
        ent.label = e.prev !== undefined
          ? (to !== null ? 'computed TargetState ' + e.expr + ' after state ' + e.prev + ' -> ' + to : 'computed TargetState ' + e.expr + ' after state ' + e.prev)
          : (to !== null ? 'computed TargetState ' + e.expr + ' -> ' + to : 'computed TargetState ' + e.expr);
      }
      else if (assignments) { ent.assignments = assignments.slice(0, 8).map(nameOfAssign); ent.label = (ent.implied ? 'state ' + e.to + ' implies ' : 'TargetState under ') + ent.assignments.join(' | ') + (assignments.length > 8 ? ' | ...' : ''); }
      if (I && deadState(e.from)) {
        const detail = ent.label;
        ent.dead = true; ent.label = detail ? 'unreachable: nothing enters state ' + e.from + '; ' + detail : 'unreachable: nothing enters state ' + e.from;
      }
      // Rule B: a ChangeState on the same tick as the TargetState means the
      // issuer's header never shows for this scene.
      let handoff = null;
      if (I) for (const sc of I.sctrls) {
        if (sc.type !== 'changestate' || sc.params.get('value') === undefined) continue;
        if (sameTick(e.sc.trig, sc.trig)) { handoff = sc.params.get('value'); break; }
      }
      if (handoff !== null) {
        let targets = [];
        const n = lit(handoff);
        if (n !== null) targets.push([n, assignments]);
        else {
          if (assignments) for (const a of assignments) { const v = X.evalExpr(handoff, Object.assign({}, ctxBase, a)); if (Number.isFinite(v) && !targets.some((t) => t[0] === v)) targets.push([v, [a]]); }
          if (!targets.length) for (const v of X.leavesOf(handoff)) targets.push([v, assignments]);
        }
        const real = targets.filter((t) => states.has(t[0]) || isBasic(t[0]));
        if (real.length) {
          const r = { poses: [], flags: new Set(), via: [e.from] };
          for (const [t, as] of real) {
            const x = posesOf(t, as, 1, new Set([e.from]), false);
            // The handed-off state holds from its tick 0 until its own first
            // timed exit or re-target: a phase at that tick is nobody's. If
            // it re-issues this same scene itself, its phases pair with that.
            if (states.has(t)) {
              const P = states.get(t);
              const own = P.sctrls.find((sc) => sc.type === 'targetstate' && lit(sc.params.get('value')) === e.to);
              x.poses = coFire(clipToWindow(x.poses, P, 0), P, own || null);
            }
            r.poses.push(...x.poses); for (const f of x.flags) r.flags.add(f); r.via.push(...x.via);
          }
          ent.handoff = true;
          const done = finish(r);
          done.giverState = real[0][0];
          return done;
        }
      }
      const r = posesOf(e.from, assignments, 0, new Set(), true);
      if (I) r.poses = coFire(clipToWindow(r.poses, I, tickOf(e.sc.trig)), I, e.sc);
      laterPhases(I, r, assignments, e.from);
      return finish(r);
    }
    if (e.kind === 'hitdef') {
      ent.label = (e.sc.type === 'hitdef' ? 'HitDef' : e.sc.type === 'projectile' ? 'Projectile' : 'ReversalDef') + ' p2stateno';
      let P = e.p1;
      if (P === null) {
        const I = states.get(e.from);
        const onHit = I && I.sctrls.find((sc) => sc.type === 'changestate' && lit(sc.params.get('value')) !== null && /\b(movehit|movecontact|moveguarded)\b/i.test([...sc.trig.all, ...sc.trig.groups.flat()].join(' ')));
        P = onHit ? lit(onHit.params.get('value')) : e.from;
      }
      if (deadState(e.from)) { ent.dead = true; ent.label = 'unreachable: nothing enters state ' + e.from + '; ' + ent.label; }
      if (e.expr) { ent.expr = e.expr; if (e.assignments) ent.assignments = e.assignments.map(nameOfAssign); ent.label += ' ' + e.expr; }
      const as = e.assignments || implied.get(e.to) || null;
      const r = posesOf(P, as, 0, new Set(), true);
      laterPhases(states.get(P), r, as, P);
      return finish(r);
    }
    if (e.kind === 'follows') {
      ent.label = e.offset !== undefined ? 'her state follows the giver\'s + ' + e.offset + ': giver in ' + e.target
        : (e.command ? 'a command (state ' + e.from + ') moves the giver to ' + e.target + ' while she is in ' + e.to : 'the giver moves to ' + e.target + ' when she is in ' + e.to);
      if (e.command) ent.command = true;
      const r = posesOf(e.target, implied.get(e.to) || null, 0, new Set(), true);
      laterPhases(states.get(e.target), r, implied.get(e.to) || null, e.target);
      return finish(r);
    }
    if (e.kind === 'chain') {
      const txt = [...e.sc.trig.all, ...e.sc.trig.groups.flat()].join(' ');
      const m = /\b(?:enemy|enemynear|p2|target|playerid\([^)]*\))\s*,\s*stateno\s*=\s*(\d+)/i.exec(txt);
      if (m) { ent.label = 'victim chain, when the giver is in ' + m[1]; return finish(posesOf(parseInt(m[1], 10), null, 0, new Set(), true)); }
      ent.label = 'victim chain (by time / position)';
      ent.anyOf = true;
      // F2: the previous scene's giver states and what they move on to.
      const prev = scenes.get(e.from);
      const r = { poses: [], flags: new Set(), via: [] };
      // One line per animation, and a bound: a chain of chains must not
      // copy its whole ancestry forward (Sanae's cycles ran to 4 GB).
      const seenAnim = new Set();
      if (prev) for (const pe of prev.entries.slice(0, 4)) {
        for (const p of pe.poses) if (p.anim !== null && !seenAnim.has(p.anim) && seenAnim.size < 48) { seenAnim.add(p.anim); r.poses.push(Object.assign({}, p, { kind: 'later', label: 'any-of: ' + (p.label || '') })); }
        for (const f of pe.flags) r.flags.add(f);
        for (const g of pe.via) {
          const s = states.get(g);
          if (!s) continue;
          for (const sc of s.sctrls) if (sc.type === 'changestate') {
            const t = lit(sc.params.get('value'));
            if (t === null || t === g || isBasic(t)) continue;
            const x = posesOf(t, null, 1, new Set([g]), false);
            for (const p of x.poses) if (p.anim !== null && !seenAnim.has(p.anim) && seenAnim.size < 48) { seenAnim.add(p.anim); r.poses.push(Object.assign({}, p, { kind: 'later', label: 'any-of: state ' + t })); }
          }
        }
        if (!r.via.length) r.via.push(...pe.via);
      }
      return finish(r);
    }
    return ent;
  };

  // -- opts.detail: what an entry is issued ON. The entry above names the
  // issuer state and the pose; a caller that has to REPRODUCE the scene (the
  // H gallery holds the command that fires a TargetState) also needs the
  // issuing controller's trigger atoms and the variable assignments the edge
  // was solved under. Opt-in, so every existing caller gets exactly the
  // entries it always got.
  const detail = !!(opts && opts.detail);
  const describeEdge = (ent, e) => {
    ent.trig = e.sc ? { all: [...e.sc.trig.all], groups: e.sc.trig.groups.map((g) => [...g]) } : null;
    ent.ctrl = e.sc ? { type: e.sc.type, file: e.sc.file, line: e.sc.line } : null;
    ent.edgeAssignments = e.assignments ? e.assignments.map((a) => Object.assign({}, a)) : null;
  };

  // -- demands per custom state
  const scenes = new Map();
  const demandsOf = (c) => {
    const s = states.get(c);
    const d = { guarded: [], assumed: [], fallbacks: [], derived: [], computed: [] };
    if (!s) return d;
    const add = (list, n) => { if (Number.isFinite(n) && !list.includes(n)) list.push(n); };
    const probes = new Set();
    for (const sc of s.sctrls) {
      const each = (e) => { for (const m of String(e).matchAll(/\bselfanimexist\((\d+)\)/gi)) { const n = parseInt(m[1], 10); if (isScene(n)) probes.add(n); } };
      // Un-redirected only: `target,SelfAnimExist(N)` in a custom state is
      // the victim probing HER partner, not a demand on her.
      const clean = (e) => String(e).replace(/\b(?:target|enemy|enemynear|p2|partner|parent|root|helper|playerid\([^)]*\))\s*,\s*selfanimexist\(\d+\)/gi, ' ');
      for (const e of sc.trig.all) each(clean(e));
      for (const g of sc.trig.groups) for (const e of g) each(clean(e));
    }
    for (const n of probes) add(d.guarded, n);
    const hn = lit(s.anim);
    if (hn !== null && isScene(hn) && !probes.has(hn)) add(d.assumed, hn);
    for (const sc of s.sctrls) {
      if (sc.type === 'changeanim') { const n = lit(sc.params.get('value')); if (n !== null && isScene(n) && !probes.has(n)) add(d.assumed, n); }
      if (sc.type === 'changeanim2') {
        const raw = sc.params.get('value');
        const n = lit(raw);
        if (n !== null) add(d.fallbacks, n);
        else if (raw !== undefined) {
          if (!d.derived.includes(raw)) d.derived.push(raw);
          // A demand only a HELPER can meet (triggerall = ishelper(N): another
          // character's summon held in this state) is not asked of the
          // character herself.
          const helperOnly = sc.trig.all.some((e) => /^\s*ishelper\b/i.test(String(e)));
          const rel = helperOnly ? null : relativeDemand(raw);
          if (rel && !d.computed.some((x) => x.expr === rel.expr)) d.computed.push(rel);
        }
      }
    }
    // A RELAY she is handed through: a state of hers every position passes
    // on its first tick, whose animation is `PrevStateNo + K` (ero_helper_gs'
    // 4004, `ChangeAnim value = PrevStateNo + 3200000`, entered from 4011,
    // 4012, 4021...; its 6004, `value = PrevStateNo`, from 36637...). Its
    // animation is asked by the state that hands her on, one number per
    // predecessor: 4011 asks 3204011, 36637 asks 36637. Read with her
    // PrevStateNo as that state (a line on `PrevStateNo = 4130` asks nothing
    // of 4011), a ChangeAnim as hers (guarded where the relay probes that very
    // number, `SelfAnimExist(PrevStateNo + K)`), a ChangeAnim2 as his fallback.
    // Only that exact shape; a branch on PrevStateNo (`ifelse(PrevStateNo =
    // 704, 706, 716)`) stays as it was.
    for (const sc of s.sctrls) {
      if (sc.type !== 'changestate') continue;
      const t = lit(sc.params.get('value'));
      if (t === null || t === c || !states.has(t)) continue;
      for (const r of states.get(t).sctrls) {
        if (r.type !== 'changeanim' && r.type !== 'changeanim2') continue;
        const k = prevOffset(r.params.get('value'));
        if (k === null) continue;
        const at = { prevstateno: c, stateno: t };
        let fires = null;
        try { fires = X.evalTriggerSet(r.trig, at); } catch (e) { fires = null; }
        if (fires === false) continue;
        const n = c + k;
        if (r.type === 'changeanim2') { add(d.fallbacks, n); continue; }
        if (!isScene(n)) continue;
        if (relayProbes(r.trig, at).has(n)) { if (!d.guarded.includes(n)) { add(d.guarded, n); const i = d.assumed.indexOf(n); if (i >= 0) d.assumed.splice(i, 1); } }
        else if (!probes.has(n) && !d.guarded.includes(n)) add(d.assumed, n);
      }
    }
    return d;
  };
  // Entries in dependency order: targetstate/hitdef edges first, chains
  // after their sources (so F2 can read the previous scene).
  const byTo = new Map();
  for (const e of edges) { if (e.to === undefined) continue; if (!byTo.has(e.to)) byTo.set(e.to, []); byTo.get(e.to).push(e); }
  // A custom state that leaves on its first tick for a basic state (a
  // SelfState 5110, a ChangeState 0) holds her for no drawn tick: a
  // release, not a scene.
  const isRelease = (c) => { const s = states.get(c); return !!s && s.sctrls.some((sc) => (sc.type === 'selfstate' || sc.type === 'changestate') && isImmediate(sc.trig) && lit(sc.params.get('value')) !== null && isBasic(lit(sc.params.get('value')))); };
  const resolveScene = (c) => {
    const es = byTo.get(c) || [];
    const entries = [];
    for (const e of es) {
      const ent = entryOf(e);
      if (detail) describeEdge(ent, e);
      const key = ent.kind + ':' + ent.from + ':' + (ent.expr || '');
      if (entries.some((x) => x.kind + ':' + x.from + ':' + (x.expr || '') === key)) continue;
      entries.push(ent);
    }
    // Rank: entries with something to show first; then fight-time before
    // win / post-KO issuers (which still beat a victim chain read as any-of:
    // NIKUMUSHI's KO scenes are issued by 182/183 and nothing else names
    // them); a literal TargetState before a giver-follows, before a HitDef,
    // before a chain, before a command from state -1; a dead issuer last.
    const rank = { targetstate: 0, follows: 1, hitdef: 2, chain: 6 };
    const resolved = (x) => x.poses.filter((p) => p.anim !== null).length;
    const score = (x) => rank[x.kind] + (x.tag ? 3 : 0) + (x.command ? 7 : 0) + (resolved(x) ? 0 : 20) + (x.dead ? 100 : 0);
    entries.sort((a, b) => (score(a) - score(b)) || (resolved(b) - resolved(a)));
    scenes.set(c, { state: c, exists: states.has(c), demands: demandsOf(c), entries, helper: helpers.has(c), release: isRelease(c) });
  };
  // Chains after their sources, so F2 can read the previous scene - and a
  // cycle (loop <-> climax, the norm) broken by resolving one state of it
  // when a full pass makes no progress, never by dropping the tail.
  const pending = new Set(custom);
  while (pending.size) {
    let progress = false;
    for (const c of [...pending]) {
      const waits = (byTo.get(c) || []).filter((e) => e.kind === 'chain' && e.from !== c && pending.has(e.from));
      if (waits.length) continue;
      resolveScene(c); pending.delete(c); progress = true;
    }
    if (!progress) { const c = pending.values().next().value; resolveScene(c); pending.delete(c); }
  }

  const out = { files: read, shadowed, domains, helpers: [...helpers].sort((a, b) => a - b), scenes, unsolvable, stateCount: states.size };
  // THE READER'S WORKING SET, for a caller that walks the giver's own states
  // after the scenes are known (gallerydata.js follows his grab through his
  // states to learn which scene a held input or a jump shows): the parsed
  // states (first definition wins, as the engine keeps them), what is ever
  // entered, and every edge into a custom state with its controller's trigger.
  if (detail) {
    out.states = states;
    out.reach = reach;
    // (`prev` only on an edge solved per predecessor: the state of his it
    // came from.)
    out.edges = edges.filter((e) => e.to !== undefined).map((e) => Object.assign({
      to: e.to, from: e.from, kind: e.kind,
      type: e.sc ? e.sc.type : null, file: e.sc ? e.sc.file : null, line: e.sc ? e.sc.line : null,
      trig: e.sc ? { all: [...e.sc.trig.all], groups: e.sc.trig.groups.map((g) => [...g]) } : null,
      expr: e.expr || null, assignments: e.assignments ? e.assignments.map((a) => Object.assign({}, a)) : null,
      p1: e.p1 === undefined ? null : e.p1, target: e.target === undefined ? null : e.target,
      offset: e.offset === undefined ? null : e.offset, command: !!e.command }, e.prev !== undefined ? { prev: e.prev } : {}));
  }
  return out;
}

module.exports = { decodeText, relativeDemand, analyzeGiver, stateFiles, parseStates, reachable, lit, isImmediate, domainsOf, helperStates, ishelperNeed, isScene, trimGo, paramLine, stripBom, lowerGo, goWsLead, tokensGo, parseTriggerName };
