'use strict';
//
// WHAT THE ENGINE ITSELF BRINGS TO A CHARACTER.
//
// A content audit asks "does anything define state N / action N?" and the
// honest answer is never just the character's own files. The engine compiles
// its own data into every character's tables and enters some states by itself
// with no controller anywhere. This module is the one place that knows those
// facts, read from the engine checkout the build already uses
// (layout.dir('ikemen-go-src')) so a data update is picked up without editing
// a list here.
//
// Line citations are against the engine source at web-v1.0.0-sync 96413d2.
//
// Everything is memoized per engine folder and per {desktop}: the web build
// and the desktop export differ by one common-states file, nothing else.
//
//   commonConfig({desktop})     -> {states, air, consts, source}   rel paths
//   commonFiles({desktop})      -> [{rel, path|null}]              states files, resolved
//   consts()                    -> Map lowercased name -> number   data/common.const
//   stcommonStates()            -> Set                             data/common1.cns.zss
//   commonStates({desktop})     -> Set                             CommonStates statedefs
//   commonStateRoots({desktop}) -> Set                             literal targets inside them
//   commonStateRefs({desktop})  -> [{no, file, line, controller, param}]
//   commonAirActions()          -> Set                             data/common.air
//   hardcodedStates()           -> Set                             entered by the engine itself
//   retiredStates()             -> Map old number -> const name
//   stcommonRefs()              -> [{no, file, line, controller, param, computed?}]
//                                  state targets inside data/common1.cns.zss
//   stcommonRoots()             -> Set                             their numbers
//   motifStates()               -> Set                             *.state = of defaultMotif.ini
//   stcommonAnims()             -> Map no -> {anims: [n], open, type}  what common1's states show
//   create(engineDir, {desktopDir}) -> the same API over another folder (tests)

const fs = require('fs');
const path = require('path');

// THE [Common] LIST WHEN THE ENGINE SOURCE IS NOT THERE.
//
// The engine embeds src/resources/defaultConfig.ini and merges it under the
// player's config (config.go:256-316); the web build writes a [Common] section
// with only `Lua` (vfslib.js buildConfigIni), so this embedded list is what
// every web match runs. The modding kit ships ikemen-go-src/ with bin, data,
// external and font only - no src/ - so there is no file to read there. This
// is a literal copy of defaultConfig.ini:11-18 at 96413d2; the test asserts it
// still equals the parsed file whenever the source is present, so a drift is a
// red test rather than a silent wrong answer.
const FALLBACK_COMMON = {
  states: [
    'data/functions.zss', 'data/action.zss', 'data/demo.zss', 'data/dizzy.zss',
    'data/guardbreak.zss', 'data/score.zss', 'data/system.zss', 'data/tag.zss',
    'data/training.zss',
  ],
  air: ['data/common.air'],
  consts: ['data/common.const'],
};

// The desktop export adds its Scene Viewer hook as a SECOND key of the same
// map, `States1 = data/sceneviewer.zss` (dist-desktop/save/config.ini:25,
// written by desktop.js from the file syncSandboxFiles lays down). SortedKeys
// (common.go:1632-1644) puts States before States1, so it compiles last.
const DESKTOP_STATES = 'data/sceneviewer.zss';

// STATES THE ENGINE ENTERS WITH NO CONTROLLER.
//
// Found by grepping every changeState/selfState/changeStateEx call whose state
// argument is a literal in src/*.go at 96413d2. Each lands in the character's
// OWN table (the 5000-series with p2getp1state uses the attacker's table,
// char.go:12711-12713 - still a table that must hold the number). A number
// here is a root: a state reached this way is live even though no file points
// at it. motif.go:2886 and motif.go:4740 also change state, but only after
// selfStatenoExist says the number is there, so they can never land in an
// empty state and are not listed.
const HARDCODED = [
  { no: 5900, cite: 'system.go:2657', why: 'round init' },
  { no: 0, cite: 'system.go:2858, 3438', why: 'round reset / round start' },
  { no: 180, cite: 'system.go:3611', why: 'win pose' },
  { no: 170, cite: 'system.go:3613', why: 'lose pose' },
  { no: 175, cite: 'system.go:3615', why: 'draw pose' },
  { no: 120, cite: 'char.go:11880, 12117', why: 'guard start' },
  { no: 40, cite: 'char.go:11884', why: 'jump key' },
  { no: 45, cite: 'char.go:11891', why: 'air jump key' },
  { no: 10, cite: 'char.go:11898', why: 'crouch key' },
  { no: 12, cite: 'char.go:11902', why: 'stand from crouch' },
  { no: 20, cite: 'char.go:11907', why: 'walk key' },
  // 140 (stop guarding) ends into 0, 11 or 51 by statetype:
  // Btoi(C)*11 + Btoi(A)*51, char.go:12166-12168; 0 is already listed.
  { no: 11, cite: 'char.go:12167', why: 'guard end, crouching' },
  { no: 51, cite: 'char.go:12167', why: 'guard end, airborne' },
  { no: 52, cite: 'char.go:12175', why: 'landing from physics A' },
  { no: 5120, cite: 'char.go:12163', why: 'get up from 5110' },
  { no: 5030, cite: 'char.go:12380', why: 'KO' },
  { no: 5050, cite: 'char.go:6815, 8657, 12645', why: 'bind lost' },
  { no: 150, cite: 'char.go:12737', why: 'guard hit, standing' },
  { no: 152, cite: 'char.go:12739', why: 'guard hit, crouching' },
  { no: 154, cite: 'char.go:12741', why: 'guard hit, air' },
  { no: 5080, cite: 'char.go:12744', why: 'get hit, lying down' },
  { no: 5070, cite: 'char.go:12746', why: 'get hit, tripped' },
  { no: 5000, cite: 'char.go:12755, 12760', why: 'get hit, standing' },
  { no: 5010, cite: 'char.go:12762', why: 'get hit, crouching' },
  { no: 5020, cite: 'char.go:12765', why: 'get hit, air' },
];

