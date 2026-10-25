'use strict';
//
// THE SELF MODE'S DIRECTOR (gallerymodes/self.js asks this file when it is
// present: read(G, ctx, lib) once per giver, pair(G, R, ctx, reading, lib)
// per receiver). Delete it and the director is gone; the hub stays. Read
// from his files alone; nothing here names a character, a folder or a state
// number.
//
// A DIRECTOR is a giver whose summon's helper plays the scene by itself and
// picks what it plays from variables of his the player sets with commands
// (ero_helper_gs: an action number, a speed, a finish flag, an art type).
// The gallery does what the player would: it HOLDS those variables in each
// step's setup (never the toggle commands) and lets the helper play. So the
// director's actions are positions like a Kuromaru giver's, chosen per
// receiver by the helper's own probes: its loop is the base, its speeds are
// speeds, its finish is the climax.
//
// THE DIRECTOR RULE (strict), all of:
//   SUMMON    a summon of his whose helper plays the scene (gallerydata's
//             summon, `helperPlays`): the step's entry, `clear` and place;
//   TOGGLES   his states his [Statedef -1] enters on ONE playable command,
//             whose controllers are only VarSet/VarAdd/Explod/RemoveExplod/
//             PlaySnd/ChangeState, every ChangeState to a number, and with a
//             write of a variable that reads that variable itself: a cycle
//             `ifelse(var(1) = var(8), 0, var(1) + 1)`, a flip
//             `ifelse(var(9) = 0, 1, 0)`, a step;
//   DOMAIN    the values that write reaches from the round-start 0, a bound
//             it reads taken at the numbers his other VarSets write it
//             (var(8) = 14: [0, 14]);
//   SELECTOR  such a variable the helper's states read as Parent,var(N) or
//             Root,var(N);
//   POSITION  a selector with two or more values that send the helper
//             through states of its own no other value's trace has (a family
//             of its own: 3010/3011 for action 1), read as below.
// THE HELPER'S TRACE (one per set of held values and receiver): his helper
// is run from the state its hit hands her on from, the way the engine runs
// it - controllers in order, a ChangeState at once, a state's own Time and
// `Time % N` ticks one after another, up to HORIZON ticks - with his held
// variables read as Parent/Root,var, his others at the numbers his files
// write them (else 0), the helper's own from 0, `:=` in a trigger written,
// her animations for its probes (`target,SelfAnimExist`, a computed number
// worked out first), her name for its name gates, her state as he last put
// her there (`target,StateNo`), the hit made (MoveHit, NumTarget 1). A
// trigger that cannot be read does not fire and makes the trace unsure from
// there; a VarRandom makes its variable unknown. Each TargetState she gets
// is followed through her own zero-tick states (6011 -> 36637 -> 6004): the
// state she settles in is the RELAY the runtime sees, and her art is asked by
// the state that hands her to it (scenelib's relay demand), so the chain's
// scenes before the relay are the ones judged (the relay alone where it is
// the chain's one scene).
// ROLES BY EFFECT, read once per giver with a receiver who passes every
// probe: the POSITION first (a value that draws at random - 0, a VarRandom,
// then nothing sure - has no family and is none), then with it held at its
// first value a SPEED (a selector whose values make sure the helper's pick in
// its loop state - the state it dwells in longest - where the base draws it:
// var(13) 1 and 2, 0 drawing at random), then with the speed held, each
// other selector: the same trace is NEUTRAL (not held), her first scene
// differing in the same helper state is a VERSION (var(9)), the helper
// leaving its loop later into states that give her a new scene and then
// starting its cycle over (a state of its own it ran before her first scene)
// is the CLIMAX (var(2)), any other effect (a release, a third partner's
// join, a random finish) is not held either.
// THE STEPS, per receiver, per position value whose trace is sure for HER
// (the helper's own probes: an action she has no art for re-rolls, and has
// no step): `action k` (her first sure state in its loop, the first speed),
// `action k, speed i` (the next speeds), `action k, climax` (her first new
// scene once the trace leaves the base's), and the same per version, `type
// i` - a version whose trace is the first one's for her (his art type where
// she lacks its probe) is none. Only a step whose judged scenes show for her
// (tailored, renders, partial). The setup holds position, speed, climax and
// version every frame; the path is one wait for her relay; `states` are the
// relay (what the runtime sees) and the judged scenes (THE CONTRACT holds:
// the wait's until is the states), `alsoStates` the rest of the cycle;
// `clear`, `edgeOnly` and `place` the summon's. In place a change of action
// or speed would show only when the helper reads it again (in its loop: up
// to its own period, 300 ticks for an action), the relay done at once - so
// the runtime (self.js's Lua, from `self` { action, speed, version }) moves
// to a step in place only from one of the same action, version and speed, or
// into or out of its climax, and summons again for the rest (the helper's
// first pick reads what is held: done at t = 51 with that art, engine run).
// nav { pos 'self <entry> a<k>', speed (0 the base), ver, climax }.
// CLAIMS: the summon's core step gives way to these. COUNTS: a scene these
// steps show that the core's walk for her does not reach, +1 its verdict and
// -1 unreachable (self.js's addCounts).
const HORIZON = 1500;   // ticks one trace runs
const HOPS = 64;        // state changes in one tick
const HER_HOPS = 8;     // her own zero-tick states followed
const SAMPLES = 600;    // ticks of one trace evaluated
const DOMAIN_MAX = 32;  // a selector's values
const TOGGLE_TYPES = new Set(['varset', 'varadd', 'explod', 'removeexplod', 'playsnd', 'changestate']);
const RANK = { tailored: 6, renders: 5, partial: 4, getHitOnly: 3, vanishes: 2, unknown: 1 };
const SHOWS = new Set(['tailored', 'renders', 'partial']);
const REDIR_VAR = /\b(parent|root)\s*,\s*(f?var)\s*\(\s*(\d+)\s*\)/gi;
// A receiver who passes every probe (the roles are read with her).
class Everyone extends Set { has() { return true; } }
const EVERYONE = new Everyone();

