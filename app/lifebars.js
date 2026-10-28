'use strict';
//
// LIFEBARS AND FIGHT EFFECTS, MIXED PER BUNDLE.
//
// A screenpack's fight screen - its fight def and everything that def's
// [Files] names - is the one part of a screenpack the engine keeps apart from
// the menus: its own sprite file, sounds, fonts, animations and coordinate
// space. Lifebars are downloaded and swapped on their own for exactly that
// reason (the MUGEN way: point the motif's `fight =` at another def). This
// module gives a bundle three independent choices on the Theme tab:
//
//   lifebars      the fight def itself: bars, portraits, names, timer, combo
//                 counter, round announcer, win icons
//   hit sparks    fightfx.sff + fightfx.air + [FightFx] scale, the global 'F'
//                 effects every character's hits draw
//   hit sounds    common.snd, the global 'F' sound bank
//
// plus the round clock ([Time] framespercount), which is a match rule riding
// in the lifebar file and so is kept at the screenpack's value unless asked.
//
// WHERE LIFEBARS COME FROM. Every lifebar a bundle can use sits in its own
// library, Content/<bundle>/lifebars/<slug>/, with a lifebar.json manifest.
// It gets there by INSTALL (a downloaded zip or folder) or by LIFT (the fight
// screen of any installed screenpack in any bundle, or the engine's own).
// Either way only the def and the files it needs are copied, placed so every
// one of them resolves from the def's own folder - which is the first place
// the engine looks for a fight def's files. Nothing outside the bundle is ever
// read at build time, and nothing in the library is ever modified: every
// change the mix needs is made in the COMPOSED def the exports ship.
//
// HOW THE ENGINE READS A FIGHT DEF (ikemen-go-src, Ikemen GO 1.0 and the fork
// alike - the fork's fightscreen.go differs only by facePalShared):
//
//  * The motif's [Files] `fight` value is searched in the motif folder, the
//    build root, then data/ (fightscreen.go:5949-5972). A value that does not
//    resolve stops the game at boot ("Can't load fight screen").
//  * Every [Files] entry of the def is searched in the def's own folder, the
//    motif folder, the build root, data/ - fonts also probe font/ in each
//    (fightscreen.go:4856-4977). Only the FIRST [Files] section is read.
//  * sff, snd, fightfx.sff, fightfx.air, common.snd and fx1..fx3 that fail to
//    load are FATAL. A missing font is only logged (invisible text), except a
//    bitmap font .def whose File= glyph SFF is missing: that panics
//    (font.go:411-418).
//  * A def with no [Info] localcoord takes the MOTIF's localcoord
//    (fightscreen.go:4807-4820). An [Info] section at the top fixes it: the
//    pre-scan stops at the first [Info].
//  * Fourteen sections are never seeded and a def lacking one nil-panics at
//    match start (fightscreen.go:4775-4800, 5616-5671): see REQUIRED.
//  * [FightFx] scale sizes every F effect relative to the fight screen WIDTH
//    (char.go:7426-7439): spark size goes as scale / localcoord width, so a
//    donor's sparks keep their size in another lifebar at
//    scale * W_target / W_donor.
//  * [Time] framespercount sets the length of a clock count (default 60,
//    fightscreen.go:2344); round time = option x framespercount.
//  * face.spr names a sprite in each CHARACTER's own file.
//
// add004 BUILDS draw their lifebars from COMMON STATES, not from the fight
// def (their def stubs every bar at 0,0 with no face). Such a def is refused
// as a lifebar. And when a bundle that IS an add004 build takes a lifebar from
// the library, add004's own lifebar, power bar, combo counter, round call, KO
// call and portraits are switched off in the copy of its common states the
// build ships - its System_Switch block has a documented flip line for each -
// so the two HUDs do not draw over each other. Its bar helper's NoBarDisplay
// (which hides the engine's HUD outside the fight phase, because add004 draws
// its own) is tied to add004's lifebar bit in the same copies.

const fs = require('fs');
const path = require('path');
const os = require('os');

function layout() { return require('./layout.js'); }
function lifebarMod() { return require('./lifebar.js'); }

const LIBRARY = 'lifebars';
const MANIFEST = 'lifebar.json';
const MIX_KEY = 'lifebarMix';
// The folders a composed build uses inside the active motif folder. One name in
// both exports, so the website build and the desktop export agree by path.
const MOUNT_DIR = 'studio-lifebar';
const PARTS_DIR = 'studio-parts';

// The sections the engine dereferences without a nil check (see above).
const REQUIRED = ['lifebar', 'powerbar', 'face', 'name', 'simul lifebar', 'simul face', 'simul name',
  'turns lifebar', 'turns face', 'turns name', 'time', 'combo', 'round', 'winicon'];
const REQUIRED_LABEL = (id) => '[' + id.replace(/(^|\s)([a-z])/g, (m, a, b) => a + b.toUpperCase()).replace('Winicon', 'WinIcon') + ']';
// [Files] keys whose failure kills the fight screen, and the soft ones.
const FATAL_KEYS = /^(sff|snd|fightfx\.sff|fightfx\.air|common\.snd|fx[1-3])$/;
const FONT_KEY = /^font(\d+)$/;
// ONLY GAME DATA IS COPIED into a library, whatever a def names: each kind of
// [Files] value has the file types the engine reads for it, and a value that
// reaches anything else counts as not there. An allow-list, because the list
// of things Windows will run is longer than any deny-list (.vbe, .pif, .msc
// ...). .txt is allowed for animations: real packs ship fightfx.air as one.
const ALLOW = {
  sff: /\.sff$/i,
  snd: /\.snd$/i,
  air: /\.(air|txt)$/i,
  fx: /\.def$/i,
  font: /\.(def|fnt|ttf|otf|ttc)$/i,
  glyph: /\.(sff|ttf|otf|ttc)$/i,
};
const KIND_OF = { sff: 'sff', 'fightfx.sff': 'sff', snd: 'snd', 'common.snd': 'snd', 'fightfx.air': 'air', fx1: 'fx', fx2: 'fx', fx3: 'fx' };
const kindOfKey = (key) => KIND_OF[key] || (/^font\d+$/.test(key) ? 'font' : null);
// Every file in a library is one of those; a backstop for older manifests.
const GAME_FILE = /\.(def|sff|snd|air|txt|fnt|ttf|otf|ttc)$/i;
const SKIP_DIR = /^(portraits?|__macosx|\.git)$/i;
// The [Files] keys a download may leave to the engine's own data/ (every
// build ships data/fightfx.sff, fightfx.air and common.snd, and the engine
// searches data/ last): the files are copied in, so the pack stays whole.
const ENGINE_FX_KEYS = ['fightfx.sff', 'fightfx.air', 'common.snd'];
// Ikemen's player selectors in a fight def key: p1., p*., p1|p2. ...
// (resolveLifebarPrefixOperators, common.go:919-983).
const SEL = '(?:p\\*|p\\d+|(?:p(?:\\d+|\\*)\\|)+p(?:\\d+|\\*))';
const selHas = (sel, players) => String(sel).split('|').some((p) => p === 'p*' || players.includes(p));
// A key with a space in its name is not a selector key: the engine's INI
// reader ends a key name at the first space (common.go:1007-1009), so
// `p1 | p2.bg0.spr` is the key `p1` to it. Ids are matched as readDef gives them.
const tightId = (id) => String(id);

// ---- small helpers --------------------------------------------------------

const readText = (p) => { try { return fs.readFileSync(p, 'latin1'); } catch (e) { return null; } };
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch (e) { return false; } };
const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch (e) { return false; } };
const sizeOf = (p) => { try { return fs.statSync(p).size; } catch (e) { return 0; } };
const unq = (v) => String(v == null ? '' : v).trim().replace(/^"(.*)"$/, '$1').trim();
const posix = (p) => String(p || '').replace(/\\/g, '/');
const round4 = (n) => Math.round(n * 10000) / 10000;
const slugify = (name) => (String(name || '').replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'lifebar');

function numPair(v) {
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/.exec(String(v || ''));
  return m ? [Number(m[1]), Number(m[2])] : null;
}

// A path under `base`, matched one segment at a time without regard to case -
// the engine's own FileExist falls back to a case-insensitive glob
// (common.go:548-570), so a pack that writes `font/QoH-small.def` for
// QoH-Small.def works in the game and must work here. Returns the path as the
// disk spells it, or null. `..` is followed; the result may leave `base`.
function findCI(base, rel) {
  const parts = posix(rel).split('/').filter((s) => s && s !== '.');
  if (!parts.length) return null;
  let cur = base;
  for (const seg of parts) {
    if (seg === '..') { cur = path.dirname(cur); continue; }
    let ents;
    try { ents = fs.readdirSync(cur, { withFileTypes: true }); } catch (e) { return null; }
    const hit = ents.find((e) => e.name === seg) || ents.find((e) => e.name.toLowerCase() === seg.toLowerCase());
    if (!hit) return null;
    cur = path.join(cur, hit.name);
  }
  return cur;
}

// Is `p` inside `dir` (or `dir` itself)?
function inside(dir, p) {
  const r = path.relative(dir, p);
  return r === '' || (!r.startsWith('..') && !path.isAbsolute(r));
}

// Is `p` inside one of `dirs`, compared by REAL path - so a junction or link
// inside a pack cannot reach a file outside it. `dirs` null means no bound.
const realOf = (p) => { try { return fs.realpathSync.native(p); } catch (e) { try { return fs.realpathSync(p); } catch (e2) { return path.resolve(p); } } };
function insideAny(dirs, p) {
  if (!dirs) return true;
  const rp = realOf(p);
  return [].concat(dirs).some((d) => d && inside(realOf(d), rp));
}

// ---- reading a fight def --------------------------------------------------

function sectionIds(text) {
  const out = new Set();
  const lb = lifebarMod();
  for (const l of lb.lineIndex(text)) {
    const s = lb.sectionOf(text.slice(l.start, l.end));
    if (s) out.add((s.name + s.sub).toLowerCase().trim().replace(/\s+/g, ' '));
  }
  return out;
}

// Is this .def a fight screen? A [Files] with an `sff` key and at least one of
// the sections only a fight def has. Look-alikes are ruled out by the sections
// they carry: a motif (menus), a storyboard, a font, a FightFx pack.
function isFightDef(text) {
  const t = String(text || '');
  const ids = sectionIds(t);
  if (!ids.has('files')) return false;
  if (ids.has('select info') || ids.has('title info') || ids.has('scenedef') || ids.has('fnt v2')
    || ids.has('stageinfo') || ids.has('camera') || ids.has('bgdef')) return false;
  const lb = lifebarMod();
  const read = lb.readDef(t);
  if (!read.keys.has('files|sff')) return false;
  if (read.keys.has('info|prefix')) return false;               // a FightFx pack
  // Any fight-screen section, team variants included ([Tag Lifebar] counts).
  const TEAM = /^(?:(?:simul|simul_3p|simul_4p|tag|tag_2p|tag_3p|tag_4p|turns) )?(?:lifebar|powerbar|guardbar|stunbar|face|name)$/;
  return [...ids].some((s) => TEAM.test(s) || s === 'time' || s === 'combo' || s === 'round' || s === 'winicon');
}

// Everything the mix needs to know about a def, read the way the engine reads
// it: the first section of each kind, the first copy of each key.
function readDefInfo(text) {
  const lb = lifebarMod();
  const read = lb.readDef(String(text || ''));
  const get = (sec, key) => { const k = read.keys.get(sec + '|' + key); return k ? k.raw : null; };
  const files = new Map();
  for (const [id, v] of read.keys) {
    const m = /^files\|(.+)$/.exec(id);
    if (m) files.set(m[1], unq(v.raw));
  }
  const faces = [];
  const faceRe = new RegExp('^([a-z_0-9 ]*face)\\|((?:' + SEL + '\\.)?(?:teammate\\.)?face\\.spr)$');
  for (const [id, v] of read.keys) {
    const m = faceRe.exec(tightId(id));
    if (!m) continue;
    const pair = numPair(v.raw);
    if (!pair || pair[0] < 0) continue;
    const key = pair[0] + ',' + pair[1];
    if (!faces.includes(key)) faces.push(key);
  }
  const lc = numPair(get('info', 'localcoord'));
  const scaleRaw = get('fightfx', 'scale');
  const fpc = get('time', 'framespercount');
  return {
    name: unq(get('info', 'name') || '') || null,
    author: unq(get('info', 'author') || '') || null,
    localcoord: lc && lc[0] > 0 && lc[1] > 0 ? lc : null,
    sections: new Set(read.sections.keys()),
    files,
    fightfx: {
      sff: files.get('fightfx.sff') || null,
      air: files.get('fightfx.air') || null,
      scale: scaleRaw !== null && isFinite(Number(unq(scaleRaw))) ? Number(unq(scaleRaw)) : null,
    },
    commonSnd: files.get('common.snd') || null,
    framespercount: fpc !== null && isFinite(parseInt(unq(fpc), 10)) ? parseInt(unq(fpc), 10) : null,
    faces,
    read,
  };
}

