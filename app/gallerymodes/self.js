'use strict';
//
// THE SELF PROTOTYPE MODE (gallerymodes/index.js): characters that carry a
// gallery of their own. A prototype: delete this file (and its ROWS and LOAD
// lines, and tools/test-gallery-mode-self.js) and the gallery is as it was.
//
// ONE MODEL. A SELECTOR is a variable of his the player sets with commands
// and his own machine reads to pick a scene. The gallery never steps it: each
// step HOLDS it at one value in the step's `setup` (the hook holds a step's
// setup every frame, as it holds Minotaur's continuous mode - never the toggle
// command). His commit, cancel and gallery-switch commands are the path, his
// poses are positions, the rungs a pose plays by time are its phases and the
// last rung is its climax. Read from his files alone; nothing here names a
// character, a folder or a state number.
//
// THE HUB (select-and-commit; Succubus' in-character gallery, happy_gallery):
// a state H of his (>= 0) with all four of
//   STEPPER  a variable S stepped by VarSets `S = S - k` / `S = S + k` (or a
//            VarAdd of a number), on two or more different playable commands
//            (17001's a and b on var(21));
//   WRAP     VarSets of S to a number, one gated on `S < lo` and one on
//            `S > hi`, every number they set inside [lo, hi]: the domain
//            (17001: [0, 7]);
//   COPY     optional, a VarSet `T = S` (var(20) = var(21));
//   COMMIT   a TargetState and a ChangeState in H on one playable command K
//            that is no stepper, the TargetState's value reading S or T and
//            nothing else, the ChangeState's at most those (c -> her
//            17202 + var(20), him 17002 + var(20)).
// The baomaru hubs (DongHwan, Brian: position variables set to numbers by
// commands, no wrap) are none of it, and neither is a menu with no selector
// (Rule34's Release card) or a pick drawn by a helper (Sanae's quick pick).
//   SIBLINGS: a ChangeState of H on a playable command (no stepper, not K)
//   whose state settles into another hub through zero-tick shells (a state
//   whose only way on is a ChangeState that always fires: 18501 -> 18001);
//   her side is the TargetState on the same command, settled the same way
//   (18500 -> 18201: her WAITING STATE in that hub). Galleries are numbered
//   breadth first from the hub his grab lands in, a tie by the command's
//   rank; a hub nothing reaches (22001) is none.
//   ENTRY: a grab whose no-input flow reaches a hub (21000 -> 17501 -> 17001
//   on its hit); the first hub is the nearest. Her waiting state there is
//   her side of each step of his way in: the TargetState on the trigger of
//   the ChangeState he takes (21000's MoveHit: her 17500 -> 17201).
//   CANCEL: a ChangeState of his pose states into H on a playable command,
//   the one most of them have (17002's a, with her TargetState 17201: her
//   waiting state there).
// PER VALUE v of a gallery's domain, S and T pinned at v and only K asserted,
// his flow from H gives the pose: his states it runs through (by distance
// from H) and her states they give her (an issue her own state settles
// through a shell counts: 21203 -> 21202), with her own chains after them -
// judged for each partner: a ChangeState of hers every line of which reads
// false with her animations is none (18204's `!SelfAnimExist(19231)` into
// 13115, for a partner who ships 19231). Her states group into RUNGS by
// that order: rung 1 is the pose (`pose N`, N = v - lo + 1), every middle
// rung a phase (`pose N, phase k`, a speed) and the last one, where there
// are two or more, its climax (TIMED LADDERS' "the last rung is the climax
// where his scene ends by itself", the hub in place of a basic state). A
// rung her next one follows within 15 ticks is BRIEF (TIMED LADDERS: "a rung
// waits at least 15 ticks"): passed through on the way, waited for in the
// path, never a step or a number of its own (21002 hands her 21202 on to
// 21212 after 10 ticks: 21212 is the pose; 18256's 6 ticks before 18266). Her
// waiting states and releases are no rung. A value that gives the same rungs
// as an earlier one with the same first animation of his (past zero-tick
// shells) is that one again: dropped.
// THE PATH (absolute; in place it runs from where the scene is):
//   1. the cancel, pressed from his pose states of every gallery on the way,
//      until her waiting state in any hub on the way (after a fresh grab it
//      is already there, so nothing is pressed);
//   2. each sibling press on the way, from the hub before it, until her
//      waiting state in that hub or a later one;
//   3. K pressed from the step's hub alone, until rung 1;
//   4. a wait per later rung up to the step's own, from his states up to
//      that rung (past them, in place, grabbed again), with patience the
//      ticks it comes after the rung before plus 120: her own ChangeState's
//      Time (17203 -> 17213 at 600), else his ChangeStates' between the
//      states that give the two and the Time of each one's TargetState
//      (17005's 17215 at 220); 600 where his files compute it. A trigger's
//      lines are ANDed within a group, the groups ORed, a group on a
//      command no wait (20002's `time >= 400` and `animtime = 0`: 400 and
//      its action, never the action alone), and `Time = var(N)` reads var(N)
//      as his state leaves it (the walker's values on its way on: 21002's
//      own `var(25) = 10` every tick), never its value on the way in.
//   In place within its own pose (a phase or the climax after the pose,
//   Space on the pose), each action is done where her state is already past
//   it: its until also names the pose's states from its own rung up to the
//   step's (the core's "until every state past it"), so the scene goes on
//   from where it is instead of from the hub. Not where another value shares
//   the pose's states (21001's 21212; 20001's values 0 and 3): her state
//   tells nothing there, so the path runs from the hub again.
// SETUP per step: S and T at v (both: the entry's shell sets both to 99 on
// its tick, and K at the hub's first tick would read 99), and the WINANE
// GUARD where his files have one. A step whose her states another value of
// its gallery shares (21001's 21202/21212, her art picked by PrevStateNo)
// names his animations there (`anims`, read at each state's first tick).
// THE RUNTIME: the steps play through the core (the setup the hook holds,
// presses with `from`, waits); its Lua chunk registers the mode (the driver
// stops a step whose mode is not registered) and has one rule of its own,
// for the DIRECTOR's steps (self-director.js): a move to one IN PLACE only
// from a step of the same action, version and speed, or into or out of its
// climax; elsewhere grabbed again. Her relay state is the same for every
// action of one art (6004) and the helper reads what is held only when it
// picks (an action every 300 ticks, a speed every 120), so in place the
// step was done at once and its label led the picture by seconds (engine
// run, verified); a fresh summon picks at once (done at t = 51). trimStep
// gives a director step { a, s, v, c } for it. Under -hgallerylog it logs
// her animation as a director step plays ('self: her anim N'), the
// picture's own number (her relay shows the action's art by PrevStateNo).
//
// THE WINANE GUARD: a helper he spawns with keyctrl = 1 whose state
// ParentVarSets a variable on `root,command = X` (turned on) and on
// `command = X && root,command = X` (turned off) is an AI switch the
// gallery's AssertCommand fools: the engine asserts only on the root's own
// command list (char.go 5397-5420), the keyctrl helper reads a copy of the
// player's keys (12664-12672), so it sees the root's command and not its own
// and turns his AI on (Succubus' 9741 -> var(59) = 1: his hub then picks
// poses at random). Every self step holds it at the turned-off value (-1:
// his -3 never spawns 9741 again, `!var(59)`, and one out destroys itself).
//
// CLAIMS: where this mode has a step for her with an entry, the core's steps
// of that entry (21000's "the grab", "press a") give way to these, at the
// first one's place. Counts: a scene of hers these steps reach that the
// core's walk for her does not is added (+1 its verdict, -1 unreachable).
// REACH: the claimed grab keeps the core's grab reach (galreach.js, when
// present: `reach`, `reachMin`, `air`), stamped here the way the core
// stamps its own steps.
//
// FOR THE DIRECTOR (tier B): the pieces above are exported as
// `lib`; a file gallerymodes/self-director.js, when present, is asked too:
// its read(G, ctx, lib) once per giver, its pair(G, R, ctx, reading, lib)
// -> { steps, claims?, counts? } per receiver, merged after the hub's.
const fs = require('fs');
const path = require('path');

