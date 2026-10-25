'use strict';
//
// textransform.js - "Made for Ikemen before 2025: ignore texture transforms"
// for a 3D-model stage: the KHR_texture_transform entries taken out of the
// stage's model files, so 1.0 draws its textures the way the engine its author
// used did.
//
// WHY. Ikemen applies a material's KHR_texture_transform since 2025-01-12
// (upstream 931a6f4, "Implement KHR_texture_transform"; model.go reads offset,
// rotation and scale on the five core textures and calculateTextureTransform
// builds T * R^T * S); before that it ignored the extension. A model exported
// with transforms that engine never applied draws differently under 1.0, on
// desktop and on the web alike. cvs2london (uploaded 2024-09-15, Blender I/O
// 3.6) carries a 90-degree rotation and a (1,-1) scale on every one of its
// 2,301 materials: the UVs land in [-1,0], its samplers clamp on S, and the
// edge texels smear across every surface. Without the transforms it draws
// exactly as its author showed it.
//
// WHAT IT DOES. The stage's models are the [BGDef] `model =` of its def and of
// each round variant's def (round1def = ..., modlib.roundDefNames), resolved
// where the engine looks (the def's folder, then the game folder - stages/x
// from the bundle's root), never outside the stages folder. A model shared by
// the main def and a round variant is one file and is rewritten once. Each
// model that carries a transform is backed up beside itself (BAK) and
// rewritten with the extension removed from every texture reference in its
// materials and from extensionsUsed / extensionsRequired; nothing else in it
// changes. A .glb gets its JSON chunk re-padded and its length fixed, every
// other chunk byte for byte; a .gltf is its JSON file only - the buffers and
// images it names are never written. Every rewrite is read back (it parses,
// no transform is left, the rest of the JSON and every binary chunk are what
// they were); one that does not verify puts every model of the call back.
// Undo copies each backup over its model, byte for byte, and removes it.
//
// WHEN IT IS OFFERED. Only for a stage whose models carry the extension (none
// of the other 24 model stages on the development machine do: the 20 CVS-P
// stages, the engine's two demo stages, two others). The note says the
// textures WILL smear when the transform is predicted to smear them: on a
// large share of the textured primitives (SMEAR_SHARE) the transformed UVs of
// TEXCOORD_0 (the only set the engine reads) leave [0,1] on an axis whose
// sampler clamps (CLAMP_TO_EDGE), while the untransformed UVs stay inside it
// - the transform, not the model, is what pushes them out. A transform with
// no predicted smear may well be intended (a model made for 1.0), so that
// stage gets a quiet line and the same button, no warning: only the game says
// whether its textures look wrong.
const fs = require('fs');
const path = require('path');

const EXT = 'KHR_texture_transform';
// ends in .orig: every export's backup filter (vfslib BACKUP_FILE) drops it,
// and removing the stage removes it with the model's other same-name files
const BAK = '.textransform.orig';
const GLB_MAGIC = 0x46546c67;   // 'glTF'
const CHUNK_JSON = 0x4e4f534a;  // 'JSON'
const CHUNK_BIN = 0x004e4942;   // 'BIN\0'
const CLAMP = 33071, REPEAT = 10497;
// the share of textured primitives the transform must push off a clamped edge
// before the card says the textures will smear (cvs2london: see the DEVLOG)
const SMEAR_SHARE = 0.25;
const EPS = 1e-3;
// the five textures the engine reads a transform from (model.go)
const CORE_SLOTS = [['pbrMetallicRoughness', 'baseColorTexture'], ['pbrMetallicRoughness', 'metallicRoughnessTexture'],
  [null, 'normalTexture'], [null, 'occlusionTexture'], [null, 'emissiveTexture']];
const MAX_MODEL = 512 * 1024 * 1024;

// ---------------------------------------------------------------- the file

