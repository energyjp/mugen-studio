// WebMUGEN lite - turn a finished Website export into a lite one, in place.
//
//   liteInPlace(dir, { ffmpeg, log }) -> Promise<report>   (server.js /api/export)
//   node lite/pack.js <export folder> <new folder> [--ffmpeg PATH] [--exact]   (a copy; the export is only read)
//
// What changes in the folder: ikemen-fs/game.pak and ikemen.wasm are replaced
// by one ikemen-fs/game.lite, and manifest.json says so ("lite" instead of
// "pack"). Every other file stays as the export wrote it: the boot pages and
// vfs.js already carry the lite branch and lite.js (public/ikemen), which do
// nothing unless the manifest names a lite file.
//
// How it shrinks (docs/LITE.md has the numbers):
//   - sprites stored run-length encoded (SFF v1 PCX, SFF v2 RLE8) travel as
//     plain pixels and are encoded again in the browser to the SAME BYTES,
//     checked here for every sprite
//   - PNG sprites in SFF v2 are written again once with this project's own
//     deflate (pngsff.js) so they can travel as pixels too: those SFF files
//     hold the same sprites, palettes and tables in different bytes (proven per
//     file), which changes the Build ID - a lite build plays lite builds
//   - character sounds travel as MP3 (LAME V6) and are decoded by the
//     browser before the engine starts, when an ffmpeg with libmp3lame is
//     given; without one they stay lossless
//   - everything else is LZMA (lzmaenc.js, built in - no outside program) in
//     chunks the page rebuilds on several threads; identical files once
//
// The last step rebuilds every file from the game.lite just written, with the
// page's own code (unpack-core.js), and compares. A build that does not match
// is not finished: the export folder is left as the full build it was.
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { Worker } = require('worker_threads');
const T = require('./transform.js');
const C = require('./codecs.js');
const U = require('./unpack-core.js');
const P = require('./pngsff.js');
const S = require('./sounds.js');
const K = require('./keepsounds.js');

const MAGIC = 'WMLITE1\n';
const PAGE_PARTS = ['lzma.js', 'codecs.js', 'spritecodec.js', 'unpack-core.js', 'lite-main.js'];
const mb = (n) => (n / 1048576).toFixed(1) + ' MB';
// A window bigger than this buys almost nothing on this content (a chunk is
// about 32 MB) and costs each thread about 9 bytes of memory per byte of window.
const MAX_DICT = 32 << 20;
// A GIANT GROUP of files that share sprites (many characters built on the same
// Capcom or SNK sprites) is cut into pieces, so it compresses on several
// threads here and unpacks on several in the browser. Only a group above
// GIANT is cut: a build without one gives the same game.lite as before (the
// author's site's biggest group is 242 MB). PIECE is the size each piece aims
// for (DEVLOG 2026-11-23 has the measurements).
const GIANT = 512 * 1048576;
const PIECE = 128 * 1048576;
// A Website export whose game data is bigger than this is a full build unless
// the person asked for lite (server.js /api/export lite: 'auto'). Unpacking is
// paid on every visit (the 2.5 GB REV 2 build: 42-55 s in Chrome even with its
// giant groups cut, against 11 s for a 476 MB site), and the page holds
// game.lite and every rebuilt file at once.
const AUTO_MAX = 1500 * 1e6;

// The page's unpacker: the five modules end to end. public/ikemen/lite.js is
// this text exactly (tools/test-lite.js holds the two together).
function pageScript() {
  return '// WebMUGEN lite - the page-side unpacker (' + PAGE_PARTS.join(' + ') + ').\n' +
    '// Made from lite/ by `node lite/pack.js --page`; edit those files, not this one.\n' +
    PAGE_PARTS.map((f) => fs.readFileSync(path.join(__dirname, f), 'utf8').replace(/\r\n/g, '\n')).join('\n');
}

function varint(n) {
  const out = [];
  while (n >= 128) { out.push((n % 128) | 0x80); n = Math.floor(n / 128); }
  out.push(n);
  return out;
}

