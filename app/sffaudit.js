// SPRITE AND ANIMATION TABLES, READ THE WAY THE ENGINE READS THEM.
//
// Three questions about a character's art share this module:
//
//   * which actions its .air really defines (airTable) - not "which
//     [Begin Action] lines a regex finds": the engine keeps the first of two
//     definitions, turns an empty action into a copy of the next one, and
//     deletes a Copy Action that points nowhere;
//   * which frames of those actions name a sprite the .sff does not hold
//     (vanishing) - the character draws nothing for that frame's duration;
//   * what hides behind a sprite key the .sff holds more than once
//     (duplicateKeys) - art the engine never draws.
//
// It exists because the answers used to live in two command-line tools
// (tools/air-sff-audit.js, tools/unused-sprites.js) with a looser .air parser
// each, and the content audit needs the same answers with file lines attached.
// Both tools now import from here; their report text stays theirs.
//
// Plain CommonJS, no dependencies. The pixel decoders are required LAZILY, and
// only by duplicateKeys with decode on: reading tables needs no decoder, and a
// caller that only wants keys should not pull the PNG decoder in with it.
'use strict';
const fs = require('fs');
const crypto = require('crypto');

// ---------------------------------------------------------------------------
// Go helpers, transcribed. The .air reader below is only as faithful as these.

// strings.TrimSpace over a byte string. The .air is read as latin1 so one
// char = one byte; bytes >= 0x80 are not valid UTF-8 on their own and Go does
// not trim them, so only the ASCII whitespace set is stripped here (a JS
// trim() would also eat a 0xA0 byte the engine keeps).
const goTrim = (s) => s.replace(/^[ \t\n\v\f\r]+|[ \t\n\v\f\r]+$/g, '');

// common.go:212-241 Atoi. Leading sign, then digits until the first non-digit,
// so `220 , comment` is 220 and `abc` is 0. Past int32 it clamps to IMax, or
// to IErr (^IMax, common.go:27-28) when the text was negative.
function atoi(str) {
  str = goTrim(String(str));
  let n = 0;
  if (!str.length) return 0;
  const a = (str[0] === '-' || str[0] === '+') ? str.slice(1) : str;
  for (let k = 0; k < a.length; k++) {
    const c = a.charCodeAt(k);
    if (c < 48 || c > 57) break;
    n = n * 10 + (c - 48);
    if (n > 2147483647) return str[0] === '-' ? -2147483648 : 2147483647;
  }
  return str[0] === '-' ? -n : n;
}

// common.go:793-812 SectionName. The line must START with '[' and, once the
// comment is cut, END with ']'; the section text runs to the first ']'. The
// name is everything up to and including the first space, lowercased.
function sectionName(line) {
  if (!line.length || line[0] !== '[') return null;
  const sec = goTrim(line.split(';')[0]);
  if (sec[sec.length - 1] !== ']') return null;
  const body = sec.slice(1, sec.indexOf(']'));
  const sp = body.indexOf(' ');
  return sp >= 0
    ? { name: body.slice(0, sp + 1).toLowerCase(), sub: body.slice(sp + 1) }
    : { name: body.toLowerCase(), sub: '' };
}

