'use strict';
// THE H GALLERY'S GRAB REACH: where she must stand for a grab of his to
// connect, read from the files alone (gallerydata.js stamps it on the steps,
// gallery.js stands the pair that far apart).
//
// The gallery stands the pair close (18 px each side of the center, in each
// one's own units; GAP 36 with several pairs) and puts him into his grab
// state. Most grabs connect from there. A dash (FutaRB Mina's 35330: velset
// 35 on a dash with no Clsn2, so he never pushes her and runs through her), a
// grab that runs at his run speed for ten ticks before its HitDef goes live
// (Succubus' 21000) or a far box (Roper) misses at point blank. So the grab's
// first ticks are replayed the way the engine plays them, and a step gets a
// stand distance only where that replay says the default misses.
//
// THE MODEL, everything in 320-wide world units (own units * 320/localcoord):
//   His motion: the grab state, then at most 3 states his time-only
//   ChangeStates enter (Time, AnimTime, AnimElem), each tick in the engine's
//   order (char.go actionRun, posUpdate 9928-9990): the state's controllers
//   (header velset at entry; VelSet/VelAdd/VelMul/PosAdd/ChangeAnim on
//   triggers that read only time - movehit and its kin read 0 before the hit,
//   a command 0, AILevel 0, RoundState 2), then x += vel, then the physics
//   (S: [Movement] stand.friction, a speed under 1 px stops; A: gravity, and
//   the landing ends it). Values read his own constants (const(velocity.*),
//   const(size.*), const(movement.*): the first section and the first key
//   win, defaults scaled to his localcoord as initConstants does). Any other
//   atom in a velocity, ChangeAnim or HitDef trigger makes the model none (no
//   reach): conservative by design. A Projectile is inert here: it moves
//   neither him nor his box (Tendril 610's afterimage on time = 1), and a
//   grab whose hit IS a projectile has no HitDef of his, so no live tick.
//   His box: the Clsn1 of the element his animation shows that tick
//   (movelib.airModel, the engine's own reader), scaled by his [Size] xscale
//   and 320/localcoord (updateClsnScale, char.go 7854-7876), live from the
//   tick his HitDef's trigger holds to the state's end.
//   Her body (bodyOf): her standing Clsn2 core, the part of action 0 every
//   frame covers (fallback [Size] ground.back/front), at her scale.
//   At tick t she, facing him at d, is hit when d is inside
//   W(t) = [x(t) + l1 + L2, x(t) + r1 + R2]. Push needs both size boxes and
//   both Clsn2 to touch and runs before the hit (char.go 14140), so the
//   chosen d also stays clear of his front: d >= K(t) = the most his front
//   edge reached so far + hers + 1. The earliest live tick with
//   max(W.lo, K) <= W.hi wins, and d sits near its low end with a margin
//   for a one-tick offset: d = min(W.hi, lo + min(24, (W.hi - lo) / 2)).
//   A default CONNECTS when some live W(t) holds it with no contact on an
//   earlier tick; a step gets reach only when a default misses.
// NO CLSN1, NO GRAB (neverHits): a HitDef state whose every animation (its
//   header and its literal ChangeAnims) has no Clsn1 in any element can
//   never hit (Allosaurus' 22004: 76 elements, none with a Clsn1).
// A SUMMON'S REACH (summonReach): a direct summon whose Helper spawns at
//   postype p1 (Creatures' worm: pos 100, then VelAdd at AnimElem 7/8, its
//   Clsn1 on elements 7-8 only, scaled by HIS size - ownclsnscale is off)
//   runs through the same model from where it spawns; nested chains and
//   other postypes are none.
// A SUMMON'S FRONT STAND (summonFront): a summon whose Helper spawns at
//   postype front (the edge he faces, pos x outward) is placed by the runtime
//   with her place.front px from that edge. Its box is scaled by HIS [Size]
//   xscale (ownclsnscale off), so a box wide on paper may stop short of her
//   (YarimusiHIVE's mino: Clsn1 -117..116 at xscale 0.6 is -70..70, 6 px off
//   her back at 95). The helper's own motion from where it spawns gives its
//   farthest live reach toward her (its front when it faces him, else its
//   back); her stand is that plus her back's Clsn2 core, less 8 px, in his
//   units - only where that is nearer the edge than the default and at
//   least 20.
// AN AIR START (airOf): a grab state with physics A falls to 52 the tick
//   after it is entered standing (char.go 12171-12176). Its start is lifted
//   to where his own lead state's arc reaches it (a state whose ChangeState
//   into the grab reads vel y or pos y and whose start rises: FutamaruPlus'
//   1800/1802 into 1801), else to his common jump's apex ([Velocity]
//   jump.neu, [Movement] yaccel). { y, vx, vy } in his own units; the reach
//   model then starts from there (no friction, the window ends at landing).
// THE HEIGHT (boxAt): a live box counts only through its Clsn1 rectangles
//   that reach her body's height - T..B, as high and as low as any frame of
//   her standing 0 reaches, at her yscale (bodyOf); a box above all of it
//   misses her. A body with no height (no Clsn2 in her 0) reads the whole
//   box, as before.
// AN ANTI-AIR GRAB (liftOf) and A SCENE IN THE AIR (highOf): below, beside
//   the functions.
const fs = require('fs');
const path = require('path');
const modlib = require('./modlib.js');
const ML = require('./movelib.js');
const X = require('./cnsexpr.js');
const S = require('./scenelib.js');

