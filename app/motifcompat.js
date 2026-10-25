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

module.exports = {
  memberFaces, needsMemberFaces, serverGroup, needsServerGroup, SERVER_GROUP_LINES,
  GRAFT_MARKER, hasNetworkGraft, dropNetworkGraft,
};
