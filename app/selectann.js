'use strict';
// THE SELECT-SCREEN ANNOUNCER, from mugenhook's cursor table.
//
// A MUGEN build running mugenhook can give each cell of the select grid a
// clip of its own from the screenpack's system.snd: the announcer calls the
// fighter's name when a player PICKS him (MK2 Remix does this; the owner's
// test on the real build). Not on hover: played on every cursor move it calls
// a name for each cell the cursor crosses. The list is
// cfg/soundAnn.dat, switched on by `bHookCursorTable = true` in
// mugenhook.ini, read in the mode `iCursorTableOperationType` names:
//
//   mode 0   row col p1group p1elem p2group p2elem
//   mode 1   charid  p1group p1elem p2group p2elem
//   mode 2   each character's own .snd (iCursorDefaultGroup/Index) - not
//            carried: there is no table to read
//
// Ikemen's only per-pick sound is the character's own (pN.select.snd, played
// through start.f_playWave(ref, 'cursor', ...) when a pick is confirmed). The
// import turns the list into roster.selectAnnouncer, one row per grid cell:
// [row, col, p1group, p1elem, p2group, p2elem]. Both exports then ship
// external/mods/mugen-studio/select-announcer.lua, which wraps
// start.f_playWave the way team-play.lua wraps the team menu: the engine's
// scripts stay untouched, the move and done sounds are the stock ones, and
// deleting the file takes the announcer away. A bundle with no table ships no
// file, and neither does one whose Mods tab switched it off (modmgr.js,
// 'select-announcer').

// In the folder that holds every add-on of the Studio's: modmgr.js VPATHS,
// the add-ons' registry, names the same string (tools/test-mods-build.js
// checks the two agree).
const SELECT_ANN_VPATH = 'external/mods/mugen-studio/select-announcer.lua';

// mugenhook.ini: is the cursor table on, and in which mode is the .dat read.
function hookSwitches(iniText) {
  const t = String(iniText || '');
  const on = /^\s*bHookCursorTable\s*=\s*true\b/im.test(t);
  const m = /^\s*iCursorTableOperationType\s*=\s*(-?\d+)/im.exec(t);
  return { on, mode: m ? Number(m[1]) : 0 };
}

// cfg/soundAnn.dat as rows. `;` starts a comment; a line with too few numbers
// is skipped.
function parseSoundAnn(text, mode) {
  const need = mode === 1 ? 5 : 6;
  const out = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.replace(/;.*$/, '').trim();
    if (!line) continue;
    const v = line.split(/[\s,]+/).slice(0, need).map((x) => parseInt(x, 10));
    if (v.length < need || v.some((x) => !Number.isInteger(x))) continue;
    if (mode === 1) out.push({ id: v[0], p1: [v[1], v[2]], p2: [v[3], v[4]] });
    else out.push({ row: v[0], col: v[1], p1: [v[2], v[3]], p2: [v[4], v[5]] });
  }
  return out;
}

// The rows as grid cells of the imported roster. `cells` is the import's grid
// (buildimport inspect: one entry per cell, kind 'char' where a character
// sits), `columns` the screenpack's [Select Info] columns. A row whose cell
// holds no character is dropped and listed (MK2 Remix's hidden bosses sit in
// cells only mugenhook's variations reach). Mode 1's char id is taken as the
// n-th character cell of the grid, counted from 0.
function toCells(rows, mode, cells, columns) {
  const kept = [], dropped = [];
  const grid = cells || [];
  const charCells = grid.filter((c) => c && c.kind === 'char');
  for (const r of rows) {
    let row, col;
    if (mode === 1) {
      const c = charCells[r.id];
      if (!c || !(columns > 0)) { dropped.push({ id: r.id, why: 'no character with that id' }); continue; }
      row = Math.floor(c.cell / columns); col = c.cell % columns;
    } else {
      row = r.row; col = r.col;
      const at = columns > 0 && col >= 0 && col < columns && row >= 0 ? grid[row * columns + col] : null;
      if (!at || at.kind !== 'char') { dropped.push({ row, col, why: 'no character in that cell' }); continue; }
    }
    kept.push([row, col, r.p1[0], r.p1[1], r.p2[0], r.p2[1]]);
  }
  return { cells: kept, dropped };
}

// The [Select Info] columns of a system.def's text.
function selectColumns(sysText) {
  let sec = '';
  for (const raw of String(sysText || '').split(/\r?\n/)) {
    const l = raw.replace(/;.*$/, '').trim();
    const h = /^\[([^\]]+)\]/.exec(l);
    if (h) { sec = h[1].trim().toLowerCase(); continue; }
    if (sec !== 'select info') continue;
    const m = /^columns\s*=\s*(\d+)/i.exec(l);
    if (m) return Number(m[1]);
  }
  return 5;   // the engine's default
}

