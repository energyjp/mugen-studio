// MUGEN'S HITDEF DEFAULT, p1sprpriority = 1, written into the characters a
// build ships.
//
// In MUGEN a HitDef that connects puts the attacker at sprite priority 1
// unless it names its own (`p1sprpriority`, or its DOS-era alias
// `sprpriority`). Ikemen GO 1.0.0 leaves him where he was: upstream keeps
// MUGEN's default commented out (char.go: `p1sprpriority: IErr, // 1 in
// Mugen`), and our older web engine still had it. A scene written for MUGEN
// layers on the default - Kur0maru's glory hole 51205 holds him at 2 in its
// header and her hips at 2 in 51219, meant to draw over his tentacle mass once
// his hit drops him to 1; on Ikemen the tie draws the attacker on top, in
// fights and in the gallery alike (GRAIL 5.7).
//
// So for a character written for MUGEN - its .def [Info] names no
// `ikemenversion` - every HitDef that names neither key gets `p1sprpriority =
// 1` right under its `type` line: MUGEN's own default, written out, the same
// for every opponent (not a per-receiver tweak, GRAIL 4.5). In the COPY a
// build ships, never in the character's own file: the website build overlays
// it (vfslib charFixes), the desktop export writes it into the folder it just
// copied (desktop.js fixCopiedCharacters). The files are the ones the engine
// compiles states from ([Files] st, st0..stN, cmd, stcommon - scenelib's
// stateFiles, the engine's order), bytes kept as they are (latin1, the file's
// own line endings).
'use strict';
const fs = require('fs');
const path = require('path');
const S = require('./scenelib.js');

// Does the .def's [Info] name an Ikemen version? (first [Info], first key wins)
function ikemenAuthored(defText) {
  const lines = S.stripBom(String(defText)).split('\n').map(S.trimGo);
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!l || l[0] !== '[') continue;
    let nm = l.split(';')[0].trim();
    if (nm[nm.length - 1] !== ']') continue;
    nm = nm.slice(1, nm.indexOf(']')).trim().toLowerCase();
    if (nm !== 'info') continue;
    for (i++; i < lines.length; i++) {
      if (lines[i] && lines[i][0] === '[') return false;
      const line = lines[i].split(';')[0];
      const m = /^\s*ikemenversion\s*=\s*(.*)$/i.exec(line);
      if (m && m[1].replace(/"/g, '').trim()) return true;
    }
    return false;
  }
  return false;
}