// -> { kind: 'glb', doc, chunks: [{ type, data }] } | { kind: 'gltf', doc, text }
function parseModel(buf, name) {
  if (buf.length >= 12 && buf.readUInt32LE(0) === GLB_MAGIC) {
    const ver = buf.readUInt32LE(4), len = buf.readUInt32LE(8);
    if (ver !== 2) throw new Error(name + ' is glTF binary version ' + ver + ', not 2');
    if (len !== buf.length) throw new Error(name + ' says it is ' + len + ' bytes long but is ' + buf.length);
    const chunks = [];
    for (let off = 12; off < len;) {
      if (off + 8 > len) throw new Error(name + ' ends inside a chunk header');
      const clen = buf.readUInt32LE(off), type = buf.readUInt32LE(off + 4);
      if (off + 8 + clen > len) throw new Error(name + ' has a chunk past its end');
      chunks.push({ type, data: buf.subarray(off + 8, off + 8 + clen) });
      off += 8 + clen;
    }
    if (!chunks.length || chunks[0].type !== CHUNK_JSON) throw new Error(name + ' does not start with its JSON chunk');
    // padded with spaces (the spec); a NUL pad is tolerated on reading
    const text = chunks[0].data.toString('utf8').replace(/^﻿/, '').replace(/[\s\0]+$/, '');
    return { kind: 'glb', doc: JSON.parse(text), chunks };
  }
  const text = buf.toString('utf8');
  return { kind: 'gltf', doc: JSON.parse(text.replace(/^﻿/, '')), text };
}

// Every texture reference in the materials that carries the extension:
// [{ material, slot (JSON pointer under the material), t: the transform }].
// All of them, not only the five the engine reads: an older engine ignored
// the extension everywhere, and so does the stripped model.
function transformRefs(doc) {
  const out = [];
  const walk = (o, at, mi) => {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o)) { o.forEach((v, i) => walk(v, at + '/' + i, mi)); return; }
    if (o.extensions && typeof o.extensions === 'object' && !Array.isArray(o.extensions)
        && Object.prototype.hasOwnProperty.call(o.extensions, EXT)) out.push({ material: mi, slot: at, t: o.extensions[EXT] });
    for (const [k, v] of Object.entries(o)) walk(v, at + '/' + k, mi);
  };
  (Array.isArray(doc.materials) ? doc.materials : []).forEach((m, i) => walk(m, '', i));
  return out;
}

// A copy of the document without the extension: off every texture reference
// in the materials (an `extensions` left empty goes too) and out of
// extensionsUsed / extensionsRequired (a list left empty goes too).
function stripDoc(doc) {
  const d = JSON.parse(JSON.stringify(doc));
  const walk = (o) => {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o)) { o.forEach(walk); return; }
    if (o.extensions && typeof o.extensions === 'object' && !Array.isArray(o.extensions)
        && Object.prototype.hasOwnProperty.call(o.extensions, EXT)) {
      delete o.extensions[EXT];
      if (!Object.keys(o.extensions).length) delete o.extensions;
    }
    for (const v of Object.values(o)) walk(v);
  };
  if (Array.isArray(d.materials)) d.materials.forEach(walk);
  for (const key of ['extensionsUsed', 'extensionsRequired']) {
    if (!Array.isArray(d[key])) continue;
    d[key] = d[key].filter((e) => e !== EXT);
    if (!d[key].length) delete d[key];
  }
  return d;
}

