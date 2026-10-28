// PORTRAIT RENUMBERING.
//
// A character whose select portrait looks broken is usually not damaged. It
// ships correct portrait art under a sprite number the screenpack does not
// read. Three characters in this roster do exactly that: cvsjill, cvsmika_h and
// leonaheidern_xiii_p-tan all keep a 25x25 face at 9000,100 and a real portrait
// at 9000,101, while 9000,0 holds a 15x31 sliver and 9000,1 a 424x455
// UNASSEMBLED ARTWORK SHEET - two finished select panels, two name plates and
// two idle sprites in one image. See GRAIL 3.4d.
//
// So the repair is not to paint a replacement. It is to RENUMBER: rewrite the
// group/number fields of a sprite node so the art the character already has
// lands on the number the pack reads. Two bytes per sprite, in place.
//
// WHY RENUMBER RATHER THAN APPEND OR LINK
//   - Appending a second 9000,0 does nothing: the engine takes the FIRST sprite
//     for a duplicate key (image.go:1657-1661), so the new art is never drawn.
//   - A LINK node names its source by sprite INDEX, and which direction is safe
//     varies per file: cvsjill keeps her real portraits at file indices 0-1 with
//     the fragments at 1911-1912, while cvsmika_h is the reverse. Renumbering
//     does not care about order.
//   - Encoding a supplied PNG would make the sprite truecolor, and
//     image.go:810-824 hands back the sprite's own palette above coldepth 8
//     with GetPalTex returning nil - so `applypal` stops working and the
//     player's palette pick can never reach the portrait. Renumbering leaves
//     the art indexed exactly as the author left it.
//
// THE EDIT IS TWO BYTES, SO THE BACKUP IS NOT THE WHOLE FILE. These .sff files
// run to tens of megabytes and other tools in this project already park whole-
// file backups beside them (.stagethumb.orig, .portrait.bak, sffpal's .orig);
// adding a fourth would mean one tool's revert silently discarding another's.
// This stores only the bytes it overwrote, in a small JSON sidecar, and refuses
// to revert if the file no longer contains what it wrote.
//
// SIDECAR NAME ends in .bak on purpose: vfslib.js BACKUP_FILE
// (/\.(orig|bak|preSquare)$/i) and desktop.js both drop it from every export,
// so it can never ride into a shipped build.

const fs = require('fs');
const sffDecode = require('./tools/sff-decode.js');
// Node's fs.rmSync skips a non-ASCII path without a word; lifebars' rmFile does not.
const rmFile = (p) => require('./lifebars.js').rmFile(p);

const SIDECAR = '.portraitfix.bak';

// Group 9000 is the portrait group in every MUGEN-derived screenpack.
const PORTRAIT_GROUP = 9000;
// Where a displaced sprite is parked. High enough that no screenpack reads it,
// and it keeps the art in the file rather than deleting it - the whole point is
// that this is reversible and loses nothing.
const PARK_BASE = 900;

const u16 = (b, o) => b.readUInt16LE(o);
const u32 = (b, o) => b.readUInt32LE(o);

// Every sprite node's position and its group/number field offsets, in FILE
// ORDER. The two container versions keep the same two fields in different
// places, and nothing else here needs to know which version it is.
//
//   v1: linked list. count at 20, first offset at 24, next pointer at +0.
//       group +12, number +14.
//   v2: flat table. offset at 36, count at 40, 28 bytes per node.
//       group +0, number +2.
function nodeTable(b) {
  if (b.length < 64 || b.toString('latin1', 0, 11) !== 'ElecbyteSpr') {
    throw new Error('not an SFF file');
  }
  const version = b[15];
  const out = [];
  if (version === 2) {
    const sprOfs = u32(b, 36);
    const sprNum = u32(b, 40);
    for (let i = 0; i < sprNum; i++) {
      const o = sprOfs + i * 28;
      if (o + 28 > b.length) break;
      out.push({ fileIdx: i, group: u16(b, o), number: u16(b, o + 2), groupOfs: o, numberOfs: o + 2 });
    }
    return { version, nodes: out };
  }
  if (version === 1) {
    const sprNum = u32(b, 20);
    let ofs = u32(b, 24);
    for (let i = 0; i < sprNum && ofs > 0 && ofs + 32 <= b.length; i++) {
      out.push({
        fileIdx: i, group: u16(b, ofs + 12), number: u16(b, ofs + 14),
        groupOfs: ofs + 12, numberOfs: ofs + 14,
      });
      const next = u32(b, ofs);
      if (next <= ofs) break;   // a malformed or terminal chain
      ofs = next;
    }
    return { version, nodes: out };
  }
  throw new Error('unsupported SFF version ' + version);
}

