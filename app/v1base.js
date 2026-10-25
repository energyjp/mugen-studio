'use strict';
//
// v1base.js - the shipped copy of an SFF v1 character whose file palette is
// not its pal1: the file's base palette becomes pal1's colors.
//
// THE SELECT SCREEN HOVERS IN THE FILE'S OWN COLORS. start.lua f_animGet
// applies a palette to the face animation only once the member is in
// t_selected; while hovered, the preview is drawn with the palette the sprite
// file carries (preloadSff reads it off the file for 0,0's chain). In a fight
// the pick is applied by remapping, so the file palette is never seen there.
// For a character drawn in its own file nobody notices: authors export pal1
// from the file, the two are the same bytes. For a character that shares a
// generic sprite file - five MK2 ninjas on one male_ninja.sff, three on the
// female one, each with its own .act files - the file's palette is another
// character's costume, and every one of them hovers as Smoke or as Jade until
// picked. MUGEN shows the same still in the same colors; mugenhook hid it.
//
// THE REPAIR WRITES PAL1'S COLORS INTO THE FILE'S BASE PALETTE, in the copy a
// build ships: every own-palette subfile whose palette is byte-identical to
// sprite 0,0's (0,0 itself, the 9000,0 icon that copies it, any other run on
// the same bytes) has its trailing 768 bytes replaced. Pixels are untouched,
// the subfile order is untouched, effects with their own colors are
// untouched, and a fight looks exactly as before because the pick remaps
// those same palettes to the .act anyway. A character whose file palette
// already equals its pal1 - almost every character - ships as it is.
//
// AND, FOR v1 AND v2 ALIKE, A CELL PORTRAIT ANCHORED OFF ITS OWN BOX
// (portraitfix.cellAxisRepair, GRAIL 3.4f): a 9000,0 whose axis sits on or past
// its far edge is drawn a whole cell away from its slot, so the copy ships it
// at axis 0,0 - two int16s, nothing else. It rides here because this is the
// one sprite-file repair both builds already run last, for every character,
// on the final bytes (vfslib.js and desktop.js); it reports as this repair's
// kind, with `axis` listing what moved and `replaced` 0 when no palette did.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const futafix = require('./futafix.js');
const core = require('./public/ikemen/sffdec-core.js');
const portraitfix = require('./portraitfix.js');

// every own-palette subfile with its palette bytes, and sprite 0,0's palette
function analyze(b) {
  const subs = futafix.walkV1(b);
  if (!subs) return null;
  let last = null;
  const heads = [];
  for (let k = 0; k < subs.length; k++) {
    const s = subs[k];
    s.k = k;
    const palSame = b[s.ofs + 18] === 1;
    if (s.len === 0) { s.head = subs[s.link] ? subs[s.link].head : null; continue; }    // a link draws with its source's palette
    if (palSame && k > 0 && last) { s.head = last; continue; }
    // the legacy character path reads the last 768 bytes of the data (first subfile, and 0,0 anywhere);
    // the regular path finds the 0x0C marker from the block end - the same bytes in every real file
    const dataEnd = s.ofs + 32 + s.len;
    s.head = s; s.palAt = dataEnd - 768;
    s.pal = s.palAt >= s.ofs + 32 ? b.subarray(s.palAt, dataEnd) : null;
    heads.push(s); last = s;
  }
  const body = subs.find((s) => s.group === 0 && s.image === 0) || null;
  return { subs, heads, body: body && body.head && body.head.pal ? body.head : null };
}

