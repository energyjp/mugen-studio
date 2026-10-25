'use strict';
// portraitfit.js - a character's select portraits, cut to the size the
// screenpack in use draws them at, in the copy a build ships.
//
// THE PROBLEM IS ART, NOT A SETTING. A screenpack draws two sprites per
// character - the cell face (`portrait.spr`, 9000,0) and the big portrait
// (`p1.face.spr`, 9000,1) - at the character's own scale:
//     portraitscale * motif.localcoord.x / char.localcoord     (start.lua)
// A pack that ships its own roster cuts that art to fit: every character of the
// CvS pack declares localcoord 427,240 and carries a 32x67 face and a 640x720
// portrait. A stock character dropped in beside them - 25x25 and 120x140, no
// localcoord - is drawn correctly and looks wrong: a small square in a tall
// cell, a thumbnail where the others fill half the screen. The engine has one
// per-character knob, `portraitscale`, and it cannot help: it is ONE uniform
// number for the cell face, the big portrait and the lifebar face together, and
// the two slots need different factors and a different shape.
//
// WHAT THIS DOES. For each slot the user has fitted, it takes a SOURCE sprite
// from the character's own file (the slot's own art, another portrait filed
// under a number the pack does not read, any sprite at all), resamples it to
// the pixel size this pack wants from THIS character, and writes it over the
// slot's sprite in the SHIPPED copy of the sprite file. The character's own file is
// only ever read. The choice lives in roster.json per character PER SCREENPACK
// (a fit is a property of the pair): switch packs and the original art is back.
//
// WHY THE FILE IS REBUILT, NOT APPENDED TO. A duplicate key resolves to the
// FIRST sprite in file order, so an appended 9000,0 is never drawn. Rebuilding
// keeps every subfile in its place - so every linked sprite's index still names
// what it named - and copies each untouched block byte for byte, padding and
// all, because the engine takes a sprite's extent from its next-subheader
// offset when it looks for the palette.
//
// WHOSE PALETTE. SFF v1 palettes chain by file position: a "same palette"
// sprite inherits from the previous real sprite, and only a sprite that owns
// its palette can carry new colors. So the rewritten sprite carries the
// SOURCE's palette - exact colors, no matching - only where that is safe:
// where the next real sprite owns a palette too, so nothing inherits from this
// one. Anywhere else the new pixels are matched into the palette that position
// already resolves to, and the chain is left exactly as it was.
//
// YOUR OWN PICTURE is a fourth kind of source: `from: 'file:<name>.png'`, a PNG
// kept in the bundle's portraits/ folder. It is resampled with its alpha, given
// a 255-color palette of its own (median cut; index 0 stays transparency) and
// written as an ordinary INDEXED sprite - not as truecolor, which the engine
// draws with no palette texture at all, so nothing palette-driven could ever
// reach it. It owns its palette wherever a sprite may own one; in an SFF v1
// slot that something inherits from, it can only be matched into the palette
// already there, and the result says so.
//
// SFF v2 IS THE EASY ONE. A v2 sprite is a 28-byte node that names its pixel
// data by offset and its palette by INDEX, so nothing chains by position and
// nothing has to move: the new pixels are appended to the end of the file as
// RLE8, and the slot's node is pointed at them, carrying the source's palette
// index - the source's exact colors, with the player's palette pick reaching
// the fitted sprite exactly when it reached the source. Only a slot the file
// never had moves anything: the node table is copied to the end with one more
// node on it. Every other byte of the file is the byte it was.
const fs = require('fs');
const path = require('path');
const core = require('./public/ikemen/sffdec-core.js');
const futafix = require('./futafix.js');

const MODES = ['cover', 'contain', 'stretch'];
const FILTERS = ['crisp', 'smooth'];

// ---- pixels ------------------------------------------------------------------

// What the pack wants from THIS character, in her sprite's own pixels: the
// on-screen size the pack's characters draw at, divided by her scale factor.
function factorOf(scale, motifW) {
  return (scale.portraitscale || 1) * (motifW || 320) / (scale.localcoord || 320);
}
function targetPx(onScreen, factor) {
  return { w: Math.max(1, Math.round(onScreen.w / factor)), h: Math.max(1, Math.round(onScreen.h / factor)) };
}

