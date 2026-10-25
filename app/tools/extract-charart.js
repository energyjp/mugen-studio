// Character art extractor for the leaderboard (build-time, Node only).
//
// Pulls two things out of each character IN THE BUILD and writes them as plain
// web assets, so the leaderboard page needs ZERO knowledge of MUGEN formats:
//
//   <out>/<char>/portrait.png   - the select-screen portrait (sprite 9000,1)
//   <out>/<char>/win-NN.png     - each frame of the win-pose animation, cropped
//                                 to what it draws
//   <out>/<char>/win.gif        - the same animation as one looping GIF,
//                                 for anywhere that cannot animate frames itself
//   <out>/manifest.json         - per character: display name, portrait,
//                                 and the win animation as [{src,ms,x,y,w,h}]
//
// It DRAWS NOTHING ITSELF. Every picture comes from the Studio's composer
// (modlib.charAnimRuns / charAnimGif / spritePngFor) - the one place that
// decides where a run's pixels land and what color they come out, the same
// code the animation panel's GIF uses. This file used to carry its own .air
// reader, its own palette rule and its own timing, and all three drifted from
// the engine: flipped win poses came out facing the wrong way, a v2 character's
// chosen colors were ignored, and a pose's frames were rounded one at a time
// (amysorel's 1,400 ms pose played in 1,280). What is left here is choosing
// WHICH action and WHICH colors, and writing the files.
//
// WHO: the roster, not the cache folder. Every roster entry that is a
// character (not a random slot or a hole) is resolved through modlib by its
// mount name - its own .def, the one the build ships, never a guess from the
// folder name (a folder can hold intro.def, a 3v3.def, or a second version of
// the character). A folder that is on disk but not in the build gets no art.
//
// Usage:  node tools/extract-charart.js [outDir]
//         (default outDir: the active bundle's leaderboard-art folder,
//         layout.LEADERBOARD_ART - for the checkout's Main, ../leaderboard-art
//         beside the program folder)
// In-process: this module's extractAll(outDir, quiet) - export.js runs it
// (makeBoardArt) on every private Website export of a bundle with a
// leaderboard, and the Studio's Make button does the same.
// Ships in shareable copies since 2026-09-28; the legacy kit bans it.

const fs = require('fs');
const path = require('path');
const layout = require('../layout');
const modlib = require('../modlib.js');
const scenelib = require('../scenelib.js');
const X = require('../cnsexpr.js');
const sffDecode = require('./sff-decode.js');
const { airEntries } = require('../public/ikemen/animview-core.js');

// MUGEN convention: 9000,0 is the small select cell, 9000,1 the big portrait.
const PORTRAIT = [9000, 1];
// When the engine's win path cannot be read from the state files (a random
// pick, a variable, a held button), the conventional win poses in this order:
// 181 first, because in the classic layout state 180 is only a router (kfm.cns
// [Statedef 180] ChangeStates to 181 at once, and [Statedef 181] sets
// `anim = 181`). 182/183 are the usual alternates.
const WIN_ACTIONS = [181, 180, 182, 183];
// A safety cap on the pictures written for one pose. The frames are the GIF's
// frames (identical neighbors already joined, runs under 2cs shown with the
// next), so a real win pose is far below it - the longest in Main is 37.
const MAX_FRAMES = 120;
// The beat a held last frame gets before the pose loops. The engine holds
// forever, so this is the board's own pacing, kept at what the board has
// always used (the Studio's GIF button uses 2 s).
const BOARD_HOLD_MS = 900;
// How many ChangeStates the win path follows before giving up.
const MAX_HOPS = 4;

