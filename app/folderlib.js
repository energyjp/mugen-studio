'use strict';
//
// BROWSING FOR A FOLDER, FROM A PAGE THAT CANNOT SEE THE DISK.
//
// The Studio has two homes and only one of them can open a folder dialog. In
// the Studio's own window the host binds `nativePickFolder` onto the page and
// the shell's own picker hands back a real path. In a browser tab there is
// nothing to bind: a file input hands back file CONTENT and a bare name, the
// directory picker hands back entries, and neither of them will ever hand back
// a path the server could open. So every path field in the browser has been a
// box you type into.
//
// This module is the other half of that: the server can see the disk, so the
// page borrows its eyes. It answers ONE question - "what folders are inside
// this folder" - and that is the whole of it.
//
// WHAT IT WILL NOT DO, by construction rather than by checking:
//
//   * it never names a file. The listing is built by filtering readdir down to
//     directories, so a file cannot appear in a reply even by accident;
//   * it never opens a file. Nothing in here reads bytes. The one thing it
//     asks about a folder's CONTENTS is whether three names exist, and
//     access() is a stat, not a read;
//   * it never writes. Every call is readdir, stat and access.
//
// A path that cannot be listed comes back as a REASON, never as a throw: this
// answers a page's navigation, and "there is no folder there" is an answer.
// The reasons are written for somebody standing in front of the Studio - a
// drive with no disc in it, a folder Windows will not let this program read, a
// path that never answers at all - because the alternative is a stack trace in
// a dialog.
//
// NOTHING IN HERE BLOCKS THE STUDIO. Every call is a promise, and it is a
// promise for one reason: a path on a machine that is switched off does not
// fail, it WAITS - measured at 42 seconds on this network before Windows gives
// up - and the Studio's server is one thread. A synchronous readdir on such a
// path freezes every other route behind it for the whole of that wait: a
// character listing, a bundle list, a save. Asked through fs.promises the wait
// happens on libuv's threadpool and the rest of the Studio keeps answering.
//
// Waiting on a thread is still waiting, so there is a DEADLINE on top of it:
// a folder that has not answered within DEADLINE_MS is reported as not having
// answered, and the page gets a sentence in three seconds instead of a frozen
// dialog for the better part of a minute. The call underneath is still out
// there holding a threadpool thread until Windows lets go of it - that cannot
// be canceled - but nothing is waiting on it any more.
//
// KEEPING IT CHEAP. A MUGEN build's chars/ folder can hold two thousand
// folders, and a listing that stalls the page is worse than no listing:
//
//   * one readdir with withFileTypes, so the directory's kinds come back with
//     its names and nothing is stat'ed per entry. A symlink is the exception -
//     its kind is the LINK's - and that is one stat for something that is rare;
//   * the filter is applied on this side. The page sends what was typed and
//     gets back the matches, so a folder of two thousand names never crosses
//     the wire and the page never holds two thousand rows. THE DRIVE LIST IS
//     FILTERED THE SAME WAY: the picker opens there and puts the caret in the
//     filter box, and a box that cannot narrow what is in front of it is worse
//     than no box;
//   * the listing is capped anyway (LIMIT) and says how many it left out;
//   * the "this looks like a MUGEN build" mark costs three stats per folder,
//     which is nothing for a screenful and real money for a thousand. So the
//     children are only marked when there are few enough of them to be worth
//     marking (BADGE_MAX); above that the reply says it did not look, and the
//     page stops showing marks rather than showing wrong ones. The folder you
//     are standing IN is always marked: that is one check, and it is the one
//     that decides whether Use this folder is the right button.
//
// THE MARK IS A HINT, NOT THE ANSWER. It tests the three names buildimport's
// own reader refuses a folder without - data/mugen.cfg, data/select.def,
// chars/ - and it tests them at the spelling MUGEN builds use, because that is
// a stat instead of three readdirs. Reading the build is still what says
// whether it can be imported, and it is still a separate button.
//
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const WIN = process.platform === 'win32';

