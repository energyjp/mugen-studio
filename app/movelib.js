'use strict';
// THE MOVE INSPECTOR'S READ MODEL, AND THE ONE WAY A MOVE VALUE IS WRITTEN.
//
// STUDIO-ADVANCED.md §1-§4, §8, §11, §12 are the design; every rule below is
// re-checked against the engine source at 96413d2 and cites that commit.
//
// What an "attack" is, in the engine's own terms: there is no attack object.
// A state holds controllers; five controller types share one parameter parser,
// `hitDefSub` (compiler_functions.go:1706, called from HitDef 2281,
// ModifyHitDef 2292, ReversalDef 2326, ModifyReversalDef 2358, Projectile
// 2481). Those five are ATTACK BLOCKS here. The only stable address of one is
//
//     { file, state, ordinal }
//
// - the state file it is written in, its [Statedef] number, and its position
// among the attack blocks of that statedef, counted from 0 in file order. The
// compiler walks `[state ` blocks in file order and appends them in that
// order (compiler.go:6810, 6860), so file ordinal is runtime ordinal. The
// `[State x, label]` text is never parsed as a number and ID is a chain-cancel
// tag, so neither is ever used as a key.
//
// Values are TEXT, not numbers: every parameter compiles to an expression
// evaluated per frame. So a value is shown in one of three tiers (§3):
//   green  a plain numeric literal - edited by replacing that token;
//   amber  the CvS damage template, `ceil(ifElse(fvar(N) * B < M, M,
//          fvar(N) * B))` - the base literal B is the edit, and it is written
//          in BOTH places it appears so the expression stays consistent;
//   red    anything else, shown verbatim and never written.
//
// Writes go through charedit.writeSpliced: an in-place byte splice of exactly
// the token, one pristine backup per file, and a validate step that re-parses
// the new text with the same scanner (scenelib.parseStates) and refuses the
// write unless the statedefs, the controllers, the attack blocks and every
// other parameter read exactly as before (§11: the engine fails silently in
// at least six ways, so the Studio checks instead).
//
// Text is latin1 in and latin1 out: one char per byte, so every offset in the
// model is a BYTE offset into the file as it is on disk.
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const path = require('path');
const S = require('./scenelib.js');
const X = require('./cnsexpr.js');
const FD = require('./framedata.js');
const charedit = require('./charedit.js');
const { airTimeline, airTotals } = require('./public/ikemen/animview-core.js');

// modlib and enginedata are loaded on first use: modlib is the module that
// will wrap this one for the server, and a top-level require in both
// directions would hand one of them a half-built exports object.
let modlibMod = null, engineMod = null;
const modlib = () => modlibMod || (modlibMod = require('./modlib.js'));
let airLibMod = null;
const airLib = () => airLibMod || (airLibMod = require('./airedit.js'));
const engine = () => engineMod || (engineMod = require('./enginedata.js'));

// ---- the parameter table ---------------------------------------------------------
// GENERATED FROM THE KEY STRINGS of hitDefSub and the four wrappers around it
// at 96413d2 (compiler_functions.go:1706-2273 hitDefSub, 1436-1537 palFXSub
// "palfx.", 2275-2361 the HitDef/ModifyHitDef/ReversalDef/ModifyReversalDef
// wrappers, 2363-2556 projectileSub with afterImageSub "afterimage."), NOT
// from the bytecode enum: `fall.envshake.diradd` / `.decay` exist in the enum
// and have no parser (§7), so an enum-driven list would offer dead fields.
// tools/test-movelib.js re-extracts this table from the Go source whenever the
// checkout is present and fails on any drift.
//
// Code: kind letter + component count (the numArg the engine passes to
// paramValue / scAdd / exprs, i.e. how many comma-separated expressions it
// reads), then flags:
//   i int (VT_Int), f float (VT_Float), b bool (VT_Bool), s string/flag
//   p  the first component may carry a sound/spark/anim table prefix (`S5`,
//      `F100`) through getDataPrefix (compiler.go:6071-6121)
//   x  the SECOND component is a word (`priority = 4, Hit`, 1840-1863)
//   n  a component may be the letter `n` (ground.velocity, 2073-2125)
// A trailing type list limits the key to those controller types.
const PARAM_CODES = {
  'redirectid': 'i1', 'attr': 's1', 'guardflag': 's1', 'hitflag': 's1', 'ground.type': 's1', 'air.type': 's1',
  'animtype': 's1', 'air.animtype': 's1', 'fall.animtype': 's1', 'affectteam': 's1', 'teamside': 'i1', 'id': 'i1',
  'chainid': 'i1', 'nochainid': 'i8', 'kill': 'b1', 'guard.kill': 'b1', 'fall.kill': 'b1', 'keepstate': 'b1',
  'hitonce': 'b1', 'air.juggle': 'i1', 'getpower': 'i2', 'damage': 'i2', 'givepower': 'i2', 'numhits': 'i1',
  'hitsound': 'i2p', 'hitsound.channel': 'i1', 'guardsound': 'i2p', 'guardsound.channel': 'i1', 'priority': 'i2x',
  'p1stateno': 'i1', 'p2stateno': 'i1', 'p2getp1state': 'b1', 'missonoverride': 'b1', 'p1sprpriority': 'i1',
  'sprpriority': 'i1', 'p2sprpriority': 'i1', 'forcestand': 'b1', 'forcecrouch': 'b1', 'forcenofall': 'b1',
  'fall.damage': 'i1', 'fall.xvelocity': 'f1', 'fall.yvelocity': 'f1', 'fall.zvelocity': 'f1', 'fall.recover': 'b1',
  'fall.recovertime': 'i1', 'sparkno': 'i1p', 'sparkangle': 'f1', 'guard.sparkno': 'i1p', 'guard.sparkangle': 'f1',
  'sparkxy': 'f2', 'down.hittime': 'i1', 'p1facing': 'i1', 'p1getp2facing': 'i1', 'mindist': 'f3', 'maxdist': 'f3',
  'snap': 'f4', 'p2facing': 'i1', 'air.hittime': 'i1', 'fall': 'b1', 'air.fall': 'b1', 'air.cornerpush.veloff': 'f1',
  'down.bounce': 'b1', 'down.velocity': 'f3', 'down.cornerpush.veloff': 'f1', 'ground.hittime': 'i1',
  'guard.hittime': 'i1', 'guard.dist': 'i2', 'guard.dist.width': 'i2', 'guard.dist.height': 'i2',
  'guard.dist.depth': 'i2', 'pausetime': 'i2', 'guard.pausetime': 'i2', 'air.velocity': 'f3',
  'airguard.velocity': 'f3', 'ground.slidetime': 'i1', 'guard.slidetime': 'i1', 'guard.ctrltime': 'i1',
  'airguard.ctrltime': 'i1', 'ground.velocity': 'f3n', 'guard.velocity': 'f3', 'ground.cornerpush.veloff': 'f1',
  'guard.cornerpush.veloff': 'f1', 'airguard.cornerpush.veloff': 'f1', 'xaccel': 'f1', 'yaccel': 'f1', 'zaccel': 'f1',
  'palfx.time': 'i1', 'palfx.color': 'f1', 'palfx.hue': 'f1', 'palfx.add': 'i3', 'palfx.mul': 'i3',
  'palfx.sinadd': 'i4', 'palfx.sinmul': 'i4', 'palfx.sincolor': 'i2', 'palfx.sinhue': 'i2', 'palfx.invertall': 'b1',
  'palfx.invertblend': 'i1', 'envshake.time': 'i1', 'envshake.ampl': 'i1', 'envshake.freq': 'f1',
  'envshake.phase': 'f1', 'envshake.mul': 'f1', 'envshake.dir': 'f1', 'envshake.diradd': 'f1', 'envshake.decay': 'f1',
  'fall.envshake.time': 'i1', 'fall.envshake.ampl': 'i1', 'fall.envshake.freq': 'f1', 'fall.envshake.phase': 'f1',
  'fall.envshake.mul': 'f1', 'fall.envshake.dir': 'f1', 'dizzypoints': 'i1', 'guardpoints': 'i1', 'redlife': 'i2',
  'score': 'f2', 'p2clsncheck': 's1', 'p2clsnrequire': 's1', 'down.recover': 'b1', 'down.recovertime': 'i1',
  'attack.depth': 'f2', 'sparkscale': 'f2', 'guard.sparkscale': 'f2', 'unhittabletime': 'i2', 'stand.friction': 'f1',
  'crouch.friction': 'f1', 'ignorereversaldef': 'b1',
  'reversal.attr': 's1 reversaldef|modifyreversaldef', 'reversal.guardflag': 's1 reversaldef|modifyreversaldef',
  'reversal.guardflag.not': 's1 reversaldef|modifyreversaldef',
  'postype': 's1 projectile', 'projid': 'i1 projectile', 'projremove': 'b1 projectile',
  'projremovetime': 'i1 projectile', 'projshadow': 'i3 projectile', 'projreflection': 'i1 projectile',
  'projmisstime': 'i1 projectile', 'projhits': 'i1 projectile', 'projpriority': 'i1 projectile',
  'projhitanim': 'i1p projectile', 'projremanim': 'i1p projectile', 'projcancelanim': 'i1p projectile',
  'velocity': 'f3 projectile', 'velmul': 'f3 projectile', 'remvelocity': 'f3 projectile', 'accel': 'f3 projectile',
  'projscale': 'f2 projectile', 'projangle': 'f1 projectile', 'projxangle': 'f1 projectile',
  'projyangle': 'f1 projectile', 'projclsnscale': 'f2 projectile', 'projclsnangle': 'f1 projectile',
  'projwindow': 'f4 projectile', 'projxshear': 'f1 projectile', 'projfocallength': 'f1 projectile',
  'projprojection': 's1 projectile', 'offset': 'f3 projectile', 'projsprpriority': 'i1 projectile',
  'projlayerno': 'i1 projectile', 'projstagebound': 'i1 projectile', 'projedgebound': 'i1 projectile',
  'projheightbound': 'i2 projectile', 'projdepthbound': 'i1 projectile', 'projanim': 'i1p projectile',
  'supermovetime': 'i1 projectile', 'pausemovetime': 'i1 projectile', 'ownpal': 'b1 projectile',
  'remappal': 'i2 projectile', 'afterimage.time': 'i1 projectile', 'afterimage.length': 'i1 projectile',
  'afterimage.timegap': 'i1 projectile', 'afterimage.framegap': 'i1 projectile',
  'afterimage.palcolor': 'i1 projectile', 'afterimage.palhue': 'i1 projectile',
  'afterimage.palinvertall': 'b1 projectile', 'afterimage.palinvertblend': 'i1 projectile',
  'afterimage.palbright': 'i3 projectile', 'afterimage.palcontrast': 'i3 projectile',
  'afterimage.palpostbright': 'i3 projectile', 'afterimage.paladd': 'i3 projectile',
  'afterimage.palmul': 'f3 projectile', 'afterimage.ignorehitpause': 'b1 projectile',
  'shadertime': 'i1 projectile', 'shader': 's1 projectile',
};
// Every controller also takes these two keywords (stateSec skips them as
// known, compiler.go:6036-6040; StateBytecode reads them per controller).
const KEYWORD_CODES = { persistent: 'i1', ignorehitpause: 'b1' };
const KIND = { i: 'int', f: 'float', b: 'bool', s: 'string' };
function decodeCode(code) {
  const [c, types] = code.split(' ');
  const m = /^([ifbs])(\d+)([pxn]*)$/.exec(c);
  return {
    kind: KIND[m[1]], n: +m[2], prefix: m[3].includes('p'), secondWord: m[3].includes('x'), letterN: m[3].includes('n'),
    only: types ? new Set(types.split('|')) : null,
  };
}
const PARAMS = new Map(Object.entries(PARAM_CODES).map(([k, v]) => [k, decodeCode(v)]));
const KEYWORDS = new Map(Object.entries(KEYWORD_CODES).map(([k, v]) => [k, decodeCode(v)]));
const ATTACK_TYPES = ['hitdef', 'modifyhitdef', 'reversaldef', 'modifyreversaldef', 'projectile'];
const ATTACK_SET = new Set(ATTACK_TYPES);
const TYPE_NAMES = { hitdef: 'HitDef', modifyhitdef: 'ModifyHitDef', reversaldef: 'ReversalDef', modifyreversaldef: 'ModifyReversalDef', projectile: 'Projectile' };
// finalizeParams resolves the derived defaults for these three only: HitDef
// (bytecode.go:7997), ReversalDef (8035) and Projectile (8333). ModifyHitDef
// (8366-8384) and ModifyReversalDef (8396-) overwrite the live HitDef and skip
// it, so nothing is derived for them (§5).
const FINALIZED = new Set(['hitdef', 'reversaldef', 'projectile']);

function paramSpec(type, name) {
  const p = PARAMS.get(name) || KEYWORDS.get(name) || null;
  if (!p) return null;
  if (p.only && !p.only.has(type)) return null;
  return p;
}

// ---- risk notes (§12) -----------------------------------------------------------------
// level: safe | careful | dangerous. A dangerous param is refused by
// editMoveValue unless the caller passes confirm: true - the UI's explicit
// confirm is the gate, this is the backstop.
const NONNEG = new Set(['damage', 'pausetime', 'guard.pausetime', 'ground.hittime', 'air.hittime', 'guard.hittime',
  'down.hittime', 'ground.slidetime', 'guard.slidetime', 'guard.ctrltime', 'airguard.ctrltime', 'fall.recovertime',
  'fall.damage', 'numhits', 'dizzypoints', 'guardpoints']);
function riskOf(name, ikemenVersion) {
  const r = (level, notes) => ({ level, notes });
  switch (name) {
    case 'damage': return r('careful', [
      'damage 0 still hits: hit pause, hitstun and the hit state all happen - blank attr to disable a move (char.go:10741)',
      'dizzypoints, guardpoints, redlife and power gain derive from HIT damage unless the block sets them (char.go:935-963)',
      'guardpoints derives from hit damage, not guard damage (char.go:943, 956)',
      'negative damage heals the opponent: refused',
    ]);
    case 'id': case 'chainid': case 'nochainid': return r('dangerous', ['ID is a chain-cancel group tag: changing it rewires which moves can combo into which (§2, §12)']);
    case 'p1stateno': return r('dangerous', ['sends the attacker to another state on hit']);
    case 'p2stateno': return r('dangerous', ['sends the opponent to another state on hit, and implicitly sets p2getp1state = 1 (bytecode.go:7664-7666): the opponent runs THIS character\'s state file']);
    case 'pausetime': case 'guard.pausetime': return r('careful', ['hit pause for attacker, shake for the opponent; guard.pausetime defaults to pausetime (char.go:875-876)']);
    case 'ground.slidetime': return r('careful', ikemenVersion ? ['guard.slidetime defaults to guard.hittime (char.go:887)'] : ['for this MUGEN character guard.hittime defaults to ground.slidetime (char.go:880-887)']);
    case 'ground.hittime': return r('careful', ikemenVersion ? ['for this Ikemen character guard.hittime defaults to ground.hittime (char.go:882-887)'] : []);
    case 'air.juggle': return r('careful', ['juggle cost of a normal move lives on the [Statedef] header (compiler.go:6669); air.juggle on a HitDef applies to projectiles unless the character declares ikemenversion (§7)']);
    case 'sprpriority': return r('careful', ['DOS-MUGEN alias, read only when p1sprpriority is absent (compiler_functions.go:1881-1893)']);
    case 'fall.damage': return r('careful', ['applied through lifeAdd, bypassing the attacker\'s attack multiplier (char.go:9372)']);
    case 'dizzypoints': case 'guardpoints': return r('careful', ['setting it pins the value: it no longer follows damage']);
    case 'getpower': case 'givepower': case 'redlife': return r('careful', ['setting it pins the value: it no longer follows damage']);
    default: return r('safe', []);
  }
}

// ---- text helpers --------------------------------------------------------------------
const NUM_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)$/;
const asciiTrim = (s) => s.replace(/^[ \t\v\f\r\n]+|[ \t\v\f\r\n]+$/g, '');
// Wherever a line is classified as a bracket or a parameter, the trim is Go's
// TrimSpace as scenelib transcribes it: a UTF-8 full-width space (U+3000)
// before `[State` is trimmed by the engine too, so the controller ends there.
const trimGo = S.trimGo;
function lineStarts(text) {
  const out = [0];
  for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) out.push(i + 1);
  return out;
}
const lineText = (text, starts, no) => text.slice(starts[no - 1], no < starts.length ? starts[no] - 1 : text.length).replace(/\r$/, '');
const noCommentLine = (s) => { const k = s.indexOf(';'); return trimGo(k < 0 ? s : s.slice(0, k)); };

// Components of a parameter value, split where the engine's expression
// reader stops at a top-level `,` (argExpression, compiler.go:5799-5816):
// commas inside parentheses or brackets are an expression's own, and a
// quoted string is one token. Offsets are relative to the value.
function splitComponents(val) {
  const out = [];
  let depth = 0, quote = false, from = 0;
  const push = (to) => {
    const piece = val.slice(from, to);
    const lead = piece.length - piece.replace(/^[ \t]+/, '').length;
    const t = asciiTrim(piece);
    out.push({ raw: t, start: from + lead, end: from + lead + t.length });
  };
  for (let i = 0; i < val.length; i++) {
    const c = val[i];
    if (quote) { if (c === '"') quote = false; continue; }
    if (c === '"') quote = true;
    else if (c === '(' || c === '[') depth++;
    else if ((c === ')' || c === ']') && depth > 0) depth--;
    else if (c === ',' && depth === 0) { push(i); from = i + 1; }
  }
  push(val.length);
  return out;
}

// The CvS damage template (§3). Case and whitespace insensitive; the fvar
// index must match in both halves, the base B must be the same literal text
// in both places and the floor M the same in both - anything else is an
// author's own formula and stays red.
const LIT = '([+-]?(?:\\d+\\.?\\d*|\\.\\d+))';
const AMBER_RE = new RegExp('^ceil\\s*\\(\\s*ifelse\\s*\\(\\s*fvar\\s*\\(\\s*(\\d+)\\s*\\)\\s*\\*\\s*' + LIT + '\\s*<\\s*' + LIT
  + '\\s*,\\s*' + LIT + '\\s*,\\s*fvar\\s*\\(\\s*(\\d+)\\s*\\)\\s*\\*\\s*' + LIT + '\\s*\\)\\s*\\)$', 'id');
function amberSpans(raw) {
  const m = AMBER_RE.exec(raw);
  if (!m) return null;
  if (+m[1] !== +m[5] || m[2] !== m[6] || m[3] !== m[4]) return null;
  return { base: m[2], floor: m[3], fvar: +m[1], spans: [m.indices[2], m.indices[6]].map(([a, b]) => ({ start: a, end: b })) };
}

// ---- def, constants --------------------------------------------------------------------
// IniSection.Parse (common.go:1002-1022): a section runs to the next line that
// starts with `[`, a key is the text before the first `=`, space or tab,
// lowercased, and its FIRST value wins. Only the first section of a name is
// read by the character loader (char.go:3845-4229 flag per section).
function iniSection(text, want) {
  const lines = String(text).split('\n');
  for (let i = 0; i < lines.length; i++) {
    const ln = noCommentLine(lines[i]);
    const m = /^\[\s*([^\]]*?)\s*\]$/.exec(ln);
    if (!m || m[1].toLowerCase() !== want) continue;
    const out = new Map();
    for (i++; i < lines.length; i++) {
      const raw = trimGo(lines[i]);
      if (raw[0] === '[') break;
      const l = noCommentLine(raw);
      const ia = l.search(/[= \t]/);
      if (ia <= 0) continue;
      const key = l.slice(0, ia).toLowerCase();
      const eq = l.indexOf('=');
      const val = eq >= 0 ? trimGo(l.slice(eq + 1)).replace(/^"|"$/g, '') : '';
      if (!out.has(key)) out.set(key, val);
    }
    return out;
  }
  return new Map();
}
// Atof of the first number in a value, NaN when there is none.
const atofFirst = (v) => { const m = /^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)/i.exec(String(v === undefined ? '' : v)); return m ? parseFloat(m[1]) : NaN; };

