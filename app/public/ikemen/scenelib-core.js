// THE ENGINE'S READING OF A CHARACTER'S FILES, the part that needs no disk:
// Go's text rules (TrimSpace, ToLower, the parameter split, the tokenizer), the
// text a person reads (decodeText), the state files in the engine's order
// (stateFilesOf) and the statedef parser (parseStates). Moved here from
// scenelib.js, which hands it the files from the disk; the web game's in-page
// Studio (studio-lite.html) hands it the files a player drops, through
// cmdlist-core.js - so a character added there gets the Command List the
// export writes, read by the same rules.
//
// Pure: no fs, no path, no Buffer, no DOM. A file is latin1 text (one char
// per byte). Bytes go through TextEncoder / TextDecoder, which Node and the
// browser both have (a strict UTF-8 decode keeps a byte-order mark, as
// Buffer did).
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.scenelibCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // latin1 text <-> its bytes (one byte per char, the low byte, as Buffer's latin1)
  const UTF8 = new TextEncoder();
  const bytesOf = (s) => { const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff; return b; };
  const latin1Of = (b) => { let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return s; };

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
  const utf8Latin1 = (cp) => latin1Of(UTF8.encode(String.fromCodePoint(cp)));
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
    const bytes = bytesOf(latin1);
    if (bytes.every((b) => b < 0x80)) return latin1;
    const utf8 = strictDecode('utf-8', bytes);
    if (utf8 !== null) return utf8;
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
      if (!STRICT[enc]) STRICT[enc] = new TextDecoder(enc, { fatal: true, ignoreBOM: true });
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
    const bytes = bytesOf(s);
    const utf8 = strictDecode('utf-8', bytes);
    if (utf8 !== null) return utf8;
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
  // defText: the def as read (latin1; null = no def); resolve(rel) -> where the
  // file is (whatever the caller reads it by) | null.
  function stateFilesOf(defText, resolve) {
    if (defText == null) return [];
    const text = stripBom(String(defText));
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
  // opts: { consts: Map(lowercased name -> number) | undefined, ikemenVersion: bool,
  //         read(file) -> its text (latin1) | null to skip it }
  function parseStates(files, opts) {
    opts = opts || {};
    const readFile = typeof opts.read === 'function' ? opts.read : () => null;
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
      try { text = readFile(f); if (text == null) continue; text = stripBom(String(text)); } catch (e) { continue; }
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

  return { trimGo, noComment, stripBom, lowerGo, paramLine, atoiGo, goWsLead, tokensGo, parseTriggerName, decodeFilesValue, decodeText, stateFilesOf, parseStates, bytesOf, latin1Of };
});
