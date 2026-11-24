'use strict';
// THE ENGINE ZIP, CHECKED.
//
// The desktop export builds against upstream's OFFICIAL modern-input build
// (Decision 24 of docs/UPSTREAM-MODERN-INPUT-PLAN.md): the GitHub pre-release
// `branch-modern-input`, whose Windows asset is `Ikemen_GO-modern-input-windows.zip`,
// and later the versioned release that replaces it (any `Ikemen_GO-v<x.y.z>-windows.zip`
// newer than 1.0.x). It sits in Dependencies (layout.DEPS). 1.0.x and every other
// zip (the develop nightly `Ikemen_GO-dev-windows.zip`, another OS, a name this
// file does not know) are NEVER picked: they are listed as not used, with the
// reason, so nothing unexpected is built from silently. And the picked zip's
// own Ikemen_GO.exe is read (never run) for the config sections it knows
// (`engineFormat`): the export writes those names and refuses an engine whose
// format it cannot tell. Before Phase 8 three places picked it with the same
// one-liner - newest by NAME - and nothing ever said which one had been picked,
// whether a second zip was sitting beside it, or whether the zip held what an
// export needs. The rc.5-versus-1.0.0 pick (2026-09-12) went unnoticed exactly
// because of that.
//
// This module is the one rule and the report:
//   pick(names)            newest by VERSION, not by name: "v0.99.0" sorts above
//                          "v0.100.0" as text and below it as a version, and a
//                          release beats its own release candidates
//   zipEntries(file)       the names in a zip's central directory - the file is
//                          never extracted, a 56 MB zip costs one small read
//   checkContents(names)   what the desktop export reads out of the engine
//   engineFormat(file)     the config format the zip's engine reads (its exe's
//                          own section names), or null
//   health()               everything above plus the export folder's stamp
//
// Only fs and path: layout.js requires this, so it must require nothing back.
const fs = require('fs');
const path = require('path');

// Every engine zip of upstream's naming (listed by health, used or not), and
// the official modern-input pre-release's own asset name (read from the
// release page 2026-11-17: Ikemen_GO-modern-input-windows.zip, 58,043,205 bytes,
// sha256 fa87f19854a8a317ec33a284ea2e4854e77fe9faea1abe86d2bc46f363246ef4, built
// from upstream 07c692fb; upstream republishes it under the same name).
const PATTERN = /^Ikemen_GO-.*windows.*\.zip$/i;
const PRERELEASE = /^Ikemen_GO-modern-input-windows\.zip$/i;
const PRERELEASE_NAME = 'Ikemen_GO-modern-input-windows.zip';

