'use strict';
// THE COMMAND LIST'S WORD PICTURES, READABLE (modern-input web builds).
//
// A movelist writes some inputs as words: `_AIR` before an air move's input,
// `_TAP`, `_MAX`, `_EX`, `_CHARGE`, `_HOLD` ... (defaultMotif.ini [Glyphs]).
// The engine draws each [Glyphs] token as a picture from the motif's glyph file
// (`[Files] glyphs`, default data/glyphs.sff), scaled so the picture is as tall
// as the row's font (font.go drawGlyph: Size[1] x scale / the sprite's
// height). The stock pictures are 64 px tall, and an arrow or a button fills
// nearly all of that (56 to 64 px of ink), but a word's letters fill only a
// band of 26 px in the middle. Beside 22 px buttons at 1280x720 (Capcom vs.
// SNK 2's Command List) "AIR" measured 9 px tall: the one part of the inputs
// still hard to read (plan 1.23).
//
// The web build's copy of the glyph file gets, for each word token, the same
// picture cut down to its letters' band plus an even margin, so the letters
// fill WORD_FILL of the picture's height. A word then draws about as tall as
// the arrows beside it (17 px beside 22 px buttons at 1280x720, where "AIR"
// measured 9 px) and proportionally wider; nothing else in the picture
// changes. The cut pictures go at the end
// of a copy of the file (buttonstyle.appendSprites, SFF v2 only) beside the
// motif as cmdlist-words.sff, named by a new first line of [Files], and the
// word tokens' [Glyphs] keys point at them (new first lines of [Glyphs]: a
// key's first value wins). The Command List button style (buttonstyle.js)
// runs after this and starts from that file. A token the pack maps to a
// picture of its own is cut the same way when it is a word band; one already
// tall enough, a paletted (fmt 10) picture, or a file that is not SFF v2 stays
// as it is. The installed pack and data/glyphs.sff are never written.
//
// IN THE ROWS' OWN LETTERS. Beside a pack's bitmap row font (a MUGEN .fnt,
// Capcom vs. SNK 2's namefnt: bold italic capitals) the cut picture was a
// third face in the row: a plain sans-serif "AIR" beside the pack's letters
// and the arrows. When the Command List's rows use a MUGEN .fnt (v1) that has
// the letters, each word is drawn from that font instead: its own pixels,
// palette (bank 0) and spacing, four times larger (pixel for pixel, so the
// engine's smaller copies for small glyphs keep its pixels whole) and as tall
// as the font's cell, so the engine draws it at exactly the size of the row's
// letters (a glyph is drawn as tall as the font's Size). A TrueType row font
// (the stock ikemen1's Open_Sans) keeps the cut pictures.
//
// Only for the modern-input engine's web builds (vfslib, IKEMEN_V2, opts.web),
// like the web font stand-ins (webfonts.js): V1 builds and the desktop export
// (upstream's official build and data) are unchanged. Pure apart from the
// reader vfslib passes in.

const BTN = require('./buttonstyle.js');
const { decodePng } = require('./tools/png-decode.js');

// The word tokens and the engine's own pictures for them (defaultMotif.ini [Glyphs]).
const WORDS = {
  _AIR: [121, 0], _TAP: [122, 0], _MAX: [123, 0], _EX: [124, 0],
  _CHARGE: [136, 0], _HOLD: [137, 0], _RELEASE: [138, 0], _MASH: [139, 0],
  _CLOSE: [140, 0], _FAR: [141, 0], _AIROK: [142, 0], _THROW: [143, 0], _COUNTER: [144, 0],
};
// The share of the picture's height the letters fill after the cut. The stock
// arrows fill 0.875, the button balls 1.0; a word at 0.8 is about as tall as
// an arrow's ink. (0.62 was tried first: 13 px beside 22 px buttons, still a
// size smaller than every other part of the input.)
const WORD_FILL = 0.8;
// Cut only a picture whose letters fill less than this (a band, not a picture).
const BAND_MAX = 0.55;
const MARK = ';Command List words (a readable size), written by the export';
const FILE = 'cmdlist-words.sff';
const patched = (text) => String(text || '').includes(MARK);

// The ink rows of an RGBA picture: [first, last] or null.
function inkRows(px, w, h) {
  let y0 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (px[(y * w + x) * 4 + 3] !== 0) { if (y0 < 0) y0 = y; y1 = y; break; }
    }
  }
  return y0 < 0 ? null : [y0, y1];
}