const T_MAX = 180;          // ticks replayed
const HOPS = 3;             // states followed after the entry
const MARGIN = 24;          // px over the window's low end
const STAND = 18;           // the runtime's single-pair stand, own units each side
const GAP = 36;             // the runtime's several-pair gap, 320 units
const FRONT_MARGIN = 8;     // px of overlap a summon's front stand keeps (summonFront)
const FRONT_MIN = 20;       // the least front stand: her own half-width or so

// ---- a character's constants ---------------------------------------------------
const DEFAULTS = {
  'size.xscale': 1, 'size.yscale': 1, 'size.ground.back': 15, 'size.ground.front': 16, 'size.air.back': 12, 'size.air.front': 12, 'size.height': 60,
  'velocity.walk.fwd.x': 2.4, 'velocity.walk.back.x': -2.2, 'velocity.run.fwd.x': 4.6, 'velocity.run.fwd.y': 0, 'velocity.run.back.x': -4.5, 'velocity.run.back.y': -3.8,
  'velocity.jump.neu.x': 0, 'velocity.jump.neu.y': -8.4, 'velocity.jump.back.x': -2.55, 'velocity.jump.fwd.x': 2.5,
  'velocity.runjump.back.x': -2.55, 'velocity.runjump.back.y': -8.1, 'velocity.runjump.fwd.x': 4, 'velocity.runjump.fwd.y': -8.1,
  'velocity.airjump.neu.x': 0, 'velocity.airjump.neu.y': -8.1, 'velocity.airjump.back.x': -2.55, 'velocity.airjump.fwd.x': 2.5,
  'movement.yaccel': 0.44, 'movement.stand.friction': 0.85, 'movement.crouch.friction': 0.82,
};
// (Defaults that initConstants scales by localcoord / 320: lengths and speeds.)
const UNSCALED = new Set(['size.xscale', 'size.yscale', 'movement.stand.friction', 'movement.crouch.friction']);
function defText(dir, def) {
  try { let t = fs.readFileSync(path.join(dir, def), 'latin1'); if (t.charCodeAt(0) === 0xef) t = t.slice(3); return t; } catch (e) { return ''; }
}
function iniFirst(text, want) {
  // The first section of that name, its first keys (common.go 1002-1022).
  const out = new Map();
  let inIt = false, done = false;
  for (const raw of text.split('\n')) {
    const l = S.trimGo(raw.split(';')[0]);
    if (!l) continue;
    if (l[0] === '[') { if (inIt) done = true; const nm = l.slice(1, l.indexOf(']') < 0 ? l.length : l.indexOf(']')).toLowerCase(); inIt = !done && nm === want; continue; }
    if (!inIt) continue;
    const eq = l.indexOf('=');
    if (eq <= 0) continue;
    const k = S.trimGo(l.slice(0, eq)).toLowerCase();
    if (!out.has(k)) out.set(k, S.trimGo(l.slice(eq + 1)));
  }
  return out;
}
// Stamped like airMemo: the .def's and its cns file's size and mtime. With
// no stamp a character updated over its old folder kept its first reading
// (stand distance, lift, air start) until the server restarted.
const constMemo = new Map();
const fileSig = (f) => { try { const st = fs.statSync(f); return st.size + ':' + st.mtimeMs; } catch (e) { return '-'; } };
function constsOf(dir, def) {
  const key = dir + '|' + def;
  const defSig = fileSig(path.join(dir, def));
  const hit = constMemo.get(key);
  if (hit && hit.defSig === defSig && hit.cnsSig === (hit.cnsAbs ? fileSig(hit.cnsAbs) : '-')) return hit.val;
  const dt = defText(dir, def);
  const info = iniFirst(dt, 'info');
  const lc = (() => { const v = parseFloat(String(info.get('localcoord') || '').split(',')[0]); return Number.isFinite(v) && v > 0 ? v : 320; })();
  let cnsAbs = null;
  {
    const files = iniFirst(dt, 'files');
    const rel = String(files.get('cns') || '').replace(/"/g, '').replace(/\\/g, '/').trim();
    if (rel) cnsAbs = modlib.resolveCI(dir, rel);
  }
  const cnsSig = cnsAbs ? fileSig(cnsAbs) : '-';
  let ct = '';
  try { if (cnsAbs) ct = fs.readFileSync(cnsAbs, 'latin1'); } catch (e) { ct = ''; }
  const vals = new Map();
  const k = lc / 320;
  for (const [n, v] of Object.entries(DEFAULTS)) vals.set(n, UNSCALED.has(n) ? v : v * k);
  for (const sec of ['size', 'velocity', 'movement']) {
    for (const [name, raw] of iniFirst(ct, sec)) {
      const parts = String(raw).split(',').map((s) => s.trim());
      const num = (s) => { const m = /^[+-]?(\d+\.?\d*|\.\d+)/.exec(s); return m ? parseFloat(m[0]) : null; };
      if (parts.length > 1 || sec === 'velocity') {
        ['x', 'y', 'z'].forEach((ax, i) => { if (parts[i] !== undefined && parts[i] !== '' && num(parts[i]) !== null) vals.set(sec + '.' + name + '.' + ax, num(parts[i])); });
      }
      if (num(parts[0]) !== null) vals.set(sec + '.' + name, num(parts[0]));
    }
  }
  const text = (k) => { const v = String(info.get(k) || ''); return v.length >= 2 && v[0] === '"' && v[v.length - 1] === '"' ? v.slice(1, -1) : v; };
  const out = { lc, ls: 320 / lc, vals, get: (n) => vals.get(n), name: text('name'), author: text('author') };
  constMemo.set(key, { defSig, cnsAbs, cnsSig, val: out });
  return out;
}

// ---- his animations ------------------------------------------------------------
const airMemo = new Map();
function actionsOf(abs) {
  if (!abs) return new Map();
  let sig = '';
  try { const st = fs.statSync(abs); sig = st.size + ':' + st.mtimeMs; } catch (e) { return new Map(); }
  const hit = airMemo.get(abs);
  if (hit && hit.sig === sig) return hit.val;
  let val = new Map();
  try { val = ML.airModel(fs.readFileSync(abs, 'latin1')).actions; } catch (e) { val = new Map(); }
  airMemo.set(abs, { sig, val });
  return val;
}
// The element shown at curtime ct (looping from loopStart; a -1 element holds).
function frameAt(act, ct) {
  const fr = act && act.frames;
  if (!fr || !fr.length) return null;
  const tot = act.ticks;
  let tt = ct;
  if (!act.endless && tot > 0 && tt >= tot) {
    const pre = fr[act.loopStart] ? fr[act.loopStart].start : 0;
    const loop = Math.max(1, tot - pre);
    tt = pre + ((tt - pre) % loop);
  }
  for (const f of fr) { const d = f.time === -1 ? 1e9 : Math.max(0, f.time); if (tt < f.start + d && d > 0) return f; }
  return fr[fr.length - 1];
}
function animTotal(act) { return !act ? null : act.endless ? -1 : act.ticks; }

// ---- triggers that read time only ----------------------------------------------------
const lit = (v) => S.lit(v);
const redirectedAt = (str, off) => /,\s*$/.test(str.slice(0, off));
function subst(expr, env) {
  let s = String(expr);
  const rep = (re, fn) => { s = s.replace(re, (...m) => { const off = m[m.length - 2], str = m[m.length - 1]; if (redirectedAt(str, off)) return m[0]; return fn(...m); }); };
  rep(/\bconst\s*\(\s*([a-z0-9_.]+)\s*\)/gi, (all, n) => { const v = env.consts.get(n.toLowerCase()); return v === undefined ? all : '(' + v + ')'; });
  rep(/\bcommand\s*(!=|=)\s*"[^"]*"/gi, (all, op) => ((op === '=') === !!env.cmds ? '1' : '0'));
  rep(/\banimelemtime\s*\(\s*(\d+)\s*\)/gi, (all, k) => '(' + env.elemTime(+k) + ')');
  rep(/\banimelem\s*=\s*(\d+)(?:\s*,\s*(>=|<=|!=|=|<|>)?\s*(-?\d+))?/gi, (all, k, op, n) => {
    const et = env.elemTime(+k);
    if (et === null) return all;
    if (n === undefined) return et === 0 ? '1' : '0';
    const v = +n;
    const r = { '=': et === v, '!=': et !== v, '<': et < v, '>': et > v, '<=': et <= v, '>=': et >= v }[op || '='];
    return r ? '1' : '0';
  });
  rep(/\banimelemno\s*\(\s*0\s*\)/gi, () => String(env.elemNo));
  rep(/\banimtime\b/gi, () => '(' + env.animTime + ')');
  rep(/\bstatetime\b/gi, () => String(env.time));
  rep(/\b(movehit|movecontact|moveguarded|movereversed|hitcount|uniqhitcount|hitpausetime)\b/gi, () => '0');
  rep(/\bnum(?:target|projid|proj)\b(\s*\(\s*\d+\s*\))?/gi, () => '0');
  rep(/\bailevel\b/gi, () => '0');
  rep(/\broundstate\b/gi, () => '2');
  rep(/\bishelper\b(\s*\(\s*(\d+)\s*\))?/gi, (all, p, id) => (env.helperId === null ? '0' : (id === undefined || +id === env.helperId ? '1' : '0')));
  rep(/\bstateno\b/gi, () => String(env.stateNo));
  rep(/\bpos\s+y\b/gi, (all) => (env.posY === undefined ? all : '(' + env.posY + ')'));
  rep(/\bvel\s+y\b/gi, (all) => (env.velY === undefined ? all : '(' + env.velY + ')'));
  rep(/\bvel\s+x\b/gi, (all) => (env.velX === undefined ? all : '(' + env.velX + ')'));
  return s;
}
const truthy = (v) => (v === null || v === undefined || (typeof v === 'number' && Number.isNaN(v)) ? null : typeof v === 'boolean' ? v : v !== 0);
function evalTrig(sc, env) {
  const one = (e) => truthy(X.evalExpr(subst(e, env), { time: env.time, nameEq: env.nameEq }));
  const andOf = (list) => { let r = true; for (const e of list) { const v = one(e); if (v === false) return false; if (v === null) r = null; } return r; };
  const a = andOf(sc.trig.all);
  if (a === false) return false;
  if (!sc.trig.groups.length) return a === null ? null : false;   // no trigger1: never fires
  let any = false;
  for (const g of sc.trig.groups) { const v = andOf(g); if (v === true) { any = true; break; } if (v === null) any = null; }
  if (any === false) return false;
  return any === null || a === null ? null : true;
}
function evalVal(raw, env) {
  if (raw === undefined || raw === null) return null;
  const v = X.evalExpr(subst(raw, env), { time: env.time });
  return typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'boolean' ? (v ? 1 : 0) : null;
}
const pair = (raw) => { if (raw === undefined) return null; const parts = []; let depth = 0, cur = ''; for (const ch of String(raw)) { if (ch === '(') depth++; if (ch === ')') depth--; if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; } else cur += ch; } parts.push(cur); return parts.map((p) => p.trim()); };

