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