// PRE-1.0 COMMON STATE NUMBERS.
//
// Older Ikemen builds put the dizzy, guard-break and tag states at 5300-5621;
// this engine moved them to const(...) names valued 6565300-6565621
// (common.const, sections "dizzy.zss states", "guardbreak.zss states",
// "tag.zss states"). A character written for the old numbers still says
// `value = 5300` and lands in an empty state. retiredStates() keeps only the
// names common.const actually defines, and only when the value is the old
// number + 6560000, so a renumbering in a future data update drops the hint
// instead of printing a wrong one.
const RETIRED = [
  [5300, 'StateDizzy'],
  [5301, 'StateDizzyFallDown_standCrouch'],
  [5302, 'StateDizzyFallDown_air'],
  [5303, 'StateDizzyLyingDown'],
  [5310, 'StateDizzyBirdsHelper'],
  [5400, 'StateGuardBreakHit'],
  [5401, 'StateGuardBreakRecover'],
  [5600, 'StateTagEnteringScreen'],
  [5610, 'StateTagLeavingScreen'],
  [5611, 'StateTagWaitingOutside'],
  [5620, 'StateTagJumpingIn'],
  [5621, 'StateTagLanding'],
];
const RETIRED_OFFSET = 6560000;

// Which parameters of which controllers name a state. Lowercased, as the ZSS
// and CNS compilers compare them. partnerstateno is the partner's table and
// p2stateno may be the opponent's, but as ROOTS they only ever make a state
// live, never missing, so erring wide here can hide a dead-code note and can
// never invent a break.
const STATE_PARAMS = {
  changestate: ['value'],
  selfstate: ['value'],
  targetstate: ['value'],
  helper: ['stateno'],
  hitoverride: ['stateno'],
  tagin: ['stateno', 'partnerstateno'],
  tagout: ['stateno', 'partnerstateno'],
  hitdef: ['p1stateno', 'p2stateno'],
  reversaldef: ['p1stateno', 'p2stateno'],
  projectile: ['p1stateno', 'p2stateno'],
  modifyhitdef: ['p1stateno', 'p2stateno'],
  modifyreversaldef: ['p1stateno', 'p2stateno'],
  modifyprojectile: ['p1stateno', 'p2stateno'],
};

// Blank out comments without moving any character, so offsets and line numbers
// computed on the result are the file's own. ZSS comments are `#` (the scan
// loop skips any token starting with it, compiler.go:7134-7147); CNS comments
// are `;`. Quoted strings are kept whole: `text{text: "a # b"}` is not a comment.
function blankComments(text, mark) {
  let out = '';
  let inStr = false, inCom = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\n') { inCom = false; inStr = false; out += ch; continue; }
    if (inCom) { out += ch === '\r' ? ch : ' '; continue; }
    if (ch === '"') inStr = !inStr;
    if (!inStr && ch === mark) { inCom = true; out += ' '; continue; }
    out += ch;
  }
  return out;
}

