'use strict';
// futafix.js - a Futa-brand victim's flag, honored in the copy a build ships.
//
// THE DEFECT. A victim of this brand (FutaNT / FutaBT / FutaLB) needs no pair
// actions: the giver plays ITS OWN tables on her sprites. Shipping the blank
// action 122331 tells the giver to use its "Plus" tables, which draw
//   12251 0-11   17231 0-8   19231 0-9   12261 0-8
// and no trigger can ask whether a sprite exists, so the giver trusts the flag.
// A victim who ships the flag with a shorter set (or without a group at all)
// draws NOTHING for those elements: she vanishes for the tail of every thrust.
// Both engines behave the same - a missing sprite draws nothing anywhere.
//
// THE REPAIR. The missing (group,index) keys are added to the shipped copy of
// her SFF v1 as LINKED sprites: a 32-byte subheader with no image data that
// names an earlier sprite by file index. The engine shares that sprite's
// texture AND palette index (image.go, the `size == 0` branch - shareCopy), so
// an alias follows the player's color exactly as its source does, and costs
// 32 bytes. Which sprite stands in:
//   - the group is there but short: the missing index HOLDS the last frame
//     below it. Measured on the victim this was written for, the last frames of
//     her 8-frame sets sit back at rest, so the hold reads as the pause between
//     two thrusts.
//   - the group is absent: each element draws what the CLASSIC table draws at
//     that element. The classic and Plus tables place their frames at the same
//     offsets (0,-12 lying; 0,9 riding), and the classic press table draws the
//     lying group, so this is the picture a classic giver would have shown.
//   - neither exists (no riding art of either generation): nothing can stand
//     in; the key is reported and the pose stays empty.
//
// WHY APPEND. Linked sprites are appended after the last subfile. SFF v1
// palettes chain by file position, so inserting would re-base every sprite
// that follows; nothing follows the end. A linked sprite never becomes the
// "previous sprite" of the chain either, and duplicate keys resolve to the
// first in file order, so an alias can never shadow art the file already has.
// The engine takes a sprite's block end from its next-subheader offset when
// looking for the palette, so the new subheaders sit EXACTLY at the last
// block's end - that block's extent does not change.
//
// Originals are never written: vfslib puts the repaired file in the build's
// generated layer, desktop.js rewrites the copy it just made.
const fs = require('fs');
const path = require('path');

const FLAG_ACTION = 122331;

// The brand's tables, element by element: which classic sprite index the
// classic table draws where the Plus table draws index k. Identical in every
// giver measured (tools/test-futa-fix.js re-reads them from the corpus).
const PLUS_SETS = [
  { group: 12251, classic: 12250, table: [0, 0, 1, 2, 2, 2, 2, 2, 1, 1, 0, 0] }, // 91001 over 71001
  { group: 17231, classic: 17230, table: [0, 0, 0, 1, 2, 2, 2, 1, 0] },          // 91041 over 71041
  { group: 19231, classic: 19230, table: [0, 0, 0, 1, 2, 2, 2, 1, 0, 0] },       // 91081 over 71081
  { group: 12261, classic: 12250, table: [0, 0, 1, 2, 2, 2, 2, 2, 1] },          // 91121 over 71121
];

function airShipsFlag(airText) {
  return new RegExp('^[ \\t]*\\[[ \\t]*begin[ \\t]+action[ \\t]+' + FLAG_ACTION + '[ \\t]*\\]', 'im').test(String(airText || ''));
}

// keys: Set of 'group,index' the sprite file holds.
// -> { aliases: [{ key, from, how }], unfixable: [key] }
function planAliases(keys) {
  const aliases = [], unfixable = [];
  for (const set of PLUS_SETS) {
    const n = set.table.length;
    const have = [];
    for (let i = 0; i < n; i++) if (keys.has(set.group + ',' + i)) have.push(i);
    if (have.length === n) continue;
    for (let i = 0; i < n; i++) {
      const key = set.group + ',' + i;
      if (keys.has(key)) continue;
      if (have.length) {
        const below = have.filter((j) => j < i);
        const j = below.length ? below[below.length - 1] : have[0];
        aliases.push({ key, from: set.group + ',' + j, how: 'hold' });
      } else if (keys.has(set.classic + ',' + set.table[i])) {
        aliases.push({ key, from: set.classic + ',' + set.table[i], how: 'classic' });
      } else unfixable.push(key);
    }
  }
  return { aliases, unfixable };
}

