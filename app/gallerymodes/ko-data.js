'use strict';
// THE KO MODE'S DATA (gallerymodes/ko.js is the entry): which scenes come
// only with her KO, her life low or the match over, and the path that shows
// each one. Read from his files and the core walk, through the foundation's
// seams only (ctx.walk, ctx.lib.makeWalker with opts.gate, ctx.pairSteps,
// ctx.memo); the rules read the files, never a character's name or a fixed
// state number (the numbers below are examples).
//
// THE GATES. A line of his that reads her KO or the round is a GATE
// (triggerGate), read from its trigger's text, her atoms redirected
// (`target,life`, `enemy,alive`, `p2life`) and the round's bare
// (`RoundState`, `MatchOver`, `Win`), one way through it (triggerall and
// one group) at a time:
//   LIFE(N)  her life with a bound and nothing else of the KO: `<= N` is N,
//            `< N` N-1, `= N` N (`target,life <= 2`: the spanking finisher);
//            she stays alive, the round runs.
//   DEAD     her alive read as 0 (`!target,alive`, `enemy,alive = 0`): she is
//            KO'd inside his scene, the round held (frozen) at 2.
//   OVER     the round past 2 (`RoundState = 3`, `>= 3`), MatchOver or a win
//            read as true: she is KO'd and the engine ends the round; `round`
//            is the number it compares (3, 4, or 'any' with none).
// Over wins over dead, dead over life. A way through it that compares a name
// (`name = "..."`, `p2name`, `authorname`, redirected or not, not negated)
// is never a gate, and a chain of hers keyed on a name in every way is never
// followed: a scene keyed on a partner's name is never offered. Her own
// chains (a ChangeState of a scene state of hers) read the same atoms bare:
// her `life` and `alive` (`alive = 0`: her own KO lie-down).
//
// HIS FLOWS ARE THE GIVER'S. Each core walk step of the pair is a LEAD: its
// grab (or summon) flowed again with its path's commands asserted (one flow,
// the union of them, from the pins the core starts that grab with; a jump of
// its path a start too: an approximation - a step the runtime cannot reach
// reports 'did not reach this scene'), as the running round and under a
// gate (makeWalker opts.gate; a summon's helper flowed the same way from its
// own starts). Her answers to his probes are left unknown (a branch on her
// art may go either way), so the flows are made once per giver (ctx.memo)
// and what she draws is the pair's judging (ctx.pairSteps). A gate is walked
// for a lead only where its flow - as the running round, or under a gate
// already walked for it (LIFE before DEAD before OVER, so a KO behind her low
// life is found) - passes a line that reads that very gate, or shows a scene
// a chain of hers on it leaves.
//
// A KO SCENE of a lead: a scene that shows under the gate and not in the
// running round, that no core step of the pair shows and no earlier KO step
// took, and that comes from states of his that follow the ones giving the
// lead's own scenes (HER WAY IN: his flow walks every branch her art may
// take; the grab's machine she is in is the lead's). Leads are tried
// shortest path first, gates LIFE (each N, the loosest first), DEAD, OVER,
// so a scene goes to the least the gallery must do to her. Her chains close
// what shows under the same view: every chain of hers that reads the KO or
// the round is evaluated under it - added where it holds there (her lie-down
// on `alive = 0` while she is dead), blocked where it does not (a CG of hers
// on `RoundState = 3` never comes in the running round), the core's other
// chains kept. TWINS: the same scene from states of his with none in common
// is a step of its own (the core's rule: a scene is her state AND his state
// that gives it), so the buster's KO pose is not the throw's. A scene no
// lead leads to is never offered (a slaughter KO from his ordinary moves).
//
// BRANCHES: where one state of hers the KO brings goes on to two or more of
// those scenes by chains that read which state he is in or came from
// (`EnemyNear,StateNo = 188`, `PrevStateNo = 2305`), each is a step of its
// own, "(experimental k)": the gallery cannot choose that move.
//
// THE KO STEP (walk-shaped, judged for her by ctx.pairSteps; no stage
// copies): the lead's entry, path, place, clear, clearAlso, edgeOnly, proj,
// setup, reroll, anims, withCtrl and noGrab, its path followed by ONE KO
// ACTION:
//   { ext: 'ko', until: [the KO scenes], from: [his states], patience,
//     ko: { life, kill, round } }
// - `ko` is the gate as the runtime makes it (gallerymodes/ko-rt.js): LIFE(N)
//   { life: N, kill: 'none', round: 'live' }, DEAD { life: 0, kill: 'now',
//   round: 'freeze' }, OVER { life: 0, kill: 'now', round: 'end' }.
// - `from`: the states of his that give her the scenes (the issuers, or the
//   issuers of the scene her chain leaves), and the states on the way there
//   whose own lines read a gate this one makes true (1360's `target,life <=
//   2` before 1371 gives her 1375); none for a helper's scene or one no state
//   of his walked gives (it arms at once). His state outside `from` on a
//   fresh grab is waited out, as for every wait.
// - `patience`: the longest wait the core gives a step of that grab that
//   waits in one of those states (a timed ladder's), at least 900.
// - The step: `leaf`, group "KO: " and the lead's group, label "(violent)"
//   first where it is (the overlay cuts a long label at its end), what the
//   gate does, its other mark, then the lead's own label where it is more
//   than its grab ("her life at 2, after press y", "(violent) her KO", "the
//   round won (experimental 2)"), `ext: 'ko'`, `ko` { gate, life, violent, lead, after?, his?,
//   experimental? }, `edge` (pairSteps keeps twins apart) and `nav` its own
//   position, after the pair's own positions (a mode's steps come last).
//   Its `also`: the lead's states, and, for a gate that KOs her, HER KO
//   LIE-DOWN - 5110 or 5150 where a scene state of his sends her there by a
//   ChangeState of its own (Mr. Bear's gang KO 15160 -> 5150 at Time > 0: she
//   lies on in his scene, which the step still shows, not a scene that ended).
// - VIOLENT: a scene that waits for her death - a gate (his line, her chain,
//   a reader on its way) that reads her alive as 0 - says so in its label,
//   "(violent)", so he can skip it; a scene at low life, or one his win state
//   gives after the match, does not.
//
// AFTER THE MATCH (OVER from his win state). The engine puts the winner into
// his 180 once the round is over (RoundState 4); his own lines there pick
// what follows. His win states (170-199, which the walker's flow never
// enters) are run a state at a time from 180 under OVER at RoundState 4, and
// flowed on from where they leave for a state of his own. What that shows
// with no input is the step "as it comes"; each command that switches a
// state of that flow (a ChangeState or TargetState that fires with it and
// not without it: the held directions of his aftermath menu) is a version,
// the scenes the flow from where it switches him to shows, held from the
// states it acts in. A scene is hers (a state his lines give her) or HIS
// OWN: an H state he plays himself while she lies KO'd (a CG his explods
// draw: 46001-46003). Its `until` is what she shows of it (the states the
// prefix leaves her in: the judging's). While those states of his play she
// is where her lines send her on them (the core's `follows` edges: she in F,
// he in H -> her T; Mr. Bear's 47001-47003 on his 46001-46003, 15161 on his
// 100180): those go on the action as `herOn`, the states the runtime waits
// for in place of `until` (ko-rt.js), and with the states her lines send
// her to on the rest of his win flow they are the step's `also`. Where no
// line of hers names them, it is waited for by his animation there (the
// core's `anim`, the step's `anims`). (His own state numbers are never
// listed as hers.) The
// PREFIX: the pair's first in-round OVER KO step; else its first at her life
// 0 or her KO with its KO action ending the round (his climax that gives her
// the gang KO whose helper his win state asks for); else the first lead with
// a KO action that kills at once. All are one position, "KO: after the
// match", versions in order ("as it comes" first). A win state whose lines
// read PrevStateNo (special wins by the move that KO'd her) gives one step
// per state of his that gives her its scenes, "his win (experimental k): N".
//
// COUNTS: each scene a KO step now shows, of those the core walk left
// unreachable, moves from `unreachable` to its verdict.

const NO_INPUT = new Set();
const MIN_PATIENCE = 900;     // a KO action's least wait
const OVER_PATIENCE = 1500;   // the wait after the match (the engine's own waits are up to 900)
// Her life held through a time over: under his (he wins it on life), far
// from a KO his scene's damage could make; lower where his after-match scene
// lays her down (under what gets her up).
const TIME_LIFE = 200;

