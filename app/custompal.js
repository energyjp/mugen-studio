'use strict';
// custompal.js - palettes the user added to a character, put into the copy a
// build ships. The character's own files are only ever read.
//
// WHAT A PALETTE SLOT IS depends on the sprite file's version, and so does the
// way to add one:
//   SFF v1  the character's colors are .act files the .def names as pal1..palN
//           (the engine reads them all, up to its PaletteMax, 100 by default).
//           A new slot is a new .act beside the def and one `palN =` line in
//           the SHIPPED def's [Files].
//   SFF v2  the selectable palettes are entries of the sprite file's own
//           palette table keyed (1, N). A new slot is a new node with that key
//           and 256 RGBA entries on the end of the SHIPPED sprite file. No def
//           line is needed - the engine offers every (1, N) the file holds -
//           and it works on any engine that reads SFF v2, because nothing about
//           it depends on how a particular engine treats pal files beside a v2
//           sprite file (they differ: this project's engine never lets a def
//           file override a palette the sprite file holds).
// The palette table of a v2 file cannot grow where it sits, so it moves to the
// end of the file whole, with the new nodes on it. Node ORDER is kept, so every
// sprite's palette index still names what it named, and a node's key is
// (group, item): the engine treats a repeated key as an alias of the first, so
// a slot that already exists is refused rather than shadowed.
//
// The colors themselves are stored as .act files in the bundle's palettes/
// folder under their content hash (an imported palette and a recolored one are
// the same thing by then); how a recolor was made lives in roster.json so it
// can be edited again.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const core = require('./public/ikemen/sffdec-core.js');
const futafix = require('./futafix.js');

const FILE_RE = /^[a-f0-9]{12}\.act$/;
const MAX_SLOT = 100;

// .act is 256 RGB triples in REVERSE: the file's first triple is index 255.
function actBytes(pal768) {
  const out = Buffer.alloc(768);
  for (let i = 0; i < 256; i++) { const d = (255 - i) * 3; out[d] = pal768[i * 3]; out[d + 1] = pal768[i * 3 + 1]; out[d + 2] = pal768[i * 3 + 2]; }
  return out;
}
const nameOf = (pal768) => crypto.createHash('sha256').update(Buffer.from(pal768)).digest('hex').slice(0, 12) + '.act';

// Keep a palette in the bundle. -> its file name.
function store(dir, pal768) {
  const name = nameOf(pal768);
  fs.mkdirSync(dir, { recursive: true });
  const abs = path.join(dir, name);
  if (!fs.existsSync(abs)) fs.writeFileSync(abs, actBytes(pal768));
  return name;
}
function load(dir, file) {
  if (!FILE_RE.test(String(file)) || !dir) return null;
  try { return core.readAct(fs.readFileSync(path.join(dir, file))); } catch (e) { return null; }
}

// ---- SFF v2: palette nodes keyed (1, slot) ------------------------------------
function v2Slots(buf) {
  const po = buf.readUInt32LE(44), n = buf.readUInt32LE(48), out = new Set();
  for (let k = 0; k < n; k++) if (buf.readUInt16LE(po + k * 16) === 1) out.add(buf.readUInt16LE(po + k * 16 + 2));
  return out;
}
// add: [{ slot, pal768 }] -> { buf | null, applied: [slot], skipped: [{ slot, why }] }
function addPalettesV2(input, add) {
  const applied = [], skipped = [];
  if (!input || input.length < 68 || input.slice(0, 11).toString('latin1') !== 'ElecbyteSpr' || input[15] !== 2) {
    return { buf: null, applied, skipped: add.map((a) => ({ slot: a.slot, why: 'not an SFF v2' })) };
  }
  const po = input.readUInt32LE(44), count = input.readUInt32LE(48), lofs = input.readUInt32LE(52);
  const have = v2Slots(input);
  const head = Buffer.from(input), datas = [], nodes = [Buffer.from(input.subarray(po, po + count * 16))];
  let cursor = input.length;
  for (const a of add) {
    if (have.has(a.slot)) { skipped.push({ slot: a.slot, why: 'the sprite file already has a palette ' + a.slot }); continue; }
    have.add(a.slot);
    const data = Buffer.alloc(1024);
    for (let i = 0; i < 256; i++) { data[i * 4] = a.pal768[i * 3]; data[i * 4 + 1] = a.pal768[i * 3 + 1]; data[i * 4 + 2] = a.pal768[i * 3 + 2]; data[i * 4 + 3] = i ? 255 : 0; }
    const pn = Buffer.alloc(16);
    pn.writeUInt16LE(1, 0); pn.writeUInt16LE(a.slot, 2); pn.writeUInt16LE(256, 4);
    pn.writeUInt16LE(count + nodes.length - 1, 6);          // "linked" names itself: a palette with data of its own
    pn.writeUInt32LE(cursor - lofs, 8); pn.writeUInt32LE(1024, 12);
    datas.push(data); cursor += 1024; nodes.push(pn); applied.push(a.slot);
  }
  if (!applied.length) return { buf: null, applied, skipped };
  head.writeUInt32LE(cursor, 44);
  head.writeUInt32LE(count + applied.length, 48);
  return { buf: Buffer.concat([head, ...datas, ...nodes]), applied, skipped };
}