// The rows a word picture is cut to: { top, height } or null (keep it).
function cutRows(px, w, h) {
  const ink = inkRows(px, w, h);
  if (!ink) return null;
  const band = ink[1] - ink[0] + 1;
  if (band / h >= BAND_MAX) return null;
  const height = Math.min(h, Math.max(band, Math.round(band / WORD_FILL)));
  const mid = (ink[0] + ink[1] + 1) / 2;
  const top = Math.max(0, Math.min(h - height, Math.round(mid - height / 2)));
  return { top, height };
}

// One cut sprite (SFF v2 PNG32, format 12, as the stock pictures) from a node of
// `buf`, or null. The axis keeps its place relative to the picture's bottom
// (the stock pictures' axis is 0, 64: the bottom left).
function cutSprite(buf, node) {
  if (!node || !(node.fmt === 11 || node.fmt === 12)) return null;
  const data = BTN.spriteData(buf, node);
  if (!data || data.length < 12) return null;
  let img;
  try { img = decodePng(data.subarray(4)); } catch (e) { return null; }
  if (!img || img.kind !== 'rgba') return null;
  const c = cutRows(img.px, img.w, img.h);
  if (!c) return null;
  const px = Buffer.alloc(img.w * c.height * 4);
  Buffer.from(img.px.buffer, img.px.byteOffset + c.top * img.w * 4, img.w * c.height * 4).copy(px);
  const png = BTN.encodePng(px, img.w, c.height);
  const out = Buffer.alloc(4 + png.length);
  out.writeUInt32LE(img.w * c.height * 4, 0);
  png.copy(out, 4);
  const bottom = node.h - node.axisY;   // the axis' distance above the picture's bottom
  return { w: img.w, h: c.height, axisX: node.axisX, axisY: Math.max(0, Math.min(c.height, c.height - bottom)), fmt: 12, depth: 32, data: out, cut: c, from: [node.w, node.h] };
}

// The words the tokens stand for (the engine's own pictures say these).
const WORD_TEXT = {
  _AIR: 'AIR', _TAP: 'TAP', _MAX: 'MAX', _EX: 'EX', _CHARGE: 'CHARGE', _HOLD: 'HOLD', _RELEASE: 'RELEASE',
  _MASH: 'MASH', _CLOSE: 'CLOSE', _FAR: 'FAR', _AIROK: 'AIR OK', _THROW: 'THROW', _COUNTER: 'COUNTER',
};
// How many times larger a word drawn from a bitmap font is stored.
const FNT_ZOOM = 4;

// A MUGEN bitmap font (.fnt v1: a PCX and a text part) as
// { size: [w, h], spacing, chars: Map(char -> { x, w }), w, h, px, pal } or null.
function readFnt(buf) {
  try {
    const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf || []);
    if (b.length < 32 || b.toString('latin1', 0, 11) !== 'ElecbyteFnt') return null;
    const po = b.readUInt32LE(16), ps = b.readUInt32LE(20), to = b.readUInt32LE(24), ts = b.readUInt32LE(28);
    if (po + 128 > b.length || ps < 128 + 769 || to + ts > b.length) return null;
    const p = b.subarray(po, Math.min(b.length, po + ps));
    const w = p.readUInt16LE(8) - p.readUInt16LE(4) + 1, h = p.readUInt16LE(10) - p.readUInt16LE(6) + 1, bpl = p.readUInt16LE(66);
    if (p[3] !== 8 || p[65] !== 1 || w <= 0 || h <= 0 || w > 16384 || h > 512 || bpl < w) return null;
    if (p[p.length - 769] !== 0x0c) return null;
    const pal = p.subarray(p.length - 768);
    const { rlePcxDecode } = require('./public/ikemen/sffdec-core.js');
    const px = rlePcxDecode(p.subarray(128, p.length - 769), w, h, bpl);
    const text = b.toString('latin1', to, to + ts);
    const pair = (k) => { const m = new RegExp('^[ \\t]*' + k + '[ \\t]*=[ \\t]*(-?\\d+)[ \\t]*,[ \\t]*(-?\\d+)', 'mi').exec(text); return m ? [+m[1], +m[2]] : null; };
    const size = pair('size');
    if (!size || size[0] <= 0 || size[1] <= 0) return null;
    const spacing = pair('spacing') || [0, 0];
    const variable = /^[ \t]*type[ \t]*=[ \t]*variable\b/mi.test(text);
    const at = text.search(/^[ \t]*\[map\]/mi);
    if (at < 0) return null;
    const chars = new Map();
    let i = 0;
    for (const raw of text.slice(at).split(/\r?\n/).slice(1)) {
      if (/^[ \t]*\[/.test(raw)) break;
      const line = raw.replace(/^[ \t]+/, '');
      if (!line) continue;
      // the char is the first character (a ';' is a comment unless it is the char itself), or 0xNN
      let ch, rest;
      const hex = /^0x([0-9a-f]{1,4})(?=[\s;]|$)/i.exec(line);
      if (hex) { ch = String.fromCharCode(parseInt(hex[1], 16)); rest = line.slice(hex[0].length); }
      else { if (line[0] === ';') continue; ch = line[0]; rest = line.slice(1); }
      const nums = rest.split(';')[0].trim().split(/[\s,]+/).filter(Boolean).map(Number);
      if (variable && nums.length >= 2 && nums.every(Number.isFinite)) chars.set(ch, { x: nums[0], w: nums[1] });
      else if (!variable) chars.set(ch, { x: i * size[0], w: size[0] });
      i++;
    }
    return chars.size ? { size, spacing, chars, w, h, px, pal } : null;
  } catch (e) { return null; }
}

