'use strict';
// THE .AIR, READ AND EDITED THE WAY THE ENGINE READS IT.
//
// Two jobs, one model:
//
//   parseAirSpans(text)   every action, element, field, Clsn block and box, with
//                         BYTE spans into the file, and each element's effective
//                         Clsn1/Clsn2 exactly as the engine binds them;
//   plan*(text, ...)      edits as splices for charedit.writeSpliced. Nothing in
//                         this module writes a file.
//
// Every rule below is a transcription of Ikemen GO at 96413d2 (src/anim.go
// unless another file is named). It has to be a transcription and not a
// reading of the format docs, because the docs and the engine disagree in the
// places an editor can break a character:
//
//   - A Clsn block binds to the element that FOLLOWS it, and the "use the
//     default" flag resets after every frame line (anim.go:330-342). Insert,
//     delete or reorder a frame line and every block after it silently changes
//     owner. Structural plans therefore never trust position: they re-parse
//     their own result and write explicit own blocks wherever a surviving
//     element's boxes would otherwise change.
//   - First definition of an action number wins (anim.go:1202-1208); an action
//     with no frames becomes a copy of the NEXT action in the file
//     (anim.go:1210-1222); `Copy Action N` makes an alias resolved after the
//     common anims merge (char.go:4310-4340, anim.go:1261-1297).
//   - Fields 8-10 (xscale, yscale, angle) are Ikemen/MUGEN 1.1 additions, and a
//     BLANK xscale means 0 in MUGEN 1.1 but "no change" in Ikemen
//     (anim.go:198-224). A writer must never emit them blank.
//
// Text is latin1 in, latin1 out: one char per byte, so every offset here is a
// byte offset and untouched bytes survive a splice unchanged.
const charedit = require('./charedit.js');
const S = require('./scenelib.js');
// Which element the engine has on screen, tick by tick (Animation.Action) - the
// animation player's own timeline, so this model's labels say what it plays.
const { airTimeline, airTotals } = require('./public/ikemen/animview-core.js');

const FIELD_NAMES = ['group', 'number', 'x', 'y', 'time', 'flip', 'blend', 'xscale', 'yscale', 'angle'];

// ---------------------------------------------------------------------------
// Go helpers, transcribed.

// strings.TrimSpace over a byte string: only the ASCII whitespace set. Bytes
// >= 0x80 are not valid UTF-8 on their own and Go does not trim them.
function isWs(c) { return c === 32 || (c >= 9 && c <= 13); }
function trimSpan(text, s, e) {
  while (s < e && isWs(text.charCodeAt(s))) s++;
  while (e > s && isWs(text.charCodeAt(e - 1))) e--;
  return [s, e];
}
// strings.ToLower on an ASCII string (the only case a line ever reaches the
// parser's prefix checks with; lowering non-ASCII here would change nothing the
// checks look at).
const goTrim = (s) => { const [a, b] = trimSpan(s, 0, s.length); return s.slice(a, b); };
const lowerAscii = (s) => s.replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32));

// common.go:212-241 Atoi: optional sign, digits until the first non-digit,
// clamped to IMax / IErr past int32.
function atoi(str) {
  const t = String(str).replace(/^[ \t\n\v\f\r]+|[ \t\n\v\f\r]+$/g, '');
  if (!t.length) return 0;
  const a = (t[0] === '-' || t[0] === '+') ? t.slice(1) : t;
  let n = 0;
  for (let k = 0; k < a.length; k++) {
    const c = a.charCodeAt(k);
    if (c < 48 || c > 57) break;
    n = n * 10 + (c - 48);
    if (n > 2147483647) return t[0] === '-' ? -2147483648 : 2147483647;
  }
  return t[0] === '-' ? -n : n;
}

// common.go:187-190 IsNumeric = strconv.ParseFloat succeeds. Covers what an
// .air can plausibly hold (decimal, exponent, inf/nan); hex floats and
// underscores are not worth the regex.
const isNumeric = (s) => /^[+-]?((\d+\.?\d*|\.\d+)([eE][+-]?\d+)?|inf|infinity|nan)$/i.test(String(s).trim());

// common.go:243-290 Atof, transcribed: digits with one '.', then an exponent
// read only when more follows the 'e'. Two engine quirks kept on purpose: the
// exponent's sign is looked up in the UNSIGNED string's index (common.go:278
// reads str[i+1] where i counts in a), so `-1e-2` is read as -100; and an
// exponent of 0 changes nothing. math.Pow10 is built from the same two exact
// tables the Go library uses.
function pow10(n) {
  if (n >= 0) return n > 308 ? Infinity : Number('1e' + (32 * Math.floor(n / 32))) * Number('1e' + (n % 32));
  const k = -n;
  return k > 323 ? 0 : Number('1e-' + (32 * Math.floor(k / 32))) / Number('1e' + (k % 32));
}
function atof(strIn) {
  let f = 0;
  const str = goTrim(String(strIn));
  if (!str.length) return 0;
  const a = (str[0] === '-' || str[0] === '+') ? str.slice(1) : str;
  let i = 0, p = 0;
  for (; i < a.length; i++) {
    if (a[i] === '.') { if (p !== 0) break; p = i + 1; continue; }
    const c = a.charCodeAt(i);
    if (c < 48 || c > 57) break;
    f = f * 10 + (c - 48);
  }
  let e = 0;
  if (i + 1 < a.length && (a[i] === 'e' || a[i] === 'E')) {
    let j = i + 1;
    if (a[j] === '-' || a[j] === '+') j++;
    for (; j < a.length && a.charCodeAt(j) >= 48 && a.charCodeAt(j) <= 57; j++) e = e * 10 + (a.charCodeAt(j) - 48);
    if (e !== 0) {
      if (str[i + 1] === '-') e = -e;
      if (p === 0) p = i;
    }
  }
  if (p > 0) f *= pow10(p - i + e);
  if (str[0] === '-') f = -f;
  return f;
}

// ---------------------------------------------------------------------------
// Lines. LoadText strips a UTF-8 BOM (common.go:446-448), then the anim reader
// works on SplitAndTrim(text, "\n") (common.go:730-736, char.go:4301): split on
// LF only, each line TrimSpace'd - which also removes a CR.

function scanLines(text) {
  const lines = [];
  let pos = (text.charCodeAt(0) === 0xef && text.charCodeAt(1) === 0xbb && text.charCodeAt(2) === 0xbf) ? 3 : 0;
  const bom = pos;
  let n = 1;
  for (;;) {
    const nl = text.indexOf('\n', pos);
    const end = nl < 0 ? text.length : nl;
    const [ts, te] = trimSpan(text, pos, end);
    // The processed form every body check uses:
    //   strings.ToLower(strings.TrimSpace(strings.SplitN(line, ";", 2)[0]))
    const semi = text.indexOf(';', ts);
    const cut = semi >= 0 && semi < te ? semi : te;
    const [cs, ce] = trimSpan(text, ts, cut);
    lines.push({
      n, start: pos, end, next: nl < 0 ? text.length : nl + 1, hasNl: nl >= 0,
      ts, te, cs, ce, lc: lowerAscii(text.slice(cs, ce)),
    });
    if (nl < 0) break;
    pos = nl + 1; n++;
  }
  return { lines, bom };
}

// common.go:793-812 SectionName, with offsets. The trimmed line must start with
// '[' and, once the comment is cut, end with ']'; the section text runs to the
// first ']'; the name is everything up to and including the first space.
function sectionName(text, L) {
  if (L.ts >= L.te || text[L.ts] !== '[') return null;
  const semi = text.indexOf(';', L.ts);
  const [ss, se] = trimSpan(text, L.ts, semi >= 0 && semi < L.te ? semi : L.te);
  if (se <= ss || text[se - 1] !== ']') return null;
  const rb = text.indexOf(']', ss);
  const bodyStart = ss + 1;
  const sp = text.indexOf(' ', bodyStart);
  if (sp >= 0 && sp < rb) {
    return { name: lowerAscii(text.slice(bodyStart, sp + 1)), subStart: sp + 1, subEnd: rb };
  }
  return { name: lowerAscii(text.slice(bodyStart, rb)), subStart: rb, subEnd: rb };
}

// ---------------------------------------------------------------------------
// ReadAnimFrame (anim.go:45-235), with a span for every field.

function readFrame(text, L) {
  const line = L.lc;
  // "Valid lines must start with a number or '-'" (anim.go:47-50)
  if (!line.length || ((line.charCodeAt(0) < 48 || line.charCodeAt(0) > 57) && line[0] !== '-')) return null;
  // strings.SplitN(line, ",", 10) then TrimSpace each (anim.go:52-56): the
  // tenth piece keeps every comma after the ninth.
  const pieces = [];
  let p = L.cs;
  while (pieces.length < 9) {
    const c = text.indexOf(',', p);
    if (c < 0 || c >= L.ce) break;
    pieces.push([p, c]);
    p = c + 1;
  }
  pieces.push([p, L.ce]);
  if (pieces.length < 5) return { bad: 'fewer than 5 fields' }; // anim.go:58-60
  const fields = {};
  const ary = [];
  FIELD_NAMES.forEach((name, idx) => {
    if (idx >= pieces.length) { fields[name] = { index: idx, present: false, blank: true, raw: '' }; return; }
    const [s, e] = trimSpan(text, pieces[idx][0], pieces[idx][1]);
    const raw = text.slice(s, e);
    ary.push(lowerAscii(raw));
    // A blank field's span is the empty range right after its comma, so a
    // splice there fills the slot without touching the commas around it.
    fields[name] = { index: idx, present: true, blank: raw === '', raw, start: e > s ? s : pieces[idx][0], end: e > s ? e : pieces[idx][0], pieceStart: pieces[idx][0], pieceEnd: pieces[idx][1] };
  });
  const errors = [];
  const v = {
    group: atoi(ary[0]), number: atoi(ary[1]), x: atoi(ary[2]), y: atoi(ary[3]), time: atoi(ary[4]),
    h: false, v: false, hCount: 0, vCount: 0, blend: '', blendMode: 'none', src: 255, dst: 0, xscale: 1, yscale: 1, angle: 0,
  };
  let flipHoldsBlend = false;
  let a6 = ary.length >= 7 ? ary[6] : undefined;
  if (ary.length >= 6 && ary[5] !== '') {
    let flags = ary[5];
    // WinMugen "...,5,A": the transparency written in the flip field is handed
    // to the alpha field when that one is empty (anim.go:74-92).
    for (let k = 0; k < flags.length; k++) {
      const ch = flags[k];
      if (ch !== 'h' && ch !== 'v') {
        if (a6 === undefined || a6 === '') { a6 = flags.slice(k); flags = flags.slice(0, k); flipHoldsBlend = true; }
        break;
      }
    }
    // Every H sets Hscale = -1 and negates Xoffset again (anim.go:93-99): h/v
    // say flipped (any H), hCount/vCount carry the parity the offset follows.
    for (const ch of flags) {
      if (ch === 'h') { v.h = true; v.hCount++; }
      else if (ch === 'v') { v.v = true; v.vCount++; }
      else errors.push('invalid flip flag ' + ch);
    }
  }
  // WHERE THE AXIS IS DRAWN. Draw multiplies the offset by the flipped scale
  // (xs *= h, xoff = xs * Xoffset), negates x when xs < 0 and mirrors it back
  // about the sprite axis (anim.go:950-1024; render.go:675-677): with no flag
  // or one H the axis lands at +x, with HH (an even count of two or more) the
  // offset was negated twice and then once more by the flip, so at -x. The
  // same for V and y.
  v.xDraw = v.hCount >= 2 && v.hCount % 2 === 0 ? -v.x : v.x;
  v.yDraw = v.vCount >= 2 && v.vCount % 2 === 0 ? -v.y : v.y;
  if (a6 !== undefined && a6 !== '') {
    // anim.go:107-196: from the first A/S, lowercased.
    const ia = a6.search(/[as]/);
    const a = ia >= 0 ? a6.slice(ia) : a6;
    v.blend = a;
    // parseAlphaNumbers (anim.go:109-137): the source is ALWAYS the digits
    // read (0 when there are none); the destination only with `d<digits>`.
    const nums = (s, start, dd) => {
      const m = /^(\d*)(?:d(\d+))?/.exec(s.slice(start));
      const cl = (x) => Math.min(255, (parseInt(x, 10) || 0) & 0x3fff);
      return [cl(m[1] || '0'), m[2] !== undefined ? cl(m[2]) : dd];
    };
    if (a === 'a1') { v.blendMode = 'add'; v.src = 255; v.dst = 128; }
    else if (a.startsWith('sas')) { v.blendMode = 'subadd'; [v.src, v.dst] = nums(a, 3, 255); }
    else if (a.startsWith('sa')) { v.blendMode = 'subadd'; v.src = 255; v.dst = 255; if (a.length > 2) errors.push('invalid transparency ' + a); }
    else if (a.startsWith('as')) { v.blendMode = 'add'; [v.src, v.dst] = nums(a, 2, 0); }
    else if (a.startsWith('ss')) { v.blendMode = 'sub'; [v.src, v.dst] = nums(a, 2, 255); }
    else if (a[0] === 'a') { v.blendMode = 'add'; v.src = 255; v.dst = 255; if (a.length > 1) errors.push('invalid transparency ' + a); }
    else if (a[0] === 's') { v.blendMode = 'sub'; v.src = 255; v.dst = 255; if (a.length > 1) errors.push('invalid transparency ' + a); }
    else errors.push('invalid transparency ' + a);
  }
  // anim.go:198-224. Blank = "no change" in Ikemen (and 0 in MUGEN 1.1).
  [['xscale', 7], ['yscale', 8], ['angle', 9]].forEach(([name, idx]) => {
    if (ary.length > idx && ary[idx] !== '') {
      if (isNumeric(ary[idx])) v[name] = atof(ary[idx]);
      else errors.push('invalid ' + name + ' ' + ary[idx]);
    }
  });
  return { fields, fieldCount: pieces.length, values: v, errors, flipHoldsBlend };
}