// ---- one file -> its ops, appended to the chunk's streams -----------------
function addFile(chunk, b, ops) {
  const rec = chunk.parts.ops;
  rec.push(Buffer.from(varint(ops.length)));
  for (const op of ops) {
    const src = b.subarray(op.off, op.off + op.len);
    if (op.t === 'copy') { rec.push(Buffer.from([U.OP_COPY, ...varint(op.len)])); chunk.parts.copy.push(src); chunk.raw += op.len; }
    else if (op.t === 'store') { rec.push(Buffer.from([U.OP_STORE, ...varint(op.len)])); chunk.parts.store.push(src); }
    else if (op.t === 'pcx') { rec.push(Buffer.from([U.OP_PCX, ...varint(op.raw.length), ...varint(op.line)])); chunk.parts.pix.push(op.raw); chunk.raw += op.raw.length; chunk.images.push({ stride: op.stride, h: op.raw.length / op.stride, ax: op.ax, ay: op.ay }); }
    else if (op.t === 'rle8') { rec.push(Buffer.from([U.OP_RLE8, ...varint(op.raw.length), ...varint(op.line), ...varint(op.min)])); chunk.parts.pix.push(op.raw); chunk.raw += op.raw.length; chunk.images.push({ stride: op.stride, h: op.raw.length / op.stride, ax: op.ax, ay: op.ay }); }
    else if (op.t === 'png') {
      rec.push(Buffer.from([U.OP_PNG, ...varint(op.raw.length), ...varint(op.rowBytes), ...varint(op.bpp), ...varint(op.filter)]));
      chunk.parts[op.bpp === 1 ? 'pix' : 'rgba'].push(op.raw); chunk.raw += op.raw.length;
      if (op.bpp === 1) chunk.images.push({ stride: op.stride, h: op.raw.length / op.stride, ax: op.ax, ay: op.ay });
    }
    else if (op.t === 'zero') { rec.push(Buffer.from([U.OP_ZERO, ...varint(op.len)])); }
    else if (op.t === 'pcm') {
      const d = Buffer.alloc(op.len);
      C.pcmForward(b, op.off, op.len, op.width, op.ch, d, 0);
      rec.push(Buffer.from([U.OP_PCM, ...varint(op.len), ...varint(op.width), ...varint(op.ch)]));
      chunk.parts.pcm.push(d); chunk.raw += op.len;
    }
  }
  chunk.out += b.length;
  chunk.n++;
}
const newChunk = () => ({ parts: { ops: [], copy: [], pix: [], rgba: [], pcm: [], store: [] }, images: [], raw: 0, out: 0, n: 0 });

// ---- a pool of worker threads (lzmaenc.js and the sprite compressor) -------
// THE EXPORT'S THREAD IS THE STUDIO'S SERVER: a long loop here lets it answer
// in between (the export's progress line asks every 2 s), at most every 50 ms.
let lastBreath = 0;
async function breathe() {
  if (Date.now() - lastBreath < 50) return;
  await new Promise((r) => setImmediate(r));
  lastBreath = Date.now();
}

function workerPool(n) {
  const idle = [], all = [], waiting = [];
  let seq = 0;
  for (let i = 0; i < n; i++) { const w = new Worker(path.join(__dirname, 'pack-worker.js')); all.push(w); idle.push(w); }
  function run(msg, transfer) {
    return new Promise((resolve, reject) => {
      const go = (w) => {
        const id = ++seq;
        const done = () => { w.removeAllListeners('message'); w.removeAllListeners('error'); const next = waiting.shift(); if (next) next(w); else idle.push(w); };
        w.on('message', (m) => { if (m.id !== id) return; done(); if (m.error) reject(new Error(m.error)); else resolve(m); });
        w.once('error', (e) => { done(); reject(e); });
        w.postMessage(Object.assign({ id }, msg), transfer || []);
      };
      const w = idle.pop();
      if (w) go(w); else waiting.push(go);
    });
  }
  return { run, size: n, close: () => Promise.all(all.map((w) => w.terminate())) };
}

// How many threads at once: one per core but one (up to 16), and no more than
// memory allows (a 32 MB stream takes about 400 MB while it is being encoded).
function jobCount(opt) {
  if (opt.jobs) return opt.jobs;
  const byCpu = Math.max(1, Math.min(16, os.cpus().length - 1));
  const byMem = Math.max(1, Math.floor((os.totalmem() - 3 * 1073741824) / (512 * 1048576)));
  return Math.max(1, Math.min(byCpu, byMem));
}

// Runs the tasks n at a time, in the order given (put the longest first: the
// last one to start sets when everything is done).
async function limit(n, tasks) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, tasks.length) }, async () => {
    while (next < tasks.length) { const i = next++; await tasks[i](); }
  }));
}

// WHAT THE LITE STEP IS DOING, for the export's progress line (server.js
// /api/export-status). One step at a time: how many of its jobs are done, and
// the biggest one still running, which is what the last minutes wait on.
function tracker(status, step, total) {
  let done = 0;
  const running = new Map();
  let seq = 0;
  const say = () => {
    let big = 0;
    for (const n of running.values()) if (n > big) big = n;
    status({ step, done, total, busy: running.size, bigMb: Math.round(big / 1048576) });
  };
  say();
  return {
    // wraps one job: counted while it runs, and done after
    wrap: (size, fn) => async () => {
      const id = ++seq;
      running.set(id, size || 0); say();
      try { return await fn(); } finally { running.delete(id); done++; say(); }
    },
  };
}