// One state file's text, with MUGEN's default written into every HitDef that
// names no priority of its own. Returns { text, count } (count 0: unchanged).
function patchText(text) {
  const nl = /\r\n/.test(text) ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const out = [];
  let count = 0;
  let block = null;   // the current [State ...] controller's lines
  const flush = () => {
    if (!block) return;
    const keyOf = (l) => { const s = l.split(';')[0]; const eq = s.indexOf('='); return eq < 0 ? '' : s.slice(0, eq).trim().toLowerCase(); };
    const valOf = (l) => { const s = l.split(';')[0]; const eq = s.indexOf('='); return eq < 0 ? '' : s.slice(eq + 1).trim().toLowerCase(); };
    const typeAt = block.findIndex((l, i) => i > 0 && keyOf(l) === 'type' && valOf(l) === 'hitdef');
    const named = block.some((l, i) => i > 0 && (keyOf(l) === 'p1sprpriority' || keyOf(l) === 'sprpriority'));
    if (typeAt > 0 && !named) {
      const indent = (/^[ \t]*/.exec(block[typeAt]) || [''])[0];
      block.splice(typeAt + 1, 0, indent + 'p1sprpriority = 1');
      count++;
    }
    for (const l of block) out.push(l);
    block = null;
  };
  for (const l of lines) {
    const head = l.split(';')[0].trim();
    if (head[0] === '[') {
      flush();
      if (/^\[\s*state\s/i.test(head) && !/^\[\s*statedef/i.test(head)) { block = [l]; continue; }
      out.push(l);
      continue;
    }
    if (block) block.push(l); else out.push(l);
  }
  flush();
  return { text: count ? out.join(nl) : text, count };
}

// modlib, looked up once. A require() per state file went through Node's whole
// lookup each time (it searches every parent folder for a package.json), which
// was about 13% of a refresh at 150 characters. Still required on first use,
// not at the top, so loading this file stays as light as it was.
let modlib = null;
const resolveCI = (dir, rel) => (modlib || (modlib = require('./modlib.js'))).resolveCI(dir, rel);

// KEPT PER CHARACTER, AS THE ANSWER - NOT EVERY FILE'S TEXT. This cached each
// state file's text and each patched copy forever, under a key with the file's
// size and time in it, so an edit added an entry and every desktop export (it
// repairs the copies it just wrote, new paths each time) added a roster's
// worth: 43 MB kept on Main for 380 files, ~700 MB at 800 characters. What a
// later call reuses is the answer for a character while its files stay as they
// are: the patched copies of the files that change (most files change
// nothing, and those keep nothing). Stamped by the .def and every own state
// file it names (path|size@mtime, in the engine's order), so an edit to any of
// them - one file's patch reads the others' text (ailatch) - recomputes the
// whole answer. Bounded by the bytes kept, oldest first: the patched text,
// plus the stamp and a fixed 512 bytes per entry, so the characters with
// nothing patched (most of them, each keeping its stamp) count too.
const MEMO = new Map();   // charDir|defName -> { stamp, out, bytes }
const MEMO_MAX_BYTES = 256 * 1024 * 1024;
let memoBytes = 0;
function remember(key, stamp, out) {
  const old = MEMO.get(key);
  if (old) { memoBytes -= old.bytes; MEMO.delete(key); }
  const bytes = 512 + stamp.length + out.reduce((n, h) => n + h.text.length, 0);
  if (bytes > MEMO_MAX_BYTES) return;
  MEMO.set(key, { stamp, out, bytes });
  memoBytes += bytes;
  for (const [k, v] of MEMO) {
    if (memoBytes <= MEMO_MAX_BYTES) break;
    MEMO.delete(k); memoBytes -= v.bytes;
  }
}
// A copy per caller: the entries are handed out again on the next call.
const copyOut = (out) => out.map((h) => ({ abs: h.abs, rel: h.rel, text: h.text, count: h.count, latches: h.latches }));

// What a character's shipped copy needs: [{ abs, rel, text, count, latches }]
// for each state file with a HitDef to fill in (count, MUGEN-authored
// characters only) or an AI switch to release (latches, ailatch.js), or [] when
// there is neither. `rel` is relative to charDir.
function repairFor(charDir, defName, opts) {
  const defPath = path.join(charDir, defName);
  let defText, defSt;
  try { defSt = fs.statSync(defPath); defText = fs.readFileSync(defPath, 'latin1'); } catch (e) { return []; }
  const mugen = !ikemenAuthored(defText);
  const resolve = (opts && opts.resolve) || ((rel) => resolveCI(charDir, rel));
  // The character's own state files, in the engine's order.
  const files = [];
  for (const f of S.stateFiles(charDir, defName, resolve)) {
    if (!f.abs || /\.zss$/i.test(f.abs)) continue;
    const rel = path.relative(charDir, f.abs);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) continue;
    if (files.some((o) => o.abs === f.abs)) continue;
    let st;
    try { st = fs.statSync(f.abs); } catch (e) { continue; }
    files.push({ abs: f.abs, rel, st: st.size + '@' + st.mtimeMs });
  }
  // A caller's own resolver is not part of the key: such a call is not kept.
  const key = (opts && opts.resolve) ? null : charDir + '|' + defName;
  const stamp = defSt.size + '@' + defSt.mtimeMs + '|' + files.map((o) => o.abs + '|' + o.st).join(';');
  const hit = key && MEMO.get(key);
  if (hit && hit.stamp === stamp) return copyOut(hit.out);
  // Read once; the impossible commands any of them define (a .cmd's
  // [Command] blocks) decide what ailatch looks for.
  const ailatch = require('./ailatch.js');
  const own = [];
  let complete = true;
  for (const f of files) {
    let text;
    try { text = fs.readFileSync(f.abs, 'latin1'); } catch (e) { complete = false; continue; }
    own.push({ abs: f.abs, rel: f.rel, text, impossible: ailatch.impossibleCommands(text) });
  }
  const impossible = new Set();
  for (const o of own) for (const n of o.impossible) impossible.add(n);
  const out = [];
  for (const o of own) {
    const h = mugen ? patchText(o.text) : { text: o.text, count: 0 };
    const a = ailatch.patchText(h.text, impossible, own.filter((x) => x !== o).map((x) => x.text));
    if (h.count || a.count) out.push({ abs: o.abs, rel: o.rel.split(path.sep).join('/'), text: a.text, count: h.count, latches: a.count });
  }
  // a file that would not read is tried again next time, as before
  if (key && complete) remember(key, stamp, out);
  return copyOut(out);
}

module.exports = { repairFor, patchText, ikemenAuthored };