// ---- gates: what a trigger asks of her KO and of the round ------------------------
const RED = '(?:target|enemy|enemynear|p2)(?:\\s*\\(\\s*\\d*\\s*\\))?\\s*,\\s*';
const lit = (s) => String(s);
// The text before an atom, with a redirect (`enemy,`) dropped: does a `!`
// negate it?
const negatedAt = (str, off) => /!\s*\(?\s*$/.test(str.slice(0, off).replace(/[a-z0-9_]+\s*(?:\(\s*\d*\s*\))?\s*,\s*$/i, ''));
const redirectedAt = (str, off) => /,\s*$/.test(str.slice(0, off));
// One expression's atoms: { life: [N...], dead, alive, round: [n...], over, name }.
function atomsOf(e, side) {
  const str = lit(e);
  const out = { life: [], dead: false, round: [], over: false, name: false };
  const bound = (op, n) => (op === '<' ? n - 1 : n);
  if (side === 'her') {
    // Her own atoms, bare (a redirected one is his or another's).
    for (const m of str.matchAll(/\blife\b(?!max)\s*(<=|<|=)\s*(\d+)/gi)) if (!redirectedAt(str, m.index)) out.life.push(bound(m[1], +m[2]));
    for (const m of str.matchAll(/\balive\b(\s*(?:=\s*0|!=\s*1)\b)?/gi)) {
      if (redirectedAt(str, m.index)) continue;
      if (m[1] || negatedAt(str, m.index)) out.dead = true;
    }
  } else {
    for (const m of str.matchAll(new RegExp('\\b' + RED + 'life\\b(?!max)\\s*(<=|<|=)\\s*(\\d+)', 'gi'))) out.life.push(bound(m[1], +m[2]));
    for (const m of str.matchAll(/\bp2life\b(?!max)\s*(<=|<|=)\s*(\d+)/gi)) if (!redirectedAt(str, m.index)) out.life.push(bound(m[1], +m[2]));
    for (const m of str.matchAll(new RegExp('\\b' + RED + 'alive\\b(\\s*(?:=\\s*0|!=\\s*1)\\b)?', 'gi'))) {
      if (m[1] || negatedAt(str, m.index)) out.dead = true;
    }
  }
  for (const m of str.matchAll(/\broundstate\s*(=|>=|>)\s*(\d)/gi)) {
    if (redirectedAt(str, m.index) || negatedAt(str, m.index)) continue;
    const n = m[1] === '>' ? +m[2] + 1 : +m[2];
    if (n >= 3) out.round.push(Math.min(n, 4));
  }
  // (Text in quotes is a name, never an atom.)
  str.split('"').forEach((part, i) => {
    if (i % 2) return;
    for (const m of part.matchAll(/\b(matchover|winko|win)\b(\s*=\s*0)?/gi)) {
      if (redirectedAt(part, m.index) || negatedAt(part, m.index) || m[2]) continue;
      out.over = true;
    }
  });
  for (const m of str.matchAll(/\b(?:name|p[1-8]name|authorname|displayname)\s*=\s*"/gi)) if (!negatedAt(str, m.index)) out.name = true;
  return out;
}
// A trigger set's gate, or null. side 'his' (her atoms redirected) or 'her'
// (her own chain: bare). The atoms of one way through it (triggerall plus
// one group) are read together; the gate is the first way that has one.
function gateOf(trig, side) {
  if (!trig) return null;
  const ways = trig.groups && trig.groups.length ? trig.groups.map((g) => [...(trig.all || []), ...g]) : [trig.all || []];
  let best = null;
  for (const way of ways) {
    const a = { life: [], dead: false, round: [], over: false, name: false };
    for (const e of way) {
      const x = atomsOf(e, side);
      a.life.push(...x.life); a.round.push(...x.round);
      a.dead = a.dead || x.dead; a.over = a.over || x.over; a.name = a.name || x.name;
    }
    let g = null;
    if (a.round.length || a.over) g = { kind: 'over', round: a.round.length ? Math.max(...a.round) : 'any', dead: a.dead };
    else if (a.dead) g = { kind: 'dead' };
    else if (a.life.length) g = { kind: 'life', life: Math.max(0, Math.min(...a.life)) };
    if (!g) continue;
    if (a.name) { if (!best) best = { kind: 'name' }; continue; }
    if (!best || best.kind === 'name' || RANK[g.kind] > RANK[best.kind]) best = g;
  }
  return best && best.kind !== 'name' ? best : null;
}
const RANK = { name: 0, life: 1, dead: 2, over: 3 };
const gateKey = (g) => (g.kind === 'life' ? 'life' + g.life : g.kind === 'over' ? 'over' + g.round : g.kind);
// The walker's view of the round under a gate (makeWalker opts.gate).
const walkerGate = (g) => (g.kind === 'life' ? { round: 2, over: false, herAlive: 1, herLife: g.life }
  : g.kind === 'dead' ? { round: 2, over: false, herAlive: 0, herLife: 0 }
    : { round: g.round, over: true, herAlive: 0, herLife: 0 });
// The runtime's KO action field.
const koOf = (g) => (g.kind === 'life' ? { life: g.life, kill: 'none', round: 'live' }
  : g.kind === 'dead' ? { life: 0, kill: 'now', round: 'freeze' } : { life: 0, kill: 'now', round: 'end' });
// Gates in the order they are tried: the least done to her first.
const gateOrder = (a, b) => RANK[a.kind] - RANK[b.kind] || (a.kind === 'life' ? b.life - a.life : 0)
  || (a.kind === 'over' ? (a.round === 'any' ? 5 : a.round) - (b.round === 'any' ? 5 : b.round) : 0);

// ---- read: the gates his files have ------------------------------------------------
const FLOW = new Set(['targetstate', 'changestate', 'selfstate', 'hitdef', 'projectile', 'helper']);
const CHOICE = /\b(?:enemynear|enemy|target|p2)(?:\s*\(\s*\d*\s*\))?\s*,\s*stateno\b|\bprevstateno\b|\bp2stateno\b/i;
function read(G) {
  const an = G && G.an;
  if (!an || !an.states) return null;
  const gates = new Map();
  const readers = new Map();     // state -> [the gates its lines read]
  const deadReaders = new Set(); // his states with a line that reads her dead
  const wipes = new Map();       // state -> [the gates on which it removes its explods]
  const add = (g) => { const k = gateKey(g); if (!gates.has(k)) gates.set(k, g); return k; };
  // (TOUCH: every state with any line that reads a gate - what a gated flow
  // can do differently from the running round's; a lead whose flow passes
  // none, and shows no scene a gated chain of hers leaves, is not walked
  // again under that gate.)
  const touch = new Map();
  for (const [no, s] of an.states) {
    for (const sc of s.sctrls) {
      const g = gateOf(sc.trig, 'his');
      if (!g) continue;
      if (!touch.has(no)) touch.set(no, []);
      touch.get(no).push(g);
      if (sc.type === 'removeexplod') { if (!wipes.has(no)) wipes.set(no, []); wipes.get(no).push(g); }
      if (an.scenes.has(no) || !FLOW.has(sc.type)) continue;
      add(g);
      if (!readers.has(no)) readers.set(no, []);
      readers.get(no).push(g);
      if (g.kind === 'dead' || g.dead) deadReaders.add(no);
    }
  }
  // Her own chains under a gate (her KO lie-down on `alive = 0`), and the
  // chains of hers keyed on a partner's name (never followed here).
  const herChains = [];
  const nameChains = new Set();
  // (chains of hers that read his state or the state she came from: a
  // choice the gallery cannot hold)
  const choiceChains = new Set();
  for (const e of an.edges || []) {
    if (e.kind !== 'chain') continue;
    const t = e.trig || (e.sc && e.sc.trig);
    if (nameKeyed(t)) { nameChains.add(e.from + '>' + e.to); continue; }
    if (t && [...(t.all || []), ...(t.groups || []).flat()].some((x) => CHOICE.test(String(x)))) choiceChains.add(e.from + '>' + e.to);
    const g = gateOf(t, 'her');
    if (!g) continue;
    add(g);
    herChains.push({ from: e.from, to: e.to, trig: t, gate: g });
  }
  if (!gates.size) return null;
  const chainFrom = new Map();
  for (const c of herChains) { if (!chainFrom.has(c.from)) chainFrom.set(c.from, []); chainFrom.get(c.from).push(c.gate); }
  return { gates: [...gates.values()].sort(gateOrder), readers, deadReaders, herChains, nameChains, choiceChains, touch, chainFrom, wipes };
}
// A line that fires only with a name compared (`name = "..."` in every way
// through it, not negated).
function nameKeyed(trig) {
  if (!trig) return false;
  const ways = trig.groups && trig.groups.length ? trig.groups.map((g) => [...(trig.all || []), ...g]) : [trig.all || []];
  return ways.every((way) => way.some((e) => atomsOf(e, 'his').name));
}
// A reader asks for exactly this gate (the same bound, her death, the same
// round): `exact`. A reader's gate holds under the gate being walked: her
// life at N reads true for every bound at or over N; her KO makes every life
// bound and her death true; the round's end makes all of them true:
// `implied`.
const exact = (g, r) => (g.kind !== r.kind ? false : g.kind === 'life' ? g.life === r.life : g.kind === 'over' ? g.round === r.round : true);
const implied = (cur, r) => (cur.kind === 'over' ? true : cur.kind === 'dead' ? r.kind !== 'over' : r.kind === 'life' && r.life >= cur.life);

// ---- the pair ------------------------------------------------------------------------
// Her chains under a view of the round: the core's (base.chains: those that
// hold while she is alive and her life high, the round read as anything)
// with every one that reads the KO or the round evaluated under it - BLOCKED
// where it is false there (a CG of hers on `RoundState = 3` never comes in
// the running round), ADDED where it holds (her lie-down on `alive = 0`
// while she is dead). With no gate, the running round: 2, alive, life high.
const RUNNING = { round: 2, over: false, herAlive: 1, herLife: 1000 };
function chainsUnder(G, rd, g, X) {
  const extra = new Map();
  extra.blocked = new Set();
  const wg = g ? walkerGate(g) : RUNNING;
  const herSide = (e) => String(e).replace(/\b(life|alive)\b(?!max)/gi, (all, w, off, str) => (redirectedAt(str, off) ? all : (w.toLowerCase() === 'life' ? '(' + wg.herLife + ')' : '(' + wg.herAlive + ')')))
    .replace(/\broundstate\b/gi, (all, off, str) => (redirectedAt(str, off) || wg.round === 'any' ? all : '(' + wg.round + ')'))
    .replace(/\b(matchover|winko|win)\b/gi, (all, w, off, str) => (redirectedAt(str, off) ? all : wg.over ? '(1)' : '(0)'));
  for (const c of rd.herChains) {
    const t = { all: (c.trig.all || []).map(herSide), groups: (c.trig.groups || []).map((x) => x.map(herSide)) };
    let v = null;
    try { v = X.evalTriggerSet(t, {}); } catch (e) { v = null; }
    if (v === false) { extra.blocked.add(c.from + '>' + c.to); continue; }
    if (!extra.has(c.from)) extra.set(c.from, []);
    extra.get(c.from).push({ to: c.to, dead: c.gate.kind === 'dead' || !!c.gate.dead });
  }
  return extra;
}
// What a flow shows her: the custom states it issues, the ones she follows
// him into, and her chains from them (the core's shownFrom), each scene with
// the chain that reached it.
function shownOf(G, flows, extra, skip) {
  const got = new Map();   // C -> { via: null | P, dead }
  const add = (C, via, dead) => { if (!got.has(C)) { got.set(C, { via, dead }); return true; } return false; };
  for (const f of flows) {
    for (const C of f.issued.keys()) add(C, null, false);
    for (const [g, list] of G.follows || []) if (f.at.has(g)) for (const C of list) add(C, null, false);
    for (const [N, list] of G.helperFollow || []) if (f.at.has(N)) for (const C of list) add(C, null, false);
  }
  for (let grew = true; grew;) {
    grew = false;
    for (const C of [...got.keys()]) {
      for (const C2 of (G.chains && G.chains.get(C)) || []) {
        if (skip && skip.has(C + '>' + C2)) continue;
        if (extra && extra.blocked && extra.blocked.has(C + '>' + C2)) continue;
        const need = G.chainPrev && G.chainPrev.get(C + '>' + C2);
        if (need && ![...need].some((p) => got.has(p))) continue;
        if (add(C2, C, false)) grew = true;
      }
      if (extra) for (const x of extra.get(C) || []) if (add(x.to, C, x.dead)) grew = true;
    }
  }
  const isRelease = (C) => { const sc = G.an.scenes.get(C); return !!(sc && sc.release); };
  for (const C of [...got.keys()]) if (!G.hScenes.has(C) || isRelease(C)) got.delete(C);
  return got;
}
const sortN = (list) => [...new Set(list)].sort((a, b) => a - b);
const clone = (v) => JSON.parse(JSON.stringify(v));
const COPY = ['place', 'clear', 'clearAlso', 'edgeOnly', 'proj', 'setup', 'reroll', 'anims', 'withCtrl', 'noGrab'];
const ascii = (s) => String(s).replace(/[^\x20-\x7e]/g, '?');

function pair(G, R, ctx) {
  const rd = ctx.reading;
  if (!rd || !R) return null;
  const lib = ctx.lib;
  const X = lib.X;
  const walk = ctx.walk();
  if (!walk || !walk.steps || !walk.steps.length) return null;
  const an = G.an;
  const coreShown = new Set(walk.steps.flatMap((s) => [...(s.until || []), ...(s.also || [])]));
  // HIS FLOWS ARE THE GIVER'S, not the pair's: walked with her answers to
  // his probes unknown (victimHas null: a branch on her art may go either
  // way), both as the running round and under each gate, so they are made
  // once per giver (the mode's memo) and the KO a gate makes is the gate's
  // alone; what she draws of it is the pair's judging (ctx.pairSteps).
  const memo = ctx.memo instanceof Map ? ctx.memo : new Map();
  const kept = (k, make) => { if (!memo.has(k)) memo.set(k, make()); return memo.get(k); };
  const victimHas = null;
  const W0 = kept('W0', () => lib.makeWalker(an, Object.assign({}, G.walkerOpts, { victimHas })));
  const helperOpts = { victimHas, relevantVars: new Set(), sharedFlows: null, frozen: {}, rootCmds: true };
  const hw0 = () => kept('HW0', () => lib.makeWalker(an, Object.assign({}, G.walkerOpts, helperOpts, { memo: new WeakMap(), trigCache: new WeakMap() })));
  const gated = kept('gated', () => new Map());
  const walkersOf = (g) => {
    const k = gateKey(g);
    if (!gated.has(k)) {
      const gate = walkerGate(g);
      gated.set(k, {
        W: lib.makeWalker(an, Object.assign({}, G.walkerOpts, { victimHas, gate, sharedFlows: null, memo: new WeakMap(), trigCache: new WeakMap() })),
        HW: null, gate, extra: chainsUnder(G, rd, g, X),
        hw() { return this.HW || (this.HW = lib.makeWalker(an, Object.assign({}, G.walkerOpts, helperOpts, { gate, memo: new WeakMap(), trigCache: new WeakMap() }))); },
      });
    }
    return gated.get(k);
  };
  const summons = new Map((G.summons || []).map((sm) => [sm.no, sm]));
  const words = (k) => { const c = G.cmdInfo && G.cmdInfo.get(k); return c ? c.words : ascii(k); };

  // The leads: core steps, shortest path first (then their order).
  const leads = walk.steps.map((s, i) => ({ s, i }))
    .filter(({ s }) => !s.companion && s.kind !== 'companion' && Array.isArray(s.path) && Array.isArray(s.until) && s.until.length)
    .sort((a, b) => a.s.path.length - b.s.path.length || a.i - b.i).map((x) => x.s);
  // A grab's scope (the states its machine can run, the core's machine0) and
  // the pins his walk starts with there.
  const scopes = kept('scopes', () => new Map());
  const pinsOf = (E, inputs) => {
    if (typeof G.pinsFor !== 'function') return G.initial || {};
    if (!scopes.has(E)) {
      let sc = null;
      try { sc = new Set(W0.flow([{ no: E, A: G.initial, prev: 0 }], null).at.keys()); } catch (e) { sc = null; }
      scopes.set(E, sc && sc.size ? sc : null);
    }
    try { return G.pinsFor(inputs, scopes.get(E)); } catch (e) { return G.initial || {}; }
  };
  // One lead's flows (his, and his summon's helper), as the core reads the
  // round and under a gate, memoized by its starts and commands.
  const flowMemo = kept('flows', () => new Map());
  const leadKey = (s) => s.entry + '|' + [...new Set(s.path.filter((a) => a.cmd).map((a) => a.cmd))].sort().join('\u0001') + '|'
    + s.path.filter((a) => Number.isFinite(a.jump)).map((a) => a.jump + '<' + (Number.isFinite(a.at) ? a.at : s.entry)).join(',');
  const flowsOf = (s, g) => {
    const cmds = [...new Set(s.path.filter((a) => a.cmd).map((a) => a.cmd))].sort();
    const jumps = s.path.filter((a) => Number.isFinite(a.jump)).map((a) => ({ no: a.jump, prev: Number.isFinite(a.at) ? a.at : s.entry }));
    const key = (g ? gateKey(g) : '-') + '|' + leadKey(s);
    if (flowMemo.has(key)) return flowMemo.get(key);
    const inputs = cmds.length ? new Set(cmds) : NO_INPUT;
    // (His variables as the core starts a grab's walk: pinned at 0 where
    // nothing his grab's machine runs writes them otherwise with these
    // commands - pinsFor over the grab's scope.)
    const A = pinsOf(s.entry, inputs);
    const starts = [{ no: s.entry, A, prev: 0 }, ...jumps.map((j) => ({ no: j.no, A, prev: j.prev }))];
    const gw = g ? walkersOf(g) : null;
    const W = gw ? gw.W : W0;
    const out = { his: null, helper: null };
    try { out.his = W.flow(starts, inputs); } catch (e) { out.his = null; }
    const sm = summons.get(s.entry);
    if (sm && sm.helperPlays && Array.isArray(sm.starts) && sm.starts.length) {
      const HW = gw ? gw.hw() : hw0();
      try { out.helper = HW.flow(sm.starts.map((no) => ({ no, A: {}, prev: 0 })), NO_INPUT); } catch (e) { out.helper = null; }
    }
    flowMemo.set(key, out);
    return out;
  };
  const running = kept('running', () => chainsUnder(G, rd, null, X));
  const shownBy = (fl, g) => shownOf(G, [fl.his, fl.helper].filter(Boolean), g ? walkersOf(g).extra : running, rd.nameChains);

  // The core's waits per grab: a step whose last action waits in states of
  // his (a timed ladder's rung) - the KO action waits as long where it waits
  // for one of those.
  const waitsOf = (entry, states) => {
    let p = 0;
    for (const s of walk.steps) {
      if (s.entry !== entry) continue;
      for (const a of s.path) if (Number.isFinite(a.patience) && (a.from || []).some((f) => states.has(f))) p = Math.max(p, a.patience);
    }
    return p;
  };

  // A scene a KO step took, with the states of his that give it there: the
  // same scene from states of his with none in common is a twin, a step of
  // its own (the core's rule: a scene is her state AND his state that gives
  // it), so the buster's KO lie-down is not the throw's.
  const taken = new Map();
  const isTaken = (C, iss) => (taken.get(C) || []).some((t) => !iss.size || !t.size || [...iss].some((f) => t.has(f)));
  const take = (C, iss) => { if (!taken.has(C)) taken.set(C, []); taken.get(C).push(iss); };
  const made = [];
  let navN = 0;
  // ("(violent)" first - the overlay cuts a long label at its end, and
  // "scene 56/56: the round won (violent)" lost it -, then what the gate
  // does, its other mark, then the lead's own label where it is more than
  // its grab.)
  const label = (lead, g, violent, exp) => (violent ? '(violent) ' : '') + (g.kind === 'life' ? 'her life at ' + g.life : g.kind === 'dead' ? 'her KO' : 'the round won')
    + (exp ? ' (experimental ' + exp + ')' : '')
    + (lead.label && !/^the (?:grab|hit)$/.test(lead.label) ? ', after ' + lead.label : '');
  // HER KO LIE-DOWN: a scene state of his her KO gives her that sends her on
  // by itself to the engine's KO lie-down (a ChangeState to 5110 or 5150 in
  // that state: she lies in his scene, the round over or frozen) lists the
  // lie-down as the step's `also` (Mr. Bear's 15160 -> 5150 at Time > 0).
  const LIE = new Set([5110, 5150]);
  const lieOf = (list) => {
    const out = [];
    for (const C of list) {
      const s0 = an.states.get(C);
      for (const sc of (s0 && s0.sctrls) || []) {
        if (sc.type !== 'changestate' || !sc.params || typeof sc.params.get !== 'function') continue;
        const v = Number(String(sc.params.get('value') || '').trim());
        if (LIE.has(v)) out.push(v);
      }
    }
    return out;
  };
  const stepOf = (lead, g, scenes, from, patience, violent, exp) => {
    const st = { entry: lead.entry, group: 'KO: ' + lead.group, label: label(lead, g, violent, exp), kind: 'ko', until: scenes.slice(),
      also: sortN([...lead.until, ...(lead.also || []), ...(g.kind === 'life' ? [] : lieOf(scenes))]).filter((C) => !scenes.includes(C)),
      path: [...clone(lead.path), Object.assign({ ext: 'ko', until: scenes.slice() }, from && from.length ? { from } : {}, { patience, ko: koOf(g) })],
      leaf: true, ext: 'ko' };
    for (const k of COPY) if (lead[k] !== undefined) st[k] = clone(lead[k]);
    st.ko = { gate: g.kind, life: g.kind === 'life' ? g.life : 0, violent: !!violent, lead: ascii(lead.group + (lead.label ? ': ' + lead.label : '')) };
    st.nav = { pos: 'KO ' + (++navN) + ': ' + st.group + ' / ' + st.label, speed: null, ver: 0, climax: false, stage: 0 };
    return st;
  };

  // IN THE ROUND: per gate, per lead.
  for (const g of rd.gates) {
    for (const lead of leads) {
      const f0 = flowsOf(lead, null);
      const s0 = shownBy(f0, null);
      // (A gate is walked for a lead whose flow - as the running round, or
      // under a gate already walked for it, LIFE before DEAD before OVER -
      // passes a line that reads that very gate, or shows a scene a chain of
      // hers on it leaves.)
      const lk = leadKey(lead);
      const seenAt = kept('reach ' + lk, () => new Set([f0.his, f0.helper].flatMap((f) => (f ? [...f.at.keys()] : []))));
      const touches = [...seenAt].some((no) => (rd.touch.get(no) || []).some((r) => exact(g, r)))
        || [...s0.keys()].some((C) => (rd.chainFrom.get(C) || []).some((r) => exact(g, r)));
      if (!touches) continue;
      const fg = flowsOf(lead, g);
      for (const f of [fg.his, fg.helper]) if (f) for (const no of f.at.keys()) seenAt.add(no);
      if (!fg.his && !fg.helper) continue;
      const sg = shownBy(fg, g);
      // Where each comes from: the states of his that issue it (or the
      // scene her chain leaves for it), and the gate's readers on the way.
      let helperScene = false;
      const root = (C, seen, out) => {
        if (seen.has(C)) return out;
        seen.add(C);
        const his = fg.his && fg.his.issued.get(C);
        if (his) for (const f of his) out.add(f);
        if (fg.helper && fg.helper.issued.has(C)) { helperScene = true; out.add('h'); }
        const x = sg.get(C);
        if (x && x.via !== null) root(x.via, seen, out);
        return out;
      };
      const issuersOf = new Map([...sg.keys()].map((C) => [C, root(C, new Set(), new Set())]));
      helperScene = false;
      // (HER WAY IN: his flow walks every branch her art may take, so a KO
      // scene is the lead's only where the states of his that give it come
      // after the ones that give the lead's own scenes - the grab's machine
      // she is in: Mr. Bear's two grabs, her 6074 or her 6084.)
      const own = new Set();
      for (const C of [...lead.until, ...(lead.also || [])]) for (const f of (fg.his && fg.his.issued.get(C)) || []) own.add(f);
      const onward = new Set(own);
      if (fg.his) { const q = [...own]; while (q.length) { const a = q.shift(); for (const b of (fg.his.edges && fg.his.edges.get(a)) || []) if (!onward.has(b)) { onward.add(b); q.push(b); } } }
      const theirs = (C) => { const iss = issuersOf.get(C) || new Set(); return iss.has('h') || !own.size || [...iss].some((f) => onward.has(f)); };
      const fresh = sortN([...sg.keys()].filter((C) => !s0.has(C) && !coreShown.has(C) && !isTaken(C, issuersOf.get(C)) && theirs(C)));
      if (!fresh.length) continue;
      const issuers = new Set();
      for (const C of fresh) for (const f of root(C, new Set(), new Set())) if (f !== 'h') issuers.add(f);
      // A CLEANUP IS NO SCENE: where everything the gate brings her is a
      // common state of hers (her KO lie-down 5150) and a state of his that
      // gives it removes its own explods on that very gate, the gate ends
      // his scene's art - Kur0maru's eating 3160 on RoundState = 3 takes its
      // explods off and lays her down: the step would show her alone. (His
      // Buster lays her down on the same gate and keeps its art: a step.)
      if (fresh.every((C) => lib.isBasic(C)) && [...issuers].some((f) => (rd.wipes.get(f) || []).some((w) => exact(g, w)))) {
        for (const C of fresh) take(C, issuersOf.get(C));
        continue;
      }
      let from = null;
      if (!helperScene && fg.his) {
        const reach = new Set([...issuers].filter((f) => f >= 0));
        // (his states whose own lines read this gate and lead to an issuer)
        const into = new Map();
        for (const [a, bs] of fg.his.edges || []) for (const b of bs) { if (!into.has(b)) into.set(b, new Set()); into.get(b).add(a); }
        const q = [...reach], back = new Set(reach);
        while (q.length) { const b = q.shift(); for (const a of into.get(b) || []) if (!back.has(a)) { back.add(a); q.push(a); } }
        for (const no of back) if (no >= 0 && (rd.readers.get(no) || []).some((r) => implied(g, r))) reach.add(no);
        from = sortN([...reach]);
      }
      // VIOLENT: her death is what the scene waits for.
      const violent = g.kind === 'dead' || fresh.some((C) => sg.get(C) && sg.get(C).dead)
        || (g.kind === 'over' && from && from.some((f) => rd.deadReaders.has(f)));
      const patience = Math.max(MIN_PATIENCE, waitsOf(lead.entry, new Set(from || [])), ...lead.path.map((a) => a.patience || 0));
      // BRANCHES: where one state of hers that the KO brings goes on to two
      // or more of these scenes by chains that read which state he is in or
      // came from (`EnemyNear,StateNo = 188`, `PrevStateNo = 2305`: his
      // special wins, picked by the move that KO'd her), each is a step of
      // its own, "(experimental)": the gallery cannot choose that move.
      const kids = new Map();
      for (const C of fresh) {
        const x = sg.get(C);
        if (!x || x.via === null || fresh.includes(x.via)) continue;
        if (!kids.has(x.via)) kids.set(x.via, []);
        kids.get(x.via).push(C);
      }
      const parts = [];
      const inBranch = new Set();
      for (const [P, list] of kids) {
        if (list.length < 2 || !list.every((C) => rd.choiceChains.has(P + '>' + C))) continue;
        for (const C of list) {
          const part = fresh.filter((D) => { for (let y = D; y !== null && y !== undefined;) { if (y === C) return true; const z = sg.get(y); y = z ? z.via : null; } return false; });
          parts.push(part);
          for (const D of part) inBranch.add(D);
        }
      }
      const rest = fresh.filter((C) => !inBranch.has(C));
      const groups = [...(rest.length ? [{ scenes: rest, exp: false }] : []), ...parts.map((x) => ({ scenes: x, exp: true }))];
      let bn = 0;
      for (const grp of groups) {
        const st = stepOf(lead, g, grp.scenes, from, patience, violent, grp.exp ? ++bn : 0);
        if (grp.exp) st.ko.experimental = true;
        // (pairSteps keeps a twin: its key reads `edge`.)
        st.edge = 'ko<' + sortN([...issuers]).join(',');
        made.push({ st, g, lead });
      }
      for (const C of fresh) take(C, issuersOf.get(C));
    }
  }

  // AFTER THE MATCH: his win state under OVER at RoundState 4.
  const after = [];
  if (an.states.has(180) && rd.gates.some((g) => g.kind === 'over')) {
    const g4 = { kind: 'over', round: 4, dead: false };
    const gw = walkersOf(g4);
    // (His win states are basic (170-199): the walker's flow never enters
    // one, so they are run here a state at a time - his 180 and the ones it
    // goes on to - and the flow starts where they leave for a state of his
    // own, a scene's issuers kept with the win state that issued it.)
    // (`open`: nothing of his pinned - for a time over, where his own scene
    // sets at the match's end what his win reads: Brian's hub sets var(2) =
    // 69, which takes his 180 to 4000.)
    const winFlow = (inputs, open) => {
      const A = open ? {} : pinsOf(180, inputs);
      const seen = new Set([180]), q = [180], starts = [], issued = new Map(), at = new Map(), edges = new Map();
      let prevRead = false;
      while (q.length) {
        const no = q.shift();
        const s0 = an.states.get(no);
        if (!s0) continue;
        if ((s0.sctrls || []).some((sc) => FLOW.has(sc.type) && /\bprevstateno\b/i.test([...sc.trig.all, ...sc.trig.groups.flat()].join(' ')))) prevRead = true;
        at.set(no, A);
        let r = null;
        try { r = gw.W.runState(no, A, inputs, { passes: 3, fresh: true }); } catch (e) { r = null; }
        if (!r) continue;
        for (const i of r.issued) { if (!issued.has(i.C)) issued.set(i.C, new Set()); issued.get(i.C).add(no); }
        for (const x of r.next) {
          if (!edges.has(no)) edges.set(no, new Set());
          edges.get(no).add(x.no);
          if (x.no >= 170 && x.no <= 199 && an.states.has(x.no)) { if (!seen.has(x.no)) { seen.add(x.no); q.push(x.no); } }
          else if (!lib.isBasic(x.no)) starts.push({ no: x.no, A: x.A, prev: no });
        }
      }
      let f = null;
      if (starts.length) { try { f = gw.W.flow(starts, inputs); } catch (e) { f = null; } }
      if (f) {
        for (const [k, v] of f.at) at.set(k, v);
        for (const [C, from] of f.issued) { if (!issued.has(C)) issued.set(C, new Set()); for (const x of from) issued.get(C).add(x); }
        for (const [a, bs] of f.edges || []) { if (!edges.has(a)) edges.set(a, new Set()); for (const b of bs) edges.get(a).add(b); }
      }
      return { at, issued, edges, prevRead };
    };
    const wins = kept('wins', () => new Map());
    const winFlowK = (inputs) => {
      const k = [...inputs].sort().join('\u0001');
      if (!wins.has(k)) { let f = null; try { f = winFlow(inputs); } catch (e) { f = null; } wins.set(k, f); }
      return wins.get(k);
    };
    const fa = winFlowK(NO_INPUT);
    if (fa) {
      // What it shows: her scenes his states give her there, and his own
      // scene states he plays there himself (a CG his explods draw while she
      // lies KO'd: the aftermath's own states, numbers his files make
      // scenes of).
      const hisScenes = (f) => sortN([...f.at.keys()].filter((no) => G.hScenes.has(no) && !coreShown.has(no) && !taken.has(no)));
      const sa = shownOf(G, [fa], gw.extra, rd.nameChains);
      const asIs = { her: sortN([...sa.keys()].filter((C) => !coreShown.has(C) && !taken.has(C))), his: hisScenes(fa) };
      // ITS VERSIONS: a command a state of that flow switches on (a
      // ChangeState or TargetState that fires with it and not without it:
      // the held directions of his aftermath menu) is a version, the scenes
      // the flow from where it switches him to shows, held from the states
      // it acts in.
      const W = gw.W;
      const byCmd = new Map();
      for (const [H, A] of fa.at) {
        const st0 = an.states.get(H);
        if (!st0 || H < 0) continue;
        for (const sc of st0.sctrls) {
          if (sc.type !== 'changestate' && sc.type !== 'targetstate') continue;
          for (const k of lib.commandsIn(sc.trig)) {
            const info = G.cmdInfo && G.cmdInfo.get(k);
            if (!info || !info.playable) continue;
            let on = null, off = null;
            try { on = W.trig(sc, A, new Set([k]), H); off = W.trig(sc, A, NO_INPUT, H); } catch (e) { on = null; off = null; }
            if (on === false || off !== false) continue;
            let to = [];
            try { to = W.values(sc.params.get('value'), A, H); } catch (e) { to = []; }
            if (!byCmd.has(k)) byCmd.set(k, { from: new Set(), his: new Set(), her: new Set() });
            const v = byCmd.get(k);
            v.from.add(H);
            if (sc.type === 'targetstate') { for (const C of to) v.her.add(C); continue; }
            for (const J of to) {
              if (lib.isBasic(J) || !an.states.has(J)) continue;
              if (G.hScenes.has(J)) v.his.add(J);
              let f = null;
              try { f = W.flow([{ no: J, A, prev: H }], NO_INPUT); } catch (e) { f = null; }
              if (!f) continue;
              for (const no of f.at.keys()) if (G.hScenes.has(no)) v.his.add(no);
              for (const C of shownOf(G, [f], gw.extra, rd.nameChains).keys()) v.her.add(C);
            }
          }
        }
      }
      const vers = [];
      const rankOf = (k) => (G.cmdInfo.get(k) || {}).rank || 0;
      for (const [k, v] of [...byCmd].sort((x, y) => rankOf(x[0]) - rankOf(y[0]) || (x[0] < y[0] ? -1 : 1))) {
        const her = sortN([...v.her].filter((C) => G.hScenes.has(C) && !coreShown.has(C) && !taken.has(C)));
        const his = sortN([...v.his].filter((no) => !coreShown.has(no) && !taken.has(no)));
        if (!her.length && !his.length) continue;
        const key = her.join() + '|' + his.join();
        if (vers.some((x) => x.key === key)) continue;
        vers.push({ cmd: k, from: sortN([...v.from]), her, his, key });
      }
      // (His win walked open, for a time over: his own after-match scene
      // states that walk reaches.)
      let fo = null;
      try { fo = winFlow(NO_INPUT, true); } catch (e) { fo = null; }
      const hisOpen = fo ? sortN([...fo.at.keys()].filter((no) => no >= 0 && G.hScenes.has(no) && !coreShown.has(no) && !taken.has(no))) : [];
      if (asIs.her.length || asIs.his.length || vers.length) after.push({ asIs, vers, picksByPrev: fa.prevRead, fa, fo, hisOpen });
    }
  }
  if (after.length) {
    const { asIs, vers, picksByPrev, fa, fo, hisOpen } = after[0];
    // The prefix: the first in-round OVER KO step; else the first one at
    // her life 0 or her KO, its KO action ending the round (his scene that
    // gives her a scene on her KO: the climax before his gang KO, whose
    // helper his win state asks for); else the first lead with a KO action
    // that kills at once.
    const g4 = { kind: 'over', round: 4, dead: false };
    const gw4 = walkersOf(g4);
    // WHAT HIS WIN READS (played 2026-10-07: Brian's and Minotaur's steps
    // took a plain win pose, Mr. Bear's showed its scene). His win states
    // (170-199) are read for the branches that lead on - a ChangeState to a
    // state that is no win pose, or a TargetState:
    // - HER PREVIOUS STATE: such a branch on `Enemy,PrevStateNo = N` wants
    //   her KO'd while she is in N (Minotaur's 180 plays his scene 4000 on
    //   1699 / 1899, the lie-down his insertions end on): the prefix is the
    //   first lead whose flow gives her N, and its KO arms only while she is
    //   in it (`herIn`).
    // - HIS VARIABLES: such a TargetState whose value reads his variables
    //   (Brian's 180: her 6196 + fvar(23) * 5 on fvar(23) != 0) wants them
    //   as the lead left them, and his getting up resets them before the
    //   match is over (Brian's 105-107 zero fvar(23)): the KO action holds
    //   them from then on (`hold`) at the lead's values, and the step waits
    //   for the scene that value gives her - the lead's own scene going on
    //   after the match (shown in the round too: this is its play after it).
    // - What such a branch reads that the gallery cannot hold (a random
    //   draw, her previous state where no lead gives it, a variable the lead
    //   leaves open) keeps the step "(experimental)", first in its label.
    const PREV = /^\s*\(?\s*(?:enemynear|enemy|p2)\s*(?:\(\s*\d*\s*\))?\s*,\s*prevstateno\s*=\s*(\d+)\s*\)?\s*$/i;
    const wantPrev = new Set();
    const varTargets = [];
    let unheld = false;
    // (A branch that leads on with no previous state of hers asked: his
    // win has a way that needs none - Mr. Bear's 180 plays his gang CG on a
    // helper of his - and the prefix stays the in-round KO's.)
    let freeBranch = false;
    for (const H of [...fa.at.keys()].filter((no) => no >= 170 && no <= 199 && an.states.has(no))) {
      const A = fa.at.get(H) || {};
      for (const sc of an.states.get(H).sctrls || []) {
        if (sc.type !== 'changestate' && sc.type !== 'targetstate') continue;
        const raw = String(sc.params.get('value') || '');
        let to = [];
        try { to = gw4.W.values(raw, A, H); } catch (e) { to = []; }
        if (sc.type === 'changestate' && (!to.length || to.every((v) => v >= 170 && v <= 199))) continue;
        const texts = [...(sc.trig.all || []), ...(sc.trig.groups || []).flat()].map(String);
        let asks = false;
        for (const e of texts) { const m = PREV.exec(e); if (m) { wantPrev.add(+m[1]); asks = true; } }
        if (!asks) freeBranch = true;
        if ([...texts, raw].some((e) => /\brandom\b/i.test(e))) unheld = true;
        if (sc.type === 'targetstate' && X.varsOf(raw).length) varTargets.push({ H, raw, vars: X.varsOf(raw) });
      }
    }
    let prevLead = null, prevGot = [], noPrevArt = false;
    const SHOWN = new Set(['tailored', 'renders', 'partial']);
    const verdictOf = (C) => { try { return ctx.verdict(C); } catch (e) { return ''; } };
    if (wantPrev.size && !freeBranch) {
      // (A lead whose scene ends by itself into it first: a climax lays her
      // down at its end - Minotaur's insertion ends give her 1699 - where a
      // foreplay loop never gets there with no input.)
      const ends = (s) => s.kind === 'climax' || /\bclimax\b/i.test(String(s.label || '')) || /\bclimax\b/i.test(String(s.group || ''));
      for (const lead of [...leads.filter(ends), ...leads.filter((s) => !ends(s))]) {
        let f = null;
        try { f = flowsOf(lead, null); } catch (e) { f = null; }
        // (Only a lie-down her art shows: Minotaur's 1699 is tailored on Dr.
        // Kira and her 1899 get-hit only - the first climax, ending in 1899,
        // had made her a step that showed nothing, dropped.)
        const got = f && f.his ? sortN([...wantPrev].filter((N) => f.his.issued.has(N) && SHOWN.has(verdictOf(N)))) : [];
        if (got.length) { prevLead = lead; prevGot = got; break; }
      }
      // (None of them hers: no step after the match - one through another
      // prefix could never give his win the state it asks.)
      if (!prevLead) noPrevArt = true;
    }
    const overStep = made.find((m) => m.g.kind === 'over') || made.find((m) => m.g.kind === 'dead' || (m.g.kind === 'life' && m.g.life === 0));
    let prefixPath, prefixHer, prefixAlso, base;
    if (prevLead) {
      base = prevLead;
      prefixPath = [...clone(base.path), { ext: 'ko', until: prevGot.slice(), herIn: prevGot.slice(), patience: OVER_PATIENCE, ko: koOf(g4) }];
      prefixHer = prevGot.slice();
      prefixAlso = sortN([...base.until, ...(base.also || [])]).filter((C) => !prevGot.includes(C));
    } else if (overStep) {
      base = overStep.lead;
      prefixPath = clone(overStep.st.path);
      for (const x of prefixPath) if (x.ext === 'ko' && x.ko && x.ko.kill !== undefined) x.ko = koOf(g4);
      prefixHer = overStep.st.until.slice();
      prefixAlso = overStep.st.also.slice();
    } else {
      base = leads[0];
      prefixPath = [...clone(base.path), { ext: 'ko', until: base.until.slice(), patience: MIN_PATIENCE, ko: koOf(g4) }];
      prefixHer = base.until.slice();
      prefixAlso = (base.also || []).slice();
    }
    // (His variable at the lead's value: the one value at which the win's
    // TargetState gives her a scene of the lead's own - its states, or what
    // it accepts - tried over what the lead's path sets or holds of it and
    // the small numbers a position counter takes; his walk leaves such a
    // variable open where a VarSet computes it, Brian's fvar(23).)
    const holds = [], winHer = [];
    if (varTargets.length) {
      const own = new Set([...base.until, ...(base.also || []), ...(base.alsoStates || [])]);
      for (const T of varTargets) {
        const r = T.vars.length === 1 ? lib.varRef(T.vars[0]) : null;
        if (!r) { unheld = true; continue; }
        const cands = new Set();
        for (const a of base.path || []) for (const e of [...(a.set || []), ...(a.hold || [])]) if (e && e.kind === r.kind && e.index === r.index && Number.isFinite(e.value)) cands.add(e.value);
        for (let x = 0; x <= 31; x++) cands.add(x);
        const hits = [];
        for (const x of cands) {
          const A2 = Object.assign({}, fa.at.get(T.H) || {});
          A2[T.vars[0]] = [x];
          let to = [];
          try { to = gw4.W.values(T.raw, A2, T.H); } catch (e) { to = []; }
          const C = [...new Set(to)].find((n) => own.has(n) && G.hScenes.has(n));
          if (C !== undefined && !hits.some((h) => h.x === x)) hits.push({ x, C });
        }
        if (hits.length !== 1) { unheld = true; continue; }
        if (!holds.some((h) => h.kind === r.kind && h.index === r.index)) holds.push({ kind: r.kind, index: r.index, value: hits[0].x });
        if (!winHer.includes(hits[0].C)) winHer.push(hits[0].C);
      }
      if (holds.length) for (const x of prefixPath) if (x.ext === 'ko' && x.ko) x.hold = holds.map((h) => Object.assign({}, h));
    }
    // A SCENE HIS WIN GIVES HER BY A TARGETSTATE gets no KO step: it needs
    // her as his target, and after the gallery's KO he has let her go. Played
    // (2026-10-07): Brian's held fvar(23) took his 180 back into his hub
    // 6001, and she stayed in 15051 - every time, on every receiver. His own
    // states playing it with her lying need no target (Minotaur's 4010, Mr.
    // Bear's CG). Its step is a TIME OVER instead (below): the round ends by
    // the clock with her alive in his scene.
    const byTarget = winHer.length > 0;
    const shaky = unheld || (picksByPrev && !prevLead && !freeBranch);
    const group = 'KO: after the match';
    const pos = 'KO ' + (++navN) + ': after the match';
    // A version's last action: her scenes, or - where his own states play
    // it (a CG his explods draw while she lies KO'd) - the states she lies
    // in after the prefix, done once his animation is one of those states'
    // (the core's `anim`, and the step's `anims`: out of them a while,
    // played again). Their animations: what each plays on its first tick.
    const animsOf = (list) => {
      const out = new Set();
      for (const no of list) {
        let r = null;
        try { r = walkersOf(g4).W.animTicks(no, (fa.at && fa.at.get(no)) || {}); } catch (e) { r = null; }
        for (const n of (r && r.anims) || []) if (Number.isInteger(n) && n >= 0) out.add(n);
      }
      return sortN([...out]);
    };
    // Her states on states of his: the core's follows edges (her line, read
    // on his state number), from any state of hers.
    const follows = (an.edges || []).filter((e) => e.kind === 'follows' && Number.isInteger(e.to) && Number.isInteger(e.target));
    const herOn = (list) => { const set = new Set(list); return sortN(follows.filter((e) => set.has(e.to)).map((e) => e.target)); };
    const onTheWay = herOn([...((fa && fa.at && fa.at.keys()) || [])]);
    // ("(experimental)" first in the label where his win reads something
    // left unheld - WHAT HIS WIN READS above.)
    // HER ENDING PICTURE: a state of his she runs on his after-match scene
    // that draws an explod of HER animation on `SelfAnimExist(N)` - Minotaur's
    // 4020 at its tick 180, the one-picture ending, her 36790 (sprite group
    // 9999; its sounds 36791), else 36780, and a second layer 36795 / 36785;
    // Brian's 4021 the same - is what the step shows of her: the step is
    // hers only where she has one of those animations (R.Mika, Kula and Yoko
    // lie down for Minotaur's and have none: his scene with no picture).
    const pictureOf = (states) => {
      const P = new Set();
      for (const no of states) {
        for (const sc of ((an.states.get(no) || {}).sctrls) || []) {
          if (sc.type !== 'explod') continue;
          const txt = [...(sc.trig.all || []), ...(sc.trig.groups || []).flat()].join(' ');
          const anim = String(sc.params.get('anim') || '');
          for (const m of txt.matchAll(/(?<![,\w])selfanimexist\s*\(\s*(\d+)\s*\)/ig)) if (new RegExp('\\b' + m[1] + '\\b').test(anim)) P.add(+m[1]);
        }
      }
      return P;
    };
    // (Her animation AND its sprites: Miyako, Misaka, vatista and kuromaru
    // girl plus ship 36790 / 36780 with no frame of it in their .sff - his
    // SelfAnimExist passes and the picture draws blank.)
    const drawsPicture = (N) => {
      if (!(R.airActions && typeof R.airActions.has === 'function' && R.airActions.has(N))) return false;
      if (!R.rSff || !R.rAir || typeof R.rAir.get !== 'function') return true;
      return [...(R.rAir.get(N) || [])].some((k) => R.rSff.has(k) || (R.standIns && R.standIns.has(k)));
    };
    const hasPicture = (states) => {
      const P = pictureOf(states);
      return !P.size || [...P].some(drawsPicture);
    };
    const pushStep = (st) => { if (st) after.push(st); };
    const mk = (lbl0, last, her, his, ver) => {
      const lbl = !shaky || /^\(experimental/.test(lbl0) || /experimental \d/.test(lbl0) ? lbl0 : '(experimental) ' + lbl0;
      const herHis = his.length && !her.length ? herOn(his) : [];
      if (herHis.length && !hasPicture(herHis)) return null;
      const until = her.length ? her : prefixHer;
      const anims = his.length && !her.length && !herHis.length ? animsOf(his) : [];
      // (His own scene with none of hers on it: she lies KO'd meanwhile -
      // where the prefix left her, or in her common lie-down 5110 / 5150 -
      // and his animation is the check: Minotaur's 4010 after his 180 read
      // her 1899. The runtime waits on `herOn`; `until` stays for judging.)
      const lying = anims.length ? sortN([...prefixHer, 5110, 5150]) : [];
      const act = Object.assign({ ext: 'ko' }, last, { until: until.slice() }, anims.length ? { anim: anims } : {},
        herHis.length ? { herOn: herHis.slice() } : lying.length ? { herOn: lying } : {});
      const st = { entry: base.entry, group, label: lbl, kind: 'ko', until: until.slice(),
        also: sortN([...prefixHer, ...prefixAlso, ...herHis, ...(herHis.length ? onTheWay : [])]).filter((C) => !until.includes(C)),
        path: [...clone(prefixPath), act], leaf: true, ext: 'ko', edge: 'ko-after ' + ver };
      for (const k of COPY) if (base[k] !== undefined) st[k] = clone(base[k]);
      if (anims.length) st.anims = anims;
      st.ko = { gate: 'over', life: 0, violent: false, lead: ascii(base.group + (base.label ? ': ' + base.label : '')), after: true };
      if (shaky) st.ko.experimental = true;
      if (his.length) st.ko.his = his.slice();
      st.nav = { pos, speed: null, ver, climax: false, stage: 0 };
      return st;
    };
    let ver = 0;
    if (noPrevArt) { /* (no step: none of the states his win asks her previous state to be is hers) */ }
    else if (byTarget) {
      // TIME OVER: the lead's own scene, then the round ended by the clock
      // with her alive in it (her life held at TIME_LIFE, under his, so he
      // wins it), his variables held - no KO, so his scene never lets her
      // go and she is still his target when his win state runs. A scene
      // that keeps the round from ending (Brian's hub asserts RoundNotOver
      // every frame) plays on past the round's end, as MUGEN plays it.
      // (Nothing of his held: with no KO his own code picks the branch by
      // her art - played, Brian's hub on the match's end, where she has his
      // Minotaur-compatible 36777, zeroes fvar(23), sets var(2) = 69, lays her
      // in 15051 and hops back, and his 180 then walks up to her (4000) and
      // plays 4010; a held fvar(23) had sent his 180 back into his hub.)
      // (Then his after-match scene, where his open win reaches one of his
      // own: Brian's 4000 walks up to her and plays 4010. The wait is his
      // animation with her in her part of it: the states of his she goes
      // through on it - his 4020, her torn-clothes art 36777 on his 4010, then
      // his 4021, the one-picture ending (her 36790) drawn over his fade to
      // black. Judged, as every after-match step, on the lead's scene. With
      // no scene of his, the step is the time over itself.)
      const ansO = new Set();
      for (const no of hisOpen || []) {
        let r = null;
        try { r = walkersOf(g4).W.animTicks(no, (fo && fo.at && fo.at.get(no)) || {}); } catch (e) { r = null; }
        for (const n of (r && r.anims) || []) if (Number.isInteger(n) && n >= 0) ansO.add(n);
      }
      // (Whose after-match scene it is: a line of the lead's own states that
      // fires on the match's end and asks her art - Brian's hub lets her go
      // to his 4000 only on \`target,SelfAnimExist(36777)\` - makes it the
      // pair's only where she has that art. Without it, his scene goes on
      // past the round's end - his hub holds RoundNotOver - and that is the
      // step: the time over, and the scene as it goes on. The same lines lay
      // her down for it: their TargetState - his 15051.)
      const PROBE = /\b(?:target|enemy|enemynear|p2)\s*(?:\(\s*\d*\s*\))?\s*,\s*selfanimexist\s*\(\s*(\d+)\s*\)/ig;
      const asks = new Set(), laid = new Set();
      let lf = null;
      try { lf = flowsOf(base, null); } catch (e) { lf = null; }
      for (const no of lf && lf.his ? lf.his.at.keys() : []) {
        const s0 = an.states.get(no);
        for (const sc of (s0 && s0.sctrls) || []) {
          const txt = [...(sc.trig.all || []), ...(sc.trig.groups || []).flat()].join(' ');
          if (!/\bmatchover\b|\broundstate\s*(?:>=?\s*3|=\s*[34])\b/i.test(txt)) continue;
          let probed = false;
          for (const m of txt.matchAll(PROBE)) { asks.add(+m[1]); probed = true; }
          if (!probed || sc.type !== 'targetstate') continue;
          const v = /^\s*(\d+)\s*$/.exec(String(sc.params.get('value') || ''));
          if (v && an.states.has(+v[1]) && !lib.isBasic(+v[1])) laid.add(+v[1]);
        }
      }
      const answers = [...asks].every((N) => R.airActions && typeof R.airActions.has === 'function' && R.airActions.has(N));
      // (Her part: from where he lays her and her lines on his scene, the
      // states of his they change her on to.)
      const chain = new Set([...laid, ...herOn(hisOpen || [])]);
      for (let grew = true, n = 0; grew && n < 8; n++) {
        grew = false;
        for (const no of [...chain]) {
          for (const sc of ((an.states.get(no) || {}).sctrls) || []) {
            if (sc.type !== 'changestate') continue;
            const v = /^\s*(\d+)\s*$/.exec(String(sc.params.get('value') || ''));
            if (v && !chain.has(+v[1]) && an.states.has(+v[1]) && !lib.isBasic(+v[1])) { chain.add(+v[1]); grew = true; }
          }
        }
      }
      const onHis = sortN([...chain].filter((C) => !laid.has(C)));
      const wAct = ansO.size && answers && (onHis.length || laid.size) && hasPicture([...chain])
        ? { ext: 'ko', until: base.until.slice(), herOn: onHis.length ? onHis : sortN([...laid]), anim: sortN([...ansO]), patience: OVER_PATIENCE } : null;
      // (Her life through it: under what gets her up from where he lays her.
      // Played: held at 200, his 15051's \`life > 2\` SelfState took her to her
      // 5120 the frame he laid her, and she stood in 170 through his 4010, his
      // fade to black over nothing.)
      let lifeT = TIME_LIFE;
      for (const no of wAct ? laid : []) {
        for (const sc of an.states.get(no).sctrls || []) {
          if (sc.type !== 'selfstate' && sc.type !== 'changestate') continue;
          const txt = [...(sc.trig.all || []), ...(sc.trig.groups || []).flat()].join(' ');
          for (const m of txt.matchAll(/\blife\s*(>=?)\s*(\d+)/ig)) lifeT = Math.min(lifeT, Math.max(1, +m[2] - (m[1] === '>=' ? 1 : 0)));
        }
      }
      const tAct = { ext: 'ko', until: base.until.slice(), patience: MIN_PATIENCE, ko: { life: lifeT, kill: 'none', round: 'time' } };
      // (Laid down, she is KO'd there - the round already over on time - as
      // his own KO leaves her: his custom 5150 sends a KO'd her to 15051, "his
      // custom win pose". Played alive: the engine's win poses take every
      // fighter alive to 170 / 180 / 175 once, as MUGEN does, and took her
      // out of 15051 into 170 before his 4010; KO'd, they pass her by. Her
      // KO in 15051 goes through his 5150 and back.)
      const kAct = wAct && laid.size ? { ext: 'ko', until: base.until.slice(), herOn: sortN([...laid]), herIn: sortN([...laid]), patience: OVER_PATIENCE, ko: { life: 0, kill: 'now', round: 'time' } } : null;
      const st = { entry: base.entry, group, label: 'time over', kind: 'ko', until: base.until.slice(),
        also: sortN([...(base.also || []), ...(wAct ? chain : []), ...(kAct ? [5150] : [])]).filter((C) => !base.until.includes(C)),
        path: [...clone(base.path), tAct, ...(kAct ? [kAct] : []), ...(wAct ? [wAct] : [])], leaf: true, ext: 'ko', edge: 'ko-time' };
      if (wAct) { st.anims = sortN([...ansO]); st.ko_his = hisOpen.slice(); }
      for (const k of COPY) if (base[k] !== undefined) st[k] = clone(base[k]);
      st.ko = { gate: 'time', life: lifeT, violent: false, lead: ascii(base.group + (base.label ? ': ' + base.label : '')), after: true };
      if (st.ko_his) { st.ko.his = st.ko_his; delete st.ko_his; }
      st.nav = { pos, speed: null, ver: ver++, climax: false, stage: 0 };
      // (Only where his after-match scene plays: without it - her art not
      // what his match-end line asks, or none of her ending picture - the
      // time over is his scene going on past the clock, his hub holding
      // RoundNotOver, nothing his position step does not show already.)
      if (wAct) after.push(st);
    } else if (asIs.her.length || asIs.his.length) {
      if (picksByPrev && !prevLead && asIs.her.length) {
        // (one step per state of his that gives her its scenes: a win the
        // move that KO'd her picks, which the gallery cannot choose)
        const byIssuer = new Map();
        for (const C of asIs.her) {
          const iss = fa.issued.get(C);
          const k = iss ? sortN([...iss]).join('/') : 'chain';
          if (!byIssuer.has(k)) byIssuer.set(k, []);
          byIssuer.get(k).push(C);
        }
        for (const [k, list] of byIssuer) {
          const st = mk('his win (experimental ' + (ver + 1) + '): ' + ascii(k), { patience: OVER_PATIENCE }, list, [], ver++);
          if (st) st.ko.experimental = true;
          pushStep(st);
        }
        if (asIs.his.length) pushStep(mk('as it comes', { patience: OVER_PATIENCE }, [], asIs.his, ver++));
      } else pushStep(mk('as it comes', { patience: OVER_PATIENCE }, asIs.her, asIs.his, ver++));
    }
    // (Its versions were read with his variables open; where the step holds
    // them, the versions' scenes are not the lead's: left out.)
    if (!holds.length && !byTarget && !noPrevArt) for (const v of vers) pushStep(mk(words(v.cmd), { cmd: v.cmd, mode: 'hold', from: v.from, patience: OVER_PATIENCE }, v.her, v.his, ver++));
    after.shift();
  }

  const raw = [...made.map((m) => m.st), ...after];
  if (!raw.length) return null;
  // (No stage copies: a KO step is its own position, at the stage his
  // setup holds.)
  const steps = ctx.pairSteps(raw);
  if (!steps.length) return null;
  // (Each kept step's ko field and nav as made: pairSteps carries them.)
  // COUNTS: what the core left unreachable that a KO step now shows.
  const unreach = new Set((walk.unreachable || []).map((u) => u.state));
  const counts = {};
  const reached = new Set();
  for (const st of steps) for (const C of [...st.states, ...(st.alsoStates || [])]) if (unreach.has(C)) reached.add(C);
  for (const C of reached) { const v = ctx.verdict(C); counts[v] = (counts[v] || 0) + 1; }
  if (reached.size) counts.unreachable = -reached.size;
  return { steps, counts };
}

module.exports = { read, pair, triggerGate: gateOf, atomsOf, gateKey, walkerGate, koOf };
