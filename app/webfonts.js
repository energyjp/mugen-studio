'use strict';
// WEB STAND-INS FOR WINDOWS SYSTEM FONTS, in the build's copy of a screenpack.
//
// A MUGEN-era screenpack often names a TrueType font it does not carry, one
// that every Windows PC has: Capcom vs. SNK 2's font/options2.def says
// `File = arial.ttf` ("Will search Windows font directory if not in current
// directory") and font/msgothic-tt20.def `File = msgothic.ttc` (MS Gothic).
// The desktop engine finds them in the Windows font folder. A web build has no
// such folder (the engine's js LoadFntTtf reads its virtual filesystem only:
// "TrueType font not found, skipping arial.ttf"), so every text in that font
// drew nothing: on CvS2 the options screen's row names and the pause menu's
// Button Mapping names (DEVLOG 2026-11-16, plan 1.22).
//
// For the modern-input engine's web builds (vfslib, V2, opts.web), each font
// the screenpack's [Files] names is looked at:
//  - a font .def (FNT v2, Type = truetype) whose `File` is a known Windows
//    system font that the build does not have where the engine looks for it
//    (beside the .def, beside the motif, as written, data/, font/) gets a copy
//    in the build with `File` pointed at a font the build ships: the Latin
//    families (Arial, Tahoma, Verdana, Segoe UI, ...) -> Open_Sans (the
//    TrueType every V2 build ships, release-v2 font/Open_Sans/, Decision 26;
//    a bold file -> OpenSans-Bold.ttf), the Japanese ones (MS Gothic, MS
//    Mincho, Meiryo, Yu Gothic) -> DotGothic16 (addons/jpfont, SIL OFL; its
//    .ttf and license then ship too). Size, Spacing, Offset and everything
//    else in the .def stay as written, so text keeps its height.
//  - a [Files] fontN that names such a font file directly gets the matching
//    shipped .def (font/Open_Sans.def; DotGothic16 through a .def of its own
//    at the font's [Files] height, or Open_Sans' 27 when none is set).
// A font the build has (the pack carries its own arial.ttf), a font that is
// not a known Windows one, and a bitmap font are left alone. The installed
// pack is never written. Pure helpers here; vfslib supplies the files.

const OPEN_SANS = 'Open_Sans/OpenSans-Regular.ttf';
const OPEN_SANS_BOLD = 'Open_Sans/OpenSans-Bold.ttf';
const OPEN_SANS_DEF = 'Open_Sans.def';
const DOTGOTHIC = 'DotGothic16-Regular.ttf';

// Windows font files by family, lower case. Bold faces of the Latin families
// map to Open Sans Bold.
const SANS = [
  'arial.ttf', 'ariali.ttf', 'arialn.ttf', 'arialni.ttf', 'tahoma.ttf', 'verdana.ttf', 'verdanai.ttf',
  'segoeui.ttf', 'segoeuii.ttf', 'segoeuil.ttf', 'segoeuisl.ttf', 'calibri.ttf', 'calibrii.ttf', 'calibril.ttf',
  'trebuc.ttf', 'trebucit.ttf', 'micross.ttf', 'times.ttf', 'timesi.ttf', 'georgia.ttf', 'georgiai.ttf',
  'cour.ttf', 'couri.ttf', 'lucon.ttf', 'comic.ttf', 'consola.ttf', 'consolai.ttf', 'framd.ttf', 'framdit.ttf',
  'pala.ttf', 'palai.ttf', 'gara.ttf', 'bookos.ttf', 'century.ttf', 'gothic.ttf', 'l_10646.ttf',
];
const SANS_BOLD = [
  'arialbd.ttf', 'arialbi.ttf', 'ariblk.ttf', 'arialnb.ttf', 'arialnbi.ttf', 'tahomabd.ttf', 'verdanab.ttf', 'verdanaz.ttf',
  'segoeuib.ttf', 'segoeuiz.ttf', 'seguisb.ttf', 'seguibl.ttf', 'calibrib.ttf', 'calibriz.ttf', 'trebucbd.ttf', 'trebucbi.ttf',
  'timesbd.ttf', 'timesbi.ttf', 'georgiab.ttf', 'georgiaz.ttf', 'courbd.ttf', 'courbi.ttf', 'comicbd.ttf', 'consolab.ttf',
  'consolaz.ttf', 'impact.ttf', 'palab.ttf', 'palabi.ttf', 'gothicb.ttf',
];
const GOTHIC = [
  'msgothic.ttc', 'msgothic.ttf', 'msmincho.ttc', 'msmincho.ttf', 'meiryo.ttc', 'meiryob.ttc', 'meiryo.ttf',
  'yugothr.ttc', 'yugothm.ttc', 'yugothb.ttc', 'yugothl.ttc', 'yumin.ttf', 'yumindb.ttf', 'yuminl.ttf',
];

