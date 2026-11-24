'use strict';
// JAPANESE IN THE PAUSE MENU'S COMMAND LIST: DotGothic16, shipped only when a
// build needs it.
//
// The engine's pause menu draws the Command List (menu.lua, the movelist
// block of `[Pause Menu]` / `[Training Pause Menu]`) in the font the motif's
// `movelist.text.font` names - Open_Sans.def by default, which has no kana or
// kanji, and in the website build an ASCII pixel font standing in for it
// (vfslib, DEVLOG Session 11b). A Japanese move name printed blank (Kula,
// headless, 2026-10-18). The engine draws TrueType on both builds (font.go
// loadDefInfo: `[Def] Type = truetype`, `File`, `Size`; the web build's own
// font_webgl.go), so the cure is a font that has the glyphs.
//
// THE FONT: DotGothic16 (Fontworks, SIL OFL 1.1; the owner's choice), in
// addons/jpfont/ beside its OFL.txt - the folder of the plain files the Studio
// carries into builds (the frame meter is there too); make-portable and
// make-kit copy `addons` whole, and scripts/make-notices.js lists it (key
// `jpfont`). Coverage is read from its own cmap (`coverage()`): Latin, kana,
// JIS X 0208 kanji, Greek, Cyrillic - no Hangul, no simplified-only Chinese.
//
// WHEN IT SHIPS (`needed`): only when a name the Command List writer prints
// (cmdlist.js, the export's movelist.dat) is one the stock fonts cannot draw
// (anything but printable ASCII) and this font can. Then the build gets
// font/DotGothic16.def (Type = truetype, Size = the command-list font's own
// size and spacing, so every line keeps its height: menu.lua spaces the
// lines by (Size[1] + Spacing[1]) * scale), font/DotGothic16-Regular.ttf and
// font/DotGothic16-OFL.txt (the license travels with the font), and the
// BUILD'S COPY of the screenpack's system.def gets one new [Files] fontN and
// `movelist.text.font = N, <the same bank, alignment and colors>` in both
// pause menus (`patchMotif`). Nothing else changes: the title, the glyphs
// (pictures from the motif's [Glyphs], sized from the font's Size[1] - the
// same number as before) and the color tags (`<#rrggbb>`, drawn by
// textImgSetColor, which a TrueType font takes like a bitmap one). A build
// whose names are all ASCII gets none of it - byte for byte as before.
//
// The writer (cmdlist.js) still picks the first name the stock fonts print, as
// before this font (so an ASCII-only build is unchanged); a row's `drawable`
// flag is true when the stock fonts or this font draw it, and the Moves page's
// "won't print" flag stays on for names in scripts the font lacks (Hangul,
// simplified-only Chinese). DOCS: GRAIL 3.10e.
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, 'addons', 'jpfont');
const TTF = 'DotGothic16-Regular.ttf';
const LICENSE = 'OFL.txt';
const DEF_FILE = 'DotGothic16.def';
// where the files go in a build (the engine's font/ folder; a [Files] fontN
// value resolves there: motif.go lookup "def,font/,,data/")
const VPATHS = { def: 'font/' + DEF_FILE, ttf: 'font/' + TTF, license: 'font/DotGothic16-OFL.txt' };
// The engine's default command-list font when a motif names none
// (defaultMotif.ini [Pause Menu] movelist.text.font = Open_Sans.def, 0, 1, ...;
// Open_Sans.def: Size = 13,27, Spacing = 1,1).
const DEFAULT_KEY = ['Open_Sans.def', '0', '1', '255', '255', '255', '255', '-1'];
const DEFAULT_SIZE = { size: [13, 27], spacing: [1, 1] };

// The stock fonts' test (printable ASCII) is the Command List writer's own
// (public/ikemen/cmdlist-core.js), so one rule says which name prints.
const { stockDraws } = require('./public/ikemen/cmdlist-core.js');

