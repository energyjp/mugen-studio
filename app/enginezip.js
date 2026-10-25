'use strict';
// THE ENGINE ZIP, CHECKED.
//
// The desktop export builds against the official `Ikemen_GO-<version>-windows.zip`
// sitting in Dependencies (layout.DEPS). Three places picked it with the same
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
//   health()               everything above plus the export folder's stamp
//
// Only fs and path: layout.js requires this, so it must require nothing back.
const fs = require('fs');
const path = require('path');

const PATTERN = /^Ikemen_GO-.*windows.*\.zip$/i;

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
// The name the export will use, from a list of file names; null when none match.
function pick(names) {
  const zips = (names || []).filter((n) => PATTERN.test(n));
  if (!zips.length) return null;
  return zips.slice().sort(compare).pop();
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

// WHAT A DESKTOP EXPORT READS OUT OF THE ENGINE. Required: the executable,
// the two scripts the menus run, and the common files every character's
// stcommon and every fight resolve against. `system.base.def` is 1.0's
// default screenpack file, `system.def` the older name - either will do.
// `training.zss` is optional: only the Training sandbox reads it, and the
// export copes without it.
const REQUIRED = [
  ['Ikemen_GO.exe', 'the engine itself'],
  ['external/script/main.lua', 'the menus'],
  ['external/script/start.lua', 'the select screen and match setup'],
  ['data/common1.cns.zss', 'the common states every character falls back on'],
  ['data/common.const', 'the constants the common states name'],
  ['data/fight.def', 'the default lifebars'],
];
const EITHER = [[['data/system.base.def', 'data/system.def'], 'the default screenpack']];
const OPTIONAL = [['data/training.zss', 'the Training sandbox (Scene Viewer, Lock-On)']];

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
    const v = parseVersion(n);
    return { name: n, bytes: st ? st.size : 0, modified: st ? st.mtime.toISOString() : null, version: v ? v.text : null };
  }).sort((a, b) => compare(b.name, a.name));
  const picked = pick(names);
  const byName = names.slice().sort().reverse()[0] || null;
  const warnings = [];
  let contents = null;
  if (!picked) {
    warnings.push({ level: 'bad', text: 'No engine zip in ' + deps + '. The desktop export needs the official Ikemen_GO-<version>-windows.zip there; the web build does not.' });
  } else {
    contents = checkContents(zipEntries(path.join(deps, picked)));
    if (!contents.readable) warnings.push({ level: 'bad', text: picked + ' is not a readable zip - a partial download? Download it again.' });
    else if (contents.missing.length) warnings.push({ level: 'bad', text: picked + ' is missing ' + contents.missing.map((m) => m.file).join(', ') + ' - the desktop export cannot build from it. Is this the Windows release zip?' });
    if (contents.readable && contents.optionalMissing.length) warnings.push({ level: 'warn', text: picked + ' has no ' + contents.optionalMissing.map((m) => m.file).join(', ') + ' - ' + contents.optionalMissing.map((m) => m.why).join(', ') + ' will not work in the desktop build.' });
    if (names.length > 1) warnings.push({ level: 'warn', text: names.length + ' engine zips sit in Dependencies; the export uses ' + picked + ' (the newest version). Move the others out so there is no doubt which engine a build has.' });
    if (byName && byName !== picked) warnings.push({ level: 'warn', text: 'Sorting by file name would have picked ' + byName + '; by version it is ' + picked + '.' });
  }
  let exportFolder = null;
  if (o.exportDir) {
    let stamp = null;
    try { stamp = fs.readFileSync(path.join(o.exportDir, 'save', '.engine'), 'utf8').trim(); } catch (e) { stamp = null; }
    const exe = fs.existsSync(path.join(o.exportDir, 'Ikemen_GO.exe'));
    const want = picked ? picked.replace(/\.zip$/i, '') : null;
    exportFolder = { dir: o.exportDir, stamp, exe, current: !!(stamp && want && stamp === want) };
    if (stamp && want && stamp !== want) warnings.push({ level: 'info', text: 'The desktop export folder was last built with ' + stamp + '; the next export replaces it with ' + want + '.' });
  }
  return { deps, zips, picked, version: picked ? (parseVersion(picked) || {}).text || null : null, contents, exportFolder, warnings,
    ok: !warnings.some((w) => w.level === 'bad') };
}

module.exports = { PATTERN, parseVersion, compare, pick, listIn, engineZipIn, zipEntries, checkContents, health, REQUIRED };