// Are the bars stubs? add004's defs park every bar at 0,0 with nothing to draw
// and set every face to -1: the HUD is drawn by its common states instead.
// A key may name its players with Ikemen's selectors (p*., p1|p2.), which the
// engine expands for p1 and p2; those count the same as p1./p2.
function barsAreStubs(info) {
  const keys = info.read.keys;
  const barRe = new RegExp('^lifebar\\|(' + SEL + ')\\.(bg0|bg1|bg2|mid|front)\\.(spr|anim)$');
  const faceRe = new RegExp('^face\\|(' + SEL + ')\\.face\\.spr$');
  let bars = 0;
  for (const [id, v] of keys) {
    const m = barRe.exec(tightId(id));
    if (!m || !selHas(m[1], ['p1', 'p2'])) continue;
    const p = numPair(v.raw);
    const n = parseInt(unq(v.raw), 10);
    if ((p && p[0] >= 0) || (m[3] === 'anim' && isFinite(n) && n >= 0)) bars++;
  }
  if (bars) return false;
  for (const [id, v] of keys) {
    const m = faceRe.exec(tightId(id));
    if (!m || !selHas(m[1], ['p1', 'p2'])) continue;
    const p = numPair(v.raw);
    if (p && p[0] >= 0) return false;
  }
  return true;
}

// An add004 common-states file: its header or its lifebar helper's statedef.
function isAdd004States(text) {
  return /addoo4/i.test(String(text || '').slice(0, 4096)) || /^\s*\[\s*statedef\s+90900\s*\]/im.test(String(text || ''));
}

function add004Nearby(defAbs, stopAt) {
  let d = path.dirname(defAbs);
  for (let i = 0; i < 6; i++) {
    let ents = [];
    try { ents = fs.readdirSync(d); } catch (e) { ents = []; }
    for (const n of ents) {
      if (!/\.(cns|st)$/i.test(n)) continue;
      const t = readText(path.join(d, n));
      if (t && isAdd004States(t)) return path.join(d, n);
    }
    if (!stopAt || !inside(stopAt, d) || path.resolve(d) === path.resolve(stopAt)) break;
    d = path.dirname(d);
  }
  return null;
}

// ---- the closure of one def -------------------------------------------------
//
// Every file the engine would load for this def, resolved the way it resolves
// them, and the place each lands in the library so that it resolves from the
// def's OWN folder there. `roots` are the engine's later search roots for the
// source install (motif folder, build root, data/), in order.
// `confine`: the folders no file may come from, compared by real path (a
// download is only its own files; a lift is its bundle and the engine's). A
// value reaching outside them counts as missing.
// `claims`: the library places this pack's other defs already took (lowercased
// place -> source file), so two different files never share one.
function closure(defAbs, scanRoot, roots, confine, claims) {
  const defDir = path.dirname(defAbs);
  const defRel = posix(path.relative(scanRoot, defAbs));
  const defRelDir = path.posix.dirname(defRel) === '.' ? '' : path.posix.dirname(defRel);
  const text = readText(defAbs) || '';
  const info = readDefInfo(text);
  const eng = engineRoots();
  const claimed = new Map(claims || []);
  const out = { files: [], missing: [], soft: [], renames: {}, panics: [], keyDest: {}, engineFx: [], engineFiles: [] };
  const same = (a, b) => realOf(a).toLowerCase() === realOf(b).toLowerCase();
  // Take a library place for a file. False when a different file holds it.
  const claim = (src, dest) => {
    const k = dest.toLowerCase();
    const had = claimed.get(k);
    if (had && !same(had, src)) return false;
    claimed.set(k, src);
    return true;
  };
  const put = (src, dest) => {
    if (!GAME_FILE.test(dest)) return;
    if (!out.files.some((f) => f.dest.toLowerCase() === dest.toLowerCase())) out.files.push({ src, dest });
  };
  claim(defAbs, defRel);
  put(defAbs, defRel);
  const climbsOut = (p) => p === '..' || p.startsWith('../') || p.startsWith('/') || /^[a-z]:/i.test(p);
  // Where a file found at `abs` for value `v` lands, relative to the pack.
  // `relDir` is the pack-relative folder of the file that names it. The
  // engine reads `v` from that folder first, so the file goes exactly where
  // `v` points from there, its disk spelling kept - whether it was found in
  // that place or in the motif folder, build root or data/ of the install it
  // came from. Only a value that climbs out of the pack (or a place another
  // file already holds) gets a new name beside the naming file, renamed in
  // the composed def; the caller refuses that where no rename can reach (a
  // font's glyph file, a FightFx pack's own files). `taken` says the natural
  // place was another file's, not that the value climbs out. Null: no free name.
  const destFor = (abs, v, relDir, font) => {
    const r = posix(path.relative(scanRoot, abs));
    const vv = posix(v);
    const pre = relDir ? relDir + '/' : '';
    let taken = false;
    if (!vv.startsWith('/') && !/^[a-z]:/i.test(vv)) {
      const want = path.posix.normalize(pre + vv);
      const wantFont = font ? path.posix.normalize(pre + 'font/' + vv) : null;
      if (inside(scanRoot, abs) && [want, wantFont].some((w) => w && w.toLowerCase() === r.toLowerCase())) {
        if (claim(abs, r)) return { dest: r };
        taken = true;
      } else if (!climbsOut(want)) {
        const segs = want.split('/');
        segs[segs.length - 1] = path.basename(abs);
        const d = segs.join('/');
        if (claim(abs, d)) return { dest: d };
        taken = true;
      }
    }
    const ext = path.extname(abs), stem = path.basename(abs, ext);
    for (let n = 1; n < 100; n++) {
      const b = n === 1 ? stem + ext : stem + '~' + n + ext;
      if (claim(abs, pre + b)) return { dest: pre + b, rename: b, taken };
    }
    return null;
  };
  const whyMoved = (d, what, v) => (d && d.taken
    ? ' names ' + what + ' ' + v + ', and another file of the pack already has that name where it would go'
    : ' names ' + what + ' outside its own folder: ' + v);
  // Every place the engine looks for `v` named from `fromDir`, in its order.
  // A hit outside `confine`, or of a type the engine does not read for this
  // kind of value (ALLOW), is not a hit.
  let denied = null;
  const search = (fromDir, v, kind, dirsOverride, bound) => {
    const val = posix(v);
    const dirs = dirsOverride || [fromDir, ...roots];
    const lim = bound === undefined ? confine : bound;
    const probeFont = kind === 'font' || kind === 'glyph';
    for (const d of dirs) {
      if (!d) continue;
      const cands = [val];
      if (probeFont && !/^font\//i.test(val)) cands.push('font/' + val);
      for (const c of cands) {
        const hit = findCI(d, c);
        if (!hit || !isFile(hit) || !insideAny(lim, hit)) continue;
        if (kind && ALLOW[kind] && !ALLOW[kind].test(hit)) { denied = path.basename(hit); continue; }
        return hit;
      }
    }
    return null;
  };
  const notThere = (key, value) => key + ' = ' + value + (denied ? ' (' + denied + ' is not a file the engine reads there, so it is never copied)' : '');
  // The engine's data/ as a build sees it from a motif folder one level
  // below it, so a value like ../fightfx.sff reaches the stock file too.
  const engData = eng.filter((d) => /[\\/]data$/i.test(d));
  const engDirs = [...engData.map((d) => path.join(d, '_motif_')), ...eng];
  for (const [key, value] of info.files) {
    if (!value) continue;
    const fatal = FATAL_KEYS.test(key);
    const font = FONT_KEY.test(key);
    if (!fatal && !font) continue;
    denied = null;
    const kind = kindOfKey(key);
    let abs = search(defDir, value, kind);
    // A download may lean on the engine's own hit sparks and sounds, which
    // every build has in data/: they are copied in with the pack.
    if (!abs && confine && ENGINE_FX_KEYS.includes(key) && eng.length) abs = search(defDir, value, kind, engDirs, eng);
    if (!abs) {
      (fatal ? out.missing : out.soft).push(notThere(key, value));
      continue;
    }
    if (ENGINE_FX_KEYS.includes(key) && !inside(scanRoot, abs) && eng.length && insideAny(eng, abs)) out.engineFx.push(key);
    const d = destFor(abs, value, defRelDir, font);
    if (!d) { (fatal ? out.missing : out.soft).push(key + ' = ' + value + ' (no free name for it in the pack)'); continue; }
    put(abs, d.dest);
    out.keyDest[key] = d.dest;
    if (d.rename) out.renames[value] = d.rename;
    // A bitmap font .def brings its glyph file; a missing one panics the engine.
    if (font && /\.def$/i.test(abs)) {
      const ft = readText(abs) || '';
      const fm = /^\s*file\s*=\s*([^;\r\n]+)/im.exec(ft);
      if (fm) {
        const gv = unq(fm[1]);
        denied = null;
        const glyph = search(path.dirname(abs), gv, 'glyph');
        const ttf = /^\s*type\s*=\s*truetype/im.test(ft);
        if (!glyph) {
          if (ttf) out.soft.push(key + ' names a TrueType file that is not there: ' + notThere('file', gv));
          else out.panics.push(key + ' (' + value + ') names a glyph file that is not there: ' + notThere('file', gv));
        } else {
          const fontDestDir = path.posix.dirname(d.dest) === '.' ? '' : path.posix.dirname(d.dest);
          const gd = destFor(glyph, gv, fontDestDir, true);
          if (!gd || gd.rename) out.panics.push(key + ' (' + value + ')' + whyMoved(gd, 'its glyph file', gv));
          else put(glyph, gd.dest);
        }
      }
    }
    // An extra FightFx pack brings its own sprite, animation and sound files.
    if (/^fx[1-3]$/.test(key)) {
      const ft = readText(abs) || '';
      const fr = lifebarMod().readDef(ft);
      for (const k of ['sff', 'air', 'snd']) {
        const kv = fr.keys.get('files|' + k);
        if (!kv || !unq(kv.raw)) continue;
        denied = null;
        let sub = search(path.dirname(abs), unq(kv.raw), k);
        // A FightFx pack meant for data/ may lean on the engine's own copies
        // of its files, as the EVE remaster's gofx1280.def does for gofx.air
        // and gofx.snd: copied in, like fightfx and common.snd above. The
        // engine keeps them in data/ (0.99) or data/gofx/ (1.0).
        if (!sub && confine && eng.length) {
          sub = search(path.dirname(abs), unq(kv.raw), k, [...engDirs, ...engData.map((g) => path.join(g, 'gofx'))], eng);
          if (sub) out.engineFiles.push(key + ' ' + k + ' = ' + unq(kv.raw));
        }
        if (!sub) { out.missing.push(key + ' ' + notThere(k, unq(kv.raw))); continue; }
        const fxDir = path.posix.dirname(d.dest) === '.' ? '' : path.posix.dirname(d.dest);
        const sd = destFor(sub, unq(kv.raw), fxDir, false);
        if (!sd || sd.rename) out.missing.push(key + whyMoved(sd, 'a file', unq(kv.raw)));
        else put(sub, sd.dest);
      }
    }
  }
  out.info = info;
  out.defRel = defRel;
  out.claims = claimed;
  return out;
}

// A downloaded def with no localcoord was drawn for the screen it sat under.
// Its right lifebar's anchor says how wide that was (the EVE remaster puts
// [Lifebar] p2.pos at 1279,0), so a pack drawn at 1280 is not taken for 320.
function widthFromBars(info) {
  const k = info.read && info.read.keys.get('lifebar|p2.pos');
  const p = k ? numPair(k.raw) : null;
  if (!p || !(p[0] >= 320)) return null;
  return p[0] < 640 ? [640, 480] : p[0] < 1280 ? [1280, 720] : p[0] < 1920 ? [1920, 1080] : null;
}

// One def, judged. `opts.motifLocalcoord` is the source motif's (a lifted def
// with no localcoord of its own inherits it, as it did in its own build).
function judgeDef(defAbs, scanRoot, roots, opts) {
  const o = opts || {};
  const cl = closure(defAbs, scanRoot, roots, o.confine || null, o.claims || null);
  const info = cl.info;
  const why = [];
  const lacking = REQUIRED.filter((s) => !info.sections.has(s));
  const stubs = barsAreStubs(info);
  const add004 = stubs ? add004Nearby(defAbs, o.add004Root || scanRoot) : null;
  if (add004 || (stubs && o.add004Build)) {
    why.push('its lifebars are drawn by add004’s common states (' + (add004 ? path.basename(add004) : 'the build’s common1.cns')
      + '), not by this file: the bars in it are placeholders at 0,0 with no art. Those states only work with characters '
      + 'converted for that same add004 version, so they cannot be carried to another build as lifebars');
  } else if (stubs) {
    why.push('it draws no bars: every lifebar sprite is missing and every face is -1');
  }
  if (lacking.length) why.push('it lacks ' + lacking.map(REQUIRED_LABEL).join(', ') + ', which the engine needs or it stops at match start');
  if (cl.missing.length) why.push('it names files that are not there: ' + cl.missing.join('; '));
  if (cl.panics.length) why.push(cl.panics.join('; '));
  let localcoord = info.localcoord, localcoordFrom = 'def';
  if (!localcoord) {
    if (o.motifLocalcoord) { localcoord = o.motifLocalcoord; localcoordFrom = 'motif'; }
    else { localcoord = widthFromBars(info) || [320, 240]; localcoordFrom = 'assumed'; }
  }
  const destOf = (key) => cl.keyDest[key] || null;
  const entry = {
    def: cl.defRel,
    name: info.name || path.basename(cl.defRel, path.extname(cl.defRel)),
    localcoord, localcoordFrom,
    faces: info.faces,
    files: cl.files.map((f) => f.dest),
    bytes: cl.files.reduce((n, f) => n + sizeOf(f.src), 0),
    fightfx: { sff: destOf('fightfx.sff'), air: destOf('fightfx.air'), scale: info.fightfx.scale },
    commonSnd: destOf('common.snd'),
    framespercount: info.framespercount,
    renames: cl.renames,
    softMissing: cl.soft,
    // Hit sparks / sounds the pack took from the engine's own data/.
    engineFx: cl.engineFx,
  };
  // An FxN pack's files taken from the engine (only when there are any, so
  // other packs' manifests stay as they were).
  if (cl.engineFiles.length) entry.engineFiles = cl.engineFiles;
  return { ok: !why.length, why: why.join('. '), entry, closure: cl, add004: !!(add004 || (stubs && o.add004Build)) };
}

// Every .def under a folder, skipping what a pack never needs.
function defsUnder(root, maxDepth) {
  const out = [];
  const walk = (d, depth) => {
    let ents;
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (!SKIP_DIR.test(e.name) && depth < (maxDepth || 6)) walk(p, depth + 1); continue; }
      if (/\.def$/i.test(e.name)) out.push(p);
    }
  };
  walk(root, 0);
  return out.sort((a, b) => a.localeCompare(b));
}

