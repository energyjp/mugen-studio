// Snapshots the Ikemen GO web build into a self-contained static dist/
// folder for plain web hosting (IONOS, itch.io, Netlify, a USB stick...).
//
//   node export.js            -> writes ./dist (one file per game asset)
//   node export.js --pack     -> writes ./dist-pack (all game assets packed
//                                into a single game.pak; ~7 files total.
//                                Use this for itch.io, which limits HTML5
//                                uploads to 1000 files.)
//   node export.js --v2       -> V2 engine (rollback netcode): serves
//                                ikemen-v2.wasm + V2 assets/config; combines
//                                with --pack. Writes ./dist-v2 / ./dist-pack-v2.
//   node export.js D:\out     -> writes there instead
//
// Also require()able: exportSite({ pack, dest }) -> { files, mb, dest }
// (used by the Mod Studio's "Export Website" button).

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ROOT, IKEMEN_SRC, build, readRoster } = require('./vfslib');
const layout = require('./layout');
//
//
// private site's folder beside the program, as it always was). A private
//
// Studio's board preview (server.js) and an exported board read it.
const LEADERBOARD_ART = layout.LEADERBOARD_ART;

const HTACCESS = `# Ikemen GO web build - Apache config
# Force HTTPS. Netplay (WebRTC) and the Build ID / desync content-check
# (Web Crypto is unavailable, and other secure-context features degrade, over
# plain http://), so bounce any http:// visitor to https:// before the page
# loads. The X-Forwarded-Proto check avoids a redirect loop on hosts that
# terminate TLS at a proxy and forward the request as http internally.
<IfModule mod_rewrite.c>
  RewriteEngine On
  RewriteCond %{HTTPS} off
  RewriteCond %{HTTP:X-Forwarded-Proto} !https
  RewriteRule ^ https://%{HTTP_HOST}%{REQUEST_URI} [R=301,L]
</IfModule>
# Browsers only stream-compile WebAssembly served with the right MIME type.
AddType application/wasm .wasm
AddType application/json .json
# Cache policy: EVERYTHING revalidates (no-cache = "you may store it, but
# ask the server before reusing it" - a 304 answer costs nothing). A
# returning player keeping yesterday's boot page/manifest and never learning
# a new build exists was a real field failure (a player needed incognito
# mode to update). The heavy assets additionally carry a per-export ?v=
# stamp in their URLs, which busts even cache layers that ignore this
# header. Deliberately NOT "immutable + stamp only": clients holding a
# pre-stamp cached page would then pin the old engine at the unstamped URL.
<IfModule mod_headers.c>
  <FilesMatch "\\.(html|js|json|pak|wasm)$">
    Header set Cache-Control "no-cache"
  </FilesMatch>
</IfModule>
# Game data files may contain anything; serve as opaque bytes.
<FilesMatch "\\.(sff|snd|air|cns|cmd|def|zss|act|st)$">
  ForceType application/octet-stream
</FilesMatch>
# Optional: password-protect by uncommenting and creating an .htpasswd.
# AuthType Basic
# AuthName "Private"
# AuthUserFile /full/server/path/to/.htpasswd
# Require valid-user
`;

function copy(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

// Rewrite the boot page's window.IKEMEN_BRAND block from roster.json, so a
// build carries the name of whoever made it instead of whoever wrote the
// tooling. Fields are all optional; anything absent keeps the neutral default
// baked into the page.
function copyBranded(src, dest, roster, { isPublic = false } = {}) {
  let html = fs.readFileSync(src, 'utf8');
  const brand = {
    title: roster.siteTitle || 'WebMUGEN',
    version: roster.siteVersion || '',
    credit: roster.siteCredit || '',
    hideBootUI: typeof roster.hideBootUI === 'number' ? roster.hideBootUI : 6,
    // Online identity server (unique names + recovery codes). Blank on
    // public builds - identity.js no-ops without it, so a public build never
    // talks to anyone's server. A non-public build carries the address of
    // whoever exports it: the author's site, or a host's own from a shareable
    // copy, where the roster holds that host's address and never the author's.
    identityUrl: isPublic ? '' : (roster.identityUrl || ''),
  };
  //
  // $' and $$ are patterns, and a title holding one broke the block and the
  // page. '<' is escaped so a title cannot close the <script> the block is in.
  const block = 'window.IKEMEN_BRAND = ' + JSON.stringify(brand, null, 2).replace(/</g, '\\u003c') + ';';
  let rewritten = html.replace(/window\.IKEMEN_BRAND\s*=\s*\{[\s\S]*?\};/, () => block);
  if (rewritten === html && /window\.IKEMEN_BRAND/.test(html)) {
    throw new Error('branding block found but not replaced - check the regex in copyBranded');
  }
  // Also stamp the static <title>, so the tab doesn't flash the neutral
  // default before the branding script runs. Escaped: a title containing
  // markup must not be able to close the tag.
  const tabTitle = (brand.title + (brand.version ? ' ' + brand.version : ''))
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  rewritten = rewritten.replace(/<title>[\s\S]*?<\/title>/, () => '<title>' + tabTitle + '</title>');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, rewritten);
}

