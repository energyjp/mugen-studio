'use strict';
//
// WHAT "PRIVATE" MEANS, IN ONE PLACE.
//
// Three build paths produce things that leave this machine - desktop.js,
// scripts/make-portable.js and make-kit.js - and each had invented its own
// answer to "is this mine or theirs". export.js had PRIVATE_WORDS, vfslib had
// `opts.publicOnly`, make-kit had a hand-written file list, and desktop.js had
// nothing at all. So the ranked NETWORK menu shipped in every desktop export:
// vfslib.js gates the injection on `!!roster.onlineName && !opts.publicOnly`,
// desktop.js:93 called `vfslib.build()` with no opts, and `undefined` is falsy,
// so the gate passed. dist-desktop/data/ikemen1/system.def carried CASUAL MATCH
// / RANKED MATCH / YOUR RANK / PLAYER NAME as DEAD items - a stock engine has
// no handlers for them.
//
// THE GATE WAS OPT-OUT. That is the actual defect, not the one call site: any
// build path that forgets a flag leaks by default. This module is opt-IN
// instead, and ships an assertion so that forgetting is caught by the build
// rather than by whoever receives it.
//
//   isPrivateFile(rel)     - never copy this into a redistributable
//   sanitizeRoster(obj)    - strip the private switches from roster.json
//   neuter*(text)          - defuse a file that must ship but must not act
//                            (neuterGifButton: the GIF button under --no-gif)
//   assertClean(dir)       - scan a FINISHED build; throw if anything leaked
//
// Everything here is about artifacts that LEAVE. The author's own working tree
// and his own private web build are untouched and are supposed to have all of it.

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Files that belong to the private surfaces and never travel.
// Paths are repo-relative, forward-slashed.
//
// NOT public/ikemen/identity.js, since 2026-09-28. It is the ranked CLIENT's
// name/rating module and holds no endpoint: it reads IKEMEN_BRAND.identityUrl
// and does nothing while that is blank. The owner's rule protects the
// DEPLOYMENT (his address, credentials, players' data, backend, bot), not the
// client, so a shareable copy carries it and a host who sets their own
// leaderboard address gets names and ratings in their own Website export. What
// stays guarded is a POPULATED address in any shipped file (the identity token
// below) and his own values (export.js assertNoPrivateValues). His public
// (itch) export still removes the file and its tag itself (export.js), and the
// legacy kit removes both by name (make-kit.js).
//
// NOR tools/extract-charart.js, since later the same day (2026-09-28, the
// owner: "The extractor should be included AND enabled when a leaderboard is
// set up"). It makes the Score Ranking board's portraits and win poses from a
// bundle's own characters, into that bundle's own folder (layout.LEADERBOARD_ART),
// and runs only for a bundle with a leaderboard address (modlib.canBoardArt) -
// so in a shareable copy it acts only for a host who set up their own
// leaderboard, on their own characters. It holds no endpoint and no data. The
// author's art folder is beside his program folder, outside every copy, and a
// copy's own art is made by its own exports. The legacy kit still bans it by
// name (make-kit.js) and was not re-cut.
const PRIVATE_FILES = [
  'public/ikemen/nettest.html',  // dev harness, labeled "not exported" in its
                                 // own header, that dials the private signaling
                                 // worker.
  'signaling',                   // the reference relay. Never ships, by standing
                                 // rule - a room-code lobby is private-only by
                                 // design and public play is manual copy-paste.
  'local-config.json',           // THIS DEPLOYMENT'S OWN ENDPOINTS. The single
                                 // copy of the TURN credentials and the lobby
                                 // URL, held outside every source file (see
                                 // local-config.js). "Never committed" (it is
                                 // in .gitignore) says nothing about a BUILD -
                                 // this entry and the presence check in
                                 // assertClean ARE the guarantee there.
];

// THE ANIMATION PANEL'S GIF BUTTON is a SEPARATE surface from the leaderboard
// art, and whether a copy should have it is a judgment call the caller makes -
// make-portable --no-gif holds it back. Default keeps it.
//
// It used to be held back by leaving out tools/gif.js. It cannot be any more:
// the leaderboard art ships (above) and every picture it makes is drawn with
// that encoder, so the FILE ships and the BUTTON is gated instead. The one
// switch every GIF surface asks is modlib.canExportGif() - the Characters
// panel, the pair bench and GET /api/char-anim-gif - while the art asks the
// encoder directly (charAnimRuns). neuterGifButton turns that switch off in a
// copy, and assertClean(dir, label, { gif: false }) refuses a finished copy
// whose modlib.js still has it on.
const GIF_BUTTON_ON = /function canExportGif\(\) \{ return !!gifLib\(\); \}/;
const GIF_BUTTON_OFF = 'function canExportGif() { return false; } // this copy holds back the GIF button (make-portable --no-gif); tools/gif.js stays for the leaderboard art';