// ---------------------------------------------------------------------------
// parseAirSpans(text) -> model
//
//   {
//     bom, lineCount,
//     actions: [ ACTION ... ]              every [Begin Action] in file order
//     byNo: Map<no, index into actions>    the FIRST definition of each number
//     duplicates: [{ no, line, firstLine }]
//     table: Map<no, { source, copyOf?, emptyCopyOf?, deleted? }>
//   }
//
//   ACTION = {
//     no, index, live (first definition), header: { line, start, end, numStart, numEnd },
//     bodyFrom (offset after the header line), bodyTo (offset where the body ended),
//     elements: [ ELEMENT ... ], clsn: [ BLOCK ... ], loopstartLines: [{ line, start, next, at }],
//     loopstart (0-based element index the engine loops to), loopstartFallback,
//     interpolate: [{ kind, line, start, next, at }], copy: { line, raw, target } | null,
//     badFrames: [{ line, why }], items: [{ kind, first, last, start, next, ref }]
//   }
//   ELEMENT = {
//     ordinal (1-based, what AnimElem counts), line, lineStart, lineNext, start, end (content span),
//     fields: { group..angle: { index, present, blank, raw, start, end } }, fieldCount,
//     values, errors, flipHoldsBlend, startTick, neverDisplayed, holdsForever,
//     clsn1: { source: 'own'|'default'|'none', block, adjacent, rects }, clsn2: same
//   }
//   BLOCK = {
//     index, which (1|2), isDefault, line, lineStart, lineNext, headerRaw, count, countRaw,
//     countStart, countEnd, boxes: [{ line, lineStart, lineNext, raw, indexRaw, coords: [{ raw, start, end, value }], rect }],
//     short (fewer box lines than count), rangeNext (offset after the last box line), boundTo: [ordinals]
//   }
function parseAirSpans(textIn) {
  const text = String(textIn == null ? '' : textIn);
  const { lines: L, bom } = scanLines(text);
  const actions = [];
  const byNo = new Map();
  const duplicates = [];
  const tbl = new Map(); // no -> { frames: action index | null, copyAction, src, written }
  let i = 0;

  // ReadAction + ReadAnimation (anim.go:457-481, 292-455). null when the
  // section at i is not an action.
  const readOne = () => {
    let sec = null;
    for (; i < L.length; i++) {
      sec = sectionName(text, L[i]);
      if (sec && sec.name.length) break;
    }
    if (i >= L.length) return null;
    if (sec.name !== 'begin ') return null;
    const sub = text.slice(sec.subStart, sec.subEnd);
    const spi = sub.indexOf(' ');
    if (spi < 0 || lowerAscii(sub.slice(0, spi + 1)) !== 'action ') return null;
    const H = L[i];
    const numRawStart = sec.subStart + spi + 1;
    const [ns, ne] = trimSpan(text, numRawStart, sec.subEnd);
    const no = atoi(text.slice(numRawStart, sec.subEnd));
    i++;
    const act = {
      no, index: actions.length, live: false,
      header: { line: H.n, start: H.start, end: H.end, next: H.next, hasNl: H.hasNl, numStart: ns, numEnd: ne },
      bodyFrom: H.next, bodyTo: H.next,
      elements: [], clsn: [], loopstartLines: [], loopstart: 0, loopstartFallback: false,
      interpolate: [], copy: null, badFrames: [], items: [],
    };
    actions.push(act);
    let clsn1 = null, clsn1d = null, clsn2 = null, clsn2d = null; // block indexes
    let def1 = true, def2 = true;
    let ols = 0;
    const tick = { t: 0 };
    for (; i < L.length; i++) {
      const X = L[i];
      if (X.ts < X.te && text[X.ts] === '[') break; // anim.go:299-301
      act.bodyTo = X.next;
      const line = X.lc;
      // anim.go:309-318. Checked before anything else; ends the body.
      if (line.length >= 12 && line.slice(0, 12) === 'copy action ') {
        const numStr = goTrim(line.slice(12));
        const id = /^[+-]?\d+$/.test(numStr) ? Number(numStr) : NaN;
        act.copy = { line: X.n, raw: text.slice(X.cs, X.ce), target: (Number.isFinite(id) && id >= -2147483648 && id <= 2147483647) ? id : -1 };
        act.items.push({ kind: 'copy', first: X.n, last: X.n, start: X.start, next: X.next });
        break;
      }
      const f = readFrame(text, X);
      if (f && f.bad) {
        act.badFrames.push({ line: X.n, why: f.bad });
        act.items.push({ kind: 'badframe', first: X.n, last: X.n, start: X.start, next: X.next });
        continue;
      }
      if (f) {
        // anim.go:330-342
        ols = act.loopstart;
        if (def1) clsn1 = clsn1d;
        if (def2) clsn2 = clsn2d;
        const ordinal = act.elements.length + 1;
        const bind = (blk, adjacent) => {
          if (blk === null) return { source: 'none', block: null, adjacent: false, rects: [] };
          const B = act.clsn[blk];
          B.boundTo.push(ordinal);
          return { source: B.isDefault ? 'default' : 'own', block: blk, adjacent, rects: B.rects };
        };
        const el = {
          ordinal, line: X.n, lineStart: X.start, lineNext: X.next, hasNl: X.hasNl, lineEnd: X.end, start: X.cs, end: X.ce,
          indent: text.slice(X.start, X.ts),
          fields: f.fields, fieldCount: f.fieldCount, values: f.values, errors: f.errors, flipHoldsBlend: f.flipHoldsBlend,
          // anim.go:507-520: AnimElemTime(N) = curtime - SUM Max(0, time) of
          // the elements before N, so a time-0 element still takes an index.
          startTick: tick.t,
          clsn1: bind(clsn1, !def1), clsn2: bind(clsn2, !def2),
        };
        tick.t += Math.max(0, f.values.time);
        act.elements.push(el);
        act.items.push({ kind: 'frame', first: X.n, last: X.n, start: X.start, next: X.next, ref: ordinal });
        def1 = true; def2 = true;
        continue;
      }
      if (line.length >= 9 && line.slice(0, 9) === 'loopstart') { // anim.go:343-344
        act.loopstart = act.elements.length;
        act.loopstartLines.push({ line: X.n, start: X.start, next: X.next, at: act.elements.length });
        act.items.push({ kind: 'loopstart', first: X.n, last: X.n, start: X.start, next: X.next });
        continue;
      }
      const ip = [['interpolate offset', 'offset'], ['interpolate scale', 'scale'], ['interpolate angle', 'angle'], ['interpolate blend', 'blend']]
        .find(([pre]) => line.startsWith(pre)); // anim.go:345-352
      if (ip) {
        act.interpolate.push({ kind: ip[1], line: X.n, start: X.start, next: X.next, at: act.elements.length });
        act.items.push({ kind: 'interpolate', first: X.n, last: X.n, start: X.start, next: X.next });
        continue;
      }
      if (line.length >= 5 && line.slice(0, 4) === 'clsn') { // anim.go:353-425
        const ii = line.indexOf(':');
        if (ii < 0) { act.items.push({ kind: 'other', first: X.n, last: X.n, start: X.start, next: X.next }); continue; }
        const size = atoi(line.slice(ii + 1));
        const which = line[4] === '1' ? 1 : line[4] === '2' ? 2 : 0;
        if (size < 0 || !which) { act.items.push({ kind: 'other', first: X.n, last: X.n, start: X.start, next: X.next }); continue; }
        const isDefault = line.length >= 12 && line.slice(5, 12) === 'default';
        const [cs, ce] = trimSpan(text, X.cs + ii + 1, X.ce);
        const B = {
          index: act.clsn.length, which, isDefault, line: X.n, lineStart: X.start, lineNext: X.next, hasNl: X.hasNl,
          headerRaw: text.slice(X.cs, X.ce), indent: text.slice(X.start, X.ts),
          count: size, countRaw: text.slice(cs, ce), countStart: cs, countEnd: ce,
          boxes: [], short: false, rangeNext: X.next, rangeLast: X.n, boundTo: [], rects: [],
        };
        act.clsn.push(B);
        if (which === 1) { clsn1 = B.index; if (isDefault) clsn1d = B.index; def1 = false; }
        else { clsn2 = B.index; if (isDefault) clsn2d = B.index; def2 = false; }
        if (size > 0) {
          i++;
          let n = 0;
          while (n < size && i < L.length) {
            const Y = L[i];
            const bl = Y.lc;
            if (!bl.length) { i++; continue; } // anim.go:393-396
            if (bl.length < 4 || bl.slice(0, 4) !== 'clsn') break;
            const eq = bl.indexOf('=');
            if (eq < 0) break;
            // strings.Split(line[ii+1:], ","): every comma, not SplitN.
            const pieces = [];
            let p = Y.cs + eq + 1;
            for (;;) {
              const c = text.indexOf(',', p);
              if (c < 0 || c >= Y.ce) { pieces.push([p, Y.ce]); break; }
              pieces.push([p, c]); p = c + 1;
            }
            if (pieces.length < 4) break; // anim.go:407-409
            const coords = pieces.slice(0, 4).map(([s0, e0]) => {
              const [s, e] = trimSpan(text, s0, e0);
              const raw = text.slice(s, e);
              return { raw, start: s, end: e, value: atoi(raw), plain: /^[+-]?\d+$/.test(raw) };
            });
            let [l, t, r, b] = coords.map((c) => c.value);
            if (l > r) [l, r] = [r, l]; // anim.go:411-417 normalize
            if (t > b) [t, b] = [b, t];
            const im = /\[\s*([^\]]*?)\s*\]/.exec(text.slice(Y.cs, Y.cs + eq));
            B.boxes.push({
              line: Y.n, lineStart: Y.start, lineNext: Y.next, hasNl: Y.hasNl, raw: text.slice(Y.cs, Y.ce),
              indent: text.slice(Y.start, Y.ts), indexRaw: im ? im[1] : null,
              indexStart: im ? Y.cs + im.index + im[0].indexOf(im[1], 1) : null,
              coords, rect: [l, t, r, b],
            });
            B.rangeNext = Y.next; B.rangeLast = Y.n;
            act.bodyTo = Y.next;
            n++; i++;
          }
          i--; // anim.go:423-424
        }
        // The engine's array is `size` long whatever was read; unread slots
        // stay [0,0,0,0] (anim.go:363-366 make + partial fill).
        B.short = B.boxes.length < size;
        B.rects = B.boxes.map((x) => x.rect);
        for (let k = B.boxes.length; k < size && k < B.boxes.length + 256; k++) B.rects.push([0, 0, 0, 0]);
        act.items.push({ kind: 'clsn', first: B.line, last: B.rangeLast, start: B.lineStart, next: B.rangeNext, ref: B.index });
        continue;
      }
      act.items.push({ kind: line.length ? 'other' : 'blank', first: X.n, last: X.n, start: X.start, next: X.next });
    }
    // anim.go:428-430
    if (act.loopstart >= act.elements.length) {
      if (act.loopstartLines.length) act.loopstartFallback = act.loopstart !== ols;
      act.loopstart = ols;
    }
    // WHAT THE ENGINE SHOWS, from its own timeline (airTimeline: Action,
    // UpdateSprite, animSeek over ReadAnimation's totals, anim.go:428-452,
    // 638-721, 802-846) with this action's Loopstart - not a rule per element.
    // An element is shown when some tick draws it with a sprite loaded; it
    // holds when the engine stops on it. A time 0 element can be drawn (one
    // the raw times sum to -1 holds, wearing an earlier sprite); a negative
    // one can be drawn (tick 1 of an action whose totaltime is not positive);
    // an element after a middle -1 or cut by a last -2 can be skipped whatever
    // its time. totalTicks is the engine's totaltime, -1 when it holds.
    const times = act.elements.map((el) => el.values.time);
    const tl = airTimeline(times, act.loopstart);
    const shown = new Set(tl.runs.filter((r) => r.spr >= 0).map((r) => r.elem));
    const holdAt = tl.hold && tl.runs.length ? tl.runs[tl.runs.length - 1].elem : -1;
    act.elements.forEach((el, k) => {
      el.holdsForever = k === holdAt;
      el.neverDisplayed = !shown.has(k);
    });
    act.totalTicks = !act.elements.length ? 0 : tl.hold ? -1 : airTotals(times, act.loopstart).totaltime;
    act.holdsOn = holdAt >= 0 ? holdAt + 1 : null;
    return { no, act };
  };

  // AnimationTable.readAction (anim.go:1194-1233), recursion included.
  const readAction = () => {
    while (i < L.length) {
      const r = readOne();
      if (r) {
        const existing = tbl.get(r.no);
        if (existing) {
          duplicates.push({ no: r.no, line: r.act.header.line, firstLine: actions[existing.def].header.line });
          r.act.duplicateOf = existing.def;
          return existing;
        }
        const e = { def: r.act.index, frames: r.act.index, copyAction: r.act.copy ? r.act.copy.target : -1, src: r.no, emptyCopyOf: undefined };
        r.act.live = true;
        byNo.set(r.no, r.act.index);
        // `len(a.frames) == 0 && a.copyAction < 0` (anim.go:1210-1222): a Copy
        // Action whose number does not parse (`Copy Action abc` -> -1,
        // anim.go:309-318) or is negative leaves the action empty, and it takes
        // the next action's frames like any empty one.
        if (e.copyAction < 0 && r.act.elements.length === 0) {
          while (i < L.length) {
            const a2 = readAction();
            if (a2) { e.frames = a2.frames; e.copyAction = a2.copyAction; e.src = a2.src; e.emptyCopyOf = actions[a2.def].no; break; }
            i++;
          }
        }
        e.written = e.copyAction;
        tbl.set(r.no, e);
        return e;
      }
      i++;
    }
    return null;
  };
  while (readAction()) { /* every action in the file */ }

  // resolveCopyAction (anim.go:1261-1297), file-local. A target that is not in
  // this file may still be a common animation merged in at match time
  // (char.go:4310-4336), so it is reported unresolved, not deleted.
  const table = new Map();
  for (const [no, e] of tbl) {
    for (let loops = 0; e.copyAction >= 0 && loops < 8; loops++) {
      const target = tbl.get(e.copyAction);
      if (!target || target === e) break;
      if (target.copyAction >= 0) { e.copyAction = target.copyAction; continue; }
      e.frames = target.frames; e.src = target.src; e.copyAction = -1;
      break;
    }
    const out = { def: e.def, source: e.copyAction >= 0 ? null : e.src, framesOf: e.copyAction >= 0 ? null : e.frames };
    if (e.written >= 0) out.copyOf = e.written;
    if (e.emptyCopyOf !== undefined) out.emptyCopyOf = e.emptyCopyOf;
    if (e.copyAction >= 0) out.unresolved = e.written;
    table.set(no, out);
  }
  return { bom, lineCount: L.length, actions, byNo, duplicates, table };
}

