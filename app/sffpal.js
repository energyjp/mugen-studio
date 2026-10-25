// SFF v1 palette repair, v2 (effect-aware).
//
// SFF v1 palettes chain positionally: a "shared" sprite inherits the palette
// of the PREVIOUS sprite in file order, and .act color selections replace
// only palette slot 0 (the base carried by the first/0,0 sprite). Community
// edits often add sprites flagged "own palette", which both ignores the
// selected .act AND re-bases every later shared sprite - the classic
// "costume reverts to default colors on some moves" bug.
//
// Naively flipping every own-palette flag fixes costumes but destroys
// effect/UI sprites, which legitimately need their dedicated palettes.
// So: sprites whose groups are used ONLY by effect controllers (Explod,
// GameMakeAnim, Projectile, MakeDust, AfterImage) in the character's own
// def-loaded code keep their palettes; groups drawn on the player (statedef
// anim=, ChangeAnim/ChangeAnim2 - which includes H pair animations played
// by givers) get flipped onto the shared/base palette. Group 9000
// (portraits) and the first sprite (base palette carrier) always keep.
//
// The algorithm itself now lives in public/ikemen/sffpal-core.js as pure
// byte-in/byte-out code, so the in-browser Mod Studio runs the SAME repair
// rather than a second copy that could drift. This file is only the
// filesystem plumbing: backup, read, write.

const fs = require('fs');
const path = require('path');
const core = require('./public/ikemen/sffpal-core.js');

// Repairs sffPath in place, keeping a one-time .orig backup. Re-running
// restores from the backup first, so the repair is always computed from the
// pristine file rather than compounding on its own output.
function repair(sffPath, stateTexts, airText) {
  const bak = sffPath + '.orig';
  if (fs.existsSync(bak)) fs.copyFileSync(bak, sffPath);
  else fs.copyFileSync(sffPath, bak);

  const r = core.repairBytes(fs.readFileSync(sffPath), stateTexts, airText);
  fs.writeFileSync(sffPath, r.bytes);

  const out = {
    flipped: r.flipped, preserved: r.preserved,
    preservedGroups: r.preservedGroups, reordered: r.reordered,
    backup: path.basename(bak),
  };
  // Two mutually exclusive shapes, preserved for existing callers: a real
  // rebuild reports its size; the conservative fallback reports why not.
  if (r.reordered) { out.rebuilt = true; out.bytes = r.bytes.length; }
  else out.warning = r.warning;
  return out;
}

module.exports = { repair, fxOnlyGroups: core.fxOnlyGroups, walkSubfiles: core.walkSubfiles };
