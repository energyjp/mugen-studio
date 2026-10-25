//
// nearfit.js - "Fix flicker on desktop" for a 3D-model stage: a near plane as
// far from the camera as the model allows, so the desktop engine's depth
// buffer can tell surfaces that sit close together apart.
//
// WHY A MODEL STAGE FLICKERS ON DESKTOP. The official Ikemen GO 1.0 draws a
// model against a 16-bit depth buffer (render_gl33.go: DEPTH_COMPONENT16); the
// web build's is 24-bit (render_webgl.go: DEPTH_COMPONENT24), 256 times finer.
// A perspective depth buffer spends its steps near the camera: the gap it can
// still resolve at depth d is about d * d / (near * 2^bits). A stage whose
// [Camera] near is tiny (Galar Stadium: near = 0.1, far = 1000) cannot
// separate surfaces a hair apart in the distance, and two of them (a wall and
// the panels painted on it) take turns in front as the camera moves: the
// "gate" Galar's barrier shows on desktop and not on the web. Raising near
// makes every depth that much finer; it cuts off whatever is nearer than it.
//
// HOW FAR NEAR CAN GO. The nearest point of the model the camera can ever
// show: every triangle (the rest pose, widefit3d.js sceneTriangles) clipped to
// what the screen sees across the camera's whole pan (its bounds and the zoom
// room, widefit3d.js edgeX), its height (boundhigh to the floor) and every
// zoom from zoomout to zoomin - the projection widefit3d.js predicts the void
// with. The fit sets near to half of that, rounded down to two digits, and
// only when that is at least twice the def's own near: a smaller gain is not
// worth an edit. far stays as it is (the precision barely depends on it).
//
// THE EDIT. near in the def's first [Camera] - in the stage's def and each
// round variant's, each against its own model - under a marker line holding
// the old value; every other byte as it was, each line's own ending included,
// so Undo puts the file back byte for byte (the thumbfit.js pattern).
const fs = require('fs');
const path = require('path');
const tt = require('./textransform.js');
const w3 = require('./widefit3d.js');

const MARK = '; near fit (Mugen Studio):';
const MARGIN = 0.5;          // near = this share of the nearest point the camera can show
const MIN_GAIN = 2;          // offered only when near can go at least this many times further
const SEC_RE = /^\s*\[([^\]]+)\]/;
const KEY_RE = /^(\s*near\s*=[ \t]*)([^;\r\n]*?)([ \t]*(?:;[^\r\n]*)?)$/i;
const segs = (text) => text.match(/[^\n]*\n|[^\n]+$/g) || [];
const bare = (s) => s.replace(/\r?\n$/, '');
const eolOf = (s) => (/\r\n$/.test(s) ? '\r\n' : /\n$/.test(s) ? '\n' : '');
const fileEol = (text) => (text.includes('\r\n') ? '\r\n' : '\n');

// ---------------------------------------------------------------- the model

// One polygon clipped to the half space a*x + b*y + c*d + e >= 0 (Sutherland-Hodgman).
function clip(poly, a, b, c, e) {
  const out = [];
  const n = poly.length / 3;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const x0 = poly[i * 3], y0 = poly[i * 3 + 1], d0 = poly[i * 3 + 2];
    const x1 = poly[j * 3], y1 = poly[j * 3 + 1], d1 = poly[j * 3 + 2];
    const f0 = a * x0 + b * y0 + c * d0 + e, f1 = a * x1 + b * y1 + c * d1 + e;
    if (f0 >= 0) out.push(x0, y0, d0);
    if ((f0 >= 0) !== (f1 >= 0)) {
      const s = f0 / (f0 - f1);
      out.push(x0 + s * (x1 - x0), y0 + s * (y1 - y0), d0 + s * (d1 - d0));
    }
  }
  return out;
}

