'use strict';
// A MOVE AS A TRAINING-MODE READOUT, for the Moves window (moves.html).
//
// Fighting-game frame data read out of a character's own files: startup,
// active and recovery from the animation and the frame the attack arms,
// hitstun, blockstun and hitstop from the HitDef, and the frame advantage
// those add up to. Everything here is an estimate from the files - the Studio
// has not played the move - and every number carries how it was found, so the
// page can say "from the file", "computed" or "assumed".
//
//   frameData(state, block, info) -> the readout for one attack block
//   endOf(sctrls)                 -> when a state hands control back
//   evaluate(text)                -> a runtime expression read the first-hit way
//   guardLevel(raw), attrText(raw), hitflagText(raw) -> FGC words for the flags
const X = require('./cnsexpr.js');
const { airEntries } = require('./public/ikemen/animview-core.js');

// A VALUE AN AUTHOR COMPUTES AT RUNTIME is read the way the move plays as a
// fresh first hit: every var(n) at 0, every fvar(n) at 1. That is exactly
// right for the CvS template (fvar(10) is damage scaling, fvar(5) meter
// scaling, both 1.0 until a combo scales them) and for the "ifelse(var(20),
// 4, 8)" style of toggles, which are off at the start of a round - and it is
// still a guess, so the readout lists what it assumed.
function evaluate(text) {
  const ctx = {};
  for (const name of X.varsOf(text)) ctx[name] = /^(sys)?fvar/.test(name) ? 1 : 0;
  let r = null;
  try { r = X.evalExpr(text, ctx); } catch (e) { r = null; }
  if (typeof r === 'boolean') r = r ? 1 : 0;
  return { value: typeof r === 'number' && Number.isFinite(r) ? r : null, assumed: Object.keys(ctx) };
}

// The engine's own value for a parameter a HitDef leaves out (char.go:700-760:
// pausetime and the ground times reset to 0, air.hittime to 20).
const DEFAULTS = {
  damage: [0, 0], pausetime: [0, 0], 'ground.hittime': [0], 'ground.slidetime': [0], 'air.hittime': [20],
};

// One component of one parameter, as a number and how it was found:
// 'file' (a plain number), 'computed' (an expression read the first-hit way),
// 'derived' (the engine fills it from another value), 'default' (the engine's
// reset value), or null when it cannot be known.
function valueAt(b, name, k, info) {
  const p = b.params.find((x) => x.name === name);
  const v = p && p.values[k];
  if (v && v.tier !== 'absent') {
    const int = v.kind === 'int' || v.kind === 'bool';
    if (v.tier === 'green') return { value: Number(v.raw), how: 'file', param: name, index: k };
    const text = v.tier === 'amber' ? v.expression : v.raw;
    if (v.tier === 'amber' || v.red === 'expression') {
      const e = evaluate(text);
      if (e.value === null) return { value: null, how: 'unknown', param: name, index: k, text };
      return { value: int ? Math.trunc(e.value) : e.value, how: 'computed', param: name, index: k, text, assumed: e.assumed };
    }
    return { value: null, how: 'unknown', param: name, index: k, text: v.raw };
  }
  // The guard chain (char.go:875-888): guard.pausetime from pausetime,
  // guard.hittime from ground.slidetime in a MUGEN character and from
  // ground.hittime with ikemenversion.
  if (name === 'guard.pausetime') return Object.assign(valueAt(b, 'pausetime', k, info), { how: 'derived', param: name, from: 'pausetime' });
  if (name === 'guard.hittime') {
    const from = info && info.ikemenVersion ? 'ground.hittime' : 'ground.slidetime';
    return Object.assign(valueAt(b, from, 0, info), { how: 'derived', param: name, from });
  }
  const d = DEFAULTS[name];
  return { value: d && d[k] !== undefined ? d[k] : null, how: 'default', param: name, index: k };
}

// WHEN THE STATE HANDS CONTROL BACK: the first ChangeState or SelfState with
// ctrl whose triggers name the end - `AnimTime = 0` (the animation's last
// tick) or `Time = N` / `Time >= N`. Anything else is not settled here and the
// readout assumes the animation's end, saying so.
function endOf(sctrls) {
  for (const sc of sctrls || []) {
    if (sc.type !== 'changestate' && sc.type !== 'selfstate') continue;
    const lines = [...(sc.trig.all || []), ...Object.values(sc.trig.groups || {}).flat()].map((l) => String(l).toLowerCase().replace(/\s+/g, ''));
    if (lines.some((l) => /(^|&&|\()animtime=0($|&&|\))/.test(l))) return { kind: 'animtime', line: sc.line };
    const t = lines.map((l) => /(^|&&|\()time(?:=|>=)(\d+)($|&&|\))/.exec(l)).find(Boolean);
    if (t) return { kind: 'time', tick: +t[2], line: sc.line };
  }
  return null;
}

// GUARDFLAG IN FGC WORDS. H is "blockable standing", L "blockable crouching",
// M both, A "blockable in the air". Standing only is an overhead, crouching
// only a low, both a mid; none is unblockable (the engine's default,
// guardflag 0 - char.go:705). The Moves window shows the level alone and the
// whole line, so each is one phrase a language pack can word its own way.
const GUARD_LEVELS = { mid: 'Mid', high: 'Overhead', low: 'Low', none: 'Unblockable' };
const GUARD_TEXT = {
  mid: 'Mid, not air-blockable', midAir: 'Mid, air-blockable',
  high: 'Overhead, not air-blockable', highAir: 'Overhead, air-blockable',
  low: 'Low, not air-blockable', lowAir: 'Low, air-blockable',
  none: 'Unblockable', noneAir: 'Unblockable',
};
function guardLevel(raw) {
  const s = String(raw || '').toUpperCase().replace(/[^HLMA]/g, '');
  const hi = /[HM]/.test(s), lo = /[LM]/.test(s), air = s.includes('A');
  const k = hi && lo ? 'mid' : hi ? 'high' : lo ? 'low' : 'none';
  return { level: GUARD_LEVELS[k], air, text: GUARD_TEXT[air ? k + 'Air' : k] };
}