// ---- the font's own character map ---------------------------------------------------
let COVER = null;
function coverage() {
  if (COVER) return COVER;
  const set = new Set();
  try {
    const b = fs.readFileSync(path.join(DIR, TTF));
    const numTables = b.readUInt16BE(4);
    let cmap = -1;
    for (let i = 0; i < numTables; i++) { const r = 12 + 16 * i; if (b.toString('latin1', r, r + 4) === 'cmap') cmap = b.readUInt32BE(r + 8); }
    if (cmap < 0) throw new Error('no cmap');
    let best = null;
    for (let i = 0, n = b.readUInt16BE(cmap + 2); i < n; i++) {
      const r = cmap + 4 + 8 * i, pid = b.readUInt16BE(r), at = cmap + b.readUInt32BE(r + 4), fmt = b.readUInt16BE(at);
      const score = fmt === 12 ? 3 : (fmt === 4 && (pid === 3 || pid === 0)) ? 2 : 0;
      if (score && (!best || score > best.score)) best = { score, at, fmt };
    }
    if (!best) throw new Error('no Unicode cmap');
    if (best.fmt === 12) {
      for (let i = 0, ng = b.readUInt32BE(best.at + 12); i < ng; i++) {
        const r = best.at + 16 + 12 * i, s = b.readUInt32BE(r), e = b.readUInt32BE(r + 4), g = b.readUInt32BE(r + 8);
        for (let c = s; c <= e; c++) if (g + (c - s)) set.add(c);
      }
    } else {
      const segX2 = b.readUInt16BE(best.at + 6), ends = best.at + 14, starts = ends + segX2 + 2, deltas = starts + segX2, ranges = deltas + segX2;
      for (let k = 0; k < segX2 / 2; k++) {
        const e = b.readUInt16BE(ends + 2 * k), s = b.readUInt16BE(starts + 2 * k), d = b.readInt16BE(deltas + 2 * k), ro = b.readUInt16BE(ranges + 2 * k);
        for (let c = s; c <= e && c !== 0xffff; c++) {
          let g;
          if (!ro) g = (c + d) & 0xffff;
          else { g = b.readUInt16BE(ranges + 2 * k + ro + 2 * (c - s)); if (g) g = (g + d) & 0xffff; }
          if (g) set.add(c);
        }
      }
    }
  } catch (e) { /* no font: nothing is covered, so it never ships */ }
  COVER = set;
  return set;
}
// Can DotGothic16 draw every character of `s`? (a space or tab always)
function fontDraws(s) {
  const cov = coverage();
  if (!cov.size) return false;
  for (const ch of String(s == null ? '' : s)) { const c = ch.codePointAt(0); if (c !== 0x20 && c !== 0x09 && !cov.has(c)) return false; }
  return true;
}
// Will the build draw it: the stock fonts can, or this font can (and then it ships).
const drawable = (s) => stockDraws(s) || fontDraws(s);
// Does a build whose Command Lists print `names` need the font?
const needed = (names) => (names || []).some((n) => !stockDraws(n) && fontDraws(n));
const available = () => fs.existsSync(path.join(DIR, TTF)) && fs.existsSync(path.join(DIR, LICENSE));

