// WebMUGEN lite - LZMA encoder (raw LZMA1 stream, the kind lzma.js decodes).
//
// lzmaEncode(input, { lc, lp, pb, dictSize, niceLen, depth }) -> Uint8Array
//
// Written for the Website export so a lite build needs no outside program.
// It follows the classic design of the LZMA SDK's "normal" mode (the
// algorithm Igor Pavlov placed in the public domain): a binary-tree match
// finder over 2/3/4-byte hashes, and an optimal parser that prices every
// literal, match and repeat with the coder's live probabilities and picks the
// cheapest path through up to 4096 bytes at a time, including the
// "match + literal + repeat" and "repeat + literal + repeat" shortcuts.
//
// The stream has no end marker and no header: the reader knows the unpacked
// length (game.lite's header holds it). Output is deterministic - the same
// input and options always give the same bytes.
'use strict';

const NUM_REPS = 4;
const MATCH_MIN = 2;
const MATCH_MAX = 273;
const NUM_OPTS = 1 << 12;
const INFINITY_PRICE = 1 << 30;
const FULL_DISTANCES = 128;
const END_POS_MODEL = 14;
const ALIGN_BITS = 4;
const EMPTY = -0x40000000;              // "no position": any delta from it is out of the window

const LIT_NEXT = [0, 0, 0, 0, 1, 2, 3, 4, 5, 6, 4, 5];
const MATCH_NEXT = [7, 7, 7, 7, 7, 7, 7, 10, 10, 10, 10, 10];
const REP_NEXT = [8, 8, 8, 8, 8, 8, 8, 11, 11, 11, 11, 11];
const SHORTREP_NEXT = [9, 9, 9, 9, 9, 9, 9, 11, 11, 11, 11, 11];

// Price of a bit, in 1/16 bit, by its probability (11-bit) >> 4.
const PROB_PRICES = (() => {
  const t = new Uint32Array(128);
  for (let i = 8; i < 2048; i += 16) {
    let w = i, bitCount = 0;
    for (let j = 0; j < 4; j++) {
      w = w * w; bitCount <<= 1;
      while (w >= 65536) { w = Math.floor(w / 2); bitCount++; }
    }
    t[i >> 4] = (11 << 4) - 15 - bitCount;
  }
  return t;
})();
const price0 = (p) => PROB_PRICES[p >> 4];
const price1 = (p) => PROB_PRICES[(p ^ 2047) >> 4];
const priceBit = (p, b) => PROB_PRICES[(p ^ ((-b) & 2047)) >> 4];

const CRC = (() => {
  const t = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let r = i;
    for (let j = 0; j < 8; j++) r = (r >>> 1) ^ (0xEDB88320 & -(r & 1));
    t[i] = r;
  }
  return t;
})();

function posSlotOf(d) {
  if (d < 4) return d;
  const n = 31 - Math.clz32(d);
  return (n << 1) | ((d >>> (n - 1)) & 1);
}