//
//
//
// published, and both redistributable artifacts (the public web build and the
// modding kit) must ship without it.
//
// The queue FEATURE is already unreachable in those builds - its menu entries
// and their Lua are not in their game data, and SIGNAL_URL is blank - so what
// actually leaks is the prose. This function blanks prose only.
//
// COMMENT LINES ONLY, deliberately. The queue helpers are woven through
// webrtc.js (shared state near the top, callers near the bottom) and excising
// them is a refactor, not a release step. Stripping comments cannot change
// behavior, which is why it is safe to run on a release artifact. The callers
// verify that by diffing every non-comment line before and after.
//
// Returns how many lines were blanked. Takes a PATH and rewrites in place.
const PRIVATE_WORDS = /queue do|durable object|discord|elo|tier|placement|leaderboard|ranked|casual|dual.report|worker/i;
function stripPrivateComments(file) {
  const src = fs.readFileSync(file, 'utf8');
  let stripped = 0;
  const out = src.split('\n').map((line) => {
    const t = line.trim();
    // Only a line that IS a comment. A trailing comment on a code line is left
    // alone rather than risk cutting at a `//` inside a string literal.
    if (!t.startsWith('//') || !PRIVATE_WORDS.test(t)) return line;
    stripped++;
    return line.slice(0, line.indexOf('//')) + '//';
  }).join('\n');
  if (stripped) fs.writeFileSync(file, out);
  return stripped;
}

// Read a finished redistributable's webrtc.js back and REFUSE to continue if a
// private value survived. Every blanking step is a regex or string edit against
// a file this tooling does not own, so any of them can silently no-op after an
// unrelated refactor - and the export still reports success. That is exactly
// what happened during the v1.8 audit: a refactor dropped the write that
// persisted the blanked credentials, and a "public" build was produced carrying
// the live TURN key and lobby URL. A leak must fail loudly, before a zip exists.
//
// The values are read out of the PRIVATE source webrtc.js at build time rather
// than hardcoded here. Hardcoding them would put the author's TURN key and
// lobby host inside export.js - which the modding kit ships - so the leak guard
// would have become the leak (caught in the same audit). Deriving them also
// means the guard needs no edit when a credential is rotated.
//
// `sourceFile` is the private original; `file` is the finished redistributable.
// BY SHAPE FIRST, BY VALUE AS A BONUS.
//
// This used to read the three secrets OUT of public/ikemen/webrtc.js and check
// the output did not contain them - and it refused to run at all if the source
// was blank, on the sound reasoning that a blank source meant the regexes had
// stopped matching rather than that there was nothing to protect.
//
// That reasoning was correct for a tree whose source held live values. It is
// exactly wrong now the source is blank BY DESIGN (local-config.js): the old
// check threw `leak guard found no credentials` on the two paths that matter,
// the public web export and the kit. So the primary test is now structural - a
//
// also the only form that can protect a self-hoster who has their own values.
//
// The value check is kept as a second pass when this deployment happens to have
// a local config, because it catches one thing shape cannot: a secret that
// reached the output by some route other than the constant it came from.
function assertNoPrivateValues(file, sourceFile) {
  const out = fs.readFileSync(file, 'utf8');

  // 1. Structural: no populated endpoint constant may survive into a build.
  const populated = [
    ['TURN app', /const\s+METERED_APP\s*=\s*'[^']+'/],
    ['TURN key', /const\s+METERED_KEY\s*=\s*'[^']+'/],
    ['lobby server', /const\s+SIGNAL_URL\s*=\s*'[^']+'/],
  ].filter(([, re]) => re.test(out)).map(([what]) => what);
  if (populated.length) {
    throw new Error('redistributable would ship populated endpoints ('
      + populated.join(', ') + ') in ' + path.basename(file)
      + ' - the blanking above did not take effect');
  }

  // 2. By value, when there is a local config to compare against. Absence is
  //    normal (a clone has none) and must not fail the build - the structural
  //    pass above already stands on its own.
  const secrets = require('./local-config.js').secrets();
  const leaks = secrets.filter(([, v]) => out.includes(v)).map(([name]) => name);
  if (leaks.length) {
    throw new Error('redistributable would ship this deployment\'s own values ('
      + leaks.join(', ') + ') in ' + path.basename(file)
      + ' - they reached the output by some route other than the constants');
  }
}

