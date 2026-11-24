'use strict';
// THE HEADER'S BUILD SIZE, FOR THE EXPORT THAT IS PICKED.
//
// The Studio's own index (vfslib.build() with no options) holds every
// screenpack in themes/ so it can list and preview them, and the header used
// to sum it: 707 MB for a website that shipped 457 MB, because two packs
// that never ship (250 MB) were counted. Each figure here is what that export
// actually writes, measured with the exporter's own choices:
//
//   web      vfslib.build() with export.js's options (one screenpack, the
//            public roster for a Public build) + the engine (.wasm) it copies.
//            Exact: the same file set the pack is written from.
//   lite     not knowable without compressing (minutes). The ratio of the
//            last lite export in the same folder (game.lite against what that
//            build held), applied to today's website figure; with no earlier
//            lite export, a third (what a lite build typically comes to).
//            Always called an estimate. Unchanged content gives the exact
//            game.lite size back.
//   desktop  desktop.js's content - characters, stages, music, the chosen
//            screenpack, the same keep filters - plus the engine zip it
//            unpacks whole. About: the export adds a few small files of its
//            own (the Training add-ons, configs) and replaces some of the zip's.
//
// Read-only: nothing is written, nothing is compressed.
const fs = require('fs');
const path = require('path');
const vfslib = require('./vfslib');
const layout = require('./layout');

const LITE_TYPICAL = 1 / 3;

function sizeOfEntry(built, vpath, abs) {
  if (abs === null || abs === undefined) {
    const g = built.generated && built.generated[vpath];
    return g ? (g.length || 0) : 0;
  }
  try { return fs.statSync(abs).size; } catch (e) { return 0; }
}

// vpath -> bytes for every file a build would write (generated files count once).
function sizes(built) {
  const out = new Map();
  for (const [vpath, abs] of built.index) out.set(vpath, sizeOfEntry(built, vpath, abs));
  for (const [vpath, buf] of Object.entries(built.generated || {})) {
    if (!out.has(vpath)) out.set(vpath, buf ? (buf.length || 0) : 0);
  }
  return out;
}
const sum = (m) => { let t = 0; for (const n of m.values()) t += n; return t; };

// export.js: the screenpack folder the roster's motif names is the only one kept.
function themeFolder(roster) {
  return String(roster.motif || '').replace(/^data\//, '').split('/')[0].toLowerCase();
}

// export.js exportSite's build() call, option for option.
function webBuild(isPublic) {
  const roster = vfslib.readRoster();
  const tf = themeFolder(roster);
  return vfslib.build({ publicOnly: !!isPublic, privateMenu: !isPublic, web: true, __themesKeep: tf ? new Set([tf]) : null });
}

function wasmBytes() {
  const name = process.env.IKEMEN_V2 ? 'ikemen-v2.wasm' : 'ikemen.wasm';
  try { return fs.statSync(path.join(vfslib.IKEMEN_SRC, 'bin', name)).size; } catch (e) { return 0; }
}

function web(isPublic) {
  const m = sizes(webBuild(isPublic));
  const engine = wasmBytes();
  const content = sum(m);
  return { kind: 'web', public: !!isPublic, total: content + engine, content, engine, files: m.size, exact: true, byPath: m };
}

// The folder a default Website export writes (export.js exportSite's defName).
function defaultWebFolder(isPublic) {
  const v2 = !!process.env.IKEMEN_V2;
  return path.join(layout.WEBSITE_EXPORT, 'dist-pack' + (v2 ? '-v2' : '') + (layout.EXPORT_SUFFIX || '') + (isPublic ? '-public' : ''));
}

// The last lite export there, as a ratio: game.lite's bytes against what that
// build held. Its manifest lists each file at its rebuilt size (an SFF with PNG
// sprites can be written again a little bigger), so a file today's build still
// has counts at today's size - unchanged content then gives the same total the
// lite step started from - and only a file gone since counts at the manifest's.
function lastLite(folder, todayByPath, engine) {
  try {
    const man = JSON.parse(fs.readFileSync(path.join(folder, 'ikemen-fs', 'manifest.json'), 'utf8'));
    if (!man.lite) return null;
    const st = fs.statSync(path.join(folder, 'ikemen-fs', man.lite));
    let before = engine;
    for (const [vpath, v] of Object.entries(man.files || {})) {
      before += todayByPath.has(vpath) ? todayByPath.get(vpath) : (Array.isArray(v) ? (v[1] || 0) : (Number(v) || 0));
    }
    if (!before || !st.size) return null;
    return { ratio: st.size / before, bytes: st.size, at: st.mtime.toISOString(), folder };
  } catch (e) { return null; }
}

function lite(isPublic) {
  const w = web(isPublic);
  const last = lastLite(defaultWebFolder(isPublic), w.byPath, w.engine);
  const ratio = last ? last.ratio : LITE_TYPICAL;
  return {
    kind: 'lite', public: !!isPublic, total: Math.round(w.total * ratio), unpacked: w.total, content: w.content, files: w.files,
    exact: false, ratio, from: last ? { bytes: last.bytes, at: last.at } : null,
  };
}

// The engine zip's files and their unpacked sizes (desktop.js Expand-Archive
// takes all of it): the central directory, Zip64 followed. [name, bytes] per
// file, '/' separators, folders left out; null for a file that is not a zip.
function zipFileSizes(file) {
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
      const z = Buffer.alloc(56);
      fs.readSync(fd, z, 0, 56, Number(tail.readBigUInt64LE(loc + 8)));
      if (z.readUInt32LE(0) !== 0x06064b50) return null;
      count = Number(z.readBigUInt64LE(32)); cdSize = Number(z.readBigUInt64LE(40)); cdOff = Number(z.readBigUInt64LE(48));
    }
    if (cdOff + cdSize > size) return null;
    const cd = Buffer.alloc(cdSize);
    fs.readSync(fd, cd, 0, cdSize, cdOff);
    const out = [];
    let p = 0;
    for (let k = 0; k < count && p + 46 <= cd.length; k++) {
      if (cd.readUInt32LE(p) !== 0x02014b50) return null;
      let n = cd.readUInt32LE(p + 24);
      const nl = cd.readUInt16LE(p + 28), xl = cd.readUInt16LE(p + 30), cl = cd.readUInt16LE(p + 32);
      if (n === 0xffffffff) {
        // Zip64 extra field: the uncompressed size comes first.
        let x = p + 46 + nl;
        const end = x + xl;
        while (x + 4 <= end) {
          const id = cd.readUInt16LE(x), len = cd.readUInt16LE(x + 2);
          if (id === 0x0001 && len >= 8) { n = Number(cd.readBigUInt64LE(x + 4)); break; }
          x += 4 + len;
        }
      }
      const name = cd.slice(p + 46, p + 46 + nl).toString('utf8').replace(/\\/g, '/');
      if (!name.endsWith('/')) out.push([name, n]);
      p += 46 + nl + xl + cl;
    }
    return out;
  } catch (err) {
    return null;
  } finally {
    fs.closeSync(fd);
  }
}
function zipUnpackedBytes(file) {
  let t = 0;
  for (const [, n] of zipFileSizes(file) || []) t += n;
  return t;
}