// ---------------------------------------------------------------------------
// WHICH ACTION: the engine's win path.
//
// On a win the engine puts the character into state 180 (system.go:3611,
// selfState(180) in the win-pose block) and she plays whatever that state
// leads to. The leaderboard shows the WINNER OF A MATCH, so the path is read
// the way it runs at the end of a won match: the round is over (roundstate 4 -
// the win-pose counter only runs once the round reaches it, system.go:3560-3563),
// the match is over, and there is one opponent (a ranked match is one on one;
// a KO'd opponent still exists). The state files are the .def's own [Files]
// keys in the engine's order, the first definition of a state winning
// (scenelib.stateFiles / parseStates, compiler.go:8163-8168, 8345-8371, 7111).
//
// At each state, on its first two ticks (time 0 and 1), its ChangeState /
// SelfState controllers are read in order:
//   - a trigger that is certainly false then is passed over;
//   - one whose trigger cannot be read (a held button, a variable, random,
//     prevstateno, life, a partner) is passed over too - it is a special case
//     the author checks before the ordinary one;
//   - the first one that certainly fires HANDS THE STATE OVER at once: its
//     own anim is never really on screen, so a literal value is followed to
//     that state (kfm; leonaheidern_xiii_p-tan, whose [Statedef 181] plays
//     anim 180 - her anim 181 never shows on a win; cj, whose 180 sets anim
//     180 but moves to 181 the moment the match is over; dr_kira_update's 183
//     on every match win, after 182 on `life >= 500`), and a computed one
//     (`181 + random%5`) leaves the pose to the conventional list.
// Where nothing certainly leaves the state, its own literal `anim` is the
// pose; a state reached by a hand-over that has none (its anim is computed,
// or set by a ChangeAnim) is played as the action of its own number; state
// 180 itself with none goes to the conventional list.
//
// What this deliberately does NOT do is follow a ChangeState that cannot be
// shown to fire. Measured on Main: the first such ChangeState in state 180 is
// usually that special case - after a particular super (hibiki_se 3313 -> 184,
// cvsyokorx 3306 -> 185), after a taunt that loops (sakura 4002), a partner's
// name (chun_li_jj 184), a flag (fau 184, whose anim is the stance) - and
// following it put those on the board instead of the win pose every ordinary
// match shows. The conventional list keeps them on 181.
const MATCH_WIN = { matchover: '1', roundstate: '4', numenemy: '1' };
const atMatchWin = (expr) => String(expr).replace(/\b(matchover|roundstate|numenemy)\b/gi, (m) => MATCH_WIN[m.toLowerCase()]);

// Whether a controller certainly fires on tick `t` of a match win: true,
// false, or null when its trigger reads something only a match knows.
function firesAt(sc, t) {
  if (sc.neverTrue) return false;
  // No trigger1 is a load error in the engine (compiler.go:7012-7015):
  // nothing to go on.
  if (!sc.trig || !sc.trig.groups || !sc.trig.groups.length) return null;
  const set = { all: (sc.trig.all || []).map(atMatchWin), groups: sc.trig.groups.map((g) => g.map(atMatchWin)) };
  return X.evalTriggerSet(set, { time: t });
}

// The state's hand-over on tick t: { to } a state number or { computed } an
// expression, from the first controller that certainly fires; or
// { unknown } (the first controller that may or may not) when none does;
// or null when nothing can leave the state on that tick.
function handOver(st, t) {
  let unknown = null;
  for (const sc of st.sctrls) {
    if (sc.type !== 'changestate' && sc.type !== 'selfstate') continue;
    const f = firesAt(sc, t);
    if (f === false) continue;
    const raw = sc.params.get('value');
    if (f !== true || raw === undefined) { if (!unknown) unknown = sc; continue; }
    const v = X.evalExpr(atMatchWin(raw), { time: t });
    return typeof v === 'number' && Number.isInteger(v) ? { to: v } : { computed: String(raw).trim() };
  }
  return unknown ? { unknown } : null;
}

// -> { action, path, how } or { path, note } when the files do not say.
function engineWinAction(dir, defName) {
  let parsed;
  try {
    const files = scenelib.stateFiles(dir, defName, (rel) => modlib.resolveCI(dir, rel));
    parsed = scenelib.parseStates(files, {});
  } catch (e) { return { path: [], note: 'its state files could not be read (' + e.message + ')' }; }
  const states = parsed.states;
  if (!states.has(180)) return { path: [], note: 'no [Statedef 180] in its state files' };
  const trail = [180];
  let no = 180;
  for (let hop = 0; ; hop++) {
    const st = states.get(no);
    if (!st) return { action: no, path: trail, how: 'state ' + no + ' is not in its files; its number as the action' };
    if (st.zss) return no === 180 ? { path: trail, note: 'state 180 is ZSS' } : { action: no, path: trail, how: 'state ' + no + ' (ZSS) as the action' };
    let h = handOver(st, 0);
    if (!h || h.unknown) { const h1 = handOver(st, 1); if (h1 && !h1.unknown) h = h1; else if (!h) h = h1; }
    if (h && h.to !== undefined) {
      if (trail.includes(h.to)) return { path: trail.concat(h.to), note: 'the win states go round in a loop' };
      if (hop >= MAX_HOPS) return { path: trail.concat(h.to), note: 'more than ' + MAX_HOPS + ' states hand over at once' };
      no = h.to;
      trail.push(no);
      continue;
    }
    if (h && h.computed !== undefined) return { path: trail, note: 'state ' + no + ' moves at once to a computed state (' + h.computed + ')' };
    const anim = scenelib.lit(st.anim);
    if (anim !== null) return { action: anim, path: trail, how: 'anim = ' + anim + ' of state ' + no };
    if (no !== 180) return { action: no, path: trail, how: 'state ' + no + ' sets no literal anim; its number as the action' };
    return { path: trail, note: h && h.unknown
      ? 'state 180 has no anim of its own and no ChangeState that certainly fires on a match win (first: ' + describeTrig(h.unknown) + ')'
      : 'state 180 has no anim of its own and changes state only later' };
  }
}
function describeTrig(sc) {
  const parts = [...(sc.trig.all || []), ...(sc.trig.groups || []).map((g) => g.join(' && '))];
  const s = parts.join(' | ');
  return s.length > 60 ? s.slice(0, 57) + '...' : s;
}

