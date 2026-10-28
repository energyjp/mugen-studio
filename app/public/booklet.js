/* MUGEN STUDIO - THE BOOKLET: booklet.js (2026-10-18). Plain script, no
   build step, no libraries; exposes window.Booklet. Load it with
   <script src="/booklet.js"></script> anywhere (it waits for nothing).

   - Booklet.glyphs(notation, {size:'lg'})  -> HTML for a command, .cmd notation ("~D, DF, F, x") or Ikemen movelist tokens ("_D_DF_F_+^X")
   - Booklet.sprites('wb'|'djar'|'shizuka') -> Promise<set>   (a mascot's frames, public/mascots/<art>/*.png + sprites.json)
   - Booklet.paintSprite(box|null, set, cssHeight) -> box   (a .bk-sprite: one canvas per frame at device pixels; CSS picks the frame)
   - Booklet.blinker(box, art, ok) -> {arm, stop, blinkNow}   (the member's own blink, every few seconds while ok())
   - Booklet.drawShizuka(el, {crop, scale, swirl}) -> Promise<el>   (public/about/shizuka.webp + .json, the lenses' swirl)
   - Booklet.tip(anchor, tip, {ms})  -> the slip (#bkTip): a band tip laid OVER the page under its mascot, gone after 5.5 s
   - Booklet.mascot(button, {page, height}) -> {deal(), member, art} | null   (a window's mascot: a click puts up the next of the three and deals that page's tip in his voice from the opener's BAND deck)
   - Booklet.bandDeck() -> window.studioBand (or the opener's) | null
   - Booklet.render(root)   renders [data-cmd], [data-shizuka] under root
   - Booklet.printing() -> 'energy-day' ...; Booklet.IDS; Booklet.esc(s)
   The contract: $X/rd-foundation/CONTRACT.md. */
