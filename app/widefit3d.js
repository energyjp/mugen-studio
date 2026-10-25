'use strict';
//
// widefit3d.js - "Fit camera to model" for a 3D-model stage: camera bounds
// that keep the screen's sides on the model, so the fight does not show the
// black past the model's end.
//
// WHY A MODEL STAGE SHOWS BLACK AT ITS SIDES. The camera of a stage, model or
// not, scrolls until the screen's edge reaches
//   boundright + localcoord.w / (2 * zoomout)
// stage units right of the center (camera.go: maxRight = boundright * localscl
// + halfWidth / zoomout; the left side mirrors it), at every zoom: zoomed in,
// the camera slides further out before its edge gets there. A model is drawn
// in perspective (model.go drawModel) and ends where its author stopped
// building; past it the screen shows the clear color. cvs2london2 (bounds
// -650/650, zoomout 0.8) shows 182 px of black at the right of a 1064 px
// fight with both fighters in the corner, 241 px at its bottom rows.
//
// NOT THE BUILD'S SHAPE. drawModel's horizontal scale,
//   ndc_x = scaleX * f / windowAspect * x / depth,  scaleX = localcoord.h * localscl / gameHeight
// with the engine's pillarbox correction, comes to localcoord.h / localcoord.w
// * f for a fight of any shape: the screen spans localcoord.w stage units at
// the depth of [Model] offset.z, whatever the aspect. The fight's shape
// (getFightAspect: the stage's localcoord unless FightAspectWidth/Height say
// otherwise) decides how much the screen shows vertically, so which rows of
// an edge are looked at. Only a stage wider than the game window (letterboxed)
// differs: there the engine's own correction draws the model larger (its
// "TODO: In the letterbox case"), and cameraOf follows it as written.
//
// HOW THE BLACK IS PREDICTED. The camera pans a model stage by moving the
// model sideways in eye space (offset.x = -camX * posMul + [Model] offset.x /
// zoom); a sideways pan never moves it vertically. So for one zoom and one
// screen row, the rays through an edge column at every camera x are parallel
// and lie in one plane: a triangle crossing that plane (between near and far,
// facing the ray when its material is single-sided) covers the edge pixel for
// one interval of camera x. The union per row says where the edge sees the
// model. A row counts when the edge sees the model with the camera at its
// start (startx); the fit keeps the camera inside the covered run around the
// start in every such row, at every zoom sampled from zoomout to zoomin. With
// [Model] offset.x 0 the bound a point allows is the same at every zoom (the
// 1/zoom of the dolly and of maxRight cancel); the zoom still changes which
// rows the edge crosses. The geometry is the model's rest pose (node
// transforms, skins in their bind pose through their joints), every primitive
// the engine draws (scenes 0 and 1, layers -1..1, a material), transparent
// materials included: a card with see-through texels counts as covering. An
// animated node (a moving bus) is where it rests. A 2D layer of the def that
// covers an edge wherever the camera is (backdropRows) hides those rows.
// Checked against headless web matches (2026-10-23): the black per row at
// cvs2london2's right corner (bounds 650 and 450) and left corner (before and
// after the fit), and at cvs2london's left edge at the start, matched the
// screenshots within 2 px wherever no fighter or lifebar covered the row;
// zoomed out, the widest black matched within 3 px.
//
// THE EDIT is boundleft / boundright in the first [Camera] of the stage's
// def and of each round variant's def (round1def ..., modlib.roundDefNames),
// each fitted to its own model and camera: a round variant draws its own
// model. Only a bound that lets the screen past its model is changed, and
// only inward, never past startx: where the model does not fill the screen
// even at the camera's start, the bound stops there and that black stays
// (voidAfter). The value is changed in place (spacing and comment kept)
// under a marker line holding both old values, every other byte as it was,
// each line's own ending included, so Undo puts the file back byte for byte
// (the thumbfit.js pattern). Undo refuses when a bound has been changed since
// the fit (Widescreen fit pulls bounds in too): undo that first.
//
// WIDESCREEN FIT IS ANOTHER REPAIR. widefit.js widens a narrow stage's
// localcoord to the build's shape and pulls its bounds in by the widening; it
// is unchanged, and on a 4:3 model stage it shows more of the model's sides.
// This fit reads whatever localcoord and bounds the def has at the time, so
// after a Widescreen fit it fits the widened stage.
const fs = require('fs');
const path = require('path');
const tt = require('./textransform.js');

const MARK = '; camera fit (Mugen Studio):';
const ROWS = 144;                 // screen rows sampled, top to bottom
const ZOOMS = 7;                  // zoom levels sampled, zoomout to zoomin
const EDGE = 1 - 1 / 1280;        // the outermost pixel column's center, in NDC
const GAP_PX = 2;                 // a coverage gap narrower than this (pixels of 1280) is a crack, not void
const MAX_MODEL = 512 * 1024 * 1024;

// ---------------------------------------------------------------- the def

const SEC_RE = /^\s*\[([^\]]+)\]/;
// The text as lines that KEEP their endings (thumbfit.js): joined back with ''
// they are the file, byte for byte.
const segs = (text) => text.match(/[^\n]*\n|[^\n]+$/g) || [];
const bare = (s) => s.replace(/\r?\n$/, '');
const eolOf = (s) => (/\r\n$/.test(s) ? '\r\n' : /\n$/.test(s) ? '\n' : '');
const fileEol = (text) => (text.includes('\r\n') ? '\r\n' : '\n');

// The first section of each name, its first value of each key - as the engine
// reads a def (common.go IniSection.Parse: the first of a duplicate key wins;
// stage.go getSection: the first section).
function readDef(text) {
  const secs = new Map();
  let cur = null;
  for (const raw of String(text).split(/\r?\n/)) {
    const h = SEC_RE.exec(raw);
    if (h) {
      const n = h[1].trim().toLowerCase();
      cur = secs.has(n) ? null : new Map();
      if (cur) secs.set(n, cur);
      continue;
    }
    if (!cur) continue;
    const line = raw.split(';')[0].trim();
    const ia = line.search(/[= \t]/);
    if (ia <= 0) continue;
    const eq = line.indexOf('=');
    const key = line.slice(0, ia).toLowerCase();
    if (!cur.has(key)) cur.set(key, eq >= 0 ? line.slice(eq + 1).trim() : '');
  }
  return secs;
}
const nums = (v) => String(v == null ? '' : v).split(',').map((x) => parseFloat(x));
function getF(secs, sec, key, def) {
  const s = secs.get(sec);
  if (!s || !s.has(key)) return def;
  const v = nums(s.get(key))[0];
  return Number.isFinite(v) ? v : def;
}
const getI = (secs, sec, key, def) => { const v = getF(secs, sec, key, null); return v === null ? def : Math.trunc(v); };
function getV(secs, sec, key, n, def) {
  const s = secs.get(sec);
  const out = def.slice();
  if (!s || !s.has(key)) return out;
  const v = nums(s.get(key));
  for (let i = 0; i < n && i < v.length; i++) { if (!Number.isFinite(v[i])) break; out[i] = v[i]; }
  return out;
}

