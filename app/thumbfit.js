'use strict';
//
// thumbfit.js - "Fit thumbnail" for a stage: a stage that ships its OWN
// select-screen picture at a size that does not match its coordinate space
// gets the [StageInfo] portraitscale that makes the picture fill the box.
//
// WHY IT IS DRAWN SMALL. The engine draws a stage's portrait (the screenpack's
// `stage.portrait.spr`, 9000,1 in both bundled packs) at
//   pack scale x portraitscale x motif.localcoord.w / stage.localcoord.w
// (main.lua f_materializeStagePortrait), from its top-left corner. Against the
// bundled pack (localcoord 1280, scale 0.25) that is a 240x100 box for a stage
// 320 wide, and a stage W wide needs a picture 240*(W/320)/portraitscale by
// 100*(same) to fill it (GRAIL 3.4c; stagethumb.js thumbSize sizes the picture
// it adds by the same rule). cvs2london is 1280 wide with portraitscale 1 and
// ships a 240x100 picture, so it draws at 60x25 - a quarter of the box's width,
// in its top-left corner (seen in the web build's stage select). The engine's own 1280-wide stages (stage0-720, stage3d) ship the very
// same 240x100 picture and declare portraitscale = 4. The fit writes that:
//   portraitscale = (W / 320) * 240 / pictureWidth
// A picture drawn within 2% of the box already fits and is left alone.
//
// THE SHAPE MUST AGREE. portraitscale is one number for both axes, so only a
// picture of the box's 12:5 shape (its height within 2% once the width fits)
// can be made to fill it. Any other shape is reported and left alone: fitted
// by width it would run past the bottom of the box (the bundled pack names no
// stage.portrait.window, so nothing clips it) or leave a band under it.
//
// THE EDIT is the stage's own .def, in place: the portraitscale line's value
// (its spacing and comment kept), with a marker line right above it saying what
// it was; where the key is absent, the marker and the key go right under the
// [StageInfo] header (and a [StageInfo] at the end of the file when there is
// none). Every other byte stays, each line's own ending included - a def with
// mixed CRLF and LF lines keeps them - so Undo puts the file back byte for
// byte. Only the def the roster lists is edited: the select screen reads that
// one, never a round variant (round1def...).
//
// The VS screen's stage portrait (main.lua, vs_anim_data) takes the same
// portraitscale, so it is fitted by the same number.
const fs = require('fs');
const path = require('path');
const core = require('./public/ikemen/sffdec-core.js');
const { sffPathFor } = require('./stagethumb.js');

const MARK = '; thumbnail fit (Mugen Studio):';
const BOX = { w: 240, h: 100 };      // the select box at localcoord 320 (GRAIL 3.4c)
const TOL = 0.02;                     // within 2% of the box is a fit
const SEC_RE = /^\s*\[([^\]]+)\]/;
const KEY_RE = /^(\s*portraitscale\s*=\s*)([^;\r\n]*?)(\s*(?:;.*)?)$/i;
const LC_RE = /^\s*localcoord\s*=\s*([^;\r\n]*)/i;

// The text as lines that KEEP their endings: joined back with '' they are the
// file, byte for byte, whatever mix of CRLF and LF it holds.
const segs = (text) => text.match(/[^\n]*\n|[^\n]+$/g) || [];
const bare = (s) => s.replace(/\r?\n$/, '');
const eolOf = (s) => (/\r\n$/.test(s) ? '\r\n' : /\n$/.test(s) ? '\n' : '');
const fileEol = (text) => (text.includes('\r\n') ? '\r\n' : '\n');
const round5 = (x) => Math.round(x * 100000) / 100000;