// The files of one sprite-sharing group, cut into pieces of about PIECE each.
// Each file hangs under the earlier file it shares the most sprites with
// (`parent`); the group is walked tree by tree, a file right after its
// parent, and the walk is cut in order. So a character's edits mostly land in
// the same piece as the original they share frames with.
function splitGroup(l, items, giant, piece) {
  let total = 0;
  for (const i of l) total += items[i].cost;
  if (total <= giant) return [l];
  const inGroup = new Set(l);
  const kids = new Map();
  const roots = [];
  for (const i of l) {
    const p = items[i].parent;
    if (p >= 0 && inGroup.has(p)) { if (!kids.has(p)) kids.set(p, []); kids.get(p).push(i); }
    else roots.push(i);
  }
  const order = [];
  for (const r of roots) {
    const stack = [r];
    while (stack.length) {
      const i = stack.pop();
      order.push(i);
      const k = kids.get(i);
      if (k) for (let j = k.length - 1; j >= 0; j--) stack.push(k[j]);
    }
  }
  const n = Math.max(2, Math.round(total / piece));
  const target = total / n;
  const pieces = [];
  let cur = [], size = 0;
  for (const i of order) {
    cur.push(i); size += items[i].cost;
    if (size >= target && pieces.length < n - 1) { pieces.push(cur); cur = []; size = 0; }
  }
  if (cur.length) pieces.push(cur);
  return pieces;
}

// ---- find an ffmpeg that can write MP3 ------------------------------------
// `want`: a program, or a folder holding one (its bin\ too). '' tries PATH.
function findFfmpeg(want) {
  const exe = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  const tries = [];
  const w = String(want || '').trim();
  if (w) {
    let st = null;
    try { st = fs.statSync(w); } catch (e) { st = null; }
    if (st && st.isDirectory()) tries.push(path.join(w, exe), path.join(w, 'bin', exe));
    else tries.push(w);
  } else tries.push('ffmpeg');
  for (const p of tries) {
    if (p !== 'ffmpeg' && !fs.existsSync(p)) continue;
    if (S.haveFfmpeg({ ffmpeg: p })) return { path: p, why: '' };
  }
  const exists = tries.find((p) => p !== 'ffmpeg' && fs.existsSync(p));
  return { path: '', why: exists ? 'the ffmpeg at ' + exists + ' cannot write MP3 (it was built without libmp3lame)' : (w ? 'no ffmpeg at ' + w : 'no ffmpeg was set in Options, and none is on PATH') };
}

