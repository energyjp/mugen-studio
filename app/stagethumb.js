'use strict';
//
// STAGE THUMBNAILS - the picture the select screen shows beside a stage's name.
//
// Ikemen reads it out of the STAGE's OWN .sff, at whatever sprite the screenpack
// names: [Select Info] `stage.portrait.spr`, which the bundled pack sets to
// 9000,1 (release-v2/data/ikemen1/system.def). external/script/main.lua
// f_materializeStagePortrait() asks animGetPreloadedStageData(stageNo, g, n) and
// draws nothing when the sprite is absent.
//
// This is an Ikemen extension - the stock screenpacks label the lines
// ";Ikemen feature" - and MUGEN never had it, so almost no third-party stage
// ships the sprite. Every stage bundled WITH the engine has one; of the author's
// ten imported stages, none did. That is the whole reason the select screen looks
// half-finished.
//
// So this builds one, by compositing the stage's own background the way the
// engine would draw it at camera start. That is not a guess: composited against
// the five bundled stages that ship a hand-drawn 9000,1, it reproduces them to a
// mean absolute error of 3 to 18 out of 255.
//
// WHAT NOT TO DO, both measured:
//   - Do NOT rebuild the .sff. tools/sff-v2.js convertToV2/writeSffV2 keep only
//     `kind:'indexed'` sprites, and these stages are mostly fmt 10/11/12 PNG:
//     VA-11 goes 139 sprites -> 8, Jungle 104 -> 79, six others throw outright.
//     This appends one sprite node and leaves every existing byte alone.
//   - Do NOT pick "the biggest sprite in the file". On a real stage that is
//     usually an additive light layer or an animation frame, not the backdrop.
//     It is wrong on 6 of 11 here, and nothing in the file tells you which 6.
//
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const core = require('./public/ikemen/sffdec-core.js');
// Which .air element the engine has on screen (Animation.Action), shared with
// the animation player.
const { airTimeline } = require('./public/ikemen/animview-core.js');
// The stage's animation table, read the engine's way (ReadAnimationTable over
// the whole def, stage.go:1026; motif-core's port is checked against anim.go).
const { parseActions } = require('./public/ikemen/motif-core.js');

// The backup suffix is NOT plain `.orig`: six of these stages already carry one
// from the v2 conversion, and tools/sff-v2.js also uses `.orig` as its
// "already converted" sentinel. It still ends in .orig so the export filters
// that drop backups keep dropping it.
const BAK = '.stagethumb.orig';

// ---------------------------------------------------------------- def parsing

