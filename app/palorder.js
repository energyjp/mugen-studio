'use strict';
//
// palorder.js - the ORDER of a character's palette slots, as the build ships
// them. Which color is pal1, which is pal2: that is what a screenpack's palette
// list shows and what the buttons map to, and a character's author decided it
// once. The roster keeps the user's order as a list of the ORIGINAL slot
// numbers (`paletteOrder: [4, 1, 2, 3]` = the old pal4 is now pal1), and the
// copy a build ships is renumbered to match; the character's own files are
// only read. Runs after custompal, so a color added in the Studio is a slot
// like any other by then.
//
// WHAT RENUMBERING IS depends on where a slot lives (same terms as custompal):
//   .def       `palN = file` lines in [Files] get a new N - the FILE keeps its
//              name, so a color added in the Studio still reads studio-pal4.act
//              under whatever number it ends up with. `pal.defaults` in [Info]
//              names slots, so its numbers are mapped too: the same colors stay
//              the CPU's defaults.
//   SFF v2     palette nodes keyed (1, N) get a new N. The node's INDEX does not
//              move, and sprites reference palettes by index, so nothing a
//              sprite draws with changes - except that the (1,1) node keeps its
//              key: it is the engine's palette anchor, so slot 1 moves by its
//              COLORS (sffRenumbered, below).
// Slots the order does not name follow, in their own order; numbers come out
// 1..n, gaps closed. A permutation never makes two nodes share a key.
const fs = require('fs');
const path = require('path');
const futafix = require('./futafix.js');
const custompal = require('./custompal.js');
const core = require('./public/ikemen/sffdec-core.js');

const clean = (order) => [...new Set((Array.isArray(order) ? order : []).map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= custompal.MAX_SLOT))];

// old slot -> new slot, over the slots the character actually has
function mapping(order, slots) {
  const have = new Set(slots);
  const seq = clean(order).filter((s) => have.has(s));
  const own = [...have].sort((a, b) => a - b);
  for (const s of own) if (!seq.includes(s)) seq.push(s);
  const map = new Map();
  // the author's own order is the identity, gaps and all: an order that moves
  // nothing must ship nothing
  if (seq.every((s, k) => s === own[k])) { for (const s of own) map.set(s, s); return map; }
  seq.forEach((old, k) => map.set(old, k + 1));
  return map;
}
const isIdentity = (map) => [...map].every(([a, b]) => a === b);

// the def's pal lines and pal.defaults, renumbered; { text, changed }
function defRenumbered(defText, map) {
  const text = String(defText || ''), eol = /\r\n/.test(text) ? '\r\n' : '\n';
  let changed = 0;
  const lines = text.split(/\r?\n/).map((line) => {
    let m = /^([ \t]*pal)(\d+)([ \t]*=)/i.exec(line);
    if (m && map.has(+m[2]) && map.get(+m[2]) !== +m[2]) { changed++; return m[1] + map.get(+m[2]) + line.slice(m[0].length - m[3].length); }
    m = /^([ \t]*pal\.defaults[ \t]*=[ \t]*)([^;\r\n]*)(.*)$/i.exec(line);
    if (m) {
      const parts = m[2].split(',').map((x) => parseInt(x, 10));
      if (parts.some((n) => map.has(n) && map.get(n) !== n)) {
        changed++;
        return m[1] + m[2].split(',').map((x) => { const n = parseInt(x, 10); return map.has(n) ? String(map.get(n)) : x.trim(); }).join(',') + m[3];
      }
    }
    return line;
  });
  return { text: changed ? lines.join(eol) : text, changed };
}