// THE HOST'S CLOUDFLARE TOKEN AND ADMIN KEY, BY VALUE, IN EVERY FILE OF A
// FINISHED BUILD. assertNoPrivateValues above reads one file (webrtc.js) and
// runs on public builds only, because the rest of its values - the relay
//
//
// nothing fills them anywhere. But a token pasted into the wrong field (the
//
// ordinary branding route, and no check looked there. So every exporter runs
// this over its whole output: exportSite (public and not), desktop.js,
// make-kit.js and make-portable.js (normal and tester).
//
// Text files only - the same types the private-surface scan reads, plus the
// .htaccess every web build writes; sprite and sound data are copied from
// content, never written from a Studio field. `extra` is { name: Buffer|string }
// for output that is not a loose file: a packed build's generated files live
// inside game.pak. The error names the secret and the files, never the value.
// With no host record and no Players panel key there is nothing to look for
// and nothing is read.
//
//
const HOST_SECRET_NAMES = new Set(['HOST_TOKEN', 'HOST_ADMIN_KEY', 'LEADERBOARD_ADMIN_KEY']);
const HOST_SECRET_TEXT = {
  HOST_TOKEN: 'your Cloudflare token (HOST_TOKEN)',
  HOST_ADMIN_KEY: 'your servers\' admin key (HOST_ADMIN_KEY)',
  LEADERBOARD_ADMIN_KEY: 'a leaderboard\'s admin key from the Players panel (LEADERBOARD_ADMIN_KEY)',
};
function hostSecretsIn(dir, extra) {
  const want = require('./local-config.js').secrets().filter(([name]) => HOST_SECRET_NAMES.has(name));
  if (!want.length) return { checked: false, hits: [] };
  // The legacy kit ships export.js without private-surfaces.js.
  let TEXT = /\.(js|mjs|cjs|json|html?|css|lua|def|cns|air|txt|md|ini|cmd|st)$/i;
  let ownSettings = false;
  try {
    const priv = require('./private-surfaces.js');
    TEXT = priv.TEXT_EXT || TEXT;
    // A portable copy's own Settings folder at its top (layout.js), where the
    //
    // whether a build may hold it at all is assertClean's question
    // (settingsFolderIn), and a copy updated in place keeps its own.
    ownSettings = !!(priv.settingsFolderIn && priv.settingsFolderIn(dir));
  } catch (e) { /* the fallback above */ }
  const hits = [];
  const look = (label, buf) => {
    for (const [name, v] of want) if (buf.includes(v)) hits.push({ file: label, name });
  };
  (function walk(d) {
    let ents;
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (e.name !== 'node_modules' && e.name !== '.git' && !(ownSettings && d === dir && e.name === 'Settings')) walk(p);
        continue;
      }
      if (!e.isFile() || !(TEXT.test(e.name) || e.name === '.htaccess')) continue;
      // Where the two live. Whether a build may hold that file at all is
      // assertClean's question (PRIVATE_FILES), asked by every build that
      // must not; a portable copy updated in place keeps its own.
      if (e.name === 'local-config.json') continue;
      let buf;
      try { buf = fs.readFileSync(p); } catch (err) { continue; }
      look(path.relative(dir, p).split(path.sep).join('/'), buf);
    }
  })(dir);
  for (const [name, data] of Object.entries(extra || {})) {
    if (data == null) continue;
    look('game.pak: ' + name, Buffer.isBuffer(data) ? data : Buffer.from(String(data)));
  }
  return { checked: true, hits };
}
function assertNoHostSecrets(dir, label, extra) {
  const r = hostSecretsIn(dir, extra);
  if (!r.hits.length) return r;
  const what = [...new Set(r.hits.map((h) => h.name))].map((n) => HOST_SECRET_TEXT[n] || n);
  const files = [...new Set(r.hits.map((h) => h.file))];
  // detail: one secret's name is a message of its own (two joined are not matched)
  const detail = what.join(' AND '), where = label || dir, list = files.slice(0, 12).join(', ') + (files.length > 12 ? ', ...' : '');
  throw new Error(r.hits.some((h) => h.name === 'LEADERBOARD_ADMIN_KEY')
    ? 'THIS BUILD CARRIES ' + detail + ' - ' + where + '\n  in: ' + list
      + '\nIt must never leave this computer, so the folder exists but must not be uploaded or sent. It most likely'
      + ' was pasted into a text field that goes into the build (the site title or credit, say): take it out there and'
      + ' build again. If the token itself may have been seen, delete it on Cloudflare\'s API Tokens page and make a new one.'
      + ' If a leaderboard\'s admin key may have been seen, change it on that server.'
    : 'THIS BUILD CARRIES ' + detail + ' - ' + where + '\n  in: ' + list
      + '\nIt must never leave this computer, so the folder exists but must not be uploaded or sent. It most likely'
      + ' was pasted into a text field that goes into the build (the site title or credit, say): take it out there and'
      + ' build again. If the token itself may have been seen, delete it on Cloudflare\'s API Tokens page and make a new one.');
}

// A CHOSEN FOLDER IS EMPTIED ONLY WHEN IT HOLDS A WEBSITE EXPORT. Every export
// replaces its folder wholesale, and "Export to..." hands over whatever folder
// was picked - so picking D:\Games emptied D:\Games. A chosen folder has to be
// missing, empty, or an earlier website export (index.html beside ikemen-fs/,
// which every export writes); anything else is refused before a file is
// touched. The default folder (dist-pack-v2 and the rest, beside the program or
// in a portable copy's Website Export folder) is the exporter's own and is not
// checked.
function checkExportFolder(dir) {
  let st = null;
  try { st = fs.statSync(dir); } catch (e) { if (e.code === 'ENOENT') return; throw e; }
  if (!st.isDirectory()) throw new Error('"' + dir + '" is a file, not a folder');
  if (!fs.readdirSync(dir).length) return;
  let earlier = false;
  try {
    earlier = fs.statSync(path.join(dir, 'index.html')).isFile() && fs.statSync(path.join(dir, 'ikemen-fs')).isDirectory();
  } catch (e) { earlier = false; }
  if (earlier) return;
  throw new Error('"' + dir + '" already has other files in it. A website export replaces everything in its'
    + ' folder, so it only goes into an empty folder or one holding an earlier website export - pick another folder.');
}