// ---------------------------------------------------------------------------
// Plans parse the same text again and again (the file, then each candidate
// result, then both again in validateAir). A two-entry cache keyed on the
// string itself keeps that to one parse per distinct text. Models handed out
// by parseAirSpans are never cached, so a caller may mutate those freely.
const modelCache = [];
function readModel(text) {
  const s = String(text == null ? '' : text);
  for (const c of modelCache) if (c.text === s) return c.model;
  const model = parseAirSpans(s);
  modelCache.unshift({ text: s, model });
  if (modelCache.length > 2) modelCache.pop();
  return model;
}

// ---------------------------------------------------------------------------
// Serializable view of one action (Maps do not survive JSON).

function describeAction(model, no) {
  const idx = model.byNo.get(Number(no));
  if (idx === undefined) return null;
  const act = model.actions[idx];
  const t = model.table.get(act.no) || {};
  return {
    ...act,
    table: { source: t.source, copyOf: t.copyOf, emptyCopyOf: t.emptyCopyOf, unresolved: t.unresolved },
    duplicates: model.duplicates.filter((d) => d.no === act.no),
    aliases: aliasesOf(model, act.no),
  };
}

// Other action numbers whose frames ARE this action's (an empty action before
// it, or a Copy Action chain ending here). Editing this action edits them too.
function aliasesOf(model, no) {
  const out = [];
  for (const [n, t] of model.table) if (n !== no && t.source === no) out.push(n);
  return out;
}

// ---------------------------------------------------------------------------
// Small shared pieces for every plan.

function liveAction(model, no) {
  const n = Number(no);
  const idx = Number.isInteger(n) ? model.byNo.get(n) : undefined;
  if (idx === undefined) return { error: 'this file defines no action ' + no };
  const act = model.actions[idx];
  if (act.copy && act.copy.target >= 0) return { error: `action ${n} is "Copy Action ${act.copy.target}": it has no frames of its own to edit` };
  if (!act.elements.length) {
    const t = model.table.get(n);
    return { error: `action ${n} has no frames of its own - the engine plays action ${t && t.emptyCopyOf} in its place (anim.go:1210-1222)` };
  }
  return { act };
}

function elementOf(act, elem) {
  const k = Number(elem);
  if (!Number.isInteger(k) || k < 1 || k > act.elements.length) return null;
  return act.elements[k - 1];
}

function parseIntStrict(v) {
  if (typeof v === 'number') return Number.isInteger(v) && Math.abs(v) <= 2147483647 ? (v || 0) : null;
  const s = String(v == null ? '' : v).trim();
  if (!/^[+-]?\d+$/.test(s)) return null;
  const n = Number(s);
  return Math.abs(n) <= 2147483647 ? (n || 0) : null;
}

// A float the user typed, kept in the user's own style (`.5` stays `.5`).
function parseFloatStrict(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? { n: v, text: String(v) } : null;
  const s = String(v == null ? '' : v).trim();
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(s)) return null;
  return { n: Number(s), text: s.replace(/^\+/, '') };
}

const rectsEq = (a, b) => JSON.stringify(a || []) === JSON.stringify(b || []);
const normRect = (r) => [Math.min(r[0], r[2]), Math.min(r[1], r[3]), Math.max(r[0], r[2]), Math.max(r[1], r[3])];
const fieldRaws = (el) => FIELD_NAMES.map((nm) => (el.fields[nm].present ? el.fields[nm].raw : null));

function nlOf(text, act) {
  const h = text.slice(act.header.start, act.header.next);
  if (h.endsWith('\r\n')) return '\r\n';
  if (h.endsWith('\n')) return '\n';
  return text.includes('\r\n') ? '\r\n' : '\n';
}

// House style for generated blocks: copied from the action's first box, so a
// materialized block reads like the author's own.
function styleOf(act) {
  const b = act.clsn.find((x) => x.boxes.length);
  return { headerIndent: b ? b.indent : '', boxIndent: b ? b.boxes[0].indent : ' ' };
}

function blockText(which, rects, nl, style) {
  let s = `${style.headerIndent}Clsn${which}: ${rects.length}${nl}`;
  rects.forEach((r, k) => { s += `${style.boxIndent}Clsn${which}[${k}] = ${r.join(', ')}${nl}`; });
  return s;
}

// Sort, then fuse splices that touch, so a deletion ending where an insertion
// starts cannot trip charedit's overlap check. Zero-width inserts at one point
// keep the order the plan pushed them in (Array.prototype.sort is stable).
function mergeSplices(list) {
  const s = list.map((x, k) => ({ ...x, k })).sort((a, b) => a.start - b.start || a.end - b.end || a.k - b.k);
  const out = [];
  for (const x of s) {
    const last = out[out.length - 1];
    if (last && x.start < last.end) throw new Error('internal: overlapping plan ranges');
    if (last && x.start === last.end) { last.end = x.end; last.text += x.text; continue; }
    out.push({ start: x.start, end: x.end, text: x.text });
  }
  return out;
}

// Loopstart as the engine will see it after an op. No Loopstart line, or one
// that sits before the first element, means "loop from the start" and stays 0.
// Otherwise the loop stays attached before the SAME element.
function expectedLoop(act, mapOldIndex) {
  if (!act.loopstartLines.length || act.loopstart === 0) return 0;
  return mapOldIndex(act.loopstart);
}

// Where "before the first element" is: after the header, but after a
// Loopstart line that sits there too, so the loop keeps meaning "from the start".
function frontPos(act) {
  let pos = act.header.next, lead = !act.header.hasNl;
  for (const l of act.loopstartLines) if (l.at === 0) { pos = l.next; lead = false; }
  return { pos, lead };
}

// Items between the previous frame line and this element's frame line.
function preludeOf(act, el) {
  const k = act.items.findIndex((it) => it.kind === 'frame' && it.ref === el.ordinal);
  const out = [];
  for (let j = k - 1; j >= 0 && act.items[j].kind !== 'frame'; j--) out.unshift(act.items[j]);
  return out;
}

// ---------------------------------------------------------------------------
// VALUE EDITS

