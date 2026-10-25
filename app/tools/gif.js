// Palettized PNG -> animated GIF, with no dependencies.
//
// WHY THIS EXISTS AT ALL. The leaderboard art extractor already produces
// exactly what GIF wants: one byte per pixel, a 256-entry RGB palette, and
// index 0 meaning transparent. GIF is an indexed 256-color format with a
// single transparent index. So turning a win-pose animation into a GIF is a
// container change, not a re-encode - there is no quantization step and nothing
// to lose. A GIF built this way is pixel-identical to the frames it came from.
//
// WHY IT IS CHEAP. The frames are written once, when a build is exported. The
// GIF is written beside them at the same moment. Nothing renders per request
// later; anything consuming it just fetches a static file that happens to
// animate. This is the whole reason animation is affordable here when
// "render it on demand" would not be.
//
// Two pieces are needed and neither exists in Node's standard library:
//   * a decoder for color-type-3 PNG (the extractor passes some sprites
//     through untouched from the SFF, so they are not all ours to begin with)
//   * a GIF89a writer, which means LZW
// Both are small and are implemented below. zlib for the PNG side comes free.
//
// TWO CASES WHERE IT STOPS BEING A PURE CONTAINER CHANGE, both opt-in:
//   * An action whose sprites together use more than 256 colors. Every frame
//     still fits 256 on its own, so a frame can carry its OWN color table (a
//     GIF "local color table") and nothing is quantized - the file is simply
//     768 bytes bigger per such frame. Measured on the two Main actions that
//     used to be refused: 272 and 4,722 distinct colors, both written exactly.
//   * A truecolor sprite (SFF v2 formats 11/12, a PNG that is not paletted).
//     GIF cannot hold it, so quantizeRgba reduces it - exactly when it has 255
//     colors or fewer, by a deterministic median cut otherwise - and the caller
//     writes the result with a local table.
//
// PRIVATE BUILD ONLY. make-kit.js bans this file and modlib.js reaches it only
// through its lazy gifLib(); anything new that is specific to GIF or
// leaderboard art export belongs in here so those guards cover it unchanged.

'use strict';
const zlib = require('zlib');
// The general PNG decoder (every color type, depth and Adam7). It ships in the
// kit on its own merits; requiring it from here adds nothing to the kit.
const pngDecode = require('./png-decode.js');

// ---------------------------------------------------------------------------
// PNG (color type 3 only) -> { px, w, h, pal, trns, alpha }

function readChunks(buf) {
  const out = [];
  let p = 8; // skip signature
  while (p + 8 <= buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('latin1', p + 4, p + 8);
    out.push({ type, data: buf.slice(p + 8, p + 8 + len) });
    p += 12 + len; // len + type + data + crc
    if (type === 'IEND') break;
  }
  return out;
}