const lower = (s) => String(s == null ? '' : s).toLowerCase();
const truth = (v) => (v === null || v === undefined ? null : typeof v === 'boolean' ? v : Number.isNaN(v) ? false : v !== 0);
const num = (v) => (v === null || v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : Number.isFinite(v) ? v : null);

// ---- reading his files -----------------------------------------------------------
// TOGGLES: Map variable -> { writes: [raw], states: [no], cmds: [cmd] }.
function togglesOf(G, lib) {
  const neg = G.an.states.get(-1);
  if (!neg) return new Map();
  const playable = (k) => { const ci = G.cmdInfo && G.cmdInfo.get(k); return !!(ci && ci.playable); };
  const W = G.fns && G.fns.W;
  if (!W) return new Map();
  const out = new Map();
  for (const sc of neg.sctrls) {
    if (sc.type !== 'changestate') continue;
    const no = lib.S.lit(sc.params.get('value'));
    if (no === null || no < 0) continue;
    const cmds = lib.commandsIn(sc.trig).filter(playable);
    if (cmds.length !== 1) continue;
    const s = G.an.states.get(no);
    if (!s || !s.sctrls.length || !s.sctrls.every((x) => TOGGLE_TYPES.has(x.type))) continue;
    if (!s.sctrls.filter((x) => x.type === 'changestate').every((x) => lib.S.lit(x.params.get('value')) !== null)) continue;
    let own = 0;
    const mine = [];
    for (const x of s.sctrls) {
      if (x.type !== 'varset' && x.type !== 'varadd') continue;
      for (const [name0, raw] of W.writesOf(x)) {
        const name = lower(name0);
        if (!lib.VARNAME.test(name)) continue;
        if (lib.S.lit(raw) !== null) continue;
        if (!lib.X.varsOf(String(raw)).map(lower).includes(name)) continue;
        own++;
        mine.push([name, String(raw), x.type]);
      }
    }
    if (!own) continue;
    for (const [name, raw, type] of mine) {
      if (!out.has(name)) out.set(name, { writes: [], states: [], cmds: [] });
      const e = out.get(name);
      e.writes.push({ raw, type });
      if (!e.states.includes(no)) e.states.push(no);
      if (!e.cmds.includes(cmds[0])) e.cmds.push(cmds[0]);
    }
  }
  return out;
}

