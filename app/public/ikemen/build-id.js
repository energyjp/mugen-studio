// THE BUILD ID, in one place.
//
// The boot page prints it, the netplay build-check exchanges it, the Studio
// shows what a "Send my build" bundle will produce, and the boot page's
// compare box judges a friend's. All of them call this, so the number cannot
// drift between surfaces.
//
// Inputs (ikemenComputeBuildId({ shipped, overlay, motif })):
//   shipped  Map<vpath, size>   every shipped file, by path and manifest
//                               size only - never bytes (the pak is the
//                               same on every copy of one upload)
//   overlay  [[vpath, Uint8Array], ...]   every browser-side mod, bytes and all
//   motif    string             the effective theme (the pak's Motif= unless
//                               the Studio picked another that exists)
// Output: { hash: Uint8Array(8), hex: 12 hex chars, parts: { shipped, mods, motif } }
//
// The combined hash is the streaming cyrb64 the page has always used, over
// the same bytes in the same order - every Build ID in the field stays what
// it was. The three PART hashes are separate cyrb64 states fed in the same
// pass, so a mismatch can be named (different upload / different mods /
// different theme) without changing the combined number. Pure JS on
// purpose: crypto.subtle is undefined on plain http.
(function (root) {
  'use strict';
  function state() {
    const s = { h1: 0xdeadbeef, h2: 0x41c6ce57 };
    s.mix = (b) => { s.h1 = Math.imul(s.h1 ^ b, 2654435761); s.h2 = Math.imul(s.h2 ^ b, 1597334677); };
    s.mixStr = (t) => { for (let i = 0; i < t.length; i++) s.mix(t.charCodeAt(i) & 0xff); };
    s.done = () => {
      let { h1, h2 } = s;
      h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
      h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
      const out = new Uint8Array(8), dv = new DataView(out.buffer);
      dv.setUint32(0, h2 >>> 0); dv.setUint32(4, h1 >>> 0);
      const hex = ((h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0')).slice(0, 12);
      return { hash: out, hex };
    };
    return s;
  }
  // Incremental form: the shipped list up front, then every mod in sorted
  // path order one at a time, then the motif. Same bytes in the same order
  // as the one-shot call, so the same number - the Studio feeds it one
  // stored entry at a time and never holds the whole overlay.
  function ikemenBuildIdHasher(shippedIn) {
    const shipped = shippedIn instanceof Map ? shippedIn : new Map(Object.entries(shippedIn || {}));
    const all = state(), ps = state(), pm = state(), pt = state();
    for (const p of [...shipped.keys()].sort()) {
      const line = p + '\0' + String(shipped.get(p)) + '\n';
      all.mixStr(line); ps.mixStr(line);
    }
    let last = null;
    return {
      mod(p, bytes) {
        // The order IS the number: the same overlay fed in another order
        // would print a different ID, so a feeder that slips is refused.
        if (last !== null && !(last < p)) throw new Error('mods must arrive in sorted path order: ' + p + ' after ' + last);
        last = p;
        const head = '\0mod\0' + p + '\0';
        all.mixStr(head); pm.mixStr(head);
        if (bytes) for (let i = 0; i < bytes.length; i++) { all.mix(bytes[i]); pm.mix(bytes[i]); }
        return this;
      },
      done(motif) {
        const tail = '\0motif\0' + String(motif || '');
        all.mixStr(tail); pt.mixStr(tail);
        const c = all.done();
        return { hash: c.hash, hex: c.hex, parts: { shipped: ps.done().hex, mods: pm.done().hex, motif: pt.done().hex } };
      },
    };
  }
  function ikemenComputeBuildId(input) {
    const h = ikemenBuildIdHasher(input.shipped);
    // Sorted by path, whatever order the store handed them over in.
    const entries = (Array.isArray(input.overlay) ? input.overlay : []).slice()
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    for (const [p, bytes] of entries) h.mod(p, bytes);
    return h.done(input.motif);
  }
  root.ikemenComputeBuildId = ikemenComputeBuildId;
  root.ikemenBuildIdHasher = ikemenBuildIdHasher;
  if (typeof module !== 'undefined' && module.exports) module.exports = { ikemenComputeBuildId, ikemenBuildIdHasher };
})(typeof globalThis !== 'undefined' ? globalThis : this);
