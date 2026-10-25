'use strict';
// JAPANESE IN THE PAUSE MENU'S COMMAND LIST: DotGothic16, shipped only when a
// build needs it.
//
// The engine's pause menu draws the Command List (menu.lua, the movelist
// block of `[Pause Menu]` / `[Training Pause Menu]`) in the font the motif's
// `movelist.text.font` names - Open_Sans.def by default, which has no kana or
// kanji, and in the website build an ASCII pixel font standing in for it
// (vfslib, DEVLOG Session 11b). A Japanese move name printed blank (Kula,
// headless, 2026-10-18). The engine draws TrueType on both builds (font.go
// loadDefInfo: `[Def] Type = truetype`, `File`, `Size`; the web build's own
// font_webgl.go), so the cure is a font that has the glyphs.
//
// THE FONT: DotGothic16 (Fontworks, SIL OFL 1.1; the owner's choice), in
// addons/jpfont/ beside its OFL.txt - the folder of the plain files the Studio
// carries into builds (the frame meter is there too); make-portable and
// make-kit copy `addons` whole, and scripts/make-notices.js lists it (key
// `jpfont`). Coverage is read from its own cmap (`coverage()`): Latin, kana,
// JIS X 0208 kanji, Greek, Cyrillic - no Hangul, no simplified-only Chinese.
//
// WHEN IT SHIPS (`needed`): only when a name the Command List writer prints
// (cmdlist.js, the export's movelist.dat) is one the stock fonts cannot draw
// (anything but printable ASCII) and this font can. Then the build gets
// font/DotGothic16.def (Type = truetype, Size = the command-list font's own
// size and spacing, so every line keeps its height: menu.lua spaces the
// lines by (Size[1] + Spacing[1]) * scale), font/DotGothic16-Regular.ttf and
// font/DotGothic16-OFL.txt (the license travels with the font), and the
// BUILD'S COPY of the screenpack's system.def gets one new [Files] fontN and
// `movelist.text.font = N, <the same bank, alignment and colors>` in both
// pause menus (`patchMotif`). Nothing else changes: the title, the glyphs
// (pictures from the motif's [Glyphs], sized from the font's Size[1] - the
// same number as before) and the color tags (`<#rrggbb>`, drawn by
// textImgSetColor, which a TrueType font takes like a bitmap one). A build
// whose names are all ASCII gets none of it - byte for byte as before.
//
// The writer (cmdlist.js) still picks the first name the stock fonts print, as
// before this font (so an ASCII-only build is unchanged); a row's `drawable`
// flag is true when the stock fonts or this font draw it, and the Moves page's
// "won't print" flag stays on for names in scripts the font lacks (Hangul,
// simplified-only Chinese). DOCS: GRAIL 3.10e.
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, 'addons', 'jpfont');
const TTF = 'DotGothic16-Regular.ttf';
const LICENSE = 'OFL.txt';
const DEF_FILE = 'DotGothic16.def';
// where the files go in a build (the engine's font/ folder; a [Files] fontN
// value resolves there: motif.go lookup "def,font/,,data/")
const VPATHS = { def: 'font/' + DEF_FILE, ttf: 'font/' + TTF, license: 'font/DotGothic16-OFL.txt' };
// The engine's default command-list font when a motif names none
// (defaultMotif.ini [Pause Menu] movelist.text.font = Open_Sans.def, 0, 1, ...;
// Open_Sans.def: Size = 13,27, Spacing = 1,1).
const DEFAULT_KEY = ['Open_Sans.def', '0', '1', '255', '255', '255', '255', '-1'];
const DEFAULT_SIZE = { size: [13, 27], spacing: [1, 1] };

const stockDraws = (s) => /^[\x20-\x7e]*$/.test(String(s == null ? '' : s));