// ---------------------------------------------------------------------------
// airTable(text, opts?) -> { actions, duplicates, deleted }
//
//   actions:    Map<no, { line, frames: [{ g, i, blank, time, line }], clsn1, copyOf? }>
//               clsn1: some frame of the action carries at least one Clsn1 box
//   duplicates: [{ no, line, firstLine }]
//   deleted:    [{ no, line, target }]
//
// A transcription of the engine's own reader, rule by rule:
//
//   HEADER (anim.go:456-480 ReadAction). `[Begin Action <x>]` where the word
//   after "begin " must be "action " with exactly one space, and the number is
//   Atoi of the rest - so `[Begin Action 220 , comment]` is 220 and a negative
//   number is read. A regex that wants `\d+` alone missed 85 actions in 12 of
//   473 corpus characters, almost all of them negative.
//
//   BODY (anim.go:292-330). Every line up to the next line starting with '['
//   belongs to the action. A frame is a line starting with a digit or '-' with
//   at least five comma fields (anim.go:45-66); anything else is not a frame.
//   `copy action N` (lowercased, one space each) ends the body on the spot.
//
//   FIRST DEFINITION WINS (anim.go:1202-1208). A second action with the same
//   number is parsed, logged and thrown away - even when the first was a Copy
//   Action.
//
//   AN EMPTY ACTION BECOMES THE NEXT ONE (anim.go:1210-1222). An action with
//   no valid frames and no Copy Action silently takes the content of the next
//   action in the file - a real, drawable action, not a missing one. If that
//   next action is a duplicate number, it is the FIRST definition of that
//   number that gets copied, because that is what readAction hands back.
//
//   COPY ACTION RESOLVES AFTER THE COMMON ANIMS MERGE (char.go:4316-4340,
//   anim.go:1261-1297). A chain is followed; a target that is missing, or a
//   cycle, DELETES the action. `opts.common` (a Set of action numbers, e.g.
//   data/common.air's) lets a Copy Action land on a merged common action the
//   way it does in a match; such a copy reports `copyOf` with no frames.
//   Go walks a map, so its order is random; the engine gives up after 8 hops
//   per action, which only matters for chains longer than that - here the
//   file order is used and the result is the same for anything shorter.
//
//   BLANK FRAMES (anim.go:699-716). The engine fetches no sprite when group
//   == -1 OR number == -1 ("Mugen only nulls out -1, other negatives wrap
//   around"). Every other number is cast to uint16, so `-2,0` looks up
//   65534,0. Frames carry the uint16 key numbers the engine looks up; blank
//   frames carry the numbers as written.
function airTable(text, opts) {
  const common = (opts && opts.common) || null;
  let s = String(text == null ? '' : text);
  // LoadText strips a UTF-8 BOM (common.go:446-448); read as latin1 it shows
  // up as three characters, read as UTF-8 as one.
  if (s.charCodeAt(0) === 0xef && s.charCodeAt(1) === 0xbb && s.charCodeAt(2) === 0xbf) s = s.slice(3);
  else if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  // SplitAndTrim(str, "\n") (common.go:730-736, char.go:4302).
  const lines = s.split('\n').map(goTrim);

  const anims = new Map();
  const duplicates = [];
  let i = 0;

  // ReadAnimFrame (anim.go:45-66): only the fields the audit needs.
  const readFrame = (line, lineNo) => {
    if (!line.length) return null;
    const c = line.charCodeAt(0);
    if ((c < 48 || c > 57) && line[0] !== '-') return null;
    const ary = line.split(',').map(goTrim);
    if (ary.length < 5) return null;
    const G = atoi(ary[0]), N = atoi(ary[1]);
    const blank = G === -1 || N === -1;
    return {
      g: blank ? G : (G & 0xffff), i: blank ? N : (N & 0xffff),
      blank, time: atoi(ary[4]), line: lineNo,
    };
  };

  // ReadAction + ReadAnimation: null when the section at `i` is not an action.
  const readOne = () => {
    // `[]` is a section with an empty name, which the engine walks past.
    let sec = null;
    for (; i < lines.length; i++) {
      sec = sectionName(lines[i]);
      if (sec && sec.name.length) break;
    }
    if (i >= lines.length) return null;
    if (sec.name !== 'begin ') return null;
    const spi = sec.sub.indexOf(' ');
    if (spi < 0 || sec.sub.slice(0, spi + 1).toLowerCase() !== 'action ') return null;
    const headerLine = i + 1;
    i++;
    const a = { line: headerLine, frames: [], copyAction: -1, src: null, clsn1: false };
    const no = atoi(sec.sub.slice(spi + 1));
    // Clsn1 as ReadAnimation assigns it (anim.go:298-392): `Clsn1: n` gives
    // the NEXT frame n boxes, `Clsn1Default: n` every later frame that has no
    // `Clsn1:` of its own; a frame line then takes the explicit list if one
    // was given since the last frame, else the default. A count that is not
    // positive gives no box. Only whether any frame ends up with a box is kept.
    let c1 = 0, c1d = 0, def1 = true;
    for (; i < lines.length; i++) {
      if (lines[i].length && lines[i][0] === '[') break;
      const line = goTrim(lines[i].split(';')[0]).toLowerCase();
      if (line.length >= 5 && line.slice(0, 4) === 'clsn' && line[4] === '1') {
        const ii = line.indexOf(':');
        if (ii >= 0) {
          const size = atoi(line.slice(ii + 1));
          if (size >= 0) {
            c1 = size;
            if (line.length >= 12 && line.slice(5, 12) === 'default') c1d = size;
            def1 = false;
          }
        }
        continue;
      }
      if (line.length >= 12 && line.slice(0, 12) === 'copy action ') {
        // strconv.ParseInt(numStr, 10, 32): sign + digits, int32 range, or
        // the action is left with no copy target at all.
        const numStr = goTrim(line.slice(12));
        const id = /^[+-]?\d+$/.test(numStr) ? Number(numStr) : NaN;
        a.copyAction = (Number.isFinite(id) && id >= -2147483648 && id <= 2147483647) ? id : -1;
        break;
      }
      const f = readFrame(line, i + 1);
      if (f) {
        if (def1) c1 = c1d;
        if (c1 > 0) a.clsn1 = true;
        a.frames.push(f);
        def1 = true;
      }
    }
    a.src = no;
    return { no, a };
  };

  // AnimationTable.readAction (anim.go:1195-1232), recursion included.
  const readAction = () => {
    while (i < lines.length) {
      const r = readOne();
      if (r) {
        const existing = anims.get(r.no);
        if (existing) {
          duplicates.push({ no: r.no, line: r.a.line, firstLine: existing.line });
          return existing;
        }
        while (r.a.frames.length === 0 && i < lines.length && r.a.copyAction < 0) {
          const a2 = readAction();
          if (a2) {
            r.a.frames = a2.frames; r.a.copyAction = a2.copyAction; r.a.src = a2.src; r.a.clsn1 = a2.clsn1;
            break;
          }
          i++;
        }
        r.a.written = r.a.copyAction;
        anims.set(r.no, r.a);
        return r.a;
      }
      i++;
    }
    return null;
  };
  while (readAction()) { /* every action in the file */ }

  // resolveCopyAction (anim.go:1261-1297).
  // A common action's boxes are not read here: it counts as having some.
  const commonAnim = (no) => (common && common.has(no)
    ? { frames: [], copyAction: -1, src: no, clsn1: true } : undefined);
  const deleted = [];
  for (const [no, a] of anims) {
    for (let loops = 0; a.copyAction >= 0 && loops < 8; loops++) {
      const target = anims.get(a.copyAction) || commonAnim(a.copyAction);
      if (!target || target === a) break;
      if (target.copyAction >= 0) { a.copyAction = target.copyAction; continue; }
      a.frames = target.frames; a.src = target.src; a.copyAction = -1; a.clsn1 = target.clsn1;
      break;
    }
    if (a.copyAction >= 0) deleted.push({ no, line: a.line, target: a.written });
  }

  const actions = new Map();
  for (const [no, a] of anims) {
    if (a.copyAction >= 0) continue;
    const e = { line: a.line, frames: a.frames, clsn1: a.clsn1 };
    if (a.src !== no) e.copyOf = a.src;
    actions.set(no, e);
  }
  return { actions, duplicates, deleted };
}