function lineAt(text, offset) {
  let n = 1;
  for (let i = 0; i < offset && i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

// Atoi as the engine has it (common.go:212-240): optional sign, then digits up
// to the first non-digit; nothing numeric is 0.
function atoi(s) {
  const m = /^\s*([+-]?)(\d*)/.exec(String(s));
  const n = m[2] ? parseInt(m[2], 10) : 0;
  return m[1] === '-' ? -n : n;
}

// A literal state number: a bare signed integer, or const(name) through the
// common constants. Anything else - vars, arithmetic, redirection like
// `playerId($partnerId),const(StateTagJumpingIn)` - is computed and skipped.
function literalOf(raw, consts) {
  const v = String(raw).trim();
  if (/^[+-]?\d+$/.test(v)) return parseInt(v, 10);
  const c = /^const\s*\(\s*([^()\s]+)\s*\)$/i.exec(v);
  if (c && consts.has(c[1].toLowerCase())) return Math.trunc(consts.get(c[1].toLowerCase()));
  return null;
}

// ZSS [StateDef ...] headers. The ZSS compiler is a token stream, not a line
// reader (compiler.go:7985-8050), so a header may run onto the next line
// (tag.zss:74 `[StateDef const(StateTagEnteringScreen);` continues below).
// Only the number matters here, and it is always the token right after
// `statedef`: const(name) (scanStateDef, compiler.go:7338-7347), `+1` stored
// as -10 (7350-7355), `-N` (7358-7360), else Atoi.
function zssStatedefs(text, consts) {
  const src = blankComments(text, '#');
  const out = [];
  const re = /\[\s*statedef\s+(const\s*\(\s*([^()\s]+)\s*\)|\+\s*1\b|-\s*\d+|[^\s;\]]+)/gi;
  let m;
  while ((m = re.exec(src))) {
    let no = null;
    if (m[2] !== undefined) {
      const k = m[2].toLowerCase();
      no = consts.has(k) ? Math.trunc(consts.get(k)) : null;
    } else if (/^\+\s*1$/.test(m[1])) no = -10;
    else no = atoi(m[1].replace(/\s+/g, ''));
    out.push({ no, line: lineAt(src, m.index), raw: m[1] });
  }
  return out;
}

// CNS [Statedef N] headers, for a player config that lists a CNS file under
// [Common] States (the engine accepts either, defaultConfig.ini:17). The header
// must be `[statedef ` with the space (compiler.go:6809-6815).
function cnsStatedefs(text, consts) {
  const out = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].replace(/;.*/, '').trim();
    const m = /^\[statedef (.*)\]/i.exec(l);
    if (!m) continue;
    const body = m[1].trim();
    let no;
    const c = /^const\s*\(\s*([^()\s]+)\s*\)/i.exec(body);
    if (c) no = consts.has(c[1].toLowerCase()) ? Math.trunc(consts.get(c[1].toLowerCase())) : null;
    else if (/^\+\s*1\b/.test(body)) no = -10;
    else if (/^-?\d/.test(body)) no = atoi(body);
    else continue;
    out.push({ no, line: i + 1, raw: body });
  }
  return out;
}

// Split a ZSS parameter list on `;` at paren depth 0, outside quotes, keeping
// each piece's offset so its line can be reported.
function splitParams(body, base) {
  const parts = [];
  let depth = 0, inStr = false, start = 0;
  for (let i = 0; i <= body.length; i++) {
    const ch = body[i];
    if (i === body.length || (ch === ';' && depth === 0 && !inStr)) {
      parts.push({ text: body.slice(start, i), at: base + start });
      start = i + 1;
      continue;
    }
    if (ch === '"') inStr = !inStr;
    else if (!inStr && (ch === '(' || ch === '[')) depth++;
    else if (!inStr && (ch === ')' || ch === ']')) depth--;
  }
  return parts;
}

// LITERAL STATE TARGETS IN A ZSS FILE.
//
// A ZSS controller is `name{key: value; key: value}`, possibly spread over
// several lines, standing at the start of a statement: after a line break, a
// `{`, `}` or `;`, or after the `persistent(N)` / `ignorehitpause` prefixes.
// Requiring that position keeps `if isHelper {` style block openers from ever
// being read as a controller whose name happens to be the condition's last
// word. A controller carrying redirectid (or SelfState readplayerid) targets
// another player's table and is skipped, as is any non-literal value.
function zssRefs(text, consts, file, onComputed) {
  const src = blankComments(text, '#');
  const refs = [];
  const re = /(^|[{};]|ignorehitpause|persistent\s*\(\s*-?\d+\s*\))\s*([A-Za-z]\w*)\s*\{/gim;
  let m;
  while ((m = re.exec(src))) {
    const name = m[2].toLowerCase();
    const open = m.index + m[0].length; // just past '{'
    if (!STATE_PARAMS[name]) { re.lastIndex = open; continue; }
    let i = open, inStr = false;
    for (; i < src.length; i++) {
      const ch = src[i];
      if (ch === '"') inStr = !inStr;
      else if (!inStr && ch === '}') break;
    }
    const params = new Map();
    for (const p of splitParams(src.slice(open, i), open)) {
      const colon = p.text.indexOf(':');
      if (colon < 0) continue;
      const key = p.text.slice(0, colon).trim().toLowerCase();
      const lead = p.text.length - p.text.replace(/^\s+/, '').length;
      if (key && !params.has(key)) params.set(key, { raw: p.text.slice(colon + 1), at: p.at + lead });
    }
    re.lastIndex = i;
    if (params.has('redirectid') || (name === 'selfstate' && params.has('readplayerid'))) continue;
    for (const key of STATE_PARAMS[name]) {
      const p = params.get(key);
      if (!p) continue;
      const no = literalOf(p.raw, consts);
      if (no === null) {
        if (onComputed) onComputed({ raw: p.raw.trim(), at: p.at, line: lineAt(src, p.at), controller: m[2], param: key });
        continue;
      }
      refs.push({ no, file, line: lineAt(src, p.at), controller: m[2], param: key });
    }
  }
  return refs;
}

// LITERAL STATE TARGETS IN A CNS FILE: `[State ...]` blocks, `type =` names
// the controller, `key = value` lines its parameters (first occurrence wins,
// as IniSection.Parse keeps the first key, common.go:1010-1018).
function cnsRefs(text, consts, file) {
  const refs = [];
  const lines = text.split('\n');
  let cur = null;
  const flush = () => {
    if (!cur || !cur.type) return;
    const name = cur.type.toLowerCase();
    if (!STATE_PARAMS[name]) return;
    if (cur.params.has('redirectid') || (name === 'selfstate' && cur.params.has('readplayerid'))) return;
    for (const key of STATE_PARAMS[name]) {
      const p = cur.params.get(key);
      if (!p) continue;
      const no = literalOf(p.raw, consts);
      if (no !== null) refs.push({ no, file, line: p.line, controller: cur.type, param: key });
    }
  };
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].replace(/;.*/, '').trim();
    if (l.startsWith('[')) { flush(); cur = /^\[state /i.test(l) ? { type: null, params: new Map() } : null; continue; }
    if (!cur) continue;
    const kv = /^([^=]+?)\s*=\s*(.*)$/.exec(l);
    if (!kv) continue;
    const key = kv[1].toLowerCase();
    if (key === 'type') { if (!cur.type) cur.type = kv[2].trim(); continue; }
    if (!cur.params.has(key)) cur.params.set(key, { raw: kv[2], line: i + 1 });
  }
  flush();
  return refs;
}

