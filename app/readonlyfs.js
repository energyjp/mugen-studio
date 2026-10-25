'use strict';
// A BUILD OPENED READ-ONLY STAYS UNTOUCHED, WHATEVER ASKS.
//
// An external bundle (layout.js, bundles.openExternal) reads somebody's MUGEN
// or Ikemen GO install where it is. The routes that change content already
// answer 409 in such a bundle (server.js), but that is a list, and a list is
// only as good as the last person who read every route: a repair a GET runs
// on the way, a cache written beside a character, a helper three calls down
// that tidies a folder. So the promise is kept one level lower, where every
// one of those ends up - Node's fs.
//
// install({ root }) wraps every fs function that changes the disk - the sync,
// callback and promise forms of writeFile, appendFile, mkdir, mkdtemp, rm,
// rmdir, unlink, rename (both ends), copyFile and cp (the destination),
// symlink, link, truncate, utimes, lutimes, chmod, lchmod, chown, lchown, and
// open / createWriteStream / readFile with any flag that writes, appends or
// creates - and a call whose target lies under the root fails with an Error
// whose code is EROFS and which names the path. A sync call throws it, a
// callback gets it, a promise rejects with it. Reads are never refused (a
// readFile is looked at only for a flag that writes) - and neither is a
// recursive mkdir of a folder that is already there, which changes nothing
// and is how a great deal of code says "make sure it exists" before reading.
//
// "UNDER THE ROOT" IS ASKED THREE WAYS, because a path can reach a folder by
// more than one spelling:
//   - by name, case-insensitively on Windows (G:\Game\X and g:\game\x are one
//     folder there), with a \\?\ prefix taken off first where it spells a
//     drive or a share, and a stream's name (x:s, a folder's own :s) taken
//     off the end (absOf);
//   - against the real paths as well: the root's own, and that of every link
//     at its top - a build's chars/ can be a junction to another drive, and
//     the folder it leads to is the build's as much as chars/ is;
//   - by the real path of the deepest part of the target that exists, so a
//     link or junction somewhere else that leads into the build is caught,
//     and so are a short 8.3 name and a volume GUID path (\\?\Volume{...}\).
// And three operations are refused for what they would do to the root from
// OUTSIDE it: removing or renaming a folder that holds the root, a recursive
// remove of a folder with a link inside that leads into the root or to a
// folder that holds it (Node has followed a junction during a recursive
// delete before - the 2026-09-27 cache loss), and a hard link to a file in
// the root, which would make a second name for it that writes land on.
//
// What it cannot see: a child process writing on its own (tar.exe, a
// PowerShell dialog, the engine), and a module that took an fs function into
// a variable of its own before install() ran. server.js installs it before it
// serves anything, and nothing in this program keeps fs functions apart from
// the module object (fs.promises is the same object everywhere). Nor, as
// measured on 2026-10-09 (none of them is anything this program does): the
// build reached through a share of this same machine (\\localhost\C$\...,
// whose real path stays a share path), a hard link to a build file made
// before install() (outside the root, it is just another file), and
// fchmod / FileHandle.chmod on a descriptor opened read-only - Windows lets
// that set the read-only attribute, and descriptors are not watched.
const fs = require('fs');
const path = require('path');
const { fileURLToPath } = require('url');

const WIN = process.platform === 'win32';

// The original functions, kept so the guard's own reads and uninstall() use
// them, and so a second install() wraps nothing twice.
let state = null;

const strip = (p) => p.replace(/^\\\\\?\\UNC\\/i, '\\\\').replace(/^\\\\\?\\/, '');
const fold = (p) => (WIN ? strip(p).toLowerCase() : p);
function within(p, root) {
  const a = fold(p), r = fold(root);
  return a === r || a.startsWith(r.endsWith(path.sep) ? r : r + path.sep);
}
// The path a call names, absolute, as the checks compare it. A long-path
// prefix comes off only where it spells a drive or a share (\\?\C:\x is C:\x,
// \\?\UNC\s\h\x is \\s\h\x); any other \\?\ path - a volume GUID
// (\\?\Volume{...}\x), \\?\GLOBALROOT\... - is kept whole, so that its real
// path is what is compared: with the prefix taken off it read as a name under
// the working folder, and a write into the build by its volume GUID went
// through (2026-10-09). And on Windows a colon after the drive starts a
// stream's name - <file>:s, <folder>:s:$DATA - and a stream is part of the
// file or folder before the colon, so that is the path checked: a stream
// written on the build's own folder went through too.
function absOf(p) {
  const s = String(p);
  const abs = path.resolve(/^\\\\\?\\(?:[a-z]:|unc\\)/i.test(s) ? strip(s) : s);
  if (!WIN) return abs;
  const drive = (/^(?:\\\\[?.]\\)?[a-z]:/i.exec(abs) || [''])[0];
  const colon = abs.indexOf(':', drive.length);
  return colon < 0 ? abs : abs.slice(0, colon);
}