// ---- the font's own character map ---------------------------------------------------
let COVER = null;
function coverage() {
  if (COVER) return COVER;
  const set = new Set();
  try {
    const b = fs.readFileSync(path.join(DIR, TTF));
    const numTables = b.readUInt16BE(4);
    let cmap = -1;
    for (let i = 0; i < numTables; i++) { const r = 12 + 16 * i; if (b.toString('latin1', r, r + 4) === 'cmap') cmap = b.readUInt32BE(r + 8); }
    if (cmap < 0) throw new Error('no cmap');
    let best = null;
    for (let i = 0, n = b.readUInt16BE(cmap + 2); i < n; i++) {
      const r = cmap + 4 + 8 * i, pid = b.readUInt16BE(r), at = cmap + b.readUInt32BE(r + 4), fmt = b.readUInt16BE(at);
      const score = fmt === 12 ? 3 : (fmt === 4 && (pid === 3 || pid === 0)) ? 2 : 0;
      if (score && (!best || score > best.score)) best = { score, at, fmt };
    }
    if (!best) throw new Error('no Unicode cmap');
    if (best.fmt === 12) {
      for (let i = 0, ng = b.readUInt32BE(best.at + 12); i < ng; i++) {
        const r = best.at + 16 + 12 * i, s = b.readUInt32BE(r), e = b.readUInt32BE(r + 4), g = b.readUInt32BE(r + 8);
        for (let c = s; c <= e; c++) if (g + (c - s)) set.add(c);
      }
    } else {
      const segX2 = b.readUInt16BE(best.at + 6), ends = best.at + 14, starts = ends + segX2 + 2, deltas = starts + segX2, ranges = deltas + segX2;
      for (let k = 0; k < segX2 / 2; k++) {
        const e = b.readUInt16BE(ends + 2 * k), s = b.readUInt16BE(starts + 2 * k), d = b.readInt16BE(deltas + 2 * k), ro = b.readUInt16BE(ranges + 2 * k);
        for (let c = s; c <= e && c !== 0xffff; c++) {
          let g;
          if (!ro) g = (c + d) & 0xffff;
          else { g = b.readUInt16BE(ranges + 2 * k + ro + 2 * (c - s)); if (g) g = (g + d) & 0xffff; }
          if (g) set.add(c);
        }
      }
    }
  } catch (e) { /* no font: nothing is covered, so it never ships */ }
  COVER = set;
  return set;
}
// Can DotGothic16 draw every character of `s`? (a space or tab always)
function fontDraws(s) {
  const cov = coverage();
  if (!cov.size) return false;
  for (const ch of String(s == null ? '' : s)) { const c = ch.codePointAt(0); if (c !== 0x20 && c !== 0x09 && !cov.has(c)) return false; }
  return true;
}
// Will the build draw it: the stock fonts can, or this font can (and then it ships).
const drawable = (s) => stockDraws(s) || fontDraws(s);
// Does a build whose Command Lists print `names` need the font?
const needed = (names) => (names || []).some((n) => !stockDraws(n) && fontDraws(n));
const available = () => fs.existsSync(path.join(DIR, TTF)) && fs.existsSync(path.join(DIR, LICENSE));

// ---- the files ------------------------------------------------------------------------
// The font's .def: TrueType, at the command-list font's own size and spacing.
function defText(metrics) {
  const m = metrics || DEFAULT_SIZE;
  return [
    '[FNT v2]', 'fntversion = 2,00', 'name = "DotGothic16"', 'author = "Fontworks"', '',
    '; Written by the export for the pause menu\'s Command List: its moves have',
    '; names the stock fonts cannot draw. SIL Open Font License 1.1, see',
    '; DotGothic16-OFL.txt beside this file.',
    '[Def]', 'Type = truetype',
    'Size = ' + m.size[0] + ',' + m.size[1], 'Spacing = ' + m.spacing[0] + ',' + m.spacing[1], 'Offset = 0,0',
    'File = ' + TTF, 'Blend = 1', '',
  ].join('\r\n');
}
// { [vpath]: Buffer } for a build
function files(metrics) {
  return {
    [VPATHS.def]: Buffer.from(defText(metrics), 'latin1'),
    [VPATHS.ttf]: fs.readFileSync(path.join(DIR, TTF)),
    [VPATHS.license]: fs.readFileSync(path.join(DIR, LICENSE)),
  };
}