// ---------------------------------------------------------------------------
// sffNodes(file): the .sff sprite table as written.
//
// A RAW walk, deliberately not readSff().
//
// readSff normalizes links in place - it copies the target's dataOfs/dataLen
// onto the link so decoding just works - which is right for drawing and wrong
// for accounting: every link would then claim its target's bytes and the total
// would be inflated by however much art is shared. It also keeps only the first
// node per key, so duplicates would be invisible. This walk keeps file order
// and every field as written.
//
// lofs/tofs (v2 header +52/+60) ride along so a caller that reads a node's
// pixels needs no second parse; v1 data offsets are absolute, so both are 0.
function sffNodes(file) {
  const b = fs.readFileSync(file);
  return walkBuf(b, file);
}

function walkBuf(b, file) {
  if (b.length < 64 || b.slice(0, 11).toString('latin1') !== 'ElecbyteSpr') return null;
  const version = b[15];
  const nodes = [];

  if (version === 2) {
    const sprOfs = b.readUInt32LE(36), sprNum = b.readUInt32LE(40);
    for (let n = 0; n < sprNum; n++) {
      const o = sprOfs + n * 28;
      if (o + 28 > b.length) break;
      nodes.push({
        n,
        g: b.readUInt16LE(o), i: b.readUInt16LE(o + 2),
        w: b.readUInt16LE(o + 4), h: b.readUInt16LE(o + 6),
        link: b.readUInt16LE(o + 12),
        fmt: b[o + 14],
        dataOfs: b.readUInt32LE(o + 16),
        dataLen: b.readUInt32LE(o + 20),
        // palIdx and flags are not used by the audit itself, but any caller
        // that wants to READ a node's pixels needs both: flags bit 0 selects
        // which of the two data blocks dataOfs is relative to (lofs vs tofs),
        // and without it a tool silently reads from the wrong base and compares
        // the wrong bytes.
        palIdx: b.readUInt16LE(o + 24),
        flags: b.readUInt16LE(o + 26),
        samePal: null,
      });
    }
    return { version, file, size: b.length, nodes,
      lofs: b.readUInt32LE(52), tofs: b.readUInt32LE(60) };
  }

  if (version === 1) {
    const sprNum = b.readUInt32LE(20);
    let ofs = b.readUInt32LE(24);
    for (let n = 0; n < sprNum && ofs > 0 && ofs + 32 <= b.length; n++) {
      const next = b.readUInt32LE(ofs);
      const len = b.readUInt32LE(ofs + 4);
      nodes.push({
        n,
        g: b.readUInt16LE(ofs + 12), i: b.readUInt16LE(ofs + 14),
        w: 0, h: 0,
        link: b.readUInt16LE(ofs + 16),
        fmt: -1,
        dataOfs: ofs + 32,
        dataLen: len,
        // The flag is at +18, not +16: +16 is the link index, whose low byte is
        // 0 for almost every sprite. Reading it there makes every sprite look
        // like a palette owner. (image.go readHeader / Sprite.read.)
        samePal: b[ofs + 18] !== 0,
      });
      if (!next || next <= ofs) break;
      ofs = next;
    }
    return { version, file, size: b.length, nodes, lofs: 0, tofs: 0 };
  }
  return null;
}