// Folders sent in one listing. Higher than a screenful on purpose - the page
// scrolls - and far below the size at which building the rows is felt.
const LIMIT = 300;
// Above this many folders in one listing, the children are not checked for
// being MUGEN builds. Three stats each is free at a screenful and is not at a
// thousand, and a folder holding a thousand folders is chars/, not a shelf of
// builds.
const BADGE_MAX = 80;
// A path longer than this is not a path anybody has; refusing it here keeps a
// pasted essay out of fs.
const MAX_LEN = 4096;
// How long a folder gets to answer. Long enough that a drive spinning up or a
// share on the far side of a slow link still lists; short enough that nobody
// sits in front of a dialog wondering whether the Studio has died. A machine
// that is switched off takes 42 seconds to say so, and that is the wait this
// number exists to cut short.
const DEADLINE_MS = 3000;

// Windows keeps its own bookkeeping in every drive root and will not let
// anything read most of it. It is never what somebody is browsing for.
const SYSTEM_NAMES = new Set(['system volume information', '$recycle.bin', 'recycler', '$winreagent']);
const hiddenName = (n) => n.startsWith('.') || n.startsWith('$') || SYSTEM_NAMES.has(n.toLowerCase());

// ---------------------------------------------------------------------------
// waiting, with an end to it
// ---------------------------------------------------------------------------
//
// LATE is what comes back instead of an answer when the deadline is reached.
// A symbol rather than null: null is a thing a listing could legitimately say,
// and "it never answered" must not be mistaken for one.
const LATE = Symbol('late');

// The timer is NOT unref'd: while it is running somebody is waiting for an
// answer, and it is cleared the moment the work settles, so it never outlives
// the call that armed it.
function within(work, ms) {
  let timer = null;
  const late = new Promise((resolve) => { timer = setTimeout(() => resolve(LATE), ms); });
  // Promise.race attaches to `work`, so a rejection that arrives after the
  // deadline is already handled and cannot surface as an unhandled rejection.
  return Promise.race([work, late]).then(
    (v) => { clearTimeout(timer); return v; },
    (e) => { clearTimeout(timer); throw e; },
  );
}

// Does this name exist? Never throws: an unreadable parent is "no".
const there = (p) => fsp.access(p).then(() => true, () => false);

// A build, as cheaply as it can be asked: the three things buildimport's
// inspect() refuses a MUGEN build without, or the two it refuses an Ikemen GO
// build without (its config lives in save/, and its roster wherever its
// screenpack says, so the roster is not asked for). Answers which kind, or
// false.
async function looksLikeBuild(dir) {
  try {
    if (!await there(path.join(dir, 'chars'))) return false;
    if (await there(path.join(dir, 'data', 'mugen.cfg')) && await there(path.join(dir, 'data', 'select.def'))) return 'mugen';
    if (await there(path.join(dir, 'save', 'config.ini'))) return 'ikemen';
    return false;
  } catch (e) { return false; }   // an unreadable folder is not a build you can pick
}

// The mark is never worth waiting for: a folder that will not answer is not a
// build as far as the picker is concerned. `build` stays a yes or no for the
// page; `kind` says which engine's, for the badge.
const markBuild = async (dir) => { const k = await within(looksLikeBuild(dir), DEADLINE_MS); return k === LATE ? false : (k || false); };

// ---------------------------------------------------------------------------
// what the page may ask for
// ---------------------------------------------------------------------------
//
// An empty path is THE DRIVE LIST, which is where browsing starts. Everything
// else has to be a whole path already: this module resolves nothing against a
// working directory, because the Studio's working directory is the program
// folder and a half-typed name would silently land inside it.
function normalize(input) {
  let p = String(input == null ? '' : input).trim();
  // A path copied out of Explorer's address bar arrives in quotes.
  p = p.replace(/^"+|"+$/g, '').trim();
  if (!p) return { roots: true };
  if (p.length > MAX_LEN) return { why: 'that is too long to be a folder path' };
  if (/[\u0000]/.test(p)) return { why: 'that is not a folder path' };
  if (WIN) {
    // Bare drive letter: C: means "C:'s current directory" to Windows, which
    // is a different folder for every process. The root is what was meant.
    if (/^[A-Za-z]:$/.test(p)) p += '\\';
    if (/^[\\/]{2}/.test(p)) {
      // A network path needs both halves. \\server on its own resolves against
      // the current drive - path.resolve('\\\\server') is C:\server - so it
      // has to be refused here rather than handed to fs.
      if (!/^[\\/]{2}[^\\/]+[\\/]+[^\\/]+/.test(p)) {
        return { why: 'a network path needs the server and the share, like \\\\computer\\share' };
      }
    } else if (!/^[A-Za-z]:[\\/]/.test(p)) {
      return { why: 'give the whole path, starting with a drive letter like C:\\ or a network path like \\\\computer\\share' };
    }
  } else if (!p.startsWith('/')) {
    return { why: 'give the whole path, starting at /' };
  }
  return { at: path.resolve(p) };
}

