'use strict';
// THE LOOK OF THE SCORE RANKING BOARD (public/ranking/board.html), chosen in
// Settings > Online > Leaderboard and kept per bundle as roster.leaderboardLook.
// The Website export hands it to the page in its RANKING block (and copies the
// chosen fonts and rank pictures beside it); the Studio's preview passes it as
// ?look=. The page
// carries the same tables (its head script): tools/test-ranking-pages.js
// checks that they agree.
//
//   header   how the title (SCORE RANKING, RANK 1) and the logo card's big
//            line are drawn: four flat looks, so any font can sit in them
//   format   the page's layout: the classic climbing board, a select screen,
//            a podium, an arcade hi-score table or a TV-style broadcast
//   fonts    per role (title, names, numbers, text): one of the fonts in
//            public/ranking/leaderboard-fonts, or none for the element's own
//            system font
//   colors   a preset named after the Studio's looks (or the classic board's
//            own), plus any of six colors set by hand
//   text     the board's own words (SCORE RANKING, CHAMPION, the empty and
//            offline messages...), each one the host changed; '*' marks the
//            words drawn in the accent color
//   ranks    per rank name, the shield's two colors and pips, or a picture
//            the host supplied (in the bundle's leaderboard-ranks folder,
//            layout.LEADERBOARD_RANKS) drawn in the shield's place
//
// Stored as no key at all while everything is the default (banner, classic,
// system fonts, the classic colors, the board's own English, the built-in
// shields), like leaderboardPage and queueMode.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const HEADERS = ['banner', 'ruled', 'flat', 'bar'];
const FORMATS = ['classic', 'select', 'podium', 'hiscore', 'broadcast'];
const ROLES = ['title', 'names', 'numbers', 'text'];

// id -> the font's own family name. The file is FONT_DIR/<id>.otf.
const FONTS = {
  'alpha-1': 'Alpha 1', 'arcade-configuration': 'Arcade Configuration', 'arcade-service-2': 'Arcade Service 2',
  'arcade-service-3': 'Arcade Service 3', 'bizarre-future': 'Bizarre Future', 'cota': 'COTA',
  'hyper-combo': 'Hyper Combo', 'inkz-monster-savior': 'INKZ Monster Savior', 'kof-2003': 'KOF 2003',
  'msh-name': 'MSH Name', 'mvc': 'MVC', 'mvc-heros-name': 'MvC Hero\'s Name', 'second-impact': 'Second Impact',
  'sf3-new-generation': 'SF3 New Generation', 'street-fighter-alpha': 'Street Fighter Alpha', 'tournament': 'Tournament',
};
const FONT_DIR = 'leaderboard-fonts';

// The palettes. Each preset is named after a Studio look (its night printing,
// since the board is an attract screen on a dark backdrop) or is the classic
// board's own. onaccent is the text color on the accent (the banner's words).
const COLOR_KEYS = ['bg', 'haze', 'accent', 'onaccent', 'name', 'score', 'rank', 'ink', 'dim', 'stat'];
// The ones the Studio lets you set by hand.
const CUSTOM_KEYS = ['bg', 'haze', 'accent', 'name', 'score', 'rank'];
const PRESETS = {
  classic:  { bg: '#05040a', haze: '#241a3a', accent: '#ff8800', onaccent: '#ffffff', name: '#ff5533', score: '#46e07a', rank: '#b98cff', ink: '#d0d0e0', dim: '#6a6a86', stat: '#9fd8ff' },
  energy:   { bg: '#060607', haze: '#2a1210', accent: '#d8391f', onaccent: '#ffffff', name: '#eff0ec', score: '#ff8800', rank: '#c9cac6', ink: '#eff0ec', dim: '#7c7d82', stat: '#ffb27a' },
  wb:       { bg: '#040e26', haze: '#10285e', accent: '#2a62f0', onaccent: '#ffffff', name: '#85bfff', score: '#ff8800', rank: '#aec3ec', ink: '#edf3ff', dim: '#5b7bc4', stat: '#ffd0a0' },
  djar:     { bg: '#14040a', haze: '#45101a', accent: '#d0142f', onaccent: '#ffffff', name: '#ff8800', score: '#fff5f2', rank: '#f7cdc4', ink: '#fff5f2', dim: '#b0505a', stat: '#ffc3a8' },
  shizuka:  { bg: '#050806', haze: '#221c3a', accent: '#e8b92c', onaccent: '#1a1200', name: '#cc99ff', score: '#e8b92c', rank: '#d2c6ef', ink: '#f3efe3', dim: '#7d7896', stat: '#d2c6ef' },
  contrast: { bg: '#000000', haze: '#1a1a1a', accent: '#ffa31a', onaccent: '#000000', name: '#ffffff', score: '#ffa31a', rank: '#f2f2f2', ink: '#ffffff', dim: '#a6a6a6', stat: '#ffffff' },
};
const HEX = /^#[0-9a-f]{6}$/;