// A word in a bitmap font as an SFF v2 PNG32 sprite, FNT_ZOOM times larger,
// as tall as the font's cell (its Size), or null when a letter is missing.
function fntWordSprite(fnt, word) {
  const parts = [];
  let width = 0;
  for (const ch of String(word)) {
    if (ch === ' ') { parts.push(null); width += fnt.size[0]; continue; }
    const c = fnt.chars.get(ch) || fnt.chars.get(ch.toUpperCase());
    if (!c || c.w <= 0 || c.x + c.w > fnt.w) return null;
    parts.push(c);
    width += c.w;
  }
  width += fnt.spacing[0] * Math.max(0, parts.length - 1);
  const H = fnt.size[1];
  if (width <= 0 || !parts.some(Boolean)) return null;
  // a margin on each side (an eighth of the cell's height), as the stock
  // pictures have: without it "AIR" touched the arrow after it
  const pad = Math.max(1, Math.round(H / 8));
  const Z = FNT_ZOOM, W = (width + 2 * pad) * Z, HZ = H * Z;
  const px = Buffer.alloc(W * HZ * 4);
  let x0 = 0;
  for (const c of parts) {
    if (c) {
      for (let y = 0; y < Math.min(H, fnt.h); y++) {
        for (let x = 0; x < c.w; x++) {
          const idx = fnt.px[y * fnt.w + c.x + x];
          if (!idx) continue;
          const dx = x0 + x;
          if (dx < 0 || dx >= width) continue;
          for (let zy = 0; zy < Z; zy++) for (let zx = 0; zx < Z; zx++) {
            const o = (((y * Z + zy) * W) + (dx + pad) * Z + zx) * 4;
            px[o] = fnt.pal[idx * 3]; px[o + 1] = fnt.pal[idx * 3 + 1]; px[o + 2] = fnt.pal[idx * 3 + 2]; px[o + 3] = 255;
          }
        }
      }
      x0 += c.w + fnt.spacing[0];
    } else x0 += fnt.size[0] + fnt.spacing[0];
  }
  const png = BTN.encodePng(px, W, HZ);
  const data = Buffer.alloc(4 + png.length);
  data.writeUInt32LE(W * HZ * 4, 0);
  png.copy(data, 4);
  return { w: W, h: HZ, axisX: 0, axisY: HZ, fmt: 12, depth: 32, data, word, from: 'font' };
}