// The FIRST [StageInfo] - the only one the engine reads (system.go: the
// stageinfo flag drops the rest) - as [header, end) segment indexes; null when absent.
function stageInfo(ls) {
  for (let i = 0; i < ls.length; i++) {
    const m = SEC_RE.exec(bare(ls[i]));
    if (!m || m[1].trim().toLowerCase() !== 'stageinfo') continue;
    let e = i + 1;
    while (e < ls.length && !SEC_RE.test(bare(ls[e]))) e++;
    return { header: i, start: i + 1, end: e };
  }
  return null;
}
// The first portraitscale in it (the first of a duplicate key wins, as the
// engine reads it), and the marker line if a fit wrote one.
function scan(ls) {
  const info = stageInfo(ls);
  const out = { info, key: null, marker: null, localcoord: [320, 240] };
  if (!info) return out;
  let lcSeen = false;
  for (let i = info.start; i < info.end; i++) {
    const l = bare(ls[i]);
    if (out.marker === null && l.trim().startsWith(MARK)) { out.marker = i; continue; }
    const m = KEY_RE.exec(l);
    if (m && !out.key) out.key = { i, value: m[2], m };
    const lc = !lcSeen && LC_RE.exec(l);
    if (lc) {
      lcSeen = true;
      const n = lc[1].split(',').map((x) => parseFloat(x));
      if (n.length >= 2 && n[0] > 0 && n[1] > 0) out.localcoord = [n[0], n[1]];
    }
  }
  return out;
}
function parseMarker(line) {
  const body = line.slice(line.indexOf(MARK) + MARK.length);
  const was = /portraitscale was (absent|"(?:[^"\\]|\\.)*")/.exec(body);
  const set = /\|\s*set (\S+)/.exec(body);
  return {
    was: !was ? undefined : was[1] === 'absent' ? null : JSON.parse(was[1]),
    set: set ? set[1] : null,
    addedSection: /\|\s*\[StageInfo\] added/.test(body),
    addedEol: /\|\s*newline added/.test(body),
  };
}

// What the fit would do, from the def's text and the size of the picture the
// select screen reads (null when the stage has none).
function plan(text, own) {
  const ls = segs(text);
  const s = scan(ls);
  const W = s.localcoord[0];
  const declared = s.key ? s.key.value.trim() : null;
  const pv = declared === null ? NaN : parseFloat(declared);
  const ps = Number.isFinite(pv) && pv > 0 ? pv : 1;
  const out = { localcoord: s.localcoord, portraitscale: ps, declared, own: own || null };
  if (s.marker !== null) {
    const mk = parseMarker(bare(ls[s.marker]));
    out.fitted = true;
    out.was = mk.was === undefined ? null : mk.was;
  } else out.fitted = false;
  if (!own || !(own.w > 0) || !(own.h > 0)) {
    return Object.assign(out, { fits: false, fittable: false, reason: 'no own thumbnail' });
  }
  // the size it draws at, in the units of the 240x100 box
  const k = ps * 320 / W;
  out.drawn = { w: round5(own.w * k), h: round5(own.h * k) };
  out.percent = Math.round(own.w * k / BOX.w * 100);
  out.fits = Math.abs(own.w * k - BOX.w) <= BOX.w * TOL;
  out.fitting = round5((W / 320) * BOX.w / own.w);
  const hAtFit = own.h * BOX.w / own.w;
  out.shapeAgrees = Math.abs(hAtFit - BOX.h) <= BOX.h * TOL;
  out.fittable = !out.fitted && !out.fits && out.shapeAgrees;
  out.reason = out.fitted ? 'fitted' : out.fits ? 'fits'
    : out.shapeAgrees ? 'drawn at ' + out.percent + '% of the box'
      : 'not the box\'s shape (' + own.w + '\u00d7' + own.h + ', the box is 12:5)';
  return out;
}