// The smallest eye-space depth at which any part of the model can be on the
// screen, over the camera's pan, its height and its zooms. Infinity when none is.
function nearestDepth(scene, c, camYs) {
  const { pos, count } = scene;
  const [sx, sy, sz] = c.scale;
  const k = 1 / c.kx;                                    // |x + s| <= k * depth is on the screen
  let best = Infinity;
  for (const z of w3.zoomsOf(c)) {
    // the model's sideways offset over the pan: s = [Model] offset.x / zoom - camX * posMul
    const ox = c.offset[0] / z, pm = c.posMul;
    const s1 = ox - w3.edgeX(c, z, c.boundleft, -1) * pm, s2 = ox - w3.edgeX(c, z, c.boundright, 1) * pm;
    const sMin = Math.min(s1, s2), sMax = Math.max(s1, s2);
    const offZ = c.offset[2] / z;
    const syo = -(c.zoffset - c.Ly / 2) * (1 - z) / z;
    const zac = c.zoomanchor ? (c.zoffset * c.localscl) - (c.Hg + c.ac - (c.Hg - c.zoffset * c.localscl + c.ac) * z) : 0;
    const ty = zac / c.Hg * 2 + c.syo2 + c.aspCorr;
    const qOf = (ndc) => ((ndc - ty) / c.sY - c.yshift * z) / c.f;   // y / depth on that screen row
    const qTop = qOf(1), qBot = qOf(-1);
    for (const camY of camYs) {
      const offY = (camY / z + syo) * c.posMul + c.offset[1];
      for (let t = 0; t < count; t++) {
        const b = t * 9;
        let poly = [
          sx * pos[b], sy * pos[b + 1] + offY, -(sz * pos[b + 2] + offZ),
          sx * pos[b + 3], sy * pos[b + 4] + offY, -(sz * pos[b + 5] + offZ),
          sx * pos[b + 6], sy * pos[b + 7] + offY, -(sz * pos[b + 8] + offZ),
        ];
        if (poly[2] >= best && poly[5] >= best && poly[8] >= best) continue;   // nothing nearer than found
        poly = clip(poly, 0, 0, 1, -1e-6);                 // in front of the eye
        if (poly.length) poly = clip(poly, -1, 0, k, -sMin);   // x <= k*d - sMin: on screen at some pan
        if (poly.length) poly = clip(poly, 1, 0, k, sMax);     // x >= -k*d - sMax
        if (poly.length) poly = clip(poly, 0, -1, qTop, 0);    // y <= qTop * d
        if (poly.length) poly = clip(poly, 0, 1, -qBot, 0);    // y >= qBot * d
        for (let i = 2; i < poly.length; i += 3) if (poly[i] < best) best = poly[i];
      }
    }
  }
  return best;
}

// Rounded down to two significant digits, as a plain decimal.
function roundDown2(x) {
  if (!(x > 0) || !Number.isFinite(x)) return 0;
  const e = Math.floor(Math.log10(x)) - 1;
  const p = Math.pow(10, e);
  const v = Math.floor(x / p) * p;
  return Number(v.toFixed(Math.max(0, -e)));
}

// What near can be for one def and its model.
function planDef(text, scene, shape) {
  const c = w3.cameraOf(text, shape);
  const d = w3.readDef(text);
  const cam = d.get('camera') || new Map();
  const bh = parseInt(String(cam.get('boundhigh') == null ? '0' : cam.get('boundhigh')), 10);
  const high = Number.isFinite(bh) && bh < 0 ? bh : 0;
  const nearest = nearestDepth(scene, c, [...new Set([0, high / 2, high])]);
  const to = Number.isFinite(nearest) ? roundDown2(nearest * MARGIN) : 0;
  const gain = c.near > 0 ? to / c.near : 0;
  return {
    near: c.near, far: c.far, nearest: Number.isFinite(nearest) ? Number(nearest.toPrecision(4)) : null, to,
    gain: Math.round(gain * 10) / 10,
    offer: to > 0 && to < c.far && gain >= MIN_GAIN,
  };
}