// The rewritten file. A .glb: the new JSON chunk padded with spaces to four
// bytes, every other chunk as it was, the header's length fixed. A .gltf: its
// JSON in the file's own indentation and line ends, its BOM kept.
function encodeModel(parsed, doc) {
  if (parsed.kind === 'glb') {
    let js = Buffer.from(JSON.stringify(doc), 'utf8');
    if (js.length % 4) js = Buffer.concat([js, Buffer.alloc(4 - (js.length % 4), 0x20)]);
    const parts = [];
    let total = 12;
    parsed.chunks.forEach((c, i) => {
      const data = i === 0 ? js : c.data;
      const h = Buffer.alloc(8);
      h.writeUInt32LE(data.length, 0); h.writeUInt32LE(c.type, 4);
      parts.push(h, data); total += 8 + data.length;
    });
    const head = Buffer.alloc(12);
    head.writeUInt32LE(GLB_MAGIC, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(total, 8);
    return Buffer.concat([head, ...parts]);
  }
  const t = parsed.text;
  const bom = t.startsWith('﻿') ? '﻿' : '';
  const eol = t.includes('\r\n') ? '\r\n' : '\n';
  const ind = /\n([ \t]+)\S/.exec(t);
  let out = JSON.stringify(doc, null, /\n/.test(t) ? (ind ? ind[1] : 2) : undefined);
  if (eol === '\r\n') out = out.replace(/\n/g, '\r\n');
  if (/\r?\n$/.test(t)) out += eol;
  return Buffer.from(bom + out, 'utf8');
}

// ---------------------------------------------------------------- the smear

// The accessor's values as [x, y] pairs (normalized integers scaled to 0..1),
// at most `cap` of them, evenly spaced; null when it cannot be read here (a
// sparse accessor, a buffer that is not there).
function readUv(doc, buffers, ai, cap) {
  const acc = Array.isArray(doc.accessors) ? doc.accessors[ai] : null;
  if (!acc || acc.type !== 'VEC2' || acc.sparse || acc.bufferView == null) return null;
  const bv = doc.bufferViews && doc.bufferViews[acc.bufferView];
  const buf = bv && buffers[bv.buffer];
  if (!buf) return null;
  const size = { 5126: 4, 5121: 1, 5123: 2 }[acc.componentType];
  if (!size) return null;
  const stride = bv.byteStride || size * 2;
  const base = (bv.byteOffset || 0) + (acc.byteOffset || 0);
  const n = acc.count | 0;
  if (n <= 0 || base + (n - 1) * stride + size * 2 > buf.length) return null;
  const step = Math.max(1, Math.floor(n / cap));
  const rd = acc.componentType === 5126 ? (o) => buf.readFloatLE(o)
    : acc.componentType === 5121 ? (o) => buf.readUInt8(o) / 255 : (o) => buf.readUInt16LE(o) / 65535;
  const out = [];
  for (let i = 0; i < n; i += step) { const o = base + i * stride; out.push([rd(o), rd(o + size)]); }
  return out;
}

// [u', v'] = T * R^T * S * [u, v], as calculateTextureTransform builds it
function applyTransform(t, uv) {
  const off = Array.isArray(t.offset) ? t.offset : [0, 0];
  const r = typeof t.rotation === 'number' ? t.rotation : 0;
  const sc = Array.isArray(t.scale) ? t.scale : [1, 1];
  const c = Math.cos(r), s = Math.sin(r);
  const x = uv[0] * sc[0], y = uv[1] * sc[1];
  return [c * x + s * y + (+off[0] || 0), -s * x + c * y + (+off[1] || 0)];
}

const outside = (v) => v < -EPS || v > 1 + EPS;

// { textured, smeared }: primitives with a core texture, and those on which a
// transformed texture's clamped axis sends most UVs outside [0,1] while the
// untransformed UVs mostly stay in. null when nothing could be read.
function predictSmear(doc, buffers) {
  const mats = Array.isArray(doc.materials) ? doc.materials : [];
  const texs = Array.isArray(doc.textures) ? doc.textures : [];
  const samplers = Array.isArray(doc.samplers) ? doc.samplers : [];
  let textured = 0, smeared = 0, read = 0;
  for (const mesh of Array.isArray(doc.meshes) ? doc.meshes : []) {
    for (const p of (mesh && Array.isArray(mesh.primitives)) ? mesh.primitives : []) {
      const m = p && p.material != null ? mats[p.material] : null;
      if (!m) continue;
      const slots = CORE_SLOTS.map(([a, b]) => (a ? (m[a] || {})[b] : m[b])).filter((ti) => ti && ti.index != null);
      if (!slots.length) continue;
      textured++;
      const tx = slots.filter((ti) => ti.extensions && ti.extensions[EXT]);
      if (!tx.length || !p.attributes || p.attributes.TEXCOORD_0 == null) continue;
      const uv = readUv(doc, buffers, p.attributes.TEXCOORD_0, 2048);
      if (!uv || !uv.length) continue;
      read++;
      let hit = false;
      for (const ti of tx) {
        const tex = texs[ti.index];
        const smp = tex && tex.sampler != null ? samplers[tex.sampler] || {} : {};
        const clampS = (smp.wrapS || REPEAT) === CLAMP, clampT = (smp.wrapT || REPEAT) === CLAMP;
        if (!clampS && !clampT) continue;
        let rawOut = 0, tOut = 0;
        for (const q of uv) {
          const w = applyTransform(ti.extensions[EXT], q);
          if ((clampS && outside(q[0])) || (clampT && outside(q[1]))) rawOut++;
          if ((clampS && outside(w[0])) || (clampT && outside(w[1]))) tOut++;
        }
        if (tOut > uv.length / 2 && rawOut <= uv.length / 2) { hit = true; break; }
      }
      if (hit) smeared++;
    }
  }
  return read ? { textured, smeared } : null;
}

// The buffers a document's accessors point into: a .glb's BIN chunk for a
// buffer without a uri, a data: uri decoded, a file beside a .gltf (read, never
// written; never outside its folder). A missing one is null.
function loadBuffers(doc, parsed, modelPath) {
  const dir = path.dirname(modelPath);
  const bin = parsed.kind === 'glb' ? (parsed.chunks.find((c, i) => i > 0 && c.type === CHUNK_BIN) || {}).data : null;
  return (Array.isArray(doc.buffers) ? doc.buffers : []).map((b, i) => {
    const uri = b && typeof b.uri === 'string' ? b.uri : '';
    if (!uri) return i === 0 && bin ? bin : null;
    const m = /^data:[^,]*;base64,(.*)$/is.exec(uri);
    if (m) { try { return Buffer.from(m[1], 'base64'); } catch (e) { return null; } }
    if (/^[a-z][\w+.-]*:/i.test(uri)) return null;
    let rel; try { rel = decodeURIComponent(uri); } catch (e) { rel = uri; }
    const full = path.resolve(dir, rel.replace(/\\/g, '/'));
    const r = path.relative(dir, full);
    if (!r || r.startsWith('..') || path.isAbsolute(r)) return null;
    try { return fs.readFileSync(full); } catch (e) { return null; }
  });
}
// the files a .gltf's buffers name (for the status stamp)
function bufferFiles(doc, modelPath) {
  const dir = path.dirname(modelPath);
  return (Array.isArray(doc.buffers) ? doc.buffers : []).map((b) => (b && typeof b.uri === 'string' ? b.uri : ''))
    .filter((u) => u && !/^[a-z][\w+.-]*:/i.test(u)).map((u) => { try { return path.resolve(dir, decodeURIComponent(u)); } catch (e) { return path.resolve(dir, u); } });
}

// ---------------------------------------------------------------- one model

const stampOf = (p) => { try { const s = fs.statSync(p); return s.size + '@' + s.mtimeMs + '@' + s.ctimeMs; } catch (e) { return '-'; } };

// THE ANSWER IS KEPT per model file while it (and a .gltf's buffer files)
// keep their size and times: the Stages tab asks for every stage on every
// draw, and a model is megabytes of JSON. Stored as JSON, so no caller can
// change the kept copy; bounded like widefit's.
const MODEL_CACHE = new Map();
const MODEL_CACHE_MAX = 512;
function inspectModel(full) {
  const hit = MODEL_CACHE.get(full);
  if (hit && hit.stamps.every(([p, s]) => stampOf(p) === s)) return JSON.parse(hit.json);
  const stamps = [[full, stampOf(full)]];
  let info;
  try {
    const size = fs.statSync(full).size;
    if (size > MAX_MODEL) throw new Error('larger than ' + (MAX_MODEL >> 20) + ' MB');
    const parsed = parseModel(fs.readFileSync(full), path.basename(full));
    const refs = transformRefs(parsed.doc);
    if (parsed.kind === 'gltf') for (const b of bufferFiles(parsed.doc, full)) stamps.push([b, stampOf(b)]);
    const smear = refs.length ? predictSmear(parsed.doc, loadBuffers(parsed.doc, parsed, full)) : null;
    info = { kind: parsed.kind, transforms: refs.length, smear };
  } catch (e) {
    info = { transforms: 0, smear: null, error: String((e && e.message) || e) };
  }
  if (MODEL_CACHE.size >= MODEL_CACHE_MAX && !MODEL_CACHE.has(full)) MODEL_CACHE.clear();
  MODEL_CACHE.set(full, { stamps, json: JSON.stringify(info) });
  return info;
}

// ---------------------------------------------------------------- a stage's models

// The [BGDef] `model =` of a def's text, as written; '' when it names none.
function defModel(text) {
  let inDef = false;
  for (const raw of String(text).split(/\r?\n/)) {
    const h = /^\s*\[([^\]]*)\]/.exec(raw);
    if (h) { inDef = /^bgdef$/i.test(h[1].trim()); continue; }
    if (!inDef) continue;
    const m = /^\s*model\s*=\s*([^;\r\n]*?)\s*(;.*)?$/i.exec(raw);
    if (m) return m[1].replace(/"/g, '').replace(/\\/g, '/').trim();
  }
  return '';
}

// Where the engine finds it (stage.go: LoadFile(model, [def, "", "data/"])):
// beside the def, else from the game folder - which for a bundle's stage is
// stages/<rest>. Then the Studio's own rule (stageKeepFilter): the bare name
// beside the def. Only a .glb or .gltf inside the stages folder.
function resolveModel(stagesDir, defFull, value) {
  if (!value || !/\.(glb|gltf)$/i.test(value)) return null;
  const root = path.resolve(stagesDir);
  const inside = (p) => { const r = path.relative(root, p); return !!r && !r.startsWith('..') && !path.isAbsolute(r); };
  const defDir = path.dirname(defFull);
  const cands = [path.resolve(defDir, value)];
  if (/^stages\//i.test(value)) cands.push(path.resolve(root, value.slice(7)));
  cands.push(path.resolve(defDir, value.split('/').pop()));
  for (const c of cands) if (inside(c) && fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  return null;
}

// What a def names - its model and its round variants - kept per def while
// the file keeps its size and times: every 2D stage of the roster is read on
// every draw of the Stages tab, to learn that it names no model.
const DEF_CACHE = new Map();
function defInfo(full) {
  const stamp = stampOf(full);
  if (stamp === '-') return null;
  const hit = DEF_CACHE.get(full);
  if (hit && hit.stamp === stamp) return hit.info;
  let text;
  try { text = fs.readFileSync(full, 'latin1'); } catch (e) { return null; }
  const info = { model: defModel(text), rounds: require('./modlib').roundDefNames(text) };
  if (DEF_CACHE.size >= 4096 && !DEF_CACHE.has(full)) DEF_CACHE.clear();
  DEF_CACHE.set(full, { stamp, info });
  return info;
}

// The stage's def and its round variants' defs, each with the model it names:
// [{ def, full, model (its path under the stages folder), modelFull }]
function stageDefs(stagesDir, defFile) {
  const root = path.resolve(stagesDir);
  const mainFull = path.resolve(root, defFile);
  const main = defInfo(mainFull);
  if (!main) throw new Error('no such stage');
  const defs = [[defFile, mainFull, main]];
  for (const n of main.rounds) {
    const full = path.resolve(path.dirname(mainFull), n);
    const r = path.relative(root, full);
    if (!r || r.startsWith('..') || path.isAbsolute(r)) continue;
    if (defs.some((d) => d[1].toLowerCase() === full.toLowerCase())) continue;
    const info = defInfo(full);
    if (info) defs.push([r.replace(/\\/g, '/'), full, info]);
  }
  return defs.map(([def, full, info]) => {
    const mf = resolveModel(root, full, info.model);
    return { def, full, modelFull: mf, model: mf ? path.relative(root, mf).replace(/\\/g, '/') : null };
  });
}

// The stage's model files, one entry per FILE (a model the main def and a
// round variant share is one entry naming both defs).
function stageModels(stagesDir, defFile) {
  const byFile = new Map();
  for (const d of stageDefs(stagesDir, defFile)) {
    if (!d.modelFull) continue;
    const key = d.modelFull.toLowerCase();
    if (!byFile.has(key)) byFile.set(key, { file: d.model, full: d.modelFull, defs: [] });
    byFile.get(key).defs.push(d.def);
  }
  return [...byFile.values()];
}

// What the card shows. null for a stage that names no model (a 2D stage).
//   { models: [{ file, defs, kind, transforms, backup, smear, error }],
//     transforms (all models), smear: predicted, share, stripped: a backup is there }
function status(stagesDir, defFile) {
  const models = stageModels(stagesDir, defFile);
  if (!models.length) return null;
  let transforms = 0, textured = 0, smeared = 0, stripped = false;
  const list = models.map((m) => {
    const info = inspectModel(m.full);
    const backup = fs.existsSync(m.full + BAK);
    transforms += info.transforms;
    if (info.smear) { textured += info.smear.textured; smeared += info.smear.smeared; }
    if (backup) stripped = true;
    return Object.assign({ file: m.file, defs: m.defs, backup }, info);
  });
  const share = textured ? Math.round((smeared / textured) * 1000) / 1000 : 0;
  return { models: list, transforms, share, smear: transforms > 0 && share >= SMEAR_SHARE, stripped };
}

// ---------------------------------------------------------------- the repair

// The stripped bytes of one model, checked before anything is written.
function strippedBytes(buf, name) {
  const parsed = parseModel(buf, name);
  const n = transformRefs(parsed.doc).length;
  const want = stripDoc(parsed.doc);
  return { n, parsed, want, bytes: n ? encodeModel(parsed, want) : null };
}

// Read back what was written: it parses, carries no transform, its JSON is the
// stripped document and every binary chunk is the one it had.
function verifyStripped(after, before, name) {
  const a = parseModel(after, name);
  if (transformRefs(a.doc).length) throw new Error(name + ' still has a texture transform');
  for (const key of ['extensionsUsed', 'extensionsRequired']) {
    if (Array.isArray(a.doc[key]) && a.doc[key].includes(EXT)) throw new Error(name + ' still lists the extension in ' + key);
  }
  if (JSON.stringify(a.doc) !== JSON.stringify(before.want)) throw new Error(name + ' did not read back as the stripped model');
  if (a.kind === 'glb') {
    const b = before.parsed.chunks;
    if (a.chunks.length !== b.length) throw new Error(name + ' lost or gained a chunk');
    for (let i = 1; i < b.length; i++) {
      if (a.chunks[i].type !== b[i].type || Buffer.compare(a.chunks[i].data, b[i].data) !== 0) throw new Error(name + ': chunk ' + i + ' changed');
    }
  }
}

function strip(stagesDir, defFile) {
  const models = stageModels(stagesDir, defFile).map((m) => Object.assign(m, { buf: fs.readFileSync(m.full) }));
  const work = [];
  for (const m of models) {
    const s = strippedBytes(m.buf, path.basename(m.full));
    if (s.n) work.push(Object.assign(m, s));
  }
  if (!work.length) throw new Error('this stage’s models carry no texture transforms');
  const done = [];
  try {
    for (const m of work) {
      const bak = m.full + BAK;
      const madeBak = !fs.existsSync(bak);
      if (madeBak) fs.copyFileSync(m.full, bak);
      done.push({ m, madeBak });
      fs.writeFileSync(m.full, m.bytes);
      MODEL_CACHE.delete(m.full);
      verifyStripped(fs.readFileSync(m.full), m, path.basename(m.full));
    }
  } catch (e) {
    // every model this call wrote goes back to the bytes it had
    for (const { m, madeBak } of done.reverse()) {
      try { fs.writeFileSync(m.full, m.buf); if (madeBak) fs.unlinkSync(m.full + BAK); } catch (err) { /* reported below */ }
      MODEL_CACHE.delete(m.full);
    }
    throw new Error('the edit did not go through, so the stage was put back: ' + e.message);
  }
  return { models: work.map((m) => ({ file: m.file, defs: m.defs, transforms: m.n })), transforms: work.reduce((a, m) => a + m.n, 0) };
}

function undo(stagesDir, defFile) {
  const models = stageModels(stagesDir, defFile).filter((m) => fs.existsSync(m.full + BAK));
  if (!models.length) throw new Error('no backup to go back to');
  const out = [];
  for (const m of models) {
    const bak = m.full + BAK;
    const orig = fs.readFileSync(bak);
    fs.writeFileSync(m.full, orig);
    MODEL_CACHE.delete(m.full);
    if (!fs.readFileSync(m.full).equals(orig)) throw new Error(m.file + ' did not read back as its backup; the backup is kept');
    fs.unlinkSync(bak);
    out.push({ file: m.file, defs: m.defs });
  }
  return { models: out };
}

module.exports = {
  EXT, BAK, SMEAR_SHARE, parseModel, transformRefs, stripDoc, encodeModel, applyTransform, predictSmear,
  defModel, resolveModel, stageDefs, stageModels, inspectModel, status, strip, undo, MODEL_CACHE,
  loadBuffers, bufferFiles,
};