function apply(text, own) {
  const p = plan(text, own);
  if (p.fitted) throw new Error('already fitted');
  if (!p.own) throw new Error('this stage has no thumbnail of its own');
  if (p.fits) throw new Error('its thumbnail already fills the box');
  if (!p.shapeAgrees) throw new Error('its thumbnail is ' + p.reason + ', so a scale cannot fill the box');
  const ls = segs(text);
  const s = scan(ls);
  const to = String(p.fitting);
  if (s.key) {
    // in place: the marker on its own line right above, with that line's ending
    const eol = eolOf(ls[s.key.i]) || fileEol(text);
    const end = ls[s.key.i].slice(bare(ls[s.key.i]).length);
    ls[s.key.i] = s.key.m[1] + to + s.key.m[3] + end;
    ls.splice(s.key.i, 0, MARK + ' portraitscale was ' + JSON.stringify(s.key.value) + ' | set ' + to + eol);
  } else if (s.info) {
    // added right under the header, at the header's own line ending
    const h = ls[s.info.header];
    const eol = eolOf(h) || fileEol(text);
    const flag = eolOf(h) ? '' : ' | newline added';
    if (!eolOf(h)) ls[s.info.header] = h + eol;
    const last = s.info.header + 1 === ls.length;
    ls.splice(s.info.header + 1, 0, MARK + ' portraitscale was absent | set ' + to + flag + eol,
      'portraitscale = ' + to + (last && flag ? '' : eol));
  } else {
    const eol = fileEol(text);
    const lastSeg = ls.length ? ls[ls.length - 1] : '';
    const flag = ls.length && !eolOf(lastSeg) ? ' | newline added' : '';
    if (flag) ls[ls.length - 1] = lastSeg + eol;
    ls.push('[StageInfo]' + eol, MARK + ' portraitscale was absent | set ' + to + ' | [StageInfo] added' + flag + eol, 'portraitscale = ' + to + eol);
  }
  return { text: ls.join(''), plan: Object.assign({}, p, { to: p.fitting }) };
}

function undo(text) {
  const ls = segs(text);
  const s = scan(ls);
  if (s.marker === null) throw new Error('not fitted');
  const mk = parseMarker(bare(ls[s.marker]));
  if (mk.was === undefined) throw new Error('the fit marker is unreadable, so the def was left as it is');
  ls.splice(s.marker, 1);
  const t = scan(ls);
  if (mk.was === null) {
    // the key the fit added goes with it (and the section, when the fit added that too)
    if (t.key) ls.splice(t.key.i, 1);
    if (mk.addedSection) {
      const u = scan(ls);
      if (u.info && u.info.start === u.info.end) ls.splice(u.info.header, 1);
    }
    if (mk.addedEol && ls.length) {
      const i = mk.addedSection ? ls.length - 1 : scan(ls).info ? scan(ls).info.header : -1;
      if (i >= 0 && i === ls.length - 1) ls[i] = bare(ls[i]);
    }
  } else if (t.key) {
    // The value the fit wrote goes back to what it was, byte for byte. When
    // something else has changed it since (Widescreen fit scales it with the
    // stage's width), that change is kept: only the fit's own factor is
    // divided back out.
    const now = t.key.value;
    const back = mk.set !== null && now.trim() !== mk.set && parseFloat(mk.set) > 0 && Number.isFinite(parseFloat(now)) && Number.isFinite(parseFloat(mk.was))
      ? String(round5(parseFloat(now) * parseFloat(mk.was) / parseFloat(mk.set))) : mk.was;
    const end = ls[t.key.i].slice(bare(ls[t.key.i]).length);
    ls[t.key.i] = t.key.m[1] + back + t.key.m[3] + end;
  }
  return { text: ls.join(''), was: mk.was };
}

// THE PICTURE THE SELECT SCREEN READS: `spr` out of the stage's own .sff,
// at the size the engine would draw it from. null when the stage names no
// sprite file or lacks the sprite.
function ownSprite(stagesDir, file, spr) {
  const sffPath = sffPathFor(stagesDir, file);
  if (!sffPath) return null;
  const sff = core.readSff(new Uint8Array(fs.readFileSync(sffPath)));
  if (!sff || !sff.byKey) return null;      // not a sprite file this reader (or the engine) takes
  const [g, i] = spr;
  const geom = core.spriteGeom(sff, g, i);
  if (geom && geom.w > 0 && geom.h > 0) return { w: geom.w, h: geom.h };
  if (!sff.byKey || !sff.byKey.has(g + ',' + i)) return null;
  try { const d = core.decodeSprite(sff, g, i); return d && d.w > 0 && d.h > 0 ? { w: d.w, h: d.h } : null; } catch (e) { return null; }
}

