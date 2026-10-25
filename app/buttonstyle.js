'use strict';
// THE COMMAND LIST'S BUTTONS: the pictures the pause menu draws for a button.
//
// The engine's pause menu draws a Command List's button tokens as pictures:
// every key of the motif's [Glyphs] (`^A = 1, 0`) found in the text becomes the
// sprite it names, from the SFF the motif's `[Files] glyphs` names (default
// glyphs.sff, looked up beside the motif, as is, then in data/: motif.go
// Files.Glyphs `lookup:"def,,data/"`). Stock, ^A..^Z are colored balls with the
// MUGEN letter on them (data/glyphs.sff, the same file in the engine zip and
// release-v2: 80 PNG32 sprites, 64 x 64, axis 0,64).
//
// A per-bundle choice (roster.buttonStyle, Settings > Controls) swaps them:
//   arcade      today's balls - the default, and a build in it ships byte for
//               byte as before (nothing here runs)
//   xbox        the pad button each MUGEN button is bound to: A green, B red,
//               X blue, Y yellow balls, LB / RB / LT / RT (and LS / RS) pills
//   playstation the same buttons by position: a dark ball with a blue cross,
//               red circle, pink square, green triangle; L1 / R1 / L2 / R2 pills
//   strength    the 6-button Street Fighter convention: x y z = LP MP HP,
//               a b c = LK MK HK - the engine's own glyphs.sff sprites 57-62
// The Xbox and PlayStation art is drawn HERE, in code (`icon`): generic shapes,
// colors and letters at the stock sprites' size and style (a ball with a 2 px
// black ring, a white letter with a black outline), anti-aliased by 4 x 4
// supersampling. No file is downloaded and no maker's mark is drawn.
//
// WHICH PAD BUTTON: the one this build binds (keylib.js: Settings > Controls'
// [Joystick_P1], else the engine's own default - a = A, b = B, c = RT, x = X,
// y = Y, z = RB, d = LB, w = LT), the same table both exports write into
// save/config.ini. The menu's [Glyphs] table is one for both players, so it
// follows player 1. A button bound to something with no picture here (Start,
// Back, the d-pad, a stick direction, nothing) keeps its stock ball.
//
// THE TOKENS THAT STAND FOR SEVERAL BUTTONS (`extras`): ^P any punch and ^K
// any kick (the strengths merge in cmdlist.js and most characters' own lists:
// KFM writes `_QDF^P`) are, in the engine's own words, "Any Punch (X / Y / Z)":
// a pad style draws them as ONE wider picture of the three bound buttons with
// slashes between (Xbox default: X / Y / RB), ^3P / ^3K (all three at once)
// with plus signs; ^S Start as the pad's start button (a pill with three
// lines; both pads mark it so). The engine sizes a glyph by its sprite's
// height and steps on by its width (menu.lua: g.Size[1] * scaleX), so a wider
// picture sits on the row like the others. If one of the three is bound to
// something with no picture, the token keeps its stock ball. Strength and
// Arcade keep the stock P / K / 3P / 3K / S (Strength's own family: the P and
// K balls are the 6-button notation for "any punch / kick").
//
// WHAT THE BUILD GETS (in ITS copy only, `patchMotif`, `forBuild`): the
// motif's [Glyphs] keys for the button tokens the Command List writer prints
// (cmdlist.js: ^A ^B ^C ^X ^Y ^Z ^D ^W, and in a pad style ^P ^K ^3P ^3K ^S)
// as the FIRST lines of the pack's [Glyphs] section (a key's
// first value wins: iniutils overlayUserFirstWins), or a new [Glyphs] section;
// and when the style needs sprites the file lacks, a copy of the glyph file
// the build uses with them appended (`appendSprites`, SFF v2 only) beside the
// motif as cmdlist-buttons-<style>.sff, named by a new first line of [Files].
// Every other byte is kept. A character's own movelist uses the same keys, so
// it shows the style too.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const STYLES = [
  { id: 'arcade', label: 'Arcade', note: 'The colored A B C / X Y Z buttons the engine ships. The default.' },
  { id: 'xbox', label: 'Xbox', note: 'The pad button each one is bound to in Joystick_P1: A B X Y, LB RB LT RT. Any punch / any kick show their three buttons.' },
  { id: 'playstation', label: 'PlayStation', note: 'The same buttons by position: cross, circle, square, triangle, L1 R1 L2 R2. Any punch / any kick show their three buttons.' },
  { id: 'strength', label: 'Strength', note: 'LP MP HP for x y z, LK MK HK for a b c: the 6-button convention (any punch / kick stay P and K). A character wired differently (4-button KOF style) shows the convention, not its own wiring.' },
];
const STYLE_IDS = STYLES.map((s) => s.id);
const DEFAULT_STYLE = 'arcade';
const normalize = (s) => (STYLE_IDS.includes(String(s || '').toLowerCase()) ? String(s).toLowerCase() : DEFAULT_STYLE);
const styleOf = (roster) => normalize(roster && roster.buttonStyle);