// The numbers his VarSets write a variable (his root's states: not his
// helpers'), for a bound a toggle reads and for his own defaults.
function literalsOf(G, lib, helperStates) {
  const W = G.fns.W;
  const out = new Map();
  for (const [no, s] of G.an.states) {
    if (helperStates.has(no)) continue;
    for (const sc of s.sctrls) {
      if (sc.type !== 'varset') continue;
      for (const [name0, raw] of W.writesOf(sc)) {
        const v = lib.S.lit(raw);
        if (v === null) continue;
        const name = lower(name0);
        if (!out.has(name)) out.set(name, new Set());
        out.get(name).add(v);
      }
    }
  }
  return out;
}

// A toggle variable's DOMAIN: what its writes reach from 0, each bound it
// reads at the numbers his files write it. null: none, or too many.
function domainOf(lib, name, tog, lits) {
  const seen = new Set([0]);
  const q = [0];
  while (q.length) {
    const x = q.shift();
    for (const w of tog.writes) {
      const bounds = lib.X.varsOf(w.raw).map(lower).filter((v) => v !== name);
      const combos = [{}];
      for (const b of bounds) {
        const vals = lits.has(b) ? [...lits.get(b)] : null;
        if (!vals || !vals.length) return null;
        const next = [];
        for (const c of combos) for (const v of vals) next.push(Object.assign({}, c, { [b]: v }));
        combos.splice(0, combos.length, ...next);
      }
      for (const c of combos) {
        let v = num(lib.X.evalExpr(w.raw, Object.assign({}, c, { [name]: x })));
        if (v === null) return null;
        if (w.type === 'varadd') v += x;
        v = Math.trunc(v);
        if (!seen.has(v)) { seen.add(v); q.push(v); if (seen.size > DOMAIN_MAX) return null; }
      }
    }
  }
  return [...seen].sort((a, b) => a - b);
}

// The variables of his the helper's states read as Parent/Root,var(N).
function parentReadsOf(G, helperStates) {
  const out = new Set();
  const scan = (t) => { for (const m of String(t == null ? '' : t).matchAll(REDIR_VAR)) out.add(lower(m[2]) + '(' + m[3] + ')'); };
  for (const no of helperStates) {
    const s = G.an.states.get(no);
    if (!s) continue;
    for (const sc of s.sctrls) {
      for (const t of [...sc.trig.all, ...sc.trig.groups.flat()]) scan(t);
      for (const [, v] of sc.params) scan(v);
    }
  }
  return out;
}

// ---- THE HELPER'S TRACE ---------------------------------------------------------------
// c: { G, lib, start, from, defaults: Map }; pins: { 'var(N)': v } held on him;
// has: her animations. -> { ev: [{ T, kind: 'his'|'her', ... }], unsure, dwell }
const timesMemo = new WeakMap();
// The ticks of a state where a trigger of its may turn: Time = N, Time >= N,
// Time > N, Time % N = 0 (every N), up to HORIZON.
function timesOf(s) {
  if (timesMemo.has(s)) return timesMemo.get(s);
  const out = new Set();
  for (const sc of s.sctrls) {
    for (const t0 of [...sc.trig.all, ...sc.trig.groups.flat()]) {
      const t = lower(t0).replace(/\s+/g, '');
      for (const m of t.matchAll(/(?:^|[^\w,.])time%(\d+)=0(?!\d)/g)) { const n = +m[1]; if (n > 0) for (let k = n; k <= HORIZON; k += n) out.add(k); }
      for (const m of t.matchAll(/(?:^|[^\w,.%])time(=|>=|>)(\d+)(?!\d)/g)) { const n = +m[2] + (m[1] === '>' ? 1 : 0); if (n > 0 && n <= HORIZON) out.add(n); }
    }
  }
  const list = [...out].sort((a, b) => a - b);
  timesMemo.set(s, list);
  return list;
}

