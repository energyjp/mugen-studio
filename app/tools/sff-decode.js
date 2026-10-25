// SFF decoding and indexed-PNG encoding, lifted VERBATIM out of
// tools/extract-charart.js so it can be shared without shipping the
// leaderboard extractor with it.
//
// WHY THIS FILE EXISTS. The complete v1+v2 SFF decoder used to live inside
// extract-charart.js, which generates leaderboard artwork and is therefore
// private-build-only - make-kit.js refuses to build a kit containing it. That
// left Mod Studio unable to render a single pixel of character art. Splitting
// the decoder out lets the Studio (and the kit) show sprites while the
// extractor, and the leak guard protecting it, are untouched.
//
// NOT REWRITTEN, DELIBERATELY. These functions are field-hardened: the
// "advance only while not at the last byte" guards are faithful ports from
// src/image.go, the fmt-10 SFF-palette substitution exists because dr_kira
// rendered as a black silhouette without it, and the v1 portrait-vs-fight
// palette split exists because RyuDX rendered as noise. The move was done by
// script and verified by byte-comparing every extracted PNG against the
// previous leaderboard-art output.
//
// Node-only: uses Buffer and zlib. The browser side consumes decoded PNGs over
// an HTTP route rather than re-implementing this against Uint8Array.

const fs = require('fs');
const zlib = require('zlib');
// The pure decode core, shared verbatim with the browser. Buffer extends
// Uint8Array, so Buffers pass straight in.
const core = require('../public/ikemen/sffdec-core.js');
const pngDecode = require('./png-decode.js');

// Path-taking wrappers: the core takes bytes, this file has the filesystem.
function readSff(file) { return core.readSff(fs.readFileSync(file)); }
function readAct(file) {
  let raw; try { raw = fs.readFileSync(file); } catch (e) { return null; }
  return core.readAct(raw);
}
function parseDef(defPath) { return core.parseDef(fs.readFileSync(defPath, 'latin1')); }

// decodeSprite, but PNG sprites come back as PIXELS rather than as file bytes.
//
// core.decodeSprite returns `{kind:'png', bytes}` for SFFv2 formats 10-12 and
// leaves the decoding to the browser, which is right in the UI and leaves every
// headless caller holding a result with no `px` field. Anything that wanted
// PIXELS - the sprite audit, and anything that ever wants to measure or compare
// art outside a browser - silently saw those 11,765 sprites as failures.
//
// The palette handling is the subtle half. Format 10 is an INDEX MAP that the
// engine colors from the SFF's own palette table, ignoring the PNG's PLTE
// (image.go:1298-1302, and the dr_kira black-silhouette bug that proved it).
// decodeSprite has already worked out which palette applies, including any
// explicit palOverride, so that one wins and the PLTE is only a fallback.
function spritePixels(sff, group, index, opts) {
  const r = core.decodeSprite(sff, group, index);
  if (!r || r.kind !== 'png') return r;
  let img;
  try { img = pngDecode.decodePng(r.bytes, opts); } catch (e) { return null; }
  if (img.kind === 'indexed') {
    return { kind: 'indexed', w: img.w, h: img.h, px: img.px, pal: r.pal || img.pal };
  }
  return { kind: 'rgba', w: img.w, h: img.h, px: img.px };
}
const { v2PaletteAt, decodeSprite } = core;
const { rle8Decode, rle5Decode, lz5Decode, rlePcxDecode,
        v2Palette, v1Sprite, spriteGeom } = core;





// ---------------------------------------------------------------------------
// Minimal palettized-PNG encoder (color type 3 + tRNS). Only needs to handle
// what the decoders above produce: one byte per pixel, 256-entry RGB palette,
// index 0 transparent - so filter type 0 on every scanline is fine and the
// whole thing is ~20 lines around zlib.
//
// `alpha` (optional): a per-entry alpha table (any array-like; a missing or
// non-numeric entry, or one past its end, is 255). The tRNS chunk is then
// written just long enough to reach the LAST entry that is not 255 - PNG
// treats every entry past the end of tRNS as opaque - and left out entirely
// when every entry is 255. This is how a palette with partial alpha (SFF
// v2.01 stores one per color, and the engine draws with it) reaches a PNG.
// Without `alpha` the chunk is today's single byte, index 0 transparent, and
// the file is byte-for-byte what it always was; an alpha table of index 0 = 0
// and everything else 255 writes the very same bytes.

