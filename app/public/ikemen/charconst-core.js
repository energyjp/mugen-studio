// charconst-core.js - reading and patching a character's .cns constants.
//
// ONE implementation, shared by the browser Mod Studio (studio-lite.html) and
// the desktop one (modlib.js), the same way sffpal-core / sffdec-core / motif-core
// are shared. It exists because the two drifted: size scaling was copied into
// modlib.js by hand and then health and movement speed were added to Lite only,
// so the DESKTOP kit - the more capable tool - ended up able to resize a
// character but not change its health. A second copy is how that happens; there
// is now one.
//
// Everything here is pure text in, text out. No file IO, no DOM, no engine
// calls, so both hosts and a test can use it unchanged.
//
// THE RULES THESE FUNCTIONS ENCODE, all of them learned from the engine:
//
//   * A .cns is an ini file and the engine is FIRST-WINS on a duplicate key or
//     section. So a value must be patched IN PLACE, and a missing key inserted
//     under its own section header - never appended at the end of the file,
//     where a second [Data] would simply be ignored.
//   * Velocities are vectors written as text ("4.6, 0"). Scaling must preserve
//     the shape and the component count; a vector whose parts are not all
//     numeric is refused rather than guessed at.
//   * Every edit is applied to the ORIGINAL value, captured once by the caller,
//     so repeated changes never compound and 1x restores exactly.
//   * Size is patched as [Size] xscale/yscale, which scales sprites AND
//     hitboxes together - so a resized character stays fair.
//   * A LINE'S OWN ENDING IS PART OF THE FILE. These patchers work on lines
//     rather than byte spans, which is the older shape kept here on purpose -
//     but splitting on /\r?\n/ and joining with "\n" rewrites EVERY line
//     ending in a CRLF file the first time one value is set. Kung Fu Man's
//     .cns is CRLF and 3470 lines long, so setting its health rewrote 3469
//     lines that nobody asked to touch, and any diff of the character became
//     useless. Each line now carries its own terminator back out, and only a
//     line that is inserted takes the file's dominant one.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.charconstCore = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // ---- the reader's language ------------------------------------------------
  //
  // Only sizeNote's sentence is shown to anyone; everything else here is file
  // text. In a Studio window it goes through I18n.t (the language the reader
  // picked); in Node, the web game and studio-lite there is no i18n.js and t()
  // fills in the English itself, word for word what it always was.
  function t(en, vars) {
    var I = typeof I18n !== 'undefined' ? I18n : null;
    if (I && typeof I.t === 'function') return I.t(en, vars);
    return String(en).replace(/\{([A-Za-z_$][\w$]*)\}/g, function (m, k) {
      return vars && Object.prototype.hasOwnProperty.call(vars, k) && vars[k] != null ? String(vars[k]) : m;
    });
  }

  // The velocity keys the Studios expose. Deliberately not every [Velocity]
  // key: these four are the ones that read as "how fast does this character
  // move" to a player.
  var SPEED_KEYS = ['walk.fwd', 'walk.back', 'run.fwd', 'run.back'];

  // ---- lines that remember how they ended ----------------------------------
  //
  // splitLines gives the same array `text.split(/\r?\n/)` gave, plus the
  // terminator each line actually had, so joinLines puts the file back byte
  // for byte when nothing was edited. `eol` is the file's own ending, used
  // for a line these patchers ADD - a file with no newline at all takes "\n".
  function splitLines(text) {
    var s = String(text);
    var lines = [], eols = [];
    var i = 0;
    for (;;) {
      var nl = s.indexOf('\n', i);
      if (nl < 0) { lines.push(s.slice(i)); eols.push(''); break; }
      var end = nl;
      if (end > i && s.charAt(end - 1) === '\r') end--;
      lines.push(s.slice(i, end));
      eols.push(s.slice(end, nl + 1));
      i = nl + 1;
    }
    var crlf = 0, lf = 0;
    for (var k = 0; k < eols.length; k++) {
      if (eols[k] === '\r\n') crlf++;
      else if (eols[k] === '\n') lf++;
    }
    return { lines: lines, eols: eols, eol: crlf >= lf && crlf > 0 ? '\r\n' : '\n' };
  }

  function joinLines(L) {
    var out = '';
    for (var i = 0; i < L.lines.length; i++) out += L.lines[i] + L.eols[i];
    return out;
  }

  // Insert whole lines before index `at`, each ending the way the file does.
  function insertLines(L, at, add) {
    for (var i = 0; i < add.length; i++) {
      L.lines.splice(at + i, 0, add[i]);
      L.eols.splice(at + i, 0, L.eol);
    }
  }

  // Append at the end. The file's last line gains a terminator if it had
  // none, and the new last line keeps the "no trailing newline" shape the
  // join('\n') this replaced produced.
  function appendLines(L, add) {
    if (!add.length) return;
    var last = L.lines.length - 1;
    if (last >= 0 && L.eols[last] === '') L.eols[last] = L.eol;
    for (var i = 0; i < add.length; i++) { L.lines.push(add[i]); L.eols.push(L.eol); }
    L.eols[L.eols.length - 1] = '';
  }

  function readCharConsts(text) {
    var out = { life: null, speed: {} };
    var sec = '';
    var lines = String(text).split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) {
      var t = lines[i].replace(/;.*$/, '');
      var h = /^\s*\[([^\]]+)\]/.exec(t);
      if (h) { sec = h[1].toLowerCase(); continue; }
      if (sec === 'data') {
        var m = /^\s*life\s*=\s*(-?[0-9]+)/i.exec(t);
        if (m && out.life === null) out.life = parseInt(m[1], 10);
      } else if (sec === 'velocity') {
        for (var k = 0; k < SPEED_KEYS.length; k++) {
          var key = SPEED_KEYS[k];
          var re = new RegExp('^\\s*' + key.replace('.', '\\.') + '\\s*=\\s*(.+)$', 'i');
          var mm = re.exec(t);
          if (mm && out.speed[key] === undefined) out.speed[key] = mm[1].trim();
        }
      }
    }
    return out;
  }

  // "4.6, 0" -> "5.06, 0". Returns null when any component is non-numeric, so a
  // caller can skip that key instead of writing something the engine will read
  // as 0 (its Atoi stops at the first non-digit and does not complain).
  //
  // EACH COMPONENT KEEPS ITS OWN SPACING, so a 1x pass gives the same bytes
  // back. kfm.cns writes `run.back = -4.5,-3.8` with no space after the comma
  // and `run.fwd  = 4.6, 0` with one; normalizing both to ", " meant putting a
  // character back to the speed it shipped with still changed its file.
  function scaleVel(v, mult) {
    var raw = String(v).split(',');
    var parts = raw.map(function (p) { return p.trim(); });
    for (var i = 0; i < parts.length; i++) {
      if (!/^-?[0-9]*\.?[0-9]+$/.test(parts[i])) return null;
    }
    return raw.map(function (p, i) {
      return /^\s*/.exec(p)[0] + String(+(parseFloat(parts[i]) * mult).toFixed(4)) + /\s*$/.exec(p)[0];
    }).join(',');
  }

  function patchCharConsts(text, life, speed) {
    var L = splitLines(text);
    var lines = L.lines;
    var sec = '', dataIdx = -1, velIdx = -1;
    var doneSpeed = {};
    var doneLife = false;
    for (var i = 0; i < lines.length; i++) {
      var h = /^\s*\[([^\]]+)\]/.exec(lines[i].replace(/;.*$/, ''));
      if (h) {
        sec = h[1].toLowerCase();
        if (sec === 'data' && dataIdx < 0) dataIdx = i;
        if (sec === 'velocity' && velIdx < 0) velIdx = i;
        continue;
      }
      if (sec === 'data' && life !== null && life !== undefined && !doneLife
          && /^\s*life\s*=/i.test(lines[i])) {
        lines[i] = lines[i].replace(/^(\s*life\s*=\s*)-?[0-9]+/i, '$1' + life);
        doneLife = true;
      } else if (sec === 'velocity' && speed) {
        for (var k = 0; k < SPEED_KEYS.length; k++) {
          var key = SPEED_KEYS[k];
          if (doneSpeed[key] || speed[key] === undefined) continue;
          // THE AUTHOR'S NOTE IS NOT PART OF THE VALUE. The engine's ini
          // reader cuts the line at its first `;` (common.go:1007), and
          // kfm.cns writes `walk.fwd  = 2.4      ;Walk forward` - so a
          // pattern ending in `.+$` swallowed the comment along with the
          // number. Only the value runs, and the gap before the note, are
          // rewritten.
          var re = new RegExp('^(\\s*' + key.replace('.', '\\.') + '\\s*=\\s*)([^;]*?)(\\s*)(;.*)?$', 'i');
          if (re.test(lines[i])) {
            lines[i] = lines[i].replace(re, function (all, head, val, gap, note) {
              return head + speed[key] + gap + (note || '');
            });
            doneSpeed[key] = true;
          }
        }
      }
    }
    // Insert under the section header, never at the end of the file.
    if (life !== null && life !== undefined && !doneLife && dataIdx >= 0) {
      insertLines(L, dataIdx + 1, ['life = ' + life]);
    }
    return joinLines(L);
  }

  function readSizeScale(text) {
    var out = { x: 1, y: 1 }, inSize = false;
    var lines = String(text).split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (/^\s*\[size\]/i.test(line)) { inSize = true; continue; }
      if (inSize && /^\s*\[/.test(line)) break;
      if (!inSize) continue;
      var m = /^\s*xscale\s*=\s*([0-9.]+)/i.exec(line); if (m) out.x = parseFloat(m[1]);
      m = /^\s*yscale\s*=\s*([0-9.]+)/i.exec(line); if (m) out.y = parseFloat(m[1]);
    }
    return out;
  }

  function patchSizeScale(text, nx, ny) {
    var L = splitLines(text);
    var lines = L.lines;
    var inSize = false, doneX = false, doneY = false, sizeIdx = -1;
    for (var i = 0; i < lines.length; i++) {
      if (/^\s*\[size\]/i.test(lines[i])) { inSize = true; sizeIdx = i; continue; }
      if (inSize && /^\s*\[/.test(lines[i])) inSize = false;
      if (!inSize) continue;
      if (/^\s*xscale\s*=/i.test(lines[i])) {
        lines[i] = lines[i].replace(/^(\s*xscale\s*=\s*)[0-9.]+/i, '$1' + nx); doneX = true;
      }
      if (/^\s*yscale\s*=/i.test(lines[i])) {
        lines[i] = lines[i].replace(/^(\s*yscale\s*=\s*)[0-9.]+/i, '$1' + ny); doneY = true;
      }
    }
    if (sizeIdx >= 0) {
      var ins = [];
      if (!doneX) ins.push('xscale = ' + nx);
      if (!doneY) ins.push('yscale = ' + ny);
      if (ins.length) insertLines(L, sizeIdx + 1, ins);
    } else {
      appendLines(L, ['', '[Size]', 'xscale = ' + nx, 'yscale = ' + ny]);
    }
    return joinLines(L);
  }

  // The whole edit in one call, from the ORIGINAL text and the ORIGINAL values.
  // Health is ABSOLUTE (players think "give them 1500"); speed and size are
  // MULTIPLIERS, because they are vectors and scaling keeps the authored feel.
  // Callers pass base = readCharConsts(original), baseScale = readSizeScale(original).
  function applyEdits(originalText, base, opts) {
    var o = opts || {};
    var text = String(originalText);
    var life = (o.life === null || o.life === undefined || o.life === '')
      ? (base && base.life !== undefined ? base.life : null)
      : Math.max(1, Math.min(30000, parseInt(o.life, 10) || (base && base.life) || 1000));
    var sm = Math.min(2, Math.max(0.5, Number(o.speed) || 1));
    var speed = {};
    if (base && base.speed) {
      for (var k = 0; k < SPEED_KEYS.length; k++) {
        var key = SPEED_KEYS[k];
        if (base.speed[key] === undefined) continue;
        var v = scaleVel(base.speed[key], sm);
        if (v !== null) speed[key] = v;
      }
    }
    text = patchCharConsts(text, life, speed);
    if (o.scale !== undefined && o.scale !== null) {
      var cm = Math.min(1.25, Math.max(0.75, Number(o.scale) || 1));
      var bs = o.baseScale || { x: 1, y: 1 };
      text = patchSizeScale(text, +(bs.x * cm).toFixed(4), +(bs.y * cm).toFixed(4));
    }
    return { text: text, life: life, speed: sm };
  }

  // How big a character is, as a download. Lives here because BOTH Studios
  // already load this module and the thresholds are a product decision that
  // must not drift between them - the previous split netplayLevel/netplayVerdict
  // pair is exactly how the two ended up disagreeing.
  //
  // SIZE ONLY. The old rule also weighed H-content and module count and called
  // itself a NETPLAY verdict, which was wrong on both counts: NETPLAY.md:242
  // records that it 'does NOT predict rollback risk' and that four of the five
  // characters it called heavy are low risk. It also made sakura - a stock 27 MB
  // character - read HEAVY purely because it ships H content.
  //
  // What size DOES predict is load time, which is felt hardest online: both
  // players wait for the slower one to finish loading before the match starts.
  // Bands measured against a real 24-character roster (median 23.2 MB).
  function sizeBand(mb) {
    var n = Number(mb);
    if (!isFinite(n) || n <= 0) return null;   // unknown size: no color, not a lie
    if (n <= 25) return 'ok';
    if (n < 50) return 'medium';
    return 'heavy';
  }
  function sizeNote(mb) {
    var band = sizeBand(mb);
    if (!band) return '';
    var size = { mb: Number(mb).toFixed(1) };
    if (band === 'ok') return t('{mb} MB - small download, loads quickly.', size);
    if (band === 'medium') return t('{mb} MB - medium download. Online, both players wait for the slower one to finish loading.', size);
    return t('{mb} MB - large download. Expect a noticeable wait the first time, and online both players wait for the slower one. It does not cause lag once the match starts.', size);
  }

  return {
    SPEED_KEYS: SPEED_KEYS,
    sizeBand: sizeBand,
    sizeNote: sizeNote,
    readCharConsts: readCharConsts,
    patchCharConsts: patchCharConsts,
    scaleVel: scaleVel,
    readSizeScale: readSizeScale,
    patchSizeScale: patchSizeScale,
    applyEdits: applyEdits,
  };
}));
