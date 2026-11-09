'use strict';
// THE COMMAND LIST WRITER, the Studio's side. Ikemen GO's pause-menu Command
// List is written by public/ikemen/cmdlist-core.js (its header is the spec:
// what a row is, the name, the strengths, the file, the notation, never into
// the character's own folder) - the same file the web game's in-page Studio
// runs for a character a player adds there. This module hands it the
// character's folder on the disk, keeps the read cache a build and the Moves
// page lean on, gives a row its `drawable` flag (jpfont.js) and reads the
// cancels (the Moves page only). Its exports are the ones it always had.
// DOCS: GRAIL 3.10e.
//
// THE CANCELS (`cancels`, read only when asked: the Moves page, never an
// export). For every attack state S (a HitDef/ReversalDef/Projectile/Modify
// in its own code) and every [State -1] ChangeState a player's command
// takes into a normal, special or super T: can that block fire while S is
// running, on hit and on block? Each trigger group is read (cnsexpr, three
// valued) with stateno = S, no control, S's own statetype / movetype /
// HitDef attr, the contact of the scenario, time from a few ticks in (a
// window only open in the first 3 ticks is a kara cancel, not one on hit),
// the variables the [State -3/-2/-1] VarSets give in that tick (KFM's
// var(1), Balrog's var(6), the CvS template's var(22) - EXACT, `via` names
// the variable), and a variable S sets in its own code (a VarSet there, read
// on the next tick: marked APPROXIMATE). A group must be shut in a neutral
// non-attack state with no contact, else it is not a cancel (a route open
// everywhere, or one this reader cannot see). Variables a trigger group's own
// lines read that nothing above sets are 0 (a mode such as a custom combo is
// off); in the block's triggerall they are unknown (a charge counter, meter).
// Kinds: SU (a super, 3000-4999), SP (a special, 1000-2999), CH (a chain:
// normal 200-999 into normal). -> [{ state: S, to: [{ state: T, kind, hit,
// block, exact, via: ['var(N)'], file, line }] }].
const fs = require('fs');
const path = require('path');
const X = require('./cnsexpr.js');
const JP = require('./jpfont.js');
const core = require('./public/ikemen/cmdlist-core.js');
const { targets, aiOn } = core;

// The character's folder on the disk, as the core reads it: paths relative to
// the folder ('..' leads out of it), latin1 text.
function diskIo(charDir) {
  const at = (rel) => path.join(charDir, rel);
  return {
    read: (rel) => { try { return fs.readFileSync(at(rel), 'latin1'); } catch (e) { return null; } },
    isFile: (rel) => { try { return fs.statSync(at(rel)).isFile(); } catch (e) { return false; } },
    list: (rel) => { try { return fs.readdirSync(at(rel)); } catch (e) { return null; } },
  };
}
// Will the build draw it: the stock fonts or DotGothic16 (jpfont.js; the
// row's flag only - which name prints is the core's stockDraws).
const drawable = (s) => JP.drawable(String(s || ''));