// The MUGEN buttons the Command List writer prints as button tokens (cmdlist.js
// glyphOfPart: '^' + the .cmd button upper-cased; s = Start keeps its ball).
const BUTTONS = ['a', 'b', 'c', 'x', 'y', 'z', 'd', 'w'];
const TOKEN = (b) => '^' + b.toUpperCase();
// The strength convention (keylib ACTIONS: x y z punches, a b c kicks, light to heavy)
// -> the engine's own glyphs.sff sprites (defaultMotif.ini [Glyphs] ^LP..^HK).
const STRENGTH = { x: { group: 57, label: 'LP' }, y: { group: 58, label: 'MP' }, z: { group: 59, label: 'HP' }, a: { group: 60, label: 'LK' }, b: { group: 61, label: 'MK' }, c: { group: 62, label: 'HK' } };

// The pad tokens that have a picture, per style (keylib BUTTON_NAMES).
const PAD_ICON = { A: 1, B: 1, X: 1, Y: 1, LB: 1, RB: 1, LT: 1, RT: 1, LS: 1, RS: 1, START: 1 };
const PS_LABEL = { LB: 'L1', RB: 'R1', LT: 'L2', RT: 'R2', LS: 'L3', RS: 'R3', START: 'Options' };
const PS_NAME = { A: 'cross', B: 'circle', X: 'square', Y: 'triangle' };
const XB_LABEL = { START: 'Start' };
// The tokens that stand for several buttons or for Start (see the head): in a pad
// style one picture of the bound buttons; `stock` = the engine's own sprite
// (defaultMotif.ini [Glyphs]), which Arcade and Strength keep.
const EXTRAS = [
  { button: 'p', token: '^P', of: ['x', 'y', 'z'], sep: '/', stock: 53, word: 'any punch' },
  { button: 'k', token: '^K', of: ['a', 'b', 'c'], sep: '/', stock: 54, word: 'any kick' },
  { button: '3p', token: '^3P', of: ['x', 'y', 'z'], sep: '+', stock: 64, word: 'all three punches' },
  { button: '3k', token: '^3K', of: ['a', 'b', 'c'], sep: '+', stock: 63, word: 'all three kicks' },
  { button: 's', token: '^S', start: true, stock: 51, word: 'start' },
];

// Player 1's pad binding for each MUGEN button (and `start`), as this build writes it.
function padMap(keys, list) {
  let keylib = null;
  try { keylib = require('./keylib.js'); } catch (e) { keylib = null; }
  const def = (keylib && keylib.DEFAULTS && keylib.DEFAULTS.joystick_p1) || { a: 'A', b: 'B', c: 'RT', x: 'X', y: 'Y', z: 'RB', d: 'LB', w: 'LT', start: 'START' };
  const set = (keys && keys.joystick_p1) || {};
  const out = {};
  for (const b of list || BUTTONS) out[b] = String(Object.prototype.hasOwnProperty.call(set, b) ? set[b] : def[b]);
  return out;
}
const padLabel = (st, pad) => (st === 'playstation' ? (PS_LABEL[pad] || PS_NAME[pad]) : (XB_LABEL[pad] || pad));

// What each button token shows in a style: [{ button, token, pad?, icon?, label, stock? }]
// icon = the id of a drawn sprite ('xbox:A'), stock = a sprite of the engine's own file (57..62).
function mapping(style, keys) {
  const st = normalize(style);
  const pads = padMap(keys);
  return BUTTONS.map((b) => {
    const row = { button: b, token: TOKEN(b), pad: pads[b] };
    if (st === 'strength') {
      const s = STRENGTH[b];
      if (s) { row.stock = s.group; row.label = s.label; } else row.label = b.toUpperCase();
      return row;
    }
    if ((st === 'xbox' || st === 'playstation') && PAD_ICON[pads[b]]) {
      row.icon = st + ':' + pads[b];
      row.label = padLabel(st, pads[b]);
      return row;
    }
    row.label = b.toUpperCase();
    if (st === 'xbox' || st === 'playstation') row.keeps = pads[b];   // bound to something with no picture
    return row;
  });
}
// The tokens of EXTRAS in a style: [{ button: 'p', token: '^P', word, icon?, label, stock?, keeps? }].
// A pad style: icon = 'xbox:X/Y/RB' (the bound pictures in order, a pad named twice once),
// 'xbox:X+Y+RB', 'xbox:START'; else (or when one of them has no picture) the stock sprite.
function extras(style, keys) {
  const st = normalize(style);
  const pad = st === 'xbox' || st === 'playstation';
  const rows = pad ? mapping(st, keys) : null;
  const startPad = padMap(keys, ['start']).start;
  return EXTRAS.map((e) => {
    const row = { button: e.button, token: e.token, word: e.word, stock: e.stock, label: e.token.slice(1) };
    if (!pad) return row;
    if (e.start) {
      row.pad = startPad;
      if (PAD_ICON[startPad]) { delete row.stock; row.icon = st + ':' + startPad; row.label = padLabel(st, startPad); }
      else row.keeps = 'start is bound to ' + startPad;
      return row;
    }
    const of = e.of.map((b) => rows.find((r) => r.button === b));
    const missing = of.filter((r) => !r.icon);
    if (missing.length) { row.keeps = missing.map((r) => r.button + ' is bound to ' + r.keeps).join(', '); return row; }
    const pads = [...new Set(of.map((r) => r.pad))];
    delete row.stock;
    row.pad = pads.join(e.sep);
    row.icon = st + ':' + row.pad;
    row.label = pads.map((p) => padLabel(st, p)).join(e.sep === '/' ? ' / ' : ' + ');
    return row;
  });
}

