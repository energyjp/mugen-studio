// A MUGEN AI SWITCH THAT NEVER TURNS OFF, released in the copy a build ships.
//
// Before MUGEN had an AILevel trigger, characters found out they were CPU
// controlled with impossible commands: long scrambled sequences with
// `time = 0` (or 1) that no player can enter, so only the CPU - which "presses"
// commands on purpose - completes them. One of them registering sets a
// variable to 1, and the character's own AI code runs off that variable from
// then on. Arina (cmd: "CPU0".."CPU19", `[State -1]` VarSet v = 58, Value = 1)
// is the case that showed it.
//
// Nothing ever sets the variable back. In MUGEN that did not matter: a fighter
// was CPU or player for the whole match. In Ikemen GO one frame of CPU control
// is enough - the engine skips a command's time limit for the CPU and presses
// commands for it (input.go Command.Step, `if ai { return }`; char.go
// cpucmd) - and a tag partner can be flagged CPU for a moment, after which the
// player's partner played herself for the rest of the match.
//
// So the copy a build ships gets one controller right after the latch: the
// variable goes back to 0 whenever the character is not CPU controlled
// (`AILevel = 0`). As a CPU opponent nothing changes - the latch still sets it
// and AILevel is above 0 - and the character's own files are untouched.
// hitprio.repairFor runs this on the same state files it already rewrites, so
// the two fixes land in one shipped text per file.
'use strict';

const keyOf = (l) => { const s = String(l).split(';')[0]; const eq = s.indexOf('='); return eq < 0 ? '' : s.slice(0, eq).trim().toLowerCase(); };
const valOf = (l) => { const s = String(l).split(';')[0]; const eq = s.indexOf('='); return eq < 0 ? '' : s.slice(eq + 1).trim(); };
const headOf = (l) => String(l).split(';')[0].trim();

// The names of a .cmd's commands no player can enter: three steps or more,
// all inside a time of 0 or 1 tick.
function impossibleCommands(cmdText) {
  const out = new Set();
  let cur = null;
  const done = () => {
    if (cur && cur.name && cur.command && cur.time !== null && cur.time <= 1
      && cur.command.split(',').filter((s) => s.trim()).length >= 3) out.add(cur.name.toLowerCase());
    cur = null;
  };
  for (const l of String(cmdText).split(/\r?\n/)) {
    const h = headOf(l);
    if (h[0] === '[') { done(); if (/^\[\s*command\s*\]$/i.test(h)) cur = { name: '', command: '', time: null }; continue; }
    if (!cur) continue;
    const k = keyOf(l);
    if (k === 'name') cur.name = valOf(l).replace(/^"|"$/g, '').trim();
    else if (k === 'command') cur.command = valOf(l);
    else if (k === 'time') { const n = parseInt(valOf(l), 10); cur.time = Number.isFinite(n) ? n : null; }
  }
  done();
  return out;
}

// The variable a controller block latches, or -1: a VarSet whose every
// numbered trigger asks only for impossible commands and which sets a var to a
// non-zero constant.
function latchVar(block, impossible) {
  let type = '', v = -1, value = null, varAssign = null;
  const trig = [];
  for (let i = 1; i < block.length; i++) {
    const k = keyOf(block[i]);
    if (!k) continue;
    if (k === 'type') type = valOf(block[i]).toLowerCase();
    else if (k === 'v') v = parseInt(valOf(block[i]), 10);
    else if (k === 'value') value = valOf(block[i]);
    else if (/^var\(\s*\d+\s*\)$/.test(k)) varAssign = { n: parseInt(k.replace(/\D/g, ''), 10), value: valOf(block[i]) };
    else if (/^trigger\d+$/.test(k)) trig.push(valOf(block[i]));
  }
  if (type !== 'varset' || !trig.length) return -1;
  const allImpossible = trig.every((t) => {
    const names = [...t.matchAll(/command\s*=\s*"([^"]*)"/gi)].map((m) => m[1].toLowerCase());
    // only command checks on the line, every one of them impossible
    const rest = t.replace(/command\s*=\s*"[^"]*"/gi, '').replace(/[\s()&|]/g, '');
    return names.length > 0 && !rest && names.every((n) => impossible.has(n));
  });
  if (!allImpossible) return -1;
  const nonZero = (x) => x !== null && /^\s*-?\d+(\.\d+)?\s*$/.test(x) && Number(x) !== 0;
  if (varAssign && nonZero(varAssign.value)) return varAssign.n;
  if (Number.isInteger(v) && v >= 0 && nonZero(value)) return v;
  return -1;
}