function sidecarPath(sffPath) { return sffPath + SIDECAR; }

// WHICH PORTRAIT NUMBERS EXIST, WITHOUT DECODING ANYTHING.
//
// studioInfo asks this for every character on every refresh, so it must not
// pay for a full readSff - that decodes sprite data and these files run to
// tens of megabytes. The node table is a header walk, and "does 9000,100
// exist" is all the card needs to decide whether to offer the button. Real
// geometry costs a decode and is fetched on demand by /api/portrait-state
// when the panel is actually open.
function quickState(sffPath) {
  const b = fs.readFileSync(sffPath);
  const { nodes } = nodeTable(b);
  const numbers = nodes.filter((n) => n.group === PORTRAIT_GROUP).map((n) => n.number);
  const has = (n) => numbers.includes(n);
  return {
    numbers,
    applied: !!readSidecar(sffPath),
    suggestion: (has(100) && has(0)) ? { from: 100, to: 0 } : null,
    suggestionBig: (has(101) && has(1)) ? { from: 101, to: 1 } : null,
  };
}

function readSidecar(sffPath) {
  try { return JSON.parse(fs.readFileSync(sidecarPath(sffPath), 'utf8')); }
  catch (e) { return null; }
}

// What group 9000 actually holds, with real geometry. Geometry comes from the
// project's own decoder because SFF v1 keeps width and height in the PCX header
// inside the data block, not in the sprite node.
function inspect(sffPath) {
  const b = fs.readFileSync(sffPath);
  const { version, nodes } = nodeTable(b);
  let sff = null;
  try { sff = sffDecode.readSff(sffPath); } catch (e) { sff = null; }

  const sprites = nodes
    .filter((n) => n.group === PORTRAIT_GROUP)
    .map((n) => {
      const g = geomOf(sff, n.number);
      return {
        group: n.group, index: n.number, fileIdx: n.fileIdx,
        w: g ? g.w : null, h: g ? g.h : null,
      };
    })
    .sort((a, b2) => a.index - b2.index);

  return { sffPath, version, sprites, applied: readSidecar(sffPath) };
}

// AN SFF v1 SPRITE NODE CARRIES NO WIDTH OR HEIGHT. They live in the PCX header
// inside the sprite's own data block, so reading the node gives null and the
// post-write size assertion below would silently skip for every v1 character -
// which is half the characters this feature exists for. spriteGeom reads that
// header (and the v2 node) for us.
function geomOf(sff, index) {
  if (!sff) return null;
  try {
    const g = sffDecode.spriteGeom(sff, PORTRAIT_GROUP, index);
    if (g && Number.isFinite(g.w) && Number.isFinite(g.h)) return { w: g.w, h: g.h };
  } catch (e) { /* fall through to the node */ }
  if (!sff.byKey) return null;
  const rec = sff.byKey.get(PORTRAIT_GROUP + ',' + index);
  if (!rec) return null;
  return { w: rec.w ?? null, h: rec.h ?? null };
}

