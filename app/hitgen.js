'use strict';
// A HIT BOX THAT HITS. A Clsn1 box does nothing by itself: the engine tests
// it only while the character has a live HitDef (or ReversalDef) and its
// movetype is not I (char.go:10854, atktmp at 12552). A box added to a pose
// whose state has neither - the jump, the stand, a win pose, most of them the
// engine's own common states the character cannot edit - is decoration.
//
// The animation editor fixes that by writing a small group of controllers
// into the character's [Statedef -3]. A -3 runs every tick before the state's
// own code, and only while the character is in its own states (char.go:12084),
// so a thrown character never arms it in someone else's custom state:
//
//   StateTypeSet movetype = A   while an element with the boxes is on screen
//   StateTypeSet movetype = I   in that state the rest of the time
//   HitDef                      armed at the start of each of those elements
//
// All three are guarded by `StateNo = S && Anim = A`, so they touch nothing
// else. The element test is `AnimElemTime(e) >= 0 && AnimElemTime(e + 1) < 0`
// (just `AnimElemTime(e) >= 0` on the last element): literal element numbers
// with the action named beside them, which an insert, delete or move in the
// editor renumbers like any other trigger (modlib airOutsiderStates). The
// movetype goes back to I off those elements because movetype A is not free:
// the opponent's guard reacts to it (InGuardDist), and a looping pose would
// otherwise stay "attacking" for as long as it plays.
//
// The group is found again by its labels: "[State -3, hit box of action A in
// state S: attacking | idle | hit]". Update rewrites the two StateTypeSets and
// only the trigger lines of the HitDef, so a damage edited in the Moves window
// stays; Remove deletes the group and the comment line above it.

const LABEL_RE = (action, state) => new RegExp('^\\s*\\[\\s*state\\s+-3\\s*,\\s*hit box of action ' + action + ' in state ' + state + '\\s*:\\s*(attacking|idle|hit)\\s*\\]', 'i');
const COMMENT = (action, state) => `; Hit box of action ${action} in state ${state}, added by the animation editor`;

const eolOf = (text) => (/\r\n/.test(text) ? '\r\n' : '\n');

// Lines with their offsets; `bare` has the ; comment cut and Go-style space
// trimmed (a full-width space before a bracket still starts it).
function linesOf(text) {
  const out = [];
  let at = 0;
  while (at <= text.length) {
    const nl = text.indexOf('\n', at);
    const end = nl < 0 ? text.length : nl + 1;
    const raw = text.slice(at, end);
    if (!raw && at === text.length) break;
    const body = raw.replace(/\r?\n$/, '');
    const cut = body.indexOf(';') >= 0 ? body.slice(0, body.indexOf(';')) : body;
    out.push({ start: at, end, raw, body, bare: cut.replace(/^[\s　 ]+|[\s　 ]+$/g, '') });
    if (nl < 0) break;
    at = end;
  }
  return out;
}

const onElem = (e, count) => (e < count ? `AnimElemTime(${e}) >= 0 && AnimElemTime(${e + 1}) < 0` : `AnimElemTime(${e}) >= 0`);
const offElem = (e, count) => (e < count ? `(AnimElemTime(${e}) < 0 || AnimElemTime(${e + 1}) >= 0)` : `AnimElemTime(${e}) < 0`);

const fmt = (n) => {
  const r = Math.round(n * 100) / 100;
  return Object.is(r, -0) ? '0' : String(r);
};

