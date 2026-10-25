'use strict';
// THE SLOW READING OF A BUILD OPENED READ-ONLY, DONE BESIDE THE SERVER.
//
// An external bundle (layout.js, bundles.openExternal) can be somebody's
// whole install: the Ikemen Fighting Collection is 802 characters. Two of the
// readings the Studio's page asks for when it opens walk every one of them -
// /api/studio (every character's def, H scan, sprite-file diagnosis and the
// web build's whole file index: 130 s measured there) and /api/cell-portraits
// (every character's portrait sprites: 46 s). Both are synchronous, so asked
// in the server they would hold every other request - the sprites, the
// animations, the stage pictures - for that long, and the page would sit on
// "loading" for two minutes.
//
// So in a read-only bundle the server answers at once with what is cheap
// (modlib.studioInfoLight: the roster and each character's name), and the
// full reading runs HERE, in a worker thread, with exactly the code a normal
// bundle runs (modlib.studioInfo, modlib.cellPortraits) - nothing about the
// answer is new, only where it is worked out. The page asks again until it
// is there (`pending`), then draws it the way it draws any bundle.
//
// One worker at a time, one job at a time, in the order they were asked: on
// a build that lives on one disk, two full walks side by side only make both
// slower. Each answer is kept in memory for the life of the server - a build
// opened read-only is never changed by the Studio, and the server restarts
// whenever the bundle does. Nothing is ever written anywhere.
//
// THE WORKER GUARDS ITSELF. readonlyfs.js wraps the fs module object, and a
// worker thread has module objects of its own, so the worker installs the
// same guard on its own fs before it loads anything that reads the build. It
// is loaded through createRequire from an absolute path because the packaged
// server (studio-server.exe, a Node single executable) only resolves built-in
// modules from code it did not load itself.
const path = require('path');

const jobs = new Map();          // key -> { state: 'queued'|'running'|'done'|'failed', value, error, asked, ms }
const queue = [];                // keys waiting their turn
let running = null;              // { key, worker }

function runNext() {
  if (running || !queue.length) return;
  const key = queue.shift();
  const job = jobs.get(key);
  if (!job) return runNext();
  const { Worker } = require('worker_threads');
  const self = path.join(__dirname, 'readonlyscan.js');
  // createRequire, not a file path, for the reason at the top.
  const code = 'require("node:module").createRequire(' + JSON.stringify(self) + ')(' + JSON.stringify(self) + ').workerMain();';
  let worker;
  try {
    worker = new Worker(code, { eval: true, workerData: { job: job.job } });
  } catch (e) {
    Object.assign(job, { state: 'failed', error: 'could not start the reading: ' + (e && e.message || e) });
    return runNext();
  }
  job.state = 'running';
  job.started = Date.now();
  running = { key, worker };
  let settled = false;
  const finish = (fields) => {
    if (settled) return;
    settled = true;
    Object.assign(job, fields, { ms: Date.now() - job.started });
    running = null;
    // Done with it either way: a finished worker holds every module it loaded.
    worker.terminate().catch(() => {});
    setImmediate(runNext);
  };
  worker.on('message', (m) => {
    if (m && m.ok) finish({ state: 'done', value: m.value });
    else finish({ state: 'failed', error: String((m && m.error) || 'the reading failed') });
  });
  worker.on('error', (e) => finish({ state: 'failed', error: String(e && e.message || e) }));
  // A worker that stopped without answering. Its last message is delivered
  // before 'exit', but one turn more costs nothing.
  worker.on('exit', (code) => setImmediate(() => finish({ state: 'failed', error: 'the reading stopped (exit ' + code + ')' })));
}

// Ask for a reading. -> { state, value?, error?, ms? }. The first ask queues
// it; every later one only looks.
// `job` is { fn: 'studio' } or { fn: 'cell-portraits', args: [g, i, fg, fi] }.
function ask(key, job) {
  let j = jobs.get(key);
  if (!j) {
    j = { state: 'queued', job, asked: Date.now() };
    jobs.set(key, j);
    queue.push(key);
    runNext();
  }
  return j;
}

// ---- inside the worker -------------------------------------------------------

// TWO OF studioInfo's ANSWERS MEAN SOMETHING ELSE IN A READ-ONLY BUNDLE. Both
// come from the web build's file index, and there that index is one match at
// a time (vfslib.js, the match view), never the whole build: every character
// would read 0 MB, and every file a character names outside its own folder
// would read as missing. So a character's size is its folder on disk - what
// the build holds, since nothing here is packed - and the missing-files list
// is left out rather than answered wrongly. The header's build size stays
// empty: what a match loads is said when it is put together.
function onDisk(info, layout) {
  const fs = require('fs');
  const root = layout.dir('cache');
  const bytesIn = new Map();
  const walk = (dir) => {
    let n = 0, ents;
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return 0; }
    for (const e of ents) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) n += walk(p);
      else if (e.isFile()) { try { n += fs.statSync(p).size; } catch (err) { /* gone since the listing */ } }
    }
    return n;
  };
  for (const c of (info && info.roster && info.roster.chars) || []) {
    if (c.kind || !c.folder) continue;
    const key = String(c.folder).toLowerCase();
    if (!bytesIn.has(key)) bytesIn.set(key, walk(path.join(root, c.folder)));
    const b = bytesIn.get(key);
    c.sizeMB = b ? +(b / 1e6).toFixed(1) : null;
    delete c.sharesWith;
    delete c.missingDeps;
  }
  if (info) info.sizes = { chars: {}, stages: {}, music: {}, total: 0, files: 0 };
  return info;
}

function workerMain() {
  const { parentPort, workerData } = require('worker_threads');
  try {
    const layout = require('./layout.js');
    if (layout.readOnly && layout.externalRoot) {
      require('./readonlyfs.js').install({
        root: layout.externalRoot,
        onRefuse: (e) => console.error('  Read-only: refused ' + e.syscall + ' on ' + e.path + ' (in the background reading)'),
      });
    }
    const modlib = require('./modlib.js');
    const job = workerData.job || {};
    let value;
    if (job.fn === 'studio') value = onDisk(modlib.studioInfo(), layout);
    else if (job.fn === 'cell-portraits') value = modlib.cellPortraits(...(job.args || []));
    else throw new Error('no such reading: ' + job.fn);
    parentPort.postMessage({ ok: true, value });
  } catch (e) {
    parentPort.postMessage({ ok: false, error: String(e && e.message || e) });
  }
}

module.exports = { ask, workerMain, _jobs: jobs };
