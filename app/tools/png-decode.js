// png-decode.js - PNG to pixels, in Node, with no dependencies.
//
// WHY THIS EXISTS. `decodeSprite` never decoded SFFv2 PNG sprites - it returned
// `{kind:'png', bytes}` and let the BROWSER decode them, which is the right call
// in the UI and useless everywhere else. Anything headless (the sprite audit,
// any future size tooling) got a result with no `px` field and had to treat it
// as a failure. That silently excluded 11,765 of this build's 38,496 sprites,
// whole characters at a time.
//
// WHAT THE ENGINE DOES WITH THE RESULT, because it decides the output shape
// (image.go:1294-1322):
//
//   * FORMAT 10 takes ONLY THE INDEX MAP. `png.Decode` then
//     `pi, ok := img.(*image.Paletted); if ok { px = pi.Pix }` - the PNG's own
//     PLTE is thrown away and the sprite is colored from the SFF's palette
//     table instead. Note the `if ok`: a fmt-10 sprite that is NOT a paletted
//     PNG leaves px unset and draws as nothing. So "indexed" is not a detail of
//     the file, it is the contract.
//   * FORMATS 11 AND 12 go to RGBA and `SetRaw(..., 32)` with `isRaw = true` -
//     no palette is involved at all.
//
// So color type 3 returns an INDEX MAP and everything else returns RGBA, which
// is exactly the split the engine makes.
//
// WHAT THIS BUILD ACTUALLY CONTAINS (surveyed before writing a line): all 11,765
// PNG sprites are fmt 10, color type 3, 8-bit, non-interlaced, no tRNS. About
// 1,500 carry MULTIPLE IDAT chunks and 2,896 carry sBIT/pHYs, so chunk
// concatenation and skipping unknown chunks are the two things the real data
// forces. The rest of the baseline spec - bit depths 1/2/4/16, color types
// 0/2/4/6, Adam7 - is implemented because Studio imports arbitrary characters
// and a decoder that only handles today's roster is a trap, but be aware that
// the roster exercises ONE path. The others are covered by generated fixtures
// (see tools/test-png-decode.js), not by field data.
'use strict';
const zlib = require('zlib');

const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
// Samples per pixel, by color type. 1 and 5 are not PNG color types.
const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

// Adam7. Seven passes, each a sparse grid over the image; every pass is
// filtered independently and has its own scanline width, which is the part that
// catches people out - a pass is not a crop of the image, it is its own tiny
// image that happens to scatter into the big one.
const A7_X0 = [0, 4, 0, 2, 0, 1, 0];
const A7_Y0 = [0, 0, 4, 0, 2, 0, 1];
const A7_DX = [8, 8, 4, 4, 2, 2, 1];
const A7_DY = [8, 8, 8, 4, 4, 2, 2];