// roster.json keys that switch private behavior on. onlineName is the exact
// flag vfslib.js reads to inject the ranked menu; identityUrl points at a
// leaderboard backend. In the AUTHOR'S roster they are his deployment, so
// nothing built from his roster for someone else may carry them. A host's own
// roster in a shareable copy is theirs to export.
const PRIVATE_ROSTER_KEYS = ['onlineName', 'identityUrl'];

// THE RANKED MENU'S OWN INJECTOR. vfslib.js builds CASUAL MATCH / RANKED MATCH
// / YOUR RANK / PLAYER NAME into a build's system.def when its roster asks
// (onlineName) and its export is not public, so its source NAMES the labels.
// Since 2026-09-28 shareable copies ship it live (the ranked client ships
// blank, the owner's rule), so the two menu tokens below skip this one file and
// nothing else: the same labels in a FINISHED build - a system.def, a loose
// export's data, the desktop build, the kit - still trip them, and every other
// token still runs on vfslib.js. A finished build never contains vfslib.js.
const INJECTOR = /(^|[\\/])vfslib\.js$/i;

// ---------------------------------------------------------------------------
// High-signal tokens. These are deliberately NOT the loose vocabulary
// export.js uses to blank comments (`ranked|casual|elo|tier|worker`): this list
// runs against a finished build, so every entry must be something that cannot
// appear innocently. A word like "ranked" occurs in ordinary prose; a line like
// `menu.itemname.menunetwork.rankedmatch` cannot.
//
// Secrets are matched by SHAPE, not by value, so this file never becomes a
// second copy of the credential it is defending.
const TOKENS = [
  { name: 'ranked menu item',
    re: /menu\.itemname\.menunetwork\.(rankedmatch|casualmatch|yourrank)\s*=/i,
    skip: INJECTOR,
    why: 'the ranked/casual NETWORK menu in a finished build (injected by vfslib)' },
  // BY SHAPE, NOT BY VALUE - which is what the note above this list already
  // promised, and what this one entry did not do. It named the author's identity
  // host literally, so every artifact carrying this file carried the hostname
  // too: the portable tester copy ships private-surfaces.js because desktop.js
  // requires it at runtime, and the scan cannot catch that because the scan
  // skips itself (SELF, below). The guard was the leak.
  //
  // The structural form is also STRICTER. A populated `identityUrl` is the
  // actual leak vector whatever the host is, so this now catches a third party's
  // backend as well as the author's - which is the point when the same guard has
  // to serve a blueprint someone else deploys. Verified against the artifacts
  // the literal used to catch: same five files.
  { name: 'identity backend URL',
    re: /identityUrl\s*["']?\s*[:=]\s*["']https?:\/\/|\b[a-z0-9-]+\.fly\.dev\b/i,
    // CODE ONLY, for the same reason the TURN token is. A setup guide has to be
    // able to SHOW the shape - docs/RANKED-SETUP.md prints
    // `"identityUrl": "https://your-backend"` as the thing a self-hoster fills
    // in, and DEPLOYMENT.md does the same - and a guard that fails the build over
    // its own instructions is a guard people switch off. A REAL endpoint reaching
    // a doc is still caught, by the value pass in export.js assertNoPrivateValues,
    // which runs on any file type. Shape in prose is instruction; a value is
    // disclosure.
    only: /\.(js|mjs|cjs|html?|lua|json)$/i,
    why: 'a populated identity / leaderboard backend endpoint' },
  // BY SHAPE, like the identity token above it. The old form needed BOTH the
  // author's naming convention (the substring "signaling") AND his provider's
  // domain (workers.dev), so a self-hoster's `wss://lobby.example.com/ws` sat in
  // a shipped artifact and passed clean - useless in the one guard a blueprint
  // hands to somebody else. A POPULATED SIGNAL_URL is the leak whatever the
  // host; the second alternate keeps the provider shape as a backstop for a URL
  // that reaches an artifact by some route other than that constant.
  { name: 'signaling worker URL',
    re: /const\s+SIGNAL_URL\s*=\s*['"]wss?:\/\/|wss?:\/\/[a-z0-9.-]+\.workers\.dev/i,
    why: 'a populated lobby / signaling endpoint' },
  // The quoted value must LOOK like a credential. Matching any non-empty
  // string here flagged export.js's own blanking code, whose regex literal
  // `const METERED_APP = '[^']*';` is a pattern, not a secret - a guard that
  // cries wolf on the code that does the blanking teaches you to ignore it.
  { name: 'live TURN credentials',
    re: /METERED_(APP|KEY)\s*=\s*['"][A-Za-z0-9_.-]{4,}['"]/,
    // CODE ONLY. The self-hosting guide has to be able to SHOW the shape -
    // DEPLOYMENT.md:125 reads `const METERED_APP = 'your-app-name';` and tripped
    // this as a live credential, which would block the public export the moment
    // assertClean is wired into it. A real value that reached a doc is still
    // caught by the value pass in export.js assertNoPrivateValues; a shape in
    // prose is instruction, not disclosure.
    only: /\.(js|mjs|cjs|html?|lua|json)$/i,
    why: 'live metered.live TURN credentials (the author\'s quota)' },
  // RETIRED 2026-09-28: 'identity module reference', a <script> tag for
  // identity.js in any shipped page. It guarded a PRIVATE module, and the
  // module is not private any more (see PRIVATE_FILES): the tag is how a
  // host's own Website export loads it, so a shareable copy's play page has to
  // keep it. A tag left behind where the file was removed (his public export,
  // the kit) is a dangling script, which tools/export-selfcheck.js refuses for
  // every page and every script.
  { name: 'live ranked menu injector',
    re: /menunetwork\.rankedmatch\s*=\s*RANKED MATCH/i,
    skip: INJECTOR,
    why: 'the ranked menu injector outside vfslib.js, able to re-create the menu downstream' },
];

// Only text is scanned. A .dll containing the bytes "identity" is not a leak,
// and reading 900 MB of sprite data to find out is not free either.
// THE EXTENSION FILTER DECIDES WHICH FILES THE TOKENS EVER RUN ON, so a
// pattern is worth nothing on a type that is not listed. `.go` was missing, and
// studio-go/netplay/private.go:78-79 carries
// `menu.itemname.menunetwork.rankedmatch = RANKED MATCH` verbatim - it matches
// two of the tokens below when tested in memory and the walker has never once
// opened it. A build tag keeps it out of the compiled binary; it does not make
// the source clean, and a blueprint that ships the Go builder would ship a
// ranked injector this guard cannot see.
//
// The config types are here for the same reason, forward-looking: a self-hosted
// deployment carries wrangler.toml, .env and CI yaml, and those are exactly
// where someone puts an endpoint or a token. Checked before widening - no
// shipped artifact today contains a .go/.ps1/.toml/.env that trips anything.
const TEXT_EXT = /\.(js|mjs|cjs|json|html|htm|css|lua|def|cns|air|txt|md|ini|cmd|sh|st|go|ps1|psm1|bat|toml|yml|yaml|env|py)$/i;

// A build's own guard code has to be allowed to NAME what it defends against,
// or the guard trips on itself. Only this file and the checker.
const SELF = /(^|[\\/])(private-surfaces|export-selfcheck)\.js$/i;

function isPrivateFile(rel) {
  const r = String(rel).split(path.sep).join('/').replace(/^\.\//, '');
  return PRIVATE_FILES.some((p) => r === p || r.endsWith('/' + p) || r.startsWith(p + '/')
    || r.includes('/' + p + '/'));
}

function sanitizeRoster(roster) {
  const out = JSON.parse(JSON.stringify(roster));
  const dropped = [];
  for (const k of PRIVATE_ROSTER_KEYS) {
    if (Object.prototype.hasOwnProperty.call(out, k)) { delete out[k]; dropped.push(k); }
  }
  return { roster: out, dropped };
}

// THE LEGACY KIT'S STEP ONLY (make-kit.js). Shareable portable copies stopped
// calling this on 2026-09-28: the ranked client ships blank there, and a host
// who ticks Online menu and sets their own leaderboard address gets the menu
// in their own export. The kit was cut before that decision and is not re-cut.
//
// vfslib still has to ship - the app cannot run without it - so the injector is
// disabled at its source rather than removed. One assignment, and the whole
// RANKED / CASUAL / YOUR RANK / PLAYER NAME block below it becomes unreachable,
// including for any export the recipient makes themselves.
// Two steps, and the second is not optional. Setting the gate false makes the
// block unreachable, but the LABELS stay in the file - so a redistributable
// still carried `menu.itemname.menunetwork.rankedmatch = RANKED MATCH` in plain
// text, disclosing the private feature and needing one edited line to switch
// back on. The literals are blanked too, which is why assertClean scans the
// finished artifact rather than trusting this function.
function neuterVfslib(text) {
  const gate = /const wantOnlineName = [^;\r\n]+;/;
  if (!gate.test(text)) return { text, changed: false };
  let out = text.replace(gate,
    'const wantOnlineName = false; // redistributable build: private ranked'
    + ' menu disabled at source (see private-surfaces.js)');
  let blanked = 0;
  out = out.replace(/'menu\.itemname\.menunetwork\.(?:casualmatch|rankedmatch|yourrank|playername)[^']*'/g,
    () => { blanked++; return "''"; });
  return { text: out, changed: true, blanked };
}

// The GIF button off, at the one switch every GIF surface asks (above). Takes
// modlib.js's text; changed: false means the switch was not found, which a
// build must treat as a failure - modlib changed under it, and the button
// would ship.
function neuterGifButton(text) {
  if (!GIF_BUTTON_ON.test(text)) return { text, changed: false };
  return { text: text.replace(GIF_BUTTON_ON, () => GIF_BUTTON_OFF), changed: true };
}

// Blank the credentials and the relay URL by shape, keeping the declarations so
// the file still parses and a recipient can fill in their own.
function neuterWebrtc(text) {
  let n = 0;
  let out = text.replace(/(const METERED_(?:APP|KEY)\s*=\s*)['"][^'"]*['"]/g,
    (m, head) => { n++; return head + "''"; });
  out = out.replace(/(const SIGNAL_URL\s*=\s*)['"][^'"]*['"]/,
    (m, head) => { n++; return head + "''"; });
  return { text: out, changed: n > 0, blanked: n };
}

// A screenpack that a previous export wrote keeps its injected items for ever -
// desktop.js never clears data/, so changing the motif strands the old folder.
// Removing the lines is safe on any system.def: the labels are additions, and a
// stock engine has no handler for them either way.
function stripRankedMenu(def) {
  const re = /^[ \t]*menu\.itemname\.menunetwork\.(rankedmatch|casualmatch|yourrank)\s*=[^\r\n]*\r?\n?/gim;
  const hits = (def.match(re) || []).length;
  return { text: hits ? def.replace(re, '') : def, changed: hits > 0, removed: hits };
}

// ---------------------------------------------------------------------------
// The assertion. Walks a FINISHED build and reports every private token in it.
// This is the part that makes forgetting a flag impossible to ship.
function scan(dir, opts) {
  const found = [];
  const skipDirs = new Set(['node_modules', '.git']);
  (function walk(d) {
    let ents;
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (!skipDirs.has(e.name)) walk(p); continue; }
      if (!TEXT_EXT.test(e.name) || SELF.test(p)) continue;
      let txt;
      try {
        if (fs.statSync(p).size > 8 * 1024 * 1024) continue;
        txt = fs.readFileSync(p, 'utf8');
      } catch (err) { continue; }
      for (const t of TOKENS) {
        if (t.only && !t.only.test(e.name)) continue;
        if (t.skip && t.skip.test(p)) continue;
        const m = txt.match(t.re);
        if (!m) continue;
        const line = txt.slice(0, m.index).split('\n').length;
        found.push({ file: path.relative(dir, p).split(path.sep).join('/'),
                     line, token: t.name, why: t.why });
      }
    }
  })(dir);
  return found;
}

// Throws with every hit listed. A build that calls this cannot ship a leak
// quietly, which is the whole point - the previous failure was silent success.
// Which PRIVATE_FILES ended up inside a finished build.
//
// scan() looks for forbidden TEXT, and that is not the same question. Verified:
// public/ikemen/nettest.html (and, when they were private, the art extractor
// and tools/gif.js) matches no token, so a private file copied into a build
// passed the scan in silence and enforcement rested entirely on three separate
// copy-time filters remembering to exclude it. This asks the finished artifact
// directly.
function privateFilesIn(dir) {
  const found = [];
  (function walk(d) {
    let ents;
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
    for (const e of ents) {
      const p = path.join(d, e.name);
      const rel = path.relative(dir, p).split(path.sep).join('/');
      if (isPrivateFile(rel)) { found.push(rel); continue; }
      if (e.isDirectory() && e.name !== 'node_modules' && e.name !== '.git') walk(p);
    }
  })(dir);
  return found;
}

// A copy built with { gif: false } whose modlib.js still offers the GIF
// button. Every modlib.js in the tree is read (a copy has one, in app/).
function gifButtonsLiveIn(dir) {
  const found = [];
  (function walk(d) {
    let ents;
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== '.git') walk(p); continue; }
      if (e.name !== 'modlib.js') continue;
      let txt = '';
      try { txt = fs.readFileSync(p, 'utf8'); } catch (err) { continue; }
      if (GIF_BUTTON_ON.test(txt)) found.push(path.relative(dir, p).split(path.sep).join('/'));
    }
  })(dir);
  return found;
}

