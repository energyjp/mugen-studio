-- Frame Meter: a training-mode overlay for Ikemen GO (read-only)
--
--   F7   show / hide the meter (Training mode; it starts shown)
--
-- Two rows of per-frame cells near the bottom of the fight screen (top row
-- P1, bottom row P2), colored by what each character is doing on that game
-- tick, plus the startup of P1's latest attack and the frame advantage once
-- both characters can act again. README.md lists the colors and the rules.
--
-- It only READS the characters: no state changes, no variables, no input
-- remaps. Install: copy this file into <Ikemen GO>/external/mods/ (the engine
-- loads every .lua there at startup). Remove: delete the file.
--
-- Test hooks (harmless in normal use):
--   framebarForce = true   run in every game mode, not only Training
--   framebarLog = true     print one 'FRAMEBAR ...' line per finished sequence
--   framebarLast           table describing the last finished sequence

----------------------------------------------------------------------------
-- Settings
----------------------------------------------------------------------------
local FB_CELLS = 80      -- frames shown per row (a longer sequence scrolls)
local FB_KEEP = 600      -- frames kept per sequence for framebarLast and the log
local FB_TOP = 184       -- panel top edge, in 320x240 fight units
-- A tick where BOTH characters are frozen (shared hitstop, super freeze) is
-- never recorded. When only ONE side is frozen (a projectile or helper hit
-- shakes the defender while the attacker keeps moving, or an older character's
-- one-frame-shorter attacker pause), false records the tick for both rows so
-- the attacker's frames and the advantage stay exact; true drops it.
local FB_SKIP_ONE_SIDED_FREEZE = false

----------------------------------------------------------------------------
-- Categories and colors
----------------------------------------------------------------------------
local IDLE, STARTUP, ACTIVE, RECOVERY, HITSTUN, BLOCKSTUN, MOVEMENT = 0, 1, 2, 3, 4, 5, 6
local CAT_NAME = { [0] = 'idle', 'startup', 'active', 'recovery', 'hitstun', 'blockstun', 'movement' }
local CAT_CHAR = { [0] = '.', 'S', 'A', 'R', 'H', 'B', 'M' }
local CAT_RGB = {
  [STARTUP]   = { 64, 214, 104 },  -- green
  [ACTIVE]    = { 240, 60, 84 },   -- red
  [RECOVERY]  = { 52, 128, 240 },  -- blue
  [HITSTUN]   = { 250, 190, 40 },  -- amber
  [BLOCKSTUN] = { 96, 222, 236 },  -- cyan
  [MOVEMENT]  = { 132, 146, 172 }, -- gray-blue
}
local DARK = 0.66                  -- every 5th frame is drawn this much darker

----------------------------------------------------------------------------
-- State
----------------------------------------------------------------------------
local fb = {
  visible = true,   -- F7
  fresh = false,    -- already reset for the current round intro
  lastGt = nil,     -- gameTime() of the last sample
  seq = false,      -- a sequence is being recorded
  len = 0,          -- frames in the current (or last) sequence
  textDirty = true, -- numbers changed since the texts were last set
  startup = nil, advantage = nil, total = nil,
}
local cells = { {}, {} }          -- per row: FB_KEEP-slot ring of category codes
local S = { {}, {} }              -- this tick's readings, reused every tick
local T = { {}, {} }              -- per-player trackers

local function fbSlot(k) return (k - 1) % FB_KEEP + 1 end

local function fbResetTracker(t)
  t.valid = false     -- pst/ptm/pshake/php hold a previous sample
  t.pst, t.ptm, t.pshake, t.pproj = 0, 0, 0, 0
  t.php = 0           -- hitPauseTime() of the previous sample
  t.rst, t.rtm = 0, 0 -- stateNo/time of the last RECORDED frame
  t.inMove = false    -- inside a moveType A run
  t.moveStart = 0     -- sequence frame the current attack started on
  t.hadActive = false -- the current attack has shown an active frame
  t.family = 0        -- stateno family (stateno minus its last digit)
  t.pending = false   -- a state change after the active frames that may be a cancel
  t.pendStart = 0
  t.afterAttack = false
  t.first, t.last = nil, nil  -- first/last non-idle frame of the sequence
  t.attacked = false
  t.seqStartup = nil
end
fbResetTracker(T[1])
fbResetTracker(T[2])

