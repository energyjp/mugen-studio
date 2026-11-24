'use strict';
// THE COMMAND LIST FITTED TO ITS ROWS ON UPSTREAM'S OFFICIAL ENGINE (the
// Desktop export).
//
// The modern-input pause menu draws a character's Command List as menu rows,
// one per movelist line, its columns split by tabs (menu.lua f_movelistRows: no
// tab = left, one = centered, two or more = right) and placed by
// main.f_menuItemTextDraw: a left column at the list's x, a right column ending
// at x + `movelist.menu.window.width`. The Studio's lists (cmdlist.js) write
// "name<TAB><TAB>commands", so the commands are anchored at that width,
// whatever the name. Upstream's engine has no other rule: our web engine's
// per-page column (commands one row pitch past the widest name, the page
// widened when it needs it; engine d9078eb1, plan 1.23) is ours alone.
//
// So on the desktop a list wider than its window draws its commands over the
// names (the owner's desktop test, 2026-11-18: "the text is getting cut off
// (still renders behind) our drawn input icons"). The stock ikemen1 copy the
// Studio ships sets only 1.0's `movelist.window.width = 900`, which this
// engine does not read, so its list inherits the pause menu's x (414) and
// keeps the engine default width 290: commands end at x 704 on a 1280 screen,
// over "Super Deadly Ninja Bees Lv.3" and every longer Japanese name drawn in
// DotGothic16 (jpfont.pointRowsV2: the whole list in that font on desktop).
//
// The build's copy of the motif gets, in each pause menu whose list does not
// fit, the list's own window as wide as its widest row needs: the widest of
// (left columns + a gap + right columns) over every row of every character in
// the build, measured as the engine measures it (TrueType advances from the
// font's own tables at its Size, a MUGEN .fnt's char widths and spacing, each
// glyph picture as tall as the font times its glyph scale and as wide as its
// sprite's shape, the glyph spacing at each picture), the gap one text height.
// The window is centered on the screen; its box (`movelist.menu.boxcursor.
// coords`, which the engine also sizes the backing from) spans it with the
// box's own left padding on the right too, and the scroll arrows keep their
// distance from the box's right edge. Wider than the screen allows (5% margin
// each side): the rows' scale shrinks until the widest row fits, glyphs with
// them. A list that already fits gets nothing. Every line goes first in its
// section (the engine reads a key's first value) with MARK, so a later export
// finds and replaces them. The installed pack is never written; web builds do
// not call this (their engine places the commands itself).
//
// Pure apart from `read` (path relative to the build root -> Buffer | null).

const BTN = require('./buttonstyle.js');

const MARK = ';the Command List fitted to its rows (this engine anchors the commands at the window width), written by the export';
const marked = (text) => String(text || '').includes(MARK);