// Where a [Files] name is looked for: the def's own directory, the character
// folder, a `chars/<folder>/x` path back in the folder, a `../../data/<pack>/x`
// path in this bundle's screenpack (modlib.themeFileFor), then the engine root,
// the motif's folder and data/ (stateCompile dirs, compiler.go 8346-8366) - the
// same order the content audit uses. The .zss retry is scenelib.stateFiles' own.
function makeResolve(charDir, defName, engineDir) {
  const defDir = path.posix.dirname(String(defName).replace(/\\/g, '/'));
  const inDef = (r) => (defDir === '.' ? r : defDir + '/' + r).replace(/^\.\//, '');
  const mdir = modlib().motifDir();
  return (r) => {
    const v = String(r || '').replace(/\\/g, '/').trim();
    if (!v) return null;
    const m = /^chars\/[^/]+\/(.+)$/i.exec(v);
    const ci = modlib().resolveCI;
    return ci(charDir, inDef(v)) || ci(charDir, v) || (m && ci(charDir, m[1])) || modlib().themeFileFor(defName, v)
      || (engineDir && ci(engineDir, v)) || (mdir && ci(mdir, v)) || (engineDir && ci(path.join(engineDir, 'data'), v)) || null;
  };
}

// The multipliers finalizeParams reads, in the order the loader writes them:
// initConstants' literals (char.go:8012-8022), then data/common.const through
// [Common] Const (char.go:3966-3984, keys lowercased, first wins), then the
// character's own first [Constants] section of its cns file (char.go:4224-4229).
// ikemenversion does not change any of these; it changes guard.hittime's
// fallback (char.go:880-884).
const INIT_CONSTANTS = {
  'default.attack.lifetopowermul': 0.7, 'super.attack.lifetopowermul': 0,
  'default.gethit.lifetopowermul': 0.6, 'super.gethit.lifetopowermul': 0.6,
  'default.lifetoguardpointsmul': 1.5, 'super.lifetoguardpointsmul': -0.33,
  'default.lifetodizzypointsmul': 1.8, 'super.lifetodizzypointsmul': 0,
  'default.lifetoredlifemul': 0.75, 'super.lifetoredlifemul': 0.75,
};
function multipliers(charConstants) {
  const out = {};
  let common = new Map();
  try { common = engine().consts(); } catch (e) { common = new Map(); }
  for (const k of Object.keys(INIT_CONSTANTS)) {
    let v = INIT_CONSTANTS[k], src = 'engine default (char.go:8012-8022)';
    if (common.has(k) && Number.isFinite(common.get(k))) { v = common.get(k); src = 'data/common.const'; }
    if (charConstants && charConstants.has(k) && Number.isFinite(atofFirst(charConstants.get(k)))) { v = atofFirst(charConstants.get(k)); src = 'character [Constants]'; }
    out[k] = { value: v, source: src };
  }
  return out;
}

// ---- the .air, per element ------------------------------------------------------------------
// A transcription of ReadAnimation / ReadAction / readAction /
// resolveCopyAction (anim.go:292-455, 457-480, 1194-1233, 1261-1297), keeping
// what sffaudit.airTable drops: each element's own Clsn1/Clsn2 boxes and where
// they came from. The binding rules, verified at 96413d2:
//   - a `Clsn1:` / `Clsn1Default:` header makes a new box list and sets def1
//     false; `Default` also makes it the default list (anim.go:356-386);
//   - a frame line takes the default list when no header came since the last
//     frame (def1 still true), else the list the header made; then def1 and
//     def2 are set true again (anim.go:330-342). So a `Clsn1:` block binds to
//     the element that FOLLOWS it, and only that one; a Default persists;
//   - the box count is the header's number: `make([][4]float32, size)`, and a
//     box line that is missing leaves a zero box that still counts
//     (anim.go:366-424);
//   - box lines are consumed by the header (anim.go:388-424) and an
//     element line needs at least 5 comma fields starting with a digit or `-`
//     (anim.go:45-60);
//   - first definition of an action wins, an empty action becomes the next
//     action, Copy Action resolves over 8 hops or deletes the action.
// Element numbers are 1-based = what AnimElem counts; an element of time 0
// still takes a number (AnimElemTime sums Max(0, time), anim.go:507-520).
function airModel(text) {
  let s = String(text == null ? '' : text);
  if (s.charCodeAt(0) === 0xef && s.charCodeAt(1) === 0xbb && s.charCodeAt(2) === 0xbf) s = s.slice(3);
  const lines = s.split('\n').map(asciiTrim);
  const sectionName = (line) => {
    if (!line.length || line[0] !== '[') return null;
    const sec = asciiTrim(line.split(';')[0]);
    if (sec[sec.length - 1] !== ']') return null;
    const body = sec.slice(1, sec.indexOf(']'));
    const sp = body.indexOf(' ');
    return sp >= 0 ? { name: body.slice(0, sp + 1).toLowerCase(), sub: body.slice(sp + 1) } : { name: body.toLowerCase(), sub: '' };
  };
  const anims = new Map();
  const duplicates = [];
  let i = 0;
  const readOne = () => {
    let sec = null;
    for (; i < lines.length; i++) { sec = sectionName(lines[i]); if (sec && sec.name.length) break; }
    if (i >= lines.length) return null;
    if (sec.name !== 'begin ') return null;
    const spi = sec.sub.indexOf(' ');
    if (spi < 0 || sec.sub.slice(0, spi + 1).toLowerCase() !== 'action ') return null;
    const a = { line: i + 1, frames: [], copyAction: -1, loopstart: 0, src: null };
    const no = atoiGo(sec.sub.slice(spi + 1));
    i++;
    let c1 = null, c1d = null, c2 = null, c2d = null, c1src = 'none', c2src = 'none', def1 = true, def2 = true;
    let c1dLine = 0, c2dLine = 0, c1Line = 0, c2Line = 0, ols = 0;
    for (; i < lines.length; i++) {
      if (lines[i].length && lines[i][0] === '[') break;
      const line = asciiTrim(lines[i].split(';')[0]).toLowerCase();
      if (line.length >= 12 && line.slice(0, 12) === 'copy action ') {
        const numStr = asciiTrim(line.slice(12));
        const id = /^[+-]?\d+$/.test(numStr) ? Number(numStr) : NaN;
        a.copyAction = Number.isFinite(id) && id >= -2147483648 && id <= 2147483647 ? id : -1;
        a.copyWritten = a.copyAction;
        return { no, a };
      }
      const c0 = line.charCodeAt(0);
      if (line.length && ((c0 >= 48 && c0 <= 57) || line[0] === '-') && line.split(',').length >= 5) {
        const f = line.split(',').slice(0, 10).map(asciiTrim);
        ols = a.loopstart;
        if (def1) { c1 = c1d; c1src = c1d ? 'default' : 'none'; c1Line = c1dLine; }
        if (def2) { c2 = c2d; c2src = c2d ? 'default' : 'none'; c2Line = c2dLine; }
        a.frames.push({
          group: atoiGo(f[0]), number: atoiGo(f[1]), time: atoiGo(f[4]), line: i + 1,
          clsn1: c1 ? c1.map((b) => b.slice()) : [], clsn2: c2 ? c2.map((b) => b.slice()) : [],
          clsn1Source: c1 ? c1src : 'none', clsn2Source: c2 ? c2src : 'none', clsn1Line: c1 ? c1Line : null, clsn2Line: c2 ? c2Line : null,
        });
        def1 = true; def2 = true;
        continue;
      }
      if (line.length >= 9 && line.slice(0, 9) === 'loopstart') { a.loopstart = a.frames.length; continue; }
      if (line.length >= 5 && line.slice(0, 4) === 'clsn') {
        const ii = line.indexOf(':');
        if (ii < 0) continue;
        const size = atoiGo(line.slice(ii + 1));
        if (size < 0) continue;
        const which = line[4];
        if (which !== '1' && which !== '2') continue;
        const isDef = line.length >= 12 && line.slice(5, 12) === 'default';
        const boxes = [];
        for (let k = 0; k < size; k++) boxes.push([0, 0, 0, 0]);
        if (which === '1') { c1 = boxes; c1src = isDef ? 'default' : 'own'; c1Line = i + 1; if (isDef) { c1d = boxes; c1dLine = i + 1; } def1 = false; }
        else { c2 = boxes; c2src = isDef ? 'default' : 'own'; c2Line = i + 1; if (isDef) { c2d = boxes; c2dLine = i + 1; } def2 = false; }
        if (size === 0) continue;
        i++;
        for (let n = 0; n < size && i < lines.length;) {
          const bl = asciiTrim(lines[i].split(';')[0]).toLowerCase();
          if (!bl.length) { i++; continue; }
          if (bl.length < 4 || bl.slice(0, 4) !== 'clsn') break;
          const eq = bl.indexOf('=');
          if (eq < 0) break;
          const ary = bl.slice(eq + 1).split(',');
          if (ary.length < 4) break;
          let l = atoiGo(ary[0]), t = atoiGo(ary[1]), r = atoiGo(ary[2]), b = atoiGo(ary[3]);
          if (l > r) [l, r] = [r, l];
          if (t > b) [t, b] = [b, t];
          boxes[n][0] = l; boxes[n][1] = t; boxes[n][2] = r; boxes[n][3] = b;
          n++; i++;
        }
        i--;
      }
    }
    if (a.loopstart >= a.frames.length) a.loopstart = ols;
    return { no, a };
  };
  const readAction = () => {
    while (i < lines.length) {
      const r = readOne();
      if (r) {
        const existing = anims.get(r.no);
        if (existing) { duplicates.push({ no: r.no, line: r.a.line, firstLine: existing.line }); return existing; }
        while (r.a.frames.length === 0 && i < lines.length && r.a.copyAction < 0) {
          const a2 = readAction();
          if (a2) { const line = r.a.line; Object.assign(r.a, a2); r.a.line = line; r.a.emptyTook = a2.src; break; }
          i++;
        }
        if (r.a.src === null) r.a.src = r.no;
        anims.set(r.no, r.a);
        return r.a;
      }
      i++;
    }
    return null;
  };
  while (readAction()) { /* every action */ }
  const deleted = [];
  for (const [no, a] of anims) {
    for (let loops = 0; a.copyAction >= 0 && loops < 8; loops++) {
      const target = anims.get(a.copyAction);
      if (!target || target === a) break;
      if (target.copyAction >= 0) { a.copyAction = target.copyAction; continue; }
      const line = a.line, written = a.copyWritten;
      Object.assign(a, target, { line, copyWritten: written, copyOf: target.src, copyAction: -1 });
      break;
    }
    if (a.copyAction >= 0) deleted.push({ no, line: a.line, target: a.copyWritten });
  }
  const actions = new Map();
  for (const [no, a] of anims) {
    if (a.copyAction >= 0) continue;
    let t = 0;
    const frames = a.frames.map((f, k) => { const e = Object.assign({ elem: k + 1, start: t }, f); t += Math.max(0, f.time); return e; });
    // What the engine shows, from its own timeline with this Loopstart
    // (airTimeline: anim.go:428-452, 638-721, 802-846): an element is hidden
    // when no tick draws it with a sprite loaded, it holds when the engine
    // stops on it, and `ticks` is the engine's totaltime. `start` stays the
    // AnimElemTime clock (the sum of Max(0, time) before it, anim.go:507-520).
    const times = frames.map((f) => f.time);
    const tl = airTimeline(times, a.loopstart);
    const shown = new Set(tl.runs.filter((r) => r.spr >= 0).map((r) => r.elem));
    const holdAt = tl.hold && tl.runs.length ? tl.runs[tl.runs.length - 1].elem : -1;
    frames.forEach((f, k) => { f.neverDisplayed = !shown.has(k); f.holds = k === holdAt; });
    actions.set(no, { no, line: a.line, frames, loopStart: a.loopstart, copyOf: a.src !== no ? a.src : undefined, endless: frames.length > 0 && tl.hold, holdsOn: holdAt >= 0 ? holdAt + 1 : null, ticks: frames.length ? airTotals(times, a.loopstart).totaltime : 0 });
  }
  return { actions, duplicates, deleted };
}
// Go's Atoi (common.go:212-241).
function atoiGo(str) {
  const s = asciiTrim(String(str));
  if (!s) return 0;
  const a = s[0] === '-' || s[0] === '+' ? s.slice(1) : s;
  let n = 0;
  for (let k = 0; k < a.length; k++) {
    const c = a.charCodeAt(k);
    if (c < 48 || c > 57) break;
    n = n * 10 + (c - 48);
    if (n > 2147483647) return s[0] === '-' ? -2147483648 : 2147483647;
  }
  return s[0] === '-' ? -n : n;
}

// ---- animation references -----------------------------------------------------------------
// `anim = 200`, `S200` (her own table), `F200` (another table, getDataPrefix),
// or an expression. For an expression every candidate is shown (STUDIO-ADVANCED
// section 8 step 1), found in this order:
//   ifelse/cond over literals only (`ifelse(p2bodydist x <= 30, 212, 210)`):
//     its leaves (cnsexpr.leavesOf), complete - exact: true;
//   otherwise the values cnsexpr.valueSet lists with each variable over the
//     literals the files assign it, 0 included (`1600 + var(10)` with var(10)
//     set to 1 and 2 -> 1600, 1601, 1602) - from: 'domains', exact: false,
//     since a VarAdd can reach a count no literal shows;
//   otherwise, when the whole value is an ifelse, its literal leaves;
//   otherwise none, unresolved: true. A bare leaf of an arithmetic value
//     (the 0 inside `1600 + ifelse(var(10) = 0, 0, var(10) - 1)`) is never
//     offered on its own: it is not an animation number.
const CANDIDATE_CAP = 32;
function animRef(raw, domains) {
  const r = String(raw === undefined || raw === null ? '' : raw).trim();
  if (/^s?\s*-?\d+$/i.test(r)) return { raw: r, literal: true, candidates: [parseInt(r.replace(/^s\s*/i, ''), 10)], exact: true };
  if (/^[a-z]+\s*-?\d+$/i.test(r)) return { raw: r, literal: false, foreign: true, candidates: [], exact: true };
  let node = null;
  try { const t = X.tokenize(r); node = t && t.length ? X.parse(t) : null; } catch (e) { node = null; }
  const leafOnly = (n) => (n.t === 'num' ? true : n.t === 'neg' && n.a.t === 'num' ? true : n.t === 'ifelse' ? leafOnly(n.a) && leafOnly(n.b) : false);
  if (node && node.t === 'ifelse' && leafOnly(node)) return { raw: r, literal: false, candidates: X.leavesOf(r).filter((v) => Number.isInteger(v)), exact: true, from: 'leaves' };
  let vals = null;
  try {
    const dom = (name) => (domains && domains[name] ? [...new Set([0, ...domains[name]])] : null);
    vals = X.valueSet(r, dom);
  } catch (e) { vals = null; }
  if (vals && vals.length && vals.length <= CANDIDATE_CAP && vals.every((v) => Number.isInteger(v))) return { raw: r, literal: false, candidates: vals, exact: X.varsOf(r).length === 0 && !X.usesRandom(r), from: 'domains' };
  if (node && node.t === 'ifelse') {
    const c = X.leavesOf(r).filter((v) => Number.isInteger(v));
    if (c.length) return { raw: r, literal: false, candidates: c, exact: false, from: 'leaves' };
  }
  return { raw: r, literal: false, candidates: [], exact: false, unresolved: true };
}

// ---- triggers and firing ----------------------------------------------------------------------
// FIRING (§8): the tick an attack block runs, when a trigger says it
// statically. `AnimElem = N` compiles to AnimElemTime(N) compared with 0
// (compiler.go:3999-4018, parseOldAnimElemStyle 1254-1269; `, = 0` is the
// explicit form of the same). AnimElemTime(N) = curtime - the sum of Max(0,
// time) of the elements before N (anim.go:507-520), so it fires at element
// N's cumulative start tick. `Time = T` / `!Time` fire on state tick T. A
// group with any other condition, or with `||`, is conditional: its text is
// shown and any AnimElem atom in it is still reported.
function peel(t) {
  for (;;) {
    if (t[0] !== '(' || t[t.length - 1] !== ')') return t;
    let depth = 0;
    for (let i = 0; i < t.length; i++) {
      if (t[i] === '(') depth++;
      else if (t[i] === ')') { depth--; if (depth === 0 && i < t.length - 1) return t; }
    }
    t = t.slice(1, -1);
  }
}
function splitAnd(line) {
  const s = peel(String(line).replace(/\s+/g, '').toLowerCase());
  const out = [];
  let depth = 0, from = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '(' || s[i] === '[') depth++;
    else if (s[i] === ')' || s[i] === ']') depth--;
    else if (depth === 0 && s[i] === '&' && s[i + 1] === '&') { out.push(peel(s.slice(from, i))); from = i + 2; i++; }
  }
  out.push(peel(s.slice(from)));
  return out.filter((a) => a.length);
}
// `AnimElem >= N`, `!= N`, `<= N` (and `:=`) compile exactly as `AnimElem = N`,
// and so do `AnimElem(0) = N` and `AnimElem > = N`: checkEquality with
// ignoreMostErrors skips every token until one ends in `=`, and
// parseOldAnimElemStyle reads the integer after it, ignoring the `not`
// (compiler.go:909-929, 1254-1269). The atom here has its spaces removed, which
// can only glue `>` and `=` into `>=` - a token ending in `=` either way.
// An element number below 1 is Undefined (char.go:5256-5261), so an atom on
// it is never true (`AnimElem = 0` is even a load error, compiler.go:4004-4006).
const ANIMELEM_RE = /^animelem(?![a-z0-9_])(.*?)(!=|>=|<=|:=|=)(\d+)(?![\d.e])(.*)$/;
function classifyAtom(a) {
  let m;
  if ((m = ANIMELEM_RE.exec(a))) {
    const n = +m[3];
    if (n < 1) return { kind: 'other', never: true };
    if (!/^(?:,=0+)?$/.test(m[4])) return { kind: 'other', elem: n };
    const note = m[1] ? '`AnimElem' + m[1] + m[2] + n + '` compiles as AnimElem = ' + n + ': the compiler skips every token before the first one ending in `=` (compiler.go:909-929, 1254-1269)'
      : m[2] !== '=' ? '`AnimElem ' + m[2] + ' ' + n + '` compiles as AnimElem = ' + n + ': the operator is ignored (compiler.go:909-929, 1254-1269)' : null;
    return Object.assign({ kind: 'animelem', elem: n }, note ? { note } : {});
  }
  if ((m = /^animelemtime\((\d+)\)=(-?\d+)$/.exec(a))) return +m[1] < 1 ? { kind: 'other', never: true } : { kind: 'animelemtime', elem: +m[1], offset: +m[2] };
  if ((m = /^animelemtime\((\d+)\)/.exec(a))) return +m[1] < 1 ? { kind: 'other', never: true } : { kind: 'other', elem: +m[1] };
  if ((m = /^time=(\d+)$/.exec(a)) || (m = /^(\d+)=time$/.exec(a))) return { kind: 'time', tick: +m[1] };
  if (a === '!time') return { kind: 'time', tick: 0 };
  if (/^[+-]?\d*\.?\d+$/.test(a) && Number(a) !== 0) return { kind: 'true' };
  return { kind: 'other', elem: (m = /animelem(?:time\()?=?(\d+)/.exec(a)) && +m[1] >= 1 ? +m[1] : undefined };
}
function firingOf(sc) {
  const out = [];
  const allLines = sc.trig.all;
  const groupNos = [...sc.groupIdx.keys()].map(Number).sort((a, b) => a - b);
  for (const g of groupNos) {
    const lines = [...allLines, ...sc.trig.groups[sc.groupIdx.get(String(g))]];
    const text = lines.map((l) => String(l).replace(/\s+/g, ' ').trim()).join(' && ');
    if (lines.some((l) => /\|\|/.test(l))) {
      const elems = lines.flatMap(splitAnd).map(classifyAtom).filter((c) => c.elem !== undefined);
      out.push({ group: g, kind: 'conditional', text, elem: elems.length ? elems[0].elem : undefined });
      continue;
    }
    const atoms = lines.flatMap(splitAnd).map(classifyAtom).filter((c) => c.kind !== 'true');
    if (atoms.some((c) => c.never)) {
      out.push({ group: g, kind: 'conditional', text, never: true, note: 'an element number below 1 is Undefined (char.go:5256-5261): this group never fires' });
      continue;
    }
    const withElem = atoms.find((c) => c.elem !== undefined);
    if (atoms.length === 1 && atoms[0].kind !== 'other') out.push(Object.assign({ group: g, text }, atoms[0]));
    else out.push({ group: g, kind: 'conditional', text, elem: withElem ? withElem.elem : undefined });
  }
  return out;
}

// ---- attr ------------------------------------------------------------------------------------
// attr's second part (compiler.go:718-790, ignoreMostErrors keeps the first
// two letters of each piece): any of HA/HT/HP/AA/AT/AP/H/A sets a hyper bit
// (AT_AH = AT_HA|AT_HT|AT_HP, bytecode.go:49), which swaps finalizeParams to
// the super.* multipliers (char.go:935-947). Null when attr is absent: the
// HitDef then has attr 0 and never hits (attrCheck, char.go:10741).
function attrInfo(raw) {
  if (raw === undefined) return null;
  const parts = String(raw).split(',').map((x) => x.trim());
  const hyper = parts.slice(1).some((p) => ['ha', 'ht', 'hp', 'aa', 'at', 'ap', 'h', 'a'].includes((p.length >= 2 ? p.slice(0, 2).trim() : p).toLowerCase()));
  return { hyper, state: parts[0] };
}

// ---- loading ------------------------------------------------------------------------------------
function loadChar(charDir, defName) {
  let defText;
  try { defText = S.stripBom(fs.readFileSync(path.join(charDir, defName), 'latin1')); } catch (e) { return null; }
  const info = iniSection(defText, 'info');
  const filesSec = iniSection(defText, 'files');
  let engineDir = null;
  try { engineDir = engine().engineDir(); } catch (e) { engineDir = null; }
  const resolve = makeResolve(charDir, defName, engineDir);
  const normAbs = (p) => path.resolve(p).replace(/\\/g, '/').toLowerCase();
  const isEngine = (abs) => !!abs && !!engineDir && normAbs(abs).startsWith(normAbs(engineDir) + '/');
  // A version other than 0 turns negoverride off (compiler.go:8347).
  const ikv = info.get('ikemenversion');
  const ikemenVersion = !!ikv && /[1-9]/.test(ikv);
  const sf = S.stateFiles(charDir, defName, resolve);
  const files = [];
  const toParse = [];
  for (const f of sf) {
    const zss = /\.zss$/i.test(f.abs || f.rel);
    const eng = isEngine(f.abs);
    const rec = { key: f.key, rel: f.rel, abs: f.abs, path: f.abs ? (eng ? 'engine:' + path.relative(engineDir, f.abs).replace(/\\/g, '/') : path.relative(charDir, f.abs).replace(/\\/g, '/')) : null, zss, engine: eng, scanned: false };
    files.push(rec);
    if (!f.abs || eng) continue;           // engine files hold no attack of hers (§6 negative control)
    toParse.push(f);
    rec.scanned = !zss;
  }
  let consts = new Map();
  try { consts = engine().consts(); } catch (e) { consts = new Map(); }
  const parsed = S.parseStates(toParse, { consts, ikemenVersion });
  const cnsAbs = filesSec.get('cns') ? resolve(filesSec.get('cns')) : null;
  let cnsText = '';
  try { if (cnsAbs) cnsText = S.stripBom(fs.readFileSync(cnsAbs, 'latin1')); } catch (e) { cnsText = ''; }
  const size = iniSection(cnsText, 'size');
  const constants = iniSection(cnsText, 'constants');
  const movement = iniSection(cnsText, 'movement');
  const velocity = iniSection(cnsText, 'velocity');
  const lc = String(info.get('localcoord') || '').split(',').map(atofFirst);
  return { defText, info, filesSec, resolve, ikemenVersion, files, toParse, parsed, consts, engineDir, cnsAbs, size, constants, movement, velocity, localcoord: lc.length >= 2 && lc.every(Number.isFinite) ? [lc[0], lc[1]] : null };
}

// Per-file text cache for one read.
function fileCache(files) {
  const byRel = new Map();
  for (const f of files) if (f.abs && !byRel.has(f.rel)) byRel.set(f.rel, f.abs);
  const cache = new Map();
  return (rel) => {
    if (cache.has(rel)) return cache.get(rel);
    const abs = byRel.get(rel);
    let v = null;
    if (abs) {
      try {
        // The text stays the bytes on disk (every offset is a byte offset);
        // only the bracket test skips a BOM on line 1, as LoadText does.
        const text = fs.readFileSync(abs, 'latin1');
        const starts = lineStarts(text);
        const brackets = [];
        for (let i = 1; i <= starts.length; i++) { const nc = noCommentLine(i === 1 ? S.stripBom(lineText(text, starts, i)) : lineText(text, starts, i)); if (nc[0] === '[') brackets.push(i); }
        v = { abs, text, starts, brackets };
      } catch (e) { v = null; }
    }
    cache.set(rel, v);
    return v;
  };
}
// The first bracket line after `line` (the end of a controller's body).
function nextBracket(ft, line) {
  const b = ft.brackets;
  let lo = 0, hi = b.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (b[mid] <= line) lo = mid + 1; else hi = mid; }
  return lo < b.length ? b[lo] : ft.starts.length + 1;
}