// ---- the packer ------------------------------------------------------------
// files: Map vpath -> Buffer, in the build's order. wasm: Buffer or null.
// Writes game.lite to `outFile`; returns its header facts and the reference
// bytes every file must rebuild to (PNG sprites rewritten).
async function packFiles(files, wasm, outFile, opt) {
  const log = opt.log || (() => {});
  const t0 = Date.now();
  const sounds = opt.ffmpegPath ? 'lossy' : 'keep';
  const soundQ = opt.soundQuality || 6;
  const png = opt.exact ? 'keep' : 'repack';
  const lossy = opt.exact ? 'keep' : sounds;

  // Every heavy step runs on the worker threads (pack-worker.js): this thread
  // is the Studio's server during an export, and it only hands work out.
  const pool = opt.pool || workerPool(jobCount(opt));
  const jobs = pool.size;
  const status = opt.status || (() => {});
  const giant = opt.giantMb ? opt.giantMb * 1048576 : GIANT;
  const piece = opt.pieceMb ? opt.pieceMb * 1048576 : PIECE;
  try {
  const ref = new Map();
  const repacked = { files: 0, sprites: 0, before: 0, after: 0 };
  const sffJobs = [];
  for (const [vpath, data] of files) {
    ref.set(vpath, data);                 // the build's order; a rewritten SFF replaces its bytes in place
    if (png === 'repack' && /\.sff$/i.test(vpath) && data.length >= 512) sffJobs.push({ size: data.length, run: async () => {
      const r = await pool.run({ kind: 'sff', bytes: data });
      if (r.bytes) { ref.set(vpath, Buffer.from(r.bytes.buffer, r.bytes.byteOffset, r.bytes.length)); repacked.files++; repacked.sprites += r.sprites; repacked.before += r.before; repacked.after += r.after; }
    } });
  }
  { const tr = tracker(status, 'sff', sffJobs.length); await limit(jobs, sffJobs.sort((a, z) => z.size - a.size).map((j) => tr.wrap(j.size, j.run))); }
  if (repacked.files) log(`PNG sprites written again: ${repacked.sprites} sprites in ${repacked.files} files, same pixels`);

  // ---- take every file apart, into chunks ----
  const stats = T.newStats();
  const chunks = [];
  const list = [];                        // [vpath, size, chunkIndex] or [vpath, size, -1, sameAs]
  const seen = new Map();
  const items = [];
  const clips = [];
  let cur = newChunk();
  let dupBytes = 0;
  const limitBytes = (opt.chunkMb || 32) * 1048576;
  const kept = [];
  // Which .snd sounds may go lossy (keepsounds.js): a character's own, and of
  // those not the ones its states play looped. A file stored once for several
  // identical ones goes lossy only where every one of them may.
  const plan = lossy === 'lossy' ? K.plan(ref) : null;
  const keepWhole = new Set();
  for (const [vpath, b] of ref) {
    await breathe();
    const len = b.length;
    if (len >= 1024) {
      const h = crypto.createHash('sha1').update(b).digest('hex');
      const first = seen.get(h);
      if (first) {
        list.push([vpath, len, -1, first]); dupBytes += len;
        if (plan && /\.snd$/i.test(vpath)) {
          if (!plan.charSnd.has(vpath)) keepWhole.add(first);
          else if (plan.loops.has(vpath)) { const l = plan.loops.get(first) || new Set(); for (const k of plan.loops.get(vpath)) l.add(k); plan.loops.set(first, l); }
        }
        continue;
      }
      seen.set(h, vpath);
    }
    const entry = [vpath, len, 0];
    list.push(entry);
    kept.push({ vpath, b, entry, ops: null });
  }
  {
    const tr = tracker(status, 'analyze', kept.length);
    await limit(jobs, kept.slice().sort((a, z) => z.b.length - a.b.length).map((k) => tr.wrap(k.b.length, async () => {
      const r = await pool.run({ kind: 'analyze', vpath: k.vpath, bytes: k.b });
      k.ops = r.ops;
      for (const key of Object.keys(r.stats)) stats[key] += r.stats[key];
    })));
  }
  const exact = { files: 0, clips: 0, looped: 0, loopedClips: 0 };
  for (const { vpath, b, entry, ops } of kept) {
    await breathe();
    // Only a character's .snd sounds go to MP3. A .wav file is a stage's or a
    // screen's music as often as not (bgmusic = x.wav), and music is never
    // touched: its samples stay lossless. The screenpack's .snd, fight.snd and
    // common.snd stay exact (menu and select sounds are heard most), and so
    // does a character sound its states play looped (keepsounds.js).
    if (lossy === 'lossy' && /\.snd$/i.test(vpath)) {
      const own = plan.charSnd.has(vpath) && !keepWhole.has(vpath);
      const loops = own ? plan.loops.get(vpath) : null;
      const where = loops ? K.entries(b) : null;
      let keptN = 0, loopedN = 0;
      for (const op of ops) {
        if (op.t !== 'pcm' || !S.eligible(op)) continue;
        if (!own) { keptN++; continue; }
        if (loops && loops.has(K.keyAt(where, op.off))) { loopedN++; continue; }
        op.t = 'zero'; stats.pcmBytes -= op.len;
      }
      if (keptN) { exact.files++; exact.clips += keptN; }
      if (loopedN) { exact.looped++; exact.loopedClips += loopedN; }
    }
    let cost = 0, pixBytes = 0;
    const sprites = new Map();
    for (const op of ops) {
      cost += op.raw ? op.raw.length : op.len;
      if (op.raw && op.raw.length >= 256) {
        const h = crypto.createHash('sha1').update(op.raw).digest('latin1');
        sprites.set(h, op.raw.length); pixBytes += op.raw.length;
      }
    }
    items.push({ b, ops, entry, cost, sprites, pixBytes, group: items.length });
  }
  // FILES THAT SHARE SPRITES TRAVEL TOGETHER: an edit of a character carries
  // most of the original's frames, and in one chunk the second copy costs
  // almost nothing. A file joins an earlier file's group when a quarter of its
  // pixels are sprites that one has too.
  {
    const owner = new Map();
    const find = (i) => { while (items[i].group !== i) i = items[i].group = items[items[i].group].group; return i; };
    items.forEach((it, i) => {
      const shared = new Map();
      for (const [h, n] of it.sprites) {
        const j = owner.get(h);
        if (j === undefined) owner.set(h, i);
        else shared.set(j, (shared.get(j) || 0) + n);
      }
      let best = -1, bestN = 0;
      for (const [j, n] of shared) if (it.pixBytes && n >= it.pixBytes / 4) {
        const a = find(i), z = find(j); if (a !== z) items[Math.max(a, z)].group = Math.min(a, z);
        if (n > bestN) { bestN = n; best = j; }
      }
      it.parent = best;                   // where splitGroup hangs it, if its group is cut
    });
    const units = new Map();
    items.forEach((it, i) => { const g = find(i); if (!units.has(g)) units.set(g, []); units.get(g).push(i); it.sprites = null; });
    let members = [], size = 0;
    const close = () => {
      if (!members.length) return;
      members.sort((a, z) => a - z);      // the page hands files out in the build's order
      for (const i of members) {
        for (const op of items[i].ops) if (op.t === 'zero') clips.push({ b: items[i].b, off: op.off, len: op.len, width: op.width, ch: op.ch, rate: op.rate, chunk: chunks.length, at: cur.out + op.off });
        addFile(cur, items[i].b, items[i].ops); items[i].entry[2] = chunks.length; items[i].ops = null;
      }
      chunks.push(cur); cur = newChunk(); members = []; size = 0;
    };
    let cut = 0, cutInto = 0;
    for (const whole of units.values()) {
      await breathe();
      const parts = splitGroup(whole, items, giant, piece);
      if (parts.length > 1) { cut++; cutInto += parts.length; }
      for (const l of parts) {
        for (const i of l) { members.push(i); size += items[i].cost; }
        if (size >= limitBytes || parts.length > 1) close();   // each piece of a cut group is a chunk of its own
      }
    }
    close();
    if (cut) log(`${cut === 1 ? 'one group' : cut + ' groups'} of files sharing sprites, over ${mb(giant)}, cut into ${cutInto} pieces so they compress and unpack on several threads`);
  }
  let engine = null;
  if (wasm) {
    cur = newChunk();
    cur.parts.ops.push(Buffer.from([1, U.OP_COPY, ...varint(wasm.length)]));
    cur.parts.copy.push(wasm); cur.raw = wasm.length; cur.out = wasm.length; cur.n = 1;
    engine = { chunk: chunks.length, size: wasm.length };
    chunks.push(cur);
  }
  log(`taken apart: ${list.length} files in ${chunks.length} chunks; ${stats.pcxOk + stats.rleOk + stats.pngOk} sprites as pixels; identical files stored once: ${mb(dupBytes)}`);
  if (exact.files || exact.looped) log(`sounds kept exact: ${exact.clips} in ${exact.files} .snd files that are not a character's; ${exact.loopedClips} looped character sounds in ${exact.looped} files`);

  // ---- compress ----
  const PROPS = { ops: [3, 0, 2], copy: [3, 0, 2], pix: [3, 0, 2], rgba: [0, 2, 2], pcm: [3, 0, 2] };
  const tasks = [];
  const picks = [];
  let doneTasks = 0;
  {
    for (const ch of chunks) {
      await breathe();
      ch.s = {}; ch.bufs = {};
      for (const name of U.STREAMS) {
        const raw = Buffer.concat(ch.parts[name]);
        ch.parts[name] = null;
        if (!raw.length) continue;
        if (name === 'store') { ch.bufs[name] = raw; ch.s[name] = [raw.length, raw.length]; continue; }
        const [lc, lp, pb] = PROPS[name];
        let dictSize = 1 << 16;
        while (dictSize < raw.length && dictSize < MAX_DICT) dictSize <<= 1;
        const pick = { ch, name, rawLen: raw.length, props: [lc, lp, pb], lz: null, spr: null };
        picks.push(pick);
        const tick = () => { if (++doneTasks % 8 === 0 && opt.progress) opt.progress(doneTasks / tasks.length); };
        tasks.push({ size: raw.length, run: async () => {
          const u8 = new Uint8Array(raw.buffer, raw.byteOffset, raw.length);
          pick.lz = (await pool.run({ kind: 'lzma', buf: u8, lc, lp, pb, dictSize })).out;
          tick();
        } });
        // Sprite pixels are also tried with the sprite compressor, on a thread
        // of their own; the smaller is kept.
        if (name === 'pix' && opt.sprites !== 'lzma' && ch.images.length) tasks.push({ size: raw.length, run: async () => {
          const pix = new Uint8Array(raw.length); pix.set(raw);
          pick.spr = (await pool.run({ kind: 'spr', pix, images: ch.images }, [pix.buffer])).out;
          tick();
        } });
      }
    }
    const tracks = lossy === 'lossy' ? S.buildJobs(clips) : [];
    const encodes = tracks.map((j) => async () => { j.mp3 = await S.encodeJob(j, soundQ, { ffmpeg: opt.ffmpegPath }); j.pcm = null; });
    tasks.sort((a, z) => z.size - a.size);
    const tr = tracker(status, 'compress', tasks.length + encodes.length);
    await Promise.all([limit(jobs, tasks.map((t) => tr.wrap(t.size, t.run))), limit(Math.max(1, Math.min(4, jobs)), encodes.map((e) => tr.wrap(0, e)))]);
    status({ step: 'write' });
    for (const p of picks) {
      let best = { out: p.lz, s: [p.lz.length, p.rawLen, ...p.props] };
      if (p.spr && p.spr.length < p.lz.length) best = { out: p.spr, s: [p.spr.length, p.rawLen, 'spr'] };
      p.ch.bufs[p.name] = Buffer.from(best.out.buffer, best.out.byteOffset, best.out.length);
      p.ch.s[p.name] = best.s;
    }
    // each chunk's streams listed in the one order they are written in (the
    // page reads them in U.STREAMS order; the header's text should not depend
    // on which thread finished first)
    for (const ch of chunks) { const o = {}; for (const name of U.STREAMS) if (ch.s[name]) o[name] = ch.s[name]; ch.s = o; }
    log(`compressed in ${((Date.now() - t0) / 1000).toFixed(0)} s on ${jobs} threads` + (tracks.length ? `; ${clips.length} sound clips as ${tracks.length} MP3 tracks (V${soundQ})` : ''));

    // ---- write game.lite ----
    const headerChunks = chunks.map((ch) => {
      let len = 0, rawSum = 0;
      for (const name of U.STREAMS) if (ch.s[name]) { len += ch.s[name][0]; rawSum += ch.s[name][1]; }
      return { len, out: ch.out, n: ch.n, mem: len + rawSum + ch.out, s: ch.s };
    });
    const trackBytes = tracks.reduce((a, j) => a + j.mp3.length, 0);
    const header = { v: 1, mode: tracks.length ? 'lossy-sounds' : (png === 'repack' ? 'pixels' : 'exact'), stamp: opt.stamp || '', bytes: 0, chunks: headerChunks, files: list };
    if (engine) header.engine = engine;
    if (tracks.length) header.audio = tracks.map((j) => ({ len: j.mp3.length, rate: j.rate, ch: j.ch, lead: S.LEAD, clips: [].concat(...j.clips.map((x) => [x.clip.chunk, x.clip.at, x.start, x.n, x.clip.width])) }));
    const body = headerChunks.reduce((a, c) => a + c.len, 0) + trackBytes;
    let headJson;
    for (let guess = body; ; ) {
      header.bytes = guess;
      headJson = Buffer.from(JSON.stringify(header));
      const real = 12 + headJson.length + body;
      if (real === guess) break;
      guess = real;
    }
    const fd = fs.openSync(outFile, 'w');
    try {
      const lead = Buffer.alloc(12); lead.write(MAGIC, 'latin1'); lead.writeUInt32LE(headJson.length, 8);
      fs.writeSync(fd, lead); fs.writeSync(fd, headJson);
      for (const j of tracks) fs.writeSync(fd, j.mp3);
      for (const ch of chunks) for (const name of U.STREAMS) if (ch.bufs[name]) fs.writeSync(fd, ch.bufs[name]);
    } finally { fs.closeSync(fd); }
    for (const ch of chunks) ch.bufs = null;
    return { ref, header, tracks, repacked, sounds: lossy, wasm, exact };
  }
  } finally {
    if (!opt.pool) await pool.close();
  }
}