// Apply a set of {from, to} renumberings within group 9000.
//
// A `to` that is already occupied is PARKED rather than overwritten - the
// displaced art stays in the file at 9000,900+, so nothing is lost and revert
// has something to put back. Parking happens first, so a move onto an occupied
// number never produces a duplicate key even momentarily.
function apply(sffPath, moves) {
  if (!Array.isArray(moves) || !moves.length) throw new Error('nothing to do');
  if (readSidecar(sffPath)) {
    throw new Error('a portrait fix is already applied - revert it first');
  }
  // OTHER TOOLS' BACKUPS ARE A WARNING, NOT A REFUSAL - and that is a
  // deliberate loosening of what this first refused to do.
  //
  // The stacking hazard is real between WHOLE-FILE backups: cvsjill carries four
  // (.palkey.bak, .portrait.bak, .scenesplit.bak, .scenepal.bak), each a
  // snapshot from a different tool at a different moment, and restoring any one
  // discards the other three tools' work. This tool does not participate in
  // that: it records the exact offsets and byte values it wrote, so a later
  // whole-file restore by another tool simply makes its own revert refuse
  // (the bytes will not match) rather than corrupting anything. Blocking the
  // renumber bought no safety and locked out the characters most likely to
  // need it - the heavily edited ones.
  const foreign = ['.orig', '.stagethumb.orig', '.portrait.bak', '.palkey.bak',
    '.scenepal.bak', '.scenesplit.bak']
    .filter((suffix) => fs.existsSync(sffPath + suffix));

  const b = fs.readFileSync(sffPath);
  const { version, nodes } = nodeTable(b);
  const g9 = nodes.filter((n) => n.group === PORTRAIT_GROUP);
  // A PRE-EXISTING DUPLICATE IN GROUP 9000 defeats the whole operation: the
  // engine draws the first node for a key, so moving art onto a number that
  // already appears twice would leave the earlier one shadowing it and the fix
  // would silently do nothing. Refuse rather than produce that.
  {
    const seen = new Set();
    for (const n of g9) {
      const key = PORTRAIT_GROUP + ',' + n.number;
      if (seen.has(key)) {
        throw new Error('this character already has two sprites at ' + key
          + ' - renumbering cannot give a predictable result');
      }
      seen.add(key);
    }
  }
  const byNumber = new Map(g9.map((n) => [n.number, n]));

  let sff = null;
  try { sff = sffDecode.readSff(sffPath); } catch (e) { sff = null; }

  const writes = [];        // {offset, was, now} - `was`/`now` are 2-byte hex
  const plan = [];          // human-readable, returned to the caller
  const used = new Set(g9.map((n) => n.number));

  const write16 = (offset, value, why) => {
    const was = b.toString('hex', offset, offset + 2);
    b.writeUInt16LE(value, offset);
    writes.push({ offset, was, now: b.toString('hex', offset, offset + 2) });
    plan.push(why);
  };

  for (const mv of moves) {
    const from = Number(mv.from), to = Number(mv.to);
    if (!Number.isInteger(from) || !Number.isInteger(to)) throw new Error('bad move');
    const src = byNumber.get(from);
    if (!src) throw new Error('this character has no sprite at ' + PORTRAIT_GROUP + ',' + from);

    const occupant = byNumber.get(to);
    if (occupant && occupant !== src) {
      let park = PARK_BASE;
      while (used.has(park)) park++;
      used.add(park);
      write16(occupant.numberOfs, park,
        'parked ' + PORTRAIT_GROUP + ',' + to + ' at ' + PORTRAIT_GROUP + ',' + park);
      byNumber.delete(to);
      occupant.number = park;
      byNumber.set(park, occupant);
    }
    used.delete(from);
    used.add(to);
    write16(src.numberOfs, to,
      PORTRAIT_GROUP + ',' + from + ' is now ' + PORTRAIT_GROUP + ',' + to);
    byNumber.delete(from);
    src.number = to;
    byNumber.set(to, src);
  }

  // VERIFY BEFORE COMMITTING, against a real re-read rather than the buffer we
  // just edited. A renumber that produced a duplicate key or lost a sprite
  // would be invisible until the engine drew the wrong thing.
  const tmp = sffPath + '.portraitfix.tmp';
  fs.writeFileSync(tmp, b);
  let check;
  try {
    check = sffDecode.readSff(tmp);
    const after = nodeTable(fs.readFileSync(tmp));
    if (after.nodes.length !== nodes.length) throw new Error('sprite count changed');
    // DUPLICATE KEYS ARE NORMAL IN AN SFF and the engine simply takes the first
    // (image.go:1657-1661) - cvsjill ships two 19230,0 nodes and is none the
    // worse for it. So this checks only the group being renumbered, where a
    // duplicate WOULD matter: a second 9000,0 left behind the one we moved
    // would shadow it and the whole edit would look like it did nothing.
    const seen = new Set();
    for (const n of after.nodes) {
      if (n.group !== PORTRAIT_GROUP) continue;
      const key = n.group + ',' + n.number;
      if (seen.has(key)) throw new Error('renumbering produced a duplicate sprite ' + key);
      seen.add(key);
    }
    for (const mv of moves) {
      const want = geomOf(sff, Number(mv.from));
      const got = geomOf(check, Number(mv.to));
      if (want && got && (want.w !== got.w || want.h !== got.h)) {
        const size = got.w + 'x' + got.h, wanted = want.w + 'x' + want.h;
        throw new Error('sprite ' + PORTRAIT_GROUP + ',' + mv.to + ' is ' + size + ', expected ' + wanted);
      }
    }
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch (e2) { /* nothing to clean */ }
    throw new Error('refusing to write: ' + e.message);
  }

  // THE SWAP FIRST, THE RECORD SECOND. A sprite file another program holds open
  // (Fighter Factory) refuses the rename; with the sidecar written before it,
  // the sidecar said "applied" over an unchanged file, and apply ("already
  // applied") and revert ("has changed") then both refused until someone
  // deleted the .bak by hand. A sprite file marked read-only (a copy off a CD)
  // refuses it with the same EPERM and no other program involved, so that one
  // is told apart by its mode.
  try {
    fs.renameSync(tmp, sffPath);
  } catch (e) {
    try { rmFile(tmp); } catch (e2) { /* a temp leftover only */ }
    const held = e && (e.code === 'EPERM' || e.code === 'EBUSY' || e.code === 'EACCES');
    let readOnly = false;
    if (held) try { readOnly = !(fs.statSync(sffPath).mode & 0o200); } catch (e2) { /* say held */ }
    throw new Error(readOnly ? 'the sprite file is marked read-only - clear Read-only in its Properties and try again (nothing was changed)'
      : held ? 'the sprite file is open in another program - close it and try again (nothing was changed)'
        : 'could not replace the sprite file: ' + (e && e.message) + ' (nothing was changed)');
  }
  fs.writeFileSync(sidecarPath(sffPath), JSON.stringify({
    version, moves, writes, plan,
    // The size is a second, cheaper guard than the byte check below. Re-importing
    // a character replaces the .sff wholesale and leaves this sidecar behind; the
    // byte check catches that because the original file has the ORIGINAL values at
    // those offsets, but only if the offsets still land inside the file at all.
    size: b.length,
    at: new Date().toISOString(),
  }, null, 1));
  const warnings = foreign.length ? ['Another tool has a whole-file backup beside this .sff ('
    + foreign.join(', ') + '). Restoring one of those would undo this renumbering, '
    + 'and this revert will then refuse rather than write stale bytes.'] : [];
  return { version, plan, warnings, sprites: inspect(sffPath).sprites };
}

