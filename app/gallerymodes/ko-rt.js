'use strict';
//
// THE KO MODE'S RUNTIME (gallerymodes/ko.js requires it): the trim, the hook
// lines and the Lua chunk that play a KO step - a scene of his that comes
// only with her KO, her life low or the match over.
//
// THE DATA (what a KO step carries; ko.js builds it). A KO step is an H step
// of his (its `ext` 'ko') whose path has one or more GATE actions: an action
// with `ko: { life, kill, round }`, usually a wait (until, from, patience).
//   life   her life, held there while she is alive (0 up; null: as it is)
//   kill   'none', 'now' (she is KO'd at that life) or 'hit' (his own hit
//          may KO her: her life kept at most `life`, the no KO lifted)
//   round  'live' (untouched), 'freeze' (held at round state 2: nobody wins),
//          'end' (the engine ends the round and the match - his side
//          needs one win - and it stays pinned at round state 4: his win
//          states play) or 'time' (the round ends by the clock with her
//          alive, her life held under his, so he wins it on life; pinned
//          the same way once it is over)
// A kill needs a round that is not 'live' (her KO would start round 2
// mid-scene), and 'end' needs a kill. A TIME OVER holds her life over 0
// with no kill (a KO would end the round first), never his hit's KO; her
// KO under it ('now', the round already over on time) comes only after a
// time over gate of the same step. Anything else drops the step ('a KO the
// hook cannot make'), and so does a KO step with no gate at all. A step
// whose gate kills or holds the round is a LEAF: leaving it, and its replay,
// always go through a reset (she is revived there, or the match runs again).
//
// THE TRIM (trimStep): the step's gates, by action number, on the trimmed
// step as `ko` = [{ i, k, l, r }]: k 0 none / 1 now / 2 hit, l life + 1 (0:
// not held), r 0 live / 1 freeze / 2 end / 3 time. t.modeData.ko counts the steps and
// gates; with no gate the hook gets no line and the script no chunk.
//
// THE HOOK (zss): four maps of the KO mode's own, all 0 outside a KO step,
// so every line is inert then:
//   _gal_ko_m  both of the pair: the kill (k)
//   _gal_ko_l  her: her life + 1 (l); the core's refill waits while it is set
//   _gal_ko_r  both: the round (r)
//   _gal_ko_v  her: revive her
// The kill is ModifyPlayer alive 0 on her, at the held life: the engine's
// round reads her alive alone (roundEndDecision), and a MUGEN giver's own
// NoKO is global (AssertSpecial noko on a MUGEN character sets GlobalNoKO),
// so a KO left to the engine would wait for every NoKO of his to lapse. So
// the core's GlobalNoKO stays on for every step but a 'hit' one (the noKo
// gate), and nobody else is ever KO'd. No KO sound and no KO slow motion
// while a kill is on (NoKOSnd, NoKOSlow: the owner's defaults). 'freeze' is
// RoundFreeze while the round is at 2 (the round's step never runs, so
// nobody wins and the timer waits); 'end' is RoundNotOver, RoundNotSkip,
// NoKOSlow, SkipKODisplay, SkipWinDisplay, NoWinIconDisplay and
// PostRoundInput every frame (the round's end holds no input back from the
// commands his win states read); 'time' the same, but only once the round
// is past 2 (before, nothing may keep the clock's end from ending it).
//
// THE DRIVER (lua: one chunk, MODE.add('ko'), no top-level local). Per pair
// on screen, every tick (the frame hook for every pair, the tick hook after
// its drive): a gate ARMS once the step's path is at or past its action and
// he stands in one of its `from` states (no `from`: at once) and she in one
// of its `herIn` (`hin`; none: anywhere), and stays armed
// for that run of the step; the latest armed gate writes the maps. An 'end'
// gate sets his side's wins to one as it arms; a 'time' gate with no kill
// also puts the round's clock at 0 (setTime: the engine decides a round on
// time whenever its clock reads 0, a round with no limit too, by each
// side's life, so her held life loses it to his). She is read dead (alive 0)
// under a kill: latched until the step is left. Leaving it (a reset, or the
// step changed): she was killed with the round frozen -> revived in place
// (_gal_ko_v until she reads alive, the freeze kept till then; not alive in
// 60 ticks -> the match again); the round was ended -> the match again
// (reload 'again': the same pairs, kept); else the maps go back to 0 and the
// refill gives her life back. A step started over in place after her KO is
// grabbed again (a reset). While an ended round runs (round state 3 or 4) the
// pair's driver stays live, and she counts as in his scene in act and show
// (she may lie in her own 5150 between his KO scene and his win state). A
// match that ends by itself while she is KO'd (a pin that did not hold) is
// played again rather than leaving the gallery.
// KO steps play with ONE pair on screen: with several, a KO step stops with
// 'KO scenes play with one pair on screen' (GlobalNoKO, the freeze and the
// pin are the whole match's). A hook of this mode that errors puts every map
// back to 0 (a pair she died in plays its match again) and stops KO steps
// with a note.
// A KO STEP LOADED AGAIN (its replay after the round ended, or a move from
// one KO step to another) plays at its own pace: the reload's fast run is
// skipped for it (the intros are still cut). The fast run plays a step
// until it shows and only then slows down - a KO step's scene comes at the
// end of its path and ends soon after, so it would only ever be seen at
// speed, and asking for the match again at once looped.
// The log (-hgallerylog; tools/test-gallery-ko.js reads it) says each
// change, with the match frame (f=): 'ko: armed <what> his=<state>', 'ko:
// she is KO'd (round state <n>, matchover <b>)', then each 'ko: round state
// <n> ...' and 'ko: his state <n>' while she is, 'ko: shown (her life <n>,
// alive <b>, round state <n>, matchover <b>)' when a KO step shows, 'ko:
// revived', 'ko: the round ended - the match again', 'ko: at its own pace'
// (the fast run skipped), and once after a revive or a match played again,
// as the next step's path starts (before a gate of its own arms), 'ko: after
// <the revive|the match again>: the next step starts (round state <n>, her
// alive <b>, life <n> of <max>)'.