// attr = S, NA: the stance it is done from and what kind of attack it is. One
// stance and one kind, nearly every HitDef, is a whole phrase (ATTR_PHRASES),
// so a language pack can put its words in its own order; a rarer mix
// ("standing/crouching", two kinds) is joined from the words below.
const ATTR_PHRASES = {
  'S,NA': 'standing normal attack', 'S,NT': 'standing normal throw', 'S,NP': 'standing normal projectile',
  'S,SA': 'standing special attack', 'S,ST': 'standing special throw', 'S,SP': 'standing special projectile',
  'S,HA': 'standing super attack', 'S,HT': 'standing super throw', 'S,HP': 'standing super projectile',
  'C,NA': 'crouching normal attack', 'C,NT': 'crouching normal throw', 'C,NP': 'crouching normal projectile',
  'C,SA': 'crouching special attack', 'C,ST': 'crouching special throw', 'C,SP': 'crouching special projectile',
  'C,HA': 'crouching super attack', 'C,HT': 'crouching super throw', 'C,HP': 'crouching super projectile',
  'A,NA': 'air normal attack', 'A,NT': 'air normal throw', 'A,NP': 'air normal projectile',
  'A,SA': 'air special attack', 'A,ST': 'air special throw', 'A,SP': 'air special projectile',
  'A,HA': 'air super attack', 'A,HT': 'air super throw', 'A,HP': 'air super projectile',
};
function attrText(raw) {
  if (!raw) return null;
  const [st, ...kinds] = String(raw).toUpperCase().split(',').map((x) => x.trim());
  const one = kinds.filter(Boolean);
  if (one.length === 1 && Object.hasOwn(ATTR_PHRASES, st + ',' + one[0])) return ATTR_PHRASES[st + ',' + one[0]];
  const stance = { S: 'standing', C: 'crouching', A: 'air' };
  const cls = { N: 'normal', S: 'special', H: 'super' };
  const typ = { A: 'attack', T: 'throw', P: 'projectile' };
  const where = [...(st || '')].map((c) => stance[c]).filter(Boolean).join('/');
  const what = kinds.filter(Boolean).map((k) => [cls[k[0]], typ[k[1]]].filter(Boolean).join(' ')).filter(Boolean);
  return [where, what.join(', ')].filter(Boolean).join(' ') || null;
}

// hitflag = MAF: who it can hit. The Moves window words the list one entry
// at a time (HITFLAG_WORDS) and the combo clause after " - " whole.
const HITFLAG_WORDS = { H: 'standing', L: 'crouching', A: 'airborne', F: 'falling', D: 'lying down (OTG)', none: 'no one' };
const HITFLAG_ONLY = { combo: 'only an opponent already in hitstun (combo only)', never: 'never an opponent in hitstun' };
function hitflagText(raw) {
  const s = String(raw === undefined || raw === null ? 'MAF' : raw).toUpperCase();
  const out = [];
  if (/[HM]/.test(s)) out.push(HITFLAG_WORDS.H);
  if (/[LM]/.test(s)) out.push(HITFLAG_WORDS.L);
  if (s.includes('A')) out.push(HITFLAG_WORDS.A);
  if (s.includes('F')) out.push(HITFLAG_WORDS.F);
  if (s.includes('D')) out.push(HITFLAG_WORDS.D);
  const only = s.includes('+') ? HITFLAG_ONLY.combo : s.includes('-') ? HITFLAG_ONLY.never : '';
  return (out.length ? out.join(', ') : HITFLAG_WORDS.none) + (only ? ' - ' + only : '');
}

// A HitDef that can never hit: its hitflag names none of H, L, M, A, D. The
// engine reads `hitflag =` (empty) as 0 (stored as "" by the controller
// parser, compiler.go:6015; parseHitFlag, compiler_functions.go:1678-1703),
// and the hit test refuses a standing, crouching, airborne and lying target
// whose flag is missing (char.go:10797-10800). Capcom vs SNK helpers open with
// one (their "Miss" HitDef, every tick) before the real HitDef, so the helper
// counts as attacking while nothing can be hit.
function neverHits(b) {
  if (!b || b.ctrl !== 'hitdef') return false;
  const p = (b.params || []).find((x) => x.name === 'hitflag');
  return !!p && !/[HLMAD]/i.test(String(p.raw === undefined || p.raw === null ? '' : p.raw));
}

// The first literal-or-computed number of a parameter.
const num = (b, name, k, info) => valueAt(b, name, k || 0, info);
const MAX_METER = 400;

