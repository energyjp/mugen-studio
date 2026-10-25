'use strict';
//
// widefit.js - "Widescreen fit" for a stage: its coordinate space widened to
// the build's aspect at the same height, so it fills a widescreen fight at
// the scale its author drew it.
//
// WHY THE SCENERY, NOT THE CAMERA. The engine scales characters to a fixed
// 320-wide world (char.go: localscl = 320 / localcoord) and a stage to the
// screen's logical width (stage.go: localscl = gameWidth / localcoord[0]). At
// 16:9 that logical width is 426.67, so a stage declared 320 wide is drawn a
// third larger than the fighters standing on it and loses a third of its
// height - the "zoomed in" look of an old stage in a wide window. Declaring it
// 426 wide puts the scenery back at the fighters' scale, shows the stage's
// whole height, and (with the fight taking the stage's shape) makes the fight
// box 16:9. The picture must then cover 53 more units on each side: the
// camera's scroll range is pulled in by that much, and where the stage did not
// scroll that far the sides may show void - said in the result, judged in the
// game.
//
// floor, not round: 240 x 16/9 = 426.67, and 426 leaves the stage a hair
// TALLER than the screen, which the engine trims from the bottom (cutlow); 427
// would leave it a hair shorter, which the engine answers by shifting the
// stage down and showing a hairline of void along the top.
//
// The edit is the stage's own .def, in place, with what it replaced written
// on a marker line so "undo" restores the file byte for byte. Nothing else in
// the def is touched.
const fs = require('fs');
const path = require('path');

const MARK = '; widescreen fit (Mugen Studio):';
const SEC_RE = /^\s*\[([^\]]+)\]/;

const splitLines = (text) => {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  return { ls: text.split(/\r?\n/), eol };
};
// [start, end) of the lines under a section header (start = header index + 1); null when absent
function section(ls, name) {
  const want = name.toLowerCase();
  for (let i = 0; i < ls.length; i++) {
    const m = SEC_RE.exec(ls[i]);
    if (!m || m[1].trim().toLowerCase() !== want) continue;
    let e = i + 1;
    while (e < ls.length && !SEC_RE.test(ls[e])) e++;
    return { header: i, start: i + 1, end: e };
  }
  return null;
}
const KEY_RE = (key) => new RegExp('^(\\s*' + key + '\\s*=\\s*)([^;\\r\\n]*?)(\\s*(?:;.*)?)$', 'i');
function findKey(ls, sec, key) {
  if (!sec) return null;
  const re = KEY_RE(key);
  for (let i = sec.start; i < sec.end; i++) { const m = re.exec(ls[i]); if (m) return { i, value: m[2].trim(), m }; }
  return null;
}
const nums = (v) => String(v || '').split(',').map((x) => parseFloat(x)).filter((x) => Number.isFinite(x));

// Everything the fit would do, from the text alone. aspect = width / height of the build.
function plan(text, aspect) {
  const { ls } = splitLines(text);
  const info = section(ls, 'StageInfo'), cam = section(ls, 'Camera');
  const lc = findKey(ls, info, 'localcoord');
  const lcv = lc ? nums(lc.value) : [];
  const W = lcv.length >= 1 && lcv[0] > 0 ? lcv[0] : 320, H = lcv.length >= 2 && lcv[1] > 0 ? lcv[1] : 240;
  const marker = info ? ls.slice(info.start, info.end).findIndex((l) => l.trim().startsWith(MARK)) : -1;
  if (marker >= 0) return { fitted: true, localcoord: [W, H], was: parseMarker(ls[info.start + marker]) };
  // a hair under, never over: 854x480 (the web default) puts 240 x 1.7792 on exactly 427
  const Wt = Math.floor(H * aspect - 1e-3);
  if (Wt <= W) return { fitted: false, fits: false, localcoord: [W, H], reason: 'already ' + (Math.abs(H * aspect - W) < 2 ? 'this shape' : 'wider than the build') };
  const pull = Math.ceil((Wt - W) / 2);
  const bl = findKey(ls, cam, 'boundleft'), br = findKey(ls, cam, 'boundright');
  const blv = bl ? nums(bl.value)[0] || 0 : 0, brv = br ? nums(br.value)[0] || 0 : 0;
  // THE SELECT-SCREEN PICTURE SCALES WITH THE COORDINATE SPACE: the engine draws
  // a stage's 9000,1 at portraitscale * motif width / stage width (main.lua,
  // and stagethumb.js sizes the picture it adds by the same rule), so widening
  // 320 -> 426 would shrink it to 75% of its window. portraitscale, the
  // engine's own key for exactly this, is raised by the same factor.
  const ps = findKey(ls, info, 'portraitscale');
  const psv = ps && nums(ps.value)[0] > 0 ? nums(ps.value)[0] : 1;
  return {
    fitted: false, fits: true, localcoord: [W, H], to: [Wt, H], pull,
    bounds: { from: [blv, brv], to: [Math.min(0, blv + pull), Math.max(0, brv - pull)] },
    portrait: { from: psv, to: Math.round(psv * Wt / W * 100000) / 100000 },
    // units the camera may look past the stage's old frame at each end, if the picture stops there
    short: { left: Math.max(0, pull + blv), right: Math.max(0, pull - brv) },
  };
}
function parseMarker(line) {
  const out = {};
  for (const part of line.slice(line.indexOf(MARK) + MARK.length).split('|')) {
    const m = /^\s*(\S+) was (.+?)\s*$/.exec(part);
    if (m) out[m[1].toLowerCase()] = m[2] === 'absent' ? null : m[2];
  }
  return out;
}