const ID = 'self';
const HOP_MAX = 4;        // zero-tick shells followed into a hub or a waiting state
const FLOW_CAP = 400;     // his states one pose's flow may run through
const WAIT_EXTRA = 120;   // a phase's wait: its rung's own ticks and this
const WAIT_DEFAULT = 600; // a phase whose ticks his files do not say
const WAIT_MAX = 3000;
const RUNG_MIN = 15;      // a rung her next one follows sooner is passed through (the core's TIMED LADDERS: 15)

const norm = (e) => String(e == null ? '' : e).toLowerCase().replace(/\s+/g, '');
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, (m) => '\\' + m);
const trigTexts = (sc) => [...sc.trig.all, ...sc.trig.groups.flat()].map(norm);
// A trigger that always fires: `1`, `time = 0` (a shell leaves on its first tick).
const ALWAYS = /^(?:1|time=0|time>=0|!time)$/;
const always = (sc) => {
  const all = sc.trig.all.map(norm), groups = sc.trig.groups.map((g) => g.map(norm));
  if (!all.every((e) => ALWAYS.test(e))) return false;
  return groups.length > 0 ? groups.some((g) => g.length && g.every((e) => ALWAYS.test(e))) : all.length > 0;
};


// THE READING CONTEXT: his base G, a walker of this mode's own (his base's
// options, caches of its own - the core's are never touched - and no
// receiver), gallerydata's lib, and his hubs once found.
function contextOf(G, lib) {
  const W = lib.makeWalker(G.an, Object.assign({}, G.walkerOpts, { victimHas: null, sharedFlows: null, memo: new WeakMap(), trigCache: new WeakMap() }));
  const playable = (k) => { const ci = G.cmdInfo && G.cmdInfo.get(k); return !!(ci && ci.playable); };
  const rank = (k) => { const ci = G.cmdInfo && G.cmdInfo.get(k); return ci ? ci.rank : 999; };
  return { G, W, lib, playable, rank, hubNos: new Set() };
}
const lit = (c, raw) => c.lib.S.lit(raw);
// The first TargetState of a state on each command: Map command -> controller.
function targetsByCmd(c, s) {
  const m = new Map();
  for (const sc of s.sctrls) if (sc.type === 'targetstate') for (const k of c.lib.commandsIn(sc.trig)) if (!m.has(k)) m.set(k, sc);
  return m;
}