// ONE BLOCK'S READOUT.
//
// Frames are counted the fighting-game way: frame 1 is the first frame of the
// move. Startup is the first frame the attack can hit (the HitDef armed and a
// hit box on the element the engine tests that tick - GRAIL 3.2c), active the
// run of frames that follow with a hit box, recovery the frames after that
// until the character can act again. The state hands control back on the tick
// its end trigger is true (`AnimTime = 0`: the tick after the animation's last
// frame), and the character acts on the tick after that - so a 12-tick
// animation that ends on AnimTime = 0 is 13 frames you cannot act.
//
// Frame advantage assumes the hit lands on the first active frame:
//   on hit   = hitstun + 2 + (opponent's hitstop - your hitstop) - frames after contact
//   on block = blockstun + 1 + (opponent's blockstop - your blockstop) - frames after contact
// One +1 on both is the opponent's own hand-back frame: control comes back in
// its state code (HitOver / the guard states' ChangeState) after state -1 has
// already read that frame's commands, so it acts a frame later - the same
// frame "total" counts on your side. The second +1 on hit is the frame the
// engine adds to the hitstun of a MUGEN-made opponent (char.go:11315-11317;
// the guard branch has none). Measured in the engine with the training frame
// meter (addons/framebar): KFM's standing light punch is +4 on hit and -3 on
// block, which the version without the hand-back frame put at +3 and -4.
function frameData(s, b, info) {
  const out = { type: b.type, notes: [], assumed: [] };
  // The animation to count on: the statedef's own when it names one, else
  // the one numbered like the state (the usual convention - sakura's 195
  // picks 198 / 196 / 195 by variable and command and plays 195 by default),
  // else the first the state can play.
  const drawn = (s.anims || []).filter((a) => a.exists && a.frames && a.frames.length);
  const lit = s.anim && s.anim.literal ? Number(s.anim.raw) : null;
  const anim = drawn.find((a) => a.action === lit) || drawn.find((a) => a.action === s.no) || drawn[0] || null;
  if (drawn.length > 1) out.notes.push('this state can play ' + drawn.length + ' animations (' + drawn.map((a) => a.action).join(', ') + '); the frames are counted on ' + anim.action);
  out.anim = anim ? anim.action : null;

  // When the block arms.
  let arm = null, armHow = null;
  for (const f of b.firing || []) {
    if (anim && f.ticks && Number.isFinite(f.ticks[anim.action])) { arm = f.ticks[anim.action]; armHow = f.kind === 'conditional' ? 'conditional' : 'file'; break; }
    if (f.kind === 'time' && Number.isFinite(f.tick)) { arm = f.tick; armHow = 'file'; break; }
  }
  if (arm === null) {
    const t = (b.firing || []).map((f) => /(?:^|[^a-z])time\s*(?:=|>=)\s*(\d+)/i.exec(f.text || '')).find(Boolean);
    if (t) { arm = +t[1]; armHow = 'conditional'; }
  }
  if (arm === null) { arm = 0; armHow = 'assumed'; out.notes.push('when this block arms depends on a condition the file cannot settle; counted as armed from frame 1'); }
  out.armFrame = arm + 1;
  out.armHow = armHow;

  // The frame meter: every tick of the animation's first pass, with whether
  // the element the engine tests that tick carries a hit box.
  // A meter is drawn for up to MAX_METER frames; a longer animation (a
  // cinematic super, a 807,414,841-tick hold) is counted but not drawn.
  let meter = null, len = null;
  if (anim && anim.ticks > MAX_METER) out.notes.push('the animation runs ' + anim.ticks + ' frames: too long to draw as a frame meter');
  if (anim && anim.ticks <= MAX_METER) {
    const ent = airEntries(anim.frames.map((f) => f.time), anim.loopStart || 0).full;
    meter = [];
    for (const r of ent.runs) {
      const hold = ent.hold && r === ent.runs[ent.runs.length - 1];
      const e = anim.frames[r.clsn !== undefined ? r.clsn : r.elem];
      const n = hold ? 1 : r.ticks;
      for (let k = 0; k < n; k++) meter.push({ elem: anim.frames[r.elem].elem, hit: !!(e && e.clsn1 && e.clsn1.length) });
    }
  }
  if (anim) {
    len = anim.endless ? null : anim.ticks;
    if (anim.endless) out.notes.push('the animation holds forever, so the move has no fixed length');
  }

  // A Helper controller read as a throw (movelib THE PROJECTILES): its frame
  // is when the helper appears, like a Projectile's.
  const isProj = b.ctrl === 'projectile' || b.ctrl === 'helper';
  const isMod = b.ctrl === 'modifyhitdef' || b.ctrl === 'modifyreversaldef';
  if (isMod) { out.notes.push(b.type + ' changes a HitDef already running; it has no frames of its own'); return out; }

  // Startup and active. A HitDef that can never hit has neither.
  let startup = null, active = null;
  const never = neverHits(b);
  if (never) {
    out.neverHits = true;
    out.notes.push('its hitflag (' + JSON.stringify(String((b.params.find((x) => x.name === 'hitflag') || {}).raw || '')) + ') names no target the engine lets it hit: this HitDef never hits (a "Miss" marker: the character counts as attacking while nothing can be hit)');
  } else if (isProj) {
    startup = arm + 1;
    out.notes.push('a projectile: the startup is the frame it appears; its own hit box and speed decide the rest');
  } else if (meter) {
    for (let t = arm; t < meter.length; t++) if (meter[t].hit) { startup = t + 1; break; }
    if (startup !== null) {
      active = 0;
      for (let t = startup - 1; t < meter.length && meter[t].hit; t++) active++;
      const later = [];
      for (let t = startup - 1 + active; t < meter.length; t++) if (meter[t].hit && !meter[t - 1].hit) later.push(t + 1);
      if (later.length) out.notes.push('another hit box appears on frame ' + later.join(', ') + ' (this block can still hit there if it missed)');
    } else if (meter) out.notes.push('no hit box after the block arms: this block cannot hit with this animation');
  }

  // Total: frames until the character can act again.
  const end = s.end;
  let total = null;
  if (end && end.kind === 'time') total = end.tick + 1;
  else if (len !== null) total = len + 1;
  if (!end && len !== null) out.assumed.push('the move ends when its animation does');
  out.endHow = end ? end.kind : (len !== null ? 'assumed' : null);

  out.startup = startup;
  out.active = active;
  out.total = total;
  out.recovery = startup !== null && active !== null && total !== null ? Math.max(0, total - (startup - 1) - active) : null;
  out.meter = meter ? meter.map((m, t) => (t < out.armFrame - 1 ? 's' : m.hit && !never ? 'a' : (startup !== null && t >= startup - 1 + (active || 0)) ? 'r' : 's')) : null;
  if (out.meter && total !== null && total <= MAX_METER + 1) while (out.meter.length < total) out.meter.push('r');

  // The HitDef's numbers.
  const v = {
    damage: num(b, 'damage', 0, info), chip: num(b, 'damage', 1, info),
    hitstop: num(b, 'pausetime', 0, info), hitstopP2: num(b, 'pausetime', 1, info),
    blockstop: num(b, 'guard.pausetime', 0, info), blockstopP2: num(b, 'guard.pausetime', 1, info),
    hitstun: num(b, 'ground.hittime', 0, info), airHitstun: num(b, 'air.hittime', 0, info),
    blockstun: num(b, 'guard.hittime', 0, info),
  };
  out.values = v;
  for (const x of Object.values(v)) if (x.how === 'computed') for (const a of x.assumed || []) if (!out.assumed.includes(a + ' = ' + (/^(sys)?fvar/.test(a) ? 1 : 0))) out.assumed.push(a + ' = ' + (/^(sys)?fvar/.test(a) ? 1 : 0));

  const raw = (name) => { const p = b.params.find((x) => x.name === name); return p ? p.raw : undefined; };
  out.guard = guardLevel(raw('guardflag'));
  out.attr = attrText(raw('attr'));
  out.hits = hitflagText(raw('hitflag'));
  const fall = num(b, 'fall', 0, info);
  out.knockdown = fall.value === 1 ? true : fall.value === 0 || fall.how === 'default' ? false : null;
  const jug = num(b, 'air.juggle', 0, info);
  out.juggle = jug.value;

  // Advantage.
  if (!isProj && startup !== null && total !== null) {
    const after = total - startup;
    const known = (...xs) => xs.every((x) => x.value !== null);
    if (known(v.hitstun, v.hitstop, v.hitstopP2)) out.onHit = v.hitstun.value + 2 + (v.hitstopP2.value - v.hitstop.value) - after;
    if (known(v.blockstun, v.blockstop, v.blockstopP2)) out.onBlock = v.blockstun.value + 1 + (v.blockstopP2.value - v.blockstop.value) - after;
    const approx = [v.hitstun, v.hitstop, v.hitstopP2, v.blockstun, v.blockstop, v.blockstopP2].some((x) => x.how === 'computed') || armHow !== 'file' || !end;
    out.approx = approx;
  }
  if (b.ctrl === 'reversaldef') { delete out.onHit; delete out.onBlock; out.notes.push('a counter / parry: it catches attacks during its active frames rather than hitting'); }
  return out;
}