// The controllers' text.
//   state, action   the pose: StateNo and Anim
//   elems           element numbers that carry Clsn1 boxes, ascending
//   count           elements in the action
//   stateType       's' | 'c' | 'a' (anything else is written as S)
//   idle            the state's own movetype is I, so the StateTypeSets are
//                   needed; false when it is already A
//   scale           the character's localcoord width / 320
//   sparkY          where the spark shows, in the character's units
function triggerLines(state, action, elems) {
  return elems.map((e, k) => `trigger${k + 1} = StateNo = ${state} && Anim = ${action} && AnimElem = ${e}`);
}
function stateTypeSetText(o, eol) {
  const g = `StateNo = ${o.state} && Anim = ${o.action}`;
  const on = o.elems.map((e, k) => `trigger${k + 1} = ${g} && ${onElem(e, o.count)}`);
  const off = [`trigger1 = StateNo = ${o.state} && Anim != ${o.action}`, `trigger2 = ${g} && ${o.elems.map((e) => offElem(e, o.count)).join(' && ')}`];
  return [
    `[State -3, hit box of action ${o.action} in state ${o.state}: attacking]`,
    'type = StateTypeSet', ...on, 'movetype = A', '',
    `[State -3, hit box of action ${o.action} in state ${o.state}: idle]`,
    'type = StateTypeSet', ...off, 'movetype = I', '',
  ].join(eol);
}
function groupText(o, eol) {
  const T = ({ s: 'S', c: 'C', a: 'A' })[String(o.stateType || '').toLowerCase()] || 'S';
  const k = o.scale > 0 ? o.scale : 1;
  const lines = [COMMENT(o.action, o.state), ''];
  const head = lines.join(eol);
  const hit = [
    `[State -3, hit box of action ${o.action} in state ${o.state}: hit]`,
    'type = HitDef',
    ...triggerLines(o.state, o.action, o.elems),
    `attr = ${T}, NA`,
    'damage = 20',
    'animtype = Light',
    'hitflag = MAF',
    `guardflag = ${T === 'A' ? 'HA' : T === 'C' ? 'L' : 'MA'}`,
    'pausetime = 8, 8',
    `sparkxy = ${fmt(-10 * k)}, ${fmt(Number.isFinite(o.sparkY) ? o.sparkY : -60 * k)}`,
    'hitsound = 5, 0',
    'guardsound = 6, 0',
    `ground.type = ${T === 'C' ? 'Low' : 'High'}`,
    'ground.slidetime = 6',
    'ground.hittime = 10',
    `ground.velocity = ${fmt(-4 * k)}`,
    `air.velocity = ${fmt(-2.5 * k)}, ${fmt(-3 * k)}`,
    '',
  ].join(eol);
  return head + (o.idle ? stateTypeSetText(o, eol) : '') + hit;
}

// The group already in a text: its controllers (by label) with their line
// spans, the comment line above the first one, and the element numbers the
// HitDef arms on. null when there is none.
function findGroup(text, action, state) {
  const L = linesOf(text);
  const re = LABEL_RE(action, state);
  const parts = [];
  for (let i = 0; i < L.length; i++) {
    const m = re.exec(L[i].body);
    if (!m) continue;
    let j = i + 1;
    while (j < L.length && !L[j].bare.startsWith('[')) j++;
    // The body ends at the last non-blank line before the next bracket; the
    // blank line after it goes with it.
    let last = j - 1;
    while (last > i && !L[last].bare && !L[last].body.trim().startsWith(';')) last--;
    let endLine = last;
    if (endLine + 1 < j && !L[endLine + 1].body.trim()) endLine++;
    parts.push({ kind: m[1].toLowerCase(), line: i + 1, fromLine: i, toLine: last, start: L[i].start, end: L[endLine].end, bodyEnd: L[last].end });
    i = last;
  }
  if (!parts.length) return null;
  const first = parts[0];
  let commentStart = first.start;
  // The comment line (and one blank line) written above the group.
  for (let i = first.fromLine - 1; i >= 0 && i >= first.fromLine - 2; i--) {
    if (L[i].body.trim() === COMMENT(action, state)) {
      commentStart = L[i].start;
      // The blank line written before the comment goes with the group.
      if (i > 0 && !L[i - 1].body.trim()) commentStart = L[i - 1].start;
      break;
    }
    if (L[i].body.trim()) break;
  }
  const hit = parts.find((p) => p.kind === 'hit');
  let elems = [];
  const triggers = [];
  if (hit) {
    for (let i = hit.fromLine + 1; i <= hit.toLine; i++) {
      if (/^trigger(all|\d+)\s*=/i.test(L[i].bare)) {
        triggers.push({ start: L[i].start, end: L[i].end, text: L[i].body });
        const e = /\banimelem\s*=\s*(\d+)/i.exec(L[i].bare);
        if (e && !elems.includes(+e[1])) elems.push(+e[1]);
      }
    }
  }
  elems.sort((a, b) => a - b);
  return { parts, commentStart, hit, triggers, elems };
}

// Where controllers are appended in a statedef that starts on `headerLine`
// (1-based): after the last line of it that is not blank or a comment, so a
// comment block that introduces the next statedef stays with that one.
function appendPoint(text, headerLine) {
  const L = linesOf(text);
  let j = headerLine;                      // index of the line after the header
  while (j < L.length && !/^\[\s*statedef\b/i.test(L[j].bare)) j++;
  let last = j - 1;
  while (last >= headerLine && !L[last].bare) last--;
  if (last < headerLine - 1) last = headerLine - 1;
  const at = L[last] ? L[last].end : text.length;
  const endsWithNl = L[last] ? /\n$/.test(L[last].raw) : true;
  return { offset: at, needsNl: !endsWithNl };
}

module.exports = { groupText, stateTypeSetText, triggerLines, findGroup, appendPoint, linesOf, eolOf, COMMENT, LABEL_RE, onElem, offElem };