// ---------------------------------------------------------------------------
// WHERE THE POSE SITS: the union of every run as it is drawn.
//
// The GIF's own framing (modlib animBox) leaves out frames far larger or
// smaller than the typical one, which is right for a panel you can pan and
// wrong here - a win pose that throws out one big flash would be clipped. So
// the box is every drawn run's bounds, placed by the composer's published rule
// (the panel's, on charAnim's frames): the drawn offset xDraw/yDraw, the flips
// and the frame's scale about the sprite's axis. A run is the element on
// screen wearing the sprite the engine last loaded (airEntries), as in the
// composer.
function runBounds(e, s) {
  if (!e || !s || !s.w || !s.h) return null;
  const sx = (e.flipH ? -1 : 1) * (e.xscale !== undefined ? e.xscale : 1);
  const sy = (e.flipV ? -1 : 1) * (e.yscale !== undefined ? e.yscale : 1);
  if (!sx || !sy || !Number.isFinite(sx) || !Number.isFinite(sy)) return null;
  const X0 = e.xDraw !== undefined ? e.xDraw : (e.x || 0);
  const Y0 = e.yDraw !== undefined ? e.yDraw : (e.y || 0);
  const xa = X0 - s.axisX * sx, xb = X0 + (s.w - s.axisX) * sx;
  const ya = Y0 - s.axisY * sy, yb = Y0 + (s.h - s.axisY) * sy;
  return { l: Math.min(xa, xb), r: Math.max(xa, xb), t: Math.min(ya, yb), b: Math.max(ya, yb) };
}
function unionBox(anim) {
  const ent = airEntries(anim.frames.map((f) => f.time), anim.loopStart).full;
  let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
  for (const run of ent.runs) {
    if (run.spr < 0) continue;
    const p = runBounds(anim.frames[run.elem], anim.frames[run.spr]);
    if (!p) continue;
    l = Math.min(l, Math.floor(p.l)); t = Math.min(t, Math.floor(p.t));
    r = Math.max(r, Math.ceil(p.r)); b = Math.max(b, Math.ceil(p.b));
  }
  if (!Number.isFinite(l)) return null;
  return { l, t, w: Math.max(1, r - l), h: Math.max(1, b - t) };
}

// The action composed for the board, or { error } saying why it cannot be.
function composeWin(mountAs, action, pal) {
  let anim = null;
  try { anim = modlib.charAnim(mountAs, action); } catch (e) { anim = null; }
  if (!anim || !anim.frames || !anim.frames.length) return { error: 'it has no action ' + action };
  const box = unionBox(anim);
  if (!box) return { error: 'action ' + action + ' draws no sprite this character has' };
  const R = modlib.charAnimRuns(mountAs, action, { pal, board: true, holdMs: BOARD_HOLD_MS, l: box.l, t: box.t, w: box.w, h: box.h });
  if (R.error) return { error: 'action ' + action + ': ' + R.error };
  if (!R.runs.some((r) => r.kind !== 'blank')) return { error: 'none of the frames of action ' + action + ' could be decoded' };
  return { R, box: R.box };
}

