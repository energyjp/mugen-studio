// A SCREENPACK'S PER-MEMBER SELECT FACES, in the keys Ikemen GO 1.0 reads.
//
// Infinite Legacy X (written for the January 2025 nightly) draws each team
// member's stance at the bottom of its side with per-member keys:
//   p1.face.num = 4
//   p1.member1.face.anim = 0          p1.member1.face.done.anim = 181
//   p1.member1.face.scale = 0.6,0.6   p1.member1.face.offset = 240,700
//   p1.member2.face.offset = 100,700  ...
// and never sets p1.face itself. 1.0 has no pN.memberN.face keys at all
// (motif.go reads pN.face, pN.face.num and pN.face.spacing), so it draws its
// built-in face for every member: 9000,1 at 0,0 in 320x240 space - on a
// 1280x720 pack a huge portrait per member, stacked at the top left. P2's
// default faces left from x = 0 and lands off screen, so only P1 showed it.
//
// The build's copy of system.def gets, under [Select Info], the engine's own
// keys carrying member 1's values: face.anim / face.done.anim / face.spr /
// face.scale / face.facing / face.offset, face.spacing from member 1 to member
// 2 (the engine spaces members evenly; a pack that staggers them is drawn
// evenly spaced), and face.localcoord = the pack's own [Info] localcoord, the
// space those offsets were written in. Only for a side whose pack writes
// memberN.face keys and sets no pN.face position or picture of its own; the
// pack's files are untouched (vfslib writes the generated motif, which both
// exports ship).
'use strict';

const strip = (l) => String(l).split(';')[0];