// THE FIGHT'S SHAPE, as the engine picks it (system.go getFightAspect): the
// stage's localcoord when FightAspectWidth/Height are both negative (the
// default), the pair when both are positive, else the game window's.
// settings: the roster's ('Video.GameWidth', 'Video.FightAspectWidth', ...).
function shapeOf(settings) {
  const s = settings || {};
  const gw = parseInt(s['Video.GameWidth'], 10), gh = parseInt(s['Video.GameHeight'], 10);
  const fw = parseInt(s['Video.FightAspectWidth'] == null ? '-1' : s['Video.FightAspectWidth'], 10);
  const fh = parseInt(s['Video.FightAspectHeight'] == null ? '-1' : s['Video.FightAspectHeight'], 10);
  const window = gw > 0 && gh > 0 ? gw / gh : 854 / 480;
  const fight = fw < 0 && fh < 0 ? 'stage' : fw > 0 && fh > 0 ? fw / fh : window;
  const zoom = String(s['Config.ZoomActive'] == null ? '1' : s['Config.ZoomActive']).trim() !== '0';
  return { window, fight, zoom };
}

// Everything drawModel and the camera use, from the def and the build's shape.
function cameraOf(text, shape) {
  const d = readDef(text);
  const sh = shape || shapeOf(null);
  const lc = getV(d, 'stageinfo', 'localcoord', 2, [320, 240]);
  const Lx = lc[0] > 0 ? lc[0] : 320, Ly = lc[1] > 0 ? lc[1] : 240;
  const cam = d.get('camera') || new Map();
  const c = {
    Lx, Ly,
    startx: getI(d, 'camera', 'startx', 0),
    boundleft: getI(d, 'camera', 'boundleft', 0), boundright: getI(d, 'camera', 'boundright', 0),
    has: { boundleft: cam.has('boundleft'), boundright: cam.has('boundright') },
    zoomout: getF(d, 'camera', 'zoomout', 1), zoomin: getF(d, 'camera', 'zoomin', 1),
    autozoom: /^\s*(1|true)\s*$/i.test(cam.get('autozoom') || ''),
    zoomanchor: /^\s*bottom\s*$/i.test(cam.get('zoomanchor') || ''),
    fov: getF(d, 'camera', 'fov', 40), yshift: getF(d, 'camera', 'yshift', 0),
    near: getF(d, 'camera', 'near', 0.1), far: getF(d, 'camera', 'far', 10000),
    cuthigh: getI(d, 'camera', 'cuthigh', 0), cutlow: getI(d, 'camera', 'cutlow', null),
    overdrawlow: getI(d, 'camera', 'overdrawlow', 0),
    offset: getV(d, 'model', 'offset', 3, [0, 0, 0]), scale: getV(d, 'model', 'scale', 3, [1, 1, 1]),
  };
  c.zoomin = Math.max(c.zoomin, c.zoomout);              // camera.go Reset
  c.zoomOn = sh.zoom && (c.zoomin !== 1 || c.zoomout !== 1 || c.autozoom);
  c.afight = sh.fight === 'stage' ? Lx / Ly : sh.fight;
  c.awin = sh.window;
  const Hg = 240, Wg = Hg * c.afight;                     // system.go applyFightAspect
  c.Hg = Hg; c.Wg = Wg;
  c.localscl = Wg / Lx;                                   // stage.go updateLocalScale
  const half = Math.tan((c.fov * Math.PI / 180) / 2);
  c.f = 1 / half;
  c.posMul = half * -c.offset[2] / (Ly / 2);
  // the zoffset the engine derives from [Model] offset, fov and yshift (stage.go)
  c.zoffset = c.posMul !== 0 ? Math.trunc(Ly / 2 - c.offset[1] / c.posMul - c.yshift * Ly / 2) : 0;
  // camera.go Reset: cutlow's default and the aspect correction
  if (c.cutlow === null) c.cutlow = Math.trunc((Ly - c.zoffset) - Ly * 0.05);
  const lsH = Ly * c.localscl, ceil = (x) => Math.ceil(x);
  let ac = 0;
  if (lsH - Hg < 0) ac = Math.min(0, (lsH - Hg) + Math.min((Hg - lsH) / 2, c.overdrawlow * c.localscl));
  else if (lsH - Hg > 0) {
    if (c.cuthigh + c.cutlow <= 0) ac = ceil(lsH) - Hg;
    else {
      const diff = ceil(lsH) - Hg;
      const tmp = ceil(c.cuthigh * c.localscl) * diff / (ceil(c.cuthigh * c.localscl) + ceil(c.cutlow * c.localscl));
      ac = diff - tmp <= c.cutlow ? tmp : diff - ceil(c.cutlow * c.localscl);
    }
  }
  c.ac = ac;
  // drawModel: the scale correction and the engine's pillarbox / letterbox fix
  c.scaleCorrection = Ly * c.localscl / Hg;
  c.sX = c.scaleCorrection; c.sY = c.scaleCorrection;
  if (c.awin > c.afight) c.sX *= c.awin / c.afight;
  else if (c.awin < c.afight) c.sY *= c.afight / c.awin;
  c.kx = c.sX * c.f / c.awin;                              // ndc_x = kx * x / depth
  c.syo2 = -(c.zoffset - Ly / 2) * (1 - c.scaleCorrection) / Ly * 2;
  c.aspCorr = (c.zoffset / Ly - (c.zoffset * c.localscl - c.ac) / Hg) * 2;
  return c;
}

// The zoom levels the fight can show, and where the camera's center sits (in
// stage units) when the screen's edge is at its bound at that zoom.
function zoomsOf(c) {
  if (!c.zoomOn) return [1];
  const out = [];
  for (let k = 0; k < ZOOMS; k++) out.push(c.zoomout + (c.zoomin - c.zoomout) * k / (ZOOMS - 1));
  return [...new Set(out)];
}
function reach(c, z) {
  // camera.go: maxRight = boundright * localscl + halfWidth / zoomout (autozoom: + halfWidth)
  const room = c.autozoom ? c.Lx / 2 : c.Lx / (2 * c.zoomout);
  return room - c.Lx / (2 * z);
}
const edgeX = (c, z, bound, side) => bound + side * reach(c, z);

// ---------------------------------------------------------------- the model