// ---- SFF v1: palN lines in the def ---------------------------------------------
function defSlots(defText) {
  const out = new Set();
  for (const m of String(defText || '').matchAll(/^[ \t]*pal(\d+)[ \t]*=[ \t]*([^;\r\n]*)/gim)) if (m[2].trim()) out.add(+m[1]);
  return out;
}
// add: [{ slot, file }] -> { text, applied: [slot], skipped }
// The lines go at the END of [Files] (after the last non-blank line of the
// section), in the file's own line ending. Only the first [Files] counts to the
// engine, so that is the one written to.
function defWithPalettes(defText, add) {
  const text = String(defText || ''), eol = /\r\n/.test(text) ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/), applied = [], skipped = [];
  let start = -1, end = lines.length;
  for (let k = 0; k < lines.length; k++) {
    const sec = /^\s*\[\s*([^\]]+?)\s*\]/.exec(lines[k].replace(/;.*$/, ''));
    if (!sec) continue;
    if (start < 0 && /^files$/i.test(sec[1])) start = k;
    else if (start >= 0) { end = k; break; }
  }
  if (start < 0) return { text, applied, skipped: add.map((a) => ({ slot: a.slot, why: 'the def has no [Files] section' })) };
  const have = defSlots(text);
  const fresh = [];
  for (const a of add) {
    if (have.has(a.slot)) { const key = 'pal' + a.slot; skipped.push({ slot: a.slot, why: 'the def already names a ' + key }); continue; }
    have.add(a.slot); fresh.push('pal' + a.slot + ' = ' + a.file); applied.push(a.slot);
  }
  if (!fresh.length) return { text, applied, skipped };
  let at = end;
  while (at > start + 1 && !lines[at - 1].trim()) at--;
  lines.splice(at, 0, ...fresh);
  return { text: lines.join(eol), applied, skipped };
}

// ---- a character folder ---------------------------------------------------------
// THE FIRST n BYTES of a file, as many as it has (null when it cannot be read).
// A v1 sprite file is read here only for its version byte - the slots go into
// the def - so a build reads 16 bytes of it, not all of it (14 MB of Mika's).
function readHead(abs, n) {
  let fd = null;
  try {
    fd = fs.openSync(abs, 'r');
    const b = Buffer.alloc(n);
    return b.subarray(0, fs.readSync(fd, b, 0, n, 0));
  } catch (e) { return null; } finally { if (fd !== null) try { fs.closeSync(fd); } catch (e) { /* already gone */ } }
}
// customs: [{ slot, file: '<hash>.act' }]
// opts.palettes: the bundle's palettes/ folder; opts.input: the sprite file's
// bytes as another repair already left them.
// -> null, or { version, sprite: { rel, abs, buf } | null, def: { rel, abs, text } | null,
//               files: [{ rel, buf }], applied: [slot], skipped: [{ slot, why }] }
function shipFor(charDir, defName, customs, opts) {
  const list = (customs || []).filter((c) => c && Number.isInteger(c.slot) && c.slot >= 1 && c.slot <= MAX_SLOT);
  if (!list.length) return null;
  const def = futafix.resolveCI(charDir, defName);
  if (!def) return null;
  let defText;
  try { defText = fs.readFileSync(def.abs, 'latin1'); } catch (e) { return null; }
  const files = futafix.defSpriteAndAnim(defText);
  if (!files.sprite) return null;
  const base = path.posix.dirname(def.rel);
  const under = (rel) => (base === '.' ? rel : base + '/' + rel);
  const sprite = futafix.resolveCI(charDir, under(files.sprite)) || futafix.resolveCI(charDir, files.sprite);
  if (!sprite) return null;
  let input = opts && opts.input;
  const whole = !!input;
  if (!input) { input = readHead(sprite.abs, 16); if (!input) return null; }
  const skipped = [], ready = [];
  for (const c of list) {
    const pal = load(opts && opts.palettes, c.file);
    if (pal) ready.push({ slot: c.slot, pal768: pal, file: c.file });
    else skipped.push({ slot: c.slot, why: 'the palette ' + c.file + ' is no longer in the bundle' });
  }
  const out = { version: input[15], sprite: null, def: null, files: [], applied: [], skipped };
  if (!ready.length) return skipped.length ? out : null;
  if (input[15] === 2) {
    if (!whole) { try { input = fs.readFileSync(sprite.abs); } catch (e) { return null; } }
    const r = addPalettesV2(input, ready);
    out.skipped.push(...r.skipped); out.applied = r.applied;
    if (r.buf) out.sprite = { rel: sprite.rel, abs: sprite.abs, buf: r.buf };
  } else {
    const r = defWithPalettes(defText, ready.map((c) => ({ slot: c.slot, file: 'studio-pal' + c.slot + '.act' })));
    out.skipped.push(...r.skipped); out.applied = r.applied;
    if (r.applied.length) {
      out.def = { rel: def.rel, abs: def.abs, text: r.text };
      for (const c of ready) if (r.applied.includes(c.slot)) out.files.push({ rel: under('studio-pal' + c.slot + '.act'), buf: actBytes(c.pal768) });
    }
  }
  return out;
}

module.exports = { FILE_RE, MAX_SLOT, actBytes, nameOf, store, load, v2Slots, addPalettesV2, defSlots, defWithPalettes, readHead, shipFor };