// The folder above, or '' for the drive list, or null when there is nowhere up
// to go. A drive root and a UNC share root are both their own dirname, which
// is how the two are told apart from an ordinary folder.
function parentOf(at) {
  if (!at) return null;
  const up = path.dirname(at);
  if (up !== at) return up;
  return WIN ? '' : null;
}

const isUnc = (at) => WIN && /^[\\/]{2}/.test(at);
const isDriveRoot = (at) => WIN && /^[A-Za-z]:[\\/]?$/.test(at);

// Why a folder would not open, in words. The error's own message carries the
// path and the syscall and is not for reading.
//
// ENOENT IS NEVER A LENGTH COMPLAINT. Node puts the \\?\ prefix on a long
// absolute path itself, so a folder three hundred characters deep lists
// perfectly well and "not there" past any length still means not there. Saying
// otherwise told somebody with a typo to move their build.
function reason(e, at) {
  const code = String(e && e.code || '');
  if (code === 'ENOTDIR') return 'that is a file, not a folder';
  if (code === 'ENAMETOOLONG') {
    return 'that path is ' + at.length + ' characters long, which is longer than this computer will open'
      + ' - move it somewhere shorter, or map a drive to it';
  }
  if (code === 'ENOENT') {
    if (isDriveRoot(at)) return 'that drive is not there, or has no disc in it';
    if (isUnc(at)) return 'that network path is not there';
    return 'there is no folder there';
  }
  if (code === 'EACCES' || code === 'EPERM') return 'Windows will not let the Studio read that folder';
  if (code === 'EBUSY' || code === 'EIO' || code === 'ENXIO' || code === 'ENODEV') {
    return isDriveRoot(at) ? 'that drive is not ready' : 'that folder did not answer';
  }
  if (code === 'UNKNOWN') {
    return isUnc(at) ? 'that network path did not answer - the computer may be off, or the share closed'
      : 'that folder could not be read';
  }
  if (code === 'EMFILE' || code === 'ENFILE') return 'too many files are open to read that folder right now';
  return code ? 'that folder could not be read (' + code + ')' : 'that folder could not be read';
}

// The deadline ran out. Windows has not refused yet and may never; what can be
// said is that nothing came back.
function stalled(at) {
  if (isUnc(at)) return 'that network path did not answer - the computer may be off, or the share closed';
  if (isDriveRoot(at)) return 'that drive is not ready';
  return 'that folder did not answer';
}

// A reply is always the same shape, so the page has one drawing routine.
function reply(o) {
  return Object.assign({
    ok: true, at: '', name: '', parent: null, roots: false, build: false,
    entries: [], total: 0, more: 0, scanned: false, canPick: false,
  }, o);
}

// ---------------------------------------------------------------------------
// the drive list
// ---------------------------------------------------------------------------
//
// There is no portable call for this and the ones Windows offers are a process
// launch each. Asking whether a letter's root exists is a stat, and a letter
// with no drive behind it answers "no" without waiting - EXCEPT for A: and B:,
// where a floppy controller that is no longer there can hold the answer for
// seconds, and except for a letter MAPPED to a machine that is off, which
// holds it for the better part of a minute. Nothing has shipped a MUGEN build
// on a floppy; those two letters are skipped and a path typed into the box
// still reaches them. The mapped-drive case is what the deadline is for: the
// letter is left out of the list rather than the list waiting for it.
async function drives(opts) {
  const q = String((opts && opts.q) == null ? '' : opts.q).trim().toLowerCase();
  if (!WIN) {
    const shown = q && !'/'.includes(q) ? [] : [{ name: '/', path: '/', build: !!(await markBuild('/')) }];
    return reply({ roots: true, at: '', name: '/', entries: shown, total: shown.length, scanned: true });
  }
  const letters = [];
  for (let c = 'C'.charCodeAt(0); c <= 'Z'.charCodeAt(0); c++) {
    const letter = String.fromCharCode(c);
    // The filter first: a letter nobody asked about is not worth a stat.
    if (q && !(letter + ':').toLowerCase().includes(q)) continue;
    letters.push(letter);
  }
  const found = await Promise.all(letters.map(async (letter) => {
    const root = letter + ':\\';
    if ((await within(there(root), DEADLINE_MS)) !== true) return null;
    return { name: letter + ':', path: root, build: !!(await markBuild(root)) };
  }));
  const entries = found.filter(Boolean);
  return reply({ roots: true, at: '', name: 'This PC', entries, total: entries.length, scanned: true });
}