// "Ikemen_GO-v1.0.0-rc.5-windows.zip" -> [1, 0, 0, 5, false]. A release (no rc)
// ranks above any rc of the same version. Names with no version at all
// (a "nightly" zip) rank below every versioned one and among themselves by name.
function parseVersion(name) {
  const m = /Ikemen_GO-v?(\d+)\.(\d+)(?:\.(\d+))?(?:[-.]?rc[-.]?(\d+))?/i.exec(String(name));
  if (!m) return null;
  return { major: +m[1], minor: +m[2], patch: m[3] === undefined ? 0 : +m[3], rc: m[4] === undefined ? null : +m[4],
    text: m[1] + '.' + m[2] + (m[3] === undefined ? '' : '.' + m[3]) + (m[4] === undefined ? '' : '-rc.' + m[4]) };
}
function compare(a, b) {
  const va = parseVersion(a), vb = parseVersion(b);
  if (va && !vb) return 1;
  if (!va && vb) return -1;
  if (!va && !vb) return a < b ? -1 : a > b ? 1 : 0;
  for (const k of ['major', 'minor', 'patch']) if (va[k] !== vb[k]) return va[k] - vb[k];
  if (va.rc === vb.rc) return a < b ? -1 : a > b ? 1 : 0;
  if (va.rc === null) return 1;
  if (vb.rc === null) return -1;
  return va.rc - vb.rc;
}
// Whether the desktop export may use a zip, by its name: { use, kind, why }.
// kind 'prerelease' (the modern-input pre-release) or 'release' (a versioned
// release newer than 1.0.x, release candidates of one included); anything else
// is not used, and `why` says so in plain words.
function usable(name) {
  const n = String(name || '');
  if (!PATTERN.test(n)) return { use: false, kind: null, why: 'not an Ikemen GO Windows zip' };
  if (PRERELEASE.test(n)) return { use: true, kind: 'prerelease', why: null };
  const v = parseVersion(n);
  if (v && /^Ikemen_GO-v?\d+\.\d+(?:\.\d+)?(?:[-.]?rc[-.]?\d+)?-windows\.zip$/i.test(n)) {
    if (v.major > 1 || (v.major === 1 && v.minor >= 1)) return { use: true, kind: 'release', why: null };
    return { use: false, kind: null, why: 'Ikemen GO ' + v.text + ' reads the old controls ([Keys_Pn]); the desktop export uses the modern-input engine now' };
  }
  if (/^Ikemen_GO-dev-windows\.zip$/i.test(n)) return { use: false, kind: null, why: 'the develop nightly, not the modern-input engine' };
  return { use: false, kind: null, why: 'not a name the desktop export knows (it uses ' + PRERELEASE_NAME + ' or a release newer than 1.0)' };
}
// The name the export will use, from a list of file names; null when none is
// usable. A versioned release newer than 1.0.x (the one that replaces the
// pre-release) beats the pre-release; among releases the newest by version.
function pick(names) {
  const zips = (names || []).filter((n) => usable(n).use);
  if (!zips.length) return null;
  const rel = zips.filter((n) => usable(n).kind === 'release');
  if (rel.length) return rel.slice().sort(compare).pop();
  return zips.slice().sort().pop();
}
// What a picked name is, in words: "1.1.0", "modern-input (pre-release)".
function versionText(name) {
  if (PRERELEASE.test(String(name || ''))) return 'modern-input (pre-release)';
  const v = parseVersion(name);
  return v ? v.text : null;
}
function listIn(dir) {
  let names = [];
  try { names = fs.readdirSync(dir); } catch (e) { return []; }
  return names.filter((n) => PATTERN.test(n));
}
function engineZipIn(dir) {
  const name = pick(listIn(dir));
  return name ? path.join(dir, name) : null;
}

// Central-directory names, without extracting. Zip64 is followed when the
// classic end record is saturated. Returns null for a file that is not a zip.
function zipEntries(file) {
  let fd;
  try { fd = fs.openSync(file, 'r'); } catch (e) { return null; }
  try {
    const size = fs.fstatSync(fd).size;
    const tailLen = Math.min(size, 22 + 65535 + 20);
    const tail = Buffer.alloc(tailLen);
    fs.readSync(fd, tail, 0, tailLen, size - tailLen);
    let e = -1;
    for (let i = tailLen - 22; i >= 0; i--) if (tail.readUInt32LE(i) === 0x06054b50) { e = i; break; }
    if (e < 0) return null;
    let count = tail.readUInt16LE(e + 10), cdSize = tail.readUInt32LE(e + 12), cdOff = tail.readUInt32LE(e + 16);
    if (count === 0xffff || cdSize === 0xffffffff || cdOff === 0xffffffff) {
      const loc = e - 20;
      if (loc < 0 || tail.readUInt32LE(loc) !== 0x07064b50) return null;
      const z64Off = Number(tail.readBigUInt64LE(loc + 8));
      const z = Buffer.alloc(56);
      fs.readSync(fd, z, 0, 56, z64Off);
      if (z.readUInt32LE(0) !== 0x06064b50) return null;
      count = Number(z.readBigUInt64LE(32)); cdSize = Number(z.readBigUInt64LE(40)); cdOff = Number(z.readBigUInt64LE(48));
    }
    if (cdOff + cdSize > size) return null;
    const cd = Buffer.alloc(cdSize);
    fs.readSync(fd, cd, 0, cdSize, cdOff);
    const names = [];
    let p = 0;
    for (let k = 0; k < count && p + 46 <= cd.length; k++) {
      if (cd.readUInt32LE(p) !== 0x02014b50) return null;
      const nl = cd.readUInt16LE(p + 28), xl = cd.readUInt16LE(p + 30), cl = cd.readUInt16LE(p + 32);
      names.push(cd.slice(p + 46, p + 46 + nl).toString('utf8').replace(/\\/g, '/'));
      p += 46 + nl + xl + cl;
    }
    return names;
  } catch (err) {
    return null;
  } finally {
    fs.closeSync(fd);
  }
}