// ---- reading his files ----------------------------------------------------------
// THE HUBS of his files (the rule above): [{ no, sel, copy, lo, hi, steppers,
// commit, ts, cs }], by state number.
function findHubs(c) {
  const { G, W, lib } = c;
  const out = [];
  for (const s of G.an.states.values()) {
    if (!(s.no >= 0)) continue;
    const steps = new Map(), lows = new Map(), highs = new Map(), sets = new Map(), copies = new Map();
    const push = (m, k, v) => { if (!m.has(k)) m.set(k, []); m.get(k).push(v); };
    for (const sc of s.sctrls) {
      if (sc.type !== 'varset' && sc.type !== 'varadd') continue;
      const cmds = lib.commandsIn(sc.trig).filter(c.playable);
      const txt = trigTexts(sc);
      for (const [name0, raw] of W.writesOf(sc)) {
        if (!lib.VARNAME.test(name0)) continue;
        const name = name0.toLowerCase(), r = norm(raw), n = esc(name);
        if (sc.type === 'varset' && new RegExp('^' + n + '[-+]\\d+$').test(r) && cmds.length) { for (const k of cmds) push(steps, name, k); continue; }
        if (sc.type === 'varadd' && /^-?\d+$/.test(r) && +r !== 0 && cmds.length) { for (const k of cmds) push(steps, name, k); continue; }
        if (sc.type === 'varset' && /^-?\d+$/.test(r)) {
          for (const t of txt) {
            const lt = new RegExp('(?:^|[^\\w,])' + n + '<(-?\\d+)(?!\\d)').exec(t);
            const gt = new RegExp('(?:^|[^\\w,])' + n + '>(-?\\d+)(?!\\d)').exec(t);
            if (lt) { push(lows, name, +lt[1]); push(sets, name, +r); }
            if (gt) { push(highs, name, +gt[1]); push(sets, name, +r); }
          }
          continue;
        }
        if (sc.type === 'varset' && lib.VARNAME.test(r) && r !== name) copies.set(name, r);
      }
    }
    for (const [S, cmdList] of steps) {
      const steppers = [...new Set(cmdList)];
      if (steppers.length < 2 || !lows.has(S) || !highs.has(S)) continue;
      const lo = Math.min(...lows.get(S)), hi = Math.max(...highs.get(S));
      if (!(lo <= hi) || hi - lo > 63 || !sets.get(S).every((x) => x >= lo && x <= hi)) continue;
      const copy = [...copies].find(([, from]) => from === S);
      const reads = new Set([S, ...(copy ? [copy[0]] : [])]);
      const onlyReads = (raw, need) => {
        const vs = lib.X.varsOf(String(raw == null ? '' : raw)).map((v) => v.toLowerCase());
        return vs.every((v) => reads.has(v)) && (!need || vs.length > 0);
      };
      const byCmd = new Map();
      for (const sc of s.sctrls) {
        if (sc.type !== 'targetstate' && sc.type !== 'changestate') continue;
        for (const k of lib.commandsIn(sc.trig).filter(c.playable)) {
          if (steppers.includes(k)) continue;
          if (!byCmd.has(k)) byCmd.set(k, { ts: null, cs: null });
          const e = byCmd.get(k);
          if (sc.type === 'targetstate' && !e.ts && onlyReads(sc.params.get('value'), true)) e.ts = sc;
          if (sc.type === 'changestate' && !e.cs && onlyReads(sc.params.get('value'), false)) e.cs = sc;
        }
      }
      const commits = [...byCmd].filter(([, e]) => e.ts && e.cs).sort((a, b) => c.rank(a[0]) - c.rank(b[0]));
      if (!commits.length) continue;
      const [commit, e] = commits[0];
      out.push({ no: s.no, sel: S, copy: copy ? copy[0] : null, lo, hi, steppers: steppers.sort((a, b) => c.rank(a) - c.rank(b)), commit, ts: e.ts, cs: e.cs });
    }
  }
  out.sort((a, b) => a.no - b.no);
  return out;
}

// A state settled through zero-tick shells: the first that `stop` accepts, or
// (no stop) the first that has no ChangeState that always fires. null: none
// within HOP_MAX, or a state his files lack.
function settle(c, n, stop) {
  for (let hop = 0; hop <= HOP_MAX && Number.isFinite(n); hop++) {
    if (stop && stop(n)) return n;
    const s = c.G.an.states.get(n);
    if (!s) return null;
    const next = s.sctrls.find((sc) => sc.type === 'changestate' && always(sc) && lit(c, sc.params.get('value')) !== null);
    if (!next) return stop ? null : n;
    n = lit(c, next.params.get('value'));
  }
  return null;
}

// THE WINANE GUARD of his files: { kind, index, value, on, helper } or null.
function winaneGuard(c) {
  const { G, W, lib } = c;
  const states = new Set();
  for (const h of G.helperCtrls || []) {
    const kc = lit(c, h.sc.params.get('keyctrl'));
    const st = lit(c, h.sc.params.get('stateno'));
    if (kc === 1 && st !== null) states.add(st);
  }
  for (const no of [...states].sort((a, b) => a - b)) {
    const s = G.an.states.get(no);
    if (!s) continue;
    const on = new Map(), off = new Map();
    for (const sc of s.sctrls) {
      if (sc.type !== 'parentvarset') continue;
      const groups = sc.trig.groups.map((g) => g.map(norm).join('&&'));
      const rootCmd = groups.filter((g) => /\broot,command="[^"]+"/.test(g));
      if (!rootCmd.length) continue;
      // (its own command beside the root's: `command = X && root,command = X`)
      const own = rootCmd.filter((g) => /(?:^|[^\w,])command="[^"]+"/.test(g.replace(/root,command="[^"]+"/g, '')));
      for (const [name, raw] of W.writesOf(sc)) {
        const v = lit(c, raw);
        if (v === null || !lib.VARNAME.test(name)) continue;
        if (own.length === rootCmd.length) off.set(name.toLowerCase(), v); else if (!own.length) on.set(name.toLowerCase(), v);
      }
    }
    for (const [name, v] of off) {
      if (!on.has(name) || on.get(name) === v) continue;
      const ref = lib.varRef(name);
      if (ref) return { kind: ref.kind, index: ref.index, value: v, on: on.get(name), helper: no };
    }
  }
  return null;
}

