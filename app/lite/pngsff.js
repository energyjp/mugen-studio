// WebMUGEN lite - PNG sprites (packer side only).
//
// A PNG inside an SFF is already deflated, and deflated bytes do not shrink
// again. To get at the pixels the PNG has to be written back in the browser,
// and no two browsers' compressors agree on the bytes - so the lite build
// uses its OWN deflate (codecs.js deflateFixed), which writes the same bytes
// everywhere.
//
// That takes two steps, both here:
//
//   canonicalSffV2(bytes) -> the same SFF with every 8-bit palette / RGBA PNG
//     sprite written again by deflateFixed. Same pixels, same palettes, same
//     chunks, same sprite table - different (a little larger) PNG bytes, so
//     the offsets after each one move and the tables are rewritten to match.
//     sffV2Digest() of the two files must be equal or the original is kept.
//
//   tryPng(...) -> the op for one such PNG: its pixels, to be filtered and
//     deflated again on the page. Used only when that gives back the exact
//     bytes, like every other op.
'use strict';

const zlib = require('zlib');
const crypto = require('crypto');
const C = require('./codecs.js');

const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const be32 = (b, o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;

function adler32(b) {
  let a = 1, s = 0;
  for (let i = 0; i < b.length;) {
    const stop = Math.min(b.length, i + 3800);
    for (; i < stop; i++) { a += b[i]; s += a; }
    a %= 65521; s %= 65521;
  }
  return ((s << 16) | a) >>> 0;
}

// The chunks of the PNG at b[start..end). null when it is not one this module handles.
function parsePng(b, start, end) {
  if (end - start < 57 || be32(b, start) !== 0x89504E47 || be32(b, start + 4) !== 0x0D0A1A0A) return null;
  let q = start + 8;
  let ihdr = null, firstIdat = -1, afterIdat = -1, sawEnd = false;
  const idat = [], otherHash = crypto.createHash('sha1');
  while (q + 12 <= end) {
    const len = be32(b, q), type = b.toString('latin1', q + 4, q + 8);
    if (q + 12 + len > end) return null;
    if (type === 'IHDR') ihdr = { w: be32(b, q + 8), h: be32(b, q + 12), bd: b[q + 16], ct: b[q + 17], il: b[q + 20] };
    if (type === 'IDAT') {
      if (afterIdat >= 0 && afterIdat !== q) return null;        // IDATs must be one run
      if (firstIdat < 0) firstIdat = q;
      idat.push(b.subarray(q + 8, q + 8 + len));
      afterIdat = q + 12 + len;
    } else otherHash.update(b.subarray(q, q + 12 + len));
    q += 12 + len;
    if (type === 'IEND') { sawEnd = true; break; }
  }
  if (!ihdr || firstIdat < 0 || !sawEnd) return null;
  if (ihdr.il !== 0 || ihdr.bd !== 8 || !(ihdr.ct === 3 || ihdr.ct === 6)) return null;
  const bpp = ihdr.ct === 3 ? 1 : 4;
  return { ihdr, bpp, rowBytes: ihdr.w * bpp, firstIdat, afterIdat, idat, pngEnd: q, otherHash };
}

// filtered scanlines -> pixels. Returns { raw, filter } where filter is the
// one filter type every row used, or -1 when rows differ.
function unfilter(d, rowBytes, h, bpp) {
  if (d.length !== (rowBytes + 1) * h) return null;
  const o = new Uint8Array(rowBytes * h);
  let p = 0, only = -2;
  for (let y = 0; y < h; y++) {
    const f = d[p++];
    if (f > 4) return null;
    only = only === -2 ? f : (only === f ? f : -1);
    const ro = y * rowBytes;
    for (let x = 0; x < rowBytes; x++) {
      const a = x >= bpp ? o[ro + x - bpp] : 0, b = y ? o[ro - rowBytes + x] : 0, c = (y && x >= bpp) ? o[ro - rowBytes + x - bpp] : 0;
      let v = d[p++];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c); }
      o[ro + x] = v & 255;
    }
  }
  return { raw: o, filter: only };
}

function pixelsOf(png) {
  let d;
  try { d = zlib.inflateSync(png.idat.length === 1 ? png.idat[0] : Buffer.concat(png.idat)); } catch (e) { return null; }
  return unfilter(d, png.rowBytes, png.ihdr.h, png.bpp);
}

let scratchA = new Uint8Array(1 << 20), scratchB = new Uint8Array(1 << 20);
function encodeBody(raw, rowBytes, h, bpp, filter) {
  const fl = (rowBytes + 1) * h;
  if (scratchA.length < fl) scratchA = new Uint8Array(fl * 2);
  if (scratchB.length < fl * 9 / 8 + 64) scratchB = new Uint8Array(Math.ceil(fl * 9 / 8 + 64) * 2);
  C.pngFilter(raw, 0, rowBytes, h, bpp, filter, scratchA, 0);
  const n = C.deflateFixed(scratchA, 0, fl, scratchB, 0);
  return { filtered: scratchA.subarray(0, fl), body: scratchB.subarray(0, n) };
}