function trace(c, pins, has, herName) {
  const { G, lib } = c;
  const X = lib.X, W = G.fns.W;
  const P = new Map(c.defaults);
  for (const [k, v] of Object.entries(pins)) P.set(k, v);
  const held = new Set(Object.keys(pins));
  const H = new Map();       // the helper's own variables (absent: 0; null: unknown)
  const ev = [];
  const dwell = new Map();
  let st = c.start, prev = c.from, t = 0, T = 0, samples = 0;
  let her = null, herPrev = null, unsure = null, ended = null;
  const doubt = (why) => { if (!unsure) unsure = { T, his: st, why, i: ev.length }; };
  const rew = (s) => String(s)
    .replace(/\b(?:target|enemy|enemynear|p2)\s*(?:\(\s*\d*\s*\))?\s*,\s*stateno\b/gi, (all) => (her === null ? all : '(' + her + ')'))
    .replace(/\b(?:target|enemy|enemynear|p2)\s*(?:\(\s*\d*\s*\))?\s*,\s*alive\b/gi, '(1)')
    .replace(/\b(?:movehit|movecontact)\b/gi, (all, off, str) => (/,\s*$/.test(str.slice(0, off)) ? all : '(1)'))
    .replace(/\bnumtarget\b(?:\s*\(\s*\d*\s*\))?/gi, (all, off, str) => (/,\s*$/.test(str.slice(0, off)) ? all : '(1)'))
    .replace(/\broundstate\b/gi, (all, off, str) => (/,\s*$/.test(str.slice(0, off)) ? all : '(2)'))
    // (her name, the trigger words: a receiver read for the roles has none)
    .replace(/\b(?:(?:target|enemy|enemynear|p2)\s*(?:\(\s*\d*\s*\))?\s*,\s*(?:p1)?name|p2name)\s*(!=|=)\s*"([^"]*)"/gi,
      (all, op, text) => (((herName != null && lower(herName) === lower(text)) === (op === '=')) ? '(1)' : '(0)'));
  // A probe whose number is computed (`target,SelfAnimExist(PrevStateNo +
  // 3202000 + var(0))`): its number worked out here, then read as a number.
  const probes = (s, x) => {
    let out = '', i = 0;
    const re = /\b(?:self)?animexist\s*\(/gi;
    for (let m; (m = re.exec(s));) {
      let d = 1, j = re.lastIndex;
      for (; j < s.length && d > 0; j++) { if (s[j] === '(') d++; else if (s[j] === ')') d--; }
      if (d !== 0) break;
      const inner = s.slice(re.lastIndex, j - 1);
      if (/^\s*-?\d+\s*$/.test(inner)) continue;
      const v = num(X.evalExpr(inner, x));
      if (v === null) continue;
      out += s.slice(i, re.lastIndex) + Math.trunc(v) + ')';
      i = j;
      re.lastIndex = j;
    }
    return out + s.slice(i);
  };
  const ctxOf = () => {
    const x = { time: t, stateno: st, prevstateno: prev, victimHas: has, isHelper: true,
      redirVar: (name, id, v) => { const n = lower(name); if (n !== 'parent' && n !== 'root') return undefined; const k = lower(v); return P.has(k) && P.get(k) !== null ? P.get(k) : undefined; } };
    for (let i = 0; i < 60; i++) { x['var(' + i + ')'] = 0; if (i < 40) x['fvar(' + i + ')'] = 0; }
    for (const [k, v] of H) { if (v === null) delete x[k]; else x[k] = v; }
    return x;
  };
  const setH = (name, v, x) => { H.set(name, v); if (x) { if (v === null) delete x[name]; else x[name] = v; } };
  // One trigger line: a `var(N) := expr` line writes as it is read.
  const line = (l, x) => {
    const m = /^\s*(f?var)\s*\(\s*(\d+)\s*\)\s*:=\s*([\s\S]+)$/i.exec(l);
    if (m) { const v = num(X.evalExpr(probes(rew(m[3]), x), x)); setH(lower(m[1]) + '(' + m[2] + ')', v === null ? null : Math.trunc(v), x); return v === null ? null : v !== 0; }
    return truth(X.evalExpr(probes(rew(l), x), x));
  };
  const fires = (sc, x) => {
    for (const l of sc.trig.all) { const v = line(l, x); if (v !== true) return v; }
    let unknown = false;
    for (const g of sc.trig.groups) {
      let ok = g.length > 0;
      for (const l of g) { const v = line(l, x); if (v === true) continue; if (v === null) unknown = true; ok = false; break; }
      if (ok) return true;
    }
    return unknown ? null : false;
  };
  const valueOf = (raw, x) => { const v = num(X.evalExpr(probes(rew(raw), x), x)); return v === null ? null : Math.trunc(v); };
  // Her own zero-tick states from C (entered from p).
  const settle = (C, p) => {
    const chain = [C];
    let cur = C, pv = p;
    for (let hop = 0; hop < HER_HOPS; hop++) {
      const s = G.an.states.get(cur);
      if (!s) break;
      let next = null;
      for (const sc of s.sctrls) {
        if (sc.type !== 'changestate' && sc.type !== 'selfstate') continue;
        const hx = { time: 0, stateno: cur, prevstateno: pv, selfHas: has, isHelper: false };
        let f = null;
        try { f = X.evalTriggerSet(sc.trig, hx); } catch (e) { f = null; }
        if (f === false) continue;
        if (f === null) break;
        const v = num(X.evalExpr(String(sc.params.get('value')), hx));
        if (v !== null) next = Math.trunc(v);
        break;
      }
      if (next === null || chain.includes(next)) break;
      pv = cur; cur = next; chain.push(cur);
    }
    return { chain, settled: cur, prev: pv };
  };
  // One pass over the state's controllers at time t: -> the state it
  // changes to, or null.
  const pass = () => {
    const s = G.an.states.get(st);
    if (!s) { ended = 'no state ' + st; return null; }
    const x = ctxOf();
    for (const sc of s.sctrls) {
      const ty = sc.type;
      if (!['varset', 'varadd', 'varrandom', 'parentvarset', 'parentvaradd', 'targetstate', 'changestate', 'selfstate', 'destroyself'].includes(ty)) continue;
      const f = fires(sc, x);
      if (f === false) continue;
      if (ty === 'varset' || ty === 'varadd' || ty === 'parentvarset' || ty === 'parentvaradd') {
        for (const [name0, raw] of W.writesOf(sc)) {
          const name = lower(name0);
          if (!lib.VARNAME.test(name)) continue;
          let v = valueOf(raw, x);
          const parent = ty.startsWith('parent');
          const old = parent ? (P.has(name) ? P.get(name) : 0) : (H.has(name) ? H.get(name) : 0);
          if (ty.endsWith('add') && v !== null) v = old === null ? null : old + v;
          if (f === null && v !== old) v = null;
          if (parent) { if (!held.has(name)) P.set(name, v); } else setH(name, v, x);
        }
        continue;
      }
      if (ty === 'varrandom') {
        const v = lib.S.lit(sc.params.get('v'));
        if (v !== null) setH('var(' + v + ')', null, x);
        continue;
      }
      if (f === null) { doubt(ty + ' in ' + st + ' reads what the trace does not know'); continue; }
      if (ty === 'destroyself') { ended = 'destroyed'; return null; }
      const v = valueOf(sc.params.get('value'), x);
      if (ty === 'targetstate') {
        if (v === null) { doubt('her state from ' + st + ' unknown'); ev.push({ T, kind: 'her', his: st, to: null, chain: [], settled: null }); continue; }
        const r = settle(v, her);
        herPrev = her;
        her = r.settled;
        ev.push({ T, kind: 'her', his: st, to: v, chain: r.chain, settled: r.settled });
        continue;
      }
      if (v === null) { doubt('his next state from ' + st + ' unknown'); ended = 'unsure'; return null; }
      return v;
    }
    return undefined;
  };
  for (let hops = 0; samples < SAMPLES && T <= HORIZON && !ended; samples++) {
    const next = pass();
    if (ended) break;
    if (next !== undefined && next !== null) {
      if (++hops > HOPS) { doubt('a loop of zero-tick states at ' + st); ended = 'loop'; break; }
      ev.push({ T, kind: 'his', from: st, to: next });
      prev = st; st = next; t = 0;
      continue;
    }
    hops = 0;
    const s = G.an.states.get(st);
    const nt = timesOf(s).find((k) => k > t);
    if (nt === undefined) { dwell.set(st, (dwell.get(st) || 0) + (HORIZON - T)); ended = 'rests'; break; }
    dwell.set(st, (dwell.get(st) || 0) + (nt - t));
    T += nt - t;
    t = nt;
  }
  return { ev, unsure, dwell, ended, P };
}

