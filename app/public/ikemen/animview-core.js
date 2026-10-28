// ANIMVIEW - the .air player, as one implementation.
//
// This is a straight LIFT of the animation panel that lived inside studio.html,
// moved out so the panel and the pop-out window are the same code rather than
// two copies that drift. Every body below - boxOf, measure, show, tick, load,
// the pan/zoom handlers, the GIF save - is the original text; what changed is
// only what had to:
//
//   * IDS BECAME CLASSES. `#animPlay` and friends were unique-per-document,
//     which is exactly what a second instance on the same page cannot have.
//     Every lookup now goes through the host, so two players can sit side by
//     side and neither can reach the other's buttons.
//   * THE PAGE'S GLOBALS BECAME ARGUMENTS. `paletteSprite`, `palOf` and
//     `toast` are studio.html's; a pop-out window has none of them, so they
//     arrive as callbacks with working defaults.
//   * IT CAN BE TORN DOWN. There was no way to stop a player before - the two
//     window-level mouse listeners were added on every character switch and
//     never removed, so a session's worth of switching left a stack of live
//     drag handlers pointing at detached stages. destroy() removes them.
//   * LOADS CANNOT OVERTAKE EACH OTHER. The old guard compared against the
//     CHARACTER generation, which does not change when you pick another
//     action - so two quick picks raced and the slower response could win and
//     draw the wrong action. Each load now holds its own ticket.
//
// The CSS moved with it, injected once per document, so a window that has
// never heard of studio.html still gets a working player.