// The canonical PNG for the one at b[start..end): [everything before the
// first IDAT][one IDAT written by deflateFixed][everything after the last].
function canonicalPng(b, start, end) {
  const png = parsePng(b, start, end);
  if (!png) return null;
  const px = pixelsOf(png);
  if (!px) return null;
  const { rowBytes, bpp } = png, h = png.ihdr.h;
  let best = null;
  for (const filter of (bpp === 1 ? [0] : [0, 1, 2, 4])) {
    const e = encodeBody(px.raw, rowBytes, h, bpp, filter);
    if (!best || e.body.length < best.body.length) best = { filter, body: Buffer.from(e.body), adler: adler32(e.filtered), filtered: Buffer.from(e.filtered) };
  }
  const z = Buffer.alloc(2 + best.body.length + 4);
  z[0] = 0x78; z[1] = 0x01;
  best.body.copy(z, 2);
  z.writeUInt32BE(best.adler, z.length - 4);
  if (Buffer.compare(zlib.inflateSync(z), best.filtered) !== 0) return null;   // any inflate must read it back
  const chunk = Buffer.alloc(12 + z.length);
  chunk.writeUInt32BE(z.length, 0);
  chunk.write('IDAT', 4, 'latin1');
  z.copy(chunk, 8);
  chunk.writeUInt32BE(zlib.crc32(chunk.subarray(4, 8 + z.length)) >>> 0, 8 + z.length);
  return Buffer.concat([b.subarray(start, png.firstIdat), chunk, b.subarray(png.afterIdat, end)]);
}

// One number for everything an SFF v2 MEANS: every sprite's table entry and
// pixels, every palette. Two files with the same digest draw the same thing.
function sffV2Digest(b) {
  const h = crypto.createHash('sha1');
  h.update(b.subarray(12, 16));
  const sprOfs = u32(b, 36), nSpr = u32(b, 40), palOfs = u32(b, 44), nPal = u32(b, 48), ld = u32(b, 52), td = u32(b, 60);
  for (let i = 0; i < nSpr; i++) {
    const s = sprOfs + i * 28;
    h.update(b.subarray(s, s + 16)); h.update(b.subarray(s + 24, s + 28));
    const fmt = b[s + 14], len = u32(b, s + 20), off = ((u16(b, s + 26) & 1) ? td : ld) + u32(b, s + 16);
    if (len === 0) { h.update('link'); continue; }
    const png = fmt >= 10 ? parsePng(b, off + 4, off + len) : null;
    const px = png ? pixelsOf(png) : null;
    if (px) {
      h.update('png'); h.update(b.subarray(off, off + 4)); h.update(png.otherHash.copy().digest()); h.update(px.raw);
      h.update(b.subarray(png.pngEnd, off + len));
    } else { h.update('raw'); h.update(b.subarray(off, off + len)); }
  }
  for (let i = 0; i < nPal; i++) {
    const s = palOfs + i * 16;
    h.update(b.subarray(s, s + 8));
    const len = u32(b, s + 12), off = ld + u32(b, s + 8);
    if (len) h.update(b.subarray(off, off + len));
  }
  return h.digest('hex');
}

