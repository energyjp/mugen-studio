'use strict';
//
// v2ownpal.js - the shipped def of an SFF v2 character, without the palN lines
// its sprite file already answers.
//
// AN SFF v2 FILE CARRIES ITS OWN COSTUMES: palette nodes keyed (1, N), the ones
// its sprites are indexed against. A def may name palN files as well, and which
// of the two a fight draws depends on the engine:
//   MUGEN, and this project's engine (7a63956)  the file's own (1, N); a def's
//                                              file fills only a slot the
//                                              sprite file does not key
//   the official Ikemen GO 1.0.0               the def's file, written over the
//                                              node (char.go loadPalettes,
//                                              "Overwrite SFF palettes with ACT
//                                              palettes")
// and the official one is the engine the desktop export ships. A def's copy is
// usually the same bytes, but not always: WrestlerX names pal1-6 =
// act/inma.act, which is her blue effect palette and not a costume, so on the
// desktop her body - on (1, 1) - was drawn blue while the website drew her red.
// Dr. Kira's twelve predate the ramps her tag helper is drawn with and turn it
// black (GRAIL 3.3).
//
// THE REPAIR COMMENTS THOSE LINES OUT in the copy a build ships: each palN of
// the def's FIRST [Files] (the only one the engines read) whose N the shipped
// sprite file keys as (1, N), the line's own text kept after the ';'. The
// official engine then keeps the node - with no file to read, its v2 branch
// takes the slot from the sprite file - and the select screen still lists the
// slot, because it merges the file's keys with the def's (system.go, "Merge SFF
// and ACT indexes"). This project's engine never read those lines, so a fight
// on the website is unchanged. What can change there is the select screen's
// color preview: on both engines it loads each named file over palette index
// N-1 (image.go loadActPalettes), which by the code previewed WrestlerX blue
// on the website too. A slot the sprite file does not key keeps its line: that
// one is the def's to fill.
//
// RUNS LAST, on the def and the sprite file as every other repair left them:
// custompal adds (1, N) nodes and palorder renumbers both the lines and the
// keys, so only the final pair says which lines the file answers.
const fs = require('fs');
const path = require('path');
const futafix = require('./futafix.js');

// The slots an SFF v2 file keys as (1, N), read off its palette table. Takes
// the whole file, or reads only the header and the table from disk: every build
// asks this of every character, and the table is a few hundred bytes of a file
// that can run to tens of megabytes. -> Set, or null when it is not an SFF v2.
function keyedSlots(input) {
  const read = (buf) => {
    if (!buf || buf.length < 68 || buf.slice(0, 11).toString('latin1') !== 'ElecbyteSpr' || buf[15] !== 2) return null;
    return { po: buf.readUInt32LE(44), n: buf.readUInt32LE(48) };
  };
  const slots = new Set();
  if (Buffer.isBuffer(input)) {
    const h = read(input);
    if (!h) return null;
    for (let k = 0; k < h.n; k++) {
      const o = h.po + k * 16;
      if (o + 16 > input.length) break;
      if (input.readUInt16LE(o) === 1) slots.add(input.readUInt16LE(o + 2));
    }
    return slots;
  }
  let fd = null;
  try {
    fd = fs.openSync(input, 'r');
    const head = Buffer.alloc(68);
    if (fs.readSync(fd, head, 0, 68, 0) < 68) return null;
    const h = read(head);
    if (!h) return null;
    const size = fs.fstatSync(fd).size;
    const n = Math.max(0, Math.min(h.n, Math.floor((size - h.po) / 16)));
    const table = Buffer.alloc(n * 16);
    if (n) fs.readSync(fd, table, 0, table.length, h.po);
    for (let k = 0; k < n; k++) if (table.readUInt16LE(k * 16) === 1) slots.add(table.readUInt16LE(k * 16 + 2));
    return slots;
  } catch (e) {
    return null;
  } finally {
    if (fd !== null) try { fs.closeSync(fd); } catch (e) { /* already gone */ }
  }
}

// The def with every palN of its FIRST [Files] whose N is in `slots` commented
// out, in the file's own line ending. A line with no file after the '=' names
// nothing and is left as it is. The key is matched as the engines look it up,
// "pal" and the number with no leading zero (char.go, fmt.Sprintf("pal%v")),
// in any case. -> { text, slots: [N] } (text is the input when nothing applies)
function defWithoutKeyed(defText, slots) {
  const text = String(defText || ''), eol = /\r\n/.test(text) ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/), done = [];
  let inFiles = false, seenFiles = false;
  for (let k = 0; k < lines.length; k++) {
    // (a UTF-8 byte-order mark, read as latin1, is dropped first, as the engines' text loader does)
    const sec = /^\s*\[\s*([^\]]+?)\s*\]/.exec((k ? lines[k] : lines[k].replace(/^ï»¿/, '')).replace(/;.*$/, ''));
    if (sec) {
      if (inFiles) break;                               // past the first [Files]: nothing else is read
      inFiles = !seenFiles && /^files$/i.test(sec[1]);
      seenFiles = seenFiles || inFiles;
      continue;
    }
    if (!inFiles) continue;
    const m = /^[ \t]*pal([1-9]\d*)[ \t]*=([^;]*)/i.exec(lines[k]);
    if (!m || !m[2].trim() || !slots.has(Number(m[1]))) continue;
    lines[k] = ';' + lines[k] + ' ; unused: the sprite file has its own pal' + m[1];
    if (!done.includes(Number(m[1]))) done.push(Number(m[1]));
  }
  return { text: done.length ? lines.join(eol) : text, slots: done.sort((a, b) => a - b) };
}

// -> null, or { def: { rel, abs, text }, slots: [N] }
// opts.input: the sprite file as an earlier repair left it; opts.defText: the
// def as an earlier repair left it (the website build rewrites both in memory).
function repairFor(charDir, defName, opts) {
  const def = futafix.resolveCI(charDir, defName);
  if (!def) return null;
  let defText = opts && typeof opts.defText === 'string' ? opts.defText : null;
  if (defText === null) { try { defText = fs.readFileSync(def.abs, 'latin1'); } catch (e) { return null; } }
  // a def that names no palette at all - most v2 characters - is done here
  if (!/^[ \t]*pal[1-9]\d*[ \t]*=/im.test(defText)) return null;
  let slots = null;
  if (opts && Buffer.isBuffer(opts.input)) slots = keyedSlots(opts.input);
  else {
    const files = futafix.defSpriteAndAnim(defText);
    if (!files.sprite) return null;
    const base = path.posix.dirname(def.rel);
    const under = (rel) => (base === '.' ? rel : base + '/' + rel);
    const sprite = futafix.resolveCI(charDir, under(files.sprite)) || futafix.resolveCI(charDir, files.sprite);
    if (!sprite) return null;
    slots = keyedSlots(sprite.abs);
  }
  if (!slots || !slots.size) return null;
  const r = defWithoutKeyed(defText, slots);
  if (!r.slots.length) return null;
  return { def: { rel: def.rel, abs: def.abs, text: r.text }, slots: r.slots };
}

module.exports = { keyedSlots, defWithoutKeyed, repairFor };
