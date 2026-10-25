'use strict';
//
// attachfix.js - "Play without it" for a stage whose attached character is
// missing: the stage's attachedchar line is commented out, so the stage plays
// without that character instead of stopping the game.
//
// WHY. A stage can name a character in its [Info] `attachedchar` (and
// attachedchar2, 3...) to run its own rules (GRAIL: a stage's attached
// character travels with it). The engine looks for it with
//   SearchFile(value, [the def, "", "data/"], "stages/")      (stage.go)
// - beside the def, then from the game folder, then under data/, each of
// them also with stages/ in front - and when it is in none of them it keeps
// the bare value, the loader opens that and fails, and the game stops:
// "open LasombraSystems/LasombraSystems.CHR: No such file or directory"
// (Valley of the End, whose zip ships no LasombraSystems; the web build
// freezes on it and the desktop build stops too), on a random stage pick as
// well as a chosen one.
//
// WHICH LINES. As the engine reads them (common.go IniSection.Parse): the
// text before a ';', the key up to the first '=', space or tab, lower-cased,
// `attachedchar` or `attachedchar<N>`; an empty value names nothing. Only an
// [Info] section counts (stage.go getSection("info"), and a localized
// "<lang>.info"). Only the main def's attached characters are ever loaded
// (system.go loadCharacter reads sys.stageList[0], the def select.def lists):
// a round variant's (round1def..., modlib.roundDefNames) are parsed and never
// loaded, so `stops` is the main def's alone. The repair still takes the
// missing line out of the round variants too, so the stage's defs agree.
//
// WHERE IT IS LOOKED FOR, in the bundle's terms: a path under stages/ is a
// file in the stages folder; any other path (the game folder, data/) is asked
// of `inBuild`, the build's own file list (the server passes its VFS index;
// it is consulted only when the stages folder does not have the file). Then
// the Studio's own rule: the bare file name beside the def, where the Stages
// tab and the build import place an attached character (they rewrite the
// def's value to that name).
//
// THE EDIT is each such line, commented out in place: MARK in front of the
// line, the line itself kept byte for byte after it (its spacing, comment
// and line ending), so the engine and every Studio parser skip it (a line
// that starts with ';' is a comment) and Undo takes MARK off again. Only the
// lines whose character is missing; one that is there is never touched. Each
// def it edits is backed up beside itself first (BAK, ends in .orig: every
// export's backup filter drops it, and removing the stage removes it with
// the def's other same-name files), the write is read back, and a def that
// does not read back puts every def of the call back. Undo takes MARK off
// every marked line; when nothing else changed the def since, that is the
// backup byte for byte (reported as `exact`), and when something did (a later
// Fit thumbnail), that change is kept. Then the backup goes.
const fs = require('fs');
const path = require('path');

const MARK = '; attached character missing, played without it (Mugen Studio): ';
const BAK = '.attachfix.orig';

// The text as lines that KEEP their endings: joined back with '' they are the
// file, byte for byte, whatever mix of CRLF and LF it holds (thumbfit.js).
const segs = (text) => text.match(/[^\n]*\n|[^\n]+$/g) || [];
const bare = (s) => s.replace(/\r?\n$/, '');
const stampOf = (p) => { try { const st = fs.statSync(p); return st.size + '@' + st.mtimeMs + '@' + st.ctimeMs; } catch (e) { return '-'; } };

// One line as the engine's ini reader takes it: { key, value } or null.
function kvOf(line) {
  const l = line.split(';')[0].trim();
  const ia = l.search(/[= \t]/);
  if (ia <= 0) return null;
  const eq = l.indexOf('=');
  return { key: l.slice(0, ia).toLowerCase(), value: eq >= 0 ? l.slice(eq + 1).trim() : '' };
}
// A value the way LoadFile and SearchFile take it: matching quotes around it
// off, backslashes made slashes.
function pathOf(value) {
  let v = String(value).trim();
  if (v.length >= 2 && (v[0] === '"' || v[0] === "'") && v[v.length - 1] === v[0]) v = v.slice(1, -1);
  return v.trim().replace(/\\/g, '/');
}
const isInfo = (name) => name === 'info' || /^[^ \t\]]+\.info$/.test(name);

// The def's attached-character lines:
//   entries: [{ i (segment index), line (1-based), key, value (as written), path, shadowed }]
//   marked:  [{ i, line, key, value, path }] - lines this repair commented out
// `shadowed`: a later line of a key the section already set (the engine keeps
// the first).
function scan(text) {
  const ls = segs(text);
  const entries = [], marked = [];
  let section = '', seen = new Set();
  ls.forEach((seg, i) => {
    const raw = bare(seg);
    if (raw.startsWith(MARK)) {
      const kv = kvOf(raw.slice(MARK.length));
      marked.push({ i, line: i + 1, key: kv ? kv.key : '', value: kv ? kv.value : '', path: kv ? pathOf(kv.value) : '' });
      return;
    }
    const t = raw.trim();
    if (t.startsWith('[')) {
      // common.go SectionName: a name with a space in it is no [Info]
      const h = /^\[([^\]]*)\]/.exec(t.split(';')[0].trim());
      section = h ? h[1].toLowerCase() : '';
      seen = new Set();
      return;
    }
    if (!isInfo(section)) return;
    const kv = kvOf(raw);
    if (!kv || !/^attachedchar\d*$/.test(kv.key)) return;
    const p = pathOf(kv.value);
    if (!p) return;
    entries.push({ i, line: i + 1, key: kv.key, value: kv.value, path: p, shadowed: seen.has(kv.key) });
    seen.add(kv.key);
  });
  return { ls, entries, marked };
}