// The board's words, by key, each with the English the board has always
// drawn. The page's head script holds the same table. The logo card's two
// big lines have no English of their own ('' here): left unset, they are the
// site's credit and title, as they always were.
const TEXT_KEYS = {
  title: 'SCORE RANKING',
  champTitle: 'RANK 1',
  champion: 'CHAMPION',
  challengers: 'CHALLENGERS',
  vacant: 'OPEN',
  waiting: 'WAITING FOR A CHALLENGER',
  logoMain: '',
  logoSub: '',
  logoFoot: 'ONLINE RANKINGS  //  PLAY A *RANKED MATCH* TO ENTER',
  enterName: 'PLAY A *RANKED MATCH* TO ENTER YOUR NAME',
  emptyTitle: 'NO RANKED MATCHES YET',
  emptySub: 'PLAY A *RANKED MATCH* ONLINE TO PUT YOUR NAME HERE',
  offlineTitle: 'COULD NOT REACH THE RANKING SERVER',
  offlineSub: 'IT MAY BE WAKING UP - TRY AGAIN IN A MOMENT',
  standingsTitle: 'RANKINGS',
};
const TEXT_MAX = 80;

// A rank's name as both leaderboard servers hold it (trimmed, uppercased),
// and the pictures a rank can have instead of its shield.
const RANK_NAME_RE = /^[A-Z0-9 ._-]{1,16}$/;
const RANK_LOOKS_MAX = 24;
const PIPS_MAX = 7;
const RANK_DIR = 'leaderboard-ranks';
const RANK_IMAGE_RE = /^[a-z0-9._-]{1,80}\.(png|webp|svg)$/;
const RANK_IMAGE_TYPES = { 'image/png': 'png', 'image/webp': 'webp', 'image/svg+xml': 'svg' };
const RANK_IMAGE_MAX_BYTES = 256 * 1024;

// One of the board's words as the host typed it: no '<' or '>' (the page
// builds its text with the DOM, but an exported page is the host's to edit
// by hand later), trimmed, at most TEXT_MAX characters. Blank is the default.
function cleanText(s) {
  if (typeof s !== 'string') return '';
  return s.replace(/[<>]/g, '').trim().slice(0, TEXT_MAX).trim();
}

function rankName(s) {
  const n = typeof s === 'string' ? s.trim().toUpperCase() : '';
  return RANK_NAME_RE.test(n) ? n : '';
}

// One rank's look: only the fields set, and set right.
function cleanRankLook(r) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return null;
  const out = {};
  for (const k of ['c1', 'c2']) {
    const x = typeof r[k] === 'string' ? r[k].toLowerCase() : '';
    if (HEX.test(x)) out[k] = x;
  }
  const p = typeof r.pips === 'string' && r.pips.trim() !== '' ? Number(r.pips) : r.pips;
  if (Number.isInteger(p) && p >= 0 && p <= PIPS_MAX) out.pips = p;
  if (typeof r.image === 'string' && RANK_IMAGE_RE.test(r.image)) out.image = r.image;
  return Object.keys(out).length ? out : null;
}