// ---- PROJECTILES ---------------------------------------------------------------------------
//
// A PROJECTILE'S FLIGHT, tick by tick, the way the engine moves one (Ikemen GO
// f598853: Projectile.update char.go 2576-2707, tick 2825-2878; the frame
// order system.go 2995-3018). t = 0 is the tick it appears: the thrower's
// state code makes it, and the same frame its update runs, collision tests
// it and its timers count down. Each tick:
//   1. the removal check, on the position the PREVIOUS tick left and the
//      velocity it has now (char.go 2589-2602): removetime == 0; removetime
//      <= -2 once the animation has played through; moving down (vel y > 0)
//      below heightbound[1] or moving up above heightbound[0]. The screen and
//      stage bounds need the camera and are not modelled here;
//   2. the move: pos += velocity (x along its facing) (2683);
//   3. then velocity += accel, velocity *= velmul (2692-2695). A negative x
//      velocity turns it around (facing, velocity and accel x flip: the
//      motion on screen goes on as before, only the sprite faces the other
//      way, 2696-2700, 7666-7671);
//   4. collision (after the move) tests the element the animation shows on
//      that tick: its animation advances only later, in cueDraw (2915-2917),
//      so tick t tests element of animation time t;
//   5. removetime counts down (tick(), 2825-2878).
// So `projremovetime = N` gives N ticks of life (t = 0..N-1).
//
//   o.pos      [x, y] where it appears, in the character's own units (x ahead)
//   o.vel, o.accel, o.velmul   [x, y]
//   o.removetime  -1 = never on its own
//   o.heightbound [top, bottom]
//   o.runs, o.loopFrom, o.hold, o.firstPass   the animation's timeline
//      (animview-core airTimeline) with each run's `hit` (a Clsn1 on the element
//      the engine tests) - null for no animation
//   o.cap      ticks simulated at most (PATH_CAP)
//   o.hitUnknown  why its hit box is unknown (its animation is not read):
//      then firstHit and activeTicks are null, not 0 - unknown, not absent
// -> { pts: [[x, y, elem, hit]] one per tick alive, end: { tick, why },
//      firstHit (the first tick its tested element has a Clsn1), activeTicks,
//      turns: [ticks it turned around] }
const PATH_CAP = 300;
function projectilePath(o) {
  const cap = o.cap || PATH_CAP;
  let [x, y] = o.pos, [vx, vy] = o.vel;
  const [ax, ay] = o.accel, [mx, my] = o.velmul;
  let rt = o.removetime;
  const runs = o.runs || null;
  const atTick = (t) => {
    if (!runs || !runs.length) return null;
    let k = 0, left = t;
    for (;;) {
      const r = runs[k];
      if (left < r.ticks) return r;
      left -= r.ticks;
      k++;
      if (k >= runs.length) {
        if (o.hold) return runs[runs.length - 1];
        k = o.loopFrom || 0;
        // a whole cycle to skip: jump straight to the tick's place in it
        let cyc = 0;
        for (let j = k; j < runs.length; j++) cyc += runs[j].ticks;
        if (cyc > 0 && left >= cyc) left %= cyc;
      }
    }
  };
  const pts = [];
  const turns = [];
  // Velocities here are along the THROWER's facing (what the file writes).
  // The engine keeps them along the projectile's own facing and turns it
  // around whenever that x goes negative (velocity and accel x flip with it),
  // which leaves the motion on screen as it was: only `dir`, the way the
  // sprite faces, changes.
  let end = null, firstHit = null, activeTicks = 0, dir = vx < 0 ? -1 : 1;
  for (let t = 0; t < cap; t++) {
    if (rt === 0) { end = { tick: t, why: 'removetime' }; break; }
    if (rt <= -2 && runs && !o.hold && o.firstPass !== null && o.firstPass !== undefined && t >= o.firstPass) { end = { tick: t, why: 'anim end' }; break; }
    if (vy > 0 && y > o.heightbound[1]) { end = { tick: t, why: 'below heightbound', bound: o.heightbound[1] }; break; }
    if (vy < 0 && y < o.heightbound[0]) { end = { tick: t, why: 'above heightbound', bound: o.heightbound[0] }; break; }
    x += vx; y += vy;
    const r = atTick(t);
    const hit = !!(r && r.hit);
    if (hit) { activeTicks++; if (firstHit === null) firstHit = t; }
    pts.push([Math.round(x * 100) / 100, Math.round(y * 100) / 100, r ? r.elem + 1 : 0, hit ? 1 : 0, dir]);
    vx = (vx + ax) * mx; vy = (vy + ay) * my;
    if (vx * dir < 0) { dir = -dir; turns.push(t + 1); }
    if (rt > 0) rt--;
  }
  if (!end) end = { tick: cap, why: 'cap' };
  if (o.hitUnknown) return { pts, end, firstHit: null, activeTicks: null, hitUnknown: String(o.hitUnknown), turns };
  return { pts, end, firstHit, activeTicks, turns };
}