function encodeIndexedPng(px, w, h, palRGB, alpha) {
  const raw = Buffer.alloc((w + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w + 1)] = 0; // filter: None
    // Copy from px, NOT from px.buffer. px is a VIEW onto the whole SFF file,
    // so indexing its underlying ArrayBuffer walks off the end of the sprite
    // and paints neighboring file bytes as palette indices - which is how a
    // short or empty decode became green/magenta noise instead of a visibly
    // blank frame. subarray is bounds-clamped; the buffer arithmetic was not.
    raw.set(px.subarray(y * w, y * w + w), y * (w + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 3;  // color type: palette
  const plte = Buffer.alloc(768);
  for (let i = 0; i < 256; i++) {
    plte[i * 3] = palRGB[i * 3] || 0;
    plte[i * 3 + 1] = palRGB[i * 3 + 1] || 0;
    plte[i * 3 + 2] = palRGB[i * 3 + 2] || 0;
  }
  const trns = alpha ? trnsFromAlpha(alpha) : Buffer.from([0]); // index 0 transparent
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('PLTE', plte),
    ...(trns ? [chunk('tRNS', trns)] : []),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// The shortest tRNS that states `alpha`, or null when every entry is opaque.
function trnsFromAlpha(alpha) {
  const at = (i) => {
    const v = alpha[i];
    if (typeof v !== 'number' || !Number.isFinite(v)) return 255;
    return v <= 0 ? 0 : v >= 255 ? 255 : Math.round(v);
  };
  let len = 0;
  for (let i = 0; i < 256; i++) if (at(i) !== 255) len = i + 1;
  if (!len) return null;
  const t = Buffer.alloc(len);
  for (let i = 0; i < len; i++) t[i] = at(i);
  return t;
}

// Truecolor PNG: color type 6 (RGBA), 8 bits per channel, straight alpha,
// filter None on every scanline. For the frames a palette cannot hold - a
// blended or truecolor frame exported as a still - where a 256-entry table
// with one transparent index would lose the partial alpha.
// rgba: four bytes per pixel, w*h pixels (any Uint8Array, Buffer included).
function encodeRgbaPng(rgba, w, h) {
  const stride = w * 4;
  if (!rgba || rgba.length < stride * h) {
    throw new Error('encodeRgbaPng: need ' + (stride * h) + ' bytes of RGBA for ' + w + 'x' + h);
  }
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0; // filter: None
    raw.set(rgba.subarray(y * stride, y * stride + stride), y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}






// Returns a complete PNG buffer for group,index, decoding whatever encoding
// the sprite happens to use - or null if the sprite is missing/undecodable.
//
// PALETTE ALPHA. When the palette drawing the sprite has an alpha of its own
// (an SFF v2.01 node, reported by the core as r.alpha), the PNG's tRNS states
// it, so a 128 entry comes out half see-through the way the engine draws it,
// and an entry stored transparent is transparent. Only the entries the
// sprite's pixels actually use are written (drawnAlpha below): a sprite whose
// used colors are index 0 transparent and the rest opaque keeps the exact
// bytes it always had, even when its palette has partial alpha elsewhere.
function spritePng(sff, group, index) {
  const r = core.decodeSprite(sff, group, index);
  if (!r) return null;
  if (r.kind === 'indexed') {
    // Index 0 = 0 and every other entry 255 writes the same 1-byte tRNS as
    // no table at all, so only a sprite that really draws another alpha
    // changes.
    return r.alpha
      ? encodeIndexedPng(r.px, r.w, r.h, r.pal, drawnAlpha(r.alpha, r.px))
      : encodeIndexedPng(r.px, r.w, r.h, r.pal);
  }
  // An embedded PNG: swap in the SFF palette when the core says to, then mark
  // index 0 transparent. MUGEN treats index 0 as transparent but the embedded
  // PNG8 usually declares no tRNS, which is why a raw extract shows a
  // magenta/green background.
  let png = r.bytes;
  if (r.pal) png = replacePalette(png, r.pal);
  if (r.alpha) {
    const trns = pngPaletteAlpha(png, r.alpha);
    if (trns) return setTrns(png, trns);
  }
  return makeIndexZeroTransparent(png, r.w, r.h);
}


// ---------------------------------------------------------------------------
// PNG surgery: MUGEN treats palette index 0 as transparent, but the embedded
// PNG8 usually declares no transparency - which is why a raw extract shows a
// magenta/green background. Inject (or patch) a tRNS chunk marking index 0
// fully transparent. Pure chunk-level editing: no image decode.

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = c ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  out.set(data, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), 8 + data.length);
  return out;
}

// Swap a palettized PNG's PLTE for the supplied 768-byte RGB table, leaving
// every other chunk (including the index data) untouched.
function replacePalette(png, palRGB) {
  try {
    const out = [];
    let p = 8;
    let swapped = false;
    while (p + 8 <= png.length) {
      const len = png.readUInt32BE(p);
      const type = png.toString('ascii', p + 4, p + 8);
      if (type === 'PLTE') {
        out.push(chunk('PLTE', palRGB.slice(0, 768)));
        swapped = true;
      } else {
        out.push(png.slice(p, p + 12 + len));
      }
      p += 12 + len;
      if (type === 'IEND') break;
    }
    if (!swapped) return png;
    return Buffer.concat([png.slice(0, 8), ...out]);
  } catch (e) {
    return png;
  }
}

function makeIndexZeroTransparent(png, w, h) {
  try {
    const chunks = [];
    let p = 8; // past signature
    let colorType = -1;
    let hasTrns = false;
    while (p + 8 <= png.length) {
      const len = png.readUInt32BE(p);
      const type = png.toString('ascii', p + 4, p + 8);
      const whole = png.slice(p, p + 12 + len);
      if (type === 'IHDR') colorType = png[p + 8 + 9];
      if (type === 'tRNS') {
        hasTrns = true;
        // Patch the existing table: index 0 -> alpha 0, keep the rest.
        const data = Buffer.from(png.slice(p + 8, p + 8 + len));
        if (data.length > 0) data[0] = 0;
        chunks.push(chunk('tRNS', data));
        p += 12 + len;
        continue;
      }
      chunks.push(whole);
      p += 12 + len;
      if (type === 'IEND') break;
    }
    if (colorType !== 3) return png; // not palettized: leave it alone
    if (!hasTrns) {
      // Insert a 1-byte tRNS (index 0 transparent) right before IDAT.
      const idx = chunks.findIndex((c) => c.toString('ascii', 4, 8) === 'IDAT');
      if (idx < 0) return png;
      chunks.splice(idx, 0, chunk('tRNS', Buffer.from([0])));
    }
    return Buffer.concat([png.slice(0, 8), ...chunks]);
  } catch (e) {
    return png; // never let cosmetics break the extract
  }
}

// The alpha table a sprite's PNG should state, given the palette's table and
// the pixels. An entry no pixel uses is left at 255 (index 0 at 0), so the
// tRNS reaches only as far as the last color the sprite really draws with an
// alpha of its own, and a sprite that draws none states exactly what the
// PNG always said: index 0 transparent, the rest opaque.
function drawnAlpha(alpha, px) {
  const used = new Uint8Array(256);
  for (let i = 0; i < px.length; i++) used[px[i]] = 1;
  const t = new Uint8Array(256).fill(255);
  t[0] = used[0] ? alpha[0] : 0;
  for (let i = 1; i < 256; i++) if (used[i]) t[i] = alpha[i];
  return t;
}

// For an embedded PNG8: the tRNS bytes that state `alpha` for the indices its
// pixels use - shortest form, empty when every used entry is opaque - or null
// when that comes to index 0 transparent and the rest opaque (then the usual
// 1-byte patch is exact and the bytes stay as they were). If the index map
// cannot be read, every entry counts as used.
function pngPaletteAlpha(png, alpha) {
  let px = null;
  try {
    const img = pngDecode.decodePng(png);
    if (img.kind === 'indexed') px = img.px;
  } catch (e) { px = null; }
  const t = drawnAlpha(alpha, px || Uint8Array.from({ length: 256 }, (_, i) => i));
  let len = 0;
  for (let i = 0; i < 256; i++) if (t[i] !== 255) len = i + 1;
  if (len === 1 && t[0] === 0) return null;
  return Buffer.from(t.subarray(0, len));
}

// Put `trns` in as the PNG's only tRNS, right before the first IDAT (after
// PLTE, where the format requires it); an empty `trns` leaves the PNG with no
// tRNS at all, fully opaque. Any tRNS the file carried goes: for an SFF
// format-10 sprite the engine ignores the PNG's own transparency along with
// its PLTE. A PNG that is not palettized comes back untouched.
function setTrns(png, trns) {
  try {
    const chunks = [];
    let p = 8;
    let colorType = -1;
    while (p + 8 <= png.length) {
      const len = png.readUInt32BE(p);
      const type = png.toString('ascii', p + 4, p + 8);
      if (type === 'IHDR') colorType = png[p + 8 + 9];
      if (type !== 'tRNS') chunks.push(png.slice(p, p + 12 + len));
      p += 12 + len;
      if (type === 'IEND') break;
    }
    if (colorType !== 3) return png;
    const idx = chunks.findIndex((c) => c.toString('ascii', 4, 8) === 'IDAT');
    if (idx < 0) return png;
    if (trns.length) chunks.splice(idx, 0, chunk('tRNS', Buffer.from(trns)));
    return Buffer.concat([png.slice(0, 8), ...chunks]);
  } catch (e) {
    return png;
  }
}


module.exports = { spritePixels, decodePng: pngDecode.decodePng, isBlank: pngDecode.isBlank,
  parseDef, chunk, crc32, decodeSprite, encodeIndexedPng, encodeRgbaPng, lz5Decode, makeIndexZeroTransparent, readAct, readSff, replacePalette, rle5Decode, rle8Decode, rlePcxDecode, spriteGeom, spritePng, v1Sprite, v2Palette, v2PaletteAt };