// The whole look from whatever roster.leaderboardLook holds: anything unknown
// is the default. A hand-set color equal to its preset's is dropped, so
// "custom" means different; so is a word equal to the board's own. text and
// ranks are there only when something is set, so a look from before them
// reads exactly as it did.
function normalize(v) {
  const o = v && typeof v === 'object' ? v : {};
  const fonts = {};
  const f = o.fonts && typeof o.fonts === 'object' ? o.fonts : {};
  for (const r of ROLES) if (typeof f[r] === 'string' && FONTS[f[r]]) fonts[r] = f[r];
  const c = o.colors && typeof o.colors === 'object' ? o.colors : {};
  const preset = PRESETS[c.preset] ? c.preset : 'classic';
  const colors = { preset };
  for (const k of CUSTOM_KEYS) {
    const x = typeof c[k] === 'string' ? c[k].toLowerCase() : '';
    if (HEX.test(x) && x !== PRESETS[preset][k]) colors[k] = x;
  }
  const text = {};
  const t = o.text && typeof o.text === 'object' && !Array.isArray(o.text) ? o.text : {};
  for (const k of Object.keys(TEXT_KEYS)) {
    const s = cleanText(t[k]);
    if (s && s !== TEXT_KEYS[k]) text[k] = s;
  }
  // Keys spelled another way (' gold') fold into one; the first one wins.
  const ranks = {};
  const rk = o.ranks && typeof o.ranks === 'object' && !Array.isArray(o.ranks) ? o.ranks : {};
  for (const k of Object.keys(rk)) {
    if (Object.keys(ranks).length >= RANK_LOOKS_MAX) break;
    const name = rankName(k);
    if (!name || ranks[name]) continue;
    const r = cleanRankLook(rk[k]);
    if (r) ranks[name] = r;
  }
  const out = {
    header: HEADERS.includes(o.header) ? o.header : 'banner',
    format: FORMATS.includes(o.format) ? o.format : 'classic',
    fonts,
    colors,
  };
  if (Object.keys(text).length) out.text = text;
  if (Object.keys(ranks).length) out.ranks = ranks;
  const bg = cleanBackground(o.background);
  if (bg) out.background = bg;
  return out;
}

// THE PAGE'S BACKGROUND: one picture, animated picture or short video the
// host gave, drawn behind the whole page (board or plain standings) under a
// layer of the page's own background color, so the names stay readable over
// a busy one. Kept in the bundle's background folder (layout.LEADERBOARD_BG)
// under 'bg-' and 12 hex of its sha256, and copied into BG_DIR beside the
// exported page. fit: cover (fill, cropping), contain (all of it, with the
// page's color around it) or tile; dim: how much of that color lies over it,
// in percent.
const BG_DIR = 'leaderboard-bg';
const BG_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'video/mp4': 'mp4', 'video/webm': 'webm' };
const BG_FILE_RE = /^bg-[0-9a-f]{12}\.(png|jpg|webp|gif|mp4|webm)$/;
const BG_VIDEO_RE = /\.(mp4|webm)$/;
const BG_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
const BG_VIDEO_MAX_BYTES = 20 * 1024 * 1024;
const BG_FITS = ['cover', 'contain', 'tile'];
const BG_DIM_DEFAULT = 40;
const BG_DIM_MAX = 90;

function cleanBackground(b) {
  if (!b || typeof b !== 'object' || Array.isArray(b) || typeof b.file !== 'string' || !BG_FILE_RE.test(b.file)) return null;
  const d = typeof b.dim === 'string' && b.dim.trim() !== '' ? Number(b.dim) : b.dim;
  return {
    file: b.file,
    fit: BG_FITS.includes(b.fit) ? b.fit : 'cover',
    dim: Number.isInteger(d) && d >= 0 && d <= BG_DIM_MAX ? d : BG_DIM_DEFAULT,
  };
}