function paeth(a, b, c) {
  // a = left, b = above, c = upper-left.
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  // Ties go to `a` then `b` - the spec fixes this order and getting it wrong
  // produces an image that is subtly wrong only on some rows, which is far
  // harder to spot than one that is wrong everywhere.
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

// Undo the per-scanline filter, in place, over a buffer laid out as
// [filterByte, ...scanline] repeated. `bpp` is the filter's notion of "one
// pixel": bytes per pixel rounded UP to 1, which for sub-byte depths is 1.
function unfilter(data, height, lineBytes, bpp) {
  const out = Buffer.alloc(height * lineBytes);
  let src = 0;
  for (let y = 0; y < height; y++) {
    const ft = data[src++];
    const row = y * lineBytes;
    const prev = row - lineBytes;
    for (let x = 0; x < lineBytes; x++) {
      const raw = data[src + x];
      const left = x >= bpp ? out[row + x - bpp] : 0;
      const up = y > 0 ? out[prev + x] : 0;
      const ul = (y > 0 && x >= bpp) ? out[prev + x - bpp] : 0;
      let v;
      switch (ft) {
        case 0: v = raw; break;
        case 1: v = raw + left; break;
        case 2: v = raw + up; break;
        // Average uses FLOOR of the mean, and the sum can reach 510, so the
        // shift has to happen before the &255 truncation.
        case 3: v = raw + ((left + up) >> 1); break;
        case 4: v = raw + paeth(left, up, ul); break;
        default: throw new Error('bad PNG filter type ' + ft + ' on row ' + y);
      }
      out[row + x] = v & 255;
    }
    src += lineBytes;
  }
  return out;
}

// Pull one sample of `depth` bits from a packed scanline.
function sampleAt(row, i, depth) {
  if (depth === 8) return row[i];
  if (depth === 16) return row[i * 2];          // high byte; 16 -> 8
  const per = 8 / depth;                         // 8, 4 or 2 samples per byte
  const b = row[Math.floor(i / per)];
  const shift = 8 - depth * ((i % per) + 1);
  return (b >> shift) & ((1 << depth) - 1);
}

function parseChunks(buf) {
  for (let i = 0; i < 8; i++) {
    if (buf[i] !== SIG[i]) throw new Error('not a PNG (bad signature)');
  }
  const out = { idat: [], pal: null, trns: null, ihdr: null };
  let p = 8;
  while (p + 8 <= buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('latin1', p + 4, p + 8);
    const start = p + 8;
    if (start + len > buf.length) break;         // truncated tail, keep what we have
    if (type === 'IHDR') {
      out.ihdr = {
        width: buf.readUInt32BE(start),
        height: buf.readUInt32BE(start + 4),
        depth: buf[start + 8],
        colorType: buf[start + 9],
        compression: buf[start + 10],
        filter: buf[start + 11],
        interlace: buf[start + 12],
      };
    } else if (type === 'PLTE') {
      out.pal = buf.subarray(start, start + len);
    } else if (type === 'tRNS') {
      out.trns = buf.subarray(start, start + len);
    } else if (type === 'IDAT') {
      // MULTIPLE IDATs ARE NORMAL - about 1,500 sprites in this build have
      // them. The compressed stream is the CONCATENATION; inflating them
      // separately gives garbage after the first.
      out.idat.push(buf.subarray(start, start + len));
    } else if (type === 'IEND') {
      break;
    }
    p = start + len + 4;                         // + CRC
  }
  if (!out.ihdr) throw new Error('PNG has no IHDR');
  return out;
}

// Turn one pass's unfiltered scanlines into either indices or RGBA, writing
// into the full-size destination at that pass's stride.
function emit(dst, meta, rows, pass, w, h) {
  const { width, depth, colorType, pal, trns, indexed } = meta;
  const x0 = pass < 0 ? 0 : A7_X0[pass], y0 = pass < 0 ? 0 : A7_Y0[pass];
  const dx = pass < 0 ? 1 : A7_DX[pass], dy = pass < 0 ? 1 : A7_DY[pass];
  const ch = CHANNELS[colorType];
  const lineBytes = Math.ceil(depth * ch * w / 8);

  for (let y = 0; y < h; y++) {
    const row = rows.subarray(y * lineBytes, (y + 1) * lineBytes);
    const dy2 = y0 + y * dy;
    // The tRNS color key is matched against the WHOLE sample. sampleAt keeps
    // only the high byte of a 16-bit sample, so a 16-bit key needs both bytes
    // here - Go compares all 16 bits (reader.go, cbG16/cbTC16 with
    // useTransparent) - or a keyed pixel stays opaque.
    const keyAt = (i) => (depth === 16 ? (row[i * 2] << 8) | row[i * 2 + 1] : sampleAt(row, i, depth));
    for (let x = 0; x < w; x++) {
      const dx2 = x0 + x * dx;
      if (indexed) {
        dst[dy2 * width + dx2] = sampleAt(row, x, depth);
        continue;
      }
      const o = (dy2 * width + dx2) * 4;
      let r, g, b, a = 255;
      if (colorType === 0 || colorType === 4) {
        const s = sampleAt(row, x * ch, depth);
        // Sub-8-bit grayscale is a FRACTION of max, not a raw byte: 1-bit
        // white is 1 and must become 255, not 1.
        const v = depth < 8 ? Math.round(s * 255 / ((1 << depth) - 1)) : s;
        r = g = b = v;
        if (colorType === 4) a = sampleAt(row, x * ch + 1, depth);
        else if (trns && trns.length >= 2 && keyAt(x * ch) === trns.readUInt16BE(0)) a = 0;
      } else {
        r = sampleAt(row, x * ch, depth);
        g = sampleAt(row, x * ch + 1, depth);
        b = sampleAt(row, x * ch + 2, depth);
        if (colorType === 6) a = sampleAt(row, x * ch + 3, depth);
        else if (trns && trns.length >= 6
          && keyAt(x * ch) === trns.readUInt16BE(0) && keyAt(x * ch + 1) === trns.readUInt16BE(2)
          && keyAt(x * ch + 2) === trns.readUInt16BE(4)) a = 0;
      }
      if (meta.premultiply) { r = premul(r, a); g = premul(g, a); b = premul(b, a); }
      dst[o] = r; dst[o + 1] = g; dst[o + 2] = b; dst[o + 3] = a;
    }
  }
}

// Go's premultiply, reproduced exactly rather than approximated.
//
// color.NRGBA.RGBA() widens each sample to 16 bits (`r |= r << 8`, i.e. x257),
// multiplies by alpha, divides by 255; draw.Draw then stores the high byte. The
// obvious shortcut `round(v * a / 255)` agrees on almost every input, which is
// precisely what makes it dangerous - it would disagree on a handful and the
// test would go red for a reason nobody could see.
const premul = (v, a) => (((v | (v << 8)) * a / 255) | 0) >> 8;

// decodePng(buffer, opts) -> { kind, w, h, px, pal, trns, depth, colorType, interlace }
//
//   kind 'indexed' : px is one BYTE PER PIXEL, the palette index. This is
//                    color type 3 only, and it is what SFF format 10 wants.
//   kind 'rgba'    : px is four bytes per pixel.
//
// opts.premultiply - ENGINE PARITY FOR FORMATS 11 AND 12, off by default.
//
// Go's *image.RGBA is ALPHA-PREMULTIPLIED. A PNG with an alpha channel decodes
// to *image.NRGBA, so the engine's `draw.Draw(rgba, ..., draw.Src)` at
// image.go:1318 premultiplies on the way in, and SetRaw stores that. A pixel
// that is 100%-transparent bright red is (255,0,0,0) in the FILE and (0,0,0,0)
// in the ENGINE.
//
// The default is the file's own content - straight alpha - because that is what
// a function called decodePng should hand back and what any other consumer will
// expect. Pass premultiply:true when the question is "what does the engine
// hold", which is what tools/test-png-decode.js asks.
function decodePng(buf, opts) {
  opts = opts || {};
  const { ihdr, pal, trns, idat } = parseChunks(buf);
  const { width, height, depth, colorType, compression, filter, interlace } = ihdr;

  if (compression !== 0) throw new Error('unknown PNG compression method ' + compression);
  if (filter !== 0) throw new Error('unknown PNG filter method ' + filter);
  if (CHANNELS[colorType] === undefined) throw new Error('bad PNG color type ' + colorType);
  if (![1, 2, 4, 8, 16].includes(depth)) throw new Error('bad PNG bit depth ' + depth);
  if (colorType === 3 && !pal) throw new Error('indexed PNG with no PLTE');
  if (!width || !height) throw new Error('PNG has zero extent');
  if (!idat.length) throw new Error('PNG has no IDAT');

  // Z_SYNC_FLUSH rather than the default: a few MUGEN-era PNGs carry a stream
  // that does not terminate cleanly, and the strict path throws away an image
  // that is entirely readable up to that point.
  const raw = zlib.inflateSync(Buffer.concat(idat),
    { finishFlush: zlib.constants.Z_SYNC_FLUSH });

  const indexed = colorType === 3;
  const ch = CHANNELS[colorType];
  const bpp = Math.max(1, Math.ceil(depth * ch / 8));
  const meta = { width, depth, colorType, pal, trns, indexed,
    premultiply: !!opts.premultiply };
  const dst = indexed ? Buffer.alloc(width * height) : Buffer.alloc(width * height * 4);

  if (!interlace) {
    const lineBytes = Math.ceil(depth * ch * width / 8);
    const need = (lineBytes + 1) * height;
    if (raw.length < need) {
      throw new Error('PNG data short: have ' + raw.length + ' need ' + need);
    }
    emit(dst, meta, unfilter(raw, height, lineBytes, bpp), -1, width, height);
  } else {
    let off = 0;
    for (let pass = 0; pass < 7; pass++) {
      // Pass extent: how many of this pass's columns/rows land inside the image.
      const pw = Math.ceil(Math.max(0, width - A7_X0[pass]) / A7_DX[pass]);
      const ph = Math.ceil(Math.max(0, height - A7_Y0[pass]) / A7_DY[pass]);
      if (!pw || !ph) continue;                  // empty pass: consumes NOTHING
      const lineBytes = Math.ceil(depth * ch * pw / 8);
      const chunk = raw.subarray(off, off + (lineBytes + 1) * ph);
      if (chunk.length < (lineBytes + 1) * ph) throw new Error('PNG interlace data short');
      emit(dst, meta, unfilter(chunk, ph, lineBytes, bpp), pass, pw, ph);
      off += (lineBytes + 1) * ph;
    }
  }

  return {
    kind: indexed ? 'indexed' : 'rgba',
    w: width, h: height, px: dst,
    pal: pal ? Array.from(pal) : null,
    trns: trns ? Array.from(trns) : null,
    depth, colorType, interlace,
  };
}

// Is every pixel invisible?
//
// The two kinds answer this differently and conflating them is the bug waiting
// to happen: an indexed sprite is blank when every INDEX is 0 (MUGEN's
// transparent slot), an RGBA one when every ALPHA is 0. An all-zero RGB with
// alpha 255 is a solid black sprite, not a blank one.
function isBlank(img) {
  if (!img || !img.px || !img.px.length) return false;
  if (img.kind === 'indexed') return img.px.every((v) => v === 0);
  for (let i = 3; i < img.px.length; i += 4) if (img.px[i] !== 0) return false;
  return true;
}

module.exports = { decodePng, isBlank, paeth, sampleAt };