// A ChangeState's wait in ticks, from its trigger, or null. Its lines are
// ANDed within one trigger group (triggerall with each triggerN) and the
// groups ORed: a group waits Time = N / Time >= N, AnimTime = 0 on an action
// of known length, both at once N plus that length (20002's `time >= 400`
// and `animtime = 0`: at most 400 + its action, never the action alone); the
// soonest group wins; a group that needs a command is no wait. Time = var(N)
// reads var(N) as the state leaves it
// (`out`: the walker's values on its way on, the state's own writes made:
// 21002's `var(25) = 10` every tick), never its value on the way in.
function ticksOf(c, sc, no, A, out) {
  const all = sc.trig.all.map(norm);
  const groups = sc.trig.groups.length ? sc.trig.groups.map((g) => g.map(norm)) : [[]];
  const varOut = (name) => { const v = out && out[name]; return Array.isArray(v) && v.length === 1 && Number.isFinite(v[0]) ? v[0] : null; };
  let best = null;
  for (const g of groups) {
    let n = null, anim = false, unknown = false;
    for (const t of [...all, ...g]) {
      if (/(?:^|[^\w!])command=/.test(t)) { unknown = true; break; }
      let m = /(?:^|[^\w,])time(?:=|>=)(\d+)/.exec(t);
      if (m) { n = Math.max(n === null ? 0 : n, +m[1]); continue; }
      m = /(?:^|[^\w,])time(?:=|>=)((?:sys)?f?var\(\d+\))$/.exec(t);
      if (m) { const v = varOut(m[1]); if (v === null) unknown = true; else n = Math.max(n === null ? 0 : n, v); continue; }
      if (/(?:^|[^\w,])animtime(?:=|>=)0(?!\d)/.test(t)) anim = true;
    }
    if (unknown) continue;
    let w = n;
    if (anim) { const a = c.W.animTicks(no, A || {}); if (Number.isFinite(a.max) && !a.infinite) w = (n === null ? 0 : n) + a.max; }
    if (w !== null) best = best === null ? w : Math.min(best, w);
  }
  return best;
}
// The walker's values on the way out of his state n (every flow successor's
// values on its way in; a variable they do not agree on is left out).
function outOf(f, n) {
  const next = [...((f && f.edges.get(n)) || [])].map((m) => f.at.get(m)).filter(Boolean);
  if (!next.length) return null;
  const out = {};
  for (const [k, v] of Object.entries(next[0])) if (next.every((x) => Array.isArray(x[k]) && x[k].length === v.length && x[k].every((y, i) => y === v[i]))) out[k] = v;
  return out;
}
// The ticks state `from` waits before it goes on to `to` (his or hers), or null.
function waitInto(c, from, to, A, out) {
  const s = c.G.an.states.get(from);
  if (!s) return null;
  let best = null;
  for (const sc of s.sctrls) {
    if (sc.type !== 'changestate') continue;
    if (!c.W.values(sc.params.get('value'), A || {}, from).includes(to)) continue;
    const t = ticksOf(c, sc, from, A, out);
    if (t !== null) best = best === null ? t : Math.min(best, t);
  }
  return best;
}
const isShell = (c, n) => { const s = c.G.an.states.get(n); return !!(s && s.sctrls.some((sc) => sc.type === 'changestate' && always(sc))); };

// ONE POSE: the hub's selector pinned at v (in A), only K asserted, read with
// no receiver. -> { his, dist, f, A, direct, first, anims } or null.
//   his     his states the pose runs through, by distance from the hub
//   direct  her states his states give her: Map state -> that distance (an
//           issue that is no custom state settles through her shells:
//           21203 -> 21202, given by the hub)
//   first   the animations of his first state past zero-tick shells
//   anims   every animation his pose states start with (null: one unknown)
// Her rungs come from it per receiver (rungsOf).
function poseOf(c, hub, A) {
  const { G, W } = c;
  const f = W.flow([{ no: hub.no, A, cont: true }], new Set([hub.commit]), FLOW_CAP);
  const dist = new Map([[hub.no, 0]]);
  const q = [hub.no];
  while (q.length) {
    const n = q.shift();
    if (n !== hub.no && c.hubNos.has(n)) continue;
    for (const m of f.edges.get(n) || []) if (!dist.has(m)) { dist.set(m, dist.get(n) + 1); q.push(m); }
  }
  const his = [...dist.keys()].filter((n) => !c.hubNos.has(n)).sort((a, b) => dist.get(a) - dist.get(b) || a - b);
  if (!his.length) return null;
  const direct = new Map();
  const give = (C, d) => { if (!direct.has(C) || direct.get(C) > d) direct.set(C, d); };
  for (const [C, from] of f.issued) {
    const d = Math.min(...[...from].map((n) => (dist.has(n) ? dist.get(n) : Infinity)));
    if (Number.isFinite(d)) give(C, d);
  }
  for (const v of W.values(hub.ts.params.get('value'), A, hub.no)) {
    if (W.custom.has(v)) continue;
    const C = settle(c, v, (n) => W.custom.has(n));
    if (C !== null) give(C, 0);
  }
  if (!direct.size) return null;
  const animsAt = (n) => { try { return W.animTicks(n, f.at.get(n) || A).anims; } catch (e) { return []; } };
  const firstNo = his.find((n) => !isShell(c, n));
  const first = firstNo === undefined ? [] : animsAt(firstNo).slice().sort((a, b) => a - b);
  let anims = new Set();
  for (const n of his) {
    if (isShell(c, n)) continue;
    const a = animsAt(n);
    if (!a.length) { anims = null; break; }
    for (const x of a) anims.add(x);
  }
  return { his, dist, f, A, direct, first, anims };
}

// Her own ChangeState from C0 to C2 can fire for her: false only where every
// such line of hers reads false with her animations (18204's
// `!SelfAnimExist(19231)` into 13115 is none for a partner who ships 19231).
function herEdgeOk(c, C0, C2, has) {
  const s = c.G.an.states.get(C0);
  if (!s || !has) return true;
  let any = false;
  for (const sc of s.sctrls) {
    if (sc.type !== 'changestate') continue;
    if (!c.W.values(sc.params.get('value'), {}, C0).includes(C2)) continue;
    any = true;
    let v = null;
    try { v = c.lib.X.evalTriggerSet(sc.trig, { selfHas: has }); } catch (e) { v = null; }
    if (v !== false) return true;
  }
  return !any;
}