const COMP = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const NCOMP = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
function readComp(buf, o, ct, norm) {
  switch (ct) {
    case 5126: return buf.readFloatLE(o);
    case 5120: { const v = buf.readInt8(o); return norm ? Math.max(v / 127, -1) : v; }
    case 5121: { const v = buf.readUInt8(o); return norm ? v / 255 : v; }
    case 5122: { const v = buf.readInt16LE(o); return norm ? Math.max(v / 32767, -1) : v; }
    case 5123: { const v = buf.readUInt16LE(o); return norm ? v / 65535 : v; }
    case 5125: return buf.readUInt32LE(o);
    default: return 0;
  }
}
// An accessor's values as one Float64Array (count * components), sparse
// substitutions applied; null when its data is not there.
function accessor(doc, buffers, ai) {
  const a = Array.isArray(doc.accessors) ? doc.accessors[ai] : null;
  if (!a) return null;
  const nc = NCOMP[a.type], cs = COMP[a.componentType];
  if (!nc || !cs) return null;
  const n = a.count | 0;
  const out = new Float64Array(n * nc);
  if (a.bufferView != null) {
    const bv = doc.bufferViews && doc.bufferViews[a.bufferView];
    const buf = bv && buffers[bv.buffer];
    if (!buf) return null;
    const stride = bv.byteStride || cs * nc;
    const base = (bv.byteOffset || 0) + (a.byteOffset || 0);
    if (n > 0 && base + (n - 1) * stride + cs * nc > buf.length) return null;
    for (let i = 0; i < n; i++) for (let k = 0; k < nc; k++) out[i * nc + k] = readComp(buf, base + i * stride + k * cs, a.componentType, a.normalized);
  }
  const sp = a.sparse;
  if (sp && sp.count > 0 && sp.indices && sp.values) {
    const ib = doc.bufferViews[sp.indices.bufferView], vb = doc.bufferViews[sp.values.bufferView];
    const ibuf = ib && buffers[ib.buffer], vbuf = vb && buffers[vb.buffer];
    if (!ibuf || !vbuf) return null;
    const ics = COMP[sp.indices.componentType];
    for (let j = 0; j < sp.count; j++) {
      const idx = readComp(ibuf, (ib.byteOffset || 0) + (sp.indices.byteOffset || 0) + j * ics, sp.indices.componentType, false);
      if (idx >= n) continue;
      for (let k = 0; k < nc; k++) out[idx * nc + k] = readComp(vbuf, (vb.byteOffset || 0) + (sp.values.byteOffset || 0) + (j * nc + k) * cs, a.componentType, a.normalized);
    }
  }
  return out;
}

// column-major 4x4
const ident = () => { const m = new Float64Array(16); m[0] = m[5] = m[10] = m[15] = 1; return m; };
function mul(a, b) {
  const o = new Float64Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
    o[c * 4 + r] = s;
  }
  return o;
}
function localOf(n) {
  if (Array.isArray(n.matrix) && n.matrix.length === 16) return Float64Array.from(n.matrix);
  const t = Array.isArray(n.translation) ? n.translation : [0, 0, 0];
  const q = Array.isArray(n.rotation) ? n.rotation : [0, 0, 0, 1];
  const s = Array.isArray(n.scale) ? n.scale : [1, 1, 1];
  const [x, y, z, w] = q;
  const m = new Float64Array(16);
  m[0] = (1 - 2 * (y * y + z * z)) * s[0]; m[1] = (2 * (x * y + z * w)) * s[0]; m[2] = (2 * (x * z - y * w)) * s[0];
  m[4] = (2 * (x * y - z * w)) * s[1]; m[5] = (1 - 2 * (x * x + z * z)) * s[1]; m[6] = (2 * (y * z + x * w)) * s[1];
  m[8] = (2 * (x * z + y * w)) * s[2]; m[9] = (2 * (y * z - x * w)) * s[2]; m[10] = (1 - 2 * (x * x + y * y)) * s[2];
  m[12] = t[0]; m[13] = t[1]; m[14] = t[2]; m[15] = 1;
  return m;
}
const det3 = (m) => m[0] * (m[5] * m[10] - m[9] * m[6]) - m[4] * (m[1] * m[10] - m[9] * m[2]) + m[8] * (m[1] * m[6] - m[5] * m[2]);

