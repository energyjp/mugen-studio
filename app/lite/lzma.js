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
