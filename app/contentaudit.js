'use strict';
//
// THE CONTENT AUDIT: what in a character's own files the engine cannot find.
//
// One def, read-only, static. Every entry names the file, the PARAMETER's
// line (the line an author edits, not the [State] header), the [State] block,
// the statedef it sits in and one plain sentence of what the engine does with
// it. Entries are tiered, never verdicts: a number no loaded file defines is
// a real break only when the state that asks for it runs, runs in THIS
// character's table, and its trigger can fire. Everything that fails one of
// those is kept - counted, and listed with allTiers - so a missed root never
// silently hides a break.
//
//   contentAuditIn(charDir, defName, { dups, desktop, allTiers }) -> object | null
//
//   { def, role, load, structure, states: [Entry], anims: [Entry],
//     vanishing: { sff, air, actions: [{action, frames, missing, missingKeys, played: [site], tier, label?}],
//                  keys: [{key, actions, played, frames, tier, label?}] },
//     duplicates: { decoded, keys, different, same, undecidable } | null   (null only with no .sff;
//                  with dups off it is still there, decoded: false, verdicts from headers),
//     colorless: { groups: [{group, sprites, share, shades, heads}], heads, decoded, costume } | null
//                  (SFF v1 only, and only with dups on: art every palette draws black, report only),
//     size, summary: { headline, worthALook, distinct: {states, freezes, freezesOpponent, neverHits,
//                      vanishingKeys, vanishingGroups}, freezes, freezesOpponent, neverHits
//                      (controller counts), byTier, hidden, ... } }
//   headline   = load.missing + fatal structure + distinct `freezes` states.
//   worthALook = distinct `freezes-opponent` states + distinct `never-hits` animations
//                + distinct played missing sprite GROUPS.
//
// WHY THE HEADLINE IS NARROW. Two rounds of skeptics tried to refute a
// sample of what the audit flagged, over 609 real characters, working from
// the files and the engine source. After round 2 the owner-run FREEZES tier
// held (6 of 7 confirmed); FREEZES-OPPONENT (3 of 5 refuted), NEVER-HITS
// (3 of 4) and played vanishing keys (2 of 3) did not - they miss
// name-gated code, triggers that read the opponent, the pose a failed
// animation change keeps (with its boxes), and relay p2statenos. Those tiers
// are still listed, file:line, as worth a look; they are not counted as
// breaks. The measured misses are in DEVLOG 2026-09-14.
//
// The rules those misses called for are in (name gates in the walk,
// SelfAnimExist / IsHelper for the runner, the kept pose's boxes, reads of
// the opponent, relays and code after an exit, per-id helper values, listed
// computed values, helper and intro play sites); the headline and worth-a-look
// formulas are unchanged until a new sample says whether a tier has earned
// its place. Additions to the shape: hidden tier `relay`; vanishing site and
// key tiers `helper` and `intro`; action tier `placeholder` (with `was`);
// `breakTargets` on unloaded-state-file.
//
// WHICH TABLE A NUMBER IS LOOKED UP IN decides whether a check is legal at
// all (engine research, 96413d2):
//   ChangeState value     the state OWNER's table (char.go:6785-6787), even
//                         when an opponent is puppeted in the state
//   SelfState, Helper,    the RUNNING character's own table (char.go:6789-6797,
//   HitOverride stateno   6966; bytecode.go:10395) - the victim's, inside a
//                         scene she is put in
//   TargetState value,    the issuer's table (char.go:8545, 11106-11110);
//   p2stateno             p2getp1state = 0 hands it to the getter's own table
//   p1stateno             the attacker's state owner (char.go:11787)
//   Statedef anim,        the RUNNER's .air (bytecode.go:4928-4934, 5498-5510)
//   ChangeAnim value
//   ChangeAnim2 value     the state OWNER's .air (bytecode.go:5548)
// A missing state installs an empty state that changes nothing - no anim, no
// ctrl, no physics - so the character stays in her last pose until something
// hits her (char.go:6667-6674). A missing animation keeps the previous one,
// boxes included (char.go:4661-4667).
const fs = require('fs');
const path = require('path');
// modlib before vfslib: vfslib reaches back into modlib, and a module
// loaded first from here must find modlib complete.
const modlib = require('./modlib.js');
const vfslib = require('./vfslib.js');
const S = require('./scenelib.js');
const X = require('./cnsexpr.js');
const A = require('./sffaudit.js');
const E = require('./enginedata.js');

const MAX_TEXT = 8e6;
const HARD = 2, SOFT = 1;
const HIDDEN_TIERS = new Set(['dead', 'foreign-name', 'relay', 'shadowed', 'computed', 'redirected', 'victim-side',
  'guarded', 'sentinel', 'fightfx', 'replaced-first-tick', 'unplayed']);
// Listed first after the headline, not counted as breaks (see the header).
const WORTH_A_LOOK_TIERS = new Set(['freezes-opponent', 'never-hits']);
const CTRL_NAMES = {
  changestate: 'ChangeState', selfstate: 'SelfState', targetstate: 'TargetState', hitdef: 'HitDef',
  reversaldef: 'ReversalDef', projectile: 'Projectile', helper: 'Helper', hitoverride: 'HitOverride',
  changeanim: 'ChangeAnim', changeanim2: 'ChangeAnim2', explod: 'Explod', tagin: 'TagIn', tagout: 'TagOut',
};
const ctrlName = (t) => CTRL_NAMES[t] || t;
const rel = (base, abs) => path.relative(base, abs).replace(/\\/g, '/');
// Text shown to a person: the files are read as latin1 bytes, and a
// Japanese label or comment is Shift-JIS (or UTF-8) in those bytes. Decoded
// for display only - every comparison runs on the raw bytes.
function display(s) {
  return S.decodeText(s);
}

// ---- the def ------------------------------------------------------------------
// Sections the way the ini reader splits them (common.go:793-812, 984-1025):
// the FIRST section of a name counts (compiler.go:8146-8161) and a key's first
// value wins. Values stay latin1 bytes: trigger strings in the state files are
// latin1 bytes too, so a Name = "..." guard compares byte for byte.
function defSection(text, want) {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i].split(';')[0].trim();
    const m = /^\[\s*([^\]]*?)\s*\]$/.exec(ln);
    if (!m || m[1].toLowerCase() !== want) continue;
    const out = new Map();
    for (i++; i < lines.length; i++) {
      const raw = lines[i].trim();
      if (raw[0] === '[') break;
      const l = raw.split(';')[0].trim();
      const ia = l.search(/[= \t]/);
      if (ia <= 0) continue;
      const key = l.slice(0, ia).toLowerCase();
      const eq = l.indexOf('=');
      const val = eq >= 0 ? l.slice(eq + 1).trim().replace(/^"|"$/g, '') : '';
      if (!out.has(key)) out.set(key, val);
    }
    return out;
  }
  return new Map();
}

// Where a [Files] name is looked for: the def's own directory, the game root
// (a `chars/<folder>/x` path lands back in the folder; `../../data/<pack>/x`
// lands in this bundle's screenpack, modlib.themeFileFor), then the engine's
// root, the motif's folder and data/ (stateCompile dirs, compiler.go
// 8346-8366: an imported fullgame's `stcommon = common1.cns` is the
// screenpack's). The .zss retry is scenelib.stateFiles' own.
function makeResolve(charDir, defName, engineDir) {
  const defDir = path.posix.dirname(defName.replace(/\\/g, '/'));
  const inDef = (r) => (defDir === '.' ? r : defDir + '/' + r).replace(/^\.\//, '');
  const mdir = modlib.motifDir();
  return (r) => {
    const v = String(r || '').replace(/\\/g, '/').trim();
    if (!v) return null;
    const m = /^chars\/[^/]+\/(.+)$/i.exec(v);
    return modlib.resolveCI(charDir, inDef(v)) || modlib.resolveCI(charDir, v)
      || (m && modlib.resolveCI(charDir, m[1]))
      || modlib.themeFileFor(defName, v)
      || (engineDir && modlib.resolveCI(engineDir, v))
      || (mdir && modlib.resolveCI(mdir, v))
      || (engineDir && modlib.resolveCI(path.join(engineDir, 'data'), v))
      || null;
  };
}

// What the engine's data/ supplies, as the build index would name it - so
// scanMissingDepsIn does not have to build the whole pack to learn that
// `stcommon = common1.cns` is data/common1.cns.zss.
const HAVE_CACHE = new Map();
function engineHave(engineDir) {
  if (HAVE_CACHE.has(engineDir)) return HAVE_CACHE.get(engineDir);
  const have = new Set();
  const walk = (d, pre) => {
    let list;
    try { list = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
    for (const e of list) {
      if (e.isDirectory()) walk(path.join(d, e.name), pre + e.name + '/');
      else have.add((pre + e.name).toLowerCase());
    }
  };
  walk(path.join(engineDir, 'data'), 'data/');
  HAVE_CACHE.set(engineDir, have);
  return have;
}

// The engine's common.air, once per engine folder: its tables' boxes, and
// the actions that are only `Copy Action N` of the character's own
// (common.air:6-11: 100 copies her walk 20, 105 her jump 43).
const COMMON_AIR_CACHE = new Map();
function commonAirTable(engineDir) {
  if (COMMON_AIR_CACHE.has(engineDir)) return COMMON_AIR_CACHE.get(engineDir);
  let out = null;
  try {
    const text = E.commonConfig().air.map((rel) => fs.readFileSync(path.join(engineDir, rel), 'latin1')).join('\n');
    const copies = new Map();
    for (const m of text.matchAll(/^\s*\[\s*begin\s+action\s+(-?\d+)\s*\]\s*[\r\n]+\s*copy\s+action\s+(-?\d+)/gim)) copies.set(+m[1], +m[2]);
    out = { table: A.airTable(text), copies };
  } catch (e) { out = null; }
  COMMON_AIR_CACHE.set(engineDir, out);
  return out;
}

// ---- trigger atoms --------------------------------------------------------------
// A GATE is an atom every way into the controller passes through: a triggerall
// line, or one line of EVERY numbered group. A line holding `||` gates nothing
// (the other side can fire). Atoms are compared with whitespace removed and
// wrapping parentheses peeled, so `(!Alive)` and `alive = 0` read alike.
function peel(s) {
  let t = s;
  for (;;) {
    if (t[0] !== '(' || t[t.length - 1] !== ')') return t;
    let depth = 0, ok = true;
    for (let i = 0; i < t.length; i++) {
      if (t[i] === '(') depth++;
      else if (t[i] === ')') { depth--; if (depth === 0 && i < t.length - 1) { ok = false; break; } }
    }
    if (!ok) return t;
    t = t.slice(1, -1);
  }
}
// A line wrapped whole in parentheses, `(stateno = 900 && AnimElemTime(3) >= 0)`
// (Mature_XIII mature.cmd:1427), is peeled before it is split.
const atomsOfLine = (line) => (/\|\|/.test(line) ? [] : peel(String(line).replace(/\s+/g, '').toLowerCase()).split('&&').map(peel));
function gatedOn(sc, pred) {
  for (const l of sc.trig.all) if (atomsOfLine(l).some(pred)) return true;
  const g = sc.trig.groups;
  return g.length > 0 && g.every((lines) => lines.some((l) => atomsOfLine(l).some(pred)));
}
const linesOf = (sc) => [...sc.trig.all, ...sc.trig.groups.flat()];
function triggerText(sc) {
  // The first group that is not literally false, with the triggerall lines.
  const g = sc.trig.groups.find((lines) => X.evalTriggerSet({ all: [], groups: [lines] }, {}) !== false) || sc.trig.groups[0] || [];
  const t = [...sc.trig.all, ...g].map((x) => x.replace(/\s+/g, ' ').trim()).join(' && ');
  return t.length > 120 ? t.slice(0, 117) + '...' : t;
}

// A Set that holds every number but one: evaluating a trigger with
// SelfAnimExist answering "yes" for everything except N tells whether the
// controller can fire when N is absent - the graceful-fallback idiom.
class AllBut extends Set {
  constructor(n) { super(); this.n = n; }
  has(k) { return k !== this.n; }
}

// The values an expression can take when it is nothing but ifelse / cond over
// literals, or null when anything else is in it.
function exactLeaves(raw) {
  let node = null;
  try { const t = X.tokenize(String(raw).replace(/;.*$/, '').trim()); node = t && t.length ? X.parse(t) : null; } catch (e) { node = null; }
  const walk = (n) => {
    if (n.t === 'num') return [n.v];
    if (n.t === 'neg' && n.a.t === 'num') return [-n.a.v];
    if (n.t !== 'ifelse') return null;
    const a = walk(n.a), b = walk(n.b);
    return a && b ? [...a, ...b] : null;
  };
  return node ? walk(node) : null;
}

// Which parameters of which controllers name a state, in whose table the
// comment at the top of the file says.
const STATE_PARAMS = {
  changestate: ['value'], selfstate: ['value'], targetstate: ['value'], helper: ['stateno'], hitoverride: ['stateno'],
  hitdef: ['p1stateno', 'p2stateno'], reversaldef: ['p1stateno', 'p2stateno'], projectile: ['p1stateno', 'p2stateno'],
};
// An animation reference: `200`, `S200` (her own), `F200` / `GO200` / ...
// (another table). n is null when it is not a plain number.
const parseAnim = (raw) => {
  const m = /^([a-z]*)\s*(-?\d+)$/i.exec(String(raw).trim());
  if (!m) return { n: null, prefix: '' };
  return { n: parseInt(m[2], 10), prefix: m[1].toLowerCase() };
};

// ---- variable domains ------------------------------------------------------------
// scenelib.domainsOf lists every literal a variable is assigned. A variable is
// OPAQUE when something writes it that is not a literal the file shows: VarAdd
// and VarRandom (a counter reaches every count), a computed value or index, a
// redirected write, a non-literal `:=`. A trigger false under every literal
// assignment of a transparent variable never fires; one resting on an opaque
// variable only looks that way (critic 5) and is shown as latent.
function varFacts(states) {
  const opaque = new Set(), opaqueFam = new Set(), extra = {}, aiVars = new Set();
  const addExtra = (name, v) => { (extra[name] = extra[name] || new Set()).add(v); };
  // The AI switch: AILevel, or the impossible-command idiom - `command =
  // "CPU1"` (Asuka.cmd:833-876) or `Command = "AI1"` ... "AI25" (shimo
  // Shimo.cmd:1057-1091) - that only the engine's AI input can press.
  const aiGate = (sc) => linesOf(sc).some((l) => /\bailevel\b/i.test(l) && !/!\s*ailevel|ailevel\s*=\s*0/i.test(l)) || linesOf(sc).some((l) => /command\s*=\s*"(cpu|ai)\d*"/i.test(l));
  for (const s of states.values()) for (const sc of s.sctrls) {
    const t = sc.type;
    const isSet = t === 'varset' || t === 'parentvarset';
    const isAdd = /^(parent)?var(add|random)$/.test(t);
    const redir = sc.params.has('redirectid');
    const write = (fam, idxRaw, valRaw) => {
      const n = S.lit(idxRaw);
      if (n === null) { opaqueFam.add(fam); return; }
      const name = fam + '(' + n + ')';
      // `ParentVarSet v = 52, value = var(52)` (a helper handing its copy up)
      // or `VarSet v = 52, value = var(52)` writes a value var(52) already
      // holds somewhere: the domains pool every state's literals, so the copy
      // adds nothing and must not make the variable opaque (Akiha Config.st:234).
      if (!isAdd && !redir && String(valRaw === undefined ? '' : valRaw).replace(/\s+/g, '').toLowerCase() === name) return;
      const v = S.lit(valRaw);
      if (isAdd || redir || v === null) { opaque.add(name); return; }
      if (t === 'parentvarset') addExtra(name, v);
      if (v !== 0 && aiGate(sc)) aiVars.add(name);
    };
    if (isSet || isAdd) {
      for (const [fam, key] of [['var', 'v'], ['fvar', 'fv'], ['sysvar', 'sysvar'], ['sysfvar', 'sysfvar']]) {
        if (sc.params.has(key)) write(fam, sc.params.get(key), sc.params.get('value'));
      }
      for (const [k, val] of sc.params) {
        const m = /^(var|fvar|sysvar|sysfvar)\((.+)\)$/.exec(k);
        if (m) write(m[1], m[2], val);
      }
    }
    if (t === 'varrangeset') {
      const first = sc.params.has('first') ? S.lit(sc.params.get('first')) : 0;
      const last = sc.params.has('last') ? S.lit(sc.params.get('last')) : 59;
      for (const [fam, key] of [['var', 'value'], ['fvar', 'fvalue']]) {
        if (!sc.params.has(key)) continue;
        const v = S.lit(sc.params.get(key));
        if (first === null || last === null || v === null || redir) { opaqueFam.add(fam); continue; }
        for (let i = first; i <= last && i < 256; i++) addExtra(fam + '(' + i + ')', v);
      }
    }
    // `var(3) := expr` anywhere - a literal is already in domainsOf.
    for (const e of [...linesOf(sc), ...sc.params.values()]) {
      for (const m of String(e).matchAll(/\b(var|fvar|sysvar|sysfvar)\s*\(\s*([^)]*)\)\s*:=\s*([^&|,)]+)/gi)) {
        const n = S.lit(m[2]);
        if (n === null) { opaqueFam.add(m[1].toLowerCase()); continue; }
        if (S.lit(m[3]) === null) opaque.add(m[1].toLowerCase() + '(' + n + ')');
      }
    }
  }
  return { opaque, opaqueFam, extra, aiVars };
}