// THE VALUES A COMPUTED STATE TARGET CAN TAKE, when it is built only from
// literals, conditions and ifElse. common1.cns.zss sends guard and get-hit
// states on with `130 + (stateType = C) + (stateType = A) * 2`
// (common1.cns.zss:285), `151 + 2 * (command = "holddown")` (:352) and
// `ifElse(getHitVar(yVel) || getHitVar(fall), 5030, 5001)` (:511): every
// comparison or logical operator is 0 or 1, so the set is small and exact.
// Anything else in the expression (a var, a trigger value) makes it null -
// not a root. A `$param` of a [Function] is replaced by each literal argument
// its `call`s pass (`call IkSys_GuardKnockedBack(130)`, :385). Uses the CNS
// expression reader, whose tokens and precedence are the engine's.
const VALUES_CAP = 64;
function valuesOf(raw, params) {
  const X = require('./cnsexpr.js');
  const uses = [...new Set((String(raw).match(/\$\w+/g) || []).map((x) => x.slice(1).toLowerCase()))];
  let texts = [String(raw)];
  for (const u of uses) {
    const args = params && params.get(u);
    if (!args || !args.length) return null;
    texts = texts.flatMap((t) => args.map((a) => t.replace(new RegExp('\\$' + u + '\\b', 'gi'), '(' + a + ')')));
  }
  const out = new Set();
  const cross = (a, b, f) => { if (!a || !b) return null; const r = new Set(); for (const x of a) for (const y of b) r.add(f(x, y)); return r.size > VALUES_CAP ? null : [...r]; };
  const walk = (n) => {
    switch (n.t) {
      case 'num': return [n.v];
      case 'neg': { const a = walk(n.a); return a && a.map((x) => -x); }
      case 'cmp': case 'range': case 'not': case 'and': case 'or': case 'xor': return [0, 1];
      case 'ifelse': { const a = walk(n.a), b = walk(n.b); return a && b ? [...new Set([...a, ...b])] : null; }
      case 'bin':
        if (n.o === '+') return cross(walk(n.a), walk(n.b), (x, y) => x + y);
        if (n.o === '-') return cross(walk(n.a), walk(n.b), (x, y) => x - y);
        if (n.o === '*') return cross(walk(n.a), walk(n.b), (x, y) => x * y);
        return null;
      default: return null;
    }
  };
  for (const t of texts) {
    let node = null;
    try { const tk = X.tokenize(t.trim()); node = tk && tk.length ? X.parse(tk) : null; } catch (e) { node = null; }
    const v = node && walk(node);
    if (!v) return null;
    for (const x of v) if (Number.isInteger(x)) out.add(x);
  }
  return out.size > VALUES_CAP ? null : [...out];
}