// ---- one block -------------------------------------------------------------------------------------
function valueModel(type, name, spec, comp, index, base) {
  const v = { index, raw: comp.raw, tier: 'red', kind: spec ? (spec.secondWord && index >= 1 ? 'string' : spec.kind) : 'unknown', start: base + comp.start, end: base + comp.end, spans: [] };
  if (!spec) { v.red = 'unknown'; v.note = 'unknown parameter: ignored by the engine (compiler.go:6036-6053)'; return v; }
  if (index >= spec.n) { v.red = 'extra'; v.note = 'more components than the engine reads (' + spec.n + '): a load error'; return v; }
  if (v.kind === 'string') { v.red = 'string'; return v; }
  if (spec.prefix && index === 0 && /^[a-z]/i.test(comp.raw)) { v.red = 'prefix'; v.note = 'table prefix (' + comp.raw.match(/^[a-z]+/i)[0] + '): not a plain number'; return v; }
  if (spec.letterN && comp.raw.toLowerCase() === 'n') { v.red = 'letter'; v.note = '`n`: no velocity change in MUGEN, 0 in this engine (compiler_functions.go:2073-2125)'; return v; }
  if (NUM_RE.test(comp.raw)) { v.tier = 'green'; v.spans = [{ start: v.start, end: v.end }]; return v; }
  const amb = (v.kind === 'int' || v.kind === 'float') ? amberSpans(comp.raw) : null;
  if (amb) {
    v.tier = 'amber';
    v.base = amb.base; v.floor = amb.floor; v.fvar = amb.fvar;
    v.spans = amb.spans.map((s) => ({ start: base + comp.start + s.start, end: base + comp.start + s.end }));
    v.start = v.spans[0].start; v.end = v.spans[0].end;
    v.expression = comp.raw;
    v.expressionStart = base + comp.start; v.expressionEnd = base + comp.end;
    return v;
  }
  v.red = 'expression';
  v.note = 'computed at runtime';
  // Editable as text (editMoveValue's expression path), and read the
  // first-hit way for the page (framedata.evaluate).
  v.expr = true;
  const e = FD.evaluate(comp.raw);
  if (e.value !== null) { v.reads = v.kind === 'int' ? Math.trunc(e.value) : e.value; v.assumed = e.assumed; }
  return v;
}

function blockModel(ctx, st, sc, ordinal) {
  const ft = ctx.file(sc.file);
  const end = ft ? nextBracket(ft, sc.line) : sc.line + 1;
  const b = {
    key: { file: sc.file, state: st.no, ordinal }, file: sc.file, state: st.no, ordinal,
    // tag and label are shown on the Moves page: decoded (scenelib.decodeText),
    // never the latin1 bytes, whose Shift-JIS lead bytes a browser draws as nothing
    type: TYPE_NAMES[sc.type], ctrl: sc.type, tag: S.decodeText(sc.tag), label: S.decodeText(sc.label), line: sc.line, endLine: end - 1,
    triggers: [], params: [], duplicates: [], firing: [], derived: null, notes: [],
  };
  if (sc.gap) b.notes.push(sc.gap === 1 ? 'no trigger1: the engine refuses to load the character (compiler.go:7012-7015)' : 'trigger' + sc.gap + ' is missing: trigger groups from ' + sc.gap + ' on never compile');
  if (sc.neverTrue) b.notes.push('a trigger is a literal 0: this block never runs');
  if (sc.dropped) b.notes.push(sc.dropped + ' malformed trigger line(s) dropped');
  if (!ft) return b;
  const seen = new Map();
  for (let ln = sc.line + 1; ln < end; ln++) {
    const nc = noCommentLine(lineText(ft.text, ft.starts, ln));
    if (!nc) continue;
    // The name the engine reads (scenelib.paramLine, compiler.go:5943-5982).
    const kv = S.paramLine(nc);
    if (!kv) continue;
    const name = kv.name;
    const tm = /^trigger(all|\d+)$/.exec(name);
    if (tm) {
      const numOk = tm[1] === 'all' || tm[1][0] !== '0';
      const compiled = numOk && (tm[1] === 'all' || !sc.gap || +tm[1] < sc.gap);
      b.triggers.push({ name, group: tm[1] === 'all' ? 'all' : +tm[1], line: ln, text: nc, value: kv.value, compiled });
      continue;
    }
    if (name === 'type') continue;
    if (seen.has(name)) b.duplicates.push({ name, line: ln, firstLine: seen.get(name), note: 'duplicate parameter: the first wins, this line is ignored (compiler.go:5998-6008)' });
    else seen.set(name, ln);
  }
  const risky = (name) => riskOf(name, ctx.ikemenVersion);
  for (const [name, line] of sc.paramLines) {
    if (/^trigger(all|\d+)$/.test(name) || name === 'type' || !sc.params.has(name)) continue;
    const raw = sc.params.get(name);
    const spec = paramSpec(sc.type, name);
    const lt = lineText(ft.text, ft.starts, line);
    const cut = (() => { const k = lt.indexOf(';'); return k < 0 ? lt : lt.slice(0, k); })();
    // The `=` the engine splits on: the first one outside parentheses. Leading
    // spaces hold no `=` or `(`, so its offset in the untrimmed cut is the same.
    const pl = S.paramLine(cut);
    const eq = pl ? pl.eq : cut.indexOf('=');
    const base = ft.starts[line - 1];
    const at = raw === '' ? -1 : cut.indexOf(raw, eq + 1);
    const p = { name, raw, line, start: at < 0 ? base + eq + 1 : base + at, end: at < 0 ? base + eq + 1 : base + at + raw.length, known: !!spec, kind: spec ? spec.kind : 'unknown', components: spec ? spec.n : null, values: [], risk: risky(name) };
    if (at < 0 && raw !== '') { p.values = []; p.note = 'value not located in the file text'; b.params.push(p); continue; }
    if (raw === '') {
      p.note = 'empty: the engine ignores an empty parameter (compiler.go:6161-6165)';
      if (spec) for (let k = 0; k < spec.n; k++) p.values.push({ index: k, raw: null, tier: 'absent', kind: spec.kind, start: null, end: null, spans: [] });
      b.params.push(p);
      continue;
    }
    // A string/flag parameter is read whole by its own parser (attr's `S, NA`
    // is one value to compiler.go:718), so it is one component.
    const comps = spec && spec.kind === 'string' ? [{ raw, start: 0, end: raw.length }] : splitComponents(raw);
    comps.forEach((c, k) => p.values.push(valueModel(sc.type, name, spec, c, k, p.start)));
    if (spec) for (let k = comps.length; k < spec.n; k++) p.values.push({ index: k, raw: null, tier: 'absent', kind: spec.secondWord && k >= 1 ? 'string' : spec.kind, start: null, end: null, spans: [] });
    if (name === 'sprpriority' && sc.params.has('p1sprpriority')) p.note = 'ignored: p1sprpriority is also set (compiler_functions.go:1881-1893)';
    b.params.push(p);
  }
  b.firing = firingOf(sc);
  b.derived = derivedOf(ctx, sc, b);
  b.editable = b.params.some((p) => p.values.some((v) => v.tier === 'green' || v.tier === 'amber' || v.expr));
  return b;
}

// DERIVED (§4): what finalizeParams (char.go:831-963) fills in when a
// parameter is absent, for a literal hit damage. int32(float32 multiplier *
// float32(damage)) truncates toward zero - Math.fround reproduces the float32
// product. Guard values use guard damage (the second damage component, 0 when
// absent: hitDef_damage bytecode.go:7629-7633).
function derivedOf(ctx, sc, b) {
  if (!FINALIZED.has(sc.type)) return { applies: false, reason: TYPE_NAMES[sc.type] + ' skips finalizeParams: nothing is derived (bytecode.go:8366-8384)' };
  const pm = new Map(b.params.map((p) => [p.name, p]));
  const dmg = pm.get('damage');
  const out = { applies: true, super: false, values: {}, unknown: [] };
  const attrRaw = sc.params.get('attr');
  const ai = attrInfo(attrRaw);
  out.super = !!(ai && ai.hyper);
  // An absent component is the reset value 0; a non-literal one is unknown.
  const lit = (p, k) => { const v = p.values[k]; if (!v || v.tier === 'absent') return 0; return v.tier === 'green' ? Math.trunc(Number(v.raw)) : null; };
  const hit = dmg ? lit(dmg, 0) : 0;
  const guard = dmg ? lit(dmg, 1) : 0;
  if (dmg && hit === null) return { applies: false, reason: 'damage is computed at runtime: derived values depend on it' };
  const mul = ctx.multipliers;
  const pre = out.super ? 'super.' : 'default.';
  const f32 = (m, d) => Math.trunc(Math.fround(Math.fround(m) * d));
  const put = (name, index, value, formula) => { (out.values[name] = out.values[name] || []).push({ index, value, formula }); };
  const absent = (name, k) => { const p = pm.get(name); return !p || p.raw === '' || !p.values[k] || p.values[k].tier === 'absent'; };
  const cite = out.super ? 'char.go:935-947' : 'char.go:948-961';
  if (absent('dizzypoints', 0)) put('dizzypoints', 0, f32(mul[pre + 'lifetodizzypointsmul'].value, hit), pre + 'lifetodizzypointsmul (' + mul[pre + 'lifetodizzypointsmul'].value + ') x hit damage ' + hit + ' (' + cite + ')');
  if (absent('guardpoints', 0)) put('guardpoints', 0, f32(mul[pre + 'lifetoguardpointsmul'].value, hit), pre + 'lifetoguardpointsmul (' + mul[pre + 'lifetoguardpointsmul'].value + ') x HIT damage ' + hit + ' (' + cite + ')');
  const red = mul[pre + 'lifetoredlifemul'].value;
  if (absent('redlife', 0)) put('redlife', 0, f32(red, hit), pre + 'lifetoredlifemul (' + red + ') x hit damage ' + hit + ' (' + cite + ')');
  if (absent('redlife', 1)) {
    if (guard === null) out.unknown.push({ name: 'redlife', index: 1, why: 'guard damage is computed at runtime' });
    else put('redlife', 1, f32(red, guard), pre + 'lifetoredlifemul (' + red + ') x guard damage ' + guard + ' (' + cite + ')');
  }
  for (const [name, key] of [['getpower', 'attack.lifetopowermul'], ['givepower', 'gethit.lifetopowermul']]) {
    const m = mul[pre + key].value;
    let hitVal = null;
    if (absent(name, 0)) { hitVal = f32(m, hit); put(name, 0, hitVal, pre + key + ' (' + m + ') x hit damage ' + hit + ' (' + cite + ')'); }
    else { const p = pm.get(name); if (p.values[0].tier === 'green') hitVal = Math.trunc(Number(p.values[0].raw)); }
    if (absent(name, 1)) {
      // guard value = int32(float32(hit value) * 0.5) (char.go:963-964)
      if (hitVal === null) out.unknown.push({ name, index: 1, why: 'the hit value is computed at runtime' });
      else put(name, 1, Math.trunc(Math.fround(hitVal) * 0.5), 'hit ' + name + ' ' + hitVal + ' x 0.5 (char.go:963-964)');
    }
  }
  // The guard timing chain (char.go:875-888): guard.pausetime <- pausetime,
  // guard.hittime <- ground.slidetime (MUGEN) or ground.hittime (Ikemen),
  // guard.slidetime <- guard.hittime, guard.ctrltime <- guard.slidetime,
  // airguard.ctrltime <- guard.ctrltime. An absent source is the reset value 0.
  const val = (name, k) => { const p = pm.get(name); if (!p || p.raw === '' || !p.values[k] || p.values[k].tier === 'absent') return 0; return p.values[k].tier === 'green' ? Math.trunc(Number(p.values[k].raw)) : null; };
  const chain = (name, k, from, fk, cites) => {
    if (!absent(name, k)) return val(name, k);
    const v = typeof from === 'number' ? from : val(from, fk);
    if (v === null) { out.unknown.push({ name, index: k, why: from + ' is computed at runtime' }); return null; }
    put(name, k, v, (typeof from === 'number' ? 'the value above' : from) + ' (' + cites + ')');
    return v;
  };
  chain('guard.pausetime', 0, 'pausetime', 0, 'char.go:875');
  chain('guard.pausetime', 1, 'pausetime', 1, 'char.go:876');
  const gh = chain('guard.hittime', 0, ctx.ikemenVersion ? 'ground.hittime' : 'ground.slidetime', 0, ctx.ikemenVersion ? 'char.go:882-884, ikemenversion' : 'char.go:880-881, MUGEN character');
  let gs = null;
  if (gh !== null) gs = absent('guard.slidetime', 0) ? (put('guard.slidetime', 0, gh, 'guard.hittime (char.go:886)'), gh) : val('guard.slidetime', 0);
  else if (absent('guard.slidetime', 0)) out.unknown.push({ name: 'guard.slidetime', index: 0, why: 'guard.hittime is computed at runtime' });
  let gc = null;
  if (gs !== null) gc = absent('guard.ctrltime', 0) ? (put('guard.ctrltime', 0, gs, 'guard.slidetime (char.go:887)'), gs) : val('guard.ctrltime', 0);
  if (gc !== null && absent('airguard.ctrltime', 0)) put('airguard.ctrltime', 0, gc, 'guard.ctrltime (char.go:888)');
  if (!ai) out.note = 'attr is absent: attr 0, the block never hits (char.go:10741)';
  return out;
}

// ---- the read model ----------------------------------------------------------------------------------
const LIFE_TYPES = new Set(['targetlifeadd', 'lifeadd', 'lifeset', 'targetdrop', 'targetstate', 'targetbind', 'hitadd',
  'targetpoweradd', 'targetdizzypointsadd', 'targetguardpointsadd', 'targetredlifeadd']);

