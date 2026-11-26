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
//    skips the team menu by itself (start.f_teamMenu). Room-code matches
//    (HOST / JOIN) never set it and keep the engine's Single only.
// Both players run the same build, so both apply the same mode.
//
// THE LOBBY'S MATCH MODE (2026-11-24). A winner-stays
// LOBBY plays one mode too, set once by its creator on the game page's Create
// form, whose default is this same setting (lobbyMode below: the export writes
// it into the page as IKEMEN_BRAND.matchMode). The lobby server sends every
// member the lobby's mode, and the online mod (lobbyLua) sets main.queueTeam
// to it around each lobby match (main.f_lobbyPlay), asking the page through
// netLobby('mode'), so the hook below applies it exactly as for the queues.
// Both players' pages read the same lobby, so both apply the same mode; a page
// that cannot play modes is kept out of a team-mode lobby by the server.
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

// The lobby form's default, as the game page reads it (IKEMEN_BRAND.matchMode
// and the lobby server's wire): 'single', or the mode and size run together,
// 'simul3', 'tag2', 'turns4'.
function lobbyMode(v) {
  const q = normalize(v);
  return q.mode === 'single' ? 'single' : q.mode + q.size;
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

// The VERSUS 2P pick in both queue handlers (the same depth as handlerSet).
// The modern-input engine's VERSUS 2P turns on versus results: a rematch menu
// after the victory screen, which would hold a match inside game() where the
// ranked set's start.exit cannot end it, so each match is not one result. Its
// Esc opens a pause menu. A queue match takes neither: after the pick both are
// off (with no pause menu, Esc by either player ends the match for both, and
// an unfinished match is never reported). The engine before modern-input has
// neither, so v2 false gives the line unchanged.
const VERSUS_PICK = "\t\t\t\tlocal versus = main.t_itemname.netplayversus({{itemname = 'netplayversus', displayname = 'VERSUS 2P'}}, 1)";
function versusPick(v2) {
  if (!v2) return VERSUS_PICK;
  return [
    VERSUS_PICK,
    '\t\t\t\t-- one match, one result: no rematch menu, no pause menu',
    '\t\t\t\tmain.versusResults = false',
    '\t\t\t\tmain.pauseMenu = false',
  ].join('\n');
}

// The select-screen hook, for the online mod. Plain Lua, no backtick, no ${.
function hookLua() {
  return [
    '-- THE MATCH MODE OF CASUAL AND RANKED (the Studio\'s Online tab, Match mode).',
    '-- A queue match sets main.queueTeam around its VERSUS. While it names a team',
    '-- mode, the team menu is that one mode at that size for both sides, and with',
    '-- one mode at a fixed size the engine skips the menu (start.f_teamMenu).',
    '-- Room-code matches (HOST/JOIN) never set it; a lobby match sets it to the',
    '-- lobby\'s mode (below).',
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
    '\t-- a lobby match\'s first-to-N rounds (the page\'s dev switch, netLobby',
    '\t-- \'rounds\'), which main.f_lobbyPlay gives Single only',
    '\tlocal rounds = tonumber(q.rounds)',
    '\tif rounds ~= nil and rounds >= 1 and type(main.matchWins) == \'table\' and main.matchWins[q.mode] ~= nil then',
    '\t\tmain.matchWins[q.mode] = {rounds, rounds}',
    '\tend',
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

// The lobby's match mode, for the online mod, after hookLua. Plain Lua, no
// backtick, no ${. main.f_lobbyPlay (the engine's main.lua, a global) plays
// one lobby match: this wraps it so main.queueTeam is the lobby's mode while
// it runs. The page answers netLobby('mode') with the mode the lobby server
// reports ('single', 'simul3'...), taken when the engine took the match; an
// older page answers '' (1 vs 1), and the lobby server never lets such a page
// into a team-mode lobby. An engine without lobbies has no main.f_lobbyPlay:
// nothing is wrapped.
function lobbyLua() {
  return [
    '-- THE LOBBY\'S MATCH MODE (the game page\'s lobby Create form; its default is',
    '-- the Studio\'s Match mode). Each lobby match asks the page for the mode the',
    '-- lobby server reports and sets main.queueTeam to it, so the hook above',
    '-- makes both sides\' team menu that one mode at that size, as in the queues.',
    '-- Both players\' pages read the same lobby, so both set the same mode.',
    'local function lobbyTeam()',
    '\tlocal ok, v = pcall(netLobby, \'mode\', \'\')',
    '\tif not ok or type(v) ~= \'string\' then return nil end',
    '\tlocal mode, size = v:match(\'^(%a+)([234])$\')',
    '\tif mode ~= \'simul\' and mode ~= \'tag\' and mode ~= \'turns\' then return nil end',
    '\tlocal okr, r = pcall(netLobby, \'rounds\', \'\')',
    '\treturn {mode = mode, size = tonumber(size), rounds = okr and tonumber(r) or nil}',
    'end',
    'if type(main.f_lobbyPlay) == \'function\' and type(netLobby) == \'function\' then',
    '\tlocal lobbyPlay = main.f_lobbyPlay',
    '\t-- the mode is cleared when the match returns. No pcall on purpose: a',
    '\t-- raise ends the game (nothing above main.f_lobbyPlay catches it), and a',
    '\t-- pcall would drop the engine\'s Go stack from the crash report.',
    '\tlocal function lobbyDone(...)',
    '\t\tmain.queueTeam = nil',
    '\t\treturn ...',
    '\tend',
    '\tmain.f_lobbyPlay = function(...)',
    '\t\tmain.queueTeam = lobbyTeam()',
    '\t\tprint(\'[online] lobby match: \' .. (main.queueTeam ~= nil and (main.queueTeam.mode .. \', \' .. main.queueTeam.size .. \' a side\') or \'1 vs 1\'))',
    '\t\treturn lobbyDone(lobbyPlay(...))',
    '\tend',
    'end',
    '',
  ].join('\n');
}

module.exports = { MODES, LABELS, SIZES, normalize, toRoster, lobbyMode, handlerSet, handlerClear, versusPick, hookLua, lobbyLua };
