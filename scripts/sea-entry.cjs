'use strict';
//
// THE .EXE'S ENTRY POINT. Everything here exists because of how a Node
// single-executable differs from `node server.js`, and nothing else.
//
// The one rule that shapes this file: inside a SEA, require() resolves BUILT-IN
// MODULES ONLY. require('./server.js') does not fail with MODULE_NOT_FOUND, it
// fails with ERR_UNKNOWN_BUILTIN_MODULE - a different code, which is why an
// existing try/catch around an optional require would not catch it either. The
// app is therefore loaded through createRequire, which restores ordinary
// on-disk resolution (measured: relative files and node_modules packages both).
//
// Which means the prototype is an .exe PLUS the program files beside it, not
// one file you download. That is deliberate for a prototype: bundling the whole
// graph into the binary needs changes to export.js, vfslib.js and serveFile,
// and Mod Studio is about to ship. This shell adds the thing that was actually
// asked for - it runs on a machine with no Node - and changes nothing else.
//
// Also relied on, both measured rather than assumed:
//   - __dirname inside a SEA is the DIRECTORY OF THE EXE, so server.js's
//     `const ROOT = __dirname` keeps meaning "the program folder" with no edit.
//   - argv[0] and argv[1] are BOTH the exe, so argv.slice(2) is still the user's
//     arguments and `MugenStudio.exe 8940` overrides the port exactly as
//     `node server.js 8940` does.

const path = require('node:path');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const { spawn } = require('node:child_process');

const APP = path.dirname(process.execPath);
const req = createRequire(path.join(APP, 'sea-entry.cjs'));

// A DOUBLE-CLICKED CONSOLE APP THAT EXITS TAKES ITS WINDOW WITH IT, so every
// message this file prints on the way out is invisible in exactly the case it
// was written for. That is not a hypothetical: the first person to run this got
// "the .exe doesn't open", because another server already held the port, and
// the explanation flashed past in a window that closed itself.
//
// So a fatal exit waits for a keypress. isTTY is the discriminator: a real
// console has one, and a redirected/piped run (a script, a CI job) does not and
// so is never left hanging.
function pauseIfConsole() {
  if (!process.stdin.isTTY) return;
  try {
    process.stdout.write('\nPress any key to close . . . ');
    fs.readSync(0, Buffer.alloc(1), 0, 1, null);
    process.stdout.write('\n');
  } catch (e) { /* no console to wait on */ }
}
function die(...lines) {
  for (const l of lines) console.error(l);
  pauseIfConsole();
  process.exit(1);
}

// A missing file inside this program is not a stack trace, it is "the app
// closed itself". The server reads several trees with no guard - vfslib's
// generated-file step throws straight out of an HTTP handler - so say what is
// missing here, while there is still a console to say it on.
const NEEDS = [
  ['server.js', 'the program itself'],
  ['public', 'the Mod Studio pages'],
  ['vfslib.js', 'the build system'],
];
// The folders live wherever layout.js says: beside the program in a checkout,
// spread across app/Dependencies, Content/<bundle> and the Export folders in a
// portable copy (app/program-layout.json). ASK IT rather than re-derive it here
// - an earlier copy of this check only knew the flat layout and greeted every
// portable build with "some things are not here yet" about folders that were
// present one level up, while the wasm it named served fine. If layout.js is
// missing, server.js will be too, and NEEDS above reports that properly.
let L = null;
try { L = req('./layout.js'); } catch (e) { L = null; }
const where = (name) => (L ? L.dir(name) : path.join(APP, name));
const WANTS = [
  [where('cache'), 'imported characters'],
  [where('stages'), 'stages'],
  [where('music'), 'music'],
  [where('themes'), 'screenpacks you have added'],
  [where('release-v2'), 'the web engine bundle - the Website export needs this'],
  [L ? L.IKEMEN_SRC : [path.join('..', 'ikemen-go-src'), 'ikemen-go-src'],
    'the engine source and ikemen-v2.wasm'],
];

const missing = NEEDS.filter(([f]) => !fs.existsSync(path.join(APP, f)));
if (missing.length) {
  die('\nThis does not look like a Mod Studio folder.\n',
    '  ' + APP + '\n',
    ...missing.map(([f, why]) => '  MISSING  ' + f + '   (' + why + ')'),
    '\nThe .exe has to sit in the program folder, beside server.js and public/.');
}