function movesIn(charDir, defName, opts) {
  const o = Object.assign({ anims: true }, opts || {});
  const L = loadChar(charDir, defName);
  if (!L) return null;
  const file = fileCache(L.files);
  const ctx = { file, ikemenVersion: L.ikemenVersion, multipliers: multipliers(L.constants) };
  const states = L.parsed.states;
  const domains = S.domainsOf(states, { computed: true });

  // .air
  let air = null, airPath = null;
  const animAbs = L.filesSec.get('anim') ? L.resolve(L.filesSec.get('anim')) : null;
  if (o.anims && animAbs) {
    try { air = airModel(fs.readFileSync(animAbs, 'latin1')); airPath = path.relative(charDir, animAbs).replace(/\\/g, '/'); } catch (e) { air = null; }
  }
  let commonAir = null;
  const common = () => {
    if (commonAir) return commonAir;
    commonAir = { actions: new Map() };
    try {
      const E = engine();
      const text = E.commonConfig().air.map((rel) => fs.readFileSync(path.join(E.engineDir(), rel), 'latin1')).join('\n');
      commonAir = airModel(text);
    } catch (e) { /* no engine data: common actions stay unknown */ }
    return commonAir;
  };
  const animFor = (no) => {
    if (air && air.actions.has(no)) return Object.assign({ action: no, exists: true, table: 'character' }, air.actions.get(no));
    // Common anims merge in where the character lacks the number (char.go:4311-4331).
    const c = common();
    if (c.actions.has(no)) return Object.assign({ action: no, exists: true, table: 'common' }, c.actions.get(no));
    return { action: no, exists: false, frames: [] };
  };

  const outStates = [];
  // ATTACK BLOCKS IN NEGATIVE STATES. A -1, -2 or -3 runs every tick in
  // whatever state is playing (-1 and -3 only in the character's own states,
  // char.go:12069, 12084), so a HitDef there arms in any state its triggers
  // allow - the usual way to give a pose that has no HitDef of its own a hit,
  // including a pose in one of the engine's common states. Listed apart from
  // the live positive states (`states` stays what the renumber reads), with
  // the actions an `Anim = K` in the block's own triggers names as the
  // animations to draw, and whether the state also sets movetype A (a HitDef
  // hits only while movetype is not I, char.go:10854, 12552).
  const negStates = [];
  const refsBySc = new Map();   // each controller's AnimElem refs, read once
  for (const st of states.values()) {
    if (st.zss) continue;
    if (st.no < 0) {
      const blocks = [];
      let ord = 0;
      for (const sc of st.sctrls) if (ATTACK_SET.has(sc.type)) blocks.push(blockModel(ctx, st, sc, ord++));
      if (blocks.length) {
        const setsAttack = st.sctrls.some((sc) => sc.type === 'statetypeset' && /^\s*a/i.test(String(sc.params.get('movetype') || '')));
        negStates.push({
          no: st.no, file: st.file, line: st.line, negative: true, setsAttack,
          movetype: null, movetypeRaw: null, juggle: null, anim: null, changeAnims: [], blocks,
          animElemTriggers: [], outsideDamage: [], controllers: st.sctrls.length,
        });
      }
      continue;
    }
    const s = {
      no: st.no, file: st.file, line: st.line,
      movetype: st.movetype, movetypeRaw: st.header.get('movetype') === undefined ? null : st.header.get('movetype'),
      statetype: (() => { const t = String(st.header.get('type') || 's').trim().charAt(0).toLowerCase(); return 'scalu'.includes(t) && t ? t : 's'; })(),
      juggle: st.header.has('juggle') ? { raw: st.header.get('juggle'), line: st.headerLines.get('juggle') } : null,
      anim: st.anim === null ? null : Object.assign({ line: st.headerLines.get('anim') }, animRef(st.anim, domains)),
      changeAnims: [], blocks: [], animElemTriggers: [], outsideDamage: [], controllers: st.sctrls.length,
    };
    let ordinal = 0;
    st.sctrls.forEach((sc, ci) => {
      if (sc.type === 'changeanim' || sc.type === 'changeanim2') {
        s.changeAnims.push(Object.assign({ type: sc.type === 'changeanim' ? 'ChangeAnim' : 'ChangeAnim2', line: sc.line, controller: ci, triggers: [...sc.trig.all, ...sc.trig.groups.flat()] }, animRef(sc.params.get('value'), domains)));
      }
      if (ATTACK_SET.has(sc.type)) s.blocks.push(blockModel(ctx, st, sc, ordinal++));
      const refs = animElemRefs(file, sc, ci);
      refsBySc.set(sc, refs);
      s.animElemTriggers.push(...refs);
    });
    resolveRelativeChangeAnims(s);
    outStates.push(s);
  }
  const byNo = new Map(outStates.map((s) => [s.no, s]));

  // With opts.outsiders: the live states an .air renumber cannot see through
  // statesUsingAction, with each controller that reads AnimElem /
  // AnimElemTime and every trigger line of it (modlib.charAirEditIn decides
  // which of them may read the edited action). ZSS states are not parsed here;
  // notScanned lists those files.
  //   negative    a negative statedef runs every tick, in whatever animation
  //               is playing;
  //   noanim      a statedef with no anim keeps the animation of the state
  //               it was entered from;
  //   unresolved  an anim expression with no candidate at all.
  //   entries     (noanim only) every controller of a live state that changes
  //               into it by a literal number or a literal leaf of an ifelse
  //               value: ChangeState / SelfState value, and the attacker's
  //               p1stateno of an attack block - the animation it inherits
  //               is the one playing there. Computed values beyond their
  //               literal leaves are not followed.
  let outsiders, redirected, changeAnimElems, undefinedStates;
  if (o.outsiders) {
    outsiders = []; redirected = []; changeAnimElems = []; undefinedStates = [];
    const refCache = refsBySc;
    const refsOf = (sc, ci) => { if (!refCache.has(sc)) refCache.set(sc, animElemRefs(file, sc, ci)); return refCache.get(sc); };
    // A ChangeAnim value that names no number makes the state 'unresolved' as
    // surely as an unresolved statedef anim: the value runs when the
    // controller does (bytecode.go:5500-5506) and AnimElem reads whatever it
    // plays (char.go:5256-5260). `anim` itself keeps the current action
    // (resolveRelativeChangeAnims), and a table-prefixed value (`F100`) plays
    // another table.
    const reasonOf = (st) => {
      if (st.zss) return null;
      if (st.no < 0) return 'negative';
      const pos = byNo.get(st.no);
      if (pos && ((pos.anim && pos.anim.unresolved) || pos.changeAnims.some((c) => c.unresolved))) return 'unresolved';
      return st.anim === null ? 'noanim' : null;
    };
    const entries = new Map();
    for (const st of states.values()) {
      if (st.zss) continue;
      st.sctrls.forEach((sc) => {
        const raws = [];
        // ChangeState / SelfState `anim` is applied BEFORE the state changes
        // (compiler_functions.go:449-455; changeStateEx, char.go:6765-6768):
        // an anim-less state entered that way plays that action, not the one
        // the source state was playing. `anim = -1` means no change.
        if (sc.type === 'changestate' || sc.type === 'selfstate') raws.push({ raw: sc.params.get('value'), anim: sc.params.get('anim') });
        if (ATTACK_SET.has(sc.type)) raws.push({ raw: sc.params.get('p1stateno') });
        for (const { raw, anim } of raws) {
          if (raw === undefined) continue;
          const n = S.lit(raw);
          let targets = n !== null ? [n] : [];
          if (n === null) { try { targets = X.leavesOf(raw).filter((v) => Number.isInteger(v)); } catch (e) { targets = []; } }
          for (const t of new Set(targets)) {
            const to = states.get(t);
            // A number no scanned file defines is collected too: the engine
            // enters it as an EMPTY state that keeps the animation playing
            // (stateChange1, char.go:6666-6673), the way an anim-less one does.
            if (to && reasonOf(to) !== 'noanim') continue;
            if (!entries.has(t)) entries.set(t, []);
            const e = { from: st.no, type: sc.type, file: sc.file, line: sc.line, triggers: triggerLinesOf(file, sc) };
            if (anim !== undefined && anim !== '') {
              const ar = animRef(anim, domains);
              if (!(ar.literal && ar.candidates[0] === -1)) {
                if (ar.foreign) { e.anims = []; e.animRaw = anim; }
                else if (ar.exact && ar.candidates.length) { e.anims = ar.candidates; e.animRaw = anim; }
                else { e.animUnresolved = true; e.animRaw = anim; }
              }
            }
            entries.get(t).push(e);
          }
        }
      });
    }
    for (const [no, list] of entries) if (!states.has(no)) undefinedStates.push({ no, entries: list });
    for (const st of states.values()) {
      if (st.zss) continue;
      const reason = reasonOf(st);
      const pos = byNo.get(st.no);
      const controllers = [], redirects = [];
      st.sctrls.forEach((sc, ci) => {
        const refs = refsOf(sc, ci);
        if (!refs.length && !(sc.type === 'changeanim' || sc.type === 'changeanim2')) return;
        const trigs = triggerLinesOf(file, sc);
        if (reason && refs.length) controllers.push({ type: sc.type, file: sc.file, line: sc.line, controller: ci, triggers: trigs, animElemTriggers: refs });
        const own = refs.filter((r) => r.redirect && (r.redirect.own || r.redirect.any));
        if (own.length) redirects.push({ type: sc.type, file: sc.file, line: sc.line, triggers: trigs, animElemTriggers: own });
        for (const ref of changeAnimElemRefs(file, sc, ci)) {
          let value = pos ? pos.changeAnims.find((c) => c.controller === ci) : null;
          if (!value) {
            const tmp = { anim: null, changeAnims: [Object.assign({ controller: ci }, animRef(sc.params.get('value'), domains))] };
            resolveRelativeChangeAnims(tmp);
            value = tmp.changeAnims[0];
          }
          changeAnimElems.push({
            no: st.no, file: st.file, line: st.line, controller: sc.line, type: sc.type, ref,
            value: { raw: value.raw, candidates: value.candidates, exact: value.exact !== false, unresolved: !!value.unresolved, foreign: !!value.foreign, keepsCurrent: !!value.keepsCurrent },
            stateAnims: pos ? [...new Set([...(pos.anim ? pos.anim.candidates : []), ...pos.changeAnims.flatMap((c) => c.candidates)])] : [],
            stateAnimsExact: !!pos && !!pos.anim && pos.anim.exact !== false && pos.changeAnims.every((c) => c.keepsCurrent || (c.exact !== false && !c.unresolved)),
            otherTable: ['redirectid', 'animplayerno', 'readplayerid'].filter((k) => sc.params.has(k)),
          });
        }
      });
      if (redirects.length) redirected.push({ no: st.no, file: st.file, line: st.line, controllers: redirects });
      if (!reason) continue;
      // An anim-less state that ChangeAnims on entry (a ChangeAnim whose
      // triggers hold at time = 0) to known actions plays those from then on -
      // from that controller on: controllers run in file order, so the ones
      // above it still read the inherited frames on the entry tick
      // (`controller`, its index in the state).
      const onEntry = reason !== 'noanim' ? undefined : st.sctrls
        .map((sc, ci) => [sc, ci])
        .filter(([sc]) => sc.type === 'changeanim' && S.isImmediate(sc.trig))
        .map(([sc, ci]) => { const r = animRef(sc.params.get('value'), domains); return { line: sc.line, controller: ci, candidates: r.candidates, exact: r.exact !== false && !r.unresolved }; });
      const unresolvedAt = reason === 'unresolved' && pos ? (pos.anim && pos.anim.unresolved ? { raw: pos.anim.raw, line: pos.anim.line, header: true } : (() => { const c = pos.changeAnims.find((x) => x.unresolved); return c ? { raw: c.raw, line: c.line, type: c.type } : undefined; })()) : undefined;
      if (controllers.length || entries.has(st.no)) outsiders.push({ no: st.no, file: st.file, line: st.line, reason, anim: st.anim, controllers, entries: reason === 'noanim' ? (entries.get(st.no) || []) : undefined, onEntry, unresolvedAt });
    }
  }

  // Candidate animations, active elements and firing ticks for states with blocks.
  // (The same for a state that throws a projectile from a Helper: animsOf and
  // ticksOf are reused by THE PROJECTILES below.)
  const animEntry = (action, source) => {
    const a = animFor(action);
    return {
      action, source, exists: a.exists, table: a.table, line: a.line, copyOf: a.copyOf, loopStart: a.loopStart, ticks: a.ticks, endless: a.endless, holdsOn: a.holdsOn,
      frames: a.frames.map((f) => ({ elem: f.elem, group: f.group, number: f.number, time: f.time, start: f.start, line: f.line, clsn1: f.clsn1, clsn2: f.clsn2, clsn1Source: f.clsn1Source, clsn2Source: f.clsn2Source, clsn1Line: f.clsn1Line, clsn2Line: f.clsn2Line, hidden: !!f.neverDisplayed, holds: !!f.holds })),
      active: a.frames.filter((f) => f.clsn1.length > 0).map((f) => f.elem),
    };
  };
  const animsOf = (s) => {
    const cands = [];
    const add = (n, source) => { if (Number.isInteger(n) && !cands.some((c) => c.action === n)) cands.push({ action: n, source }); };
    if (s.anim) for (const n of s.anim.candidates) add(n, 'statedef anim');
    for (const ca of s.changeAnims) for (const n of ca.candidates) add(n, ca.type + ' line ' + ca.line);
    // A negative state has no animation of its own: the one a block's
    // triggers test for (`Anim = 41`, not redirected, not negated).
    if (s.negative) for (const b of s.blocks) for (const n of guardAnims(b)) add(n, b.type + ' line ' + b.line + ' trigger Anim = ' + n);
    return o.anims ? cands.map((c) => animEntry(c.action, c.source)) : [];
  };
  const ticksOf = (s, firing) => {
    for (const fz of firing) {
      if (fz.kind === 'time') continue;
      if (fz.elem === undefined) continue;
      fz.ticks = {};
      for (const a of s.anims) {
        if (!a.exists) continue;
        // Undefined below 1 as past the end (char.go:5256-5261): never fires.
        if (fz.elem < 1) { fz.ticks[a.action] = null; fz.never = true; continue; }
        if (fz.elem > a.frames.length) { fz.ticks[a.action] = null; fz.pastEnd = (fz.pastEnd || []).concat(a.action); continue; }
        const start = a.frames[fz.elem - 1].start;
        fz.ticks[a.action] = fz.kind === 'animelemtime' ? start + fz.offset : start;
      }
    }
  };
  for (const s of [...outStates, ...negStates]) {
    if (!s.blocks.length) continue;
    s.anims = animsOf(s);
    for (const b of s.blocks) ticksOf(s, b.firing);
  }

  // Damage paid outside the HitDef (§4): life controllers in a grab's own
  // state and in the literal p1stateno / p2stateno states it sends to.
  for (const s of outStates) {
    for (const b of s.blocks) {
      if (b.ctrl === 'modifyhitdef' || b.ctrl === 'modifyreversaldef') continue;
      const targets = [];
      for (const k of ['p1stateno', 'p2stateno']) {
        const p = b.params.find((x) => x.name === k);
        if (p && S.lit(p.raw) !== null) targets.push({ via: k, no: S.lit(p.raw) });
      }
      if (!targets.length) continue;
      for (const t of [{ via: 'same state', no: s.no }, ...targets]) {
        const st = states.get(t.no);
        if (!st || st.zss) continue;
        for (const sc of st.sctrls) {
          if (!LIFE_TYPES.has(sc.type)) continue;
          if (s.outsideDamage.some((x) => x.file === sc.file && x.line === sc.line)) continue;
          s.outsideDamage.push({ from: b.key, via: t.via, state: t.no, file: sc.file, line: sc.line, type: sc.type, value: sc.params.has('value') ? sc.params.get('value') : null, note: sc.type === 'targetlifeadd' ? 'TargetLifeAdd hardcodes the attack multiplier to 1 (char.go:8456-8464): an attack-power change does not scale it' : undefined });
        }
      }
    }
  }

  // THE TRAINING-MODE READOUT (framedata.js): startup, active, recovery,
  // stun and advantage for every block, counted on the state's animation and
  // its end trigger. Only with the animations - an edit's re-read skips both.
  if (o.anims) {
    for (const s of outStates) {
      const st = states.get(s.no);
      s.end = FD.endOf(st && st.sctrls);
      for (const b of s.blocks) b.frame = FD.frameData(s, b, { ikemenVersion: L.ikemenVersion });
    }
  }

  // THE PROJECTILES (below): one entry per thing a move throws, read from the
  // files only, never run. A character the reader cannot follow gets none
  // and a note, never an error: the rest of the window still reads.
  let projectiles = null;
  if (o.anims) {
    try {
      projectiles = projectilesIn({ L, states, outStates, negStates, byNo, animEntry, animsOf, ticksOf, domains, localcoord: L.localcoord || [320, 240] });
    } catch (e) {
      projectiles = { entries: [], anims: [], notes: ['the projectiles could not be read: ' + (e && e.message ? e.message : String(e))] };
    }
  }

  // THE EXPLODS (below): the art each attack state spawns, under its boxes.
  // Their animations join the projectiles' (`projAnims`, one entry per
  // action): an action an attack state already carries is not sent twice.
  let explodNotes = null;
  if (o.anims) {
    const extra = new Map(((projectiles && projectiles.anims) || []).map((a) => [a.action, a]));
    const inStates = new Map();
    for (const s of outStates) for (const a of (s.anims || [])) if (!inStates.has(a.action)) inStates.set(a.action, a);
    let added = 0;
    const addAnim = (n) => {
      if (!Number.isInteger(n) || n < 0) return null;
      if (extra.has(n)) return extra.get(n);
      if (inStates.has(n)) return inStates.get(n);
      if (added >= EXPLOD_ANIMS) return null;
      added++;
      const a = animEntry(n, 'explod');
      extra.set(n, a);
      return a;
    };
    try {
      explodNotes = explodsIn({ L, states, outStates, domains, addAnim, ticksOf }).notes;
    } catch (e) {
      for (const s of outStates) delete s.explods;
      explodNotes = ['the Explods could not be read: ' + (e && e.message ? e.message : String(e))];
    }
    if (projectiles) projectiles.anims = [...extra.values()];
  }

  const dead = deadBlocks(L, file);
  return {
    def: defName,
    localcoord: L.localcoord || [320, 240], localcoordDeclared: !!L.localcoord,
    size: { xscale: Number.isFinite(atofFirst(L.size.get('xscale'))) ? atofFirst(L.size.get('xscale')) : 1, yscale: Number.isFinite(atofFirst(L.size.get('yscale'))) ? atofFirst(L.size.get('yscale')) : 1 },
    ikemenVersion: L.ikemenVersion,
    // sha1 of each scanned file's bytes as this read saw them: every offset in
    // the model is valid for exactly that text, so an edit passes it back.
    files: L.files.map((f) => { const ft = f.scanned ? file(f.rel) : null; return { key: f.key, rel: f.rel, path: f.path, zss: f.zss, engine: f.engine, scanned: f.scanned, found: !!f.abs, sha1: ft ? sha1(ft.text) : null }; }),
    notScanned: L.files.filter((f) => f.abs && !f.engine && f.zss).map((f) => f.rel),
    air: air ? { path: airPath, duplicates: air.duplicates, deleted: air.deleted } : null,
    multipliers: ctx.multipliers,
    states: outStates,
    attackStates: outStates.filter((s) => s.blocks.length).map((s) => s.no),
    // The attack states a HELPER runs (helperRunStates). The Moves window
    // says helpers run the moves only from this.
    helperAttackStates: (() => {
      let hs = null;
      try { hs = helperRunStates(states); } catch (e) { hs = null; }
      return hs ? outStates.filter((s) => s.blocks.length && hs.has(s.no)).map((s) => s.no) : [];
    })(),
    negativeStates: negStates,
    // projectiles: [entry] (THE PROJECTILES), projAnims: the animations they
    // draw, in the shape of a state's `anims`; projNotes: what was cut short.
    ...(projectiles ? { projectiles: projectiles.entries, projAnims: projectiles.anims, projNotes: projectiles.notes, projMugen: projectiles.mugen } : {}),
    // explodNotes: what the Explod reader cut short (each attack state's own
    // Explods ride on it as `explods`, THE EXPLODS).
    ...(explodNotes ? { explodNotes } : {}),
    dead,
    edited: charedit.listEdited(charDir),
    ...(outsiders ? { outsiders, redirected, changeAnimElems, undefinedStates, zssStates: [...states.values()].filter((st) => st.zss).map((st) => st.no), stcommonEngine: L.files.some((f) => f.key === 'stcommon' && f.engine) } : {}),
  };
}

// THE STATES A HELPER RUNS, read off the files: entered from a Helper
// controller's literal stateno, or by a ChangeState/SelfState that only a
// helper can fire (every live trigger group needs ishelper / ishelper(N),
// scenelib.ishelperNeed - Grim Reaper Mai's state 81 sends `ishelper(81)` into
// her attack states), then every state those reach by a literal ChangeState or
// SelfState. A state entered only through a computed number is not counted:
// the files do not show who enters it. -> Set of state numbers.
function helperRunStates(states) {
  const norm = (e) => String(e).toLowerCase().replace(/\s+/g, '');
  const onlyHelper = (sc) => {
    if (sc.neverTrue) return false;
    if (sc.trig.all.map(norm).some((e) => S.ishelperNeed(e))) return true;
    const groups = sc.trig.groups.map((g) => g.map(norm)).filter((g) => !g.includes('0'));
    return groups.length > 0 && groups.every((g) => g.some((e) => S.ishelperNeed(e)));
  };
  const q = [];
  for (const s of states.values()) {
    for (const sc of s.sctrls) {
      const n = sc.type === 'helper' ? S.lit(sc.params.get('stateno'))
        : (sc.type === 'changestate' || sc.type === 'selfstate') && onlyHelper(sc) ? S.lit(sc.params.get('value')) : null;
      if (n !== null) q.push(n);
    }
  }
  const seen = new Set();
  while (q.length) {
    const n = q.shift();
    if (seen.has(n) || !states.has(n)) continue;
    seen.add(n);
    for (const sc of states.get(n).sctrls) {
      if (sc.type !== 'changestate' && sc.type !== 'selfstate') continue;
      const t = S.lit(sc.params.get('value'));
      if (t !== null && !seen.has(t)) q.push(t);
    }
  }
  return seen;
}

// ---- THE PROJECTILES ------------------------------------------------------------------------------
// What a move THROWS, as an entry of its own (the Moves window's PROJECTILES
// section, GRAIL 3.10). Three ways a character puts a moving hit on screen
// are read (the Q3 census, 221 characters: P 116, H 167, E 10):
//   projectile  a Projectile controller (Shake, RyuDX, Ken): its own
//               animation, scale, spawn point, path and hit;
//   helper      a Helper whose own states hold the HitDef and move it (the CvS
//               Hadouken, Sakura, Marvin): the helper's hit state, linked to
//               the state(s) whose Helper controller makes it;
//   explod      the same with a helper that plays a blank animation while an
//               Explod draws the art (Krillin, Goku's ball): the Explod's
//               animation is the look, "drawn by an Explod".
// A helper family that never moves (pillars, traps), one bound to the body
// (BindToRoot: a hit box riding the character) and a blank helper with no
// Explod are not projectiles here. Everything is read from the files and
// nothing is run: a value written as an expression is never guessed at - the
// entry says "depends on <expr>" and leaves that number out. A per-character
// time budget keeps a WinMUGEN-era character with thousands of controllers
// from holding the window up: past it the list stops and says so.
const PROJ_BUDGET_MS = 2500;
const PROJ_MAX = 400;
const PROJ_BINDERS = new Set(['bindtoroot', 'bindtoparent', 'bindtotarget']);
const numOr = (v, d) => { const x = atofFirst(v); return Number.isFinite(x) ? x : d; };
// One numeric component: a literal, or an expression that reads nothing
// (`-(3)`, `2 * 1.5`). Anything else depends on its text. A division of two
// literals is folded the engine's way (BytecodeExp.div, bytecode.go
// 1434-1449): two whole numbers divide as whole numbers (`10/3` = 3, toward
// zero), a decimal on either side as decimals, by zero is undefined. Any
// other division is not folded: the expression reader divides as whole
// numbers only.
const DIV2_RE = /^\s*(-?(?:\d+(?:\.\d*)?|\.\d+))\s*\/\s*(-?(?:\d+(?:\.\d*)?|\.\d+))\s*$/;
function constOf(raw) {
  const r = String(raw === undefined || raw === null ? '' : raw).trim();
  if (!r) return { value: null, absent: true };
  if (NUM_RE.test(r)) return { value: Number(r), how: 'file' };
  const d2 = DIV2_RE.exec(r);
  if (d2) {
    const a = Number(d2[1]), b = Number(d2[2]);
    if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return { value: null, depends: r };
    const whole = !d2[1].includes('.') && !d2[2].includes('.');
    return { value: whole ? Math.trunc(a / b) : a / b, how: 'constant', text: r };
  }
  if (r.includes('/')) return { value: null, depends: r };
  let v = null;
  try { v = X.evalExpr(r, {}); } catch (e) { v = null; }
  if (typeof v === 'boolean') v = v ? 1 : 0;
  let pure = false;
  try { pure = X.varsOf(r).length === 0 && !X.usesRandom(r); } catch (e) { pure = false; }
  return typeof v === 'number' && Number.isFinite(v) && pure ? { value: v, how: 'constant', text: r } : { value: null, depends: r };
}
// A tuple parameter component by component, the engine's default where a
// component is absent; `depends` lists the components it could not read.
function tupleOf(params, name, defs) {
  const raw = params.get(name);
  const comps = raw === undefined ? [] : splitComponents(String(raw));
  const out = { raw: raw === undefined ? null : String(raw).trim(), values: [], depends: [] };
  defs.forEach((d, k) => {
    const c = comps[k];
    if (!c || !c.raw) { out.values.push(d); return; }
    const v = constOf(c.raw);
    if (v.value === null) { out.values.push(null); out.depends.push(c.raw); } else out.values.push(v.value);
  });
  return out;
}
const wordOf = (params, name, def) => { const v = params.get(name); return v === undefined || !String(v).trim() ? def : String(v).trim().toLowerCase(); };
const litLeaves = (raw) => {
  if (raw === undefined || raw === null) return [];
  const n = S.lit(raw);
  if (n !== null) return [n];
  try { return X.leavesOf(String(raw)).filter((v) => Number.isInteger(v)); } catch (e) { return []; }
};
const triggerText = (sc) => {
  const all = (sc.trig.all || []).map(String);
  const groups = (sc.trig.groups || []).map((g) => g.map(String).join(' && '));
  return [all.join(' && '), groups.length > 1 ? groups.map((g) => '(' + g + ')').join(' || ') : groups[0] || ''].filter(Boolean).join(' && ');
};
// MUGEN 1.0 / 1.1 or WinMUGEN, the engine's way (ParseMugenVersion,
// common.go 878-896: anything but 1.0 and 1.1 is WinMUGEN; an ikemenversion
// makes it 1.1, compiler.go 8151-8156). A WinMUGEN character's projectile
// freezes one frame less on contact (char.go 13963).
function mugenVersionOf(raw, ikemen) {
  if (ikemen) return { win: false, text: 'ikemenversion' };
  const parts = String(raw || '').split('.').map((p) => p.trim());
  const ok = parts.length >= 1 && parts.every((p) => /^\d+$/.test(p));
  const v = ok ? [parseInt(parts[0], 10), parts.length > 1 ? parseInt(parts[1], 10) : 0] : null;
  const m1 = !!v && v[0] === 1 && (v[1] === 0 || v[1] === 1);
  return { win: !m1, text: raw ? String(raw).trim() : 'not set' };
}