// The movelist part of the engine's own [Glyphs] (defaultMotif.ini of
// upstream 07c692fb, the official zip's engine): token -> sprite.
const GLYPHS = {
  '^A': [1, 0], '^B': [2, 0], '^C': [3, 0], '^D': [4, 0], '^W': [23, 0], '^X': [24, 0], '^Y': [25, 0], '^Z': [26, 0],
  '_+': [39, 0], '_.': [40, 0], '_DB': [41, 0], '_D': [42, 0], '_DF': [43, 0], '_B': [44, 0], '_F': [46, 0], '_UB': [47, 0], '_U': [48, 0], '_UF': [49, 0],
  '^S': [51, 0], '^M': [52, 0], '^P': [53, 0], '^K': [54, 0], '^LP': [57, 0], '^MP': [58, 0], '^HP': [59, 0], '^LK': [60, 0], '^MK': [61, 0], '^HK': [62, 0],
  '^3K': [63, 0], '^3P': [64, 0], '^2K': [65, 0], '^2P': [66, 0], '_-': [90, 0], '_!': [91, 0],
  '~DB': [92, 0], '~D': [93, 0], '~DF': [94, 0], '~B': [95, 0], '~F': [96, 0], '~UB': [97, 0], '~U': [98, 0], '~UF': [99, 0],
  '_HCB': [100, 0], '_HUF': [101, 0], '_HCF': [102, 0], '_HUB': [103, 0], '_QFD': [104, 0], '_QDB': [105, 0], '_QCB': [105, 0], '_QBU': [106, 0],
  '_QUF': [107, 0], '_QBD': [108, 0], '_QDF': [109, 0], '_QCF': [109, 0], '_QFU': [110, 0], '_QUB': [111, 0], '_FDF': [112, 0], '_FUB': [113, 0],
  '_FUF': [114, 0], '_FDB': [115, 0], '_XFF': [116, 0], '_XBB': [117, 0], '_DSF': [118, 0], '_DSB': [119, 0],
  '_AIR': [121, 0], '_TAP': [122, 0], '_MAX': [123, 0], '_EX': [124, 0], '_^': [127, 0], '_=': [128, 0], '_)': [129, 0], '_(': [130, 0], '_`': [135, 0],
  '_CHARGE': [136, 0], '_HOLD': [137, 0], '_RELEASE': [138, 0], '_MASH': [139, 0], '_CLOSE': [140, 0], '_FAR': [141, 0], '_AIROK': [142, 0],
  '_THROW': [143, 0], '_COUNTER': [144, 0],
};

// The engine's defaults for the list ([Pause Menu], defaultMotif.ini), used
// where neither the list's own key nor the pause menu's key it inherits is set.
const DEFAULTS = {
  'menu.pos': '15, 33', 'menu.window.width': '290', 'menu.boxcursor.coords': '-5, -10, 294, 3',
  'menu.item.font': 'Open_Sans.def, 0, 1, 191, 191, 191, 255, -1', 'menu.item.active.font': 'Open_Sans.def, 0, 1, 255, 255, 255, 255, -1',
  'menu.item.scale': '0.3333, 0.3333', 'menu.item.active.scale': '0.3333, 0.3333', 'menu.item.uppercase': '0',
  'menu.arrow.up.spr': '400, 0', 'menu.arrow.up.anim': '-1', 'menu.arrow.up.offset': '283, -17', 'menu.arrow.up.scale': '0.3333, 0.3333',
  'menu.arrow.down.spr': '401, 0', 'menu.arrow.down.anim': '-1', 'menu.arrow.down.offset': '283, 175', 'menu.arrow.down.scale': '0.3333, 0.3333',
};
// The screen's margin each side when the list must widen, as a share of its width.
const MARGIN = 0.05;

const nums = (v) => String(v == null ? '' : v).split(',').map((x) => parseFloat(x)).filter((x) => Number.isFinite(x));
const r2 = (v) => Math.round(v * 1000) / 1000;

