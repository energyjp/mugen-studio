'use strict';
//
// THE MOB MODE'S RELAYED MEMBERS: a second reading of a mob giver, for the
// members the first reading (gallerymodes/mob.js) cannot see - ero_helper_zero
// (nnk, 2015, "Zombies"): an invisible root that sends zombies, dogs and a
// bird that fly in from the screen's edge, land on her, judge her art and play
// their own scene. mob.js asks it (read and pair); mob-rt.js plays its steps
// (A RELAY HUB, PARKED UNTIL ITS JUMP, THE CLOCK HELD). Every rule is read from
// his files; the numbers below are ero_helper_zero's, as examples.
//
// MEMBERS BY A VARIABLE ID: a Helper whose `ID` and `stateno` are one variable
// of his (1011/1012/1013: `ID = var(8)`, `stateno = var(8)`), and each
// ChangeState into that state whose trigger assigns the variable a number
// (`var(8) := 7141` in 1002's line into 1012): that number is a member id, its
// ROUTE the state the line is in (1002, entered with Lua changeState, a state
// a fight can enter). ONE KIND, TWO DOORS: an id whose state goes on at once
// into another id's (7140 -> 7141, adding only var(3) := 4: a red PalFX and a
// call voice in 7100) is that member's other door; the member is the inner one
// (7141 by 1002; 7131 by 1001; 7150 by 913), every id on the kill list. Its
// NAME: the last ASCII word of the label of a line into its route state,
// `Helper` taken off ("[State -2,呼び出し HelperZombie]" -> Zombie); else
// 'helper <id>'. Its TYPE: the numbers its spawn chain assigns on its first
// tick (`var(6) := 400`: the Zombie; 300 the Dog, 500 the Birdie).
//
// ITS GRAB: a state of its reach with a standing grab (the core's
// standingGrab) that names no state of hers, and a ChangeState on its hit
// (MoveHit, NumTarget) into a state that puts her in a custom state on its
// first tick (the core's "hit that hands on": 7102 -> 7001, her 3227001).
// The runtime JUMPS it beside her into the grab state, as every member.
//
// ITS JUDGE: the state the hand-off goes on to by itself (7001 -> 7000 on
// landing), one that reads her art. Its first entry's own time-0 VarSets in
// order (its count var(5) is 1 there: `var(0) = 7000 + ifelse(var(5) = 1, 0,
// ...)` = 7000) give the values of its ChangeStates into TRAMPOLINES (`var(0)
// + 10` -> 7010, `var(0) + 20` -> 7020; the random one wants both flags and
// is no position): each is a POSITION, opened by a flag the judge sets on her
// art (`var(59) = 1` on `target,SelfAnimExist(19230) = 1` or 180100 or
// 3227010; `var(58)` on 12250, 180110, 3227020): her PROBES, read per
// receiver (a literal one she ships). A ROOT variable the flags' triggerall
// compare (`Parent,var(15) = 0 || Parent,var(15) = 1`) is the author's
// POSITION LOCK: each position's steps hold it at the least value that opens
// its flag and shuts every other (doggy 1, mangri 2), in the step's setup. A
// flag its own type shuts (`var(6) != 300`: the Dog) gives that member no
// step of that position.
//
// ITS RELAY HUB: the state every trampoline enters at once (7010..7024 are
// each one `ChangeState value = 7002` on `time = 0`), which is every phase of
// its scene, told apart by PrevStateNo. Its exits on `PrevStateNo = T` make
// the LADDER of a position: T0 its intro (`time >= 170` -> T0+1 or T0+2 at
// random), then its speeds (`AnimTime = 0 && time >= N` -> T+1), the last its
// climax (its exit goes back to the judge). Her states per trampoline are
// the hub's TargetState values solved with PrevStateNo = T, its own
// variables over their computed values (var(4): 0 or 5, her plain and her
// swap-box variant) and its root's at 0 (`Parent,var(9)`, the face monitor,
// held there): 3220000 + T and + 5, where the line's own trigger lets her have
// it (`target,SelfAnimExist(3219990) = 0`: no dedicated zerosen art). Its
// LOOKS: a variable of its own that the hub's animation reads and the judge
// draws at random where its type and the position open the draw (`var(2) =
// Random % 2 * 10` on `var(6) = 400 && var(58) = 1`: the Zombie's mangri 742x
// or its mating press 743x), each value one look of the same states of hers.
//
// THE STEPS, per member, position and look ("Zombie", "pos 2 look 2, speed
// 1"): the intro (from a fresh grab it always comes first: the judge's first
// entry), speed 1..n, the climax. Each holds the lock in its setup, pins on
// the member its plain variant (the hub's own variables at their least value)
// and its look, and is played by the relay go and hold (mob-rt.js): the go
// enters the trampoline T, never the hub (its PrevStateNo would read the hub,
// and 3220000 + 7002 is her 3227002, the state that spawns her clone); the
// hold enters it again where the hub would leave (a speed or the climax plays
// on as the hub plays it), and the intro PAUSES on its last frame - its own
// layers and her side with it, its clock held before the hub's time exit.
// PARKED UNTIL ITS JUMP: its grab state's HitDef is live on its first tick,
// and its spawn chain enters it at once, wherever it comes out (the Birdie
// from `pos x - 80` past a screen edge, on screen beside another pair): the
// runtime holds it far above the stage until the jump.
//
// THE PAIR'S SETUP: every variable of his ROOT his members read that decides
// her state or what is drawn - in a TargetState's trigger or value, a
// statedef or ChangeAnim animation, an Explod's trigger, a DestroySelf's
// trigger, a PalFX (var(13) her clone, var(9) the face monitor, var(4)
// see-through, var(3) cross-section, var(5) his dummy) - held at its
// round-start 0; and every variable whose -1/-2/-3 ChangeState into a route
// state it gates (his timers: var(6) >= 1 sends a Dog, var(7) >= 1 a Zombie)
// held at 0, so no member comes but the step's. The lock is the step's, never
// the pair's. Values only (TargetLifeAdd's var(10)-(12), a chance's var(1))
// are left as they are.