// A POSE'S RUNGS for a partner (`has`: her animations; null: anyone): her
// states, ordered by [distance of his state that gives them, hops along her
// own chain], grouped by that order. -> [{ her, at, his, ticks }]
//   his    his states up to the rung (a wait's `from`)
//   ticks  what the ChangeState into the rung waits, his or hers (null:
//          unknown)
function rungsOf(c, pose, waiting, has) {
  const { G } = c;
  const isRelease = (C) => { const sc = G.an.scenes.get(C); return !!(sc && sc.release); };
  const shows = (C) => G.hScenes.has(C) && !isRelease(C) && !waiting.has(C);
  const rank = new Map();
  const better = (C, r) => {
    const o = rank.get(C);
    if (o && (o[0] < r[0] || (o[0] === r[0] && o[1] <= r[1]))) return false;
    rank.set(C, r);
    return true;
  };
  for (const [C, d] of pose.direct) better(C, [d, 0]);
  for (let grew = true; grew;) {
    grew = false;
    for (const [C, r] of [...rank]) for (const C2 of G.chains.get(C) || []) {
      const need = G.chainPrev && G.chainPrev.get(C + '>' + C2);
      if (need && ![...need].some((p) => rank.has(p))) continue;
      if (waiting.has(C2) || !herEdgeOk(c, C, C2, has)) continue;
      if (better(C2, [r[0], r[1] + 1])) grew = true;
    }
  }
  const her = [...rank].filter(([C]) => shows(C)).sort((a, b) => a[1][0] - b[1][0] || a[1][1] - b[1][1] || a[0] - b[0]);
  const rungs = [];
  for (const [C, r] of her) {
    const last = rungs[rungs.length - 1];
    if (last && last.at[0] === r[0] && last.at[1] === r[1]) last.her.push(C);
    else rungs.push({ her: [C], at: r });
  }
  const { his, dist, f, A } = pose;
  // (his states at a rung's distance; the hub's own issue counts from the
  // state its commit enters)
  const at = (d) => his.filter((n) => dist.get(n) === Math.max(1, d));
  // (the tick his state gives a rung by a TargetState: its Time; the hub's
  // own, on the commit's press, 0; null: a time his files compute)
  const givenAt = (rr) => {
    if (rr.at[0] === 0) return 0;
    let t = null, seen = false;
    for (const n of his.filter((x) => dist.get(x) === rr.at[0])) {
      const s = G.an.states.get(n);
      for (const sc of (s ? s.sctrls : [])) {
        if (sc.type !== 'targetstate') continue;
        const vals = c.W.values(sc.params.get('value'), f.at.get(n) || A, n).map((v) => (c.W.custom.has(v) ? v : settle(c, v, (x) => c.W.custom.has(x))));
        if (!vals.some((v) => rr.her.includes(v))) continue;
        seen = true;
        const x = ticksOf(c, sc, n, f.at.get(n) || A, outOf(f, n));
        if (x !== null) t = t === null ? x : Math.min(t, x);
      }
    }
    return seen ? t : 0;
  };
  const pathTicks = (a, b) => {
    if (a === b) return 0;
    const prev = new Map([[a, null]]);
    const q = [a];
    while (q.length && !prev.has(b)) { const n = q.shift(); for (const m of f.edges.get(n) || []) if (dist.has(m) && !c.hubNos.has(m) && !prev.has(m)) { prev.set(m, n); q.push(m); } }
    if (!prev.has(b)) return null;
    let t = 0;
    for (let n = b; prev.get(n) !== null; n = prev.get(n)) { const x = waitInto(c, prev.get(n), n, f.at.get(prev.get(n)) || A, outOf(f, prev.get(n))); if (x === null) return null; t += x; }
    return t;
  };
  for (let k = 0; k < rungs.length; k++) {
    const r = rungs[k];
    r.his = his.filter((n) => dist.get(n) <= Math.max(1, r.at[0] + 1 + r.at[1]));
    r.ticks = null;
    if (k === 0) continue;
    const p = rungs[k - 1];
    let t = null;
    const take = (x) => { if (x !== null) t = t === null ? x : Math.min(t, x); };
    // her own chain: her ChangeState out of the rung before
    if (r.at[1] > 0) for (const C0 of p.her) for (const C of r.her) take(waitInto(c, C0, C, {}));
    // his: from the state that gave the rung before to the one that gives
    // this one, and when each gives it (17005's TargetState at Time = 220)
    if (t === null && r.at[1] === 0) {
      const t1 = givenAt(r), t0 = p.at[1] === 0 ? givenAt(p) : 0;
      if (t1 !== null && t0 !== null) for (const a of at(p.at[0])) for (const b of at(r.at[0])) { const x = pathTicks(a, b); if (x !== null) take(Math.max(0, x + t1 - t0)); }
    }
    r.ticks = t;
  }
  // A rung the next one follows within RUNG_MIN ticks is BRIEF: passed
  // through on the way (its own wait in the path), never a step of its own
  // (21002's 10 ticks of her 21202 before the pose's 21212).
  for (let k = 0; k + 1 < rungs.length; k++) if (rungs[k + 1].ticks !== null && rungs[k + 1].ticks < RUNG_MIN) rungs[k].brief = true;
  return rungs;
}

// Breadth first from a hub over the sibling presses, a tie by the command's
// rank: [{ hub, depth, chain: [{ cmd, from, to, herTo }] }].
function galleriesFrom(c, hubs, first) {
  const byNo = new Map(hubs.map((h) => [h.no, h]));
  const seen = new Map([[first, { hub: byNo.get(first), depth: 0, chain: [] }]]);
  const q = [first];
  while (q.length) {
    const n = q.shift();
    const g = seen.get(n);
    const sib = (byNo.get(n).siblings || []).slice().sort((a, b) => c.rank(a.cmd) - c.rank(b.cmd) || a.to - b.to);
    for (const e of sib) {
      if (seen.has(e.to)) continue;
      seen.set(e.to, { hub: byNo.get(e.to), depth: g.depth + 1, chain: [...g.chain, { cmd: e.cmd, from: n, to: e.to, herTo: e.herTo }] });
      q.push(e.to);
    }
  }
  return [...seen.values()];
}