function sectionOf(lines, name) {
  const s = lines.findIndex((l) => strip(l).trim().toLowerCase() === '[' + name + ']');
  if (s < 0) return null;
  let e = lines.findIndex((l, i) => i > s && /^\s*\[/.test(strip(l)));
  if (e < 0) e = lines.length;
  return { s, e };
}

function keysIn(lines, sec) {
  const m = new Map();
  for (let i = sec.s + 1; i < sec.e; i++) {
    const t = strip(lines[i]);
    const eq = t.indexOf('=');
    if (eq < 0) continue;
    const k = t.slice(0, eq).trim().toLowerCase();
    if (k && !m.has(k)) m.set(k, { v: t.slice(eq + 1).trim(), line: i });
  }
  return m;
}

const nums = (v) => String(v || '').split(',').map((x) => parseFloat(x)).filter((x) => Number.isFinite(x));

// The lines to add for one side, or [] when the side needs none.
function sideLines(k, p, localcoord) {
  if (!k.has(p + '.member1.face.anim') && !k.has(p + '.member1.face.spr')) return [];
  // The pack places or pictures the face itself: nothing to translate.
  for (const own of ['face.offset', 'face.anim', 'face.spr']) if (k.has(p + '.' + own)) return [];
  const m1 = (key) => k.get(p + '.member1.face.' + key);
  const out = [];
  for (const key of ['anim', 'done.anim', 'spr', 'done.spr', 'scale', 'facing', 'offset']) {
    const v = m1(key);
    if (v && v.v !== '') out.push(p + '.face.' + key + ' = ' + v.v);
  }
  const o1 = nums(m1('offset') && m1('offset').v), o2 = nums(k.get(p + '.member2.face.offset') && k.get(p + '.member2.face.offset').v);
  if (o1.length >= 2 && o2.length >= 2 && !k.has(p + '.face.spacing')) out.push(p + '.face.spacing = ' + (o2[0] - o1[0]) + ', ' + (o2[1] - o1[1]));
  if (localcoord && !k.has(p + '.face.localcoord')) out.push(p + '.face.localcoord = ' + localcoord);
  return out;
}

// Does this system.def need the translation? (cheap: a text test first)
function needsMemberFaces(defText) {
  if (!/^\s*p[12]\.member1\.face\./mi.test(String(defText))) return false;
  return memberFaces(defText) !== String(defText);
}

function memberFaces(defText) {
  const t = String(defText);
  const nl = /\r\n/.test(t) ? '\r\n' : '\n';
  const lines = t.split(/\r?\n/);
  const sel = sectionOf(lines, 'select info');
  if (!sel) return t;
  const k = keysIn(lines, sel);
  const info = sectionOf(lines, 'info');
  const lc = info ? keysIn(lines, info).get('localcoord') : null;
  const localcoord = lc && nums(lc.v).length >= 2 ? nums(lc.v).slice(0, 2).join(',') : null;
  const add = [...sideLines(k, 'p1', localcoord), ...sideLines(k, 'p2', localcoord)];
  if (!add.length) return t;
  // At the end of [Select Info], before its trailing blank lines.
  let at = sel.e;
  while (at > sel.s + 1 && !lines[at - 1].trim()) at--;
  lines.splice(at, 0, '; Mugen Studio: this pack\'s per-member faces (pN.memberN.face) in the keys the engine reads',
    ...add);
  return lines.join(nl);
}

// THE MENU A LOBBY OPENS ONCE BOTH PLAYERS CONNECT. After a manual lobby
// synchronizes, main.lua opens main.menu.submenu.server (enterSyncedNetplayMenu)
// - a hidden title-menu group the engine's own screenpack names under
// menu.itemname.server.* (VERSUS 2P, ARCADE CO-OP, SURVIVAL CO-OP, EXIT).
// Without it the first lobby to connect stops the game ("main.lua:1859:
// attempt to index a non-table object(nil) with key 'loop'"). A MUGEN-era pack
// has no such group, and its lobbies are opened from the online menu add-on
// (netmenu.js: PRESS N FOR ONLINE on every title), so the build's copy of any
// pack whose [Title Info] lacks the group gets the engine screenpack's: after
// the pack's network block when it has one, else after its last title menu
// item, else at the end of [Title Info]. A server_* item never shows on the
// title (main.lua lists top-level items only), and the engine appends its own
// default items after a pack's either way (script.go merges them leaf by leaf).
// The add-on adds the same group at runtime to a motif the build did not
// reach (an attract-mode group, a pack with no [Title Info]).
const SERVER_GROUP_LINES = [
  '; Mugen Studio: the menu the engine opens once both players of a lobby connect (hidden)',
  'menu.itemname.server.netplayversus = VERSUS 2P',
  'menu.itemname.server.netplayteamcoop = ARCADE CO-OP',
  'menu.itemname.server.netplaysurvivalcoop = SURVIVAL CO-OP',
  'menu.itemname.server.back = EXIT',
];

function serverGroup(defText) {
  const t = String(defText);
  const nl = /\r\n/.test(t) ? '\r\n' : '\n';
  const lines = t.split(/\r?\n/);
  const sec = sectionOf(lines, 'title info');
  if (!sec) return t;
  let lastNet = -1, lastItem = -1, hasServer = false;
  for (let i = sec.s + 1; i < sec.e; i++) {
    const s = strip(lines[i]).trim().toLowerCase();
    if (/^menu\.itemname\.server\./.test(s)) hasServer = true;
    if (/^menu\.itemname\./.test(s)) lastItem = i;
    if (/^menu\.itemname\.[\w.]*\.server(host|join)\b/.test(s) || /^menu\.itemname\.server(host|join)\b/.test(s)) lastNet = i;
  }
  if (hasServer) return t;
  let at;
  if (lastNet >= 0) {
    // after the network block's last line (its sub-items included)
    at = lastNet + 1;
    while (at < sec.e && /^\s*menu\.itemname\.[\w.]*server(host|join)/i.test(strip(lines[at]))) at++;
    while (at < sec.e && /^\s*menu\.itemname\.menunetwork\./i.test(strip(lines[at]))) at++;
  } else if (lastItem >= 0) {
    at = lastItem + 1;
  } else {
    // no menu lines: at the end of [Title Info], before its trailing blank lines
    at = sec.e;
    while (at > sec.s + 1 && !lines[at - 1].trim()) at--;
  }
  lines.splice(at, 0, ...SERVER_GROUP_LINES);
  return lines.join(nl);
}

const needsServerGroup = (defText) => serverGroup(defText) !== String(defText);

// THE NETWORK ENTRY THE INSTALLER USED TO GRAFT. Installing a MUGEN-era pack
// used to add NETWORK / HOST GAME / JOIN GAME / BACK after its last title menu
// item, under this comment. On a pack whose title menu is art, shows one item
// at a time or blanks its item text, that entry was invisible or unreachable;
// the online menu add-on (netmenu.js) replaced it, and the installer adds
// nothing now. A pack installed before still carries the lines, so they are
// dropped from the build's copy and from any system.def the Studio rewrites
// (modlib.patchInstalledMotif): the comment line and the menunetwork lines
// right after it, every other byte as it was. A pack's own network menu has no
// such comment and is never touched; the server group a later graft carried
// after those lines stays (serverGroup, above).
const GRAFT_MARKER = ';(added on install) Ikemen online play - MUGEN packs predate netplay';
const GRAFT_LINE = /^[ \t]*menu\.itemname\.menunetwork(\.[\w.]+)?[ \t]*=/i;

const hasNetworkGraft = (defText) => String(defText).split(/\r?\n/).some((l) => l.trim() === GRAFT_MARKER);

function dropNetworkGraft(defText) {
  const t = String(defText);
  if (!hasNetworkGraft(t)) return t;
  // Each line keeps its own terminator, so the rest is byte-exact (CRLF or LF).
  const parts = t.split(/(?<=\n)/);
  const out = [];
  for (let i = 0; i < parts.length; i++) {
    if (parts[i].trim() !== GRAFT_MARKER) { out.push(parts[i]); continue; }
    while (i + 1 < parts.length && GRAFT_LINE.test(parts[i + 1])) i++;
  }
  return out.join('');
}

// THE PAUSE MENU'S CLIP WINDOW ON THE MODERN-INPUT ENGINE. The engine clips a
// menu's item text to a window from menu.pos minus menu.window.margins.y[1] to
// the last visible item plus [2] (main.lua f_menuWindow). Ikemen GO 1.0's
// default [Pause Menu] margins were 0, 0 (no clip: the whole screen); upstream
// develop made them 10, 4, written for its own 320x240 default motif, where
// 10 is more than a line of its 9-pixel menu font. A pack with a larger
// localcoord that never set the key (release-v2's ikemen1 only has it
// commented out, `;menu.window.margins.y = 0, 0`) inherits 10 of ITS units:
// on a 1280x720 pack the window starts 10 px above the first item's baseline
// and its 27-pixel TrueType text, so the first item ("Continue") is cut at the
// top. The build's copy of such a pack gets the value it was written against,
// 0, 0, at the top of [Pause Menu] (the training pause menu inherits it). A
// pack that sets the key, has no [Pause Menu], or uses 240 lines or fewer is
// left alone. Only for builds of the modern-input engine (vfslib, V2).
const PAUSE_MARGINS_LINES = [
  '; Mugen Studio: 1.0\'s pause menu clip window (no margins); the engine\'s new default 10, 4 is in 320x240 units and cut this pack\'s first item',
  'menu.window.margins.y = 0, 0',
];

function pauseMargins(defText) {
  const t = String(defText);
  const nl = /\r\n/.test(t) ? '\r\n' : '\n';
  const lines = t.split(/\r?\n/);
  const info = sectionOf(lines, 'info');
  const lc = info ? nums(keysIn(lines, info).get('localcoord') && keysIn(lines, info).get('localcoord').v) : [];
  if (!(lc.length >= 2 && lc[1] > 240)) return t;
  const sec = sectionOf(lines, 'pause menu');
  if (!sec || keysIn(lines, sec).has('menu.window.margins.y')) return t;
  lines.splice(sec.s + 1, 0, ...PAUSE_MARGINS_LINES);
  return lines.join(nl);
}

const needsPauseMargins = (defText) => pauseMargins(defText) !== String(defText);

// THE SIDE SELECT SCREEN ON THE MODERN-INPUT ENGINE. Before a mode's character
// select, upstream's start.f_sideSelect lets every player pick a device and a
// side (Team 1, Team 2) - but only when the motif sets [Side Select Info]
// enabled = 1. The engine's own default is 0, with every position 0 and no
// font (defaultMotif.ini), so a pack that says nothing goes straight to
// character select (start.lua's inputAutoAssign path). Upstream's own
// screenpack (Ikemen_GO-Elecbyte-Screenpack, branch modern-input,
// data/ikemen1/system.def) turns it on with a 1280x720 layout; no MUGEN-era
// pack and none of the packs a Studio bundle installs has the section.
//
// The build's copy of a pack without its own [Side Select Info] gets that
// layout (Decision 34 of the modern-input plan): upstream's positions, sizes,
// texts and actions, every element carrying `localcoord = 1280, 720` so the
// same numbers place it on any pack (the engine maps an element's localcoord
// into the pack's: on a 320x240 or 640x480 pack the columns land inside its
// 4:3 area, on a 16:9 web canvas the hint spans the screen). The fonts are the
// real Open_Sans TrueType every V2 web build ships (Decision 26), as two new
// [Files] slots after the pack's highest font number (never one of its own):
// one for the titles and the hint, one at upstream's row size whose inline
// glyphs (the <controllericon> device picture) are drawn about 60 px tall as
// upstream's ConfigSetup font draws them. One change from upstream:
// exit.action is BACK and the Esc key (the engine default's), so the hint
// shows a key for keyboard players. A pack that declares ikemen1's own
// Menu1/Menu2 fonts (the stock ikemen1 pack) keeps upstream's title fonts, and
// the stock ikemen1 pack (name IKEMEN1, its system.sff carries them) keeps
// upstream's row arrows (402,0 and 403,0); another pack's sprites under those
// numbers could be anything, so it gets no arrows (left/right, a click on a
// column and the hint still move a device).
//
// A pack with its own [Side Select Info] is left alone (enabled = 0 there is
// its author's choice). Only for the modern-input engine's web builds and the
// Desktop export (vfslib, V2, opts.web or opts.desktop) and only while the
// bundle's Theme tab option is on (roster.sideSelect !== false). Every key it
// writes is one upstream's official engine (the desktop's) has in its own
// defaults, and the Open_Sans it names ships in that engine's zip
// (test-side-select, d). Pure: text in, text out, line endings kept.
const SIDE_SELECT_MARK = '; Mugen Studio: the side select screen (upstream modern-input screenpack layout, 1280x720 units), added to the build\'s copy';
const SIDE_SELECT_FONTS_MARK = '; Mugen Studio: fonts for the side select screen (Open_Sans TrueType)';
const sideSelectSection = (lines) => lines.findIndex((l) => strip(l).trim().toLowerCase().replace(/[\s_]+/g, '') === '[sideselectinfo]');

function sideSelect(defText) {
  const t = String(defText);
  const nl = /\r\n/.test(t) ? '\r\n' : '\n';
  const lines = t.split(/\r?\n/);
  if (sideSelectSection(lines) >= 0) return t;
  const info = sectionOf(lines, 'info');
  const ik = info ? keysIn(lines, info) : new Map();
  const name = ik.has('name') ? ik.get('name').v.replace(/^"|"$/g, '').trim().toLowerCase() : '';
  const lc = ik.has('localcoord') ? nums(ik.get('localcoord').v) : [];
  const stockIkemen1 = name === 'ikemen1' && lc[0] === 1280 && lc[1] === 720;
  // The pack's fonts: the highest slot (the engine's defaults are font0 and
  // font1) and ikemen1's own Menu1/Menu2 when it declares them.
  const files = sectionOf(lines, 'files');
  let top = 1, menu1 = -1, menu2 = -1;
  if (files) {
    for (const [k, v] of keysIn(lines, files)) {
      const m = /^font(\d+)$/.exec(k);
      if (!m) continue;
      const n = parseInt(m[1], 10);
      if (n > top) top = n;
      const f = v.v.replace(/^"|"$/g, '').trim().replace(/\\/g, '/').toLowerCase();
      if (/(^|\/)menu1\.def$/.test(f)) menu1 = n;
      if (/(^|\/)menu2\.def$/.test(f)) menu2 = n;
    }
  }
  const A = top + 1, R = top + 2;
  // THE ROWS' TEXT beside a pack's own box (any pack but the stock ikemen1, see
  // the columns below). A TrueType font drawn at a scale is drawn from glyphs
  // made at another size: at 0.75 of upstream's 18 the names lost pixel rows
  // and columns ("Controller" read "Ccntroller", "(" read ";"). The rows' font
  // is made at their own height instead (fontN.height 16, drawn at 1.0, so
  // its glyphs are made at the size they are drawn at 1280x720), the setup on
  // a line of its own under the name, so the widest line ("DualSense Wireless
  // Controller", 219 px) still fits three columns in such a box. The device
  // picture 42 px (the glyph scale is the picture's height over the text's),
  // raised 4 px off the name. The stock ikemen1 keeps upstream's rows.
  const rowHeight = stockIkemen1 ? 18 : 16;
  const glyphScale = String(Math.round((stockIkemen1 ? 59.4 : 42) / rowHeight * 1000) / 1000);
  const fontLines = [
    SIDE_SELECT_FONTS_MARK,
    `font${A} = font/Open_Sans.def`,
    `font${A}.glyphs.offset = 0, 0`, `font${A}.glyphs.scale = 1.0, 1.0`, `font${A}.glyphs.spacing = 3`,
    `font${R} = font/Open_Sans.def`, `font${R}.height = ${rowHeight}`,
    `font${R}.glyphs.offset = 0, ${stockIkemen1 ? 0 : -4}`, `font${R}.glyphs.scale = ${glyphScale}, ${glyphScale}`, `font${R}.glyphs.spacing = 3`,
  ];
  const LC = '1280, 720';
  const titleFont = menu1 >= 0 ? `${menu1}, 0, 0` : `${A}, 0, 0`;
  const titleScale = menu1 >= 0 ? '1.0, 1.0' : '1.5, 1.5';
  const colFont = menu2 >= 0 ? `${menu2}, 0, 0` : `${A}, 0, 0`;
  const colScale = menu2 >= 0 ? '0.66, 0.66' : '0.9, 0.9';
  const el = (key, props) => [...props.map(([k, v]) => `${key}.${k} = ${v}`), `${key}.localcoord = ${LC}`];
  const row = (key, x, font, text, extra) => el(key, [['font', font], ['offset', `${x}, 0`], ['scale', '1.0, 1.0'], ['text', text], ...(extra || [])]);
  // The device name too (upstream's own rows show only the picture and the
  // setup), so two keyboards, or two pads of one model, can be told apart.
  // (Other packs: the setup on a line of its own, see the rows' text above.)
  const icon = stockIkemen1 ? '<controllericon>\\n%name (%setup)' : '<controllericon>\\n%name\\n(%setup)';
  const ready = stockIkemen1 ? '<controllericon>\\n%name: READY!' : '<controllericon>\\n%name\\nREADY!';
  // THE TITLE UNDER THE PACK'S HEADER. The screen is drawn over the pack's
  // options background, and a MUGEN-era pack draws its own header there
  // (Capcom vs. SNK 2: "OPTION MODE" on a blue bar, y 85-128 in these units at
  // 1280x720, a dark box below it), right where upstream's title sits (y 74,
  // its letters y 69-95). Any pack but the stock ikemen1 gets the title in the
  // box under such a header and the rest moved down to fit above the hint
  // (its letters from y 644): title 152 (letters 144-171), column titles 190
  // (192-207), rows from 248 (a row's picture, name and setup: 25 above to 51
  // below its offset, measured with a keyboard's picture) 83 apart, so the
  // fifth row ends at y 631. The columns: each is a list of its own from the
  // top, so a name in the middle column and one in a team column can share a
  // row's height, and every name is centered on its column. At upstream's
  // 316 / 640 / 964 and full size a team column's name ("Keyboard Controller
  // 1 (Standard)", 266 px) ran 25-28 px out of such a pack's box (Capcom vs.
  // SNK 2: x 224-1058), and moving the columns in alone ran it into the middle
  // column's. With the team columns 274 from the middle, 366 / 914, and the
  // widest line 219 px, the three columns' names keep at least 50 px apart
  // and inside x 256-1024. The stock ikemen1 keeps upstream's numbers.
  const L = stockIkemen1
    ? { title: 74, cols: 140, item: 222, spacing: 95, p1: 316, p2: 964 }
    : { title: 152, cols: 190, item: 248, spacing: 83, p1: 366, p2: 914 };
  const sec = [
    '', SIDE_SELECT_MARK,
    '[Side Select Info]',
    'enabled = 1',
    'done.action = A, MOUSE:LEFT',
    'cancel.action = B, MOUSE:RIGHT',
    // upstream's BACK, plus the engine default's Esc key so the hint names a
    // key for keyboard players too (Esc leaves the screen either way)
    'exit.action = BACK, KEY:ESCAPE',
    'window.visibleitems = 5',
    ...el('title', [['font', titleFont], ['offset', `640, ${L.title}`], ['scale', titleScale]]),
    ...el('title.unassigned', [['font', colFont], ['offset', `640, ${L.cols}`], ['scale', colScale], ['text', '']]),
    ...el('title.p1', [['font', colFont], ['offset', `${L.p1}, ${L.cols}`], ['scale', colScale], ['text', 'Team 1']]),
    ...el('title.p2', [['font', colFont], ['offset', `${L.p2}, ${L.cols}`], ['scale', colScale], ['text', 'Team 2']]),
    `item.offset = 0, ${L.item}`,
    `item.spacing = 0, ${L.spacing}`,
    // A device no one is using yet: upstream draws it added at 64 of 256, which
    // on a pack's own light or busy background all but vanishes (mugen1: 1.7:1).
    // Other packs draw it in the team columns' inactive grey instead.
    ...(stockIkemen1
      ? row('item.unassigned', 640, `${R}, 0, 0`, icon, [['trans', 'add'], ['alpha', '64, 192']])
      : row('item.unassigned', 640, `${R}, 0, 0, 191, 191, 191`, icon)),
    ...row('item.unassigned.active', 640, `${R}, 0, 0`, icon, [['trans', 'default'], ['alpha', '']]),
  ];
  for (const [p, x] of [['p1', L.p1], ['p2', L.p2]]) {
    sec.push(
      ...row(`item.${p}`, x, `${R}, 0, 0, 191, 191, 191`, ''),
      ...row(`item.${p}.active`, x, `${R}, 0, 0, 255, 255, 255`, icon),
      ...row(`item.${p}.done`, x, `${R}, 0, 0, 191, 191, 191`, ready),
      ...row(`item.${p}.done.active`, x, `${R}, 0, 0, 255, 255, 255`, ready));
  }
  if (stockIkemen1) {
    for (const [key, spr, x] of [['item.unassigned.arrow.left', '403, 0', 576], ['item.unassigned.arrow.right', '402, 0', 692],
      ['item.p1.arrow.right', '402, 0', 368], ['item.p2.arrow.left', '403, 0', 900]]) {
      sec.push(...el(key, [['spr', spr], ['offset', `${x}, -34`], ['scale', '1.0, 1.0']]));
    }
  }
  sec.push(...el('hint', [['font', `${A}, 0, 0`], ['offset', '640, 663'], ['scale', '1.0, 1.0']]), '');
  // The fonts at the end of [Files] (before its trailing blank lines), or a
  // [Files] of their own at the end when the pack has none.
  if (files) {
    let at = files.e;
    while (at > files.s + 1 && !lines[at - 1].trim()) at--;
    lines.splice(at, 0, ...fontLines);
  } else {
    sec.unshift('', '[Files]', ...fontLines);
  }
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  return [...lines, ...sec].join(nl);
}

const needsSideSelect = (defText) => sideSelectSection(String(defText).split(/\r?\n/)) < 0;

// THE REMATCH MENU ON THE MODERN-INPUT ENGINE. After a versus match the
// losing human picks Rematch, Character Select, Order Select, Stage Select or
// Exit. Up to the 2026-11-17 pre-release (07c692fb) that menu lived in
// [Victory Screen] (rematch.*) and was on by default (rematch.enabled = 1);
// upstream then moved it to its own [Rematch Info] screen and made the
// engine's default enabled = 0, with only its own screenpack
// (data/ikemen1/system.def of the official zip) turning it on. No MUGEN-era
// pack, and not the older ikemen1 copy web builds ship, has the section, so
// every web build would have lost the menu its 2.5 test builds had (and the
// room netplay flow with it).
//
// The build's copy of a pack without [Rematch Info] gets `enabled = 1`, the
// rest from the engine's defaults (portraits from [Victory Screen], styling
// from [Pause Menu]), as upstream's own pack does. A pack with the section
// keeps its own choice, and so does a pack whose [Victory Screen] says
// `rematch.enabled = 0` (the old key, read as the author's word). The menu
// only opens where the mode asks for versus results (main.versusResults:
// VS 2P, team and co-op versus, netplay rooms); lobby, casual and ranked
// matches turn it off (vfslib, queuemode.js). Only for the modern-input
// engine's web builds (vfslib, V2, opts.web): the desktop export ships
// upstream's official build as it is. Pure: text in, text out, line endings
// kept.
const REMATCH_MARK = '; Mugen Studio: the rematch menu after a versus match, on as the engine had it before 2026-11-17 (its own default is now 0)';
function rematchInfo(defText) {
  const t = String(defText);
  const nl = /\r\n/.test(t) ? '\r\n' : '\n';
  const lines = t.split(/\r?\n/);
  if (lines.some((l) => strip(l).trim().toLowerCase().replace(/[\s_]+/g, '') === '[rematchinfo]')) return t;
  const vs = sectionOf(lines, 'victory screen');
  const old = vs ? keysIn(lines, vs).get('rematch.enabled') : null;
  if (old && parseFloat(old.v) === 0) return t;
  const end = lines.length && lines[lines.length - 1] === '' ? lines.length - 1 : lines.length;
  lines.splice(end, 0, '', '[Rematch Info]', REMATCH_MARK, 'enabled = 1');
  return lines.join(nl);
}
const needsRematchInfo = (defText) => rematchInfo(defText) !== String(defText);

// THE COMMAND LIST'S SCROLL ARROWS AND WIDTH ON THE MODERN-INPUT ENGINE. The
// new pause menu draws the Command List as menu rows (movelist.menu.*), and the
// engine's defaults for it are written for upstream's own ikemen1 pack:
//  - `movelist.menu.arrow.up.spr = 400, 0` and `.down.spr = 401, 0`
//    (defaultMotif.ini), ikemen1's 23x13 arrows. They are looked up in the
//    pack's own system.sff, where 400,0 can be anything: on Capcom vs. SNK 2
//    it is a piece of select screen art (orange, a white triangle), drawn at
//    the bottom right as soon as a long list scrolls. 1.0 and 2.4 drew no
//    arrows by default (`movelist.arrow.*.spr = -1, 0`).
//  - `movelist.menu.window.width = 290`, in 320x240 units (the list ends 15
//    px from the right edge there, as `movelist.menu.pos` 15 starts it), but
//    taken as the pack's own units: on a 640x480 pack the list and the rows'
//    box art stop at the middle of the screen.
// The build's copy of a pack other than the stock ikemen1 gets, at the top of
// [Pause Menu] (the training pause menu and the rematch list inherit it), no
// arrows when it sets neither the movelist's nor the pause menu's own arrow
// (`menu.arrow.*` would be inherited: the pack's art), and a width that ends
// the list as far from the right edge as it starts from the left
// (localcoord width - 2 x the list's x), the default's own proportion, or to
// the screen's right edge (localcoord width - the list's x) when its pause
// rows have art of their own (menu.item.bg / menu.item.active.bg), when it
// sets no width (`movelist.menu.window.width`, `menu.window.width`, or 1.0's
// `movelist.window.width`, which Phase 7 maps). A 320-wide pack whose list
// starts at 15 gets 290, the default: no line. A pack without [Pause Menu]
// gets one with these lines.
//
// THE ROWS' SIZE. The list's rows and title inherit the pause menu's font
// (`menu.item.font` -> `movelist.menu.item.font`, `title.font` ->
// `movelist.title.font`; motif.go copies a key the pack sets, one key at a
// time), but a pack that never wrote a scale (MUGEN-era packs: the pause
// menu's own default is 1.0) leaves the list on the engine's default
// `movelist.*.scale = 0.3333`, a size meant for the default Open_Sans in
// 320x240 units. So the pack's own pause font was drawn at a third of its
// size: on Capcom vs. SNK 2 (namefnt.fnt, 16 px cells in 640x480) the names,
// the input glyphs (sized from the font's height) and the DotGothic16
// fallback were about 7 px tall at 1280x720, and the pause menu's row
// highlight art, placed for full-size rows, sat above the small text. Such a
// pack gets, for each list element whose font it inherits and whose size it
// does not set (title, rows, active, selected and selected active rows), the
// size of the pause menu element it inherits from (its own `.scale`, else
// the pause menu default 1.0): the list's rows look like the pack's pause
// rows, and its row art sits behind them as it does there. A [Training Pause
// Menu] that sets fonts of its own gets its lines too.
//
// Only for builds of the modern-input engine (vfslib, V2). Pure: text in,
// text out, line endings kept.
const MOVELIST_MARK = '; Mugen Studio: the Command List\'s scroll arrows, width and row size on the modern-input engine (its defaults are ikemen1\'s sprites and 320x240 units)';
// list element -> the pause menu keys it inherits its font and scale from, nearest first
const MOVELIST_SIZE_SOURCES = [
  ['title', ['title']],
  ['menu.item', ['menu.item']],
  ['menu.item.active', ['menu.item.active']],
  ['menu.item.selected', ['menu.item.selected', 'menu.item']],
  ['menu.item.selected.active', ['menu.item.selected.active', 'menu.item.active']],
];
// The scale lines for one pause menu section's keys `k` (`fallback`: the keys
// a section inherits the rest from, [Pause Menu] for [Training Pause Menu]).
function movelistSizeLines(k, fallback) {
  const out = [];
  const get = (key) => (k.has(key) ? k.get(key) : (fallback && fallback.has(key) ? fallback.get(key) : null));
  for (const [el, srcs] of MOVELIST_SIZE_SOURCES) {
    if (k.has(`movelist.${el}.font`) || k.has(`movelist.${el}.scale`)) continue;
    if (fallback && (fallback.has(`movelist.${el}.font`) || fallback.has(`movelist.${el}.scale`))) continue;
    // only an inherited font: a pack that sets none keeps the default font at the default size
    if (!srcs.some((s) => k.has(s + '.font'))) continue;
    const sc = srcs.map((s) => get(s + '.scale')).find((v) => v && nums(v.v).length);
    const v = sc ? nums(sc.v) : [1, 1];
    const sx = v[0], sy = v.length > 1 ? v[1] : v[0];
    out.push(`movelist.${el}.scale = ${Number.isInteger(sx) ? sx.toFixed(1) : sx}, ${Number.isInteger(sy) ? sy.toFixed(1) : sy}`);
  }
  return out;
}
function pauseMovelist(defText) {
  const t = String(defText);
  const nl = /\r\n/.test(t) ? '\r\n' : '\n';
  const lines = t.split(/\r?\n/);
  const info = sectionOf(lines, 'info');
  const ik = info ? keysIn(lines, info) : new Map();
  const name = ik.has('name') ? ik.get('name').v.replace(/^"|"$/g, '').trim().toLowerCase() : '';
  const lc = ik.has('localcoord') ? nums(ik.get('localcoord').v) : [];
  if (name === 'ikemen1' && lc[0] === 1280 && lc[1] === 720) return t;
  const sec = sectionOf(lines, 'pause menu');
  const k = sec ? keysIn(lines, sec) : new Map();
  // [Training Pause Menu] first (it is below [Pause Menu]: its line numbers stay valid)
  const tsec = sectionOf(lines, 'training pause menu');
  let trainingDone = false;
  if (tsec && sec) {
    const tadd = movelistSizeLines(keysIn(lines, tsec), k);
    if (tadd.length && tsec.s > sec.s) { lines.splice(tsec.s + 1, 0, MOVELIST_MARK, ...tadd); trainingDone = true; }
  }
  const add = [];
  for (const dir of ['up', 'down']) {
    const own = ['movelist.menu.arrow.', 'menu.arrow.'].some((p) => k.has(p + dir + '.spr') || k.has(p + dir + '.anim'));
    if (!own) add.push(`movelist.menu.arrow.${dir}.spr = -1, 0`);
  }
  const pos = nums((k.get('movelist.menu.pos') || k.get('menu.pos') || { v: '15' }).v);
  // A pack that draws its pause rows' frame with art (menu.item.bg, Capcom vs.
  // SNK 2: strips with the frame's sides, wider than the rows' text; the engine
  // gives the list's first and last rows the art of the pause menu's first and
  // last items, menu.lua f_movelistEdgeBg).
  const rowArt = [...k.keys()].some((key) => /^menu\.item\.(active\.)?bg\.(.+\.)?(spr|anim)$/.test(key));
  if (!['movelist.menu.window.width', 'menu.window.width', 'movelist.window.width'].some((x) => k.has(x))) {
    const W = lc[0] > 0 ? lc[0] : 320;
    const x = pos.length ? pos[0] : 15;
    // Row art: the pause menu's own clip, the right edge of the screen, so the
    // art's right side shows too; any other pack the default's proportion.
    const width = Math.round(rowArt ? W - x : W - 2 * x);
    if (width > 0 && width !== 290) add.push(`movelist.menu.window.width = ${width}`);
  }
  // Row art: no more rows than end above the bottom 15% of the screen (the
  // last row plus half a row for the frame below it), where a fight's bottom
  // gauges are. The default's 13 rows of 20 from y 176 put Capcom vs. SNK 2's
  // frame on its lifebar's GROOVE labels (y 427 of 480); 12 end at 406.
  const sp = nums((k.get('movelist.menu.item.spacing') || k.get('menu.item.spacing') || { v: '' }).v);
  if (rowArt && pos.length > 1 && sp.length > 1 && sp[1] > 0) {
    const H = lc[1] > 0 ? lc[1] : 240;
    const ownRows = ['movelist.menu.window.visibleitems', 'menu.window.visibleitems'].find((x) => k.has(x));
    let rows = ownRows ? (nums(k.get(ownRows).v)[0] || 13) : 13;
    if (!ownRows) {
      const n = Math.floor((0.85 * H - pos[1] - sp[1] / 2) / sp[1]) + 1;
      if (n >= 3 && n < 13) { add.push(`movelist.menu.window.visibleitems = ${n}`); rows = n; }
    }
    // The hints. Such a pack's own pause menu draws no item description (its
    // menu.hint.font is the default -1), but the list kept the engine's
    // description line and key line (Open_Sans, both at y 221 and 231 of 240),
    // drawn over the fight's bottom gauges. The description goes (font -1, as
    // the pause menu's) unless the pack sets a pause hint font; the key line
    // moves up under the list's frame (1.4 rows below the last row), in the
    // element's own 320x240 units so its size is kept.
    if (!['menu.hint.font', 'movelist.menu.hint.font'].some((x) => k.has(x))) add.push('movelist.menu.hint.font = -1, 0, 0');
    if (!k.has('movelist.hint.offset') && !k.has('movelist.hint.localcoord') && lc[0] > 0 && lc[1] > 0 && Math.abs(lc[0] * 3 - lc[1] * 4) < 1) {
      const y = (pos[1] + (rows - 1) * sp[1] + 1.4 * sp[1]) * 240 / H;
      // with its localcoord: a key the pack sets is read in the pack's own units otherwise
      add.push(`movelist.hint.offset = 160, ${Math.round(y)}`, 'movelist.hint.localcoord = 320, 240');
    }
  }
  add.push(...movelistSizeLines(k, null));
  if (!add.length) return trainingDone ? lines.join(nl) : t;
  if (sec) {
    lines.splice(sec.s + 1, 0, MOVELIST_MARK, ...add);
    return lines.join(nl);
  }
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  return [...lines, '', '[Pause Menu]', MOVELIST_MARK, ...add, ''].join(nl);
}
const needsPauseMovelist = (defText) => pauseMovelist(defText) !== String(defText);

// A SCREENPACK'S OWN MENU KEYS ON THE MODERN-INPUT ENGINE. Ikemen GO 1.0 (and
// WebMUGEN 2.4) read a screen's keys from `.key` lines (engine buttons and
// directions: `menu.done.key = a, b, c, x, y, z, s`) and `.keycode` lines (a
// keyboard key: `menu.item.delete.keycode = DELETE`). The modern-input engine
// reads `.action` lines instead (`menu.done.action = A, B, X, Y, RB, RT,
// MOUSE:LEFT`) and skips a `.key` line with a warning, so a pack's own keys
// were lost: Capcom vs. SNK 2 turns off the title's hiscore key and the
// continue screen's move key, and asks for any button on its hiscore screen.
//
// The build's copy of the pack gets, under each `.key` / `.keycode` line the
// engine had a default for and whose value differs from that default (1.0's
// defaultMotif.ini, as WebMUGEN 2.4 shipped it), the same keys as an
// `.action` line, unless the pack sets that `.action` itself. The `.key` line
// stays (the other engine skips the `.action` line the same way). A line equal
// to 1.0's default adds nothing: the new engine's own default applies (it
// confirms with the face buttons, not Start). The tokens:
//   a b c x y z  -> BTN:a ... BTN:z (the engine button, after the player's
//                   Controller Setup, as the letter meant in 1.0)
//   s / m / d / w -> BTN:start / BTN:menu / BTN:d / BTN:w
//   U D L R      -> DP_U, LS_Y- / DP_D, LS_Y+ / DP_L, LS_X- / DP_R, LS_X+
//                   (the d-pad and the stick, as the new defaults name them);
//                   B and F (back, forward) are left and right, a leading $
//                   or / is dropped
//   LS_* RS_* LT RT (1.0's raw axis names) as they are
//   .keycode X   -> KEY:X
// plus the default's own mouse buttons (and, for a .keycode, the default's
// pad control: the pack chose a keyboard key only); a blank value stays blank
// (the screen ignores every control, mouse included, as it did). A token 1.0
// did not know is dropped; a line with nothing left adds nothing. The 22 old
// parameters with no `.action` twin (text input keycodes, keymenu.*, the
// victory/win/survival/time attack/hiscore cancel and skip keys, dialogue
// skip) need nothing: their screens were replaced. Storyboards: see
// storyboardActions below.
//
// Only for builds of the modern-input engine (vfslib, V2); every engine of
// that format reads the same tokens (upstream's own build too). Pure: text in,
// text out, line endings and every other byte kept.
const KEY_ACTION_MARK = '; Mugen Studio: the line above in the modern-input engine\'s action tokens';
// section -> [old parameter, new parameter, 1.0's default, tokens kept from the new default]
const KEY_ACTIONS = {
  'title info': [
    ['menu.item.delete.keycode', 'menu.item.delete.action', 'DELETE', 'LS, MOUSE:X2'],
    ['menu.next.key', 'menu.next.action', 'D, R', 'MOUSE:WHEELDOWN'],
    ['menu.previous.key', 'menu.previous.action', 'U, L', 'MOUSE:WHEELUP'],
    ['menu.done.key', 'menu.done.action', 'a, b, c, x, y, z, s', 'MOUSE:LEFT'],
    ['menu.cancel.key', 'menu.cancel.action', 'm', 'MOUSE:RIGHT'],
    ['menu.hiscore.key', 'menu.hiscore.action', 's', 'MOUSE:MIDDLE'],
  ],
  'infobox': [
    ['keycode', 'action', 'F1', ''],
  ],
  'select info': [
    ['cell.up.key', 'cell.up.action', 'U', ''],
    ['cell.down.key', 'cell.down.action', 'D', ''],
    ['cell.left.key', 'cell.left.action', 'L', ''],
    ['cell.right.key', 'cell.right.action', 'R', ''],
    ['p1.teammenu.done.key', 'p1.teammenu.done.action', 'a, b, c, x, y, z, s', 'MOUSE:LEFT'],
    ['p1.teammenu.next.key', 'p1.teammenu.next.action', 'D', 'MOUSE:WHEELDOWN'],
    ['p1.teammenu.previous.key', 'p1.teammenu.previous.action', 'U', 'MOUSE:WHEELUP'],
    ['p1.teammenu.add.key', 'p1.teammenu.add.action', 'R', ''],
    ['p1.teammenu.subtract.key', 'p1.teammenu.subtract.action', 'L', ''],
    ['p1.palmenu.next.key', 'p1.palmenu.next.action', 'U, R', 'MOUSE:WHEELUP'],
    ['p1.palmenu.previous.key', 'p1.palmenu.previous.action', 'D, L', 'MOUSE:WHEELDOWN'],
    ['p1.palmenu.done.key', 'p1.palmenu.done.action', 'a, b, c, x, y, z', 'MOUSE:LEFT'],
    ['p1.palmenu.cancel.key', 'p1.palmenu.cancel.action', 'm', 'MOUSE:RIGHT'],
    ['p1.palmenu.random.key', 'p1.palmenu.random.action', 's', 'MOUSE:MIDDLE'],
    ['p2.teammenu.done.key', 'p2.teammenu.done.action', 'a, b, c, x, y, z, s', 'MOUSE:LEFT'],
    ['p2.teammenu.next.key', 'p2.teammenu.next.action', 'D', 'MOUSE:WHEELDOWN'],
    ['p2.teammenu.previous.key', 'p2.teammenu.previous.action', 'U', 'MOUSE:WHEELUP'],
    ['p2.teammenu.add.key', 'p2.teammenu.add.action', 'L', ''],
    ['p2.teammenu.subtract.key', 'p2.teammenu.subtract.action', 'R', ''],
    ['p2.palmenu.next.key', 'p2.palmenu.next.action', 'U, R', 'MOUSE:WHEELUP'],
    ['p2.palmenu.previous.key', 'p2.palmenu.previous.action', 'D, L', 'MOUSE:WHEELDOWN'],
    ['p2.palmenu.done.key', 'p2.palmenu.done.action', 'a, b, c, x, y, z', 'MOUSE:LEFT'],
    ['p2.palmenu.cancel.key', 'p2.palmenu.cancel.action', 'm', 'MOUSE:RIGHT'],
    ['p2.palmenu.random.key', 'p2.palmenu.random.action', 's', 'MOUSE:MIDDLE'],
    ['done.key', 'done.action', 'a, b, c, x, y, z, s', 'MOUSE:LEFT'],
    ['cancel.key', 'cancel.action', 'm', 'MOUSE:RIGHT'],
  ],
  'vs screen': [
    ['p1.key', 'p1.action', '', ''],
    ['p2.key', 'p2.action', '', ''],
    ['done.key', 'done.action', 'a, b, c, x, y, z, s', 'MOUSE:LEFT'],
    ['skip.key', 'skip.action', 's', 'MOUSE:LEFT'],
    ['cancel.key', 'cancel.action', 'm', 'MOUSE:RIGHT'],
  ],
  'demo mode': [
    ['cancel.key', 'cancel.action', 'a, b, c, x, y, z, s, m', 'MOUSE:LEFT, MOUSE:RIGHT'],
  ],
  'continue screen': [
    ['move.key', 'move.action', 'D, R, U, L', 'MOUSE:WHEELUP, MOUSE:WHEELDOWN'],
    ['done.key', 'done.action', 's', 'MOUSE:LEFT'],
  ],
  'victory screen': [
    ['cancel.key', 'cancel.action', 'b, c, x, y, z, s', 'MOUSE:RIGHT'],
  ],
  'option info': [
    ['menu.next.key', 'menu.next.action', 'D', 'MOUSE:WHEELDOWN'],
    ['menu.previous.key', 'menu.previous.action', 'U', 'MOUSE:WHEELUP'],
    ['menu.add.key', 'menu.add.action', 'R', 'MOUSE:LEFT'],
    ['menu.subtract.key', 'menu.subtract.action', 'L', 'MOUSE:MIDDLE'],
    ['menu.done.key', 'menu.done.action', 'a, b, c, x, y, z, s', 'MOUSE:LEFT'],
    ['menu.cancel.key', 'menu.cancel.action', 'm', 'MOUSE:RIGHT'],
  ],
  'replay info': [
    ['menu.item.delete.keycode', 'menu.item.delete.action', 'DELETE', 'LS, MOUSE:X2'],
    ['menu.item.rename.keycode', 'menu.item.rename.action', 'SPACE', 'RS, MOUSE:X1'],
    ['menu.next.key', 'menu.next.action', 'D', 'MOUSE:WHEELDOWN'],
    ['menu.previous.key', 'menu.previous.action', 'U', 'MOUSE:WHEELUP'],
    ['menu.done.key', 'menu.done.action', 'a, b, c, x, y, z, s', 'MOUSE:LEFT'],
    ['menu.cancel.key', 'menu.cancel.action', 'm', 'MOUSE:RIGHT'],
  ],
  'pause menu': [
    ['menu.next.key', 'menu.next.action', 'D', 'MOUSE:WHEELDOWN'],
    ['menu.previous.key', 'menu.previous.action', 'U', 'MOUSE:WHEELUP'],
    ['menu.add.key', 'menu.add.action', 'R', 'MOUSE:LEFT'],
    ['menu.subtract.key', 'menu.subtract.action', 'L', 'MOUSE:MIDDLE'],
    ['menu.done.key', 'menu.done.action', 'a, b, c, x, y, z, s', 'MOUSE:LEFT'],
    ['menu.cancel.key', 'menu.cancel.action', 'm', 'MOUSE:RIGHT'],
  ],
  'attract mode': [
    ['menu.next.key', 'menu.next.action', 'D, R', 'MOUSE:WHEELDOWN'],
    ['menu.previous.key', 'menu.previous.action', 'U, L', 'MOUSE:WHEELUP'],
    ['menu.done.key', 'menu.done.action', 'a, b, c, x, y, z, s', 'MOUSE:LEFT'],
    ['menu.cancel.key', 'menu.cancel.action', 'm', 'MOUSE:RIGHT'],
    ['menu.hiscore.key', 'menu.hiscore.action', 's', 'MOUSE:MIDDLE'],
    ['credits.keycode', 'credits.action', 'F6', ''],
    ['options.keycode', 'options.action', 'F11', ''],
    ['start.press.key', 'start.press.action', 's', 'MOUSE:LEFT'],
  ],
  'challenger info': [
    ['key', 'action', 's', ''],
  ],
  'dialogue info': [
    ['cancel.key', 'cancel.action', 'b, c, x, y, z, s', 'MOUSE:RIGHT'],
  ],
  'hiscore info': [
    ['next.key', 'next.action', 'D', 'MOUSE:WHEELDOWN'],
    ['previous.key', 'previous.action', 'U', 'MOUSE:WHEELUP'],
    ['done.key', 'done.action', 'a, b, c, x, y, z', 'MOUSE:LEFT'],
  ],
};
// [Training Pause Menu] reads the pause menu's parameters.
KEY_ACTIONS['training pause menu'] = KEY_ACTIONS['pause menu'];

const KEY_DIRS = { U: ['DP_U', 'LS_Y-'], D: ['DP_D', 'LS_Y+'], L: ['DP_L', 'LS_X-'], R: ['DP_R', 'LS_X+'], B: ['DP_L', 'LS_X-'], F: ['DP_R', 'LS_X+'] };
const KEY_BUTTONS = { a: 'a', b: 'b', c: 'c', x: 'x', y: 'y', z: 'z', s: 'start', m: 'menu', d: 'd', w: 'w' };
const KEY_RAW = new Set(['LS_Y+', 'LS_Y-', 'LS_X+', 'LS_X-', 'RS_Y+', 'RS_Y-', 'RS_X+', 'RS_X-', 'LT', 'RT']);

// A 1.0 value's tokens as the engine read them: & is a comma, quotes come off.
const oldTokens = (v) => String(v || '').split(/[,&]/).map((s) => s.trim().replace(/^"+|"+$/g, '').trim()).filter(Boolean);
const sameKeys = (a, b) => oldTokens(a).sort().join(',') === oldTokens(b).sort().join(',');

// The new tokens for one old value (`code`: a .keycode line), or null when
// nothing in it maps. A blank value gives ''.
function actionTokens(value, code, keep) {
  const toks = oldTokens(value);
  if (!toks.length) return '';
  const out = [];
  const add = (t) => { if (!out.includes(t)) out.push(t); };
  for (let t of toks) {
    if (code) { if (/^[A-Za-z0-9_]+$/.test(t)) add('KEY:' + t.toUpperCase()); continue; }
    if (t[0] === '~') continue;
    t = t.replace(/^[$/>]+/, '');
    if (KEY_DIRS[t]) KEY_DIRS[t].forEach(add);
    else if (KEY_BUTTONS[t]) add('BTN:' + KEY_BUTTONS[t]);
    else if (KEY_RAW.has(t.toUpperCase())) add(t.toUpperCase());
  }
  if (!out.length) return null;
  for (const k of String(keep || '').split(',').map((s) => s.trim()).filter(Boolean)) add(k);
  return out.join(', ');
}

// The lines to add for one table (`rows`) over one section `sec` of `lines`:
// [line index of the old key, its indent, the new line].
function sectionActionLines(lines, sec, rows) {
  const k = keysIn(lines, sec);
  const add = [];
  for (const [oldKey, newKey, def, keep] of rows) {
    const e = k.get(oldKey);
    if (!e || k.has(newKey)) continue;
    if (sameKeys(e.v, def)) continue;
    const v = actionTokens(e.v, /keycode$/.test(oldKey), keep);
    if (v === null) continue;
    const indent = (/^[ \t]*/.exec(lines[e.line]) || [''])[0];
    add.push([e.line, indent, newKey + ' = ' + v]);
  }
  return add;
}

// Every section of `lines` whose name (case, spaces and underscores aside)
// is in `table`, with the lines to add.
function actionPlan(lines, table) {
  const plan = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*\[([^\]]+)\]/.exec(strip(lines[i]));
    if (!m) continue;
    const name = m[1].trim().toLowerCase().replace(/[\s_]+/g, ' ');
    const rows = table[name];
    if (!rows) continue;
    let e = lines.findIndex((l, j) => j > i && /^\s*\[/.test(strip(l)));
    if (e < 0) e = lines.length;
    plan.push(...sectionActionLines(lines, { s: i, e }, rows));
  }
  return plan;
}

