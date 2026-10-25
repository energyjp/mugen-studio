// palcolor-core.js - recoloring a 256-color palette, the same arithmetic in the
// browser (the live preview) and in the build (what ships), so the preview IS
// the result. No DOM, no Node: loaded as a plain script or require()d.
//
// A MUGEN palette is 256 RGB entries and the sprites are indices into it, so
// "make the gi blue" is never a paint job - it is moving the right ENTRIES. The
// trouble is knowing which entries are the gi. A character's palette is laid
// out in ramps (skin, hair, cloth, metal...), but nothing in the file says
// where one ramp ends; what CAN be read is each entry's hue. So entries are
// sorted into COLOR FAMILIES by the hue they have in the BASE palette, and each
// family is adjusted on its own: shift the blues to red and the skin, which
// lives in the oranges, stays skin. Families are decided from the base palette
// and never from the result, so an adjustment cannot make an entry change
// family half way through a drag.
//
// FAMILIES ARE A BLUNT TOOL ON PURPOSE, AND SOMETIMES TOO BLUNT: the whites of a
// character's eyes and the white of its shirt are both "grays". Hue cannot tell
// them apart because hue is not what separates them - WHERE they are drawn
// does, and a palette does not record that. So a recipe also carries PICKS:
// families made by hand, by clicking the sprite. A pick is a set of entries
// (one, or a shaded ramp grabbed together - see grabSimilar) that LEAVES its
// hue family: the family's sliders no longer move it, its own do. A pick can
// also be SET TO an exact color: the entry that was clicked becomes exactly
// that color and the rest of the pick keeps its shading around it.
//
// Index 0 is transparency and is never touched.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.palcolorCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // hue in degrees [0,360), s and l in [0,1]
  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
    if (!d) return [0, 0, l];
    const s = d / (1 - Math.abs(2 * l - 1));
    let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
    return [h, Math.min(1, s), l];
  }
  function hslToRgb(h, s, l) {
    const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
    const k = Math.floor(h / 60) % 6;
    const [r, g, b] = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][k];
    return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
  }

  // The families, in the order the panel shows them. `gray` is decided first:
  // an entry with almost no saturation, or almost black or white, has no hue
  // worth the name, and lumping it with "red" (hue 0) recolors every outline.
  const FAMILIES = [
    { id: 'red', name: 'reds', from: 345, to: 15 },
    { id: 'orange', name: 'oranges and skin', from: 15, to: 45 },
    { id: 'yellow', name: 'yellows', from: 45, to: 75 },
    { id: 'green', name: 'greens', from: 75, to: 165 },
    { id: 'cyan', name: 'cyans', from: 165, to: 195 },
    { id: 'blue', name: 'blues', from: 195, to: 255 },
    { id: 'purple', name: 'purples', from: 255, to: 315 },
    { id: 'pink', name: 'pinks', from: 315, to: 345 },
    { id: 'gray', name: 'grays, black and white' },
  ];
  // WHETHER AN ENTRY HAS A HUE IS A MATTER OF CHROMA, NOT OF HSL SATURATION. HSL
  // divides by how far the lightness is from its ends, so a barely-blue white
  // (230,235,245) comes out "42% saturated" - and a character's white shirt,
  // which is exactly that, went pink when his blue jeans were turned red. Seen
  // in the game, not in the arithmetic. Chroma (max - min) and its share of the
  // brightest channel say what the eye says: that entry is a white.
  function familyOf(r, g, b) {
    const max = Math.max(r, g, b), chroma = max - Math.min(r, g, b);
    if (chroma < 26 || chroma / max < 0.16) return 'gray';
    const h = rgbToHsl(r, g, b)[0];
    for (const f of FAMILIES) {
      if (f.id === 'gray') continue;
      if (f.from > f.to ? (h >= f.from || h < f.to) : (h >= f.from && h < f.to)) return f.id;
    }
    return 'gray';
  }

  const clampOp = (o) => ({
    h: Math.max(-180, Math.min(180, Number(o && o.h) || 0)),
    s: Math.max(-100, Math.min(100, Number(o && o.s) || 0)),
    l: Math.max(-100, Math.min(100, Number(o && o.l) || 0)),
  });
  const isNoop = (o) => !o.h && !o.s && !o.l;

  // ops: { all: {h,s,l}, families: { blue: {h,s,l}, ... },
  //        groups: [{ entries: [37, 38], anchor: 37, h, s, l, to?: '#rrggbb' }, ...] }
  //   h  degrees to turn the hue        s, l  percent, -100..100
  // Saturation and lightness move TOWARD the end of their range rather than
  // being multiplied, so +100 always reaches full and -100 always reaches zero
  // whatever the entry started at, and a highlight never clips before a shadow.
  // pal: 768 bytes RGB. -> a new Uint8Array(768); `only` (optional Set of
  // indices) limits the change to those entries - the ones the character is
  // actually drawn in, so unused table entries do not skew anything.
  //
  // A PICK (a group) replaces the FAMILY for its entries - "everything" still
  // moves them, because everything means everything - and is never filtered by
  // `only`: it was chosen by hand. With `to`, the pick starts from that color
  // instead of from the palette: hue and saturation are the target's, lightness
  // is the target's plus the entry's own distance from the anchor, so a ramp
  // stays a ramp. Then nothing but the pick's own sliders apply - an exact
  // color that "everything" could drag away would not be exact - and with the
  // sliders at rest the anchor is the target byte for byte.
  function applyOps(pal, ops, only) {
    const out = new Uint8Array(768);
    for (let i = 0; i < 768; i++) out[i] = pal[i];
    const all = clampOp(ops && ops.all), fam = (ops && ops.families) || {};
    const groupOf = new Map();
    for (const grp of cleanGroups(ops && ops.groups)) for (const i of grp.entries) groupOf.set(i, grp);
    for (let i = 1; i < 256; i++) {
      const grp = groupOf.get(i);
      if (!grp && only && !only.has(i)) continue;
      const r = pal[i * 3], g = pal[i * 3 + 1], b = pal[i * 3 + 2];
      let start = null, chain;
      if (grp && grp.to) {
        const v = parseInt(grp.to.slice(1), 16), t = [v >> 16, (v >> 8) & 255, v & 255];
        if (i === grp.anchor && isNoop(grp)) { out[i * 3] = t[0]; out[i * 3 + 1] = t[1]; out[i * 3 + 2] = t[2]; continue; }
        const T = rgbToHsl(t[0], t[1], t[2]), a = grp.anchor * 3;
        start = [T[0], T[1], Math.max(0, Math.min(1, T[2] + rgbToHsl(r, g, b)[2] - rgbToHsl(pal[a], pal[a + 1], pal[a + 2])[2]))];
        chain = [grp];
      } else chain = [all, grp || clampOp(fam[familyOf(r, g, b)])];
      if (!start && chain.every(isNoop)) continue;
      let [h, s, l] = start || rgbToHsl(r, g, b);
      for (const o of chain) {
        h = (h + o.h + 360) % 360;
        s = o.s >= 0 ? s + (1 - s) * o.s / 100 : s * (1 + o.s / 100);
        l = o.l >= 0 ? l + (1 - l) * o.l / 100 : l * (1 + o.l / 100);
      }
      const c = hslToRgb(h, Math.max(0, Math.min(1, s)), Math.max(0, Math.min(1, l)));
      out[i * 3] = c[0]; out[i * 3 + 1] = c[1]; out[i * 3 + 2] = c[2];
    }
    return out;
  }
  // An entry belongs to ONE pick - the first that names it. A pick whose sliders
  // are all at rest is still a pick: holding an entry OUT of its family is a
  // thing it does. Index 0 is never in one.
  function cleanGroups(groups) {
    const out = [], taken = new Set();
    for (const grp of Array.isArray(groups) ? groups.slice(0, 64) : []) {
      const entries = [];
      for (const v of Array.isArray(grp && grp.entries) ? grp.entries : []) {
        const i = Number(v);
        if (Number.isInteger(i) && i >= 1 && i <= 255 && !taken.has(i)) { taken.add(i); entries.push(i); }
      }
      if (!entries.length) continue;
      entries.sort((a, b) => a - b);
      const o = clampOp(grp), to = String(grp.to || '').toLowerCase();
      const c = { entries, anchor: entries.includes(Number(grp.anchor)) ? Number(grp.anchor) : entries[0], h: o.h, s: o.s, l: o.l };
      if (/^#[0-9a-f]{6}$/.test(to)) c.to = to;
      out.push(c);
    }
    return out;
  }

  // WHAT A CLICK ON THE SPRITE GRABS. px: w*h palette indices, (x, y) the pixel,
  // pal the BASE palette (similarity, like family, is decided on the base and
  // never on the result). tol is a distance in RGB (0 = that color only).
  //   touching  the magic wand: spread from the pixel through neighbors (all
  //             eight - pixel art shades on the diagonal) whose color is within
  //             tol of the CLICKED color, and return the entries met on the way.
  //             This is what tells an eye from a shirt of the same white: the
  //             outline between them stops the spread.
  //   otherwise every entry within tol, wherever it is drawn (`used`, optional
  //             Set, keeps table entries nothing is drawn in out of it).
  // -> sorted entries, the clicked one always among them; [] on transparency.
  // What it cannot do is split ONE entry: if the eye and the shirt are the same
  // index, they are the same color in every palette there will ever be.
  function grabSimilar(px, w, h, x, y, pal, tol, touching, used) {
    if (x < 0 || y < 0 || x >= w || y >= h) return [];
    const seed = px[y * w + x];
    if (!seed) return [];
    const t2 = Math.max(0, Number(tol) || 0) ** 2, near = new Uint8Array(256);
    for (let i = 1; i < 256; i++) {
      const dr = pal[i * 3] - pal[seed * 3], dg = pal[i * 3 + 1] - pal[seed * 3 + 1], db = pal[i * 3 + 2] - pal[seed * 3 + 2];
      if (dr * dr + dg * dg + db * db <= t2) near[i] = 1;
    }
    const got = new Set([seed]);
    if (!touching) {
      for (let i = 1; i < 256; i++) if (near[i] && (!used || used.has(i))) got.add(i);
    } else {
      const seen = new Uint8Array(w * h), stack = [y * w + x];
      seen[y * w + x] = 1;
      while (stack.length) {
        const p = stack.pop(), cx = p % w, cy = (p - cx) / w;
        got.add(px[p]);
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = cx + dx, ny = cy + dy;
          if ((!dx && !dy) || nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const q = ny * w + nx;
          if (seen[q] || !px[q] || !near[px[q]]) continue;
          seen[q] = 1; stack.push(q);
        }
      }
    }
    return [...got].sort((a, b) => a - b);
  }

  // Which families a palette actually has, counted over the entries in use:
  //   [{ id, name, count, swatch: ['#rrggbb', ...up to 6] }]
  function familiesIn(pal, used) {
    const by = new Map();
    for (let i = 1; i < 256; i++) {
      if (used && !used.has(i)) continue;
      const id = familyOf(pal[i * 3], pal[i * 3 + 1], pal[i * 3 + 2]);
      if (!by.has(id)) by.set(id, []);
      by.get(id).push(i);
    }
    const hex = (i) => '#' + [pal[i * 3], pal[i * 3 + 1], pal[i * 3 + 2]].map((v) => v.toString(16).padStart(2, '0')).join('');
    return FAMILIES.filter((f) => by.has(f.id)).map((f) => {
      const idx = by.get(f.id).slice().sort((a, b) => rgbToHsl(pal[a * 3], pal[a * 3 + 1], pal[a * 3 + 2])[2] - rgbToHsl(pal[b * 3], pal[b * 3 + 1], pal[b * 3 + 2])[2]);
      const step = Math.max(1, Math.floor(idx.length / 6));
      return { id: f.id, name: f.name, count: idx.length, swatch: idx.filter((_, k) => k % step === 0).slice(0, 6).map(hex) };
    });
  }

  const cleanOps = (ops) => {
    const out = { all: clampOp(ops && ops.all), families: {} };
    for (const f of FAMILIES) { const o = clampOp(ops && ops.families && ops.families[f.id]); if (!isNoop(o)) out.families[f.id] = o; }
    const groups = cleanGroups(ops && ops.groups);
    if (groups.length) out.groups = groups;
    return out;
  };

  return { FAMILIES, rgbToHsl, hslToRgb, familyOf, applyOps, familiesIn, cleanOps, cleanGroups, grabSimilar };
});
