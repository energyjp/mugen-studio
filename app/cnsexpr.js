// A small evaluator for CNS trigger and value expressions, three-valued.
//
//   evalExpr(text, ctx) -> number | boolean | null      (null = unknown)
//   varsOf(text)        -> ['var(40)', 'fvar(35)', ...]
//   solveAll(text, domains[, fixed]) -> Map value -> [{ 'var(40)': 1, 'var(39)': 0 }, ...]
//   evalTriggerSet({ all, groups }, ctx) -> true | false | null
//   leavesOf(text)      -> the literal numbers an ifelse can produce
//   indirectTargets(text, ctx) -> ['var(7)'] (what `var(var(59))` names, not in ctx)
//
// The subset that decides a pose: numbers, var(N) / fvar(N) / sysvar(N) /
// sysfvar(N), `random`, `time`, `anim`, identifiers (animtime, command,
// stateno, ...) which are unknown, ifelse / abs / floor, unary - ! ~, **,
// * / %, + -, comparisons < > <= >=, then = != and the interval forms
// `x = [a,b]` / `x != (a,b]`, then the bitwise & ^ | on int32, then
// && ^^ || - the engine's own precedence ladder (see parse). A string
// literal is unknown (commands are run-time).
//
// REDIRECTS bind to the next value only, as the compiler's expValue does:
// `target,SelfAnimExist(N) = 1` is `(target,SelfAnimExist(N)) = 1`. Inside
// a function's argument list a comma separates arguments (`ifelse(!var(2),
// 1010, 1015)`) - except right after a redirect keyword, whose comma the
// compiler requires (`ifelse(Parent,var(13) = 0, ...)`); inside parentheses
// it redirects again.
// A redirected victim probe (`target,SelfAnimExist(N)`, `enemy,AnimExist(N)`,
// `enemynear,...`, `p2,...`) answers from ctx.victimHas; a bare
// `SelfAnimExist(N)` asks the character running the state and answers from
// ctx.selfHas. Either is unknown without its set. `anim = N` answers from
// ctx.animSet (the animations the state can hold) when N is not among them.
// Anything the parser cannot read is unknown, never a throw: this reads
// third-party files.
//
// A redirect to anyone else (`helper(6600), var(15)`, `parent, stateno`)
// is unknown, unless ctx.missingRedirect(name, id, hasId) returns true: then
// the player is known not to exist and the value is the engine's undefined.
//
// A bare `AnimExist(N)` reads the table of the animation she is showing
// (char.go:5266-5277, c.animPN), `SelfAnimExist(N)` always her own
// (5280-5285): AnimExist answers from ctx.animHas when that key is present
// in ctx (null there = unknown), otherwise from ctx.selfHas.
//
// NAMES. `Name = "X"` / `P1Name` compare the running character's [Info]
// name, `DisplayName` her display name and `AuthorName` the author, all
// lowercased on both sides and never undefined (compiler.go:1365-1375 nameSub,
// 3154-3175; bytecode.go:2718-2726). Only = and != compile after a name. They
// answer from ctx.nameEq(which, text) -> true | false | null; P2Name..P8Name
// (other players) stay unknown.
//
// ISHELPER answers from ctx.isHelper: false makes IsHelper and IsHelper(N)
// false (a root is no helper, char.go:5524-5528); true makes a bare IsHelper
// true (5540-5543), IsHelper(N) stays unknown - unless ctx.helperId names
// the helper's own id: then IsHelper(N) with N >= 0 is N = that id
// (5545-5547; a mob member read as itself, never as his other copies of its
// states - WrestlerX's Royal Rumble 7442). A negative N, which the engine
// answers by the character's version, and IsHelper(N, index), which counts
// helpers, stay unknown.
//
// `var(N) := expr` is the value of expr (compiler.go:1281-1297: the right
// side is an expEqne); nothing is written into ctx.
//
// A redirected variable (`enemy, var(36)`) answers from
// ctx.redirVar(name, id, 'var(36)') when that returns a number.
//
// AN INDEX THAT IS AN EXPRESSION (`var(var(59))`, ero_helper_gs' helper
// reading its own action table): the compiler takes one argument of any
// kind and the engine reads the index at run time (compiler.go:1280-1310
// _var, bytecode.go:2381 OC_var -> char.go:8037 varGet, the index as ToI).
// The index is evaluated, then that variable read from ctx; a negative
// index is the engine's undefined and reads as unknown here, as does an
// index that is not known. varsOf lists the index's variables; solveAll
// enumerates the variable it names over that variable's own domain, once
// the index is known (a sum over the index's values, not a product).
//
// STATENO / PREVSTATENO, un-redirected, answer from ctx.stateno /
// ctx.prevstateno when the caller knows them (a statedef's own number, the
// state it was entered from); otherwise unknown, as before.
//
// TWO HOOKS for a caller that knows more triggers (cmdlist.js reads cancels
// and distances with them; every other caller passes neither, and nothing
// changes): ctx.unk(node, evalChild) answers an un-redirected trigger
// (`ctrl`, `movecontact`, `p2bodydist` of `P2BodyDist X`, `numhelper(N)`;
// node.id lowercased, node.args its arguments) and ctx.cmpHook(node) a
// comparison (`statetype = S`, `hitdefattr = SC, NA`); either returns
// undefined to fall through to the rules above.
//
// ctx: { 'var(40)': 1, ..., random: 3, time: 0, victimHas: Set, selfHas: Set, animHas: Set|null,
//        animSet: Set, missingRedirect: (name, id, hasId) => bool, nameEq: (which, text) => bool|null,
//        isHelper: bool, helperId: number, redirVar: (name, id, varName) => number|undefined, stateno: number, prevstateno: number,
//        unk: (node, evalChild) => value|undefined, cmpHook: (node) => value|undefined }
'use strict';