const base = (f) => String(f || '').replace(/\\/g, '/').split('/').pop().trim().toLowerCase();

// The stand-in for a font file name: { kind: 'sans' | 'gothic', ttf } or null.
function standInFor(file) {
  const b = base(file);
  if (SANS.includes(b)) return { kind: 'sans', ttf: OPEN_SANS };
  if (SANS_BOLD.includes(b)) return { kind: 'sans', ttf: OPEN_SANS_BOLD };
  if (GOTHIC.includes(b)) return { kind: 'gothic', ttf: DOTGOTHIC };
  return null;
}

// A FNT v2 .def's [Def] Type and File (latin1 text): { type, file, line } or null.
function defFile(text) {
  const t = String(text || '');
  const lines = t.split(/\r?\n/);
  let inDef = false, type = '', file = null, line = -1;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].replace(/^﻿|^\xEF\xBB\xBF/, '');
    const sec = /^\s*\[([^\]]+)\]/.exec(l);
    if (sec) { inDef = sec[1].trim().toLowerCase() === 'def'; continue; }
    if (!inDef) continue;
    const m = /^(\s*)(\w+)(\s*=\s*)([^;\r\n]*?)(\s*(?:;.*)?)$/.exec(l);
    if (!m) continue;
    const k = m[2].toLowerCase();
    if (k === 'type' && !type) type = m[4].trim().toLowerCase();
    if (k === 'file' && file === null) { file = m[4].trim().replace(/^"|"$/g, ''); line = i; }
  }
  return file === null ? null : { type, file, line };
}

// The .def with its File pointed at `ttf`, every other byte kept; a comment
// names what it stood in for.
function pointDefAt(text, ttf) {
  const t = String(text);
  const nl = /\r\n/.test(t) ? '\r\n' : '\n';
  const d = defFile(t);
  if (!d) return t;
  const lines = t.split(/\r?\n/);
  const was = d.file;
  lines[d.line] = lines[d.line].replace(/^(\s*\w+\s*=\s*)([^;\r\n]*?)(\s*(?:;.*)?)$/, (m0, k, v, tail) => k + ttf + tail);
  lines.splice(d.line, 0, '; Mugen Studio: ' + was + ' is a Windows font a web build does not have; this build draws it in ' + ttf.split('/').pop());
  return lines.join(nl);
}

// A .def of DotGothic16 at `height` for a [Files] entry that named a
// Japanese Windows font directly.
function gothicDef(height) {
  const h = height > 0 ? height : 27;
  return ['[FNT v2]', 'fntversion = 2,00', 'name = "DotGothic16"', 'author = "Fontworks"', '',
    '; Written by the build: the screenpack names a Japanese Windows font a web',
    '; build does not have. SIL Open Font License 1.1, see DotGothic16-OFL.txt.',
    '[Def]', 'Type = truetype', 'Size = ' + h + ',' + h, 'Spacing = 1,1', 'Offset = 0,0',
    'File = ' + DOTGOTHIC, 'Blend = 1', ''].join('\r\n');
}