// Every 'g,i' the engine can reach by key. The loader keeps the FIRST node for
// a key and logs the rest as ignored (image.go:1770-1774), so a Set of keys in
// file order is exactly the engine's table.
function sffKeysFromNodes(nodes) {
  const list = Array.isArray(nodes) ? nodes : (nodes && nodes.nodes) || [];
  const keys = new Set();
  for (const s of list) keys.add(s.g + ',' + s.i);
  return keys;
}

// ---------------------------------------------------------------------------
// Pixels of ONE NODE, addressed by position rather than by key.
//
// decodeSprite and spritePixels both go through byKey, which only ever hands
// back the winner for a duplicated key - so there is no way to see a shadowed
// sprite through the normal path. That is exactly the point: the engine cannot
// see them either. This reaches past the map so the hidden art can be compared
// against the art that hides it.
//
// v1 returns null: its records are a different shape and the caller falls back
// to comparing stored bytes, which is weaker but honest about being so.
let decoders = null;
const dec = () => decoders || (decoders = {
  sd: require('./tools/sff-decode.js'),
  core: require('./public/ikemen/sffdec-core.js'),
});

function nodeImage(sff, node, buf) {
  if (!node || node.dataLen === 0 || sff.version !== 2) return null;
  const { sd, core } = dec();
  // flags bit 0 picks WHICH data block dataOfs is relative to. Reading from the
  // wrong base yields plausible-looking bytes from the wrong sprite entirely.
  const base = (node.flags & 1) === 0 ? sff.lofs : sff.tofs;
  const start = base + node.dataOfs;
  if (node.fmt >= 10 && node.fmt <= 12) {
    const blob = buf.subarray(start + 4, start + node.dataLen);
    const iend = core.findSeq(blob, [0x49, 0x45, 0x4e, 0x44]);
    try { return sd.decodePng(iend > 0 ? blob.subarray(0, iend + 8) : blob); }
    catch (e) { return null; }
  }
  const size = node.w * node.h;
  if (!size || size > 4096 * 4096) return null;
  let px = null;
  try {
    if (node.fmt === 0) px = buf.subarray(start, start + Math.min(size, node.dataLen));
    else if (node.fmt === 2 || node.fmt === 3 || node.fmt === 4) {
      const body = buf.subarray(start + 4, start + Math.max(4, node.dataLen));
      if (node.fmt === 2) px = sd.rle8Decode(body, size);
      else if (node.fmt === 3) px = sd.rle5Decode(body, size);
      else px = sd.lz5Decode(body, size);
    }
  } catch (e) { return null; }
  if (!px || px.length < size) return null;
  return { kind: 'indexed', w: node.w, h: node.h, px };
}