// pal1: 768 bytes RGB in index order. -> { buf, replaced } or null when nothing differs
function repair(input, pal1) {
  if (!input || input.length < 64 || input[15] !== 1 || !pal1 || pal1.length !== 768) return null;
  const a = analyze(input);
  if (!a || !a.body) return null;
  // 0,0 BORROWING A PORTRAIT'S PALETTE: leave it. Zaiko and Freezer (DBZ) put
  // the big portrait 9000,1 first with its own palette and set 0,0 to "same
  // palette as previous", so the run 0,0 draws from is the portrait's. The
  // portrait was painted for those colors and a fight never remaps it (only
  // 0,0's and 9000,0's palettes are), so writing pal1 there blacked it out on
  // the select screen. The 9000,0 icon owning it is still fine - a fight
  // remaps that one.
  if (a.body.group >= 9000 && a.body.group <= 9999 && !(a.body.group === 9000 && a.body.image === 0)) return null;
  const base = a.body.pal;
  if (Buffer.from(pal1).equals(base)) return null;
  // ONLY THE TWO PALETTES A FIGHT REMAPS ANYWAY - sprite 0,0's, and 9000,0's when
  // it carries the same bytes (char.go remaps exactly those on the (1,1) pick).
  // Any other run on the same bytes keeps them: it is not remapped in a fight,
  // so rewriting it would change what a fight shows, which nothing here may do.
  const icon = a.subs.find((s) => s.group === 9000 && s.image === 0);
  const targets = new Set([a.body]);
  if (icon && icon.head && icon.head.pal && icon.head.pal.equals(base)) targets.add(icon.head);
  const buf = Buffer.from(input);
  let replaced = 0;
  for (const h of targets) { Buffer.from(pal1).copy(buf, h.palAt); replaced++; }
  return { buf, replaced };
}