// ONE FILE OUT OF A ZIP, as bytes (stored or deflated, CRC checked); null when
// the zip or the entry cannot be read. A zip wrapped in one folder is read as
// the export flattens it: `name` is matched at the top or one folder down.
function readEntry(file, name) {
  const zlib = require('zlib');
  let fd;
  try { fd = fs.openSync(file, 'r'); } catch (e) { return null; }
  try {
    const size = fs.fstatSync(fd).size;
    const read = (len, at) => { const b = Buffer.alloc(len); fs.readSync(fd, b, 0, len, at); return b; };
    const tailLen = Math.min(size, 22 + 65535 + 20);
    const tail = read(tailLen, size - tailLen);
    let e = -1;
    for (let i = tailLen - 22; i >= 0; i--) if (tail.readUInt32LE(i) === 0x06054b50) { e = i; break; }
    if (e < 0) return null;
    let count = tail.readUInt16LE(e + 10), cdSize = tail.readUInt32LE(e + 12), cdOff = tail.readUInt32LE(e + 16);
    if (count === 0xffff || cdSize === 0xffffffff || cdOff === 0xffffffff) {
      const loc = e - 20;
      if (loc < 0 || tail.readUInt32LE(loc) !== 0x07064b50) return null;
      const z = read(56, Number(tail.readBigUInt64LE(loc + 8)));
      if (z.readUInt32LE(0) !== 0x06064b50) return null;
      count = Number(z.readBigUInt64LE(32)); cdSize = Number(z.readBigUInt64LE(40)); cdOff = Number(z.readBigUInt64LE(48));
    }
    if (cdOff + cdSize > size) return null;
    const cd = read(cdSize, cdOff);
    const want = String(name).toLowerCase();
    for (let p = 0, k = 0; k < count && p + 46 <= cd.length; k++) {
      if (cd.readUInt32LE(p) !== 0x02014b50) return null;
      const nl = cd.readUInt16LE(p + 28), xl = cd.readUInt16LE(p + 30), cl = cd.readUInt16LE(p + 32);
      const n = cd.slice(p + 46, p + 46 + nl).toString('utf8').replace(/\\/g, '/').toLowerCase();
      const hit = n === want || (n.endsWith('/' + want) && n.split('/').length === want.split('/').length + 1);
      if (hit) {
        const method = cd.readUInt16LE(p + 10), crc = cd.readUInt32LE(p + 16);
        let csize = cd.readUInt32LE(p + 20), usize = cd.readUInt32LE(p + 24), off = cd.readUInt32LE(p + 42);
        for (let x = p + 46 + nl, end = x + xl; x + 4 <= end;) {
          const id = cd.readUInt16LE(x), len = cd.readUInt16LE(x + 2);
          if (id === 0x0001) {
            let q = x + 4;
            if (usize === 0xffffffff) { usize = Number(cd.readBigUInt64LE(q)); q += 8; }
            if (csize === 0xffffffff) { csize = Number(cd.readBigUInt64LE(q)); q += 8; }
            if (off === 0xffffffff) off = Number(cd.readBigUInt64LE(q));
          }
          x += 4 + len;
        }
        const lh = read(30, off);
        if (lh.readUInt32LE(0) !== 0x04034b50) return null;
        const raw = read(csize, off + 30 + lh.readUInt16LE(26) + lh.readUInt16LE(28));
        const buf = method === 0 ? raw : (method === 8 ? zlib.inflateRawSync(raw) : null);
        if (!buf || buf.length !== usize) return null;
        if (typeof zlib.crc32 === 'function' && (zlib.crc32(buf) >>> 0) !== crc) return null;
        return buf;
      }
      p += 46 + nl + xl + cl;
    }
    return null;
  } catch (err) {
    return null;
  } finally {
    fs.closeSync(fd);
  }
}

