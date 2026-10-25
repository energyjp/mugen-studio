'use strict';
//
// THE H GALLERY'S PROTOTYPE MODES: the registry.
//
// A prototype mode is a way of playing scenes the core gallery does not have
// (mob givers, characters that are galleries themselves, KO scenes). Each is
// ONE module here, gallerymodes/<id>.js (helper files of its own are named
// gallerymodes/<id>-<part>.js and required by it), plus its own test. A mode
// can be removed at any time: delete its file, its ROWS and LOAD lines and its
// test. Nothing else names it - the core's seams are generic, the Mods tab row
// comes from ROWS, and make-portable.js and make-kit.js copy this folder
// whole.
//
// THE SWITCH, two layers:
//   in code   ROWS below (a mode not listed is never loaded);
//   per build the bundle's Mods tab: one row per mode (modmgr.js builds them
//             from ROWS, id = `addon`), hOnly, ON by default, present only
//             where the gallery's own row ('hgallery') is, and off whenever
//             that row is off. Stored like every add-on in roster.modsOff.
//
// enabled(roster) -> the modules of the modes that are on for that roster.
// load(ids)       -> the modules of those ids (null: every row), for tests and
//                    the data CLI (node gallerydata.js --modes <ids|all>).
// Only a mode that is on is ever required, inside try/catch: a module that
// fails to load, or does not name itself with its row's id, is left out
// with a warning, never the gallery. This file requires nothing at load time
// (modmgr.js requires it to build its rows).
//
// THE MODULE CONTRACT (every hook optional; gallerydata.js's header,
// PROTOTYPE MODES, has the data rules):
//   id                    its row's id: /^[a-z][a-z0-9]{1,11}$/, no Lua
//                         keyword, no step field's name
//   read(base, ctx)       once per giver base (his files' signature): what the
//                         mode reads of him, or null when he is nothing to it
//                         (then pair() is never asked about him)
//   pair(G, R, ctx)       null or { steps, claims?, counts?, setup? } for one
//                         giver and one receiver, kept per process like the
//                         core's pairs
// The runtime hooks (trimStep, trimAction, lua, zss) are gallery.js's.

// The rows: the mode's id, its Mods tab add-on id, and what a player reads.
const ROWS = Object.freeze([
  {
    id: 'mob',
    addon: 'hgallery-mob',
    label: 'H gallery: mob givers (prototype)',
    about: 'Givers who bring a gang or a crowd on her get steps of their own in the gallery: each member of his mob in'
      + ' its scenes, one member on her at a time. A prototype: it may be removed at any time.',
    offLoses: 'His mob members\' steps are gone from the gallery; his own steps stay.',
  },
  {
    id: 'self',
    addon: 'hgallery-self',
    label: 'H gallery: characters that are galleries (prototype)',
    about: 'Characters that carry a gallery of their own (a pose menu, a director) get steps that walk through it, in'
      + ' place of the plain grab steps that showed only its first position. A prototype: it may be removed at any time.',
    offLoses: 'Those characters show their plain grab steps again.',
  },
  {
    id: 'ko',
    addon: 'hgallery-ko',
    label: 'H gallery: KO scenes (prototype)',
    about: 'Scenes that come only with her KO or after the match get steps of their own, after the pair\'s other'
      + ' positions, played with one pair on screen. A violent one says so in its label. A prototype: it may be'
      + ' removed at any time.',
    offLoses: 'No KO or after-the-match steps in the gallery.',
  },
].map((r) => Object.freeze(r)));

// Literal requires on purpose: make-portable's require check follows them and
// fails a copy that lacks a file.
const LOAD = Object.freeze({
  mob: () => require('./mob.js'),
  self: () => require('./self.js'),
  ko: () => require('./ko.js'),
});

const MODE_ID = /^[a-z][a-z0-9]{1,11}$/;
const warn = (id, why) => console.warn('H gallery: mode ' + id + ' is off: ' + why);

function loadOne(row) {
  let M = null;
  try { M = LOAD[row.id](); } catch (e) { warn(row.id, String((e && e.message) || e).split('\n')[0].slice(0, 200)); return null; }
  if (!M || typeof M !== 'object' || M.id !== row.id || !MODE_ID.test(M.id)) { warn(row.id, 'its module does not name itself ' + row.id); return null; }
  return M;
}

// The modules of these mode ids, in ROWS order (null or undefined: all).
function load(ids) {
  const want = ids == null ? null : new Set([...ids].map(String));
  if (want) for (const id of want) if (!ROWS.some((r) => r.id === id)) warn(id, 'no such mode');
  return ROWS.filter((r) => !want || want.has(r.id)).map(loadOne).filter(Boolean);
}

// The ids of the modes that are on for this roster: the gallery's own row on,
// and the mode's row on (on by default).
function idsOn(roster) {
  let mm = null;
  try { mm = require('../modmgr.js'); } catch (e) { return []; }
  const r = roster || {};
  if (!mm.builtinOn(r, 'hgallery')) return [];
  return ROWS.filter((row) => mm.builtinOn(r, row.addon)).map((row) => row.id);
}

function enabled(roster) {
  return load(idsOn(roster));
}

module.exports = { ROWS, LOAD, load, enabled, idsOn };
