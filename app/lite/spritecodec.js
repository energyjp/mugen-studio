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