// ---------------------------------------------------------------- the def

function scanCamera(ls) {
  let info = null;
  for (let i = 0; i < ls.length; i++) {
    const m = SEC_RE.exec(bare(ls[i]));
    if (!m || m[1].trim().toLowerCase() !== 'camera') continue;
    let e = i + 1;
    while (e < ls.length && !SEC_RE.test(bare(ls[e]))) e++;
    info = { header: i, start: i + 1, end: e };
    break;
  }
  const out = { info, key: null, marker: null };
  if (!info) return out;
  for (let i = info.start; i < info.end; i++) {
    const l = bare(ls[i]);
    if (out.marker === null && l.trim().startsWith(MARK)) { out.marker = i; continue; }
    if (!out.key) { const m = KEY_RE.exec(l); if (m) out.key = { i, value: m[2], m }; }
  }
  return out;
}
const fittedText = (text) => scanCamera(segs(text)).marker !== null;

// The def's text with near set. A [Camera] without near gets the key under its header.
function applyText(text, to) {
  const ls = segs(text);
  const s = scanCamera(ls);
  if (s.marker !== null) throw new Error('already fitted');
  if (!s.info) throw new Error('its def has no [Camera]');
  let at, eolAdded = false;
  if (s.key) {
    const end = ls[s.key.i].slice(bare(ls[s.key.i]).length);
    ls[s.key.i] = s.key.m[1] + String(to) + s.key.m[3] + end;
    at = s.key.i;
  } else {
    const eol = eolOf(ls[s.info.header]) || fileEol(text);
    if (!eolOf(ls[s.info.header])) { ls[s.info.header] += eol; eolAdded = true; }   // a [Camera] header that ends the file
    ls.splice(s.info.header + 1, 0, 'near = ' + String(to) + eol);
    at = s.info.header + 1;
  }
  const eol = eolOf(ls[at]) || fileEol(text);
  ls.splice(at, 0, MARK + ' near was ' + (s.key ? JSON.stringify(s.key.value) : 'absent') + ' | set ' + String(to) + (eolAdded ? ' | newline added' : '') + eol);
  return ls.join('');
}

// The def's text as it was before the fit. Throws when near was changed since.
function undoText(text) {
  const ls = segs(text);
  const s = scanCamera(ls);
  if (s.marker === null) throw new Error('not fitted');
  const body = bare(ls[s.marker]).slice(bare(ls[s.marker]).indexOf(MARK) + MARK.length);
  const wasM = /near was ("(?:[^"\\]|\\.)*"|absent)/.exec(body), setM = /\|\s*set (\S+)/.exec(body);
  if (!wasM || !setM) throw new Error('the near-fit marker is unreadable, so the def was left as it is');
  if (!s.key) throw new Error('near is gone since the fit; the def was left as it is');
  if (s.key.value.trim() !== setM[1]) throw new Error('near is ' + s.key.value.trim() + ' now, not the ' + setM[1] + ' the fit set: the def was left as it is');
  if (wasM[1] === 'absent') {
    ls.splice(s.key.i, 1);
  } else {
    const end = ls[s.key.i].slice(bare(ls[s.key.i]).length);
    ls[s.key.i] = s.key.m[1] + JSON.parse(wasM[1]) + s.key.m[3] + end;
  }
  ls.splice(s.marker, 1);
  // the newline the fit gave a [Camera] header that ended the file
  if (/\|\s*newline added/.test(body)) ls[s.info.header] = bare(ls[s.info.header]);
  return ls.join('');
}

// ---------------------------------------------------------------- a stage

const stampOf = (p) => { try { const s = fs.statSync(p); return s.size + '@' + s.mtimeMs + '@' + s.ctimeMs; } catch (e) { return '-'; } };
const STATUS = new Map();
const STATUS_MAX = 4096;

