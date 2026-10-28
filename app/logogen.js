// MAKE A STARTUP LOGO OUT OF AN IMAGE.
//
// The engine's boot logo is a STORYBOARD: a .def describing fades and timing,
// plus a .sff holding the picture. Asking a user to supply one was the wrong
// shape for the feature: nobody has a storyboard .def on hand. Everybody has a
// PNG.
//
// So this writes both halves from a single image, reproducing exactly the pair
// that has been booting this project since July (release-v2/data/ikemen1/
// logo.def + logo.sff), which is the reference every number below was read off.
//
// WHY THE PNG IS EMBEDDED WHOLE, not re-encoded. stagethumb's png24 writes
// color type 2 - RGB with NO ALPHA - which is right for a stage banner and
// wrong for a logo, where transparency is the normal case. SFF v2 format 12 /
// coldepth 32 stores a PNG byte-for-byte and the engine hands it to png.Decode
// (image.go), so the user's own file travels intact: alpha, color profile,
// interlacing and all. Nothing is quantized, nothing is re-compressed.

const fs = require('fs');
const path = require('path');

// The screen the storyboard is authored against. 1280x720 matches the shipped
// logo.def's localcoord; the engine scales the whole scene from there, so this
// is a coordinate space rather than a pixel requirement.
const SCREEN_W = 1280;
const SCREEN_H = 720;

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// Width and height out of the IHDR. The image is NOT decoded - this only needs
// the dimensions to center and scale it, and refusing to decode is the whole
// reason an unusual-but-valid PNG survives the trip.
function readPngSize(buf) {
  if (buf.length < 33 || !buf.subarray(0, 8).equals(PNG_SIG)) {
    throw new Error('a startup logo image must be a .png');
  }
  if (buf.toString('latin1', 12, 16) !== 'IHDR') {
    throw new Error('that .png has no IHDR where one must be - the file looks damaged');
  }
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  if (!w || !h || w > 0xffff || h > 0xffff) {
    const size = w + 'x' + h;
    throw new Error('that image is ' + size + '; a logo must be between 1 and 65535 on each side');
  }
  return { w, h };
}

// SFF v2 holding exactly one sprite at 0,0.
//
// THE LAYOUT IS COPIED FROM A FILE THE ENGINE DEMONSTRABLY LOADS rather than
// derived from the spec, because the spec leaves room the engine does not:
//
//   0x00  "ElecbyteSpr\0"      0x0C  00 00 00 02   (version)
//   0x24  sprite table offset  = 144
//   0x28  sprite count         = 1
//   0x2C  palette table offset = 128
//   0x30  palette count        = 1
//   0x34  ldata offset         = 172   (= 144 + 28)
//   0x38  ldata length         0x3C  tdata offset (= file size, no tdata)
//
// A PALETTE IS WRITTEN EVEN THOUGH A 32-BIT SPRITE HAS NO USE FOR ONE. The
// reference file carries a 256-entry all-zero palette and its sprite's palIdx
// points at it; a sprite whose palIdx names a palette that does not exist is a
// dangling reference this code has no reason to risk. It costs 1 KB.
function buildLogoSff(pngBytes, w, h) {
  const PAL_OFS = 128, SPR_OFS = 144, LDATA = 172, PAL_LEN = 1024;

  const head = Buffer.alloc(LDATA);
  head.write('ElecbyteSpr\0', 0, 'latin1');
  head[12] = 0; head[13] = 0; head[14] = 0; head[15] = 2;

  // The payload's first four bytes are the PNG's LENGTH, not padding. The
  // reference file stores it (0x00065033 = 413747 for a 413751-byte payload)
  // and this mirrors that. stagethumb's appendPortraitV2 writes four zeros
  // there and its thumbnails do load, so the engine evidently tolerates both -
  // but "tolerated" and "what the working file does" are different bets.
  const payload = Buffer.alloc(4 + pngBytes.length);
  payload.writeUInt32LE(pngBytes.length, 0);
  pngBytes.copy(payload, 4);

  const llen = PAL_LEN + payload.length;
  head.writeUInt32LE(SPR_OFS, 0x24);
  head.writeUInt32LE(1, 0x28);
  head.writeUInt32LE(PAL_OFS, 0x2C);
  head.writeUInt32LE(1, 0x30);
  head.writeUInt32LE(LDATA, 0x34);
  head.writeUInt32LE(llen, 0x38);
  head.writeUInt32LE(LDATA + llen, 0x3C);

  // Palette node: group 1, number 1, 256 colors, its 1 KB at ldata offset 0.
  head.writeUInt16LE(1, PAL_OFS + 0);
  head.writeUInt16LE(1, PAL_OFS + 2);
  head.writeUInt16LE(256, PAL_OFS + 4);
  head.writeUInt16LE(0, PAL_OFS + 6);
  head.writeUInt32LE(0, PAL_OFS + 8);
  head.writeUInt32LE(PAL_LEN, PAL_OFS + 12);

  // Sprite node. THE AXIS IS THE IMAGE'S CENTER, which is what lets the .def
  // place it with `start = 0,360` - x is measured from the screen's center in a
  // storyboard BG, y from its top. Get the axis wrong and the logo sits with its
  // top-left corner in the middle of the screen.
  const n = SPR_OFS;
  head.writeUInt16LE(0, n + 0);                 // group
  head.writeUInt16LE(0, n + 2);                 // number
  head.writeUInt16LE(w, n + 4);
  head.writeUInt16LE(h, n + 6);
  head.writeInt16LE(Math.round(w / 2), n + 8);  // axis X
  head.writeInt16LE(Math.round(h / 2), n + 10); // axis Y
  head.writeUInt16LE(0, n + 12);                // not a link
  head[n + 14] = 12;                            // fmt 12 = PNG32
  head[n + 15] = 32;                            // coldepth
  head.writeUInt32LE(PAL_LEN, n + 16);          // ldata-relative: past the palette
  head.writeUInt32LE(payload.length, n + 20);
  head.writeUInt16LE(0, n + 24);                // palIdx
  head.writeUInt16LE(0, n + 26);                // flags

  return Buffer.concat([head, Buffer.alloc(PAL_LEN), payload]);
}