// planElementEdit(text, { action, elem, field, value })
//   -> { splices, noop, before, after, filled, warnings, expected } | { error }
function planElementEdit(text, req) {
  const r = req || {};
  const model = readModel(text);
  const got = liveAction(model, r.action);
  if (got.error) return got;
  const act = got.act;
  const el = elementOf(act, r.elem);
  if (!el) return { error: `action ${act.no} has no element ${r.elem} (it has ${act.elements.length})` };
  const field = String(r.field || '').toLowerCase();
  const idx = FIELD_NAMES.indexOf(field);
  if (idx < 0) return { error: 'unknown field ' + r.field };
  const F = el.fields[field];
  const warnings = [];
  let newText, same;
  // Sending back exactly what the field already says is never an edit, and
  // never an error - even when the author's text is something this editor
  // would not write (a blend of `A2` or `ADD`, a sprite number of `Z1`: the
  // engine reads those its own way, anim.go:66, 146-196).
  const asText = r.value === null || r.value === undefined ? '' : String(r.value).trim();
  if ((F.present && asText === F.raw) || (!F.present && asText === '')) {
    return { action: act.no, elem: el.ordinal, field, line: el.line, before: F.present ? F.raw : null, after: F.present ? F.raw : '', warnings, splices: [], noop: true, expected: null };
  }

  switch (field) {
    case 'time': {
      const n = parseIntStrict(r.value);
      // -1 = hold forever; nothing below it means anything (anim.go:432-452).
      if (n === null || n < -1) return { error: 'time must be a whole number, -1 or more' };
      newText = String(n); same = atoi(F.raw) === n;
      if (n === 0) warnings.push('time 0: the element is never displayed, but it still takes an AnimElem number (anim.go:507-520, 643-652)');
      if (n === -1 && el.ordinal !== act.elements.length) warnings.push('time -1 on an element that is not the last: the engine skips it like time 0 (anim.go:812-823)');
      break;
    }
    case 'group': case 'number': {
      const n = parseIntStrict(r.value);
      // -1 in EITHER field is the deliberate "no sprite": the engine only
      // nulls -1, every other negative wraps to a uint16 sprite key
      // (anim.go:699-716). So -1 is allowed for both, other negatives are not.
      if (n === null || n < -1 || n > 65535) return { error: field + ' must be a whole number from -1 (no sprite) to 65535' };
      newText = String(n); same = atoi(F.raw) === n;
      break;
    }
    case 'x': case 'y': {
      const n = parseIntStrict(r.value);
      if (n === null) return { error: field + ' must be a whole number (the engine reads it with Atoi, anim.go:66-67)' };
      newText = String(n); same = atoi(F.raw) === n;
      break;
    }
    case 'flip': {
      const s = String(r.value == null ? '' : r.value).trim().toUpperCase();
      if (!['', 'H', 'V', 'HV', 'VH'].includes(s)) return { error: 'flip must be empty, H, V or HV' };
      newText = s === 'VH' ? 'HV' : s;
      // What the engine sees (anim.go:93-99, 950-1024): any H mirrors, and
      // where the axis lands follows the COUNT of H - no flag or `H` at x = 10
      // draws at +10, `HH` at -10 (xDraw). The same for V and y. The value
      // written has at most one of each, so it is the parity that is compared.
      {
        const V = el.values;
        const hN = s.includes('H') ? 1 : 0, vN = s.includes('V') ? 1 : 0;
        same = V.h === (hN === 1) && V.v === (vN === 1)
          && V.x * (V.hCount % 2 ? -1 : 1) === V.x * (hN ? -1 : 1)
          && V.y * (V.vCount % 2 ? -1 : 1) === V.y * (vN ? -1 : 1);
      }
      break;
    }
    case 'blend': {
      const s = String(r.value == null ? '' : r.value).trim().toUpperCase();
      const m = /^AS(\d{1,3})D(\d{1,3})$/.exec(s);
      if (!(['', 'A', 'A1', 'S'].includes(s) || (m && +m[1] <= 255 && +m[2] <= 255))) {
        return { error: 'blend must be empty, A, A1, S or AS<src>D<dst> with both 0-255' };
      }
      newText = s; same = lowerAscii(s) === el.values.blend;
      break;
    }
    case 'xscale': case 'yscale': {
      const f = parseFloatStrict(r.value);
      if (!f || !(f.n > 0)) return { error: field + ' must be a number greater than 0' };
      newText = f.text;
      // Compared as the engine stores both: float32(Atof(text)) (anim.go:201-213),
      // so `1e2` is 100, not 1.
      same = F.present && !F.blank ? (isNumeric(F.raw) && Math.fround(atof(F.raw)) === Math.fround(atof(newText))) : (!F.present && Math.fround(atof(newText)) === 1);
      warnings.push('fields 8-10 are read by Ikemen GO and MUGEN 1.1 only; older MUGEN ignores them');
      break;
    }
    case 'angle': {
      const f = parseFloatStrict(r.value);
      if (!f) return { error: 'angle must be a number' };
      newText = f.text;
      same = F.present && !F.blank ? (isNumeric(F.raw) && Math.fround(atof(F.raw)) === Math.fround(atof(newText))) : (!F.present && Math.fround(atof(newText)) === 0);
      warnings.push('fields 8-10 are read by Ikemen GO and MUGEN 1.1 only; older MUGEN ignores them');
      break;
    }
    default: break;
  }
  if (el.flipHoldsBlend && (field === 'flip' || field === 'blend')) {
    return { error: 'this element writes its transparency in the flip field (the WinMugen "...,5,A" form, anim.go:74-92); edit that line by hand' };
  }
  const expected = { action: act.no, elem: el.ordinal, field, after: newText, filled: [] };
  const base = { action: act.no, elem: el.ordinal, field, line: el.line, before: F.present ? F.raw : null, after: newText, warnings, expected };
  if (same) return { ...base, splices: [], noop: true };

  const splices = [];
  const filled = [];
  if (newText === '') {
    // Clearing flip or blend. In the middle of the line the slot stays (the
    // fields are positional); as the last field it goes with its comma, along
    // with any blank flip/blend before it - never leaving trailing blanks.
    const later = FIELD_NAMES.slice(idx + 1).some((nm) => el.fields[nm].present);
    if (later) splices.push({ start: F.start, end: F.end, text: '' });
    else {
      let j = idx - 1;
      while (j >= 5 && el.fields[FIELD_NAMES[j]].blank) j--;
      const prev = el.fields[FIELD_NAMES[j]];
      splices.push({ start: prev.blank ? prev.pieceEnd : prev.end, end: F.end, text: '' });
    }
  } else if (F.present) {
    if (F.blank && idx >= 7 && idx <= 8) warnings.push(`this ${field} was blank: 0 in MUGEN 1.1, "no change" in Ikemen (anim.go:198-201) - now explicit`);
    splices.push({ start: F.start, end: F.end, text: newText });
  } else {
    // A missing field: commas up to it and nothing after. A skipped flip or
    // blend may be blank (blank = none there), but a skipped xscale/yscale is
    // written as an explicit 1 - blank would be 0 in MUGEN 1.1.
    let ins = '';
    for (let k = el.fieldCount; k <= idx; k++) {
      if (k === idx) ins += ', ' + newText;
      else if (k === 7 || k === 8) { ins += ', 1'; filled.push(FIELD_NAMES[k]); }
      else ins += ',';
    }
    splices.push({ start: el.end, end: el.end, text: ins });
  }
  expected.filled = filled;
  return { ...base, splices, noop: false, filled };
}

// planClsnEdit(text, { action, elem, which, box, coords: [x1,y1,x2,y2], scope })
//   -> { splices, affects, scope, before, after, expected } | { error, affects?, needsScope? }
function planClsnEdit(text, req) {
  const r = req || {};
  const model = readModel(text);
  const got = liveAction(model, r.action);
  if (got.error) return got;
  const act = got.act;
  const el = elementOf(act, r.elem);
  if (!el) return { error: `action ${act.no} has no element ${r.elem}` };
  const which = Number(r.which);
  if (which !== 1 && which !== 2) return { error: 'which must be 1 or 2' };
  const coords = Array.isArray(r.coords) && r.coords.length === 4 ? r.coords.map(parseIntStrict) : null;
  // The engine reads box coordinates with Atoi (anim.go:410): a fraction would
  // be silently truncated, so only whole numbers are offered.
  if (!coords || coords.some((c) => c === null)) return { error: 'coords must be four whole numbers x1, y1, x2, y2' };
  const c = el['clsn' + which];
  if (c.source === 'none') return { error: which === 1 ? `element ${el.ordinal} has no Clsn1 - add a box instead` : `element ${el.ordinal} has no Clsn2 - add a box instead` };
  const B = act.clsn[c.block];
  const box = Number(r.box);
  if (!Number.isInteger(box) || box < 0 || box >= c.rects.length) return { error: which === 1 ? `element ${el.ordinal} has no Clsn1 box ${r.box}` : `element ${el.ordinal} has no Clsn2 box ${r.box}` };
  if (box >= B.boxes.length) {
    return { error: which === 1 ? `Clsn1 box ${box} is counted by "${B.headerRaw}" but has no line - the engine uses [0,0,0,0]; fix the block by hand`
      : `Clsn2 box ${box} is counted by "${B.headerRaw}" but has no line - the engine uses [0,0,0,0]; fix the block by hand` };
  }
  const affects = B.boundTo.slice();
  const scope = B.isDefault ? 'default' : 'own';
  if (B.isDefault && r.scope !== 'default') {
    return {
      error: `this box comes from "${B.headerRaw}" (line ${B.line}), which elements ${affects.join(', ')} all use - confirm with scope 'default'`,
      needsScope: 'default', affects, scope,
    };
  }
  const bx = B.boxes[box];
  const after = normRect(coords);
  const elementsExp = act.elements.map((e) => {
    const x = { clsn1: e.clsn1.rects, clsn2: e.clsn2.rects, fields: fieldRaws(e) };
    if (affects.includes(e.ordinal)) {
      const rs = e['clsn' + which].rects.map((q, k) => (k === box ? after : q));
      x['clsn' + which] = rs;
    }
    return x;
  });
  const expected = { action: act.no, delta: 0, elements: elementsExp, loopstart: act.loopstart, interpolate: act.interpolate.map((x) => [x.kind, x.at]) };
  const base = { action: act.no, elem: el.ordinal, which, box, scope, affects, block: { line: B.line, header: B.headerRaw }, before: bx.rect, after, expected };
  if (rectsEq(bx.rect, after)) return { ...base, splices: [], noop: true };
  // The engine normalizes every box (anim.go:411-417), so orientation is not
  // data - but it is the author's text. Write the new box in the orientation
  // the line already has and touch only the numbers whose value changes.
  const fx = bx.coords[0].value > bx.coords[2].value, fy = bx.coords[1].value > bx.coords[3].value;
  const written = [fx ? after[2] : after[0], fy ? after[3] : after[1], fx ? after[0] : after[2], fy ? after[1] : after[3]];
  const splices = [];
  bx.coords.forEach((q, k) => { if (!(q.plain && q.value === written[k])) splices.push({ start: q.start, end: q.end, text: String(written[k]) }); });
  return { ...base, written, splices, noop: false };
}

// ---------------------------------------------------------------------------
// TRIGGERS - reading AnimElem / AnimElemTime out of a state's trigger text.
//
// `AnimElem = N` is sugar for AnimElemTime(N) = 0 and N must be a literal
// integer (compiler.go:3999-4019, parseOldAnimElemStyle compiler.go:1254-1269);
// AnimElemTime's argument is a full expression (compiler.go:1822-1826). Only
// literals are renumberable. AnimElemNo compares element NUMBERS the engine
// computes, so it is reported, never rewritten.
// WHAT FOLLOWS THE WORD AnimElem is read the compiler's way. checkEquality
// (compiler.go:909-929) takes tokens until one ends in `=` - with
// ignoreMostErrors every other token is skipped, not refused - and
// parseOldAnimElemStyle reads the integer token after it (integer2,
// compiler.go:676-694). So `AnimElem >= 3`, `AnimElem != 3`, `AnimElem > = 3`
// and `AnimElem(0) = 3` all compile as AnimElem = 3.
//
// A REDIRECTED ATOM (`helper(1), AnimElem = 2`) reads the animation of the
// player the redirection names (compiler.go:1427-1590 compiles the rest of the
// value under OC_parent / OC_root / ..., bytecode.go:1939-2026 runs it with c =
// that player, and animElemTime reads c.anim, char.go:5256-5261). Whose
// animation table that is decides what an .air edit does to it (`own` below):
//   parent, root, helper, helperindex   this character or one of its helpers:
//       helpers share the root's player number, and changeAnim plays from
//       c.playerNo's table by default (char.go:4705-4707) - THIS .air;
//   stateowner   this character's root for code in its positive states and
//       in -1 and -3 (stateOwner reads c.ss.sb.playerNo, char.go:4902-4905,
//       and those run only when that is this player's number, char.go:12069,
//       12084). A -2 or -4 also runs while this character sits in another
//       player's custom state (char.go:12075-12080), where stateowner is that
//       player's root, so there the caller treats it like the next group;
//   playerid, player, playerindex   ANY player the number names (char.go:
//       5156-5183: charList.idMap, runOrder, getCharRoot), this character or
//       another one. Nothing in the files says which, so these are never
//       renumbered: a same-player guard that names the action makes them
//       blocking (`any`), and otherwise they are warnings;
//   p2, enemy, enemynear, target, partner   another player.
// The own-table ones are decided by the caller (which states can be playing
// the action); the rest are left as written and listed as warnings.