// A HELPER'S FLIGHT (a fireball made with a Helper): its first state replayed
// tick by tick the way a character moves (actionRun then posUpdate, char.go
// 9928-9990): the statedef's velset at entry, then each tick the motion
// controllers in file order whose triggers read only `time` (VelSet, VelAdd,
// VelMul, PosAdd; DestroySelf and ChangeState end the walk), then pos += vel,
// then the physics: S stand.friction (a speed under 1 stops), C
// crouch.friction, A gravity (landing ends the walk), N nothing (the default,
// bytecode.go 15530). A helper runs its first tick on the frame it is made
// (CharList.action processes appended helpers, char.go 13531-13535). The walk
// stops at the first controller whose trigger reads anything but time, or
// whose value is not a number: the path after it "depends on" that text.
//   o.sctrls  the state's controllers (scenelib), o.headerVel [x, y] or null,
//   o.physics 's'|'c'|'a'|'n', o.friction { s, c }, o.yaccel,
//   o.pos [x, y] where it appears, o.hf its facing against the thrower's
//   (1 or -1), o.runs/loopFrom/hold the animation's timeline with `hit`,
//   o.arm the tick its HitDef arms (null: unknown), o.num(raw) -> number|null,
//   o.hitUnknown why its hit box is unknown along the walk (as projectilePath)
const MOTION = new Set(['velset', 'veladd', 'velmul', 'posadd', 'posset', 'destroyself', 'changestate', 'selfstate']);
const CONTACT_IDS = new Set(['movecontact', 'movehit', 'moveguarded', 'movereversed', 'hitcount', 'uniqhitcount', 'numtarget']);
function helperPath(o) {
  const cap = o.cap || PATH_CAP;
  const x0 = o.pos[0];
  let dx = 0, y = o.pos[1], vx = 0, vy = 0;
  if (o.headerVel) { vx = o.headerVel[0] || 0; vy = o.headerVel[1] || 0; }
  const ctrls = (o.sctrls || []).filter((sc) => MOTION.has(sc.type));
  const once = new Set();
  const runs = o.runs || null;
  const atTick = (t) => {
    if (!runs || !runs.length) return null;
    let k = 0, left = t;
    for (let guard = 0; guard < 100000; guard++) {
      const r = runs[k];
      if (left < r.ticks) return r;
      left -= r.ticks;
      k++;
      if (k >= runs.length) { if (o.hold) return runs[runs.length - 1]; k = o.loopFrom || 0; }
    }
    return null;
  };
  const trigText = (sc) => {
    const all = (sc.trig.all || []).map(String);
    const groups = (sc.trig.groups || []).map((g) => g.map(String).join(' && '));
    return [all.join(' && '), groups.length > 1 ? groups.map((g) => '(' + g + ')').join(' || ') : groups[0] || ''].filter(Boolean).join(' && ');
  };
  const pts = [];
  const mayEnd = [];
  let end = null, firstHit = null, activeTicks = 0;
  // In flight it has touched nothing yet: the contact triggers read 0 (the
  // grab-reach rule, GRAIL "GRAB REACH": movehit and its kin 0 before the hit).
  const ctxAt = (t) => ({ time: t, unk: (n) => (!n.args && CONTACT_IDS.has(n.id) ? 0 : undefined) });
  // `Pos Y`, `Vel X`, `Vel Y` of the helper itself are the walk's own numbers
  // (Pos Y from the ground, with the thrower standing on it); `Pos X` is
  // camera-relative and a redirected one (`root, Pos Y`) is someone else's:
  // both stay unknown.
  const sub = (text) => String(text).replace(/\b(pos|vel)\s+([xy])\b/gi, (m, what, ax, at, whole) => {
    if (/,\s*$/.test(whole.slice(0, at))) return m;
    const k = what.toLowerCase() + ax.toLowerCase();
    const val = k === 'posy' ? y : k === 'velx' ? vx : k === 'vely' ? vy : null;
    return val === null ? m : '(' + (Math.round(val * 1e6) / 1e6) + ')';
  });
  const subSet = (set) => ({ all: (set.all || []).map(sub), groups: (set.groups || []).map((g) => g.map(sub)) });
  outer: for (let t = 0; t < cap; t++) {
    for (const sc of ctrls) {
      if (once.has(sc)) continue;
      let v = null;
      try { v = X.evalTriggerSet(subSet(sc.trig), ctxAt(t)); } catch (e) { v = null; }
      if (v === false) continue;
      if (v === null && (sc.type === 'destroyself' || sc.type === 'changestate' || sc.type === 'selfstate')) {
        // An ending it cannot settle (a timer on a variable, the opponent's
        // distance) is named, and the flight goes on as if it had not fired.
        if (!mayEnd.some((m) => m.line === sc.line && m.file === sc.file)) mayEnd.push({ tick: t, text: trigText(sc), file: sc.file, line: sc.line, type: sc.type });
        continue;
      }
      if (v === null) { end = { tick: t, why: 'depends', text: trigText(sc), file: sc.file, line: sc.line, type: sc.type }; break outer; }
      if (String(sc.params.get('persistent') || '').trim() === '0') once.add(sc);
      if (sc.type === 'destroyself') { end = { tick: t, why: 'destroyself', file: sc.file, line: sc.line }; break outer; }
      if (sc.type === 'changestate' || sc.type === 'selfstate') { end = { tick: t, why: 'changestate', to: String(sc.params.get('value') || '').trim(), file: sc.file, line: sc.line }; break outer; }
      if (sc.type === 'posset') { end = { tick: t, why: 'depends', text: 'PosSet (a place on the screen)', file: sc.file, line: sc.line, type: sc.type }; break outer; }
      for (const k of ['x', 'y']) {
        const raw = sc.params.get(k);
        if (raw === undefined || !String(raw).trim()) continue;
        const n = o.num(sub(raw));
        if (n === null) { end = { tick: t, why: 'depends', text: k + ' = ' + String(raw).trim(), file: sc.file, line: sc.line, type: sc.type }; break outer; }
        if (sc.type === 'velset') { if (k === 'x') vx = n; else vy = n; }
        else if (sc.type === 'veladd') { if (k === 'x') vx += n; else vy += n; }
        else if (sc.type === 'velmul') { if (k === 'x') vx *= n; else vy *= n; }
        else if (sc.type === 'posadd') { if (k === 'x') dx += n; else y += n; }
      }
    }
    dx += vx; y += vy;
    if (o.physics === 's') { vx *= o.friction.s; if (Math.abs(vx) < 1) vx = 0; }
    else if (o.physics === 'c') vx *= o.friction.c;
    else if (o.physics === 'a') vy += o.yaccel;
    const r = atTick(t);
    const hit = !!(r && r.hit) && o.arm !== null && o.arm !== undefined && t >= o.arm;
    if (hit) { activeTicks++; if (firstHit === null) firstHit = t; }
    pts.push([Math.round((x0 + dx * o.hf) * 100) / 100, Math.round(y * 100) / 100, r ? r.elem + 1 : 0, hit ? 1 : 0, o.hf]);
    // (o.noLand: the walk of a character's own move, whose landing would end
    // the state anyway - the start height is not known, only the motion.)
    if (o.physics === 'a' && !o.noLand && y >= 0 && vy > 0) { end = { tick: t + 1, why: 'lands' }; break; }
  }
  if (!end) end = { tick: cap, why: 'cap' };
  if (o.hitUnknown) return { pts, end, firstHit: null, activeTicks: null, hitUnknown: String(o.hitUnknown), turns: [], mayEnd };
  return { pts, end, firstHit, activeTicks, turns: [], mayEnd };
}

