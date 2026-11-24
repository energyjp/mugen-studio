// WebMUGEN lite - the small reversible codecs.
//
// Every function here is used by BOTH sides: the packer (Node) to prove that
// decode -> encode gives back the original bytes, and the page (a worker) to
// rebuild them. One copy, so the two cannot drift. No dependencies; runs as a
// CommonJS module, a classic worker script, or a plain <script>.
(function (root) {
  'use strict';

  // ---- PCX run-length (SFF v1 sprites) ------------------------------------
  // A byte with the top two bits set is a count (low six bits) for the next
  // byte; anything else is one literal pixel.

  // Decode exactly `total` pixels starting at src[pos]. Returns the number of
  // source bytes used, or -1 when the stream does not land exactly on `total`
  // (a run that spills past the end, or a stream that stops short).
  function pcxDecode(src, pos, end, out, total) {
    let i = pos, o = 0;
    while (o < total) {
      if (i >= end) return -1;
      const b = src[i++];
      if (b >= 0xC0) {
        const n = b & 0x3F;
        if (i >= end || o + n > total) return -1;
        const v = src[i++];
        out.fill(v, o, o + n);
        o += n;
      } else {
        out[o++] = b;
      }
    }
    return i - pos;
  }

  // Encode `total` pixels from raw[rpos..] into out[opos..]. `line` > 0 ends
  // every run at a scanline edge (what almost every PCX writer does); 0 lets
  // runs cross lines. Returns the number of bytes written. The caller sizes
  // `out` (worst case 2 bytes a pixel).
  function pcxEncode(raw, rpos, total, line, out, opos) {
    let i = rpos, o = opos;
    const end = rpos + total;
    let lineEnd = line > 0 ? rpos + line : end;
    while (i < end) {
      if (i >= lineEnd) lineEnd += line;
      const v = raw[i];
      let lim = i + 63;
      if (lim > lineEnd) lim = lineEnd;
      let j = i + 1;
      while (j < lim && raw[j] === v) j++;
      const n = j - i;
      if (n > 1 || v >= 0xC0) { out[o++] = 0xC0 | n; out[o++] = v; }
      else out[o++] = v;
      i = j;
    }
    return o - opos;
  }

  // ---- RLE8 (SFF v2 sprites, format 2) ------------------------------------
  // A byte whose top two bits are 01 is a count (low six bits) for the next
  // byte; anything else is one literal pixel.

  // Decode the whole stream src[pos..end). Returns pixels written, or -1 when
  // it would overrun `out`.
  function rle8Decode(src, pos, end, out) {
    let i = pos, o = 0;
    const cap = out.length;
    while (i < end) {
      const b = src[i++];
      if ((b & 0xC0) === 0x40) {
        const n = b & 0x3F;
        if (i >= end || o + n > cap) return -1;
        const v = src[i++];
        out.fill(v, o, o + n);
        o += n;
      } else {
        if (o >= cap) return -1;
        out[o++] = b;
      }
    }
    return o;
  }

  // `line` as in pcxEncode. `minRun` is the shortest repeat written as a run
  // (2 or 3; writers differ, both cost the same for a pair).
  function rle8Encode(raw, rpos, total, line, minRun, out, opos) {
    let i = rpos, o = opos;
    const end = rpos + total;
    let lineEnd = line > 0 ? rpos + line : end;
    while (i < end) {
      if (i >= lineEnd) lineEnd += line;
      const v = raw[i];
      let lim = i + 63;
      if (lim > lineEnd) lim = lineEnd;
      let j = i + 1;
      while (j < lim && raw[j] === v) j++;
      const n = j - i;
      if ((v & 0xC0) === 0x40) { out[o++] = 0x40 | n; out[o++] = v; i = j; }
      else if (n >= minRun) { out[o++] = 0x40 | n; out[o++] = v; i = j; }
      else { out[o++] = v; i++; }
    }
    return o - opos;
  }

  // ---- PCM delta (WAV sample data) ----------------------------------------
  // Each sample is replaced by its difference from the same channel's
  // previous sample, and the bytes of a multi-byte sample are split into
  // planes (all low bytes, then all high bytes). Exactly reversible: the
  // arithmetic wraps. `width` = bytes per sample (1 or 2), `ch` = channels.
  // A length that is not a whole number of frames leaves the tail as it is.
  function pcmForward(src, pos, len, width, ch, out, opos) {
    const frame = width * ch;
    const frames = Math.floor(len / frame);
    const n = frames * ch;
    if (width === 1) {
      for (let k = 0; k < n; k++) {
        const prev = k >= ch ? src[pos + k - ch] : 0;
        out[opos + k] = (src[pos + k] - prev) & 0xFF;
      }
    } else {
      for (let k = 0; k < n; k++) {
        const p = pos + k * 2;
        const cur = src[p] | (src[p + 1] << 8);
        const prev = k >= ch ? (src[p - ch * 2] | (src[p - ch * 2 + 1] << 8)) : 0;
        const d = (cur - prev) & 0xFFFF;
        out[opos + k] = d & 0xFF;
        out[opos + n + k] = d >>> 8;
      }
    }
    const used = frames * frame;
    for (let k = used; k < len; k++) out[opos + k] = src[pos + k];
  }

  function pcmInverse(src, pos, len, width, ch, out, opos) {
    const frame = width * ch;
    const frames = Math.floor(len / frame);
    const n = frames * ch;
    if (width === 1) {
      for (let k = 0; k < n; k++) {
        const prev = k >= ch ? out[opos + k - ch] : 0;
        out[opos + k] = (src[pos + k] + prev) & 0xFF;
      }
    } else {
      for (let k = 0; k < n; k++) {
        const d = src[pos + k] | (src[pos + n + k] << 8);
        const q = opos + k * 2;
        const prev = k >= ch ? (out[q - ch * 2] | (out[q - ch * 2 + 1] << 8)) : 0;
        const cur = (d + prev) & 0xFFFF;
        out[q] = cur & 0xFF;
        out[q + 1] = cur >>> 8;
      }
    }
    const used = frames * frame;
    for (let k = used; k < len; k++) out[opos + k] = src[pos + k];
  }

  // ---- PNG scanline filters ------------------------------------------------
  // Writes h rows of (1 filter byte + rowBytes) into out[opos..]: the bytes a
  // PNG deflates. `filter` is one PNG filter type used for every row (0 None,
  // 1 Sub, 2 Up, 4 Paeth); `bpp` is bytes per pixel.
  function pngFilter(raw, rpos, rowBytes, h, bpp, filter, out, opos) {
    let o = opos;
    for (let y = 0; y < h; y++) {
      const r = rpos + y * rowBytes;
      out[o++] = filter;
      if (filter === 0) {
        for (let x = 0; x < rowBytes; x++) out[o++] = raw[r + x];
      } else if (filter === 1) {
        for (let x = 0; x < rowBytes; x++) out[o++] = (raw[r + x] - (x >= bpp ? raw[r + x - bpp] : 0)) & 0xFF;
      } else if (filter === 2) {
        for (let x = 0; x < rowBytes; x++) out[o++] = (raw[r + x] - (y ? raw[r + x - rowBytes] : 0)) & 0xFF;
      } else {
        for (let x = 0; x < rowBytes; x++) {
          const a = x >= bpp ? raw[r + x - bpp] : 0;
          const b = y ? raw[r + x - rowBytes] : 0;
          const c = (y && x >= bpp) ? raw[r + x - rowBytes - bpp] : 0;
          const p = a + b - c;
          const pa = p > a ? p - a : a - p, pb = p > b ? p - b : b - p, pc = p > c ? p - c : c - p;
          out[o++] = (raw[r + x] - ((pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c))) & 0xFF;
        }
      }
    }
    return o - opos;
  }

  // ---- deflate, this project's own ----------------------------------------
  // One final block, fixed Huffman codes, greedy matching over a 32K window.
  // It exists so that every browser writes the SAME bytes for the same
  // pixels (the browsers' own compressors do not agree with each other). Any
  // inflate reads it. Returns bytes written; `out` needs n * 9 / 8 + 16.
  const LEN_CODE = new Uint16Array(259), LEN_BITS = new Uint8Array(259);   // code | extra, already bit-ordered
  const LEN_XBITS = new Uint8Array(259), LEN_XVAL = new Uint16Array(259);
  const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
  const DIST_XBITS = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
  const DIST_SYM = new Uint8Array(512);         // d <= 256: [d - 1]; else [256 + ((d - 1) >> 7)]
  const LIT_CODE = new Uint16Array(256), LIT_BITS = new Uint8Array(256);
  const rev = (v, n) => { let r = 0; for (let i = 0; i < n; i++) { r = (r << 1) | (v & 1); v >>= 1; } return r; };
  (function tables() {
    const base = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
    const xb = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
    for (let s = 0; s < 29; s++) {
      const top = s === 28 ? 258 : base[s + 1] - 1;
      for (let l = base[s]; l <= top; l++) {
        const sym = 257 + s;
        if (sym < 280) { LEN_CODE[l] = rev(sym - 256, 7); LEN_BITS[l] = 7; }
        else { LEN_CODE[l] = rev(0xC0 + sym - 280, 8); LEN_BITS[l] = 8; }
        LEN_XBITS[l] = xb[s]; LEN_XVAL[l] = l - base[s];
      }
    }
    // 258 has its own symbol (285); the loop above gave 227..257 to 284.
    LEN_CODE[258] = rev(0xC0 + 285 - 280, 8); LEN_BITS[258] = 8; LEN_XBITS[258] = 0; LEN_XVAL[258] = 0;
    for (let s = 0; s < 30; s++) {
      const top = s === 29 ? 32768 : DIST_BASE[s + 1] - 1;
      for (let d = DIST_BASE[s]; d <= top; d++) {
        if (d <= 256) DIST_SYM[d - 1] = s;
        else DIST_SYM[256 + ((d - 1) >> 7)] = s;
      }
    }
    for (let v = 0; v < 256; v++) {
      if (v < 144) { LIT_CODE[v] = rev(0x30 + v, 8); LIT_BITS[v] = 8; }
      else { LIT_CODE[v] = rev(0x190 + v - 144, 9); LIT_BITS[v] = 9; }
    }
  })();
  const DHEAD = new Int32Array(1 << 15), DPREV = new Int32Array(1 << 15);

  function deflateFixed(src, pos, n, out, opos) {
    const head = DHEAD, prev = DPREV;
    head.fill(-1);
    let o = opos, bb = 3, bc = 3;              // BFINAL = 1, BTYPE = 01
    const end = pos + n;
    let i = pos;
    while (i < end) {
      let best = 0, bestDist = 0;
      if (i + 3 <= end) {
        const h = ((src[i] << 10) ^ (src[i + 1] << 5) ^ src[i + 2]) & 0x7FFF;
        let cand = head[h];
        const maxl = end - i < 258 ? end - i : 258;
        let chain = 24;
        while (cand >= 0 && i - cand <= 32768 && chain-- > 0) {
          if (src[cand + best] === src[i + best]) {
            let l = 0;
            while (l < maxl && src[cand + l] === src[i + l]) l++;
            if (l > best) { best = l; bestDist = i - cand; if (l >= maxl) break; }
          }
          const nx = prev[cand & 0x7FFF];
          if (nx >= cand) break;
          cand = nx;
        }
        prev[i & 0x7FFF] = head[h]; head[h] = i;
      }
      if (best >= 3) {
        bb |= LEN_CODE[best] << bc; bc += LEN_BITS[best];
        while (bc >= 8) { out[o++] = bb & 0xFF; bb >>>= 8; bc -= 8; }
        if (LEN_XBITS[best]) { bb |= LEN_XVAL[best] << bc; bc += LEN_XBITS[best]; }
        const ds = bestDist <= 256 ? DIST_SYM[bestDist - 1] : DIST_SYM[256 + ((bestDist - 1) >> 7)];
        while (bc >= 8) { out[o++] = bb & 0xFF; bb >>>= 8; bc -= 8; }
        bb |= rev(ds, 5) << bc; bc += 5;
        while (bc >= 8) { out[o++] = bb & 0xFF; bb >>>= 8; bc -= 8; }
        if (DIST_XBITS[ds]) { bb |= (bestDist - DIST_BASE[ds]) << bc; bc += DIST_XBITS[ds]; }
        while (bc >= 8) { out[o++] = bb & 0xFF; bb >>>= 8; bc -= 8; }
        // Remember the positions inside a short match; a long one (a flat
        // area) would only fill the table with copies of itself.
        const stop = i + best;
        if (best <= 24) {
          const lim = stop + 3 <= end ? stop : end - 2;
          for (let j = i + 1; j < lim; j++) {
            const h = ((src[j] << 10) ^ (src[j + 1] << 5) ^ src[j + 2]) & 0x7FFF;
            prev[j & 0x7FFF] = head[h]; head[h] = j;
          }
        }
        i = stop;
      } else {
        const v = src[i++];
        bb |= LIT_CODE[v] << bc; bc += LIT_BITS[v];
        while (bc >= 8) { out[o++] = bb & 0xFF; bb >>>= 8; bc -= 8; }
      }
    }
    bc += 7;                                   // end of block: seven zero bits
    while (bc >= 8) { out[o++] = bb & 0xFF; bb >>>= 8; bc -= 8; }
    if (bc > 0) out[o++] = bb & 0xFF;
    return o - opos;
  }

  // ---- lossy sounds: from a decoded track back to WAV samples ---------------
  // (sounds.js says how a track is laid out.) soundMarker finds the loud step
  // near the start of channel 0 and returns how far it sits from where it was
  // put (`lead`): the padding this decoder left in. 0 when there is no step.
  function soundMarker(ch0, lead) {
    const lim = Math.min(ch0.length, lead + 8192);
    for (let i = 0; i < lim; i++) if (ch0[i] >= 0.3) return i - lead;
    return 0;
  }
  // Writes n frames starting at track position `from` as 8-bit unsigned or
  // 16-bit little-endian samples. Positions outside the track are silence.
  function soundWrite(chans, from, n, width, ch, out, off) {
    const len = chans[0].length;
    for (let i = 0; i < n; i++) {
      const p = from + i;
      for (let k = 0; k < ch; k++) {
        const f = p >= 0 && p < len ? chans[k < chans.length ? k : 0][p] : 0;
        if (width === 2) {
          let v = Math.round(f * 32768);
          if (v > 32767) v = 32767; else if (v < -32768) v = -32768;
          out[off++] = v & 0xFF; out[off++] = (v >> 8) & 0xFF;
        } else {
          let v = Math.round(f * 128) + 128;
          if (v > 255) v = 255; else if (v < 0) v = 0;
          out[off++] = v;
        }
      }
    }
  }

  const api = { pcxDecode, pcxEncode, rle8Decode, rle8Encode, pcmForward, pcmInverse, pngFilter, deflateFixed, soundMarker, soundWrite };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LiteCodecs = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