// THE (1,1) NODE KEEPS ITS KEY (2026-10-18). On SFF v2 the first node keyed
// (1,1) is the engine's palette anchor, not just slot 1: the select screen's
// preview follows the pick only on sprites drawn with it (GRAIL 4.9,
// coloredPalette), and a v2 character's own state 5900 RemapPal swaps (1,1)
// for (1,pick) in the fight. Re-keying it (CvS Jill, order [4,1,2,3]: her body
// node went (1,1) -> (1,2)) left the file with no (1,1) at all - every costume
// played in her default colors, and the preview showed the pick for one linked
// frame only. So when an order moves slot 1, its COLORS move instead of its
// key: the anchor takes the colors of the slot that becomes 1, and the anchor's
// own colors go to the slot 1 now ships as - the node that held the new slot
// 1's colors takes that key, or, when those colors came from a .def file, a
// node with that key is added (unless the def's line for that slot already
// carries exactly those colors). What cannot be done that way (a palette
// another node links to, a node with no data of its own) is refused, and
// shipFor keeps slot 1 where it is.
const pal768Of = (buf, off, len) => {
  const p = Buffer.alloc(768), n = Math.min(256, Math.floor(len / 4));
  for (let i = 0; i < n; i++) { p[i * 3] = buf[off + i * 4]; p[i * 3 + 1] = buf[off + i * 4 + 1]; p[i * 3 + 2] = buf[off + i * 4 + 2]; }
  return p;
};
function v2Nodes(buf) {
  const po = buf.readUInt32LE(44), n = buf.readUInt32LE(48), out = [];
  for (let k = 0; k < n; k++) {
    const o = po + k * 16;
    if (o + 16 > buf.length) break;
    out.push({ k, o, g: buf.readUInt16LE(o), item: buf.readUInt16LE(o + 2), link: buf.readUInt16LE(o + 6), off: buf.readUInt32LE(o + 8), len: buf.readUInt32LE(o + 12) });
  }
  return out;
}
// the v2 palette table's (1, N) keys, renumbered, the (1,1) anchor kept;
// { buf, changed, anchor? , refused? }. colorsOf(slot) -> the 768 RGB bytes of
// a slot the def gives as a file (only asked when the new slot 1 is one).
function sffRenumbered(input, map, colorsOf) {
  if (!input || input.length < 68 || input[15] !== 2) return { buf: input, changed: 0 };
  const lofs = input.readUInt32LE(52);
  let buf = Buffer.from(input);
  const nodes = v2Nodes(buf);
  const anchor = nodes.find((p) => p.g === 1 && p.item === 1) || null;
  const m = map.get(1), src = ([...map].find(([, b]) => b === 1) || [])[0];
  const moveOne = !!anchor && m != null && m !== 1 && src != null && src !== 1;
  const srcNode = moveOne ? nodes.find((p) => p !== anchor && p.g === 1 && p.item === src) || null : null;
  if (moveOne) {
    const own = (p) => p.len >= 4 && lofs + p.off + p.len <= buf.length;
    const linkedTo = (p) => nodes.some((q) => q !== p && q.len === 0 && q.link === p.k);
    if (!own(anchor) || linkedTo(anchor)) return { buf: input, changed: 0, refused: 'the (1,1) palette has no data of its own' };
    if (srcNode && (!own(srcNode) || linkedTo(srcNode))) return { buf: input, changed: 0, refused: 'the new slot 1 palette has no data of its own' };
  }
  let changed = 0;
  for (const p of nodes) {
    if (p.g !== 1) continue;
    if (moveOne && p === anchor) continue;
    const to = moveOne && p === srcNode ? m : (map.has(p.item) ? map.get(p.item) : p.item);
    if (to !== p.item) { buf.writeUInt16LE(to, p.o + 2); changed++; }
  }
  if (!moveOne) return { buf, changed };
  const anchorOld = pal768Of(buf, lofs + anchor.off, anchor.len);
  const newOne = srcNode ? pal768Of(buf, lofs + srcNode.off, srcNode.len) : (colorsOf ? colorsOf(src) : null);
  if (!newOne) return { buf: input, changed: 0, refused: 'the colors of slot ' + src + ' could not be read' };
  // RGB only: each entry's fourth byte (index 0 transparent) stays the node's own
  const writeInto = (p, pal) => {
    const at = lofs + p.off, n = Math.min(256, Math.floor(p.len / 4));
    for (let i = 0; i < n; i++) { buf[at + i * 4] = pal[i * 3]; buf[at + i * 4 + 1] = pal[i * 3 + 1]; buf[at + i * 4 + 2] = pal[i * 3 + 2]; }
  };
  writeInto(anchor, newOne); changed++;
  let added = false;
  if (srcNode) writeInto(srcNode, anchorOld);
  else if (!(colorsOf && colorsOf.sameAs && colorsOf.sameAs(m, anchorOld))) {
    const r = custompal.addPalettesV2(buf, [{ slot: m, pal768: anchorOld }]);
    if (!r.buf) return { buf: input, changed: 0, refused: 'slot ' + m + ' could not be added: ' + ((r.skipped[0] || {}).why || '?') };
    buf = r.buf; changed++; added = true;
  }
  return { buf, changed, anchor: { node: anchor.k, from: src, to: m, added } };
}