function tokenize(s) {
  const t = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9.]/.test(c)) { let j = i; while (j < s.length && /[0-9.]/.test(s[j])) j++; t.push({ k: 'num', v: parseFloat(s.slice(i, j)) }); i = j; continue; }
    if (/[a-z_]/i.test(c)) { let j = i; while (j < s.length && /[a-z0-9_.]/i.test(s[j])) j++; t.push({ k: 'id', v: s.slice(i, j).toLowerCase() }); i = j; continue; }
    if (c === '"') { let j = i + 1; while (j < s.length && s[j] !== '"') j++; t.push({ k: 'str', v: s.slice(i + 1, j) }); i = j + 1; continue; }
    const two = s.slice(i, i + 2);
    if (['!=', '<=', '>=', '&&', '||', '^^', ':=', '**'].includes(two)) { t.push({ k: 'op', v: two }); i += 2; continue; }
    if ('+-*/%=<>!(),[]&|^~'.includes(c)) { t.push({ k: 'op', v: c }); i++; continue; }
    return null;                                  // something we do not read
  }
  return t;
}

const VICTIM_REDIRECT = /^(target|enemy|enemynear|p2|p4|partner)$/;
const VICTIM_PROBE = /^(selfanimexist|animexist)$/;
// Redirect keywords that take an id or index in parentheses: expValue's
// "partner", "enemy", "enemynear", "playerid", "player", "playerindex",
// "helperindex" (compiler.go:1466) and "helper", "target" (1543). Root,
// Parent, P2 and StateOwner (1429) take none.
// The name triggers nameSub compiles (compiler.go:1835, 2355, 3154-3175).
const NAME_TRIGGER = /^(name|p[1-8]name|authorname|displayname)$/;
const AXIS_TRIGGER = /^(pos|vel|screenpos|p2dist|p2bodydist|rootdist|parentdist)$/;
const REDIRECT_WITH_ID = /^(helper|target|partner|enemy|enemynear|playerid|player|playerindex|helperindex)$/;
// Every redirect keyword: the compiler REQUIRES the comma after it, inside a
// function's arguments too (compiler.go:1429-1590 - "Missing ',' after
// Parent"), so there the comma is the redirect's, never a separator:
// `ifelse(Parent,var(13) = 0, Random % 2, Parent,var(13) - 1)` is three
// arguments, two of them read of the parent.
const REDIRECT_KEYWORD = /^(root|parent|p2|stateowner|helper|target|partner|enemy|enemynear|playerid|player|playerindex|helperindex)$/;

