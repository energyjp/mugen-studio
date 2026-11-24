// WebMUGEN lite - the packer's worker thread: one job per message.
//   { kind: 'lzma', buf, lc, lp, pb, dictSize }  -> { out }
//   { kind: 'spr', pix, images }                  -> { out, refs }
//   { kind: 'sff', bytes }                        -> { bytes, sprites, before, after } or { bytes: null }
//   { kind: 'analyze', vpath, bytes }             -> { ops, stats }
//   { kind: 'unpack', bytes, chunk }              -> { out }
// Each compressed stream is decoded again here and compared before it is
// sent back, so a stream that would not rebuild never reaches game.lite.
// sff / analyze / unpack are pngsff.canonicalSffV2, transform.analyze and
// unpack-core.unpackChunk, run here so the export's own thread stays free.
// Every buffer sent back is a fresh one of its own (never a view into a
// bigger or a pooled one), so it can be handed over without a copy.
'use strict';
const { parentPort } = require('worker_threads');
const { lzmaEncode } = require('./lzmaenc.js');
const { lzmaDecode } = require('./lzma.js');
const SC = require('./spritecodec.js');
let P = null, T = null, U = null;          // loaded on first use

// a Buffer over the bytes a message brought (transform and pngsff read with Buffer methods)
const asBuffer = (u8) => Buffer.from(u8.buffer, u8.byteOffset, u8.length);
// a copy in a buffer of its own, safe to hand over
function own(u8) {
  if (u8.byteOffset === 0 && u8.byteLength === u8.buffer.byteLength && !Buffer.isBuffer(u8)) return u8;
  const c = new Uint8Array(u8.length); c.set(u8); return c;
}

function same(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

parentPort.on('message', (m) => {
  try {
    if (m.kind === 'lzma') {
      const out = lzmaEncode(m.buf, { lc: m.lc, lp: m.lp, pb: m.pb, dictSize: m.dictSize });
      const back = new Uint8Array(m.buf.length);
      if (m.buf.length) lzmaDecode(out, 0, back, 0, m.buf.length, m.lc, m.lp, m.pb);
      if (!same(back, m.buf)) throw new Error('the LZMA encoder did not round-trip');
      const copy = out.slice();
      parentPort.postMessage({ id: m.id, out: copy }, [copy.buffer]);
    } else if (m.kind === 'spr') {
      let base = 0;
      for (const im of m.images) { im.base = base; base += im.stride * im.h; }
      SC.pickRefs(m.pix, m.images);
      const out = SC.packStream(m.pix, m.images);
      const back = new Uint8Array(m.pix.length);
      SC.unpackStream(out, back);
      if (!same(back, m.pix)) throw new Error('the sprite compressor did not round-trip');
      parentPort.postMessage({ id: m.id, out, refs: m.images.filter((im) => im.ref >= 0).length }, [out.buffer]);
    } else if (m.kind === 'sff') {
      P = P || require('./pngsff.js');
      const r = P.canonicalSffV2(asBuffer(m.bytes));
      if (!r) { parentPort.postMessage({ id: m.id, bytes: null }); return; }
      const bytes = own(r.bytes);
      parentPort.postMessage({ id: m.id, bytes, sprites: r.sprites, before: r.before, after: r.after }, [bytes.buffer]);
    } else if (m.kind === 'analyze') {
      T = T || require('./transform.js');
      const stats = T.newStats();
      const ops = T.analyze(m.vpath, asBuffer(m.bytes), stats);
      const give = new Set();
      for (const op of ops) if (op.raw) { op.raw = own(op.raw); give.add(op.raw.buffer); }
      parentPort.postMessage({ id: m.id, ops, stats }, [...give]);
    } else if (m.kind === 'unpack') {
      U = U || require('./unpack-core.js');
      const out = own(U.unpackChunk(m.bytes, m.chunk));
      parentPort.postMessage({ id: m.id, out }, [out.buffer]);
    } else throw new Error('unknown job ' + m.kind);
  } catch (e) {
    parentPort.postMessage({ id: m.id, error: String((e && e.message) || e) });
  }
});
