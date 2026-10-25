'use strict';
// THE MATCH MODE OF CASUAL AND RANKED. Online VERSUS offers Single only: the
// website engine's team menu drops Simul, Turns and Tag in netplayversus
// (start.lua, onlineSingleOnly), because team modes load more fighters, and on
// the single-threaded web build that means longer garbage-collection pauses and
// more rollback work every frame. A build made around a team mode (add004's
// tag, which runs on Simul with teams of three) can pick one mode and a team
// size for both matchmaking queues instead (roster.queueMode, set in the
// Studio's Online tab next to the Online menu switch).
//
// How it reaches the game (both only in a build with the Online menu on):
//  - the CASUAL MATCH and RANKED MATCH handlers vfslib patches into main.lua
//    set main.queueTeam around their VERSUS (handlerSet, handlerClear);
//  - the online mod vfslib generates adds a select-screen hook (hookLua) that,
//    while main.queueTeam names a team mode, makes the team menu that one mode
//    at that size for both sides. With one mode at a fixed size the engine
//    skips the team menu by itself (start.f_teamMenu). Friend lobbies (HOST /
//    JOIN) never set it and keep the engine's Single only.
// Both players run the same build, so both apply the same mode.
//
// Stored as no key at all for the default (1 vs 1), like leaderboardPage.

const MODES = ['single', 'simul', 'tag', 'turns'];
const LABELS = { single: '1 vs 1 (Single)', simul: 'Simul', tag: 'Tag', turns: 'Turns' };
const SIZES = [2, 3, 4];

// { mode, size } from whatever roster.queueMode holds: an unknown mode is
// Single, a team size outside 2-4 is 2. Single's size is 1.
function normalize(v) {
  const mode = v && typeof v === 'object' && MODES.includes(v.mode) ? v.mode : 'single';
  if (mode === 'single') return { mode, size: 1 };
  const n = Number(v.size);
  return { mode, size: SIZES.includes(n) ? n : 2 };
}

// What roster.json keeps: null (no key) for Single.
function toRoster(v) {
  const q = normalize(v);
  return q.mode === 'single' ? null : { mode: q.mode, size: q.size };
}

// The Lua lines the queue handlers run around their VERSUS (one tab deeper
// than the handler's `if synchronize() then`).
function handlerSet(v) {
  const q = normalize(v);
  return 'main.queueTeam = {mode = \'' + q.mode + '\', size = ' + q.size + '}';
}
const handlerClear = 'main.queueTeam = nil';

// The select-screen hook, for the online mod. Plain Lua, no backtick, no ${.
function hookLua() {
  return [
    '-- THE MATCH MODE OF CASUAL AND RANKED (the Studio\'s Online tab, Match mode).',
    '-- A queue match sets main.queueTeam around its VERSUS. While it names a team',
    '-- mode, the team menu is that one mode at that size for both sides, and with',
    '-- one mode at a fixed size the engine skips the menu (start.f_teamMenu).',
    '-- Friend lobbies never set it.',
    '-- The engine runs hooks unprotected, so a fault here is caught and the menu',
    '-- stays the engine\'s (Single); both players run the same build, so both',
    '-- take the same path.',
    'local function queueTeamMenu(side, t, params)',
    '\tlocal q = main.queueTeam',
    '\tif type(q) ~= \'table\' or type(t) ~= \'table\' or not gameMode(\'netplayversus\') then return end',
    '\tlocal modeNo = ({simul = 1, turns = 2, tag = 3})[q.mode]',
    '\tlocal key = ({simul = \'numSimul\', turns = \'numTurns\', tag = \'numTag\'})[q.mode]',
    '\tif modeNo == nil then return end',
    '\tlocal n = math.max(2, math.min(4, math.floor(tonumber(q.size) or 2)))',
    '\tlocal name = type(params) == \'table\' and params[q.mode] or nil',
    '\tlocal item = {itemname = q.mode, displayname = name or string.upper(q.mode), mode = modeNo}',
    '\tmain[key] = {n, n}',
    '\tstart.p[side][key] = n',
    '\tfor i = #t, 1, -1 do table.remove(t, i) end',
    '\tt[1] = item',
    '\tprint(\'[online] side \' .. side .. \' plays \' .. q.mode .. \', \' .. n .. \' a side\')',
    'end',
    'if hook ~= nil and type(hook.add) == \'function\' then',
    '\thook.add(\'start.selectScreen.teamMenu\', \'queueteam\', function(side, t, params)',
    '\t\tlocal ok, err = pcall(queueTeamMenu, side, t, params)',
    '\t\tif not ok then print(\'[online] match mode not applied: \' .. tostring(err)) end',
    '\tend)',
    'end',
    '',
  ].join('\n');
}

module.exports = { MODES, LABELS, SIZES, normalize, toRoster, handlerSet, handlerClear, hookLua };