// the def's pal1, read the way the panel reads it (.act, or a palette PNG)
function pal1Of(charDir, defRel, defText) {
  const m = /^[ \t]*pal1[ \t]*=[ \t]*([^;\r\n]+)/im.exec(defText);
  if (!m) return null;
  const rel = m[1].trim().replace(/"/g, '').replace(/\\/g, '/');
  const base = path.posix.dirname(defRel);
  const hit = futafix.resolveCI(charDir, base === '.' ? rel : base + '/' + rel) || futafix.resolveCI(charDir, rel);
  if (!hit) return null;
  try { return core.readAct(fs.readFileSync(hit.abs)); } catch (e) { return null; }
}

// the def's .air, found (null when it names none or it is not there)
function airAt(charDir, defRel, animRel) {
  if (!animRel) return null;
  const base = path.posix.dirname(defRel);
  return futafix.resolveCI(charDir, base === '.' ? animRel : base + '/' + animRel) || futafix.resolveCI(charDir, animRel);
}
// the def's .air as text (null when it names none or it cannot be read)
function airOf(charDir, defRel, animRel) {
  const hit = airAt(charDir, defRel, animRel);
  if (!hit) return null;
  try { return fs.readFileSync(hit.abs, 'latin1'); } catch (e) { return null; }
}

// NOTHING TO DO, REMEMBERED. Every build asks this of every character, and for
// a v1 file with a pal1 the answer needs the whole sprite file - 40 of 48 times
// on Main to learn that its base palette already is its pal1 (130-290 MB a
// build). A null answer is kept per def and sprite file under a stamp of
// everything it was made from: the def's text (as given, or as read), the
// sprite file's and the .air's path, size and time, and pal1's own bytes (read
// every time, they are 768). Only nulls, so no buffer is ever held; never
// with opts.input (an earlier repair's bytes, not a file); and never when a
// read along the way failed, which would have answered null for that reason.
const NULLS = new Map();
const NULLS_MAX = 20000;
function nullStamp(charDir, def, defText, sprite, pal1, animRel) {
  try {
    const at = (abs) => { const st = fs.statSync(abs); return abs + ':' + st.size + ':' + st.mtimeMs; };
    const air = airAt(charDir, def.rel, animRel);
    return crypto.createHash('sha1').update([at(sprite.abs), air ? at(air.abs) : '-', pal1 ? Buffer.from(pal1).toString('base64') : '-', defText].join('\0'), 'latin1').digest('base64');
  } catch (e) { return null; }
}
const keepNull = (key, stamp) => { if (NULLS.size >= NULLS_MAX) NULLS.clear(); NULLS.set(key, stamp); };

// -> null, or { spriteRel, spriteAbs, buf, replaced, axis }; opts.input = the sprite file as an earlier repair left it.
// replaced: palettes written (0 when only the axis moved); axis: [{ sprite, version, w, h, from, to }] ([] when none).
function repairFor(charDir, defName, opts) {
  const def = futafix.resolveCI(charDir, defName);
  if (!def) return null;
  // opts.defText: the def as the repairs before this one left it (the web
  // build's palette order rewrites it in memory; read from disk, its old pal1
  // was the base palette the web shipped while the desktop, which writes the
  // def first, shipped the new one).
  let defText = opts && typeof opts.defText === 'string' ? opts.defText : null;
  if (defText === null) { try { defText = fs.readFileSync(def.abs, 'latin1'); } catch (e) { return null; } }
  const files = futafix.defSpriteAndAnim(defText);
  if (!files.sprite) return null;
  const base = path.posix.dirname(def.rel);
  const under = (rel) => (base === '.' ? rel : base + '/' + rel);
  const sprite = futafix.resolveCI(charDir, under(files.sprite)) || futafix.resolveCI(charDir, files.sprite);
  if (!sprite) return null;
  const pal1 = pal1Of(charDir, def.rel, defText);
  // The cell portrait's axis moves only when its own animation does not draw it;
  // the .air is read only for a file whose 9000,0 would move (two in 1,249).
  let air;
  const axisWanted = (plan) => !!plan && !portraitfix.airDrawsCell(air === undefined ? (air = airOf(charDir, def.rel, files.anim)) : air);
  let input = opts && opts.input;
  const memo = input ? null : def.abs + '>' + sprite.abs;
  const stamp = memo ? nullStamp(charDir, def, defText, sprite, pal1, files.anim) : null;
  if (stamp && NULLS.get(memo) === stamp) return null;
  let clean = true;
  if (!input) {
    // THE HEADERS FIRST: every build calls this for every character, and most of
    // them are SFF v2, which repair() turns away on byte 15 anyway. Reading the
    // whole file only to learn that cost a full read of every sprite file. The
    // axis check reads the sprite table (v2) or walks subheaders up to 9000,0
    // (v1), so a file that needs nothing is still never read whole.
    let fd = null, need = false;
    try {
      fd = fs.openSync(sprite.abs, 'r');
      const h = Buffer.alloc(16);
      fs.readSync(fd, h, 0, 16, 0);
      const rd = portraitfix.fdReader(fd, fs.fstatSync(fd).size);
      // (a read inside the file's size that comes back short, or throws, is a
      // failure the plan below swallows as "nothing to move": not remembered)
      const watched = { size: rd.size, read: (o, n) => {
        let b;
        try { b = rd.read(o, n); } catch (e) { clean = false; throw e; }
        if (b === null && o >= 0 && n >= 0 && o + n <= rd.size) clean = false;
        return b;
      } };
      need = (h[15] === 1 && !!pal1) || axisWanted(portraitfix.cellAxisPlan(watched));
    } catch (e) { need = false; clean = false; } finally { if (fd !== null) try { fs.closeSync(fd); } catch (e) { /* already gone */ } }
    if (!need) { if (stamp && clean) keepNull(memo, stamp); return null; }
    try { input = fs.readFileSync(sprite.abs); } catch (e) { return null; }
  }
  const r = pal1 ? repair(input, pal1) : null;
  // the two edits touch different bytes (palette blocks vs. one header), so their order does not matter
  let ax = null;
  try {
    const onto = r ? r.buf : input;
    ax = axisWanted(portraitfix.cellAxisPlan(portraitfix.bufReader(onto))) ? portraitfix.cellAxisRepair(onto) : null;
  } catch (e) { ax = null; clean = false; }
  if (!r && !ax) { if (stamp && clean) keepNull(memo, stamp); return null; }
  return {
    spriteRel: sprite.rel, spriteAbs: sprite.abs,
    buf: ax ? ax.buf : r.buf,
    replaced: r ? r.replaced : 0,
    axis: ax ? ax.fixes : [],
  };
}

// The .air the cell-portrait guard reads, found the way repairFor finds it (the
// def resolved case-insensitively, its anim line, the def's own folder first),
// so the Studio's views (modlib.shippedCellGeomFor) decide exactly as the builds.
function cellAirFor(charDir, defName) {
  const def = futafix.resolveCI(charDir, defName);
  if (!def) return null;
  let defText;
  try { defText = fs.readFileSync(def.abs, 'latin1'); } catch (e) { return null; }
  return airOf(charDir, def.rel, futafix.defSpriteAndAnim(defText).anim);
}

module.exports = { analyze, repair, repairFor, cellAirFor };