function projectilesIn(env) {
  const t0 = Date.now();
  const { L, states, outStates, negStates, byNo, animEntry, animsOf, ticksOf, domains } = env;
  const lc = env.localcoord;
  const localscl = 320 / (lc[0] || 320);
  const xs = numOr(L.size.get('xscale'), 1), ys = numOr(L.size.get('yscale'), 1);
  const doscale = numOr(L.size.get('proj.doscale'), 0) !== 0;
  const mugen = mugenVersionOf(L.info.get('mugenversion'), L.ikemenVersion);
  const friction = { s: numOr(L.movement.get('stand.friction'), 0.85), c: numOr(L.movement.get('crouch.friction'), 0.82) };
  const yaccel = numOr(L.movement.get('yaccel'), 0.44);
  const info = { ikemenVersion: L.ikemenVersion };
  const notes = [];
  const anims = new Map();
  const animUse = (action) => {
    if (!Number.isInteger(action) || action < 0) return null;
    if (!anims.has(action)) anims.set(action, animEntry(action, 'projectile'));
    return anims.get(action);
  };
  const blankOf = (a) => !!a && a.exists && a.frames.length > 0 && a.frames.every((f) => f.group < 0);
  const drawnOf = (a) => !!a && a.exists && a.frames.some((f) => f.group >= 0);
  const timeline = (a) => {
    if (!a || !a.exists || !a.frames.length) return null;
    const tl = airTimeline(a.frames.map((f) => f.time), a.loopStart || 0);
    return { runs: tl.runs.map((r) => ({ elem: r.elem, ticks: r.ticks, hit: !!(a.frames[r.clsn] && a.frames[r.clsn].clsn1.length) })), loopFrom: tl.loopFrom, hold: tl.hold, firstPass: tl.firstPass };
  };
  const over = () => Date.now() - t0 > PROJ_BUDGET_MS;
  const sctrlAt = (no, file, line) => { const st = states.get(no); return st ? st.sctrls.find((sc) => sc.file === file && sc.line === line) || null : null; };
  const anyState = (no) => byNo.get(no) || negStates.find((x) => x.no === no) || null;

  // HELPER FAMILIES: the literal targets of each Helper controller's stateno
  // (ifelse leaves too) and the states they reach by literal ChangeState /
  // SelfState, 8 deep and 40 states at most; the basic states (0-199,
  // 5000-5999) are the root's, not the family's.
  const fam = new Map();
  for (const st of states.values()) {
    if (st.zss) continue;
    for (const sc of st.sctrls) {
      if (sc.type !== 'helper') continue;
      for (const t of new Set(litLeaves(sc.params.get('stateno')))) {
        if (!fam.has(t)) fam.set(t, { entry: t, spawners: [] });
        fam.get(t).spawners.push({ st, sc });
      }
    }
  }
  const helperOf = new Map();
  for (const f of fam.values()) {
    const seen = [], q = [[f.entry, 0]];
    while (q.length && seen.length < 40) {
      const [n, d] = q.shift();
      if (seen.includes(n) || n < 0) continue;
      const st = states.get(n);
      if (!st || st.zss) continue;
      if (n !== f.entry && (n < 200 || (n >= 5000 && n <= 5999))) continue;
      seen.push(n);
      if (d >= 8) continue;
      for (const sc of st.sctrls) if (sc.type === 'changestate' || sc.type === 'selfstate') for (const t of litLeaves(sc.params.get('value'))) if (!seen.includes(t)) q.push([t, d + 1]);
    }
    f.reach = seen;
    for (const n of seen) { if (!helperOf.has(n)) helperOf.set(n, []); helperOf.get(n).push(f); }
  }

  // The thrower's timing, for the frame it throws on and for point blank:
  // the frame the controller fires (+1), the frames until it can act again.
  const throwerTiming = (s, frame) => (frame ? {
    frame: frame.startup, how: frame.armHow, anim: frame.anim, total: frame.total, endHow: frame.endHow,
    approx: frame.armHow !== 'file' || frame.endHow === 'assumed' || frame.endHow === null,
  } : null);
  const helperInfo = (no) => (helperOf.has(no) ? helperOf.get(no).map((f) => ({ entry: f.entry, by: [...new Set(f.spawners.map((x) => x.st.no))] })) : undefined);
  // The frame a Helper controller makes its helper on, counted on its own
  // state's frames like a Projectile (once per controller).
  const spawnMemo = new Map();
  const spawnTiming = (sp) => {
    if (spawnMemo.has(sp.sc)) return spawnMemo.get(sp.sc);
    const ts = anyState(sp.st.no);
    let out = null;
    if (ts) {
      if (!ts.anims) ts.anims = animsOf(ts);
      const firing = firingOf(sp.sc);
      ticksOf(ts, firing);
      const tfr = ts.negative ? null : FD.frameData(ts, { type: 'Helper', ctrl: 'helper', firing, params: [] }, info);
      out = { ts, timing: throwerTiming(ts, tfr) };
    }
    spawnMemo.set(sp.sc, out);
    return out;
  };
  // A Projectile thrown from a HELPER's state: point blank is the PLAYER's
  // advantage, so it is counted on the frames of the player's state that
  // makes the helper. The helper runs its tick 0 on the frame it is made
  // (char.go 13531-13535), so its frame k is the maker's frame F + k - 1.
  // Only when the state is the one the Helper controller names and the maker
  // is a state of the player's own (not another helper's): otherwise the
  // frame it throws on, counted on the player's frames, is not settled.
  const makerOf = (no) => {
    const fams = helperOf.get(no);
    if (!fams) return null;
    const f = fams.find((x) => x.entry === no);
    if (!f) return { why: 'the helper reaches state ' + no + ' by a ChangeState from state ' + fams[0].entry + ', at a time the files do not settle' };
    let sawHelper = false;
    for (const sp of f.spawners) {
      if (helperOf.has(sp.st.no)) { sawHelper = true; continue; }
      const t = spawnTiming(sp);
      if (!t || t.ts.negative || !t.timing || !t.timing.frame) continue;
      return { state: sp.st.no, file: sp.sc.file, line: sp.sc.line, timing: t.timing };
    }
    return { why: sawHelper ? 'the helper that throws it is made by another helper' : 'the frame state ' + [...new Set(f.spawners.map((x) => x.st.no))].join(', ') + ' makes the helper on is not settled' };
  };
  // A throw's timing on the PLAYER's frames: its own state's when that state
  // is the player's; its maker's (see makerOf) when it is a helper's. `via`
  // says which move that is, or `why` it is not settled (then `own` = null).
  const playerTiming = (no, timing) => {
    if (!helperOf.has(no)) return { own: timing, via: null };
    const maker = makerOf(no);
    const own = maker.timing && timing && timing.frame ? {
      frame: maker.timing.frame + timing.frame - 1, total: maker.timing.total, anim: maker.timing.anim, endHow: maker.timing.endHow,
      // (the helper's own end does not count: the player's move ends the throw)
      how: maker.timing.how, approx: !!(maker.timing.approx || timing.how !== 'file'),
    } : null;
    return { own, via: { state: maker.state === undefined ? null : maker.state, file: maker.file, line: maker.line, frame: own ? own.frame : null, helperFrame: timing ? timing.frame : null, total: own ? own.total : null, why: own ? undefined : (maker.why || 'the helper\'s own frames are not settled') } };
  };
  const hitValues = (fr) => {
    const v = (fr && fr.values) || {};
    return {
      damage: v.damage, chip: v.chip, hitstun: v.hitstun, blockstun: v.blockstun, airHitstun: v.airHitstun,
      hitstop: v.hitstop, hitstopP2: v.hitstopP2, blockstop: v.blockstop, blockstopP2: v.blockstopP2,
      guard: fr ? fr.guard : null, attr: fr ? fr.attr : null, hits: fr ? fr.hits : null, knockdown: fr ? fr.knockdown : null, juggle: fr ? fr.juggle : null,
    };
  };
  const entries = [];

  // ---- P: the Projectile controller -------------------------------------------------------------
  for (const s of [...outStates, ...negStates]) {
    if (entries.length >= PROJ_MAX || over()) break;
    for (const b of s.blocks) {
      if (b.ctrl !== 'projectile') continue;
      if (entries.length >= PROJ_MAX || over()) break;
      const sc = sctrlAt(s.no, b.file, b.line);
      if (!sc) continue;
      const P = sc.params;
      const depends = [];
      const dep = (what, expr) => { if (expr && !depends.some((d) => d.what === what && d.expr === expr)) depends.push({ what, expr }); };
      const notesE = [];
      // Its animation: projanim, 0 when absent (the zero Projectile,
      // bytecode.go 8098-8357); `F` names the common effects.
      const animRaw = P.get('projanim');
      const look = { raw: animRaw === undefined ? null : String(animRaw).trim() };
      let action = null;
      if (animRaw === undefined || !String(animRaw).trim()) { action = 0; look.how = 'default'; }
      else {
        const r = animRef(animRaw, domains);
        if (r.foreign) look.how = 'fightfx';
        else if (r.literal) { action = r.candidates[0]; look.how = 'file'; }
        else if (r.candidates.length) { action = r.candidates[0]; look.how = 'candidates'; look.candidates = r.candidates.slice(0, 8); dep('its animation', look.raw); }
        else { look.how = 'depends'; dep('its animation', look.raw); }
      }
      if (action !== null && action < -2) { notesE.push('projanim ' + action + ' is below -2: the engine plays action 0 and warns (char.go 7614-7616)'); action = 0; }
      const a = action !== null ? animUse(action) : null;
      look.action = action;
      look.exists = !!(a && a.exists);
      if (action !== null && !look.exists) notesE.push('action ' + action + ' is not in the .air: the engine copies the animation the thrower is playing (the MUGEN fallback, char.go 7631-7640)');
      look.blank = blankOf(a);
      const animNo = (name) => {
        const v = P.get(name);
        if (v === undefined || !String(v).trim()) return null;
        const r = animRef(v, domains);
        if (r.literal) return { action: r.candidates[0], how: 'file' };
        if (r.foreign) return { foreign: String(v).trim(), how: 'fightfx' };
        dep(name, String(v).trim());
        return { depends: String(v).trim(), how: 'depends' };
      };
      // hitanim -1 = gone on contact; an unset remanim copies hitanim and an
      // unset cancelanim copies remanim (bytecode.go 8334-8345).
      const hitA = animNo('projhitanim') || { action: -1, how: 'default' };
      const remA = animNo('projremanim') || Object.assign({}, hitA, { how: 'from projhitanim' });
      const canA = animNo('projcancelanim') || Object.assign({}, remA, { how: 'from projremanim' });

      // Scale: drawn at projscale (x [Size] only with size.proj.doscale,
      // char.go 7648-7652); its boxes at [Size] unless projclsnscale (7654-7657).
      const ps = tupleOf(P, 'projscale', [1, 1]);
      for (const d of ps.depends) dep('its scale', d);
      const pcs = P.has('projclsnscale') ? tupleOf(P, 'projclsnscale', [1, 1]) : null;
      if (pcs) for (const d of pcs.depends) dep('its box scale', d);
      const scale = {
        draw: ps.values.map((v, k) => (v === null ? null : v * (doscale ? (k ? ys : xs) : 1))),
        drawHow: doscale ? 'projscale x [Size] scale (size.proj.doscale)' : (ps.raw === null ? 'projscale not set: 1' : 'projscale'),
        clsn: pcs ? pcs.values : [xs, ys], clsnHow: pcs ? 'projclsnscale' : '[Size] xscale, yscale (projscale does not scale the boxes)',
      };

      // Where it appears (helperPos, char.go 6978-7035).
      const postype = wordOf(P, 'postype', 'p1');
      const off = tupleOf(P, 'offset', [0, 0]);
      for (const d of off.depends) dep('where it appears', d);
      if (!P.has('offset') && P.has('pos')) notesE.push('`pos` is not a Projectile parameter (an Explod\'s): the engine ignores it and the projectile appears at the axis, offset 0,0');

      // How it flies.
      const vel = tupleOf(P, 'velocity', [0, 0]), acc = tupleOf(P, 'accel', [0, 0]), vm = tupleOf(P, 'velmul', [1, 1]);
      for (const d of vel.depends) dep('its speed', d);
      for (const d of acc.depends) dep('its acceleration', d);
      for (const d of vm.depends) dep('its speed multiplier', d);
      const intOf = (name, def) => { if (!P.has(name)) return { value: def, how: 'default' }; const c = constOf(P.get(name)); if (c.value === null) { if (!c.absent) dep(name, c.depends); return { value: c.absent ? def : null, how: c.absent ? 'default' : 'depends' }; } return { value: Math.trunc(c.value), how: 'file' }; };
      const removetime = intOf('projremovetime', -1);
      const hits = intOf('projhits', 1), misstime = intOf('projmisstime', 0), priority = intOf('projpriority', 1);
      const edgebound = intOf('projedgebound', Math.trunc(40 / localscl)), stagebound = intOf('projstagebound', Math.trunc(40 / localscl));
      const hb = tupleOf(P, 'projheightbound', [Math.trunc(-240 / localscl), Math.trunc(1 / localscl)]);
      for (const d of hb.depends) dep('projheightbound', d);
      const tl = timeline(a);
      // Its hit box is unknown, not absent, when its animation is: a formula
      // with no candidate, the common effects, or an action the .air lacks
      // (the engine then copies whatever the thrower is playing).
      const hitWhy = look.exists ? null
        : look.how === 'depends' ? 'its animation is a formula (' + look.raw + ')'
          : look.how === 'fightfx' ? 'its animation is one of the common effects (' + look.raw + '), whose boxes are not read here'
            : 'action ' + action + ' is not in the .air, so it plays a copy of whatever the thrower is playing';
      const known = (xs2) => xs2.every((v) => v !== null);
      let path = null;
      if (known(vel.values) && known(acc.values) && known(vm.values) && known(off.values) && known(hb.values) && removetime.value !== null) {
        path = FD.projectilePath({
          pos: [postype === 'p1' ? off.values[0] : 0, off.values[1]], vel: vel.values, accel: acc.values, velmul: vm.values,
          removetime: removetime.value, heightbound: hb.values, runs: tl && tl.runs, loopFrom: tl && tl.loopFrom, hold: tl && tl.hold, firstPass: tl && tl.firstPass,
          hitUnknown: hitWhy,
        });
      }
      // Without a path, the animation alone still says when its first hit box shows.
      let firstHit = path ? path.firstHit : null;
      if (!path && tl) {
        let t = 0;
        for (const r of tl.runs) { if (r.hit) { firstHit = t; break; } t += r.ticks; }
        if (firstHit !== null && removetime.value !== null && removetime.value >= 0 && firstHit >= removetime.value) firstHit = null;
      }
      // Leaving the screen, with the camera still: from the middle of a
      // screen, and corner to corner (its width + edgebound).
      let screen = null;
      if (path && edgebound.value !== null) {
        const x0 = postype === 'p1' ? off.values[0] : 0;
        const firstPast = (dist) => { const k = path.pts.findIndex((p) => Math.abs(p[0] - x0) > dist); return k < 0 ? null : k; };
        screen = { middle: firstPast(lc[0] / 2 + edgebound.value), corner: firstPast(lc[0] + edgebound.value), width: lc[0], edgebound: edgebound.value };
        // Points past the far screen edge can never be on screen: not sent.
        if (screen.corner !== null && path.pts.length > screen.corner + 1) { path.pts.length = screen.corner + 1; path.cut = 'screen'; }
      }
      const fr = b.frame || null;
      const thrower = throwerTiming(s, fr);
      // A negative state's block has no readout of its own (it runs in any
      // state): its hit values are read the same way all the same.
      const v = hitValues(fr || FD.frameData(s, b, info));
      // Thrown from a helper's state: the player's frames are its maker's.
      const { own, via } = playerTiming(s.no, thrower);
      const contact = own && own.frame !== null && own.frame !== undefined && firstHit !== null ? own.frame + firstHit : null;
      const pb = FD.pointBlank(own, v, contact);
      if (pb && depends.length && pb.frame !== null) pb.approx = pb.approx || depends.some((d) => d.what === 'its animation');
      // Why there is no point blank, in words (the page prints it as is).
      if (pb.frame === null) {
        pb.why = s.negative ? 'it is thrown from a negative state (it runs in any state), so no frame of a move is its own'
          : via && via.why ? 'it is thrown by a helper and ' + via.why
            : hitWhy ? 'its hit box is unknown: ' + hitWhy
              : !path && firstHit === null && !tl ? 'its hit box is unknown'
                : firstHit === null ? (tl && !tl.runs.some((r) => r.hit) ? 'its animation has no hit box' : 'it is gone before its animation shows a hit box')
                  : 'the thrower\'s frames are not settled';
      }
      const ptxt = P.get('pausetime');
      const freezeRaw = constOf(ptxt === undefined ? '0' : splitComponents(String(ptxt))[0].raw);
      const entry = {
        id: 'P|' + b.file + '|' + b.line, kind: 'projectile',
        thrower: { state: s.no, file: b.file, line: b.line, ctrl: 'Projectile', negative: !!s.negative, helper: helperInfo(s.no), timing: thrower, via },
        block: { file: b.file, state: s.no, ordinal: b.ordinal },
        look, hitAnim: hitA, remAnim: remA, cancelAnim: canA,
        scale, spawn: { postype, offset: off.values, raw: off.raw },
        motion: { velocity: vel.values, accel: acc.values, velmul: vm.values, raw: { velocity: vel.raw, accel: acc.raw, velmul: vm.raw } },
        life: { removetime, hits, misstime, priority, heightbound: hb.values, edgebound, stagebound },
        path, screen, firstHit, values: v, pointBlank: pb,
        freeze: freezeRaw.value === null ? null : Math.max(0, Math.trunc(freezeRaw.value) - (mugen.win ? 1 : 0)),
        depends, notes: notesE,
      };
      if (look.blank && postype === 'p2') notesE.push('an invisible hit placed on the opponent (a blank animation at P2)');
      else if (look.blank) notesE.push('its animation is blank: an invisible hit');
      if (tl && !tl.runs.some((r) => r.hit)) notesE.push('action ' + action + ' has no Clsn1 (hit box): this projectile cannot hit');
      else if (tl && firstHit === null && path) notesE.push('it is gone at tick ' + path.end.tick + ', before its animation shows a hit box');
      if (via && via.frame) notesE.push('thrown by a helper: it appears on frame ' + via.frame + ' of state ' + via.state + ', the move that makes the helper (the helper\'s own frame ' + via.helperFrame + '), and point blank is counted on that move\'s frames');
      entries.push(entry);
      // The thrower's own row reads the projectile (point blank, labeled).
      // Recovery is the player's: after it appears, until the player acts.
      const recov = via ? (via.frame && via.total !== null && via.total !== undefined ? via.total - via.frame : null)
        : (fr && fr.total !== null && fr.total !== undefined && fr.startup ? fr.total - fr.startup : null);
      if (fr) fr.proj = { id: entry.id, contact, recovery: recov, onHit: pb.onHit, onBlock: pb.onBlock, approx: pb.approx, activeTicks: path ? path.activeTicks : null, ends: path ? path.end.why : null, life: path && path.end.why !== 'cap' ? path.end.tick : null, by: via ? via.state : undefined };
    }
  }

  // A state as the helper walk (framedata.helperChain) enters it: its
  // statedef's physics, velset and anim (each absent = kept), its controllers.
  // The basic states (0-199, 5000-5999: the root's common states) and the
  // .zss ones are not followed.
  const chainMemo = new Map();
  // An animation as the walk plays it: its timeline (with `hit` per run), its
  // totaltime / looptime (AnimTime) and each element's start (AnimElemTime).
  const animOf = (act) => {
    const a = Number.isInteger(act) && act >= 0 ? (anims.get(act) || animEntry(act, 'projectile')) : null;
    if (a && a.exists && a.frames.length) {
      const tl = timeline(a), tot = airTotals(a.frames.map((x) => x.time), a.loopStart || 0);
      return { anim: { action: act, runs: tl.runs, loopFrom: tl.loopFrom, hold: tl.hold, totaltime: tot.totaltime, looptime: tot.looptime, starts: a.frames.map((x) => x.start) } };
    }
    return { anim: { action: Number.isInteger(act) ? act : null, runs: [], loopFrom: 0, hold: true, totaltime: -1, looptime: 0, starts: [] }, animWhy: Number.isInteger(act) ? 'action ' + act + ' is not in the .air' : 'its animation is not settled' };
  };
  // The helper's FIRST state is always walked from its own definition (as the
  // single-state walk did), whatever its number: a helper made straight into
  // a state numbered 0-199 runs the character's own state of that number.
  const chainState = (no, first) => {
    const mk = first ? 'first|' + no : no;
    if (chainMemo.has(mk)) return chainMemo.get(mk);
    let out;
    const st = states.get(no);
    if (!st) out = { notFollowed: 'state ' + no + ' is not in its files' };
    else if (st.zss && !first) out = { notFollowed: 'state ' + no + ' is written in .zss, which is not read here' };
    else if (!first && (no < 200 || (no >= 5000 && no <= 5999))) out = { notFollowed: 'state ' + no + ' is one of the common states (0-199, 5000-5999)' };
    else {
      const hvRaw = st.header.get('velset');
      const hv = hvRaw === undefined ? null : splitComponents(String(hvRaw)).slice(0, 2).map((c) => constOf(c.raw));
      const phRaw = st.header.get('physics');
      const physics = phRaw === undefined || !String(phRaw).trim() ? 'n' : String(phRaw).trim().charAt(0).toLowerCase();
      const anRaw = st.header.get('anim');
      let anim = null, animWhy = null;
      if (anRaw !== undefined && String(anRaw).trim()) {
        const r = animRef(anRaw, domains);
        const d = animOf(r.literal ? r.candidates[0] : null);
        anim = d.anim; animWhy = d.animWhy ? d.animWhy + ' (state ' + no + ')' : null;
        if (!r.literal) animWhy = 'the animation of state ' + no + ' is a formula (' + String(anRaw).trim() + ')';
      }
      // where the state's own frame data arms its HitDef (a fallback for a trigger the walk cannot settle)
      out = {
        no, sctrls: st.sctrls, physics, anim, animWhy, file: (st.sctrls[0] && st.sctrls[0].file) || null, line: st.line,
        headerVel: hv ? hv.map((c) => (c.value === null ? null : c.value)) : null,
        velDepends: hv && hv.some((c) => c.value === null && !c.absent) ? String(hvRaw).trim() : null,
      };
    }
    chainMemo.set(mk, out);
    return out;
  };
  const armOf = (no) => {
    const s = byNo.get(no);
    const b = s && s.blocks.find((x) => x.ctrl === 'hitdef' && !FD.neverHits(x) && x.frame && x.frame.armFrame);
    return b ? b.frame.armFrame - 1 : null;
  };

  // ---- H and E: a helper that flies ----------------------------------------------------------
  for (const f of [...fam.values()].sort((p, q) => p.entry - q.entry)) {
    if (entries.length >= PROJ_MAX || over()) break;
    const famStates = f.reach.map((n) => states.get(n)).filter(Boolean);
    if (famStates.some((st) => st.sctrls.some((sc) => PROJ_BINDERS.has(sc.type)))) continue;
    // Its hit: the first HitDef that can hit, never a "Miss" marker before it
    // (framedata.neverHits) - Capcom vs SNK helpers open with one.
    const canHit = (b) => b.ctrl === 'hitdef' && !FD.neverHits(b);
    const hitS = f.reach.map((n) => byNo.get(n)).find((s) => s && s.blocks.some(canHit));
    if (!hitS) continue;
    const hb = hitS.blocks.find((b) => canHit(b) && b.frame && b.frame.startup) || hitS.blocks.find(canHit);
    const entrySt = states.get(f.entry);
    if (!entrySt) continue;
    const hv = entrySt.header.get('velset');
    const headerVel = hv === undefined ? null : splitComponents(String(hv)).slice(0, 2).map((c) => constOf(c.raw));
    const nonzero = (raw) => { const c = constOf(raw); return c.value === null ? !c.absent : c.value !== 0; };
    const moves = (headerVel && headerVel[0] && (headerVel[0].value === null ? !headerVel[0].absent : headerVel[0].value !== 0))
      || famStates.some((st) => st.sctrls.some((sc) => (sc.type === 'velset' || sc.type === 'veladd' || sc.type === 'posadd') && sc.params.get('x') !== undefined && nonzero(sc.params.get('x'))));
    const fr = hb.frame || null;
    const helperAnim = fr && fr.anim !== null ? (hitS.anims || []).find((x) => x.action === fr.anim) || null : null;
    const blank = helperAnim ? blankOf(helperAnim) : false;
    // E: the Explod that draws a blank helper - in the family's own states
    // first, then in the throwing state (matched by state, not by ID).
    let explod = null;
    if (blank) {
      const cands = [];
      for (const st of famStates) for (const sc of st.sctrls) if (sc.type === 'explod') cands.push({ st, sc, where: 'the helper\'s state ' + st.no });
      for (const sp of f.spawners) for (const sc of sp.st.sctrls) if (sc.type === 'explod') cands.push({ st: sp.st, sc, where: 'the throwing state ' + sp.st.no, spawnSc: sp.sc });
      const resolved = cands.slice(0, 24).map((c) => {
        const raw = c.sc.params.get('anim');
        const r = animRef(raw === undefined ? '' : raw, domains);
        const act = r.literal || r.candidates.length ? r.candidates[0] : null;
        const a = r.foreign || !Number.isInteger(act) || act < 0 ? null : (anims.get(act) || animEntry(act, 'projectile'));
        return Object.assign({}, c, { raw: raw === undefined ? null : String(raw).trim(), r, action: act, a, drawn: drawnOf(a), foreign: !!r.foreign });
      });
      // In the throwing state, the Explod that fires with the Helper first.
      const sameTick = (c) => {
        if (!c.spawnSc) return false;
        const strip = (sc) => triggerText(sc).replace(/\s+/g, '').toLowerCase();
        return strip(c.sc) === strip(c.spawnSc);
      };
      explod = resolved.find((c) => c.drawn && !c.spawnSc) || resolved.find((c) => c.drawn && sameTick(c)) || resolved.find((c) => c.drawn) || resolved.find((c) => c.foreign) || null;
      if (explod && explod.a === null && !explod.foreign) explod = null;
    }
    if (!moves && !explod) continue;
    const kind = explod ? 'explod' : 'helper';
    // Its own flight, from its first state through every state a ChangeState
    // the files settle takes it to (framedata.helperChain): its frames, path
    // and hit are counted where the hit really is.
    const physics = String(entrySt.header.get('physics') || 'n').trim().charAt(0).toLowerCase();
    const sameState = hitS.no === f.entry;
    const throwers = [];
    for (const sp of f.spawners) {
      const t = spawnTiming(sp);
      if (!t) continue;
      const ts = t.ts;
      const H = sp.sc.params;
      const pos = tupleOf(H, 'pos', [0, 0]);
      const hf = constOf(H.get('facing') === undefined ? '1' : H.get('facing'));
      // Its own size: a helper starts at its maker's [Size] and the Helper
      // controller's size.xscale / size.yscale replace it (newHelper char.go
      // 6923, Helper.Run bytecode.go 5642-5645); it is DRAWN at that size
      // (cueDraw char.go 13038-13041). Its boxes stay at the animation
      // owner's [Size] unless ownclsnscale = 1 (updateClsnScale 7854-7866).
      const sizeOf = (k) => (H.get(k) === undefined || !String(H.get(k)).trim() ? { absent: true } : constOf(H.get(k)));
      const ocs = H.get('ownclsnscale') === undefined ? null : constOf(H.get('ownclsnscale'));
      throwers.push({
        state: sp.st.no, file: sp.sc.file, line: sp.sc.line, ctrl: 'Helper', negative: !!ts.negative, helper: helperInfo(sp.st.no),
        timing: t.timing, postype: wordOf(H, 'postype', 'p1'), pos: pos.values, posRaw: pos.raw,
        facing: hf.value === null ? null : (hf.value < 0 ? -1 : 1), helpertype: wordOf(H, 'helpertype', 'normal'),
        id: H.get('id') === undefined ? null : String(H.get('id')).trim(),
        size: { x: sizeOf('size.xscale'), y: sizeOf('size.yscale'), own: ocs ? (ocs.value === null ? null : ocs.value !== 0) : false, ownRaw: ocs && ocs.value === null ? String(H.get('ownclsnscale')).trim() : undefined },
      });
    }
    if (!throwers.length) continue;
    const t0w = throwers[0];
    const depends = [];
    if (headerVel) headerVel.forEach((c) => { if (c.value === null && !c.absent) depends.push({ what: 'its speed', expr: c.depends }); });
    for (const d of (t0w.pos || []).map((x, k) => (x === null ? k : -1)).filter((k) => k >= 0)) depends.push({ what: 'where it appears', expr: splitComponents(String(t0w.posRaw))[d].raw });
    let path = null;
    if (!depends.length && t0w.pos.every((x) => x !== null)) {
      path = FD.helperChain({
        first: chainState(f.entry, true), stateOf: (n) => chainState(n), armOf, animOf,
        friction, yaccel, pos: [t0w.postype === 'p1' ? t0w.pos[0] : 0, t0w.pos[1]], hf: t0w.facing || 1,
        num: (raw) => constOf(raw).value,
      });
      if (path.end.why === 'depends') depends.push({ what: 'its path after tick ' + path.end.tick, expr: path.end.text, file: path.end.file, line: path.end.line });
      const cut = Math.trunc(lc[0] + 40 / localscl);
      const k = path.pts.findIndex((p) => Math.abs(p[0] - path.pts[0][0]) > cut + Math.abs(t0w.pos[0] || 0));
      if (k >= 0) { path.pts.length = k + 1; path.cut = 'screen'; }
      for (const sg of path.chain) {
        // each state's own frames ride along (projAnims)
        if (sg.action !== null && sg.action !== undefined) animUse(sg.action);
        const cs = states.get(sg.state);
        sg.statedefLine = cs && cs.line !== undefined ? cs.line : undefined;
      }
    }
    // Where its hit really is: the walk reached the hit state and its HitDef
    // fired there at a tick the files settle (then the entry counts it, as for
    // a hit in its first state); otherwise the later state keeps its own row.
    const hitSeg = path ? path.chain.find((sg) => sg.state === hitS.no && sg.hit) || path.chain.find((sg) => sg.hit) || null : null;
    const counted = !!(path && hitSeg && !path.hitUnknown && path.firstHit !== null);
    const reached = path ? path.chain.find((sg) => sg.state === hitS.no) || null : null;
    const laterWhy = !reached ? 'its hit is in state ' + hitS.no + ', which the walk from state ' + f.entry + ' does not reach' + (path ? ' in its ' + path.end.tick + ' frames' : '') + ': the ChangeState that leads there depends on the game or never fires on the files\' own numbers'
      : 'it reaches state ' + hitS.no + ' (its hit) on its frame ' + (reached.from + 1) + ', and the walk stops there: ' + (path.end.why === 'depends' ? 'what it does next depends on ' + path.end.text : 'its hit box never shows at a frame the files settle');
    // A hit in a later state the walk does not reach at a settled tick: its
    // hit box along the walk is unknown, not absent (as before).
    if (path && !sameState && !counted && !path.hitUnknown) Object.assign(path, { firstHit: null, activeTicks: null, hitUnknown: laterWhy });
    const v = hitValues(fr);
    // Made by a helper's state: the player's frames are that helper's maker's.
    const { own, via } = playerTiming(t0w.state, t0w.timing);
    // The frame it first hits, counted on the PLAYER's frames: the helper's
    // tick 0 is the frame it is made (F), so its tick c is the player's F + c,
    // less every frame a Pause the helper called froze the player before then.
    // A hit while that pause still freezes both players is not worked out.
    let contact = null, pauseWhy = null, pausedBefore = 0;
    if (counted && path.firstHit !== null && own && own.frame) {
      const c = path.firstHit;
      for (const pz of path.pauses) {
        if (pz.tick >= c) continue;
        if (c <= pz.tick + pz.time) { pauseWhy = 'it first hits on its frame ' + (c + 1) + ', while the ' + pz.kind + ' it calls in state ' + pz.state + ' (' + pz.file + ' line ' + pz.line + ', ' + pz.time + ' frames) still freezes the player and the opponent: how both come out of it is not worked out here'; break; }
        pausedBefore += pz.time;
      }
      if (!pauseWhy) contact = own.frame + c - pausedBefore;
    }
    // (A hit in its first state the walk cannot settle keeps the frame data's
    // own startup, as before: marked ≈ when that rests on an assumption.)
    if (contact === null && !pauseWhy && sameState && own && own.frame && fr && fr.startup && (!path || path.firstHit === null)) contact = own.frame + fr.startup - 1;
    const pb = FD.pointBlank(contact === null ? null : own, v, contact);
    if (pb && fr && fr.armHow !== 'file') pb.approx = true;
    if (pb && pausedBefore) pb.approx = true;
    // A pause in the move that makes it (a SuperPause, the helper's
    // supermovetime / pausemovetime) shifts the player's frames against the
    // helper's: not counted, so the number is marked.
    const makerPause = throwers.some((tw) => { const ms = states.get(tw.state); return !!ms && ms.sctrls.some((sc) => sc.type === 'pause' || sc.type === 'superpause'); });
    if (pb && pb.frame !== null && makerPause && !sameState) pb.approx = true;
    if (pb.frame === null) {
      pb.why = pauseWhy ? pauseWhy
        : !counted && !sameState ? (reached || path ? laterWhy : 'its hit is in state ' + hitS.no + ', which the helper changes to at a time the walk does not settle')
          : t0w.negative ? 'it is made from a negative state (it runs in any state), so no frame of a move is its own'
            : via && via.why ? 'it is made by a helper and ' + via.why
              : path && path.hitUnknown ? 'its hit box is unknown: ' + path.hitUnknown
                : 'the frame it is made on or the frame it hits on is not settled';
    }
    // Its size (see the throwers above): the first thrower's Helper controller.
    const sz = t0w.size;
    const sizeDep = [];
    const sizeVal = (c, d, k) => { if (c.absent) return d; if (c.value === null) { sizeDep.push({ what: 'its size (' + k + ')', expr: c.depends, file: t0w.file, line: t0w.line }); return null; } return c.value; };
    const draw = [sizeVal(sz.x, xs, 'size.xscale'), sizeVal(sz.y, ys, 'size.yscale')];
    const setsSize = !sz.x.absent || !sz.y.absent;
    if (sz.own === null) sizeDep.push({ what: 'whether its boxes use its own size (ownclsnscale)', expr: sz.ownRaw, file: t0w.file, line: t0w.line });
    const scale = {
      draw,
      drawHow: setsSize ? 'size.xscale / size.yscale on its Helper controller (' + t0w.file + ' line ' + t0w.line + ')' + (sz.x.absent || sz.y.absent ? '; the other is its maker\'s [Size]' : '')
        : 'its Helper controller sets no size.xscale / size.yscale, so it keeps its maker\'s [Size] scale',
      clsn: sz.own ? draw.slice() : [xs, ys],
      clsnHow: sz.own ? 'its own size (ownclsnscale = 1 on its Helper controller)' : 'the animation owner\'s [Size] xscale, yscale (updateClsnScale, char.go 7854-7866)' + (setsSize ? ': its own size does not scale its boxes' : ''),
      sized: setsSize,
    };
    const ptxt = hb.params.find((p) => p.name === 'pausetime');
    const entry = {
      id: 'H|' + f.entry, kind,
      thrower: Object.assign({}, t0w, { via }), throwers,
      block: { file: hb.file, state: hitS.no, ordinal: hb.ordinal }, entryState: f.entry, hitState: hitS.no, family: f.reach.slice(0, 12),
      hitLater: !sameState && !counted,
      look: { action: helperAnim ? helperAnim.action : null, exists: !!(helperAnim && helperAnim.exists), blank, how: 'the helper\'s animation' },
      scale,
      spawn: { postype: t0w.postype, offset: t0w.pos, raw: t0w.posRaw, facing: t0w.facing },
      motion: { headerVel: headerVel ? headerVel.map((c) => c.value) : null, physics },
      path, firstHit: path && path.firstHit !== null ? path.firstHit : (sameState && fr && fr.startup ? fr.startup - 1 : null), values: v, pointBlank: pb,
      // the state its HitDef fires in, as the walk found it
      hitAt: hitSeg ? { state: hitSeg.state, tick: hitSeg.hit.tick, file: hitSeg.hit.file, line: hitSeg.hit.line } : null,
      freeze: ptxt && ptxt.values[0] && ptxt.values[0].tier === 'green' ? Math.trunc(Number(ptxt.values[0].raw)) : (ptxt ? null : 0),
      depends: depends.concat(sizeDep), notes: [],
    };
    if (!sameState && !counted) entry.notes.push(laterWhy.charAt(0).toUpperCase() + laterWhy.slice(1) + ': its active frames, its life and point blank are not worked out here. State ' + hitS.no + ' keeps its own row in the list');
    if (!sameState && counted) entry.notes.push('followed through its states: ' + path.chain.map((sg) => sg.state).join(' → ') + '; its HitDef fires in state ' + hitSeg.state + ' on its frame ' + (hitSeg.hit.tick + 1) + ', and its active frames, life and point blank are counted there');
    if (path && path.end.why === 'cap') entry.notes.push(path.end.states ? 'the walk follows ' + FD.CHAIN_STATES + ' states at most' : 'the walk follows ' + FD.CHAIN_TICKS + ' frames at most: it is still going in state ' + path.chain[path.chain.length - 1].state);
    if (path && path.end.notFollowed) entry.notes.push('it changes to state ' + path.end.to + ' on its frame ' + (path.end.tick + 1) + ', which is not followed: ' + path.end.notFollowed);
    if (path && path.pauses.length) for (const pz of path.pauses) entry.notes.push('state ' + pz.state + ' calls a ' + pz.kind + ' on its frame ' + (pz.tick + 1) + ' (' + pz.file + ' line ' + pz.line + '): the player and the opponent stand frozen for ' + pz.time + ' frames while it ' + (pz.movetime >= pz.time ? 'goes on moving (movetime ' + pz.movetime + ')' : 'moves for ' + pz.movetime + ' of them (movetime) and then stands still too'));
    if (makerPause && !sameState && pb && pb.frame !== null) entry.notes.push('the move that makes it pauses the game (Pause / SuperPause): the player\'s frames against the helper\'s are not counted for it, so point blank is ≈');
    if (throwers.some((t) => ['x', 'y'].some((k) => (t.size[k].absent ? null : t.size[k].value) !== (sz[k].absent ? null : sz[k].value)))) entry.notes.push('the states that make it give it different sizes; drawn at the first one\'s (state ' + t0w.state + ')');
    if (!setsSize && t0w.helper) entry.notes.push('its maker is itself a helper, whose own size it starts at; drawn here at [Size]');
    if (via && via.frame) entry.notes.push('made by a helper: it appears on frame ' + via.frame + ' of state ' + via.state + ', the move that makes that helper, and point blank is counted on that move\'s frames');
    if (helperAnim && helperAnim.exists) animUse(helperAnim.action);
    if (explod) {
      if (explod.a && explod.a.exists) animUse(explod.action);
      const X2 = explod.sc.params;
      const sc2 = tupleOf(X2, 'scale', [1, 1]), pos2 = tupleOf(X2, 'pos', [0, 0]), vel2 = tupleOf(X2, 'vel', [0, 0]);
      entry.explod = {
        file: explod.sc.file, line: explod.sc.line, state: explod.st.no, where: explod.where,
        anim: { raw: explod.raw, action: explod.action, foreign: explod.foreign, candidates: explod.r.literal ? undefined : explod.r.candidates.slice(0, 8), exists: !!(explod.a && explod.a.exists) },
        scale: sc2.values, pos: pos2.values, postype: wordOf(X2, 'postype', 'p1'), vel: vel2.values,
        bindtime: X2.has('bindtime') ? String(X2.get('bindtime')).trim() : null, removetime: X2.has('removetime') ? String(X2.get('removetime')).trim() : null,
        // its own `facing` / `vfacing` mirror the sprite (cueDraw char.go 2157-2330; THE EXPLODS)
        facing: (constOf(X2.has('facing') ? X2.get('facing') : '1').value || 1) < 0 ? -1 : 1,
        vfacing: (constOf(X2.has('vfacing') ? X2.get('vfacing') : '1').value || 1) < 0 ? -1 : 1,
      };
      if (!explod.r.literal && !explod.foreign) entry.depends.push({ what: 'the Explod\'s animation', expr: explod.raw });
      for (const d of [...sc2.depends, ...pos2.depends, ...vel2.depends]) entry.depends.push({ what: 'the Explod', expr: d });
    }
    entries.push(entry);
  }

  // ---- what each attack state's row needs: the helper's hit state names its thrower.
  // `stands` = the entry carries its numbers (its hit is in the helper's
  // first state), so the page lists it once, in PROJECTILES; a hit in a later
  // state keeps its own row, the only place its frames are counted.
  for (const e of entries) {
    if (e.kind === 'projectile') continue;
    const hs = byNo.get(e.hitState);
    if (hs) hs.thrownBy = { id: e.id, states: e.throwers.map((t) => t.state), stands: !e.hitLater };
  }
  if (over()) notes.push('the projectile reader stopped after ' + PROJ_BUDGET_MS + ' ms: ' + entries.length + ' entries are listed, the rest are not');
  if (entries.length >= PROJ_MAX) notes.push('only the first ' + PROJ_MAX + ' projectiles are listed');
  entries.sort((p, q) => p.thrower.state - q.thrower.state || (p.thrower.file < q.thrower.file ? -1 : p.thrower.file > q.thrower.file ? 1 : p.thrower.line - q.thrower.line));
  return { entries, anims: [...anims.values()], notes, size: { xscale: xs, yscale: ys, doscale }, mugen };
}