// THE PLAN for one glyph file (`base`, a Buffer) and the motif's own [Glyphs]
// keys (`own`, buttonstyle.ownGlyphs): { overrides: { '_AIR': [g, 0] },
// sprites: [...], notes } (no sprites: nothing to do). `fnt` (readFnt): the
// rows' bitmap font, whose letters draw the words a pack does not picture
// itself.
function plan(base, own, fnt) {
  const nodes = base ? BTN.sffNodes(base) : null;
  if (!nodes) return { overrides: {}, sprites: [], notes: ['the glyph file is not an SFF v2; the word pictures stay as they are'] };
  const has = new Map();
  for (const n of nodes) { const k = n.group + ',' + n.index; if (!has.has(k)) has.set(k, n); }
  let g0 = 9600;
  const used = new Set(nodes.map((n) => n.group));
  const count = Object.keys(WORDS).length;
  for (;;) { let free = true; for (let g = g0; g < g0 + count; g++) if (used.has(g)) { free = false; break; } if (free) break; g0 += 100; if (g0 > 65000) return { overrides: {}, sprites: [], notes: ['no free sprite group in the glyph file'] }; }
  const overrides = {}, sprites = [], notes = [];
  const bySource = new Map();
  for (const token of Object.keys(WORDS)) {
    if (fnt && !(own && own[token])) {
      const s = fntWordSprite(fnt, WORD_TEXT[token]);
      if (s) {
        const at = [g0 + sprites.length, 0];
        sprites.push(Object.assign({ group: at[0], index: 0 }, s));
        overrides[token] = at;
        notes.push(token + ' in the rows\' font ' + s.w + 'x' + s.h);
        continue;
      }
    }
    const src = (own && own[token]) || WORDS[token];
    const key = src[0] + ',' + src[1];
    if (bySource.has(key)) { if (bySource.get(key)) overrides[token] = bySource.get(key); continue; }
    const s = cutSprite(base, has.get(key));
    if (!s) { bySource.set(key, null); continue; }
    const at = [g0 + sprites.length, 0];
    sprites.push(Object.assign({ group: at[0], index: 0 }, s));
    bySource.set(key, at);
    overrides[token] = at;
    notes.push(token + ' ' + s.from[0] + 'x' + s.from[1] + ' -> ' + s.w + 'x' + s.h);
  }
  return { overrides, sprites, notes };
}

// The build's copy of the motif: a new first `glyphs =` line in [Files] (when
// `file`) and the overrides as new first lines of [Glyphs].
function patchMotif(text, overrides, file) {
  let t = String(text);
  const eol = /\r\n/.test(t) ? '\r\n' : '\n';
  if (file) {
    const fsec = BTN.sections(t).find((s) => s.name === 'files');
    const fline = 'glyphs = ' + file + ' ' + MARK + eol;
    if (fsec) t = t.slice(0, fsec.bodyStart) + fline + t.slice(fsec.bodyStart);
    else t = '[Files]' + eol + fline + eol + t;
  }
  const keys = Object.keys(overrides || {});
  if (keys.length) {
    const lines = keys.map((k) => k + ' = ' + overrides[k][0] + ', ' + overrides[k][1] + ' ' + MARK + eol).join('');
    const g = BTN.sections(t).find((s) => s.name === 'glyphs');
    if (g) t = t.slice(0, g.bodyStart) + lines + t.slice(g.bodyStart);
    else t = t.replace(/\s*$/, '') + eol + eol + '[Glyphs]' + eol + lines;
  }
  return t;
}

// ONE BUILD: the motif's path and text as the build has them so far, a reader
// for the build's files by path (-> Buffer | null).
// -> null (nothing to do), or { text, file: { vpath, buf }, info: { base, file, notes } }
function forBuild(motifVpath, motifText, read) {
  if (patched(motifText)) return null;
  const value = BTN.glyphsFile(motifText);
  let baseAt = null, base = null;
  for (const c of BTN.glyphsCandidates(motifVpath, value)) { const b = read(c); if (b) { baseAt = c; base = b; break; } }
  if (!base) return null;
  // the Command List rows' font, where the engine looks for a motif's font
  let fnt = null;
  try {
    const JP = require('./jpfont.js');
    const name = String(JP.commandListFontV2(motifText) || '').replace(/\\/g, '/');
    const dir = String(motifVpath).replace(/\\/g, '/').replace(/[^/]*$/, '');
    if (/\.fnt$/i.test(name)) for (const c of [dir + name, 'font/' + name, name, 'data/' + name]) { const b = read(c); if (b) { fnt = readFnt(b); break; } }
  } catch (e) { fnt = null; }
  const p = plan(base, BTN.ownGlyphs(motifText), fnt);
  if (!p.sprites.length) return { text: motifText, file: null, info: { base: baseAt, file: null, notes: p.notes } };
  const dir = String(motifVpath).replace(/\\/g, '/').replace(/[^/]*$/, '');
  const file = { vpath: dir + FILE, buf: BTN.appendSprites(base, p.sprites) };
  return { text: patchMotif(motifText, p.overrides, FILE), file, info: { base: baseAt, file: file.vpath, overrides: p.overrides, notes: p.notes } };
}

module.exports = { WORDS, WORD_TEXT, WORD_FILL, BAND_MAX, FNT_ZOOM, MARK, FILE, patched, inkRows, cutRows, cutSprite, readFnt, fntWordSprite, plan, patchMotif, forBuild };