// desktop.js: characters (chars/), stages (stages/), all of music/ (sound/) and
// the chosen screenpack (data/<folder>/) go in beside the engine. The rest of
// a website build's data/ is the web engine's own layer, which a desktop
// build takes from the engine zip instead. A screenpack that is the engine
// release's own (not one added under themes/) goes in without its logo and
// intro storyboards, so the engine's stay.
//
// The engine counts as the zip's files the export leaves in place: chars/ is
// emptied and filled from the roster, and a file the export writes over one
// of the zip's (a stage, the screenpack) counts once, as the export's.
function desktop() {
  const roster = vfslib.readRoster();
  const tf = themeFolder(roster);
  const m = sizes(vfslib.build({ desktop: true, __themesKeep: tf ? new Set([tf]) : null }));
  const fromRelease = !!tf && !fs.existsSync(path.join(layout.dir('themes'), tf));
  const own = new Set();
  let content = 0, files = 0;
  for (const [vpath, n] of m) {
    const low = vpath.toLowerCase();
    const pack = !!tf && low.startsWith('data/' + tf + '/');
    if (!(/^(chars|stages|sound)\//.test(low) || pack)) continue;
    if (pack && fromRelease && /^(logo|intro)\.[^/]+$/.test(low.slice(('data/' + tf + '/').length))) continue;
    own.add(low); content += n; files++;
  }
  const zip = layout.engineZip();
  let list = zip ? zipFileSizes(zip) || [] : [];
  // a zip wrapped in one folder unpacks flattened (desktop.js)
  const tops = new Set(list.map(([n]) => n.split('/')[0]));
  if (tops.size === 1 && list.every(([n]) => n.includes('/'))) list = list.map(([n, b]) => [n.slice(n.indexOf('/') + 1), b]);
  let engine = 0, engineFiles = 0;
  for (const [n, b] of list) {
    const low = n.toLowerCase();
    if (low.startsWith('chars/') || own.has(low)) continue;
    engine += b; engineFiles++;
  }
  return { kind: 'desktop', total: content + engine, content, engine, files: files + engineFiles, exact: false, engineZip: zip ? path.basename(zip) : null };
}

// What /api/build-size answers. byPath stays on the server.
function forExport(kind, opts = {}) {
  if (kind === 'desktop') return desktop();
  if (kind === 'lite') return lite(opts.public);
  const w = web(opts.public);
  delete w.byPath;
  return w;
}

module.exports = { forExport, web, lite, desktop, zipFileSizes, zipUnpackedBytes, LITE_TYPICAL };