// A PERSON'S Settings FOLDER at the top of a finished build. A portable copy
// keeps everything its user owns there (layout.js: local-config.json with the
// Cloudflare token and admin keys, the bundle and download-folder choices, the
// logs), beside app/, so an update never replaces it - which also means a copy
// that has been USED has one, and handing that folder on hands on the keys.
// No build writes it (make-portable ships none; the first start makes it), so
// one at the top of a build is always somebody's. Only the top, and only one
// holding the Studio's own files: the name is too ordinary to ban anywhere
// else, or on its own, in a tree of other people's content (a desktop export
// can go into an existing Ikemen GO install).
const SETTINGS_FILES = ['local-config.json', 'studio-settings.json', 'logs'];
function settingsFolderIn(dir) {
  const s = path.join(dir, 'Settings');
  try { if (!fs.statSync(s).isDirectory()) return false; } catch (e) { return false; }
  return SETTINGS_FILES.some((f) => fs.existsSync(path.join(s, f)));
}

// THE WINDOW'S LOG OF THE SERVER (studio-go serverlog.go): Settings/logs/ in a
// portable copy, which the check above covers, but logs/ beside
// MugenStudio.exe in the checkout and in a copy from before the Settings
// folder. It holds this computer's paths and errors. make-portable copies by
// an allowlist and never reaches the checkout's, so this is the second guard:
// only that exact file, at the top or in app/, so an ordinary "logs" folder
// in someone's content never trips it.
function serverLogIn(dir) {
  return [path.join(dir, 'logs', 'studio-server.log'), path.join(dir, 'app', 'logs', 'studio-server.log')]
    .filter((p) => fs.existsSync(p));
}