// PNG scanline filters, per the spec. Every row is filtered independently and
// references the row above, so this has to run top to bottom in one pass.
function unfilter(raw, w, h, bpp) {
  const stride = w * bpp;
  const out = Buffer.alloc(stride * h);
  let pos = 0;
  for (let y = 0; y < h; y++) {
    const ft = raw[pos++];
    const line = raw.slice(pos, pos + stride);
    pos += stride;
    const cur = out.slice(y * stride, (y + 1) * stride);
    line.copy(cur);
    const up = y > 0 ? out.slice((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0;
      const b = up ? up[i] : 0;
      const c = up && i >= bpp ? up[i - bpp] : 0;
      let add = 0;
      if (ft === 1) add = a;
      else if (ft === 2) add = b;
      else if (ft === 3) add = (a + b) >> 1;
      else if (ft === 4) {
        const pp = a + b - c;
        const pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
        add = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      if (ft !== 0) cur[i] = (cur[i] + add) & 0xff;
    }
  }
  return out;
}

// The tRNS chunk as a full 256-entry table. PNG lets tRNS stop early, and every
// entry it does not reach is opaque (PNG spec 11.3.2.1); with no tRNS at all
// the whole palette is opaque.
function alphaTable(trnsBytes) {
  const alpha = new Uint8Array(256).fill(255);
  if (trnsBytes) {
    for (let i = 0; i < trnsBytes.length && i < 256; i++) alpha[i] = trnsBytes[i];
  }
  return alpha;
}

// The old field: the FIRST fully transparent index, or -1. Kept exactly as it
// was because callers treat it as "the" transparent index; `alpha` is the
// complete answer for anything that needs partial transparency.
function firstClearIndex(trnsBytes) {
  if (!trnsBytes) return -1;
  for (let i = 0; i < trnsBytes.length; i++) {
    if (trnsBytes[i] === 0) return i;
  }
  return -1;
}

// Returns null for anything that is not a palettized PNG, so callers can fall
// back rather than crash on an unexpected sprite.
//
// `alpha` is the per-entry alpha from tRNS (Uint8Array(256), 255 where tRNS
// says nothing). The Studio's sprite PNGs carry the engine's palette alpha in
// that chunk, so this is where a translucent SFF v2.01 palette entry becomes
// visible to the GIF composer.
function decodeIndexedPng(buf) {
  if (!buf || buf.length < 8 || buf[0] !== 0x89 || buf[1] !== 0x50) return null;
  const chunks = readChunks(buf);
  const ihdr = chunks.find((c) => c.type === 'IHDR');
  if (!ihdr) return null;
  const w = ihdr.data.readUInt32BE(0);
  const h = ihdr.data.readUInt32BE(4);
  const depth = ihdr.data[8];
  const color = ihdr.data[9];
  const interlace = ihdr.data[12];
  if (color !== 3) return null;
  // Palettized but packed below 8 bits, or Adam7-interlaced: the engine's Go
  // decoder hands those back as *image.Paletted like any other (image.go:1298),
  // so they are sprites too. The general decoder unpacks them to one byte per
  // pixel; the fast path below stays the one every sprite in the survey takes.
  if (depth !== 8 || interlace !== 0) return decodeIndexedViaGeneral(buf);

  const plte = chunks.find((c) => c.type === 'PLTE');
  if (!plte) return null;
  const pal = Buffer.alloc(768);
  plte.data.copy(pal, 0, 0, Math.min(768, plte.data.length));

  const trnsChunk = chunks.find((c) => c.type === 'tRNS');
  const trnsBytes = trnsChunk ? trnsChunk.data : null;
  const trns = firstClearIndex(trnsBytes);

  const idat = Buffer.concat(chunks.filter((c) => c.type === 'IDAT').map((c) => c.data));
  let raw;
  try {
    raw = zlib.inflateSync(idat);
  } catch {
    return null;
  }
  if (raw.length < (w + 1) * h) return null;
  const px = unfilter(raw, w, h, 1);
  return { px, w, h, pal, trns, alpha: alphaTable(trnsBytes) };
}

function decodeIndexedViaGeneral(buf) {
  let img;
  try { img = pngDecode.decodePng(buf); } catch (e) { return null; }
  if (!img || img.kind !== 'indexed' || !img.pal) return null;
  const pal = Buffer.alloc(768);
  Buffer.from(img.pal).copy(pal, 0, 0, Math.min(768, img.pal.length));
  return { px: img.px, w: img.w, h: img.h, pal,
    trns: firstClearIndex(img.trns), alpha: alphaTable(img.trns) };
}

// ANY PNG -> { w, h, rgba } with rgba four bytes per pixel, STRAIGHT alpha (the
// file's own values, not premultiplied). Null when it cannot be decoded.
//
// For truecolor sprites (SFF v2 formats 11 and 12) and anything else that is
// not an index map. A paletted PNG is expanded through its PLTE and tRNS; an
// index past the end of PLTE comes out opaque black, which is what Go's
// image/png does with an out-of-range index and so what the engine would draw.
function decodeAnyPng(buf) {
  if (!buf || buf.length < 8) return null;
  let img;
  try { img = pngDecode.decodePng(buf); } catch (e) { return null; }
  if (!img) return null;
  const n = img.w * img.h;
  if (img.kind === 'rgba') return { w: img.w, h: img.h, rgba: img.px };
  const pal = img.pal || [];
  const alpha = alphaTable(img.trns);
  const rgba = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const v = img.px[i], o = i * 4;
    if (v * 3 + 2 < pal.length) {
      rgba[o] = pal[v * 3]; rgba[o + 1] = pal[v * 3 + 1]; rgba[o + 2] = pal[v * 3 + 2];
    }
    rgba[o + 3] = alpha[v];
  }
  return { w: img.w, h: img.h, rgba };
}

// ---------------------------------------------------------------------------
// Truecolor -> 255 colors plus a transparent index

/**
 * quantizeRgba(rgba, w, h, opts) -> { px, pal, alpha, colors, exact }
 *
 *   px     Uint8Array(w*h), one palette index per pixel.
 *   pal    768-byte RGB table. Index 0 is the transparent slot, left black.
 *   alpha  Uint8Array(256): 0 for index 0, 255 for the rest - what
 *          encodeIndexedPng's alpha argument wants for a still of the frame.
 *   colors how many of indices 1..255 are in use.
 *   exact  true when every visible pixel kept its exact color.
 *
 * opts.alphaCut  (default 128) a pixel whose alpha is BELOW this is transparent
 *                (index 0); everything else is drawn opaque in its own color.
 *                GIF has one bit of transparency, so something has to decide.
 * opts.maxColors (default 255, 1..255) the most visible colors to use. A caller
 *                that needs spare indices afterward (collision box overlays)
 *                lowers it to keep them free.
 *
 * INDEX 0 IS NEVER A VISIBLE COLOR. The GIF's transparent index is 0, as it is
 * for every MUGEN sprite, so the visible colors live on 1..255.
 *
 * EXACT WHEN IT CAN BE. Most truecolor sprites use few colors; when the visible
 * pixels have maxColors distinct colors or fewer, each gets its own entry, in
 * order of first appearance, and the frame is lossless.
 *
 * DETERMINISTIC MEDIAN CUT OTHERWISE, no dithering. The distinct colors, weighted
 * by how many pixels use them, are split box by box: the box to split is the
 * one with the largest (widest channel range) x sqrt(pixel count), cut at the
 * weighted median of that channel; each box becomes the pixel-weighted mean of
 * its colors. Every sort breaks ties on the color itself, so the same picture
 * always produces the same palette and the same bytes - an animation whose
 * frames repeat stays mergeable frame to frame. No dithering because the GIF is
 * a preview of pixel art: a dither pattern crawling across a still pose reads as
 * noise, while a slightly flattened gradient does not.
 */
function quantizeRgba(rgba, w, h, opts) {
  opts = opts || {};
  const n = w * h;
  if (!(n >= 0) || !rgba || rgba.length < n * 4) {
    throw new Error('quantizeRgba: need ' + (n * 4) + ' bytes of RGBA for ' + w + 'x' + h);
  }
  const cut = Number.isFinite(opts.alphaCut) ? opts.alphaCut : 128;
  let maxColors = Number.isFinite(opts.maxColors) ? Math.floor(opts.maxColors) : 255;
  if (maxColors < 1) maxColors = 1;
  if (maxColors > 255) maxColors = 255;

  const px = new Uint8Array(n);
  const pal = Buffer.alloc(768);
  const alpha = new Uint8Array(256).fill(255);
  alpha[0] = 0;

  // Distinct visible colors in order of first appearance, with pixel counts.
  const slotOf = new Map();
  const keys = [];
  const counts = [];
  const pxKey = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    if (rgba[o + 3] < cut) continue;
    const key = (rgba[o] << 16) | (rgba[o + 1] << 8) | rgba[o + 2];
    let k = slotOf.get(key);
    if (k === undefined) { k = keys.length; slotOf.set(key, k); keys.push(key); counts.push(0); }
    counts[k]++;
    pxKey[i] = k;
  }

  const D = keys.length;
  const entryOf = new Uint8Array(D);   // distinct color -> palette index
  let colors;
  const exact = D <= maxColors;
  if (exact) {
    for (let k = 0; k < D; k++) {
      entryOf[k] = k + 1;
      pal[(k + 1) * 3] = keys[k] >> 16;
      pal[(k + 1) * 3 + 1] = (keys[k] >> 8) & 255;
      pal[(k + 1) * 3 + 2] = keys[k] & 255;
    }
    colors = D;
  } else {
    const chan = (key, c) => (c === 0 ? key >> 16 : c === 1 ? (key >> 8) & 255 : key & 255);
    const makeBox = (items) => {
      let pop = 0;
      const lo = [255, 255, 255], hi = [0, 0, 0];
      for (const k of items) {
        pop += counts[k];
        for (let c = 0; c < 3; c++) {
          const v = chan(keys[k], c);
          if (v < lo[c]) lo[c] = v;
          if (v > hi[c]) hi[c] = v;
        }
      }
      let ch = 0;
      for (let c = 1; c < 3; c++) if (hi[c] - lo[c] > hi[ch] - lo[ch]) ch = c;
      const range = hi[ch] - lo[ch];
      return { items, pop, ch, score: items.length > 1 ? range * Math.sqrt(pop) : -1 };
    };
    const all = [];
    for (let k = 0; k < D; k++) all.push(k);
    const boxes = [makeBox(all)];
    while (boxes.length < maxColors) {
      let pick = -1, best = 0;
      for (let b = 0; b < boxes.length; b++) {
        if (boxes[b].score > best) { best = boxes[b].score; pick = b; }
      }
      if (pick < 0) break;               // nothing left that can be split
      const { items, pop, ch } = boxes[pick];
      const sorted = items.slice().sort((a, b) =>
        (chan(keys[a], ch) - chan(keys[b], ch)) || (keys[a] - keys[b]));
      let acc = 0, at = 1;
      for (let j = 0; j < sorted.length - 1; j++) {
        acc += counts[sorted[j]];
        at = j + 1;
        if (acc * 2 >= pop) break;
      }
      boxes.splice(pick, 1, makeBox(sorted.slice(0, at)), makeBox(sorted.slice(at)));
    }
    boxes.forEach((box, b) => {
      let r = 0, g = 0, bl = 0;
      for (const k of box.items) {
        const c = counts[k];
        r += (keys[k] >> 16) * c; g += ((keys[k] >> 8) & 255) * c; bl += (keys[k] & 255) * c;
        entryOf[k] = b + 1;
      }
      pal[(b + 1) * 3] = Math.round(r / box.pop);
      pal[(b + 1) * 3 + 1] = Math.round(g / box.pop);
      pal[(b + 1) * 3 + 2] = Math.round(bl / box.pop);
    });
    colors = boxes.length;
  }
  for (let i = 0; i < n; i++) if (pxKey[i] >= 0) px[i] = entryOf[pxKey[i]];
  return { px, pal, alpha, colors, exact };
}