// A path argument as a string, or null for a file descriptor or a FileHandle
// (those were opened, and the open is what was checked).
function asPath(p) {
  if (typeof p === 'string') return p;
  if (Buffer.isBuffer(p)) return p.toString();
  if (p instanceof URL) { try { return fileURLToPath(p); } catch (e) { return null; } }
  return null;
}

// The real path of the deepest part of `abs` that exists, with the rest of
// it put back on.
function realish(abs, realpath) {
  const rest = [];
  let cur = abs;
  for (;;) {
    try { return path.join(realpath(cur), ...rest.reverse()); } catch (e) { /* not there yet */ }
    const up = path.dirname(cur);
    if (up === cur) return abs;
    rest.push(path.basename(cur));
    cur = up;
  }
}

function inRoot(p) {
  const abs = absOf(p);
  for (const r of state.roots) if (within(abs, r)) return true;
  const real = realish(abs, state.realpath);
  for (const r of state.roots) if (within(real, r)) return true;
  return false;
}
// A folder that holds the root: removing or moving it takes the build along.
function holdsRoot(p) {
  const abs = absOf(p);
  const real = realish(abs, state.realpath);
  for (const r of state.roots) if (within(r, abs) || within(r, real)) return true;
  return false;
}
// A link anywhere inside `dir` that leads into the root, or to a folder that
// holds it (a link to the build's parent is the build's way in as much as a
// link to the build is). Walked with the original readdir and lstat, never
// through a link.
function linkInto(dir) {
  const walk = (d) => {
    let ents;
    try { ents = state.readdir(d, { withFileTypes: true }); } catch (e) { return false; }
    for (const e of ents) {
      const q = path.join(d, e.name);
      let st;
      try { st = fs.lstatSync(q); } catch (err) { continue; }
      if (st.isSymbolicLink()) { if (inRoot(q) || holdsRoot(q)) return true; continue; }
      if (st.isDirectory() && walk(q)) return true;
    }
    return false;
  };
  try { if (!fs.lstatSync(dir).isDirectory()) return false; } catch (e) { return false; }
  return walk(dir);
}

function refusal(op, p) {
  const e = new Error('EROFS: this build is open read-only - ' + op + ' refused on ' + p);
  e.code = 'EROFS';
  e.errno = -30;
  e.syscall = op;
  e.path = p;
  return e;
}

// Does an open flag write? 'r' and 'rs' do not; anything with w, a or + does,
// and so does a numeric flag with a write, create, truncate or append bit.
function writes(flags) {
  if (flags === undefined || flags === null) return false;
  if (typeof flags === 'number') {
    const C = fs.constants;
    return !!(flags & (C.O_WRONLY | C.O_RDWR | C.O_CREAT | C.O_TRUNC | C.O_APPEND));
  }
  return /[wa+]/.test(String(flags));
}

// What each operation checks, given its arguments: the path it refuses on,
// or null when the call may go ahead.
const recursive = (o) => !!(o && typeof o === 'object' && o.recursive);
const dest = (i) => (args) => { const p = asPath(args[i]); return p && inRoot(p) ? p : null; };
const removal = (args) => {
  const p = asPath(args[0]);
  if (!p) return null;
  if (inRoot(p) || holdsRoot(p)) return p;
  if (recursive(args[1]) && linkInto(path.resolve(p))) return p;
  return null;
};
// A recursive mkdir of a folder that is already there changes nothing (Node
// returns without touching it), and "make sure the folder exists" is a common
// first line of code that then only reads - so that one is let through.
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch (e) { return false; } };
const mkdir = (args) => {
  const p = dest(0)(args);
  return p && !(recursive(args[1]) && isDir(p)) ? p : null;
};
// A read whose flag writes is a write: readFileSync(p, { encoding: 'utf8',
// flag: 'w' }) empties the file, { flag: 'a' } makes one. Node opens those
// itself, not through fs.open, so they went past the open check (2026-10-09).
// A read with no flag - every read this program makes - is let through before
// anything else is looked at.
const readFlag = (args) => {
  const o = args[1];
  if (!writes(o && typeof o === 'object' ? o.flag : undefined)) return null;
  const p = asPath(args[0]);
  return p && inRoot(p) ? p : null;
};
const CHECKS = {
  readFile: readFlag,
  writeFile: dest(0), appendFile: dest(0), mkdir, mkdtemp: dest(0),
  truncate: dest(0), utimes: dest(0), lutimes: dest(0), chmod: dest(0), lchmod: dest(0),
  chown: dest(0), lchown: dest(0),
  unlink: removal, rm: removal, rmdir: removal,
  rename: (args) => {
    const from = asPath(args[0]), to = asPath(args[1]);
    if (from && (inRoot(from) || holdsRoot(from))) return from;
    return to && inRoot(to) ? to : null;
  },
  copyFile: dest(1), cp: dest(1),
  // the new link's own path; a symlink that only POINTS into the root is
  // harmless (a write through it is caught by its real path)
  symlink: dest(1),
  link: (args) => dest(1)(args) || dest(0)(args),
  open: (args) => {
    const p = asPath(args[0]);
    const flags = typeof args[1] === 'function' ? undefined : args[1];
    return p && writes(flags) && inRoot(p) ? p : null;
  },
};