const sha = (b) => crypto.createHash('sha1').update(b).digest('hex').slice(0, 12);

// Is the shadowed node the SAME PICTURE as the one that wins its key?
//
// Returns { verdict, via, node?, winnerUnresolved? } where verdict is one of
// 'different' | 'same' | 'identical-bytes' | 'undecidable' | 'unresolved-link'.
//
// COMPARE PIXELS, NOT STORED BYTES. Two sprites can hold the same image
// compressed differently, so a byte hash saying "different" is not evidence of
// different art - and "the author drew something the engine never shows" is far
// too strong a claim to rest on a compression artifact. Different DIMENSIONS
// settle it from the headers alone with no decode at all; equal dimensions need
// the pixels. Only when neither is available does this fall back to bytes, and
// it says so in the verdict rather than pretending to more certainty.
//
// `decode: false` skips the pixel step entirely - dimensions, then bytes -
// which is what a sweep over a whole build wants: identical bytes still prove
// the same picture, and everything else that needed pixels is 'undecidable'.
function compareNodes(sff, buf, nodes, winner, other, decode) {
  // RESOLVE LINKS FIRST. A zero-length node carries no pixels of its own, so
  // calling it "different" because it is a link says nothing about the art -
  // it may well point straight at a copy of the very image it is shadowing.
  // Counting those as different art inflated the headline on the first pass.
  const src = (n) => {
    let cur = n;
    for (let hop = 0; cur && cur.dataLen === 0 && hop < 8; hop++) cur = nodes[cur.link];
    return cur && cur.dataLen > 0 ? cur : null;
  };
  const W = src(winner), O = src(other);
  if (!O) return { verdict: 'unresolved-link', via: false };
  if (!W) return { verdict: 'unresolved-link', via: false, winnerUnresolved: true };
  const via = winner.dataLen === 0 || other.dataLen === 0;
  if (W.n === O.n) return { verdict: 'same', via, node: W.n };
  if (W.w !== O.w || W.h !== O.h) return { verdict: 'different', via };
  if (decode !== false) {
    const a = nodeImage(sff, W, buf), b = nodeImage(sff, O, buf);
    if (a && b && a.px.length === b.px.length) {
      return { verdict: Buffer.compare(Buffer.from(a.px), Buffer.from(b.px)) === 0
        ? 'same' : 'different', via };
    }
  }
  const base = (n) => ((n.flags & 1) === 0 ? sff.lofs : sff.tofs) || 0;
  const raw = (n) => buf.subarray(base(n) + n.dataOfs, base(n) + n.dataOfs + n.dataLen);
  return { verdict: sha(raw(W)) === sha(raw(O)) ? 'identical-bytes' : 'undecidable', via };
}