// ---- the files ------------------------------------------------------------------------
// The font's .def: TrueType, at the command-list font's own size and spacing.
function defText(metrics) {
  const m = metrics || DEFAULT_SIZE;
  return [
    '[FNT v2]', 'fntversion = 2,00', 'name = "DotGothic16"', 'author = "Fontworks"', '',
    '; Written by the export for the pause menu\'s Command List: its moves have',
    '; names the stock fonts cannot draw. SIL Open Font License 1.1, see',
    '; DotGothic16-OFL.txt beside this file.',
    '[Def]', 'Type = truetype',
    'Size = ' + m.size[0] + ',' + m.size[1], 'Spacing = ' + m.spacing[0] + ',' + m.spacing[1], 'Offset = 0,0',
    'File = ' + TTF, 'Blend = 1',
    ...(m.bold > 0 ? ['; one font pixel heavier, as the row font it stands in for (modern-input engine)', 'Bold = ' + m.bold] : []),
    '',
  ].join('\r\n');
}
// THE WEIGHT. DotGothic16 has one weight: strokes one pixel wide on its
// 16-pixel grid. A pack's bitmap row font is often heavier (Capcom vs. SNK 2's
// namefnt.fnt: bold italic capitals, 3 px stems in 16 px cells), and a
// Japanese name drawn thin between such rows read as a lighter, smaller font.
// The modern-input engine draws a TrueType font `Bold = n` times more, one
// font pixel further right each time (font.go). boldFor measures the row
// font's stem: the most common width of the bright runs (luma 128 or more;
// an outline or shading is not stem) along the rows of a MUGEN .fnt (v1,
// its PCX); it returns 1 when that is at least 2 font pixels per 16 of the
// font's height (DotGothic16's own stem is 1), else 0. One at most: complex
// kanji close up at two. A TrueType row font, or a file this cannot read: 0.
function boldFor(fntBuf, metrics) {
  try {
    const b = Buffer.isBuffer(fntBuf) ? fntBuf : Buffer.from(fntBuf || []);
    if (b.length < 32 || b.toString('latin1', 0, 11) !== 'ElecbyteFnt') return 0;
    const po = b.readUInt32LE(16), ps = b.readUInt32LE(20);
    if (po + 128 > b.length || ps < 128 + 769) return 0;
    const p = b.subarray(po, Math.min(b.length, po + ps));
    const w = p.readUInt16LE(8) - p.readUInt16LE(4) + 1, h = p.readUInt16LE(10) - p.readUInt16LE(6) + 1, bpl = p.readUInt16LE(66);
    if (p[3] !== 8 || w <= 0 || h <= 0 || w > 16384 || h > 4096 || bpl < w) return 0;
    if (p[p.length - 769] !== 0x0c) return 0;
    const pal = p.subarray(p.length - 768);
    const { rlePcxDecode } = require('./public/ikemen/sffdec-core.js');
    const px = rlePcxDecode(p.subarray(128, p.length - 769), w, h, bpl);
    const bright = (i) => i !== 0 && pal[i * 3] * 0.3 + pal[i * 3 + 1] * 0.59 + pal[i * 3 + 2] * 0.11 >= 128;
    const runs = new Map();
    for (let y = 0; y < h; y++) {
      let run = 0;
      for (let x = 0; x <= w; x++) {
        if (x < w && bright(px[y * w + x])) run++;
        else if (run) { runs.set(run, (runs.get(run) || 0) + 1); run = 0; }
      }
    }
    let stem = 0, most = 0;
    for (const [len, n] of runs) if (n > most || (n === most && len < stem)) { stem = len; most = n; }
    const height = metrics && metrics.size && metrics.size[1] > 0 ? metrics.size[1] : 16;
    return stem * 16 / height >= 2 ? 1 : 0;
  } catch (e) { return 0; }
}
// { [vpath]: Buffer } for a build
function files(metrics) {
  return {
    [VPATHS.def]: Buffer.from(defText(metrics), 'latin1'),
    [VPATHS.ttf]: fs.readFileSync(path.join(DIR, TTF)),
    [VPATHS.license]: fs.readFileSync(path.join(DIR, LICENSE)),
  };
}