function parseStageDef(text) {
  // `model`: what [BGdef] `model =` names, '' when nothing - a 3D-model stage
  // (stage.go loads it beside `spr`), which has no layers to composite.
  const out = { localcoord: [320, 240], portraitscale: 1, model: '', bgs: [], actions: {} };
  const lines = text.split(/\r?\n/);
  let sect = '', bg = null, act = null;
  const kv = (l) => {
    const m = /^\s*([^=;]+?)\s*=\s*(.*?)\s*(;.*)?$/.exec(l);
    return m ? [m[1].toLowerCase(), m[2].replace(/"/g, '').trim()] : null;
  };
  const nums = (s) => String(s).split(',').map((x) => parseFloat(x)).filter((x) => Number.isFinite(x));

  for (const raw of lines) {
    const line = raw.replace(/;.*$/, '');
    const sec = /^\s*\[([^\]]+)\]/.exec(line);
    if (sec) {
      const name = sec[1].trim();
      sect = name.toLowerCase();
      // [Begin Action n] - the animation table, read below by parseActions
      if (/^begin\s+action\b/i.test(name)) { act = true; bg = null; continue; }
      act = null;
      // A background element. The name is OPTIONAL - `[BG]` on its own is legal
      // and real (ghosttrick_hd uses exactly that), so matching `BG <name>`
      // found nothing and the stage looked undrawable. `\b` after "bg" excludes
      // [BGdef] and [BGCtrlDef] on its own, since both continue the word.
      if (/^bg\b/i.test(name) && !/^bgctrl/i.test(name)) {
        bg = { name: name.slice(3).trim(), type: 'normal', spriteno: null, actionno: null,
          start: [0, 0], delta: [1, 1], tile: [0, 0], tilespacing: [0, 0],
          trans: 'none', mask: undefined, layerno: 0 };
        out.bgs.push(bg);
      } else bg = null;
      continue;
    }
    if (act) continue;
    const p = kv(line);
    if (!p) continue;
    const [k, v] = p;
    if (sect === 'stageinfo') {
      if (k === 'localcoord') { const n = nums(v); if (n.length >= 2) out.localcoord = [n[0], n[1]]; }
      else if (k === 'portraitscale') { const n = parseFloat(v); if (Number.isFinite(n) && n > 0) out.portraitscale = n; }
    } else if (sect === 'bgdef') {
      if (k === 'model') out.model = v;
    } else if (bg) {
      if (k === 'type') bg.type = v.toLowerCase();
      else if (k === 'spriteno') bg.spriteno = nums(v);
      else if (k === 'actionno') bg.actionno = parseInt(v, 10);
      else if (k === 'start') bg.start = nums(v);
      else if (k === 'delta') bg.delta = nums(v);
      else if (k === 'tile') bg.tile = nums(v);
      else if (k === 'tilespacing') bg.tilespacing = nums(v);
      else if (k === 'trans') bg.trans = v.toLowerCase();
      else if (k === 'mask') bg.mask = parseInt(v, 10);
      else if (k === 'layerno') bg.layerno = parseInt(v, 10) || 0;
    }
  }
  // THE ACTIONS AS THE ENGINE READS THEM. A frame line is kept when it starts
  // with a digit or '-' and splits into at least 5 comma fields, each read with
  // Atoi, where an empty field is 0 (ReadAnimFrame, anim.go:45-70; Atoi,
  // common.go:212-241): `8,0,,,3` is sprite 8,0 at offset 0,0 for 3 ticks.
  // Dropping the empty fields instead lost the element - and with it the layer -
  // or read the time from the wrong field (`4,20,20,25,,3` has time 0).
  // Copy Action and empty actions resolve as the table does (anim.go:1194-1297).
  // Each frame is [group, index, x, y, time], with the action's loopStart.
  for (const [no, frames] of Object.entries(parseActions(text))) {
    const list = frames.map((f) => [f.group, f.index, f.x, f.y, f.time]);
    list.loopStart = frames.loopStart;
    out.actions[no] = list;
  }
  return out;
}

// THE SIZE IS NOT FIXED. main.lua:797 scales the sprite by
//   motif.localcoord.w / stage.localcoord.w  (times portraitscale and the
//   screenpack's own 0.25), so a stage authored at localcoord 960 needs a
//   sprite three times larger than one authored at 320 to fill the same box.
// Derived from the bundled pack (localcoord 1280, scale 0.25, window 238x98)
// this predicts all eight bundled stages exactly: 240x100, 480x200, 576x240.
function thumbSize(def) {
  const L = (def.localcoord && def.localcoord[0]) || 320;
  const ps = def.portraitscale || 1;
  const k = (L / 320) / ps;
  return { w: Math.max(16, Math.round(240 * k)), h: Math.max(8, Math.round(100 * k)) };
}

// ---------------------------------------------------------------- pixels

function paeth(a, b, c) {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

// A general PNG reader, because the stage sprites are fmt 10/11/12 - PNG8,
// PNG24 and PNG32 embedded in the SFF - and the repo's decoder hands those back
// as raw PNG bytes rather than pixels.
function decodePngRGBA(buf, palOverride, maskIdx0) {
  if (!(buf[0] === 0x89 && buf[1] === 0x50)) return null;
  let p = 8, w = 0, h = 0, depth = 8, ctype = 0, inter = 0;
  const idat = []; let plte = null, trns = null;
  while (p + 8 <= buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString('latin1', p + 4, p + 8), ds = p + 8;
    if (type === 'IHDR') {
      w = buf.readUInt32BE(ds); h = buf.readUInt32BE(ds + 4);
      depth = buf[ds + 8]; ctype = buf[ds + 9]; inter = buf[ds + 12];
    } else if (type === 'PLTE') plte = buf.subarray(ds, ds + len);
    else if (type === 'tRNS') trns = buf.subarray(ds, ds + len);
    else if (type === 'IDAT') idat.push(buf.subarray(ds, ds + len));
    else if (type === 'IEND') break;
    p = ds + len + 4;
  }
  if (!w || !h || inter) return null;          // interlaced: rare, and not worth the code
  let raw;
  try { raw = zlib.inflateSync(Buffer.concat(idat)); } catch (e) { return null; }
  const chans = ctype === 0 ? 1 : ctype === 2 ? 3 : ctype === 3 ? 1 : ctype === 4 ? 2 : 4;
  const bpp = Math.max(1, (chans * depth) >> 3);
  const bpl = Math.ceil((w * chans * depth) / 8);
  if (raw.length < (bpl + 1) * h) return null;
  const lines = Buffer.alloc(bpl * h);
  let off = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[off++];
    const cur = lines.subarray(y * bpl, (y + 1) * bpl);
    raw.copy(cur, 0, off, off + bpl); off += bpl;
    const prev = y ? lines.subarray((y - 1) * bpl, y * bpl) : null;
    for (let i = 0; i < bpl; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0;
      const b = prev ? prev[i] : 0;
      const c = (prev && i >= bpp) ? prev[i - bpp] : 0;
      if (f === 1) cur[i] = (cur[i] + a) & 255;
      else if (f === 2) cur[i] = (cur[i] + b) & 255;
      else if (f === 3) cur[i] = (cur[i] + ((a + b) >> 1)) & 255;
      else if (f === 4) cur[i] = (cur[i] + paeth(a, b, c)) & 255;
    }
  }
  const rgba = Buffer.alloc(w * h * 4);
  const getIdx = (row, x) => {
    if (depth === 8) return row[x];
    const per = 8 / depth, bit = (x % per) * depth;
    return (row[(x / per) | 0] >> (8 - depth - bit)) & ((1 << depth) - 1);
  };
  for (let y = 0; y < h; y++) {
    const row = lines.subarray(y * bpl, (y + 1) * bpl);
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      if (ctype === 3) {
        const ix = getIdx(row, x);
        const pal = palOverride || plte;
        if (!pal) return null;
        rgba[o] = pal[ix * 3]; rgba[o + 1] = pal[ix * 3 + 1]; rgba[o + 2] = pal[ix * 3 + 2];
        rgba[o + 3] = (maskIdx0 && ix === 0) ? 0
          : (palOverride ? 255 : (trns && ix < trns.length ? trns[ix] : 255));
      } else if (ctype === 0) {
        const v = row[x * Math.max(1, depth >> 3)];
        rgba[o] = rgba[o + 1] = rgba[o + 2] = v; rgba[o + 3] = 255;
      } else if (ctype === 2) {
        const st = depth === 16 ? 2 : 1, s = x * 3 * st;
        rgba[o] = row[s]; rgba[o + 1] = row[s + st]; rgba[o + 2] = row[s + 2 * st]; rgba[o + 3] = 255;
      } else if (ctype === 4) {
        const s = x * 2; rgba[o] = rgba[o + 1] = rgba[o + 2] = row[s]; rgba[o + 3] = row[s + 1];
      } else {
        const st = depth === 16 ? 2 : 1, s = x * 4 * st;
        rgba[o] = row[s]; rgba[o + 1] = row[s + st]; rgba[o + 2] = row[s + 2 * st]; rgba[o + 3] = row[s + 3 * st];
      }
    }
  }
  return { w, h, rgba };
}