// Put back exactly the bytes that were overwritten, and only if the file still
// holds what was written. A whole-file restore by another tool, a re-import, or
// a hand edit all invalidate this, and quietly stamping old bytes over a
// changed file would corrupt it.
function revert(sffPath) {
  const side = readSidecar(sffPath);
  if (!side) throw new Error('no portrait fix is applied to this character');
  const b = fs.readFileSync(sffPath);
  if (Number.isFinite(side.size) && side.size !== b.length) {
    throw new Error('this .sff is a different size than when the fix was applied '
      + '(was ' + side.size + ', now ' + b.length + ') - it has been replaced, '
      + 'so there is nothing here to revert');
  }
  for (const w of side.writes) {
    if (w.offset + 2 > b.length || b.toString('hex', w.offset, w.offset + 2) !== w.now) {
      throw new Error('this .sff has changed since the fix was applied - '
        + 'refusing to revert rather than risk corrupting it');
    }
  }
  for (const w of side.writes) b.write(w.was, w.offset, 'hex');
  fs.writeFileSync(sffPath, b);
  fs.unlinkSync(sidecarPath(sffPath));
  return { sprites: inspect(sffPath).sprites };
}

// ---- THE CELL PORTRAIT'S AXIS (GRAIL 3.4f) ---------------------------------
//
// The engine draws a select cell portrait with its AXIS on the cell's anchor
// point (start.lua updateDrawList -> batchDraw, anim.go Draw: x = -x +
// scale * axis). The convention every author follows is 9000,0 anchored at
// its top-left corner, axis 0,0: 1,184 of 1,249 sprite files measured on
// this machine, nearly all the rest within a few pixels of it. One file
// breaks it: an edit of ohgaki's Athena ("Pathena", in v1 and in a v2 copy)
// whose 25x25 face is anchored on its BOTTOM edge, axis 0,25, while the
// author's own release carries the same pixels at 0,0. The game draws that
// face a whole cell above her slot, and the lifebar face (fight.def
// p1.face.spr = 9000,0) sits high by the same amount.
//
// THE REPAIR IS TWO int16s IN PLACE, in the copy a build ships: 9000,0's axis
// becomes 0,0. v1 keeps it in the subheader at +8/+10, v2 in the sprite node
// at +8/+10. No pixel, palette, size or other sprite changes, nothing moves,
// and it reverts by writing the old values back.
//
// ONLY A SPRITE THAT MISSES ITS OWN BOX: an axis on or past the far edge (or
// a full sprite-width/height the other way), so not one pixel would land
// where an axis-0,0 sprite would. Small nudges (2,1 on a DBZ pocket set, -2,0
// on 2B) are the authors' and stay: they move a face a pixel or two inside
// its cell. Measured, that rule picks the two Pathena files and nothing else.
//
// NOT when the character's own animation draws 9000,0: there the axis is part
// of a move, and the repairs never change what a fight shows. Pathena's .air
// does not draw it; the guard is for the next file like hers.
const CELL_GROUP = 9000, CELL_INDEX = 0;

