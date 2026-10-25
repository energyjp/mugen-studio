'use strict';
//
// THE MODS TAB: THE STUDIO'S OWN ADD-ONS, AND THE BUNDLE'S OWN MODS.
//
// Ikemen GO loads every .lua under external/mods at boot, at ANY depth - the
// walk in main.lua (getDirectoryFiles, script.go) is recursive - except a file
// whose NAME starts with '-', which is how a mod keeps helpers it requires
// itself. Each file is loaded with require() on its path, the extension cut
// and the separators turned into dots, so a dot anywhere else in the path (a
// folder "v1.2", a file "my.mod.lua") breaks the require. Every
// external/mods/**/+system.def is appended to the screenpack as well
// (motif.go). So a mod can be a folder, and the Studio keeps each one in a
// folder of its own:
//
//   <bundle>/mods/<folder>/          one mod (layout.dir('mods'))
//
// A mod folder has one of two layouts, decided on every scan:
//   "game"  its root has external/, data/, font/ or sound/: the files go to
//           the same paths in the build - a mod made for an Ikemen install.
//   "lua"   anything else: the files go to external/mods/<folder>/.
// chars/ and stages/ are never shipped from a mod (characters and stages are
// added on their own tabs), and neither is anything outside the game's own
// folders in a "game" mod: a mod's Ikemen_GO.exe must never land on the
// engine a desktop export unpacked.
//
// What a mod says about itself is read the way Fluffy Mod Manager reads it:
// modinfo.ini (name, author, version, description, screenshot, homepage,
// category), else a readme and a picture at the mod's root. The files that
// describe it are not shipped - except a picture the mod's own files name,
// which it may draw.
//
// What is switched off, the add-ons and the user's mods alike, is the
// bundle's roster.modsOff = { builtin: [id], user: [folder] } (ids sorted; no
// key at all is everything on). The builds ask builtinOn and userModFiles;
// the Mods tab asks listMods through /api/mods. Every write here is a
// read-modify-write of roster.json on disk, never the page's snapshot.

const fs = require('fs');
const path = require('path');
const os = require('os');

function layout() { return require('./layout.js'); }
// Lazily: vfslib asks this module while it builds, so a top-level require
// would be circular.
function vfslib() { return require('./vfslib.js'); }
// Never a bare fs.rmSync: the Studio's Node returns from it without deleting
// when the path holds a non-ASCII character (lifebars.js).
const rmTree = (p) => require('./lifebars.js').rmTree(p);
const rmFile = (p) => require('./lifebars.js').rmFile(p);

// ---- the Studio's own add-ons ----------------------------------------------
//
// ONE FOLDER FOR ALL OF THEM, so a desktop install's external/mods holds the
// Studio's files in one place and the user's mods beside it. No dot in it:
// it is part of every require path below it. This is the single source of
// these paths; the generators (netmenu.js, teamplay.js, selectann.js,
// gallery.js, vfslib.js, desktop.js) name the same strings.
const STUDIO_MODS_DIR = 'external/mods/mugen-studio';
// The frame meter's source: a plain Lua file the Studio carries (addons/),
// shipped as it is when the Mods tab switches it on.
const FRAMEBAR_SOURCE = path.join(__dirname, 'addons', 'framebar', 'framebar.lua');

const VPATHS = Object.freeze({
  netMenu: STUDIO_MODS_DIR + '/net-menu.lua',
  netMenuFont: 'font/net-menu-6x9.def',
  teamPlay: STUDIO_MODS_DIR + '/team-play.lua',
  selectAnn: STUDIO_MODS_DIR + '/select-announcer.lua',
  sceneViewer: STUDIO_MODS_DIR + '/sceneviewer.lua',
  trainingTeam: STUDIO_MODS_DIR + '/training-team.lua',
  trainingZss: 'data/sceneviewer.zss',
  galleryLua: STUDIO_MODS_DIR + '/hgallery.lua',
  galleryZss: 'data/hgallery.zss',
  webflags: STUDIO_MODS_DIR + '/webflags.lua',
  onlineName: STUDIO_MODS_DIR + '/onlinename.lua',
  framebar: STUDIO_MODS_DIR + '/framebar.lua',
  netNamesDef: 'font/net-names.def',
  netNamesSff: 'font/net-names.sff',
  // What a desktop export wrote for the user's mods, so the next export of
  // any bundle into the same install removes what it no longer ships. JSON,
  // not .lua, so the engine never loads it.
  userModsManifest: STUDIO_MODS_DIR + '/user-mods.json',
});
// Where the add-ons were before they moved into one folder. A desktop export
// removes these from an install an earlier export wrote.
const LEGACY_VPATHS = Object.freeze([
  'external/mods/net-menu.lua', 'external/mods/team-play.lua', 'external/mods/select-announcer.lua',
  'external/mods/sceneviewer.lua', 'external/mods/training-team.lua', 'external/mods/hgallery.lua',
  'external/mods/webflags.lua', 'external/mods/onlinename.lua',
]);