function applyActionPlan(t, table) {
  const nl = /\r\n/.test(t) ? '\r\n' : '\n';
  const lines = t.split(/\r?\n/);
  const plan = actionPlan(lines, table);
  if (!plan.length) return t;
  // bottom up, so the line numbers above stay valid
  plan.sort((a, b) => b[0] - a[0]);
  for (const [at, indent, line] of plan) lines.splice(at + 1, 0, indent + KEY_ACTION_MARK, indent + line);
  return lines.join(nl);
}

function keyActions(defText) {
  return applyActionPlan(String(defText), KEY_ACTIONS);
}
const needsKeyActions = (defText) => /\.key(code)?\s*=|^\s*(key|keycode)\s*=/mi.test(String(defText)) && keyActions(defText) !== String(defText);

// A STORYBOARD'S OWN KEYS. 1.0's [SceneDef] `key.skip` (next scene; default
// s) and `key.cancel` (end the storyboard; default a, b, c, x, y, z, m) are
// the modern-input engine's `done.action` (default START, MOUSE:LEFT) and
// `cancel.action` (default A, B, X, Y, LB, RB, LT, RT, BACK, MOUSE:RIGHT).
// The same rules as the screenpack's keys above: Capcom vs. SNK 2's credits
// (`key.skip =` blank, `key.cancel = a, b, c, x, y, z, s, m`) get `done.action
// =` and the cancel keys with Start, as 2.4 played them. The build's copy of
// each storyboard of the build's screenpack (vfslib), V2 builds only.
const STORYBOARD_ACTIONS = {
  scenedef: [
    ['key.skip', 'done.action', 's', 'MOUSE:LEFT'],
    ['key.cancel', 'cancel.action', 'a, b, c, x, y, z, m', 'MOUSE:RIGHT'],
  ],
};
function storyboardActions(defText) {
  return applyActionPlan(String(defText), STORYBOARD_ACTIONS);
}
const needsStoryboardActions = (defText) => /^\s*key\.(skip|cancel)\s*=/mi.test(String(defText)) && storyboardActions(defText) !== String(defText);

module.exports = {
  memberFaces, needsMemberFaces, serverGroup, needsServerGroup, SERVER_GROUP_LINES,
  GRAFT_MARKER, hasNetworkGraft, dropNetworkGraft,
  pauseMargins, needsPauseMargins, PAUSE_MARGINS_LINES,
  sideSelect, needsSideSelect, SIDE_SELECT_MARK,
  rematchInfo, needsRematchInfo, REMATCH_MARK,
  pauseMovelist, needsPauseMovelist, MOVELIST_MARK,
  keyActions, needsKeyActions, KEY_ACTIONS, KEY_ACTION_MARK, actionTokens,
  storyboardActions, needsStoryboardActions, STORYBOARD_ACTIONS,
};