// The redirections of expValue (compiler.go:1427-1590): root, parent, p2 and
// stateowner take no argument; the rest take one or two, each a full
// expression, so their parentheses can nest to any depth.
const REDIRECTS = new Set(['parent', 'root', 'helper', 'target', 'partner', 'enemy', 'enemynear', 'playerid', 'player', 'playerindex', 'p2', 'stateowner', 'helperindex']);
const OWN_TABLE_REDIRECTS = new Set(['parent', 'root', 'helper', 'helperindex', 'stateowner']);
const ANY_PLAYER_REDIRECTS = new Set(['playerid', 'player', 'playerindex']);
// -> { name, key, own } | null. `key` is the redirection as written, spaces
// removed and lowercased (`helper(7910)`), so two atoms of one line can be
// matched to the same player.
function redirectAt(body, at) {
  let p = at - 1;
  const ws = () => { while (p >= 0 && /\s/.test(body[p])) p--; };
  ws();
  if (body[p] !== ',') return null;
  const comma = p;
  p--; ws();
  if (body[p] === ')') {
    let depth = 0;
    for (; p >= 0; p--) {
      if (body[p] === ')') depth++;
      else if (body[p] === '(' && --depth === 0) break;
    }
    if (p < 0) return null;
    p--; ws();
  }
  const end = p + 1;
  while (p >= 0 && /[a-z0-9_]/i.test(body[p])) p--;
  const name = body.slice(p + 1, end).toLowerCase();
  if (!REDIRECTS.has(name)) return null;
  return { name, key: body.slice(p + 1, comma).replace(/\s+/g, '').toLowerCase(), own: OWN_TABLE_REDIRECTS.has(name), any: ANY_PLAYER_REDIRECTS.has(name) };
}

// scanTrigger(text, from?) - every AnimElem / AnimElemTime / AnimElemNo atom
// of an expression, from offset `from` (default 0) to the first `;`.
function scanTrigger(textIn, fromIn) {
  const text = String(textIn == null ? '' : textIn);
  const semi = text.indexOf(';');
  const body = semi >= 0 ? text.slice(0, semi) : text;
  const from = Math.max(0, fromIn | 0);
  const atoms = [];
  const push = (a) => {
    const r = redirectAt(body, a.at);
    if (r) {
      a.redirected = true; a.redirect = r; a.blocking = false;
      a.why = r.own
        ? 'redirected to ' + r.key + ': it reads the animation that player is playing, which comes from this character\'s .air but not necessarily this action - left as written'
        : r.any
          ? 'redirected to ' + r.key + ': the number can name this character or another player, and the files do not say which - left as written'
          : 'redirected: it reads another player\'s animation, not this action - left as written';
    }
    atoms.push(a);
  };
  const scan = (re, fn) => { re.lastIndex = from; let m; while ((m = re.exec(body))) fn(m); };
  scan(/\banimelemtime\b/gi, (m) => {
    let p = m.index + m[0].length;
    while (/\s/.test(body[p] || '')) p++;
    if (body[p] !== '(') { push({ kind: 'animelemtime', at: m.index, blocking: true, why: 'AnimElemTime without an argument' }); return; }
    let depth = 0, q = p;
    for (; q < body.length; q++) { if (body[q] === '(') depth++; else if (body[q] === ')' && --depth === 0) break; }
    const arg = body.slice(p + 1, q);
    const lit = /^(\s*)(\d+)\s*$/.exec(arg);
    if (lit) push({ kind: 'animelemtime', at: m.index, elem: Number(lit[2]), numStart: p + 1 + lit[1].length, numEnd: p + 1 + lit[1].length + lit[2].length });
    else push({ kind: 'animelemtime', at: m.index, blocking: true, why: 'AnimElemTime(' + arg.trim() + ') is not a literal element number', argStart: p + 1, argEnd: q });
  });
  scan(/\banimelem\b/gi, (m) => {
    // checkEquality, then integer2 (compiler.go:909-929, 1254-1269, 676-694).
    const tokens = S.tokensGo(body, m.index + m[0].length);
    let op = null, skipped = 0;
    for (let t = tokens.next(); !t.done; t = tokens.next()) {
      const k = t.value.tok;
      if (k === '!=' || k === '=' || k[k.length - 1] === '=') { op = t.value; break; }
      skipped++;
    }
    const num = op ? tokens.next().value : null;
    if (!op || !num || num.tok === '-' || !/^[0-9]+$/.test(num.tok)) {
      push({ kind: 'animelem', at: m.index, blocking: true, why: 'AnimElem is not followed by a whole element number (the compiler refuses it, compiler.go:1254-1269)' });
      return;
    }
    const a = { kind: 'animelem', at: m.index, elem: atoi(num.tok), numStart: num.start, numEnd: num.end };
    if (skipped) a.note = '`' + body.slice(m.index, num.end) + '` compiles as AnimElem = ' + a.elem + ': the compiler skips every token before the first one ending in `=` (compiler.go:909-929)';
    push(a);
  });
  scan(/\banimelemno\b/gi, (m) => push({ kind: 'animelemno', at: m.index, blocking: true, why: 'AnimElemNo compares element numbers the engine computes; check it by hand' }));
  return atoms.sort((a, b) => a.at - b.at);
}