function parse(tokens) {
  let p = 0;
  // > 0 while inside a function's argument list: a comma is a separator.
  let inArgs = 0;
  const peek = () => tokens[p];
  const take = () => tokens[p++];
  const isOp = (v) => peek() && peek().k === 'op' && peek().v === v;
  function primary() {
    const t = take();
    if (!t) throw 0;
    if (t.k === 'num') return { t: 'num', v: t.v };
    if (t.k === 'str') return { t: 'str', v: t.v.toLowerCase() };
    if (t.k === 'op' && t.v === '(') { const save = inArgs; inArgs = 0; const e = or(); inArgs = save; if (!isOp(')')) throw 0; take(); return e; }
    if (t.k === 'op' && t.v === '-') return { t: 'neg', a: unary() };
    if (t.k === 'op' && t.v === '!') return { t: 'not', a: unary() };
    if (t.k === 'op' && t.v === '~') return { t: 'bnot', a: unary() };
    if (t.k === 'id') {
      const name = t.v;
      let args = null;
      if (isOp('(')) {
        take();
        args = [];
        inArgs++;
        if (!isOp(')')) { args.push(or()); while (isOp(',')) { take(); args.push(or()); } }
        inArgs--;
        if (!isOp(')')) throw 0;
        take();
      }
      // A redirect binds to the NEXT value only. `helper(6600), var(15)`
      // carries its id in parentheses: only the redirect keywords may, since
      // any other `f(x), y` at top level is not a redirect but a parse error.
      if (isOp(',') && (inArgs === 0 || REDIRECT_KEYWORD.test(name)) && (!args || (REDIRECT_WITH_ID.test(name) && args.length <= 2))) {
        take();
        const rest = unary();
        if (VICTIM_REDIRECT.test(name) && rest.t === 'probe') return Object.assign({}, rest, { redirected: true });
        // The redirected value is read from somebody else: unknown, unless
        // ctx.missingRedirect says the player is not there (see ev).
        return { t: 'redir', name, id: args && args.length && args[0].t === 'num' ? args[0].v : null, hasId: !!(args && args.length), r: rest };
      }
      if (args) {
        if (['var', 'fvar', 'sysvar', 'sysfvar'].includes(name) && args.length === 1 && args[0].t === 'num') {
          const vn = name + '(' + args[0].v + ')';
          if (isOp(':=')) { take(); return { t: 'assign', name: vn, a: eqne() }; }
          return { t: 'var', name: vn };
        }
        // (An index that is an expression: `var(var(59))`.)
        if (['var', 'fvar', 'sysvar', 'sysfvar'].includes(name) && args.length === 1) {
          if (isOp(':=')) { take(); return { t: 'assign', name: null, a: eqne(), idx: args[0], kind: name }; }
          return { t: 'ivar', kind: name, idx: args[0] };
        }
        if (VICTIM_PROBE.test(name) && args.length === 1 && args[0].t === 'num') return { t: 'probe', n: args[0].v, redirected: false, self: name === 'selfanimexist' };
        if (name === 'ishelper' && args.length <= 2) return { t: 'ishelper', args };
        if (name === 'ifelse' && args.length === 3) return { t: 'ifelse', c: args[0], a: args[1], b: args[2] };
        if (name === 'cond' && args.length === 3) return { t: 'ifelse', c: args[0], a: args[1], b: args[2] };
        if (name === 'abs' && args.length === 1) return { t: 'abs', a: args[0] };
        if (name === 'floor' && args.length === 1) return { t: 'floor', a: args[0] };
        if (name === 'ceil' && args.length === 1) return { t: 'ceil', a: args[0] };
        return { t: 'unk', id: name, args };
      }
      // `P2BodyDist X`, `Vel Y`, `Pos X`: the next token is the component
      // (compiler.go:3213 pos, 3572 screenpos, 3973 vel, 4035-4082 the
      // distances) - one unknown value, not two identifiers.
      if (AXIS_TRIGGER.test(name) && peek() && peek().k === 'id' && /^[xyz]$/.test(peek().v)) { take(); return { t: 'unk', id: name }; }
      if (name === 'random') return { t: 'random' };
      if (name === 'time') return { t: 'time' };
      if (name === 'anim') return { t: 'anim' };
      if (name === 'ishelper') return { t: 'ishelper', args: [] };
      if (NAME_TRIGGER.test(name)) return { t: 'nameref', which: name };
      return { t: 'unk', id: name };
    }
    throw 0;
  }
  // THE ENGINE'S LADDER, loosest first (compiler.go at 96413d2):
  //   ||  expBoolOr   5736      ^^  expBoolXor  5732      &&  expBoolAnd  5692
  //   |   expOr       5688      ^   expXor      5684      &   expAnd      5680
  //   = != and ranges  expEqne  5595 (expRange 5505)
  //   < > <= >=        expGrls  5474
  //   + -  expAdsb 5449    * / %  expMldv 5421    **  expPow 5389 (left to right)
  //   - ~ ! bind to the single value after them (expValue, 1600-1660).
  // Equality sits BELOW the ordering comparisons: `a = b < c` is a = (b < c).
  function unary() {
    if (isOp('-')) { take(); return { t: 'neg', a: unary() }; }
    if (isOp('!')) { take(); return { t: 'not', a: unary() }; }
    if (isOp('~')) { take(); return { t: 'bnot', a: unary() }; }
    return primary();
  }
  function pow() { let a = unary(); while (isOp('**')) { take(); a = { t: 'bin', o: '**', a, b: unary() }; } return a; }
  function mul() { let a = pow(); while (isOp('*') || isOp('/') || isOp('%')) { const o = take().v; a = { t: 'bin', o, a, b: pow() }; } return a; }
  function add() { let a = mul(); while (isOp('+') || isOp('-')) { const o = take().v; a = { t: 'bin', o, a, b: mul() }; } return a; }
  function grls() {
    let a = add();
    while (isOp('<') || isOp('>') || isOp('<=') || isOp('>=')) { const o = take().v; a = { t: 'cmp', o, a, b: add() }; }
    return a;
  }
  function eqne() {
    let a = grls();
    while (isOp('=') || isOp('!=')) {
      const o = take().v;
      // expRange (compiler.go:5484-5603): `[` or `(` opens an interval whose
      // bounds are full expressions; a `(` with no comma inside is only a
      // parenthesised operand, and the engine rewinds to read it as one.
      if (isOp('[') || isOp('(')) {
        const at = p;
        const lo = take().v; const save = inArgs; inArgs = 1; const x = or();
        if (isOp(',')) {
          take(); const y = or(); inArgs = save;
          const hi = take(); if (!hi || hi.k !== 'op' || (hi.v !== ']' && hi.v !== ')')) throw 0;
          a = { t: 'range', a, x, y, loInc: lo === '[', hiInc: hi.v === ']', neg: o === '!=' };
          continue;
        }
        inArgs = save;
        if (lo !== '(') throw 0;
        p = at;
      }
      a = { t: 'cmp', o, a, b: grls() };
    }
    return a;
  }
  function band() { let a = eqne(); while (isOp('&')) { take(); a = { t: 'bit', o: '&', a, b: eqne() }; } return a; }
  function bxor() { let a = band(); while (isOp('^')) { take(); a = { t: 'bit', o: '^', a, b: band() }; } return a; }
  function bor() { let a = bxor(); while (isOp('|')) { take(); a = { t: 'bit', o: '|', a, b: bxor() }; } return a; }
  function and() { let a = bor(); while (isOp('&&')) { take(); a = { t: 'and', a, b: bor() }; } return a; }
  function xor() { let a = and(); while (isOp('^^')) { take(); a = { t: 'xor', a, b: and() }; } return a; }
  function or() { let a = xor(); while (isOp('||')) { take(); a = { t: 'or', a, b: xor() }; } return a; }
  const e = or();
  if (p !== tokens.length) throw 0;
  return e;
}