// THE SCREENPACK'S PICTURE NUMBER: [Select Info] stage.portrait.spr when the
// pack sets a real one, else 9000,1 - the convention every engine stage and
// the Studio's own Add thumbnail use.
function packSprite(motifText) {
  try {
    const sp = require('./public/ikemen/motif-core.js').parseMotif(String(motifText || '')).select.stagePortrait;
    const s = sp && Array.isArray(sp.spr) ? sp.spr : null;
    if (s && s.length >= 2 && s[0] >= 0 && s[1] >= 0) return [s[0], s[1]];
  } catch (e) { /* the default */ }
  return [9000, 1];
}
// The same from the pack's system.def on disk, kept while the file keeps its
// size and times (the Stages tab asks on every draw); 9000,1 when there is none.
let packKept = null;
function packSpriteAt(motifDefPath) {
  if (!motifDefPath) return [9000, 1];
  const stamp = motifDefPath + '|' + stampOf(motifDefPath);
  if (packKept && packKept.stamp === stamp) return packKept.spr.slice();
  let spr = [9000, 1];
  try { spr = packSprite(fs.readFileSync(motifDefPath, 'latin1')); } catch (e) { spr = [9000, 1]; }
  packKept = { stamp, spr };
  return spr.slice();
}

// THE STATUS IS KEPT per .def while the def and its sprite file keep their
// size and times: the Stages tab asks for every stage on every draw, and
// reading a large .sff each time would be the cost of the whole tab. Stored
// as JSON, so no caller can change the kept copy; bounded like widefit's.
const STATUS = new Map();
const STATUS_MAX = 4096;
const stampOf = (p) => { try { const st = fs.statSync(p); return st.size + '@' + st.mtimeMs + '@' + st.ctimeMs; } catch (e) { return '-'; } };
function check(stagesDir, file, spr) {
  const sprNo = Array.isArray(spr) && spr.length >= 2 ? [spr[0], spr[1]] : [9000, 1];
  const full = path.join(stagesDir, file);
  let sffPath = null;
  try { sffPath = sffPathFor(stagesDir, file); } catch (e) { sffPath = null; }
  const stamp = stampOf(full) + '|' + (sffPath ? sffPath + '|' + stampOf(sffPath) : '-') + '|' + sprNo.join(',');
  const hit = STATUS.get(full);
  if (hit && hit.stamp === stamp) return JSON.parse(hit.json);
  const text = fs.readFileSync(full, 'latin1');
  let own = null;
  try { own = ownSprite(stagesDir, file, sprNo); } catch (e) { own = null; }
  const p = Object.assign({ spr: sprNo }, plan(text, own));
  if (STATUS.size >= STATUS_MAX && !STATUS.has(full)) STATUS.clear();
  STATUS.set(full, { stamp, json: JSON.stringify(p) });
  return p;
}
function fit(stagesDir, file, spr) {
  const sprNo = Array.isArray(spr) && spr.length >= 2 ? [spr[0], spr[1]] : [9000, 1];
  const full = path.join(stagesDir, file);
  const r = apply(fs.readFileSync(full, 'latin1'), ownSprite(stagesDir, file, sprNo));
  STATUS.delete(full);
  fs.writeFileSync(full, r.text, 'latin1');
  return Object.assign({ spr: sprNo }, r.plan);
}
function undoFile(stagesDir, file) {
  const full = path.join(stagesDir, file);
  const r = undo(fs.readFileSync(full, 'latin1'));
  STATUS.delete(full);
  fs.writeFileSync(full, r.text, 'latin1');
  return { was: r.was };
}

module.exports = { MARK, BOX, plan, apply, undo, check, fit, undoFile, ownSprite, packSprite, packSpriteAt, STATUS };