// A pure read of a downloaded pack. Nothing is written.
function scanDir(dir, opts) {
  const o = opts || {};
  const root = path.resolve(dir);
  const defs = [], refused = [];
  let name = null, author = null;
  // The places in the library the usable defs have taken, shared so two
  // versions of a pack never put different files at one path.
  let claims = new Map();
  for (const abs of defsUnder(root)) {
    const text = readText(abs);
    if (!text || !isFightDef(text)) continue;
    const j = judgeDef(abs, root, [root], { motifLocalcoord: o.motifLocalcoord || null, add004Root: root, confine: [root], claims });
    // The pack is named after its first USABLE def: a refused one that sorts
    // first says nothing about what was installed.
    if (j.ok && !name && j.entry.name) { name = j.closure.info.name || null; author = j.closure.info.author || null; }
    if (j.ok) { defs.push(Object.assign(j.entry, { _closure: j.closure })); claims = j.closure.claims; }
    else refused.push({ def: j.entry.def, why: j.why, add004: j.add004 });
  }
  return { name: name || path.basename(root), named: !!name, author, defs, refused };
}

// ---- the library ------------------------------------------------------------

function libDir() { return layout().dir(LIBRARY); }

function readManifest(slug) {
  const t = readText(path.join(libDir(), slug, MANIFEST));
  if (t === null) return null;
  try { return JSON.parse(t); } catch (e) { return null; }
}

function library() {
  const dir = libDir();
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return []; }
  const out = [];
  for (const e of ents) {
    if (!e.isDirectory()) continue;
    const m = readManifest(e.name);
    if (!m) continue;
    out.push({ slug: e.name, name: m.name, author: m.author || null, from: m.from || null, defs: (m.defs || []).map((d) => Object.assign({ usable: true }, d)), refused: m.refused || [] });
  }
  return out.sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

function freeSlug(name) {
  const base = slugify(name);
  const dir = libDir();
  let s = base, n = 2;
  while (fs.existsSync(path.join(dir, s))) s = base + '_' + n++;
  return s;
}

// Refusals, one clause per distinct reason: a pack of forty defs refused for
// one reason reads as one sentence, not forty.
function refusalText(refused) {
  const by = new Map();
  for (const r of refused || []) { if (!by.has(r.why)) by.set(r.why, []); by.get(r.why).push(r.def); }
  const parts = [];
  for (const [why, defs] of by) {
    if (parts.length === 3) { parts.push('and ' + (by.size - 3) + ' other reason' + (by.size - 3 === 1 ? '' : 's')); break; }
    parts.push(defs.length === 1 ? defs[0] + ': ' + why
      : defs.length + ' lifebar files (' + defs.slice(0, 2).join(', ') + (defs.length > 2 ? ' and ' + (defs.length - 2) + ' more' : '') + '): ' + why);
  }
  return parts.join(' | ');
}

// Copy a scanned pack's usable defs and their closures into the library. A
// copy that fails partway leaves nothing behind: the folder is this call's own.
function writePack(scan, from) {
  const usable = scan.defs;
  if (!usable.length) {
    throw new Error(scan.refused.length ? 'nothing here can be used as lifebars. ' + refusalText(scan.refused) : 'no lifebar definition was found here (a .def with a [Files] sff and [Lifebar]-type sections)');
  }
  const slug = freeSlug(scan.name);
  const dest = path.join(libDir(), slug);
  fs.mkdirSync(dest, { recursive: true });
  try {
    const written = new Map();
    for (const d of usable) {
      for (const f of d._closure.files) {
        if (!GAME_FILE.test(f.dest)) continue;
        const key = f.dest.toLowerCase();
        if (written.has(key)) {
          if (realOf(written.get(key)).toLowerCase() !== realOf(f.src).toLowerCase()) throw new Error('two different files were placed at ' + f.dest);
          continue;
        }
        written.set(key, f.src);
        const to = path.join(dest, ...f.dest.split('/'));
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.copyFileSync(f.src, to);
      }
    }
    const manifest = {
      name: scan.name, author: scan.author || null, from,
      defs: usable.map((d) => { const c = Object.assign({}, d); delete c._closure; return c; }),
      refused: scan.refused.map((r) => ({ def: r.def, why: r.why })),
      installed: new Date().toISOString(),
    };
    fs.writeFileSync(path.join(dest, MANIFEST), JSON.stringify(manifest, null, 2) + '\n');
    // A second copy of a pack already in the library says it is one.
    const twin = library().find((p) => p.slug !== slug && p.name === manifest.name && JSON.stringify(p.from) === JSON.stringify(from));
    return { pack: slug, name: manifest.name, defs: manifest.defs, refused: manifest.refused, copyOf: twin ? twin.slug : null };
  } catch (e) {
    try { rmTree(dest); } catch (e2) { /* the copy error is the one to report */ }
    throw e;
  }
}

// Install from an archive (.zip, .rar or .7z) or a folder on this machine.
// The source is only read.
function install(srcPath, opts) {
  const src = path.resolve(String(srcPath || ''));
  if (!fs.existsSync(src)) throw new Error('that path does not exist: ' + src);
  let dir = src, tmp = null;
  const zip = /\.(zip|rar|7z)$/i.test(src);
  if (!zip && !isDir(src)) throw new Error('a lifebar pack is a folder or a .zip, .rar or .7z');
  try {
    if (zip) {
      tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mugen-lifebar-'));
      require('./modlib.js').extractZip(src, tmp);
      dir = tmp;
    }
    // A folder that only wraps another folder is the pack's own name around
    // the pack: look inside it, the way the zip extractor flattens one.
    for (let i = 0; i < 3; i++) {
      let ents = [];
      try { ents = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => !/^(__macosx|\.ds_store|thumbs\.db)$/i.test(e.name)); } catch (e) { break; }
      if (ents.length === 1 && ents[0].isDirectory()) dir = path.join(dir, ents[0].name);
      else break;
    }
    const scan = scanDir(dir);
    if (opts && opts.nameHint && (!scan.name || scan.name === path.basename(dir))) scan.name = opts.nameHint;
    if (tmp && scan.name === path.basename(tmp)) scan.name = path.basename(src, path.extname(src));
    // A name taken from a file or folder name reads as words
    // (EVE_remaster_UP1.rar, whose fight.def has no [Info] name).
    if (!scan.named) scan.name = String(scan.name).replace(/_+/g, ' ').trim() || scan.name;
    return writePack(scan, { kind: 'download', source: (opts && opts.source) || path.basename(src) });
  } finally {
    if (tmp) { try { rmTree(tmp); } catch (e) { /* a temp folder */ } }
  }
}

// Is this folder or zip a lifebar pack rather than a screenpack: no
// system.def anywhere in it, and a fight def somewhere? (The screenpack add
// routes use it when a same-named theme already exists, so the pack is not
// refused for a name it was never going to use.)
function looksLikeLifebarPack(srcPath) {
  const src = path.resolve(String(srcPath || ''));
  let dir = src, tmp = null;
  try {
    if (/\.(zip|rar|7z)$/i.test(src)) {
      tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mugen-lbsniff-'));
      require('./modlib.js').extractZip(src, tmp);
      dir = tmp;
    } else if (!isDir(src)) return false;
    let motif = false, fight = false;
    const walk = (d, depth) => {
      let ents = [];
      try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
      for (const e of ents) {
        const q = path.join(d, e.name);
        if (e.isDirectory()) { if (depth < 6 && !SKIP_DIR.test(e.name)) walk(q, depth + 1); continue; }
        if (/^system\.def$/i.test(e.name)) motif = true;
        else if (!fight && /\.def$/i.test(e.name)) { const tx = readText(q); if (tx && isFightDef(tx)) fight = true; }
      }
    };
    walk(dir, 0);
    return fight && !motif;
  } catch (e) {
    return false;
  } finally {
    if (tmp) { try { rmTree(tmp); } catch (e) { /* a temp folder */ } }
  }
}

// ---- screenpacks as sources ---------------------------------------------------

function engineRoots() {
  const L = layout();
  const out = [];
  for (const n of ['release-v2', 'release']) {
    try {
      const d = L.dir(n);
      out.push(d, path.join(d, 'data'));
    } catch (e) { /* not in this layout */ }
  }
  return out.filter(isDir);
}

function bundleDirs() {
  const L = layout();
  const out = [];
  try {
    const b = require('./bundles.js').list(L);
    for (const e of (b && b.bundles) || []) if (e && e.dir) out.push({ id: e.id || e.name, name: e.name, dir: e.dir, active: !!e.active });
  } catch (e) { /* no bundles module / not portable */ }
  if (!out.some((e) => path.resolve(e.dir) === path.resolve(L.CONTENT))) out.unshift({ id: L.ACTIVE_BUNDLE.name, name: L.ACTIVE_BUNDLE.name, dir: L.CONTENT, active: true });
  return out;
}

function motifInfo(motifAbs) {
  const text = readText(motifAbs) || '';
  const read = lifebarMod().readDef(text);
  const get = (s, k) => { const v = read.keys.get(s + '|' + k); return v ? unq(v.raw) : null; };
  const lc = numPair(get('info', 'localcoord'));
  return { name: get('info', 'name'), fight: get('files', 'fight') || 'fight.def', localcoord: lc && lc[0] > 0 ? lc : [320, 240] };
}

// Where a motif's fight def is, the way the engine finds it. `bound`: the
// folders it may be in (see sourceBound).
function resolveMotifFight(motifAbs, bound) {
  const mi = motifInfo(motifAbs);
  const motifDir = path.dirname(motifAbs);
  for (const base of [motifDir, ...engineRoots()]) {
    const hit = findCI(base, mi.fight);
    if (hit && isFile(hit) && insideAny(bound || null, hit)) return { def: hit, motif: mi, motifDir };
  }
  return { def: null, motif: mi, motifDir };
}

// What an installed screenpack's fight screen may take files from: its own
// folder, the bundle it sits in (what data/<theme>/.. reaches in a build) and
// the engine's installation. Anything a `..` value reaches beyond them is
// treated as not there, so nothing else on the disk can reach a library.
function sourceBound(motifAbs, bundleDir) {
  // The bundle's content folders, not the bundle root: in a checkout the
  // bundle root is the program folder itself (source, .git, local config).
  const L = layout();
  const content = [];
  for (const k of ['themes', 'cache', 'stages', 'music']) {
    try { content.push(path.join(bundleDir, L.folderName(k))); } catch (e) { /* not in this layout */ }
  }
  return [path.dirname(motifAbs), ...content, ...engineRoots()].filter(Boolean);
}