// ---- the art ----------------------------------------------------------------------------
const SIZE = 64;
const SS = 4;   // samples per pixel side
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const shade = (c, f) => c.map((v) => Math.round(clamp01((v * f) / 255) * 255));

// signed distances (negative inside)
const dCircle = (cx, cy, r) => (x, y) => Math.hypot(x - cx, y - cy) - r;
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const t = l2 ? clamp01(((px - ax) * dx + (py - ay) * dy) / l2) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
// a stroked path: polylines [[x,y],...], half width hw
function dStroke(lines, hw) {
  const segs = [];
  for (const l of lines) for (let i = 0; i + 1 < l.length; i++) segs.push([l[i][0], l[i][1], l[i + 1][0], l[i + 1][1]]);
  return (x, y) => {
    let m = Infinity;
    for (const s of segs) { const d = segDist(x, y, s[0], s[1], s[2], s[3]); if (d < m) m = d; }
    return m - hw;
  };
}
// a box centered at cx,cy, half sizes hx,hy, corner radii [topLeft, topRight, bottomRight, bottomLeft]
function dRoundBox(cx, cy, hx, hy, radii) {
  return (x, y) => {
    const px = x - cx, py = y - cy;
    const r = px < 0 ? (py < 0 ? radii[0] : radii[3]) : (py < 0 ? radii[1] : radii[2]);
    const qx = Math.abs(px) - hx + r, qy = Math.abs(py) - hy + r;
    return Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - r;
  };
}
const arc = (cx, cy, r, a0, a1, n) => { const out = []; for (let i = 0; i <= n; i++) { const a = (a0 + (a1 - a0) * i / n) * Math.PI / 180; out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); } return out; };

// A stroke font for the labels: height 1 (y down), each letter its own width.
const LETTERS = {
  A: { w: 0.86, p: [[[0, 1], [0.43, 0], [0.86, 1]], [[0.2, 0.66], [0.66, 0.66]]] },
  B: { w: 0.72, p: [[[0, 0], [0, 1]], [[0, 0], [0.44, 0], ...arc(0.44, 0.24, 0.24, -90, 90, 10).slice(1), [0, 0.48]], [[0, 0.48], [0.47, 0.48], ...arc(0.47, 0.74, 0.26, -90, 90, 10).slice(1), [0, 1]]] },
  X: { w: 0.8, p: [[[0, 0], [0.8, 1]], [[0.8, 0], [0, 1]]] },
  Y: { w: 0.84, p: [[[0, 0], [0.42, 0.52], [0.84, 0]], [[0.42, 0.52], [0.42, 1]]] },
  L: { w: 0.6, p: [[[0, 0], [0, 1], [0.6, 1]]] },
  R: { w: 0.74, p: [[[0, 1], [0, 0], [0.45, 0], ...arc(0.45, 0.25, 0.25, -90, 90, 10).slice(1), [0, 0.5]], [[0.36, 0.5], [0.74, 1]]] },
  T: { w: 0.76, p: [[[0, 0], [0.76, 0]], [[0.38, 0], [0.38, 1]]] },
  S: { w: 0.7, p: [[[0.68, 0.12], ...arc(0.35, 0.25, 0.25, -20, -250, 14).slice(1), ...arc(0.35, 0.75, 0.25, -90, 140, 16).slice(1)]] },
  1: { w: 0.42, p: [[[0, 0.22], [0.32, 0], [0.32, 1]]] },
  2: { w: 0.68, p: [[...arc(0.34, 0.3, 0.3, 200, 360, 12), [0.62, 0.48], [0, 1], [0.68, 1]]] },
  3: { w: 0.66, p: [[...arc(0.33, 0.25, 0.25, 210, 450, 14), [0.3, 0.5]], [[0.3, 0.5], ...arc(0.33, 0.75, 0.25, -90, 150, 14)]] },
};
// The polylines of a label laid out centered on cx,cy at letter height h.
// `xs` narrows the letters (two letters in a 64 px button).
function labelLines(text, cx, cy, h, gap, xs) {
  const k = xs || 1;
  const chars = [...String(text)].map((c) => LETTERS[c]).filter(Boolean);
  const total = chars.reduce((s, c) => s + c.w * h * k, 0) + gap * Math.max(0, chars.length - 1);
  let x = cx - total / 2;
  const top = cy - h / 2;
  const lines = [];
  for (const c of chars) {
    for (const l of c.p) lines.push(l.map(([u, v]) => [x + u * h * k, top + v * h]));
    x += c.w * h * k + gap;
  }
  return lines;
}

