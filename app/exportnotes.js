'use strict';
//
// THE BACK OF THE BOOKLET: what an export hands its result page besides the
// folder (studio.html showExportCard, the NOTES page and the back cover).
//
//   forExport({ kind, roster, charFixes, budgetMs }) -> notes
//
// Two sources, both already the Studio's own:
//   - the CONTENT AUDIT (contentaudit.js, GRAIL 3.2b), headline tier only -
//     the "Breaks" band of the Audit card: files the def names that are not
//     there, fatal structure, and a literal state number no loaded file
//     defines in code the character runs. Run per character with pixel
//     comparison off (the Audit card's "check every character" sweep does the
//     same, about 0.12 s a character on the Main roster). An export of a big
//     build must not wait minutes for its notes, so the audit stops at
//     `budgetMs` and says how many it did not read; the Audit card reads them.
//   - WHAT THE EXPORT DID TO ITS COPY: the export's own charFixes (desktop.js
//     fixCopiedCharacters, the website build's vfslib overlay - one shape,
//     `{ file: 'chars/<mountAs>/<rel>', kind, ... }`), grouped by character.
//     The character's own files are only ever read; every repair is in the copy.
//
// THE COUNTS ARE THE STUDIO'S. `characters` is what the Characters tab counts
// (studio.html realChars: roster entries that are not an empty cell, kind
// dummy / random), `stages` the roster's stage list - of the roster the build
// was made from (a public website build: its publicChars cut).
//
// Nothing here writes a file, and nothing here is H-aware: the notes name
// state numbers, files and lines, never a state's label or a command's text,
// the way the Audit card does.
const path = require('path');

// The repairs each export makes in its copy, by kind (desktop.js
// fixCopiedCharacters / vfslib build). `audit` = a problem in the character's
// files the export repaired; `choice` = the owner's own setting carried out
// (portraits fitted, palettes added, slot order, the Command List written) -
// noted, not an audit finding.
const KINDS = {
  'ai-switch-release': 'audit',
  'v2-own-palettes': 'audit',
  'v1-base-palette': 'audit',
  'mugen-hit-priority': 'audit',
  'plus-frames': 'audit',
  'portrait-fit': 'choice',
  'palettes': 'choice',
  'palette-order': 'choice',
  // the Command List writer (cmdlist.js): on by default, switched per character
  // on the Moves page - the owner's setting carried out, not a repair
  'command-list': 'choice',
};

const realCharsOf = (roster) => ((roster && roster.chars) || []).filter((c) => c && !c.kind);

// One problem of the audit's headline, as a note line: what, and where (file:line).
function breaksOf(r) {
  const out = { missing: [], fatal: [], freezes: [] };
  for (const m of (r.load && r.load.missing) || []) out.missing.push({ key: m.key, rel: m.rel });
  for (const x of (r.structure || []).filter((s) => s.fatal)) out.fatal.push({ kind: x.kind, detail: x.detail, file: x.file || null, line: x.line || null });
  // freezes: one per state number, every place that asks for it
  const byN = new Map();
  for (const e of (r.states || []).filter((s) => s.tier === 'freezes' && s.n !== null && s.n !== undefined)) {
    if (!byN.has(e.n)) byN.set(e.n, { n: e.n, sites: [], definedIn: null });
    const f = byN.get(e.n);
    if (e.file && !f.sites.some((s) => s.file === e.file && s.line === e.line)) f.sites.push({ file: e.file, line: e.line || null });
    for (const nt of e.notes || []) {
      const m = /^defined only in (.+) \(not in \[Files\]\)$/.exec(nt);
      if (m) f.definedIn = m[1];
    }
  }
  out.freezes = [...byN.values()].sort((a, b) => a.n - b.n);
  return out;
}

function titleOf(kind, roster) {
  const set = (roster && roster.settings) || {};
  const wt = String(set['Config.WindowTitle'] || '').trim();
  if (kind === 'desktop' && wt && wt !== 'Ikemen GO') return wt;
  if (kind === 'web') return String(roster.siteTitle || '').trim() || 'WebMUGEN';
  return String((roster && roster.siteTitle) || '').trim();
}

function forExport({ kind, roster, charFixes, budgetMs = 20000, audit } = {}) {
  roster = roster || {};
  const real = realCharsOf(roster);
  const seen = new Set();
  const chars = [];
  for (const c of real) {
    if (!c.mountAs || seen.has(c.mountAs)) continue;
    seen.add(c.mountAs);
    chars.push({ id: c.mountAs, folder: c.folder || c.mountAs });
  }

  // what the export did, per character
  const fixes = {};
  const choices = {};
  for (const f of charFixes || []) {
    const parts = String(f.file || '').split('/');
    if (parts[0] !== 'chars' || !parts[1]) continue;
    const id = parts[1], rel = parts.slice(2).join('/');
    const group = KINDS[f.kind] === 'choice' ? choices : fixes;
    const k = f.kind || 'other';
    if (!group[k]) group[k] = [];
    let row = group[k].find((x) => x.id === id);
    if (!row) { row = { id, files: [], count: 0 }; group[k].push(row); }
    if (rel && !row.files.includes(rel)) row.files.push(rel);
    if (f.kind === 'mugen-hit-priority') row.count += f.hitdefs || 0;
    else if (f.kind === 'ai-switch-release') row.count += f.switches || 0;
    else if (f.kind === 'v2-own-palettes') { row.slots = (row.slots || []).concat(f.slots || []); row.count += (f.slots || []).length; }
    else if (f.kind === 'v1-base-palette') { row.count += f.replaced || 0; row.axis = (row.axis || 0) + ((f.axis || []).length); }
    else if (f.kind === 'plus-frames') { row.count += f.links || 0; row.unfixable = (row.unfixable || 0) + ((f.unfixable || []).length); }
    else row.count += 1;
  }

  // the audit's headline, within the budget
  const run = audit || ((id) => require('./modlib.js').contentAudit(id, { dups: false }));
  const t0 = Date.now();
  const breaks = [];
  const skipped = [];
  let audited = 0, worth = 0, failed = 0;
  for (const c of chars) {
    if (Date.now() - t0 > budgetMs) { skipped.push(c.id); continue; }
    let r = null;
    try { r = run(c.id); } catch (e) { failed++; continue; }
    if (!r || !r.summary) { failed++; continue; }
    audited++;
    if (r.summary.worthALook) worth++;
    if (r.summary.headline > 0) {
      const b = breaksOf(r);
      breaks.push(Object.assign({ id: c.id, def: r.def, headline: r.summary.headline }, b));
    }
  }

  return {
    kind,
    title: titleOf(kind, roster),
    characters: real.length,
    stages: ((roster && roster.stages) || []).length,
    chars,
    breaks,
    fixes,
    choices,
    audit: { audited, of: chars.length, skipped, failed, worthALook: worth, ms: Date.now() - t0 },
  };
}

module.exports = { forExport, breaksOf, KINDS };