function exportSite({ pack = false, v2 = false, public: isPublic = false, dest } = {}) {
  // vfslib reads IKEMEN_V2 at build() time (config.ini contents, V2 asset
  // layer, mod gating).
  if (v2) process.env.IKEMEN_V2 = '1';
  else delete process.env.IKEMEN_V2;
  // A named content bundle exports beside Main, never over it (layout.js).
  const defName = (pack ? 'dist-pack' : 'dist') + (v2 ? '-v2' : '') + (layout.EXPORT_SUFFIX || '') + (isPublic ? '-public' : '');
  const DIST = path.resolve(dest || path.join(layout.WEBSITE_EXPORT, defName));
  if (dest) checkExportFolder(DIST);
  //
  // from local-config.json. A file that is there but cannot be read - another
  // program holding it, a hand edit that broke it - reads as empty, and the
  // build went out without them and said nothing. Stopped here, before the
  // folder is emptied; a missing file is still the normal, blank case.
  if (!isPublic) {
    const why = require('./local-config.js').problem();
    if (why) {
      throw new Error('Export stopped: ' + why + ' A Website export made now would go out without your'
        + ' lobby relay and TURN addresses.');
    }
  }
  // The checked delete (lifebars.js): fs.rmSync leaves a path that holds a
  // non-ASCII character, and the new build was then laid over the old one.
  require('./lifebars.js').rmTree(DIST);
  fs.mkdirSync(DIST, { recursive: true });

  // 1. Boot page + runtime glue
  const webDir = path.join(ROOT, 'public', 'ikemen');
  let roster = {};
  try {
    roster = readRoster();   // vfslib's reader: a byte-order mark is not damage
  } catch (e) { /* no roster: branding falls back to the neutral default */ }
  //
  // shareable portable copies (since 2026-09-28) but is absent from the legacy
  // modding kit, and on public builds it is deleted again further down
  // anyway - so it must be OPTIONAL here. Treating
  // it as required is what made the kit's own "Export Website" die with a raw
  // ENOENT before writing a single file, in every kit from v1.4 to v1.7: this
  // tree has the file, so the failure was invisible from here. Everything else
  // in the list is genuinely required - a missing one is a broken checkout and
  // should still stop the export loudly.
  const OPTIONAL_WEB_FILES = new Set(['identity.js']);
  let haveIdentity = false;
  // The scripts to copy are READ OUT OF THE PAGES THAT LOAD THEM, not listed by
  // hand. A hand-written list silently drifts the moment a page gains a
  // <script> tag: v1.8 shipped studio-lite.html referencing motif-core.js,
  // sffdec-core.js and sffdec-browser.js while the list still named only the
  // six files that existed when it was written. The export succeeded, the
  // artifact scanned clean, and the uploaded Studio threw "motifCore is not
  // defined" on the first character anyone added - with the select-screen grid
  // dead for the same reason. Deriving the list makes that impossible: a page
  // cannot reference a module the exporter does not then ship.
  const localScripts = (htmlFile) => {
    const html = fs.readFileSync(htmlFile, 'utf8');
    const out = [];
    // Local relative scripts only - a CDN or absolute URL is not ours to copy.
    for (const m of html.matchAll(/<script[^>]+src="(?!https?:|\/\/)\.?\/?([^"]+)"/g)) {
      if (!out.includes(m[1])) out.push(m[1]);
    }
    return out;
  };
  const PAGES = ['index.html', 'studio-lite.html'];
  const wanted = ['wasm_exec.js', 'studio-lite.html'];   // not referenced by a <script src>
  for (const page of PAGES) {
    for (const s of localScripts(path.join(webDir, page))) {
      if (!wanted.includes(s)) wanted.push(s);
    }
  }
  for (const f of wanted) {
    const srcFile = path.join(webDir, f);
    if (!fs.existsSync(srcFile)) {
      if (!OPTIONAL_WEB_FILES.has(f)) {
        throw new Error('export: required file missing: ' + path.relative(ROOT, srcFile)
          + ' (referenced by one of ' + PAGES.join(', ') + ')');
      }
      continue;
    }
    copy(srcFile, path.join(DIST, f));
    if (f === 'identity.js') haveIdentity = true;
  }
  copyBranded(path.join(webDir, 'index.html'), path.join(DIST, 'index.html'), roster, { isPublic });
  // The game boot page is always reachable at play.html. On public builds the
  // Mod Studio front page (studio-lite) becomes the landing index.html, so an
  // itch.io visitor opens on the Studio and clicks "Build & Play" (-> play.html)
  // to launch the game. Private builds keep index.html = straight to the game.
  copyBranded(path.join(webDir, 'index.html'), path.join(DIST, 'play.html'), roster, { isPublic });
  //
  //
  // a host's own from a shareable copy): the plain standings unless Settings >
  // Online chose the Score Ranking board. Its RANKING block is filled in the
  // way copyBranded brands index.html. A public build has no address, so it
  // gets no page.
  if (!isPublic && roster.identityUrl) {
    const page = roster.leaderboardPage === 'board' ? 'board.html' : 'standings.html';
    const src = path.join(ROOT, 'public', 'ranking', page);
    if (fs.existsSync(src)) {
      const cfg = { server: roster.identityUrl, title: roster.siteTitle || 'WebMUGEN', credit: roster.siteCredit || roster.siteTitle || '' };
      const html = fs.readFileSync(src, 'utf8');
      const marker = 'window.RANKING = window.RANKING || {};';
      if (!html.includes(marker)) throw new Error('export: ' + page + ' has no RANKING block to fill');
      fs.writeFileSync(path.join(DIST, 'leaderboard.html'),
        html.replace(marker, () => 'window.RANKING = ' + JSON.stringify(cfg).replace(/</g, '\\u003c') + ';'));
    }
  }
  if (isPublic) {
    copy(path.join(webDir, 'studio-lite.html'), path.join(DIST, 'index.html'));
  }
  // License notices ride with EVERY build. The engine is MIT - its notice must
  // accompany any copy of the binary - and the screenpack's art is CC BY
  // (credits) and CC BY-NC (Elecbyte's). No build shipped them from v1.0 to
  // v1.8; the self-check refuses a build without the first two.
  //
  // A V2 build takes them from public/licenses/web, which
  // scripts/make-notices.js makes from what the build carries: the engine's
  // current license (release/'s copy stops at 2023), the 1.0 screenpack's
  // CC BY credits for the ikemen1 motif, lifebars and sounds (release/'s is the
  // v1 pack's), and THIRD-PARTY-NOTICES.txt for the Go modules compiled into
  // ikemen.wasm, wasm_exec.js and the page's own MIT license. The retired v1
  // engine keeps release/'s pair, which is its era's. A missing file is a
  //
  const licDir = v2 ? path.join(ROOT, 'public', 'licenses', 'web') : layout.dir('release');
  for (const lic of v2 ? ['License.txt', 'ScreenpackLicense.txt', 'THIRD-PARTY-NOTICES.txt'] : ['License.txt', 'ScreenpackLicense.txt']) {
    const p = path.join(licDir, lic);
    if (!fs.existsSync(p)) {
      // A warning, not a stop (the owner's choice).
      console.warn('export: ' + lic + ' missing from ' + licDir + ' - the build goes out without it');
      continue;
    }
    copy(p, path.join(DIST, lic));
  }

  if (!isPublic) {
    // PRIVATE BUILD: put this deployment's own endpoints in.
    //
    // The source is blank now (see local-config.js), so the private site is the
    // one build that has to ADD something rather than take it away. Absence of
    // a local config is not an error - it yields a private build with the lobby
    // off and the manual copy-paste connect still working, which is exactly
    // what a clone of this tree should produce.
    const wf = path.join(DIST, 'webrtc.js');
    if (fs.existsSync(wf)) {
      const lc = require('./local-config.js');
      const cfg = lc.load();
      if (lc.has(cfg)) {
        const r = lc.fillPrivateValues(fs.readFileSync(wf, 'utf8'), cfg);
        fs.writeFileSync(wf, r.text);
        console.log('Private build: filled ' + r.filled + ' endpoint(s) from local-config.json');
      } else {
        console.log('Private build: no local-config.json - lobby and TURN stay off');
      }
    }
  }

  if (isPublic) {
    // Public/redistributable build: strip the private TURN relay credentials
    // so a public host never relays (or pays for) strangers' traffic. STUN
    // still connects the large majority of players directly; anyone hosting
    // this can add their own TURN relay - see DEPLOYMENT.md.
    const wf = path.join(DIST, 'webrtc.js');
    let src = fs.readFileSync(wf, 'utf8');
    src = src.replace(/const METERED_APP = '[^']*';/,
      "const METERED_APP = ''; // STUN-only. For TURN relay fallback, put your metered.live app subdomain here (see DEPLOYMENT.md).");
    src = src.replace(/const METERED_KEY = '[^']*';/,
      "const METERED_KEY = ''; // Your metered.live API key (see DEPLOYMENT.md).");
    // Also drop the lobby server. Left in, a redistributed build would route
    //
    // Empty falls back to the manual offer/answer flow, which needs no
    // infrastructure at all and always works.
    src = src.replace(/const SIGNAL_URL = '[^']*';/,
      "const SIGNAL_URL = ''; // Your own lobby server, e.g. wss://ikemen-signaling.<you>.workers.dev/ws (see DEPLOYMENT.md). Empty = manual copy-paste connect.");
    // Persist the blanked credentials BEFORE the comment strip. stripPrivateComments
    // works on the file, not on `src`, so skipping this write silently shipped the
    // live TURN key and lobby URL in a "public" build - caught in the v1.8 audit.
    fs.writeFileSync(wf, src);

    const n = stripPrivateComments(wf);
    if (n) console.log('Public build: blanked ' + n + ' private-design comment lines in webrtc.js');

    assertNoPrivateValues(wf, path.join(webDir, 'webrtc.js'));

    //
    // reporting). It is already inert here because identityUrl is blank, but
    //
    // tag for it are just confusing noise - drop both. (Shareable portable
    // copies DO carry it, for a host's own non-public export; a public build,
    // the itch one included, never has.)
    require('./lifebars.js').rmFile(path.join(DIST, 'identity.js'));     // checked, as above
    haveIdentity = false;
    // Bundle the self-hosting guide and the field guide with the build.
    for (const doc of ['DEPLOYMENT.md', 'GRAIL.md']) {
      // The docs live in docs/ now; they still ship at the top of the build,
      // where someone unpacking a redistributable will actually find them.
      const p = path.join(ROOT, 'docs', doc);
      if (fs.existsSync(p)) copy(p, path.join(DIST, doc));
    }
  }

  // Drop the <script src="./identity.js"> tag whenever the module is not in
  // the build - either stripped by --public above, or simply absent from this
  // tree (the kit). Leaving it behind means every page load 404s on a file
  // that was never going to be there.
  if (!haveIdentity) {
    for (const page of ['index.html', 'play.html']) {
      const pp = path.join(DIST, page);
      if (!fs.existsSync(pp)) continue;
      fs.writeFileSync(pp, fs.readFileSync(pp, 'utf8')
        .replace(/^[ \t]*<script src="\.\/identity\.js"><\/script>\r?\n/m, ''));
    }
  }

  // 2. Engine binary (V2 ships under the same name the boot page fetches)
  const wasmSrc = v2 ? 'ikemen-v2.wasm' : 'ikemen.wasm';
  copy(path.join(IKEMEN_SRC, 'bin', wasmSrc), path.join(DIST, 'ikemen.wasm'));
  // Ship the engine's BUILD STAMP beside it. It records the sha of this exact
  // binary, a hash of every Go source that produced it, the build line and the
  // commit - so a deployed engine can always be traced back to a source state.
  // Written because an engine once reached players that nobody could attribute
  // to any source, which made 'did that change fix it?' unanswerable for days.
  // Optional: a tree built before tools/build-engine.sh existed has no stamp,
  // and that must not fail the export.
  const stampSrc = path.join(IKEMEN_SRC, 'bin', wasmSrc + '.build.txt');
  if (fs.existsSync(stampSrc)) {
    copy(stampSrc, path.join(DIST, 'ikemen.wasm.build.txt'));
  } else {
    console.warn('export: no engine build stamp beside ' + wasmSrc +
      ' - run tools/build-engine.sh so the shipped engine is traceable');
  }

  // 3. Virtual filesystem -> real files (or one pack file) + manifest.
  // Public builds ship only roster.publicChars (see vfslib.build).
  // ONLY THE SCREENPACK THIS BUILD USES. A built game has its motif fixed in
  // config.ini and no way to change it, so every other installed pack is
  // download the player can never reach - 399MB against the 171MB in use, on
  // the install this was written against.
  const themeFolder = String(roster.motif || '')
    .replace(/^data\//, '').split('/')[0].toLowerCase();
  const themesKeep = themeFolder ? new Set([themeFolder]) : null;
  // privateMenu is opt-in (vfslib.js): the author's own private site build gets
  //
  const built = build({
    publicOnly: isPublic, privateMenu: !isPublic, __themesKeep: themesKeep,
  });
  const { generated, index } = built;
  let bytes = 0, count = 0, skipped = 0;
  fs.mkdirSync(path.join(DIST, 'ikemen-fs'), { recursive: true });

  const readEntry = (vpath, abs) =>
    abs === null ? generated[vpath] : fs.readFileSync(abs);

  if (pack) {
    // Single game.pak: manifest maps vpath -> [offset, length].
    const manifest = { pack: 'game.pak', files: {} };
    const out = fs.openSync(path.join(DIST, 'ikemen-fs', 'game.pak'), 'w');
    //
    // here as each entry is written: reading the finished pak back whole
    // failed on a pak past 2 GiB (Node's readFileSync limit) after the whole
    // slow write. Same bytes in the same order, the same stamp.
    const stampHash = crypto.createHash('sha1');
    let offset = 0;
    for (const [vpath, abs] of index) {
      try {
        const data = readEntry(vpath, abs);
        fs.writeSync(out, data);
        stampHash.update(data);
        manifest.files[vpath] = [offset, data.length];
        offset += data.length;
        bytes += data.length;
        count++;
      } catch (e) {
        console.warn('  skipped ' + vpath + ': ' + e.message);
        skipped++;
      }
    }
    fs.closeSync(out);
    // Per-export cache stamp: the boot page and VFS append this as ?v= to
    // the pak and wasm URLs, so a new upload can never be shadowed by a
    // stale browser or proxy cache (field-hit: fetch {cache:'no-cache'}
    // revalidation was NOT enough - a player needed incognito mode to see
    // a new build). Covers the wasm too: engine and data ship together.
    manifest.stamp = stampHash
      .update(fs.readFileSync(path.join(DIST, 'ikemen.wasm')))
      .digest('hex').slice(0, 12);
    fs.writeFileSync(path.join(DIST, 'ikemen-fs', 'manifest.json'), JSON.stringify(manifest));
  } else {
    const manifest = { files: {} };
    for (const [vpath, abs] of index) {
      const destFile = path.join(DIST, 'ikemen-fs', 'file', vpath);
      try {
        if (abs === null) {
          fs.mkdirSync(path.dirname(destFile), { recursive: true });
          fs.writeFileSync(destFile, generated[vpath]);
          manifest.files[vpath] = generated[vpath].length;
        } else {
          copy(abs, destFile);
          manifest.files[vpath] = fs.statSync(abs).size;
        }
        bytes += manifest.files[vpath];
        count++;
      } catch (e) {
        console.warn('  skipped ' + vpath + ': ' + e.message);
        skipped++;
      }
    }
    fs.writeFileSync(path.join(DIST, 'ikemen-fs', 'manifest.json'), JSON.stringify(manifest));
  }

  // 3b. A tiny loose copy of the roster select.def, so the in-browser Mod
  // Studio can read the base roster WITHOUT depending on HTTP Range support
  // (some static hosts return the whole pak for a ranged request).
  if (generated['data/select.def']) {
    fs.writeFileSync(path.join(DIST, 'ikemen-fs', 'base-select.def'), generated['data/select.def']);
  }

  // 4. Apache config for static hosts
  fs.writeFileSync(path.join(DIST, '.htaccess'), HTACCESS);

  //
  // roster change can never ship without matching portraits/win poses (a new
  // character would silently render a portrait-less row otherwise). This sits
  // INSIDE exportSite rather than in the CLI wrapper because the Mod Studio's
  // "Export Website" button calls this function directly - putting it in the
  // CLI block meant the button silently skipped it. A public build has no
  //
  //
  //
  // same rule the Studio's Make button and the pose choice follow), in the
  // author's tree and in a shareable copy alike (2026-09-28: "included AND
  //
  // and that is nothing to do, not an error.
  //
  // WHERE: the ACTIVE bundle's own folder and nowhere else (makeBoardArt). The
  // manifest is rebuilt from the exported roster, so writing any other
  // bundle's folder would leave that board knowing only this bundle's
  // characters - which a test once did to the site's art, leaving a KFM-only
  // manifest. The extractor refuses another bundle's folder as well.
  let art = null;
  if (!isPublic && require('./modlib.js').canBoardArt(roster)) {
    try {
      art = makeBoardArt();
    } catch (e) {
      // Never fail an export over cosmetics: a broken character costs its
      // portrait, not the site build.
      console.warn('leaderboard art extraction failed (site still exported): ' + e.message);
    }
  }

  //
  // gets a copy of the art this export just refreshed - only what the new
  // manifest names (copyBoardArt). The plain standings draw no art.
  if (art && fs.existsSync(path.join(DIST, 'leaderboard.html')) && roster.leaderboardPage === 'board') {
    copyBoardArt(art.out, path.join(DIST, 'leaderboard-art'));
  }

  // Neither host secret in any file of it, public or not (see
  // assertNoHostSecrets); a packed build's generated files are checked where
  // they came from, since they sit inside game.pak.
  assertNoHostSecrets(DIST, (isPublic ? 'public ' : '') + 'Website export ' + DIST, pack ? generated : null);

  // Refuse to report success on a build that cannot be played. See
  // tools/export-selfcheck.js for why each check exists.
  require('./tools/export-selfcheck').selfCheck(DIST);

  // charFixes: what the build did to its copy of each character (vfslib
  // build, the same shape as the desktop export's), for the result page's
  // NOTES (exportnotes.js). The roster the build was made from (a public
  // build's cut) rides along unlisted, so it never reaches the JSON.
  const result = { files: count, skipped, mb: +(bytes / 1e6).toFixed(1), dest: DIST, art, charFixes: built.charFixes || [] };
  Object.defineProperty(result, 'builtRoster', { value: built.roster || roster, enumerable: false });
  return result;
}