function cellAxisOffBox(w, h, axisX, axisY) {
  if (!(w > 0) || !(h > 0)) return false;
  return axisX >= w || axisY >= h || axisX <= -w || axisY <= -h;
}

// Does this .air draw sprite 9000,0 in any frame? (comments stripped)
function airDrawsCell(airText) {
  if (!airText) return false;
  return /^[ \t]*9000[ \t]*,[ \t]*0[ \t]*,/m.test(String(airText).replace(/;[^\r\n]*/g, ''));
}

// A reader over a Buffer, or over an open file (read only what is asked).
function bufReader(b) {
  return { size: b.length, read: (o, n) => (o >= 0 && n >= 0 && o + n <= b.length ? b.subarray(o, o + n) : null) };
}
function fdReader(fd, size) {
  return {
    size,
    read: (o, n) => {
      if (!(o >= 0) || !(n >= 0) || o + n > size) return null;
      const out = Buffer.alloc(n);
      return fs.readSync(fd, out, 0, n, o) === n ? out : null;
    },
  };
}

// THE 9000,0 THE ENGINE DRAWS: the first one in file order (duplicate keys are
// first-wins, image.go), with the size it draws at (a link's source's size,
// its own axis) and where its axis lives. -> null when there is none or the
// file cannot be read that far.
//   { version, fileIdx, axisOfs, w, h, axisX, axisY }
function findCellSprite(rd) {
  const head = rd.read(0, 64);
  if (!head || head.toString('latin1', 0, 11) !== 'ElecbyteSpr') return null;
  const version = head[15];
  if (version === 2) {
    const sprOfs = u32(head, 36), sprNum = u32(head, 40);
    if (!sprNum || sprNum > 0x100000) return null;
    const t = rd.read(sprOfs, sprNum * 28);
    if (!t) return null;
    for (let i = 0; i < sprNum; i++) {
      const o = i * 28;
      if (u16(t, o) !== CELL_GROUP || u16(t, o + 2) !== CELL_INDEX) continue;
      let w = u16(t, o + 4), h = u16(t, o + 6);
      // a link draws its source's pixels at its source's size (shareCopy), with its OWN axis
      const link = u16(t, o + 12);
      if (u32(t, o + 20) === 0 && link < i && u32(t, link * 28 + 20) > 0) { w = u16(t, link * 28 + 4); h = u16(t, link * 28 + 6); }
      return { version, fileIdx: i, axisOfs: sprOfs + o + 8, w, h, axisX: t.readInt16LE(o + 8), axisY: t.readInt16LE(o + 10) };
    }
    return null;
  }
  if (version === 1) {
    const num = u32(head, 20);
    let ofs = u32(head, 24);
    const offs = [];
    for (let i = 0; i < num && ofs > 0; i++) {
      const s = rd.read(ofs, 32);
      if (!s) return null;
      offs.push(ofs);
      if (u16(s, 12) === CELL_GROUP && u16(s, 14) === CELL_INDEX) {
        // v1 keeps the size in the PCX header inside the data; a link (length
        // 0) names an earlier subfile whose data it draws
        let src = i, sh = s;
        for (let hops = 0; u32(sh, 4) === 0 && hops < 8; hops++) {
          const l = u16(sh, 16);
          if (!(l < src)) return null;
          src = l;
          sh = rd.read(offs[src], 32);
          if (!sh) return null;
        }
        if (u32(sh, 4) === 0) return null;
        const pcx = rd.read(offs[src] + 32, 12);
        if (!pcx || pcx[3] !== 8) return null;
        const w = u16(pcx, 8) - u16(pcx, 4) + 1, h = u16(pcx, 10) - u16(pcx, 6) + 1;
        return { version, fileIdx: i, axisOfs: ofs + 8, w, h, axisX: s.readInt16LE(8), axisY: s.readInt16LE(10) };
      }
      const next = u32(s, 0);
      if (next <= ofs) return null;
      ofs = next;
    }
    return null;
  }
  return null;
}