// ---- THE EXPLODS -------------------------------------------------------------------------------------
// The art a move's OWN state spawns with Explod controllers, drawn in the Moves
// window under the boxes (the owner, 2026-10-19: "A root hit with Explod art.
// Shouldn't those include the art too? They explain the hitboxes. They should
// render behind the hit box." - Shake's lawnmower, state 1213: the root's long
// Clsn1 belongs to an Explod). Every Explod of every attack state is listed;
// one is DRAWN only when the files settle all of it: a literal animation in
// the .air, postype p1 in stage space (the place relative to the character's
// axis; p2 / front / back / left / right / none need the opponent or the
// screen), literal numbers, and a spawn tick its triggers settle (AnimElem,
// Time). The engine's rules (Ikemen GO f598853):
//   defaults   initFromChar char.go 1691-1736: bindtime 1, scale 1,1,
//              removetime -2, postype p1, facing 1, layerno the character's;
//              a MUGEN 1.1 / Ikemen character's postype is None (explod.Run
//              bytecode.go 6202-6205; an ikemenversion counts as 1.1,
//              compiler.go 8151-8156); friction 1 (1730);
//   parameters explod.Run bytecode.go 6186-6497, in the compiler's order
//              (explodSub compiler_functions.go 855-1064): `vel` or
//              `velocity`; sprpriority, then ontop (layer 1 and sprpriority 0
//              when true, layer 0 when false), then layerno (-1 / 0 / 1);
//   place      setPos char.go 1767-1847: p1 = the character's position, pos
//              along its facing (relativePos[0] *= c.facing);
//   each frame explodUpdate runs after the characters have moved
//              (system.go 2995-3049); Explod.update char.go 1941-2155:
//              removed at the start of the update once time >= removetime,
//              or (removetime <= -2) once its animation has played through;
//              while bindtime != 0 it sits on the character's position this
//              frame (+ pos), then time++, bindtime-- (when > 0), newPos =
//              pos + velocity along the facing it was made with, velocity =
//              velocity * friction + accel; its animation shows tick `age`
//              (UpdateSprite before Action);
//   draw       cueDraw char.go 2157-2330: scale x (320 / localcoord) - NOT the
//              character's [Size]; facing x the `facing` parameter mirrors the
//              sprite, not the motion; layers system.go 3869-3966 and
//              DrawList.draw anim.go 1341-1420: layer 1 over the characters,
//              -1 and `under` below, in layer 0 the higher sprpriority on top
//              and, at equal sprpriority, the character (queued first,
//              system.go 2893-2909) over the Explod.
// Each drawn Explod carries, per animation of its state and per spawn tick T,
// one point per tick of that animation's first pass from T on while it lives:
// [element index of its own animation, x, y, bound], x and y in the
// character's units RELATIVE TO THE CHARACTER'S AXIS ON THAT TICK (x ahead).
// A bound Explod rides with the character: x, y = pos. Once unbound it stays
// where the character was (plus its own motion) while the character moves on:
// the character's own motion in the move is walked with framedata.helperPath
// (its statedef velset - the view assumes a start at rest when there is none -
// and its time-only VelSet / VelAdd / PosAdd, contact read as 0: the move
// whiffs). Where that walk stops, an unbound Explod's place is unknown (null).
const EXPLOD_BUDGET_MS = 1500;
const EXPLOD_MAX = 600;        // Explod controllers read per character
const EXPLOD_PER_STATE = 24;   // per state
const EXPLOD_TICKS = 400;      // ticks of one move followed at most (framedata MAX_METER)
const EXPLOD_POINTS = 60000;   // timeline points per character
const EXPLOD_ANIMS = 200;      // animations added to the answer for them
function explodsIn(env) {
  const t0 = Date.now();
  const { L, states, outStates, domains, addAnim, ticksOf } = env;
  const xs = numOr(L.size.get('xscale'), 1), ys = numOr(L.size.get('yscale'), 1);
  const mv = String(L.info.get('mugenversion') || '').split('.').map((p) => p.trim());
  const is11 = !!L.ikemenVersion || (mv.length >= 2 && mv.every((p) => /^\d+$/.test(p)) && +mv[0] === 1 && +mv[1] === 1);
  const friction = { s: numOr(L.movement.get('stand.friction'), 0.85), c: numOr(L.movement.get('crouch.friction'), 0.82) };
  const yaccel = numOr(L.movement.get('yaccel'), 0.44);
  const notes = [];
  let count = 0, points = 0, capped = null;
  const over = () => Date.now() - t0 > EXPLOD_BUDGET_MS;
  const r2 = (v) => Math.round(v * 100) / 100;
  // const(velocity.run.fwd.x) and kin, from the character's own cns.
  const constVal = (name) => {
    const n = String(name).trim().toLowerCase();
    let m, v;
    if ((m = /^velocity\.(.+)\.([xyz])$/.exec(n))) {
      v = L.velocity.get(m[1]);
      if (v === undefined) return null;
      const c = splitComponents(String(v))['xyz'.indexOf(m[2])];
      const k = c ? constOf(c.raw) : null;
      return k && k.value !== null ? k.value : null;
    }
    const sec = (m = /^(movement|size)\.(.+)$/.exec(n)) ? (m[1] === 'movement' ? L.movement : L.size) : null;
    if (!sec) return null;
    v = atofFirst(sec.get(m[2]));
    return Number.isFinite(v) ? v : null;
  };
  const constSub = (raw) => String(raw).replace(/\bconst\s*\(\s*([a-z0-9_.]+)\s*\)/gi, (all, k) => { const v = constVal(k); return v === null ? all : '(' + v + ')'; });
  // The character's own motion in the move, tick by tick (see above).
  const walks = new Map();
  const walkOf = (st) => {
    if (walks.has(st)) return walks.get(st);
    let out;
    const hv = st.header.get('velset');
    let headerVel = [0, 0], assumed = null, why = null;
    if (hv === undefined || !String(hv).trim()) assumed = 'its statedef sets no velset, so the view assumes the move starts at rest';
    else {
      const comps = splitComponents(String(hv)).slice(0, 2).map((c) => constOf(constSub(c.raw)));
      if (comps.some((c) => c.value === null && !c.absent)) why = 'its statedef velset is a formula (' + String(hv).trim() + ')';
      else headerVel = [comps[0] && comps[0].value !== null ? comps[0].value : 0, comps[1] && comps[1].value !== null ? comps[1].value : 0];
    }
    if (why) out = { pts: [], why, assumed };
    else {
      const physics = String(st.header.get('physics') || 'n').trim().charAt(0).toLowerCase();
      let w = null;
      try {
        w = FD.helperPath({ sctrls: st.sctrls, headerVel, physics, friction, yaccel, pos: [0, 0], hf: 1, runs: null, arm: null, cap: EXPLOD_TICKS, noLand: true, num: (raw) => constOf(constSub(raw)).value });
      } catch (e) { w = null; }
      if (!w) out = { pts: [], why: 'its motion could not be read', assumed };
      else out = {
        pts: w.pts, assumed,
        why: w.end.why === 'depends' ? 'the character\'s own motion depends on ' + w.end.text + ' (' + w.end.file + ' line ' + w.end.line + ') from frame ' + (w.end.tick + 1) : null,
      };
    }
    walks.set(st, out);
    return out;
  };

  for (const s of outStates) {
    if (!s.blocks.length) continue;
    if (capped) break;
    if (over()) { capped = 'the Explod reader stopped after ' + EXPLOD_BUDGET_MS + ' ms'; break; }
    const st = states.get(s.no);
    if (!st || st.zss) continue;
    const scs = st.sctrls.filter((sc) => sc.type === 'explod');
    if (!scs.length) continue;
    const charPrioRaw = st.header.get('sprpriority');
    const charPrioC = charPrioRaw === undefined ? null : constOf(charPrioRaw);
    const charPrio = charPrioC && charPrioC.value !== null ? { value: Math.trunc(charPrioC.value), how: 'file' } : { value: 0, how: charPrioRaw === undefined ? 'assumed' : 'depends', raw: charPrioRaw === undefined ? undefined : String(charPrioRaw).trim() };
    const prioCtrls = st.sctrls.filter((sc) => sc.type === 'sprpriority');
    const mods = st.sctrls.filter((sc) => sc.type === 'modifyexplod' || sc.type === 'removeexplod');
    const list = [];
    for (const sc of scs) {
      if (list.length >= EXPLOD_PER_STATE) { notes.push('state ' + s.no + ': only its first ' + EXPLOD_PER_STATE + ' Explods are read (it has ' + scs.length + ')'); break; }
      if (count >= EXPLOD_MAX) { capped = 'only the first ' + EXPLOD_MAX + ' Explods are read'; break; }
      count++;
      const P = sc.params;
      const depends = [];
      const enotes = [];
      const has = (n) => P.has(n) && String(P.get(n)).trim() !== '';
      const one = (n, d) => {
        if (!has(n)) return d;
        const c = constOf(splitComponents(String(P.get(n)))[0].raw);
        if (c.value === null) { depends.push({ what: n, expr: String(P.get(n)).trim() }); return null; }
        return c.value;
      };
      const tup = (n, defs) => { const t = tupleOf(P, n, defs); for (const d of t.depends) depends.push({ what: n, expr: d }); return t.values; };
      const flag = (n) => { const v = one(n, 0); return v === null ? null : v !== 0; };
      // Its animation: a number (S = its own table), F = the common effects,
      // or a formula. Absent = action 0 (commitExplod char.go 7118-7126).
      const animRaw = P.get('anim');
      const anim = { raw: animRaw === undefined ? null : String(animRaw).trim(), action: null, how: null };
      if (animRaw === undefined || !String(animRaw).trim()) { anim.action = 0; anim.how = 'default'; }
      else {
        const r = animRef(animRaw, domains);
        if (r.literal) { anim.action = r.candidates[0]; anim.how = 'file'; }
        else if (r.foreign) anim.how = 'fightfx';
        else { anim.how = 'depends'; if (r.candidates.length) anim.candidates = r.candidates.slice(0, 8); }
      }
      const postype = wordOf(P, 'postype', is11 ? 'none' : 'p1');
      const space = wordOf(P, 'space', '');
      const pos = tup('pos', [0, 0]);
      const vel = P.has('vel') ? tup('vel', [0, 0]) : tup('velocity', [0, 0]);
      const accel = tup('accel', [0, 0]), fric = tup('friction', [1, 1]);
      const scale = tup('scale', [1, 1]);
      const fv = one('facing', 1), vv = one('vfacing', 1);
      const facing = fv === null ? null : (fv < 0 ? -1 : 1), vfacing = vv === null ? null : (vv < 0 ? -1 : 1);
      const bindtime = one('bindtime', 1);
      const removetime = one('removetime', -2);
      const animelem = one('animelem', 1);
      const animfreeze = flag('animfreeze');
      // Layer: sprpriority, then ontop, then layerno (explodSub's order).
      const sprprio = one('sprpriority', 0), ontop = flag('ontop'), under = flag('under');
      let layerno = 0, prio = sprprio === null ? null : Math.trunc(sprprio);
      if (ontop === true) { layerno = 1; prio = 0; }
      if (has('layerno')) { const l = one('layerno', 0); layerno = l === null ? null : l > 0 ? 1 : l < 0 ? -1 : 0; }
      const front = layerno === null || prio === null || under === null ? null
        : layerno > 0 ? true : layerno < 0 || under ? false : prio > charPrio.value;
      const layer = {
        layerno, sprpriority: prio, under: !!under, ontop: !!ontop, front, charPrio,
        why: front === null ? 'its layer is a formula'
          : layerno > 0 ? (ontop ? 'ontop = 1: drawn in the layer over every character' : 'layerno = 1: drawn in the layer over every character')
            : layerno < 0 ? 'layerno = -1: drawn under every character'
              : under ? 'under = 1: drawn under the characters of its layer'
                : 'sprpriority ' + prio + (prio > charPrio.value ? ' over' : prio === charPrio.value ? ' equal to' : ' under') + ' the character\'s ' + charPrio.value
                  + (charPrio.how === 'assumed' ? ' (its statedef sets none: 0 assumed)' : charPrio.how === 'depends' ? ' (its statedef\'s is a formula: 0 assumed)' : '')
                  + (prio === charPrio.value ? ': the character is drawn over it' : ''),
      };
      if (prioCtrls.length && front !== null && layerno === 0 && !under) enotes.push('a SprPriority controller in the state (line ' + prioCtrls.map((x) => x.line).join(', ') + ') may change which one is drawn on top');
      const id = has('id') ? one('id', 0) : 0;
      // What keeps it from being drawn here.
      let why = null;
      if (anim.how === 'depends') why = 'its animation depends on ' + anim.raw;
      else if (anim.how === 'fightfx') why = 'its animation ' + anim.raw + ' is one of the common effects, not read here';
      else if (['redirectid', 'animplayerno', 'spriteplayerno'].some(has)) why = 'it is made for or drawn from another player (' + ['redirectid', 'animplayerno', 'spriteplayerno'].filter(has).join(', ') + ')';
      else if (has('bindid') && one('bindid', -1) !== -1) why = 'it is bound to another character (bindid ' + String(P.get('bindid')).trim() + ')';
      else if (postype === 'p2') why = 'postype p2: it appears around the opponent, whose place depends on the match';
      else if (['front', 'back', 'left', 'right'].includes(postype)) why = 'postype ' + postype + ': it appears from the edge of the screen, which depends on the camera';
      else if (postype === 'none') why = 'postype none' + (has('postype') ? '' : ' (the default for a MUGEN 1.1 or Ikemen character, bytecode.go 6202-6205)') + ': an absolute place on the stage';
      else if (postype !== 'p1') why = 'postype ' + postype + ' is not read here';
      else if (space === 'screen') why = 'space = screen: drawn in screen space, which depends on the camera';
      else if (depends.length) why = 'its ' + depends.map((d) => d.what).join(', ') + ' depend' + (depends.length === 1 ? 's' : '') + ' on the game (' + depends.map((d) => d.expr).join('; ') + ')';
      let A = null;
      if (!why && anim.action !== null) {
        A = addAnim(anim.action);
        if (A === null) why = 'its animation was not sent: the window carries ' + EXPLOD_ANIMS + ' Explod animations at most';
        else if (!A.exists) why = 'action ' + anim.action + ' is not in the .air: the engine makes no Explod (commitExplod, char.go 7118-7126)';
      }
      if (has('random')) enotes.push('random = ' + String(P.get('random')).trim() + ': it appears up to half that far from pos either way; drawn at pos');
      for (const k of ['angle', 'xangle', 'yangle']) if (has(k)) enotes.push(k + ' = ' + String(P.get(k)).trim() + ': drawn without its rotation');
      if ([...P.keys()].some((k) => /^interpolation\./.test(k))) enotes.push('it interpolates (interpolation.*): drawn at its starting values');
      if (has('trans')) enotes.push('trans = ' + String(P.get('trans')).trim() + ': drawn opaque');
      // ModifyExplod / RemoveExplod in the same state that reach it (id match
      // rules: matchId char.go 1849-1851; no id = every Explod of the player).
      for (const m of mods) {
        const mid = m.params.get('id');
        const mc = mid === undefined ? { value: -1 } : constOf(mid);
        const hits = mc.value === null ? 'may reach it (its id is a formula)' : (mc.value < 0 || (id !== null && mc.value === id)) ? 'reaches it' : null;
        if (!hits) continue;
        const what = m.type === 'removeexplod' ? 'removes it' : 'changes its ' + [...m.params.keys()].filter((k) => !/^(id|index|redirectid|persistent|ignorehitpause)$/.test(k)).join(', ');
        enotes.push((m.type === 'removeexplod' ? 'RemoveExplod' : 'ModifyExplod') + ' at ' + m.file + ' line ' + m.line + ' ' + (hits === 'reaches it' ? what : hits + ': it ' + what) + ' when ' + (triggerText(m) || 'its triggers hold') + ' - not applied here');
      }
      if (flag('removeongethit')) enotes.push('removeongethit: it vanishes if the character is hit');

      // When it is made: per animation the state may play.
      const firing = firingOf(sc);
      ticksOf(s, firing);
      const conditional = firing.filter((f) => f.kind === 'conditional' && !f.never).map((f) => f.text);
      const byAction = {};
      const tlOf = A && A.exists && A.frames.length ? airTimeline(A.frames.map((f) => f.time), A.loopStart || 0) : null;
      for (const a of (s.anims || []).filter((x) => x.exists).slice(0, 4)) {
        const ticks = [...new Set(firing.map((f) => (f.kind === 'time' ? f.tick : (f.kind === 'animelem' || f.kind === 'animelemtime') && f.ticks ? f.ticks[a.action] : null))
          .filter((t) => Number.isInteger(t) && t >= 0))].sort((p, q) => p - q);
        const span = Math.min(a.endless ? EXPLOD_TICKS : a.ticks, EXPLOD_TICKS);
        const spawns = [];
        for (const T of ticks) {
          if (T >= span) { spawns.push({ T, pts: [], after: true }); continue; }
          const sp = { T, pts: [] };
          spawns.push(sp);
          if (why || !tlOf) continue;
          if (points >= EXPLOD_POINTS) { capped = 'the Explod art is drawn for the first ' + EXPLOD_POINTS + ' frames of the character\'s Explods'; continue; }
          const runs = tlOf.runs;
          const atTick = (k) => {
            let i = 0, left = k;
            for (let guard = 0; guard < 100000; guard++) {
              const r = runs[i];
              if (left < r.ticks) return r;
              left -= r.ticks;
              i++;
              if (i >= runs.length) { if (tlOf.hold) return runs[runs.length - 1]; i = tlOf.loopFrom || 0; }
            }
            return runs[0];
          };
          const startOff = animelem > 1 && animelem <= A.frames.length ? A.frames[animelem - 1].start : 0;
          if (animelem > 1) sp.fromElem = animelem;
          const life = removetime >= 0 ? removetime : removetime === -1 ? Infinity
            : tlOf.hold || tlOf.firstPass === null ? Infinity : Math.max(1, tlOf.firstPass - startOff);
          const walk = bindtime >= 0 && bindtime < span - T ? walkOf(st) : null;
          if (walk && walk.why) sp.unknownWhy = walk.why;
          if (walk && walk.assumed) sp.assumed = walk.assumed;
          const charAt = (t) => (t < 0 ? [0, 0] : walk && t < walk.pts.length ? walk.pts[t] : null);
          let v = [vel[0], vel[1]];
          const vs = [v.slice()];
          for (let age = 0; T + age < span && age < life; age++) {
            const elem = animfreeze ? (animelem > 1 && animelem <= A.frames.length ? animelem - 1 : 0) : atTick(startOff + age).elem;
            const bound = bindtime < 0 || age < bindtime;
            let x = null, y = null;
            if (bound) { x = pos[0]; y = pos[1]; } else {
              const anchorT = bindtime === 0 ? T - 1 : T + bindtime - 1, k0 = bindtime === 0 ? 0 : bindtime - 1;
              const ca = charAt(anchorT), cn = charAt(T + age);
              if (ca && cn) {
                let sx = 0, sy = 0;
                for (let k = k0; k < age; k++) { sx += vs[k][0]; sy += vs[k][1]; }
                x = r2(ca[0] + pos[0] + sx - cn[0]); y = r2(ca[1] + pos[1] + sy - cn[1]);
              }
            }
            sp.pts.push([elem, x, y, bound ? 1 : 0]);
            // velocity = velocity * friction + accel (0 under 0.1 with friction < 1)
            v = v.map((c, i) => { let n = c * fric[i] + accel[i]; if (Math.abs(n) < 0.1 && Math.abs(fric[i]) < 1) n = 0; return n; });
            vs.push(v.slice());
          }
          if (T + sp.pts.length >= span && sp.pts.length < life) sp.outlives = true;
          points += sp.pts.length;
        }
        byAction[a.action] = spawns;
      }
      list.push({
        id: 'X|' + sc.file + '|' + sc.line, file: sc.file, line: sc.line, state: s.no, explodId: has('id') ? String(P.get('id')).trim() : null,
        anim, drawn: !why, why,
        postype, space: space || null, pos, vel, accel, friction: fric, scale, facing, vfacing, bindtime, removetime, animelem, animfreeze,
        layer, ownpal: !!flag('ownpal'), removeongethit: !!flag('removeongethit'),
        triggers: triggerText(sc), conditional, spawns: byAction,
        depends, notes: enotes,
      });
    }
    if (list.length) s.explods = list;
  }
  if (capped) notes.push(capped);
  return { notes, count };
}

