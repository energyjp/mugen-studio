'use strict';
// TEAM PLAY: one Lua mod, shipped by the website build and the desktop export
// alike as external/mods/mugen-studio/team-play.lua (the Mods tab can switch it
// off: modmgr.js, 'team-play'). Both engines load every .lua under
// external/mods after main.lua has built its tables, so this wraps stock
// functions instead of editing the engine's scripts - the desktop build runs
// the official release untouched.
//
// Three changes:
//
//  1. THE CPU TEAM STARTS AT YOUR TEAM SIZE. In Arcade the player also picks
//     the CPU team's mode, and that menu's size starts at the mode's minimum
//     (2) whatever the player picked for their own side - pick a team of 3,
//     then Tag or Simul for the CPU, and a 3v2 starts unless the size is
//     raised by hand. Every build.
//
//  2. THE SIZE ICONS SHOW THE HIGHLIGHTED MODE. A screenpack that puts every
//     team mode on the same spot (item spacing 0,0) gets every mode's size
//     icons drawn on that spot too, so the icons on screen are whichever mode
//     the engine drew last. While the menu draws, every mode shows the
//     highlighted mode's size; the real sizes are restored straight after.
//
//  3. ADD004 TAG: A TEAM OF 3 BY DEFAULT, AND THE PARTNER YOU TAG IN IS YOURS.
//     add004 (a system patch many MUGEN builds carry) turns Simul into tag,
//     and its tag mode is built for teams of three: Simul starts at 3 on a
//     fresh select screen (still 2-4 by hand; a size changed by the player
//     survives rematches, as stock). All but one member of a team
//     wait off-screen and a command swaps them. Stock setup makes every Simul
//     member past the leader a CPU, so the partner you tagged in fought on its
//     own. In a build whose add004 tag switch is on, a human side's Simul
//     partners take the side's controller instead - the stock setup already
//     routes that controller to them, only the CPU level is set to 0. Only
//     then, and never in co-op or Training: in plain Simul three human-driven
//     fighters on one controller would all move together.

const fs = require('fs');