// `[Function name(a, b)]` sections and the literal-ish argument text every
// `call name(x, y)` passes, per parameter name (lowercased). Arguments are
// split on commas at parenthesis depth 0.
function functionArgs(src) {
  const params = new Map(); // function name -> [param names]
  for (const m of src.matchAll(/\[\s*function\s+(\w+)\s*\(([^)]*)\)/gi)) {
    params.set(m[1].toLowerCase(), m[2].split(',').map((x) => x.trim().toLowerCase()).filter(Boolean));
  }
  const byParam = new Map(); // function name -> Map param -> [arg text]
  for (const m of src.matchAll(/\bcall\s+(\w+)\s*\(/gi)) {
    const name = m[1].toLowerCase();
    const names = params.get(name);
    if (!names) continue;
    let depth = 1, i = m.index + m[0].length, start = i;
    const args = [];
    for (; i < src.length && depth > 0; i++) {
      const ch = src[i];
      if (ch === '(') depth++;
      else if (ch === ')') { depth--; if (depth === 0) args.push(src.slice(start, i)); }
      else if (ch === ',' && depth === 1) { args.push(src.slice(start, i)); start = i + 1; }
    }
    if (!byParam.has(name)) byParam.set(name, new Map());
    const map = byParam.get(name);
    names.forEach((p, k) => { if (args[k] === undefined) return; if (!map.has(p)) map.set(p, []); map.get(p).push(args[k].trim()); });
  }
  return byParam;
}

// Which [Function] (if any) an offset sits in: the last section header before
// it decides.
function sectionAt(src, offset) {
  let fn = null;
  for (const m of src.matchAll(/\[\s*(statedef|function)\b\s*(\w*)/gi)) {
    if (m.index > offset) break;
    fn = m[1].toLowerCase() === 'function' ? m[2].toLowerCase() : null;
  }
  return fn;
}

// THE NUMBERS THE MOTIF PUTS A CHARACTER IN. The continue and victory screens
// change state by number - `p1.state = 5500, 5300`, `p1.yes.state = 5510,
// 180`, `p1.no.state = 5520, 170` (defaultMotif.ini:2999-3001), `p1.state =
// 180` (:3388), `p1.state = 175, 170` / `p1.win.state = 180` (:3454-3455,
// :3512-3513) - taking the first number the character defines
// (motif.go:2874-2888 selfStatenoExist, then changeState). They are roots,
// never missing states. The kit has no src/, so this literal copy stands in;
// the test asserts it equals the parsed file whenever the source is there.
const FALLBACK_MOTIF_STATES = [5500, 5300, 5510, 180, 5520, 170, 175];
function parseMotifStates(text) {
  const out = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const m = /^\s*[\w.]*\.state\s*=\s*([^;]*)/i.exec(raw);
    if (!m) continue;
    for (const v of m[1].split(',')) {
      if (!/^\s*[+-]?\d/.test(v)) continue;
      const n = atoi(v);
      if (n >= 0 && !out.includes(n)) out.push(n);
    }
  }
  return out;
}

// [Common] of an ini text: keys matched case-insensitively by prefix + digits
// (config.go:47-50 `^(?i)States[0-9]*$`), values comma-split, keys ordered as
// SortedKeys does (prefix, then the numeric suffix, empty = 0). The first
// occurrence of a key wins, as everywhere else in the engine's ini reading.
function parseCommon(text) {
  const out = { states: [], air: [], consts: [] };
  const keys = { states: new Map(), air: new Map(), const: new Map() };
  let inCommon = false;
  for (const raw of text.split(/\r?\n/)) {
    const l = raw.replace(/;.*/, '').trim();
    const sec = /^\[([^\]]*)\]/.exec(l);
    if (sec) { inCommon = sec[1].trim().toLowerCase() === 'common'; continue; }
    if (!inCommon) continue;
    const kv = /^(states|air|const)(\d*)\s*=\s*(.*)$/i.exec(l);
    if (!kv) continue;
    const bucket = keys[kv[1].toLowerCase()];
    const key = kv[1].toLowerCase() + kv[2];
    if (bucket.has(key)) continue;
    bucket.set(key, { num: kv[2] ? parseInt(kv[2], 10) : 0, order: bucket.size,
      values: kv[3].split(',').map((s) => s.trim()).filter(Boolean) });
  }
  const flat = (bucket) => [...bucket.values()]
    .sort((a, b) => a.num - b.num || a.order - b.order)
    .flatMap((e) => e.values);
  out.states = flat(keys.states);
  out.air = flat(keys.air);
  out.consts = flat(keys.const);
  return out;
}

function readText(file) {
  try { return fs.readFileSync(file, 'latin1'); } catch (e) { return null; }
}