// THE CONFIG FORMAT THE ZIP'S ENGINE READS, from its Ikemen_GO.exe's own
// strings (the file is read as data, never run). Upstream renamed the input
// sections while modern-input was a pre-release: the pre-release republished
// 2026-11-17 (07c692fb), which the web engine now follows too (plan 1.28),
// reads [ControllerMapping_*] / [ButtonSetup_*] and ButtonSetup.<device>; an
// earlier pre-release (9237c644) read [ButtonMapping_*] / [ControllerSetup_*]
// and ControllerSetup.<device>. 1.0.x reads [Keys_Pn] / [Joystick_Pn].
//   { id, mapping, setup, deviceKey }   id 'controller-mapping' (used) |
//                                        'button-mapping' (the earlier
//                                        pre-release: refused, the Studio
//                                        writes only the new names)
//   { id: 'keys' }                       the 1.0.x format: refused
//   null                                 no exe, or none of the names: refused
const FORMATS = [
  { id: 'controller-mapping', mapping: 'ControllerMapping', setup: 'ButtonSetup', deviceKey: 'ButtonSetup', marks: ['ControllerMapping_', 'ButtonSetup_'] },
  { id: 'button-mapping', mapping: 'ButtonMapping', setup: 'ControllerSetup', deviceKey: 'ControllerSetup', marks: ['ButtonMapping_', 'ControllerSetup_'] },
];
const formatCache = new Map();
function engineFormat(file) {
  let st;
  try { st = fs.statSync(file); } catch (e) { return null; }
  const key = path.resolve(file).toLowerCase() + '|' + st.size + '|' + st.mtimeMs;
  if (formatCache.has(key)) return formatCache.get(key);
  const exe = readEntry(file, 'Ikemen_GO.exe');
  let out = null;
  if (exe) {
    const has = (s) => exe.indexOf(Buffer.from(s, 'latin1')) >= 0;
    const f = FORMATS.find((x) => x.marks.every(has));
    if (f) out = { id: f.id, mapping: f.mapping, setup: f.setup, deviceKey: f.deviceKey };
    else if (has('Keys_P') && has('Joystick_P')) out = { id: 'keys' };
  }
  formatCache.set(key, out);
  return out;
}