// Layers drawn in order: { d: signed distance fn, color: [r,g,b] | fn(x,y) -> [r,g,b] }.
// -> RGBA Uint8Array(w*SIZE*4) (w = SIZE unless given), straight alpha.
function rasterize(layers, width) {
  const W = width || SIZE;
  const out = new Uint8Array(W * SIZE * 4);
  const n = SS * SS;
  for (let py = 0; py < SIZE; py++) {
    for (let px = 0; px < W; px++) {
      let r = 0, g = 0, b = 0, a = 0;   // premultiplied, 0..1
      for (const L of layers) {
        let hit = 0;
        for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
          if (L.d(px + (sx + 0.5) / SS, py + (sy + 0.5) / SS) <= 0) hit++;
        }
        if (!hit) continue;
        const cov = hit / n;
        const c = typeof L.color === 'function' ? L.color(px + 0.5, py + 0.5) : L.color;
        r = (c[0] / 255) * cov + r * (1 - cov);
        g = (c[1] / 255) * cov + g * (1 - cov);
        b = (c[2] / 255) * cov + b * (1 - cov);
        a = cov + a * (1 - cov);
      }
      const o = (py * W + px) * 4;
      if (a > 0) {
        out[o] = Math.round(clamp01(r / a) * 255);
        out[o + 1] = Math.round(clamp01(g / a) * 255);
        out[o + 2] = Math.round(clamp01(b / a) * 255);
        out[o + 3] = Math.round(a * 255);
      }
    }
  }
  return out;
}

const C = 32, R = 31.6, RING = 2.3;          // the stock ball: centered, the whole 64 px (alpha box 0..63), a ~2 px black ring
const BLACK = [16, 16, 18], WHITE = [255, 255, 255];
// a ball's fill: the color, a touch darker toward the rim (the stock balls' look)
const ballFill = (rgb) => (x, y) => {
  const t = clamp01(Math.hypot(x - C, y - C) / (R - RING));
  return shade(rgb, 1.06 - 0.24 * t * t * t);
};
const outlinedLabel = (text, h, hw, outline) => {
  const lines = labelLines(text, C, C + 0.5, h, text.length > 1 ? 2.5 : 0, text.length > 1 ? 0.78 : 1);
  return [{ d: dStroke(lines, hw + outline), color: BLACK }, { d: dStroke(lines, hw), color: WHITE }];
};
const PILL_GRAY = hex('#6a7176');
const PS_DARK = hex('#2a2a31');
const PS_RIM = hex('#a7a7b4');

