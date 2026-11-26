// A CHARACTER'S OWN HUD, READ FROM ITS FILES (the H gallery hides it).
//
// Some characters draw meters of their own fixed to the screen: King's GUARD
// GAUGE and power stock, a 'TOP' meter, a counter at a corner. In a fight they
// sit beside the lifebars; in the gallery (no lifebars: the hook's
// noBarDisplay) they float over the scene and the gallery's own controls.
// The owner's rule (2026-11-24): hide them "for the most part" - when unsure,
// hide a fighter's screen-fixed explod; keep explods that move with the
// characters.
//
// What counts, per character, from every state file its .def lists in the
// engine's order (scenelib.stateFiles: [Files] resolved, never a glob), CNS
// and ST only (a ZSS file's controllers are not read here):
//   a SCREEN explod   an Explod whose space is screen, or with no space whose
//                     postype is left, right, back, front or none (the
//                     engine's screen-fixed positions)
//   in a HUD state    a negative statedef (the root runs it every frame), or
//                     a state of a HELPER kept alive from a negative state (a
//                     Helper controller there by a literal stateno whose
//                     triggers ask NumHelper and nothing of a move: no
//                     StateNo, Move*, Win, AnimElem, command, ...), or spawned
//                     in a round-start or intro state (5900, 190-195) - and
//                     the states that helper's own literal ChangeState /
//                     SelfState values lead to (King's [Statedef 10000]
//                     gauge helper, `numhelper(10000) = 0`)
//   with an id        a literal id >= 0: the hook hides by id, and only its
//                     owner's (an explod with no id cannot be named; counted
//                     in noId). Never -1, which would name every explod.
// An id that also names an Explod in a state the gallery's scenes show (keep:
// the giver's states on his steps) is KEPT, so a scene's own screen effect
// stays (`kept`); one that names an Explod in any other state of the
// character (a move) is hidden all the same ("when unsure, hide") and listed
// in `both`. The gallery's build log prints both.
//
// How it is hidden (gallery.js, the modern-input text): the driver names each
// character on its root (map _gal_hud = its number in the build's list) and
// the hook's -4 runs `modifyExplod{id: N; hidewithbars: 1}` for each of its
// ids, in the root and in its helpers (explods are owner-matched). The engine
// does not draw a hidewithbars explod while the bars are hidden (char.go
// cueDraw, system.go shouldHideWithBars), which the hook asserts every frame.
'use strict';
const S = require('./scenelib.js');

const SCREEN_POSTYPES = new Set(['left', 'right', 'back', 'front', 'none']);
const INTRO_STATES = new Set([5900, 190, 191, 192, 193, 194, 195]);
// A Helper's triggers that tie it to a move or a moment, not a meter kept up.
const EVENT_TRIGGER = /\b(stateno|prevstateno|move(hit|contact|guarded|reversed|type)|win\w*|lose\w*|animelem\w*|command|projhit\w*|projcontact\w*|p2stateno|hitdefattr|gethitvar|animtime|anim)\b/i;
const trigText = (sc) => [...(sc.trig.all || []), ...(sc.trig.groups || []).flat()].join(' && ');
const lit = (raw) => (raw !== undefined && raw !== null && /^\s*-?\d+\s*$/.test(String(raw)) ? parseInt(String(raw), 10) : null);

function isScreenExplod(sc) {
  if (sc.type !== 'explod') return false;
  const space = String(sc.params.get('space') || '').trim().toLowerCase();
  if (space) return space === 'screen';
  const pt = String(sc.params.get('postype') || 'p1').trim().toLowerCase();
  return SCREEN_POSTYPES.has(pt);
}

// The HUD explods of a parsed character (scenelib.parseStates' `states`).
function hudExplodsOf(states, keep) {
  // The HUD states: the negatives, then the helpers they (or the round-start
  // states) spawn, then where those helpers go by a literal value.
  const hud = new Set();
  const helperRoots = [];
  for (const s of states.values()) {
    if (s.no < 0) hud.add(s.no);
    if (s.no < 0 || INTRO_STATES.has(s.no)) {
      for (const sc of s.sctrls) {
        if (sc.type !== 'helper') continue;
        const to = lit(sc.params.get('stateno'));
        if (to === null || to < 0) continue;
        const t = trigText(sc);
        if (INTRO_STATES.has(s.no) || (/\bnumhelper\b/i.test(t) && !EVENT_TRIGGER.test(t))) helperRoots.push(to);
      }
    }
  }
  const helperStates = new Set();
  const q = helperRoots.filter((n) => states.has(n));
  while (q.length && helperStates.size < 64) {
    const n = q.shift();
    if (helperStates.has(n)) continue;
    helperStates.add(n);
    for (const sc of states.get(n).sctrls) {
      if (sc.type !== 'changestate' && sc.type !== 'selfstate') continue;
      const to = lit(sc.params.get('value'));
      if (to !== null && to >= 200 && states.has(to) && !helperStates.has(to)) q.push(to);
    }
  }
  for (const n of helperStates) hud.add(n);
  const ids = new Set(), elsewhere = new Set(), inScene = new Set();
  let noId = 0;
  for (const s of states.values()) {
    for (const sc of s.sctrls) {
      if (sc.type !== 'explod') continue;
      const id = lit(sc.params.get('id'));
      if (hud.has(s.no) && isScreenExplod(sc)) {
        if (id === null || id < 0) noId++;
        else ids.add(id);
      } else if (!hud.has(s.no) && id !== null) {
        if (keep && keep.has(s.no)) inScene.add(id); else elsewhere.add(id);
      }
    }
  }
  const sorted = [...ids].sort((a, b) => a - b);
  return {
    ids: sorted.filter((id) => !inScene.has(id)),
    both: sorted.filter((id) => !inScene.has(id) && elsewhere.has(id)),
    kept: sorted.filter((id) => inScene.has(id)),
    noId,
    helpers: [...helperStates].sort((a, b) => a - b),
  };
}

// The HUD explods of the character at dir/def ({ ids: [] } when its files
// cannot be read); keep: a Set of the states its scenes show, or none.
function hudExplods(dir, def, keep) {
  const modlib = require('./modlib.js');
  let parsed = null;
  try { parsed = S.parseStates(S.stateFiles(dir, def, (rel) => modlib.resolveCI(dir, rel)), {}); } catch (e) { parsed = null; }
  if (!parsed) return { ids: [], both: [], kept: [], noId: 0, helpers: [] };
  return hudExplodsOf(parsed.states, keep);
}

module.exports = { hudExplods, hudExplodsOf, isScreenExplod };