// The motif's [Files] font entries (latin1 text): [{ n, file, line, height }].
function motifFonts(text) {
  const lines = String(text || '').split(/\r?\n/);
  const out = [];
  let inFiles = false;
  const heights = new Map();
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const sec = /^\s*\[([^\]]+)\]/.exec(l);
    if (sec) { inFiles = sec[1].trim().toLowerCase() === 'files'; continue; }
    if (!inFiles) continue;
    let m = /^\s*font(\d+)\s*=\s*([^;\r\n]*?)\s*(?:;.*)?$/i.exec(l);
    if (m && m[2] && !out.some((f) => f.n === +m[1])) out.push({ n: +m[1], file: m[2].replace(/^"|"$/g, '').trim(), line: i });
    m = /^\s*font(\d+)\.height\s*=\s*(-?\d+)/i.exec(l);
    if (m && !heights.has(+m[1])) heights.set(+m[1], +m[2]);
  }
  for (const f of out) f.height = heights.has(f.n) ? heights.get(f.n) : -1;
  return out;
}

const dirOf = (vp) => { const s = String(vp).replace(/\\/g, '/'); const i = s.lastIndexOf('/'); return i < 0 ? '' : s.slice(0, i + 1); };
const norm = (vp) => String(vp).replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/\.\//g, '/');

// Where the engine looks for a [Files] font of the motif: beside the motif,
// font/, as written, data/ (motif.go).
const motifFontPaths = (motifVp, file) => [dirOf(motifVp) + file, 'font/' + file, file, 'data/' + file].map(norm);
// Where the engine looks for a .def's TrueType File: beside the .def, beside
// the motif, as written, data/, font/ (util_js.go LoadFntTtf -> SearchFile).
const ttfPaths = (defVp, motifVp, file) => [dirOf(defVp) + file, dirOf(motifVp) + file, file, 'data/' + file, 'font/' + file].map(norm);

// The stand-ins for a motif. `has(vpath)` says whether the build has a file
// (any case), `read(vpath)` returns its bytes or null. -> { files: {vpath:
// Buffer}, motif: text or null (a changed motif), gothic: bool (DotGothic16
// must ship), notes: [...] }
function standIns(motifVp, motifText, has, read) {
  const files = {};
  const notes = [];
  let gothic = false;
  let motif = String(motifText);
  const lines = motif.split(/\r?\n/);
  const nl = /\r\n/.test(motif) ? '\r\n' : '\n';
  let motifChanged = false;
  for (const f of motifFonts(motif)) {
    const direct = standInFor(f.file);
    if (direct && /\.(ttf|ttc|otf)$/i.test(f.file)) {
      if (motifFontPaths(motifVp, f.file).some(has)) continue;
      let to;
      if (direct.kind === 'gothic') {
        to = 'font/DotGothic16-' + (f.height > 0 ? f.height : 27) + '.def';
        files[to] = Buffer.from(gothicDef(f.height), 'latin1');
        gothic = true;
        to = to.slice('font/'.length);
      } else {
        to = OPEN_SANS_DEF;
      }
      lines[f.line] = lines[f.line].replace(/^(\s*font\d+\s*=\s*)([^;\r\n]*?)(\s*(?:;.*)?)$/i, (m0, k, v, tail) => k + to + tail);
      motifChanged = true;
      notes.push('font' + f.n + ' ' + f.file + ' -> ' + to);
      continue;
    }
    if (!/\.def$/i.test(f.file)) continue;
    const defVp = motifFontPaths(motifVp, f.file).find(has);
    if (!defVp) continue;
    const buf = read(defVp);
    if (!buf) continue;
    const text = Buffer.from(buf).toString('latin1');
    const d = defFile(text);
    if (!d || d.type !== 'truetype') continue;
    const s = standInFor(d.file);
    if (!s) continue;
    if (ttfPaths(defVp, motifVp, d.file).some(has)) continue;
    files[defVp] = Buffer.from(pointDefAt(text, s.ttf), 'latin1');
    if (s.kind === 'gothic') gothic = true;
    notes.push(defVp + ' ' + d.file + ' -> ' + s.ttf);
  }
  return { files, motif: motifChanged ? lines.join(nl) : null, gothic, notes };
}

module.exports = { standInFor, defFile, pointDefAt, gothicDef, motifFonts, standIns, OPEN_SANS, OPEN_SANS_BOLD, DOTGOTHIC };