// ---------------------------------------------------------------------------
// ONE FRAME AS A FILE, cropped to what it draws.
//
// An opaque frame stays an indexed PNG in the sprite's own palette, with each
// entry's alpha in its tRNS - an SFF v2.01 palette's see-through colors
// (Dr.Kira's body) keep their alpha, as the engine draws them. A frame with a
// blend, or truecolor art, is the composer's `board` picture: straight-alpha
// RGBA with the blend baked in for a dark page (an additive glow becomes the
// light it adds, a translucent frame its coverage, a subtractive one nothing -
// it only darkens). A frame that draws nothing is a 1x1 transparent picture,
// kept so the pose keeps the engine's timing.
// -> { png, x, y, w, h } with x/y inside the pose's box.
function framePicture(run) {
  const W = run.w, H = run.h;
  if (run.kind === 'indexed' && !run.blend) {
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const v = run.px[y * W + x];
        if (!v || !run.alpha[v]) continue;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
    if (x1 >= 0) {
      const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
      const px = Buffer.alloc(cw * ch);
      for (let y = 0; y < ch; y++) run.px.copy(px, y * cw, (y0 + y) * W + x0, (y0 + y) * W + x0 + cw);
      // Index 0 is "nothing here" on the composer's canvas, whatever the
      // palette stores for it.
      const alpha = Uint8Array.from(run.alpha);
      alpha[0] = 0;
      return { png: sffDecode.encodeIndexedPng(px, cw, ch, run.pal, alpha), x: x0, y: y0, w: cw, h: ch };
    }
  } else if (run.board) {
    const src = run.board;
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (!src[(y * W + x) * 4 + 3]) continue;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
    if (x1 >= 0) {
      const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
      const rgba = Buffer.alloc(cw * ch * 4);
      for (let y = 0; y < ch; y++) src.copy(rgba, y * cw * 4, ((y0 + y) * W + x0) * 4, ((y0 + y) * W + x0 + cw) * 4);
      return { png: sffDecode.encodeRgbaPng(rgba, cw, ch), x: x0, y: y0, w: cw, h: ch };
    }
  }
  return { png: sffDecode.encodeRgbaPng(Buffer.alloc(4), 1, 1), x: 0, y: 0, w: 1, h: 1 };
}

// ---------------------------------------------------------------------------

