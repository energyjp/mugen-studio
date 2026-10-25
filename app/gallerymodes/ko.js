'use strict';
// THE KO MODE (a prototype: gallerymodes/index.js): scenes that come only
// with her KO, her life low, or the match over get steps of their own, after
// the pair's own positions, each a lead step of the core walk with one more
// action that makes the KO. Violent ones say so in their label.
//
// Two halves, each its own file:
//   ko-data.js  the walk (read, pair): the gates his files read, the leads,
//               the KO steps and the after-the-match steps (its header has
//               the rules)
//   ko-rt.js    the runtime (trimming, the hook lines and the Lua): makes the
//               KO each KO action asks for, holds the round, revives her or
//               reloads the match on the way out
//
// THE CONTRACT between them (the data's output, per step):
//   step.ext = 'ko'; step.leaf = true;
//   step.ko  = { gate: 'life'|'dead'|'over', life, violent, lead, after?,
//                his?, experimental? }  (what the overlay and the log may say)
//   the KO ACTION, one per step, in its path (the last action, or before
//   the after-the-match wait or held direction):
//     { ext: 'ko', until, from?, patience,
//       ko: { life: N, kill: 'none'|'now', round: 'live'|'freeze'|'end' } }
//   - life: her life held at N while kill is 'none' (GlobalNoKO kept: she
//     stays alive); kill 'now' KOs her at that life (ModifyPlayer alive 0:
//     ko-rt.js; GlobalNoKO stays on, so nobody else is KO'd).
//   - round: 'live' the round as always; 'freeze' held at RoundState 2 (no
//     round end while she lies dead); 'end' the engine ends the round and
//     the match (his win pose and what his win state does after it).
//   - from: where the KO arms (his state in it); absent: at once when the
//     action starts. Once armed it stays for the rest of the step, the
//     actions after it included.
//   the AFTER-THE-MATCH action (after an 'end' KO action): { ext: 'ko',
//   until, patience, cmd?, mode?, from?, anim?, herOn? } with no `ko` - a
//   wait, or a direction of his aftermath menu held from the states it acts
//   in; where his own states play the scene (step.ko.his), `until` is the
//   states the KO left her in (what she shows of it: the judging's) and
//   `herOn` the states her lines send her to while those states of his play
//   (the runtime waits for those instead); with no such line of hers, it
//   waits for his animation there (`anim`, the step's `anims`).
// Every other field is the core's (gallerydata.js's header).
const data = require('./ko-data.js');

module.exports = { id: 'ko', read: data.read, pair: data.pair, triggerGate: data.triggerGate };

// The runtime half rides on this entry (its hooks: trimStep, trimAction,
// lua, zss). A runtime that fails to load leaves the data half working.
try {
  const rt = require('./ko-rt.js');
  for (const k of Object.keys(rt || {})) if (!Object.prototype.hasOwnProperty.call(module.exports, k)) module.exports[k] = rt[k];
} catch (e) {
  if (!(e && e.code === 'MODULE_NOT_FOUND' && /ko-rt\.js/.test(String(e.message)))) console.warn('H gallery: mode ko runs without its runtime: ' + String((e && e.message) || e).split('\n')[0].slice(0, 200));
}