// ---- THE CANCELS ------------------------------------------------------------------------
const HIT_CTRLS = new Set(['hitdef', 'reversaldef', 'projectile', 'modifyhitdef', 'modifyreversaldef']);
const CANCEL_TIMES = [4, 8, 14, 24, 40];
const ATTR_ALL = { aa: ['na', 'sa', 'ha'], at: ['nt', 'st', 'ht'], ap: ['np', 'sp', 'hp'] };
const attrSet = (list) => { const out = new Set(); for (const t of list) for (const x of ATTR_ALL[t] || [t]) out.add(x); return out; };
// `S, NA` -> { st: Set('s'), at: Set('na') }
const parseAttr = (text) => { const p = String(text || '').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean); return p.length ? { st: new Set(p[0].replace(/[^sca]/g, '')), at: attrSet(p.slice(1)) } : null; };
// `hitdefattr = SC, NA, SA` parses as a redirect chain (sc, na, sa): flattened back to its words
const chainWords = (n) => { const out = []; for (let x = n, g = 0; x && g < 12; g++) { if (x.t === 'redir') { out.push(x.name); x = x.r; } else { if (x.t === 'unk' && !x.args) out.push(x.id); break; } } return out; };
// VarSet / VarAdd of var(N): [{ name: 'var(N)', value: text, add }]
function varWrites(sc) {
  if (sc.type !== 'varset' && sc.type !== 'varadd') return [];
  const out = [];
  for (const [k, v] of sc.params) { const m = /^var\((\d+)\)$/i.exec(k); if (m) out.push({ name: 'var(' + parseInt(m[1], 10) + ')', value: v, add: sc.type === 'varadd' }); }
  const vn = sc.params.get('v');
  if (vn !== undefined && /^\s*\d+\s*$/.test(vn) && sc.params.has('value')) out.push({ name: 'var(' + parseInt(vn, 10) + ')', value: sc.params.get('value'), add: sc.type === 'varadd' });
  return out;
}
// opts: parsed (scenelib), commandsFor(lines) -> [command] | null
function cancelsOf(parsed, commandsFor) {
  const minus1 = parsed.states.get(-1);
  if (!minus1) return [];
  const sources = [...parsed.states.values()].filter((s) => s.no >= 0 && !s.zss && s.sctrls.some((c) => HIT_CTRLS.has(c.type)));
  if (!sources.length) return [];
  // the routes: -1 ChangeStates a player's command takes into a normal, special or super
  const routes = [];
  minus1.sctrls.forEach((sc, idx) => {
    if (sc.type !== 'changestate' || sc.neverTrue || !sc.trig.groups.length) return;
    const tg = targets(String(sc.params.get('value') || ''));
    const to = [...new Set([...tg.primary, ...tg.computed, ...tg.extra.map((x) => x.state)])].filter((v) => v >= 200 && v < 5000);
    if (!to.length) return;
    const groups = sc.trig.groups.map((g) => ({ all: sc.trig.all, g })).filter((x) => ![...x.all, ...x.g].some(aiOn) && commandsFor([...x.all, ...x.g]));
    if (groups.length) routes.push({ sc, idx, to, groups });
  });
  if (!routes.length) return [];
  // the variables the routes' own trigger lines read, and who writes them
  const read = new Set();
  for (const r of routes) for (const g of r.groups) for (const l of [...g.all, ...g.g]) for (const v of X.varsOf(l)) if (/^var\(/.test(v)) read.add(v);
  const writesIn = (st) => (st ? st.sctrls.flatMap((sc) => varWrites(sc).filter((w) => read.has(w.name)).map((w) => ({ sc, w }))) : []);
  const everyState = [parsed.states.get(-3), parsed.states.get(-2), minus1, ...sources].filter(Boolean);
  // a COUNTER (a VarAdd anywhere: Balrog's charge in var(48)) is never simulated: unknown wherever a route reads it
  const counters = new Set();
  for (const st of everyState) for (const sc of st.sctrls) for (const w of varWrites(sc)) if (w.add && read.has(w.name)) counters.add(w.name);
  const keep = (x) => !counters.has(x.w.name);
  const pre = [...writesIn(parsed.states.get(-3)), ...writesIn(parsed.states.get(-2))].filter(keep);
  const m1writes = new Map();
  minus1.sctrls.forEach((sc, idx) => { const w = varWrites(sc).filter((x) => read.has(x.name) && !counters.has(x.name)); if (w.length) m1writes.set(idx, w); });
  const tracked = new Set([...pre.map((p) => p.w.name), ...[...m1writes.values()].flat().map((w) => w.name)]);
  for (const s of sources) for (const x of writesIn(s).filter(keep)) tracked.add(x.w.name);
  const usesTime = [...routes.flatMap((r) => r.groups.flatMap((g) => [...g.all, ...g.g])), ...pre.flatMap((p) => [...p.sc.trig.all, ...p.sc.trig.groups.flat()])].some((l) => /(^|[^a-z_.])time\b/i.test(l));
  const times = usesTime ? CANCEL_TIMES : [CANCEL_TIMES[1]];

  // the state's facts: statetype, movetype, its HitDefs' attr, the helper ids it spawns
  const facts = (s) => {
    if (!s) return { no: -99999, type: 's', move: 'i', attrs: [], helpers: [], state: null };
    const t = String(s.header.get('type') || 's').trim().toLowerCase()[0] || 's';
    const attrs = s.sctrls.filter((c) => c.type === 'hitdef').map((c) => parseAttr(c.params.get('attr'))).filter(Boolean);
    const helpers = s.sctrls.filter((c) => c.type === 'helper').map((c) => c.params.get('id')).filter((v) => v !== undefined);
    return { no: s.no, type: t, move: s.movetype || 'i', attrs, helpers, state: s };
  };
  // ONE context per (state, contact, time): contact null = none, 'hit', 'block'
  const ctxOf = (F, contact, time) => {
    const ctx = { stateno: F.no, memo: new Map(), readTime: false };
    // `time` marks the tick when a line really reads it (an `&&` that is already false never does)
    Object.defineProperty(ctx, 'time', { enumerable: true, get() { ctx.readTime = true; return time; } });
    ctx.unk = (n, evx) => {
      const id = n.id;
      if (n.args) {
        if (id === 'numhelper' && n.args.length === 1) {
          const want = evx(n.args[0]);
          if (want === null) return null;
          return F.helpers.some((h) => { const v = X.evalExpr(h, { stateno: F.no }); return v === null || v === want; }) ? null : 0;
        }
        if (/^proj(contact|hit|guarded)time$/.test(id)) return contact ? null : -1;
        return undefined;
      }
      if (id === 'ctrl') return 0;
      if (id === 'movecontact') return contact ? 1 : 0;
      if (id === 'movehit') return contact === 'hit' ? 1 : 0;
      if (id === 'moveguarded') return contact === 'block' ? 1 : 0;
      if (id === 'movereversed') return 0;
      if (/^proj(contact|hit|guarded)\d*$/.test(id)) return contact ? null : 0;
      if (id === 'numtarget') return contact ? null : 0;
      if (id === 'roundstate') return 2;
      if (id === 'ailevel') return 0;
      return undefined;
    };
    ctx.cmpHook = (n) => {
      if (!(n.o === '=' || n.o === '!=') || !n.a || n.a.t !== 'unk' || n.a.args) return undefined;
      const k = n.a.id;
      if (k === 'statetype' || k === 'movetype') {
        if (!n.b || n.b.t !== 'unk' || n.b.args || !/^[scalaih]$/.test(n.b.id)) return undefined;
        const mine = k === 'statetype' ? F.type : F.move;
        if (mine === 'u') return null;
        return (mine === n.b.id) === (n.o === '=');
      }
      if (k === 'hitdefattr') {
        const words = chainWords(n.b);
        if (!words.length) return undefined;
        const want = { st: new Set(words[0].replace(/[^sca]/g, '')), at: attrSet(words.slice(1)) };
        let r;
        if (F.move !== 'a' || !F.attrs.length) r = false;
        else {
          const hits = F.attrs.map((a) => [...a.st].some((x) => want.st.has(x)) && [...a.at].some((x) => want.at.has(x)));
          r = hits.every(Boolean) ? true : hits.some(Boolean) ? null : false;
        }
        return r === null ? null : (r === (n.o === '='));
      }
      return undefined;
    };
    return ctx;
  };
  // each line once: a short id for the memo keys and the variables it reads
  const LINES = new Map();
  const recOf = (l) => { let r = LINES.get(l); if (!r) { r = { id: LINES.size + ':', vars: X.varsOf(l).filter((x) => /^var\(/.test(x)) }; LINES.set(l, r); } return r; };
  const varsIn = (l) => recOf(l).vars;
  // a line under a world. mode: 'set' (a VarSet's own triggers: anything not simulated is 0),
  // 'all' (a route's triggerall: not simulated = unknown: a charge counter, meter), 'grp' (a route's group: 0: a mode, a combo timer)
  const line = (l, ctx, world, mode) => {
    const rec = recOf(l);
    let key = rec.id + mode;
    for (const v of rec.vars) {
      // a tracked value: written this tick (a number), lost (null: unknown), or CARRIED from before (undefined:
      // unknown in a triggerall - a mode such as Makoto's `var(51) = 3` - and 0 in the other lines)
      if (tracked.has(v)) { const x = world.v[v]; if (typeof x === 'number') ctx[v] = x; else if (x === null || mode === 'all') delete ctx[v]; else ctx[v] = 0; }
      else if (mode === 'all') delete ctx[v];
      else ctx[v] = 0;
      key += '\u0001' + (Object.prototype.hasOwnProperty.call(ctx, v) ? ctx[v] : 'u');
    }
    // the same line under the same values in this context answers the same (worlds and routes repeat them)
    const hit = ctx.memo.get(key);
    if (hit) { if (hit.t) ctx.readTime = true; return hit.b; }
    const before = ctx.readTime;
    ctx.readTime = false;
    const r = X.evalExpr(l, ctx);
    const b = r === null ? null : !!r;
    ctx.memo.set(key, { b, t: ctx.readTime });
    ctx.readTime = before || ctx.readTime;
    return b;
  };
  const andLines = (lines, ctx, world, mode) => { let r = true; for (const l of lines) { const b = line(l, ctx, world, mode); if (b === false) return false; if (b === null) r = null; } return r; };
  const groupOpen = (g, ctx, world) => {
    const all = andLines(g.all, ctx, world, 'all');
    if (all === false) return false;
    const grp = andLines(g.g, ctx, world, 'grp');
    return grp === false ? false : (all === null || grp === null ? null : true);
  };
  // a VarSet step over the worlds
  // does a list of lines read a simulated variable? (else every world answers alike)
  const DEP = new Map();
  const readsTracked = (key, lines) => { let d = DEP.get(key); if (d === undefined) { d = lines.some((l) => varsIn(l).some((v) => tracked.has(v))); DEP.set(key, d); } return d; };
  const fireOf = (sc, ctx, w) => {
    const all = andLines(sc.trig.all, ctx, w, 'set');
    let fire = false;
    if (all !== false) for (const g of sc.trig.groups) { const b = andLines(g, ctx, w, 'set'); if (b === true) { fire = true; break; } if (b === null) fire = null; }
    if (fire === true && all === null) fire = null;
    return fire;
  };
  const step = (worlds, sc, writes, ctx) => {
    const out = [];
    const same = !readsTracked(sc, [...sc.trig.all, ...sc.trig.groups.flat()]);
    const once = same ? fireOf(sc, ctx, worlds[0]) : undefined;
    if (once === false) return worlds;
    for (const w of worlds) {
      const fire = same ? once : fireOf(sc, ctx, w);
      if (fire === false) { out.push(w); continue; }
      const set = { v: Object.assign({}, w.v), own: w.own };
      for (const x of writes) {
        for (const v of varsIn(x.value)) { const y = w.v[v]; if (tracked.has(v) && typeof y === 'number') ctx[v] = y; else if (tracked.has(v) && y === null) delete ctx[v]; else ctx[v] = 0; }
        const val = X.evalExpr(x.value, ctx);
        const n = typeof val === 'boolean' ? +val : val;
        set.v[x.name] = typeof n === 'number' && Number.isFinite(n) ? Math.trunc(n) : null;
      }
      out.push(set);
      if (fire === null) out.push(w);
    }
    if (out.length <= 1) return out;
    const seen = new Set(), uniq = [];
    for (const w of out) { const k = JSON.stringify(w.v) + w.own; if (!seen.has(k)) { seen.add(k); uniq.push(w); } }
    return uniq.slice(0, 32);
  };
  const ri = new Map(routes.map((r) => [r.idx, r]));
  const m1steps = minus1.sctrls.map((sc, idx) => (m1writes.has(idx) || ri.has(idx) ? idx : -1)).filter((i) => i >= 0);
  // one tick: -3, -2 setters, then the -1 in order; at(route, worlds, ctx) at each route
  const tick = (F, contact, time, own, at) => {
    const ctx = ctxOf(F, contact, time);
    const base = { v: {}, own: false };   // nothing written yet this tick: every tracked value carried
    let worlds = [base];
    // a variable S's own code sets (read on the next tick): an approximate world of its own
    if (own && F.state) for (const { sc, w } of writesIn(F.state)) {
      if (!tracked.has(w.name) || w.add) continue;
      const all = andLines(sc.trig.all, ctx, base, 'set');
      const any = sc.trig.groups.some((g) => andLines(g, ctx, base, 'set') !== false);
      const val = X.evalExpr(w.value, ctx);
      if (all !== false && any && typeof val === 'number' && val !== 0) worlds.push({ v: Object.assign({}, base.v, { [w.name]: Math.trunc(val) }), own: true });
    }
    for (const p of pre) worlds = step(worlds, p.sc, [p.w], ctx);
    for (const idx of m1steps) {
      if (m1writes.has(idx)) worlds = step(worlds, minus1.sctrls[idx], m1writes.get(idx), ctx);
      if (ri.has(idx)) at(ri.get(idx), worlds, ctx);
    }
    return ctx.readTime;
  };
  // a group open in a neutral state with no contact is not a cancel
  const neutral = new Set();
  const F0 = facts(null);
  for (const t of times) if (!tick(F0, null, t, false, (r, worlds, ctx) => r.groups.forEach((g, gi) => { if (!neutral.has(r.idx + ':' + gi) && worlds.some((w) => groupOpen(g, ctx, w) !== false)) neutral.add(r.idx + ':' + gi); }))) break;
  const out = [];
  for (const s of sources) {
    const F = facts(s);
    const found = new Map();
    for (const contact of ['hit', 'block']) {
      for (const t of times) {
        // (no line of this tick read `time`: the other samples answer the same)
        const readTime = tick(F, contact, t, true, (r, worlds, ctx) => r.groups.forEach((g, gi) => {
          if (neutral.has(r.idx + ':' + gi)) return;
          const open = readsTracked(g, [...g.all, ...g.g]) ? worlds.filter((w) => groupOpen(g, ctx, w) !== false) : (groupOpen(g, ctx, worlds[0]) !== false ? worlds : []);
          if (!open.length) return;
          // the deciding world: an exact one when there is one
          const decide = open.find((w) => !w.own) || open[0];
          const via = [...new Set([...g.all, ...g.g].flatMap(varsIn))].filter((v) => tracked.has(v) && decide.v[v]);
          for (const T of r.to) {
            const kind = T >= 3000 ? 'SU' : T >= 1000 ? 'SP' : (s.no < 1000 ? 'CH' : null);
            if (!kind || (T === s.no && kind !== 'CH')) continue;
            const k = String(T);
            const rec = found.get(k) || { state: T, kind, hit: false, block: false, exact: false, via: [], file: r.sc.file, line: r.sc.line };
            rec[contact] = true;
            if (!decide.own && !rec.exact) { rec.exact = true; rec.via = []; }
            if (!decide.own || !rec.exact) for (const v of via) if (!rec.via.includes(v)) rec.via.push(v);
            found.set(k, rec);
          }
        }));
        if (!readTime) break;
      }
    }
    if (found.size) out.push({ state: s.no, to: [...found.values()].sort((a, b) => a.state - b.state) });
  }
  return out.sort((a, b) => a.state - b.state);
}

// ---- the rows ---------------------------------------------------------------------------
// cmdlist-core.js readChar over the folder on the disk, with the cancels when asked.
// Read once per change: a build reads every character, and the Moves page
// asks again on every save. Keyed by the folder, the def and the owner's
// choices; stamped by the size and time of the def and every file it compiles.
const READ_CACHE = new Map();
function readFor(charDir, defName, opts) {
  const o = opts || {};
  const key = charDir + '|' + defName + '|' + JSON.stringify([o.names || null, o.hidden || null, !!o.cancels]);
  let stamp;
  try {
    const st = (p) => { const s = fs.statSync(p); return s.size + ':' + s.mtimeMs; };
    const io = diskIo(charDir);
    const files = core.stateFilesFor(io, defName).filter((f) => f.abs);
    stamp = [st(path.join(charDir, defName)), ...files.map((f) => f.abs + '=' + st(path.join(charDir, f.abs))), ...core.readmeFiles(io, defName).map((f) => f + '=' + st(path.join(charDir, f)))].join('|');
  } catch (e) { stamp = null; }
  const hit = stamp && READ_CACHE.get(key);
  if (hit && hit.stamp === stamp) return hit.value;
  const value = core.readChar(diskIo(charDir), defName, Object.assign({}, o, { drawable, cancelsOf }));
  if (stamp && value) {
    if (READ_CACHE.size > 400) READ_CACHE.delete(READ_CACHE.keys().next().value);
    READ_CACHE.set(key, { stamp, value });
  }
  return value;
}

// The character's own movelist, her readme's move lines (cmdlist-core.js),
// read from the disk.
const ownMovelist = (charDir, defName, defText) => core.ownMovelist(diskIo(charDir), defName, defText);
const readmeEntries = (charDir, defName, defText) => core.readmeEntries(diskIo(charDir), defName, defText);
const mergeStrengths = (rows, ownerNames, hidden) => core.mergeStrengths(rows, ownerNames, hidden, drawable);

// ---- the export -------------------------------------------------------------------------
// cmdlist-core.js shipChar over the folder on the disk, through the read
// cache; the file as bytes. `charDir` is read only.
// opts: { defText (the def as the earlier repairs left it), exists(rel) (is a
// file of that name already in the copy, any case), choices (commandList) }
// -> null (switched off, own list, nothing to list) | { def: { rel, text }, file: { rel, buf }, rows }
function shipFor(charDir, defName, opts) {
  const o = opts || {};
  const r = core.shipChar(diskIo(charDir), defName, { defText: o.defText, exists: o.exists, choices: o.choices,
    read: (names, hidden) => readFor(charDir, defName, { names, hidden }) });
  return r && { def: r.def, file: { rel: r.file.rel, buf: Buffer.from(r.file.text, 'utf8') }, rows: r.rows, names: r.names };
}

const { textOf, convertCommand, combineCommands, isCommandMove, readCommands, commandsOfLine, descriptive, decodeText, cleanName, cleanChoices, applyRows,
  entryFor, filesSection, strengthBase, readmeInput, readmeFits, chargeStart, commandsOfGroup, stanceOf, withStance, uniqueAttack, FILE_NAME } = core;
module.exports = { readFor, textOf, shipFor, ownMovelist, convertCommand, combineCommands, isCommandMove, readCommands, commandsOfLine, descriptive, decodeText, cleanName, cleanChoices, applyRows, entryFor, filesSection, strengthBase, mergeStrengths, readmeInput, readmeEntries, readmeFits, chargeStart, commandsOfGroup, stanceOf, withStance, targets, uniqueAttack, FILE_NAME };