// Every folder the guard holds for a build: the root by name, its real path,
// and the real path of each link at its top. bundles.openExternal asks the
// same question before it makes a record, so a build whose links lead into
// the Studio's own folders is refused there rather than locking them here.
function rootsOf(dir) {
  const root = path.resolve(String(dir));
  const realpath = fs.realpathSync.native || fs.realpathSync;
  const roots = [root];
  const add = (p) => { try { const r = realpath(p); if (!roots.some((x) => within(r, x))) roots.push(r); } catch (e) { /* not there, or a link to nothing */ } };
  add(root);
  let ents = [];
  try { ents = fs.readdirSync(root, { withFileTypes: true }); } catch (e) { ents = []; }
  for (const e of ents) if (e.isSymbolicLink()) add(path.join(root, e.name));
  return roots;
}

function install(opts) {
  const root = opts && opts.root ? path.resolve(String(opts.root)) : '';
  if (!root) throw new Error('readonlyfs.install: no root');
  if (state) uninstall();
  const realpath = fs.realpathSync.native || fs.realpathSync;
  const roots = rootsOf(root);
  state = { root, roots, realpath, readdir: fs.readdirSync, onRefuse: opts.onRefuse || null, orig: {}, origPromises: {} };
  const refused = (op, p) => {
    const e = refusal(op, p);
    if (state && state.onRefuse) { try { state.onRefuse(e); } catch (x) { /* a logger never decides */ } }
    return e;
  };

  for (const op of Object.keys(CHECKS)) {
    const check = CHECKS[op];
    // sync
    const syncName = op + 'Sync';
    if (typeof fs[syncName] === 'function') {
      const orig = fs[syncName];
      state.orig[syncName] = orig;
      fs[syncName] = function guardedSync(...args) {
        const p = check(args);
        if (p) throw refused(syncName, p);
        return orig.apply(this, args);
      };
    }
    // callback
    if (typeof fs[op] === 'function') {
      const orig = fs[op];
      state.orig[op] = orig;
      fs[op] = function guarded(...args) {
        const p = check(args);
        if (p) {
          const cb = args[args.length - 1];
          const e = refused(op, p);
          if (typeof cb !== 'function') throw e;
          process.nextTick(cb, e);
          return undefined;
        }
        return orig.apply(this, args);
      };
    }
    // promise
    if (fs.promises && typeof fs.promises[op] === 'function') {
      const orig = fs.promises[op];
      state.origPromises[op] = orig;
      fs.promises[op] = function guardedPromise(...args) {
        const p = check(args);
        if (p) return Promise.reject(refused('promises.' + op, p));
        return orig.apply(this, args);
      };
    }
  }
  // A write stream opens its file with fs.open (wrapped above) once it is
  // running; checked here too so the refusal comes back from the call that
  // asked, before any stream exists.
  const origStream = fs.createWriteStream;
  state.orig.createWriteStream = origStream;
  fs.createWriteStream = function guardedStream(p, o) {
    const s = asPath(p);
    const flags = o && typeof o === 'object' && o.flags !== undefined ? o.flags : 'w';
    if (s && writes(flags) && inRoot(s)) throw refused('createWriteStream', s);
    return origStream.apply(this, arguments);
  };
  return { root, roots: roots.slice() };
}

function uninstall() {
  if (!state) return;
  for (const k of Object.keys(state.orig)) fs[k] = state.orig[k];
  for (const k of Object.keys(state.origPromises)) fs.promises[k] = state.origPromises[k];
  state = null;
}

// Whether a path is under the guarded root - for a caller that would rather
// not try a write it knows will be refused. False when nothing is installed.
function guards(p) {
  const s = asPath(p);
  return !!(state && s && inRoot(s));
}

module.exports = { install, uninstall, guards, rootsOf, installed: () => (state ? state.root : '') };