// Every screenpack the bundles hold, plus the engine's own, as lift sources.
function sources() {
  const L = layout();
  const out = [];
  const themesName = L.folderName('themes');
  for (const b of bundleDirs()) {
    const tdir = path.join(b.dir, themesName);
    let ents = [];
    try { ents = fs.readdirSync(tdir, { withFileTypes: true }); } catch (e) { ents = []; }
    for (const e of ents) {
      if (!e.isDirectory()) continue;
      const sys = path.join(tdir, e.name, 'system.def');
      if (!isFile(sys)) continue;
      out.push({ kind: 'theme', bundle: b.name, theme: e.name, here: path.resolve(b.dir) === path.resolve(L.CONTENT), motifAbs: sys, bound: sourceBound(sys, b.dir) });
    }
  }
  const stock = stockSource();
  if (stock) out.push(stock);
  for (const s of out) {
    const r = resolveMotifFight(s.motifAbs, s.bound);
    s.name = s.kind === 'stock' ? 'Ikemen GO' : (r.motif.name || s.theme);
    if (!r.def) { s.usable = false; s.why = 'its fight screen (' + r.motif.fight + ') is not there'; continue; }
    const txt = readText(r.def) || '';
    if (!isFightDef(txt)) { s.usable = false; s.why = r.motif.fight + ' is not a fight screen'; continue; }
    const j = judgeDef(r.def, path.dirname(r.def), [r.motifDir, ...engineRoots()], {
      motifLocalcoord: r.motif.localcoord, add004Root: r.motifDir, add004Build: !!add004Nearby(path.join(r.motifDir, 'x'), r.motifDir),
      confine: s.bound,
    });
    s.usable = j.ok;
    s.why = j.ok ? null : j.why;
    s.bytes = j.entry.bytes;
    s.localcoord = j.entry.localcoord;
  }
  return out.map((s) => { const c = Object.assign({}, s); delete c.motifAbs; delete c.bound; return c; });
}

function stockSource() {
  try {
    const d = layout().dir('release-v2');
    const sys = path.join(d, 'data', 'ikemen1', 'system.def');
    if (!isFile(sys)) return null;
    return { kind: 'stock', motifAbs: sys, bound: engineRoots() };
  } catch (e) { return null; }
}

// Copy a screenpack's fight screen into THIS bundle's library.
function lift(source) {
  const s = source || {};
  let motifAbs = null, from = null, bound = null;
  if (s.stock) {
    const st = stockSource();
    if (!st) throw new Error('the engine’s own screenpack is not in this copy');
    motifAbs = st.motifAbs;
    bound = st.bound;
    from = { kind: 'stock' };
  } else {
    const L = layout();
    const b = bundleDirs().find((x) => x.name === s.bundle || x.id === s.bundle);
    if (!b) throw new Error('no such bundle: ' + s.bundle);
    const sys = path.join(b.dir, L.folderName('themes'), String(s.theme || ''), 'system.def');
    if (!s.theme || /[\\/]/.test(s.theme) || !isFile(sys)) throw new Error('no such screenpack in ' + b.name + ': ' + s.theme);
    motifAbs = sys;
    bound = sourceBound(sys, b.dir);
    from = { kind: 'theme', bundle: b.name, theme: s.theme };
  }
  const r = resolveMotifFight(motifAbs, bound);
  if (!r.def) throw new Error('that screenpack’s fight screen (' + r.motif.fight + ') is not there');
  const defDir = path.dirname(r.def);
  const j = judgeDef(r.def, defDir, [r.motifDir, ...engineRoots()], {
    motifLocalcoord: r.motif.localcoord, add004Root: r.motifDir, add004Build: !!add004Nearby(path.join(r.motifDir, 'x'), r.motifDir),
    confine: bound,
  });
  const name = s.stock ? 'Ikemen GO' : (r.motif.name || j.closure.info.name || s.theme);
  const scan = { name, author: j.closure.info.author || null, defs: [], refused: [] };
  if (j.ok) scan.defs.push(Object.assign(j.entry, { _closure: j.closure }));
  else scan.refused.push({ def: j.entry.def, why: j.why });
  if (!j.ok) throw new Error('the lifebars of ' + name + ' cannot be taken: ' + j.why);
  return writePack(scan, from);
}

// A library pack's folder name, exactly as slugify makes them. Anything else
// ('.', '..', a path) is refused before it can name a folder.
const SLUG_RE = /^[A-Za-z0-9_-]+$/;

// Remove a folder (or a file) and make sure it is gone: it happens, or this
// throws. The Node runtime the Studio ships (23.11) returns from fs.rmSync
// without error and without deleting anything when the path holds a non-ASCII
// character ANYWHERE - the name itself or any folder above it, a single file
// as much as a folder, with or without force - so the walk is done by hand
// when it did not happen. unlinkSync and rmdirSync have no such trouble.
//
// The top is lstat'ed, not stat'ed: a junction or symlink is removed as the
// link. Following one here emptied whatever it pointed at when its own name
// was not ASCII. The walk never follows one either (a Dirent reports the link).
// Only "no such path" counts as gone; any other lstat failure is still there.
function present(q) {
  try { fs.lstatSync(q); return true; } catch (e) { return e.code !== 'ENOENT' && e.code !== 'ENOTDIR'; }
}
function rmTree(p) {
  try { fs.rmSync(p, { recursive: true, force: true }); } catch (e) { /* checked below */ }
  if (!present(p)) return;
  const walk = (d) => {
    let ents = [];
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { ents = []; }
    for (const e of ents) {
      const q = path.join(d, e.name);
      if (e.isDirectory() && !e.isSymbolicLink()) walk(q); else fs.unlinkSync(q);
    }
    fs.rmdirSync(d);
  };
  if (fs.lstatSync(p).isDirectory()) walk(p); else fs.unlinkSync(p);
  if (present(p)) throw new Error('could not delete ' + p);
}

// One FILE, the same promise. A folder is refused, never emptied: a caller
// deleting "a track" or "a backup" that is handed '' or '..' must not reach
// the directory above it. Absent is fine (already gone). unlinkSync, not
// rmSync, for the reason above; it also clears a read-only attribute itself.
function rmFile(p) {
  if (!present(p)) return;
  if (fs.lstatSync(p).isDirectory()) throw new Error('not a file: ' + p);
  fs.unlinkSync(p);
  if (present(p)) throw new Error('could not delete ' + p);
}

function removePack(slug) {
  const s = String(slug || '');
  if (!SLUG_RE.test(s)) throw new Error('bad lifebar name');
  const lib = path.resolve(libDir());
  const dir = path.join(lib, s);
  if (path.dirname(path.resolve(dir)) !== lib) throw new Error('bad lifebar name');
  if (!fs.existsSync(dir)) throw new Error('no such lifebar: ' + s);
  rmTree(dir);
  // The build's own edited copies of it go with it.
  try {
    const engLib = path.resolve(path.join(layout().dir('engine'), LIBRARY));
    const own = path.join(engLib, s);
    if (path.dirname(path.resolve(own)) === engLib && fs.existsSync(own)) rmTree(own);
  } catch (e) { /* none */ }
  const vfslib = require('./vfslib.js');
  const roster = vfslib.readRoster();
  const mix = normalizeMix(roster[MIX_KEY]);
  const cleared = [];
  if (mix.lifebar && mix.lifebar.pack === s) { mix.lifebar = null; cleared.push('lifebar'); }
  // A part it supplied goes back to the screenpack's own when the screenpack
  // has one (and always on an add004 build, whose own effects draw from
  // them); otherwise to the chosen lifebars' own. With no library lifebar
  // left, either is the default and nothing is stored.
  let sp = null;
  try { sp = screenpackBase(roster); } catch (e) { sp = null; }
  const a004 = (() => { try { return add004Build(roster); } catch (e) { return false; } })();
  const spHas = { sparks: !!(sp && sp.fightfx && sp.fightfx.sff && sp.fightfx.air), sounds: !!(sp && sp.commonSnd) };
  for (const k of ['sparks', 'sounds']) {
    if (mix[k] && typeof mix[k] === 'object' && mix[k].pack === s) { mix[k] = spHas[k] || a004 ? 'screenpack' : 'lifebar'; cleared.push(k); }
  }
  if (cleared.length) { storeMix(roster, normalizeMix(mix)); vfslib.writeRoster(roster); }
  return { removed: s, cleared };
}

// ---- the choice ----------------------------------------------------------------

function normalizeMix(raw) {
  const m = raw && typeof raw === 'object' ? raw : {};
  // A pack is named by its folder, a slug: anything else (a path, '..') is
  // no pack at all, so a choice can never reach outside the library.
  const ref = (v) => (v && typeof v === 'object' && v.pack && v.def && SLUG_RE.test(String(v.pack)) ? { pack: String(v.pack), def: posix(v.def) } : null);
  const part = (v) => (v === 'screenpack' ? 'screenpack' : (ref(v) || 'lifebar'));
  const out = {
    lifebar: ref(m.lifebar),
    sparks: part(m.sparks),
    sounds: part(m.sounds),
    clock: m.clock === 'lifebar' ? 'lifebar' : 'screenpack',
    // 'edit': the clock was switched by an edit of the lifebar's own copy in
    // Settings > Engine (lifebar.write), not chosen on the Theme tab. Putting
    // that copy back, or choosing another lifebar, puts the clock back too.
    clockBy: null,
  };
  if (out.clock === 'lifebar' && m.clockBy === 'edit') out.clockBy = 'edit';
  // 'screenpack': ship the screenpack's own (never read) version of the
  // chosen lifebar's def with that lifebar's art (versionFor).
  out.fightDef = out.lifebar && m.fightDef === 'screenpack' ? 'screenpack' : null;
  // With the screenpack's own lifebars, "the screenpack's" and "the lifebar's"
  // are the same thing.
  if (!out.lifebar) {
    if (out.sparks === 'screenpack') out.sparks = 'lifebar';
    if (out.sounds === 'screenpack') out.sounds = 'lifebar';
  }
  return out;
}

function isDefault(mix) {
  return !mix.lifebar && mix.sparks === 'lifebar' && mix.sounds === 'lifebar' && mix.clock === 'screenpack';
}

function storeMix(roster, mix) {
  if (isDefault(mix)) delete roster[MIX_KEY];
  else {
    const o = {};
    if (mix.lifebar) o.lifebar = mix.lifebar;
    if (mix.sparks !== 'lifebar') o.sparks = mix.sparks;
    if (mix.sounds !== 'lifebar') o.sounds = mix.sounds;
    if (mix.clock !== 'screenpack') o.clock = mix.clock;
    if (mix.clockBy === 'edit' && mix.clock === 'lifebar') o.clockBy = 'edit';
    if (mix.fightDef === 'screenpack' && mix.lifebar) o.fightDef = 'screenpack';
    roster[MIX_KEY] = o;
  }
}

function findDef(ref) {
  if (!ref || !SLUG_RE.test(String(ref.pack || ''))) return null;
  const m = readManifest(ref.pack);
  if (!m) return null;
  const d = (m.defs || []).find((x) => posix(x.def).toLowerCase() === posix(ref.def).toLowerCase());
  return d ? { manifest: m, entry: d, dir: path.join(libDir(), ref.pack) } : null;
}

function choose(patch) {
  const p = patch || {};
  const vfslib = require('./vfslib.js');
  const roster = vfslib.readRoster();
  const mix = normalizeMix(roster[MIX_KEY]);
  const check = (ref, what) => {
    if (ref && typeof ref === 'object' && !findDef(ref)) throw new Error('no such ' + what + ' in this bundle’s library: ' + ref.pack + ' / ' + ref.def);
  };
  const was = mix.lifebar ? mix.lifebar.pack + '/' + mix.lifebar.def : null;
  if ('lifebar' in p) { check(p.lifebar, 'lifebar'); mix.lifebar = p.lifebar ? { pack: String(p.lifebar.pack), def: posix(p.lifebar.def) } : null; }
  // The screenpack's version belongs to the lifebar it matched: another
  // lifebar starts from its own def.
  if ('fightDef' in p) mix.fightDef = p.fightDef === 'screenpack' ? 'screenpack' : null;
  else if ((mix.lifebar ? mix.lifebar.pack + '/' + mix.lifebar.def : null) !== was) mix.fightDef = null;
  for (const k of ['sparks', 'sounds']) {
    if (!(k in p)) continue;
    const v = p[k];
    if (v === 'screenpack' || v === 'lifebar' || v === null || v === undefined) mix[k] = v === 'screenpack' ? 'screenpack' : 'lifebar';
    else { check(v, k === 'sparks' ? 'hit sparks source' : 'hit sounds source'); mix[k] = { pack: String(v.pack), def: posix(v.def) }; }
  }
  if ('clock' in p) {
    mix.clock = p.clock === 'lifebar' ? 'lifebar' : 'screenpack';
    mix.clockBy = mix.clock === 'lifebar' && p.clockBy === 'edit' ? 'edit' : null;
  } else if (mix.clockBy === 'edit' && (mix.lifebar ? mix.lifebar.pack + '/' + mix.lifebar.def : null) !== was) {
    // An edit switched the clock for the lifebar it edited, not for others.
    mix.clock = 'screenpack';
    mix.clockBy = null;
  }
  const n = normalizeMix(mix);
  storeMix(roster, n);
  vfslib.writeRoster(roster);
  return n;
}

// ---- composing the def the build ships -------------------------------------

function sparkScale(srcScale, wTarget, wSrc) {
  const s = Number(srcScale);
  const base = isFinite(s) && s > 0 ? s : 1;
  if (!(wTarget > 0) || !(wSrc > 0)) return round4(base);
  return round4(base * wTarget / wSrc);
}