// Returns { bytes, sprites, before, after } or null when nothing changed or
// the file is not laid out in a way this can rewrite safely.
function canonicalSffV2(b) {
  if (b.length < 512 || b.toString('latin1', 0, 11) !== 'ElecbyteSpr' || b[15] !== 2) return null;
  const sprOfs = u32(b, 36), nSpr = u32(b, 40), palOfs = u32(b, 44), nPal = u32(b, 48), ld = u32(b, 52), ll = u32(b, 56), td = u32(b, 60), tl = u32(b, 64);
  if (sprOfs + nSpr * 28 > b.length || palOfs + nPal * 16 > b.length) return null;
  // Every position something points at, and every range that must stay whole.
  const refs = new Set([sprOfs, palOfs, ld, td]);
  const fixed = [[0, 512], [sprOfs, sprOfs + nSpr * 28], [palOfs, palOfs + nPal * 16]];
  const data = new Map();                 // absolute offset -> length
  const fmtAt = new Map();
  for (let i = 0; i < nSpr; i++) {
    const s = sprOfs + i * 28, len = u32(b, s + 20);
    if (!len) continue;
    const off = ((u16(b, s + 26) & 1) ? td : ld) + u32(b, s + 16);
    if (off + len > b.length) return null;
    if (data.has(off) && data.get(off) !== len) return null;
    data.set(off, len); refs.add(off); fmtAt.set(off, b[s + 14]);
  }
  for (let i = 0; i < nPal; i++) {
    const s = palOfs + i * 16, len = u32(b, s + 12);
    if (!len) continue;
    const off = ld + u32(b, s + 8);
    if (off + len > b.length) return null;
    fixed.push([off, off + len]); refs.add(off);
  }
  const refList = [...refs].sort((x, y) => x - y);
  // Candidates: PNG sprite data, in file order, overlapping nothing.
  const all = [...data.entries()].sort((x, y) => x[0] - y[0]);
  const reps = [];
  let lastEnd = 0, ri = 0;
  for (let k = 0; k < all.length; k++) {
    const [off, len] = all[k];
    const overlapsNext = k + 1 < all.length && all[k + 1][0] < off + len;
    const overlapsPrev = off < lastEnd;
    lastEnd = Math.max(lastEnd, off + len);
    if (overlapsNext || overlapsPrev || fmtAt.get(off) < 10 || len <= 4) continue;
    if (fixed.some(([a, z]) => off < z && a < off + len)) continue;
    while (ri < refList.length && refList[ri] <= off) ri++;
    if (ri < refList.length && refList[ri] < off + len) continue;   // something points into the middle
    const png = canonicalPng(b, off + 4, off + len);
    if (!png) continue;
    if (png.length === len - 4 && Buffer.compare(png, b.subarray(off + 4, off + len)) === 0) continue;   // already canonical
    reps.push({ off, len, bytes: Buffer.concat([b.subarray(off, off + 4), png]) });
  }
  if (!reps.length) return null;
  // Splice, remembering how far everything after each replacement moves.
  const parts = [];
  let at = 0;
  const ends = [], shift = [];
  let d = 0;
  for (const r of reps) {
    parts.push(b.subarray(at, r.off), r.bytes); at = r.off + r.len;
    d += r.bytes.length - r.len; ends.push(r.off + r.len); shift.push(d);
  }
  parts.push(b.subarray(at));
  const out = Buffer.concat(parts);
  const move = (p) => {                    // old position -> new position
    let lo = 0, hi = ends.length;          // count of replacements that end at or before p
    while (lo < hi) { const mid = (lo + hi) >> 1; if (ends[mid] <= p) lo = mid + 1; else hi = mid; }
    return p + (lo ? shift[lo - 1] : 0);
  };
  const newLen = new Map(reps.map((r) => [r.off, r.bytes.length]));
  const nSprOfs = move(sprOfs), nPalOfs = move(palOfs), nLd = move(ld), nTd = move(td);
  out.writeUInt32LE(nSprOfs, 36); out.writeUInt32LE(nPalOfs, 44); out.writeUInt32LE(nLd, 52); out.writeUInt32LE(nTd, 60);
  if (ld + ll === td) out.writeUInt32LE(nTd - nLd, 56);
  if (td + tl === b.length) out.writeUInt32LE(out.length - nTd, 64);
  for (let i = 0; i < nSpr; i++) {
    const s = sprOfs + i * 28, len = u32(b, s + 20);
    if (!len) continue;
    const isT = u16(b, s + 26) & 1;
    const off = (isT ? td : ld) + u32(b, s + 16);
    const rel = move(off) - (isT ? nTd : nLd);
    if (rel < 0) return null;
    const ns = nSprOfs + i * 28;
    out.writeUInt32LE(rel, ns + 16);
    if (newLen.has(off)) out.writeUInt32LE(newLen.get(off), ns + 20);
  }
  for (let i = 0; i < nPal; i++) {
    const s = palOfs + i * 16, len = u32(b, s + 12);
    if (!len) continue;
    const rel = move(ld + u32(b, s + 8)) - nLd;
    if (rel < 0) return null;
    out.writeUInt32LE(rel, nPalOfs + i * 16 + 8);
  }
  if (sffV2Digest(out) !== sffV2Digest(b)) return null;      // not the same sprites: keep the original
  return { bytes: out, sprites: reps.length, before: reps.reduce((a, r) => a + r.len, 0), after: reps.reduce((a, r) => a + r.bytes.length, 0) };
}

// The op for the PNG at b[start..end), or null.
function tryPng(b, start, end) {
  const png = parsePng(b, start, end);
  if (!png || png.idat.length !== 1) return null;
  const z = png.idat[0];
  if (z.length < 7 || z[0] !== 0x78 || z[1] !== 0x01) return null;
  const px = pixelsOf(png);
  if (!px || px.filter < 0 || px.filter === 3) return null;
  const e = encodeBody(px.raw, png.rowBytes, png.ihdr.h, png.bpp, px.filter);
  if (e.body.length !== z.length - 6) return null;
  for (let i = 0; i < e.body.length; i++) if (e.body[i] !== z[2 + i]) return null;
  return { t: 'png', off: png.firstIdat + 8 + 2, len: e.body.length, raw: px.raw, rowBytes: png.rowBytes, bpp: png.bpp, filter: px.filter };
}

module.exports = { canonicalSffV2, sffV2Digest, tryPng };
