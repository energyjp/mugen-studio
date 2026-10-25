// Content management for the Mod Studio: add/remove characters, stages and
// music. Pure filesystem + roster.json operations; no server dependencies.

const fs = require('fs');
const path = require('path');
const os = require('os');
const zlib = require('zlib');
const { spawnSync } = require('child_process');
const { ROOT, readRoster, writeRoster, build: buildIndex, stageKeepFilter } = require('./vfslib');
const layout = require('./layout');
const stagethumb = require('./stagethumb');
const portraitfix = require('./portraitfix');
const logogen = require('./logogen');
// Decode-only SFF layer. Split out of tools/extract-charart.js so the Studio
// can render sprites WITHOUT the kit ever shipping the leaderboard extractor:
// this module has no file writes at all, so it cannot produce artwork.
const crypto = require('crypto');
const sffDecode = require('./tools/sff-decode.js');
// The decoder core itself, for what the Node wrapper above does not re-export:
// the engine's .air sprite lookup (spriteKey: -1 is no sprite, other negatives
// wrap through uint16) and a v2 palette node's alpha (v2PaletteAlphaAt).
const sffCore = require('./public/ikemen/sffdec-core.js');
const scenelib = require('./scenelib.js');
// Motif [Select Info] parsing + select.def authoring, shared verbatim with
// Mod Studio Lite so the two Studios cannot drift on grid geometry.
const motifCore = require('./public/ikemen/motif-core.js');
// Character .cns constants (health, movement speed, size), shared verbatim
// with Mod Studio Lite. Previously this file carried its own copy of the SIZE
// half only, which is exactly why the desktop Studio could resize a character
// but not change its health: the two implementations drifted.
const charconstCore = require('./public/ikemen/charconst-core.js');
// Audio duration from the header, shared with the browser Studio so both
// answer the same on the same file.
const audioCore = require('./public/ikemen/audio-core.js');
// The two entries the animation player offers (the full action, and the loop
// the engine repeats), on its own timeline, shared so the GIF export and the
// action list cannot play an action differently from it.
const { airEntries } = require('./public/ikemen/animview-core.js');
const { SPEED_KEYS, readCharConsts, patchCharConsts, scaleVel,
        readSizeScale, patchSizeScale } = charconstCore;
// The rest of the card's constants (attack, defence, the meters, the jump
// speeds, gravity, friction) and the one write path every character-file edit
// goes through.
const charstats = require('./charstats.js');
const charedit = require('./charedit.js');

const CACHE = layout.dir('cache');
const STAGES = layout.dir('stages');
const MUSIC = layout.dir('music');

// EVERY DELETE OF THE OWNER'S CONTENT goes through these, never a bare
// fs.rmSync: the Studio's Node runtime returns from rmSync without error and
// without deleting when the path holds a non-ASCII character - a folder or
// file dropped in by hand, or an install under a name with an accent - and a
// removal was then reported that had not happened. Each deletes or throws;
// rmFile refuses a folder. See lifebars.js.
const rmTree = (p) => require('./lifebars.js').rmTree(p);
const rmFile = (p) => require('./lifebars.js').rmFile(p);

function slugify(name) {
  return (name.replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'item');
}

// The archives a character, stage, screenpack, logo or lifebar pack can come
// in. Everything that takes a .zip takes the other two as well.
const ARCHIVE_RE = /\.(zip|rar|7z)$/i;
function isArchive(p) { return ARCHIVE_RE.test(String(p || '')); }

// .RAR AND .7Z are unpacked by Windows' own tar.exe (libarchive, in System32
// since Windows 10 1803; it reads 7z and RAR 4 and 5). Two things it needs:
//   - tar takes its command line in the ANSI code page, so a Japanese or
//     accented path - an upload in the temp folder of a user named José - did
//     not reach it intact. Neither path goes on the command line: the archive
//     is its stdin (an open file, still seekable, which 7z and RAR need) and
//     the destination is its working folder.
//   - an encrypted entry makes it ask for a passphrase at the console, where
//     nobody is. A placeholder one means it answers "Incorrect passphrase"
//     instead of waiting.
function untar(archivePath, destDir) {
  const exe = process.platform === 'win32'
    ? path.join(process.env.SystemRoot || process.env.windir || 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
  if (process.platform === 'win32' && !fs.existsSync(exe)) return { missing: true };
  let fd;
  try { fd = fs.openSync(archivePath, 'r'); } catch (e) { return { status: -1, err: e.message }; }
  try {
    const r = spawnSync(exe, ['--passphrase', 'no-password-given', '-x', '-f', '-'], {
      cwd: destDir, stdio: [fd, 'ignore', 'pipe'], encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024,
    });
    if (r.error && r.error.code === 'ENOENT') return { missing: true };
    return { status: r.error ? -1 : r.status, err: String(r.stderr || (r.error && r.error.message) || '') };
  } finally { fs.closeSync(fd); }
}

// What tar said, in words a user can act on - or null when nothing it said
// means the archive is unusable (a single entry Windows cannot create, which
// the zip path has always skipped too).
function untarTrouble(name, t) {
  const why = String(t.err || '');
  if (t.missing) return 'could not unpack ' + name + ': this Windows has no tar.exe to open .rar and .7z files with (Windows 10 from 2018 on has one). Unpack it with 7-Zip or WinRAR, then add the folder';
  if (/passphrase|password|encrypt/i.test(why)) return 'could not unpack ' + name + ': it is password-protected. Unpack it with its password in 7-Zip or WinRAR, then add the folder';
  if (/unrecognized archive format/i.test(why)) return 'could not unpack ' + name + ': it is not a .zip, .rar or .7z archive (or not one Windows can read)';
  if (/unsupported|not supported/i.test(why)) return 'could not unpack ' + name + ': it uses something Windows\' unpacker does not support ('
    + why.split(/\r?\n/)[0].replace(/^tar(\.exe)?:\s*/i, '').trim() + '). Unpack it with 7-Zip or WinRAR, then add the folder';
  if (/truncat|damaged|seek error|premature|corrupt|crc|checksum|bad (rar|7z|archive|header)|invalid|unexpected end|end of file/i.test(why)) {
    return 'could not unpack ' + name + ': the archive is damaged or cut short';
  }
  return null;
}

// The paths reach PowerShell as DATA, through the environment, never inside
// the command text: a file name is free to contain $(...), $name, a backtick
// or a curly quote, and in a double-quoted -Command string each of those is
// code. An entry Windows cannot create is skipped as it always was (the rest
// of the pack still arrives); an archive that yields NOTHING - damaged, cut
// short, password-protected - is refused in plain words, and what this call
// unpacked or made for it is removed so a retry is not told it "already
// exists".
//
// The name is older than the other formats: it unpacks all three. A .zip
// still goes through Expand-Archive exactly as before (the Shift-JIS names in
// old MUGEN zips come out as they always have); only a zip Expand-Archive
// gets NOTHING out of is handed to tar too, which reads by content - so a
// .rar or .7z renamed .zip now just works.
function extractZip(zipPath, destDir) {
  const name = path.basename(String(zipPath));
  const made = !fs.existsSync(destDir);
  fs.mkdirSync(destDir, { recursive: true });
  const before = new Set(fs.readdirSync(destDir));
  const fresh = () => { try { return fs.readdirSync(destDir).filter((f) => !before.has(f)); } catch (e) { return []; } };
  const refuse = (msg) => {
    if (made) { try { rmTree(destDir); } catch (e) { /* left behind in temp */ } }
    else for (const f of fresh()) { try { rmTree(path.join(destDir, f)); } catch (e) { /* ditto */ } }
    throw new Error(msg);
  };
  if (/\.zip$/i.test(name)) {
    const r = spawnSync('powershell', [
      '-NoProfile', '-NonInteractive', '-Command',
      "$ProgressPreference = 'SilentlyContinue'; Expand-Archive -LiteralPath $env:MS_ZIP -DestinationPath $env:MS_DEST -Force",
    ], { env: Object.assign({}, process.env, { MS_ZIP: String(zipPath), MS_DEST: String(destDir) }), encoding: 'utf8', windowsHide: true });
    if (!fresh().length) {
      const t = untar(zipPath, destDir);
      if (t.status !== 0 || !fresh().length) {
        const why = !t.missing && untarTrouble(name, t);
        if (why && /password/.test(why)) refuse(why);
        if (r && r.error && r.error.code === 'ENOENT') refuse('could not unpack ' + name + ': PowerShell is not available on this machine');
        refuse('could not unpack ' + name + ': the zip is damaged, cut short, or not a zip');
      }
    }
  } else {
    const t = untar(zipPath, destDir);
    const why = (t.missing || t.status !== 0) ? untarTrouble(name, t) : null;
    if (why) refuse(why);
    // tar.exe writes names through the ANSI code page too, and skips an entry
    // whose name it cannot put in it - Japanese names on a Windows set to
    // English. A few such files are skipped the way the zip path skips a name
    // Windows cannot create; a pack whose own folder has such a name has
    // nothing left, and says why.
    if (!fresh().length) {
      refuse('could not unpack ' + name + (/unreadable filename/i.test(t.err || '')
        ? ': its file names use characters (Japanese?) that Windows\' unpacker cannot write on this PC. Unpack it with 7-Zip or WinRAR, then add the folder'
        : ': the archive is empty, damaged or cut short'));
    }
  }
  // Flatten a single wrapping folder. It is first moved aside under a name of
  // its own, so a folder holding one of the SAME name (Pack/Pack/...) is never
  // renamed onto its own parent (EPERM on Windows). The emptied folders go
  // with rmdirSync, which (unlike rmSync on the Studio's Node runtime) also
  // works when the path holds a non-ASCII character.
  const entries = fs.readdirSync(destDir, { withFileTypes: true });
  if (entries.length === 1 && entries[0].isDirectory()) {
    const aside = fs.mkdtempSync(path.join(destDir, '.flatten-'));
    const inner = path.join(aside, 'w');
    fs.renameSync(path.join(destDir, entries[0].name), inner);
    for (const item of fs.readdirSync(inner)) {
      fs.renameSync(path.join(inner, item), path.join(destDir, item));
    }
    fs.rmdirSync(inner);
    fs.rmdirSync(aside);
  }
}

// Writes an uploaded buffer to a temp file so zip/copy paths are uniform.
function bufferToTemp(buffer, origName) {
  const tmp = path.join(os.tmpdir(), 'mugen-upload-' + Date.now() + '-' + slugify(origName) + path.extname(origName));
  fs.writeFileSync(tmp, buffer);
  return tmp;
}

function parseDefSections(text) {
  // returns flat key->value map (last wins) plus the raw referenced values
  const kv = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([\w.]+)\s*=\s*(.+?)\s*(;.*)?$/.exec(line);
    if (m) kv[m[1].toLowerCase()] = m[2].replace(/"/g, '');
  }
  return kv;
}

// The answer is kept per folder while its .def files keep their names (in the
// listing's order, which breaks a tie), sizes and times: the library asks it
// for every folder on every load, and each ask read every .def in the folder.
const MAIN_DEF_CACHE = new Map();   // dir -> { stamp, value }
const MAIN_DEF_CACHE_MAX = 4096;
function findMainDef(dir) {
  const names = fs.readdirSync(dir);
  const defs = names.filter((f) => f.toLowerCase().endsWith('.def'));
  const stamp = defs.map((f) => { try { const st = fs.statSync(path.join(dir, f)); return f + '|' + st.size + '@' + st.mtimeMs; } catch (e) { return f + '|-'; } }).join(';');
  const hit = MAIN_DEF_CACHE.get(dir);
  if (hit && hit.stamp === stamp) return hit.value;
  const { value, complete } = findMainDefIn(dir, names);
  // a .def that would not read is tried again next time, as before
  if (!complete) return value;
  MAIN_DEF_CACHE.delete(dir);
  MAIN_DEF_CACHE.set(dir, { stamp, value });
  if (MAIN_DEF_CACHE.size > MAIN_DEF_CACHE_MAX) MAIN_DEF_CACHE.delete(MAIN_DEF_CACHE.keys().next().value);
  return value;
}
function findMainDefIn(dir, names) {
  const folder = path.basename(dir).toLowerCase();
  const scored = [];
  let complete = true;
  for (const f of names) {
    if (!f.toLowerCase().endsWith('.def')) continue;
    let text;
    try { text = fs.readFileSync(path.join(dir, f), 'latin1'); } catch { complete = false; continue; }
    if (!/\[files\]/i.test(text)) continue;
    // A real character def points sprite= at an actual .sff (non-empty value);
    // stub/config defs (e.g. an AI's data_char.def) leave sprite=/cmd= blank
    // and used to win because they still contained the word "cmd".
    const hasSprite = /^\s*sprite\s*=\s*\S+/mi.test(text);
    if (!hasSprite && !/^\s*cmd\s*=\s*\S+/mi.test(text)) continue;
    let score = (hasSprite ? 2 : 0) + (f.toLowerCase() === folder + '.def' ? 3 : 0);
    scored.push({ f, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return { value: scored.length ? scored[0].f : null, complete };
}

// Known H-receiver pair-animation registries. A character that SHIPS animations
// in these ranges is a receiver (it provides the tailored pair art a giver
// plays on it). Reverse-engineered by measuring a large real-world collection:
// Kuromaru basic-4 + variants, Minotaur, Filiamaru,
// DongHwan. The old rule only checked Filiamaru (70000/80000), so the far more
// common Kuromaru (19230/12250/18300) and Minotaur (36xxx) receivers - Bulleta,
// Hotaru, Whip, etc. - were never flagged.
// The same windows, named by family (GRAIL 4.2). The pair bench groups a
// giver's demands by these; detection reads the flat list derived below.
const H_FAMILIES = [
  { name: 'Kuromaru', ranges: [[19230, 19239], [12249, 12259], [17230, 17239], [18300, 18309], [17850, 17869]] },
  { name: 'Minotaur', ranges: [[36000, 36999], [42000, 42999], [15600, 15699]] },
  { name: 'Filiamaru', ranges: [[70000, 71999], [80000, 81999]] },
  // DongHwan's family. Discovered by mining the community-labeled DB: six
  // characters the community calls Victim were detected as NOTHING by us, and
  // every one of them ships these ranges - they match DongHwan's measured
  // requirement set exactly (180130, 180210-214, 180500-503, 280120-124,
  // 1180207-211, 1801130-134, 1802130-134, 1805000-004, 18050004). The old
  // list only had his 4343-series, so his whole receiver pool was invisible.
  { name: 'DongHwan', ranges: [[43430, 43449], [4343, 4343],
    [180000, 180999], [280000, 280999], [1180000, 1180999],
    [1801000, 1802999], [1805000, 1805999], [18050000, 18050999]] },
  { name: 'unattributed 37000s', ranges: [[37000, 37999]] },   // seen across several victims
  // Not a receiver window (it is not in RECEIVER_REGISTRIES); an H number for
  // the giver idiom only, see isHNumber.
  { name: 'FutaRB', ranges: [[90000, 90999]], registry: false },
  // THE FUTA BRAND (FutaNT / FutaBT / FutaLB; 2026-09-20). Not receiver windows
  // either - the protocol runs on the victim's SPRITES, not her actions - so
  // both are registry:false and change nothing RECEIVER_REGISTRIES or isHNumber
  // already say. 122331 is the brand's FLAG: a one-frame blank action a victim
  // ships to tell the giver "use your 12/9/10-frame Plus tables on me"
  // (`selfanimexist(122331)` picks `StateOwner,anim + 21000` over `+ 1000`).
  // The second entry only names the giver's Plus victim tables for the bench.
  { name: 'FutaNT flag', ranges: [[122331, 122332]], registry: false, flag: true },
  { name: 'FutaNT tables', ranges: [[91000, 91999], [101000, 101999]], registry: false },
];
const RECEIVER_REGISTRIES = H_FAMILIES.filter((f) => f.registry !== false).flatMap((f) => f.ranges);
// A giver carries the imposed-scene idiom many times over (a full kit). One or
// two hits is an incidental compat hook, not an aggressor.
const GIVER_KIT_MIN = 10;
// ...or it plays at least this many anims on a victim that it doesn't ship.
const GIVER_EXPECTS_MIN = 4;
// ...or it asks a VICTIM whether it carries this many different registry
// windows. Asking `target,SelfAnimExist(19230)` is giver-side compatibility
// checking by definition - a receiver never interrogates its partner's art.
// Measured over 257 characters: at 2+ windows the split is perfect (22 already
// givers, 0 receivers, 0 anything else). At 1 it is ambiguous - 4 givers and 4
// receivers - so 1 stays AND-gated on the expects count below.
const GIVER_PROBE_MIN = 2;
const inReceiverRegistry = (n) => RECEIVER_REGISTRIES.some(([a, b]) => n >= a && n <= b);
// WINDOWS A GIVER PROBES, NEVER A RECEIVER'S (2026-10-07): the tentacle and
// monster givers (Roper, Ripps, Monsters, Creatures) ask her 15401, 15800,
// 15802, 15905, 15951, 15952. As a receiver window the range is wrong:
// ordinary fighters number their own moves there (Iori, Gouken, Saber, Vega
// read as receivers, measured over 1,818 characters). Asked of HER, in a
// probe, it is H: only the probe count reads it. Starts at 15400 so the
// throw idiom's 15110/15140 stays out; Minotaur's 15600s are a window already.
const PROBE_WINDOWS = [[15400, 15599], [15700, 15999]];
const inProbeWindow = (n) => inReceiverRegistry(n) || PROBE_WINDOWS.some(([a, b]) => n >= a && n <= b);

// A CHARACTER THAT SABOTAGES ITS OPPONENT (2026-10-09): where its code writes
// into ANOTHER character's variables at an index it computes - an assignment
// (`:=`) inside the operand an enemy, enemynear, partner, target or p2
// redirect governs, with the variable's number an expression, not a literal.
// Jesuszilla's CvS2 characters (cvs2 Felicia, Eagle, Alex, Sagat) carry an
// "Anti-Rape system" that scores each opponent and, over its threshold, runs
// `enemy(0), cond(1, var(Random%60) := ((Random * 4) / Random) + Random, 0)`
// every frame: random values into random variables of the opponent's own
// code. Their readme says MUGEN crashes; on Ikemen GO it plays on, but the
// opponent is wrecked - SFV Cammy (her meter banks score 5 of its 38 checks)
// walked away from cvs2 Felicia and vanished for the rest of the round,
// while against Kyo she fought normally. A literal index is someone's agreed
// variable (Minotaur resets a rival Minotaur helper's var(8) := 0); a
// computed one is a variable it cannot know the meaning of. Writes through
// root, parent and helper reach the character's own parts and are normal
// (KOF XIII's power gauge, the CvS2 family's own helpers). Measured over 1,783
// characters: those four, nothing else. `text`: one loaded file; pushes
// { file, line, redirect } into `into`.
function sabotageSites(text, rel, into) {
  if (!text.includes(':=')) return;
  // Does `s` assign a variable whose index is not a plain number? Each `:=`
  // is walked back to the (...) it follows and the name before that.
  const computedAssign = (s) => {
    for (let k = s.indexOf(':='); k >= 0; k = s.indexOf(':=', k + 2)) {
      let e = k - 1;
      while (e >= 0 && s[e] === ' ') e--;
      if (s[e] !== ')') continue;
      let depth = 1, b = e - 1;
      for (; b >= 0 && depth > 0; b--) { if (s[b] === ')') depth++; else if (s[b] === '(') depth--; }
      if (!/(?:^|[^a-z0-9_])(?:var|fvar|sysvar|sysfvar)\s*$/.test(s.slice(0, b + 1))) continue;
      if (!/^\s*\d+\s*$/.test(s.slice(b + 2, e))) return true;
    }
    return false;
  };
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/;.*$/, '').toLowerCase();
    if (!line.includes(':=')) continue;
    const re = /\b(enemy|enemynear|partner|target|p2)\s*(\(\s*[^()]*\))?\s*,\s*/g;
    let m;
    while ((m = re.exec(line))) {
      // The operand the redirect governs: one balanced name(...) or (...)
      // group - and, when that group is the variable itself, the `:=` after it.
      const from = m.index + m[0].length;
      const head = /^[a-z_][a-z0-9_.]*\s*\(|^\(/.exec(line.slice(from));
      if (!head) continue;
      let j = from + head[0].length, depth = 1;
      for (; j < line.length && depth > 0; j++) { if (line[j] === '(') depth++; else if (line[j] === ')') depth--; }
      let operand = line.slice(from, j);
      const assign = /^\s*:=/.exec(line.slice(j));
      if (assign && /^(?:var|fvar|sysvar|sysfvar)\s*\(/.test(operand)) operand += assign[0];
      if (computedAssign(operand)) {
        into.push({ file: rel, line: i + 1, redirect: m[1] });
        break;
      }
    }
  }
}

// THE NUMBERS A CHARACTER'S OWN COMPUTED EXPLODS CAN DRAW (hScan, "A HUD BANK
// IS NOT PAIR ART"): the receiver-window actions among them. An Explod or
// ModifyExplod whose `anim` is an expression (not a bare number, not an F
// fight.def number) picks a frame from a bank: `17801 + (time % 63) +
// ifelse(c, 100, 0)`. Its starts are each literal >= 1000 standing as an
// added term - not a comparison's operand, a factor, a divisor, a modulus or
// a function's argument - plus every sum of up to three of the expression's
// small added literals (the 0/100/200 an ifelse switches between parallel
// banks with). From each start the bank is walked through the actions the
// character ships: the first within 40 (a bank can begin a few numbers in -
// `36000 + animelemno(0)` starts at 36007; a matchup card `80000 + var(10)*10`
// at 80020), then each next within 20 (a card bank steps by 10).
// `stateTexts`: the lowercased loaded state files; `actions`: the .air's numbers.
function hudRunsOf(stateTexts, actions) {
  const starts = new Set();
  for (const text of stateTexts) {
    let inExplod = false;
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.replace(/;.*$/, '');
      if (/^\s*\[/.test(line)) { inExplod = false; continue; }
      const ty = /^\s*type\s*=\s*(\w+)/.exec(line);
      if (ty) { inExplod = ty[1] === 'explod' || ty[1] === 'modifyexplod'; continue; }
      if (!inExplod) continue;
      const m = /^\s*anim\s*=\s*(.+)$/.exec(line);
      if (!m) continue;
      const ex = m[1].trim();
      if (/^-?\d+$/.test(ex) || /^f/.test(ex)) continue;
      const bases = [], small = [0];
      for (const lit of ex.matchAll(/\d+(?:\.\d+)?/g)) {
        if (lit[0].includes('.')) continue;
        const before = ex.slice(0, lit.index).replace(/\s+$/, '');
        if (/(>=|<=|!=|=|>|<|\*|\/|%)$/.test(before) || /\w\s*\($/.test(before)) continue;
        const v = parseInt(lit[0], 10);
        if (v >= 1000) bases.push(v); else small.push(v);
      }
      if (!bases.length) continue;
      const sums = new Set([0]);
      for (let k = 0; k < 3; k++) for (const s of [...sums]) for (const o of small) sums.add(s + o);
      for (const b of bases) for (const s of sums) starts.add(b + s);
    }
  }
  const out = new Set();
  if (!starts.size) return out;
  const sorted = [...actions].sort((a, b) => a - b);
  // the first action above n (binary search)
  const after = (n) => {
    let lo = 0, hi = sorted.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid] > n) hi = mid; else lo = mid + 1; }
    return lo < sorted.length ? sorted[lo] : null;
  };
  for (const st of starts) {
    let cur = st - 1, reach = 40;
    for (;;) {
      const nx = after(cur);
      if (nx === null || nx > cur + reach) break;
      if (inReceiverRegistry(nx)) out.add(nx);
      cur = nx;
      reach = 20;
    }
  }
  return out;
}
// Inside any known family's ranges (receiver windows or not: DongHwan's
// six-digit series, the Futa brand's flag and tables).
const inAnyHFamily = (n) => H_FAMILIES.some((f) => f.ranges.some(([a, b]) => n >= a && n <= b));
function hFamily(n) {
  for (const f of H_FAMILIES) if (f.ranges.some(([a, b]) => n >= a && n <= b)) return f.name;
  if (KUROMARU_VICTIM_STD.has(n)) return 'Kuromaru victim standard';
  return n >= 100000 ? 'private (six digits or more)' : 'other';
}
// IS THIS AN H NUMBER? (2026-09-09) The giver idiom - SelfAnimExist(N) with a
// ChangeAnim to N nearby - is ALSO how every KOF-style command grab checks
// whether the victim carries the grab's custom-state anim (10050-10052, 15140,
// 26861/26862 ...). Counting those made Dr.Kira (22 hits, all throws) and
// Tomoka (33) givers, and then Iori "Kira's receiver" because he ships 10051.
// So a hit only counts when N is an H number: inside a known receiver window,
// the FutaRB 90k registry, one of Kuromaru's standard victim anims (Batman's
// rape.txt: 6621 if the victim has 19230, else 3631), or a six-digit-plus
// private registry (125234, 180xxx, 1151200...). Measured over 561 characters
// in four H builds: givers 110 -> 91, every drop a throw idiom, no real giver
// lost (DongHwan 83 -> 76 hits, Minotaur 401 -> 306).
const KUROMARU_VICTIM_STD = new Set([3631, 4631, 6621, 6622, 6623]);
const isHNumber = (n) => inReceiverRegistry(n) || (n >= 90000 && n <= 90999)
  || n >= 100000 || KUROMARU_VICTIM_STD.has(n);

// --- characters -----------------------------------------------------------

// Everything a character shipped ALONGSIDE itself: a stage it was made for, and
// any music in the archive. Ported from the browser Studio so the two behave
// the same - it had this and the desktop kit did not, which is exactly the kind
// of split that put health editing in one Studio only.
//
// A STAGE is installed and attached as this character's arcade stage. Detection
// is reliable: a stage def has [BGdef]/[StageInfo] while a storyboard has
// [SceneDef], so isStageDef separates them without guessing.
//
// AUDIO goes to the music library and is attached to nothing. A character's
// bundled audio is usually intro/ending STORYBOARD music, not a battle theme,
// and picking one would be guessing on the user's behalf. Anything under
// ~4 seconds is skipped outright: archives ship sound effects too (this is
// Kung-Fu-Man.zip's 0.46s slap.wav), and a half-second clip is not a track.
// audio-core answers "how long" for both Studios from the same code.
function importBundled(dest, folder, charDefName) {
  const out = { stage: null, tracks: 0, skipped: [] };
  const walk = (d, pre) => {
    const found = [];
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) found.push(...walk(p, pre + e.name + '/'));
      else found.push({ abs: p, rel: pre + e.name });
    }
    return found;
  };
  let all = [];
  try { all = walk(dest, ''); } catch (e) { return out; }

  // --- a bundled stage ------------------------------------------------------
  // Shallowest depth only, for the same reason addStage does it: an archive
  // with a backup/ folder also holds stale copies of these defs.
  const stageDefs = all.filter((f) => /\.def$/i.test(f.rel)
    && f.rel.toLowerCase() !== String(charDefName).toLowerCase()
    && (() => { try { return isStageDef(fs.readFileSync(f.abs, 'latin1')); } catch (e) { return false; } })());
  if (stageDefs.length) {
    const shallow = stageDefs.reduce((m, f) => Math.min(m, f.rel.split('/').length), Infinity);
    for (const sd of stageDefs.filter((f) => f.rel.split('/').length === shallow)) {
      try {
        const r = addStage(sd.abs);
        if (!out.stage && r && r.file) out.stage = 'stages/' + r.file;
      } catch (e) { out.skipped.push('stage ' + path.basename(sd.rel) + ': ' + e.message); }
    }
    // The stage now lives in stages/ under its own name. Leaving the copy inside
    // the character folder doubles a bundled stage's footprint on disk and in
    // the export - only prune a stage that had its OWN subdirectory, since a def
    // loose at the archive root shares the character's folder.
    for (const sd of stageDefs) {
      const slash = sd.rel.lastIndexOf('/');
      if (slash < 0) continue;
      const sub = path.join(dest, sd.rel.slice(0, slash));
      try { rmTree(sub); } catch (e) { /* leave it */ }
    }
  }

  // --- bundled audio --------------------------------------------------------
  for (const f of all) {
    if (!/\.(ogg|mp3)$/i.test(f.rel)) continue;      // addMusic accepts these two
    if (!fs.existsSync(f.abs)) continue;             // may have gone with a pruned stage
    let bytes;
    try { bytes = fs.readFileSync(f.abs); } catch (e) { continue; }
    if (audioCore.isBundledSfx(bytes, f.rel)) {
      out.skipped.push(path.basename(f.rel) + ' (sound effect, '
        + (audioCore.probeDuration(bytes, f.rel) || 0).toFixed(1) + 's)');
      continue;
    }
    try { addMusic(f.abs, path.basename(f.rel)); out.tracks++; }
    catch (e) { /* duplicate name or unsupported: not worth failing the import */ }
  }
  return out;
}

// opts.replaceRandom: see placeInRoster - a full grid gives up its first
// unlocked RandomSelect cell rather than appending past the end.
function addCharacter(srcPath, nameHint, opts) {
  const roster = readRoster();
  const name = slugify(nameHint || path.basename(srcPath, path.extname(srcPath)));
  const folder = name.toLowerCase();
  const dest = path.join(CACHE, folder);
  if (fs.existsSync(dest)) throw new Error(`character folder "${folder}" already exists`);

  if (isArchive(srcPath)) {
    extractZip(srcPath, dest);
  } else if (fs.statSync(srcPath).isDirectory()) {
    fs.cpSync(srcPath, dest, { recursive: true });
  } else {
    throw new Error('character source must be a folder or a .zip, .rar or .7z');
  }

  let defName = findMainDef(dest);
  if (!defName) {
    rmTree(dest);
    throw new Error('no character .def found (needs a [Files] section with cmd=)');
  }
  if (/\s/.test(defName)) {
    const safe = folder + '.def';
    fs.copyFileSync(path.join(dest, defName), path.join(dest, safe));
    defName = safe;
  }

  const displayName = (() => {
    try {
      const kv = parseDefSections(fs.readFileSync(path.join(dest, defName), 'latin1'));
      return reencodeName(kv['displayname'] || kv['name']) || name;
    } catch { return name; }
  })();

  const placed = placeInRoster(roster,
    { folder, select: `${name}/${defName}`, mountAs: name },
    { replaceRandom: !!(opts && opts.replaceRandom) });
  writeRoster(roster);
  // After the character is committed: a bundled stage or track must never
  // cost you the character itself, so each extra is attempted separately.
  const extras = importBundled(dest, folder, defName);
  if (extras.stage) {
    const r2 = readRoster();
    const c2 = r2.chars.find((c) => c.folder === folder);
    if (c2) { c2.stage = extras.stage; writeRoster(r2); }
  }
  // CHECK IT NOW. A character whose sprite or anim cannot be resolved panics the
  // engine at preload (system.go:5459) and takes the whole build down with it,
  // so the moment it lands on disk is the moment to say so - not after export,
  // in front of a player.
  let files = null;
  try { files = checkCharFiles(folder); } catch (e) { files = null; }
  // AND WHAT IT NEEDS THAT IT DID NOT BRING. A character cut out of a build can
  // read files from another character's folder - divesim's
  // `st1 = chars/Dhalsim/States/Normal.st` loads beside Dhalsim and nowhere
  // else - and the engine stops at the first one it cannot open. Properties
  // lists them, but only for someone who opens the character, so the page
  // raises this list the moment the character lands.
  let missingDeps = [];
  try { missingDeps = depsWithOwners(scanMissingDeps(folder, defName)); } catch (e) { missingDeps = []; }
  return { name, folder, defName, displayName, extras, placed, files, missingDeps };
}

// Which character folder a missing file belongs to, when it names one: a path
// under chars/ from the build root (`chars/Dhalsim/States/Normal.st`) or one
// that climbs out of the character's own folder into a sibling
// (`../Dhalsim/States/Normal.st`). `inBundle` is that folder's name on disk when
// this bundle has it (read from the listing: Windows answers an exists check in
// any case, which would echo the def's spelling back), and `inBuild` says whether
// the build already holds it - in the bundle but not the build, adding it is the
// whole answer; in the build, the files are simply not in its folder.
function depsWithOwners(deps) {
  let names = [];
  try { names = fs.readdirSync(CACHE, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); } catch (e) { names = []; }
  let built = new Set();
  try { built = new Set((readRoster().chars || []).flatMap((c) => [c.folder, c.mountAs]).filter(Boolean).map((s) => String(s).toLowerCase())); } catch (e) { built = new Set(); }
  return deps.map((d) => {
    const rel = String(d.rel || '').replace(/\\/g, '/');
    const rooted = /^chars\//i.test(rel) ? rel : path.posix.normalize('chars/_/' + rel);
    const seg = rooted.split('/');
    const owner = seg[0].toLowerCase() === 'chars' && seg.length > 2 && seg[1] !== '_' && seg[1] !== '..' ? seg[1] : null;
    const key = owner ? owner.toLowerCase() : null;
    const inBundle = key ? (names.find((n) => n.toLowerCase() === key) || null) : null;
    return Object.assign({}, d, { owner, inBundle, inBuild: !!key && built.has(key) });
  });
}

// ON DISK BUT NOT IN THE BUILD IS A REAL STATE, and the UI both shows it and
// offers a delete for it. This looked the character up in the roster first and
// threw when it was not there, so deleting one of those could never work -
// kur0maru and tomokaminato are both in that state on this install.
//
// Dropping the roster lookup also drops the validation it was doing by accident,
// and the name arrives from the browser, so it is checked explicitly here: it is
// a single path segment under cache/ and nothing else.
function removeCharacter(folder) {
  const name = String(folder || '');
  if (!name || name === '.' || name === '..' || /[\\/]/.test(name)) {
    throw new Error('bad character name: ' + (name || '(empty)'));
  }
  const dir = path.join(CACHE, name);
  let onDisk = false;
  try { onDisk = fs.statSync(dir).isDirectory(); } catch (e) { onDisk = false; }

  const roster = readRoster();
  // EVERY entry for this folder, not just the first. A character that ships a
  // second .def (a boss build) has one roster slot per version, and leaving one
  // behind would point the build at a folder that is no longer there.
  const idx = roster.chars.findIndex((c) => c.folder === name);
  if (idx === -1 && !onDisk) throw new Error('no such character: ' + name);
  if (idx !== -1) {
    for (let i = roster.chars.length - 1; i >= 0; i--) {
      if (roster.chars[i].folder === name) roster.chars.splice(i, 1);
    }
    writeRoster(roster);
  }
  // Out of the build first, then off the disk. A folder that cannot go (a
  // file another program holds open) is then an ordinary on-disk-only
  // character that can be removed again, never a roster slot pointing at half
  // a folder - and it is said, not reported removed.
  try { rmTree(dir); } catch (e) {
    throw new Error((idx !== -1 ? name + ' is out of the build, but its folder could not be deleted: '
      : 'the folder could not be deleted: ') + e.message);
  }
  return { removed: name, wasInBuild: idx !== -1 };
}

// --- themes (screenpacks) --------------------------------------------------

// A theme is a motif: a folder with a system.def that the engine loads for its
// menus, select screen and lifebars. They come from three places - the v1
// release, the V2 bundle, and themes/ for anything the user drops in - and all
// of them mount under data/, so the engine can't tell them apart and neither
// should the Studio. Discovery is by walking the built VFS index rather than the
// disk, so the list is exactly what the game will be able to load.
const THEMES = layout.dir('themes');

// ONE FOLDER DIRECTLY INSIDE themes/, OR NOTHING. The name arrives from the
// page (remove, layout) and removeTheme deletes recursively, so it is checked
// before it becomes a path: '', '.', '..' or 'a/..' joined onto THEMES is the
// themes folder itself or the bundle above it. Windows adds its own: a colon
// is a drive or a stream, and a trailing dot or space is stripped by Win32's
// path normalization ("x." is "x" to Explorer, not to Node), so a name ending
// in one could mean two folders and is refused. Anything else
// Windows allows in a folder name is allowed, because a screenpack dropped in
// by hand keeps the name it came with. What is left is resolved and must come
// back as exactly that one name under THEMES. Returns the absolute folder, or
// null; whether it exists is the caller's question.
function themeFolderDir(folder, themesDir) {
  if (typeof folder !== 'string' || !folder || folder.length > 255) return null;
  if (/[\\/:*?"<>|\x00-\x1f]/.test(folder) || /[. ]$/.test(folder)) return null;
  const root = path.resolve(themesDir || THEMES);
  const dir = path.resolve(root, folder);
  const rel = path.relative(root, dir);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel) || rel !== folder) return null;
  return dir;
}

function themeName(defText, fallback) {
  const m = /^\s*name\s*=\s*"?([^"\r\n;]+)/mi.exec(defText || '');
  return (m && m[1].trim()) || fallback;
}

// A motif with no sprite file can't be drawn, so it isn't offered - the kfm one
// that ships with the engine has no system.sff at all.
//
// TrueType is deliberately NOT checked here. Several shipped motifs reference a
// TrueType font (mugen1 and big both want mssansserif-tt36, and Open_Sans is one
// too), and the browser build has no FreeType - but so does ikemen1, the motif
// that has been in use all along. Fonts load lazily, so referencing one is
// harmless until something draws with it. The browser build now skips them with
// a warning instead of taking the engine down, which is what makes these safe to
// list; excluding by reference would have banned the default.
// A MOTIF IS OFFERED ONLY IF IT CAN BOOT, and `spr` alone was never that test.
//
// Checking the sprite and nothing else let a pack through that dies on the
// NEXT file it opens. Legacy_IKEMEN resolves its sprite and then declares
// `fight = data/Legacy/fight.def`, which is not in it - the engine gets as far
// as main.lua:1186 and stops with 'Can't load fight screen'. Offering that is
// worse than not offering it at all: a pack nobody can pick is an absence, and
// a pack that boots into a modal error is a broken build.
//
// `snd` is NOT in the gate, and that is measured rather than assumed: the
// engine's own `big` and `mugen1` both declare `snd = system.snd` which is not
// in the index, and gating on it would have excluded the motif this build is
// actually using. `select` is not in it either - addTheme repoints every pack
// at the generated roster, so it never lives inside the pack.
const THEME_BOOT_KEYS = ['spr', 'fight'];

function themeBootMissing(defText, folder, have) {
  const base = folder ? `data/${folder}/` : 'data/';
  // WHAT THE EXPORTED GAME HAS, NOT ONLY THE STUDIO. The index holds every
  // installed pack and every engine folder, but an export carries one pack:
  // the website keeps only the chosen theme (themesKeep), the desktop copies
  // only data/<chosen> beside the engine zip, which has no mugen1/. So a
  // shared file counts only directly in data/ (the engine's own data/fight.def,
  // in both) or in the pack's own folder; `fight = data/Legacy/fight.def`
  // found in another installed folder worked in the Studio and stopped the
  // exported game at startup.
  const own = base.toLowerCase();
  const shipped = (vp) => /^data\/[^/]+$/.test(vp) || (!!folder && vp.startsWith(own));
  const missing = [];
  for (const key of THEME_BOOT_KEYS) {
    const m = new RegExp('^[ \\t]*' + key + '[ \\t]*=[ \\t]*([^\\r\\n;]+)', 'mi')
      .exec(defText || '');
    // Not declared at all is a different thing from declared and absent: only
    // `spr` is required outright, and a motif without one cannot be drawn.
    if (!m) { if (key === 'spr') missing.push({ key, path: '(not declared)', why: themeBootWhy(key, null, folder) }); continue; }
    const rel = m[1].trim().replace(/"/g, '').split('\\').join('/');
    // THE ENGINE LOOKS IN THE MOTIF'S OWN FOLDER, THEN THE GAME FOLDER, THEN
    // data/ (motif.go: lookup "def,,data/" - the empty entry is the game
    // folder; fightscreen.go resolvePath searches the same three), and all
    // three are legitimate. ikemen1 declares a bare `fight = fight.def` that
    // lives at data/fight.def beside the motif folders rather than inside
    // ikemen1, so checking only the pack refused the V2 motif. EVEREDUX
    // declares `fight =data/fight.def`: that is the engine's own lifebars,
    // found from the game folder, and leaving that place out refused a pack
    // the engine boots.
    const inPack = path.posix.normalize(base + rel).toLowerCase();
    const atGame = path.posix.normalize(rel).toLowerCase();
    const atRoot = path.posix.normalize('data/' + rel).toLowerCase();
    // ...but the fallback is for SHARED files only. `spr` is the motif's own
    // identity: letting it resolve at the root made kfm pass on the DEFAULT
    // motif's system.sff, and kfm - which ships no sprite file at all - has
    // been deliberately kept off this list since the check was written. Only
    // widen what had to be widened.
    const ok = key === 'spr' ? have.has(inPack)
      : (have.has(inPack) || [atGame, atRoot].some((vp) => have.has(vp) && shipped(vp)));
    const elsewhere = !ok && key !== 'spr' && [atGame, atRoot].some((vp) => have.has(vp));
    if (!ok) missing.push({ key, path: rel, why: themeBootWhy(key, rel, folder, elsewhere) });
  }
  return missing;
}

// What a refused pack lacks and what the engine does about it, in plain words
// for the Theme tab and E-Select's Open Motif. A missing fight screen stops the
// game at startup (main.lua:1186 'Can't load fight screen'); without its
// sprite file none of its screens can be drawn. `elsewhere`: the fight def is
// in the Studio, but only in a folder an export leaves out.
function themeBootWhy(key, rel, folder, elsewhere) {
  if (key === 'spr') {
    return rel === null ? 'it names no picture file for its screens (spr), so none of them can be drawn'
      : 'the picture file for its screens (spr = ' + rel + ') is not in ' + (folder ? 'its folder' : 'data/') + ', so none of them can be drawn';
  }
  if (elsewhere) {
    return 'its fight screen (fight = ' + rel + ') is only in another folder under data/, which an export leaves out,'
      + ' and the exported game would stop at startup with "Can\'t load fight screen"';
  }
  return 'its fight screen (fight = ' + rel + ') is not in ' + (folder ? 'its folder, the game folder or data/' : 'the game folder or data/')
    + ', and the game stops at startup with "Can\'t load fight screen" when that file is missing';
}

// A PACK CAN NAME AN ANIMATION IT NEVER DEFINES, AND NOTHING SAYS SO.
//
// Gear asks for `p1.teammenu.item.cursor.anim = 180` and `p2... = 190` and
// defines neither: its system.def carries four actions, 830/835/200/900. The
// engine draws what it was given, which is nothing, so TEAM MODE comes up with
// no cursor on either side and the pack looks like the Studio broke it.
// Legacy_IKEMEN names the same two numbers and DOES define them
// (`[Begin Action 180] ;P1 Team mode cursor`), which is why its cursor is there.
//
// This is not a reason to refuse a pack. Everything else about Gear works, and
// an author is allowed to ship without a cursor. It is a reason to SAY SO, once,
// instead of leaving someone to work out which of the two of us dropped it.
//
// Sprites are deliberately not checked the same way: a `.spr` reference is
// resolved out of the SFF at draw time and a missing one shows up as a missing
// picture, whereas an animation that was never declared leaves no trace at all.
//
// ONLY THE ANIMATIONS A MOTIF ACTUALLY OWNS. A first cut reported every
// undefined `.anim` and immediately called Legacy_IKEMEN - a pack that works -
// incomplete three times over, because `p1.face.anim` and `stage.portrait.anim`
// name art belonging to the CHARACTER and the STAGE. A motif never defines
// those and is not supposed to.
//
// The list below is measured, not guessed: every `.anim` key across the seven
// motifs in this tree (Legacy_IKEMEN, Gear_d, and the engine's own big, kfm,
// mugen1, data and ikemen1), split by whether any motif defines it in its own
// system.def. These fourteen families are defined by motifs; the five that are
// not - p*.anim, p*.done.anim, p*.face.anim, p*.face.done.anim and
// stage.portrait.anim - are content art and are excluded.
//
// The list errs towards silence on purpose. A family missing from it means one
// real fault goes unreported; a family wrongly IN it means someone is told a
// working pack is broken, which is the worse trade and the exact mistake the
// half-cell portrait badge already made.
const MOTIF_OWNED_ANIM =
  /^(?:p\d+\.)?(?:teammenu\.item\.cursor|cursor\.active|cursor\.done|bg|palmenu\.bg|face\.random|counter|stage\.portrait\.bg|loading(?:\.done|\.wait)?)\.anim$/i;

function themeMissingAnims(defText) {
  const text = String(defText || '');
  const defined = new Set();
  for (const m of text.matchAll(/\[[ \t]*Begin[ \t]+Action[ \t]+(\d+)[ \t]*\]/ig)) {
    defined.add(m[1]);
  }
  const missing = new Map();
  for (const m of text.matchAll(/^[ \t]*([A-Za-z0-9_.]*\.anim)[ \t]*=[ \t]*(-?\d+)/img)) {
    // -1 is the motif convention for "nothing here", not a reference.
    if (m[2] === '-1' || defined.has(m[2])) continue;
    if (!MOTIF_OWNED_ANIM.test(m[1])) continue;
    if (!missing.has(m[2])) missing.set(m[2], m[1]);
  }
  return [...missing].map(([anim, key]) => ({ anim: +anim, key }));
}

// THE HOIST MOVES THE FILES AND `spr=` STILL POINTS AT THE OLD SHAPE.
//
// addTheme hoists the chosen motif's folder to the top of the pack, and
// repoints `select=` and the bgm lines afterwards - but not `spr=`. A pack
// whose sprite path was written relative to the ENGINE ROOT rather than to
// itself therefore dangles the moment it is installed. Legacy_IKEMEN declares
// `spr = data/legacy/system.sff`, written by an author who expects the pack to
// live at data/legacy/; we mount it at data/Legacy_IKEMEN/ and hoist its
// contents to the root, so the file is at data/Legacy_IKEMEN/system.sff and the
// declared path resolves to data/Legacy_IKEMEN/data/legacy/system.sff, which
// exists nowhere.
//
// The cost of that is total and silent: themeSprResolves drops the motif from
// listThemes, setTheme then refuses it as 'no such theme', and the pack sits
// installed, mounted and unreachable with nothing said. The engine would fail
// the same way, so repointing the LINE is the fix - resolving it more cleverly
// here would only have listed a motif the engine still cannot draw.
//
// Conservative on purpose: it only acts when the declared path is missing, it
// only looks for the same FILENAME, and it prefers the shallowest match, so a
// pack that is already correct is never touched.
// EVERY PATH THE HOIST BROKE, not just `spr`.
//
// addTheme lifts the chosen motif's folder to the top of the theme, so a
// reference written relative to the pack's data/ root keeps a segment that no
// longer exists. ICA_GO declares ten fonts as `ikemen1/ICA_fonts/X.def` and its
// motif lived at data/ikemen1/ - after the hoist every one of those paths is
// dead while every file sits one level up, and Ikemen draws a menu with no text
// on it. `spr` was repaired here from the start; nothing else was, so a pack
// whose art happened to resolve still lost its entire font set.
//
// RESOLVED BY STRIPPING LEADING SEGMENTS FIRST, which is precisely what the
// hoist did, before falling back to a search by filename. The suffix walk is
// both cheaper and safer: this theme has three font folders (font/, fonts/,
// ICA_fonts/) and a bare basename match across them could pick the wrong
// `default.def`.
// `snd` IS DELIBERATELY NOT HERE. In [Files] it is a path (system.snd), but
// elsewhere in a motif `snd = 500,0` is a SOUND CUE - a group,index pair, not
// a filename - and this runs over the whole file with no section awareness.
// spr and fontN are unambiguous; snd is not, and it is not worth the risk.
const THEME_PATH_KEYS = /^([ \t]*(?:spr|font\d+)[ \t]*=[ \t]*)([^\r\n;]+?)([ \t]*)(;.*)?$/gmi;

function repairThemeRefs(dir, text) {
  let index = null;                       // built lazily; most packs need no search
  const byBase = () => {
    if (index) return index;
    index = new Map();
    const walk = (rel, depth) => {
      if (depth > 3) return;
      let ents = [];
      try { ents = fs.readdirSync(path.join(dir, rel), { withFileTypes: true }); } catch (e) { return; }
      for (const e of ents) {
        const r = rel ? rel + '/' + e.name : e.name;
        if (e.isFile()) {
          const k = e.name.toLowerCase();
          if (!index.has(k)) index.set(k, r);   // shallowest wins, as before
        } else walk(r, depth + 1);
      }
    };
    walk('', 0);
    return index;
  };

  return text.replace(THEME_PATH_KEYS, (whole, head, value, pad, comment) => {
    const declared = value.trim().replace(/"/g, '').split('\\').join('/');
    if (!declared || fs.existsSync(path.join(dir, declared))) return whole;
    const segs = declared.split('/').filter(Boolean);
    // Drop one leading segment at a time: `ikemen1/ICA_fonts/X.def` -> `ICA_fonts/X.def`.
    for (let i = 1; i < segs.length; i++) {
      const cand = segs.slice(i).join('/');
      if (fs.existsSync(path.join(dir, cand))) {
        return head + cand + (pad || '') + (comment || '');
      }
    }
    const hit = byBase().get(segs[segs.length - 1].toLowerCase());
    return hit ? head + hit + (pad || '') + (comment || '') : whole;
  });
}

// `unusable` collects what was refused, so the Studio can say WHY a pack it
// can see is not on the menu. A silent drop is what let this hide in the first
// place.
function listThemes(unusable, vfs) {
  const { index, generated } = vfs || require('./vfslib').build();
  const have = new Set([...index.keys()].map(s => s.toLowerCase()));
  const out = [];
  for (const [vpath, abs] of index) {
    const m = /^data\/(?:([^/]+)\/)?system\.def$/i.exec(vpath);
    if (!m) continue;
    // A generated motif has no file on disk (index value null) - its content
    // lives in `generated`. Reading only from disk left `text` empty, so the
    // spr= check below found nothing and DROPPED the motif from the list. That
    // hid data/ikemen1/system.def, the motif actually in use, and the Studio
    // then reported the configured theme as "missing - will fall back".
    let text = '';
    try {
      if (abs) text = fs.readFileSync(abs, 'latin1');
      else if (generated && generated[vpath] != null) {
        const g = generated[vpath];
        text = Buffer.isBuffer(g) ? g.toString('latin1')
          : (g instanceof Uint8Array ? Buffer.from(g).toString('latin1') : String(g));
      }
    } catch { /* unreadable: leave empty and let the spr= check drop it */ }
    const folder = m[1] || '';
    const missing = themeBootMissing(text, folder, have);
    if (missing.length) {
      if (unusable) {
        unusable.push({
          // The vpath too, so a list of both kinds (E-Select's Open Motif)
          // can key every row the same way.
          path: vpath,
          folder,
          name: themeName(text.slice(0, 4096), folder || 'Default'),
          custom: !!folder && fs.existsSync(path.join(THEMES, folder)),
          missing,
        });
      }
      continue;
    }
    out.push({
      path: vpath,
      folder,
      // data/system.def with no folder is the official release screenpack
      name: themeName(text.slice(0, 4096), folder || 'Default'),
      custom: !!folder && fs.existsSync(path.join(THEMES, folder)),
      missingAnims: themeMissingAnims(text),
      // Team faces in per-member keys the engine does not read; the build's
      // copy carries them in its own keys (motifcompat.js). The Theme tab says so.
      // Read off the INSTALLED file: the build's generated motif already carries the fix.
      memberFaces: (() => { try { return !!folder && require('./motifcompat.js').needsMemberFaces(fs.readFileSync(path.join(THEMES, folder, 'system.def'), 'latin1')); } catch (e) { return false; } })(),
    });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

// SWITCHING SCREENPACK ALSO SWITCHES ITS SLOT LAYOUT.
//
// A pack decides which of its cells are usable, so the layout belongs to the
// pack and not to the roster - and it has to be taken OFF again when the pack
// changes, or the next one inherits the last one's reserved blocks. LEGACY
// keeps two columns clear for its portrait panels; carry those into a pack that
// has no panels there and they are just holes punched through the middle of the
// grid for no reason.
//
// So the previous pack's skipslots are dropped and the new pack's are applied,
// both automatically. `layoutFrom` records whose layout the roster is currently
// wearing, which is what makes the removal safe: skipslots the USER placed by
// hand are left alone, because a roster with no `layoutFrom` never had one
// imported.
function setTheme(motifPath) {
  const roster = readRoster();
  if (!motifPath) delete roster.motif;
  else {
    if (!listThemes().some(t => t.path.toLowerCase() === motifPath.toLowerCase())) {
      throw new Error('no such theme: ' + motifPath);
    }
    roster.motif = motifPath;
  }
  const folder = String(roster.motif || '').replace(/^data\//, '').split('/')[0];
  const worn = roster.layoutFrom || null;
  let changed = false;
  if (worn && worn !== folder) {
    // A LOCKED skipslot stays: E-Select's lock (Preferences › Lock cells)
    // means "this cell is not to move or change", and it was set on purpose
    // by the user, whoever's layout put the skipslot there first.
    // (applyThemeLayout, asked for explicitly, still rearranges everything.)
    roster.chars = (roster.chars || []).filter((c) => c.kind !== 'skip' || motifCore.isLockOn(c.locked));
    delete roster.layoutFrom;
    changed = true;
  }
  writeRoster(roster);
  // Applied after the write so it reads the motif we just set.
  let applied = null;
  if (folder && roster.layoutFrom !== folder) {
    const l = themeLayout(folder);
    if (l && l.holes > 0 && l.usable > 0) applied = applyThemeLayout(folder);
  }
  return { motif: roster.motif || null, layoutCleared: changed, layout: applied };
}

// When a pack's motif lives in a subfolder we hoist just that folder (see
// addTheme), which used to discard the pack's parent-data/ storyboards - a
// motif's intro/logo/gameover .def stayed referenced but its .sff/.mp3 art was
// dropped, so the storyboard rendered as a blank white screen. This carries
// each referenced storyboard .def + its assets into the hoisted theme at the
// path where the motif's reference resolves (engine lookup "def,,data/", so a
// ref R lands at <theme>/R and its assets beside the def). File lookups are
// case-insensitive but writes use the NAME the .def references, which also
// repairs case mismatches (e.g. def says Gameover.sff, file is GameOver.sff)
// that a case-sensitive web VFS would otherwise miss.
function carryStoryboards(fullDir, motifDefRel, stageDir) {
  let sysText;
  try { sysText = fs.readFileSync(path.join(fullDir, motifDefRel), 'latin1'); }
  catch { return; }
  const motifDir = path.posix.dirname(motifDefRel.replace(/\\/g, '/'));
  // resolve a char-relative path inside fullDir, ignoring case; returns abs path or null
  const findCI = (relPath) => {
    let cur = fullDir;
    for (const part of relPath.split('/').filter(p => p && p !== '.')) {
      let ents; try { ents = fs.readdirSync(cur, { withFileTypes: true }); } catch { return null; }
      const hit = ents.find(e => e.name.toLowerCase() === part.toLowerCase());
      if (!hit) return null;
      cur = path.join(cur, hit.name);
    }
    return cur;
  };
  const copyOnce = (src, dest) => {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (!fs.existsSync(dest)) fs.copyFileSync(src, dest);
  };
  for (const line of sysText.split(/\r?\n/)) {
    const m = /^\s*[\w.]*storyboard\s*=\s*([^\r\n;]+?)\s*(;.*)?$/i.exec(line);
    if (!m || !m[1].trim()) continue;
    const R = m[1].trim().replace(/"/g, '').replace(/\\/g, '/');
    if (!/\.def$/i.test(R)) continue;
    // find the source def: ref is relative to pack root, the motif dir, or data/
    let srcRel = null;
    for (const c of [R, (motifDir === '.' ? R : motifDir + '/' + R), 'data/' + R]) {
      if (findCI(c)) { srcRel = c; break; }
    }
    if (!srcRel) continue;
    copyOnce(findCI(srcRel), path.join(stageDir, R)); // def lands where the ref resolves
    // carry the def's own assets, named as the def references them
    let defText; try { defText = fs.readFileSync(findCI(srcRel), 'latin1'); } catch { continue; }
    const srcDefDir = path.posix.dirname(srcRel);
    const rDir = path.posix.dirname(R);
    for (const dl of defText.split(/\r?\n/)) {
      // `path` IS THE VIDEO KEY. A storyboard scene with `type = video` names
      // its file with `path =`, not `spr`, so a video intro's asset was never
      // carried and the pack shipped a .def pointing at nothing - which the
      // engine renders as a BLACK SCREEN for the scene's whole end.time and
      // reads to a player as the game having frozen.
      const am = /^\s*(?:spr|bgm|music|snd|model|path)\s*=\s*([^\r\n;]+?)\s*(;.*)?$/i.exec(dl);
      if (!am || !am[1].trim()) continue;
      const asset = am[1].trim().replace(/"/g, '').replace(/\\/g, '/');
      // SEARCHED THE WAY THE ENGINE SEARCHES. stage.go:209 loads a video with
      // `LoadFile(&path, []string{def, "", "data/"}, "video/")`, and SearchFile
      // tries each root both bare and with the default subdirectory - so a
      // bare `ik_logo.webm` legitimately lives at <pack>/video/ik_logo.webm.
      // Resolving only against the def's own folder found none of them.
      let aSrc = null, keep = null;
      const bases = [srcDefDir === '.' ? '' : srcDefDir + '/', '', 'data/'];
      for (const base of bases) {
        for (const sub of ['', 'video/']) {
          const cand = base + sub + asset;
          const hit = findCI(cand);
          if (hit) {
            aSrc = hit;
            // Keep the sub-path that made it resolve, so the copy lands where
            // the def's own reference will find it again inside the theme.
            keep = sub + asset;
            break;
          }
        }
        if (aSrc) break;
      }
      if (!aSrc) continue; // asset genuinely absent (e.g. an intro.mp3 the pack never shipped)
      copyOnce(aSrc, path.join(stageDir, rDir === '.' ? keep : rDir + '/' + keep));
    }
  }
}

// THE FILES THE MOTIF NAMES THAT DO NOT LIVE IN THE MOTIF'S OWN FOLDER.
//
// carryStoryboards covers the intro/logo/gameover cutscenes. This covers
// everything else a motif declares - its sprite file, its sound file, its
// fight screen, its fonts - because a full-install screenpack is free to keep
// any of them OUTSIDE the folder the hoist keeps, and the engine found them
// there through its own lookup roots (motif.go `lookup:"def,,data/"`, plus a
// `font/` probe per root at font.go:413, common.go:660-681).
//
// Measured on a full MUGEN 1.1 build whose motif sits at data/<pack>/: the
// motif declares `spr = system.sff` and `snd = system.snd`, both of which are
// its PARENT data/ folder's files, and nine of its fonts as `fonts/X.def`,
// which is the parent's fonts/ folder. The hoist discards all of them. None of
// it is reported: the engine would then resolve `system.sff` against ITS OWN
// data/ and draw another pack's art, and a font it cannot load is simply a
// screen with no text on it (§3.5c).
//
// So each declared path is resolved the way the engine resolved it IN THE
// SOURCE PACK, and anything that lands outside the hoisted folder is copied
// into the theme AT THE NAME THE DECLARATION USES - which is the one place the
// engine will look for it once the theme is mounted, and which also leaves
// repairThemeRefs nothing to repair.
//
// ONLY VALUES THAT NAME A FILE. A motif is full of keys whose value is not a
// path - `snd = 500,0` is a sound CUE, `spr` in a [Begin Action] frame is a
// sprite pair - so a value is only followed when it ends in an extension a
// screenpack actually ships. That is the same judgment §3.5c makes when it
// keeps `snd` out of repairThemeRefs' rewrite list, reached from the other
// side: copying a file is safe where rewriting a line is not.
const MOTIF_REF_EXT = /\.(sff|snd|def|fnt|ttf|otf|mp3|ogg|wav|webm|cns|air|zss|lua)$/i;

// `opts.mugenFonts`: the pack is a MUGEN install (the whole-build import of a
// MUGEN build), so a `fontN` is first looked for the way MUGEN looked for it:
// the def's folder, the game folder, data/, then the game folder's font/ -
// never a font/ beside the def. A data-root motif (motif = data/system.def)
// can hold one name twice: its select screen's `Names.fnt` is font/Names.fnt
// at the game root, its fight def's `data/font/Names.fnt` another font. The
// hoist makes data/font/ the theme's font/, which Ikemen searches for the bare
// name first, so the select screen drew the lifebar font (§3.5c).
function carryMotifRefs(fullDir, motifDefRel, stageDir, opts) {
  const mugenFonts = !!(opts && opts.mugenFonts);
  const motifRel = motifDefRel.replace(/\\/g, '/');
  const motifDir = path.posix.dirname(motifRel);
  const inMotif = (rel) => motifDir !== '.' && (rel + '/').toLowerCase().startsWith(motifDir.toLowerCase() + '/');
  // Case-insensitive resolve of a pack-relative path, the way the engine's
  // FileExist glob does it (§4.13). Returns the path as it really is on disk.
  const findCI = (relPath, base) => {
    let cur = base || fullDir, real = '';
    for (const part of relPath.split('/').filter((p) => p && p !== '.')) {
      if (part === '..') return null;
      let ents; try { ents = fs.readdirSync(cur, { withFileTypes: true }); } catch (e) { return null; }
      const hit = ents.find((e) => e.name.toLowerCase() === part.toLowerCase());
      if (!hit) return null;
      cur = path.join(cur, hit.name);
      real = real ? real + '/' + hit.name : hit.name;
    }
    return { abs: cur, rel: real };
  };
  const carried = [];
  const seen = new Set();
  const join = (dir, rel) => (dir ? dir + '/' + rel : rel);
  // `srcRel` is the def being read, as a pack-relative path; `destDir` is the
  // folder that def occupies INSIDE the theme once the hoist has run. A
  // reference is resolved from the def's own source folder outwards and lands
  // beside the def in the theme, because that is the first root the engine
  // tries for it in both places.
  const follow = (srcRel, destDir, depth) => {
    // KEYED BY BOTH ENDS. One source def can legitimately be carried to two
    // places - a font the motif names as `fonts/name.def` and the fight screen
    // names as `data/fonts/name.def` lands beside each of them, and its own
    // `File = name.sff` has to follow it to both. Keying by the source alone
    // carried the sprite to whichever one was reached first and left the other
    // font unable to load, which draws as a screen with no text on it (§3.5c).
    const key = srcRel.toLowerCase() + '|' + destDir.toLowerCase();
    if (depth > 3 || seen.has(key)) return;
    seen.add(key);
    let text;
    try { text = fs.readFileSync(path.join(fullDir, srcRel), 'latin1'); } catch (e) { return; }
    const from = path.posix.dirname(srcRel.replace(/\\/g, '/'));
    for (const line of text.split(/\r?\n/)) {
      const m = /^\s*([\w.]+)\s*=\s*([^\r\n;]+?)\s*(;.*)?$/.exec(line);
      if (!m) continue;
      const ref = m[2].trim().replace(/"/g, '').replace(/\\/g, '/');
      if (!ref || !MOTIF_REF_EXT.test(ref) || ref.startsWith('/') || ref.includes('..')) continue;
      const fromBase = from === '.' ? '' : from + '/';
      let src = null, keep = null;
      // A MUGEN install's font, MUGEN's way first (see above).
      if (mugenFonts && /^font\d+$/i.test(m[1])) {
        for (const [base, sub] of [[fromBase, ''], ['', ''], ['data/', ''], ['', 'font/']]) {
          const hit = findCI(base + sub + ref);
          if (hit) { src = hit; keep = join(destDir, sub + ref); break; }
        }
      }
      // The engine's roots, in its order, each also probed under font/.
      if (!src) {
        for (const base of [fromBase, '', 'data/']) {
          for (const sub of ['', 'font/', 'fonts/']) {
            const hit = findCI(base + sub + ref);
            if (hit) { src = hit; keep = join(destDir, sub + ref); break; }
          }
          if (src) break;
        }
      }
      if (!src) continue;
      // Already inside the folder the hoist keeps: it survives on its own, and
      // keeps the path it has - but a .def in there can still name something
      // outside, so it is still followed.
      const survives = inMotif(src.rel);
      if (survives) {
        keep = src.rel.slice(motifDir === '.' ? 0 : motifDir.length + 1);
        // ...unless the declaration no longer reaches it. A data-root motif's
        // fight def names `data/font/Names.fnt` from the GAME folder; the hoist
        // keeps the file (as font/Names.fnt) but nothing the engine tries from
        // the def - its folder, the motif's, the game's, data/, each with
        // font/ - spells that path any more, and the lifebar draws no text.
        // A copy goes where the declaration points, beside the def.
        const reach = [join(destDir, ref), join(destDir, 'font/' + ref), ref, 'font/' + ref];
        if (!reach.some((r) => findCI(r, stageDir))) {
          const at = join(destDir, ref);
          const dest = path.join(stageDir, at);
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          fs.copyFileSync(src.abs, dest);
          carried.push(at);
          // A font .def copied there needs what it names beside it too.
          if (/\.def$/i.test(src.rel)) follow(src.rel, path.posix.dirname(at), depth + 1);
        }
      } else {
        let dest = path.join(stageDir, keep);
        // A different file already holds that name in the theme (the hoisted
        // data/font/Names.fnt where the game folder's font/Names.fnt wants to
        // go): the def's own folder is searched before its font/, so the file
        // the declaration means goes there.
        const alt = join(destDir, ref);
        if (mugenFonts && keep !== alt && fs.existsSync(dest) && !findCI(alt, stageDir)
          && !fs.readFileSync(dest).equals(fs.readFileSync(src.abs))) { keep = alt; dest = path.join(stageDir, keep); }
        if (!fs.existsSync(dest)) {
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          fs.copyFileSync(src.abs, dest);
          carried.push(keep);
        }
      }
      if (/\.def$/i.test(src.rel)) follow(src.rel, path.posix.dirname(keep) === '.' ? '' : path.posix.dirname(keep), depth + 1);
    }
  };
  follow(motifRel, '', 0);
  return carried;
}

// NO NETWORK GRAFT. A MUGEN-era screenpack defines its own [Title Info] menu
// and predates online play. The installer used to graft a NETWORK entry onto
// that menu, and a title menu drawn as art, one item at a time or with blank
// item text left it invisible or unreachable. Online play is the online menu
// add-on's now (netmenu.js: PRESS N FOR ONLINE on every title, both exports),
// the build's copy of a pack carries the hidden lobby group the engine needs
// (motifcompat.serverGroup), and patchInstalledMotif drops an older install's
// graft (motifcompat.dropNetworkGraft). GRAIL §3.6 item 5.

// ---- Startup logo -----------------------------------------------------------
//
// The boot storyboard is one of the things a manager like this has to let you
// replace. Content/<bundle>/logo/ (layout.dir('logo')) holds a storyboard .def
// and whatever art it names; both exports put those files in the active
// screenpack's folder and point logo.storyboard at the .def. Absent = the
// screenpack's own logo - which for a DESKTOP export is the ENGINE's, never the
// web build's: release-v2/data/ikemen1 is the web's copy of the engine
// screenpack, with the engine's video logo (ik_logo.webm) swapped for a sprite
// one (logo.def + logo.sff) because a browser cannot play the video, and
// desktop.js used to copy that folder wholesale. See desktop.js.
const LOGO = layout.dir('logo');

function logoInfo() {
  if (!fs.existsSync(LOGO)) return { custom: false };
  const files = fs.readdirSync(LOGO).filter((f) => fs.statSync(path.join(LOGO, f)).isFile());
  const def = files.find((f) => /\.def$/i.test(f));
  if (!def) return { custom: false };
  return { custom: true, def, files, dir: LOGO };
}

function addLogo(srcPath, origName) {
  const tmp = LOGO + '.new';
  rmTree(tmp);
  // AN IMAGE IS THE NORMAL CASE. Requiring a storyboard .def was the wrong shape
  // for this feature: a .def describing fades and timings is something nobody
  // has lying around, while everybody has the picture they want on screen.
  // logogen writes both halves from the image (logogen.js), embedding the PNG
  // whole so alpha survives.
  if (/\.png$/i.test(srcPath) && fs.statSync(srcPath).isFile()) {
    rmTree(LOGO);
    const made = logogen.makeLogo(srcPath, LOGO);
    // The caller's name, not the temp file's - bufferToTemp mangles it into
    // mugen-upload-<ms>-<slug>.png, which is not what the user dropped.
    return { ...logoInfo(), generated: true, source: origName || path.basename(srcPath), w: made.w, h: made.h, scale: made.scale };
  }
  if (/\.(jpe?g|gif|bmp|webp|tga)$/i.test(srcPath)) {
    throw new Error('that is a ' + path.extname(srcPath).replace('.', '').toUpperCase()
      + ' - save it as a .png first. The logo is embedded in the sprite file exactly '
      + 'as given, and only PNG is stored that way.');
  }
  if (isArchive(srcPath)) extractZip(srcPath, tmp);
  else if (fs.statSync(srcPath).isDirectory()) fs.cpSync(srcPath, tmp, { recursive: true });
  else throw new Error('a startup logo is a .png image, or a folder (or a .zip, .rar or .7z) holding a storyboard .def and its art');
  // A zip or folder with ONE folder inside: that is the logo.
  let root = tmp;
  const top = fs.readdirSync(root);
  if (top.length === 1 && fs.statSync(path.join(root, top[0])).isDirectory()) root = path.join(root, top[0]);
  if (!fs.readdirSync(root).some((f) => /\.def$/i.test(f))) {
    rmTree(tmp);
    throw new Error('no storyboard .def in that folder - a startup logo needs one (any Ikemen screenpack\'s logo.def is the shape)');
  }
  rmTree(LOGO);
  fs.cpSync(root, LOGO, { recursive: true });
  rmTree(tmp);
  return logoInfo();
}

function removeLogo() {
  rmTree(LOGO);
  return { custom: false };
}

// WHAT THE INSTALLER DOES TO A PACK'S system.def, as one function, because a
// screenpack option switch (themeopts.choose) writes a new system.def into an
// installed theme and it has to come out the way an install would have left
// it. `name` is the theme folder. Runs on text, returns text; the folder is
// read only to repair paths (repairThemeRefs).
//   - `select =` repointed at the generated roster (§3.6 item 1);
//   - `sound/...` and `music/...` bgm lines repointed at the mount (item 3);
//   - a bgm line written for the pack's own install folder, data/<X>/<rest>,
//     repointed at data/<name>/<rest> when <rest> is in the theme and X is not
//     already the name (a split pack: cvs2 says data/cvs2/sound/title.mp3 and
//     is installed as another folder) - only for a pack with options or common
//     states of its own: `opts.dataBgm: false` (an install without a manifest)
//     leaves those lines as they were, so an ordinary pack installs as before;
//   - an older install's grafted NETWORK lines dropped (item 5), and the paths
//     the hoist broke repaired.
// Every step leaves a line alone that is already right, so it can run again
// over a file it already ran over.
function patchInstalledMotif(themeDir, name, text, opts) {
  const own = String(name || '').toLowerCase();
  const dataBgm = !(opts && opts.dataBgm === false);
  const patched = require('./motifcompat.js').dropNetworkGraft(String(text).replace(/^(\s*select\s*=\s*).+$/mi, '$1data/select.def')
    // BGM paths are opened literally, not searched - repoint the pack's own
    // music at the mount, where the sound/ sibling now lives.
    .replace(/^(\s*[\w.]*bgm\s*=\s*)((?:sound|music)\/[^\r\n;]+)/gmi, `$1data/${name}/$2`)
    .replace(/^(\s*[\w.]*bgm\s*=\s*)data\/([^\/\r\n;]+)\/([^\r\n;]+?)([ \t]*)(?=;|\r?$)/gmi, (whole, head, x, rest, pad) => {
      const want = rest.trim().replace(/\\/g, '/');
      if (!dataBgm || x.toLowerCase() === own || want.split('/').includes('..')) return whole;
      const hit = resolveCI(themeDir, want);
      let isFile = false;
      try { isFile = !!hit && fs.statSync(hit).isFile(); } catch (e) { isFile = false; }
      // The disk's spelling: the web's file index is case-sensitive.
      return isFile ? head + 'data/' + name + '/' + path.relative(themeDir, hit).split(path.sep).join('/') + pad : whole;
    }));
  // ...and repoint `spr=` if the hoist left it dangling.
  return repairThemeRefs(themeDir, patched);
}

// `opts.themesDir` installs into ANOTHER bundle's themes folder instead of the
// active one - the whole-build import writes a bundle it is not editing
// (buildimport.js). Everything else about the install is identical, which is
// the point: there is one screenpack installer and the Survival Guide rules
// (§3.6) live in it once.
function addTheme(srcPath, nameHint, opts) {
  const themesDir = (opts && opts.themesDir) || THEMES;
  fs.mkdirSync(themesDir, { recursive: true });
  const name = slugify(nameHint || path.basename(srcPath, path.extname(srcPath)));
  const dest = path.join(themesDir, name);
  if (fs.existsSync(dest)) throw new Error(`theme "${name}" already exists`);

  if (isArchive(srcPath)) extractZip(srcPath, dest);
  else if (fs.statSync(srcPath).isDirectory()) fs.cpSync(srcPath, dest, { recursive: true });
  else throw new Error('a theme must be a folder or a .zip, .rar or .7z');

  // Full-install packs bundle SEVERAL system.defs: their real motif plus
  // Mugen's stock ones (kfm, mugen1, big - stock data/system.def included), so
  // "find one" picked the stock blue theme on a field-tested pack whose skin
  // lived in data/mugen1/. Choose the way Mugen would: the motif mugen.cfg
  // names, else a def whose header isn't Elecbyte's stock, breaking ties by
  // who has the biggest art.
  const walk = (d, base, out) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p, base, out);
      else out.push(path.relative(base, p).split(path.sep).join('/'));
    }
    return out;
  };
  const all = walk(dest, dest, []);
  const defs = all.filter(p => p.split('/').pop().toLowerCase() === 'system.def');
  if (!defs.length) {
    // A LIFEBAR PACK dropped on the screenpack target: say what it is and
    // where it goes, instead of only what it lacks.
    let lifebar = false;
    try {
      const lbs = require('./lifebars.js');
      lifebar = all.some((p) => /\.def$/i.test(p) && lbs.isFightDef(fs.readFileSync(path.join(dest, p), 'latin1')));
    } catch (e) { lifebar = false; }
    rmTree(dest);
    if (lifebar) {
      // Tagged, so the Studio's add routes can take it into the lifebar
      // library instead (server.js): it is on disk, and it is what was meant.
      const err = new Error('this is a lifebar pack, not a screenpack: add it with "Drop a lifebar folder or a .zip, .rar or .7z here" on the Theme tab (+ Add)');
      err.code = 'LIFEBAR_PACK';
      throw err;
    }
    throw new Error('no system.def in this theme - a screenpack needs one');
  }
  const read1 = (p) => fs.readFileSync(path.join(dest, p), 'latin1');
  let chosen = null;
  const cfgRel = all.find(p => p.split('/').pop().toLowerCase() === 'mugen.cfg');
  if (cfgRel) {
    const m = /^\s*motif\s*=\s*([^\r\n;]+)/mi.exec(read1(cfgRel));
    if (m) {
      const want = m[1].trim().replace(/"/g, '').split('\\').join('/').toLowerCase();
      chosen = defs.find(d => d.toLowerCase() === want) || null;
    }
  }
  if (!chosen) {
    chosen = defs.map(d => {
      const t = read1(d);
      const author = (/^\s*author\s*=\s*"?([^"\r\n;]+)/mi.exec(t) || [, ''])[1].trim().toLowerCase();
      const spr = (/^\s*spr\s*=\s*([^\r\n;]+)/mi.exec(t) || [, ''])[1].trim().replace(/"/g, '');
      const dir = d.includes('/') ? d.slice(0, d.lastIndexOf('/') + 1) : '';
      let size = 0;
      try { size = fs.statSync(path.join(dest, dir, spr)).size; } catch { /* scored 0 */ }
      return { d, custom: author === 'elecbyte' ? 0 : 1, size, depth: d.split('/').length };
    }).sort((a, b) => (b.custom - a.custom) || (b.size - a.size) || (a.depth - b.depth))[0].d;
  }
  let rootRel = chosen.includes('/') ? chosen.slice(0, chosen.lastIndexOf('/')) : '';
  // WHAT THE PACK BRINGS BESIDES ITS SCREENS (themeopts.js): its own common
  // states, the debug font its text asks for, its variants (slot counts,
  // announcers). Read now, while the whole pack still sits on disk in its own
  // shape (its config and README beside data/, its option folders beside the
  // motif); written into the finished folder after the hoist. A pack with none
  // of it gets no manifest and installs exactly as before.
  let scan = { manifest: null, writes: [], copies: [], split: null };
  try {
    // The cells the roster needs, for a split pack's slot-count pick: the
    // caller's count (the whole-build import, which fills another bundle), else
    // this bundle's own roster.
    let cellsNeeded = opts && Number.isFinite(opts.cellsNeeded) ? opts.cellsNeeded : null;
    if (cellsNeeded === null && !(opts && opts.themesDir)) {
      try { cellsNeeded = rosterCellsNeeded(readRoster().chars || []); } catch (e) { cellsNeeded = null; }
    }
    scan = Object.assign({ copies: [], split: null }, require('./themeopts.js').scanPack(dest, chosen, {
      commonStates: !(opts && opts.commonStates === false), defs, cellsNeeded }));
  } catch (e) { console.warn('screenpack scan failed, installed without its options:', e.message); scan = { manifest: null, writes: [], copies: [], split: null }; }
  // A SPLIT PACK (cvs2): its art in one folder and its system.def variants in
  // others, none of which boots where it sits. The art folder is what is kept,
  // and the default variant's files are laid in at its top (themeopts.scanPack).
  if (scan.split) { chosen = scan.split.chosen; rootRel = scan.split.rootRel; }
  // Files copied from the pack as it sits now into the finished folder: option
  // files that live outside the folder kept, and a split pack's variants.
  const copyIn = (into) => {
    for (const c of [...(scan.split ? scan.split.place : []), ...scan.copies]) {
      const from = path.join(dest, ...c.from.split('/'));
      const to = path.join(into, ...c.rel.split('/'));
      if (path.resolve(from) === path.resolve(to)) continue;
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to);
    }
  };
  let carried = [];
  if (!rootRel) copyIn(dest);
  if (rootRel) {
    // Hoist the chosen motif's folder to the top, carrying the install's
    // font/ and sound/ siblings - the engine finds fonts via the motif's own
    // folder, and the music lines get repointed below.
    const stage = dest + '.__stage';
    fs.cpSync(path.join(dest, rootRel), stage, { recursive: true });
    // VIDEO IS A SIBLING TOO. A pack that boots on video keeps its .webm files
    // in a top-level video/ folder (ICA_GO ships eleven), and the hoist below
    // rm -rf's everything outside the motif folder - so the storyboards
    // survived and every file they name did not. carryStoryboards now resolves
    // video assets individually as well; this is the blanket that also catches
    // what no storyboard names, such as a stage's own background video.
    for (const sib of ['font', 'sound', 'video']) {
      const s = path.join(dest, sib);
      const t = path.join(stage, sib);
      if (fs.existsSync(s) && !fs.existsSync(t)) fs.cpSync(s, t, { recursive: true });
    }
    copyIn(stage);
    // Carry the motif's intro/logo/gameover storyboard art before the rest of
    // the pack's parent data/ is discarded (see carryStoryboards) - and every
    // other file it declares that lives outside the folder being kept: its own
    // sprite and sound files, its fight screen, its fonts (carryMotifRefs).
    carryStoryboards(dest, chosen, stage);
    carried = carryMotifRefs(dest, chosen, stage, { mugenFonts: !!(opts && opts.mugenFonts) });
    rmTree(dest);
    fs.renameSync(stage, dest);
  }
  // A theme is a skin, not a roster. The motif's select= resolves in the
  // motif's own folder first (motif.go: lookup "def,,data/"), so a screenpack
  // that ships its select.def replaces the roster with its own list - typically
  // a thousand empty slots - and a select screen with nothing in it hangs the
  // engine. Point it at the generated roster instead.
  // The motif file under the one name the roster records: a pack's System.def
  // is renamed system.def, so data/<name>/system.def names the file as the
  // disk spells it and every build (keyed by the disk's names) finds it.
  try {
    const onDisk = fs.readdirSync(dest).find((n) => n.toLowerCase() === 'system.def');
    if (onDisk && onDisk !== 'system.def') {
      const aside = path.join(dest, '.system-def-' + process.pid);
      fs.renameSync(path.join(dest, onDisk), aside);
      fs.renameSync(aside, path.join(dest, 'system.def'));
    }
  } catch (e) { /* keeps its spelling; the builds match the motif without case */ }
  const defPath = path.join(dest, 'system.def');
  const full = fs.readFileSync(defPath, 'latin1');
  const repaired = patchInstalledMotif(dest, name, full, { dataBgm: !!scan.manifest });
  if (repaired !== full) fs.writeFileSync(defPath, repaired, 'latin1');
  // The pack's state files carried in from outside its motif folder, and the
  // ones updated for this engine (the INSTALLED copies only), then the manifest.
  for (const w of scan.writes) {
    const p = path.join(dest, ...w.rel.split('/'));
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, w.data);
  }
  if (scan.manifest) require('./themeopts.js').writeManifest(dest, scan.manifest);
  else {
    // The manifest's name is the Studio's: one that came inside the pack is
    // not ours, and the option switch would act on what it says.
    const shipped = path.join(dest, require('./themeopts.js').MANIFEST);
    if (fs.existsSync(shipped)) require('./lifebars.js').rmFile(shipped);
  }
  const text = repaired.slice(0, 4096);
  // `extras`: how many game systems the pack adds, which the Theme tab asks
  // about. Only present when there are any, so an ordinary pack's result is
  // what it always was.
  const extras = scan.manifest && scan.manifest.common ? (scan.manifest.common.additions || []).length : 0;
  // `options`: how many choices the pack offers (slot counts, announcers),
  // likewise only when it offers some.
  const options = scan.manifest ? (scan.manifest.groups || []).length : 0;
  return Object.assign({ folder: name, path: `data/${name}/system.def`, name: themeName(text, name), carried },
    extras ? { extras } : {}, options ? { options } : {});
}

// The cells a roster's characters take: a slot block is one cell however many
// share it, an off-grid entry (exclude = 1) none, placeholders none.
function rosterCellsNeeded(chars) {
  const list = chars || [];
  const { at } = cellIndexes(list);
  const cells = new Set();
  list.forEach((c, i) => { if (c && !c.kind && at[i] !== null) cells.add(at[i]); });
  return cells.size;
}

// THE SHAPE A SCREENPACK SHIPS, read out of its own select.def.
//
// A pack's [Characters] list is not a roster we want - addTheme deliberately
// repoints `select=` at the generated one, because a thousand of somebody
// else's slots is not the user's build. But that list is also the only place
// the pack says WHICH CELLS ARE USABLE, and that is worth having: LEGACY
// reserves the block behind each big portrait panel, so a roster that ignores
// it puts characters underneath the artwork.
//
// The convention is consistent across the packs seen so far. The author fills
// the usable cells with a filler - LEGACY uses `kfm` 226 times, LEGACY_2 uses
// `randomselect` 118 times - and marks the reserved ones with a placeholder
// name that is not a character: `empty` in both (84 and 189), `x` in the
// community Ikemen port. None of those are engine keywords; they work because
// the character fails to load and the cell goes blank (system.go:5653 treats an
// entry with no def as unusable), which is exactly our own unused cell.
//
// So: a name in the placeholder set is a RESERVED cell and everything else is
// a usable one. Erring that way is deliberate - a cell wrongly called usable is
// one you can see and fix, while one wrongly reserved silently hides a slot.
//
// `randomselect` IS A RANDOM SLOT, and stays one. It is not a placeholder and
// it is never deleted: old screenpack authors used a block of them to keep
// character selection inside a certain area, so the cells are real and pickable.
//
// The only judgment is HOW MANY to bring across. A pack that uses them as
// filler has one in every free cell - LEGACY_2 has 118 and CVS2 has 70, one per
// cell of its whole grid - and importing those verbatim floods the build with
// random slots and leaves nowhere for the roster to go. Past the cap they are
// taken as ordinary free cells instead, which is what the author was using them
// as. Under it they are exactly what they say: LEGACY's two survive as two
// random slots.
//
//   LEGACY     2 randomselect,  84 placeholder, 226 named  -> 2 random slots
//   LEGACY_2 118 randomselect, 189 placeholder,   2 named  -> free cells
//   CVS2      70 randomselect,   0 placeholder,   0 named  -> free cells
//
// Anyone wanting a page full of random slots can fill one themselves; the cell
// menu converts a cell in two clicks.
const RANDOM_FLOOD = 16;
// WHAT A PACK WRITES IN A CELL IT IS KEEPING FOR ITSELF.
//
// There is no standard for this, so every author invents one. The word list
// covers the common ones; the punctuation clause covers the rest, because the
// Gear pack marks its 412 reserved cells with `-/` and the old rule only knew
// `-`, `--` and `---`. Missing it cost the whole import: with no holes found,
// the auto-apply gate (holes > 0 && usable > 0) never fired, so the pack's
// shape was silently ignored and 24 characters packed into row 1 of a 38-wide
// grid.
//
// THE RULE STAYS SYNTACTIC, and the punctuation clause carries no letters or
// digits at all, so it cannot reach a folder name. The tempting test - does
// this token name an installed character - is wrong in both directions:
// LEGACY-family packs use `kfm` as filler hundreds of times, and a real build
// can contain kfm.
//
// Measured before changing it: all 9 select.def files in this tree, 38 distinct
// first tokens. Exactly ONE changes classification - `-/` - and nothing the
// wider rule matches is the name of an installed character.
// Every entry kind that occupies a cell without being a character. Named
// once so the places that must agree can share it, instead of each listing
// the kinds it happens to know about.
const PLACEHOLDER_KINDS = new Set(['skip', 'random', 'dummy']);

const LAYOUT_PLACEHOLDER =
  /^(?:empty|blank|none|null|dummy|x{1,3}|[-_./\\|+*~ ]{1,4})$/i;

// THE SECOND SOURCE, ASKED FOR BY NAME ONLY (`opts.fromSystemDef`): a pack
// with no select.def of its own can still say which cells its art covers, in
// its system.def. Infinite Legacy X does it the MUGEN 0.99 way, one
// `cell.<col>.<row>.skip = 1` per covered cell, 1-based - keys Ikemen GO 1.0
// no longer reads (it reads `cell.<col-1>-<row-1>.skip`), so on this engine
// every one of its 1120 cells is drawn and pickable. Read here, they become
// the holes a re-lay puts skipslots in. The 1.0 dash form is NOT read: the
// engine skips those cells itself (main.lua), and reading them too would skip
// twice. setTheme never asks - selecting a pack must not re-lay the roster -
// so only E-Select's "Use this screenpack's slot layout" and the screenpack
// option switch (themeopts.choose) read it.
function themeLayout(folder, opts) {
  const dir = themeFolderDir(folder);
  if (!dir) return null;
  let sel = null, names;
  try {
    names = fs.readdirSync(dir);
    const hit = names.find((n) => n.toLowerCase() === 'select.def');
    if (hit) sel = path.join(dir, hit);
  } catch (e) { return null; }
  if (!sel) {
    if (!(opts && opts.fromSystemDef)) return null;
    const sys = names.find((n) => n.toLowerCase() === 'system.def');
    let st = null;
    try { st = sys ? fs.readFileSync(path.join(dir, sys), 'latin1') : null; } catch (e) { st = null; }
    return st === null ? null : layoutFromSystemDefText(st);
  }

  let text;
  try { text = fs.readFileSync(sel, 'latin1'); } catch (e) { return null; }
  const l = layoutFromSelectText(text);
  return l && opts && opts.fromSystemDef ? Object.assign(l, { source: 'select.def' }) : l;
}

// The [Select Info] grid and its 0.99 skip keys, as cells (see themeLayout).
// The first [Select Info] only; comments stripped (ILX writes `rows = 32;28`).
function layoutFromSystemDefText(text) {
  let inSel = false, seen = false, rows = 0, columns = 0;
  const skips = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.replace(/;.*$/, '').trim();
    const sec = /^\[\s*([^\]]+?)\s*\]/.exec(line);
    if (sec) {
      if (inSel) break;
      inSel = !seen && /^select info$/i.test(sec[1]);
      if (inSel) seen = true;
      continue;
    }
    if (!inSel || !line) continue;
    const kv = /^([^=]+?)\s*=\s*(.*)$/.exec(line);
    if (!kv) continue;
    const key = kv[1].trim().toLowerCase();
    if (key === 'rows') rows = parseInt(kv[2], 10) || 0;
    else if (key === 'columns') columns = parseInt(kv[2], 10) || 0;
    else {
      const m = /^cell\.(\d+)\.(\d+)\.skip$/.exec(key);
      if (m && parseInt(kv[2], 10) === 1) skips.push([parseInt(m[1], 10), parseInt(m[2], 10)]);
    }
  }
  if (rows <= 0 || columns <= 0) return null;
  const cells = new Array(rows * columns).fill('char');
  for (const [c, r] of skips) {
    if (c < 1 || r < 1 || c > columns || r > rows) continue;
    cells[(r - 1) * columns + (c - 1)] = 'hole';
  }
  return {
    cells, rows, columns,
    usable: cells.filter((c) => c === 'char').length,
    holes: cells.filter((c) => c === 'hole').length,
    randoms: 0, randomCount: 0, flooded: false,
    source: 'system.def',
  };
}

// A select.def's [Characters] list as cells: what themeLayout has always read.
function layoutFromSelectText(text) {
  const cells = [];
  let inSec = false, randomCount = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/;.*$/, '').trim();
    if (/^\[/.test(line)) {
      inSec = /^\[\s*characters\s*\]$/i.test(line);
      continue;
    }
    if (!inSec || !line) continue;
    // `name, stage, extra...` - only the name decides what the cell is.
    const name = line.split(',')[0].trim();
    if (!name) continue;
    if (/^randomselect$/i.test(name)) { cells.push('random'); randomCount++; }
    // READ SIDE, AND WRONG BEFORE ANY OF THIS WAS ADDED: a pack whose
    // select.def uses the engine's own `dummyslot` keyword was classified as
    // a CHARACTER, because LAYOUT_PLACEHOLDER matches the bare word `dummy`
    // and not `dummyslot`. Its empty cells counted as usable and the roster
    // was packed into cells the author left deliberately open.
    else if (/^dummyslot$/i.test(name)) cells.push('hole');
    else if (LAYOUT_PLACEHOLDER.test(name)) cells.push('hole');
    else cells.push('char');
  }
  if (!cells.length) return null;
  const flooded = randomCount > RANDOM_FLOOD;
  const resolved = cells.map((c) => (c === 'random' && flooded ? 'char' : c));
  return {
    cells: resolved,
    usable: resolved.filter((c) => c === 'char').length,
    holes: resolved.filter((c) => c === 'hole').length,
    randoms: resolved.filter((c) => c === 'random').length,
    randomCount,
    flooded,
  };
}

// APPLY THAT SHAPE TO THE USER'S OWN ROSTER.
//
// The characters keep their order and their settings; only WHERE they sit
// changes. Each usable cell takes the next character, each reserved cell gets a
// skipslot, and each of the pack's randomselect cells stays a randomselect.
//
// A skipslot rather than nothing, because a gap in a flat list has to be
// something - and with `moveoveremptyboxes = 0`, which both LEGACY packs set,
// a skipslot and an unused cell behave identically for the cursor.
//
// The result is truncated after the LAST character placed: holes before it are
// what shape the grid, holes after it would just be noise at the end.
function applyThemeLayout(folder, opts) {
  const layout = themeLayout(folder, opts);
  if (!layout) return { error: 'this screenpack ships no select.def to read a layout from' };
  const roster = readRoster();
  const { placed, gi, groups, leftOver } = relayChars(roster.chars, layout);
  roster.chars = placed.map(cleanChar);
  // Whose layout the roster is wearing, so switching packs can take it off
  // again without touching skipslots the user placed themselves.
  roster.layoutFrom = folder;
  writeRoster(roster);
  return {
    ok: true,
    usable: layout.usable, holes: layout.holes,
    // What actually LANDED, not what the layout contained: the result is
    // truncated after the last character placed, so a reserved or random cell
    // beyond the roster's reach never makes it into the build. Reporting the
    // layout's own totals claimed "2 random slots" for a build that had none.
    holesPlaced: placed.filter((c) => c.kind === 'skip').length,
    randoms: placed.filter((c) => c.kind === 'random').length,
    randomCount: layout.randomCount, flooded: layout.flooded,
    placedGroups: Math.min(gi, groups.length),
    leftOver: leftOver.length,
  };
}

// The arrangement applyThemeLayout writes, worked out without writing it - the
// screenpack option switch's dry run counts what a re-lay would move from it.
function relayChars(rosterChars, layout) {
  // `!c.kind` rather than a list of kinds to exclude: an exclusion list lets
  // any NEW kind through as if it were a character, and this then places it
  // into a usable cell of the imported layout.
  const chars = (rosterChars || []).filter((c) => !c.kind);

  // Slot members travel together: a slot block occupies ONE cell however many
  // characters are in it, so it is placed as a unit.
  const groups = [];
  for (let i = 0; i < chars.length;) {
    const c = chars[i];
    if (c.slot) {
      const g = [];
      while (i < chars.length && chars[i].slot === c.slot) g.push(chars[i++]);
      groups.push(g);
    } else { groups.push([c]); i++; }
  }

  const out = [];
  let gi = 0, lastChar = -1;
  for (const kind of layout.cells) {
    if (kind === 'hole') out.push({ kind: 'skip' });
    else if (kind === 'random') out.push({ kind: 'random' });
    else {
      // RAN OUT OF CHARACTERS IN A CELL THE PACK MEANT AS PLAYABLE. That is
      // an empty USABLE cell, which is a dummyslot - a skipslot here makes
      // the engine refuse a cell the pack intended you to reach. The pack's
      // own reserved cells above stay `skip` on purpose: they are reserved
      // because the pack's artwork sits over them.
      if (gi >= groups.length) { out.push({ kind: 'dummy' }); continue; }
      for (const c of groups[gi++]) out.push(c);
      lastChar = out.length;
    }
  }
  const placed = out.slice(0, lastChar < 0 ? 0 : lastChar);
  const leftOver = groups.slice(gi);
  // Characters the layout had no room for still belong to the build - they go
  // after it rather than being dropped, and the footer's cell count says so.
  for (const g of leftOver) for (const c of g) placed.push(c);
  return { placed, gi, groups, leftOver };
}

function removeTheme(folder) {
  const dir = themeFolderDir(folder);
  if (!dir) throw new Error('bad theme folder: ' + (typeof folder === 'string' && folder ? JSON.stringify(folder) : '(empty)'));
  let st = null;
  try { st = fs.lstatSync(dir); } catch (e) { st = null; }
  if (!st) throw new Error('no such theme: ' + folder);
  // lstat, so a symlink or junction is not a directory here: a recursive
  // delete through a link is a delete of whatever it points at.
  if (!st.isDirectory()) throw new Error('not a theme folder: ' + folder);
  // rmTree, not a bare rmSync: Node 23.11's rmSync returns without error and
  // without deleting when the folder name is not ASCII (é, Japanese) on
  // Windows, so a pack named that way was reported removed and stayed. rmTree
  // walks it by hand when that happens and throws if it is still there.
  require('./lifebars.js').rmTree(dir);
  // Don't leave the roster pointing at a motif that no longer exists: a missing
  // one fails at boot rather than falling back.
  const roster = readRoster();
  if (roster.motif === `data/${folder}/system.def`) {
    delete roster.motif;
    writeRoster(roster);
  }
  return { removed: folder };
}

// --- stages ----------------------------------------------------------------
//
// A stage .def names its files the way MUGEN's ROOT layout expects:
//
//   spr     = stages/AI_Burnice.sff
//   bgmusic = sound/01. Burning Desires.mp3
//
// The engine resolves these with SearchFile(val, [defDir, "", "data/"]), so a
// root-relative path only works by luck - when the stage's files happen to sit
// loose in stages/. The browser Studio mounts each stage in its own folder,
// where "stages/AI_Burnice.sff" resolves to nothing and the stage dies at
// preload. Bundled audio is worse in both Studios: nothing ever installed it,
// so a stage booted silent and its track never reached the music list, leaving
// the track to be added by hand every time (field-hit 2026-08-10).
//
// So scan the def the way scanMissingDeps scans a character, then install each
// referenced file where the def's OWN directory will find it and rewrite the
// reference to match. Audio is the exception: it goes to the music library,
// the one place a track is both playable (music/ mounts as sound/) and
// pickable for any other stage.
// `attachedchar` (and attachedchar1, 2...): a character the stage brings along
// to run its own rules - CVS-P's ring-out stage (stageRO.def) attaches
// VP_Ringout.def, whose .zss does the ring-out. The engine opens it from the
// stage's folder, then the game root, then data/ (stage.go LoadFile), and
// stops the game when it is missing ("open VP_Ringout.def"). Its own [Files]
// come with it (attachedCharFiles).
const STAGE_DEP_KEYS = /^(\s*)(spr|model|environment|bgmusic|attachedchar\d*)(\s*=[ \t]*)([^;\r\n]*?)([ \t]*)(;.*)?$/i;

// The files an attached character's def names under [Files] (anim, st, stN,
// sound, sprite, cmd, cns, stcommon, palN...): [{ key, val, name }].
function attachedCharFiles(defText) {
  const out = [];
  let inFiles = false;
  for (const raw of String(defText).split(/\r?\n/)) {
    const line = raw.split(';')[0].trim();
    if (!line) continue;
    const h = /^\[([^\]]*)\]/.exec(line);
    if (h) { inFiles = h[1].trim().toLowerCase() === 'files'; continue; }
    if (!inFiles) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const val = line.slice(eq + 1).replace(/"/g, '').replace(/\\/g, '/').trim();
    if (!val) continue;
    out.push({ key: line.slice(0, eq).trim().toLowerCase(), val, name: val.split('/').pop() });
  }
  return out;
}

// That def with its [Files] values replaced: map(val) -> new value or null.
function rewriteAttachedCharFiles(defText, map) {
  let inFiles = false;
  return String(defText).split(/(\r?\n)/).map((part) => {
    const line = part.split(';')[0];
    const h = /^\s*\[([^\]]*)\]/.exec(line);
    if (h) { inFiles = h[1].trim().toLowerCase() === 'files'; return part; }
    if (!inFiles) return part;
    const m = /^(\s*[^=;\r\n]+?\s*=[ \t]*)([^;\r\n]*?)([ \t]*)(;.*)?$/.exec(part);
    if (!m) return part;
    const val = m[2].replace(/"/g, '').replace(/\\/g, '/').trim();
    const next = val ? map(val) : null;
    return next && next !== val ? m[1] + next + m[3] + (m[4] || '') : part;
  }).join('');
}
const AUDIO_EXT = /\.(ogg|mp3|wav|flac|m4a)$/i;

function scanStageDeps(defText) {
  const out = [];
  for (const line of String(defText).split(/\r?\n/)) {
    const m = STAGE_DEP_KEYS.exec(line);
    if (!m) continue;
    const val = m[4].replace(/"/g, '').replace(/\\/g, '/').trim();
    if (!val) continue;
    out.push({ key: m[2].toLowerCase(), val, name: val.split('/').pop() });
  }
  return out;
}

// Rewrite in place: map(key, value) -> new value, or null to leave the line be.
// Splitting on a captured separator keeps the file's original line endings.
function rewriteStageDeps(defText, map) {
  return String(defText).split(/(\r?\n)/).map((part) => {
    const m = STAGE_DEP_KEYS.exec(part);
    if (!m) return part;
    const val = m[4].replace(/"/g, '').replace(/\\/g, '/').trim();
    if (!val) return part;
    const next = map(m[2].toLowerCase(), val);
    if (!next || next === val) return part;
    return m[1] + m[2] + m[3] + next + m[5] + (m[6] || '');
  }).join('');
}

// A stage def declares its backgrounds; anything else in the archive that
// happens to end in .def (a character, a leftover screenpack) is not a stage.
function isStageDef(text) {
  return /^\s*\[\s*(bgdef|stageinfo)\s*\]/im.test(text);
}

// A stage def can name other defs for single rounds (round1def = stages/x1.def;
// Ikemen reads them from the main def only, and a missing one falls back to the
// main stage for that round). Those defs are part of the stage, not stages of
// their own: the file names they give.
function roundDefNames(defText) {
  const out = [];
  for (const line of String(defText).split(/\r?\n/)) {
    const m = /^\s*round\d+def\s*=[ \t]*([^;\r\n]*?)[ \t]*(;.*)?$/i.exec(line);
    if (!m) continue;
    const name = m[1].replace(/"/g, '').replace(/\\/g, '/').trim().split('/').pop();
    if (name) out.push(name);
  }
  return out;
}

// The unpacked archive (a .zip, .rar or .7z stage) lives in TEMP and goes
// whatever happens after the unpack: a refused def, a clash or a sprite file
// another program holds used to leave it there (only the success path and the
// refusals cleaned up), and the bare fs.rmSync it went through never removes
// anything under a non-ASCII TEMP (lifebars.rmTree does).
function addStage(srcPath) {
  const unpacked = { dir: null };
  try {
    return addStageFrom(srcPath, unpacked);
  } finally {
    if (unpacked.dir) { try { rmTree(unpacked.dir); } catch (e) { /* a temp leftover only */ } }
  }
}

function addStageFrom(srcPath, unpacked) {
  const roster = readRoster();
  fs.mkdirSync(STAGES, { recursive: true });

  // Collect candidate files: a zip's contents, or a .def plus its siblings
  // that share the basename / are referenced by the def.
  let files = [];
  if (isArchive(srcPath)) {
    const tmp = path.join(os.tmpdir(), 'mugen-stage-' + Date.now());
    extractZip(srcPath, tmp);
    unpacked.dir = tmp;
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p); else files.push(p);
      }
    };
    walk(tmp);
  } else if (srcPath.toLowerCase().endsWith('.def')) {
    const dir = path.dirname(srcPath);
    const base = path.basename(srcPath, '.def').toLowerCase();
    const defText = fs.readFileSync(srcPath, 'latin1');
    const kv = parseDefSections(defText);
    const referenced = new Set(
      Object.values(kv).map(v => path.basename(v.replace(/\\/g, '/')).toLowerCase())
    );
    // A character the stage attaches brings its own [Files] (attachedCharFiles).
    for (const dep of scanStageDeps(defText)) {
      if (!dep.key.startsWith('attachedchar')) continue;
      let aText = null;
      try { aText = fs.readFileSync(path.join(dir, dep.val), 'latin1'); } catch (e) {
        try { aText = fs.readFileSync(path.join(dir, dep.name), 'latin1'); } catch (e2) { aText = null; }
      }
      if (aText) for (const f of attachedCharFiles(aText)) referenced.add(f.name.toLowerCase());
    }
    files = fs.readdirSync(dir)
      .filter(f => {
        const lower = f.toLowerCase();
        return lower === base + '.def' ||
          (lower.startsWith(base + '.') && !lower.endsWith('.def')) ||
          referenced.has(lower);
      })
      .map(f => path.join(dir, f));
  } else {
    throw new Error('stage source must be a .zip, .rar, .7z or a .def file');
  }

  const fail = (msg) => { throw new Error(msg); };

  // Every stage def in the source becomes its own stage. Community packs
  // routinely ship variants in one zip - AI_Burnice.zip carries two stages
  // that differ only in camera bounds - and taking just the first silently
  // threw the rest away while still copying their sprites.
  // ...but only at the SHALLOWEST depth. An archive with a backup/ or old/
  // folder holds stale copies of those same defs, and taking every def at any
  // depth installed the backups as extra stages. Real variants sit side by
  // side, snapshots sit nested, so depth separates them. Same rule the
  // character path uses in findMainDef.
  // Depth is right HERE and wrong for themes: a full-install theme pack keeps
  // its real motif deeper (data/mugen1/) than the stock defs it also bundles.
  // A stage archive has no such convention - the real def is at the top and
  // anything deeper is a snapshot. See chooseMotifDef in studio-lite.html.
  const defCandidates = files.filter(f => /\.def$/i.test(f) &&
    isStageDef(fs.readFileSync(f, 'latin1')));
  const defDepth = defCandidates.reduce(
    (m, f) => Math.min(m, f.split(path.sep).length), Infinity);
  const shallowest = defCandidates.filter(f => f.split(path.sep).length === defDepth);
  if (!shallowest.length) fail('no stage .def found in stage source');
  // A def that another def names as its round1def, round2def... is that
  // stage's round variant: installed with it, with its own files, but never
  // listed as a stage of its own (cvs2london.zip, one stage with two round
  // variants, used to come in as three identical stages). If every def is
  // somebody's round, all of them are listed, as before.
  const roundNames = new Set();
  for (const f of defCandidates) for (const n of roundDefNames(fs.readFileSync(f, 'latin1'))) roundNames.add(n.toLowerCase());
  let defFiles = shallowest.filter(f => !roundNames.has(path.basename(f).toLowerCase()));
  if (!defFiles.length) defFiles = shallowest;
  const roundFiles = [];
  for (const n of roundNames) {
    const f = defCandidates.filter(c => path.basename(c).toLowerCase() === n && !defFiles.includes(c))
      .sort((a, b) => a.split(path.sep).length - b.split(path.sep).length)[0];
    if (f) roundFiles.push(f);
  }

  const clash = [...defFiles, ...roundFiles].map(f => path.basename(f))
    .filter(b => fs.existsSync(path.join(STAGES, b)));
  if (clash.length) fail(`stage "${clash[0]}" already exists`);

  // Index the archive's files by basename so a def's reference can be found
  // wherever it sits - the paths in the def describe MUGEN's layout, not the
  // zip's, and the two rarely agree.
  const byName = new Map();
  for (const f of files) {
    const k = path.basename(f).toLowerCase();
    if (!byName.has(k)) byName.set(k, f);
  }

  const sameBytes = (a, b) => {
    try {
      const sa = fs.statSync(a), sb = fs.statSync(b);
      return sa.size === sb.size && fs.readFileSync(a).equals(fs.readFileSync(b));
    } catch { return false; }
  };

  // Copy a companion into stages/, flat. Two packs can ship the same generic
  // name ("bg.sff"); overwriting used to corrupt whichever stage was installed
  // first, so a genuine conflict is parked under the def's own basename and
  // the reference is rewritten to follow it.
  const placed = new Map();
  function placeCompanion(src, defBase) {
    const key = src.toLowerCase();
    if (placed.has(key)) return placed.get(key);
    let name = path.basename(src);
    let dest = path.join(STAGES, name);
    if (fs.existsSync(dest) && !sameBytes(src, dest)) {
      name = path.basename(defBase, '.def') + '.' + name;
      dest = path.join(STAGES, name);
    }
    if (!fs.existsSync(dest) || !sameBytes(src, dest)) fs.copyFileSync(src, dest);
    placed.set(key, name);
    return name;
  }

  // What the build already supplies (engine data/, stock sound/) - a def is
  // free to point at those, and reporting them as missing would be noise.
  let have;
  try {
    const { index } = require('./vfslib').build();
    have = new Set([...index.keys()].map(s => s.toLowerCase()));
  } catch { have = new Set(); }

  const added = [], music = [], missing = [];
  for (const defFile of [...defFiles, ...roundFiles]) {
    const defBase = path.basename(defFile);
    const text = fs.readFileSync(defFile, 'latin1');

    const resolved = new Map();
    for (const dep of scanStageDeps(text)) {
      const src = byName.get(dep.name.toLowerCase());
      if (!src) {
        if (!have.has(dep.val.toLowerCase()) && !have.has('data/' + dep.val.toLowerCase())) {
          missing.push({ stage: defBase, key: dep.key, name: dep.name });
        }
        continue;
      }
      if (dep.key === 'bgmusic' || AUDIO_EXT.test(dep.name)) {
        // Into the music library, not next to the stage: that is what puts it
        // in the song list and lets any other stage pick it too. A format the
        // library won't take (.wav, .flac) must not abort the whole install -
        // the stage is still perfectly playable without its track.
        try { resolved.set(dep.val, addMusic(src, dep.name).file); }
        catch (e) { missing.push({ stage: defBase, key: dep.key, name: dep.name, why: e.message }); }
      } else if (dep.key.startsWith('attachedchar')) {
        // The attached character and every file its [Files] names, placed beside
        // the stage; the def is rewritten when a file had to take another name.
        const aText = fs.readFileSync(src, 'latin1');
        const renamed = new Map();
        for (const f of attachedCharFiles(aText)) {
          const fsrc = byName.get(f.name.toLowerCase());
          if (!fsrc) { missing.push({ stage: defBase, key: dep.key + ' ' + f.key, name: f.name }); continue; }
          const placedName = placeCompanion(fsrc, defBase);
          if (placedName !== f.val) renamed.set(f.val, placedName);
        }
        const placedDef = placeCompanion(src, defBase);
        if (renamed.size) fs.writeFileSync(path.join(STAGES, placedDef), rewriteAttachedCharFiles(aText, (v) => renamed.get(v) || null), 'latin1');
        resolved.set(dep.val, placedDef);
      } else {
        // A bare filename resolves against the def's own directory, which is
        // the first root SearchFile tries - so it works whether the stage sits
        // loose in stages/ or in a folder of its own.
        resolved.set(dep.val, placeCompanion(src, defBase));
        // A .gltf model names its buffers and images by path from its own
        // folder (a .glb carries them inside): they go beside it in stages/
        // at those same paths, never renamed, since the .gltf names them.
        for (const g of require('./vfslib').gltfFiles(src)) {
          const from = path.join(path.dirname(src), ...g.split('/'));
          const to = path.join(STAGES, ...g.split('/'));
          if (!fs.existsSync(from)) { missing.push({ stage: defBase, key: dep.key, name: g }); continue; }
          if (fs.existsSync(to) && !sameBytes(from, to)) { missing.push({ stage: defBase, key: dep.key, name: g, why: 'stages/' + g + ' is already another file' }); continue; }
          fs.mkdirSync(path.dirname(to), { recursive: true });
          if (!fs.existsSync(to)) fs.copyFileSync(from, to);
        }
      }
    }

    fs.writeFileSync(path.join(STAGES, defBase),
      rewriteStageDeps(text, (_k, val) => resolved.get(val) || null), 'latin1');
    if (roundFiles.includes(defFile)) continue;   // a round variant: installed, not listed

    // Read back the REWRITTEN def, so bgmusic is already the installed path.
    const kv = parseDefSections(fs.readFileSync(path.join(STAGES, defBase), 'latin1'));
    let track = (kv['bgmusic'] || '').replace(/"/g, '').replace(/\\/g, '/').trim();
    // Not bundled, but the library may already hold a track by that name -
    // re-installing a stage pack shouldn't lose the music it had last time.
    if (track && !track.startsWith('sound/')) track = 'sound/' + track.split('/').pop();
    if (track && !fs.existsSync(path.join(MUSIC, track.slice('sound/'.length)))) track = '';
    const entry = {
      file: defBase,
      name: reencodeName(kv['name']) || path.basename(defBase, '.def'),
      music: track,
    };
    if (entry.music && !music.includes(entry.music)) music.push(entry.music);
    roster.stages.push(entry);
    added.push(entry);
  }

  writeRoster(roster);
  // Keep the single-stage shape the Studio already renders, and carry the
  // extras alongside it.
  return { ...added[0], stages: added, music, missing };
}

function removeStage(file) {
  const roster = readRoster();
  const idx = roster.stages.findIndex(s => s.file === file);
  if (idx === -1) throw new Error('no such stage: ' + file);
  if (roster.stages.length === 1) throw new Error('cannot remove the last stage');
  roster.stages.splice(idx, 1);
  for (const c of roster.chars) if (c.stage === file) delete c.stage;
  writeRoster(roster);
  // Delete the def, its round variants (round1def...) and their same-basename
  // companions (sprites, models, their own music) - but never a file a stage
  // still in the build uses: two stages can share a sprite file, and a round
  // variant can be named by a stage that stays (an older import listed
  // cvs2london1.def as a stage of its own; removing that entry must not take
  // the file the main stage plays round 1 on).
  // Every one is tried, and one that stays (open in another program) is
  // named: the stage is out of the build, but it is not reported removed.
  let rounds = [];
  try { rounds = roundDefNames(fs.readFileSync(path.join(STAGES, file), 'latin1')); } catch (e) { rounds = []; }
  const bases = [file, ...rounds].map((f) => path.basename(f, path.extname(f)).toLowerCase());
  const inUse = require('./vfslib').stageKeepFilter(roster.stages);
  const stuck = [];
  for (const f of fs.readdirSync(STAGES)) {
    const lower = f.toLowerCase();
    if (!bases.some((b) => lower.startsWith(b + '.'))) continue;
    if (inUse.has('stages/' + lower)) continue;
    try { rmFile(path.join(STAGES, f)); } catch (e) { stuck.push(f + ' (' + (e.code || e.message) + ')'); }
  }
  if (stuck.length) throw new Error(file + ' is out of the build, but these files could not be deleted: ' + stuck.join(', '));
  return { removed: file };
}

// --- music ------------------------------------------------------------------

// origName preserves the track's real filename when srcPath is a temp file. A
// drag-and-drop upload used to land in the library as its temp name
// ("mugen-upload-1784287131108-FTS_ogg.ogg"), which is what the song list then
// showed forever. The name is normalized the same way the browser Studio
// normalizes it, so the same track added in either Studio gets the same path -
// and so nothing lands in a select.def "music=" param that a comma or a
// semicolon would cut in half.
// A name the library already holds with OTHER bytes is a different song (a
// character's bundled theme.ogg, a stage pack's bgm.mp3): copying over it
// silently swapped the track under every stage and menu slot that named it.
// It lands under the first free <stem>_2<ext>, _3, ... instead, or on a
// numbered copy that already holds these bytes - buildimport's trackPlacer
// rule. The same bytes under the same name stay a no-op. Callers use the
// returned file, never the name they asked for.
function addMusic(srcPath, origName) {
  const from = origName || srcPath;
  const ext = path.extname(from).toLowerCase();
  if (ext !== '.ogg' && ext !== '.mp3') throw new Error('music must be .ogg or .mp3');
  fs.mkdirSync(MUSIC, { recursive: true });
  const base = path.basename(from).replace(/[^a-zA-Z0-9._-]+/g, '_');
  const baseExt = path.extname(base), stem = base.slice(0, base.length - baseExt.length);
  for (let i = 1; ; i++) {
    const name = i === 1 ? base : stem + '_' + i + baseExt;
    const dest = path.join(MUSIC, name);
    if (fs.existsSync(dest)) {
      if (sameFileBytes(srcPath, dest)) return { file: `sound/${name}` };
      continue;
    }
    fs.copyFileSync(srcPath, dest);
    return { file: `sound/${name}` };
  }
}

// Size first, then the bytes; an unreadable side is "not the same".
function sameFileBytes(a, b) {
  try {
    const sa = fs.statSync(a), sb = fs.statSync(b);
    return sa.size === sb.size && fs.readFileSync(a).equals(fs.readFileSync(b));
  } catch (e) { return false; }
}

// The [Music] keys in the SHIPPING screenpack that still name a track, read off
// the installed theme on disk - one file, the motif the bundle boots with.
// Used to say so when a track is deleted out from under it; see removeMusic.
function motifKeysNaming(roster, vpath) {
  const out = [];
  const motif = String((roster && roster.motif) || '').replace(/\\/g, '/');
  if (!/^data\//i.test(motif)) return out;
  let text = null;
  try {
    text = fs.readFileSync(path.join(THEMES, motif.replace(/^data\//i, '')), 'latin1');
  } catch (e) { return out; }
  const want = String(vpath || '').toLowerCase();
  let inMusic = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/;.*$/, '').trim();
    if (!line) continue;
    const h = /^\[([^\]]*)\]/.exec(line);
    if (h) { inMusic = /^music$/i.test(h[1].trim()); continue; }
    if (!inMusic) continue;
    const m = /^([^=]+?)\s*=\s*(.*)$/.exec(line);
    if (!m || !/^(?:.+\.)?(?:bgm|bgmusic)$/i.test(m[1].trim())) continue;
    for (const v of m[2].split(',')) {
      if (v.replace(/"/g, '').replace(/\\/g, '/').trim().toLowerCase() === want) { out.push(m[1].trim()); break; }
    }
  }
  return out;
}

function removeMusic(file) {
  const base = path.basename(file);
  const roster = readRoster();
  if (roster.music === 'sound/' + base) throw new Error('cannot remove the default track (pick another default first)');
  // Off the disk before the roster lets go of it: a track that cannot be
  // deleted stays exactly as it was, in the library and on its stages.
  rmFile(path.join(MUSIC, base));
  let changed = false;
  // Detach from every stage that names it - including one of SEVERAL tracks on
  // the same stage. A plain equality check missed those entirely and left the
  // stage pointing at a file that no longer exists.
  for (const s of roster.stages) {
    const had = Array.isArray(s.music) ? s.music : (s.music ? [s.music] : []);
    const kept = had.filter((t) => t !== 'sound/' + base);
    if (kept.length === had.length) continue;
    s.music = kept.length === 0 ? '' : (kept.length === 1 ? kept[0] : kept);
    changed = true;
  }
  for (const c of roster.chars) if (c.music === 'sound/' + base) { delete c.music; changed = true; }
  // AND THE MENU MUSIC FIELDS. Detaching the stages and the characters and
  // leaving titleMusic/selectMusic alone was harmless while a screenpack kept
  // its own copy of its menu music: the field named a track nobody had, and
  // the theme's own line gave the pack's song back. A build import carries the
  // pack's tracks into this library and deletes the theme's duplicates, so the
  // library now holds the ONLY copy - and a stale field then wrote a dead path
  // into the motif of every export, with nothing in the Studio showing it
  // (the Content page's picker falls back to "(default music)" for a track it
  // cannot find, so the slot reads as unset while the roster still carries it).
  const vpath = 'sound/' + base;
  const cleared = [];
  for (const [field, screen] of [['titleMusic', 'title'], ['selectMusic', 'character-select']]) {
    if (String(roster[field] || '').toLowerCase() !== vpath.toLowerCase()) continue;
    roster[field] = '';
    cleared.push(screen);
    changed = true;
  }
  if (changed) writeRoster(roster);
  // WHAT THE SCREENPACK STILL ASKS FOR is the half no roster field can hold:
  // vs.bgm, victory.bgm and whatever else a pack invents live in its own
  // system.def. Deleting one of those tracks is allowed - it is the owner's
  // library - but it is worth saying, because that screen is silent afterwards
  // and nothing in the roster shows why.
  const stillNamedBy = motifKeysNaming(roster, vpath);
  const said = [];
  if (cleared.length) {
    said.push('Cleared it from the ' + cleared.join(' and ') + ' screen'
      + (cleared.length > 1 ? 's' : '') + '.');
  }
  if (stillNamedBy.length) {
    said.push('The screenpack still asks for it on ' + stillNamedBy.join(' and ')
      + ', so that screen has no music until you set another track there.');
  }
  return { removed: base, cleared, stillNamedBy, note: said.join(' ') };
}

// DELETING SEVERAL AT ONCE (the Studio's Select mode). Every item goes through
// the same remover a single delete uses - a character's roster slots, a
// stage's companion files and the characters pointing at it, a track's stage,
// character and menu slots - so a batch cannot leave behind anything a
// one-by-one delete would not. There is no select.def to keep in step: it is
// generated from roster.json at every build.
//
// One refusal does not stop the rest. The last stage and the stage fallback
// track refuse on their own, exactly as they do singly, and the answer names
// each one and why.
function removeMany(kind, ids) {
  const one = kind === 'char' ? removeCharacter
    : kind === 'stage' ? removeStage
    : kind === 'music' ? removeMusic : null;
  if (!one) throw new Error('kind must be char|stage|music');
  if (!Array.isArray(ids) || !ids.length) throw new Error('nothing selected to remove');
  const removed = [], failed = [], notes = [];
  for (const id of [...new Set(ids.map(String))]) {
    try {
      const r = one(id);
      removed.push(id);
      if (r && r.note) notes.push(id.replace(/^sound\//, '') + ': ' + r.note);
    } catch (e) {
      failed.push({ id, error: e.message });
    }
  }
  return { removed, failed, note: notes.join(' ') };
}

// --- H-compatibility scan ------------------------------------------------
//
// Community H-characters follow a Kuromaru-descended convention:
//  - GIVER: carries the scene code (custom states imposed via p2stateno /
//    TargetState) plus couple-scene animations in high number ranges in its
//    own .air; the victim is blanked with ChangeAnim2 during scenes.
//  - RECEIVER (tailored): additionally ships its own victim reaction anims
//    (SelfAnimExist hooks, conventionally 90000-range) so it stays visible
//    in its own art style when grabbed. Characters without these simply
//    vanish into the giver's generic couple sprite.
// Detection is heuristic but errs conservative: "giver" needs both the
// state-imposition machinery and high-range scene animations.

// Rules validated against real specimens (DongHwan=giver, Sakura=receiver,
// Filia=receiver; confirmed in play by the user):
//
//  GIVER: its DEF-LOADED state files contain the compatibility-fallback
//    idiom - a ChangeAnim2 with a SelfAnimExist check nearby ("if the victim
//    lacks the pair animation, blank them with my copy"). Ordinary chars use
//    ChangeAnim2 for throws and SelfAnimExist in common gethit states, but
//    only H-givers combine them around one animation value.
//
//  RECEIVER: its .air registers pair animations in the shared community
//    victim registries (70000-71999 / 80000-81999). These are anims the
//    character carries solely so GIVERS can play them - its own code never
//    references them. (Some givers also use private low-numbered registries,
//    e.g. DongHwan's 4343 - undetectable generically; badge may undercount.)
//
//  Only files actually referenced by the character's .def are scanned:
//  community zips often bundle unwired template files (e.g. a Filiamaru.cns)
//  that never load in game.

const H_COMMANDS = /^(missionary|doggy|doggystyle|cowgirl|press|matingpress|manguri\d*|slime\d*|fuck\d*|sex\d*|bj|blowjob|rape|grab_h|hgrab)$/i;

// ONE SCAN PER CHARACTER WHILE ITS FILES STAY AS THEY ARE. The build
// studioInfo asks for runs buildSceneViewerLua, which scans every character,
// and the cards then scanned them all again - two full reads of every state,
// cmd and air file per refresh - and every refresh did it over. A memo that
// lived for one studioInfo call stopped the doubling; this one lives across
// calls, keyed by a stamp (size@mtime) of EXACTLY the files hScanUncached
// reads: the .def, every cmd/cns/st/stcommon/anim file it names (a missing
// one stamps '-', so a file that appears re-scans), and the sprite file. The
// list comes from the .def, so an edited .def re-reads its own list. A hit is
// a CLONE: studioInfo writes coverage and receiver into its result and
// deletes the raw sets. A scan that could not read a file it names (there,
// but busy: a scanner or a sync client holding it) is NOT kept - it is a
// partial answer, and the next call reads again, as before.
// KEPT SMALL, AND BOUNDED BY SIZE. airFrames is most of a scan (a Set of
// 'group,index' strings per action); it is kept as one joined string per
// action and rebuilt on a hit. Measured on 799 characters (Ikemen Fighting
// Collection, 2026-10-12): 166 MB of heap kept as Sets, 62 MB packed (77 KB a
// character); hScanBytes estimates 59 MB there. The bound, 128 MB of that
// estimate (~1800 such characters), sits above any roster's sweep, which
// must stay a hit: past it the oldest goes, and an in-order sweep larger
// than the bound would miss every time.
const HSCAN_MEMO = new Map();   // charDir|defName -> { deps, stamp, value, bytes }
const HSCAN_MEMO_MAX_BYTES = 128 * 1024 * 1024;
let hScanMemoBytes = 0;
function hScanDeps(charDir, defName) {
  const deps = [path.join(charDir, defName)];
  let defText;
  try { defText = fs.readFileSync(deps[0], 'latin1'); } catch (e) { return fs.existsSync(deps[0]) ? null : deps; }
  let spriteFile = null;
  // hScanUncached's own reading of the [Files] lines, kept in step with it
  for (const line of defText.split(/\r?\n/)) {
    const m = /^\s*(cmd|cns|st\d*|stcommon|anim|sprite)\s*=\s*(.+?)\s*(;.*)?$/i.exec(line);
    if (!m) continue;
    const rel = m[2].replace(/"/g, '').replace(/\\/g, '/');
    if (m[1].toLowerCase() === 'sprite') { spriteFile = rel; continue; }
    deps.push(path.join(charDir, rel));
  }
  if (spriteFile) {
    let p = null;
    try { p = resolveCI(charDir, spriteFile); } catch (e) { p = null; }
    deps.push(p || path.join(charDir, spriteFile));
  }
  return deps;
}
function filesStamp(files) {
  return files.map((p) => { try { const s = fs.statSync(p); return s.size + '@' + s.mtimeMs; } catch (e) { return '-'; } }).join(';');
}
// airFrames as [[action, 'g,i|g,i|...'], ...] in its own order, and back. A
// copy: the caller gets the scan itself and may write into its sets.
function hScanPack(value) {
  const packed = structuredClone({ ...value, airFrames: null });
  packed.airFrames = [...value.airFrames].map(([n, s]) => [n, [...s].join('|')]);
  return packed;
}
function hScanUnpack(packed) {
  const value = structuredClone(packed);
  value.airFrames = new Map(value.airFrames.map(([n, s]) => [n, new Set(s ? s.split('|') : [])]));
  return value;
}
// an estimate of the heap a packed scan holds (fitted to the measured heap
// above): 32 bytes per set element, 80 per airFrames action plus its string,
// 16 per element of any other list, strings by length, 1 KB for the object
function hScanBytes(packed, stamp) {
  let n = 1024 + stamp.length;
  for (const [k, x] of Object.entries(packed)) {
    if (k === 'airFrames') { for (const [, s] of x) n += 80 + s.length; }
    else if (typeof x === 'string') n += x.length;
    else if (x instanceof Set) n += 32 * x.size;
    else if (Array.isArray(x)) n += 16 * x.length;
  }
  return n;
}
function hScan(charDir, defName) {
  const key = charDir + '|' + defName;
  const hit = HSCAN_MEMO.get(key);
  if (hit && filesStamp(hit.deps) === hit.stamp) return hScanUnpack(hit.value);
  // stamped BEFORE the scan: a file written during it re-scans on the next call
  const deps = hScanDeps(charDir, defName);   // null: the .def is there but did not read
  const report = { incomplete: !deps };
  const stamp = deps ? filesStamp(deps) : '';
  const value = hScanUncached(charDir, defName, { report });
  if (hit) { HSCAN_MEMO.delete(key); hScanMemoBytes -= hit.bytes; }
  if (report.incomplete) return value;
  const packed = hScanPack(value);
  const bytes = hScanBytes(packed, stamp);
  if (bytes > HSCAN_MEMO_MAX_BYTES) return value;
  HSCAN_MEMO.set(key, { deps, stamp, value: packed, bytes });
  hScanMemoBytes += bytes;
  for (const [k, v] of HSCAN_MEMO) {
    if (hScanMemoBytes <= HSCAN_MEMO_MAX_BYTES) break;
    HSCAN_MEMO.delete(k); hScanMemoBytes -= v.bytes;
  }
  return value;
}

function hScanUncached(charDir, defName, opts) {
  // opts.hNumber replaces isHNumber for this scan - a tool measuring a variant
  // of the H-number rule over a corpus (GRAIL 4.3); the Studio never passes it.
  // opts.report (hScan's memo): .incomplete is set when a file that is there
  // did not read, so a partial scan is never kept.
  const isH = (opts && opts.hNumber) || isHNumber;
  const report = (opts && opts.report) || {};
  const out = { giver: false, receiver: false, modules: 0, commands: [],
    registry: new Set(), airActions: new Set(), airFrames: new Map(), uiCards: new Set(), hudRuns: new Set(), blankArt: new Set(), sabotage: [],
    playsOwn: new Set(), giverHits: 0, giverHitNums: [], expectsHNums: [],
    changeAnims: new Set(), changeAnimsOnOthers: new Set(), probesWindow: new Set(), wiredCommands: [], why: '', receiverWhy: '' };
  const stateTexts = [];
  // for the Futa brand's giver door: the states a character defines and the
  // literal states it sends a target to
  const statedefs = new Set(), targetStates = new Set();
  // (the states his TargetStates and p2statenos give someone, and the probes
  // of her window that fall back to an action of his own: the fallback door)
  const givenStates = new Set(), ownFallbacks = [];
  // (her window probes, where they sit, and the moves of her own states:
  // the self-probe rule)
  const probeSites = [], ownMoves = new Map();
  // the giver idiom's hits on H numbers, counted after every file is read
  const kitHits = [];
  const movesOf = (lower) => {
    const at = [...lower.matchAll(/^\s*\[\s*statedef\s+(-?\d+)/gm)].map((m) => [m.index, parseInt(m[1], 10)]);
    for (let i = 0; i < at.length; i++) {
      const body = lower.slice(at[i][0], i + 1 < at.length ? at[i + 1][0] : lower.length);
      for (const blk of body.split(/^\s*\[\s*state\b/m).slice(1)) {
        if (!/^\s*type\s*=\s*(changestate|selfstate)\s*(;.*)?$/m.test(blk)) continue;
        const v = /^\s*value\s*=\s*(-?\d+)\s*(;.*)?$/m.exec(blk);
        if (!v) continue;
        if (!ownMoves.has(at[i][1])) ownMoves.set(at[i][1], new Set());
        ownMoves.get(at[i][1]).add(parseInt(v[1], 10));
      }
    }
  };
  let loaded = [];
  let cmdFile = null; // the def's cmd= entry, whatever its extension
  let animFile = null; // the def's anim= entry, whatever its extension
  let spriteFile = null; // the def's sprite= entry, read only if the rule below needs it
  try {
    const defText = fs.readFileSync(path.join(charDir, defName), 'latin1');
    for (const line of defText.split(/\r?\n/)) {
      const m = /^\s*(cmd|cns|st\d*|stcommon|anim|sprite)\s*=\s*(.+?)\s*(;.*)?$/i.exec(line);
      if (m) {
        const rel = m[2].replace(/"/g, '').replace(/\\/g, '/');
        if (m[1].toLowerCase() === 'sprite') { spriteFile = rel; continue; }
        loaded.push(rel);
        if (m[1].toLowerCase() === 'cmd') cmdFile = rel;
        if (m[1].toLowerCase() === 'anim') animFile = rel;
      }
    }
  } catch { if (fs.existsSync(path.join(charDir, defName))) report.incomplete = true; return out; }

  for (const rel of loaded) {
    const p = path.join(charDir, rel);
    let text;
    try {
      if (fs.statSync(p).size > 8e6) continue;
    } catch { continue; } // e.g. stcommon=common1.cns lives engine-side
    try { text = fs.readFileSync(p, 'latin1'); } catch { report.incomplete = true; continue; } // there, but would not read
    if (rel !== animFile && !rel.toLowerCase().endsWith('.air')) sabotageSites(text, rel, out.sabotage);

    // THE ANIM FILE IS WHATEVER `anim =` NAMES (2026-09-09), same lesson as
    // the state files: elektra's is `anim.txt`. Matching on `.air` skipped
    // it, so her animation table read as EMPTY - every ChangeAnim2 target
    // became "an anim she expects of a victim" (four of her own 500000-series
    // grab anims, six digits, so "H") -> GIVER, and with no table there were
    // no registry orphans -> not the RECEIVER she is (19230, 18300, 180501-3,
    // 1801131-3, 1805004, 80501 all shipped and never self-played).
    if (rel === animFile || rel.toLowerCase().endsWith('.air')) {
      for (const m of text.matchAll(/Begin Action\s+(\d+)/gi)) {
        out.airActions.add(parseInt(m[1], 10));
      }
      out.modules += (text.match(/Begin Action\s+(\d{5,})/gi) || []).length;
      // ...and WHAT each action draws, for the interface-card rule below.
      for (const [n, frames] of airFrames(text)) if (!out.airFrames.has(n)) out.airFrames.set(n, frames);
    } else if (rel === cmdFile) {
      // The def's cmd= entry, whatever its extension (.cmd, .txt, ...)
      for (const m of text.matchAll(/name\s*=\s*"([^"]+)"/g)) {
        if (H_COMMANDS.test(m[1])) out.commands.push(m[1]);
      }
      // Its [Statedef -1] triggers on commands too.
      stateTexts.push(text.toLowerCase());
      movesOf(text.toLowerCase());
    } else {
      // State file (any extension - .cns, .st, even .txt modules).
      // Giver fingerprint: SelfAnimExist(N) with a ChangeAnim/ChangeAnim2
      // setting value = N nearby - the compatibility-fallback idiom.
      // N in 0-999 and 5000-5999 (basic + required gethit anims) is the
      // same idiom used innocently by every character's common states.
      const lower = text.toLowerCase();
      stateTexts.push(lower);
      movesOf(lower);
      for (const m of lower.matchAll(/^\s*\[\s*statedef\s+(-?\d+)/gm)) statedefs.add(parseInt(m[1], 10));
      for (const m of lower.matchAll(/type\s*=\s*targetstate(?:(?!^\s*\[|^\s*type\s*=)[\s\S]){0,400}?^\s*value\s*=\s*(\d+)\s*(?:;.*)?$/gm)) targetStates.add(parseInt(m[1], 10));
      for (const m of lower.matchAll(/^\s*p2stateno\s*=\s*(\d+)/gm)) givenStates.add(parseInt(m[1], 10));
      // Every anim this character sends a ChangeAnim to (guarded or not). The
      // ones it does NOT itself ship are anims it expects of a VICTIM.
      // EXCEPT a plain ChangeAnim in the character's OWN movement and get-hit
      // states (statedefs 0-999 and 5000-5999): those play on itself. A DBZ
      // template (Goku Black, Super Janemba) picks its get-hit art from a
      // six-digit bank by var(0) - [State 5000] ChangeAnim value = 125030 - and
      // ships only some of the banks, so its own unshipped get-hit anims read
      // as 20 "H anims expected of a victim" and made it a giver. A scene is
      // played on a victim from a custom state, or with ChangeAnim2. Only the
      // H-number count (the `expects` door) reads this narrower set: the `probe`
      // door already has real H evidence (a receiver window probed) and its
      // threshold was measured on the full count - Batman, field-confirmed,
      // reaches 4 only with the 15110/15140 in his own state 5150.
      const sdAt = [...lower.matchAll(/^\s*\[\s*statedef\s+(-?\d+)/gm)].map((m) => [m.index, parseInt(m[1], 10)]);
      const stateAt = (i) => { let s = null; for (const [at, n] of sdAt) { if (at > i) break; s = n; } return s; };
      // ONE CONTROLLER'S VALUE, NEVER THE NEXT ONE'S (2026-10-09). A ChangeAnim
      // whose value is an expression (`value = anim`) has no number to give,
      // and the lazy match used to run on into the next controller and take
      // ITS value: Jon Talbain's Dragon Cannon ChangeAnim (`value = anim`) is
      // followed by a ChangeState to 503011, his custom target state, so four
      // ChangeStates read as "H anims expected of a victim" and made him a
      // giver. The match now stops at a line that opens a controller (`[`) or
      // names one (`type =`); an interval trigger's `[` mid-line is not one.
      // The same bound holds the TargetState and fallback readers.
      for (const m of lower.matchAll(/changeanim2?(?:(?!^\s*\[|^\s*type\s*=)[\s\S]){0,200}?value\s*=\s*(\d+)/gm)) {
        const n = parseInt(m[1], 10);
        if (!(n >= 1000 && !(n >= 5000 && n <= 5999))) continue;
        out.changeAnims.add(n);
        const sd = m[0].startsWith('changeanim2') ? null : stateAt(m.index);
        if (sd !== null && ((sd >= 0 && sd < 1000) || (sd >= 5000 && sd <= 5999))) continue;
        out.changeAnimsOnOthers.add(n);
      }
      // Anims this character plays ITSELF (statedef anim=, controller value=).
      // Used to tell a giver's own scene art from a receiver's pair anims.
      for (const m of lower.matchAll(/^\s*anim\s*=\s*(\d+)/gm)) out.playsOwn.add(parseInt(m[1], 10));
      for (const m of lower.matchAll(/^\s*value\s*=\s*(\d+)/gm)) out.playsOwn.add(parseInt(m[1], 10));
      for (const m of lower.matchAll(/selfanimexist\((\d+)\)/g)) {
        const n = parseInt(m[1], 10);
        if (n < 1000 || (n >= 5000 && n <= 5999)) continue;
        out.registry.add(n);
        // ASKING AN ENEMY IS SIZING UP, NOT HOLDING (2026-10-09). A giver asks
        // the victim it holds - `target, SelfAnimExist(19230)` - in the state
        // its grab gives her. Jesuszilla's cvs2 Felicia asks `Enemy(0),
        // SelfAnimExist(15951)` and 37 more, from her -2 and a helper, before
        // any contact, to score whether her OPPONENT is an H giver (her
        // "Anti-Rape system", GANKBANK) - and 9 windows probed made her one.
        // A probe through enemy or enemynear is no window probe.
        const before = lower.slice(Math.max(0, m.index - 40), m.index);
        if (inProbeWindow(n) && !/\benemy(near)?\s*(\(\s*[^()]*\))?\s*,\s*$/.test(before)) {
          probeSites.push({ n, sd: stateAt(m.index), red: /[a-z0-9_)]\s*,\s*$/.test(before) });
        }
        if (!isH(n)) continue;          // a throw's custom-state check, not a scene
        const region = lower.slice(Math.max(0, m.index - 400), m.index + 400);
        // (For the own-fallback door: her window asked of HER, un-redirected,
        // and a ChangeAnim2 beside it to an action of his.)
        if (inReceiverRegistry(n) && !/[a-z0-9_)]\s*,\s*$/.test(lower.slice(Math.max(0, m.index - 40), m.index))) {
          for (const c of region.matchAll(/changeanim2(?:(?!^\s*\[|^\s*type\s*=)[\s\S]){0,200}?value\s*=\s*(\d+)/gm)) ownFallbacks.push({ n, a: parseInt(c[1], 10), sd: stateAt(m.index) });
        }
        if (/changeanim/.test(region) &&
            new RegExp('value\\s*=\\s*' + m[1] + '\\b').test(region)) {
          // Counted once the animation file is read too (A THROW TABLE, below):
          // whether its controller tests the opponent's AUTHOR is known here.
          const head = lower.lastIndexOf('\n[', m.index);
          const next = lower.indexOf('\n[', m.index);
          const block = lower.slice(head < 0 ? 0 : head, next < 0 ? lower.length : next);
          kitHits.push({ n, authorGated: /\bauthorname\s*!?=\s*"/.test(block) });
        }
      }
    }
  }
  // A scene COMMAND that a loaded state actually triggers on. The name alone
  // proves nothing: Sakura's Command.cmd defines Doggystyle/Cowgirl/Fuck1-3
  // for a Filiamaru.cns her .def never loads (named 6, wired 0 -> receiver);
  // FutaCR R Mika's Feliciamaru.cns IS loaded and triggers on all 7 (BOTH).
  {
    const named = new Set(out.commands.map((c) => c.toLowerCase()));
    const wired = new Set(), dangling = new Set();
    // (A controller that only sends him to a state no loaded file defines is
    // no wiring: Ryougi Shiki's unfinished Futa edit wires "Rape" to 50000
    // and "Violent Grab" to 69990, and neither state exists anywhere.)
    const missing = (block) => {
      if (!/^\s*type\s*=\s*changestate\s*$/m.test(block)) return false;
      const v = /^\s*value\s*=\s*(\d+)\s*$/m.exec(block);
      if (!v) return false;
      const n = parseInt(v[1], 10);
      return n >= 1000 && !(n >= 5000 && n <= 5999) && !statedefs.has(n);
    };
    for (const t of stateTexts) {
      for (const block of t.replace(/;[^\n]*/g, '').split(/^\s*\[\s*state(?:def)?\b/m)) {
        for (const m of block.matchAll(/command\s*(?:=|!=)\s*"([^"]+)"/g)) {
          if (!named.has(m[1])) continue;
          if (missing(block)) dangling.add(m[1]); else wired.add(m[1]);
        }
      }
    }
    out.wiredCommands = [...wired];
  }
  // Giver: needs a KIT, not one incidental hook. Measured against the
  // community-labeled DB: real givers carry the imposed-scene idiom dozens of
  // times (DongHwan 83 hits, Minotaur 400+), while characters that merely
  // bundle a compat hook or a family template carry 1-6 (Mika 2, !shiki 1,
  // Akiha 6, ange 5, whip 6) - and the community calls those Victim-only.
  // NOTE: this does NOT chase the DB to zero on purpose. Some heavily-wired
  // futa edits (Filiamaru modules, 40-70 hits) are genuine giver CODE that the
  // DB still lists as Victim - the DB is curatorial ("what is it for"), we are
  // mechanical ("what can it do"). Those stay flagged, correctly.
  // A giver plays anims ON THE VICTIM that it does not own - that is literally
  // what imposing a scene means, and it catches light givers the kit-size test
  // misses (Batman: only 2 idiom hits but expects 4 anims of his victim, and is
  // field-confirmed BOTH; Mika has the same 2 hits but expects just 1 -> not a
  // giver). Measured expects-of-victim: DongHwan 47, Minotaur 167, Batman 4 vs
  // Mika 1, whip 1, Akiha 1, Bulleta 2, hotaru 0, KFM 0.
  // A PROBE SHE ASKS OF HERSELF IS NONE (2026-10-07). kyko's own ending
  // module checks SelfAnimExist(180110..180114) - her own DongHwan compat
  // actions - in states only her own ChangeStates reach (from her -2, never a
  // TargetState or p2stateno of hers), and that read as five windows probed.
  // A window probe counts when it is redirected (target,SelfAnimExist), or
  // sits in a state she gives someone, or in one her own moves never reach
  // from her negative and basic states. Measured over 1,818 characters.
  {
    const given = (sd) => targetStates.has(sd) || givenStates.has(sd);
    const own = new Set(), q = [];
    for (const sd of statedefs) if (sd < 0 || sd <= 199 || (sd >= 5000 && sd <= 5999)) { own.add(sd); q.push(sd); }
    for (const sd of ownMoves.keys()) if (sd < 0 && !own.has(sd)) { own.add(sd); q.push(sd); }
    while (q.length) { const s = q.shift(); for (const v of ownMoves.get(s) || []) if (!own.has(v) && !given(v)) { own.add(v); q.push(v); } }
    for (const p of probeSites) if (p.red || p.sd === null || !own.has(p.sd) || given(p.sd)) out.probesWindow.add(p.n);
  }
  // A THROW TABLE IS NOT AN H KIT (2026-10-09). "Six digits and up is a
  // private H registry" is right - over 2,584 distinct characters (every
  // G:\Game build, three MUGENs on the Desktop, mugen-web, the Studio's
  // bundles) the givers' kit and expects doors rest on 867 such numbers in
  // about 125 private registries, only DongHwan's named here (Tower of
  // Bloodyfight 220xxx/462xxx/805xxx, Brian 181xxx/680xxx, Kuromaru 1151xxx,
  // SLIME 114xxx, the ero helpers 3220xxx, Goblin Party 313245xxx...). It
  // decides only five verdicts: Z Helper Futa (a giver: Lewd.cns plays
  // 3228014... on its victim) and four throws. Two shapes of throw are set
  // aside here, for six-digit numbers outside every known family, in the kit:
  //  - a POSE IT SHIPS DRAWN FROM STANDARD GET-HIT SPRITES (every frame a
  //    group 5000-5999): KOF XIII Clark's 510066 (5040), Olga's command throw
  //    301336 (5450) - "the throw animation will look correct for any given
  //    character";
  //  - an idiom whose controller tests the opponent's AUTHOR: Mr. Heart's
  //    Hokuto table (`authorname="shuu" && SelfAnimExist(4477710)`).
  // Measured as evidence, not only verdicts (no other verdict can move): of
  // the 3,209 six-digit numbers behind the givers in the H builds, the two
  // set aside 25 (SLIME's get-hit fallbacks, one of Femina's) and no verdict;
  // they set aside all of Clark's, Heart's and Olga's. Testing the opponent's
  // NAME is no such sign - Kuromaru tailors 54 of his 63 by receiver name.
  // Rera's Mortal Kombat fatality states stay a giver (name gates).
  for (const hit of kitHits) {
    if (hit.n >= 100000 && !inAnyHFamily(hit.n)) {
      const fr = out.airFrames.get(hit.n);
      const getHitPose = !!fr && fr.size > 0 && [...fr].every((k) => { const g = parseInt(k.split(',')[0], 10); return g >= 5000 && g <= 5999; });
      if (getHitPose || hit.authorGated) continue;
    }
    out.giverHits++;
    out.giverHitNums.push(hit.n);
  }
  const expectsAll = [...out.changeAnims].filter(n => !out.airActions.has(n));
  const expectsOfVictim = expectsAll.length;
  out.expectsHNums = [...out.changeAnimsOnOthers].filter(n => !out.airActions.has(n)).filter(isH);
  const expectsH = out.expectsHNums.length;
  // FOUR WAYS TO BE A GIVER (2026-09-09; measured over 561 characters, see
  // GRAIL 4.3). Any one is enough:
  //  cmd    - a scene command (H_COMMANDS) that a loaded state triggers on
  //           (DongHwan manguri/slime, the FutaRB/BT/CR families, Sanae).
  //  kit    - the idiom on H numbers >= GIVER_KIT_MIN times (Minotaur 306).
  //  expects- plays >= GIVER_EXPECTS_MIN H anims on a victim it does not ship.
  //  probe  - probes a receiver WINDOW at least once and expects >= 4 anims of
  //           any number: Batman's rape.txt probes 19230 and plays 6621/3631
  //           via ChangeAnim2, so the idiom count sees him twice and the
  //           H-number filter would see him never. Field-confirmed BOTH.
  // The light case is still AND-gated: Makoto has 0 probes and 5 stray
  // ChangeAnim refs to anims she lacks (broken leftovers) and must not flag;
  // Kira has 22 throw-idiom hits, 0 window probes, 0 H expects -> receiver only.
  //  probes - asks a victim about GIVER_PROBE_MIN or more different registry
  //           windows. Added 2026-09-11 for ero_mukai, a confirmed giver that
  //           every other test missed, and the miss is instructive: it probes
  //           six windows across TWO families (Kuromaru 19230/12250/17230 and
  //           DongHwan 180100/180110/180130) yet counts 0 giver hits and only 2
  //           expects. Both other signals are defeated by how it is written -
  //           its checks are `target,SelfAnimExist(N)` rather than the
  //           self-directed form the idiom counter pairs on, and its scene
  //           anims are COMPUTED (`ChangeAnim2 value = 3000000 + StateNo`), so
  //           the literal-number parser sees 5 targets out of 92 ChangeAnim
  //           statements. A giver written with expressions is invisible to any
  //           rule that counts literals; the windows it probes are literals.
  //  futa   - THE FUTA BRAND'S OWN DOOR (2026-09-20). FutaNT, FutaBT and FutaLB
  //           givers share one skeleton whatever their generation: a grab state
  //           50100 that TargetStates the victim into 50002, and a loop state
  //           that TargetStates her into 50004. None of the rules above can
  //           see them: the victim's anim is COMPUTED (`ChangeAnim2 value =
  //           StateOwner,anim + 1000`), there is no SelfAnimExist/ChangeAnim
  //           pair around a literal, and the one probe (122331) is a flag, not
  //           a window. Android 21, Morrigan and Weiss read as not-givers at
  //           all. Measured over 829 characters: the door opens for the five
  //           Futa givers on hand and three FutaBT characters that already had
  //           a wired command, and for nothing else.
  const futa = statedefs.has(50100) && targetStates.has(50002) && targetStates.has(50004);
  out.futa = futa;
  //  fallback - THE OWN-FALLBACK DOOR (2026-10-07). A Kuromaru dog template
  //           (Black.T, Marasama's creatures) asks her one window in the state
  //           his grab gives her - `SelfAnimExist(19230)` - and falls back
  //           with ChangeAnim2 to an action of his own that draws that very
  //           sprite group (his 6621 is 19230,0..2), else to one on her
  //           get-hit sprites (3631). Every door above counts literals this
  //           shape never writes: one window, no unshipped anim, no
  //           ChangeAnim to the probed number. The door: a probe of her
  //           window, un-redirected, in a state his TargetState or p2stateno
  //           gives someone, with a ChangeAnim2 beside it to an action of his
  //           that draws the probed number's sprite group.
  const fallbackHits = ownFallbacks.filter((f) => (targetStates.has(f.sd) || givenStates.has(f.sd)) && out.airFrames.has(f.a)
    && [...out.airFrames.get(f.a)].some((k) => parseInt(k, 10) === f.n)).length;
  out.why = out.wiredCommands.length ? 'cmd'
    : futa ? 'futa'
    : out.giverHits >= GIVER_KIT_MIN ? 'kit'
    : expectsH >= GIVER_EXPECTS_MIN ? 'expects'
    : out.probesWindow.size >= GIVER_PROBE_MIN ? 'probes'
    : (out.probesWindow.size >= 1 && expectsOfVictim >= GIVER_EXPECTS_MIN) ? 'probe'
    : fallbackHits >= 1 ? 'fallback' : '';
  out.giver = !!out.why;

  // Receiver: ships registry pair-anims that it never plays ITSELF ("orphans").
  // Both sides of a scene animate, and a GIVER's own scene art sits in the same
  // numeric ranges - so merely counting registry anims flags givers too
  // (DongHwan/Minotaur were wrongly marked receivers). The real tell is that a
  // receiver's pair anims are orphans: present in the .air but referenced only
  // by the GIVER's imposed state code, never by the character's own states.
  // Field-validated separation: givers 1-5 orphans (2-25% of their registry
  // anims), true receivers 18-104 (89-100%).
  // A CARD IS NOT PAIR ART (2026-09-20). An imported build can write its own
  // interface art straight through a registry window: the CvS Rev 2 add004 pass
  // installs a versus-intro system numbered in four parallel series
  // (80000/85000/90000/95000 + var(10)*10), and the 80000 one lands inside
  // Filiamaru's. Those cards are drawn with a COMPUTED number
  // (`anim = 80000 +var(10)*10`), which the literal parser above cannot see -
  // the same blind spot ero_mukai shows, firing the other way: there it hid a
  // giver, here it manufactured a receiver out of caption plates. Jae Hoon and
  // Blue Mary were flagged off "Mary vs Terry text".
  //
  // What separates a card from pair art is what it draws. BOTH halves are
  // needed, measured over 624 characters that ship registry anims:
  //  - every frame in the interface sprite bank (groups 9000-9999) ALONE drops
  //    shermieKO, whose pair anims 17850-17852 are 9005 sprites she really
  //    ships - a 117x98 body pose, not a portrait;
  //  - every frame MISSING from her own .sff alone drops twelve receivers whose
  //    art references sprites they never shipped (elektra, tia, choi, aeris...).
  // Together: an action that draws nothing but interface sprites the character
  // does not even have. Nothing in the corpus loses its badge, nothing gains
  // one, and both CvS builds come clean. The .sff is read only when such a
  // candidate exists, so an ordinary character never pays for it.
  {
    const uiOnly = (n) => {
      const f = out.airFrames.get(n);
      return !!f && f.size > 0 && [...f].every((k) => {
        const g = parseInt(k.split(',')[0], 10);
        return g >= 9000 && g <= 9999;
      });
    };
    const candidates = [...out.airActions].filter((n) => inReceiverRegistry(n) && !out.playsOwn.has(n) && uiOnly(n));
    if (candidates.length) {
      let keys = null;
      try { keys = spriteFile ? sffSpriteKeys(resolveCI(charDir, spriteFile) || path.join(charDir, spriteFile), report) : null; } catch (e) { keys = null; report.incomplete = true; }
      // No readable sprite file: nothing is dropped, the verdict stands as before.
      if (keys && keys.size) {
        for (const n of candidates) {
          if ([...out.airFrames.get(n)].every((k) => !keys.has(k))) out.uiCards.add(n);
        }
      }
    }
  }
  // A FUTA GIVER'S 70000s AND 80000s ARE ITS WORKING TABLES, NOT PAIR ART
  // (2026-09-20). The brand numbers everything inside Filiamaru's windows: the
  // giver's own poses at 70xxx/80xxx, played by a computed number
  // (`70000 + fvar(32) + fvar(31)`) the literal parser cannot see, and beside
  // them the VICTIM tables at 71xxx/81xxx - actions the giver carries so its
  // ChangeAnim2 can drive a victim's sprites. Both read as unused pair
  // animations, so every Futa giver also read as a receiver. Weiss is the
  // clean case: her .sff holds none of the sprite groups a victim is drawn
  // from (12250/17230/19230 or the Plus sets) and no flag, so no giver can draw
  // her - confirmed in play - yet 103 such "orphans" badged her RECEIVER. What
  // makes a Futa giver a receiver as well is real: the 122331 flag (below), or
  // pair art of another family - Marilyn ships 102 drawable Kuromaru, Minotaur
  // and DongHwan actions and stays both, as she is in play.
  const inFilia = (n) => (n >= 70000 && n <= 71999) || (n >= 80000 && n <= 81999);
  // A HUD BANK IS NOT PAIR ART (2026-10-09). The Ikemen Fighting Collection's
  // 33 Street Fighter conversions (Mr. I, with Violin Ken) were all badged
  // RECEIVER in a build with no H content: each draws its own meters - USF4's
  // Revenge and Super bars, SFV's V-Meter and stun bar - as Explods that pick a
  // frame from a numbered bank by a COMPUTED number (`anim = 17801 + (time %
  // 63) + ifelse(root, var(3) >= 1000, 100, 0)`, `anim = 19299 + cond(...,
  // 31, floor(root, var(3) / 10))`), and the banks run straight through
  // Kuromaru's windows (17850-17869, 18300-18309, 19230-19239). The literal
  // parser above never sees those frames played, so every one read as an
  // orphan pair animation - the add004 cards' blind spot again (uiCards), on
  // art the character DOES ship, which that rule rightly keeps. An Explod is
  // art a character draws over itself; a giver never plays pair art through
  // the victim's Explods. So the numbers a computed Explod anim of its own can
  // reach are set aside here, like a card (hudRunsOf). Measured over 1,783
  // characters (every G:\Game build, the Rapers folder, the Main cache): 37 of
  // the collection's receivers clear and NO other verdict changes anywhere -
  // Kirino keeps hers: her gauge helper's 80000-80207 and support icons
  // 71508-71515 are set aside and 108 of her 166 remaining pair actions are
  // still unplayed. Counting such actions as played-by-itself instead (kept
  // in the count) cost her the badge; that is why they leave the count here.
  out.hudRuns = hudRunsOf(stateTexts, out.airActions);
  const regShipsNow = () => [...out.airActions].filter((n) => inReceiverRegistry(n) && !out.uiCards.has(n)
    && !out.hudRuns.has(n) && !out.blankArt.has(n) && !(futa && inFilia(n)));
  // ...and a SMALL tailored set still counts when it is all orphans: Gardevoir
  // ships 5 (18300 + four of DongHwan's), never plays one, and was one short
  // of the 6. Givers cannot sneak in here - their ratio is 2-25%.
  const tailored = (orph, ships) => {
    const ratio = orph / Math.max(1, ships);
    return (orph >= 6 && ratio >= 0.5) || (orph >= 4 && ratio >= 0.9);
  };
  let regShips = regShipsNow();
  let orphans = regShips.filter(n => !out.playsOwn.has(n));
  // A RECEIVER STRIPPED OF ITS ART (2026-10-09). Schlussel, in the same
  // collection, ships 110 pair actions and not one of their 707 frames: the
  // NSFW sprites were cut from the .sff and the actions left behind, so no
  // giver can draw her - she would vanish in any scene. For a character that
  // is not a giver, a pair action that draws NOTHING the sprite file holds
  // does not count. A giver keeps the old reading: its unplayed window actions
  // that draw nothing of its own are often victim tables meant to be drawn
  // with a victim's sprites (the Futa brand's, above) - the twelve characters
  // that cost the "missing sprites alone" design its place in September
  // (elektra, choi, aeris...) are all givers, and none of them changes here.
  // The .sff is read only for a non-giver the orphan rule would badge.
  if (!out.giver && tailored(orphans.length, regShips.length)) {
    let keys = null;
    try { keys = spriteFile ? sffSpriteKeys(resolveCI(charDir, spriteFile) || path.join(charDir, spriteFile), report) : null; } catch (e) { keys = null; report.incomplete = true; }
    // No readable sprite file: nothing is dropped, the verdict stands as before.
    if (keys && keys.size) {
      for (const n of orphans) {
        const f = out.airFrames.get(n);
        if (f && f.size && [...f].every((k) => !keys.has(k))) out.blankArt.add(n);
      }
      if (out.blankArt.size) {
        regShips = regShipsNow();
        orphans = regShips.filter(n => !out.playsOwn.has(n));
      }
    }
  }
  if (tailored(orphans.length, regShips.length)) {
    out.receiver = true;
    out.receiverWhy = 'orphans';
  }
  // THE FUTA FLAG. A victim of this brand needs no actions at all - the giver
  // plays its own tables on her sprites - so the orphan test has nothing to
  // count on supergirl's classic art, and Lilith and Athena read as nothing.
  // What she ships instead is the flag action (H_FAMILIES, flag: true), which
  // the giver's tailored branch is keyed on. One action is the whole signal.
  if (!out.receiver) {
    const flags = H_FAMILIES.filter((f) => f.flag).flatMap((f) => f.ranges);
    if ([...out.airActions].some((n) => flags.some(([a, b]) => n >= a && n <= b))) {
      out.receiver = true;
      out.receiverWhy = 'flag';
    }
  }
  out.commands = [...new Set(out.commands)];
  // What this giver actually asks of a victim, for the cross-character rule:
  // only its H numbers. Kira's throw checks (10050-10052) made Iori "her
  // receiver" because he ships two of them.
  out.registryH = new Set([...out.registry].filter(isH));
  return out;
}

// --- character scale ---------------------------------------------------------
// MUGEN has no uniform size standard: on-screen size = sprite dimensions x
// localcoord x [Size] xscale/yscale, and every author picks differently, so
// some characters land oversized/undersized next to each other. The clean knob
// is [Size] xscale/yscale - the engine applies it to sprites AND collision
// boxes (char.go), so gameplay stays consistent. We store the character's
// ORIGINAL scale once and always write original x multiplier, so repeated
// slider changes never compound and 1.0 restores the character exactly.

function charCnsPath(folder) {
  const dir = path.join(CACHE, folder);
  const roster = readRoster();
  const c = roster.chars.find(x => x.folder === folder);
  if (!c) throw new Error('no such character: ' + folder);
  const defName = c.select.split('/').slice(1).join('/');
  const defText = fs.readFileSync(path.join(dir, defName), 'latin1');
  const m = /^\s*cns\s*=\s*(.+?)\s*(;.*)?$/mi.exec(defText);
  if (!m) throw new Error('character has no cns= entry in its .def');
  return path.join(dir, m[1].replace(/"/g, '').replace(/\\/g, '/').trim());
}

// Read/patch xscale+yscale scoped to the [Size] section (xscale can appear
// elsewhere; a global replace would corrupt unrelated values).
// Health and movement speed, the two Advanced edits the desktop Studio was
// missing while Lite had them.
//
// Both patch from the ORIGINAL text, snapshotted on the FIRST edit into
// c.baseConsts, so repeated changes never compound - setting 1.5x speed twice
// gives 1.5x, not 2.25x, and there is always a way back. Same contract as
// setCharScale above and as the browser Studio.
//
// life is ABSOLUTE (a player thinks "give them 1500"); speedMult is a
// MULTIPLIER, because movement is four vector values and scaling them together
// keeps the character's authored feel.
function setCharConsts(folder, life, speedMult) {
  const roster = readRoster();
  const c = roster.chars.find(x => x.folder === folder);
  if (!c) throw new Error('no such character: ' + folder);
  const cns = charCnsPath(folder);
  if (!cns || !fs.existsSync(cns)) throw new Error('this character has no cns to edit');

  // The snapshot must be taken BEFORE the first write, or "original" would mean
  // "whatever it was last set to".
  let text = fs.readFileSync(cns, 'latin1');
  if (!c.baseConsts) {
    c.baseConsts = readCharConsts(text);
    if (!c.baseScale) c.baseScale = readSizeScale(text);
    writeRoster(roster);
  }
  // Re-read is deliberate: applyEdits patches from the base VALUES, but the
  // file on disk may already carry a size edit we must not undo.
  const r = charconstCore.applyEdits(text, c.baseConsts, {
    life: life,
    speed: speedMult,
    // scale left undefined: setCharScale owns [Size], and passing it here would
    // re-apply the multiplier on top of the file's existing scaled values.
  });
  fs.writeFileSync(cns, r.text, 'latin1');
  c.life = r.life;
  c.speed = r.speed;
  writeRoster(roster);
  return { folder, life: r.life, speed: r.speed };
}

// Put a character back exactly as it was added: original health, original
// speed, original size, and the rest of the constants the card edits. Only
// possible because every one of them was snapshotted before its first write.
//
// The stats go back FIRST and through their own byte splice, because that
// splice's offsets are offsets into the file as it is now: the whole-file
// patches below would move them.
function resetCharConsts(folder) {
  const roster = readRoster();
  const c = roster.chars.find(x => x.folder === folder);
  if (!c) throw new Error('no such character: ' + folder);
  if (!c.baseConsts && !c.baseScale && !c.baseStats) return { folder, reset: false };
  const cns = charCnsPath(folder);
  if (c.baseStats) {
    const cleared = {};
    for (const f of charstats.FIELDS) cleared[f.id] = null;
    writeCharStats(cns, c.baseStats, cleared);
    delete c.stats;
  }
  let text = fs.readFileSync(cns, 'latin1');
  if (c.baseConsts) {
    text = patchCharConsts(text, c.baseConsts.life, c.baseConsts.speed);
  }
  if (c.baseScale) text = patchSizeScale(text, c.baseScale.x, c.baseScale.y);
  fs.writeFileSync(cns, text, 'latin1');
  delete c.life; delete c.speed; c.scale = 1;
  writeRoster(roster);
  return { folder, reset: true };
}

// ---- the rest of the character constants ------------------------------------
//
// Attack, defence, the two meters, the jump speeds, gravity and friction, from
// the card's Advanced side. charstats.js holds the engine rules and the whole
// text model; this is the roster half: which file, the snapshot taken before
// the first write, and what the card shows afterwards.
//
// THE WRITE IS A BYTE SPLICE, not a re-serialize: only the bytes of the number
// change, so the author's comments, column alignment, Shift-JIS text and the
// file's own line endings come back identical. Health, speed and size still go
// through charconst-core's line patcher above - they were there first and they
// rewrite whole lines by design.
function writeCharStats(cnsPath, base, wanted) {
  const text = fs.readFileSync(cnsPath, 'latin1');
  const plan = charstats.planStats(text, base, wanted);
  if (!plan.first.length && !plan.second.length) return { changed: false, notes: plan.notes };
  charedit.writeSpliced(cnsPath, null, {
    expectText: text,
    passes: [plan.first, plan.second],
    // The card's constants are restored from the snapshot, not from a .bak -
    // see the note on writeSpliced.
    backup: false,
    // RE-READ WITH THE SAME SCANNER AND CHECK WHAT WE MEANT IS WHAT IS THERE.
    // The engine reports nothing at all when a value is malformed, so this is
    // the only check that ever runs: every field the plan asked for reads back
    // as exactly that number, no other exposed field moved, and the file still
    // has the same count of lines outside the ones we touched.
    validate: (newText) => {
      const after = charstats.readStats(newText);
      for (const [id, want] of Object.entries(plan.target)) {
        const h = after.fields[id];
        if (want === null) {
          if (h.present) return id + ' should have gone back to what the character shipped with';
          continue;
        }
        if (!h.present || h.raw !== want) return id + ' reads back as ' + JSON.stringify(h.raw) + ', not ' + JSON.stringify(want);
      }
      for (const s of charstats.SECTIONS) {
        if (plan.read.sections[s].present && !after.sections[s].present) return 'the [' + s + '] section disappeared';
      }
      return null;
    },
  });
  return { changed: true, notes: plan.notes };
}

// What the panel shows: every exposed constant with the value in the file, the
// value the character shipped with, what the engine would use if the key were
// absent, and what else each one moves.
function charStats(folder) {
  const roster = readRoster();
  const c = roster.chars.find(x => x.folder === folder);
  if (!c) throw new Error('no such character: ' + folder);
  const cns = charCnsPath(folder);
  if (!cns || !fs.existsSync(cns)) throw new Error('this character has no cns to edit');
  const text = fs.readFileSync(cns, 'latin1');
  // localcoord decides what a gravity or jump number MEANS: only the engine's
  // built-in defaults are scaled by localcoord[0]/320, so a 640-wide
  // character's own numbers live in its own space and the typical band has to
  // be scaled to match (char.go:7847-7920).
  let localcoord = 320;
  try {
    const dir = path.join(CACHE, c.folder);
    const defName = c.select.split('/').slice(1).join('/');
    const kv = parseDefSections(fs.readFileSync(path.join(dir, defName), 'latin1'));
    const m = /^\s*(-?\d+)/.exec(String(kv['localcoord'] || ''));
    if (m) localcoord = parseInt(m[1], 10) || 320;
  } catch (e) { /* no localcoord line: the engine's own 320 stands */ }
  const model = charstats.describe(text, c.baseStats, c.stats, localcoord);
  return Object.assign({ folder, file: path.relative(path.join(CACHE, c.folder), cns).replace(/\\/g, '/') }, model);
}

// Write the values the panel sends. Absent from the body = untouched; null or
// empty = back to what the character shipped with.
function setCharStats(folder, values) {
  const roster = readRoster();
  const c = roster.chars.find(x => x.folder === folder);
  if (!c) throw new Error('no such character: ' + folder);
  const cns = charCnsPath(folder);
  if (!cns || !fs.existsSync(cns)) throw new Error('this character has no cns to edit');

  // The snapshot has to be taken BEFORE the first write, or "what it shipped
  // with" would mean "whatever the last edit left".
  if (!c.baseStats) {
    c.baseStats = charstats.snapshot(fs.readFileSync(cns, 'latin1'));
    writeRoster(roster);
  }
  // THE WHOLE WANTED STATE, not the delta. Every field is patched from the
  // snapshot, so a field left out of the plan goes BACK to what the character
  // shipped with - which is what makes a reset possible and repeated edits
  // never compound. The panel sends only what it changed, so the values
  // already set have to be carried in or the next edit would quietly undo them.
  const wanted = Object.assign({}, c.stats);
  for (const [id, v] of Object.entries(values || {})) {
    if (!charstats.BY_ID.has(id)) continue;                 // unknown key: ignored, not guessed at
    if (v === null || v === undefined || v === '') delete wanted[id];
    else wanted[id] = v;
  }
  const r = writeCharStats(cns, c.baseStats, wanted);

  // Stored SPARSE, the way the engine settings are: a value put back to what
  // the character shipped with is removed, so the card's "!" marker and the
  // reset button mean exactly "something here is not what it shipped with".
  const stats = {};
  for (const [id, v] of Object.entries(wanted)) {
    stats[id] = charstats.parseValue(charstats.BY_ID.get(id), v).text;
  }
  if (Object.keys(stats).length) c.stats = stats; else delete c.stats;
  writeRoster(roster);
  return { folder, stats: c.stats || {}, changed: r.changed, notes: r.notes };
}

function setCharScale(folder, mult) {
  // Range is deliberately narrow (0.75x-1.25x): this exists to nudge a
  // character into proportion with the rest of the roster, not to resize it
  // dramatically. 0.25x steps proved far too coarse - the useful corrections
  // are small (0.90/0.95), so callers step by 0.05.
  mult = Math.min(1.25, Math.max(0.75, Number(mult) || 1));
  const roster = readRoster();
  const c = roster.chars.find(x => x.folder === folder);
  if (!c) throw new Error('no such character: ' + folder);
  const cns = charCnsPath(folder);
  let text = fs.readFileSync(cns, 'latin1');
  if (!c.baseScale) c.baseScale = readSizeScale(text); // capture original once
  const nx = +(c.baseScale.x * mult).toFixed(4), ny = +(c.baseScale.y * mult).toFixed(4);
  fs.writeFileSync(cns, patchSizeScale(text, nx, ny), 'latin1');
  c.scale = mult;
  writeRoster(roster);
  return { folder, scale: mult, applied: { xscale: nx, yscale: ny } };
}

// --- SFF v1 palette repair ---------------------------------------------------
// Mechanics + effect-aware repair logic live in sffpal.js; this wraps it
// with roster/def lookups.

const sffpal = require('./sffpal');

function sffVersion(sffPath) {
  try {
    const fd = fs.openSync(sffPath, 'r');
    const b = Buffer.alloc(16);
    fs.readSync(fd, b, 0, 16, 0);
    fs.closeSync(fd);
    if (b.toString('ascii', 0, 11) !== 'ElecbyteSpr') return null;
    return b[15] === 2 ? 2 : 1;
  } catch { return null; }
}

// WHICH ROSTER ENTRY A REPAIR MEANS. One folder can hold two entries: a
// version added beside the first (addCharVariant) whose .def names a sprite
// file of its own (a v1 MakotoWin beside a v2 Makoto). With the entry's
// select (`opts.select` from the route, c.select on the card), THAT entry;
// without one, the first entry with this folder, as it always was. A select
// that names no entry of this folder is refused rather than quietly read as
// the first one, which would repair the sibling's file.
function repairSelect(opts) {
  return opts && typeof opts === 'object' && typeof opts.select === 'string' ? opts.select : '';
}
function rosterEntryOf(folder, sel) {
  const chars = readRoster().chars;
  const c = sel ? chars.find(x => x.folder === folder && x.select === sel) : chars.find(x => x.folder === folder);
  if (!c) throw new Error('no such character: ' + folder);
  return c;
}
// The sprite file a .def names, read off that def - no roster lookup.
function defSffPath(dir, defName) {
  const kv = parseDefSections(fs.readFileSync(path.join(dir, defName), 'latin1'));
  if (!kv['sprite']) throw new Error('def has no sprite= entry');
  return path.join(dir, kv['sprite'].replace(/\\/g, '/'));
}
function mainSffPath(folder, sel) {
  const c = rosterEntryOf(folder, sel);
  return defSffPath(path.join(CACHE, folder), c.select.split('/').slice(1).join('/'));
}

// An SFF v2 keeps its palettes internally, and common1's state 5900 applies the
// player's choice with `remapPal source: 1,1 dest: 1,palNo` - the only thing that
// applies it for v2 characters. That needs a palette keyed (1,1) to read from.
// Characters converted up from v1 often have theirs keyed (0,0), (0,1)... so the
// remap has no source, the def's pal1..palN land in slots no sprite is indexed
// against, and every slot looks selectable while none of them do anything.
//
// Returns the body palette's index and current key, or null if it's already fine.
function inspectPalKeys(sffPath) {
  if (sffVersion(sffPath) !== 2) return null;
  const b = fs.readFileSync(sffPath);
  const firstSprOfs = b.readUInt32LE(0x24), nSpr = b.readUInt32LE(0x28);
  const firstPalOfs = b.readUInt32LE(0x2C), nPal = b.readUInt32LE(0x30);
  if (!nPal || !nSpr) return null;

  // The body palette is whichever palette the MOST sprites draw with, with
  // sprite (0,0) - the standing stance - breaking ties.
  //
  // Deliberately not the select portrait (9000,0), which the old rule
  // preferred. It is usually the first sprite in the file, and on converted
  // characters it often carries a private palette serving that one sprite;
  // re-keying THAT leaves the body's palette unkeyed, so forceRemapPal still
  // treats it as private and every color slot renders the body identically.
  // When the two palettes happen to hold the same colors - common, since the
  // portrait is drawn from the same art - the repair looks like it did nothing
  // at all. Sprite (0,0) alone is not enough either: some characters give it
  // its own palette too.
  const counts = new Map();
  let zeroPal = -1;
  for (let i = 0; i < nSpr; i++) {
    const o = firstSprOfs + i * 28;
    const g = b.readUInt16LE(o), n = b.readUInt16LE(o + 2), p = b.readUInt16LE(o + 24);
    counts.set(p, (counts.get(p) || 0) + 1);
    if (zeroPal < 0 && g === 0 && n === 0) zeroPal = p;
  }
  let bodyPal = -1, best = -1;
  for (const [p, c] of counts) if (c > best || (c === best && p === zeroPal)) { best = c; bodyPal = p; }
  if (bodyPal < 0) return null;
  if (bodyPal >= nPal) return null;

  // Healthy ONLY when the BODY's node IS the (1,1) node - not merely when some
  // node somewhere is keyed (1,1).
  //
  // GRAIL 4.9: the select-screen preview follows the color pick only if the
  // sprite the motif draws ends preloadSff with palidx == 0, and that happens
  // only for sprites whose palette-node index equals coloredPalette - the index
  // of the (1,1) node (image.go:1744-1753). The motif draws p1.face.anim = 0,
  // the STANCE animation, whose frames are body sprites.
  //
  // The old test bailed as soon as ANY node was keyed (1,1). On nearly every
  // character that node IS the body's, so the shortcut held. Aoko Aozaki is the
  // counter-example: 667 body sprites sit on node 0 (keyed 1,0) while node 1
  // carries the (1,1) key, so coloredPalette is 1, no stance frame ever reaches
  // palidx 0, the preview stays default - and the Studio reported her healthy
  // and offered no repair (field-hit 2026-08-11). In-game color still works
  // because that is a different path entirely (state 5900 -> remappal ->
  // plist.Remap), which does not care about node-index equality.
  let keyedIdx = -1;
  for (let i = 0; i < nPal; i++) {
    const p = firstPalOfs + i * 16;
    if (b.readUInt16LE(p) === 1 && b.readUInt16LE(p + 2) === 1) { keyedIdx = i; break; }
  }
  if (keyedIdx === bodyPal) return null; // the body already owns the (1,1) key

  const o = firstPalOfs + bodyPal * 16;
  return {
    index: bodyPal,
    key: `${b.readUInt16LE(o)},${b.readUInt16LE(o + 2)}`,
    sprites: counts.get(bodyPal) || 0,
    total: nPal,
    // ANOTHER node already holds (1,1), so the rename this tool performs would
    // produce TWO nodes keyed (1,1) and destroy whatever key the body node had.
    // Diagnosis and repair part company here: the preview really is broken (the
    // body is not on the coloredPalette node), but renaming is NOT the cure.
    //
    // Aoko Aozaki is the shape that taught this: nodes 0-6 keyed
    // (1,0)(1,1)(1,2)...(1,6) - a complete, contiguous seven-slot color set
    // that simply starts at item 0 instead of 1. Renaming node 0 to (1,1)
    // duplicated node 1's key, annihilated the (1,0) slot, and left her stuck
    // on one wrong color in-game whatever the player picked, having previously
    // been perfect in-game (field-hit 2026-08-11). Fixing that shape means
    // SHIFTING the whole group, which also moves what the def's pal1..palN
    // refer to - a different operation, not this one.
    conflict: keyedIdx >= 0,
    conflictIndex: keyedIdx,
  };
}

// Decode an SFFv2 PNG8 sprite and report which palette indices its pixels use.
// Only fmt 10 (PNG8) is handled; the RLE/LZ5 formats return null so callers can
// refuse rather than answer from partial data.
function spriteUsedIndices(b, sprOfs, i, ldata) {
  const o = sprOfs + i * 28;
  const w = b.readUInt16LE(o + 4), h = b.readUInt16LE(o + 6);
  if (b[o + 14] !== 10) return null; // not PNG8
  const dofs = b.readUInt32LE(o + 16), dlen = b.readUInt32LE(o + 20);
  if (!dlen || !w || !h) return new Set();
  const raw = b.slice(ldata + dofs, ldata + dofs + dlen);
  const p = raw.indexOf(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  if (p < 0) return null;
  const png = raw.slice(p);
  let j = 8;
  const idat = [];
  let bitDepth = 8, colorType = 3;
  while (j + 8 <= png.length) {
    const ln = png.readUInt32BE(j), typ = png.toString('latin1', j + 4, j + 8);
    if (typ === 'IHDR') { bitDepth = png[j + 16]; colorType = png[j + 17]; }
    if (typ === 'IDAT') idat.push(png.slice(j + 8, j + 8 + ln));
    if (typ === 'IEND') break;
    j += 12 + ln;
  }
  if (bitDepth !== 8 || colorType !== 3 || !idat.length) return null;
  let inf;
  try { inf = zlib.inflateSync(Buffer.concat(idat)); } catch { return null; }
  const stride = w + 1;
  if (inf.length < stride * h) return null;
  const used = new Set();
  const prev = new Uint8Array(w), cur = new Uint8Array(w);
  for (let y = 0; y < h; y++) {
    const ft = inf[y * stride];
    for (let x = 0; x < w; x++) {
      const rb = inf[y * stride + 1 + x];
      const a = x > 0 ? cur[x - 1] : 0, bb = prev[x], c = x > 0 ? prev[x - 1] : 0;
      let v;
      switch (ft) {
        case 0: v = rb; break;
        case 1: v = rb + a; break;
        case 2: v = rb + bb; break;
        case 3: v = rb + ((a + bb) >> 1); break;
        case 4: {
          const pp = a + bb - c, pa = Math.abs(pp - a), pb = Math.abs(pp - bb), pc = Math.abs(pp - c);
          v = rb + (pa <= pb && pa <= pc ? a : pb <= pc ? bb : c); break;
        }
        default: return null;
      }
      cur[x] = v & 0xff;
      used.add(cur[x]);
    }
    prev.set(cur);
  }
  return used;
}

// Which palette indices does the character's pair art draw with?
//
// This is what makes re-keying dangerous. A character's pair sprites are
// usually indexed against the SAME palette as its body, but the def's pal files
// are costume recolors - whoever made them was recoloring an outfit, and the
// pair art is typically bolted on later by a different editor. So the moment
// palette selection starts working, picking a color repaints the pair scenes
// with colors nobody chose for them.
//
// It can't be repaired by copying the character's own colors back over those
// indices either: measured on Sakura, every index her pair art uses is ALSO
// used by her ordinary sprites, so the same index has to be one color on her
// costume and another in a scene. Only redrawing the pal files fixes that.
//
// Returns null if anything can't be decoded - better to refuse than to answer
// from partial data.
function pairArtPaletteIndices(sffPath, bodyPal) {
  const b = fs.readFileSync(sffPath);
  if (b[15] !== 2) return null;
  const sprOfs = b.readUInt32LE(0x24), nSpr = b.readUInt32LE(0x28);
  const ldata = b.readUInt32LE(0x34);

  // A sprite with no data of its own is a link: it reuses another sprite's
  // pixels but keeps its own group, so resolve it rather than decode it.
  const decoded = new Map();
  const wanted = [];
  for (let i = 0; i < nSpr; i++) {
    const o = sprOfs + i * 28;
    if (b.readUInt16LE(o + 24) !== bodyPal) continue; // its own palette, not our problem
    // Skip non-scene art BEFORE decoding it. This filter used to run in the
    // second loop, so an ordinary body sprite in a format spriteUsedIndices
    // cannot read (it only does PNG8) aborted the whole check - even though
    // that sprite could never be repainted, because only scene art can be.
    // Aoko Aozaki has no scene art at all and 1517 of her 1605 sprites ARE
    // PNG8, but her hit/fall groups 5001-5042 are LZ5/raw, so the answer came
    // back "unknown" and the repair refused itself (field-hit 2026-08-11).
    // Filtering first means an undecodable sprite only blocks the answer when
    // it is genuinely scene art - which is the case the guard exists for.
    const group = b.readUInt16LE(o);
    if (!inReceiverRegistry(group)) continue;
    const src = b.readUInt32LE(o + 20) > 0 ? i : b.readUInt16LE(o + 12);
    wanted.push({ group, src });
    if (!decoded.has(src)) {
      const used = spriteUsedIndices(b, sprOfs, src, ldata);
      if (used === null) return null;
      decoded.set(src, used);
    }
  }

  const hUsed = new Set();
  for (const { src } of wanted) {
    const used = decoded.get(src);
    if (!used) return null;
    for (const v of used) hUsed.add(v);
  }
  return [...hUsed].sort((x, y) => x - y);
}

// How many colors would picking a palette change in this character's pair art?
//
// Compares every pal file the def points at against the character's own palette,
// at the indices the pair art draws with. Zero means selection is safe to turn
// on. Anything else means the scenes get repainted, which is what a player sees
// as an H scene "going corrupt" the moment they cycle colors.
function pairArtRepaintCount(folder, sffPath, bodyPal, sel) {
  const idx = pairArtPaletteIndices(sffPath, bodyPal);
  if (idx === null) return null;
  if (!idx.length) return 0;

  const b = fs.readFileSync(sffPath);
  const po = b.readUInt32LE(0x2C) + bodyPal * 16;
  const at = b.readUInt32LE(0x34) + b.readUInt32LE(po + 8);
  const size = b.readUInt32LE(po + 12);
  const internal = [];
  for (let i = 0; i < size / 4; i++) internal.push([b[at + i * 4], b[at + i * 4 + 1], b[at + i * 4 + 2]]);

  const dir = path.join(CACHE, folder);
  let c;
  try { c = rosterEntryOf(folder, sel); } catch (e) { return null; }
  const defName = c.select.split('/').slice(1).join('/');
  const kv = parseDefSections(fs.readFileSync(path.join(dir, defName), 'latin1'));

  let worst = 0;
  for (let n = 1; n <= 12; n++) {
    const rel = kv['pal' + n];
    if (!rel) continue;
    const p = path.join(dir, rel.replace(/\\/g, '/').trim());
    if (!fs.existsSync(p) || !/\.act$/i.test(p)) continue;
    const act = fs.readFileSync(p);
    if (act.length < 768) continue;
    let diff = 0;
    for (const j of idx) {
      const col = internal[j];
      if (!col) continue;
      const off = (255 - j) * 3; // act files store color 255 first
      if (act[off] !== col[0] || act[off + 1] !== col[1] || act[off + 2] !== col[2]) diff++;
    }
    if (diff > worst) worst = diff;
  }
  return worst;
}

// Re-key ONLY the body palette. The others are per-sprite effect palettes, and
// keying those as (1,2), (1,3)... would make the body wear an effect palette
// whenever that slot was picked.
//
// Turning selection on is not free: a dead selection was silently protecting the
// character's pair art, so this refuses when the pal files would repaint it
// (pairArtRepaintCount). Pass force to accept that trade anyway. `force` stays
// the second argument; opts ({ select }) names the roster entry (repairSelect).
function fixPalKeys(folder, force, opts) {
  const sel = repairSelect(opts);
  const sff = mainSffPath(folder, sel);
  const info = inspectPalKeys(sff);
  if (!info) throw new Error('nothing to fix - this character\'s palettes are already keyed for selection');

  if (!force) {
    // Renaming into a key another node already owns creates a duplicate (1,1)
    // and destroys the body node's own key. Refuse outright - this is the one
    // refusal that is about the repair being WRONG for the shape, not about
    // being unable to assess its risk.
    if (info.conflict) {
      throw new Error('this character cannot be repaired by re-keying: palette slot ' +
        info.conflictIndex + ' already holds the (1,1) key, so re-keying its body palette ' +
        '(slot ' + info.index + ', currently ' + info.key + ') would leave two slots with the ' +
        'same key and delete a color the character actually uses. Its palettes are a complete ' +
        'set that just starts one slot early - fixing that means shifting the whole set, which ' +
        'also changes what pal1..palN in its .def point at. Leave it alone: the select-screen ' +
        'preview stays on one color, but every color still works in a match');
    }
    const repaint = pairArtRepaintCount(folder, sff, info.index, sel);
    if (repaint === null) {
      throw new Error('cannot check this character safely: its sprites are in a format we can\'t read ' +
        '(only SFF v2 PNG8), so there is no way to tell whether turning palette selection on ' +
        'would repaint its scenes');
    }
    if (repaint > 0) {
      throw new Error(`turning palette selection on would repaint this character's scene art: its ` +
        `palette files disagree with the colors it was drawn in on ${repaint} of the colors its ` +
        `scenes use. The files only ever recolored its costume. Its palettes are dead right now, ` +
        `and that is what has been keeping the scenes looking right`);
    }
  }

  const bak = sff + '.palkey.bak';
  if (!fs.existsSync(bak)) fs.copyFileSync(sff, bak);
  const b = fs.readFileSync(sff);
  const o = b.readUInt32LE(0x2C) + info.index * 16;
  b.writeUInt16LE(1, o);
  b.writeUInt16LE(1, o + 2);
  fs.writeFileSync(sff, b);
  invalidateDiag(folder);
  return { wasKey: info.key, index: info.index, sprites: info.sprites };
}

function revertPalKeys(folder, opts) {
  const sff = mainSffPath(folder, repairSelect(opts));
  const bak = sff + '.palkey.bak';
  if (!fs.existsSync(bak)) throw new Error('no backup to revert to');
  fs.copyFileSync(bak, sff);
  fs.unlinkSync(bak);
  invalidateDiag(folder);
  return { reverted: true };
}

// ---- state 5900: the thing that actually applies a color pick ----
//
// For an SFF v2 character the engine applies the selected palette from
// [Statedef 5900] in its own data/common1.cns.zss:
//     remapPal{source: 1, 1; dest: 1, palNo}
// A character that ships its own [Statedef 5900] - extremely common in
// MUGEN-era conversions, which predate that controller - permanently discards
// it, and then NO palette repair can make its colors work in a match. SFF v1
// is unaffected: the engine applies v1 picks itself, in Go.
const STATE5900 = /\[\s*Statedef\s+5900/i;

function block5900HasRemap(text) {
  const lines = text.replace(/\r/g, '').split('\n');
  let inside = false;
  for (const l of lines) {
    if (STATE5900.test(l)) { inside = true; continue; }
    if (inside && /^\s*\[\s*Statedef\s/i.test(l)) break;
    if (inside && /remappal/i.test(l)) return true;
  }
  return false;
}

const REMAP_SCTRL = [
  '',
  '[State 5900, palette pick]  ; restores the controller the engine ships in',
  'type = RemapPal             ; common1 state 5900, which this file overrides',
  'trigger1 = 1',
  'source = 1,1',
  'dest = 1,palno',
  '',
];

function insertRemapPal(text) {
  const nl = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let start = -1, end = lines.length;
  for (let i = 0; i < lines.length; i++) {
    if (STATE5900.test(lines[i])) { start = i; continue; }
    if (start >= 0 && /^\s*\[\s*Statedef\s/i.test(lines[i])) { end = i; break; }
  }
  if (start < 0) return null;
  let at = end;
  for (let i = start + 1; i < end; i++) if (/^\s*\[\s*State\s/i.test(lines[i])) { at = i; break; }
  return lines.slice(0, at).concat(REMAP_SCTRL, lines.slice(at)).join(nl);
}

// State files a def loads, as paths relative to the character directory.
function defStateFiles(charDir, defName) {
  let text;
  try { text = fs.readFileSync(path.join(charDir, defName), 'latin1'); } catch { return []; }
  const dir = path.posix.dirname(defName.replace(/\\/g, '/'));
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(cns|st\d*|stcommon)\s*=\s*(.+?)\s*(;.*)?$/i.exec(line);
    if (!m || !m[2].trim()) continue;
    const val = m[2].replace(/"/g, '').replace(/\\/g, '/').trim();
    const rel = (dir === '.' ? val : dir + '/' + val).replace(/^\.\//, '');
    if (!out.includes(rel)) out.push(rel);
  }
  return out;
}

// Returns { files:[rel] } when the character overrides 5900 and none of its
// overrides restores the controller. null when nothing is wrong.
function inspectPalApplier(folder, defName) {
  const charDir = path.join(CACHE, folder);
  const hits = [];
  for (const rel of defStateFiles(charDir, defName)) {
    let t;
    try { t = fs.readFileSync(path.join(charDir, rel), 'latin1'); } catch { continue; } // engine-side file
    if (!STATE5900.test(t)) continue;
    hits.push({ rel, ok: block5900HasRemap(t) });
  }
  if (!hits.length) return null;          // uses the engine's 5900
  if (hits.some((h) => h.ok)) return null; // its own 5900 already applies the pick
  return { files: [...new Set(hits.map((h) => h.rel))] };
}

function fixPalApplier(folder, defName) {
  const charDir = path.join(CACHE, folder);
  const info = inspectPalApplier(folder, defName);
  if (!info) throw new Error('nothing to restore - this character does not override state 5900');
  const done = [];
  for (const rel of info.files) {
    const abs = path.join(charDir, rel);
    const t = fs.readFileSync(abs, 'latin1');
    if (block5900HasRemap(t)) continue;
    const out = insertRemapPal(t);
    if (!out) continue;
    const bak = abs + '.5900.bak';
    if (!fs.existsSync(bak)) fs.copyFileSync(abs, bak);
    // latin1 both ways: these files routinely carry non-ASCII comments and a
    // utf8 round-trip would mangle every one of those bytes.
    fs.writeFileSync(abs, Buffer.from(out, 'latin1'));
    done.push(rel);
  }
  if (!done.length) throw new Error('could not locate state 5900 to patch');
  invalidateDiag(folder);
  return { files: done };
}

function revertPalApplier(folder, defName) {
  const charDir = path.join(CACHE, folder);
  const back = [];
  for (const rel of defStateFiles(charDir, defName)) {
    const abs = path.join(charDir, rel), bak = abs + '.5900.bak';
    if (!fs.existsSync(bak)) continue;
    fs.copyFileSync(bak, abs);
    fs.unlinkSync(bak);
    back.push(rel);
  }
  if (!back.length) throw new Error('no backup to revert to');
  invalidateDiag(folder);
  return { reverted: back };
}

function palApplierBackups(folder, defName) {
  const charDir = path.join(CACHE, folder);
  return defStateFiles(charDir, defName)
    .filter((rel) => fs.existsSync(path.join(charDir, rel + '.5900.bak')));
}

// ---- resolving a def's paths the way the engine does ----
//
// The engine's SearchFile/FileExist normalizes backslashes and, on a miss,
// globs every path segment case-insensitively (GRAIL 4.13), so a def saying
// `Data\States.st` loads `data/states.st` in a match. Every Studio-side
// resolver has had to learn that separately (sffVersionOf, the readdir idiom
// at six call sites); this is the shared form. Exact path first, then one
// case-insensitive match per segment against the real listing. Returns the
// absolute path or null. Never climbs out of baseDir.
function resolveCI(baseDir, rel) {
  const parts = String(rel || '').replace(/\\/g, '/').split('/').filter((x) => x && x !== '.');
  if (!parts.length) return null;
  // `..` is followed the way the engine follows it (os.Stat on the joined
  // path): a boss def in a subfolder saying `../data/states.st` is normal.
  // Only a `..` that would rise ABOVE baseDir is refused - the stack of
  // resolved segments is the depth.
  const stack = [];
  for (const seg of parts) {
    if (seg === '..') { if (!stack.length) return null; stack.pop(); continue; }
    const cur = path.join(baseDir, ...stack);
    const exact = path.join(cur, seg);
    if (fs.existsSync(exact)) { stack.push(seg); continue; }
    let names;
    try { names = fs.readdirSync(cur); } catch (e) { return null; }
    const want = seg.toLowerCase();
    const hit = names.find((n) => n.toLowerCase() === want);
    if (!hit) return null;
    stack.push(hit);
  }
  return stack.length ? path.join(baseDir, ...stack) : null;
}

// ---- files a character references but does not ship ----
//
// Characters cut out of a fullgame reference files that live outside their own
// folder - the SvC roster's `st1 = chars/exceed_bar.st` is the case this was
// written for. Dropped in alone they fail to load with nothing saying why.
//
// Resolution mirrors the engine's or this reports files that are perfectly
// fine: state files are searched in [def dir, "", motif, "data/"]
// (src/compiler.go), and a state file that does not exist is retried with
// ".zss" appended (src/compiler.go), which is how the stock
// `stcommon = common1.cns` finds the engine's data/common1.cns.zss.
//
// Only keys that abort loading are checked. palN .act files are skipped: a
// missing one just disables that color slot.
const DEP_KEYS = /^\s*(cmd|cns|st\d*|stcommon|anim|sprite|sound)\s*=\s*(.+?)\s*(;.*)?$/i;

// `have` is the set of paths the build would contain. It does NOT depend on
// which character is being checked, so a caller in a loop passes one snapshot.
//
// Building it per character was an accidental O(n2): every vfslib.build() also
// regenerates the Scene Viewer Lua, which hScans the WHOLE roster - so one
// /api/studio ran about 868 hScans where 28 were needed, and 2.4 of its 3.1
// seconds went there. Hoisting this one line out of the loop is most of the
// Studio's startup time.
function scanMissingDeps(folder, defName, have) {
  return scanMissingDepsIn(path.join(CACHE, folder), defName, have);
}

// A [Files] line that leaves the character's folder for one of this bundle's
// screenpacks: `st3 = ../../data/<pack>/basicmoves.st` from chars/<mount>/ (an
// imported fullgame's shared state files, repointed at the pack's name by the
// import), or `data/<pack>/x` from the game root. The build mounts every theme
// at data/<folder>/ (vfslib, the themes walk), so the file the engine opens is
// themes/<folder>/<rest> here. The absolute path, or null.
function themeFileFor(defName, ref) {
  const v = String(ref || '').replace(/"/g, '').replace(/\\/g, '/').trim();
  if (!v) return null;
  const dir = path.posix.dirname(String(defName || '').replace(/\\/g, '/'));
  const rel = (dir === '.' ? v : dir + '/' + v).replace(/^\.\//, '');
  const rooted = path.posix.normalize('chars/_/' + rel);
  const tries = [];
  if (!rooted.startsWith('..') && !rooted.startsWith('chars/_/')) tries.push(rooted);
  tries.push(path.posix.normalize(v));
  for (const t of tries) {
    const m = /^data\/([^/]+)\/(.+)$/i.exec(t);
    if (!m) continue;
    const hit = resolveCI(THEMES, m[1] + '/' + m[2]);
    if (hit) return hit;
  }
  return null;
}

// The motif's own folder: the third place the engine looks for a [Files]
// name - the def's folder, the game root, the motif's folder, then data/
// (stateCompile dirs, compiler.go 8346-8366). An imported fullgame's
// `stcommon = common1.cns` loads the screenpack's common1 that way, not the
// engine's (Mortal Kombat II Remix's walk states 21 / 22 are only in its own).
// Null when the bundle's motif is not on disk.
function motifDir(roster) {
  let def = null;
  try { def = motifDefPath(roster); } catch (e) { def = null; }
  return def ? path.dirname(def) : null;
}

// The scan itself, on any directory - so it can be tested on a synthetic
// character without a roster behind it.
function scanMissingDepsIn(charDir, defName, have) {
  let text;
  try { text = fs.readFileSync(path.join(charDir, defName), 'latin1'); } catch { return []; }
  if (!have) {
    try {
      const { index } = require('./vfslib').build();
      have = new Set([...index.keys()].map((s) => s.toLowerCase()));
    } catch { have = new Set(); }
  }
  const dir = path.posix.dirname(defName.replace(/\\/g, '/'));
  const out = [];
  let mdir;
  for (const line of text.split(/\r?\n/)) {
    const m = DEP_KEYS.exec(line);
    if (!m || !m[2].trim()) continue;
    const val = m[2].replace(/"/g, '').replace(/\\/g, '/').trim();
    if (!val || val.startsWith(';')) continue;
    const rel = (dir === '.' ? val : dir + '/' + val).replace(/^\.\//, '');
    // Inside the character's own folder? Resolved the way the engine resolves
    // it (resolveCI): the def's casing and separators are not authoritative,
    // and a bare fs.existsSync on them reported files the game loads fine -
    // RyuDX's `Data/ryuDX.cns` against `Data/RyuDX.cns`, for one.
    const inside = (q) => resolveCI(charDir, q) || resolveCI(charDir, q + '.zss');
    if (inside(rel) || inside(val)) continue;
    // in this bundle's screenpack, where the build mounts it (data/<pack>/)?
    // Asked of the disk, not of `have`: the content audit passes only the
    // engine's own data/ (contentaudit engineHave).
    if (themeFileFor(defName, val)) continue;
    // ...or in the motif's folder, where the engine looks before data/
    if (mdir === undefined) mdir = motifDir();
    if (mdir && (resolveCI(mdir, val) || resolveCI(mdir, val + '.zss'))) continue;
    // supplied by the build (engine data/, or the game root)?
    const bases = [val, 'data/' + val, rel, 'data/' + rel];
    // `../../data/x` from chars/<mount>/ is data/x at the build root: a shared
    // file beside the screenpack (an imported fullgame's state files) resolves
    // there, and was reported missing while sitting in the theme all along.
    const rooted = path.posix.normalize('chars/_/' + rel);
    if (!rooted.startsWith('..') && !rooted.startsWith('chars/_/')) bases.push(rooted);
    if (bases.some((x) => have.has(x.toLowerCase()) || have.has((x + '.zss').toLowerCase()))) continue;
    out.push({ key: m[1], rel: val, name: val.split('/').pop() });
  }
  return out;
}

// The engine searches the def's own directory first, so a supplied file goes
// inside the character folder at exactly the path the def names - which also
// makes charKeepFilter mount it, since the def references that path.
function addDependency(folder, defName, fileName, buf) {
  const charDir = path.join(CACHE, folder);
  const missing = scanMissingDeps(folder, defName);
  const hit = missing.find((d) => d.name.toLowerCase() === String(fileName).toLowerCase());
  if (!hit) {
    throw new Error(fileName + ' is not one of the missing files (' +
      (missing.map((d) => d.name).join(', ') || 'none') + ')');
  }
  const dir = path.posix.dirname(defName.replace(/\\/g, '/'));
  const rel = (dir === '.' ? hit.rel : dir + '/' + hit.rel).replace(/^\.\//, '');
  const abs = path.join(charDir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, buf);
  return { name: hit.name, at: rel, left: scanMissingDeps(folder, defName).length };
}

// Some screenpacks draw a small lifebar portrait from sprite 9000,20 (a KOF-era
// convention). A character that only ships the standard 9000,0/9000,1 portraits
// shows nothing in that slot. Report whether the character could get one and
// whether it already has: {version, has20, source} or null if not applicable.
function inspectPortrait(sffPath) {
  if (sffVersion(sffPath) !== 2) return null; // v2 only for now
  const b = fs.readFileSync(sffPath);
  const sprOfs = b.readUInt32LE(0x24), nSpr = b.readUInt32LE(0x28);
  if (!nSpr) return null;
  let has20 = false, src = null;
  for (let i = 0; i < nSpr; i++) {
    const o = sprOfs + i * 28, g = b.readUInt16LE(o), n = b.readUInt16LE(o + 2);
    if (g === 9000 && n === 20) has20 = true;
    else if (g === 9000 && n === 1) src = '9000,1';
    else if (g === 9000 && n === 0 && !src) src = '9000,0';
  }
  if (has20 || !src) return null; // already has one, or nothing to copy from
  return { source: src };
}

// Add a 9000,20 lifebar portrait as a LINK to the character's existing portrait
// (9000,1 preferred, 9000,0 fallback). A linked sprite (dataLength 0) copies no
// pixels - the engine resolves it to the source image at load - so this only
// appends a 28-byte sprite header and shifts the pixel-data block down to match.
function addPortrait(folder, opts) {
  const sff = mainSffPath(folder, repairSelect(opts));
  if (sffVersion(sff) !== 2) throw new Error('only SFF v2 characters are supported');
  const b = fs.readFileSync(sff);
  const sprOfs = b.readUInt32LE(0x24), nSpr = b.readUInt32LE(0x28);
  const ldata = b.readUInt32LE(0x34);
  if (sprOfs + nSpr * 28 !== ldata) {
    throw new Error('unexpected SFF layout - refusing to edit rather than risk corrupting it');
  }
  let src = -1, srcKey = '';
  for (let i = 0; i < nSpr; i++) {
    const o = sprOfs + i * 28, g = b.readUInt16LE(o), n = b.readUInt16LE(o + 2);
    if (g === 9000 && n === 20) throw new Error('this character already has a 9000,20 portrait');
    if (g === 9000 && n === 1) { src = i; srcKey = '9000,1'; }
    else if (g === 9000 && n === 0 && src < 0) { src = i; srcKey = '9000,0'; }
  }
  if (src < 0) throw new Error('this character has no 9000,0 or 9000,1 portrait to copy from');

  const so = sprOfs + src * 28;
  const h = Buffer.alloc(28);
  h.writeUInt16LE(9000, 0);
  h.writeUInt16LE(20, 2);
  b.copy(h, 4, so + 4, so + 12);   // width, height, x/y axis (keep source's)
  h.writeUInt16LE(src, 12);        // link -> source sprite index
  h[14] = b[so + 14];              // format
  h[15] = b[so + 15];              // color depth
  // dataOffset/dataLength stay 0 (linked); palIndex + flags copied
  b.copy(h, 24, so + 24, so + 28);

  const out = Buffer.concat([b.slice(0, ldata), h, b.slice(ldata)]);
  out.writeUInt32LE(nSpr + 1, 0x28);                    // NumberOfSprites
  out.writeUInt32LE(out.readUInt32LE(0x34) + 28, 0x34); // ldataOffset
  out.writeUInt32LE(out.readUInt32LE(0x3C) + 28, 0x3C); // tdataOffset

  const bak = sff + '.portrait.bak';
  if (!fs.existsSync(bak)) fs.copyFileSync(sff, bak);
  fs.writeFileSync(sff, out);
  invalidateDiag(folder);
  return { source: srcKey };
}

function revertPortrait(folder, opts) {
  const sff = mainSffPath(folder, repairSelect(opts));
  const bak = sff + '.portrait.bak';
  if (!fs.existsSync(bak)) throw new Error('no backup to revert to');
  fs.copyFileSync(bak, sff);
  fs.unlinkSync(bak);
  invalidateDiag(folder);
  return { reverted: true };
}

function fixV1Palettes(folder, opts) {
  const sel = repairSelect(opts);
  const sff = mainSffPath(folder, sel);
  if (sffVersion(sff) !== 1) throw new Error('not an SFF v1 file - this fix only applies to v1 characters');

  // Gather the def-loaded state files and anim file for effect analysis.
  const dir = path.join(CACHE, folder);
  const c = rosterEntryOf(folder, sel);
  const defName = c.select.split('/').slice(1).join('/');
  const defText = fs.readFileSync(path.join(dir, defName), 'latin1');
  const stateTexts = [];
  let airText = '';
  for (const line of defText.split(/\r?\n/)) {
    const m = /^\s*(cmd|cns|st\d*|stcommon|anim)\s*=\s*(.+?)\s*(;.*)?$/i.exec(line);
    if (!m) continue;
    const rel = m[2].replace(/"/g, '').replace(/\\/g, '/');
    try {
      const text = fs.readFileSync(path.join(dir, rel), 'latin1');
      if (m[1].toLowerCase() === 'anim') airText = text;
      else if (m[1].toLowerCase() !== 'cmd') stateTexts.push(text);
    } catch { /* engine-side files like common1.cns */ }
  }
  invalidateDiag(folder);
  return sffpal.repair(sff, stateTexts, airText);
}

function revertV1Palettes(folder, opts) {
  const sff = mainSffPath(folder, repairSelect(opts));
  const bak = sff + '.orig';
  if (!fs.existsSync(bak)) throw new Error('no backup found - nothing to revert');
  fs.copyFileSync(bak, sff);
  rmFile(bak);
  invalidateDiag(folder);
  return { reverted: true };
}

// --- info for the Studio UI --------------------------------------------------

// Sizes measured off the PACKER'S OWN INDEX, not off the folders on disk.
// Summing the folder on disk answers "how big is this folder", which is not
// the question the card asks - the export drops everything a .def does not
// reference (backup spritesheets, alternate builds; until 2026-10-22 every
// .glb model too, a stage's own included), so a folder full of dead weight
// was labeled with a download size players never download. A stage's model
// counts now: the build ships it. CVS_Makoto measured 89.9 MB on disk
// and ships 55.2 MB. The browser Studio always read the shipped manifest and
// so always showed the real figure; this makes the desktop one agree by
// construction rather than by two implementations happening to match.
//
// vfslib.build() only reads - it returns the vpath -> absolute-path map the
// pack is written from, so summing it is exactly summing the build.
function buildSizes(vfs) {
  const { generated, index } = vfs || buildIndex();
  const sizeOf = (vpath) => {
    const abs = index.get(vpath);
    if (abs === null || abs === undefined) {
      const g = generated && generated[vpath];
      return g ? (g.length || 0) : 0;
    }
    try { return fs.statSync(abs).size; } catch { return 0; }
  };
  let total = 0;
  const byPath = new Map();
  for (const vpath of index.keys()) { const n = sizeOf(vpath); byPath.set(vpath, n); total += n; }
  for (const [vpath, buf] of Object.entries(generated || {})) {
    if (byPath.has(vpath)) continue;               // generated overrides count once
    const n = buf ? (buf.length || 0) : 0;
    byPath.set(vpath, n); total += n;
  }
  // Characters: everything mounted under chars/<mountAs>/.
  const chars = {};
  for (const [vpath, n] of byPath) {
    const m = /^chars\/([^/]+)\//.exec(vpath);
    if (m) chars[m[1].toLowerCase()] = (chars[m[1].toLowerCase()] || 0) + n;
  }
  // Stages sit FLAT in stages/, so a stage is attributed the files the packer
  // would keep for it alone. Two stages sharing one .sff therefore each count
  // it - the per-stage figures can sum to more than the stages line of the
  // total, which is measured over the real (deduplicated) file set.
  const roster = readRoster();
  const stages = {};
  for (const s of roster.stages || []) {
    let n = 0;
    try {
      for (const v of stageKeepFilter([s])) {
        for (const [vpath, size] of byPath) if (vpath.toLowerCase() === v) n += size;
      }
    } catch { /* unreadable def: report what we could see */ }
    stages[s.file] = n;
  }
  // Music mounts music/ at sound/.
  const music = {};
  for (const [vpath, n] of byPath) if (/^sound\//.test(vpath)) music[vpath] = n;
  return { chars, stages, music, total, files: byPath.size };
}

// Netplay fitness estimate for the Studio badge. On single-threaded wasm the
// GC pause that stutters online scales with a character's in-memory footprint
// (sprites), and rollback re-simulation cost scales with its state
// complexity - neither can be hidden on a background thread in the browser.
// Total asset size is the dominant, cheap proxy; a giver kit or a very high
// module count nudges a borderline char down a tier. Thresholds calibrated to
// field feel: KFM ~1MB is smooth; Sakura/Ryu ~11-13MB play but stutter;
// heavier chars break online (esp. stacked in Simul). Tune freely.
function netplayVerdict(sizeMB, h) {
  const complex = !!(h && (h.giver || (h.modules || 0) >= 400));
  let level;
  if (sizeMB <= 8 && !complex) level = 'ok';
  else if (sizeMB <= 25) level = 'medium';
  else level = 'heavy';
  const note = {
    ok:     'Light footprint - short GC pauses; smooth online.',
    medium: 'Medium footprint - some GC stutter online. Fine for 1v1; avoid stacking it in Simul.',
    heavy:  'Heavy footprint - long GC pauses and rollback spikes likely online. Prefer offline for this one.',
  }[level];
  return { level, note };
}

// THE PER-CHARACTER DIAGNOSIS IS CACHED AGAINST THE FILES IT READ.
//
// Every /api/studio call re-derived it from scratch, and deriving it means
// reading each character's whole .sff - twice for some of them. Measured on a
// 25-character roster that is 1.23 GB of disk read and about five seconds, on
// every refresh, to recompute answers that cannot change unless the character's
// files change. The desktop build has the machine's whole disk and was slower
// than the browser build because of it.
//
// The key is the size and mtime of the .sff and the .def, so any edit - by this
// tool, by Fighter Factory, by dropping a new copy in - misses the cache and is
// re-read. Nothing is persisted: a restart re-derives once and is fast after.
const DIAG_CACHE = new Map();
// Thrown to leave the diagnosis block early on a cache hit. A sentinel rather
// than restructuring the block, so the expensive path stays exactly as it was.
const DIAG_DONE = { cacheHit: true };
const DIAG_FIELDS = [
  'sffVer', 'hasPaletteBackup', 'ownPalSprites', 'hasPalKeyBackup', 'palKeysBroken',
  'palKeysRepaint', 'palKeysConflict', 'hasPortraitBackup', 'canAddPortrait',
  'portraitSource', 'hasPortraitFix', 'canFixPortrait', 'portraitFixFrom',
  'palApplierFixed', 'palApplier',
  'pngPalettes', 'hasPngPalBackup', 'palGaps', 'hasPalGapBackup',
];

// ---- A REPAIR INVALIDATES THE CHARACTER IT REPAIRED ------------------------
//
// The card's buttons read their labels from the diagnosis block, which is cached
// per character behind diagStamp(). That stamp watches the .def, the .sff, and
// the three sibling backups .orig / .palkey.bak / .portrait.bak - and NOTHING
// ELSE. So the color-pick fix, which edits a .cns and writes a .5900.bak beside
// it, changed nothing the stamp could see: the cache hit, palApplierFixed came
// back stale, and the button kept saying "fix" after a successful fix. It took a
// restart to clear, which is not a refresh strategy.
//
// Widening the stamp is not enough on its own either, and the reason is worth
// keeping: fs.copyFileSync on Windows uses CopyFileEx, which PRESERVES the
// source timestamp - so restoring a file from backup gives it back its ORIGINAL
// mtime. A revert can therefore leave every watched mtime exactly as it was.
//
// So the rule is the other way round: the code that MUTATES a character says so.
// Every repair calls this before returning, so any caller - the server, a
// script, whatever comes next - gets a fresh diagnosis without knowing the cache
// exists. The stamp is still widened below as a backstop for changes made
// outside these functions.
// ---- PNG PALETTES -> .act --------------------------------------------------
//
// A character can declare its palettes as indexed PNGs (`pal1 = whatever.png`).
// Ikemen's own loader handles that - src/image.go readPngPalette - but ONLY in
// an engine built from a source tree that has it. The desktop export unzips the
// OFFICIAL upstream Ikemen_GO windows release, which does not: measured by
// symbol presence, dist-pack-v2/ikemen.wasm has readPngPalette and
// dist-desktop/Ikemen_GO.exe does not, while both carry readActPalette.
//
// Without it the PNG's own bytes are read as act triplets, so the file's
// signature and IHDR arrive as colors - and on SFF v2 those bogus palettes
// OVERWRITE the sprite's good internal ones, so the character renders as
// garbage rather than merely losing its spare palettes. Dr.Kira is exactly this:
// SFF v2, pal1-pal8 as .png. Her select portrait is fine because that draws the
// SFF's internal palette; everything in a match goes through the palN files.
//
// So rather than wait on an engine rebuild, convert the palettes to the format
// every build already reads.
//
// THE BYTE ORDER IS NOT THE SAME IN THE TWO FORMATS, and this is the whole
// content of the conversion (image.go):
//     PLTE   pal[j]       <- body[j*3 ..]      natural order
//     .act   pal[255 - i] <- data[i*3 ..]      REVERSE order
// so the .act holds the PLTE entries backwards. Both formats give index 0
// alpha 0, so nothing else has to be carried across. Verified by round-trip on
// all eight of Dr.Kira's palettes: decode the PNG the engine's way, build the
// .act, decode THAT the engine's way, 256/256 identical, 8/8 files.
function pngPltePalette(buf) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buf.length < 8 || !buf.slice(0, 8).equals(sig)) return null;
  for (let i = 8; i + 8 <= buf.length;) {
    const ln = buf.readUInt32BE(i);
    const typ = buf.slice(i + 4, i + 8).toString('latin1');
    const body = buf.slice(i + 8);
    if (ln < 0 || ln > body.length) return null;
    if (typ === 'PLTE') {
      const pal = new Uint32Array(256);
      const n = Math.min(Math.floor(ln / 3), 256);
      for (let j = 0; j < n; j++) {
        pal[j] = ((body[j * 3 + 2] << 16) | (body[j * 3 + 1] << 8) | body[j * 3]) >>> 0;
      }
      return pal;
    }
    if (typ === 'IEND') break;
    i += 12 + ln;
  }
  return null;
}

function paletteToAct(pal) {
  const out = Buffer.alloc(768);
  for (let i = 0; i < 256; i++) {
    const v = pal[255 - i];
    out[i * 3] = v & 0xff;
    out[i * 3 + 1] = (v >> 8) & 0xff;
    out[i * 3 + 2] = (v >> 16) & 0xff;
  }
  return out;
}

// Which palN lines point at a .png, and does the file exist?
function pngPaletteRefs(charDir, defName) {
  let text;
  try { text = fs.readFileSync(path.join(charDir, defName), 'latin1'); }
  catch (e) { return []; }
  const out = [];
  for (const m of text.matchAll(/^([ \t]*pal(\d+)[ \t]*=[ \t]*)([^;\r\n]+)(.*)$/gim)) {
    const ref = m[3].trim();
    if (!/\.png$/i.test(ref)) continue;
    const rel = ref.replace(/\\/g, '/');
    out.push({ slot: Number(m[2]), ref, rel, exists: fs.existsSync(path.join(charDir, rel)) });
  }
  return out;
}

function convertPngPalettes(folder) {
  const charDir = path.join(CACHE, String(folder || ''));
  const defName = findMainDef(charDir);
  if (!defName) throw new Error('no character .def found');
  const refs = pngPaletteRefs(charDir, defName);
  if (!refs.length) throw new Error('this character declares no PNG palettes');

  const defPath = path.join(charDir, defName);
  const bak = defPath + '.pngpal.bak';
  let text = fs.readFileSync(defPath, 'latin1');
  const made = [];
  for (const r of refs) {
    if (!r.exists) continue;
    const src = path.join(charDir, r.rel);
    const pal = pngPltePalette(fs.readFileSync(src));
    // A PNG with no PLTE is not an indexed PNG and carries no palette at all;
    // rewriting its line would point the engine at a file we never wrote.
    if (!pal) continue;
    const actRel = r.rel.replace(/\.png$/i, '.act');
    fs.writeFileSync(path.join(charDir, actRel), paletteToAct(pal));
    // Replace the REFERENCE as written, separators and all, so a line that used
    // backslashes keeps them - this file is read by other tools too.
    const from = r.ref;
    const to = r.ref.replace(/\.png$/i, '.act');
    text = text.replace(from, to);
    made.push({ slot: r.slot, from, to });
  }
  if (!made.length) throw new Error('no indexed PNG palettes could be read');
  if (!fs.existsSync(bak)) fs.copyFileSync(defPath, bak);
  fs.writeFileSync(defPath, Buffer.from(text, 'latin1'));
  invalidateDiag(folder);
  return { converted: made.length, slots: made.map((m) => m.slot) };
}

function revertPngPalettes(folder) {
  const charDir = path.join(CACHE, String(folder || ''));
  const defName = findMainDef(charDir);
  if (!defName) throw new Error('no character .def found');
  const defPath = path.join(charDir, defName);
  const bak = defPath + '.pngpal.bak';
  if (!fs.existsSync(bak)) throw new Error('no backup to revert to');
  // The generated .act files are found from the RESTORED def, so nothing that
  // shipped with the character is ever deleted - only files this made.
  const before = fs.readFileSync(bak, 'latin1');
  fs.copyFileSync(bak, defPath);
  fs.unlinkSync(bak);
  let removed = 0;
  for (const m of before.matchAll(/^[ \t]*pal\d+[ \t]*=[ \t]*([^;\r\n]+)/gim)) {
    const ref = m[1].trim();
    if (!/\.png$/i.test(ref)) continue;
    const act = path.join(charDir, ref.replace(/\\/g, '/').replace(/\.png$/i, '.act'));
    try { if (fs.existsSync(act)) { fs.unlinkSync(act); removed++; } } catch (e) { /* leave it */ }
  }
  invalidateDiag(folder);
  return { reverted: true, removed };
}


// ---- EXTERNAL PALETTES THAT BLANK SLOTS THE SFF PROVIDES -------------------
//
// GRAIL 3.3 states the rule: "external palettes should only fill slots the SFF
// doesn't provide." Dr.Kira's do the opposite. Every one of her eleven external
// palettes is black across 16-31, 40-44, 46-48 and 50-54 - 25 to 29 slots -
// while the SFF's own body palette (1,1) carries real color there, including
// the exact ramps DEVLOG.md:2396 named a month ago:
//
//   16-31: #ad4a39 #de7b63 #ffb594 #ffe7d6  #03060a #181831 #423173 #7b6bb5
//          #7b2174 #ce3197 #f763ad #ff94ce  #0a1a90 #1b4efa #31a5ff #5a6384
//
// They are stale exports, taken from a build of the character that did not have
// that art yet. Those ranges are what the helper spawned at k-2.cns:1185+ draws
// with - it uses `ownpal = 0`, so it wears the OWNER's palette - which is why it
// renders as a black silhouette while everything else looks right.
//
// So: fill a slot only when the external is black AND the SFF is not. A slot the
// SFF also leaves black is left alone, because that is a palette saying black on
// purpose rather than a gap.
// With the entry named (opts.select), its own def gives both the pal list and
// the body palette's .sff; without, the folder's main def and the first
// entry's sprite, as before.
function paletteGapReport(folder, opts) {
  const sel = repairSelect(opts);
  const charDir = path.join(CACHE, String(folder || ''));
  const entry = sel ? rosterEntryOf(folder, sel) : null;
  const defName = entry ? entry.select.split('/').slice(1).join('/') : findMainDef(charDir);
  if (!defName) return null;
  const sffPath = entry ? defSffPath(charDir, defName) : mainSffPath(folder);
  if (!sffPath || sffVersion(sffPath) !== 2) return null;
  let body;
  try {
    const sffdec = require('./tools/sff-decode.js');
    body = sffdec.v2PaletteAt(sffdec.readSff(sffPath), 0);
  } catch (e) { return null; }
  if (!body) return null;

  const black = (a, i) => !a[i * 3] && !a[i * 3 + 1] && !a[i * 3 + 2];
  const text = fs.readFileSync(path.join(charDir, defName), 'latin1');
  const out = [];
  for (const m of text.matchAll(/^[ \t]*pal(\d+)[ \t]*=[ \t]*([^;\r\n]+)/gim)) {
    const rel = m[2].trim().split(String.fromCharCode(92)).join('/');
    if (!/\.act$/i.test(rel)) continue;
    const abs = path.join(charDir, rel);
    if (!fs.existsSync(abs)) continue;
    const act = actToNatural(fs.readFileSync(abs));
    const gaps = [];
    for (let i = 1; i < 256; i++) if (black(act, i) && !black(body, i)) gaps.push(i);
    if (gaps.length) out.push({ slot: Number(m[1]), rel, gaps: gaps.length });
  }
  return out.length ? out : null;
}

// .act stores triplet i at palette index 255-i. Both directions, so the file is
// only ever read and written through these.
function actToNatural(buf) {
  const d = Buffer.alloc(768);
  buf.copy(d, 0, 0, Math.min(buf.length, 768));
  const out = Buffer.alloc(768);
  for (let i = 0; i < 256; i++) {
    const s = 255 - i;
    out[s * 3] = d[i * 3]; out[s * 3 + 1] = d[i * 3 + 1]; out[s * 3 + 2] = d[i * 3 + 2];
  }
  return out;
}
function naturalToAct(nat) {
  const out = Buffer.alloc(768);
  for (let i = 0; i < 256; i++) {
    const s = 255 - i;
    out[i * 3] = nat[s * 3]; out[i * 3 + 1] = nat[s * 3 + 1]; out[i * 3 + 2] = nat[s * 3 + 2];
  }
  return out;
}

function fillPaletteGaps(folder, opts) {
  const sel = repairSelect(opts);
  const charDir = path.join(CACHE, String(folder || ''));
  const entry = sel ? rosterEntryOf(folder, sel) : null;
  const defName = entry ? entry.select.split('/').slice(1).join('/') : findMainDef(charDir);
  if (!defName) throw new Error('no character .def found');
  const sffPath = entry ? defSffPath(charDir, defName) : mainSffPath(folder);
  if (!sffPath || sffVersion(sffPath) !== 2) {
    throw new Error('this repair reads the SFF v2 body palette; this character is not SFF v2');
  }
  const sffdec = require('./tools/sff-decode.js');
  const body = sffdec.v2PaletteAt(sffdec.readSff(sffPath), 0);
  if (!body) throw new Error('could not read the body palette out of the .sff');
  const black = (a, i) => !a[i * 3] && !a[i * 3 + 1] && !a[i * 3 + 2];

  const text = fs.readFileSync(path.join(charDir, defName), 'latin1');
  const done = [];
  for (const m of text.matchAll(/^[ \t]*pal(\d+)[ \t]*=[ \t]*([^;\r\n]+)/gim)) {
    const rel = m[2].trim().split(String.fromCharCode(92)).join('/');
    if (!/\.act$/i.test(rel)) continue;
    const abs = path.join(charDir, rel);
    if (!fs.existsSync(abs)) continue;
    const nat = actToNatural(fs.readFileSync(abs));
    let filled = 0;
    for (let i = 1; i < 256; i++) {
      if (!black(nat, i) || black(body, i)) continue;
      nat[i * 3] = body[i * 3]; nat[i * 3 + 1] = body[i * 3 + 1]; nat[i * 3 + 2] = body[i * 3 + 2];
      filled++;
    }
    if (!filled) continue;
    const bak = abs + '.gap.bak';
    if (!fs.existsSync(bak)) fs.copyFileSync(abs, bak);
    fs.writeFileSync(abs, naturalToAct(nat));
    done.push({ slot: Number(m[1]), rel, filled });
  }
  if (!done.length) throw new Error('no palette had a slot the .sff could fill');
  invalidateDiag(folder);
  return { palettes: done.length, slots: done.reduce((n, d) => n + d.filled, 0) };
}

// Puts back every .gap.bak in the folder, whichever entry's fill wrote it, so
// opts ({ select }) is taken for the shared signature and changes nothing.
function revertPaletteGaps(folder, opts) {
  const charDir = path.join(CACHE, String(folder || ''));
  let n = 0;
  const walk = (rel, left) => {
    let ents;
    try { ents = fs.readdirSync(path.join(charDir, rel), { withFileTypes: true }); } catch (e) { return; }
    for (const e of ents) {
      const r = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) { if (left > 0) walk(r, left - 1); continue; }
      if (!e.name.endsWith('.gap.bak')) continue;
      const abs = path.join(charDir, r);
      fs.copyFileSync(abs, abs.slice(0, -'.gap.bak'.length));
      fs.unlinkSync(abs);
      n++;
    }
  };
  walk('', 4);
  if (!n) throw new Error('no backup to revert to');
  invalidateDiag(folder);
  return { reverted: n };
}


function invalidateDiag(folder) {
  const f = String(folder || '').toLowerCase();
  if (!f) return;
  // The cache is keyed by `mountAs || folder`, and a repair only knows the
  // folder - so resolve the mount name, and sweep case-insensitively as well
  // rather than trusting either to match exactly.
  try {
    const roster = readRoster();
    for (const c of (roster.chars || [])) {
      if (!c || c.kind) continue;
      if (String(c.folder || '').toLowerCase() === f) {
        DIAG_CACHE.delete(c.mountAs || c.folder);
      }
    }
  } catch (e) { /* a roster we cannot read is not a reason to keep stale data */ }
  for (const k of [...DIAG_CACHE.keys()]) {
    if (String(k).toLowerCase() === f) DIAG_CACHE.delete(k);
  }
}


function diagStamp(dir, defName) {
  const parts = [];
  for (const f of [path.join(dir, defName)]) {
    try { const st = fs.statSync(f); parts.push(st.size + '@' + st.mtimeMs); }
    catch (e) { parts.push('-'); }
  }
  try {
    const sff = defSffPath(dir, defName);
    const st = fs.statSync(sff);
    parts.push(st.size + '@' + st.mtimeMs);
    // The repair tools write siblings; their presence is part of the answer.
    for (const ext of ['.orig', '.palkey.bak', '.portrait.bak', '.portraitfix.bak']) {
      parts.push(fs.existsSync(sff + ext) ? '1' : '0');
    }
    // The color-pick fix writes <statefile>.5900.bak, which is NOT beside
    // the .sff and so was invisible to every line above. Presence is what
    // matters, and presence is what a Windows copy cannot preserve away.
    try {
      parts.push(fs.readdirSync(dir).some((n) => n.endsWith('.5900.bak')) ? '1' : '0');
    } catch (e) { parts.push('-'); }
  } catch (e) { parts.push('-'); }
  return parts.join('|');
}

// Ikemen draws a stage thumbnail from sprite 9000,1 of the stage's OWN .sff.
// Almost no third-party stage ships one - see stagethumb.js.
// Names already written into roster.json before the decoder existed are fixed
// on the way out, so the list reads correctly at once and the corrected name is
// what gets saved on the next edit.
function healStageNames(roster) {
  for (const s of (roster.stages || [])) {
    const fixed = reencodeName(s.name);
    if (fixed && fixed !== s.name) s.name = fixed;
  }
  return roster;
}

function stageThumbState(roster) {
  const dir = layout.dir('stages');
  const out = {};
  for (const s of (roster.stages || [])) {
    try {
      out[s.file] = { has: stagethumb.hasThumb(dir, s.file), edited: stagethumb.hasBackup(dir, s.file) };
    } catch (e) { out[s.file] = { has: false, edited: false }; }
  }
  return out;
}

// A NAME IS NOT ASCII JUST BECAUSE THE FILE IS OLD.
//
// Def files are read as latin1 everywhere here, which is right for the parsing
// (it is byte-preserving, and rewrites depend on that). It is wrong for the one
// thing a person reads: a Japanese stage writes its [Info] name in Shift-JIS,
// and latin1 turns "ゴーストトリック ゴミ捨て場" into "ÍS?[ÍX?g?g???b?N".
//
// So the bytes are taken back out of the latin1 string and re-read. UTF-8 first
// because modern tools emit it; then Shift-JIS, but only when the bytes really
// look like it. The test is strict on purpose: EVERY high byte must take part
// in a valid two-byte sequence or be half-width katakana, and the result must
// actually contain kana or kanji. A Latin-1 name like "Café Noir" fails on the
// space after the é and is left exactly as it was.
function looksShiftJis(buf) {
  let pairs = 0;
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i];
    if (b < 0x80) continue;
    if (b >= 0xA1 && b <= 0xDF) continue;                   // half-width katakana
    const lead = (b >= 0x81 && b <= 0x9F) || (b >= 0xE0 && b <= 0xEF);
    if (!lead) return false;
    const t = buf[i + 1];
    if (t === undefined) return false;
    const trail = (t >= 0x40 && t <= 0x7E) || (t >= 0x80 && t <= 0xFC);
    if (!trail) return false;
    pairs++; i++;
  }
  return pairs >= 2;
}

function reencodeName(s) {
  if (!s || !/[\x80-\xFF]/.test(s)) return s;               // plain ASCII: nothing to do
  const buf = Buffer.from(s, 'latin1');
  try {
    const u = new TextDecoder('utf-8', { fatal: true }).decode(buf);
    if (/[^\x00-\x7F]/.test(u)) return u;
  } catch (e) { /* not UTF-8 */ }
  if (looksShiftJis(buf)) {
    try {
      const j = new TextDecoder('shift_jis').decode(buf);
      if (/[\u3040-\u30FF\u4E00-\u9FFF\uFF66-\uFF9D]/.test(j)) return j;
    } catch (e) { /* no shift_jis in this Node build */ }
  }
  return s;
}

// Every .def in a character's folder that is itself a character - a boss build,
// an alternate version, an older revision the author left in. findMainDef picks
// ONE to mount; these are the others, which MUGEN would list as separate
// select.def lines into the same folder.
// The SFF VERSION of a def's sprite file, from the header's 16th byte.
//
// Cheap on purpose: opens the file, reads 16 bytes, closes it. A 34 MB .sff
// costs the same as a 1 KB one. Returns null when the path does not resolve or
// the file is not an SFF at all.
function sffVersionOf(dir, rel) {
  const parts = String(rel || '').replace(/\\/g, '/').split('/').filter((x) => x && x !== '.');
  if (!parts.length) return null;
  let cur = dir;
  for (const part of parts) {
    let entries;
    try { entries = fs.readdirSync(cur); } catch (e) { return null; }
    const hit = entries.find((f) => f.toLowerCase() === part.toLowerCase());
    if (!hit) return null;
    cur = path.join(cur, hit);
  }
  let fd;
  try { fd = fs.openSync(cur, 'r'); } catch (e) { return null; }
  const b = Buffer.alloc(16);
  try { fs.readSync(fd, b, 0, 16, 0); } catch (e) { return null; } finally { fs.closeSync(fd); }
  return b.slice(0, 11).toString('latin1') === 'ElecbyteSpr' ? b[15] : null;
}

const AI_RE = /(^|[^a-z])ai([^a-z]|$)|_ai|ai\.def|defai/i;
const NOAI_RE = /no[_ -]?ai/i;
const dnorm = (x) => String(x || '').trim().toLowerCase();

// WHAT KIND OF VARIANT IS THIS, relative to the def currently in use?
//
// Derived from a survey of 716 character defs across six builds (591 characters,
// 101 of them shipping more than one def - 17%, so this is common rather than a
// corner case). The buckets below are the ones that actually occur.
//
// CLASSIFY FROM THE FILES, NOT THE FILENAME, and above all not from
// `mugenversion`. That field is author-declared and stale in 30% of the corpus:
// 178 defs declare 1.0/1.1 while pointing at an SFF v1 sprite, and 34 declare a
// WinMUGEN-era date string while pointing at v2. CVS_Makoto's "MakotoWin" really
// is an older-engine build, but that is provable only because its sprite file IS
// v1 while its sibling's is v2 - not because of what its header claims. Of the
// four defs in the corpus with "win" in the name, only that one is.
//
// Filenames get a vote on AI naming and nowhere else, because "AI" is a
// convention authors follow (34 defs) and nothing in the files distinguishes an
// AI patch from any other state-code edit.
function classifyDef(primary, v) {
  const same = (k) => dnorm(primary[k]) === dnorm(v[k]);

  // A folder can hold two DIFFERENT characters rather than two builds of one -
  // eltnum_srt ships Eltnum and Sion Eltnam Atlasia, Harmir Vore ships Harmir
  // too. Adding one of those is not "another version", it is another fighter.
  //
  // A DIFFERENT `name` IS NOT ENOUGH ON ITS OWN; the art has to differ too.
  // Twelve folders in the corpus declare two different names, and exactly half
  // of them share one sprite file - those are one character with an edited name
  // field, not two fighters: Isurugi_Remi's AI build renames "Megane" to
  // "Isurugi_Remi", Roxy.def still calls itself "cvspoison". Going on the name
  // alone labeled an AI patch as a separate fighter. The six that DO differ in
  // sprite are the real ones.
  const renamed = primary.rawName && v.rawName && !same('rawName');
  if (renamed && !same('sprite')) {
    return { kind: 'character', label: 'separate character',
      note: 'declares itself "' + v.name + '" and has its own sprite file'
        + ' - a different fighter sharing this folder' };
  }
  // Otherwise the rename is worth mentioning but is not what the variant IS, so
  // it rides along on whatever the files say below.
  const alias = renamed ? '; calls itself "' + v.name + '"' : '';

  // ART IS THE SPRITE FILE, NOT THE .AIR.
  //
  // Lumping `anim` in with `sprite` mislabels the commonest variant there is: an
  // AI patch ships its own .air alongside its own .cns/.cmd (often the whole set
  // redirected into a subfolder - kotaroAI points every file at kotaroAI/ while
  // still using the base kotaro.sff). Calling that "different art" is wrong and
  // reads as though the character looks different, which it does not. The .air
  // is behavior; only the .sff is art.
  const codeFiles = ['anim', 'cmd', 'cns', 'st'].filter((k) => !same(k));
  const codeDiffers = codeFiles.length > 0;

  if (!same('sprite')) {
    if (v.sffVer !== null && primary.sffVer !== null && v.sffVer !== primary.sffVer) {
      return { kind: 'engine-build', label: 'older engine',
        note: 'its sprite file is SFF v' + v.sffVer + ' where ' + primary.def + ' uses v'
          + primary.sffVer + '. Built for an engine that cannot read v' + primary.sffVer
          + '; Ikemen reads both, so this one only loses whatever the newer file adds.' + alias };
    }
    return { kind: 'art', label: 'different art',
      note: 'points at a different sprite file (' + v.sprite + ')' + alias };
  }

  // mugenversion outranks the code diff when the art is shared, because a state
  // file swapped for an engine-specific one IS the engine target - Tomoka's 1.1
  // def differs only in `st` pointing at M.U.G.E.N1.1.cns and in the version it
  // declares. Note this is the ONE place the field is used, and only to describe
  // a difference that is already visible in the files; nothing is inferred from
  // it, because it is stale in 30% of the corpus.
  if (!same('mugenversion')) {
    return { kind: 'engine-target', label: 'engine target',
      note: 'same art; declares mugenversion ' + (v.mugenversion || '(none)')
        + ' instead of ' + (primary.mugenversion || '(none)')
        + (codeDiffers ? ' and swaps its ' + codeFiles.join('/') : '') + alias };
  }

  if (codeDiffers) {
    const how = 'same art, its own ' + codeFiles.join('/');
    if (NOAI_RE.test(v.def)) {
      return { kind: 'no-ai', label: 'AI removed',
        note: how + ' - the name says the AI is taken out' + alias };
    }
    if (AI_RE.test(v.def)) {
      return { kind: 'ai', label: 'AI build',
        note: how + ' - the name says this one carries an AI patch' + alias };
    }
    return { kind: 'gameplay', label: 'different states', note: how + alias };
  }

  if (same('displayname') && same('pals')) {
    return { kind: 'duplicate', label: 'duplicate',
      note: 'identical to ' + primary.def + ' in every field this can compare' + alias };
  }
  return { kind: 'label', label: 'renamed',
    note: 'same files, different display name or palette list' + alias };
}

function charDefs(folder, primaryDef) {
  const dir = path.join(CACHE, String(folder || ''));
  let names = [];
  try { names = fs.readdirSync(dir).filter((f) => /\.def$/i.test(f)); } catch (e) { return []; }
  const out = [];
  for (const f of names) {
    let kv = null;
    try { kv = parseDefSections(fs.readFileSync(path.join(dir, f), 'latin1')); } catch (e) { continue; }
    // A character def names a sprite file and a command set; a stage def or a
    // stray storyboard does not.
    if (!kv || !kv['sprite'] || !kv['cmd']) continue;
    out.push({
      def: f,
      name: reencodeName(kv['name']) || f,
      displayName: reencodeName(kv['displayname'] || kv['name']) || f,
      rawName: dnorm(kv['name']),
      sprite: kv['sprite'], anim: kv['anim'], cmd: kv['cmd'],
      cns: kv['cns'], st: kv['st'],
      mugenversion: kv['mugenversion'] || '',
      displayname: kv['displayname'] || '',
      pals: Object.keys(kv).filter((x) => /^pal\d+$/.test(x)).length,
      sffVer: null,
    });
  }
  const plain = (d) => ({ def: d.def, name: d.name, displayName: d.displayName });
  // One def means there is nothing to be a variant OF, so skip the header reads.
  if (out.length < 2) return out.map(plain);

  for (const d of out) d.sffVer = sffVersionOf(dir, d.sprite);
  const primary = out.find((d) => dnorm(d.def) === dnorm(primaryDef)) || out[0];
  return out.map((d) => {
    const c = d === primary ? null : classifyDef(primary, d);
    return Object.assign(plain(d), {
      kind: c ? c.kind : 'primary',
      variantLabel: c ? c.label : '',
      variantNote: c ? c.note : '',
      sffVer: d.sffVer,
    });
  });
}

// Add one of those other .def files to the roster as its own slot. It shares
// the folder - the files are identical - so the build copies nothing extra;
// see vfslib.mountNames.
function addCharVariant(folder, defName) {
  const roster = readRoster();
  const base = roster.chars.find((c) => c.folder === folder && !c.kind);
  if (!base) throw new Error('that character is not in the build');
  const defs = charDefs(folder).map((d) => d.def);
  const pick = defs.find((d) => d.toLowerCase() === String(defName).toLowerCase());
  if (!pick) throw new Error('no such .def in that character');
  if (roster.chars.some((c) => c.folder === folder
      && String(c.select).split('/').slice(1).join('/').toLowerCase() === pick.toLowerCase())) {
    throw new Error('that version is already in the build');
  }
  // Its own mount NAME so the Studio can tell the two apart - the build maps
  // both back onto one folder.
  const stem = pick.replace(/\.def$/i, '').replace(/[^A-Za-z0-9_.-]+/g, '_');
  let mountAs = stem;
  // A LIBRARY ROW IS KEYED BY EITHER A MOUNT NAME OR A FOLDER NAME, so the two
  // namespaces must not overlap. Let a variant take the name of some OTHER
  // cache folder and two rows collapse onto one lowercase id: the folder
  // becomes undraggable (setBuildOrder resolves the name to this entry and
  // re-places it instead), and studio's delete button - which hands the row id
  // straight to a recursive rmSync - arms at the wrong directory.
  const taken = new Set(roster.chars.map((c) => String(c.mountAs || '').toLowerCase()));
  try {
    for (const d of fs.readdirSync(CACHE, { withFileTypes: true })) {
      if (d.isDirectory() && d.name.toLowerCase() !== String(folder).toLowerCase()) {
        taken.add(d.name.toLowerCase());
      }
    }
  } catch (err) { /* no cache dir: nothing to collide with */ }
  for (let n = 2; taken.has(mountAs.toLowerCase()); n++) mountAs = stem + '_' + n;
  const entry = { folder, select: mountAs + '/' + pick, mountAs };
  roster.chars.splice(roster.chars.indexOf(base) + 1, 0, entry);
  writeRoster(roster);
  return entry;
}

// RENAME THE DISPLAY NAME, AND ONLY THE DISPLAY NAME.
//
// A character def carries both `name` and `displayname`, and they are not the
// same thing. `displayname` is what the select screen and the lifebar show
// (char.go: it defaults to `name` when absent and feeds `lifebarname`).
// `name` is an IDENTIFIER other characters match on - `EnemyNear(..),name !=
// "may"` and friends appear in this very roster - so changing it can silently
// break another character's special interaction. This function never touches
// it, and there is deliberately no way to ask it to.
//
// Written in latin1 like every other def edit here, which is byte-preserving
// for everything it does not touch. That also sets the limit on what a name may
// contain: a character above U+00FF cannot be written this way, and a Japanese
// def is Shift-JIS, which Node cannot encode. Those are refused rather than
// mangled.
const DISPNAME_BAK = '.dispname.bak';

// How a name reaches the .def: UTF-8, whatever the rest of the file is.
//
// The engine reads `displayname` with IniSection.getText (common.go), which
// strips the quotes and nothing else - decodeShiftJIS is applied only to file
// paths, movelists and victory quotes. The bytes become a Go string, and a Go
// string is UTF-8: the font renderer ranges over runes (font.go), the select
// screen and lifebar copy the string as-is. So a name written as UTF-8 draws
// as the characters typed, and any other encoding draws replacement glyphs.
// This used to refuse anything above U+00FF as "not encodable" - true of
// Shift-JIS from Node, irrelevant to what the engine wants. Whether the
// glyphs then appear depends on the font: the stock bitmap fonts carry no
// kana or kanji, a TrueType lifebar font does. Byte-preserving for everything
// else in the file (latin1 round trip); a Shift-JIS comment three lines up
// is untouched.
function encodeDefValue(str) {
  return Buffer.from(String(str), 'utf8').toString('latin1');
}

// Rewrite (or add) the displayname line inside [Info]. `encoded` is the value
// as file bytes in latin1 form - see encodeDefValue. Pure: text in, text out.
function patchDisplayNameText(text, encoded) {
  // Only inside [Info]: a def can carry the word elsewhere in a comment.
  const info = /^[ \t]*\[Info\][^\n]*\n/im.exec(text);
  if (!info) throw new Error('this .def has no [Info] section');
  const start = info.index + info[0].length;
  const rest = text.slice(start);
  const nextSection = /^[ \t]*\[/m.exec(rest);
  const end = start + (nextSection ? nextSection.index : rest.length);
  const block = text.slice(start, end);

  const line = /^([ \t]*displayname[ \t]*=[ \t]*)("?)(.*?)\2([ \t]*;.*)?$/im;
  let nextBlock;
  if (line.test(block)) {
    nextBlock = block.replace(line, (_m, lead, _q, _old, comment) =>
      lead + '"' + encoded + '"' + (comment || ''));
  } else {
    // No displayname at all: put one right after `name`, where an author would.
    const nameLine = /^([ \t]*name[ \t]*=[^\n]*)$/im;
    if (!nameLine.test(block)) throw new Error('this .def has no name to sit beside');
    nextBlock = block.replace(nameLine, (m) => m + '\ndisplayname = "' + encoded + '"');
  }
  if (nextBlock === block) throw new Error('the name line could not be rewritten');
  return text.slice(0, start) + nextBlock + text.slice(end);
}

function setDisplayName(folder, defName, newName) {
  const dir = path.join(CACHE, String(folder || ''));
  const defs = charDefs(folder).map((d) => d.def);
  const pick = defs.find((d) => d.toLowerCase() === String(defName || '').toLowerCase());
  if (!pick) throw new Error('no such .def in that character');

  const name = String(newName == null ? '' : newName).trim();
  if (!name) throw new Error('give the character a name');
  if ([...name].length > 40) throw new Error('that name is too long for a select screen');
  if (/[\r\n"]/.test(name)) throw new Error('a name cannot contain quotes or line breaks');

  const file = path.join(dir, pick);
  const text = fs.readFileSync(file, 'latin1');
  const patched = patchDisplayNameText(text, encodeDefValue(name));

  const bak = file + DISPNAME_BAK;
  if (!fs.existsSync(bak)) fs.copyFileSync(file, bak);
  fs.writeFileSync(file, patched, 'latin1');

  // Read it back through the same parser the rest of the Studio uses, so a name
  // that did not land is reported instead of assumed.
  const kv = parseDefSections(fs.readFileSync(file, 'latin1'));
  const got = reencodeName(kv['displayname']);
  if (got !== name) {
    fs.copyFileSync(bak, file);
    fs.unlinkSync(bak);
    throw new Error('the name did not read back, so the file was put back');
  }
  invalidateDiag(folder);
  return { folder, def: pick, displayName: got };
}

function revertDisplayName(folder, defName) {
  const dir = path.join(CACHE, String(folder || ''));
  const defs = charDefs(folder).map((d) => d.def);
  const pick = defs.find((d) => d.toLowerCase() === String(defName || '').toLowerCase());
  if (!pick) throw new Error('no such .def in that character');
  const file = path.join(dir, pick);
  const bak = file + DISPNAME_BAK;
  if (!fs.existsSync(bak)) throw new Error('this name has not been changed');
  fs.copyFileSync(bak, file);
  fs.unlinkSync(bak);
  invalidateDiag(folder);
  const kv = parseDefSections(fs.readFileSync(file, 'latin1'));
  return { folder, def: pick, displayName: reencodeName(kv['displayname'] || kv['name']) };
}

// hScan's memo is stamped by each character's files (HSCAN_MEMO), so nothing
// is opened or closed here: a scan is served again only while the files it
// read are unchanged, in this call, the next one, or the pair bench's.
function studioInfo() {
  return studioInfoScan();
}

function studioInfoScan() {
  const roster = healStageNames(readRoster());
  // ONE index for the whole call. buildSizes, listThemes and every character's
  // scanMissingDeps all want the same snapshot of what the build contains;
  // asking for it thirty times is what made this take three seconds.
  let vfs = null;
  try { vfs = buildIndex(); } catch (e) { /* a label, never a blocker */ }
  const haveFiles = vfs ? new Set([...vfs.index.keys()].map((s) => s.toLowerCase())) : undefined;
  // One pass over the packer's index, shared by every card and the header
  // total. A per-character folder walk would answer a different question
  // (see buildSizes) and would also re-walk the tree 24 times.
  let sizes = { chars: {}, stages: {}, music: {}, total: 0, files: 0 };
  try { sizes = buildSizes(vfs); } catch (e) { /* sizes are a label, never a blocker */ }
  const chars = roster.chars.map(c => {
    let displayName = c.mountAs, sizeMB = 0, h = { giver: false, receiver: false, modules: 0, commands: [] };
    try {
      const dir = path.join(CACHE, c.folder);
      const defName = c.select.split('/').slice(1).join('/');
      const kv = parseDefSections(fs.readFileSync(path.join(dir, defName), 'latin1'));
      displayName = reencodeName(kv['displayname'] || kv['name']) || c.mountAs;
      // Keyed by mountAs: that is the folder the packer mounts the character
      // at (chars/<mountAs>/), which is what buildSizes measured.
      // A second version of a character mounts nothing of its own - the folder
      // is copied once under the first entry's name - so its own key is zero.
      // Report the files it SHARES instead, the way two stages sharing one .sff
      // each report it, and flag it so the card can say so rather than looking
      // like a broken 0 MB.
      let bytes = sizes.chars[String(c.mountAs || c.folder).toLowerCase()];
      if (!bytes) {
        const owner = roster.chars.find((o) => o.folder === c.folder && o.mountAs !== c.mountAs
          && sizes.chars[String(o.mountAs || '').toLowerCase()]);
        if (owner) {
          bytes = sizes.chars[String(owner.mountAs).toLowerCase()];
          c.sharesWith = owner.mountAs;
        }
      }
      sizeMB = bytes ? +(bytes / 1e6).toFixed(1) : 0;
      h = hScan(dir, defName);
      // Other .def files in the same folder, so the card can offer them.
      // Pass the def IN USE so each variant is described relative to it.
      c.defs = charDefs(c.folder, defName);
      c.def = defName;
      // Has this entry's display name been edited here? (So the card can offer
      // to put the author's back.)
      try {
        c.renamed = fs.existsSync(path.join(dir, defName + DISPNAME_BAK));
      } catch (e) { c.renamed = false; }
      try {
        // Cached against the files below; recomputed only when one changes.
        const stamp = diagStamp(dir, defName);
        const hit = DIAG_CACHE.get(c.mountAs || c.folder);
        if (hit && hit.stamp === stamp) {
          for (const k of DIAG_FIELDS) if (hit.data[k] !== undefined) c[k] = hit.data[k];
          throw DIAG_DONE;
        }
        const sff = defSffPath(dir, defName);
        c.sffVer = sffVersion(sff);
        c.hasPaletteBackup = fs.existsSync(sff + '.orig');
        if (c.sffVer === 1 && !c.hasPaletteBackup) {
          // Diagnostic for the Studio: how many sprites ignore .act colors.
          const subs = sffpal.walkSubfiles(fs.readFileSync(sff));
          c.ownPalSprites = subs.filter((s, i) => i > 0 && s.palSame === 0).length;
        }
        c.hasPalKeyBackup = fs.existsSync(sff + '.palkey.bak');
        // One whole-file read for the verdict and the details below.
        const palKeys = c.sffVer === 2 && !c.hasPalKeyBackup ? inspectPalKeys(sff) : null;
        if (c.sffVer === 2) c.palKeysBroken = c.hasPalKeyBackup || !!palKeys;
        // Only decode sprites for the few characters that actually have the
        // defect: it's the difference between the repair being offered and it
        // being refused, so the Studio needs to know before showing a button.
        if (c.palKeysBroken && !c.hasPalKeyBackup) {
          const info = palKeys;
          // null here means "there IS scene art and we could not read it", so
          // the card shows neither a button nor a warning and the repair
          // refuses. That is deliberate. It used to also fire for ordinary
          // undecodable body art, which is now filtered out inside
          // pairArtPaletteIndices rather than special-cased here.
          if (info) c.palKeysRepaint = pairArtRepaintCount(c.folder, sff, info.index, c.select);
          // Diagnosed as broken, but NOT repairable by re-keying: another slot
          // already owns (1,1). The card must explain this instead of offering
          // a button that would damage the character.
          if (info && info.conflict) c.palKeysConflict = info.conflictIndex;
        }
        // Lifebar portrait (9000,20): offer only when we could add one.
        c.hasPortraitBackup = fs.existsSync(sff + '.portrait.bak');
        if (c.sffVer === 2) {
          const pi = inspectPortrait(sff);
          c.canAddPortrait = !!pi || c.hasPortraitBackup;
          if (pi) c.portraitSource = pi.source;
        }
        // PORTRAIT RENUMBERING (GRAIL 3.4d). Offered when the character keeps
        // portrait art at a number the screenpack does not read - 9000,100/101
        // against a pack that reads 9000,0/1. quickState is a header walk, not
        // a decode, because this runs for every character on every refresh.
        // Both container versions, unlike the 9000,20 tool above.
        try {
          const q = portraitfix.quickState(sff);
          c.hasPortraitFix = q.applied;
          c.canFixPortrait = q.applied || !!q.suggestion;
          if (!q.applied && q.suggestion) {
            c.portraitFixFrom = '9000,' + q.suggestion.from
              + (q.suggestionBig ? ' and 9000,' + q.suggestionBig.from : '');
          }
        } catch (e) { /* an unreadable .sff costs a button, not the card */ }
        // SFF v2 only: does the character throw away the engine's color-pick
        // controller by overriding state 5900? No palette repair can help it
        // until that is restored. See inspectPalApplier.
        // PNG PALETTES. Rare (2 of 26 here, both Dr.Kira) but fatal on a stock
        // desktop engine, which has no readPngPalette - see convertPngPalettes.
        // Reported for SFF v1 too: the misread is worse on v2, but a v1
        // character still loses every palette it declares this way.
        try {
          const pngRefs = pngPaletteRefs(dir, defName);
          c.pngPalettes = pngRefs.length || undefined;
          // External palettes that BLANK slots the .sff provides - GRAIL 3.3
          // says externals should only fill what the SFF lacks. Dr.Kira's do
          // the reverse across 16-31 and 40-54, which is what makes a helper
          // spawned with ownpal=0 render as a black silhouette.
          const gapRep = paletteGapReport(c.folder, { select: c.select });
          c.palGaps = gapRep ? gapRep.reduce((n, g) => n + g.gaps, 0) : undefined;
          c.hasPalGapBackup = fs.existsSync(path.join(dir, defName)) && (() => {
            try { return fs.readdirSync(dir, { recursive: true }).some((n) => String(n).endsWith('.gap.bak')); }
            catch (e) { return false; }
          })() || undefined;
          c.hasPngPalBackup = fs.existsSync(path.join(dir, defName) + '.pngpal.bak') || undefined;
        } catch (e) { /* a palette scan is never a reason to fail the card */ }
        if (c.sffVer === 2) {
          const applierBaks = palApplierBackups(c.folder, defName);
          c.palApplierFixed = applierBaks.length ? applierBaks : null;
          c.palApplier = c.palApplierFixed ? null : inspectPalApplier(c.folder, defName);
        }
        const keep = {};
        for (const k of DIAG_FIELDS) if (c[k] !== undefined) keep[k] = c[k];
        DIAG_CACHE.set(c.mountAs || c.folder, { stamp, data: keep });
      } catch (e) {
        // DIAG_DONE is the cache hit unwinding out of the block, not a failure.
        if (e !== DIAG_DONE) { /* optional info */ }
      }
      // FILES IT REFERENCES BUT DOES NOT SHIP - it will not load without them.
      // Never cached with the diagnosis above: the answer changes with the WHOLE
      // build (adding Dhalsim resolves divesim's chars/Dhalsim/ lines) and with
      // files supplied into the folder, and neither moves that stamp - so the
      // Properties button kept saying "missing 5 files" after both. It is one
      // .def read against the build's index, cheap enough for every refresh.
      if (haveFiles) {
        try { c.missingDeps = scanMissingDeps(c.folder, defName, haveFiles); } catch (e) { /* optional info */ }
      }
    } catch { /* leave fallbacks */ }
    const netplay = netplayVerdict(sizeMB, h);
    return { ...c, displayName, sizeMB, h, netplay };
  });

  // Cross-character compatibility: a character also counts as receiver when
  // its animation table covers a meaningful chunk of a roster giver's
  // required registry (givers use private registries the fixed standard
  // windows can't know about). Coverage percentages feed the UI tooltips.
  for (const c of chars) {
    if (!c.h || !c.h.airActions) continue;
    c.h.coverage = {};
    for (const g of chars) {
      const reg = g.h && g.h.registryH;
      if (g === c || !g.h || !g.h.giver || !reg || reg.size === 0) continue;
      // A card answers no giver either: an interface plate numbered 70000 is
      // not the 70000 he asks for (same eye as the orphan rule, h.uiCards) -
      // nor is a meter frame of her own HUD bank (h.hudRuns), nor pair art
      // with nothing left to draw (h.blankArt).
      const setAside = (n) => ['uiCards', 'hudRuns', 'blankArt'].some((k) => c.h[k] && c.h[k].has(n));
      const hits = [...reg].filter(n => c.h.airActions.has(n) && !setAside(n));
      const pct = Math.round(100 * hits.length / reg.size);
      if (pct > 0) c.h.coverage[g.displayName] = pct;
      // A percentage of a tiny registry is noise: 2 of 6 was 33%. Four real
      // hits AND a share of the set.
      if (hits.length >= 4 && pct >= 15) c.h.receiver = true;
    }
  }
  // Sets don't serialize to JSON; strip the raw data, keep the verdicts.
  for (const c of chars) {
    if (c.h) {
      // uiCards survives as a COUNT: the card says how many window-numbered
      // interface actions were set aside, so a verdict can be explained.
      c.h.uiCardCount = c.h.uiCards ? c.h.uiCards.size : 0;
      c.h.hudRunCount = c.h.hudRuns ? c.h.hudRuns.size : 0;
      c.h.blankArtCount = c.h.blankArt ? c.h.blankArt.size : 0;
      // Not an H finding, so it leaves h (whose every field the page keeps
      // out of sight outside H-Mugen mode): the card's SABOTAGES OPPONENTS
      // tag, with where it is written (modlib sabotageSites).
      if (c.h.sabotage && c.h.sabotage.length) c.sabotage = { count: c.h.sabotage.length, sites: c.h.sabotage.slice(0, 4) };
      delete c.h.sabotage;
      delete c.h.registry; delete c.h.registryH; delete c.h.airActions; delete c.h.probesWindow;
      delete c.h.airFrames; delete c.h.uiCards; delete c.h.hudRuns; delete c.h.blankArt;
      delete c.h.giverHitNums; delete c.h.expectsHNums;
    }
  }
  const music = [];
  try {
    for (const f of fs.readdirSync(MUSIC)) {
      if (/\.(ogg|mp3)$/i.test(f)) music.push('sound/' + f);
    }
  } catch { /* no music dir */ }
  // Themes come from the VFS index, and now that really does mean the Studio
  // lists exactly what can boot - anything refused comes back separately, with
  // the file it could not find, rather than vanishing.
  let themes = [];
  const themesUnusable = [];
  try { themes = listThemes(themesUnusable, vfs); } catch { /* a broken layer shouldn't blank the page */ }
  return { roster: { ...roster, chars }, music, themes, themesUnusable,
    // The bundle's H-MUGEN module (hmodule.js): 'on' | 'off' | 'unasked' | 'notnow',
    // and the H characters a 'not now' was asked about.
    hModule: { state: require('./hmodule.js').moduleState(roster), seen: Array.isArray(roster.hModuleSeen) ? roster.hModuleSeen : [] },
    motif: roster.motif || null, sizes,
    // Where the two exports land unless a folder is chosen. Shown in the UI
    // so "the default folder" is a path a person can read, not a guess.
    exports: { desktop: layout.DESKTOP_EXPORT, website: layout.WEBSITE_EXPORT },
    // Which stages already show a picture on the select screen, and which the
    // Studio has edited (so the card can offer to put it back).
    stageThumbs: stageThumbState(roster),
    // Where the browser puts a download (the animation panel's GIF). Empty
    // means "wherever Windows sends it", which is the default and the truth
    // for anyone who never opens the setting.
    downloadFolder: layout.DOWNLOAD_FOLDER,
    // What this start moved into the Settings folder (an older copy's keys and
    // choices, from app/), or could not: said once on the page, which
    // remembers the note it showed. The starter content, and an old layout
    // file removed with nothing in it to keep, are only logged.
    settingsNotes: (layout.STARTUP_NOTES || []).filter((n) => n.kind === 'moved' || n.kind === 'error'),
    // What the characters folder is CALLED where this copy runs - "cache" in
    // the repo, "characters" in a portable copy - so the UI names the real one.
    folders: { characters: layout.folderName('cache') },
    // The startup logo: custom (a storyboard in Content/<bundle>/logo/) or the
    // screenpack's own. A desktop export never carries the web build's.
    logo: logoInfo() };
}

// WHAT /api/studio CAN SAY AT ONCE ABOUT A BUILD OPENED READ-ONLY.
//
// The scan above costs about a sixth of a second per character - the H scan,
// the sprite file's diagnosis, the web build's whole file index - and on the
// Ikemen Fighting Collection's 802 that is two minutes before the page shows
// anything. So a read-only bundle answers first with this: the same shape,
// the roster and every character's own name and .def files (one read of the
// def each, about a second in all), and the fields that need the whole scan
// left at what the scan itself falls back to when it cannot read a character
// (no H role, no diagnosis, no size). `pending: true` tells the page that the
// full answer - studioInfo itself, worked out beside the server
// (readonlyscan.js) - is still coming. A normal bundle never sees this.
function studioInfoLight() {
  const roster = healStageNames(readRoster());
  const chars = roster.chars.map((c) => {
    let displayName = c.mountAs;
    const h = { giver: false, receiver: false, modules: 0, commands: [] };
    try {
      const defName = c.select.split('/').slice(1).join('/');
      const kv = parseDefSections(fs.readFileSync(path.join(CACHE, c.folder, defName), 'latin1'));
      displayName = reencodeName(kv['displayname'] || kv['name']) || c.mountAs;
      c.def = defName;
      try { c.defs = charDefs(c.folder, defName); } catch (e) { /* the versions list waits for the scan */ }
    } catch { /* leave fallbacks */ }
    // sizeMB null, not 0: unknown until the scan, and the page prints nothing
    // for it rather than "0 MB".
    return { ...c, displayName, sizeMB: null, h, netplay: netplayVerdict(0, h) };
  });
  const music = [];
  try {
    for (const f of fs.readdirSync(MUSIC)) {
      if (/\.(ogg|mp3)$/i.test(f)) music.push('sound/' + f);
    }
  } catch { /* no music dir */ }
  return { roster: { ...roster, chars }, music, themes: [], themesUnusable: [],
    // The bundle's H-MUGEN module (hmodule.js): 'on' | 'off' | 'unasked' | 'notnow',
    // and the H characters a 'not now' was asked about.
    hModule: { state: require('./hmodule.js').moduleState(roster), seen: Array.isArray(roster.hModuleSeen) ? roster.hModuleSeen : [] },
    motif: roster.motif || null, sizes: { chars: {}, stages: {}, music: {}, total: 0, files: 0 },
    exports: { desktop: layout.DESKTOP_EXPORT, website: layout.WEBSITE_EXPORT },
    stageThumbs: {},
    downloadFolder: layout.DOWNLOAD_FOLDER,
    settingsNotes: (layout.STARTUP_NOTES || []).filter((n) => n.kind === 'moved' || n.kind === 'error'),
    folders: { characters: layout.folderName('cache') },
    logo: logoInfo(),
    pending: true };
}

// --- Scene Viewer mod generator ----------------------------------------------
//
// Generates external/mods/mugen-studio/sceneviewer.lua for the game: an in-fight overlay
// plus focus switching. TAB cycles which of the (up to 4) characters the
// keyboard controls (everyone else runs AI); the overlay lists the focused
// character's scene commands, harvested from each giver's cmd file at build
// time. Works in any local fight mode; two pairs = launch a 2v2 Simul match.

function prettyCmd(cmd) {
  return cmd.trim()
    .replace(/^\//, 'hold ')
    .replace(/^~/, 'release ')
    .replace(/\bU\b/g, 'Up').replace(/\bD\b/g, 'Down')
    .replace(/\bB\b/g, 'Back').replace(/\bF\b/g, 'Fwd');
}

function collectSceneCommands(folder, select) {
  try {
    const dir = path.join(CACHE, folder);
    const defName = select.split('/').slice(1).join('/');
    const kv = parseDefSections(fs.readFileSync(path.join(dir, defName), 'latin1'));
    if (!kv['cmd']) return [];
    const text = fs.readFileSync(path.join(dir, kv['cmd'].replace(/\\/g, '/')), 'latin1');
    const out = [];
    for (const block of text.split(/\[Command\]/i).slice(1)) {
      const name = /name\s*=\s*"([^"]+)"/.exec(block);
      const cmd = /(?:^|\n)\s*command\s*=\s*([^\r\n;]+)/.exec(block);
      if (name && cmd && H_COMMANDS.test(name[1])) {
        out.push([name[1], prettyCmd(cmd[1])]);
      }
    }
    // de-duplicate by name, keep first binding
    const seen = new Set();
    return out.filter(([n]) => !seen.has(n) && seen.add(n));
  } catch { return []; }
}

function buildSceneViewerLua() {
  const roster = readRoster();
  const db = {};
  // Only the giver answer is read here, and vfslib's scannedH keeps it per
  // character under a stamp of the files hScan reads, so every build and
  // export after the first rescans only what changed (a full hScan of every
  // character ran on each). Looked up at call time - vfslib requires this
  // module - with hScan itself when that vfslib does not export it.
  const giverScan = require('./vfslib').scannedH || hScan;
  for (const c of roster.chars) {
    // skipslot/randomselect placeholders hold a CELL, not a character.
    if (c.kind === 'skip' || c.kind === 'random' || !c.folder || !c.select) continue;
    const dir = path.join(CACHE, c.folder);
    const defName = c.select.split('/').slice(1).join('/');
    const h = giverScan(dir, defName);
    if (!h.giver) continue;
    const cmds = collectSceneCommands(c.folder, c.select);
    if (cmds.length) {
      let display = c.mountAs;
      try {
        const kv = parseDefSections(fs.readFileSync(path.join(dir, defName), 'latin1'));
        display = (reencodeName(kv['displayname'] || kv['name']) || c.mountAs);
      } catch { /* fallback */ }
      db[display.toLowerCase()] = cmds;
    }
  }

  const luaDb = Object.entries(db).map(([name, cmds]) =>
    `  [${JSON.stringify(name)}] = {\n` +
    cmds.map(([n, c]) => `    {${JSON.stringify(n)}, ${JSON.stringify(c)}},`).join('\n') +
    '\n  },').join('\n');

  return `-- Scene Viewer (generated by the Mod Studio - do not edit by hand)
-- Training-only sandbox tool:
--   TAB       take control of the next character (everyone else stands idle)
--   CAPSLOCK  cycle the focused character's lock-on target (facing holds)
--   Shift+TAB turn everything off
-- Overlay lists the focused character's scene commands when it is a giver.

-- Mark this as the web build: main.lua checks this to route JOIN GAME
-- straight to the WebRTC connect (no IP entry) instead of the server list.
main.webBuild = true

local sv = { on = false, focus = 1, target = {} }

local svCmds = {
${luaDb}
}

-- Overlay geometry: centered horizontally, below the lifebars. Text draws
-- in the motif's localcoord space, so derive positions from it (fallback
-- 320x240) rather than hardcoding - a left-anchored x=10 rendered cut off
-- on some window shapes.
local svW = (motif and motif.info and motif.info.localcoord and motif.info.localcoord[1]) or 320
local svH = (motif and motif.info and motif.info.localcoord and motif.info.localcoord[2]) or 240
local svScale = svH / 240
local svLineH = math.floor(10 * svScale + 0.5)
local svY0 = math.floor(44 * svScale + 0.5)

-- V2 dropped the v1 \`text:create\` helper for the raw textImg* API, so build
-- the sprites by hand. The one thing that MUST be restored is the coordinate
-- space. v1 had a GLOBAL Lua scale (main.f_setLuaScale/f_disableLuaScale) that
-- silently put every Lua-made sprite in the motif's localcoord space, so the
-- positions above just worked. V2 deleted it: there is no setLua*Scale left in
-- script.go, and each sprite now carries its OWN localcoord instead - V2's
-- main.lua does exactly this per sprite (animSetLocalcoord, ~line 759).
-- Without it a sprite defaults to localScale=1, i.e. the engine's native
-- 320x240 fight space, and the numbers above (derived from a 1280x720 motif:
-- x = svW/2 = 640) land ~640 in a ~427-wide space - the text renders far off
-- the right edge, silently. That is why only the text broke on V2 while the
-- hotkeys, which touch no sprites, kept working.
-- Order matters and mirrors the engine's own builder (src/iniutils.go ~2305):
-- localcoord FIRST, because SetPos/SetScale/SetWindow all bake localScale in.
-- Scale is svScale (not 1) so the 6x9 font still lands at natural size: the
-- localcoord shrinks by 320/(svH*4/3) and svScale cancels it back out.
-- Built lazily on first draw (by then the motif and screen are real), and the
-- text is only pushed when it CHANGES: this runs every frame while the viewer
-- is on, and re-setting an identical string just makes garbage for the GC to
-- collect mid-round, which on single-thread wasm is a visible hitch.
local svFont, svSprites = nil, {}
local function svSprite(key)
  local s = svSprites[key]
  if s then return s end
  if svFont == nil then svFont = fontNew('f-6x9.def', -1) end
  local t = textImgNew()
  textImgSetFont(t, svFont)
  textImgSetAlign(t, 0)          -- 0 = centered
  textImgSetColor(t, 255, 255, 255)
  textImgSetLocalcoord(t, svW, svH)
  textImgSetScale(t, svScale, svScale)
  textImgSetWindow(t, 0, 0, svW, svH)
  s = { ti = t, last = nil }
  svSprites[key] = s
  return s
end
local function svDraw(key, str, x, y)
  local s = svSprite(key)
  if s.last ~= str then
    textImgSetText(s.ti, str)
    s.last = str
  end
  textImgSetPos(s.ti, x, y)
  textImgDraw(s.ti)
end

-- Ikemen supports Simul teams up to 4 per side = 8 characters on stage.
local MAXP = 8

-- The Scene Viewer is a TRAINING-ONLY sandbox tool; in every other mode it
-- stays completely inert so normal gameplay can't be disturbed. gameMode()
-- already excludes the netplay modes; connected() is belt and braces.
local function svActive()
  return gameMode() == 'training' and not connected()
end

local function svExists(i)
  local oldid = id()
  if player(i) then
    playerId(oldid)
    return true
  end
  return false
end

-- V2 has no charMapSet(playerNo, ...). mapSet is [redirectable]: it acts on the
-- working character, which player() selects - so borrow it and hand it back.
local function svMapSet(i, name, value)
  local oldid = id()
  if player(i) then
    mapSet(name, value)
    playerId(oldid)
  end
end

local function svApply()
  -- reset input map, then give the keyboard (input 1) to the focused char
  for i = 1, MAXP do remapInput(i, i) end
  if sv.focus ~= 1 then
    remapInput(1, sv.focus)
    remapInput(sv.focus, 1)
  end
  -- Focused char is human; everyone else stands idle (AI 0 + no input).
  local oldid = id()
  for i = 1, MAXP do
    if player(i) then
      setAILevel(0)
      playerId(oldid)
    end
  end
end

function SceneViewerCycle()
  if not svActive() then return end
  -- First press: take over the character you're already playing (slot 1)
  -- rather than immediately cycling away from it.
  if not sv.on then
    sv.on = true
    sv.focus = 1
    if not svExists(sv.focus) then sv.on = false return end
    svApply()
    return
  end
  for _ = 1, MAXP do
    sv.focus = sv.focus % MAXP + 1
    if svExists(sv.focus) then break end
  end
  svApply()
end

function SceneViewerOff()
  if not sv.on then return end
  sv.on = false
  sv.focus = 1
  for i = 1, MAXP do remapInput(i, i) end
  -- clear all lock-on targets (releases the noAutoTurn enforcement)
  for i = 1, MAXP do
    if svExists(i) then svMapSet(i, '_sv_target', 0) end
  end
  sv.target = {}
end

-- CAPSLOCK: lock-on targeting for the focused character. Cycles through the
-- enemy team's existing slots (odd slots fight even slots), then a final
-- press clears the lock. While locked, data/training.zss keeps the character
-- facing its target every frame, overriding autoturn - so pairs stay
-- oriented even when someone closer walks by.
function SceneViewerTarget()
  if not svActive() or not sv.on then return end
  if not svExists(sv.focus) then return end
  -- enemy slots have the opposite parity of the focused slot
  local enemies = {}
  local myParity = sv.focus % 2
  for i = 1, MAXP do
    if i % 2 ~= myParity and svExists(i) then
      table.insert(enemies, i)
    end
  end
  if #enemies == 0 then return end
  -- advance: current target -> next enemy -> ... -> off -> first enemy
  local cur = sv.target[sv.focus] or 0
  local nextT = 0
  if cur == 0 then
    nextT = enemies[1]
  else
    for k, slot in ipairs(enemies) do
      if slot == cur then
        nextT = enemies[k + 1] or 0 -- past the last enemy = lock off
        break
      end
    end
    if nextT == 0 and cur ~= enemies[#enemies] then nextT = enemies[1] end
  end
  sv.target[sv.focus] = nextT
  svMapSet(sv.focus, '_sv_target', nextT)
end

addHotkey('TAB', false, false, false, true, false, 'SceneViewerCycle()')
-- Shift+TAB, not Ctrl+TAB: browsers reserve Ctrl+Tab for tab switching
-- and never deliver it to the page.
addHotkey('TAB', false, false, true, true, false, 'SceneViewerOff()')
addHotkey('CAPSLOCK', false, false, false, true, false, 'SceneViewerTarget()')

hook.add('loop', 'sceneviewer', function()
  if not svActive() then return end
  -- Sandbox default at round start: pacify every extra character. The
  -- engine assigns real AI to all simul members beyond the two leaders
  -- (regardless of training's dummy settings), and training.zss only
  -- manages the dummy side leader - so idle slots 3..8 explicitly.
  if roundState() < 2 then
    sv.init = false
  elseif not sv.init then
    sv.init = true
    local oldid = id()
    for i = 3, MAXP do
      if player(i) then
        setAILevel(0)
        playerId(oldid)
      end
    end
  end
  if not sv.on then return end
  local oldid = id()
  local function nameOf(i)
    local n = ''
    if player(i) then
      n = name()
      playerId(oldid)
    end
    return n
  end
  local focusName = nameOf(sv.focus)
  -- count heads AND the focused character's position among them, so a 1v2
  -- (slots 1,2,4) reads "3/3" rather than the puzzling "P4/3"
  local total, ord = 0, 0
  for i = 1, MAXP do
    if svExists(i) then
      total = total + 1
      if i <= sv.focus then ord = ord + 1 end
    end
  end
  svDraw('title', 'SCENE VIEWER  [TAB] controlling ' .. ord .. '/' .. total .. ': ' .. focusName, svW / 2, svY0)
  local y = svY0
  local tgt = sv.target[sv.focus] or 0
  if tgt > 0 and svExists(tgt) then
    y = y + svLineH
    svDraw('lock', 'locked on: ' .. nameOf(tgt) .. '  [CAPS cycles]', svW / 2, y)
  end
  -- These are NOT motions that start a scene. They are held directions and
  -- buttons that switch POSITION while a scene is already running (measured:
  -- R Mika B/F/U/D = doggystyle/blowjob/cowgirl/missionary, DongHwan U/F/B =
  -- manguri8/manguri6/slime4). The scene itself is entered by some other grab,
  -- so the header says "hold" - a player hunting for a motion won't find one.
  local cmds = svCmds[focusName:lower()]
  if cmds then
    svDraw('cmdhdr', #cmds .. ' scene positions (hold during a scene):', svW / 2, y + svLineH)
    for i, entry in ipairs(cmds) do
      svDraw('cmd' .. i, entry[1] .. ' = ' .. entry[2], svW / 2, y + (i + 1) * svLineH)
    end
  elseif focusName ~= '' then
    svDraw('none', '(no scene positions - receiver or plain character)', svW / 2, y + svLineH)
  end
end)
`;
}

// Decode one sprite out of a cached character's SFF and return an indexed PNG,
// or null if anything is missing. Every failure is a null rather than a throw:
// this reads third-party content, and a character with a broken SFF should cost
// its own portrait, not the whole grid render.
//
// Uses findMainDef rather than the roster's `select` path so it also works for
// a character that is on disk but not yet in the roster - which is exactly the
// case a "pick a character to place in a cell" UI needs.
// THE THREE TERMS THAT DECIDE HOW BIG A CHARACTER DRAWS.
//
// The select screen does NOT draw every character at one scale. From
// start.lua:727-732:
//
//   xscale = portraitscale * motif.localcoord[1] / char.localcoord
//   yscale = xscale
//   if the source is an ANIMATION: xscale *= cns_scale[1], yscale *= cns_scale[2]
//
// Note yscale starts as a copy of xscale - the character's localcoord Y is
// never used, so balrog's `320,480` must not halve his height - and cns_scale
// applies ONLY to an animation source (start.lua:715, v[2] == -1), not to a
// static sprite like the big 9000,1 portrait.
//
// cns_scale is the [Size] xscale/yscale of the file named by [Files] cns. Its
// fallbacks are the engine's (system.go:5411-5433, 4622-4625):
//   [Size] present, key missing -> 320 / localcoordX  (BOTH axes use X)
//   file missing or no [Size]   -> 1
//
// Reading none of this drew hi-res characters up to 4x too large: six of the
// seven reported are rips that ship no localcoord at all and shrink themselves
// with [Size] xscale between 0.308 and 0.5.
// A MOUNT NAME IS NOT ALWAYS A FOLDER NAME.
//
// A character that ships several .def files gets one roster slot per version -
// each with its own mount name, all pointing at the SAME folder on disk. So
// resolve through the roster, and fall back to the mount name itself, which is
// what every ordinary character uses and what callers outside the roster (the
// library list, a character not yet added) still pass.
//
// The entry's own .def comes back too: a variant's animations and palettes
// belong to ITS def, not to whichever one findMainDef would have picked.
//
// ONE ROSTER READ PER cellPortraits CALL. This and fittedPortrait read and
// parsed roster.json for every character they were asked about - four parses
// per character per cellPortraits (182 on the scratch copy of Main, thousands
// of a much bigger file at 800 characters). cellPortraits reads it once and
// lends it here for the length of its call (synchronous; cleared in a
// finally); everything else reads the file as before. Both only read it.
let ROSTER_FOR_CALL = null;
const rosterNow = () => ROSTER_FOR_CALL || readRoster();
function charSource(mountAs) {
  const id = String(mountAs || '');
  try {
    const entry = (rosterNow().chars || []).find((c) => c.mountAs === id && c.folder);
    if (entry) {
      const def = String(entry.select || '').split('/').slice(1).join('/');
      return { dir: path.join(CACHE, entry.folder), entryDef: def || null };
    }
  } catch (e) { /* no roster yet, or unreadable - the fallback is right */ }
  return { dir: path.join(CACHE, id), entryDef: null };
}

// A .cns's [Size] keys, per version of the file (path|size@mtime): the FIRST
// [Size] section, first occurrence of each key - the engine's ini rules - or
// null when it has none. charScale is asked per character by cellPortraits
// (every E-Select load and pack edit), the portrait fit and the scale card,
// and read the whole .cns each time (3.6 MB per cellPortraits on Main). A
// file that cannot be read throws and is not remembered. Read-only to callers.
const CNS_SIZE_CACHE = new Map();   // path -> { stamp, size }
const CNS_SIZE_CACHE_MAX = 4096;
function cnsSizeKeys(cnsPath) {
  const st = fs.statSync(cnsPath);
  const stamp = st.size + '@' + st.mtimeMs;
  const hit = CNS_SIZE_CACHE.get(cnsPath);
  if (hit && hit.stamp === stamp) return hit.size;
  const text = fs.readFileSync(cnsPath, 'latin1');
  const size = {};
  let inSec = false, seen = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/;.*$/, '').trim();
    if (/^\[/.test(line)) {
      if (seen && inSec) break;
      inSec = /^\[\s*size\s*\]$/i.test(line);
      if (inSec) seen = true;
      continue;
    }
    if (!inSec || !line) continue;
    const m = line.match(/^([^=]+?)\s*=\s*(.*)$/);
    if (m && !(m[1].trim().toLowerCase() in size)) {
      size[m[1].trim().toLowerCase()] = m[2].trim();
    }
  }
  const value = seen ? size : null;
  CNS_SIZE_CACHE.delete(cnsPath);
  CNS_SIZE_CACHE.set(cnsPath, { stamp, size: value });
  if (CNS_SIZE_CACHE.size > CNS_SIZE_CACHE_MAX) CNS_SIZE_CACHE.delete(CNS_SIZE_CACHE.keys().next().value);
  return value;
}

function charScale(mountAs) {
  const out = { localcoord: 320, portraitscale: 1, cnsScale: [1, 1] };
  const { dir, entryDef } = charSource(mountAs);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return out;
  const defName = (entryDef && fs.existsSync(path.join(dir, entryDef))) ? entryDef : findMainDef(dir);
  if (!defName) return out;
  let def;
  try { def = sffDecode.parseDef(path.join(dir, defName)); } catch (e) { return out; }
  if (!def) return out;
  out.localcoord = def.localcoord || 320;
  out.portraitscale = def.portraitscale || 1;
  if (!def.cns) return out;

  // The CNS may sit beside the def, or under data/ - and its case in the def
  // rarely matches the disk, exactly like the sprite and anim paths.
  const rel = String(def.cns).replace(/\\/g, '/');
  let cnsPath = null;
  for (const base of [path.dirname(path.join(dir, defName)), dir, path.join(dir, 'data')]) {
    const direct = path.join(base, rel);
    if (fs.existsSync(direct)) { cnsPath = direct; break; }
    const want = path.basename(rel).toLowerCase();
    let hit = null;
    try {
      hit = fs.readdirSync(base).find((f) => f.toLowerCase() === want);
    } catch (e) { hit = null; }
    if (hit) { cnsPath = path.join(base, hit); break; }
  }
  if (!cnsPath) return out;

  let size;
  try { size = cnsSizeKeys(cnsPath); } catch (e) { return out; }
  if (!size) return out;
  const fallback = 320 / out.localcoord;
  const num = (v, dflt) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : dflt;
  };
  out.cnsScale = [
    'xscale' in size ? num(size.xscale, fallback) : fallback,
    'yscale' in size ? num(size.yscale, fallback) : fallback,
  ];
  return out;
}

// Geometry of ONE sprite: its size and, crucially, its AXIS. The axis is the
// point the engine puts on a declared offset and rotates about, so a face
// drawn from a static `spr` (the big 9000,1 portrait) cannot be positioned
// without it. charAnim already returns this per frame; a still sprite had no
// way to ask.
// ---- ONE OPEN SFF PER CHARACTER --------------------------------------------
//
// spriteGeomFor opened, parsed and indexed a whole .sff on EVERY call, and
// cellPortraits calls it twice per character - fifty full reads to draw one
// roster of twenty-five. The palette browser and the big-portrait scan would
// have multiplied that again.
//
// Keyed on path|size@mtime exactly like MOTIF_SFF_CACHE, so editing a
// character's sprites invalidates that character and nothing else. Capped and
// LRU because these files run to hundreds of megabytes and this is a desktop
// program, not a server.
const CHAR_SFF_CACHE = new Map();
const CHAR_SFF_MAX = 8;

// WHICH .sff, and its path|size@mtime key, WITHOUT reading it: a def parse and
// a stat. Split out so a cache of numbers measured from the file (the cell
// geometry below, a fitted portrait) can check its own stamp first and never
// open a sprite file it already has the answer for.
function charSffKey(mountAs) {
  const { dir, entryDef } = charSource(mountAs);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return null;
  const defName = (entryDef && fs.existsSync(path.join(dir, entryDef))) ? entryDef : findMainDef(dir);
  if (!defName) return null;
  let def = null;
  try { def = sffDecode.parseDef(path.join(dir, defName)); } catch (e) { return null; }
  if (!def || !def.sprite) return null;
  let sffPath = null;
  try { sffPath = mainSffPathLoose(dir, def); } catch (e) { return null; }

  let stamp = '-';
  try { const st = fs.statSync(sffPath); stamp = st.size + '@' + st.mtimeMs; } catch (e) { /* gone */ }
  return { dir, defName, def, sffPath, key: sffPath + '|' + stamp };
}

function charSff(mountAs) {
  const k = charSffKey(mountAs);
  if (!k) return null;
  const { dir, defName, def, sffPath, key } = k;

  const hit = CHAR_SFF_CACHE.get(mountAs);
  if (hit && hit.key === key) {
    CHAR_SFF_CACHE.delete(mountAs);      // re-insert: Map keeps insertion order,
    CHAR_SFF_CACHE.set(mountAs, hit);    // so the oldest key is the LRU victim
    return hit;
  }
  let sff = null;
  try { sff = sffDecode.readSff(sffPath); } catch (e) { return null; }
  if (!sff) return null;
  const rec = { key, dir, defName, def, sff, sffPath };
  CHAR_SFF_CACHE.set(mountAs, rec);
  while (CHAR_SFF_CACHE.size > CHAR_SFF_MAX) {
    CHAR_SFF_CACHE.delete(CHAR_SFF_CACHE.keys().next().value);
  }
  return rec;
}

// ---- THE PORTRAIT A CHARACTER ACTUALLY HAS ---------------------------------
//
// A screenpack asks for a sprite by number and assumes it is there. Three of
// the characters installed here keep a 15x31 sprite at 9000,0 - one author's
// template, not a decode fault - while their real portrait is 424x455 at
// 9000,1. Others renumber entirely. So the number is a request, not a promise.
//
// Order: what was asked for, then the conventional big portrait, then simply
// the LARGEST sprite in group 9000. The scan stops at group 9000 deliberately:
// falling back to the largest sprite in the whole file would happily return a
// stage-sized special effect.
//
// Sizing is free - spriteGeom reads the sprite node (v2) or the PCX header
// (v1) and decodes no pixels - so scanning a whole group costs nothing.
// A PORTRAIT IS A SHAPE, NOT JUST A BIG SPRITE. Picking purely by area is
// wrong in both directions and was measured to be so across this roster:
//  - group 9000 also holds the VS art, and for ten of twenty-five characters
//    that is the largest sprite in the group. balrog's is a 360x160 banner and
//    guile's a 302x160; returning either gives you a letterbox where a face
//    should be.
//  - it also holds lifebar debris - 42x13, 34x55, 15x31 - which is what the
//    broken characters keep at 9000,0 in the first place.
// So a candidate has to be big enough to be art AND roughly face-shaped.
function plausiblePortrait(g) {
  if (!g || !g.w || !g.h) return false;
  if (g.w * g.h < 1600) return false;            // 40x40: below this it is UI debris
  const aspect = g.w / g.h;
  // Measured: real portraits here run 0.86 (120x140), 0.93 (424x455), 0.95
  // (133x140). The rejects are the tall VS art at 0.56 (504x898) and 0.55, a
  // 0.33 tower (kur0maru's 9000,1) and a 2.25 banner (balrog's 9000,2).
  return aspect >= 0.65 && aspect <= 1.6;
}

// Order: what the screenpack asked for, the conventional big portrait, then the
// largest PLAUSIBLE sprite in group 9000. Each step must pass the shape test
// before it is accepted - kur0maru keeps a 120x363 at 9000,1 and its real
// portrait at 9000,101, so "prefer 9000,1" without the test picks the tower.
// The search stops at group 9000: widening it to the whole file returns a
// stage-sized special effect, which is worse than returning nothing.
//
// `source` says which rung answered, and is carried all the way to the UI. This
// feature exists BECAUSE the numbering cannot be trusted, so silently
// substituting art without saying which sprite it is would reproduce the
// confusion it is meant to cure.
function bestPortrait(sff, wantGroup, wantIndex) {
  if (!sff || !sff.byKey) return null;
  const at = (g, i, source) => {
    const q = sffDecode.spriteGeom(sff, g, i);
    return q ? { group: g, index: i, w: q.w, h: q.h,
                 axisX: q.axisX, axisY: q.axisY, source } : null;
  };

  const asked = Number.isFinite(wantGroup) && Number.isFinite(wantIndex)
    ? at(wantGroup, wantIndex, 'exact') : null;
  if (plausiblePortrait(asked)) return asked;

  const conventional = at(9000, 1, 'big');
  if (plausiblePortrait(conventional)) return conventional;

  // A TIE goes to the LOWER index, not to whichever the file lists first.
  // Colette keeps her own 100x100 face at 9000,0 and the Kung Fu Man face of
  // the template she was built from at 9000,10, listed first; "first in the
  // file" put Kung Fu Man on her tile. 9000,0 is the select portrait, the one
  // an author replaces.
  const larger = (a, b) => a.w * a.h > b.w * b.h || (a.w * a.h === b.w * b.h && a.index < b.index);
  let best = null, biggest = null;
  for (const k of sff.byKey.keys()) {
    const c = String(k).split(',');
    if (Number(c[0]) !== 9000) continue;
    const hit = at(9000, Number(c[1]), 'scan');
    if (!hit) continue;
    if (!biggest || larger(hit, biggest)) biggest = hit;
    if (!plausiblePortrait(hit)) continue;
    if (!best || larger(hit, best)) best = hit;
  }
  if (best) return best;

  // Nothing face-shaped anywhere. Rather than draw nothing, hand back whatever
  // was asked for and say so - a wrong-shaped portrait the caller can label
  // beats an empty cell it cannot explain.
  return asked || conventional || biggest || null;
}

// bestPortrait by character, which is what every caller actually has.
function bestPortraitFor(mountAs, group, index) {
  const rec = charSff(mountAs);
  if (!rec) return null;
  return bestPortrait(rec.sff, group, index);
}

// ---- THE PALETTES A CHARACTER OFFERS ---------------------------------------
//
// NOT every palette in the .sff. A file can hold hundreds - tomokaminato has
// 340, miyako 239 - because palettes are attached to individual sprites: body
// parts, effects, and in Tomoka's case the other characters inside her
// moveset. Sakura has forty and exactly ONE of them is selectable.
//
// The selectable ones are the palette-table entries keyed GROUP 1, which is the
// engine's convention (PalTable[{1, slot}]), plus whatever the .def declares as
// pal1..palN. Neither source alone is enough: cvsjill declares twelve .act
// files and carries one internal palette, while hibiki_se declares none at all
// and keeps twenty inside the .sff.
//
// Slot numbers are carried as DATA rather than as positions in this array, so
// renumbering or authoring palettes later does not mean rewriting this.
// ---- WHICH COLORS THE SPRITE ACTUALLY WEARS -------------------------------
//
// A palette has 256 entries and a sprite typically touches thirty of them. The
// other two hundred are whatever the author left behind, and they are free to
// differ wildly from palette to palette - so choosing swatches by "where do the
// palettes disagree most" reliably landed on entries that appear NOWHERE in the
// art. That is how a yellow-and-red character ended up with blue in her strip.
//
// So the sampler is told which indices the character actually draws with, and
// only those are eligible.
//
// PNG8 sprites (SFF format 10) keep their pixels inside a deflated PNG rather
// than as a flat index array, so those have to be inflated and unfiltered by
// hand. That is not an edge case here: cvsjill, sakura and chun_li_jj are all
// format 10, and skipping them would leave exactly the characters whose
// palettes live only inside the .sff without any usage data at all.
function pngIndices(bytes) {
  if (!bytes || bytes.length < 8) return null;
  const b = Buffer.isBuffer(bytes)
    ? bytes : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let o = 8, w = 0, h = 0, depth = 0, ctype = -1;
  const idat = [];
  while (o + 8 <= b.length) {
    const len = b.readUInt32BE(o);
    const type = b.toString('latin1', o + 4, o + 8);
    const data = b.subarray(o + 8, o + 8 + len);
    if (type === 'IHDR') {
      if (data.length < 13) return null;
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      depth = data[8]; ctype = data[9];
      if (data[12]) return null;            // interlaced; not worth unpicking
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') break;
    o += 12 + len;
  }
  if (ctype !== 3 || depth !== 8 || !w || !h) return null;
  if (w * h > 4096 * 4096) return null;
  let raw;
  try { raw = zlib.inflateSync(Buffer.concat(idat)); } catch (e) { return null; }
  // One filter byte per row, then w index bytes. An indexed image is one byte
  // per pixel, so Sub/Average/Paeth all predict from a distance of 1.
  const out = Buffer.alloc(w * h);
  let p = 0;
  for (let y = 0; y < h; y++) {
    if (p >= raw.length) break;
    const ft = raw[p++];
    const row = y * w, prev = row - w;
    for (let x = 0; x < w && p < raw.length; x++) {
      const v = raw[p++] | 0;
      const a = x > 0 ? out[row + x - 1] : 0;
      const up = y > 0 ? out[prev + x] : 0;
      const ul = (x > 0 && y > 0) ? out[prev + x - 1] : 0;
      let r;
      if (ft === 0) r = v;
      else if (ft === 1) r = v + a;
      else if (ft === 2) r = v + up;
      else if (ft === 3) r = v + ((a + up) >> 1);
      else {
        const est = a + up - ul;
        const da = Math.abs(est - a), du = Math.abs(est - up), dl = Math.abs(est - ul);
        r = v + ((da <= du && da <= dl) ? a : (du <= dl ? up : ul));
      }
      out[row + x] = r & 255;
    }
  }
  return out;
}

// A histogram of the palette indices ONE sprite draws with, or null when it
// cannot be read - a truecolor sprite has no indices at all, and a sprite that
// touches only a handful is too thin a sample to choose colors from.
function spriteIndexUsage(sff, group, index) {
  let d = null;
  try { d = sffDecode.decodeSprite(sff, group, index); } catch (e) { d = null; }
  if (!d) return null;
  let px = null;
  if (d.kind === 'indexed' && d.px) px = d.px;
  else if (d.kind === 'png' && d.bytes) px = pngIndices(d.bytes);
  if (!px || !px.length) return null;
  const use = new Uint32Array(256);
  for (let i = 0; i < px.length; i++) use[px[i] & 255]++;
  let lit = 0;
  for (let i = 1; i < 256; i++) if (use[i]) lit++;
  return lit >= 4 ? use : null;
}

// WHICH SPRITE TO READ THE USAGE OFF. It has to be one that actually wears the
// costume palette, or its index numbers mean something else entirely and the
// filter would be worse than no filter at all: 9000,1 is drawn on a private
// palette for every character in this roster, and on SFF v1 the portraits are
// too.
//
// So: the icon if it follows, otherwise the first few fight sprites in file
// order, which in a MUGEN .sff is the standing animation. They are unioned
// rather than taken one at a time, because a single idle frame does not show a
// character's whole costume. Memoized on the SFF cache record, so the panel
// pays for this once per character rather than once per request.
function costumeIndexUsage(rec) {
  if (!rec || !rec.sff || !rec.sff.byKey) return null;
  if (rec._use !== undefined) return rec._use;
  const sff = rec.sff;

  const total = new Uint32Array(256);
  let got = 0;
  const take = (g, i) => {
    if (!spriteFollowsPalette(rec, g, i)) return;
    const u = spriteIndexUsage(sff, g, i);
    if (!u) return;
    for (let k = 0; k < 256; k++) total[k] += u[k];
    got++;
  };

  take(9000, 0);
  take(9000, 1);

  // AND FIGHT SPRITES, ALWAYS - not only when the icon fails. A select icon and
  // the fight art can share one palette while occupying different index ranges;
  // gardevoir does exactly that, and reading her icon alone picked greens that
  // appear in none of her fight sprites.
  //
  // Chosen by GROUP, never in file order. Her .sff opens with sprites 15910,
  // 8000, 18300 and 17230 - hit sparks and effects, none of which wear the
  // costume palette - so a "first N sprites in the file" scan ran out of
  // attempts before reaching a single frame of the character. Low group numbers
  // are the standing and walking animations by MUGEN convention, which is what
  // a costume swatch should be read off.
  const costume = [];
  for (const k of sff.byKey.keys()) {
    const c = String(k).split(',');
    const g = Number(c[0]), i = Number(c[1]);
    if (g === 9000 || !Number.isFinite(g) || !Number.isFinite(i)) continue;
    if (!spriteFollowsPalette(rec, g, i)) continue;   // no decode, just a lookup
    costume.push([g, i]);
  }
  costume.sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
  let fight = 0;
  for (const [g, i] of costume) {
    if (fight >= 4) break;
    const before = got;
    take(g, i);
    if (got > before) fight++;
  }

  rec._use = got ? total : null;
  return rec._use;
}

// A SWATCH HAS TO DISTINGUISH ONE PALETTE FROM ANOTHER.
//
// Two earlier attempts failed for instructive reasons. Sampling evenly-spaced
// indices landed on the same filler entries in every palette, so every strip
// looked alike. Picking the most saturated colors found pure #00ff00 in almost
// every palette - a conventional marker for an UNUSED slot, not a costume
// color - so the strips filled with neon green that appears nowhere in the art.
//
// The honest signal is where the character's OWN palettes disagree. Structure
// they all share - the whites, the outline blacks, the unused filler - has zero
// variance across the set and drops out automatically; what is left is exactly
// the colors that make pal3 look different from pal4. Which is the question a
// swatch exists to answer.
function swatchIndices(pals, use) {
  const usable = pals.filter((p) => p && p.length >= 768);
  if (usable.length < 2) return null;

  // A COSTUME COLOR COVERS AREA. Being used at all is not enough: four pixels
  // of piping vary exactly as much as a whole jacket does, and picking them put
  // a yellow swatch on a character who is pink and skin tone head to foot. So
  // an index has to be at least this share of everything the character draws.
  // Relaxed to zero further down if too little survives, because a character
  // built out of tiny color blocks should get a strip rather than nothing.
  let drawn = 0;
  if (use) for (let i = 1; i < 256; i++) drawn += use[i];
  const scoreWith = (floor) => {
  const score = [];
  for (let i = 1; i < 256; i++) {
    if (use && use[i] <= floor) continue;     // never worn, or worn as a speck
    let mn = [255, 255, 255], mx = [0, 0, 0], lit = false;
    for (const p of usable) {
      for (let c = 0; c < 3; c++) {
        const v = p[i * 3 + c] | 0;
        if (v < mn[c]) mn[c] = v;
        if (v > mx[c]) mx[c] = v;
      }
      if (p[i * 3] + p[i * 3 + 1] + p[i * 3 + 2] > 40) lit = true;
    }
    if (!lit) continue;                       // an index that is black everywhere
    // Weighted by coverage, so a color that is most of the costume outranks one
    // that is four pixels of piping. Both vary; only one of them is the
    // character. Logarithmic, because raw pixel counts would let one large flat
    // area beat every accent color outright.
    const spread = (mx[0] - mn[0]) + (mx[1] - mn[1]) + (mx[2] - mn[2]);
    score.push([i, use ? spread * Math.log(1 + use[i]) : spread]);
  }
  score.sort((a, b) => b[1] - a[1]);
  return score.filter((x) => x[1] > 0);
  };

  // One percent of everything the character draws. Below that a color is
  // trim, not a color the character reads as, and putting it in the strip is
  // what made a pink-and-skin palette advertise yellow.
  let ranked = scoreWith(drawn * 0.01);
  if (ranked.length < 3) ranked = scoreWith(0);

  // TAKING THE TOP SIX OUTRIGHT GIVES SIX SHADES OF ONE COLOR. High-variance
  // indices arrive in runs, because a costume color is stored as a ramp and
  // every step of that ramp varies together - cvsjill's top six were 245..250,
  // one blue gradient, and the strip said nothing except "blue".
  //
  // So accept a candidate only if it is far enough from the ones already taken.
  // Distance is measured on the MEAN color across the character's palettes,
  // since the strip has to stay legible in all of them, not just in pal1.
  const mean = (i) => {
    let r = 0, g = 0, b = 0;
    for (const p of usable) { r += p[i * 3]; g += p[i * 3 + 1]; b += p[i * 3 + 2]; }
    return [r / usable.length, g / usable.length, b / usable.length];
  };
  const d2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
  // Separation is judged on the mean so the strip stays comparable between
  // palettes, but two indices can share a color in pal1 and differ elsewhere -
  // which showed as the same swatch twice on the row people look at most. So
  // the first palette gets a veto of its own.
  const one = usable[0];
  const at1 = (i) => [one[i * 3], one[i * 3 + 1], one[i * 3 + 2]];
  const out = [], reps = [], reps1 = [];
  // Two passes: a wide separation first, then whatever is left to fill the
  // strip. A character with genuinely few distinct colors gets a short strip
  // rather than a padded one.
  for (const gate of [70 * 70, 26 * 26, 0]) {
    for (const [i] of ranked) {
      if (out.length >= 6) break;
      if (out.includes(i)) continue;
      const m = mean(i), m1 = at1(i);
      if (gate && reps.some((r) => d2(r, m) < gate)) continue;
      if (gate && reps1.some((r) => d2(r, m1) < 24 * 24)) continue;
      out.push(i); reps.push(m); reps1.push(m1);
    }
    if (out.length >= 6) break;
  }
  return out.length ? out.sort((a, b) => a - b) : null;
}

// One palette on its own has nothing to differ FROM, so fall back to spreading
// across its own colors - skipping black, white and the flat grays that carry
// no costume information.
function palSwatchSolo(pal, use) {
  if (!pal) return [];
  const collect = (needSat) => {
    const c = [];
    for (let i = 1; i < 256; i++) {
      if (use && !use[i]) continue;           // a color the character never wears
      const r = pal[i * 3] | 0, g = pal[i * 3 + 1] | 0, b = pal[i * 3 + 2] | 0;
      if (r + g + b < 40 || r + g + b > 720) continue;
      if (needSat && Math.max(r, g, b) - Math.min(r, g, b) < 28) continue;
      c.push([r, g, b]);
    }
    return c;
  };
  // Colorful entries first, but a genuinely gray costume must not come back
  // with an empty strip - so drop the saturation test rather than the strip.
  let cand = collect(true);
  if (cand.length < 3) cand = collect(false);
  if (!cand.length) return [];
  const dist = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
  const picked = [cand[0]];
  while (picked.length < 6 && picked.length < cand.length) {
    let best = null, bestD = -1;
    for (const c of cand) {
      let d = Infinity;
      for (const p of picked) d = Math.min(d, dist(c, p));
      if (d > bestD) { bestD = d; best = c; }
    }
    if (!best || bestD <= 0) break;
    picked.push(best);
  }
  return picked.map((c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join(''));
}

function palSwatchAt(pal, idx) {
  if (!pal || !idx) return [];
  return idx.map((i) => '#' + [pal[i * 3], pal[i * 3 + 1], pal[i * 3 + 2]]
    .map((v) => (v | 0).toString(16).padStart(2, '0')).join(''));
}

// A DECLARED PALETTE PATH IS A HINT, NOT A PATH. .def files carry Windows
// separators and arbitrary case, and dr_kira declares its twelfth palette as
// "CustomPalettes(sep)redo_1-12" with NO EXTENSION AT ALL. So: normalize the
// separators, then try the literal name, then that name with .act and with
// .png, each matched case-insensitively against the real directory. What the
// file actually IS is then decided by sniffing its bytes in readAct, never by
// its name.
function resolvePalFile(dir, rel) {
  const sub = path.dirname(rel);
  const base = sub && sub !== '.' ? path.join(dir, sub) : dir;
  let names = null;
  try { names = fs.readdirSync(base); } catch (e) { return null; }
  const want = path.basename(rel).toLowerCase();
  for (const cand of [want, want + '.act', want + '.png']) {
    const hit = names.find((f) => f.toLowerCase() === cand);
    if (hit) return path.join(base, hit);
  }
  return null;
}

// ---- ONE ANSWER PER STAMP (2026-10-19) --------------------------------------
// With nothing picked, a sprite that follows the palette is drawn in the
// shipped pal1, which needs this answer - and the Studio names that slot in its
// sprite URLs - so every such sprite request used to read every .act, the
// roster twice, the swatches and a SHA1 per slot: Ken-Zero3 (12 .act) 9.7 ms
// a sprite over HTTP against 2.5 ms before. The answer is kept per character
// and handed back while nothing it was read from has changed: the sprite file
// (charSff's own key, the same rec object), the .def, roster.json (the order
// and the Studio's own palettes), each palette file the answer names and the
// folders they are looked up in (a file added, removed or renamed changes its
// folder's stamp). Not while a build is assembling a match view (vfslib
// rosterInView): that roster is not the file's. charPalettes hands out a copy;
// charPalettesShared is the kept object, for readers that change nothing.
const CHAR_PAL_CACHE = new Map();
const CHAR_PAL_MAX = 64;
const statStamp = (p) => { try { const st = fs.statSync(p); return st.size + '@' + st.mtimeMs; } catch (e) { return '-'; } };
function charPalettesDeps(rec, value) {
  const deps = [path.join(rec.dir, rec.defName), layout.dir('roster.json')];
  for (const p of value.palettes) {
    if (p.source === 'act' || p.source === 'png') {
      const rel = String(p.file || '').replace(/\\/g, '/');
      const sub = path.dirname(rel);
      deps.push(sub && sub !== '.' ? path.join(rec.dir, sub) : rec.dir);
      const abs = resolvePalFile(rec.dir, rel);
      if (abs) deps.push(abs);
    } else if (p.source === 'studio' && p.file) {
      deps.push(path.join(layout.dir('palettes'), p.file));
    }
  }
  return [...new Set(deps)].map((p) => ({ p, s: statStamp(p) }));
}
function charPalettesEntry(mountAs) {
  const rec = charSff(mountAs);
  if (!rec) return null;
  const k = String(mountAs).toLowerCase();
  let inView = false;
  try { inView = !!require('./vfslib').rosterInView(); } catch (e) { inView = false; }
  const hit = inView ? null : CHAR_PAL_CACHE.get(k);
  if (hit && hit.rec === rec && hit.deps.every((d) => statStamp(d.p) === d.s)) return hit;
  const value = charPalettesRead(mountAs);
  if (!value) return null;
  let deps = null;
  try { deps = charPalettesDeps(rec, value); } catch (e) { deps = null; }
  const entry = { rec, value, deps: deps || [], bytes: new Map() };
  if (inView || !deps) return entry;             // not kept: nothing to check it against
  CHAR_PAL_CACHE.delete(k);
  CHAR_PAL_CACHE.set(k, entry);
  while (CHAR_PAL_CACHE.size > CHAR_PAL_MAX) CHAR_PAL_CACHE.delete(CHAR_PAL_CACHE.keys().next().value);
  return entry;
}
function charPalettesShared(mountAs) {
  const e = charPalettesEntry(mountAs);
  return e ? e.value : null;
}
// Whether the roster gives this character a palette order: the one roster
// fact an SFF v2 sprite request needs, kept per stamp of roster.json instead
// of a whole roster read per sprite.
let ROSTER_ORDER_MEMO = null;      // { stamp, has: Set(lowercased mountAs) }
function rosterHasPaletteOrder(mountAs) {
  const k = String(mountAs).toLowerCase();
  let inView = false;
  try { inView = !!require('./vfslib').rosterInView(); } catch (e) { inView = false; }
  const stamp = statStamp(layout.dir('roster.json'));
  if (inView || !ROSTER_ORDER_MEMO || ROSTER_ORDER_MEMO.stamp !== stamp) {
    const r = readRoster();
    const has = new Set((r.chars || []).filter((c) => Array.isArray(c.paletteOrder) && c.paletteOrder.length)
      .map((c) => String(c.mountAs).toLowerCase()));
    if (inView) return has.has(k);
    ROSTER_ORDER_MEMO = { stamp, has };
  }
  return ROSTER_ORDER_MEMO.has.has(k);
}
function charPalettes(mountAs) {
  const v = charPalettesShared(mountAs);
  return v ? structuredClone(v) : null;
}

function charPalettesRead(mountAs) {
  const rec = charSff(mountAs);
  if (!rec) return null;
  const { dir, def, sff } = rec;
  const palettes = [];
  const declared = def.pals || {};
  const seen = new Set();

  // 1. Inside an SFF v2 file, but ONLY the entries keyed group 1. Everything
  //    else in that table belongs to a sprite, not to a costume.
  //    THESE COME FIRST. The engine the website runs draws a v2 character with
  //    the sprite file's own (1, N) and lets a def's palN file fill only a slot
  //    the file does not key (GRAIL 3.3): the sprites are indexed against the
  //    file's palettes, and a def's copy can have drifted. WrestlerX names
  //    pal1-6 = act/inma.act, which is her blue effect palette, not a costume -
  //    with the def first, picking her pal1 here painted her blue while the
  //    game draws her red. The def's file stays on the row as `declared`, so the
  //    panel can say it is not used.
  if (sff.version === 2 && sff.palNum) {
    for (let i = 0; i < sff.palNum; i++) {
      const o = sff.palOfs + i * 16;
      if (o + 16 > sff.buf.length) break;
      const g = sff.buf.readUInt16LE(o);
      if (g !== 1) continue;
      const slot = sff.buf.readUInt16LE(o + 2);
      if (seen.has(slot)) continue;      // a repeated key is an alias of the first
      seen.add(slot);
      let pal = null;
      try { pal = sffDecode.v2PaletteAt(sff, i); } catch (e) { pal = null; }
      const named = String(declared[slot] || '').trim();
      palettes.push({
        slot, label: 'SFF palette ' + slot, source: 'sff',
        palIdx: i, missing: !pal, colors: [], _rgb: pal,
        ...(named ? { declared: named.replace(/\\/g, '/') } : {}),
      });
    }
  }

  // 2. Declared in the .def. These are real files on disk and may be .act OR
  //    .png - dr_kira declares eight PNGs, with backslash paths. On SFF v1 they
  //    are every costume there is; on v2 only the slots step 1 left open.
  for (const slot of Object.keys(declared)) {
    const raw = String(declared[slot] || '').trim();
    if (!raw) continue;
    if (seen.has(Number(slot))) continue;      // the sprite file keeps its own
    seen.add(Number(slot));
    const rel = raw.replace(/\\/g, '/');
    const file = resolvePalFile(dir, rel);
    let pal = null;
    if (file) { try { pal = sffDecode.readAct(file); } catch (e) { pal = null; } }
    palettes.push({
      slot: Number(slot),
      label: path.basename(rel),
      source: /\.png$/i.test(rel) ? 'png' : 'act',
      file: rel,
      missing: !pal,
      colors: [],
      _rgb: pal,
    });
  }

  // 3. Added in the Studio. Not in the character's files at all - they exist in
  //    the bundle and in the builds - but they are slots like any other.
  try {
    const rc = rosterCharOf(readRoster(), mountAs);
    for (const cpal of (rc && rc.customPalettes) || []) {
      if (seen.has(cpal.slot)) continue;
      seen.add(cpal.slot);
      const pal = custompal.load(layout.dir('palettes'), cpal.file);
      palettes.push({ slot: cpal.slot, label: cpal.name || ('color ' + cpal.slot), source: 'studio', file: cpal.file,
        base: cpal.base, ops: cpal.ops || null, missing: !pal, colors: [], _rgb: pal });
    }
  } catch (e) { /* no roster: nothing was added */ }

  // WHICH ONE IS "THE DEFAULT" IS NOT KNOWABLE FROM THE .def, so this no longer
  // guesses. Two rules were tried and both are wrong in the field:
  //
  //   pal.defaults[0]  -  makoto declares `pal.defaults = 6,3,4,2`
  //   pal.keymap[1]    -  which is pal1 for every character on this roster
  //
  // and the color makoto actually wears is pal4: `pal4 = makoto.act`, the
  // unnumbered file, the author's canonical costume. cvs_makoto keeps that same
  // costume at pal1 with `pal.defaults = 1,2,...`, so the two Makotos wear one
  // color from two different slots and no single rule labels both correctly.
  //
  // The engine agrees that it is not a property of the character: a human gets
  // whatever palette the BUTTON they pressed maps to (start.lua:516), and
  // pal.defaults is read only for AI and no-input selection (start.lua:608).
  // So `defaults` is returned as the raw list it is and the UI states it as
  // such. Order is by SLOT, which is at least an order a player can predict.
  const order = (def.palDefaults || []).map(Number).filter((n) => Number.isFinite(n));
  palettes.sort((a, b) => a.slot - b.slot);
  // THE USER'S ORDER (palorder.js). `slot` stays the number in the character's
  // files - every sprite request and every pick names that - and `pos` is the
  // number the build ships it under, which is what the panel shows.
  let reordered = false;
  try {
    const rc = rosterCharOf(readRoster(), mountAs);
    const want = rc && rc.paletteOrder;
    if (want && want.length) {
      const map = require('./palorder.js').mapping(want, palettes.map((p) => p.slot));
      for (const p of palettes) p.pos = map.get(p.slot);
      palettes.sort((a, b) => a.pos - b.pos);
      reordered = [...map].some(([a, b]) => a !== b);
    }
  } catch (e) { /* no roster */ }

  // TWELVE SLOTS IS NOT TWELVE COLORS. donghwan maps its twelve onto four
  // distinct .act files, and its own SFF agrees: nine of its twelve group-1
  // nodes are zero-length links back to the other three. Hashing the resolved
  // bytes is the honest test, and it lets the panel say "same as pal1" rather
  // than showing four colors twelve times and looking broken.
  // Now that every palette is resolved, pick the indices where they disagree
  // and read all the strips off the same ones - so the swatches are directly
  // comparable rather than each being a different sample of a different table.
  // Restricted to colors the character is actually drawn in. Without that, the
  // highest-variance indices are unused table entries and the strips advertise
  // colors that appear nowhere on the sprite.
  const use = costumeIndexUsage(rec);
  const idx = swatchIndices(palettes.map((p) => p._rgb), use);
  for (const p of palettes) {
    p.colors = idx ? palSwatchAt(p._rgb, idx) : palSwatchSolo(p._rgb, use);
  }

  const firstByHash = new Map();
  for (const p of palettes) {
    if (!p._rgb) continue;
    const h = crypto.createHash('sha1').update(Buffer.from(p._rgb)).digest('hex');
    if (firstByHash.has(h)) p.same = firstByHash.get(h);
    else firstByHash.set(h, p.slot);
  }
  for (const p of palettes) delete p._rgb;

  // WHICH SPRITES WILL ACTUALLY CHANGE. The UI needs this to avoid promising a
  // recolor it cannot deliver, and to explain why a big portrait sits still
  // while the icon changes.
  const follows = {};
  for (const key of ['9000,0', '9000,1']) {
    const gi = key.split(',');
    follows[key] = spriteFollowsPalette(rec, Number(gi[0]), Number(gi[1]));
  }

  // WHAT THE PREVIEW WEARS WITH NOTHING PICKED (previewPalette): pal1 as the
  // build ships it. `shown` is that slot, for the panel to mark its row;
  // `implicit` says the sprites are painted with it (every SFF v1, an SFF v2
  // whose order moves another slot to pal1) rather than wearing the file's
  // own palettes, which an SFF v2 with slot 1 still first already shows.
  const pv = previewPalette({ sffVersion: sff.version, reordered, palettes });

  return {
    sffVersion: sff.version,
    shown: pv.slot, implicit: pv.implicit,
    defaults: order, reordered,
    totalSffPalettes: sff.palNum || 0,
    distinct: firstByHash.size,
    // WHICH palette entries the strips are read off, so the choice can be
    // checked against the sprite instead of taken on trust.
    swatchAt: idx || null,
    follows,
    palettes,
  };
}

// ---- CAN THIS SPRITE ACTUALLY WEAR A COSTUME PALETTE? ----------------------
//
// Not every sprite follows the palette you pick, and forcing one that does not
// produces garbage rather than a recolor - which is exactly what the decoder's
// group-9000 rule was protecting against before an explicit override was added.
//
// The test is precise, not a guess. A character's selectable palettes are the
// palette-table entries keyed group 1. A sprite follows them if, and only if,
// its own palIdx is one of those entries. Measured across this roster:
//
//   character    9000,0 (icon)          9000,1 (big portrait)
//   hibiki_se    palIdx 0   -> follows  palIdx 43  -> its own
//   sakura       palIdx 0   -> follows  palIdx 27  -> its own
//   chun_li_jj   palIdx 0   -> follows  palIdx 60  -> its own
//   cvsjill      palIdx 108 -> its own  palIdx 109 -> its own
//
// which is why small icons recolor correctly and big portraits fell apart: the
// select portrait is drawn on a private palette in every character here.
//
// SFF v1 answers false for group 9000 outright. That is the engine's own
// behavior - image.go draws portraits through the preload path with the
// sprite's embedded palette and never applies the .act - and the comment in
// sffdec-core.js records what ignoring it did to RyuDX.
// SFF v1 keeps ONE PHYSICAL PALETTE PER CHAIN. A sprite with samePal=1 inherits
// the previous sprite's palette entry; samePal=0 mints a new one. Sprites that
// share an entry recolor together and sprites on other entries cannot - which
// is why a palette preview was corrupting projectiles, hit sparks and custom
// win-pose art while the body recolored correctly. Those are not the character;
// they are borrowed art carrying its own colors, and the engine leaves them
// alone.
//
// So: find the entry the character's OWN art sits on, which is the one its
// stance (group 0) uses, and let only that entry follow. Anchoring on the stance
// rather than on physical index 0 matters - cvsmika_h ships ten portraits with
// private palettes before her first body sprite, so her costume is entry 10.
//
// (GRAIL 4.8 records that the engine remaps physical index 0 specifically -
// char.go:4363-4380, palList.Remap(0, targetIdx). If that is exact then a
// character whose body is not on entry 0 does not recolor in game AT ALL,
// which is a bigger claim than this preview should make on its own. It needs an
// in-game check. Either way, sprites on OTHER entries never follow, which is
// the corruption being fixed here.)
function v1CostumePal(rec) {
  const sff = rec.sff;
  if (sff._v1pal !== undefined) return sff._v1pal;
  let best = null;
  for (const k of sff.byKey.keys()) {
    const c = String(k).split(',');
    if (Number(c[0]) !== 0) continue;             // group 0 is the stance
    const i = Number(c[1]);
    if (best && i >= best.index) continue;
    const s = sff.byKey.get(k);
    if (s && s.palIdx !== undefined) best = { index: i, pal: s.palIdx };
  }
  sff._v1pal = best ? best.pal : 0;
  return sff._v1pal;
}

function spriteFollowsPalette(rec, group, index) {
  if (!rec || !rec.sff) return false;
  const sff = rec.sff;
  if (sff.version !== 2) {
    // Portraits are drawn through the preload path on their own embedded
    // palette; that rule predates this one and still holds.
    if (group === 9000) return false;
    const s1 = sff.byKey && sff.byKey.get(group + ',' + index);
    if (!s1 || s1.palIdx === undefined || s1.palIdx === null) return false;
    return s1.palIdx === v1CostumePal(rec);
  }
  const spr = sff.byKey && sff.byKey.get(group + ',' + index);
  if (!spr || spr.palIdx === undefined || spr.palIdx === null) return false;
  if (!sff.palNum) return false;
  for (let i = 0; i < sff.palNum; i++) {
    const o = sff.palOfs + i * 16;
    if (o + 16 > sff.buf.length) break;
    if (sff.buf.readUInt16LE(o) !== 1) continue;      // not a selectable palette
    if (i === spr.palIdx) return true;
  }
  return false;
}

// ---- THE PREVIEW WEARS PAL1 AS THE BUILD SHIPS IT (2026-10-19) -------------
//
// With no palette picked, a sprite that follows the costume palette is drawn
// in the palette the build ships as pal1: the slot at position 1 under the
// roster's paletteOrder (palorder.js mapping, the `pos` charPalettes reports),
// else slot 1. It is an IMPLICIT PICK of that slot, through the same path an
// explicit pick takes (paletteWithAlpha), so the default preview and a click
// on that row are the same bytes.
//
// This replaced "the .act with the lowest number in its file name" (DEVLOG
// 2026-08-26, made for the leaderboard art extractor - which draws through
// spritePngFor, so it wears this slot too, as does a portrait the fitter bakes
// from a body sprite, portraitfit.defaultAct). That
// rule misfired on `name.act / name2.act` (Marvin, Popeye, Gouken wore pal2),
// on reversed numbering (Ken04.act is Ken's pal1, Ken01.act his pal5) and on
// CvS rips (act004.act at pal1, act001.act at pal4): 52 of 144 SFF v1
// characters of one build and 9 of 14 in another did not wear pal1. The owner
// chose pal1 as the build ships it, after his own order.
//
// A SLOT WITH NOTHING READABLE IS SKIPPED, never painted: pal1's .act missing
// from the folder falls to the next slot in shipped order that has a palette,
// and with none at all the sprite keeps its own colors - an implicit pick never
// becomes color noise.
//
// `info` is the charPalettes shape (palettes already in shipped order).
// implicit = the sprites are painted with that slot. Always on SFF v1, whose
// sprites carry no costume colors of their own. On SFF v2 only when the order
// moves ANOTHER slot to pal1: with slot 1 first the file's own (1,1) is pal1,
// which is what its sprites already wear, so an SFF v2 with no order draws
// byte for byte as before (and a sprite on another group-1 node keeps it).
function previewPalette(info) {
  const out = { slot: null, implicit: false };
  if (!info || !Array.isArray(info.palettes) || !info.palettes.length) return out;
  const p = info.palettes.find((x) => !x.missing);
  if (!p) return out;
  out.slot = p.slot;
  out.implicit = info.sffVersion === 2 ? !!info.reordered && p.slot !== 1 : true;
  return out;
}

// The palette bytes for one slot, however that slot is provided. Returns a
// 768-byte RGB table or null.
function paletteBytes(mountAs, slot) {
  const r = paletteWithAlpha(mountAs, slot);
  return r ? r.pal : null;
}
// The same, with the slot's ALPHA: { pal, alpha } where alpha is a
// Uint8Array(256) only for a slot that is one of the file's own SFF v2.01
// palette nodes - the one palette kind that stores an alpha per color
// (image.go:2269). The engine's color pick (remapPal) swaps the whole palette
// texture, alpha included, so a pick of such a slot draws with it; .act, PNG
// and Studio custom palettes load as index 0 = 0 and the rest 255
// (image.go:649-652, 713-716), which is alpha = null.
// `info`: a charPalettes answer the caller already has. Without one, the kept
// answer (charPalettesEntry) is used and the slot's bytes are kept with it, so
// a sprite request does not re-read the .act; the caller gets its own copy.
const copyPal = (a) => (!a ? a : Buffer.isBuffer(a) ? Buffer.from(a) : ArrayBuffer.isView(a) ? new a.constructor(a) : Array.isArray(a) ? a.slice() : a);
function paletteWithAlpha(mountAs, slot, info, entry) {
  if (!info && !entry) entry = charPalettesEntry(mountAs);
  if (!info) info = entry && entry.value;
  if (!info) return null;
  const key = Number(slot);
  let r;
  if (entry && entry.bytes.has(key)) r = entry.bytes.get(key);
  else {
    r = paletteRead(mountAs, key, info);
    if (entry) entry.bytes.set(key, r);
  }
  return r ? { pal: copyPal(r.pal), alpha: copyPal(r.alpha) } : null;
}
function paletteRead(mountAs, slot, info) {
  const p = info.palettes.find((x) => x.slot === Number(slot));
  if (!p) return null;
  const rec = charSff(mountAs);
  if (!rec) return null;
  if (p.source === 'sff') {
    try {
      const pal = sffDecode.v2PaletteAt(rec.sff, p.palIdx);
      return pal ? { pal, alpha: rec.sff.palAlpha ? sffCore.v2PaletteAlphaAt(rec.sff, p.palIdx) : null } : null;
    } catch (e) { return null; }
  }
  if (p.source === 'studio') {
    const pal = custompal.load(layout.dir('palettes'), p.file);
    return pal ? { pal, alpha: null } : null;
  }
  const rel = String(p.file || '').replace(/\\/g, '/');
  const file = resolvePalFile(rec.dir, rel);
  if (!file) return null;
  try { const pal = sffDecode.readAct(file); return pal ? { pal, alpha: null } : null; } catch (e) { return null; }
}

// raw: the character's own file as it is (the fitter measures that); otherwise
// the sprite as a build ships it - fitted, and a cell portrait's axis re-anchored.
function spriteGeomFor(mountAs, group, index, raw) {
  const fitted = raw ? null : fittedPortrait(mountAs, group, index);
  if (fitted) return shippedCellGeomFor(mountAs, group, index, { w: fitted.w, h: fitted.h, axisX: fitted.axisX, axisY: fitted.axisY, fitted: true });
  const rec = charSff(mountAs);
  if (!rec) return null;
  const g = sffDecode.spriteGeom(rec.sff, group, index);
  if (!g) return null;
  const out = { w: g.w, h: g.h, axisX: g.axisX, axisY: g.axisY };
  return raw ? out : shippedCellGeomFor(mountAs, group, index, out);
}

// THE MOTIF'S OWN system.def, as text. The grid's shape lives in the
// SCREENPACK, not in the roster, so editing it means editing that file - and
// Revert has to be able to put the whole thing back, which is why this hands
// over the bytes rather than a parsed object.
//
// `motif` names ANOTHER pack than the roster's (a vpath, '' for the default):
// E-Select's Revert puts back every pack it saw this session, including ones
// the build has since switched away from. `rel` is the key both answers share
// with /api/motif-select's `motif` - the vpath without data/, the default
// spelled out - so an unset motif and data/ikemen1/system.def, which are one
// file, are one key.
function motifDefText(motif) {
  const roster = readRoster();
  const m = motif === undefined ? roster.motif : (motif || undefined);
  const defPath = motifDefPath({ motif: m });
  if (!defPath) return null;
  try {
    return {
      motif: m, rel: String(m || 'data/ikemen1/system.def').replace(/^data\//, ''),
      text: fs.readFileSync(defPath, 'latin1'),
    };
  } catch (e) { return null; }
}

// A one-time .orig beside the screenpack, the same convention the palette tools
// use - and walkDir already refuses to pack a .orig, so it cannot reach a
// build. Insurance for a file the editor is now allowed to rewrite.
function keepMotifBackup(defPath) {
  try {
    if (!fs.existsSync(defPath + '.orig')) fs.copyFileSync(defPath, defPath + '.orig');
  } catch (e) { /* a read-only screenpack is still editable in memory */ }
}

// Write the file back verbatim. Used by Revert, so it must not reformat or
// normalize anything: whatever was captured is what goes back.
// `motif`, when given, names the pack as motifDefText's does.
function writeMotifDefText(text, motif) {
  const defPath = motif === undefined ? motifDefPath() : motifDefPath({ motif: motif || undefined });
  if (!defPath) return false;
  keepMotifBackup(defPath);
  fs.writeFileSync(defPath, String(text), 'latin1');
  return true;
}

// WHERE THE FIRST [Select Info] STARTS AND ENDS.
//
// Only the first matters: the engine reads the first section of a given name
// and ignores later ones (common.go ini rules), so editing a second would be
// editing a file the game does not read. Returns the header's line and the line
// the NEXT section starts on, which is the end of this one.
// ---- DOES THIS CHARACTER'S .def POINT AT FILES THAT EXIST? -----------------
//
// One character that cannot be preloaded takes down the WHOLE build: the engine
// panics at system.go:5459 ("failed to preload %v: %v") rather than skipping the
// slot, and the player gets a dialog instead of a game. Nothing checked this
// before export - addCharacter only verified that SOME .def with a [Files]
// section containing cmd= exists.
//
// THE INTERESTING FAILURE IS NOT "the file is missing". It is that the file is
// RIGHT THERE and the engine asks for it under a different name, because the
// .def was written in one encoding and read in another.
//
// The engine's rule is common.go:471 decodeShiftJIS(): if the raw bytes are
// valid UTF-8, use them as-is; OTHERWISE decode them as Shift-JIS. That is a
// sound default for MUGEN, whose authoring scene is largely Japanese - and it
// silently mangles anything written in CP1252. Measured on a real character
// (winmugen-hi/kakarotto trans ssj8, "Big Bird"):
//
//     raw bytes        anima E7 ao0        (E7 is 'c-cedilla' in CP1252)
//     as CP1252        animacao0           <- the folder that is actually there
//     valid UTF-8?     no (E7 needs two continuation bytes)
//     as Shift-JIS     anima<CJK>o0        <- what the engine looks for, with
//                                             the following 'a' swallowed into
//                                             one two-byte CJK character
//
// So this resolver models the ENGINE's decode, not just "does something match":
// a reference that resolves for us but not for the engine is exactly the bug,
// and it is reported with the name the engine will actually use.
//
// Severity comes from where the engine gives up:
//   boot     - sprite/anim. preloadCharAssets (system.go:4960) loads these two
//              at select-screen build time and its error becomes the panic.
//   match    - cmd/cns/st*/stcommon. Read when the character enters a match.
//   degraded - sound/movelist/pal*. Missing means silence or fewer palettes.
const CHAR_FILE_SEVERITY = {
  sprite: 'boot', anim: 'boot',
  cmd: 'match', cns: 'match', stcommon: 'match',
  sound: 'degraded', movelist: 'degraded',
};
function charFileSeverity(key) {
  const k = String(key || '').toLowerCase();
  if (CHAR_FILE_SEVERITY[k]) return CHAR_FILE_SEVERITY[k];
  if (/^st\d*$/.test(k)) return 'match';
  if (/^pal\d+$/.test(k)) return 'degraded';
  return null;                       // not a file reference we know about
}

// latin1 is a byte-transparent carrier: every byte 0-255 maps to the codepoint
// of the same value and back. So the .def is read as latin1 and each VALUE is
// turned back into the exact original bytes before any decoding is attempted.
function decodeCandidates(raw) {
  const buf = Buffer.from(raw, 'latin1');
  const out = new Map();                      // label -> string
  out.set('cp1252', buf.toString('latin1'));
  const asUtf8 = buf.toString('utf8');
  if (!asUtf8.includes('�')) out.set('utf8', asUtf8);
  try {
    out.set('shiftjis', new TextDecoder('shift_jis', { fatal: false }).decode(buf));
  } catch (e) { /* no ICU build; the other two still work */ }
  return out;
}

// What the ENGINE will look for, per common.go:471.
function engineDecode(raw) {
  const buf = Buffer.from(raw, 'latin1');
  // Go's utf8.Valid, reproduced: a round trip through utf8 is lossless exactly
  // when the bytes were valid UTF-8 to begin with.
  if (Buffer.compare(Buffer.from(buf.toString('utf8'), 'utf8'), buf) === 0) {
    return buf.toString('utf8');
  }
  try { return new TextDecoder('shift_jis', { fatal: false }).decode(buf); }
  catch (e) { return buf.toString('latin1'); }
}

// Every file under dir, as lowercased-relative -> real-relative. Bounded, because
// a character folder is not somewhere to walk without a limit.
function listCharFiles(dir, depth = 4) {
  const out = new Map();
  const walk = (rel, left) => {
    let ents;
    try { ents = fs.readdirSync(path.join(dir, rel), { withFileTypes: true }); }
    catch (e) { return; }
    for (const e of ents) {
      const r = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) { if (left > 0) walk(r, left - 1); continue; }
      out.set(r.toLowerCase(), r);
    }
  };
  walk('', depth);
  return out;
}

function normRef(v) {
  // A trailing ';' is a COMMENT, not part of the path - and MUGEN .defs are full
  // of Shift-JIS comments, which is what made a first pass at this count 69
  // "bad paths" that were 67 comments.
  let s = String(v == null ? '' : v).split(';')[0].trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim();
  }
  return s.replace(/\\/g, '/').replace(/^\.\//, '');
}

// FILES THE ENGINE ITSELF PROVIDES.
//
// A reference is not resolved against the character folder alone: the engine
// searches [def, "", motif.Def, "data/"] (compiler.go:8355-8362), so a shared
// file lands from data/. This matters enormously for the false-positive rate -
// 19 of 25 working characters on this install declare `stcommon = common1.cns`,
// which is a MUGEN file Ikemen does not ship under that name. It resolves to the
// engine's own data/common1.cns.zss, which is why those builds work and why a
// validator that only looks in the character folder calls every one of them
// broken.
//
// The .zss alias is real and already documented at modlib.js's SFF v1 palette
// notes: a `.cns` reference finds the engine's `.cns.zss`.
//
// WHERE THOSE data/ FOLDERS ARE is layout.js's answer, never a path beside the
// program. They used to be read as release-v2/data and release/data next to
// this file, which is where a checkout keeps them - but a portable copy keeps
// them in app\Dependencies\, so there the set came back EMPTY and the untouched
// starter Kung Fu Man (`stcommon = common1.cns`) was reported missing on every
// export. These are the three folders the web build mounts at data/ (vfslib.js
// build, layers 3 and 4); the engine checkout's data/ is also what the content
// audit reads (enginedata.js).
function engineDataDirs() {
  return [
    path.join(layout.dir('release-v2'), 'data'),
    path.join(layout.dir('release'), 'data'),
    path.join(layout.dir('ikemen-go-src'), 'data'),
  ];
}
// The names in those folders, lowercased, each `.zss` also under the name a
// MUGEN reference uses for it. A folder that is not there adds nothing.
function engineProvidedIn(dirs) {
  const set = new Set();
  for (const dir of dirs) {
    let names;
    try { names = fs.readdirSync(dir); } catch (e) { continue; }
    for (const n of names) {
      const low = n.toLowerCase();
      set.add(low);
      if (low.endsWith('.zss')) set.add(low.slice(0, -4));   // common1.cns.zss -> common1.cns
    }
  }
  return set;
}
let ENGINE_PROVIDES = null;
function engineProvidedFiles() {
  if (!ENGINE_PROVIDES) ENGINE_PROVIDES = engineProvidedIn(engineDataDirs());
  return ENGINE_PROVIDES;
}

// checkCharFiles(folder) -> { folder, def, ok, checked, problems: [...] }
// `folder` is a name under cache/, or an ABSOLUTE path - so a character can be
// checked BEFORE it is imported, which is the cheapest moment to find out.
// `opts.provides` replaces the engine's file set (tests only).
function checkCharFiles(folder, opts) {
  const provides = (opts && opts.provides) || engineProvidedFiles();
  const mdir = opts && opts.motifDir !== undefined ? opts.motifDir : motifDir();
  const raw = String(folder || '');
  const dir = path.isAbsolute(raw) ? raw : path.join(CACHE, raw);
  const res = { folder, def: null, ok: true, checked: 0, problems: [] };
  let defName;
  try { defName = findMainDef(dir); } catch (e) { defName = null; }
  if (!defName) {
    res.ok = false;
    res.problems.push({ key: '(def)', ref: '', severity: 'boot', why: 'no character .def found' });
    return res;
  }
  res.def = defName;
  let text;
  try { text = fs.readFileSync(path.join(dir, defName), 'latin1'); }
  catch (e) { res.ok = false; res.problems.push({ key: '(def)', ref: defName, severity: 'boot', why: 'cannot read the .def' }); return res; }

  const onDisk = listCharFiles(dir);
  // [Files] only. Other sections carry values that are not paths.
  const m = text.match(/\[Files\][\s\S]*?(?=\r?\n\s*\[|$)/i);
  if (!m) {
    res.ok = false;
    res.problems.push({ key: '(def)', ref: defName, severity: 'boot', why: 'the .def has no [Files] section' });
    return res;
  }
  for (const line of m[0].split(/\r?\n/)) {
    const kv = line.match(/^\s*([A-Za-z0-9_.]+)\s*=(.*)$/);
    if (!kv) continue;
    const sev = charFileSeverity(kv[1]);
    if (!sev) continue;
    const ref = normRef(kv[2]);
    if (!ref) continue;
    res.checked++;

    // Which spellings of these bytes exist on disk?
    const found = new Map();
    for (const [label, s] of decodeCandidates(ref)) {
      const hit = onDisk.get(s.toLowerCase());
      if (hit) found.set(label, hit);
    }
    const asEngine = engineDecode(ref);
    const engineHit = onDisk.get(asEngine.toLowerCase());

    if (engineHit) continue;                       // the engine will find it
    // ...or the engine ships it itself, from data/.
    const base = asEngine.toLowerCase().split('/').pop();
    if (provides.has(base) || provides.has(asEngine.toLowerCase())) continue;
    // ...or the bundle's screenpack holds it, where the build mounts it
    // (data/<pack>/), or the motif's folder does (the engine looks there too).
    if (themeFileFor(defName, asEngine) || (mdir && resolveCI(mdir, asEngine))) continue;

    if (found.size) {
      // THE FILE IS THERE AND THE ENGINE WILL STILL MISS IT.
      const [label, real] = [...found][0];
      res.ok = false;
      res.problems.push({
        key: kv[1], ref, severity: sev, kind: 'encoding',
        why: 'the file exists as "' + real + '" (' + label + '), but the engine reads'
          + ' this reference as "' + asEngine + '" and will not find it',
        onDisk: real, engineWants: asEngine,
      });
      continue;
    }
    res.ok = false;
    res.problems.push({
      key: kv[1], ref, severity: sev, kind: 'missing',
      why: 'no such file in the character folder', engineWants: asEngine,
    });
  }
  return res;
}

// The whole roster, worst first. Used by the pre-flight before an export and by
// the Studio to mark a character that will not survive a build.
function checkAllChars() {
  const roster = readRoster();
  const out = [];
  const opts = { provides: engineProvidedFiles(), motifDir: motifDir(roster) };
  for (const c of (roster.chars || [])) {
    if (!c || c.kind || !c.folder) continue;
    const r = checkCharFiles(c.folder, opts);
    if (!r.ok) out.push(r);
  }
  const rank = { boot: 0, match: 1, degraded: 2 };
  const worst = (r) => Math.min(...r.problems.map((p) => rank[p.severity] ?? 3));
  out.sort((a, b) => worst(a) - worst(b));
  return {
    checked: (roster.chars || []).filter((c) => c && !c.kind).length,
    bad: out.length,
    blocking: out.filter((r) => r.problems.some((p) => p.severity === 'boot')).length,
    chars: out,
  };
}

// HOW MANY CELLS THE SCREENPACK ACTUALLY HAS.
//
// rows x columns out of the motif's first [Select Info]. Anything past that
// product is a roster entry with no cell to live in.
function motifGridSize() {
  const defPath = motifDefPath();
  if (!defPath) return null;
  let text;
  try { text = fs.readFileSync(defPath, 'latin1'); } catch (e) { return null; }
  const lines = text.split(/\r?\n/);
  const { headerAt, end } = selectInfoBounds(lines);
  if (headerAt < 0) return null;
  let rows = 0, columns = 0;
  for (let i = headerAt + 1; i < end; i++) {
    const m = lines[i].replace(/;.*$/, '').match(/^\s*([A-Za-z0-9_.]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    const k = m[1].toLowerCase();
    if (k === 'rows') rows = parseInt(m[2], 10) || 0;
    else if (k === 'columns') columns = parseInt(m[2], 10) || 0;
  }
  if (rows <= 0 || columns <= 0) return null;
  return { rows, columns, cells: rows * columns };
}

// PUT A NEW CHARACTER IN A CELL THAT EXISTS.
//
// This was roster.chars.push(), which appends past the end of the grid the
// moment the roster is already as long as the screenpack has cells. The
// character is then genuinely in the build - so the library grays it out as
// "already in the build" and refuses it as a duplicate - while sitting at a row
// the grid does not have, so no cell is ever drawn for it. Invisible on the
// select screen and unreachable from the library, both at once.
//
// It took laying a grid out deliberately to expose it: putting one character in
// the middle and leaving the rest as empty cells makes the roster exactly as
// long as the grid, and the very next character added has nowhere to go.
// Measured on ikemen1 (9 rows x 8 columns = 72 cells) with a 74-entry roster:
// SFV_G landed at index 73, which is row 9 of rows 0-8, and the editor rendered
// no node for it at all.
//
// A 'dummy' is exactly the cell to fill: dummyslot means no character and no
// skip, so it is already an empty box the cursor walks over. A skipslot or a
// randomselect is a deliberate choice by whoever laid the grid out, and is left
// alone - unless the caller says otherwise (below).
//
// CELLS, NOT ARRAY INDEXES. This compared an entry's position in roster.chars
// with the cell count, which is only the same number while every entry is one
// cell. A slot block is several entries in ONE cell and an `exclude = 1` entry
// is in NO cell (see isOffGrid), so with either in the roster a dummy that is
// on the grid could be refused and one past the end accepted. cellIndexes walks
// the list the way motifSelectInfo and the engine do.
//
// opts.replaceRandom (E-Select's "Replace RandomSelect cells when no free cells
// available"): when NO cell is free, the first RandomSelect cell on the grid
// takes the character instead of the end of the list. The end of the list is
// a free cell too while it is still on the grid - a list shorter than the grid
// leaves open ground past its last entry - so a RandomSelect is taken only
// once the list already fills every cell. Trying it before the end, as this
// first did, replaced a RandomSelect on a half-empty grid.
//
// A LOCKED cell is never filled, dummy or random. The server cannot see the
// viewer's "Lock cells" preference, and a lock is only ever set while it is on,
// so a lock here is taken at its word.
function cellIndexes(chars) {
  const at = new Array(chars.length).fill(null);
  let cell = 0, i = 0;
  while (i < chars.length) {
    const c = chars[i];
    if (isOffGrid(c)) { i++; continue; }
    if (c && c.slot && !c.kind) {
      while (i < chars.length && chars[i] && chars[i].slot === c.slot && !chars[i].kind) {
        if (!isOffGrid(chars[i])) at[i] = cell;
        i++;
      }
    } else { at[i] = cell; i++; }
    cell++;
  }
  return { at, count: cell };
}

function placeInRoster(roster, entry, opts) {
  const grid = motifGridSize();
  const cells = grid ? grid.cells : 0;
  const chars = roster.chars;
  const { at, count: used } = cellIndexes(chars);
  const onGrid = (i) => at[i] !== null && (!cells || at[i] < cells);
  const takeable = (kind) => chars.findIndex((c, i) =>
    c && c.kind === kind && !motifCore.isLockOn(c.locked) && onGrid(i));
  let free = takeable('dummy');
  let replacedRandom = false;
  // With no grid size known there is no "full", so the end is always free.
  if (free < 0 && opts && opts.replaceRandom && cells && used >= cells) {
    free = takeable('random');
    replacedRandom = free >= 0;
  }
  if (free >= 0) {
    chars[free] = entry;
    const out = { at: free, cell: at[free], filledEmptyCell: true, cells };
    if (replacedRandom) out.replacedRandom = true;
    return out;
  }
  chars.push(entry);
  // Nothing is lost when the grid is full - the character is still added and
  // still on disk - but it has no cell, and saying so is the whole point.
  const { at: after, count } = cellIndexes(chars);
  const beyond = !!cells && count > cells;
  return { at: chars.length - 1, cell: after[chars.length - 1], filledEmptyCell: false, cells, beyondGrid: beyond };
}

function selectInfoBounds(lines) {
  let headerAt = -1;
  for (let i = 0; i < lines.length; i++) {
    const bare = lines[i].replace(/;.*$/, '').trim();
    if (!/^\[/.test(bare)) continue;
    if (headerAt >= 0) return { headerAt, end: i };
    if (/^\[\s*select\s+info\s*\]$/i.test(bare)) headerAt = i;
  }
  return { headerAt, end: lines.length };
}

// CONTINUE A PACK'S PER-ROW GEOMETRY OVER THE ROWS IT NEVER DESCRIBED.
//
// An Ikemen pack can describe its cells per row INDEX - `cell.*-N.scale`,
// `.spacing`, `.offset`, `.xangle` - and ikemen1 does, ten blocks whose scale
// ramps 0.30 -> 0.46 so the grid draws as a trapezoid receding into the screen.
// A row past the tenth has no block and falls back to the flat
// `cell.bg.scale`: measured at 12x20, rows 10 and 11 draw at scale 0.25 and
// 279px wide against row 9's 0.46 and 498px, a narrow band tucked under the
// trapezoid.
//
// THAT IS WHAT THE GAME DRAWS. VSelect renders the same band, because the pack
// genuinely never said where an eleventh row goes. So this is NOT run for you
// when the grid grows - an editor that quietly rewrites the author's screenpack
// to avoid a state the engine produces is hiding the truth about the build.
// It is a menu action, taken deliberately, on the screenpack.
//
// The ramp is continued by stepping each value by the amount the last two
// declared rows stepped by. ikemen1's are exactly linear (+0.038 scale, +2.3
// spacing, -10 offset), so it lands on the pack's own progression. Values that
// are not numbers - `projection = perspective` - are copied.
function extendRowOverrides(lines, secStart, secEnd, rows) {
  const KEY = /^\s*cell\.\*-(\d+)\.([A-Za-z0-9_.]+)\s*=\s*([^;]*?)\s*(?:;.*)?$/;
  const byRow = new Map();
  let lastLine = -1;
  for (let i = secStart; i < secEnd && i < lines.length; i++) {
    const m = lines[i].match(KEY);
    if (!m) continue;
    const r = parseInt(m[1], 10);
    if (!byRow.has(r)) byRow.set(r, []);
    byRow.get(r).push([m[2], m[3]]);   // file order, so the block reads the same
    lastLine = i;
  }
  if (!byRow.size) return 0;           // nothing to continue
  const declared = Array.from(byRow.keys()).sort((a, b) => a - b);
  const last = declared[declared.length - 1];
  if (rows <= last + 1) return 0;      // every row the grid has is described

  const fmt = (n) => String(Math.round(n * 10000) / 10000);
  const step = (prevV, lastV) => {
    if (prevV === undefined) return lastV;          // only one row to go on
    const a = String(prevV).split(','), b = String(lastV).split(',');
    if (a.length !== b.length) return lastV;
    const out = [];
    for (let i = 0; i < b.length; i++) {
      const pa = parseFloat(a[i]), pb = parseFloat(b[i]);
      if (!Number.isFinite(pa) || !Number.isFinite(pb)) return lastV;
      out.push(fmt(pb + (pb - pa)));
    }
    return out.join(',');
  };

  const props = byRow.get(last).map((e) => e[0]);
  let prev = declared.length > 1 ? new Map(byRow.get(declared[declared.length - 2])) : null;
  let cur = new Map(byRow.get(last));
  const add = [];
  for (let r = last + 1; r < rows; r++) {
    const next = new Map();
    add.push('');
    for (const prop of props) {
      const v = step(prev ? prev.get(prop) : undefined, cur.get(prop));
      next.set(prop, v);
      add.push('cell.*-' + r + '.' + prop + ' = ' + v);
    }
    // The row just written becomes the one to step FROM, so the ramp keeps its
    // slope over several new rows instead of flattening after the first.
    prev = cur;
    cur = next;
  }
  lines.splice(lastLine + 1, 0, ...add);
  return rows - last - 1;
}

// The menu action. Reads `rows` back out of the FILE rather than taking it from
// the caller, so it cannot describe rows the screenpack does not have.
function describeMotifRows() {
  const defPath = motifDefPath();
  if (!defPath) return { error: 'motif not found' };
  let text;
  try { text = fs.readFileSync(defPath, 'latin1'); }
  catch (e) { return { error: 'cannot read the motif' }; }
  const nl = text.indexOf(String.fromCharCode(13, 10)) >= 0
    ? String.fromCharCode(13, 10) : String.fromCharCode(10);
  const lines = text.split(/\r?\n/);
  const { headerAt, end } = selectInfoBounds(lines);
  if (headerAt < 0) return { error: 'this screenpack has no [Select Info]' };
  let rows = 0;
  for (let i = headerAt + 1; i < end; i++) {
    const m = lines[i].match(/^\s*rows\s*=\s*(-?\d+)/i);
    if (m) { rows = parseInt(m[1], 10); break; }
  }
  if (!rows) return { error: 'this screenpack does not say how many rows it has' };
  const rowsAdded = extendRowOverrides(lines, headerAt + 1, end, rows);
  if (!rowsAdded) return { ok: true, rowsAdded: 0, rows };
  keepMotifBackup(defPath);
  fs.writeFileSync(defPath, lines.join(nl), 'latin1');
  return { ok: true, rowsAdded, rows };
}

// SET THE GRID'S SHAPE IN [Select Info], leaving the rest of the file alone.
//
// A screenpack .def is hand-written and full of comments that explain what each
// number does; rewriting it from a parse would throw all of that away. So each
// key is edited IN PLACE on its own line, keeping its indentation and any
// trailing comment, and a key the pack never declared is inserted directly
// after the section header.
//
// Only the FIRST [Select Info] is touched - the engine reads the first section
// of a given name and ignores later ones (common.go ini rules), so editing a
// second would change a file the game does not read.
function writeMotifGrid(vals) {
  const defPath = motifDefPath();
  if (!defPath) return { error: 'motif not found' };
  let text;
  try { text = fs.readFileSync(defPath, 'latin1'); }
  catch (e) { return { error: 'cannot read the motif' }; }

  const want = {};
  if (vals.rows !== undefined) want.rows = String(vals.rows | 0);
  if (vals.columns !== undefined) want.columns = String(vals.columns | 0);
  if (vals.cellSize) want['cell.size'] = (vals.cellSize[0] | 0) + ',' + (vals.cellSize[1] | 0);
  if (vals.cellSpacing) {
    want['cell.spacing'] = (vals.cellSpacing[0] | 0) + ',' + (vals.cellSpacing[1] | 0);
  }
  // The two empty-cell flags: whether the cursor can rest on an empty cell,
  // and whether the empty box is drawn. Per screenpack, and the editor shows
  // and sets them for the pack in use.
  if (vals.moveOverEmptyBoxes !== undefined) want.moveoveremptyboxes = vals.moveOverEmptyBoxes ? '1' : '0';
  if (vals.showEmptyBoxes !== undefined) want.showemptyboxes = vals.showEmptyBoxes ? '1' : '0';
  if (!Object.keys(want).length) return { error: 'nothing to set' };

  const nl = text.indexOf(String.fromCharCode(13, 10)) >= 0
    ? String.fromCharCode(13, 10) : String.fromCharCode(10);
  const lines = text.split(/\r?\n/);
  const seen = new Set();
  const { headerAt, end } = selectInfoBounds(lines);

  for (let i = headerAt + 1; i < end && headerAt >= 0; i++) {
    const raw = lines[i];
    const m = raw.match(/^(\s*)([A-Za-z0-9_.]+)(\s*=\s*)([^;]*?)(\s*)(;.*)?$/);
    if (!m) continue;
    const key = m[2].toLowerCase();
    if (!(key in want)) continue;
    seen.add(key);
    // Keep the indentation, the spacing around '=', the trailing comment - and
    // the COLUMN that comment sits in. A screenpack .def is aligned by hand, and
    // writing the value followed by whatever was left jammed the comment against
    // it: `cell.size = 24,24;x,y size of each cell` where every neighboring
    // line still had its comment lined up twenty columns over.
    const val = want[key];
    const head = m[1] + m[2] + m[3];
    let tail = '';
    if (m[6]) {
      const was = head.length + m[4].length + m[5].length;   // where ';' started
      tail = ' '.repeat(Math.max(1, was - head.length - val.length)) + m[6];
    }
    lines[i] = head + val + tail;
  }

  // Anything the pack never declared goes in right under the header, so it
  // lands inside the section it belongs to.
  const missing = Object.keys(want).filter((k) => !seen.has(k));
  if (missing.length) {
    if (headerAt < 0) return { error: 'this screenpack has no [Select Info]' };
    lines.splice(headerAt + 1, 0, ...missing.map((k) => k + ' = ' + want[k]));
  }

  keepMotifBackup(defPath);
  fs.writeFileSync(defPath, lines.join(nl), 'latin1');
  return { ok: true, set: want };
}

// WHAT A CHARACTER SAYS ABOUT ITSELF - the read-only half of its properties.
//
// PALETTE COUNT IS THE NUMBER OF palN KEYS IN THE .def, not the number of
// palettes in the .sff. Those are different numbers and the .def one is what
// the player actually gets: DongHwan carries 12 palN entries against 28
// palettes in his SFF v2 table.
//
// SFF VERSION comes from bytes 12-15 of the header, MAJOR LAST - byte 15 is
// the one that says 1 or 2, which is the mistake that once had this project
// reporting every file as v1.
function charAbout(mountAs) {
  const { dir, entryDef } = charSource(mountAs);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return null;
  const defName = (entryDef && fs.existsSync(path.join(dir, entryDef))) ? entryDef : findMainDef(dir);
  if (!defName) return null;
  const defPath = path.join(dir, defName);
  let txt = '';
  try { txt = fs.readFileSync(defPath, 'latin1'); } catch (e) { return null; }
  // sectionOf lives inside sffdec-core and is not exported, and [Info] is two
  // keys' worth of work, so it is read here rather than widening that API.
  const info = {};
  {
    let inSec = false, seen = false;
    for (const raw of txt.split(/\r?\n/)) {
      const line = raw.replace(/;.*$/, '').trim();
      if (/^\[/.test(line)) {
        if (seen && inSec) break;
        inSec = /^\[\s*info\s*\]$/i.test(line);
        if (inSec) seen = true;
        continue;
      }
      if (!inSec || !line) continue;
      const m = line.match(/^([^=]+?)\s*=\s*(.*)$/);
      if (m && !(m[1].trim().toLowerCase() in info)) {
        info[m[1].trim().toLowerCase()] = m[2].trim().replace(/^"|"$/g, '');
      }
    }
  }
  let def = null;
  try { def = sffDecode.parseDef(defPath); } catch (e) { def = null; }

  const out = {
    folder: mountAs,
    def: defName,
    displayName: (def && def.displayname) || (def && def.name) || mountAs,
    name: (def && def.name) || '',
    author: (def && def.author) || '',
    versionDate: info.versiondate || '',
    mugenVersion: info.mugenversion || '',
    localcoord: (def && def.localcoord) || 320,
    paletteCount: (txt.match(/^\s*pal\d+\s*=/gim) || []).length,
    sffVersion: '',
    sprites: 0,
  };
  try {
    const sffPath = mainSffPathLoose(dir, def || {});
    const b = fs.readFileSync(sffPath);
    if (b.length > 16) out.sffVersion = b[15] + '.' + b[14] + '.' + b[13] + '.' + b[12];
    const sff = sffDecode.readSff(sffPath);
    if (sff && sff.byKey) out.sprites = sff.byKey.size;
  } catch (e) { /* the def may name a sprite file that is not there */ }
  return out;
}

// THE NUMBERS cellPortraits MEASURES IN EACH .sff, kept per character.
//
// CHAR_SFF_CACHE holds eight whole files, so a sweep over a bigger roster
// evicted every one before it was needed again and each call read every sprite
// file from scratch: a Studio load and then a select-editor open read them all
// twice. What the grid needs from a file is a handful of numbers - the cell
// sprite's geometry, the face sprite's, and the best big portrait - so those
// are what is kept, one entry per character and never the bytes. Stamped with
// the file's path|size@mtime and the sprites asked for, so an edited .sff or a
// different screenpack measures again.
//
// PER SPRITE, NOT PER QUESTION. The entry was one answer stamped with the
// sprites asked for, and the two callers ask different questions of the same
// files: the Studio asks for the cell AND the big portrait (faceGroup 9000,1),
// E-Select for the cell alone under a pack whose face is an animation
// (ikemen1). Each call threw the other's answer away, so opening E-Select after
// the Studio re-read every sprite file of the build (46 s at 802 characters).
// The numbers are kept per sprite under the file's stamp, and a question only
// opens the file for a sprite it has not measured yet. The numbers come from
// the query (/api/cell-portraits), so each character keeps the last
// CELL_GEOM_PER_CHAR sprites asked, oldest out (the packs ask two or three).
const CELL_GEOM_CACHE = new Map();   // id -> { key, geom: Map('g,i' -> geom), best: Map('g,i' -> best) }
const CELL_GEOM_PER_CHAR = 16;
// set k (or, already there, move it to the newest end) and drop the oldest past the cap
const keepGeom = (m, k, v) => { m.delete(k); m.set(k, v); if (m.size > CELL_GEOM_PER_CHAR) m.delete(m.keys().next().value); };
function cellSffNumbers(id, group, index, faceGroup, faceIndex, wantFace) {
  const k = charSffKey(id);
  if (!k) return null;
  const slot = String(id).toLowerCase();
  let ent = CELL_GEOM_CACHE.get(slot);
  if (!ent || ent.key !== k.key) ent = { key: k.key, geom: new Map(), best: new Map() };
  const cellAt = group + ',' + index, faceAt = faceGroup + ',' + faceIndex;
  const res = {
    cell: ent.geom.get(cellAt),
    face: wantFace ? ent.geom.get(faceAt) : null,
    best: wantFace ? ent.best.get(faceAt) : null,
  };
  if (!ent.geom.has(cellAt) || (wantFace && (!ent.geom.has(faceAt) || !ent.best.has(faceAt)))) {
    const rec = charSff(id);
    if (!rec) return null;
    const geom = (g, i) => {
      try {
        const q = sffDecode.spriteGeom(rec.sff, g, i);
        return q ? { w: q.w, h: q.h, axisX: q.axisX, axisY: q.axisY } : null;
      } catch (e) { return null; }
    };
    if (!ent.geom.has(cellAt)) res.cell = geom(group, index);
    if (wantFace) {
      if (!ent.geom.has(faceAt)) res.face = cellAt === faceAt ? res.cell : geom(faceGroup, faceIndex);
      if (!ent.best.has(faceAt)) {
        let best = null;
        try { best = bestPortrait(rec.sff, faceGroup, faceIndex); } catch (e) { best = null; }
        res.best = best;
      }
    }
    CELL_GEOM_CACHE.set(slot, ent);
  }
  // the sprites this question used go in as the newest, so none of them is
  // the one dropped past the cap
  keepGeom(ent.geom, cellAt, res.cell);
  if (wantFace) { keepGeom(ent.geom, faceAt, res.face); keepGeom(ent.best, faceAt, res.best); }
  return res;
}

// THE AXIS AS THE BUILD SHIPS IT (portraitfix.shippedCellGeom, GRAIL 3.4f). A
// 9000,0 anchored off its own box - Pathena's 25x25 face at axis 0,25 - goes
// out at axis 0,0 in both builds' copy (v1base.js), so the views that place a
// sprite by its axis place it there too: E-Select's cells and the Theme grid
// (cellPortraits), and anything that asks spriteGeomFor. Measured in the
// character's own file, which stays as it is. The .air is read only for such a
// sprite, to keep one its own animation draws, as the build does.
function shippedCellGeomFor(id, group, index, g) {
  if (!g || group !== portraitfix.PORTRAIT_GROUP || index !== 0
    || !portraitfix.cellAxisOffBox(g.w, g.h, g.axisX, g.axisY)) return g;
  // read exactly as the builds' repair reads it (v1base.cellAirFor), so the
  // views and the shipped file cannot disagree on a def's anim line
  let air = null;
  try {
    const k = charSffKey(id);
    if (k) air = require('./v1base.js').cellAirFor(k.dir, k.defName);
  } catch (e) { air = null; }
  return portraitfix.shippedCellGeom(group, index, g, air);
}

// EVERY ROSTER CHARACTER'S CELL PORTRAIT, in one request.
//
// The select cell does NOT stretch a portrait to fill itself. The engine draws
// the sprite at its own size, scaled by the row's cell scale times a
// resolution fix, with the sprite's AXIS on the cell position plus
// portrait.offset (start.lua:2555-2582):
//
//   resFix = portraitscale * motif.localcoord.x / char.localcoord
//   scale  = cellScale(row) * resFix        <- cns_scale does NOT apply here;
//                                              that is the animation path only
//
// A classic 320-wide character ships a 25x25 sprite at 9000,0 and resFix is
// 1280/320 = 4, which lands it at 100 units in a 106-unit cell - which is why
// filling the cell looked right for most of the roster. It is not right for a
// character whose 9000,0 is something else entirely: three in this build store
// a 15x31 sprite there, and stretching that to a square cell drew a green
// smear rather than the small sprite the game shows.
//
// One request for the whole roster: 25 separate lookups would each re-open and
// re-parse a .sff, and drawGrid needs all of them before it can lay out a row.
function cellPortraits(group, index, faceGroup, faceIndex) {
  const roster = readRoster();
  ROSTER_FOR_CALL = roster;
  try { return cellPortraitsOf(roster, group, index, faceGroup, faceIndex); } finally { ROSTER_FOR_CALL = null; }
}
function cellPortraitsOf(roster, group, index, faceGroup, faceIndex) {
  const out = {};
  const wantFace = Number.isFinite(faceGroup) && Number.isFinite(faceIndex);
  // ON-DISK CHARACTERS ARE MEASURED TOO. This walked the roster alone, so the
  // two characters that are in cache/ but not in the build had no bestBig and
  // their tiles fell back to 9000,1 - which for kur0maru is a 120x363 tower,
  // not the 424x455 portrait he keeps at 9000,101. They are shown in the same
  // grid as everything else, so they get the same treatment.
  //
  // Matched case-INSENSITIVELY, because the roster stores the author's casing
  // (`DongHwan`) while the folder on disk is lower case (`donghwan`) and
  // Windows resolves either. An exact comparison added seventeen duplicates
  // here - seventeen redundant .sff opens and a response with two entries for
  // most of the cast.
  const ids = (roster.chars || []).map((c) => c.mountAs).filter(Boolean);
  const seen = new Set(ids.map((x) => String(x).toLowerCase()));
  try {
    for (const e of fs.readdirSync(CACHE, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const key = e.name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      ids.push(e.name);
    }
  } catch (e) { /* no cache dir yet */ }
  for (const id of ids) {
    if (!id || out[id]) continue;
    let nums = null;
    try { nums = cellSffNumbers(id, group, index, faceGroup, faceIndex, wantFace); } catch (e) { nums = null; }
    // What spriteGeomFor answers: a fitted portrait first, then the file's own
    // sprite. The fit stays live: it is roster data, with its own cache.
    const geomOf = (g, i, raw) => {
      const f = fittedPortrait(id, g, i);
      return f ? { w: f.w, h: f.h, axisX: f.axisX, axisY: f.axisY } : raw;
    };
    let geom = null;
    try { geom = shippedCellGeomFor(id, group, index, geomOf(group, index, nums && nums.cell)); } catch (e) { geom = null; }
    if (!geom) continue;
    let sc = { localcoord: 320, portraitscale: 1 };
    try { sc = charScale(id); } catch (e) { /* engine defaults */ }
    out[id] = {
      w: geom.w, h: geom.h, axisX: geom.axisX, axisY: geom.axisY,
      localcoord: sc.localcoord || 320,
      portraitscale: sc.portraitscale || 1,
    };
    // the file's own axis, when the build ships another (shippedCellGeomFor)
    if (geom.axisFrom) out[id].axisFrom = geom.axisFrom;
    // THE BIG PORTRAIT TOO, in the same pass. It is a second lookup in an SFF
    // this loop already opens for the cell portrait, so measuring it costs
    // almost nothing - and without it the editor cannot tell that a character
    // ships artwork far too large for the screenpack it is in. cvsjill,
    // cvsmika_h and Leona carry a 424x455 sprite at 9000,1 where an ordinary
    // character carries 120x140.
    if (wantFace) {
      let fg = null;
      try { fg = shippedCellGeomFor(id, faceGroup, faceIndex, geomOf(faceGroup, faceIndex, nums && nums.face)); } catch (e) { fg = null; }
      // The AXIS too: a big portrait is placed by its axis, not its corner,
      // so where it lands cannot be worked out without it.
      if (fg) out[id].face = { w: fg.w, h: fg.h, axisX: fg.axisX, axisY: fg.axisY };
      // AND THE ONE IT ACTUALLY HAS. The number above is what the screenpack
      // asks for; bestBig is what is really in the file, with `source` saying
      // which rung of the ladder answered. kur0maru keeps a 120x363 at 9000,1
      // and its real 424x455 portrait at 9000,101 - only the scan finds that.
      // A copy, because the cached one is handed out again on the next call.
      //
      // A PORTRAIT FIT IS THE ONE IT HAS. Under the screenpack in use, a fit of
      // the asked sprite (portraitfit.js, GRAIL 3.4e) is what /api/sprite serves
      // for it, so that sprite is the tile's picture - the ladder reads the file
      // and would skip it. Colette's 9000,1 is 960x544, too wide to pass as a
      // face, so the scan went past the 480x560 fit she has for IKEMEN1.
      const fit = fittedPortrait(id, faceGroup, faceIndex);
      const bb = nums && nums.best;
      if (fit && plausiblePortrait(fit)) {
        out[id].bestBig = { group: faceGroup, index: faceIndex, w: fit.w, h: fit.h, axisX: fit.axisX, axisY: fit.axisY, source: 'fit' };
      } else if (bb) out[id].bestBig = structuredClone(bb);
    }
  }
  return out;
}

// One of a character's .air ACTIONS, with each frame's sprite geometry.
//
// The select screen's big portrait is not a portrait: ikemen1 sets
// `p1.face.anim = 0`, which is the character's STANCE animation (GRAIL 4.9
// records the same thing about the palette preview). Drawing it needs the
// frame list AND each frame's axis, because .air offsets are relative to the
// sprite's own axis - frames in one pose routinely differ in size, and
// aligning them by their top-left corner makes the pose jitter.
// EVERY ACTION IN A CHARACTER'S .air, parsed once.
//
// Both the action list and the player need this, and reading a .air is cheap
// next to the .sff beside it, so the two share one loader rather than each
// re-resolving the path. .def values carry Windows separators and arbitrary
// case; the cache is a real directory, so the name is matched case-insensitively
// the way the sprite route does it.
function loadActions(mountAs) {
  const { dir, entryDef } = charSource(mountAs);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return null;
  const defName = (entryDef && fs.existsSync(path.join(dir, entryDef))) ? entryDef : findMainDef(dir);
  if (!defName) return null;
  let def = null;
  try { def = sffDecode.parseDef(path.join(dir, defName)); } catch (e) { return null; }
  if (!def || !def.anim) return null;
  const rel = def.anim.replace(/\\/g, '/');
  let airPath = path.join(dir, rel);
  if (!fs.existsSync(airPath)) {
    const want = path.basename(rel).toLowerCase();
    let hit = null;
    try { hit = fs.readdirSync(dir).find((f) => f.toLowerCase() === want); } catch (e) { hit = null; }
    if (!hit) return null;
    airPath = path.join(dir, hit);
  }
  let actions = null;
  try { actions = motifCore.parseActions(fs.readFileSync(airPath, 'latin1')); }
  catch (e) { return null; }
  if (!actions) return null;
  return { dir, def, actions };
}

// The actions a character HAS, with enough to choose one: how many frames, and
// how long the whole thing runs. A LAST -1 frame time means "hold forever", which
// is how a .air spells a still pose - it is reported rather than summed, because
// adding it would make a one-frame idle look like it lasts no time at all.
// ---- THE ACTION, AS A GIF -------------------------------------------------
//
// NOT IN THE LEGACY KIT. tools/gif.js is on make-kit.js's ban list, and the
// kit ships modlib.js, so the require below is LAZY and the feature simply
// reports itself unavailable when the encoder is not there. A top-level require
// would stop the kit's modlib from loading at all.
//
// A shareable copy carries the encoder (since 2026-09-28): the leaderboard art
// is drawn with it. The GIF BUTTON is a separate surface - make-portable
// --no-gif holds it back by turning canExportGif() below off in the copy
// (private-surfaces.neuterGifButton), and every route and panel that offers a
// GIF asks canExportGif(), never the encoder. charAnimRuns, which the art is
// made from, asks gifLib() directly, so the art is unaffected. Keep that line
// exactly as it is: the neuter step matches it and refuses to build without it.
//
// For the everyday frame nothing is re-encoded: the sprite route already
// produces one byte per pixel with a 256-entry table and index 0 transparent,
// which is exactly what GIF stores, so an opaque, unflipped, unscaled action is
// a container change and the GIF is pixel-identical to the sprites. The
// composer below changes pixels only where the engine draws something other
// than the sprite as stored: a flip, a scale, a blend, a palette entry with an
// alpha of its own, truecolor art.
let GIF_LIB;
function gifLib() {
  if (GIF_LIB !== undefined) return GIF_LIB;
  try { GIF_LIB = require('./tools/gif.js'); } catch (e) { GIF_LIB = null; }
  return GIF_LIB;
}
function canExportGif() { return !!gifLib(); }

// ---- THE COMPOSER ----------------------------------------------------------
//
// ONE PLACE decides where a run's pixels land and what color they come out,
// and every picture of an action is made by it: the GIF, the one-frame PNG
// (still=), and the leaderboard art (charAnimRuns, which the extractor calls
// instead of drawing anything itself). Two copies of this would drift apart,
// which is how the art and the panel came to disagree in the first place.
//
// WHERE (anim.go:926-1030, render.go:658-684, the quad's uv at 315-320). An
// element draws its sprite with the axis at (X, Y) - the
// DRAWN offset, which is -x for an even number of H of two or more (the
// parser's xDraw; one H leaves it at +x) - mirrored and scaled ABOUT THE AXIS
// LINE, the pixel edge at the axis, never about the sprite's middle:
//   sx = (H ? -1 : 1) * xscale,   sy = (V ? -1 : 1) * yscale
// so texel column c spans [X + (c - axisX)*sx, X + (c + 1 - axisX)*sx). The
// GPU samples each screen pixel at its center with nearest filtering for an
// indexed sprite (image.go:938), so destination pixel dx shows column
//   c = floor(axisX + (dx + 0.5 - X) / sx)
// when that lands inside the sprite, and rows the same way. With sx = 1 that
// is the old integer placement, dx - (X - axisX), exactly - which is why an
// unflipped action comes out byte for byte as it always did. The AIR offset is
// not scaled by the frame's own scale (anim.go:974-975 cancels it), so a scale
// grows the sprite about its axis only. A scale of 0 draws nothing (isBlank,
// anim.go:490-492). NOT drawn: the frame's angle (a rotation is a resample of
// its own; the result says so in its notes) and the character's [Size] scale -
// the GIF is in sprite pixels, as it always was.
//
// WHAT COLOR (render.go:796-966). With C the sprite color, a its PALETTE
// ENTRY's alpha (an SFF v2.01 palette stores one per color; every other
// palette is 0 at index 0 and 255 elsewhere - image.go:2260-2269) or the
// texel's alpha for a truecolor sprite, B what it lands on, and s', d' the
// frame's blend after alphaToBlend (motif-core, anim.go:849-889):
//   none    C*a + B*(1-a)
//   add     B*(1 - a*(1-d')) + C*a*s'
//   sub     B*(1 - a*(1-d')) - C*a*s'
//   subadd  B - gray(C)*a*d' + C*a*s'        gray = (r+g+b)/3
// clamped the way the framebuffer clamps. On a SOLID background (bg) that is
// what is computed, and for an indexed sprite it is a transform of each
// palette entry - the frame stays indexed and lossless.
//
// ON A TRANSPARENT BACKGROUND IT CANNOT BE EXACT: a GIF pixel is a color or
// nothing, and every blend except "none" is defined by what it lands on. What
// follows are APPROXIMATIONS, chosen to read right over a dark page, and the
// export names them in its notes:
//   none, and add with d' = 0 (C*s' at full coverage, exact wherever a is 0
//       or 1, whatever the background): drawn where a >= 128/255;
//   translucent - add with d' about 1 - s' and s' < 1 (AS128D128, AS64D192:
//       an alpha blend written as an add): kept where a*s' beats a 4x4 Bayer
//       threshold at the destination pixel, an ordered dither at the right
//       coverage, in the sprite's own color;
//   glow - any other add with d' > 0 (A, A1, AS..D..): kept, in its own color,
//       where the light it adds, max(C)*a*s', reaches 48/255. The dark fringe
//       of a halo adds almost nothing in the game and would otherwise be drawn
//       as a solid dark ring;
//   sub, subadd: black, dithered at the coverage of what they take away -
//       gray(C)*a*s' for sub; for subadd its darkening term, gray(C)*a*d'.
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
function bayerAt(x, y) { return (BAYER4[((y & 3) << 2) | (x & 3)] + 0.5) / 16; }
const GLOW_CUT = 48 / 255;
// The Clsn overlay's three colors: Clsn2, Clsn1, the axis cross.
const CLSN_RGB = [[80, 230, 120], [255, 60, 60], [120, 190, 255]];

// Where a run's sprite lands: the drawn axis, the signed scales and the
// bounds in .air space - or null when the element draws nothing (no sprite,
// or a scale of 0). `s` is the sprite's geometry { w, h, axisX, axisY }.
function runPlacement(e, s) {
  if (!e || !s || !s.w || !s.h) return null;
  const xs = e.xscale !== undefined ? e.xscale : 1, ys = e.yscale !== undefined ? e.yscale : 1;
  const sx = (e.h ? -1 : 1) * xs, sy = (e.v ? -1 : 1) * ys;
  if (!sx || !sy || !Number.isFinite(sx) || !Number.isFinite(sy)) return null;
  const X = e.xDraw !== undefined ? e.xDraw : (e.x || 0);
  const Y = e.yDraw !== undefined ? e.yDraw : (e.y || 0);
  const ax = s.axisX || 0, ay = s.axisY || 0;
  const xa = X - ax * sx, xb = X + (s.w - ax) * sx;
  const ya = Y - ay * sy, yb = Y + (s.h - ay) * sy;
  return { X, Y, sx, sy, ax, ay, w: s.w, h: s.h,
    l: Math.min(xa, xb), r: Math.max(xa, xb), t: Math.min(ya, yb), b: Math.max(ya, yb) };
}

// The panel's framing rule, server side. It has to be the same rule or the GIF
// would not be the thing you were just looking at: the union of the TYPICAL
// frames, with anything over three times the median area or under an eighth of
// it left out. See the note on measure() in studio.html - kotaro's idle opens
// with a 217x181 sprite and continues at ~70x113. Each run counts with the
// bounds it is DRAWN at (runPlacement): a mirrored frame reaches the other
// side of its axis, a scaled one reaches further.
function animBox(places) {
  const drawn = places.filter(Boolean);
  if (!drawn.length) return null;
  const area = (p) => (p.r - p.l) * (p.b - p.t);
  let keep = drawn;
  if (drawn.length >= 3) {
    const areas = drawn.map(area).sort((a, b) => a - b);
    const med = areas[areas.length >> 1];
    const within = drawn.filter((p) => area(p) <= med * 3 && area(p) >= med / 8);
    if (within.length) keep = within;
  }
  let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
  for (const p of keep) {
    l = Math.min(l, Math.floor(p.l)); t = Math.min(t, Math.floor(p.t));
    r = Math.max(r, Math.ceil(p.r)); b = Math.max(b, Math.ceil(p.b));
  }
  return { l, t, w: Math.max(1, r - l), h: Math.max(1, b - t) };
}

// The frame's blend as the renderer sees it, sorted into the cases the
// transparent-background rules above tell apart, or null for an opaque frame.
// Add 255/0 (AS256D0, AS255D0) IS opaque drawing - B*(1-a) + C*a - and is
// treated as such.
function blendOf(e) {
  const b = e && e.blend;
  if (!b) return null;
  const { s, d } = motifCore.alphaToBlend(b.src, b.dst);
  let cat = b.mode;
  if (b.mode === 'add') {
    if (d === 0) { if (s === 255) return null; cat = 'dim'; }
    else if (s < 255 && d < 255 && Math.abs(s + d - 255) <= 16) cat = 'translucent';
    else cat = 'glow';
  }
  return { mode: b.mode, src: b.src, dst: b.dst, s, d, sp: s / 255, dp: d / 255, cat };
}

// ONE COLOR THROUGH THE RULES ABOVE: r, g, b, a are 0-255, `bl` is blendOf's
// answer (null = none), `bg` [r, g, b] or null for transparent. Sets
// out.kind (0 nothing, 1 drawn, 2 dithered at out.cov) and out.r/g/b. On a
// solid background a result equal to the background is "nothing", which is
// the same pixel and lets it share the background's index.
function shade(r, g, b, a, bl, bg, out) {
  const A = a / 255;
  out.cov = 0;
  if (bg) {
    const cr = r / 255, cg = g / 255, cb = b / 255;
    const Br = bg[0] / 255, Bg = bg[1] / 255, Bb = bg[2] / 255;
    let or, og, ob;
    if (!bl) {
      or = cr * A + Br * (1 - A); og = cg * A + Bg * (1 - A); ob = cb * A + Bb * (1 - A);
    } else if (bl.mode === 'add' || bl.mode === 'sub') {
      const keep = 1 - A * (1 - bl.dp), sign = bl.mode === 'add' ? 1 : -1;
      or = Br * keep + sign * cr * A * bl.sp; og = Bg * keep + sign * cg * A * bl.sp; ob = Bb * keep + sign * cb * A * bl.sp;
    } else {
      const gray = (cr + cg + cb) / 3;
      or = Br - gray * A * bl.dp + cr * A * bl.sp; og = Bg - gray * A * bl.dp + cg * A * bl.sp; ob = Bb - gray * A * bl.dp + cb * A * bl.sp;
    }
    const q = (v) => Math.round(Math.max(0, Math.min(1, v)) * 255);
    out.r = q(or); out.g = q(og); out.b = q(ob);
    out.kind = out.r === bg[0] && out.g === bg[1] && out.b === bg[2] ? 0 : 1;
    return;
  }
  out.r = r; out.g = g; out.b = b;
  if (!bl || bl.cat === 'dim') {
    out.kind = a >= 128 ? 1 : 0;
    if (bl) { out.r = Math.round(r * bl.sp); out.g = Math.round(g * bl.sp); out.b = Math.round(b * bl.sp); }
    return;
  }
  if (bl.cat === 'glow') {
    out.kind = (Math.max(r, g, b) / 255) * A * bl.sp >= GLOW_CUT ? 1 : 0;
    return;
  }
  if (bl.cat === 'translucent') out.cov = A * bl.sp;
  else {
    out.r = 0; out.g = 0; out.b = 0;
    out.cov = ((r + g + b) / 765) * A * (bl.cat === 'sub' ? bl.sp : bl.dp);
  }
  out.kind = out.cov <= 0 ? 0 : 2;
}

// THE SAME COLOR, BAKED INTO STRAIGHT ALPHA for a picture shown over a dark
// page with no blending of its own (the leaderboard art): an opaque color
// keeps its entry's alpha; a translucent one gets a*s'; a glow becomes the
// light it adds, P = C*a*s', as alpha max(P) with the color un-premultiplied
// (P / alpha) - exact over black; subtractive frames only darken and are
// dropped. Sets out.r/g/b/a (0-255).
function boardShade(r, g, b, a, bl, out) {
  out.r = r; out.g = g; out.b = b; out.a = a;
  if (!bl) return;
  if (bl.cat === 'dim') { out.r = Math.round(r * bl.sp); out.g = Math.round(g * bl.sp); out.b = Math.round(b * bl.sp); return; }
  if (bl.cat === 'translucent') { out.a = Math.round(a * bl.sp); return; }
  if (bl.cat === 'glow') {
    const k = (a / 255) * bl.sp;
    const pr = r * k, pg = g * k, pb = b * k, m = Math.max(pr, pg, pb);
    out.a = Math.round(m);
    if (out.a > 0) { out.r = Math.min(255, Math.round(pr * 255 / m)); out.g = Math.min(255, Math.round(pg * 255 / m)); out.b = Math.min(255, Math.round(pb * 255 / m)); }
    return;
  }
  out.a = 0;
}

// `bg` option: 'rrggbb' (with or without '#') or [r, g, b]; null = transparent.
function parseBg(v) {
  if (v === undefined || v === null || v === '') return null;
  if (Array.isArray(v) && v.length === 3 && v.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) return v.slice();
  const m = /^#?([0-9a-fA-F]{6})$/.exec(String(v));
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// MUGEN COUNTS IN TICKS; GIF COUNTS IN CENTISECONDS. A tick is 1/60s = 16.67ms,
// which is not a whole number of centiseconds, so rounding each frame on its own
// accumulates error - a 30-frame walk at 3 ticks a frame drifts by a tenth of a
// second, and a 1-tick frame rounds up by 20%.
//
// So the running TOTAL is rounded instead and each frame emits the difference.
// Frame delays are then individually approximate but the animation lasts as
// long as the engine plays it, which is the property worth having.
//
// NO FRAME UNDER 2cs, AND NONE PADDED UP TO IT. Browsers promote a delay under
// 2cs to 10cs, so 2 is the least any frame can be given - but flooring a 1cs
// frame to 2 made every all-1-tick action 20% slow (DongHwan #3020: 31 ticks,
// 517ms in the engine, 620ms as a GIF) because no longer frame was there to
// absorb the difference. Instead a run whose share of the total is under 2cs
// waits and is shown together with the runs after it, as ONE frame, until the
// slot reaches 2cs. The total then matches the engine's ticks to within a
// centisecond. A 1-tick run inside a steady 1-tick stream is simply not shown
// on its own - at 50 frames a second a GIF cannot show it.
//
// THE SLOT SHOWS THE RUN IT COVERS LONGEST; on a tie a drawn run beats a blank
// one, then the earliest wins. Showing the run it STARTED at looked neutral and was not: a
// 1-tick blank followed by a 75-tick pose made one 1.26s slot of nothing
// (sakura #4001), and when the only drawn run of an action was a 1-tick last
// element swallowed by a blank slot the whole export failed (cvsjill #6125).
// `opts.drawable(i)` says whether run i puts a picture on screen.
//
// THE FRAMES ARE THE ENGINE'S RUNS, not the .air's elements (airTimeline in
// animview-core.js). An element with time 0 is never drawn and gets no frame -
// it used to get a one-tick one - and a -1 only stops the animation when it is
// the LAST element; the old rule stopped on any negative time. When the engine
// holds, the held picture ends the GIF on a 2s beat before it loops, whatever
// the speed; it always keeps a frame of its own.
//
// And one ceiling: a GIF delay is a 16-bit field, so a run over 65535cs -
// makoto's 807,414,841-tick last element - would wrap to a short delay. It is
// written as 65535cs, and the time it lost is dropped from the running total
// so the next frame does not try to make it up.
//
// opts.speed: 1, 2 (half speed) or 4 (quarter) - each tick lasts that many
// times as long. opts.holdMs: the beat on a held last run (default 2s; the
// leaderboard keeps its board's own 900ms).
//
// Returns { slots: [{ run, runs, cs, last }], ms, speed }: `run` is the run
// whose picture the frame shows, `runs` every run it covers, `cs` its delay,
// `last` whether it is the held last run. Exported: the leaderboard extractor
// times its frames with exactly this.
const TICK_MS = 1000 / 60;
const HOLD_MS = 2000;
const GIF_MAX_CS = 65535;
function holdOf(o) { return o && Number.isFinite(o.holdMs) && o.holdMs > 0 ? o.holdMs : HOLD_MS; }
function gifSpeed(v) { const n = Number(v); return n === 2 || n === 4 ? n : 1; }
function gifTiming(tl, opts) {
  const speed = gifSpeed(opts && opts.speed);
  const holdMs = holdOf(opts);
  const drawable = opts && typeof opts.drawable === 'function' ? opts.drawable : () => true;
  const slots = [];
  let acc = 0, emitted = 0, pending = null;
  const n = tl.runs.length;
  // Time already counted but not yet written goes to the frame before it.
  const fold = () => {
    const prev = slots[slots.length - 1];
    const cs = Math.round(acc / 10) - emitted;
    if (prev) {
      prev.runs.push(...pending.runs);
      prev.cs = Math.min(GIF_MAX_CS, prev.cs + cs);
    } else {
      slots.push({ run: pending.run, runs: pending.runs, cs, last: false });
    }
    emitted += cs;
    pending = null;
  };
  for (let i = 0; i < n; i++) {
    const r = tl.runs[i];
    const hold = !!tl.hold && i === n - 1;
    if (hold && pending) fold();
    acc += hold ? holdMs : r.ticks * TICK_MS * speed;
    let cs = Math.round(acc / 10) - emitted;
    const slot = pending || { run: i, runs: [] };
    slot.runs.push(i);
    if (cs < 2 && !hold) { pending = slot; continue; }
    if (cs > GIF_MAX_CS) { acc -= (cs - GIF_MAX_CS) * 10; cs = GIF_MAX_CS; }
    emitted += cs;
    slots.push({ run: slot.run, runs: slot.runs, cs, last: hold });
    pending = null;
  }
  if (pending) fold();
  // The picture, once every slot has all its runs (fold() can still add some):
  // the most ticks, then a drawn run over a blank one, then the earliest.
  for (const s of slots) {
    if (s.runs.length < 2) continue;
    let best = s.runs[0];
    for (const i of s.runs) {
      const d = tl.runs[i].ticks - tl.runs[best].ticks;
      if (d > 0 || (d === 0 && drawable(i) && !drawable(best))) best = i;
    }
    s.run = best;
  }
  return { slots, ms: slots.reduce((t, s) => t + s.cs * 10, 0), speed };
}
// How long a timeline runs before it holds, or one pass of it when it loops -
// the engine's ticks, which is what the action list reports.
function timelineTicks(tl) {
  let t = 0;
  tl.runs.forEach((r, i) => { if (!(tl.hold && i === tl.runs.length - 1)) t += r.ticks; });
  return t;
}

// ONE GLOBAL COLOR TABLE when the action fits in one - the everyday case, and
// the smallest file. An action can mix a body frame (on the costume palette)
// with an effect frame (on its own), and those arrive with different 256-entry
// tables, so the tables are merged and the pixels remapped. Index 0 is the
// transparent (or background) color everywhere. Each item is { pal, used }:
// `used` marks the entries its pixels can show.
//
// Past 256 colors the answer is { over: true } and the caller writes each frame
// with its OWN table (a GIF local color table) instead of refusing: every frame
// is one sprite, and one sprite fits. Measured on the Main actions that used to
// be refused (cvsjill #8100, 272 colors; tomokaminato #2307, 4,722): written
// exactly, at 768 bytes a frame.
function mergePalettes(items) {
  const first = items.find((d) => d.pal);
  if (!first) return null;
  let uniform = true;
  for (const d of items) {
    if (d.pal && !d.pal.equals(first.pal)) { uniform = false; break; }
  }
  if (uniform) return { pal: first.pal, remaps: items.map(() => null) };

  const pal = Buffer.alloc(768);
  // Index 0 is reserved before anything else and never matched by color - two
  // frames whose color 0 differs must still both land on 0.
  const seen = new Map();
  let next = 1;
  const remaps = [];
  for (const d of items) {
    if (!d.pal) { remaps.push(null); continue; }
    const remap = new Uint8Array(256);
    for (let i = 1; i < 256; i++) {
      if (!d.used[i]) continue;
      const key = (d.pal[i * 3] << 16) | (d.pal[i * 3 + 1] << 8) | d.pal[i * 3 + 2];
      let at = seen.get(key);
      if (at === undefined) {
        if (next > 255) return { over: true };
        at = next++;
        pal[at * 3] = d.pal[i * 3];
        pal[at * 3 + 1] = d.pal[i * 3 + 1];
        pal[at * 3 + 2] = d.pal[i * 3 + 2];
        seen.set(key, at);
      }
      remap[i] = at;
    }
    remaps.push(remap);
  }
  return { pal, remaps };
}

// COLLISION BOXES, drawn by `set(x, y, which)` - which 0 = Clsn2, 1 = Clsn1,
// 2 = the axis cross - on a W x H canvas whose top left is (box.l, box.t) in
// .air space.
//
// The axis is the origin every Clsn coordinate is measured from: the
// character's position, (0,0) in .air space. The element's x/y offset moves
// the sprite only (anim.go:961, 1090); the engine draws and tests Clsn at the
// position plus size.draw.offset and the Offset controller
// (char.go:12820-12823, offsetX 10276-10282) - never the element offset. The
// frame's flip, scale and angle never touch the boxes either: Hscale, Xscale
// and Angle appear only in anim.go's draw code, and the boxes follow facing
// and the character's scale alone (char.go:7854-7875).
// Drawn AFTER the sprite, so a box is never painted over by the art it
// describes, and outline-only for the same reason it is in the viewer.
function drawClsn(box, W, H, f, set) {
  const put = (x, y, v) => { if (x >= 0 && y >= 0 && x < W && y < H) set(x, y, v); };
  const ax = 0 - box.l;
  const ay = 0 - box.t;
  const rect = (b, v) => {
    // .air writes a box head-first, so y1 is routinely the larger value;
    // normalizing both axes is what stops half of them drawing inside out.
    const rx0 = ax + Math.min(b.x1, b.x2), rx1 = ax + Math.max(b.x1, b.x2);
    const ry0 = ay + Math.min(b.y1, b.y2), ry1 = ay + Math.max(b.y1, b.y2);
    // CLAMP TO THE CANVAS, and remember which edges that moved.
    //
    // Drawing only the true perimeter meant a box LARGER than the frame
    // rendered nothing at all: ero_mukai's 3010 super is 640x340 against a
    // 141px canvas, so all four edges clipped away and the export showed only
    // the axis cross. The sprite is inside that hitbox, so the export has to
    // say so. Clamped edges are drawn DASHED - a solid line is the box ending,
    // a dashed one is the box carrying on past the frame.
    const x0 = Math.max(0, rx0), x1 = Math.min(W - 1, rx1);
    const y0 = Math.max(0, ry0), y1 = Math.min(H - 1, ry1);
    if (x1 < x0 || y1 < y0) return;            // nothing of it is in frame
    const dashV = (x, clipped) => {
      for (let y = y0; y <= y1; y++) { if (!clipped || ((y >> 1) & 1) === 0) put(x, y, v); }
    };
    const dashH = (y, clipped) => {
      for (let x = x0; x <= x1; x++) { if (!clipped || ((x >> 1) & 1) === 0) put(x, y, v); }
    };
    dashH(y0, ry0 < 0);
    dashH(y1, ry1 > H - 1);
    dashV(x0, rx0 < 0);
    dashV(x1, rx1 > W - 1);

    // A BOX THAT COVERS THE FRAME NEEDS TO SAY SO ON THE SPRITE.
    //
    // Clamped to the canvas, a 640x340 super hitbox becomes a 1px dashed line
    // hugging the border - correct, and almost invisible. A GIF is indexed
    // color, so there is no translucent fill to reach for; a sparse diagonal
    // stipple is the substitute, and deliberately sparse - one pixel in nine -
    // so it tints without hiding the pose. Only for boxes that swallow the
    // frame: stippling a normal box would turn a clear overlay into confetti.
    const covers = ((x1 - x0 + 1) * (y1 - y0 + 1)) / Math.max(1, W * H);
    if (covers > 0.8) {
      // ONE PIXEL IN NINE. Stepping x by 3 makes (x+y)%3 constant across a
      // row, so combining a step with a modulo test is redundant - the first
      // attempt did both and painted 34% of the canvas. Step BOTH axes by 3
      // and shift each row, which gives a real diagonal at 11%.
      for (let y = y0; y <= y1; y += 3) {
        for (let x = x0 + (((y / 3) | 0) % 3); x <= x1; x += 3) put(x, y, v);
      }
    }
  };
  for (const b of (f.clsn2 || [])) rect(b, 0);
  for (const b of (f.clsn1 || [])) rect(b, 1);
  for (let d = -4; d <= 4; d++) { put(ax + d, ay, 2); put(ax, ay + d, 2); }
}

// Nearest upscale by k, and a horizontal mirror, of a W x H canvas of `bpp`
// bytes per pixel.
function upscalePx(src, W, H, k, bpp) {
  if (k === 1) return src;
  const out = Buffer.alloc(W * k * H * k * bpp);
  const row = Buffer.alloc(W * k * bpp);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      for (let j = 0; j < k; j++) {
        for (let c = 0; c < bpp; c++) row[((x * k + j) * bpp) + c] = src[(y * W + x) * bpp + c];
      }
    }
    for (let j = 0; j < k; j++) row.copy(out, (y * k + j) * W * k * bpp);
  }
  return out;
}
function mirrorPx(src, W, H, bpp) {
  const out = Buffer.alloc(W * H * bpp);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      for (let c = 0; c < bpp; c++) out[(y * W + (W - 1 - x)) * bpp + c] = src[(y * W + x) * bpp + c];
    }
  }
  return out;
}

// EVERYTHING ONE ACTION'S PICTURES NEED, read once: the frames, the engine's
// timeline, each run's element, sprite and placement, and the canvas box.
// Returns { error } with the reason when nothing can be drawn.
//
// o: { loop, spritesFrom, pal, clsn, l, t, w, h, bg }
function prepareAction(mountAs, actionNo, o) {
  const got = loadActions(mountAs);
  if (!got) return { error: 'No readable .air for this character.' };
  // The looping part only, when asked for it. A walk cycle that carries its
  // step-off frames into a GIF snaps back to a standing pose every cycle.
  const sel = actionFrames(got.actions, actionNo, false);
  if (!sel) return { error: 'Action ' + actionNo + ' has no frames.' };
  const raw = sel.frames;
  const looped = !!o.loop && sel.loopStart > 0 && sel.loopStart < raw.length;

  // o.spritesFrom: this character's action drawn with ANOTHER character's
  // sprite file - the pair bench's scene, what ChangeAnim2 does (GRAIL 4.1).
  // Same rule as charAnim: geometry and pixels from her file.
  const spritesFrom = o.spritesFrom || null;
  const owner = spritesFrom || mountAs;
  const rec = charSff(owner);
  if (!rec) return { error: spritesFrom ? 'The sprite file of ' + spritesFrom + ' could not be read.' : 'No readable .sff for this character.' };
  const standIns = spritesFrom ? shippedStandIns(spritesFrom) : new Map();
  // THE ENGINE'S SPRITE LOOKUP (sffCore.spriteKey): a group or number of -1
  // is no sprite, any other negative wraps through uint16 (anim.go:700-702),
  // so -2 is sprite group 65534.
  const geom = raw.map((f0) => {
    const k0 = sffCore.spriteKey(f0.group, f0.index);
    if (!k0) return { none: true, group: f0.group, index: f0.index, w: 0, h: 0, axisX: 0, axisY: 0 };
    const sub = !sffDecode.spriteGeom(rec.sff, k0.group, k0.index) ? standIns.get(k0.key) : null;
    const group = sub ? sub[0] : k0.group, index = sub ? sub[1] : k0.index;
    const g = sffDecode.spriteGeom(rec.sff, group, index);
    return { group, index, w: g ? g.w : 0, h: g ? g.h : 0, axisX: g ? g.axisX : 0, axisY: g ? g.axisY : 0 };
  });
  // ONE PICTURE PER RUN OF THE ENGINE'S TIMELINE, the entry the panel plays
  // (airEntries): the full action from its start up to where the engine first
  // loops, or the loop the engine repeats - both over the whole action, with
  // its real Loopstart. A run is the element on screen - its offset, flip,
  // scale and blend (all read from the drawn element, anim.go:723-726) -
  // wearing the sprite the engine last loaded, with the boxes of the element
  // the engine tests on that tick; with no sprite loaded yet it is blank.
  const ent = airEntries(raw.map((f) => f.time), sel.loopStart);
  const tl = looped ? ent.loop : ent.full;
  if (!tl.runs.some((r) => r.spr >= 0)) return { error: 'The engine never draws this ' + (looped ? 'loop' : 'action') + ': every element it lands on has time 0.' };
  const notes = new Set();
  const runs = tl.runs.map((r) => {
    const e = raw[r.elem], s = r.spr >= 0 ? geom[r.spr] : null, c = raw[r.clsn !== undefined ? r.clsn : r.elem];
    const place = s && !s.none ? runPlacement(e, s) : null;
    if (place && e.angle) notes.add('angle not drawn');
    return { r, e, s, place, blend: place ? blendOf(e) : null, clsn1: c.clsn1, clsn2: c.clsn2 };
  });

  // NOTHING DRAWABLE, AND WHY. "Nothing drawable" alone left the reason to
  // guesswork, and the reasons need different answers: a -1 is invisible by
  // design, a sprite missing from this file is often another character's art
  // (partner and borrowed sprites - the pair bench draws those), and a scale
  // of 0 is the author hiding the frame.
  if (!runs.some((x) => x.place)) {
    const shown = runs.filter((x) => x.s);
    if (shown.every((x) => x.s.none)) return { error: 'Every element this action shows is sprite -1: it draws nothing, by design.' };
    const missing = [...new Set(shown.filter((x) => !x.s.none && !x.s.w).map((x) => x.s.group + ',' + x.s.index))];
    if (missing.length) {
      return { error: 'None of the sprites this action draws are in ' + (spritesFrom ? 'the sprite file of ' + spritesFrom : 'this character\'s sprite file')
        + ' (missing: ' + missing.slice(0, 3).join(' ') + (missing.length > 3 ? ' and ' + (missing.length - 3) + ' more' : '') + ').' };
    }
    return { error: 'Every element this action shows has a scale of 0, which the engine draws as nothing.' };
  }

  // The panel can hand over the box it is actually using, so what gets saved is
  // what was on screen. Falling back to computing it keeps the endpoint usable
  // on its own.
  let box = null;
  if (Number.isFinite(o.w) && Number.isFinite(o.h) && o.w > 0 && o.h > 0) {
    box = { l: o.l | 0, t: o.t | 0, w: Math.min(2048, o.w | 0), h: Math.min(2048, o.h | 0) };
  } else {
    box = animBox(runs.map((x) => x.place));
  }

  // GROW THE CANVAS TO FIT THE BOXES, when boxes are on.
  //
  // The canvas is sized to the SPRITE bounding box, which is the right frame for
  // the art and the wrong one for collision boxes: an attack reaches past the
  // arm that throws it. tomokaminato #980 overflows 115px to the right, so the
  // hitbox that matters - the one out in front - was clamped to a dashed line on
  // the border and its actual shape was lost. Clamping is the right answer for a
  // box that is hopelessly bigger than the frame; it is the wrong answer for one
  // that misses by a little, and "a little" is the common case.
  //
  // CAPPED AT TWICE THE SPRITE BOX per axis. Without a cap, ero_mukai's 640x340
  // screen-filling super would drag a 142px character into a 640px canvas and
  // make the GIF mostly empty space. Past the cap the clamp/dash/stipple path
  // takes over again, which is what that case actually wants.
  if (o.clsn) {
    let bl = Infinity, bt = Infinity, br = -Infinity, bb2 = -Infinity;
    for (const x of runs) {
      // Boxes sit on the axis, whatever the element offset (drawClsn), so
      // that is where the canvas has to reach.
      for (const arr of [x.clsn1, x.clsn2]) {
        for (const b of (arr || [])) {
          bl = Math.min(bl, Math.min(b.x1, b.x2));
          br = Math.max(br, Math.max(b.x1, b.x2));
          bt = Math.min(bt, Math.min(b.y1, b.y2));
          bb2 = Math.max(bb2, Math.max(b.y1, b.y2));
        }
      }
    }
    if (Number.isFinite(bl)) {
      const maxW = Math.min(2048, box.w * 2), maxH = Math.min(2048, box.h * 2);
      // One margin so an edge line is never flush against the border.
      const want = {
        l: Math.min(box.l, bl - 1), t: Math.min(box.t, bt - 1),
        r: Math.max(box.l + box.w, br + 2), b: Math.max(box.t + box.h, bb2 + 2),
      };
      const nw = want.r - want.l, nh = want.b - want.t;
      // Over the cap: keep the sprite box rather than a lopsided half-growth,
      // so the fallback rendering stays centered on the character.
      if (nw <= maxW && nh <= maxH) box = { l: want.l, t: want.t, w: nw, h: nh };
    }
  }
  return { owner, looped, tl, runs, box, notes, bg: parseBg(o.bg), pal: o.pal, sprites: new Map(), tables: new Map() };
}

// One run's sprite as the sprite route serves it (palette pick, palette alpha
// and all), decoded once per action: { kind: 'indexed', px, w, h, pal, alpha }
// or { kind: 'rgba', rgba, w, h } for truecolor art, or null.
function runSprite(ctx, s) {
  const key = s.group + ',' + s.index;
  if (ctx.sprites.has(key)) return ctx.sprites.get(key);
  const gif = gifLib();
  let d = null, png = null;
  try { png = spritePngFor(ctx.owner, s.group, s.index, ctx.pal); } catch (e) { png = null; }
  if (png && gif) {
    const ix = gif.decodeIndexedPng(png);
    if (ix) {
      let alpha = ix.alpha;
      if (!alpha) { alpha = new Uint8Array(256).fill(255); if (ix.trns >= 0) alpha[ix.trns] = 0; }
      d = { kind: 'indexed', px: ix.px, w: ix.w, h: ix.h, pal: ix.pal, alpha };
    } else if (gif.decodeAnyPng) {
      // TRUECOLOR (SFF v2 formats 11/12): the engine draws the texel with its
      // own alpha, so it is composed like any other pixel and the frame is
      // reduced to a color table afterwards (quantizeRgba).
      const any = gif.decodeAnyPng(png);
      if (any) d = { kind: 'rgba', rgba: any.rgba, w: any.w, h: any.h };
    }
  }
  ctx.sprites.set(key, d);
  return d;
}

// The palette through the color rules, entry by entry, for one sprite under
// one blend: kind/cov per entry, the transformed colors, and `used` - the
// entries its pixels can show. An entry that is drawn unchanged keeps its
// color byte for byte, so an opaque frame's table IS its palette. Index 0 is
// the transparent (or background) index of the GIF; in the rare palette that
// draws index 0 (a few screenpack v2.01 files) that color moves to an index
// the sprite leaves free.
function entryTable(ctx, s, d, bl) {
  const key = s.group + ',' + s.index + '|' + (bl ? bl.mode + bl.s + '/' + bl.d : '-');
  if (ctx.tables.has(key)) return ctx.tables.get(key);
  const bg = ctx.bg;
  const kind = new Uint8Array(256), cov = new Float32Array(256), rgb = Buffer.from(d.pal);
  const o = {};
  let partial = false;
  const inPx = new Uint8Array(256);
  for (let i = 0; i < d.px.length; i++) inPx[d.px[i]] = 1;
  for (let i = 0; i < 256; i++) {
    const a = d.alpha[i];
    shade(d.pal[i * 3], d.pal[i * 3 + 1], d.pal[i * 3 + 2], a, bl, bg, o);
    kind[i] = o.kind; cov[i] = o.cov;
    if (o.kind) { rgb[i * 3] = o.r; rgb[i * 3 + 1] = o.g; rgb[i * 3 + 2] = o.b; }
    if (inPx[i] && a > 0 && a < 255) partial = true;
  }
  let zeroTo = 0;
  if (kind[0] && inPx[0]) {
    for (let u = 1; u < 256; u++) if (!inPx[u]) { zeroTo = u; break; }
    if (zeroTo) { kind[zeroTo] = kind[0]; cov[zeroTo] = cov[0]; rgb.copy(rgb, zeroTo * 3, 0, 3); }
  }
  kind[0] = 0;
  if (bg) { rgb[0] = bg[0]; rgb[1] = bg[1]; rgb[2] = bg[2]; }
  const used = new Uint8Array(256);
  for (let i = 1; i < 256; i++) if (inPx[i] && kind[i]) used[i] = 1;
  if (zeroTo) used[zeroTo] = 1;
  const t = { kind, cov, rgb, used, zeroTo, partial };
  ctx.tables.set(key, t);
  return t;
}

// Which texel column/row each canvas column/row shows, -1 for none (the
// sampling rule at the top of the composer). texW/texH are the decoded
// picture's size, stretched over the sprite's quad when the two differ, as
// the engine stretches a PNG whose bounds disagree with its header.
function sampleMaps(p, box, W, H, texW, texH) {
  const cols = new Int32Array(W).fill(-1), rows = new Int32Array(H).fill(-1);
  const x0 = Math.max(0, Math.floor(p.l) - box.l), x1 = Math.min(W, Math.ceil(p.r) - box.l);
  for (let x = x0; x < x1; x++) {
    const c = Math.floor(p.ax + (box.l + x + 0.5 - p.X) / p.sx);
    if (c >= 0 && c < p.w) cols[x] = texW === p.w ? c : Math.min(texW - 1, Math.floor(c * texW / p.w));
  }
  const y0 = Math.max(0, Math.floor(p.t) - box.t), y1 = Math.min(H, Math.ceil(p.b) - box.t);
  for (let y = y0; y < y1; y++) {
    const r = Math.floor(p.ay + (box.t + y + 0.5 - p.Y) / p.sy);
    if (r >= 0 && r < p.h) rows[y] = texH === p.h ? r : Math.min(texH - 1, Math.floor(r * texH / p.h));
  }
  return { cols, rows, x0: Math.max(0, x0), x1: Math.max(x0, x1), y0: Math.max(0, y0), y1: Math.max(y0, y1) };
}

// ONE RUN ON THE CANVAS.
//   mode 'gif': the picture the GIF and the still show, color rules applied -
//     { kind: 'indexed', px, pal, used } with px indexing pal (0 = transparent
//     or the background), or { kind: 'rgba', rgba } for truecolor art (alpha
//     0 or 255 by then), or { kind: 'blank' };
//   mode 'raw': geometry only, for the leaderboard art - { kind: 'indexed',
//     px, pal, alpha } with the sprite's own indices, or { kind: 'rgba', rgba }
//     with straight alpha, or { kind: 'blank' }.
function composeRun(ctx, i, mode) {
  const x = ctx.runs[i];
  const W = ctx.box.w, H = ctx.box.h;
  if (!x.place) return { kind: 'blank' };
  const d = runSprite(ctx, x.s);
  if (!d) return { kind: 'blank' };
  const bg = mode === 'raw' ? null : ctx.bg;
  const m = sampleMaps(x.place, ctx.box, W, H, d.w, d.h);
  const bl = x.blend;
  if (bl && !bg && mode !== 'raw' && bl.cat !== 'dim') ctx.notes.add('blended frames approximated on transparent');
  if (d.kind === 'indexed') {
    const px = Buffer.alloc(W * H);
    if (mode === 'raw') {
      for (let y = m.y0; y < m.y1; y++) {
        const r = m.rows[y];
        if (r < 0) continue;
        for (let xx = m.x0; xx < m.x1; xx++) {
          const c = m.cols[xx];
          if (c >= 0) px[y * W + xx] = d.px[r * d.w + c];
        }
      }
      return { kind: 'indexed', px, pal: d.pal, alpha: d.alpha };
    }
    const t = entryTable(ctx, x.s, d, bl);
    if (t.partial && !bg) ctx.notes.add('see-through colors thresholded on transparent');
    for (let y = m.y0; y < m.y1; y++) {
      const r = m.rows[y];
      if (r < 0) continue;
      for (let xx = m.x0; xx < m.x1; xx++) {
        const c = m.cols[xx];
        if (c < 0) continue;
        const v = d.px[r * d.w + c];
        const k = t.kind[v === 0 ? t.zeroTo : v];
        if (!k) continue;
        if (k === 2 && !(t.cov[v === 0 ? t.zeroTo : v] > bayerAt(xx, y))) continue;
        px[y * W + xx] = v === 0 ? t.zeroTo : v;
      }
    }
    return { kind: 'indexed', px, pal: t.rgb, used: t.used };
  }
  // truecolor
  const rgba = Buffer.alloc(W * H * 4);
  if (bg) for (let n = 0; n < W * H; n++) { rgba[n * 4] = bg[0]; rgba[n * 4 + 1] = bg[1]; rgba[n * 4 + 2] = bg[2]; rgba[n * 4 + 3] = 255; }
  const o = {};
  let partial = false;
  for (let y = m.y0; y < m.y1; y++) {
    const r = m.rows[y];
    if (r < 0) continue;
    for (let xx = m.x0; xx < m.x1; xx++) {
      const c = m.cols[xx];
      if (c < 0) continue;
      const si = (r * d.w + c) * 4, di = (y * W + xx) * 4;
      if (mode === 'raw') { d.rgba.copy ? d.rgba.copy(rgba, di, si, si + 4) : rgba.set(d.rgba.subarray(si, si + 4), di); continue; }
      const a = d.rgba[si + 3];
      if (a > 0 && a < 255) partial = true;
      shade(d.rgba[si], d.rgba[si + 1], d.rgba[si + 2], a, bl, bg, o);
      if (!o.kind) continue;
      if (o.kind === 2 && !(o.cov > bayerAt(xx, y))) continue;
      rgba[di] = o.r; rgba[di + 1] = o.g; rgba[di + 2] = o.b; rgba[di + 3] = 255;
    }
  }
  if (partial && !bg) ctx.notes.add('see-through colors thresholded on transparent');
  return { kind: 'rgba', rgba };
}

// THE PICTURES, READY TO WRITE: palettes decided, boxes drawn, then mirrored
// and upscaled. `pics` are composeRun('gif') results, `runsOf[k]` the run whose
// boxes picture k shows. With `still`, a truecolor picture with more colors
// than a table holds stays RGBA (the still is written as an RGBA PNG) instead
// of being reduced.
// Returns { frames: [{ px, pal? } | { rgba }], globalPal, W, H, k, box }:
// a frame with `pal` carries its own (local) table, the others use globalPal.
function finishFrames(ctx, pics, runsOf, o, still) {
  const gif = gifLib();
  const box = ctx.box, W = box.w, H = box.h, bg = ctx.bg;
  const withBoxes = !!o.clsn;
  const frames = pics.map((p) => ({ src: p, px: null, pal: null, rgba: null }));

  // Truecolor: its own table, reduced to at most 255 colors (252 with boxes
  // on, so three are always free for them). Exact when the frame has that
  // few, which most truecolor art does.
  const maxColors = withBoxes ? 252 : 255;
  for (const fr of frames) {
    if (fr.src.kind !== 'rgba') continue;
    if (still) {
      const seen = new Set();
      for (let n = 0; n < W * H && seen.size <= maxColors; n++) {
        if (fr.src.rgba[n * 4 + 3] >= 128) seen.add((fr.src.rgba[n * 4] << 16) | (fr.src.rgba[n * 4 + 1] << 8) | fr.src.rgba[n * 4 + 2]);
      }
      if (seen.size > maxColors) { fr.rgba = Buffer.from(fr.src.rgba); continue; }
    }
    const q = gif.quantizeRgba(fr.src.rgba, W, H, { maxColors });
    if (!q.exact) ctx.notes.add('truecolor reduced to 256 colors per frame');
    fr.px = Buffer.from(q.px);
    fr.pal = Buffer.from(q.pal);
    if (bg) { fr.pal[0] = bg[0]; fr.pal[1] = bg[1]; fr.pal[2] = bg[2]; }
  }

  // Indexed: one shared table when they fit, their own tables when not.
  const idx = frames.filter((fr) => fr.src.kind === 'indexed');
  let globalPal = null;
  if (idx.length) {
    const m = mergePalettes(idx.map((fr) => fr.src));
    if (m && !m.over) {
      globalPal = m.pal;
      idx.forEach((fr, k) => {
        const remap = m.remaps[k];
        if (!remap) { fr.px = fr.src.px; return; }
        const px = Buffer.alloc(fr.src.px.length);
        for (let n = 0; n < px.length; n++) px[n] = remap[fr.src.px[n]];
        fr.px = px;
      });
      if (bg) { globalPal = Buffer.from(globalPal); globalPal[0] = bg[0]; globalPal[1] = bg[1]; globalPal[2] = bg[2]; }
    } else {
      for (const fr of idx) { fr.px = fr.src.px; fr.pal = Buffer.from(fr.src.pal); }
    }
  }
  // A blank frame (nothing drawn on that run) is all index 0 - on the shared
  // table, or on a neighbor's when every frame has its own.
  const blankPal = () => {
    const near = frames.find((f) => f.pal);
    const p = near ? Buffer.from(near.pal) : Buffer.alloc(768);
    if (bg) { p[0] = bg[0]; p[1] = bg[1]; p[2] = bg[2]; }
    return p;
  };
  for (const fr of frames) {
    if (fr.src.kind !== 'blank') continue;
    fr.px = Buffer.alloc(W * H);
    if (!globalPal) fr.pal = blankPal();
  }
  if (!frames.some((fr) => fr.px && !fr.pal)) globalPal = null;

  // COLLISION BOXES, when the panel had them on. A GIF is indexed color, so
  // the boxes need palette entries of their own: this scans the composed
  // frames for indices NOTHING uses and claims three - a sprite whose palette
  // declares 256 colors usually paints with far fewer. On the shared table
  // that is three free across every frame; when the shared table has no room
  // the frames take their own copies of it, where far more is free (the union
  // of an action's colors is the tight spot, not any one frame). A frame with
  // no three free anywhere is written without its boxes and the notes say so:
  // a silently recolored sprite would be far worse than a missing overlay.
  if (withBoxes) {
    const freeOf = (list) => {
      const used = new Uint8Array(256);
      for (const fr of list) for (let n = 0; n < fr.px.length; n++) used[fr.px[n]] = 1;
      used[0] = 1;                                // transparent / background
      const free = [];
      for (let n = 1; n < 256 && free.length < 3; n++) if (!used[n]) free.push(n);
      return free;
    };
    const setColors = (pal, free) => { free.forEach((n, w) => { pal[n * 3] = CLSN_RGB[w][0]; pal[n * 3 + 1] = CLSN_RGB[w][1]; pal[n * 3 + 2] = CLSN_RGB[w][2]; }); };
    const onGlobal = frames.filter((fr) => fr.px && !fr.pal);
    if (globalPal && onGlobal.length) {
      const free = freeOf(onGlobal);
      if (free.length >= 3) {
        // The table may be a sprite's own buffer, shared with the sprite
        // cache - copy before writing into it.
        globalPal = Buffer.from(globalPal);
        setColors(globalPal, free);
        onGlobal.forEach((fr) => { const k = frames.indexOf(fr); drawClsn(box, W, H, ctx.runs[runsOf[k]], (x, y, v) => { fr.px[y * W + x] = free[v]; }); });
      } else {
        for (const fr of onGlobal) fr.pal = Buffer.from(globalPal);
        globalPal = null;
      }
    }
    frames.forEach((fr, k) => {
      const f = ctx.runs[runsOf[k]];
      if (fr.rgba) {
        drawClsn(box, W, H, f, (x, y, v) => { const n = (y * W + x) * 4; fr.rgba[n] = CLSN_RGB[v][0]; fr.rgba[n + 1] = CLSN_RGB[v][1]; fr.rgba[n + 2] = CLSN_RGB[v][2]; fr.rgba[n + 3] = 255; });
        return;
      }
      if (!fr.pal) return;
      const free = freeOf([fr]);
      if (free.length < 3) { ctx.notes.add('boxes left out: no free palette color'); return; }
      fr.pal = Buffer.from(fr.pal);
      setColors(fr.pal, free);
      fr.px = Buffer.from(fr.px);
      drawClsn(box, W, H, f, (x, y, v) => { fr.px[y * W + x] = free[v]; });
    });
  }

  // FACING -1 mirrors the whole picture, boxes included - the engine's
  // facing -1 mirrors everything about the axis, offsets and boxes too
  // (the facing sign on the draw scale, char.go:13033-13042, and on the
  // boxes, char.go:7854-7875), which on a canvas is a horizontal flip; the
  // box it sits in moves to the other side of the axis. THEN the size:
  // nearest-neighbor by a whole number, the boxes drawn at 1x first so they
  // thicken with the art. Clamped so neither side passes 2048 pixels.
  //
  // Both are applied by `out(frame)`, ONE FRAME AT A TIME as the file is
  // written, not here: a long action held at 4x all at once is sixteen times
  // the memory of the 1x frames, which for a thousand-frame action is
  // gigabytes. The frames returned are 1x; `out` gives the final pixels.
  let k = Number.isInteger(o.scale) && o.scale >= 1 && o.scale <= 4 ? o.scale : 1;
  const kMax = Math.max(1, Math.min(Math.floor(2048 / W), Math.floor(2048 / H)));
  if (k > kMax) { ctx.notes.add('size limited to ' + kMax + 'x by the 2048-pixel canvas'); k = kMax; }
  const facing = Number(o.facing) === -1 ? -1 : 1;
  const out = (fr) => {
    const bpp = fr.rgba ? 4 : 1;
    let b = fr.rgba || fr.px;
    if (facing < 0) b = mirrorPx(b, W, H, bpp);
    return upscalePx(b, W, H, k, bpp);
  };
  const outBox = facing < 0 ? { l: -(box.l + box.w), t: box.t, w: box.w, h: box.h } : box;
  return { frames, globalPal, W: W * k, H: H * k, k, box: outBox, out };
}

// THE ACTION AS A GIF.
//
// opts (all optional):
//   loop         the looping part only (from Loopstart)
//   spritesFrom  draw with another character's sprite file (the pair bench)
//   pal          a palette slot
//   clsn         draw the collision boxes and the axis cross
//   l, t, w, h   the panel's box, so the file is what was on screen
//   scale        1-4, nearest upscale (clamped to a 2048px canvas)
//   bg           'rrggbb' solid background; absent = transparent
//   speed        1, 2 (half) or 4 (quarter)
//   facing       -1 mirrors the whole picture (the engine's facing left)
// -> { buf, frames, w, h, ms, held, looped, scale, notes } or { error }.
// `notes` says what the file could not draw as the engine does.
function charAnimGif(mountAs, actionNo, opts) {
  const gif = gifLib();
  if (!gif) return { error: 'GIF export is not part of this build.' };
  const o = opts || {};
  const ctx = prepareAction(mountAs, actionNo, o);
  if (ctx.error) return ctx;
  const timing = gifTiming(ctx.tl, Object.assign({}, o, { drawable: (i) => !!ctx.runs[i].place }));
  const pics = timing.slots.map((sl) => composeRun(ctx, sl.run, 'gif'));
  if (!pics.some((p) => p.kind !== 'blank')) return { error: 'None of this action\'s frames could be decoded.' };
  const fin = finishFrames(ctx, pics, timing.slots.map((sl) => sl.run), o, false);

  // IDENTICAL NEIGHBORS BECOME ONE FRAME with their delays summed - a quarter
  // of the bytes of every GIF in the Main sweep were frames equal to the one
  // before (tomokaminato #8810: fifteen identical 1244x1005 frames, 5.6 MB).
  // Lossless: the same picture for the same total time. Compared at 1x -
  // mirroring and upscaling cannot make two different frames equal or two
  // equal ones different - and each kept frame is only mirrored and upscaled
  // (fin.out) when the encoder asks for its pixels.
  const out = [];
  fin.frames.forEach((fr, i) => {
    const prev = out[out.length - 1];
    const cs = timing.slots[i].cs;
    if (o.mergeIdentical !== false && prev && prev.delayCs + cs <= GIF_MAX_CS && prev.fr.px.equals(fr.px)
      && ((!prev.fr.pal && !fr.pal) || (prev.fr.pal && fr.pal && prev.fr.pal.equals(fr.pal)))) {
      prev.delayCs += cs;
      return;
    }
    const f = { fr, w: fin.W, h: fin.H, x: 0, y: 0, delayCs: cs, get px() { return fin.out(fr); } };
    if (fr.pal) f.pal = fr.pal;
    out.push(f);
  });
  const buf = gif.encodeGif(fin.W, fin.H, fin.globalPal, out, ctx.bg ? -1 : 0);
  const lastSlot = timing.slots[timing.slots.length - 1];
  return {
    buf,
    frames: out.length,
    w: fin.W,
    h: fin.H,
    ms: timing.ms,
    held: !!(lastSlot && lastSlot.last),
    looped: ctx.looped,
    scale: fin.k,
    notes: [...ctx.notes],
  };
}

// ONE RUN AS A PNG - the frame on screen, with the GIF's options (scale, bg,
// facing, boxes, palette). `runIndex` counts the runs of the entry the panel
// plays (airEntries: the full action, or its loop with loop=1), from 0. An
// indexed PNG, index 0 transparent unless there is a background; RGBA only for
// truecolor art with more colors than a table holds.
// -> { png, w, h, ms, scale, notes, kind: 'indexed' | 'rgba' } or { error }.
function charAnimStill(mountAs, actionNo, runIndex, opts) {
  const gif = gifLib();
  if (!gif) return { error: 'GIF export is not part of this build.' };
  const o = opts || {};
  const ctx = prepareAction(mountAs, actionNo, o);
  if (ctx.error) return ctx;
  const n = Number(runIndex);
  if (!Number.isInteger(n) || n < 0 || n >= ctx.runs.length) {
    return { error: 'This entry has ' + ctx.runs.length + ' frame' + (ctx.runs.length === 1 ? '' : 's') + '; there is no frame ' + runIndex + '.' };
  }
  const fin = finishFrames(ctx, [composeRun(ctx, n, 'gif')], [n], o, true);
  const fr = fin.frames[0];
  const png = fr.rgba
    ? sffDecode.encodeRgbaPng(fin.out(fr), fin.W, fin.H)
    : sffDecode.encodeIndexedPng(fin.out(fr), fin.W, fin.H, fr.pal || fin.globalPal, ctx.bg ? new Uint8Array(256).fill(255) : undefined);
  const held = !!ctx.tl.hold && n === ctx.runs.length - 1;
  return {
    png, w: fin.W, h: fin.H, scale: fin.k, notes: [...ctx.notes], kind: fr.rgba ? 'rgba' : 'indexed', looped: ctx.looped,
    ms: Math.round(held ? holdOf(o) : ctx.runs[n].r.ticks * TICK_MS * gifSpeed(o.speed)),
  };
}

// THE RUNS, COMPOSED, FOR THE LEADERBOARD ART (tools/extract-charart.js), so
// the extractor never places or colors a pixel itself.
//
// opts: loop, spritesFrom, pal, l/t/w/h as for the GIF, and `board`: also bake
// each run into straight-alpha RGBA for a dark page (boardShade).
// -> { action, looped, held, box, ms, notes,
//      runs: [{ run, elem, ticks, ms, held, group, index, kind, w, h, blend,
//               px, pal, alpha        (kind 'indexed': the sprite's own indices on
//                                      the box-sized canvas, 0 = nothing; its
//                                      palette; each entry's alpha)
//               rgba                  (kind 'rgba': straight alpha)
//               board }],             (with opts.board, kind != 'blank')
//      slots,                          gifTiming's slots
//      frames: [{ run, cs }] }         the slots with identical neighbors joined -
//                                      the GIF's own frames and delays
// Geometry (flip, scale, offset) is baked into every picture; the blend and the
// palette alpha are not - `blend` ({ mode, src, dst, s, d }, s/d after
// alphaToBlend) and `alpha` say what they are, and `board` has them applied.
function charAnimRuns(mountAs, actionNo, opts) {
  const gif = gifLib();
  if (!gif) return { error: 'GIF export is not part of this build.' };
  const o = Object.assign({}, opts || {}, { bg: null, clsn: false });
  const ctx = prepareAction(mountAs, actionNo, o);
  if (ctx.error) return ctx;
  const timing = gifTiming(ctx.tl, Object.assign({}, o, { drawable: (i) => !!ctx.runs[i].place }));
  const speed = gifSpeed(o.speed);
  const W = ctx.box.w, H = ctx.box.h;
  const tmp = {};
  const runs = ctx.runs.map((x, i) => {
    const pic = composeRun(ctx, i, 'raw');
    const held = !!ctx.tl.hold && i === ctx.runs.length - 1;
    const r = {
      run: i, elem: x.r.elem, ticks: x.r.ticks, ms: held ? holdOf(o) : x.r.ticks * TICK_MS * speed, held,
      group: x.place ? x.s.group : null, index: x.place ? x.s.index : null,
      kind: pic.kind, w: W, h: H,
      blend: x.blend ? { mode: x.blend.mode, src: x.blend.src, dst: x.blend.dst, s: x.blend.s, d: x.blend.d } : null,
    };
    if (pic.kind === 'indexed') { r.px = pic.px; r.pal = pic.pal; r.alpha = pic.alpha; }
    else if (pic.kind === 'rgba') r.rgba = pic.rgba;
    if (o.board && pic.kind !== 'blank') {
      const board = Buffer.alloc(W * H * 4);
      for (let n = 0; n < W * H; n++) {
        let cr, cg, cb, a;
        if (pic.kind === 'indexed') { const v = pic.px[n]; if (!v) continue; cr = pic.pal[v * 3]; cg = pic.pal[v * 3 + 1]; cb = pic.pal[v * 3 + 2]; a = pic.alpha[v]; }
        else { cr = pic.rgba[n * 4]; cg = pic.rgba[n * 4 + 1]; cb = pic.rgba[n * 4 + 2]; a = pic.rgba[n * 4 + 3]; }
        if (!a) continue;
        boardShade(cr, cg, cb, a, x.blend, tmp);
        if (!tmp.a) continue;
        board[n * 4] = tmp.r; board[n * 4 + 1] = tmp.g; board[n * 4 + 2] = tmp.b; board[n * 4 + 3] = tmp.a;
      }
      r.board = board;
    }
    return r;
  });
  const same = (a, b) => a.kind === b.kind && JSON.stringify(a.blend) === JSON.stringify(b.blend)
    && (a.kind === 'blank' || (a.kind === 'rgba' ? a.rgba.equals(b.rgba)
      : a.px.equals(b.px) && a.pal.equals(b.pal) && Buffer.from(a.alpha).equals(Buffer.from(b.alpha))));
  const frames = [];
  for (const sl of timing.slots) {
    const prev = frames[frames.length - 1];
    if (prev && prev.cs + sl.cs <= GIF_MAX_CS && same(runs[prev.run], runs[sl.run])) { prev.cs += sl.cs; continue; }
    frames.push({ run: sl.run, cs: sl.cs });
  }
  const lastSlot = timing.slots[timing.slots.length - 1];
  return {
    action: actionNo, looped: ctx.looped, held: !!(lastSlot && lastSlot.last), box: ctx.box, ms: timing.ms,
    notes: [...ctx.notes], runs, slots: timing.slots, frames,
  };
}

// ---- THE LEADERBOARD'S WIN POSE, chosen in the animation panel -------------
//
// WHETHER THIS BUNDLE MAKES LEADERBOARD ART - one rule for the Website
// export's art step, the Studio's Make button and this pose choice:
//   - the extractor is here, and the encoder every picture is drawn with
//     (tools/gif.js; the extractor refuses without it). The legacy kit has
//     neither, so it never makes art and never offers a pose;
//   - and the bundle has a leaderboard: an address in Settings > Online. The
//     art exists for the board, and a bundle with no leaderboard has none.
// The author's Main has an address, so it makes art on every private export
// as it always has; since 2026-09-28 so does any bundle a host gives one,
// in a shareable copy too. Only a file check for the extractor - requiring it
// would load it for nothing.
function boardArtTool() {
  return fs.existsSync(path.join(__dirname, 'tools', 'extract-charart.js')) && !!gifLib();
}
function canBoardArt(roster) {
  if (!boardArtTool()) return false;
  let r = roster;
  if (!r) { try { r = readRoster(); } catch (e) { return false; } }
  return !!(r && typeof r.identityUrl === 'string' && r.identityUrl.trim());
}
// What a roster entry asks the extractor for: { action, pal }, null = its own
// choice (the engine's win path; the default colors).
function boardArtOfEntry(c) {
  return {
    action: c && Number.isInteger(c.winAction) ? c.winAction : null,
    pal: c && Number.isInteger(c.defaultPal) ? c.defaultPal : null,
  };
}
// null for a character that is not in the build: the Characters tab also
// opens characters that are only on disk, and those have no board to be on.
function boardArtFor(mountAs) {
  let roster;
  try { roster = readRoster(); } catch (e) { return null; }
  const c = rosterCharOf(roster, mountAs);
  return c ? boardArtOfEntry(c) : null;
}
// THE STUDIO SAVES THE WHOLE ROSTER FROM ITS OWN SNAPSHOT (POST /api/roster),
// taken when the page last refreshed. A pose chosen after that - in the panel
// or the pop-out, through setBoardArt - is not in the snapshot, so the next
// stage, music or order change wrote the roster back without it. The two
// keys only ever change through setBoardArt, so a save that leaves them out
// keeps what the file on disk has.
function carryBoardArt(chars, onDisk) {
  if (!Array.isArray(chars) || !onDisk || !Array.isArray(onDisk.chars)) return chars;
  return chars.map((c) => {
    if (!c || (c.winAction !== undefined && c.defaultPal !== undefined)) return c;
    const d = rosterCharOf(onDisk, c.mountAs || c.folder);
    if (!d || (d.folder !== c.folder)) return c;
    const out = Object.assign({}, c);
    if (out.winAction === undefined && Number.isInteger(d.winAction)) out.winAction = d.winAction;
    if (out.defaultPal === undefined && Number.isInteger(d.defaultPal)) out.defaultPal = d.defaultPal;
    return out;
  });
}
// art = { action, pal }: a number sets it, null clears it, a key left out
// stays as it is; art = null clears both. Stored as the roster keys the
// extractor reads (winAction, defaultPal - both on CHAR_PERSIST), and checked
// against the character first: an action with no frames, or a palette slot it
// does not have, would only make the next export quietly fall back.
function setBoardArt(mountAs, art) {
  if (!boardArtTool()) throw new Error('leaderboard art is not part of this build');
  const roster = readRoster();
  if (!canBoardArt(roster)) throw new Error('this bundle has no leaderboard - set its address in Settings > Online first');
  const c = rosterCharOf(roster, mountAs);
  if (!c) throw new Error('not in build: ' + mountAs);
  const a = art === null ? { action: null, pal: null } : (art || {});
  const want = (v) => (v === undefined ? undefined : v === null || v === '' ? null : Number(v));
  const action = want(a.action), pal = want(a.pal);
  if (action !== undefined && action !== null) {
    if (!Number.isInteger(action) || action < 0 || action > 2147483647) throw new Error('an action is a whole number, 0 or more');
    const got = loadActions(mountAs);
    const frames = got && got.actions[action];
    if (!frames || !frames.length) throw new Error('this character has no action ' + action);
  }
  if (pal !== undefined && pal !== null) {
    if (!Number.isInteger(pal) || pal < 1 || pal > 9999) throw new Error('a palette slot is a whole number from 1');
    const info = charPalettes(mountAs);
    if (!info || !info.palettes.some((p) => p.slot === pal)) throw new Error('this character has no palette ' + pal);
  }
  if (action === null) delete c.winAction; else if (action !== undefined) c.winAction = action;
  if (pal === null) delete c.defaultPal; else if (pal !== undefined) c.defaultPal = pal;
  roster.chars = roster.chars.map(cleanChar);
  writeRoster(roster);
  return boardArtOfEntry(c);
}

// Frames of one action, optionally only the part that repeats. `loopStart` is
// where the engine jumps back to, so everything before it plays once on entry
// and is exactly what you do NOT want in a looping GIF.
function actionFrames(actions, actionNo, loopOnly) {
  const all = actions[actionNo];
  if (!all || !all.length) return null;
  const ls = Number.isFinite(all.loopStart) ? all.loopStart : 0;
  const frames = (loopOnly && ls > 0 && ls < all.length) ? all.slice(ls) : all;
  return { frames, loopStart: ls, looped: loopOnly && ls > 0 && ls < all.length };
}

// ---- A CHARACTER WHOSE OWN BODY IS INVISIBLE (2026-10-19) ------------------
//
// Some WinMUGEN-era characters never draw their own body. Grim Reaper Mai
// (made in VirtualTek Fighter): her .air has 20,168 actions, 141 with any
// sprite, and action 0 and every standard action are one `-1` frame; her body
// is a HELPER that her common state file sends to her stance -
// `type=ChangeAnim / trigger1=ishelper(22) / value=44000` - and 44000 draws
// sprite group 0. So the Properties player opened on a blank stage and said
// nothing about why.
//
// When action 0 exists and none of its frames draws a sprite the file has,
// this finds the body the game shows: a ChangeAnim/ChangeAnim2 in the state
// files the .def names (st, stN, cmd, cns and the character's own stcommon,
// resolved from [Files] - never a folder glob; an engine file is skipped)
// that only a helper can fire (its triggerall, or every live trigger group,
// needs ishelper / ishelper(N)) and whose value is a literal action that draws. Preferred: one whose first frame is sprite group
// 0 (the stance group). Else the first action whose frames draw group 0, else
// the first helper candidate, else the first action that draws at all - those
// two say so without naming a helper. A character whose action 0 draws (every
// normal one) gets null and nothing is read beyond the .air already parsed.
//
// Cached per character on the stamps of the .def, the .air, the sprite file
// and every state file read: her state files are 3.9 MB, read once.
const BODY_CACHE = new Map();
const BODY_CACHE_MAX = 64;
// Whether one .air action draws anything: a frame naming a sprite the file
// has, with a size (the engine wraps negative numbers through uint16; -1 is
// no sprite at all - sffCore.spriteKey).
function actionDraws(frames, sff, onlyGroup) {
  if (!frames || !frames.length || !sff) return false;
  for (const f of frames) {
    const k = sffCore.spriteKey(f.group, f.index);
    if (!k || (onlyGroup !== undefined && k.group !== onlyGroup)) continue;
    if (!sff.byKey || !sff.byKey.has(k.key)) continue;
    const g = sffDecode.spriteGeom(sff, k.group, k.index);
    if (g && g.w > 0 && g.h > 0) return true;
  }
  return false;
}
// The state files the engine loads for this .def that live in the character's
// folder, plus the constants file (it can hold states too). [{ rel, abs }]
function bodyStateFiles(dir, defName) {
  const defDir = path.posix.dirname(String(defName).replace(/\\/g, '/'));
  const resolve = (r) => {
    const v = String(r || '').replace(/\\/g, '/').trim();
    if (!v) return null;
    return resolveCI(dir, defDir === '.' ? v : defDir + '/' + v) || resolveCI(dir, v);
  };
  const out = [];
  const seen = new Set();
  const add = (abs) => { if (abs && !seen.has(abs.toLowerCase())) { seen.add(abs.toLowerCase()); out.push({ rel: path.relative(dir, abs).replace(/\\/g, '/'), abs }); } };
  let list = [];
  try { list = scenelib.stateFiles(dir, defName, resolve); } catch (e) { list = []; }
  for (const f of list) add(f.abs);
  // cns: the first [Files] section's own key, as stateFiles reads it
  try {
    const text = fs.readFileSync(path.join(dir, defName), 'latin1');
    let inFiles = false;
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.replace(/;.*$/, '').trim();
      if (/^\[/.test(line)) { if (inFiles) break; inFiles = /^\[\s*files\s*\]/i.test(line); continue; }
      const m = inFiles && /^cns\s*=\s*(.+)$/i.exec(line);
      if (m) { add(resolve(m[1].replace(/"/g, '').trim())); break; }
    }
  } catch (e) { /* no def text: the list above stands */ }
  return out;
}
// ChangeAnim/ChangeAnim2 controllers ONLY a helper can fire, in file order:
// [{ action, helper, rel, line }]. Only a helper: the triggerall needs
// ishelper, or EVERY live trigger group does (a dead group such as
// `trigger3 = 0` never fires and does not count) - the rule movelib
// helperRunStates uses. `trigger1 = ishelper(5)` beside `trigger2 = 1` is a
// controller the root fires too, so it does not count.
function helperChangeAnims(files) {
  const out = [];
  for (const f of files) {
    let text;
    try { text = fs.readFileSync(f.abs, 'latin1'); } catch (e) { continue; }
    if (!/changeanim/i.test(text) || !/ishelper/i.test(text)) continue;
    const lines = text.split(/\r?\n/);
    let ctl = null;
    const finish = () => {
      if (!ctl || !/^changeanim2?$/.test(ctl.type || '') || ctl.value === undefined) return;
      if (!/^-?\d+$/.test(ctl.value)) return;                  // a literal action only
      const all = ctl.trig.get('all') || [];
      if (all.some((e) => e === '0')) return;                  // triggerall = 0 never fires
      let need = null;
      for (const e of all) { need = need || scenelib.ishelperNeed(e); }
      if (!need) {
        const needs = [];
        for (const [k, exprs] of ctl.trig) {
          if (k === 'all' || exprs.some((e) => e === '0')) continue;   // a dead group
          let g = null;
          for (const e of exprs) { g = g || scenelib.ishelperNeed(e); }
          needs.push(g);
        }
        // every live group, and the helper named only when they all name the same one
        if (needs.length && needs.every(Boolean)) {
          const ids = new Set(needs.map((n) => n.id));
          need = { id: ids.size === 1 ? needs[0].id : null };
        }
      }
      if (need) out.push({ action: Number(ctl.value), helper: need.id, rel: f.rel, line: ctl.line });
    };
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].replace(/;.*$/, '').trim();
      if (!line) continue;
      if (line[0] === '[') {
        finish();
        ctl = /^\[\s*state(?!def)/i.test(line) ? { type: null, value: undefined, trig: new Map(), line: i + 1 } : null;
        continue;
      }
      if (!ctl) continue;
      const eq = line.indexOf('=');
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim().toLowerCase();
      const val = line.slice(eq + 1).trim();
      if (key === 'type') ctl.type = val.toLowerCase().replace(/\s+/g, '');
      else if (key === 'value') ctl.value = val.replace(/\s+/g, '');
      else {
        const m = /^trigger(all|\d+)$/.exec(key);
        if (m) {
          if (!ctl.trig.has(m[1])) ctl.trig.set(m[1], []);
          ctl.trig.get(m[1]).push(val.toLowerCase().replace(/\s+/g, ''));
        }
      }
    }
    finish();
  }
  return out;
}
function charBodyAction(mountAs, got) {
  got = got || loadActions(mountAs);
  if (!got || !got.actions) return null;
  const actions = got.actions;
  if (!actions[0] || !actions[0].length) return null;           // no stand action: nothing to stand in for
  const rec = charSff(mountAs);
  if (!rec) return null;
  if (actionDraws(actions[0], rec.sff)) return null;             // a normal character
  const { dir, entryDef } = charSource(mountAs);
  const defName = (entryDef && fs.existsSync(path.join(dir, entryDef))) ? entryDef : findMainDef(dir);
  if (!defName) return null;
  const files = bodyStateFiles(dir, defName);
  const stampOf = (p) => { try { const st = fs.statSync(p); return st.size + '@' + st.mtimeMs; } catch (e) { return '-'; } };
  const airRel = String((got.def && got.def.anim) || '').replace(/\\/g, '/');
  const stamp = [rec.key, defName, stampOf(path.join(dir, defName)), airRel, stampOf(resolveCI(dir, airRel) || path.join(dir, airRel))]
    .concat(files.map((f) => f.rel + ':' + stampOf(f.abs))).join('|');
  const hit = BODY_CACHE.get(mountAs);
  if (hit && hit.stamp === stamp) return hit.value;

  const sff = rec.sff;
  const draws = (no) => actionDraws(actions[no], sff);
  const firstGroup0 = (no) => { const f = actions[no] && actions[no][0]; const k = f ? sffCore.spriteKey(f.group, f.index) : null; return !!k && k.group === 0 && actionDraws([f], sff); };
  const cands = helperChangeAnims(files).filter((c) => draws(c.action));
  const nums = Object.keys(actions).map(Number).filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  let value = null;
  const viaHelper = cands.find((c) => firstGroup0(c.action));
  if (viaHelper) value = { action: viaHelper.action, from: 'helper', helper: viaHelper.helper, file: viaHelper.rel, line: viaHelper.line };
  if (!value) { const n = nums.find((x) => actionDraws(actions[x], sff, 0)); if (n !== undefined) value = { action: n, from: 'group0' }; }
  if (!value && cands.length) value = { action: cands[0].action, from: 'helper', helper: cands[0].helper, file: cands[0].rel, line: cands[0].line };
  if (!value) { const n = nums.find((x) => draws(x)); if (n !== undefined) value = { action: n, from: 'first' }; }
  if (value) {
    // In plain words, for the player's one line. "This character": the same
    // sentence serves every character it is true of. Only what the files show
    // (a blank action 0, a ChangeAnim only a helper fires) - never why the
    // author made it so.
    const h = value.helper === null || value.helper === undefined ? 'a helper' : 'helper ' + value.helper;
    value.note = value.from === 'helper'
      ? 'This character’s stand animation (action 0) draws nothing; showing action ' + value.action + ', which its files have ' + h + ' play'
      : value.from === 'group0'
        ? 'This character’s stand animation (action 0) draws nothing; showing action ' + value.action + ', the first that draws its stance sprites (group 0)'
        : 'This character’s stand animation (action 0) draws nothing; showing action ' + value.action + ', the first that draws anything';
  }
  BODY_CACHE.set(mountAs, { stamp, value });
  while (BODY_CACHE.size > BODY_CACHE_MAX) BODY_CACHE.delete(BODY_CACHE.keys().next().value);
  return value;
}

function charActions(mountAs) {
  const got = loadActions(mountAs);
  if (!got) return null;
  const out = [];
  for (const key of Object.keys(got.actions)) {
    const frames = got.actions[key];
    if (!frames || !frames.length) continue;
    // The engine's own count (airTimeline): an element it never draws adds
    // nothing, a -1 holds only as the LAST element, and a middle -1 or a last
    // -2 changes how long the action really runs (anim.go:428-452). `ticks`
    // is the time before the hold, or one pass of the loop.
    const times = frames.map((f) => f.time);
    // A loop point at 0 is the same as none: reported as 0 so the UI does not
    // offer a "loop" copy that would be identical to the original.
    const ls = Number.isFinite(frames.loopStart) && frames.loopStart < frames.length
      ? frames.loopStart : 0;
    // The two entries the player offers (airEntries), over the whole action
    // with its real Loopstart.
    const ent = airEntries(times, ls);
    const ticks = timelineTicks(ent.full), holds = ent.full.hold;
    const loopTicks = ls > 0 ? timelineTicks(ent.loop) : ticks;
    const no = Number(key);
    out.push({
      action: no, frames: frames.length, ticks, holds,
      loopStart: ls,
      loopFrames: frames.length - ls,
      loopTicks,
      // A receiver's pair art: the action sits in a registry window (GRAIL
      // 4.2). Omitted otherwise, so the common case stays the same size.
      registry: inReceiverRegistry(no) ? hFamily(no) : undefined,
    });
  }
  out.sort((a, b) => a.action - b.action);
  // A blank stand action and the body the game shows instead (charBodyAction):
  // the player opens on it and says where it came from. Absent for a
  // character whose action 0 draws.
  let body = null;
  try { body = charBodyAction(mountAs, got); } catch (e) { body = null; }
  return body ? { count: out.length, actions: out, body } : { count: out.length, actions: out };
}

// THE SPRITES THE BUILD'S COPY OF A CHARACTER'S FILE GAINS (futafix.js), as
// 'group,index' -> the 'group,index' it is linked to. The pair bench's scene
// view draws with these, so it shows what the game will: a held frame where her
// own folder has a gap. Empty for every character the repair does not touch.
function shippedStandIns(mountAs) {
  try {
    const src = charSource(mountAs);
    const def = (src.entryDef && fs.existsSync(path.join(src.dir, src.entryDef))) ? src.entryDef : findMainDef(src.dir);
    const fx = def ? require('./futafix.js').repairFor(src.dir, def) : null;
    return new Map(fx ? fx.aliases.map((a) => [a.key, a.from.split(',').map(Number)]) : []);
  } catch (e) { return new Map(); }
}

// opts.spritesFrom: draw this character's action with ANOTHER character's
// sprite file - what ChangeAnim2 does in a scene, the giver's table on the
// victim's art (GRAIL 4.1). Geometry and palette-following then come from
// her .sff, and a frame she lacks reports w = h = 0, which is a blank in the
// player and a vanish in the match.
function charAnim(mountAs, actionNo, opts) {
  const got = loadActions(mountAs);
  if (!got) return null;
  const { dir, def, actions } = got;
  const sel = actionFrames(actions, actionNo, opts && opts.loop);
  if (!sel) return null;
  const frames = sel.frames;
  const spritesFrom = (opts && opts.spritesFrom) || null;

  const rec = charSff(spritesFrom || mountAs);
  // Her file could not be opened is NOT "she lacks every sprite": with
  // sprites borrowed from another character, an unreadable file is an
  // error, never a list of blank frames the bench would call a vanish.
  if (spritesFrom && !rec) throw new Error('the sprite file of ' + spritesFrom + ' could not be read');
  const sff = rec ? rec.sff : null;
  const standIns = spritesFrom ? shippedStandIns(spritesFrom) : new Map();
  const out = frames.map((f0) => {
    // THE SPRITE THE ENGINE LOOKS UP, which is not always the number the .air
    // writes: -1 is no sprite, any other negative wraps through uint16
    // (anim.go:700-702, sffCore.spriteKey), so group -2 is 65534. group/index
    // below are what the panel should request; `air` keeps the written pair
    // when the two differ. No sprite at all (a -1) keeps the written numbers
    // with w = h = 0, a blank like any missing sprite.
    const k0 = sffCore.spriteKey(f0.group, f0.index);
    const kg = k0 ? k0.group : f0.group, ki = k0 ? k0.index : f0.index;
    // a frame her folder lacks and the build fills is drawn as the build
    // draws it; `asked` keeps the number the giver's table names
    const sub = sff && k0 && !sffDecode.spriteGeom(sff, kg, ki) ? standIns.get(k0.key) : null;
    const f = sub ? Object.assign({}, f0, { group: sub[0], index: sub[1], asked: [f0.group, f0.index] })
      : Object.assign({}, f0, { group: kg, index: ki });
    const g = sff && k0 ? sffDecode.spriteGeom(sff, f.group, f.index) : null;
    // Whether THIS frame can wear a chosen palette. An effect or a borrowed
    // win-pose sprite keeps its own colors, and the viewer says so rather than
    // leaving you to wonder why the color you picked did nothing.
    let follows = false;
    try { follows = rec && k0 ? spriteFollowsPalette(rec, f.group, f.index) : false; }
    catch (e) { follows = false; }
    const fr = {
      group: f.group, index: f.index, x: f.x, y: f.y, time: f.time,
      w: g ? g.w : 0, h: g ? g.h : 0,
      axisX: g ? g.axisX : 0, axisY: g ? g.axisY : 0,
      asked: f.asked,
      air: k0 && (k0.group !== f0.group || k0.index !== f0.index) ? [f0.group, f0.index] : undefined,
      follows,
      // Collision boxes, in the frame's own coordinates relative to the sprite
      // AXIS - so a viewer can draw them from the axis it already positions by,
      // with no second source of truth. Omitted when empty to keep the common
      // response small: most frames of most actions have no attack box.
      clsn1: (f.clsn1 && f.clsn1.length) ? f.clsn1 : undefined,
      clsn2: (f.clsn2 && f.clsn2.length) ? f.clsn2 : undefined,
    };
    // HOW THE ENGINE DRAWS THE FRAME, straight from the parser and only where
    // it is not the default (motif-core parseActions): the flips, the drawn
    // offset xDraw/yDraw (an even number of H or V of two or more negates it),
    // xscale/yscale/angle. The player places the sprite with the same rule the
    // GIF composer uses (runPlacement). The parser's h/v flags arrive here as
    // flipH/flipV, because `h` on this frame is already the sprite's HEIGHT -
    // copied under its own name it would overwrite it with `true`. `blend`
    // also carries s and d, the renderer's 0-255 factors after alphaToBlend,
    // so no viewer re-derives MUGEN's 0-256 conversion.
    if (f0.h) fr.flipH = true;
    if (f0.v) fr.flipV = true;
    for (const k of ['xDraw', 'yDraw', 'xscale', 'yscale', 'angle']) if (f0[k] !== undefined) fr[k] = f0[k];
    if (f0.blend) {
      const ab = motifCore.alphaToBlend(f0.blend.src, f0.blend.dst);
      fr.blend = { mode: f0.blend.mode, src: f0.blend.src, dst: f0.blend.dst, s: ab.s, d: ab.d };
    }
    return fr;
  });
  return Object.assign({
    action: actionNo, frames: out,
    loopStart: sel.loopStart, looped: sel.looped,
    sprites: spritesFrom,
  }, charScale(spritesFrom || mountAs));
}

// The character's sprite file, resolved case-insensitively from an already
// parsed def. mainSffPath() needs a roster entry; a library-only character has
// none, and the select editor lists those too.
function mainSffPathLoose(dir, def) {
  const rel = String(def.sprite || '').replace(/\\/g, '/');
  const p = path.join(dir, rel);
  if (fs.existsSync(p)) return p;
  const want = path.basename(rel).toLowerCase();
  const hit = fs.readdirSync(dir).find((f) => f.toLowerCase() === want);
  if (!hit) throw new Error('sprite file not found: ' + rel);
  return path.join(dir, hit);
}

// PORTRAIT RENUMBERING (portraitfix.js, GRAIL 3.4d). These resolve a roster
// mount name to its .sff and hand off; all the container work lives there.
//
// The .sff is resolved through charSource, so a VARIANT edits the .sff its own
// .def names rather than the folder's main one - two entries out of one folder
// can legitimately point at different sprite files.
function charSffPath(mountAs) {
  const { dir, entryDef } = charSource(mountAs);
  if (!fs.existsSync(dir)) throw new Error('that character is not on disk');
  const defName = (entryDef && fs.existsSync(path.join(dir, entryDef))) ? entryDef : findMainDef(dir);
  if (!defName) throw new Error('no .def found for that character');
  const def = sffDecode.parseDef(path.join(dir, defName));
  if (!def || !def.sprite) throw new Error('that .def names no sprite file');
  return mainSffPathLoose(dir, def);
}

function portraitState(mountAs) {
  const sffPath = charSffPath(mountAs);
  const st = portraitfix.inspect(sffPath);
  // The caller wants to know whether renumbering is even worth offering, and
  // that question is "is there art at a number the pack does not read?". The
  // answer is the UI's to present, so hand over the raw inventory plus the one
  // derived fact that is awkward to compute client-side.
  const has = (n) => st.sprites.some((s) => s.index === n);
  return {
    ...st,
    suggestion: (has(100) && has(0)) ? { from: 100, to: 0 } : null,
    suggestionBig: (has(101) && has(1)) ? { from: 101, to: 1 } : null,
  };
}

function applyPortraitFix(mountAs, moves) {
  const out = portraitfix.apply(charSffPath(mountAs), moves);
  invalidateDiag();
  return out;
}

function revertPortraitFix(mountAs) {
  const out = portraitfix.revert(charSffPath(mountAs));
  invalidateDiag();
  return out;
}

// ---- palettes the user added (custompal.js, palcolor-core.js) ---------------
//
// A new color is a BASE palette (any slot the character has) and a recipe: how
// far to turn each color family. The recipe is kept in the roster so it can be
// edited again; the 768 bytes it makes are kept in the bundle, so a build never
// has to recompute anything and an imported .act is the same thing as a
// recolored one by the time it ships.
const custompal = require('./custompal.js');
const palcolor = require('./public/ikemen/palcolor-core.js');

function usedIndexSet(rec) {
  const use = costumeIndexUsage(rec);
  if (!use) return null;
  const s = new Set();
  for (let i = 1; i < 256; i++) if (use[i]) s.add(i);
  return s.size ? s : null;
}
// Everything the Colors panel needs for one character.
function customPaletteState(mountAs) {
  const roster = readRoster();
  const c = rosterCharOf(roster, mountAs);
  if (!c) return { error: 'not in build: ' + mountAs };
  const rec = charSff(mountAs);
  if (!rec) return { error: 'this character\'s sprite file could not be read' };
  const info = charPalettes(mountAs);
  if (!info) return { error: 'this character\'s palettes could not be read' };
  const used = usedIndexSet(rec);
  const taken = new Set(info.palettes.map((p) => p.slot));
  let next = 1; while (taken.has(next)) next++;
  // the sprite the preview opens on: the first frame of the stance
  let preview = [0, 0];
  try { const a = charAnim(mountAs, 0, {}); if (a && a.frames && a.frames[0]) preview = [a.frames[0].group, a.frames[0].index]; } catch (e) { /* 0,0 */ }
  return { char: c.mountAs, sffVersion: rec.sff.version, maxSlot: custompal.MAX_SLOT, nextSlot: next <= custompal.MAX_SLOT ? next : null,
    palettes: info.palettes.map((p) => ({ slot: p.slot, label: p.label, source: p.source, missing: !!p.missing, same: p.same, colors: p.colors,
      base: p.base, ops: p.ops || null })),
    used: used ? [...used] : null, preview, families: palcolor.FAMILIES.map((f) => ({ id: f.id, name: f.name })) };
}
// A sprite as indices, for the panel to recolor in the browser: { w, h, px (base64), follows }.
function spriteIndexedFor(mountAs, group, index) {
  const rec = charSff(mountAs);
  if (!rec) return null;
  let defText = '';
  try { defText = fs.readFileSync(path.join(rec.dir, rec.defName), 'latin1'); } catch (e) { defText = ''; }
  const src = portraitfit.sourcePixels(rec.sff, group, index, portraitfit.defaultAct(rec.dir, defText, fitPalOpts(mountAs)));
  if (!src) return null;
  let follows = false; try { follows = spriteFollowsPalette(rec, group, index); } catch (e) { follows = false; }
  return { w: src.w, h: src.h, px: Buffer.from(src.px).toString('base64'), follows };
}
function paletteBase64(mountAs, slot) {
  const pal = paletteBytes(mountAs, slot);
  return pal ? Buffer.from(pal).toString('base64') : null;
}
function writeCustomPalettes(mountAs, mutate) {
  const roster = readRoster();
  const c = rosterCharOf(roster, mountAs);
  if (!c) throw new Error('not in build: ' + mountAs);
  const list = mutate((c.customPalettes || []).slice());
  if (list.length) c.customPalettes = list.sort((a, b) => a.slot - b.slot); else delete c.customPalettes;
  roster.chars = roster.chars.map(cleanChar);
  writeRoster(roster);
  // palettes no character names any more leave the bundle
  const usedFiles = new Set();
  for (const x of roster.chars) for (const p of x.customPalettes || []) usedFiles.add(p.file);
  const dir = layout.dir('palettes');
  try { for (const n of fs.readdirSync(dir)) if (custompal.FILE_RE.test(n) && !usedFiles.has(n)) rmFile(path.join(dir, n)); } catch (e) { /* no folder yet */ }
  return customPaletteState(mountAs);
}
function slotFor(mountAs, want, replacing) {
  const info = charPalettes(mountAs);
  const taken = new Set((info ? info.palettes : []).filter((p) => !(replacing && p.source === 'studio' && p.slot === replacing)).map((p) => p.slot));
  let slot = Number.isInteger(want) ? want : 0;
  if (!slot) { slot = 1; while (taken.has(slot)) slot++; }
  if (slot < 1 || slot > custompal.MAX_SLOT) throw new Error('a palette slot is a number from 1 to ' + custompal.MAX_SLOT);
  if (taken.has(slot)) throw new Error('this character already has a palette ' + slot);
  return slot;
}
// spec: { slot?, replace?, base, ops, name }  -> the panel's state
function saveCustomPalette(mountAs, spec) {
  const basePal = paletteBytes(mountAs, spec.base);
  if (!basePal) throw new Error('the base palette ' + spec.base + ' could not be read');
  const ops = palcolor.cleanOps(spec.ops);
  const file = custompal.store(layout.dir('palettes'), palcolor.applyOps(basePal, ops));
  const replacing = Number.isInteger(spec.replace) ? spec.replace : null;
  const slot = replacing || slotFor(mountAs, spec.slot, null);
  const name = String(spec.name || '').replace(/[\r\n]/g, ' ').trim().slice(0, 40);
  return writeCustomPalettes(mountAs, (list) => list.filter((p) => p.slot !== slot).concat([{ slot, file, name: name || undefined, base: Number(spec.base), ops }]));
}
// An .act, or a palette PNG, somebody made: taken as it is.
function importCustomPalette(mountAs, buf, name, wantSlot) {
  if (!Buffer.isBuffer(buf) || buf.length < 48 || buf.length > 4 * 1024 * 1024) throw new Error('that is not a palette file');
  const isPng = buf[0] === 0x89 && buf[1] === 0x50;
  if (!isPng && buf.length < 768) throw new Error('an .act palette is 768 bytes; this file has ' + buf.length);
  // (an .act may carry four trailing bytes - a color count and a transparent index - after its 768)
  const pal = require('./public/ikemen/sffdec-core.js').readAct(isPng ? buf : buf.subarray(0, 768));
  if (!pal) throw new Error('that file holds no palette (an .act, or a PNG saved with a palette)');
  const file = custompal.store(layout.dir('palettes'), pal);
  const slot = slotFor(mountAs, wantSlot, null);
  const label = String(name || '').replace(/\.[a-z0-9]+$/i, '').replace(/[\r\n]/g, ' ').trim().slice(0, 40);
  return writeCustomPalettes(mountAs, (list) => list.concat([{ slot, file, name: label || undefined }]));
}
function removeCustomPalette(mountAs, slot) {
  return writeCustomPalettes(mountAs, (list) => list.filter((p) => p.slot !== Number(slot)));
}
// The order of the slots: original slot numbers in the wanted order; null puts the author's back.
function setPaletteOrder(mountAs, order) {
  const roster = readRoster();
  const c = rosterCharOf(roster, mountAs);
  if (!c) throw new Error('not in build: ' + mountAs);
  const list = require('./palorder.js').clean(order);
  if (list.length) c.paletteOrder = list; else delete c.paletteOrder;
  roster.chars = roster.chars.map(cleanChar);
  writeRoster(roster);
  return charPalettes(mountAs);
}

// ---- select portraits fitted to the screenpack (portraitfit.js) ------------
//
// WHAT THE PACK WANTS is measured, not configured: the size most of the roster
// draws each slot at ON SCREEN (sprite pixels x the character's own scale
// factor), which for a pack that ships its own roster is the size its art was
// cut to. A slot is a sprite NUMBER - the cell face is `portrait.spr`, the big
// portrait `p1.face.spr` - so whatever else reads that number (the lifebar
// face usually reads the cell's) gets the fitted art too, which is what a pack
// with tall face strips wants.
const portraitfit = require('./portraitfit.js');
let packSpecCache = null;
function packPortraitSpec() {
  const roster = readRoster();
  const info = motifSelectInfo();
  if (!info || info.error) return { error: (info && info.error) || 'no screenpack' };
  const motifW = (info.localcoord && info.localcoord[0]) || 320;
  const slots = [
    { role: 'cell', key: ((info.select && info.select.portraitSpr) || [9000, 0]).join(',') },
    { role: 'big', key: ((((info.select && info.select.faces && info.select.faces.p1) || []).find((f) => f && f.spr) || {}).spr || [9000, 1]).join(',') },
  ].filter((s, i, all) => all.findIndex((x) => x.key === s.key) === i);
  const chars = roster.chars.filter((c) => !c.kind && c.mountAs);
  const stamp = JSON.stringify([roster.motif, motifW, slots, chars.map((c) => c.mountAs)]);
  if (packSpecCache && packSpecCache.stamp === stamp) return packSpecCache.value;
  const seen = new Map();   // slot key -> Map('WxH' -> [mountAs])
  for (const c of chars) {
    let f;
    try { f = portraitfit.factorOf(charScale(c.mountAs), motifW); } catch (e) { continue; }
    for (const s of slots) {
      const [g, i] = s.key.split(',').map(Number);
      const geom = spriteGeomFor(c.mountAs, g, i, true);
      if (!geom || !geom.w) continue;
      const k = Math.round(geom.w * f) + 'x' + Math.round(geom.h * f);
      if (!seen.has(s.key)) seen.set(s.key, new Map());
      const m = seen.get(s.key); if (!m.has(k)) m.set(k, []); m.get(k).push(c.mountAs);
    }
  }
  for (const s of slots) {
    const m = seen.get(s.key) || new Map();
    const ranked = [...m.entries()].sort((a, b) => b[1].length - a[1].length);
    const total = ranked.reduce((n, e) => n + e[1].length, 0);
    // a convention is a size at least three characters share and most of the roster draws at
    const top = ranked[0];
    s.onScreen = top && top[1].length >= 3 && top[1].length * 2 > total
      ? { w: +top[0].split('x')[0], h: +top[0].split('x')[1], sharedBy: top[1].length, of: total } : null;
  }
  const value = { motif: portraitfit.motifKey(roster), motifW, slots };
  packSpecCache = { stamp, value };
  return value;
}

function rosterCharOf(roster, mountAs) {
  return roster.chars.find((x) => String(x.mountAs).toLowerCase() === String(mountAs).toLowerCase()) || null;
}

// What portraitfit.defaultAct needs to pick the costume the build ships as
// pal1: the roster's palette order and Studio colors, and where those live.
function fitPalOpts(mountAs, roster) {
  let c = null;
  try { c = rosterCharOf(roster || rosterNow(), mountAs); } catch (e) { c = null; }
  let palettes = null;
  try { palettes = layout.dir('palettes'); } catch (e) { palettes = null; }
  return { order: (c && c.paletteOrder) || null, customs: (c && c.customPalettes) || null, palettes };
}

// The source sprite's pixels in the colors the build will bake in: its own
// palette for the portrait bank, the costume the build ships as pal1 for a
// sprite that wears one (portraitfit.defaultAct).
function fitSource(mountAs, from) {
  // the user's own picture, from the bundle's portraits/ folder
  if (portraitfit.isPicture(from)) return portraitfit.pictureSource(from, layout.dir('portraits'));
  const rec = charSff(mountAs);
  if (!rec) return null;
  const [g, i] = String(from).split(',').map(Number);
  // through the fitter's own decoder, so the preview IS what the build bakes in
  let defText = '';
  try { defText = fs.readFileSync(path.join(rec.dir, rec.defName), 'latin1'); } catch (e) { defText = ''; }
  return portraitfit.sourcePixels(rec.sff, g, i, portraitfit.defaultAct(rec.dir, defText, fitPalOpts(mountAs)));
}

const fittedCache = new Map();
function fittedPortrait(mountAs, group, index) {
  let roster;
  // (cellPortraits lends the roster it read: charSource's note)
  try { roster = rosterNow(); } catch (e) { return null; }
  const c = rosterCharOf(roster, mountAs);
  const fits = c && portraitfit.fitsOf(c, roster);
  const fit = fits && fits[group + ',' + index];
  if (!fit) return null;
  // Stamped from the key alone: the sprite file is read only on a miss, so a
  // roster-wide sweep does not reopen every fitted character's .sff.
  const k = charSffKey(mountAs);
  if (!k) return null;
  const key = mountAs.toLowerCase() + '|' + group + ',' + index;
  // the order and the Studio's colors pick the costume a source is baked in
  const stamp = JSON.stringify(fit) + '|' + k.key + '|' + JSON.stringify([c.paletteOrder || null, c.customPalettes || null]);
  const hit = fittedCache.get(key);
  if (hit && hit.stamp === stamp) return hit.value;
  const rec = charSff(mountAs);
  if (!rec) return null;
  let value = null;
  try {
    const src = fitSource(mountAs, fit.from !== undefined ? fit.from : group + ',' + index);
    if (src) {
      const img = portraitfit.renderFit(src, fit);
      const old = sffDecode.spriteGeom(rec.sff, group, index);
      value = Object.assign(img, {
        axisX: old && old.w ? Math.round(old.axisX * img.w / old.w) : 0,
        axisY: old && old.h ? Math.round(old.axisY * img.h / old.h) : 0 });
    }
  } catch (e) { value = null; }
  fittedCache.set(key, { stamp, value });
  return value;
}

// Everything the Portraits panel shows for one character.
function portraitFitState(mountAs) {
  const roster = readRoster();
  const c = rosterCharOf(roster, mountAs);
  if (!c) return { error: 'not in build: ' + mountAs };
  const rec = charSff(mountAs);
  if (!rec) return { error: 'this character\'s sprite file could not be read' };
  const spec = packPortraitSpec();
  if (spec.error) return { error: spec.error };
  const factor = portraitfit.factorOf(charScale(mountAs), spec.motifW);
  const fits = portraitfit.fitsOf(c, roster) || {};
  // CANDIDATES ARE GROUP 9000 AND NOTHING ELSE BY DEFAULT. 9000 is the portrait
  // group; the numbers around it are not "more portraits", they are other
  // conventions that happen to sit nearby - 9020/9021 is the art a character
  // shows when Midnight Bliss is used on it (47 of 124 characters here carry
  // it, drawn by their own action 9020), 9010 and the 92xx-94xx blocks are
  // moves' art too. Offering those as portraits was a mistake of range, not of
  // taste. Added to group 9000: the numbers the SCREENPACK itself reads for
  // its slots, and whatever a saved fit already points at. Anything else is
  // still reachable - by typing its number - and is reported beside the list
  // with the action that draws it, so nobody wonders where it went.
  const cands = new Map();
  const slotKeys = new Set(spec.slots.map((s) => s.key));
  const nearby = new Map();   // group -> sprite count, for 9001-9999 not offered
  for (const [k] of rec.sff.byKey) {
    const [g, i] = k.split(',').map(Number);
    if (g < 9000 || g > 9999) continue;
    if (g !== 9000 && !slotKeys.has(k)) { nearby.set(g, (nearby.get(g) || 0) + 1); continue; }
    const geom = sffDecode.spriteGeom(rec.sff, g, i);
    if (geom && geom.w > 1 && geom.h > 1) cands.set(k, { key: k, w: geom.w, h: geom.h });
  }
  let notOffered = [];
  if (nearby.size) {
    let air = new Map();
    try { const f = defFiles(rec.dir, rec.defName); if (f.anim) air = airFrames(fs.readFileSync(f.anim, 'latin1')); } catch (e) { air = new Map(); }
    const drawnBy = new Map();
    for (const [act, frames] of air) for (const k of frames) { const g = +k.split(',')[0]; if (nearby.has(g)) { if (!drawnBy.has(g)) drawnBy.set(g, []); if (drawnBy.get(g).length < 4 && !drawnBy.get(g).includes(act)) drawnBy.get(g).push(act); } }
    notOffered = [...nearby.entries()].sort((a, b) => a[0] - b[0]).map(([group, sprites]) => ({ group, sprites, drawnBy: (drawnBy.get(group) || []).sort((a, b) => a - b) }));
  }
  for (const f of Object.values(fits)) {
    if (f.from === undefined || cands.has(String(f.from)) || portraitfit.isPicture(f.from)) continue;
    const [g, i] = String(f.from).split(',').map(Number);
    const geom = sffDecode.spriteGeom(rec.sff, g, i);
    if (geom) cands.set(String(f.from), { key: String(f.from), w: geom.w, h: geom.h });
  }
  const candidates = [...cands.values()].sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }));
  const slots = spec.slots.map((s) => {
    const [g, i] = s.key.split(',').map(Number);
    const have = spriteGeomFor(mountAs, g, i, true);
    const want = s.onScreen ? portraitfit.targetPx(s.onScreen, factor) : null;
    // within a pixel, or within 4%, is the same size: packs are not exact either
    const close = (a, b) => Math.abs(a - b) <= Math.max(1, b * 0.04);
    const matches = !!(have && want && close(have.w, want.w) && close(have.h, want.h));
    // THE DEFAULT SOURCE IS ONE OF THE STANDARD PORTRAITS - the slot's own, 9000,1,
    // 9000,0 - whichever needs the least enlarging (any amount of shrinking is
    // free). The portrait bank holds other things too - name plates, versus art,
    // an unassembled sheet (3.4d) - and a default must not guess at those: they
    // are for the picker. Only a character with no standard portrait at all
    // falls back to the rest of the bank.
    let suggest = null;
    if (want) {
      const need = (cd) => Math.max(want.w / cd.w, want.h / cd.h);
      const best = (list) => {
        const shrink = list.filter((cd) => need(cd) <= 1).sort((x, y) => need(y) - need(x));
        return (shrink[0] || list.slice().sort((x, y) => need(x) - need(y))[0] || {}).key || null;
      };
      const standard = [s.key, '9000,1', '9000,0'];
      suggest = best(candidates.filter((cd) => standard.includes(cd.key))) || best(candidates);
    }
    return { role: s.role, key: s.key, convention: s.onScreen, have: have ? { w: have.w, h: have.h } : null, want, matches,
      suggest, fit: fits[s.key] || null };
  });
  return { char: c.mountAs, motif: spec.motif, supported: true, why: '', sffVersion: rec.sff.version,
    factor, slots, candidates, notOffered,
    // the pictures this character's fits use, so the panel can show them
    pictures: Object.values(fits).filter((f) => portraitfit.isPicture(f.from)).map((f) => {
      try { const s = portraitfit.pictureSource(f.from, layout.dir('portraits')); return { from: f.from, w: s.w, h: s.h }; }
      catch (e) { return { from: f.from, missing: true }; } }),
    modes: portraitfit.MODES, filters: portraitfit.FILTERS };
}

function cleanFit(fit) {
  const num = (v, lo, hi) => (Number.isFinite(+v) && +v >= lo && +v <= hi ? +v : null);
  const w = num(fit && fit.w, 1, 4096), h = num(fit && fit.h, 1, 4096);
  if (w === null || h === null) throw new Error('a fit needs a target size');
  const from = (/^\d{1,5},\d{1,5}$/.test(String(fit.from || '')) || portraitfit.isPicture(fit.from)) ? String(fit.from) : null;
  if (!from) throw new Error('a fit needs a source: a sprite number or a picture');
  return Object.assign(portraitfit.isPicture(from) ? { dither: fit.dither !== false && fit.dither !== 'false' && fit.dither !== '0' } : {}, { from, w: Math.round(w), h: Math.round(h),
    mode: portraitfit.MODES.includes(fit.mode) ? fit.mode : 'cover',
    filter: portraitfit.FILTERS.includes(fit.filter) ? fit.filter : 'crisp',
    focus: [num(fit.focus && fit.focus[0], 0, 1) === null ? 0.5 : +fit.focus[0], num(fit.focus && fit.focus[1], 0, 1) === null ? 0.5 : +fit.focus[1]] });
}

// A fit that has not been saved, as the PNG it would ship.
function portraitFitPreview(mountAs, fit) {
  const f = cleanFit(fit);
  const src = fitSource(mountAs, f.from);
  if (!src) throw new Error('source sprite ' + f.from + ' is not in the file');
  const img = portraitfit.renderFit(src, f);
  return sffDecode.encodeIndexedPng(img.px, img.w, img.h, img.pal);
}

// A PICTURE THE USER SUPPLIED. Always a PNG by the time it gets here - the
// page draws whatever the browser can open (JPEG, WebP, GIF, a PNG of any
// kind) onto a canvas and sends that, so the program needs no image library
// beyond the PNG reader it has. Stored under its own content hash: the same
// picture twice is one file, a name can never collide, and nothing a roster
// says can point a build outside this folder (portraitfit.PICTURE_RE).
const PICTURE_MAX_BYTES = 12 * 1024 * 1024;
function savePortraitPicture(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 64) throw new Error('that is not a picture');
  if (buf.length > PICTURE_MAX_BYTES) throw new Error('that picture is over 12 MB; a portrait never needs that much');
  let png;
  try { png = sffDecode.decodePng(buf); } catch (e) { throw new Error('that picture could not be read: ' + e.message); }
  if (png.w > 4096 || png.h > 4096) throw new Error('that picture is larger than 4096 pixels on a side');
  const name = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 12) + '.png';
  const dir = layout.dir('portraits');
  fs.mkdirSync(dir, { recursive: true });
  const abs = path.join(dir, name);
  if (!fs.existsSync(abs)) fs.writeFileSync(abs, buf);
  return { from: 'file:' + name, w: png.w, h: png.h };
}
function portraitPicturePath(from) {
  const m = portraitfit.PICTURE_RE.exec(String(from));
  if (!m) return null;
  const abs = path.join(layout.dir('portraits'), m[1]);
  return fs.existsSync(abs) ? abs : null;
}
// Pictures no fit of any character, under any screenpack, still names.
function sweepPortraitPictures(roster) {
  const dir = layout.dir('portraits');
  let names; try { names = fs.readdirSync(dir); } catch (e) { return 0; }
  const used = new Set();
  for (const c of roster.chars) for (const byPack of Object.values(c.portraitFit || {})) for (const f of Object.values(byPack)) {
    const m = portraitfit.PICTURE_RE.exec(String(f.from)); if (m) used.add(m[1]);
  }
  let gone = 0;
  for (const n of names) if (/^[a-f0-9]{12}\.png$/.test(n) && !used.has(n)) { try { rmFile(path.join(dir, n)); gone++; } catch (e) { /* in use: next time */ } }
  return gone;
}

// fit = null removes the slot's fit. Saved under the screenpack in use.
function setPortraitFit(mountAs, slotKey, fit) {
  if (!/^\d{1,5},\d{1,5}$/.test(String(slotKey))) throw new Error('bad slot');
  const roster = readRoster();
  const c = rosterCharOf(roster, mountAs);
  if (!c) throw new Error('not in build: ' + mountAs);
  const key = portraitfit.motifKey(roster);
  const all = Object.assign({}, c.portraitFit || {});
  const mine = Object.assign({}, all[key] || {});
  if (fit) {
    mine[slotKey] = cleanFit(fit);
    if (!fitSource(mountAs, mine[slotKey].from)) throw new Error('source sprite ' + mine[slotKey].from + ' is not in the file');
  } else delete mine[slotKey];
  if (Object.keys(mine).length) all[key] = mine; else delete all[key];
  if (Object.keys(all).length) c.portraitFit = all; else delete c.portraitFit;
  roster.chars = roster.chars.map(cleanChar);
  writeRoster(roster);
  // a picture whose last fit just went is removed with it
  if (!fit) sweepPortraitPictures(roster);
  return portraitFitState(mountAs);
}

// A PORTRAIT THE SCREENPACK NEVER SHOWS, AND WHAT IT SHOWS INSTEAD.
//
// Every view that pictures a character - the Characters tab tile, the list
// icon, the Properties head, E-Select's lists - asks for its portrait sprite
// (9000,0, or the big one). A pack can park the cells' portraits off the screen
// and draw its grid faces as background art (MK II Remix, portrait.offset =
// -5000,-5000; GRAIL 4.9). Then that sprite is a leftover the game never draws:
// MK II's 9000,0 decodes to color noise through the file's own palette, its
// .act and every other palette in the file alike, and the shared ninja files'
// 9000,1 is Kitana's win pose in Kitana's blue. What the game shows such a
// character as is the hover face - the first frame of `p1.face.anim` (or the
// `p1.face.spr` still) - so that is the picture. Drawn through spritePngFor
// like any frame, so a body frame wears the character's own .act (Mileena's
// colors on the shared female file, never Kitana's). null = draw what was
// asked for, which is every pack that shows its cells.
const STANDIN_MOTIF = { key: '', parsed: null };
// THE PARSED MOTIF, per version of its file: path|size|mtime. The stand-in
// asks once per portrait and motifSff once per motif sprite (a grid load asks
// for the cell box, the random icon and every cursor frame); each re-read and
// re-parsed the whole system.def (64 KB for ikemen1). null when the file is
// gone or does not parse; a read that fails is not remembered. Callers only
// read the result.
function motifParsedAt(defPath) {
  let st; try { st = fs.statSync(defPath); } catch (e) { return null; }
  const key = defPath + '|' + st.size + '|' + st.mtimeMs;
  if (STANDIN_MOTIF.key !== key) {
    let text;
    try { text = fs.readFileSync(defPath, 'latin1'); } catch (e) { return null; }
    let parsed = null;
    try { parsed = motifCore.parseMotif(text); } catch (e) { parsed = null; }
    STANDIN_MOTIF.key = key; STANDIN_MOTIF.parsed = parsed;
  }
  return STANDIN_MOTIF.parsed;
}
function portraitStandIn(mountAs) {
  let defPath = null;
  try { defPath = motifDefPath(); } catch (e) { defPath = null; }
  if (!defPath) return null;
  const m = motifParsedAt(defPath);
  if (!m || !motifCore.cellPortraitsHidden(m)) return null;
  const face = motifCore.hoverFace(m);
  if (!face) return null;
  if (face.anim !== null && face.anim !== undefined) {
    let r = null;
    try { r = charAnim(mountAs, face.anim); } catch (e) { r = null; }
    const fr = r && (r.frames || []).find((f) => f.w > 0 && f.h > 0);
    return fr ? { group: fr.group, index: fr.index, from: 'face.anim ' + face.anim } : null;
  }
  return face.spr ? { group: face.spr[0], index: face.spr[1], from: 'face.spr' } : null;
}

function spritePngFor(mountAs, group, index, palSlot, raw) {
  try {
    // A PORTRAIT FITTED TO THIS SCREENPACK is what the build ships, so it is
    // what every view of that sprite shows - the grid, the roster tile, the
    // properties panel. `raw` is the picker asking for the file's own art.
    const fitted = raw ? null : fittedPortrait(mountAs, group, index);
    if (fitted) return sffDecode.encodeIndexedPng(fitted.px, fitted.w, fitted.h, fitted.pal);
    // THROUGH THE CACHE. This used to re-read and re-parse the whole .sff on
    // every single sprite request - which the animation viewer makes sixty
    // times a second, against files that run to fifty megabytes (kula_xiii is
    // 51 MB). charSff already keeps an LRU keyed on size+mtime, so an edited
    // file still invalidates itself.
    const rec = charSff(mountAs);
    if (!rec) return null;
    const { sff } = rec;
    // ONLY A SPRITE THAT FOLLOWS THE COSTUME PALETTE WEARS ONE, picked or not.
    // The old default was set on the whole file, and decodeSprite applies
    // sff.actPal to every sprite outside group 9000 - so a character's hit
    // sparks and projectiles were painted with its costume .act with NO palette
    // chosen at all. That is the "it looks like I clicked re-chain palettes"
    // corruption: leona's explosion at 6600,4 draws mostly on indices 1, 6, 9, 4
    // and 15, which read #000002 / #000108 / #000404 / #020006 / #00090a in the
    // palette the sprite owns and #f8d8a0 / #b07060 / #484038 / #e89880 /
    // #00f800 through Leona00.act. Index 15 is the neon green.
    //
    // Her body at 0,0 is the control: its own palette and Leona00.act are
    // byte-identical, which is exactly why applying the .act ever looked safe.
    const followsPal = (() => {
      try { return spriteFollowsPalette({ sff }, group, index); } catch (e) { return false; }
    })();
    // NOTHING PICKED: pal1 AS THE BUILD SHIPS IT (previewPalette), as an
    // implicit pick of that slot through the explicit path below - so the
    // default preview and a click on that row are the same bytes. SFF v1
    // sprites carry no costume colors of their own (without an .act a v1
    // character renders as color noise; cvsmika_h was the visible case), so v1
    // always takes it. An SFF v2 takes it only when its roster order moves
    // another slot to pal1; with no order it draws exactly as before, and its
    // palettes are not even read for one that has no order (rosterHasPaletteOrder,
    // kept per stamp of roster.json). The answer and the slot's bytes come from
    // the kept charPalettes answer (charPalettesEntry), not a fresh read.
    let pick = (palSlot !== undefined && palSlot !== null && palSlot !== '') ? palSlot : null;
    let entry = null;
    if (pick === null && followsPal) {
      let want = sff.version !== 2;
      if (!want) { try { want = rosterHasPaletteOrder(mountAs); } catch (e) { want = false; } }
      if (want) {
        try { entry = charPalettesEntry(mountAs); } catch (e) { entry = null; }
        const pv = previewPalette(entry && entry.value);
        if (pv.implicit && pv.slot !== null) pick = pv.slot;
      }
    }
    // AN EXPLICIT PALETTE OUTRANKS EVERY DEFAULT - here, and in the decoder the
    // rule that makes group 9000 use its own embedded palette. The user clicked
    // this color; the preview has to show it.
    //
    // Cleared in a finally because decoder sff objects are shared: left set,
    // one preview would silently recolor every later request.
    // A PALETTE IS STILL SUBJECT TO WHETHER THE SPRITE CAN WEAR ONE.
    // Refused here rather than in the browser, so no caller anywhere can corrupt
    // a portrait by asking. A sprite that does not follow costume palettes comes
    // back in its own colors, which is what the engine would draw.
    if (pick !== null && followsPal) {
      let forced = null;
      // the implicit pick reuses the answer it was read from (one check of its stamps)
      try { forced = entry ? paletteWithAlpha(mountAs, pick, null, entry) : paletteWithAlpha(mountAs, pick); } catch (e) { forced = null; }
      if (forced && forced.pal) {
        sff.palOverride = forced.pal;
        // A pick of one of the file's own v2.01 palette nodes brings that
        // node's alpha with it, as the engine's remapPal does - without this a
        // see-through entry drew at its alpha by default and opaque the moment
        // its own slot was picked. A slot the .def fills from an .act or a PNG
        // (Dr.Kira's are PNGs) has no alpha of its own and keeps today's rule.
        if (forced.alpha) sff.palOverrideAlpha = forced.alpha;
      }
    }
    try {
      return sffDecode.spritePng(sff, group, index);
    } finally {
      // EVERY field, because the sff is now a shared cache entry rather than a
      // fresh parse. Left set, one v1 preview would silently repaint every
      // later request for that character - which is the same class of bug this
      // whole pass was about.
      delete sff.palOverride;
      delete sff.palOverrideAlpha;
      delete sff.actPal;
    }
  } catch (e) {
    return null;
  }
}

// --- Character library + grid editing -------------------------------------
//
// THE LIBRARY / BUILD SPLIT. cache/ is the library: every character on disk.
// roster.chars is the BUILD: only what actually ships. A character can sit in
// the library indefinitely without being in the build - kept, but not exported
// - which is what you want for characters you are not ready to include and do
// not want to delete. Dragging one onto a cell is what puts it in the build.
//
// This is inherently a local-filesystem idea, so it is a MODKIT feature. The
// web Studio has no cache/ to browse.

// The ONLY keys persisted per character. Everything else on a roster entry is
// derived diagnostics injected by studioInfo() (sffVer, h, palKeysBroken,
// portraitSource, ...) which have been leaking into roster.json because the
// old save path used a denylist. roster.json is a file the user hand-edits and
// make-kit templates; cached diagnostics that outlive the condition they
// describe are worse than absent.
const CHAR_PERSIST = [
  'folder', 'select', 'mountAs', 'displayName',
  'stage', 'music', 'order', 'ordersurvival', 'ai', 'hidden', 'includestage', 'exclude',
  // Everything the editor does not model, by key. See charLine in motif-core.
  'params',
  // Real engine keys are select/next/previous (lowercase). There is no
  // slotselect/slotnext/slotprevious - nothing reads those.
  'select_', 'next', 'previous', 'slot', 'kind',
  // Select portraits fitted to a screenpack, per screenpack (portraitfit.js).
  // Not on this list = silently dropped by the next save of anything.
  'portraitFit',
  // Palettes the user added (custompal.js): [{ slot, file, name, base, ops }].
  'customPalettes',
  // The user's order of the palette slots (palorder.js): original slot numbers, new order.
  'paletteOrder',
  // The leaderboard art's win pose and colors (tools/extract-charart.js, for a
  // bundle with a leaderboard): an action number and a palette slot, set by
  // setBoardArt. The extractor has read them since it was written, and until they were listed
  // here every save of anything silently dropped them.
  'winAction', 'defaultPal',
  // E-Select's cell lock ('1'), on any entry - a character, a slot's member 0
  // (the cell's lock), or a skip/random/dummy placeholder. select.def is
  // generated, so the roster is the only place a lock can live; the build
  // writes it back out as the lock label comment (motif-core LOCK_LABEL).
  'locked',
  // The owner's word on a character's H role and the verdict confirmed in the
  // review queue (hmodule.js; written by /api/h-settings).
  'hRole', 'hReviewed',
  // The pause menu's Command List the export writes (cmdlist.js): the owner's
  // names, hidden moves and switch - { off?, names?: {state: name}, hidden?: [state] }.
  'commandList',
];

function cleanChar(c) {
  const out = {};
  for (const k of CHAR_PERSIST) {
    if (c[k] !== undefined && c[k] !== '' && c[k] !== null) out[k] = c[k];
  }
  return out;
}

// Every character on disk, flagged with whether it is in the build.
// ONE ROW PER ROSTER ENTRY, NOT PER FOLDER.
//
// A folder used to mean exactly one character, so a row could BE a folder and
// `inBuild` could be answered by looking the folder name up in a map keyed by
// mountAs. addCharVariant broke both halves: one folder now carries several
// entries, each with its own mountAs and its own .def. The old lookup only ever
// worked because addCharacter derives the folder from the mount name, so the
// two matched case-insensitively by construction - and a variant's does not.
// Result: 28 roster entries, 27 library rows, and the boss version could not be
// placed, found, or removed anywhere in the select-screen editor.
//
// STILL A DIRECTORY WALK, deliberately. It would read better as a walk over
// roster.chars, and that would be a silent disaster: ONDISK_IDS in grid.html is
// built from these rows, and the whole point of that set is that an entry whose
// FOLDER IS GONE has no row - which is what lights "NOT ON DISK - this
// character is in the build but its files are gone". Iterate the roster and
// every such entry gets a row, and the warning dies for exactly the case it
// exists to catch. Disk first, entries second.
//
// A folder also still emits a row for its MAIN def when no entry claims it, so
// a folder that is merely on disk behaves as before, AND removing the base
// entry while keeping a variant does not strand the main .def outside the
// editor. That row keeps id = folder, which is what setBuildOrder's miss path
// needs to re-mint the entry.
// A .def'S NAME AND AUTHOR, per version of the file (path|size@mtime). The
// library re-parsed every folder's .def on each call, and E-Select reloads the
// library after every edit it makes. The name is the re-encoded one (Shift-JIS,
// UTF-8) and '' when the def has none; the caller supplies its own fallback.
// A def that cannot be read throws, as the parse did, and is not remembered.
const DEF_NAME_CACHE = new Map();   // full path -> { stamp, value: { name, author } }
const DEF_NAME_CACHE_MAX = 8192;
function defNameAuthor(file) {
  const st = fs.statSync(file);
  const stamp = st.size + '@' + st.mtimeMs;
  const hit = DEF_NAME_CACHE.get(file);
  if (hit && hit.stamp === stamp) return hit.value;
  const d = sffDecode.parseDef(file);
  const value = { name: reencodeName(d.displayname || d.name), author: d.author || '' };
  DEF_NAME_CACHE.delete(file);
  DEF_NAME_CACHE.set(file, { stamp, value });
  if (DEF_NAME_CACHE.size > DEF_NAME_CACHE_MAX) DEF_NAME_CACHE.delete(DEF_NAME_CACHE.keys().next().value);
  return value;
}

function characterLibrary() {
  const roster = readRoster();
  const byFolder = new Map();
  for (const c of roster.chars) {
    if (!c || c.kind) continue;
    const k = String(c.folder || '').toLowerCase();
    if (!byFolder.has(k)) byFolder.set(k, []);
    byFolder.get(k).push(c);
  }
  const out = [];
  let dirs = [];
  try { dirs = fs.readdirSync(CACHE, { withFileTypes: true }); } catch (e) { dirs = []; }
  let folderCount = 0;
  for (const e of dirs) {
    if (!e.isDirectory()) continue;
    folderCount++;
    const id = e.name;
    const key = id.toLowerCase();
    const entries = byFolder.get(key) || [];
    let displayName = id;
    // AUTHOR and DEF PATH travel with the row. VSelect puts
    // `author - folder` under every name and it is the single most
    // useful thing in that list: a roster routinely holds three Makotos
    // by three authors, and the display name alone cannot tell them
    // apart. The def was already being parsed for the name, so this
    // costs nothing.
    // WHEN IT WAS ADDED. birthtime, not mtime: a character's folder is touched
    // whenever anything inside it is rewritten - a palette repair, a portrait
    // graft - so mtime answers "when did I last change this", which is a
    // different question and would shuffle the order under the user's hands.
    // Some filesystems do not carry a birthtime; mtime is the honest fallback,
    // and both are better than nothing.
    let addedMs = 0;
    try {
      const st = fs.statSync(path.join(CACHE, id));
      addedMs = st.birthtimeMs && st.birthtimeMs > 0 ? st.birthtimeMs : st.mtimeMs;
    } catch (err) { addedMs = 0; }

    let author = '', def = '';
    try {
      const defName = findMainDef(path.join(CACHE, id));
      if (defName) {
        def = defName;
        const d = defNameAuthor(path.join(CACHE, id, defName));
        // REENCODED HERE TOO, not only in rowFor's re-parse branch. parseDef
        // reads the .def as latin1, so a Shift-JIS name arrives as raw bytes.
        // rowFor short-circuits to THIS value for any row whose def is the
        // folder's main one - which is every ordinary character - so leaving it
        // raw meant the main row showed mojibake while a variant row out of the
        // same folder showed the name correctly, and the garbled one sorted to
        // the top of the library because U+0090 leads.
        displayName = d.name || id;
        author = d.author;
      }
    } catch (err) { /* a broken def costs a nice name, not the row */ }
    // THE ROW'S NAME AND AUTHOR COME FROM THE ENTRY'S OWN .def, not the
    // folder's main one - that is the entire difference between the two
    // GBDeath rows ("Death" vs "Death (Boss)"). reencodeName is the same
    // treatment studioInfo gives it, so a Shift-JIS name reads the same on
    // both surfaces instead of only in the Studio.
    const rowFor = (defName, entry) => {
      let nm = displayName, au = author;
      if (defName && defName.toLowerCase() !== String(def || '').toLowerCase()) {
        try {
          const d = defNameAuthor(path.join(CACHE, id, defName));
          nm = d.name || id;
          au = d.author;
        } catch (err) { /* a broken def costs a nice name, not the row */ }
      }
      return {
        // `id` IS THE BUILD HANDLE, and it carries two meanings on purpose,
        // because setBuildOrder forces both: an entry already in the build is
        // addressed by its mountAs (the bySlug hit path), and a folder that is
        // not is addressed by its folder name (the miss path, which mints the
        // entry from findMainDef). Anything that wants a DISK PATH must use
        // `folder` below - never this.
        id: entry ? entry.mountAs : id,
        folder: id,
        def: defName || def,
        displayName: nm,
        author: au,
        addedMs,
        inBuild: !!entry,
        // Position in roster.chars. NOT a cell index - a slot block of N
        // entries occupies ONE cell, which is why motifSelectInfo walks slot
        // groups instead of counting entries. Nothing reads this today; derive
        // a real cell index the way motifSelectInfo does before trusting it.
        index: entry ? roster.chars.findIndex((c) => c.mountAs === entry.mountAs) : -1,
      };
    };

    const claimed = new Set();
    for (const c of entries) {
      // charSource resolves an entry's def the same way: the select value is
      // "<mountAs>/<def>", so the tail after the first segment is the def.
      const own = String(c.select || '').split('/').slice(1).join('/') || def;
      if (own) claimed.add(own.toLowerCase());
      out.push(rowFor(own, c));
    }
    // The folder's own main def, when nothing in the build claims it.
    //
    // SUPPRESSED IF ITS ID IS ALREADY TAKEN. This row's id is the folder name,
    // and an entry row's id is its mountAs - which for an ordinary character IS
    // the folder name. If an entry on a NON-main def happens to carry the folder
    // name as its mountAs (reachable from a hand-edited roster.json, which this
    // project treats as a supported input), both rows key on the same lowercase
    // id: grid.html would draw the main-def row as already-in-build, hide it
    // from the Excluded tab and refuse to drag it. That is the exact
    // "present but unplaceable" bug this rewrite exists to remove.
    const idsHere = new Set(out.map((r) => String(r.id).toLowerCase()));
    if (def && !claimed.has(String(def).toLowerCase()) && !idsHere.has(key)) {
      out.push(rowFor(def, null));
    }
  }
  out.sort((a, b) => String(a.displayName).localeCompare(String(b.displayName)));
  // onDisk STAYS A FOLDER COUNT. grid.html prints it as "N on disk" and that
  // counter has already been repaired once for miscounting; rows and folders
  // are no longer the same number.
  return { chars: out, inBuild: roster.chars.length, onDisk: folderCount };
}

// Rewrite which characters are in the build and in what cell order.
// `order` is an array of mountAs ids, densely packed in cell order; anything
// omitted drops out of the BUILD but stays on disk.
// `entries` is the editor's flat cell list. Each is either a placeholder
// ({kind:'skip'|'random'|'dummy', locked?}) or a character ({id, slot?,
// locked?}). Characters keep their existing select.def properties; only
// membership, order and slot grouping are rewritten here.
//
// opts (E-Select's Save):
//   backup     copy roster.json into <bundle>/backups/ first (vfslib
//              backupRoster); the copy's relative path comes back as `backup`
//   lockLabel  the label locked cells are written with, kept as
//              roster.lockLabel - and only when it is not the default, so a
//              roster that never changed it stays byte-identical
function setBuildOrder(entries, opts) {
  const o = opts || {};
  const roster = readRoster();
  const bySlug = new Map(roster.chars.map((c) => [String(c.mountAs).toLowerCase(), c]));
  const next = [];
  // A LOCK SENT IS A LOCK SET: truthy ('1', 1, true) locks, and '', '0', 0,
  // false or null unlock. Not sent at all means "not mine to change" for a
  // CHARACTER - the roster's value stands, the way `exclude` works below, so
  // the Studio's own saves (which know nothing of locks) cannot unlock one.
  // A placeholder has no identity to look its old value up by, so for one,
  // not sent means unlocked: whoever saves placeholders must send `locked`.
  const lockFrom = (spec, entry) => {
    if (spec.locked === undefined) return;
    if (motifCore.isLockOn(spec.locked)) entry.locked = '1'; else delete entry.locked;
  };
  for (const e of entries) {
    const spec = typeof e === 'string' ? { id: e } : (e || {});
    // A RAW select.def LINE IS REFUSED, not dropped. The Select Screen editor
    // once stored one on an empty cell ({raw}); the roster has no such entry,
    // so this loop dropped it and every later cell moved up one. There is no
    // safe way to carry one (GRAIL 4.12): each shape a typed line can take is
    // either modeled already or breaks the grid. Nothing is written.
    if (spec.raw !== undefined) {
      return {
        error: 'refusing to save: a cell holds a typed select.def line ('
          + JSON.stringify(String(spec.raw)) + '), which the Studio does not write - '
          + 'select.def is generated from the cells. Make that cell empty, a skipslot, '
          + 'a random select or a character, then save again.',
      };
    }
    // A NAMED SET, so a fourth kind cannot repeat this silently. Anything
    // that is not a character and not a known placeholder falls through to
    // the `if (!cid) continue` below and is DROPPED: the grid keeps drawing
    // the cell, the roster stores one fewer, and every later cell shifts on
    // the next reload. Widening this to a bare `if (spec.kind)` would only
    // move the same failure into buildCharacterLines, so the set is explicit.
    if (PLACEHOLDER_KINDS.has(spec.kind)) {
      // Rebuilt as {kind} and nothing else, which is what used to drop a
      // lock on every save: carry it.
      const ph = { kind: spec.kind };
      lockFrom(spec, ph);
      next.push(ph);
      continue;
    }
    // The editor sends `char`; older callers sent `id` or a bare string. Accept
    // all three rather than silently dropping entries - getting this wrong
    // empties the roster, which is exactly what it did the first time.
    const cid = spec.char || spec.id;
    if (!cid) continue;
    const key = String(cid).toLowerCase();
    const existing = bySlug.get(key);
    let entry;
    if (existing) {
      entry = cleanChar(existing);
    } else {
      // Newly added from the library: build the entry the way addCharacter does.
      //
      // RESOLVED AGAINST THE REAL LISTING, not fs.existsSync. On Windows
      // existsSync('cache/DongHwan') is true while the directory is actually
      // 'donghwan', so the old form minted a roster entry whose `folder` was
      // spelled the way the CLIENT happened to send it. That survives here and
      // breaks on any case-sensitive host - and it is reachable today from a
      // hand-edited roster.
      const real = (() => {
        try {
          return fs.readdirSync(CACHE, { withFileTypes: true })
            .find((d) => d.isDirectory() && d.name.toLowerCase() === key);
        } catch (err) { return null; }
      })();
      if (!real) continue;
      const dir = path.join(CACHE, real.name);
      const defName = findMainDef(dir);
      if (!defName) continue;
      entry = { folder: real.name, select: real.name + '/' + defName, mountAs: real.name };
    }
    // Slot grouping is owned by the grid, not by the character record: a group
    // only means anything as a run of consecutive entries.
    if (spec.slot) entry.slot = spec.slot; else delete entry.slot;
    // The CYCLE KEYS travel with the slot. Without them the block still parses,
    // but a player cannot switch between its members, which makes sharing a cell
    // pointless - and they must be on EVERY member with the SAME value or the
    // engine's cycling code indexes past the end of the group.
    //
    // AN OMITTED KEY KEEPS WHAT THE ROSTER HAS. This used to read "not sent" as
    // "cleared", which was right for the old grid inside studio.html (it sent
    // every key) and wrong for the Select Screen editor, whose save list carried
    // only `char` and `slot`: every Save there deleted the keys the slot pane had
    // written through /api/char-props, and the Makoto cell stopped cycling with
    // Q and E still bound. Only an explicit value (or an explicit '') changes a
    // key now; leaving the slot still clears both, since outside a block they
    // mean nothing.
    for (const k of ['next', 'previous']) {
      if (!spec.slot) { delete entry[k]; continue; }
      if (spec[k] === undefined || spec[k] === null) continue;
      if (String(spec[k]).trim()) entry[k] = String(spec[k]).trim(); else delete entry[k];
    }
    // ON THE GRID OR OFF IT, when the editor says: its off-grid list comes back
    // with exclude '1', and a character dragged from that list onto a cell with
    // exclude ''. Not sent (the older callers): the roster's value stands.
    if (spec.exclude !== undefined && spec.exclude !== null) {
      if (String(spec.exclude).trim()) entry.exclude = String(spec.exclude).trim(); else delete entry.exclude;
    }
    lockFrom(spec, entry);
    next.push(entry);
  }
  // NOTHING IS TRIMMED. A trailing skipslot is not the padding this used to
  // assume: start.lua:996 lets the cursor enter a cell when
  // `char ~= nil OR moveoveremptyboxes` AND `skip ~= 1`, so with
  // moveoveremptyboxes on - which both packs shipped here set - an unused cell
  // is reachable and a skipslot is not. Popping them on save quietly undid
  // every deliberate one, including whole rows filled from the editor, and a
  // trailing randomselect is a cell the player can actually pick.

  // SAFETY NET. A caller that sends entries in a shape this function does not
  // recognize resolves every one of them to nothing and silently empties the
  // roster. That is exactly what a `char` vs `id` field-name mismatch did on
  // first wiring, and only an out-of-band backup saved it. Emptying a roster
  // must be explicit: send [] to do it on purpose.
  const kept = next.filter((c) => !c.kind).length;
  if (entries.length > 0 && kept === 0 && roster.chars.length > 0) {
    return {
      error: 'refusing to empty the roster: ' + entries.length
        + ' entries were sent but none resolved to a character. '
        + 'Send an empty array if you really mean to clear it.',
    };
  }
  // The backup is of the file as it was BEFORE this save, so it is taken only
  // once the save is certain to happen (the refusal above writes nothing, and
  // a backup of an unchanged file would be clutter) and before the write.
  const backup = o.backup ? require('./vfslib').backupRoster() : undefined;
  roster.chars = next;
  if (o.lockLabel !== undefined && o.lockLabel !== null) {
    // Stored as typed (one line, capped), and removed again when it is set
    // back to the default - `LOCKED` and `; LOCKED` both write `; LOCKED`.
    const label = String(o.lockLabel).replace(/[\r\n]+/g, ' ').trim().slice(0, 80);
    if (!label || motifCore.lockComment(label) === motifCore.LOCK_LABEL) delete roster.lockLabel;
    else roster.lockLabel = label;
  }
  writeRoster(roster);
  const out = {
    ok: true,
    inBuild: next.filter((c) => !c.kind || c.kind === 'char').length,
    // CELLS, not entries: a slot block is several entries in one cell and an
    // off-grid entry is in none (cellIndexes walks it the engine's way). The
    // page says "N characters across M cells" from this.
    cells: cellIndexes(next).count,
  };
  if (o.backup) out.backup = backup;
  return out;
}

// ARCADE LADDER LENGTH per order tier, the select.def [Options] *.maxmatches
// rows. Ten slots per mode: slot N is how many characters of `order = N+1`
// the ladder draws. These were hardcoded in the exporter, so a roster could
// be ordered carefully and the ladder would ignore it.
//
// Values are clamped to integers and to ten slots. -1 is meaningful and kept:
// survival.maxmatches = -1 is the engine's 'no limit'.
const MAXMATCH_MODES = ['arcade', 'team', 'timeattack', 'survival'];
function setMaxMatches(mm) {
  const roster = readRoster();
  const out = {};
  for (const mode of MAXMATCH_MODES) {
    const v = mm && mm[mode];
    if (!Array.isArray(v)) continue;
    const row = [];
    for (let i = 0; i < 10; i++) {
      const n = Math.trunc(Number(v[i]));
      row.push(Number.isFinite(n) ? Math.max(-1, Math.min(999, n)) : 0);
    }
    out[mode] = row;
  }
  // An empty object clears the override and restores the exporter defaults,
  // which is the only way back to 'whatever it used to do'.
  if (Object.keys(out).length) roster.maxMatches = out;
  else delete roster.maxMatches;
  writeRoster(roster);
  return { ok: true, maxMatches: roster.maxMatches || null };
}

// Patch one character's select.def properties.
//
// opts.keepCell (E-Select, excluding a character while Preferences › Lock
// cells is on and a locked cell comes after it): exclude = 1 gives the cell to
// the next character, which moves every later cell back by one - the locked
// ones too. With keepCell the cell the character leaves is filled with an
// unused cell (a dummyslot placeholder) right where it stood, so nothing after
// it moves. Only when the edit really vacated a cell: a slot member whose
// block keeps others is not one. The answer says so (`keptCell`).
function setCharProps(mountAs, props, opts) {
  const roster = readRoster();
  const c = roster.chars.find((x) => String(x.mountAs).toLowerCase() === String(mountAs).toLowerCase());
  if (!c) return { error: 'not in build: ' + mountAs };
  const before = cellIndexes(roster.chars);
  const was = before.at[roster.chars.indexOf(c)];
  const allowed = ['stage', 'music', 'order', 'ordersurvival', 'ai', 'hidden', 'includestage', 'exclude', 'params',
    'select_', 'next', 'previous', 'slot', 'kind', 'displayName'];
  for (const k of allowed) {
    if (!(k in props)) continue;
    const v = props[k];
    if (v === '' || v === null || v === undefined) delete c[k];
    else c[k] = v;
  }
  let keptCell = null;
  if (opts && opts.keepCell && was !== null && cellIndexes(roster.chars).count < before.count) {
    roster.chars.splice(roster.chars.indexOf(c), 0, { kind: 'dummy' });
    keptCell = was;
  }
  roster.chars = roster.chars.map(cleanChar);
  writeRoster(roster);
  return Object.assign({ ok: true, char: cleanChar(c) }, keptCell !== null ? { keptCell } : {});
}

// --- Motif select-screen geometry -----------------------------------------
//
// Everything the Studio needs to draw the REAL character-select grid rather
// than an abstract table: where it sits, how big the cells are, and which
// sprite each cell shows. Read from the motif's system.def [Select Info], so
// switching screenpack changes the editor's layout the way it changes the
// game's.
//
// Values here are in the motif's OWN localcoord space (1280x720 for ikemen1),
// not pixels. The caller scales; storing pre-scaled numbers would bake in one
// viewport size.
// EXCLUDE = 1 TAKES NO CELL. main.lua sets such a line aside while it fills the
// grid (main.lua:1597 matches `exclude = 1` on the raw line) and adds it only
// after every cell is placed (main.lua:1686-1695), so the NEXT character takes
// the cell and nothing is left empty. The character still loads - its files are
// in the build for any other character that reads them (divesim's
// chars/Dhalsim/ state files) - it is just not on the grid. Drawn any other
// way, every cell after it was one off from the game.
const isOffGrid = (c) => !!c && !c.kind && /^\s*1/.test(String(c.exclude == null ? '' : c.exclude));

// One cell record. Variant index/count let the editor show "N variants" and
// draw only member 0 in the grid, which is what the select screen does.
function mkCell(c, cell, row, col, variant, variants) {
  return {
    index: cell, row, col, variant, variants,
    kind: c.kind || 'char',
    char: c.mountAs || null,
    displayName: c.displayName || c.mountAs || (c.kind === 'skip' ? '(empty)' : '(random)'),
    props: {
      stage: c.stage || '', music: c.music || '',
      order: c.order === undefined ? '' : c.order,
      ordersurvival: c.ordersurvival === undefined ? '' : c.ordersurvival,
      ai: c.ai === undefined ? '' : c.ai,
      hidden: c.hidden === undefined ? '' : c.hidden,
      includestage: c.includestage === undefined ? '' : c.includestage,
      exclude: c.exclude === undefined ? '' : c.exclude,
      params: (c.params && typeof c.params === 'object') ? c.params : {},
      slot: c.slot || '', select_: c.select_ || '',
      next: c.next || '', previous: c.previous || '',
      // '1' or ''. On placeholders too: a locked empty cell is a lock.
      locked: motifCore.isLockOn(c.locked) ? '1' : '',
    },
  };
}

// WHERE THE CURRENT MOTIF'S system.def IS. Config.Motif is a vpath like
// 'data/ikemen1/system.def', and this resolves it to a file the same way the
// VFS does - SAME ORDER, HIGHEST PRIORITY FIRST.
//
// `themes/` comes first because that is how the build is layered: vfslib walks
// it as Layer 2, after the release bundles, and a later walk overrides an
// earlier one - so a dropped screenpack named after a built-in deliberately
// replaces it. Resolving in any other order would hand the editor a different
// file from the one the game boots.
//
// A SCREENPACK INSTALLED BY THE STUDIO LIVES IN themes/, AND THIS DID NOT LOOK
// THERE. Only the two release roots were searched, so every pack the user
// dropped in resolved to null: the Studio reported "This screenpack has no
// [Select Info] grid" for a pack whose [Select Info] was perfectly good, the
// select editor could not open it, and every sprite 404'd. The editor worked
// for exactly the two screenpacks that ship in the repo (field-hit
// 2026-09-03).
//
// This used to be inline in motifSelectInfo while motifSpritePng did its own,
// hardcoded to release-v2 - so a screenpack living in release/ resolved for its
// GEOMETRY and 404'd for every SPRITE. That is a whole screenpack rendering
// with no cell art, no cursor and no background, which is exactly what the
// shipped Big MUGEN1 pack did.
//
// NEVER OUTSIDE ITS BASE. roster.motif comes from a file anyone can write
// (/api/roster takes a whole roster), and a path.join of '../../x' onto a base
// is simply somewhere else - with /api/motif-def writing whatever text it is
// sent to the answer, that was a write to any existing file the traversal
// reached. Each candidate is resolved and must stay inside the base it came
// from; one that leaves it is not a screenpack of this build.
function motifDefPath(roster) {
  const r = roster || readRoster();
  const rel = String(r.motif || 'data/ikemen1/system.def').replace(/^data\//, '');
  for (const base of [THEMES,
                      path.join(layout.dir('release-v2'), 'data'),
                      path.join(layout.dir('release'), 'data')]) {
    const root = path.resolve(base);
    const p = path.resolve(root, rel);
    if (!p.startsWith(root + path.sep)) continue;
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// IS THIS A SCREENPACK PATH AS A ROSTER SPELLS ONE? '' (the default) or a
// vpath under data/ ending in .def - data/ikemen1/system.def - with no dot
// segments, no backslash, no drive or stream colon and nothing a file name
// cannot hold. The shape alone; motifDefPath decides whether it exists.
function motifVpathOk(v) {
  if (v === '' || v === undefined || v === null) return true;
  if (typeof v !== 'string' || v.length > 400) return false;
  if (!/^data\//i.test(v) || !/\.def$/i.test(v)) return false;
  if (/[\\:*?"<>|\x00-\x1f]/.test(v)) return false;
  return !v.split('/').some((s) => s === '' || s === '.' || s === '..');
}

// The .sff a motif names, resolved against the DEF'S OWN FOLDER. The entry is
// often relative and may climb out of it - Big MUGEN1 says
// `spr = ../mugen1/system.sff` - so the case-insensitive fallback has to look
// in the folder the entry points AT, not in the def's folder.
function motifSffPath(defPath, sprEntry) {
  if (!defPath || !sprEntry) return null;
  const target = path.join(path.dirname(defPath), String(sprEntry).replace(/\\/g, '/'));
  if (fs.existsSync(target)) return target;
  const dir = path.dirname(target);
  const want = path.basename(target).toLowerCase();
  try {
    const hit = fs.readdirSync(dir).find((f) => f.toLowerCase() === want);
    if (hit) return path.join(dir, hit);
  } catch (e) { /* the folder the entry points at may not exist */ }
  return null;
}

// A STAGE'S OWN NAME: its [Info] displayname, else its name, read and
// re-encoded (Shift-JIS, UTF-8) the way the library names a character. Kept
// per file version: every edit in E-Select reloads the Stages tab, and the
// stages folder rarely changes between two. '' when the def names nothing.
const STAGE_NAME_CACHE = new Map();   // full path -> { stamp, name }
function stageDefName(file) {
  let stamp = '';
  try { const st = fs.statSync(file); stamp = st.mtimeMs + ':' + st.size; } catch (e) { return ''; }
  const hit = STAGE_NAME_CACHE.get(file);
  if (hit && hit.stamp === stamp) return hit.name;
  let name = '';
  try {
    const d = sffDecode.parseDef(file);
    name = String(reencodeName(d.displayname || d.name) || '').trim();
  } catch (e) { name = ''; }
  STAGE_NAME_CACHE.set(file, { stamp, name });
  return name;
}

function motifSelectInfo() {
  const roster = readRoster();
  const defPath = motifDefPath(roster);
  const rel = String(roster.motif || 'data/ikemen1/system.def').replace(/^data\//, '');
  if (!defPath) return { error: 'motif not found: ' + rel };

  const text = fs.readFileSync(defPath, 'latin1');
  const parsed = motifCore.parseMotif(text);

  // GEOMETRY OF ONE MOTIF SPRITE. Two of them matter to the grid: the cell
  // box, and the random-select icon. Resolved here rather than through
  // motifSpritePng, which calls this function and would recurse. The .sff is
  // opened at most once however many sprites are asked for.
  let motifSff;
  const geomOf = (spr) => {
    if (!spr) return null;
    try {
      if (motifSff === undefined) {
        const sffPath = motifSffPath(defPath, parsed.spr);
        motifSff = sffPath ? motifSffAt(sffPath) : null;
      }
      const g = motifSff && sffDecode.spriteGeom(motifSff, spr[0], spr[1]);
      return g ? { w: g.w, h: g.h, axisX: g.axisX, axisY: g.axisY } : null;
    } catch (e) { return null; }
  };

  return {
    motif: rel,
    // The screenpack's own name, which is what VSelect shows in its breadcrumb.
    name: parsed.name || rel,
    author: parsed.author,
    // GEOMETRY OF THE CELL BOX SPRITE. The drawn size of a cell is that
    // sprite times the row's scale - NOT cell.size times a scale ratio.
    // ikemen1's box is 106x106 for a nominal 24x24 cell, so it is deliberately
    // larger than its slot and neighboring boxes OVERLAP by a pixel or two.
    // Sizing from cell.size instead leaves a gap between every slot, which is
    // the artifact VSelect has.
    cellBg: geomOf(parsed.select.cellBgSpr),
    // THE RANDOM-SELECT ICON. Drawn instead of a portrait on a randomselect
    // cell (start.lua:2547-2553), anchored at the PORTRAIT's offset rather
    // than the cell's, and at its own natural size - it is not stretched to
    // fill the cell the way this editor draws portraits, so it needs its real
    // width, height and axis.
    randomIcon: geomOf(parsed.select.randomSpr),
    // Arcade ladder length per order tier; null when the roster has no
    // override and the exporter's own defaults apply.
    maxMatches: roster.maxMatches || null,
    // The select screen's own BACKGROUND: layer stack plus the motif's
    // animations, so the editor can draw what the game draws instead of a
    // grid on black. Purely presentational - nothing here is written back.
    bg: motifCore.parseSelectBG(text),
    actions: motifCore.parseActions(text),
    // THE AXIS OF EVERY SPRITE THE BACKGROUND DRAWS.
    //
    // A background element is positioned by its sprite's AXIS, not by its top
    // left corner: anim.go:1016 offsets the draw by spr.Offset, so the element's
    // `start` is where the axis lands and the corner is start - axis. Without
    // these the editor drew every layer corner-first.
    //
    // The effect is invisible while a pack's background sprites happen to have
    // a zero axis, which is true of both packs in the repo. CVS2 does not: its
    // grid backing panel is 640x196 with axis 320,0 and `start = 0,264`, so the
    // corner belongs at -320 - the left edge of a 640-wide screen - and drawing
    // it at 0 put a black slab over the right half of the grid. Its "PLAYER
    // SELECT" plate has axis -269,25 and would sit hard against the left edge
    // instead of centered.
    //
    // Only the sprites the layers actually reference are measured, animation
    // frames included, so this is a handful of table lookups in an SFF that is
    // already open.
    bgSprites: (() => {
      const out = {};
      const bg = motifCore.parseSelectBG(text);
      const acts = motifCore.parseActions(text);
      const add = (g, i) => {
        if (g == null || i == null) return;
        const k = g + ',' + i;
        if (k in out) return;
        out[k] = geomOf([g, i]);
      };
      for (const l of (bg && bg.layers) || []) {
        if (l.spriteno) add(l.spriteno[0], l.spriteno[1]);
        const frames = l.actionno != null && acts ? acts[l.actionno] : null;
        for (const f of frames || []) add(f.group, f.index);
      }
      // THE CURSOR TOO. It is drawn at its sprite's own size times the cursor
      // element's scale, NOT stretched to the cell - CVS2's is 59x70 in a 36x36
      // cell and is meant to overhang - so its frames have to be measured like
      // any other motif sprite.
      const cur = parsed.select.cursors || {};
      for (const side of ['p1', 'p2']) {
        const cc = cur[side];
        if (!cc) continue;
        if (cc.spr) add(cc.spr[0], cc.spr[1]);
        for (const f of (cc.anim != null && acts ? acts[cc.anim] : null) || []) {
          add(f.group, f.index);
        }
      }
      return out;
    })(),
    // Same table under the name the cursor renderer looks for; the background
    // and the cursor both animate out of the motif's own actions.
    motifActions: motifCore.parseActions(text),
    // Each action's Loopstart, which the arrays above lose on the way through
    // JSON: the engine loops a motif animation back to it (anim.go:675-676,
    // 834), so the cursor and the background do too. Only the non-zero ones.
    actionLoops: (() => {
      const out = {};
      for (const [no, fr] of Object.entries(motifCore.parseActions(text))) if (fr.loopStart > 0) out[no] = fr.loopStart;
      return out;
    })(),
    localcoord: parsed.localcoord,
    spr: parsed.spr,
    select: parsed.select,
    // Cell index is DERIVED, not the array index. A slot block of N members
    // occupies ONE cell (csCell advances on the closing brace, not per member),
    // while skipslot/randomselect each consume one. Walking is the only correct
    // way to map an entry to a cell once blocks exist.
    cells: (() => {
      const cols = parsed.select.columns || 1;
      const out = [];
      let cell = 0;
      let i = 0;
      const arr = roster.chars;
      while (i < arr.length) {
        const c = arr[i];
        if (isOffGrid(c)) { i++; continue; }      // no cell: see isOffGrid
        const group = [];
        // `!kind`, to match every other slot walk in the tree. As an
        // exclusion list this absorbed any new placeholder that happened to
        // carry a slot id - cleanChar persists `slot` and `kind` together -
        // and collapsed two cells into one.
        if (c.slot && !c.kind) {
          while (i < arr.length && arr[i].slot === c.slot
                 && !arr[i].kind) { if (!isOffGrid(arr[i])) group.push(arr[i]); i++; }
        } else { group.push(c); i++; }
        for (let k = 0; k < group.length; k++) {
          const g = group[k];
          out.push(mkCell(g, cell, Math.floor(cell / cols), cell % cols, k, group.length));
        }
        cell++;
      }
      return out;
    })(),
    // In the build, off the grid: the editor lists them beside the library and
    // sends them back with every save, or the save would drop them.
    offGrid: (roster.chars || []).filter(isOffGrid).map((c) => mkCell(c, null, null, null, 0, 1)),
    // Available stages and music, so the inspector offers real choices rather
    // than a free-text box the engine will silently ignore.
    stages: (roster.stages || []).map((s) => s.file),
    // The same stages with their detail, for the Stages tab. `stages` above
    // stays a flat list of names because the inspector's dropdown wants
    // exactly that.
    stageList: (roster.stages || []).map((s) => ({
      file: s.file,
      name: s.name || s.file,
      // A stage may carry SEVERAL tracks; the engine picks one per match.
      music: Array.isArray(s.music) ? s.music.filter(Boolean) : (s.music ? [s.music] : []),
    })),
    // THE STAGE FILES THIS BUILD HAS, for the Stages tab's "would not load"
    // mark: a stage a character names that is neither in [ExtraStages] nor
    // one of these gets it. The .def files of the bundle's stages folder,
    // where stages sit flat (addStage), read once per load rather than asked
    // for one stage at a time.
    stageFiles: (() => {
      try {
        return fs.readdirSync(layout.dir('stages'), { withFileTypes: true })
          .filter((e) => e.isFile() && /\.def$/i.test(e.name)).map((e) => e.name);
      } catch (e) { return []; }
    })(),
    // ...AND THE ENGINE'S OWN STOCK STAGES, which every build carries beside
    // the bundle's: the web build mounts release-v2's stages (minus the two
    // 3D demos, left out for their 24 MB, vfslib build), and a desktop
    // export unpacks the same set from the engine's zip. A character naming
    // stages/stage0.def loads it though the bundle has no copy, so it must
    // not read as missing.
    engineStageFiles: (() => {
      if (!process.env.IKEMEN_V2) return [];
      try {
        return fs.readdirSync(path.join(layout.dir('release-v2'), 'stages'), { withFileTypes: true })
          .filter((e) => e.isFile() && /\.def$/i.test(e.name) && !/^stage3d/i.test(e.name)).map((e) => e.name);
      } catch (e) { return []; }
    })(),
    // WHAT THOSE STAGES CALL THEMSELVES, for a stage a character names that
    // [ExtraStages] does not list: { lowercased file: name }, the bundle's
    // own copy first. Beside the two lists rather than in them, which stay
    // plain file names.
    stageNames: (() => {
      const out = {};
      const add = (dir) => {
        let names = [];
        try { names = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile() && /\.def$/i.test(e.name)).map((e) => e.name); }
        catch (e) { return; }
        for (const f of names) {
          const k = f.toLowerCase();
          if (k in out) continue;
          const nm = stageDefName(path.join(dir, f));
          if (nm) out[k] = nm;
        }
      };
      add(layout.dir('stages'));
      if (process.env.IKEMEN_V2) add(path.join(layout.dir('release-v2'), 'stages'));
      return out;
    })(),
    // THE BUILD'S MUSIC COMES FROM THE music/ FOLDER, not from the roster:
    // roster.music does not exist, so every music dropdown in the editor was
    // silently empty. studioInfo has always read the folder; this matches it.
    music: (() => {
      const out = [];
      try {
        for (const f of fs.readdirSync(MUSIC)) {
          if (/[.](ogg|mp3|wav|flac|xm|mod|it|s3m)$/i.test(f)) out.push('sound/' + f);
        }
      } catch (e) { /* a build need not ship music */ }
      return out;
    })(),
  };
}

// Decode a sprite out of the MOTIF's system.sff (cell backgrounds, the random
// icon) rather than a character's. Same decoder, different file.
// Decoding one sprite out of the motif's .sff re-read the whole file every
// time, and a select screen asks for the cell box, the random icon and every
// cursor frame. Cached against the file's own stamp, like the character
// diagnosis.
let MOTIF_SFF_CACHE = null;
function motifSff() {
  const defPath = motifDefPath();
  if (!defPath) return null;
  // the def parsed once per version of the file, not once per sprite
  const parsed = motifParsedAt(defPath);
  if (!parsed) return null;
  const sffPath = motifSffPath(defPath, parsed.spr);
  if (!sffPath) return null;
  return motifSffAt(sffPath);
}
// The decoded motif .sff at a path, while the file keeps its size and time.
// motifSelectInfo measures the cell box, the random icon and every select
// background and cursor sprite in it, and read the whole file (16 MB for
// ikemen1) on each E-Select load and Studio refresh. Read-only to callers.
function motifSffAt(sffPath) {
  let stamp = '-';
  try { const st = fs.statSync(sffPath); stamp = st.size + '@' + st.mtimeMs; } catch (e) { /* gone */ }
  const key = sffPath + '|' + stamp;
  if (MOTIF_SFF_CACHE && MOTIF_SFF_CACHE.key === key) return MOTIF_SFF_CACHE.sff;
  let sff = null;
  try { sff = sffDecode.readSff(sffPath); } catch (e) { sff = null; }
  // only a file that decoded is kept: one that would not read (busy) or is not
  // an .sff is read again by the next sprite or select-info question
  if (sff) MOTIF_SFF_CACHE = { key, sff };
  return sff;
}

function motifSpritePng(group, index) {
  try {
    const sff = motifSff();
    if (!sff) return null;
    return sffDecode.spritePng(sff, group, index);
  } catch (e) {
    return null;
  }
}

// ---- sound-call audit ----
//
// Which sounds a character's own state code asks for, against what its .snd
// actually holds. A PlaySnd, hitsound or guardsound naming a group,index the
// .snd lacks plays NOTHING and the engine says nothing: Snd.Get returns nil
// and Play returns. Dr.Kira's "missing" slam sounds cost an afternoon of
// engine tracing before the answer turned out to be that her throw states
// play voice groups and there is no impact sample at all - this report says
// that in one line.
//
// What counts as the character's own sound: PlaySnd `value = G,N` and
// `value = SG,N` (S is the default), `hitsound`/`guardsound` only with the S
// prefix (their default is F, the common fight sounds), and the same in ZSS
// (`playSnd{value: ...}`, `hitSound:`). F-prefixed calls go to common.snd and
// are counted, not checked. Computed values (`Svar(58),N`, `random%7`,
// `G + var(1), 0`) cannot be resolved from the file and are counted as such -
// this is a lower bound, never an exhaustive proof.
//
// Loudness: `volumescale` (percent, default 100) at or above LOUD_SCALE and
// the legacy `volume` (an offset the engine turns into roughly +N*25/128
// percent; 255 is about +50) at or above LOUD_LEGACY are listed. They are
// the signature of the ear-splitting H-edit sounds the engine now caps.
const LOUD_SCALE = 150, LOUD_LEGACY = 128;

// Every `group,index` a .snd holds. The container is a flat chain:
// 'ElecbyteSnd\0', count at 0x10, first entry at 0x14; each entry is
// nextOfs, len, group, index then WAV bytes. Same walk as optimize-audio.js.
function sndKeySet(file) {
  let b;
  try { b = fs.readFileSync(file); } catch (e) { return null; }
  if (b.length < 24 || b.slice(0, 11).toString('latin1') !== 'ElecbyteSnd' || b[11] !== 0) return null;
  const num = b.readUInt32LE(16);
  let off = b.readUInt32LE(20);
  const keys = new Set();
  for (let i = 0; i < num && off + 16 <= b.length; i++) {
    // LoadSnd filters `gn[0] >= 0 && gn[1] >= 0` (sound.go LoadSndFiltered):
    // a negative-keyed entry never reaches the table, so it is not "held".
    const g = b.readInt32LE(off + 8), n = b.readInt32LE(off + 12);
    if (g >= 0 && n >= 0) keys.add(g + ',' + n);
    const next = b.readUInt32LE(off);
    if (!next || next <= off) break;
    off = next;
  }
  return keys;
}

// One sound reference: `S1,0` / `F1,0` / `1,0` / an expression. Returns
// {prefix, group, index} for a literal, {computed: true} otherwise.
function parseSoundRef(raw) {
  const v = String(raw || '').replace(/\s+/g, '');
  const m = /^([SsFf]?)(-?\d+),(-?\d+)$/.exec(v);
  if (!m) return { computed: true, raw: String(raw || '').trim() };
  return { prefix: m[1].toUpperCase(), group: +m[2], index: +m[3], raw: String(raw || '').trim() };
}

// Calls in one state file. CNS is walked block by block (a `[State]` header
// resets the current sctrl type; `value =` is a sound only when the type is
// PlaySnd); hitsound/guardsound lines count wherever they are. ZSS is
// matched by structure: playSnd{ ... value: ... } and hitSound:/guardSound:.
function soundCallsIn(text, rel) {
  const calls = [], loud = [];
  const isZss = /\.zss$/i.test(rel);
  // Returns the call it recorded, so a loud check can read the value's prefix.
  const push = (kind, ref, line) => {
    const r = parseSoundRef(ref);
    // PlaySnd defaults to the character's own file; hitsound/guardsound to
    // the common fight sounds (MUGEN: "prefix with S for the character's own").
    // A negative literal is "no sound" - the engine drops such keys at load.
    const own = kind === 'playsnd' ? r.prefix !== 'F' : r.prefix === 'S';
    const none = !r.computed && (r.group < 0 || r.index < 0);
    const c = Object.assign({ file: rel, line, kind,
      target: r.computed ? 'unknown' : none ? 'none' : (own ? 'own' : 'common') }, r);
    calls.push(c);
    return c;
  };
  const loudFrom = (kv, blockLine, ref) => {
    // Loud literals carry the value's prefix: this build's engine caps an
    // UNPREFIXED character sound at 100/256 whatever these say, while an S/F
    // prefixed one and the stock desktop engine apply them in full.
    const vs = kv.get('volumescale'), vl = kv.get('volume');
    if (vs && /^\d+$/.test(vs.v) && +vs.v >= LOUD_SCALE) loud.push({ file: rel, line: vs.line, kind: 'volumescale', value: +vs.v, block: blockLine, prefix: ref ? ref.prefix || '' : '' });
    if (vl && /^-?\d+$/.test(vl.v) && +vl.v >= LOUD_LEGACY) loud.push({ file: rel, line: vl.line, kind: 'volume', value: +vl.v, block: blockLine, prefix: ref ? ref.prefix || '' : '' });
  };
  if (!isZss) {
    // The engine reads a whole [State] block into a map before any key is
    // interpreted (compiler.go parseSection): key order is free, and a repeated
    // key is skipped with a warning - the FIRST wins. Mirror both, or a block
    // written `value = ...` above `type = PlaySnd` is missed and a duplicated
    // `value` is counted twice.
    let kv = null, blockLine = 0;
    const flush = () => {
      if (!kv) return;
      const type = (kv.get('type') || { v: '' }).v.toLowerCase();
      if (type === 'playsnd' && kv.has('value')) {
        const ref = push('playsnd', kv.get('value').v, kv.get('value').line);
        loudFrom(kv, blockLine, ref);
      }
      for (const k of ['hitsound', 'guardsound']) if (kv.has(k)) push(k, kv.get(k).v, kv.get(k).line);
      kv = null;
    };
    text.split(/\r?\n/).forEach((raw, i) => {
      const line = raw.replace(/;.*$/, '').trim();
      if (!line) return;
      if (/^\[/.test(line)) { flush(); kv = new Map(); blockLine = i + 1; return; }
      if (!kv) return;
      const m = /^([A-Za-z_.0-9]+)\s*=\s*(.*)$/.exec(line);
      if (!m) return;
      const key = m[1].toLowerCase();
      if (!kv.has(key)) kv.set(key, { v: m[2].trim(), line: i + 1 });
    });
    flush();
  } else {
    // ZSS: `#` starts a line comment (compiler.go); strip it before matching,
    // or a commented-out call is reported as live. Positions stay aligned
    // because only the comment text is blanked, line by line.
    const clean = text.split(/\r?\n/).map((l) => l.replace(/#.*$/, '')).join('\n');
    const lineAt = (idx) => clean.slice(0, idx).split('\n').length;
    for (const m of clean.matchAll(/\bplaysnd\s*\{([^}]*)\}/gi)) {
      const body = m[1];
      const kv = new Map();
      for (const pm of body.matchAll(/\b(value|volumescale|volume)\s*:\s*([^;}\r\n]+)/gi)) {
        const k = pm[1].toLowerCase();
        if (!kv.has(k)) kv.set(k, { v: pm[2].trim(), line: lineAt(m.index) });
      }
      const ref = kv.has('value') ? push('playsnd', kv.get('value').v, lineAt(m.index)) : null;
      loudFrom(kv, lineAt(m.index), ref);
    }
    for (const m of clean.matchAll(/\b(hitsound|guardsound)\s*:\s*([^;}\r\n]+)/gi)) {
      push(m[1].toLowerCase(), m[2], lineAt(m.index));
    }
  }
  return { calls, loud };
}

function soundAudit(mountAs) {
  const { dir, entryDef } = charSource(mountAs);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return null;
  const defName = (entryDef && fs.existsSync(path.join(dir, entryDef))) ? entryDef : findMainDef(dir);
  if (!defName) return null;
  return soundAuditIn(dir, defName);
}

// The content audit (contentaudit.js) over a mount name, the same way the
// sound audit resolves one. Required lazily: the audit requires this module,
// and only the route and the CLI ever need it.
function contentAudit(mountAs, opts) {
  const { dir, entryDef } = charSource(mountAs);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return null;
  const defName = (entryDef && fs.existsSync(path.join(dir, entryDef))) ? entryDef : findMainDef(dir);
  if (!defName) return null;
  return require('./contentaudit.js').contentAuditIn(dir, defName, opts);
}

// ---- THE SOUND LIST, AND ONE SOUND TO PLAY ---------------------------------
//
// Every entry of a .snd with its WAV facts. The container is ElecbyteSnd:
// count at 0x10, first entry at 0x14; each entry is nextOfs, length, group,
// index and then `length` bytes of a COMPLETE RIFF WAVE file (measured on the
// roster: every entry RIFF, PCM format 1) - which is why the browser can play
// one exactly as the file holds it, and why listing costs a header walk and
// nothing more.
function wavInfo(b, at, len) {
  const info = { riff: b.toString('latin1', at, at + 4) === 'RIFF', format: null, channels: null, rate: null, bits: null, ms: null };
  if (!info.riff) return info;
  const end = Math.min(b.length, at + len);
  let p = at + 12, byteRate = 0;                       // past RIFF <size> WAVE
  while (p + 8 <= end) {
    const id = b.toString('latin1', p, p + 4), sz = b.readUInt32LE(p + 4);
    if (id === 'fmt ' && p + 24 <= end) {
      info.format = b.readUInt16LE(p + 8); info.channels = b.readUInt16LE(p + 10);
      info.rate = b.readUInt32LE(p + 12); byteRate = b.readUInt32LE(p + 16); info.bits = b.readUInt16LE(p + 22);
    }
    if (id === 'data') { if (byteRate) info.ms = Math.round(sz / byteRate * 1000); break; }
    p += 8 + sz + (sz & 1);
  }
  return info;
}
function sndEntries(file) {
  let b;
  try { b = fs.readFileSync(file); } catch (e) { return null; }
  if (b.length < 24 || b.slice(0, 11).toString('latin1') !== 'ElecbyteSnd' || b[11] !== 0) return null;
  const num = b.readUInt32LE(16);
  let off = b.readUInt32LE(20);
  const entries = [];
  for (let i = 0; i < num && off + 16 <= b.length; i++) {
    const next = b.readUInt32LE(off), len = b.readUInt32LE(off + 4), g = b.readInt32LE(off + 8), n = b.readInt32LE(off + 12);
    const data = off + 16;
    // A negative key is dropped by the engine at load (sound.go), so it is
    // not a sound the character has.
    if (g >= 0 && n >= 0 && len > 0 && data + len <= b.length) entries.push(Object.assign({ group: g, index: n, offset: data, bytes: len }, wavInfo(b, data, len)));
    if (!next || next <= off) break;
    off = next;
  }
  return { buf: b, entries };
}
// The def's sound= file, resolved the tolerant way (wrong case, backslashes).
function charSndFileIn(charDir, defName) {
  let text;
  try { text = fs.readFileSync(path.join(charDir, defName), 'latin1'); } catch (e) { return null; }
  const defDir = path.posix.dirname(defName.replace(/\\/g, '/'));
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*sound\s*=\s*(.+?)\s*(;.*)?$/i.exec(line);
    if (!m) continue;
    const rel = m[1].replace(/"/g, '').replace(/\\/g, '/').trim();
    if (!rel) return null;
    return resolveCI(charDir, defDir === '.' ? rel : defDir + '/' + rel) || resolveCI(charDir, rel);
  }
  return null;
}
// The list the Studio shows: every sound with its length and format, how
// many moves name it by literal and where the first one is. A sound nobody
// names may still be reached by a computed call (Svar(58),N), so "unused" is
// "no literal call", stated as such.
function charSoundsIn(charDir, defName) {
  const a = soundAuditIn(charDir, defName);
  if (!a) return null;
  const file = charSndFileIn(charDir, defName);
  const se = file ? sndEntries(file) : null;
  const uses = new Map();
  for (const c of a.calls) {
    if (c.target !== 'own' || c.computed) continue;
    const k = c.group + ',' + c.index;
    if (!uses.has(k)) uses.set(k, { n: 0, first: { file: c.file, line: c.line, kind: c.kind } });
    uses.get(k).n++;
  }
  const sounds = (se ? se.entries : []).map((e) => {
    const u = uses.get(e.group + ',' + e.index);
    return { group: e.group, index: e.index, bytes: e.bytes, ms: e.ms, rate: e.rate, channels: e.channels, bits: e.bits, format: e.format, riff: e.riff, uses: u ? u.n : 0, first: u ? u.first : null };
  }).sort((x, y) => x.group - y.group || x.index - y.index);
  return { def: a.def, snd: a.snd, sounds, unused: sounds.filter((x) => !x.uses).length, computed: a.summary.computed,
    missingCalls: a.summary.missingCalls, bytes: sounds.reduce((t, x) => t + x.bytes, 0) };
}
function charSounds(mountAs) {
  const { dir, entryDef } = charSource(mountAs);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return null;
  const defName = (entryDef && fs.existsSync(path.join(dir, entryDef))) ? entryDef : findMainDef(dir);
  if (!defName) return null;
  return charSoundsIn(dir, defName);
}
// One sound's bytes, exactly as the file holds them: a complete WAV.
function charSoundBlobIn(charDir, defName, group, index) {
  const file = charSndFileIn(charDir, defName);
  const se = file ? sndEntries(file) : null;
  if (!se) return null;
  const e = se.entries.find((x) => x.group === group && x.index === index);
  return e ? se.buf.slice(e.offset, e.offset + e.bytes) : null;
}
function charSoundBlob(mountAs, group, index) {
  const { dir, entryDef } = charSource(mountAs);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return null;
  const defName = (entryDef && fs.existsSync(path.join(dir, entryDef))) ? entryDef : findMainDef(dir);
  if (!defName) return null;
  return charSoundBlobIn(dir, defName, group, index);
}

// The audit on any directory. Files come from the def's [Files] keys
// (cmd/cns/st*/stcommon - state code can live in the .cmd too), resolved the
// way the engine resolves them; a file the folder does not hold (stcommon =
// common1.cns lives engine-side) is listed under `skipped`, not scanned.
function soundAuditIn(charDir, defName) {
  let defText;
  try { defText = fs.readFileSync(path.join(charDir, defName), 'latin1'); } catch (e) { return null; }
  let sndRel = null;
  const stateRels = [];
  for (const line of defText.split(/\r?\n/)) {
    const m = /^\s*(cmd|cns|st\d*|stcommon|sound)\s*=\s*(.+?)\s*(;.*)?$/i.exec(line);
    if (!m) continue;
    const rel = m[2].replace(/"/g, '').replace(/\\/g, '/').trim();
    if (!rel) continue;
    if (m[1].toLowerCase() === 'sound') { if (!sndRel) sndRel = rel; }
    else if (!stateRels.includes(rel)) stateRels.push(rel);
  }
  const defDir = path.posix.dirname(defName.replace(/\\/g, '/'));
  const inDef = (rel) => (defDir === '.' ? rel : defDir + '/' + rel).replace(/^\.\//, '');
  const resolve = (rel) => resolveCI(charDir, inDef(rel)) || resolveCI(charDir, rel)
    || resolveCI(charDir, inDef(rel) + '.zss') || resolveCI(charDir, rel + '.zss');

  const sndPath = sndRel ? resolve(sndRel) : null;
  const keys = sndPath ? sndKeySet(sndPath) : null;
  const out = {
    def: defName,
    snd: { rel: sndRel, resolved: sndPath ? path.relative(charDir, sndPath).replace(/\\/g, '/') : null,
      keys: keys ? keys.size : 0, missing: !sndPath, unreadable: !!sndPath && !keys },
    files: [], skipped: [], calls: [], loud: [], computed: 0, common: 0,
  };
  for (const rel of stateRels) {
    const abs = resolve(rel);
    if (!abs) { out.skipped.push(rel); continue; }
    let text;
    try { if (fs.statSync(abs).size > 8e6) { out.skipped.push(rel); continue; } text = fs.readFileSync(abs, 'latin1'); }
    catch (e) { out.skipped.push(rel); continue; }
    const r = soundCallsIn(text, rel);
    out.files.push({ rel, resolved: path.relative(charDir, abs).replace(/\\/g, '/'), calls: r.calls.length });
    out.calls.push(...r.calls);
    out.loud.push(...r.loud);
  }
  for (const c of out.calls) {
    if (c.computed) { out.computed++; continue; }
    if (c.target === 'common') { out.common++; continue; }
    c.present = !!(keys && keys.has(c.group + ',' + c.index));
  }
  const missing = out.calls.filter((c) => c.target === 'own' && !c.computed && !c.present);
  const byKey = new Map();
  for (const c of missing) {
    const k = c.group + ',' + c.index;
    if (!byKey.has(k)) byKey.set(k, { key: k, group: c.group, index: c.index, calls: [] });
    byKey.get(k).calls.push({ file: c.file, line: c.line, kind: c.kind });
  }
  out.missing = [...byKey.values()].sort((a, b) => a.group - b.group || a.index - b.index);
  // Loud literals come in dozens per H-edit (every scene state sets
  // volume = 255), so both the terminal report and the Studio panel show them
  // per file and kind, with how many are unprefixed - those are capped at
  // 100/256 by this build's engine and played in full by the stock desktop one.
  const agg = new Map();
  for (const l of out.loud) {
    const k = l.file + '\0' + l.kind;
    const a = agg.get(k) || { file: l.file, kind: l.kind, n: 0, unprefixed: 0, max: -Infinity, first: l.line };
    a.n++; if (!l.prefix) a.unprefixed++; a.max = Math.max(a.max, l.value); agg.set(k, a);
  }
  out.loudSummary = [...agg.values()];
  out.summary = {
    own: out.calls.filter((c) => c.target === 'own').length,
    present: out.calls.filter((c) => c.present).length,
    missingCalls: missing.length, missingKeys: out.missing.length,
    computed: out.computed, common: out.common, loud: out.loud.length,
  };
  return out;
}

// ---- H-MUGEN pair bench ----
//
// One giver against one receiver, as raw numbers: what the giver asks a victim
// for, grouped by registry family, and whether the receiver's .air carries an
// action at each number. Never a percentage - a per-pair coverage figure was
// tested and rejected (GRAIL 4.3: "do not publish headline X% compatible
// numbers as fact"). The bench says which numbers, guarded or not, and leaves
// the verdict to a match: ground truth is pairing the two characters in game
// and watching the scene with Lock-On (GRAIL Part I).
//
// Guarded demands are `SelfAnimExist(N)` probes on H numbers (the giver checks
// and picks something else if the victim lacks N). Unguarded demands are
// `ChangeAnim2 value = N` targets on H numbers: the giver's own table driving
// the victim's sprites, no fallback (GRAIL 4.7b). A number the receiver ships
// but also plays ITSELF is flagged: same number, possibly different meaning
// (GRAIL 4.5) - the giver's scene may drive the receiver's unrelated attack.
// The def's [Files] keys, resolved the way the engine resolves them.
function defFiles(charDir, defName) {
  const out = { states: [], anim: null, sprite: null };
  let defText;
  try { defText = fs.readFileSync(path.join(charDir, defName), 'latin1'); } catch (e) { return out; }
  const defDir = path.posix.dirname(defName.replace(/\\/g, '/'));
  const resolve = (rel) => resolveCI(charDir, defDir === '.' ? rel : defDir + '/' + rel) || resolveCI(charDir, rel);
  for (const line of defText.split(/\r?\n/)) {
    const m = /^\s*(cmd|cns|st\d*|stcommon|anim|sprite)\s*=\s*(.+?)\s*(;.*)?$/i.exec(line);
    if (!m) continue;
    const rel = m[2].replace(/"/g, '').replace(/\\/g, '/').trim();
    if (!rel) continue;
    const key = m[1].toLowerCase();
    if (key === 'anim') { if (!out.anim) out.anim = resolve(rel); }
    else if (key === 'sprite') { if (!out.sprite) out.sprite = resolve(rel); }
    else { const abs = resolve(rel); if (abs && !out.states.some((x) => x.abs === abs)) out.states.push({ rel, abs }); }
  }
  return out;
}

// Every 'group,index' an .sff holds, from the sprite table alone - no pixel
// is read, and neither is the rest of the file: the 64-byte header, then for
// v2 the sprite node table (n x 28 bytes at sprOfs) in one read, for v1 the
// 32-byte subfile header of each sprite along its linked list. A whole-file
// read here was 508 MB per refresh on Main for ~2 MB of tables. Both versions
// (layout as in tools/unused-sprites.js walkSff, transcribed so modlib does
// not depend on a tool the kit does not ship), with the whole-file walk's
// bounds: nothing past the file's end is read. Null when the file is not an SFF.
// report (hScan's memo): .incomplete is set when the file is there but did not
// open or read - a null that is not an answer about the file.
function readFull(fd, buf, pos) {
  let got = 0;
  while (got < buf.length) {
    const n = fs.readSync(fd, buf, got, buf.length - got, pos + got);
    if (!n) break;
    got += n;
  }
  return got;
}
function sffSpriteKeys(file, report) {
  let fd;
  try { fd = fs.openSync(file, 'r'); } catch (e) { if (report && e.code !== 'ENOENT' && fs.existsSync(file)) report.incomplete = true; return null; }
  try {
    const size = fs.fstatSync(fd).size;
    if (size < 64) return null;
    const h = Buffer.alloc(64);
    if (readFull(fd, h, 0) < 64 || h.slice(0, 11).toString('latin1') !== 'ElecbyteSpr') return null;
    const keys = new Set();
    const v = h[15];
    if (v === 2) {
      const sprOfs = h.readUInt32LE(36), n = h.readUInt32LE(40);
      const t = Buffer.alloc(Math.max(0, Math.min(n * 28, size - sprOfs)));
      const got = t.length ? readFull(fd, t, sprOfs) : 0;
      for (let k = 0; k < n; k++) {
        const o = k * 28;
        if (o + 28 > got) break;
        keys.add(t.readUInt16LE(o) + ',' + t.readUInt16LE(o + 2));
      }
    } else if (v === 1) {
      const n = h.readUInt32LE(20);
      let ofs = h.readUInt32LE(24);
      const sh = Buffer.alloc(32);
      for (let k = 0; k < n && ofs > 0 && ofs + 32 <= size; k++) {
        if (readFull(fd, sh, ofs) < 32) break;
        keys.add(sh.readUInt16LE(12) + ',' + sh.readUInt16LE(14));
        const next = sh.readUInt32LE(0);
        if (!next || next <= ofs) break;
        ofs = next;
      }
    } else return null;
    return keys;
  } catch (e) {
    if (report) report.incomplete = true;
    return null;
  } finally {
    try { fs.closeSync(fd); } catch (e) { /* already closed */ }
  }
}

// action number -> the unique 'group,index' frames it draws (group -1 blanks
// skipped, Clsn and Loopstart lines ignored).
// A number defined twice keeps its FIRST definition: the engine ignores the
// later [Begin Action N] ('Duplicate action key ... (ignored)', anim.go
// readAction), so its frames never draw.
// A negative number is an action of its own, as the engine reads it (Atoi of
// the header): Kira's [Begin Action -180501] after her 1805000 once added its
// frames to 1805000, which then looked like a new picture of her.
function airFrames(text) {
  const out = new Map();
  let cur = null;
  for (const raw of String(text || '').split(/\r?\n/)) {
    const l = raw.replace(/;.*$/, '').trim();
    const b = /^\[begin action\s+(-?\d+)\]/i.exec(l);
    if (b) { cur = +b[1]; if (out.has(cur)) cur = null; else out.set(cur, new Set()); continue; }
    if (cur === null || !l || /^\[/.test(l) || /^(clsn|loopstart)/i.test(l)) continue;
    const f = /^(-?\d+)\s*,\s*(-?\d+)\s*,/.exec(l);
    if (f && +f[1] >= 0) out.get(cur).add(f[1] + ',' + f[2]);
  }
  return out;
}

// What a giver asks of a victim, and how: guarded probes, unguarded
// ChangeAnim2 targets, and per [Statedef] which unguarded numbers the guarded
// ones fall back to (GRAIL 4.2b, "a preference ladder, not a single number").
// THE BENCH OVER THE SCENES. scenelib reads the giver the way the engine
// does and answers per custom state: what the victim is asked for, and the
// giver's own pose per entry. The numbers the chips show are a view over
// those scenes - one number may sit in a dozen of them, each with its own
// giver pose, and the panel lets you pick which.
function pairBenchIn(gDir, gDef, rDir, rDef) {
  const gh = hScan(gDir, gDef), rh = hScan(rDir, rDef);
  const gf = defFiles(gDir, gDef), rf = defFiles(rDir, rDef);
  const readAir = (abs) => { try { return abs ? airFrames(fs.readFileSync(abs, 'latin1')) : new Map(); } catch (e) { return new Map(); } };
  const gAir = readAir(gf.anim), rAir = readAir(rf.anim);
  const rSff = rf.sprite ? sffSpriteKeys(rf.sprite) : null;
  const groupsOf = (frames) => [...new Set([...frames].map((k) => +k.split(',')[0]))].sort((a, b) => a - b);
  // The giver's own action `a` driven on the victim's sprites: what matters is
  // whether the victim's .sff holds the (group,index) frames that action names.
  // WHAT THE BUILD SHIPS IS NOT ALWAYS WHAT HER FOLDER HOLDS. A victim whose
  // flag her sprite file cannot honor has the missing frames completed in the
  // build's copy (futafix.js - the website's generated layer, the desktop
  // export's copy). `fallback` stays the truth about HER file; `inBuild` is what
  // a player sees, and is the one the chips are colored by.
  let standIns = new Map(), noArt = [];
  try {
    const fx = require('./futafix.js').repairFor(rDir, rDef);
    if (fx) { standIns = new Map(fx.aliases.map((a) => [a.key, a])); noArt = fx.unfixable; }
  } catch (e) { /* not repairable: the verdicts are her file's */ }
  const verdict = (frames, shown) => (!frames ? 'no-action' : !rSff ? 'unknown' : shown === frames ? 'renders' : shown > 0 ? 'partial' : 'vanishes');
  const onHerSprites = (a) => {
    const fr = [...(gAir.get(a) || [])];
    const present = rSff ? fr.filter((k) => rSff.has(k)).length : null;
    const filled = rSff ? fr.filter((k) => !rSff.has(k) && standIns.has(k)) : [];
    return { drawsWith: groupsOf(fr), frames: fr.length, framesPresent: present,
      missingFrames: rSff ? fr.filter((k) => !rSff.has(k)).slice(0, 8) : [],
      fallback: verdict(fr.length, present),
      framesFilled: filled.length, filledHow: [...new Set(filled.map((k) => standIns.get(k).how))],
      inBuild: verdict(fr.length, (present || 0) + filled.length) };
  };

  const analysis = scenelib.analyzeGiver(gDir, gDef, {
    resolve: (rel) => resolveCI(gDir, rel),
    victimActions: rh.airActions, giverActions: new Set(gAir.keys()),
  });
  // Numbers as a view over the scenes.
  const byNumber = new Map();
  const touch = (n, kind, C) => {
    if (!byNumber.has(n)) byNumber.set(n, { guarded: false, assumed: false, unguarded: false, scenes: [] });
    const x = byNumber.get(n); x[kind] = true;
    if (!x.scenes.includes(C)) x.scenes.push(C);
  };
  for (const sc of analysis.scenes.values()) {
    for (const n of sc.demands.guarded) touch(n, 'guarded', sc.state);
    for (const n of sc.demands.assumed) touch(n, 'assumed', sc.state);
    for (const n of sc.demands.fallbacks) if (isHNumber(n)) touch(n, 'unguarded', sc.state);
  }
  // COMPUTED DEMANDS, EXPANDED. `ChangeAnim2 value = StateOwner,anim + K` hands
  // the victim the giver's table for whatever pose he is in, so the demand is
  // every action N of his that has a pose N - K beside it. The Futa brand names
  // no victim number any other way. Kept to the H windows (hFamily) so that an
  // unrelated pair of actions a constant apart - 200 and 1200 - is not read as
  // a table. With a flag, the receiver decides the bank: she ships the flag
  // action or she does not (scenelib.relativeDemand).
  const computedInfo = new Map();
  for (const sc of analysis.scenes.values()) {
    for (const cd of sc.demands.computed || []) {
      const flagShipped = cd.flag === null ? null : rh.airActions.has(cd.flag);
      const K = cd.flag === null ? cd.offset : (flagShipped ? cd.whenShipped : cd.otherwise);
      for (const [n, fr] of gAir) {
        if (!fr.size || hFamily(n) === 'other' || !gAir.has(n - K)) continue;
        touch(n, 'computed', sc.state);
        if (!computedInfo.has(n)) computedInfo.set(n, { from: n - K, offset: K, flag: cd.flag, flagShipped, expr: cd.expr });
      }
    }
  }
  const sceneCache = new Map();
  const sceneView = (C) => {
    if (sceneCache.has(C)) return sceneCache.get(C);
    const sc = analysis.scenes.get(C);
    const v = { state: C, exists: sc.exists, helper: sc.helper, demands: sc.demands,
      entries: sc.entries.map((e) => ({ kind: e.kind, from: e.from, giverState: e.giverState, via: e.via, handoff: !!e.handoff, implied: !!e.implied,
        label: e.label || '', tag: e.tag || null, expr: e.expr || null, assignments: e.assignments || null, anyOf: !!e.anyOf, flags: e.flags, poses: e.poses })),
      fallbacks: sc.demands.fallbacks.map((a) => Object.assign({ n: a }, onHerSprites(a))),
      derived: sc.demands.derived, computed: sc.demands.computed || [] };
    sceneCache.set(C, v);
    return v;
  };

  const numbers = [...byNumber.keys()].sort((a, b) => a - b).map((n) => {
    const info = byNumber.get(n);
    const shipped = rh.airActions.has(n);
    const scenes = info.scenes.map(sceneView);
    const first = scenes.find((s) => s.entries.length) || scenes[0];
    const firstEntry = first && first.entries[0];
    const x = { n, family: hFamily(n), guarded: info.guarded, assumed: info.assumed && !info.guarded, unguarded: info.unguarded,
      computed: !!info.computed,
      shipped, playsItself: shipped && rh.playsOwn.has(n),
      // The scenes this number sits in, and - for the chip's one-line view -
      // the first scene's first entry: where the giver is and what he shows.
      states: info.scenes, scenes,
      giverStates: first ? [...new Set(first.entries.map((e) => e.giverState).filter((g) => g !== null))] : [],
      giverAnims: firstEntry ? [...new Set(firstEntry.poses.filter((p) => p.anim !== null).map((p) => p.anim))] : [],
      giverImplied: !!(firstEntry && firstEntry.implied), targetExpr: firstEntry ? firstEntry.expr : null };
    if (x.guarded || x.assumed) {
      // Tailored: the receiver ships its OWN action at this number - and its
      // frames exist in its own .sff (a rebuild that dropped the art is the
      // 4.7b vanishing-frame case).
      x.tailored = shipped;
      if (shipped) {
        const fr = [...(rAir.get(n) || [])];
        x.ownFrames = fr.length;
        x.ownFramesPresent = rSff ? fr.filter((k) => rSff.has(k)).length : null;
        x.ownArtOk = rSff ? x.ownFramesPresent === fr.length : null;
      }
      const fb = [];
      for (const s of scenes) for (const a of s.demands.fallbacks) if (a !== n && !fb.includes(a)) fb.push(a);
      x.fallsBackTo = fb.sort((a, b) => a - b);
      x.fallbacks = x.fallsBackTo.map((a) => Object.assign({ n: a }, onHerSprites(a)));
    }
    if (x.unguarded || x.computed) Object.assign(x, onHerSprites(n));
    if (x.computed) {
      // His pose for this table is the number the table was computed FROM.
      const ci = computedInfo.get(n);
      Object.assign(x, { giverPose: ci.from, offset: ci.offset, flag: ci.flag, flagShipped: ci.flagShipped, expr: ci.expr });
      if (!x.giverAnims.length) x.giverAnims = [ci.from];
    }
    return x;
  });
  const fam = new Map();
  for (const x of numbers) {
    if (!fam.has(x.family)) fam.set(x.family, { family: x.family, numbers: [], asked: 0, tailored: 0, renders: 0, partial: 0, vanishes: 0, completed: 0 });
    const f = fam.get(x.family); f.numbers.push(x); f.asked++;
    if (x.tailored && x.ownArtOk !== false) f.tailored++;
    // counted as the build shows them; `completed` is how many of those her
    // own file would have left partly or wholly blank
    if (x.inBuild === 'renders') f.renders++;
    if (x.inBuild === 'partial') f.partial++;
    if (x.inBuild === 'vanishes') f.vanishes++;
    if (x.inBuild && x.inBuild !== x.fallback) f.completed++;
  }
  const families = [...fam.values()].sort((a, b) => b.asked - a.asked);
  const count = (pred) => numbers.filter(pred).length;
  return {
    giver: { def: gDef, isGiver: gh.giver, why: gh.why,
      // wiredCommands are lowercased by the scan, commands keep the .cmd's
      // case: dedupe case-insensitively, keep the author's spelling.
      commands: [...new Map([...gh.wiredCommands, ...gh.commands].map((c) => [c.toLowerCase(), c])).values()],
      files: analysis.files, airRead: gAir.size > 0,
      scenes: analysis.scenes.size, states: analysis.stateCount, helpers: analysis.helpers.length,
      shadowed: analysis.shadowed, unsolvable: analysis.unsolvable },
    receiver: { def: rDef, isReceiver: rh.receiver, actions: rh.airActions.size,
      registryShipped: [...rh.airActions].filter(inReceiverRegistry).length,
      sffRead: !!rSff, sprites: rSff ? rSff.size : 0,
      // frames the build's copy of her sprite file gains, and the ones no art
      // of hers can stand in for
      buildFills: standIns.size, noArt,
      sffGroups: rSff ? [...new Set([...rSff].map((k) => +k.split(',')[0]))].filter((g) => hFamily(g) !== 'other').sort((a, b) => a - b) : [] },
    families,
    totals: { asked: numbers.length, guarded: count((x) => x.guarded), assumed: count((x) => x.assumed), unguarded: count((x) => x.unguarded),
      computed: count((x) => x.computed), completed: count((x) => x.inBuild && x.inBuild !== x.fallback),
      tailored: count((x) => x.tailored && x.ownArtOk !== false),
      tailoredArtMissing: count((x) => x.tailored && x.ownArtOk === false),
      renders: count((x) => x.inBuild === 'renders'), partial: count((x) => x.inBuild === 'partial'),
      vanishes: count((x) => x.inBuild === 'vanishes'),
      // ...and the same three on HER file alone, before the build completes it
      ownFile: { renders: count((x) => x.fallback === 'renders'), partial: count((x) => x.fallback === 'partial'), vanishes: count((x) => x.fallback === 'vanishes') } },
  };
}

function pairBench(giverId, receiverId) {
  const g = charSource(giverId), r = charSource(receiverId);
  for (const [who, src] of [['giver', g], ['receiver', r]]) {
    if (!fs.existsSync(src.dir) || !fs.statSync(src.dir).isDirectory()) throw new Error('no such ' + who);
  }
  const gDef = (g.entryDef && fs.existsSync(path.join(g.dir, g.entryDef))) ? g.entryDef : findMainDef(g.dir);
  const rDef = (r.entryDef && fs.existsSync(path.join(r.dir, r.entryDef))) ? r.entryDef : findMainDef(r.dir);
  if (!gDef || !rDef) throw new Error('a character has no .def');
  const out = pairBenchIn(g.dir, gDef, r.dir, rDef);
  out.giver.id = giverId; out.receiver.id = receiverId;
  return out;
}

// ---- launching a pair in the desktop export ----
//
// The stock engine's command line works on desktop (`-p1`, `-p2`, `-s`,
// `-p2.ai 0`, `-rounds`, `-time -1`; main.lua f_commandLine). It does NOT work
// in the browser build - the quick-match path crashes there (GRAIL 5.7) - so
// the bench launches the DESKTOP export's Ikemen_GO.exe, straight into the
// fight with the giver as P1, the receiver idle as P2 and no round clock.
// A character has to be in the export: -p1 takes a select.def entry
// (`<folder>/<def>`), which is how the export lists it.
function parseExportSelect(text) {
  const chars = new Map(), stages = [];
  let sec = '';
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.replace(/;.*$/, '').trim();
    if (!line) continue;
    const h = /^\[([^\]]+)\]/.exec(line);
    if (h) { sec = h[1].trim().toLowerCase(); continue; }
    if (sec === 'characters') {
      if (/^(slot\s*=\s*\{|\}|skipslot|dummyslot|randomselect)$/i.test(line)) continue;
      const entry = line.split(',')[0].trim();
      const folder = entry.split('/')[0].trim().toLowerCase();
      if (folder && !chars.has(folder)) chars.set(folder, entry);
    } else if (sec === 'extrastages') {
      const entry = line.split(',')[0].trim();
      if (entry) stages.push(entry);
    }
  }
  return { chars, stages };
}

function launchInfo() {
  const dest = layout.DESKTOP_EXPORT;
  const exe = path.join(dest, 'Ikemen_GO.exe');
  const sel = path.join(dest, 'data', 'select.def');
  if (!fs.existsSync(exe) || !fs.existsSync(sel)) {
    return { available: false, reason: 'no desktop export yet - run Desktop Export first', dest, stages: [], chars: [] };
  }
  const { chars, stages } = parseExportSelect(fs.readFileSync(sel, 'latin1'));
  return { available: process.platform === 'win32', reason: process.platform === 'win32' ? '' : 'desktop launch is Windows-only',
    dest, exe, stages, chars: [...chars.keys()] };
}

// Pure: the argv for a pair, or a thrown reason. `info` is launchInfo().
function launchArgs(info, giverId, receiverId, stage) {
  const pick = (id, who) => {
    const e = info.chars instanceof Map ? info.chars : null;
    const entry = e ? e.get(String(id).toLowerCase()) : null;
    if (!entry) throw new Error(who + ' "' + id + '" is not in the desktop export - run Desktop Export first');
    return entry;
  };
  const args = ['-p1', pick(giverId, 'giver'), '-p2', pick(receiverId, 'receiver'),
    '-p2.ai', '0', '-rounds', '1', '-time', '-1'];
  if (stage) {
    if (!info.stages.includes(stage)) throw new Error('stage "' + stage + '" is not in the desktop export');
    args.push('-s', stage);
  }
  return args;
}

function launchPair(giverId, receiverId, stage) {
  const info = launchInfo();
  if (!info.available) throw new Error(info.reason);
  const sel = fs.readFileSync(path.join(info.dest, 'data', 'select.def'), 'latin1');
  const parsed = parseExportSelect(sel);
  const args = launchArgs({ chars: parsed.chars, stages: parsed.stages }, giverId, receiverId, stage);
  const { spawn } = require('child_process');
  const child = spawn(info.exe, args, { cwd: info.dest, detached: true, stdio: 'ignore', windowsHide: false });
  child.unref();
  return { ok: true, pid: child.pid, exe: info.exe, args };
}

// ---- E-Select: the engine it launches and the screenpack it edits ----------
//
// E-Select (public/grid.html) names both halves of its title path - the engine
// and the pack - and each opens a menu that shows a real path and acts on it.
// None of that was reachable from a page: motifDefPath is server-side only,
// the desktop export's folder is a layout detail, and "which engine" had no
// answer beyond that export. These are the read-only halves; server.js owns
// the routes that open, launch and pick.

const DEFAULT_MOTIF_VPATH = 'data/ikemen1/system.def';

// IS THIS AN IKEMEN GO PROGRAM WE MAY START? Preferences › Engine executable
// takes any path the user browses to or types, so it is checked here every
// time rather than trusted: an absolute path to an existing .exe whose folder
// has a data/ folder - the one thing every Ikemen GO install has beside its
// program, and the folder Launch runs it in. `selectMtimeMs` is that install's
// data/select.def stamp, which is how E-Select tells a build that is older than
// the last save.
//
// NOT A NETWORK PATH. Every check below is a synchronous stat, and a stat of a
// share that does not answer holds this single-threaded server until Windows
// gives up - tens of seconds for every request behind it. A page can ask for
// one without being clicked (GET /api/eselect-info?exe=), and Windows offers
// the user's sign-in to whatever host the share names. So \\host\share, and the
// \\?\UNC\ and \\.\ device forms, are refused before anything touches the disk.
//
// NOR ONE INSIDE THE BUILD'S DOWNLOADED CONTENT. Characters, stages, screenpacks
// and songs are other people's archives, copied in whole; an .exe with a data/
// folder beside it can arrive in one. Launch starts an engine install, never a
// file that came with a character.
function validateEngineExe(exe) {
  const raw = String(exe == null ? '' : exe).trim();
  const out = { ok: false, exe: raw, dir: '', reason: '', selectMtimeMs: null };
  if (!raw) { out.reason = 'no program given'; return out; }
  if (/^[\\/]{2}/.test(raw)) {
    out.reason = 'network paths are not supported - copy Ikemen GO to a folder on this computer';
    return out;
  }
  if (!path.isAbsolute(raw)) { out.reason = 'give the full path to the program, e.g. C:\\Games\\Ikemen GO\\Ikemen_GO.exe'; return out; }
  const abs = path.resolve(raw);
  out.exe = abs;
  out.dir = path.dirname(abs);
  if (!/\.exe$/i.test(abs)) { out.reason = 'that is not a program (.exe)'; return out; }
  const inside = (dir) => {
    const root = path.resolve(dir).toLowerCase();
    return abs.toLowerCase().startsWith(root + path.sep);
  };
  for (const name of ['cache', 'stages', 'themes', 'music', 'lifebars']) {
    let d = null;
    try { d = layout.dir(name); } catch (e) { d = null; }
    if (d && inside(d)) {
      out.reason = 'that program is inside the build\'s own ' + name + ' folder, which holds downloaded content - choose an Ikemen GO install';
      return out;
    }
  }
  let st = null;
  try { st = fs.statSync(abs); } catch (e) { st = null; }
  if (!st) { out.reason = 'there is no file at ' + abs; return out; }
  if (!st.isFile()) { out.reason = abs + ' is a folder, not a program'; return out; }
  let data = null;
  try { data = fs.statSync(path.join(out.dir, 'data')); } catch (e) { data = null; }
  if (!data || !data.isDirectory()) {
    out.reason = 'there is no data folder beside ' + path.basename(abs) + ' - choose the Ikemen GO program inside its game folder';
    return out;
  }
  try { out.selectMtimeMs = fs.statSync(path.join(out.dir, 'data', 'select.def')).mtimeMs; } catch (e) { out.selectMtimeMs = null; }
  out.ok = true;
  return out;
}

// GET /api/eselect-info. Cheap on purpose - stats and one small text parse, no
// character scan - because E-Select asks before every Launch.
//
// engine.version is the version of the engine ZIP the desktop export builds
// with (enginezip's pick: newest by version), read from its name and never
// from inside it. The export folder is layout.DESKTOP_EXPORT, the only one
// the Studio knows: a build exported with "Export to folder…" is reached
// through the Engine executable preference instead (`custom`).
function eselectInfo(exe) {
  const roster = readRoster();
  const stampOf = (p) => { try { return fs.statSync(p).mtimeMs; } catch (e) { return null; } };
  let version = null;
  try {
    const ez = require('./enginezip.js');
    const picked = ez.pick(ez.listIn(layout.DEPS));
    const v = picked ? ez.parseVersion(picked) : null;
    version = v ? v.text : null;
  } catch (e) { version = null; }
  const dest = layout.DESKTOP_EXPORT;
  const exportExe = path.join(dest, 'Ikemen_GO.exe');
  const vpath = roster.motif || DEFAULT_MOTIF_VPATH;
  const abs = motifDefPath(roster);
  let name = '', author = '';
  if (abs) {
    try {
      const parsed = motifCore.parseMotif(fs.readFileSync(abs, 'latin1'));
      name = parsed.name; author = parsed.author;
    } catch (e) { /* unreadable: the path alone still names it */ }
  }
  const custom = (exe === undefined || exe === null || !String(exe).trim()) ? null : (() => {
    const v = validateEngineExe(exe);
    return { ok: v.ok, exe: v.exe, dir: v.dir, reason: v.reason, selectMtimeMs: v.selectMtimeMs };
  })();
  return {
    engine: {
      name: 'Ikemen GO', version,
      exportDir: dest, exportExe,
      exportExists: fs.existsSync(exportExe),
      exportSelectMtimeMs: stampOf(path.join(dest, 'data', 'select.def')),
    },
    custom,
    motif: {
      vpath,
      abs: abs || null,
      folderAbs: abs ? path.dirname(abs) : null,
      // UNSET, not "ikemen1 chosen": the two differ on desktop (an unset motif
      // keeps the engine zip's own screenpack), and Open default motif is
      // exactly `POST /api/theme {motif:''}`.
      isDefault: !roster.motif,
      // The same fallback motifSelectInfo gives the title path.
      name: name || vpath.replace(/^data\//, ''),
      author: author || '',
    },
    roster: { mtimeMs: stampOf(layout.dir('roster.json')) },
    platform: process.platform,
  };
}

// GET /api/themes: the screenpack list without /api/studio's character
// rescan, which is seconds of work for a dialog that only wants names.
function themesInfo(vfs) {
  const roster = readRoster();
  const unusable = [];
  const themes = listThemes(unusable, vfs);
  return { current: roster.motif || DEFAULT_MOTIF_VPATH, isDefault: !roster.motif, themes, unusable };
}

// ---- MOVES AND ANIMATION EDITING --------------------------------------------
//
// Thin wrappers for the move inspector (movelib.js), the .air editor
// (airedit.js) and their one write path (charedit.js), resolving a mount name
// the way contentAudit does. STUDIO-ADVANCED.md §5, §8, §9, §11 are the design.
//
// Each has an `...In(dir, defName)` form so the tests run on a COPY of a
// character in os.tmpdir(); the mount-name form only adds charSource and the
// cached sprite file. Required lazily, like the content audit: movelib requires
// this module back, and only the routes and the tests ever need either.
//
// Errors are movelib's MoveEditError with a `.code` the route maps to a status:
//   invalid   the request is malformed or the value fails validation
//   notfound  no such character, file, block, action or element
//   stale     the file changed since the page read it (sha1 / expect)
//   refused   the re-parse after the splice would change something else
//   confirm   a dangerous value, or a Default Clsn box shared by other elements
//   blocking  a structural .air edit whose trigger renumbering needs force
const moveLib = () => require('./movelib.js');
const airLib = () => require('./airedit.js');
const charEdit = () => require('./charedit.js');
const editSha1 = (latin1) => crypto.createHash('sha1').update(Buffer.from(latin1, 'latin1')).digest('hex');
function editError(code, msg, details) {
  const e = new (moveLib().MoveEditError)(code, msg);
  if (details) e.details = details;
  return e;
}

function charTargetOf(mountAs) {
  const { dir, entryDef } = charSource(mountAs);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return null;
  const defName = (entryDef && fs.existsSync(path.join(dir, entryDef))) ? entryDef : findMainDef(dir);
  if (!defName) return null;
  return { dir, defName };
}
function needTarget(mountAs) {
  const t = charTargetOf(mountAs);
  if (!t) throw editError('notfound', 'no such character');
  return t;
}

// Sprite size and axis by (group, number), for drawing a frame at its axis
// the way /api/char-anim reports it. The mount-name form reuses the Studio's
// cached .sff; the folder form reads it once per call.
function geomReaderIn(dir, defName, rec) {
  let sff = rec ? rec.sff : null;
  if (!sff) {
    try { sff = sffDecode.readSff(mainSffPathLoose(dir, sffDecode.parseDef(path.join(dir, defName)))); } catch (e) { sff = null; }
  }
  const memo = new Map();
  const reader = (group, number) => {
    const k = group + ',' + number;
    if (memo.has(k)) return memo.get(k);
    let g = null;
    try { g = sff ? sffDecode.spriteGeom(sff, group, number) : null; } catch (e) { g = null; }
    const v = g ? { w: g.w, h: g.h, axisX: g.axisX, axisY: g.axisY } : null;
    memo.set(k, v);
    return v;
  };
  // Whether a sprite file was read and holds sprites: a size of 0x0 then
  // means the frame names no sprite, not that the file could not be read.
  reader.hasSprites = !!(sff && sff.byKey && sff.byKey.size > 0);
  return reader;
}

// The character's own .air as the engine finds it: [Files] anim, next to the
// .def first, then from the folder root, case-insensitively. Anything that
// resolves outside the folder is not the character's to edit.
function airFileIn(dir, defName) {
  let def = null;
  try { def = sffDecode.parseDef(path.join(dir, defName)); } catch (e) { def = null; }
  if (!def || !def.anim) return null;
  const rel = String(def.anim).replace(/\\/g, '/').trim();
  const defDir = path.posix.dirname(String(defName).replace(/\\/g, '/'));
  const abs = (defDir !== '.' && resolveCI(dir, defDir + '/' + rel)) || resolveCI(dir, rel);
  if (!abs) return null;
  const root = path.resolve(dir) + path.sep;
  if (!path.resolve(abs).startsWith(root)) return null;
  return { abs, rel: path.relative(dir, abs).replace(/\\/g, '/') };
}

// The engine's common .air text, joined exactly as movelib joins it, so a
// common action's frame `line` points at the same line here.
let COMMON_AIR_LINES = null;
function commonAirLines() {
  if (COMMON_AIR_LINES) return COMMON_AIR_LINES;
  COMMON_AIR_LINES = [];
  try {
    const E = require('./enginedata.js');
    let t = E.commonConfig().air.map((rel) => fs.readFileSync(path.join(E.engineDir(), rel), 'latin1')).join('\n');
    if (t.charCodeAt(0) === 0xef && t.charCodeAt(1) === 0xbb && t.charCodeAt(2) === 0xbf) t = t.slice(3);
    COMMON_AIR_LINES = t.split('\n');
  } catch (e) { /* no engine data: common frames draw at offset 0,0 */ }
  return COMMON_AIR_LINES;
}

// movesIn, plus what a page needs to DRAW each candidate animation's frames:
// the element's x/y offset and flip (movelib's frames carry only the sprite,
// time and boxes) and the sprite's size and axis. The offset is read from the
// frame's own line with the engine's Atoi (anim.go:64-67), so the picture uses
// the same line the boxes were bound from.
function charMovesIn(dir, defName, opts) {
  const o = opts || {};
  const M = moveLib();
  const A = airLib();
  const model = M.movesIn(dir, defName);
  if (!model) return null;
  const geom = o.geom || geomReaderIn(dir, defName);
  let charLines = null;
  if (model.air) {
    try {
      let t = fs.readFileSync(path.join(dir, model.air.path), 'latin1');
      if (t.charCodeAt(0) === 0xef && t.charCodeAt(1) === 0xbb && t.charCodeAt(2) === 0xbf) t = t.slice(3);
      charLines = t.split('\n');
    } catch (e) { charLines = null; }
  }
  // Negative states too: a HitDef in a -3 draws the animation its triggers name.
  // And the projectiles' own animations (movelib THE PROJECTILES).
  for (const s of [...model.states, ...(model.negativeStates || []), { anims: model.projAnims || [] }]) {
    for (const a of (s.anims || [])) {
      const lines = a.table === 'character' ? charLines : a.table === 'common' ? commonAirLines() : null;
      for (const f of a.frames) {
        const raw = lines && lines[f.line - 1] !== undefined ? lines[f.line - 1] : '';
        const cut = raw.indexOf(';') >= 0 ? raw.slice(0, raw.indexOf(';')) : raw;
        const parts = cut.split(',');
        f.x = parts.length > 2 ? A.atoi(parts[2]) : 0;
        f.y = parts.length > 3 ? A.atoi(parts[3]) : 0;
        f.flip = parts.length > 5 ? parts[5].trim().toUpperCase() : '';
        // Mirrored or not, as the engine reads the flags (anim.go:73-104): ANY
        // H sets Hscale = -1 (`HH` is still flipped; only the offset's sign
        // follows the count). With the transparency field empty, the flags stop
        // at the first letter that is not H or V (the WinMugen `...,5,A` form).
        {
          let flags = f.flip;
          const k = flags.search(/[^HV]/);
          if (k >= 0 && !(parts.length > 6 && parts[6].trim() !== '')) flags = flags.slice(0, k);
          f.flipH = flags.includes('H');
          f.flipV = flags.includes('V');
          // Where the axis is drawn: at the offset, or at minus the offset for
          // an even count of two or more H / V (airedit xDraw, anim.go:93-99,
          // 950-1024). f.x / f.y stay the numbers written on the line.
          const hN = (flags.match(/H/g) || []).length, vN = (flags.match(/V/g) || []).length;
          f.drawX = hN >= 2 && hN % 2 === 0 ? -f.x : f.x;
          f.drawY = vN >= 2 && vN % 2 === 0 ? -f.y : f.y;
        }
        const g = geom(f.group, f.number);
        f.w = g ? g.w : 0; f.h = g ? g.h : 0;
        f.axisX = g ? g.axisX : 0; f.axisY = g ? g.axisY : 0;
      }
    }
  }
  // MOVES THAT CANNOT BE CHARTED FROM THE FILES (2026-10-19). Not one of the
  // 61 animations Grim Reaper Mai's 36 listed attack states (34 numbered, -2
  // and -1) name draws a sprite: every one is a `-1` frame (a full-screen
  // Clsn) or an action her .air does not have (7). Her frame data is counted
  // on those, so the window says so. Only when it is true: at least one
  // attack state, at least one animation named, and none that draws.
  // `states` counts what the window lists (negative states included);
  // `inHelpers` the ones the files show a helper entering (movelib
  // helperRunStates: 21 of hers; the rest are entered through computed
  // numbers, or run every tick), and the window says exactly that much.
  // Never when the sprite file could not be read (missing, unreadable, no
  // sprites): every frame then measures 0x0 and the animations are not to
  // blame (geomReaderIn hasSprites; a geometry reader passed in without that
  // flag is taken as read).
  try {
    const att = model.states.filter((s) => s.blocks && s.blocks.length);
    const negAtt = (model.negativeStates || []).filter((s) => s.blocks && s.blocks.length);
    const named = [...att, ...negAtt].flatMap((s) => s.anims || []);
    const draws = (a) => (a.frames || []).some((f) => f.w > 0 && f.h > 0);
    if (geom.hasSprites !== false && (att.length || negAtt.length) && named.length && !named.some(draws)) {
      const inH = new Set(model.helperAttackStates || []);
      model.blankAttacks = {
        states: att.length + negAtt.length,
        inHelpers: att.filter((s) => inH.has(s.no)).length,
        named: named.length,
        absent: named.filter((a) => a.exists === false).length,
      };
    }
  } catch (e) { /* the model stands without the note */ }
  // A projectile animation with no sprite the file has draws nothing: an
  // invisible hit, whatever its sprite numbers say.
  for (const a of (model.projAnims || [])) a.noSprite = a.frames.length > 0 && a.frames.every((f) => !f.w);
  return model;
}
function charMoves(mountAs) {
  const t = charTargetOf(mountAs);
  if (!t) return null;
  return charMovesIn(t.dir, t.defName, { geom: geomReaderIn(t.dir, t.defName, charSff(mountAs)) });
}

// One value of one attack block. movelib does every check (expect, sha1,
// tier, risk confirm, re-parse validate); this adds the cache invalidation.
function charMoveEditIn(dir, defName, req) {
  const r = moveLib().editMoveValue(dir, defName, req);
  if (r.changed) invalidateDiag(path.basename(dir));
  return r;
}
function charMoveEdit(mountAs, req) {
  const t = needTarget(mountAs);
  return charMoveEditIn(t.dir, t.defName, req);
}
// A parameter the block leaves out, added as one line (movelib.addMoveParam).
function charMoveAdd(mountAs, req) {
  const t = needTarget(mountAs);
  const r = moveLib().addMoveParam(t.dir, t.defName, req);
  if (r.changed) invalidateDiag(path.basename(t.dir));
  return r;
}

function charEditsIn(dir) { return { edited: charEdit().listEdited(dir) }; }

// Put one file back from its pristine backup. movelib only accepts a file
// listEdited reports, inside the folder - never a path the page made up.
function charEditRevertIn(dir, file) {
  const r = moveLib().revertMoveFile(dir, file);
  if (r.reverted) invalidateDiag(path.basename(dir));
  return Object.assign(r, { edited: charEdit().listEdited(dir) });
}
function charEditRevert(mountAs, file) {
  const t = needTarget(mountAs);
  return charEditRevertIn(t.dir, file);
}

// The part of a state an .air edit needs (airedit reads anim candidates,
// ChangeAnims, the literal AnimElem spans of every controller, and each attack
// block's triggers and firing) - without the parameter tables.
function airStateView(s) {
  return {
    no: s.no, file: s.file, line: s.line, movetype: s.movetype,
    anim: s.anim, changeAnims: s.changeAnims, animElemTriggers: s.animElemTriggers,
    blocks: s.blocks.map((b) => ({ key: b.key, ordinal: b.ordinal, type: b.type, file: b.file, line: b.line, label: b.label, triggers: b.triggers, firing: b.firing })),
  };
}

// One action of the character's .air with every byte span (airedit), the
// sprite geometry of each element, the character's localcoord and [Size], and
// the states that may play this action (movelib.statesUsingAction) - the
// triggers a timing or structural edit moves. `sha1` is the .air as read; a
// write must send it back.
function charAirIn(dir, defName, action, opts) {
  const o = opts || {};
  const n = Number(action);
  if (!Number.isInteger(n)) throw editError('invalid', 'action must be a whole number');
  const air = airFileIn(dir, defName);
  if (!air) throw editError('notfound', 'this character names no .air file it has');
  const text = fs.readFileSync(air.abs, 'latin1');
  const A = airLib(), M = moveLib();
  const model = A.parseAirSpans(text);
  const d = A.describeAction(model, n);
  if (!d) throw editError('notfound', 'the .air defines no action ' + n);
  const geom = o.geom || geomReaderIn(dir, defName);
  for (const el of d.elements) el.sprite = geom(el.values.group, el.values.number);
  const moves = M.movesIn(dir, defName, { anims: false });
  return {
    file: air.rel, sha1: editSha1(text), action: d,
    actions: [...model.byNo.keys()].sort((a, b) => a - b),
    localcoord: moves ? moves.localcoord : [320, 240], localcoordDeclared: moves ? moves.localcoordDeclared : false,
    size: moves ? moves.size : { xscale: 1, yscale: 1 }, ikemenVersion: moves ? moves.ikemenVersion : false,
    states: airStatesFor(moves, model, n).map(airStateView),
    hits: charHitReport(moves, model, d, n),
    edited: charEdit().listEdited(dir),
  };
}

// CAN THIS ACTION'S HIT BOXES HIT? A Clsn1 box is tested only while the
// character has a live HitDef (or ReversalDef) and movetype is not I
// (char.go:10854, 12552). For each state that plays the action - the
// character's own (airStatesFor) and, when stcommon is the engine's file, the
// engine's common states whose code shows it (enginedata.stcommonAnims; its
// get-hit states are left out) - which of these holds:
//   own       the state has a HitDef or ReversalDef of its own;
//   added     the animation editor's -3 group gives it one (hitgen.js):
//             "covers" lists the elements it arms on, "missing" the boxed
//             elements it does not;
//   negative  a HitDef in a negative state names this action in its triggers;
//   none      nothing does: the boxes are decoration there.
// Each hit block comes with its damage (value, raw, whether it is a plain
// number) and its key, so the page can edit it through /api/char-move-edit.
const COMMON_STATE_NAMES = {
  0: 'standing', 10: 'crouching down', 11: 'crouching', 12: 'standing up', 20: 'walking',
  40: 'jump start', 45: 'air jump start', 50: 'jumping', 51: 'falling', 52: 'jump landing',
  100: 'running', 105: 'hopping back', 106: 'hop-back landing', 120: 'guard start',
  130: 'standing guard', 131: 'crouching guard', 132: 'air guard', 140: 'guard end',
  170: 'losing', 175: 'draw', 190: 'intro', 191: 'intro',
};
function charHitReport(moves, airModel, d, action) {
  const boxes = d.elements.filter((e) => e.clsn1 && e.clsn1.rects.length).map((e) => e.ordinal);
  const first = d.elements.find((e) => e.clsn1 && e.clsn1.rects.length);
  const out = {
    boxes, count: d.elements.length, states: [], files: {},
    scale: moves && moves.localcoord ? moves.localcoord[0] / 320 : 1,
    sparkY: first ? Math.round((first.clsn1.rects[0][1] + first.clsn1.rects[0][3]) / 2) : null,
    zss: false,
  };
  if (!moves) return out;
  for (const f of moves.files) if (f.sha1) out.files[f.rel] = f.sha1;
  out.zss = moves.files.some((f) => f.key === 'st' && f.found && !f.engine && f.zss);
  const A = airLib(), M = moveLib();
  const plays = [action, ...A.aliasesOf(airModel, action)];
  const HIT = new Set(['hitdef', 'reversaldef']);
  const neg = moves.negativeStates || [];
  const dmgOf = (b) => {
    const p = b.params.find((x) => x.name === 'damage');
    const v = p && p.values[0];
    return { type: b.type, file: b.file, line: b.line, label: b.label, key: b.key, raw: p ? p.raw : null, value: v ? v.raw : null, editable: !!v && v.tier === 'green' };
  };
  const stateLit = (b) => {
    const out2 = [];
    for (const t of b.triggers || []) {
      if (!t.compiled) continue;
      for (const m of String(t.value).matchAll(/\bstateno\s*=\s*(\d+)\b/gi)) if (!/,\s*$/.test(String(t.value).slice(0, m.index))) out2.push(parseInt(m[1], 10));
    }
    return out2;
  };
  const GEN = /^hit box of action (\d+) in state (\d+)\s*:\s*hit$/i;
  const classify = (no) => {
    for (const s of neg) {
      for (const b of s.blocks) {
        const m = GEN.exec(String(b.label || '').trim());
        if (m && +m[1] === action && +m[2] === no) {
          const covers = [...new Set((b.firing || []).map((f) => f.elem).filter((e) => Number.isInteger(e)))].sort((x, y) => x - y);
          return { kind: 'added', blocks: [dmgOf(b)], covers, missing: boxes.filter((e) => !covers.includes(e)), stale: covers.some((e) => !boxes.includes(e)) };
        }
      }
    }
    const author = [];
    for (const s of neg) {
      for (const b of s.blocks) {
        if (!HIT.has(b.ctrl) || GEN.test(String(b.label || '').trim())) continue;
        if (!M.guardAnims(b).some((x) => plays.includes(x))) continue;
        const sn = stateLit(b);
        if (sn.length && !sn.includes(no)) continue;
        author.push(dmgOf(b));
      }
    }
    if (author.length) return { kind: 'negative', blocks: author };
    return { kind: 'none', blocks: [] };
  };
  for (const s of airStatesFor(moves, airModel, action)) {
    const own = s.blocks.filter((b) => HIT.has(b.ctrl));
    const base = { no: s.no, file: s.file, line: s.line, engine: false, name: null, type: s.statetype || 's', movetype: s.movetype || 'i' };
    out.states.push(Object.assign(base, own.length ? { kind: 'own', blocks: own.map(dmgOf) } : classify(s.no)));
  }
  if (moves.files.some((f) => f.key === 'stcommon' && f.engine)) {
    let eng = new Map();
    try { eng = require('./enginedata.js').stcommonAnims(); } catch (e) { eng = new Map(); }
    const mine = new Set(moves.states.map((s) => s.no));
    for (const [no, v] of eng) {
      if (mine.has(no) || v.movetype === 'h' || !v.anims.some((x) => plays.includes(x))) continue;
      out.states.push(Object.assign({ no, file: null, line: null, engine: true, name: COMMON_STATE_NAMES[no] || null, type: v.type || 's', movetype: v.movetype || 'i' }, classify(no)));
    }
  }
  return out;
}

// Make, update or remove the -3 hit group for one state that plays an action
// (hitgen.js, movelib.applyHitGroup). The request carries the .air's sha1 as
// the page read it - the boxes it saw are the boxes the hit is built for - and
// the state files' sha1s (files) so a stale page cannot write.
function charHitIn(dir, defName, req, opts) {
  const r = req || {};
  const n = Number(r.action), no = Number(r.state);
  if (!Number.isInteger(n) || !Number.isInteger(no)) throw editError('invalid', 'action and state must be whole numbers');
  const op = String(r.op || '');
  if (!['make', 'update', 'remove'].includes(op)) throw editError('invalid', 'op must be make, update or remove');
  const air = airFileIn(dir, defName);
  if (!air) throw editError('notfound', 'this character names no .air file it has');
  if (!r.sha1 || typeof r.sha1 !== 'string') throw editError('invalid', 'sha1 (the .air as read) is required');
  const text = fs.readFileSync(air.abs, 'latin1');
  if (editSha1(text) !== r.sha1) throw editError('stale', 'the .air changed since it was read - reload and try again');
  const A = airLib(), M = moveLib();
  const model = A.parseAirSpans(text);
  const d = A.describeAction(model, n);
  if (!d) throw editError('notfound', 'the .air defines no action ' + n);
  const moves = M.movesIn(dir, defName, { anims: false });
  const rep = charHitReport(moves, model, d, n);
  const st = rep.states.find((s) => s.no === no);
  if (!st) throw editError('notfound', 'state ' + no + ' does not play action ' + n);
  if (op === 'make' && st.kind !== 'none') throw editError('invalid', 'state ' + no + ' can already hit with action ' + n + '\'s boxes');
  if (op !== 'make' && st.kind !== 'added') throw editError('notfound', 'state ' + no + ' has no hit added by the editor for action ' + n);
  if (op !== 'remove' && !rep.boxes.length) throw editError('invalid', 'action ' + n + ' has no Clsn1 box to hit with');
  const res = M.applyHitGroup(dir, defName, {
    op, state: no, action: n, elems: rep.boxes, count: rep.count, stateType: st.type,
    idle: st.movetype !== 'a', scale: rep.scale, sparkY: rep.sparkY,
    sha1s: r.files && typeof r.files === 'object' ? r.files : null,
  });
  if (res.changed) invalidateDiag(path.basename(dir));
  return Object.assign(res, { air: charAirIn(dir, defName, n, opts) });
}
function charHit(mountAs, req) {
  const t = needTarget(mountAs);
  return charHitIn(t.dir, t.defName, req, { geom: geomReaderIn(t.dir, t.defName, charSff(mountAs)) });
}

// The states whose triggers an edit of `action` moves: those that may play it
// or an alias of it - an empty action before it or a Copy Action chain ending
// at it, which play the very same frames (airedit.aliasesOf). In model order.
function airStatesFor(moves, airModel, action) {
  if (!moves) return [];
  const M = moveLib(), A = airLib();
  const hit = new Set();
  for (const n of [action, ...A.aliasesOf(airModel, action)]) for (const s of M.statesUsingAction(moves, n)) hit.add(s);
  return moves.states.filter((s) => hit.has(s));
}

// States that may be playing the action WITHOUT naming it (movelib's
// outsiders), as renumber states for airedit. An atom whose guards prove it
// reads these frames (`Anim = K` with K playing them, or `StateNo = S` with S a
// state that plays nothing else) is renumbered like a trigger of that state;
// every other one the op would change is listed as blocking, with the reason.
//   negative    runs every tick in whatever animation is playing;
//   noanim      keeps the animation of the state it was entered from - counted
//               only when it is entered while the action plays: a literal
//               ChangeState / SelfState / p1stateno into it from a state that
//               plays it, from another such state, or from a negative state
//               whose guards name the action (see provesPlaying), or one whose
//               own `anim` parameter is the action; and not when it
//               ChangeAnims to other known actions on entry;
//   unresolved  an anim expression, or a ChangeAnim value, that resolves to no
//               number.
// GUARDS. The top-level && conjuncts ANDed with the atom - its own trigger
// line, the other lines of its group and every triggerall; a line joined by a
// top-level || gives none - that say `Anim = K` or `StateNo = S` rule the atom
// out when K does not play these frames or S cannot be running while they
// play. An atom on a triggerall or value line is read whenever some group
// fires, so it is ruled out only when every group is.
// A STATE NO SCANNED FILE DEFINES (`StateNo = 215` in a -3 of a character who
// has no state 215): the engine enters it as an empty state that keeps the
// playing animation (stateChange1, char.go:6666-6673), so it counts like an
// anim-less state - only on a literal entry that proves it. That holds where
// the character runs only her own states, which is every -1 and -3 (actionRun
// runs them only when c.ss.sb.playerNo == c.playerNo, char.go:12069, 12084); a
// -2 runs in an opponent's custom state too (char.go:12075-12080), where the
// number may be that state, so there it cannot be ruled out. A ZSS state is
// not scanned; an engine common1 state (stcommon = the engine's
// common1.cns.zss) plays the actions enginedata reads out of it; any other
// engine state cannot be told.
// REDIRECTED ATOMS (`Parent, AnimElemTime(6) = 0`, `root, animelem = 10`)
// read the animation of a player of THIS character (airedit.scanTrigger), in
// any state of any file - the state they are written in says nothing about
// it. They are decided the same way by the guards redirected to the SAME
// player (`Parent, Anim = 4000`, `Root, StateNo = 3200`): renumbered when one
// proves the frames, left alone when one rules them out, blocking otherwise.
// CHANGEANIM `elem = N` (movelib changeAnimElems) follows the controller's own
// value: renumbered when every candidate plays these frames, blocking when the
// value may be another action or names none, left alone when it names others.
function airOutsiderStates(moves, action, plays, using) {
  const out = [];
  const taken = new Set(using.map((s) => s.no));
  // States that play these frames and nothing else, by exact candidates.
  const only = new Set(using.filter((s) => {
    const cs = [s.anim, ...s.changeAnims].filter(Boolean);
    return !!s.anim && cs.every((c) => c.exact !== false && c.candidates.every((n) => plays.includes(n)));
  }).map((s) => s.no));
  const byNo = new Map(((moves && moves.outsiders) || []).map((st) => [st.no, st]));
  const known = new Map(((moves && moves.states) || []).map((s) => [s.no, s]));
  const undefinedByNo = new Map(((moves && moves.undefinedStates) || []).map((u) => [u.no, { no: u.no, entries: u.entries, onEntry: [] }]));
  const zss = new Set((moves && moves.zssStates) || []);
  let engAnims = new Map(), engStates = new Set();
  try {
    const E = require('./enginedata.js');
    if (moves && moves.stcommonEngine) engAnims = E.stcommonAnims();
    engStates = new Set([...E.commonStates(), ...E.hardcodedStates()]);
  } catch (e) { /* no engine data: engine states stay unknown */ }
  // The guards that must hold for a position of an expression to matter: the
  // && siblings of every && group enclosing it, parentheses followed (at -1:
  // those of the whole expression). An || group encloses nothing. Each guard
  // carries the redirection it is written under (`key`, '' for none).
  const guardsIn = (text, at) => {
    const s = String(text);
    const gs = [];
    // Trim, and peel parentheses that wrap the whole span.
    const peel = (a, b) => {
      for (;;) {
        while (a < b && /\s/.test(s[a])) a++;
        while (b > a && /\s/.test(s[b - 1])) b--;
        if (s[a] !== '(' || s[b - 1] !== ')') return [a, b];
        let d = 0;
        for (let i = a; i < b; i++) { if (s[i] === '(') d++; else if (s[i] === ')' && --d === 0 && i < b - 1) return [a, b]; }
        a++; b--;
      }
    };
    const split = (a, b, op) => {
      const cuts = [];
      let d = 0;
      for (let i = a; i < b - 1; i++) {
        if (s[i] === '(' || s[i] === '[') d++;
        else if (s[i] === ')' || s[i] === ']') d--;
        else if (d === 0 && s[i] === op && s[i + 1] === op) { cuts.push(i); i++; }
      }
      if (!cuts.length) return null;
      const parts = [];
      let from = a;
      for (const c of cuts) { parts.push([from, c]); from = c + 2; }
      parts.push([from, b]);
      return parts;
    };
    // `Anim = K`, `StateNo = S`, `Anim|StateNo = [a,b]` (inclusive), each
    // perhaps under a redirection (`Parent, Anim = K`), or an || of those.
    const keyOk = (k) => !k || airLib().redirectAt(k + ',x', k.length + 1) !== null;
    const guardOf = (a0, b0) => {
      const [a, b] = peel(a0, b0);
      const ors = split(a, b, '|');
      if (ors) {
        const each = ors.map(([x, y]) => guardOf(x, y));
        return each.every(Boolean) && each.every((g) => g.key === each[0].key) ? { kind: 'or', gs: each, key: each[0].key } : null;
      }
      if (split(a, b, '&')) return null;
      const txt = s.slice(a, b).replace(/\s+/g, '').toLowerCase();
      let m = /^(?:([a-z]+(?:\(.*\))?),)?(anim|stateno)=(-?\d+)$/.exec(txt);
      if (m && keyOk(m[1])) return { kind: m[2], n: Number(m[3]), key: m[1] || '' };
      m = /^(?:([a-z]+(?:\(.*\))?),)?(anim|stateno)=\[(-?\d+),(-?\d+)\]$/.exec(txt);
      if (m && keyOk(m[1])) return { kind: m[2] + '-range', lo: Number(m[3]), hi: Number(m[4]), key: m[1] || '' };
      return null;
    };
    const walk = (a0, b0, wanted) => {
      const [a, b] = peel(a0, b0);
      const ors = split(a, b, '|');
      if (ors) {
        if (wanted) { for (const [x, y] of ors) if (at >= x && at < y) walk(x, y, true); return; }
        const g = guardOf(a, b);
        if (g) gs.push(g);
        return;
      }
      const ands = split(a, b, '&');
      if (!ands) { if (!wanted) { const g = guardOf(a, b); if (g) gs.push(g); } return; }
      for (const [x, y] of ands) walk(x, y, wanted && at >= x && at < y);
    };
    walk(0, s.length, at >= 0);
    return gs;
  };
  const guardsOf = (text) => guardsIn(text, -1);
  const reachMemo = new Map();
  // Can state `no` be running while these frames play? ctx.ownOnly: the
  // guard is read where the character runs only her own states (a -1 or -3).
  const statePlays = (no, depth, ctx) => {
    if (taken.has(no)) return true;
    const o = byNo.get(no);
    if (o && o.reason === 'noanim') return reaches(o, depth + 1);
    if (o && o.reason === 'unresolved') return true;
    if (known.has(no)) return false;
    if (zss.has(no)) return true;                          // a ZSS state: not scanned
    if (engAnims.has(no)) { const e = engAnims.get(no); return e.open || e.anims.some((n) => plays.includes(n)); }
    if (engStates.has(no)) return true;                    // an engine state whose animations are not read
    if (!ctx || !ctx.ownOnly) return true;                 // may be another player's custom state
    return reaches(undefinedByNo.get(no) || { no, entries: [], onEntry: [] }, depth + 1);
  };
  const allows = (g, depth, ctx) => {
    if (g.kind === 'anim') return plays.includes(g.n);
    if (g.kind === 'stateno') return statePlays(g.n, depth, ctx);
    if (g.kind === 'anim-range') return plays.some((n) => n >= g.lo && n <= g.hi);
    if (g.kind === 'or') return g.gs.some((x) => allows(x, depth, ctx));
    // A StateNo range: the states defined in it; with none defined, cannot tell.
    const inRange = [...known.keys(), ...byNo.keys()].filter((n) => n >= g.lo && n <= g.hi);
    return !inRange.length || inRange.some((n) => statePlays(n, depth, ctx));
  };
  // The guards of one atom under its own redirection: those around it in its
  // own line (from its col), and the top-level ones of every other line it is
  // ANDed with.
  const guardsFor = (triggers, r, key) => {
    const own = triggers.find((t) => t.line === r.line);
    const others = triggers.filter((t) => t !== own && (t.group === 'all' || (own && own.group !== 'all' && t.group === own.group)));
    let mine = [];
    const pl = scenelib.paramLine(r.text);
    if (pl && Number.isInteger(r.col)) {
      let vs = pl.eq + 1;
      while (vs < r.text.length && /\s/.test(r.text[vs])) vs++;
      mine = guardsIn(r.text.slice(vs), r.col - vs);
    }
    return others.flatMap((t) => guardsOf(t.value)).concat(mine).filter((g) => g.key === key);
  };
  // A controller fires when any group does: it lets these frames through when
  // one of its groups' guards (with the triggeralls) does.
  const controllerAllows = (triggers, depth, ctx, key) => {
    const mineOf = (list) => list.flatMap((t) => guardsOf(t.value)).filter((g) => g.key === key);
    const groups = [...new Set(triggers.filter((t) => t.group !== 'all').map((t) => t.group))];
    const all = mineOf(triggers.filter((t) => t.group === 'all'));
    if (!groups.length) return all.every((g) => allows(g, depth, ctx));
    return groups.some((grp) => all.concat(mineOf(triggers.filter((t) => t.group === grp))).every((g) => allows(g, depth, ctx)));
  };
  // An anim-less state inherits these frames only on positive evidence: a
  // literal entry from a state that plays them (or from an anim-less state
  // that does), from a negative state whose entry guards name them
  // (Anim = K playing them, StateNo = S playing them), or with an `anim`
  // parameter that is one of them. A negative state's guard-less ChangeState
  // (a command cancel on ctrl) is not evidence: such entries come from
  // wherever control is given back, and counting them would list nearly every
  // special of every character.
  const provesPlaying = (no, depth) => taken.has(no) || (byNo.has(no) && byNo.get(no).reason === 'noanim' && reaches(byNo.get(no), depth + 1));
  const controllerProves = (triggers, depth) => {
    const plain = (list) => list.flatMap((t) => guardsOf(t.value)).filter((g) => g.key === '');
    const groups = [...new Set(triggers.filter((t) => t.group !== 'all').map((t) => t.group))];
    const all = plain(triggers.filter((t) => t.group === 'all'));
    const names = (gs) => gs.some((g) => (g.kind === 'anim' ? plays.includes(g.n) : g.kind === 'stateno' && provesPlaying(g.n, depth)));
    return groups.length ? groups.some((grp) => names(all.concat(plain(triggers.filter((t) => t.group === grp))))) : names(all);
  };
  // The first on-entry ChangeAnim to other known actions: from it on the
  // inherited frames are gone. Its index in the state (-1 when the model does
  // not say), or null when there is none.
  const awayAt = (o) => {
    let at = null;
    for (const c of o.onEntry || []) {
      if (!(c.exact && c.candidates.length && !c.candidates.some((n) => plays.includes(n)))) continue;
      const k = Number.isInteger(c.controller) ? c.controller : -1;
      if (at === null || k < at) at = k;
    }
    return at;
  };
  const entryProves = (o, depth) => (o.entries || []).some((e) => (e.animUnresolved ? true
    : e.anims ? e.anims.some((n) => plays.includes(n))
      : e.from < 0 ? controllerProves(e.triggers, depth) : provesPlaying(e.from, depth)));
  const reaches = (o, depth) => {
    if (reachMemo.has(o.no)) return reachMemo.get(o.no);
    if (depth > 16) return false;
    reachMemo.set(o.no, false); // a cycle adds nothing
    // A ChangeAnim on entry to other known actions: the inherited frames are
    // gone once it has run.
    const yes = awayAt(o) === null && entryProves(o, depth);
    reachMemo.set(o.no, yes);
    return yes;
  };
  const provesGuard = (g) => (g.kind === 'anim' ? plays.includes(g.n) : g.kind === 'stateno' && only.has(g.n));
  for (const st of (moves && moves.outsiders) || []) {
    if (taken.has(st.no)) continue;
    // THE ENTRY TICK. An anim-less state that ChangeAnims on entry to other
    // actions still reads the inherited frames with every controller above
    // that ChangeAnim on the tick it is entered: controllers run in file order
    // (bytecode.go:4715-4724) and the ChangeAnim takes effect when it runs
    // (bytecode.go:5500-5509). When an entry proves the action those readers
    // are listed; the ones below it read the new action.
    let entryTick = null;
    if (st.reason === 'noanim' && !reaches(st, 0)) {
      const at = awayAt(st);
      if (at === null || at < 0 || !entryProves(st, 0)) continue;
      entryTick = at;
    }
    const ua = st.unresolvedAt;
    const turn = entryTick === null ? null : (st.onEntry || []).find((c) => c.controller === entryTick);
    const why = entryTick !== null
      ? `state ${st.no} has no anim: on the tick it is entered, the controllers above its ChangeAnim at line ${turn ? turn.line : '?'} still read the animation of the state it was entered from, which can be action ${action}; not renumbered automatically`
      : st.reason === 'negative'
      ? `state ${st.no} is a negative state: it runs every tick in whatever animation is playing, which may be action ${action}; not renumbered automatically`
      : st.reason === 'noanim'
        ? `state ${st.no} has no anim: it keeps the animation of the state it was entered from, and it can be entered while action ${action} plays; not renumbered automatically`
        : ua && !ua.header
          ? `state ${st.no}'s ${ua.type} value = ${ua.raw} (line ${ua.line}) resolves to no animation number, so it may play action ${action}; not renumbered automatically`
          : `state ${st.no}'s anim = ${st.anim} resolves to no animation number, so it may be action ${action}; not renumbered automatically`;
    const ctx = { ownOnly: st.no === -1 || st.no === -3 };
    const refs = [], sure = [];
    for (const c of st.controllers) {
      if (entryTick !== null && !(Number.isInteger(c.controller) && c.controller < entryTick)) continue;
      for (const r of c.animElemTriggers) {
        if (r.redirect && r.redirect.own) continue;   // another player's animation: decided below
        const own = c.triggers.find((t) => t.line === r.line);
        const gs = guardsFor(c.triggers, r, '');
        if (!gs.every((g) => allows(g, 0, ctx))) continue;
        // A triggerall or value line is read whenever some group fires.
        if ((!own || own.group === 'all') && !controllerAllows(c.triggers, 0, ctx, '')) continue;
        if (own && own.group !== 'all' && gs.some(provesGuard)) sure.push(r);
        else refs.push(r);
      }
    }
    if (sure.length) out.push({ no: st.no, file: st.file, line: st.line, anim: { candidates: [action] }, changeAnims: [], animElemTriggers: sure });
    if (refs.length) out.push({ no: st.no, file: st.file, line: st.line, outside: { why }, animElemTriggers: refs });
  }
  const WHO = { parent: 'its parent', root: 'the root', helper: 'a helper', helperindex: 'a helper', stateowner: 'the state owner (this character\'s root)' };
  for (const st of (moves && moves.redirected) || []) {
    const sure = [], refs = new Map(), named = [];
    const ctx = { ownOnly: false };
    // Whose animation it is cannot be known: player/playerid/playerindex can
    // name any player (char.go:5156-5183), and in a -2 or -4 stateowner is
    // the root of whoever's custom state this character is in (char.go:
    // 4902-4905, 12075-12080). Never renumbered; blocking when a guard on the
    // same player names the action, a warning (from scanTrigger) otherwise.
    const anyPlayer = (r) => r.redirect.any || (r.redirect.name === 'stateowner' && (st.no === -2 || st.no === -4));
    for (const c of st.controllers) {
      for (const r of c.animElemTriggers) {
        const key = r.redirect.key;
        const own = c.triggers.find((t) => t.line === r.line);
        const gs = guardsFor(c.triggers, r, key);
        if (!gs.every((g) => allows(g, 0, ctx))) continue;
        if ((!own || own.group === 'all') && !controllerAllows(c.triggers, 0, ctx, key)) continue;
        const proves = own && own.group !== 'all' && gs.some(provesGuard);
        if (anyPlayer(r)) { if (proves) named.push(r); continue; }
        if (proves) sure.push(r);
        else { if (!refs.has(r.redirect.name)) refs.set(r.redirect.name, []); refs.get(r.redirect.name).push(r); }
      }
    }
    if (sure.length) out.push({ no: st.no, file: st.file, line: st.line, scope: 'redirect', anim: { candidates: [action] }, changeAnims: [], animElemTriggers: sure });
    if (named.length) {
      const why = `it reads the animation of the player ${named[0].redirect.key} names, and a guard on that player names action ${action}; that player can be this character or another one (char.go:4902-4905, 5156-5183), so it is not renumbered automatically - check the line and edit it by hand if it means this character`;
      out.push({ no: st.no, file: st.file, line: st.line, scope: 'redirect', outside: { why }, animElemTriggers: named });
    }
    for (const [name, list] of refs) {
      const why = `${name} reads the animation of ${WHO[name] || 'another player'}, a player that plays from this character's .air and may be on action ${action} whatever state this is written in (compiler.go:1427-1590, char.go:5256-5260); nothing redirected to it names the action or its state, so it is not renumbered automatically`;
      out.push({ no: st.no, file: st.file, line: st.line, scope: 'redirect', outside: { why }, animElemTriggers: list });
    }
  }
  for (const x of (moves && moves.changeAnimElems) || []) {
    const v = x.value;
    if (v.foreign) continue;                                  // another animation table (a table prefix)
    const cands = v.keepsCurrent ? x.stateAnims : v.candidates;
    const exact = v.keepsCurrent ? x.stateAnimsExact : v.exact;
    const ctl = x.type === 'changeanim2' ? 'ChangeAnim2' : 'ChangeAnim';
    let mode, why;
    if (x.otherTable.length) { mode = 'unknown'; why = `this ${ctl} sets ${x.otherTable.join(', ')}, so the action it jumps into may be another player's`; }
    else if (v.keepsCurrent && !cands.length) { mode = 'unknown'; why = `this ${ctl}'s value = ${v.raw} keeps whatever action is playing, and nothing in its state names it, so the jump may be on action ${action}`; }
    else if (v.unresolved) { mode = 'unknown'; why = `this ${ctl}'s value = ${v.raw} resolves to no animation number, so the jump may be on action ${action}`; }
    else {
      const hit = cands.filter((n) => plays.includes(n));
      if (!hit.length) continue;
      if (hit.length === cands.length && exact) mode = 'all';
      else {
        mode = 'some';
        const rest = cands.filter((n) => !plays.includes(n));
        why = rest.length ? `this ${ctl}'s value = ${v.raw} can also be action ${rest.join(', ')}, where element ${x.ref.elem} is a different frame` : `this ${ctl}'s value = ${v.raw} is computed and may name another action`;
      }
    }
    // A COMPUTED ELEM names an element number too: `elem = var(0)`,
    // `elem = 12 + (!vel x) * 3` - evaluated when the controller runs and set
    // right after the change (bytecode.go:5494-5509, char.go:4735-4760), so an
    // insert, delete or move changes which frame it lands on and nothing here
    // can rewrite it. One built on AnimElemNo already blocks through the
    // AnimElemNo rule on its own line.
    const ref = Object.assign({}, x.ref, { plays: mode, why });
    if (x.ref.expression && !/animelemno/i.test(String(x.ref.raw))) {
      ref.computed = `elem = ${x.ref.raw} is computed: which element of action ${action} it names depends on the frames, so it is not renumbered automatically`;
    }
    out.push({ no: x.no, file: x.file, line: x.line, scope: 'elem', animElemTriggers: [ref] });
  }
  return out;
}

// A ZSS state file of the character is not parsed (movelib notScanned). One
// that reads AnimElem at all may hold a state playing the action: listed as
// blocking at its first AnimElem line, under the statedef above it.
function airZssBlocking(dir, moves, action) {
  const out = [];
  for (const rel of (moves && moves.notScanned) || []) {
    const f = moves.files.find((x) => x.rel === rel && x.path);
    let text = '';
    try { text = f ? fs.readFileSync(path.join(dir, f.path), 'latin1') : ''; } catch (e) { text = ''; }
    const lines = text.split('\n');
    const at = lines.findIndex((l) => /animelem/i.test(l.split('#')[0]));
    if (at < 0) continue;
    let state = null;
    for (let i = at; i >= 0; i--) { const m = /^\s*\[\s*statedef\s+(-?\d+)/i.exec(lines[i]); if (m) { state = Number(m[1]); break; } }
    out.push({ file: rel, state, block: null, type: null, line: at + 1, text: lines[at].trim(), why: `ZSS state files are not scanned, and this one reads AnimElem: a state in it may play action ${action} - check it by hand` });
  }
  return out;
}
function charAir(mountAs, action) {
  const t = needTarget(mountAs);
  return charAirIn(t.dir, t.defName, action, { geom: geomReaderIn(t.dir, t.defName, charSff(mountAs)) });
}

// A state file parsed alone from text, through a temp file with the same
// extension (scenelib reads paths, and picks ZSS by extension). The temp file
// goes through rmFile: a bare fs.rmSync removes nothing under a non-ASCII
// TEMP, and a miss leaves litter, never a failed renumber.
function parseStateTextAlone(text, rel, ikemenVersion) {
  const os = require('os');
  let consts = new Map();
  try { consts = require('./enginedata.js').consts(); } catch (e) { consts = new Map(); }
  const tmp = path.join(os.tmpdir(), 'studio-renumber-' + process.pid + '-' + Math.random().toString(36).slice(2) + (path.extname(rel) || '.cns'));
  fs.writeFileSync(tmp, Buffer.from(text, 'latin1'));
  try { return scenelib.parseStates([{ key: 'st', rel, abs: tmp }], { consts, ikemenVersion }); } finally { try { rmFile(tmp); } catch (e) { /* a temp leftover only */ } }
}

// THE VALIDATE STEP FOR A TRIGGER RENUMBER (§9: "list every AnimElem trigger
// ... and offer to renumber them"). Each splice replaces the digits of one
// literal element number, so after it:
//   - every statedef, header, controller type, line and label reads as before
//     (a splice that lands in the wrong place and breaks a `[State` line or a
//     `type =` fails here - §11, the engine would drop it silently);
//   - only controllers owning a touched line may read differently;
//   - each spliced token is still a plain number in the new text.
function renumberValidator(rel, splices, ikemenVersion) {
  return (newText, oldText) => {
    for (const s of splices) {
      if (!/^\d+$/.test(String(s.text))) return 'a renumbered element is not a whole number';
    }
    const lineOf = (off) => { let n = 1; for (let i = oldText.indexOf('\n'); i >= 0 && i < off; i = oldText.indexOf('\n', i + 1)) n++; return n; };
    const touched = splices.map((s) => lineOf(s.start));
    let a, b;
    try { a = parseStateTextAlone(oldText, rel, ikemenVersion); b = parseStateTextAlone(newText, rel, ikemenVersion); } catch (e) { return 're-parse failed: ' + e.message; }
    const shape = (p) => JSON.stringify({
      states: [...p.states.values()].map((s) => [s.no, s.line, [...s.header.entries()], s.sctrls.map((c) => [c.type, c.line, c.label, c.tag])]),
      shadowed: p.shadowed.map((x) => [x.no, x.line]), lost: p.lost.map((x) => x.line), dropped: p.droppedNegative.map((x) => [x.no, x.line]),
    });
    if (shape(a) !== shape(b)) return 'the file\'s statedefs or controllers would change';
    // A controller's body runs from its [State line to the next bracket line
    // the parser saw ([State or [Statedef), in any state of the file.
    const bounds = [];
    for (const s of a.states.values()) { bounds.push(s.line); for (const c of s.sctrls) bounds.push(c.line); }
    bounds.sort((x, y) => x - y);
    for (const [no, sa] of a.states) {
      const sb = b.states.get(no);
      for (let k = 0; k < sa.sctrls.length; k++) {
        const ca = sa.sctrls[k], cb = sb.sctrls[k];
        const next = bounds.find((x) => x > ca.line);
        if (touched.some((ln) => ln > ca.line && (next === undefined || ln < next))) continue;
        if (JSON.stringify([ca.trig, [...ca.params.entries()]]) !== JSON.stringify([cb.trig, [...cb.params.entries()]])) {
          return 'a controller that was not renumbered would change (state ' + no + ', line ' + ca.line + ')';
        }
      }
    }
    return null;
  };
}

// Validate every file's new text first, then write them one by one; if a
// later write fails, the earlier ones are put back, so a structural edit and
// its renumbering land together or not at all.
function writeAllOrNothing(list) {
  const CE = charEdit();
  for (const w of list) {
    const why = w.validate(CE.applySplices(w.text, w.splices), w.text);
    if (why) throw editError('refused', w.rel + ': ' + why);
  }
  const done = [];
  let current = null;
  try {
    for (const w of list) {
      current = { w, hadBackup: CE.hasBackup(w.abs) };
      const res = CE.writeSpliced(w.abs, w.splices, { expectText: w.text, validate: w.validate });
      done.push({ w, res });
      current = null;
    }
  } catch (e) {
    // The write that failed may have taken its first backup and left its temp
    // file before the rename failed (charedit backs up, writes the temp, then
    // renames). When the file itself is untouched, neither should stay: a
    // backup of an unedited file would show as "Edited" with nothing to revert.
    if (current) {
      try {
        const t = current.w.abs + '.edit-tmp-' + process.pid;
        rmFile(t);
        if (!current.hadBackup && CE.hasBackup(current.w.abs) && fs.readFileSync(current.w.abs, 'latin1') === current.w.text) {
          rmFile(CE.backupPath(current.w.abs));
        }
      } catch (e3) { /* best effort; the original error is what is reported */ }
    }
    // A file that cannot be put back keeps the edit while the others do not:
    // an .air with the new element next to a .cns still reading the old
    // numbers (AnimElem = 3 then reads the frame before, anim.go:507-520). That
    // is said, file by file, with its own code so the page reads the files
    // again and its Edited strip lists what is left.
    const stuck = [];
    for (const { w, res } of done.reverse()) {
      try {
        if (!res.changed) continue;
        if (res.backupCreated) CE.revert(w.abs);
        else {
          const cur = fs.readFileSync(w.abs, 'latin1');
          CE.writeSpliced(w.abs, [{ start: 0, end: cur.length, text: w.text, allowNewline: true }], {});
        }
        if (fs.readFileSync(w.abs, 'latin1') !== w.text) throw new Error('it still differs from the original');
      } catch (e2) { stuck.push({ file: w.rel, why: e2.code || e2.message }); }
    }
    if (stuck.length) {
      throw editError('partial', e.message + ' - and ' + stuck.map((s) => s.file + ' could not be put back (' + s.why + '): it keeps the edit, use Revert on it').join('; '), { partial: stuck.map((s) => s.file) });
    }
    throw editError(/changed since/.test(e.message) ? 'stale' : 'refused', e.message);
  }
  return done.map(({ w, res }) => ({ file: w.rel, changed: res.changed, backupCreated: !!res.backupCreated }));
}

const AIR_STRUCTURAL = { insert: 'planInsertElement', delete: 'planDeleteElement', move: 'planMoveElement', addbox: 'planAddBox', removebox: 'planRemoveBox' };

// POST /api/char-air-edit. Ops:
//   timing                  { action, elem, time }            never writes
//   element                 { action, elem, field, value }    value edit
//   clsn                    { action, elem, which, box, coords, scope? }
//   insert | delete | move | addbox | removebox              structural
// Value edits write unless dryRun:true. Structural edits return the plan
// (dryRun) unless confirm:true; a confirmed plan whose renumbering lists
// blocking triggers, or triggers without an exact span, needs force:true, and
// then those triggers are left as they are. Every write needs `sha1` = the .air
// as the page read it.
function charAirEditIn(dir, defName, req, opts) {
  const r = req || {};
  const o = opts || {};
  const op = String(r.op || '').toLowerCase();
  const A = airLib(), M = moveLib();
  const air = airFileIn(dir, defName);
  if (!air) throw editError('notfound', 'this character names no .air file it has');
  const text = fs.readFileSync(air.abs, 'latin1');
  const sum = editSha1(text);
  const moves = M.movesIn(dir, defName, { anims: false, outsiders: true });
  const action = Number(r.action);
  if (!Number.isInteger(action)) throw editError('invalid', 'action must be a whole number');
  const airModel = A.parseAirSpans(text);
  const using = airStatesFor(moves, airModel, action);
  const states = using.map(airStateView);
  const planError = (p) => editError(/^refused/.test(p.error) ? 'refused' : 'invalid', p.error, p.needsScope ? { needsScope: p.needsScope, affects: p.affects, scope: p.scope } : undefined);
  const checkSha = () => {
    if (!r.sha1) throw editError('invalid', 'sha1 (the .air as read) is required to write');
    if (String(r.sha1) !== sum) throw editError('stale', 'the .air changed since it was read - reload and try again');
  };
  const after = (written) => {
    invalidateDiag(path.basename(dir));
    return Object.assign(written, { air: charAirIn(dir, defName, action, o), edited: charEdit().listEdited(dir) });
  };

  if (op === 'timing') {
    const t = A.timingImpact(text, action, r.elem, r.time, states);
    if (t.error) throw planError(t);
    return { sha1: sum, timing: t };
  }

  if (op === 'element' || op === 'clsn') {
    const plan = op === 'element'
      ? A.planElementEdit(text, { action, elem: r.elem, field: r.field, value: r.value })
      : A.planClsnEdit(text, { action, elem: r.elem, which: r.which, box: r.box, coords: r.coords, scope: r.scope });
    if (plan.error && plan.needsScope) {
      throw editError('confirm', plan.error, { needsScope: plan.needsScope, affects: plan.affects, scope: plan.scope });
    }
    if (plan.error) throw planError(plan);
    let timing;
    if (op === 'element' && plan.field === 'time') {
      const t = A.timingImpact(text, action, plan.elem, plan.after, states);
      if (!t.error) timing = t;
    }
    if (r.dryRun === true || plan.noop) return { dryRun: r.dryRun === true, changed: false, sha1: sum, plan, timing };
    checkSha();
    const res = writeAllOrNothing([{ abs: air.abs, rel: air.rel, text, splices: plan.splices, validate: (n, old) => A.validateAir(n, old, plan.expected) }]);
    return after({ changed: res[0].changed, files: res, plan, timing });
  }

  if (AIR_STRUCTURAL[op]) {
    // Ops that renumber elements also look at what can reach the action
    // without naming it: those triggers are listed, never rewritten.
    const renumbers = op === 'insert' || op === 'delete' || op === 'move';
    const plays = [action, ...A.aliasesOf(airModel, action)];
    const outsiders = renumbers ? airOutsiderStates(moves, action, plays, using) : [];
    const plan = A[AIR_STRUCTURAL[op]](text, {
      action, elem: r.elem, after: r.after, copyOf: r.copyOf, to: r.to, loopstart: r.loopstart,
      which: r.which, box: r.box, coords: r.coords, states: states.concat(outsiders), redirectsHandled: renumbers,
    });
    if (plan.error) throw planError(plan);
    if (renumbers && plan.renumber && !plan.noop) plan.renumber.blocking.push(...airZssBlocking(dir, moves, action));
    const renumber = plan.renumber || { map: {}, triggers: [], blocking: [] };
    const noSpan = renumber.triggers.filter((t) => !t.splices || !t.splices.length);
    if (plan.noop) return { dryRun: false, changed: false, sha1: sum, plan };
    if (r.confirm !== true) return { dryRun: true, changed: false, sha1: sum, plan, needsForce: renumber.blocking.length > 0 || noSpan.length > 0 };
    checkSha();
    if ((renumber.blocking.length || noSpan.length) && r.force !== true) {
      throw editError('blocking', 'some triggers cannot be renumbered automatically - review them and confirm with force', { blocking: renumber.blocking, noSpan });
    }
    const writes = [{ abs: air.abs, rel: air.rel, text, splices: plan.splices, validate: (n, old) => A.validateAir(n, old, plan.expected) }];
    const byFile = new Map();
    for (const t of renumber.triggers) for (const s of (t.splices || [])) {
      if (!byFile.has(s.file)) byFile.set(s.file, []);
      byFile.get(s.file).push({ start: s.start, end: s.end, text: s.text });
    }
    const root = path.resolve(dir) + path.sep;
    for (const [rel, splices] of byFile) {
      const fm = moves && moves.files.find((f) => f.rel === rel && f.scanned && !f.engine && !f.zss);
      if (!fm) throw editError('refused', 'a trigger to renumber is not in a state file of this character: ' + rel);
      const abs = path.join(dir, fm.path);
      if (!path.resolve(abs).startsWith(root)) throw editError('refused', 'outside the character folder: ' + rel);
      const cur = fs.readFileSync(abs, 'latin1');
      if (fm.sha1 && editSha1(cur) !== fm.sha1) throw editError('stale', rel + ' changed while the plan was made - reload and try again');
      writes.push({ abs, rel: fm.path, text: cur, splices, validate: renumberValidator(rel, splices, moves.ikemenVersion) });
    }
    const res = writeAllOrNothing(writes);
    return after({
      changed: res.some((x) => x.changed), files: res, plan,
      renumbered: renumber.triggers.filter((t) => t.splices && t.splices.length).length,
      leftAsIs: { blocking: renumber.blocking, noSpan },
    });
  }
  throw editError('invalid', 'unknown op ' + JSON.stringify(r.op));
}
function charAirEdit(mountAs, req) {
  const t = needTarget(mountAs);
  return charAirEditIn(t.dir, t.defName, req, { geom: geomReaderIn(t.dir, t.defName, charSff(mountAs)) });
}

module.exports = {
  H_FAMILIES, hFamily, defFiles, sffSpriteKeys, airFrames, pairBenchIn, pairBench,
  parseExportSelect, launchInfo, launchArgs, launchPair,
  validateEngineExe, eselectInfo, themesInfo, motifDefPath, motifVpathOk, cellIndexes,
  resolveCI, themeFileFor, motifDir, scanMissingDepsIn, encodeDefValue, patchDisplayNameText,
  soundAudit, soundAuditIn, soundCallsIn, contentAudit, netplayVerdict, sndKeySet, parseSoundRef,
  sndEntries, wavInfo, charSoundsIn, charSounds, charSoundBlobIn, charSoundBlob,
  spritePngFor, portraitStandIn, motifSelectInfo, motifSpritePng,
  characterLibrary, setBuildOrder, setCharProps,
  portraitState, applyPortraitFix, revertPortraitFix,
  customPaletteState, spriteIndexedFor, paletteBase64, saveCustomPalette, importCustomPalette, removeCustomPalette,
  packPortraitSpec, portraitFitState, portraitFitPreview, setPortraitFit, savePortraitPicture, portraitPicturePath,
  // A MOUNT NAME IS NOT A FOLDER NAME. Exported so callers outside this module
  // stop rebuilding path.join(CACHE, id) by hand - /api/open-folder did exactly
  // that and 404'd on every variant.
  charSource,
  addCharacter, removeCharacter, removeMany, addStage, removeStage, scanStageDeps, attachedCharFiles, rewriteAttachedCharFiles,
  motifGridSize, placeInRoster, invalidateDiag,
  convertPngPalettes, revertPngPalettes, pngPaletteRefs,
  fillPaletteGaps, revertPaletteGaps, paletteGapReport,
  checkCharFiles, checkAllChars, engineDataDirs, engineProvidedIn,
  addMusic, removeMusic, studioInfo, studioInfoLight, bufferToTemp, buildSizes,
  setMaxMatches, charAnim, charScale, cellPortraits, charAbout,
  charPalettes, paletteBytes, previewPalette, charActions, charBodyAction, bestPortrait, bestPortraitFor,
  // Exported so the palette rule can be audited across a roster from a
  // script rather than inferred from rendered output one sprite at a time.
  spriteFollowsPalette,
  charAnimGif, canExportGif,
  // The rest of the private GIF surface: one run as a PNG, the composed runs
  // and the frame timing the leaderboard extractor builds its art from, and
  // the win pose/colors the panel picks for that art.
  charAnimStill, charAnimRuns, gifTiming, boardArtTool, canBoardArt, boardArtFor, setBoardArt, carryBoardArt,
  describeMotifRows,
  motifDefText, writeMotifDefText, writeMotifGrid, spriteGeomFor,
  fixV1Palettes, revertV1Palettes, fixPalKeys, revertPalKeys, inspectPalKeys,
  inspectPalApplier, fixPalApplier, revertPalApplier,
  scanMissingDeps, depsWithOwners, addDependency,
  pairArtPaletteIndices, pairArtRepaintCount, inspectPortrait, addPortrait, revertPortrait, buildSceneViewerLua,
  listThemes, setTheme, addTheme, removeTheme, themeLayout, applyThemeLayout, themeFolderDir,
  // For the screenpack option switch (themeopts.js): an install's system.def
  // patch chain, a layout read from text, the re-lay worked out in memory.
  patchInstalledMotif, layoutFromSelectText, layoutFromSystemDefText, relayChars, rosterCellsNeeded,
  // Readers the whole-build import (buildimport.js) reads a source install
  // with, so there is one set of rules for what a .def says and what a stage
  // needs rather than a second copy of them.
  parseDefSections, isStageDef, rewriteStageDeps, carryMotifRefs, slugify,
  logoInfo, addLogo, removeLogo,
  repairThemeRefs,
  hScan, hScanUncached, findMainDef, setCharScale, setCharConsts, resetCharConsts, readCharConsts, cleanChar,
  charStats, setCharStats, writeCharStats, charCnsPath,
  reencodeName, looksShiftJis, charDefs, addCharVariant, classifyDef, sffVersionOf,
  setDisplayName, revertDisplayName,
  // Moves and animation editing (movelib / airedit / charedit), by mount name
  // and by folder for the tests.
  charMoves, charMovesIn, charMoveEdit, charMoveEditIn, charMoveAdd, charEditsIn,
  charEditRevert, charEditRevertIn, charAir, charAirIn, charAirEdit, charAirEditIn, airFileIn, charHit, charHitIn, charHitReport,
};
module.exports.setPaletteOrder = setPaletteOrder;

// ---- the pause menu's Command List (cmdlist.js) ----------------------------------
// What the export writes into a character's COPY, read from her own files, with
// the owner's choices from her roster entry (commandList, on CHAR_PERSIST). The
// character's folder is only read. -> the GET /api/movelist body, or null.
function charMovelist(mountAs) {
  const t = charTargetOf(mountAs);
  if (!t) return null;
  const CL = require('./cmdlist.js');
  const c = rosterCharOf(readRoster(), mountAs);
  const ch = CL.cleanChoices(c && c.commandList) || {};
  // cancels: the Moves page's SP / SU / CH marks (cmdlist.js THE CANCELS; an export never reads them)
  const r = CL.readFor(t.dir, t.defName, { names: ch.names, hidden: ch.hidden, cancels: true });
  if (!r) return null;
  return {
    ok: true, char: mountAs, def: t.defName, inBuild: !!c,
    own: r.own ? { file: r.own.file, text: r.own.text } : null,
    enabled: !ch.off,
    // what the next export does for her: writes the file, or nothing (switched off, her own list, no moves found)
    writes: !ch.off && !r.own && !!r.text,
    // merged: the states one line stands for (a move's Light/Medium/Strong versions, cmdlist.js mergeStrengths)
    rows: r.rows.map((x) => ({ state: x.state, group: x.group, name: x.name, nameFrom: x.nameFrom, raw: x.raw, input: x.input, glyphs: x.glyphs, hidden: x.hidden, weak: x.weak, drawable: x.drawable, file: x.file, line: x.line, merged: x.merged })),
    // inputs: every state the -1 reaches by a command, normals and throws included (cmdlist.js EVERY INPUT): the Moves page prints them
    // range: a proximity normal's distance (cmdlist.js PROXIMITY)
    inputs: (r.inputs || []).map((x) => ({ state: x.state, input: x.input, glyphs: x.glyphs, stance: x.stance, file: x.file, line: x.line, listed: x.listed, range: x.range || null })),
    // cancels: [{ state, to: [{ state, kind: 'SP'|'SU'|'CH', hit, block, exact, via, file, line }] }] (cmdlist.js THE CANCELS)
    cancels: r.cancels || [],
    text: r.text,
  };
}
// body = { rows: [{ state, name?, hidden? }], enabled? }: names ('' puts the
// generated one back), hides, and the switch, over what is saved.
function setCharMovelist(mountAs, body) {
  const roster = readRoster();
  const c = rosterCharOf(roster, mountAs);
  if (!c) throw new Error('not in build: ' + mountAs);
  const b = body || {};
  if (b.enabled !== undefined && typeof b.enabled !== 'boolean') throw new Error('enabled is true or false');
  if (b.rows !== undefined && !Array.isArray(b.rows)) throw new Error('rows is a list');
  const next = require('./cmdlist.js').applyRows(c.commandList, b.rows, b.enabled);
  if (next) c.commandList = next; else delete c.commandList;
  roster.chars = roster.chars.map(cleanChar);
  writeRoster(roster);
  return charMovelist(mountAs);
}
module.exports.charMovelist = charMovelist;
module.exports.setCharMovelist = setCharMovelist;
// For lifebars.js: unpacking a downloaded lifebar pack, and finding each
// character's sprite file to check the portraits a lifebar draws.
module.exports.extractZip = extractZip;
module.exports.isArchive = isArchive;
module.exports.charSffPath = charSffPath;
// For textransform.js: a stage's round variants, whose models are part of it.
module.exports.roundDefNames = roundDefNames;