// ---- the motif ------------------------------------------------------------------------
// Sections of a motif text (latin1): [{ name (lower case), start, bodyStart, end }],
// by character offsets, a section running to the next header.
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
const keyRe = (key) => new RegExp('^([ \\t]*' + key.replace(/\./g, '\\.') + '[ \\t]*=[ \\t]*)([^;\\r\\n]*?)([ \\t]*(?:;[^\\r\\n]*)?)$', 'mi');
// The first value of the motif's command-list font key (a [Files] index or a
// file name), from [Pause Menu], else the default's.
function commandListFont(text) {
  const t = String(text || '');
  const files = new Map();
  const secs = sections(t);
  const body = (s) => t.slice(s.bodyStart, s.end);
  const fsec = secs.find((s) => s.name === 'files');
  if (fsec) for (const m of body(fsec).matchAll(/^[ \t]*font(\d+)[ \t]*=[ \t]*([^;\r\n]*?)[ \t]*(?:;.*)?$/gmi)) if (!files.has(m[1])) files.set(m[1], m[2].trim());
  const pm = secs.find((s) => s.name === 'pause menu');
  const m = pm && keyRe('movelist.text.font').exec(body(pm));
  const first = m ? String(m[2]).split(',')[0].trim() : DEFAULT_KEY[0];
  return /^-?\d+$/.test(first) ? (files.get(String(parseInt(first, 10))) || null) : first;
}
// A font .def's [Def] Size and Spacing (latin1 text), or null.
function fontMetrics(defText) {
  const t = String(defText || '');
  const sec = /^[ \t]*\[def\][^\r\n]*$([\s\S]*?)(?=^[ \t]*\[|(?![\s\S]))/mi.exec(t);
  if (!sec) return null;
  const pair = (k) => { const m = new RegExp('^[ \\t]*' + k + '[ \\t]*=[ \\t]*(-?\\d+)[ \\t]*,[ \\t]*(-?\\d+)', 'mi').exec(sec[1]); return m ? [parseInt(m[1], 10), parseInt(m[2], 10)] : null; };
  const size = pair('size');
  if (!size || !(size[1] > 0)) return null;
  return { size, spacing: pair('spacing') || [0, 0] };
}
// The build's copy of a motif with the Command List's text drawn in the font:
// a new [Files] fontN (one past the highest index the motif uses) and
// `movelist.text.font = N, ...` in [Pause Menu] and [Training Pause Menu] -
// the rest of the key (bank, alignment, colors) as the motif has it, the
// engine's default when it has none; a pack without the section gets one.
// Every other byte is kept. -> { text, index }
function patchMotif(text) {
  let t = String(text);
  const eol = /\r\n/.test(t) ? '\r\n' : '\n';
  let max = -1;
  for (const m of t.matchAll(/^[ \t]*font(\d+)[ \t]*=/gmi)) max = Math.max(max, parseInt(m[1], 10));
  const index = Math.max(max + 1, 1);
  // [Files]: the new font as its first line (a key's first value wins)
  const fsec = sections(t).find((s) => s.name === 'files');
  const fline = 'font' + index + ' = ' + DEF_FILE + ' ;the Command List\'s font, written by the export' + eol;
  if (fsec) t = t.slice(0, fsec.bodyStart) + fline + t.slice(fsec.bodyStart);
  else t = '[Files]' + eol + fline + eol + t;
  // [Training Pause Menu] inherits what it does not set from [Pause Menu]
  // (motif.go overrideParams); it gets the key explicitly anyway, with the
  // rest of the values it would have inherited, so an engine without that
  // rule draws the same.
  const re = keyRe('movelist.text.font');
  const restOf = (v) => String(v).split(',').slice(1).map((p) => p.trim());
  let pauseRest = DEFAULT_KEY.slice(1);
  for (const name of ['pause menu', 'training pause menu']) {
    const s = sections(t).find((x) => x.name === name);
    const head = name === 'pause menu' ? '[Pause Menu]' : '[Training Pause Menu]';
    if (!s) {
      t = t.replace(/\s*$/, '') + eol + eol + head + eol + 'movelist.text.font = ' + [index, ...pauseRest].join(', ') + eol;
      continue;
    }
    const body = t.slice(s.bodyStart, s.end);
    const m = re.exec(body);
    let nb;
    if (m) {
      const rest = restOf(m[2]);
      if (name === 'pause menu') pauseRest = rest;
      nb = body.replace(re, (m0, k, v, tail) => k + [String(index), ...restOf(v)].join(', ') + tail);
    } else {
      nb = 'movelist.text.font = ' + [index, ...pauseRest].join(', ') + eol + body;
    }
    t = t.slice(0, s.bodyStart) + nb + t.slice(s.end);
  }
  return { text: t, index };
}

module.exports = { DIR, TTF, LICENSE, DEF_FILE, VPATHS, DEFAULT_SIZE, coverage, fontDraws, stockDraws, drawable, needed, available, defText, files, commandListFont, fontMetrics, patchMotif, sections };
