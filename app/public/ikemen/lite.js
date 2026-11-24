// WebMUGEN lite - the page-side unpacker (lzma.js + codecs.js + spritecodec.js + unpack-core.js + lite-main.js).
// Made from lite/ by `node lite/pack.js --page`; edit those files, not this one.
// WebMUGEN lite - LZMA decoder (raw LZMA1 stream, as `xz --format=raw
// --lzma1=...` writes it). Decode only; the page never compresses.
//
// lzmaDecode(src, srcPos, out, outPos, outLen, lc, lp, pb)
//   src     Uint8Array holding the stream, starting at srcPos
//   out     Uint8Array to write into; outLen bytes are produced at outPos
//   lc/lp/pb  the stream's literal-context / literal-position / position bits
// Returns the number of source bytes read. Throws on a damaged stream.
//
// The dictionary is the output itself (everything before outPos + what has
// been written), so there is no window to size. Runs as a CommonJS module, a
// classic worker script, or a plain <script>.
(function (root) {
  'use strict';

  function lzmaDecode(src, srcPos, out, outPos, outLen, lc, lp, pb) {
    const outStart = outPos, outEnd = outPos + outLen;
    // ---- probability tables, one array ----
    const IS_MATCH = 0;                    // [12 << 4]
    const IS_REP = IS_MATCH + 192;         // [12]
    const IS_REP_G0 = IS_REP + 12;
    const IS_REP_G1 = IS_REP_G0 + 12;
    const IS_REP_G2 = IS_REP_G1 + 12;
    const IS_REP0_LONG = IS_REP_G2 + 12;   // [12 << 4]
    const POS_SLOT = IS_REP0_LONG + 192;   // [4][64]
    const POS_SPEC = POS_SLOT + 256;       // [115]
    const ALIGN = POS_SPEC + 115;          // [16]
    const LEN = ALIGN + 16;                // choice, choice2, low[16][8], mid[16][8], high[256] = 514
    const REP_LEN = LEN + 514;
    const LIT = REP_LEN + 514;             // [0x300 << (lc + lp)]
    const probs = new Uint16Array(LIT + (0x300 << (lc + lp)));
    probs.fill(1024);

    const pbMask = (1 << pb) - 1, lpMask = (1 << lp) - 1, lcShift = 8 - lc;

    // ---- range decoder ----
    let pos = srcPos + 1;                  // the first byte is always 0
    let range = 0xFFFFFFFF;
    let code = ((src[pos] << 24) | (src[pos + 1] << 16) | (src[pos + 2] << 8) | src[pos + 3]) >>> 0;
    pos += 4;

    function bit(i) {
      const p = probs[i];
      const bound = (range >>> 11) * p;
      let b;
      if (code < bound) { range = bound; probs[i] = p + ((2048 - p) >>> 5); b = 0; }
      else { range -= bound; code -= bound; probs[i] = p - (p >>> 5); b = 1; }
      if (range < 16777216) { range = (range << 8) >>> 0; code = ((code << 8) | src[pos++]) >>> 0; }
      return b;
    }
    function tree(base, n) {
      let m = 1;
      for (let k = 0; k < n; k++) m = (m << 1) | bit(base + m);
      return m - (1 << n);
    }
    function treeRev(base, n) {
      let m = 1, sym = 0;
      for (let k = 0; k < n; k++) { const b = bit(base + m); m = (m << 1) | b; sym |= b << k; }
      return sym;
    }
    function direct(n) {
      let res = 0;
      for (; n > 0; n--) {
        range = range >>> 1;
        if (code >= range) { code -= range; res = ((res << 1) | 1) >>> 0; }
        else res = (res << 1) >>> 0;
        if (range < 16777216) { range = (range << 8) >>> 0; code = ((code << 8) | src[pos++]) >>> 0; }
      }
      return res;
    }
    function len(base, posState) {
      if (bit(base) === 0) return tree(base + 2 + (posState << 3), 3);
      if (bit(base + 1) === 0) return 8 + tree(base + 130 + (posState << 3), 3);
      return 16 + tree(base + 258, 8);
    }

    let state = 0, rep0 = 0, rep1 = 0, rep2 = 0, rep3 = 0;   // repN = distance - 1
    const srcEnd = src.length + 8;         // a little slack: the coder reads ahead

    while (outPos < outEnd) {
      if (pos > srcEnd) throw new Error('lzma: ran out of input');
      const posState = (outPos - outStart) & pbMask;
      if (bit(IS_MATCH + (state << 4) + posState) === 0) {
        // ---- a literal ----
        const prev = outPos > outStart ? out[outPos - 1] : 0;
        const base = LIT + 0x300 * ((((outPos - outStart) & lpMask) << lc) + (prev >>> lcShift));
        let sym = 1;
        if (state >= 7) {
          let mb = out[outPos - rep0 - 1];
          do {
            const mbit = (mb >>> 7) & 1; mb <<= 1;
            const b = bit(base + ((1 + mbit) << 8) + sym);
            sym = (sym << 1) | b;
            if (mbit !== b) break;
          } while (sym < 0x100);
        }
        while (sym < 0x100) sym = (sym << 1) | bit(base + sym);
        out[outPos++] = sym;
        state = state < 4 ? 0 : (state < 10 ? state - 3 : state - 6);
        continue;
      }
      let n;
      if (bit(IS_REP + state) !== 0) {
        // ---- a repeat of one of the last four distances ----
        if (outPos === outStart) throw new Error('lzma: damaged stream');
        if (bit(IS_REP_G0 + state) === 0) {
          if (bit(IS_REP0_LONG + (state << 4) + posState) === 0) {
            state = state < 7 ? 9 : 11;
            out[outPos] = out[outPos - rep0 - 1];
            outPos++;
            continue;
          }
        } else {
          let d;
          if (bit(IS_REP_G1 + state) === 0) d = rep1;
          else {
            if (bit(IS_REP_G2 + state) === 0) d = rep2;
            else { d = rep3; rep3 = rep2; }
            rep2 = rep1;
          }
          rep1 = rep0; rep0 = d;
        }
        n = len(REP_LEN, posState);
        state = state < 7 ? 8 : 11;
      } else {
        // ---- a match with a new distance ----
        rep3 = rep2; rep2 = rep1; rep1 = rep0;
        n = len(LEN, posState);
        state = state < 7 ? 7 : 10;
        const slot = tree(POS_SLOT + ((n < 4 ? n : 3) << 6), 6);
        if (slot < 4) rep0 = slot;
        else {
          const nb = (slot >> 1) - 1;
          let d = ((2 | (slot & 1)) << nb) >>> 0;
          if (slot < 14) d += treeRev(POS_SPEC + d - slot, nb);
          else { d += direct(nb - 4) * 16; d += treeRev(ALIGN, 4); }
          if (d === 0xFFFFFFFF) break;     // end marker
          rep0 = d;
        }
      }
      n += 2;
      const from = outPos - rep0 - 1;
      if (from < outStart) throw new Error('lzma: damaged stream (distance)');
      if (outPos + n > outEnd) n = outEnd - outPos;
      if (rep0 + 1 >= n && n >= 32) {
        out.copyWithin(outPos, from, from + n);
        outPos += n;
      } else {
        let f = from;
        const stop = outPos + n;
        while (outPos < stop) out[outPos++] = out[f++];
      }
    }
    if (outPos !== outEnd) throw new Error('lzma: stream ended early');
    return pos - srcPos;
  }

  const api = { lzmaDecode };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LiteLzma = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

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

// WebMUGEN lite - the sprite compressor.
//
// LZMA sees sprite pixels as one long line of bytes. This sees pictures:
//
//   - A sprite can lean on an EARLIER sprite laid over it (usually the
//     previous frame of the animation). Where the two agree a pixel costs
//     almost nothing: "same as the reference" is the first guess.
//   - "What came after this same little neighbourhood last time?" Two tables
//     remember, for the pattern of pixels to the left and above, the pixel
//     that followed it the last time it was seen - anywhere, in any sprite.
//     That is how a piece of art that turns up again at another place (a
//     head, a fist, a shading pattern) is recognised.
//   - Then the neighbours themselves: left, above, above-right, above-left.
//   - Flat areas and areas that match the reference are sent as run lengths,
//     not pixel by pixel, which is also what keeps decoding fast.
//   - What is left (a colour nothing predicted) is sent as a byte, with odds
//     that depend on the pixel to its left.
//
// Each guess is one yes/no through an adaptive binary range coder (the kind
// LZMA uses); how likely a "yes" is is tracked separately for each situation
// (which neighbours agree with each other, how the guess has been doing).
// The model is ONE function, walk(), used for both directions: the packer
// runs it over known pixels and records each answer, the page runs it reading
// answers and writing pixels. They cannot disagree.
//
//   encode(pix, images) -> Uint8Array
//   decode(src, pos, pix, images) -> bytes read
//
// `pix` is every sprite's pixels end to end; images[i] = { base, stride, h,
// ref, dx, dy }: `ref` is the index of an earlier image (or -1) and (dx, dy)
// where this sprite's pixel (0, 0) falls on it. pickRefs() chooses them.
(function (root) {
  'use strict';

  // ---- context tables: one Uint16Array, 16-bit odds of a 0 ("yes") ----
  const A = 0;                 // same as the reference?              [64]
  const L2 = A + 64;           // same as the long-pattern memory?    [256]
  const L1 = L2 + 256;         // same as the short-pattern memory?   [256]
  const B = L1 + 256;          // same as left?                       [256]
  const Cc = B + 256;          // same as above?                      [128]
  const D = Cc + 128;          // same as above-right?                [32]
  const E = D + 32;            // same as above-left?                 [32]
  const RUN_END = E + 32;      // run reaches the end of the row?     [2][8]
  const RUN_N = RUN_END + 16;  // run length: how many bits           [2][32]
  const RUN_M = RUN_N + 64;    // run length: its second bit          [2][32][2]
  const LIT = RUN_M + 128;     // a byte, by the pixel to its left    [256][256]
  const NPROB = LIT + 65536;
  const TBITS = 18;            // the two pattern memories: 256 KB each

  function Encoder() {
    const out = [];
    let chunk = new Uint8Array(1 << 16), n = 0;
    const put = (b) => { if (n === chunk.length) { out.push(chunk); chunk = new Uint8Array(1 << 16); n = 0; } chunk[n++] = b; };
    let low = 0, range = 0xFFFFFFFF, cache = 0, cacheSize = 1;
    const shiftLow = () => {
      if (low < 0xFF000000 || low >= 4294967296) {
        const carry = low >= 4294967296 ? 1 : 0;
        let t = cache;
        do { put((t + carry) & 0xFF); t = 0xFF; } while (--cacheSize !== 0);
        cache = (low >>> 24) & 0xFF;
      }
      cacheSize++;
      low = (low & 0x00FFFFFF) * 256;
    };
    const probs = new Uint16Array(NPROB).fill(32768);
    return {
      enc: true,
      bit(i, b) {
        const pf = probs[i];
        const bound = (range >>> 16) * pf;
        if (b === 0) { range = bound; probs[i] = pf + ((65536 - pf) >> 5); }
        else { low += bound; range -= bound; probs[i] = pf - (pf >> 5); }
        while (range < 16777216) { range = (range << 8) >>> 0; shiftLow(); }
        return b;
      },
      direct(v, nbits) {
        for (let k = nbits - 1; k >= 0; k--) {
          range = range >>> 1;
          if ((v >>> k) & 1) low += range;
          while (range < 16777216) { range = (range << 8) >>> 0; shiftLow(); }
        }
        return v;
      },
      finish() {
        for (let k = 0; k < 5; k++) shiftLow();
        const total = out.reduce((a, c) => a + c.length, 0) + n;
        const res = new Uint8Array(total);
        let o = 0;
        for (const c of out) { res.set(c, o); o += c.length; }
        res.set(chunk.subarray(0, n), o);
        return res;
      },
    };
  }

  function Decoder(src, pos) {
    let p = pos + 1;
    let range = 0xFFFFFFFF;
    let code = ((src[p] << 24) | (src[p + 1] << 16) | (src[p + 2] << 8) | src[p + 3]) >>> 0;
    p += 4;
    const probs = new Uint16Array(NPROB).fill(32768);
    return {
      enc: false,
      bit(i) {
        const pf = probs[i];
        const bound = (range >>> 16) * pf;
        let b;
        if (code < bound) { range = bound; probs[i] = pf + ((65536 - pf) >> 5); b = 0; }
        else { code -= bound; range -= bound; probs[i] = pf - (pf >> 5); b = 1; }
        while (range < 16777216) { range = (range << 8) >>> 0; code = ((code << 8) | src[p++]) >>> 0; }
        return b;
      },
      direct(v, nbits) {
        let res = 0;
        for (let k = 0; k < nbits; k++) {
          range = range >>> 1;
          if (code >= range) { code -= range; res = (res << 1) | 1; } else res <<= 1;
          while (range < 16777216) { range = (range << 8) >>> 0; code = ((code << 8) | src[p++]) >>> 0; }
        }
        return res;
      },
      used() { return p - pos; },
    };
  }

  // A run length 0..(max - 1), or "to the end" (max). `t` picks the table.
  function runCode(c, t, len, max, ectx) {
    const end = c.bit(RUN_END + t * 8 + ectx, c.enc ? (len === max ? 1 : 0) : 0);
    if (end) return max;
    // len + 1 has n bits: n in unary, then the bits below the top one.
    let v = c.enc ? len + 1 : 0, n = 1;
    const tb = RUN_N + t * 32;
    if (c.enc) { while ((v >>> n) !== 0) n++; for (let k = 1; k < n; k++) c.bit(tb + k, 1); c.bit(tb + n, 0); }
    else { while (c.bit(tb + n) === 1) n++; v = 1; }
    if (n > 1) {
      const mb = RUN_M + t * 64 + n * 2;
      if (c.enc) {
        c.bit(mb, (v >>> (n - 2)) & 1);
        if (n > 2) c.direct(v & ((1 << (n - 2)) - 1), n - 2);
      } else {
        v = (v << 1) | c.bit(mb);
        if (n > 2) v = (v << (n - 2)) | c.direct(0, n - 2);
      }
    }
    return v - 1;
  }

  function walk(c, pix, images) {
    const enc = c.enc;
    const T1 = new Uint8Array(1 << TBITS), T2 = new Uint8Array(1 << TBITS);
    const TS = 32 - TBITS;
    let h1hist = 0, h2hist = 0;             // how the two memories did on the last two pixels
    for (let ii = 0; ii < images.length; ii++) {
      const im = images[ii];
      const S = im.stride, H = im.h, base = im.base;
      const hasRef = im.ref >= 0;
      let rS = 0, rH = 0, rbase = 0, dx = 0, dy = 0;
      if (hasRef) { const r = images[im.ref]; rS = r.stride; rH = r.h; rbase = r.base; dx = im.dx; dy = im.dy; }
      for (let y = 0; y < H; y++) {
        const row = base + y * S, up = row - S;
        // The stretch of this row the reference covers: [x0, x1).
        let x0 = 0, x1 = 0, rrow = 0;
        if (hasRef) {
          const ry = y + dy;
          if (ry >= 0 && ry < rH) { x0 = dx < 0 ? -dx : 0; x1 = rS - dx < S ? rS - dx : S; if (x1 < x0) x1 = x0; rrow = rbase + ry * rS + dx; }
        }
        // The same for the row above.
        let ux0 = 0, ux1 = 0, urow = 0;
        if (hasRef && y > 0) {
          const ry = y - 1 + dy;
          if (ry >= 0 && ry < rH) { ux0 = dx < 0 ? -dx : 0; ux1 = rS - dx < S ? rS - dx : S; if (ux1 < ux0) ux1 = ux0; urow = rbase + ry * rS + dx; }
        }
        let x = 0;
        let skipRef = false, skipW = false;   // set after a run: that guess is known to be wrong
        while (x < S) {
          const p = row + x;
          const N = y > 0 ? pix[up + x] : (x > 0 ? pix[p - 1] : 0);
          const W = x > 0 ? pix[p - 1] : N;
          const NW = (x > 0 && y > 0) ? pix[up + x - 1] : N;
          const NE = (y > 0 && x + 1 < S) ? pix[up + x + 1] : N;
          const inRef = x >= x0 && x < x1;
          const R = inRef ? pix[rrow + x] : -1;
          // Did the left and upper neighbours match THEIR reference pixels? (Off the picture counts as yes.)
          const hitW = x > 0 ? (x - 1 >= x0 && x - 1 < x1 ? pix[rrow + x - 1] === W : false) : true;
          const hitN = y > 0 ? (x >= ux0 && x < ux1 ? pix[urow + x] === N : false) : true;
          const flat = W === N && N === NW && N === NE;

          // ---- runs ----
          if (inRef && hitW && hitN && !skipRef) {
            // A stretch that copies the reference.
            const max = x1 - x;
            let len = 0;
            if (enc) { while (len < max && pix[p + len] === pix[rrow + x + len]) len++; }
            len = runCode(c, 0, len, max, (flat ? 1 : 0) | (R === W ? 2 : 0) | (x === 0 ? 4 : 0));
            if (!enc) for (let k = 0; k < len; k++) pix[p + k] = pix[rrow + x + k];
            x += len;
            if (len > 0) skipW = false;
            if (len < max) skipRef = true;
            continue;
          }
          if (flat && !skipW && (!inRef || !hitW || skipRef)) {
            // A flat stretch: more of the colour to the left.
            const max = S - x;
            let len = 0;
            if (enc) { while (len < max && pix[p + len] === W) len++; }
            len = runCode(c, 1, len, max, (inRef ? 1 : 0) | (x === 0 ? 2 : 0) | (y === 0 ? 4 : 0));
            if (!enc) for (let k = 0; k < len; k++) pix[p + k] = W;
            x += len;
            if (len > 0) skipRef = false;
            if (len < max) skipW = true;
            continue;
          }

          // ---- one pixel: a list of guesses, each asked only if it is not a value already ruled out ----
          const v = enc ? pix[p] : -1;
          const WW = x > 1 ? pix[p - 2] : W;
          const NN = y > 1 ? pix[up - S + x] : N;
          const NEE = (y > 0 && x + 2 < S) ? pix[up + x + 2] : NE;
          const NWW = (y > 0 && x > 1) ? pix[up + x - 2] : NW;
          const hh = Math.imul(Math.imul(Math.imul(Math.imul(W + 1, 0x2F0B3A55) ^ N, 0x2F0B3A55) ^ NE, 0x2F0B3A55) ^ NW, 0x2F0B3A55) ^ WW;
          const i1 = Math.imul(hh, 0x9E3779B1) >>> TS;
          const i2 = Math.imul(hh ^ (NN << 9) ^ (NEE << 17) ^ (NWW << 25), 0x9E3779B1) >>> TS;
          const P1 = T1[i1], P2 = T2[i2];
          let got = -1, nOut = 0;
          let o0 = -1, o1 = -1, o2 = -1, o3 = -1, o4 = -1, o5 = -1;   // values ruled out so far
          if (skipW) { o0 = W; nOut++; }
          if (inRef) {
            if (skipRef) { o1 = R; nOut++; }
            else {
              const ctx = (hitW ? 1 : 0) | (hitN ? 2 : 0) | (R === W ? 4 : 0) | (R === N ? 8 : 0) | (W === N ? 16 : 0) | (R === P2 ? 32 : 0);
              if (c.bit(A + ctx, enc ? (v === R ? 0 : 1) : 0) === 0) got = R; else { o1 = R; nOut++; }
            }
          }
          const n3 = () => (nOut > 3 ? 3 : nOut);
          if (got < 0 && P2 !== o0 && P2 !== o1) {
            const ctx = h2hist | (P2 === P1 ? 4 : 0) | (P2 === W ? 8 : 0) | (P2 === N ? 16 : 0) | (n3() << 5) | (h1hist & 1 ? 128 : 0);
            if (c.bit(L2 + ctx, enc ? (v === P2 ? 0 : 1) : 0) === 0) got = P2; else { o2 = P2; nOut++; }
          }
          if (got < 0 && P1 !== o0 && P1 !== o1 && P1 !== o2) {
            const ctx = h1hist | (P1 === W ? 4 : 0) | (P1 === N ? 8 : 0) | (P1 === NE ? 16 : 0) | (n3() << 5) | (h2hist & 1 ? 128 : 0);
            if (c.bit(L1 + ctx, enc ? (v === P1 ? 0 : 1) : 0) === 0) got = P1; else { o3 = P1; nOut++; }
          }
          if (got < 0 && W !== o0 && W !== o1 && W !== o2 && W !== o3) {
            const ctx = (W === N ? 1 : 0) | (N === NE ? 2 : 0) | (N === NW ? 4 : 0) | (W === NW ? 8 : 0) | (WW === W ? 16 : 0) | (n3() << 5);
            if (c.bit(B + ctx, enc ? (v === W ? 0 : 1) : 0) === 0) got = W; else { o4 = W; nOut++; }
          }
          if (got < 0 && N !== W && N !== o1 && N !== o2 && N !== o3) {
            const ctx = (N === NE ? 1 : 0) | (N === NW ? 2 : 0) | (NN === N ? 4 : 0) | (W === NW ? 8 : 0) | (n3() << 4);
            if (c.bit(Cc + ctx, enc ? (v === N ? 0 : 1) : 0) === 0) got = N; else { o5 = N; nOut++; }
          }
          if (got < 0 && NE !== W && NE !== N && NE !== o1 && NE !== o2 && NE !== o3) {
            const ctx = (NW === W ? 1 : 0) | (NW === N ? 2 : 0) | (W === N ? 4 : 0) | (n3() << 3);
            if (c.bit(D + ctx, enc ? (v === NE ? 0 : 1) : 0) === 0) got = NE; else nOut++;
          }
          if (got < 0 && NW !== W && NW !== N && NW !== NE && NW !== o1 && NW !== o2 && NW !== o3) {
            const ctx = (W === N ? 1 : 0) | (N === NE ? 2 : 0) | (n3() << 3);
            if (c.bit(E + ctx, enc ? (v === NW ? 0 : 1) : 0) === 0) got = NW;
          }
          if (got < 0) {
            const tb = LIT + (W << 8);
            let m = 1;
            if (enc) { for (let k = 7; k >= 0; k--) { const b = (v >>> k) & 1; c.bit(tb + m, b); m = (m << 1) | b; } got = v; }
            else { while (m < 256) m = (m << 1) | c.bit(tb + m); got = m & 0xFF; }
          }
          if (!enc) pix[p] = got;
          h1hist = ((h1hist << 1) | (P1 === got ? 1 : 0)) & 3;
          h2hist = ((h2hist << 1) | (P2 === got ? 1 : 0)) & 3;
          T1[i1] = got; T2[i2] = got;
          skipRef = false; skipW = false;
          x++;
        }
      }
    }
  }

  function encode(pix, images) {
    const c = Encoder();
    walk(c, pix, images);
    return c.finish();
  }
  // The same walk through the generic coder objects: slow, kept as the
  // reference the fast decoder below is checked against.
  function decodeSlow(src, pos, pix, images) {
    const c = Decoder(src, pos);
    walk(c, pix, images);
    return c.used();
  }

  // THE DECODER THE PAGE RUNS. walk() again, decode side only, with the range
  // coder's state in plain local variables - several times faster than going
  // through the coder object. It must make exactly the choices walk() makes;
  // the packer decodes every stream it writes with THIS function and compares
  // the pixels, so a slip here stops a build instead of shipping.
  function decode(src, pos, pix, images) {
    const probs = new Uint16Array(NPROB).fill(32768);
    const T1 = new Uint8Array(1 << TBITS), T2 = new Uint8Array(1 << TBITS);
    const TS = 32 - TBITS;
    let sp = pos + 1;
    let range = 0xFFFFFFFF;
    let code = ((src[sp] << 24) | (src[sp + 1] << 16) | (src[sp + 2] << 8) | src[sp + 3]) >>> 0;
    sp += 4;
    function bit(i) {
      const pf = probs[i];
      const bound = (range >>> 16) * pf;
      if (code < bound) {
        range = bound; probs[i] = pf + ((65536 - pf) >> 5);
        while (range < 16777216) { range = (range << 8) >>> 0; code = ((code << 8) | src[sp++]) >>> 0; }
        return 0;
      }
      code -= bound; range -= bound; probs[i] = pf - (pf >> 5);
      while (range < 16777216) { range = (range << 8) >>> 0; code = ((code << 8) | src[sp++]) >>> 0; }
      return 1;
    }
    function run(t, max, ectx) {
      if (bit(RUN_END + t * 8 + ectx) === 1) return max;
      const tb = RUN_N + t * 32;
      let n = 1;
      while (bit(tb + n) === 1) n++;
      let v = 1;
      if (n > 1) {
        v = (v << 1) | bit(RUN_M + t * 64 + n * 2);
        for (let k = n - 2; k > 0; k--) {
          range = range >>> 1;
          if (code >= range) { code -= range; v = (v << 1) | 1; } else v <<= 1;
          while (range < 16777216) { range = (range << 8) >>> 0; code = ((code << 8) | src[sp++]) >>> 0; }
        }
      }
      return v - 1;
    }
    let h1hist = 0, h2hist = 0;
    for (let ii = 0; ii < images.length; ii++) {
      const im = images[ii];
      const S = im.stride, H = im.h, base = im.base;
      const hasRef = im.ref >= 0;
      let rS = 0, rH = 0, rbase = 0, dx = 0, dy = 0;
      if (hasRef) { const r = images[im.ref]; rS = r.stride; rH = r.h; rbase = r.base; dx = im.dx; dy = im.dy; }
      for (let y = 0; y < H; y++) {
        const row = base + y * S, up = row - S;
        let x0 = 0, x1 = 0, rrow = 0;
        if (hasRef) {
          const ry = y + dy;
          if (ry >= 0 && ry < rH) { x0 = dx < 0 ? -dx : 0; x1 = rS - dx < S ? rS - dx : S; if (x1 < x0) x1 = x0; rrow = rbase + ry * rS + dx; }
        }
        let ux0 = 0, ux1 = 0, urow = 0;
        if (hasRef && y > 0) {
          const ry = y - 1 + dy;
          if (ry >= 0 && ry < rH) { ux0 = dx < 0 ? -dx : 0; ux1 = rS - dx < S ? rS - dx : S; if (ux1 < ux0) ux1 = ux0; urow = rbase + ry * rS + dx; }
        }
        let x = 0;
        let skipRef = false, skipW = false;
        while (x < S) {
          const p = row + x;
          const N = y > 0 ? pix[up + x] : (x > 0 ? pix[p - 1] : 0);
          const W = x > 0 ? pix[p - 1] : N;
          const NW = (x > 0 && y > 0) ? pix[up + x - 1] : N;
          const NE = (y > 0 && x + 1 < S) ? pix[up + x + 1] : N;
          const inRef = x >= x0 && x < x1;
          const R = inRef ? pix[rrow + x] : -1;
          const hitW = x > 0 ? (x - 1 >= x0 && x - 1 < x1 ? pix[rrow + x - 1] === W : false) : true;
          const hitN = y > 0 ? (x >= ux0 && x < ux1 ? pix[urow + x] === N : false) : true;
          const flat = W === N && N === NW && N === NE;

          if (inRef && hitW && hitN && !skipRef) {
            const max = x1 - x;
            const len = run(0, max, (flat ? 1 : 0) | (R === W ? 2 : 0) | (x === 0 ? 4 : 0));
            if (len >= 16) pix.copyWithin(p, rrow + x, rrow + x + len);
            else for (let k = 0; k < len; k++) pix[p + k] = pix[rrow + x + k];
            x += len;
            if (len > 0) skipW = false;
            if (len < max) skipRef = true;
            continue;
          }
          if (flat && !skipW && (!inRef || !hitW || skipRef)) {
            const max = S - x;
            const len = run(1, max, (inRef ? 1 : 0) | (x === 0 ? 2 : 0) | (y === 0 ? 4 : 0));
            if (len >= 16) pix.fill(W, p, p + len);
            else for (let k = 0; k < len; k++) pix[p + k] = W;
            x += len;
            if (len > 0) skipRef = false;
            if (len < max) skipW = true;
            continue;
          }

          const WW = x > 1 ? pix[p - 2] : W;
          const NN = y > 1 ? pix[up - S + x] : N;
          const NEE = (y > 0 && x + 2 < S) ? pix[up + x + 2] : NE;
          const NWW = (y > 0 && x > 1) ? pix[up + x - 2] : NW;
          const hh = Math.imul(Math.imul(Math.imul(Math.imul(W + 1, 0x2F0B3A55) ^ N, 0x2F0B3A55) ^ NE, 0x2F0B3A55) ^ NW, 0x2F0B3A55) ^ WW;
          const i1 = Math.imul(hh, 0x9E3779B1) >>> TS;
          const i2 = Math.imul(hh ^ (NN << 9) ^ (NEE << 17) ^ (NWW << 25), 0x9E3779B1) >>> TS;
          const P1 = T1[i1], P2 = T2[i2];
          let got = -1, nOut = 0;
          let o0 = -1, o1 = -1, o2 = -1, o3 = -1;
          if (skipW) { o0 = W; nOut++; }
          if (inRef) {
            if (skipRef) { o1 = R; nOut++; }
            else if (bit(A + ((hitW ? 1 : 0) | (hitN ? 2 : 0) | (R === W ? 4 : 0) | (R === N ? 8 : 0) | (W === N ? 16 : 0) | (R === P2 ? 32 : 0))) === 0) got = R;
            else { o1 = R; nOut++; }
          }
          if (got < 0 && P2 !== o0 && P2 !== o1) {
            if (bit(L2 + (h2hist | (P2 === P1 ? 4 : 0) | (P2 === W ? 8 : 0) | (P2 === N ? 16 : 0) | ((nOut > 3 ? 3 : nOut) << 5) | (h1hist & 1 ? 128 : 0))) === 0) got = P2;
            else { o2 = P2; nOut++; }
          }
          if (got < 0 && P1 !== o0 && P1 !== o1 && P1 !== o2) {
            if (bit(L1 + (h1hist | (P1 === W ? 4 : 0) | (P1 === N ? 8 : 0) | (P1 === NE ? 16 : 0) | ((nOut > 3 ? 3 : nOut) << 5) | (h2hist & 1 ? 128 : 0))) === 0) got = P1;
            else { o3 = P1; nOut++; }
          }
          if (got < 0 && W !== o0 && W !== o1 && W !== o2 && W !== o3) {
            if (bit(B + ((W === N ? 1 : 0) | (N === NE ? 2 : 0) | (N === NW ? 4 : 0) | (W === NW ? 8 : 0) | (WW === W ? 16 : 0) | ((nOut > 3 ? 3 : nOut) << 5))) === 0) got = W;
            else nOut++;
          }
          if (got < 0 && N !== W && N !== o1 && N !== o2 && N !== o3) {
            if (bit(Cc + ((N === NE ? 1 : 0) | (N === NW ? 2 : 0) | (NN === N ? 4 : 0) | (W === NW ? 8 : 0) | ((nOut > 3 ? 3 : nOut) << 4))) === 0) got = N;
            else nOut++;
          }
          if (got < 0 && NE !== W && NE !== N && NE !== o1 && NE !== o2 && NE !== o3) {
            if (bit(D + ((NW === W ? 1 : 0) | (NW === N ? 2 : 0) | (W === N ? 4 : 0) | ((nOut > 3 ? 3 : nOut) << 3))) === 0) got = NE;
            else nOut++;
          }
          if (got < 0 && NW !== W && NW !== N && NW !== NE && NW !== o1 && NW !== o2 && NW !== o3) {
            if (bit(E + ((W === N ? 1 : 0) | (N === NE ? 2 : 0) | ((nOut > 3 ? 3 : nOut) << 3))) === 0) got = NW;
          }
          if (got < 0) {
            const tb = LIT + (W << 8);
            let m = 1;
            while (m < 256) m = (m << 1) | bit(tb + m);
            got = m & 0xFF;
          }
          pix[p] = got;
          h1hist = ((h1hist << 1) | (P1 === got ? 1 : 0)) & 3;
          h2hist = ((h2hist << 1) | (P2 === got ? 1 : 0)) & 3;
          T1[i1] = got; T2[i2] = got;
          skipRef = false; skipW = false;
          x++;
        }
      }
    }
    return sp - pos;
  }

  // ---- choosing references (packer only) ----------------------------------
  // For each sprite, the earlier sprite that leaves the fewest pixels
  // unexplained when laid over it, or none when that is no better than the
  // sprite's own rows. Candidates: an exact copy seen before; the last few
  // sprites, lined up by their axes; and whatever earlier sprites share
  // landmarks with it, at the offset the landmarks agree on.
  function pickRefs(pix, images, back) {
    back = back || 6;
    const seen = new Map();
    const table = new Map();              // window hash -> [sprite, x, y, ...] for the last 8 places it was seen
    const crypto = typeof require === 'function' ? require('crypto') : null;
    for (let i = 0; i < images.length; i++) {
      const im = images[i];
      const S = im.stride, H = im.h, base = im.base;
      im.ref = -1; im.dx = 0; im.dy = 0;
      const step = H > 48 ? 3 : 1;
      // Pixels its own left neighbour does not explain (every `step`-th row).
      let own = 0;
      for (let y = 0; y < H; y += step) { const r = base + y * S; for (let x = 1; x < S; x++) if (pix[r + x] !== pix[r + x - 1]) own++; }
      let best = own * 0.92 - 4, bestRef = -1, bdx = 0, bdy = 0;
      const tryRef = (j, dx, dy) => {
        const r = images[j];
        let cost = 0;
        for (let y = 0; y < H && cost < best; y += step) {
          const ry = y + dy, row = base + y * S;
          if (ry < 0 || ry >= r.h) { for (let x = 1; x < S; x++) if (pix[row + x] !== pix[row + x - 1]) cost++; continue; }
          const rrow = r.base + ry * r.stride + dx;
          for (let x = 0; x < S; x++) {
            const rx = x + dx;
            const v = pix[row + x];
            if (rx >= 0 && rx < r.stride) { if (v !== pix[rrow + x] && (x === 0 || v !== pix[row + x - 1])) cost++; }
            else if (x > 0 && v !== pix[row + x - 1]) cost++;
          }
        }
        if (cost < best) { best = cost; bestRef = j; bdx = dx; bdy = dy; }
      };
      let key = null;
      if (crypto) {
        key = S + 'x' + H + ':' + crypto.createHash('sha1').update(pix.subarray(base, base + S * H)).digest('latin1');
        const j = seen.get(key);
        if (j !== undefined) { best = 0.5; bestRef = j; bdx = 0; bdy = 0; }
      }
      // Landmarks: small windows (8 x 2 pixels) with some detail in them, picked
      // by their own content so the same piece of art is picked wherever it
      // sits. Earlier sprites that hold the same windows vote for themselves
      // and for the offset that lines the windows up.
      const marks = [];
      for (let y = 0; y + 1 < H; y++) {
        const r = base + y * S;
        for (let x = 0; x + 8 <= S; x++) {
          const a = pix[r + x];
          if (a === pix[r + x + 3] && a === pix[r + x + 7] && a === pix[r + S + x + 4]) continue;
          let h = 2166136261;
          for (let k = 0; k < 8; k++) h = Math.imul(h ^ pix[r + x + k], 16777619);
          for (let k = 0; k < 8; k++) h = Math.imul(h ^ pix[r + S + x + k], 16777619);
          h ^= h >>> 15;
          if ((h & 15) === 0) marks.push(h | 0, x, y);
        }
      }
      if (bestRef < 0 || best > 0.5) {
        for (let j = i - 1; j >= 0 && j >= i - back; j--) {
          const r = images[j];
          const adx = (r.ax | 0) - (im.ax | 0), ady = (r.ay | 0) - (im.ay | 0);
          tryRef(j, adx, ady);
          if (adx !== 0 || ady !== 0) tryRef(j, 0, 0);
        }
        const votes = new Map();
        for (let q = 0; q < marks.length; q += 3) {
          const e = table.get(marks[q]);
          if (!e) continue;
          for (let k = 0; k < e.length; k += 3) {
            const ddx = e[k + 1] - marks[q + 1], ddy = e[k + 2] - marks[q + 2];
            if (ddx < -511 || ddx > 511 || ddy < -511 || ddy > 511) continue;
            const vk = e[k] * 1048576 + (ddx + 512) * 1024 + (ddy + 512);
            votes.set(vk, (votes.get(vk) || 0) + 1);
          }
        }
        const top = [...votes.entries()].filter((t) => t[1] >= 2).sort((a, z) => z[1] - a[1]).slice(0, 5);
        for (const [vk] of top) {
          const j = Math.floor(vk / 1048576), rest = vk % 1048576;
          tryRef(j, (rest >> 10) - 512, (rest & 1023) - 512);
        }
      }
      for (let q = 0; q < marks.length; q += 3) {
        let e = table.get(marks[q]);
        if (!e) table.set(marks[q], e = []);
        if (e.length >= 24) e.splice(0, 3);
        e.push(i, marks[q + 1], marks[q + 2]);
      }
      im.ref = bestRef; im.dx = bdx; im.dy = bdy;
      if (key !== null && !seen.has(key)) seen.set(key, i);
    }
  }

  // ---- a whole pixel stream: the list of sprites, then the coded pixels ----
  // [count] then per sprite [stride][height][how many sprites back its reference is, 0 = none][dx][dy]
  // as LEB128 numbers (dx, dy zig-zagged), then the range coder's bytes.
  function packStream(pix, images) {
    const head = [];
    const num = (n) => { while (n >= 128) { head.push((n % 128) | 0x80); n = Math.floor(n / 128); } head.push(n); };
    const zig = (n) => num(n < 0 ? -n * 2 - 1 : n * 2);
    num(images.length);
    images.forEach((im, i) => { num(im.stride); num(im.h); num(im.ref >= 0 ? i - im.ref : 0); zig(im.ref >= 0 ? im.dx : 0); zig(im.ref >= 0 ? im.dy : 0); });
    const body = encode(pix, images);
    const out = new Uint8Array(head.length + body.length);
    out.set(head, 0); out.set(body, head.length);
    return out;
  }
  function unpackStream(src, pix) {
    let p = 0;
    const num = () => { let v = 0, mul = 1; for (;;) { const b = src[p++]; v += (b & 0x7F) * mul; if (b < 0x80) return v; mul *= 128; } };
    const zig = () => { const n = num(); return n % 2 ? -(n + 1) / 2 : n / 2; };
    const count = num();
    const images = new Array(count);
    let base = 0;
    for (let i = 0; i < count; i++) {
      const stride = num(), h = num(), back = num(), dx = zig(), dy = zig();
      images[i] = { base, stride, h, ref: back ? i - back : -1, dx, dy };
      base += stride * h;
    }
    if (base !== pix.length) throw new Error('sprite stream: its sprites add up to ' + base + ' pixels, expected ' + pix.length);
    decode(src, p, pix, images);
  }

  const api = { encode, decode, pickRefs, packStream, unpackStream };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LiteSprites = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

// WebMUGEN lite - rebuilding one chunk of game.lite.
//
// A chunk is up to six streams, back to back, in this order:
//   ops    the recipe: for every file, the list of ops that writes it   (LZMA)
//   copy   bytes that are kept as they are                              (LZMA)
//   pix    8-bit sprite pixels, to be encoded again        (LZMA or the sprite compressor)
//   rgba   32-bit sprite pixels, to be encoded again                    (LZMA)
//   pcm    WAV samples as differences                                   (LZMA)
//   store  bytes that are kept as they are and were never compressed    (as is)
// The container's header says how long each one is (see pack.js).
//
// unpackChunk(bytes, chunk) -> Uint8Array: every file of the chunk, end to
// end, in the order the header lists them. Used by the page's workers and by
// the packer's own check, so what is verified is what runs.
(function (root) {
  'use strict';
  const isNode = typeof module !== 'undefined' && module.exports;
  const Lzma = isNode ? require('./lzma.js') : root.LiteLzma;
  const Codecs = isNode ? require('./codecs.js') : root.LiteCodecs;
  const Sprites = isNode ? require('./spritecodec.js') : root.LiteSprites;

  const OP_COPY = 0, OP_STORE = 1, OP_PCX = 2, OP_RLE8 = 3, OP_PCM = 4, OP_PNG = 5, OP_ZERO = 6;
  const STREAMS = ['ops', 'copy', 'pix', 'rgba', 'pcm', 'store'];
  let lines = new Uint8Array(1 << 16);    // one PNG's filtered scanlines

  function unpackChunk(bytes, chunk) {
    // ---- the streams ----
    const s = {};
    let at = 0;
    for (const name of STREAMS) {
      const d = chunk.s[name];
      if (!d) { s[name] = new Uint8Array(0); continue; }
      const [clen, rlen, lc, lp, pb] = d;
      if (name === 'store') s[name] = bytes.subarray(at, at + clen);
      else {
        const out = new Uint8Array(rlen);
        if (rlen > 0) {
          if (lc === 'spr') Sprites.unpackStream(bytes.subarray(at, at + clen), out);   // the sprite compressor
          else Lzma.lzmaDecode(bytes.subarray(at, at + clen), 0, out, 0, rlen, lc, lp, pb);
        }
        s[name] = out;
      }
      at += clen;
    }

    // ---- the recipe ----
    const ops = s.ops;
    let ip = 0;
    const varint = () => {
      let v = 0, mul = 1;
      for (;;) {
        const b = ops[ip++];
        v += (b & 0x7F) * mul;
        if (b < 0x80) return v;
        mul *= 128;
      }
    };
    const out = new Uint8Array(chunk.out);
    let o = 0, cp = 0, pp = 0, mp = 0, sp = 0, gp = 0;
    for (let f = 0; f < chunk.n; f++) {
      const count = varint();
      for (let k = 0; k < count; k++) {
        const t = ops[ip++];
        if (t === OP_COPY) {
          const len = varint();
          out.set(s.copy.subarray(cp, cp + len), o); cp += len; o += len;
        } else if (t === OP_STORE) {
          const len = varint();
          out.set(s.store.subarray(sp, sp + len), o); sp += len; o += len;
        } else if (t === OP_PCX) {
          const raw = varint(), line = varint();
          o += Codecs.pcxEncode(s.pix, pp, raw, line, out, o); pp += raw;
        } else if (t === OP_RLE8) {
          const raw = varint(), line = varint(), min = varint();
          o += Codecs.rle8Encode(s.pix, pp, raw, line, min, out, o); pp += raw;
        } else if (t === OP_PCM) {
          const len = varint(), width = varint(), ch = varint();
          Codecs.pcmInverse(s.pcm, mp, len, width, ch, out, o); mp += len; o += len;
        } else if (t === OP_PNG) {
          const raw = varint(), rowBytes = varint(), bpp = varint(), filter = varint();
          const h = raw / rowBytes, fl = raw + h;
          if (lines.length < fl) lines = new Uint8Array(fl * 2);
          if (bpp === 1) { Codecs.pngFilter(s.pix, pp, rowBytes, h, bpp, filter, lines, 0); pp += raw; }
          else { Codecs.pngFilter(s.rgba, gp, rowBytes, h, bpp, filter, lines, 0); gp += raw; }
          o += Codecs.deflateFixed(lines, 0, fl, out, o);
        } else if (t === OP_ZERO) {
          o += varint();                    // samples the page fills in from a sound track
        } else {
          throw new Error('game.lite: unknown op ' + t);
        }
      }
    }
    if (o !== chunk.out) throw new Error('game.lite: a chunk rebuilt to ' + o + ' bytes, expected ' + chunk.out);
    return out;
  }

  const api = { unpackChunk, OP_COPY, OP_STORE, OP_PCX, OP_RLE8, OP_PCM, OP_PNG, OP_ZERO, STREAMS };
  if (isNode) module.exports = api;
  else root.LiteUnpack = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

// WebMUGEN lite - the page side: fetch game.lite, rebuild every file.
//
// One script, two roles. On the page it defines
//   ikemenLiteLoad(url, onProgress) -> { files: [[vpath, Uint8Array], ...] }
// which vfs.js calls in place of fetching game.pak. Loaded again as a Worker
// (the page starts a few of itself), it rebuilds one chunk per message.
//
// game.lite is ONE file fetched ONCE, front to back - nothing is streamed
// during play. Chunks are handed to the workers as their bytes arrive, so
// most of the rebuilding is done by the time the download ends. A finished
// download is kept in the browser's Cache Storage under its stamped address:
// the next visit reads it from disk and fetches nothing.
(function (root) {
  'use strict';

  const inWorker = typeof document === 'undefined' && typeof root.importScripts === 'function';
  if (inWorker) {
    root.onmessage = (e) => {
      const { id, bytes, chunk } = e.data;
      try {
        const out = root.LiteUnpack.unpackChunk(bytes, chunk);
        root.postMessage({ id, out }, [out.buffer]);
      } catch (err) {
        root.postMessage({ id, error: String((err && err.message) || err) });
      }
    };
    return;
  }
  if (typeof document === 'undefined') return;   // Node: the modules are used directly

  const SELF_URL = document.currentScript && document.currentScript.src;
  const MAGIC = 'WMLITE1\n';
  const CACHE_NAME = 'webmugen-lite-v1';
  const MEM_BUDGET = 768 * 1048576;   // rebuilt + being-rebuilt bytes in flight at once
  const MAX_WORKERS = 6;
  const READ_WORKERS = MAX_WORKERS;   // one-file reads (the Mod Studio page): rebuilt off the page, as many at once as a boot
  // Rebuilt chunks those reads keep: about a whole game's worth, which is what
  // the game page holds while it plays. Less, and the Mod Studio page rebuilt
  // the same chunks again (45 rebuilds of 16 chunks at 320 MB).
  const READ_BUDGET = 640 * 1048576;

  // ---- Cache Storage: keep the last game.lite on disk --------------------
  async function openStore() {
    try { return root.caches ? await root.caches.open(CACHE_NAME) : null; } catch (e) { return null; }
  }
  async function fetchLite(url, useCache) {
    const abs = new URL(url, location.href).href;
    const store = useCache ? await openStore() : null;
    if (store) {
      try {
        const hit = await store.match(abs);
        if (hit && hit.body) return { res: hit, cached: true, abs, store };
      } catch (e) { /* fall through to the network */ }
    }
    // no-store: the HTTP cache refuses a file this size anyway, and one copy
    // on disk (Cache Storage) is enough.
    const res = await fetch(abs, { cache: 'no-store' });
    if (!res.ok) throw new Error('game data could not be loaded (' + url.split('?')[0] + ': HTTP ' + res.status + ')');
    if (store) {
      const copy = res.clone();
      (async () => {
        try {
          for (const k of await store.keys()) if (k.url !== abs) await store.delete(k);
          await store.put(abs, copy);
          console.log('[lite] saved for next time (no download on the next visit)');
        } catch (e) {
          try { await store.delete(abs); } catch (_) { /* nothing to undo */ }
          console.warn('[lite] could not keep the download for next time:', e && e.message);
        }
      })();
    }
    return { res, cached: false, abs, store };
  }

  // ---- reading an exact number of bytes off the response -----------------
  function byteReader(res, onBytes) {
    const reader = res.body.getReader();
    let cur = null, curAt = 0;
    return async function readExact(n) {
      const out = new Uint8Array(n);
      let o = 0;
      while (o < n) {
        if (!cur || curAt >= cur.length) {
          const { done, value } = await reader.read();
          if (done) throw new Error('game data ended early (the download was cut off)');
          cur = value; curAt = 0;
          onBytes(value.length);
        }
        const take = Math.min(n - o, cur.length - curAt);
        out.set(cur.subarray(curAt, curAt + take), o);
        o += take; curAt += take;
      }
      return out;
    };
  }

  // ---- the worker pool ----------------------------------------------------
  function makePool(max) {
    const want = Math.max(1, Math.min(max || MAX_WORKERS, (navigator.hardwareConcurrency || 4) - 1));
    const idle = [], all = [], waiting = [];
    let inline = false;
    try {
      // No address to start a worker from (this text run without a <script
      // src>): a worker would 404, and the next job posted to it would never
      // answer.
      if (!SELF_URL) throw new Error('lite.js was not loaded from a file');
      for (let i = 0; i < want; i++) { const w = new Worker(SELF_URL); all.push(w); idle.push(w); }
    } catch (e) {
      inline = true;
      console.warn('[lite] no workers here, rebuilding on the page:', e && e.message);
    }
    function run(bytes, chunk) {
      if (inline) {
        return new Promise((resolve, reject) => setTimeout(() => {
          try { resolve(root.LiteUnpack.unpackChunk(bytes, chunk)); } catch (e) { reject(e); }
        }, 0));
      }
      return new Promise((resolve, reject) => {
        const go = (w) => {
          const done = () => { const next = waiting.shift(); if (next) next(w); else idle.push(w); };
          w.onmessage = (e) => { done(); if (e.data.error) reject(new Error(e.data.error)); else resolve(e.data.out); };
          w.onerror = (e) => { done(); reject(new Error('rebuild worker failed: ' + (e.message || 'unknown error'))); };
          w.postMessage({ id: 0, bytes, chunk }, [bytes.buffer]);
        };
        const w = idle.pop();
        if (w) go(w); else waiting.push(go);
      });
    }
    return { run, close: () => { for (const w of all) w.terminate(); } };
  }

  // ---- lossy sound tracks: MP3 -> samples, by the browser's own decoder ----
  // Resolves to one Float32Array per channel at the track's own sample rate.
  function decodeTrack(bytes, track) {
    const AC = root.OfflineAudioContext || root.webkitOfflineAudioContext;
    if (!AC) return Promise.reject(new Error('this browser has no audio decoder for pages'));
    let ctx, rate = track.rate;
    try { ctx = new AC(track.ch, 1, rate); }
    catch (e) { rate = 44100; ctx = new AC(track.ch, 1, rate); }   // a browser that refuses low rates: decode at 44.1 kHz, bring it back below
    return new Promise((resolve, reject) => {
      const p = ctx.decodeAudioData(bytes.buffer, resolve, reject);
      if (p && p.catch) p.catch(reject);
    }).then((ab) => {
      const chans = [];
      for (let k = 0; k < ab.numberOfChannels; k++) chans.push(ab.getChannelData(k));
      if (ab.sampleRate === track.rate) return chans;
      const step = ab.sampleRate / track.rate, n = Math.floor(chans[0].length / step);
      return chans.map((c) => {
        const o = new Float32Array(n);
        for (let i = 0; i < n; i++) { const x = i * step, j = Math.floor(x), f = x - j; o[i] = c[j] * (1 - f) + (j + 1 < c.length ? c[j + 1] : c[j]) * f; }
        return o;
      });
    });
  }

  async function loadOnce(url, onProgress, useCache) {
    const t0 = performance.now();
    const { res, cached, abs, store } = await fetchLite(url, useCache);
    let received = 0, total = 0, finished = false;
    const report = () => {
      // The last byte is held back until every file is rebuilt, so the page
      // says "complete" when the game data is really ready.
      if (onProgress && total) onProgress(finished ? total : Math.min(received, total - 1), total);
    };
    const readExact = byteReader(res, (n) => { received += n; report(); });
    const pool = makePool();
    let ready = [];
    try {
      const head = await readExact(12);
      if (new TextDecoder('latin1').decode(head.subarray(0, 8)) !== MAGIC) throw new Error('game data is not a WebMUGEN lite file');
      const headerLen = new DataView(head.buffer).getUint32(8, true);
      const header = JSON.parse(new TextDecoder().decode(await readExact(headerLen)));
      total = header.bytes;
      report();

      const outs = new Array(header.chunks.length);
      const jobs = [];
      let inFlight = 0, wake = null, failed = null;
      ready = header.chunks.map(() => { let go; const p = new Promise((r) => { go = r; }); return { p, go }; });

      // ---- sound tracks come first in the file: start decoding them now, and
      // write each clip's samples into its file once that file's chunk is rebuilt.
      const sound = { tracks: 0, failed: 0, offsets: [] };
      const soundTasks = [], soundWait = [];
      let soundBusy = 0;
      for (const track of header.audio || []) {
        const bytes = await readExact(track.len);
        sound.tracks++;
        soundTasks.push((async () => {
          while (soundBusy >= 3) await new Promise((r) => soundWait.push(r));
          soundBusy++;
          try {
            let chans = null;
            try { chans = await decodeTrack(bytes, track); }
            catch (e) { sound.failed++; console.warn('[lite] a sound track could not be decoded; its sounds will be silent:', (e && e.message) || e); }
            const need = new Set();
            for (let k = 0; k < track.clips.length; k += 5) need.add(track.clips[k]);
            await Promise.all([...need].map((ci) => ready[ci].p));
            if (!chans || failed) return;
            const d = root.LiteCodecs.soundMarker(chans[0], track.lead);
            sound.offsets.push(d);
            const c = track.clips;
            for (let k = 0; k < c.length; k += 5) root.LiteCodecs.soundWrite(chans, c[k + 2] + d, c[k + 3], c[k + 4], track.ch, outs[c[k]], c[k + 1]);
          } finally {
            soundBusy--;
            const w = soundWait.shift(); if (w) w();
          }
        })());
      }
      for (let i = 0; i < header.chunks.length; i++) {
        const chunk = header.chunks[i];
        const bytes = await readExact(chunk.len);
        while (inFlight > 0 && inFlight + chunk.mem > MEM_BUDGET && !failed) await new Promise((r) => { wake = r; });
        if (failed) throw failed;
        inFlight += chunk.mem;
        jobs.push(pool.run(bytes, chunk).then((out) => { outs[i] = out; }, (e) => { failed = failed || e; })
          .then(() => { ready[i].go(); inFlight -= chunk.mem; if (wake) { const w = wake; wake = null; w(); } }));
      }
      await Promise.all(jobs);
      if (failed) throw failed;
      await Promise.all(soundTasks);

      // ---- hand the files out, in the order the build lists them ----
      const at = new Array(outs.length).fill(0);
      const byPath = new Map();
      const files = [];
      for (const f of header.files) {
        const [vpath, size, ci] = f;
        let bytes;
        if (ci < 0) bytes = byPath.get(f[3]).slice();            // a file identical to an earlier one: its own copy
        else { bytes = outs[ci].subarray(at[ci], at[ci] + size); at[ci] += size; }
        byPath.set(vpath, bytes);
        files.push([vpath, bytes]);
      }
      let engine = null;
      if (header.engine) engine = outs[header.engine.chunk];
      finished = true; report();
      console.log('[lite] ' + files.length + ' files rebuilt from ' + (header.bytes / 1048576).toFixed(1) + ' MB' +
        (cached ? ' (kept from last time, nothing downloaded)' : ' (downloaded)') +
        ' in ' + ((performance.now() - t0) / 1000).toFixed(1) + ' s' +
        (sound.tracks ? '; ' + (sound.tracks - sound.failed) + ' of ' + sound.tracks + ' sound tracks decoded' : ''));
      return { files, engine, cached, header, sound, seconds: (performance.now() - t0) / 1000 };
    } catch (e) {
      for (const r of ready) r.go();        // let waiting sound tracks finish
      try { await res.body.cancel(); } catch (_) { /* already closed */ }
      if (cached && store) { try { await store.delete(abs); } catch (_) { /* gone already */ } }
      e.liteFromCache = cached;
      throw e;
    } finally {
      pool.close();
    }
  }

  // ---- one file out of game.lite, for a page that needs a few files and not
  // the whole game (the Mod Studio page reads defs and the base roster).
  // From the copy this browser kept when there is one; otherwise the header
  // and the one chunk that holds the file, by Range request (a host that
  // ignores Range sends the whole file once, and that is used instead). Only
  // that chunk is rebuilt. A lossy sound's samples are not filled in here.
  const readers = new Map();
  async function openReader(url) {
    const abs = new URL(url, location.href).href;
    let whole = null;
    const store = await openStore();
    if (store) {
      try { const hit = await store.match(abs); if (hit) whole = new Uint8Array(await hit.arrayBuffer()); }
      catch (e) { whole = null; }
    }
    const range = async (start, end) => {
      if (whole) return whole.subarray(start, end);
      const res = await fetch(abs, { headers: { Range: 'bytes=' + start + '-' + (end - 1) }, cache: 'no-store' });
      if (!res.ok) throw new Error('game data could not be read (' + url.split('?')[0] + ': HTTP ' + res.status + ')');
      const buf = new Uint8Array(await res.arrayBuffer());
      if (res.status === 206 && buf.length === end - start) return buf;
      if (res.status === 200 && buf.length >= end) { whole = buf; return buf.subarray(start, end); }
      throw new Error('game data could not be read (' + url.split('?')[0] + ': a short answer)');
    };
    const head = await range(0, 12);
    if (new TextDecoder('latin1').decode(head.subarray(0, 8)) !== MAGIC) throw new Error('game data is not a WebMUGEN lite file');
    const headerLen = new DataView(head.buffer, head.byteOffset, 12).getUint32(8, true);
    const header = JSON.parse(new TextDecoder().decode(await range(12, 12 + headerLen)));
    let at = 12 + headerLen;
    for (const a of header.audio || []) at += a.len;
    const chunkAt = header.chunks.map((c) => { const s = at; at += c.len; return s; });
    const where = new Map();
    const pos = new Array(header.chunks.length).fill(0);
    for (const f of header.files) {
      if (f[2] < 0) where.set(f[0], { same: f[3] });
      else { where.set(f[0], { ci: f[2], off: pos[f[2]], size: f[1] }); pos[f[2]] += f[1]; }
    }
    // Rebuilt chunks are kept up to READ_BUDGET, the least recently used let
    // go first. The Mod Studio page reads defs, sprites and palettes from
    // nearly every chunk in an order that jumps between them; keeping only the
    // last three rebuilt the same chunks again and again, on the page itself,
    // and a 22-character roster took over a minute to read its portraits.
    // Rebuilt in workers, so the page keeps drawing meanwhile.
    const rebuilt = new Map();            // index -> promise of the bytes; oldest use first
    let pool = null;
    const chunk = (ci) => {
      let p = rebuilt.get(ci);
      if (p) { rebuilt.delete(ci); rebuilt.set(ci, p); return p; }
      if (!pool) pool = makePool(READ_WORKERS);
      p = range(chunkAt[ci], chunkAt[ci] + header.chunks[ci].len)
        // a view into the kept copy is copied: the worker takes the buffer
        .then((b) => pool.run(b.byteLength === b.buffer.byteLength ? b : b.slice(), header.chunks[ci]));
      p.catch(() => { if (rebuilt.get(ci) === p) rebuilt.delete(ci); });   // a failure is not kept as the answer
      rebuilt.set(ci, p);
      let held = 0;
      for (const k of rebuilt.keys()) held += header.chunks[k].out;   // the rebuilt size (mem is the work space)
      for (const k of rebuilt.keys()) {
        if (held <= READ_BUDGET || k === ci) break;
        held -= header.chunks[k].out;
        rebuilt.delete(k);
      }
      return p;
    };
    return { where, chunk };
  }
  root.ikemenLiteReadFile = async function (url, vpath) {
    if (!readers.has(url)) readers.set(url, openReader(url).catch((e) => { readers.delete(url); throw e; }));
    const r = await readers.get(url);
    let w = r.where.get(vpath);
    for (let hops = 0; w && w.same && hops < 8; hops++) w = r.where.get(w.same);
    if (!w || w.same) throw new Error('not in the game data: ' + vpath);
    const out = await r.chunk(w.ci);
    return out.slice(w.off, w.off + w.size);
  };

  root.ikemenLiteLoad = async function (url, onProgress) {
    let r;
    try { r = await loadOnce(url, onProgress, true); }
    catch (e) {
      if (!e.liteFromCache) throw e;
      // The kept copy was bad (and is deleted now): fetch a fresh one, once.
      console.warn('[lite] the kept copy could not be used (' + e.message + '); downloading again');
      r = await loadOnce(url, onProgress, false);
    }
    if (r.engine) {
      const engine = r.engine;
      // The boot page asks for the engine after the files; it gets a Response
      // so WebAssembly.instantiateStreaming and the Engine ID hash work as
      // they do for a fetched ikemen.wasm.
      root.ikemenLiteEngine = () => Promise.resolve(new Response(engine, { headers: { 'Content-Type': 'application/wasm' } }));
    }
    root.ikemenLiteInfo = { cached: r.cached, bytes: r.header.bytes, mode: r.header.mode || '', seconds: r.seconds, sound: r.sound };
    return r;
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