//
//
// parameter, so no caller - the export, the Studio's Make button - can point
// the extractor at another bundle's art. Incremental: files are added and
// overwritten, the manifest rebuilt from the roster, nothing deleted.
// -> the extractor's { chars, out, rows }. Throws when the extractor is not in
// this copy or refuses (no roster, no encoder).
function makeBoardArt({ quiet = true } = {}) {
  return require('./tools/extract-charart').extractAll(layout.LEADERBOARD_ART, quiet);
}

// THE BOARD'S ART, AS THE MANIFEST NAMES IT: manifest.json, and each
// character's portrait, win frames and win.gif - nothing else.
//
// The art folder is the bundle's own (for the checkout's Main, the private
// site's) and is never cleaned: the extractor only ever adds and overwrites,
// so it still holds the folders of characters that have left the roster
// (four, when this was written) and, in a character's folder, win frames past
// the end of a pose that has since become shorter. Copying the folder whole
// shipped all of that beside the board. The manifest is the list of what the
// board can ask for, so it is the list of what gets copied; the art folder
// itself is left exactly as it is.
// A name that would reach outside the art folder is not copied, and a named
// file that is missing is skipped (the board draws that row without it).
// -> { files, missing }
function copyBoardArt(artDir, dest) {
  const manifest = JSON.parse(fs.readFileSync(path.join(artDir, 'manifest.json'), 'utf8'));
  const names = new Set();
  for (const c of Object.values(manifest.chars || {})) {
    if (!c) continue;
    if (c.portrait) names.add(c.portrait);
    if (c.win) {
      for (const f of c.win.frames || []) if (f && f.src) names.add(f.src);
      if (c.win.gif) names.add(c.win.gif);
    }
  }
  const root = path.resolve(artDir);
  fs.mkdirSync(dest, { recursive: true });
  fs.copyFileSync(path.join(root, 'manifest.json'), path.join(dest, 'manifest.json'));
  let files = 1, missing = 0;
  for (const rel of names) {
    const from = path.resolve(root, String(rel));
    if (!from.startsWith(root + path.sep)) continue;
    if (!fs.existsSync(from)) { missing++; continue; }
    const to = path.join(dest, path.relative(root, from));
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
    files++;
  }
  return { files, missing };
}

