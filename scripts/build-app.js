'use strict';
//
// Builds the whole desktop app:
//
//   node scripts/build-app.js
//
//   MugenStudio.exe        ~7MB   the native window   (studio-go/cmd/mugenstudio)
//   app/studio-server.exe  ~90MB  the Studio itself   (scripts/sea-entry.cjs)
//
// Double-click MugenStudio.exe. It picks a free port, starts the server hidden
// behind it, and shows the Studio in a real Windows window - no console, no
// browser, no address bar. Closing the window stops the server.
//
// The 87MB is the Node runtime; a single-executable carries its own
// interpreter. The window is 7MB because WebView2 is already part of Windows.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const GOTREE = path.join(ROOT, 'studio-go');
const GUI = path.join(ROOT, 'MugenStudio.exe');

// A RUNNING EXE CANNOT BE DELETED OR OVERWRITTEN ON WINDOWS, BUT IT CAN BE
// RENAMED: moved aside, an open session keeps running from the old file and
// the next launch gets the new one. Rebuilding with the app open used to stop
// dead at the delete.
function moveAside(file) {
  if (!fs.existsSync(file)) return;
  try { fs.rmSync(file); return; } catch (e) { /* in use */ }
  for (let i = 0; i < 20; i++) {
    const aside = file + '.old' + (i ? i : '');
    try { if (fs.existsSync(aside)) fs.rmSync(aside); } catch (e) { continue; }
    fs.renameSync(file, aside);
    console.log('  ' + path.basename(file) + ' is running - moved aside to ' + path.basename(aside)
      + ' (delete it once the app is closed)');
    return;
  }
  throw new Error(file + ' is in use and could not be moved aside');
}

function have(cmd, args) {
  try { execFileSync(cmd, args, { stdio: 'pipe' }); return true; } catch (e) { return false; }
}

// 1. The server. Slow step (~8s), so do it first and let its output show.
console.log('--- server ---');
execFileSync(process.execPath, [path.join(__dirname, 'build-exe.js')], { stdio: 'inherit' });

// 2. The window. Needs Go, but NOT a C compiler: go-webview2 talks to the
//    WebView2 COM API through syscall rather than cgo, which is the only reason
//    this is a 20-line build step instead of a toolchain.
console.log('\n--- window ---');
if (!have('go', ['version'])) {
  console.error('\nGo is not on PATH, so the native window cannot be built.');
  console.error('studio-server.exe still works on its own - run it and the Studio');
  console.error('opens in your browser. Install Go to get the window.');
  process.exit(1);
}

moveAside(GUI);
// The window is the one command in the studio-go module.
// -trimpath: without it the binary carries the absolute path of every source
// file and module it was built from - this machine's user folder, in every
// copy of the app (always build with -trimpath).
execFileSync('go', ['build', '-trimpath', '-ldflags=-H windowsgui -s -w', '-o', GUI, './cmd/mugenstudio'],
  { cwd: GOTREE, stdio: 'inherit' });

const mb = (f) => (fs.statSync(f).size / 1e6).toFixed(1) + ' MB';
console.log('\nMugenStudio.exe    ' + mb(GUI) + '   the window - double-click this one');
console.log('app/studio-server.exe  ' + mb(path.join(ROOT, 'app', 'studio-server.exe')) + '  the Studio behind it');
console.log('\nMugenStudio.exe stays beside the app folder; studio-server.exe stays in app/, beside server.js and public/.');