const AST_CACHE = new Map();
function ast(text) {
  const key = String(text == null ? '' : text);
  if (AST_CACHE.has(key)) return AST_CACHE.get(key);
  let a = null;
  try { const t = tokenize(key.replace(/;.*$/, '').trim()); a = t && t.length ? parse(t) : null; } catch (e) { a = null; }
  if (AST_CACHE.size > 20000) AST_CACHE.clear();
  AST_CACHE.set(key, a);
  return a;
}

// UNDEFINED. A redirect to a player who is not there pushes
// BytecodeUndefined and skips the redirected value (bytecode.go:1953-1961,
// OC_helper; parent/root the same just above). It is represented here as
// NaN, and only ever produced when ctx.missingRedirect(name, id) says so,
// so no existing caller sees one. The engine reads it as 0 in arithmetic and
// comparisons (ToI/ToF, bytecode.go:1099-1112), as false in a condition
// (ToB, 1121), and `!` and ranges keep it undefined (blnot 1368-1377,
// rangeCheck 1538-1542).
const isUndef = (v) => typeof v === 'number' && Number.isNaN(v);
const truthy = (v) => (v === null ? null : (typeof v === 'boolean' ? v : (isUndef(v) ? false : v !== 0)));
const num = (v) => (typeof v === 'boolean' ? +v : (isUndef(v) ? 0 : v));
// int32(value) the way ToI hands it to the bitwise operators
// (bytecode.go:1608-1642 and(), xor(), or(); not() at 1359).
const toI = (v) => { const x = num(v); return Number.isFinite(x) ? (Math.trunc(x) | 0) : 0; };
// Integer power as bytecode.go:1384-1420 computes it, square-and-multiply
// in int32. A character with neither ikemenversion nor mugenversion 1.x
// walks the exponent's bits in a different order (the oldVersion branch):
// the two agree for most exponents, and where they differ the version is
// not known here, so the answer is unknown.
function intPow(base, exp) {
  const run = (old) => {
    let hb = -1;
    while ((exp >>> (hb + 1)) !== 0 && hb < 31) hb++;
    let i = 1, tmp = base | 0;
    for (let bit = 0; bit <= hb; bit++) {
      const shift = old && bit !== hb ? (hb - 1) - bit : bit;
      if (exp & (1 << shift)) i = Math.imul(i, tmp);
      tmp = Math.imul(tmp, tmp);
    }
    return i;
  };
  const a = run(false), b = run(true);
  return a === b ? a : null;
}
// The variable an indexed read names under ctx ('var(7)'), or null when its
// index is not known or is negative (the engine's undefined, char.go:8038).
function ivarName(n, ctx) {
  const i = ev(n.idx, ctx);
  if (i === null || isUndef(i)) return null;
  const k = Math.trunc(num(i));
  return Number.isFinite(k) && k >= 0 ? n.kind + '(' + k + ')' : null;
}
function ev(n, ctx) {
  switch (n.t) {
    case 'num': return n.v;
    case 'unk':
      if (typeof ctx.unk === 'function') { const v = ctx.unk(n, (x) => ev(x, ctx)); if (v !== undefined) return v; }
      return !n.args && (n.id === 'stateno' || n.id === 'prevstateno') && typeof ctx[n.id] === 'number' ? ctx[n.id] : null;
    case 'str': case 'nameref': return null;
    case 'ivar': { const nm = ivarName(n, ctx); return nm !== null && Object.prototype.hasOwnProperty.call(ctx, nm) ? ctx[nm] : null; }
    case 'assign': return ev(n.a, ctx);
    case 'ishelper':
      if (ctx.isHelper === false) return false;
      if (ctx.isHelper === true && !n.args.length) return true;
      if (ctx.isHelper === true && n.args.length === 1 && Number.isInteger(ctx.helperId)) {
        const id = ev(n.args[0], ctx);
        if (typeof id === 'number' && Number.isFinite(id) && Math.trunc(id) >= 0) return Math.trunc(id) === ctx.helperId;
      }
      return null;
    case 'redir':
      if (typeof ctx.redirVar === 'function' && n.r.t === 'var') { const v = ctx.redirVar(n.name, n.id, n.r.name); if (typeof v === 'number') return v; }
      return typeof ctx.missingRedirect === 'function' && ctx.missingRedirect(n.name, n.id, n.hasId) ? NaN : null;
    case 'random': return typeof ctx.random === 'number' ? ctx.random : null;
    case 'time': return typeof ctx.time === 'number' ? ctx.time : null;
    case 'anim': return typeof ctx.anim === 'number' ? ctx.anim : null;
    case 'var': return Object.prototype.hasOwnProperty.call(ctx, n.name) ? ctx[n.name] : null;
    case 'probe': {
      const set = n.redirected ? ctx.victimHas : (!n.self && Object.prototype.hasOwnProperty.call(ctx, 'animHas') ? ctx.animHas : ctx.selfHas);
      return set instanceof Set ? set.has(n.n) : null;
    }
    case 'neg': { const a = ev(n.a, ctx); return a === null ? null : -num(a); }
    case 'abs': { const a = ev(n.a, ctx); return a === null ? null : Math.abs(num(a)); }
    case 'floor': { const a = ev(n.a, ctx); return a === null ? null : Math.floor(num(a)); }
    case 'ceil': { const a = ev(n.a, ctx); return a === null ? null : Math.ceil(num(a)); }
    case 'not': { const a = ev(n.a, ctx); if (isUndef(a)) return a; const t = truthy(a); return t === null ? null : !t; }
    case 'bnot': { const a = ev(n.a, ctx); return a === null ? null : ~toI(a); }
    case 'bit': { const a = ev(n.a, ctx), b = ev(n.b, ctx); if (a === null || b === null) return null;
      const x = toI(a), y = toI(b);
      return n.o === '&' ? x & y : n.o === '|' ? x | y : x ^ y; }
    case 'ifelse': { const c = truthy(ev(n.c, ctx)); if (c === null) { const a = ev(n.a, ctx), b = ev(n.b, ctx); return a === b ? a : null; } return c ? ev(n.a, ctx) : ev(n.b, ctx); }
    case 'bin': { const a = ev(n.a, ctx), b = ev(n.b, ctx); if (a === null || b === null) return null;
      const x = num(a), y = num(b);
      if (n.o === '**') {
        // Float power when either side is fractional or the exponent is
        // negative; int32 square-and-multiply otherwise.
        if (Number.isInteger(x) && Number.isInteger(y) && y >= 0) return intPow(x, y);
        const r = Math.pow(x, y); return Number.isFinite(r) ? r : null;
      }
      switch (n.o) { case '+': return x + y; case '-': return x - y; case '*': return x * y; case '/': return y === 0 ? null : Math.trunc(x / y); case '%': return y === 0 ? null : x % y; } return null; }
    case 'cmp': {
      if (typeof ctx.cmpHook === 'function') { const v = ctx.cmpHook(n); if (v !== undefined) return v; }
      // `anim = N` against the animations the state can hold: N outside
      // the set can never be equal.
      if (ctx.animSet instanceof Set && (n.o === '=' || n.o === '!=')) {
        const side = n.a.t === 'anim' && n.b.t === 'num' ? n.b.v : (n.b.t === 'anim' && n.a.t === 'num' ? n.a.v : null);
        if (side !== null && typeof ctx.anim !== 'number' && !ctx.animSet.has(side)) return n.o === '!=';
      }
      // `Name = "X"` and its kin.
      if ((n.o === '=' || n.o === '!=') && ((n.a.t === 'nameref' && n.b.t === 'str') || (n.b.t === 'nameref' && n.a.t === 'str'))) {
        const ref = n.a.t === 'nameref' ? n.a : n.b, str = n.a.t === 'str' ? n.a : n.b;
        const which = ref.which === 'p1name' ? 'name' : ref.which;
        const r = typeof ctx.nameEq === 'function' && !/^p[2-8]name$/.test(which) ? ctx.nameEq(which, str.v) : null;
        return r === null || r === undefined ? null : (n.o === '=' ? !!r : !r);
      }
      const a = ev(n.a, ctx), b = ev(n.b, ctx); if (a === null || b === null) return null;
      const x = num(a), y = num(b);
      switch (n.o) { case '=': return x === y; case '!=': return x !== y; case '<': return x < y; case '>': return x > y; case '<=': return x <= y; case '>=': return x >= y; } return null; }
    case 'range': { const a = ev(n.a, ctx), x = ev(n.x, ctx), y = ev(n.y, ctx); if (a === null || x === null || y === null) return null;
      if (isUndef(a) || isUndef(x) || isUndef(y)) return NaN;
      const v = num(a), lo = num(x), hi = num(y);
      const inside = (n.loInc ? v >= lo : v > lo) && (n.hiInc ? v <= hi : v < hi); return n.neg ? !inside : inside; }
    case 'and': { const a = truthy(ev(n.a, ctx)); if (a === false) return false; const b = truthy(ev(n.b, ctx)); if (b === false) return false; return (a === null || b === null) ? null : true; }
    case 'or': { const a = truthy(ev(n.a, ctx)); if (a === true) return true; const b = truthy(ev(n.b, ctx)); if (b === true) return true; return (a === null || b === null) ? null : false; }
    case 'xor': { const a = truthy(ev(n.a, ctx)), b = truthy(ev(n.b, ctx)); return (a === null || b === null) ? null : a !== b; }
  }
  return null;
}