// A background as sent: type (its MIME type) and buf (its bytes). Checks the
// type, the size for its kind, and that the bytes are what the type says.
// -> { name, buf }. Throws an Error whose message says what is wrong.
function backgroundFile(type, buf) {
  const ext = BG_TYPES[String(type || '').toLowerCase().split(';')[0].trim()];
  if (!ext) throw new Error('A background has to be a PNG, JPEG, WebP or GIF picture, or an MP4 or WebM video.');
  if (!buf || !buf.length) throw new Error('No file was sent.');
  const video = ext === 'mp4' || ext === 'webm';
  if (buf.length > (video ? BG_VIDEO_MAX_BYTES : BG_IMAGE_MAX_BYTES)) {
    throw new Error(video ? 'That video is over 20 MB. Make the loop shorter or smaller and try again.'
      : 'That picture is over 10 MB. Save it smaller, or turn a long animation into an MP4 or WebM video, and try again.');
  }
  const at = (i, s) => buf.length >= i + s.length && buf.toString('latin1', i, i + s.length) === s;
  const ok = {
    png: () => buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    jpg: () => buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff,
    gif: () => at(0, 'GIF87a') || at(0, 'GIF89a'),
    webp: () => at(0, 'RIFF') && at(8, 'WEBP'),
    mp4: () => at(4, 'ftyp'),
    webm: () => buf.length > 4 && buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3,
  }[ext];
  if (!ok()) throw new Error('That file is not the ' + ext.toUpperCase() + ' its name says it is.');
  const hash = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 12);
  return { name: 'bg-' + hash + '.' + ext, buf };
}

// The background an export ships from the bundle's folder `dir`: the file
// the look names, when it is there. -> the look's background, or null.
function shippableBackground(v, dir) {
  const bg = normalize(v).background;
  if (!bg) return null;
  try { return fs.statSync(path.join(dir, bg.file)).isFile() ? bg : null; } catch (e) { return null; }
}

// What roster.json keeps: only what differs from the default, or null (no
// key) when nothing does.
function toRoster(v) {
  const l = normalize(v);
  const out = {};
  if (l.header !== 'banner') out.header = l.header;
  if (l.format !== 'classic') out.format = l.format;
  if (Object.keys(l.fonts).length) out.fonts = l.fonts;
  if (l.colors.preset !== 'classic' || Object.keys(l.colors).length > 1) out.colors = l.colors;
  if (l.text) out.text = l.text;
  if (l.ranks) out.ranks = l.ranks;
  if (l.background) out.background = l.background;
  return Object.keys(out).length ? out : null;
}

// The font files a look needs beside the page (each once).
function fontFiles(v) {
  const l = normalize(v);
  return [...new Set(Object.values(l.fonts))].map((id) => id + '.otf');
}

// The rank pictures a look needs from RANK_DIR beside the page (each once).
function rankImages(v) {
  const l = normalize(v);
  return [...new Set(Object.values(l.ranks || {}).map((r) => r.image).filter(Boolean))];
}

