'use strict';
//
// debugbg.js - "Debug background is on": a stage whose [BGdef] sets debugbg
// shows magenta wherever its art leaves a gap. The Stages tab says so on the
// stage's card, and Fix turns it off in the stage's own .def.
//
// WHY. debugbg is a MUGEN stage-authoring aid: with it on, the engine clears
// the screen to magenta (0xff00ff) before it draws the stage (system.go, the
// fill color: GSF_nobg -> 0, debugbg -> 0xff00ff, else the stage's
// bgclearcolor), so every spot the art does not cover shows bright pink - the
// sides of a stage zoomed out past its art, and the band a screen shake crops
// (stage.go, the overdraw clip a shake makes). Off, those spots show the
// stage's clear color (black unless it sets bgclearcolor). A player never
// wants it; stages ship with it left on (TouhouCasino.def, J_UMA-UMA.def).
// Nothing changes it on import: the card only says so until Fix is pressed.
//
// AS THE ENGINE READS IT (stage.go loadStage: getSection("bgdef") and
// sec.ReadBool("debugbg")): the lines are trimmed; a section header is a line
// starting with '[' whose text before a ';' ends with ']', named by what is
// between the brackets up to the first space, lower-cased (common.go
// SectionName), and a line starting with '[' ends the section before it
// (IniSection.Parse); the FIRST section of the name counts, and the localized
// "<language>.bgdef" before it ("en", the engine's default language); in it,
// a line's text before a ';', its key up to the first '=', space or tab,
// lower-cased, the value what follows the '=' (trimmed; none without an '='),
// and the FIRST line of a key wins. ReadBool takes the value's first
// comma-separated part, trimmed, through Atoi (an optional sign, then the
// digits up to the first other character) and calls it on when that is not 0:
// "1", "1.0", "01", "-1" are on; "0", "0.5", "yes", "" are off.
//
// THE EDIT is that one line's value, made 0 in place (the spacing around it,
// its comment and its line ending kept), with a marker line written just above
// it that holds the value it had. Undo takes the marker line out and puts the
// value back, so the file is byte for byte what it was (the widefit.js
// pattern). Undo refuses when the line has been changed or removed since.
// Only the stage's own .def: a round variant's (round1def...) is not read.
const fs = require('fs');
const path = require('path');

const MARK = '; debug background turned off (Mugen Studio): debugbg was ';
const LANGUAGE = 'en';   // the engine's default Config.Language

// The text as lines that KEEP their endings: joined back with '' they are the
// file, byte for byte, whatever mix of CRLF and LF it holds (thumbfit.js).
const segs = (text) => text.match(/[^\n]*\n|[^\n]+$/g) || [];
const bare = (s) => s.replace(/\r?\n$/, '');
const fileEol = (text) => (text.includes('\r\n') ? '\r\n' : '\n');

// common.go SectionName, on a trimmed line: the section's name, or null when
// the line is no header.
function sectionName(t) {
  if (!t.startsWith('[')) return null;
  const s = t.split(';')[0].trim();
  if (!s.endsWith(']')) return null;
  const inner = s.slice(1, s.indexOf(']'));
  const sp = inner.indexOf(' ');
  return (sp >= 0 ? inner.slice(0, sp + 1) : inner).toLowerCase();
}
// common.go IniSection.Parse, one line: { key, value } or null.
function kvOf(raw) {
  const l = raw.trim().split(';')[0].trim();
  const ia = l.search(/[= \t]/);
  if (ia <= 0) return null;
  const eq = l.indexOf('=');
  return { key: l.slice(0, ia).toLowerCase(), value: eq >= 0 ? l.slice(eq + 1).trim() : '' };
}
// common.go IniSection.ReadBool through Atoi.
function truthy(value) {
  const first = String(value == null ? '' : value).split(',')[0].trim();
  if (!first) return false;
  const m = /^[+-]?(\d*)/.exec(first);
  return /[1-9]/.test(m[1]);
}

// The [BGdef] the engine reads, and its debugbg line.
//   { section: { header, start, end } | null, line: segment index | null,
//     value: as written (trimmed) | null, on, marker: segment index | null, was }
function scan(text) {
  const ls = segs(text);
  const firsts = new Map();   // section name -> its first { header, start, end }
  let cur = null;
  ls.forEach((seg, i) => {
    const t = bare(seg).trim();
    if (t.startsWith('[')) {
      if (cur) { cur.end = i; cur = null; }
      const n = sectionName(t);
      if (n !== null && !firsts.has(n)) { cur = { header: i, start: i + 1, end: ls.length }; firsts.set(n, cur); }
    }
  });
  const section = firsts.get(LANGUAGE + '.bgdef') || firsts.get('bgdef') || null;
  const out = { ls, section, line: null, value: null, on: false, marker: null, was: null };
  if (!section) return out;
  for (let i = section.start; i < section.end; i++) {
    const raw = bare(ls[i]);
    if (out.marker === null && raw.trim().startsWith(MARK)) { out.marker = i; out.was = raw.trim().slice(MARK.length).trim(); continue; }
    const kv = kvOf(raw);
    if (!kv || kv.key !== 'debugbg' || out.line !== null) continue;
    out.line = i; out.value = kv.value; out.on = truthy(kv.value);
  }
  return out;
}

