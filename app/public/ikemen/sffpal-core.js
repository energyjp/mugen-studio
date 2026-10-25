// SFF v1 palette repair - the pure-bytes core, shared by the desktop Studio
// (via ../../sffpal.js) and the in-browser Mod Studio (loaded as a script).
//
// Kept as ONE implementation on purpose: this repair has a history of subtly
// corrupting files when done wrong (relinking palette pointers without
// rebuilding makes the engine derive sprite data sizes from non-adjacent
// forward pointers, so palettes read from garbage offsets - the classic
// magenta/green noise portraits). Two copies of that logic would drift.
//
// Pure: no fs, no path, no DOM. Never mutates the caller's bytes.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.sffpalCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const dv = (b) => new DataView(b.buffer, b.byteOffset, b.byteLength);

  function sffVersion(b) {
    if (!b || b.length < 16) return null;
    let sig = ''; for (let i = 0; i < 11; i++) sig += String.fromCharCode(b[i]);
    if (sig !== 'ElecbyteSpr') return null;
    return b[15] === 2 ? 2 : (b[15] === 1 ? 1 : null);
  }

  function walkSubfiles(b) {
    const d = dv(b);
    const n = d.getUint32(20, true);
    let off = d.getUint32(24, true);
    const subs = [];
    for (let i = 0; i < n && off > 0 && off + 32 <= b.length; i++) {
      subs.push({
        off,
        len: d.getUint32(off + 4, true),
        group: d.getUint16(off + 12, true),
        image: d.getInt16(off + 14, true),
        prevCopy: d.getUint16(off + 16, true),
        palSame: b[off + 18],
        next: d.getUint32(off, true),
        ord: i,
      });
      off = d.getUint32(off, true);
    }
    return subs;
  }

  const countOwnPalSprites = (b) =>
    walkSubfiles(b).filter((s, i) => i > 0 && s.palSame === 0).length;

  function animGroupMap(airText) {
    const map = {};
    let cur = null;
    for (const line of airText.split(/\r?\n/)) {
      const bg = /^\s*\[Begin Action\s+(\d+)/i.exec(line);
      if (bg) { cur = +bg[1]; map[cur] = new Set(); continue; }
      const f = /^\s*(-?\d+)\s*,\s*(-?\d+)\s*,/.exec(line);
      if (cur !== null && f) {
        let g = parseInt(f[1], 10);
        if (g < 0 && g !== -1) g += 65536;
        if (g >= 0) map[cur].add(g);
      }
    }
    return map;
  }

  const FX_TYPES = new Set(['explod', 'gamemakeanim', 'projectile', 'makedust', 'afterimage']);

  function fxOnlyGroups(stateTexts, airText) {
    const anims = animGroupMap(airText);
    const playerAnims = new Set(), fxAnims = new Set();
    const helperStates = new Set();
    for (const code of stateTexts) {
      for (const blk of code.split(/\[State /i)) {
        const t = (/type\s*=\s*(\w+)/i.exec(blk) || [])[1];
        if (t && t.toLowerCase() === 'helper') {
          const st = /(?:^|\n)\s*stateno\s*=\s*(\d+)/i.exec(blk);
          if (st) helperStates.add(+st[1]);
        }
      }
    }
    for (const code of stateTexts) {
      for (const sec of code.split(/(?=\[Statedef\s)/i)) {
        const head = /^\[Statedef\s+(-?\d+)/i.exec(sec);
        const stateNo = head ? parseInt(head[1], 10) : null;
        const target = (stateNo !== null && helperStates.has(stateNo)) ? fxAnims : playerAnims;
        const da = /\][^\[]*?(?:^|\n)\s*anim\s*=\s*(\d+)/i.exec(sec);
        if (head && da) target.add(+da[1]);
        for (const blk of sec.split(/\[State /i)) {
          const t = (/type\s*=\s*(\w+)/i.exec(blk) || [])[1];
          if (!t) continue;
          const type = t.toLowerCase();
          if (type === 'changeanim' || type === 'changeanim2') {
            const v = /(?:^|\n)\s*value\s*=\s*(\d+)/i.exec(blk);
            if (v) target.add(+v[1]);
          } else if (FX_TYPES.has(type)) {
            for (const m of blk.matchAll(/(?:^|\n)\s*(?:anim|projanim|projhitanim|projremanim)\s*=\s*(\d+)/gi)) {
              fxAnims.add(+m[1]);
            }
          }
        }
      }
    }
    // An action nothing references is UNKNOWN, not player art. It used to be
    // filed as player art, and that let a leftover action veto an explicit
    // FX classification: Kumagawa's super cut-ins live in group 7000, shown
    // by Explods via actions 7000-7002, but actions 7003-7021 reference the
    // same group and are referenced by nothing. Those unused leftovers put
    // 7000 into BOTH sets, "fx minus player" dropped it, and the repair
    // repainted 2048px cut-ins with the body palette - solid green in the
    // middle of a super (field-hit 2026-08-11).
    //
    // Unknown actions still vote for nothing, so a group used ONLY by them
    // behaves exactly as before. The change is confined to groups that are
    // explicitly FX somewhere: those are now preserved. That direction is
    // also the safe one to be wrong in - a preserved sprite keeps its
    // authored colors and merely ignores the color pick, where the old
    // behavior destroyed the artwork outright.
    const groupsOf = (set) => {
      const out = new Set();
      for (const a of set) for (const g of (anims[a] || [])) out.add(g);
      return out;
    };
    const player = groupsOf(playerAnims), fx = groupsOf(fxAnims);
    return new Set([...fx].filter(g => !player.has(g)));
  }

  // Structural pre-flight. Returns { ok, errors[] }.
  function verifyChain(b) {
    const errors = [];
    // Must return BEFORE any DataView read: a short or non-SFF buffer would
    // otherwise throw a raw RangeError out of walkSubfiles instead of this
    // readable message.
    if (sffVersion(b) !== 1) {
      return { ok: false, errors: ['not an SFF v1 file - this fix only applies to v1 characters'],
               count: 0, declared: 0 };
    }
    const d = dv(b);
    const n = b.length >= 28 ? d.getUint32(20, true) : 0;
    const subs = walkSubfiles(b);
    if (!subs.length) errors.push('no sprites found in the chain');
    if (subs.length !== n) errors.push(`chain has ${subs.length} sprites but the header claims ${n}`);
    for (const s of subs) {
      if (s.off + 32 + s.len > b.length) { errors.push(`sprite ${s.ord} runs past the end of the file`); break; }
    }
    return { ok: errors.length === 0, errors, count: subs.length, declared: n };
  }

  // Group the chain into palette RUNS - a leader that owns a palette, plus the
  // sprites that inherit it - and mark which runs keep their own. Split out of
  // repairBytes so a caller can see the decision WITHOUT paying for a rebuild;
  // marking only, no bytes written, so both callers classify identically.
  function planRuns(subs, preserve) {
    const runs = [];
    for (const s of subs) {
      const isLeader = runs.length === 0 || (s.palSame === 0 && s.len > 0);
      if (isLeader) runs.push({ leader: s, members: [s] });
      else runs[runs.length - 1].members.push(s);
    }
    let flipped = 0, preserved = 0;
    for (let i = 1; i < runs.length; i++) {
      const r = runs[i];
      if (r.leader.group === 9000 || preserve.has(r.leader.group)) { r.keep = true; preserved++; }
      else flipped++;
    }
    return { runs, flipped, preserved };
  }

  // Dry run: what WOULD the repair do to this file? Same classification as the
  // real thing, no rebuild. Used to decide whether the fix is worth offering,
  // and to re-check at repair time that the inputs still resolve the same way.
  function planRepair(src, stateTexts, airText) {
    const pre = verifyChain(src);
    if (!pre.ok) throw new Error(pre.errors[0]);
    const preserve = fxOnlyGroups(stateTexts, airText);
    const p = planRuns(walkSubfiles(src), preserve);
    return { flipped: p.flipped, preserved: p.preserved, preservedGroups: preserve.size };
  }

  function repairBytes(src, stateTexts, airText) {
    const pre = verifyChain(src);
    if (!pre.ok) throw new Error(pre.errors[0]);
    const preserve = fxOnlyGroups(stateTexts, airText);
    const buf = new Uint8Array(src);          // never mutate the caller's bytes
    const d = dv(buf);
    const subs = walkSubfiles(buf);

    const { runs, flipped, preserved } = planRuns(subs, preserve);
    for (const r of runs.slice(1)) if (!r.keep) buf[r.leader.off + 18] = 1;

    const ordered = [runs[0],
      ...runs.slice(1).filter(r => !r.keep),
      ...runs.slice(1).filter(r => r.keep)];
    const newList = ordered.flatMap(r => r.members);

    const newOrd = new Map();
    newList.forEach((s, i) => newOrd.set(s.ord, i));
    for (const s of newList) {
      if (s.len === 0 && s.prevCopy !== 0) {
        const target = newOrd.get(s.prevCopy);
        if (target === undefined || target >= newOrd.get(s.ord)) {
          return { bytes: buf, flipped, preserved, preservedGroups: preserve.size,
            reordered: false, warning: 'linked sprite would break; chain order left as-is' };
        }
      }
    }

    const HEADER = 512;
    let total = HEADER;
    for (const s of newList) total += 32 + s.len;
    const out = new Uint8Array(total);
    const od = dv(out);
    out.set(buf.subarray(0, HEADER), 0);
    let w = HEADER;
    for (let i = 0; i < newList.length; i++) {
      const s = newList[i];
      const blockLen = 32 + s.len;
      out.set(buf.subarray(s.off, s.off + blockLen), w);
      od.setUint32(w, i + 1 < newList.length ? w + blockLen : 0, true);
      if (s.len === 0 && s.prevCopy !== 0) od.setUint16(w + 16, newOrd.get(s.prevCopy), true);
      w += blockLen;
    }
    od.setUint32(24, HEADER, true);
    return { bytes: out, flipped, preserved, preservedGroups: preserve.size,
      reordered: true, rebuilt: true };
  }

  return { sffVersion, walkSubfiles, countOwnPalSprites, animGroupMap, fxOnlyGroups, verifyChain, planRepair, repairBytes };
});