function drawBall(fill, letter) {
  return rasterize([
    { d: dCircle(C, C, R), color: BLACK },
    { d: dCircle(C, C, R - RING), color: ballFill(fill) },
    ...outlinedLabel(letter, 31, 3.6, 2.1),
  ]);
}
// LB / RB: a flat pill; LT / RT: a trigger (rounded top, squarer bottom); LS / RS: a ball.
function drawShoulder(kind, label, dark) {
  const fill = dark ? PS_DARK : PILL_GRAY;
  const layers = [];
  let shape, inner;
  if (kind === 'stick') { shape = dCircle(C, C, R); inner = dCircle(C, C, R - RING); }
  // the in-game list draws a picture about 12 px tall: both use the whole height, the label as big as a ball's letter
  else if (kind === 'trigger') { shape = dRoundBox(C, C, 31.6, 31.6, [24, 24, 8, 8]); inner = dRoundBox(C, C, 31.6 - RING, 31.6 - RING, [22, 22, 6, 6]); }
  else { shape = dRoundBox(C, C, 31.6, 25, [15, 15, 15, 15]); inner = dRoundBox(C, C, 31.6 - RING, 25 - RING, [13, 13, 13, 13]); }
  layers.push({ d: shape, color: BLACK });
  if (dark) {
    layers.push({ d: inner, color: PS_RIM });
    const inner2 = (x, y) => inner(x, y) + 1.6;
    layers.push({ d: inner2, color: (x, y) => shade(fill, 1.25 - 0.35 * clamp01((y - 8) / 48)) });
  } else {
    layers.push({ d: inner, color: (x, y) => shade(fill, 1.18 - 0.3 * clamp01((y - 8) / 48)) });
  }
  if (label === null) {
    // Start: three bars (both pads mark their start button so), spaced so they stay apart at the in-game ~12 px
    const bars = [-12, 0, 12].map((dy) => [[C - 14, C + dy], [C + 14, C + dy]]);
    layers.push({ d: dStroke(bars, 3.4 + 2.0), color: BLACK }, { d: dStroke(bars, 3.4), color: WHITE });
  } else layers.push(...outlinedLabel(label, label.length > 1 ? 31 : 31, 3.5, 2.0));
  return rasterize(layers);
}
// The PlayStation face buttons: a dark ball (a light rim inside the ring so it
// reads on a dark screenpack) and the shape in its color.
function drawPsFace(name) {
  const SYM = { cross: hex('#7aaeff'), circle: hex('#ff6168'), square: hex('#ff86cf'), triangle: hex('#3cd6a0') };
  const hw = 3.9, e = 13;
  let sym;
  if (name === 'cross') sym = dStroke([[[C - e, C - e], [C + e, C + e]], [[C + e, C - e], [C - e, C + e]]], hw);
  else if (name === 'circle') { const ring = dCircle(C, C, 14); sym = (x, y) => Math.abs(ring(x, y)) - hw; }
  else if (name === 'square') sym = dStroke([[[C - 12.5, C - 12.5], [C + 12.5, C - 12.5], [C + 12.5, C + 12.5], [C - 12.5, C + 12.5], [C - 12.5, C - 12.5]]], hw);
  else sym = dStroke([[[C, C - 15], [C + 15.5, C + 11.5], [C - 15.5, C + 11.5], [C, C - 15]]], hw);
  return rasterize([
    { d: dCircle(C, C, R), color: BLACK },
    { d: dCircle(C, C, R - RING), color: PS_RIM },
    { d: dCircle(C, C, R - RING - 1.6), color: (x, y) => shade(PS_DARK, 1.3 - 0.4 * clamp01((y - 4) / 56)) },
    { d: (x, y) => sym(x, y) - 1.2, color: BLACK },
    { d: sym, color: SYM[name] },
  ]);
}
const XBOX_FACE = { A: hex('#4fae32'), B: hex('#e2342f'), X: hex('#2f78dc'), Y: hex('#f2bd0f') };
const SHOULDER_KIND = { LB: 'bumper', RB: 'bumper', LT: 'trigger', RT: 'trigger', LS: 'stick', RS: 'stick' };
// THE PICTURES OF SEVERAL BUTTONS ('xbox:X/Y/RB', 'xbox:X+Y+RB'): each one's own
// 64 x 64 picture side by side, a slash (or plus) between them drawn like the
// labels (white, black outline), in a slot narrower than a ball. One sprite,
// SIZE tall, as wide as the parts.
// (bold like the stock arrows: a thin one turns gray at the in-game ~12 px on a light screen)
const SEP_W = 36;
function drawSeveral(style, pads, sep) {
  const parts = pads.map((p) => icon(style + ':' + p));
  const W = parts.length * SIZE + (parts.length - 1) * SEP_W;
  const marks = [];
  for (let k = 1; k < parts.length; k++) {
    const x = k * SIZE + (k - 1) * SEP_W, cx = x + SEP_W / 2;
    if (sep === '/') marks.push([[cx - 7, C + 20], [cx + 7, C - 20]]);
    else marks.push([[cx - 11, C], [cx + 11, C]], [[cx, C - 11], [cx, C + 11]]);
  }
  const out = rasterize([{ d: dStroke(marks, 4.6 + 2.4), color: BLACK }, { d: dStroke(marks, 4.6), color: WHITE }], W);
  parts.forEach((px, k) => {
    const x0 = k * (SIZE + SEP_W);
    for (let y = 0; y < SIZE; y++) Buffer.from(px.buffer, px.byteOffset + y * SIZE * 4, SIZE * 4).copy(Buffer.from(out.buffer, out.byteOffset, out.length), (y * W + x0) * 4);
  });
  return { px: out, w: W };
}
const ICONS = new Map();
function drawn(id) {
  if (ICONS.has(id)) return ICONS.get(id);
  const [style, pad] = String(id).split(':');
  let px = null, w = SIZE;
  const several = /^[A-Z]+(?:([/+])[A-Z]+)+$/.exec(pad || '');
  if (several && (style === 'xbox' || style === 'playstation')) { const r = drawSeveral(style, pad.split(several[1]), several[1]); px = r.px; w = r.w; }
  else if (style === 'xbox' && XBOX_FACE[pad]) px = drawBall(XBOX_FACE[pad], pad);
  else if (style === 'xbox' && pad === 'START') px = drawShoulder('bumper', null, false);
  else if (style === 'xbox' && SHOULDER_KIND[pad]) px = drawShoulder(SHOULDER_KIND[pad], pad, false);
  else if (style === 'playstation' && PS_NAME[pad]) px = drawPsFace(PS_NAME[pad]);
  else if (style === 'playstation' && pad === 'START') px = drawShoulder('bumper', null, true);
  else if (style === 'playstation' && SHOULDER_KIND[pad]) px = drawShoulder(SHOULDER_KIND[pad], PS_LABEL[pad], true);
  if (!px) throw new Error('no button picture ' + id);
  const r = { px, w };
  ICONS.set(id, r);
  return r;
}
// 'xbox:A' -> RGBA (iconWidth(id) x SIZE; SIZE x SIZE but for several buttons), cached
const icon = (id) => drawn(id).px;
const iconWidth = (id) => drawn(id).w;

// ---- PNG (RGBA, color type 6) ---------------------------------------------------------
let CRC = null;
function crc32(buf) {
  if (!CRC) { CRC = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC[n] = c >>> 0; } }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}
function encodePng(rgba, w, h) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1); }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), pngChunk('IHDR', ihdr), pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })), pngChunk('IEND', Buffer.alloc(0))]);
}
const iconPng = (id) => encodePng(icon(id), iconWidth(id), SIZE);