// WHAT A RANK PICTURE MAY HOLD. A PNG or a WebP is a picture and nothing
// else. An SVG is a document: opened by itself on the host's site it would
// run any script in it, and it can ask for other files. A rank icon needs
// none of that, so an SVG with a script, an event handler, a javascript:
// address, a link to another file (only #ids in the same file and embedded
// pictures are kept) or an entity of its own is refused. So is markup from
// any namespace but SVG's and XLink's: a prefix can make <s:script> an SVG
// script or <h:iframe> an HTML one, so the test is the namespace, not the
// spelling. The Studio serves these under a sandboxing policy as well; the
// export copies only what passes this again. -> null, or what is wrong:
// 'notsvg', 'script', 'handler', 'jsurl', 'extra' (an entity or a
// foreignObject), 'namespace' or 'link'.
const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';
function svgProblem(text) {
  // An embedded picture's base64 can spell anything ('/onAB=' at its end),
  // so a quoted value that is one whole embedded picture is read past, not
  // into. Only a quoted one: unquoted, its end could not be told from the
  // attributes after it.
  const raw = String(text).replace(/(["'])(data:image[/](?:png|jpe?g|gif|webp);base64,)[A-Za-z0-9+/=\s]*(?=\1)/gi, '$1$2');
  // The browser reads &#58; as ':' (and &#106; as 'j'), so every test below
  // reads the characters the browser will, not their spelling.
  const s = raw.replace(/&#(?:x([0-9a-f]+)|([0-9]+));/gi, (m, h, d) => {
    const c = parseInt(h || d, h ? 16 : 10);
    return c > 0 && c <= 0x10ffff ? String.fromCodePoint(c) : '';
  });
  if (!/<svg[\s/>]/i.test(s)) return 'notsvg';
  // A tag may carry a prefix (<s:script>), and a prefix may be any letters.
  if (/<\s*(?:[^\s<>:"'/]+:)?script/i.test(s)) return 'script';
  if (/[\s/"'\x00]on[a-z]+\s*=/i.test(s) || /attributeName\s*=\s*["']\s*on/i.test(s)) return 'handler';
  // A URL loses its tabs and line breaks before its scheme is read.
  if (/j\s*a\s*v\s*a\s*s\s*c\s*r\s*i\s*p\s*t\s*:/i.test(s)) return 'jsurl';
  if (/<!ENTITY/i.test(s) || /<\s*(?:[^\s<>:"'/]+:)?foreignObject/i.test(s)) return 'extra';
  // Namespaces: the plain one is SVG's and a prefixed one SVG's or XLink's
  // (Inkscape writes xmlns:svg), every 'xmlns' in the file has to be one of
  // those, no tag has a prefix, and an attribute's prefix is xlink, xml
  // (xml:space) or xmlns.
  let declared = 0;
  for (const m of s.matchAll(/[\s"']xmlns(?::([^\s=<>"'/:]+))?\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    const ns = m[2] !== undefined ? m[2] : m[3];
    if (m[1] === undefined ? ns !== SVG_NS : ns !== SVG_NS && ns !== XLINK_NS) return 'namespace';
    declared++;
  }
  if ((s.match(/xmlns/gi) || []).length !== declared) return 'namespace';
  if (/<[^\s!?/<>]*:/.test(s)) return 'namespace';
  for (const m of s.matchAll(/[\s"']([^\s=<>"'/:]+):[^\s=<>"'/]+\s*=\s*["']/g)) {
    if (!['xlink', 'xml', 'xmlns'].includes(m[1])) return 'namespace';
  }
  const local = (u) => /^#/.test(u) || /^data:image\/(png|jpe?g|gif|webp);base64,/i.test(u);
  const value = (m) => String(m[1] !== undefined ? m[1] : m[2] !== undefined ? m[2] : m[3]).trim();
  for (const m of s.matchAll(/(?:^|[\s/"'])(?:[a-z0-9_-]+:)?href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
    if (!local(value(m))) return 'link';
  }
  // An animation that sets a link (<set attributeName="href" to="...">)
  // links out through its to= or values=, which the test above never reads.
  if (/attributeName\s*=\s*["']\s*(?:[^\s"':]+:)?href\s*["']/i.test(s)) return 'link';
  // xml:base would point even a #id at another address.
  if (/[\s"']xml:base\s*=/.test(s)) return 'link';
  if (/@import/i.test(s)) return 'link';
  for (const m of s.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)/gi)) {
    if (!local(value(m))) return 'link';
  }
  return null;
}

// A PICTURE FOR A RANK, as the Studio's upload route gets it: { rank, type,
// data } with data in base64 (a data: address of the same type is taken
// too). Checked whole before anything is written: the rank's name, the type,
// the size, that the bytes are what the type says and, for an SVG, what it
// holds. -> { name, ext, buf }, name being <rank>-<8 hex of its sha256>.<ext>
// (the same picture always gets the same name). Throws an Error whose
// message says what is wrong.
function rankImageFile(input) {
  const b = input && typeof input === 'object' ? input : {};
  const rank = rankName(b.rank);
  if (!rank) throw new Error('rank must be a rank name: 1 to 16 letters, digits, spaces or . _ -');
  const ext = RANK_IMAGE_TYPES[b.type];
  if (!ext) throw new Error('A rank picture has to be a PNG, a WebP or an SVG.');
  let data = typeof b.data === 'string' ? b.data : '';
  const pre = /^data:([^;,]+);base64,/i.exec(data);
  if (pre) {
    if (pre[1].toLowerCase() !== b.type) throw new Error('The picture\'s data is not the type it was sent as.');
    data = data.slice(pre[0].length);
  }
  data = data.replace(/\s+/g, '');
  if (!data) throw new Error('No picture was sent.');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw new Error('The picture did not arrive whole (its data is not base64). Try again.');
  // Refused before decoding when the text alone is too long for it.
  if (Math.floor(data.length * 3 / 4) > RANK_IMAGE_MAX_BYTES + 2) throw new Error('That picture is over 256 KB. A rank icon is drawn small: save it smaller and try again.');
  const buf = Buffer.from(data, 'base64');
  if (!buf.length) throw new Error('No picture was sent.');
  if (buf.length > RANK_IMAGE_MAX_BYTES) throw new Error('That picture is over 256 KB. A rank icon is drawn small: save it smaller and try again.');
  if (ext === 'png' && !(buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))) {
    throw new Error('That file is not a PNG.');
  }
  if (ext === 'webp' && !(buf.length > 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP')) {
    throw new Error('That file is not a WebP picture.');
  }
  if (ext === 'svg') {
    switch (svgProblem(buf.toString('utf8'))) {
      case null: break;
      case 'notsvg': throw new Error('That file is not an SVG drawing.');
      case 'script': throw new Error('That SVG has a script in it, so it was refused. Save it again as a plain drawing, or as a PNG.');
      case 'handler': throw new Error('That SVG has an event handler (an on... attribute) in it, so it was refused. Save it again as a plain drawing, or as a PNG.');
      case 'jsurl': throw new Error('That SVG has a javascript: address in it, so it was refused. Save it again as a plain drawing, or as a PNG.');
      case 'extra': throw new Error('That SVG has parts a rank icon never needs (an entity or a foreignObject), so it was refused. Save it again as a plain drawing, or as a PNG.');
      case 'namespace': throw new Error('That SVG has markup from outside SVG in it (HTML, or an editor\'s own notes), so it was refused. Save it again as a plain or optimized SVG, or as a PNG.');
      default: throw new Error('That SVG links to another file, so it was refused. A rank icon has to hold all of its own drawing.');
    }
  }
  const slug = rank.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'rank';
  const hash = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 8);
  return { name: slug + '-' + hash + '.' + ext, ext, buf };
}

// THE RANK PICTURES AN EXPORT SHIPS, from the bundle's folder `dir`
// (layout.LEADERBOARD_RANKS): the ones the look names that are there and,
// for an SVG, still pass svgProblem (a file can be put in the folder by
// hand, and on the host's site an SVG is served as a page of its own).
// -> { files, ranks, left }: the files to copy into RANK_DIR beside the page;
// the look's ranks for the page with every other picture taken out, so the
// board draws that rank's shield instead of a broken picture (null when no
// rank is left with anything set); and [{ file, why }] for what was left out
// ('missing' or 'unsafe').
function shippableRanks(v, dir) {
  const l = normalize(v);
  const files = [];
  const left = [];
  for (const f of rankImages(l)) {
    const from = path.join(dir, f);
    let text = null;
    try { text = fs.statSync(from).isFile() ? (/\.svg$/.test(f) ? fs.readFileSync(from, 'utf8') : '') : null; } catch (e) { text = null; }
    if (text === null) left.push({ file: f, why: 'missing' });
    else if (/\.svg$/.test(f) && svgProblem(text)) left.push({ file: f, why: 'unsafe' });
    else files.push(f);
  }
  const gone = new Set(left.map((x) => x.file));
  const ranks = {};
  for (const [name, r] of Object.entries(l.ranks || {})) {
    const kept = Object.assign({}, r);
    if (gone.has(kept.image)) delete kept.image;
    if (Object.keys(kept).length) ranks[name] = kept;
  }
  return { files, ranks: Object.keys(ranks).length ? ranks : null, left };
}

module.exports = {
  HEADERS, FORMATS, ROLES, FONTS, FONT_DIR, COLOR_KEYS, CUSTOM_KEYS, PRESETS, TEXT_KEYS, TEXT_MAX,
  RANK_NAME_RE, RANK_LOOKS_MAX, PIPS_MAX, RANK_DIR, RANK_IMAGE_RE, RANK_IMAGE_TYPES, RANK_IMAGE_MAX_BYTES,
  BG_DIR, BG_TYPES, BG_FILE_RE, BG_VIDEO_RE, BG_IMAGE_MAX_BYTES, BG_VIDEO_MAX_BYTES, BG_FITS, BG_DIM_DEFAULT, BG_DIM_MAX,
  normalize, toRoster, fontFiles, rankImages, svgProblem, rankImageFile, shippableRanks, backgroundFile, shippableBackground,
};
