// THE LOBBY'S LOOK on the game page: the colors, fonts, header and background
// the site's host chose in the Studio (Settings > Online > Lobby look, kept per
// bundle as roster.lobbyLook, lobbylook.js). Players cannot change it.
//
// Where it comes from: window.IKEMEN_BRAND.lobbyLook, which the Website export
// writes into the page (export.js copyBranded) and the Studio's own server
// fills in on the way out for Test in Browser; nothing there = today's look.
// It is the roster's look plus two folders: fontDir (the fonts, from the
// leaderboard's font set) and bgDir (the background picture or video).
//
// What it does:
//   - at once, a <style> with the look's tokens on :root (--lob-bg ...
//     --lob-head-font, the names webrtc.js's sidebar and any new lobby UI
//     use) and the header style; only what differs from the default, so a
//     page with no look gets no style at all;
//   - enter() when the lobby sidebar appears (webrtc.js lobbyUiMake): the
//     class inlobby on <html>, which index.html's page rules hang off (the
//     page around the game in the look's colors, square), and the background
//     layer behind the page; leave() when the sidebar goes takes both away.
//
// Two backgrounds, each a picture, animated picture or short video with a fit
// and a darkness: background behind the page, and panelBg behind the lobby
// panel itself (like a speedrun timer's background image).
//
// The page background sits behind the WHOLE PAGE while in a lobby: the picture
// frames the game, and it shows on any window shape (behind the sidebar
// alone it would be a 300 px strip under the names and chat). The sidebar's
// panel stays solid in front of it at every width, in the look's own
// background color, so names, statuses and chat read the same on any
// picture and at any darkness (the owner's rule: no see-through resting
// fills). Over the picture lies the look's background color at the host's
// darkness, so the page's own text around the game stays readable.
//
// The panel background lies inside the sidebar, under its sections: the
// panel's body and chat log stop drawing their own fills so it shows, under
// the look's background color at the host's darkness; buttons, the code
// box, inputs and tags stay solid, and the panel's text gets a hard 1 px
// shadow in the background color so it reads on any picture.
//
// The panel's theme (style): flat (the panel as it has always been) or a
// whole restyle with the same words and parts: versus (a fighting game's VS
// card), terminal (a CRT console) or booklet (a page from a 2000s fighting
// game's instruction booklet). See THEMES below. Square in every theme.
//
// See-through (see, each 0-100 % see-through, 0 = solid as always): lines
// (the borders and divider lines), panel (the panel's own fill, so the page
// or its picture shows through) and boxes (the chat log, the code box and
// the inputs). Buttons and tags stay solid whatever is set.
//
// Also loaded by Node (tools/test-lobby-look.js, lobbylook.js): the tables
// and the CSS it writes, no DOM.
(function () {
  'use strict';
  // The eight colors, by key, and the token each one sets.
  var KEYS = ['bg', 'panel', 'text', 'dim', 'accent', 'accentText', 'border', 'chatBg'];
  var VARS = { bg: '--lob-bg', panel: '--lob-panel', text: '--lob-text', dim: '--lob-dim', accent: '--lob-accent',
    accentText: '--lob-accent-text', border: '--lob-border', chatBg: '--lob-chat-bg' };
  // The presets, named after the Studio's looks like the leaderboard's (each
  // its night printing: the lobby sits beside a game on a dark page), and
  // classic, the sidebar as it has always been (the Game only page's colors).
  var PRESETS = {
    classic:  { bg: '#0b0d12', panel: '#10141c', text: '#d6e6ff', dim: '#9fb3cc', accent: '#66aaff', accentText: '#0b0d12', border: '#66aaff', chatBg: '#05070a' },
    energy:   { bg: '#0a0a0b', panel: '#17171a', text: '#eff0ec', dim: '#b3b4b0', accent: '#d8391f', accentText: '#ffffff', border: '#d8391f', chatBg: '#040405' },
    wb:       { bg: '#040e26', panel: '#0a1a40', text: '#edf3ff', dim: '#aec3ec', accent: '#2a62f0', accentText: '#ffffff', border: '#2a62f0', chatBg: '#020818' },
    djar:     { bg: '#14040a', panel: '#240913', text: '#fff5f2', dim: '#e2b4ab', accent: '#d0142f', accentText: '#ffffff', border: '#ff8800', chatBg: '#0a0205' },
    shizuka:  { bg: '#07090b', panel: '#15122a', text: '#f3efe3', dim: '#d2c6ef', accent: '#e8b92c', accentText: '#1a1200', border: '#cc99ff', chatBg: '#030504' },
    contrast: { bg: '#000000', panel: '#141414', text: '#ffffff', dim: '#e0e0e0', accent: '#ffa31a', accentText: '#000000', border: '#ffffff', chatBg: '#000000' },
  };
  // The sidebar's head band: flat looks only. band = a solid strip of the
  // accent (the default); panel = the panel color with accent letters and a
  // line of the border color under it; line = the background with a thick
  // accent rule under it.
  var HEADERS = ['band', 'panel', 'line'];
  var STYLES = ['flat', 'versus', 'terminal', 'booklet'];
  var SEE = ['lines', 'panel', 'boxes'];
  // cover: fill, keeping its shape (cropped); contain: fit whole, keeping its
  // shape; stretch: fill, shape ignored; tile: repeated at its own size;
  // center: its own size, centered.
  var FITS = ['cover', 'contain', 'stretch', 'tile', 'center'];
  var DIM_DEFAULT = 60, DIM_MAX = 90;
  var HEX = /^#[0-9a-f]{6}$/;
  var FONT_ID = /^[a-z0-9-]{1,40}$/;
  var BG_FILE = /^bg-[0-9a-f]{12}\.(png|jpg|webp|gif|mp4|webm)$/;
  var DIR = /^[A-Za-z0-9_./-]{0,200}$/;

  // THE PANEL THEMES: whole restyles of the panel (same words, same parts,
  // another design), each a list of rules under P. 'html body #lobbybar'
  // outweighs the header style's 'html #lobbybar', so a theme draws its own
  // head band. Square everywhere (webrtc.js forces border-radius 0 and no
  // box-shadow on the panel, so bevels are drawn with border colors).
  var P = 'html body #lobbybar';
  var LIT = 'color-mix(in srgb, var(--lob-panel) 50%, #ffffff)';
  var SHADE = 'color-mix(in srgb, var(--lob-panel) 45%, #000000)';
  var RAISED = 'border: 2px solid; border-color: ' + LIT + ' ' + SHADE + ' ' + SHADE + ' ' + LIT + ';';
  var SUNKEN = 'border: 2px solid; border-color: ' + SHADE + ' ' + LIT + ' ' + LIT + ' ' + SHADE + ';';
  var THEMES = {
    // A fighting game's versus card: the two players as slanted name plates
    // side by side over a VS, the rest of the lobby as a grid of small tiles
    // under a slanted banner, a striped title band.
    versus: [
      P + ' { background: var(--lob-bg); border-left: 3px solid var(--lob-accent); }',
      P + ' .lb-head { background: repeating-linear-gradient(-45deg, var(--lob-accent) 0 9px, color-mix(in srgb, var(--lob-accent) 78%, #000000) 9px 18px); color: var(--lob-accent-text); padding: 8px 4px 8px 12px; }',
      P + ' .lb-t { display: inline-block; transform: skewX(-12deg); font-size: 17px; letter-spacing: .12em; background: var(--lob-accent); padding: 0 6px; }',
      P + ' .lb-body { display: flex; flex-wrap: wrap; align-content: flex-start; gap: 4px; padding: 8px; }',
      P + ' .lb-body > * { flex: 1 1 100%; order: 7; }',
      P + ' .lb-now { order: 1; text-align: center; color: var(--lob-dim); font-size: 11px; letter-spacing: .14em; }',
      // the lobby's match mode heads the card, over NOW (it comes first in the panel)
      P + ' .lb-mode { order: 1; text-align: center; color: var(--lob-accent); font-weight: bold; font-size: 11px; letter-spacing: .14em; }',
      // a plate's MUTE / KICK sit in a row under its status, at the plate's
      // straight edge (P1's left, P2's right), clear of its slant; they never
      // wrap into a column of their own past the plate's edge
      P + ' .lb-mem[data-st="play"] { order: 2; flex: 1 1 0; min-width: 0; flex-direction: row; align-items: flex-start; align-content: space-between; gap: 4px; padding: 12px 10px 8px 8px; border: 0;',
      '    background: var(--lob-accent); clip-path: polygon(0 0, 100% 0, calc(100% - 10px) 100%, 0 100%); }',
      P + ' .lb-body:has(.lb-mem[data-st="play"])::before { content: "VS"; order: 3; flex: none; align-self: center; transform: skewX(-12deg); font: bold 18px var(--lob-head-font); color: var(--lob-accent); }',
      P + ' .lb-mem[data-p="2"] { order: 4; background: var(--lob-text); clip-path: polygon(10px 0, 100% 0, 100% 100%, 0 100%); padding: 12px 8px 8px 10px; text-align: right; justify-content: flex-end; }',
      P + ' .lb-mem[data-st="play"] .lb-nm { font: bold 16px var(--lob-head-font); color: var(--lob-accent-text); white-space: normal; }',
      P + ' .lb-mem[data-st="play"] .lb-st { color: var(--lob-accent-text); }',
      P + ' .lb-mem[data-st="play"] .lb-tag { background: var(--lob-accent-text); color: var(--lob-accent); }',
      P + ' .lb-mem[data-p="2"] .lb-nm, ' + P + ' .lb-mem[data-p="2"] .lb-st { color: var(--lob-bg); }',
      P + ' .lb-mem[data-p="2"] .lb-tag { background: var(--lob-bg); color: var(--lob-text); }',
      // P1's MUTE / KICK in the plate's own ink, as P2's are
      P + ' .lb-mem[data-st="play"] button { align-self: flex-start; border-color: var(--lob-accent-text); color: var(--lob-accent-text); background: transparent; }',
      P + ' .lb-mem[data-p="2"] button { align-self: flex-end; border-color: var(--lob-bg); color: var(--lob-bg); background: transparent; }',
      P + ' .lb-next { order: 5; margin-top: 4px; padding: 4px 8px; background: var(--lob-panel); border-left: 4px solid var(--lob-accent); color: var(--lob-text); }',
      P + ' .lb-streak { order: 5; padding: 3px 8px; color: var(--lob-accent); font-weight: bold; }',
      P + ' .lb-sec { order: 6; margin: 8px 0 2px; padding: 3px 10px; border: 0; background: var(--lob-text); color: var(--lob-bg); clip-path: polygon(0 0, 100% 0, calc(100% - 12px) 100%, 0 100%); }',
      P + ' .lb-mem { order: 6; flex: 1 1 40%; flex-wrap: wrap; align-items: flex-start; gap: 2px; padding: 5px 6px; background: var(--lob-panel); border: 2px solid var(--lob-rule); }',
      P + ' .lb-mem .lb-who { flex: 1 1 100%; }',
      P + ' .lb-mem .lb-st { font-size: 10px; }',
      P + ' .lb-mem button { padding: 0 4px; font-size: 9px; }',
      P + ' .lb-code { order: 8; margin-top: 6px; }',
      P + ' .lb-row { order: 9; }',
      P + ' .lb-msg { order: 10; }',
      P + ' .lb-chat { border-top: 4px solid var(--lob-accent); }',
      P + ' .lb-log div { border-left: 3px solid var(--lob-rule); padding-left: 6px; margin: 2px 0; }',
    ],
    // A CRT console: the accent as the phosphor, scan lines, bracketed
    // buttons, dotted leaders from each name to its status, a prompt.
    terminal: [
      P + ' { background: var(--lob-chat-bg); border-left: 1px solid var(--lob-accent); color: var(--lob-accent);',
      '    text-shadow: 1px 0 0 var(--lob-chat-bg), -1px 0 0 var(--lob-chat-bg), 0 1px 0 var(--lob-chat-bg), 0 -1px 0 var(--lob-chat-bg); }',
      P + '::after { content: ""; position: absolute; inset: 0; z-index: 5; pointer-events: none;',
      '    background: repeating-linear-gradient(0deg, color-mix(in srgb, var(--lob-chat-bg) 55%, transparent) 0 1px, transparent 1px 3px); }',
      // a panel picture shows faintly through the screen, whatever its darkness;
      // the sections over it stay positioned but stack in the panel itself
      // (they paint over the picture by order), so the players' names can
      // rise above the scan lines with a picture too
      P + ' > .lb-art > div:last-child { background: var(--lob-chat-bg) !important; opacity: .84 !important; }',
      P + ' > :not(.lb-art) { z-index: auto; }',
      P + ' .lb-head { background: transparent; color: var(--lob-accent); border-bottom: 1px dashed var(--lob-accent); padding: 6px 4px 6px 8px; }',
      P + ' .lb-t::before { content: "[ "; } ' + P + ' .lb-t::after { content: " ]"; }',
      P + ' button, ' + P + ' .lb-head button { background: transparent; color: var(--lob-accent); border: 0; padding: 1px 2px; }',
      P + ' button::before { content: "["; } ' + P + ' button::after { content: "]"; }',
      P + ' button:hover, ' + P + ' button:focus-visible, ' + P + ' .lb-head button:hover { background: var(--lob-accent); color: var(--lob-chat-bg); }',
      P + ' .lb-check::before, ' + P + ' .lb-check::after { content: none; }',
      P + ' .lb-check i { background: transparent; border: 1px solid currentColor; width: 10px; height: 10px; }',
      P + ' .lb-line, ' + P + ' .lb-now { color: var(--lob-accent); }',
      P + ' .lb-line { opacity: 1; }',
      P + ' .lb-code b { background: transparent; border: 1px dashed var(--lob-accent); color: var(--lob-text); }',
      P + ' .lb-sec { color: var(--lob-accent); border-bottom: 1px dashed var(--lob-accent); }',
      P + ' .lb-sec::before { content: "== "; } ' + P + ' .lb-sec::after { content: " =="; }',
      P + ' .lb-mem { border: 0; padding: 1px 0; gap: 4px; }',
      P + ' .lb-mem .lb-who { display: flex; align-items: baseline; gap: 0; }',
      P + ' .lb-mem .lb-nm { flex: none; color: var(--lob-text); }',
      P + ' .lb-mem .lb-nm::before { content: "> "; color: var(--lob-accent); }',
      P + ' .lb-mem .lb-st { flex: 1; display: flex; align-items: baseline; font-size: 10px; color: var(--lob-accent); white-space: nowrap; overflow: hidden; }',
      P + ' .lb-mem .lb-st::before { content: ""; flex: 1; min-width: 8px; border-bottom: 1px dotted currentColor; margin: 0 4px; }',
      // the players' names in reverse video: the accent as the block, its ink
      // (--lob-accent-ink, derive) dark or light by the accent's own
      // luminance, and above the scan lines with no outline, so it reads at
      // 4.5:1 or better on any accent
      P + ' .lb-tag, ' + P + ' .lb-tag.lb-you { background: transparent; color: var(--lob-accent); border: 1px solid currentColor; }',
      P + ' .lb-mem[data-st="play"] .lb-nm { position: relative; z-index: 6; color: var(--lob-accent-ink, #05070a); background: var(--lob-accent); text-shadow: none; }',
      P + ' .lb-mem[data-st="play"] .lb-nm::before, ' + P + ' .lb-mem[data-st="play"] .lb-tag { color: var(--lob-accent-ink, #05070a); }',
      P + ' .lb-chat { border-top: 1px dashed var(--lob-accent); }',
      P + ' .lb-log { background: transparent; color: var(--lob-text); }',
      P + ' .lb-log .lb-sys { color: var(--lob-accent); }',
      P + ' .lb-log div::before { content: "$ "; color: var(--lob-accent); }',
      P + ' .lb-say { border-top: 1px dashed var(--lob-accent); }',
      P + ' .lb-say input { background: transparent; color: var(--lob-accent); caret-color: var(--lob-accent); }',
    ],
    // A page from a 2000s fighting game's instruction booklet (the Studio's
    // own design language): a slanted speed-cut chapter band over a corner of
    // halftone dots, outlined chapter numbers (01 the match, 02 the roster,
    // 03 the notes), the match lines in a tip box with its tab, the roster
    // numbered 01-08 with the two players on slanted plates under big
    // outlined P1 / P2 marks, chunky printed buttons that press in, and the
    // chat as a ruled notes page with a margin line. Hard edges throughout.
    booklet: [
      P + ' { background: var(--lob-panel); border-left: 0; counter-reset: lbm; }',
      P + '::before { content: ""; position: absolute; top: 0; right: 0; width: 170px; height: 190px; z-index: 1; pointer-events: none;',
      '    background: radial-gradient(circle, color-mix(in srgb, var(--lob-accent) 45%, transparent) 1.3px, transparent 1.8px) 0 0 / 6px 6px;',
      '    -webkit-mask-image: linear-gradient(215deg, #000 0%, transparent 72%); mask-image: linear-gradient(215deg, #000 0%, transparent 72%); }',
      P + ' > :not(.lb-art) { position: relative; z-index: 2; }',
      // the chapter band: a slanted accent cut, a thinner border-colored cut under it
      P + ' .lb-head { isolation: isolate; background: transparent; color: var(--lob-accent-text); padding: 12px 6px 16px 0; border: 0; }',
      P + ' .lb-head::before { content: ""; position: absolute; z-index: -1; left: 0; top: 8px; bottom: 12px; width: 86%;',
      '    background: var(--lob-accent); clip-path: polygon(0 0, 100% 0, calc(100% - 20px) 100%, 0 100%); }',
      P + ' .lb-head::after { content: ""; position: absolute; z-index: -1; left: 0; bottom: 5px; height: 4px; width: 64%;',
      '    background: var(--lob-border); clip-path: polygon(0 0, 100% 0, calc(100% - 4px) 100%, 0 100%); }',
      P + ' .lb-t { padding-left: 12px; font: italic 900 18px var(--lob-head-font); letter-spacing: .05em; color: var(--lob-accent-text); }',
      P + ' .lb-head button { background: var(--lob-text); color: var(--lob-bg); border: 0; padding: 4px 9px; font-size: 10px; letter-spacing: .14em; }',
      P + ' .lb-head button:hover, ' + P + ' .lb-head button:focus-visible { background: var(--lob-accent); color: var(--lob-accent-text); }',
      // printed buttons: a thick bottom-right edge that presses in
      P + ' button { background: var(--lob-panel); color: var(--lob-text); border: 2px solid var(--lob-text); border-right-width: 4px; border-bottom-width: 4px; padding: 2px 9px; }',
      P + ' button:hover, ' + P + ' button:focus-visible { background: var(--lob-accent); color: var(--lob-accent-text); border-color: var(--lob-text); }',
      P + ' button:active { border-right-width: 2px; border-bottom-width: 2px; transform: translate(2px, 2px); }',
      P + ' .lb-body { padding: 4px 10px 8px; }',
      P + ' .lb-body > * { position: relative; }',
      // the code: a cut-out coupon
      P + ' .lb-code b { background: var(--lob-chat-bg); border: 2px dashed var(--lob-dim); text-align: center; font-size: 16px; letter-spacing: .06em; padding: 6px; }',
      // 01: the match lines in a tip box with its tab (the password line when
      // there is one, the mode, now, next, then the streak closes it)
      P + ' .lb-mode, ' + P + ' .lb-now, ' + P + ' .lb-next, ' + P + ' .lb-streak, ' + P + ' .lb-pass { background: var(--lob-chat-bg); color: var(--lob-text);',
      '    border: 2px solid var(--lob-accent); border-width: 0 2px; padding: 2px 8px 2px 10px; }',
      P + ' .lb-code + .lb-line { margin-top: 14px; border-top-width: 2px; padding-top: 20px; }',
      P + ' .lb-code + .lb-line::before { content: "01"; position: absolute; top: -2px; left: -2px; padding: 1px 8px 1px 6px;',
      '    background: var(--lob-accent); color: var(--lob-accent-text); font: italic 900 11px var(--lob-head-font); clip-path: polygon(0 0, 100% 0, calc(100% - 6px) 100%, 0 100%); }',
      P + ' .lb-now { color: var(--lob-accent); font-weight: bold; }',
      P + ' .lb-mode { font-weight: bold; letter-spacing: .06em; }',
      P + ' .lb-streak { border-bottom-width: 2px; padding-bottom: 6px; font-weight: bold; }',
      // 02: the roster's chapter head, an outlined number and a dashed speed rule
      P + ' .lb-sec { margin: 16px 0 6px; padding: 2px 4px 4px 38px; border: 0; background: var(--lob-panel); color: var(--lob-text); font: italic 900 13px var(--lob-head-font); letter-spacing: .08em; }',
      P + ' .lb-sec::before { content: "02"; position: absolute; left: 2px; top: -4px; font: italic 900 26px var(--lob-head-font); color: transparent; -webkit-text-stroke: 1px var(--lob-accent); }',
      P + ' .lb-sec::after { content: ""; display: block; height: 3px; margin-top: 4px; background: repeating-linear-gradient(90deg, var(--lob-accent) 0 14px, transparent 14px 19px); }',
      // the roster: numbered 01-08, the players on slanted plates
      P + ' .lb-mem { counter-increment: lbm; min-height: 34px; padding: 4px 4px 4px 32px; gap: 6px; border: 0; border-bottom: 1px solid var(--lob-rule); background: var(--lob-panel); }',
      P + ' .lb-mem::before { content: counter(lbm, decimal-leading-zero); position: absolute; left: 0; top: 50%; transform: translateY(-50%); width: 25px; padding: 3px 0;',
      '    text-align: center; background: var(--lob-text); color: var(--lob-bg); font: italic 900 11px var(--lob-head-font); }',
      P + ' .lb-mem .lb-nm { font-weight: bold; font-size: 13px; }',
      P + ' .lb-mem .lb-st { font-size: 10px; letter-spacing: .06em; color: var(--lob-dim); }',
      P + ' .lb-mem button { padding: 0 5px; font-size: 9px; border-width: 1px 3px 3px 1px; }',
      P + ' .lb-mem[data-st="play"] { background: var(--lob-accent); border-bottom-color: var(--lob-panel); padding-right: 18px; margin-right: -4px;',
      '    clip-path: polygon(0 0, 100% 0, calc(100% - 14px) 100%, 0 100%); }',
      P + ' .lb-mem[data-st="play"]::before { background: var(--lob-accent-text); color: var(--lob-accent); }',
      P + ' .lb-mem[data-st="play"] .lb-nm, ' + P + ' .lb-mem[data-st="play"] .lb-st { color: var(--lob-accent-text); }',
      P + ' .lb-mem[data-st="play"] .lb-tag { background: var(--lob-accent-text); color: var(--lob-accent); }',
      P + ' .lb-mem[data-st="play"] button { background: var(--lob-accent); color: var(--lob-accent-text); border-color: var(--lob-accent-text); }',
      // the P1 / P2 mark: an item of its own between the name and the
      // buttons, so it never sits over a button or the name (a long status
      // wraps beside it instead); a plate with no buttons keeps it where it
      // always sat
      P + ' .lb-mem[data-p]::after { content: "P" attr(data-p); order: 1; flex: none; align-self: center; white-space: nowrap;',
      '    font: italic 900 28px/24px var(--lob-head-font); color: transparent; -webkit-text-stroke: 1px var(--lob-accent-text); pointer-events: none; }',
      P + ' .lb-mem[data-p] button { order: 2; }',
      P + ' .lb-mem[data-p]:not(:has(button))::after { margin-right: 46px; }',
      P + ' .lb-mem[data-st="spec"] .lb-nm { font-style: italic; }',
      P + ' .lb-check i { border: 2px solid var(--lob-text); background: var(--lob-chat-bg); }',
      P + ' .lb-check { border-color: var(--lob-text); }',
      // 03: the notes page, ruled every line with a margin line
      P + ' .lb-chat { border-top: 0; padding: 24px 0 0; }',
      P + ' .lb-chat::before { content: "03"; position: absolute; left: 10px; top: 0; font: italic 900 22px var(--lob-head-font); color: transparent; -webkit-text-stroke: 1px var(--lob-accent); }',
      P + ' .lb-chat::after { content: ""; position: absolute; left: 44px; right: 10px; top: 11px; height: 3px; background: repeating-linear-gradient(90deg, var(--lob-accent) 0 14px, transparent 14px 19px); }',
      P + ' .lb-log { margin: 0 10px; padding: 0 8px 0 12px; line-height: 15px; border-left: 2px solid var(--lob-accent);',
      '    background: repeating-linear-gradient(180deg, transparent 0 14px, var(--lob-rule) 14px 15px), var(--lob-chat-bg); background-attachment: local; }',
      P + ' .lb-say { margin: 6px 10px 8px; border-top: 0; gap: 6px; }',
      P + ' .lb-say input { background: var(--lob-chat-bg); border: 2px solid var(--lob-text); }',
      P + ' .lb-say button { border-width: 2px 4px 4px 2px; }',
    ],
  };

  // The page's own reading of a look (the export and the Studio write it
  // checked already; a page edited by hand gets the same checks): -> null
  // when there is none.
  function clean(v) {
    if (!v || typeof v !== 'object') return null;
    var c = v.colors && typeof v.colors === 'object' ? v.colors : {};
    var preset = PRESETS[c.preset] ? c.preset : 'classic';
    var colors = { preset: preset };
    KEYS.forEach(function (k) {
      var x = typeof c[k] === 'string' ? c[k].toLowerCase() : '';
      if (HEX.test(x) && x !== PRESETS[preset][k]) colors[k] = x;
    });
    var f = v.fonts && typeof v.fonts === 'object' ? v.fonts : {};
    var fonts = {};
    ['head', 'body'].forEach(function (r) { if (typeof f[r] === 'string' && FONT_ID.test(f[r])) fonts[r] = f[r]; });
    return {
      colors: colors,
      fonts: fonts,
      header: HEADERS.indexOf(v.header) >= 0 ? v.header : 'band',
      style: STYLES.indexOf(v.style) >= 0 ? v.style : 'flat',
      see: cleanSee(v.see),
      background: cleanBg(v.background),
      panelBg: cleanBg(v.panelBg),
      fontDir: typeof v.fontDir === 'string' && DIR.test(v.fontDir) ? v.fontDir : 'leaderboard-fonts/',
      bgDir: typeof v.bgDir === 'string' && DIR.test(v.bgDir) ? v.bgDir : 'lobby-bg/',
    };
  }

  // Each part's see-through, a whole 0-100 in steps the Studio offers; a
  // part left solid (0) is not kept.
  function cleanSee(v) {
    var o = {};
    if (!v || typeof v !== 'object') return o;
    SEE.forEach(function (k) {
      var n = Number(v[k]);
      if (Number.isInteger(n) && n > 0 && n <= 100) o[k] = n;
    });
    return o;
  }
  function cleanBg(b) {
    if (!b || typeof b !== 'object' || typeof b.file !== 'string' || !BG_FILE.test(b.file)) return null;
    var d = Number(b.dim);
    return { file: b.file, fit: FITS.indexOf(b.fit) >= 0 ? b.fit : 'cover',
      dim: Number.isInteger(d) && d >= 0 && d <= DIM_MAX ? d : DIM_DEFAULT };
  }

  // The eight colors a look comes to: its preset's, with the hand-set ones over them.
  function colorsOf(look) {
    var c = (look && look.colors) || {};
    var base = PRESETS[c.preset] || PRESETS.classic;
    var out = {};
    KEYS.forEach(function (k) { out[k] = typeof c[k] === 'string' && HEX.test(c[k]) ? c[k] : base[k]; });
    return out;
  }
  function rgb(h) { return [1, 3, 5].map(function (i) { return parseInt(h.slice(i, i + 2), 16); }); }
  // t of a over b
  function mix(a, b, t) {
    var x = rgb(a), y = rgb(b);
    return '#' + [0, 1, 2].map(function (i) {
      var n = Math.round(y[i] + (x[i] - y[i]) * t);
      return (n < 16 ? '0' : '') + n.toString(16);
    }).join('');
  }
  function rgba(h, a) { return 'rgba(' + rgb(h).join(', ') + ', ' + (Math.round(a * 1000) / 1000) + ')'; }
  function luminance(h) {
    var c = rgb(h).map(function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  // Text on a block of the accent that must read whatever the accent is (the
  // terminal theme's players): the chat color, else the text color, when it
  // reaches 4.5:1 on the accent (WCAG AA), else black or white, whichever
  // contrasts more (always over 4.5:1).
  function contrast(a, b) { var x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
  function ink(c) {
    if (contrast(c.chatBg, c.accent) >= 4.5) return c.chatBg;
    if (contrast(c.text, c.accent) >= 4.5) return c.text;
    return contrast('#000000', c.accent) >= contrast('#ffffff', c.accent) ? '#000000' : '#ffffff';
  }
  // The tokens nobody picks: six mixed from the eight in the proportions the
  // classic sidebar's own lines and faint text have (#1e2a3a is about 18% of
  // its accent over its background, and so on). The warning line is amber,
  // darker on a light background. The accent's ink: ink() above.
  function derive(c) {
    return {
      '--lob-rule': mix(c.accent, c.bg, 0.18),
      '--lob-rule-soft': mix(c.accent, c.bg, 0.095),
      '--lob-faint': mix(c.dim, c.bg, 0.59),
      '--lob-off-border': mix(c.accent, c.bg, 0.3),
      '--lob-off-text': mix(c.accent, c.bg, 0.5),
      '--lob-warn': luminance(c.bg) > 0.35 ? '#8a5a00' : '#ffcc66',
      '--lob-accent-ink': ink(c),
    };
  }
  function sameColors(a, b) { return KEYS.every(function (k) { return a[k] === b[k]; }); }

  // The style a look needs on the page: '' for none (today's look).
  function css(v) {
    var look = clean(v);
    if (!look) return '';
    var out = [];
    var c = colorsOf(look);
    var root = [];
    if (!sameColors(c, PRESETS.classic)) {
      KEYS.forEach(function (k) { root.push(VARS[k] + ': ' + c[k]); });
      var d = derive(c);
      Object.keys(d).forEach(function (k) { root.push(k + ': ' + d[k]); });
    }
    // The fonts: one face per role, by the folder's file name; the role's
    // token names it first, with monospace after it while it loads.
    [['head', 'LobbyHead', '--lob-head-font'], ['body', 'LobbyBody', '--lob-font']].forEach(function (r) {
      var id = look.fonts[r[0]];
      if (!id) return;
      out.push('@font-face { font-family: "' + r[1] + '"; src: url("' + look.fontDir + id + '.otf") format("opentype"); font-display: swap; }');
      root.push(r[2] + ': "' + r[1] + '", monospace');
    });
    if (root.length) out.unshift(':root { ' + root.join('; ') + '; }');
    // See-through: the same tokens again, later and so winning, as rgba.
    var see = look.see, sr = [];
    if (see.lines) {
      var dl = derive(c), al = 1 - see.lines / 100;
      sr.push('--lob-border: ' + rgba(c.border, al), '--lob-rule: ' + rgba(dl['--lob-rule'], al), '--lob-rule-soft: ' + rgba(dl['--lob-rule-soft'], al));
    }
    if (see.boxes) sr.push('--lob-chat-bg: ' + rgba(c.chatBg, 1 - see.boxes / 100));
    if (see.panel) sr.push('--lob-panel-fill: ' + rgba(c.bg, 1 - see.panel / 100));
    if (sr.length) out.push(':root { ' + sr.join('; ') + '; }');
    if (see.panel) out.push('html #lobbybar { background: var(--lob-panel-fill); }');
    // The head band: 'html ' weighs one element more than the sidebar's own
    // rules (webrtc.js puts its style sheet in later, so equal weight would
    // lose to it).
    if (look.header === 'panel') {
      out.push('html #lobbybar .lb-head { background: var(--lob-panel); color: var(--lob-accent); border-bottom: 2px solid var(--lob-border); }');
      out.push('html #lobbybar .lb-head button { border-color: var(--lob-accent); background: var(--lob-panel); color: var(--lob-accent); }');
      out.push('html #lobbybar .lb-head button:hover, html #lobbybar .lb-head button:focus-visible { background: var(--lob-accent); color: var(--lob-accent-text); }');
    } else if (look.header === 'line') {
      out.push('html #lobbybar .lb-head { background: var(--lob-bg); color: var(--lob-text); border-bottom: 4px solid var(--lob-accent); }');
      out.push('html #lobbybar .lb-head button { border-color: var(--lob-accent); background: var(--lob-bg); color: var(--lob-accent); }');
      out.push('html #lobbybar .lb-head button:hover, html #lobbybar .lb-head button:focus-visible { background: var(--lob-accent); color: var(--lob-accent-text); }');
    }
    if (THEMES[look.style]) out = out.concat(THEMES[look.style]);
    // A page background needs no rule here: the layer goes behind the page
    // (enter() below) and the sidebar keeps its solid --lob-bg in front. A
    // panel background: its layer (.lb-art) under the sections, which stop
    // filling their own backgrounds over it.
    if (look.panelBg) {
      out.push('html #lobbybar > .lb-art { position: absolute; inset: 0; z-index: 0; overflow: hidden; pointer-events: none; }');
      out.push('html #lobbybar > :not(.lb-art) { position: relative; z-index: 1; }');
      out.push('html #lobbybar .lb-log { background: transparent; }');
      out.push('html #lobbybar .lb-body, html #lobbybar .lb-log { text-shadow: 1px 1px 0 var(--lob-bg); }');
    }
    return out.join('\n');
  }

  var api = { KEYS: KEYS, VARS: VARS, PRESETS: PRESETS, HEADERS: HEADERS, STYLES: STYLES, SEE: SEE, FITS: FITS, DIM_DEFAULT: DIM_DEFAULT, DIM_MAX: DIM_MAX,
    BG_FILE: BG_FILE, clean: clean, cleanBg: cleanBg, cleanSee: cleanSee, colorsOf: colorsOf, derive: derive, mix: mix, contrast: contrast, ink: ink, css: css };
  if (typeof module === 'object' && module.exports) { module.exports = api; return; }

  // ---------------------------------------------------------------- page
  var brand = window.IKEMEN_BRAND || {};
  var look = clean(brand.lobbyLook);
  var text = css(brand.lobbyLook);
  if (text) {
    var st = document.createElement('style');
    st.id = 'lobbylook-style';
    st.textContent = text;
    document.head.appendChild(st);
  }
  var layer = null, art = null;
  // The background: the picture as the layer's own background (a GIF or WebP
  // animates there; tile repeats it) or a muted looping video, then the
  // look's background color over it at the host's darkness.
  // The page's layer is #lobbybg, fixed behind the page; the panel's is
  // .lb-art inside #lobbybar (placed by the rules css() writes).
  var VIDEO_FIT = { cover: 'cover', contain: 'contain', stretch: 'fill', tile: 'cover', center: 'none' };
  var SIZE = { cover: 'cover', contain: 'contain', stretch: '100% 100%', tile: 'auto', center: 'auto' };
  function makeLayer(bg, panel) {
    var el = document.createElement('div');
    el.setAttribute('aria-hidden', 'true');
    if (panel) { el.className = 'lb-art'; el.style.background = 'var(--lob-panel-fill, var(--lob-bg, #0b0d12))'; }
    else {
      el.id = 'lobbybg';
      el.style.cssText = 'position: fixed; inset: 0; z-index: -1; overflow: hidden; pointer-events: none;';
    }
    if (!panel) el.style.background = 'var(--lob-bg, #0b0d12)';
    var url = look.bgDir + bg.file;
    if (/\.(mp4|webm)$/.test(bg.file)) {
      var v = document.createElement('video');
      v.muted = true; v.defaultMuted = true; v.loop = true; v.playsInline = true;
      v.setAttribute('muted', ''); v.setAttribute('playsinline', '');
      var still = false;
      try { still = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { still = false; }
      v.autoplay = !still;
      v.preload = 'auto';
      v.src = url;
      v.style.cssText = 'position: absolute; inset: 0; width: 100%; height: 100%; object-fit: ' + VIDEO_FIT[bg.fit] + ';';
      el.appendChild(v);
      if (!still) { var p = v.play(); if (p && p.catch) p.catch(function () { /* autoplay refused: its first frame stays */ }); }
    } else {
      var pic = document.createElement('div');
      pic.style.cssText = 'position: absolute; inset: 0;';
      pic.style.backgroundImage = 'url("' + url + '")';
      pic.style.backgroundPosition = 'center';
      pic.style.backgroundRepeat = bg.fit === 'tile' ? 'repeat' : 'no-repeat';
      pic.style.backgroundSize = SIZE[bg.fit];
      el.appendChild(pic);
    }
    var dim = document.createElement('div');
    dim.style.cssText = 'position: absolute; inset: 0; background: var(--lob-bg, #0b0d12);';
    dim.style.opacity = String(bg.dim / 100);
    el.appendChild(dim);
    return el;
  }
  function stop(el) {
    var v = el.querySelector('video');
    if (v) { try { v.pause(); v.removeAttribute('src'); v.load(); } catch (e) { /* gone */ } }
    el.remove();
  }
  window.ikemenLobbyLook = {
    look: look,
    enter: function () {
      var html = document.documentElement;
      html.classList.add('inlobby');
      if (look && look.background && !layer) {
        layer = makeLayer(look.background);
        document.body.insertBefore(layer, document.body.firstChild);
        html.classList.add('lob-bg');
      }
      var bar = document.getElementById('lobbybar');
      if (look && look.panelBg && bar && !(art && art.parentNode === bar)) {
        if (art) stop(art);
        art = makeLayer(look.panelBg, true);
        bar.insertBefore(art, bar.firstChild);
      }
    },
    leave: function () {
      var html = document.documentElement;
      html.classList.remove('inlobby', 'lob-bg');
      if (layer) { stop(layer); layer = null; }
      if (art) { stop(art); art = null; }
    },
  };
})();