// A HitDef that catches a standing partner (gallerydata's standingGrab).
function standingHit(sc) {
  if (sc.type !== 'hitdef') return false;
  const hf = String(sc.params.has('hitflag') ? sc.params.get('hitflag') : 'MAF').replace(/\s+/g, '').toUpperCase();
  return !hf.includes('+') && /[HM]/.test(hf);
}
const isBasic = (n) => !Number.isFinite(n) || n <= 199 || (n >= 5000 && n <= 5999);

// ---- the motion ----------------------------------------------------------------
// opts: { states (an.states), acts (his actions), C (his constants), x0, y0, vx0, vy0, physics0, helperId, noVelset, stopAt(state, sc, env) }
// -> { ticks: [{ t, x, y, live, box: [l1, r1] | null, front }], end } or null (unknown)
function motion(E, o) {
  const st0 = o.states.get(E);
  if (!st0) return null;
  const C = o.C, ls = C.ls, cs = C.get('size.xscale') * ls, csy = C.get('size.yscale') * ls;
  let x = o.x0 || 0, y = o.y0 || 0, vx = o.vx0 || 0, vy = o.vy0 || 0, physics = o.physics0 || 's';
  let st = null, stateTime = 0, curtime = 0, act = null, live = false, hops = 0, fired = new Set();
  const out = { ticks: [], end: 'time' };
  const envOf = () => {
    const tot = animTotal(act);
    return {
      consts: C.vals, time: stateTime, stateNo: st.no, helperId: o.helperId === undefined ? null : o.helperId,
      animTime: tot === null ? 'unknown_' : tot < 0 ? curtime + 1 : curtime - tot,
      elemTime: (k) => { if (!act || !act.frames.length) return null; if (k > act.frames.length) return null; return curtime - act.frames[k - 1].start; },
      elemNo: (() => { const f = frameAt(act, curtime); return f ? f.elem : 0; })(),
      posY: y, velY: vy, velX: vx, cmds: o.cmds,
      // (AuthorName and Name are his own; a helper's Name is unknown.)
      nameEq: (which, txt) => (which === 'authorname' ? C.author.toLowerCase() === String(txt).toLowerCase()
        : which === 'name' && o.helperId === undefined ? C.name.toLowerCase() === String(txt).toLowerCase() : null),
    };
  };
  const setAnim = (n) => { act = o.acts.get(n) || null; curtime = 0; return !!act; };
  const enter = (no, first) => {
    st = o.states.get(no);
    if (!st) return false;
    stateTime = 0; live = false; fired = new Set();
    const h = st.header;
    const env = envOf();
    if (h.has('velset') && !(first && o.noVelset)) {
      const p = pair(h.get('velset'));
      const a = evalVal(p[0], env), b = p.length > 1 ? evalVal(p[1], env) : 0;
      if (a === null || b === null) return null;
      vx = a; vy = b;
    }
    if (h.has('physics')) { const ph = String(h.get('physics')).trim().toLowerCase()[0]; if ('scan'.includes(ph)) physics = ph; }
    if (h.has('anim')) { const n = evalVal(h.get('anim'), env); if (n === null || !setAnim(n)) return null; }
    else if (first) return null;
    return true;
  };
  if (enter(E, true) !== true) return null;
  for (let t = 0; t < T_MAX; t++) {
    // The state's controllers, in order; a state change runs the new one.
    let changed = true;
    while (changed) {
      changed = false;
      for (const sc of st.sctrls) {
        const ty = sc.type;
        const relevant = ty === 'changestate' || ty === 'selfstate' || ty === 'changeanim' || ty === 'changeanim2' || ty === 'velset' || ty === 'veladd' || ty === 'velmul'
          || ty === 'posadd' || ty === 'posset' || standingHit(sc) || (o.watch && o.watch(sc));
        if (!relevant) continue;
        const pers = lit(sc.params.get('persistent'));
        if (pers === 0 && fired.has(sc)) continue;
        const env = envOf();
        const on = evalTrig(sc, env);
        if (o.watch && o.watch(sc)) {
          // (A controller the caller waits for: where he is, and how fast,
          // on the tick it fires - before that tick's move.)
          if (on === null) return null;
          if (on) { out.watched = { t, x: x * ls, y, vx, vy, state: st.no }; return out; }
          continue;
        }
        if (ty === 'changestate' || ty === 'selfstate') {
          if (on !== true) continue;
          fired.add(sc);
          const v = evalVal(sc.params.get('value'), env);
          if (v === null) { out.end = 'unknown state'; return out; }
          if (v === st.no) continue;
          if (isBasic(v) || hops >= HOPS) { out.end = 'left'; return out; }
          hops++;
          const r = enter(v, false);
          if (r !== true) { out.end = 'unknown state'; return out; }
          changed = true;
          break;
        }
        if (on === null) return null;
        if (!on) continue;
        fired.add(sc);
        const px = (n) => evalVal(sc.params.get(n), env);
        if (ty === 'changeanim') { const n = px('value'); if (n === null || !setAnim(n)) return null; const el = px('elem'); if (el !== null && el > 1 && act.frames[el - 1]) curtime = act.frames[el - 1].start; }
        else if (ty === 'changeanim2') return null;
        else if (ty === 'velset') { if (sc.params.has('x')) { const v = px('x'); if (v === null) return null; vx = v; } if (sc.params.has('y')) { const v = px('y'); if (v === null) return null; vy = v; } }
        else if (ty === 'veladd') { if (sc.params.has('x')) { const v = px('x'); if (v === null) return null; vx += v; } if (sc.params.has('y')) { const v = px('y'); if (v === null) return null; vy += v; } }
        else if (ty === 'velmul') { if (sc.params.has('x')) { const v = px('x'); if (v === null) return null; vx *= v; } if (sc.params.has('y')) { const v = px('y'); if (v === null) return null; vy *= v; } }
        else if (ty === 'posadd') { if (sc.params.has('x')) { const v = px('x'); if (v === null) return null; x += v; } if (sc.params.has('y')) { const v = px('y'); if (v === null) return null; y += v; } }
        else if (ty === 'posset') { if (sc.params.has('x')) return null; if (sc.params.has('y')) { const v = px('y'); if (v === null) return null; y = v; } }
        else if (standingHit(sc)) live = true;
      }
    }
    // posUpdate, then the physics.
    x += vx; y += vy;
    if (physics === 's') { vx *= C.get('movement.stand.friction'); if (Math.abs(vx * ls) < 1) vx = 0; }
    else if (physics === 'c') vx *= C.get('movement.crouch.friction');
    else if (physics === 'a') {
      vy += C.get('movement.yaccel');
      if (vy > 0 && y >= 0) { out.ticks.push({ t, x: x * ls, y: y * ls, live: false, box: null }); out.end = 'landed'; return out; }
    }
    const f = frameAt(act, curtime);
    const box = live && f && f.clsn1.length ? [Math.min(...f.clsn1.map((b) => b[0])) * cs, Math.max(...f.clsn1.map((b) => b[2])) * cs] : null;
    // (rects: each Clsn1 rectangle of the live frame, its x from him and its
    // y in the world, both 320 units - THE HEIGHT reads them.)
    const rects = box ? f.clsn1.map((b) => [Math.min(b[0], b[2]) * cs, y * ls + Math.min(b[1], b[3]) * csy, Math.max(b[0], b[2]) * cs, y * ls + Math.max(b[1], b[3]) * csy]) : null;
    // (c2: a frame with a Clsn2 can push her; one without passes through.)
    out.ticks.push({ t, x: x * ls, y: y * ls, live, box, rects, c2: !!(f && f.clsn2.length), state: st.no });
    stateTime++; curtime++;
  }
  return out;
}

