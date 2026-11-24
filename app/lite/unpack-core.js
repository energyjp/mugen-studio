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