// The triangles the engine draws, in model space after the node transforms:
// { pos: Float64Array (9 per triangle), cull: Uint8Array (0 both sides, 1 back
// culled with CCW fronts, 2 with CW fronts: a mirrored node, model.go
// reverseCull), count }
function sceneTriangles(doc, buffers) {
  const nodes = Array.isArray(doc.nodes) ? doc.nodes : [];
  const parent = new Int32Array(nodes.length).fill(-1);
  nodes.forEach((n, i) => (Array.isArray(n && n.children) ? n.children : []).forEach((ch) => { if (ch >= 0 && ch < nodes.length) parent[ch] = i; }));
  const world = new Array(nodes.length).fill(null);
  const worldOf = (i, depth = 0) => {
    if (world[i]) return world[i];
    const l = localOf(nodes[i] || {});
    world[i] = parent[i] >= 0 && depth < 256 ? mul(worldOf(parent[i], depth + 1), l) : l;
    return world[i];
  };
  // the nodes each drawn scene draws (model.go drawNode: a node's own
  // layerNumber, else the scene's default; scene 0 for layers -1, 0 and 1
  // with default 0, scene 1 for layer 1 with default 1)
  const drawn = new Set();
  const scenes = Array.isArray(doc.scenes) ? doc.scenes : [];
  [[0, (ln) => ln === -1 || ln === 0 || ln === 1, 0], [1, (ln) => ln === 1, 1]].forEach(([si, ok, def]) => {
    const sc = scenes[si];
    const walk = (i, depth) => {
      if (i < 0 || i >= nodes.length || depth > 256) return;
      const n = nodes[i] || {};
      const ln = n.extras && Number.isInteger(n.extras.layerNumber) ? n.extras.layerNumber : def;
      if (ok(ln) && n.mesh != null) drawn.add(i);
      for (const ch of Array.isArray(n.children) ? n.children : []) walk(ch, depth + 1);
    };
    for (const r of (sc && Array.isArray(sc.nodes)) ? sc.nodes : []) walk(r, 0);
  });
  const mats = Array.isArray(doc.materials) ? doc.materials : [];
  const tris = [], culls = [];
  for (const ni of drawn) {
    const n = nodes[ni];
    const mesh = doc.meshes && doc.meshes[n.mesh];
    if (!mesh) continue;
    const W = worldOf(ni);
    const skin = n.skin != null && doc.skins ? doc.skins[n.skin] : null;
    let jointMats = null;
    if (skin && Array.isArray(skin.joints)) {
      const ibm = skin.inverseBindMatrices != null ? accessor(doc, buffers, skin.inverseBindMatrices) : null;
      jointMats = skin.joints.map((j, k) => mul(worldOf(j), ibm ? ibm.subarray(k * 16, k * 16 + 16) : ident()));
    }
    const mirrored = det3(W) < 0;
    for (const p of Array.isArray(mesh.primitives) ? mesh.primitives : []) {
      if (!p || p.material == null || !p.attributes || p.attributes.POSITION == null) continue;   // model.go: no material, not drawn
      const mode = p.mode == null ? 4 : p.mode;
      if (mode !== 4 && mode !== 5 && mode !== 6) continue;
      const P = accessor(doc, buffers, p.attributes.POSITION);
      if (!P) continue;
      const nv = P.length / 3;
      // the vertices where the engine puts them: a skinned one through its
      // joints (bind pose), any other through its node
      const V = new Float64Array(nv * 3);
      const J = jointMats && p.attributes.JOINTS_0 != null ? accessor(doc, buffers, p.attributes.JOINTS_0) : null;
      const Wt = jointMats && p.attributes.WEIGHTS_0 != null ? accessor(doc, buffers, p.attributes.WEIGHTS_0) : null;
      for (let v = 0; v < nv; v++) {
        const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
        let M = W;
        if (J && Wt) {
          M = new Float64Array(16);
          let ws = 0;
          for (let k = 0; k < 4; k++) {
            const w = Wt[v * 4 + k], jm = jointMats[J[v * 4 + k]];
            if (!w || !jm) continue;
            ws += w;
            for (let e = 0; e < 16; e++) M[e] += w * jm[e];
          }
          if (!ws) M = W;
        }
        V[v * 3] = M[0] * x + M[4] * y + M[8] * z + M[12];
        V[v * 3 + 1] = M[1] * x + M[5] * y + M[9] * z + M[13];
        V[v * 3 + 2] = M[2] * x + M[6] * y + M[10] * z + M[14];
      }
      const I = p.indices != null ? accessor(doc, buffers, p.indices) : null;
      const count = I ? I.length : nv;
      const idx = (k) => (I ? I[k] : k);
      const mat = mats[p.material] || {};
      const cull = mat.doubleSided ? 0 : mirrored ? 2 : 1;
      const push = (a, b, c) => {
        if (a >= nv || b >= nv || c >= nv) return;
        tris.push(V[a * 3], V[a * 3 + 1], V[a * 3 + 2], V[b * 3], V[b * 3 + 1], V[b * 3 + 2], V[c * 3], V[c * 3 + 1], V[c * 3 + 2]);
        culls.push(cull);
      };
      if (mode === 4) for (let k = 0; k + 2 < count; k += 3) push(idx(k), idx(k + 1), idx(k + 2));
      else if (mode === 5) for (let k = 0; k + 2 < count; k++) (k % 2 ? push(idx(k + 1), idx(k), idx(k + 2)) : push(idx(k), idx(k + 1), idx(k + 2)));
      else for (let k = 1; k + 1 < count; k++) push(idx(0), idx(k), idx(k + 1));
    }
  }
  return { pos: Float64Array.from(tris), cull: Uint8Array.from(culls), count: culls.length };
}

// A model file's triangles, kept while the file (and a .gltf's buffer files)
// keep their size and times.
const stampOf = (p) => { try { const s = fs.statSync(p); return s.size + '@' + s.mtimeMs + '@' + s.ctimeMs; } catch (e) { return '-'; } };
const SCENES = new Map();
function modelScene(full) {
  const hit = SCENES.get(full);
  if (hit && hit.stamps.every(([p, s]) => stampOf(p) === s)) return hit.scene;
  const stamps = [[full, stampOf(full)]];
  if (fs.statSync(full).size > MAX_MODEL) throw new Error('its model is larger than ' + (MAX_MODEL >> 20) + ' MB');
  const parsed = tt.parseModel(fs.readFileSync(full), path.basename(full));
  if (parsed.kind === 'gltf') for (const b of tt.bufferFiles(parsed.doc, full)) stamps.push([b, stampOf(b)]);
  const scene = sceneTriangles(parsed.doc, tt.loadBuffers(parsed.doc, parsed, full));
  if (SCENES.size >= 8 && !SCENES.has(full)) SCENES.clear();     // a few models' triangles, not the folder's
  SCENES.set(full, { stamps, scene });
  return scene;
}

// ---------------------------------------------------------------- coverage

// Row r of R (0 = top), as the ndc y of its center.
const rowY = (r, R) => 1 - (2 * r + 1) / R;

