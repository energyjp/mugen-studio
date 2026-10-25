'use strict';
// ONE WRITE PATH FOR EVERY CHARACTER-FILE EDIT (move values, animation data).
//
// STUDIO-ADVANCED.md § 5 is the rule, and it is not fussiness:
//   - IN-PLACE BYTE SPLICE. An edit replaces exactly the bytes of the tokens it
//     changes. Nothing is re-serialized: these files are latin1 or Shift-JIS,
//     full of author comments, and the engine's parser has position-sensitive
//     failure modes. latin1 in and latin1 out maps every byte to one char and
//     back, so offsets are byte offsets and untouched bytes stay identical.
//   - ONE PRISTINE BACKUP PER FILE, taken the first time the file is touched and
//     NEVER overwritten. A second session must not replace the original with an
//     already-edited file - the failure that makes a backup worthless.
//   - VALIDATE, THEN WRITE ATOMICALLY. The caller re-parses the new text with the
//     same scanner and says what must still hold; a failure writes nothing. The
//     write is a temp file renamed over the original, so a crash mid-write leaves
//     either the old file or the new one.
//
// The backup is `<file>.edit.bak`. Every export filter already drops `.bak`
// siblings (vfslib charKeepFilter, make-kit, make-portable), so a backup never
// ships.
const fs = require('fs');
const path = require('path');
// The checked delete (lifebars.js): fs.rmSync can return without deleting a
// path that holds a non-ASCII character, and a character folder can.
const rmFile = (p) => require('./lifebars.js').rmFile(p);

const SUFFIX = '.edit.bak';

function backupPath(absFile) { return absFile + SUFFIX; }
function hasBackup(absFile) { return fs.existsSync(backupPath(absFile)); }

// Copy the file aside the first time; never again.
function backupOnce(absFile) {
  const bak = backupPath(absFile);
  if (fs.existsSync(bak)) return { backup: bak, created: false };
  fs.copyFileSync(absFile, bak, fs.constants.COPYFILE_EXCL);
  return { backup: bak, created: true };
}

// splices: [{ start, end, text }] against the CURRENT file text (latin1 string
// offsets = byte offsets). Non-overlapping; applied back to front.
function applySplices(text, splices) {
  const list = (splices || []).slice().sort((a, b) => b.start - a.start);
  for (let i = 1; i < list.length; i++) {
    if (list[i].end > list[i - 1].start) throw new Error('overlapping edits');
  }
  let out = text;
  for (const s of list) {
    if (!(Number.isInteger(s.start) && Number.isInteger(s.end) && s.start >= 0 && s.end >= s.start && s.end <= out.length)) {
      throw new Error('edit range out of bounds');
    }
    if (/[\r\n]/.test(String(s.text)) && !s.allowNewline) throw new Error('an edit may not insert a line break');
    out = out.slice(0, s.start) + String(s.text) + out.slice(s.end);
  }
  return out;
}

// Read, splice, validate, back up on first touch, write atomically.
//   expectText: optional - the file must still read exactly this (the caller's
//               view is stale otherwise, and the offsets would land wrong)
//   validate(newText, oldText): return null when fine, or a reason string
//   passes:     a LIST of splice lists, applied one after the other, each
//               planned against what the previous one left. A removal and an
//               insertion can want the same byte - one list cannot hold both
//               without overlapping - and this is the only way to do both in
//               one atomic write.
//   backup:     false skips the pristine copy. Only for an edit that carries
//               its own way back: the card's constants are patched from a
//               snapshot taken before the first write and restored from it, so
//               a .bak would add a second, disagreeing way back and would make
//               the move editor's Revert offer to undo a value the roster
//               still believes is set. The backup belongs to the editors whose
//               only way back it is.
function writeSpliced(absFile, splices, opts) {
  const o = opts || {};
  const oldText = fs.readFileSync(absFile, 'latin1');
  if (o.expectText !== undefined && o.expectText !== oldText) {
    throw new Error('the file changed since it was read - reload and try again');
  }
  const passes = o.passes || [splices];
  let newText = oldText;
  for (const list of passes) newText = applySplices(newText, list);
  if (newText === oldText) return { changed: false, backup: hasBackup(absFile) ? backupPath(absFile) : null };
  if (typeof o.validate === 'function') {
    const why = o.validate(newText, oldText);
    if (why) throw new Error('refused: ' + why);
  }
  const b = o.backup === false ? { backup: null, created: false } : backupOnce(absFile);
  const tmp = absFile + '.edit-tmp-' + process.pid;
  try {
    fs.writeFileSync(tmp, Buffer.from(newText, 'latin1'));
    fs.renameSync(tmp, absFile);
  } catch (e) {
    // The file itself is untouched when the write or the rename fails. Leave
    // nothing behind: not the temp file, and not a backup THIS call took - a
    // backup of an unedited file would show as "Edited" with nothing to revert.
    try { rmFile(tmp); } catch (e2) { /* the original error is what matters */ }
    if (b.created) { try { rmFile(b.backup); } catch (e2) { /* as above */ } }
    throw e;
  }
  return { changed: true, backup: b.backup, backupCreated: b.created, bytes: newText.length };
}

// Put the original back and drop the backup. A failed copy or rename removes
// its temp file and keeps the backup: it is still the only pristine copy.
function revert(absFile) {
  const bak = backupPath(absFile);
  if (!fs.existsSync(bak)) return { reverted: false };
  const tmp = absFile + '.edit-tmp-' + process.pid;
  try {
    fs.copyFileSync(bak, tmp);
    fs.renameSync(tmp, absFile);
  } catch (e) {
    try { rmFile(tmp); } catch (e2) { /* the original error is what matters */ }
    throw e;
  }
  // Checked: a backup left behind reads as "Edited" with the edit gone.
  rmFile(bak);
  return { reverted: true };
}

// Every file in a character folder that has an edit backup, at any depth: a
// [Files] path can name a state file several folders down. Symbolic links and
// junctions are not followed (a Dirent for one is not a directory), and the
// walk is bounded so a pathological folder cannot hang a request.
const WALK_MAX_DEPTH = 32, WALK_MAX_ENTRIES = 200000;
function listEdited(charDir) {
  const out = [];
  let seen = 0;
  const walk = (dir, depth) => {
    let ents = [];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const e of ents) {
      if (++seen > WALK_MAX_ENTRIES) return;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) { if (depth < WALK_MAX_DEPTH) walk(abs, depth + 1); continue; }
      if (e.name.endsWith(SUFFIX)) {
        const file = abs.slice(0, -SUFFIX.length);
        out.push({ file: path.relative(charDir, file).replace(/\\/g, '/'), exists: fs.existsSync(file) });
      }
    }
  };
  walk(charDir, 0);
  return out;
}

module.exports = { SUFFIX, backupPath, hasBackup, backupOnce, applySplices, writeSpliced, revert, listEdited };