const KILL = { none: 0, now: 1, hit: 2 };
const ROUND = { live: 0, freeze: 1, end: 2, time: 3 };
const LIFE_TOP = 99999;
const BAD = 'a KO the hook cannot make';

// One gate's runtime numbers, or { bad }.
function gateOf(ko) {
  if (!ko || typeof ko !== 'object' || Array.isArray(ko)) return { bad: BAD };
  const kill = ko.kill == null ? 'none' : ko.kill;
  const round = ko.round == null ? 'live' : ko.round;
  if (!Object.prototype.hasOwnProperty.call(KILL, kill) || !Object.prototype.hasOwnProperty.call(ROUND, round)) return { bad: BAD };
  let life = ko.life;
  if (life == null && kill !== 'none') life = kill === 'hit' ? 1 : 0;
  if (life != null && !(Number.isInteger(life) && life >= 0 && life <= LIFE_TOP)) return { bad: BAD };
  const k = KILL[kill], r = ROUND[round];
  // Her KO with the round live would start the next round mid-scene; an
  // ended round with nobody KO'd never ends.
  if (k > 0 && r === 0) return { bad: BAD + ' (a KO with the round live)' };
  if (r === 2 && k === 0) return { bad: BAD + ' (an ended round with no KO)' };
  if (life == null && k === 0 && r === 0) return { bad: BAD + ' (a gate that holds nothing)' };
  // A time over: her life held over 0 (no life held, or none, and a KO
  // would decide the round before the clock does); never his hit's KO.
  if (r === 3 && k === 0 && (life == null || life < 1)) return { bad: BAD + ' (a time over with her life not held over 0)' };
  if (r === 3 && k === 2) return { bad: BAD + ' (his hit\'s KO under a time over)' };
  return { k, l: life == null ? 0 : life + 1, r };
}