const fs = require('fs');

const sortN = (it) => [...new Set(it)].sort((a, b) => a - b);
const atomsOf = (sc) => [...sc.trig.all, ...sc.trig.groups.flat()].map(String);
const ascii = (s) => String(s).replace(/[^\x20-\x7e]/g, '?');
const ranges = (list) => {
  const out = [];
  for (const n of sortN(list)) {
    const last = out[out.length - 1];
    if (last && n === last[1] + 1) last[1] = n; else out.push([n, n]);
  }
  return out;
};
const LADDER_MAX = 8;          // trampolines one position's ladder may climb
const LOCK_MAX = 4;            // the values a position lock is tried at
const GAP = 36;                // where the jump stands a relayed member
// A root read (`Parent,var(N)`, `Root,var(N)`) at its round-start 0.
const rootAtRest = (name) => (/^(parent|root)$/i.test(String(name)) ? 0 : undefined);
const rootReads = (txt) => [...String(txt == null ? '' : txt).matchAll(/\b(?:parent|root)\s*,\s*(f?var\(\d+\))/gi)].map((m) => m[1].toLowerCase());

// ---- reading a giver: his relayed members ---------------------------------
// -> { members, ids, judge, hub, positions, ladders, lockVar, setup } or null.
function relayRead(G, ctx) {
  const L = ctx.lib, F = ctx.fns || {};
  const an = G && G.an;
  if (!an || !Array.isArray(G.helperCtrls) || typeof F.standingGrab !== 'function' || typeof F.issuesAtOnce !== 'function') return null;
  const { X, S } = L;
  const lit = (v) => S.lit(v === undefined || v === null ? '' : String(v));
  const varOnly = (raw) => { const m = /^\s*(f?var)\s*\(\s*(\d+)\s*\)\s*$/i.exec(String(raw == null ? '' : raw)); return m ? m[1].toLowerCase() + '(' + m[2] + ')' : null; };
  // Spawn states: a Helper whose ID and stateno are one variable.
  const spawnAt = new Map();
  for (const h of G.helperCtrls) {
    if (Number.isInteger(h.id) || h.state < 0) continue;
    const a = varOnly(h.sc.params.get('id')), b = varOnly(h.sc.params.get('stateno'));
    if (a && a === b) spawnAt.set(h.state, a);
  }
  if (!spawnAt.size) return null;
  // Its doors: `var(N) := K` in a ChangeState of his root into a spawn state.
  const doors = [];
  for (const st of an.states.values()) for (const sc of st.sctrls) {
    if (sc.type !== 'changestate' || st.no < 0 || L.isBasic(st.no) || !(G.root && G.root.has(st.no))) continue;
    const to = lit(sc.params.get('value'));
    if (to === null || !spawnAt.has(to)) continue;
    const re = new RegExp('\\b' + spawnAt.get(to).replace(/[()]/g, '\\$&') + '\\s*:=\\s*(\\d+)', 'gi');
    for (const e of atomsOf(sc)) for (const m of e.matchAll(re)) {
      const id = +m[1];
      if (an.states.has(id) && !doors.some((d) => d.id === id && d.state === st.no)) doors.push({ id, state: st.no });
    }
  }
  if (!doors.length) return null;
  const allIds = sortN(doors.map((d) => d.id));
  // ONE KIND, TWO DOORS: the inner id.
  const firstInto = (no) => an.states.get(no).sctrls.filter((sc) => sc.type === 'changestate').map((sc) => lit(sc.params.get('value'))).filter((n) => n !== null);
  const inner = allIds.filter((a) => !firstInto(a).some((b) => b !== a && allIds.includes(b)));
  const nameOf = (route) => {
    for (const st of an.states.values()) for (const sc of st.sctrls) {
      if (sc.type !== 'changestate' || lit(sc.params.get('value')) !== route) continue;
      const w = String(sc.label || '').match(/[A-Za-z][A-Za-z0-9]{2,}/g);
      if (!w) continue;
      const n = w[w.length - 1].replace(/^Helper(?=[A-Z])/, '');
      if (/^[A-Za-z][A-Za-z0-9]{1,15}$/.test(n)) return n;
    }
    return null;
  };
  // Its TYPE: the numbers its spawn chain assigns on its first tick.
  const typeOf = (start) => {
    const out = {}, seen = new Set();
    for (let no = start, hops = 0; no !== null && an.states.has(no) && !seen.has(no) && hops < LADDER_MAX; hops++) {
      seen.add(no);
      let next = null;
      for (const sc of an.states.get(no).sctrls) {
        for (const e of atomsOf(sc)) for (const m of e.matchAll(/\b(f?var)\s*\(\s*(\d+)\s*\)\s*:=\s*(-?\d+)\s*$/gi)) out[m[1].toLowerCase() + '(' + m[2] + ')'] = +m[3];
        if (sc.type === 'changestate' && next === null) { const t = lit(sc.params.get('value')); if (t !== null && t !== no) next = t; }
      }
      no = next;
    }
    return out;
  };
  const handsOn = (sc) => sc.type === 'changestate' && atomsOf(sc).some((e) => /\b(movehit|numtarget)\b/i.test(e));
  const members = [];
  for (const id of inner) {
    const door = doors.filter((d) => d.id === id).sort((a, b) => a.state - b.state)[0];
    // Its reach by its literal ways, and its grab with a hand-off.
    const reach = new Set(), q = [id];
    while (q.length && reach.size < 64) {
      const no = q.shift();
      if (reach.has(no) || !an.states.has(no) || L.isBasic(no)) continue;
      reach.add(no);
      for (const sc of an.states.get(no).sctrls) if (sc.type === 'changestate' || sc.type === 'selfstate') { const t = lit(sc.params.get('value')); if (t !== null) q.push(t); }
    }
    let grab = null;
    for (const no of sortN(reach)) {
      const st = an.states.get(no);
      if (!st.sctrls.some((sc) => F.standingGrab(sc) && sc.params.get('p2stateno') === undefined && sc.params.get('p1stateno') === undefined)) continue;
      const hand = st.sctrls.find((sc) => handsOn(sc) && F.issuesAtOnce(lit(sc.params.get('value'))));
      if (hand) { grab = { state: no, handoff: lit(hand.params.get('value')) }; break; }
    }
    if (!grab) continue;
    // (PARKED UNTIL ITS JUMP: its grab's HitDef is live on its first tick,
    // and its spawn chain enters the grab state at once.)
    const live = an.states.get(grab.state).sctrls.some((sc) => F.standingGrab(sc) && atomsOf(sc).some((e) => /^\s*(?:time\s*=\s*0|!\s*time)\s*$/i.test(e)));
    const atOnce = (() => { const seen = new Set(); for (let no = id; no !== null && !seen.has(no) && seen.size < LADDER_MAX; ) { if (no === grab.state) return true; seen.add(no); const st = an.states.get(no); const sc = st && st.sctrls.find((x) => x.type === 'changestate' && atomsOf(x).some((e) => /^\s*(?:time\s*=\s*0|!\s*time)\s*$/i.test(e))); no = sc ? lit(sc.params.get('value')) : null; } return false; })();
    members.push({ id, route: door.state, who: nameOf(door.state) || 'helper ' + id, type: typeOf(id), grab, park: live && atOnce });
  }
  if (!members.length) return null;
  // ITS JUDGE: where the hand-off goes on to by itself, reading her art.
  const handoff = members[0].grab.handoff;
  if (members.some((m) => m.grab.handoff !== handoff)) return null;
  const judge = an.states.get(handoff).sctrls.filter((sc) => sc.type === 'changestate' && !handsOn(sc)).map((sc) => lit(sc.params.get('value')))
    .filter((n) => n !== null && an.states.has(n)).find((n) => an.states.get(n).sctrls.some((sc) => sc.type === 'varset' && atomsOf(sc).some((e) => /\btarget\s*,\s*selfanimexist\s*\(/i.test(e))));
  if (judge === undefined) return null;
  const J = an.states.get(judge);
  // Its first entry's own variables, in order (a VarAdd from the spawn's 0).
  const first = {};
  for (const sc of J.sctrls) {
    if (sc.type !== 'varset' && sc.type !== 'varadd') continue;
    let t = null;
    try { t = X.evalTriggerSet(sc.trig, Object.assign({ time: 0 }, first)); } catch (e) { t = null; }
    if (t !== true) continue;
    for (const [k, raw] of sc.params) {
      const m = /^(f?var)\((\d+)\)$/i.exec(k);
      if (!m) continue;
      let v = null;
      try { v = X.evalExpr(String(raw), Object.assign({}, first)); } catch (e) { v = null; }
      if (typeof v !== 'number' || !Number.isFinite(v)) continue;
      const nm = m[1].toLowerCase() + '(' + m[2] + ')';
      first[nm] = sc.type === 'varadd' ? (first[nm] || 0) + v : v;
    }
  }
  // Its trampolines (one ChangeState and nothing else), each opened by a flag.
  const tramp = (n) => { const st = an.states.get(n); return st && st.sctrls.length === 1 && st.sctrls[0].type === 'changestate' ? lit(st.sctrls[0].params.get('value')) : null; };
  const positions = [];
  for (const sc of J.sctrls) {
    if (sc.type !== 'changestate') continue;
    const flags = atomsOf(sc).map((e) => /^\s*(f?var\(\d+\))\s*=\s*1\s*$/i.exec(e)).filter(Boolean).map((m) => m[1].toLowerCase());
    if (flags.length !== 1) continue;
    let v = null;
    try { v = X.evalExpr(String(sc.params.get('value')), first); } catch (e) { v = null; }
    if (!Number.isInteger(v) || tramp(v) === null || positions.some((p) => p.T0 === v)) continue;
    positions.push({ T0: v, flag: flags[0] });
  }
  if (!positions.length) return null;
  const hub = tramp(positions[0].T0);
  if (positions.some((p) => tramp(p.T0) !== hub) || !an.states.has(hub)) return null;
  // Each flag's VarSets: her probes, the root's lock, its type gates.
  let lockVar = null;
  for (const p of positions) {
    p.sets = J.sctrls.filter((sc) => sc.type === 'varset' && [...sc.params.keys()].some((k) => k.toLowerCase() === p.flag));
    p.probes = sortN(p.sets.flatMap((sc) => atomsOf(sc).flatMap((e) => [...e.matchAll(/\btarget\s*,\s*selfanimexist\s*\(\s*(\d+)\s*\)\s*=\s*1\b/gi)].map((m) => +m[1]))));
    for (const sc of p.sets) for (const e of sc.trig.all.map(String)) for (const nm of rootReads(e)) lockVar = lockVar || nm;
  }
  // (Its triggerall only: the probes are her art, read per receiver.)
  const opens = (p, lock, type) => p.sets.some((sc) => {
    let t = null;
    try { t = X.evalTriggerSet({ all: sc.trig.all, groups: [] }, Object.assign({ time: 0, redirVar: (nm, i, vn) => (lockVar && String(vn).toLowerCase() === lockVar ? lock : undefined) }, type)); } catch (e) { t = null; }
    return t !== false;
  });
  for (const p of positions) {
    const v = lockVar ? [...Array(LOCK_MAX + 1).keys()].find((x) => opens(p, x, {}) && positions.every((o) => o === p || !opens(o, x, {}))) : undefined;
    p.lock = v === undefined ? null : v;
  }
  for (const m of members) m.positions = positions.filter((p) => opens(p, p.lock, m.type)).map((p) => p.T0);
  // ITS LADDERS: the hub's exits per trampoline.
  const H = an.states.get(hub);
  const prevIs = (T) => new RegExp('^\\s*prevstateno\\s*=\\s*' + T + '\\s*$', 'i');
  const ladderOf = (T0) => {
    const out = [];
    for (let T = T0, n = 0; T !== null && n < LADDER_MAX; n++) {
      let at = null, end = false, to = [];
      for (const sc of H.sctrls) {
        if (sc.type !== 'changestate') continue;
        const grp = (sc.trig.groups.length ? sc.trig.groups : [[]]).find((g) => [...sc.trig.all, ...g].map(String).some((e) => prevIs(T).test(e)));
        if (!grp) continue;
        for (const e of [...sc.trig.all, ...grp].map(String)) {
          const m = /\btime\s*>=\s*(\d+)/i.exec(e);
          if (m) at = +m[1];
          if (/\banimtime\s*=\s*0\b/i.test(e)) end = true;
        }
        try { to = sortN(X.evalRandom(String(sc.params.get('value')), { prevstateno: T }).filter(Number.isInteger)); } catch (e) { to = []; }
      }
      out.push({ T, at, end, to });
      if (!to.length || to.includes(judge) || to.length > 2) break;
      T = to[0];
    }
    return out;
  };
  const ladders = {};
  for (const p of positions) ladders[p.T0] = ladderOf(p.T0);
  // THE PAIR'S SETUP: his root's variables his members read that decide her
  // state or what is drawn, and his timers into a route state, at 0.
  const memberStates = new Set([judge, hub]);
  for (const m of members) for (const no of [m.id, m.grab.state, m.grab.handoff]) memberStates.add(no);
  for (const l of Object.values(ladders).flat()) memberStates.add(l.T);
  for (const no of [...memberStates]) for (const sc of (an.states.get(no) || { sctrls: [] }).sctrls) if (sc.type === 'changestate') { const t = lit(sc.params.get('value')); if (t !== null && an.states.has(t) && !L.isBasic(t)) memberStates.add(t); }
  for (const h of G.helperCtrls) if (Number.isInteger(h.id)) { const s = lit(h.sc.params.get('stateno')); if (s !== null && an.states.has(s)) memberStates.add(s); }
  const held = new Map();
  for (const no of sortN(memberStates)) {
    const st = an.states.get(no);
    if (!st) continue;
    for (const nm of rootReads(st.anim)) if (nm !== lockVar && !held.has(nm)) held.set(nm, 'its animation in ' + no + ' reads it');
    for (const sc of st.sctrls) {
      if (!['targetstate', 'changeanim', 'changeanim2', 'explod', 'destroyself', 'palfx'].includes(sc.type)) continue;
      const vals = sc.type === 'targetstate' || /^changeanim/.test(sc.type) ? rootReads(sc.params.get('value')) : [];
      for (const nm of [...atomsOf(sc).flatMap(rootReads), ...vals]) if (nm !== lockVar && !held.has(nm)) held.set(nm, 'his ' + sc.type + ' in ' + no + ' reads it');
    }
  }
  for (const neg of [-1, -2, -3]) {
    const st = an.states.get(neg);
    if (!st) continue;
    for (const sc of st.sctrls) {
      if (sc.type !== 'changestate' || !doors.some((d) => d.state === lit(sc.params.get('value')))) continue;
      for (const e of sc.trig.all.map(String)) {
        const m = /^\s*(f?var\(\d+\))\s*>=\s*1\s*$/i.exec(e);
        if (m && !held.has(m[1].toLowerCase())) held.set(m[1].toLowerCase(), 'his timer: his ' + neg + ' sends a member on it');
      }
    }
  }
  const setup = [...held].sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true })).map(([nm, why]) => Object.assign(L.varRef(nm), { value: 0, why: ascii('held at 0: ' + why) }));
  return { members, ids: allIds, judge, hub, positions: positions.map((p) => ({ T0: p.T0, flag: p.flag, probes: p.probes, lock: p.lock })), ladders, lockVar, setup };
}