// A HELPER FOLLOWED THROUGH ITS STATES (THE PROJECTILES, GRAIL 3.10): the walk
// of helperPath carried across every ChangeState / SelfState the files settle,
// tick by tick, until it destroys itself, reaches a state with no exit, lands
// (physics A: the engine sends it to state 52), or a cap (CHAIN_TICKS ticks,
// CHAIN_STATES states). The engine's rules (Ikemen GO f598853):
//   a ChangeState takes effect at once: stateChange1 sets time 0 (char.go
//     6588-6597), changeStateEx runs stateChange2 -> StateBytecode.init (the
//     new statedef's physics, then its velset, anim, ... bytecode.go 15537-15565,
//     stateDef.Run 4891-4935) and the NEW state's code in the same frame (char.go
//     6773-6781); the old state's remaining controllers do not run (changeState
//     .Run returns stop, bytecode.go 5196-5219). A statedef without `physics` is
//     N (newStateBytecode, bytecode.go 15530; compiler.go 6609-6628), one without
//     `velset` keeps the velocity, one without `anim` keeps the animation and its
//     clock; its HitDef does not carry over (hitdefpersist 0 by default,
//     compiler.go 6652-6659, stateDef.Run 4904-4911);
//   each frame the state code runs, then posUpdate (pos += vel along its facing,
//     then S friction / C friction / A gravity, char.go 9928-9990), then a
//     physics A state with vel y > 0 at or below the ground lands into state 52
//     (char.go 12167-12173), then time++ (12176);
//   VelSet / VelAdd / VelMul / PosAdd (bytecode.go 5822-5930) as helperPath;
//     a Gravity controller adds its yaccel to vel y (bytecode.go 11404-11418,
//     char.go 9834-9836);
//     PosSet y is from the ground, PosSet x from the camera (5786-5816: x
//     depends on the screen); Turn flips its facing, so its motion turns too
//     (9665-9675, posUpdate's vel x * facing);
//   AnimTime = curtime - totaltime and AnimElemTime(N) = curtime - the times
//     before element N (anim.go 503-520); curtime counts the frames since the
//     animation started and, past totaltime, runs the loop again (anim.go
//     802-846); `AnimElem = N` compiles to AnimElemTime(N) = 0 (movelib
//     classifyAtom);
//   Pause / SuperPause (bytecode.go 10420-10520, setPauseTime /
//     setSuperPauseTime char.go 9182-9220): the pause starts on the NEXT frame
//     (system.go 2964-2983) and lasts `time` frames; everyone without movetime
//     stands frozen (actionPrepare char.go 11857-11866): the player and the
//     opponent. The helper that called it moves for `movetime` of them (counted
//     down in actionPrepare, 11962-11968; a movetime above the time is 0) and is
//     frozen for the rest - its path holds still there.
// A branch the files do not settle (Win / Lose, RoundState, a variable,
// random, the opponent's distance) is LISTED in `mayEnd`, never followed; a
// motion controller that reads one stops the walk ("depends").
//   o.first       the state it is made in, as o.stateOf returns it
//   o.stateOf(n)  -> { no, sctrls, headerVel: [x|null, y|null] | null,
//                   physics 's'|'c'|'a'|'n'|'u', anim: { action, runs,
//                   loopFrom, hold, totaltime, looptime, starts } | null
//                   (no anim: it keeps the one it has), animWhy (an anim the
//                   files do not settle), file, line } or { notFollowed: why }
//   o.pos, o.hf, o.friction, o.yaccel, o.num as helperPath
// -> helperPath's { pts, end, firstHit, activeTicks, turns, mayEnd } with
//    pts [x, y, element, hit, facing, segment index, frozen], plus
//    chain: [{ state, from, to, action, file, line, how (why it left), hit
//    (its HitDef fired there: { tick, file, line }), x0, y0, x1, y1,
//    vx, vy (its speed when it left) }] and pauses: [{ tick, kind, time,
//    movetime, state, file, line }] (tick = the frame it is called; the
//    others stand still on frames tick + 1 .. tick + time).
const CHAIN_TICKS = 600, CHAIN_STATES = 12;
const CHAIN_TYPES = new Set([...MOTION, 'pause', 'superpause', 'turn', 'hitdef', 'changeanim', 'gravity']);
function helperChain(o) {
  const cap = o.cap || CHAIN_TICKS;
  const maxStates = o.maxStates || CHAIN_STATES;
  let x = o.pos[0], y = o.pos[1], vx = 0, vy = 0, f = o.hf || 1;
  let physics = 'n', anim = null, ak = 0, st = 0, cur = null, armed = null;
  let ctrls = [], once = new Set();
  const pts = [], turns = [], mayEnd = [], chain = [], pauses = [];
  let end = null, firstHit = null, activeTicks = 0, hitUnknown = null;
  let frozenFrom = -1, frozenTo = -1;   // frames this helper stands frozen by its own pause
  // AnimTime / AnimElemTime at anim clock k (anim.go 503-520, 802-846).
  const curtime = (k) => {
    if (!anim || anim.totaltime === -1 || k <= anim.totaltime) return k;
    const LT = anim.looptime;
    return LT > 0 ? anim.totaltime - LT + ((k - anim.totaltime - 1) % LT) + 1 : anim.totaltime + 1;
  };
  const animTime = (k) => (anim ? curtime(k) - anim.totaltime : null);
  const elemTime = (k, n) => {
    if (!anim || !Number.isInteger(n) || n < 1) return null;
    if (n > anim.starts.length) { const t = animTime(k); return t > 0 ? 0 : t; }
    return curtime(k) - anim.starts[n - 1];
  };
  const atTick = (k) => {
    const runs = anim && anim.runs;
    if (!runs || !runs.length) return null;
    let j = 0, left = k;
    for (let guard = 0; guard < 100000; guard++) {
      const r = runs[j];
      if (left < r.ticks) return r;
      left -= r.ticks;
      j++;
      if (j >= runs.length) { if (anim.hold) return runs[runs.length - 1]; j = anim.loopFrom || 0; }
    }
    return null;
  };
  const trigText = (sc) => {
    const all = (sc.trig.all || []).map(String);
    const groups = (sc.trig.groups || []).map((g) => g.map(String).join(' && '));
    return [all.join(' && '), groups.length > 1 ? groups.map((g) => '(' + g + ')').join(' || ') : groups[0] || ''].filter(Boolean).join(' && ');
  };
  const ctx = () => ({
    time: st,
    unk: (n) => {
      if (!n.args && CONTACT_IDS.has(n.id)) return 0;
      if (!n.args && n.id === 'animtime') { const v = animTime(ak); return v === null ? undefined : v; }
      if (n.id === 'animelemtime' && n.args && n.args.length === 1 && n.args[0].t === 'num') { const v = elemTime(ak, n.args[0].v); return v === null ? undefined : v; }
      return undefined;
    },
    // `AnimElem = N` (and the forms that compile as it) = AnimElemTime(N) = 0
    cmpHook: (n) => {
      if (['=', '!=', '>=', '<='].includes(n.o) && n.a.t === 'unk' && n.a.id === 'animelem' && !n.a.args && n.b.t === 'num') {
        const v = elemTime(ak, n.b.v);
        return v === null ? undefined : v === 0;
      }
      return undefined;
    },
  });
  const sub = (text) => String(text).replace(/\b(pos|vel)\s+([xy])\b/gi, (m, what, ax, at, whole) => {
    if (/,\s*$/.test(whole.slice(0, at))) return m;
    const k = what.toLowerCase() + ax.toLowerCase();
    const val = k === 'posy' ? y : k === 'velx' ? vx : k === 'vely' ? vy : null;
    return val === null ? m : '(' + (Math.round(val * 1e6) / 1e6) + ')';
  });
  const subSet = (set) => ({ all: (set.all || []).map(sub), groups: (set.groups || []).map((g) => g.map(sub)) });
  const seg = () => chain[chain.length - 1];
  const close = (t, how, sc, extra) => {
    const s = seg();
    if (!s || s.to !== null) return;
    Object.assign(s, { to: t, how, x1: Math.round(x * 100) / 100, y1: Math.round(y * 100) / 100, vx: Math.round(vx * 1e4) / 1e4, vy: Math.round(vy * 1e4) / 1e4 }, sc ? { endFile: sc.file, endLine: sc.line, endText: trigText(sc) } : {}, extra || {});
  };
  const enter = (d, t) => {
    cur = d; st = 0; armed = null;
    ctrls = (d.sctrls || []).filter((sc) => CHAIN_TYPES.has(sc.type));
    once = new Set();
    if (d.physics && d.physics !== 'u') physics = d.physics;
    if (d.headerVel) { if (d.headerVel[0] !== null && d.headerVel[0] !== undefined) vx = d.headerVel[0]; if (d.headerVel[1] !== null && d.headerVel[1] !== undefined) vy = d.headerVel[1]; }
    if (d.anim) { anim = d.anim; ak = 0; }
    if (d.animWhy && !hitUnknown) hitUnknown = d.animWhy;
    chain.push({ state: d.no, from: t, to: null, action: anim ? anim.action : null, file: d.file, line: d.line, hit: null, x0: Math.round(x * 100) / 100, y0: Math.round(y * 100) / 100 });
  };
  const branch = (t, sc) => {
    if (!mayEnd.some((m) => m.line === sc.line && m.file === sc.file)) {
      const to = sc.type === 'changestate' || sc.type === 'selfstate' ? String(sc.params.get('value') || '').trim() : undefined;
      mayEnd.push({ tick: t, text: trigText(sc), file: sc.file, line: sc.line, type: sc.type, state: cur.no, to });
    }
  };
  enter(o.first, 0);
  outer: for (let t = 0; t < cap; t++) {
    // Frozen by its own pause past its movetime: nothing of it runs.
    if (t >= frozenFrom && t <= frozenTo) {
      const r = atTick(ak);
      pts.push([Math.round(x * 100) / 100, Math.round(y * 100) / 100, r ? r.elem + 1 : 0, 0, f, chain.length - 1, 1]);
      continue;
    }
    for (let nest = 0; ; nest++) {
      let switched = false;
      for (const sc of ctrls) {
        if (once.has(sc)) continue;
        let v = null;
        try { v = X.evalTriggerSet(subSet(sc.trig), ctx()); } catch (e) { v = null; }
        if (v === false) continue;
        if (v === null) {
          // An ending, a turn, a hit or a pause it cannot settle is named and
          // the walk goes on as if it had not fired.
          if (['destroyself', 'changestate', 'selfstate', 'turn', 'hitdef', 'pause', 'superpause', 'changeanim'].includes(sc.type)) {
            branch(t, sc);
            // A HitDef whose trigger the walk cannot settle arms where the
            // state's own frame data puts it (o.armOf, the Moves window's
            // startup, marked approx), as the single-state walk did.
            if (sc.type === 'hitdef' && armed === null && o.armOf) {
              const a = o.armOf(cur.no);
              if (a !== null && a !== undefined && st >= a) { armed = t; if (!seg().hit) seg().hit = { tick: t, file: sc.file, line: sc.line, approx: true }; }
            }
            continue;
          }
          end = { tick: t, why: 'depends', text: trigText(sc), file: sc.file, line: sc.line, type: sc.type };
          close(t, 'depends', sc);
          break outer;
        }
        if (String(sc.params.get('persistent') || '').trim() === '0') once.add(sc);
        if (sc.type === 'destroyself') { end = { tick: t, why: 'destroyself', file: sc.file, line: sc.line }; close(t, 'destroyself', sc); break outer; }
        if (sc.type === 'changestate' || sc.type === 'selfstate') {
          const raw = String(sc.params.get('value') || '').trim();
          const to = o.num(raw);
          if (to === null || !Number.isInteger(to)) { end = { tick: t, why: 'depends', text: 'value = ' + raw, file: sc.file, line: sc.line, type: sc.type }; close(t, 'depends', sc); break outer; }
          const d = chain.length >= maxStates ? { notFollowed: 'the walk follows ' + maxStates + ' states at most' } : o.stateOf(to);
          if (!d || d.notFollowed) {
            end = { tick: t, why: 'changestate', to: String(to), file: sc.file, line: sc.line, notFollowed: d ? d.notFollowed : 'state ' + to + ' is not in its files', capped: chain.length >= maxStates || undefined };
            close(t, 'changestate', sc, { toState: to });
            break outer;
          }
          close(t, 'changestate', sc, { toState: to });
          enter(d, t);
          if (d.velDepends) { end = { tick: t, why: 'depends', text: 'velset = ' + d.velDepends + ' (state ' + d.no + ')', file: d.file, line: d.line, type: 'statedef' }; close(t, 'depends'); break outer; }
          if (nest >= maxStates) { end = { tick: t, why: 'cap', states: true }; break outer; }
          switched = true;
          break;
        }
        if (sc.type === 'turn') { f = -f; turns.push(t); continue; }
        // Gravity (bytecode.go 11404-11418, char.go 9834-9836): vel y += its
        // yaccel on each frame it fires, whatever the state's physics.
        if (sc.type === 'gravity') { vy += o.yaccel; continue; }
        // ChangeAnim with a number the files settle: the new animation from
        // its first tick (its clock restarts); `elem` is not read. Anything
        // else leaves its hit box unknown from here.
        if (sc.type === 'changeanim') {
          const n = o.num(String(sc.params.get('value') || '').trim());
          const d = n !== null && Number.isInteger(n) && o.animOf ? o.animOf(n) : null;
          if (d && d.anim) {
            anim = d.anim; ak = 0;
            const s = seg();
            if (s.action === null || s.from === t) s.action = d.anim.action;
            else if (!(s.actions || []).includes(d.anim.action) && s.action !== d.anim.action) s.actions = (s.actions || [s.action]).concat(d.anim.action);
          }
          if ((!d || d.animWhy) && !hitUnknown) hitUnknown = d && d.animWhy ? d.animWhy : 'its ChangeAnim in state ' + cur.no + ' (' + sc.file + ' line ' + sc.line + ') sets an animation the files do not settle';
          continue;
        }
        if (sc.type === 'hitdef') { if (armed === null) { armed = t; if (!seg().hit) seg().hit = { tick: t, file: sc.file, line: sc.line }; } continue; }
        if (sc.type === 'pause' || sc.type === 'superpause') {
          const T = o.num(sub(sc.params.has('time') ? sc.params.get('time') : (sc.type === 'superpause' ? '30' : '0')));
          let m = o.num(sub(sc.params.has('movetime') ? sc.params.get('movetime') : '0'));
          if (T === null || m === null) { branch(t, sc); continue; }
          m = Math.max(0, Math.trunc(m));
          const TT = Math.trunc(T);
          if (m > TT) m = 0;
          if (TT > 0) {
            pauses.push({ tick: t, kind: sc.type === 'pause' ? 'Pause' : 'SuperPause', time: TT, movetime: m, state: cur.no, file: sc.file, line: sc.line });
            if (m < TT) { frozenFrom = t + 1 + m; frozenTo = t + TT; }
          }
          continue;
        }
        if (sc.type === 'posset') {
          if (sc.params.get('x') !== undefined && String(sc.params.get('x')).trim()) { end = { tick: t, why: 'depends', text: 'PosSet x (a place on the screen)', file: sc.file, line: sc.line, type: sc.type }; close(t, 'depends', sc); break outer; }
          const raw = sc.params.get('y');
          if (raw !== undefined && String(raw).trim()) {
            const n = o.num(sub(raw));
            if (n === null) { end = { tick: t, why: 'depends', text: 'y = ' + String(raw).trim(), file: sc.file, line: sc.line, type: sc.type }; close(t, 'depends', sc); break outer; }
            y = n;
          }
          continue;
        }
        for (const k of ['x', 'y']) {
          const raw = sc.params.get(k);
          if (raw === undefined || !String(raw).trim()) continue;
          const n = o.num(sub(raw));
          if (n === null) { end = { tick: t, why: 'depends', text: k + ' = ' + String(raw).trim(), file: sc.file, line: sc.line, type: sc.type }; close(t, 'depends', sc); break outer; }
          if (sc.type === 'velset') { if (k === 'x') vx = n; else vy = n; }
          else if (sc.type === 'veladd') { if (k === 'x') vx += n; else vy += n; }
          else if (sc.type === 'velmul') { if (k === 'x') vx *= n; else vy *= n; }
          else if (sc.type === 'posadd') { if (k === 'x') x += n * f; else y += n; }
        }
      }
      if (!switched) break;
    }
    x += vx * f; y += vy;
    if (physics === 's') { vx *= o.friction.s; if (Math.abs(vx) < 1) vx = 0; }
    else if (physics === 'c') vx *= o.friction.c;
    else if (physics === 'a') vy += o.yaccel;
    const r = atTick(ak);
    const hit = !!(r && r.hit) && armed !== null;
    if (hit) { activeTicks++; if (firstHit === null) firstHit = t; }
    pts.push([Math.round(x * 100) / 100, Math.round(y * 100) / 100, r ? r.elem + 1 : 0, hit ? 1 : 0, f, chain.length - 1, 0]);
    st++; ak++;
    if (physics === 'a' && y >= 0 && vy > 0) { end = { tick: t + 1, why: 'lands' }; close(t + 1, 'lands'); break; }
  }
  if (!end) end = { tick: cap, why: 'cap' };
  close(end.tick, end.why);
  const out = { pts, end, firstHit, activeTicks, turns, mayEnd, chain, pauses };
  if (hitUnknown && firstHit === null) return Object.assign(out, { firstHit: null, activeTicks: null, hitUnknown: String(hitUnknown) });
  return out;
}

