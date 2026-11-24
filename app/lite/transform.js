// WebMUGEN lite - how each kind of file is taken apart (packer side only).
//
// analyze(path, bytes) returns a list of ops that, run in order, write the
// file back byte for byte:
//
//   { t: 'copy',  off, len }                 bytes kept as they are (text, headers, palettes)
//   { t: 'store', off, len }                 bytes kept as they are AND not worth compressing
//                                            (PNG sprites, ogg/mp3) - they skip the compressor
//   { t: 'pcx',   off, len, raw, line }      a PCX run-length stream, kept as its pixels
//   { t: 'rle8',  off, len, raw, line, min } an SFF v2 RLE8 stream, kept as its pixels
//   { t: 'pcm',   off, len, width, ch, rate } WAV samples, kept as differences
//   { t: 'png',   off, len, raw, rowBytes, bpp, filter }
//                                            the deflate stream of a PNG sprite this
//                                            project wrote itself (pngsff.js), kept as pixels
//
// The sprite ops also carry `stride` (bytes per pixel row of `raw`) and the
// sprite's axis `ax`, `ay`, which the sprite compressor uses.
//
// `off`/`len` always name the ORIGINAL bytes the op stands for; the ops of a
// file cover it exactly, in order, with no gaps. `raw` is the pixel buffer
// (a Uint8Array) for the two sprite ops.
//
// Nothing here is trusted: an op is only used when encode(decode(x)) === x
// was checked on the spot, and anything that does not fit is a copy. A file
// this module misreads loses compression, never a byte.
'use strict';

const C = require('./codecs.js');
const P = require('./pngsff.js');

const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

function sameBytes(a, ao, b, bo, n) {
  for (let i = 0; i < n; i++) if (a[ao + i] !== b[bo + i]) return false;
  return true;
}

// Scratch buffer for trial encodes (grown on demand).
let scratch = new Uint8Array(1 << 20);
function need(n) { if (scratch.length < n) scratch = new Uint8Array(n * 2); return scratch; }

// Turn a list of claimed regions (sorted or not, never overlapping after the
// filter below) into ops that cover [0, size): the gaps become copies.
function cover(size, regions, gapType) {
  regions.sort((a, b) => a.off - b.off);
  const ops = [];
  let at = 0;
  for (const r of regions) {
    if (r.off < at || r.off + r.len > size || r.len <= 0) continue; // overlap or out of range: leave it to the copy
    if (r.off > at) ops.push({ t: gapType || 'copy', off: at, len: r.off - at });
    ops.push(r);
    at = r.off + r.len;
  }
  if (at < size) ops.push({ t: gapType || 'copy', off: at, len: size - at });
  return ops;
}

// ---- SFF v1: a chain of sub-files, each one a PCX image -------------------
function tryPcx(b, start, end) {
  // start..end = the PCX file inside the SFF (128-byte header first).
  if (end - start < 129) return null;
  if (b[start] !== 10 || b[start + 2] !== 1 || b[start + 3] !== 8 || b[start + 65] !== 1) return null;
  const w = u16(b, start + 8) - u16(b, start + 4) + 1;
  const h = u16(b, start + 10) - u16(b, start + 6) + 1;
  const bpl = u16(b, start + 66);
  if (w <= 0 || h <= 0 || bpl <= 0 || bpl < w || bpl > w + 8) return null;
  const total = bpl * h;
  if (total > (64 << 20)) return null;
  const raw = new Uint8Array(total);
  const used = C.pcxDecode(b, start + 128, end, raw, total);
  if (used <= 0) return null;
  const out = need(total * 2);
  for (const line of [bpl, 0]) {
    const n = C.pcxEncode(raw, 0, total, line, out, 0);
    if (n === used && sameBytes(out, 0, b, start + 128, n)) {
      return { t: 'pcx', off: start + 128, len: used, raw, line, stride: bpl };
    }
  }
  return null;
}

function analyzeSffV1(b, stats) {
  const regions = [];
  const n = u32(b, 20);
  let at = u32(b, 24);
  const seen = new Set();
  for (let i = 0; i < n && at >= 512 && at + 32 <= b.length && !seen.has(at); i++) {
    seen.add(at);
    const next = u32(b, at), len = u32(b, at + 4);
    if (len > 0 && at + 32 + len <= b.length) {
      const r = tryPcx(b, at + 32, at + 32 + len);
      if (r) { r.ax = ((u16(b, at + 8) << 16) >> 16); r.ay = ((u16(b, at + 10) << 16) >> 16); }
      if (r) { regions.push(r); stats.pcxOk++; stats.pcxBytes += r.len; }
      else { stats.pcxMiss++; stats.pcxMissBytes += len; }
    }
    if (next === 0) break;
    at = next;
  }
  return cover(b.length, regions);
}