// scanLine(line) - the atoms of one parameter LINE, the way parseSection reads
// it (compiler.go:5943-5982): only the value after the first top-level `=` is
// compiled, and only for a name the compiler uses. A name that is not a trigger
// (triggerall, or 1-65536 without a leading zero: parseTriggerNumber
// 5828-5845) and is neither a plain word nor a var()-style special name is
// stored and ignored (6015, 6036-6053) - so `|AnimElem = 10 || AnimElem = 11`
// reads nothing, and `trigger1 - animelem = 2` is trigger1 = 2. A special name
// is compiled as a whole (its index is an expression), so it is scanned too.
// Offsets are in `line`. -> { name, value, valueStart, compiled, atoms }
function scanLine(lineIn) {
  const line = String(lineIn == null ? '' : lineIn);
  const semi = line.indexOf(';');
  const cut = semi >= 0 ? line.slice(0, semi) : line;
  const lead = S.goWsLead(cut, 0);
  const kv = S.paramLine(S.trimGo(cut));
  if (!kv) return { name: null, value: null, valueStart: null, compiled: false, atoms: [] };
  const special = /^(var|fvar|sysvar|sysfvar|map)\(/.test(kv.name);
  const trig = /^trigger/.test(kv.name);
  const compiled = trig ? !!S.parseTriggerName(kv.name) : (special || /^[a-z0-9_.]+$/.test(kv.name));
  const eqAt = lead + kv.eq;
  const valueStart = eqAt + 1 + S.goWsLead(cut, eqAt + 1);
  if (!compiled) return { name: kv.name, value: kv.value, valueStart, compiled: false, atoms: [] };
  return { name: kv.name, value: kv.value, valueStart, compiled: true, atoms: scanTrigger(cut, special ? lead : eqAt + 1) };
}

// The caller hands in the move model's states (movelib.statesUsingAction).
// Read leniently, so the page keeps working while that model grows:
//   { no|state, file,
//     anim?: { candidates }, changeAnims?: [{ candidates }], anims?: [{ action }],
//     blocks?: [{ ordinal, type, line, file?, triggers: [{ line, text }], firing: [{ kind, elem, offset }] }],
//     animElemTriggers?: [{ file, line, type, form, elem, raw, start, end, expression, text, col, textStart }],
//     triggers?: [ text | { line, text, start? } ],
//     scope?: 'redirect' | 'elem' }
// animElemTriggers covers EVERY controller of the state (a PlaySnd on
// AnimElem = 3 moves with the frame just like a HitDef) and carries the byte
// span of each element number; block triggers add the lines only an attack
// block has. `start` on a plain trigger is the offset of its text's first
// byte. With offsets the plan carries ready splices; without, before/after
// text only. A line that comes from animElemTriggers is read for exactly the
// atoms its refs name (`col`, where the word starts in the text), so a caller
// can hand one atom of a line to one entry and another atom to another.
//   `text` is a whole parameter line (only its compiled value is read,
//   scanLine); `raw` / `value` is an expression on its own.
// SCOPES. A state entry reads the atoms of its own animation (plain atoms)
// unless it says otherwise:
//   scope 'redirect'  only the atoms redirected to a player of this character
//                     (parent, root, helper...): the caller has decided which
//                     of those may be reading the action;
//   scope 'elem'      ChangeAnim / ChangeAnim2 `elem = N` refs (form 'elem'),
//                     each carrying `plays`: 'all' | 'some' | 'none' |
//                     'unknown' - whether the controller's own value names
//                     these frames - and `why` when it cannot be renumbered;
//                     `computed` (text) on an expression elem that is not
//                     relative to the current element: it blocks whenever the
//                     operation moves an element.
const arr = (x) => (Array.isArray(x) ? x : []);
function normStates(states) {
  const out = [];
  for (const s of arr(states)) {
    if (!s || typeof s !== 'object') continue;
    const anims = new Set();
    const add = (x) => {
      if (x === null || x === undefined) return;
      if (typeof x === 'number') { if (Number.isInteger(x)) anims.add(x); return; }
      if (typeof x === 'string') { if (/^\s*-?\d+\s*$/.test(x)) anims.add(Number(x)); return; }
      if (Array.isArray(x)) { x.forEach(add); return; }
      if (typeof x === 'object') {
        add(x.candidates);
        if (typeof x.action === 'number') add(x.action);
        if (typeof x.value === 'number') add(x.value);
      }
    };
    add(s.anim); add(s.anims); add(s.animCandidates); add(s.changeAnims);
    const stateNo = s.no !== undefined ? s.no : s.state;
    const scope = s.scope === 'redirect' || s.scope === 'elem' ? s.scope : 'self';
    const byLine = new Map(); // file|line -> trigger
    const keyOf = (file, line, text) => (line ? `${file}|${line}` : `${file}|?|${text}`);
    // Exact token spans first.
    const groups = new Map();
    for (const r of arr(s.animElemTriggers)) {
      if (!r || typeof r.text !== 'string') continue;
      const k = keyOf(r.file || s.file, r.line, r.text);
      if (!groups.has(k)) groups.set(k, { file: r.file || s.file, line: r.line, text: r.text, type: r.type, refs: [] });
      groups.get(k).refs.push(r);
    }
    for (const [k, g] of groups) {
      if (scope === 'elem') {
        // One `elem = N` line: its atom is the ref itself.
        const r = g.refs[0];
        const st0 = Number.isInteger(r.textStart) ? r.textStart : null;
        // `computed` (a string): an expression elem the caller cannot follow -
        // an atom that blocks whenever the op moves any element.
        const atom = r.expression && typeof r.computed === 'string' ? { kind: 'elem', at: r.col, elem: null, blocking: true, why: r.computed }
          : r.expression || !Number.isInteger(r.elem) || !Number.isInteger(r.start) || st0 === null ? null
            : { kind: 'elem', at: r.col, elem: r.elem, numStart: r.start - st0, numEnd: r.end - st0 };
        byLine.set(k, { text: g.text, line: g.line, file: g.file, start: st0, block: null, type: g.type, atoms: atom ? [atom] : [], elem: r });
        continue;
      }
      // The text's own start offset: given by the model (textStart), or found
      // by pairing the model's literal spans with this scanner's literal atoms.
      let start = null;
      const given = g.refs.find((r) => Number.isInteger(r.textStart));
      if (given) start = given.textStart;
      else {
        const lits = scanLine(g.text).atoms.filter((a) => a.numStart !== undefined);
        const refs = g.refs.filter((r) => !r.expression && Number.isInteger(r.start)).sort((a, b) => a.start - b.start);
        if (lits.length && lits.length === refs.length && lits.every((a, n) => a.elem === refs[n].elem)) {
          const cand = refs[0].start - lits[0].numStart;
          if (lits.every((a, n) => cand + a.numStart === refs[n].start)) start = cand;
        }
      }
      const cols = g.refs.map((r) => r.col);
      const only = cols.every((c) => Number.isInteger(c)) ? new Set(cols) : null;
      byLine.set(k, { text: g.text, line: g.line, file: g.file, start, block: null, type: g.type, only });
    }
    const takeList = (list, owner) => {
      if (scope !== 'self') return;
      for (const t of arr(list)) {
        const o = typeof t === 'string' ? { text: t } : t;
        if (!o) continue;
        const valueOnly = o.text === undefined;
        const txt = o.text !== undefined ? o.text : (o.raw !== undefined ? o.raw : o.value);
        if (typeof txt !== 'string') continue;
        const file = (owner && owner.file) || s.file;
        const k = keyOf(file, o.line, txt);
        const had = byLine.get(k);
        if (had) { if (owner && !had.block) had.block = owner; continue; }
        byLine.set(k, { text: txt, line: o.line, file, start: Number.isInteger(o.start) ? o.start : null, block: owner, valueOnly });
      }
    };
    for (const b of arr(s.blocks)) takeList(b && b.triggers, b);
    for (const b of arr(s.controllers)) takeList(b && b.triggers, b);
    takeList(s.triggers, null);
    out.push({ src: s, file: s.file, state: stateNo, scope, anims: [...anims], triggers: [...byLine.values()], blocks: arr(s.blocks).filter(Boolean), outside: s.outside && typeof s.outside.why === 'string' ? s.outside : null });
  }
  return out;
}

// map(oldOrdinal) -> new ordinal, or null when the element is gone.
// opt: { op, newCount, aliases }
//   newCount  the action's element count after the op: an atom past the old
//             end never fired (char.go:5256-5261) and fires once the count
//             reaches it;
//   aliases   other action numbers that play these frames (aliasesOf): a
//             state on one of them is renumbered like a state on the action.
// A state with `outside: { why }` (one that may be playing the action without
// naming it: a negative state, a state with no anim) is never renumbered:
// every atom that would change is blocking, with that reason.
//   redirectsHandled  the caller hands in scope 'redirect' entries for the
//             atoms redirected to this character's own players, so entries of
//             other scopes skip those atoms instead of warning about them.
function renumberPlan(act, map, states, startsAfter, opt) {
  const o = opt || {};
  const oldN = act.elements.length;
  const newN = Number.isInteger(o.newCount) ? o.newCount : oldN;
  const opName = o.op || 'operation';
  const plays = [act.no, ...arr(o.aliases)];
  const plan = { map: {}, triggers: [], blocking: [], warnings: [] };
  for (let k = 1; k <= oldN; k++) plan.map[k] = map(k);
  // Whether any element number names another frame afterwards.
  const shifts = newN !== oldN || Object.keys(plan.map).some((k) => plan.map[k] !== Number(k));
  for (const st of normStates(states)) {
    const outside = st.outside;
    if (st.scope !== 'elem' && !outside && !st.anims.some((a) => plays.includes(a))) continue;
    const others = st.scope === 'self' ? st.anims.filter((a) => !plays.includes(a)) : [];
    for (const t of st.triggers) {
      let atoms = t.atoms || (t.valueOnly ? scanTrigger(t.text) : scanLine(t.text).atoms);
      if (t.only) atoms = atoms.filter((a) => t.only.has(a.at));
      if (!atoms.length) continue;
      const where = { file: t.file || st.file, state: st.state, block: t.block ? t.block.ordinal : null, type: t.block ? t.block.type : (t.type || null), line: t.line };
      let after = t.text;
      const edits = [];
      let blocked = false;
      // Left as written on an element this op moves past the new end: the
      // reason, with that said after it.
      const pastEnd = (a, why) => (a.elem > newN ? `${why}; left as written it points past the end of action ${act.no} (${newN} elements after this ${opName}) and never fires` : why);
      for (const a of atoms.slice().reverse()) {
        // `elem = N` of a ChangeAnim: the element it jumps to on the action
        // its own value names (bytecode.go:5494-5508, anim.go:605-635); an
        // element past the end restarts at element 1 (char.go:4744-4747).
        if (a.kind === 'elem') {
          const e = t.elem || {};
          if (e.plays === 'none') continue;
          const lead = e.why ? e.why + ': ' : '';
          if (a.blocking) {
            if (!shifts) continue;
            plan.blocking.push({ ...where, text: t.text, why: lead + a.why });
            blocked = true;
            continue;
          }
          if (a.elem < 1) continue;
          if (a.elem > oldN) {
            if (a.elem <= newN) {
              plan.blocking.push({ ...where, text: t.text, why: e.why
                ? `${e.why}: jumps to element ${a.elem}, past the end of action ${act.no} (${oldN} elements), so the engine restarts it at element 1 (char.go:4744-4747); after this ${opName} it has ${newN} and the jump lands on element ${a.elem}`
                : `jumps to element ${a.elem}, past the end of action ${act.no} (${oldN} elements), so the engine restarts it at element 1 (char.go:4744-4747); after this ${opName} it has ${newN} and the jump lands on element ${a.elem}` });
              blocked = true;
            }
            continue;
          }
          const nw = map(a.elem);
          if (nw === null) { plan.blocking.push({ ...where, text: t.text, why: e.why ? `${e.why}: jumps to element ${a.elem}, which this operation removes` : `jumps to element ${a.elem}, which this operation removes` }); blocked = true; continue; }
          if (nw === a.elem) continue;
          if (e.plays !== 'all') { plan.blocking.push({ ...where, text: t.text, why: pastEnd(a, e.why || 'the ChangeAnim value may be another action'), suggested: nw }); blocked = true; continue; }
          after = after.slice(0, a.numStart) + String(nw) + after.slice(a.numEnd);
          edits.push({ kind: a.kind, from: a.elem, to: nw, numStart: a.numStart, numEnd: a.numEnd });
          continue;
        }
        const r = a.redirect;
        if (st.scope === 'redirect') { if (!r || !(r.own || r.any)) continue; }
        else if (r && r.own && o.redirectsHandled) continue;
        else if (a.redirected) { plan.warnings.push({ ...where, text: t.text, why: a.why }); continue; }
        if (a.blocking) { plan.blocking.push({ ...where, text: t.text, why: (outside ? outside.why + ': ' : '') + a.why }); blocked = true; continue; }
        if (a.elem < 1) continue; // Undefined before and after (char.go:5256-5261)
        if (a.elem > oldN) {
          if (a.elem <= newN) {
            plan.blocking.push({ ...where, text: t.text, why: outside
              ? `${outside.why}: never fired - action ${act.no} has ${oldN} elements, so element ${a.elem} is Undefined (char.go:5256-5261); after this ${opName} it has ${newN} and this fires on element ${a.elem}`
              : `never fired - action ${act.no} has ${oldN} elements, so element ${a.elem} is Undefined (char.go:5256-5261); after this ${opName} it has ${newN} and this fires on element ${a.elem}` });
            blocked = true;
          }
          continue; // still past the end: stays never-firing
        }
        const nw = map(a.elem);
        if (nw === null) { plan.blocking.push({ ...where, text: t.text, why: outside ? `${outside.why}: fires on element ${a.elem}, which this operation removes` : `fires on element ${a.elem}, which this operation removes` }); blocked = true; continue; }
        if (nw === a.elem) continue;
        if (outside) {
          plan.blocking.push({ ...where, text: t.text, why: pastEnd(a, outside.why), suggested: nw });
          blocked = true; continue;
        }
        if (others.length) {
          const actions = others.join(', ');
          plan.blocking.push({ ...where, text: t.text, why: pastEnd(a, `this state also plays action ${actions}, where element ${a.elem} is a different frame`), suggested: nw });
          blocked = true; continue;
        }
        after = after.slice(0, a.numStart) + String(nw) + after.slice(a.numEnd);
        edits.push({ kind: a.kind, from: a.elem, to: nw, numStart: a.numStart, numEnd: a.numEnd });
      }
      if (!edits.length) continue;
      const entry = { ...where, before: t.text, after, atoms: edits.reverse(), partial: blocked };
      if (t.start !== null) entry.splices = edits.map((e) => ({ file: where.file, start: t.start + e.numStart, end: t.start + e.numEnd, text: String(e.to) }));
      if (startsAfter) entry.ticks = edits.map((e) => ({ elem: e.to, before: act.elements[e.from - 1].startTick, after: startsAfter[e.to - 1] }));
      plan.triggers.push(entry);
    }
  }
  // One line both blocking (a redirect entry whose guard names the action) and
  // warned about (the same atom seen from a state that plays it) is listed once.
  const blockedAt = new Set(plan.blocking.map((b) => b.file + ':' + b.line));
  plan.warnings = plan.warnings.filter((w) => !blockedAt.has(w.file + ':' + w.line));
  return plan;
}

// timingImpact(text, action, elem, newTime, states)
// Which AnimElem / AnimElemTime-fired blocks move, before -> after. A block's
// firing tick is the start tick of its element (+ the AnimElemTime offset);
// the start tick is the sum of Max(0, time) before it (anim.go:507-520), so a
// duration change moves every trigger on a LATER element and none before it.
function timingImpact(text, action, elem, newTime, states) {
  const model = readModel(text);
  const got = liveAction(model, action);
  if (got.error) return got;
  const act = got.act;
  const el = elementOf(act, elem);
  if (!el) return { error: `action ${act.no} has no element ${elem}` };
  const nt = parseIntStrict(newTime);
  if (nt === null || nt < -1) return { error: 'time must be a whole number, -1 or more' };
  const before = act.elements.map((e) => e.startTick);
  const after = [];
  let t = 0;
  act.elements.forEach((e) => { after.push(t); t += Math.max(0, e.ordinal === el.ordinal ? nt : e.values.time); });
  const impacts = [];
  let unchanged = 0;
  const warnings = [];
  if (nt === 0) warnings.push(`element ${el.ordinal} will never be displayed, but AnimElem = ${el.ordinal} still fires at its tick`);
  const plays = [act.no, ...aliasesOf(model, act.no)];
  for (const st of normStates(states)) {
    if (!st.anims.some((a) => plays.includes(a))) continue;
    for (const b of st.blocks) {
      const fl = Array.isArray(b.firing) ? b.firing : b.firing ? [b.firing] : [];
      for (const f of fl) {
        const N = Number(f.elem);
        if (!Number.isInteger(N) || !['animelem', 'animelemtime', 'conditional'].includes(f.kind)) continue;
        if (N < 1 || N > act.elements.length) continue; // Undefined -> never fires (char.go:5256-5261)
        const off = f.kind === 'animelemtime' ? (Number(f.offset) || 0) : 0;
        const tb = before[N - 1] + off, ta = after[N - 1] + off;
        if (tb === ta) { unchanged++; continue; }
        impacts.push({
          file: st.file, state: st.state, block: b.ordinal, type: b.type, line: b.line, kind: f.kind, elem: N, offset: off,
          before: tb, after: ta, conditional: f.kind === 'conditional' || undefined,
          anims: st.anims.length > 1 ? st.anims : undefined,
        });
      }
    }
  }
  // How long the action runs afterwards, the way the engine counts it.
  const timesAfter = act.elements.map((e) => (e.ordinal === el.ordinal ? nt : e.values.time));
  const totalAfter = airTimeline(timesAfter, act.loopstart).hold ? -1 : airTotals(timesAfter, act.loopstart).totaltime;
  return {
    action: act.no, elem: el.ordinal, oldTime: el.values.time, newTime: nt,
    ticksBefore: before, ticksAfter: after, totalBefore: act.totalTicks, totalAfter,
    impacts, unchanged, warnings,
  };
}

// ---------------------------------------------------------------------------
// STRUCTURAL EDITS
//
// Each op is a builder: given `fix` (element key -> boxes to write as an
// explicit own block right before that element's frame line) it returns
// splices. The runner applies them, re-parses with the engine's rules, and
// wherever a surviving element's Clsn1/Clsn2 differs from what it had, adds a
// fix and builds again. An own block written immediately before a frame line
// is the last header before it, so it binds that frame and no other
// (anim.go:330-342, 353-373) - one round of fixes always settles. Then
// validateAir checks the whole file; anything it rejects is refused.

function runStructural(text, act, op) {
  const fix = new Map();
  for (let pass = 0; pass < 4; pass++) {
    let splices, newText;
    try {
      splices = mergeSplices(op.build(fix));
      newText = charedit.applySplices(text, splices.map((s) => ({ ...s, allowNewline: true })));
    } catch (e) { return { error: e.message }; }
    const nm = readModel(newText);
    const ni = nm.byNo.get(act.no);
    const na = ni === undefined ? null : nm.actions[ni];
    if (!na || na.elements.length !== op.expect.length) {
      return { error: `refused: action ${act.no} would have ${na ? na.elements.length : 0} elements, expected ${op.expect.length}` };
    }
    let added = false;
    na.elements.forEach((e, k) => {
      const ex = op.expect[k];
      for (const w of [1, 2]) {
        if (rectsEq(e['clsn' + w].rects, ex['clsn' + w])) continue;
        const f = fix.get(ex.key) || {};
        if (f[w]) continue; // already materialized and still wrong: validateAir reports it
        f[w] = ex['clsn' + w];
        fix.set(ex.key, f);
        added = true;
      }
    });
    if (added) continue;
    const order = op.expect.map((ex) => ex.from);
    const expected = {
      action: act.no, delta: op.expect.length - act.elements.length,
      elements: op.expect.map((ex) => ({ clsn1: ex.clsn1, clsn2: ex.clsn2, fields: ex.fields })),
      loopstart: op.loopstart,
      interpolate: expectedInterpolate(act, order, op.removedAt),
    };
    const why = validateAir(newText, text, expected);
    if (why) return { error: 'refused: ' + why };
    const materialized = [];
    for (const [key, f] of fix) {
      const ex = op.expect.find((x) => x.key === key);
      for (const w of [1, 2]) if (f[w]) materialized.push({ elem: op.expect.indexOf(ex) + 1, from: ex.from, which: w, boxes: f[w] });
    }
    return {
      splices: splices.map((s) => ({ ...s, allowNewline: true })), expected, materialized, startsAfter: na.elements.map((x) => x.startTick),
      tweens: tweenWarnings(act, order, op.removedAt, op.name, op.loopstart),
    };
  }
  return { error: 'refused: the boxes of every element could not be kept' };
}

// INTERPOLATE LINES after an op. The engine attaches `Interpolate X` to the
// NEXT frame's index (anim.go:345-352), so each line must stay attached to the
// element it was written before, and a line after the last frame stays after
// the last; a deleted element's own lines go with it (removedAt = its 0-based
// index). order: new index -> old ordinal (null for a new element). Listed
// in file order, which is index order.
function expectedInterpolate(act, order, removedAt) {
  const N = act.elements.length;
  return act.interpolate
    .filter((m) => m.at !== removedAt)
    .map((m, k) => ({ v: [m.kind, m.at < N ? order.indexOf(m.at + 1) : order.length], k }))
    .sort((p, q) => p.v[1] - q.v[1] || p.k - q.k)
    .map((x) => x.v);
}

// The tween an Interpolate line makes runs from the frame BEFORE its element
// into its element (nextDrawidx = drawidx + 1, or the loop start after the
// last frame, anim.go:742-767). Kept attached to its element, the line still
// tweens from whatever frame now comes before it - so an insert in front of
// it, or a delete or move of its neighbor, changes the motion. Said plainly.
function tweenWarnings(act, order, removedAt, opName, newLoop) {
  const N = act.elements.length, M = order.length;
  const out = [];
  for (const m of act.interpolate) {
    if (m.at === removedAt || m.at >= N) continue;
    const next = m.at + 1;
    const prev = m.at > 0 ? m.at : (act.loopstart === 0 ? N : undefined);
    const ni = order.indexOf(next);
    const nprev = ni > 0 ? order[ni - 1] : (newLoop === 0 || newLoop === undefined ? order[M - 1] : undefined);
    if (ni < 0 || prev === nprev) continue;
    const kind = m.kind[0].toUpperCase() + m.kind.slice(1);
    const from = nprev === undefined ? 'no frame' : nprev === null ? 'the new element' : `element ${nprev}` + (order.indexOf(nprev) + 1 !== nprev ? ` (now ${order.indexOf(nprev) + 1})` : '');
    out.push(`Interpolate ${kind} (line ${m.line}) tweens ${prev === undefined ? 'from no frame' : 'element ' + prev} into element ${next}; after this ${opName || 'edit'} the tween into it` + (ni + 1 !== next ? ` (now element ${ni + 1})` : '') + ` starts from ${from}, so the motion changes (anim.go:742-767)`);
  }
  return out;
}

function fixText(fix, key, nl, style) {
  const f = fix.get(key);
  if (!f) return '';
  return (f[1] ? blockText(1, f[1], nl, style) : '') + (f[2] ? blockText(2, f[2], nl, style) : '');
}

function pushOldFixes(out, fix, act, nl, style, skip) {
  for (const el of act.elements) {
    const key = 'o' + el.ordinal;
    if (skip && skip.has(el.ordinal)) continue;
    if (fix.has(key)) out.push({ start: el.lineStart, end: el.lineStart, text: fixText(fix, key, nl, style) });
  }
}

const expOf = (el, key) => ({ key: key || 'o' + el.ordinal, from: el.ordinal, clsn1: el.clsn1.rects, clsn2: el.clsn2.rects, fields: fieldRaws(el) });

function aliasWarning(model, act) {
  const al = aliasesOf(model, act.no);
  return al.length ? [`actions ${al.join(', ')} play this action's frames (empty action or Copy Action) and change with it`] : [];
}

// The renumber plan of a structural op, and the plan's warnings: aliases, tweens
// that change, and redirected triggers left as written. The aliases play the
// same frames, so states on them are renumbered with the action.
function renumberAndWarnings(model, act, map, states, res, opt) {
  const renumber = renumberPlan(act, map, states, res.startsAfter, Object.assign({ aliases: aliasesOf(model, act.no) }, opt));
  const warnings = aliasWarning(model, act).concat(res.tweens || [],
    renumber.warnings.map((w) => `${w.file}:${w.line} state ${w.state}: ${w.text} - ${w.why}`));
  return { renumber, warnings };
}

// planInsertElement(text, { action, after, copyOf, states })
function planInsertElement(text, req) {
  const r = req || {};
  const model = readModel(text);
  const got = liveAction(model, r.action);
  if (got.error) return got;
  const act = got.act;
  const N = act.elements.length;
  const after = parseIntStrict(r.after);
  if (after === null || after < 0 || after > N) return { error: `after must be 0-${N}` };
  const copyOf = r.copyOf === undefined || r.copyOf === null ? (after || 1) : parseIntStrict(r.copyOf);
  const src = copyOf === null ? null : elementOf(act, copyOf);
  if (!src) return { error: `copyOf must be 1-${N}` };
  const nl = nlOf(text, act), style = styleOf(act);
  const lineText = src.indent + text.slice(src.start, src.end);
  const at = after === 0 ? frontPos(act) : { pos: act.elements[after - 1].lineNext, lead: !act.elements[after - 1].hasNl };
  const expect = [];
  act.elements.forEach((el, k) => { if (k === after) expect.push({ ...expOf(src, 'new'), from: null }); expect.push(expOf(el)); });
  if (after === N) expect.push({ ...expOf(src, 'new'), from: null });
  const loopstart = expectedLoop(act, (i) => (i >= after ? i + 1 : i));
  const res = runStructural(text, act, {
    expect, loopstart, name: 'insert',
    build: (fix) => {
      let ins = fixText(fix, 'new', nl, style) + lineText + nl;
      if (at.lead) ins = nl + ins.slice(0, -nl.length);
      const out = [{ start: at.pos, end: at.pos, text: ins }];
      pushOldFixes(out, fix, act, nl, style);
      return out;
    },
  });
  if (res.error) return res;
  const map = (k) => (k > after ? k + 1 : k);
  return {
    op: 'insert', action: act.no, after, copyOf, newElem: after + 1, ...res,
    ...renumberAndWarnings(model, act, map, r.states, res, { op: 'insert', newCount: N + 1, redirectsHandled: r.redirectsHandled === true }),
  };
}

// planDeleteElement(text, { action, elem, loopstart?: 'next', states })
function planDeleteElement(text, req) {
  const r = req || {};
  const model = readModel(text);
  const got = liveAction(model, r.action);
  if (got.error) return got;
  const act = got.act;
  const N = act.elements.length;
  const el = elementOf(act, r.elem);
  if (!el) return { error: `elem must be 1-${N}` };
  if (N === 1) return { error: 'this is the only element: an action with no frames becomes a copy of the NEXT action in the file (anim.go:1210-1222), not an empty one' };
  const L = act.loopstart;
  const loopHere = act.loopstartLines.length && L > 0 && L === el.ordinal - 1;
  if (loopHere && (r.loopstart !== 'next' || el.ordinal === N)) {
    return { error: el.ordinal === N ? `the loop starts at element ${el.ordinal}; deleting it would move the Loopstart`
      : `the loop starts at element ${el.ordinal}; deleting it would move the Loopstart (pass loopstart: 'next' to loop from the following element)` };
  }
  const nl = nlOf(text, act), style = styleOf(act);
  // The deleted element's own blocks and interpolate markers go with it:
  // left behind they would silently bind to the next element.
  const removed = preludeOf(act, el).filter((it) => (it.kind === 'clsn' && !act.clsn[it.ref].isDefault) || it.kind === 'interpolate');
  const expect = act.elements.filter((e) => e !== el).map((e) => expOf(e));
  const loopstart = expectedLoop(act, (i) => (i > el.ordinal - 1 ? i - 1 : i));
  const res = runStructural(text, act, {
    expect, loopstart, name: 'delete', removedAt: el.ordinal - 1,
    build: (fix) => {
      const out = removed.map((it) => ({ start: it.start, end: it.next, text: '' }));
      out.push({ start: el.lineStart, end: el.lineNext, text: '' });
      pushOldFixes(out, fix, act, nl, style, new Set([el.ordinal]));
      return out;
    },
  });
  if (res.error) return res;
  const map = (k) => (k === el.ordinal ? null : k > el.ordinal ? k - 1 : k);
  return {
    op: 'delete', action: act.no, elem: el.ordinal, ...res,
    removedWith: removed.map((it) => ({ kind: it.kind, line: it.first })),
    ...renumberAndWarnings(model, act, map, r.states, res, { op: 'delete', newCount: N - 1, redirectsHandled: r.redirectsHandled === true }),
  };
}

// planMoveElement(text, { action, elem, to, states })
function planMoveElement(text, req) {
  const r = req || {};
  const model = readModel(text);
  const got = liveAction(model, r.action);
  if (got.error) return got;
  const act = got.act;
  const N = act.elements.length;
  const el = elementOf(act, r.elem);
  const to = parseIntStrict(r.to);
  if (!el || to === null || to < 1 || to > N) return { error: `elem and to must be 1-${N}` };
  if (to === el.ordinal) return { op: 'move', action: act.no, elem: el.ordinal, to, noop: true, splices: [], renumber: { map: {}, triggers: [], blocking: [], warnings: [] } };
  const nl = nlOf(text, act), style = styleOf(act);
  const L = act.loopstart;
  const carryLoop = act.loopstartLines.length && L > 0 && L === el.ordinal - 1;
  // What travels with the element: its own Clsn blocks, its interpolate
  // markers, and the Loopstart when the loop starts at it. Default blocks stay
  // where they are - they are state for every later element.
  const carried = preludeOf(act, el).filter((it) => (it.kind === 'clsn' && !act.clsn[it.ref].isDefault) || it.kind === 'interpolate' || (carryLoop && it.kind === 'loopstart'));
  const rest = act.elements.filter((e) => e !== el);
  const at = to === 1 ? frontPos(act) : { pos: rest[to - 2].lineNext, lead: !rest[to - 2].hasNl };
  const expect = rest.map((e) => expOf(e));
  expect.splice(to - 1, 0, expOf(el, 'new'));
  const order = expect.map((x) => x.from); // new index -> old ordinal
  const loopstart = expectedLoop(act, (i) => order.indexOf(i + 1));
  const res = runStructural(text, act, {
    expect, loopstart, name: 'move',
    build: (fix) => {
      const out = carried.map((it) => ({ start: it.start, end: it.next, text: '' }));
      out.push({ start: el.lineStart, end: el.lineNext, text: '' });
      let body = carried.map((it) => text.slice(it.start, it.next)).map((s) => (/\n$/.test(s) ? s : s + nl)).join('')
        + fixText(fix, 'new', nl, style) + text.slice(el.lineStart, el.lineNext) + (el.hasNl ? '' : nl);
      if (at.lead) body = nl + body.slice(0, -nl.length);
      out.push({ start: at.pos, end: at.pos, text: body });
      pushOldFixes(out, fix, act, nl, style, new Set([el.ordinal]));
      return out;
    },
  });
  if (res.error) return res;
  const map = (k) => order.indexOf(k) + 1;
  return {
    op: 'move', action: act.no, elem: el.ordinal, to, ...res,
    movedWith: carried.map((it) => ({ kind: it.kind, line: it.first })),
    ...renumberAndWarnings(model, act, map, r.states, res, { op: 'move', newCount: N, redirectsHandled: r.redirectsHandled === true }),
  };
}

// planAddBox(text, { action, elem, which, coords? })
function planAddBox(text, req) {
  const r = req || {};
  const model = readModel(text);
  const got = liveAction(model, r.action);
  if (got.error) return got;
  const act = got.act;
  const el = elementOf(act, r.elem);
  if (!el) return { error: `action ${act.no} has no element ${r.elem}` };
  const which = Number(r.which);
  if (which !== 1 && which !== 2) return { error: 'which must be 1 or 2' };
  const c = el['clsn' + which];
  let coords;
  if (r.coords !== undefined && r.coords !== null) {
    coords = Array.isArray(r.coords) && r.coords.length === 4 ? r.coords.map(parseIntStrict) : null;
    if (!coords || coords.some((q) => q === null)) return { error: 'coords must be four whole numbers x1, y1, x2, y2' };
  } else coords = c.rects.length ? c.rects[c.rects.length - 1].slice() : [-10, -10, 10, 10];
  const rect = normRect(coords);
  const nl = nlOf(text, act), style = styleOf(act);
  const newRects = c.rects.concat([rect]);
  const B = c.source === 'own' ? act.clsn[c.block] : null;
  if (B && B.short) return { error: `"${B.headerRaw}" (line ${B.line}) counts more boxes than it has lines; fix it by hand first` };
  if (B && !/^\d+$/.test(B.countRaw)) return { error: `the box count in "${B.headerRaw}" is not a plain number` };
  const expect = act.elements.map((e) => expOf(e));
  expect[el.ordinal - 1]['clsn' + which] = newRects;
  const res = runStructural(text, act, {
    expect, loopstart: act.loopstart,
    build: (fix) => {
      const out = [];
      if (B) {
        // Own block: bump the count and add the line after its last box.
        out.push({ start: B.countStart, end: B.countEnd, text: String(B.count + 1) });
        const last = B.boxes.length ? B.boxes[B.boxes.length - 1] : null;
        const indent = last ? last.indent : style.boxIndent;
        const pos = B.rangeNext;
        const lead = last ? !last.hasNl : !B.hasNl;
        let ins = `${indent}Clsn${which}[${B.count}] = ${rect.join(', ')}${nl}`;
        if (lead) ins = nl + ins.slice(0, -nl.length);
        out.push({ start: pos, end: pos, text: ins });
      } else {
        // Default or none: the element gets its own block (the default's boxes
        // plus the new one); the default stays untouched for everyone else.
        out.push({ start: el.lineStart, end: el.lineStart, text: blockText(which, newRects, nl, style) });
      }
      pushOldFixes(out, fix, act, nl, style);
      return out;
    },
  });
  if (res.error) return res;
  return { op: 'addbox', action: act.no, elem: el.ordinal, which, box: newRects.length - 1, rect, materialisedDefault: !B && c.source === 'default', ...res };
}

// planRemoveBox(text, { action, elem, which, box })
function planRemoveBox(text, req) {
  const r = req || {};
  const model = readModel(text);
  const got = liveAction(model, r.action);
  if (got.error) return got;
  const act = got.act;
  const el = elementOf(act, r.elem);
  if (!el) return { error: `action ${act.no} has no element ${r.elem}` };
  const which = Number(r.which);
  if (which !== 1 && which !== 2) return { error: 'which must be 1 or 2' };
  const c = el['clsn' + which];
  const box = Number(r.box);
  if (!Number.isInteger(box) || box < 0 || box >= c.rects.length) return { error: which === 1 ? `element ${el.ordinal} has no Clsn1 box ${r.box}` : `element ${el.ordinal} has no Clsn2 box ${r.box}` };
  const B = act.clsn[c.block];
  if (B.short) return { error: `"${B.headerRaw}" (line ${B.line}) counts more boxes than it has lines; fix it by hand first` };
  const nl = nlOf(text, act), style = styleOf(act);
  const newRects = c.rects.filter((_, k) => k !== box);
  const expect = act.elements.map((e) => expOf(e));
  expect[el.ordinal - 1]['clsn' + which] = newRects;
  const own = c.source === 'own';
  if (own && !/^\d+$/.test(B.countRaw)) return { error: `the box count in "${B.headerRaw}" is not a plain number` };
  const res = runStructural(text, act, {
    expect, loopstart: act.loopstart,
    build: (fix) => {
      const out = [];
      if (own && B.count === 1) {
        // The whole block goes; if a default would then show through, the
        // runner writes `ClsnN: 0` (an explicit empty own block).
        out.push({ start: B.lineStart, end: B.rangeNext, text: '' });
      } else if (own) {
        out.push({ start: B.countStart, end: B.countEnd, text: String(B.count - 1) });
        const bx = B.boxes[box];
        out.push({ start: bx.lineStart, end: bx.lineNext, text: '' });
        // Keep the [n] labels tidy where they were sequential. The engine
        // ignores them (anim.go:398-410), people do not.
        B.boxes.forEach((b2, k) => {
          if (k > box && b2.indexRaw === String(k) && b2.indexStart !== null) {
            out.push({ start: b2.indexStart, end: b2.indexStart + b2.indexRaw.length, text: String(k - 1) });
          }
        });
      } else {
        out.push({ start: el.lineStart, end: el.lineStart, text: blockText(which, newRects, nl, style) });
      }
      pushOldFixes(out, fix, act, nl, style);
      return out;
    },
  });
  if (res.error) return res;
  return { op: 'removebox', action: act.no, elem: el.ordinal, which, box, removed: c.rects[box], materialisedDefault: c.source === 'default', ...res };
}

// ---------------------------------------------------------------------------
// validateAir(newText, oldText, expected) -> null | reason
//
//   expected = { action, delta?, elem?, field?, after?, filled?, elements?, loopstart?, interpolate? }
//
// Re-parses both texts with the engine's rules. Always: the set of action
// numbers and their copy/alias structure is unchanged, every OTHER action's
// elements (fields and effective boxes), Loopstart and interpolation are
// identical, and the target action's element count changed by exactly `delta`.
// Value edit (`field`): only that element's line changed, only that field
// (plus fields the plan filled), and it now reads `after`.
// Structural / box edit (`elements`): each element's fields and effective
// boxes are exactly as listed, Loopstart is `loopstart`, and each Interpolate
// line attaches where `interpolate` ([kind, index] in file order) says.
function validateAir(newText, oldText, expected) {
  const e = expected || {};
  let A, B;
  try { A = readModel(oldText); B = readModel(newText); } catch (err) { return 're-parse failed: ' + err.message; }
  const ka = [...A.byNo.keys()].sort((x, y) => x - y), kb = [...B.byNo.keys()].sort((x, y) => x - y);
  if (JSON.stringify(ka) !== JSON.stringify(kb)) return 'the set of actions would change';
  if (A.duplicates.length !== B.duplicates.length) return 'the duplicate-action structure would change';
  const elSig = (el) => JSON.stringify([fieldRaws(el), el.clsn1.rects, el.clsn2.rects]);
  const actSig = (a) => JSON.stringify([a.elements.map(elSig), a.loopstart, a.interpolate.map((x) => [x.kind, x.at]), a.copy && a.copy.target]);
  const target = Number(e.action);
  for (const no of ka) {
    const a = A.actions[A.byNo.get(no)], b = B.actions[B.byNo.get(no)];
    const ta = A.table.get(no), tb = B.table.get(no);
    if (ta.copyOf !== tb.copyOf || ta.emptyCopyOf !== tb.emptyCopyOf || (ta.source !== tb.source)) return `the copy/alias structure of action ${no} would change`;
    if (no !== target) {
      if (actSig(a) !== actSig(b)) return `action ${no} would change`;
      continue;
    }
    const want = a.elements.length + (Number(e.delta) || 0);
    if (b.elements.length !== want) return `action ${no} would have ${b.elements.length} elements, expected ${want}`;
    if (e.field) {
      const k = Number(e.elem) - 1;
      const ea = a.elements[k], eb = b.elements[k];
      if (!ea || !eb) return `action ${no} has no element ${e.elem}`;
      if (oldText.slice(0, ea.lineStart) !== newText.slice(0, ea.lineStart)) return 'text before the edited line would change';
      if (oldText.slice(ea.lineNext) !== newText.slice(eb.lineNext)) return 'text after the edited line would change';
      if (A.lineCount !== B.lineCount) return 'the line count would change';
      for (let j = 0; j < a.elements.length; j++) if (j !== k && elSig(a.elements[j]) !== elSig(b.elements[j])) return `element ${j + 1} would change`;
      if (!rectsEq(ea.clsn1.rects, eb.clsn1.rects) || !rectsEq(ea.clsn2.rects, eb.clsn2.rects)) return 'the element\'s boxes would change';
      for (const nm of FIELD_NAMES) {
        const fa = ea.fields[nm], fb = eb.fields[nm];
        if (nm === e.field) {
          const got = fb.present ? fb.raw : '';
          if (got !== String(e.after)) return `${nm} would read "${got}", expected "${e.after}"`;
          continue;
        }
        const ra = fa.present ? fa.raw : null, rb = fb.present ? fb.raw : null;
        if (ra === rb) continue;
        const idx = fa.index;
        if (ra === null && rb === '' && (idx === 5 || idx === 6)) continue; // a blank flip/blend emitted to reach a later field
        if (ra === null && rb === '1' && (e.filled || []).includes(nm)) continue;
        if (ra === '' && rb === null && (idx === 5 || idx === 6) && e.after === '') continue; // trailing blank dropped with a cleared field
        return `field ${nm} would change ("${ra}" -> "${rb}")`;
      }
      if (a.loopstart !== b.loopstart || JSON.stringify(a.interpolate.map((x) => [x.kind, x.at])) !== JSON.stringify(b.interpolate.map((x) => [x.kind, x.at]))) return 'Loopstart or interpolation would change';
    }
    if (e.elements) {
      if (e.elements.length !== b.elements.length) return `expected ${e.elements.length} elements, found ${b.elements.length}`;
      for (let j = 0; j < b.elements.length; j++) {
        const x = e.elements[j], el = b.elements[j];
        if (x.fields && JSON.stringify(x.fields) !== JSON.stringify(fieldRaws(el))) return `element ${j + 1} would have different fields`;
        if (x.clsn1 && !rectsEq(x.clsn1, el.clsn1.rects)) return `element ${j + 1} would have different Clsn1 boxes`;
        if (x.clsn2 && !rectsEq(x.clsn2, el.clsn2.rects)) return `element ${j + 1} would have different Clsn2 boxes`;
      }
      // Where every Interpolate line attaches (anim.go:345-352): the op says.
      if (e.interpolate && JSON.stringify(b.interpolate.map((x) => [x.kind, x.at])) !== JSON.stringify(e.interpolate)) {
        return `Interpolate lines would attach to elements ${JSON.stringify(b.interpolate.map((x) => [x.kind, x.at + 1]))}, expected ${JSON.stringify(e.interpolate.map((x) => [x[0], x[1] + 1]))}`;
      }
    }
    if (e.loopstart !== undefined && e.loopstart !== null && b.loopstart !== e.loopstart) {
      return `Loopstart would be at element ${b.loopstart + 1}, expected ${e.loopstart + 1}`;
    }
  }
  return null;
}

module.exports = {
  FIELD_NAMES, parseAirSpans, describeAction, aliasesOf,
  planElementEdit, planClsnEdit, timingImpact,
  planInsertElement, planDeleteElement, planMoveElement, planAddBox, planRemoveBox,
  validateAir, scanTrigger, scanLine, redirectAt, renumberPlan, atoi,
};