function evalExpr(text, ctx) { const a = ast(text); return a ? ev(a, ctx || {}) : null; }
function parses(text) { return !!ast(text); }

// (`deep` also walks an index expression: its variables are read, but an
// ifelse inside it picks a variable, not a value - leavesOf stays out.)
function walk(n, fn, deep) { if (!n) return; fn(n); for (const k of deep ? ['a', 'b', 'c', 'x', 'y', 'idx'] : ['a', 'b', 'c', 'x', 'y']) if (n[k]) walk(n[k], fn, deep); }
function varsOf(text) { const out = []; walk(ast(text), (n) => { if (n.t === 'var' && !out.includes(n.name)) out.push(n.name); }, true); return out; }
function usesRandom(text) { let r = false; walk(ast(text), (n) => { if (n.t === 'random') r = true; }, true); return r; }
// The literal numbers an ifelse / cond can hand back, whatever its condition.
function leavesOf(text) { const out = []; walk(ast(text), (n) => { if (n.t === 'ifelse') for (const k of ['a', 'b']) if (n[k].t === 'num' && !out.includes(n[k].v)) out.push(n[k].v); }); return out; }

// The variables an indexed read names under ctx that ctx does not hold yet
// (`var(var(59))` with var(59) = 7 and no var(7): ['var(7)']), for a caller
// that enumerates variables itself and has to add them.
function indirectTargets(text, ctx) {
  const out = [];
  const c = ctx || {};
  walk(ast(text), (n) => {
    if (n.t !== 'ivar') return;
    const nm = ivarName(n, c);
    if (nm !== null && !Object.prototype.hasOwnProperty.call(c, nm) && !out.includes(nm)) out.push(nm);
  }, true);
  return out;
}