// ---- SFF v2: a sprite table pointing into two data blocks -----------------
function analyzeSffV2(b, stats) {
  const regions = [];
  const sprOfs = u32(b, 36), nSpr = u32(b, 40);
  const ldata = u32(b, 52), tdata = u32(b, 60);
  const done = new Set();
  for (let i = 0; i < nSpr; i++) {
    const s = sprOfs + i * 28;
    if (s + 28 > b.length) break;
    const w = u16(b, s + 4), h = u16(b, s + 6);
    const fmt = b[s + 14];
    const len = u32(b, s + 20);
    const flags = u16(b, s + 26);
    const off = ((flags & 1) ? tdata : ldata) + u32(b, s + 16);
    if (len === 0 || off + len > b.length || done.has(off)) continue;
    done.add(off);
    if (fmt === 10 || fmt === 11 || fmt === 12) {
      // A PNG written by this project's own deflate is kept as pixels; any
      // other PNG is already deflated and skips the compressor.
      const r = P.tryPng(b, off + 4, off + len);
      if (r) { r.stride = r.rowBytes; r.ax = ((u16(b, s + 8) << 16) >> 16); r.ay = ((u16(b, s + 10) << 16) >> 16); regions.push(r); stats.pngOk++; stats.pngOkBytes += len; }
      else { regions.push({ t: 'store', off, len }); stats.pngBytes += len; }
    } else if (fmt === 2 && len > 4) {
      const total = w * h;
      if (total <= 0 || total > (64 << 20)) continue;
      const raw = new Uint8Array(total);
      const got = C.rle8Decode(b, off + 4, off + len, raw);
      if (got !== total) { stats.rleMiss++; stats.rleMissBytes += len; continue; }
      const out = need(total * 2);
      let hit = null;
      for (const [line, min] of [[0, 2], [w, 2], [0, 3], [w, 3]]) {
        const n = C.rle8Encode(raw, 0, total, line, min, out, 0);
        if (n === len - 4 && sameBytes(out, 0, b, off + 4, n)) { hit = { line, min }; break; }
      }
      if (hit) { regions.push({ t: 'rle8', off: off + 4, len: len - 4, raw, line: hit.line, min: hit.min, stride: w, ax: ((u16(b, s + 8) << 16) >> 16), ay: ((u16(b, s + 10) << 16) >> 16) }); stats.rleOk++; stats.rleBytes += len; }
      else { stats.rleMiss++; stats.rleMissBytes += len; }
    }
  }
  return cover(b.length, regions);
}

// ---- WAV sample data (a .snd is WAV files end to end, so one scan does both)
// Looks for "RIFF....WAVE", walks its chunks, and claims the "data" chunk of
// plain PCM, 8 or 16 bit.
function analyzeWavs(b, stats) {
  const regions = [];
  let i = b.indexOf('RIFF', 0, 'latin1');
  while (i >= 0 && i + 12 <= b.length) {
    let claimedEnd = i + 4;
    if (b.toString('latin1', i + 8, i + 12) === 'WAVE') {
      let p = i + 12, fmt = null;
      const riffEnd = Math.min(b.length, i + 8 + u32(b, i + 4));
      while (p + 8 <= riffEnd) {
        const id = b.toString('latin1', p, p + 4), sz = u32(b, p + 4);
        if (id === 'fmt ' && sz >= 16 && p + 8 + 16 <= b.length) {
          fmt = { tag: u16(b, p + 8), ch: u16(b, p + 10), rate: u32(b, p + 12), bits: u16(b, p + 22) };
        } else if (id === 'data') {
          const off = p + 8, len = Math.min(sz, b.length - off);
          if (fmt && fmt.tag === 1 && (fmt.bits === 8 || fmt.bits === 16) && fmt.ch >= 1 && fmt.ch <= 2 && len >= 64) {
            regions.push({ t: 'pcm', off, len, width: fmt.bits / 8, ch: fmt.ch, rate: fmt.rate });
            stats.pcmBytes += len;
          }
          claimedEnd = off + len;
          break;
        }
        p += 8 + sz + (sz & 1);
      }
    }
    i = b.indexOf('RIFF', claimedEnd, 'latin1');
  }
  return cover(b.length, regions);
}

const STORED_EXT = /\.(ogg|mp3|flac|png|jpg|jpeg|webm|webp|gif|mp4|zip|opus|m4a)$/i;

function newStats() {
  return { pcxOk: 0, pcxMiss: 0, pcxBytes: 0, pcxMissBytes: 0, rleOk: 0, rleMiss: 0, rleBytes: 0, rleMissBytes: 0, pngBytes: 0, pngOk: 0, pngOkBytes: 0, pcmBytes: 0 };
}

function analyze(vpath, b, stats) {
  stats = stats || newStats();
  if (b.length === 0) return [];
  if (STORED_EXT.test(vpath)) return [{ t: 'store', off: 0, len: b.length }];
  try {
    if (/\.sff$/i.test(vpath) && b.length >= 512 && b.toString('latin1', 0, 11) === 'ElecbyteSpr') {
      if (b[15] === 1) return analyzeSffV1(b, stats);
      if (b[15] === 2) return analyzeSffV2(b, stats);
    }
    if (/\.(snd|wav)$/i.test(vpath)) return analyzeWavs(b, stats);
  } catch (e) {
    // A file that breaks the reader is shipped as it is.
  }
  return [{ t: 'copy', off: 0, len: b.length }];
}

module.exports = { analyze, newStats };