// src: { px (indices), w, h, pal (768 RGB) }, index 0 transparent,
//   or { rgba, w, h } - a picture with its own alpha.
// -> { rgba: Uint8Array(tw*th*4), idx: Uint8Array | null }
// idx is set when every output pixel is ONE source pixel (nearest, enlarging):
// then the source's indices can be kept and no color is ever approximated.
function resample(src, tw, th, opts) {
  const o = opts || {};
  const mode = MODES.includes(o.mode) ? o.mode : 'cover';
  const smooth = o.filter === 'smooth';
  const fx = Number.isFinite(o.focus && o.focus[0]) ? Math.min(1, Math.max(0, o.focus[0])) : 0.5;
  const fy = Number.isFinite(o.focus && o.focus[1]) ? Math.min(1, Math.max(0, o.focus[1])) : 0.5;
  const { w, h, px, pal } = src;
  const pic = src.rgba || null;
  // the source rectangle shown, and the target rectangle it lands on
  let sx0 = 0, sy0 = 0, sw = w, sh = h, dx0 = 0, dy0 = 0, dw = tw, dh = th;
  if (mode === 'cover') {
    const k = Math.max(tw / w, th / h);
    sw = tw / k; sh = th / k; sx0 = (w - sw) * fx; sy0 = (h - sh) * fy;
  } else if (mode === 'contain') {
    const k = Math.min(tw / w, th / h);
    dw = Math.max(1, Math.round(w * k)); dh = Math.max(1, Math.round(h * k));
    dx0 = Math.round((tw - dw) * fx); dy0 = Math.round((th - dh) * fy);
  }
  const kx = dw / sw, ky = dh / sh;
  const enlarging = kx >= 1 && ky >= 1;
  const rgba = new Uint8Array(tw * th * 4);
  const idx = (enlarging && !smooth && !pic) ? new Uint8Array(tw * th) : null;
  // one source pixel: an index for indexed art, a position for a picture
  const at = (x, y) => {
    const xi = Math.min(w - 1, Math.max(0, x)), yi = Math.min(h - 1, Math.max(0, y));
    return pic ? yi * w + xi + 1 : px[yi * w + xi];
  };
  for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) {
    const o4 = ((dy0 + y) * tw + dx0 + x) * 4;
    if (idx) {
      const i = at(Math.floor(sx0 + (x + 0.5) / kx), Math.floor(sy0 + (y + 0.5) / ky));
      idx[(dy0 + y) * tw + dx0 + x] = i;
      if (i) { rgba[o4] = pal[i * 3]; rgba[o4 + 1] = pal[i * 3 + 1]; rgba[o4 + 2] = pal[i * 3 + 2]; rgba[o4 + 3] = 255; }
      continue;
    }
    // everything else is a weighted average over source pixels: the box this
    // target pixel covers when shrinking, the four neighbors when enlarging
    let r = 0, g = 0, b = 0, a = 0, wsum = 0;
    const add = pic
      ? (p, wt) => { const o = (p - 1) * 4, al = pic[o + 3] / 255 * wt; wsum += wt; r += pic[o] * al; g += pic[o + 1] * al; b += pic[o + 2] * al; a += al; }
      : (i, wt) => { wsum += wt; if (i) { r += pal[i * 3] * wt; g += pal[i * 3 + 1] * wt; b += pal[i * 3 + 2] * wt; a += wt; } };
    if (pic && enlarging && !smooth) {
      add(at(Math.floor(sx0 + (x + 0.5) / kx), Math.floor(sy0 + (y + 0.5) / ky)), 1);
    } else if (enlarging) {
      const u = sx0 + (x + 0.5) / kx - 0.5, v = sy0 + (y + 0.5) / ky - 0.5;
      const x0 = Math.floor(u), y0 = Math.floor(v), tx = u - x0, ty = v - y0;
      add(at(x0, y0), (1 - tx) * (1 - ty)); add(at(x0 + 1, y0), tx * (1 - ty));
      add(at(x0, y0 + 1), (1 - tx) * ty); add(at(x0 + 1, y0 + 1), tx * ty);
    } else {
      const u0 = sx0 + x / kx, u1 = sx0 + (x + 1) / kx, v0 = sy0 + y / ky, v1 = sy0 + (y + 1) / ky;
      for (let yy = Math.floor(v0); yy < Math.ceil(v1); yy++) {
        const wy = Math.min(v1, yy + 1) - Math.max(v0, yy);
        if (wy <= 0) continue;
        for (let xx = Math.floor(u0); xx < Math.ceil(u1); xx++) {
          const wx = Math.min(u1, xx + 1) - Math.max(u0, xx);
          if (wx > 0) add(at(xx, yy), wx * wy);
        }
      }
    }
    if (wsum > 0 && a / wsum >= 0.5) {
      rgba[o4] = Math.round(r / a); rgba[o4 + 1] = Math.round(g / a); rgba[o4 + 2] = Math.round(b / a); rgba[o4 + 3] = 255;
    }
  }
  return { rgba, idx };
}

// RGBA -> indices into pal768. Index 0 is the transparent one and is never
// chosen for a visible pixel, whatever color it holds.
function quantize(rgba, n, pal768) {
  const out = new Uint8Array(n), memo = new Map();
  for (let p = 0; p < n; p++) {
    if (rgba[p * 4 + 3] < 128) continue;
    const r = rgba[p * 4], g = rgba[p * 4 + 1], b = rgba[p * 4 + 2], key = (r << 16) | (g << 8) | b;
    let best = memo.get(key);
    if (best === undefined) {
      let bd = Infinity; best = 1;
      for (let i = 1; i < 256; i++) {
        const dr = r - pal768[i * 3], dg = g - pal768[i * 3 + 1], db = b - pal768[i * 3 + 2];
        const d = dr * dr * 2 + dg * dg * 4 + db * db * 3;
        if (d < bd) { bd = d; best = i; }
      }
      memo.set(key, best);
    }
    out[p] = best;
  }
  return out;
}