// What the card shows. null for a stage none of whose defs names a model.
//   { defs: [{ def, model, fitted, near, nearest, to, gain, offer, error }], offer, fitted, gain }
function status(stagesDir, defFile, settings) {
  const sh = w3.shapeOf(settings);
  const full = path.resolve(stagesDir, defFile);
  const defs0 = tt.stageDefs(stagesDir, defFile);
  const stamp = defs0.map((d) => stampOf(d.full) + '|' + (d.modelFull ? stampOf(d.modelFull) : '-')).join(';') + '|' + [sh.window, sh.fight, sh.zoom].join(',');
  const hit = STATUS.get(full);
  if (hit && hit.stamp === stamp) return JSON.parse(hit.json);
  let res = null;
  if (defs0.some((d) => d.modelFull)) {
    const defs = defs0.map((d) => {
      const text = fs.readFileSync(d.full, 'latin1');
      const e = { def: d.def, model: d.model, fitted: fittedText(text) };
      if (!d.modelFull) return Object.assign(e, { offer: false, reason: 'names no model' });
      try { Object.assign(e, planDef(text, w3.modelScene(d.modelFull), sh)); } catch (err) { Object.assign(e, { offer: false, error: String((err && err.message) || err) }); }
      return e;
    });
    const open = defs.filter((d) => d.offer && !d.fitted);
    res = { defs, offer: open.length > 0, fitted: defs.some((d) => d.fitted), gain: Math.max(0, ...open.map((d) => d.gain || 0)) };
  }
  if (STATUS.size >= STATUS_MAX && !STATUS.has(full)) STATUS.clear();
  STATUS.set(full, { stamp, json: JSON.stringify(res) });
  return res;
}

// Raise near in every def of the stage that can take it. Each def is read back
// after the write; one that does not read back as planned puts every def of
// the call back.
function fit(stagesDir, defFile, settings) {
  const st = status(stagesDir, defFile, settings);
  if (!st) throw new Error('this stage names no 3D model');
  const work = st.defs.filter((d) => d.offer && !d.fitted);
  if (!work.length) throw new Error(st.fitted ? 'already fitted' : 'its near plane is already as far out as its model allows');
  const done = [];
  try {
    for (const d of work) {
      const p = path.resolve(stagesDir, d.def);
      const before = fs.readFileSync(p, 'latin1');
      const after = applyText(before, d.to);
      done.push({ p, before });
      fs.writeFileSync(p, after, 'latin1');
      if (fs.readFileSync(p, 'latin1') !== after || undoText(after) !== before) throw new Error(d.def + ' did not read back as the fit');
    }
  } catch (e) {
    for (const { p, before } of done.reverse()) { try { fs.writeFileSync(p, before, 'latin1'); } catch (err) { /* reported below */ } }
    STATUS.delete(path.resolve(stagesDir, defFile));
    throw new Error('the edit did not go through, so the stage was put back: ' + e.message);
  }
  STATUS.delete(path.resolve(stagesDir, defFile));
  return { defs: work.map((d) => ({ def: d.def, model: d.model, from: d.near, to: d.to, gain: d.gain })) };
}

// Undo every fitted def of the stage. All are checked before any is written.
function undo(stagesDir, defFile) {
  const work = [];
  for (const d of tt.stageDefs(stagesDir, defFile)) {
    const before = fs.readFileSync(d.full, 'latin1');
    if (!fittedText(before)) continue;
    work.push({ d, after: undoText(before) });
  }
  if (!work.length) throw new Error('not fitted');
  for (const w of work) fs.writeFileSync(w.d.full, w.after, 'latin1');
  STATUS.delete(path.resolve(stagesDir, defFile));
  return { defs: work.map((w) => ({ def: w.d.def })) };
}

module.exports = { MARK, MARGIN, MIN_GAIN, nearestDepth, roundDown2, planDef, applyText, undoText, status, fit, undo, STATUS };