// A ChangeAnim value written against the animation playing now: `anim` itself
// keeps the current action (the ChangeAnim value is evaluated when it runs,
// bytecode.go:5500-5506, and `Anim` reads c.animNo), and `anim + k` / `anim - k`
// is that action moved by k. The action playing in the state is one its
// statedef anim or another ChangeAnim of the state names, so those candidates
// moved by k are this value's candidates - not exact, since the state may be
// playing something else by then. With nothing to move (an anim-less
// statedef) the value stays unresolved.
function resolveRelativeChangeAnims(s) {
  const rel = /^anim\s*(?:([+-])\s*(\d+))?$/i;
  const base = new Set(s.anim ? s.anim.candidates : []);
  for (const ca of s.changeAnims) if (!rel.test(String(ca.raw).trim())) for (const n of ca.candidates) base.add(n);
  for (const ca of s.changeAnims) {
    const m = rel.exec(String(ca.raw).trim());
    if (!m) continue;
    if (!m[1]) { ca.keepsCurrent = true; ca.unresolved = false; ca.candidates = []; ca.exact = false; ca.from = 'current'; continue; }
    if (!base.size) continue;
    const k = (m[1] === '-' ? -1 : 1) * Number(m[2]);
    ca.candidates = [...base].map((n) => n + k);
    ca.exact = false; ca.unresolved = false; ca.from = 'anim-relative';
  }
}

// Every trigger line of one controller, with its group.
function triggerLinesOf(file, sc) {
  const ft = file(sc.file);
  if (!ft) return [];
  const out = [];
  const end = nextBracket(ft, sc.line);
  for (let ln = sc.line + 1; ln < end; ln++) {
    const kv = S.paramLine(noCommentLine(lineText(ft.text, ft.starts, ln)));
    const tm = kv && /^trigger(all|\d+)$/.exec(kv.name);
    if (tm && (tm[1] === 'all' || tm[1][0] !== '0')) out.push({ line: ln, group: tm[1] === 'all' ? 'all' : +tm[1], value: kv.value });
  }
  return out;
}

// Every AnimElem / AnimElemTime / AnimElemNo atom in one controller, read by
// airedit's scanner (the compiler's own token rules, compiled values only), with
// the byte span of a literal N - what an animation edit that renumbers
// elements rewrites. `col` is where the word starts in `text`, `textStart` the
// byte offset of `text`, `redirect` the player an atom is redirected to.
const FORMS = { animelem: 'AnimElem', animelemtime: 'AnimElemTime', animelemno: 'AnimElemNo' };
function animElemRefs(file, sc, ci) {
  const ft = file(sc.file);
  if (!ft) return [];
  const A = airLib();
  const out = [];
  const end = nextBracket(ft, sc.line);
  for (let ln = sc.line + 1; ln < end; ln++) {
    const lt = lineText(ft.text, ft.starts, ln);
    const k = lt.indexOf(';');
    const cut = k < 0 ? lt : lt.slice(0, k);
    const lead = S.goWsLead(cut, 0);
    const text = trimGo(cut);
    const scan = A.scanLine(text);
    if (!scan.compiled) continue;
    const textStart = ft.starts[ln - 1] + lead;
    for (const a of scan.atoms) {
      const literal = a.numStart !== undefined;
      const raw = literal ? text.slice(a.numStart, a.numEnd) : a.argStart !== undefined ? text.slice(a.argStart, a.argEnd).trim() : '';
      out.push({
        file: sc.file, line: ln, controller: ci, type: sc.type, param: scan.name, form: FORMS[a.kind], elem: literal ? a.elem : null, raw,
        start: literal ? textStart + a.numStart : null, end: literal ? textStart + a.numEnd : null, expression: !literal, text, col: a.at, textStart,
        ...(a.redirect ? { redirect: a.redirect } : {}), ...(a.note ? { note: a.note } : {}),
      });
    }
  }
  return out;
}

// A ChangeAnim / ChangeAnim2 `elem = N`: the element the controller jumps to
// right after the change, on the action its own value names (the parameter,
// compiler_functions.go:597-604; applied at bytecode.go:5494-5508;
// Animation.SetAnimElem, anim.go:605-635). Its N is an element number of that
// action like AnimElem's. -> [ref] with form 'elem'; a non-literal elem is an
// expression (`AnimElemNo(0) + 1` is relative and needs no change).
function changeAnimElemRefs(file, sc, ci) {
  if (sc.type !== 'changeanim' && sc.type !== 'changeanim2') return [];
  const ft = file(sc.file);
  if (!ft) return [];
  const line = sc.paramLines.get('elem');
  if (!line) return [];
  const lt = lineText(ft.text, ft.starts, line);
  const k = lt.indexOf(';');
  const cut = k < 0 ? lt : lt.slice(0, k);
  const lead = S.goWsLead(cut, 0);
  const text = trimGo(cut);
  const scan = airLib().scanLine(text);
  if (!scan.compiled || scan.name !== 'elem') return [];
  const value = scan.value;
  const literal = /^[0-9]+$/.test(value);
  const textStart = ft.starts[line - 1] + lead;
  return [{
    file: sc.file, line, controller: ci, type: sc.type, param: 'elem', form: 'elem', elem: literal ? atoiGo(value) : null, raw: value,
    start: literal ? textStart + scan.valueStart : null, end: literal ? textStart + scan.valueStart + value.length : null,
    expression: !literal, text, col: scan.valueStart, textStart,
  }];
}

// Attack blocks the engine never compiles (§6): inside a statedef that an
// earlier file (or an earlier copy in the same file) already defined, inside
// a negative statedef dropped for a MUGEN character, or after a bracket line
// that ends the statedef (compiler.go:6860-6862).
function deadBlocks(L, file) {
  const out = [];
  const regions = [];
  for (const sh of L.parsed.shadowed) regions.push({ file: sh.file, line: sh.line, state: sh.no, reason: 'shadowed: an earlier definition of this statedef wins (compiler.go:6820-6834, 7111)' });
  for (const d of L.parsed.droppedNegative) regions.push({ file: d.file, line: d.line, state: d.no, reason: 'dropped: a later negative statedef of a MUGEN character (compiler.go:7111, 8347)' });
  for (const l of L.parsed.lost) {
    // The statedef the lost text sits in: the last one above it in that file.
    let owner = null;
    for (const st of L.parsed.states.values()) if (st.file === l.file && st.line < l.line && (!owner || st.line > owner.line)) owner = st;
    regions.push({ file: l.file, line: l.line, state: owner ? owner.no : null, lost: true, unclosed: !!l.unclosed,
      reason: l.unclosed ? 'unclosed [State header: skipped with its parameters (compiler.go:6856-6858)' : 'after a bracket line that ends the statedef (compiler.go:6860-6862)' });
  }
  for (const r of regions) {
    const ft = file(r.file);
    if (!ft) continue;
    let ordinal = 0, cur = null;
    const flush = () => { if (cur && ATTACK_SET.has(cur.type)) out.push({ file: r.file, line: cur.line, state: r.state, type: TYPE_NAMES[cur.type], ordinal: ordinal++, reason: r.reason, editable: false }); cur = null; };
    // A statedef header region starts below the header; a lost region starts
    // AT its line, which is itself a controller when it reads [State...
    for (let ln = r.lost ? r.line : r.line + 1; ln <= ft.starts.length; ln++) {
      const nc = noCommentLine(lineText(ft.text, ft.starts, ln));
      if (!nc) continue;
      const low = nc.toLowerCase();
      if (low[0] === '[') {
        if (r.unclosed && ln > r.line) break;
        flush();
        if (low.startsWith('[statedef ')) break;
        if (low.startsWith('[state') && !low.startsWith('[statedef')) cur = { line: ln, type: '' };
        continue;
      }
      const kv = S.paramLine(nc);
      if (kv && kv.name === 'type' && cur && !cur.type) cur.type = kv.value.toLowerCase();
    }
    flush();
  }
  return out;
}

// ---- edits ----------------------------------------------------------------------------------------------
const sha1 = (latin1) => crypto.createHash('sha1').update(Buffer.from(latin1, 'latin1')).digest('hex');
class MoveEditError extends Error { constructor(code, msg) { super(msg); this.code = code; } }

// Validate and format a new value for a component (§11 - before any write).
function formatValue(input, kind, name, component) {
  if (input === null || input === undefined) throw new MoveEditError('invalid', 'no value given');
  let text;
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) throw new MoveEditError('invalid', 'not a finite number');
    text = String(input);
    if (/e/i.test(text)) text = input.toFixed(6).replace(/\.?0+$/, '');
  } else text = String(input).trim();
  if (!text) throw new MoveEditError('invalid', 'empty value');
  if (!NUM_RE.test(text)) throw new MoveEditError('invalid', 'not a plain number: ' + JSON.stringify(text));
  const n = Number(text);
  if (!Number.isFinite(n) || Math.abs(n) > 1e9) throw new MoveEditError('invalid', 'out of range');
  if (kind === 'int' || kind === 'bool') {
    if (!Number.isInteger(n)) throw new MoveEditError('invalid', name + ' takes an integer');
    if (n > 2147483647 || n < -2147483648) throw new MoveEditError('invalid', 'out of int32 range');
    if (kind === 'bool' && n !== 0 && n !== 1) throw new MoveEditError('invalid', name + ' takes 0 or 1');
    text = String(n === 0 ? 0 : n);
  } else if (kind === 'float') {
    text = text.replace(/^\+/, '');
  } else throw new MoveEditError('invalid', name + ' is not a numeric parameter');
  if (NONNEG.has(name) && n < 0) throw new MoveEditError('invalid', name + (component ? ' component ' + component : '') + ' cannot be negative');
  return text;
}

// One file parsed alone, from text: the structure a splice must not change.
function parseTextAlone(text, rel, absLike, L) {
  const ext = path.extname(absLike) || '.cns';
  const tmp = path.join(os.tmpdir(), 'movelib-check-' + process.pid + '-' + Math.random().toString(36).slice(2) + ext);
  fs.writeFileSync(tmp, Buffer.from(text, 'latin1'));
  try { return S.parseStates([{ key: 'st', rel, abs: tmp }], { consts: L.consts, ikemenVersion: L.ikemenVersion }); } finally { fs.rmSync(tmp, { force: true }); }
}
// `after`: a line was inserted after that line, so every later line of this
// reading is read back one up before comparing.
function structureOf(p, after) {
  const L = (n) => (after !== undefined && after !== null && n > after + 1 ? n - 1 : n);
  return JSON.stringify({
    states: [...p.states.values()].map((s) => [s.no, L(s.line), [...s.header.entries()], s.sctrls.length, s.sctrls.map((c) => c.type)]),
    shadowed: p.shadowed.map((x) => [x.no, L(x.line)]), lost: p.lost.map((x) => [L(x.line), x.controllers]),
    dropped: p.droppedNegative.map((x) => [x.no, L(x.line)]), unresolved: p.unresolvedHeaders.length,
  });
}