// The trace's loop: the helper state it dwells in longest, and the first
// event of hers there that is sure.
function loopOf(tr) {
  let best = null, n = -1;
  for (const [st, d] of tr.dwell) if (d > n) { best = st; n = d; }
  const first = tr.ev.find((e) => e.kind === 'her' && e.his === best && e.to !== null) || null;
  return { st: best, first };
}
const hasScene = (G, e) => !!e && e.chain.some((C) => G.hScenes.has(C));
const evKey = (e) => e.kind + ':' + e.T + ':' + (e.kind === 'his' ? e.from + '>' + e.to : e.his + '>' + e.to + '>' + e.settled);
// (an event the trace is sure of: before its first doubt)
const sure = (tr, e) => !tr.unsure || tr.ev.indexOf(e) < tr.unsure.i;

// ---- ROLES BY EFFECT -------------------------------------------------------------------
function rolesOf(c, sels) {
  const { G } = c;
  // POSITION: the selector with the most values that send the helper
  // through states of its own no other value's trace has (a family of its
  // own: 3010/3011 for action 1), two or more of them. A value that draws
  // at random (0: a VarRandom, then nothing sure) has none.
  let pos = null;
  for (const s of sels) {
    const sets = s.dom.map((v) => {
      const tr = trace(c, { [s.name]: v }, EVERYONE);
      return { v, his: new Set(tr.ev.filter((e) => e.kind === 'his' && sure(tr, e)).map((e) => e.to)) };
    });
    const vals = sets.filter((x) => [...x.his].some((n) => sets.every((y) => y === x || !y.his.has(n)))).map((x) => x.v);
    if (vals.length >= 2 && (!pos || vals.length > pos.values.length)) pos = { name: s.name, values: vals };
  }
  if (!pos) return null;
  const base = { [pos.name]: pos.values[0] };
  const rest = sels.filter((s) => s.name !== pos.name);
  // SPEED: values that make the loop's pick sure where the base draws it.
  let speed = null;
  {
    const tb = trace(c, base, EVERYONE);
    const lb = loopOf(tb);
    for (const s of rest) {
      const vals = [];
      for (const v of s.dom) {
        if (v === 0) continue;
        const tx = trace(c, Object.assign({}, base, { [s.name]: v }), EVERYONE);
        const lx = loopOf(tx);
        if (!lx.first || !hasScene(G, lx.first) || !sure(tx, lx.first)) continue;
        const baseDraws = tb.unsure && lb.st === lx.st && tb.unsure.his === lx.st;
        if (baseDraws) vals.push({ v, her: lx.first.to });
      }
      const kinds = new Set(vals.map((x) => x.her));
      if (vals.length && kinds.size === vals.length) { speed = { name: s.name, values: vals.map((x) => x.v) }; break; }
    }
  }
  if (speed) base[speed.name] = speed.values[0];
  // The rest against the base held.
  const tb = trace(c, base, EVERYONE);
  const lb = loopOf(tb);
  const neutral = [], other = [];
  let climax = null, version = null;
  const firstScene = tb.ev.find((e) => e.kind === 'her' && hasScene(G, e));
  for (const s of rest) {
    if (speed && s.name === speed.name) continue;
    const roles = new Map();
    for (const v of s.dom) {
      if (v === 0) continue;
      const tx = trace(c, Object.assign({}, base, { [s.name]: v }), EVERYONE);
      let i = 0;
      while (i < tb.ev.length && i < tx.ev.length && evKey(tb.ev[i]) === evKey(tx.ev[i])) i++;
      if (i === tb.ev.length && i === tx.ev.length && !!tb.unsure === !!tx.unsure) { roles.set(v, 'neutral'); continue; }
      const a = tb.ev[i], x = tx.ev[i];
      if (!a || !x || !sure(tx, x)) { roles.set(v, 'other'); continue; }
      if (a.kind === 'her' && x.kind === 'her' && a.his === x.his && x.to !== null) {
        roles.set(v, firstScene && x.T <= firstScene.T ? 'version' : 'other');
        continue;
      }
      // The helper leaves its loop later on, gives her a new scene, and
      // starts its cycle over (a state of its own it ran before her first
      // scene): the finish.
      const before = new Set(tx.ev.filter((e) => e.kind === 'his' && (!firstScene || e.T <= firstScene.T)).map((e) => e.to));
      const after = tx.ev.slice(i);
      const news = after.filter((e) => e.kind === 'her' && hasScene(G, e) && !tb.ev.some((b) => b.kind === 'her' && b.to === e.to));
      const restart = news.length && after.some((e) => e.kind === 'his' && e.T > news[0].T && before.has(e.to));
      const later = lb.first && x.T > lb.first.T;
      roles.set(v, later && restart && sure(tx, news[0]) ? 'climax' : 'other');
    }
    const vals = [...roles.values()];
    const one = (r) => [...roles].filter(([, x]) => x === r).map(([v]) => v);
    if (vals.every((r) => r === 'neutral')) neutral.push(s.name);
    else if (!climax && one('climax').length && vals.every((r) => r === 'climax' || r === 'neutral')) climax = { name: s.name, values: one('climax'), off: 0 };
    else if (!version && one('version').length && vals.every((r) => r === 'version' || r === 'neutral')) version = { name: s.name, values: one('version'), off: 0 };
    else other.push(s.name);
  }
  return { position: { name: pos.name, values: pos.values }, speed, climax, version, neutral, other };
}