// ---- her body ------------------------------------------------------------------
// { lc, ls, front, back, L, R, T?, B? } in 320 units: her standing Clsn2 core
// (T, B its height: as high and as low as any frame reaches, up negative;
// none where action 0 has no Clsn2, and then no height is read).
function bodyOf(dir, def) {
  const C = constsOf(dir, def);
  const ls = C.ls;
  const front = C.get('size.ground.front') * ls, back = C.get('size.ground.back') * ls;
  let core = null;
  try { core = coreOf(actionsOf(modlib.defFiles(dir, def).anim).get(0), C); } catch (e) { core = null; }
  const out = { lc: C.lc, front: r1(front), back: r1(back) };
  if (core) Object.assign(out, core); else { out.L = r1(-back); out.R = r1(front); }
  return out;
}
// An action's Clsn2 at her scale, { L, R, T, B } in 320 units, or null: L..R
// the part every frame with one covers (a box that reaches it certainly
// reaches her), T..B the height any frame reaches (a box above all of it
// certainly misses her: GnollK's 6069 meets R.Mika's highest frame by 2 px
// and stays a grab of the default stand).
// (cT..cB, the height every frame covers, is where a lift centers her: AN
// ANTI-AIR GRAB.)
function coreOf(a, C) {
  const cs = C.get('size.xscale') * C.ls, csy = C.get('size.yscale') * C.ls;
  let L = -Infinity, R = Infinity, T = Infinity, B = -Infinity, cT = -Infinity, cB = Infinity, any = false;
  for (const fr of (a ? a.frames : [])) {
    if (!fr.clsn2.length) continue;
    any = true;
    L = Math.max(L, Math.min(...fr.clsn2.map((b) => Math.min(b[0], b[2]))));
    R = Math.min(R, Math.max(...fr.clsn2.map((b) => Math.max(b[0], b[2]))));
    const top = Math.min(...fr.clsn2.map((b) => Math.min(b[1], b[3]))), bot = Math.max(...fr.clsn2.map((b) => Math.max(b[1], b[3])));
    T = Math.min(T, top); B = Math.max(B, bot);
    cT = Math.max(cT, top); cB = Math.min(cB, bot);
  }
  if (!any || L > R || T > B) return null;
  const out = { L: r1(L * cs), R: r1(R * cs), T: r1(T * csy), B: r1(B * csy) };
  if (cT <= cB) { out.cT = r1(cT * csy); out.cB = r1(cB * csy); }
  return out;
}
const r1 = (v) => Math.round(v * 10) / 10;
// HER AIR BODY (liftOf): the action she is held on in the air and its Clsn2
// core - her neutral jump (41) where every frame of it draws (`has(group,
// index)`: a sprite her .sff holds) and some frame has a Clsn2, else her
// standing 0. { anim, lc, L, R, T, B, cT?, cB? } or null.
const LIFT_ANIMS = [41, 0];
function liftBodyOf(dir, def, has) {
  try {
    const C = constsOf(dir, def);
    const acts = actionsOf(modlib.defFiles(dir, def).anim);
    for (const n of LIFT_ANIMS) {
      const a = acts.get(n);
      if (!a || !a.frames.length) continue;
      if (typeof has === 'function' && !a.frames.every((f) => f.group < 0 || has(f.group + ',' + f.number))) continue;
      const core = coreOf(a, C);
      if (core) return Object.assign({ anim: n, lc: C.lc }, core);
    }
  } catch (e) { return null; }
  return null;
}

