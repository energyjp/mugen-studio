// SFF decoding - the pure-bytes core, shared by the desktop Studio (via
// ../../tools/sff-decode.js) and the in-browser Mod Studio Lite.
//
// ONE implementation on purpose. Node's Buffer extends Uint8Array, so the
// desktop side passes its Buffers straight in and both runtimes execute the
// same code. Two copies of this would drift, and these functions carry edge
// cases that were expensive to find: the v1 portrait-vs-fight palette split
// (RyuDX rendered as noise without it), the fmt-10 SFF-palette substitution
// (dr_kira rendered as a black silhouette without it), samePal-at-+18, and the
// block-confined 0x0C backward scan.
//
// Ported from the Node original by script, bodies otherwise untouched, and
// verified by byte-comparing every extracted PNG before and after.
//
// Pure: no fs, no path, no DOM. Never mutates the caller's bytes.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.sffdecCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Buffer's read*LE helpers, over any Uint8Array. A fresh DataView per call is
  // cheap next to the decode loops and avoids caching a stale view.
  const dvOf = (b) => new DataView(b.buffer, b.byteOffset, b.byteLength);
  const u32 = (b, o) => dvOf(b).getUint32(o, true);
  const u16 = (b, o) => dvOf(b).getUint16(o, true);
  const i16 = (b, o) => dvOf(b).getInt16(o, true);
  const ascii = (b, a, c) => {
    let s = '';
    for (let i = a; i < c && i < b.length; i++) s += String.fromCharCode(b[i]);
    return s;
  };
  // Buffer.prototype.indexOf over a short literal; only used for 'IEND'.
  const findSeq = (b, seq) => {
    outer: for (let i = b.length - seq.length; i >= 0; i--) {
      for (let k = 0; k < seq.length; k++) if (b[i + k] !== seq[k]) continue outer;
      return i;
    }
    return -1;
  };

  // ---------------------------------------------------------------------------
  // Pixel decoders, ported from src/image.go. Each takes the raw compressed
  // bytes and the target w*h and returns one palette index per pixel. The
  // odd-looking "advance only while not at the last byte" guards are faithful
  // to the engine: truncated/!malformed sprites must degrade, not throw.

  function rle8Decode(rle, size) {
    const p = new Uint8Array(size);
    if (!rle.length) return p;
    let i = 0, j = 0;
    while (j < size) {
      let n = 1, d = rle[i];
      if (i < rle.length - 1) i++;
      if ((d & 0xc0) === 0x40) {
        n = d & 0x3f;
        d = rle[i];
        if (i < rle.length - 1) i++;
      }
      for (; n > 0; n--) if (j < size) p[j++] = d;
    }
    return p;
  }

  function rle5Decode(rle, size) {
    const p = new Uint8Array(size);
    if (!rle.length) return p;
    let i = 0, j = 0;
    while (j < size) {
      let rl = rle[i];
      if (i < rle.length - 1) i++;
      let dl = rle[i] & 0x7f;
      let c = 0;
      if (rle[i] >> 7 !== 0) {
        if (i < rle.length - 1) i++;
        c = rle[i];
      }
      if (i < rle.length - 1) i++;
      for (;;) {
        if (j < size) p[j++] = c;
        rl--;
        if (rl < 0) {
          dl--;
          if (dl < 0) break;
          c = rle[i] & 0x1f;
          rl = rle[i] >> 5;
          if (i < rle.length - 1) i++;
        }
      }
    }
    return p;
  }

  function lz5Decode(rle, size) {
    const p = new Uint8Array(size);
    if (!rle.length) return p;
    let i = 0, j = 0, n = 0;
    let ct = rle[i], cts = 0, rb = 0, rbc = 0;
    if (i < rle.length - 1) i++;
    while (j < size) {
      let d = rle[i];
      if (i < rle.length - 1) i++;
      if (ct & (1 << cts)) {
        if ((d & 0x3f) === 0) {
          d = ((d << 2) | rle[i]) + 1;
          if (i < rle.length - 1) i++;
          n = rle[i] + 2;
          if (i < rle.length - 1) i++;
        } else {
          rb |= (d & 0xc0) >> rbc;
          rbc += 2;
          n = d & 0x3f;
          if (rbc < 8) {
            d = rle[i] + 1;
            if (i < rle.length - 1) i++;
          } else {
            d = rb + 1;
            rb = 0; rbc = 0;
          }
        }
        for (;;) {
          if (j < size) { p[j] = p[j - d]; j++; }
          n--;
          if (n < 0) break;
        }
      } else {
        if ((d & 0xe0) === 0) {
          n = rle[i] + 8;
          if (i < rle.length - 1) i++;
        } else {
          n = d >> 5;
          d &= 0x1f;
        }
        for (; n > 0; n--) if (j < size) p[j++] = d;
      }
      cts++;
      if (cts >= 8) {
        ct = rle[i]; cts = 0;
        if (i < rle.length - 1) i++;
      }
    }
    return p;
  }

  // PCX runs are per-SCANLINE: bytesPerLine can exceed the visible width, and
  // the surplus is padding that must be dropped (the `k === bpl` reset).
  function rlePcxDecode(rle, w, h, bpl) {
    const size = w * h;
    const p = new Uint8Array(size);
    if (!rle.length || bpl <= 0) return p;
    let i = 0, j = 0, k = 0;
    while (j < size) {
      let n = 1, d = rle[i];
      if (i < rle.length - 1) i++;
      if (d >= 0xc0) {
        n = d & 0x3f;
        d = rle[i];
        if (i < rle.length - 1) i++;
      }
      for (; n > 0; n--) {
        if (k < w && j < size) p[j++] = d;
        k++;
        if (k === bpl) { k = 0; n = 1; }
      }
    }
    return p;
  }

  // ---------------------------------------------------------------------------
  // SFF v2

  function readSff(b) {
    if (b.length < 64 || ascii(b, 0, 11) !== 'ElecbyteSpr') return null;
    const version = b[15];
    const byKey = new Map();

    if (version === 2) {
      const sprOfs = u32(b, 36);
      const sprNum = u32(b, 40);
      const palOfs = u32(b, 44);
      const palNum = u32(b, 48);
      const lofs = u32(b, 52);
      const tofs = u32(b, 60);
      // Records in FILE ORDER, because a LINKED sprite names its source by
      // index into this list.
      const order = [];
      for (let i = 0; i < sprNum; i++) {
        const o = sprOfs + i * 28;
        if (o + 28 > b.length) break;
        const key = u16(b, o) + ',' + u16(b, o + 2);
        const rec = {
            w: u16(b, o + 4),
            h: u16(b, o + 6),
            // The AXIS is the character's origin within the sprite. Frames of
            // an animation have different sizes and different axes; aligning
            // them by axis is what stops the pose jittering as it plays.
            axisX: i16(b, o + 8),
            axisY: i16(b, o + 10),
            linked: u16(b, o + 12),
            fmt: b[o + 14],
            dataOfs: u32(b, o + 16),
            dataLen: u32(b, o + 20),
            palIdx: u16(b, o + 24),
            flags: u16(b, o + 26),
        };
        // A ZERO-LENGTH v2 sprite carries no pixels of its own: it reuses an
        // earlier sprite's, named by the `linked` index. The engine resolves
        // this before any format dispatch (image.go:1626, `if size == 0 {
        // dst.shareCopy(src) }`), and the v1 branch below has always done the
        // same - but the v2 branch did not, so such a sprite fell through to
        // the fmt-0 "raw 8bpp" path and produced an EMPTY pixel buffer while
        // still reporting its real w/h. cvsjill is SFF v2 and every one of her
        // 66 non-PNG sprites is one of these; one is frame 7 of her stance,
        // which is the frame that rendered as green/magenta noise.
        //
        // Copy the pixel SOURCE (fmt, offset, length, flags, size) but keep
        // this record's OWN palette and axis: shareCopy never touches Offset,
        // and readHeaderV2 always assigns a palidx so its `if palidx < 0`
        // branch never fires. Seven of cvsjill's links carry palIdx 2 while
        // their target carries 119 - taking the target's would recolor them.
        if (rec.dataLen === 0) {
          const src = order[rec.linked];
          if (src && rec.linked < i && src.dataLen > 0) {
            rec.fmt = src.fmt;
            rec.dataOfs = src.dataOfs;
            rec.dataLen = src.dataLen;
            rec.flags = src.flags;
            rec.w = src.w;
            rec.h = src.h;
            rec.linkedFrom = rec.linked;
          } else {
            // Out-of-range or forward link: the engine leaves the sprite with
            // no pixels (image.go:1639). Mark it so decodeSprite returns null
            // rather than inventing something.
            rec.unresolved = true;
          }
        }
        order.push(rec);
        if (!byKey.has(key)) byKey.set(key, rec);
      }
      // PALETTE ALPHA. The header's version bytes are verlo3, verlo2, verlo1,
      // verhi at 12..15 (image.go:1561-1575), and the engine keeps the 4th
      // byte of every palette entry as that color's alpha unless verlo2 is 0
      // (Sff.ReadPalette, image.go:2261-2267: "Version 2.0.0.0 only"). So a
      // v2.00 file draws index 0 transparent and everything else opaque, and
      // a v2.01 file draws each color with its stored alpha - Dr.Kira's body
      // palette holds entries at 128 and 200, drawn half see-through in game.
      // Only true when set, so a hand-built sff object without it keeps the
      // v2.00 rule.
      const palAlpha = b[13] !== 0;
      return { version, buf: b, lofs, tofs, palOfs, palNum, byKey, palAlpha };
    }

    if (version === 1) {
      // v1: a linked list of subfiles, each a headerless PCX + optional
      // 768-byte palette. Header: count at 20, first offset at 24.
      //
      // palIdx mirrors the engine's PaletteList numbering: a sprite that OWNS
      // a palette (samePal=0) mints the next physical index; samePal=1
      // inherits the previous sprite's. This matters because at character
      // load the engine REMAPS physical palette 0 - the shared body palette -
      // to the def's pal1 .act (char.go loadPalettes, SFFv1 branch). Sprites
      // on private palettes (portraits) are untouched. RyuDX's embedded
      // shared palette is a junk placeholder, so extracting with it painted
      // the whole body in noise; his real colors only exist in the act.
      const sprNum = u32(b, 20);
      let ofs = u32(b, 24);
      let prev = null;
      let nextPal = 0;
      // Sprites in file order: a linked sprite refers to one by INDEX, so the
      // ordered list has to exist alongside the group,index map.
      const order = [];
      for (let n = 0; n < sprNum && ofs > 0 && ofs + 32 <= b.length; n++) {
        const next = u32(b, ofs);
        const len = u32(b, ofs + 4);
        const g = u16(b, ofs + 12);
        const i = u16(b, ofs + 14);
        // The "palette same as previous" flag lives at +18, NOT +16. Offset
        // 16 is the uint16 "index of previous copy" used for linked sprites, so
        // reading +16 was reading that field's LOW BYTE - which is 0 for any
        // unlinked sprite, i.e. almost all of them.
        //
        // Engine parity, image.go: readHeader() consumes
        //   +0 next  +4 size  +8 axis[2]  +12 group  +14 number  +16 link
        // and Sprite.read() then reads the NEXT byte as `ps`, so the flag is +18.
        //
        // Getting this wrong made every v1 sprite look like it owned its palette,
        // which sent all of them down the 0x0C backward scan. That scan searches
        // COMPRESSED data, so it regularly matched a stray 0x0C thousands of
        // bytes early, truncated the RLE, and the decoder then filled the rest of
        // the image with one repeated index - the solid color blocks. The engine
        // never saw this because a palette-sharing sprite takes
        // `paletteOffset = blockEnd` and gets its full data. Measured on one
        // 2432-sprite v1 character: 2295 sprites classified wrongly.
        const samePal = b[ofs + 18] !== 0 && prev !== null;
        const dataStart = ofs + 32;
        const blockEnd = next > ofs ? next : dataStart + len;
        // v1 subheader carries the axis at the same offsets as v2 (+8/+10).
        const rec = {
          v1: true, dataStart, blockEnd, samePal, prev,
          palIdx: samePal && prev ? prev.palIdx : nextPal++,
          axisX: i16(b, ofs + 8),
          axisY: i16(b, ofs + 10),
        };
        // LINKED SPRITE. A zero-length subfile carries no image of its own: it
        // reuses an earlier sprite's pixels, named by the uint16 at +16. The
        // engine does this with shareCopy() (image.go, the `if size == 0` branch
        // that runs before Sprite.read is ever called).
        //
        // Without this the extractor tried to parse a PCX header at an address
        // that holds no PCX, got nonsense dimensions, and returned null - which
        // is how a character whose big portrait (9000,1) happens to be a link
        // produced NO portrait, no manifest entry, and an empty output folder.
        const linkIdx = u16(b, ofs + 16);
        if (len === 0 && linkIdx < order.length) {
          const src = order[linkIdx];
          if (src) {
            rec.dataStart = src.dataStart;
            rec.blockEnd = src.blockEnd;
            rec.samePal = src.samePal;
            rec.prev = src.prev;
            rec.palIdx = src.palIdx;
            rec.linkedFrom = linkIdx;
          }
        }
        order.push(rec);
        const key = g + ',' + i;
        if (!byKey.has(key)) byKey.set(key, rec);
        prev = rec;
        if (!next || next <= ofs) break;
        ofs = next;
      }
      return { version, buf: b, byKey };
    }

    return { version, byKey: null };
  }

  // The 256-entry RGB palette for a v2 sprite (from the shared palette table).
  //
  // A palette node with dataLen == 0 is a LINK to another palette (field at
  // +6), exactly like a linked sprite - characters share one palette across
  // hundreds of sprites this way. Treating a zero length as "no data" yields an
  // all-black table and renders the character as a silhouette (field-hit:
  // donghwan, whose 9000,1 points at a linked node).
  function v2Palette(sff, s) {
    return v2PaletteAt(sff, s.palIdx);
  }

  // The same read, addressed by palette index rather than by sprite: the
  // selectable palettes in the table belong to no sprite at all.
  function v2PaletteAt(sff, palIdx) {
    const pal = new Uint8Array(768);
    if (!sff.palNum || !(palIdx >= 0) || palIdx >= sff.palNum) return pal;

    const { start, count } = v2PaletteNode(sff, palIdx);
    for (let i = 0; i < count; i++) {
      const p = start + i * 4;
      if (p + 2 >= sff.buf.length) break;
      pal[i * 3] = sff.buf[p];
      pal[i * 3 + 1] = sff.buf[p + 1];
      pal[i * 3 + 2] = sff.buf[p + 2];
    }
    return pal;
  }

  // Where a palette node's entries live, following links. Shared by the RGB
  // and the alpha reads so the two always come from the same node.
  function v2PaletteNode(sff, palIdx) {
    let idx = palIdx;
    let dataOfs = 0, dataLen = 0;
    for (let hop = 0; hop < 8; hop++) {
      const o = sff.palOfs + idx * 16;
      dataOfs = u32(sff.buf, o + 8);
      dataLen = u32(sff.buf, o + 12);
      if (dataLen > 0) break;
      const linked = u16(sff.buf, o + 6);
      if (linked === idx || linked >= sff.palNum) break; // self/invalid: stop
      idx = linked;
    }

    // v2 palettes are 256 RGBA32 entries stored after ldataOfs. If the chain
    // ended without a length (malformed, or a link loop), read the table at
    // the offset we landed on anyway - the bytes are usually still there, and
    // a plausible palette beats a black rectangle.
    const start = sff.lofs + dataOfs;
    const count = dataLen > 0 ? Math.min(256, Math.floor(dataLen / 4)) : 256;
    return { start, count };
  }

  // The ALPHA of each entry of a v2 palette node, as the engine's palette
  // texture holds it: a Uint8Array(256), or null when the node cannot be read
  // (the RGB read above then gives black, and inventing transparency on top of
  // that would only hide the problem).
  //
  // Engine, Sff.ReadPalette (image.go:2220-2270):
  //   - the node is sized max(16, nextpow2(entries)), at most 256;
  //   - v2.01 (verlo2 != 0): each stored entry's 4th byte is its alpha, and the
  //     entries between the stored count and that size read as 0 - transparent;
  //   - v2.00: alpha forced, index 0 = 0 and every other entry of that size 255
  //     (padding included - opaque black).
  // Past the node's size the texture is padded to 256 entries with zeros
  // (image.go:598-603), so those indices are transparent in every version.
  //
  // Index 0 included: the shader never keys it out (a character anim draws
  // with mask 0, anim.go:295, and only mask -1 touches alpha), so index 0 is
  // transparent only because its entry says so. Every character palette
  // measured stores 0 there; a few screenpack palettes store an opaque color
  // at 0 and a transparent one elsewhere (Infinite Legacy X's fight.sff draws
  // its FIGHT banner that way), and the engine draws them as stored.
  function v2PaletteAlphaAt(sff, palIdx) {
    if (!sff || !sff.palNum || !(palIdx >= 0) || palIdx >= sff.palNum) return null;
    const { start, count } = v2PaletteNode(sff, palIdx);
    let size = 1;
    while (size < count) size *= 2;
    size = Math.max(16, Math.min(256, size));
    const a = new Uint8Array(256);
    for (let i = 0; i < size; i++) {
      if (!sff.palAlpha) { a[i] = i === 0 ? 0 : 255; continue; }
      const p = start + i * 4 + 3;
      a[i] = i < count && p < sff.buf.length ? sff.buf[p] : 0;
    }
    return a;
  }

  // The alpha table a decoded sprite must carry, or null when it draws the way
  // it always has (index 0 transparent, every other index opaque).
  //
  // Only the palette the SFF itself supplies has an alpha of its own: SFF v1
  // PCX palettes, .act files and PNG palettes all load as index 0 = 0 and the
  // rest 255 (image.go:1164-1168, 713-716, 649-652), and so do the Studio's
  // custom slots. So a sprite drawn with sff.palOverride gets no table, unless
  // the caller also sets sff.palOverrideAlpha - the one case where a pick has
  // an alpha is a pick of another of this file's own v2.01 nodes, because the
  // engine's remapPal swaps the whole palette texture, alpha included.
  //
  // A table that says exactly that - index 0 = 0 and 1..255 all 255 - is
  // reported as null: then the sprite's PNG is byte-for-byte what it always
  // was.
  function spriteAlpha(sff, s) {
    let a = null;
    if (sff.palOverride) a = sff.palOverrideAlpha || null;
    else if (sff.palAlpha) a = v2PaletteAlphaAt(sff, s.palIdx);
    if (!a) return null;
    if (a[0] !== 0) return a;
    for (let i = 1; i < 256; i++) if (a[i] !== 255) return a;
    return null;
  }

  // THE ENGINE'S SPRITE LOOKUP FOR AN .AIR ELEMENT. Group and number are read
  // as int32 (anim.go:66-67 through Atoi, which clamps to the int32 range,
  // common.go:212-241). When the element is shown, a group or number of
  // exactly -1 means "no sprite" and anything else is CAST TO UINT16
  // (anim.go:700-702: "Mugen only nulls out -1, other negatives wrap around"),
  // so group -2 is sprite group 65534. Sff.GetSprite then refuses group 65535
  // (image.go:2318-2321), which also catches a literal 65535 or 2147483647.
  //
  // Returns { group, index, key } with both numbers in 0..65535 and key in the
  // "group,index" form readSff's byKey uses - or null when the engine draws no
  // sprite at all. For .air lookups only: a sprite actually stored as 65535,n
  // is still a sprite of the file, and decodeSprite still returns it.
  function spriteKey(group, number) {
    const int32 = (v) => {
      const n = Math.trunc(Number(v));
      if (Number.isNaN(n)) return NaN;
      return Math.max(-2147483648, Math.min(2147483647, n));
    };
    const g = int32(group), n = int32(number);
    if (Number.isNaN(g) || Number.isNaN(n)) return null;
    if (g === -1 || n === -1) return null;
    const g16 = g & 0xffff, n16 = n & 0xffff;
    if (g16 === 0xffff) return null;
    return { group: g16, index: n16, key: g16 + ',' + n16 };
  }

  // A MUGEN .act palette: 256 RGB triples assigned in REVERSE (the file's
  // first triple is color index 255 - image.go readActPalette does the same).
  // Returns a 768-byte RGB table, or null.
  // A PNG's PLTE chunk, in NATURAL order - unlike .act, which is reversed.
  function pltePalette(raw) {
    let o = 8;
    while (o + 8 <= raw.length) {
      const len = ((raw[o] << 24) | (raw[o + 1] << 16) | (raw[o + 2] << 8) | raw[o + 3]) >>> 0;
      const type = String.fromCharCode(raw[o + 4], raw[o + 5], raw[o + 6], raw[o + 7]);
      if (type === 'PLTE') {
        const pal = new Uint8Array(768);
        const n = Math.min(256, Math.floor(len / 3));
        for (let i = 0; i < n; i++) {
          pal[i * 3] = raw[o + 8 + i * 3];
          pal[i * 3 + 1] = raw[o + 8 + i * 3 + 1];
          pal[i * 3 + 2] = raw[o + 8 + i * 3 + 2];
        }
        return pal;
      }
      if (type === 'IDAT' || type === 'IEND') break;
      o += 12 + len;
    }
    return null;
  }

  function readAct(raw) {
    if (!raw) return null;
    if (raw.length < 3) return null;
    // A character may legitimately declare palN as a PNG rather than an .act -
    // dr_kira ships eight of them. Real MUGEN reads both.
    if (raw.length > 8 && raw[0] === 0x89 && raw[1] === 0x50
        && raw[2] === 0x4e && raw[3] === 0x47) {
      return pltePalette(raw);
    }
    const pal = new Uint8Array(768);
    const count = Math.min(256, Math.floor(raw.length / 3));
    for (let i = 0; i < count; i++) {
      const dest = 255 - i;
      pal[dest * 3] = raw[i * 3];
      pal[dest * 3 + 1] = raw[i * 3 + 1];
      pal[dest * 3 + 2] = raw[i * 3 + 2];
    }
    return pal;
  }

  // A v1 subfile's PCX header gives the real dimensions and bytes-per-line;
  // its palette is the last 769 bytes of the block (marker 0x0C then 768 RGB).
  function v1Sprite(sff, rec) {
    const b = sff.buf;
    const o = rec.dataStart;
    if (b[o + 3] !== 8) return null; // bpp must be 8
    const xmin = u16(b, o + 4), ymin = u16(b, o + 6);
    const xmax = u16(b, o + 8), ymax = u16(b, o + 10);
    const w = xmax - xmin + 1, h = ymax - ymin + 1;
    const bpl = u16(b, o + 66);
    if (w <= 0 || h <= 0 || w > 4096 || h > 4096) return null;
    const pcxData = o + 128;

    // Palette and RLE extent. These are two DIFFERENT questions and the engine
    // answers them separately (image.go Sprite.read); conflating them is what
    // produced blank sprites once the samePal flag started being read correctly.
    //
    //   samePal  -> the palette is inherited from an earlier subfile, and the
    //               engine sets paletteOffset = blockEnd, i.e. the RLE runs to
    //               the END of this block. There is no marker to look for here.
    //   own pal  -> the palette lives at the tail of THIS block, so scan back
    //               for the 0x0C marker and stop the RLE just before it.
    //
    // The scan must only ever look inside the sprite's OWN block. Pointing `end`
    // at a marker found in an ancestor gives a negative-length slice, which
    // decodes to an empty (invisible) sprite.
    const findPalIn = (r) => {
      const scanStart = r.blockEnd - 769;
      for (let p = scanStart; p >= r.dataStart + 128; p--) {
        if (b[p] === 0x0c) return p + 1;
      }
      // No marker: per the PCX layout the palette is simply the last 768 bytes.
      return scanStart > 0 ? scanStart + 1 : -1;
    };

    let palAt = -1;
    let end;
    if (rec.samePal && rec.prev) {
      let owner = rec;
      while (owner && owner.samePal && owner.prev) owner = owner.prev;
      palAt = owner ? findPalIn(owner) : -1;
      end = rec.blockEnd;           // engine: paletteOffset = blockEnd
    } else {
      palAt = findPalIn(rec);
      end = palAt > 0 ? palAt - 1 : rec.blockEnd;
    }

    const pal = new Uint8Array(768);
    if (palAt > 0 && palAt + 768 <= b.length) pal.set(b.subarray(palAt, palAt + 768), 0);

    const px = rlePcxDecode(b.subarray(pcxData, end), w, h, bpl);
    return { px, w, h, pal };
  }

  // Geometry (size + axis) for a sprite, without decoding it.
  function spriteGeom(sff, group, index) {
    if (!sff || !sff.byKey) return null;
    const s = sff.byKey.get(group + ',' + index);
    if (!s) return null;
    if (s.v1) {
      const b = sff.buf, o = s.dataStart;
      if (b[o + 3] !== 8) return null;
      return {
        w: u16(b, o + 8) - u16(b, o + 4) + 1,
        h: u16(b, o + 10) - u16(b, o + 6) + 1,
        axisX: s.axisX, axisY: s.axisY,
      };
    }
    return { w: s.w, h: s.h, axisX: s.axisX, axisY: s.axisY };
  }

  // First [<want>] section only, comments stripped at ';', keys lowercased,
  // FIRST occurrence of a duplicate key wins - the engine's own ini rules
  // (common.go:1002-1021, and system.go:5334 gates [Info] to the first one).
  function sectionOf(txt, want) {
    const out = {};
    let inSec = false, done = false;
    for (const raw of String(txt || '').split(/\r?\n/)) {
      const line = raw.replace(/;.*$/, '').trim();
      if (/^\[/.test(line)) {
        if (inSec) { done = true; }
        inSec = !done && line.toLowerCase() === '[' + want.toLowerCase() + ']';
        continue;
      }
      if (!inSec || !line) continue;
      const m = line.match(/^([^=]+?)\s*=\s*(.*)$/);
      if (m && !(m[1].trim().toLowerCase() in out)) {
        out[m[1].trim().toLowerCase()] = m[2].trim();
      }
    }
    return out;
  }

  function parseDef(txt) {
    const out = { name: '', displayname: '', sprite: '', anim: '' };
    const grab = (key) => {
      const m = new RegExp('^\\s*' + key + '\\s*=\\s*([^\\r\\n;]*)', 'mi').exec(txt);
      return m ? m[1].trim() : '';
    };
    out.name = grab('name').replace(/^"|"$/g, '');
    out.displayname = grab('displayname').replace(/^"|"$/g, '') || out.name;
    // AUTHOR is display metadata, not engine data, but it is the field that
    // tells two builds of the same character apart in a roster list - and a
    // roster routinely holds three Makotos by three authors.
    out.author = grab('author').replace(/^"|"$/g, '');
    // COORDINATE SPACE. A character is authored in some coordinate space and
    // the engine rescales it into the motif's. Three independent terms decide
    // the size, and reading none of them is why hi-res characters drew four
    // times too large on the select screen:
    //   localcoord    [Info], default 320. Only the X value is ever used.
    //   portraitscale [Info], default 1. NOT derived from localcoord here -
    //                 that derivation (char.go:3807) is the in-game path;
    //                 the select screen reads the key literally
    //                 (system.go:5346-5350).
    //   cns           [Files], names the file holding [Size] xscale/yscale.
    // grab() is a whole-file regex, so these are read section-scoped: a
    // `localcoord` inside a stage or AI block would otherwise win.
    const info = sectionOf(txt, 'Info');
    const files = sectionOf(txt, 'Files');
    out.localcoord = parseInt(String(info.localcoord || '').split(',')[0], 10) || 320;
    out.portraitscale = parseFloat(info.portraitscale) || 1;
    out.cns = files.cns || '';
    out.sprite = grab('sprite');
    out.anim = grab('anim');
    out.pal1 = grab('pal1');
    // Every palN, plus the pal.defaults ORDER. The default color a character
    // appears in is pal.defaults[0], NOT pal1 - see defaultActName below.
    out.pals = {};
    for (let n = 1; n <= 12; n++) {
      const v = grab('pal' + n);
      if (v) out.pals[n] = v;
    }
    out.palDefaults = grab('pal.defaults')
      .split(',')
      .map((x) => parseInt(x, 10))
      .filter((x) => Number.isFinite(x));
    // pal.keymap REMAPS THE BUTTONS. What a player gets pressing button n is
    // pal.keymap[n], falling back to n itself (start.lua:516) - so button 1
    // means pal1 unless the character says otherwise. This is a different thing
    // from pal.defaults, which the engine consults only for AI and no-input
    // selection (start.lua:608-613), and confusing the two is why the panel
    // called pal4 "default" for a character a player always sees in pal1.
    out.palKeymap = {};
    for (let n = 1; n <= 12; n++) {
      const v = parseInt(grab('pal.keymap' + n) || grab('pal.keymap[' + n + ']'), 10);
      if (Number.isFinite(v)) out.palKeymap[n] = v;
    }
    return out;
  }

  // What a sprite decodes to, without committing to an output format.
  //   { kind: 'indexed', w, h, px, pal }  - indices + RGB palette
  //   { kind: 'png',     bytes, pal }     - an embedded PNG; pal non-null when
  //                                         the SFF palette must replace the
  //                                         PNG's own (fmt 10)
  // Either may also carry `alpha`, a Uint8Array(256) of per-entry alpha, when
  // the palette drawing it has an alpha of its own (an SFF v2.01 node;
  // spriteAlpha above). Absent means index 0 transparent and every other
  // index opaque.
  // Node turns these into PNG files; the browser turns them into ImageData.
  function decodeSprite(sff, group, index) {
    if (!sff || !sff.byKey) return null;
    const s = sff.byKey.get(group + ',' + index);
    if (!s) return null;

    if (s.v1) {
      const r = v1Sprite(sff, s);
      if (!r) return null;
      // Engine parity, two different draw paths (both field-verified on RyuDX):
      // FIGHT art remaps every unkeyed palette to the selected act, but
      // PORTRAITS (group 9000) are drawn through the preload path and use the
      // sprite's own embedded palette. His embedded palettes are junk (634 of
      // them) and the act paints his portrait as noise.
      const isPortrait = group === 9000;
      // sff.palOverride is an explicit request from the palette browser and
      // outranks both rules - without it a portrait preview would silently
      // ignore the palette the user just clicked.
      const pal = sff.palOverride || (!isPortrait && sff.actPal) || r.pal;
      return { kind: 'indexed', w: r.w, h: r.h, px: r.px, pal };
    }

    const base = (s.flags & 1) === 0 ? sff.lofs : sff.tofs;
    const start = base + s.dataOfs;

    // Formats 10/11/12 are literally PNG files (the engine seeks +4 then
    // png.Decode).
    if (s.fmt >= 10 && s.fmt <= 12) {
      const blob = sff.buf.subarray(start + 4, start + s.dataLen);
      if (!(blob[0] === 0x89 && blob[1] === 0x50)) return null;
      const iend = findSeq(blob, [0x49, 0x45, 0x4e, 0x44]); // 'IEND'
      const bytes = iend > 0 ? blob.subarray(0, iend + 8) : blob;
      // PNG8 (fmt 10) carries only the INDEX MAP: the engine colors it from
      // the SFF's palette table and ignores the PNG's own PLTE. Several
      // characters ship an all-black placeholder PLTE, so an untouched
      // passthrough renders a black silhouette (field hit: dr_kira).
      let pal = sff.palOverride || null;
      if (!pal && s.fmt === 10) {
        const p = v2Palette(sff, s);
        if (p.some((b) => b !== 0)) pal = p;
      }
      const out = { kind: 'png', bytes, pal, w: s.w, h: s.h };
      // The palette's alpha travels with it: fmt 10 is drawn through the SFF
      // palette texture exactly like an RLE sprite, and the PNG's own tRNS is
      // ignored with its PLTE (only pi.Pix is kept, image.go:1421-1429). When
      // no SFF palette was substituted (an all-black table), the PNG keeps its
      // own, as before. Formats 11/12 carry their alpha in the pixels.
      const alpha = s.fmt === 10 && pal ? spriteAlpha(sff, s) : null;
      if (alpha) out.alpha = alpha;
      return out;
    }

    const size = s.w * s.h;
    if (!size || size > 4096 * 4096) return null;
    if (s.unresolved) return null;
    let px = null;
    if (s.fmt === 0) {
      px = sff.buf.subarray(start, start + Math.min(size, s.dataLen));
    } else if (s.fmt === 2 || s.fmt === 3 || s.fmt === 4) {
      const body = sff.buf.subarray(start + 4, start + Math.max(4, s.dataLen));
      if (s.fmt === 2) px = rle8Decode(body, size);
      else if (s.fmt === 3) px = rle5Decode(body, size);
      else px = lz5Decode(body, size);
    }
    // A SHORT buffer is as broken as a missing one, and far more dangerous: an
    // empty Uint8Array is truthy, so `if (!px)` alone let a zero-pixel sprite
    // through as a valid result and the caller painted whatever happened to
    // follow it in memory.
    if (!px || px.length < size) return null;
    const out = { kind: 'indexed', w: s.w, h: s.h, px, pal: sff.palOverride || v2Palette(sff, s) };
    const alpha = spriteAlpha(sff, s);
    if (alpha) out.alpha = alpha;
    return out;
  }

  return {
    rle8Decode, rle5Decode, lz5Decode, rlePcxDecode,
    readSff, v2Palette, v2PaletteAt, v2PaletteAlphaAt, readAct, v1Sprite, spriteGeom, parseDef,
    decodeSprite, findSeq, spriteKey,
  };
});