// ---- read: once per giver ----------------------------------------------------------
// -> { hubs, guard, entries: [{ entry, first, galleries: [{ g, hub, depth,
// chain, sel, copy, selRef, copyRef, lo, hi, commit, steppers, cancel, waiting,
// poses: [{ v, rungs, his, first, anims }] }] }] } or null.
function readHub(G, lib) {
  const c = contextOf(G, lib);
  const { W } = c;
  const hubs = findHubs(c);
  if (!hubs.length) return null;
  for (const h of hubs) c.hubNos.add(h.no);
  for (const h of hubs) {
    h.siblings = [];
    const s = G.an.states.get(h.no);
    const ts = targetsByCmd(c, s);
    for (const sc of s.sctrls) {
      if (sc.type !== 'changestate') continue;
      for (const k of lib.commandsIn(sc.trig).filter(c.playable)) {
        if (k === h.commit || h.steppers.includes(k) || h.siblings.some((e) => e.cmd === k)) continue;
        const to = settle(c, lit(c, sc.params.get('value')), (n) => c.hubNos.has(n));
        if (to === null || to === h.no) continue;
        const t = ts.has(k) ? lit(c, ts.get(k).params.get('value')) : null;
        h.siblings.push({ cmd: k, to, herTo: t === null ? null : settle(c, t, null) });
      }
    }
  }
  const guard = winaneGuard(c);
  const entries = [];
  for (const grab of G.grabs || []) {
    const E = grab.no;
    const machine = W.flow([{ no: E, A: G.initial || {}, prev: 0 }], null);
    if (![...c.hubNos].some((n) => machine.at.has(n))) continue;
    const A0 = G.pinsFor(lib.NO_INPUT, new Set(machine.at.keys()));
    const fE = W.flow([{ no: E, A: Object.assign({}, A0), prev: 0 }], lib.NO_INPUT);
    const dist = new Map([[E, 0]]), prev = new Map([[E, null]]);
    const q = [E];
    let first = null;
    while (q.length) {
      const n = q.shift();
      if (c.hubNos.has(n)) { first = n; break; }
      for (const m of fE.edges.get(n) || []) if (!dist.has(m)) { dist.set(m, dist.get(n) + 1); prev.set(m, n); q.push(m); }
    }
    if (first === null) continue;
    // Her waiting state in the first hub: her side of each step of his way
    // into it (a TargetState on the trigger of the ChangeState he takes:
    // 21000's MoveHit, her 17500), settled through her shells.
    const herFirst = new Set();
    for (let n = first; prev.get(n) !== null; n = prev.get(n)) {
      const X0 = prev.get(n), s = G.an.states.get(X0), AX = fE.at.get(X0) || A0;
      if (!s) continue;
      const trigs = new Set(s.sctrls.filter((sc) => sc.type === 'changestate' && W.values(sc.params.get('value'), AX, X0).includes(n)).map((sc) => trigTexts(sc).join('|')));
      for (const sc of s.sctrls) {
        if (sc.type !== 'targetstate' || !trigs.has(trigTexts(sc).join('|'))) continue;
        for (const t of W.values(sc.params.get('value'), AX, X0)) { const w = settle(c, t, null); if (w !== null && !G.hScenes.has(w)) herFirst.add(w); }
      }
    }
    entries.push({ entry: E, first, A0, fE, herFirst });
  }
  if (!entries.length) return null;
  const readings = [];
  for (const en of entries) {
    const gals = galleriesFrom(c, hubs, en.first);
    const waiting = new Map(gals.map((g) => [g.hub.no, new Set()]));
    for (const x of en.herFirst) waiting.get(en.first).add(x);
    for (const g of gals) for (const e of g.chain) if (e.herTo !== null && waiting.has(e.to)) waiting.get(e.to).add(e.herTo);
    // The variables each hub is entered with: the grab's flow, then the presses.
    const atHub = new Map([[en.first, en.fE.at.get(en.first) || en.A0]]);
    for (const g of gals) {
      if (!g.chain.length) continue;
      const e = g.chain[g.chain.length - 1];
      const from = atHub.get(e.from) || en.A0;
      const f = W.flow([{ no: e.from, A: from, cont: true }], new Set([e.cmd]), FLOW_CAP);
      atHub.set(g.hub.no, f.at.get(g.hub.no) || from);
    }
    // Every value's pose, read with no receiver.
    const raw = gals.map((g) => {
      const hub = g.hub, list = [];
      for (let v = hub.lo; v <= hub.hi; v++) {
        const A = Object.assign({}, en.A0, atHub.get(hub.no) || {});
        A[hub.sel] = [v];
        if (hub.copy) A[hub.copy] = [v];
        if (guard) A[guard.kind + '(' + guard.index + ')'] = [guard.value];
        const p = poseOf(c, hub, A);
        if (p) list.push(Object.assign({ v }, p));
      }
      return list;
    });
    // The cancel: a ChangeState of his pose states into the hub on a
    // playable command (the one most of them have); her side settles to her
    // waiting state there.
    const cancels = gals.map((g, gi) => {
      const hub = g.hub, votes = new Map();
      for (const p of raw[gi]) for (const n of p.his) {
        const s = G.an.states.get(n);
        if (!s) continue;
        const ts = targetsByCmd(c, s);
        for (const sc of s.sctrls) {
          if (sc.type !== 'changestate' || lit(c, sc.params.get('value')) !== hub.no) continue;
          for (const k of lib.commandsIn(sc.trig).filter(c.playable)) {
            if (!votes.has(k)) votes.set(k, { n: 0, from: new Set(), her: new Set() });
            const e = votes.get(k);
            if (!e.from.has(n)) { e.n++; e.from.add(n); }
            const t = ts.has(k) ? lit(c, ts.get(k).params.get('value')) : null;
            const w = t === null ? null : settle(c, t, null);
            if (w !== null) e.her.add(w);
          }
        }
      }
      const best = [...votes].sort((a, b) => b[1].n - a[1].n || c.rank(a[0]) - c.rank(b[0]))[0] || null;
      if (best) for (const w of best[1].her) waiting.get(hub.no).add(w);
      return best ? { cmd: best[0], from: [...best[1].from].sort((a, b) => a - b) } : null;
    });
    // (her waiting states are no rung of any pose)
    const waitingAll = new Set([...waiting.values()].flatMap((s) => [...s]));
    const out = gals.map((g, gi) => {
      const hub = g.hub, poses = [], seen = new Set();
      for (const p of raw[gi]) {
        const rungs = rungsOf(c, p, waitingAll, null);
        if (!rungs.length) continue;
        const key = JSON.stringify(rungs.map((r) => r.her)) + '|' + p.first.join(',');
        if (seen.has(key)) continue;
        seen.add(key);
        poses.push(Object.assign(p, { rungs }));
      }
      return { g: gi + 1, hub: hub.no, depth: g.depth, chain: g.chain, sel: hub.sel, copy: hub.copy, selRef: lib.varRef(hub.sel), copyRef: hub.copy ? lib.varRef(hub.copy) : null,
        lo: hub.lo, hi: hub.hi, commit: hub.commit, steppers: hub.steppers, cancel: cancels[gi], waiting: [...waiting.get(hub.no)].sort((a, b) => a - b), poses };
    });
    readings.push({ entry: en.entry, first: en.first, waitingAll: [...waitingAll].sort((a, b) => a - b), galleries: out });
  }
  const reading = { hubs: hubs.map((h) => ({ no: h.no, sel: h.sel, copy: h.copy, lo: h.lo, hi: h.hi, steppers: h.steppers, commit: h.commit, siblings: h.siblings })), guard, entries: readings };
  // (the reading context, for the steps per receiver; not enumerable)
  Object.defineProperty(reading, 'c', { value: c, enumerable: false });
  return reading;
}