// ---- the window ----------------------------------------------------------------------
// From a motion and her body: the live ticks' windows, each with the contact
// bound K (his front's farthest reach so far + hers + 1).
function windowOf(m, body, hisFront, useContact) {
  const herFront = body.front;
  let K = -Infinity;
  const wins = [];
  for (const tk of m.ticks) {
    if (useContact) K = Math.max(K, tk.x + hisFront + herFront + 1);
    const box = boxAt(tk, body);
    if (!box) continue;
    wins.push({ t: tk.t, lo: tk.x + box[0] + body.L, hi: tk.x + box[1] + body.R, K });
  }
  return wins;
}
// THE HEIGHT: his live box at a tick as it can meet her - the x extent of
// the Clsn1 rectangles that reach her body's height (T..B, raised by
// body.lift where she is held in the air) - or null where none does (a box
// over her head: Murakami's high grabs). A body with no height, or a tick
// with no rectangles, reads the whole box as before.
function boxAt(tk, body) {
  if (!tk.live || !tk.box) return null;
  if (!tk.rects || !Number.isFinite(body.T) || !Number.isFinite(body.B)) return tk.box;
  const up = body.lift || 0;
  const on = tk.rects.filter((r) => r[1] <= body.B - up && r[3] >= body.T - up);
  return on.length ? [Math.min(...on.map((r) => r[0])), Math.max(...on.map((r) => r[2]))] : null;
}
// Does a stand at d connect? The pair stands idle first, so the engine's push
// has them at least front to front (both stand anims have a Clsn2); then,
// tick by tick, a frame of his with a Clsn2 pushes her ahead of his front,
// one without passes through her (FutaRB Mina's dash, Succubus' run).
// (A summon's helper is no pusher: pushes = false.)
function connects(m, body, hisFront, d, pushes) {
  const fronts = hisFront + body.front;
  let dd = Math.max(d, fronts);
  for (const tk of m.ticks) {
    if (pushes && tk.c2 && dd < tk.x + fronts) dd = tk.x + fronts;
    const box = boxAt(tk, body);
    if (box && dd >= tk.x + box[0] + body.L && dd <= tk.x + box[1] + body.R) return true;
  }
  return false;
}
function pick(wins) {
  for (const w of wins) {
    const lo = Math.max(w.lo, w.K);
    if (lo > w.hi) continue;
    const d = Math.min(w.hi, lo + Math.min(MARGIN, (w.hi - lo) / 2));
    return { d: Math.round(d), lo: Math.round(lo), hi: Math.round(w.hi), t: w.t };
  }
  return null;
}