// ---------------------------------------------------------------------------
// GIF89a writer

// GIF's variant of LZW: codes grow from (minCodeSize+1) bits up to 12, then the
// table is cleared and it starts over. Output is packed LSB-first into
// sub-blocks of at most 255 bytes. This is the only genuinely fiddly part of
// the format, and it is ~60 lines.
function lzwEncode(indices, minCodeSize) {
  const clearCode = 1 << minCodeSize;
  const eoiCode = clearCode + 1;
  let codeSize = minCodeSize + 1;
  let next = eoiCode + 1;
  let dict = new Map();

  const out = [];
  let cur = 0, curBits = 0;
  const emit = (code) => {
    cur |= code << curBits;
    curBits += codeSize;
    while (curBits >= 8) {
      out.push(cur & 0xff);
      cur >>= 8;
      curBits -= 8;
    }
  };

  const resetDict = () => {
    dict = new Map();
    next = eoiCode + 1;
    codeSize = minCodeSize + 1;
  };

  emit(clearCode);
  let prefix = indices.length ? indices[0] : -1;
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const key = prefix * 4096 + k;
    const found = dict.get(key);
    if (found !== undefined) {
      prefix = found;
      continue;
    }
    emit(prefix);
    if (next < 4096) {
      dict.set(key, next++);
      // Widen only when the NEXT code would not fit - widening early corrupts
      // the stream for decoders that follow the spec exactly.
      if (next - 1 === (1 << codeSize) && codeSize < 12) codeSize++;
    } else {
      emit(clearCode);
      resetDict();
    }
    prefix = k;
  }
  if (prefix !== -1) emit(prefix);
  emit(eoiCode);
  if (curBits > 0) out.push(cur & 0xff);

  // Chop into length-prefixed sub-blocks, terminated by a zero-length block.
  const blocks = [];
  for (let i = 0; i < out.length; i += 255) {
    const slice = out.slice(i, i + 255);
    blocks.push(Buffer.from([slice.length]), Buffer.from(slice));
  }
  blocks.push(Buffer.from([0]));
  return Buffer.concat(blocks);
}