// One roster entry -> its files under outRoot/<key>/ and its row:
//   { name, mountAs, displayname, defname, portrait, win, winFrom, winPath,
//     winHow, pal, notes, skipped }
// winFrom is 'roster' (the entry's winAction), 'statedef' (the engine's win
// path) or 'fallback' (the conventional list).
function extractChar(entry, key, outRoot) {
  const mountAs = String(entry.mountAs);
  const row = { name: key, mountAs, notes: [], portrait: null, win: null, skipped: null };
  const src = modlib.charSource(mountAs);
  if (!fs.existsSync(src.dir) || !fs.statSync(src.dir).isDirectory()) { row.skipped = 'its folder is not on disk'; return row; }
  const defName = (src.entryDef && fs.existsSync(path.join(src.dir, src.entryDef))) ? src.entryDef : modlib.findMainDef(src.dir);
  if (!defName) { row.skipped = 'no .def in its folder'; return row; }
  let def = null;
  try { def = sffDecode.parseDef(path.join(src.dir, defName)); } catch (e) { def = null; }
  if (!def) { row.skipped = 'its .def could not be read'; return row; }
  row.displayname = def.displayname || key;
  row.defname = def.name || '';

  // COLORS: the entry's defaultPal (set from the animation panel), any slot
  // kind the Studio lists - an .act, the file's own v2 palettes, a Studio
  // custom color. None set, or one it no longer has: the default colors, as
  // the sprite route draws them with nothing picked.
  let pal;
  if (entry.defaultPal !== undefined && entry.defaultPal !== null) {
    const n = Number(entry.defaultPal);
    let info = null;
    try { info = modlib.charPalettes(mountAs); } catch (e) { info = null; }
    if (Number.isInteger(n) && info && info.palettes.some((p) => p.slot === n)) pal = n;
    else row.notes.push('defaultPal ' + JSON.stringify(entry.defaultPal) + ' is not one of its palettes: default colors');
  }
  row.pal = pal === undefined ? null : pal;

  const outDir = path.join(outRoot, key);
  fs.mkdirSync(outDir, { recursive: true });

  // The file's own 9000,1 - raw, not a portrait fitted to a screenpack - in the
  // chosen colors where that sprite wears the costume palette.
  const portrait = modlib.spritePngFor(mountAs, PORTRAIT[0], PORTRAIT[1], pal, true);
  if (portrait) {
    fs.writeFileSync(path.join(outDir, 'portrait.png'), portrait);
    row.portrait = key + '/portrait.png';
  } else row.notes.push('no portrait: it has no sprite ' + PORTRAIT.join(','));

  // WHICH ACTION: the entry's winAction, else the engine's win path, else the
  // conventional list - each only if it draws something.
  let got = null;
  if (entry.winAction !== undefined && entry.winAction !== null) {
    const n = Number(entry.winAction);
    const c = Number.isInteger(n) ? composeWin(mountAs, n, pal) : { error: 'it is not a whole number' };
    if (!c.error) { got = c; row.win = { action: n }; row.winFrom = 'roster'; }
    else row.notes.push('winAction ' + JSON.stringify(entry.winAction) + ' not used: ' + c.error);
  }
  if (!got) {
    const w = engineWinAction(src.dir, defName);
    row.winPath = w.path;
    if (w.action !== undefined) {
      const c = composeWin(mountAs, w.action, pal);
      if (!c.error) { got = c; row.win = { action: w.action }; row.winFrom = 'statedef'; row.winHow = w.how; }
      else row.notes.push('the win path (' + w.path.join(' > ') + ') gives action ' + w.action + ', not used: ' + c.error);
    } else row.notes.push('win path: ' + w.note);
  }
  if (!got) {
    for (const a of WIN_ACTIONS) {
      const c = composeWin(mountAs, a, pal);
      if (!c.error) { got = c; row.win = { action: a }; row.winFrom = 'fallback'; break; }
    }
  }
  if (!got) {
    row.win = null;
    row.notes.push('no win art: none of ' + WIN_ACTIONS.join('/') + ' draws anything');
  } else {
    const { R, box } = got;
    const action = row.win.action;
    // THE FRAMES AND THEIR TIMES ARE THE GIF'S (charAnimRuns.frames): the
    // engine's runs, a run under 2cs shown together with the next, identical
    // neighbors joined, each delay taken from a running total of the ticks -
    // so the pose lasts as long as the engine plays it, to the centisecond. A
    // held last run gets the board's 900 ms beat before the pose starts over.
    let list = R.frames;
    if (list.length > MAX_FRAMES) {
      row.notes.push('cut at ' + MAX_FRAMES + ' of ' + list.length + ' frames');
      list = list.slice(0, MAX_FRAMES);
    }
    const frames = [];
    list.forEach((f, i) => {
      const pic = framePicture(R.runs[f.run]);
      const file = 'win-' + String(i).padStart(2, '0') + '.png';
      fs.writeFileSync(path.join(outDir, file), pic.png);
      frames.push({ src: key + '/' + file, ms: f.cs * 10, x: pic.x, y: pic.y, w: pic.w, h: pic.h });
    });
    row.win = { action, w: box.w, h: box.h, frames };
    for (const n of R.notes) row.notes.push(n);

    // ALSO the animation as one looping GIF, for everywhere that cannot run
    // JavaScript to play the frames: a Discord embed, a forum post, a link
    // preview. The composer's GIF of the same action, colors and box, on a
    // transparent background. The PNG frames stay authoritative. Written once
    // here, at export - nothing renders per request later.
    try {
      const g = modlib.charAnimGif(mountAs, action, { pal, holdMs: BOARD_HOLD_MS, l: box.l, t: box.t, w: box.w, h: box.h });
      if (g && g.buf) {
        fs.writeFileSync(path.join(outDir, 'win.gif'), g.buf);
        row.win.gif = key + '/win.gif';
      } else row.notes.push('no win.gif: ' + ((g && g.error) || 'nothing written'));
    } catch (e) {
      // A character without a GIF still has its PNG frames, so this must
      // never be able to fail an export.
      row.notes.push('no win.gif: ' + e.message);
    }
  }
  if (!row.portrait && !row.win) row.skipped = row.notes.join('; ') || 'no art';
  return row;
}