// duplicateKeys(sffPath, { decode, airKeys }) ->
//   [{ key, inAir, winner: {n, w, h, len},
//      shadows: [{ n, w, h, len, verdict, via, node?, winnerUnresolved? }] }]
//
// WHAT IS ACTUALLY HIDING BEHIND EACH TAKEN NUMBER. The engine keeps the first
// node for a key (image.go:1770-1774) and never draws the rest. A shadow
// holding the same picture as the winner is dead weight worth a few KB; a
// shadow holding DIFFERENT art is a drawing the engine has never once
// displayed - a content bug, not a size finding. Sorted by the winner's node
// index. Null when the file is not an SFF.
function duplicateKeys(sffPath, opts) {
  const o = opts || {};
  const buf = fs.readFileSync(sffPath);
  const sff = walkBuf(buf, sffPath);
  if (!sff) return null;
  const airKeys = o.airKeys || new Set();
  const groups = new Map();
  for (const s of sff.nodes) {
    const k = s.g + ',' + s.i;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(s);
  }
  const brief = (s) => ({ n: s.n, w: s.w, h: s.h, len: s.dataLen });
  const out = [];
  for (const [k, list] of groups) {
    if (list.length < 2) continue;
    out.push({
      key: k,
      inAir: airKeys.has(k),
      winner: brief(list[0]),
      shadows: list.slice(1).map((s) => Object.assign(brief(s),
        compareNodes(sff, buf, sff.nodes, list[0], s, o.decode))),
    });
  }
  out.sort((a, b) => a.winner.n - b.winner.n);
  return out;
}

// ---------------------------------------------------------------------------
// vanishing(air, keys) -> [{ action, frames, missing, missingKeys, copyOf? }]
//
// Every action with at least one frame naming a sprite key the .sff does not
// hold: the engine sets no sprite for that frame and draws nothing for its
// duration, logging it once (anim.go:699-716). `air` is an airTable result (or
// its actions Map); `keys` is anything with has('g,i') - sffKeysFromNodes, or
// a readSff byKey map. Blank frames are never missing. `frames` counts every
// frame of the action, `missing` the frames that cannot draw, `missingKeys`
// the distinct keys in frame order. An action that is a copy (an empty action
// that took the next one's content, or a resolved Copy Action) is listed too -
// it vanishes when played exactly like its source - with `copyOf` set.
function vanishing(air, keys) {
  const actions = air instanceof Map ? air : (air && air.actions) || new Map();
  const out = [];
  for (const [no, a] of actions) {
    const miss = a.frames.filter((f) => !f.blank && !keys.has(f.g + ',' + f.i));
    if (!miss.length) continue;
    const e = { action: no, frames: a.frames.length, missing: miss.length,
      missingKeys: [...new Set(miss.map((f) => f.g + ',' + f.i))] };
    if (a.copyOf !== undefined) e.copyOf = a.copyOf;
    out.push(e);
  }
  out.sort((a, b) => a.action - b.action);
  return out;
}

// ---------------------------------------------------------------------------
// colorless(sffPath, costume) -> { groups: [{ group, sprites, share, shades, heads }],
//                                  heads: [{ key, sprites }], decoded } | null
//
// ART DRAWN WITH NO COLORS. An SFF v1 sprite has no colors of its own: it is
// indices into the palette of its chain, the run of sprites from the last one
// that carries a palette (samePal = 0, the chain's HEAD) - or into the costume
// .act where a fight remaps that chain. When the indices a group of art uses
// are 0,0,0 in BOTH, nothing the engine can pick gives it a color, and it is
// drawn as a black silhouette. Bloody Tower is the case: a 2021 re-save of the
// sprite file stripped the palette its zombie, skeleton and titan art was
// drawn with (entries 241-255 of the chain under 0,1 are black), and its one
// .act is black from 38 up, so 51 groups come out solid black on any engine.
// tobf+, the same art with its palettes, lists none. Report only: the colors
// are not in the character's files, so there is nothing to fix in the code.
//
// `costume` is the def's pal1 as 768 RGB bytes, or null for a character with
// none (then the head's own palette decides alone). A group is listed when
// over 80% of its opaque pixels (index 0 is transparent) land on an entry that
// is 0,0,0 in both, AND those pixels use at least four different entries
// (`shades`). Black BY DESIGN is one entry: a fade-out plate, a letterbox
// bar, the plate behind a "Failed" banner (6150 in the same author's three
// characters, 96% black on one entry) - nobody shades art with four entries
// that are all the same black, but a palette stripped from shaded art leaves
// exactly that (13 to 24 per group in Bloody Tower). `heads` names the chain
// heads its black pixels sit on, by the head's own group,index. Null for
// anything that is not an SFF v1.
//
// CHEAP BY CONSTRUCTION, because the audit card runs it on every open: a
// group whose chains have fewer than four entries black in both is never
// read, a group stops as soon as it cannot be listed, and the sprites read are
// COUNTED from the PCX runs rather than decoded into an image - the same walk
// as sffdec-core's rlePcxDecode (a run stops at the end of a line, a line's
// padding past the width is not drawn), with no buffer per sprite. Measured
// on the Main roster's 28 SFF v1 characters: 1-27 ms each, file read
// included. tools/test-sffaudit.js checks the counts against the full decoder.
const BLACK_SHARE = 0.8, MIN_SHADES = 4;