// What a build would do to this file's 9000,0, without changing anything.
// -> null (nothing), or { version, fileIdx, axisOfs, w, h, from: [x, y], to: [0, 0] }
// opts.air: the character's .air text - a cell sprite its own animation draws is kept.
function cellAxisPlan(rd, opts) {
  let c = null;
  try { c = findCellSprite(rd); } catch (e) { c = null; }
  if (!c || !cellAxisOffBox(c.w, c.h, c.axisX, c.axisY)) return null;
  if (opts && airDrawsCell(opts.air)) return null;
  return { version: c.version, fileIdx: c.fileIdx, axisOfs: c.axisOfs, w: c.w, h: c.h, from: [c.axisX, c.axisY], to: [0, 0] };
}

// The shipped copy: a NEW buffer with 9000,0's axis at 0,0, or null when the
// file needs nothing (the input is never modified).
// -> null | { buf, fixes: [{ sprite: '9000,0', version, w, h, from, to }] }
function cellAxisRepair(input, opts) {
  if (!input || input.length < 64) return null;
  const p = cellAxisPlan(bufReader(input), opts);
  if (!p) return null;
  const buf = Buffer.from(input);
  buf.writeInt16LE(0, p.axisOfs);
  buf.writeInt16LE(0, p.axisOfs + 2);
  return { buf, fixes: [{ sprite: CELL_GROUP + ',' + CELL_INDEX, version: p.version, w: p.w, h: p.h, from: p.from, to: p.to }] };
}

// THE GEOMETRY A BUILD SHIPS for a sprite the Studio measured in the
// character's own file, so E-Select and the Theme grid place it where the
// game will: { w, h, axisX, axisY } -> the same object, or a copy at 0,0
// carrying axisFrom.
function shippedCellGeom(group, index, g, airText) {
  if (!g || group !== CELL_GROUP || index !== CELL_INDEX) return g;
  if (!cellAxisOffBox(g.w, g.h, g.axisX, g.axisY) || airDrawsCell(airText)) return g;
  return Object.assign({}, g, { axisX: 0, axisY: 0, axisFrom: [g.axisX, g.axisY] });
}

module.exports = {
  inspect, quickState, apply, revert, PORTRAIT_GROUP, SIDECAR,
  cellAxisOffBox, airDrawsCell, bufReader, fdReader, findCellSprite, cellAxisPlan, cellAxisRepair, shippedCellGeom,
};
