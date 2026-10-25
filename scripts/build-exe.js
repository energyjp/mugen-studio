'use strict';
//
// Builds app/studio-server.exe - a Node single-executable shell around the Studio.
//
//   node scripts/build-exe.js
//
// Produces app/studio-server.exe, which runs the Studio on a machine with no
// Node installed. It loads server.js and the rest from the folder it sits in,
// so it is an exe PLUS the program files, not one downloadable file. See the
// long comment at the top of sea-entry.cjs for why.
//
// Every step below was verified end to end on Node 23.11.0 / win32 x64 before
// it was written down; the numbers in the comments are measured, not estimated.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
// The SERVER half. MugenStudio.exe is the native window (studio-go/cmd/mugenstudio)
// and this is the process it spawns hidden behind it. Run this one on its own
// and it serves the Studio to a browser instead - which is what it was before
// the window existed, and still a useful way to see what it is saying when the
// window will not come up.
const OUT = path.join(ROOT, 'app', 'studio-server.exe');
// A scratch dir, so the blob and the config never land in the repo.
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'mugen-sea-'));

// postject is fetched on demand rather than added to the project. There is no
// package.json here and this is a build-time tool used once, so npx keeps the
// dependency count at zero. Pinned: alpha versions move.
const POSTJECT = 'postject@1.0.0-alpha.6';
// Node's own fuse string. NOT optional and NOT postject's default - omit
// --sentinel-fuse and postject looks for a sentinel that is not in node.exe,
// fails with "Could not find the sentinel", and leaves behind an .exe that is
// simply an unmodified node.exe: it runs, prints nothing, and exits 0. A build
// that looks like it worked and produces a silent binary.
const FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';

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

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { stdio: 'inherit', ...opts });
}

const t0 = Date.now();
console.log('Building ' + path.basename(OUT) + ' ...');

// 1. The SEA config. `main` must be COMMONJS. An ESM entry builds a blob with
//    no error at all and then dies at runtime with "Cannot use import statement
//    outside a module" - a silent build and a loud ship - which is why the
//    entry point is .cjs and says so in its extension.
//    `main` is RELATIVE, and the blob is made from a copy of the entry in
//    WORK: the path given here is stored in the binary, and an absolute one
//    put this machine's user folder into every copy of the app.
const cfg = path.join(WORK, 'sea-config.json');
fs.copyFileSync(path.join(__dirname, 'sea-entry.cjs'), path.join(WORK, 'sea-entry.cjs'));
fs.writeFileSync(cfg, JSON.stringify({
  main: 'sea-entry.cjs',
  output: path.join(WORK, 'sea-prep.blob'),
  disableExperimentalSEAWarning: true,
}, null, 2));

// 2. The blob. ~62ms.
run(process.execPath, ['--experimental-sea-config', 'sea-config.json'], { cwd: WORK });

// 3. A copy of this Node binary is the host. ~83MB, which is the floor for a
//    SEA - the runtime is the payload.
moveAside(OUT);
fs.copyFileSync(process.execPath, OUT);

// 4. Inject. ~7s, and the slowest step by an order of magnitude.
//
//    postject is NOT IDEMPOTENT - injecting into an already-injected exe is not
//    a no-op - which is why step 3 always starts from a fresh copy of node.exe
//    rather than re-using whatever MugenStudio.exe happens to be there.
//
//    It also strips node.exe's Authenticode signature (Valid, OpenJS
//    Foundation -> NotSigned). Expect SmartScreen on a machine that has not
//    seen this binary before; a real release would re-sign here.
//    shell:true because npx is a .cmd on Windows and execFile cannot spawn a
//    batch file directly; the arguments are all paths we constructed, not user
//    input, so there is nothing here for a shell to reinterpret.
//    Quoted by hand, NOT with JSON.stringify: that escapes backslashes, so the
//    path arrived as C:\Users\... and only worked because Windows happens to
//    collapse doubled separators. Plain quotes are what a Windows shell wants.
const q = (p) => '"' + p + '"';
run('npx', ['--yes', POSTJECT, q(OUT), 'NODE_SEA_BLOB',
  q(path.join(WORK, 'sea-prep.blob')), '--sentinel-fuse', FUSE],
  { cwd: WORK, shell: true });

fs.rmSync(WORK, { recursive: true, force: true });

const mb = (fs.statSync(OUT).size / 1e6).toFixed(1);
console.log('\n' + path.basename(OUT) + '  ' + mb + ' MB  in ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
console.log('  ' + OUT);
console.log('\nRun it from this folder. First launch takes about a second (Windows');
console.log('reads the whole binary once); after that it starts in ~40ms.');