// Every value the expression takes over the variables' domains, each with
// the assignments that produce it: one enumeration per expression, however
// many states are then matched against it. Map value -> [assignment].
// fixed (optional): values the caller knows, such as { stateno: 3000,
// prevstateno: 3010 } - in the evaluation, never in the assignments. With
// fixed, an expression with no variable gives its one value with an empty
// assignment ({}); without, it gives nothing, as it always has.
function solveAll(text, domains, fixed) {
  const out = new Map();
  const a = ast(text);
  const names = varsOf(text);
  const ind = [];
  walk(a, (n) => { if (n.t === 'ivar') ind.push(n); }, true);
  if ((!names.length && !ind.length && !fixed) || names.length > 3 || !a) return out;
  const dom = (n) => (domains && domains[n] && domains[n].length ? domains[n] : Array.from({ length: 16 }, (_, i) => i));
  const fixedKeys = fixed ? Object.keys(fixed) : [];
  let budget = 65536;
  const record = (ctx) => {
    const v = ev(a, ctx);
    if (!Number.isFinite(v)) return;
    const asg = Object.assign({}, ctx);
    for (const k of fixedKeys) delete asg[k];
    if (!out.has(v)) out.set(v, []);
    out.get(v).push(asg);
  };
  // An indexed read whose index is now known names a variable not yet
  // assigned: that variable over its own domain, then the rest.
  const leaf = (ctx) => {
    if (--budget < 0) return;
    for (const n of ind) {
      const nm = ivarName(n, ctx);
      if (nm === null || Object.prototype.hasOwnProperty.call(ctx, nm)) continue;
      for (const v of dom(nm)) { ctx[nm] = v; leaf(ctx); }
      delete ctx[nm];
      return;
    }
    record(ctx);
  };
  const rec = (i, ctx) => {
    if (i === names.length) { leaf(ctx); return; }
    for (const v of dom(names[i])) { ctx[names[i]] = v; rec(i + 1, ctx); }
    delete ctx[names[i]];
  };
  rec(0, Object.assign({}, fixed || {}));
  return out;
}