// ---- the steps (walk-shaped; ctx.pairSteps judges them for her) --------------
// `has`: her animations (her own chains judged for her: rungsOf); null: anyone.
function hubSteps(G, reading, has) {
  const steps = [];
  const c = reading.c;
  const name = (E) => (G.grabNames && G.grabNames.get(E)) || 'grab ' + E;
  for (const en of reading.entries) {
    const gals = new Map(en.galleries.map((g) => [g.hub, g]));
    const waitingAll = new Set(en.waitingAll);
    const posesOf = new Map(en.galleries.map((gal) => [gal, gal.poses.map((p) => ({ v: p.v, anims: p.anims, rungs: c && has ? rungsOf(c, p, waitingAll, has) : p.rungs })).filter((p) => p.rungs.length)]));
    // (her states a pose of any gallery of the entry shares with another)
    const herAll = new Map();
    for (const ps of posesOf.values()) for (const p of ps) for (const C of new Set(p.rungs.flatMap((r) => r.her))) herAll.set(C, (herAll.get(C) || 0) + 1);
    for (const gal of en.galleries) {
      const poses = posesOf.get(gal);
      if (!poses.length) continue;
      const on = [...gal.chain.map((e) => gals.get(e.from)), gal];
      if (on.some((g) => !g)) continue;
      const herWait = (g) => g.waiting || [];
      const herCount = new Map();
      for (const p of poses) for (const C of new Set(p.rungs.flatMap((r) => r.her))) herCount.set(C, (herCount.get(C) || 0) + 1);
      const setup = (v) => {
        const out = [{ kind: gal.selRef.kind, index: gal.selRef.index, value: v, why: 'his own gallery\'s selector, held at this pose' }];
        if (gal.copyRef) out.push({ kind: gal.copyRef.kind, index: gal.copyRef.index, value: v, why: 'its copy, held with it' });
        if (reading.guard) out.push({ kind: reading.guard.kind, index: reading.guard.index, value: reading.guard.value, why: 'his AI switch at its turned-off value (a keyctrl helper the gallery\'s commands would fool)' });
        return out;
      };
      // 1. the cancel, from his pose states of every gallery on the way
      const lead = [];
      const cancels = on.map((g) => g.cancel).filter(Boolean);
      const waitAll = [...new Set(on.flatMap(herWait))].sort((a, b) => a - b);
      if (cancels.length && cancels.every((x) => x.cmd === cancels[0].cmd) && waitAll.length) {
        lead.push({ cmd: cancels[0].cmd, mode: 'press', from: [...new Set(cancels.flatMap((x) => x.from))].sort((a, b) => a - b), until: waitAll });
      }
      // 2. the sibling presses on the way (each needs her waiting state to wait for)
      let chainOk = true;
      gal.chain.forEach((e, i) => {
        const until = [...new Set(on.slice(i + 1).flatMap(herWait))].sort((a, b) => a - b);
        if (!until.length) { chainOk = false; return; }
        lead.push({ cmd: e.cmd, mode: 'press', from: [e.from], until });
      });
      if (!chainOk) continue;
      for (const p of poses) {
        const N = p.v - gal.lo + 1;
        // (a brief rung is no step: the rungs shown are numbered alone)
        const shown = p.rungs.map((r, k) => k).filter((k) => !p.rungs[k].brief);
        const n = shown.length;
        const shared = p.rungs.some((r) => r.her.some((C) => herCount.get(C) > 1));
        // (in place within its own pose: each action is done where her
        // state is already past it, up to the step's rung - only where no
        // other pose shares her states, which then tell nothing)
        const own = !p.rungs.some((r) => r.her.some((C) => herAll.get(C) > 1));
        for (let i = 0; i < n; i++) {
          const k = shown[i];
          const climax = n >= 2 && i === n - 1;
          const upto = (list, j) => [...new Set([...list, ...(own ? p.rungs.slice(j, k + 1).flatMap((r) => r.her) : [])])].sort((a, b) => a - b);
          const path = lead.map((a) => Object.assign({}, a, { from: a.from.slice(), until: upto(a.until, 0) }));
          path.push({ cmd: gal.commit, mode: 'press', from: [gal.hub], until: upto(p.rungs[0].her, 0) });
          for (let j = 1; j <= k; j++) {
            const r = p.rungs[j];
            path.push({ until: upto(r.her, j), from: r.his.slice(), patience: Math.min(WAIT_MAX, (r.ticks !== null ? r.ticks : WAIT_DEFAULT) + WAIT_EXTRA) });
          }
          const st = {
            entry: en.entry, kind: 'self', group: name(en.entry) + ': gallery ' + gal.g,
            label: 'pose ' + N + (climax ? ', climax' : i > 0 ? ', phase ' + (i + 1) : ''),
            until: p.rungs[k].her.slice().sort((a, b) => a - b),
            also: [...new Set([...waitAll, ...p.rungs.slice(0, k).flatMap((r) => r.her)])].sort((a, b) => a - b),
            path, setup: setup(p.v),
            nav: { pos: 'self ' + en.entry + ' g' + gal.g + ' p' + p.v, speed: climax ? null : i > 0 ? i : n >= 3 ? 0 : null, ver: 0, climax, stage: 0 },
            artKey: 'self ' + gal.g + ':' + p.v,
            self: { gallery: gal.g, hub: gal.hub, value: p.v, rung: i + 1, rungs: n },
          };
          if (shared && p.anims && p.anims.size) st.anims = [...p.anims].sort((a, b) => a - b);
          steps.push(st);
        }
      }
    }
  }
  return steps;
}