// MUGEN color 0 is the transparent one unless the element says `mask = 0`.
function spriteRGBA(sff, g, i, mask) {
  let d;
  try { d = core.decodeSprite(sff, g, i); } catch (e) { return null; }
  if (!d) return null;
  if (d.kind === 'png') {
    return decodePngRGBA(Buffer.from(d.bytes), d.pal ? Buffer.from(d.pal) : null, mask !== 0);
  }
  const { w, h, px, pal } = d;
  if (!w || !h || !px || !pal) return null;
  const rgba = Buffer.alloc(w * h * 4);
  for (let k = 0; k < w * h; k++) {
    const ix = px[k], o = k * 4;
    rgba[o] = pal[ix * 3]; rgba[o + 1] = pal[ix * 3 + 1]; rgba[o + 2] = pal[ix * 3 + 2];
    rgba[o + 3] = (ix === 0 && mask !== 0) ? 0 : 255;
  }
  return { w, h, rgba };
}

function blit(dst, dw, dh, src, sx, sy, trans) {
  for (let y = 0; y < src.h; y++) {
    const dy = sy + y;
    if (dy < 0 || dy >= dh) continue;
    for (let x = 0; x < src.w; x++) {
      const dx = sx + x;
      if (dx < 0 || dx >= dw) continue;
      const so = (y * src.w + x) * 4, a = src.rgba[so];
      const alpha = src.rgba[so + 3];
      if (!alpha) continue;
      const dof = (dy * dw + dx) * 4;
      const sr = src.rgba[so], sg = src.rgba[so + 1], sb = src.rgba[so + 2];
      if (trans === 'add') {
        dst[dof] = Math.min(255, dst[dof] + sr);
        dst[dof + 1] = Math.min(255, dst[dof + 1] + sg);
        dst[dof + 2] = Math.min(255, dst[dof + 2] + sb);
      } else if (trans === 'sub') {
        dst[dof] = Math.max(0, dst[dof] - sr);
        dst[dof + 1] = Math.max(0, dst[dof + 1] - sg);
        dst[dof + 2] = Math.max(0, dst[dof + 2] - sb);
      } else if (alpha === 255) {
        dst[dof] = sr; dst[dof + 1] = sg; dst[dof + 2] = sb;
      } else {
        const t = alpha / 255;
        dst[dof] = sr * t + dst[dof] * (1 - t);
        dst[dof + 1] = sg * t + dst[dof + 1] * (1 - t);
        dst[dof + 2] = sb * t + dst[dof + 2] * (1 - t);
      }
      dst[dof + 3] = 255;
      void a;
    }
  }
}