// A KO action tagged with the mode (`ext: 'ko'`): its gate only checked here
// (trimStep reads it, with the untagged ones). An after-the-match action's
// `herOn` (her states while his own states play the scene: ko-data.js) is
// what the runtime waits for, in place of its `until` (what she shows of
// it, the judging's).
const HER_ON_MAX = 64;
function trimAction(a, out) {
  if (a && a.ko != null) {
    const g = gateOf(a.ko);
    if (g.bad) return { bad: g.bad };
  }
  if (a && a.herOn != null) {
    const list = Array.isArray(a.herOn) ? a.herOn : [];
    if (!list.length || list.length > HER_ON_MAX || !list.every((n) => Number.isInteger(n) && n >= 0 && n <= 2147483647)) return { bad: 'her states on his scene the hook cannot wait for' };
    if (out && typeof out === 'object') out.show = [...new Set(list)];
  }
  // `herIn`: the states of hers the KO arms in (his win reads her previous
  // state: Minotaur's 180 plays his scene only after 1699 / 1899), as `hin`.
  if (a && a.herIn != null) {
    const list = Array.isArray(a.herIn) ? a.herIn : [];
    if (!list.length || list.length > HER_ON_MAX || !list.every((n) => Number.isInteger(n) && n >= 0 && n <= 2147483647)) return { bad: 'her states the KO arms in that the hook cannot read' };
    if (out && typeof out === 'object') out.hin = [...new Set(list)];
  }
  return null;
}

// A KO step: its gates by action number (1-based, as the runtime's path).
function trimStep(s, out, T) {
  const path = s && Array.isArray(s.path) ? s.path : [];
  const gates = [];
  for (let i = 0; i < path.length; i++) {
    const a = path[i];
    if (!a || typeof a !== 'object' || a.ko == null) continue;
    const g = gateOf(a.ko);
    if (g.bad) return { bad: g.bad };
    // (Her KO under a time over: only after the time over itself.)
    if (g.r === 3 && g.k > 0 && !gates.some((x) => x.r === 3 && x.k === 0)) return { bad: BAD + ' (her KO under a time over before the time over)' };
    gates.push({ i: i + 1, k: g.k, l: g.l, r: g.r });
  }
  if (!gates.length) return { bad: 'a KO step with no KO gate' };
  out.ko = gates;
  if (gates.some((g) => g.k > 0 || g.r > 0)) out.leaf = true;
  const D = T && typeof T.data === 'function' ? T.data() : null;
  if (D) {
    D.steps = (D.steps || 0) + 1;
    D.gates = (D.gates || 0) + gates.length;
    if (gates.some((g) => g.k === 2)) D.hit = true;
  }
  return null;
}

// The hook's lines (inside the roots' -4 block) and the core lines it gates.
function zss(t) {
  const D = (t && t.modeData && t.modeData.ko) || {};
  if (!D.gates) return {};
  const m4 = [
    '\t# KO steps: inert while these maps are 0 (gallerymodes/ko-rt.js has the rules).',
    '\t# _gal_ko_m (both) the kill: 1 now, 2 his hit may KO her; _gal_ko_l (her) her',
    '\t# life + 1, held (the refill above waits); _gal_ko_r (both) the round: 1 frozen',
    '\t# at 2, 2 over and pinned at 4, 3 over on time (pinned once past 2); _gal_ko_v',
    '\t# (her) revive her.',
    '\tif map(_gal_ko_v) {',
    '\t\tlifeSet{value: lifeMax}',
    '\t\tmodifyPlayer{alive: 1}',
    '\t}',
    '\tif map(_gal_ko_l) > 0 && !map(_gal_ko_v) && alive {',
    '\t\tif map(_gal_ko_m) != 2 && life != map(_gal_ko_l) - 1 {',
    '\t\t\tlifeSet{value: map(_gal_ko_l) - 1}',
    '\t\t}',
    '\t\tif map(_gal_ko_m) = 2 && life > map(_gal_ko_l) - 1 {',
    '\t\t\tlifeSet{value: map(_gal_ko_l) - 1}',
    '\t\t}',
    '\t\t# (The KO itself: the round reads her alive, and no NoKO can hold it off.)',
    '\t\tif map(_gal_ko_m) = 1 && life <= map(_gal_ko_l) - 1 {',
    '\t\t\tmodifyPlayer{alive: 0}',
    '\t\t}',
    '\t}',
    '\tif map(_gal_ko_r) = 1 && roundState = 2 {',
    '\t\tassertSpecial{flag: roundFreeze}',
    '\t}',
    '\t# (3, a time over: the same once the round is past 2 - before, nothing',
    '\t# may keep the clock\'s end from ending it.)',
    '\tif map(_gal_ko_r) = 2 || (map(_gal_ko_r) = 3 && roundState >= 3) {',
    '\t\tassertSpecial{flag: roundNotOver; flag2: roundNotSkip; flag3: noKoSlow}',
    '\t\tassertSpecial{flag: skipKoDisplay; flag2: skipWinDisplay; flag3: noWinIconDisplay}',
    '\t\tassertSpecial{flag: postRoundInput}',
    '\t}',
    '\tif map(_gal_ko_m) > 0 {',
    '\t\tassertSpecial{flag: noKoSnd; flag2: noKoSlow}',
    '\t}',
  ];
  const gates = { refill: 'map(_gal_ko_l) = 0' };
  // Only a build with a 'hit' gate lifts the no KO (his own hit KOs her).
  if (D.hit) gates.noKo = 'map(_gal_ko_m) != 2';
  return { m4, gates };
}