// Walk an SFF v1 into its subheaders, file order. Null when it is not one, or
// when the chain does not deliver the sprite count the header promises (the
// engine would read garbage there, and so would an append).
function walkV1(b) {
  if (!b || b.length < 64 || b.slice(0, 11).toString('latin1') !== 'ElecbyteSpr' || b[15] !== 1) return null;
  const num = b.readUInt32LE(20);
  let ofs = b.readUInt32LE(24);
  const subs = [];
  for (let i = 0; i < num; i++) {
    if (!(ofs > 0) || ofs + 32 > b.length) return null;
    const next = b.readUInt32LE(ofs), len = b.readUInt32LE(ofs + 4);
    subs.push({ ofs, next, len, group: b.readUInt16LE(ofs + 12), image: b.readUInt16LE(ofs + 14), link: b.readUInt16LE(ofs + 16) });
    if (i < num - 1 && !(next > ofs)) return null;
    ofs = next;
  }
  return subs;
}

function spriteKeys(b) {
  const subs = walkV1(b);
  return subs ? new Set(subs.map((s) => s.group + ',' + s.image)) : null;
}

// aliases: [{ key: 'g,i', from: 'g,i' }] -> { buf, added, skipped: [{ key, why }] }
// buf is a NEW buffer (the input is not modified); null when nothing was added.
function aliasSffV1(input, aliases) {
  const subs = walkV1(input);
  if (!subs || !subs.length) return { buf: null, added: 0, skipped: aliases.map((a) => ({ key: a.key, why: 'not an SFF v1' })) };
  const first = new Map();
  subs.forEach((s, i) => { const k = s.group + ',' + s.image; if (!first.has(k)) first.set(k, i); });
  const last = subs[subs.length - 1];
  const end = last.next > last.ofs ? last.next : last.ofs + 32 + last.len;
  if (end > input.length) return { buf: null, added: 0, skipped: aliases.map((a) => ({ key: a.key, why: 'last sprite runs past the file' })) };

  const todo = [], skipped = [];
  for (const a of aliases) {
    if (first.has(a.key) || todo.some((t) => t.key === a.key)) { skipped.push({ key: a.key, why: 'already there' }); continue; }
    let src = first.get(a.from);
    // a source that is itself linked: name the sprite it shares, not the link
    for (let hops = 0; src !== undefined && subs[src].len === 0 && hops < 8; hops++) {
      src = subs[src].link < src ? subs[src].link : undefined;
    }
    if (src === undefined || subs[src].len === 0) { skipped.push({ key: a.key, why: 'no source sprite ' + a.from }); continue; }
    if (src > 0xffff || subs.length + todo.length >= 0xffff) { skipped.push({ key: a.key, why: 'file too large to link' }); continue; }
    todo.push({ key: a.key, src });
  }
  if (!todo.length) return { buf: null, added: 0, skipped };

  // anything after the last block is unreachable padding; the new subheaders
  // take its place so the last block's extent stays what it was
  const head = Buffer.from(input.subarray(0, end));
  const tail = Buffer.alloc(32 * todo.length);
  todo.forEach((t, k) => {
    const o = k * 32, s = subs[t.src];
    const [g, i] = t.key.split(',').map(Number);
    tail.writeUInt32LE(k === todo.length - 1 ? 0 : end + 32 * (k + 1), o);
    tail.writeUInt32LE(0, o + 4);                       // no data: a linked sprite
    input.copy(tail, o + 8, s.ofs + 8, s.ofs + 12);     // the source's axis
    tail.writeUInt16LE(g, o + 12);
    tail.writeUInt16LE(i, o + 14);
    tail.writeUInt16LE(t.src, o + 16);
    tail[o + 18] = 1;
  });
  head.writeUInt32LE(end, last.ofs);
  head.writeUInt32LE(subs.length + todo.length, 20);
  const groups = new Set(subs.map((s) => s.group));
  for (const t of todo) groups.add(+t.key.split(',')[0]);
  head.writeUInt32LE(groups.size, 16);
  return { buf: Buffer.concat([head, tail]), added: todo.length, skipped };
}