function u16(n) {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n & 0xffff, 0);
  return b;
}

// Any byte table (Buffer, Uint8Array, plain array) as exactly 768 bytes, short
// tables padded with black.
function table768(pal) {
  const t = Buffer.alloc(768);
  const src = Buffer.isBuffer(pal) ? pal : Buffer.from(pal);
  src.copy(t, 0, 0, Math.min(768, src.length));
  return t;
}

/**
 * frames: [{ px, w, h, x, y, delayMs }] - px is one byte per pixel, indices
 *         into the SHARED palette. x/y place the frame on the canvas.
 * palRGB: 768-byte RGB table shared by every frame.
 * trns:   palette index treated as transparent (-1 for none).
 *
 * Optional per-frame fields, all absent in the original call shape (which
 * writes byte-for-byte what it always did):
 *   pal     768-byte table (shorter is padded with black). The frame is written
 *           with its own LOCAL color table and its px index into that instead of
 *           palRGB. This is how an action whose frames together use more than
 *           256 colors is written without quantizing anything.
 *   trns    a number: this frame's transparent index, overriding the argument
 *           (-1 = this frame has none). Anything else = use the argument.
 *   delayCs integer centiseconds, written as given (clamped to the 16-bit
 *           field). It wins over delayMs, which keeps its old treatment -
 *           rounded to centiseconds, 67 ms when missing, never below 2 cs - for
 *           the callers that still send it. The caller that sends delayCs has
 *           done the timing itself (a running total that never pads a frame),
 *           and re-rounding here would undo that.
 *
 * palRGB may be null when EVERY frame carries its own pal: the file then has no
 * global table at all. A frame with no table of either kind is an error.
 */