function create(engineDir, opts) {
  const root = engineDir;
  const desktopDirs = [].concat((opts && opts.desktopDir) || []);
  const memo = new Map();
  const once = (key, fn) => {
    if (!memo.has(key)) memo.set(key, fn());
    return memo.get(key);
  };
  const mode = (o) => (o && o.desktop ? 'desktop' : 'web');

  function commonConfig(o) {
    return once('config:' + mode(o), () => {
      const ini = readText(path.join(root, 'src', 'resources', 'defaultConfig.ini'));
      const base = ini !== null ? parseCommon(ini) : FALLBACK_COMMON;
      const out = {
        states: base.states.slice(),
        air: base.air.slice(),
        consts: base.consts.slice(),
        source: ini !== null ? 'defaultConfig.ini' : 'fallback',
      };
      if (o && o.desktop) out.states.push(DESKTOP_STATES);
      return out;
    });
  }

  // A [Common] path is tried against the engine folder; the desktop hook is
  // not engine data at all but a file the desktop export writes, so it is
  // looked for in the export folder too.
  function resolveRel(rel) {
    const dirs = [root].concat(rel.replace(/\\/g, '/').toLowerCase() === DESKTOP_STATES ? desktopDirs : []);
    for (const d of dirs) {
      const p = path.join(d, rel);
      if (fs.existsSync(p)) return p;
    }
    return null;
  }

  function commonFiles(o) {
    return once('files:' + mode(o), () => commonConfig(o).states.map((rel) => ({ rel, path: resolveRel(rel) })));
  }

  // common.const through IniSection.Parse (common.go:1002-1022): the first
  // section only, `;` comments, lowercased keys, first key wins, value Atof'd
  // (char.go:3967-3983).
  function consts() {
    return once('consts', () => constTable().values);
  }
  function constTable() {
    return once('constTable', () => {
      const values = new Map();
      const names = new Map();
      for (const rel of commonConfig().consts) {
        const text = readText(path.join(root, rel));
        if (text === null) continue;
        let seenSection = false;
        for (const raw of text.split(/\r?\n/)) {
          if (raw.startsWith('[')) { if (seenSection) break; seenSection = true; continue; }
          const l = raw.split(';')[0].trim();
          const m = /^([^=\s]+)\s*=\s*([+-]?(?:\d+\.?\d*|\.\d+))/.exec(l);
          if (!m) continue;
          const k = m[1].toLowerCase();
          if (values.has(k)) continue;
          values.set(k, parseFloat(m[2]));
          names.set(k, m[1]);
        }
      }
      return { values, names };
    });
  }

  function statedefsOf(file, text) {
    return /\.zss$/i.test(file) ? zssStatedefs(text, consts()) : cnsStatedefs(text, consts());
  }

  function stcommonStates() {
    return once('stcommon', () => {
      const text = readText(path.join(root, 'data', 'common1.cns.zss'));
      const set = new Set();
      if (text !== null) for (const s of zssStatedefs(text, consts())) if (s.no !== null) set.add(s.no);
      return set;
    });
  }

  function commonStates(o) {
    return once('states:' + mode(o), () => {
      const set = new Set();
      for (const f of commonFiles(o)) {
        const text = f.path && readText(f.path);
        if (!text) continue;
        for (const s of statedefsOf(f.rel, text)) if (s.no !== null) set.add(s.no);
      }
      return set;
    });
  }

  function commonStateRefs(o) {
    return once('refs:' + mode(o), () => {
      const refs = [];
      for (const f of commonFiles(o)) {
        const text = f.path && readText(f.path);
        if (!text) continue;
        const found = /\.zss$/i.test(f.rel) ? zssRefs(text, consts(), f.rel) : cnsRefs(text, consts(), f.rel);
        for (const r of found) refs.push(r);
      }
      return refs;
    });
  }

  // THE STATES THE ENGINE'S OWN common1 SENDS A CHARACTER TO. When a def's
  // stcommon resolves to data/common1.cns.zss, its statedefs are compiled
  // into her table (compiler.go:8360-8364) and their state changes run on her
  // numbers: 5900 enters 190 on round 1 (common1.cns.zss:996), 190 enters 191
  // (:452), 5070 enters 5071 (:659), 5080 enters 5081 (:700), 5100 enters
  // 5101 (:764). A character who defines her own 190 or 5101 is sent there by
  // the engine file, not by anything in hers, so each target is a root. The
  // computed targets count too, when valuesOf can list them exactly. A
  // character-local stcommon is a parsed state file instead, and its own edges
  // carry the walk.
  function stcommonRefs() {
    return once('stcommonRefs', () => {
      const rel = 'data/common1.cns.zss';
      const text = readText(path.join(root, rel));
      if (text === null) return [];
      const src = blankComments(text, '#');
      const fargs = functionArgs(src);
      const computed = [];
      const refs = zssRefs(text, consts(), rel, (c) => computed.push(c));
      for (const c of computed) {
        const fn = sectionAt(src, c.at);
        const vals = valuesOf(c.raw, fn ? fargs.get(fn) : null);
        if (!vals) continue;
        for (const no of vals) refs.push({ no, file: rel, line: c.line, controller: c.controller, param: c.param, computed: c.raw });
      }
      return refs.filter((r) => r.no >= 0);
    });
  }
  function stcommonRoots() {
    return once('stcommonRoots', () => new Set(stcommonRefs().map((r) => r.no)));
  }

  // THE ANIMATIONS THE ENGINE'S OWN common1 SHOWS in each of its states: the
  // header `anim: N` and every `changeAnim{value: ...}` in the statedef's
  // body. A computed value is listed through cnsexpr.valueSet
  // (`ifElse(selfAnimExist(44), 44, 41)`, common1.cns.zss:122, is 41 or 44);
  // ZSS spells `vel x`, which that reader does not take, so a value that
  // reads nothing but conditions hands back its literals (`cond(vel x = 0,
  // 41, ifElse(vel x > 0, 42, 43))`, :149, is 41-43). `open` when a value
  // cannot be listed (`anim + 3` :152, `$anim` :350). A character whose
  // stcommon is this file stands, walks and jumps in these (StateDef 0 shows
  // 0, 20 shows 20 or 21, :23-90): the pose she carries into a move she
  // starts from there.
  function stcommonAnims() {
    return once('stcommonAnims', () => {
      const X = require('./cnsexpr.js');
      const map = new Map();
      const text = readText(path.join(root, 'data', 'common1.cns.zss'));
      if (text === null) return map;
      const src = blankComments(text, '#');
      const defs = zssStatedefs(text, consts());
      // zssStatedefs' own header scan, so the k-th start is the k-th def.
      const starts = [];
      for (const m of src.matchAll(/\[\s*statedef\s+(const\s*\(\s*([^()\s]+)\s*\)|\+\s*1\b|-\s*\d+|[^\s;\]]+)/gi)) starts.push(m.index);
      defs.forEach((d, k) => {
        if (d.no === null || starts[k] === undefined) return;
        const body = src.slice(starts[k], k + 1 < starts.length ? starts[k + 1] : src.length);
        const out = { anims: [], open: false };
        const add = (v) => { if (Number.isInteger(v) && v >= 0 && !out.anims.includes(v)) out.anims.push(v); };
        const head = /^\[[^\]]*\]/.exec(body);
        const ha = head && /\banim\s*:\s*(-?\d+)\s*[;\]]/i.exec(head[0]);
        if (ha) add(parseInt(ha[1], 10));
        const ty = head && /\btype\s*:\s*([a-z])/i.exec(head[0]);
        out.type = ty ? ty[1].toLowerCase() : null;
        const mt = head && /\bmovetype\s*:\s*([a-z])/i.exec(head[0]);
        out.movetype = mt ? mt[1].toLowerCase() : null;
        for (const m of body.matchAll(/\bchangeanim\s*\{[^}]*?\bvalue\s*:\s*([^;}]+)/gi)) {
          const raw = m[1].trim();
          const vals = X.valueSet(raw);
          if (vals && vals.length <= 64) { vals.forEach(add); continue; }
          if (vals === null && !/\banim\b|\$|\b(sys)?f?var\s*\(|gethitvar/i.test(raw)) { for (const x of raw.match(/\b\d+\b/g) || []) add(parseInt(x, 10)); continue; }
          out.open = true;
        }
        if (!map.has(d.no)) map.set(d.no, out);
      });
      return map;
    });
  }

  function motifStates() {
    return once('motif', () => {
      const ini = readText(path.join(root, 'src', 'resources', 'defaultMotif.ini'));
      return new Set(ini !== null ? parseMotifStates(ini) : FALLBACK_MOTIF_STATES);
    });
  }

  // Negative literals are not roots: TargetState/HitDef/Tag ignore them and
  // ChangeState/SelfState turn them into 0, which is a root already.
  function commonStateRoots(o) {
    return once('roots:' + mode(o), () => new Set(commonStateRefs(o).map((r) => r.no).filter((n) => n >= 0)));
  }

  // common.air's action headers. Only the number is needed: the engine merges
  // these under the character's own actions, numbers she lacks only
  // (char.go:4312-4330). Header number via Atoi, as ReadAction does.
  function commonAirActions() {
    return once('air', () => {
      const set = new Set();
      for (const rel of commonConfig().air) {
        const text = readText(path.join(root, rel));
        if (text === null) continue;
        for (const raw of text.split(/\r?\n/)) {
          const m = /^\s*\[\s*begin\s+action\s+([^\]]*)\]/i.exec(raw.replace(/;.*/, ''));
          if (m) set.add(atoi(m[1]));
        }
      }
      return set;
    });
  }

  function hardcodedStates() {
    return new Set(HARDCODED.map((h) => h.no));
  }

  // EVERY NAME THE STATE COMPILER KNOWS, read out of the compiler itself.
  //
  // Two tables in src/compiler.go: `c.scmap` (compiler.go:37) is every state
  // controller `type =` accepts, and `triggerMap` (compiler.go:203) is every
  // trigger and redirection an expression may name. Both are needed to say
  // whether a state file written for another engine will COMPILE here, and
  // that question has a hard answer: an unrecognized controller type is
  // `Error("Invalid state controller: ")` (compiler.go:6891) and an
  // unrecognized name in an expression is `Error("Invalid data: ")`
  // (compiler.go:1605, 5227), neither of which is behind ignoreMostErrors -
  // which nothing in this engine ever sets (its only assignments are
  // compiler.go:7977 and 7979, both to false or a restore). A state file that
  // trips either one does not load the character; a file listed in [Common]
  // States that trips it does not load ANY character.
  //
  // Read rather than baked in, for the same reason commonConfig is read:
  // the next engine version adds controllers and triggers, and a list copied
  // into this file would go quietly stale and start calling new names invalid.
  // null when the checkout has no source - the caller then says the check
  // could not be made instead of pretending everything is fine.
  function symbolsIn(text, startRe) {
    const at = text.search(startRe);
    if (at < 0) return null;
    const rest = text.slice(at);
    // Both literals are closed by a brace at the start of its own line, at the
    // indentation the literal was opened at - one tab inside newCharCompiler,
    // none for the package-level var.
    const ends = [rest.indexOf('\n\t}\n'), rest.indexOf('\n}\n')].filter((x) => x > 0);
    if (!ends.length) return null;
    const body = rest.slice(0, Math.min(...ends));
    const out = new Set();
    for (const m of body.matchAll(/"([a-z0-9_.]+)"\s*:/g)) out.add(m[1]);
    return out.size ? out : null;
  }
  function compilerText() {
    return once('compiler.go', () => readText(path.join(root, 'src', 'compiler.go')));
  }
  function stateControllers() {
    return once('scmap', () => {
      const t = compilerText();
      return t === null ? null : symbolsIn(t, /c\.scmap = map\[string\]scFunc\{/);
    });
  }
  function triggers() {
    return once('triggerMap', () => {
      const t = compilerText();
      return t === null ? null : symbolsIn(t, /var triggerMap = map\[string\]int\{/);
    });
  }

  function retiredStates() {
    return once('retired', () => {
      const { values, names } = constTable();
      const map = new Map();
      for (const [old, name] of RETIRED) {
        const k = name.toLowerCase();
        if (values.get(k) === old + RETIRED_OFFSET) map.set(old, names.get(k));
      }
      return map;
    });
  }

  // Memoized inside, a fresh copy out: an audit adds its own roots to the set
  // it gets back, and that must not leak into the next character's audit.
  const copy = (v) => (v instanceof Set ? new Set(v) : v instanceof Map ? new Map(v)
    : Array.isArray(v) ? v.map((x) => Object.assign({}, x))
    : Object.fromEntries(Object.entries(v).map(([k, x]) => [k, Array.isArray(x) ? x.slice() : x])));
  const out = (fn) => (o) => copy(fn(o));
  return {
    root,
    commonConfig: out(commonConfig), commonFiles: out(commonFiles), consts: out(consts),
    stcommonStates: out(stcommonStates), commonStates: out(commonStates),
    commonStateRoots: out(commonStateRoots), commonStateRefs: out(commonStateRefs),
    commonAirActions: out(commonAirActions), hardcodedStates, retiredStates: out(retiredStates),
    stateControllers: () => { const s = stateControllers(); return s ? new Set(s) : null; },
    triggers: () => { const s = triggers(); return s ? new Set(s) : null; },
    stcommonRefs: out(stcommonRefs), stcommonRoots: out(stcommonRoots), motifStates: out(motifStates),
    stcommonAnims: () => new Map([...stcommonAnims()].map(([k, v]) => [k, { anims: v.anims.slice(), open: v.open, type: v.type, movetype: v.movetype }])),
  };
}

// The default instance over the engine folder the build uses, created on first
// use so requiring this module costs nothing.
let dflt = null;
function inst() {
  if (!dflt) {
    const layout = require('./layout.js');
    dflt = create(layout.dir('ikemen-go-src'), { desktopDir: layout.DESKTOP_EXPORT });
  }
  return dflt;
}

module.exports = {
  commonConfig: (o) => inst().commonConfig(o),
  commonFiles: (o) => inst().commonFiles(o),
  consts: () => inst().consts(),
  stcommonStates: () => inst().stcommonStates(),
  commonStates: (o) => inst().commonStates(o),
  commonStateRoots: (o) => inst().commonStateRoots(o),
  commonStateRefs: (o) => inst().commonStateRefs(o),
  commonAirActions: () => inst().commonAirActions(),
  hardcodedStates: () => inst().hardcodedStates(),
  retiredStates: () => inst().retiredStates(),
  stateControllers: () => inst().stateControllers(),
  triggers: () => inst().triggers(),
  stcommonRefs: () => inst().stcommonRefs(),
  stcommonRoots: () => inst().stcommonRoots(),
  motifStates: () => inst().motifStates(),
  stcommonAnims: () => inst().stcommonAnims(),
  engineDir: () => inst().root,
  create,
  HARDCODED, RETIRED, FALLBACK_COMMON, DESKTOP_STATES, FALLBACK_MOTIF_STATES,
  // Exposed for the test's synthetic files.
  zssStatedefs, zssRefs, cnsStatedefs, cnsRefs, parseCommon, parseMotifStates, valuesOf,
};