// The distinct values an expression with `random` can take (random sampled
// over a spread that covers %2..%10 and the usual `random < 500` splits).
const RANDOM_SAMPLES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 99, 100, 250, 333, 420, 421, 499, 500, 501, 666, 750, 900, 998, 999];
function evalRandom(text, ctx) {
  const out = [];
  for (const r of RANDOM_SAMPLES) { const v = evalExpr(text, Object.assign({}, ctx || {}, { random: r })); if (v !== null && !out.includes(v)) out.push(v); }
  return out;
}

// A controller's trigger set: triggerall lines AND-ed, then trigger1..N
// OR-ed (each group AND-ed). true / false / null.
function evalTriggerSet(set, ctx) {
  const andOf = (exprs) => { let r = true; for (const e of exprs) { const v = truthy(evalExpr(e, ctx)); if (v === false) return false; if (v === null) r = null; } return r; };
  const a = andOf(set.all || []);
  if (a === false) return false;
  const groups = set.groups || [];
  if (!groups.length) return a;
  let any = false;
  for (const g of groups) { const v = andOf(g); if (v === true) { any = true; break; } if (v === null) any = null; }
  if (any === false) return false;
  if (any === null || a === null) return null;
  return true;
}

// Everything an expression reads, redirects included: [{ via, field, n, op }].
// via is the redirect keyword (null for the runner herself), field the
// trigger name ('var(N)', 'stateno', 'p2name', 'animexist', 'ishelper', ...),
// n the literal it is compared with by = or != (null otherwise), op that
// operator when the read is one side of = or != (null otherwise). A
// redirected SelfAnimExist / AnimExist reads as field 'animexist' via the
// redirect.
function readsOf(text) {
  const out = [];
  // (An indexed read, `var(var(59))`, is field 'var' - the name it always
  // read as - and its index's reads follow.)
  const fieldOf = (x) => (x.t === 'var' || x.t === 'assign' ? x.name : x.t === 'probe' ? 'animexist' : x.t === 'nameref' ? x.which
    : x.t === 'ishelper' ? 'ishelper' : x.t === 'unk' ? x.id || null : x.t === 'ivar' ? x.kind : x.t);
  const rec = (x, via, cmpN, op) => {
    if (!x) return;
    if (x.t === 'redir') { rec(x.r, x.name, cmpN, op); return; }
    if (x.t === 'probe' && x.redirected) { out.push({ via: 'target', field: 'animexist', n: null, op: op || null }); return; }
    if (x.t === 'cmp' && (x.o === '=' || x.o === '!=')) {
      rec(x.a, via, x.b.t === 'num' ? x.b.v : undefined, x.o); rec(x.b, via, x.a.t === 'num' ? x.a.v : undefined, x.o); return;
    }
    if (['var', 'assign', 'probe', 'nameref', 'ishelper', 'unk', 'time', 'anim', 'random', 'ivar'].includes(x.t)) {
      const f = fieldOf(x);
      if (f) out.push({ via: via || null, field: f, n: cmpN === undefined ? null : cmpN, op: op || null });
    }
    for (const k of ['a', 'b', 'c', 'x', 'y', 'idx']) if (x[k]) rec(x[k], via, undefined, null);
    if (x.args) for (const g of x.args) rec(g, via, undefined, null);
  };
  rec(ast(text), null, undefined, null);
  return out;
}