// ---- the glyph SFF (v2) ----------------------------------------------------------------
const isSff = (buf) => !!buf && buf.length >= 64 && buf.slice(0, 11).toString('latin1') === 'ElecbyteSpr';
const isV2 = (buf) => isSff(buf) && buf[15] === 2;
// [{ group, index, w, h, axisX, axisY, fmt, ofs, len, flags, k }] of an SFF v2
function sffNodes(buf) {
  if (!isV2(buf)) return null;
  const sprOfs = buf.readUInt32LE(36), count = buf.readUInt32LE(40);
  const out = [];
  for (let k = 0; k < count; k++) {
    const at = sprOfs + k * 28;
    if (at + 28 > buf.length) break;
    out.push({ k, group: buf.readUInt16LE(at), index: buf.readUInt16LE(at + 2), w: buf.readUInt16LE(at + 4), h: buf.readUInt16LE(at + 6),
      axisX: buf.readInt16LE(at + 8), axisY: buf.readInt16LE(at + 10), linked: buf.readUInt16LE(at + 12), fmt: buf[at + 14], depth: buf[at + 15],
      ofs: buf.readUInt32LE(at + 16), len: buf.readUInt32LE(at + 20), pal: buf.readUInt16LE(at + 24), flags: buf.readUInt16LE(at + 26) });
  }
  return out;
}
// A sprite's own data bytes (a PNG sprite: u32 raw size + the PNG), or null.
function spriteData(buf, node) {
  if (!node || !node.len) return null;
  const base = (node.flags & 1) === 0 ? buf.readUInt32LE(52) : buf.readUInt32LE(60);
  const at = base + node.ofs;
  return at + node.len <= buf.length ? buf.subarray(at, at + node.len) : null;
}
// The input with sprites appended (the node table moves to the end, whole; the
// data goes after the file's end, its offsets counted from ldata, as
// portraitfit.js fitSffV2 does). sprites: [{ group, index, w, h, axisX, axisY, fmt, depth, data }]
function appendSprites(input, sprites) {
  if (!isV2(input)) throw new Error('not an SFF v2');
  const sprOfs = input.readUInt32LE(36), count = input.readUInt32LE(40), lofs = input.readUInt32LE(52);
  const head = Buffer.from(input);
  const blobs = [], nodes = [];
  let cursor = input.length;
  for (const s of sprites) {
    const node = Buffer.alloc(28);
    node.writeUInt16LE(s.group, 0); node.writeUInt16LE(s.index || 0, 2);
    node.writeUInt16LE(s.w, 4); node.writeUInt16LE(s.h, 6);
    node.writeInt16LE(s.axisX, 8); node.writeInt16LE(s.axisY, 10);
    node.writeUInt16LE(0, 12);
    node[14] = s.fmt; node[15] = s.depth;
    node.writeUInt32LE(cursor - lofs, 16); node.writeUInt32LE(s.data.length, 20);
    node.writeUInt16LE(0, 24); node.writeUInt16LE(0, 26);
    blobs.push(s.data); nodes.push(node); cursor += s.data.length;
  }
  const table = Buffer.concat([input.subarray(sprOfs, sprOfs + count * 28), ...nodes]);
  head.writeUInt32LE(cursor, 36);
  head.writeUInt32LE(count + sprites.length, 40);
  return Buffer.concat([head, ...blobs, table]);
}
// A drawn picture as an SFF v2 PNG32 sprite (format 12, as the stock glyphs).
function pngSprite(id) {
  const png = iconPng(id);
  const data = Buffer.alloc(4 + png.length);
  const w = iconWidth(id);
  data.writeUInt32LE(w * SIZE * 4, 0); png.copy(data, 4);
  return { w, h: SIZE, fmt: 12, depth: 32, data };
}

// ---- the motif -----------------------------------------------------------------------
const MARK = 'Command List buttons';
const markOf = (style) => ';' + MARK + ' (' + style + '), written by the export';
// Every line this file adds carries the mark: an earlier export's lines are found by it.
const patched = (text) => new RegExp(';' + MARK + ' \\((?:xbox|playstation|strength)\\), written by the export').test(String(text || ''));
const FILE_RE = /^cmdlist-buttons-(xbox|playstation|strength)\.sff$/i;
const fileFor = (style) => 'cmdlist-buttons-' + style + '.sff';