// Where a v1 subfile's own palette sits: the 0x0C marker scanned back from 769
// bytes before its block end (sffdec-core v1Sprite findPalIn). -1 when none.
function v1PalAt(b, rec) {
  for (let p = rec.blockEnd - 769; p >= rec.dataStart + 128; p--) if (b[p] === 0x0c) return p + 1;
  return rec.blockEnd - 769 > 0 ? rec.blockEnd - 768 : -1;
}
// Where its pixel runs end: the block end for a sprite that shares the
// previous palette, just before the marker for one that carries its own.
function v1RunEnd(b, rec) {
  if (rec.samePal && rec.prev) return rec.blockEnd;
  const at = v1PalAt(b, rec);
  return at > 0 ? at - 1 : rec.blockEnd;
}

// Opaque pixels of one v1 sprite, and how many of them are on an index in
// `black` (a Uint8Array(256) of 0/1); `hit`, when given, gets a 1 at every
// black index drawn. -> { opaque, black } or null.
function v1Counts(b, rec, black, end, hit) {
  const o = rec.dataStart;
  if (b[o + 3] !== 8) return null;
  const w = b.readUInt16LE(o + 8) - b.readUInt16LE(o + 4) + 1, h = b.readUInt16LE(o + 10) - b.readUInt16LE(o + 6) + 1;
  const bpl = b.readUInt16LE(o + 66);
  if (w <= 0 || h <= 0 || w > 4096 || h > 4096) return null;
  const start = o + 128, len = end - start, size = w * h;
  if (len <= 0 || bpl <= 0) return { opaque: 0, black: 0 };
  let i = 0, j = 0, k = 0, opaque = 0, blk = 0, stall = 0;
  while (j < size) {
    let n = 1, d = b[start + i];
    if (i < len - 1) i++;
    if (d >= 0xc0) {
      n = d & 0x3f;
      d = b[start + i];
      if (i < len - 1) i++;
    }
    // n steps along the line, stopping at its end; the steps past the width write nothing
    const steps = Math.min(n, bpl - k);
    const wrote = Math.max(0, Math.min(Math.min(k + steps, w) - k, size - j));
    j += wrote;
    if (d && wrote) { opaque += wrote; if (black[d]) { blk += wrote; if (hit) hit[d] = 1; } }
    k += steps;
    if (k >= bpl) k = 0;
    // the decoder rereads the last byte once the data runs out; a zero-length
    // run there would never end
    if (wrote) stall = 0; else if (++stall > 4 && i >= len - 1) break;
  }
  return { opaque, black: blk };
}

