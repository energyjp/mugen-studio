// WebMUGEN lite - which sounds stay exact in a lite build (packer side only).
//
// Only a character's own sounds go to MP3, and not all of them:
//
//   - A .snd that is not a character's stays exact: the screenpack's (menu
//     and select sounds, the most heard of all), fight.snd, common.snd, a
//     module's. "A character's" means named by `sound =` in the [Files] of a
//     character .def in the build.
//   - A character sound that the character's own state files play LOOPED
//     stays exact: a PlaySnd with `loop` not 0, `loopcount` not 0 or 1
//     (-1 loops forever, 2 or more repeats it; the engine loops on it even
//     with no `loop`), or with `loopstart` / `loopend`, whose `value` is a
//     literal group,index (no F prefix: those are fight.snd's, already
//     exact). A loop seam is where MP3 is heard
//     most: the decoded clip does not end where it starts.
//
// Every other character sound goes to MP3 as before.
//
//   plan(files) -> { charSnd: Set<vpath>, loops: Map<vpath, Set<'g,i'>> }
//   entries(b)  -> [{ at, end, g, n }] the WAV sub-files of a .snd
//   keyAt(list, off) -> 'g,i' of the sub-file holding byte `off`, or ''
'use strict';

const LOOP_KEYS = ['loop', 'loopcount', 'loopstart', 'loopend'];

// A key is looped when it is there and is not a plain 0 (loopcount: not a
// plain 0 or 1). An expression may be anything at run time, so it counts.
function looped(kv) {
  for (const k of LOOP_KEYS) {
    if (!kv.has(k)) continue;
    const v = kv.get(k).replace(/\s+/g, '');
    if (k === 'loop' && /^[-+]?0+$/.test(v)) continue;
    if (k === 'loopcount' && /^([-+]?0+|\+?0*1)$/.test(v)) continue;   // 0: `loop` decides; 1: plays once
    if (v === '') continue;
    return true;
  }
  return false;
}

// `value = 10,0` / `S10,0` -> '10,0'; F-prefixed, negative or computed -> ''.
function ownKey(raw) {
  const m = /^([SsFf]?)(\d+),(\d+)$/.exec(String(raw || '').replace(/\s+/g, ''));
  if (!m || m[1].toUpperCase() === 'F') return '';
  return (+m[2]) + ',' + (+m[3]);
}

// The looped own-sound keys one state file plays. CNS: a [State] block is
// read whole before its keys mean anything, and the first of a repeated key
// wins (the engine's compiler does the same). ZSS: playSnd{ ...; ... }.
function loopedIn(text, isZss) {
  const keys = new Set();
  if (!isZss) {
    let kv = null;
    const flush = () => {
      if (kv && (kv.get('type') || '').toLowerCase() === 'playsnd' && kv.has('value') && looped(kv)) {
        const k = ownKey(kv.get('value'));
        if (k) keys.add(k);
      }
      kv = null;
    };
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.replace(/;.*$/, '').trim();
      if (!line) continue;
      if (line[0] === '[') { flush(); kv = new Map(); continue; }
      if (!kv) continue;
      const m = /^([A-Za-z_.0-9]+)\s*=\s*(.*)$/.exec(line);
      if (m && !kv.has(m[1].toLowerCase())) kv.set(m[1].toLowerCase(), m[2].trim());
    }
    flush();
  } else {
    const clean = text.split(/\r?\n/).map((l) => l.replace(/#.*$/, '')).join('\n');
    for (const m of clean.matchAll(/\bplaysnd\s*\{([^}]*)\}/gi)) {
      const kv = new Map();
      for (const pm of m[1].matchAll(/\b(value|loop|loopcount|loopstart|loopend)\s*:\s*([^;}\r\n]+)/gi)) {
        const k = pm[1].toLowerCase();
        if (!kv.has(k)) kv.set(k, pm[2].trim());
      }
      if (kv.has('value') && looped(kv)) { const k = ownKey(kv.get('value')); if (k) keys.add(k); }
    }
  }
  return keys;
}

