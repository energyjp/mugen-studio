'use strict';
// A SCREENPACK'S OWN COMMON STATES, as [Common] lines - one answer for both
// exports and the Settings > Engine list.
//
// A pack like Infinite Legacy X says "change data/action.zss to
// data/ilx/action.zss" in its instructions: its own action and tag code, made
// for its lifebars, IN PLACE of the engine's. That is a substitution inside
// the engine's States list, not an extra file - so it is written exactly so:
// the base list (the engine's, or an imported Ikemen GO build's own) with the
// pack's file standing where the engine's file for that role stood. Systems
// the engine does not have at all (a shadow assist) go on their own key,
// States3, after it.
//
// THE BUILD WINS. An imported build that brings its own file for a role keeps
// it; a build whose list leaves a role out does not get the pack's added. The
// Settings page wins over both (the callers check roster.settings).
//
// Nothing here runs the compiler. A file is listed only while the lint
// (zsslint.js, re-run on every read of the manifest) passes it, it exists on
// disk, and its path has no comma or semicolon - the engine splits the list on
// both. The training role is never replaced: this build's training.zss
// carries the fork's own training-mode additions.

const fs = require('fs');
const path = require('path');

// A wired file that draws text with font -1 draws with the debug font
// ([Debug] Font): `font: -1` in ZSS, PotS's `mapSet{map: "..._font..."; value: -1}`
// convention, or `font = -1` in CNS.
function drawsWithDebugFont(text, kind) {
  const t = String(text || '');
  if (kind === 'cns') return /^\s*font\s*=\s*-1\b/im.test(t.replace(/;.*$/gm, ''));
  const code = require('./zsslint.js').codeLines(t, 'zss').join('\n');
  // codeLines blanks string contents, so the map name is read from the raw text.
  return /\bfont\s*:\s*-1\b/i.test(code)
    || /map\s*:\s*"[^"]*font[^"]*"\s*;\s*value\s*:\s*-1\b/i.test(t.split(/\r?\n/).map((l) => l.replace(/#.*$/, '')).join('\n'));
}

const posix = (p) => String(p || '').replace(/\\/g, '/');
const split = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);
const stem = (p) => posix(p).split('/').pop().replace(/\.[^.]*$/, '').toLowerCase();

// The theme folder for the roster's motif, as the disk spells it.
function motifFolder(roster) {
  const m = /^data\/([^/]+)\/system\.def$/i.exec(String((roster && roster.motif) || ''));
  if (!m) return null;
  const themes = require('./layout.js').dir('themes');
  let ents = [];
  try { ents = fs.readdirSync(themes, { withFileTypes: true }); } catch (e) { return null; }
  const hit = ents.find((e) => e.isDirectory() && e.name === m[1]) || ents.find((e) => e.isDirectory() && e.name.toLowerCase() === m[1].toLowerCase());
  return hit ? { name: hit.name, dir: path.join(themes, hit.name) } : null;
}

// forRoster(roster, { ownCommon }) ->
//   { folder, lines: [{key, value, from: 'theme'}], debugFont, wired: [theme rel],
//     report: [text], engagedIfUsed }
// or null when the roster's screenpack has nothing to add (no motif, no
// manifest, its common states off, nothing usable). `lines` can be empty with
// a report saying why.
function forRoster(roster, opts) {
  const o = opts || {};
  const where = motifFolder(roster);
  if (!where) return null;
  const themeopts = require('./themeopts.js');
  const m = themeopts.readManifest(where.dir);
  if (!m || !m.common) return null;
  const c = m.common;
  if (c.on === false) return null;
  // Inside the theme folder only, whatever the manifest says.
  const exists = (rel) => { try { return themeopts.insideTheme(where.dir, rel) && fs.statSync(path.join(where.dir, ...posix(rel).split('/'))).isFile(); } catch (e) { return false; } };
  const roles = (c.roles || []).filter((r) => r.current && r.current !== '@engine' && r.role !== 'training')
    .map((r) => ({ r, pick: (r.choices || []).find((x) => x.file === r.current) }))
    .filter((x) => x.pick && x.pick.ok && exists(x.pick.file));
  const adds = (c.additions || []).filter((a) => a.ok && a.on && exists(a.file));
  if (!roles.length && !adds.length) return null;
  let name = where.name;
  try {
    const nm = /^\s*name\s*=\s*"?([^"\r\n;]+)/mi.exec(fs.readFileSync(path.join(where.dir, 'system.def'), 'latin1').slice(0, 4096));
    name = (nm && nm[1].trim()) || where.name;
  } catch (e) { name = where.name; }
  const out = { folder: where.name, dir: where.dir, name, lines: [], debugFont: null, wired: [], report: [], engagedIfUsed: false };
  // The engine would split the path where the folder name has a comma or a
  // semicolon, and every character would then fail to load.
  if (/[,;]/.test(where.name)) {
    out.report.push('This screenpack’s folder name (' + where.name + ') has a comma or a semicolon, which the engine would split, so its common states are not used. Rename the folder to use them.');
    return out;
  }
  const vp = (rel) => 'data/' + where.name + '/' + posix(rel);
  let own = o.ownCommon;
  if (own === undefined) { try { own = require('./buildimport.js').buildCommon(); } catch (e) { own = null; } }
  const ownStates = own && (own.lines || []).find((l) => l.key === 'States');
  const ed = require('./enginedata.js');
  const baseList = ownStates ? split(ownStates.value) : ed.commonConfig({ desktop: false }).states.slice();
  const list = baseList.slice();
  // Which role a base entry plays: its name, else a statedef header in common
  // with the engine's file for the role (an imported activetag.zss is a tag).
  let engineRoles = null;
  const roleOfEntry = (entry) => {
    const s = stem(entry);
    engineRoles = engineRoles || themeopts.engineRoles();
    if (engineRoles.some((x) => x.role === s)) return s;
    let text = null;
    const f = own && (own.files || []).find((x) => x.vpath.toLowerCase() === entry.toLowerCase());
    if (f) text = Buffer.isBuffer(f.text) ? f.text.toString('latin1') : String(f.text || '');
    if (text === null) return null;
    const hit = themeopts.roleOf(entry, text, engineRoles);
    return hit ? hit.role : null;
  };
  let substituted = false;
  for (const { r, pick } of roles) {
    const at = list.findIndex((e) => e.toLowerCase() === String(r.engine).toLowerCase());
    if (at >= 0) {
      list[at] = vp(pick.file);
      out.wired.push(posix(pick.file));
      substituted = true;
      continue;
    }
    const other = list.find((e) => roleOfEntry(e) === r.role);
    if (other) out.report.push('This bundle’s imported build brings its own ' + r.role + ' file (' + posix(other).split('/').pop() + '), so that one is used.');
    else out.report.push('This bundle’s imported build leaves ' + r.role + ' out of its common states, so this screenpack’s isn’t added either.');
  }
  if (substituted) out.lines.push({ key: 'States', value: list.join(', '), from: 'theme' });
  if (adds.length) {
    out.lines.push({ key: themeopts.THEME_STATES_KEY, value: adds.map((a) => vp(a.file)).join(', '), from: 'theme' });
    for (const a of adds) out.wired.push(posix(a.file));
  }
  // The pack's debug font, while a wired file draws with font -1 - and the
  // pack's choice unless the switch keeps the Studio's own. Its image must load
  // from the installed folder, or the game stops at boot.
  const df = c.debugFont;
  const dfAbs = df && df.file && exists(df.file) ? path.join(where.dir, ...posix(df.file).split('/')) : null;
  if (dfAbs && !/[,;]/.test(df.file) && themeopts.fontImage(dfAbs, [path.dirname(dfAbs), where.dir])) {
    const engaged = out.wired.some((rel) => {
      try { return drawsWithDebugFont(fs.readFileSync(path.join(where.dir, ...rel.split('/')), 'latin1'), /\.cns$/i.test(rel) ? 'cns' : 'zss'); } catch (e) { return false; }
    });
    out.engagedIfUsed = engaged;
    if (engaged && df.use !== false) out.debugFont = { vpath: vp(df.file), scale: df.scale || null, bitmap: !!df.bitmap };
  }
  return out;
}

// The build's own [Common] lines and the screenpack's, as one list for the
// config: a key appears once (the engine takes the first line of a key), and
// the theme's States stands in for the build's because it was computed FROM
// it. Each line says where it came from, so the config can say so too.
function mergeLines(ownLines, themeLines) {
  const theme = (themeLines || []).map((l) => Object.assign({}, l, { from: 'theme' }));
  const keys = new Set(theme.map((l) => l.key.toLowerCase()));
  const own = (ownLines || []).filter((l) => !keys.has(String(l.key).toLowerCase()))
    .map((l) => Object.assign({}, l, { from: l.from || 'build' }));
  return own.concat(theme);
}

module.exports = { forRoster, mergeLines, drawsWithDebugFont, motifFolder };