// For one zoom z, the screen columns x0s (NDC) and the camera's vertical
// position (0: at rest), per column and row the camera x (stage units) at
// which the model covers that pixel: out[column][row] = a merged [[lo, hi], ...].
// With `hitX`, only whether the model covers each pixel with the camera at
// that x: out[column] = a Uint8Array of rows (no lists to keep and sort).
function columnsCover(scene, c, z, x0s, R, camY = 0, hitX) {
  const { pos, cull, count } = scene;
  const [sx, sy, sz] = c.scale;
  // drawModel's offset and projection at this zoom (model.go)
  const syo = -(c.zoffset - c.Ly / 2) * (1 - z) / z;
  const offY = (camY / z + syo) * c.posMul + c.offset[1];
  const offZ = c.offset[2] / z;
  const zac = c.zoomanchor ? (c.zoffset * c.localscl) - (c.Hg + c.ac - (c.Hg - c.zoffset * c.localscl + c.ac) * z) : 0;
  const ty = zac / c.Hg * 2 + c.syo2 + c.aspCorr;
  // per row: y / depth along that row's rays (ndc_y = sY * (f * y/depth + yshift * z) + ty)
  const q = new Float64Array(R);
  for (let r = 0; r < R; r++) q[r] = ((rowY(r, R) - ty) / c.sY - c.yshift * z) / c.f;
  const K = x0s.length;
  const dxs = x0s.map((x) => x / c.kx);
  const hit = hitX !== undefined;
  const hits = hit ? x0s.map(() => new Uint8Array(R)) : null;
  const flat = hit ? null : Array.from({ length: K }, () => Array.from({ length: R }, () => []));
  const tol = GAP_PX * c.Lx / (1280 * z) / 2;
  const ox = c.offset[0] / z, pm = c.posMul, near = c.near, far = c.far;
  for (let t = 0; t < count; t++) {
    const b = t * 9;
    const ax = sx * pos[b], ay = sy * pos[b + 1] + offY, aD = -(sz * pos[b + 2] + offZ);
    const bx = sx * pos[b + 3], by = sy * pos[b + 4] + offY, bD = -(sz * pos[b + 5] + offZ);
    const cx = sx * pos[b + 6], cy = sy * pos[b + 7] + offY, cD = -(sz * pos[b + 8] + offZ);
    if (aD < near && bD < near && cD < near) continue;
    if (aD > far && bD > far && cD > far) continue;
    // the rows it can cross (q falls from the top row to the bottom one)
    let r0 = 0, r1 = R - 1;
    if (aD > 0 && bD > 0 && cD > 0) {
      const qa = ay / aD, qb = by / bD, qc = cy / cD;
      const qmax = Math.max(qa, qb, qc), qmin = Math.min(qa, qb, qc);
      if (qmax < q[R - 1] || qmin > q[0]) continue;
      let lo = 0, hi = R - 1;
      while (lo < hi) { const m = (lo + hi) >> 1; if (q[m] > qmax) lo = m + 1; else hi = m; }
      r0 = lo; lo = r0; hi = R - 1;
      while (lo < hi) { const m = (lo + hi + 1) >> 1; if (q[m] < qmin) hi = m - 1; else lo = m; }
      r1 = lo;
      if (r1 < r0) continue;
    }
    // the face's normal (eye space; z toward the eye is -depth), for a single-sided material
    const cl = cull[t];
    let nx = 0, ny = 0, nz = 0;
    if (cl) {
      const ux = bx - ax, uy = by - ay, uz = -(bD - aD), vx = cx - ax, vy = cy - ay, vz = -(cD - aD);
      nx = uy * vz - uz * vy; ny = uz * vx - ux * vz; nz = ux * vy - uy * vx;
    }
    for (let r = r0; r <= r1; r++) {
      const qr = q[r];
      // where the triangle meets the row's plane y = q * depth: two edges cross it
      const g0 = ay - qr * aD, g1 = by - qr * bD, g2 = cy - qr * cD;
      const p0 = g0 > 0, p1 = g1 > 0, p2 = g2 > 0;
      if (p0 === p1 && p1 === p2) continue;
      let xa, da, xb, db, s;
      if (p0 !== p1) {
        s = g0 / (g0 - g1); xa = ax + s * (bx - ax); da = aD + s * (bD - aD);
        if (p1 !== p2) { s = g1 / (g1 - g2); xb = bx + s * (cx - bx); db = bD + s * (cD - bD); } else { s = g2 / (g2 - g0); xb = cx + s * (ax - cx); db = cD + s * (aD - cD); }
      } else {
        s = g1 / (g1 - g2); xa = bx + s * (cx - bx); da = bD + s * (cD - bD);
        s = g2 / (g2 - g0); xb = cx + s * (ax - cx); db = cD + s * (aD - cD);
      }
      // clipped to near..far
      let sa = 0, sb = 1;
      if (da < near || db < near) {
        if (da < near && db < near) continue;
        s = (near - da) / (db - da);
        if (da < near) sa = s; else sb = s;
      }
      if (da > far || db > far) {
        if (da > far && db > far) continue;
        s = (far - da) / (db - da);
        if (da > far) sa = Math.max(sa, s); else sb = Math.min(sb, s);
      }
      if (sa > sb) continue;
      const Xa = xa + sa * (xb - xa), Da = da + sa * (db - da), Xb = xa + sb * (xb - xa), Db = da + sb * (db - da);
      for (let k = 0; k < K; k++) {
        const dx = dxs[k];
        // facing the ray (dx, qr, -1): a CCW front faces it when n . d < 0
        if (cl) { const dot = nx * dx + ny * qr - nz; if (cl === 1 ? dot >= 0 : dot <= 0) continue; }
        // the model's x offset that puts the point on the column is dx * depth - x;
        // offset.x = -camX * posMul + [Model] offset.x / zoom gives the camera x
        const ca = (ox - (dx * Da - Xa)) / pm, cb = (ox - (dx * Db - Xb)) / pm;
        if (hit) { if (hitX >= Math.min(ca, cb) - tol && hitX <= Math.max(ca, cb) + tol) hits[k][r] = 1; } else if (ca < cb) flat[k][r].push(ca, cb); else flat[k][r].push(cb, ca);
      }
    }
  }
  if (hit) return hits;
  const gap = GAP_PX * c.Lx / (1280 * z);
  return flat.map((rows) => rows.map((f) => {
    if (!f.length) return [];
    const list = [];
    for (let i = 0; i < f.length; i += 2) list.push([f[i], f[i + 1]]);
    list.sort((a, b) => a[0] - b[0]);
    const m = [list[0]];
    for (let i = 1; i < list.length; i++) {
      const last = m[m.length - 1];
      if (list[i][0] <= last[1] + gap) { if (list[i][1] > last[1]) last[1] = list[i][1]; } else m.push(list[i]);
    }
    return m;
  }));
}
const columnCover = (scene, c, z, x0, R, camY = 0) => columnsCover(scene, c, z, [x0], R, camY)[0];
const covering = (ivs, x) => { for (const iv of ivs) { if (x < iv[0]) return null; if (x <= iv[1]) return iv; } return null; };

// ---------------------------------------------------------------- 2D layers