// A PALETTE FOR A PICTURE: median cut over a 32x32x32 histogram of its visible
// pixels, into 255 colors at indices 1-255. Index 0 is left black and unused -
// it is the transparent index, whatever color it holds. Built from the WHOLE
// picture rather than the crop, so moving the focus never reshuffles the
// colors, and the same picture always gets the same palette.
function buildPalette(rgba, n) {
  const bins = new Map();
  for (let p = 0; p < n; p++) {
    if (rgba[p * 4 + 3] < 128) continue;
    const r = rgba[p * 4], g = rgba[p * 4 + 1], b = rgba[p * 4 + 2], k = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    let e = bins.get(k); if (!e) { e = [0, 0, 0, 0]; bins.set(k, e); }
    e[0]++; e[1] += r; e[2] += g; e[3] += b;
  }
  let boxes = [[...bins.values()]];
  const spread = (box) => { let best = -1, ch = 1; for (let c = 1; c <= 3; c++) { let lo = 255, hi = 0; for (const e of box) { const v = e[c] / e[0]; if (v < lo) lo = v; if (v > hi) hi = v; } if (hi - lo > best) { best = hi - lo; ch = c; } } return [best, ch]; };
  while (boxes.length < 255) {
    let pick = -1, score = 0, chan = 1;
    boxes.forEach((box, k) => { if (box.length < 2) return; const [sp, ch] = spread(box); const pop = box.reduce((s, e) => s + e[0], 0); const sc = sp * Math.sqrt(pop); if (sc > score) { score = sc; pick = k; chan = ch; } });
    if (pick < 0) break;
    const box = boxes[pick].slice().sort((x, y) => x[chan] / x[0] - y[chan] / y[0]);
    const half = box.reduce((s, e) => s + e[0], 0) / 2;
    let acc = 0, cut = 1;
    for (let k = 0; k < box.length - 1; k++) { acc += box[k][0]; cut = k + 1; if (acc >= half) break; }
    boxes.splice(pick, 1, box.slice(0, cut), box.slice(cut));
  }
  const pal = new Uint8Array(768);
  boxes.filter((box) => box.length).forEach((box, k) => {
    const c = box.reduce((s, e) => [s[0] + e[0], s[1] + e[1], s[2] + e[2], s[3] + e[3]], [0, 0, 0, 0]);
    pal[(k + 1) * 3] = Math.round(c[1] / c[0]); pal[(k + 1) * 3 + 1] = Math.round(c[2] / c[0]); pal[(k + 1) * 3 + 2] = Math.round(c[3] / c[0]);
  });
  return pal;
}

// The same, with the rounding error of each pixel pushed on to its neighbors
// (Floyd-Steinberg). 255 colors band visibly on a photograph's skin or sky;
// diffused, the bands become the fine dot texture hand-made portraits of this
// era have anyway. Only for pictures: a sprite is already within its palette.
// A transparent pixel takes no error and passes none on, so an edge stays clean.
function quantizeDithered(rgba, w, h, pal768) {
  const out = new Uint8Array(w * h), memo = new Map();
  let cur = new Float32Array((w + 2) * 3), next = new Float32Array((w + 2) * 3);
  const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);
  const nearest = (r, g, b) => {
    // cached on 5 bits a channel: the error term, not the lookup, carries the precision
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    let best = memo.get(key);
    if (best === undefined) {
      let bd = Infinity; best = 1;
      for (let i = 1; i < 256; i++) { const dr = r - pal768[i * 3], dg = g - pal768[i * 3 + 1], db = b - pal768[i * 3 + 2], d = dr * dr * 2 + dg * dg * 4 + db * db * 3; if (d < bd) { bd = d; best = i; } }
      memo.set(key, best);
    }
    return best;
  };
  for (let y = 0; y < h; y++) {
    next.fill(0);
    for (let x = 0; x < w; x++) {
      const p = y * w + x, e = (x + 1) * 3;
      if (rgba[p * 4 + 3] < 128) continue;
      const r = clamp(rgba[p * 4] + cur[e]), g = clamp(rgba[p * 4 + 1] + cur[e + 1]), b = clamp(rgba[p * 4 + 2] + cur[e + 2]);
      const i = nearest(Math.round(r), Math.round(g), Math.round(b));
      out[p] = i;
      for (let c = 0; c < 3; c++) {
        const err = [r, g, b][c] - pal768[i * 3 + c];
        cur[e + 3 + c] += err * 7 / 16; next[e - 3 + c] += err * 3 / 16; next[e + c] += err * 5 / 16; next[e + 3 + c] += err / 16;
      }
    }
    const t = cur; cur = next; next = t;
  }
  return out;
}