// ---- per giver ------------------------------------------------------------------------
const memoOf = new WeakMap();
function giverCtx(G) {
  let m = memoOf.get(G);
  if (!m) {
    const gf = modlib.defFiles(G.dir, G.def);
    m = { C: constsOf(G.dir, G.def), acts: actionsOf(gf.anim), reach: new Map(), air: new Map(), summon: new Map(), lift: new Map() };
    memoOf.set(G, m);
  }
  return m;
}
// (Her height too: two partners alike across but not up and down do not share an answer.)
const bodyKey = (b) => [b.lc, b.front, b.L, b.R, b.T, b.B].join(',');

// The defaults the runtime stands a pair at, 320 units.
function defaultsFor(Cg, body) { return [STAND * Cg.ls + STAND * (320 / body.lc), GAP]; }

// giverReach(G, E, body) -> null | { d, lo, hi }: null where the default
// connects (or nothing is known).
function giverReach(G, E, body) {
  if (!G || !body) return null;
  const m = giverCtx(G);
  const k = E + '|' + bodyKey(body);
  if (m.reach.has(k)) return m.reach.get(k);
  let res = null;
  try {
    const air = airOf(G, E);
    const mo = motion(E, Object.assign({ states: G.an.states, acts: m.acts, C: m.C }, air ? { y0: air.y, vx0: air.vx, vy0: air.vy, physics0: 'a', noVelset: true } : {}));
    if (mo) {
      const front = m.C.get('size.ground.front') * m.C.ls;
      const wins = windowOf(mo, body, front, true);
      if (wins.length && !defaultsFor(m.C, body).every((d) => connects(mo, body, front, d, true))) {
        const p = pick(wins);
        if (p) res = { d: p.d, lo: p.lo, hi: p.hi };
      }
    }
  } catch (e) { res = null; }
  m.reach.set(k, res);
  return res;
}

// neverHits({ an, dir, def }, no): every animation the state can show has no
// Clsn1 at all.
function neverHits(g, no) {
  const s = g.an.states.get(no);
  if (!s) return false;
  if (s.sctrls.some((sc) => sc.type === 'projectile' || sc.type === 'changeanim2')) return false;
  const anims = [];
  if (s.anim === null || s.anim === undefined) return false;
  const a0 = lit(s.anim);
  if (a0 === null) return false;
  anims.push(a0);
  for (const sc of s.sctrls) {
    if (sc.type !== 'changeanim') continue;
    const v = lit(sc.params.get('value'));
    if (v === null) return false;
    anims.push(v);
  }
  let acts;
  try { acts = actionsOf(modlib.defFiles(g.dir, g.def).anim); } catch (e) { return false; }
  // (An .air with no Clsn1 anywhere tells nothing: a sheet drawn without boxes.)
  let any = false;
  for (const a of acts.values()) if (a.frames.some((f) => f.clsn1.length)) { any = true; break; }
  if (!any) return false;
  for (const n of anims) {
    const a = acts.get(n);
    if (!a || !a.frames.length) return false;
    if (a.frames.some((f) => f.clsn1.length)) return false;
  }
  return true;
}