// The validate step for a parameter splice: re-parse the whole new file
// alone and require everything but the one parameter to read as before.
function makeValidator(L, rel, abs, target, expectedRaw) {
  return (newText, oldText) => {
    const a = parseTextAlone(oldText, rel, abs, L);
    const b = parseTextAlone(newText, rel, abs, L);
    if (structureOf(a) !== structureOf(b, target.added ? target.shiftAfter : null)) return 'the file\'s statedefs or controllers would change';
    for (const [no, sa] of a.states) {
      const sb = b.states.get(no);
      let ord = -1;
      for (let k = 0; k < sa.sctrls.length; k++) {
        const ca = sa.sctrls[k], cb = sb.sctrls[k];
        if (ATTACK_SET.has(ca.type)) ord++;
        // An added parameter line moves every later controller down one.
        const shifted = target.added && ca.line > target.shiftAfter ? ca.line + 1 : ca.line;
        if (JSON.stringify([ca.trig, ca.tag, ca.label, shifted]) !== JSON.stringify([cb.trig, cb.tag, cb.label, cb.line])) return 'a trigger would change (state ' + no + ', line ' + ca.line + ')';
        const isTarget = no === target.state && ATTACK_SET.has(ca.type) && ord === target.ordinal;
        const keys = new Set([...ca.params.keys(), ...cb.params.keys()]);
        for (const key of keys) {
          if (isTarget && key === target.param) {
            if (cb.params.get(key) !== expectedRaw) return target.param + ' would read ' + JSON.stringify(cb.params.get(key)) + ', expected ' + JSON.stringify(expectedRaw);
            continue;
          }
          if (ca.params.get(key) !== cb.params.get(key)) return 'another parameter would change (' + key + ', state ' + no + ', line ' + ca.line + ')';
        }
      }
    }
    if (!b.states.has(target.state)) return 'the target state would disappear';
    return null;
  };
}

// The literal actions a block's compiled triggers test for with `Anim = K`:
// not after a redirect comma (`p2, Anim = 41` is the opponent's), not `!=`.
function guardAnims(b) {
  const out = [];
  for (const t of b.triggers || []) {
    if (!t.compiled) continue;
    for (const m of String(t.value).matchAll(/\banim\s*=\s*(\d+)\b/gi)) {
      if (/,\s*$/.test(String(t.value).slice(0, m.index))) continue;
      const n = parseInt(m[1], 10);
      if (!out.includes(n)) out.push(n);
    }
  }
  return out;
}

function findBlock(model, file, state, ordinal) {
  const s = model.states.find((x) => x.no === state && x.file === file)
    || (model.negativeStates || []).find((x) => x.no === state && x.file === file);
  if (!s) return null;
  return s.blocks.find((b) => b.ordinal === ordinal) || null;
}

// Low-level: validate-and-write splices against one attack block's parameter.
// editMoveValue builds the splices; a test can hand in its own to prove the
// validator refuses what it should.
function applyMoveSplices(charDir, defName, target, splices, expectedRaw) {
  const L = loadChar(charDir, defName);
  if (!L) throw new MoveEditError('notfound', 'character not readable');
  const f = L.files.find((x) => x.rel === target.file && x.abs && !x.engine);
  if (!f) throw new MoveEditError('notfound', 'not a state file of this character: ' + target.file);
  if (f.zss) throw new MoveEditError('refused', 'ZSS files are not edited');
  // The splice offsets were computed from one reading of the file; the write
  // only goes ahead against those exact bytes (target.sha1), and writeSpliced
  // re-reads and compares again right before it writes.
  const text = fs.readFileSync(f.abs, 'latin1');
  if (target.sha1 && sha1(text) !== target.sha1) throw new MoveEditError('stale', 'the file changed since it was read - reload and try again');
  try {
    return charedit.writeSpliced(f.abs, splices, { expectText: text, validate: makeValidator(L, f.rel, f.abs, target, expectedRaw) });
  } catch (e) {
    throw new MoveEditError(/changed since/.test(e.message) ? 'stale' : 'refused', e.message);
  }
}

// AN EXPRESSION TYPED IN PLACE OF A NUMBER. The Studio's reader (cnsexpr) knows
// the subset of the CNS language values are written in; what it cannot read
// may still be valid to the engine, so that is a confirm rather than a
// refusal - with the stake named, because an expression the engine cannot
// compile stops the character from loading. What can never be right is
// refused outright: a line break or a ';' (it would end the line or start a
// comment), unbalanced brackets or quotes, and a comma outside brackets (it
// would become another component).
function formatExpression(input, kind, name, confirmed) {
  const text = String(input === undefined || input === null ? '' : input).trim();
  if (!text) throw new MoveEditError('invalid', 'empty value');
  if (kind !== 'int' && kind !== 'float') throw new MoveEditError('invalid', name + ' is not a numeric parameter');
  if (/[\r\n;]/.test(text)) throw new MoveEditError('invalid', 'an expression cannot hold a line break or a ";"');
  if (text.length > 400) throw new MoveEditError('invalid', 'too long');
  let depth = 0, quote = false;
  for (const ch of text) {
    if (ch === '"') { quote = !quote; continue; }
    if (quote) continue;
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') { depth--; if (depth < 0) break; }
    else if (ch === ',' && depth === 0) throw new MoveEditError('invalid', 'a comma outside brackets would make this another value; edit one value at a time');
  }
  if (depth !== 0 || quote) throw new MoveEditError('invalid', 'unbalanced brackets or quotes');
  if (!X.parses(text) && !confirmed) {
    throw new MoveEditError('confirm', 'The Studio cannot check "' + text + '". If the engine cannot read it either, the character will not load. Write it anyway?');
  }
  return text;
}

// ADD A PARAMETER THE BLOCK LEAVES OUT (the readout's blockstun on a HitDef
// that derives it, say). One line, "name = value", inserted after the block's
// last line with that line's indentation; the write is validated like any
// other, with every later controller allowed to move down exactly one line.
// An added value pins what the engine would otherwise derive.
function addMoveParam(charDir, defName, req) {
  const r = req || {};
  if (!r.sha1) throw new MoveEditError('invalid', 'sha1 (the file as read) is required');
  const model = movesIn(charDir, defName, { anims: false });
  if (!model) throw new MoveEditError('notfound', 'character not readable');
  const file = String(r.file || '');
  const state = Number(r.state), ordinal = Number(r.ordinal);
  const param = String(r.param || '').toLowerCase();
  if (!Number.isInteger(state) || !Number.isInteger(ordinal) || ordinal < 0) throw new MoveEditError('invalid', 'state and ordinal must be integers');
  const block = findBlock(model, file, state, ordinal);
  if (!block) throw new MoveEditError('notfound', 'no attack block ' + ordinal + ' in state ' + state + ' of ' + file);
  if (block.params.some((x) => x.name === param)) throw new MoveEditError('refused', param + ' is already in this block: edit it instead');
  const spec = paramSpec(block.ctrl, param);
  if (!spec) throw new MoveEditError('invalid', param + ' is not a parameter of ' + block.type);
  if (spec.kind === 'string') throw new MoveEditError('invalid', param + ' takes text; only numbers are added here');
  const risk = riskOf(param, model.ikemenVersion);
  if (risk.level === 'dangerous' && r.confirm !== true) throw new MoveEditError('confirm', param + ' is dangerous: ' + risk.notes.join('; ') + ' - pass confirm: true');
  const vals = Array.isArray(r.values) ? r.values : [r.value];
  if (!vals.length || vals.length > spec.n) throw new MoveEditError('invalid', param + ' takes ' + spec.n + ' value' + (spec.n === 1 ? '' : 's'));
  const texts = vals.map((x, k) => (NUM_RE.test(String(x).trim()) ? formatValue(x, spec.kind, param, k) : formatExpression(x, spec.kind, param, r.confirm === true)));
  const fm = model.files.find((x) => x.rel === file);
  if (!fm || fm.sha1 !== r.sha1) throw new MoveEditError('stale', 'the file changed since it was read - reload and try again');
  const L = loadChar(charDir, defName);
  const f = L.files.find((x) => x.rel === file && x.abs && !x.engine);
  if (!f || f.zss) throw new MoveEditError('refused', 'not an editable state file: ' + file);
  const text = fs.readFileSync(f.abs, 'latin1');
  const starts = lineStarts(text);
  // After the block's last non-blank line: its end runs to the next bracket.
  let last = block.line;
  for (let ln = block.line + 1; ln <= block.endLine; ln++) if (noCommentLine(lineText(text, starts, ln)).trim()) last = ln;
  const lastText = lineText(text, starts, last);
  const indent = (/^[ \t]*/.exec(lastText) || [''])[0];
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const at = last < starts.length ? starts[last] : text.length;
  const lineOut = indent + param + ' = ' + texts.join(', ') + eol;
  const ins = at === text.length && !/\n$/.test(text) ? eol + lineOut.slice(0, -eol.length) : lineOut;
  const res = (() => {
    try {
      return charedit.writeSpliced(f.abs, [{ start: at, end: at, text: ins, allowNewline: true }], {
        expectText: text,
        validate: makeValidator(L, f.rel, f.abs, { file, state, ordinal, param, added: true, shiftAfter: last }, texts.join(', ')),
      });
    } catch (e) { throw new MoveEditError(/changed since/.test(e.message) ? 'stale' : 'refused', e.message); }
  })();
  const after = movesIn(charDir, defName, { anims: false });
  const nb = after ? findBlock(after, file, state, ordinal) : null;
  return {
    changed: res.changed, backup: res.backup ? path.relative(charDir, res.backup).replace(/\\/g, '/') : null, backupCreated: !!res.backupCreated,
    written: texts.join(', '), line: last + 1, block: nb, param: nb ? nb.params.find((x) => x.name === param) : null,
    edited: charedit.listEdited(charDir),
  };
}

// req.sha1 (the file's sha1 as the caller read it, files[].sha1) is REQUIRED:
// {file, state, ordinal} is a position, and without the sha1 a key read before
// another writer inserted a block would land on that block whenever its value
// happens to match `expect`. Only an internal caller that has just read the
// file itself may pass `noSha1: true` instead.
function editMoveValue(charDir, defName, req) {
  const r = req || {};
  if (!r.sha1 && r.noSha1 !== true) throw new MoveEditError('invalid', 'sha1 (the file as read) is required');
  const model = movesIn(charDir, defName, { anims: false });
  if (!model) throw new MoveEditError('notfound', 'character not readable');
  const file = String(r.file || '');
  const state = Number(r.state), ordinal = Number(r.ordinal), index = Number(r.index);
  const param = String(r.param || '').toLowerCase();
  if (!Number.isInteger(state) || !Number.isInteger(ordinal) || !Number.isInteger(index) || ordinal < 0 || index < 0) throw new MoveEditError('invalid', 'state, ordinal and index must be integers');
  const block = findBlock(model, file, state, ordinal);
  // A dead copy can share the address of a live block (a statedef repeated in
  // the same file): the live one is what the engine compiles, so it wins.
  if (!block && model.dead.some((d) => d.file === file && d.state === state && d.ordinal === ordinal)) throw new MoveEditError('refused', 'that block is dead code: the engine never compiles it');
  if (!block) throw new MoveEditError('notfound', 'no attack block ' + ordinal + ' in state ' + state + ' of ' + file);
  const p = block.params.find((x) => x.name === param);
  if (!p) throw new MoveEditError('notfound', 'block has no ' + param + ' parameter');
  if (r.expect === undefined || r.expect === null) throw new MoveEditError('invalid', 'expect (the value as read) is required');
  if (p.raw !== String(r.expect)) throw new MoveEditError('stale', 'changed since read: ' + param + ' now reads ' + JSON.stringify(p.raw));
  const v = p.values[index];
  if (!v) throw new MoveEditError('notfound', param + ' has no component ' + index);
  // A plain number goes through formatValue; anything else is an EXPRESSION,
  // written as text over the whole component - into a component that is
  // already one, or a plain number being replaced by one.
  const asExpr = (v.tier === 'green' || (v.tier === 'red' && v.expr)) && !NUM_RE.test(String(r.value === undefined || r.value === null ? '' : r.value).trim());
  if (!asExpr && v.tier !== 'green' && v.tier !== 'amber' && !(v.tier === 'red' && v.expr)) throw new MoveEditError('refused', param + ' component ' + index + ' is ' + v.tier + ': not editable');
  if (p.risk.level === 'dangerous' && r.confirm !== true) throw new MoveEditError('confirm', param + ' is dangerous: ' + p.risk.notes.join('; ') + ' - pass confirm: true');
  const text = asExpr ? formatExpression(r.value, v.kind, param, r.confirm === true) : formatValue(r.value, v.kind, param, index);
  const splices = (asExpr || v.tier === 'red') ? [{ start: v.start, end: v.end, text }] : v.spans.map((sp) => ({ start: sp.start, end: sp.end, text }));
  // The raw the parameter must read afterwards: the same splices applied to
  // the value's own text.
  const rel = splices.map((sp) => ({ start: sp.start - p.start, end: sp.end - p.start, text: sp.text }));
  const expectedRaw = charedit.applySplices(p.raw, rel);
  const fm = model.files.find((x) => x.rel === file);
  if (r.sha1 && (!fm || fm.sha1 !== r.sha1)) throw new MoveEditError('stale', 'the file changed since it was read - reload and try again');
  const res = applyMoveSplices(charDir, defName, { file, state, ordinal, param, sha1: fm ? fm.sha1 : null }, splices, expectedRaw);
  const after = movesIn(charDir, defName, { anims: false });
  const nb = after ? findBlock(after, file, state, ordinal) : null;
  return {
    changed: res.changed, backup: res.backup ? path.relative(charDir, res.backup).replace(/\\/g, '/') : null, backupCreated: !!res.backupCreated,
    written: text, raw: expectedRaw, block: nb, param: nb ? nb.params.find((x) => x.name === param) : null,
    edited: charedit.listEdited(charDir),
  };
}

// A file the user may revert: one listEdited reports, inside the folder.
function revertMoveFile(charDir, file) {
  const want = String(file || '').replace(/\\/g, '/').replace(/^\.\//, '');
  const hit = charedit.listEdited(charDir).find((e) => e.file.toLowerCase() === want.toLowerCase());
  if (!hit) throw new MoveEditError('notfound', 'no edit backup for ' + want);
  const abs = path.join(charDir, hit.file);
  const rootAbs = path.resolve(charDir) + path.sep;
  if (!path.resolve(abs).startsWith(rootAbs)) throw new MoveEditError('refused', 'outside the character folder');
  return Object.assign({ file: hit.file }, charedit.revert(abs));
}

// States whose animation may be `action` (a candidate of the statedef anim
// or of a ChangeAnim) - the triggers an .air renumber must look at.
// ---- a hit for a box that has none (hitgen.js) ------------------------------------------------------
// Writes, rewrites or removes the -3 group that makes action `action`'s Clsn1
// boxes hit while state `state` plays it. The caller (modlib.charHitIn)
// decides the pose facts; this finds the file, splices, re-parses and writes.
//   req: { op: 'make' | 'update' | 'remove', state, action, elems, count,
//          stateType, idle, scale, sparkY, sha1s: { rel: sha1 } }
// The re-parse must show every statedef and every controller outside the
// group exactly as before (lines may shift), and the group as planned: two
// StateTypeSets and a HitDef with one trigger group per element (only the
// HitDef when the state is movetype A already), or nothing after a remove.
function applyHitGroup(charDir, defName, req) {
  const H = require('./hitgen.js');
  const r = req || {};
  const op = String(r.op || '');
  if (!['make', 'update', 'remove'].includes(op)) throw new MoveEditError('invalid', 'op must be make, update or remove');
  const state = Number(r.state), action = Number(r.action);
  if (!Number.isInteger(state) || state < 0 || !Number.isInteger(action) || action < 0) throw new MoveEditError('invalid', 'state and action must be whole numbers');
  const elems = op === 'remove' ? [] : [...new Set((r.elems || []).map(Number))].sort((a, b) => a - b);
  if (op !== 'remove' && (!elems.length || elems.some((e) => !Number.isInteger(e) || e < 1))) throw new MoveEditError('invalid', 'no element with a Clsn1 box to hit with');
  const L = loadChar(charDir, defName);
  if (!L) throw new MoveEditError('notfound', 'character not readable');
  const own = L.files.filter((f) => f.abs && !f.engine);
  // Where the group is now, if anywhere.
  let found = null, foundFile = null;
  for (const f of own) {
    if (f.zss) continue;
    let text;
    try { text = fs.readFileSync(f.abs, 'latin1'); } catch (e) { continue; }
    const g = H.findGroup(text, action, state);
    if (g) { found = g; foundFile = f; break; }
  }
  if (op === 'make' && found) throw new MoveEditError('invalid', 'state ' + state + ' already has a hit for action ' + action + ' (' + foundFile.rel + ' line ' + found.parts[0].line + ')');
  if (op !== 'make' && !found) throw new MoveEditError('notfound', 'no hit for action ' + action + ' in state ' + state + ' to ' + op);
  let target = foundFile, createNeg = false, headerLine = null;
  if (!target) {
    const neg = L.parsed.states.get(-3);
    if (neg) {
      target = own.find((f) => f.rel === neg.file) || null;
      if (!target || neg.zss || target.zss) throw new MoveEditError('refused', 'this character\'s [Statedef -3] is in a ZSS file, which the Studio does not write');
      headerLine = neg.line;
    } else {
      target = own.find((f) => f.key === 'st') || own.find((f) => /^st\d*$/.test(f.key)) || own[0] || null;
      if (!target) throw new MoveEditError('notfound', 'this character loads no state file of its own');
      if (target.zss) throw new MoveEditError('refused', 'this character\'s states are ZSS, which the Studio does not write');
      createNeg = true;
    }
  }
  const text = fs.readFileSync(target.abs, 'latin1');
  const want = r.sha1s && r.sha1s[target.rel];
  if (want && sha1(text) !== want) throw new MoveEditError('stale', 'the file changed since it was read - reload and try again');
  const eol = H.eolOf(text);
  const o = { state, action, elems, count: Number(r.count) || elems[elems.length - 1] || 1, stateType: r.stateType, idle: r.idle !== false, scale: Number(r.scale) || 1, sparkY: Number(r.sparkY) };
  const splices = [];
  if (op === 'make') {
    const body = H.groupText(o, eol);
    if (createNeg) {
      const nl = text && !/\n$/.test(text) ? eol : '';
      splices.push({ start: text.length, end: text.length, allowNewline: true, text: nl + eol + ';' + '-'.repeat(75) + eol + '; Runs every tick while the character is in its own states' + eol + '[Statedef -3]' + eol + eol + body });
    } else {
      const ap = H.appendPoint(text, headerLine);
      splices.push({ start: ap.offset, end: ap.offset, allowNewline: true, text: (ap.needsNl ? eol : '') + eol + body });
    }
  } else if (op === 'remove') {
    const last = found.parts[found.parts.length - 1];
    splices.push({ start: found.commentStart, end: last.end, allowNewline: true, text: '' });
  } else {
    const hit = found.hit;
    if (!hit) throw new MoveEditError('refused', 'the hit\'s HitDef is missing from the group - remove it and make it again');
    for (const p of found.parts) if (p.kind !== 'hit') splices.push({ start: p.start, end: p.end, allowNewline: true, text: '' });
    if (o.idle) splices.push({ start: hit.start, end: hit.start, allowNewline: true, text: H.stateTypeSetText(o, eol) + eol });
    const newTrig = H.triggerLines(state, action, elems).map((x) => x + eol).join('');
    if (!found.triggers.length) throw new MoveEditError('refused', 'the hit\'s HitDef has no trigger lines to update');
    found.triggers.forEach((t, k) => splices.push({ start: t.start, end: t.end, allowNewline: true, text: k === 0 ? newTrig : '' }));
  }
  const isGroup = (c) => c.label && new RegExp('^hit box of action ' + action + ' in state ' + state + '\\s*:', 'i').test(String(c.label));
  const validate = (newText, oldText) => {
    let a, b;
    try { a = parseTextAlone(oldText, target.rel, target.abs, L); b = parseTextAlone(newText, target.rel, target.abs, L); } catch (e) { return 're-parse failed: ' + e.message; }
    const outside = (p) => JSON.stringify({
      states: [...p.states.values()].filter((s) => !(createNeg && s.no === -3)).map((s) => [s.no, [...s.header.entries()], s.sctrls.filter((c) => !(s.no === -3 && isGroup(c))).map((c) => [c.type, c.label, c.tag, c.trig, [...c.params.entries()]])]),
      shadowed: p.shadowed.map((x) => x.no), lost: p.lost.map((x) => x.controllers), dropped: p.droppedNegative.map((x) => x.no),
    });
    if (outside(a) !== outside(b)) return 'something outside the hit group would read differently';
    const neg = b.states.get(-3);
    const group = neg ? neg.sctrls.filter(isGroup) : [];
    const types = group.map((c) => c.type).join(',');
    const expect = op === 'remove' ? '' : (o.idle ? 'statetypeset,statetypeset,hitdef' : 'hitdef');
    if (types !== expect) return 'the hit group would read as [' + types + '], expected [' + expect + ']';
    if (op !== 'remove') {
      const hd = group[group.length - 1];
      if (hd.trig.groups.length !== elems.length) return 'the HitDef would have ' + hd.trig.groups.length + ' trigger groups, expected ' + elems.length;
      if (createNeg && neg.sctrls.length !== group.length) return 'the new [Statedef -3] would hold more than the hit group';
    }
    return null;
  };
  let res;
  try {
    res = charedit.writeSpliced(target.abs, splices, { expectText: text, validate });
  } catch (e) {
    throw new MoveEditError(/changed since/.test(e.message) ? 'stale' : 'refused', e.message);
  }
  return { changed: res.changed, file: target.rel, created: createNeg, backup: res.backup ? path.relative(charDir, res.backup).replace(/\\/g, '/') : null, backupCreated: !!res.backupCreated, edited: charedit.listEdited(charDir) };
}

function statesUsingAction(model, action) {
  return model.states.filter((s) => (s.anim && s.anim.candidates.includes(action)) || s.changeAnims.some((c) => c.candidates.includes(action)));
}

module.exports = {
  movesIn, editMoveValue, addMoveParam, formatExpression, applyMoveSplices, revertMoveFile, statesUsingAction, applyHitGroup, guardAnims,
  airModel, animRef, firingOf, splitComponents, amberSpans, formatValue, attrInfo, multipliers,
  PARAMS, PARAM_CODES, KEYWORDS, ATTACK_TYPES, INIT_CONSTANTS, MoveEditError,
};