// The registry. `about` and `offLoses` are for a player: plain words, no file
// names. `locked` ones are listed and always on. `hOnly`: the page shows the
// row only in H-Mugen mode. `absentWhy`: what the page can say when this
// bundle's build would not carry it at all (listMods `present` false).
// THE GALLERY'S PROTOTYPE MODES (gallerymodes/index.js ROWS) are one row each,
// right after the gallery's own, id 'hgallery-<mode>': hOnly, on by default,
// present only where the gallery is and while its row is on (presentFor).
// They list no files - a mode rides inside the gallery's two - and the
// gallery's build asks gallerymodes.enabled(roster) which ones are on.
const galleryModeRows = () => {
  let rows = [];
  try { rows = require('./gallerymodes').ROWS; } catch (e) { rows = []; }
  return rows.map((m) => ({ id: m.addon, label: m.label, about: m.about, offLoses: m.offLoses,
    absentWhy: 'Only a build with the H gallery has it.', files: [], hOnly: true }));
};
const BUILTINS = Object.freeze([
  {
    id: 'net-menu',
    label: 'Online menu (PRESS N)',
    about: 'Puts PRESS N FOR ONLINE on the title screen of every screenpack. N opens a NETWORK box for hosting, joining'
      + ' or queuing for a match, drawn the same way whatever the screenpack looks like.',
    offLoses: 'No PRESS N hint and no NETWORK box on any title screen. A screenpack without its own NETWORK menu then'
      + ' has no way to host, join or queue, and friend lobbies are drawn in the screenpack\'s own menu style again.',
    files: [VPATHS.netMenu, VPATHS.netMenuFont],
  },
  {
    id: 'team-play',
    label: 'Team play',
    about: 'In Arcade the CPU team starts at your own team size. On screenpacks that draw every team mode in one spot,'
      + ' the team size icons show the highlighted mode. On a build with add004\'s tag system, the partner you tag in'
      + ' is yours to control and Simul starts at 3.',
    offLoses: 'The CPU team in Arcade starts at 2 again; the team size icons follow the last mode drawn on screenpacks'
      + ' that stack the modes; on an add004 tag build the partner you tag in fights as a CPU.',
    files: [VPATHS.teamPlay],
  },
  {
    id: 'select-announcer',
    label: 'Select-screen announcer',
    about: 'The announcer calls a fighter\'s name when a player picks him, with the clips this build used in MUGEN.',
    offLoses: 'No name call when a character is picked.',
    absentWhy: 'Only a bundle imported from a MUGEN build whose announcer called each fighter\'s name has this.',
    files: [VPATHS.selectAnn],
  },
  {
    id: 'training',
    label: 'Training sandbox',
    about: 'Extra tools in Training: Tab hands your controls to the next fighter on screen, Caps Lock locks a fighter'
      + ' to face the opponent you choose, the dummy side can be a Simul team (up to eight fighters in the room), and'
      + ' nobody fights back except as the dummy\'s own setting says.',
    offLoses: 'Tab and Caps Lock do nothing in Training. In the desktop build the dummy side is a single fighter again'
      + ' (five in the room at most), and Simul partners past the leaders get an AI level and fight back.',
    files: [VPATHS.sceneViewer, VPATHS.trainingTeam, VPATHS.trainingZss],
  },
  {
    id: 'framebar',
    label: 'Frame meter (Training)',
    about: 'Two rows of per-frame cells at the bottom of a Training match, one per player, with the startup of your'
      + ' last attack, its total frames and each side\'s frame advantage. F7 shows or hides it. It only reads the'
      + ' fighters, so it never changes a match.',
    offLoses: 'No frame meter in Training.',
    files: [VPATHS.framebar],
    // OFF until ticked: it never shipped before the Mods tab, so a build stays
    // as it was unless someone asks for it (roster.modsOn, not modsOff)
    defaultOff: true,
  },
  {
    id: 'hgallery',
    label: 'H gallery',
    about: 'A gallery mode on the title menu: it loads each pair in the roster and plays its scenes, stepped by hand.',
    offLoses: 'The gallery mode is gone from the title menu.',
    absentWhy: 'Only a build with a pair scene to show has the gallery.',
    files: [VPATHS.galleryLua, VPATHS.galleryZss],
    hOnly: true,
  },
  ...galleryModeRows(),
  {
    id: 'webflags',
    label: 'Website build marker',
    about: 'Tells the game it is running in a web browser, so JOIN GAME connects straight to a friend instead of'
      + ' asking for a server address.',
    offLoses: '',
    files: [VPATHS.webflags],
    locked: true,
    lockedWhy: 'Part of the website build itself (the desktop build never has it).',
  },
  {
    id: 'onlinename',
    label: 'Online names and ranked play',
    about: 'PLAYER NAME, casual and ranked matches, the name plates over the fighters, and the match mode the queues'
      + ' play.',
    offLoses: '',
    absentWhy: 'Off in Settings > Online > Online menu.',
    files: [VPATHS.onlineName, VPATHS.netNamesDef, VPATHS.netNamesSff],
    locked: true,
    lockedWhy: 'Follows Settings > Online > Online menu.',
  },
].map((b) => Object.freeze(Object.assign({ locked: false, lockedWhy: '', hOnly: false, absentWhy: '', defaultOff: false }, b,
  { files: Object.freeze(b.files.slice()) }))));
const BUILTIN_BY_ID = new Map(BUILTINS.map((b) => [b.id, b]));

// Whether this bundle's build would carry an add-on at all, by the same test
// the build uses. null when it cannot be known cheaply: the gallery's test
// (a giver in the roster) reads every character, and vfslib keeps the answer
// per character - asked only when vfslib offers it (rosterHasGalleryPair: a
// giver and a receiver, the build's own gate).
// `memo` (a Map, optional): answers already worked out for this same roster in
// this same call. The gallery's test reads every character (20 ms on Main) and
// one Mods list asks it for the gallery's row, each of its modes' rows, again
// per row, and again for the generated files - a dozen times per GET /api/mods.
function presentFor(id, roster, memo) {
  if (!memo) return presentNow(id, roster, null);
  const k = String(id);
  if (!memo.has(k)) memo.set(k, presentNow(id, roster, memo));
  return memo.get(k);
}
function presentNow(id, roster, memo) {
  try {
    if (id === 'select-announcer') return !!require('./selectann.js').luaForRoster(roster || {});
    if (id === 'hgallery') {
      const V = vfslib();
      return typeof V.rosterHasGalleryPair === 'function' ? !!V.rosterHasGalleryPair(roster || {}) : null;
    }
    // (a gallery prototype mode's row: where the gallery is, while its row is on)
    if (/^hgallery-/.test(String(id))) return builtinOn(roster || {}, 'hgallery') ? presentFor('hgallery', roster, memo) : false;
    if (id === 'onlinename') return !!(roster && roster.onlineName);
  } catch (e) {
    return null;
  }
  return true;
}

// ---- on and off --------------------------------------------------------------

// builtinOn: the default-off add-ons that were switched ON (roster.modsOn);
// every other add-on and mod is on unless listed in roster.modsOff.
function modsOff(roster) {
  const raw = roster && roster.modsOff;
  const on = roster && roster.modsOn;
  const list = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x) : []);
  return { builtin: new Set(list(raw && raw.builtin)), user: new Set(list(raw && raw.user)), builtinOn: new Set(list(on && on.builtin)) };
}