// SECTIONS OF THE ENGINE'S OWN DEFAULT CONFIG, from the defaultConfig.ini its
// Ikemen_GO.exe carries (read as data, never run): { 'name': { key: value } },
// keys lower case, first value wins as in the engine's reader. The engine
// overlays the player's save/config.ini on these and writes the merged set back
// on every start, so a section the export never wrote can appear in the file
// with exactly these values (the Standard setup does). A name the exe does not
// carry exactly once is left out, never guessed.
const defaultsCache = new Map();
function defaultSections(file, names) {
  let st;
  try { st = fs.statSync(file); } catch (e) { return {}; }
  const key = path.resolve(file).toLowerCase() + '|' + st.size + '|' + st.mtimeMs + '|' + (names || []).join('|');
  if (defaultsCache.has(key)) return JSON.parse(defaultsCache.get(key));
  const exe = readEntry(file, 'Ikemen_GO.exe');
  const text = exe ? exe.toString('latin1') : null;
  const out = {};
  if (!text) return out;
  for (const name of names || []) {
    const head = '\n[' + name + ']\n';
    const at = text.indexOf(head);
    if (at < 0 || text.indexOf(head, at + 1) >= 0) continue;
    const body = text.slice(at + head.length, at + head.length + 4096).split('\0')[0];
    const sec = {};
    for (const raw of body.split(/\r?\n/)) {
      const l = raw.trim();
      if (/^\[/.test(l)) break;
      if (!l || l.startsWith(';')) continue;
      const kv = /^([^=]+?)\s*=\s*(.*?)\s*$/.exec(l);
      if (kv && !Object.prototype.hasOwnProperty.call(sec, kv[1].toLowerCase())) sec[kv[1].toLowerCase()] = kv[2];
    }
    if (Object.keys(sec).length) out[name.toLowerCase()] = sec;
  }
  defaultsCache.set(key, JSON.stringify(out));
  return out;
}

// WHAT A DESKTOP EXPORT READS OUT OF THE ENGINE. Required: the executable,
// the two scripts the menus run, and the common files every character's
// stcommon and every fight resolve against. `system.base.def` is 1.0's
// default screenpack file, `system.def` the older name - either will do.
// `training.zss` is optional: only the Training sandbox reads it, and the
// export copes without it.
const REQUIRED = [
  ['Ikemen_GO.exe', 'the engine itself'],
  // The modern-input layout: the Command List and controller art in one file
  // (the pre-release of 2026-11-17 folded the old input.sff into it).
  ['data/glyphs.sff', 'the controller and Command List pictures'],
  ['external/script/main.lua', 'the menus'],
  ['external/script/start.lua', 'the select screen and match setup'],
  ['data/common1.cns.zss', 'the common states every character falls back on'],
  ['data/common.const', 'the constants the common states name'],
  ['data/fight.def', 'the default lifebars'],
];
const EITHER = [[['data/system.base.def', 'data/system.def'], 'the default screenpack']];
const OPTIONAL = [['data/training.zss', 'the Training sandbox (Scene Viewer, Lock-On)'],
  ['external/gamecontrollerdb.txt', 'the button layout of pads SDL does not know by itself']];

function checkContents(names) {
  if (!Array.isArray(names)) return { readable: false, missing: [], optionalMissing: [], wrapper: null, entries: 0 };
  // Some releases wrap everything in one folder; the export flattens it
  // (desktop.js), so the check does too.
  let list = names.filter((n) => n && !n.endsWith('/'));
  const tops = new Set(list.map((n) => n.split('/')[0]));
  let wrapper = null;
  if (tops.size === 1 && list.every((n) => n.includes('/'))) {
    wrapper = [...tops][0];
    list = list.map((n) => n.slice(wrapper.length + 1));
  }
  const have = new Set(list.map((n) => n.toLowerCase()));
  const missing = REQUIRED.filter(([f]) => !have.has(f.toLowerCase())).map(([file, why]) => ({ file, why }));
  for (const [files, why] of EITHER) {
    if (!files.some((f) => have.has(f.toLowerCase()))) missing.push({ file: files.join(' or '), why });
  }
  const optionalMissing = OPTIONAL.filter(([f]) => !have.has(f.toLowerCase())).map(([file, why]) => ({ file, why }));
  return { readable: true, missing, optionalMissing, wrapper, entries: list.length };
}

// The whole report. `deps` is where the zips live, `exportDir` the desktop
// export folder (its save/.engine names the engine it was last built with).
function health(opts) {
  const o = opts || {};
  const deps = o.deps;
  const names = listIn(deps);
  const zips = names.map((n) => {
    let st = null;
    try { st = fs.statSync(path.join(deps, n)); } catch (e) { /* vanished */ }
    const u = usable(n);
    return { name: n, bytes: st ? st.size : 0, modified: st ? st.mtime.toISOString() : null, version: versionText(n), used: u.use, why: u.why };
  }).sort((a, b) => (a.used === b.used ? compare(b.name, a.name) : (a.used ? -1 : 1)));
  const picked = pick(names);
  const warnings = [];
  let contents = null;
  let format = null;
  if (!picked) {
    warnings.push({ level: 'bad', text: 'No usable engine zip in ' + deps + '. The desktop export needs upstream\'s official modern-input zip there (' + PRERELEASE_NAME + ', the GitHub pre-release branch-modern-input); the web build does not.' });
  } else {
    contents = checkContents(zipEntries(path.join(deps, picked)));
    if (!contents.readable) warnings.push({ level: 'bad', text: picked + ' is not a readable zip - a partial download? Download it again.' });
    else if (contents.missing.length) warnings.push({ level: 'bad', text: picked + ' is missing ' + contents.missing.map((m) => m.file).join(', ') + ' - the desktop export cannot build from it. Is this the Windows modern-input zip?' });
    if (contents.readable && contents.optionalMissing.length) warnings.push({ level: 'warn', text: picked + ' has no ' + contents.optionalMissing.map((m) => m.file).join(', ') + ' - ' + contents.optionalMissing.map((m) => m.why).join(', ') + ' will not work in the desktop build.' });
    if (contents.readable) {
      format = engineFormat(path.join(deps, picked));
      if (!format) warnings.push({ level: 'bad', text: picked + ': its Ikemen_GO.exe names none of the control sections the desktop export writes - an engine this Studio does not know, so the export refuses it.' });
      else if (format.id === 'keys') warnings.push({ level: 'bad', text: picked + ': its Ikemen_GO.exe reads the old controls ([Keys_Pn]), not the modern-input engine\'s - the export refuses it.' });
      else if (format.id === 'button-mapping') warnings.push({ level: 'bad', text: picked + ': its Ikemen_GO.exe is an earlier modern-input pre-release that reads [ButtonMapping_*] and [ControllerSetup_*]; the Studio writes [ControllerMapping_*] and [ButtonSetup_*] - download the current pre-release.' });
    }
  }
  for (const z of zips) if (!z.used) warnings.push({ level: 'warn', text: z.name + ' is not used: ' + z.why + '. Move it out of Dependencies so there is no doubt which engine a build has.' });
  const others = zips.filter((z) => z.used && z.name !== picked);
  const usableCount = others.length + 1;
  if (picked && others.length) warnings.push({ level: 'warn', text: usableCount + ' usable engine zips sit in Dependencies; the export uses ' + picked + '. Move the others out so there is no doubt which engine a build has.' });
  let exportFolder = null;
  if (o.exportDir) {
    let stamp = null;
    try { stamp = fs.readFileSync(path.join(o.exportDir, 'save', '.engine'), 'utf8').split(/\r?\n/)[0].trim() || null; } catch (e) { stamp = null; }
    const exe = fs.existsSync(path.join(o.exportDir, 'Ikemen_GO.exe'));
    const want = picked ? picked.replace(/\.zip$/i, '') : null;
    exportFolder = { dir: o.exportDir, stamp, exe, current: !!(stamp && want && stamp === want) };
    if (stamp && want && stamp !== want) warnings.push({ level: 'info', text: 'The desktop export folder was last built with ' + stamp + '; the next export replaces it with ' + want + '.' });
  }
  return { deps, zips, picked, version: picked ? versionText(picked) : null, format, contents, exportFolder, warnings,
    ok: !warnings.some((w) => w.level === 'bad') };
}

module.exports = { PATTERN, PRERELEASE, PRERELEASE_NAME, parseVersion, compare, usable, pick, versionText, listIn, engineZipIn,
  zipEntries, readEntry, engineFormat, defaultSections, FORMATS, checkContents, health, REQUIRED };