// ---- the check: rebuild from the file just written, with the page's own code
async function verify(liteFile, packed, opt) {
  const { ref, tracks, wasm } = packed;
  const lite = fs.readFileSync(liteFile);
  if (lite.toString('latin1', 0, 8) !== MAGIC) throw new Error('CHECK FAILED: game.lite does not start as one');
  const hl = lite.readUInt32LE(8);
  const h = JSON.parse(lite.subarray(12, 12 + hl).toString());
  let at = 12 + hl;
  const trackAt = [];
  for (const a of h.audio || []) { trackAt.push(at); at += a.len; }
  const spans = h.chunks.map((c, i) => { const span = { i, c, from: at }; at += c.len; return span; });
  if (at !== lite.length || h.bytes !== lite.length) throw new Error('CHECK FAILED: game.lite is not the size its header says');
  // Each chunk is rebuilt on a worker thread when there are some (the page
  // does the same, several chunks at once), the biggest first.
  const outs = new Array(spans.length);
  if (opt.pool) {
    const tr = tracker(opt.status || (() => {}), 'check', spans.length);
    await limit(opt.pool.size, spans.slice().sort((a, z) => z.c.mem - a.c.mem).map(({ i, c, from }) => tr.wrap(c.out, async () => {
      const bytes = new Uint8Array(c.len); bytes.set(lite.subarray(from, from + c.len));
      outs[i] = (await opt.pool.run({ kind: 'unpack', bytes, chunk: c }, [bytes.buffer])).out;
    })));
  } else for (const { i, c, from } of spans) outs[i] = U.unpackChunk(lite.subarray(from, from + c.len), c);
  // The holes left for lossy sound samples: each must still be empty, and is
  // left out of the comparison (the one thing that is not exact).
  const holes = outs.map(() => []);
  for (const a of h.audio || []) for (let k = 0; k < a.clips.length; k += 5) holes[a.clips[k]].push([a.clips[k + 1], a.clips[k + 3] * a.clips[k + 4] * a.ch]);
  for (const l of holes) l.sort((x, y) => x[0] - y[0]);
  const holeAt = outs.map(() => 0);
  const sameOutsideHoles = (got, want, ci, start) => {
    let p = 0;
    const l = holes[ci];
    while (holeAt[ci] < l.length && l[holeAt[ci]][0] < start + got.length) {
      const [ho, hlen] = l[holeAt[ci]++];
      const rel = ho - start;
      if (rel < p || rel + hlen > got.length) return false;
      if (Buffer.compare(got.subarray(p, rel), want.subarray(p, rel)) !== 0) return false;
      for (let i = rel; i < rel + hlen; i++) if (got[i] !== 0) return false;
      p = rel + hlen;
    }
    return Buffer.compare(got.subarray(p), want.subarray(p)) === 0;
  };
  const pos = new Array(outs.length).fill(0);
  const okByPath = new Map();
  let bad = 0;
  const badNames = [];
  for (const f of h.files) {
    await breathe();
    const [vpath, size, ci] = f;
    const want = ref.get(vpath);
    let ok;
    if (ci < 0) ok = !!(want && okByPath.get(f[3]) && Buffer.compare(want, ref.get(f[3])) === 0);
    else {
      const got = outs[ci].subarray(pos[ci], pos[ci] + size);
      pos[ci] += size;
      ok = !!(want && want.length === size && sameOutsideHoles(Buffer.from(got.buffer, got.byteOffset, got.length), want, ci, pos[ci] - size));
    }
    okByPath.set(vpath, ok);
    if (!ok) { bad++; if (badNames.length < 5) badNames.push(vpath); }
  }
  if (h.files.length !== ref.size) bad++;
  if (h.engine && Buffer.compare(Buffer.from(outs[h.engine.chunk]), wasm) !== 0) { bad++; badNames.push('ikemen.wasm'); }
  if (bad) throw new Error('CHECK FAILED: ' + bad + ' file(s) did not rebuild to their bytes (' + badNames.join(', ') + ')');
  // Lossy sounds: decode every track as a browser would (ffmpeg here) and find
  // the start mark the page looks for; a track whose mark cannot be found
  // would put every clip in the wrong place.
  let offsets = [];
  if (h.audio && opt.ffmpegPath) {
    await limit(4, h.audio.map((a, ti) => async () => {
      const chans = await S.decodeJob(lite.subarray(trackAt[ti], trackAt[ti] + a.len), a, { ffmpeg: opt.ffmpegPath });
      const d = C.soundMarker(chans[0], a.lead);
      offsets.push(d);
      const last = tracks[ti].clips[tracks[ti].clips.length - 1];
      if (d < 0 || last.start + d + last.n > chans[0].length + 2) throw new Error('CHECK FAILED: a sound track decodes shorter than its clips');
    }));
  }
  return { files: h.files.length, offsets };
}