// Splice edits into a def's text. Never a re-serialization: every byte outside
// a changed value stays as it was, headers included.
function compose(baseText, opts) {
  const o = opts || {};
  const lb = lifebarMod();
  let text = String(baseText == null ? '' : baseText);
  const eol = lb.eolOf(text);
  const edits = [];   // { at, end, text }
  let read = lb.readDef(text);
  const lines = lb.lineIndex(text);
  const headerEnd = (id) => {
    const s = read.sections.get(id);
    if (!s) return null;
    const l = lines[s.line];
    return l.next <= text.length ? l.next : text.length;
  };
  const sectionEnd = (id) => {
    // Position right before the next section header after this one.
    const s = read.sections.get(id);
    if (!s) return null;
    for (let i = s.line + 1; i < lines.length; i++) {
      if (lb.sectionOf(text.slice(lines[i].start, lines[i].end))) return lines[i].start;
    }
    return text.length;
  };
  const setKey = (sec, key, value) => {
    const k = read.keys.get(sec + '|' + key.toLowerCase());
    if (k) {
      if (k.raw === value) return;
      edits.push({ at: k.start, end: k.end, text: value });
      return;
    }
    const at = headerEnd(sec);
    if (at === null) return false;
    const pre = at === text.length && text.length && !/\n$/.test(text) ? eol : '';
    edits.push({ at, end: at, text: pre + key + ' = ' + value + eol });
    return true;
  };
  // 1. The coordinate space, when the def does not state one.
  const info = readDefInfo(text);
  if (o.localcoord && !info.localcoord) {
    const v = o.localcoord[0] + ',' + o.localcoord[1];
    // After a byte-order mark, which has to stay the file's first bytes.
    const top = lb.bomLength(text);
    if (read.sections.has('info')) setKey('info', 'localcoord', v);
    else edits.push({ at: top, end: top, text: '[Info]' + eol + 'localcoord = ' + v + eol + eol });
  }
  // 2. Files renamed at lift time (a value that climbed out of its folder).
  if (o.renames) {
    for (const [id, k] of read.keys) {
      if (!/^files\|/.test(id)) continue;
      const v = unq(k.raw);
      if (Object.prototype.hasOwnProperty.call(o.renames, v)) edits.push({ at: k.start, end: k.end, text: o.renames[v] });
    }
  }
  // 3. Hit sparks.
  let fxSection = null;
  if (o.sparks) {
    if (o.sparks.sff) setKey('files', 'fightfx.sff', o.sparks.sff);
    if (o.sparks.air) setKey('files', 'fightfx.air', o.sparks.air);
    if (o.sparks.scale !== undefined && o.sparks.scale !== null) {
      const sv = String(o.sparks.scale);
      if (read.sections.has('fightfx')) setKey('fightfx', 'scale', sv);
      else fxSection = sv;
    }
  }
  // 4. Hit sounds.
  if (o.sounds && o.sounds.snd) setKey('files', 'common.snd', o.sounds.snd);
  // 5. The round clock.
  if (o.framespercount !== undefined && o.framespercount !== null) setKey('time', 'framespercount', String(o.framespercount));
  // 6. A [FightFx] section the def lacked, after the [Files] section. Pushed
  // last: inserts at one offset are joined in push order, and a value edit at
  // the very end of the file (an empty last key) has to come before it.
  if (fxSection !== null) {
    const at = sectionEnd('files');
    const pre = at === text.length && text.length && !/\n$/.test(text) ? eol : '';
    if (at !== null) edits.push({ at, end: at, text: pre + '[FightFx]' + eol + 'scale = ' + fxSection + eol + eol });
  }
  // Apply back to front. Two inserts at one place keep their order; of two
  // replacements of one value the LATER wins (a sparks or sounds swap over a
  // lift-time rename of the same key).
  edits.sort((a, b) => (b.at - a.at) || (b.end - a.end));
  const byAt = new Map();
  for (const e of edits) { if (!byAt.has(e.at + ':' + e.end)) byAt.set(e.at + ':' + e.end, []); byAt.get(e.at + ':' + e.end).push(e); }
  const done = new Set();
  for (const e of edits) {
    const k = e.at + ':' + e.end;
    if (done.has(k)) continue;
    done.add(k);
    const group = byAt.get(k);
    const ins = e.at === e.end ? group.map((g) => g.text).join('') : group[group.length - 1].text;
    text = text.slice(0, e.at) + ins + text.slice(e.end);
  }
  return text;
}