// The driver's chunk. Plain ASCII, no backslash; its locals are its own
// function's (MODE.add), never the main chunk's.
const LUA = `-- KO MODE (gallerymodes/ko.js; its runtime and rules: gallerymodes/ko-rt.js).
-- A KO step's gates (s.ko: { i, k, l, r } by action number) arm once the
-- path is at or past the gate's action, he stands in its from states and
-- she in its hin states (her previous state his win reads); the
-- latest armed one writes the hook's _gal_ko_ maps. Leaving a step she died
-- in revives her in place (round frozen) or plays the match again (round over).
MODE.add('ko', function()
  local M = {}
  local KEYS = { '_gal_ko_m', '_gal_ko_l', '_gal_ko_r', '_gal_ko_v' }
  -- Per pair on screen (its place): the gates armed in this run of its step
  -- (armed), she was KO'd (dead, deadR: the round then), the round ended or
  -- his wins set (over), the first latched gate (at), a reload asked
  -- (reload), a revive under way (rev), the round state last told (rs), the
  -- maps last written (w).
  local S = {}
  local broken = false
  -- (For the log: a revive or a match played again, until the next step
  -- shows after it.)
  local PEND = nil
  local function stamp() return ' f=' .. MATCH.f end
  local function slot()
    local x = S[G.k]
    if x == nil then x = { armed = {}, w = {} }; S[G.k] = x end
    return x
  end
  local function put(x, pn, key, v)
    if x.w[pn .. key] ~= v then x.w[pn .. key] = v; mset(pn, key, v) end
  end
  local function maps(x, m, l, r, v)
    put(x, GIVER, '_gal_ko_m', m); put(x, RECV, '_gal_ko_m', m)
    put(x, GIVER, '_gal_ko_r', r); put(x, RECV, '_gal_ko_r', r)
    put(x, RECV, '_gal_ko_l', l); put(x, RECV, '_gal_ko_v', v)
  end
  -- (Every fighter that may be loaded: a kept character's maps outlive its
  -- match.)
  local function zero()
    for pn = 1, 2 * MAX_SLOTS do for _, key in ipairs(KEYS) do mset(pn, key, 0) end end
  end
  local function herAlive() return onR(function() return alive() end) end
  local function herLife() return onR(function() return life() end) end
  local function says(g)
    local t = g.l > 0 and ('life ' .. (g.l - 1)) or 'life as it is'
    if g.k == 1 then t = t .. ', KO' elseif g.k == 2 then t = t .. ', KO by his hit' end
    if g.r == 1 then t = t .. ', round frozen' elseif g.r == 2 then t = t .. ', round over' elseif g.r == 3 then t = t .. ', round over on time' end
    return t
  end
  -- (The log, after her KO: each round state, and each state of his - the
  -- win states an ended round plays.)
  local function told(x)
    if not LOG then return end
    local rs = roundState()
    if rs ~= x.rs then
      x.rs = rs
      log('ko: round state ' .. rs .. ', matchover ' .. tostring(matchOver()) .. ', her alive ' .. tostring(herAlive()) .. stamp())
    end
    local h = giverState()
    if h ~= x.his then x.his = h; log('ko: his state ' .. h .. stamp()) end
  end
  -- Her KO's step left: the match again (the round ended), else revived in
  -- place, the freeze kept until she reads alive.
  local function leave(x)
    if x.over then
      x.reload = true
      log('ko: the round ended - the match again' .. stamp())
      PEND = 'the match again'
      -- (The pin stays until the match ends; no kill is left to the next.)
      maps(x, 0, 0, 2, 0)
      reload({ what = 'again' })
      return
    end
    if x.rev == nil then x.rev = 0 end
    x.rev = x.rev + 1
    maps(x, 0, 0, x.deadR or 1, 1)
    if herAlive() == true then
      x.dead, x.deadR, x.at, x.rev = false, nil, nil, nil
      maps(x, 0, 0, 0, 0)
      log('ko: revived' .. stamp())
      PEND = 'the revive'
    elseif x.rev > 60 then
      log('ko: she is not revived - the match again')
      x.over = true
    end
  end
  -- This pair's KO step, one tick.
  local function upd()
    local x = slot()
    if x.reload then return end
    -- (The next step, once its path starts after a revive or a match played
    -- again - before any gate of its own arms.)
    if PEND and (G.phase == 'act' or G.phase == 'show') then
      log('ko: after ' .. PEND .. ': the next step starts (round state ' .. roundState() .. ', her alive ' .. tostring(herAlive()) .. ', life ' .. tostring(herLife())
        .. ' of ' .. tostring(onR(function() return lifeMax() end)) .. ')' .. stamp())
      PEND = nil
    end
    local s = curStep()
    if not (s and s.ext == 'ko' and s.ko) then s = nil end
    local key = G.pi .. ':' .. G.si
    if x.key ~= key then x.key, x.armed = key, {} end
    local on = s ~= nil and NSLOT == 1 and not broken and (G.phase == 'act' or G.phase == 'show')
    -- (A KO step showing, once each time: what the gate made of her.)
    if on and G.phase == 'show' then
      if not x.told then
        x.told = true
        log('ko: shown (her life ' .. tostring(herLife()) .. ', alive ' .. tostring(herAlive()) .. ', round state ' .. roundState() .. ', matchover ' .. tostring(matchOver()) .. ')' .. stamp())
      end
    else
      x.told = false
    end
    -- (Started over in place after her KO: grabbed again - the reset's own
    -- hook then revives her or plays the match again.)
    if on and (x.dead or x.over) and G.phase == 'act' and G.ai < (x.at or 1) then
      log('ko: started over after her KO - grabbing again')
      return begin('reset')
    end
    if not on then
      x.armed = {}
      if x.dead or x.over then return leave(x) end
      return maps(x, 0, 0, 0, 0)
    end
    local path, cur = pathOf(s), nil
    local upto = G.phase == 'show' and #path or G.ai
    for _, g in ipairs(s.ko) do
      if g.i > upto then
        x.armed[g.i] = nil
      elseif not x.armed[g.i] then
        local a = path[g.i]
        if a and (a.from == nil or member(giverState(), a.from)) and (a.hin == nil or member(recvState(), a.hin)) then
          x.armed[g.i] = true
          log('ko: armed ' .. says(g) .. ' his=' .. giverState() .. stamp())
          if (g.r == 2 or g.r == 3) and not x.over then
            setMatchWins(1, 1)
            x.over, x.at = true, x.at or g.i
          end
          -- (A time over: the round's clock to 0 - the engine decides the
          -- round on time, by life, with her held under him.)
          if g.r == 3 and g.k == 0 and roundState() == 2 then
            setTime(0)
            log('ko: the clock at 0 (round state ' .. roundState() .. ', her life ' .. tostring(herLife()) .. ')' .. stamp())
          end
        end
      end
      if x.armed[g.i] then cur = g end
    end
    if cur == nil then
      if not (x.dead or x.over) then maps(x, 0, 0, 0, 0) end
      return
    end
    maps(x, cur.k, cur.l, cur.r, 0)
    if cur.k > 0 and not x.dead and herAlive() == false then
      x.dead, x.deadR, x.at = true, cur.r, x.at or cur.i
      log("ko: she is KO'd (round state " .. roundState() .. ', matchover ' .. tostring(matchOver()) .. ')' .. stamp())
    end
    if x.dead or x.over then told(x) end
  end
  -- An error here: every map back to 0, a pair she died in plays its match
  -- again, and KO steps stop with a note from then on.
  local function guard(f)
    local ok, err = pcall(f)
    if ok then return end
    print('H gallery: KO mode: ' .. tostring(err))
    broken = true
    pcall(zero)
    for _, x in pairs(S) do
      if (x.dead or x.over) and not x.reload then x.reload = true; pcall(reload, { what = 'again' }) end
    end
  end
  -- A new match: every map at 0 (on the characters still loaded before it
  -- starts, and again on its first tick), nothing latched.
  local seen = nil
  local function fresh()
    if seen ~= MATCH then seen = MATCH; S = {}; guard(zero) end
  end
  -- A KO step loaded again (one pair): at its own pace, no fast run (the
  -- intros are still cut).
  function M.match()
    S = {}
    guard(zero)
    local g = SLOTS[1]
    local p = g and DATA.pairs[g.pi]
    local s = p and p.steps[g.si]
    if NSLOT == 1 and s and s.ext == 'ko' and s.ko and MATCH.speed and not MATCH.restored then
      MATCH.restored = true
      if LOG then print('[hgallery] ko: at its own pace (scene ' .. g.si .. ', no fast run)') end
    end
  end
  -- Every tick, every pair: its gates (and a left KO step's revive or reload).
  function M.frame()
    fresh()
    for k = 1, NSLOT do useSlot(k); guard(upd) end
    useSlot(SEL)
  end
  -- The pair's own tick, after its drive (the gate arms the tick he gets there).
  function M.tick(s)
    fresh()
    guard(function()
      if s and s.ext == 'ko' and G.phase ~= 'stuck' and G.phase ~= 'idle' and (NSLOT > 1 or broken) then
        G.note = broken and 'the KO mode failed' or 'KO scenes play with one pair on screen'
        begin('stuck')
      end
      upd()
    end)
  end
  function M.reset() fresh(); guard(upd) end
  -- An ended round's pair keeps its driver, and she counts as in his scene.
  function M.live()
    local x = S[G.k]
    return x ~= nil and x.over == true and not x.reload
  end
  function M.inScene()
    local x = S[G.k]
    return x ~= nil and x.over == true and not x.reload and roundState() >= 3 and (G.phase == 'act' or G.phase == 'show')
  end
  -- A match that ended by itself while she was KO'd (a pin that did not
  -- hold): played again rather than leaving the gallery.
  function M.after()
    for _, x in pairs(S) do
      if (x.dead or x.over) and not x.reload then return { what = 'again' } end
    end
    return nil
  end
  -- (A gate action tagged with the mode: a wait, its until and patience the
  -- driver's own.)
  function M.act() return nil end
  function M.status(a)
    if a then return 'waiting for it...' end
    local x = S[G.k]
    if x and x.rev then return 'reviving her...' end
    if x and x.reload then return 'the match again...' end
    return nil
  end
  return M
end)`;

function lua(t) {
  const D = (t && t.modeData && t.modeData.ko) || {};
  return D.steps ? LUA : '';
}

// (ko.js carries every one of these on the mode's module.)
module.exports = { trimStep, trimAction, zss, lua, gateOf };