// ---- the motif ------------------------------------------------------------------------
// Sections of a motif text (latin1): [{ name (lower case), start, bodyStart, end }],
// by character offsets, a section running to the next header.
function sections(text) {
  const out = [];
  const re = /^[ \t]*\[([^\]\r\n]+)\][^\r\n]*$/gm;
  for (let m; (m = re.exec(text));) {
    if (out.length) out[out.length - 1].end = m.index;
    const nl = text.indexOf('\n', m.index);
    out.push({ name: m[1].trim().toLowerCase(), start: m.index, bodyStart: nl < 0 ? text.length : nl + 1, end: text.length });
  }
  return out;
}
const keyRe = (key) => new RegExp('^([ \\t]*' + key.replace(/\./g, '\\.') + '[ \\t]*=[ \\t]*)([^;\\r\\n]*?)([ \\t]*(?:;[^\\r\\n]*)?)$', 'mi');
// The first value of the motif's command-list font key (a [Files] index or a
// file name), from [Pause Menu], else the default's.
function commandListFont(text) {
  const t = String(text || '');
  const files = new Map();
  const secs = sections(t);
  const body = (s) => t.slice(s.bodyStart, s.end);
  const fsec = secs.find((s) => s.name === 'files');
  if (fsec) for (const m of body(fsec).matchAll(/^[ \t]*font(\d+)[ \t]*=[ \t]*([^;\r\n]*?)[ \t]*(?:;.*)?$/gmi)) if (!files.has(m[1])) files.set(m[1], m[2].trim());
  const pm = secs.find((s) => s.name === 'pause menu');
  const m = pm && keyRe('movelist.text.font').exec(body(pm));
  const first = m ? String(m[2]).split(',')[0].trim() : DEFAULT_KEY[0];
  return /^-?\d+$/.test(first) ? (files.get(String(parseInt(first, 10))) || null) : first;
}
// A font .def's [Def] Size and Spacing (latin1 text), or null.
function fontMetrics(defText) {
  const t = String(defText || '');
  const sec = /^[ \t]*\[def\][^\r\n]*$([\s\S]*?)(?=^[ \t]*\[|(?![\s\S]))/mi.exec(t);
  if (!sec) return null;
  const pair = (k) => { const m = new RegExp('^[ \\t]*' + k + '[ \\t]*=[ \\t]*(-?\\d+)[ \\t]*,[ \\t]*(-?\\d+)', 'mi').exec(sec[1]); return m ? [parseInt(m[1], 10), parseInt(m[2], 10)] : null; };
  const size = pair('size');
  if (!size || !(size[1] > 0)) return null;
  const out = { size, spacing: pair('spacing') || [0, 0] };
  if (/^[ \t]*type[ \t]*=[ \t]*truetype\b/mi.test(sec[1])) out.truetype = true;
  return out;
}
// THE SIZE BESIDE A TRUETYPE ROW FONT (V2 builds). The modern-input engine
// draws a name the row font cannot draw in DotGothic16 at the size of its .def
// (fontN.fallback), and a TrueType Size is the font's line, not its letters':
// at the same Size, DotGothic16's kana fill nearly the whole line and Open
// Sans' capitals two thirds of it. On the stock ikemen1 (Open_Sans.def, Size
// 27) the Japanese names measured 24-25 px against 18 px capitals at
// 1280x720. Beside a TrueType row font the .def gets 0.74 of its Size, so a
// kana is about as tall as a capital (DotGothic16's own 16 px grid makes the
// exact height round to the nearest pixel). A bitmap row font (a MUGEN .fnt,
// whose Size is its cell): unchanged.
// The weight too: at that size DotGothic16's strokes are one of its pixels
// (1.25 px at 1280x720) beside Open Sans' 2 px, and the names read a size
// smaller and greyer than "recovery" next to them. Beside a TrueType row font
// the .def also gets Bold = 1 (one font pixel heavier, the engine's [Def]
// bold, as beside a bold bitmap row font).
const TRUETYPE_FIT = 0.74;
function trueTypeFit(metrics) {
  if (!metrics || !metrics.truetype || !metrics.size) return metrics;
  const fit = (v) => Math.max(1, Math.round(v * TRUETYPE_FIT));
  return Object.assign({}, metrics, { size: [fit(metrics.size[0]), fit(metrics.size[1])], bold: Math.max(1, metrics.bold || 0) });
}
// The build's copy of a motif with the Command List's text drawn in the font:
// a new [Files] fontN (one past the highest index the motif uses) and
// `movelist.text.font = N, ...` in [Pause Menu] and [Training Pause Menu] -
// the rest of the key (bank, alignment, colors) as the motif has it, the
// engine's default when it has none; a pack without the section gets one.
// Every other byte is kept. -> { text, index }
function patchMotif(text) {
  let t = String(text);
  const eol = /\r\n/.test(t) ? '\r\n' : '\n';
  let max = -1;
  for (const m of t.matchAll(/^[ \t]*font(\d+)[ \t]*=/gmi)) max = Math.max(max, parseInt(m[1], 10));
  const index = Math.max(max + 1, 1);
  // [Files]: the new font as its first line (a key's first value wins)
  const fsec = sections(t).find((s) => s.name === 'files');
  const fline = 'font' + index + ' = ' + DEF_FILE + ' ;the Command List\'s font, written by the export' + eol;
  if (fsec) t = t.slice(0, fsec.bodyStart) + fline + t.slice(fsec.bodyStart);
  else t = '[Files]' + eol + fline + eol + t;
  // [Training Pause Menu] inherits what it does not set from [Pause Menu]
  // (motif.go overrideParams); it gets the key explicitly anyway, with the
  // rest of the values it would have inherited, so an engine without that
  // rule draws the same.
  const re = keyRe('movelist.text.font');
  const restOf = (v) => String(v).split(',').slice(1).map((p) => p.trim());
  let pauseRest = DEFAULT_KEY.slice(1);
  for (const name of ['pause menu', 'training pause menu']) {
    const s = sections(t).find((x) => x.name === name);
    const head = name === 'pause menu' ? '[Pause Menu]' : '[Training Pause Menu]';
    if (!s) {
      t = t.replace(/\s*$/, '') + eol + eol + head + eol + 'movelist.text.font = ' + [index, ...pauseRest].join(', ') + eol;
      continue;
    }
    const body = t.slice(s.bodyStart, s.end);
    const m = re.exec(body);
    let nb;
    if (m) {
      const rest = restOf(m[2]);
      if (name === 'pause menu') pauseRest = rest;
      nb = body.replace(re, (m0, k, v, tail) => k + [String(index), ...restOf(v)].join(', ') + tail);
    } else {
      nb = 'movelist.text.font = ' + [index, ...pauseRest].join(', ') + eol + body;
    }
    t = t.slice(0, s.bodyStart) + nb + t.slice(s.end);
  }
  return { text: t, index };
}

// ---- the modern-input engine (V2 builds) -----------------------------------------------
// The new pause menu draws the Command List as menu rows: `movelist.menu.item.font`
// and `movelist.menu.item.active.font`, which inherit [Pause Menu]'s
// `menu.item.font` / `menu.item.active.font` when the pack does not set them
// (motif.go: a pack's own movelist key, else its menu key, else the engine
// default `Open_Sans.def, ..., -1`). `movelist.text.font` is gone. So the
// English rows keep the pack's own look (CvS2's bitmap name font, ikemen1's
// Open_Sans), the build's copy does not repoint the rows: it gives every font
// they use a fallback, `fontN.fallback = M` in [Files] (engine font.go
// fallbackFor): a row with a character above ASCII that font N cannot draw is
// drawn whole in DotGothic16 (slot M); every other row as before. A row font
// named by file (the default) gets a [Files] slot of that file and height,
// which the engine's inline font lookup reuses (motif.go reserveFontSlots); a
// slot the pack already has for it is used instead (the first, as the engine
// picks), and the engine's own font0 (Open_Sans.def) when the pack keeps it.
// The list's title (`movelist.title.font`, else the pause menu's `title.font`)
// prints the character's display name and gets the same fallback, after the
// rows (a title with no font, -1, gets none).
// -> the row fonts, then the title's, as { section, key, value, file, height }.
const V2_DEFAULT = { file: 'Open_Sans.def', height: -1 };
function rowFontRefs(text) {
  const t = String(text || '');
  const secs = sections(t);
  const body = (s) => t.slice(s.bodyStart, s.end);
  const val = (s, key) => { if (!s) return null; const m = keyRe(key).exec(body(s)); return m ? String(m[2]).trim() : null; };
  const pm = secs.find((s) => s.name === 'pause menu');
  const tm = secs.find((s) => s.name === 'training pause menu');
  const out = [];
  for (const [dst, src] of [['movelist.menu.item.font', 'menu.item.font'], ['movelist.menu.item.active.font', 'menu.item.active.font'], ['movelist.title.font', 'title.font']]) {
    const pv = val(pm, dst) || val(pm, src);
    out.push({ section: 'pause menu', key: dst, value: pv });
    // [Training Pause Menu] inherits [Pause Menu] unless it sets its own
    const tv = val(tm, dst) || val(tm, src);
    if (tv) out.push({ section: 'training pause menu', key: dst, value: tv });
  }
  return out.map((r) => {
    if (!r.value) return Object.assign(r, V2_DEFAULT);
    const parts = r.value.split(',').map((p) => p.trim());
    const h = parts.length > 7 && /^-?\d+$/.test(parts[7]) ? parseInt(parts[7], 10) : -1;
    return Object.assign(r, /^-?\d+$/.test(parts[0]) ? { slot: parseInt(parts[0], 10), height: h } : { file: parts[0].replace(/^"|"$/g, ''), height: h });
  });
}
// [Files] fonts: index -> { file, height } (latin1 text), in file order.
function filesFonts(text) {
  const t = String(text || '');
  const fsec = sections(t).find((s) => s.name === 'files');
  const out = new Map();
  if (!fsec) return out;
  const body = t.slice(fsec.bodyStart, fsec.end);
  for (const m of body.matchAll(/^[ \t]*font(\d+)[ \t]*=[ \t]*([^;\r\n]*?)[ \t]*(?:;.*)?$/gmi)) {
    const i = parseInt(m[1], 10);
    if (!out.has(i)) out.set(i, { file: m[2].trim().replace(/^"|"$/g, ''), height: -1 });
  }
  for (const m of body.matchAll(/^[ \t]*font(\d+)\.height[ \t]*=[ \t]*(-?\d+)/gmi)) {
    const f = out.get(parseInt(m[1], 10));
    if (f) f.height = parseInt(m[2], 10);
  }
  return out;
}
// A font file as the engine finds it, for comparing two names (font/ is searched).
const fontKey = (file) => String(file || '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/^font\//i, '').toLowerCase();
// The first row font's file, for the DotGothic16 .def's size (the inactive rows).
function commandListFontV2(text) {
  const r = rowFontRefs(text)[0];
  if (r.slot === undefined) return r.file;
  const f = filesFonts(text).get(r.slot);
  return f ? f.file : null;
}
// The build's copy of a motif for the modern-input engine: DotGothic16 as a new
// [Files] slot, and `fontN.fallback` on every font the Command List rows use.
// Nothing else changes. -> { text, index, slots }
function patchMotifV2(text) {
  let t = String(text);
  const eol = /\r\n/.test(t) ? '\r\n' : '\n';
  const fonts = filesFonts(t);
  let max = -1;
  for (const m of t.matchAll(/^[ \t]*font(\d+)[ \t]*=/gmi)) max = Math.max(max, parseInt(m[1], 10));
  // past the pack's own slots and the engine's font0 and font1 (defaultMotif.ini)
  const index = Math.max(max + 1, 2);
  let next = index + 1;
  const lines = ['font' + index + ' = ' + DEF_FILE + ' ;the Command List\'s Japanese names, written by the export'];
  const slots = [];
  const added = new Map();
  for (const r of rowFontRefs(t)) {
    let slot = r.slot;
    if (slot !== undefined && slot < 0) continue;
    if (slot === undefined) {
      const k = fontKey(r.file) + '|' + r.height;
      for (const [i, f] of fonts) if (slot === undefined && fontKey(f.file) + '|' + f.height === k) slot = i;
      // the engine's own font0 = Open_Sans.def (height -1), unless the pack replaced it
      if (slot === undefined && k === fontKey(V2_DEFAULT.file) + '|-1' && !fonts.has(0)) slot = 0;
      if (slot === undefined && added.has(k)) slot = added.get(k);
      if (slot === undefined) {
        slot = next++;
        added.set(k, slot);
        lines.push('font' + slot + ' = ' + r.file + ' ;the Command List rows\' font, given a slot for its fallback');
        if (r.height !== -1) lines.push('font' + slot + '.height = ' + r.height);
      }
    }
    if (slots.includes(slot) || slot === index) continue;
    if (new RegExp('^[ \\t]*font' + slot + '\\.fallback[ \\t]*=', 'mi').test(t)) continue;
    slots.push(slot);
  }
  for (const s of slots) lines.push('font' + s + '.fallback = ' + index);
  const block = lines.join(eol) + eol;
  const fsec = sections(t).find((s) => s.name === 'files');
  // At the top of [Files]: a key's first value wins, and the new slots are past the pack's own.
  if (fsec) t = t.slice(0, fsec.bodyStart) + block + t.slice(fsec.bodyStart);
  else t = '[Files]' + eol + block + eol + t;
  return { text: t, index, slots };
}

// THE DESKTOP EXPORT ON UPSTREAM'S OFFICIAL ENGINE. \`fontN.fallback\` is our
// web engine's (font.go fallbackFor); upstream's modern-input build has no such
// key and draws a name its row font cannot draw as nothing. So the desktop
// build's copy draws the Command List's rows and title in DotGothic16 itself,
// as the 1.0 desktop build did through movelist.text.font: the motif's
// DotGothic16 slot (patchMotifV2 put it there) on movelist.menu.item.font,
// movelist.menu.item.active.font and movelist.title.font in [Pause Menu] (and
// [Training Pause Menu] where it sets its own), each keeping its bank,
// alignment and color; the fallback lines that point at the slot go (a key the
// engine does not know). Only for a build whose list has names the stock fonts
// cannot draw (the caller decides, as for the web). -> { text, index, keys }
const V2_ROW_DEFAULTS = {
  'movelist.menu.item.font': ['0', '1', '191', '191', '191', '255'],
  'movelist.menu.item.active.font': ['0', '1', '255', '255', '255', '255'],
  'movelist.title.font': ['0', '0', '255', '255', '255', '255'],
};
const ROWS_MARK = ';the Command List\'s Japanese names (this engine has no font fallback), written by the export';
function pointRowsV2(text) {
  let t = String(text);
  const eol = /\r\n/.test(t) ? '\r\n' : '\n';
  const hit = [...filesFonts(t)].find(([, f]) => fontKey(f.file) === fontKey(DEF_FILE));
  if (!hit) return { text: t, index: null, keys: [] };
  const index = hit[0];
  t = t.replace(new RegExp('^[ \\t]*font\\d+\\.fallback[ \\t]*=[ \\t]*' + index + '[ \\t]*(?:;[^\\r\\n]*)?\\r?\\n', 'gmi'), '');
  const keys = [];
  for (const r of rowFontRefs(t)) {
    if (r.slot !== undefined && r.slot < 0) continue;      // a title with no font prints nothing
    if (r.slot === index) continue;                        // already there
    const parts = r.value ? r.value.split(',').map((p) => p.trim()) : [''].concat(V2_ROW_DEFAULTS[r.key]);
    parts[0] = String(index);
    if (parts.length > 7) parts[7] = '-1';                 // the DotGothic16 def's own size
    const val = parts.join(', ');
    const sec = sections(t).find((s) => s.name === r.section);
    const head = r.section === 'pause menu' ? '[Pause Menu]' : '[Training Pause Menu]';
    if (!sec) {
      t = t.replace(/\s*$/, '') + eol + eol + head + eol + r.key + ' = ' + val + ' ' + ROWS_MARK + eol;
    } else {
      const body = t.slice(sec.bodyStart, sec.end);
      const re = keyRe(r.key);
      const nb = re.test(body) ? body.replace(re, (m, a, b, c) => a + val + ' ' + ROWS_MARK) : r.key + ' = ' + val + ' ' + ROWS_MARK + eol + body;
      t = t.slice(0, sec.bodyStart) + nb + t.slice(sec.end);
    }
    keys.push(r.section + ': ' + r.key);
  }
  return { text: t, index, keys };
}

module.exports = { boldFor, trueTypeFit, TRUETYPE_FIT, DIR, TTF, LICENSE, DEF_FILE, VPATHS, DEFAULT_SIZE, coverage, fontDraws, stockDraws, drawable, needed, available, defText, files, commandListFont, fontMetrics, patchMotif, sections,
  rowFontRefs, filesFonts, commandListFontV2, patchMotifV2, pointRowsV2, ROWS_MARK };
