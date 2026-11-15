'use strict';
// THE LOOK OF THE WINNER-STAYS LOBBY on the web game page (webrtc.js's
// sidebar and the page around the game while in a lobby), chosen by the
// site's host in Settings > Online > Lobby look and kept per bundle as
// roster.lobbyLook. Players cannot change it. Built like the leaderboard's
// look (leaderboardlook.js):
//
//   colors      a preset (classic, the sidebar as it has always been, or one
//               named after a Studio look) plus any of the eight colors set
//               by hand; the page's tokens --lob-bg ... --lob-chat-bg
//   fonts       head (the sidebar's title, section heads and the folded tab)
//               and body (everything else): one of the leaderboard's font set
//               (public/ranking/leaderboard-fonts) or none for monospace
//   header      the sidebar's head band: band (a solid accent strip, the
//               default), panel or line; flat looks only
//   background  one picture, animated GIF or WebP, or short MP4/WebM behind
//               the page while in a lobby, with how it fills the window and
//               how dark the look's background color lies over it
//   style       the panel's style: flat (the default), minimal or rail
//   see         how see-through the lines, the panel's fill and the boxes
//               are (each 0-100 %, 0 = solid, the default)
//   panelBg     the same kinds behind the lobby panel itself (like a speedrun
//               timer's background image), with its own fit and darkness
//
// The page reads it from IKEMEN_BRAND.lobbyLook (public/ikemen/lobby-look.js,
// which holds the presets and the CSS it becomes): the Website export writes
// it into the page with the folders beside it (forExport), and the Studio's
// server fills it into the page Test in Browser opens (forStudio). Stored as
// no key at all while everything is the default, like leaderboardLook; a
// bundle without it exports exactly as before.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const PAGE = require('./public/ikemen/lobby-look.js');
const LB = require('./leaderboardlook');

const KEYS = PAGE.KEYS;
const PRESETS = PAGE.PRESETS;
const HEADERS = PAGE.HEADERS;
const STYLES = PAGE.STYLES;
const SEE = PAGE.SEE;
const ROLES = ['head', 'body'];
const FONTS = LB.FONTS;
const FONT_DIR = LB.FONT_DIR;
const HEX = /^#[0-9a-f]{6}$/;

// The background: the leaderboard's kinds, caps and checks (LB.backgroundFile),
// kept in the bundle's own lobby-bg folder (layout.LOBBY_BG) and copied into
// BG_DIR beside the exported page.
const BG_DIR = 'lobby-bg';
const BG_TYPES = LB.BG_TYPES;
const BG_FILE_RE = LB.BG_FILE_RE;
const BG_IMAGE_MAX_BYTES = LB.BG_IMAGE_MAX_BYTES;
const BG_VIDEO_MAX_BYTES = LB.BG_VIDEO_MAX_BYTES;
const BG_FITS = PAGE.FITS;
const BG_DIM_DEFAULT = PAGE.DIM_DEFAULT;
const BG_DIM_MAX = PAGE.DIM_MAX;

function cleanBackground(b) {
  if (!b || typeof b !== 'object' || Array.isArray(b) || typeof b.file !== 'string' || !BG_FILE_RE.test(b.file)) return null;
  const d = typeof b.dim === 'string' && b.dim.trim() !== '' ? Number(b.dim) : b.dim;
  return {
    file: b.file,
    fit: BG_FITS.includes(b.fit) ? b.fit : 'cover',
    dim: Number.isInteger(d) && d >= 0 && d <= BG_DIM_MAX ? d : BG_DIM_DEFAULT,
  };
}

// The whole look from whatever roster.lobbyLook holds: anything unknown is
// the default. A hand-set color equal to its preset's is dropped, so
// "custom" means different.
function normalize(v) {
  const o = v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  const c = o.colors && typeof o.colors === 'object' ? o.colors : {};
  const preset = PRESETS[c.preset] ? c.preset : 'classic';
  const colors = { preset };
  for (const k of KEYS) {
    const x = typeof c[k] === 'string' ? c[k].toLowerCase() : '';
    if (HEX.test(x) && x !== PRESETS[preset][k]) colors[k] = x;
  }
  const f = o.fonts && typeof o.fonts === 'object' ? o.fonts : {};
  const fonts = {};
  for (const r of ROLES) if (typeof f[r] === 'string' && Object.prototype.hasOwnProperty.call(FONTS, f[r])) fonts[r] = f[r];
  const out = { colors, fonts, header: HEADERS.includes(o.header) ? o.header : 'band',
    style: STYLES.includes(o.style) ? o.style : 'flat', see: PAGE.cleanSee(o.see) };
  const bg = cleanBackground(o.background);
  if (bg) out.background = bg;
  const pbg = cleanBackground(o.panelBg);
  if (pbg) out.panelBg = pbg;
  return out;
}

