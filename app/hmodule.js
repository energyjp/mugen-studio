'use strict';
// THE H-MUGEN MODULE (2026-10-09): H features are a choice, per bundle.
//
// Until now "the scan found an H character" and "show the H features" were the
// same event (GRAIL 4.11's hidden-until-found), so one false positive - a
// throw table, a meter bank, an effect numbered inside a pair window - turned
// the H side on in a build with no H content. Now the scan only ASKS:
//
//   roster.hModule   'on' | 'off'          the answer, per bundle
//                    'unasked' | 'notnow'  not answered yet (features off)
//   roster.hModuleSeen  [mountAs...]       with 'notnow': the H characters the
//                                          question was asked about - a new one
//                                          asks again
//   chars[i].hRole   'giver' | 'receiver' | 'both' | 'none'   the owner's word
//                    for a character, over whatever the scan says
//   chars[i].hReviewed  the scan's verdict signature the owner confirmed in the
//                    review queue; a different verdict asks again
//
// Off (or unanswered) means: no role badges or hearts, no pair bench, no H
// filter chips or tips, and no H gallery in this bundle's exports. Detection
// keeps running, so the Mods tab's H-MUGEN module row turns it all on at once.
//
// A ROSTER FROM BEFORE THE MODULE (no hModule key) keeps what it had: a bundle
// of the Studio's own whose roster makes an H gallery pair (a giver and a
// receiver) reads as 'on' - Main and the bundles built with the H side on stay
// as they were. A read-only build (GRAIL 3.18) is never grandfathered; every
// roster made since (bundles.create, openExternal, the whole-build import)
// starts 'unasked'.
const fs = require('fs');
const path = require('path');

const ROLES = new Set(['giver', 'receiver', 'both', 'none']);

function moduleState(roster) {
  const v = roster && roster.hModule;
  if (v === 'on' || v === 'off') return v;
  if (v === 'notnow') return 'notnow';
  if (v !== undefined) return 'unasked';
  let layout = null;
  try { layout = require('./layout.js'); } catch (e) { layout = null; }
  if (layout && layout.readOnly) return 'unasked';
  try { return require('./vfslib.js').rosterHasGalleryPair(roster, { detectedOnly: true }) ? 'on' : 'unasked'; } catch (e) { return 'unasked'; }
}
const moduleOn = (roster) => moduleState(roster) === 'on';

// The role a character plays, the owner's word first. `detected`: hScan's
// { giver, receiver }. -> { giver, receiver }
function effectiveRole(c, detected) {
  const d = detected || {};
  switch (c && c.hRole) {
    case 'none': return { giver: false, receiver: false };
    case 'giver': return { giver: true, receiver: false };
    case 'receiver': return { giver: false, receiver: true };
    case 'both': return { giver: true, receiver: true };
    default: return { giver: !!d.giver, receiver: !!d.receiver };
  }
}

// A verdict's signature, for "confirmed as detected": the roles and their doors.
const verdictSig = (h) => [h && h.giver ? 'g:' + (h.why || '') : '', h && h.receiver ? 'r:' + (h.receiverWhy || '') : ''].join('|');