// ---- a character folder ---------------------------------------------------

function resolveCI(dir, rel) {
  let cur = dir;
  const parts = String(rel).replace(/\\/g, '/').split('/').filter((p) => p && p !== '.');
  const real = [];
  for (const p of parts) {
    let names;
    try { names = fs.readdirSync(cur); } catch (e) { return null; }
    const hit = names.includes(p) ? p : names.find((x) => x.toLowerCase() === p.toLowerCase());
    if (!hit) return null;
    real.push(hit); cur = path.join(cur, hit);
  }
  return real.length ? { abs: cur, rel: real.join('/') } : null;
}

function defSpriteAndAnim(defText) {
  const out = { sprite: null, anim: null };
  let inFiles = false;
  for (const raw of String(defText || '').split(/\r?\n/)) {
    const l = raw.replace(/;.*$/, '').trim();
    const sec = /^\[\s*([^\]]+?)\s*\]/.exec(l);
    if (sec) { inFiles = /^files$/i.test(sec[1]); continue; }
    if (!inFiles) continue;
    const m = /^(sprite|anim)\s*=\s*(.+)$/i.exec(l);
    if (m && !out[m[1].toLowerCase()]) out[m[1].toLowerCase()] = m[2].replace(/"/g, '').trim();
  }
  return out;
}

// Re-reading a roster's .air files on every build would be the slow part; a
// file that has not changed gives the answer it gave last time.
const cache = new Map();
function cached(abs, tag, compute) {
  let st;
  try { st = fs.statSync(abs); } catch (e) { return null; }
  const k = tag + '|' + abs, stamp = st.size + ':' + st.mtimeMs;
  const hit = cache.get(k);
  if (hit && hit.stamp === stamp) return hit.value;
  const value = compute();
  cache.set(k, { stamp, value });
  return value;
}

// What the repair would do for the character `defName` loads, reading only.
// -> null when there is nothing to do, else
//    { spriteRel, spriteAbs, buf, added, aliases, unfixable, skipped }
// spriteRel is the file's on-disk spelling relative to charDir.
// opts.input: the sprite file's bytes as another repair already left them
// (portraitfit rebuilds the file; links are appended to ITS output, never the
// other way round - a rebuild keeps every index, an append relies on them).
function repairFor(charDir, defName, opts) {
  let defText;
  const def = resolveCI(charDir, defName);
  if (!def) return null;
  try { defText = fs.readFileSync(def.abs, 'latin1'); } catch (e) { return null; }
  const files = defSpriteAndAnim(defText);
  if (!files.sprite || !files.anim) return null;
  const base = path.posix.dirname(def.rel);
  const at = (rel) => resolveCI(charDir, base === '.' ? rel : base + '/' + rel) || resolveCI(charDir, rel);
  const anim = at(files.anim);
  if (!anim) return null;
  const flagged = cached(anim.abs, 'flag', () => {
    try { return airShipsFlag(fs.readFileSync(anim.abs, 'latin1')); } catch (e) { return false; }
  });
  if (!flagged) return null;
  const sprite = at(files.sprite);
  if (!sprite) return null;
  const given = opts && opts.input;
  const work = () => {
    let b = given || null;
    if (!b) { try { b = fs.readFileSync(sprite.abs); } catch (e) { return null; } }
    const keys = spriteKeys(b);
    if (!keys) return { v1: false };
    const plan = planAliases(keys);
    if (!plan.aliases.length) return { v1: true, plan, out: null };
    return { v1: true, plan, out: aliasSffV1(b, plan.aliases) };
  };
  // a handed-in buffer is somebody else's output: never cached under the file's stamp
  const res = given ? work() : cached(sprite.abs, 'sff', work);
  if (!res || !res.v1 || !res.out || !res.out.buf) return null;
  return { spriteRel: sprite.rel, spriteAbs: sprite.abs, buf: res.out.buf, added: res.out.added,
    aliases: res.plan.aliases, unfixable: res.plan.unfixable, skipped: res.out.skipped };
}

module.exports = { FLAG_ACTION, PLUS_SETS, airShipsFlag, planAliases, walkV1, spriteKeys, aliasSffV1, defSpriteAndAnim, resolveCI, repairFor };
