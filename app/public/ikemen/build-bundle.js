// THE BUILD BUNDLE, in one place.
//
// A .wmbuild file is everything a browser's Mod Studio holds that the Build
// ID can see - every overlay file, bytes and all - plus the Studio's own
// lists and picks, so a friend can load it and boot to the same Build ID.
// The Studio writes and reads it through this module and the headless test
// reads it back the same way, so the writer and the reader cannot drift.
//
// Layout, mirroring the site's own pak + manifest (export.js):
//   bytes 0-3   magic 'WMB1'
//   bytes 4-7   u32 little-endian: length of the manifest in bytes
//   then        the manifest, UTF-8 JSON
//   then        every entry's raw bytes, back to back, in manifest order
//
// Manifest: { format:'wmbuild', version:1, site:{ stamp, pack },
//             buildId, files:{ vpath:[offset, length] }, settings:{ key:string } }
//
// Offsets count from the FIRST ENTRY BYTE, not from the start of the file.
// The manifest holds the offsets, so an offset that depended on the
// manifest's own length would be circular; a reader adds dataStart
// (8 + manifest length) and that is the whole arithmetic. Entries are stored
// as-is: sprites and audio are already compressed, so a deflate layer would
// cost CPU on both ends and shrink almost nothing, and a length-prefixed
// layout lets the importer read the header, then the manifest, then each
// entry on its own through File.slice without ever holding the whole file.
//
// Why not a .zip: the Studio has a zip READER for characters and nothing
// else, a writer would need CRC32 and a central directory for no gain, and
// a .zip dropped on the Characters zone IS a character. A magic of its own
// lets the drop zones recognize a bundle and hand it to Import instead.
//
// Settings ride as the RAW localStorage strings, and an absent key means the
// sender had none. Re-encoding them as JSON would need a per-key table of
// which are JSON and which are plain text (the theme pick, the menu-music
// picks), and a table like that falls behind the next key someone adds -
// the boot page's Reset was bitten by exactly that and now sweeps by prefix.
// A string round-trips verbatim and needs no table.
//
// Pure JS with no DOM, on purpose: node loads it for the test the same way
// the page does.
(function (root) {
  'use strict';
  const MAGIC = 'WMB1', FORMAT = 'wmbuild', VERSION = 1, EXT = '.wmbuild', HEADER = 8;

  // What the Studio keeps in localStorage that DESCRIBES THE BUILD. This is
  // the one list: the Studio packs these, the importer applies only these,
  // and anything else in a bundle's settings is dropped on both ends.
  //
  // Not here, on purpose: 'ikemen-mod-sizes' is a derived index the Studio's
  // add() wrapper rebuilds as the files land; 'ikemen-lite:advanced' is a UI
  // preference; 'ikemen-vfs11:*' are the engine's own saves (key bindings,
  // options); 'ikemen-netcode' and 'ikemen-aspect' are per-player choices;
  // and the online name is never part of a build. Match rules and the
  // menu-music picks are NOT hashed into the Build ID (the host's rules win
  // online, music cannot desync), but they are part of what a player calls
  // "my build", so they travel.
  const SETTING_KEYS = [
    'ikemen-mod-chars', 'ikemen-mod-stages', 'ikemen-mod-music', 'ikemen-lite-themes',
    'ikemen-mod-hidden-chars', 'ikemen-mod-hidden-stages',
    'ikemen-lite:layout', 'ikemen-lite:shipTune', 'ikemen-lite:motif', 'ikemen-lite:rules',
    'ikemen-lite:title-bgm', 'ikemen-lite:select-bgm',
  ];

  const byPath = (a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
  const isUint = (n) => typeof n === 'number' && Number.isInteger(n) && n >= 0;
  // A vpath is a relative, forward-slash path with no empty, '.' or '..'
  // segment - the shape every overlay key already has. A bundle is a file
  // somebody hands you, so a key that could climb out of the tree or alias
  // another is refused before it is written anywhere.
  function validVpath(p) {
    if (typeof p !== 'string' || !p || p.length > 1024) return false;
    if (p.indexOf('\\') >= 0 || p.indexOf('\0') >= 0 || p[0] === '/') return false;
    for (const seg of p.split('/')) if (!seg || seg === '.' || seg === '..') return false;
    return true;
  }
  // save/ is the player's own: options and key bindings the engine writes
  // back, persisted per browser and patched by the boot page's choices.
  // The Studio never writes it, and an overlay copy would shadow the
  // player's on every boot until Reset - so a bundle carrying one is
  // refused on both ends, before anything is written.
  function engineOwned(p) { return /^save\//i.test(p); }

  // entries: [[vpath, Uint8Array | Blob], ...] in any order; fields: { site:{stamp,
  // pack}, buildId, settings:{key:string} }. Returns the Blob parts (header,
  // manifest bytes, then every entry's own Uint8Array - nothing is copied,
  // so a big overlay costs no second copy in memory), the manifest it wrote,
  // and the byte sizes. Paths are sorted with the default sort, the same one
  // the Build ID uses, so the file and the hash walk the overlay in one order.
  function pack(entries, fields) {
    const sorted = (entries || []).filter((e) => e && e[0] && e[1]).slice().sort(byPath);
    const files = {};
    let off = 0;
    for (const [p, bytes] of sorted) {
      if (!validVpath(p)) throw new Error('not a valid path: ' + p);
      if (engineOwned(p)) throw new Error('engine-owned file, not part of a build: ' + p);
      if (files[p] !== undefined) throw new Error('duplicate entry: ' + p);
      // A Uint8Array or a Blob: the Studio wraps each entry in its own Blob
      // as it reads it, so the page never holds the whole overlay at once.
      const len = typeof bytes.length === 'number' ? bytes.length : bytes.size;
      if (!isUint(len)) throw new Error('entry without a length: ' + p);
      files[p] = [off, len];
      off += len;
    }
    const f = fields || {};
    const manifest = {
      format: FORMAT, version: VERSION,
      site: { stamp: String((f.site && f.site.stamp) || ''), pack: String((f.site && f.site.pack) || '') },
      buildId: String(f.buildId || ''),
      files,
      settings: {},
    };
    for (const k of SETTING_KEYS) {
      const v = f.settings ? f.settings[k] : undefined;
      if (typeof v === 'string') manifest.settings[k] = v;
    }
    const manBytes = new TextEncoder().encode(JSON.stringify(manifest));
    const header = new Uint8Array(HEADER);
    for (let i = 0; i < 4; i++) header[i] = MAGIC.charCodeAt(i);
    new DataView(header.buffer).setUint32(4, manBytes.length, true);
    const parts = [header, manBytes];
    for (const e of sorted) parts.push(e[1]);
    return { parts, manifest, size: HEADER + manBytes.length + off, dataLength: off };
  }

  // The first four bytes say whether this is ours at all - cheap enough to
  // ask of anything dropped on the page.
  function isBundle(bytes) {
    if (!bytes || bytes.length < 4) return false;
    for (let i = 0; i < 4; i++) if (bytes[i] !== MAGIC.charCodeAt(i)) return false;
    return true;
  }
  // bytes: at least the first 8 bytes of the file.
  function readHeader(bytes) {
    if (!isBundle(bytes)) throw new Error('not a build bundle (no ' + MAGIC + ' header)');
    if (bytes.length < HEADER) throw new Error('truncated build bundle');
    const len = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4, true);
    if (!len) throw new Error('truncated build bundle (no manifest)');
    return { manifestLength: len, dataStart: HEADER + len };
  }
  // bytes: exactly the manifest (file bytes 8 .. dataStart). Validates every
  // field the importer will act on and returns a cleaned copy: `paths` sorted,
  // `settings` filtered to SETTING_KEYS, `dataLength` = the end of the last
  // entry, so the caller can check the file is long enough before starting.
  function parseManifest(bytes) {
    let m;
    try { m = JSON.parse(new TextDecoder().decode(bytes)); } catch (e) { throw new Error('unreadable build bundle manifest'); }
    if (!m || typeof m !== 'object' || m.format !== FORMAT) throw new Error('not a build bundle manifest');
    if (!isUint(m.version) || m.version < 1) throw new Error('build bundle has no format version');
    // A newer Studio may add fields this one cannot honor; guessing at them
    // would import a build that then does not match the sender's.
    if (m.version > VERSION) throw new Error('this bundle was made by a newer version of the Studio (format ' + m.version + '; this site reads ' + VERSION + ') - both of you need the same site version');
    if (!m.files || typeof m.files !== 'object' || Array.isArray(m.files)) throw new Error('build bundle has no file table');
    const files = {};
    let end = 0;
    const paths = Object.keys(m.files).sort();
    for (const p of paths) {
      const v = m.files[p];
      if (!validVpath(p)) throw new Error('build bundle names an invalid path: ' + p);
      if (engineOwned(p)) throw new Error('build bundle carries an engine-owned file (' + p + ') - refused');
      if (!Array.isArray(v) || v.length !== 2 || !isUint(v[0]) || !isUint(v[1])) throw new Error('build bundle has a bad entry for ' + p);
      files[p] = [v[0], v[1]];
      if (v[0] + v[1] > end) end = v[0] + v[1];
    }
    const settings = {};
    const s = (m.settings && typeof m.settings === 'object') ? m.settings : {};
    for (const k of SETTING_KEYS) if (typeof s[k] === 'string') settings[k] = s[k];
    return {
      format: FORMAT, version: m.version,
      site: { stamp: String((m.site && m.site.stamp) || ''), pack: String((m.site && m.site.pack) || '') },
      buildId: String(m.buildId || ''),
      files, paths, settings, dataLength: end,
    };
  }
  // Absolute byte range of one entry in the file - what File.slice wants.
  function entryRange(header, manifest, vpath) {
    const v = manifest.files[vpath];
    if (!v) throw new Error('not in the bundle: ' + vpath);
    return { start: header.dataStart + v[0], end: header.dataStart + v[0] + v[1], length: v[1] };
  }
  // Whole-file read, for node and for a bundle already in memory: the header,
  // the cleaned manifest and the entries as views into `bytes` (no copies),
  // sorted by path like the writer wrote them.
  function unpack(bytes) {
    const header = readHeader(bytes);
    if (bytes.length < header.dataStart) throw new Error('truncated build bundle (manifest cut short)');
    const manifest = parseManifest(bytes.subarray(HEADER, header.dataStart));
    if (bytes.length < header.dataStart + manifest.dataLength) throw new Error('truncated build bundle (' + bytes.length + ' of ' + (header.dataStart + manifest.dataLength) + ' bytes)');
    const entries = manifest.paths.map((p) => {
      const r = entryRange(header, manifest, p);
      return [p, bytes.subarray(r.start, r.end)];
    });
    return { header, manifest, entries };
  }

  const api = { MAGIC, FORMAT, VERSION, EXT, SETTING_KEYS, validVpath, pack, isBundle, readHeader, parseManifest, entryRange, unpack };
  root.ikemenBuildBundle = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