// The finite set of values an expression can take, or null when it cannot
// be listed. dom(name) gives a variable's values (null: open). Random is
// 0-999 (bytecode.go OC_random), a condition 0 or 1, and a product with a
// factor that is always 0 is 0 whatever the other side is: `8600 +
// 0*(var(23) := 900)` is 8600, `200*!var(20)` is 0 or 200. At most SET_CAP
// values per node. ctx (optional, what evalExpr takes) settles the conditions
// it can: `ifelse(name != "Eltnum", 2502, 415)` is 415 for Eltnum.
const SET_CAP = 4096;
function valueSet(text, dom, ctx) {
  const decided = (x) => { if (!ctx) return null; const v = truthy(ev(x, ctx)); return v === null ? null : [v ? 1 : 0]; };
  const uniq = (a) => [...new Set(a)].sort((p, q) => p - q);
  const cross = (a, b, f) => {
    if (!a || !b || a.length * b.length > SET_CAP) return null;
    const r = [];
    for (const x of a) for (const y of b) { const v = f(x, y); if (v === null || !Number.isFinite(v)) return null; r.push(v); }
    return uniq(r);
  };
  const BOOL = [0, 1];
  const vs = (x) => {
    switch (x.t) {
      case 'num': return [x.v];
      case 'neg': { const a = vs(x.a); return a && uniq(a.map((v) => -v)); }
      case 'abs': { const a = vs(x.a); return a && uniq(a.map(Math.abs)); }
      case 'floor': { const a = vs(x.a); return a && uniq(a.map(Math.floor)); }
      case 'ceil': { const a = vs(x.a); return a && uniq(a.map(Math.ceil)); }
      case 'var': { const d = typeof dom === 'function' ? dom(x.name) : null; return d && d.length ? uniq(d) : null; }
      // (Every variable the index can name, each over its own values.)
      case 'ivar': {
        const ix = vs(x.idx);
        if (!ix || ix.length > 64 || typeof dom !== 'function') return null;
        const all = [];
        for (const k of ix) {
          if (!Number.isFinite(k) || Math.trunc(k) < 0) return null;
          const d = dom(x.kind + '(' + Math.trunc(k) + ')');
          if (!d || !d.length) return null;
          all.push(...d);
        }
        return all.length ? uniq(all) : null;
      }
      case 'assign': return vs(x.a);
      case 'unk': { const v = ctx ? ev(x, ctx) : null; return typeof v === 'number' ? [v] : null; }
      case 'random': return Array.from({ length: 1000 }, (_, i) => i);
      case 'not': { const d = decided(x); if (d) return d; const a = vs(x.a); return a ? uniq(a.map((v) => (v === 0 ? 1 : 0))) : BOOL; }
      case 'bnot': { const a = vs(x.a); return a && uniq(a.map((v) => ~(Math.trunc(v) | 0))); }
      case 'cmp': case 'range': case 'and': case 'or': case 'xor': case 'probe': case 'ishelper': return decided(x) || BOOL;
      case 'ifelse': {
        const c = vs(x.c);
        const takeA = !c || c.some((v) => v !== 0), takeB = !c || c.some((v) => v === 0);
        const a = takeA ? vs(x.a) : [], b = takeB ? vs(x.b) : [];
        return a && b ? uniq([...a, ...b]) : null;
      }
      case 'bit': return cross(vs(x.a), vs(x.b), (p, q) => { const i = Math.trunc(p) | 0, j = Math.trunc(q) | 0; return x.o === '&' ? i & j : x.o === '|' ? i | j : i ^ j; });
      case 'bin': {
        const a = vs(x.a), b = vs(x.b);
        if (x.o === '*' && ((a && a.length === 1 && a[0] === 0) || (b && b.length === 1 && b[0] === 0))) return [0];
        return cross(a, b, (p, q) => {
          switch (x.o) {
            case '+': return p + q; case '-': return p - q; case '*': return p * q;
            case '/': return q === 0 ? null : Math.trunc(p / q);
            case '%': return q === 0 ? null : p % q;
            case '**': return Number.isInteger(p) && Number.isInteger(q) && q >= 0 ? intPow(p, q) : null;
          }
          return null;
        });
      }
      default: return null;
    }
  };
  const a = ast(text);
  return a ? vs(a) : null;
}

module.exports = { readsOf, valueSet, evalExpr, parses, varsOf, usesRandom, leavesOf, solveAll, evalRandom, evalTriggerSet, tokenize, parse, RANDOM_SAMPLES, indirectTargets };