// summonReach(G, sm, body) -> null | { d, lo, hi }
function summonReach(G, sm, body) {
  if (!G || !sm || !body || sm.nested || sm.place) return null;
  const m = giverCtx(G);
  const k = sm.no + '#' + sm.helper + '|' + bodyKey(body);
  if (m.summon.has(k)) return m.summon.get(k);
  let res = null;
  try {
    const hc = (G.helperCtrls || []).find((h) => h.state === sm.no && h.id === sm.helper);
    const pt = hc ? String(hc.sc.params.get('postype') || 'p1').toLowerCase().replace(/\s+/g, '') : '';
    if (hc && (pt === '' || pt === 'p1')) {
      // Where he is when it spawns: his own motion up to the Helper's tick.
      const his = motion(sm.no, { states: G.an.states, acts: m.acts, C: m.C, watch: (sc) => sc === hc.sc });
      const at = his && his.watched;
      const env = { consts: m.C.vals, time: 0, stateNo: sm.no, helperId: null, animTime: 'unknown_', elemTime: () => null, elemNo: 0 };
      const pos = pair(hc.sc.params.get('pos') || '0,0');
      const px = evalVal(pos[0] || '0', env), py = pos.length > 1 ? evalVal(pos[1] || '0', env) : 0;
      const sn = evalVal(hc.sc.params.get('stateno'), env);
      const facing = hc.sc.params.has('facing') ? evalVal(hc.sc.params.get('facing'), env) : 1;
      if (at && px !== null && py !== null && sn !== null && facing !== null && facing >= 0) {
        const hm = motion(sn, { states: G.an.states, acts: m.acts, C: m.C, x0: at.x / m.C.ls + px, y0: py, helperId: sm.helper, physics0: 'n' });
        if (hm) {
          const wins = windowOf(hm, body, 0, false);
          const front = m.C.get('size.ground.front') * m.C.ls;
          if (wins.length && !defaultsFor(m.C, body).every((d) => connects(hm, body, front, d, false))) {
            const p = pick(wins);
            if (p) res = { d: p.d, lo: p.lo, hi: p.hi };
          }
        }
      }
    }
  } catch (e) { res = null; }
  m.summon.set(k, res);
  return res;
}

// summonFront(G, sm, body) -> null | front (his own units)
function summonFront(G, sm, body) {
  if (!G || !sm || !body || sm.nested || !sm.place || !Number.isFinite(sm.place.front)) return null;
  const m = giverCtx(G);
  const k = sm.no + '#' + sm.helper + '|' + bodyKey(body) + '|front';
  if (m.summon.has(k)) return m.summon.get(k);
  let res = null;
  try {
    const hc = (G.helperCtrls || []).find((h) => h.state === sm.no && h.id === sm.helper);
    const pt = hc ? String(hc.sc.params.get('postype') || 'p1').toLowerCase().replace(/\s+/g, '') : '';
    if (hc && pt === 'front') {
      const env = { consts: m.C.vals, time: 0, stateNo: sm.no, helperId: null, animTime: 'unknown_', elemTime: () => null, elemNo: 0 };
      const pos = pair(hc.sc.params.get('pos') || '0,0');
      const px = evalVal(pos[0] || '0', env);
      const sn = evalVal(hc.sc.params.get('stateno'), env);
      const facing = hc.sc.params.has('facing') ? evalVal(hc.sc.params.get('facing'), env) : 1;
      if (px !== null && sn !== null && facing !== null && facing !== 0) {
        const hm = motion(sn, { states: G.an.states, acts: m.acts, C: m.C, helperId: sm.helper, physics0: 'n' });
        // (How far inside the edge it stands, 320 units: postype front puts
        // it at the edge he faces plus pos x, outward.)
        const inside = -px * m.C.ls;
        let reach = -Infinity;
        for (const tk of (hm ? hm.ticks : [])) {
          if (!tk.live || !tk.box) continue;
          // (Its front toward her when it faces back at him, else its back.)
          reach = Math.max(reach, facing < 0 ? tk.x + tk.box[1] : -(tk.x + tk.box[0]));
        }
        if (Number.isFinite(reach)) {
          const need = (inside + reach - body.L - FRONT_MARGIN) / m.C.ls;
          if (need < sm.place.front && need >= FRONT_MIN) res = Math.floor(need);
        }
      }
    }
  } catch (e) { res = null; }
  m.summon.set(k, res);
  return res;
}

// airOf(G, E) -> null | { y, vx, vy } (his own units)
function airOf(G, E) {
  if (!G) return null;
  const m = giverCtx(G);
  if (m.air.has(E)) return m.air.get(E);
  let res = null;
  try {
    const s = G.an.states.get(E);
    const ph = s && s.header.has('physics') ? String(s.header.get('physics')).trim().toLowerCase()[0] : null;
    if (s && ph === 'a' && s.sctrls.some(standingHit)) {
      // (a) his lead: a rising state whose ChangeState into E reads vel y / pos y.
      const ARC = /\b(vel|pos)\s+y\b/i;
      for (const [J, js] of G.an.states) {
        if (J === E || J < 0 || isBasic(J) || (G.root && !G.root.has(J))) continue;
        const exit = js.sctrls.find((sc) => (sc.type === 'changestate' || sc.type === 'selfstate') && lit(sc.params.get('value')) === E
          && ARC.test([...sc.trig.all, ...sc.trig.groups.flat()].join(' ')));
        if (!exit) continue;
        // (Entered by his press: its command reads as pressed on its way.)
        const mo = motion(J, { states: G.an.states, acts: m.acts, C: m.C, cmds: true, watch: (sc) => sc === exit });
        const w = mo && mo.watched;
        if (!w || !(w.y < 0)) continue;
        res = { y: rd(w.y), vx: rd(w.vx), vy: rd(w.vy) };
        break;
      }
      // (b) his common jump's apex.
      if (!res) {
        const vy0 = m.C.get('velocity.jump.neu.y'), g = m.C.get('movement.yaccel');
        if (vy0 < 0 && g > 0) res = { y: rd(-(vy0 * vy0) / (2 * g)), vx: 0, vy: 0 };
      }
    }
  } catch (e) { res = null; }
  m.air.set(E, res);
  return res;
}
const rd = (v) => Math.round(v * 100) / 100;