// A locked add-on is always on, whatever the roster says; a default-off one
// only when switched on.
function builtinOn(roster, id) {
  const b = BUILTIN_BY_ID.get(String(id));
  if (b && b.locked) return true;
  // THE H GALLERY (and its modes) ships only where the bundle's H-MUGEN module
  // is on (hmodule.js): declined or not yet answered, the exports leave it out
  // - the web build (vfslib) and the desktop export both ask here.
  if ((id === 'hgallery' || /^hgallery-/.test(String(id))) && !require('./hmodule.js').moduleOn(roster || {})) return false;
  if (b && b.defaultOff) return modsOff(roster).builtinOn.has(b.id);
  return !modsOff(roster).builtin.has(String(id));
}

function userOn(roster, folder) {
  return !modsOff(roster).user.has(String(folder));
}

// Writes the sets back into the roster object: ids sorted, an unknown or
// locked add-on dropped, and no key at all when nothing is off. -> whether
// the roster changed.
function storeModsOff(roster, off) {
  const now = () => JSON.stringify([roster.modsOff === undefined ? null : roster.modsOff, roster.modsOn === undefined ? null : roster.modsOn]);
  const before = now();
  const known = (id) => BUILTIN_BY_ID.has(id) && !BUILTIN_BY_ID.get(id).locked;
  const builtin = [...off.builtin].filter((id) => known(id) && !BUILTIN_BY_ID.get(id).defaultOff).sort();
  const user = [...off.user].filter((f) => typeof f === 'string' && f).sort();
  if (!builtin.length && !user.length) delete roster.modsOff;
  else roster.modsOff = { builtin, user };
  // the default-off add-ons switched on; no key when there are none
  const onIds = [...(off.builtinOn || [])].filter((id) => known(id) && BUILTIN_BY_ID.get(id).defaultOff).sort();
  if (!onIds.length) delete roster.modsOn;
  else roster.modsOn = { builtin: onIds };
  return now() !== before;
}

// ---- folder names -------------------------------------------------------------

const MAX_NAME = 60;
// Windows device names cannot be folders; the add-ons' own folder is taken.
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9]|mugen-studio)$/i;
// A folder's name as the build uses it: letters, digits, space, '_' and '-'.
// Accents come off their letters (Pokemon), every other run of characters is
// one '-', and there is no dot anywhere - it is part of every require path
// under it.
function safeName(s) {
  let n = String(s == null ? '' : s).normalize('NFKD').replace(/[̀-ͯ]/g, '');
  n = n.replace(/[^A-Za-z0-9 _-]+/g, '-').replace(/ {2,}/g, ' ').replace(/-{2,}/g, '-');
  const trim = (x) => x.replace(/^[ -]+|[ -]+$/g, '');
  n = trim(trim(n).slice(0, MAX_NAME));
  if (!n) n = 'mod';
  if (RESERVED.test(n)) n += '-mod';
  return n;
}

function modsDir() { return layout().dir('mods'); }

// Folders sort the way the build lets a later one win: by name, case aside.
function cmpName(a, b) {
  const x = a.toLowerCase(), y = b.toLowerCase();
  if (x !== y) return x < y ? -1 : 1;
  return a < b ? -1 : (a > b ? 1 : 0);
}

// A name no mod folder of this bundle has, case aside: base, base-2, base-3.
function freeFolder(base) {
  const dir = modsDir();
  let taken = new Set();
  try { taken = new Set(fs.readdirSync(dir).map((n) => n.toLowerCase())); } catch (e) { /* no folder yet */ }
  for (let i = 1; ; i++) {
    const suffix = i === 1 ? '' : '-' + i;
    const name = (i === 1 ? base : base.slice(0, MAX_NAME - suffix.length).replace(/[ -]+$/, '')) + suffix;
    if (!taken.has(name.toLowerCase()) && !fs.existsSync(path.join(dir, name))) return name;
  }
}

const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch (e) { return false; } };
const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch (e) { return false; } };
const fold = (p) => (process.platform === 'win32' ? p.toLowerCase() : p);

// A mod folder named by a request, as it is on disk: one entry directly in the
// bundle's mods folder, never a path. The exact name first, then the same name
// in other case (Windows would open either). Names starting with a dot are
// the installer's own and never a mod. -> the name, or null.
function canonicalFolder(folder) {
  const f = String(folder == null ? '' : folder);
  if (!f || f === '.' || f === '..' || f.startsWith('.') || /[\\/:*?"<>|\0]/.test(f)) return null;
  const dir = path.resolve(modsDir());
  if (path.dirname(path.join(dir, f)) !== dir) return null;
  let names = [];
  try { names = fs.readdirSync(dir); } catch (e) { return null; }
  const hit = names.includes(f) ? f : names.find((n) => n.toLowerCase() === f.toLowerCase());
  return hit && isDir(path.join(dir, hit)) ? hit : null;
}

// ---- reading a mod ----------------------------------------------------------------

// Never part of a mod: what an OS or an archiver leaves behind.
const JUNK = /^(__macosx|\.ds_store|thumbs\.db|desktop\.ini)$/i;
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp)$/i;
const IMAGE_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp' };
const DESC_FILES = ['readme.txt', 'readme.md', 'description.txt', 'info.txt', 'mod.txt'];
const IMAGE_NAMES = ['screenshot', 'preview', 'cover', 'thumbnail', 'icon', 'banner'];
const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'];
const GAME_ROOTS = /^(external|data|font|sound)$/i;
const CONTENT_ROOTS = /^(chars|stages)$/i;
// Root files in a "game" mod that look meant for the game but sit outside its
// folders (the rest of the root - readmes, licenses - is said nothing about).
const GAME_FILE = /\.(lua|def|sff|snd|air|cns|st|cmd|zss|fnt|ttf|otf|ogg|mp3|wav|exe|dll|ini)$/i;
const MAX_FILES = 20000;
const MAX_DEPTH = 16;
// A readme becomes the card's first words (readmeSummary); the whole of it is
// the Read me dialog's (readmeFor, /api/mods/readme).
const SUMMARY_CHARS = 600;
const README_MAX = 1048576;
const MODINFO_DESC_CHARS = 4000;

// Every file of a mod, sorted, as { rel (forward slashes), abs, size }. Links
// and junctions are not followed and dotted names (.git, .github) are left
// out.
function walkFiles(root) {
  const out = [];
  const walk = (dir, rel, depth) => {
    let ents = [];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    ents.sort((a, b) => cmpName(a.name, b.name));
    for (const e of ents) {
      if (out.length >= MAX_FILES) return;
      if (JUNK.test(e.name) || e.name.startsWith('.') || e.isSymbolicLink()) continue;
      const abs = path.join(dir, e.name), r = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) { if (depth < MAX_DEPTH) walk(abs, r, depth + 1); continue; }
      if (!e.isFile()) continue;
      let size = 0;
      try { size = fs.statSync(abs).size; } catch (x) { size = 0; }
      out.push({ rel: r, abs, size });
    }
  };
  walk(root, '', 0);
  return out;
}