// THE DEF'S OWN 2D LAYERS CAN HIDE THE VOID. A model stage may paint a sky or
// a backdrop with [BG] elements (MementosUltimate: a 1890x968 picture at
// layer -1, delta 0,0, zoomdelta 0, behind its model). An element counts when
// it covers a screen edge wherever the camera is: fixed to the screen (delta
// x 0, and not scaled by the zoom: zoomdelta 0 or no zoom) and reaching past
// the edge, or tiled without end across x. Its rows (at the camera's rest
// height) then never show void at that edge. Normal and anim elements only
// (an anim counts where every frame covers); a parallax floor, a video, a
// subtracting element or one with its own scale is not counted. A see-through
// sprite is taken as covering.
function bgElements(text) {
  const out = [];
  let cur = null;
  for (const raw of String(text).split(/\r?\n/)) {
    const h = SEC_RE.exec(raw);
    if (h) {
      const name = h[1].trim();
      cur = /^bg\b/i.test(name) && !/^bgctrl/i.test(name) && !/^bgdef/i.test(name)
        ? { type: 'normal', spriteno: null, actionno: null, start: [0, 0], delta: [1, 1], tile: [0, 0], layerno: 0, zoomdelta: [1, 1], trans: '', scaled: false } : null;
      if (cur) out.push(cur);
      continue;
    }
    if (!cur) continue;
    const m = /^\s*([^=;\s]+)\s*=\s*([^;\r\n]*)/.exec(raw);
    if (!m) continue;
    const k = m[1].toLowerCase(), v = m[2].trim(), n = nums(v);
    if (k === 'type') cur.type = v.toLowerCase();
    else if (k === 'spriteno') cur.spriteno = n;
    else if (k === 'actionno') cur.actionno = parseInt(v, 10);
    else if (k === 'start') cur.start = [n[0] || 0, n[1] || 0];
    else if (k === 'delta') cur.delta = [Number.isFinite(n[0]) ? n[0] : 1, Number.isFinite(n[1]) ? n[1] : (Number.isFinite(n[0]) ? n[0] : 1)];
    else if (k === 'tile') cur.tile = [n[0] | 0, n[1] | 0];
    else if (k === 'layerno') cur.layerno = parseInt(v, 10) || 0;
    else if (k === 'zoomdelta') cur.zoomdelta = [Number.isFinite(n[0]) ? n[0] : 1, Number.isFinite(n[1]) ? n[1] : (Number.isFinite(n[0]) ? n[0] : 1)];
    else if (k === 'trans') cur.trans = v.toLowerCase();
    else if ((k === 'scalestart' || k === 'xscale' || k === 'yscale') && n.some((x) => Number.isFinite(x) && x !== 1)) cur.scaled = true;
  }
  return out;
}
// Per side (left, right), the rows a 2D element covers at every camera x.
// sprite(g, i) -> { w, h, axisX, axisY } or null; actions: the def's action table.
function backdropRows(text, c, R, sprite, actions) {
  const cover = { left: new Uint8Array(R), right: new Uint8Array(R) };
  if (!sprite) return cover;
  for (const bg of bgElements(text)) {
    if (bg.layerno < -1 || bg.layerno > 1 || bg.scaled || /sub/.test(bg.trans)) continue;
    if (bg.type !== 'normal' && bg.type !== 'anim') continue;
    const tileX = bg.tile[0] === 1, tileY = bg.tile[1] === 1;
    const fixedX = bg.delta[0] === 0 && (!c.zoomOn || bg.zoomdelta[0] === 0);
    if (!tileX && !fixedX) continue;
    if (!tileY && c.zoomOn && bg.zoomdelta[1] !== 0) continue;    // its rows would move with the zoom
    // the pictures it shows: a normal element's sprite, every frame of an anim
    let frames = [];
    if (bg.type === 'anim') frames = ((actions && actions[bg.actionno]) || []).filter((f) => f[0] >= 0).map((f) => [f[0], f[1], f[2] || 0, f[3] || 0]);
    else if (bg.spriteno && bg.spriteno.length >= 2) frames = [[bg.spriteno[0], bg.spriteno[1], 0, 0]];
    if (!frames.length) continue;
    let left = -Infinity, right = Infinity, top = -Infinity, bottom = Infinity, ok = true;
    for (const [g, i, fx, fy] of frames) {
      const s = sprite(g, i);
      if (!s || !(s.w > 0) || !(s.h > 0)) { ok = false; break; }
      const x = c.Lx / 2 + bg.start[0] + fx - (s.axisX | 0), y = bg.start[1] + fy - (s.axisY | 0);
      left = Math.max(left, x); right = Math.min(right, x + s.w); top = Math.max(top, y); bottom = Math.min(bottom, y + s.h);
    }
    if (!ok) continue;
    // stage y to the screen's ndc at rest: game y = y * localscl - aspect correction
    const nd = (y) => 1 - 2 * (y * c.localscl - c.ac) / c.Hg;
    for (let r = 0; r < R; r++) {
      const yr = rowY(r, R);
      if (!tileY && !(yr <= nd(top) && yr >= nd(bottom))) continue;
      if (tileX || left <= 0) cover.left[r] = 1;
      if (tileX || right >= c.Lx) cover.right[r] = 1;
    }
  }
  return cover;
}

// For one zoom: per side (+1 right, -1 left), per row that sees the model at
// the start and is not hidden by a 2D layer, how far the camera may go before
// the edge leaves the model, as the bound that puts the edge there.
// { left: { rows, limit }, right: { rows, limit } } - limit null when no row counts.
function sideLimits(scene, c, z, R, back) {
  const [covL, covR] = columnsCover(scene, c, z, [-EDGE, EDGE], R);
  const res = {};
  for (const [name, side, cov] of [['left', -1, covL], ['right', 1, covR]]) {
    let rows = 0, limit = null;
    for (let r = 0; r < R; r++) {
      if (back && back[name][r]) continue;
      const iv = covering(cov[r], c.startx);
      if (!iv) continue;
      rows++;
      // the camera x the edge may reach, back to the bound that lets it reach there
      const b = side > 0 ? iv[1] - reach(c, z) : iv[0] + reach(c, z);
      limit = limit === null ? b : side > 0 ? Math.min(limit, b) : Math.max(limit, b);
    }
    res[name] = { rows, limit };
  }
  return res;
}

// How much of the screen's side is black with the camera's edge at its bound:
// the widest run of uncovered pixels from the edge, as a share of the
// screen's width (to `step`, NDC), over the rows of the scene - a row the
// model covers in the screen's middle column with the camera at its start,
// and no 2D layer hides at that edge. Rows the edge already missed at the
// start count too: that black widens as the camera goes out. A run that
// reaches the middle of the screen is reported as half of it. Two passes over
// the triangles: 32 columns out to the middle, then the bracket where the
// last row met the model, at `step`.
function voidShare(scene, c, z, side, bound, R, step, back) {
  const camX = edgeX(c, z, bound, side);
  const name = side > 0 ? 'right' : 'left';
  const coarse = [0, EDGE];
  for (let k = 1; k < 32; k++) coarse.push(EDGE - k * EDGE / 32);
  const mid = columnsCover(scene, c, z, [0], R, 0, c.startx)[0];
  const cov0 = columnsCover(scene, c, z, coarse.map((v) => side * v), R, 0, camX);
  let open = [];
  for (let r = 0; r < R; r++) if (!(back && back[name][r]) && mid[r] && !cov0[1][r]) open.push(r);
  if (!open.length) return 0;
  // the last coarse column before every open row met the model
  let k = 2, before = open;
  for (; k < coarse.length && open.length; k++) { before = open; open = open.filter((r) => !cov0[k][r]); }
  if (open.length) return 0.5;
  const hi = coarse[k - 2], lo = coarse[k - 1];
  const fine = [];
  for (let x = hi - step; x > lo; x -= step) fine.push(x);
  fine.push(lo);
  const cov1 = columnsCover(scene, c, z, fine.map((v) => side * v), R, 0, camX);
  let rest = before, share = (1 - lo) / 2;
  for (let j = 0; j < fine.length && rest.length; j++) {
    share = (1 - fine[j]) / 2;
    rest = rest.filter((r) => !cov1[j][r]);
  }
  return Math.round(share * 1000) / 1000;
}

// ---------------------------------------------------------------- one def