local function fbReset()
  fb.fresh = true
  fb.lastGt = nil
  fb.seq = false
  fb.len = 0
  fb.startup, fb.advantage, fb.total = nil, nil, nil
  fb.textDirty = true
  fbResetTracker(T[1])
  fbResetTracker(T[2])
end

local function fbAllowed()
  if framebarForce == true then return true end
  return gameMode() == 'training' and not connected()
end

----------------------------------------------------------------------------
-- Reading a character (the working character set by player(n))
----------------------------------------------------------------------------
local function fbRead(s)
  local mt = moveType()
  s.mt = mt
  s.ctrl = ctrl()
  s.st = stateNo()
  s.tm = time()
  s.hp = hitPauseTime()
  s.shake = getHitVar('hitshaketime')
  s.proj = numProj()
  -- HELPERS. A fireball, a thrown weapon or a summoned attack is often a
  -- helper with its own HitDef rather than a Projectile controller (the CvS
  -- Ryu's Hadouken is one), and numProj() never sees those. So every helper of
  -- this character is read too: one in an attack state with a hitbox out is
  -- this character's attack on screen. helperIndex(k) walks the helpers the
  -- character created (and theirs), 1-based; helperIndexExist(k) is checked
  -- first because helperIndex warns on the console for a missing one
  -- (char.go helperIndexTrigger). Both exist in stock Ikemen GO 1.0.0.
  s.hhit = false
  local nh = numHelper()
  if nh > 0 then
    local rid = id()
    for k = 1, nh do
      if helperIndexExist(k) and helperIndex(k) then
        if moveType() == 'A' then
          local hb = clsnVar('clsn1', 0, 'back')
          if hb == hb then s.hhit = true end
        end
        playerId(rid)
        if s.hhit then break end
      end
    end
  end
  if mt == 'A' then
    -- NaN when the displayed frame has no Clsn1 box (NaN ~= NaN)
    local b = clsnVar('clsn1', 0, 'back')
    s.clsn1 = (b == b)
  else
    s.clsn1 = false
  end
  if mt == 'H' then
    local st = s.st
    s.guard = (st >= 150 and st <= 155) or getHitVar('guarded') == true
  else
    s.guard = false
  end
end

-- Frozen this tick: the character was in hitpause, its state did not run
-- (Pause/SuperPause), or it is in hitshake (its state runs, but it is held in
-- place). hitPauseTime and hitshaketime are read from the PREVIOUS sample: a
-- tick is frozen when the counter was still positive when that tick began.
-- The hitpause test comes first because a ChangeState with ignorehitpause
-- can move the character to a new state (time 0) while it is still frozen,
-- which the state/time test alone would count as a moving frame.
local function fbFrozen(s, t)
  if t.php > 0 then return true end
  if s.st == t.pst and s.tm == t.ptm then return true end
  return s.mt == 'H' and t.pshake > 0
end

local function fbCommit(s, t)
  t.pst, t.ptm, t.pshake, t.php = s.st, s.tm, s.shake, s.hp
  t.valid = true
end

-- One recorded frame for one player: returns its category and keeps the
-- attack trackers. row = 1 or 2, idx = sequence frame number.
local function fbCategorize(s, t, idx, row)
  local mt = s.mt
  -- Compare against the last recorded frame, not the last sample: a state
  -- change that happened during a skipped (frozen) tick still counts.
  local rst, rtm = t.rst, t.rtm
  t.rst, t.rtm = s.st, s.tm
  if mt == 'A' then
    t.afterAttack = true
    t.attacked = true
    local st = s.st
    local fam = st - st % 10
    if not t.inMove then
      t.inMove, t.moveStart, t.hadActive, t.pending, t.family = true, idx, false, false, fam
    elseif st ~= rst or s.tm < rtm then
      if not t.hadActive then
        t.family = fam               -- still starting up: follow its sub-states
      elseif not t.pending and (fam ~= t.family or st == rst) then
        -- After the active frames the state changed to another family (or the
        -- same state started over): a cancel if a new active frame follows.
        t.pending, t.pendStart = true, idx
      end
    end
    if s.clsn1 or s.proj > t.pproj or (s.hhit and not t.phhit) then
      if t.pending then
        -- It was a cancel: the frames since the state change were startup.
        local rowCells = cells[row]
        for k = t.pendStart, idx - 1 do
          if k > idx - FB_KEEP then rowCells[fbSlot(k)] = STARTUP end
        end
        t.moveStart, t.pending, t.hadActive, t.family = t.pendStart, false, false, fam
      end
      if not t.hadActive then
        t.hadActive = true
        t.seqStartup = idx - t.moveStart + 1
        if row == 1 then fb.startup = t.seqStartup; fb.textDirty = true end
      end
      return ACTIVE
    end
    if t.hadActive then return RECOVERY end
    return STARTUP
  end
  t.inMove, t.pending = false, false
  if mt == 'H' then
    t.afterAttack = false
    -- Control can come back before the get-hit state ends (a HitDef whose
    -- guard control time is shorter than its guard hit time, or an air
    -- block still falling): the character can already act.
    if s.ctrl then return IDLE end
    if s.guard then return BLOCKSTUN end
    return HITSTUN
  end
  if s.ctrl then
    t.afterAttack = false
    return IDLE
  end
  if t.afterAttack then return RECOVERY end
  return MOVEMENT
end

-- THE HAND-BACK FRAME. Control that comes back during a tick came back in the
-- character's own state code, and the engine reads commands (state -1) BEFORE
-- the current state every tick (char.go:12083-12087 against :12097): nothing
-- can start on that tick. So the first free-looking frame after a busy one is
-- still busy - drawn as what came before it - and the character acts on the
-- next frame, which is how fighting-game frame data counts (KFM's jab: 12
-- ticks in its state, control back on frame 13, next move on frame 14 - total
-- 13). Both sides follow the same rule, so the advantage does not move.
local function fbCategorizeFGC(s, t, idx, row)
  local c = fbCategorize(s, t, idx, row)
  local real = c
  if c == IDLE and t.prevReal and t.prevReal ~= IDLE then
    c = t.prevReal == ACTIVE and RECOVERY or t.prevReal
  end
  t.prevReal = real
  return c
end

----------------------------------------------------------------------------
-- Sequences
----------------------------------------------------------------------------
local function fbStartSequence()
  fb.seq = true
  fb.len = 0
  -- The numbers stay until this sequence has something to replace them with
  -- (an attack, a hit or a block): a dash or a landing alone keeps them.
  fb.newNums = false
  fb.contact = false
  for i = 1, 2 do
    local t = T[i]
    t.first, t.last, t.attacked, t.seqStartup = nil, nil, false, nil
  end
end

local function fbNum(n)
  if n == nil then return '-' end
  return string.format('%d', n)
end

local function fbSigned(n)
  if n == nil then return '-' end
  if n > 0 then return '+' .. string.format('%d', n) end
  return string.format('%d', n)
end

local function fbEndSequence()
  fb.seq = false
  local t1, t2 = T[1], T[2]
  -- A side that was free for the whole exchange could act on its first frame.
  local act1 = t1.last and (t1.last + 1) or 1
  local act2 = t2.last and (t2.last + 1) or 1
  if fb.newNums then
    -- Advantage needs something to compare: a hit or a block, or both sides
    -- busy (a whiff alone has no opponent to be ahead of).
    if fb.contact or (t1.last and t2.last) then fb.advantage = act2 - act1 else fb.advantage = nil end
    if t1.attacked and t1.first then fb.total = t1.last - t1.first + 1 end
    fb.textDirty = true
  end

  local len = fb.len
  local from = len - FB_KEEP + 1
  if from < 1 then from = 1 end
  local p1, p2 = {}, {}
  for k = from, len do
    local slot = fbSlot(k)
    p1[#p1 + 1] = CAT_NAME[cells[1][slot]]
    p2[#p2 + 1] = CAT_NAME[cells[2][slot]]
  end
  framebarLast = {
    p1 = p1, p2 = p2,
    startup = t1.seqStartup, p2Startup = t2.seqStartup,
    advantage = fb.advantage, total = fb.total,
    p1Actionable = act1, p2Actionable = act2,
    length = len, offset = from - 1,
  }
  if framebarLog == true then
    local c1, c2 = {}, {}
    for k = from, len do
      local slot = fbSlot(k)
      c1[#c1 + 1] = CAT_CHAR[cells[1][slot]]
      c2[#c2 + 1] = CAT_CHAR[cells[2][slot]]
    end
    print('FRAMEBAR startup=' .. fbNum(t1.seqStartup) .. ' adv=' .. fbSigned(fb.advantage) ..
      ' total=' .. fbNum(fb.total) .. ' p1act=' .. fbNum(act1) .. ' p2act=' .. fbNum(act2) ..
      ' p2startup=' .. fbNum(t2.seqStartup) .. ' len=' .. fbNum(len) ..
      ' p1=' .. table.concat(c1) .. ' p2=' .. table.concat(c2))
  end
end

----------------------------------------------------------------------------
-- One game tick
----------------------------------------------------------------------------
local function fbSample(gt)
  local prevGt = fb.lastGt
  fb.lastGt = gt
  local s1, s2, t1, t2 = S[1], S[2], T[1], T[2]

  local oldid = id()
  local ok = player(1)
  if ok then
    fbRead(s1)
    ok = player(2)
    if ok then fbRead(s2) end
  end
  playerId(oldid)
  if not ok then
    t1.valid, t2.valid = false, false
    return
  end

  -- First sample, or the clock jumped (state load, round reset): just resync.
  local d = prevGt and (gt - prevGt) or 0
  if not (t1.valid and t2.valid) or d < 1 or d > 3 then
    fbCommit(s1, t1); fbCommit(s2, t2)
    t1.pproj, t2.pproj, t1.phhit, t2.phhit = s1.proj, s2.proj, s1.hhit, s2.hhit
    return
  end

  local f1, f2 = fbFrozen(s1, t1), fbFrozen(s2, t2)
  if (f1 and f2) or (FB_SKIP_ONE_SIDED_FREEZE and (f1 or f2)) then
    fbCommit(s1, t1); fbCommit(s2, t2)
    return
  end

  local calm = s1.ctrl and s1.mt ~= 'A' and s2.ctrl and s2.mt ~= 'A'
  if not fb.seq then
    if calm then
      fbCategorizeFGC(s1, t1, 0, 1); fbCategorizeFGC(s2, t2, 0, 2)
      fbCommit(s1, t1); fbCommit(s2, t2)
      t1.pproj, t2.pproj, t1.phhit, t2.phhit = s1.proj, s2.proj, s1.hhit, s2.hhit
      return
    end
    fbStartSequence()
  end

  -- The first frame of an attack, a hit or a block clears the old numbers.
  if not fb.newNums and (s1.mt == 'A' or s2.mt == 'A' or (s1.mt == 'H' and not s1.ctrl) or (s2.mt == 'H' and not s2.ctrl)) then
    fb.newNums = true
    fb.advantage = nil
    if s1.mt == 'A' then fb.startup, fb.total = nil, nil end
    fb.textDirty = true
  end
  local idx = fb.len + 1
  fb.len = idx
  local c1 = fbCategorizeFGC(s1, t1, idx, 1)
  local c2 = fbCategorizeFGC(s2, t2, idx, 2)
  if c1 == HITSTUN or c1 == BLOCKSTUN or c2 == HITSTUN or c2 == BLOCKSTUN then fb.contact = true end
  local slot = fbSlot(idx)
  cells[1][slot], cells[2][slot] = c1, c2
  if c1 ~= IDLE then
    if not t1.first then t1.first = idx end
    t1.last = idx
  end
  if c2 ~= IDLE then
    if not t2.first then t2.first = idx end
    t2.last = idx
  end
  fbCommit(s1, t1); fbCommit(s2, t2)
  t1.pproj, t2.pproj, t1.phhit, t2.phhit = s1.proj, s2.proj, s1.hhit, s2.hhit

  -- Both actionable for one tick: done.
  if calm then fbEndSequence() end
end

----------------------------------------------------------------------------
-- Drawing
----------------------------------------------------------------------------
-- Layout, in 320x240 "fight units" (the in-fight 4:3 band), mapped into the
-- motif's localcoord: during a fight only the central 4:3 band of a
-- widescreen localcoord reaches the screen, so everything is anchored inside
-- it: x = margin + u * k, y = v * k, with bandW = min(W, H*4/3),
-- k = bandW / 320, margin = (W - bandW) / 2. On a 4:3 motif margin = 0.
--   panel      u 6 .. 314,           v FB_TOP .. FB_TOP+27
--   text line  baseline v FB_TOP+8   (startup/total left, title right)
--   P1 row     v FB_TOP+11 .. +17,   P2 row v FB_TOP+19 .. +25
--   cells      u 22 .. 285.3 (FB_CELLS cells, 79% cell / 21% gap)
--   labels     'P1'/'P2' at u 9, advantage at u 290
local G = nil

local function fbBuild()
  local W, H = 320, 240
  local lc = motif and motif.info and motif.info.localcoord
  if lc and tonumber(lc[1]) and tonumber(lc[2]) and lc[1] > 0 and lc[2] > 0 then
    W, H = lc[1], lc[2]
  end
  local bandW = math.min(W, H * 4 / 3)
  local k = bandW / 320
  local mx = (W - bandW) / 2
  local function X(u) return mx + u * k end
  local function Y(v) return v * k end
  G = {}

  -- Rects: localcoord first (the window is stored in it), then the window.
  -- rectDraw queues a COPY of the rect, so one rect can be re-windowed and
  -- drawn many times in a frame.
  local function newRect(r, g, b, a)
    local rc = rectNew()
    rectSetLocalcoord(rc, W, H)
    rectSetColor(rc, r, g, b)
    rectSetAlpha(rc, a, 255 - a)
    return rc
  end
  G.panel = newRect(10, 12, 18, 176)
  rectSetWindow(G.panel, X(6), Y(FB_TOP), X(314), Y(FB_TOP + 27))

  local u0, u1 = 22, 285.3
  local pitch = (u1 - u0) / (FB_CELLS - 0.21)
  local width = pitch * 0.79
  G.cx1, G.cx2 = {}, {}
  for j = 1, FB_CELLS do
    local u = u0 + (j - 1) * pitch
    G.cx1[j], G.cx2[j] = X(u), X(u + width)
  end
  G.ry1 = { Y(FB_TOP + 11), Y(FB_TOP + 19) }
  G.ry2 = { Y(FB_TOP + 17), Y(FB_TOP + 25) }
  G.lane = {}
  for row = 1, 2 do
    G.lane[row] = newRect(44, 48, 62, 200)
    rectSetWindow(G.lane[row], X(u0), G.ry1[row], X(u1), G.ry2[row])
  end
  G.lite, G.dark = {}, {}
  for c, rgb in pairs(CAT_RGB) do
    G.lite[c] = newRect(rgb[1], rgb[2], rgb[3], 255)
    G.dark[c] = newRect(math.floor(rgb[1] * DARK), math.floor(rgb[2] * DARK), math.floor(rgb[3] * DARK), 255)
  end

  -- The +/- sign for an even advantage: the bundled bitmap font has only
  -- ASCII 33-126, so it is drawn from three bars in the sign's glyph slot.
  G.white = newRect(236, 236, 236, 255)
  G.pm = {}
  for row = 1, 2 do
    local b = FB_TOP + 8 + row * 8.5   -- the row's text baseline
    G.pm[row] = {
      { X(290), Y(b - 4), X(295), Y(b - 3) },   -- plus, horizontal
      { X(292), Y(b - 6), X(293), Y(b - 1) },   -- plus, vertical
      { X(290), Y(b), X(295), Y(b + 1) },       -- minus
    }
  end

  -- Text: the 6x9 bitmap font at its natural size in fight units. Order
  -- matters: font before window, localcoord before scale/position.
  G.font = fontNew('f-6x9.def', -1)
  local iw, ih = math.floor(W + 0.5), math.floor(H + 0.5)
  local function newText(align, u, v, r, g, b)
    local ti = textImgNew()
    textImgSetFont(ti, G.font)
    textImgSetAlign(ti, align)
    textImgSetColor(ti, r, g, b)
    textImgSetLocalcoord(ti, iw, ih)
    textImgSetScale(ti, k, k)
    textImgSetWindow(ti, 0, 0, W, H)
    textImgSetPos(ti, X(u), Y(v))
    return { ti = ti, str = nil, col = nil }
  end
  G.title = newText(-1, u1, FB_TOP + 8, 150, 158, 178)
  textImgSetText(G.title.ti, 'FRAME METER  [F7]')
  G.info = newText(1, u0, FB_TOP + 8, 236, 236, 236)
  G.label = {}
  G.adv = {}
  for row = 1, 2 do
    local base = FB_TOP + 8 + row * 8.5
    G.label[row] = newText(1, 9, base, 190, 196, 210)
    textImgSetText(G.label[row].ti, 'P' .. row)
    G.adv[row] = newText(1, 290, base, 236, 236, 236)
  end
end

local function fbSetText(s, str)
  if s.str ~= str then
    textImgSetText(s.ti, str)
    s.str = str
  end
end

local function fbSetColor(s, key, r, g, b)
  if s.col ~= key then
    textImgSetColor(s.ti, r, g, b)
    s.col = key
  end
end

-- Rebuilds the number strings; runs only when a number changed.
local function fbUpdateTexts()
  fb.textDirty = false
  local info = ''
  if fb.startup then info = 'Startup ' .. string.format('%d', fb.startup) .. 'f' end
  if fb.total then
    if info ~= '' then info = info .. '   ' end
    info = info .. 'Total ' .. string.format('%d', fb.total) .. 'f'
  end
  fbSetText(G.info, info)
  local a = fb.advantage
  for row = 1, 2 do
    local s = G.adv[row]
    if a == nil then
      fbSetText(s, '')
    else
      local v = a
      if row == 2 then v = -a end
      if v > 0 then
        fbSetText(s, '+' .. string.format('%d', v))
        fbSetColor(s, 'plus', 110, 236, 130)
      elseif v < 0 then
        fbSetText(s, string.format('%d', v))
        fbSetColor(s, 'minus', 255, 104, 104)
      else
        fbSetText(s, ' 0')   -- the sign slot is drawn with rects
        fbSetColor(s, 'even', 236, 236, 236)
      end
    end
  end
end

local function fbDraw()
  if G == nil then fbBuild() end
  if fb.textDirty then fbUpdateTexts() end

  rectDraw(G.panel)
  rectDraw(G.lane[1])
  rectDraw(G.lane[2])

  local len = fb.len
  local from = len - FB_CELLS + 1
  if from < 1 then from = 1 end
  local c1, c2 = cells[1], cells[2]
  local cx1, cx2, ry1, ry2 = G.cx1, G.cx2, G.ry1, G.ry2
  local lite, dark = G.lite, G.dark
  for k = from, len do
    local slot = fbSlot(k)
    local j = k - from + 1
    local shade = lite
    if k % 5 == 0 then shade = dark end
    local c = c1[slot]
    if c ~= IDLE then
      local r = shade[c]
      rectSetWindow(r, cx1[j], ry1[1], cx2[j], ry2[1])
      rectDraw(r)
    end
    c = c2[slot]
    if c ~= IDLE then
      local r = shade[c]
      rectSetWindow(r, cx1[j], ry1[2], cx2[j], ry2[2])
      rectDraw(r)
    end
  end

  if fb.advantage == 0 then
    local w = G.white
    for row = 1, 2 do
      local bars = G.pm[row]
      for i = 1, 3 do
        local q = bars[i]
        rectSetWindow(w, q[1], q[2], q[3], q[4])
        rectDraw(w)
      end
    end
  end

  textImgDraw(G.title.ti)
  if G.info.str ~= '' then textImgDraw(G.info.ti) end
  for row = 1, 2 do
    textImgDraw(G.label[row].ti)
    if G.adv[row].str ~= '' then textImgDraw(G.adv[row].ti) end
  end
end

----------------------------------------------------------------------------
-- Hotkey and per-frame hook
----------------------------------------------------------------------------
function FramebarToggle()
  if not fbAllowed() then return end
  fb.visible = not fb.visible
  fbReset()
  fb.fresh = false
end

-- F7, no modifiers, not a debug-only key. It also works during a Pause-key
-- freeze and frame stepping; the engine ignores hotkeys while the pause menu
-- is open.
addHotkey('F7', false, false, false, true, false, 'FramebarToggle()')

-- 'loop' runs once per game tick during a match (and while paused), after
-- the characters have been updated for that tick.
hook.add('loop', 'framebar', function()
  if not fb.visible or not fbAllowed() then return end
  local rs = roundState()
  if rs < 2 then
    if not fb.fresh then fbReset() end
    return
  end
  fb.fresh = false
  if rs == 2 then
    local gt = gameTime()
    if gt ~= fb.lastGt then fbSample(gt) end
  else
    fb.lastGt = nil   -- round over: stop recording, keep showing the meter
  end
  fbDraw()
end)