// The variable a "helper detector" latch sets, or -1. Faust (fau, faust.cmd)
// checks for a player with a keyctrl helper (10000+ID, state 10000) that
// compares its own commands with the root's: when only the root sees a press,
// the helper sets its var(59) to 1, and the latch has one more trigger group,
// `NumHelper(10000+ID)` + `Helper(10000+ID),var(59)>0`, that copies it. In
// Ikemen GO a keyctrl helper sees no input on its first frames (its command
// list is built later, in Char.tick), so a button held while the fight loads
// or right after a training Round Reset reads as CPU control and his AI drives
// the player's Faust. Such a latch is a VarSet to a non-zero constant whose
// numbered trigger groups are either impossible commands only (at least one)
// or only NumHelper(...), Helper(...),var(L) (bare, > 0 or != 0) and
// var(L) = 0 on the same var L (at least one Helper line). R. Mika (cvsmika_h,
// AI_mika3_2/-3.cns) has the bare form: `var(59)=0` + `Helper(10001),var(59)`,
// with the same keyctrl helper (state 10001). Its release keeps the detector's
// negative "player seen".
function detectorLatchVar(block, impossible) {
  let type = '', v = -1, value = null, varAssign = null;
  const groups = new Map();
  for (let i = 1; i < block.length; i++) {
    const k = keyOf(block[i]);
    if (!k) continue;
    if (k === 'type') type = valOf(block[i]).toLowerCase();
    else if (k === 'v') v = parseInt(valOf(block[i]), 10);
    else if (k === 'value') value = valOf(block[i]);
    else if (/^var\(\s*\d+\s*\)$/.test(k)) varAssign = { n: parseInt(k.replace(/\D/g, ''), 10), value: valOf(block[i]) };
    else if (/^trigger\d+$/.test(k)) {
      const g = parseInt(k.slice(7), 10);
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(valOf(block[i]));
    }
  }
  if (type !== 'varset' || !groups.size) return -1;
  const nonZero = (x) => x !== null && /^\s*-?\d+(\.\d+)?\s*$/.test(x) && Number(x) !== 0;
  let n = -1;
  if (varAssign && nonZero(varAssign.value)) n = varAssign.n;
  else if (Number.isInteger(v) && v >= 0 && nonZero(value)) n = v;
  if (n < 0) return -1;
  const impossibleOnly = (t) => {
    const names = [...t.matchAll(/command\s*=\s*"([^"]*)"/gi)].map((m) => m[1].toLowerCase());
    const rest = t.replace(/command\s*=\s*"[^"]*"/gi, '').replace(/[\s()&|]/g, '');
    return names.length > 0 && !rest && names.every((x) => impossible.has(x));
  };
  const helperRe = new RegExp('^(numhelper\\s*\\([^()]*\\)|helper\\s*\\([^()]*\\)\\s*,\\s*var\\(\\s*' + n + '\\s*\\)(\\s*(>|!=)\\s*0)?|var\\(\\s*' + n + '\\s*\\)\\s*=\\s*0)$', 'i');
  let imp = 0, det = 0;
  for (const lines of groups.values()) {
    if (lines.every(impossibleOnly)) imp++;
    else if (lines.every((t) => helperRe.test(t.trim())) && lines.some((t) => /^helper/i.test(t.trim()))) det++;
    else return -1;
  }
  return imp && det ? n : -1;
}

// Does some controller already set var(n) on an AILevel test? Then the author
// handled it, and nothing is added.
function handled(text, n) {
  const re = new RegExp('var\\(\\s*' + n + '\\s*\\)|^\\s*v\\s*=\\s*' + n + '\\b', 'im');
  let block = [];
  const check = () => block.length && block.some((l) => /ailevel/i.test(l.split(';')[0])) && block.some((l) => re.test(l.split(';')[0]));
  for (const l of String(text).split(/\r?\n/)) {
    if (headOf(l)[0] === '[') { if (check()) return true; block = [l]; continue; }
    block.push(l);
  }
  return !!check();
}

