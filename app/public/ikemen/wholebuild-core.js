// Is this folder a WHOLE BUILD - the folder somebody plays MUGEN or Ikemen GO
// out of - rather than one character or one stage?
//
// The Studio's add path asks this before it copies anything: a build dragged
// onto the Characters box, dropped on the roster, picked with Browse or pasted
// as a path used to go in as a "character". The answer comes from the folder's
// LISTING alone - the names at its top, and the names inside its data/ and
// save/ folders (LOOKS_IN) - so a dropped folder can be answered in the page
// from its entries and a path on disk by the server from three directory
// reads, by this one rule. Nothing is opened.
//
// Shared by the Studio page (a drop) and buildimport.js wholeBuildAt (a path,
// through /api/add-local). ONE rule on purpose: two copies would drift, and
// the two ways in would disagree about the same folder.
//
// A WHOLE BUILD is any one of:
//   1. the program at its top: mugen.exe, or Ikemen_GO.exe or one of its
//      variants (Ikemen_GO_x64.exe, "Ikemen GO.exe" ...), in any case;
//   2. data/ and chars/ at its top, with a select.def in data/ or at the top;
//   3. chars/ and a config the build importer reads (data/mugen.cfg, or
//      save/config.ini, or save/config.json before Ikemen GO 1.0). That is
//      buildimport.js inspect()'s own gate, so every folder the importer would
//      take is offered to it.
//
// Being offered the import is not being importable. The importer's Read still
// decides, and says why when it will not (a build with the program and no
// config, for one).
//
// `kind` is which engine's build, for the words only: the config's when there
// is one (mugen.cfg first, as inspect() reads it), else the program's, else
// MUGEN. `by` says which rule answered: 'program', 'folders' or 'config'.
//
// Pure: no fs, no DOM.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.wholeBuildCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // The only folders below the top the rule reads. A caller lists exactly
  // these (null for one the folder does not have) and nothing deeper.
  const LOOKS_IN = ['data', 'save'];

  const MUGEN_EXE = /^mugen\.exe$/i;
  const IKEMEN_EXE = /^ikemen[ _-]?go.*\.exe$/i;

  const lowerSet = (names) => new Set((names || []).map((n) => String(n).toLowerCase()));

  // listing: { top: [{ name, dir }], data: [names] | null, save: [names] | null }
  // -> { kind: 'mugen' | 'ikemen', by, exe } or null.
  function fromListing(listing) {
    const ls = listing || {};
    const top = Array.isArray(ls.top) ? ls.top : [];
    const files = top.filter((e) => e && !e.dir).map((e) => String(e.name));
    const dirs = lowerSet(top.filter((e) => e && e.dir).map((e) => e.name));
    const data = lowerSet(dirs.has('data') ? ls.data : null);
    const save = lowerSet(dirs.has('save') ? ls.save : null);

    const exe = files.find((n) => MUGEN_EXE.test(n)) || files.find((n) => IKEMEN_EXE.test(n)) || null;
    const cfgKind = data.has('mugen.cfg') ? 'mugen'
      : (save.has('config.ini') || save.has('config.json')) ? 'ikemen' : null;
    const kind = cfgKind || (exe ? (MUGEN_EXE.test(exe) ? 'mugen' : 'ikemen') : 'mugen');

    if (exe) return { kind, by: 'program', exe };
    if (!dirs.has('chars')) return null;
    const selectDef = data.has('select.def') || files.some((n) => n.toLowerCase() === 'select.def');
    if (dirs.has('data') && selectDef) return { kind, by: 'folders', exe: null };
    if (cfgKind) return { kind, by: 'config', exe: null };
    return null;
  }

  return { fromListing, LOOKS_IN, MUGEN_EXE, IKEMEN_EXE };
});
