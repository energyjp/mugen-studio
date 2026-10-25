'use strict';
//
// READING THE FILES A BOXEDAPP-PACKED PROGRAM CARRIES INSIDE ITSELF.
//
// BoxedApp Packer folds a program and the files beside it into one .exe: at
// run time the packed files appear in a virtual file system as if they were
// sitting next to the program. An Ikemen GO build shipped this way has chars/
// and sound/ on disk but its data/ and stages/ only inside the .exe, so the
// build importer (buildimport.js) unpacks them to a folder of its own and
// reads the build through both.
//
// THE FORMAT, as measured on a real packed build (GRAIL has the rule):
//
//   PE section ".bxpck" (found in the section table, never at a fixed offset)
//     +0   u32  offset of the first record, from the section start
//   records, chained back to back until a record length of 0:
//     R+0  u32  record length (header + strings + data)
//     R+4  u16  record type; 5 is a file or folder of the packed tree
//     R+14 u32  0xFFFFFFFF for a folder, 0 for a file
//     R+42 u32  data size in bytes (0 for a folder)
//     R+62 u32  offset of the short name     (UTF-16LE, NUL-terminated; 86)
//     R+66 u32  offset of the command line   (UTF-16LE, "/RegServer")
//     R+70 u32  offset of a third string     (UTF-16LE, empty)
//     R+74 u32  offset of the full path      (UTF-16LE, "<ExeDir>\data\...")
//     R+78 u32  offset of the data           (the raw, uncompressed bytes)
//   every offset is from R; the data runs from R+[78] to R+[0].
//
// EVERY RECORD IS CHECKED as it is read - its length inside the section, its
// string offsets in order, its size field equal to the bytes its length
// leaves for data, its short name the last part of its path - and a record
// that does not fit refuses the whole read. No size is ever guessed.
//
// PATH SAFETY. Only records under "<ExeDir>\" are part of the build (the
// packer also lists its own placeholder folders - <SystemDrive>, <UserAppData-
// Folder> and the like - and those are ignored). A path with an empty, "." or
// ".." part, a drive, a colon or a character no file name can hold is refused
// and never written, and every written path is checked to resolve inside the
// folder it is written to. The .exe is read in slices and never loaded whole.
const fs = require('fs');
const path = require('path');