// ---- after an export: what the folder holds, and the zip to hand on ----------
//
// The Studio's export result card (studio.html, showExportCard) shows both,
// for a Website export and a Desktop one alike.

// Every file under `dir`: how many, how many bytes, and the largest one (its
// path from `dir`, with forward slashes). A link is not followed: an export
// writes none, and following one could count a folder twice or leave `dir`.
// -> { files, bytes, largest: { path, bytes } | null }
function folderSummary(dir) {
  const root = path.resolve(dir);
  let files = 0, bytes = 0, largest = null;
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) { walk(p); continue; }
      if (!e.isFile()) continue;
      const size = fs.statSync(p).size;
      files++;
      bytes += size;
      if (!largest || size > largest.bytes) largest = { path: path.relative(root, p).split(path.sep).join('/'), bytes: size };
    }
  };
  walk(root);
  return { files, bytes, largest };
}

// Where a folder's zip goes: beside it, named after it. A build at the top of
// a drive has no "beside".
function zipPathFor(dir) {
  const src = path.resolve(dir);
  const parent = path.dirname(src);
  if (parent === src) {
    throw new Error('This build is at the top of a drive, so there is no folder beside it for the zip. Export into a folder, then make the zip.');
  }
  return path.join(parent, path.basename(src) + '.zip');
}