// ---- one pair: the relayed members' steps for her -------------------------
// Walk-shaped steps with step.mob (mob.pair finishes them: until, also, path).
function relayPair(G, R, ctx, rr) {
  const L = ctx.lib, { X, S } = L;
  const an = G.an;
  const herHas = R && R.airActions instanceof Set ? R.airActions : new Set();
  const H = an.states.get(rr.hub), J = an.states.get(rr.judge);
  if (!H || !J) return [];
  const isState = (v) => Number.isInteger(v) && an.states.has(v) && !L.isBasic(v);
  // The values its own lines give a variable of its own (an ifelse's leaves).
  const own = (nm) => sortN([...J.sctrls, ...H.sctrls].filter((sc) => sc.type === 'varset').flatMap((sc) => [...sc.params].filter(([k]) => k.toLowerCase() === nm)
    .flatMap(([, raw]) => { const n = S.lit(String(raw)); if (n !== null) return [n]; try { return X.leavesOf(String(raw)); } catch (e) { return []; } })).filter(Number.isInteger));
  // What the hub writes on its first tick after trampoline T (its own
  // VarSets, in order: `var(0) = floor((PrevStateNo - 7000) / 10) * 10`).
  const hubFirst = (T) => {
    const out = {};
    for (const sc of H.sctrls) {
      if (sc.type !== 'varset') continue;
      let t = null;
      try { t = X.evalTriggerSet(sc.trig, Object.assign({ time: 0, prevstateno: T }, out)); } catch (e) { t = null; }
      if (t !== true) continue;
      for (const [k, raw] of sc.params) {
        if (!/^f?var\(\d+\)$/i.test(k)) continue;
        let v = null;
        try { v = X.evalExpr(String(raw), Object.assign({ prevstateno: T }, out)); } catch (e) { v = null; }
        if (typeof v === 'number' && Number.isFinite(v)) out[k.toLowerCase()] = v;
      }
    }
    return out;
  };
  // Her states after trampoline T: the hub's relative TargetState values -
  // what it writes itself first, its other own variables over their values,
  // its root's at 0 - where its trigger lets her have them; and the own
  // variables those values read that the hub never writes (her plain state:
  // their least value, pinned).
  const hubTs = H.sctrls.filter((sc) => sc.type === 'targetstate');
  const ownVars = new Set();
  const herOf = (T) => {
    const out = [];
    const mine = hubFirst(T);
    for (const sc of hubTs) {
      const c = { prevstateno: T, time: 0, victimHas: herHas, redirVar: rootAtRest };
      let t = null;
      try { t = X.evalTriggerSet(sc.trig, c); } catch (e) { t = null; }
      if (t === false) continue;
      const raw = String(sc.params.get('value'));
      const doms = {};
      for (const nm of X.varsOf(raw).map((x) => x.toLowerCase())) {
        if (mine[nm] !== undefined) { doms[nm] = [mine[nm]]; continue; }
        doms[nm] = own(nm).length ? own(nm) : [0];
        ownVars.add(nm);
      }
      let vals = [];
      try { vals = [...X.solveAll(raw, doms, c).keys()]; } catch (e) { vals = []; }
      for (const v of vals) if (isState(v)) out.push(v);
    }
    return sortN(out);
  };
  // Its LOOKS: a variable of its own the hub's animation reads that the
  // judge draws, where its type and this position open the draw.
  const animRaw = String(H.anim == null ? '' : H.anim);
  const looksOf = (m, p) => {
    const out = [0];
    for (const nm of X.varsOf(animRaw).map((x) => x.toLowerCase())) {
      if (m.type[nm] !== undefined) continue;
      for (const sc of J.sctrls) {
        if (sc.type !== 'varset' || ![...sc.params].some(([k, r]) => k.toLowerCase() === nm && X.usesRandom(String(r)))) continue;
        const c = Object.assign({ time: 0 }, m.type, { [p.flag]: 1 });
        for (const o of rr.positions) if (o !== p) c[o.flag] = 0;
        let t = null;
        try { t = X.evalTriggerSet(sc.trig, c); } catch (e) { t = null; }
        if (t !== true) continue;
        for (const [k, raw] of sc.params) if (k.toLowerCase() === nm) for (const v of X.evalRandom(String(raw), c)) if (Number.isInteger(v) && !out.includes(v)) out.push(v);
      }
      if (out.length > 1) return { name: nm, values: sortN(out) };
    }
    return null;
  };
  // (The number the engine computes, where his .air has that action as the
  // engine reads it: a header by its leading digits, so `[Begin Action
  // 7433,<label>]`, which the Studio's own .air read drops, is 7433. A number
  // with no action is none: the engine keeps the animation it had, and a
  // home that names it would never be reached.)
  const actions = new Set(G.gAir instanceof Map ? G.gAir.keys() : []);
  try {
    const air = L.modlib.defFiles(G.dir, G.def).anim;
    if (air) for (const m of fs.readFileSync(air, 'latin1').matchAll(/^\s*\[\s*begin\s+action\s+(-?\d+)/gim)) actions.add(+m[1]);
  } catch (e) { /* his .air unread: the Studio's actions only */ }
  const animOf = (T, m, look, lv) => {
    const c = Object.assign({ prevstateno: T, redirVar: rootAtRest }, m.type);
    if (look) c[look.name] = lv;
    for (const nm of X.varsOf(animRaw).map((x) => x.toLowerCase())) if (c[nm] === undefined) c[nm] = 0;
    let v = null;
    try { v = X.evalExpr(animRaw, c); } catch (e) { v = null; }
    return Number.isInteger(v) && actions.has(v) ? v : null;
  };
  // The layers the hub makes as it starts (an intro's freeze holds them).
  const layers = (() => {
    const exact0 = (e) => /^\s*(?:time\s*=\s*0|!\s*time)\s*$/i.test(String(e));
    const out = new Set();
    for (const sc of H.sctrls) {
      if (sc.type !== 'explod' || !atomsOf(sc).some(exact0)) continue;
      const rt = S.lit(String(sc.params.get('removetime') === undefined ? '' : sc.params.get('removetime')));
      const v = S.lit(String(sc.params.get('id') === undefined ? '' : sc.params.get('id')));
      if ((rt === null || rt <= 0) && Number.isInteger(v) && v > 0) out.add(v);
    }
    return sortN(out).slice(0, 4);
  })();
  const scenes = ranges([rr.judge, rr.hub, ...rr.members.map((m) => m.grab.handoff), ...Object.values(rr.ladders).flat().map((l) => l.T)]);
  const steps = [];
  for (const m of rr.members) {
    let k = 0;
    for (const p of rr.positions) {
      // (Her art passes his judge here: a probe of it she ships.)
      if (!m.positions.includes(p.T0) || !p.probes.some((n) => herHas.has(n))) continue;
      const lad = rr.ladders[p.T0];
      if (!lad || lad.length < 2 || !lad.every((l) => Number.isInteger(l.at) && l.at >= 1)) continue;
      const her = lad.map((l) => herOf(l.T));
      if (!her[0].length) continue;
      k++;
      const look = looksOf(m, p);
      const looks = look ? look.values : [0];
      looks.forEach((lv, li) => {
        const tag = look ? ' look ' + (li + 1) : '';
        const mk = (i, label, nav) => {
          const T = lad[i].T;
          if (!her[i].length) return;
          const anim = animOf(T, m, look, lv);
          // The intro PAUSES: frozen on its last frame with its layers, its
          // clock held a tick before the hub's time exit. A speed or the
          // climax plays on: entered again where the hub would leave.
          const intro = i === 0;
          const line = intro ? { prev: T, at: Math.max(1, lad[i].at - 1), stop: true }
            : { prev: T, at: lad[i].end ? lad[i].at : Math.max(1, lad[i].at - 1), end: !!lad[i].end, to: T };
          const pins = [...ownVars].sort().map((nm) => Object.assign(L.varRef(nm), { value: own(nm).length ? Math.min(...own(nm)) : 0, why: ascii('her plain state: its hub reads ' + nm + ' for hers, held at its least value') }));
          if (look) pins.push(Object.assign(L.varRef(look.name), { value: lv, why: ascii('its look: ' + look.name + ' = ' + lv + ' (its hub\'s animation ' + anim + ')') }));
          steps.push(Object.assign({
            entry: m.id, group: ascii(m.who), label: ascii('pos ' + k + tag + ', ' + label), until: her[i], also: [],
            // (Her states are the same for every member and look: the member
            // and its look make the step, never merged with another's.)
            artKey: 'relay ' + m.id + ' ' + T + ' ' + lv,
            nav: Object.assign({ pos: ascii(m.who) + ' ' + k, ver: li, stage: 0 }, nav),
            mob: Object.assign({ id: m.id, who: ascii(m.who), ids: rr.ids.slice(), route: { state: m.route, after: 0 }, starts: [m.id], settle: [], gap: GAP, scenes: scenes.map((r) => r.slice()),
              grab: m.grab.state, pins,
              go: { state: T, in: [[rr.hub, rr.hub]], home: [[rr.hub, rr.hub]], hub: Object.assign({ state: rr.hub, prev: T }, anim !== null ? { anim } : {}) },
              hold: Object.assign({ state: rr.hub, anim, hub: [line] }, intro && anim !== null ? { freeze: true, explods: layers.slice() } : {}) }, m.park ? { park: true } : {}),
          }, rr.lockVar && p.lock !== null ? { setup: [Object.assign(L.varRef(rr.lockVar), { value: p.lock, why: ascii('his position lock: only this position at his judge ' + rr.judge) })] } : {}));
        };
        mk(0, 'intro', { speed: 0, climax: false });
        for (let i = 1; i < lad.length - 1; i++) mk(i, 'speed ' + i, { speed: i, climax: false });
        mk(lad.length - 1, 'climax', { speed: null, climax: true });
      });
    }
  }
  return steps;
}

module.exports = { relayRead, relayPair };