// The [Files] snd of a system.def's text.
function motifSnd(sysText) {
  let sec = '';
  for (const raw of String(sysText || '').split(/\r?\n/)) {
    const l = raw.replace(/;.*$/, '').trim();
    const h = /^\[([^\]]+)\]/.exec(l);
    if (h) { sec = h[1].trim().toLowerCase(); continue; }
    if (sec !== 'files') continue;
    const m = /^snd\s*=\s*(.+)$/i.exec(l);
    if (m) return m[1].trim().replace(/^"|"$/g, '');
  }
  return null;
}

// The Lua mod for a roster, or null when it has no table.
function luaForRoster(roster) {
  const t = roster && roster.selectAnnouncer;
  const ok = (x) => Number.isInteger(x) && x >= -1 && x < 1e6;
  const rows = ((t && t.cells) || []).filter((c) => Array.isArray(c) && c.length >= 6 && c.slice(0, 6).every(ok) && c[0] >= 0 && c[1] >= 0);
  if (!rows.length) return null;
  const L = [
    '-- Select-screen announcer (Mugen Studio). Delete this file to go back to stock.',
    '--',
    '-- This build\'s MUGEN version had the announcer call a fighter\'s name when a',
    '-- player picked him (mugenhook\'s cursor table, cfg/soundAnn.dat). The same',
    '-- clips play here, from the screenpack\'s own sounds, when a pick is confirmed;',
    '-- moving the cursor plays the stock move sound. Mods load after main.lua has',
    '-- built its tables, so this is a wrapper, not an edit.',
    '',
    '-- [\'row,col\'] = {{P1 group, element}, {P2 group, element}}',
    'local t_clips = {',
    ...rows.map((c) => '\t[\'' + c[0] + ',' + c[1] + '\'] = {{' + c[2] + ', ' + c[3] + '}, {' + c[4] + ', ' + c[5] + '}},'),
    '}',
    '',
    '-- The cell holding a character (start.t_grid is 1-based) and the side of the',
    '-- player on it: the pick call passes the character, not the player.',
    'local function cellOf(ref)',
    '\tfor r, row in pairs(start.t_grid or {}) do',
    '\t\tfor c, cell in pairs(row) do',
    '\t\t\tif type(cell) == \'table\' and cell.char_ref == ref then return r - 1, c - 1 end',
    '\t\tend',
    '\tend',
    'end',
    'local function sideOf(ref)',
    '\tfor p, c in pairs(start.c or {}) do',
    '\t\tif type(c) == \'table\' and c.selRef == ref then return (p - 1) % 2 + 1 end',
    '\tend',
    '\treturn 1',
    'end',
    '',
    '-- start.f_playWave(ref, \'cursor\', ...) is the pick\'s own call (and the palette',
    '-- menu\'s preview, which passes its own sound: skipped when it differs).',
    'if start and start.f_playWave then',
    '\tlocal stockPlayWave = start.f_playWave',
    '\tstart.f_playWave = function(ref, name, g, n, loops)',
    '\t\tif name == \'cursor\' and ref ~= nil then',
    '\t\t\tlocal side = sideOf(ref)',
    '\t\t\tlocal si = motif.select_info[\'p\' .. side] or {}',
    '\t\t\tlocal pv = si.palmenu and si.palmenu.preview and si.palmenu.preview.snd',
    '\t\t\tlocal ss = si.select and si.select.snd',
    '\t\t\tlocal preview = pv and ss and pv[1] == g and pv[2] == n and (ss[1] ~= g or ss[2] ~= n)',
    '\t\t\tlocal y, x = cellOf(ref)',
    '\t\t\tlocal e = (not preview) and y and t_clips[y .. \',\' .. x]',
    '\t\t\tlocal clip = e and e[side]',
    '\t\t\tif clip then',
    '\t\t\t\tsndPlay(motif.Snd, clip[1], clip[2])',
    '\t\t\t\tprint(\'[select-announcer] P\' .. side .. \' picked \' .. y .. \',\' .. x .. \' plays \' .. clip[1] .. \',\' .. clip[2])',
    '\t\t\tend',
    '\t\tend',
    '\t\treturn stockPlayWave(ref, name, g, n, loops)',
    '\tend',
    'end',
    '',
  ];
  return L.join('\n');
}

module.exports = { SELECT_ANN_VPATH, hookSwitches, parseSoundAnn, toCells, selectColumns, motifSnd, luaForRoster };