// ---- the motif --------------------------------------------------------------------
// A section's keys: lowercased name -> value (the first wins, comments cut).
function keysOf(text, sec) {
  const out = new Map();
  if (!sec) return out;
  for (const raw of text.slice(sec.bodyStart, sec.end).split(/\r?\n/)) {
    const m = /^[ \t]*([^;=\s\[][^=;]*?)[ \t]*=[ \t]*([^;\r\n]*?)[ \t]*(?:;.*)?$/.exec(raw);
    if (m && !out.has(m[1].toLowerCase())) out.set(m[1].toLowerCase(), m[2]);
  }
  return out;
}
// [Files] fonts: index -> { file, height, glyphScale, glyphSpacing }.
function filesFonts(text) {
  const f = BTN.sections(text).find((s) => s.name === 'files');
  const k = keysOf(text, f);
  const out = new Map();
  for (const [key, v] of k) {
    const m = /^font(\d+)$/.exec(key);
    if (!m) continue;
    const n = m[1];
    out.set(parseInt(n, 10), {
      file: v.replace(/^"|"$/g, '').trim(),
      height: k.has('font' + n + '.height') ? parseInt(k.get('font' + n + '.height'), 10) : -1,
      glyphScale: k.has('font' + n + '.glyphs.scale') ? nums(k.get('font' + n + '.glyphs.scale')) : null,
      glyphSpacing: k.has('font' + n + '.glyphs.spacing') ? nums(k.get('font' + n + '.glyphs.spacing'))[0] : null,
    });
  }
  return out;
}

// ---- fonts --------------------------------------------------------------------------
// A TrueType file's advance widths: { upem, adv(codepoint) -> font units | null } or null.
function ttfAdvances(b) {
  try {
    const tables = {};
    for (let i = 0, n = b.readUInt16BE(4); i < n; i++) { const r = 12 + 16 * i; tables[b.toString('latin1', r, r + 4)] = b.readUInt32BE(r + 8); }
    if (tables.head === undefined || tables.hhea === undefined || tables.hmtx === undefined || tables.cmap === undefined) return null;
    const upem = b.readUInt16BE(tables.head + 18);
    const nH = b.readUInt16BE(tables.hhea + 34);
    const cmap = tables.cmap;
    let best = null;
    for (let i = 0, n = b.readUInt16BE(cmap + 2); i < n; i++) {
      const r = cmap + 4 + 8 * i, pid = b.readUInt16BE(r), at = cmap + b.readUInt32BE(r + 4), fmt = b.readUInt16BE(at);
      const score = fmt === 12 ? 3 : (fmt === 4 && (pid === 3 || pid === 0)) ? 2 : 0;
      if (score && (!best || score > best.score)) best = { score, at, fmt };
    }
    if (!best || !upem) return null;
    const gid = (c) => {
      if (best.fmt === 12) {
        for (let i = 0, ng = b.readUInt32BE(best.at + 12); i < ng; i++) {
          const r = best.at + 16 + 12 * i, s = b.readUInt32BE(r), e = b.readUInt32BE(r + 4);
          if (c >= s && c <= e) return b.readUInt32BE(r + 8) + (c - s);
        }
        return 0;
      }
      if (c > 0xffff) return 0;
      const segX2 = b.readUInt16BE(best.at + 6), ends = best.at + 14, starts = ends + segX2 + 2, deltas = starts + segX2, ranges = deltas + segX2;
      for (let k = 0; k < segX2 / 2; k++) {
        if (c > b.readUInt16BE(ends + 2 * k)) continue;
        const s = b.readUInt16BE(starts + 2 * k);
        if (c < s) return 0;
        const d = b.readInt16BE(deltas + 2 * k), ro = b.readUInt16BE(ranges + 2 * k);
        if (!ro) return (c + d) & 0xffff;
        const g = b.readUInt16BE(ranges + 2 * k + ro + 2 * (c - s));
        return g ? (g + d) & 0xffff : 0;
      }
      return 0;
    };
    const cache = new Map();
    const adv = (c) => {
      if (cache.has(c)) return cache.get(c);
      const g = gid(c);
      const v = g ? b.readUInt16BE(tables.hmtx + 4 * Math.min(g, nH - 1)) : null;
      cache.set(c, v);
      return v;
    };
    return { upem, adv };
  } catch (e) { return null; }
}
// A font .def's [Def] keys (latin1 text) or null.
function defKeys(t) {
  const m = /^[ \t]*\[def\][^\r\n]*$([\s\S]*?)(?=^[ \t]*\[|(?![\s\S]))/mi.exec(String(t || ''));
  if (!m) return null;
  return keysOf(m[1], { bodyStart: 0, end: m[1].length });
}
const dirOf = (p) => String(p || '').replace(/\\/g, '/').replace(/[^/]*$/, '');
const firstRead = (read, list) => { for (const c of [...new Set(list)]) { const b = read(c); if (b) return { at: c, buf: b }; } return null; };
// A row font as the engine loads it: { kind: 'ttf' | 'fnt' | 'fixed', size, spacing,
// width(text) -> font pixels, glyphScale, glyphSpacing, file }.
function loadFont(value, text, motifVpath, read) {
  const parts = String(value || '').split(',').map((s) => s.trim());
  let file = parts[0], height = parts.length > 7 && /^-?\d+$/.test(parts[7]) ? parseInt(parts[7], 10) : -1;
  let fs = null;
  if (/^-?\d+$/.test(file)) {
    const n = parseInt(file, 10);
    if (n < 0) return null;
    fs = filesFonts(text).get(n);
    // the engine's own font0 / font1 when the pack does not set them
    if (!fs) fs = n === 0 ? { file: 'Open_Sans.def', height: -1 } : n === 1 ? { file: 'default-3x5.def', height: -1 } : null;
    if (!fs) return null;
    file = fs.file;
    if (height < 0) height = fs.height;
  }
  file = file.replace(/^"|"$/g, '').replace(/\\/g, '/');
  const mdir = dirOf(motifVpath);
  const found = firstRead(read, [mdir + file, 'font/' + file, file, 'data/' + file]);
  if (!found) return null;
  const out = { file: found.at, glyphScale: [1, 1], glyphSpacing: 0 };
  if (/\.fnt$/i.test(found.at)) {
    const f = require('./wordglyphs.js').readFnt(found.buf);
    if (!f) return null;
    Object.assign(out, { kind: 'fnt', size: f.size, spacing: f.spacing });
    out.width = (s) => {
      let w = 0, n = 0;
      for (const ch of s) { const c = f.chars.get(ch); const cw = c ? c.w : 0; if (cw + f.spacing[0] > 0) { w += cw + (n ? f.spacing[0] : 0); n++; } }
      return w;
    };
  } else {
    const d = defKeys(found.buf.toString('latin1'));
    if (!d) return null;
    const size = nums(d.get('size'));
    if (size.length < 2) return null;
    const spacing = nums(d.get('spacing') || '0, 0');
    out.size = [size[0], size[1]];
    out.spacing = [spacing[0] || 0, spacing[1] || 0];
    const gs = nums(d.get('glyphs.scale'));
    if (gs.length) out.glyphScale = [gs[0], gs.length > 1 ? gs[1] : gs[0]];
    if (d.has('glyphs.spacing')) out.glyphSpacing = nums(d.get('glyphs.spacing'))[0] || 0;
    const type = String(d.get('type') || '').toLowerCase();
    const inner = String(d.get('file') || '').replace(/^"|"$/g, '').replace(/\\/g, '/');
    if (type === 'truetype') {
      if (height > 0) out.size[1] = height;
      const tt = inner ? firstRead(read, [dirOf(found.at) + inner, mdir + inner, inner, 'data/' + inner, 'font/' + inner]) : null;
      const adv = tt ? ttfAdvances(tt.buf) : null;
      if (!adv) return null;
      out.kind = 'ttf';
      const px = out.size[1] / adv.upem;
      // each advance rounded up to a whole pixel: the renderer's glyphs are whole pixels
      out.width = (s) => { let w = 0; for (const ch of s) { const a = adv.adv(ch.codePointAt(0)); w += Math.ceil((a == null ? adv.upem / 2 : a) * px); } return w; };
    } else {
      // a sprite font: every char its cell (Size) plus the spacing, the widest it can be
      out.kind = 'fixed';
      out.width = (s) => { const n = [...s].length; return n ? n * out.size[0] + (n - 1) * out.spacing[0] : 0; };
    }
  }
  if (fs && fs.glyphScale && fs.glyphScale.length) out.glyphScale = [fs.glyphScale[0], fs.glyphScale.length > 1 ? fs.glyphScale[1] : fs.glyphScale[0]];
  if (fs && fs.glyphSpacing != null) out.glyphSpacing = fs.glyphSpacing;
  return out;
}

// ---- the rows -------------------------------------------------------------------------
// A movelist file's rows as the engine splits them: [[{ text, align }], ...]
// (align 1 left, 0 centered, -1 right).
function rowsOf(movelist) {
  const out = [];
  const t = String(movelist || '').replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\n$/, '');
  if (!/\S/.test(t)) return out;
  for (let line of t.split('\n')) {
    line = line.replace(/\s+$/, '').replace(/^<spacer>/, '');
    const cols = [];
    for (const m of line.matchAll(/(\t*[^\t]+)/g)) {
      const tabs = /^\t*/.exec(m[1])[0].length;
      cols.push({ text: m[1].slice(tabs), align: tabs === 0 ? 1 : tabs === 1 ? 0 : -1 });
    }
    if (cols.length) out.push(cols);
  }
  return out;
}
// A column's runs: [{ glyph: [g, i] } | { text }] (color tags dropped). Plain
// glyph names are matched longest first, as the engine wraps them in <>.
function runsOf(text, glyphs, keysByLength) {
  const runs = [];
  let buf = '';
  const flush = () => { if (buf) { runs.push({ text: buf }); buf = ''; } };
  const s = String(text);
  for (let i = 0; i < s.length;) {
    if (s[i] === '<') {
      const e = s.indexOf('>', i);
      if (e > i) {
        const tag = s.slice(i + 1, e);
        if (tag === '/' || /^#[0-9a-f]{6}$/i.test(tag) || /^color:/i.test(tag)) { i = e + 1; continue; }
        const name = tag.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
        if (glyphs[name]) { flush(); runs.push({ glyph: glyphs[name] }); i = e + 1; continue; }
      }
    }
    const k = keysByLength.find((key) => s.startsWith(key, i));
    if (k) { flush(); runs.push({ glyph: glyphs[k] }); i += k.length; continue; }
    const cp = s.codePointAt(i);
    buf += String.fromCodePoint(cp);
    i += cp > 0xffff ? 2 : 1;
  }
  flush();
  return runs;
}
// A column's width in font pixels (the engine's glyphTextWidth at scale 1).
function columnWidth(runs, font, sprites) {
  let w = 0;
  runs.forEach((r, i) => {
    if (i > 0) {
      const prev = runs[i - 1];
      if (prev.glyph || r.glyph) w += font.glyphSpacing;
      else if (font.kind !== 'ttf') w += font.spacing[0];
    }
    if (r.glyph) {
      const sp = sprites.get(r.glyph[0] + ',' + r.glyph[1]);
      const aspect = sp && sp.h ? sp.w / sp.h : 1;
      w += font.size[1] * aspect * font.glyphScale[0];
    } else {
      w += font.width(r.text);
    }
  });
  return w;
}
// The width a row needs (font pixels at scale 1) so its columns neither meet
// nor leave the window: left columns chain from the left, right ones from the
// right, centered ones around the middle; `gap` between groups.
function rowNeed(widths, gap) {
  let L = 0, R = 0, C = 0;
  for (const c of widths) { if (c.align === 1) L += c.w; else if (c.align === -1) R += c.w; else C += c.w; }
  if (!C) return L && R ? L + gap + R : Math.max(L, R);
  return Math.max(L ? 2 * (L + gap) + C : C, R ? 2 * (R + gap) + C : C);
}

// ---- the fit ----------------------------------------------------------------------------
// The motif without lines an earlier fit wrote.
function unfit(text) {
  const t = String(text);
  if (!marked(t)) return t;
  return t.split(/(?<=\n)/).filter((l) => !l.includes(MARK)).join('');
}

// One pause section's list: what it would draw, and the lines that make it fit.
// `own` / `base`: the section's keys and [Pause Menu]'s (base null for [Pause Menu] itself).
function planSection(text, motifVpath, read, own, base, W, rows, sprites, glyphs, keysByLength, notes) {
  const get = (k) => {
    for (const src of [own, base]) {
      if (!src) continue;
      if (src.has('movelist.' + k)) return src.get('movelist.' + k);
      if (src.has(k)) return src.get(k);
    }
    return DEFAULTS[k];
  };
  const pos = nums(get('menu.pos'));
  let width = nums(get('menu.window.width'))[0] || 0;
  if (width <= 0) width = W - pos[0];
  const scale = nums(get('menu.item.scale'))[0] || 1;
  const scaleA = nums(get('menu.item.active.scale'))[0] || scale;
  const fonts = [];
  for (const [k, sc] of [['menu.item.font', scale], ['menu.item.active.font', scaleA]]) {
    const f = loadFont(get(k), text, motifVpath, read);
    if (f) fonts.push({ f, sc });
  }
  if (!fonts.length) { notes.push('the rows\' font could not be read: nothing changed'); return null; }
  // the widest need, in the section's units, over both row fonts
  let need = 0, widest = null;
  // a list in capitals (the pack's rows uppercase their text) measures them
  const upper = (nums(get('menu.item.uppercase'))[0] || 0) === 1;
  const caps = (runs) => (upper ? runs.map((r) => (r.text ? { text: r.text.toUpperCase() } : r)) : runs);
  for (const { f, sc } of fonts) {
    const gap = f.size[1];
    for (const r of rows) {
      const widths = r.cols.map((c) => ({ align: c.align, w: columnWidth(caps(runsOf(c.text, glyphs, keysByLength)), f, sprites) }));
      const n = rowNeed(widths, gap) * sc;
      if (n > need) { need = n; widest = r; }
    }
  }
  need = Math.ceil(need);
  // A window reaching past the mirror of its left edge (the web build's
  // `W - x` for packs with pause row art, motifcompat.pauseMovelist: our web
  // engine centers its table in the frame) would put the commands outside the
  // pack's centered pause frame here, at the screen's edge: it ends where it
  // starts from the other side (W - 2x, the engine default's own 15 / 290 / 15
  // proportion) when the rows fit that.
  const sym = W - 2 * (pos[0] || 0);
  const symmetric = sym > 0 && width > sym && need <= sym;
  const fits = need <= width && !symmetric;
  const info = { pos, width, scale, need, fits, widest: widest ? widest.cols.map((c) => c.text).join(' | ') : null, font: fonts[0].f.file, fontKind: fonts[0].f.kind };
  if (fits) return { info, lines: [] };
  if (symmetric) {
    Object.assign(info, { newWidth: sym, x: pos[0], shrink: null, mirrored: true });
    return { info, lines: [`movelist.menu.window.width = ${sym}`] };
  }
  const margin = Math.round(W * MARGIN);
  const coords = nums(get('menu.boxcursor.coords'));
  const padL = coords.length === 4 ? Math.max(0, -coords[0]) : 0;
  const maxW = W - 2 * Math.max(margin, padL);
  let newW = need, k = 1;
  if (need > maxW) { k = maxW / need; newW = maxW; }
  newW = Math.floor(newW);
  const x = Math.round((W - newW) / 2);
  const lines = [`movelist.menu.pos = ${x}, ${r2(pos[1] || 0)}`, `movelist.menu.window.width = ${newW}`];
  if (coords.length === 4) {
    const x2 = newW + Math.max(0, padL - 1);
    lines.push(`movelist.menu.boxcursor.coords = ${r2(coords[0])}, ${r2(coords[1])}, ${x2}, ${r2(coords[3])}`);
    for (const dir of ['up', 'down']) {
      const spr = nums(get(`menu.arrow.${dir}.spr`)), anim = nums(get(`menu.arrow.${dir}.anim`));
      const drawn = (anim.length && anim[0] >= 0) || (spr.length && spr[0] >= 0);
      const off = nums(get(`menu.arrow.${dir}.offset`));
      if (drawn && off.length >= 2) lines.push(`movelist.menu.arrow.${dir}.offset = ${r2(x2 + (off[0] - coords[2]))}, ${r2(off[1])}`);
    }
  }
  if (k < 1) {
    for (const key of ['menu.item.scale', 'menu.item.active.scale']) {
      const sc = nums(get(key));
      const sx = sc[0] || 1, sy = sc.length > 1 ? sc[1] : sx;
      lines.push(`movelist.${key} = ${Math.floor(sx * k * 1000) / 1000}, ${Math.floor(sy * k * 1000) / 1000}`);
    }
  }
  Object.assign(info, { newWidth: newW, x, shrink: k < 1 ? r2(k) : null });
  return { info, lines };
}

// ONE BUILD: the motif's path and text as the build has them, the build's
// command lists (movelist files' texts), a reader for the build's files.
// -> { text, info: { sections: { 'pause menu': {...} }, rows, notes } }
function fit(motifVpath, motifText, movelists, read) {
  const notes = [];
  let text = unfit(motifText);
  const secs = BTN.sections(text);
  const info = keysOf(text, secs.find((s) => s.name === 'info'));
  const lc = nums(info.get('localcoord'));
  const W = lc.length >= 2 && lc[0] > 0 ? lc[0] : 320;
  const rows = [];
  for (const m of movelists || []) for (const cols of rowsOf(m)) rows.push({ cols });
  const out = { sections: {}, rows: rows.length, width: W, notes };
  if (!rows.length) { notes.push('no command list in the build'); return { text, info: out }; }
  // the glyph pictures: the engine's tokens, the motif's own first
  const glyphs = Object.assign({}, GLYPHS, BTN.ownGlyphs(text));
  const keysByLength = Object.keys(glyphs).filter((k) => !k.startsWith('<')).sort((a, b) => b.length - a.length);
  const sprites = new Map();
  const gf = firstRead(read, BTN.glyphsCandidates(motifVpath, BTN.glyphsFile(text)));
  for (const n of (gf && BTN.sffNodes(gf.buf)) || []) { const key = n.group + ',' + n.index; if (!sprites.has(key)) sprites.set(key, n); }
  if (!sprites.size) notes.push('the glyph file could not be read: pictures counted square');
  const pmSec = secs.find((s) => s.name === 'pause menu');
  const tmSec = secs.find((s) => s.name === 'training pause menu');
  const pm = keysOf(text, pmSec);
  const tm = tmSec ? keysOf(text, tmSec) : null;
  const plans = [['pause menu', planSection(text, motifVpath, read, pm, null, W, rows, sprites, glyphs, keysByLength, notes)]];
  // [Training Pause Menu] inherits [Pause Menu] (lines included) unless it sets the list's own keys
  const relevant = /^(movelist\.)?(menu\.(pos|window\.width|boxcursor\.coords|item\.(active\.)?(font|scale)|arrow\.))/;
  if (tm && [...tm.keys()].some((k) => relevant.test(k))) {
    plans.push(['training pause menu', planSection(text, motifVpath, read, tm, pm, W, rows, sprites, glyphs, keysByLength, notes)]);
  }
  const eol = /\r\n/.test(text) ? '\r\n' : '\n';
  for (const [name, p] of plans) {
    if (!p) continue;
    out.sections[name] = p.info;
    if (!p.lines.length) continue;
    const block = p.lines.map((l) => l + ' ' + MARK + eol).join('');
    const sec = BTN.sections(text).find((s) => s.name === name);
    if (sec) text = text.slice(0, sec.bodyStart) + block + text.slice(sec.bodyStart);
    else text = text.replace(/\s*$/, '') + eol + eol + '[Pause Menu]' + eol + block;
  }
  return { text, info: out };
}

module.exports = { MARK, marked, GLYPHS, DEFAULTS, MARGIN, keysOf, filesFonts, ttfAdvances, loadFont, rowsOf, runsOf, columnWidth, rowNeed, unfit, fit };