// ---- the audit ------------------------------------------------------------------
function contentAuditIn(charDir, defName, opts) {
  const o = Object.assign({ dups: true, desktop: false, allTiers: false }, opts || {});
  let defText;
  // LoadText drops a UTF-8 BOM before the def is read (common.go:446-448,
  // compiler.go:8133, char.go:3769): with it left on, an [Info] or [Files]
  // header on line 1 is not a section and ikemenversion or every file is lost.
  try { defText = S.stripBom(fs.readFileSync(path.join(charDir, defName), 'latin1')); } catch (e) { return null; }
  const info = defSection(defText, 'info');
  const filesSec = defSection(defText, 'files');
  const engineDir = E.engineDir();
  const resolve = makeResolve(charDir, defName, engineDir);
  const normAbs = (p) => path.resolve(p).replace(/\\/g, '/').toLowerCase();
  const engineRoot = normAbs(engineDir) + '/';
  const isEngine = (abs) => !!abs && normAbs(abs).startsWith(engineRoot);
  const showPath = (abs) => (isEngine(abs) ? 'engine:' + rel(engineDir, abs) : rel(charDir, abs));
  // ikemenversion in [Info]: a version other than 0 turns negoverride off
  // (compiler.go:8347), so later negative statedefs accumulate.
  const ikv = info.get('ikemenversion');
  const ikemenVersion = !!ikv && /[1-9]/.test(ikv);

  // -- load ------------------------------------------------------------------
  const sf = S.stateFiles(charDir, defName, resolve);
  // scanMissingDepsIn reads every `key = value` line of the def; the engine
  // reads only the first [Files] section and a key's first value
  // (compiler.go:8146-8161), so a stale second section is not a load failure.
  const normVal = (v) => String(v).replace(/"/g, '').replace(/\\/g, '/').trim();
  const missing = modlib.scanMissingDepsIn(charDir, defName, engineHave(engineDir))
    .filter((m) => filesSec.has(m.key.toLowerCase()) && normVal(filesSec.get(m.key.toLowerCase())) === m.rel);
  const load = { missing, stateFiles: [], notScanned: [], ikemenVersion };
  const toParse = [];
  let stcommonEngine = null;
  for (const f of sf) {
    const zss = /\.zss$/i.test(f.abs || f.rel);
    load.stateFiles.push({ key: f.key, rel: f.rel, resolved: f.abs ? showPath(f.abs) : null, engine: isEngine(f.abs), zss });
    if (!f.abs) continue;
    // The engine's own common1.cns.zss arrives through stcommon; its numbers
    // come from enginedata. A character-local common1 is parsed like any
    // other file and SHADOWS the engine copy (compiler.go:8362).
    if (f.key === 'stcommon' && isEngine(f.abs) && /common1\.cns\.zss$/i.test(f.abs)) { stcommonEngine = E.stcommonStates(); continue; }
    toParse.push(f);
  }
  const consts = E.consts();
  const parsed = S.parseStates(toParse, { consts, ikemenVersion });
  const states = parsed.states;
  for (const f of toParse) {
    if (/\.zss$/i.test(f.abs) && !isEngine(f.abs)) load.notScanned.push(f.rel);
    else if (!parsed.read.includes(f.rel)) load.notScanned.push(f.rel);
  }
  const loadedAbs = new Set(sf.filter((f) => f.abs).map((f) => normAbs(f.abs)));

  const commonStates = E.commonStates({ desktop: o.desktop });
  const defined = (n) => states.has(n) || (!!stcommonEngine && stcommonEngine.has(n)) || commonStates.has(n);
  let hs;
  try { hs = modlib.hScan(charDir, defName); } catch (e) { hs = { giver: false, receiver: false }; }
  const receiver = !!hs.receiver;

  // -- the .air and the .sff ---------------------------------------------------
  const animAbs = filesSec.get('anim') ? resolve(filesSec.get('anim')) : null;
  const sprAbs = filesSec.get('sprite') ? resolve(filesSec.get('sprite')) : null;
  const sndAbs = filesSec.get('sound') ? resolve(filesSec.get('sound')) : null;
  const commonAir = E.commonAirActions();
  const airText = animAbs ? (() => { try { return fs.readFileSync(animAbs, 'latin1'); } catch (e) { return null; } })() : null;
  const air = airText !== null ? A.airTable(airText, { common: commonAir }) : null;
  const actionExists = (n) => (!!air && air.actions.has(n)) || commonAir.has(n);
  const animSet = new Set([...(air ? air.actions.keys() : []), ...commonAir]);

  // -- facts the walk and the tiers read ---------------------------------------------
  // Built BEFORE the walk: an edge whose controller can never fire is no way
  // into its target, and the same classification decides the entry tiers.
  const domains = S.domainsOf(states);
  const vf = varFacts(states);
  const isOpaque = (n) => vf.opaque.has(n) || vf.opaqueFam.has(n.split('(')[0]);
  const helperIds = new Set();
  // Helper ids no reading can list: each could be any number. A character
  // ZSS state file is not scanned: a `helper{` in one is open too.
  let openHelperIds = 0;
  for (const f of toParse) {
    if (!/\.zss$/i.test(f.abs) || isEngine(f.abs)) continue;
    try { if (/\bhelper\s*\{/i.test(fs.readFileSync(f.abs, 'latin1'))) openHelperIds++; } catch (e) { /* unreadable: nothing parsed from it either */ }
  }
  // The values a TRANSPARENT variable can hold (0 at round start plus every
  // literal the files assign), null for an opaque one: what X.valueSet needs
  // to list a computed id or state number exactly.
  const domOf = (n) => (isOpaque(n) ? null : [...new Set([0, ...(domains[n] || []), ...(vf.extra[n] || [])])]);
  const polled = new Set();
  // A helper can lend its parent Clsn1 boxes (Helper clsnproxy, char.go:10563
  // flattenClsnProxies) and OverrideClsn can add boxes to any frame
  // (bytecode.go:15438, char.go:10377-10412): with either anywhere in her
  // files, "no hit box" cannot be read from the .air alone.
  let boxesFromCode = false;
  // A helper of helpertype = player, or with keyctrl, runs her negative
  // states too (char.go:12066-12086: -3 needs isPlayerType or keyctrl[2], -2
  // isPlayerType or keyctrl[1], -1 keyctrl[0]).
  let helpersRunNegatives = false;
  for (const s of states.values()) for (const sc of s.sctrls) {
    if (sc.type === 'helper') {
      const id = sc.params.get('id');
      if (id === undefined) helperIds.add(0);
      else if (S.lit(id) !== null) helperIds.add(S.lit(id));
      else {
        // PER ID, not per character: one computed id used to switch the
        // ghost-helper rule off everywhere (Cammy-Delta_Red 9741). The id's
        // values are listed where they can be: ifelse leaves (`ifelse(time =
        // 8, 3, ifelse(time = 4, 2, 1))`, Helpers.st:2430), `200*!var(20)` ->
        // {0, 200}, `8600 + 0*(var(23) := 900)` -> 8600, `4241 + random % 3`
        // -> 4241-4243 (Konoha Arcana.cns:14618), and transparent variables
        // over their literal domains. Only an id that cannot be listed stays
        // open.
        const vals = X.valueSet(id, domOf);
        if (vals && vals.length <= 1024 && vals.every((v) => Number.isInteger(v))) for (const v of vals) helperIds.add(v);
        else openHelperIds++;
      }
      if (sc.params.has('clsnproxy') && S.lit(sc.params.get('clsnproxy')) !== 0) boxesFromCode = true;
      const ht = String(sc.params.get('helpertype') || '').trim().toLowerCase();
      const kc = sc.params.get('keyctrl');
      if (ht === 'player' || (kc !== undefined && S.lit(kc) !== 0)) helpersRunNegatives = true;
    }
    if (sc.type === 'overrideclsn') boxesFromCode = true;
    for (const l of [...linesOf(sc), ...sc.params.values()]) for (const m of String(l).matchAll(/numhelper\s*\(\s*(\d+)\s*\)/gi)) polled.add(+m[1]);
  }
  // Every number some state change in her files can send a player to: the
  // literal values, an ifelse's leaves, and the window around an arithmetic
  // value's base (the same reach the walk gives a computed value), plus what
  // the engine enters by itself. A player can sit in an UNDEFINED state that
  // is targeted (the empty state keeps its number, char.go:6667-6674), so
  // only a number that is neither defined nor targeted makes `stateno = N`
  // impossible.
  const hardRoots = new Set([
    ...E.hardcodedStates(), ...E.commonStateRoots({ desktop: o.desktop }), ...E.motifStates(),
    ...(stcommonEngine ? E.stcommonRoots() : []),
  ]);
  // A computed value whose every part can be listed - literals, transparent
  // variables over their domains, Random, conditions - reaches exactly the
  // values it produces: `1600 + Var(21)*10 + Var(22)*20` with var(21) and
  // var(22) only ever 0 or 1 is 1600, 1610, 1620 or 1630, never 1699 (Hyper
  // Minotaur Minotaur_H.cns:171). Only an expression no reading can list keeps
  // the window around its base.
  const SET_REACH = 512;
  const listedValues = (raw, ctx) => {
    const v = X.valueSet(raw, domOf, ctx);
    return v && v.length <= SET_REACH && v.every((x) => Number.isInteger(x)) ? v : null;
  };
  const litTargets = new Set(hardRoots), windows = [];
  for (const s of states.values()) for (const sc of s.sctrls) {
    for (const param of STATE_PARAMS[sc.type] || []) {
      const raw = sc.params.get(param);
      if (raw === undefined) continue;
      const n = S.lit(raw);
      if (n !== null) { litTargets.add(n); continue; }
      if (!X.parses(raw)) continue;
      const exact = exactLeaves(raw) || listedValues(raw);
      if (exact) { for (const t of exact) litTargets.add(t); continue; }
      const base = X.evalExpr(raw, Object.fromEntries(X.varsOf(raw).map((v) => [v, 0])));
      if (Number.isFinite(base)) windows.push([base - 40, base + 200]);
      else for (const t of X.leavesOf(raw)) litTargets.add(t);
    }
  }
  const targeted = (n) => litTargets.has(n) || windows.some(([a, b]) => n >= a && n <= b);
  const own = [info.get('name'), info.get('displayname'), info.get('author')].filter(Boolean).map((x) => x.toLowerCase().replace(/\s+/g, ''));
  // NAMES. `Name` / `P1Name` = "X" compares the running character's [Info]
  // name, `DisplayName` her displayname (the name when she has none) and
  // `AuthorName` the author, lowercased, never undefined (compiler.go:1365-
  // 1375, 3154-3175; bytecode.go:2718-2726; char.go:3837-3853). A helper
  // answers with its root's info (c.gi(), char.go:3664). So code shared by two
  // defs is dead for the def whose name it does not carry: sion_a.cmd:649
  // `triggerall = name = "Sion Eltnam Atlasia"` never runs for Eltnum_srt.def
  // ([Info] name "Eltnum"), and `name != "Eltnum"` is always false there.
  // Unknown rather than false (a wrong "dead" would hide a real break): a
  // text that matches only once spaces are squeezed out or only matches the
  // displayname, bytes past ASCII (Go lowercases UTF-8, this reads latin1),
  // and any def with a language [xx.Info] section, which can replace the name
  // (char.go:3815-3834).
  const infoName = String(info.get('name') || '').toLowerCase();
  const infoDisplay = String(info.get('displayname') || info.get('name') || '').toLowerCase();
  const infoAuthor = String(info.get('author') || '').toLowerCase();
  const localizedInfo = /^[ \t]*\[\s*[^\].\s]+\.info\s*\]/im.test(defText);
  const squash = (x) => x.replace(/\s+/g, '');
  const nameEq = (which, text) => {
    if (localizedInfo) return null;
    const mine = which === 'authorname' ? infoAuthor : which === 'displayname' ? infoDisplay : infoName;
    if (text === mine) return true;
    if (squash(text) === squash(mine) || (which === 'name' && squash(text) === squash(infoDisplay))) return null;
    if (/[^\x00-\x7f]/.test(text + mine)) return null;
    return false;
  };
  // `helper(N), x` for an id no Helper creates reads the engine's undefined
  // (bytecode.go:1953-1961); an id of 0 or less matches any helper
  // (char.go:4922-4925), so only a positive literal id is a ghost.
  const missingRedirect = (name, id) => name === 'helper' && openHelperIds === 0 && Number.isInteger(id) && id > 0 && !helperIds.has(id);
  // READS OF THE OPPONENT: her variables, her name, her animations and
  // helpers, a state number only another table can hold. Whether they hold
  // depends on who she fights, which no file of this character decides
  // (kuromaru_girl_plus cns1.txt:2297-2305 `p2name = "Kuromaru"` with `enemy,
  // var(7) > 0`; cvs_makoto Specials.st:2291 `enemy, var(36) >= 64`).
  // Position, life, statetype, movetype, projectile counts and the like are
  // NOT listed: every opponent has them, and AI code full of `p2statetype !=
  // L` or `enemynear, numproj = 0` is still hers to run. Nor is `target,
  // SelfAnimExist(N) = 0`: that is the scene fallback for an opponent without
  // the animation - every opponent outside the scene's family lacks it - and
  // exactly how a real freeze is reached (Science_for_Adults inudog2.cns:203,
  // Cynthia marinero.txt:182). Nor is a name compared with !=: `EnemyNear,
  // Name != "helibonus"` leaves out a few opponents and fires against every
  // other (Captain Marvel Template.cmd:1356-1361).
  const OPP_REDIRECT = /^(enemy|enemynear|p2|target)$/;
  const oppField = (r) => /^(sys)?f?var\(/.test(r.field)
    || (/^(name|p1name|authorname|displayname)$/.test(r.field) && r.op !== '!=')
    || ((r.field === 'stateno' || r.field === 'prevstateno') && r.n !== null && !defined(r.n));
  const readsOpponent = (atom) => X.readsOf(atom).some((r) => (r.via && OPP_REDIRECT.test(r.via) && oppField(r))
    || (!r.via && /^p[2-8]name$/.test(r.field) && r.op !== '!=')
    || (!r.via && /^p2(stateno|prevstateno)$/.test(r.field) && r.n !== null && !defined(r.n)));
  const STATENO_GATE = /^(?:(?:parent|root|helper(?:\(\d+\))?|playerid\(gethitvar\(fall\.envshake\.ampl\)\)),)?(?:prevstateno|stateno)=(\d+)$/;
  const ATOM = {
    ghostHelper: (a) => {
      if (openHelperIds) return false;
      const m = /^(ishelper|numhelper)\((\d+)\)(=[1-9]\d*|!=0|>0|>=[1-9]\d*)?$/.exec(a);
      return !!m && !helperIds.has(+m[2]);
    },
    // `stateno = N` of the runner, or of a player whose table is hers: root,
    // parent, one of her helpers, or the holder a victim state finds through
    // the fall.envshake.ampl = id idiom (PlayerID(GetHitVar(fall.envshake.ampl))).
    ghostState: (a) => { const m = STATENO_GATE.exec(a); return !!m && !defined(+m[1]) && !targeted(+m[1]); },
    // The same gate on an undefined number some state change does target:
    // it can only hold while that player already sits in the empty state.
    frozenState: (a) => { const m = STATENO_GATE.exec(a); return !!m && !defined(+m[1]) && targeted(+m[1]); },
    foreign: (a) => { const m = /^(p1name|name|authorname)="([^"]*)"$/.exec(a); return !!m && !localizedInfo && !/[^\x00-\x7f]/.test(m[2] + own.join('')) && !own.includes(m[2]); },
    opponent: readsOpponent,
    dead: (a) => /^(!alive|alive=0)$/.test(a),
    // Her opponent already down: `EnemyNear, Alive = 0` and its kin.
    // A positive IsHelper gate: the controller is meant for a helper.
    helperOnly: (a) => /^ishelper(\(\d+\))?(=1|!=0|>0)?$/.test(a),
    enemyDead: (a) => /^(?:(?:enemynear|enemy|p2)(?:\(\d+\))?,alive=0|!(?:enemynear|enemy|p2)(?:\(\d+\))?,alive)$/.test(a),
    round: (a) => /^(matchover(=1|>0)?|win(ko|time|perfect)?(=1|>0)?|lose(ko|time)?(=1|>0)?|roundstate(>=3|>2|=3|=4|>=4|>3))$/.test(a),
    team: (a) => /^(teammode(=|!=)(single|simul|turns|tag)|numpartner(>0|>=1|=[1-9])?|partner,.*|playeridexist\(.*)$/.test(a),
    cpu: (a) => {
      if (/^ailevel(>0|>=[1-8]|!=0|=[1-8])?$/.test(a)) return true;
      const m = /^(var\(\d+\))(>0|>=[1-9]\d*|=[1-9]\d*|!=0|=\[[1-9]\d*,\d+\])?$/.exec(a);
      return !!m && vf.aiVars.has(m[1]);
    },
  };
  // CODE AFTER AN EXIT. ChangeState and SelfState return `stop` when the
  // runner changes its own state (bytecode.go:5201, 5220-5221, 5232, 5257),
  // so nothing after them runs that tick, and stateChange1 has already
  // installed the new state's bytecode (char.go:6595-6597, 6667), so the old
  // state never runs again. A controller that always fires on the state's
  // first tick - `trigger1 = 1`, `time = 0` (scenelib isImmediate) - therefore
  // kills every controller written after it: PervertedChunli rape.txt:2934
  // `SelfState trigger1 = time = 0` ends Statedef 36065 long before its
  // TargetState at :3061. Not an exit: a redirect, `continue` (stop =
  // !continue), a value that is not a literal or is the state itself, a
  // negative state (it runs again every tick). A later controller with
  // ignorehitpause still runs when the exit lacks it: a state entered in a
  // hitpause runs only its ignorehitpause controllers until the pause ends
  // (bytecode.go:4585-4590), and persistent never stops a first firing
  // (4603-4610).
  const ihp = (sc) => sc.params.has('ignorehitpause') && S.lit(sc.params.get('ignorehitpause')) !== 0;
  const exitOf = new Map(); // controller -> the exit before it
  for (const s of states.values()) {
    if (s.no < 0 || s.zss) continue;
    let exit = null;
    for (const sc of s.sctrls) {
      if (exit) { if (!(ihp(sc) && !ihp(exit))) exitOf.set(sc, exit); continue; }
      if (sc.type !== 'changestate' && sc.type !== 'selfstate') continue;
      if (sc.neverTrue || sc.gap || sc.params.has('redirectid') || sc.params.has('readplayerid') || sc.params.has('continue')) continue;
      const to = S.lit(sc.params.get('value'));
      if (to === null || to === s.no) continue;
      if (S.isImmediate(sc.trig)) exit = sc;
    }
  }

  // Every assignment of the trigger's variables over their literal domains
  // (0 at round start, plus what the files assign). Returns null when the
  // trigger CAN fire (or the enumeration is too big to say), otherwise the
  // variables it rests on and which of them are opaque.
  //
  // The transparent variables are tried first with the opaque ones left
  // UNKNOWN: `var(52) & 1 && var(59) >= 2` is false for every value var(52)
  // can hold whatever a VarAdd does to var(59), so the opaque variable does
  // not save it (Akiha.cmd:1885, var(52) only ever 0 or 6). Only when that
  // cannot decide are the opaque variables enumerated over their literals too,
  // and a false there is `opaque` - it only looks dead.
  //
  // `redirected`: the names are HER variables read by the opponent running
  // her custom state through `enemy, var(N)` / `target, var(N)`.
  const canFire = (sc, names, base, redirected) => {
    const doms = names.map((n) => [...new Set([0, ...(domains[n] || []), ...(vf.extra[n] || [])])]);
    if (doms.reduce((a, d) => a * d.length, 1) > 512) return true;
    const c = Object.assign({}, base), vals = {};
    if (redirected) c.redirVar = (name, id, v) => (OPP_REDIRECT.test(name) && Object.prototype.hasOwnProperty.call(vals, v) ? vals[v] : undefined);
    const rec = (i) => {
      if (i === names.length) return X.evalTriggerSet(sc.trig, c) !== false;
      for (const v of doms[i]) { if (redirected) vals[names[i]] = v; else c[names[i]] = v; if (rec(i + 1)) return true; }
      return false;
    };
    return rec(0);
  };
  const neverUnder = (sc, names, base, redirected) => {
    const clear = names.filter((n) => !isOpaque(n));
    if (!canFire(sc, clear, base, redirected)) return { vars: clear, opaque: [] };
    if (clear.length === names.length || canFire(sc, names, base, redirected)) return null;
    return { vars: names, opaque: names.filter(isOpaque) };
  };
  // What her own code knows about the player running it. SelfAnimExist(K) /
  // AnimExist(K) of an action neither her .air nor common.air holds is 0
  // (char.go:5266-5285; tbonne TagBattle5.cns:1129 `triggerall =
  // SelfAnimExist(4000)` with no action 4000 anywhere). A bare AnimExist reads
  // the table of the animation she shows (c.animPN), which in -2 - run also
  // while she stands in someone else's state (char.go:12074-12079) - can be
  // the opponent's: unknown there. IsHelper is 0 for the root and 1 for a
  // helper (char.go:5524-5543); a negative state is also run by a helper of
  // helpertype = player or with keyctrl (char.go:12066-12086), where it is
  // not known.
  const selfCtx = (sc, who) => {
    const c = { animSet, missingRedirect, selfHas: animSet, nameEq };
    if (sc.state === -2) c.animHas = null;
    c.isHelper = who === 'helper' ? true : (sc.state < 0 && helpersRunNegatives ? undefined : false);
    return c;
  };
  // Whether a controller can ever run for this runner: { dead: why | null,
  // latent: why | null }. The same answer gates a walk edge and an entry.
  const liveCache = new Map();
  const liveness = (sc, who) => {
    const key = who === 'victim' ? 'v' : who === 'helper' ? 'h' : 'o';
    let c = liveCache.get(sc);
    if (!c) { c = {}; liveCache.set(sc, c); }
    if (c[key]) return c[key];
    const out = { dead: null, latent: null, foreign: false, soft: false };
    c[key] = out;
    if (sc.neverTrue) { out.dead = 'never runs: a trigger is literally 0'; return out; }
    if (sc.gap === 1) { out.dead = 'never runs: it has no trigger1'; return out; }
    if (exitOf.has(sc)) {
      const x = exitOf.get(sc);
      out.dead = 'never runs: ' + x.file + ':' + (x.paramLines.get('value') || x.line) + ' always leaves state ' + sc.state + ' on its first tick, before this controller (bytecode.go:5220-5257)';
      return out;
    }
    if (who !== 'victim') {
      const base = selfCtx(sc, who);
      if (X.evalTriggerSet(sc.trig, { nameEq }) === false || gatedOn(sc, ATOM.foreign)) {
        out.dead = 'never runs: gated on a name this def does not carry ([Info] name "' + display(info.get('name') || '') + '")'; out.foreign = true; return out;
      }
      if (gatedOn(sc, ATOM.ghostHelper)) { out.dead = 'never runs: gated on a helper id no Helper creates'; return out; }
      if (X.evalTriggerSet(sc.trig, { missingRedirect }) === false) { out.dead = 'never runs: it reads helper(N) for an id no Helper creates, which is undefined (bytecode.go:1953-1961)'; return out; }
      if (X.evalTriggerSet(sc.trig, { isHelper: base.isHelper }) === false) {
        out.dead = 'never runs: ' + (who === 'helper' ? 'IsHelper is 1 for a helper' : 'IsHelper is 0 for her') + ' (char.go:5524-5543)'; return out;
      }
      if (X.evalTriggerSet(sc.trig, { selfHas: animSet, animHas: base.animHas === null ? null : animSet }) === false) {
        out.dead = 'never runs: it asks SelfAnimExist / AnimExist for an action neither her .air nor common.air holds (char.go:5266-5285)'; return out;
      }
      const names = [];
      for (const l of linesOf(sc)) for (const v of X.varsOf(l)) if (!names.includes(v)) names.push(v);
      const nd = neverUnder(sc, names, base, false);
      if (nd) {
        if (!nd.vars.length) { out.dead = 'never runs: its trigger can never be true for her'; return out; }
        if (!receiver && !nd.opaque.length) { out.dead = 'never runs: false for every value the files give ' + nd.vars.join(', '); return out; }
        out.latent = 'gated by ' + nd.vars.join(', ') + (nd.opaque.length ? ' (written by VarAdd, VarRandom or a computed value)' : ' (a state the opponent puts her in can set it)');
      }
    } else {
      // The opponent running her custom state: its `enemy, var(N)` /
      // `target, var(N)` is HER var(N) - the one who put it there - so it is
      // judged over her own variable domains; an opaque one stays latent.
      const names = [];
      for (const l of linesOf(sc)) for (const r of X.readsOf(l)) if (r.via && OPP_REDIRECT.test(r.via) && /^(sys)?f?var\(\d+\)$/.test(r.field) && !names.includes(r.field)) names.push(r.field);
      const nd = names.length ? neverUnder(sc, names, {}, true) : null;
      if (nd) {
        if (!receiver && !nd.opaque.length) { out.dead = 'never runs: false for every value her files give ' + nd.vars.join(', ') + ' (read by the opponent as enemy, var)'; return out; }
        out.latent = 'gated by her ' + nd.vars.join(', ') + ', read by the opponent in her state' + (nd.opaque.length ? ' (written by VarAdd, VarRandom or a computed value)' : ' (a state the opponent puts her in can set it)');
      }
    }
    // The player she holds in her custom state is a helper only when her
    // attack caught one: a positive IsHelper gate there is meant for her own
    // helpers, and for a held opponent it is the rare case (Colette Lewd.cns:
    // 2664-2667 `triggerall = ishelper` -> 17201; Hyper Minotaur
    // Minotaur_S.cns:356). Latent for the entry, and a soft way in for the walk.
    if (who === 'victim' && gatedOn(sc, ATOM.helperOnly)) { out.latent = out.latent || 'only when the player she holds is a helper'; out.soft = true; }
    if (gatedOn(sc, ATOM.ghostState)) { out.dead = 'never runs: gated on StateNo / PrevStateNo of a state no file defines or enters'; out.latent = null; return out; }
    // A consequence of another entry, not a problem of its own: listed, not
    // counted.
    if (!out.latent && gatedOn(sc, ATOM.frozenState)) out.latent = 'only while already stuck in a state no loaded file defines';
    if (!out.latent && who !== 'victim' && gatedOn(sc, ATOM.opponent)) out.latent = 'depends on the opponent: it reads the opponent\'s variables, name, animations or states';
    return out;
  };

  // A HitDef, ReversalDef or Projectile whose attack has no Clsn1 box
  // anywhere cannot touch anyone: the hit check needs the attacker's Clsn1
  // (char.go:10622-10624), so its p1stateno / p2stateno are never used.
  // HitDef and ReversalDef draw their boxes from what the state can show - the
  // Statedef anim, a ChangeState anim into it, and every literal ChangeAnim /
  // ChangeAnim2 in the state or in the always-on negative states. A
  // Projectile draws them from its projanim. Anything the .air cannot answer
  // (no header anim, a computed value, an animation she lacks, which keeps
  // the previous one) leaves the attack able to hit.
  // An action she lacks comes from the engine's common.air (char.go:4312-4330),
  // whose run and hop actions carry no Clsn1: read its boxes, and count any
  // common action it cannot read as boxed.
  const hasBoxes = (n) => {
    if (air && air.actions.has(n)) return !!air.actions.get(n).clsn1;
    if (!commonAir.has(n)) return false;
    const c = commonAirTable(engineDir);
    if (!c) return true;
    if (c.copies.has(n)) { const k = c.copies.get(n); return !!air && air.actions.has(k) && !!air.actions.get(k).clsn1; }
    return !c.table.actions.has(n) || !!c.table.actions.get(n).clsn1;
  };
  const incomingAnims = new Map();
  for (const s of states.values()) for (const sc of s.sctrls) {
    if (sc.type !== 'changestate' || !sc.params.has('anim') || sc.params.has('redirectid')) continue;
    const to = S.lit(sc.params.get('value'));
    if (to === null) continue;
    if (!incomingAnims.has(to)) incomingAnims.set(to, []);
    incomingAnims.get(to).push(sc.params.get('anim'));
  }
  const negativeAnims = [];
  for (const s of states.values()) if (s.no < 0) for (const sc of s.sctrls) {
    if (/^changeanim2?$/.test(sc.type) && !sc.neverTrue && sc.params.has('value') && !sc.params.has('redirectid')) negativeAnims.push(sc.params.get('value'));
  }
  const noHitCache = new Map();
  const cannotHit = (s, sc, who) => {
    if (!air || boxesFromCode || who === 'victim') return false;
    const t = sc.type;
    if (t === 'projectile') {
      const pa = parseAnim(sc.params.get('projanim') === undefined ? '' : sc.params.get('projanim'));
      return pa.n !== null && !(pa.prefix && pa.prefix !== 's') && actionExists(pa.n) && !hasBoxes(pa.n);
    }
    if (t !== 'hitdef' && t !== 'reversaldef') return false;
    if (noHitCache.has(s.no)) return noHitCache.get(s.no);
    const verdict = (() => {
      const head = parseAnim(s.anim === null ? '' : s.anim);
      if (head.n === null || (head.prefix && head.prefix !== 's') || !actionExists(head.n)) return false;
      const cands = [head.n];
      const more = [...(incomingAnims.get(s.no) || []), ...negativeAnims];
      for (const x of s.sctrls) if (/^changeanim2?$/.test(x.type) && !x.neverTrue && x.params.has('value') && !x.params.has('redirectid')) more.push(x.params.get('value'));
      for (const raw of more) {
        const v = parseAnim(raw);
        if (v.n === null || (v.prefix && v.prefix !== 's')) return false;
        if (actionExists(v.n)) cands.push(v.n);
      }
      return cands.every((n) => !hasBoxes(n));
    })();
    noHitCache.set(s.no, verdict);
    return verdict;
  };
  const NO_HIT = 'the attack has no hit box, so this never runs (no Clsn1 in any animation the state shows; char.go:10622-10624)';

  // -- who runs each state ---------------------------------------------------------
  // HARD roots are only what the engine itself enters: the always-on
  // negative states, the numbers the engine changes to with no controller
  // (enginedata HARDCODED), the literal targets inside the CommonStates files
  // compiled into this table (critic 6), the motif's continue / victory
  // states, and - when stcommon is the engine's own common1.cns.zss - that
  // file's targets (5900 -> 190, 190 -> 191, 5070 -> 5071 ...). A custom state
  // numbered 1 or 5594 earns its reach like any other. A local stcommon is a
  // parsed file: its edges carry the walk from the hardcoded numbers.
  const roots = [...hardRoots];
  const reach = S.reachable(states, { roots });
  // Runners per state, each HARD (reached through literal edges) or SOFT
  // (somewhere through a computed value). An edge whose controller can never
  // fire for the runner (liveness dead, or an attack with no hit box) is no
  // way in.
  const ctx = new Map();
  const level = (no, who) => (ctx.get(no) || {})[who] || 0;
  const queue = [];
  const mark = (no, who, lv) => {
    if (!states.has(no)) return;
    let c = ctx.get(no);
    if (!c) { c = {}; ctx.set(no, c); }
    if ((c[who] || 0) >= lv) return;
    c[who] = lv;
    queue.push([no, who]);
  };
  const edgeCache = new Map();
  const edgesOf = (s) => {
    if (edgeCache.has(s.no)) return edgeCache.get(s.no);
    const out = [];
    const push = (sc, raw, map, hit) => {
      if (raw === undefined) return;
      const n = S.lit(raw);
      if (n !== null) { if (n >= 0) out.push({ to: n, map, soft: false, sc, hit }); return; }
      if (!X.parses(raw)) return;
      // An ifelse of literals can only hand back its leaves: `ifelse(cond,
      // 1000, 1200)` reaches 1000 and 1200 and nothing near them, and a value
      // built only from what can be listed reaches what it produces
      // (listedValues). Only an arithmetic value no reading can list (an
      // opaque variable, a trigger) gets scenelib's window around its base.
      // Her own name settles a condition inside the value for her and her
      // helpers (sion_a04.cns:361 `ifelse(... && name != "Eltnum", 2502,
      // 415)` never gives Eltnum 2502); an opponent running the state
      // answers with its own name, so the other leaves stay its edges.
      const exact = exactLeaves(raw) || listedValues(raw);
      if (exact) {
        const mine = listedValues(raw, { nameEq });
        for (const t of exact) if (t >= 0) out.push({ to: t, map, soft: true, sc, hit, victimOnly: !!mine && !mine.includes(t) });
        return;
      }
      const base = X.evalExpr(raw, Object.fromEntries(X.varsOf(raw).map((v) => [v, 0])));
      if (Number.isFinite(base)) { for (const s2 of states.values()) if (s2.no >= base - 40 && s2.no <= base + 200) out.push({ to: s2.no, map, soft: true, window: true, sc, hit }); }
      else for (const t of X.leavesOf(raw)) out.push({ to: t, map, soft: true, window: true, sc, hit });
    };
    for (const sc of s.sctrls) {
      if (sc.neverTrue || sc.params.has('redirectid')) continue;
      const p = (k) => sc.params.get(k);
      switch (sc.type) {
        case 'changestate': push(sc, p('value'), 'same'); break;
        case 'selfstate': if (!sc.params.has('readplayerid')) push(sc, p('value'), 'runner'); break;
        case 'hitoverride': push(sc, p('stateno'), 'runner'); break;
        case 'tagin': case 'tagout': push(sc, p('stateno'), 'same'); break;
        case 'helper': push(sc, p('stateno') === undefined ? '0' : p('stateno'), 'spawn'); break;
        case 'targetstate': push(sc, p('value'), 'victim'); break;
        case 'hitdef': case 'reversaldef': case 'projectile':
          push(sc, p('p1stateno'), 'same', true);
          if (!(p('p2getp1state') !== undefined && S.lit(p('p2getp1state')) === 0)) push(sc, p('p2stateno'), 'victim', true);
          break;
        default: break;
      }
    }
    edgeCache.set(s.no, out);
    return out;
  };
  const MAP = {
    same: { owner: 'owner', victim: 'victim', helper: 'helper' },
    runner: { owner: 'owner', helper: 'helper' },
    spawn: { owner: 'helper', helper: 'helper' },
    victim: { owner: 'victim', helper: 'victim', victim: 'victim' },
  };
  // Every live owner edge into a state, for the pose she carries into it.
  const ownerPreds = new Map();
  const propagate = () => {
    while (queue.length) {
      const [no, who] = queue.shift();
      const lv = level(no, who);
      const s = states.get(no);
      for (const e of edgesOf(s)) {
        const to = MAP[e.map][who];
        if (!to) continue;
        if (e.victimOnly && who !== 'victim') continue;
        if (liveness(e.sc, who).dead) continue;
        if (e.hit && cannotHit(s, e.sc, who)) continue;
        // A window edge is a guess at reach, not evidence of an entry: it
        // gives no pose (see THE POSE SHE CARRIES IN).
        if (who === 'owner' && to === 'owner' && states.has(e.to) && !e.window) {
          if (!ownerPreds.has(e.to)) ownerPreds.set(e.to, new Map());
          ownerPreds.get(e.to).set(e.sc, s);
        }
        mark(e.to, to, lv === HARD && !e.soft && !liveness(e.sc, who).soft ? HARD : SOFT);
      }
    }
  };
  for (const s of states.values()) if (s.no < 0) mark(s.no, 'owner', HARD);
  for (const r of roots) mark(r, 'owner', HARD);
  propagate();
  const hardAny = (no) => ['owner', 'helper', 'victim'].some((w) => level(no, w) === HARD);
  // Scenes other code puts HER victims into (scenelib's scene analysis): a
  // custom state with a live entry is victim-run however it was entered - as
  // hard as the walk already reaches it, soft otherwise.
  let giver = null;
  try { giver = S.analyzeGiver(charDir, defName, { resolve, consts, ikemenVersion }); } catch (e) { giver = null; }
  if (giver) for (const [c, sc] of giver.scenes) if (sc.entries.some((en) => !en.dead)) mark(c, 'victim', hardAny(c) ? HARD : SOFT);
  propagate();
  // A movetype = H state outside the gethit block that her own code reaches
  // but never enters as herself by literal is somebody's victim (a computed
  // TargetState the scene reader cannot solve): victim context, as hard as
  // whatever reaches it.
  for (const s of states.values()) {
    if (s.movetype !== 'h' || (s.no >= 5000 && s.no <= 5199) || level(s.no, 'owner') === HARD || !ctx.has(s.no)) continue;
    mark(s.no, 'victim', hardAny(s.no) ? HARD : SOFT);
  }
  propagate();
  const runOf = (no) => { const c = ctx.get(no) || {}; return { owner: c.owner || 0, victim: c.victim || 0, helper: c.helper || 0 }; };

  // Files in the folder the def does not load, for the "defined only in"
  // note: any .cns/.st/.cmd/.txt/.zss two levels deep. Built on first need.
  let otherStates = null, otherAirs = null;
  const walkFolder = (re, fn) => {
    const walk = (d, depth) => {
      let list;
      try { list = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
      for (const e of list) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) { if (depth < 2) walk(p, depth + 1); continue; }
        if (re.test(e.name)) fn(p);
      }
    };
    walk(charDir, 0);
  };
  const unloadedDefiner = (n) => {
    if (!otherStates) {
      otherStates = new Map();
      walkFolder(/\.(cns|st|cmd|txt|zss)$/i, (p) => {
        if (loadedAbs.has(normAbs(p))) return;
        let t;
        try { if (fs.statSync(p).size > MAX_TEXT) return; t = fs.readFileSync(p, 'latin1'); } catch (e) { return; }
        for (const m of t.matchAll(/^[ \t]*\[\s*statedef\s+(-?\d+)/gim)) { const k = +m[1]; if (!otherStates.has(k)) otherStates.set(k, rel(charDir, p)); }
      });
    }
    return otherStates.get(n) || null;
  };
  const otherAirHolder = (n) => {
    if (!otherAirs) {
      otherAirs = new Map();
      walkFolder(/\.air$/i, (p) => {
        if (animAbs && normAbs(p) === normAbs(animAbs)) return;
        let t;
        try { if (fs.statSync(p).size > MAX_TEXT) return; t = fs.readFileSync(p, 'latin1'); } catch (e) { return; }
        for (const k of A.airTable(t).actions.keys()) if (!otherAirs.has(k)) otherAirs.set(k, rel(charDir, p));
      });
    }
    return otherAirs.get(n) || null;
  };
  const retired = E.retiredStates();

  // The downgrade chain shared by states and anims. `who` is the runner whose
  // trigger context decides: 'owner' | 'helper' | 'victim'.
  const downgrade = (e, s, sc, who, lv) => {
    const note = (x) => { if (!e.notes.includes(x)) e.notes.push(x); };
    let latent = null;
    if (sc) {
      const lz = liveness(sc, who);
      if (lz.dead) { e.tier = lz.foreign ? 'foreign-name' : 'dead'; note(lz.dead); return; }
      if (e.hit && cannotHit(s, sc, who)) { e.tier = 'dead'; e.why = NO_HIT; note('never runs: the attack has no hit box'); return; }
      latent = lz.latent;
    }
    if (sc && (sc.params.has('redirectid') || (sc.type === 'selfstate' && sc.params.has('readplayerid'))
      || (/^changeanim2?$/.test(sc.type) && e.param === 'value' && ['animplayerno', 'spriteplayerno', 'readplayerid'].some((k) => sc.params.has(k))))) {
      e.tier = 'redirected'; return;
    }
    if (e.n === null) { e.tier = 'computed'; return; }
    if (HIDDEN_TIERS.has(e.tier)) return;
    if (latent) { e.was = e.tier; e.tier = 'latent'; note(latent); }
    else if (lv < HARD) { e.was = e.tier; e.tier = 'latent'; note('reached only through a computed value'); }
    // After a KO: a victim-run `!Alive`, or her own code waiting for the
    // opponent to be down (`EnemyNear, Alive = 0`).
    if (sc && ((who === 'victim' && gatedOn(sc, ATOM.dead)) || (who !== 'victim' && gatedOn(sc, ATOM.enemyDead)))) { e.was = e.was || e.tier; e.tier = 'after-ko'; note('only after a KO'); }
    else if ((s.no >= 170 && s.no <= 199) || (sc && gatedOn(sc, ATOM.round))) { e.was = e.was || e.tier; e.tier = 'after-round'; note('only after the round is decided'); }
    if (sc && gatedOn(sc, ATOM.cpu)) note('CPU only');
    if (sc && gatedOn(sc, ATOM.team)) note('team or tag mode only');
  };
  const newEntry = (s, sc, controller, param, raw, line, n) => ({
    tier: null, n, raw, file: sc ? sc.file : s.file, line, block: sc ? sc.line : s.line, state: s.no,
    controller, param, tag: sc ? display(sc.tag) : String(s.no), label: sc ? display(sc.label) : '', why: '', notes: [], trigger: sc ? display(triggerText(sc)) : '',
  });
  const runnersFor = (sc, r) => {
    const any = ['owner', 'helper', 'victim'].filter((w) => r[w]);
    // `IsHelper` / `IsHelper(N)` with a helper running the state: its controller.
    if (r.helper && !liveness(sc, 'helper').dead && gatedOn(sc, ATOM.helperOnly)) return { owner: 0, victim: 0, helper: r.helper };
    const alive = any.filter((w) => !liveness(sc, w).dead);
    if (!alive.length || alive.length === any.length) return r;
    const out = Object.assign({}, r);
    for (const w of any) if (!alive.includes(w)) out[w] = 0;
    return out;
  };
  const holds = (s, types) => s.sctrls.some((sc) => types.includes(sc.type) && !sc.neverTrue);
  const invisibleNow = (s) => s.sctrls.some((sc) => sc.type === 'assertspecial' && !sc.neverTrue && S.isImmediate(sc.trig)
    && ['flag', 'flag2', 'flag3'].some((k) => /invisible/i.test(sc.params.get(k) || '')));

  // THE POSE SHE CARRIES IN. A failed animation change keeps the previous
  // animation WITH its boxes (char.go:4663-4666 returns before c.anim is
  // replaced), so a state whose own animation is missing hits with whatever
  // she showed when she entered it: taimanin_asagi 1305 (Specials.cns:2442)
  // is entered from 1300/1310/1320, whose knee frames carry Clsn1; Jessica
  // Albert 1038 keeps 1037's held action 1031. The poses on entry, per live
  // owner edge into the state:
  //   - a ChangeState carrying `anim = N`: N (changeStateEx changes the
  //     animation before the state, char.go:6765-6767);
  //   - from a positive state: that state's Statedef anim, its literal
  //     ChangeAnim / ChangeAnim2 values and the anims ChangeStates hand it;
  //   - from a negative state (a command): the states a `StateNo = N` gate
  //     names; otherwise, when every group needs `ctrl`, every live state she
  //     stands in with control - a header `ctrl = 1`, her own 0-199 and, with
  //     the engine's common1, that file's 0-169 (enginedata.stcommonAnims).
  // `open` whenever a pose cannot be listed: a missing or computed animation
  // in a predecessor, a state that shows nothing of its own, a number the
  // engine enters by itself, a HitOverride or tag edge, a command that does
  // not need control or rests on having just hit (MoveContact and kin).
  const stcAnims = stcommonEngine ? E.stcommonAnims() : new Map();
  const typeOf = (no) => {
    const s = states.get(no);
    if (s) { const t = String(s.header.get('type') || '').trim().toLowerCase(); return /^[scal]/.test(t) ? t[0] : null; }
    return stcAnims.has(no) ? stcAnims.get(no).type : null;
  };
  // One walk per question, a fresh `seen` each time: a loop of states adds
  // nothing a pass around it has not already added, so a state met again is
  // skipped rather than cached half-done.
  //   showPose(no)  - what state `no` can be showing while it runs
  //   entryPose(no) - what she can be showing when she enters `no`
  const newPose = () => ({ anims: new Set(), open: '' });
  const merge = (into, p) => { for (const k of p.anims) into.anims.add(k); if (p.open && !into.open) into.open = p.open; };
  const showPose = (no, seen) => {
    const out = newPose();
    if (seen.has('s' + no)) return out;
    seen.add('s' + no);
    const s = states.get(no);
    if (s && !s.zss) {
      // A header anim she lacks, or none at all, shows what she carried in.
      let carries = s.anim === null;
      const addRaw = (raw) => {
        const a = parseAnim(raw);
        if (a.n !== null && !(a.prefix && a.prefix !== 's')) { if (actionExists(a.n)) out.anims.add(a.n); else carries = true; return; }
        if (a.prefix && a.prefix !== 's') { out.open = out.open || 'state ' + no + ' shows a fight FX animation'; return; }
        const vals = listedValues(raw);
        if (vals) { for (const v of vals) if (actionExists(v)) out.anims.add(v); else carries = true; } else out.open = out.open || 'state ' + no + ' shows a computed animation';
      };
      if (s.anim !== null) addRaw(s.anim);
      for (const x of s.sctrls) {
        if (!/^changeanim2?$/.test(x.type) || x.neverTrue || !x.params.has('value') || x.params.has('redirectid')) continue;
        if (['animplayerno', 'spriteplayerno', 'readplayerid'].some((k) => x.params.has(k))) { out.open = out.open || 'state ' + no + ' shows another player\'s animation'; continue; }
        addRaw(x.params.get('value'));
      }
      for (const raw of incomingAnims.get(no) || []) addRaw(raw);
      if (carries) merge(out, entryPose(no, seen));
    } else if (stcAnims.has(no)) {
      const st = stcAnims.get(no);
      for (const v of st.anims) if (actionExists(v)) out.anims.add(v);
      if (st.open || !st.anims.length) out.open = out.open || 'the engine\'s common state ' + no + ' shows an animation that cannot be listed';
    } else out.open = out.open || 'state ' + no + ' is not one her files define';
    return out;
  };
  // Her own hit-contact triggers. `EnemyNear, HitDefAttr = ...` reads the
  // opponent's attack, not hers (Mature_XIII mature.cmd:1730).
  const MOVE_GATE = /\b(movecontact|movehit|moveguarded|movereversed|hitdefattr|projcontact|projhit|projguarded)\b/i;
  const REDIRECTED_READ = /\b(enemy|enemynear|p2|target|helper|parent|root|partner|playerid|stateowner)\s*(\((?:[^()]|\([^()]*\))*\))?\s*,\s*[a-z_]\w*/gi;
  const contactGate = (line) => MOVE_GATE.test(String(line).replace(REDIRECTED_READ, ''));
  // Split at depth 0 on a two-character operator: `a && (b || c)` -> a, (b || c).
  const splitTop = (text, op) => {
    const out = [];
    let depth = 0, start = 0;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === '(' || ch === '[') depth++;
      else if (ch === ')' || ch === ']') depth--;
      else if (depth === 0 && text.startsWith(op, i)) { out.push(text.slice(start, i)); start = i + op.length; i++; }
    }
    out.push(text.slice(start));
    return out.map(peel);
  };
  const STATENO_ONE = /^stateno=(\d+)$/, STATENO_RANGE = /^stateno=\[(\d+),(\d+)\]$/, CTRL_ATOM = /^ctrl(=1|!=0)?$/;
  // What a command's trigger lines say about the state she fires it from:
  // { pins: [state numbers] | null, ctrl: bool, types: {want, not} }. A
  // conjunct `StateNo = N` or `StateNo = [a,b]` (the defined ones) pins her;
  // a conjunct that is a disjunction of those and `ctrl` - `(ctrl || stateno
  // = 11 || stateno = [100,101])`, mature.cmd:1734 - is a stance or one of
  // those states.
  const firedFrom = (lines) => {
    const pinOf = (atom) => {
      let m = STATENO_ONE.exec(atom);
      if (m) return [+m[1]];
      m = STATENO_RANGE.exec(atom);
      if (!m) return null;
      const out = [];
      for (let k = +m[1]; k <= +m[2] && k - +m[1] <= 2000; k++) if (states.has(k) || stcAnims.has(k)) out.push(k);
      return out.length ? out : null;
    };
    let pins = null, ctrl = false, orPins = null;
    let want = null;
    const not = new Set();
    for (const l of lines) {
      for (const c of splitTop(peel(String(l).replace(/\s+/g, '').toLowerCase()), '&&')) {
        const p = pinOf(c);
        if (p) { if (!pins) pins = p; continue; }
        if (CTRL_ATOM.test(c)) { ctrl = true; continue; }
        const st = /^statetype(=|!=)([scal])$/.exec(c);
        if (st) { if (st[1] === '=') want = st[2]; else not.add(st[2]); continue; }
        const ors = c.includes('||') ? splitTop(c, '||') : null;
        if (ors && ors.length > 1) {
          const opts = ors.map((d) => (CTRL_ATOM.test(d) ? 'ctrl' : pinOf(d)));
          if (opts.every(Boolean) && !orPins) orPins = { ctrl: opts.includes('ctrl'), pins: opts.filter((x) => x !== 'ctrl').flat() };
        }
      }
    }
    return { pins, ctrl, orPins, types: { want, not } };
  };
  // Every live state she stands in with control - a header `ctrl = 1`, her
  // own 0-199 and, with the engine's common1, its 0-169 she does not replace
  // - narrowed by the command's `StateType = X` / `StateType != X`. A common1
  // state's value it cannot list (50's `anim + 3`, 140's `$anim`) is its jump
  // or guard variant, never an attack: its listed animations stand for it.
  const stancePose = (types) => {
    const want = types.want, not = types.not;
    const fits = (no) => { const t = typeOf(no); return t === null || ((!want || t === want) && !not.has(t)); };
    const out = newPose();
    for (const s of states.values()) {
      if (s.zss || s.no < 0 || !runOf(s.no).owner || !fits(s.no)) continue;
      const ctrl = s.header.get('ctrl');
      if ((ctrl !== undefined && S.lit(ctrl) === 1) || s.no <= 199) {
        const p = showPose(s.no, new Set(['e' + s.no]));
        for (const k of p.anims) out.anims.add(k);
      }
    }
    for (const [no, st] of stcAnims) if (no >= 0 && no <= 169 && !states.has(no) && fits(no)) for (const v of st.anims) if (actionExists(v)) out.anims.add(v);
    if (!out.anims.size) out.open = 'no state she stands in with control shows a listed animation';
    return out;
  };
  const entryPose = (no, seen) => {
    const out = newPose();
    if (seen.has('e' + no)) return out;
    seen.add('e' + no);
    if (hardRoots.has(no)) out.open = 'the engine enters state ' + no + ' by itself';
    const preds = ownerPreds.get(no);
    if (!preds || !preds.size) { out.open = out.open || 'no literal entry into state ' + no; return out; }
    for (const [sc, from] of preds) {
      if (sc.type === 'changestate' && sc.params.has('anim')) {
        const a = parseAnim(sc.params.get('anim'));
        if (a.n !== null && !a.prefix && actionExists(a.n)) { out.anims.add(a.n); continue; }
      }
      if (sc.type === 'hitoverride' || sc.type === 'tagin' || sc.type === 'tagout') { out.open = out.open || ctrlName(sc.type) + ' at ' + sc.file + ':' + sc.line; continue; }
      if (from.no >= 0) { merge(out, showPose(from.no, seen)); continue; }
      // A command, per trigger group with the triggerall lines: a StateNo
      // gate names the pose; otherwise a hit-contact gate is an attack pose
      // no list holds, a `ctrl` gate is a stance, and anything else could
      // fire from any state.
      const groups = sc.trig.groups.length ? sc.trig.groups : [[]];
      for (const g of groups) {
        const lines = [...sc.trig.all, ...g];
        const f = firedFrom(lines);
        // A pinned state nothing enters cannot be where she is (Mature_XIII
        // 901): only the reachable ones give a pose.
        if (f.pins) { for (const k of f.pins) if (!states.has(k) || runOf(k).owner) merge(out, showPose(k, seen)); continue; }
        if (lines.some(contactGate)) { out.open = out.open || sc.file + ':' + sc.line + ' fires on contact from a state it does not name'; continue; }
        if (f.ctrl) { merge(out, stancePose(f.types)); continue; }
        if (f.orPins) {
          for (const k of f.orPins.pins) if (!states.has(k) || runOf(k).owner) merge(out, showPose(k, seen));
          if (f.orPins.ctrl) merge(out, stancePose(f.types));
          continue;
        }
        out.open = out.open || sc.file + ':' + sc.line + ' does not need control, so it can fire from any state';
      }
    }
    return out;
  };

  // -- missing states -----------------------------------------------------------------
  const stateEntries = [];
  for (const s of states.values()) {
    if (s.zss) continue;
    const r0 = runOf(s.no);
    for (const sc of s.sctrls) {
      // A runner for whom the controller can never fire does not run it: a
      // state both she and her helpers run, with `triggerall = IsHelper`, is
      // the helper's controller (Rachel_S common2.cns:815-823).
      const r = runnersFor(sc, r0);
      for (const param of STATE_PARAMS[sc.type] || []) {
        const raw = sc.params.get(param);
        if (raw === undefined) continue;
        const n = S.lit(raw);
        if (n !== null && (n < 0 || defined(n))) continue;
        const e = newEntry(s, sc, ctrlName(sc.type), param, raw, sc.paramLines.get(param) || sc.line, n);
        if (param === 'p1stateno' || param === 'p2stateno') e.hit = true;
        const computedWhy = 'a computed value; the audit does not follow it';
        const t = sc.type;
        const p2own = param === 'p2stateno' && sc.params.has('p2getp1state') && S.lit(sc.params.get('p2getp1state')) === 0;
        let who = r.owner ? 'owner' : r.helper ? 'helper' : r.victim ? 'victim' : null;
        if (t === 'changestate' || param === 'p1stateno') {
          e.tier = r.owner ? 'freezes' : r.victim ? 'freezes-opponent' : r.helper ? 'helper' : 'dead';
          who = r.owner ? 'owner' : r.victim ? 'victim' : r.helper ? 'helper' : null;
          e.why = e.tier === 'freezes' ? 'no loaded file defines ' + n + '; she freezes' + (param === 'p1stateno' ? ' on hit' : '')
            : e.tier === 'freezes-opponent' ? 'no loaded file defines ' + n + '; the opponent she holds freezes (ChangeState reads her table, char.go:6785-6787)'
            : '';
        } else if (t === 'selfstate' || t === 'hitoverride' || t === 'helper') {
          e.tier = r.owner ? (t === 'helper' ? 'helper' : 'freezes') : r.helper ? 'helper' : r.victim ? 'victim-side' : 'dead';
          if (e.tier === 'freezes') e.why = 'no loaded file defines ' + n + '; she freezes';
        } else {
          e.tier = p2own ? 'victim-side' : (who ? 'freezes-opponent' : 'dead');
          if (e.tier === 'freezes-opponent') e.why = 'no loaded file defines ' + n + '; the opponent freezes' + (t === 'targetstate' ? '' : ' on hit');
        }
        if (e.tier === 'helper') {
          e.why = 'a helper is sent to a state no loaded file defines; the engine gives it her standing animation and control and it stays there (char.go:6966, 6667-6674) - not yet confirmed in a match';
        }
        if (e.tier === 'victim-side') e.why = 'looked up in the table of the character running the state, not hers';
        if (n === null) e.why = computedWhy;
        if (!who) { e.tier = 'dead'; e.notes.push('never runs: nothing enters state ' + s.no); }
        else downgrade(e, s, sc, who, Math.max(r[who] || 0, 0));
        // A RELAY. p1stateno is applied on every hit that applies p2stateno
        // (both inside Abs(hitResult) == 1 of the same hit: char.go:11104-11111
        // and 11773-11789; 10966 refuses the hit outright when p1stateno cannot
        // be taken). When her p1stateno state, on its first tick and
        // unconditionally, TargetStates the opponent on to a defined state, the
        // undefined p2stateno is left before it shows (Gnoll Raid2
        // TowerOfBloodyfight-Zom.st:6504 p2stateno 1873 with p1stateno 1872,
        // whose `TargetState trigger1 = Time = 0` sends the victim to 1876).
        if (param === 'p2stateno' && n !== null && !HIDDEN_TIERS.has(e.tier)) {
          const p1 = S.lit(sc.params.get('p1stateno'));
          const ps = p1 !== null && p1 >= 0 ? states.get(p1) : null;
          const hid = sc.params.has('id') ? S.lit(sc.params.get('id')) : null;
          const relay = ps && !ps.zss && ps.sctrls.find((x) => x.type === 'targetstate' && !x.neverTrue && !x.gap && !x.params.has('redirectid')
            && !liveness(x, 'owner').dead && S.isImmediate(x.trig) && S.lit(x.params.get('value')) !== null && defined(S.lit(x.params.get('value')))
            && (!x.params.has('id') || (hid !== null && S.lit(x.params.get('id')) === hid)));
          if (relay) {
            e.was = e.was || e.tier; e.tier = 'relay';
            e.why = 'no loaded file defines ' + n + ', but the attacker\'s p1stateno state moves the opponent on at once: at most a tick in the empty state';
            e.notes.push('p1stateno ' + p1 + ' sends the opponent on to ' + S.lit(relay.params.get('value')) + ' on its first tick (' + relay.file + ':' + (relay.paramLines.get('value') || relay.line) + ')');
          }
        }
        // A TargetState only the opponent runs, in her custom state with
        // nothing in it that could give that opponent a target (no HitDef,
        // ReversalDef, Projectile or Helper): the target list it walks is the
        // opponent's own (char.go:8545), and nothing there fills it.
        if (t === 'targetstate' && !r.owner && !r.helper && r.victim && e.tier === 'freezes-opponent'
          && !holds(s, ['hitdef', 'reversaldef', 'projectile', 'helper'])) {
          e.was = e.was || e.tier; e.tier = 'latent'; e.notes.push('run only by the opponent she holds, who has no target in this state');
        }
        if (n !== null) {
          const other = unloadedDefiner(n);
          if (other) e.notes.push('defined only in ' + display(other) + ' (not in [Files])');
          if (retired.has(n)) e.notes.push('retired number: this engine uses const(' + retired.get(n) + ')');
          if (t === 'helper' && e.tier === 'helper') { const id = S.lit(sc.params.get('id')); if (id !== null && polled.has(id)) e.notes.push('polled by NumHelper(' + id + ')'); }
        }
        if (!e.why) e.why = 'no loaded file defines ' + n;
        delete e.hit;
        stateEntries.push(e);
      }
    }
  }

  // -- missing animations -------------------------------------------------------------
  const animEntries = [];
  const animCheck = (s, sc, controller, param, raw, line) => {
    const { n, prefix } = parseAnim(raw);
    if (n !== null && !(prefix && prefix !== 's') && n >= 0 && actionExists(n)) return;
    const e = newEntry(s, sc, controller, param, raw, line, n);
    const r = sc ? runnersFor(sc, runOf(s.no)) : runOf(s.no);
    const t = sc ? sc.type : 'statedef';
    if (n !== null && prefix && prefix !== 's') { e.tier = 'fightfx'; e.why = 'drawn from the fight FX table, not her .air'; animEntries.push(e); return; }
    if (n !== null && n < 0) { e.tier = 'sentinel'; e.why = n === -2 ? '-2 is the empty animation' : '-1 means no change'; animEntries.push(e); return; }
    let who;
    if (t === 'changeanim2') {
      who = r.owner ? 'owner' : r.helper ? 'helper' : r.victim ? 'victim' : null;
      e.tier = who ? 'previous-pose' : 'dead';
      e.why = who === 'victim' ? 'the scene\'s own animation ' + n + ' is missing from her .air; the opponent keeps her previous pose (ChangeAnim2 reads the state owner\'s .air, bytecode.go:5548)'
        : 'animation ' + n + ' is missing from her .air; the previous pose stays (char.go:4661-4667)';
    } else {
      who = r.owner ? 'owner' : r.helper ? 'helper' : r.victim ? 'victim' : null;
      if (!who) e.tier = 'dead';
      else if (who === 'victim') { e.tier = 'victim-side'; e.why = 'drawn from the .air of the character running the state (a scene\'s demand), not hers'; }
      else if (t === 'projectile') { e.tier = 'projectile-copies'; e.why = 'the projectile copies her current frame, boxes included (char.go:7635-7643)'; }
      else if (t === 'explod') { e.tier = 'explod'; e.why = 'the explod exists but draws nothing (char.go:1853-1890)'; }
      else if (who === 'helper') { e.tier = 'helper'; e.why = 'a helper state\'s animation ' + n + ' is missing; the helper keeps its previous animation - her standing pose when it was just spawned (char.go:6966, 4661-4667)'; }
      else {
        const hitter = holds(s, ['hitdef', 'projectile', 'reversaldef']);
        let first = t === 'statedef';
        if (t === 'changeanim' && S.isImmediate(sc.trig)) {
          const idx = s.sctrls.indexOf(sc);
          first = !s.sctrls.slice(idx + 1).some((x) => /^changeanim2?$/.test(x.type) && !x.neverTrue && S.isImmediate(x.trig));
        }
        if (t === 'statedef' && s.sctrls.some((x) => /^changeanim2?$/.test(x.type) && !x.neverTrue && S.isImmediate(x.trig))) {
          e.tier = 'replaced-first-tick'; e.why = 'an immediate ChangeAnim replaces the header before it is drawn';
        } else if (first && hitter && r.owner === HARD && !invisibleNow(s)) {
          // Which pose stays: for a ChangeAnim, the header anim the state
          // already shows when that is one of hers; otherwise whatever she
          // carried in (entryPose).
          const head = parseAnim(s.anim === null ? '' : s.anim);
          const pose = t === 'changeanim' && head.n !== null && !head.prefix && actionExists(head.n)
            ? { anims: new Set([head.n]), open: '' } : entryPose(s.no, new Set());
          const boxed = [...pose.anims].filter(hasBoxes);
          if (pose.open || boxed.length) {
            e.tier = 'previous-pose';
            e.why = 'animation ' + n + ' is missing from her .air; she keeps the pose she had, and whether it hits depends on that pose (char.go:4663-4666)';
            e.notes.push(boxed.length ? 'she can enter with animation ' + boxed.slice(0, 4).join(', ') + ', which has a hit box' : 'the pose she enters with cannot be listed: ' + pose.open);
          } else {
            e.tier = 'never-hits';
            e.why = 'animation ' + n + ' is missing from her .air: she keeps the pose she entered with (' + [...pose.anims].slice(0, 6).join(', ') + '), which has no hit box, so the attack in state ' + s.no + ' never connects (char.go:4663-4666, 10622-10624)';
          }
        } else { e.tier = 'previous-pose'; e.why = 'animation ' + n + ' is missing from her .air; the previous pose stays (char.go:4661-4667)'; }
      }
    }
    if (n === null) e.why = 'a computed value; the audit does not follow it';
    if (!e.why) e.why = 'animation ' + n + ' is missing from her .air';
    if (!who) e.notes.push('never runs: nothing enters state ' + s.no);
    else {
      // Guarded: the controller cannot fire while N is absent.
      if (sc && n !== null && who !== 'victim' && !HIDDEN_TIERS.has(e.tier)
        && X.evalTriggerSet(sc.trig, { selfHas: new AllBut(n) }) === false) {
        e.tier = 'guarded'; e.notes.push('guarded by SelfAnimExist(' + n + ')');
      } else downgrade(e, s, sc, who, r[who] || 0);
    }
    if (n !== null && n >= 0) { const other = otherAirHolder(n); if (other) e.notes.push('present only in ' + display(other) + ' (not the def\'s anim file)'); }
    animEntries.push(e);
  };
  if (air) {
    for (const s of states.values()) {
      if (s.zss) continue;
      if (s.anim !== null) animCheck(s, null, 'Statedef', 'anim', s.anim, s.headerLines.get('anim') || s.line);
      for (const sc of s.sctrls) {
        const line = (k) => sc.paramLines.get(k) || sc.line;
        if (sc.type === 'changeanim' || sc.type === 'changeanim2') { if (sc.params.has('value')) animCheck(s, sc, ctrlName(sc.type), 'value', sc.params.get('value'), line('value')); }
        else if (sc.type === 'changestate' && sc.params.has('anim')) animCheck(s, sc, 'ChangeState', 'anim', sc.params.get('anim'), line('anim'));
        else if (sc.type === 'projectile' && sc.params.has('projanim')) animCheck(s, sc, 'Projectile', 'projanim', sc.params.get('projanim'), line('projanim'));
        else if (sc.type === 'explod' && sc.params.has('anim')) animCheck(s, sc, 'Explod', 'anim', sc.params.get('anim'), line('anim'));
      }
    }
  }
  // A Statedef anim entry is never "dead" by its own trigger: it has none.
  for (const e of animEntries) if (e.controller === 'Statedef' && e.tier === 'dead' && !e.notes.length) e.notes.push('never runs: nothing enters state ' + e.state);

  // -- structure --------------------------------------------------------------------
  const structure = [];
  for (const n of [0, 5900]) {
    if (!defined(n)) structure.push({ kind: 'no-state-' + n, file: null, line: null, fatal: true,
      detail: 'no loaded file, stcommon or engine common file defines state ' + n + '; the engine enters it at ' + (n === 0 ? 'round start (system.go:2858, 3438)' : 'round init (system.go:2657)') + ' and she stands frozen' });
  }
  const strays = new Map();
  for (const x of parsed.strayNegative) {
    const k = x.file + '\0' + x.state + '\0' + x.no;
    if (!strays.has(k)) strays.set(k, { kind: 'stray-negative', file: x.file, line: x.line, count: 0, state: x.state, no: x.no });
    strays.get(k).count++;
  }
  for (const v of strays.values()) {
    v.detail = v.count + ' controller(s) labeled [State ' + v.no + '] sit under [Statedef ' + v.state + '] and no [Statedef ' + v.no + '] exists: they belong to state ' + v.state + ' and never run as always-on code (compiler.go:6851-6862)';
    structure.push(v);
  }
  for (const x of parsed.lost) {
    structure.push({ kind: 'lost-controllers', file: x.file, line: x.line, count: x.controllers,
      detail: x.unclosed ? display(x.header) + ' does not end in ]: that controller is skipped (compiler.go:6853-6856)'
        : display(x.header) + ' ends the statedef: ' + x.controllers + ' controller(s) after it never compile (compiler.go:6857-6860)' });
  }
  for (const s of states.values()) for (const sc of s.sctrls) {
    if (!sc.gap) continue;
    const dropped = [...sc.paramLines.keys()].filter((k) => /^trigger\d+$/.test(k) && +k.slice(7) > sc.gap).length;
    structure.push({ kind: 'trigger-gap', file: sc.file, line: sc.line, count: sc.gap === 1 ? 1 : dropped, fatal: sc.gap === 1,
      detail: sc.gap === 1 ? '[State ' + sc.tag + '] has no trigger1: the engine refuses to load the character (compiler.go:7012-7015)'
        : '[State ' + sc.tag + '] skips trigger' + sc.gap + ': ' + dropped + ' trigger group(s) after the gap never compile (compiler.go:6922-6947, 7026-7030)' });
  }
  for (const x of parsed.droppedNegative) {
    structure.push({ kind: 'dropped-negative', file: x.file, line: x.line, count: x.controllers, no: x.no,
      detail: '[Statedef ' + x.no + '] is defined again in a later file of a character without ikemenversion: its ' + x.controllers + ' controller(s) are dropped (compiler.go:7111)' });
  }
  if (parsed.shadowed.length) {
    structure.push({ kind: 'shadowed', file: parsed.shadowed[0].file, line: parsed.shadowed[0].line, count: parsed.shadowed.length,
      detail: parsed.shadowed.length + ' statedef(s) repeat an earlier one: the first definition wins and the later copies never run (compiler.go:6821-6833, 7111)' });
  }
  for (const r of load.notScanned) structure.push({ kind: 'zss-not-scanned', file: r, line: null, detail: /\.zss$/i.test(r) ? 'a ZSS state file: its statedef numbers are read, its controllers are not audited' : 'too large or unreadable: not audited' });
  for (const u of parsed.unresolvedHeaders) structure.push({ kind: 'unresolved-header', file: u.file, line: u.line, fatal: true, detail: display(u.header) + ': const(' + u.name + ') is not defined; the engine refuses to load the character (compiler.go:7345)' });

  // A state file the def does not load but her code clearly means: every
  // shown entry noted "defined only in X" points at the same missing load, so
  // the file is listed once with the numbers it would have supplied. Only
  // entries that can run count: not a hidden tier, and not one reached only
  // through a computed value's window (Lilith_Futa_4.1 105100 and 27315100,
  // rape.txt:8558-8569, sit in 82160, which only a window reaches). A file
  // with no such entry is not listed. `breakTargets` are the numbers whose
  // entries are `freezes` or `freezes-opponent`.
  const WINDOW_NOTE = 'reached only through a computed value';
  const unloaded = new Map();
  for (const e of stateEntries) {
    if (HIDDEN_TIERS.has(e.tier) || e.notes.includes(WINDOW_NOTE)) continue;
    for (const nt of e.notes) {
      const m = /^defined only in (.+) \(not in \[Files\]\)$/.exec(nt);
      if (!m) continue;
      if (!unloaded.has(m[1])) unloaded.set(m[1], { kind: 'unloaded-state-file', file: m[1], line: null, targets: [], controllers: 0, breakTargets: [] });
      const u = unloaded.get(m[1]);
      u.controllers++;
      if (!u.targets.includes(e.n)) u.targets.push(e.n);
      if ((e.tier === 'freezes' || e.tier === 'freezes-opponent') && !u.breakTargets.includes(e.n)) u.breakTargets.push(e.n);
    }
  }
  for (const u of unloaded.values()) {
    u.targets.sort((a, b) => a - b);
    u.breakTargets.sort((a, b) => a - b);
    u.count = u.controllers;
    u.detail = u.file + ' defines ' + u.targets.join(', ') + ', which ' + u.controllers + ' controller(s) ask for, but the def does not load it (compiler.go:8158-8170 reads only [Files] st, stN, cmd and stcommon)';
    structure.push(u);
  }

  // -- vanishing frames --------------------------------------------------------------
  // PLAY SITES. An action is played where running code shows it: a Statedef
  // anim, or a literal ChangeAnim / ChangeAnim2 value, in a state she or her
  // helpers run. A site passes the same liveness as an entry - a controller
  // that can never fire (a trigger false for her, a name this def does not
  // carry, code after an exit) shows nothing, one that reads the opponent's
  // variables or name is `latent`, one that draws from another player is no
  // site - and a header anim an immediate ChangeAnim replaces is never drawn.
  // A site in a state reached only through a computed value is `latent`;
  // 170-189 and a round-over gate are `after-round`; 190-199 is `intro`
  // (shown at round start, common1.cns.zss:446-457 - not a fight); a state
  // only her helpers run is `helper` (Rachel_S action 50007, shown by
  // helper 1001's landing, common2.cns:815-823). Only `played` sites count.
  //
  // KEYS, NOT ACTIONS. One missing sprite key used by twelve actions is one
  // key, and one art group missing from the .sff is one problem however many
  // keys it had (summary.distinct.vanishingGroups; the key list stays). A key is a `placeholder`
  // (hidden) when it is group 9999 - or 34463, the uint16 key a written 99999
  // looks up (anim.go:709) - or when it is missing from more than half of
  // the actions she plays: a character that shows 9999,99 as its whole basic
  // set asked for nothing to be drawn, and the engine draws nothing. An
  // action whose only missing keys are placeholders is not played either: its
  // tier becomes `placeholder` (Shiki_Nanayar 34463,0). Actions labeled group
  // 9000 or an H registry window stay listed with the label and do not count.
  const vanishing = { sff: sprAbs ? showPath(sprAbs) : null, air: animAbs ? showPath(animAbs) : null, actions: [], keys: [] };
  const SITE_RANK = { played: 0, latent: 1, helper: 2, intro: 3, 'after-round': 4 };
  if (air && sprAbs) {
    const nodes = A.sffNodes(sprAbs);
    if (nodes) {
      const sffKeys = A.sffKeysFromNodes(nodes);
      const sites = new Map();
      const site = (n, entry) => { if (!sites.has(n)) sites.set(n, []); sites.get(n).push(entry); };
      for (const s of states.values()) {
        const run = runOf(s.no);
        const who = run.owner ? 'owner' : run.helper ? 'helper' : null;
        if (s.zss || !who) continue;
        const lv = run[who];
        const late = s.no >= 190 && s.no <= 199 ? 'intro' : s.no >= 170 && s.no <= 189 ? 'after-round' : null;
        const tierOf = (lz, sc) => late || (sc && gatedOn(sc, ATOM.round) ? 'after-round' : null)
          || (who === 'helper' ? 'helper' : (lz && lz.latent) || lv < HARD ? 'latent' : 'played');
        const h = parseAnim(s.anim === null ? '' : s.anim);
        const replaced = s.sctrls.some((x) => /^changeanim2?$/.test(x.type) && !x.neverTrue && S.isImmediate(x.trig) && !liveness(x, who).dead);
        if (h.n !== null && (!h.prefix || h.prefix === 's') && !replaced) {
          site(h.n, { file: s.file, line: s.headerLines.get('anim') || s.line, state: s.no, tier: tierOf(null, null) });
        }
        for (const sc of s.sctrls) {
          if (!/^changeanim2?$/.test(sc.type) || !sc.params.has('value')) continue;
          if (['redirectid', 'animplayerno', 'spriteplayerno', 'readplayerid'].some((k) => sc.params.has(k))) continue;
          const v = parseAnim(sc.params.get('value'));
          if (v.n === null || (v.prefix && v.prefix !== 's')) continue;
          // A controller only her helper can fire in a state she runs too
          // (`triggerall = IsHelper`) is the helper's site.
          const r2 = runnersFor(sc, run);
          const w2 = r2.owner ? 'owner' : r2.helper ? 'helper' : who;
          const lz = liveness(sc, w2);
          if (lz.dead) continue;
          const tier = w2 === who ? tierOf(lz, sc) : (late || (gatedOn(sc, ATOM.round) ? 'after-round' : 'helper'));
          site(v.n, { file: sc.file, line: sc.paramLines.get('value') || sc.line, state: s.no, tier });
        }
      }
      const playedActions = new Set();
      for (const [n, list] of sites) if (list.some((x) => x.tier === 'played') && air.actions.has(n)) playedActions.add(n);
      for (const v of A.vanishing(air, sffKeys)) {
        const entry = Object.assign(v, { played: (sites.get(v.action) || []).sort((a, b) => SITE_RANK[a.tier] - SITE_RANK[b.tier]) });
        entry.tier = entry.played.length ? entry.played[0].tier : 'unplayed';
        const fam = modlib.hFamily(v.action);
        if (v.missingKeys.every((k) => k.startsWith('9000,'))) entry.label = 'group 9000';
        else if (modlib.H_FAMILIES.some((f) => f.name === fam) || fam === 'Kuromaru victim standard') entry.label = fam;
        vanishing.actions.push(entry);
      }
      const byKey = new Map();
      for (const a of vanishing.actions) {
        const frames = air.actions.get(a.action).frames;
        for (const k of a.missingKeys) {
          if (!byKey.has(k)) byKey.set(k, { key: k, actions: [], played: false, frames: 0, tier: 'unplayed' });
          const row = byKey.get(k);
          row.actions.push(a.action);
          row.frames += frames.filter((f) => !f.blank && f.g + ',' + f.i === k).length;
        }
      }
      const actionOf = new Map(vanishing.actions.map((a) => [a.action, a]));
      for (const row of byKey.values()) {
        const g = +row.key.split(',')[0];
        const inPlayed = row.actions.filter((n) => actionOf.get(n).tier === 'played').length;
        if (g === 9999 || g === 34463 || inPlayed > playedActions.size / 2) row.tier = 'placeholder';
      }
      for (const a of vanishing.actions) {
        if (a.tier !== 'unplayed' && a.missingKeys.every((k) => byKey.get(k).tier === 'placeholder')) { a.was = a.tier; a.tier = 'placeholder'; }
      }
      for (const row of byKey.values()) {
        if (row.tier !== 'placeholder') {
          const acts = row.actions.map((n) => actionOf.get(n));
          if (acts.some((a) => a.tier === 'played' && !a.label)) { row.tier = 'played'; row.played = true; }
          else if (acts.some((a) => a.tier === 'played')) { row.tier = 'labeled'; row.label = acts.find((a) => a.tier === 'played').label; }
          else {
            const best = acts.map((a) => a.tier).filter((x) => SITE_RANK[x] !== undefined).sort((p, q) => SITE_RANK[p] - SITE_RANK[q])[0];
            row.tier = best || 'unplayed';
          }
        }
        vanishing.keys.push(row);
      }
    }
  }

  // -- duplicate keys ----------------------------------------------------------------
  // Header-only when dups is off (different width/height is still different);
  // the pixel comparison only when asked.
  let duplicates = null;
  if (sprAbs) {
    const airKeys = new Set();
    if (air) for (const a of air.actions.values()) for (const f of a.frames) if (!f.blank) airKeys.add(f.g + ',' + f.i);
    let keys = null;
    try { keys = A.duplicateKeys(sprAbs, { decode: !!o.dups, airKeys }); } catch (e) { keys = null; }
    if (keys) {
      const count = (pred) => keys.reduce((a, k) => a + k.shadows.filter((x) => pred(x.verdict)).length, 0);
      duplicates = { decoded: !!o.dups, keys, different: count((v) => v === 'different'),
        same: count((v) => v === 'same' || v === 'identical-bytes'), undecidable: count((v) => v === 'undecidable' || v === 'unresolved-link') };
    }
  }

  // -- art drawn with no colors (SFF v1) ------------------------------------------------
  // Sprite groups whose every color is black in their own palette AND in pal1,
  // so they draw as black silhouettes whatever is picked (sffaudit.colorless:
  // Bloody Tower's mob art, from a sprite file re-saved without its palettes).
  // Report only - the colors are not in the files - and pixels only when asked,
  // like the duplicate verdicts: the whole-roster sweep runs with dups off.
  let colorless = null;
  if (sprAbs && o.dups) {
    let costume = null;
    const p1 = filesSec.get('pal1');
    const p1Abs = p1 ? resolve(p1) || resolve(p1 + '.act') : null;
    if (p1Abs) { try { costume = require('./public/ikemen/sffdec-core.js').readAct(fs.readFileSync(p1Abs)); } catch (e) { costume = null; } }
    try { colorless = A.colorless(sprAbs, costume); } catch (e) { colorless = null; }
    if (colorless) colorless.costume = p1Abs ? showPath(p1Abs) : null;
  }

  // -- size ---------------------------------------------------------------------------
  const map = new Map();
  vfslib.walkDir(charDir, 'chars/x', map, vfslib.charKeepFilter(charDir, [defName]));
  let shippedBytes = 0;
  for (const abs of map.values()) { try { shippedBytes += fs.statSync(abs).size; } catch (e) { /* vanished */ } }
  const sizeOf = (p) => { try { return p ? fs.statSync(p).size : 0; } catch (e) { return 0; } };
  const mb = +(shippedBytes / 1e6).toFixed(1);
  const size = { shippedBytes, files: map.size, sffBytes: sizeOf(sprAbs), sndBytes: sizeOf(sndAbs), netplay: modlib.netplayVerdict(mb, hs) };

  // -- summary ---------------------------------------------------------------------------
  // The headline counts PROBLEMS, not controllers: seven ChangeStates into
  // one missing state are one missing state, twelve actions showing one
  // missing sprite key are one missing key. The per-tier controller counts
  // stay in byTier.
  const tally = (list) => { const t = {}; for (const e of list) t[e.tier] = (t[e.tier] || 0) + 1; return t; };
  const byTier = { states: tally(stateEntries), anims: tally(animEntries), vanishing: tally(vanishing.actions), vanishingKeys: tally(vanishing.keys) };
  const hidden = {};
  for (const e of [...stateEntries, ...animEntries]) if (HIDDEN_TIERS.has(e.tier)) hidden[e.tier] = (hidden[e.tier] || 0) + 1;
  hidden.unplayed = byTier.vanishing.unplayed || 0;
  hidden.placeholder = byTier.vanishingKeys.placeholder || 0;
  hidden.shadowedStatedefs = parsed.shadowed.length;
  const distinct = (list, tiers) => new Set(list.filter((e) => tiers.includes(e.tier) && e.n !== null).map((e) => e.n)).size;
  const fatal = structure.filter((x) => x.fatal).length;
  const dist = {
    states: distinct(stateEntries, ['freezes', 'freezes-opponent']),
    freezes: distinct(stateEntries, ['freezes']),
    freezesOpponent: distinct(stateEntries, ['freezes-opponent']),
    neverHits: distinct(animEntries, ['never-hits']),
    vanishingKeys: byTier.vanishingKeys.played || 0,
    // One missing art set is one problem: Rachel_S shows 59 keys of a single
    // absent group 50006.
    vanishingGroups: new Set((vanishing.keys || []).filter((k) => k.tier === 'played').map((k) => String(k.key).split(',')[0])).size,
  };
  const headline = load.missing.length + fatal + dist.freezes;
  const worthALook = dist.freezesOpponent + dist.neverHits + dist.vanishingGroups;
  const order = ['freezes', 'freezes-opponent', 'never-hits', 'helper', 'previous-pose', 'projectile-copies', 'explod', 'latent', 'after-ko', 'after-round'];
  const rank = (e) => { const i = order.indexOf(e.tier); return i < 0 ? 99 : i; };
  const sortE = (a, b) => rank(a) - rank(b) || String(a.file).localeCompare(String(b.file)) || a.line - b.line;
  const keep = (e) => o.allTiers || !HIDDEN_TIERS.has(e.tier);

  return {
    def: defName,
    role: { giver: !!hs.giver, receiver },
    load,
    structure,
    states: stateEntries.filter(keep).sort(sortE),
    anims: animEntries.filter(keep).sort(sortE),
    vanishing,
    duplicates,
    colorless,
    size,
    summary: {
      headline,
      worthALook,
      // controller counts per headline tier
      freezes: byTier.states.freezes || 0,
      freezesOpponent: byTier.states['freezes-opponent'] || 0,
      neverHits: byTier.anims['never-hits'] || 0,
      // distinct played missing sprite keys (what the headline counts)
      playedVanishing: dist.vanishingKeys,
      distinct: dist,
      differentArt: duplicates ? duplicates.different : null,
      // sprite groups drawn with no colors; not counted in the headline or worth-a-look
      colorlessGroups: colorless ? colorless.groups.length : null,
      byTier, hidden,
      reached: { live: reach.live.size, soft: reach.soft.size, states: states.size },
    },
  };
}

module.exports = { contentAuditIn, HIDDEN_TIERS, WORTH_A_LOOK_TIERS };