// A .def's [Files] section, keys lower-cased, first one wins.
function defFiles(text) {
  const out = new Map();
  let inFiles = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/;.*$/, '').trim();
    if (!line) continue;
    if (line[0] === '[') { inFiles = /^\[\s*files\s*\]/i.test(line); continue; }
    if (!inFiles) continue;
    const m = /^([A-Za-z_.0-9]+)\s*=\s*(.*)$/.exec(line);
    if (m && !out.has(m[1].toLowerCase())) out.set(m[1].toLowerCase(), m[2].trim().replace(/^"(.*)"$/, '$1'));
  }
  return out;
}

const norm = (p) => p.replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/^\.\//, '');
function joinV(dir, rel) {
  const parts = (dir ? dir + '/' : '').concat(norm(rel)).split('/');
  const out = [];
  for (const p of parts) { if (p === '' || p === '.') continue; if (p === '..') out.pop(); else out.push(p); }
  return out.join('/');
}

// files: Map vpath -> Buffer (the build's files).
function plan(files) {
  const byLower = new Map();
  for (const vpath of files.keys()) byLower.set(norm(vpath).toLowerCase(), vpath);
  // A file a .def names: beside the .def first, then data/, then the root
  // (the engine's own search order for a character's files).
  const find = (defDir, rel) => {
    if (!rel) return '';
    for (const p of [joinV(defDir, rel), joinV('data', rel), joinV('', rel)]) {
      const hit = byLower.get(p.toLowerCase());
      if (hit) return hit;
    }
    return '';
  };
  const charSnd = new Set();
  const loops = new Map();
  const scanned = new Map();              // a state file read once (common1.cns is everyone's)
  for (const [vpath, b] of files) {
    if (!/\.def$/i.test(vpath) || b.length > 1048576) continue;
    const f = defFiles(b.toString('latin1'));
    // A character: its [Files] names its sounds and its states. A screenpack
    // or fight.def names `snd`, never `sound`.
    if (!f.has('sound') || !(f.has('cns') || f.has('st'))) continue;
    const dir = norm(vpath).split('/').slice(0, -1).join('/');
    const snd = find(dir, f.get('sound'));
    if (!snd || !/\.snd$/i.test(snd)) continue;
    charSnd.add(snd);
    const keys = loops.get(snd) || new Set();
    for (const [k, rel] of f) {
      if (!(k === 'cmd' || k === 'cns' || k === 'stcommon' || /^st\d*$/.test(k))) continue;
      const st = find(dir, rel);
      if (!st) continue;
      if (!scanned.has(st)) scanned.set(st, loopedIn(files.get(st).toString('latin1'), /\.zss$/i.test(st)));
      for (const key of scanned.get(st)) keys.add(key);
    }
    if (keys.size) loops.set(snd, keys);
  }
  return { charSnd, loops };
}

// The WAV sub-files of a .snd: 'ElecbyteSnd\0', count at 16, the first entry
// at 20; an entry is next, length, group, index, then its WAV bytes.
function entries(b) {
  const list = [];
  if (b.length < 24 || b.toString('latin1', 0, 11) !== 'ElecbyteSnd' || b[11] !== 0) return list;
  const num = b.readUInt32LE(16);
  let off = b.readUInt32LE(20);
  for (let i = 0; i < num && off + 16 <= b.length; i++) {
    const next = b.readUInt32LE(off), len = b.readUInt32LE(off + 4);
    let end = Math.min(b.length, off + 16 + len);
    if (next > off && next < end) end = next;
    list.push({ at: off + 16, end, g: b.readInt32LE(off + 8), n: b.readInt32LE(off + 12) });
    if (!next || next <= off) break;
    off = next;
  }
  return list.sort((x, y) => x.at - y.at);
}
function keyAt(list, off) {
  let lo = 0, hi = list.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1, e = list[mid];
    if (off < e.at) hi = mid - 1;
    else if (off >= e.end) lo = mid + 1;
    else return e.g + ',' + e.n;
  }
  return '';
}

module.exports = { plan, entries, keyAt, loopedIn, defFiles };
