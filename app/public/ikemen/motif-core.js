// Motif (screenpack) parsing - the pure-text core, shared by the desktop Studio
// (via ../../modlib.js) and Mod Studio Lite.
//
// ONE implementation on purpose: both Studios draw the same character-select
// grid from the same [Select Info] block, and two parsers would drift the way
// two SFF decoders would.
//
// Pure: no fs, no path, no DOM. Takes the system.def TEXT and returns geometry.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.motifCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Section-scoped key lookup. Keys like fadein.time repeat across many
  // sections, so a whole-file regex grabs the wrong one. First occurrence wins,
  // matching the engine's own ini reader.
  function section(text, want) {
    const out = {};
    let inSec = false;
    for (const raw of String(text || '').split(/\r?\n/)) {
      const line = raw.replace(/;.*$/, '').trim();
      if (/^\[/.test(line)) { inSec = line.toLowerCase() === '[' + want.toLowerCase() + ']'; continue; }
      if (!inSec || !line) continue;
      const m = line.match(/^([^=]+?)\s*=\s*(.*)$/);
      if (m && !(m[1].trim().toLowerCase() in out)) out[m[1].trim().toLowerCase()] = m[2].trim();
    }
    return out;
  }

  function nums(v, fallback) {
    if (v === undefined) return fallback;
    const parts = String(v).split(',').map((s) => parseFloat(s.trim()));
    if (parts.some((n) => !Number.isFinite(n))) return fallback;
    return parts;
  }

  // Everything needed to draw the real select grid. Values stay in the MOTIF's
  // own localcoord space, not pixels - the caller picks the viewport.
  function parseMotif(defText) {
    const info = section(defText, 'Info');
    const sel = section(defText, 'Select Info');
    const files = section(defText, 'Files');
    // cell.spacing may be a single number meaning both axes.
    const spacing = nums(sel['cell.spacing'], [4, 4]);
    // Values may be quoted (`name = "Default"`); the engine reads them through
    // getText(), which strips the quotes. Do the same or the name is displayed
    // with them still attached.
    const unq = (v) => String(v == null ? '' : v).replace(/^"(.*)"$/, '$1').trim();
    return {
      name: unq(info.name),
      author: unq(info.author),
      localcoord: nums(info.localcoord, [320, 240]),
      spr: files.spr || 'system.sff',
      select: {
        rows: parseInt(sel.rows, 10) || 0,
        columns: parseInt(sel.columns, 10) || 0,
        pos: nums(sel.pos, [0, 0]),
        cellSize: nums(sel['cell.size'], [24, 24]),
        cellSpacing: spacing.length === 1 ? [spacing[0], spacing[0]] : spacing,
        // Both default to 0 in the engine (system.base.def): a pack that says
        // nothing draws no empty box and the cursor jumps over empty cells.
        // The stock Default pack is that pack; ikemen1, big and mugen1 set
        // both to 1. Whether the cursor can REST on an empty cell is this
        // flag, not a fixed fact (start.lua: `char ~= nil or moveoveremptyboxes`).
        showEmptyBoxes: String(sel.showemptyboxes || '0') !== '0',
        moveOverEmptyBoxes: String(sel.moveoveremptyboxes || '0') !== '0',
        wrapping: String(sel.wrapping || '0') !== '0',
        cellBgSpr: nums(sel['cell.bg.spr'], null),
        cellBgScale: nums(sel['cell.bg.scale'], [1, 1]),
        randomSpr: nums(sel['cell.random.spr'], null),
        randomScale: nums(sel['cell.random.scale'], [1, 1]),
        // The motif decides which sprite a cell shows. Hardcoding 9000,0 is how
        // you end up rendering a character's 15x31 non-portrait as noise.
        portraitSpr: nums(sel['portrait.spr'], [9000, 0]),
        portraitOffset: nums(sel['portrait.offset'], [0, 0]),
        portraitScale: nums(sel['portrait.scale'], [1, 1]),
        // THE BIG PORTRAITS either side of the grid. Note `anim`, not `spr`:
        // ikemen1 sets `p1.face.anim = 0`, which is the character's STANCE
        // animation rather than a still portrait - the same fact GRAIL 4.9
        // records about the palette preview. Offsets are screen coordinates
        // and the sprite's own AXIS lands on them, so frames of different
        // sizes stay aligned.
        // TWO elements per side, and the game draws BOTH: ikemen1 has
        // `p1.face.anim = 0` (the stance sprite, standing in front) and
        // `p1.face2.spr = 9000,1` (the big portrait, rotated 70 degrees about
        // Y onto the wall behind it). VSelect renders only the portrait; the
        // engine renders both, which is why the real screen has a character
        // standing in front of their own artwork.
        faces: (() => {
          // THE ENGINE HAS A DEFAULTS FILE AND THIS PARSER DOES NOT.
          //
          // `resources/defaultMotif.ini` ships with the engine and is assigned
          // BEFORE the user's system.def, so a screenpack inherits every key it
          // does not state. For the select screen's big portrait it carries
          // `p1.face.spr = 9000, 1` (and p2's) - which is why a pack can just
          // position the portrait and never name a sprite, and why MUGEN packs
          // routinely do. Both of NoZ's LEGACY motifs give p1.face.offset,
          // .scale and .facing and stop.
          //
          // Reading only the user's file, this returned null for those packs
          // and the preview drew an empty portrait frame while THE GAME DREW
          // THE PORTRAIT - the preview understating the build, which is the
          // wrong direction for a tool whose whole job is showing what ships.
          //
          // face2 is genuinely off by default (`p1.face2.spr = -1, 0` in the
          // same file), so only `face` carries one.
          const one = (prefix, fallbackSpr) => {
            const anim = sel[prefix + '.anim'];
            let spr = nums(sel[prefix + '.spr'], null);
            // A NEGATIVE GROUP IS "no sprite", the engine's way of switching an
            // element off - not a sprite to go looking for.
            if (spr && spr[0] < 0) spr = null;
            else if (!spr && anim === undefined) spr = fallbackSpr || null;
            if (anim === undefined && !spr) return null;
            return {
              anim: anim === undefined ? null : parseInt(anim, 10),
              spr,
              offset: nums(sel[prefix + '.offset'], [0, 0]),
              scale: nums(sel[prefix + '.scale'], [1, 1]),
              // -1 mirrors the sprite, which is how P2 faces the other way.
              facing: parseInt(sel[prefix + '.facing'], 10) || 1,
              window: nums(sel[prefix + '.window'], null),
              layerno: parseInt(sel[prefix + '.layerno'], 10) || 0,
              // 3D projection, an Ikemen extension. yangle rotates the sprite
              // about its vertical axis so the artwork lies along the wall of
              // ikemen1's perspective room.
              projection: String(sel[prefix + '.projection'] || '').toLowerCase(),
              xangle: parseFloat(sel[prefix + '.xangle']) || 0,
              yangle: parseFloat(sel[prefix + '.yangle']) || 0,
              focallength: parseFloat(sel[prefix + '.focallength']) || 0,
            };
          };
          // Order matters: face2 is the backdrop, face stands in front of it.
          const BIG_PORTRAIT = [9000, 1];   // defaultMotif.ini, pX.face.spr
          return {
            p1: [one('p1.face2'), one('p1.face', BIG_PORTRAIT)].filter(Boolean),
            p2: [one('p2.face2'), one('p2.face', BIG_PORTRAIT)].filter(Boolean),
          };
        })(),
        // The select CURSOR, one per side. `active` is an animation that plays
        // on the highlighted cell; `done` is the still shown once that side has
        // locked in. startcell is where the cursor begins.
        cursors: (() => {
          const one = (p) => {
            const anim = sel[p + '.cursor.active.anim'];
            const spr = nums(sel[p + '.cursor.active.spr'], null);
            if (anim === undefined && !spr) return null;
            return {
              anim: anim === undefined ? null : parseInt(anim, 10),
              spr,
              scale: nums(sel[p + '.cursor.active.scale'], [1, 1]),
              startcell: nums(sel[p + '.cursor.startcell'], [0, 0]),
              doneSpr: nums(sel[p + '.cursor.done.spr'], null),
              doneScale: nums(sel[p + '.cursor.done.scale'], [1, 1]),
            };
          };
          return { p1: one('p1'), p2: one('p2') };
        })(),
        // The icon shown on a randomselect cell.
        randomSwitchTime: parseInt(sel['cell.random.switchtime'], 10) || 0,
        // THE STAGE'S OWN PICTURE on the stage-select row. The sprite comes out
        // of each STAGE's .sff, not the motif's (defaultMotif.ini: "Stage
        // portrait use sprites and anim data from stage's SFF and DEF files"),
        // and the engine default is `-1, 0` - off. Kept as parsed, -1 included,
        // so the caller can tell "the pack switched it off" from a real sprite
        // number; ikemen1 sets 9000,1 at a quarter scale.
        stagePortrait: {
          spr: nums(sel['stage.portrait.spr'], [-1, 0]),
          scale: nums(sel['stage.portrait.scale'], [1, 1]),
          offset: nums(sel['stage.portrait.offset'], [0, 0]),
        },
        // PER-ROW CELL TRANSFORMS, an Ikemen GO extension: `cell.*-N.scale`,
        // `.spacing`, `.offset`, `.xangle`, `.projection`, `.focallength`.
        // This is how IKEMEN1 draws its select grid in PERSPECTIVE - rows
        // recede, each one smaller and narrower than the one below it. Without
        // reading these the preview draws a flat rectangle where the game draws
        // a trapezoid, which is the single most visible difference.
        //
        // Note the perspective is already BAKED INTO the per-row scale and
        // spacing (0.30 -> 0.46 down ikemen1's ten rows); xangle/focallength
        // describe how the motif's author derived them.
        rows_: (() => {
          const byRow = {};
          for (const k of Object.keys(sel)) {
            const m = /^cell\.\*-(\d+)\.(.+)$/.exec(k);
            if (!m) continue;
            const r = parseInt(m[1], 10);
            (byRow[r] = byRow[r] || {})[m[2]] = sel[k];
          }
          const out = {};
          for (const r of Object.keys(byRow)) {
            const v = byRow[r];
            out[r] = {
              scale: nums(v.scale, null),
              spacing: nums(v.spacing, null),
              offset: nums(v.offset, null),
              xangle: v.xangle === undefined ? null : parseFloat(v.xangle),
              focallength: v.focallength === undefined ? null : parseFloat(v.focallength),
              projection: String(v.projection || '').toLowerCase(),
            };
          }
          return out;
        })(),
      },
    };
  }

  // --- select-screen BACKGROUND ---------------------------------------------
  //
  // The motif draws the select screen as a stack of background layers behind
  // (and in front of) the cell grid. A preview that omits them is a grid
  // floating on black rather than a picture of the game, which is exactly what
  // makes VSelect's preview read as the real screen.
  //
  // Sections are `[SelectBG <arbitrary name>]`, NOT numbered - ikemen1 uses
  // `[SelectBG Background Clouds Top]`. Matching `[SelectBG N]` finds nothing.
  // File order is draw order within a layerno.
  function parseSelectBG(defText) {
    const text = String(defText || '');
    const layers = [];
    let cur = null;
    const push = () => { if (cur) layers.push(cur); cur = null; };
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.replace(/;.*$/, '').trim();
      if (/^\[/.test(line)) {
        push();
        // A NAME IS OPTIONAL. The convention is [SelectBG name], but the engine
        // matches the section by its prefix and a pack is free to write a bare
        // [SelectBG] for every layer - the MK2 Remix pack does, eleven times -
        // and every one of them drew in the game while this parser saw none,
        // so the preview showed a black screen for a pack whose whole select
        // grid IS its background. A nameless layer is named by its position.
        const m = /^\[\s*selectbg(?:\s+(.*?))?\s*\]$/i.exec(line);
        if (m) cur = { name: m[1] !== undefined && m[1] !== '' ? m[1] : 'layer ' + (layers.length + 1), keys: {} };
        continue;
      }
      if (!cur || !line) continue;
      const kv = line.match(/^([^=]+?)\s*=\s*(.*)$/);
      // First occurrence wins, as everywhere else in an ini the engine reads.
      if (kv && !(kv[1].trim().toLowerCase() in cur.keys)) {
        cur.keys[kv[1].trim().toLowerCase()] = kv[2].trim();
      }
    }
    push();

    const out = layers.map((l) => {
      const k = l.keys;
      const tile = nums(k.tile, [0, 0]);
      return {
        name: l.name,
        type: String(k.type || 'normal').toLowerCase(),
        spriteno: nums(k.spriteno, null),
        actionno: k.actionno === undefined ? null : parseInt(k.actionno, 10),
        start: nums(k.start, [0, 0]),
        delta: nums(k.delta, [1, 1]),
        // tile is 0/1 per axis in MUGEN 1.0 motifs; a count is also legal.
        tile: tile.length === 1 ? [tile[0], tile[0]] : tile,
        tilespacing: nums(k.tilespacing, [0, 0]),
        // The animated part: pixels per tick, applied to the layer's offset.
        velocity: nums(k.velocity, [0, 0]),
        trans: String(k.trans || 'none').toLowerCase(),
        // HOW MUCH OF IT. For an add or sub layer MUGEN reads `alpha = src,dst`
        // and scales the source by src/255 (stage.go, "Read alpha if
        // applicable"); without the key both default to full. A screenpack's
        // overlays live or die on this: the CvS select screen lays an LCD sheet
        // over everything at `trans = addalpha, alpha = 30,250` - 12% - and
        // drawing it at full strength washes out the whole screen.
        alpha: nums(k.alpha, null),
        mask: String(k.mask || '0') !== '0',
        // layerno 1 draws IN FRONT of the cells; 0 (the default) behind.
        layerno: parseInt(k.layerno, 10) || 0,
        window: nums(k.window, null),
        scale: nums(k.scale, [1, 1]),
      };
    });
    const def = section(text, 'SelectBGdef');
    return {
      spr: def.spr || '',                    // usually blank: reuse [Files] spr
      bgClearColor: nums(def.bgclearcolor, [0, 0, 0]),
      layers: out,
    };
  }

  // --- [Begin Action N]: the .air format ------------------------------------
  //
  // Actions live in a character's .air, and in system.def, stage and
  // storyboard defs too - the engine reads every one of them with the same
  // parser, so this one is a TRANSCRIPTION of it, not a reading of the format
  // docs. Ikemen GO 96413d2: ReadAnimFrame, ReadAnimation, ReadAction,
  // AnimationTable.readAction and resolveCopyAction in src/anim.go; SectionName,
  // Atoi, LoadText and SplitAndTrim in src/common.go. The rules that decide
  // WHICH frames an action has (GRAIL 3.2c), each of which a friendlier parser
  // used to get wrong on real characters:
  //
  //   - FIRST definition of a number wins (anim.go:1202-1208). Duplicates are
  //     common in real characters (1,498 actions over a 312-file corpus), and
  //     showing the last one made the player disagree with the game.
  //   - An action with no frames (and no Copy Action) BECOMES the next action
  //     in the file (anim.go:1210-1222).
  //   - `Copy Action N` ends the body; the action becomes N once the whole file
  //     is read, over up to 8 hops, and is DELETED when N is missing or the
  //     chain loops (anim.go:309-318, 1261-1297). A target that is not a valid
  //     int32 is no copy at all, so that action is treated as empty.
  //     File-local: a character's .air is merged with data/common.air before
  //     the copies resolve (char.go:4311-4340), and only its own text is here.
  //   - The header is SectionName + Atoi: `[Begin Action 6000 placeholder]` is
  //     6000 and `[Begin Action 6000][Begin Action 6000]` is 6000, while
  //     `[Begin Action 25 ; note]` (the `]` is cut with the comment) and
  //     `[Begin  Action 26]` (two spaces) are no action at all
  //     (common.go:793-812, anim.go:457-481).
  //   - A frame is any line starting with a digit or `-` with 5 comma fields,
  //     every field read with Atoi: `9764,Z1` is sprite 9764,0, not a skipped
  //     line that shifts every later element number (anim.go:45-66).
  //   - A box header is any `clsn` line with 1 or 2 at index 4 and a `:`; its
  //     number is the box COUNT, and a box line is any following `clsn` line
  //     with `=` and 4 fields - `Clsn1[0]=...` included. Box lines that are
  //     missing leave [0,0,0,0] boxes that still count; each box is normalized
  //     to l<=r, t<=b (anim.go:353-424).
  //
  // COLLISION BOXES, with the .air's two-tier semantics: `Clsn2Default: N`
  // sets the boxes every following frame uses, `Clsn2: N` overrides them for
  // the NEXT FRAME ONLY, and when both come before one frame the LAST header
  // wins (anim.go:330-342). Boxes are in the frame's own coordinates, relative
  // to the sprite AXIS, which is what lets a viewer draw them without knowing
  // the sprite.
  //
  // LOOPSTART IS NOT NOISE. When an animation reaches its last frame it
  // restarts HERE, not at frame 0 - so a walk cycle typically opens with a few
  // step-off frames that play once and never again. Recorded as a property ON
  // the frame array rather than as a frame, so every caller - which iterates or
  // reads .length - is unaffected. A marker after the last frame falls back to
  // the marker in force when that frame was read (anim.go:428-430).
  //
  // Returns { [actionNo]: frames } with frames.loopStart set, and each frame
  // { group, index, x, y, time, clsn1: [{ x1, y1, x2, y2 }], clsn2 }. Duration
  // -1 means "hold forever", i.e. a still image.
  //
  // HOW THE FRAME IS DRAWN rides along, but only where it is not the default,
  // so the everyday frame (and every payload built from one) stays the size it
  // was. See frameDraw below for each field:
  //   h, v            true when the frame is mirrored / flipped;
  //   xDraw, yDraw    the offset the engine DRAWS, when it is not x / y;
  //   blend           { mode: 'add'|'sub'|'subadd', src, dst } (0-255);
  //   xscale, yscale, angle   when not 1, 1, 0.
  // x and y stay the raw .air values: the boxes, the timeline and every
  // existing caller read those.

  // strings.TrimSpace over a byte string (the text is latin1, one char per
  // byte): only the ASCII whitespace set counts.
  function goTrim(s) {
    let a = 0, b = s.length;
    const ws = (c) => c === 32 || (c >= 9 && c <= 13);
    while (a < b && ws(s.charCodeAt(a))) a++;
    while (b > a && ws(s.charCodeAt(b - 1))) b--;
    return s.slice(a, b);
  }
  const lowerAscii = (s) => s.replace(/[A-Z]+/g, (m) => m.toLowerCase());

  // common.go:212-241 Atoi: optional sign, digits up to the first non-digit,
  // clamped to IMax / IErr past int32.
  function goAtoi(str) {
    const t = goTrim(String(str));
    if (!t.length) return 0;
    const neg = t[0] === '-';
    const a = (neg || t[0] === '+') ? t.slice(1) : t;
    let n = 0;
    for (let k = 0; k < a.length; k++) {
      const c = a.charCodeAt(k);
      if (c < 48 || c > 57) break;
      n = n * 10 + (c - 48);
      if (n > 2147483647) return neg ? -2147483648 : 2147483647;
    }
    return neg ? -n : n;
  }

  // common.go:187-190 IsNumeric = strconv.ParseFloat succeeds. Covers what an
  // .air can plausibly hold (decimal, exponent, inf/nan); hex floats and
  // underscores are not worth the regex. The same test airedit.js uses.
  const goIsNumeric = (s) => /^[+-]?((\d+\.?\d*|\.\d+)([eE][+-]?\d+)?|inf|infinity|nan)$/i.test(goTrim(String(s)));

  // common.go:243-290 Atof, transcribed (the copy in airedit.js, which the
  // Animation editor reads through): digits with one '.', then an exponent
  // read only when more follows the 'e'. Two engine quirks kept on purpose:
  // the exponent's sign is looked up in the UNSIGNED string's index
  // (common.go:278 reads str[i+1] where i counts in a), so `-1e-2` is read as
  // -100; and an exponent of 0 changes nothing. `nan` and `inf` pass IsNumeric
  // and read as 0.
  function goPow10(n) {
    if (n >= 0) return n > 308 ? Infinity : Number('1e' + (32 * Math.floor(n / 32))) * Number('1e' + (n % 32));
    const k = -n;
    return k > 323 ? 0 : Number('1e-' + (32 * Math.floor(k / 32))) / Number('1e' + (k % 32));
  }
  function goAtof(strIn) {
    let f = 0;
    const str = goTrim(String(strIn));
    if (!str.length) return 0;
    const a = (str[0] === '-' || str[0] === '+') ? str.slice(1) : str;
    let i = 0, p = 0;
    for (; i < a.length; i++) {
      if (a[i] === '.') { if (p !== 0) break; p = i + 1; continue; }
      const c = a.charCodeAt(i);
      if (c < 48 || c > 57) break;
      f = f * 10 + (c - 48);
    }
    let e = 0;
    if (i + 1 < a.length && (a[i] === 'e' || a[i] === 'E')) {
      let j = i + 1;
      if (a[j] === '-' || a[j] === '+') j++;
      for (; j < a.length && a.charCodeAt(j) >= 48 && a.charCodeAt(j) <= 57; j++) e = e * 10 + (a.charCodeAt(j) - 48);
      if (e !== 0) {
        if (str[i + 1] === '-') e = -e;
        if (p === 0) p = i;
      }
    }
    if (p > 0) f *= goPow10(p - i + e);
    if (str[0] === '-') f = -f;
    return f;
  }

  // strings.SplitN(line, ",", 10) with every piece TrimSpace'd
  // (anim.go:52-56). TEN pieces, not every comma: the tenth keeps the rest of
  // the line, so `...,1,1,45,junk` has the angle `45,junk`, which is not
  // numeric and leaves the angle at 0 - a plain split would read 45.
  function splitFrame(line) {
    const out = [];
    let p = 0;
    while (out.length < 9) {
      const c = line.indexOf(',', p);
      if (c < 0) break;
      out.push(goTrim(line.slice(p, c)));
      p = c + 1;
    }
    out.push(goTrim(line.slice(p)));
    return out;
  }

  // The digits after `as` / `ss` / `sas` (anim.go:109-137 parseAlphaNumbers).
  // The source is ALWAYS the digits read, 0 when there are none - so a bare
  // `AS` is AS0D0, not the default; the destination only when a `d` is
  // followed by at least one digit, else the mode's default. Each number keeps
  // its low 14 bits (`&= 0x3fff`, done per digit here, which gives the same
  // bits as Go's int arithmetic for any length) and is then clamped to 255, so
  // AS256D256 is 255,255.
  function alphaNumbers(a, start, defDst) {
    const digit = (k) => k < a.length && a.charCodeAt(k) >= 48 && a.charCodeAt(k) <= 57;
    let i = start, alp = 0;
    for (; digit(i); i++) alp = (alp * 10 + (a.charCodeAt(i) - 48)) & 0x3fff;
    const src = Math.min(255, alp);
    let dst = defDst;
    if (i < a.length && a[i] === 'd' && digit(i + 1)) {
      alp = 0;
      for (i++; digit(i); i++) alp = (alp * 10 + (a.charCodeAt(i) - 48)) & 0x3fff;
      dst = Math.min(255, alp);
    }
    return [src, dst];
  }

  // THE DRAW FIELDS OF ONE FRAME LINE (anim.go:72-224, ReadAnimFrame after the
  // five required fields), copied onto `f` only where they are not the
  // default. `ary` is splitFrame of the LOWERCASED line, so every letter test
  // sees lowercase whatever the author typed (anim.go:305-306). A bad flip,
  // blend or scale field logs an error in the engine and keeps its default;
  // the frame is still drawn - so a bad field is simply left out here.
  // airedit.js readFrame (lines ~166-256) is the same transcription with spans,
  // and tools/test-air-fields.js holds the two to the same values over every
  // .air in the corpus.
  function frameDraw(ary, f) {
    let hCount = 0, vCount = 0;
    let blendField = ary.length >= 7 ? ary[6] : '';
    if (ary.length >= 6 && ary[5] !== '') {
      let flags = ary[5];
      // WINMUGEN'S `...,5,A` (anim.go:73-92, this engine fork only): the
      // transparency written in the flip field. From the first character that
      // is not h/v, the rest moves to the blend field WHEN THAT FIELD IS
      // EMPTY - old screenpacks draw their cursors additive this way. With a
      // blend field already written it stays put and is a bad flag instead.
      for (let k = 0; k < flags.length; k++) {
        const ch = flags[k];
        if (ch !== 'h' && ch !== 'v') {
          if (blendField === '') { blendField = flags.slice(k); flags = flags.slice(0, k); }
          break;
        }
      }
      // Letters repeat and come in any order; anything else is a bad flag.
      for (let k = 0; k < flags.length; k++) {
        if (flags[k] === 'h') hCount++;
        else if (flags[k] === 'v') vCount++;
      }
    }
    if (hCount) f.h = true;
    if (vCount) f.v = true;
    // WHERE THE AXIS IS DRAWN. Every H negates the stored x offset
    // (anim.go:93-99), and the draw path multiplies it by the flipped scale
    // and negates x once more when that scale is negative (anim.go:926-990,
    // render.go:675-677). Net result: with no H, or an ODD number of them, the
    // axis lands at +x (the sprite mirrored in place); with an EVEN number of
    // two or more (`HH`) the offset was negated twice by the reader and once
    // by the draw, so the axis lands at -x. Same for V and y. The raw x/y stay
    // on the frame; this is the value to place the sprite with.
    if (hCount >= 2 && hCount % 2 === 0 && f.x !== 0) f.xDraw = -f.x;
    if (vCount >= 2 && vCount % 2 === 0 && f.y !== 0) f.yDraw = -f.y;
    if (blendField !== '') {
      // anim.go:144-196. The field is cut to begin at its first a/s, then the
      // cases are tried in this order. `a2`, `add` or `a10` still draw plain
      // add (MUGEN reads the first letter); anything with no a/s is none.
      const ia = blendField.search(/[as]/);
      const a = ia >= 0 ? blendField.slice(ia) : blendField;
      let mode = null, src = 255, dst = 0;
      if (a === 'a1') { mode = 'add'; dst = 128; }
      else if (a.slice(0, 3) === 'sas') { mode = 'subadd'; [src, dst] = alphaNumbers(a, 3, 255); }
      else if (a.slice(0, 2) === 'sa') { mode = 'subadd'; dst = 255; }
      // "Mugen defaults to 0 here" (anim.go:169): AS<n> with no D is n/0.
      else if (a.slice(0, 2) === 'as') { mode = 'add'; [src, dst] = alphaNumbers(a, 2, 0); }
      else if (a.slice(0, 2) === 'ss') { mode = 'sub'; [src, dst] = alphaNumbers(a, 2, 255); }
      else if (a[0] === 'a') { mode = 'add'; dst = 255; }
      else if (a[0] === 's') { mode = 'sub'; dst = 255; }
      if (mode) f.blend = { mode, src, dst };
    }
    // anim.go:198-224. Present and non-blank only: a BLANK xscale is "no
    // change" in Ikemen (0 in MUGEN 1.1). A scale of 0 is kept - the engine
    // then draws nothing (isBlank, anim.go:490-492). Values as the engine's
    // Atof reads them (it then stores a float32; the difference is below
    // anything a pixel can show).
    const opt = (idx, name, dflt) => {
      if (ary.length > idx && ary[idx] !== '' && goIsNumeric(ary[idx])) {
        const n = goAtof(ary[idx]);
        if (n !== dflt) f[name] = n;
      }
    };
    opt(7, 'xscale', 1);
    opt(8, 'yscale', 1);
    opt(9, 'angle', 0);
    return f;
  }

  // THE ENGINE'S BLEND NUMBERS FOR A FRAME'S src/dst (anim.go:849-889
  // alphaToBlend, with the system brightness at 1). MUGEN's alpha range is
  // 0-256 and the renderer's 0-255, so a pair that sums to 256 (AS128D128,
  // AS64D192) is read as an exact alpha blend: dst = 255 - src. Then both are
  // clamped to 0-255. Returns { s, d } as integers 0-255; divide by 255 for
  // the factors the blend equations use.
  function alphaToBlend(src, dst) {
    let s = Math.trunc(Number(src)) || 0;
    let d = Math.trunc(Number(dst)) || 0;
    if (s + d === 256) d = 255 - s;
    s = Math.max(0, Math.min(255, s));
    d = Math.max(0, Math.min(255, d));
    return { s, d };
  }

  // strings.ToLower(strings.TrimSpace(strings.SplitN(line, ";", 2)[0]))
  function airBodyLine(line) {
    const k = line.indexOf(';');
    return lowerAscii(goTrim(k < 0 ? line : line.slice(0, k)));
  }

  // common.go:793-812 SectionName, on a line SplitAndTrim already trimmed.
  function airSectionName(line) {
    if (!line.length || line[0] !== '[') return null;
    const k = line.indexOf(';');
    const sec = goTrim(k < 0 ? line : line.slice(0, k));
    if (sec[sec.length - 1] !== ']') return null;
    const body = sec.slice(1, sec.indexOf(']'));
    const sp = body.indexOf(' ');
    return sp >= 0
      ? { name: lowerAscii(body.slice(0, sp + 1)), sub: body.slice(sp + 1) }
      : { name: lowerAscii(body), sub: '' };
  }

  function parseActions(defText) {
    let text = String(defText || '');
    // LoadText strips a UTF-8 BOM (common.go:446-448): three chars read as
    // latin1, one read as UTF-8.
    if (text.charCodeAt(0) === 0xef && text.charCodeAt(1) === 0xbb && text.charCodeAt(2) === 0xbf) text = text.slice(3);
    else if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    // SplitAndTrim(text, "\n") (common.go:730-736): LF only, so a CR is
    // whitespace the trim removes.
    const lines = text.split('\n').map(goTrim);
    let i = 0;

    // ReadAnimation (anim.go:292-455). Reads from lines[i] to the next line
    // starting with '['; leaves i there.
    const readAnimation = () => {
      const a = { frames: [], loopstart: 0, copyAction: -1 };
      let ols = 0;
      let c1 = [], c1d = [], c2 = [], c2d = [];
      let def1 = true, def2 = true;
      for (; i < lines.length; i++) {
        if (lines[i][0] === '[') break;
        const line = airBodyLine(lines[i]);
        // Checked first, and it ends the body (anim.go:309-318).
        // strconv.ParseInt(numStr, 10, 32): sign and digits in int32 range, or
        // no target at all.
        if (line.length >= 12 && line.slice(0, 12) === 'copy action ') {
          const numStr = goTrim(line.slice(12));
          const id = /^[+-]?\d+$/.test(numStr) ? Number(numStr) : NaN;
          a.copyAction = (id >= -2147483648 && id <= 2147483647) ? id : -1;
          return a;
        }
        // ReadAnimFrame (anim.go:45-66): a bad flip, blend or scale field logs
        // a warning but keeps the frame.
        const c0 = line.charCodeAt(0);
        if (line.length && ((c0 >= 48 && c0 <= 57) || line[0] === '-')) {
          const ary = splitFrame(line);
          if (ary.length >= 5) {
            ols = a.loopstart;
            if (def1) c1 = c1d;
            if (def2) c2 = c2d;
            a.frames.push(frameDraw(ary, {
              group: goAtoi(ary[0]), index: goAtoi(ary[1]),
              x: goAtoi(ary[2]), y: goAtoi(ary[3]),
              time: goAtoi(ary[4]),
              clsn1: c1, clsn2: c2,
            }));
            def1 = true; def2 = true;
          }
          continue;
        }
        if (line.length >= 9 && line.slice(0, 9) === 'loopstart') {
          a.loopstart = a.frames.length;
          continue;
        }
        if (line.length >= 5 && line.slice(0, 4) === 'clsn') {
          const ii = line.indexOf(':');
          if (ii < 0) continue;
          const size = goAtoi(line.slice(ii + 1));
          if (size < 0 || (line[4] !== '1' && line[4] !== '2')) continue;
          const boxes = [];
          const isDefault = line.length >= 12 && line.slice(5, 12) === 'default';
          if (line[4] === '1') { c1 = boxes; if (isDefault) c1d = boxes; def1 = false; }
          else { c2 = boxes; if (isDefault) c2d = boxes; def2 = false; }
          if (size === 0) continue;
          i++;
          for (let n = 0; n < size && i < lines.length;) {
            const bl = airBodyLine(lines[i]);
            if (!bl.length) { i++; continue; }
            if (bl.length < 4 || bl.slice(0, 4) !== 'clsn') break;
            const eq = bl.indexOf('=');
            if (eq < 0) break;
            const v = bl.slice(eq + 1).split(',');
            if (v.length < 4) break;
            let l = goAtoi(v[0]), t = goAtoi(v[1]), r = goAtoi(v[2]), b = goAtoi(v[3]);
            if (l > r) { const s = l; l = r; r = s; }
            if (t > b) { const s = t; t = b; b = s; }
            boxes.push({ x1: l, y1: t, x2: r, y2: b });
            n++; i++;
          }
          i--; // the line that stopped the box read is read again
          // `make([][4]float32, size)`: the slots no line filled stay zero
          // boxes. Capped, so a typo'd count cannot allocate millions.
          for (let k = boxes.length, end = Math.min(size, boxes.length + 256); k < end; k++) {
            boxes.push({ x1: 0, y1: 0, x2: 0, y2: 0 });
          }
        }
      }
      if (a.loopstart >= a.frames.length) a.loopstart = ols;
      return a;
    };

    // ReadAction (anim.go:457-481): null when the next section is not an
    // action, with i left on that section's line.
    const readOne = () => {
      let sec = null;
      for (; i < lines.length; i++) {
        sec = airSectionName(lines[i]);
        if (sec && sec.name.length) break;
      }
      if (i >= lines.length || sec.name !== 'begin ') return null;
      const spi = sec.sub.indexOf(' ');
      if (spi < 0 || lowerAscii(sec.sub.slice(0, spi + 1)) !== 'action ') return null;
      i++;
      const no = goAtoi(sec.sub.slice(spi + 1));
      return { no, a: readAnimation() };
    };

    // AnimationTable.readAction (anim.go:1194-1233), recursion included.
    const anims = new Map();
    const readAction = () => {
      while (i < lines.length) {
        const r = readOne();
        if (!r) { i++; continue; }
        const existing = anims.get(r.no);
        if (existing) return existing;
        while (r.a.frames.length === 0 && i < lines.length && r.a.copyAction < 0) {
          const next = readAction();
          if (next) { Object.assign(r.a, next); break; }
          i++;
        }
        anims.set(r.no, r.a);
        return r.a;
      }
      return null;
    };
    while (readAction()) { /* every action in the file */ }

    // resolveCopyAction (anim.go:1261-1297). Go walks a map in random order;
    // for chains up to 8 hops every order gives this result.
    const out = {};
    for (const a of anims.values()) {
      for (let loops = 0; a.copyAction >= 0 && loops < 8; loops++) {
        const target = anims.get(a.copyAction);
        if (!target || target === a) break;
        if (target.copyAction >= 0) { a.copyAction = target.copyAction; continue; }
        Object.assign(a, target);
        a.copyAction = -1;
        break;
      }
    }
    for (const [no, a] of anims) {
      if (a.copyAction >= 0) continue; // unresolved: the engine drops it
      const frames = a.frames.slice();
      frames.loopStart = a.loopstart;
      out[no] = frames;
    }
    return out;
  }

  // --- select.def [Characters] authoring ------------------------------------
  //
  // Cell position is purely sequential: a line can never name its own cell, so
  // a sparse layout is made by CONSUMING cells with placeholders. See
  // GRAIL 4.12 for the confirmed rules; the ones that bite silently are
  // enforced here.

  // A comma inside a command value truncates it, because the line is
  // comma-split before the value is read.
  function safeCmd(v) {
    const s = String(v == null ? '' : v).trim();
    return (!s || s.includes(',')) ? '' : s;
  }

  // entry: { path, stage?, music?, order?, ai?, hidden?, includestage?,
  //          kind?: 'skip'|'random', slot?, select_?, next?, previous? }
  function charLine(c, inBlock) {
    const params = [];
    // BARE path, never `stage=`: the parser tests for a .def suffix FIRST, so
    // `stage=stages/x.def` is taken as a stage PATH and then fails to resolve.
    if (c.stage) params.push(/^stages\//i.test(c.stage) ? c.stage : 'stages/' + c.stage);
    if (c.music) params.push('music=' + c.music);
    if (c.order !== undefined && c.order !== '') params.push('order=' + c.order);
    // Ordering is PER MODE: `order` drives the arcade ladder and
    // `ordersurvival` the survival one. A character WITHOUT ordersurvival does
    // NOT fall back to its arcade order - main.lua:1411-1413 puts it in
    // survival order 1 outright ("chars without ordersurvival still belong to
    // survival order 1"). Emitted only when set, so a roster that never touches
    // it produces the bytes it always did.
    if (c.ordersurvival !== undefined && c.ordersurvival !== '') params.push('ordersurvival=' + c.ordersurvival);
    if (c.ai !== undefined && c.ai !== '') params.push('ai=' + c.ai);
    if (c.hidden !== undefined && c.hidden !== '') params.push('hidden=' + c.hidden);
    if (c.includestage !== undefined && c.includestage !== '') params.push('includestage=' + c.includestage);
    // `exclude = 1` keeps the entry in select.def but takes the character off
    // the grid: the cell is still consumed, the character is not selectable.
    // That is a different thing from removing it, which frees the cell.
    if (c.exclude !== undefined && c.exclude !== '') params.push('exclude=' + c.exclude);
    if (inBlock) {
      // Real keys are select/next/previous, lowercase, read off the RAW line.
      // `select` collides with the entry's own path field, so the command lives
      // on select_.
      for (const [key, prop] of [['select', 'select_'], ['next', 'next'], ['previous', 'previous']]) {
        const v = safeCmd(c[prop]);
        if (v) params.push(key + '=' + v);
      }
    }
    // EVERY OTHER PARAM, carried generically. The engine takes far more than
    // this editor models - vsscreen, victoryscreen, rounds, time, single,
    // bonus, arcadepath, and any number of music prefixes - and a passthrough
    // bag covers all of them plus whatever a build invents, without a field
    // here per key. Keys are sanitized because they are written into an ini.
    let unlock = null;
    if (c.params && typeof c.params === 'object') {
      for (const k of Object.keys(c.params)) {
        const key = String(k).trim().toLowerCase();
        // SANITIZED FIRST, whatever shape the value has. This check used to sit
        // in the scalar branch only, so an array-valued param whose KEY held a
        // comma went into the ini unchecked: `a.def, bad, key=evil=v, good=1`,
        // where the comma splits the line and invents two params.
        if (!key || !/^[a-z0-9_.]+$/.test(key)) continue;
        // AN ARRAY MEANS ALTERNATE TRACKS. Each music prefix holds a LIST in
        // the engine (music.go:14) and the same key is simply repeated on the
        // line, which is how the stage entries already write theirs. Without
        // this an array stringifies with commas and corrupts the line.
        const raw = c.params[k];
        for (const one of (Array.isArray(raw) ? raw : [raw])) {
          const val = String(one === undefined ? '' : one).trim();
          if (val === '' || /[\r\n]/.test(val)) continue;
          // UNLOCK MUST BE LAST ON THE LINE. main.lua:1344 pulls it off with
          // `,%s*unlock%s*=%s*(.-)%s*$` - anchored to the END - so it swallows
          // every param written after it. A Lua condition may itself contain
          // commas, which is the reason the engine reads it that way.
          //
          // Deferred whatever shape the value had. It used to be deferred only
          // for a scalar, so an array-valued unlock was emitted INLINE and
          // repeated: from `a.def, unlock=cond1, unlock=cond2, arcadepath=x.def`
          // the engine took the whole of "cond1, unlock=cond2, arcadepath=x.def"
          // as the condition.
          if (key === 'unlock') { unlock = val; continue; }
          params.push(key + '=' + val);
        }
      }
    }
    if (unlock !== null) params.push('unlock=' + unlock);
    return [c.path, ...params].join(', ');
  }

  // --- locked cells ----------------------------------------------------------
  //
  // VSelect marks a cell it must not move with a comment at the end of that
  // cell's select.def line, `; LOCKED` unless the user chose other words. Here
  // select.def is GENERATED from the roster on every build, so the lock lives
  // on the roster entry (`locked: '1'`) and this only writes the label back
  // out, where VSelect - and a later import - can read it.
  //
  // ON THE SAME LINE, and that is safe for the engine: main.lua strips every
  // `;` comment from the whole file (`content:gsub('([^\r\n;]*)%s*;[^\r\n]*',
  // '%1')`, main.lua:1521 here, 1517 in the 1.0.0 zip) BEFORE any line is
  // parsed - so `unlock=`, which is read to the END of the line
  // (main.lua:1344), never sees the label, and `slot = {` / `}` still match
  // their anchored patterns. Checked in both main.lua copies before this was
  // written; if an engine ever stops stripping first, the label has to move
  // to a line of its own above the entry.
  const LOCK_LABEL = '; LOCKED';

  // The label as it is written: one line, and always a comment. A label typed
  // without its semicolon would otherwise become part of the entry.
  function lockComment(label) {
    let s = String(label == null ? '' : label).replace(/[\r\n]+/g, ' ').trim();
    if (!s || !s.replace(/^;+/, '').trim()) s = LOCK_LABEL;
    return s.startsWith(';') ? s : '; ' + s;
  }

  // What a label SAYS, for comparing one read back: `; LOCKED`, `;LOCKED` and
  // `;; locked` are the same label.
  function lockWords(label) {
    return String(label == null ? '' : label).replace(/^[\s;]+/, '').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  // Is this raw select.def line marked locked? `labels` are the labels to
  // accept besides the default; the default's word (LOCKED) always counts,
  // because that is what VSelect writes unless told otherwise.
  function lineLocked(raw, labels) {
    const at = String(raw == null ? '' : raw).indexOf(';');
    if (at < 0) return false;
    const said = lockWords(String(raw).slice(at));
    if (!said) return false;
    const want = new Set([lockWords(LOCK_LABEL)]);
    for (const l of labels || []) { const w = lockWords(l); if (w) want.add(w); }
    return want.has(said);
  }

  const isLockOn = (v) => v === true || v === 1 || /^\s*1/.test(String(v == null ? '' : v));

  // Build a complete [Characters] body from an ordered entry list.
  //
  // opts.lockLabel: the comment appended to every entry with `locked` on
  // (default `; LOCKED`, see LOCK_LABEL). Entries without `locked` are written
  // byte for byte as before.
  function buildCharacterLines(entries, opts) {
    const lines = [];
    const list = entries || [];
    const note = lockComment(opts && opts.lockLabel);
    const mark = (line, c) => (c && isLockOn(c.locked) ? line + ' ' + note : line);
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (c.kind === 'skip') { lines.push(mark('skipslot', c)); continue; }
      if (c.kind === 'random') { lines.push(mark('randomselect', c)); continue; }
      // AN EMPTY CELL THE CURSOR CAN STILL REST ON.
      //
      // `dummyslot` is a keyword in its own right (system.go:5220), and it is
      // NOT a skipslot: main.lua:1364 sets playable=false and, unlike the
      // skipslot branch three lines above it, never sets skip=1. So the cell
      // has no character and no skip flag, which is exactly the pair that
      // start.lua:996 lets the cursor enter when moveoveremptyboxes is on. The
      // engine pads every grid's tail with them itself (main.lua:1690) - those
      // are the reachable empty cells you can already walk onto in game.
      //
      // Without this branch a dummy entry matches no guard, has no `path`, and
      // is dropped by the `if (!c.path) continue` below - taking its CELL with
      // it, so every later character moves up one. Silent, and invisible until
      // the build is run.
      if (c.kind === 'dummy') { lines.push(mark('dummyslot', c)); continue; }
      // A line carried through verbatim (e.g. one the shipped select.def
      // already had). Still normalized: a line whose FIRST token is empty
      // inserts a row on one side of the engine and not the other, so the two
      // character lists drift by one and every later character resolves to the
      // wrong one. That is silent roster corruption, not a blank cell - so it
      // becomes a skipslot, which is the safe way to consume a cell.
      if (c.raw !== undefined) {
        const t = String(c.raw);
        const first = t.split(',')[0].trim();
        lines.push(mark(first === '' ? 'skipslot' : t, c));
        continue;
      }
      if (!c.path) continue; // never emit an empty first token
      if (c.slot) {
        const group = [];
        let j = i;
        while (j < list.length && list[j].slot === c.slot && !list[j].kind && list[j].path) { group.push(list[j]); j++; }
        // The same .def twice in one block collapses both rows onto the later
        // row's char_ref, so drop duplicates rather than emit a trap.
        const seen = new Set();
        const members = group.filter((m) => {
          const k = String(m.path).toLowerCase();
          if (seen.has(k)) return false;
          seen.add(k); return true;
        });
        if (members.length > 1) {
          // next/previous must be on EVERY member with the SAME value or none:
          // the cycling code indexes the key list by slot position.
          const shared = {};
          for (const k of ['next', 'previous', 'select_']) {
            const vals = members.map((m) => safeCmd(m[k])).filter(Boolean);
            shared[k] = (vals.length === members.length && new Set(vals).size === 1) ? vals[0] : '';
          }
          // A block's lock is written on each locked MEMBER's own line, not on
          // `slot = {`: an import reads a lock back per line, so this is the
          // one placement that round-trips without a special case (the cell's
          // lock is member 0's).
          lines.push('slot = {');
          for (const m of members) lines.push(mark(charLine(Object.assign({}, m, shared), true), m));
          lines.push('}');
          i = j - 1;
          continue;
        }
        lines.push(mark(charLine(members[0] || c, false), members[0] || c));
        i = j - 1;
        continue;
      }
      lines.push(mark(charLine(c, false), c));
    }
    // Trailing placeholders are pointless: the engine pads the grid itself.
    // A trailing dummyslot is redundant TWICE over - the engine pads the tail
    // with dummyslot itself - and select.def is hashed into the Build ID, so
    // leaving them in means two people who arranged the same visible grid get
    // different Build IDs and cannot connect, with nothing on screen to explain
    // it. A LOCKED trailing placeholder goes too: the lock itself is kept on the
    // roster entry, and a comment is no reason to change the Build ID.
    const bare = (l) => l.replace(/\s*;.*$/, '');
    while (lines.length && (bare(lines[lines.length - 1]) === 'skipslot'
                            || bare(lines[lines.length - 1]) === 'dummyslot')) lines.pop();
    return lines;
  }

  // Replace a named section's body wholesale, preserving everything else in the
  // file. Returns the new text.
  function replaceSection(text, name, bodyLines) {
    const lines = String(text || '').split(/\r?\n/);
    const head = new RegExp('^\\s*\\[' + name + '\\]\\s*$', 'i');
    let start = -1;
    for (let i = 0; i < lines.length; i++) if (head.test(lines[i])) { start = i; break; }
    if (start < 0) return String(text || '') + '\n[' + name + ']\n' + bodyLines.join('\n') + '\n';
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) if (/^\s*\[/.test(lines[i])) { end = i; break; }
    const out = lines.slice(0, start + 1).concat(bodyLines, '', lines.slice(end));
    // Always terminate with a newline: a whitespace-only final line reaches the
    // empty-first-token path, which desynchronizes the engine's two character
    // lists and makes every later character resolve to the wrong one.
    let s = out.join('\n');
    if (!s.endsWith('\n')) s += '\n';
    return s;
  }

  // DOES THE SCREENPACK EVER SHOW A CELL'S PORTRAIT? Some packs draw their grid
  // faces as background art and park the cells' portraits off the screen (MK II
  // Remix: portrait.offset = -5000,-5000), so the portrait sprite a character
  // carries is never seen in that pack - and is often a leftover no palette in
  // the file draws cleanly. The whole grid, moved by the offset, has to land
  // more than a screen beyond an edge, so no portrait of any real size can reach
  // the screen; a zero scale hides them too. `m` is a parseMotif result.
  function cellPortraitsHidden(m) {
    const s = m && m.select;
    if (!s) return false;
    const L = m.localcoord || [320, 240];
    const sc = s.portraitScale || [1, 1];
    if (!sc[0] || !sc[1]) return true;
    const cols = Math.max(1, s.columns || 1), rows = Math.max(1, s.rows || 1);
    const size = s.cellSize || [0, 0], gap = s.cellSpacing || [0, 0];
    const off = s.portraitOffset || [0, 0], pos = s.pos || [0, 0];
    const x0 = pos[0] + off[0], y0 = pos[1] + off[1];
    const x1 = x0 + cols * (size[0] + gap[0]), y1 = y0 + rows * (size[1] + gap[1]);
    return x1 <= -L[0] || x0 >= 2 * L[0] || y1 <= -L[1] || y0 >= 2 * L[1];
  }

  // THE BIG FACE P1 HOVERS: the front element of the pair (face stands in front
  // of face2), as parseMotif gives it - { anim, spr, ... } or null.
  function hoverFace(m) {
    const f = m && m.select && m.select.faces && m.select.faces.p1;
    return f && f.length ? f[f.length - 1] : null;
  }

  return { section, nums, parseMotif, parseSelectBG, parseActions, alphaToBlend, safeCmd, charLine, buildCharacterLines, replaceSection,
    LOCK_LABEL, lockComment, lockWords, lineLocked, isLockOn, cellPortraitsHidden, hoverFace };
});