const SECTION = '.bxpck';
const TYPE_ENTRY = 5;
const HEADER = 86;
const ROOT_TAG = '<ExeDir>';
const BAD_CHARS = /[<>:"|?*\u0000-\u001f]/;

function readAt(fd, off, n) {
  const b = Buffer.alloc(n);
  const got = fs.readSync(fd, b, 0, n, off);
  return got === n ? b : b.subarray(0, got);
}

// The .bxpck section of a PE file, or null when the file is not a PE file or
// has no such section.
function sectionOf(fd) {
  const size = fs.fstatSync(fd).size;
  if (size < 64) return null;
  const dos = readAt(fd, 0, 64);
  if (dos.length < 64 || dos.toString('latin1', 0, 2) !== 'MZ') return null;
  const peOff = dos.readUInt32LE(0x3c);
  if (peOff + 24 > size) return null;
  const pe = readAt(fd, peOff, 24);
  if (pe.length < 24 || pe.toString('latin1', 0, 4) !== 'PE\0\0') return null;
  const nSec = pe.readUInt16LE(6), optSize = pe.readUInt16LE(20);
  const tableAt = peOff + 24 + optSize;
  if (!nSec || tableAt + nSec * 40 > size) return null;
  const table = readAt(fd, tableAt, nSec * 40);
  for (let i = 0; i < nSec; i++) {
    const s = table.subarray(i * 40, i * 40 + 40);
    if (s.toString('latin1', 0, 8).replace(/\0.*$/s, '') !== SECTION) continue;
    const raw = s.readUInt32LE(20), rawSize = s.readUInt32LE(16);
    if (!rawSize || raw + rawSize > size) return null;
    return { raw, rawSize, end: raw + rawSize };
  }
  return null;
}

function withFd(exePath, fn) {
  const fd = fs.openSync(exePath, 'r');
  try { return fn(fd); } finally { fs.closeSync(fd); }
}

// True when the file is a PE program carrying a BoxedApp section.
function isPacked(exePath) {
  try { return withFd(exePath, (fd) => !!sectionOf(fd)); } catch (e) { return false; }
}

// A packed path ("<ExeDir>\data\system.def") as a build-relative one
// ("data/system.def"), or the reason it is refused.
function relPath(packed) {
  const p = String(packed);
  if (p === ROOT_TAG) return { root: true };
  if (!p.startsWith(ROOT_TAG + '\\')) return { outside: true };
  const parts = p.slice(ROOT_TAG.length + 1).split('\\');
  for (const seg of parts) {
    if (!seg || seg === '.' || seg === '..') return { refused: 'an empty, "." or ".." part' };
    if (seg.includes('/')) return { refused: 'a "/" inside a name' };
    if (BAD_CHARS.test(seg)) return { refused: 'a drive, a colon or a character no file name can hold' };
  }
  return { rel: parts.join('/') };
}

// Every file and folder the program carries under its own folder:
//   { exe, files: [{ path, offset, size, dir }], refused: [{ packed, why }],
//     ignored, bytes }
// `offset` is the file offset of the data in the .exe. Throws when the
// program is not packed or a record does not fit the layout above.
function list(exePath) {
  return withFd(exePath, (fd) => {
    const sec = sectionOf(fd);
    if (!sec) throw new Error(path.basename(exePath) + ' is not a BoxedApp-packed program');
    const bad = (at, why) => new Error(path.basename(exePath) + ': the packed record at ' + (at - sec.raw)
      + ' does not fit the BoxedApp layout this Studio reads (' + why + ')');
    const first = readAt(fd, sec.raw, 4);
    if (first.length < 4) throw bad(sec.raw, 'the section is empty');
    let R = sec.raw + first.readUInt32LE(0);
    const out = { exe: path.basename(exePath), files: [], refused: [], ignored: 0, bytes: 0 };
    let sawEnd = false;
    while (R + 6 <= sec.end) {
      const head = readAt(fd, R, Math.min(HEADER, sec.end - R));
      const len = head.readUInt32LE(0);
      if (len === 0) { sawEnd = true; break; }
      if (len < 6 || R + len > sec.end) throw bad(R, 'its length runs past the section');
      const type = head.readUInt16LE(4);
      if (type !== TYPE_ENTRY) { R += len; continue; }
      if (len < HEADER || head.length < HEADER) throw bad(R, 'shorter than a file record');
      const offs = [62, 66, 70, 74, 78].map((k) => head.readUInt32LE(k));
      const size = head.readUInt32LE(42);
      const folderFlag = head.readUInt32LE(14);
      const [oName, oArgs, oThird, oPath, oData] = offs;
      if (oName !== HEADER || !(oName <= oArgs && oArgs <= oThird && oThird <= oPath && oPath < oData && oData <= len)) throw bad(R, 'its string offsets are out of order');
      if (offs.some((o) => o % 2)) throw bad(R, 'a string offset is odd');
      if (size !== len - oData) throw bad(R, 'its size field (' + size + ') is not the ' + (len - oData) + ' bytes its length leaves');
      if (folderFlag !== 0 && folderFlag !== 0xFFFFFFFF) throw bad(R, 'an unknown folder flag');
      const dir = folderFlag === 0xFFFFFFFF;
      if (dir && size) throw bad(R, 'a folder with data');
      const strs = readAt(fd, R, oData);
      const str = (a, b) => {
        if (b - a < 2 || strs.readUInt16LE(b - 2) !== 0) throw bad(R, 'a name is not NUL-terminated');
        return strs.toString('utf16le', a, b - 2);
      };
      const shortName = str(oName, oArgs);
      const packed = str(oPath, oData);
      if (packed.split('\\').pop() !== shortName) throw bad(R, 'its name is not the last part of its path');
      const r = relPath(packed);
      if (r.outside || r.root) out.ignored++;
      else if (r.refused) out.refused.push({ packed, why: r.refused });
      else {
        out.files.push({ path: r.rel, offset: R + oData, size, dir });
        out.bytes += size;
      }
      R += len;
    }
    if (!sawEnd && R !== sec.end) throw bad(R, 'the chain ends inside a record');
    return out;
  });
}

// Writes the packed files (folders too) under destDir, streaming each one out
// of the .exe in slices. `filter(entry)` picks which; all when omitted.
// Returns { exe, files, bytes, refused, written: [paths] }.
function extract(exePath, destDir, filter) {
  const listing = list(exePath);
  const root = path.resolve(destDir);
  fs.mkdirSync(root, { recursive: true });
  const inside = (p) => { const r = path.relative(root, p); return !!r && !r.startsWith('..') && !path.isAbsolute(r); };
  const written = [];
  let files = 0, bytes = 0;
  const CHUNK = 4 << 20;
  withFd(exePath, (fd) => {
    const buf = Buffer.alloc(CHUNK);
    for (const e of listing.files) {
      if (filter && !filter(e)) continue;
      const to = path.resolve(root, ...e.path.split('/'));
      if (!inside(to)) { listing.refused.push({ packed: e.path, why: 'it would land outside the folder it is written to' }); continue; }
      if (e.dir) { fs.mkdirSync(to, { recursive: true }); continue; }
      fs.mkdirSync(path.dirname(to), { recursive: true });
      const out = fs.openSync(to, 'w');
      try {
        let left = e.size, at = e.offset;
        while (left > 0) {
          const n = fs.readSync(fd, buf, 0, Math.min(CHUNK, left), at);
          if (n <= 0) throw new Error(listing.exe + ' ended inside ' + e.path);
          fs.writeSync(out, buf, 0, n);
          left -= n; at += n;
        }
      } finally { fs.closeSync(out); }
      files++; bytes += e.size;
      written.push(e.path);
    }
  });
  return { exe: listing.exe, files, bytes, refused: listing.refused, written };
}

module.exports = { isPacked, list, extract, relPath, SECTION };