// ---- read: once per giver -------------------------------------------------------------
function read(G, ctx, selfLib) {
  const lib = ctx.lib;
  const sums = (G.summons || []).filter((s) => s.helperPlays && Array.isArray(s.starts) && s.starts.length && Number.isFinite(s.no));
  if (!sums.length || !G.fns || !G.fns.W || !G.an.states.get(-1)) return null;
  const tog = togglesOf(G, lib);
  if (!tog.size) return null;
  const helperStates = G.helperReach instanceof Set ? G.helperReach : new Set();
  const reads = parentReadsOf(G, helperStates);
  const lits = literalsOf(G, lib, helperStates);
  const sels = [];
  for (const [name, t] of tog) {
    if (!reads.has(name)) continue;
    const dom = domainOf(lib, name, t, lits);
    if (dom && dom.length >= 2) sels.push({ name, dom, cmds: t.cmds, states: t.states });
  }
  if (!sels.length) return null;
  sels.sort((a, b) => b.dom.length - a.dom.length || a.name.localeCompare(b.name, 'en', { numeric: true }));
  // His variables the helper reads that no step holds: the numbers his files
  // write them where that is one number, else 0 (the round start).
  const defaults = new Map();
  for (const name of reads) {
    const l = lits.get(name);
    defaults.set(name, sels.some((s) => s.name === name) ? 0 : l && l.size === 1 ? [...l][0] : 0);
  }
  const entries = [];
  for (const sm of sums) {
    const c = { G, lib, start: sm.starts[0], from: sm.no, defaults };
    const roles = rolesOf(c, sels);
    if (!roles) continue;
    entries.push({ entry: sm.no, helper: sm.helper, start: sm.starts[0], edgeOnly: !!sm.edgeOnly, place: sm.place || null, roles });
  }
  if (!entries.length) return null;
  const reading = { selectors: sels.map((s) => ({ name: s.name, dom: s.dom, cmds: s.cmds })), entries };
  Object.defineProperty(reading, 'defaults', { value: defaults, enumerable: false });
  return reading;
}

