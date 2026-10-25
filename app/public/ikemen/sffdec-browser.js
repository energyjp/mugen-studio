// Browser side of the SFF decoder: turns sffdecCore.decodeSprite() output into
// pixels a canvas can draw. Loaded after sffdec-core.js.
//
// WHY THIS IS SEPARATE. The core is pure (no fs, no DOM) and shared verbatim
// with Node. Inflating a PNG is the one thing the two runtimes cannot share:
// Node has zlib, the browser has DecompressionStream, and the browser's is
// async. So the split is core = decode-to-indices, adapter = present.
//
// WHY NOT JUST createImageBitmap. For format 10 the PNG carries only an INDEX
// MAP: the engine colors it from the SFF's own palette table and ignores the
// PNG's embedded PLTE. Several characters ship an all-black placeholder PLTE,
// so handing those bytes to the browser's PNG decoder renders a black
// silhouette (field hit: dr_kira). The indices have to be recovered by hand.
(function (root) {
  'use strict';
  const core = root.sffdecCore || (typeof require === 'function' && require('./sffdec-core.js'));

  // Lifted from public/lib/sff.js: recovers the raw palette indices from a
  // PNG8 rather than letting the browser apply the embedded PLTE.
  async function decodeIndexedPng8(bytes) {
    if (bytes[0] !== 0x89 || bytes[1] !== 0x50) throw new Error('not a PNG');
    let pos = 8;
    let width = 0, height = 0, bitDepth = 8, colorType = 3;
    let plte = null;
    const idat = [];
    while (pos + 8 <= bytes.length) {
      const length = (bytes[pos] << 24 | bytes[pos + 1] << 16 | bytes[pos + 2] << 8 | bytes[pos + 3]) >>> 0;
      const type = String.fromCharCode(bytes[pos + 4], bytes[pos + 5], bytes[pos + 6], bytes[pos + 7]);
      const dataStart = pos + 8;
      if (type === 'IHDR') {
        const dv = new DataView(bytes.buffer, bytes.byteOffset + dataStart, length);
        width = dv.getUint32(0); height = dv.getUint32(4);
        bitDepth = dv.getUint8(8); colorType = dv.getUint8(9);
      } else if (type === 'PLTE') {
        plte = bytes.subarray(dataStart, dataStart + length);
      } else if (type === 'IDAT') {
        idat.push(bytes.subarray(dataStart, dataStart + length));
      } else if (type === 'IEND') break;
      pos = dataStart + length + 4; // skip CRC
    }
    if (colorType !== 3 || bitDepth !== 8) {
      throw new Error('not an 8-bit indexed PNG (colorType=' + colorType + ' bitDepth=' + bitDepth + ')');
    }
    const comp = new Uint8Array(idat.reduce((n, c) => n + c.length, 0));
    { let o = 0; for (const c of idat) { comp.set(c, o); o += c.length; } }
    const stream = new Blob([comp]).stream().pipeThrough(new DecompressionStream('deflate'));
    const inf = new Uint8Array(await new Response(stream).arrayBuffer());

    const bpp = 1, stride = width * bpp;
    const out = new Uint8Array(width * height);
    let prev = new Uint8Array(stride);
    let sp = 0;
    for (let y = 0; y < height; y++) {
      const f = inf[sp++];
      const row = inf.subarray(sp, sp + stride);
      sp += stride;
      const cur = new Uint8Array(stride);
      for (let x = 0; x < stride; x++) {
        const a = x >= bpp ? cur[x - bpp] : 0;
        const b = prev[x];
        const c = x >= bpp ? prev[x - bpp] : 0;
        let v = row[x];
        if (f === 1) v = (v + a) & 0xff;
        else if (f === 2) v = (v + b) & 0xff;
        else if (f === 3) v = (v + ((a + b) >> 1)) & 0xff;
        else if (f === 4) {
          const p = a + b - c;
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          v = (v + ((pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c))) & 0xff;
        } else if (f !== 0) throw new Error('unknown PNG filter ' + f);
        cur[x] = v;
      }
      out.set(cur, y * width);
      prev = cur;
    }
    return { px: out, w: width, h: height, plte };
  }

  // Indices + RGB palette -> RGBA. MUGEN treats palette index 0 as transparent,
  // which is why a naive extract shows a magenta or green background.
  // `alpha` (optional, from decodeSprite) is the palette's own per-entry alpha
  // - an SFF v2.01 node - so a 128 entry draws half see-through, as in game,
  // and index 0 is whatever that palette stores there.
  function toImageData(px, w, h, pal, alpha) {
    const img = new ImageData(w, h);
    const d = img.data;
    for (let i = 0, n = w * h; i < n; i++) {
      const idx = px[i];
      const o = i << 2;
      if (idx === 0 && !alpha) { d[o + 3] = 0; continue; }
      const p = idx * 3;
      d[o] = pal[p]; d[o + 1] = pal[p + 1]; d[o + 2] = pal[p + 2]; d[o + 3] = alpha ? alpha[idx] : 255;
    }
    return img;
  }

  // Decode one sprite to ImageData. Returns null when the sprite is absent or
  // in a format the decoder does not handle, so a caller can leave an empty
  // cell rather than draw a smear.
  async function spriteImageData(sff, group, index) {
    const r = core.decodeSprite(sff, group, index);
    if (!r) return null;
    if (r.kind === 'indexed') return toImageData(r.px, r.w, r.h, r.pal, r.alpha);
    try {
      const png = await decodeIndexedPng8(r.bytes);
      // r.pal is the SFF's palette when the core says it must win over the
      // PNG's own (format 10). Otherwise use the PNG's PLTE. r.alpha only
      // ever comes with r.pal.
      const pal = r.pal || png.plte;
      if (!pal) return null;
      return toImageData(png.px, png.w, png.h, pal, r.pal ? r.alpha : null);
    } catch (e) {
      // Formats 11/12 are true-color PNGs with no index map: let the browser
      // decode them normally.
      try {
        const bmp = await createImageBitmap(new Blob([r.bytes], { type: 'image/png' }));
        const cv = document.createElement('canvas');
        cv.width = bmp.width; cv.height = bmp.height;
        cv.getContext('2d').drawImage(bmp, 0, 0);
        return cv.getContext('2d').getImageData(0, 0, bmp.width, bmp.height);
      } catch (e2) { return null; }
    }
  }

  async function spriteDataURL(sff, group, index) {
    const img = await spriteImageData(sff, group, index);
    if (!img) return null;
    const cv = document.createElement('canvas');
    cv.width = img.width; cv.height = img.height;
    cv.getContext('2d').putImageData(img, 0, 0);
    return cv.toDataURL('image/png');
  }

  // Open a character's SFF from a byte-loader, resolving the external .act that
  // SFF v1 portraits need. `load(relPath)` returns Uint8Array|null.
  // Mirrors modlib.spritePngFor's .act rule: lowest .act file number wins.
  // `list` is optional and returns the available paths, used for the
  // case-insensitive fallback below.
  async function openChar(load, defRelPath, list) {
    // MUGEN .def paths are cheerfully inconsistent about case and separators:
    // RyuDX's def says "data/ryuDX.sff" while the file is "Data/RyuDX.sff".
    // The Node side resolves this by listing the directory; the browser needs
    // the same fallback or v1 characters silently fail to open.
    let names = null;
    // A loader that THROWS on a miss (rather than returning null) would skip
    // the case-insensitive fallback entirely, so swallow it here too - callers
    // should not have to know.
    const get = async (p) => {
      let direct = null;
      try { direct = await load(p); } catch (e) { direct = null; }
      if (direct) return direct;
      if (!list) return null;
      if (!names) names = await list();
      const want = p.toLowerCase();
      const hit = names.find((n) => String(n).toLowerCase() === want);
      if (!hit) return null;
      try { return await load(hit); } catch (e) { return null; }
    };
    const defBytes = await get(defRelPath);
    if (!defBytes) return null;
    let txt = '';
    for (let i = 0; i < defBytes.length; i++) txt += String.fromCharCode(defBytes[i]);
    const def = core.parseDef(txt);
    if (!def || !def.sprite) return null;
    const dir = defRelPath.includes('/') ? defRelPath.slice(0, defRelPath.lastIndexOf('/') + 1) : '';
    const sffBytes = await get(dir + String(def.sprite).replace(/\\/g, '/'));
    if (!sffBytes) return null;
    const sff = core.readSff(sffBytes);
    if (!sff) return null;
    if (sff.version === 1) {
      const pals = def.pals || {};
      const actNo = (f) => {
        const m = String(f).split(/[/\\]/).pop().match(/(\d+)\s*\.act$/i);
        return m ? parseInt(m[1], 10) : Number.MAX_SAFE_INTEGER;
      };
      let best = null;
      for (const slot of Object.keys(pals)) {
        const cand = { slot: parseInt(slot, 10), file: pals[slot], n: actNo(pals[slot]) };
        if (!best || cand.n < best.n || (cand.n === best.n && cand.slot < best.slot)) best = cand;
      }
      const want = best ? best.file : (def.pal1 || null);
      if (want) {
        const act = await get(dir + String(want).replace(/\\/g, '/'));
        if (act) { const a = core.readAct(act); if (a) sff.actPal = a; }
      }
    }
    return { sff, def };
  }

  root.sffdecBrowser = { decodeIndexedPng8, toImageData, spriteImageData, spriteDataURL, openChar };
})(typeof globalThis !== 'undefined' ? globalThis : this);