function encodeGif(canvasW, canvasH, palRGB, frames, trns) {
  const hasGlobal = !!palRGB;
  if (!hasGlobal) {
    const bare = frames.findIndex((f) => !f.pal);
    if (bare >= 0) throw new Error('encodeGif: frame ' + bare + ' has no color table (no palRGB and no frame pal)');
  }
  const parts = [];
  parts.push(Buffer.from('GIF89a', 'latin1'));

  // Logical screen descriptor: global color table, 256 entries, 8 bits.
  // Without one: color resolution 8 bits, no table (0x70).
  parts.push(u16(canvasW), u16(canvasH), Buffer.from([hasGlobal ? 0xf7 : 0x70, 0, 0]));
  if (hasGlobal) parts.push(table768(palRGB));

  // Loop forever (NETSCAPE2.0 application extension).
  parts.push(
    Buffer.from([0x21, 0xff, 0x0b]),
    Buffer.from('NETSCAPE2.0', 'latin1'),
    Buffer.from([0x03, 0x01, 0x00, 0x00, 0x00])
  );

  for (const f of frames) {
    const t = typeof f.trns === 'number' ? f.trns : trns;
    // Disposal 2 (restore to background) so a transparent frame does not smear
    // the previous one behind it.
    const flags = 0x08 | (t >= 0 ? 0x01 : 0x00);
    const delayCs = Number.isFinite(f.delayCs)
      ? Math.min(65535, Math.max(0, Math.round(f.delayCs)))
      : Math.max(2, Math.round((f.delayMs || 67) / 10));
    parts.push(
      Buffer.from([0x21, 0xf9, 0x04, flags]),
      u16(delayCs),
      Buffer.from([t >= 0 ? t : 0, 0x00])
    );
    // Image descriptor. 0x87 = local color table present, 256 entries
    // (2^(7+1)); 0x00 = use the global one. Never interlaced.
    const local = f.pal ? table768(f.pal) : null;
    parts.push(
      Buffer.from([0x2c]),
      u16(f.x || 0), u16(f.y || 0), u16(f.w), u16(f.h),
      Buffer.from([local ? 0x87 : 0x00])
    );
    if (local) parts.push(local);
    const minCodeSize = 8;
    parts.push(Buffer.from([minCodeSize]));
    parts.push(lzwEncode(f.px, minCodeSize));
  }

  parts.push(Buffer.from([0x3b])); // trailer
  return Buffer.concat(parts);
}

