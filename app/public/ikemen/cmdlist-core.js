// THE COMMAND LIST WRITER: Ikemen GO's pause-menu Command List, made from the
// character's own files and written into the COPY a build ships.
//
// The engine shows a Command List only when the .def's [Files] names a
// `movelist` text file (char.go loadMovelists: `movelist`, then `movelist0`,
// then `movelistN`, each read with LoadText - bytes as they are, a UTF-8 BOM
// dropped, no Shift-JIS decode of the CONTENT; the file NAME is decoded).
// menu.lua f_commandlistParse draws it: every key of the motif's [Glyphs]
// (`_D _DF _F _+ ^X ^A ... ~D`) found in the text is replaced by its picture,
// longest key first; `<#rrggbb>` .. `</>` colors a run; a field after one tab
// is centered, after two or more right-aligned. A census of 1,747 characters
// (2026-10-13) found 8% ship one and 74% name nearly all their specials and
// supers in their own code - so for most characters the list can be written.
//
// WHAT A ROW IS. A ChangeState in the character's [Statedef -1] whose value is
// a state number - a literal, or an `Ifelse(<more>, EX, normal)` followed down
// its else branch (the state entered when nothing more is true) - and whose
// triggers ask for a command (`command = "QCF_x"`; several in one trigger group
// are pressed together, `holdfwd` + `x` = F+x; the trigger lines are read as
// expressions, so `(command = "holdfwd" || command = "holdback") && command =
// "pp"` is F + x+y): the state is the move, the command's first [Command]
// definition is the input (the first one that is a CHARGE, when one is: see
// THE NOTATION). The stance the group's lines ask for prints with it:
// `statetype = A` = in the air (`_AIR`), `statetype = C` with no down in
// the input = down + the button. Read with the Studio's
// own readers: scenelib's stateFiles (the engine's file order, the first
// [Files] only) and parseStates (the engine's statedef rules, including a -1
// that a MUGEN character defines again in a later file being dropped, and
// `[State <any text>]` controller headers). One row per target state, first
// block in file order; groups by the state number (1000-2999 special,
// 3000-4999 super - KOF-style EX specials cost a stock, so power cannot tell),
// and 200-999 only where the input is more than a button (F+x, a+b, a motion,
// a direction in the air): "Unique Attacks", the heading KFM's own list and
// shipped lists give command normals. Plain normals, crouching normals and
// movement stay out of the file.
//
// EVERY INPUT (`inputs`). Beside the rows, every state the -1 reaches by a
// command gets its input, stance included, whatever its number: plain normals
// (`^X`, `_D_+^X`, `_AIR^X`), throws, a version merged into another line,
// the when-true branch of an Ifelse (with the command its condition asks for)
// and a computed value with a few possible states (`220 + (Abs(P2bodydist X)
// <= 25) * 5` = 220 and 225, cnsexpr.valueSet). A character with her own list
// gets them too. The Moves page prints them; the file does not. A later state of the
// same group with the same input whose name repeats an earlier one's (a cancel
// version) is one line. AI routing stays out: a command named CPU/AI/COM<n>,
// or a trigger that asks for AILevel to be on.
//
// THE NAME, first that reads like a name (`descriptive`, the census's rule):
//   owner    the name typed on the Moves page (roster key commandList.names)
//   label    the controller header's text: `[State -1, Kung Fu Palm]`, or the
//            whole header when it has no comma and is not a number
//            (`[State Scramble Dash]`). A label the character uses for 3 or
//            more different target states is copy-pasted template text, never
//            a name; so is KFM's "Kung Fu ..." in a character that is not KFM.
//   command  the command's name (`"レイスピン"`, `"Fireball"`; `QCF_x` is not one)
//   comment  the comment on the header line or on the line above it, else the
//            one at the target statedef
//   readme   the character's own readme, ONLY when the code gives no name the
//            stock menu can print and the readme names the move unambiguously
//            (see THE README below)
// Shift-JIS bytes (not valid UTF-8) are decoded, so the page and the file
// both carry UTF-8. A row with no name that reads like one still gets the
// best text it has (`weak: true`) - the page flags it for the owner.
//
// THE STRENGTHS. CvS-style characters list a move once per button (Light,
// Medium and Strong Hayate: Makoto had 43 lines). Rows of one group whose
// input is the same motion ending in ONE button of one family (punches x y z,
// kicks a b c), with different buttons, and whose names are equal once a
// strength word is taken out (Light/Medium/Strong/Heavy/Fierce/Jab/Short/
// Roundhouse/Weak/Hard, L/M/H, LP..HK, 弱/中/強, or the button itself as a
// suffix: `Kacho Sen_x`), print as ONE line: all three buttons of the family
// = the motif's "any punch"/"any kick" glyph `^P`/`^K` (the engine's own KFM
// list writes `_QDF^P`), two of them = `^X/^Y` (a slash drawn as text between
// glyphs, as KFM's `[_B/_F]`). The line is the first state's: the owner's name
// and hide for it apply to the line; a later version the owner renamed or hid
// stays a line of its own. The row says which states it stands for (`merged`).
//
// THE FILE. `<#f0f000>:Special Moves:</>` heads (the color KFM's own list
// uses), then `<name>\t\t<glyphs>` (the input right-aligned), CRLF, UTF-8 with
// no BOM. A name is cleaned so the engine reads it as text: no tabs or angle
// brackets, and `_` `^` `~` (the glyph keys' first characters) become a space.
// THE NOTATION. The input is the .cmd notation in the engine's glyph keys,
// step by step: `~D, DF, F, x` -> `_D_DF_F^X`. A CHARGE (chargeStart: the
// first step is one released direction held N ticks, `~30$B`, or a released
// back/down going into forward/up, `~$B, F` / `~$D, U` - Balrog and Guile
// count the charge in their own variables, so the notation is the only tell)
// prints as the motif's hollow "hold" arrow and its "..." glyph: `~$B, F, x` ->
// `~B_._F^X` (the shipped template's `~B... _F`). A button held N ticks
// (`~30x`, `/30x`) is `_HOLD^X`. A held direction followed by buttons is one
// press (`/F,z` -> `_F_+^Z`); any other ~ / $ > on a direction is a plain
// arrow. Nothing is compressed into the motif's quarter-circle glyphs: every
// motif has the eight arrows. Every token is a key of defaultMotif.ini [Glyphs].
//
// NEVER INTO THE CHARACTER'S OWN FOLDER. shipFor returns the new def text and
// the file; desktop.js writes them into the folder it just copied, vfslib's
// website build overlays them. A character whose .def already names a
// movelist that exists and is not empty is never touched (`own`). A .def that
// names one that is missing gets ours as the FIRST line of [Files], because a
// key's first value wins.
//
// THE SWITCH: per character, on unless the owner turned it off on the Moves
// page (roster key commandList.off). DOCS: GRAIL 3.10e.
//
// PROXIMITY (`inputs[].range`). One button, two moves by distance: a value
// like Balrog's `220 + (Abs(P2bodydist X) <= 25) * 5` read with the distance
// at 0 and far away (225 close, 220 far), or a block gated on `P2BodyDist X`
// / `P2Dist X` in its own trigger lines (close / far), with the next block
// on the same input and stance and no distance in it as the other one.
// -> { kind: 'close'|'far', op, dist, by: 'P2BodyDist X', file, line }.
//
// ONE WRITER, two hosts. The Studio's exports and Moves page (cmdlist.js,
// which hands it the character's folder on the disk) and the web game's
// in-page Studio (studio-lite.html: a character a player adds gets her list
// when she is added, beside her def in the build the page assembles) run
// this file, so a list written in the browser is the export's, byte for byte.
// Pure: no fs, no path, no Buffer, no DOM; the files come through an io
// (THE FILES, below). Needs scenelib-core.js and cnsexpr-core.js (loaded
// before it on a page).
(function (root, factory) {
  const api = typeof module === 'object' && module.exports
    ? factory(require('./scenelib-core.js'), require('./cnsexpr-core.js'))
    : factory(root.scenelibCore, root.cnsexprCore);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.cmdlistCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (S, X) {
  'use strict';

  const HEAD_COLOR = '<#f0f000>';
  const GROUPS = [
    { id: 'special', title: 'Special Moves' },
    { id: 'super', title: 'Super Moves' },
    { id: 'other', title: 'Unique Attacks' },
  ];
  const FILE_NAME = 'movelist.dat';
  const MAX_NAME = 48;

  // ---- text -------------------------------------------------------------------------
  // latin1 text (one char per byte) -> what it says: ASCII as is, valid UTF-8
  // as UTF-8, else Shift-JIS (the census: ~30% of names are), Korean or
  // Windows-1252 by strict decodes (scenelib.decodeText, the one decoder every
  // name source shares).
  const decodeText = S.decodeText;
  // The census's test for "reads like a name": Japanese (or any non-ASCII run),
  // or an ASCII word of 3+ letters that is not input shorthand.
  const GEN_TOKEN = /^(?:(?:qcf|qcb|hcf|hcb|rdp|dp|srk|fwd|forward|back|backward|bwd|down|up|hold|tap|charge|[fbdu]|d[fb]|u[fb]|x?\d+)+[abcxyzpks]*\d*|[abcxyzs]{1,3}|[pk]{1,3}|[lmh][pk]|ex|max|start|ai|cpu|state|changestate|change|cs|special|specials|super|supers|hyper|hypers|move|moves|attack|command|cmd|button|press|throw|lv\d*|level\d*|version|ver|v\d*|air|jump|jumping|crouch|crouching|stand|standing|light|medium|heavy|strong|weak|punch|kick|lp|mp|hp|lk|mk|hk|the|and|or|of|to|on|in|vs)$/i;
  const NOT_A_NAME = /^(?:error|null|dummy|debug|test|tmp|temp|reset|varset|helper|nothing|unused|todo|fix|ok)$/i;
  function descriptive(s) {
    if (!s) return false;
    s = String(s).trim();
    if (NOT_A_NAME.test(s)) return false;
    if (/[^\x00-\x7f]/.test(s)) return /\p{L}/u.test(s.replace(/[\x00-\x7f]/g, ''));
    const toks = s.split(/[\s_\-+.,()/:;'"!?&*#]+|(?<=[a-z])(?=[A-Z])/).filter(Boolean);
    return toks.some((t) => /[a-z]{3,}/i.test(t) && !GEN_TOKEN.test(t));
  }
  // Can the stock pause menu fonts draw it? Printable ASCII only (the web
  // build's list font is an ASCII pixel font standing in for Open_Sans.def; a
  // Japanese name printed blank there). The first name they draw wins a move
  // (readChar); jpfont.js takes this rule from here.
  const stockDraws = (s) => /^[\x20-\x7e]*$/.test(String(s == null ? '' : s));
  // Will the build draw it? The stock pause menu fonts draw printable ASCII
  // only (the web build's list font is an ASCII pixel font standing in for
  // Open_Sans.def, DEVLOG 11b; Kula's katakana printed blank there, headless,
  // 2026-10-18) - so a build whose list has a name they cannot draw ships
  // DotGothic16 for the list (jpfont.js), and a name THAT font draws (kana,
  // kanji, Latin, Greek, Cyrillic) is drawable too. Hangul and simplified-only
  // Chinese are not: the page still flags them. This is the row's flag only;
  // which candidate names a move still prefers the stock fonts (readChar).
  // The Studio hands that test in (`opts.drawable`, jpfont.js); without it,
  // stockDraws.
  // A comment line as a name: rules and box-drawing runs dropped.
  function commentText(raw) {
    return String(raw || '').replace(/^\s*;+/, '').replace(/[-=*#~_─━]{2,}/g, ' ').replace(/\s+/g, ' ').trim();
  }
  // What the engine reads as text in a movelist line. `_ ^ ~` begin the default
  // glyph keys (`Hard_Drive` would print a Down arrow), `< >` begin a color or
  // glyph tag, a tab moves to the next column.
  function cleanName(name) {
    let s = String(name == null ? '' : name).replace(/[\t\r\n]+/g, ' ').replace(/[<>]/g, ' ').replace(/[_^~]/g, ' ');
    s = s.replace(/\s+/g, ' ').trim();
    if ([...s].length > MAX_NAME) s = [...s].slice(0, MAX_NAME).join('').trim();
    return s;
  }

  // ---- the .cmd notation -> the engine's glyph keys -------------------------------------
  const DIRS = new Set(['F', 'B', 'U', 'D', 'DF', 'DB', 'UF', 'UB']);
  const BUTTONS = new Set(['a', 'b', 'c', 'x', 'y', 'z', 's', 'd', 'w']);
  // One .cmd step part (`~30$B`, `/D`, `x`, `>F`) -> { kind, key, release, hold, ticks } or null.
  // (Whether a direction is a CHARGE is decided per command: chargeStart.)
  function readPart(p) {
    const m = /^([~/$>]*)(\d*)([~/$>]*)([A-Za-z]+)$/.exec(p);
    if (!m) return null;
    const pre = m[1] + m[3];
    const key = m[4];
    const release = pre.includes('~');
    const hold = pre.includes('/');
    const ticks = m[2] ? parseInt(m[2], 10) : 0;
    if (DIRS.has(key)) return { kind: 'dir', key, release, hold, ticks };
    if (BUTTONS.has(key)) return { kind: 'btn', key, release, hold, ticks };
    return null;
  }
  // Is a command's first step a CHARGE? One direction, released (`~`) or held
  // (`/`, Ikemen) for N > 0 ticks (`~30$B`); or released with no count, a
  // back going into a forward or a down into an up (`~$B, F`, `~DB, DF`,
  // `~$D, $U`): Balrog and Guile count the charge in a variable, the engine
  // checks no time for a bare `~`. Not a motion's leading release (`~D, DF, F`,
  // `~B, DB, D`, `~F, B, D, F`).
  function chargeStart(steps) {
    const s0 = steps && steps[0];
    if (!s0 || s0.length !== 1 || s0[0].kind !== 'dir') return false;
    const q = s0[0];
    if ((q.release || q.hold) && q.ticks > 0) return true;
    if (!q.release) return false;
    const next = steps[1] && steps[1].find((p) => p.kind === 'dir');
    if (!next) return false;
    return (/B/.test(q.key) && /F/.test(next.key)) || (/D/.test(q.key) && /U/.test(next.key));
  }
  // a part -> its glyph key: a charged direction is the hollow hold arrow (`~B`),
  // any other direction a press (`_B`); a button held N ticks is `_HOLD^X`.
  // `plain`: a direction folded into a press (holdfwd + x) is always a press.
  const glyphOfPart = (q, plain) => (q.kind === 'btn'
    ? ((q.release || q.hold) && q.ticks > 0 ? '_HOLD' : '') + '^' + q.key.toUpperCase()
    : (!plain && q.charge ? '~' : '_') + q.key);
  // `~D, DF, F, x` -> { steps: [[part..]..], glyphs: '_D_DF_F^X', input: '~D, DF, F, x' } | null
  function convertCommand(notation) {
    const src = String(notation || '').replace(/\s+/g, '');
    if (!src) return null;
    const steps = [];
    for (const el of src.split(',')) {
      if (!el) return null;
      const parts = [];
      for (const p of el.split('+')) {
        const q = readPart(p);
        if (!q) return null;
        parts.push(q);
      }
      steps.push(parts);
    }
    // a held direction, then buttons: pressed together (`/F,z` = F+z, CvS throws)
    for (let i = 0; i + 1 < steps.length; i++) {
      const a = steps[i], b = steps[i + 1];
      if (a.length === 1 && a[0].kind === 'dir' && a[0].hold && !a[0].release && !a[0].ticks && b.length && b.every((q) => q.kind === 'btn')) steps.splice(i, 2, [...a, ...b]);
    }
    const charge = chargeStart(steps);
    if (charge) steps[0][0].charge = true;
    // a charge step is followed by the motif's "..." (`_.`): hold, then the rest
    const glyphs = steps.map((parts, i) => parts.map((q) => glyphOfPart(q)).join('_+') + (charge && i === 0 && steps.length > 1 ? '_.' : '')).join('');
    return { steps, glyphs, input: src.split(',').join(', '), charge };
  }
  // Several commands a trigger asks for together (`holdfwd` and `x`): the
  // directions first, pressed with the rest. -> { steps, glyphs, input } | null
  function combineCommands(list) {
    const conv = list.map((c) => c && convertCommand(c)).filter(Boolean);
    if (!conv.length || conv.length !== list.length) return null;
    if (conv.length === 1) return conv[0];
    // a command that is one held/pressed direction becomes that direction, pressed together
    const dirOnly = (c) => c.steps.length === 1 && c.steps[0].length === 1 && c.steps[0][0].kind === 'dir';
    const dirs = conv.filter(dirOnly), rest = conv.filter((c) => !dirOnly(c));
    if (rest.length > 1 || !rest.length) {
      // two buttons, or two directions: one step, everything together
      const parts = conv.flatMap((c) => (c.steps.length === 1 ? c.steps[0] : null)).filter(Boolean);
      if (parts.length !== conv.length) return null;
      const ordered = [...parts.filter((q) => q.kind === 'dir'), ...parts.filter((q) => q.kind === 'btn')];
      return { steps: [ordered], glyphs: ordered.map((q) => glyphOfPart(q, true)).join('_+'), input: ordered.map((q) => q.key).join('+') };
    }
    const main = rest[0];
    let dParts = dirs.map((c) => c.steps[0][0]);
    // holdfwd + holddown is one diagonal
    const keys = new Set(dParts.map((q) => q.key));
    if (dParts.length === 2 && (keys.has('F') || keys.has('B')) && (keys.has('U') || keys.has('D'))) {
      dParts = [{ kind: 'dir', key: (keys.has('U') ? 'U' : 'D') + (keys.has('F') ? 'F' : 'B'), hold: true, release: false, ticks: 0 }];
    }
    const steps = main.steps.slice();
    steps[0] = [...dParts, ...steps[0]];
    const glyphs = dParts.map((q) => glyphOfPart(q, true) + '_+').join('') + main.glyphs;
    return { steps, glyphs, input: dParts.map((q) => q.key + '+').join('') + main.input };
  }
  // Worth a line in the Command List? A motion (2+ steps), two buttons together,
  // or a forward/back direction with a button. Not a lone button (a normal), not
  // down/up with a button (a crouching or jumping normal), not a lone direction.
  function isCommandMove(conv) {
    if (!conv) return false;
    if (conv.steps.length >= 2) return true;
    const parts = conv.steps[0] || [];
    const btns = parts.filter((q) => q.kind === 'btn');
    if (btns.length >= 2) return true;
    if (!btns.length) return false;
    return parts.some((q) => q.kind === 'dir' && /[FB]/.test(q.key));
  }
  // The Command List's test (isCommandMove with the stance): a direction in the
  // air is a command too (SFV G's `_AIR_D_+^MK`); a crouching or standing button
  // is a plain normal.
  function uniqueAttack(conv, stance) {
    if (isCommandMove(conv)) return true;
    if (!conv || stance !== 'air') return false;
    const parts = conv.steps[0] || [];
    return parts.some((q) => q.kind === 'btn') && parts.some((q) => q.kind === 'dir');
  }
  // The stance a trigger group's lines ask for: `statetype = A` -> 'air', C ->
  // 'crouch', S -> 'stand', else null (`statetype != A` is only "grounded").
  function stanceOf(lines) {
    for (const l of lines || []) {
      const m = /(?:^|[^!<>])\bstatetype\s*=\s*([sca])\b/i.exec(String(l));
      if (m) return { s: 'stand', c: 'crouch', a: 'air' }[m[1].toLowerCase()];
    }
    return null;
  }
  // An input with its stance -> { glyphs, bare } (bare: without it). In the air:
  // `_AIR` first (the engine's own KFM list: `_AIR_F_+^X`). Crouching, one
  // press with no down in it: down + it (`_D_+^X`; forward/back become the
  // down diagonal).
  function withStance(conv, stance) {
    const bare = conv.glyphs;
    if (stance === 'air') return { glyphs: '_AIR' + bare, bare };
    if (stance === 'crouch' && conv.steps.length === 1 && !conv.steps[0].some((q) => q.kind === 'dir' && /D/.test(q.key))) {
      const dirs = conv.steps[0].filter((q) => q.kind === 'dir');
      if (!dirs.length) return { glyphs: '_D_+' + bare, bare };
      if (dirs.length === 1 && /^[FB]$/.test(dirs[0].key)) return { glyphs: bare.replace(/^_([FB])(?=_\+)/, '_D$1'), bare };
    }
    return { glyphs: bare, bare };
  }
  // `ifelse(c, a, b)` / `cond(...)` at the top -> [c, a, b] | null
  function splitIfelse(v) {
    const m = /^(?:ifelse|cond)\s*\(([\s\S]*)\)$/i.exec(String(v || '').trim());
    if (!m) return null;
    const args = [];
    let depth = 0, from = 0, inStr = false;
    const body = m[1];
    for (let i = 0; i < body.length; i++) {
      const ch = body[i];
      if (ch === '"') inStr = !inStr;
      if (inStr) continue;
      if (ch === '(') depth++;
      else if (ch === ')') { depth--; if (depth < 0) return null; }
      else if (ch === ',' && depth === 0) { args.push(body.slice(from, i)); from = i + 1; }
    }
    args.push(body.slice(from));
    return args.length === 3 && depth === 0 ? args.map((a) => a.trim()) : null;
  }
  // A ChangeState's value -> the states it can enter:
  //   primary   the literal, or an Ifelse's else branch followed down (the rows)
  //   extra     [{ state, cond }] an Ifelse's when-true literal(s), with the condition
  //   computed  a value with 1..8 possible states (cnsexpr.valueSet, no variables)
  function targets(valueText) {
    const v = S.trimGo(String(valueText == null ? '' : valueText));
    const lit = (t) => (/^\+?\d+$/.test(String(t).trim()) ? parseInt(String(t).trim(), 10) : null);
    const few = (t) => { let r = null; try { r = X.valueSet(t); } catch (e) { r = null; } return Array.isArray(r) && r.length >= 1 && r.length <= 8 && r.every((n) => Number.isInteger(n) && n >= 0) ? r : null; };
    const out = { primary: [], extra: [], computed: [] };
    if (lit(v) !== null) { out.primary.push(lit(v)); return out; }
    if (splitIfelse(v)) {
      let cur = v;
      for (let guard = 0; guard < 8; guard++) {
        const a = splitIfelse(cur);
        if (!a) break;
        for (const n of (lit(a[1]) !== null ? [lit(a[1])] : few(a[1]) || [])) out.extra.push({ state: n, cond: a[0] });
        cur = a[2];
      }
      const d = lit(cur);
      if (d !== null) out.primary.push(d);
      else out.computed.push(...(few(cur) || []));
      return out;
    }
    out.computed.push(...(few(v) || []));
    return out;
  }

  // ---- the strengths: one line for a move's Light/Medium/Strong versions -------------------
  const FAMILY = { x: 'P', y: 'P', z: 'P', a: 'K', b: 'K', c: 'K' };
  const FAMILY_ORDER = 'xyzabc';
  const STRENGTH_WORD = /^(?:light|lite|medium|med|mid|middle|strong|heavy|hard|fierce|weak|jab|short|roundhouse|l|m|h|lp|mp|hp|lk|mk|hk)$/i;
  // A name with its strength taken out -> { base, marked } (marked: something was taken out).
  // `btn` is the row's own button (a `_x` / ` X` suffix that names it is a strength too).
  function strengthBase(name, btn) {
    let s = String(name == null ? '' : name).trim(), marked = false;
    // Japanese: 弱/中/強 at either end, with a ・ or brackets (花蝶扇・弱, 早蕨強, (弱)早蕨)
    const jp = s.replace(/^[(（[［]?[弱中強][)）\]］]?[・･\s]*|[・･\s]*[(（[［]?[弱中強][)）\]］]?$/g, '');
    if (jp !== s) { s = jp; marked = true; }
    if (btn) {
      const suf = new RegExp('[\\s_\\-.]+(?:' + btn + ')$', 'i');
      if (suf.test(s)) { s = s.replace(suf, ''); marked = true; }
    }
    const toks = s.split(/(\s+)/);
    const kept = [];
    for (const t of toks) {
      if (/\S/.test(t) && STRENGTH_WORD.test(t.replace(/^[(\[]|[)\].,:]$/g, ''))) { marked = true; continue; }
      kept.push(t);
    }
    return { base: kept.join('').replace(/\s+/g, ' ').replace(/^[\s・_\-.:]+|[\s・_\-.:]+$/g, ''), marked };
  }
  // `_D_DF_F^X` -> { prefix: '_D_DF_F', btn: 'x' } when the input ends in ONE button and holds no other
  const lastButton = (glyphs) => { const m = /^([^^]+)\^([XYZABC])$/.exec(String(glyphs || '')); return m ? { prefix: m[1], btn: m[2].toLowerCase() } : null; };
  // rows (sorted, one per state) -> rows with each move's strength versions as one line.
  // A row's `gen` = { name, nameFrom, weak } as the files name it (no owner's name).
  // drawable(name): the row's flag (stockDraws when none is given).
  function mergeStrengths(rows, ownerNames, hidden, drawable) {
    if (typeof drawable !== 'function') drawable = stockDraws;
    const clusters = new Map();
    for (const r of rows) {
      const lb = lastButton(r.glyphs);
      if (!lb || !r.gen || r.gen.weak) continue;
      const { base } = strengthBase(r.gen.name, lb.btn);
      if (!base || !descriptive(base)) continue;
      const key = r.group + '|' + lb.prefix + '|' + FAMILY[lb.btn] + '|' + base.toLowerCase();
      if (!clusters.has(key)) clusters.set(key, []);
      clusters.get(key).push({ r, lb, base });
    }
    const drop = new Set(), lines = new Map();
    for (const list of clusters.values()) {
      // one version per button, the first state for each; a later one the owner renamed or hid keeps its line
      const seen = new Set(), use = [];
      for (const m of list) {
        if (seen.has(m.lb.btn)) continue;
        if (use.length && (ownerNames[String(m.r.state)] !== undefined || hidden.has(m.r.state))) continue;
        seen.add(m.lb.btn); use.push(m);
      }
      if (use.length < 2) continue;
      // the names must differ by a strength word, or be the same name
      const marks = use.map((m) => strengthBase(m.r.gen.name, m.lb.btn).marked);
      const sameName = new Set(use.map((m) => m.r.gen.name.trim().toLowerCase())).size === 1;
      if (!sameName && !marks.some(Boolean)) continue;
      const btns = use.map((m) => m.lb.btn).sort((a, b) => FAMILY_ORDER.indexOf(a) - FAMILY_ORDER.indexOf(b));
      const fam = FAMILY[btns[0]];
      const glyphTail = btns.length === 3 ? '^' + fam : btns.map((b) => '^' + b.toUpperCase()).join('/');
      const first = use[0].r;
      const typed = ownerNames[String(first.state)];
      const owned = typeof typed === 'string' && cleanName(typed);
      const name = owned ? typed.trim() : (sameName ? first.gen.name : use[0].base);
      const input = first.input.replace(/[a-z]$/, btns.join('/'));
      lines.set(first, Object.assign({}, first, {
        name, nameFrom: owned ? 'owner' : first.gen.nameFrom, weak: false, drawable: drawable(cleanName(name)),
        input, glyphs: use[0].lb.prefix + glyphTail,
        merged: use.map((m) => ({ state: m.r.state, name: m.r.gen.name, nameFrom: m.r.gen.nameFrom, input: m.r.input, glyphs: m.r.glyphs })),
      }));
      for (const m of use.slice(1)) drop.add(m.r);
    }
    return rows.filter((r) => !drop.has(r)).map((r) => lines.get(r) || r);
  }

  // ---- the readme: a name the code does not give -------------------------------------------
  // The character's own text files (the folder's top level and the def's folder:
  // a .txt whose name says readme/move/command/list/info/manual, not one the def
  // compiles) often list each move as `Hayate: D, DF, F + p`. A line is read as
  // <name><: or - or = or tabs><input>, the input in the notations readmes use
  // (D DF F .. upper case, QCF/HCB/DP, numpad 236, arrows ↓↘→, buttons x..c,
  // P/K = any punch/kick, 2P, LP..HK, Start); a note in brackets is dropped; a
  // line with anything else in its input is not a move line.
  const README_NAME = /read|move|command|list|info|manual|howto|faq/i;
  const MOTION = { QCF: ['D', 'DF', 'F'], QCB: ['D', 'DB', 'B'], HCF: ['B', 'DB', 'D', 'DF', 'F'], HCB: ['F', 'DF', 'D', 'DB', 'B'], DP: ['F', 'D', 'DF'], RDP: ['B', 'D', 'DB'] };
  const NUMPAD = { 1: 'DB', 2: 'D', 3: 'DF', 4: 'B', 6: 'F', 7: 'UB', 8: 'U', 9: 'UF' };
  const ARROWS = { '↓': 'D', '↘': 'DF', '→': 'F', '↙': 'DB', '←': 'B', '↖': 'UB', '↑': 'U', '↗': 'UF' };
  const NAMED_BTN = { LP: 'x', MP: 'y', HP: 'z', LK: 'a', MK: 'b', HK: 'c' };
  // `D, DF, F + p (Hold)` -> { dirs: ['D','DF','F'], btns: ['P'], alts? } | null
  // A note that offers other buttons (`x (or y,z)`) makes them alternatives of
  // the last button (`alts`, every button set the line accepts); a note with
  // "or" that cannot be read leaves the line unread. Buttons one after another
  // (`a, b`, a target combo) are not one input.
  function readmeInput(text) {
    const src = String(text || '');
    const alts = [];
    for (const n of src.matchAll(/\(([^)]*)\)|（([^）]*)）/g)) {
      const t = n[1] || n[2] || '';
      if (!/\bor\b|\//i.test(t)) continue;
      const bs = t.replace(/\bor\b/gi, ' ').split(/[\s,/]+/).filter(Boolean);
      if (!bs.length || !bs.every((b) => /^(?:[xyzabc]|[PpKk])$/.test(b))) return null;
      alts.push(...bs.map((b) => (/^[pk]$/i.test(b) ? b.toUpperCase() : b)));
    }
    const s = src.replace(/\([^)]*\)|（[^）]*）|\*[^*]*\*/g, ' ').replace(/[[\]]/g, ' ').trim();
    if (!s) return null;
    const dirs = [], btns = [];
    const re = /\s*(?:(QCF|QCB|HCF|HCB|RDP|DP)(?![A-Za-z])|(DF|DB|UF|UB|D|F|B|U)(?![A-Za-z])|([↓↘→↙←↖↑↗])|([1-9]{2,})(?=\s*\+?\s*[A-Za-z])|([23])?(LP|MP|HP|LK|MK|HK|[PpKk])(?![A-Za-z])|([xyzabcXYZAC])(?![A-Za-z])|(start|Start|START|[sS])(?![A-Za-z])|(\+)|([,~>]|then))/y;
    let m, i = 0, sep = null;
    while (i < s.length) {
      re.lastIndex = i;
      m = re.exec(s);
      if (!m || m[0] === '') return null;
      i = re.lastIndex;
      if (m[9] || m[10]) { sep = m[9] ? '+' : ','; continue; }
      const dir = m[1] ? MOTION[m[1]] : m[2] ? [m[2]] : m[3] ? [ARROWS[m[3]]] : m[4] ? [...m[4]].filter((d) => d !== '5').map((d) => NUMPAD[d]) : null;
      if (dir) { if (btns.length) return null; dirs.push(...dir); sep = null; continue; }
      if (btns.length && sep !== '+') return null;
      sep = null;
      if (m[6]) { const one = NAMED_BTN[m[6].toUpperCase()] || m[6].toUpperCase(); for (let k = 0; k < (m[5] ? +m[5] : 1); k++) btns.push(one); continue; }
      if (m[7]) { btns.push(m[7].toLowerCase()); continue; }
      if (m[8]) { btns.push('s'); continue; }
    }
    if (!btns.length || (!dirs.length && btns.length < 2)) return null;
    const out = { dirs, btns };
    if (alts.length) out.alts = [btns, ...alts.map((b) => btns.slice(0, -1).concat(b))];
    return out;
  }
  // The readme's move lines: [{ name, dirs, btns, file, line }]
  function readmeEntries(io, defName, defText) {
    const out = [];
    const compiled = new Set();
    const fsec = filesSection(defText);
    const resolve = makeResolve(io, defName);
    if (fsec) for (const v of fsec.keys.values()) { const a = v && resolve(v); if (a) compiled.add(norm(a).toLowerCase()); }
    for (const f of readmeFiles(io, defName)) {
      if (compiled.has(norm(f).toLowerCase())) continue;
      let text;
      try { const t = io.read(f); if (t == null || t.length > 256 * 1024) continue; text = decodeText(t); } catch (e) { continue; }
      text.split(/\r?\n/).forEach((line, no) => {
        const l = line.replace(/^[\s\-*•・>#.]+/, '');
        const sep = /^(.{2,60}?)(?:\s*[:：=]\s*|\s+[-–]\s+|\t+\s*|\s{2,})(\S.*)$/.exec(l);
        if (!sep) return;
        const name = sep[1].replace(/\s+/g, ' ').trim();
        if (!descriptive(name) || [...name].length > MAX_NAME) return;
        const inp = readmeInput(sep[2]);
        if (inp) out.push(Object.assign({ name, file: f, line: no + 1 }, inp));
      });
    }
    return out;
  }
  // The text files a readme can be: the folder's top level and the def's folder -> [rel]
  function readmeFiles(io, defName) {
    const dirs = [...new Set(['', defDirOf(defName)])];
    const out = [];
    for (const d of dirs) {
      const names = io.list(d);
      if (!names) continue;
      for (const n of names) if (/\.(txt|md)$/i.test(n) && README_NAME.test(n)) { const p = norm(d + '/' + n); if (io.isFile(p)) out.push(p); }
    }
    return out;
  }
  // Does a readme line's input describe this row's? Same directions in order;
  // the buttons pressed at the end the same, a P/K standing for any punch/kick.
  function readmeFits(entry, conv) {
    const dirs = [], last = conv.steps[conv.steps.length - 1] || [];
    for (const st of conv.steps) for (const q of st) if (q.kind === 'dir') dirs.push(q.key);
    if (dirs.join(',') !== entry.dirs.join(',')) return false;
    if (conv.steps.slice(0, -1).some((st) => st.some((q) => q.kind === 'btn'))) return false;
    const row = last.filter((q) => q.kind === 'btn').map((q) => q.key);
    const fits = (btns) => {
      if (row.length !== btns.length) return false;
      const left = row.slice();
      for (const b of btns.filter((x) => x.length === 1 && /[a-z]/.test(x))) { const k = left.indexOf(b); if (k < 0) return false; left.splice(k, 1); }
      for (const b of btns.filter((x) => x === 'P' || x === 'K')) { const k = left.findIndex((q) => FAMILY[q] === b); if (k < 0) return false; left.splice(k, 1); }
      return !left.length;
    };
    return (entry.alts || [entry.btns]).some(fits);
  }

  // ---- the .def -------------------------------------------------------------------------
  // The first [Files] section (the only one the engine reads): its header line
  // index and key -> raw value (first wins), keys lowercased.
  function filesSection(defText, want) {
    const lines = S.stripBom(String(defText)).split('\n');
    for (let i = 0; i < lines.length; i++) {
      const l = S.trimGo(lines[i]);
      if (!l || l[0] !== '[') continue;
      const sec = l.split(';')[0].trim();
      if (sec[sec.length - 1] !== ']') continue;
      let nm = sec.slice(1, sec.indexOf(']'));
      const sp = nm.indexOf(' ');
      if (sp >= 0) nm = nm.slice(0, sp + 1);
      if (nm.toLowerCase() !== (want || 'files')) continue;
      const keys = new Map();
      for (let j = i + 1; j < lines.length; j++) {
        const t = S.trimGo(lines[j]);
        if (t && t[0] === '[') break;
        const nc = S.trimGo(t.split(';')[0]);
        const ia = nc.search(/[= \t]/);
        if (ia <= 0) continue;
        const key = nc.slice(0, ia).toLowerCase();
        const eq = nc.indexOf('=');
        if (!keys.has(key)) keys.set(key, eq >= 0 ? S.trimGo(nc.slice(eq + 1)) : '');
      }
      return { header: i, keys };
    }
    return null;
  }
  // A path from the .def, found without regard to case: beside the def first,
  // then from the character's folder (LoadFile's order for a character file).
  // Paths are relative to the character's folder (io), '..' may lead out of it.
  function resolveCI(io, base, rel) {
    rel = String(rel || '').replace(/"/g, '').replace(/\\/g, '/').trim();
    if (!rel || /^[a-z]:/i.test(rel) || rel.startsWith('/')) return null;
    const direct = norm(base + '/' + rel);
    if (io.isFile(direct)) return direct;
    const cur = norm(base) ? norm(base).split('/') : [];
    for (const part of rel.split('/')) {
      if (!part || part === '.') continue;
      if (part === '..') { if (cur.length && cur[cur.length - 1] !== '..') cur.pop(); else cur.push('..'); continue; }
      const names = io.list(cur.join('/'));
      if (!names) return null;
      const hit = names.find((n) => n.toLowerCase() === part.toLowerCase());
      if (!hit) return null;
      cur.push(hit);
    }
    return io.isFile(cur.join('/')) ? cur.join('/') : null;
  }
  const defDirOf = (defName) => { const s = String(defName).replace(/\\/g, '/'); const k = s.lastIndexOf('/'); return k < 0 ? '' : norm(s.slice(0, k)); };
  const makeResolve = (io, defName) => (rel) => resolveCI(io, defDirOf(defName), rel) || resolveCI(io, '', rel);

  // The character's own movelist, the way loadMovelists finds one: movelist,
  // movelist0, movelist<N>; a name that resolves to a file with something in it.
  // -> { file, text } | null
  function ownMovelist(io, defName, defText) {
    const fsec = filesSection(defText);
    if (!fsec) return null;
    const resolve = makeResolve(io, defName);
    const keys = [...fsec.keys.keys()].filter((k) => /^movelist\d*$/.test(k))
      .sort((a, b) => (a === 'movelist' ? -1 : b === 'movelist' ? 1 : (parseInt(a.slice(8) || '0', 10) - parseInt(b.slice(8) || '0', 10))));
    for (const k of keys) {
      const raw = fsec.keys.get(k);
      if (!raw) continue;
      const abs = resolve(raw) || resolve(decodeText(raw));
      if (!abs) continue;
      const t = io.read(abs);
      if (!t) continue;
      return { file: abs, text: decodeText(t.slice(0, 20000)).replace(/^﻿/, '') };
    }
    return null;
  }

  // ---- the .cmd's [Command] table (gallerydata.readCommands' engine rules) --------------
  // Every section whose name starts with "command" is one command; its first
  // `name` and `command` win; several sections may share a name. -> Map(lowercased
  // name -> { name, defs: [notation], time })
  function readCommands(text) {
    const out = new Map();
    const lines = String(text || '').split('\n').map(S.trimGo);
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (!l || l[0] !== '[') continue;
      const sec = S.trimGo(l.split(';')[0]);
      if (!sec || sec[sec.length - 1] !== ']') continue;
      let nm = sec.slice(1, sec.indexOf(']'));
      const sp = nm.indexOf(' ');
      if (sp >= 0) nm = nm.slice(0, sp + 1);
      if (!nm.toLowerCase().startsWith('command')) continue;
      const kv = new Map();
      for (i++; i < lines.length; i++) {
        if (lines[i] && lines[i][0] === '[') { i--; break; }
        const line = S.trimGo(lines[i].split(';')[0]);
        const ia = line.search(/[= \t]/);
        if (ia <= 0) continue;
        const key = line.slice(0, ia).toLowerCase();
        const eq = line.indexOf('=');
        if (!kv.has(key)) kv.set(key, eq >= 0 ? S.trimGo(line.slice(eq + 1)) : '');
      }
      const raw = kv.get('name');
      if (!raw || raw.length < 2 || raw[0] !== '"' || raw[raw.length - 1] !== '"') continue;
      const name = raw.slice(1, -1);
      const k = name.toLowerCase();
      if (!out.has(k)) out.set(k, { name, defs: [], time: kv.has('time') ? parseInt(kv.get('time'), 10) : null });
      out.get(k).defs.push(kv.get('command') || '');
    }
    return out;
  }
  const AI_COMMAND = /^(?:cpu|ai|com)[\s_-]*\d*$/i;

  // ---- the trigger lines -> the commands a block asks for ------------------------------
  // One trigger expression: its first `||` alternative, every `command = "x"` in
  // it that is not negated. Latin1 text (the names are compared byte for byte,
  // as the engine does).
  function commandsOfLine(expr) {
    for (const alt of String(expr).split('||')) {
      const out = [];
      const re = /(!?)\s*command\s*=\s*"([^"]*)"/gi;
      let m;
      while ((m = re.exec(alt))) {
        const before = alt.slice(0, m.index).trimEnd();
        if (m[1] || /!$/.test(before)) continue;
        out.push(m[2]);
      }
      if (out.length) return out;
    }
    return [];
  }
  // The commands a trigger group asks for (its lines are ANDed): each line read
  // as an expression (cnsexpr) - `&&` both sides, `||` the left side when it
  // asks for any, else the right, `!=` and `!` nothing, `command = "x"` x.
  // A line the parser cannot read falls back to commandsOfLine.
  function commandsOfExpr(n) {
    if (!n) return [];
    if (n.t === 'and') return [...commandsOfExpr(n.a), ...commandsOfExpr(n.b)];
    if (n.t === 'or') { const l = commandsOfExpr(n.a); return l.length ? l : commandsOfExpr(n.b); }
    if (n.t === 'cmp' && n.o === '=') {
      const isCmd = (x) => x && x.t === 'unk' && x.id === 'command' && !x.args;
      if (isCmd(n.a) && n.b && n.b.t === 'str') return [n.b.v];
      if (isCmd(n.b) && n.a && n.a.t === 'str') return [n.a.v];
    }
    return [];
  }
  function commandsOfGroup(lines) {
    const out = [];
    for (const line of lines || []) {
      let ast = null;
      try { const t = X.tokenize(String(line).replace(/;.*$/, '').trim()); ast = t && t.length ? X.parse(t) : null; } catch (e) { ast = null; }
      for (const n of (ast ? commandsOfExpr(ast) : commandsOfLine(line))) if (!out.includes(n)) out.push(n);
    }
    return out;
  }
  // A ChangeState value's default path: `Ifelse(command="OniyakiEX" && power >=
  // 500, 1130, 1100)` enters 1100 unless something more is true (the EX, the air
  // version, a held direction), so the else branch, followed to the innermost.
  function defaultBranch(v) {
    let s = String(v || '').trim();
    for (let guard = 0; guard < 8; guard++) {
      const m = /^(?:ifelse|cond)\s*\(([\s\S]*)\)$/i.exec(s);
      if (!m) break;
      const args = [];
      let depth = 0, from = 0, inStr = false;
      const body = m[1];
      for (let i = 0; i < body.length; i++) {
        const ch = body[i];
        if (ch === '"') inStr = !inStr;
        if (inStr) continue;
        if (ch === '(') depth++;
        else if (ch === ')') { depth--; if (depth < 0) return s; }
        else if (ch === ',' && depth === 0) { args.push(body.slice(from, i)); from = i + 1; }
      }
      args.push(body.slice(from));
      if (args.length !== 3 || depth !== 0) break;
      s = args[2].trim();
    }
    return s;
  }
  const aiOn = (expr) => /\bailevel\b/i.test(expr) && !/!\s*ailevel\b|\bailevel\s*(?:=|<=)\s*0\b|\bailevel\s*<\s*1\b/i.test(expr);

  // ---- PROXIMITY: one button, a close and a far move ------------------------------------
  const DIST_IDS = { p2bodydist: 'P2BodyDist X', p2dist: 'P2Dist X' };
  const astOf = (text) => { try { const t = X.tokenize(String(text || '').replace(/;.*$/, '').trim()); return t && t.length ? X.parse(t) : null; } catch (e) { return null; } };
  const walkAst = (n, fn) => { if (!n || typeof n !== 'object') return; fn(n); for (const k of ['a', 'b', 'c', 'x', 'y', 'r', 'idx']) if (n[k]) walkAst(n[k], fn); if (Array.isArray(n.args)) for (const g of n.args) walkAst(g, fn); };
  // The distance tests in an expression: [{ by, op, dist }] (`Abs(P2bodydist X) <= 25`, `P2BodyDist X < 30`)
  function distTests(text) {
    const out = [];
    const distOf = (n) => { let id = null; walkAst(n, (x) => { if (x.t === 'unk' && !x.args && DIST_IDS[x.id]) id = x.id; }); return id; };
    walkAst(astOf(text), (n) => {
      if (n.t !== 'cmp' || !['<', '<=', '>', '>='].includes(n.o)) return;
      const l = distOf(n.a), r = distOf(n.b);
      if (l && n.b.t === 'num') out.push({ by: DIST_IDS[l], op: n.o, dist: n.b.v });
      else if (r && n.a.t === 'num') out.push({ by: DIST_IDS[r], op: { '<': '>', '<=': '>=', '>': '<', '>=': '<=' }[n.o], dist: n.a.v });
    });
    return out;
  }
  const DIST_NEAR = 0, DIST_FAR = 100000;
  const distCtx = (d) => ({ unk: (n) => (!n.args && DIST_IDS[n.id] ? d : undefined) });
  // The threshold the page prints, as the CLOSE side's test (`> 30` is close `<= 30`).
  const closeTest = (tests) => {
    const t = tests.find((x) => x.op === '<' || x.op === '<=') || tests[0] || null;
    return t && (t.op === '>' || t.op === '>=') ? Object.assign({}, t, { op: t.op === '>' ? '<=' : '<' }) : t;
  };
  const linesAt = (lines, ctx) => { let r = true; for (const l of lines) { const v = X.evalExpr(l, ctx); const b = v === null ? null : !!v; if (b === false) return false; if (b === null) r = null; } return r; };

  // ---- the files ---------------------------------------------------------------------------
  // The core reads a character through an io: { read(rel) -> latin1 text | null,
  // isFile(rel) -> bool, list(rel) -> [names] | null }, every path relative to
  // the character's folder, '/'-separated ('..' leads out of it, as a stcommon
  // in the engine's data/ does). The Studio's io reads the disk (cmdlist.js);
  // filesIo reads the files a page holds.
  const norm = (p) => {
    const out = [];
    for (const part of String(p).replace(/\\/g, '/').split('/')) {
      if (!part || part === '.') continue;
      if (part === '..' && out.length && out[out.length - 1] !== '..') out.pop();
      else out.push(part);
    }
    return out.join('/');
  };
  // path.posix.dirname / basename, for a def path
  const posixDirname = (p) => { const s = p.length > 1 ? p.replace(/\/+$/, '') : p; const k = s.lastIndexOf('/'); return k < 0 ? '.' : k === 0 ? '/' : s.slice(0, k); };
  const posixBasename = (p) => { const s = p.replace(/\/+$/, ''); return s.slice(s.lastIndexOf('/') + 1); };
  // A folder's names in one order whatever order a drop or an archive gave them
  // (a case-blind sort, then by code unit).
  const byName = (a, b) => { const x = a.toUpperCase(), y = b.toUpperCase(); return x < y ? -1 : x > y ? 1 : a < b ? -1 : a > b ? 1 : 0; };
  // A character's files as a page holds them -> an io. files: [{ path, bytes }]
  // (paths relative to the character's folder) or a Map(path -> bytes). A path
  // is found as written first, then in any letter case (the engine's file
  // lookup is case-blind, and so is the Windows disk the Studio reads).
  function filesIo(files) {
    const exact = new Map(), lower = new Map(), dirs = new Map(), texts = new Map();
    const entries = files instanceof Map ? [...files] : (files || []).map((f) => [f.path, f.bytes]);
    for (const [p0, bytes] of entries) {
      const p = norm(p0);
      if (!p || p.split('/')[0] === '..' || exact.has(p)) continue;
      exact.set(p, bytes);
      if (!lower.has(p.toLowerCase())) lower.set(p.toLowerCase(), p);
      const parts = p.split('/');
      for (let i = 0; i < parts.length; i++) {
        const d = parts.slice(0, i).join('/').toLowerCase();
        if (!dirs.has(d)) dirs.set(d, new Set());
        dirs.get(d).add(parts[i]);
      }
    }
    const find = (rel) => { const p = norm(rel); return exact.has(p) ? p : (lower.get(p.toLowerCase()) || null); };
    return {
      read(rel) { const p = find(rel); if (!p) return null; if (!texts.has(p)) texts.set(p, S.latin1Of(exact.get(p))); return texts.get(p); },
      isFile(rel) { return !!find(rel); },
      list(rel) { const d = dirs.get(norm(rel).toLowerCase()); return d ? [...d].sort(byName) : null; },
    };
  }
  // The def's state files in the engine's order (scenelib-core stateFilesOf),
  // found through the io: [{ key, rel, abs }] (abs: the path the io reads).
  const stateFilesFor = (io, defName) => S.stateFilesOf(io.read(defName), makeResolve(io, defName));

  // studio-lite: the Command List for a character a player adds, from the files
  // the page holds - shipChar with those files as the copy (a name already
  // taken, in any case, is not reused). -> null | shipChar's result
  function shipFiles(files, defPath, opts) {
    const io = filesIo(files);
    return shipChar(io, defPath, Object.assign({ exists: (rel) => io.isFile(rel) }, opts || {}));
  }

  // ---- the rows ---------------------------------------------------------------------------
  // opts: { names: {state: name}, hidden: [state] } (the owner's, from the roster),
  // drawable(name) (the row's flag), cancels + cancelsOf(parsed, commandsFor)
  // -> { own, rows, text, notes, inputs, cancels } | null (no def)
  //   inputs: [{ state, input, glyphs, stance, file, line, listed }] - every state
  //   the -1 reaches by a command (EVERY INPUT), the first block in file order;
  //   listed = the state prints as a line of the file or is folded into one.
  function readChar(io, defName, opts) {
    const o = opts || {};
    const drawable = typeof o.drawable === 'function' ? o.drawable : stockDraws;
    const raw = io.read(defName);
    if (raw == null) return null;
    const defText = S.stripBom(raw);
    const own = ownMovelist(io, defName, defText);
    const resolve = makeResolve(io, defName);
    const files = S.stateFilesOf(raw, resolve).filter((f) => f.abs);
    const fsec = filesSection(defText);
    const cmdAbs = fsec && fsec.keys.get('cmd') ? resolve(fsec.keys.get('cmd')) : null;
    let cmdText = '';
    try { if (cmdAbs) cmdText = io.read(cmdAbs) || ''; } catch (e) { cmdText = ''; }
    const commands = readCommands(cmdText);
    // the engine's common states are not hers: a stcommon that resolves outside her folder is left out
    const inside = (rel) => String(rel).split('/')[0] !== '..';
    const infoSec = filesSection(defText, 'info');
    const ikv = infoSec && infoSec.keys.get('ikemenversion');
    // (a state file over 8 MB is skipped, as the Studio's reader does)
    const parsed = S.parseStates(files.filter((f) => inside(f.abs)), { ikemenVersion: !!ikv && /[1-9]/.test(ikv),
      read: (f) => { const t = io.read(f.abs); return t != null && t.length > 8e6 ? null : t; } });
    const texts = new Map();
    const linesOf = (rel) => {
      if (texts.has(rel)) return texts.get(rel);
      const f = files.find((x) => x.rel === rel);
      let t = [];
      try { const x = io.read(f.abs); t = x == null ? [] : S.stripBom(x).split('\n'); } catch (e) { t = []; }
      texts.set(rel, t);
      return t;
    };
    // A comment above line `no` (1-based), skipping blanks, or on the line itself after `]`.
    const commentAt = (rel, no) => {
      const L = linesOf(rel);
      const own = /\][ \t]*;+(.*)$/.exec((L[no - 1] || '').replace(/\r$/, ''));
      if (own && descriptive(commentText(decodeText(own[1])))) return commentText(decodeText(own[1]));
      for (let j = no - 2, seen = 0; j >= 0 && seen < 3; j--) {
        const t = S.trimGo(L[j] || '');
        if (!t) continue;
        seen++;
        if (t[0] !== ';') return '';
        const c = commentText(decodeText(t));
        if (c && descriptive(c)) return c;
        if (c) return '';
      }
      return '';
    };
    const statedefComment = (no) => {
      const st = parsed.states.get(no);
      if (!st || st.zss) return '';
      const L = linesOf(st.file);
      const head = (L[st.line - 1] || '').replace(/\r$/, '');
      const same = /\][ \t]*;+(.*)$/.exec(head);
      if (same && descriptive(commentText(decodeText(same[1])))) return commentText(decodeText(same[1]));
      return commentAt(st.file, st.line);
    };

    const minus1 = parsed.states.get(-1);
    const blocks = [];
    // the definition printed: the first that is a charge (Guile's Somersault
    // Strike: `~DB, $D, F, UF, a` then `~DB, DF, DB, UF, a`), else the first
    const pickDef = (c) => c.defs.find((d) => { const v = convertCommand(d); return v && v.charge; }) || c.defs[0];
    // the commands a list of trigger lines asks for, all defined and none the AI's -> [command] | null
    const commandsFor = (lines) => {
      const names = commandsOfGroup(lines);
      if (!names.length) return null;
      const cmds = names.map((n) => commands.get(n.toLowerCase())).filter(Boolean);
      if (cmds.length !== names.length) return null;              // a name the .cmd does not define
      if (cmds.some((c) => AI_COMMAND.test(c.name))) return null;
      return cmds;
    };
    const inputs = new Map();
    const ranges = [], proxBlocks = [], plainBlocks = [];
    let proxOrder = 0;
    const addInput = (state, conv, stance, sc) => {
      if (!(state >= 0) || inputs.has(state) || !conv) return;
      const ws = withStance(conv, stance);
      inputs.set(state, { state, input: conv.input, glyphs: ws.glyphs, stance: stance || null, file: sc.file, line: sc.line, listed: false });
    };
    for (const sc of (minus1 && minus1.sctrls) || []) {
      if (sc.type !== 'changestate' || sc.neverTrue) continue;
      const tg = targets(String(sc.params.get('value') || ''));
      if (!tg.primary.length && !tg.extra.length && !tg.computed.length) continue;
      const groups = sc.trig.groups.length ? sc.trig.groups : [];
      let used = null, lines = null;
      for (const g of groups) {
        const all = [...sc.trig.all, ...g];
        if (all.some(aiOn)) continue;
        const cmds = commandsFor(all);
        if (!cmds) continue;
        used = cmds; lines = all;
        break;
      }
      if (!used) continue;
      const conv = combineCommands(used.map(pickDef));
      if (!conv) continue;
      const stance = stanceOf(lines);
      for (const v of [...tg.primary, ...tg.computed]) addInput(v, conv, stance, sc);
      // PROXIMITY: the value read close and far, else the block's own lines
      {
        const valueText = String(sc.params.get('value') || '');
        const vt = distTests(valueText);
        const lt = vt.length ? [] : lines.flatMap(distTests);
        const pkey = withStance(conv, stance).glyphs;
        if (vt.length) {
          const near = X.evalExpr(valueText, distCtx(DIST_NEAR)), far = X.evalExpr(valueText, distCtx(DIST_FAR));
          const t = closeTest(vt);
          if (Number.isInteger(near) && Number.isInteger(far) && near !== far) {
            ranges.push({ state: near, sc, r: { kind: 'close', op: t.op, dist: t.dist, by: t.by } });
            ranges.push({ state: far, sc, r: { kind: 'far', op: t.op, dist: t.dist, by: t.by } });
          }
        } else if (lt.length) {
          const nearOpen = linesAt(lines, distCtx(DIST_NEAR)) !== false, farOpen = linesAt(lines, distCtx(DIST_FAR)) !== false;
          const t = closeTest(lt);
          if (nearOpen !== farOpen) {
            const kind = nearOpen ? 'close' : 'far';
            for (const v of [...tg.primary, ...tg.computed]) ranges.push({ state: v, sc, r: { kind, op: t.op, dist: t.dist, by: t.by } });
            proxBlocks.push({ key: pkey, kind, t, order: proxOrder });
          }
        } else plainBlocks.push({ key: pkey, states: [...tg.primary, ...tg.computed], sc, order: proxOrder });
        proxOrder++;
      }
      for (const x of tg.extra) {
        // the when-true branch: entered by the command its condition asks for, when it asks for one
        const asks = commandsFor([x.cond]);
        addInput(x.state, (asks && combineCommands(asks.map(pickDef))) || conv, stance, sc);
      }
      const rowStates = tg.primary.filter((v) => v >= 200 && v < 5000);
      if (!rowStates.length) continue;
      // header text: `[State -1, Kung Fu Palm]` -> label; `[State Scramble Dash]` -> the whole text
      // (a stray Shift-JIS lead byte or full-width space after the text is not part of it)
      const label = decodeText(sc.label ? sc.label : (/^-?\d+$/.test(sc.tag) ? '' : sc.tag)).replace(/[\uFFFD\u3000]+/g, ' ').trim();
      const ws = withStance(conv, stance);
      for (const v of rowStates) blocks.push({ v, sc, used, conv, stance, glyphs: ws.glyphs, bare: ws.bare, label, comment: commentAt(sc.file, sc.line) });
    }
    // PROXIMITY's twin: the next block on the same input and stance with no
    // distance of its own is the other one (a close block first, the plain far one after it)
    for (const p of proxBlocks) {
      const twin = plainBlocks.find((b) => b.order > p.order && b.key === p.key);
      if (twin) for (const v of twin.states) ranges.push({ state: v, sc: twin.sc, r: { kind: p.kind === 'close' ? 'far' : 'close', op: p.t.op, dist: p.t.dist, by: p.t.by } });
    }
    // a range belongs to the block the state's input came from
    for (const x of ranges) {
      const inp = inputs.get(x.state);
      if (inp && !inp.range && inp.file === x.sc.file && inp.line === x.sc.line) inp.range = Object.assign({}, x.r, { file: x.sc.file, line: x.sc.line });
    }
    // THE CANCELS, only when asked (the Moves page; an export never needs them):
    // the Studio's reader (cmdlist.js cancelsOf) is handed in as opts.cancelsOf
    let cancels;
    if (o.cancels) { try { cancels = typeof o.cancelsOf === 'function' ? o.cancelsOf(parsed, commandsFor) : []; } catch (e) { cancels = []; } }
    // a character with her own list: nothing is generated, but the page still gets every input
    if (own) return { own, rows: [], text: '', notes: [], inputs: [...inputs.values()], cancels };
    // template text: a label (or comment) the character writes for 3+ different states
    const reuse = (pick) => {
      const m = new Map();
      for (const b of blocks) { const k = pick(b).trim().toLowerCase(); if (!k) continue; if (!m.has(k)) m.set(k, new Set()); m.get(k).add(b.v); }
      return (s) => !!s && (m.get(s.trim().toLowerCase()) || new Set()).size >= 3;
    };
    const labelTemplate = reuse((b) => b.label), commentTemplate = reuse((b) => b.comment);
    const info = /^[ \t]*(?:name|displayname)[ \t]*=[ \t]*"?([^"\r\n;]*)/gim;
    let isKfm = /kfm|kung ?fu/i.test(defName);
    for (let m; (m = info.exec(defText));) if (/kung ?fu/i.test(m[1])) isKfm = true;
    const kfmTemplate = (s) => !isKfm && /\bkung ?fu\b/i.test(s);

    const byState = new Map();
    for (const b of blocks) {
      if (!byState.has(b.v)) byState.set(b.v, []);
      byState.get(b.v).push(b);
    }
    const ownerNames = (o.names && typeof o.names === 'object') ? o.names : {};
    const hidden = new Set((Array.isArray(o.hidden) ? o.hidden : []).map(Number));
    const okLabel = (s) => descriptive(s) && !labelTemplate(s) && !kfmTemplate(s);
    const okComment = (s) => descriptive(s) && !commentTemplate(s) && !kfmTemplate(s);
    const cmdNameOf = (bs) => bs.flatMap((b) => b.used.map((c) => decodeText(c.name))).find((s) => descriptive(s) && !/^hold/i.test(s)) || '';
    // a command name several moves share (one command, a move per situation) names none of them
    const cmdStates = new Map();
    for (const [v, bs] of byState) { const n = cmdNameOf(bs).toLowerCase(); if (n) cmdStates.set(n, (cmdStates.get(n) || 0) + 1); }
    const noEx = (s) => String(s).replace(/ex/gi, '').trim();
    // the readme's move lines, read only when some row has no name the stock menu prints
    let readme = null;
    const readmeName = (conv) => {
      if (!readme) { try { readme = readmeEntries(io, defName, defText); } catch (e) { readme = []; } }
      const names = new Map();
      for (const e of readme) if (readmeFits(e, conv)) names.set(e.name.toLowerCase(), e.name);
      return names.size === 1 ? [...names.values()][0] : '';   // two different names for one input: not unambiguous
    };
    const rows = [];
    for (const [v, bs] of byState) {
      const first = bs[0];
      // by the state number alone: KOF-style EX specials at 2000+ cost a stock
      // like a super, so the power a trigger asks for cannot tell them apart
      const group = v >= 3000 ? 'super' : v >= 1000 ? 'special' : 'other';
      if (group === 'other' && !uniqueAttack(first.conv, first.stance)) continue;
      const lab = bs.map((b) => b.label).find(okLabel) || '';
      const cmdName = cmdNameOf(bs);
      const sd = statedefComment(v);
      // the blocks' own comments, shortest first (a cancel version's comment is
      // the move's name plus more); the target statedef's only when they have none
      const own = [...new Set(bs.map((b) => b.comment))].filter(okComment).sort((a, b) => [...a].length - [...b].length);
      const comments = own.length ? own : (okComment(sd) ? [sd] : []);
      // the shortest comment that spells the command name out (ブレス -> ダイヤモンドブレス, EX aside)
      const fuller = cmdName && [...noEx(cmdName)].length >= 2 ? comments.find((c) => noEx(c).includes(noEx(cmdName))) : '';
      const raw = { label: first.label || null, command: first.used.map((c) => decodeText(c.name)).join(' + '), comment: first.comment || sd || null };
      let name, nameFrom, weak = false;
      const typed = ownerNames[String(v)];
      // The candidates in order; the first the stock fonts can draw wins (the
      // web build's pause menu font is ASCII pixels and the desktop's Open Sans
      // has no kana: a Japanese name prints as nothing - seen in the engine,
      // 2026-10-18), else the first. The same choice as before DotGothic16
      // (jpfont.js): the font only makes the names that are left drawable, so a
      // build whose names were all ASCII ships exactly as before. Keeping a
      // Japanese label over an ASCII command name is the owner's call, not made.
      const cands = [];
      if (lab) cands.push([lab, 'label']);
      if (cmdName && fuller) cands.push([fuller, 'comment']);
      if (cmdName && !((cmdStates.get(cmdName.toLowerCase()) || 0) > 1 && comments.length)) cands.push([cmdName, 'command']);
      for (const c of comments) cands.push([c, 'comment']);
      if (cmdName) cands.push([cmdName, 'command']);
      // the readme, last: only when nothing in the code names the move in a way the stock menu prints
      if (!cands.some(([s]) => stockDraws(s))) { const rn = readmeName(first.conv); if (rn) { cands.push([rn, 'readme']); raw.readme = rn; } }
      const pick = cands.find(([s]) => stockDraws(s)) || cands[0];
      // gen: the name the files give (the strengths merge on it); the owner's name prints over it
      const gen = pick ? { name: pick[0], nameFrom: pick[1], weak: false }
        : { name: first.label || raw.command || ('State ' + v), nameFrom: first.label ? 'label' : 'command', weak: true };
      if (typeof typed === 'string' && cleanName(typed)) { name = typed.trim(); nameFrom = 'owner'; }
      else { name = gen.name; nameFrom = gen.nameFrom; weak = gen.weak; }
      rows.push({ state: v, group, name, nameFrom, raw, input: first.conv.input, glyphs: first.glyphs, bare: first.bare, hidden: hidden.has(v), weak, drawable: drawable(cleanName(name)), file: first.sc.file, line: first.sc.line, gen });
    }
    const order = { special: 0, super: 1, other: 2 };
    rows.sort((a, b) => order[a.group] - order[b.group] || a.state - b.state);
    // One line per thing to press: a later state of the same group with the
    // same input whose name repeats an earlier one's (ワンインチ(キャンセル版) after
    // ワンインチ, a cancel version of the same move) is left out. The input is
    // compared without its stance (Hadouken in the air is Hadouken).
    const kept = [], listed = new Set();
    for (const r of rows) {
      const twin = kept.find((k) => k.group === r.group && k.bare === r.bare && r.nameFrom !== 'owner' && String(r.name).includes(String(k.name)));
      if (!twin) kept.push(r); else listed.add(r.state);
    }
    // One line per move: its Light/Medium/Strong versions merged (THE STRENGTHS).
    const lines = mergeStrengths(kept, ownerNames, hidden, drawable);
    for (const r of lines) {
      delete r.gen; delete r.bare;
      listed.add(r.state);
      for (const m of r.merged || []) listed.add(m.state);
    }
    for (const x of inputs.values()) x.listed = listed.has(x.state);
    return { own: null, rows: lines, text: textOf(lines), notes: [], inputs: [...inputs.values()], cancels };
  }

  // The file the export writes: groups in order, the hidden rows left out.
  function textOf(rows) {
    const out = [];
    for (const g of GROUPS) {
      const list = rows.filter((r) => r.group === g.id && !r.hidden);
      if (!list.length) continue;
      if (out.length) out.push('');
      out.push(HEAD_COLOR + ':' + g.title + ':</>');
      for (const r of list) out.push((cleanName(r.name) || ('State ' + r.state)) + '\t\t' + r.glyphs);
    }
    return out.length ? out.join('\r\n') + '\r\n' : '';
  }

  // The owner's choices for one roster entry (commandList), cleaned:
  // { off?: true, names?: {state: name}, hidden?: [state] } | undefined
  function cleanChoices(c) {
    if (!c || typeof c !== 'object') return undefined;
    const out = {};
    if (c.off === true) out.off = true;
    const names = {};
    for (const [k, v] of Object.entries(c.names && typeof c.names === 'object' ? c.names : {})) {
      if (!/^\d+$/.test(k) || typeof v !== 'string') continue;
      const t = v.replace(/[\r\n\t]+/g, ' ').trim().slice(0, 60);
      if (t) names[k] = t;
    }
    if (Object.keys(names).length) out.names = names;
    const hidden = [...new Set((Array.isArray(c.hidden) ? c.hidden : []).map(Number).filter((n) => Number.isInteger(n) && n >= 0))].sort((a, b) => a - b);
    if (hidden.length) out.hidden = hidden;
    return Object.keys(out).length ? out : undefined;
  }
  // A POST's rows [{ state, name?, hidden? }] over the choices already saved.
  // name: a string sets it, '' or null puts the generated one back; hidden: boolean.
  function applyRows(prev, rows, enabled) {
    const c = cleanChoices(prev) || {};
    const names = Object.assign({}, c.names || {});
    const hidden = new Set(c.hidden || []);
    for (const r of Array.isArray(rows) ? rows : []) {
      if (!r || !Number.isInteger(Number(r.state))) continue;
      const k = String(Number(r.state));
      if (r.name !== undefined) { if (typeof r.name === 'string' && r.name.trim()) names[k] = r.name; else delete names[k]; }
      if (r.hidden !== undefined) { if (r.hidden) hidden.add(Number(k)); else hidden.delete(Number(k)); }
    }
    const next = { names, hidden: [...hidden] };
    if (enabled === false || (enabled === undefined && c.off)) next.off = true;
    return cleanChoices(next);
  }

  // The roster entry a def of a folder belongs to (several entries can share a
  // folder, one per .def): the one whose select names this def, else `fallback`.
  function entryFor(roster, folder, defName, fallback) {
    const want = String(defName || '').replace(/\\/g, '/').toLowerCase();
    const hit = ((roster && roster.chars) || []).find((c) => !c.kind && c.folder === folder && c.select &&
      String(c.select).split('/').slice(1).join('/').toLowerCase() === want);
    return hit || fallback || null;
  }

  // ---- the export -------------------------------------------------------------------------
  // For one def of a character's COPY: the def text with `movelist = <file>` as
  // the first line of its first [Files], and the file. The character's files
  // are only read (io).
  // opts: { defText (the def as the earlier repairs left it), exists(rel) (is a
  // file of that name already in the copy, any case), choices (commandList),
  // drawable, read(names, hidden) (the reader, when the caller keeps it cached) }
  // -> null (switched off, own list, nothing to list) | { def: { rel, text }, file: { rel, text }, rows, names }
  //    (file.text is written as UTF-8 with no BOM)
  function shipChar(io, defName, opts) {
    const o = opts || {};
    const ch = cleanChoices(o.choices) || {};
    if (ch.off) return null;
    let defText = o.defText;
    if (defText == null) { defText = io.read(defName); if (defText == null) return null; }
    if (ownMovelist(io, defName, S.stripBom(defText))) return null;
    const r = typeof o.read === 'function' ? o.read(ch.names, ch.hidden) : readChar(io, defName, { names: ch.names, hidden: ch.hidden, drawable: o.drawable });
    if (!r || r.own || !r.text) return null;
    const fsec = filesSection(defText);
    if (!fsec) return null;
    const defDir = posixDirname(String(defName).replace(/\\/g, '/'));
    const relOf = (n) => (defDir === '.' ? n : defDir + '/' + n);
    const exists = o.exists || ((rel) => !!resolveCI(io, '', rel));
    const base = posixBasename(String(defName).replace(/\\/g, '/')).replace(/\.def$/i, '');
    let name = FILE_NAME;
    for (let k = 0; exists(relOf(name)); k++) name = base + '-movelist' + (k ? '-' + (k + 1) : '') + '.dat';
    // the def's own line ending, the line right under the [Files] header
    const hadBom = defText.charCodeAt(0) === 0xef && defText.charCodeAt(1) === 0xbb && defText.charCodeAt(2) === 0xbf;
    const body = hadBom ? defText.slice(3) : defText;
    const eol = /\r\n/.test(body) ? '\r\n' : '\n';
    const lines = body.split('\n');
    const cr = lines[fsec.header].endsWith('\r') || (eol === '\r\n' && fsec.header === lines.length - 1) ? '\r' : '';
    lines.splice(fsec.header + 1, 0, 'movelist = ' + name + ' ;Command List written by the export' + cr);
    const text = (hadBom ? defText.slice(0, 3) : '') + lines.join('\n');
    // names: what the file prints, so the export can tell whether the list needs its font (jpfont.needed)
    const shown = r.rows.filter((x) => !x.hidden);
    return { def: { rel: String(defName).replace(/\\/g, '/'), text }, file: { rel: relOf(name), text: r.text }, rows: shown.length, names: shown.map((x) => cleanName(x.name) || ('State ' + x.state)) };
  }

  return { readChar, shipChar, shipFiles, filesIo, stateFilesFor, readmeFiles, stockDraws, textOf, ownMovelist, convertCommand, combineCommands, isCommandMove, readCommands,
    commandsOfLine, descriptive, decodeText, cleanName, cleanChoices, applyRows, entryFor, filesSection, strengthBase, mergeStrengths, readmeInput, readmeEntries,
    readmeFits, chargeStart, commandsOfGroup, stanceOf, withStance, targets, uniqueAttack, aiOn, FILE_NAME };
});