// THE FOLDER'S CONTENTS AS A ZIP, BESIDE IT: <parent>\<folder>.zip, with the
// files at the zip's root - itch.io looks for index.html there, and a friend's
// "Extract All" puts the files in a folder of the zip's name.
//
// Written by .NET's ZipFile with forward slashes, the way make-portable --zip
// and tools/make-itch-zips.ps1 write theirs. NEVER Compress-Archive: Windows
// PowerShell 5.1's writes backslashes into entry names, and itch.io's
// extractor takes "ikemen-fs\game.pak" as one file name at the root, so the
// game 404s on ikemen-fs/manifest.json. The paths reach PowerShell as
// environment variables, never on a command line (quotes, and tar-style ANSI
// code-page mangling of non-ASCII names, cannot happen). Asynchronous: a
// 600 MB build takes a minute, and the server keeps answering meanwhile.
//
// Made as <zip>.part and renamed over any earlier zip only once it reads back
// with every file of the folder in it; a failed one is deleted.
// -> Promise<{ zip, entries, bytes, replaced }>
function zipFolderContents(dir) {
  return new Promise((resolve, reject) => {
    let zip, src;
    try {
      src = path.resolve(dir);
      zip = zipPathFor(src);
      if (process.platform !== 'win32') throw new Error('Making a zip here needs Windows.');
      let st = null;
      try { st = fs.statSync(src); } catch (e) { st = null; }
      if (!st || !st.isDirectory()) throw new Error('The export folder is not there any more: ' + src);
      let zst = null;
      try { zst = fs.statSync(zip); } catch (e) { zst = null; }
      if (zst && zst.isDirectory()) throw new Error('A folder named ' + path.basename(zip) + ' is in the way, beside the export folder.');
    } catch (e) { reject(e); return; }
    const replaced = fs.existsSync(zip);
    const part = zip + '.part';
    const want = folderSummary(src).files;
    const ps = [
      "$ErrorActionPreference = 'Stop'",
      'Add-Type -AssemblyName System.IO.Compression',
      'Add-Type -AssemblyName System.IO.Compression.FileSystem',
      '$src = (Get-Item -LiteralPath $env:MS_SRC).FullName.TrimEnd([char]92)',
      'if (Test-Path -LiteralPath $env:MS_ZIP) { Remove-Item -LiteralPath $env:MS_ZIP -Force }',
      "$a = [System.IO.Compression.ZipFile]::Open($env:MS_ZIP, 'Create')",
      'try {',
      '  Get-ChildItem -LiteralPath $src -Recurse -Force | ForEach-Object {',
      '    $rel = $_.FullName.Substring($src.Length + 1).Replace([char]92, [char]47)',
      '    if ($_.PSIsContainer) {',
      '      if (-not (Get-ChildItem -LiteralPath $_.FullName -Force | Select-Object -First 1)) { [void]$a.CreateEntry($rel + [char]47) }',
      '    } else {',
      '      [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($a, $_.FullName, $rel, [System.IO.Compression.CompressionLevel]::Optimal)',
      '    }',
      '  }',
      '} finally { $a.Dispose() }',
    ].join('\n');
    const dropPart = () => { try { require('./lifebars.js').rmFile(part); } catch (e) { /* said below */ } };
    require('child_process').execFile('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], {
      env: Object.assign({}, process.env, { MS_SRC: src, MS_ZIP: part }),
      windowsHide: true, maxBuffer: 4 << 20,
    }, (err, stdout, stderr) => {
      if (err) {
        dropPart();
        const why = String(stderr || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean)[0] || err.message;
        reject(new Error('Could not make the zip: ' + why));
        return;
      }
      // Read back: every file of the folder is in it.
      const names = require('./enginezip.js').zipEntries(part);
      const got = names ? names.filter((n) => !n.endsWith('/')).length : -1;
      if (got !== want) {
        dropPart();
        reject(new Error(got < 0 ? 'The zip came out wrong (it could not be read back), so it was not kept.'
          : 'The zip came out wrong (' + got + ' of ' + want + ' files), so it was not kept.'));
        return;
      }
      try {
        fs.renameSync(part, zip);
      } catch (e) {
        dropPart();
        const code = e.code || e.message;
        reject(new Error(e.code === 'EBUSY' || e.code === 'EPERM' ? 'Could not put the zip in place (' + code + '): ' + zip + '. Is the older zip open in another program?'
          : 'Could not put the zip in place (' + code + '): ' + zip));
        return;
      }
      resolve({ zip, entries: got, bytes: fs.statSync(zip).size, replaced });
    });
  });
}

module.exports = { exportSite, checkExportFolder, stripPrivateComments, assertNoPrivateValues, hostSecretsIn, assertNoHostSecrets, LEADERBOARD_ART, makeBoardArt, copyBoardArt, folderSummary, zipPathFor, zipFolderContents,
  // exported for the tests (tools/test-copybranded.js)
  copyBranded };

if (require.main === module) {
  const args = process.argv.slice(2);
  const pack = args.includes('--pack');
  const v2 = args.includes('--v2');
  const isPublic = args.includes('--public');
  const dirArg = args.find(a => !a.startsWith('--'));
  const r = exportSite({ pack, v2, public: isPublic, dest: dirArg });
  console.log(`Done: ${r.files} game files (${r.mb} MB)` +
    (r.skipped ? `, ${r.skipped} skipped` : '') + ' + engine + boot page.');
  console.log('Upload the contents of ' + r.dest + ' and open index.html in a browser.');
  if (r.art) console.log(`Leaderboard art: ${r.art.chars} characters -> ${r.art.out}`);
}