// ---- THE REVIEW QUEUE: the verdicts worth a second look --------------------
//
// Measured over the census of 2,584 distinct characters (every G:\Game build,
// three MUGENs on the Desktop, mugen-web, the bundles), on the cases the owner
// found wrong in the Ikemen Fighting Collection. Three signs, each queueing a
// handful at most per build:
//   SMALL - a receiver by orphans whose unplayed window actions mostly draw
//           small sprites (under 64 px both ways): effects, not bodies.
//           Nicotine Caffeine's hit sparks (70008...); 5 in the H builds.
//   REACH - a receiver by orphans whose unplayed window actions its own code
//           mostly reaches through a MULTIPLIED computed number (`10000 +
//           1000*var(1) + ...`): its own banks. Valdoll's dragon forms; 0 in
//           the H builds.
//   SIX   - a giver whose verdict rests on six-digit numbers outside every
//           known family (GRAIL 4.3): Z Helper Futa (real), Rera (Mortal
//           Kombat fatalities).
// Rejected on the numbers: pair-like sprite groups (would queue ~200 real
// receivers - cvsmika, Mai, Athena use custom groups), art its own moves draw
// (27 real, misses Valdoll), the weakest giver doors (11 real givers, Batman
// among them).
const SMALL_PX = 64;
function reachStarts(texts) {
  const out = new Set();
  for (const t of texts) {
    for (const m of t.matchAll(/^\s*(?:value|anim)\s*=\s*([^;\r\n]+)/gim)) {
      const ex = m[1].trim().toLowerCase();
      if (/^-?\d+$/.test(ex) || /^f/.test(ex) || !/[a-z(]/.test(ex)) continue;
      const bases = [], small = [0], mults = [];
      for (const lit of ex.matchAll(/\d+(?:\.\d+)?/g)) {
        if (lit[0].includes('.')) continue;
        const v = parseInt(lit[0], 10);
        const before = ex.slice(0, lit.index).replace(/\s+$/, ''), after = ex.slice(lit.index + lit[0].length).replace(/^\s+/, '');
        if (/(>=|<=|!=|=|>|<|\/|%)$/.test(before) || /\w\s*\($/.test(before)) continue;
        if (/^\*/.test(after) || /\*$/.test(before)) { if (v >= 10) mults.push(v); continue; }
        if (v >= 1000) bases.push(v); else small.push(v);
      }
      if (!bases.length || !mults.length) continue;
      const sums = new Set([0]);
      for (let k = 0; k < 2; k++) for (const s of [...sums]) for (const o of small) sums.add(s + o);
      for (const b of bases) for (const s of sums) for (const mu of mults) for (let k = 0; k <= 64; k++) out.add(b + s + k * mu);
    }
  }
  return out;
}
// -> null (nothing to ask) | { why, sentence, samples: [[group, index]...] }
function reviewReason(dir, def) {
  const modlib = require('./modlib.js');
  const h = modlib.hScanUncached(dir, def);
  if (!h.giver && !h.receiver) return null;
  const FAM = modlib.H_FAMILIES;
  const inReg = (n) => FAM.some((f) => f.registry !== false && f.ranges.some(([a, b]) => n >= a && n <= b));
  const inFam = (n) => FAM.some((f) => f.ranges.some(([a, b]) => n >= a && n <= b));
  const firstFrames = (list) => list.slice(0, 4).map((n) => { const fr = [...(h.airFrames.get(n) || [])]; return fr.length ? fr[Math.floor(fr.length / 2)].split(',').map(Number) : null; }).filter(Boolean);
  if (h.receiver && h.receiverWhy === 'orphans') {
    const orph = [...h.airActions].filter((n) => inReg(n) && !h.playsOwn.has(n) && !h.uiCards.has(n) && !h.hudRuns.has(n) && !h.blankArt.has(n)).sort((a, b) => a - b);
    if (orph.length) {
      const df = modlib.defFiles(dir, def);
      // SMALL
      let sff = null;
      try { sff = df.sprite ? require('./public/ikemen/sffdec-core.js').readSff(fs.readFileSync(df.sprite)) : null; } catch (e) { sff = null; }
      if (sff) {
        const core = require('./public/ikemen/sffdec-core.js');
        const small = orph.filter((n) => {
          let mw = 0, mh = 0, any = false;
          for (const k of h.airFrames.get(n) || []) {
            const [g, i] = k.split(',').map(Number);
            const s = core.spriteGeom(sff, g, i);
            if (s) { any = true; mw = Math.max(mw, s.w); mh = Math.max(mh, s.h); }
          }
          return any && mw < SMALL_PX && mh < SMALL_PX;
        });
        if (small.length * 2 >= orph.length) {
          return { why: 'small', sentence: 'Its pair animations are small sprites (' + small.length + ' of ' + orph.length + ' under ' + SMALL_PX + ' px) - effects rather than bodies, often.', samples: firstFrames(small) };
        }
      }
      // REACH
      const texts = df.states.map((s) => { try { return fs.readFileSync(s.abs, 'latin1'); } catch (e) { return ''; } });
      const st = reachStarts(texts);
      if (st.size) {
        const sorted = [...h.airActions].sort((a, b) => a - b);
        const after = (n) => { let lo = 0, hi = sorted.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid] > n) hi = mid; else lo = mid + 1; } return lo < sorted.length ? sorted[lo] : null; };
        const reach = new Set();
        for (const s0 of st) {
          let cur = s0 - 1, lim = 40;
          for (;;) { const nx = after(cur); if (nx === null || nx > cur + lim) break; reach.add(nx); cur = nx; lim = 20; }
        }
        const got = orph.filter((n) => reach.has(n));
        if (got.length * 2 >= orph.length) {
          return { why: 'reach', sentence: 'Its own code reaches its pair animations through a computed number (' + got.length + ' of ' + orph.length + ') - they may be its own moves.', samples: firstFrames(got) };
        }
      }
    }
  }
  if (h.giver) {
    const isSix = (n) => n >= 100000 && !inFam(n);
    const rests = (h.why === 'kit' && h.giverHitNums.filter((n) => !isSix(n)).length < 10)
      || (h.why === 'expects' && h.expectsHNums.filter((n) => !isSix(n)).length < 4);
    if (rests) {
      return { why: 'six', sentence: 'Its giver verdict rests on large animation numbers outside every known H family - also how some throws and fatalities are numbered.', samples: [] };
    }
  }
  return null;
}

