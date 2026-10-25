// audio-core.js - how long is this audio file, from its header alone.
//
// Shared by the browser Mod Studio and the desktop one, like motif-core /
// sffdec-core / sffpal-core / charconst-core. One implementation deliberately:
// the browser could ask an <audio> element instead, but then the two Studios
// would answer differently on the same file, and that is precisely the drift
// that put health editing in one Studio and not the other.
//
// WHY THIS EXISTS. Importing a character or stage archive now pulls its audio
// into the music library. Archives carry SOUND EFFECTS as well as music -
// Kung-Fu-Man.zip ships a 0.46-second `slap.wav` - and those are not songs.
// A short clip assigned as a stage's BGM loops every half second, which is
// unusable, so bundled audio under a few seconds is skipped.
//
// PRECISION DOES NOT MATTER HERE. The only question asked is "is this under
// ~4 seconds", and the gap between a sound effect and a song is three orders of
// magnitude. So a CBR estimate is fine for MP3 and there is no frame walking.
// What DOES matter is never being confidently wrong: anything unparseable
// returns null, and callers must treat null as "keep it", never as "drop it".
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.audioCore = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function u32le(b, i) { return b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24); }
  function u16le(b, i) { return b[i] | (b[i + 1] << 8); }
  function u32be(b, i) { return (b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]; }
  function ascii(b, i, n) {
    var s = '';
    for (var k = 0; k < n; k++) s += String.fromCharCode(b[i + k]);
    return s;
  }

  // RIFF/WAVE: walk chunks for fmt and data. Exact, and the format most likely
  // to BE a sound effect, so it is worth getting right rather than estimating.
  function wavSeconds(b) {
    if (b.length < 44 || ascii(b, 0, 4) !== 'RIFF' || ascii(b, 8, 4) !== 'WAVE') return null;
    var off = 12, rate = 0, ch = 0, bits = 0, dataLen = -1;
    while (off + 8 <= b.length) {
      var id = ascii(b, off, 4), sz = u32le(b, off + 4) >>> 0;
      if (id === 'fmt ') {
        ch = u16le(b, off + 10); rate = u32le(b, off + 12) >>> 0; bits = u16le(b, off + 22);
      } else if (id === 'data') { dataLen = sz; break; }
      off += 8 + sz + (sz & 1);                 // chunks are word-aligned
    }
    if (!rate || !ch || !bits || dataLen < 0) return null;
    return dataLen / (rate * ch * (bits / 8));
  }

  // Ogg: the LAST page's granule position is the final sample index, and the
  // sample rate lives in the identification header on the first page. Works for
  // Vorbis and Opus alike, except Opus fixes its granule clock at 48 kHz.
  function oggSeconds(b) {
    if (b.length < 58 || ascii(b, 0, 4) !== 'OggS') return null;
    var rate = 0;
    var head = Math.min(b.length - 8, 4096);
    for (var i = 0; i < head; i++) {
      if (ascii(b, i, 6) === 'vorbis') { rate = u32le(b, i + 11) >>> 0; break; }
      if (ascii(b, i, 8) === 'OpusHead') { rate = 48000; break; }   // granule is always 48k
    }
    if (!rate) return null;
    // Scan backwards for the last page header rather than parsing every page.
    for (var p = b.length - 14; p >= 0; p--) {
      if (b[p] === 0x4F && b[p + 1] === 0x67 && b[p + 2] === 0x67 && b[p + 3] === 0x53) {
        // 64-bit granule at +6, little-endian. Read as two 32-bit halves: a
        // full 64-bit value would exceed Number's exact range, but no realistic
        // audio file gets near 2^53 samples.
        var lo = u32le(b, p + 6) >>> 0, hi = u32le(b, p + 10) >>> 0;
        var granule = hi * 4294967296 + lo;
        if (granule > 0) return granule / rate;
      }
    }
    return null;
  }

  var MPEG_BITRATE_V1L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
  var MPEG_BITRATE_V2L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0];
  var MPEG_RATE_V1 = [44100, 48000, 32000];

  // MP3: use the Xing/Info frame count when the encoder left one (that is the
  // only accurate route for VBR), otherwise estimate from the first frame's
  // bitrate. The estimate is wrong for VBR files without a header, but only by
  // a fraction - never by the three orders of magnitude that separate a sound
  // effect from a song, which is the only distinction being drawn.
  function mp3Seconds(b) {
    var i = 0;
    if (b.length > 10 && ascii(b, 0, 3) === 'ID3') {
      // Syncsafe 28-bit size, 7 bits per byte.
      i = 10 + (((b[6] & 0x7f) << 21) | ((b[7] & 0x7f) << 14) | ((b[8] & 0x7f) << 7) | (b[9] & 0x7f));
    }
    var limit = Math.min(b.length - 4, i + 200000);
    for (; i < limit; i++) {
      if (b[i] !== 0xff || (b[i + 1] & 0xe0) !== 0xe0) continue;
      var verBits = (b[i + 1] >> 3) & 3;          // 3 = MPEG1, 2 = MPEG2, 0 = MPEG2.5
      var layer = (b[i + 2] >> 1) & 0;            // placeholder, layer read below
      layer = (b[i + 1] >> 1) & 3;
      if (verBits === 1 || layer === 0) continue; // reserved
      var brIdx = (b[i + 2] >> 4) & 0xf, srIdx = (b[i + 2] >> 2) & 3;
      if (brIdx === 0 || brIdx === 15 || srIdx === 3) continue;
      var isV1 = verBits === 3;
      var kbps = (isV1 ? MPEG_BITRATE_V1L3 : MPEG_BITRATE_V2L3)[brIdx];
      var rate = MPEG_RATE_V1[srIdx] / (isV1 ? 1 : (verBits === 2 ? 2 : 4));
      if (!kbps || !rate) continue;
      var samplesPerFrame = isV1 ? 1152 : 576;
      // Xing/Info sits inside this first frame, after the side info.
      var xi = i + 4 + (isV1 ? 32 : 17);
      for (var k = xi - 4; k < xi + 24 && k + 8 < b.length; k++) {
        var tag = ascii(b, k, 4);
        if (tag === 'Xing' || tag === 'Info') {
          var flags = u32be(b, k + 4);
          if (flags & 1) {
            var frames = u32be(b, k + 8) >>> 0;
            if (frames > 0) return (frames * samplesPerFrame) / rate;
          }
        }
      }
      return ((b.length - i) * 8) / (kbps * 1000);   // CBR estimate
    }
    return null;
  }

  // Seconds, or null when the format is unknown or the header will not parse.
  // NULL MEANS "DO NOT KNOW", never "zero" - a caller that treats it as short
  // would silently discard files it simply failed to read.
  function probeDuration(bytes, name) {
    if (!bytes || !bytes.length) return null;
    var b = bytes;
    try {
      if (ascii(b, 0, 4) === 'RIFF') return wavSeconds(b);
      if (ascii(b, 0, 4) === 'OggS') return oggSeconds(b);
      if (ascii(b, 0, 3) === 'ID3' || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return mp3Seconds(b);
      // Fall back on the extension for containers with no signature we read
      // (m4a/flac): unknown rather than guessed.
      if (/\.wav$/i.test(name || '')) return wavSeconds(b);
      if (/\.ogg$/i.test(name || '')) return oggSeconds(b);
      if (/\.mp3$/i.test(name || '')) return mp3Seconds(b);
    } catch (e) { /* malformed header: unknown, not short */ }
    return null;
  }

  // Bundled audio shorter than this is a sound effect, not a track. Four
  // seconds because any loop that short would be unbearable as stage BGM, and
  // it is far below anything anyone would ship deliberately.
  var MIN_BUNDLED_SECONDS = 4;

  // ONLY for audio that arrived UNINVITED, alongside a character or stage. A
  // file the user dropped in themselves always imports, however short - quietly
  // discarding a deliberate action is worse than an odd entry in a list.
  function isBundledSfx(bytes, name, minSec) {
    var secs = probeDuration(bytes, name);
    if (secs === null || !isFinite(secs) || secs <= 0) return false;   // unknown = keep
    return secs < (minSec === undefined ? MIN_BUNDLED_SECONDS : minSec);
  }

  function formatDuration(secs) {
    if (secs === null || secs === undefined || !isFinite(secs) || secs <= 0) return '';
    var s = Math.round(secs);
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  return {
    probeDuration: probeDuration,
    isBundledSfx: isBundledSfx,
    formatDuration: formatDuration,
    MIN_BUNDLED_SECONDS: MIN_BUNDLED_SECONDS,
  };
}));