// A fit, rendered: { px, w, h, pal } ready to preview or to write.
// outPal: the palette the result must use; omitted = the source's own (for a
// picture, the one built for it).
function renderFit(src, fit, outPal) {
  const w = fit.w | 0, h = fit.h | 0;
  if (!(w > 0 && h > 0 && w <= 4096 && h <= 4096)) throw new Error('bad target size ' + fit.w + 'x' + fit.h);
  if (src.rgba && !src.pal) src.pal = buildPalette(src.rgba, src.w * src.h);
  const r = resample(src, w, h, fit);
  const pal = outPal || src.pal;
  const px = (r.idx && pal === src.pal) ? r.idx
    : (src.rgba && fit.dither !== false) ? quantizeDithered(r.rgba, w, h, pal) : quantize(r.rgba, w * h, pal);
  return { px, w, h, pal };
}

// ---- the file ----------------------------------------------------------------

function pcxRle(px, w, h) {
  const out = [];
  for (let y = 0; y < h; y++) {
    let x = 0;
    while (x < w) {
      const v = px[y * w + x];
      let run = 1;
      while (x + run < w && px[y * w + x + run] === v && run < 63) run++;
      if (run > 1 || v >= 0xc0) out.push(0xc0 | run, v); else out.push(v);
      x += run;
    }
  }
  return Buffer.from(out);
}
// A v1 subfile's data: headerless-PCX as the engine reads it, with the palette
// behind its 0x0C marker when the sprite owns one.
function pcxData(px, w, h, pal768) {
  const head = Buffer.alloc(128);
  head[0] = 0x0a; head[1] = 5; head[2] = 1; head[3] = 8;
  head.writeUInt16LE(w - 1, 8); head.writeUInt16LE(h - 1, 10);
  head.writeUInt16LE(w, 12); head.writeUInt16LE(h, 14);
  head[65] = 1; head.writeUInt16LE(w, 66);
  const parts = [head, pcxRle(px, w, h)];
  if (pal768) parts.push(Buffer.from([0x0c]), Buffer.from(pal768));
  return Buffer.concat(parts);
}

// edits: [{ index (file order) | null to append, group, image, px, w, h,
//           pal768 | null, axisX, axisY }]
// pal768 set = the sprite owns that palette; null = "same palette as previous".
function rebuildV1(input, edits) {
  const subs = futafix.walkV1(input);
  if (!subs || !subs.length) throw new Error('not an SFF v1');
  const byIndex = new Map(edits.filter((e) => e.index !== null && e.index !== undefined).map((e) => [e.index, e]));
  const appended = edits.filter((e) => e.index === null || e.index === undefined);
  const first = input.readUInt32LE(24);
  const parts = [Buffer.from(input.subarray(0, first))];
  let cursor = first;
  const total = subs.length + appended.length;
  // `zeroNext`: only the file's own last subfile, and only when the author
  // wrote 0 there - the engine falls back to offset+length for that one, and a
  // different answer would move where it looks for that sprite's palette.
  const put = (hdr, data, zeroNext) => {
    hdr.writeUInt32LE(zeroNext ? 0 : cursor + hdr.length + data.length, 0);
    parts.push(hdr, data); cursor += hdr.length + data.length;
  };
  const fresh = (e, src) => {
    const hdr = Buffer.alloc(32);
    const data = pcxData(e.px, e.w, e.h, e.pal768 || null);
    hdr.writeUInt32LE(data.length, 4);
    hdr.writeInt16LE(e.axisX | 0, 8); hdr.writeInt16LE(e.axisY | 0, 10);
    hdr.writeUInt16LE(e.group, 12); hdr.writeUInt16LE(e.image, 14);
    hdr[18] = e.pal768 ? 0 : 1;
    if (src) input.copy(hdr, 19, src.ofs + 19, src.ofs + 32);   // the author's comment bytes
    return [hdr, data];
  };
  subs.forEach((s, i) => {
    const e = byIndex.get(i);
    if (e) { const [hdr, data] = fresh(e, s); put(hdr, data, false); return; }
    const end = s.next > s.ofs ? s.next : Math.min(input.length, s.ofs + 32 + s.len);
    const hdr = Buffer.from(input.subarray(s.ofs, s.ofs + 32));
    put(hdr, Buffer.from(input.subarray(s.ofs + 32, end)), i === total - 1 && !(s.next > s.ofs));
  });
  appended.forEach((e) => { const [hdr, data] = fresh(e, null); put(hdr, data, false); });
  const out = Buffer.concat(parts);
  out.writeUInt32LE(total, 20);
  out.writeUInt32LE(new Set([...subs.map((s) => s.group), ...appended.map((e) => e.group)]).size, 16);
  return out;
}