// THE SLOTS OF A SPRITE FILE THAT WAS NOT HANDED IN, without reading the whole
// file: byte 15 says the version, and only a v2 file has slots of its own, in
// its palette table (16 bytes a node). -> { v2: Set | null } where v2 is null
// for anything not v2, or null itself when the table is not wholly inside the
// file (or the head cannot be read) - then the whole file is read as before,
// so what it does with such a file is exactly what it always did.
function spriteSlots(abs) {
  let fd = null;
  try {
    fd = fs.openSync(abs, 'r');
    const size = fs.fstatSync(fd).size;
    const h = Buffer.alloc(52);
    const got = fs.readSync(fd, h, 0, 52, 0);
    if (got < 16 || h[15] !== 2) return got === Math.min(52, size) ? { v2: null } : null;
    if (got < 52) return null;
    const po = h.readUInt32LE(44), n = h.readUInt32LE(48);
    if (po + n * 16 > size) return null;
    const t = Buffer.alloc(n * 16);
    if (fs.readSync(fd, t, 0, t.length, po) !== t.length) return null;
    const out = new Set();
    for (let k = 0; k < n; k++) if (t.readUInt16LE(k * 16) === 1) out.add(t.readUInt16LE(k * 16 + 2));
    return { v2: out };
  } catch (e) { return null; } finally { if (fd !== null) try { fs.closeSync(fd); } catch (e) { /* already gone */ } }
}

// -> null, or { def: { rel, abs, text } | null, sprite: { rel, abs, buf } | null, map: [[old, new]], slots }
// opts.input / opts.defText: the sprite file and def as an earlier repair left them.
function shipFor(charDir, defName, order, opts) {
  if (!clean(order).length) return null;
  const def = futafix.resolveCI(charDir, defName);
  if (!def) return null;
  let defText = opts && opts.defText;
  if (defText == null) { try { defText = fs.readFileSync(def.abs, 'latin1'); } catch (e) { return null; } }
  const files = futafix.defSpriteAndAnim(defText);
  const base = path.posix.dirname(def.rel);
  const under = (rel) => (base === '.' ? rel : base + '/' + rel);
  const sprite = files.sprite ? (futafix.resolveCI(charDir, under(files.sprite)) || futafix.resolveCI(charDir, files.sprite)) : null;
  let input = opts && opts.input;
  // (the whole file only when a v2 file's own keys are to move: a v1 file's
  // slots are the def's, and an order that moves nothing ships nothing)
  const head = !input && sprite ? spriteSlots(sprite.abs) : null;
  if (!input && sprite && !head) { try { input = fs.readFileSync(sprite.abs); } catch (e) { input = null; } }
  let slots = new Set(custompal.defSlots(defText));
  if (input && input[15] === 2) for (const s of custompal.v2Slots(input)) slots.add(s);
  if (head && head.v2) for (const s of head.v2) slots.add(s);
  let map = mapping(order, [...slots]);
  if (!slots.size || isIdentity(map)) return null;
  if (head && head.v2) {
    try { input = fs.readFileSync(sprite.abs); } catch (e) { input = null; }
    // (a file that cannot be read whole after all: the def's slots alone, as a failed read always gave)
    if (!input) {
      slots = new Set(custompal.defSlots(defText));
      map = mapping(order, [...slots]);
      if (!slots.size || isIdentity(map)) return null;
    }
  }
  // the colors of an ORIGINAL slot the def gives as a file (pal<N> = file):
  // what the anchor takes when that slot becomes 1 (sffRenumbered)
  const colorsOf = (slot) => {
    const m = new RegExp('^[ \\t]*pal' + slot + '[ \\t]*=[ \\t]*([^;\\r\\n]*)', 'im').exec(defText);
    const rel = m && m[1].trim();
    if (!rel) return null;
    const f = futafix.resolveCI(charDir, under(rel)) || futafix.resolveCI(charDir, rel);
    if (!f) return null;
    try { const pal = core.readAct(fs.readFileSync(f.abs)); return pal ? Buffer.from(pal) : null; } catch (e) { return null; }
  };
  // whether the def's line that ships as new slot `slot` already carries `pal`
  colorsOf.sameAs = (slot, pal) => {
    const old = ([...map].find(([, b]) => b === slot) || [])[0];
    const c = old != null ? colorsOf(old) : null;
    return !!c && Buffer.compare(c, pal) === 0;
  };
  let s = sffRenumbered(input, map, colorsOf);
  if (s.refused) {
    // slot 1 stays where it is; the rest of the order still applies
    map = mapping([1, ...clean(order).filter((x) => x !== 1)], [...slots]);
    if (isIdentity(map)) return null;
    s = sffRenumbered(input, map, colorsOf);
  }
  const d = defRenumbered(defText, map);
  return {
    def: d.changed ? { rel: def.rel, abs: def.abs, text: d.text } : null,
    sprite: s.changed && sprite ? { rel: sprite.rel, abs: sprite.abs, buf: s.buf } : null,
    map: [...map].filter(([a, b]) => a !== b), slots: slots.size,
    anchor: s.anchor || null, refused: s.refused || null,
  };
}

module.exports = { clean, mapping, defRenumbered, sffRenumbered, shipFor };