// liftOf(G, E, body, air) -> null | { y, anim, d? }: AN ANTI-AIR GRAB. A grab
// none of whose live Clsn1 ever reaches her standing body's height (the
// whole box over her head), whose HitDef hits the air (hitflag A), takes her
// only in the air: `y` is the height her own units hold her at (up
// negative) on `anim` (HER AIR BODY, `air`: liftBodyOf), her core's middle
// at the middle of his first live box's lowest rectangle; `d` the stand
// (320 units) where the default one misses her there. Nobody is pushed in
// the air, so the window has no contact bound. Murakami's 484 and his other
// high grabs (anim 420: Clsn1 y -287..-222 at his yscale 0.5, -143..-111,
// over R.Mika's head at about -100): headless, "this scene did not start".
function liftOf(G, E, body, air) {
  if (!G || !body || !air || !Number.isFinite(body.T) || !Number.isFinite(air.T)) return null;
  const m = giverCtx(G);
  const k = E + '|' + bodyKey(body) + '|' + [air.anim, air.lc, air.L, air.R, air.T, air.B, air.cT, air.cB].join(',');
  if (m.lift.has(k)) return m.lift.get(k);
  let res = null;
  try {
    const s = G.an.states.get(E);
    const hd = s && s.sctrls.find(standingHit);
    const hf = hd ? String(hd.params.has('hitflag') ? hd.params.get('hitflag') : 'MAF').replace(/\s+/g, '').toUpperCase() : '';
    if (hd && hf.includes('A')) {
      const st = airOf(G, E);
      const mo = motion(E, Object.assign({ states: G.an.states, acts: m.acts, C: m.C }, st ? { y0: st.y, vx0: st.vx, vy0: st.vy, physics0: 'a', noVelset: true } : {}));
      const live = mo ? mo.ticks.filter((tk) => tk.live && tk.rects) : [];
      if (live.length && !live.some((tk) => boxAt(tk, body))) {
        const r = live[0].rects.reduce((a, b) => (b[3] > a[3] ? b : a));
        const mid = Number.isFinite(air.cT) && Number.isFinite(air.cB) ? (air.cT + air.cB) / 2 : (air.T + air.B) / 2;
        const h = mid - (r[1] + r[3]) / 2;
        const up = Object.assign({}, body, { L: air.L, R: air.R, T: air.T, B: air.B, lift: h });
        const front = m.C.get('size.ground.front') * m.C.ls;
        const wins = h > 0 ? windowOf(mo, up, front, false) : [];
        if (wins.length) {
          res = { y: rd(-h * air.lc / 320), anim: air.anim };
          if (!defaultsFor(m.C, up).every((d) => connects(mo, up, front, d, false))) {
            const p = pick(wins);
            if (p) res.d = p.d; else res = null;
          }
        }
      }
    }
  } catch (e) { res = null; }
  m.lift.set(k, res);
  return res;
}
// highOf(G, E, body) -> null | y: A SCENE IN THE AIR. Where his grab takes
// her off the ground and the state his hit goes on to holds him there
// (physics N), the highest point his own position reaches in its first ticks
// (320 units, up negative; his feet): the height of the first live tick whose
// box meets her at the default stand, then that state's own moves from there.
// Murakami's winged demon: 487 dives from -90 and takes her at about -69, his
// 3600 rises 20 px four times - his feet at -149, he and she above the view
// of a stage whose camera barely rises (Mountainside Temple's boundhigh -25:
// headless, only his legs on screen for the whole scene). Only past HIGH_MIN.
const HIGH_MIN = 60;
function highOf(G, E, body) {
  if (!G || !body) return null;
  const m = giverCtx(G);
  const k = E + '|' + bodyKey(body) + '|high';
  if (m.lift.has(k)) return m.lift.get(k);
  let res = null;
  try {
    const s = G.an.states.get(E);
    const hd = s && s.sctrls.find(standingHit);
    const P = hd ? lit(hd.params.get('p1stateno')) : null;
    const ps = P !== null ? G.an.states.get(P) : null;
    const ph = ps && ps.header.has('physics') ? String(ps.header.get('physics')).trim().toLowerCase()[0] : null;
    if (ps && ph === 'n') {
      const st = airOf(G, E);
      const mo = motion(E, Object.assign({ states: G.an.states, acts: m.acts, C: m.C }, st ? { y0: st.y, vx0: st.vx, vy0: st.vy, physics0: 'a', noVelset: true } : {}));
      const d = defaultsFor(m.C, body)[0];
      const hit = mo ? mo.ticks.find((tk) => { const b = boxAt(tk, body); return b && d >= tk.x + b[0] + body.L && d <= tk.x + b[1] + body.R; }) : null;
      if (hit && hit.y < 0) {
        const sm = motion(P, { states: G.an.states, acts: m.acts, C: m.C, y0: hit.y / m.C.ls, physics0: 'n' });
        const top = Math.min(hit.y, ...(sm ? sm.ticks.map((tk) => tk.y) : []));
        if (top < -HIGH_MIN) res = Math.round(top);
      }
    }
  } catch (e) { res = null; }
  m.lift.set(k, res);
  return res;
}
module.exports = { giverReach, summonReach, summonFront, neverHits, airOf, liftOf, highOf, bodyOf, liftBodyOf, constsOf, motion, frameAt, actionsOf, windowOf, boxAt, pick, connects, defaultsFor };