// A text file a person wrote: UTF-16 with its mark, UTF-8 (a mark or not), or
// the ANSI code page's bytes taken as latin1.
function decodeText(buf) {
  if (buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xFE) return buf.slice(2).toString('utf16le');
  if (buf.length >= 2 && buf[0] === 0xFE && buf[1] === 0xFF) {
    const b = Buffer.from(buf.slice(2, 2 + ((buf.length - 2) & ~1)));
    return b.swap16().toString('utf16le');
  }
  if (buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) return buf.slice(3).toString('utf8');
  const u = buf.toString('utf8');
  return u.includes('�') ? buf.toString('latin1') : u;
}
const readText = (abs, max) => {
  try {
    const st = fs.statSync(abs);
    if (st.size > (max || 1048576)) return null;
    return decodeText(fs.readFileSync(abs));
  } catch (e) { return null; }
};

// modinfo.ini, Fluffy Mod Manager's file: key = value lines, a [section]
// header ignored, ';' and '#' comments, the first non-empty value of a key
// kept. A description is one line with \n escapes for its line breaks.
function parseModinfo(text) {
  const kv = {};
  for (const raw of String(text || '').split(/\r\n|\n|\r/)) {
    const line = raw.trim();
    if (!line || line[0] === ';' || line[0] === '#' || /^\[.*\]$/.test(line)) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim().toLowerCase();
    let val = line.slice(eq + 1).trim();
    if (val.length >= 2 && val[0] === '"' && val[val.length - 1] === '"') val = val.slice(1, -1).trim();
    if (val && !kv[key]) kv[key] = val;
  }
  const pick = (...keys) => { for (const k of keys) if (kv[k]) return kv[k]; return ''; };
  return {
    name: pick('name'),
    author: pick('author'),
    version: pick('version'),
    description: pick('description', 'desc').replace(/\\r\\n|\\n|\\r/g, '\n').slice(0, MODINFO_DESC_CHARS),
    image: pick('screenshot', 'image', 'preview'),
    homepage: pick('homepage', 'url'),
    category: pick('category'),
  };
}

// A mod's modinfo.ini at its root, parsed, or null.
function readModinfo(root) {
  let names = [];
  try { names = fs.readdirSync(root); } catch (e) { return null; }
  const f = names.find((n) => n.toLowerCase() === 'modinfo.ini');
  if (!f || !isFile(path.join(root, f))) return null;
  const t = readText(path.join(root, f));
  return t === null ? null : Object.assign(parseModinfo(t), { file: f });
}

// The build writes these itself, and the generated layer always wins: a mod's
// copy of one is never used. A static list - the scan cannot run the build:
// the config, select.def, the screenpack's system.def and every add-on's
// files.
const DEFAULT_MOTIF = 'data/ikemen1/system.def';
function generatedVpaths(roster, memo) {
  const s = new Set(['save/config.ini', 'save/config.json', 'save/stats.json', 'data/select.def']);
  s.add(String((roster && roster.motif) || DEFAULT_MOTIF).replace(/\\/g, '/').toLowerCase());
  // only the add-ons this bundle's build ships: an add-on that is off, or not
  // in this build, writes nothing, so a mod's copy of its file is the one used
  const seen = memo || new Map();
  for (const b of BUILTINS) {
    if (!builtinOn(roster, b.id) || presentFor(b.id, roster, seen) === false) continue;
    for (const f of b.files) s.add(f.toLowerCase());
  }
  return s;
}

// "a, b and 3 more"
function some(list, n) {
  const k = n || 3;
  if (list.length <= k) return list.length > 1 ? list.slice(0, -1).join(', ') + ' and ' + list[list.length - 1] : (list[0] || '');
  return list.slice(0, k).join(', ') + ' and ' + (list.length - k) + ' more';
}