// Where the engine would find `value` for the def at `defFull` (under
// `stagesDir`), as a path of the build ('stages/x.def', 'data/x.def'), or
// null when it is in none of the places it looks.
function locate(stagesDir, defFull, value, inBuild) {
  const v = pathOf(value);
  if (!v || /^[a-z]:\//i.test(v) || v.startsWith('/')) return null;   // a path on one machine, never in a build
  const root = path.resolve(stagesDir);
  const inside = (p) => { const r = path.relative(root, p); return !!r && !r.startsWith('..') && !path.isAbsolute(r); };
  const defRel = path.relative(root, path.dirname(defFull)).replace(/\\/g, '/');
  const defDir = 'stages' + (defRel ? '/' + defRel : '');
  const hasStages = /^stages\//i.test(v);
  const cands = [defDir + '/' + v];
  if (!hasStages) cands.push(defDir + '/stages/' + v);
  cands.push(v);
  if (!hasStages) cands.push('stages/' + v);
  cands.push('data/' + v);
  if (!hasStages) cands.push('data/stages/' + v);
  const seen = new Set();
  const outside = [];
  for (const c of cands) {
    const n = path.posix.normalize(c);
    if (n === '..' || n.startsWith('../') || seen.has(n.toLowerCase())) continue;
    seen.add(n.toLowerCase());
    if (/^stages\//i.test(n)) {
      const full = path.resolve(root, ...n.slice(7).split('/'));
      if (inside(full) && fs.existsSync(full) && fs.statSync(full).isFile()) return n;
    } else outside.push(n);
  }
  // the Studio's own place for it: the bare name beside the def
  const beside = path.resolve(path.dirname(defFull), v.split('/').pop());
  if (inside(beside) && fs.existsSync(beside) && fs.statSync(beside).isFile()) {
    return 'stages/' + path.relative(root, beside).replace(/\\/g, '/');
  }
  if (typeof inBuild === 'function') {
    for (const n of outside) { try { if (inBuild(n)) return n; } catch (e) { /* not there */ } }
  }
  return null;
}

// What a def names, kept per def while the file keeps its size and times:
// every stage of the roster is read on every draw of the Stages tab, and
// almost none names an attached character.
const DEF_CACHE = new Map();
function defScan(full) {
  const stamp = stampOf(full);
  if (stamp === '-') return null;
  const hit = DEF_CACHE.get(full);
  if (hit && hit.stamp === stamp) return hit.info;
  let text;
  try { text = fs.readFileSync(full, 'latin1'); } catch (e) { return null; }
  const s = scan(text);
  const strip = (e) => { const o = Object.assign({}, e); delete o.i; return o; };
  const info = { entries: s.entries.map(strip), marked: s.marked.map(strip), rounds: require('./modlib').roundDefNames(text) };
  if (DEF_CACHE.size >= 4096 && !DEF_CACHE.has(full)) DEF_CACHE.clear();
  DEF_CACHE.set(full, { stamp, info });
  return info;
}

// The stage's def and its round variants' defs: [{ def, full, info, main }]
function stageDefs(stagesDir, defFile) {
  const root = path.resolve(stagesDir);
  const mainFull = path.resolve(root, defFile);
  const main = defScan(mainFull);
  if (!main) throw new Error('no such stage');
  const defs = [{ def: defFile, full: mainFull, info: main, main: true }];
  for (const n of main.rounds) {
    const full = path.resolve(path.dirname(mainFull), n);
    const r = path.relative(root, full);
    if (!r || r.startsWith('..') || path.isAbsolute(r)) continue;
    if (defs.some((d) => d.full.toLowerCase() === full.toLowerCase())) continue;
    const info = defScan(full);
    if (info) defs.push({ def: r.replace(/\\/g, '/'), full, info, main: false });
  }
  return defs;
}

// What the card shows. null for a stage none of whose defs names an attached
// character or carries the repair (nearly every stage).
//   { defs: [{ def, main, entries: [{ key, value, line, found, shadowed }],
//              marked: [{ key, value, line, found }], backup }],
//     missing: [{ def, main, key, value, line }]  (the lines the engine reads),
//     stops: a missing one in the main def - the game stops when the stage loads,
//     repaired: a line carries the marker }
function status(stagesDir, defFile, opts) {
  const inBuild = opts && opts.inBuild;
  const defs = stageDefs(stagesDir, defFile);
  if (!defs.some((d) => d.info.entries.length || d.info.marked.length)) return null;
  const missing = [];
  const list = defs.map((d) => {
    const entries = d.info.entries.map((e) => Object.assign({}, e, { found: locate(stagesDir, d.full, e.value, inBuild) }));
    for (const e of entries) if (!e.found && !e.shadowed) missing.push({ def: d.def, main: d.main, key: e.key, value: e.value, line: e.line });
    // A line already played without is looked for in the stages folder only:
    // the answer is a note on the card ("is in the build now"), and asking the
    // build's file list would make that list on every draw after an edit.
    const marked = d.info.marked.map((e) => Object.assign({}, e, { found: e.path ? locate(stagesDir, d.full, e.value, null) : null }));
    return { def: d.def, main: d.main, entries, marked, backup: fs.existsSync(d.full + BAK) };
  });
  return {
    defs: list,
    missing,
    stops: missing.some((m) => m.main),
    repaired: list.some((d) => d.marked.length > 0),
  };
}

// MARK taken off every marked line: the def as it was before the repair.
function unmark(text) {
  return segs(text).map((s) => (s.startsWith(MARK) ? s.slice(MARK.length) : s)).join('');
}

// Comment out every line, in the def and its round variants, whose attached
// character is missing (a shadowed duplicate too: with the first line gone it
// would be the one the engine reads).
function repair(stagesDir, defFile, opts) {
  const inBuild = opts && opts.inBuild;
  const work = [];
  for (const d of stageDefs(stagesDir, defFile)) {
    const buf = fs.readFileSync(d.full);
    const text = buf.toString('latin1');
    const s = scan(text);
    const hit = s.entries.filter((e) => !locate(stagesDir, d.full, e.value, inBuild));
    if (!hit.length) continue;
    const ls = s.ls.slice();
    for (const e of hit) ls[e.i] = MARK + ls[e.i];
    const next = ls.join('');
    if (unmark(next) !== unmark(text)) throw new Error(d.def + ': the edit would not undo cleanly, so nothing was changed');
    work.push({ d, buf, text, next, hit, keepBak: s.marked.length > 0 && fs.existsSync(d.full + BAK) });
  }
  if (!work.length) throw new Error('every attached character this stage names is there');
  const done = [];
  try {
    for (const w of work) {
      const bak = w.d.full + BAK;
      const madeBak = !w.keepBak;
      if (madeBak) fs.writeFileSync(bak, w.buf);
      done.push({ w, madeBak });
      fs.writeFileSync(w.d.full, w.next, 'latin1');
      DEF_CACHE.delete(w.d.full);
      const back = fs.readFileSync(w.d.full).toString('latin1');
      if (back !== w.next) throw new Error(w.d.def + ' did not read back as written');
    }
  } catch (e) {
    // every def this call wrote goes back to the bytes it had
    for (const { w, madeBak } of done.reverse()) {
      try { fs.writeFileSync(w.d.full, w.buf); if (madeBak) fs.unlinkSync(w.d.full + BAK); } catch (err) { /* reported below */ }
      DEF_CACHE.delete(w.d.full);
    }
    throw new Error('the edit did not go through, so the stage was put back: ' + e.message);
  }
  return {
    defs: work.map((w) => ({ def: w.d.def, main: w.d.main, lines: w.hit.map((e) => ({ key: e.key, value: e.value, line: e.line })) })),
    lines: work.reduce((a, w) => a + w.hit.length, 0),
  };
}

function undo(stagesDir, defFile) {
  const work = [];
  for (const d of stageDefs(stagesDir, defFile)) {
    const text = fs.readFileSync(d.full).toString('latin1');
    const s = scan(text);
    if (!s.marked.length) continue;
    work.push({ d, text, marked: s.marked });
  }
  if (!work.length) throw new Error('nothing to undo: no line of this stage was commented out by Play without it');
  const out = [];
  for (const w of work) {
    const orig = unmark(w.text);
    const bak = w.d.full + BAK;
    let exact = false;
    try { exact = fs.existsSync(bak) && fs.readFileSync(bak).toString('latin1') === orig; } catch (e) { exact = false; }
    fs.writeFileSync(w.d.full, orig, 'latin1');
    DEF_CACHE.delete(w.d.full);
    if (fs.readFileSync(w.d.full).toString('latin1') !== orig) throw new Error(w.d.def + ' did not read back as it was; its backup is kept');
    try { if (fs.existsSync(bak)) fs.unlinkSync(bak); } catch (e) { /* litter only: never shipped */ }
    out.push({ def: w.d.def, main: w.d.main, exact, lines: w.marked.map((e) => ({ key: e.key, value: e.value, line: e.line })) });
  }
  return { defs: out };
}

module.exports = { MARK, BAK, scan, locate, pathOf, status, repair, undo, unmark, DEF_CACHE };