(function (root) {
  'use strict';

  // ---- the reader's language ------------------------------------------------
  //
  // This file also runs in the web game and in Node, where there is no
  // i18n.js: there t() fills in the English itself, so the game and the
  // server get exactly the words they always did. In a Studio window it is
  // I18n.t, in the language the reader picked (a window opens in it and
  // keeps it, so the names worked out once below stay right).
  // serverText() is I18n.server, for text the server sent.
  function t(en, vars) {
    const I = root && root.I18n;
    if (I && typeof I.t === 'function') return I.t(en, vars);
    return String(en).replace(/\{([A-Za-z_$][\w$]*)\}/g, (m, k) => (vars && Object.prototype.hasOwnProperty.call(vars, k) && vars[k] != null ? String(vars[k]) : m));
  }
  function serverText(s) {
    const I = root && root.I18n;
    return I && typeof I.server === 'function' ? I.server(s) : s;
  }

  // ---- the actions worth naming -------------------------------------------
  //
  // The numbers are wild in the wild - sakura declares action 74140108,
  // dr_kira -1415161857 - so the conventional ones are lifted into their own
  // group ahead of the full list.
  const ANIM_COMMON = [0, 5, 6, 10, 11, 12, 20, 21, 40, 41, 42, 43, 44, 45, 46, 47,
    100, 105, 120, 130, 131, 132, 150, 151, 170, 175, 180, 181, 190, 191, 192, 195];
  // Each one's head in the picker, number and name together ("#175 down"):
  // one key apiece, so a name that is also a word elsewhere ("down" is a
  // stick direction in the command glyphs) is said right in every language.
  const ANIM_HEAD = { 0: t('#0 stand'), 5: t('#5 turn'), 10: t('#10 crouch'), 12: t('#12 stand up'), 20: t('#20 walk fwd'),
    21: t('#21 walk back'), 40: t('#40 jump start'), 41: t('#41 jump up'), 100: t('#100 run'), 105: t('#105 hop back'),
    120: t('#120 guard start'), 131: t('#131 guard'), 150: t('#150 guard hit'), 170: t('#170 KO'), 175: t('#175 down'),
    180: t('#180 win'), 181: t('#181 winpose'), 190: t('#190 intro'), 195: t('#195 taunt') };

  // ---- the look, carried with the code ------------------------------------
  //
  // Written against tokens with fallbacks, so it takes studio.html's palette
  // where there is one and stands on its own where there is not. Injected once
  // per document: a second player on the same page reuses the first's.
  const CSS = [
    '.animwrap { display: flex; gap: 10px; align-items: flex-start; }',
    // ISOLATED, because a blended frame (an additive glow drawn plus-lighter,
    // a subtractive shadow drawn multiply - see show()) must mix with the
    // stage's own background and nothing behind the stage.
    '.animstage { position: relative; isolation: isolate;',
    '  width: var(--av-stage, 138px); height: var(--av-stage, 138px); flex: 0 0 auto;',
    '  background: var(--sunk, #14161a); border: 1px solid var(--line, #2a2f37);',
    '  border-radius: 0; overflow: hidden; cursor: grab; touch-action: none; }',
    '.animstage:active { cursor: grabbing; }',
    '.animstage img { position: absolute; image-rendering: pixelated; }',
    // COLLISION BOXES. Fighter Factory's colors, because everyone editing a
    // MUGEN character already reads them that way: red is what HITS (Clsn1),
    // green is what CAN BE HIT (Clsn2). Outline only - a filled box hides the
    // pose it is describing, and the pose is what you are checking against.
    '.avbox { position: absolute; pointer-events: none; box-sizing: border-box; }',
    '.avbox.c1 { border: 1px solid rgba(255,60,60,.95);',
    '  background: rgba(255,60,60,.10); }',
    '.avbox.c2 { border: 1px solid rgba(80,230,120,.95);',
    '  background: rgba(80,230,120,.10); }',
    // A BOX BIGGER THAN THE VIEW GETS NO FILL AND A DASHED EDGE.
    //
    // ero_mukai's action 3010 is a screen-filling super: Clsn1 is
    // (-320,100 .. 320,-240), 640x340 against a 138px stage. Filled at 10% that
    // washes the entire stage red and hides the pose it is describing; the
    // dashed clamped edge says "this continues past here" and leaves the art
    // readable, which is the whole reason the boxes are outlines and not solids.
    // Same idea as the GIF's stipple: a box that swallows the stage still has
    // to read as covering the sprite, but a flat 10% fill over everything just
    // washes the pose out. Fine diagonal hatching says "inside this box" and
    // leaves the art legible.
    '.avbox.huge { border-style: dashed; background-image: repeating-linear-gradient(',
    '  45deg, currentColor 0 1px, transparent 1px 7px); background-color: transparent; }',
    '.avbox.huge.c1 { color: rgba(255,60,60,.55); }',
    '.avbox.huge.c2 { color: rgba(80,230,120,.55); }',
    '.avbox.clipL { border-left-style: dashed; }',
    '.avbox.clipR { border-right-style: dashed; }',
    '.avbox.clipT { border-top-style: dashed; }',
    '.avbox.clipB { border-bottom-style: dashed; }',
    // The axis: the point the .air positions everything from, and the thing a
    // box is measured relative to. Worth seeing while boxes are on.
    '.avaxis { position: absolute; pointer-events: none; }',
    '.avaxis::before, .avaxis::after { content: ""; position: absolute;',
    '  background: rgba(120,190,255,.85); }',
    '.avaxis::before { left: -4px; top: 0; width: 9px; height: 1px; }',
    '.avaxis::after { left: 0; top: -4px; width: 1px; height: 9px; }',
    '.avclsn[aria-pressed="true"] { color: var(--bad, #e66); }',
    // THE AXIS, WHILE YOU ARE HOLDING THE PICTURE.
    //
    // An animation viewer gives you nothing to judge movement against, so a
    // sprite legitimately traveling - Gardevoir's action 11 declares 16px of
    // it, which is 129px on screen at 8x - reads as the player glitching. The
    // axis is the one thing that does NOT move: it is where the engine plants
    // the character, and every frame is positioned relative to it. Drawn only
    // while dragging, because that is when you are studying the thing and the
    // rest of the time it is furniture.
    '.avaxis { position: absolute; width: 0; height: 0; z-index: 2;',
    '  pointer-events: none; color: var(--accent, #ff8800); }',
    '.avaxis i { position: absolute; background: currentColor; opacity: .5; }',
    '.avaxis i.h { left: -9999px; width: 19998px; top: 0; height: 1px; }',
    '.avaxis i.v { top: -9999px; height: 19998px; left: 0; width: 1px; }',
    // the origin itself, so you can see WHERE on the line the anchor sits
    '.avaxis i.o { left: -3px; top: -3px; width: 5px; height: 5px;',
    '  background: none; border: 1px solid currentColor; opacity: .9; }',
    '.animside { flex: 1; min-width: 0; }',
    '.animside select { width: 100%; }',
    '.animside .rd { font-family: var(--fm, ui-monospace, monospace);',
    '  color: var(--mute, #8b93a1); margin-top: 5px;',
    '  font-size: 10px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
    // Where the opening action came from, when the character's own stand
    // action is blank (modlib charBodyAction). Wraps: it is a sentence.
    '.animside .avnote { margin-top: 6px; font-size: 11px; line-height: 1.4;',
    '  color: var(--mute, #8b93a1); white-space: normal; }',
    // WRAP, DO NOT SQUASH. Flex items shrink by default, so in a narrow panel
    // the row compressed every button until the GIF label was clipped mid-word -
    // and adding the Clsn toggle is what pushed it over. Buttons keep their
    // natural width and move to a second line instead, which costs 20px of
    // height in the one case it happens and never mangles a label.
    '.animbtns { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }',
    // THE TRANSPORT ICON IS DRAWN, NOT TYPED.
    // U+23F8 PAUSE measures exactly 1.0em in BOTH the display and the mono
    // face - identical across a proportional and a monospaced family, which is
    // the signature of a FALLBACK rather than a glyph either face owns. That
    // fallback is usually a color emoji: wrong weight, wrong color, wrong
    // size, and it ignores the button's ink. U+25B6 PLAY is genuinely present
    // (58.6px in Cascadia Mono, exactly one cell) and is already used
    // elsewhere on this page - but a pair where one half is real and the other
    // is emoji is worse than drawing both.
    //
    // Two spans in a flex row: two bars, or one triangle made of borders. No
    // font, no glyph coverage to depend on, and it takes the button's own
    // color so it follows every state the square-edge pass gave a button.
    '.avplay { display: inline-flex; align-items: center; justify-content: center;',
    '  gap: 3px; min-width: 34px; }',
    '.avplay i { display: block; background: currentColor; width: 3px; height: 11px; }',
    '.avplay[data-state="paused"] { gap: 0; }',
    '.avplay[data-state="paused"] i:first-child {',
    '  width: 0; height: 0; background: none;',
    '  border-left: 9px solid currentColor;',
    '  border-top: 6px solid transparent; border-bottom: 6px solid transparent; }',
    '.avplay[data-state="paused"] i:last-child { display: none; }',
    // the steppers are plain ASCII, which every face has
    '.avstep { min-width: 26px; }',
    // PAUSED IS A MODE, AND THE ROW SAYS SO.
    // The arrows do one thing while it runs and another while it is stopped,
    // so something has to distinguish them or the only way to find out is to
    // press one. The play control already changes SHAPE; the whole group takes
    // the accent as well, which is the same language the rest of the window
    // uses for "this is the live one".
    //
    // `!important` IS LOAD-BEARING HERE, and it is the one place in this file
    // that needs it. The cue used to be written `... #animPrev`, which carried
    // an id and so outranked studio.html's `#charDetail button` - the rule that
    // colors every button in that column. Dropping the ids for classes to make
    // two players fit on one page also dropped the module below that host rule,
    // and the paused state silently stopped showing. A class-only selector
    // cannot outrank an id selector at any length, so the only way to keep a
    // state cue the module owns is to say so. Scoped to the paused state and to
    // this module's own two controls; the host's hover color was already
    // outranked by the old selector too, so nothing else changes.
    '.animbtns[data-mode="frame"] .avstep,',
    '.animbtns[data-mode="frame"] .avplay {',
    '  color: var(--accent, #6ea8fe) !important;',
    '  border-color: var(--accent, #6ea8fe) !important; }',
    '.animbtns button { padding: 2px 9px; font-size: 11px;',
    '  flex: 0 0 auto; white-space: nowrap; }',
    // THE GIF KEY IS TWO KEYS JOINED: GIF saves with the options you last
    // chose, the arrow beside it opens them. One group, so a wrapping row never
    // parts them. The joined edges are square; `!important` because a host
    // page may round every button with it (studio.html does), and a class pair
    // outranks that rule only if it can say so too. The arrow is drawn from
    // borders for the reason the transport icon is (a glyph here is a fallback).
    '.avgifset { display: inline-flex; flex: 0 0 auto; }',
    '.avgifset .avgif { border-top-right-radius: 0 !important; border-bottom-right-radius: 0 !important; }',
    '.animbtns .avgifset .avgifmore { border-top-left-radius: 0 !important; border-bottom-left-radius: 0 !important;',
    '  margin-left: -1px; padding: 2px 6px; display: inline-flex; align-items: center; }',
    '.avgifmore i { display: block; width: 0; height: 0; border-left: 4px solid transparent;',
    '  border-right: 4px solid transparent; border-top: 5px solid currentColor; }',
    // THE OPTIONS POPOVER. Fixed to the viewport and parented outside the
    // player (see openPop), so the 138px panel stage can neither clip it nor
    // be covered by it. Written against the same tokens as the rest, with
    // fallbacks for a page that has none.
    '.avgifpop { position: fixed; z-index: 1000; box-sizing: border-box; width: 244px;',
    '  max-width: calc(100vw - 16px); max-height: calc(100vh - 16px); overflow: auto;',
    '  display: flex; flex-direction: column; gap: 8px; padding: 10px 12px;',
    '  background: var(--panel2, #1f1a2e); color: var(--text, #d8d6e8);',
    '  border: 1px solid var(--line2, #3a3550); box-shadow: 0 0 0 3px var(--ground, rgba(0,0,0,.55));',
    '  font: 12px/1.3 var(--fu, system-ui, sans-serif); text-transform: none; letter-spacing: normal; }',
    '.avgifpop[hidden] { display: none; }',
    '.avgifpop fieldset { border: 0; margin: 0; padding: 0; min-width: 0; }',
    '.avgifpop legend { padding: 0; margin: 0 0 3px; color: var(--dim, #8b84a8); font-size: 11px; }',
    '.avgifpop .seg { display: flex; }',
    // Sized by their words, so "Transparent" is never the one cut short.
    '.avgifpop .seg label { flex: 1 1 auto; min-width: 0; position: relative; cursor: pointer; }',
    // The radio itself is kept (it is what the keyboard and a screen reader
    // use: Tab into the group, arrows to choose) and only its dot is hidden.
    '.avgifpop .seg input { position: absolute; left: 0; top: 0; width: 1px; height: 1px;',
    '  margin: 0; opacity: 0; pointer-events: none; }',
    '.avgifpop .seg span { display: block; text-align: center; padding: 3px 2px; white-space: nowrap;',
    '  overflow: hidden; text-overflow: ellipsis; margin-left: -1px;',
    '  border: 1px solid var(--line2, #3a3550); background: var(--sunk, #07060c); color: var(--text, #d8d6e8); }',
    '.avgifpop .seg label:first-child span { margin-left: 0; }',
    '.avgifpop .seg label:hover span { color: var(--hi, #fff); }',
    '.avgifpop .seg input:checked + span { position: relative; z-index: 1;',
    '  color: var(--accent, #ff8800); border-color: var(--accent, #ff8800); }',
    '.avgifpop .seg input:focus-visible + span { position: relative; z-index: 2;',
    '  outline: 2px solid var(--accent, #ff8800); outline-offset: 1px; }',
    '.avgifpop .chk { display: flex; gap: 6px; align-items: center; cursor: pointer; }',
    '.avgifpop .chk input { margin: 0; }',
    '.avgifpop .avstill { width: 100%; }',
    // FILL MODE - the pop-out. Same player, given the whole window instead of a
    // 138px square: the picture takes every pixel that is left after the
    // controls, and the fit is recomputed as the window is dragged.
    '.animwrap.av-fill { flex-direction: column; gap: 8px; height: 100%; }',
    '.av-fill .animstage { width: auto; height: auto; flex: 1 1 auto;',
    '  align-self: stretch; min-height: 0; }',
    '.av-fill .animside { flex: 0 0 auto; width: 100%; }',
    '.av-fill .animside select { max-width: none; }',
  ].join('\n');

  // FIRST IN THE HEAD, NOT LAST. This used to live inside studio.html's own
  // <style>, so every page rule written after it won ties on equal specificity.
  // Appending it to the head would have inverted that and let the module quietly
  // outrank the page it is embedded in. Inserted first, the host's stylesheet
  // still wins every tie - and a window that has no host stylesheet is
  // unaffected, because there is nothing there to tie with.
  function injectCSS(doc) {
    if (doc.getElementById('animview-css')) return;
    const s = doc.createElement('style');
    s.id = 'animview-css';
    s.textContent = CSS;
    const head = doc.head || doc.documentElement;
    head.insertBefore(s, head.firstChild);
  }

  // ---- which element is on screen, tick by tick ----------------------------
  //
  // airTimeline(times, loopstart)
  //   -> { runs: [{ elem, spr, clsn, ticks }], loopFrom, hold, firstPass }
  //
  // Each tick the engine draws frames[drawidx] wearing a.spr, as UpdateSprite
  // leaves them inside Animation.Action (anim.go:802-846, 667-721). Nothing
  // here is a rule of thumb: this is Action with its next() closure,
  // UpdateSprite and animSeek (anim.go:638-665), run from Reset
  // (anim.go:483-488) over the totals ReadAnimation computes (anim.go:428-452),
  // one tick at a time, until the engine's state repeats. What that settles:
  //   * totaltime is -1 when the last time is -1; otherwise it is the RAW sum
  //     of the times from the last -1 on, and -1 again if that sum is -1.
  //     looptime and prelooptime depend on Loopstart. So `5,-1,5` loops
  //     element 1 every 4 ticks and never reaches element 3, `5,5,-2` cuts
  //     element 2 to 3 ticks, and `1,-2` sums to -1 and holds element 2.
  //   * If totaltime > 0, at curtime >= totaltime it returns to Loopstart and
  //     animSeek skips every time <= 0 (a last -1 excepted), landing on the
  //     LAST element when nothing drawable follows; after a wrap curtime
  //     restarts at totaltime - looptime. If prelooptime < 0, element 1 is
  //     forced for the tick where curtime reaches totaltime + prelooptime,
  //     whatever its time (anim.go:681-689) - before the first wrap as well.
  //   * next() skips time <= 0; with totaltime -1 it stops on the last element,
  //     which holds (anim.go:812-824).
  //   * If totaltime <= 0 nothing seeks: element 1 on tick 1, and the Loopstart
  //     element after every wrap (anim.go:843), is drawn whatever its time.
  //   * A sprite loads only when a drawn element's time is not 0 (anim.go:693);
  //     Reset leaves none (anim.go:487). A drawn time-0 element wears the
  //     previous sprite or none; a drawn negative one wears its own.
  //   * AnimElem counts every element (anim.go:507-520).
  //
  // Each run is one stretch of constant picture: `elem` is the element on
  // screen (drawidx), `spr` the element whose sprite is loaded (-1: none yet),
  // `clsn` the element whose collision boxes the engine TESTS for hits on that
  // tick. Hit detection reads curFrame as actionRun commits it
  // (char.go:12195), before Char.update's UpdateSprite (char.go:12472-12477)
  // seeks, wraps or jumps curelem; globalCollision runs after that update
  // (system.go:3007, 3017) and getClsn reads that curFrame (char.go:10346-10353,
  // minus = 3 from char.go:12613). So on a tick where UpdateSprite moves
  // curelem (a seek past a hidden element, a wrap, the prelooptime jump) the
  // tested boxes are the element it moved from. The engine's own Clsn debug
  // display is NOT that: Char.tick commits curFrame again at char.go:12626,
  // after the seek, and cueDebugDraw draws getClsn of it (char.go:12831-12847)
  // - the drawn element's boxes.
  // runs[loopFrom..] repeat for ever; `hold` means the engine has stopped and
  // the last run stays. `firstPass` is how many ticks play before the engine
  // first goes back to Loopstart (null when it never does).
  const TIMELINE_BUDGET = 4000000;
  function airTimeline(times, loopstart) {
    const T = [];
    for (const v of (times || [])) {
      const x = Math.trunc(Number(v));
      T.push(Number.isFinite(x) ? x : 0);
    }
    const n = T.length;
    if (!n) return { runs: [], loopFrom: 0, hold: true, firstPass: null };
    let ls = Math.trunc(Number(loopstart)) || 0;
    if (ls < 0 || ls >= n) ls = 0;

    // THE COMMON CASE NEEDS NO SIMULATION. Every time positive, save perhaps a
    // last -1: animSeek never moves, every element plays its own time, the
    // loop goes back to loopstart and a last -1 holds. That is all but about
    // 1,600 of the 360,000 actions in the corpus - and it takes in the ones
    // whose cycle runs for days (makoto 5300 ends on an 807,414,841-tick frame).
    let plain = true;
    for (let i = 0; i < n && plain; i++) if (!(T[i] > 0 || (i === n - 1 && T[i] === -1))) plain = false;
    if (plain) {
      const runs = T.map((t, i) => ({ elem: i, spr: i, clsn: i, ticks: t > 0 ? t : 1 }));
      const hold = T[n - 1] === -1;
      return { runs, loopFrom: hold ? n - 1 : ls, hold, firstPass: hold ? null : T.reduce((s, t) => s + t, 0) };
    }
    // A cycle too long to walk tick by tick (more than about nine hours of
    // animation, kuromaru's action 10001 is 0,201326592,539767340): say what
    // the elements say - the ones with a positive time, a last -1 held - and
    // mark it as an approximation rather than spend the page on it.
    const approx = () => {
      const runs = [];
      T.forEach((t, i) => { if (t > 0 || (i === n - 1 && t === -1)) runs.push({ elem: i, spr: i, clsn: i, ticks: t > 0 ? t : 1 }); });
      if (!runs.length) return { runs: [{ elem: 0, spr: -1, clsn: 0, ticks: 1 }], loopFrom: 0, hold: true, approx: true, firstPass: null };
      const hold = T[n - 1] === -1;
      return { runs, loopFrom: hold ? runs.length - 1 : 0, hold, approx: true, firstPass: null };
    };
    // Only positive times make the state space large: curelemtime counts up
    // to a positive time and curtime up to totaltime, a sum that negative
    // times only shrink, and next() steps over every time <= 0.
    let span = 0;
    for (const t of T) if (t > 0) span += t;
    if (span > TIMELINE_BUDGET / 4) return approx();

    // ReadAnimation's totals (anim.go:428-452).
    let total = 0, loopT = 0, pre = 0;
    if (T[n - 1] === -1) total = -1;
    else {
      let tmp = 0;
      for (let i = 0; i < n; i++) {
        if (T[i] === -1) { total = 0; loopT = -tmp; pre = 0; }
        total += T[i];
        if (i < ls) { pre += T[i]; tmp += T[i]; } else loopT += T[i];
      }
      if (total === -1) pre = 0;
    }
    // State: [curelem, curelemtime, curtime, newframe, spr, drawidx, wrapped].
    // wrapped: 1 when this tick's picture follows a return to Loopstart
    // (UpdateSprite's), 2 when the next tick's will (Action's).
    const seek = (s) => {                                   // animSeek
      const elem = s[0] < 0 ? 0 : s[0];
      let foo = true;
      for (;;) {
        s[0] = elem;
        while (s[0] < n && T[s[0]] <= 0) {
          if (s[0] === n - 1 && T[s[0]] === -1) break;
          s[0]++;
        }
        if (s[0] < n) break;
        foo = !foo;
        if (foo) { s[0] = n - 1; break; }
      }
      if (s[0] < 0) s[0] = 0; else if (s[0] >= n) s[0] = n - 1;
    };
    const next = (s) => {                                   // Action's next()
      if (total !== -1 || s[0] < n - 1) {
        s[1] = 0; s[3] = 1;
        for (;;) {
          s[0]++;
          if ((total === -1 && s[0] === n - 1) || s[0] >= n || T[s[0]] > 0) break;
        }
      }
    };
    const step = (s) => {
      s[6] = 0;
      // UpdateSprite
      if (total > 0) {
        if (s[2] >= total) { s[1] = 0; s[3] = 1; s[0] = ls; s[6] = 1; }
        seek(s);
        if (pre < 0 && s[2] >= total + pre && s[2] >= total - loopT
          && (s[2] === total + pre || s[2] === total - loopT)) { s[1] = 0; s[3] = 1; s[0] = 0; }
      }
      if (s[3] && T[s[0]] !== 0) s[4] = s[0];
      s[3] = 0; s[5] = s[0];
      // the rest of Action
      if (T[s[0]] <= 0) next(s);
      if (s[0] < n) {
        s[1]++;
        if (s[1] >= T[s[0]]) { next(s); if (s[0] >= n) { s[0] = ls; if (!s[6]) s[6] = 2; } }
      } else { s[0] = ls; if (!s[6]) s[6] = 2; }
      if (total !== -1 && s[2] >= total) s[2] = total - loopT;
      s[2]++;
      // Nothing reads curtime once totaltime is -1, and curelemtime is only
      // ever compared with the element's time - so both are folded to the
      // values that behave the same, which is what lets a hold repeat.
      if (total === -1) s[2] = 0;
      const t = T[s[0]];
      s[1] = t <= 0 ? 0 : Math.min(s[1], t);
    };
    const init = () => [0, 0, 0, 1, -1, 0, 0];
    const same = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3] && a[4] === b[4];
    // Brent's cycle finder: the period, then where the period starts.
    let power = 1, lam = 1, budget = TIMELINE_BUDGET;
    const tort = init(), hare = init();
    step(hare);
    while (!same(tort, hare)) {
      if (power === lam) { for (let k = 0; k < 7; k++) tort[k] = hare[k]; power *= 2; lam = 0; }
      step(hare); lam++;
      if (--budget < 0) return approx();
    }
    const a = init(), b = init();
    for (let k = 0; k < lam; k++) step(b);
    let mu = 0;
    while (!same(a, b)) { step(a); step(b); mu++; }
    const d = [];
    const s = init();
    let firstPass = null;
    for (let k = 0; k < mu + lam; k++) {
      const clsn = s[0];
      step(s);
      d.push(s[5], s[4], clsn);
      if (firstPass === null && s[6]) firstPass = s[6] === 1 ? k : k + 1;
    }
    // The state can repeat later than the picture does (curtime is part of
    // the state): pull the start of the loop back while the picture agrees.
    const pic = (k) => d[3 * k] + ',' + d[3 * k + 1] + ',' + d[3 * k + 2];
    while (mu > 0 && pic(mu - 1) === pic(mu - 1 + lam)) mu--;
    const runs = [];
    let loopFrom = 0;
    for (let k = 0; k < mu + lam; k++) {
      if (k === mu) loopFrom = runs.length;
      const e = d[3 * k], sp = d[3 * k + 1], cl = d[3 * k + 2], r = runs[runs.length - 1];
      if (r && k !== mu && r.elem === e && r.spr === sp && r.clsn === cl) r.ticks++;
      else runs.push({ elem: e, spr: sp, clsn: cl, ticks: 1 });
    }
    const hold = lam === 1;
    return { runs, loopFrom, hold, firstPass: hold ? null : firstPass };
  }

  // ReadAnimation's totals (anim.go:428-452): { totaltime, looptime,
  // prelooptime }. totaltime is what AnimTime counts down to and how long one
  // pass lasts; -1 when the last time is -1 (or the raw sum is).
  function airTotals(times, loopstart) {
    const T = (times || []).map((v) => { const x = Math.trunc(Number(v)); return Number.isFinite(x) ? x : 0; });
    const n = T.length;
    let ls = Math.trunc(Number(loopstart)) || 0;
    if (ls < 0 || ls >= n) ls = 0;
    let total = 0, loopT = 0, pre = 0;
    if (!n) return { totaltime: 0, looptime: 0, prelooptime: 0 };
    if (T[n - 1] === -1) return { totaltime: -1, looptime: 0, prelooptime: 0 };
    let tmp = 0;
    for (let i = 0; i < n; i++) {
      if (T[i] === -1) { total = 0; loopT = -tmp; pre = 0; }
      total += T[i];
      if (i < ls) { pre += T[i]; tmp += T[i]; } else loopT += T[i];
    }
    if (total === -1) pre = 0;
    return { totaltime: total, looptime: loopT, prelooptime: pre };
  }

  // What the Studio's two entries of one action play.
  //   full  the action as it plays from a ChangeAnim, with its real Loopstart,
  //         up to the tick the engine first goes back to Loopstart - and then
  //         from the start again, so the whole action repeats. A timeline
  //         that holds is the engine's exactly.
  //   loop  the part that repeats for ever: runs[loopFrom..] of the same
  //         timeline, which is the engine's steady cycle whatever the
  //         transient was (a hold is its last run). Element numbers stay the
  //         action's own.
  // A run cut by an entry's edge keeps its picture; a cycle whose last and
  // first runs show the same picture is joined, so stepping never stops twice
  // on one picture.
  function airEntries(times, loopstart) {
    const tl = airTimeline(times, loopstart);
    const join = (runs) => {
      const out = runs.map((r) => Object.assign({}, r));
      if (out.length > 1) {
        const f = out[0], l = out[out.length - 1];
        if (f.elem === l.elem && f.spr === l.spr && f.clsn === l.clsn) { f.ticks += l.ticks; out.pop(); }
      }
      return out;
    };
    let full;
    if (tl.hold || tl.approx || tl.firstPass === null) full = { runs: tl.runs.map((r) => Object.assign({}, r)), loopFrom: tl.hold ? tl.loopFrom : 0, hold: tl.hold };
    else {
      const runs = [];
      let left = tl.firstPass, i = 0;
      while (left > 0 && tl.runs.length) {
        const r = tl.runs[i];
        const take = Math.min(left, r.ticks);
        const last = runs[runs.length - 1];
        if (last && last.elem === r.elem && last.spr === r.spr && last.clsn === r.clsn) last.ticks += take;
        else runs.push(Object.assign({}, r, { ticks: take }));
        left -= take;
        i = i + 1 < tl.runs.length ? i + 1 : tl.loopFrom;
      }
      full = { runs, loopFrom: 0, hold: false };
    }
    const tail = tl.runs.slice(tl.loopFrom);
    const loop = tl.hold ? { runs: tail.map((r) => Object.assign({}, r)), loopFrom: 0, hold: true } : { runs: join(tail), loopFrom: 0, hold: false };
    return { full, loop, engine: tl };
  }

  // ---- how the engine draws one run ------------------------------------------
  //
  // runPlace(e, s) -> { X, Y, sx, sy, ax, ay, w, h, l, r, t, b } or null
  //
  // `e` is the element on screen (its offset, flip and scale), `s` the sprite
  // it wears ({ w, h, axisX, axisY }), both as /api/char-anim sends them. The
  // SAME rule the GIF composer draws with (modlib.js runPlacement), so the
  // panel, the GIF and the still agree on every pixel's place:
  //   X = xDraw ?? x, Y = yDraw ?? y      the DRAWN offset: an even number of
  //                                        H (V) of two or more negates it
  //   sx = (flipH ? -1 : 1) * xscale      mirrored and scaled ABOUT THE AXIS
  //   sy = (flipV ? -1 : 1) * yscale      (anim.go:926-1030), never the middle
  // so the sprite covers [X - axisX*sx, X + (w - axisX)*sx], sorted, and rows
  // the same way. The flags arrive as flipH/flipV: `h` on these frames is the
  // sprite's HEIGHT. A scale of 0 draws nothing (isBlank, anim.go:490-492), and
  // so does a sprite the file lacks (no w/h). The angle is not drawn.
  function runPlace(e, s) {
    if (!e || !s || !s.w || !s.h) return null;
    const xs = e.xscale !== undefined ? Number(e.xscale) : 1, ys = e.yscale !== undefined ? Number(e.yscale) : 1;
    const sx = (e.flipH ? -1 : 1) * xs, sy = (e.flipV ? -1 : 1) * ys;
    if (!sx || !sy || !Number.isFinite(sx) || !Number.isFinite(sy)) return null;
    const X = e.xDraw !== undefined ? Number(e.xDraw) : (Number(e.x) || 0);
    const Y = e.yDraw !== undefined ? Number(e.yDraw) : (Number(e.y) || 0);
    const ax = s.axisX || 0, ay = s.axisY || 0;
    const xa = X - ax * sx, xb = X + (s.w - ax) * sx;
    const ya = Y - ay * sy, yb = Y + (s.h - ay) * sy;
    return { X, Y, sx, sy, ax, ay, w: s.w, h: s.h,
      l: Math.min(xa, xb), r: Math.max(xa, xb), t: Math.min(ya, yb), b: Math.max(ya, yb) };
  }

  // THE BLEND, AS CSS CAN DRAW IT over the stage's own color.
  //
  // blendStyle(blend) -> { mode, opacity, filter }, '' where nothing applies.
  // `blend` is the frame's { mode, src, dst, s, d } from /api/char-anim, s and
  // d being the renderer's 0-255 factors after alphaToBlend (anim.go:849-889).
  // The engine computes, with C the sprite color, a its palette alpha (the
  // PNG's own alpha, which the browser already applies), B the stage and
  // s' = s/255, d' = d/255 (render.go:796-966):
  //   add     B*(1 - a*(1-d')) + C*a*s'
  //   sub     B*(1 - a*(1-d')) - C*a*s'
  //   subadd  B - gray(C)*a*d' + C*a*s'
  // What each case below costs:
  //   add, d' = 0 (AS<n>D0): B*(1-a) + C*s'*a, the sprite darkened and drawn
  //     normally - brightness(s'), EXACT;
  //   translucent (an add with d' about 1 - s', s' < 1: AS128D128, AS64D192 -
  //     an alpha blend written as an add, the GIF composer's same test): drawn
  //     normally at opacity s' - B*(1-a*s') + C*a*s', exact when d' = 1 - s';
  //   any other add (A, A1, AS..D..): plus-lighter at opacity s' - B + C*a*s',
  //     EXACT when d' = 1 (A, AS<n>D256); with d' < 1 the backdrop is kept
  //     whole where the engine dims it (A1 keeps B/2 under the sprite);
  //   sub, subadd: CSS has no subtract, so the sprite is inverted and
  //     multiplied at opacity s' (d' for subadd, its darkening term) -
  //     B*(1 - k*C) against the engine's B - k*C: an APPROXIMATION, right in
  //     where it darkens, not in how much.
  function blendStyle(bl) {
    const none = { mode: '', opacity: '', filter: '' };
    if (!bl || !bl.mode) return none;
    const cl = (v) => Math.max(0, Math.min(255, Math.round(Number(v) || 0)));
    const s = cl(bl.s !== undefined ? bl.s : bl.src), d = cl(bl.d !== undefined ? bl.d : bl.dst);
    const sp = String(Math.round(s / 255 * 1000) / 1000), dp = String(Math.round(d / 255 * 1000) / 1000);
    if (bl.mode === 'add') {
      if (d === 0) return s >= 255 ? none : { mode: '', opacity: '', filter: 'brightness(' + sp + ')' };
      if (s < 255 && d < 255 && Math.abs(s + d - 255) <= 16) return { mode: '', opacity: sp, filter: '' };
      return { mode: 'plus-lighter', opacity: s >= 255 ? '' : sp, filter: '' };
    }
    const k = bl.mode === 'subadd' ? d : s;
    return { mode: 'multiply', opacity: k >= 255 ? '' : (bl.mode === 'subadd' ? dp : sp), filter: 'invert(1)' };
  }

  // ---- the GIF options ---------------------------------------------------------
  //
  // One set for every player in this browser - the panel, the pop-out, the
  // editor and the bench share the origin, so a size chosen in one is the size
  // saved from all of them. Per viewer, in localStorage, and never required:
  // storage that is blocked or empty just means the defaults, which are the
  // GIF as it always was (1x, transparent, normal speed, facing right).
  const GIF_OPTS_KEY = 'animview.gif';
  const GIF_SIZES = [[1, '1x'], [2, '2x'], [3, '3x'], [4, '4x']];
  const GIF_BGS = [['', t('Transparent')], ['000000', t('Black')], ['ffffff', t('White')], ['00ff00', t('Green')]];
  const GIF_SPEEDS = [[1, t('Normal')], [2, t('Half')], [4, t('Quarter')]];
  const GIF_FACES = [[1, t('Right')], [-1, t('Left')]];
  function gifOptsFrom(v) {
    const o = { scale: 1, bg: '', speed: 1, face: 1 };
    if (!v || typeof v !== 'object') return o;
    if (GIF_SIZES.some(([n]) => n === v.scale)) o.scale = v.scale;
    if (GIF_BGS.some(([n]) => n === v.bg)) o.bg = v.bg;
    if (GIF_SPEEDS.some(([n]) => n === v.speed)) o.speed = v.speed;
    if (v.face === -1) o.face = -1;
    return o;
  }
  // Read fresh at every use, so a choice made in the pop-out is the one the
  // panel saves with next. Where storage is refused the last choice made in
  // this window is kept in memory instead, for as long as the page is open.
  let memGifOpts = null, memWins = false;
  function readGifOpts(win) {
    if (memWins) return gifOptsFrom(memGifOpts);
    try {
      const raw = win && win.localStorage ? win.localStorage.getItem(GIF_OPTS_KEY) : null;
      if (raw) return gifOptsFrom(JSON.parse(raw));
    } catch (e) { /* blocked or unreadable: fall through */ }
    return gifOptsFrom(memGifOpts);
  }
  function writeGifOpts(win, o) {
    memGifOpts = gifOptsFrom(o);
    try {
      if (!win || !win.localStorage) throw new Error('no storage');
      win.localStorage.setItem(GIF_OPTS_KEY, JSON.stringify(memGifOpts));
      memWins = false;
    } catch (e) { memWins = true; /* storage refused: this window keeps its own choice */ }
  }
  // Popovers live in the document, not in a player, so their radio groups
  // need names no second player on the page can share.
  let popSerial = 0;

  // ---- the player ---------------------------------------------------------
  //
  // mountAnimView(host, cfg) -> { destroy, repaint, element, ... }
  //
  //   cfg.char       character id, as the API knows it            (required)
  //   cfg.spriteUrl  (id, [group, index]) -> src for one sprite   (optional)
  //   cfg.palOf      (id) -> picked palette slot, or undefined    (optional)
  //   cfg.toast      (message, kind) -> void                      (optional)
  //   cfg.fill       true to take the whole host, for a window    (optional)
  //   cfg.magnify    scale up to whole-number factors             (optional)
  //                  true, or (stageW, stageH) -> boolean, asked at every
  //                  fit: the Studio panel magnifies only from a 150px
  //                  stage, so its 138px default never does.
  //   cfg.onReady    (info) -> void, once the action list is up   (optional)
  //   cfg.actions    a PRESET list instead of the character's .air (optional)
  //                  [{ action, label, char?, sprites?, frames? }] - the pair
  //                  bench's scene view: each entry names the action, whose
  //                  .air it comes from (char, default cfg.char) and whose
  //                  sprite file draws it (sprites, default char). No GIF
  //                  button, no loop entries, no Common group.
  //   cfg.animUrl    (entry, loop) -> frames URL for a preset entry (optional)
  //   cfg.listLabel  the optgroup title over a preset list         (optional)
  //   cfg.facing     1, -1, or () -> 1 | -1, asked at every draw   (optional)
  //                  -1 is the engine's facing left: the whole stage
  //                  mirrored about the axis, sprite, boxes and cross, and
  //                  the GIF saved that way (facing=-1). The pair bench's
  //                  mirror box is a function over its checkbox; call
  //                  repaint() after it changes.
  //
  // Returns synchronously; the action list arrives later. destroy() is safe at
  // any point, including before the first fetch has come back.
  function mountAnimView(host, cfg) {
    cfg = cfg || {};
    const id = cfg.char;
    const doc = host.ownerDocument || document;
    const win = doc.defaultView || root;
    injectCSS(doc);

    // Everything this mount is holding, so destroy() can let all of it go.
    let dead = false;
    let loadGen = 0;
    let timer = null;
    let chain = 0;
    const offs = [];      // teardown thunks for listeners outside the host

    const q = (sel) => host.querySelector(sel);
    const say = cfg.toast || ((m) => { try { win.console.log(m); } catch (e) { /* none */ } });
    const spriteUrl = cfg.spriteUrl || ((c, gi) => '/api/sprite?char=' + encodeURIComponent(c)
      + '&group=' + gi[0] + '&index=' + gi[1]);
    const palOf = cfg.palOf || (() => undefined);

    const handle = {
      element: host,
      repaint: () => {},
      destroy: () => { dead = true; },
    };

    // A preset list stands in for the .air: entries are addressed by index
    // ('p0', 'p1'...), so two entries may show the same action number from
    // different files, which is exactly what a scene compares.
    const preset = Array.isArray(cfg.actions) && cfg.actions.length ? cfg.actions : null;
    let curEntry = null;

    (async function boot() {
      let a = null;
      // A preset list gets the GIF button too, when the caller has asked the
      // server whether this build can write one (cfg.canGif).
      if (preset) a = { actions: preset.map((e, i) => Object.assign({ frames: 0, loopStart: 0, loopFrames: 0 }, e, { _i: i })), canGif: !!cfg.canGif };
      else {
        try { a = await (await fetch('/api/char-actions?char=' + encodeURIComponent(id))).json(); }
        catch (e) { a = null; }
      }
      if (dead) return;
      if (!a || a.error || !a.actions || !a.actions.length) {
        host.innerHTML = '<div class="palhint">No readable .air.</div>';
        return;
      }
      // THE LOOPING PART, AS ITS OWN ENTRY.
      //
      // An .air action can carry a Loopstart marker: when the animation reaches
      // its last frame it restarts THERE, not at frame 0. So a walk cycle
      // usually opens with a few step-off frames that play once on entry and
      // never again - Kula's action 20 is four start-up frames and then a
      // twelve-frame cycle. Played or exported whole, she keeps re-doing her
      // start-up forever.
      //
      // The marker is real data, not a guess, so every action that has one gets
      // a second entry listing only the repeat. It is a VIEW, nothing is
      // written: the .air on disk is untouched and the export is unaffected.
      // A preset label can carry text lifted from a third party's state
      // file (a trigger atom, an expression): escaped, since it lands in
      // innerHTML.
      const escHtml = (t) => String(t).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
      const label = (x, loop) => (x.label ? escHtml(x.label) : ANIM_HEAD[x.action] ? escHtml(ANIM_HEAD[x.action]) : '#' + x.action)
        + (loop ? ' · ' + escHtml(t('loop')) : '')
        + (x.frames ? ' · ' + escHtml(t('{n}f', { n: loop ? x.loopFrames : x.frames })) : '');
      const valueOf = (x, loop) => (preset ? 'p' + x._i : String(x.action)) + (loop ? ':loop' : '');
      const opt = (x, loop) => '<option value="' + valueOf(x, loop) + '">'
        + label(x, loop) + '</option>';
      // Each loop entry sits directly under the action it comes from.
      const optsOf = (list) => list.map((x) => opt(x, false)
        + (x.loopStart > 0 ? opt(x, true) : '')).join('');
      const common = preset ? [] : a.actions.filter((x) => ANIM_COMMON.indexOf(x.action) >= 0);
      // The body action, only when it is in the list and has a sentence.
      const body = !preset && a.body && typeof a.body.note === 'string'
        && a.actions.some((x) => x.action === a.body.action) ? a.body : null;
      const loopCount = a.actions.filter((x) => x.loopStart > 0).length;
      // The stage is focusable so it can own the arrow keys without stealing
      // them from the picker, where they already mean "another action".
      host.innerHTML = '<div class="animwrap' + (cfg.fill ? ' av-fill' : '') + '">'
        + '<div class="animstage" tabindex="0" '
        + 'title="Drag to pan · scroll to zoom · right-click to reset'
        + '· click, then ← → to step frames"></div>'
        + '<div class="animside"><select class="avpick">'
        // (an optgroup's label is not one of the attributes a page's
        // language reaches, so its words go through t() here)
        + (common.length ? '<optgroup label="' + escHtml(t('Common')) + '">' + optsOf(common) + '</optgroup>' : '')
        + '<optgroup label="' + escHtml(preset ? cfg.listLabel || t('scene')
          : loopCount ? t('All ({n}, {loops} with a loop point)', { n: a.actions.length, loops: loopCount }) : t('All ({n})', { n: a.actions.length })) + '">' + optsOf(a.actions)
        + '</optgroup></select><div class="animbtns">'
        // `<` and `>` WALK THE ACTION LIST, which is what the arrow keys already
        // do once the picker has focus - these are the same movement without
        // having to click into the dropdown first. They index the picker's own
        // options, so they follow its order exactly, duplicates in the Common
        // group included, and they clamp at the ends the way the keys do.
        + '<button class="avstep" data-dir="-1" title="Previous action">&lt;</button>'
        + '<button class="avstep" data-dir="1" title="Next action">&gt;</button>'
        + '<button class="avplay" data-state="playing" title="Pause"'
        + ' aria-label="Pause"><i></i><i></i></button>'

        // Only when the build can actually write one. The modding kit does not
        // ship the encoder, so there is nothing to offer there. This is read
        // from the SERVER'S OWN ANSWER and never passed in, so no caller - the
        // pop-out included - can put a button on screen that the build cannot
        // honor.
        + '<button class="avclsn" aria-pressed="false" title="Show collision boxes:'
        + ' red = attack (Clsn1), green = hurt (Clsn2), blue cross = the axis.'
        + ' These are what the engine actually tests, not the sprite edges.'
        + ' On a tick that skips a time-0 element, wraps or jumps, the engine tests the boxes of'
        + ' the element it moved from; its own Clsn debug view shows the drawn element&#39;s boxes there.">&#9744;</button>'
        // GIF saves with the remembered options; the arrow opens them. The
        // GIF key's tooltip is written by describeGif() once the options are
        // known, so it can say what the file will actually be.
        + (a.canGif ? '<span class="avgifset"><button class="avgif" title="Save this action as an animated GIF.">GIF</button>'
            + '<button class="avgifmore" aria-haspopup="dialog" aria-expanded="false" title="GIF options: size,'
            + ' background, speed, facing, one frame as a PNG" aria-label="GIF options"><i></i></button></span>' : '')
        + (cfg.extraButtons || '')
        + '</div>'
        + '<div class="rd">…</div>'
        // A BLANK STAND ACTION IS SAID, NOT SHOWN AS AN EMPTY STAGE: the server
        // names the action the game draws the body with (a helper's stance,
        // charBodyAction) and the player opens on it.
        + (!preset && body ? '<div class="avnote">' + escHtml(body.note) + '</div>' : '')
        + '</div></div>';

      const stage = q('.animstage'), pick = q('.avpick'), read = q('.rd');
      // The GIF keys, present only when the server said this build writes GIFs.
      const gifBtn = q('.avgif'), moreBtn = q('.avgifmore');
      // FACING, asked at every draw: the host may change it (the pair bench's
      // mirror box) and then only has to repaint.
      const facingNow = () => {
        const v = typeof cfg.facing === 'function' ? cfg.facing() : cfg.facing;
        return Number(v) === -1 ? -1 : 1;
      };
      // THE LEADERBOARD'S WIN POSE, when this build makes leaderboard art (the
      // server sends canBoardArt only then, and only for a character's own
      // list - a preset list never has one).
      const canBoard = !preset && !!a.canBoardArt;
      let boardArt = a.boardArt && typeof a.boardArt === 'object'
        ? { action: a.boardArt.action, pal: a.boardArt.pal } : { action: null, pal: null };
      // The options the GIF key saves with, re-read whenever they can have
      // changed (the popover opens, a save starts) - another window may have
      // set them since.
      let gifOpts = readGifOpts(win);
      // What the GIF key will write, in words, for its tooltip. "The size shown
      // here" only when the chosen size IS the view's scale, since the file
      // never follows the panel's fit or zoom.
      // Each choice is its own phrase (the background named whole, never a
      // button's label lowercased into the sentence).
      const describeGif = (o, z) => {
        const face = facingNow() * o.face;
        const bg = o.bg === '000000' ? t('black background') : o.bg === 'ffffff' ? t('white background')
          : o.bg === '00ff00' ? t('green background') : t('transparent background');
        const speed = o.speed === 2 ? t('half speed') : o.speed === 4 ? t('quarter speed') : t('the game’s speed');
        const size = Math.abs(z - o.scale) < 1e-6 ? t('{n}x (the size shown here)', { n: o.scale }) : t('{n}x', { n: o.scale });
        return t('Save this action as an animated GIF: {size}, {bg}, {speed}, {facing}. The arrow beside it changes these, or saves one frame as a PNG.',
          { size, bg, speed, facing: face < 0 ? t('facing left') : t('facing right') });
      };
      // `tl` is the engine's timeline for `frames` (airTimeline) and `ri` the
      // run on screen; `fi` is that run's ELEMENT, kept for every reader that
      // asks which element is showing.
      // `elemOff`: an old server's loop response is a slice of the action; its
      // numbers are shifted back to the action's own (AnimElem counts from the
      // first element, anim.go:507-520).
      let frames = null, fi = 0, playing = true, tl = null, ri = 0, elemOff = 0;
      // Boxes live in their own layer so redrawing them never touches the cel -
      // the <img> keeps its src across frames of the same sprite, and rebuilding
      // it would re-decode the PNG on every tick.
      let showClsn = false;
      const boxLayer = document.createElement('div');
      boxLayer.className = 'avboxlayer';
      boxLayer.style.cssText = 'position:absolute;left:0;top:0;right:0;bottom:0;pointer-events:none';
      // ONE box and ONE scale for the WHOLE action, worked out once when it loads.
      //
      // Sizing and centering each frame on its own was the bug behind both
      // complaints: a pose whose frames differ in size got a different scale every
      // frame, so the character pulsed (Kotaro's idle), and a pose whose frames
      // move far from the axis had its later frames placed outside the box
      // entirely (Gardevoir's). Both are fixed by measuring the union of every
      // frame first and never changing it mid-playback - which is also what the
      // engine does, since a stage does not resize itself between frames.
      let box = null, fit = 1;
      // User transform on top of the fit: drag to pan, wheel to zoom, right-click
      // to reset. Sprites are wildly different sizes and some are genuinely bigger
      // than any panel, so being able to go and look is worth more than any
      // heuristic.
      let zoom = 1, panX = 0, panY = 0;

      // ONE ODD FRAME MUST NOT SHRINK THE WHOLE POSE.
      //
      // The union of every frame is the right box in principle, and it is what
      // stopped poses pulsing and wandering out of frame. But kotaro's idle opens
      // with a 217x181 sprite and continues at ~70x113, so the union was five times
      // the area of the pose you are actually looking at and she played back at
      // half size in the corner.
      //
      // So the box is the union of the TYPICAL frames: anything more than three
      // times the median area, or less than an eighth of it, is left out and simply
      // overflows the stage, where pan and zoom can reach it. If that leaves
      // nothing - every frame an outlier of the others - fall back to the plain
      // union rather than to no box at all.
      //
      // EACH FRAME COUNTS WHERE IT IS DRAWN (runPlace): a mirrored frame
      // reaches the other side of its axis and a scaled one reaches further,
      // so an action that turns round mid-pose is framed around both sides.
      // Edges round outward to whole pixels - the same rule as the server's
      // animBox, whose box this one stands in for when the GIF is saved. A
      // frame drawn at scale 0 is not drawn, and does not count.
      function boxOf(places) {
        let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
        for (const p of places) {
          if (!p) continue;
          l = Math.min(l, Math.floor(p.l)); t = Math.min(t, Math.floor(p.t));
          r = Math.max(r, Math.ceil(p.r)); b = Math.max(b, Math.ceil(p.b));
        }
        if (l === Infinity) return null;
        return { l, t, w: Math.max(1, r - l), h: Math.max(1, b - t) };
      }
      function measure(places) {
        const drawn = places.filter(Boolean);
        if (drawn.length < 3) return boxOf(drawn);
        const area = (p) => (p.r - p.l) * (p.b - p.t);
        const areas = drawn.map(area).sort((x, y) => x - y);
        const med = areas[areas.length >> 1];
        const keep = drawn.filter((p) => {
          const a = area(p);
          return a <= med * 3 && a >= med / 8;
        });
        return boxOf(keep.length ? keep : drawn);
      }
      // HOW BIG TO DRAW IT, in one place - load() and the resize both ask here.
      //
      // The panel never magnifies past 1:1: a 25x25 sprite stretched to fill a
      // 138px square is a blur, and this is pixel art. That rule was right for
      // a 138px square and wrong for a window, where opening at 1:1 leaves the
      // character exactly as small as it was in the panel with more black
      // around it - which is the complaint the window exists to answer.
      //
      // So a magnifying player scales UP, but only by whole numbers. An integer
      // factor maps one source pixel onto an exact block of screen pixels, so
      // with image-rendering: pixelated it stays as crisp as the original; a
      // fractional one is what actually produces the blur the rule was guarding
      // against. Shrinking is unchanged - there is no crisp way to do it, and
      // fitting the action in matters more.
      const fitTo = () => {
        if (!box) return 1;
        const sw = stage.clientWidth || 118, sh = stage.clientHeight || 118;
        const raw = Math.min((sw - 8) / box.w, (sh - 8) / box.h);
        // REVERTED: the panel shrinks to fit again.
        //
        // "Never shrink" was tried - the panel pinned to exactly 1:1, big
        // characters overflowing it and reachable by drag - and taken out again
        // on request: a preview you have to pan around is not a
        // preview. It also did not fix what he was actually seeing, which is
        // the point; it was only ever a sharpness trade.
        //
        // So: fit the action in, never magnify past 1:1 here, and a magnifying
        // view takes the largest whole multiple that fits.
        const magnify = typeof cfg.magnify === 'function' ? !!cfg.magnify(sw, sh) : !!cfg.magnify;
        if (!magnify) return Math.min(1, raw);
        return raw >= 1 ? Math.floor(raw) : raw;
      };

      // ONE <img>, reused. Rebuilding it per frame re-requests the src, which for a
      // frame the .sff does not have means a fresh 404 sixty times a second.
      const cel = doc.createElement('img');
      cel.onerror = () => { cel.style.visibility = 'hidden'; };
      cel.onload = () => { cel.style.visibility = ''; };
      stage.appendChild(cel);
      stage.appendChild(boxLayer);

      // The axis marker. Hidden until a drag starts.
      const axis = doc.createElement('div');
      axis.className = 'avaxis';
      axis.hidden = true;
      axis.innerHTML = '<i class="h"></i><i class="v"></i><i class="o"></i>';
      stage.appendChild(axis);
      // WHERE THE ANCHOR IS ON SCREEN. Every frame is drawn at
      // ((f.x - f.axisX) - box.l) * z from the left edge of the box, so the
      // character's origin - the point the engine plants - is whatever that
      // expression gives for an offset of zero. It does not depend on the
      // frame, which is the whole reason it is worth drawing.
      //
      // FACING LEFT MIRRORS THE WORLD ABOUT THE AXIS, so the box does too:
      // [l, l + w] becomes [-(l + w), -l]. `box` itself stays the facing-right
      // box - it is what the GIF request sends, with facing=-1 beside it.
      const viewBox = () => (box && facingNow() < 0 ? { l: -(box.l + box.w), t: box.t, w: box.w, h: box.h } : box);
      const placeAxis = () => {
        if (!box) return;
        const sw = stage.clientWidth || 118, sh = stage.clientHeight || 118;
        const z = fit * zoom;
        const vb = viewBox();
        axis.style.left = Math.round((sw - vb.w * z) / 2 + panX - vb.l * z) + 'px';
        axis.style.top = Math.round((sh - vb.h * z) / 2 + panY - vb.t * z) + 'px';
      };

      // STOPPING HAS TO INVALIDATE THE CHAIN, not just drop one handle.
      //
      // `timer` is a single variable and `load()` is async: two overlapping loads
      // each reached tick() and each re-armed its own setTimeout, with the second
      // assignment clobbering the first's handle. Every chain past the first was
      // then unreferenced and unstoppable - measured at six pending chains after
      // six quick presses, with Pause stopping exactly one of them and the readout
      // still advancing afterwards. Only a character change cleared it, because
      // the generation was bumped for characters and never for actions.
      //
      // A generation counter fixes it without threading state through tick(): every
      // scheduled step remembers which chain it belongs to and a superseded one
      // returns without rescheduling.
      const stop = () => { clearTimeout(timer); timer = null; chain++; };
      // WHAT A RUN PUTS ON SCREEN. The element gives the offset, the boxes and
      // the number; the sprite is whichever element's the engine last loaded,
      // which is the element itself except in the corners airTimeline
      // describes - and on a run where nothing is loaded yet, nothing is drawn.
      const runOf = () => (tl && tl.runs.length ? tl.runs[Math.min(ri, tl.runs.length - 1)] : null);
      // The pictures the timeline actually shows, for the box: an element the
      // engine never draws must not size or shift the ones it does.
      // Each is where the run is drawn (runPlace), null when it draws nothing.
      const shownFrames = () => {
        const out = [], seen = new Set();
        for (const r of tl.runs) {
          if (r.spr < 0 || seen.has(r.elem + ':' + r.spr)) continue;
          seen.add(r.elem + ':' + r.spr);
          out.push(runPlace(frames[r.elem], frames[r.spr]));
        }
        return out;
      };
      // The runs worth stopping on when stepping: every one that draws a
      // sprite. A run with nothing loaded yet is only a stop when there is
      // nothing else, so an action the engine never draws still has a place.
      const stepsOf = () => {
        const st = [];
        tl.runs.forEach((r, k) => { if (r.spr >= 0) st.push(k); });
        return st.length ? st : [0];
      };
      const show = () => {
        if (!frames || !frames.length || !box) return;
        const run = runOf();
        if (!run) return;
        fi = run.elem;
        const f = frames[run.elem];
        const s = run.spr >= 0 ? frames[run.spr] : null;
        const sw = stage.clientWidth || 118, sh = stage.clientHeight || 118;
        const z = fit * zoom;
        const fx = facingNow(), vb = viewBox();
        // Every frame is placed inside the SAME box, so the pose plays out within
        // one fixed frame instead of each frame re-centering itself.
        const ox = (sw - vb.w * z) / 2 + panX;
        const oy = (sh - vb.h * z) / 2 + panY;
        // A preset entry may draw with another character's sprite file.
        const owner = curEntry ? (curEntry.sprites || curEntry.char || id) : id;
        // WHERE THE ENGINE DRAWS IT (runPlace): null for a sprite the file
        // lacks (it keeps its src, which fails and hides the cel, so the
        // readout and the request say which sprite is missing) and for a frame
        // at scale 0, which the engine does not draw at all.
        const place = s ? runPlace(f, s) : null;
        if (s && (place || !(s.w && s.h))) {
          const src = spriteUrl(owner, [s.group, s.index]);
          if (cel.getAttribute('src') !== src) cel.setAttribute('src', src);
          if (place) {
            // THE IMG SITS ON THE DRAWN BOUNDS and a flip turns it over in
            // place: mirroring about the axis is exactly "occupy the mirrored
            // span, pixels reversed", so the transform's origin can stay the
            // middle and the rounding stays the unflipped one's. Facing left
            // mirrors the span about the axis and turns the picture over once
            // more. Unflipped and unscaled this is the old placement,
            // x - axisX, to the pixel.
            const l = fx < 0 ? -place.r : place.l;
            cel.style.left = Math.round(ox + (l - vb.l) * z) + 'px';
            cel.style.top = Math.round(oy + (place.t - vb.t) * z) + 'px';
            cel.style.width = Math.max(1, Math.round((place.r - place.l) * z)) + 'px';
            cel.style.height = Math.max(1, Math.round((place.b - place.t) * z)) + 'px';
            const mx = (place.sx < 0) !== (fx < 0), my = place.sy < 0;
            cel.style.transform = mx || my ? 'scale(' + (mx ? -1 : 1) + ', ' + (my ? -1 : 1) + ')' : '';
          } else {
            cel.style.left = Math.round(ox + ((f.x - s.axisX) - vb.l) * z) + 'px';
            cel.style.top = Math.round(oy + ((f.y - s.axisY) - vb.t) * z) + 'px';
            cel.style.width = '1px';
            cel.style.height = '1px';
            cel.style.transform = '';
          }
          // The blend, as close as CSS comes (blendStyle says how close).
          const bs = blendStyle(place ? f.blend : null);
          cel.style.mixBlendMode = bs.mode;
          cel.style.opacity = bs.opacity;
          cel.style.filter = bs.filter;
        } else {
          // Removed, not just hidden - see load(): the next sprite then gets a
          // fresh onload, which is what makes it visible again.
          cel.style.visibility = 'hidden';
          cel.removeAttribute('src');
        }

        // THE BOXES ARE MEASURED FROM THE AXIS, NOT FROM THE SPRITE'S CORNER.
        //
        // The axis is the character's position: (0,0) in .air space, the same
        // point placeAxis() marks. The element's x/y offset moves the SPRITE only
        // (anim.go:961, 1090 - the cel above is placed at f.x - f.axisX); the
        // engine draws and tests Clsn at the position plus size.draw.offset and
        // the Offset controller (char.go:12820-12823, offsetX 10276-10282), so a
        // frame with an offset shows its sprite moved and its boxes where they
        // really are.
        //
        // .air y grows DOWNWARD but a box is written head-first, so y1 is
        // routinely the larger (a standing hurtbox is `0, -80` to `19, 0`).
        // Normalizing both axes is what stops half the boxes rendering inside
        // out, i.e. invisibly.
        boxLayer.textContent = '';
        if (showClsn) {
          const axX = ox + (0 - vb.l) * z;
          const axY = oy + (0 - vb.t) * z;
          // Facing left mirrors the boxes about the axis too (char.go:7854-7875
          // puts the facing on the Clsn scale); the frame's own flip never
          // touches them.
          const add = (b, cls) => {
            const l = fx < 0 ? -Math.max(b.x1, b.x2) : Math.min(b.x1, b.x2), t = Math.min(b.y1, b.y2);
            const w = Math.abs(b.x2 - b.x1), h = Math.abs(b.y2 - b.y1);
            // Screen space, before clamping.
            let x0 = axX + l * z, y0 = axY + t * z;
            let x1 = x0 + Math.max(1, w * z), y1 = y0 + Math.max(1, h * z);
            // CLAMP INTO THE STAGE. The stage clips (overflow:hidden), so an edge
            // that lies outside simply never renders - which is why a box larger
            // than the view showed nothing but its fill. Pulling the edges to the
            // boundary puts them back on screen, and marking WHICH ones were
            // pulled keeps it honest about where the box really ends.
            const cl = x0 < 0, ct = y0 < 0, cr = x1 > sw, cb = y1 > sh;
            x0 = Math.max(0, x0); y0 = Math.max(0, y0);
            x1 = Math.min(sw, x1); y1 = Math.min(sh, y1);
            if (x1 <= x0 || y1 <= y0) return;      // nothing of it is in view
            const d = document.createElement('div');
            // "Huge" is about how much of the VIEW it takes, not its own size: a
            // box covering nearly everything tells you nothing by being filled.
            const covers = ((x1 - x0) * (y1 - y0)) / Math.max(1, sw * sh);
            d.className = 'avbox ' + cls
              + (covers > 0.8 ? ' huge' : '')
              + (cl ? ' clipL' : '') + (cr ? ' clipR' : '')
              + (ct ? ' clipT' : '') + (cb ? ' clipB' : '');
            d.style.left = Math.round(x0) + 'px';
            d.style.top = Math.round(y0) + 'px';
            d.style.width = Math.max(1, Math.round(x1 - x0)) + 'px';
            d.style.height = Math.max(1, Math.round(y1 - y0)) + 'px';
            boxLayer.appendChild(d);
          };
          // The boxes of the element the engine tests on this tick, which is
          // the one curelem held before the tick's UpdateSprite moved it
          // (airTimeline `clsn`; char.go:12195, 12472-12477).
          const fc = frames[run.clsn !== undefined ? run.clsn : run.elem] || f;
          for (const b of (fc.clsn2 || [])) add(b, 'c2');
          for (const b of (fc.clsn1 || [])) add(b, 'c1');
          const ax = document.createElement('div');
          ax.className = 'avaxis';
          ax.style.left = Math.round(axX) + 'px';
          ax.style.top = Math.round(axY) + 'px';
          boxLayer.appendChild(ax);
        }
        // NEAREST-NEIGHBOR IS FOR MAGNIFYING. IT MANGLES ANYTHING SHRUNK.
        //
        // fitTo() no longer shrinks anything, so the only way below 1:1 now is
        // for the viewer to deliberately wheel out - and that is worth keeping
        // honest rather than sharp. Nearest minification does not average; it
        // picks one source pixel per destination pixel and bins the rest. At
        // 42% that is 58% of the columns discarded and 30% of the silhouette
        // gone (284 opaque pixels against 408 smooth), and because WHICH
        // columns survive depends on where the sprite lands - which moves every
        // frame - a half-pixel shift flipped 20% of the silhouette on or off.
        // Hard on/off pops per shrink level measured 139-532 with nearest
        // against 0-77 smooth.
        //
        // Snapping the shrink to an exact 1/2 or 1/3 does NOT rescue it: at 50%
        // nearest scored 532 pops, worse than an arbitrary 42% at 349. Snapping
        // the scale does not snap the phase, because the sprite still moves by
        // odd amounts between frames.
        //
        // So: magnify with nearest, which is what pixel art wants and what the
        // whole-multiple fit exists for. If someone chooses to go below 1:1,
        // smooth it rather than hand them a strobing skeleton. Set per draw
        // because zoom is live.
        cel.style.imageRendering = z >= 1 ? 'pixelated' : 'auto';
        // THE TRUE ELEMENT NUMBER, out of every element: a hidden element still
        // holds its number (AnimElem counts it), so the frame after one reads
        // 3/8, not 2/7.
        // One phrase per fact, in the reader's language; the · between them is
        // punctuation.
        const facts = [t('frame {n}/{of}', { n: run.elem + 1 + elemOff, of: frames.length + elemOff }),
          s ? t('spr {group},{index}', { group: s.group, index: s.index }) : t('nothing drawn'), t('{n}t', { n: f.time })];
        // WHY THIS FRAME DID NOT CHANGE COLOR. Effects, projectiles and borrowed
        // win-pose art carry their own palette and the engine leaves them alone;
        // forcing the pick onto them is what corrupted them. Only worth saying
        // while a palette is actually picked.
        if (palOf(id) !== undefined && s && s.follows === false) facts.push(t('own palette'));
        // The EFFECTIVE scale, not the user's zoom factor: "21%" says this sprite
        // is a fifth of its real size, which is the fact worth knowing.
        facts.push(Math.round(z * 100) + '%');
        read.textContent = facts.join(' · ');
        // Only while it is on screen - a drag repaints on every mousemove.
        if (!axis.hidden) placeAxis();
        // The GIF key says what it will save, including whether that is the
        // size on screen - which changes with the fit and the wheel.
        if (gifBtn) {
          const t = describeGif(gifOpts, z);
          if (gifBtn.title !== t) gifBtn.title = t;
        }
      };
      const tick = () => {
        if (dead) return stop();
        // NOTHING TO PLAY YET IS NOT AN ERROR. show() already guards this and
        // returns quietly; the line below did not, so calling tick() before the
        // first action had loaded threw on `frames` being null - and took the
        // rest of the panel's setup down with it, including the initial load().
        // The panel then came up blank and stayed blank until the picker was
        // touched, because onchange was the only other route into load().
        if (!frames || !frames.length || !tl || !tl.runs.length) return stop();
        show();
        const run = runOf();
        // The engine has stopped: a last -1 holds forever, a still pose. Only
        // the LAST run of a held timeline - a -1 anywhere else is not a hold.
        if (tl.hold && ri >= tl.runs.length - 1) return stop();
        // `ri` IS THE RUN ON SCREEN, always. It used to be advanced here, right
        // after drawing, which made it an advance POINTER sitting one past the
        // picture - so pausing left them disagreeing, the first `>` skipped a
        // frame and the first `<` redrew the one already showing. Advancing inside
        // the timeout instead keeps the variable and the picture the same thing,
        // which is what every reader of `fi` already assumed.
        //
        // Capped because a timer over 2^31-1 ms fires at once: makoto's action
        // 5300 ends on an 807,414,841-tick element, which is a hold in practice.
        const my = chain;
        timer = setTimeout(() => {
          if (my !== chain) return;             // a newer load or a Pause won
          ri = ri + 1 < tl.runs.length ? ri + 1 : tl.loopFrom;
          tick();
        }, Math.min(2147483647, run.ticks * (1000 / 60)));
      };
      // The picker's value is either "20" or "20:loop".
      const parseSel = (v) => {
        const p = String(v).split(':');
        return { action: p[0], loop: p[1] === 'loop' };
      };
      const load = async (sel) => {
        stop();
        // EACH LOAD HOLDS ITS OWN TICKET. stop() kills the timer but cannot
        // cancel a fetch already in the air, and the old guard only compared the
        // CHARACTER generation - which does not move when you pick another
        // action. Two quick picks therefore raced, and a slow first response
        // could land after the second and draw the wrong action.
        const mine = ++loadGen;
        const w = parseSel(sel);
        // THE WHOLE ACTION IS FETCHED FOR BOTH ENTRIES. The loop the engine
        // plays keeps the whole action's totals - curtime restarts at
        // totaltime - looptime, a -1 before Loopstart restarts the sums, a
        // Loopstart on hidden elements lands on the last element wearing the
        // sprite loaded before it (anim.go:428-452, 638-665, 837-840) - so a
        // slice from Loopstart replayed on its own is not that loop.
        let url = '/api/char-anim?char=' + encodeURIComponent(id)
          + '&action=' + w.action;
        let entry = null;
        if (preset) {
          entry = preset[parseInt(String(w.action).slice(1), 10)] || null;
          if (!entry) return;
          const from = entry.char || id, with_ = entry.sprites || from;
          url = cfg.animUrl ? cfg.animUrl(entry, false)
            : '/api/char-anim?char=' + encodeURIComponent(from) + '&action=' + entry.action
              + (with_ !== from ? '&sprites=' + encodeURIComponent(with_) : '');
        }
        let r = null;
        try { r = await (await fetch(url)).json(); } catch (e) { r = null; }
        if (dead || mine !== loadGen) return;
        // A Play pressed while this was in the air started a timer on the
        // previous action; this load owns the clock now.
        stop();
        // The server's own words when it has them (a sprite owner whose file
        // could not be read), never a blank stage pretending to be a vanish.
        if (!r || r.error || !r.frames) { read.textContent = (r && r.error) ? String(r.error) : 'unreadable'; return; }
        curEntry = entry;
        frames = r.frames;
        // The full entry plays the action from its start with its real
        // Loopstart up to where the engine first loops, then from the start
        // again; the loop entry is the engine's steady cycle (airEntries).
        elemOff = 0;
        if (r.looped) { elemOff = Number(r.loopStart) || 0; tl = airTimeline(frames.map((f) => f.time), 0); }
        else {
          const ent = airEntries(frames.map((f) => f.time), Number(r.loopStart) || 0);
          tl = w.loop ? ent.loop : ent.full;
        }
        // Playing, it starts where the engine does - tick 1, whatever that
        // shows. Paused, it opens on the first run that draws something.
        ri = playing ? 0 : stepsOf()[0];
        fi = tl.runs.length ? tl.runs[ri].elem : 0;
        box = measure(shownFrames());
        fit = fitTo();
        zoom = 1; panX = 0; panY = 0;
        // An open popover's win-pose box is about the action on screen.
        if (pop && !pop.hidden) syncPop();
        // NOTHING TO DRAW IS A FINDING, NOT A BLANK. Two different findings:
        // an action written as `-1,0` holds draws nothing on purpose (the
        // standard invisible hold, what a giver puts a victim into while his
        // own sprite draws both bodies); an action whose named sprites are all
        // absent from the file is a rebuild that dropped the art, or a giver's
        // action on a victim who lacks the group - a vanish in the match. Say
        // which, instead of leaving the readout on its ellipsis.
        //
        // The cel's src is REMOVED, not just hidden: a hidden cel with its old
        // src stays hidden until show() changes the src, so the next entry
        // reusing the same sprite would never reappear - and a PNG still in
        // flight for the previous entry would un-hide it under this readout.
        // Removing the src cancels that load and guarantees a fresh onload.
        //
        // A third: the engine never loads a sprite at all, because every element
        // it lands on has time 0 (a lone `0` time, every time 0) - it draws
        // nothing whatever the sprite file holds.
        if (!box) {
          cel.style.visibility = 'hidden';
          cel.removeAttribute('src');
          boxLayer.textContent = '';
          const drawnRuns = tl.runs.filter((x) => x.spr >= 0);
          const drawn = drawnRuns.map((x) => frames[x.spr]);
          const named = drawn.filter((f) => f.group >= 0).length;
          // A fourth: the sprites are there and the element scales them to 0
          // (isBlank, anim.go:490-492) - hidden by the author, not missing.
          const zero = drawnRuns.some((x) => { const sp = frames[x.spr]; return sp && sp.w && sp.h; });
          // The loop entry covers only the elements its runs show (the rest of
          // the action is fetched for its numbering and totals): a loop of one
          // missing sprite is "1 frame", not the whole action's count.
          const count = w.loop && !r.looped ? new Set(tl.runs.map((x) => x.elem)).size : frames.length;
          const n = { frames: count === 1 ? t('1 frame') : t('{n} frames', { n: count }) };
          read.textContent = !drawn.length && tl.runs.length ? t('{frames}, none ever displayed (time 0): draws nothing', n)
            : zero ? t('{frames}, drawn at scale 0: draws nothing', n)
              : named ? t('{frames}, none in the sprite file: vanishes', n) : t('{frames}, all blank (-1): draws nothing', n);
          return;
        }
        if (playing) tick(); else show();
      };
      // ---- pan and zoom ----
      let dragging = false, dx = 0, dy = 0;
      stage.onmousedown = (e) => {
        if (e.button !== 0) return;
        dragging = true; dx = e.clientX - panX; dy = e.clientY - panY;
        stage.style.cursor = 'grabbing';
        // Up on grab, placed immediately - a press with no movement still shows
        // it, which is the cheapest way to ask "is it really moving?"
        if (box) { axis.hidden = false; placeAxis(); }
        e.preventDefault();
      };
      // ON THE WINDOW, AND THEREFORE REMOVED ON THE WAY OUT. A drag that leaves
      // the stage still has to be followed, so these cannot live on the stage -
      // but the old panel added a fresh pair on every character switch and
      // removed none, leaving a session's worth of handlers all still writing
      // pan offsets into stages that had long since been thrown away.
      const onMove = (e) => {
        if (!dragging) return;
        panX = e.clientX - dx; panY = e.clientY - dy;
        show();
      };
      const onUp = () => {
        if (!dragging) return;
        dragging = false; stage.style.cursor = '';
        axis.hidden = true;
      };
      win.addEventListener('mousemove', onMove);
      win.addEventListener('mouseup', onUp);
      offs.push(() => win.removeEventListener('mousemove', onMove));
      offs.push(() => win.removeEventListener('mouseup', onUp));
      stage.onwheel = (e) => {
        e.preventDefault();
        // Zoom toward the pointer rather than the center, so you can push in on a
        // hand or a hitbox without losing it off the edge.
        const rect = stage.getBoundingClientRect();
        const cx = e.clientX - rect.left - rect.width / 2 - panX;
        const cy = e.clientY - rect.top - rect.height / 2 - panY;
        const before = zoom;
        zoom = Math.max(0.25, Math.min(12, zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
        const k = zoom / before;
        panX -= cx * (k - 1);
        panY -= cy * (k - 1);
        show();
      };
      stage.oncontextmenu = (e) => { e.preventDefault(); zoom = 1; panX = 0; panY = 0; show(); };

      // A STAGE THAT CAN CHANGE SIZE HAS TO RE-FIT: a window being resized, and
      // the Studio's panel, whose stage follows the panel's width. The user's
      // zoom is kept, and so is the point they were looking at: pan is in screen
      // pixels, so it scales with the fit (the point at the stage's center
      // satisfies pan + (p - c) * fit * zoom = 0).
      if (root.ResizeObserver) {
        const ro = new root.ResizeObserver(() => {
          if (dead || !box) return;
          const was = fit;
          fit = fitTo();
          if (was > 0 && fit !== was) { panX *= fit / was; panY *= fit / was; }
          show();
        });
        ro.observe(stage);
        offs.push(() => ro.disconnect());
      }

      pick.onchange = () => load(pick.value);
      // ONE place decides what the transport looks like, so the icon can never
      // disagree with whether the timer is actually running.
      // PAINTING THE CONTROLS AND STARTING THE CLOCK ARE TWO THINGS.
      // They were one, so stating the mode at build time also started a timer -
      // before there was anything to play. Only the painting half runs at build.
      const paintMode = () => {
        const b = q('.avplay');
        b.dataset.state = playing ? 'playing' : 'paused';
        b.title = playing ? 'Pause' : 'Play';
        b.setAttribute('aria-label', b.title);
        // WHAT THE ARROWS MEAN, stated in one place so the color, the tooltip
        // and the behavior cannot disagree. Running: another action. Stopped:
        // another frame.
        const row = q('.animbtns');
        if (row) row.dataset.mode = playing ? 'action' : 'frame';
        for (const el of host.querySelectorAll('.avstep')) {
          const next = el.dataset.dir === '1';
          const says = playing ? (next ? t('Next action') : t('Previous action')) : (next ? t('Next frame') : t('Previous frame'));
          el.title = playing ? says : t('{label}  (← → on the picture too)', { label: says });
          el.setAttribute('aria-label', says);
        }
      };
      const setPlaying = (on) => {
        playing = on;
        paintMode();
        if (on) tick(); else stop();
      };
      q('.avplay').onclick = () => setPlaying(!playing);
      // The toggle redraws immediately rather than waiting for the next tick,
      // so it still responds when the animation is paused - which is exactly
      // when someone is studying a single frame's boxes.
      const clsnBtn = q('.avclsn');
      if (clsnBtn) {
        clsnBtn.onclick = () => {
          showClsn = !showClsn;
          clsnBtn.setAttribute('aria-pressed', showClsn ? 'true' : 'false');
          clsnBtn.innerHTML = showClsn ? '&#9635;' : '&#9744;';
          show();
        };
      }

      // ANOTHER ACTION. Moves the picker by one option and loads it, which is
      // exactly what an arrow key does once the picker has focus.
      const pickBy = (d) => {
        const n = pick.options.length;
        const at = Math.max(0, Math.min(n - 1, pick.selectedIndex + d));
        if (at === pick.selectedIndex) return;      // clamped, like the keys
        pick.selectedIndex = at;
        load(pick.value);
      };
      // ONE MEANING FOR BOTH THE BUTTONS AND THE KEYS, so there is only ever one
      // thing to learn: while it runs they move through the action list, and once
      // it is stopped they move through the frames of the action you stopped on.
      const arrow = (d) => (playing ? pickBy(d) : step(d));
      for (const el of host.querySelectorAll('.avstep')) {
        const d = Number(el.dataset.dir) || 1;
        el.onclick = () => arrow(d);
      }

      // ANOTHER FRAME. Stepping is a deliberate look at one frame, so it pauses
      // first - stepping against a running timer just fights it. Wraps both ways,
      // so going back from frame 0 lands on the last frame instead of doing
      // nothing.
      //
      // IT STEPS THROUGH WHAT PLAYBACK SHOWS, in the order it shows it: an
      // element the engine never draws is never a stop, and the numbers skip it
      // (1/3 then 3/3). Standing on a run that is not a stop - the blank first
      // tick of some actions - the next stop is the first one after it.
      const step = (d) => {
        if (playing) setPlaying(false); else stop();
        if (!frames || !frames.length || !tl || !tl.runs.length) return;
        const st = stepsOf();
        const k = st.indexOf(ri);
        if (k >= 0) ri = st[((k + d) % st.length + st.length) % st.length];
        else if (d < 0) { const before = st.filter((j) => j < ri); ri = before.length ? before[before.length - 1] : st[st.length - 1]; }
        else { const after = st.filter((j) => j > ri); ri = after.length ? after[0] : st[0]; }
        show();
      };

      // THE KEYS DO WHAT THE BUTTONS DO. Bound to the STAGE, not the window: in
      // the picker these keys already mean "another action" and that is not ours
      // to take. Click the picture once and they are yours - and only yours: a
      // host page may listen on window for the same keys (the Studio's roster
      // walks its characters on the arrows), so a key the stage used stops here.
      stage.tabIndex = 0;
      stage.addEventListener('keydown', (e) => {
        if (e.key === ' ' || e.key === 'Spacebar') { e.preventDefault(); e.stopPropagation(); setPlaying(!playing); return; }
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault();
        e.stopPropagation();
        arrow(e.key === 'ArrowRight' ? 1 : -1);
      });
      // Paint the controls once at build time so the color and the tooltips are
      // right before anything is clicked. NOT setPlaying: that starts the clock,
      // and there is nothing loaded to play yet.
      paintMode();
      // SAVE WHAT IS ON SCREEN. The box this panel worked out is sent with the
      // request, so the file is framed the way the preview is rather than the
      // server forming a second opinion. The palette pick rides along too.
      //
      // Fetched rather than linked, because the response is what says whether it
      // worked: an action with nothing drawable comes back as JSON saying why,
      // and a plain <a href> would have silently downloaded the error message
      // as a .gif.
      //
      // THE OPTIONS RIDE ON TOP (the popover below): size, background, speed,
      // facing. Each is sent only when it is not the default, so a GIF saved
      // with the defaults is the same request - and the same file - as before
      // there were options. Facing is the host's (the bench's mirror box) times
      // the popover's: the file follows what is on screen, and "Left" turns it
      // round once more. The box is always the facing-right one; the server
      // mirrors the finished picture.
      //
      // gifRequest(o, stillRun) -> { qs, name }: stillRun is the run on screen
      // for a one-frame PNG (still=, an index into the entry's runs - `ri` - the
      // list airEntries gives the server too), undefined for the GIF.
      const gifRequest = (o, stillRun) => {
        const w = parseSel(pick.value);
        // A preset entry names the action's owner and the sprite owner;
        // the palette pick is the SPRITE owner's, since it is her art.
        const from = curEntry ? (curEntry.char || id) : id;
        const with_ = curEntry ? (curEntry.sprites || from) : id;
        const action = curEntry ? curEntry.action : w.action;
        const p = palOf(with_);
        const face = facingNow() * o.face;
        const still = stillRun !== undefined;
        // Speed changes no picture, so a still does not carry it (nor its
        // name's -half).
        const speed = still ? 1 : o.speed;
        const qs = '/api/char-anim-gif?char=' + encodeURIComponent(from)
          + '&action=' + encodeURIComponent(action) + (w.loop ? '&loop=1' : '')
          + (with_ !== from ? '&sprites=' + encodeURIComponent(with_) : '')
          + (p !== undefined ? '&pal=' + encodeURIComponent(p) : '')
          + (box ? '&l=' + box.l + '&t=' + box.t + '&w=' + box.w + '&h=' + box.h : '')
          + (showClsn ? '&clsn=1' : '')
          + (o.scale > 1 ? '&scale=' + o.scale : '')
          + (o.bg ? '&bg=' + o.bg : '')
          + (speed > 1 ? '&speed=' + speed : '')
          + (face < 0 ? '&facing=-1' : '')
          + (still ? '&still=' + stillRun : '');
        // The server names the file (it knows the size it could actually
        // use); this is the same pattern, for a response that does not say.
        // <char>-<action>[-on-<sprites>][-loop][-pal<n>][-<k>x][-left][-half|-quarter]
        const name = from + '-' + action + (with_ !== from ? '-on-' + with_ : '') + (w.loop ? '-loop' : '')
          + (p !== undefined ? '-pal' + p : '') + (o.scale > 1 ? '-' + o.scale + 'x' : '') + (face < 0 ? '-left' : '')
          + (speed === 2 ? '-half' : speed === 4 ? '-quarter' : '') + (still ? '.png' : '.gif');
        return { qs, name };
      };
      // ONE SAVE, for the GIF key and the popover's frame button. `btn` shows
      // the wait; the toast reports what was written and what the file could
      // not draw the engine's way (X-Gif-Notes: URI-encoded, "; " between).
      const save = async (btn, stillRun) => {
        if (!btn || btn.disabled) return;
        const was = btn.textContent;
        btn.disabled = true;
        btn.textContent = '…';
        try {
          gifOpts = readGifOpts(win);
          const req = gifRequest(gifOpts, stillRun);
          const r = await fetch(req.qs);
          if (!r.ok) {
            let msg = stillRun === undefined ? 'could not build a GIF' : 'could not save this frame';
            try { msg = (await r.json()).error || msg; } catch (e) { /* not JSON */ }
            throw new Error(msg);
          }
          const blob = await r.blob();
          const hd = (k) => r.headers.get(k) || '';
          const n = hd('X-Gif-Frames'), ms = Number(hd('X-Gif-Ms')) || 0, k = Number(hd('X-Gif-Scale')) || 1;
          let notes = [];
          try { notes = decodeURIComponent(hd('X-Gif-Notes')).split('; ').filter(Boolean); } catch (e) { notes = []; }
          const named = /filename="([^"]+)"/.exec(hd('Content-Disposition'));
          const href = URL.createObjectURL(blob);
          const a2 = doc.createElement('a');
          a2.href = href;
          a2.download = named ? named[1] : req.name;
          doc.body.appendChild(a2);
          a2.click();
          a2.remove();
          // Revoked on a delay: revoking immediately races the download starting.
          setTimeout(() => URL.revokeObjectURL(href), 60000);
          const run = runOf();
          const said = [stillRun === undefined
            ? t('Saved {n} frames · {s}s', { n, s: (ms / 1000).toFixed(2) })
            : t('Saved frame {n}/{of} as a PNG', { n: (run ? run.elem : fi) + 1 + elemOff, of: (frames ? frames.length : 0) + elemOff })];
          if (k > 1) said.push(t('{n}x', { n: k }));
          said.push(t('{n} KB', { n: Math.round(blob.size / 1024) }));
          // the server's notes on what the file could not draw the engine's way
          if (notes.length) said.push(notes.map(serverText).join('; '));
          say(said.join(' · '), notes.length ? 'warn' : undefined);
        } catch (e) {
          say(e.message, 'err');
        } finally {
          btn.disabled = false;
          btn.textContent = was;
        }
      };
      if (gifBtn) gifBtn.onclick = () => save(gifBtn);

      // ---- the options popover ----
      //
      // Built on first open and PARENTED OUTSIDE THE PLAYER: the panel's stage
      // is 138px and clips, so the popover is fixed to the viewport, placed
      // clear of the stage (below it or above it, whichever fits), and left
      // there as one floating layer. Inside a modal <dialog> (the pair bench)
      // it goes in the dialog, because everything outside an open modal is
      // inert. A radio group per option, so the keyboard works the way it does
      // on any form: Tab between groups, arrows within one; Escape or a click
      // anywhere else closes it and gives the arrow key its focus back.
      let pop = null;
      const popOffs = [];
      const boardAction = () => {
        const n = parseInt(String(parseSel(pick.value).action), 10);
        return Number.isInteger(n) ? n : null;
      };
      const syncPop = () => {
        if (!pop) return;
        gifOpts = readGifOpts(win);
        for (const inp of pop.querySelectorAll('input[type="radio"]')) {
          const k = inp.dataset.k;
          inp.checked = String(gifOpts[k]) === inp.value;
        }
        const chk = pop.querySelector('.avboardchk');
        if (chk) {
          const n = boardAction();
          chk.checked = n !== null && boardArt.action === n;
          const lab = pop.querySelector('.avboard');
          if (lab) {
            const at = { n: String(n), pal: boardArt.pal };
            lab.title = chk.checked
              ? (boardArt.pal !== null && boardArt.pal !== undefined ? t('The leaderboard art uses action {n} in palette {pal}. Uncheck to let the export pick the win pose again.', at)
                : t('The leaderboard art uses action {n} in the default colors. Uncheck to let the export pick the win pose again.', at))
              : t('Use action {n} as this character’s pose on the leaderboard, in the palette picked now (or the default colors when none is). The next export that makes the leaderboard art draws it.', at);
          }
        }
      };
      const placePop = () => {
        if (!pop || pop.hidden) return;
        const m = 8;
        const vw = win.innerWidth || doc.documentElement.clientWidth, vh = win.innerHeight || doc.documentElement.clientHeight;
        const b = moreBtn.getBoundingClientRect(), s = stage.getBoundingClientRect();
        const pw = pop.offsetWidth, ph = pop.offsetHeight;
        const left = Math.max(m, Math.min(b.right - pw, vw - m - pw));
        // Under the key when that is clear of the stage, else under the
        // stage; failing that above them; failing both, as near the key as
        // the window allows.
        const overlapsX = left < s.right && left + pw > s.left;
        const below = (overlapsX ? Math.max(b.bottom, s.bottom) : b.bottom) + 4;
        const above = (overlapsX ? Math.min(b.top, s.top) : b.top) - 4 - ph;
        let top;
        if (below + ph <= vh - m) top = below;
        else if (above >= m) top = above;
        else top = Math.max(m, b.top - 4 - ph >= m ? b.top - 4 - ph : vh - m - ph);
        pop.style.left = Math.round(left) + 'px';
        pop.style.top = Math.round(top) + 'px';
      };
      const closePop = (refocus) => {
        if (!pop || pop.hidden) return;
        pop.hidden = true;
        moreBtn.setAttribute('aria-expanded', 'false');
        for (const off of popOffs.splice(0)) off();
        if (refocus) moreBtn.focus();
      };
      const buildPop = () => {
        const serial = ++popSerial;
        pop = doc.createElement('div');
        pop.className = 'avgifpop';
        pop.id = 'avgifpop' + serial;
        pop.hidden = true;
        pop.setAttribute('role', 'dialog');
        pop.setAttribute('aria-label', 'GIF options');
        const group = (k, legend, title, choices) => '<fieldset title="' + title + '"><legend>' + legend + '</legend><div class="seg">'
          + choices.map(([v, t]) => '<label><input type="radio" name="avgif' + serial + k + '" data-k="' + k + '" value="' + v + '"><span>' + t + '</span></label>').join('')
          + '</div></fieldset>';
        // Only fixed words go through innerHTML here.
        pop.innerHTML = group('scale', t('Size'), 'Whole-number steps, pixel for pixel. The file never passes 2048 pixels a side.', GIF_SIZES)
          + group('bg', t('Background'), 'Transparent can only approximate a glow or a shadow (the engine blends them with what is behind); on a solid color they come out as in the game. Black is right for glows; green keys out in a video editor.', GIF_BGS)
          + group('speed', t('Speed'), 'Half and quarter slow every tick. A held last frame keeps its two-second beat.', GIF_SPEEDS)
          + group('face', t('Face'), 'Left mirrors the whole picture about the axis, collision boxes included: the way the character faces from the right side.', GIF_FACES)
          + (canBoard ? '<label class="chk avboard"><input type="checkbox" class="avboardchk"> Leaderboard win pose</label>' : '')
          + '<button type="button" class="avstill" title="The frame on screen now, with these options, as a PNG. Pause and step with the arrows to choose it.">Save this frame (PNG)</button>';
        (host.closest && host.closest('dialog')) ? host.closest('dialog').appendChild(pop) : doc.body.appendChild(pop);
        pop.addEventListener('change', (e) => {
          const t = e.target;
          if (t && t.type === 'radio' && t.checked) {
            const o = readGifOpts(win);
            o[t.dataset.k] = t.dataset.k === 'bg' ? t.value : Number(t.value);
            writeGifOpts(win, o);
            gifOpts = readGifOpts(win);
            show();
          }
        });
        // Keys typed in the popover are the popover's: the arrows move within
        // a group and must not also walk the roster or step the animation.
        pop.addEventListener('keydown', (e) => {
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePop(true); return; }
          if (/^Arrow|^(Home|End| )$/.test(e.key)) e.stopPropagation();
        });
        pop.addEventListener('focusout', (e) => {
          const to = e.relatedTarget;
          if (to && !pop.contains(to) && to !== moreBtn) closePop(false);
        });
        const still = pop.querySelector('.avstill');
        still.onclick = () => save(still, Math.min(ri, tl && tl.runs.length ? tl.runs.length - 1 : 0));
        const chk = pop.querySelector('.avboardchk');
        if (chk) chk.onchange = async () => {
          const n = boardAction();
          const p = palOf(id);
          const on = chk.checked && n !== null;
          const body = on ? { char: id, action: n, pal: p !== undefined && /^[0-9]{1,4}$/.test(String(p)) ? Number(p) : null }
            : { char: id, action: null, pal: null };
          chk.disabled = true;
          try {
            const r = await fetch('/api/board-art', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
            let j = null;
            try { j = await r.json(); } catch (e) { j = null; }
            if (!r.ok || !j || j.error) throw new Error((j && j.error) || 'could not save the leaderboard pose');
            boardArt = j.boardArt || { action: null, pal: null };
            say(!on ? t('Leaderboard win pose cleared: the next export picks the win pose itself.')
              : boardArt.pal !== null && boardArt.pal !== undefined ? t('Leaderboard win pose: action {n}, palette {pal}. The next export that makes the leaderboard art uses it.', { n, pal: boardArt.pal })
                : t('Leaderboard win pose: action {n}, default colors. The next export that makes the leaderboard art uses it.', { n }));
          } catch (e) {
            say(e.message, 'err');
          } finally {
            chk.disabled = false;
            syncPop();
          }
        };
      };
      const openPop = () => {
        if (!pop) buildPop();
        syncPop();
        pop.hidden = false;
        moreBtn.setAttribute('aria-expanded', 'true');
        moreBtn.setAttribute('aria-controls', pop.id);
        placePop();
        // Anywhere else closes it; Escape closes it even while focus is back
        // on the key (captured, so an open modal around it is not closed by
        // the same press); a resize or a scroll moves it with its key.
        const outside = (e) => { if (!pop.contains(e.target) && !moreBtn.contains(e.target)) closePop(false); };
        const esc = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePop(true); } };
        doc.addEventListener('mousedown', outside, true);
        doc.addEventListener('keydown', esc, true);
        win.addEventListener('resize', placePop);
        win.addEventListener('scroll', placePop, true);
        popOffs.push(() => doc.removeEventListener('mousedown', outside, true));
        popOffs.push(() => doc.removeEventListener('keydown', esc, true));
        popOffs.push(() => win.removeEventListener('resize', placePop));
        popOffs.push(() => win.removeEventListener('scroll', placePop, true));
        const first = pop.querySelector('input[type="radio"]:checked') || pop.querySelector('input, button');
        if (first) first.focus();
      };
      if (moreBtn) {
        moreBtn.onclick = () => { if (pop && !pop.hidden) closePop(true); else openPop(); };
        offs.push(() => { closePop(false); if (pop && pop.parentNode) pop.parentNode.removeChild(pop); pop = null; });
      }
      pick.value = preset ? 'p0' : body ? String(body.action) : (common.find((x) => x.action === 0) ? 0 : a.actions[0].action);
      handle.repaint = () => { if (!dead) show(); };
      // Exposed for the pop-out, which mirrors the panel's pick when it opens,
      // and for the differential harness, which drives two players in step.
      handle.pick = pick;
      handle.load = (v) => { pick.value = v; return load(v); };
      handle.setPlaying = (on) => setPlaying(on);
      handle.arrow = (d) => arrow(d);
      handle.state = () => ({
        sel: pick.value, fi, ri, playing,
        timeline: tl,
        frames: frames ? frames.length : 0,
        box: box ? [box.l, box.t, box.w, box.h] : null,
        fit, read: read.textContent,
        src: cel.getAttribute('src'),
        pos: [cel.style.left, cel.style.top, cel.style.width, cel.style.height],
        facing: facingNow(),
        draw: { transform: cel.style.transform || '', blend: cel.style.mixBlendMode || '', opacity: cel.style.opacity || '', filter: cel.style.filter || '' },
      });
      if (cfg.onReady) cfg.onReady({ actions: a.actions, canGif: !!a.canGif, pick, handle });
      load(pick.value);
    })();

    handle.destroy = () => {
      if (dead) return;
      dead = true;
      clearTimeout(timer);
      timer = null;
      chain++;
      for (const off of offs) { try { off(); } catch (e) { /* going away anyway */ } }
      offs.length = 0;
      host.innerHTML = '';
    };
    return handle;
  }

  root.mountAnimView = mountAnimView;
  // The timeline is shared: the GIF export (modlib.js, which requires this
  // file) and the select-screen editor's animations (grid.html) play by it too.
  root.airTimeline = airTimeline;
  root.airEntries = airEntries;
  root.airTotals = airTotals;
  // The player's drawing rules, for tests that check them against the GIF
  // composer's (tools/test-animview-gif-ui.js).
  root.avRunPlace = runPlace;
  root.avBlendStyle = blendStyle;
})(typeof window !== 'undefined' ? window : this);