// What the fit does for one def and its model: the bounds it has, the bounds
// that keep the edges inside the model, and the void it shows now (and still
// shows after the fit, where a bound cannot go far enough). opts: rows, step
// (the void's column step, NDC), share: false to skip the void shares,
// sprite(g, i) and actions for the def's 2D layers.
function planDef(text, scene, shape, opts) {
  const o = opts || {};
  const R = o.rows || ROWS;
  const c = cameraOf(text, shape);
  const out = { localcoord: [c.Lx, c.Ly], zoom: c.zoomOn ? [c.zoomout, c.zoomin] : [1, 1], bounds: [c.boundleft, c.boundright], startx: c.startx };
  if (!(c.posMul > 0)) return Object.assign(out, { over: false, fittable: false, reason: 'its [Model] offset puts the model at no depth' });
  const back = backdropRows(text, c, R, o.sprite, o.actions);
  out.backdrop = { left: back.left.reduce((a, v) => a + v, 0), right: back.right.reduce((a, v) => a + v, 0), rows: R };
  const lim = { left: { limit: null, rows: 0, zoom: null }, right: { limit: null, rows: 0, zoom: null } };
  for (const z of zoomsOf(c)) {
    const s = sideLimits(scene, c, z, R, back);
    for (const [name, side] of [['left', -1], ['right', 1]]) {
      const L = lim[name], v = s[name];
      L.rows = Math.max(L.rows, v.rows);
      if (v.limit === null) continue;
      if (L.limit === null || (side > 0 ? v.limit < L.limit : v.limit > L.limit)) { L.limit = v.limit; L.zoom = z; }
    }
  }
  const sides = {};
  for (const [name, side, key] of [['left', -1, 'boundleft'], ['right', 1, 'boundright']]) {
    const L = lim[name];
    const from = c[key];
    const room = L.limit === null ? null : side > 0 ? Math.floor(L.limit) : Math.ceil(L.limit);
    const over = room !== null && (side > 0 ? from > room : from < room);
    let to = from, partial = false;
    if (over) {
      to = room;
      // never past the camera's start: the stage would not scroll that way at all
      if (side > 0 ? to < c.startx : to > c.startx) { to = c.startx; partial = true; }
      if (!c.has[key]) { to = from; partial = true; }
    }
    const e = sides[name] = { from, to, room, over, partial, zoom: L.zoom, rows: L.rows, keyed: c.has[key] };
    if (over && o.share !== false) {
      // the most of the screen it shows black, at either end of the zoom and where the limit was found
      const zs = [...new Set([c.zoomOn ? c.zoomout : 1, c.zoomOn ? c.zoomin : 1, L.zoom])];
      const most = (b) => Math.max(...zs.map((z) => voidShare(scene, c, z, side, b, R, o.step || 1 / 512, back)));
      e.void = most(from);
      e.voidAfter = to === from ? e.void : most(to);
    }
  }
  out.sides = sides;
  out.over = sides.left.over || sides.right.over;
  out.fittable = (sides.left.over && sides.left.to !== sides.left.from) || (sides.right.over && sides.right.to !== sides.right.from);
  return out;
}

// ---------------------------------------------------------------- the edit

// The first [Camera] as [header, end) segment indexes, its bound keys and the
// marker line if a fit wrote one.
const KEY_RE = (key) => new RegExp('^(\\s*' + key + '\\s*=\\s*)([^;\\r\\n]*?)(\\s*(?:;.*)?)$', 'i');
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
  const out = { info, keys: {}, marker: null };
  if (!info) return out;
  for (let i = info.start; i < info.end; i++) {
    const l = bare(ls[i]);
    if (out.marker === null && l.trim().startsWith(MARK)) { out.marker = i; continue; }
    for (const key of ['boundleft', 'boundright']) {
      if (out.keys[key]) continue;
      const m = KEY_RE(key).exec(l);
      if (m) out.keys[key] = { i, value: m[2], m };
    }
  }
  return out;
}
function parseMarker(line) {
  const body = line.slice(line.indexOf(MARK) + MARK.length);
  const was = {};
  for (const key of ['boundleft', 'boundright']) {
    const m = new RegExp(key + ' was ("(?:[^"\\\\]|\\\\.)*")').exec(body);
    was[key] = m ? JSON.parse(m[1]) : undefined;
  }
  const set = /\|\s*set (-?\d+),(-?\d+)/.exec(body);
  return { was, set: set ? { boundleft: set[1], boundright: set[2] } : null };
}
const fittedText = (text) => scanCamera(segs(text)).marker !== null;

// The def's text with the bounds set (only the keys whose value changes).
function applyText(text, to) {
  const ls = segs(text);
  const s = scanCamera(ls);
  if (s.marker !== null) throw new Error('already fitted');
  if (!s.info) throw new Error('its def has no [Camera]');
  const first = Math.min(...['boundleft', 'boundright'].filter((k) => s.keys[k]).map((k) => s.keys[k].i));
  if (!Number.isFinite(first)) throw new Error('its [Camera] sets no bounds');
  for (const key of ['boundleft', 'boundright']) {
    const k = s.keys[key];
    if (!k || to[key] === undefined || String(to[key]) === k.value.trim()) continue;
    const end = ls[k.i].slice(bare(ls[k.i]).length);
    ls[k.i] = k.m[1] + String(to[key]) + k.m[3] + end;
  }
  const eol = eolOf(ls[first]) || fileEol(text);
  const was = (key) => (s.keys[key] ? JSON.stringify(s.keys[key].value) : 'absent');
  const setL = s.keys.boundleft ? (to.boundleft !== undefined ? to.boundleft : s.keys.boundleft.value.trim()) : 0;
  const setR = s.keys.boundright ? (to.boundright !== undefined ? to.boundright : s.keys.boundright.value.trim()) : 0;
  ls.splice(first, 0, MARK + ' boundleft was ' + was('boundleft') + ' | boundright was ' + was('boundright') + ' | set ' + setL + ',' + setR + eol);
  return ls.join('');
}

// The def's text as it was before the fit. Throws when a bound was changed since.
function undoText(text) {
  const ls = segs(text);
  const s = scanCamera(ls);
  if (s.marker === null) throw new Error('not fitted');
  const mk = parseMarker(bare(ls[s.marker]));
  if (!mk.set || mk.was.boundleft === undefined || mk.was.boundright === undefined) throw new Error('the fit marker is unreadable, so the def was left as it is');
  // every bound must still be the fit's (or already back to what it was)
  const plan = [];
  for (const key of ['boundleft', 'boundright']) {
    const k = s.keys[key];
    if (!k) { if (mk.was[key] !== null) throw new Error(key + ' is gone since the fit; the def was left as it is'); continue; }
    const now = k.value.trim();
    if (now === String(mk.set[key]).trim()) plan.push([k, mk.was[key]]);
    else if (mk.was[key] === null || now !== String(mk.was[key]).trim()) {
      throw new Error(key + ' is ' + now + ' now, not the ' + mk.set[key] + ' the fit set (Widescreen fit, or an edit, changed it since): undo that first');
    }
  }
  for (const [k, was] of plan) {
    const end = ls[k.i].slice(bare(ls[k.i]).length);
    ls[k.i] = k.m[1] + was + k.m[3] + end;
  }
  ls.splice(s.marker, 1);
  return ls.join('');
}