// POINT BLANK: the projectile connects on the first tick it can (its first
// tick with a hit box), right in front of the thrower. Its hitpause freezes
// the PROJECTILE, not the thrower (char.go 13958-13967: the owner is not
// paused), so the thrower's own hitstop is 0 in the advantage formula above:
//   on hit   = hitstun + 2 + the opponent's hitstop - the thrower's frames after contact
//   on block = blockstun + 1 + the opponent's blockstop - the same
// contact = the frame it appears + its first hit tick. Null when a number it
// needs is unknown; `approx` when one rests on a formula or a frame the files
// do not settle.
function pointBlank(thrower, v, contactFrame) {
  const out = { frame: contactFrame, onHit: null, onBlock: null, approx: false };
  if (!thrower || thrower.total === null || thrower.total === undefined || contactFrame === null || contactFrame === undefined) return out;
  const after = thrower.total - contactFrame;
  const known = (...xs) => xs.every((x) => x && x.value !== null && x.value !== undefined);
  if (known(v.hitstun, v.hitstopP2)) out.onHit = v.hitstun.value + 2 + v.hitstopP2.value - after;
  if (known(v.blockstun, v.blockstopP2)) out.onBlock = v.blockstun.value + 1 + v.blockstopP2.value - after;
  out.after = after;
  out.approx = !!thrower.approx || [v.hitstun, v.hitstopP2, v.blockstun, v.blockstopP2].some((x) => x && x.how === 'computed');
  return out;
}

module.exports = { frameData, endOf, evaluate, guardLevel, attrText, hitflagText, neverHits, valueAt, projectilePath, helperPath, helperChain, pointBlank, PATH_CAP, CHAIN_TICKS, CHAIN_STATES };