// The queue for a roster: characters the scan calls H, with no word of the
// owner's on them yet (no hRole, or a confirmation of a different verdict).
// Cached per character while its files keep their size and time.
const CACHE = new Map();
function stamp(dir, def) {
  const modlib = require('./modlib.js');
  const df = modlib.defFiles(dir, def);
  const parts = [path.join(dir, def), ...df.states.map((s) => s.abs), df.anim, df.sprite].filter(Boolean);
  return parts.map((p) => { try { const s = fs.statSync(p); return s.size + '@' + s.mtimeMs; } catch (e) { return '-'; } }).join(';');
}
// `only`: a Set of mountAs to look at (the characters the page's full reading
// found H) - the queue never re-scans a whole big build on the server's thread.
function reviewQueue(roster, only) {
  const modlib = require('./modlib.js');
  const cacheDir = require('./layout.js').dir('cache');
  const out = [];
  for (const c of (roster && roster.chars) || []) {
    if (c.kind || !c.folder || !c.select || c.hRole) continue;
    if (only && !only.has(c.mountAs)) continue;
    const dir = path.join(cacheDir, c.folder);
    const def = String(c.select).split('/').slice(1).join('/');
    let st;
    try { st = stamp(dir, def); } catch (e) { continue; }
    const key = dir + '|' + def;
    let hit = CACHE.get(key);
    if (!hit || hit.st !== st) {
      let h = null, reason = null;
      try { h = modlib.hScan(dir, def); reason = (h.giver || h.receiver) ? reviewReason(dir, def) : null; } catch (e) { reason = null; }
      hit = { st, sig: h ? verdictSig(h) : '', role: h ? { giver: !!h.giver, receiver: !!h.receiver } : null, reason };
      CACHE.set(key, hit);
    }
    if (!hit.reason || c.hReviewed === hit.sig) continue;
    out.push({ mountAs: c.mountAs, folder: c.folder, select: c.select, detected: hit.role, sig: hit.sig,
      why: hit.reason.why, sentence: hit.reason.sentence, samples: hit.reason.samples });
  }
  return out;
}

module.exports = { ROLES, moduleState, moduleOn, effectiveRole, verdictSig, reviewReason, reviewQueue, reachStarts };