// ---------------------------------------------------------------------------
// one listing
// ---------------------------------------------------------------------------
async function list(where, opts) {
  const o = opts || {};
  const q = String(o.q == null ? '' : o.q).trim().toLowerCase();
  const limit = Number.isFinite(o.limit) && o.limit > 0 ? Math.min(o.limit, 2000) : LIMIT;

  const n = normalize(where);
  // A refusal still points somewhere: the drive list is above everything, so
  // browse() can open there and say why it did not open where it was asked to.
  if (n.why) return reply({ ok: false, why: n.why, at: String(where == null ? '' : where), parent: '', climb: true });
  if (n.roots) return await drives(o);

  const at = n.at;
  let raw;
  try {
    raw = await within(fsp.readdir(at, { withFileTypes: true }), DEADLINE_MS);
  } catch (e) {
    const why = reason(e, at);
    const code = String(e && e.code || '');
    // "Not there" and "that is a file" are navigation, not failure: the page is
    // told where to go instead. Anything else stays put, because climbing out
    // of a folder somebody cannot read would hide that they cannot read it.
    const climb = code === 'ENOENT' || code === 'ENOTDIR' || code === 'ENAMETOOLONG';
    return reply({ ok: false, why, at, parent: parentOf(at), climb });
  }
  // A path that never answered is NOT climbed out of: every folder above a
  // machine that is off is on that same machine, so climbing would spend the
  // whole deadline again per hop and end up saying the same thing.
  if (raw === LATE) return reply({ ok: false, why: stalled(at), at, parent: parentOf(at), climb: false });

  const found = [];
  for (const e of raw) {
    const name = e.name;
    if (hiddenName(name)) continue;
    let isDir = e.isDirectory();
    if (!isDir && e.isSymbolicLink()) {
      // The dirent's kind is the link's own. One stat, for something rare.
      try { isDir = (await fsp.stat(path.join(at, name))).isDirectory(); } catch (x) { isDir = false; }
    }
    if (!isDir) continue;                       // A FILE IS NEVER NAMED HERE.
    if (q && !name.toLowerCase().includes(q)) continue;
    found.push(name);
  }
  found.sort((a, b) => a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : 0);

  const shown = found.slice(0, limit);
  // One deadline over the whole marking pass rather than one per folder: it is
  // the same disk answering, and a screenful of stats that has not finished in
  // three seconds is a folder whose marks are not worth waiting for.
  let scanned = shown.length <= BADGE_MAX;
  let marks = null;
  if (scanned) {
    const m = await within(Promise.all(shown.map((nm) => looksLikeBuild(path.join(at, nm)))), DEADLINE_MS);
    if (m === LATE) scanned = false; else marks = m;
  }
  const entries = shown.map((name, i) => ({
    name, path: path.join(at, name), build: marks ? !!marks[i] : false, kind: marks && marks[i] ? marks[i] : undefined,
  }));

  const here = await markBuild(at);
  return reply({
    ok: true, at, name: path.basename(at) || at, parent: parentOf(at),
    build: !!here, kind: here || undefined, entries, total: found.length,
    more: found.length - entries.length, scanned, canPick: true,
  });
}

// ---------------------------------------------------------------------------
// browse: one listing the page can always draw
// ---------------------------------------------------------------------------
//
// Browse is pressed beside a box somebody has been typing in, so the path it
// starts from is as likely to be half-written as it is to exist. Rather than
// opening on an error, the nearest folder above it that DOES open is listed,
// and the reason the asked-for one did not is carried along so the page can
// say what happened. A file passed as a folder lands in the folder that holds
// it, which is where somebody who dragged in a .def meant to be.
async function browse(where, opts) {
  const first = await list(where, opts);
  if (first.ok || !first.climb) return first;
  let up = first.parent, hops = 0;
  while (up !== null && hops++ < 64) {
    const r = await list(up, opts);
    if (r.ok) { r.missed = first.at; r.why = first.why; return r; }
    up = r.parent;
  }
  return first;
}

module.exports = { browse, list, drives, looksLikeBuild, LIMIT, BADGE_MAX, DEADLINE_MS };