// ---------------------------------------------------------------- a stage

// The stage's defs (its own and its round variants') with their models.
function defsOf(stagesDir, defFile) {
  return tt.stageDefs(stagesDir, defFile);
}

// The def's 2D layers for backdropRows: its action table, and its sprite
// file's sizes, read only when an element asks for one.
function layersOf(stagesDir, defFile, text) {
  if (!/^\s*\[\s*bg\b(?!ctrl|def)/im.test(text)) return {};
  const st = require('./stagethumb.js');
  let sff;
  const sprite = (g, i) => {
    if (sff === undefined) {
      sff = null;
      try {
        const p = st.sffPathFor(stagesDir, defFile);
        const core = require('./public/ikemen/sffdec-core.js');
        if (p) sff = core.readSff(new Uint8Array(fs.readFileSync(p)));
      } catch (e) { sff = null; }
    }
    if (!sff) return null;
    try { return require('./public/ikemen/sffdec-core.js').spriteGeom(sff, g, i) || null; } catch (e) { return null; }
  };
  let actions = {};
  try { actions = st.parseStageDef(text).actions; } catch (e) { actions = {}; }
  return { sprite, actions };
}

// THE STATUS IS KEPT per stage while its defs and models keep their size and
// times and the build keeps its shape: the Stages tab asks for every stage on
// every draw, and a model is thousands of triangles to walk. Stored as JSON,
// so no caller can change the kept copy; bounded like widefit's.
const STATUS = new Map();
const STATUS_MAX = 4096;
const shapeKey = (sh) => [sh.window, sh.fight, sh.zoom].join(',');

// What the card shows. null for a stage none of whose defs names a model.
//   { defs: [{ def, model, fitted, over, fittable, sides, error }], over, fittable, fitted }
function status(stagesDir, defFile, settings, opts) {
  const sh = shapeOf(settings);
  const full = path.resolve(stagesDir, defFile);
  const defs0 = defsOf(stagesDir, defFile);
  const stamp = defs0.map((d) => stampOf(d.full) + '|' + (d.modelFull ? stampOf(d.modelFull) : '-')).join(';') + '|' + shapeKey(sh);
  const hit = STATUS.get(full);
  if (hit && hit.stamp === stamp && !opts) return JSON.parse(hit.json);
  let res = null;
  const withModel = defs0.filter((d) => d.modelFull);
  if (withModel.length) {
    const defs = defs0.map((d) => {
      const text = fs.readFileSync(d.full, 'latin1');
      const e = { def: d.def, model: d.model, fitted: fittedText(text) };
      if (!d.modelFull) return Object.assign(e, { over: false, fittable: false, reason: 'names no model' });
      try { Object.assign(e, planDef(text, modelScene(d.modelFull), sh, Object.assign({}, opts, layersOf(stagesDir, d.def, text)))); } catch (err) { Object.assign(e, { over: false, fittable: false, error: String((err && err.message) || err) }); }
      return e;
    });
    res = {
      defs,
      over: defs.some((d) => d.over && !d.fitted),
      fittable: defs.some((d) => d.fittable && !d.fitted),
      fitted: defs.some((d) => d.fitted),
      // the worst void share among the defs, for the card's words
      void: Math.max(0, ...defs.flatMap((d) => (d.sides ? [d.sides.left.void || 0, d.sides.right.void || 0] : []))),
      // what a fit leaves: rows the model misses at the edge even at the camera's start widen as it goes out
      voidAfter: Math.max(0, ...defs.flatMap((d) => (d.sides && d.over && !d.fitted ? [d.sides.left.voidAfter || 0, d.sides.right.voidAfter || 0] : []))),
      shape: { fight: sh.fight === 'stage' ? 'stage' : Math.round(sh.fight * 1000) / 1000, window: Math.round(sh.window * 1000) / 1000 },
    };
  }
  if (!opts) {
    if (STATUS.size >= STATUS_MAX && !STATUS.has(full)) STATUS.clear();
    STATUS.set(full, { stamp, json: JSON.stringify(res) });
  }
  return res;
}

// Fit every def of the stage whose camera runs past its model. Each def is
// read back after the write; one that does not read back as planned puts
// every def of the call back.
function fit(stagesDir, defFile, settings) {
  const st = status(stagesDir, defFile, settings);
  if (!st) throw new Error('this stage names no 3D model');
  const work = st.defs.filter((d) => d.fittable && !d.fitted);
  if (!work.length) throw new Error(st.fitted ? 'already fitted' : 'its camera stays inside its model');
  const done = [];
  try {
    for (const d of work) {
      const p = path.resolve(stagesDir, d.def);
      const before = fs.readFileSync(p, 'latin1');
      const to = {};
      if (d.sides.left.over && d.sides.left.to !== d.sides.left.from) to.boundleft = d.sides.left.to;
      if (d.sides.right.over && d.sides.right.to !== d.sides.right.from) to.boundright = d.sides.right.to;
      const after = applyText(before, to);
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
  return {
    defs: work.map((d) => ({ def: d.def, model: d.model, bounds: { from: [d.sides.left.from, d.sides.right.from], to: [d.sides.left.to, d.sides.right.to] },
      partial: d.sides.left.partial || d.sides.right.partial })),
  };
}

// Undo every fitted def of the stage. All are checked before any is written.
function undo(stagesDir, defFile) {
  const defs = defsOf(stagesDir, defFile);
  const work = [];
  for (const d of defs) {
    const before = fs.readFileSync(d.full, 'latin1');
    if (!fittedText(before)) continue;
    work.push({ d, before, after: undoText(before) });
  }
  if (!work.length) throw new Error('not fitted');
  for (const w of work) fs.writeFileSync(w.d.full, w.after, 'latin1');
  STATUS.delete(path.resolve(stagesDir, defFile));
  return { defs: work.map((w) => ({ def: w.d.def })) };
}

module.exports = {
  MARK, readDef, shapeOf, cameraOf, zoomsOf, reach, edgeX, sceneTriangles, modelScene, columnsCover, columnCover, bgElements, backdropRows, sideLimits, voidShare,
  planDef, layersOf, applyText, undoText, status, fit, undo, STATUS, SCENES,
};