// THE SOURCE'S COLORS ARE BAKED IN, so they have to be the ones the game would
// show. A portrait-bank sprite draws in its own embedded palette. Any other
// sprite that sits on the character's shared palette (the decoder's palIdx 0)
// draws in the COSTUME - and a v1 file's embedded copy of that palette is often
// a placeholder - so it is read through the costume the build ships as pal1:
// the slot the user's palette order (palorder.js) puts first, else slot 1, the
// same choice the Studio's sprite views make (modlib.previewPalette). A slot
// whose file cannot be read falls to the next one in shipped order.
//
// This replaced "the lowest-numbered .act the def names" (DEVLOG 2026-08-26),
// which baked Marvin's portrait in Marvin2.act, Ken's in Ken01.act (his pal5)
// and the CvS rips' in act001.act (their pal4). The owner chose pal1 as shipped.
//
// opts: { order: the roster's paletteOrder, customs: its customPalettes (the
// colors added in the Studio, slots like any other), palettes: the bundle's
// palettes/ folder they are read from }. The def's own pal1-pal12 come first
// (the first line naming a slot wins, as parseDef reads them); a Studio color
// fills only a slot the def does not name, as charPalettes lists them.
function defaultAct(charDir, defText, opts) {
  const o = opts || {};
  const src = new Map();
  for (const m of String(defText || '').matchAll(/^[ \t]*pal(\d+)[ \t]*=[ \t]*([^;\r\n]+)/gim)) {
    const slot = +m[1], file = m[2].replace(/"/g, '').trim();
    if (slot >= 1 && slot <= 12 && file && !src.has(slot)) src.set(slot, { file });
  }
  for (const c of Array.isArray(o.customs) ? o.customs : []) {
    if (c && Number.isInteger(c.slot) && c.file && !src.has(c.slot)) src.set(c.slot, { custom: c.file });
  }
  let slots = [...src.keys()].sort((a, b) => a - b);
  if (Array.isArray(o.order) && o.order.length) {
    const pos = require('./palorder.js').mapping(o.order, slots);
    slots = slots.slice().sort((a, b) => pos.get(a) - pos.get(b));
  }
  for (const slot of slots) {
    const s = src.get(slot);
    let pal = null;
    if (s.custom) pal = o.palettes ? require('./custompal.js').load(o.palettes, s.custom) : null;
    else {
      const hit = futafix.resolveCI(charDir, s.file) || futafix.resolveCI(charDir, s.file.replace(/\\/g, '/').split('/').pop());
      try { pal = hit ? core.readAct(fs.readFileSync(hit.abs)) : null; } catch (e) { pal = null; }
    }
    if (pal) return pal;
  }
  return null;
}
function decodeSource(sff, group, index, actPal) {
  const rec = sff && sff.byKey && sff.byKey.get(group + ',' + index);
  const wears = !!(actPal && rec && rec.v1 && rec.palIdx === 0 && !(group >= 9000 && group <= 9999));
  if (wears) sff.actPal = actPal;
  try { return core.decodeSprite(sff, group, index); } finally { delete sff.actPal; }
}

// `from` is a sprite number, or 'file:<name>.png' - a picture in the bundle's
// portraits/ folder. Names are content hashes the Studio made; nothing else is
// accepted, so a roster cannot point a build at a file outside that folder.
const PICTURE_RE = /^file:([a-f0-9]{12}\.png)$/;
const pictureCache = new Map();
function pictureSource(from, dir) {
  const m = PICTURE_RE.exec(String(from));
  if (!m) return null;
  if (!dir) throw new Error('this build has no portraits folder to read ' + m[1] + ' from');
  const abs = path.join(dir, m[1]);
  let st;
  try { st = fs.statSync(abs); } catch (e) { throw new Error('the picture ' + m[1] + ' is no longer in the bundle'); }
  const stamp = st.size + ':' + st.mtimeMs, hit = pictureCache.get(abs);
  if (hit && hit.stamp === stamp) return hit.src;
  const png = require('./tools/sff-decode.js').decodePng(fs.readFileSync(abs));
  let rgba;
  if (png.kind === 'indexed') {
    rgba = new Uint8Array(png.w * png.h * 4);
    for (let k = 0; k < png.w * png.h; k++) { const v = png.px[k]; rgba[k * 4] = png.pal[v * 3]; rgba[k * 4 + 1] = png.pal[v * 3 + 1]; rgba[k * 4 + 2] = png.pal[v * 3 + 2]; rgba[k * 4 + 3] = png.trns && png.trns[v] !== undefined ? png.trns[v] : 255; }
  } else rgba = png.px;
  const src = { rgba, w: png.w, h: png.h, picture: m[1] };
  pictureCache.set(abs, { stamp, src });
  return src;
}
const isPicture = (from) => PICTURE_RE.test(String(from));

const keyOf = (k) => { const m = /^\s*(\d+)\s*,\s*(\d+)\s*$/.exec(String(k)); return m ? [parseInt(m[1], 10), parseInt(m[2], 10)] : null; };

// fits: { '9000,0': { from: '9000,1', w, h, mode, filter, focus }, ... }
// -> { buf, applied: [{ slot, from, w, h, palette }], skipped: [{ slot, why }] }
//    buf is null when nothing was applied. opts.actPal: the costume palette, for
//    a source that follows it (the decoder's own rule decides whether it does).
function fitSffV1(input, fits, opts) {
  const applied = [], skipped = [];
  const subs = futafix.walkV1(input);
  const sff = subs ? core.readSff(input) : null;
  if (!subs || !sff) return { buf: null, applied, skipped: Object.keys(fits || {}).map((slot) => ({ slot, why: 'not an SFF v1' })) };
  const firstIndex = new Map();
  subs.forEach((s, i) => { const k = s.group + ',' + s.image; if (!firstIndex.has(k)) firstIndex.set(k, i); });
  const edits = [];
  for (const slot of Object.keys(fits || {})) {
    const fit = fits[slot], sk = keyOf(slot), pict = isPicture(fit && fit.from);
    const fk = pict ? [fit.from] : keyOf(fit && fit.from !== undefined ? fit.from : slot);
    if (!sk || !fk) { skipped.push({ slot, why: 'bad sprite number' }); continue; }
    let src;
    try { src = pict ? pictureSource(fit.from, opts && opts.pictures) : decodeSource(sff, fk[0], fk[1], opts && opts.actPal); }
    catch (e) { skipped.push({ slot, why: e.message }); continue; }
    if (!src || (!pict && src.kind !== 'indexed')) { skipped.push({ slot, why: 'source ' + fk.join(',') + ' is not in the file' }); continue; }
    const at = firstIndex.get(sk.join(','));
    // may a sprite at this position own a palette? only if nothing inherits it
    let nextReal = null;
    if (at !== undefined) for (let j = at + 1; j < subs.length; j++) if (subs[j].len) { nextReal = subs[j]; break; }
    const nextChains = !!nextReal && input[nextReal.ofs + 18] !== 0;
    let outPal, owns, palette;
    if (at === undefined || !nextChains) { outPal = null; owns = true; palette = pict ? 'picture' : 'source'; }
    else {
      // the palette this position already resolves to: the slot's own when it
      // is a real sprite, the running chain's when it is a link
      let here = subs[at].len ? at : -1;
      if (here < 0) for (let j = at - 1; j >= 0; j--) if (subs[j].len) { here = j; break; }
      const cur = here >= 0 ? core.decodeSprite(sff, subs[here].group, subs[here].image) : null;
      if (!cur || !cur.pal) { skipped.push({ slot, why: 'the palette at that position could not be read' }); continue; }
      outPal = cur.pal;
      owns = subs[at].len > 0 && (input[subs[at].ofs + 18] === 0 || here === 0);
      palette = owns ? 'slot' : 'chain';
    }
    let img;
    try { img = renderFit(src, fit, outPal || undefined); } catch (e) { skipped.push({ slot, why: e.message }); continue; }
    // the axis travels with the picture: the slot's own, scaled to the new size
    let axisX = 0, axisY = 0;
    const old = at !== undefined ? core.spriteGeom(sff, sk[0], sk[1]) : null;
    if (old && old.w > 0 && old.h > 0) { axisX = Math.round(old.axisX * img.w / old.w); axisY = Math.round(old.axisY * img.h / old.h); }
    edits.push({ index: at === undefined ? null : at, group: sk[0], image: sk[1], px: img.px, w: img.w, h: img.h,
      pal768: owns ? img.pal : null, axisX, axisY });
    applied.push({ slot: sk.join(','), from: fk.join(','), w: img.w, h: img.h, palette });
  }
  if (!edits.length) return { buf: null, applied, skipped };
  return { buf: rebuildV1(input, edits), applied, skipped };
}

// ---- SFF v2 -------------------------------------------------------------------

// The source as indices + palette, whatever v2 stores it as. PNG8 keeps its
// index map (the engine colors it from the SFF's palette table, not from the
// PNG's own PLTE); a truecolor sprite has no indices to keep and is refused.
function sourcePixels(sff, group, index, actPal) {
  const r = decodeSource(sff, group, index, actPal);
  if (!r) return null;
  if (r.kind === 'indexed') return { px: r.px, w: r.w, h: r.h, pal: r.pal };
  if (r.kind !== 'png') return null;
  const png = require('./tools/sff-decode.js').decodePng(Buffer.from(r.bytes));
  if (png.kind !== 'indexed') throw new Error('source ' + group + ',' + index + ' is a truecolor sprite; only indexed art can be fitted');
  let pal = r.pal;
  if (!pal) { pal = new Uint8Array(768); (png.pal || []).slice(0, 768).forEach((v, k) => { pal[k] = v; }); }
  return { px: png.px, w: png.w, h: png.h, pal };
}

// The palette group a picture's colors are filed under in an SFF v2. Far from
// 1 (the costumes a player picks from) and from anything a character is known
// to use, so no palette selection ever lands on it.
const PICTURE_PAL_GROUP = 9100;

function rle8Encode(px) {
  const out = [];
  for (let i = 0; i < px.length;) {
    const v = px[i];
    let run = 1;
    while (i + run < px.length && px[i + run] === v && run < 63) run++;
    // a lone byte whose top bits read as "run marker" has to be written as a run of one
    if (run > 1 || (v & 0xc0) === 0x40) out.push(0x40 | run, v); else out.push(v);
    i += run;
  }
  return Buffer.from(out);
}

function fitSffV2(input, fits, opts) {
  const applied = [], skipped = [];
  const sff = core.readSff(input);
  if (!sff || sff.version !== 2) return { buf: null, applied, skipped: Object.keys(fits || {}).map((slot) => ({ slot, why: 'not an SFF v2' })) };
  const sprOfs = input.readUInt32LE(36), count = input.readUInt32LE(40), lofs = input.readUInt32LE(52);
  const nodeAt = (k) => sprOfs + k * 28;
  const firstIndex = new Map();
  for (let k = 0; k < count; k++) { const key = input.readUInt16LE(nodeAt(k)) + ',' + input.readUInt16LE(nodeAt(k) + 2); if (!firstIndex.has(key)) firstIndex.set(key, k); }
  const palOfs = input.readUInt32LE(44), palCount = input.readUInt32LE(48);
  const blobs = [], patches = [], fresh = [], newPals = [];
  let cursor = input.length;
  for (const slot of Object.keys(fits || {})) {
    const fit = fits[slot], sk = keyOf(slot), pict = isPicture(fit && fit.from);
    const fk = pict ? [fit.from] : keyOf(fit && fit.from !== undefined ? fit.from : slot);
    if (!sk || !fk) { skipped.push({ slot, why: 'bad sprite number' }); continue; }
    const srcIndex = pict ? -1 : firstIndex.get(fk.join(','));
    let src = null;
    try { src = pict ? pictureSource(fit.from, opts && opts.pictures) : srcIndex === undefined ? null : sourcePixels(sff, fk[0], fk[1], opts && opts.actPal); }
    catch (e) { skipped.push({ slot, why: e.message }); continue; }
    if (!src) { skipped.push({ slot, why: 'source ' + fk.join(',') + ' is not in the file' }); continue; }
    let img;
    try { img = renderFit(src, fit); } catch (e) { skipped.push({ slot, why: e.message }); continue; }
    const rle = rle8Encode(img.px);
    const data = Buffer.alloc(4 + rle.length);
    data.writeUInt32LE(img.w * img.h, 0); rle.copy(data, 4);
    const at = firstIndex.get(sk.join(','));
    const old = at !== undefined ? core.spriteGeom(sff, sk[0], sk[1]) : null;
    const node = Buffer.alloc(28);
    node.writeUInt16LE(sk[0], 0); node.writeUInt16LE(sk[1], 2);
    node.writeUInt16LE(img.w, 4); node.writeUInt16LE(img.h, 6);
    node.writeInt16LE(old && old.w ? Math.round(old.axisX * img.w / old.w) : 0, 8);
    node.writeInt16LE(old && old.h ? Math.round(old.axisY * img.h / old.h) : 0, 10);
    node.writeUInt16LE(0, 12);                                    // its own pixels, not a link
    node[14] = 2; node[15] = 8;                                   // RLE8, 8 bits
    node.writeUInt32LE(cursor - lofs, 16);                        // offsets count from ldata
    node.writeUInt32LE(data.length, 20);
    // the SOURCE's palette, by index - or, for a picture, a palette of its own
    // that goes into the table below
    // (one picture in two slots is one palette, not two)
    if (pict) {
      let k = newPals.findIndex((p) => Buffer.compare(Buffer.from(p), Buffer.from(img.pal)) === 0);
      if (k < 0) { k = newPals.length; newPals.push(img.pal); }
      node.writeUInt16LE(palCount + k, 24);
    }
    else node.writeUInt16LE(input.readUInt16LE(nodeAt(srcIndex) + 24), 24);
    node.writeUInt16LE(0, 26);                                    // flags 0 = read from ldata's base
    if (cursor - lofs > 0xffffffff) { skipped.push({ slot, why: 'file too large' }); continue; }
    blobs.push(data); cursor += data.length;
    if (at === undefined) fresh.push(node); else patches.push({ at, node });
    applied.push({ slot: sk.join(','), from: fk.join(','), w: img.w, h: img.h, palette: pict ? 'picture' : 'source' });
  }
  if (!applied.length) return { buf: null, applied, skipped };
  const parts = [Buffer.from(input), ...blobs];
  for (const p of patches) p.node.copy(parts[0], nodeAt(p.at));
  if (newPals.length) {
    // NEW PALETTES. The colors go on the end as 256 RGBA entries; the palette
    // node table cannot grow where it is either, so it moves to the end whole,
    // with one node more per picture. A node's key is (group, item) and the
    // engine treats a repeated key as an alias of the first, so each new one
    // takes an item no palette in the file uses, in a group of its own.
    const used = new Set();
    for (let k = 0; k < palCount; k++) used.add(input.readUInt16LE(palOfs + k * 16) + ',' + input.readUInt16LE(palOfs + k * 16 + 2));
    const nodes = [Buffer.from(parts[0].subarray(palOfs, palOfs + palCount * 16))];
    let item = 0;
    for (const pal of newPals) {
      const data = Buffer.alloc(1024);
      for (let i = 0; i < 256; i++) { data[i * 4] = pal[i * 3]; data[i * 4 + 1] = pal[i * 3 + 1]; data[i * 4 + 2] = pal[i * 3 + 2]; data[i * 4 + 3] = i ? 255 : 0; }
      while (used.has(PICTURE_PAL_GROUP + ',' + item)) item++;
      used.add(PICTURE_PAL_GROUP + ',' + item);
      const pn = Buffer.alloc(16);
      pn.writeUInt16LE(PICTURE_PAL_GROUP, 0); pn.writeUInt16LE(item, 2); pn.writeUInt16LE(256, 4);
      pn.writeUInt16LE(palCount + nodes.length - 1, 6);             // "linked" names itself: a palette with data of its own
      pn.writeUInt32LE(cursor - lofs, 8); pn.writeUInt32LE(1024, 12);
      parts.push(data); cursor += data.length; nodes.push(pn);
    }
    const table = Buffer.concat(nodes);
    parts[0].writeUInt32LE(cursor, 44);
    parts[0].writeUInt32LE(palCount + newPals.length, 48);
    parts.push(table); cursor += table.length;
  }
  if (fresh.length) {
    // the node table cannot grow where it is: it moves to the end, whole
    // (`cursor` is the end of everything appended so far, palettes included)
    const table = Buffer.concat([parts[0].subarray(sprOfs, sprOfs + count * 28), ...fresh]);
    parts[0].writeUInt32LE(cursor, 36);
    parts[0].writeUInt32LE(count + fresh.length, 40);
    parts.push(table);
  }
  return { buf: Buffer.concat(parts), applied, skipped };
}

// Either version.
function fitSff(input, fits, opts) {
  if (!input || input.length < 64 || input.slice(0, 11).toString('latin1') !== 'ElecbyteSpr') {
    return { buf: null, applied: [], skipped: Object.keys(fits || {}).map((slot) => ({ slot, why: 'not a sprite file' })) };
  }
  return input[15] === 2 ? fitSffV2(input, fits, opts) : fitSffV1(input, fits, opts);
}

// ---- a character folder -------------------------------------------------------

const cache = new Map();
// What the fits do to the character `defName` loads, reading only.
// -> null when there is nothing to do, else
//    { spriteRel, spriteAbs, buf, applied, skipped }
// opts.pictures: the bundle's portraits/ folder, for `from: 'file:...'` sources.
// opts.order / opts.customs / opts.palettes: the roster's paletteOrder and
// customPalettes and the palettes/ folder, so a source that wears the costume
// is baked in the build's pal1 (defaultAct).
function fitFor(charDir, defName, fits, opts) {
  if (!fits || !Object.keys(fits).length) return null;
  const def = futafix.resolveCI(charDir, defName);
  if (!def) return null;
  let defText;
  try { defText = fs.readFileSync(def.abs, 'latin1'); } catch (e) { return null; }
  const files = futafix.defSpriteAndAnim(defText);
  if (!files.sprite) return null;
  const base = path.posix.dirname(def.rel);
  const sprite = futafix.resolveCI(charDir, base === '.' ? files.sprite : base + '/' + files.sprite) || futafix.resolveCI(charDir, files.sprite);
  if (!sprite) return null;
  let st;
  try { st = fs.statSync(sprite.abs); } catch (e) { return null; }
  const pictures = (opts && opts.pictures) || null;
  const palOpts = { order: (opts && opts.order) || null, customs: (opts && opts.customs) || null, palettes: (opts && opts.palettes) || null };
  // a picture replaced under the same name cannot happen (names are content
  // hashes), so the fits and the sprite file are the whole key
  // and the order and the Studio's colors, which pick the costume a source is baked in
  const stamp = st.size + ':' + st.mtimeMs + ':' + JSON.stringify(fits) + ':' + (pictures || '') + ':' + JSON.stringify([palOpts.order, palOpts.customs]);
  const hit = cache.get(sprite.abs);
  let res = hit && hit.stamp === stamp ? hit.res : null;
  if (!res) {
    let input;
    try { input = fs.readFileSync(sprite.abs); } catch (e) { return null; }
    res = fitSff(input, fits, { actPal: defaultAct(charDir, defText, palOpts), pictures });
    cache.set(sprite.abs, { stamp, res });
  }
  if (!res.buf) return res.skipped.length ? { spriteRel: sprite.rel, spriteAbs: sprite.abs, buf: null, applied: [], skipped: res.skipped } : null;
  return { spriteRel: sprite.rel, spriteAbs: sprite.abs, buf: res.buf, applied: res.applied, skipped: res.skipped };
}

// The roster keeps fits per screenpack: a fit is a property of the PAIR.
//   char.portraitFit = { '<motif folder>': { '9000,0': { from, w, h, ... } } }
function motifKey(roster) {
  const rel = String((roster && roster.motif) || '').replace(/\\/g, '/').replace(/^data\//i, '');
  const folder = rel.includes('/') ? rel.split('/')[0] : '';
  return folder || '(default)';
}
function fitsOf(rosterChar, roster) {
  const all = rosterChar && rosterChar.portraitFit;
  const mine = all && all[motifKey(roster)];
  return mine && Object.keys(mine).length ? mine : null;
}

module.exports = { quantizeDithered, PICTURE_RE, PICTURE_PAL_GROUP, isPicture, pictureSource, buildPalette, defaultAct, decodeSource, sourcePixels, rle8Encode, fitSffV2, fitSff, MODES, FILTERS, factorOf, targetPx, resample, quantize, renderFit, pcxData, rebuildV1, fitSffV1, fitFor, motifKey, fitsOf };