// The grab reach the core stamps on its own steps (galreach.js, where the
// build has it): the claimed grab keeps it.
let galreach;
function stampReach(G, R, steps) {
  if (galreach === undefined) { try { galreach = require(path.join(__dirname, '..', 'galreach.js')); } catch (e) { galreach = null; } }
  if (!galreach || !R || !R.body) return;
  const per = new Map();
  for (const st of steps) {
    if (st.place || st.companion || st.clear !== undefined) continue;
    if (!per.has(st.entry)) {
      let r = null, air = null;
      try { r = galreach.giverReach(G, st.entry, R.body); air = galreach.airOf(G, st.entry); } catch (e) { r = null; air = null; }
      per.set(st.entry, { r, air });
    }
    const { r, air } = per.get(st.entry);
    if (r) { st.reach = r.d; st.reachMin = r.lo; }
    if (air) st.air = { y: air.y, vx: air.vx, vy: air.vy };
  }
}

// A scene these steps show her that the core's walk for her does not reach:
// counted (+1 its verdict, -1 unreachable).
function addCounts(G, ctx, steps) {
  let walk = null;
  try { walk = ctx.walk(); } catch (e) { walk = null; }
  const core = new Set(walk ? walk.steps.flatMap((st) => [...st.until, ...(st.also || [])]) : []);
  const counts = {};
  for (const C of new Set(steps.flatMap((st) => [...st.states, ...(st.alsoStates || [])]))) {
    if (!G.hScenes.has(C) || core.has(C)) continue;
    const v = ctx.verdict(C);
    counts[v] = (counts[v] || 0) + 1;
    counts.unreachable = (counts.unreachable || 0) - 1;
  }
  return counts;
}

// ---- the director's file, if present -------------------------------------------------
// (Not a literal require: the file may not exist; make-portable and make-kit
// copy this folder whole.)
let director;
function directorOf() {
  if (director === undefined) {
    director = null;
    const p = path.join(__dirname, 'self-director.js');
    try { if (fs.existsSync(p)) director = require(p); } catch (e) { console.warn('H gallery: mode self: its director is off: ' + String((e && e.message) || e).slice(0, 200)); director = null; }
  }
  return director;
}

const lib = { contextOf, findHubs, settle, winaneGuard, ticksOf, waitInto, poseOf, rungsOf, herEdgeOk, galleriesFrom, readHub, hubSteps, stampReach, addCounts, always, ALWAYS };

// ---- the mode's hooks ----------------------------------------------------------------
function read(G, ctx) {
  const hub = readHub(G, ctx.lib);
  let dir = null;
  const D = directorOf();
  if (D && typeof D.read === 'function') {
    try { dir = D.read(G, ctx, lib); } catch (e) { console.warn('H gallery: mode self: its director left out ' + ((ctx.g && ctx.g.select) || '') + ': ' + String((e && e.message) || e).slice(0, 200)); dir = null; }
  }
  if (!hub && dir == null) return null;
  return { hub, director: dir == null ? null : dir };
}

function pair(G, R, ctx) {
  const reading = ctx.reading;
  if (!reading) return null;
  let steps = [], claims = [];
  const counts = {};
  if (reading.hub) {
    const made = ctx.pairSteps(hubSteps(G, reading.hub, R && R.airActions instanceof Set ? R.airActions : null));
    stampReach(G, R, made);
    steps = made;
    claims = [...new Set(made.map((s) => s.entry))];
    Object.assign(counts, addCounts(G, ctx, made));
  }
  const D = reading.director != null ? directorOf() : null;
  if (D && typeof D.pair === 'function') {
    let x = null;
    try { x = D.pair(G, R, ctx, reading.director, lib); } catch (e) { console.warn('H gallery: mode self: its director left out for ' + ((ctx.r && ctx.r.select) || 'a pair') + ': ' + String((e && e.message) || e).slice(0, 200)); x = null; }
    if (x && Array.isArray(x.steps) && x.steps.length) {
      steps = steps.concat(x.steps);
      if (Array.isArray(x.claims)) claims = [...new Set([...claims, ...x.claims.filter(Number.isFinite)])];
      if (x.counts) for (const [k, v] of Object.entries(x.counts)) if (Number.isFinite(v)) counts[k] = (counts[k] || 0) + v;
    }
  }
  if (!steps.length) return null;
  const out = { steps, claims };
  if (Object.keys(counts).length) out.counts = counts;
  return out;
}

// THE RUNTIME (header). A director's step (its `self.director`) carries what
// it holds for the runtime's in-place rule: step.self = { a, s, v, c } (the
// action, speed and version values, 0 where none; c its climax). A hub's
// step carries nothing of its own.
const int = (x) => (Number.isInteger(x) ? x : 0);
function trimStep(s, out) {
  const d = s.self;
  if (!d || typeof d !== 'object' || d.director == null) return null;
  out.self = { a: int(d.action), s: int(d.speed), v: int(d.version), c: !!(s.nav && s.nav.climax) };
  return null;
}
function lua() {
  return [
    "MODE.add('self', function()",
    '  -- (a self gallery\'s steps play through the core: setup holds, presses, waits)',
    '  local M = {}',
    '  -- A director step: in place only from one of the same action, version',
    '  -- and speed, or into or out of its climax; elsewhere grabbed again (her',
    '  -- relay is the same for every action, and the helper reads what is held',
    '  -- only when it picks: in place the label would lead the picture).',
    '  function M.inPlace(prev, s)',
    '    local d = s.self',
    '    if d == nil then return true end',
    "    local p = prev and prev.ext == 'self' and prev.self or nil",
    '    if p == nil or p.a ~= d.a or p.v ~= d.v then return false end',
    '    return p.s == d.s or p.c == true or d.c == true',
    '  end',
    '  -- (the log, for the tests: her animation as a director step plays)',
    '  function M.tick(s)',
    '    if not LOG or s.self == nil then return end',
    '    local a = onR(function() return anim() end)',
    '    if G.m == nil then G.m = {} end',
    "    if a ~= G.m.anim then G.m.anim = a; log('self: her anim ' .. tostring(a) .. ' t=' .. G.t) end",
    '  end',
    '  return M',
    'end)',
  ].join('\n');
}

module.exports = { id: ID, read, pair, trimStep, lua, lib };