// Draw the stage as the engine would at camera start (src/stage.go backGround.draw
// with drawscl 1): layers -1, 0, 1 in order, def order within a layer, each
// sprite anchored by its AXIS at (width/2 + start.x, start.y), tiled if asked.
function compositeStage(def, sff) {
  const GW = Math.max(1, Math.round(def.localcoord[0]));
  const GH = Math.max(1, Math.round(def.localcoord[1]));
  const canvas = Buffer.alloc(GW * GH * 4);
  let drawn = 0;
  for (const layer of [-1, 0, 1]) {
    for (const bg of def.bgs) {
      if ((bg.layerno | 0) !== layer) continue;
      // A foreground element pinned to the camera and subtracting light is a
      // darkening overlay meant to sit in front of the fighters. Drawing it into
      // an empty stage just dims the picture (VA-11's [BG Overlay]).
      if (layer === 1 && bg.delta && bg.delta[0] === 0 && /sub/.test(bg.trans)) continue;

      let g, i, fx = 0, fy = 0;
      if (bg.type === 'anim') {
        // THE PICTURE THE LAYER SHOWS AT CAMERA START, not its element 1: the
        // stage resets the animation (stage.go:491) and runs Action on it
        // (stage.go:1894), so with totaltime > 0 animSeek moves past time 0
        // elements before any sprite loads (anim.go:638-652, 675-679) and a
        // time 0 element never loads its sprite (anim.go:693). The first run of
        // the engine's timeline that loads one: its element's offset, the
        // loaded element's sprite.
        const frames = def.actions[bg.actionno];
        if (!frames || !frames.length) continue;
        const ls = frames.loopStart > 0 && frames.loopStart < frames.length ? frames.loopStart : 0;
        const run = airTimeline(frames.map((x) => (Number.isFinite(x[4]) ? Math.trunc(x[4]) : 0)), ls).runs.find((x) => x.spr >= 0);
        if (!run) continue;
        const sf = frames[run.spr], ef = frames[run.elem];
        if (sf[0] < 0) continue;                 // a blank -1,-1 frame is a skip, not a failure
        g = sf[0]; i = sf[1]; fx = ef[2] || 0; fy = ef[3] || 0;
      } else if (bg.spriteno && bg.spriteno.length >= 2) {
        g = bg.spriteno[0]; i = bg.spriteno[1];
      } else continue;

      const spr = spriteRGBA(sff, g, i, bg.mask === undefined ? 1 : bg.mask);
      if (!spr) continue;
      let geom = null;
      try { geom = core.spriteGeom(sff, g, i); } catch (e) { geom = null; }
      const ax = geom ? (geom.axisX | 0) : 0;
      const ay = geom ? (geom.axisY | 0) : 0;
      const px = Math.round(GW / 2 + (bg.start[0] || 0) + fx - ax);
      const py = Math.round((bg.start[1] || 0) + fy - ay);
      const mode = /add/.test(bg.trans) ? 'add' : /sub/.test(bg.trans) ? 'sub' : 'normal';

      const tx = (bg.tile && bg.tile[0]) | 0, ty = (bg.tile && bg.tile[1]) | 0;
      const sx = spr.w + ((bg.tilespacing && bg.tilespacing[0]) | 0);
      const sy = spr.h + ((bg.tilespacing && bg.tilespacing[1]) | 0);
      // Tiling is not decoration: a 1px-wide sky tiled across the screen is a
      // common shape, and without this the canvas is empty.
      const xs = tx ? range(px, sx, GW) : [px];
      const ys = ty ? range(py, sy, GH) : [py];
      for (const yy of ys) for (const xx of xs) blit(canvas, GW, GH, spr, xx, yy, mode);
      drawn++;
    }
  }
  return { w: GW, h: GH, rgba: canvas, drawn };
}

function range(start, step, limit) {
  if (step <= 0) return [start];
  const out = [];
  let a = start;
  while (a > -step) a -= step;           // back up so the left edge is covered
  for (; a < limit; a += step) out.push(a);
  return out;
}

// Crop the middle band to the 2.4:1 the select screen draws, then area-average
// down to the sprite size. Vertical centering matched the bundled thumbnails to
// within a pixel; the originals were framed by eye, so this is a good default
// rather than a recovered rule.
function bannerFrom(canvas, w, h) {
  const cropH = Math.min(canvas.h, Math.max(1, Math.round(canvas.w / 2.4)));
  const top = Math.max(0, Math.min(canvas.h - cropH, Math.round((canvas.h - cropH) / 2)));
  const out = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) {
    const sy0 = top + Math.floor(y * cropH / h);
    const sy1 = Math.max(sy0 + 1, top + Math.floor((y + 1) * cropH / h));
    for (let x = 0; x < w; x++) {
      const sx0 = Math.floor(x * canvas.w / w);
      const sx1 = Math.max(sx0 + 1, Math.floor((x + 1) * canvas.w / w));
      let r = 0, g = 0, b = 0, n = 0;
      for (let yy = sy0; yy < sy1 && yy < canvas.h; yy++) {
        for (let xx = sx0; xx < sx1 && xx < canvas.w; xx++) {
          const o = (yy * canvas.w + xx) * 4;
          r += canvas.rgba[o]; g += canvas.rgba[o + 1]; b += canvas.rgba[o + 2]; n++;
        }
      }
      const o = (y * w + x) * 3;
      out[o] = n ? r / n : 0; out[o + 1] = n ? g / n : 0; out[o + 2] = n ? b / n : 0;
    }
  }
  return out;
}

function pngStats(rgb) {
  let sum = 0, sum2 = 0;
  const n = rgb.length / 3;
  for (let k = 0; k < n; k++) {
    const l = 0.299 * rgb[k * 3] + 0.587 * rgb[k * 3 + 1] + 0.114 * rgb[k * 3 + 2];
    sum += l; sum2 += l * l;
  }
  const mean = sum / n;
  return { mean, variance: sum2 / n - mean * mean };
}

// ---------------------------------------------------------------- PNG out