// A debugbg line with its value made `value`: the text around the value (key,
// '=', the spacing on both sides of the value, the comment, the line ending)
// kept as it was.
function withValue(seg, value) {
  const raw = bare(seg), eol = seg.slice(raw.length);
  const semi = raw.indexOf(';');
  const body = semi >= 0 ? raw.slice(0, semi) : raw, tail = semi >= 0 ? raw.slice(semi) : '';
  const eq = body.indexOf('=');
  if (eq < 0) return null;
  const after = body.slice(eq + 1);
  const lead = /^\s*/.exec(after)[0];
  const trail = after.length > lead.length ? /\s*$/.exec(after)[0] : '';
  return body.slice(0, eq + 1) + lead + value + trail + tail + eol;
}

// What the card shows: null for a stage with debugbg off and no fix of ours
// (nearly every stage).
//   { on, value, line (1-based), fixed (the marker is there), was }
function read(text) {
  const s = scan(text);
  if (!s.on && s.marker === null) return null;
  return { on: s.on, value: s.value, line: s.line === null ? null : s.line + 1, fixed: s.marker !== null, was: s.was };
}

function fix(text) {
  const s = scan(text);
  if (s.marker !== null) throw new Error('this stage’s debug background was already turned off by the Studio');
  if (!s.on) throw new Error('this stage’s debug background is not on');
  const next = withValue(s.ls[s.line], '0');
  if (next === null) throw new Error('this stage’s debugbg line could not be read');
  const ls = s.ls.slice();
  const eol = /\r?\n$/.exec(ls[s.line]);
  ls[s.line] = next;
  ls.splice(s.line, 0, MARK + s.value + (eol ? eol[0] : fileEol(text)));
  const out = ls.join('');
  // the undo it promises, checked before anything is written
  if (undo(out).text !== text) throw new Error('the edit would not undo cleanly, so nothing was changed');
  return { text: out, was: s.value, line: s.line + 2 };
}

function undo(text) {
  const s = scan(text);
  if (s.marker === null) throw new Error('nothing to undo: this stage’s debug background was not turned off by the Studio');
  if (s.line === null) throw new Error('the debugbg line is gone since the fix; the def was left as it is');
  if (s.value !== '0') throw new Error(`debugbg is ${s.value} now, not the 0 the fix wrote; the def was left as it is`);
  const back = withValue(s.ls[s.line], s.was);
  if (back === null) throw new Error('this stage’s debugbg line could not be read');
  const ls = s.ls.slice();
  ls[s.line] = back;
  ls.splice(s.marker, 1);
  return { text: ls.join(''), was: s.was };
}

// THE STATUS IS KEPT per .def while the file keeps its size and times (the
// Stages tab asks for every stage on every draw), as its JSON so no caller can
// change the kept copy; a fix or an undo drops its own entry. Bounded.
const STATUS = new Map();
const STATUS_MAX = 4096;
const stampOf = (full) => { try { const st = fs.statSync(full); return st.size + '@' + st.mtimeMs + '@' + st.ctimeMs; } catch (e) { return null; } };
function status(dir, file) {
  const full = path.join(dir, file);
  const stamp = stampOf(full);
  const hit = stamp && STATUS.get(full);
  if (hit && hit.stamp === stamp) return JSON.parse(hit.json);
  const r = read(fs.readFileSync(full, 'latin1'));
  if (stamp) {
    if (STATUS.size >= STATUS_MAX && !STATUS.has(full)) STATUS.clear();
    STATUS.set(full, { stamp, json: JSON.stringify(r) });
  }
  return r;
}
function writeBack(full, before, after) {
  STATUS.delete(full);
  fs.writeFileSync(full, after, 'latin1');
  if (fs.readFileSync(full, 'latin1') !== after) {
    fs.writeFileSync(full, before, 'latin1');
    throw new Error('the stage’s .def did not read back as written, so it was put back');
  }
}
function fixFile(dir, file) {
  const full = path.join(dir, file);
  const text = fs.readFileSync(full, 'latin1');
  const r = fix(text);
  writeBack(full, text, r.text);
  return { was: r.was, line: r.line };
}
function undoFile(dir, file) {
  const full = path.join(dir, file);
  const text = fs.readFileSync(full, 'latin1');
  const r = undo(text);
  writeBack(full, text, r.text);
  return { was: r.was };
}

module.exports = { MARK, truthy, scan, read, fix, undo, status, fixFile, undoFile };