function sections(text) {
  const out = [];
  const re = /^[ \t]*\[([^\]\r\n]+)\][^\r\n]*$/gm;
  for (let m; (m = re.exec(text));) {
    if (out.length) out[out.length - 1].end = m.index;
    const nl = text.indexOf('\n', m.index);
    out.push({ name: m[1].trim().toLowerCase(), start: m.index, bodyStart: nl < 0 ? text.length : nl + 1, end: text.length });
  }
  return out;
}
// The motif's [Files] glyphs value (its first), else the engine default.
function glyphsFile(text) {
  const t = String(text || '');
  const f = sections(t).find((s) => s.name === 'files');
  const m = f && /^[ \t]*glyphs[ \t]*=[ \t]*([^;\r\n]*?)[ \t]*(?:;.*)?$/mi.exec(t.slice(f.bodyStart, f.end));
  const v = m ? m[1].trim().replace(/^"(.*)"$/, '$1').replace(/\\/g, '/') : '';
  return v || 'glyphs.sff';
}
// The places the engine looks for it (beside the motif, as is, data/), as paths relative to the build root.
function glyphsCandidates(motifVpath, value) {
  const dir = String(motifVpath || '').replace(/\\/g, '/').replace(/[^/]*$/, '');
  const v = String(value || 'glyphs.sff').replace(/\\/g, '/').replace(/^\.\//, '');
  return [...new Set([dir + v, v, 'data/' + v])];
}
// The build's copy of a motif with the style: { text } - overrides: { '^A': [g, i] },
// file: the glyph SFF to name in [Files] (null = keep the motif's own).
function patchMotif(text, style, overrides, file) {
  let t = String(text);
  const eol = /\r\n/.test(t) ? '\r\n' : '\n';
  const mark = markOf(style);
  if (file) {
    const fsec = sections(t).find((s) => s.name === 'files');
    const fline = 'glyphs = ' + file + ' ' + mark + eol;
    if (fsec) t = t.slice(0, fsec.bodyStart) + fline + t.slice(fsec.bodyStart);
    else t = '[Files]' + eol + fline + eol + t;
  }
  const keys = Object.keys(overrides || {});
  if (keys.length) {
    const lines = keys.map((k) => k + ' = ' + overrides[k][0] + ', ' + overrides[k][1] + ' ' + mark + eol).join('');
    const g = sections(t).find((s) => s.name === 'glyphs');
    if (g) t = t.slice(0, g.bodyStart) + lines + t.slice(g.bodyStart);
    else t = t.replace(/\s*$/, '') + eol + eol + '[Glyphs]' + eol + lines;
  }
  return { text: t };
}

// The motif's own [Glyphs] keys: { '^LP': [57, 0], ... } (case kept: the engine's
// glyph keys are case-sensitive; a key's first value wins, every [Glyphs] section in order).
function ownGlyphs(text) {
  const t = String(text || '');
  const out = {};
  for (const s of sections(t)) {
    if (s.name !== 'glyphs') continue;
    for (const line of t.slice(s.bodyStart, s.end).split(/\r?\n/)) {
      const m = /^[ \t]*([^=;\s][^=;]*?)[ \t]*=[ \t]*(-?\d+)[ \t]*,[ \t]*(-?\d+)/.exec(line);
      if (m && !Object.prototype.hasOwnProperty.call(out, m[1])) out[m[1]] = [+m[2], +m[3]];
    }
  }
  return out;
}

// THE PLAN for one build: the glyph file it uses (`base`, a Buffer, or null),
// the engine's own glyphs.sff (`stock`, for the strength sprites a pack's own
// file lacks), the style, the bindings, the motif's own [Glyphs] keys (`own`,
// ownGlyphs: a pack that maps ^LP..^HK somewhere of its own). -> null (nothing
// to change) or { style, overrides, sprites, needFile, rows, notes }
function plan(style, keys, base, stock, own) {
  const st = normalize(style);
  if (st === DEFAULT_STYLE) return null;
  const rows = mapping(st, keys);
  const notes = [];
  const nodes = base ? sffNodes(base) : null;
  const has = new Map();
  if (nodes) for (const n of nodes) { const k = n.group + ',' + n.index; if (!has.has(k)) has.set(k, n); }
  const overrides = {}, sprites = [];
  let needFile = false;
  // the art's axis follows the file's own button ball (^A's 1,0; else the first sprite), scaled to the picture
  // (a picture of several buttons is wider: its x axis keeps the ball's share of the width)
  const ref = (nodes && (has.get('1,0') || nodes.find((n) => n.w && n.h))) || null;
  const axisFor = (w) => (ref && ref.w && ref.h ? [Math.round(ref.axisX * w / ref.w), Math.round(ref.axisY * SIZE / ref.h)] : [0, SIZE]);
  if (st === 'strength') {
    const stockNodes = stock ? sffNodes(stock) : null;
    for (const r of rows) {
      if (!r.stock) continue;
      // the pack's own ^LP..^HK line, when the sprite it names is in its file: the picture the pack draws for that strength
      const mine = own && own['^' + r.label];
      if (mine && has.has(mine[0] + ',' + mine[1]) && has.get(mine[0] + ',' + mine[1]).len) { overrides[r.token] = [mine[0], mine[1]]; continue; }
      const key = r.stock + ',0';
      if (has.has(key) && has.get(key).len) { overrides[r.token] = [r.stock, 0]; continue; }
      // the pack's own glyph file has no such sprite: the engine's own goes in beside the rest
      const sn = stockNodes && stockNodes.find((n) => n.group === r.stock && n.index === 0);
      const data = sn && spriteData(stock, sn);
      if (!nodes || !sn || !data || !(sn.fmt === 11 || sn.fmt === 12)) { notes.push(r.token + ' keeps its picture: no ' + r.label + ' sprite (' + key + ') to use'); continue; }
      if (!sprites.some((s) => s.group === r.stock)) sprites.push({ group: r.stock, index: 0, w: sn.w, h: sn.h, axisX: sn.axisX, axisY: sn.axisY, fmt: sn.fmt, depth: sn.depth, data: Buffer.from(data) });
      overrides[r.token] = [r.stock, 0];
      needFile = true;
    }
    return { style: st, overrides, sprites, needFile, rows, notes };
  }
  if (!nodes) {
    notes.push('the glyph file is not an SFF v2 this export can add pictures to; the buttons keep their pictures');
    return { style: st, overrides: {}, sprites: [], needFile: false, rows, notes };
  }
  // a free block of groups for the drawn pictures
  let g0 = 9100;
  const used = new Set(nodes.map((n) => n.group));
  const block = 32;
  for (;;) { let free = true; for (let g = g0; g < g0 + block; g++) if (used.has(g)) { free = false; break; } if (free) break; g0 += 100; if (g0 > 65000) { g0 = -1; break; } }
  if (g0 < 0) { notes.push('no free sprite group in the glyph file'); return { style: st, overrides: {}, sprites: [], needFile: false, rows, notes }; }
  const ids = [];
  const take = (r) => {
    let k = ids.indexOf(r.icon);
    if (k < 0) { k = ids.length; ids.push(r.icon); }
    overrides[r.token] = [g0 + k, 0];
  };
  for (const r of rows) {
    if (!r.icon) { if (r.keeps !== undefined) notes.push(r.token + ' keeps its picture: ' + r.button + ' is bound to ' + r.keeps); continue; }
    take(r);
  }
  // any punch / any kick / all three / Start: one picture of the bound buttons
  for (const e of extras(st, keys)) {
    if (!e.icon) { if (e.keeps !== undefined) notes.push(e.token + ' (' + e.word + ') keeps its picture: ' + e.keeps); continue; }
    take(e);
  }
  for (let k = 0; k < ids.length; k++) {
    const s = pngSprite(ids[k]);
    const axis = axisFor(s.w);
    sprites.push(Object.assign({ group: g0 + k, index: 0, axisX: axis[0], axisY: axis[1] }, s));
  }
  needFile = sprites.length > 0;
  return { style: st, overrides, sprites, needFile, rows, notes };
}

// ONE BUILD: the motif text as the build has it so far, a reader for the
// build's files by path (relative to its root; -> Buffer | null), the roster.
// -> null, or { text: the patched motif, file: { vpath, buf } | null, info }
function forBuild(motifVpath, motifText, read, roster) {
  const style = styleOf(roster);
  if (style === DEFAULT_STYLE) return null;
  if (patched(motifText)) return null;      // already done (the generated copy the desktop writes)
  const value = glyphsFile(motifText);
  let baseAt = null, base = null;
  for (const c of glyphsCandidates(motifVpath, value)) { const b = read(c); if (b) { baseAt = c; base = b; break; } }
  const stock = read('data/glyphs.sff');
  const p = plan(style, roster && roster.keys, base, stock, ownGlyphs(motifText));
  if (!p || !Object.keys(p.overrides).length) return { text: motifText, file: null, info: { style, overrides: {}, base: baseAt, notes: (p && p.notes) || [] } };
  const dir = String(motifVpath).replace(/\\/g, '/').replace(/[^/]*$/, '');
  let file = null;
  if (p.needFile) file = { vpath: dir + fileFor(style), buf: appendSprites(base, p.sprites) };
  const text = patchMotif(motifText, style, p.overrides, file ? fileFor(style) : null).text;
  return { text, file, info: { style, overrides: p.overrides, base: baseAt, file: file ? file.vpath : null, sprites: p.sprites.length, notes: p.notes } };
}

// For the page: each style's pictures for the 8 buttons, then any punch (p),
// any kick (k) and Start (s) (`extra: true`), as data: URLs with their size
// (w x h; a picture of several buttons is wider than tall).
// stock = the engine's own glyphs.sff (the arcade and strength pictures).
const PREVIEW_EXTRAS = ['p', 'k', 's'];
function preview(keys, stock) {
  const stockNodes = stock ? sffNodes(stock) : null;
  const stockPic = (group) => {
    const n = stockNodes && stockNodes.find((x) => x.group === group && x.index === 0);
    const d = n && spriteData(stock, n);
    return d && (n.fmt === 11 || n.fmt === 12) ? { src: 'data:image/png;base64,' + Buffer.from(d.subarray(4)).toString('base64'), w: n.w, h: n.h } : { src: null, w: SIZE, h: SIZE };
  };
  const drawnPic = (id) => { try { return { src: 'data:image/png;base64,' + iconPng(id).toString('base64'), w: iconWidth(id), h: SIZE }; } catch (e) { return { src: null, w: SIZE, h: SIZE }; } };
  const ARCADE = { a: 1, b: 2, c: 3, d: 4, w: 23, x: 24, y: 25, z: 26 };
  return STYLES.map((s) => ({
    id: s.id, label: s.label, note: s.note,
    buttons: [
      ...mapping(s.id, keys).map((r) => {
        const pic = r.icon ? drawnPic(r.icon) : stockPic(r.stock || ARCADE[r.button]);
        return { button: r.button, token: r.token, pad: r.pad, label: r.label, keeps: r.keeps, src: pic.src, w: pic.w, h: pic.h };
      }),
      ...extras(s.id, keys).filter((e) => PREVIEW_EXTRAS.includes(e.button)).map((e) => {
        const pic = e.icon ? drawnPic(e.icon) : stockPic(e.stock);
        return { button: e.button, token: e.token, pad: e.pad, label: e.label, word: e.word, keeps: e.keeps, extra: true, src: pic.src, w: pic.w, h: pic.h };
      }),
    ],
  }));
}

module.exports = {
  STYLES, STYLE_IDS, DEFAULT_STYLE, BUTTONS, STRENGTH, EXTRAS, SIZE, MARK, FILE_RE,
  normalize, styleOf, padMap, mapping, extras, icon, iconWidth, iconPng, encodePng, rasterize,
  isV2, sffNodes, spriteData, appendSprites, pngSprite,
  patched, fileFor, sections, glyphsFile, glyphsCandidates, ownGlyphs, patchMotif, plan, forBuild, preview,
};
