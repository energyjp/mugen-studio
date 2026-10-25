'use strict';
//
// lendsprites.js - sprites one sprite file lends to another, by key.
//
// A pack can name a sprite it never shipped. The MK2 Remix screenpack keeps
// the engine's own team-menu keys - `p1.teammenu.value.icon.spr = 181,0`, the
// Simul player-count icons - and has no group 181 in its file, so the count
// is drawn as nothing and the menu is worked blind. The engine's own
// screenpack HAS those sprites under those very numbers. Lending them is a
// copy of pixels and palette under the same key, nothing invented.
//
// Into an SFF v2 target the sprite goes as a fresh node with its own palette
// (same layout as portraitfit.fitSffV2: RLE8 data appended, node and palette
// tables moved to the end whole); into a v1 target through
// portraitfit.rebuildV1's append path. A key the target already has is never
// touched, and a source sprite the decoder cannot hand over as indexed pixels
// (a PNG24 sprite) is skipped and said so.
const core = require('./public/ikemen/sffdec-core.js');
const portraitfit = require('./portraitfit.js');

// keys: [[group, index], ...]. -> { buf, lent: ['181,0', ...], skipped: [{ key, why }] }; buf null when nothing was lent
function lend(target, source, keys) {
  const lent = [], skipped = [];
  const tsff = core.readSff(target), ssff = core.readSff(source);
  if (!tsff) return { buf: null, lent, skipped: keys.map((k) => ({ key: k.join(','), why: 'the target is not a sprite file' })) };
  if (!ssff) return { buf: null, lent, skipped: keys.map((k) => ({ key: k.join(','), why: 'the source is not a sprite file' })) };
  const items = [];
  for (const k of keys) {
    const key = k.join(',');
    if (core.spriteGeom(tsff, k[0], k[1])) { skipped.push({ key, why: 'the target has it' }); continue; }
    const geom = core.spriteGeom(ssff, k[0], k[1]);
    const d = geom && core.decodeSprite(ssff, k[0], k[1]);
    if (!d) { skipped.push({ key, why: 'the source has no such sprite' }); continue; }
    const node = ssff.byKey.get(key);
    // A PNG sprite (formats 10-12; the engine's own team-menu icons are PNG32)
    // goes across as the PNG it is, into a v2 target. A v1 file holds only
    // indexed pixels, and a PNG8's index map still needs the SFF palette table
    // it was keyed to, so a PNG is lent to v2 targets only.
    if (d.kind === 'png') {
      if (tsff.version !== 2) { skipped.push({ key, why: 'a PNG sprite cannot go into an SFF v1 file' }); continue; }
      const pal768 = node.fmt === 10 && d.pal && d.pal.length >= 768 ? Buffer.from(d.pal.subarray(0, 768)) : null;
      if (node.fmt === 10 && !pal768) { skipped.push({ key, why: 'the source PNG8 has no palette to lend' }); continue; }
      items.push({ group: k[0], image: k[1], w: d.w, h: d.h, png: Buffer.from(d.bytes), fmt: node.fmt, pal768, axisX: geom.axisX | 0, axisY: geom.axisY | 0 });
      lent.push(key);
      continue;
    }
    if (d.kind !== 'indexed' || !d.pal || d.pal.length < 768) { skipped.push({ key, why: 'the source sprite is not indexed' }); continue; }
    items.push({ group: k[0], image: k[1], w: d.w, h: d.h, px: Buffer.from(d.px), pal768: Buffer.from(d.pal.subarray(0, 768)), axisX: geom.axisX | 0, axisY: geom.axisY | 0 });
    lent.push(key);
  }
  if (!items.length) return { buf: null, lent, skipped };
  if (tsff.version !== 2) {
    return { buf: portraitfit.rebuildV1(target, items.map((e) => Object.assign({ index: null }, e))), lent, skipped };
  }
  const input = target;
  const sprOfs = input.readUInt32LE(36), count = input.readUInt32LE(40), palOfs = input.readUInt32LE(44), palCount = input.readUInt32LE(48), lofs = input.readUInt32LE(52);
  const parts = [Buffer.from(input)];
  let cursor = input.length;
  // one palette node per lent sprite, keyed in the pictures' group at an item no palette uses
  const used = new Set();
  for (let k = 0; k < palCount; k++) used.add(input.readUInt16LE(palOfs + k * 16) + ',' + input.readUInt16LE(palOfs + k * 16 + 2));
  const palNodes = [Buffer.from(input.subarray(palOfs, palOfs + palCount * 16))], sprNodes = [];
  let item = 0;
  for (const e of items) {
    // RLE8 for indexed pixels; a PNG rides as itself behind the same 4-byte length the engine skips
    const body = e.png ? e.png : portraitfit.rle8Encode(e.px);
    const data = Buffer.alloc(4 + body.length);
    data.writeUInt32LE(e.w * e.h, 0); body.copy(data, 4);
    const node = Buffer.alloc(28);
    node.writeUInt16LE(e.group, 0); node.writeUInt16LE(e.image, 2);
    node.writeUInt16LE(e.w, 4); node.writeUInt16LE(e.h, 6);
    node.writeInt16LE(e.axisX, 8); node.writeInt16LE(e.axisY, 10);
    node.writeUInt16LE(0, 12); node[14] = e.png ? e.fmt : 2; node[15] = e.png && e.fmt !== 10 ? (e.fmt === 12 ? 32 : 24) : 8;
    node.writeUInt32LE(cursor - lofs, 16); node.writeUInt32LE(data.length, 20);
    node.writeUInt16LE(e.pal768 ? palCount + palNodes.length - 1 : 0, 24); node.writeUInt16LE(0, 26);
    parts.push(data); cursor += data.length; sprNodes.push(node);
    if (!e.pal768) continue;                                          // true color: no palette to lend
    const pal = Buffer.alloc(1024);
    for (let i = 0; i < 256; i++) { pal[i * 4] = e.pal768[i * 3]; pal[i * 4 + 1] = e.pal768[i * 3 + 1]; pal[i * 4 + 2] = e.pal768[i * 3 + 2]; pal[i * 4 + 3] = i ? 255 : 0; }
    while (used.has(portraitfit.PICTURE_PAL_GROUP + ',' + item)) item++;
    used.add(portraitfit.PICTURE_PAL_GROUP + ',' + item);
    const pn = Buffer.alloc(16);
    pn.writeUInt16LE(portraitfit.PICTURE_PAL_GROUP, 0); pn.writeUInt16LE(item, 2); pn.writeUInt16LE(256, 4);
    pn.writeUInt16LE(palCount + palNodes.length - 1, 6);
    pn.writeUInt32LE(cursor - lofs, 8); pn.writeUInt32LE(1024, 12);
    parts.push(pal); cursor += 1024; palNodes.push(pn);
  }
  const palTable = Buffer.concat(palNodes);
  parts[0].writeUInt32LE(cursor, 44); parts[0].writeUInt32LE(palCount + palNodes.length - 1, 48);   // only the palettes actually added
  parts.push(palTable); cursor += palTable.length;
  const sprTable = Buffer.concat([parts[0].subarray(sprOfs, sprOfs + count * 28), ...sprNodes]);
  parts[0].writeUInt32LE(cursor, 36); parts[0].writeUInt32LE(count + items.length, 40);
  parts.push(sprTable);
  return { buf: Buffer.concat(parts), lent, skipped };
}

module.exports = { lend };