// What roster.json keeps: only what differs from the default, or null (no key).
function toRoster(v) {
  const l = normalize(v);
  const out = {};
  if (l.colors.preset !== 'classic' || Object.keys(l.colors).length > 1) out.colors = l.colors;
  if (Object.keys(l.fonts).length) out.fonts = l.fonts;
  if (l.header !== 'band') out.header = l.header;
  if (l.style !== 'flat') out.style = l.style;
  if (Object.keys(l.see).length) out.see = l.see;
  if (l.background) out.background = l.background;
  if (l.panelBg) out.panelBg = l.panelBg;
  return Object.keys(out).length ? out : null;
}

// The font files a look needs beside the page (each once).
function fontFiles(v) {
  return [...new Set(Object.values(normalize(v).fonts))].map((id) => id + '.otf');
}

// A background as sent: its type and bytes, checked as the leaderboard's are
// (the type, the size for its kind, the opening bytes). -> { name, buf }.
function backgroundFile(type, buf) { return LB.backgroundFile(type, buf); }

// The background file in `dir` an export may ship: there, a file, within the
// cap for its kind, its bytes what its name says, and its name its own hash
// (a file put in the folder by hand under another's name is left out).
// -> null, or what is wrong: 'missing', 'size' or 'bytes'.
const EXT_TYPE = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', mp4: 'video/mp4', webm: 'video/webm' };
function backgroundProblem(file, dir) {
  const p = path.join(dir, file);
  let st;
  try { st = fs.statSync(p); } catch (e) { return 'missing'; }
  if (!st.isFile()) return 'missing';
  const ext = file.split('.').pop();
  if (st.size > (/^(mp4|webm)$/.test(ext) ? BG_VIDEO_MAX_BYTES : BG_IMAGE_MAX_BYTES)) return 'size';
  let r;
  try { r = LB.backgroundFile(EXT_TYPE[ext], fs.readFileSync(p)); } catch (e) { return 'bytes'; }
  return r.name === file ? null : 'bytes';
}

// THE LOOK FOR THE PAGE, as IKEMEN_BRAND.lobbyLook: the stored look with the
// folders its fonts and background are found in, or null when there is none.
function pageLook(v, fontDir, bgDir) {
  const stored = toRoster(v);
  if (!stored) return null;
  return Object.assign({}, stored, { fontDir, bgDir });
}

// For the Studio's own pages (Test in Browser, the preview): the fonts where
// the Studio serves them, the background from the bundle's folder.
function forStudio(v) {
  return pageLook(v, '/ranking/' + FONT_DIR + '/', '/ikemen/' + BG_DIR + '/');
}

// FOR A WEBSITE EXPORT from the bundle whose background folder is `bgFolder`:
// -> { look, fonts, background, panelBg, left }. look: the page's (null = none, the
// page exactly as before); fonts: the files to copy from the font set into
// FONT_DIR beside the page; background: the file to copy into BG_DIR, or
// null; panelBg: the panel's file to copy there too, or null; left:
// [{ file, why }] for a background left out (the look then has none there,
// and the page or panel keeps its own color).
function forExport(v, bgFolder) {
  const stored = toRoster(v);
  if (!stored) return { look: null, fonts: [], background: null, panelBg: null, left: [] };
  const left = [];
  const take = (key) => {
    if (!stored[key]) return null;
    const why = backgroundProblem(stored[key].file, bgFolder);
    if (why) { left.push({ file: stored[key].file, why }); delete stored[key]; return null; }
    return stored[key].file;
  };
  const background = take('background');
  const panelBg = take('panelBg');
  const look = Object.keys(stored).length ? Object.assign({}, stored, { fontDir: FONT_DIR + '/', bgDir: BG_DIR + '/' }) : null;
  return { look, fonts: look ? fontFiles(stored) : [], background, panelBg, left };
}

// The tables the Studio's Lobby look rows are drawn from.
function tables() {
  return {
    keys: KEYS, presets: PRESETS, headers: HEADERS, styles: STYLES, see: SEE, roles: ROLES, fonts: FONTS,
    bgTypes: Object.keys(BG_TYPES), bgImageMaxBytes: BG_IMAGE_MAX_BYTES, bgVideoMaxBytes: BG_VIDEO_MAX_BYTES,
    bgFits: BG_FITS, bgDimDefault: BG_DIM_DEFAULT, bgDimMax: BG_DIM_MAX,
  };
}

// The hash a background's name carries (tests).
function bgName(buf, ext) { return 'bg-' + crypto.createHash('sha256').update(buf).digest('hex').slice(0, 12) + '.' + ext; }

module.exports = {
  KEYS, PRESETS, HEADERS, STYLES, SEE, ROLES, FONTS, FONT_DIR, BG_DIR, BG_TYPES, BG_FILE_RE, BG_IMAGE_MAX_BYTES, BG_VIDEO_MAX_BYTES,
  BG_FITS, BG_DIM_DEFAULT, BG_DIM_MAX,
  normalize, toRoster, fontFiles, backgroundFile, backgroundProblem, pageLook, forStudio, forExport, tables, bgName,
};