/**
 * Build a looping GIF from already-encoded palettized PNG frames.
 *
 * Frames may differ in size and carry their own offset into a common canvas -
 * pasting them all at 0,0 would make the character jitter. Each frame is placed
 * on a full-canvas transparent bitmap so every frame is self-contained, which
 * costs a little size and removes a whole class of disposal artifacts.
 *
 * Returns null if any frame cannot be decoded, so the caller can skip the GIF
 * and still ship the PNGs.
 */
function gifFromIndexedPngs(pngFrames, canvasW, canvasH) {
  if (!pngFrames || !pngFrames.length) return null;
  const decoded = [];
  for (const f of pngFrames) {
    const d = decodeIndexedPng(f.png);
    if (!d) return null;
    decoded.push({ d, x: f.x | 0, y: f.y | 0, delayMs: f.delayMs });
  }

  // The extractor gives every frame of one animation the same palette, so the
  // first frame's table can serve as the global one. Verified rather than
  // assumed: a mismatch would silently recolor the animation.
  const pal = decoded[0].d.pal;
  for (const e of decoded) {
    if (!e.d.pal.equals(pal)) return null;
  }
  const trns = decoded[0].d.trns >= 0 ? decoded[0].d.trns : 0;

  const frames = decoded.map((e) => {
    const px = Buffer.alloc(canvasW * canvasH, trns);
    for (let row = 0; row < e.d.h; row++) {
      const ty = e.y + row;
      if (ty < 0 || ty >= canvasH) continue;
      const from = row * e.d.w;
      const width = Math.min(e.d.w, canvasW - e.x);
      if (width <= 0) continue;
      e.d.px.copy(px, ty * canvasW + e.x, from, from + width);
    }
    return { px, w: canvasW, h: canvasH, x: 0, y: 0, delayMs: e.delayMs };
  });

  return encodeGif(canvasW, canvasH, pal, frames, trns);
}

module.exports = { decodeAnyPng, decodeIndexedPng, encodeGif, gifFromIndexedPngs, lzwEncode, quantizeRgba };
