// A picture becomes a stage: the arithmetic, and nothing else.
//
// Shared by stagegen.js (which writes the .def) and the Studio's placement
// dialog (which previews it). ONE implementation on purpose - the preview
// draws a viewport rectangle and two fighters from these numbers, and the .def
// is written from the same numbers, so what you see is what the engine gets.
// Two copies would drift, and "the preview lied" is the worst bug this feature
// could have.
//
// THE MODEL. A stage is authored in its own coordinate space, `localcoord`, and
// the engine fits that space to the screen BY WIDTH ALONE
// (stage.go:1573 `s.localscl = gameWidth / localcoord[0]`), so a screen's worth
// of picture is `localcoord[0]` wide and `localcoord[0] * gameH/gameW` tall,
// whatever localcoord[1] claims. The one knob this exposes is therefore:
//
//   span - how many SCREENS WIDE the picture is.
//
// span 1: the whole width fits on screen, the camera is pinned, fighters are
// small against a big picture. span 2: half the width fits, the camera scrolls
// across the rest, fighters are twice as large on screen. It is the same knob
// as "how big are the fighters" and "how far does it scroll" - they are one
// number - which is why there is one slider and not three.
//
// The picture is placed so that IMAGE ROW N SITS AT STAGE Y (N + startY): the
// sprite's axis is pinned to its top edge and centered horizontally, `start` is
// (0, startY), and `zoffset` is wherever the floor row lands. Read off a real
// stage rather than assumed - Dark Forest carries axisY 369 with zoffset 190,
// i.e. its axis sits floorY - zoffset above the floor. We pin the axis at 0 and
// move `start` instead, which is the same thing with one fewer number.
//
// Pure: no fs, no DOM, integers out.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.stageGeom = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // The game's height-over-width. GameWidth/GameHeight are user settings
  // (settings-schema.js:112-113); both defaults are 16:9, and a 4:3 choice
  // changes how TALL a screen's worth of picture is, so it is read rather than
  // assumed.
  function gameAspect(settings) {
    const s = settings || {};
    const w = parseInt(s.GameWidth, 10), h = parseInt(s.GameHeight, 10);
    if (w > 0 && h > 0) return h / w;
    return 480 / 854;
  }

  // The smallest span at which one screen's HEIGHT still fits inside the
  // picture. Below it the view would poke out above or below the image and
  // show the void - a wide panorama cannot be span 1 on a 16:9 screen.
  function minSpan(w, h, aspect) {
    return Math.max(1, (w * aspect) / h);
  }

  const MAX_SPAN = 8;

  function geometry(w, h, floorY, opts) {
    const o = opts || {};
    const aspect = o.aspect > 0 ? o.aspect : 480 / 854;
    const floor = Math.max(1, Math.min(h - 1, Math.round(floorY)));
    const spanMin = minSpan(w, h, aspect);
    const span = Math.max(spanMin, Math.min(MAX_SPAN, o.span > 0 ? o.span : 1));

    const V = w / span;                        // one screen's width, in image px
    const Vh = V * aspect;                     // one screen's height, in image px

    // WHERE THE FLOOR SITS ON SCREEN. The stock 200-of-240 of a MUGEN stage,
    // clamped so the picture still covers the view at rest: zMin keeps the
    // image's bottom edge at or below the view's bottom, zMax keeps its top
    // edge at or above the view's top. At span 1 on a matching aspect the two
    // meet and the floor lands exactly where it is in the picture - which is
    // the behavior the first version had, unchanged.
    const zConv = Vh * (200 / 240);
    const zMin = Vh - h + floor;
    const zMax = floor;
    const Z = Math.max(zMin, Math.min(zMax, zConv));
    const startYReal = Z - floor;              // <= 0 by construction

    // ZOOM-OUT AND THE BOUNDS SHARE ONE BUDGET, and the engine spends part of
    // it without asking.
    //
    // Field bug (2026-09-12): a span-2 stage showed a black bar where the
    // fighters were furthest apart. camera.go:120-121 - whenever zoomout != 1
    // and the stage does not declare autozoom, the engine WIDENS boundleft and
    // boundright by (1-z)/z * gameWidth/2 screen px each, which is a full half
    // screen at z = 0.5. Real stages survive because authors set bounds well
    // inside their art; ours sat on the image edge with no margin, and the
    // camera was driven straight into the void. XBound (camera.go:269) then
    // keeps every zoomed view inside [boundL - half, boundR + half], so the
    // rule is: write the bounds PULLED IN by that term, and the engine's own
    // widening puts the pulled-back camera exactly on the picture's edge.
    //
    // In stage units the term is (1-z)/(2z) * V - gameWidth cancels, so it
    // holds at any resolution. At z = 1/span it eats the whole slack and the
    // stage would not scroll at all at normal zoom; so zoom-out is allowed at
    // most HALF the slack (z >= 2/(span+1)), leaving the other half to
    // ordinary scrolling. At span 1 all of this is 1 and 0 - the pinned case,
    // unchanged. The Vh/h floor keeps a pulled-back view inside the picture
    // vertically; there is no vertical widening in this branch (ExtraBoundH
    // runs only under autozoom, camera.go:175).
    // COMPUTE FROM WHAT THE ENGINE WILL ACTUALLY SEE, not from the ideal.
    //
    // Field bug two (2026-09-12): a 127x131 picture at span 1.3 still showed a
    // sliver of void - on the right only. Three roundings, all real, all biased
    // the same way. The axis is an integer, so an odd-width picture reaches
    // -64 on the left but only +63 on the right, while bounds figured from w/2
    // assumed +-63.5. localcoord is an integer, so the view the engine fits
    // was 98 wide where the arithmetic used 97.7. And zoomout is written to
    // three decimals. Together: the pulled-back view reached 63.3 against an
    // edge at 63 - a third of a stage pixel, which on a picture that small is
    // nearly three screen pixels. Every value below is therefore the ROUNDED
    // one the .def carries, the extents come from the axis rather than from
    // w/2, the slack is FLOORED rather than rounded, and one pixel is kept in
    // hand for whatever the draw itself rounds.
    const axisX = Math.round(w / 2);
    const extL = axisX, extR = w - axisX;          // how far the picture reaches
    // The view is FLOORED to an integer, not rounded: floor(V) <= V, so the
    // screen the engine really fits - floor(V) wide, floor(V) * aspect tall -
    // is never larger than the ideal one minSpan proved fits in the picture.
    // ...and never wider than the picture reaches on its SHORTER side, twice:
    // an odd-width picture at span 1 has V = w exactly, but a 127-wide view
    // centered on an axis at 64 runs -63.5..63.5 over art that stops at 63 -
    // half a stage pixel of void on the right, which at this size is three
    // screen pixels. So the view is at most 2 * min(extL, extR) wide: one
    // column short on odd widths, hidden on the left, and nothing on even.
    const lcW = Math.min(Math.floor(V), 2 * Math.min(extL, extR));   // the view width the engine uses
    const viewHr = lcW * aspect;                   // ...and its REAL height (fit by width)
    const lcH = Math.ceil(viewHr);                 // CEILED, never rounded - see cutLow below
    const viewHalf = lcW / 2;
    const MARGIN = 1;                              // one pixel in hand for whatever the draw rounds
    // Fighters are authored in a 320-wide space, this stage in an lcW-wide one.
    const scale = lcW / 320;
    // startY is written as an integer. Rounded to nearest it can land half a
    // pixel short of the bottom - a 720-row picture at span 1 fits a 719.44-row
    // view with startY -0.56, and -1 leaves 0.44 rows of void along the bottom
    // edge. So: nearest integer, then held inside [viewHr - h, 0], the range
    // in which the picture covers the view at rest. Never empty: viewHr <= Vh
    // <= h.
    const startY = Math.min(0, Math.max(Math.ceil(viewHr - h), Math.round(startYReal)));
    const zoff = startY + floor;                   // the ground row's stage y = zoffset
    // ZOOM ANCHORS ON THE GROUND LINE. stage.go:623 shifts the picture by
    // zoffset * (1/scl - 1) before scaling it by scl, so the ground row stays
    // put on screen as the camera pulls back, and a view at scl reaches
    // zoff/scl rows above the ground and (viewHr - zoff)/scl below it - against
    // a picture with `floor` rows above the ground and h - floor below. So
    // zoom-out has a vertical floor on EACH side of the ground, not the single
    // Vh/h an earlier version used: that is only their weighted mean, and too
    // loose whenever the ground sits at a different proportion of the picture
    // than of the view. Written to three decimals, rounded UP: it is a floor
    // on how far the camera may pull back, and rounding it down by half a
    // thousandth let a 4:3 view at span 2 pull back to 480.1 rows of a
    // 480-row picture.
    const zTop = zoff / Math.max(1, floor - MARGIN);
    const zBot = (viewHr - zoff) / Math.max(1, h - floor - MARGIN);
    const zoomOut = Math.min(1, Math.ceil(Math.max(0.5, 2 / (span + 1), zTop, zBot) * 1000 - 1e-6) / 1000);
    const fudge = ((1 - zoomOut) / (2 * zoomOut)) * lcW;   // stage units, per side
    const slackL = Math.max(0, Math.floor(extL - viewHalf - fudge - MARGIN));
    const slackR = Math.max(0, Math.floor(extR - viewHalf - fudge - MARGIN));
    // One number each way, as the engine takes them; the SMALLER of the two,
    // so the shorter side is never overrun. The picture is at most one pixel
    // off-center, so this costs at most one pixel of travel.
    const slack = Math.min(slackL, slackR);

    return {
      w, h, floorY: floor, span, aspect,
      viewW: V, viewH: Vh,
      localcoord: [lcW, lcH],
      axisX, axisY: 0,
      startX: 0, startY,
      zoffset: zoff,
      // Horizontal: the picture reaches extL left of x=0 and extR right of it;
      // the view is lcW wide; the camera may travel the difference either way -
      // LESS the margin the engine adds back on its own when it zooms out.
      boundLeft: -slack,
      boundRight: slack,
      // The engine's widening, reported so a checker can replicate it.
      zoomFudge: +fudge.toFixed(2),
      extentLeft: extL, extentRight: extR,
      // Vertical. The camera may rise until the view's top meets the image's
      // top and sink until the view's bottom meets the image's bottom - for
      // the PULLED-BACK view, because the engine clamps camera y to
      // [boundhigh, boundlow] at any zoom (camera.go:604), unlike x, which it
      // widens itself. The view's REAL height is the integer localcoord width
      // times the game's aspect (stage.go:1573 fits by width), not Vh.
      // boundhigh is therefore the limit at full zoom-out; with
      // boundhighzoomdelta = 1 (camera.go:599-602) the engine lets the camera
      // rise a further zoff * (1/scl - 1/zoomout) at any tighter zoom, which
      // is exactly what keeps the view's top on the same picture row - so an
      // ordinary jump at zoom 1 gets the full travel back. boundlow has no
      // such delta and is pulled in for good; nothing drives the camera down
      // anyway.
      boundHigh: Math.min(0, Math.ceil(zoff / zoomOut - floor + MARGIN)),
      boundLow: Math.max(0, Math.floor(h - floor - (viewHr - zoff) / zoomOut - MARGIN)),
      boundHighZoomDelta: 1,
      // localcoord's height is CEILED, so the engine sees a stage at least as
      // tall as the screen and takes the "cut the surplus rows" branch of its
      // aspect correction (camera.go:131-146); cutlow = that height lets it
      // cut them all from the bottom, where they are off screen anyway, and
      // the correction stays 0. Rounded down instead, the stage reads as
      // SHORTER than the screen and the engine shifts it down to overdraw the
      // bottom - void along the top.
      // ...and "lets it" has a catch: the engine compares that surplus in
      // SCREEN pixels against cutlow in stage units (camera.go:139), and the
      // surplus is under one stage pixel, i.e. up to gameWidth/lcW screen
      // pixels. So: the stage height or 7680/lcW + 1, whichever is larger -
      // good to an 8K screen. Nothing else reads cutlow.
      cutHigh: 0, cutLow: Math.max(lcH, Math.ceil(7680 / lcW) + 1),
      scale,
      zoomOut,
      // The screen's worth of picture at rest, in IMAGE pixels - what the
      // preview draws as a rectangle. Stage x 0 is image column axisX (not
      // w/2 - same integer the sprite carries), and stage y 0 is image row
      // -startY.
      viewRect: { x: axisX - lcW / 2, y: -startY, w: lcW, h: viewHr },
      // Where the two fighters stand at rest, in IMAGE pixels: stage x is
      // measured from the axis, and the stock starts are +-70 in 320-space.
      p1: { x: axisX - 70 * scale, y: floor },
      p2: { x: axisX + 70 * scale, y: floor },
    };
  }

  return { geometry, minSpan, gameAspect, MAX_SPAN };
});