// The characters of the build, each with the name its art is filed under:
// the folder, as before (the board matches it, and the defname and
// displayname, against what a ranked report carries); a second version of a
// character out of the same folder goes under its own mount name, which the
// Studio keeps distinct from every folder name (addCharVariant).
function rosterCharacters(roster) {
  const out = [];
  const taken = new Set();
  for (const c of (roster && roster.chars) || []) {
    if (!c || c.kind || !c.folder || !c.mountAs) continue;
    let key = String(taken.has(String(c.folder).toLowerCase()) ? c.mountAs : c.folder).replace(/[\\/:*?"<>|]/g, '_');
    if (key === '.' || key === '..' || !key) key = '_' + key;
    const base = key;
    for (let n = 2; taken.has(key.toLowerCase()); n++) key = base + '_' + n;
    taken.add(key.toLowerCase());
    out.push({ entry: c, key });
  }
  return out;
}

// Callable in-process (export.js runs it on every private export) as well as
// from the CLI, so the Mod Studio's Export button generates art too - it calls
// exportSite() directly and never touches this file's command line.
// The CLI's default is the active bundle's own folder; an in-process caller
// must name one (export.js makeBoardArt names the same folder).
const DEFAULT_OUT = layout.LEADERBOARD_ART;

function main(outDir, quiet) {
  // Only consult argv when nothing was passed AND we are the CLI entry point.
  // Reading it unconditionally meant an in-process call from export.js picked
  // up export's OWN flags and wrote the art to a directory called "--pack".
  const cli = require.main === module;
  const fromArgv = cli ? process.argv[2] : null;
  if (!outDir && !cli) throw new Error('extractAll needs the folder to write - it never guesses one');
  const outRoot = path.resolve(outDir || fromArgv || DEFAULT_OUT);
  // NEVER ANOTHER BUNDLE'S ART. The manifest below is rebuilt from the ACTIVE
  // bundle's roster, so writing into the checkout Main's folder (the private
  // site's) or leaderboard-art/ of any other bundle would leave that board
  // knowing only this bundle's characters - a test's one-character bundle did
  // exactly that to the site's art once. Refused before a file is written.
  if (layout.isOtherBundleArt(outRoot)) {
    throw new Error('refusing to write ' + outRoot + ': it is another bundle\'s leaderboard art, and this one ('
      + layout.ACTIVE_BUNDLE.name + ') would replace its manifest');
  }
  // No roster, no build: refuse BEFORE writing anything, rather than replace a
  // good manifest with an empty one (export.js reports the failure and ships
  // the site with the art it had).
  const roster = JSON.parse(fs.readFileSync(layout.dir('roster.json'), 'utf8'));
  // Every picture comes from the GIF composer, which needs tools/gif.js. A
  // copy without it would otherwise write a manifest with no win art at all
  // over the one the site has; refusing keeps the old art in place.
  // The ENCODER, not canExportGif(): that is the GIF button's switch, which a
  // copy made with --no-gif turns off while it keeps the encoder for this.
  if (!modlib.boardArtTool()) throw new Error('leaderboard art needs tools/gif.js, which this copy does not have');
  fs.mkdirSync(outRoot, { recursive: true });
  // A per-extraction stamp the page appends to every art URL. Without it a
  // re-extraction is invisible to anyone holding the old images in cache -
  // a corrected portrait would keep rendering as the old broken one.
  const manifest = { generated: new Date().toISOString(), stamp: Date.now().toString(36), chars: {} };

  const rows = [];
  for (const { entry, key } of rosterCharacters(roster)) {
    let r;
    try {
      r = extractChar(entry, key, outRoot);
    } catch (e) {
      r = { name: key, mountAs: entry.mountAs, notes: [], skipped: 'error: ' + e.message };
    }
    rows.push(r);
    if (r.portrait || r.win) {
      manifest.chars[r.name] = {
        displayname: r.displayname,
        // The def's [Info] name, exactly as the engine's name() reports it -
        // this is what ranked reports carry, and it often differs from the
        // displayname (kula: name "Kula Diamond", displayname "CCI Kula").
        // The board matches on folder, defname AND displayname so any of
        // them lands the portrait.
        defname: r.defname,
        portrait: r.portrait,
        win: r.win,
      };
    }
  }
  fs.writeFileSync(path.join(outRoot, 'manifest.json'), JSON.stringify(manifest, null, 1));
  if (!quiet) {
    const pad = (s, n) => String(s).padEnd(n);
    console.log(pad('char', 26) + pad('portrait', 10) + pad('win', 28) + 'notes');
    for (const r of rows) {
      const win = r.win ? r.win.frames.length + ' fr, act ' + r.win.action + ' (' + r.winFrom + ')' : '-';
      console.log(pad(r.name, 26) + pad(r.portrait ? 'yes' : '-', 10) + pad(win, 28) + (r.skipped || (r.notes || []).join('; ')));
    }
    console.log('\nWrote ' + Object.keys(manifest.chars).length + ' characters to ' + outRoot);
  }
  return { chars: Object.keys(manifest.chars).length, out: outRoot, rows };
}

if (require.main === module) main();
module.exports = { extractAll: main, extractChar, engineWinAction, rosterCharacters, unionBox, WIN_ACTIONS };