(function () {
  'use strict';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  // THE STUDIO'S LANGUAGE (public/i18n.js) in a page that loads it before this
  // file, English in any other: the glyphs' spoken names and the hold marks'
  // words go through I18n.t, which fills {placeholders} either way.
  const I18n = window.I18n || { t: (en, vars) => String(en).replace(/\{([A-Za-z_$][\w$]*)\}/g, (m, k) => (vars && vars[k] != null ? String(vars[k]) : m)) };

  // ---- printings (theme.js owns the state; this only names it) -------------------
  const LOOKS = ['energy', 'wb', 'ar', 'sz', 'contrast'];
  const IDS = [];
  for (const l of LOOKS) for (const s of ['day', 'night']) IDS.push(l + '-' + s);
  function printing() {
    const r = document.documentElement;
    return (r.getAttribute('data-look') || 'energy') + '-' + (r.getAttribute('data-paper') === 'night' ? 'night' : 'day');
  }

  // ---- command glyphs -----------------------------------------------------------
  // Written for a fighter facing right. Arrow angles from "right".
  const DIRS = { F: 0, DF: 45, D: 90, DB: 135, B: 180, UB: 225, U: 270, UF: 315 };
  const SAY = { F: I18n.t('forward'), DF: I18n.t('down-forward'), D: I18n.t('down'), DB: I18n.t('down-back'), B: I18n.t('back'), UB: I18n.t('up-back'), U: I18n.t('up'), UF: I18n.t('up-forward') };
  const PUNCH = { x: 1, y: 1, z: 1 }, KICK = { a: 1, b: 1, c: 1 };
  const ARROW = 'M1 6.3h7.4V2.2L15.2 8l-6.8 5.8V9.7H1z';
  // hollow: a held or charged direction, drawn as the engine's own glyphs.sff draws ~B..~UF (sprites 92-99)
  const arrow = (d, hollow) => '<svg class="ar' + (hollow ? ' hollow' : '') + '" viewBox="0 0 16 16" aria-hidden="true"><path transform="rotate(' + DIRS[d] + ' 8 8)" d="' + ARROW + '"/></svg>';
  // the hold mark: the hollow arrow (or a chip) on the spot bar with a small word; a charge reads "charge"
  const holdMark = (inner, word, title) => '<span class="hold" title="' + esc(title) + '">' + inner + '<em>' + esc(word) + '</em></span>';
  // "hold x 30 ticks", "charge: hold back, then": a held direction's or button's words
  const holdSay = (what, ticks, release) => (ticks
    ? (release ? I18n.t('hold {what} {n} ticks, then release', { what, n: ticks }) : I18n.t('hold {what} {n} ticks', { what, n: ticks }))
    : (release ? I18n.t('hold {what}, then release', { what }) : I18n.t('hold {what}', { what })));
  const chargeSay = (what, ticks) => (ticks ? I18n.t('charge: hold {what} {n} ticks, then', { what, n: ticks }) : I18n.t('charge: hold {what}, then', { what }));
  // x, y and z: "x or y or z"; parts of one press: "down and x"
  const orSay = (list) => list.reduce((a, b) => I18n.t('{a} or {b}', { a, b }));
  const andSay = (list) => list.reduce((a, b) => I18n.t('{a} and {b}', { a, b }));
  const THEN = '<span class="then" aria-hidden="true"></span>';
  // A button's letter is its label on the pad, not a word: translate="no", so a
  // language pack that has the bare letter "A" or "C" as a key elsewhere cannot
  // rename the button. A title on it is put in the reader's language here.
  const chip = (k, extra) => {
    const l = k.toLowerCase();
    const cls = PUNCH[l] ? 'p' : KICK[l] ? 'k' : 's';
    return '<span class="b ' + cls + (extra ? ' ' + extra : '') + '" data-btn="' + esc(l) + '" translate="no">' + esc(l.toUpperCase()) + '</span>';
  };
  // One element of a .cmd step: the modifiers ~[n] / $ > then a direction or a button.
  // .cmd is CASE-SENSITIVE like the engine: directions upper case (B = back), buttons lower case (b).
  function element(raw, charge) {
    let t = raw.trim(), release = false, ticks = 0, hold = false;
    for (;;) {
      if (t[0] === '~') { release = true; t = t.slice(1); const m = /^\d+/.exec(t); if (m) { ticks = +m[0]; t = t.slice(m[0].length); } continue; }
      if (t[0] === '/') { hold = true; t = t.slice(1); continue; }
      if (t[0] === '$' || t[0] === '>') { t = t.slice(1); continue; }
      break;
    }
    if (DIRS[t] !== undefined) {
      // a CHARGE (the command's first step, chargeStart's rule: glyphsCmd decides) gets the hollow
      // arrow reading "charge"; /D (held) the hollow arrow reading "hold"; ~D (the usual motion start) prints plain
      if (charge) return { dir: true, charge: true, html: holdMark(arrow(t, true), I18n.t('charge'), chargeSay(SAY[t], ticks)), say: I18n.t('charge {what}', { what: SAY[t] }) };
      if (hold) return { dir: true, html: holdMark(arrow(t, true), I18n.t('hold'), holdSay(SAY[t], ticks)), say: I18n.t('hold {what}', { what: SAY[t] }) };
      return { dir: true, html: arrow(t), say: SAY[t] };
    }
    if (/^[a-z]$/.test(t)) {
      if (hold || (release && ticks)) return { dir: false, html: holdMark(chip(t), I18n.t('hold'), holdSay(t, ticks, release)), say: I18n.t('hold {what}', { what: t }) };
      if (release) return { dir: false, html: chip(t, 'rel').replace('<span ', '<span title="' + esc(I18n.t('release')) + '" '), say: I18n.t('release {what}', { what: t }) };
      return { dir: false, html: chip(t), say: t };
    }
    // a move's strength versions on one line (the Command List writer): x/y/z = any of them
    if (/^[a-z](?:\/[a-z])+$/.test(t)) return { dir: false, html: t.split('/').map((b) => chip(b)).join('<span class="plus">/</span>'), say: orSay(t.split('/')) };
    if (!t) return { dir: false, html: '', say: '' };
    return { dir: false, html: '<span class="b s" translate="no">' + esc(t) + '</span>', say: t };
  }
  // The Command List writer's rule (cmdlist.js chargeStart), so the page draws a .cmd notation
  // without the server: the first step is ONE direction released (~) or held (/) N > 0 ticks
  // (~30$B), or released into the opposite (~$B, F / ~DB, DF / ~$D, U). Not ~D, DF, F.
  const stepDir = (step) => { const m = /^[~/$>\d]*(UF|UB|DF|DB|F|B|U|D)$/.exec(String(step || '').trim()); return m ? m[1] : null; };
  function chargeStart(steps) {
    const s0 = String(steps[0] || '').trim();
    if (s0.includes('+')) return false;
    const m = /^([~/$>]*)(\d*)([~/$>]*)(UF|UB|DF|DB|F|B|U|D)$/.exec(s0);
    if (!m) return false;
    const pre = m[1] + m[3], ticks = +m[2] || 0;
    if (/[~/]/.test(pre) && ticks > 0) return true;
    if (!pre.includes('~')) return false;
    const next = String(steps[1] || '').split('+').map(stepDir).find(Boolean);
    return !!next && ((/B/.test(m[4]) && /F/.test(next)) || (/D/.test(m[4]) && /U/.test(next)));
  }
  function glyphsCmd(cmd) {
    let steps = cmd.split(',').map((s) => s.trim()).filter(Boolean);
    // a held direction, then buttons: one press (/F,z = F + z, the writer's fold; printed as a press)
    steps = steps.reduce((out, st) => {
      const prev = out[out.length - 1];
      if (prev && /^\/[$>]*(UF|UB|DF|DB|F|B|U|D)$/.test(prev) && st.split('+').every((p) => /^[~/$>\d]*[a-z]$/.test(p.trim()))) out[out.length - 1] = prev.slice(1) + '+' + st;
      else out.push(st);
      return out;
    }, []);
    const charge = chargeStart(steps);
    let html = '', prevDir = null, prevCharge = false;
    const say = [];
    steps.forEach((step, i) => {
      const parts = step.split('+').map((p) => element(p, charge && i === 0)).filter((p) => p.html);
      if (!parts.length) return;
      const isDir = parts.every((p) => p.dir);
      if (i > 0 && prevDir !== null) html += prevCharge ? THEN : prevDir && !isDir ? '<span class="plus">+</span>' : '<span class="sep"></span>';
      if (i > 0 && prevCharge) say.push(I18n.t('then'));
      html += parts.map((p) => p.html).join('<span class="plus">+</span>');
      say.push(andSay(parts.map((p) => p.say)));
      prevDir = isDir;
      prevCharge = charge && i === 0;
    });
    return { html, say: say.join(', ') };
  }
  // Ikemen GO movelist tokens (every one a key of defaultMotif.ini [Glyphs]; the
  // Command List writer prints exactly these):
  //   _F _DF ...  a press            ~B ~DB ...  a HELD direction (hollow); followed by _. it is a CHARGE
  //   _.          "then" (the motif's "...")    ^A..^Z ^S  a button    ^P ^K  any punch / any kick
  //   _+          together           _AIR        in the air         _HOLD  the next button is held
  //   /           or (text in the pause menu, KFM's `[_B/_F]`; the separator here)
  // Anything else stays text.
  function glyphsMovelist(s) {
    let html = '', heldBtn = false;
    const say = [];
    const re = /_\+|_\.|_AIR|_HOLD|~(UF|UB|DF|DB|F|B|U|D)|_(UF|UB|DF|DB|F|B|U|D)|\^([ABCXYZS])|\^([PK])|\/|([^_^/~]+)/g;
    let m;
    while ((m = re.exec(s))) {
      if (m[0] === '_+') { html += '<span class="plus">+</span>'; say.push(I18n.t('plus')); }
      else if (m[0] === '_.') { html += THEN; say.push(I18n.t('then')); }
      else if (m[0] === '_AIR') { html += '<span class="w" title="in the air (jumping)">AIR</span>'; say.push(I18n.t('in the air')); }
      else if (m[0] === '_HOLD') { heldBtn = true; }
      else if (m[0] === '/') { html += '<span class="plus">/</span>'; say.push(I18n.t('or')); }
      else if (m[1]) {
        const charge = s.startsWith('_.', re.lastIndex);
        html += holdMark(arrow(m[1], true), charge ? I18n.t('charge') : I18n.t('hold'), charge ? chargeSay(SAY[m[1]]) : holdSay(SAY[m[1]]));
        say.push(charge ? I18n.t('charge {what}', { what: SAY[m[1]] }) : I18n.t('hold {what}', { what: SAY[m[1]] }));
      }
      else if (m[2]) { html += arrow(m[2]); say.push(SAY[m[2]]); }
      else if (m[3] || m[4]) {
        const k = m[3] || m[4];
        const word = m[4] ? (k === 'P' ? I18n.t('any punch') : I18n.t('any kick')) : k.toLowerCase();
        const c = m[4] ? '<span class="b ' + (k === 'P' ? 'p' : 'k') + '" data-btn="' + k.toLowerCase() + '" title="' + esc(word) + '" translate="no">' + k + '</span>' : chip(k);
        if (heldBtn) { html += holdMark(c, I18n.t('hold'), holdSay(word)); say.push(I18n.t('hold {what}', { what: word })); heldBtn = false; }
        else { html += c; say.push(word); }
      }
      else if (m[5] && m[5].trim()) { html += '<span class="txt">' + esc(m[5].trim()) + '</span>'; say.push(m[5].trim()); }
    }
    return { html, say: say.join(', ') };
  }
  // opts: { size: 'lg', nowrap: true } - nowrap keeps a long command on one line
  // (class `nowrap`: booklet.css .bk-cmd.nowrap)
  function glyphs(notation, opts) {
    const s = String(notation || '');
    const g = /(^|[^\w])_(UF|UB|DF|DB|F|B|U|D|\+|\.|AIR|HOLD)|\^[ABCXYZSPK]|~(UF|UB|DF|DB|F|B|U|D)_\./.test(s) ? glyphsMovelist(s) : glyphsCmd(s);
    const lg = opts && opts.size === 'lg' ? ' lg' : '';
    const nw = opts && opts.nowrap ? ' nowrap' : '';
    return '<span class="bk-cmd' + lg + nw + '" role="img" aria-label="' + esc(g.say || s) + '" data-notation="' + esc(s) + '">' + g.html + '</span>';
  }

  // ---- the band's art: loaded once, from the Studio's own files ----------------------
  const ART = {};
  const getJSON = (url) => fetch(url).then((r) => (r.ok ? r.json() : Promise.reject(new Error(url + ': ' + r.status))));
  // SHiZUKA's About picture and its lenses (drawShizuka)
  function loadArt(id) {
    if (!ART[id]) ART[id] = getJSON('/about/shizuka.json').catch((e) => { delete ART[id]; throw e; });
    return ART[id];
  }

  // ---- THE MASCOTS' SPRITES (2026-10-19) --------------------------------------------
  // The owner picked every frame of the band's new art; tools/mascot-sprites.py
  // keys their green out, aligns each member's frames on his idle one (measured),
  // crops them to ONE box per member and writes public/mascots/<art>/<frame>.png
  // (no metadata) with public/mascots/sprites.json. The art ids are the head's
  // (studio.mascot): wb, djar, shizuka; each speaks for his BAND member.
  //   WB:      idle, shutter1, shutter2, shut (his blink: a camera shutter), working, done, error
  //   DJ AR:   idle, blink (a glint across the shades), working, done, error
  //   SHiZUKA: idle, blink (her spirals a quarter turned), working, done, error
  // Every frame is drawn ONCE per size onto its own canvas at device pixels (the
  // backing store is the box's CSS size x devicePixelRatio, so the browser never
  // scales the canvas again: the one resample is the downscale from the file),
  // stacked in a .bk-sprite box; CSS shows one (booklet.css: data-show, and the
  // head's header[data-pose] in studio.html). Swapping a frame draws nothing.
  const MASCOT_ORDER = ['wb', 'djar', 'shizuka'];
  const BAND_OF = { wb: 'wb', djar: 'ar', shizuka: 'sz' };
  const ART_OF = { wb: 'wb', ar: 'djar', djar: 'djar', sz: 'shizuka', shizuka: 'shizuka' };
  // THE BLINKS, each member's own (the band's established details): WB's eyes are
  // screens and his blink is a camera shutter - the ovals shrink toward their
  // centers and open again the same way, a few display frames a step; DJ AR's
  // shades hide his eyes, so his is a glint across them; SHiZUKA's spiral lenses
  // hide hers, so hers is the spirals turning (idle and blink alternate, a
  // quarter turn each, like her About swirl). [frame, ms] steps, then idle.
  const BLINK = {
    wb: [['shutter1', 50], ['shutter2', 50], ['shut', 70], ['shutter2', 50], ['shutter1', 50]],
    djar: [['blink', 150]],
    shizuka: [['blink', 110], ['idle', 110], ['blink', 110], ['idle', 110], ['blink', 110]],
  };
  let SPRITES = null;
  const SETS = {};
  const loadImage = (src) => new Promise((ok, no) => {
    const im = new Image();
    im.onload = () => ok(im);
    im.onerror = () => no(new Error(src));
    im.src = src;
  });
  // A member's whole set, every frame decoded before it resolves (so a swap
  // never waits on a file): { art, band, name, w, h, frames, cut, images }.
  function sprites(id) {
    const art = ART_OF[id] || id;
    if (!SETS[art]) {
      if (!SPRITES) SPRITES = getJSON('/mascots/sprites.json').catch((e) => { SPRITES = null; throw e; });
      SETS[art] = SPRITES.then((man) => {
        const m = man.members && man.members[art];
        if (!m) throw new Error('no sprites for ' + art);
        return Promise.all(m.frames.map((f) => loadImage('/mascots/' + art + '/' + f + '.png'))).then((ims) => {
          const images = {};
          m.frames.forEach((f, i) => { images[f] = ims[i]; });
          return { art, band: m.band || BAND_OF[art], name: m.name || art, w: m.w, h: m.h, frames: m.frames.slice(), cut: m.breath, images };
        });
      }).catch((e) => { delete SETS[art]; throw e; });
    }
    return SETS[art];
  }
  // Paint a member's frames into `box` (a .bk-sprite, made if null) at cssH CSS
  // pixels tall. Returns the box. One canvas per frame plus `breath`: idle with
  // everything above his feet (the manifest's breath row) one device pixel lower
  // - per whole device pixel at any scaling (round(dpr)) - the idle pose's
  // breathing bob, his feet planted. CSS alternates idle and breath.
  function paintSprite(box, set, cssH) {
    const dpr = window.devicePixelRatio || 1;
    const H = Math.max(1, Math.round(cssH * dpr));
    const W = Math.max(1, Math.round(set.w * H / set.h));
    if (!box) { box = document.createElement('div'); box.className = 'bk-sprite'; }
    if (box.dataset.art !== set.art) { box.textContent = ''; box.dataset.art = set.art; }
    box.setAttribute('role', 'img');
    box.setAttribute('aria-label', set.name);
    box.style.width = W / dpr + 'px';
    box.style.height = H / dpr + 'px';
    box.dataset.px = W + 'x' + H + '@' + dpr;
    const canvasFor = (f) => {
      let c = box.querySelector('canvas[data-f="' + f + '"]');
      if (!c) { c = document.createElement('canvas'); c.dataset.f = f; c.setAttribute('aria-hidden', 'true'); box.appendChild(c); }
      c.width = W; c.height = H;
      c.style.width = W / dpr + 'px';
      c.style.height = H / dpr + 'px';
      const g = c.getContext('2d');
      g.clearRect(0, 0, W, H);
      g.imageSmoothingEnabled = true;
      g.imageSmoothingQuality = 'high';
      return g;
    };
    for (const f of set.frames) canvasFor(f).drawImage(set.images[f], 0, 0, set.w, set.h, 0, 0, W, H);
    // the breath: copied from the idle canvas one to one (whole device pixels, so
    // no resample) - the feet where they are, the rows above the cut round(dpr)
    // device pixels lower, over the planted feet
    const idle = box.querySelector('canvas[data-f="idle"]');
    const g = canvasFor('breath');
    const cut = Math.round((set.cut == null ? 0.7 : set.cut) * H), drop = Math.max(1, Math.round(dpr));
    g.imageSmoothingEnabled = false;
    g.drawImage(idle, 0, cut, W, H - cut, 0, cut, W, H - cut);
    g.drawImage(idle, 0, 0, W, cut, 0, drop, W, cut);
    return box;
  }
  // The member's blink, run on a box every few seconds while `ok()` says he may
  // (on screen, the window shown, idle) - never under reduced motion. Steps set
  // box.dataset.show; the end removes it. Returns { arm, stop }.
  const reduceMotionQ = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  function blinker(box, art, ok) {
    let timer = 0, step = 0;
    const steps = BLINK[art] || [];
    const may = () => box.isConnected && box.getClientRects().length && !document.hidden
      && !(reduceMotionQ && reduceMotionQ.matches) && (!ok || ok());
    const end = () => { clearTimeout(timer); timer = 0; delete box.dataset.show; };
    const run = () => {
      if (step >= steps.length || !may()) { end(); arm(); return; }
      const [f, ms] = steps[step++];
      box.dataset.show = f;
      timer = setTimeout(run, ms);
    };
    function arm() {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!box.isConnected) return;
        if (!steps.length || !may()) { arm(); return; }
        step = 0;
        run();
      }, 2600 + Math.random() * 4200);
    }
    return { arm, stop: end, blinkNow: () => { clearTimeout(timer); step = 0; if (may()) run(); else arm(); } };
  }

  // SHiZUKA: her picture with its lens pixels cut out; under each hole a canvas
  // paints the fitted Archimedean spiral in the lens's ellipse, on the lens's
  // fitted ground with its specks (the same math as studio.html's About tab).
  const GRAIN = 3, RATE = 24, SPEED = 0.45, EDGE = 0.06;
  const word = (r, g, b) => ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
  const byte = (v) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));
  const hash = (i, j, salt) => {
    let h = (i * 374761393 + j * 668265263 + salt * 2246822519) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  function buildLens(L, n, c) {
    const [x0, y0, x1, y1] = L.box, w = x1 - x0, h = y1 - y0;
    c.width = w; c.height = h;
    const ctx = c.getContext('2d'), im = ctx.createImageData(w, h);
    const cw = Math.ceil(w / GRAIN), chh = Math.ceil(h / GRAIN);
    const f0 = new Float32Array(cw * chh), dith = new Float32Array(cw * chh), speck = new Float32Array(cw * chh);
    const e = L.ellipse, s = L.spiral, P = L.palette, K = P.specks;
    const ca = Math.cos(e.angle), sa = Math.sin(e.angle);
    const B2 = [0.125, 0.625, 0.875, 0.375];
    for (let j = 0; j < chh; j++) for (let i = 0; i < cw; i++) {
      const k = j * cw + i, X = x0 + (i + 0.5) * GRAIN, Y = y0 + (j + 0.5) * GRAIN;
      const u = ((X - s.x) * ca + (Y - s.y) * sa) / e.a, v = (-(X - s.x) * sa + (Y - s.y) * ca) / e.b;
      f0[k] = s.turns * Math.hypot(u, v) + s.dir * Math.atan2(v, u) / (2 * Math.PI);
      dith[k] = B2[((j & 1) << 1) | (i & 1)];
      const roll = hash(i, j, n + 1);
      speck[k] = roll < K.darkShare ? K.dark : roll > 1 - K.lightShare ? K.light : 0;
    }
    const ground = new Uint32Array(w * h), { terms, coef } = L.surface;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const X = x0 + x + 0.5, Y = y0 + y + 0.5;
      let u = ((X - e.cx) * ca + (Y - e.cy) * sa) / e.a, v = (-(X - e.cx) * sa + (Y - e.cy) * ca) / e.b;
      const r = Math.hypot(u, v);
      if (r > 1) { u /= r; v /= r; }
      let R = 0, G = 0, B = 0;
      for (let q = 0; q < terms.length; q++) { const m = u ** terms[q][0] * v ** terms[q][1]; R += coef[0][q] * m; G += coef[1][q] * m; B += coef[2][q] * m; }
      const sp = speck[Math.floor(y / GRAIN) * cw + Math.floor(x / GRAIN)];
      ground[y * w + x] = word(byte(R + sp), byte(G + sp), byte(B + sp));
    }
    const W3 = (a) => word(a[0], a[1], a[2]);
    return { ctx, im, px: new Uint32Array(im.data.buffer), ground, w, h, cw, chh, f0, dith, half: s.width / 2, phase: s.phase, line: W3(P.line), core: W3(P.lineCore), edge: W3(P.lineEdge) };
  }
  function drawLens(L, turned) {
    const { px, ground, w, h, cw, chh, f0, dith, half } = L, ph = L.phase - turned, inner = half * 0.4;
    for (let j = 0; j < chh; j++) {
      const y = j * GRAIN, yEnd = Math.min(y + GRAIN, h);
      for (let i = 0; i < cw; i++) {
        const k = j * cw + i;
        let f = f0[k] - ph; f -= Math.floor(f);
        const d = f > 0.5 ? 1 - f : f;
        const col = d < inner ? L.core : d < half ? L.line : d < half + EDGE && (d - half) / EDGE < dith[k] ? L.edge : 0;
        const x = i * GRAIN, xEnd = Math.min(x + GRAIN, w);
        for (let yy = y; yy < yEnd; yy++) { const row = yy * w; for (let xx = x; xx < xEnd; xx++) px[row + xx] = col || ground[row + xx]; }
      }
    }
    L.ctx.putImageData(L.im, 0, 0);
  }
  // One clock for every swirling SHiZUKA on the page: 24 updates a second,
  // nothing while the window is hidden or under reduced motion, and a picture
  // that has left the document stops being drawn.
  const spinning = new Set();
  let spinRaf = 0, spinPrev = 0;
  const reduceMotion = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  function spinTick(now) {
    for (const S of spinning) if (!S.el.isConnected) spinning.delete(S);
    spinRaf = spinning.size ? requestAnimationFrame(spinTick) : 0;
    if (!spinPrev) { spinPrev = now; return; }
    if (now - spinPrev < 1000 / RATE - 2) return;
    const dt = Math.min(now - spinPrev, 100) / 1000 * SPEED;
    spinPrev = now;
    if (document.hidden || (reduceMotion && reduceMotion.matches)) return;
    for (const S of spinning) { S.spun += dt; for (const L of S.lenses) drawLens(L, S.spun); }
  }
  const SZ_FACE = [400, 90, 940, 780];
  function drawShizuka(el, opts) {
    return loadArt('sz').then((data) => {
      const [W, H] = data.size;
      const o = Object.assign({ crop: [0, 0, W, H], scale: null, swirl: false }, opts || {});
      const [cx0, cy0, cx1, cy1] = o.crop;
      const cw = cx1 - cx0, chh = cy1 - cy0;
      const scale = o.scale || ((el.clientWidth || 160) / cw);
      el.classList.add('bk-szart');
      el.textContent = '';
      el.style.width = Math.round(cw * scale) + 'px';
      el.style.height = Math.round(chh * scale) + 'px';
      el.setAttribute('role', 'img');
      el.setAttribute('aria-label', 'SHiZUKA');
      const crisp = Math.abs(scale * GRAIN - Math.round(scale * GRAIN)) < 1e-6 && scale * GRAIN >= 1;
      const stage = document.createElement('div');
      stage.className = 'stage';
      Object.assign(stage.style, { width: W * scale + 'px', height: H * scale + 'px', left: -cx0 * scale + 'px', top: -cy0 * scale + 'px' });
      const S = { el, lenses: [], spun: 0 };
      data.lenses.forEach((L, n) => {
        const c = document.createElement('canvas');
        const [x0, y0, x1, y1] = L.box;
        Object.assign(c.style, { left: x0 * scale + 'px', top: y0 * scale + 'px', width: (x1 - x0) * scale + 'px', height: (y1 - y0) * scale + 'px' });
        if (crisp) c.style.imageRendering = 'pixelated';
        stage.appendChild(c);
        const built = buildLens(L, n, c);
        drawLens(built, 0);   // frame 0: the spiral where the artist drew hers, so a lens is never empty
        S.lenses.push(built);
      });
      const img = document.createElement('img');
      img.src = '/about/shizuka.webp';
      img.alt = '';
      Object.assign(img.style, { left: 0, top: 0, width: '100%', height: '100%' });
      if (crisp) img.style.imageRendering = 'pixelated';
      stage.appendChild(img);
      el.appendChild(stage);
      if (o.swirl) { spinning.add(S); if (!spinRaf) { spinPrev = 0; spinRaf = requestAnimationFrame(spinTick); } }
      return el;
    });
  }

  // ---- the band's tips: a mascot in the head, a slip laid over the page -----------
  // The owner's second review (2026-10-18): "The tip box shouldn't be part of the
  // page. It should render on top and disappear after a few seconds." So there is
  // no hint box in any page any more: a click on a band mascot deals a tip, and
  // the tip is a SLIP over the page (Booklet.tip: position fixed, laid under the
  // mascot, gone after the reading time). It never takes layout, so nothing on
  // the page moves or resizes when it shows or goes.
  // Tips come ONLY from studio.html's BAND deck (window.studioBand.deal(member,
  // page)), so the shuffle rules, the page tags and the H-Mugen rule are the
  // band's own (GRAIL 3.1, "The band's tips"): the page's own tips first, then
  // the general ones, every tip once before any repeats, never the same twice
  // running, and SHiZUKA's hTips only in H-Mugen mode.
  const HUE = { wb: 'WB', ar: 'DJ AR', sz: 'SHiZUKA' };
  const TIP_MS = 5500;   // a tip's reading time (studio.html's TIP_MS, the old toast tip's)
  // The Studio window holds BAND. A window it opened (moves.html, grid.html)
  // deals from the SAME deck through its opener (same origin), so the rules and
  // H-Mugen mode are the Studio's; a page opened on its own has no deck.
  function bandDeck() {
    if (window.studioBand) return window.studioBand;
    try { return window.opener && window.opener.studioBand ? window.opener.studioBand : null; } catch (e) { return null; }
  }
  // THE SLIP: one per window (#bkTip, made on first use), the speaker's name
  // and line in their lit hue (the old toast tip's --wb-lit / --ar-lit /
  // --sz-lit), the tip verbatim. Placed under `anchor` with its notch on the
  // anchor's middle, kept inside the window; centered under the head when there
  // is no anchor. A new tip replaces the one up and restarts the clock.
  let slip = null, slipTimer = 0;
  function tip(anchor, t, opts) {
    if (!t || !t.text) return null;
    const o = Object.assign({ ms: TIP_MS }, opts || {});
    if (!slip || !slip.isConnected) {
      slip = document.createElement('div');
      slip.id = 'bkTip';
      slip.className = 'bk-tip';
      slip.setAttribute('role', 'status');
      slip.setAttribute('aria-live', 'polite');
      document.body.appendChild(slip);
    }
    slip.dataset.member = t.id;
    const who = document.createElement('b');
    who.className = 'who';
    who.setAttribute('translate', 'no');   // the member's name; the tip is in the reader's language already
    who.textContent = t.name + ':';
    slip.replaceChildren(who, document.createTextNode(' ' + t.text));
    const vw = document.documentElement.clientWidth;
    const r = anchor && anchor.getClientRects && anchor.getClientRects().length ? anchor.getBoundingClientRect() : null;
    slip.style.left = '0px'; slip.style.top = '0px';
    const w = slip.offsetWidth;
    const mid = r ? r.left + r.width / 2 : vw / 2;
    const x = Math.round(Math.max(8, Math.min(mid - 34, vw - w - 8)));
    slip.style.left = x + 'px';
    slip.style.top = Math.round(r ? r.bottom + 11 : 60) + 'px';
    slip.style.setProperty('--nx', Math.round(Math.max(8, Math.min(w - 24, mid - x - 8))) + 'px');
    slip.classList.toggle('nonotch', !r);
    // restart the fade-in even when a tip is already up
    slip.classList.remove('show');
    void slip.offsetWidth;
    slip.classList.add('show');
    clearTimeout(slipTimer);
    slipTimer = setTimeout(() => slip.classList.remove('show'), o.ms);
    return slip;
  }
  // A WINDOW'S MASCOT (the Moves window, E-Select): the Studio head's mascot
  // (whichever it shows, localStorage studio.mascot: WB, DJ AR or SHiZUKA), the
  // same sprites at the window's own height, in his idle pose - breathing and
  // blinking his own blink while on screen. A click puts up the next of the
  // three (the head's order) and deals that page's tip in the NEW mascot's
  // voice through the opener's deck as a slip. No deck (no opener) = no mascot:
  // `btn` stays hidden and this returns null. His height is the page's CSS
  // (.bk-bandmascot .bk-sprite { height }; the width follows the art) unless
  // opts.height names one; a change of it, or of the display scaling, redraws him.
  function mascot(btn, opts) {
    const o = Object.assign({ page: null, height: null }, opts || {});
    const band = bandDeck();
    if (!btn) return null;
    if (!band || typeof band.deal !== 'function') { btn.hidden = true; return null; }
    let art = 'wb';
    try { const saved = localStorage.getItem('studio.mascot'); if (MASCOT_ORDER.includes(saved)) art = saved; } catch (e) { /* private mode */ }
    btn.type = 'button';
    btn.classList.add('bk-bandmascot');
    btn.title = 'A tip from the band about this page';
    btn.setAttribute('aria-label', 'A tip from the band about this page');
    const box = document.createElement('div');
    box.className = 'bk-sprite breathe';
    btn.replaceChildren(box);
    btn.hidden = false;
    let set = null, gen = 0, blink = null, drawnAt = '';
    const cssHeight = () => {
      if (+o.height) return +o.height;
      const keep = box.style.height;
      box.style.height = '';
      const h = parseFloat(getComputedStyle(box).height) || 34;
      box.style.height = keep;
      return h;
    };
    const paint = () => {
      if (!set) return;
      const h = cssHeight(), at = set.art + ' ' + h + ' ' + (window.devicePixelRatio || 1);
      if (at === drawnAt) return;
      drawnAt = at;
      paintSprite(box, set, h);
    };
    const load = () => {
      const my = ++gen;
      return sprites(art).then((s) => {
        if (my !== gen) return;
        set = s;
        paint();
        if (blink) blink.stop();
        blink = blinker(box, s.art);
        blink.arm();
      });
    };
    load().catch(() => { btn.hidden = true; });
    addEventListener('resize', paint);
    // the visible mascot's own tip (the owner, 2026-10-19): his BAND member's
    const member = () => BAND_OF[art];
    const deal = () => {
      const t = band.deal(member(), o.page || null);
      if (t) tip(btn, t);
      return t;
    };
    btn.addEventListener('click', () => {
      art = MASCOT_ORDER[(MASCOT_ORDER.indexOf(art) + 1) % MASCOT_ORDER.length];
      load().catch(() => {});
      deal();
    });
    return { deal, get member() { return member(); }, get art() { return art; } };
  }

  // ---- render: everything under a root that asks for it ------------------------------
  function render(root) {
    root = root || document;
    for (const s of root.querySelectorAll('[data-cmd]')) {
      if (s.dataset.cmdDone === s.dataset.cmd) continue;
      s.innerHTML = glyphs(s.dataset.cmd, { size: s.dataset.size, nowrap: s.hasAttribute('data-nowrap') });
      s.dataset.cmdDone = s.dataset.cmd;
    }
    for (const d of root.querySelectorAll('[data-shizuka]')) {
      const sc = String(d.dataset.scale || '1/6').split('/');
      const scale = sc.length === 2 ? +sc[0] / +sc[1] : +sc[0];
      const crop = d.dataset.crop ? d.dataset.crop.split(',').map(Number) : d.dataset.shizuka === 'face' ? SZ_FACE : null;
      drawShizuka(d, Object.assign({ scale, swirl: d.dataset.swirl === 'on' }, crop ? { crop } : {})).catch(() => {});
    }
  }

  window.Booklet = { IDS, LOOKS, printing, esc, glyphs, sprites, paintSprite, blinker, MASCOT_ORDER, BAND_OF, drawShizuka, tip, mascot, bandDeck, render, SZ_FACE, HUE, TIP_MS };
})();