function rmChecked(p) {
  try { fs.unlinkSync(p); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  if (fs.existsSync(p)) throw new Error('could not delete ' + p);
}

// THE EXPORT'S STEP. `dir` is a Website export that has just been written
// whole (game.pak + ikemen.wasm). On success it is the lite build; on any
// failure it is left exactly as it was and the error says why.
async function liteInPlace(dir, opt) {
  opt = opt || {};
  const log = opt.log || (() => {});
  const status = opt.status || (() => {});
  const t0 = Date.now();
  const fsDir = path.join(dir, 'ikemen-fs');
  const manifestPath = path.join(fsDir, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (!manifest.pack) throw new Error('this export has no game.pak to make lite');
  // The page side must be there: a lite file the page cannot read is a dead site.
  const vfs = fs.readFileSync(path.join(dir, 'vfs.js'), 'utf8');
  if (!/data\.lite/.test(vfs) || !fs.existsSync(path.join(dir, 'lite.js'))) throw new Error('this export\'s pages cannot read a lite build (vfs.js has no lite branch, or lite.js is missing)');
  const pakPath = path.join(fsDir, manifest.pack);
  const wasmPath = path.join(dir, 'ikemen.wasm');
  const before = fs.statSync(pakPath).size + (fs.existsSync(wasmPath) ? fs.statSync(wasmPath).size : 0);

  let ff = { path: '', why: '' };
  if (!opt.exact) ff = opt.ffmpegPath !== undefined ? { path: opt.ffmpegPath, why: opt.ffmpegPath ? '' : 'no ffmpeg' } : findFfmpeg(opt.ffmpeg || '');

  // The pak, one file at a time (a pak past 2 GB cannot be read whole).
  status({ step: 'read' });
  const files = new Map();
  {
    const fd = fs.openSync(pakPath, 'r');
    try {
      for (const [vpath, [off, len]] of Object.entries(manifest.files)) {
        await breathe();
        const b = Buffer.allocUnsafe(len);
        let got = 0;
        while (got < len) { const n = fs.readSync(fd, b, got, len - got, off + got); if (!n) throw new Error('game.pak ends early at ' + vpath); got += n; }
        files.set(vpath, b);
      }
    } finally { fs.closeSync(fd); }
  }
  const wasm = fs.existsSync(wasmPath) ? fs.readFileSync(wasmPath) : null;
  const tmp = path.join(fsDir, 'game.lite.part');
  rmChecked(tmp);
  let packed, checked;
  const pool = workerPool(jobCount(opt));
  try {
    packed = await packFiles(files, wasm, tmp, Object.assign({}, opt, { ffmpegPath: ff.path, stamp: manifest.stamp, log, pool, status }));
    files.clear();
    checked = await verify(tmp, packed, { ffmpegPath: ff.path, pool, status });
    status({ step: 'swap' });
    log(`checked: all ${checked.files} files and the engine rebuild` + (packed.repacked.files ? ` (${packed.repacked.files} SFF files with PNG sprites written again, same pixels)` : '') + (checked.offsets.length ? `; ${checked.offsets.length} sound tracks decode with their start found` : ''));
  } catch (e) {
    try { rmChecked(tmp); } catch (_) { /* reported below */ }
    throw e;
  } finally {
    await pool.close();
  }

  // ---- swap: the lite file in, the pak and engine out ----
  const liteFile = path.join(fsDir, 'game.lite');
  rmChecked(liteFile);
  fs.renameSync(tmp, liteFile);
  const liteId = crypto.createHash('sha1').update(fs.readFileSync(liteFile)).digest('hex').slice(0, 12);
  const liteManifest = Object.assign({}, manifest, { lite: 'game.lite', liteId, files: {} });
  delete liteManifest.pack;
  { let at = 0; for (const [vpath, b] of packed.ref) { liteManifest.files[vpath] = [at, b.length]; at += b.length; } }
  fs.writeFileSync(manifestPath, JSON.stringify(liteManifest));
  rmChecked(pakPath);
  if (wasm) rmChecked(wasmPath);
  const after = fs.statSync(liteFile).size;
  const report = {
    before, after, liteId, mode: packed.header.mode,
    sounds: packed.sounds === 'lossy' ? 'lossy' : 'lossless',
    soundsWhy: packed.sounds === 'lossy' ? '' : (opt.exact ? 'exact' : ff.why),
    pngFiles: packed.repacked.files,
    seconds: Math.round((Date.now() - t0) / 1000),
    exactSounds: packed.exact,
  };
  log(`game.pak + ikemen.wasm ${mb(before)} -> game.lite ${mb(after)} in ${report.seconds} s`);
  return report;
}

// LITE OFF BY DEFAULT FOR A VERY BIG BUILD: the game data the Website export
// in `dir` holds (its game.pak), and whether that is over AUTO_MAX.
function autoLite(dir) {
  const fsDir = path.join(dir, 'ikemen-fs');
  const manifest = JSON.parse(fs.readFileSync(path.join(fsDir, 'manifest.json'), 'utf8'));
  const bytes = manifest.pack ? fs.statSync(path.join(fsDir, manifest.pack)).size : 0;
  return { bytes, max: AUTO_MAX, over: bytes > AUTO_MAX };
}

module.exports = { liteInPlace, packFiles, verify, findFfmpeg, autoLite, pageScript, PAGE_PARTS, MAGIC, AUTO_MAX, GIANT, PIECE };

// ---- command line: a lite COPY of an export (the export is only read) ------
if (require.main === module) {
  const argv = process.argv.slice(2);
  if (argv[0] === '--page') {
    // Write public/ikemen/lite.js from the modules.
    const dest = path.join(__dirname, '..', 'public', 'ikemen', 'lite.js');
    fs.writeFileSync(dest, pageScript());
    console.log('wrote ' + dest);
    process.exit(0);
  }
  const opt = { log: (m) => console.log(m) };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--ffmpeg') opt.ffmpeg = argv[++i];
    else if (argv[i] === '--exact') opt.exact = true;
    else if (argv[i] === '--jobs') opt.jobs = +argv[++i];
    else if (argv[i] === '--sprites') opt.sprites = argv[++i];
    else if (argv[i] === '--giant-mb') opt.giantMb = +argv[++i];
    else if (argv[i] === '--piece-mb') opt.pieceMb = +argv[++i];
    else rest.push(argv[i]);
  }
  if (rest.length !== 2) { console.error('usage: node lite/pack.js <export folder> <new folder> [--ffmpeg PATH] [--exact] [--jobs N]\n       node lite/pack.js --page'); process.exit(2); }
  const SRC = path.resolve(rest[0]), DST = path.resolve(rest[1]);
  if (SRC === DST) { console.error('the new folder must not be the export folder'); process.exit(2); }
  if (fs.existsSync(DST) && fs.readdirSync(DST).length) { console.error('the new folder is not empty: ' + DST); process.exit(2); }
  const copyTree = (s, d) => {
    fs.mkdirSync(d, { recursive: true });
    for (const e of fs.readdirSync(s, { withFileTypes: true })) {
      if (e.isDirectory()) copyTree(path.join(s, e.name), path.join(d, e.name));
      else if (e.isFile()) fs.copyFileSync(path.join(s, e.name), path.join(d, e.name));
    }
  };
  copyTree(SRC, DST);
  liteInPlace(DST, opt).then((r) => { console.log(JSON.stringify(r)); }, (e) => { console.error(e.message || e); process.exit(1); });
}