// set or add `key = value` under a section (added right after the header, after the marker if there is one); value null removes it
function setKey(ls, secName, key, value) {
  let sec = section(ls, secName);
  if (!sec) {
    if (value === null) return;
    if (ls.length && ls[ls.length - 1].trim() !== '') ls.push('');
    ls.push('[' + secName + ']'); sec = section(ls, secName);
  }
  const k = findKey(ls, sec, key);
  if (value === null) { if (k) ls.splice(k.i, 1); return; }
  if (k) { ls[k.i] = k.m[1] + value + k.m[3]; return; }
  let at = sec.start;
  while (at < sec.end && ls[at].trim().startsWith(MARK)) at++;
  ls.splice(at, 0, key + ' = ' + value);
}

function apply(text, aspect) {
  const p = plan(text, aspect);
  if (p.fitted) throw new Error('already fitted');
  if (!p.fits) throw new Error('this stage is ' + p.reason);
  const { ls, eol } = splitLines(text);
  const info = section(ls, 'StageInfo'), cam = section(ls, 'Camera');
  const was = (sec, key) => { const k = findKey(ls, sec, key); return k ? k.value : 'absent'; };
  const marker = MARK + ' localcoord was ' + was(info, 'localcoord') + ' | boundleft was ' + was(cam, 'boundleft') + ' | boundright was ' + was(cam, 'boundright')
    + ' | portraitscale was ' + was(info, 'portraitscale');
  if (!info) { if (ls.length && ls[ls.length - 1].trim() !== '') ls.push(''); ls.push('[StageInfo]'); }
  const inf = section(ls, 'StageInfo');
  ls.splice(inf.start, 0, marker);
  setKey(ls, 'StageInfo', 'localcoord', p.to[0] + ',' + p.to[1]);
  setKey(ls, 'StageInfo', 'portraitscale', String(p.portrait.to));
  // a bound that stays at the default it never declared is not written
  const [nbl, nbr] = p.bounds.to;
  if (findKey(ls, section(ls, 'Camera'), 'boundleft') || nbl !== 0) setKey(ls, 'Camera', 'boundleft', String(nbl));
  if (findKey(ls, section(ls, 'Camera'), 'boundright') || nbr !== 0) setKey(ls, 'Camera', 'boundright', String(nbr));
  return { text: ls.join(eol), plan: p };
}

function undo(text) {
  const { ls, eol } = splitLines(text);
  const info = section(ls, 'StageInfo');
  const mi = info ? ls.slice(info.start, info.end).findIndex((l) => l.trim().startsWith(MARK)) : -1;
  if (mi < 0) throw new Error('not fitted');
  const was = parseMarker(ls[info.start + mi]);
  ls.splice(info.start + mi, 1);
  setKey(ls, 'StageInfo', 'localcoord', was.localcoord === undefined ? null : was.localcoord);
  setKey(ls, 'Camera', 'boundleft', was.boundleft === undefined ? null : was.boundleft);
  setKey(ls, 'Camera', 'boundright', was.boundright === undefined ? null : was.boundright);
  // a marker from before the fit wrote portraitscale says nothing about it: leave the key alone
  if ('portraitscale' in was) setKey(ls, 'StageInfo', 'portraitscale', was.portraitscale);
  // a [StageInfo] the fit itself added (its marker was its only line) goes with it
  const inf = section(ls, 'StageInfo');
  if (inf && inf.start === inf.end) { ls.splice(inf.header, 1); if (inf.header > 0 && ls[inf.header - 1] === '' && inf.header === ls.length) ls.pop(); }
  return { text: ls.join(eol), was };
}

const read = (dir, file) => fs.readFileSync(path.join(dir, file), 'latin1');
// THE STATUS IS KEPT per .def while the file keeps its size and times and the
// build keeps its shape: the Stages tab asks for every stage on every draw.
// The plan is stored as its JSON (what the route sends), so no caller can
// change the kept copy. A fit or an undo drops its own entry; any other edit
// moves the stamp. Bounded: a folder of renamed stages cannot grow it forever.
const STATUS = new Map();
const STATUS_MAX = 4096;
function statusStamp(full, aspect) {
  try { const st = fs.statSync(full); return st.size + '@' + st.mtimeMs + '@' + st.ctimeMs + '|' + aspect; } catch (e) { return null; }
}
function status(dir, file, aspect) {
  const full = path.join(dir, file);
  const stamp = statusStamp(full, aspect);
  const hit = stamp && STATUS.get(full);
  if (hit && hit.stamp === stamp) return JSON.parse(hit.json);
  const p = plan(read(dir, file), aspect);
  if (stamp) {
    if (STATUS.size >= STATUS_MAX && !STATUS.has(full)) STATUS.clear();
    STATUS.set(full, { stamp, json: JSON.stringify(p) });
  }
  return p;
}
function fitFile(dir, file, aspect) {
  const r = apply(read(dir, file), aspect);
  STATUS.delete(path.join(dir, file));
  fs.writeFileSync(path.join(dir, file), r.text, 'latin1');
  return r.plan;
}
function undoFile(dir, file) {
  const r = undo(read(dir, file));
  STATUS.delete(path.join(dir, file));
  fs.writeFileSync(path.join(dir, file), r.text, 'latin1');
  return r.was;
}

module.exports = { MARK, plan, apply, undo, status, fitFile, undoFile };