function lzmaEncode(input, options) {
  const o = options || {};
  const lc = o.lc === undefined ? 3 : o.lc, lp = o.lp || 0, pb = o.pb === undefined ? 2 : o.pb;
  const n = input.length;
  const niceLen = Math.min(MATCH_MAX, Math.max(8, o.niceLen || 64));
  const depth = o.depth || (16 + (niceLen >> 1));
  let dictSize = o.dictSize || (1 << 23);
  if (dictSize < 4096) dictSize = 4096;
  const data = input;

  // ---------------- output + range coder ----------------
  let out = new Uint8Array(Math.max(1024, (n >>> 1) + 1024));
  let outPos = 0;
  const put = (b) => {
    if (outPos === out.length) { const g = new Uint8Array(out.length * 2); g.set(out); out = g; }
    out[outPos++] = b;
  };
  let low = 0, range = 0xFFFFFFFF, cache = 0, cacheSize = 1;
  function shiftLow() {
    if (low < 0xFF000000 || low >= 0x100000000) {
      const carry = low >= 0x100000000 ? 1 : 0;
      let temp = cache;
      do { put((temp + carry) & 0xFF); temp = 0xFF; } while (--cacheSize !== 0);
      cache = (low >>> 24) & 0xFF;
    }
    cacheSize++;
    low = (low & 0x00FFFFFF) * 256;
  }
  function encBit(probs, i, b) {
    const p = probs[i];
    const bound = (range >>> 11) * p;
    if (b === 0) { range = bound; probs[i] = p + ((2048 - p) >> 5); }
    else { low += bound; range -= bound; probs[i] = p - (p >> 5); }
    while (range < 0x1000000) { range = (range * 256) >>> 0; shiftLow(); }
  }
  function encDirect(value, numBits) {
    while (numBits > 0) {
      numBits--;
      range = range >>> 1;
      if ((value >>> numBits) & 1) low += range;
      if (range < 0x1000000) { range = (range * 256) >>> 0; shiftLow(); }
    }
  }
  function encTree(probs, base, numBits, sym) {
    let m = 1;
    for (let i = numBits; i > 0;) { i--; const b = (sym >>> i) & 1; encBit(probs, base + m, b); m = (m << 1) | b; }
  }
  function encTreeRev(probs, base, numBits, sym) {
    let m = 1;
    for (let i = 0; i < numBits; i++) { const b = sym & 1; encBit(probs, base + m, b); m = (m << 1) | b; sym >>>= 1; }
  }
  function priceTree(probs, base, numBits, sym) {
    let price = 0;
    sym |= 1 << numBits;
    while (sym !== 1) { price += priceBit(probs[base + (sym >>> 1)], sym & 1); sym >>>= 1; }
    return price;
  }
  function priceTreeRev(probs, base, numBits, sym) {
    let price = 0, m = 1;
    for (let i = numBits; i > 0; i--) { const b = sym & 1; sym >>>= 1; price += priceBit(probs[base + m], b); m = (m << 1) | b; }
    return price;
  }

  // ---------------- the model (same contexts as lzma.js) ----------------
  const isMatch = new Uint16Array(192).fill(1024);
  const isRep = new Uint16Array(12).fill(1024);
  const isRepG0 = new Uint16Array(12).fill(1024);
  const isRepG1 = new Uint16Array(12).fill(1024);
  const isRepG2 = new Uint16Array(12).fill(1024);
  const isRep0Long = new Uint16Array(192).fill(1024);
  const posSlotProbs = new Uint16Array(256).fill(1024);   // [4][64]
  const posSpec = new Uint16Array(116).fill(1024);       // index base - slot + m, as lzma.js
  const alignProbs = new Uint16Array(17).fill(1024);
  const lit = new Uint16Array(0x300 << (lc + lp)).fill(1024);
  const pbMask = (1 << pb) - 1, lpMask = (1 << lp) - 1, lcShift = 8 - lc;
  const litBase = (pos, prev) => 0x300 * (((pos & lpMask) << lc) + (prev >>> lcShift));

  // A length coder: choice, choice2, low[16][8], mid[16][8], high[256] (lzma.js layout).
  function LenCoder() {
    this.p = new Uint16Array(514).fill(1024);
    this.prices = new Uint32Array(16 * MATCH_MAX);   // [posState][len - 2]
    this.counters = new Int32Array(16);
  }
  const tableSize = niceLen + 1 - MATCH_MIN;
  LenCoder.prototype.update = function (posState) {
    const p = this.p;
    const a0 = price0(p[0]), a1 = price1(p[0]);
    const b0 = a1 + price0(p[1]), b1 = a1 + price1(p[1]);
    const row = posState * MATCH_MAX;
    let i = 0;
    for (; i < 8 && i < tableSize; i++) this.prices[row + i] = a0 + priceTree(p, 2 + (posState << 3), 3, i);
    for (; i < 16 && i < tableSize; i++) this.prices[row + i] = b0 + priceTree(p, 130 + (posState << 3), 3, i - 8);
    for (; i < tableSize; i++) this.prices[row + i] = b1 + priceTree(p, 258, 8, i - 16);
    this.counters[posState] = tableSize;
  };
  LenCoder.prototype.encode = function (len, posState) {     // len = match length - 2
    const p = this.p;
    if (len < 8) { encBit(p, 0, 0); encTree(p, 2 + (posState << 3), 3, len); }
    else if (len < 16) { encBit(p, 0, 1); encBit(p, 1, 0); encTree(p, 130 + (posState << 3), 3, len - 8); }
    else { encBit(p, 0, 1); encBit(p, 1, 1); encTree(p, 258, 8, len - 16); }
    if (--this.counters[posState] === 0) this.update(posState);
  };
  const lenCoder = new LenCoder(), repLenCoder = new LenCoder();
  for (let ps = 0; ps <= pbMask; ps++) { lenCoder.update(ps); repLenCoder.update(ps); }

  // ---------------- distance prices ----------------
  const posSlotPrices = new Uint32Array(4 * 64);
  const distPrices = new Uint32Array(4 * FULL_DISTANCES);
  const alignPrices = new Uint32Array(16);
  let matchPriceCount = 0, alignPriceCount = 0;
  const tempPrices = new Uint32Array(FULL_DISTANCES);
  let distTableSize = 0;
  { let lg = 0; while ((1 << lg) < dictSize && lg < 32) lg++; distTableSize = Math.min(64, Math.max(8, lg * 2)); }
  function fillDistPrices() {
    for (let i = 4; i < FULL_DISTANCES; i++) {
      const slot = posSlotOf(i), footer = (slot >> 1) - 1, base = (2 | (slot & 1)) << footer;
      tempPrices[i] = priceTreeRev(posSpec, base - slot, footer, i - base);
    }
    for (let lps = 0; lps < 4; lps++) {
      const row = lps << 6;
      for (let s = 0; s < distTableSize; s++) posSlotPrices[row + s] = priceTree(posSlotProbs, row, 6, s);
      for (let s = END_POS_MODEL; s < distTableSize; s++) posSlotPrices[row + s] += (((s >> 1) - 1) - ALIGN_BITS) << 4;
      const drow = lps * FULL_DISTANCES;
      for (let i = 0; i < 4; i++) distPrices[drow + i] = posSlotPrices[row + i];
      for (let i = 4; i < FULL_DISTANCES; i++) distPrices[drow + i] = posSlotPrices[row + posSlotOf(i)] + tempPrices[i];
    }
    matchPriceCount = 0;
  }
  function fillAlignPrices() {
    for (let i = 0; i < 16; i++) alignPrices[i] = priceTreeRev(alignProbs, 0, 4, i);
    alignPriceCount = 0;
  }
  fillDistPrices(); fillAlignPrices();

  function litPrice(base, sym) {
    let price = 0, m = 1;
    for (let i = 7; i >= 0; i--) { const b = (sym >>> i) & 1; price += priceBit(lit[base + m], b); m = (m << 1) | b; }
    return price;
  }
  function litPriceMatched(base, sym, matchByte) {
    let price = 0, m = 1, matched = true;
    for (let i = 7; i >= 0; i--) {
      const b = (sym >>> i) & 1;
      if (matched) { const mb = (matchByte >>> i) & 1; price += priceBit(lit[base + ((1 + mb) << 8) + m], b); matched = mb === b; }
      else price += priceBit(lit[base + m], b);
      m = (m << 1) | b;
    }
    return price;
  }
  function encLiteral(base, sym) {
    let m = 1;
    for (let i = 7; i >= 0; i--) { const b = (sym >>> i) & 1; encBit(lit, base + m, b); m = (m << 1) | b; }
  }
  function encLiteralMatched(base, sym, matchByte) {
    let m = 1, matched = true;
    for (let i = 7; i >= 0; i--) {
      const b = (sym >>> i) & 1;
      if (matched) { const mb = (matchByte >>> i) & 1; encBit(lit, base + ((1 + mb) << 8) + m, b); matched = mb === b; }
      else encBit(lit, base + m, b);
      m = (m << 1) | b;
    }
  }
  const repLen1Price = (state, posState) => price0(isRepG0[state]) + price0(isRep0Long[(state << 4) + posState]);
  function pureRepPrice(repIndex, state, posState) {
    if (repIndex === 0) return price0(isRepG0[state]) + price1(isRep0Long[(state << 4) + posState]);
    let price = price1(isRepG0[state]);
    if (repIndex === 1) price += price0(isRepG1[state]);
    else price += price1(isRepG1[state]) + priceBit(isRepG2[state], repIndex - 2);
    return price;
  }
  const repPrice = (repIndex, len, state, posState) => repLenCoder.prices[posState * MATCH_MAX + len - 2] + pureRepPrice(repIndex, state, posState);

  // ---------------- match finder: binary trees on 4-byte hashes ----------------
  const cbs = Math.min(dictSize, n) + 1;                // cyclic buffer size
  const son = new Int32Array(cbs * 2);
  let hs = dictSize - 1;
  hs |= hs >>> 1; hs |= hs >>> 2; hs |= hs >>> 4; hs |= hs >>> 8; hs |= hs >>> 16;
  hs >>>= 1; hs |= 0xFFFF;
  if (hs > (1 << 24)) hs >>>= 1;
  const hashMask = hs;
  const hash2 = new Int32Array(1 << 10).fill(EMPTY);
  const hash3 = new Int32Array(1 << 16).fill(EMPTY);
  const hash4 = new Int32Array(hashMask + 1).fill(EMPTY);
  let mfPos = 0, cyclicPos = 0;
  const matches = new Int32Array(MATCH_MAX * 2 + 8);
  let numAvailMF = 0;

  function movePos() { mfPos++; if (++cyclicPos === cbs) cyclicPos = 0; }

  function skipSpec(lenLimit, curMatch, cur) {
    let ptr0 = (cyclicPos << 1) + 1, ptr1 = cyclicPos << 1;
    let len0 = 0, len1 = 0, cut = depth;
    for (;;) {
      const delta = mfPos - curMatch;
      if (cut-- === 0 || delta >= cbs) { son[ptr0] = son[ptr1] = EMPTY; return; }
      const pair = (cyclicPos - delta + (delta > cyclicPos ? cbs : 0)) << 1;
      const pb0 = cur - delta;
      let len = len0 < len1 ? len0 : len1;
      if (data[pb0 + len] === data[cur + len]) {
        while (++len !== lenLimit) if (data[pb0 + len] !== data[cur + len]) break;
        if (len === lenLimit) { son[ptr1] = son[pair]; son[ptr0] = son[pair + 1]; return; }
      }
      if (data[pb0 + len] < data[cur + len]) { son[ptr1] = curMatch; ptr1 = pair + 1; curMatch = son[ptr1]; len1 = len; }
      else { son[ptr0] = curMatch; ptr0 = pair; curMatch = son[ptr0]; len0 = len; }
    }
  }

  // Writes [len, dist] pairs (lengths increasing) into matches; returns the count of numbers written.
  function getMatches() {
    let lenLimit = n - mfPos;
    if (lenLimit > niceLen) lenLimit = niceLen;
    if (lenLimit < 4) { movePos(); return 0; }
    const cur = mfPos;
    let temp = CRC[data[cur]] ^ data[cur + 1];
    const h2 = temp & 1023;
    temp ^= data[cur + 2] << 8;
    const h3 = temp & 0xFFFF;
    const hv = (temp ^ (CRC[data[cur + 3]] << 5)) & hashMask;
    let d2 = mfPos - hash2[h2];
    const d3 = mfPos - hash3[h3];
    let curMatch = hash4[hv];
    hash2[h2] = mfPos; hash3[h3] = mfPos; hash4[hv] = mfPos;
    let maxLen = 1, off = 0;
    if (d2 < cbs && data[cur - d2] === data[cur]) { matches[0] = maxLen = 2; matches[1] = d2 - 1; off = 2; }
    if (d2 !== d3 && d3 < cbs && data[cur - d3] === data[cur]) { maxLen = 3; matches[off + 1] = d3 - 1; off += 2; d2 = d3; }
    if (off !== 0) {
      while (maxLen !== lenLimit && data[cur + maxLen - d2] === data[cur + maxLen]) maxLen++;
      matches[off - 2] = maxLen;
      if (maxLen === lenLimit) { skipSpec(lenLimit, curMatch, cur); movePos(); return off; }
    }
    if (maxLen < 3) maxLen = 3;
    // the binary tree
    let ptr0 = (cyclicPos << 1) + 1, ptr1 = cyclicPos << 1;
    let len0 = 0, len1 = 0, cut = depth;
    for (;;) {
      const delta = mfPos - curMatch;
      if (cut-- === 0 || delta >= cbs) { son[ptr0] = son[ptr1] = EMPTY; break; }
      const pair = (cyclicPos - delta + (delta > cyclicPos ? cbs : 0)) << 1;
      const pb0 = cur - delta;
      let len = len0 < len1 ? len0 : len1;
      if (data[pb0 + len] === data[cur + len]) {
        while (++len !== lenLimit) if (data[pb0 + len] !== data[cur + len]) break;
        if (maxLen < len) {
          matches[off++] = maxLen = len; matches[off++] = delta - 1;
          if (len === lenLimit) { son[ptr1] = son[pair]; son[ptr0] = son[pair + 1]; break; }
        }
      }
      if (data[pb0 + len] < data[cur + len]) { son[ptr1] = curMatch; ptr1 = pair + 1; curMatch = son[ptr1]; len1 = len; }
      else { son[ptr0] = curMatch; ptr0 = pair; curMatch = son[ptr0]; len0 = len; }
    }
    movePos();
    return off;
  }
  function skip(num) {
    while (num-- > 0) {
      let lenLimit = n - mfPos;
      if (lenLimit > niceLen) lenLimit = niceLen;
      if (lenLimit < 4) { movePos(); continue; }
      const cur = mfPos;
      let temp = CRC[data[cur]] ^ data[cur + 1];
      const h2 = temp & 1023;
      temp ^= data[cur + 2] << 8;
      const h3 = temp & 0xFFFF;
      const hv = (temp ^ (CRC[data[cur + 3]] << 5)) & hashMask;
      const curMatch = hash4[hv];
      hash2[h2] = mfPos; hash3[h3] = mfPos; hash4[hv] = mfPos;
      skipSpec(lenLimit, curMatch, cur);
      movePos();
    }
  }

  // ---------------- encoder state ----------------
  let state = 0;
  const reps = [0, 0, 0, 0];
  let additionalOffset = 0, longestMatchLength = 0, numPairsSaved = 0, numAvail = 0;

  function readMatchDistances() {
    numAvail = n - mfPos;
    const np = getMatches();
    let lenRes = 0;
    if (np > 0) {
      lenRes = matches[np - 2];
      if (lenRes === niceLen) {
        const cur = mfPos - 1, dist = matches[np - 1] + 1;
        const avail = numAvail > MATCH_MAX ? MATCH_MAX : numAvail;
        while (lenRes < avail && data[cur + lenRes] === data[cur - dist + lenRes]) lenRes++;
      }
    }
    additionalOffset++;
    numPairsRes = np;
    return lenRes;
  }
  let numPairsRes = 0;
  function movePosBy(num) { if (num !== 0) { additionalOffset += num; skip(num); } }

  // the optimum buffer
  const oPrice = new Int32Array(NUM_OPTS + 1);
  const oState = new Uint8Array(NUM_OPTS + 1);
  const oPosPrev = new Int32Array(NUM_OPTS + 1);
  const oBackPrev = new Int32Array(NUM_OPTS + 1);
  const oPrev1IsChar = new Uint8Array(NUM_OPTS + 1);
  const oPrev2 = new Uint8Array(NUM_OPTS + 1);
  const oPosPrev2 = new Int32Array(NUM_OPTS + 1);
  const oBackPrev2 = new Int32Array(NUM_OPTS + 1);
  const oBacks = new Int32Array((NUM_OPTS + 1) * 4);
  let optEnd = 0, optCur = 0;
  let backRes = 0;
  const makeChar = (i) => { oBackPrev[i] = -1; oPrev1IsChar[i] = 0; };
  const makeShortRep = (i) => { oBackPrev[i] = 0; oPrev1IsChar[i] = 0; };

  function backward(cur) {
    let posMem = oPosPrev[cur], backMem = oBackPrev[cur];
    optEnd = cur;
    do {
      if (oPrev1IsChar[cur]) {
        makeChar(posMem);
        oPosPrev[posMem] = posMem - 1;
        if (oPrev2[cur]) {
          oPrev1IsChar[posMem - 1] = 0;
          oPosPrev[posMem - 1] = oPosPrev2[cur];
          oBackPrev[posMem - 1] = oBackPrev2[cur];
        }
      }
      const posPrev = posMem, backCur = backMem;
      backMem = oBackPrev[posPrev];
      posMem = oPosPrev[posPrev];
      oBackPrev[posPrev] = backCur;
      oPosPrev[posPrev] = cur;
      cur = posPrev;
    } while (cur !== 0);
    backRes = oBackPrev[0];
    optCur = oPosPrev[0];
    return optCur;
  }

  const repsL = [0, 0, 0, 0], repLens = [0, 0, 0, 0];

  function getOptimum(position) {
    if (optEnd !== optCur) {
      const lenRes = oPosPrev[optCur] - optCur;
      backRes = oBackPrev[optCur];
      optCur = oPosPrev[optCur];
      return lenRes;
    }
    optCur = optEnd = 0;
    let mainLen, numPairs;
    if (additionalOffset === 0) { mainLen = readMatchDistances(); numPairs = numPairsRes; }
    else { mainLen = longestMatchLength; numPairs = numPairsSaved; }

    let avail = numAvail;
    if (avail < 2) { backRes = -1; return 1; }
    if (avail > MATCH_MAX) avail = MATCH_MAX;

    const dp = mfPos - 1;              // the current byte
    let repMaxIndex = 0;
    for (let i = 0; i < NUM_REPS; i++) {
      repsL[i] = reps[i];
      const d2 = dp - (repsL[i] + 1);
      if (data[dp] !== data[d2] || data[dp + 1] !== data[d2 + 1]) { repLens[i] = 0; continue; }
      let lt = 2;
      while (lt < avail && data[dp + lt] === data[d2 + lt]) lt++;
      repLens[i] = lt;
      if (lt > repLens[repMaxIndex]) repMaxIndex = i;
    }
    if (repLens[repMaxIndex] >= niceLen) {
      backRes = repMaxIndex;
      const lenRes = repLens[repMaxIndex];
      movePosBy(lenRes - 1);
      return lenRes;
    }
    if (mainLen >= niceLen) {
      backRes = matches[numPairs - 1] + NUM_REPS;
      movePosBy(mainLen - 1);
      return mainLen;
    }
    const curByte = data[dp];
    const matchByte = data[dp - (repsL[0] + 1)];
    if (mainLen < 2 && curByte !== matchByte && repLens[repMaxIndex] < 2) { backRes = -1; return 1; }

    oState[0] = state;
    let posState = position & pbMask;
    {
      const lb = litBase(position, data[dp - 1]);
      oPrice[1] = price0(isMatch[(state << 4) + posState]) +
        (state >= 7 ? litPriceMatched(lb, curByte, matchByte) : litPrice(lb, curByte));
    }
    makeChar(1);
    let matchPrice = price1(isMatch[(state << 4) + posState]);
    let repMatchPrice = matchPrice + price1(isRep[state]);
    if (matchByte === curByte) {
      const shortRepPrice = repMatchPrice + repLen1Price(state, posState);
      if (shortRepPrice < oPrice[1]) { oPrice[1] = shortRepPrice; makeShortRep(1); }
    }
    let lenEnd = mainLen >= repLens[repMaxIndex] ? mainLen : repLens[repMaxIndex];
    if (lenEnd < 2) { backRes = oBackPrev[1]; return 1; }
    oPosPrev[1] = 0;
    for (let i = 0; i < NUM_REPS; i++) oBacks[i] = repsL[i];
    for (let len = lenEnd; len >= 2; len--) oPrice[len] = INFINITY_PRICE;

    for (let i = 0; i < NUM_REPS; i++) {
      let repLen = repLens[i];
      if (repLen < 2) continue;
      const price = repMatchPrice + pureRepPrice(i, state, posState);
      do {
        const p = price + repLenCoder.prices[posState * MATCH_MAX + repLen - 2];
        if (p < oPrice[repLen]) { oPrice[repLen] = p; oPosPrev[repLen] = 0; oBackPrev[repLen] = i; oPrev1IsChar[repLen] = 0; }
      } while (--repLen >= 2);
    }

    let normalMatchPrice = matchPrice + price0(isRep[state]);
    let len = repLens[0] >= 2 ? repLens[0] + 1 : 2;
    if (len <= mainLen) {
      let offs = 0;
      while (len > matches[offs]) offs += 2;
      for (; ; len++) {
        const distance = matches[offs + 1];
        let p = normalMatchPrice + lenCoder.prices[posState * MATCH_MAX + len - MATCH_MIN];
        const lps = len - 2 < 3 ? len - 2 : 3;
        if (distance < FULL_DISTANCES) p += distPrices[lps * FULL_DISTANCES + distance];
        else p += alignPrices[distance & 15] + posSlotPrices[(lps << 6) + posSlotOf(distance)];
        if (p < oPrice[len]) { oPrice[len] = p; oPosPrev[len] = 0; oBackPrev[len] = distance + NUM_REPS; oPrev1IsChar[len] = 0; }
        if (len === matches[offs]) { offs += 2; if (offs === numPairs) break; }
      }
    }

    let cur = 0;
    for (;;) {
      cur++;
      if (cur === lenEnd) return backward(cur);
      let newLen = readMatchDistances();
      numPairs = numPairsRes;
      if (newLen >= niceLen) {
        numPairsSaved = numPairs;
        longestMatchLength = newLen;
        return backward(cur);
      }
      position++;
      let posPrev = oPosPrev[cur];
      let st;
      if (oPrev1IsChar[cur]) {
        posPrev--;
        if (oPrev2[cur]) {
          st = oState[oPosPrev2[cur]];
          st = oBackPrev2[cur] < NUM_REPS ? REP_NEXT[st] : MATCH_NEXT[st];
        } else st = oState[posPrev];
        st = LIT_NEXT[st];
      } else st = oState[posPrev];
      if (posPrev === cur - 1) {
        st = oBackPrev[cur] === 0 ? SHORTREP_NEXT[st] : LIT_NEXT[st];
      } else {
        let pos;
        if (oPrev1IsChar[cur] && oPrev2[cur]) {
          posPrev = oPosPrev2[cur];
          pos = oBackPrev2[cur];
          st = REP_NEXT[st];
        } else {
          pos = oBackPrev[cur];
          st = pos < NUM_REPS ? REP_NEXT[st] : MATCH_NEXT[st];
        }
        const pb4 = posPrev * 4;
        if (pos < NUM_REPS) {
          repsL[0] = oBacks[pb4 + pos];
          let i = 1;
          for (; i <= pos; i++) repsL[i] = oBacks[pb4 + i - 1];
          for (; i < NUM_REPS; i++) repsL[i] = oBacks[pb4 + i];
        } else {
          repsL[0] = pos - NUM_REPS;
          for (let i = 1; i < NUM_REPS; i++) repsL[i] = oBacks[pb4 + i - 1];
        }
      }
      oState[cur] = st;
      const cb4 = cur * 4;
      oBacks[cb4] = repsL[0]; oBacks[cb4 + 1] = repsL[1]; oBacks[cb4 + 2] = repsL[2]; oBacks[cb4 + 3] = repsL[3];

      const curPrice = oPrice[cur];
      let nextIsChar = false;
      const dp2 = mfPos - 1;
      const cByte = data[dp2];
      const mByte = data[dp2 - (repsL[0] + 1)];
      posState = position & pbMask;
      let curAnd1Price = curPrice + price0(isMatch[(st << 4) + posState]);
      {
        const lb = litBase(position, data[dp2 - 1]);
        curAnd1Price += st >= 7 ? litPriceMatched(lb, cByte, mByte) : litPrice(lb, cByte);
      }
      const nx = cur + 1;
      if (curAnd1Price < oPrice[nx]) { oPrice[nx] = curAnd1Price; oPosPrev[nx] = cur; makeChar(nx); nextIsChar = true; }
      matchPrice = curPrice + price1(isMatch[(st << 4) + posState]);
      repMatchPrice = matchPrice + price1(isRep[st]);
      if (mByte === cByte && !(oPosPrev[nx] < cur && oBackPrev[nx] === 0)) {
        const shortRepPrice = repMatchPrice + repLen1Price(st, posState);
        if (shortRepPrice <= oPrice[nx]) { oPrice[nx] = shortRepPrice; oPosPrev[nx] = cur; makeShortRep(nx); nextIsChar = true; }
      }
      let availFull = numAvail;
      { const t = NUM_OPTS - 1 - cur; if (t < availFull) availFull = t; }
      if (availFull < 2) continue;
      const av = availFull <= niceLen ? availFull : niceLen;

      if (!nextIsChar && mByte !== cByte) {
        // literal + rep0
        const d2 = dp2 - (repsL[0] + 1);
        let limit = niceLen + 1;
        if (limit > availFull) limit = availFull;
        let t = 1;
        while (t < limit && data[dp2 + t] === data[d2 + t]) t++;
        const lenTest2 = t - 1;
        if (lenTest2 >= 2) {
          const state2 = LIT_NEXT[st];
          const psn = (position + 1) & pbMask;
          const nextRepMatchPrice = curAnd1Price + price1(isMatch[(state2 << 4) + psn]) + price1(isRep[state2]);
          const offset = cur + 1 + lenTest2;
          while (lenEnd < offset) oPrice[++lenEnd] = INFINITY_PRICE;
          const p = nextRepMatchPrice + repPrice(0, lenTest2, state2, psn);
          if (p < oPrice[offset]) { oPrice[offset] = p; oPosPrev[offset] = cur + 1; oBackPrev[offset] = 0; oPrev1IsChar[offset] = 1; oPrev2[offset] = 0; }
        }
      }

      let startLen = 2;
      for (let repIndex = 0; repIndex < NUM_REPS; repIndex++) {
        const d2 = dp2 - (repsL[repIndex] + 1);
        if (data[dp2] !== data[d2] || data[dp2 + 1] !== data[d2 + 1]) continue;
        let lenTest = 2;
        while (lenTest < av && data[dp2 + lenTest] === data[d2 + lenTest]) lenTest++;
        while (lenEnd < cur + lenTest) oPrice[++lenEnd] = INFINITY_PRICE;
        const lenTestTemp = lenTest;
        const price = repMatchPrice + pureRepPrice(repIndex, st, posState);
        do {
          const p = price + repLenCoder.prices[posState * MATCH_MAX + lenTest - 2];
          const k = cur + lenTest;
          if (p < oPrice[k]) { oPrice[k] = p; oPosPrev[k] = cur; oBackPrev[k] = repIndex; oPrev1IsChar[k] = 0; }
        } while (--lenTest >= 2);
        lenTest = lenTestTemp;
        if (repIndex === 0) startLen = lenTest + 1;
        {
          // rep + literal + rep0
          let lenTest2 = lenTest + 1;
          let limit = lenTest2 + niceLen;
          if (limit > availFull) limit = availFull;
          while (lenTest2 < limit && data[dp2 + lenTest2] === data[d2 + lenTest2]) lenTest2++;
          lenTest2 -= lenTest + 1;
          if (lenTest2 >= 2) {
            let state2 = REP_NEXT[st];
            let psn = (position + lenTest) & pbMask;
            const curAndLenCharPrice = price + repLenCoder.prices[posState * MATCH_MAX + lenTest - 2] +
              price0(isMatch[(state2 << 4) + psn]) +
              litPriceMatched(litBase(position + lenTest, data[dp2 + lenTest - 1]), data[dp2 + lenTest], data[d2 + lenTest]);
            state2 = LIT_NEXT[state2];
            psn = (position + lenTest + 1) & pbMask;
            const nextRepMatchPrice = curAndLenCharPrice + price1(isMatch[(state2 << 4) + psn]) + price1(isRep[state2]);
            const offset = cur + lenTest + 1 + lenTest2;
            while (lenEnd < offset) oPrice[++lenEnd] = INFINITY_PRICE;
            const p = nextRepMatchPrice + repPrice(0, lenTest2, state2, psn);
            if (p < oPrice[offset]) {
              oPrice[offset] = p; oPosPrev[offset] = cur + lenTest + 1; oBackPrev[offset] = 0;
              oPrev1IsChar[offset] = 1; oPrev2[offset] = 1; oPosPrev2[offset] = cur; oBackPrev2[offset] = repIndex;
            }
          }
        }
      }

      if (newLen > av) {
        newLen = av;
        numPairs = 0;
        while (newLen > matches[numPairs]) numPairs += 2;
        matches[numPairs] = newLen;
        numPairs += 2;
      }
      if (newLen >= startLen) {
        normalMatchPrice = matchPrice + price0(isRep[st]);
        while (lenEnd < cur + newLen) oPrice[++lenEnd] = INFINITY_PRICE;
        let offs = 0;
        while (startLen > matches[offs]) offs += 2;
        let curBack = matches[offs + 1];
        let posSlot = posSlotOf(curBack);
        for (let lenTest = startLen; ; lenTest++) {
          let p = normalMatchPrice + lenCoder.prices[posState * MATCH_MAX + lenTest - MATCH_MIN];
          const lps = lenTest - 2 < 3 ? lenTest - 2 : 3;
          if (curBack < FULL_DISTANCES) p += distPrices[lps * FULL_DISTANCES + curBack];
          else p += posSlotPrices[(lps << 6) + posSlot] + alignPrices[curBack & 15];
          const k = cur + lenTest;
          if (p < oPrice[k]) { oPrice[k] = p; oPosPrev[k] = cur; oBackPrev[k] = curBack + NUM_REPS; oPrev1IsChar[k] = 0; }
          if (lenTest === matches[offs]) {
            // match + literal + rep0
            const d2 = dp2 - (curBack + 1);
            let lenTest2 = lenTest + 1;
            let limit = lenTest2 + niceLen;
            if (limit > availFull) limit = availFull;
            while (lenTest2 < limit && data[dp2 + lenTest2] === data[d2 + lenTest2]) lenTest2++;
            lenTest2 -= lenTest + 1;
            if (lenTest2 >= 2) {
              let state2 = MATCH_NEXT[st];
              let psn = (position + lenTest) & pbMask;
              const curAndLenCharPrice = p + price0(isMatch[(state2 << 4) + psn]) +
                litPriceMatched(litBase(position + lenTest, data[dp2 + lenTest - 1]), data[dp2 + lenTest], data[d2 + lenTest]);
              state2 = LIT_NEXT[state2];
              psn = (psn + 1) & pbMask;
              const nextRepMatchPrice = curAndLenCharPrice + price1(isMatch[(state2 << 4) + psn]) + price1(isRep[state2]);
              const offset = cur + lenTest + 1 + lenTest2;
              while (lenEnd < offset) oPrice[++lenEnd] = INFINITY_PRICE;
              const p2 = nextRepMatchPrice + repPrice(0, lenTest2, state2, psn);
              if (p2 < oPrice[offset]) {
                oPrice[offset] = p2; oPosPrev[offset] = cur + lenTest + 1; oBackPrev[offset] = 0;
                oPrev1IsChar[offset] = 1; oPrev2[offset] = 1; oPosPrev2[offset] = cur; oBackPrev2[offset] = curBack + NUM_REPS;
              }
            }
            offs += 2;
            if (offs === numPairs) break;
            curBack = matches[offs + 1];
            if (curBack >= FULL_DISTANCES) posSlot = posSlotOf(curBack);
          }
        }
      }
    }
  }

  // ---------------- the main loop ----------------
  if (n > 0) {
    readMatchDistances();
    encBit(isMatch, (state << 4), 0);
    state = LIT_NEXT[state];
    encLiteral(litBase(0, 0), data[0]);
    additionalOffset--;
    let nowPos = 1;
    while (nowPos < n) {
      const len = getOptimum(nowPos);
      const pos = backRes;
      if (!(len >= 1)) throw new Error('lzma encoder: no progress at ' + nowPos);
      if (o.progress && (nowPos & 0xFFFFF) < len) o.progress(nowPos);
      const posState = nowPos & pbMask;
      if (len === 1 && pos === -1) {
        encBit(isMatch, (state << 4) + posState, 0);
        const at = mfPos - additionalOffset;
        const lb = litBase(nowPos, data[at - 1]);
        if (state < 7) encLiteral(lb, data[at]);
        else encLiteralMatched(lb, data[at], data[at - reps[0] - 1]);
        state = LIT_NEXT[state];
      } else {
        encBit(isMatch, (state << 4) + posState, 1);
        if (pos < NUM_REPS) {
          encBit(isRep, state, 1);
          if (pos === 0) {
            encBit(isRepG0, state, 0);
            encBit(isRep0Long, (state << 4) + posState, len === 1 ? 0 : 1);
          } else {
            const distance = reps[pos];
            encBit(isRepG0, state, 1);
            if (pos === 1) encBit(isRepG1, state, 0);
            else {
              encBit(isRepG1, state, 1);
              encBit(isRepG2, state, pos - 2);
              if (pos === 3) reps[3] = reps[2];
              reps[2] = reps[1];
            }
            reps[1] = reps[0];
            reps[0] = distance;
          }
          if (len === 1) state = SHORTREP_NEXT[state];
          else { repLenCoder.encode(len - MATCH_MIN, posState); state = REP_NEXT[state]; }
        } else {
          encBit(isRep, state, 0);
          state = MATCH_NEXT[state];
          lenCoder.encode(len - MATCH_MIN, posState);
          const dist = pos - NUM_REPS;
          const slot = posSlotOf(dist);
          encTree(posSlotProbs, (len - 2 < 3 ? len - 2 : 3) << 6, 6, slot);
          if (slot >= 4) {
            const footer = (slot >> 1) - 1;
            const base = ((2 | (slot & 1)) << footer) >>> 0;
            const reduced = dist - base;
            if (slot < END_POS_MODEL) encTreeRev(posSpec, base - slot, footer, reduced);
            else {
              encDirect(reduced >>> ALIGN_BITS, footer - ALIGN_BITS);
              encTreeRev(alignProbs, 0, ALIGN_BITS, reduced & 15);
              alignPriceCount++;
            }
          }
          reps[3] = reps[2]; reps[2] = reps[1]; reps[1] = reps[0]; reps[0] = dist;
          matchPriceCount++;
        }
      }
      nowPos += len;
      additionalOffset -= len;
      if (additionalOffset === 0) {
        if (matchPriceCount >= 128) fillDistPrices();
        if (alignPriceCount >= 16) fillAlignPrices();
      }
    }
  }
  for (let i = 0; i < 5; i++) shiftLow();
  return out.subarray(0, outPos);
}

module.exports = { lzmaEncode };