// ---- the steps per receiver ------------------------------------------------------------
function pair(G, R, ctx, reading, selfLib) {
  if (!reading || !R) return null;
  const lib = ctx.lib;
  const has = R.airActions instanceof Set ? R.airActions : new Set(R.airActions || []);
  const name = (E) => (G.grabNames && G.grabNames.get(E)) || 'summon ' + E;
  const worst = (cs) => cs.map((C) => ctx.verdict(C)).reduce((a, b) => (RANK[a] <= RANK[b] ? a : b), 'tailored');
  const steps = [];
  for (const en of reading.entries) {
    const c = { G, lib, start: en.start, from: en.entry, defaults: reading.defaults };
    const ro = en.roles;
    const ref = (n) => lib.varRef(n);
    const speeds = ro.speed ? ro.speed.values : [null];
    const vers = [null, ...(ro.version ? ro.version.values : [])];
    const why = {
      [ro.position.name]: 'his director\'s action, held',
      ...(ro.speed ? { [ro.speed.name]: 'its speed, held' } : {}),
      ...(ro.climax ? { [ro.climax.name]: 'its finish flag, held' } : {}),
      ...(ro.version ? { [ro.version.name]: 'its art type, held' } : {}),
    };
    const setupOf = (pins) => Object.entries(pins).map(([n, v]) => Object.assign({}, ref(n), { value: v, why: why[n] || 'held' }));
    // The step a trace shows: her event `e` (the relay she settles in and
    // the scenes her chain passes), the rest of the cycle beside it.
    const stepOf = (tr, e, pins, label, nav, own) => {
      if (!e || !sure(tr, e)) return null;
      // (her art is asked by the state that hands her to the relay - scenelib's
      // relay demand - so the relay itself is judged only where it is the
      // chain's one scene)
      const before = e.chain.slice(0, -1).filter((C) => G.hScenes.has(C));
      const scenes = before.length ? before : e.chain.filter((C) => G.hScenes.has(C));
      if (!scenes.length) return null;
      const v = worst(scenes);
      if (!SHOWS.has(v)) return null;
      const states = [...new Set([e.settled, ...scenes])].sort((a, b) => a - b);
      const also = [...new Set(tr.ev.filter((x) => x.kind === 'her' && x.to !== null && sure(tr, x)).flatMap((x) => [x.settled, ...x.chain.filter((C) => G.hScenes.has(C))]))]
        .filter((C) => !states.includes(C)).sort((a, b) => a - b);
      const st = { entry: en.entry, group: name(en.entry) + ': director', label, verdict: v, states, path: [{ until: states.slice() }], setup: setupOf(pins), nav,
        clear: en.helper, self: own };
      if (also.length) st.alsoStates = also;
      if (en.edgeOnly) st.edgeOnly = true;
      if (en.place && Number.isFinite(en.place.front)) st.place = Object.assign({}, en.place);
      return st;
    };
    for (const k of ro.position.values) {
      // (a version that plays for her exactly as the first one does - his art
      // type where she lacks its probe - is that one again: no step)
      const sigs = new Map();
      const again = (slot, vi, tr) => {
        const sig = tr.ev.map(evKey).join('|');
        if (vi === 0) { sigs.set(slot, sig); return false; }
        return sigs.get(slot) === sig;
      };
      vers.forEach((ver, vi) => {
        const base = { [ro.position.name]: k };
        if (ro.version) base[ro.version.name] = ver === null ? 0 : ver;
        if (ro.climax) base[ro.climax.name] = 0;
        const made = [];
        speeds.forEach((s, si) => {
          const pins = Object.assign({}, base);
          if (s !== null) pins[ro.speed.name] = s;
          const tr = trace(c, pins, has, R.name);
          const lp = loopOf(tr);
          if (again('s' + si, vi, tr)) return;
          const label = 'action ' + k + (si > 0 ? ', speed ' + (si + 1) : '') + (vi > 0 ? ', type ' + (vi + 1) : '');
          const st = stepOf(tr, lp.first, pins, label, { pos: 'self ' + en.entry + ' a' + k, speed: speeds.length > 1 || ro.climax ? si : null, ver: vi, climax: false, stage: 0 },
            { director: en.entry, action: k, speed: s, version: ver });
          if (st) made.push({ st, tr, lp });
        });
        if (!made.length) return;
        if (ro.climax) {
          const pins = Object.assign({}, base, { [ro.climax.name]: ro.climax.values[0] });
          if (ro.speed) pins[ro.speed.name] = speeds[0];
          const tr = trace(c, pins, has, R.name);
          const b = made[0].tr, lp = made[0].lp;
          if (again('c', vi, tr)) { for (const m of made) steps.push(m.st); return; }
          let i = 0;
          while (i < b.ev.length && i < tr.ev.length && evKey(b.ev[i]) === evKey(tr.ev[i])) i++;
          const e = tr.ev.slice(i).find((x) => x.kind === 'her' && x.to !== null && hasScene(G, x) && x.his !== lp.st) || null;
          const st = stepOf(tr, e, pins, 'action ' + k + ', climax' + (vi > 0 ? ', type ' + (vi + 1) : ''), { pos: 'self ' + en.entry + ' a' + k, speed: null, ver: vi, climax: true, stage: 0 },
            { director: en.entry, action: k, climax: ro.climax.values[0], version: ver });
          if (st) made.push({ st });
        }
        for (const m of made) steps.push(m.st);
      });
    }
  }
  if (!steps.length) return null;
  // A scene of hers these steps show that the core's walk for her does not
  // reach: counted (+1 its verdict, -1 unreachable).
  let counts = null;
  try { counts = selfLib && typeof selfLib.addCounts === 'function' ? selfLib.addCounts(G, ctx, steps) : null; } catch (e) { counts = null; }
  const out = { steps, claims: [...new Set(steps.map((s) => s.entry))] };
  if (counts && Object.keys(counts).length) out.counts = counts;
  return out;
}

module.exports = { read, pair, lib: { togglesOf, domainOf, parentReadsOf, trace, loopOf, rolesOf, HORIZON } };