const NONE = new Uint8Array(256);
function colorless(sffPath, costume) {
  const b = Buffer.isBuffer(sffPath) ? sffPath : fs.readFileSync(sffPath);
  if (b.length < 64 || b.slice(0, 11).toString('latin1') !== 'ElecbyteSpr' || b[15] !== 1) return null;
  const sff = dec().core.readSff(b);
  if (!sff || !sff.byKey) return null;
  const isBlack = (pal, x) => !pal[x * 3] && !pal[x * 3 + 1] && !pal[x * 3 + 2];
  const headOf = (rec) => { let h = rec; while (h && h.samePal && h.prev) h = h.prev; return h; };
  const heads = new Map();      // head rec -> { black (null: none), key }
  const groups = new Map();
  let decoded = 0;
  for (const [key, rec] of sff.byKey) {
    const head = headOf(rec);
    if (!head) continue;
    let hd = heads.get(head);
    if (!hd) {
      const at = v1PalAt(b, head);
      const black = new Uint8Array(256);
      let any = false;
      if (at > 0 && at + 768 <= b.length) {
        const pal = b.subarray(at, at + 768);
        for (let x = 1; x < 256; x++) if (isBlack(pal, x) && (!costume || isBlack(costume, x))) { black[x] = 1; any = true; }
      }
      const sub = head.dataStart - 32;
      hd = { black: any ? black : null, key: b.readUInt16LE(sub + 12) + ',' + b.readUInt16LE(sub + 14) };
      heads.set(head, hd);
    }
    const g = Number(key.split(',')[0]);
    if (!groups.has(g)) groups.set(g, { group: g, sprites: [], opaque: 0, black: 0, hit: new Uint8Array(256), heads: new Set() });
    groups.get(g).sprites.push({ rec, hd });
  }
  // Only a group with a sprite on a chain that HAS a black entry can be listed;
  // its other sprites are still counted, because they are part of its pixels.
  // And a group stops being counted once it cannot be listed: over 80% black
  // means fewer colored pixels than a quarter of the black ones, and the black
  // ones can still grow by at most the area of the sprites not yet counted.
  // The sprites on a chain with no black entry go first, so most groups stop
  // after a sprite or two.
  const out = [];
  const area = (rec) => { const o = rec.dataStart; return Math.max(0, (b.readUInt16LE(o + 8) - b.readUInt16LE(o + 4) + 1) * (b.readUInt16LE(o + 10) - b.readUInt16LE(o + 6) + 1)); };
  for (const gr of groups.values()) {
    // (and one whose chains have fewer than four black entries between them
    // cannot draw four shades of black)
    const can = new Uint8Array(256);
    for (const s of gr.sprites) if (s.hd.black) for (let x = 1; x < 256; x++) can[x] |= s.hd.black[x];
    if (can.reduce((a, x) => a + x, 0) < MIN_SHADES) continue;
    gr.sprites.sort((x, y) => (x.hd.black ? 1 : 0) - (y.hd.black ? 1 : 0));
    let left = gr.sprites.reduce((a, s) => a + area(s.rec), 0), hopeless = false;
    for (const { rec, hd } of gr.sprites) {
      left -= area(rec);
      const c = v1Counts(b, rec, hd.black || NONE, v1RunEnd(b, rec), gr.hit);
      decoded++;
      if (!c) continue;
      gr.opaque += c.opaque; gr.black += c.black;
      if (c.black) gr.heads.add(hd.key);
      if (gr.opaque - gr.black >= (1 - BLACK_SHARE) / BLACK_SHARE * (gr.black + Math.max(0, left))) { hopeless = true; break; }
    }
    const shades = gr.hit.reduce((a, x) => a + x, 0);
    if (!hopeless && gr.opaque && gr.black / gr.opaque > BLACK_SHARE && shades >= MIN_SHADES) {
      out.push({ group: gr.group, sprites: gr.sprites.length, share: +(gr.black / gr.opaque).toFixed(3), shades, heads: [...gr.heads] });
    }
  }
  out.sort((x, y) => x.group - y.group);
  const byHead = new Map();
  for (const gr of out) for (const k of gr.heads) byHead.set(k, (byHead.get(k) || 0) + gr.sprites);
  return { groups: out, heads: [...byHead].map(([key, sprites]) => ({ key, sprites })).sort((x, y) => y.sprites - x.sprites), decoded };
}

module.exports = { airTable, sffNodes, sffKeysFromNodes, duplicateKeys, compareNodes,
  nodeImage, vanishing, atoi, colorless, v1Counts, v1RunEnd };