// An entry may list several acceptable locations; present in ANY is present.
// resolve, not join: layout.dir() hands back ABSOLUTE paths, and
// path.join(APP, 'C:\...') on Windows yields app\C:\... - a path that cannot
// exist - so the rebuilt check reported Content\default\characters as "not
// here yet" while the server was serving it. resolve() returns an absolute
// second argument unchanged and still anchors a relative one to APP.
const absent = WANTS.filter(([f]) =>
  ![].concat(f).some((c) => fs.existsSync(path.resolve(APP, c))));
if (absent.length) {
  console.log('\nStarting, but some things are not here yet:');
  for (const [f, why] of absent) console.log('  - ' + [].concat(f)[0] + '   (' + why + ')');
  console.log('');
}

const portArg = process.argv.slice(2).find((a) => /^\d+$/.test(a));
const PORT = portArg ? parseInt(portArg, 10) : 8934;
const URL = 'http://localhost:' + PORT + '/studio.html';
const EXE = path.basename(process.execPath);

function openBrowser() {
  if (process.argv.includes('--no-open')) return;
  try {
    // The empty '' is start's title argument. Without it, start treats a quoted
    // URL as the window title and opens nothing.
    spawn('cmd', ['/c', 'start', '', URL], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  } catch (e) {
    console.log('Open this yourself: ' + URL);
  }
}

// FATAL ONLY UNTIL THE SERVER IS LISTENING. Before that, an uncaught error is
// a Studio that cannot start - a busy port, a missing module - and saying so
// and leaving is right. After it, an uncaught error belongs to ONE request: a
// file an antivirus scan held open, one bad character. Exiting then turned
// that into a Studio where every click said "Failed to fetch", so it is
// written down (the window keeps this output in a log) and the server goes
// on answering everything else.
let serving = false;
process.on('uncaughtException', (e) => {
  if (!serving) {
    if (e && e.code === 'EADDRINUSE') {
      die('\nPort ' + PORT + ' is already in use, and it is not this Studio.',
        'Something else is on it - the dev server, or another program.',
        '\nStart on a different port:   ' + EXE + ' 8940');
    }
    die('\nStopped: ' + ((e && e.stack) || e));
  }
  console.error('\n[' + new Date().toISOString() + '] Kept running after an error: ' + ((e && e.stack) || e) + '\n');
});

// IS THE PORT BUSY BECAUSE THE STUDIO IS ALREADY OPEN? Double-clicking a
// running app should show you the app, not an error about a port - a person who
// cannot find the window will always click the icon again. So ask whoever holds
// the port whether they are us, and if so just open it and leave them running.
//
// Two Studios on one folder is the thing actually worth preventing: both write
// roster.json, and the loser's edits vanish without a word. This catches a
// second server started on a running one's port; a second WINDOW gets a free
// port of its own, so the window refuses that itself (main.go, one window per
// app folder).
//
// /api/readonly, not /api/studio: it answers at once, where /api/studio
// answers only after a full scan of the bundle - seconds, minutes during an
// import - and a running Studio that slow was told "not this Studio".
const probe = require('node:http').get(
  { host: '127.0.0.1', port: PORT, path: '/api/readonly', timeout: 4000 },
  (res) => {
    res.resume();
    if (res.statusCode === 200) {
      console.log('\nMod Studio is already running on port ' + PORT + '. Opening it.\n');
      openBrowser();
      process.exit(0);
    }
    start();
  });
probe.on('timeout', () => probe.destroy());
// Nothing listening (ECONNREFUSED) is the normal path, not an error.
probe.on('error', () => start());

function start() {
  // server.js calls listen() while it loads; 'listening' comes later, on its
  // own turn of the event loop, so the listener added here cannot miss it. A
  // server.js without the export leaves every error fatal, as it always was.
  const app = req('./server.js');
  const srv = app && app.server;
  if (srv && srv.listening) serving = true;
  else if (srv) srv.once('listening', () => { serving = true; });
  // Opening the browser is the difference between a program and a terminal that
  // happens to be listening. Detached, so closing the browser does not kill the
  // server and vice versa.
  setTimeout(openBrowser, 400);
}