// ---- add004 builds ---------------------------------------------------------------
//
// add004's System_Switch block starts var(7) with every feature on and then
// has one line per feature that flips it off, commented out while the
// feature stays on. The Studio uncomments the flip lines for the parts of the
// HUD a lifebar replaces. The block is read from its marker to the next
// controller, the same way teamplay.add004Tag reads it.
// 4 combo counter, 256 lifebar, 512 power bar, 4096 round call, 8192 KO call,
// 32768 portraits: every part of add004's HUD a lifebar draws itself. Its
// other systems (dizzy, guard break, messages, score, tag, voices) stay on.
const ADD004_OFF = [4, 256, 512, 4096, 8192, 32768];
const ADD004_NAMES = { 4: 'combo counter', 256: 'lifebar', 512: 'power bar', 4096: 'round call', 8192: 'KO call', 32768: 'portraits' };
function add004Switches(text) {
  const src = String(text || '');
  const lines = src.split(/(?<=\n)/);
  const code = (l) => l.replace(/\r?\n$/, '').split(';')[0];
  let at = -1;
  for (let i = 0; i < lines.length; i++) {
    if (!/>>@Config\.System_Switch>>/.test(lines[i])) continue;
    // The header lists the marks too; the real block has the var(7) init below.
    let init = false;
    for (let j = i + 1; j < lines.length && j < i + 60; j++) {
      if (/var\(7\)\s*:=\s*\d+/.test(code(lines[j]))) { init = true; break; }
      if (/^\s*;;>>@Config\./.test(lines[j]) && j > i + 1) break;
    }
    if (init) { at = i; break; }
  }
  if (at < 0) return { text: src, changed: [], flags: [] };
  const changed = [];
  let started = false;
  for (let j = at + 1; j < lines.length && j < at + 60; j++) {
    const c = code(lines[j]);
    if (/^\s*\[\s*state/i.test(c)) { if (started) break; started = true; continue; }
    const m = /^(\s*);+(\s*trigger\d+\s*=\s*1\s*\|\|\s*var\(7\)\s*:=\s*\(\s*var\(7\)\s*\^\s*(\d+)\s*\).*)$/i.exec(lines[j].replace(/\r?\n$/, ''));
    if (!m) continue;
    const bit = Number(m[3]);
    if (!ADD004_OFF.includes(bit)) continue;
    const nl = /\r?\n$/.exec(lines[j]);
    lines[j] = m[1] + m[2] + (nl ? nl[0] : '');
    changed.push(bit);
  }
  const hud = add004HudFlags(lines.join(''));
  return { text: hud.text, changed: changed.sort((a, b) => a - b), flags: hud.flags };
}

// add004's bar helper (statedef 90900) asserts NoBarDisplay whenever the round
// is not in its fight phase - add004 draws its own HUD there, so it hides the
// engine's through the intro, the round call, the KO and the win poses - and
// its result helper (99980) asserts it for its result panel. The flag is
// global, so with add004's lifebar switched off it would hide the build's
// lifebars at those times. The first is tied to add004's lifebar bit and the
// second to the result panel's bit (read from the bar helper that spawned
// it: the result helper copies the switch only after its first tick), so
// each hides the HUD only while add004 draws its own. Idempotent.
function add004HudFlags(text) {
  const src = String(text || '');
  const eol = /\r\n/.test(src) ? '\r\n' : '\n';
  const lines = src.split(/(?<=\n)/);
  const code = (l) => l.replace(/\r?\n$/, '').split(';')[0];
  const ctrls = (sd) => {
    const out = [];
    const head = new RegExp('^\\s*\\[\\s*statedef\\s+' + sd + '\\s*\\]', 'i');
    const i = lines.findIndex((l) => head.test(code(l)));
    if (i < 0) return out;
    let cur = null;
    for (let j = i + 1; j < lines.length; j++) {
      const c = code(lines[j]);
      if (/^\s*\[\s*statedef\b/i.test(c)) break;
      if (/^\s*\[\s*state\b/i.test(c)) { cur = { at: j, end: j + 1 }; out.push(cur); continue; }
      if (cur) cur.end = j + 1;
    }
    return out;
  };
  const find = (c, re) => { for (let j = c.at + 1; j < c.end; j++) if (re.test(code(lines[j]))) return j; return -1; };
  const indentOf = (c) => { for (let j = c.at + 1; j < c.end; j++) { const m = /^([ \t]+)\S/.exec(lines[j]); if (m && code(lines[j]).trim()) return m[1]; } return '\t'; };
  const isAssert = (c) => find(c, /^\s*type\s*=\s*assertspecial\s*$/i) >= 0;
  const noBar = /^\s*flag\d*\s*=\s*nobardisplay\s*$/i;
  const edits = [];   // { at, del, text } applied bottom-up
  const flags = [];
  // 1. The bar helper.
  const BAR_GATE = /^\s*triggerall\s*=\s*\(?\s*var\(7\)\s*&\s*256\s*\)?\s*$/i;
  for (const c of ctrls(90900)) {
    if (!isAssert(c) || find(c, noBar) < 0 || find(c, /roundstate/i) < 0) continue;
    if (find(c, BAR_GATE) >= 0) continue;
    const t = find(c, /^\s*type\s*=/i);
    edits.push({ at: t + 1, del: 0, text: indentOf(c) + 'triggerall=(var(7)&256)' + eol });
    flags.push('bar helper');
  }
  // 2. The result helper. Its assert is tied to the result panel's bit, read
  // from the bar helper that spawned it, and skipped on a bonus stage, where
  // the panel is not drawn (bit 4096 of the same helper's var(9)).
  const PANEL = '(parent,var(7))&32';
  const BONUS = '!((parent,var(9))&4096)';
  const PANEL_RE = /^\s*triggerall\s*=\s*\(\s*parent\s*,\s*var\(7\)\s*\)\s*&\s*32\s*$/i;
  const flagLine = /^\s*flag(\d*)\s*=/i;
  const result = ctrls(99980);
  if (!result.some((c) => find(c, PANEL_RE) >= 0 && find(c, noBar) >= 0)) {
    for (const c of result) {
      const f = find(c, noBar);
      if (!isAssert(c) || f < 0) continue;
      const flagsAt = [];
      for (let j = c.at + 1; j < c.end; j++) if (flagLine.test(code(lines[j]))) flagsAt.push(j);
      const ind = indentOf(c);
      const gates = ind + 'triggerall=' + PANEL + eol + ind + 'triggerall=' + BONUS + eol;
      if (flagsAt.length === 1) {
        const tl = find(c, /^\s*type\s*=/i);
        edits.push({ at: tl + 1, del: 0, text: gates });
      } else {
        // NoBarDisplay rides on another assert (CVS: flag=invisible,
        // flag2=nobardisplay): it moves to a controller of its own, with the
        // original's triggers. The one left keeps a plain flag= (the engine
        // refuses an AssertSpecial without one), so when NoBarDisplay WAS the
        // plain flag, the next one takes its place.
        edits.push({ at: f, del: 1, text: ';' + lines[f] });
        if (!flagLine.exec(code(lines[f]))[1]) {
          const next = flagsAt.find((j) => j !== f);
          edits.push({ at: next, del: 1, text: lines[next].replace(/flag\d+(\s*=)/i, 'flag$1') });
        }
        const trig = [];
        for (let j = c.at + 1; j < c.end; j++) if (/^\s*trigger(all|\d+)\s*=/i.test(code(lines[j]))) trig.push(ind + code(lines[j]).trim() + eol);
        const hdr = code(lines[c.at]).trim();
        edits.push({ at: c.end, del: 0, text: hdr + eol + ind + 'type=assertspecial' + eol + gates
          + (trig.length ? trig.join('') : ind + 'trigger1=1' + eol) + ind + 'flag=nobardisplay' + eol + ind + 'ignorehitpause=1' + eol });
      }
      flags.push('result helper');
      break;
    }
  }
  edits.sort((a, b) => b.at - a.at);
  for (const e of edits) lines.splice(e.at, e.del, e.text);
  return { text: lines.join(''), flags };
}

// Is `bit` of add004's System_Switch still ON in this text: set by the
// starting value and not flipped by an active line of the block?
function add004BitOn(text, bit) {
  const lines = String(text || '').split(/\r?\n/);
  const code = (l) => l.split(';')[0];
  for (let i = 0; i < lines.length; i++) {
    if (!/>>@Config\.System_Switch>>/.test(lines[i])) continue;
    let at = -1;
    for (let j = i + 1; j < lines.length && j < i + 60; j++) {
      if (/var\(7\)\s*:=\s*\d+/.test(code(lines[j]))) { at = j; break; }
      if (/^\s*;;>>@Config\./.test(lines[j]) && j > i + 1) break;
    }
    if (at < 0) continue;
    let on = (Number(/var\(7\)\s*:=\s*(\d+)/.exec(code(lines[at]))[1]) & bit) !== 0;
    for (let j = at + 1; j < lines.length && j < at + 60; j++) {
      const c = code(lines[j]);
      if (/^\s*\[\s*state/i.test(c)) break;
      const f = /var\(7\)\s*:=\s*\(\s*var\(7\)\s*\^\s*(\d+)\s*\)/.exec(c);
      if (f && Number(f[1]) === bit) on = !on;
    }
    return on;
  }
  return null;
}

// Is the ACTIVE bundle an add004 build? Its screenpack folder's common states,
// or the build states it lists, carry the System_Switch block.
function add004Build(roster) {
  const L = layout();
  const r = roster || require('./vfslib.js').readRoster();
  const folder = motifFolderOf(r);
  const files = [];
  if (folder) {
    const d = path.join(L.dir('themes'), folder);
    let ents = [];
    try { ents = fs.readdirSync(d); } catch (e) { ents = []; }
    for (const n of ents) if (/\.(cns|st)$/i.test(n)) files.push(path.join(d, n));
  }
  try { const bi = require('./buildimport.js'); files.push(bi.buildStatesPath(L)); } catch (e) { /* none */ }
  for (const f of files) {
    const t = readText(f);
    if (t && />>@Config\.System_Switch>>/.test(t) && /var\(7\)\s*:=\s*\d+/.test(t)) return true;
  }
  return false;
}

// Should the shipped add004 states have their HUD switched off? Exactly when
// the build ships a library lifebar: the same decision mounts() makes for
// both exports, so a lifebar that cannot be mounted (its def gone, or a
// screenpack at the data/ root) never leaves a build with no HUD at all.
function add004Off(roster) {
  const r = roster || require('./vfslib.js').readRoster();
  let m = null;
  try { m = mounts(r); } catch (e) { m = null; }
  return !!(m && m.fightKey);
}

// The screenpack folder's add004 common states with the HUD switched off,
// keyed by vpath, for the website build's generated layer (which the desktop
// export copies the screenpack through). `already` holds the copies another
// rewrite made first (add004's round call), so both changes ship together.
function add004ThemeFiles(roster, themeDir, vprefix, already) {
  const out = {};
  if (!add004Off(roster)) return out;
  const walk = (dir, rel) => {
    let ents;
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const e of ents) {
      const abs = path.join(dir, e.name);
      const r = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) { walk(abs, r); continue; }
      if (!/\.(cns|st)$/i.test(e.name) || sizeOf(abs) > 8 * 1024 * 1024) continue;
      const vp = vprefix + r;
      const prior = already && already[vp] ? Buffer.from(already[vp]).toString('latin1') : readText(abs);
      if (prior === null || !/>>@Config\.System_Switch>>/.test(prior)) continue;
      const sw = add004Switches(prior);
      if (sw.changed.length || sw.flags.length) out[vp] = Buffer.from(sw.text, 'latin1');
    }
  };
  if (themeDir && isDir(themeDir)) walk(themeDir, '');
  return out;
}

// ---- mounting --------------------------------------------------------------------

// The active motif's folder under data/, spelled as the disk spells it (a
// build is keyed by the disk's names; a roster may carry another spelling).
function motifFolderOf(roster) {
  const rel = String((roster && roster.motif) || 'data/ikemen1/system.def').replace(/^data\//i, '');
  if (!rel.includes('/')) return null;
  const want = rel.slice(0, rel.indexOf('/'));
  const bases = [];
  try { bases.push(layout().dir('themes')); } catch (e) { /* none */ }
  for (const d of engineRoots()) if (/[\\/]data$/i.test(d)) bases.push(d);
  for (const b of bases) {
    let ents = [];
    try { ents = fs.readdirSync(b); } catch (e) { continue; }
    const hit = ents.find((n) => n === want) || ents.find((n) => n.toLowerCase() === want.toLowerCase());
    if (hit) return hit;
  }
  return want;
}

// Where the build's own edited copy of a library def lives (Settings > Engine).
function ownPathFor(pack, def) {
  return path.join(layout().dir('engine'), LIBRARY, pack, ...posix(def).split('/'));
}

// The screenpack's own fight screen, as the build uses it without a mix.
function screenpackBase(roster) {
  const lb = lifebarMod();
  const res = lb.resolveScreenpack(roster);
  if (!res.source) return { res, text: null };
  const own = readText(res.ownPath);
  const text = own !== null ? own : readText(res.source);
  const info = readDefInfo(text || '');
  const motifLc = res.motifPath ? motifInfo(res.motifPath).localcoord : [320, 240];
  const files = lb.filesFor(res, text || '');
  return {
    res, text, info,
    width: (info.localcoord || motifLc)[0],
    framespercount: info.framespercount || 60,
    fightfx: { sff: files['fightfx.sff'] || null, air: files['fightfx.air'] || null, scale: info.fightfx.scale },
    commonSnd: files['common.snd'] || null,
  };
}

// A SCREENPACK WHOSE FIGHT SCREEN IS NOT ITS OWN. EVEREDUX's system.def says
// `fight =data/fight.def`, which the engine finds from the game folder: its
// own stock lifebars. The fight.def in its folder is never read, and it names
// fight.sff, fightfx, common.snd and fonts the pack does not include (it is a
// patch for lifebars released separately). The Theme tab says so, so the
// engine's lifebars are not taken for the pack's. Null for a pack whose fight
// def is in its own folder, and for the engine's own motifs. The Studio's own
// folders in a theme (studio-options/, studio-lifebar/...) are not the pack's.
const FIGHT_FILE_KEY = /^(?:sff|snd|fightfx\.(?:sff|air)|common\.snd|fx\d+|font\d+)$/i;
function foreignFight(res) {
  if (!res || !res.source || !res.motifPath) return null;
  const packDir = path.dirname(res.motifPath);
  let themes = null;
  try { themes = layout().dir('themes'); } catch (e) { themes = null; }
  if (!themes || !inside(themes, packDir) || inside(packDir, res.source)) return null;
  const lb = lifebarMod();
  const unused = [];
  for (const d of defsUnder(packDir, 2)) {
    const rel = posix(path.relative(packDir, d));
    if (/^studio-/i.test(rel)) continue;
    const text = readText(d);
    if (!text || !isFightDef(text)) continue;
    const lacks = [];
    for (const [id, v] of lb.readDef(text).keys) {
      const m = /^files\|(.+)$/.exec(id);
      const val = m && FIGHT_FILE_KEY.test(m[1]) ? String(v.raw).trim().replace(/"/g, '') : '';
      if (!val) continue;
      const tries = /^font/i.test(m[1]) ? [val, 'font/' + val] : [val];
      if (![path.dirname(d), packDir].some((b) => tries.some((t) => isFile(findCI(b, t))))) lacks.push(path.posix.basename(posix(val)));
    }
    unused.push({ def: rel, lacks: [...new Set(lacks)] });
  }
  return { def: res.sourceRel, engine: !inside(themes, res.source), unused };
}

// A SCREENPACK'S OWN VERSION OF A LIBRARY LIFEBAR. EVEREDUX's never-read
// fight.def is the EVE remaster's, edited by its author (faces from each
// character's 9000,0, level bars on). It matches a library def when both name
// the same sff and snd, every other file it names that the engine cannot do
// without is in that library lifebar, and each font it names is either there
// or in neither (a missing font is only logged: EVEREDUX's jam_Small).
function versionMatch(spDefAbs, packDir, f) {
  const spText = readText(spDefAbs);
  const libText = readText(path.join(f.dir, ...posix(f.entry.def).split('/')));
  if (!spText || !libText) return false;
  const sp = readDefInfo(spText).files, lb = readDefInfo(libText).files;
  const base = (v) => path.posix.basename(posix(v || '')).toLowerCase();
  for (const k of ['sff', 'snd']) if (!sp.get(k) || base(sp.get(k)) !== base(lb.get(k))) return false;
  const have = new Set((f.entry.files || []).map((x) => String(x).toLowerCase()));
  const dir = path.posix.dirname(posix(f.entry.def));
  const pre = dir === '.' ? '' : dir + '/';
  const ren = f.entry.renames || {};
  const tries = (v, font) => [v].concat(font && !/^font\//i.test(v) ? ['font/' + v] : []);
  for (const [k, v] of sp) {
    const fatal = FATAL_KEYS.test(k), font = FONT_KEY.test(k);
    if (!v || (!fatal && !font)) continue;
    if (tries(posix(ren[v] || v), font).some((c) => have.has(path.posix.normalize(pre + c).toLowerCase()))) continue;
    if (fatal) return false;
    const inPack = tries(posix(v), true).some((c) => [path.dirname(spDefAbs), packDir].some((d) => { const h = findCI(d, c); return !!h && isFile(h); }));
    if (inPack) return false;
  }
  return true;
}

// What the screenpack's version changes, in words, for the Theme tab.
function versionChanges(spText, libText) {
  const a = readDefInfo(spText), b = readDefInfo(libText);
  const notes = [];
  if (a.faces.includes('9000,0') && !b.faces.includes('9000,0')) notes.push('faces from each character’s small portrait');
  const lv = (i) => { const k = i.read.keys.get('powerbar|p1.levelbars'); return k ? String(unq(k.raw)).trim() : '0'; };
  if (lv(a) !== lv(b)) notes.push(lv(a) === '0' ? 'level bars off' : 'level bars on');
  return notes;
}

// The screenpack in use's never-read fight defs, each with the library defs
// it is a version of. `onlyRef`: just that library def.
function screenpackVersions(roster, onlyRef) {
  let res = null;
  try { res = lifebarMod().resolveScreenpack(roster); } catch (e) { return []; }
  const fo = foreignFight(res);
  if (!fo || !fo.unused.length) return [];
  const packDir = path.dirname(res.motifPath);
  const refs = onlyRef ? [onlyRef] : library().flatMap((p) => p.defs.map((d) => ({ pack: p.slug, def: d.def, name: p.name })));
  const out = [];
  for (const u of fo.unused) {
    const abs = path.join(packDir, ...u.def.split('/'));
    const matches = [];
    for (const ref of refs) {
      const f = findDef(ref);
      if (f && versionMatch(abs, packDir, f)) matches.push({ pack: ref.pack, def: f.entry.def, name: ref.name || f.manifest.name, f });
    }
    if (matches.length) out.push({ def: u.def, abs, matches });
  }
  return out;
}

// The screenpack's version of library def `ref`, when the screenpack in use
// has one: { def, text }. Read only; the screenpack's file is never written.
function versionFor(roster, ref) {
  const v = screenpackVersions(roster, ref)[0];
  const text = v ? readText(v.abs) : null;
  return text === null ? null : { def: v.def, text };
}

// A library def as a parts source: absolute files for its sparks and sounds.
function packPart(ref) {
  const f = findDef(ref);
  if (!f) return null;
  const abs = (rel) => (rel ? path.join(f.dir, ...posix(rel).split('/')) : null);
  return {
    ref, entry: f.entry, dir: f.dir,
    width: f.entry.localcoord[0],
    fightfx: { sff: abs(f.entry.fightfx && f.entry.fightfx.sff), air: abs(f.entry.fightfx && f.entry.fightfx.air), scale: f.entry.fightfx ? f.entry.fightfx.scale : null },
    commonSnd: abs(f.entry.commonSnd),
    framespercount: f.entry.framespercount || 60,
  };
}

// The text a chosen library def ships from: the build's own edited copy
// (Settings > Engine) when there is one, else the library's. Null: neither
// can be read.
function libraryBase(ref, entry) {
  const own = readText(ownPathFor(ref.pack, entry.def));
  if (own !== null) return { text: own, own: true };
  const lib = readText(path.join(libDir(), ref.pack, ...posix(entry.def).split('/')));
  return lib !== null ? { text: lib, own: false } : null;
}

// Every folder the Studio lays mix files into for this bundle, whatever the
// mix is now: the export empties them all first, so switching a part back
// leaves nothing behind.
function staleDirs(roster) {
  const r = roster || require('./vfslib.js').readRoster();
  const folder = motifFolderOf(r);
  if (!folder) return [];
  const out = ['data/' + folder + '/' + MOUNT_DIR];
  try {
    const res = lifebarMod().resolveScreenpack(r);
    if (res && res.vpath) out.push(path.posix.dirname(res.vpath) + '/' + PARTS_DIR);
  } catch (e) { /* no screenpack def */ }
  return [...new Set(out)];
}

// EVERYTHING BOTH EXPORTS NEED, decided in one place. Null when the bundle
// uses its screenpack's own lifebars and effects untouched.
//
// The round clock: with the default 'screenpack', the screenpack's value is
// kept even over an edit of the library lifebar's own copy; an edit of that
// value in Settings > Engine switches the clock to 'lifebar' (lifebar.write),
// so the edit is what ships.
function mounts(roster) {
  const r = roster || require('./vfslib.js').readRoster();
  const mix = normalizeMix(r[MIX_KEY]);
  const lbChoice = mix.lifebar ? findDef(mix.lifebar) : null;
  const sparksRef = typeof mix.sparks === 'object' ? mix.sparks : null;
  const soundsRef = typeof mix.sounds === 'object' ? mix.sounds : null;
  const wantsSparks = !!(sparksRef || (lbChoice && mix.sparks === 'screenpack'));
  const wantsSounds = !!(soundsRef || (lbChoice && mix.sounds === 'screenpack'));
  if (!lbChoice && !wantsSparks && !wantsSounds) return null;
  const folder = motifFolderOf(r);
  const notes = [];
  if (!folder) {
    notes.push('this build’s screenpack sits at the data/ root, where the engine’s own files live; the lifebar mix needs a screenpack in a folder of its own');
    return null;
  }
  const sp = screenpackBase(r);
  const files = [];
  let base, defVpath, fightKey = null, defDirV, localcoord = null, width, framespercount = null;
  if (lbChoice) {
    // The screenpack's version of this def, when chosen and still there; it
    // is shipped with the library lifebar's art at the library def's path.
    const spv = mix.fightDef === 'screenpack' ? versionFor(r, mix.lifebar) : null;
    if (mix.fightDef === 'screenpack' && !spv) notes.push('the screenpack in use has no version of this lifebar’s fight.def; the lifebar’s own is used');
    const lbBase = spv ? { text: spv.text, own: false } : libraryBase(mix.lifebar, lbChoice.entry);
    if (!lbBase) return null;
    base = lbBase.text;
    for (const rel of lbChoice.entry.files.filter((x) => GAME_FILE.test(x))) {
      files.push({ vpath: 'data/' + folder + '/' + MOUNT_DIR + '/' + rel, abs: path.join(lbChoice.dir, ...rel.split('/')) });
    }
    defVpath = 'data/' + folder + '/' + MOUNT_DIR + '/' + lbChoice.entry.def;
    fightKey = MOUNT_DIR + '/' + lbChoice.entry.def;
    localcoord = lbChoice.entry.localcoord;
    width = lbChoice.entry.localcoord[0];
    const baseFpc = readDefInfo(base).framespercount || 60;
    if (mix.clock === 'screenpack' && sp.text !== null && sp.framespercount !== baseFpc) framespercount = sp.framespercount;
  } else {
    if (sp.text === null) {
      notes.push('the screenpack’s own fight screen could not be read, so its sparks and sounds cannot be swapped');
      return null;
    }
    base = sp.text;
    defVpath = sp.res.vpath;
    width = sp.width;
  }
  defDirV = path.posix.dirname(defVpath);
  // Only the library def's own relative files are renamed; a screenpack def is
  // composed in place.
  const renames = lbChoice && lbChoice.entry.renames && Object.keys(lbChoice.entry.renames).length ? lbChoice.entry.renames : null;
  const partOf = (choice) => (choice === 'screenpack' ? sp : packPart(choice));
  let sparks = null, sounds = null;
  if (wantsSparks) {
    const src = partOf(sparksRef || 'screenpack');
    if (src && src.fightfx && src.fightfx.sff && src.fightfx.air) {
      const sub = PARTS_DIR + '/sparks/';
      files.push({ vpath: defDirV + '/' + sub + path.basename(src.fightfx.sff), abs: src.fightfx.sff });
      files.push({ vpath: defDirV + '/' + sub + path.basename(src.fightfx.air), abs: src.fightfx.air });
      sparks = { sff: sub + path.basename(src.fightfx.sff), air: sub + path.basename(src.fightfx.air), scale: sparkScale(src.fightfx.scale, width, src.width) };
    } else notes.push('the chosen hit sparks source has no fightfx files; the lifebar’s own are used');
  }
  if (wantsSounds) {
    const src = partOf(soundsRef || 'screenpack');
    if (src && src.commonSnd) {
      const sub = PARTS_DIR + '/sounds/';
      files.push({ vpath: defDirV + '/' + sub + path.basename(src.commonSnd), abs: src.commonSnd });
      sounds = { snd: sub + path.basename(src.commonSnd) };
    } else notes.push('the chosen hit sounds source has no common.snd; the lifebar’s own are used');
  }
  const text = compose(base, { localcoord, sparks, sounds, framespercount, renames });
  const clean = [];
  if (lbChoice) clean.push('data/' + folder + '/' + MOUNT_DIR);
  clean.push(defDirV + '/' + PARTS_DIR);
  return {
    motifFolder: folder, fightKey, files,
    def: { vpath: defVpath, text },
    clean: [...new Set(clean)],
    notes,
    add004Off: !!lbChoice,
    mix,
  };
}

// Set the motif's [Files] fight value in a motif's text (first occurrence;
// inserted under [Files] when absent). Used on the generated motif.
function setMotifFight(defText, value) {
  const re = /^([ \t]*fight[ \t]*=)[^\r\n;]*/mi;
  const t = String(defText);
  // Only the one under [Files]: a comment line like ";@@ fight=fight.def" is
  // not a key (the regex requires the key at the line start).
  const lb = lifebarMod();
  const read = lb.readDef(t);
  const k = read.keys.get('files|fight');
  if (k) return t.slice(0, k.start) + value + t.slice(k.end);
  const eol = lb.eolOf(t);
  const files = read.sections.get('files');
  if (files) {
    const l = lb.lineIndex(t)[files.line];
    const at = l.end;
    return t.slice(0, at) + eol + 'fight = ' + value + t.slice(at);
  }
  return t.replace(re, '$1 ' + value);
}

// ---- a character's sprites, cheaply ------------------------------------------------
//
// Does a sprite file hold "g,n"? Only the sprite table is read, by position:
// a lifebar that draws each fighter's 9005,4000 is checked against every
// character without reading a single pixel.
const SPR_CACHE = new Map();
function sffKeysLight(file) {
  let st;
  try { st = fs.statSync(file); } catch (e) { return null; }
  const ck = file + '|' + st.size + '|' + st.mtimeMs;
  if (SPR_CACHE.has(ck)) return SPR_CACHE.get(ck);
  let fd;
  const keys = new Set();
  try {
    fd = fs.openSync(file, 'r');
    const h = Buffer.alloc(64);
    fs.readSync(fd, h, 0, 64, 0);
    if (h.slice(0, 11).toString('latin1') !== 'ElecbyteSpr') { SPR_CACHE.set(ck, null); return null; }
    if (h[15] === 2) {
      const sprOfs = h.readUInt32LE(36), n = h.readUInt32LE(40);
      const tab = Buffer.alloc(Math.min(n * 28, Math.max(0, st.size - sprOfs)));
      fs.readSync(fd, tab, 0, tab.length, sprOfs);
      for (let k = 0; k + 28 <= tab.length; k += 28) keys.add(tab.readUInt16LE(k) + ',' + tab.readUInt16LE(k + 2));
    } else {
      const n = h.readUInt32LE(20);
      let ofs = h.readUInt32LE(24);
      const sub = Buffer.alloc(32);
      for (let k = 0; k < n && ofs > 0 && ofs + 32 <= st.size; k++) {
        fs.readSync(fd, sub, 0, 32, ofs);
        keys.add(sub.readUInt16LE(12) + ',' + sub.readUInt16LE(14));
        const next = sub.readUInt32LE(0);
        if (!next || next <= ofs) break;
        ofs = next;
      }
    }
  } catch (e) { SPR_CACHE.set(ck, null); return null; } finally { if (fd !== undefined) try { fs.closeSync(fd); } catch (e) { /* closed */ } }
  SPR_CACHE.set(ck, keys);
  return keys;
}

function faceCoverage(roster, faces) {
  const odd = (faces || []).filter((f) => f !== '9000,0' && f !== '9000,1');
  if (!odd.length) return null;
  const modlib = require('./modlib.js');
  const seen = new Set();
  let total = 0;
  const have = new Map(odd.map((f) => [f, 0]));
  for (const c of (roster.chars || [])) {
    if (!c || !c.mountAs || c.kind || seen.has(c.mountAs)) continue;
    seen.add(c.mountAs);
    let sff = null;
    try { sff = modlib.charSffPath(c.mountAs); } catch (e) { sff = null; }
    const keys = sff ? sffKeysLight(sff) : null;
    if (!keys) continue;
    total++;
    for (const f of odd) if (keys.has(f)) have.set(f, have.get(f) + 1);
  }
  const worst = [...have].sort((a, b) => a[1] - b[1])[0];
  // Nothing to say when no character could be read, or every one has it.
  if (!total || worst[1] >= total) return null;
  return { sprite: worst[0], have: worst[1], total };
}

// ---- hit sparks coverage -------------------------------------------------------------
//
// The F effects this build's shared states draw by number, and the stock ones
// every character's hits reach for (common.const: 0-3, 10-12, 40, 60-62,
// 70-72, 100-102, 120, 130).
const STOCK_F = [0, 1, 2, 3, 10, 11, 12, 40, 60, 61, 62, 70, 71, 72, 100, 101, 102, 120, 130];
function airActions(text) {
  const out = new Set();
  for (const m of String(text || '').matchAll(/^\s*\[\s*begin\s+action\s+(-?\d+)\s*\]/gim)) out.add(Number(m[1]));
  return out;
}
function sharedFAnims(roster) {
  const L = layout();
  const out = new Set(STOCK_F);
  const texts = [];
  const folder = motifFolderOf(roster);
  if (folder) {
    const d = path.join(L.dir('themes'), folder);
    let ents = [];
    try { ents = fs.readdirSync(d); } catch (e) { ents = []; }
    for (const n of ents) if (/\.(cns|st|zss)$/i.test(n) && sizeOf(path.join(d, n)) < 8 * 1024 * 1024) texts.push(readText(path.join(d, n)));
  }
  try { const bi = require('./buildimport.js'); texts.push(readText(bi.buildStatesPath(L))); } catch (e) { /* none */ }
  for (const t of texts) {
    if (!t) continue;
    for (const m of t.matchAll(/\banim\s*[=:]\s*F\s*(\d+)/gi)) out.add(Number(m[1]));
  }
  return out;
}

// ---- what the Theme card reads -------------------------------------------------------

// What the lifebar's shape does in this build, by case.
const ASPECT_NOTES = {
  narrow: 'a 4:3 lifebar in a 16:9 build: the engine draws it in the middle 4:3 of the screen, with the sides empty',
  wide: 'a widescreen lifebar: on a 4:3 stage the fight takes the stage’s shape and the lifebar shrinks to fit its width, anchored at the top',
};
function aspectNote(lc, roster) {
  if (!lc) return null;
  const a = lc[0] / lc[1];
  const s = (roster && roster.settings) || {};
  const gw = Number(s['Video.GameWidth'] || 1280), gh = Number(s['Video.GameHeight'] || 720);
  const g = gw / gh;
  if (Math.abs(a - 4 / 3) < 0.02 && g > 1.5) return ASPECT_NOTES.narrow;
  if (a > 1.5 && Number(s['Video.FightAspectWidth'] || -1) <= 0) return ASPECT_NOTES.wide;
  return null;
}

// The round clock the build ships with a library lifebar, read from the text
// mounts() composes (the own edited copy when there is one), by mounts()' own
// rule. Null without a library lifebar.
function clockReport(roster, known) {
  const r = roster || require('./vfslib.js').readRoster();
  const k = known || {};
  const mix = k.mix || normalizeMix(r[MIX_KEY]);
  const lbChoice = mix.lifebar ? findDef(mix.lifebar) : null;
  const lbBase = k.lbBase || (lbChoice ? libraryBase(mix.lifebar, lbChoice.entry) : null);
  if (!lbChoice || !lbBase) return null;
  let sp = k.sp;
  if (sp === undefined) { try { sp = screenpackBase(r); } catch (e) { sp = null; } }
  const lbFpc = readDefInfo(lbBase.text).framespercount || 60;
  const spFpc = sp && sp.text !== null ? sp.framespercount : null;
  const used = mix.clock === 'screenpack' && spFpc !== null ? spFpc : lbFpc;
  return { clock: mix.clock, lifebar: lbFpc, screenpack: spFpc === null ? lbFpc : spFpc, used, edited: lbBase.own };
}

function state(roster) {
  const r = roster || require('./vfslib.js').readRoster();
  const mix = normalizeMix(r[MIX_KEY]);
  const lib = library();
  const problems = [];
  const lbChoice = mix.lifebar ? findDef(mix.lifebar) : null;
  if (mix.lifebar && !lbChoice) problems.push('the lifebars this bundle chose are gone from its library: ' + mix.lifebar.pack + ' / ' + mix.lifebar.def);
  for (const k of ['sparks', 'sounds']) {
    if (typeof mix[k] !== 'object' || findDef(mix[k])) continue;
    const { pack, def } = mix[k];
    problems.push(k === 'sparks' ? 'the hit sparks source this bundle chose is gone: ' + pack + ' / ' + def
      : 'the hit sounds source this bundle chose is gone: ' + pack + ' / ' + def);
  }
  let sp = null;
  try { sp = screenpackBase(r); } catch (e) { sp = null; }
  const folder = motifFolderOf(r);
  if (!folder && (mix.lifebar || mix.sparks !== 'lifebar' || mix.sounds !== 'lifebar')) {
    problems.push('this build’s screenpack sits at the data/ root; the lifebar mix needs a screenpack in a folder of its own');
  }
  const report = { portraits: null, aspect: null, clock: null, add004: null, sparks: null, engineFx: null, bytes: 0, problems };
  const spv = lbChoice && mix.fightDef === 'screenpack' ? versionFor(r, mix.lifebar) : null;
  const lbBase = lbChoice ? (spv ? { text: spv.text, own: false } : libraryBase(mix.lifebar, lbChoice.entry)) : null;
  if (lbChoice && !lbBase) problems.push('the lifebar file lifebars/' + mix.lifebar.pack + '/' + lbChoice.entry.def + ' is missing from this bundle’s library, so the build keeps the screenpack’s own');
  if (lbChoice && lbBase) {
    try { report.portraits = faceCoverage(r, spv ? readDefInfo(spv.text).faces : lbChoice.entry.faces); } catch (e) { report.portraits = null; }
    if (report.portraits) {
      // The sections that draw it: [Face] is every single match, the team
      // variants only their own modes.
      const secs = [];
      try {
        const rd = lifebarMod().readDef(lbBase.text);
        for (const [id, v] of rd.keys) {
          const m = /^([a-z_0-9 ]*face)\|/.exec(id);
          const pr = m && /face\.spr$/.test(id) ? numPair(v.raw) : null;
          if (pr && pr[0] + ',' + pr[1] === report.portraits.sprite && !secs.includes(m[1])) secs.push(m[1]);
        }
      } catch (e) { /* unknown */ }
      report.portraits.sections = secs;
      report.portraits.singles = secs.includes('face');
    }
    if (report.portraits) {
      const alt = lbChoice.manifest.defs.find((d) => d.def !== lbChoice.entry.def && (d.faces || []).every((f) => f === '9000,0' || f === '9000,1'));
      report.portraits.variant = alt ? { pack: mix.lifebar.pack, def: alt.def, name: alt.name } : null;
    }
    report.aspect = aspectNote(lbChoice.entry.localcoord, r);
    report.clock = clockReport(r, { mix, lbBase, sp });
    report.bytes = lbChoice.entry.bytes || 0;
    const efx = (lbChoice.entry.engineFx || []).filter((k) => (/^fightfx/.test(k) ? mix.sparks === 'lifebar' : mix.sounds === 'lifebar'));
    if (efx.length) report.engineFx = { sparks: efx.some((k) => /^fightfx/.test(k)), sounds: efx.includes('common.snd') };
  }
  const isAdd004 = (() => { try { return add004Build(r); } catch (e) { return false; } })();
  if (isAdd004) {
    const off = (() => { try { return add004Off(r); } catch (e) { return false; } })();
    report.add004 = { build: true, switchedOff: off ? ADD004_OFF.map((b) => ADD004_NAMES[b]) : [], resultPanel: null };
    // The result panel (bit 32) is add004's too, and while it shows after a
    // KO it hides the lifebars; say so when the copy characters run keeps it.
    try {
      const folderAbs = folder ? path.join(layout().dir('themes'), folder) : null;
      for (const n of folderAbs ? fs.readdirSync(folderAbs) : []) {
        if (!/\.(cns|st)$/i.test(n)) continue;
        const tx = readText(path.join(folderAbs, n));
        if (!tx || !/>>@Config\.System_Switch>>/.test(tx)) continue;
        const on = add004BitOn(off ? add004Switches(tx).text : tx, 32);
        if (on !== null) { report.add004.resultPanel = on; break; }
      }
    } catch (e) { /* unknown */ }
  }
  // Sparks coverage: the effects the build's shared states and every
  // character's standard hits draw, against the source the mix will use.
  try {
    let air = null;
    if (typeof mix.sparks === 'object') { const p = packPart(mix.sparks); air = p && p.fightfx.air; }
    else if (mix.sparks === 'lifebar' && lbChoice) { const p = packPart(mix.lifebar); air = p && p.fightfx.air; }
    if (air) {
      const have = airActions(readText(air));
      const need = sharedFAnims(r);
      const missing = [...need].filter((n) => !have.has(n)).sort((a, b) => a - b);
      if (missing.length) report.sparks = { missing: missing.slice(0, 40), count: missing.length };
    }
  } catch (e) { /* no report */ }
  const srcs = (() => { try { return sources(); } catch (e) { return []; } })();
  return {
    ok: true,
    mix,
    screenpack: sp && sp.text !== null ? {
      name: (sp.res.motifPath && motifInfo(sp.res.motifPath).name) || folder,
      def: sp.res.sourceRel, localcoord: sp.info.localcoord || (sp.res.motifPath ? motifInfo(sp.res.motifPath).localcoord : null),
      framespercount: sp.framespercount, faces: sp.info.faces,
      hasSparks: !!(sp.fightfx.sff && sp.fightfx.air), hasSounds: !!sp.commonSnd,
      foreign: (() => {
        let fo = null;
        try { fo = foreignFight(sp.res); } catch (e) { return null; }
        // Its never-read def as a version of a library lifebar: the chosen
        // one first, so the line offers what is in use.
        try {
          const v = fo && screenpackVersions(r)[0];
          if (v) {
            const cur = mix.lifebar && v.matches.find((m) => m.pack === mix.lifebar.pack && m.def.toLowerCase() === posix(mix.lifebar.def).toLowerCase());
            const m = cur || v.matches[0];
            const libText = readText(path.join(m.f.dir, ...posix(m.f.entry.def).split('/'))) || '';
            fo.version = {
              def: v.def, pack: m.pack, lifebar: m.def, name: m.name, chosen: !!cur,
              active: !!cur && mix.fightDef === 'screenpack',
              changes: versionChanges(readText(v.abs) || '', libText),
            };
          }
        } catch (e) { /* no offer */ }
        return fo;
      })(),
    } : null,
    motifFolder: folder,
    library: lib,
    sources: srcs,
    report,
  };
}

// ---- the preview ---------------------------------------------------------------------
//
// The bars, portraits frames and timer of a library def as positioned sprites,
// for the Theme card to draw. Text and the character faces are left out: a
// preview of the frame the lifebar puts around them.
function preview(ref) {
  const f = findDef(ref);
  if (!f) throw new Error('no such lifebar: ' + (ref && ref.pack) + ' / ' + (ref && ref.def));
  const own = readText(ownPathFor(ref.pack, f.entry.def));
  const text = own !== null ? own : readText(path.join(f.dir, ...posix(f.entry.def).split('/')));
  const lb = lifebarMod();
  const read = lb.readDef(text || '');
  const get = (sec, key) => { const k = read.keys.get(sec + '|' + key); return k ? unq(k.raw) : null; };
  // A key for one player: its own (p1.x) or one naming it through Ikemen's
  // selectors (p*.x, p1|p2.x), which the engine expands for p1 and p2.
  const selRe = new RegExp('^(' + SEL + ')\\.(.+)$');
  const getP = (sec, p, rest) => {
    const own = get(sec, p + '.' + rest);
    if (own !== null) return own;
    for (const [id, k] of read.keys) {
      const tid = tightId(id);
      if (!tid.startsWith(sec + '|')) continue;
      const m = selRe.exec(tid.slice(sec.length + 1));
      if (m && m[2] === rest && selHas(m[1], [p])) return unq(k.raw);
    }
    return null;
  };
  // First frame of an inline [Begin Action]: group, index, x, y and its flip.
  const actions = new Map();
  let cur = null;
  for (const raw of String(text || '').split(/\r?\n/)) {
    const l = raw.replace(/;.*$/, '').trim();
    const b = /^\[\s*begin\s+action\s+(-?\d+)\s*\]/i.exec(l);
    if (b) { cur = Number(b[1]); continue; }
    if (/^\[/.test(l)) { cur = null; continue; }
    if (cur === null || actions.has(cur) || !l || /^(clsn|loopstart|interpolate)/i.test(l)) continue;
    const fr = /^(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)(?:\s*,\s*(-?\d+)(?:\s*,\s*([HVhv]*))?)?/.exec(l);
    if (fr) actions.set(cur, { g: +fr[1], i: +fr[2], x: +fr[3], y: +fr[4], h: /h/i.test(fr[6] || '') ? -1 : 1, v: /v/i.test(fr[6] || '') ? -1 : 1 });
  }
  const els = [];
  // One element, placed the way the engine draws it: an action frame's
  // offset turns with the element's facing and grows with its scale
  // (anim.go: xoff = xs * Xoffset). A frame's own H/V flip mirrors the
  // picture; its offset was already negated when the action was read
  // (anim.go:94-99), so it does not turn again here.
  const element = (sec, el, look, base) => {
    let spr = numPair(look('spr'));
    let dx = 0, dy = 0, fh = 1, fv = 1;
    const an = parseInt(look('anim'), 10);
    if (isFinite(an) && an >= 0 && actions.has(an)) { const a = actions.get(an); spr = [a.g, a.i]; dx = a.x; dy = a.y; fh = a.h; fv = a.v; }
    if (!spr || spr[0] < 0) return;
    const off = numPair(look('offset')) || [0, 0];
    const sc = numPair(look('scale')) || [1, 1];
    const lf = parseInt(look('facing'), 10) === -1 ? -1 : 1;
    const lv = parseInt(look('vfacing'), 10) === -1 ? -1 : 1;
    const layer = parseInt(look('layerno'), 10) || 0;
    els.push({ sec, el, g: spr[0], i: spr[1], x: base[0] + off[0] + dx * lf * sc[0], y: base[1] + off[1] + dy * lv * sc[1], sx: sc[0], sy: sc[1], facing: lf * fh, vfacing: lv * fv, layer });
  };
  for (const sec of ['lifebar', 'powerbar', 'guardbar', 'stunbar', 'face', 'name']) {
    for (const p of ['p1', 'p2']) {
      const pos = numPair(getP(sec, p, 'pos'));
      if (!pos) continue;
      for (const n of ['bg0', 'bg1', 'bg2', 'mid', 'front', 'shadow', 'bg', 'top']) element(sec, p + '.' + n, (k) => getP(sec, p, n + '.' + k), pos);
    }
  }
  const tpos = numPair(get('time', 'pos'));
  if (tpos) for (const n of ['bg', 'top']) element('time', n, (k) => get('time', n + '.' + k), tpos);
  // The sprite file the def draws from, and each element's size and axis, so
  // the page can place it without decoding anything itself.
  const defRelDir = path.posix.dirname(posix(f.entry.def)) === '.' ? '' : path.posix.dirname(posix(f.entry.def));
  let sffVal = posix(unq(get('files', 'sff') || ''));
  const ren = f.entry.renames || {};
  if (sffVal && Object.prototype.hasOwnProperty.call(ren, unq(get('files', 'sff') || ''))) sffVal = posix(ren[unq(get('files', 'sff') || '')]);
  let sffAbs = null;
  if (sffVal) {
    const hit = findCI(defRelDir ? path.join(f.dir, ...defRelDir.split('/')) : f.dir, sffVal);
    if (hit && isFile(hit) && inside(f.dir, hit)) sffAbs = hit;
  }
  const dec = require('./tools/sff-decode.js');
  let sff = null;
  try { sff = sffAbs ? dec.readSff(sffAbs) : null; } catch (e) { sff = null; }
  const drawn = [];
  for (const e of els) {
    const g = sff ? dec.spriteGeom(sff, e.g, e.i) : null;
    if (!g || !g.w || !g.h) continue;
    drawn.push(Object.assign(e, { w: g.w, h: g.h, ax: g.axisX, ay: g.axisY }));
  }
  return { localcoord: f.entry.localcoord, sff: sffAbs ? posix(path.relative(f.dir, sffAbs)) : null, elements: drawn };
}

// A sprite of a library pack's own sprite file, as PNG bytes.
function packSpritePng(pack, sffRel, group, index) {
  const s = String(pack || '');
  if (!SLUG_RE.test(s)) return null;
  const abs = path.join(libDir(), s, ...posix(sffRel).split('/'));
  if (!inside(path.join(libDir(), s), abs) || !isFile(abs)) return null;
  try {
    const dec = require('./tools/sff-decode.js');
    const sff = dec.readSff(abs);
    if (!sff) return null;
    const png = dec.spritePng(sff, group, index);
    const geom = dec.spriteGeom ? dec.spriteGeom(sff, group, index) : null;
    return png ? { png, geom } : null;
  } catch (e) { return null; }
}

module.exports = {
  LIBRARY, MANIFEST, MIX_KEY, MOUNT_DIR, PARTS_DIR, REQUIRED, ADD004_OFF,
  isFightDef, readDefInfo, scanDir, install, looksLikeLifebarPack, lift, sources, bundleDirs, library, removePack,
  normalizeMix, choose, sparkScale, compose, add004Switches, add004Build, add004Off, add004ThemeFiles,
  mounts, staleDirs, screenpackVersions, versionFor, clockReport, setMotifFight, ownPathFor, findDef, state, preview, packSpritePng, sffKeysLight, add004HudFlags, add004BitOn, refusalText,
  // The checked deletes, for every remove of the owner's content (modlib,
  // charedit, lifebar, engineconst, bundles, the desktop export).
  rmTree, rmFile,
};