function assertClean(dir, label, opts) {
  const logs = serverLogIn(dir);
  if (logs.length) {
    throw new Error('THE STUDIO\'S SERVER LOG IN ' + (label || dir) + ' - ' + logs.join(', ')
      + '\nholds this computer\'s paths and errors. It must never be redistributed: build into a new folder.');
  }
  if (settingsFolderIn(dir)) {
    throw new Error('A USER\'S SETTINGS FOLDER IN ' + (label || dir) + ' - ' + path.join(dir, 'Settings')
      + '\nholds that copy\'s own keys and choices (local-config.json and the rest). It must never be'
      + ' redistributed: build into a new folder, or move the Settings folder out first.');
  }
  if (opts && opts.gif === false) {
    const live = gifButtonsLiveIn(dir);
    if (live.length) {
      throw new Error('GIF BUTTON LIVE IN ' + (label || dir) + ' - built to hold it back (--no-gif), but '
        + live.join(', ') + ' still turns it on.\n\nprivate-surfaces.js neuterGifButton did not take effect. Fix the build step.');
    }
  }
  const files = privateFilesIn(dir);
  if (files.length) {
    throw new Error('PRIVATE FILE IN ' + (label || dir) + ' - ' + files.length
      + ' file(s) that must never be redistributed:\n'
      + files.map((f) => '  ' + f).join('\n')
      + '\n\nListed in private-surfaces.js PRIVATE_FILES. Fix the copy step.');
  }
  const hits = scan(dir, opts);
  if (!hits.length) return 0;
  const lines = hits.map((h) => '  ' + h.file + ':' + h.line + '  [' + h.token + ']  ' + h.why);
  // The files ARE on disk - this runs after the build, so it can read what was
  // actually produced rather than what was intended. Saying "not written" would
  // be a lie that sends you looking for a folder that is right there.
  throw new Error('PRIVATE SURFACE IN ' + (label || dir) + ' - ' + hits.length
    + ' hit(s). The folder exists but MUST NOT BE DISTRIBUTED.\n' + lines.join('\n')
    + '\n\nDefined in private-surfaces.js. Fix the build path, do not widen the allowlist.');
}

module.exports = {
  PRIVATE_FILES, PRIVATE_ROSTER_KEYS, TOKENS, TEXT_EXT,
  isPrivateFile, sanitizeRoster,
  neuterVfslib, neuterWebrtc, neuterGifButton, stripRankedMenu,
  scan, privateFilesIn, gifButtonsLiveIn, settingsFolderIn, serverLogIn, assertClean,
};