// SHRINK TO FIT, NEVER ENLARGE.
//
// The reference logo is 1672x941 and ships at 0.7651, which is
// min(1280/1672, 720/941) to four places - i.e. fitted to the screen. Doing the
// same to a SMALL image would blow a 400px logo up to 1280 and blur it, so the
// scale is capped at 1: an oversized image is fitted, a small one is drawn at
// its own size, centered either way.
function logoScale(w, h) {
  const s = Math.min(SCREEN_W / w, SCREEN_H / h, 1);
  return Math.round(s * 10000) / 10000;
}

// Timings are the reference file's, in ticks at 60fps: about 0.4s to fade in,
// 0.7s to fade out, 4.3s on screen. Skippable like any storyboard.
function buildLogoDef(w, h, opts = {}) {
  const s = logoScale(w, h).toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
  const hold = Number.isFinite(opts.endTime) ? Math.max(1, Math.round(opts.endTime)) : 260;
  return [
    '; Boot logo storyboard - GENERATED by Mugen Studio from an image.',
    '; Sprite-based on purpose: the browser build has no video support, so a',
    '; video logo would be several seconds of black there (GRAIL 5.11).',
    '[Info]',
    'localcoord = ' + SCREEN_W + ',' + SCREEN_H,
    '',
    '[SceneDef]',
    'spr = logo.sff',
    '',
    '[Scene 0]',
    'fadein.time = 25',
    'fadeout.time = 40',
    'end.time = ' + hold,
    'bg.name = BG0',
    '',
    '[BG0Def]',
    '',
    '[BG0 Logo]',
    'type = normal',
    'spriteno = 0,0',
    // x is from the screen center, y from the top - hence 0 and half of 720.
    'start = 0,' + Math.round(SCREEN_H / 2),
    'scalestart = ' + s + ',' + s,
    '',
  ].join('\r\n');
}

// Write logo.def + logo.sff into destDir from one image file.
//
// THE NAMES ARE FIXED. vfslib rewrites the motif's logo.storyboard line with a
// non-global regex while desktop.js uses a global one, so a generated file that
// was not called logo.def could be repointed on one product and not the other.
// Calling it logo.def unconditionally sidesteps the difference entirely.
function makeLogo(srcImagePath, destDir) {
  const png = fs.readFileSync(srcImagePath);
  const { w, h } = readPngSize(png);
  fs.mkdirSync(destDir, { recursive: true });
  fs.writeFileSync(path.join(destDir, 'logo.sff'), buildLogoSff(png, w, h));
  fs.writeFileSync(path.join(destDir, 'logo.def'), buildLogoDef(w, h), 'latin1');
  return { def: 'logo.def', files: ['logo.def', 'logo.sff'], w, h, scale: logoScale(w, h) };
}

module.exports = { makeLogo, buildLogoSff, buildLogoDef, readPngSize, logoScale, SCREEN_W, SCREEN_H };