// Is add004's tag system on in this common state file? add004 keeps its
// switches as a bit field in var(7) of its main helper, set in the block marked
// ";;>>@Config.System_Switch>>": one assignment of the starting value (every
// feature on) followed by lines that each flip a feature off - commented out
// when the feature stays on. The tag system is bit 1024. var(7) is reused by
// other helpers further down the file, so only that block is read.
//
// Returns { add004, tag, why }.
function add004Tag(text) {
  const src = String(text || '');
  if (!/^\s*\[\s*statedef\s+190190\s*\]/im.test(src)) {
    return { add004: false, tag: false, why: 'no add004 tag states (190190) in the common states' };
  }
  const lines = src.split(/\r?\n/);
  const code = (l) => l.split(';')[0];
  for (let i = 0; i < lines.length; i++) {
    if (!/>>@Config\.System_Switch>>/.test(lines[i])) continue;
    let value = null;
    const flips = [];
    let started = false;
    for (let j = i + 1; j < lines.length && j < i + 60; j++) {
      const c = code(lines[j]);
      if (/^\s*\[\s*state/i.test(c)) {
        if (started) break;          // the next controller: the block is over
        started = true;
        continue;
      }
      const init = /var\(7\)\s*:=\s*(\d+)\s*(?:\|\||$)/i.exec(c);
      if (init && !/\^/.test(c)) value = Number(init[1]);
      const flip = /var\(7\)\s*:=\s*\(\s*var\(7\)\s*\^\s*(\d+)\s*\)/i.exec(c);
      if (flip) flips.push(Number(flip[1]));
    }
    if (value === null) continue;    // the header's index of marks, not the block
    for (const f of flips) value ^= f;
    const tag = (value & 1024) !== 0;
    return { add004: true, tag, why: tag ? 'add004 tag system switched on' : 'add004 tag system switched off in System_Switch' };
  }
  return { add004: true, tag: false, why: 'add004 states found but no System_Switch block to read' };
}

// The add004 answer for a bundle, read from the build's own common states file
// (buildimport registers it as roster.commonStates).
function add004TagForBundle(statesFile) {
  if (!statesFile) return { add004: false, tag: false, why: 'the bundle lists no common states of its own' };
  let text;
  try { text = fs.readFileSync(statesFile, 'latin1'); } catch (e) { return { add004: false, tag: false, why: 'common states file unreadable' }; }
  return add004Tag(text);
}

function teamPlayLua(opts = {}) {
  const add004 = !!opts.add004Tag;
  const out = [];
  const L = (...lines) => out.push(...lines);

  L('-- Team play (Mugen Studio). Delete this file to go back to stock.',
    '--',
    '-- * The CPU team in Arcade starts at the size of your own team, instead of',
    '--   the mode\'s minimum.',
    '-- * A screenpack that draws every team mode on the same spot also draws',
    '--   every mode\'s size icons on the same spot, so the icons on screen belong',
    '--   to whichever mode the engine drew last. While the menu is drawn, every',
    '--   mode shows the HIGHLIGHTED mode\'s size; the real sizes are put back',
    '--   straight after, so each mode still keeps its own.');
  if (add004) {
    L('-- * This build carries add004 with its tag system on, which turns Simul into',
      '--   tag: one fighter per side on screen, partners waiting off-screen.',
      '--   Simul starts at 3 on a fresh select screen, and on a human-controlled',
      '--   side the partners you tag in follow your controls (stock setup would',
      '--   hand each of them to the CPU).');
  }
  L('-- Mods load after main.lua has built its tables, so these are wrappers, not',
    '-- edits: the stock functions still run first.',
    '');

  L('local function fit(v, bounds)',
    '\tif not bounds then return v end',
    '\treturn math.max(bounds[1], math.min(bounds[2], v))',
    'end',
    '');

  if (add004) {
    L('local simulDefaultPending = {false, false}',
      'if start and start.f_selectReset then',
      '\tlocal stockSelectReset = start.f_selectReset',
      '\tstart.f_selectReset = function(hardReset, ...)',
      '\t\tlocal r = stockSelectReset(hardReset, ...)',
      '\t\tif hardReset then simulDefaultPending = {true, true} end',
      '\t\treturn r',
      '\tend',
      'end',
      '');
  }

  L('if start and start.f_teamMenu then',
    '\tlocal followed = setmetatable({}, {__mode = \'k\'})',
    '\tlocal sizeKey = {simul = \'numSimul\', turns = \'numTurns\', tag = \'numTag\'}',
    '\tlocal stockTeamMenu = start.f_teamMenu',
    '\tstart.f_teamMenu = function(side, t)',
    '\t\tlocal p = start.p[side]');
  if (add004) {
    L('\t\tif simulDefaultPending[side] and main.numSimul then',
      '\t\t\tsimulDefaultPending[side] = false',
      '\t\t\tp.numSimul = fit(3, main.numSimul)',
      '\t\tend');
  }
  L('\t\tif side == 2 and main.cpuSide[2] and not main.cpuSide[1] and start.p[1].teamEnd and not p.teamEnd',
    '\t\t\tand p.t_selected and not followed[p.t_selected] then',
    '\t\t\tfollowed[p.t_selected] = true',
    '\t\t\tlocal n = start.p[1].numChars or 1',
    '\t\t\tif n >= 2 then',
    '\t\t\t\tp.numSimul = fit(n, main.numSimul)',
    '\t\t\t\tp.numTag = fit(n, main.numTag)',
    '\t\t\t\tp.numTurns = fit(n, main.numTurns)',
    "\t\t\t\tprint('[team-play] CPU team starts at ' .. n)",
    '\t\t\tend',
    '\t\tend',
    '\t\t-- the icons: only for a menu whose items all sit on the same spot',
    '\t\tlocal spacing = motif.select_info[\'p\' .. side].teammenu.item.spacing',
    '\t\tlocal active = t and t[p.teamMenu or 1]',
    '\t\tlocal key = active and sizeKey[active.itemname]',
    '\t\tlocal shown = nil',
    '\t\tif active and spacing and spacing[1] == 0 and spacing[2] == 0 then',
    '\t\t\tif active.itemname == \'single\' then shown = 1 elseif key then shown = p[key] end',
    '\t\tend',
    '\t\tlocal saved = nil',
    '\t\tif shown then',
    '\t\t\tsaved = {}',
    '\t\t\tfor _, k in pairs(sizeKey) do',
    '\t\t\t\tif k ~= key then saved[k] = p[k]; p[k] = shown end',
    '\t\t\tend',
    '\t\tend',
    '\t\t-- the real sizes go back even if the stock menu raises an error',
    '\t\tlocal ok, r = pcall(stockTeamMenu, side, t)',
    '\t\tif saved then',
    '\t\t\tfor k, v in pairs(saved) do p[k] = v end',
    '\t\tend',
    '\t\tif not ok then error(r, 0) end',
    '\t\treturn r',
    '\tend',
    'end');

  if (add004) {
    L('',
      'if start and start.f_remapAI then',
      '\tlocal stockRemapAI = start.f_remapAI',
      '\tstart.f_remapAI = function(ai)',
      '\t\tstockRemapAI(ai)',
      "\t\tif main.coop or gameMode('training') then return end",
      '\t\tfor side = 1, 2 do',
      '\t\t\tlocal human = (not main.cpuSide[side]) or start.challenger > 0',
      '\t\t\tif human and start.p[side].teamMode == 1 then --Simul',
      '\t\t\t\tfor i = side + 2, #start.p[side].t_selected * 2 do',
      '\t\t\t\t\tif (i - 1) % 2 + 1 == side then',
      '\t\t\t\t\t\tremapInput(i, side)',
      '\t\t\t\t\t\tsetCom(i, 0)',
      "\t\t\t\t\t\tprint('[team-play] P' .. i .. ' follows side ' .. side .. ' controls')",
      '\t\t\t\t\tend',
      '\t\t\t\tend',
      '\t\t\tend',
      '\t\tend',
      '\tend',
      'end');
  }
  L('');
  return out.join('\n');
}

// In the folder that holds every add-on of the Studio's: modmgr.js VPATHS,
// the add-ons' registry, names the same string (tools/test-mods-build.js
// checks the two agree).
const TEAM_PLAY_VPATH = 'external/mods/mugen-studio/team-play.lua';

module.exports = { add004Tag, add004TagForBundle, teamPlayLua, TEAM_PLAY_VPATH };