// One mod folder: what it says about itself, where its files go, and what is
// wrong with it. `folder` is its name on disk; `generated` the vpaths the
// build writes itself (lowercase).
function scanMod(abs, folder, generated) {
  const files = walkFiles(abs);
  const rootFiles = new Map();   // lowercase name -> the file
  for (const f of files) if (!f.rel.includes('/')) rootFiles.set(f.rel.toLowerCase(), f);
  const byRel = new Map(files.map((f) => [f.rel.toLowerCase(), f]));

  const info = readModinfo(abs) || {};
  const meta = new Set();
  if (info.file) meta.add(info.file.toLowerCase());

  // The description: modinfo's, else the first paragraphs of the first readme
  // at the root, as plain text. The readme itself is the card's Read me.
  let description = info.description || '';
  let readme = null;
  for (const n of DESC_FILES) {
    const f = rootFiles.get(n);
    if (!f) continue;
    const t = readText(f.abs, README_MAX);
    if (t === null) continue;
    readme = f.rel;
    meta.add(n);
    if (!description) description = readmeSummary(t);
    break;
  }

  // The picture: modinfo's screenshot (a file in the folder), else one named
  // like a cover at the root, else the root's only picture.
  let image = null;
  if (info.image) {
    const want = info.image.replace(/\\/g, '/').replace(/^(\.\/)+/, '').toLowerCase();
    const f = byRel.get(want);
    if (f && IMAGE_EXT.test(f.rel)) image = f;
  }
  if (!image) {
    outer: for (const n of IMAGE_NAMES) {
      for (const x of IMAGE_EXTS) { const f = rootFiles.get(n + x); if (f) { image = f; break outer; } }
    }
  }
  if (!image) {
    const pics = [...rootFiles.values()].filter((f) => IMAGE_EXT.test(f.rel));
    if (pics.length === 1) image = pics[0];
  }
  // A picture the mod's own files name is one it may draw: it ships.
  if (image) {
    const needle = path.basename(image.rel).toLowerCase();
    let used = false;
    let budget = 200;
    for (const f of files) {
      if (used || budget <= 0) break;
      const low = f.rel.toLowerCase();
      if (meta.has(low) || DESC_FILES.includes(low) || !/\.(lua|def|zss|cns|st|cmd|air|ini|json|txt)$/i.test(f.rel)) continue;
      budget--;
      const t = readText(f.abs, 2 * 1048576);
      if (t !== null && t.toLowerCase().includes(needle)) used = true;
    }
    if (!used) meta.add(image.rel.toLowerCase());
  }

  // The layout, and where each file goes.
  const rootDirs = new Set(files.filter((f) => f.rel.includes('/')).map((f) => f.rel.split('/')[0].toLowerCase()));
  const game = [...rootDirs].some((d) => GAME_ROOTS.test(d));
  // A folder put here by hand may have a dot (or a space run, an accent) in
  // its name: its files go under the name the installer would have given it.
  const prefix = 'external/mods/' + safeName(folder) + '/';
  const shipped = [];
  const content = new Set(), strayDirs = new Set(), strayFiles = [];
  for (const f of files) {
    const low = f.rel.toLowerCase();
    if (meta.has(low)) continue;
    if (/\.(orig|bak|presquare)$/.test(low)) continue;   // backups: neither build ships one
    const segs = f.rel.split('/');
    const top = segs[0].toLowerCase();
    if (segs.length > 1 && CONTENT_ROOTS.test(top)) { content.add(top); continue; }
    let vpath;
    if (game) {
      if (segs.length === 1) { if (GAME_FILE.test(f.rel)) strayFiles.push(f.rel); continue; }
      if (!GAME_ROOTS.test(top)) { strayDirs.add(segs[0]); continue; }
      segs[0] = top;
      if (top === 'external' && segs.length > 2 && /^(mods|script)$/i.test(segs[1])) segs[1] = segs[1].toLowerCase();
      vpath = segs.join('/');
    } else {
      vpath = prefix + f.rel;
    }
    shipped.push({ vpath, abs: f.abs, size: f.size });
  }

  const warnings = [];
  if (content.size) {
    const two = content.size > 1;
    warnings.push('Characters and stages are added on their own tabs: the ' + [...content].sort().join(' and ')
      + ' folder' + (two ? 's' : '') + ' in this mod ' + (two ? 'are' : 'is') + ' not used.');
  }
  if (strayDirs.size || strayFiles.length) {
    const what = [...[...strayDirs].sort().map((d) => d + '/'), ...strayFiles];
    warnings.push(some(what) + (what.length > 1 ? ' are' : ' is') + ' outside the game\'s folders (data, external, font,'
      + ' sound), so ' + (what.length > 1 ? 'they are' : 'it is') + ' not used.');
    const luas = strayFiles.filter((f) => /\.lua$/i.test(f));
    if (luas.length) {
      warnings.push('To make ' + some(luas) + ' load, put ' + (luas.length > 1 ? 'them' : 'it') + ' in external/mods/'
        + safeName(folder) + '/ inside this mod\'s folder (Open folder), beside its data, font or sound folders.');
    }
  }
  const dotted = [], scripts = [], built = [];
  let runs = false;
  for (const s of shipped) {
    const low = s.vpath.toLowerCase();
    const base = low.split('/').pop();
    if (low.startsWith('external/mods/')) {
      if (base === '+system.def') runs = true;
      if (/\.lua$/.test(base) && !base.startsWith('-')) {
        runs = true;
        if (s.vpath.slice('external/mods/'.length, -4).includes('.')) dotted.push(s.vpath);
      }
    }
    if (low.startsWith('external/script/')) scripts.push(s.vpath);
    if (generated && generated.has(low)) built.push(s.vpath);
  }
  if (dotted.length) {
    warnings.push(some(dotted) + ' cannot load: the engine loads a mod by a name'
      + ' made from its path, and a dot in a folder or file name (other than .lua) breaks it. Rename without the dot.');
  }
  if (scripts.length) warnings.push(some(scripts) + (scripts.length > 1 ? ' replace' : ' replaces') + ' the engine\'s own script of that name.');
  if (built.length) warnings.push('The build writes ' + some(built) + ' itself; the mod\'s copy is not used.');
  if (!runs) warnings.push('Nothing in it runs by itself: it has no .lua file and no +system.def.');

  // a bare address (www.nexusmods.com/...) gets https://; anything else is dropped
  const hp = String(info.homepage || '').trim();
  const homepage = /^https?:\/\/[^\s"'<>]+$/i.test(hp) ? hp
    : (/^(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)+(\/[^\s"'<>]*)?$/i.test(hp) ? 'https://' + hp : '');
  return {
    folder,
    name: info.name || folder,
    author: info.author || '',
    version: info.version || '',
    description,
    image: image ? '/api/mods/image?folder=' + encodeURIComponent(folder) + '&file=' + encodeURIComponent(image.rel) : null,
    homepage,
    category: info.category || '',
    readme,
    layout: game ? 'game' : 'lua',
    shipped,
    warnings,
  };
}

// Every mod folder of the bundle, scanned, in the order a later one wins.
function scanAll(roster, memo) {
  const dir = modsDir();
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return []; }
  const gen = generatedVpaths(roster, memo);
  const out = [];
  for (const e of ents) {
    if (e.name.startsWith('.') || JUNK.test(e.name)) continue;
    const abs = path.join(dir, e.name);
    if (!isDir(abs)) continue;
    out.push(scanMod(abs, e.name, gen));
  }
  return out.sort((a, b) => cmpName(a.folder, b.folder));
}

// What the builds ship of the user's mods: every ON mod's files, a vpath two
// mods both write going to the folder that sorts later. -> [{ vpath, abs,
// folder }].
function userModFiles(roster) {
  const off = modsOff(roster);
  const byV = new Map();
  for (const m of scanAll(roster)) {
    if (off.user.has(m.folder)) continue;
    for (const f of m.shipped) {
      const k = f.vpath.toLowerCase();
      byV.delete(k);   // the later folder's spelling, at the later place
      byV.set(k, { vpath: f.vpath, abs: f.abs, folder: m.folder });
    }
  }
  return [...byV.values()];
}

// The Mods tab: GET /api/mods.
function listMods(opts) {
  const o = opts || {};
  let roster = o.roster;
  if (!roster) { try { roster = vfslib().readRoster(); } catch (e) { roster = {}; } }
  const off = modsOff(roster);
  // An hOnly add-on is listed only where the build carries it (H stays
  // hidden until found): the page also hides it outside H-Mugen mode, but the
  // answer itself must not name it in a bundle without it.
  // ...and only while the bundle's H-MUGEN module is on (hmodule.js).
  const hOn = require('./hmodule.js').moduleOn(roster || {});
  // one answer per add-on for this call (presentFor's memo)
  const memo = new Map();
  const builtins = BUILTINS.filter((b) => !b.hOnly || (hOn && presentFor(b.id, roster, memo) === true)).map((b) => {
    const present = presentFor(b.id, roster, memo);
    return {
      id: b.id, label: b.label, about: b.about, offLoses: b.offLoses,
      on: builtinOn(roster, b.id),
      locked: b.locked, lockedWhy: b.lockedWhy, defaultOff: b.defaultOff,
      present, absentWhy: present === false ? b.absentWhy : '',
      hOnly: b.hOnly,
    };
  });
  const scans = scanAll(roster, memo);
  // Conflicts, among the mods that are on: vpath -> the folders, in order.
  const owners = new Map();
  for (const m of scans) {
    if (off.user.has(m.folder)) continue;
    for (const f of m.shipped) {
      const k = f.vpath.toLowerCase();
      if (!owners.has(k)) owners.set(k, []);
      owners.get(k).push(m.folder);
    }
  }
  const user = scans.map((m) => {
    const on = !off.user.has(m.folder);
    const conflicts = [];
    if (on) {
      for (const f of m.shipped) {
        const who = owners.get(f.vpath.toLowerCase());
        if (who && who.length > 1) conflicts.push({ vpath: f.vpath, with: who.filter((x) => x !== m.folder), winner: who[who.length - 1] });
      }
    }
    return {
      folder: m.folder, name: m.name, author: m.author, version: m.version, description: m.description, readme: m.readme || null,
      image: m.image, homepage: m.homepage, category: m.category, on, layout: m.layout,
      files: m.shipped.map((f) => f.vpath),
      fileCount: m.shipped.length,
      bytes: m.shipped.reduce((n, f) => n + f.size, 0),
      warnings: m.warnings,
      conflicts,
    };
  });
  // modsOff as stored, so the page's roster copy matches the disk exactly
  const stored = roster && roster.modsOff;
  const storedOn = roster && roster.modsOn;
  return { dir: modsDir(), builtins, user, modsOff: stored && typeof stored === 'object' ? stored : null,
    modsOn: storedOn && typeof storedOn === 'object' ? storedOn : null };
}

// ---- switching ------------------------------------------------------------------

// Turn an add-on (kind 'builtin', id) or a user mod (kind 'user', its folder)
// on or off: roster.modsOff, read and written on disk. -> the listMods body.
function setModOn(kind, id, on) {
  const want = on === true || on === 'true' || on === 1;
  const V = vfslib();
  const roster = V.readRoster();
  const off = modsOff(roster);
  const k = String(kind || '');
  if (k === 'builtin') {
    const b = BUILTIN_BY_ID.get(String(id));
    if (!b) throw new Error('there is no add-on called ' + id);
    if (b.locked) throw new Error(b.label + ' cannot be switched off here: ' + b.lockedWhy);
    if (b.defaultOff) { if (want) off.builtinOn.add(b.id); else off.builtinOn.delete(b.id); }
    else if (want) off.builtin.delete(b.id); else off.builtin.add(b.id);
  } else if (k === 'user') {
    const folder = canonicalFolder(id);
    if (!folder) {
      // Turning on a mod that is gone only tidies the list.
      if (!want) throw new Error('there is no mod called ' + id);
      off.user.delete(String(id));
    } else if (want) {
      off.user.delete(folder);
      off.user.delete(String(id));
    } else {
      off.user.add(folder);
    }
  } else {
    throw new Error('kind must be builtin or user');
  }
  if (storeModsOff(roster, off)) V.writeRoster(roster);
  return listMods({ roster });
}

// Delete a user mod's folder, and its line in roster.modsOff. -> listMods.
function removeMod(folder) {
  const name = canonicalFolder(folder);
  if (!name) throw new Error('there is no mod called ' + folder);
  const abs = path.join(modsDir(), name);
  // A link or junction put here by hand goes as the link: what it points at
  // is somebody's own folder.
  if (fs.lstatSync(abs).isSymbolicLink()) {
    try { fs.unlinkSync(abs); } catch (e) { fs.rmdirSync(abs); }
    let still = true;
    try { fs.lstatSync(abs); } catch (e) { still = e.code !== 'ENOENT'; }
    if (still) throw new Error('could not delete ' + abs);
  } else {
    rmTree(abs);
  }
  const V = vfslib();
  const roster = V.readRoster();
  const off = modsOff(roster);
  off.user.delete(name);
  if (storeModsOff(roster, off)) V.writeRoster(roster);
  return listMods({ roster });
}

// ---- installing ------------------------------------------------------------------

// What may sit beside a mod's one folder without making the root the mod:
// what describes it.
const isMetaName = (n) => /^modinfo\.ini$/i.test(n) || DESC_FILES.includes(n.toLowerCase()) || IMAGE_EXT.test(n)
  || /\.(txt|md|nfo|url|pdf|html?)$/i.test(n) || /^(license|licence|copying|changelog|authors|credits)(\..*)?$/i.test(n);

function rootEntries(dir) {
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { ents = []; }
  ents = ents.filter((e) => !JUNK.test(e.name) && !e.name.startsWith('.') && !e.isSymbolicLink());
  return {
    dirs: ents.filter((e) => e.isDirectory()).map((e) => e.name).sort(cmpName),
    files: ents.filter((e) => e.isFile()).map((e) => e.name).sort(cmpName),
  };
}
const hasModinfo = (dir) => rootEntries(dir).files.some((f) => /^modinfo\.ini$/i.test(f));

// Where the mods are in what was dropped. A root with a modinfo.ini is a mod.
// A root holding only one folder (and what describes it) is that folder -
// once, and once more when the folder inside has the same name (Pack/Pack/) -
// unless that folder is one of the game's own (external/, data/ ...: then the
// root is a "game" mod). A root of several folders that each have a
// modinfo.ini is several mods. -> [{ root, name (its own folder name, or
// null for the drop's top), carry: [what described it from outside] }].
function findModRoots(top) {
  let dir = top, depth = 0, name = null;
  let carry = [];
  for (;;) {
    const { dirs, files } = rootEntries(dir);
    if (files.some((f) => /^modinfo\.ini$/i.test(f))) break;
    if (dirs.length >= 2 && files.every(isMetaName) && dirs.every((d) => hasModinfo(path.join(dir, d)))) {
      return dirs.map((d) => ({ root: path.join(dir, d), name: d, carry: [] }));
    }
    const wrap = dirs.length === 1 && files.every(isMetaName) && !GAME_ROOTS.test(dirs[0]) && !CONTENT_ROOTS.test(dirs[0]);
    if (!wrap || depth >= 2) break;
    if (depth === 1 && dirs[0].toLowerCase() !== path.basename(dir).toLowerCase()) break;
    // The inner folder's own files win over the same names from outside.
    carry = files.map((f) => path.join(dir, f)).concat(carry);
    dir = path.join(dir, dirs[0]);
    name = dirs[0];
    depth++;
  }
  return [{ root: dir, name, carry }];
}

// Copy a mod's files into a folder this call made. Links, junk and dotted
// names are left behind (walkFiles).
function copyFiles(list, dest) {
  for (const f of list) {
    const to = path.join(dest, ...f.rel.split('/'));
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(f.abs, to);
  }
}

// Writes into <mods>/<folder>, a folder this call makes: a copy that fails
// part way is removed, never left half there.
function writeMod(folder, fill) {
  const dest = path.join(modsDir(), folder);
  fs.mkdirSync(dest);   // not recursive: a folder that appeared meanwhile is an error, not a merge
  try {
    fill(dest);
  } catch (e) {
    try { rmTree(dest); } catch (e2) { /* the copy error is the one to report */ }
    throw e;
  }
}

// What extractZip would otherwise do to an archive holding one folder: lift
// its contents out, losing the folder's name and - for a mod whose only folder
// is external/ or data/ - its layout. A file of our own beside it keeps the
// archive as it is; findModRoots decides.
const KEEP = '.mugen-studio-keep';

// Install a mod from a folder, an archive (.zip, .rar, .7z) or one .lua file.
// opts: nameHint (the dropped name without its extension), source (the name
// as dropped - an upload arrives as a temp file). The source is only read.
// -> { folders: [the new folders], notes: [what to tell the person] }. New
// mods are on.
function installMod(srcPath, opts) {
  const o = opts || {};
  const src = path.resolve(String(srcPath || ''));
  const shown = path.basename(String(o.source || '')) || path.basename(src);
  let st;
  try { st = fs.statSync(src); } catch (e) { throw new Error('that path does not exist: ' + src); }
  fs.mkdirSync(modsDir(), { recursive: true });
  const folders = [], notes = [];
  const place = (wanted, fill) => {
    const base = safeName(wanted);
    const folder = freeFolder(base);
    if (folder !== base) notes.push('A mod in "' + base + '" is already installed, so this one went into "' + folder + '".');
    writeMod(folder, fill);
    folders.push(folder);
  };

  let tmp = null;
  try {
    if (st.isFile() && /\.lua$/i.test(src)) {
      // One Lua file: a folder named after it, holding it under its own name
      // - but without a dot before the extension, which would stop the
      // engine loading it (and nothing else can be naming a file that came
      // alone).
      const given = /\.lua$/i.test(shown) ? shown : path.basename(src);
      const stem = given.replace(/\.lua$/i, '');
      const fileName = stem.includes('.') ? stem.replace(/\./g, '-') + given.slice(stem.length) : given;
      place(o.nameHint || stem, (dest) => fs.copyFileSync(src, path.join(dest, fileName)));
      if (fileName !== given) notes.push(given + ' was saved as ' + fileName + ': a dot in its name would stop the engine loading it.');
    } else {
      let top;
      if (st.isDirectory()) {
        top = src;
      } else if (st.isFile() && /\.(zip|rar|7z)$/i.test(src)) {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mugen-mod-'));
        fs.writeFileSync(path.join(tmp, KEEP), '');
        require('./modlib.js').extractZip(src, tmp);
        rmFile(path.join(tmp, KEEP));
        top = tmp;
      } else {
        throw new Error(path.basename(src) + ' is not a mod: a mod is a folder, a .zip, .rar or .7z, or a .lua file');
      }
      const fallback = tmp ? (o.nameHint || shown.replace(/\.(zip|rar|7z)$/i, '')) : (o.nameHint || path.basename(src));
      const roots = findModRoots(top);
      // A whole game is not a mod: copied in as one, its every data file
      // would ship again on top of the engine's.
      for (const r of roots) {
        if (rootEntries(r.root).files.some((f) => /^(ikemen.*|mugen)\.exe$/i.test(f))) {
          throw new Error((r.name || shown) + ' is a whole game, not a mod: add it as a bundle instead'
            + ' (the bundles dialog, Import a MUGEN or Ikemen GO build)');
        }
      }
      for (const r of roots) {
        const list = walkFiles(r.root);
        if (!list.length) throw new Error((r.name || shown) + ' has no files to install');
        const info = readModinfo(r.root);
        place((info && info.name) || r.name || fallback, (dest) => {
          copyFiles(list, dest);
          const have = new Set(list.filter((f) => !f.rel.includes('/')).map((f) => f.rel.toLowerCase()));
          for (const c of r.carry) {
            const n = path.basename(c);
            if (have.has(n.toLowerCase())) continue;
            fs.copyFileSync(c, path.join(dest, n));
            have.add(n.toLowerCase());
          }
        });
      }
      if (roots.length > 1) notes.unshift(shown + ' held ' + roots.length + ' mods; each one was installed.');
    }
  } finally {
    if (tmp) { try { rmTree(tmp); } catch (e) { /* a temp folder */ } }
  }

  // New installs are on: a folder name an older mod left in the off list is
  // taken off it.
  try {
    const V = vfslib();
    const roster = V.readRoster();
    const off = modsOff(roster);
    for (const f of folders) off.user.delete(f);
    if (storeModsOff(roster, off)) V.writeRoster(roster);
  } catch (e) {
    notes.push('The mod is installed, but roster.json could not be read to switch it on: ' + e.message);
  }
  return { folders, notes };
}

// ---- for the routes ---------------------------------------------------------------

// The picture a card shows: a file inside one mod folder, a picture by its
// extension, never a path out of it (no '..', no drive, no stream, no link
// leading out). -> { abs, type } or null.
// A README's first words, for the card: its first prose paragraphs as plain
// text. Markdown and HTML marks go (a centered <div>, a logo <img>, **bold**,
// [links](...) keep their words), and so do headings, rules, tables, code
// blocks and a link alone on its line (a video). Cut at a sentence end near
// SUMMARY_CHARS, else at a word, never inside one.
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
function readmeSummary(text) {
  let t = String(text || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  t = t.replace(/<!--[\s\S]*?-->/g, '');
  t = t.replace(/^[ \t]*(```|~~~)[^\n]*\n[\s\S]*?^[ \t]*\1[^\n]*$/gm, '');
  const paras = [];
  for (const block of t.split(/\n[ \t]*\n/)) {
    const lines = [];
    for (const raw of block.split('\n')) {
      const s = raw.trim();
      if (!s) continue;
      if (/^#{1,6}(\s|$)/.test(s)) continue;                       // a heading
      if (/^([-*_=~])(\s*\1){2,}$/.test(s)) continue;              // a rule or an underline
      if (/^\|/.test(s)) continue;                                  // a table row
      lines.push(s.replace(/^>\s?/, '').replace(/^(?:[-*+]|\d+[.)])\s+/, ''));
    }
    let p = lines.join(' ');
    p = p.replace(/<img\b[^>]*>/gi, ' ').replace(/<br\s*\/?>/gi, ' ').replace(/<\/?[a-z][^>]*>/gi, ' ');
    p = p.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
    p = p.replace(/`([^`]*)`/g, '$1').replace(/(\*\*|__)(.+?)\1/g, '$2').replace(/~~(.+?)~~/g, '$1')
      .replace(/(^|[\s(])[*_]([^*_\s][^*_]*?)[*_](?=[\s).,;:!?]|$)/g, '$1$2');
    p = p.replace(/&(amp|lt|gt|quot|apos|nbsp|#39);/g, (m, k) => ENTITIES[k]).replace(/\s+/g, ' ').trim();
    if (!p || /^<?https?:\/\/\S+>?$/i.test(p) || !/[a-z]{3}/i.test(p)) continue;
    paras.push(p);
    if (paras.length >= 2 || paras.join(' ').length >= SUMMARY_CHARS) break;
  }
  let s = paras.join('\n\n');
  if (s.length > SUMMARY_CHARS) {
    const cut = s.slice(0, SUMMARY_CHARS);
    const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('.\n'), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
    s = end >= SUMMARY_CHARS * 0.4 ? cut.slice(0, end + 1) : cut.slice(0, cut.lastIndexOf(' ') > 0 ? cut.lastIndexOf(' ') : SUMMARY_CHARS).replace(/[\s,;:-]+$/, '') + '…';
  }
  return s;
}

// The Read me dialog: a mod's readme, whole (up to README_MAX). -> null, or
// { folder, name, file, markdown, text }. A folder NAME, resolved inside the
// bundle's mods folder; the file is the one the scan found, at its root.
function readmeFor(folder) {
  const name = canonicalFolder(folder);
  if (!name) return null;
  const root = path.join(modsDir(), name);
  let ents = [];
  try { ents = fs.readdirSync(root, { withFileTypes: true }); } catch (e) { return null; }
  const byLow = new Map(ents.filter((e) => e.isFile()).map((e) => [e.name.toLowerCase(), e.name]));
  for (const n of DESC_FILES) {
    const file = byLow.get(n);
    if (!file) continue;
    const text = readText(path.join(root, file), README_MAX);
    if (text === null) continue;
    let modName = name;
    try { modName = parseModinfo(readText(path.join(root, byLow.get('modinfo.ini') || 'modinfo.ini')) || '').name || name; } catch (e) { modName = name; }
    return { folder: name, name: modName, file, markdown: /\.md$/i.test(file), text: text.replace(/^\uFEFF/, '') };
  }
  return null;
}

function imageFor(folder, file) {
  const name = canonicalFolder(folder);
  if (!name) return null;
  const rel = String(file == null ? '' : file).replace(/\\/g, '/');
  const segs = rel.split('/');
  if (!rel || /[\0:]/.test(rel) || rel.startsWith('/') || segs.some((s) => !s || s === '.' || s === '..' || s.startsWith('.'))) return null;
  if (!IMAGE_EXT.test(rel)) return null;
  const root = path.resolve(path.join(modsDir(), name));
  const abs = path.resolve(root, ...segs);
  if (!abs.startsWith(root + path.sep)) return null;
  let real, realRoot;
  try { real = fs.realpathSync.native(abs); realRoot = fs.realpathSync.native(root); } catch (e) { return null; }
  if (!fold(real).startsWith(fold(realRoot) + path.sep)) return null;
  if (!isFile(real)) return null;
  return { abs: real, type: IMAGE_TYPES[path.extname(real).toLowerCase()] || 'application/octet-stream' };
}

// The folder Open folder shows: the bundle's mods folder (made when it is not
// there yet - it is where mods go), or one mod's. -> the path, or null.
function openTarget(folder) {
  if (folder === undefined || folder === null || folder === '') {
    const d = modsDir();
    fs.mkdirSync(d, { recursive: true });
    return d;
  }
  const name = canonicalFolder(folder);
  return name ? path.join(modsDir(), name) : null;
}

module.exports = {
  STUDIO_MODS_DIR, VPATHS, LEGACY_VPATHS, BUILTINS, FRAMEBAR_SOURCE,
  modsOff, builtinOn, userOn, storeModsOff,
  listMods, userModFiles, installMod, setModOn, removeMod,
  imageFor, openTarget, generatedVpaths, readmeFor, readmeSummary,
  // for tests and the routes
  safeName, parseModinfo, scanMod, canonicalFolder, modsDir, presentFor,
};