// The vars a character only ever sets FROM the latch: every controller that
// writes var(D) (VarSet, VarAdd, VarRandom) is gated on var(L) - a triggerall
// that tests it, or every numbered trigger testing it. Arina's a-2.cns turns
// var(58) = 1 into var(59) = 2, her AI mode, and all 36 of her moves need
// var(59) < 2: releasing var(58) alone left her a player who could walk and
// jump and nothing else. Such a var only ever holds its starting 0 in a
// player's hands, so it is put back to 0 with the latch.
function blocksOf(text) {
  const out = [];
  let block = null;
  for (const l of String(text).split(/\r?\n/)) {
    const h = headOf(l);
    if (h[0] === '[') { if (block) out.push(block); block = /^\[\s*state\s/i.test(h) && !/^\[\s*statedef/i.test(h) ? [l] : null; continue; }
    if (block) block.push(l);
  }
  if (block) out.push(block);
  return out;
}
function writtenVar(block) {
  let type = '', v = -1, assigned = -1;
  for (let i = 1; i < block.length; i++) {
    const k = keyOf(block[i]);
    if (k === 'type') type = valOf(block[i]).toLowerCase();
    else if (k === 'v') v = parseInt(valOf(block[i]), 10);
    else if (/^var\(\s*\d+\s*\)$/.test(k)) assigned = parseInt(k.replace(/\D/g, ''), 10);
  }
  if (!/^var(set|add|random)$/.test(type)) return -1;
  return assigned >= 0 ? assigned : (Number.isInteger(v) && v >= 0 ? v : -1);
}
function derivedVars(texts, L) {
  const re = new RegExp('\\bvar\\(\\s*' + L + '\\s*\\)', 'i');
  const writes = new Map();   // var -> [gated?]
  for (const text of texts) {
    for (const b of blocksOf(text)) {
      const d = writtenVar(b);
      if (d < 0 || d === L) continue;
      const all = [], num = [];
      for (let i = 1; i < b.length; i++) {
        const k = keyOf(b[i]);
        if (k === 'triggerall') all.push(valOf(b[i]));
        else if (/^trigger\d+$/.test(k)) num.push(valOf(b[i]));
      }
      const gated = all.some((x) => re.test(x)) || (num.length > 0 && num.every((x) => re.test(x)));
      if (!writes.has(d)) writes.set(d, []);
      writes.get(d).push(gated);
    }
  }
  return [...writes].filter(([, g]) => g.every(Boolean)).map(([d]) => d).sort((a, b) => a - b);
}

// One state file's text with every latch released under player control.
// Returns { text, count, vars } (count 0: unchanged). `others` = the texts of
// the character's other state files, for the "already handled" check.
function patchText(text, impossible, others) {
  if (!impossible || !impossible.size) return { text, count: 0, vars: [] };
  const nl = /\r\n/.test(text) ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const out = [];
  const vars = [];
  const derived = [];
  let block = null;
  const flush = () => {
    if (!block) return;
    let n = latchVar(block, impossible);
    const detector = n < 0 && (n = detectorLatchVar(block, impossible)) >= 0;
    if (n >= 0 && !vars.includes(n) && ![text, ...(others || [])].some((t) => handled(t, n))) {
      const num = (/^\[\s*state\s+(-?\d+)/i.exec(headOf(block[0])) || [, '-1'])[1];
      // Right after the latch's own last line, ahead of the comments and
      // blank lines that trail it (they read as the next block's heading).
      let last = block.length - 1;
      while (last > 0 && !headOf(block[last])) last--;
      for (let i = 0; i <= last; i++) out.push(block[i]);
      // A detector latch's release leaves its negative "player seen" alone,
      // so the detector helper is not spawned again, and adds no derived-var
      // releases.
      out.push('', '[State ' + num + ', Mugen Studio: AI switch off while a player controls this character]',
        'type = VarSet', 'trigger1 = AILevel = 0', ...(detector ? ['trigger1 = var(' + n + ') > 0'] : []), 'var(' + n + ') = 0');
      for (const d of detector ? [] : derivedVars([text, ...(others || [])], n)) {
        out.push('', '[State ' + num + ', Mugen Studio: AI mode off while a player controls this character]',
          'type = VarSet', 'trigger1 = AILevel = 0', 'var(' + d + ') = 0');
        derived.push(d);
      }
      for (let i = last + 1; i < block.length; i++) out.push(block[i]);
      vars.push(n);
    } else {
      for (const l of block) out.push(l);
    }
    block = null;
  };
  for (const l of lines) {
    const h = headOf(l);
    if (h[0] === '[') {
      flush();
      if (/^\[\s*state\s/i.test(h) && !/^\[\s*statedef/i.test(h)) { block = [l]; continue; }
      out.push(l);
      continue;
    }
    if (block) block.push(l); else out.push(l);
  }
  flush();
  return { text: vars.length ? out.join(nl) : text, count: vars.length, vars, derived };
}

module.exports = { impossibleCommands, latchVar, detectorLatchVar, derivedVars, patchText };