function crc32(buf) {
  const t = [];
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  let r = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) r = t[(r ^ buf[i]) & 0xFF] ^ (r >>> 8);
  return (r ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
  const b = Buffer.alloc(8 + data.length + 4);
  b.writeUInt32BE(data.length, 0);
  b.write(type, 4, 'latin1');
  data.copy(b, 8);
  b.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'latin1'), data])), 8 + data.length);
  return b;
}
// Truecolor, which is what SFF v2 format 11 / color depth 24 means. Storing it
// this way is why no palette has to be built, quantized or touched.
function png24(rgb, w, h) {
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 3)] = 0;
    rgb.copy(raw, y * (1 + w * 3) + 1, y * w * 3, (y + 1) * w * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------- container

// One 28-byte node at the END of the node table, the payload at EOF, and four
// header counters moved. Every existing sprite's data offset is relative to
// ldataOffset, so shifting the table by 28 bytes needs no per-sprite fixup.
function appendPortraitV2(b, pngBytes, w, h) {
  const sprOfs = b.readUInt32LE(0x24), nSpr = b.readUInt32LE(0x28);
  const palOfs = b.readUInt32LE(0x2C);
  const lofs = b.readUInt32LE(0x34), llen = b.readUInt32LE(0x38), tofs = b.readUInt32LE(0x3C);
  const insertAt = sprOfs + nSpr * 28;

  // Refuse rather than risk, the same posture as modlib's portrait insert.
  if (palOfs > sprOfs && palOfs < insertAt) throw new Error('this .sff has an unusual layout (palette table inside the sprite table) - not editing it');
  if (lofs < insertAt) throw new Error('this .sff has an unusual layout - not editing it');
  for (let i = 0; i < nSpr; i++) {
    const o = sprOfs + i * 28;
    if (b.readUInt16LE(o) === 9000 && b.readUInt16LE(o + 2) === 1) {
      throw new Error('this stage already has a 9000,1 sprite');
    }
  }

  const payload = Buffer.concat([Buffer.alloc(4), pngBytes]);  // fmt 10-12 payloads start 4 bytes in
  const newLofs = lofs + 28;
  const dataAbs = b.length + 28;

  const node = Buffer.alloc(28);
  node.writeUInt16LE(9000, 0); node.writeUInt16LE(1, 2);
  node.writeUInt16LE(w, 4); node.writeUInt16LE(h, 6);
  node.writeInt16LE(0, 8); node.writeInt16LE(0, 10);   // axis 0,0 - the banner convention
  node.writeUInt16LE(0, 12);                            // not a link
  node[14] = 11; node[15] = 24;                         // PNG24: no palette involved
  node.writeUInt32LE(dataAbs - newLofs, 16);            // offsets are ldata-relative
  node.writeUInt32LE(payload.length, 20);
  node.writeUInt16LE(0, 24); node.writeUInt16LE(0, 26);

  const out = Buffer.concat([b.subarray(0, insertAt), node, b.subarray(insertAt), payload]);
  out.writeUInt32LE(nSpr + 1, 0x28);
  if (palOfs >= insertAt) out.writeUInt32LE(palOfs + 28, 0x2C);
  out.writeUInt32LE(newLofs, 0x34);
  out.writeUInt32LE(llen + 28 + payload.length, 0x38);
  if (tofs !== 0 && tofs >= insertAt) out.writeUInt32LE(tofs + 28, 0x3C);
  return out;
}

// ---------------------------------------------------------------- SFF v1

// SFF v1 holds 8-bit PCX, so a truecolor banner has to become 256 colors plus
// a palette. Median cut: split the color box with the widest channel at its
// median, repeatedly, then average each box. Good enough for a 240x100 banner
// and it needs no dependency.
//
// INDEX 0 IS RESERVED. MUGEN treats color 0 as transparent, so a thumbnail that
// used it would come out with holes; the image is quantized into 1..255 and
// index 0 is left as an unused black.
function quantize(rgb, w, h) {
  const n = w * h;
  let boxes = [[]];
  for (let k = 0; k < n; k++) boxes[0].push(k);
  const chan = (k, c) => rgb[k * 3 + c];
  while (boxes.length < 255) {
    // split the box with the largest spread on any channel
    let bi = -1, bc = 0, best = -1;
    for (let i = 0; i < boxes.length; i++) {
      if (boxes[i].length < 2) continue;
      for (let c = 0; c < 3; c++) {
        let lo = 255, hi = 0;
        for (const k of boxes[i]) { const v = chan(k, c); if (v < lo) lo = v; if (v > hi) hi = v; }
        if (hi - lo > best) { best = hi - lo; bi = i; bc = c; }
      }
    }
    if (bi < 0 || best <= 0) break;
    const box = boxes[bi];
    box.sort((a, b) => chan(a, bc) - chan(b, bc));
    const mid = box.length >> 1;
    boxes.splice(bi, 1, box.slice(0, mid), box.slice(mid));
  }
  const pal = Buffer.alloc(768);          // index 0 stays 0,0,0 and unused
  const centers = [];
  boxes.forEach((box, i) => {
    const slot = i + 1;
    if (slot > 255 || !box.length) return;
    let r = 0, g = 0, b = 0;
    for (const k of box) { r += chan(k, 0); g += chan(k, 1); b += chan(k, 2); }
    r = Math.round(r / box.length); g = Math.round(g / box.length); b = Math.round(b / box.length);
    pal[slot * 3] = r; pal[slot * 3 + 1] = g; pal[slot * 3 + 2] = b;
    centers.push([r, g, b, slot]);
  });
  const px = Buffer.alloc(n);
  for (let k = 0; k < n; k++) {
    const r = rgb[k * 3], g = rgb[k * 3 + 1], b = rgb[k * 3 + 2];
    let bd = Infinity, bs = 1;
    for (const c of centers) {
      const d = (r - c[0]) * (r - c[0]) + (g - c[1]) * (g - c[1]) + (b - c[2]) * (b - c[2]);
      if (d < bd) { bd = d; bs = c[3]; }
    }
    px[k] = bs;
  }
  return { px, pal };
}

function pcxRle(px, w, h) {
  const out = [];
  for (let y = 0; y < h; y++) {
    const row = px.subarray(y * w, (y + 1) * w);
    let x = 0;
    while (x < w) {
      let run = 1;
      while (x + run < w && row[x + run] === row[x] && run < 63) run++;
      const v = row[x];
      if (run > 1 || v >= 0xC0) out.push(0xC0 | run, v); else out.push(v);
      x += run;
    }
  }
  return Buffer.from(out);
}

// Append one subfile at EOF. The chain's last `next` already points at the old
// EOF (measured on this file), which is exactly where the new subfile lands, so
// the only in-place write is the sprite count in the header.
function appendPortraitV1(b, px, pal768, w, h) {
  const nSpr = b.readUInt32LE(20);
  let ofs = b.readUInt32LE(24), last = ofs;
  for (let i = 0; i < nSpr; i++) {
    last = ofs;
    if (b.readUInt16LE(ofs + 12) === 9000 && b.readUInt16LE(ofs + 14) === 1) {
      throw new Error('this stage already has a 9000,1 sprite');
    }
    const next = b.readUInt32LE(ofs);
    if (!next || next <= ofs || next + 32 > b.length) break;
    ofs = next;
  }
  const at = b.length;
  const pcx = Buffer.alloc(128);
  pcx[0] = 0x0a; pcx[1] = 5; pcx[2] = 1; pcx[3] = 8;      // ZSoft, v5, RLE, 8 bits
  pcx.writeUInt16LE(w - 1, 8); pcx.writeUInt16LE(h - 1, 10);
  pcx[65] = 1; pcx.writeUInt16LE(w, 66);                   // one plane, bytes per line
  const data = Buffer.concat([pcx, pcxRle(px, w, h), Buffer.from([0x0c]), Buffer.from(pal768)]);

  const hdr = Buffer.alloc(32);
  hdr.writeUInt32LE(at + 32 + data.length, 0);             // next -> the NEW end of file
  hdr.writeUInt32LE(data.length, 4);
  hdr.writeInt16LE(0, 8); hdr.writeInt16LE(0, 10);         // axis 0,0
  hdr.writeUInt16LE(9000, 12); hdr.writeUInt16LE(1, 14);
  hdr.writeUInt16LE(0, 16); hdr[18] = 0;                   // no link; owns its palette

  const out = Buffer.concat([b, hdr, data]);
  out.writeUInt32LE(nSpr + 1, 20);
  if (b.readUInt32LE(last) !== at) out.writeUInt32LE(at, last);
  return out;
}

// ---------------------------------------------------------------- the feature

function sffPathFor(stagesDir, defFile) {
  const text = fs.readFileSync(path.join(stagesDir, defFile), 'latin1');
  const m = /^\s*spr\s*=\s*(.+?)\s*(;.*)?$/im.exec(text);
  if (!m) return null;
  const rel = m[1].replace(/"/g, '').replace(/\\/g, '/').trim();
  // A stage in a folder of its own (stages/<folder>/x.def, a build opened in
  // place) names its sprite file beside itself first, the way the engine
  // reads it; a bare stage's candidates are exactly what they always were.
  const sub = path.posix.dirname(String(defFile).replace(/\\/g, '/'));
  const own = sub && sub !== '.' ? [
    path.join(stagesDir, sub, rel),
    path.join(stagesDir, rel.replace(/^stages\//i, '')),
    path.join(stagesDir, sub, path.basename(rel)),
  ] : [];
  const cands = [
    ...own,
    path.join(stagesDir, path.basename(rel)),
    path.join(stagesDir, rel.replace(/^stages\//i, '')),
  ];
  return cands.find((c) => fs.existsSync(c)) || null;
}

// A 3D-MODEL STAGE'S OWN PICTURE. Such a stage draws its scene from the model
// its [BGdef] names and has no background layers, so the composite has nothing
// to draw - yet such stages ship the select picture in their .sff: 9000,1, the
// sprite both bundled screenpacks name and hasThumb looks for (all five met so
// far: cvs2london, mvc2-circus, opgpc-thrillerbark and the engine's stage3d and
// stage3d_outline; 240x100 or 480x200). The card shows that sprite as the
// engine would draw it: decoded by tools/sff-decode.js, the same bytes
// /api/stage-sprite serves E-Select. Null when the stage has no such sprite.
// A read that fails (a busy file) throws with its code, so previewThumbCached
// does not remember it as the stage's answer.
const OWN_SPR = [9000, 1];
function ownPicture(sffPath) {
  const dec = require('./tools/sff-decode.js');
  const sff = dec.readSff(sffPath);
  let png = null;
  try { png = dec.spritePng(sff, OWN_SPR[0], OWN_SPR[1]) || null; } catch (e) { png = null; }
  if (!png || png.length < 24) return null;
  if (!Buffer.isBuffer(png)) png = Buffer.from(png);
  return { png, w: png.readUInt32BE(16), h: png.readUInt32BE(20) };
}

// Build the picture without writing anything. Returns the PNG plus why, so the
// UI can preview it before it touches a file.
//   opts.own: the card's preview (previewThumbCached) - when the def names a
//   model and the composite draws nothing, answer the stage's own picture
//   (ownPicture), marked `from: 'own'`, instead of the error. Never for a 2D
//   stage, and never for addThumb, which writes the composite.
function previewThumb(stagesDir, defFile, opts) {
  const defPath = path.join(stagesDir, defFile);
  if (!fs.existsSync(defPath)) throw new Error('no such stage');
  const sffPath = sffPathFor(stagesDir, defFile);
  if (!sffPath) throw new Error('this stage has no sprite file');
  const def = parseStageDef(fs.readFileSync(defPath, 'latin1'));
  const sff = core.readSff(new Uint8Array(fs.readFileSync(sffPath)));
  const existing = sff.byKey && sff.byKey.has('9000,1');
  const size = thumbSize(def);
  const canvas = compositeStage(def, sff);
  if (!canvas.drawn) {
    const own = opts && opts.own && def.model ? ownPicture(sffPath) : null;
    if (own) {
      return { png: own.png, w: own.w, h: own.h, layers: 0, from: 'own', sprite: OWN_SPR.slice(),
        localcoord: def.localcoord, sffPath, existing, sffVersion: sff.version };
    }
    throw new Error('nothing in this stage could be drawn');
  }
  const rgb = bannerFrom(canvas, size.w, size.h);
  const stats = pngStats(rgb);
  // Better no thumbnail than a black rectangle: the engine's own default is off.
  if (stats.mean < 12 || stats.variance < 4) {
    throw new Error('the composite came out blank - leaving this stage alone');
  }
  return {
    png: png24(rgb, size.w, size.h),
    rgb,                                   // kept for the v1 path, which needs pixels
    w: size.w, h: size.h,
    layers: canvas.drawn,
    localcoord: def.localcoord,
    sffPath, existing, sffVersion: sff.version,
  };
}

// THE CARD'S PREVIEW, REMEMBERED. The Studio rebuilds every stage card on each
// roster render, and each card asks for its picture again; compositing reads
// the whole .sff and encodes a fresh PNG, up to about 300 KB. The picture depends
// on nothing but the def and the sff, so it is kept per def and stamped by both
// files' size and mtime: adding or removing the thumbnail rewrites the sff and
// misses, and an edited def can point at another sff, which misses too. A stage
// that composites blank is remembered as its error, so it is not rebuilt either.
// Only what the response needs is kept, never the rgb buffer, and the oldest
// entries go past PREVIEW_CAP.
// A 3D-model stage's own picture (previewThumb opts.own) is kept the same way:
// it too depends on nothing but the def (its `model` line, its layers) and the
// sff (its 9000,1), so the same two stamps cover it.
const PREVIEW_CAP = 64;
const previewCache = new Map();
const fileStamp = (p) => { try { const s = fs.statSync(p); return s.size + '@' + s.mtimeMs; } catch (e) { return '-'; } };

function previewThumbCached(stagesDir, defFile) {
  const defPath = path.resolve(stagesDir, defFile);
  let sffPath = null;
  try { sffPath = sffPathFor(stagesDir, defFile); } catch (e) { /* previewThumb says why */ }
  const stamp = fileStamp(defPath) + '|' + (sffPath ? sffPath + '|' + fileStamp(sffPath) : '-');
  const hit = previewCache.get(defPath);
  if (hit && hit.stamp === stamp) {
    previewCache.delete(defPath); previewCache.set(defPath, hit);   // most recent last
    if (hit.error) throw new Error(hit.error);
    return hit.made;
  }
  let entry;
  try {
    const m = previewThumb(stagesDir, defFile, { own: true });
    entry = { stamp, made: m.from ? { png: m.png, w: m.w, h: m.h, layers: m.layers, from: m.from, sprite: m.sprite }
      : { png: m.png, w: m.w, h: m.h, layers: m.layers } };
  } catch (e) {
    // A read that failed (a file busy or gone mid-request) is not the stage's
    // answer; only what the stage itself produced is remembered.
    if (e && e.code) { previewCache.delete(defPath); throw e; }
    entry = { stamp, error: String(e && e.message || e) };
  }
  previewCache.delete(defPath);
  previewCache.set(defPath, entry);
  while (previewCache.size > PREVIEW_CAP) previewCache.delete(previewCache.keys().next().value);
  if (entry.error) throw new Error(entry.error);
  return entry.made;
}

// Write it in. Backs up once, appends, then RE-READS the file and checks that
// every sprite the stage's own def asks for still decodes - restoring the backup
// if anything moved. Neither the engine nor the exporter would tell you: a stage
// whose sprites vanished still loads, and draws nothing.
function addThumb(stagesDir, defFile) {
  const made = previewThumb(stagesDir, defFile);
  if (made.existing) throw new Error('this stage already has a thumbnail');
  const before = fs.readFileSync(made.sffPath);
  let after;
  if (made.sffVersion === 2) {
    after = appendPortraitV2(before, made.png, made.w, made.h);
  } else if (made.sffVersion === 1) {
    // v1 holds 8-bit PCX, so the banner is quantized and carries its own palette.
    const q = quantize(made.rgb, made.w, made.h);
    after = appendPortraitV1(before, q.px, q.pal, made.w, made.h);
  } else {
    throw new Error('this sprite file is version ' + made.sffVersion + ', which the Studio cannot edit');
  }

  const bak = made.sffPath + BAK;
  if (!fs.existsSync(bak)) fs.copyFileSync(made.sffPath, bak);
  fs.writeFileSync(made.sffPath, after);

  try {
    verifyIntact(before, fs.readFileSync(made.sffPath), made.w, made.h);
  } catch (e) {
    fs.copyFileSync(bak, made.sffPath);
    fs.unlinkSync(bak);
    throw new Error('the edit did not verify, so the stage was put back: ' + e.message);
  }
  return { w: made.w, h: made.h, layers: made.layers, sff: path.basename(made.sffPath) };
}

// Every sprite that was there must still decode to the same pixels, and the new
// one must read back at the size it was written.
function verifyIntact(beforeBuf, afterBuf, w, h) {
  const A = core.readSff(new Uint8Array(beforeBuf));
  const B = core.readSff(new Uint8Array(afterBuf));
  if (B.byKey.size !== A.byKey.size + 1) throw new Error('sprite count is wrong');
  for (const key of A.byKey.keys()) {
    const [g, i] = key.split(',').map(Number);
    let a = null, b = null;
    try { a = core.decodeSprite(A, g, i); } catch (e) { a = null; }
    try { b = core.decodeSprite(B, g, i); } catch (e) { b = null; }
    if (!a !== !b) throw new Error('sprite ' + key + ' stopped decoding');
    if (!a) continue;
    const pa = a.kind === 'png' ? a.bytes : a.px;
    const pb = b.kind === 'png' ? b.bytes : b.px;
    if (!pa || !pb || Buffer.compare(Buffer.from(pa), Buffer.from(pb)) !== 0) {
      throw new Error('sprite ' + key + ' changed');
    }
  }
  const n = core.decodeSprite(B, 9000, 1);
  if (!n) throw new Error('the new thumbnail did not read back');
  const geom = core.spriteGeom(B, 9000, 1);
  if (geom && (geom.w !== w || geom.h !== h)) throw new Error('the new thumbnail read back the wrong size');
}

function hasBackup(stagesDir, defFile) {
  const p = sffPathFor(stagesDir, defFile);
  return !!(p && fs.existsSync(p + BAK));
}

function removeThumb(stagesDir, defFile) {
  const p = sffPathFor(stagesDir, defFile);
  if (!p) throw new Error('this stage has no sprite file');
  const bak = p + BAK;
  if (!fs.existsSync(bak)) throw new Error('no backup to go back to');
  fs.copyFileSync(bak, p);
  fs.unlinkSync(bak);
  return { reverted: true };
}

// ONE SPRITE OUT OF THE STAGE'S OWN .sff, as the PNG the engine would draw -
// E-Select's stage portraits (GET /api/stage-sprite). Not the composite above:
// the select screen shows `stage.portrait.spr` straight out of each stage's
// file, so an editor that means to show what ships shows that sprite or
// nothing. Decoded by tools/sff-decode.js, the same decoder every character
// portrait goes through (v1 and v2, palettes, index-0 transparency).
//
// Remembered by sff path, size+mtime and sprite number, a missing sprite too,
// so a Stages tab redrawn on every edit does not re-read every stage's .sff;
// adding or removing the 9000,1 thumbnail rewrites the file and misses.
// Returns null when the stage names no sprite file or the sprite is absent.
const SPRITE_CAP = 96;
const spriteCache = new Map();
function stageSpritePng(stagesDir, defFile, group, index) {
  const sffPath = sffPathFor(stagesDir, defFile);
  if (!sffPath) return null;
  const key = sffPath + '|' + fileStamp(sffPath) + '|' + group + ',' + index;
  if (spriteCache.has(key)) {
    const hit = spriteCache.get(key);
    spriteCache.delete(key);
    spriteCache.set(key, hit);
    return hit;
  }
  let png = null;
  try {
    const dec = require('./tools/sff-decode.js');
    png = dec.spritePng(dec.readSff(sffPath), group, index) || null;
  } catch (e) { png = null; }
  spriteCache.set(key, png);
  while (spriteCache.size > SPRITE_CAP) spriteCache.delete(spriteCache.keys().next().value);
  return png;
}

// Does this stage already show a thumbnail in game?
function hasThumb(stagesDir, defFile) {
  const p = sffPathFor(stagesDir, defFile);
  if (!p) return false;
  try {
    const sff = core.readSff(new Uint8Array(fs.readFileSync(p)));
    return !!(sff.byKey && sff.byKey.has('9000,1'));
  } catch (e) { return false; }
}

module.exports = {
  parseStageDef, thumbSize, compositeStage, bannerFrom, png24,
  appendPortraitV2, appendPortraitV1, quantize, pcxRle,
  previewThumb, previewThumbCached, addThumb, removeThumb, hasThumb, hasBackup,
  sffPathFor, BAK, previewCache, stageSpritePng, spriteCache,
};
