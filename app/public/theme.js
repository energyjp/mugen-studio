// THE STUDIO'S PRINTING, per viewer: a LOOK - 'energy' (the default, no
// attribute), the band looks 'wb', 'ar' and 'sz', or 'contrast' - printed on
// DAY stock (paper, the default) or NIGHT stock (dark). Ten printings, all in
// public/themes.css: <html data-look="..." data-paper="day|night">.
// Loaded in <head> by every Studio window, before the body paints, so a
// window never flashes the default first. Both choices are kept in
// localStorage (`studio.look`, `studio.paper`) - every Studio window shares
// one origin, so they share them too - and a change in one window reaches the
// others through the storage event. Storage can be missing or blocked: the
// default printing (Energy, day) then simply stays.
//
// The moving sky and its switch (`studio.lookMotion`) retired with the old
// looks (2026-10-18): color is printed on the page. A saved value is ignored.
(function () {
  var KEY = 'studio.look';
  var PAPER_KEY = 'studio.paper';
  var LOOKS = { energy: 1, wb: 1, ar: 1, sz: 1, contrast: 1 };
  var PAPERS = { day: 1, night: 1 };
  // "Blue" was renamed WB (the band's name for it); a choice saved under the
  // old name is the same look.
  var RENAMED = { blue: 'wb' };
  var root = document.documentElement;
  function applyLook(v) {
    if (LOOKS[v] && v !== 'energy') root.setAttribute('data-look', v);
    else root.removeAttribute('data-look');
  }
  function applyPaper(v) {
    root.setAttribute('data-paper', PAPERS[v] ? v : 'day');
  }
  function read() {
    try {
      var v = localStorage.getItem(KEY);
      if (RENAMED[v]) {
        v = RENAMED[v];
        try { localStorage.setItem(KEY, v); } catch (e) { /* read-only: still applied */ }
      }
      return LOOKS[v] ? v : 'energy';
    } catch (e) { return 'energy'; }
  }
  function readPaper() {
    try {
      var v = localStorage.getItem(PAPER_KEY);
      return PAPERS[v] ? v : 'day';
    } catch (e) { return 'day'; }
  }
  function changed() {
    try { document.dispatchEvent(new CustomEvent('studio:printing', { detail: { look: read(), paper: readPaper() } })); } catch (e) { /* old engine */ }
  }

  applyLook(read());
  applyPaper(readPaper());
  window.addEventListener('storage', function (e) {
    if (e.key === KEY) { applyLook(read()); changed(); }
    else if (e.key === PAPER_KEY) { applyPaper(readPaper()); changed(); }
    else if (e.key === null) { applyLook(read()); applyPaper(readPaper()); changed(); }
  });
  window.studioLook = {
    get: read,
    set: function (v) {
      if (RENAMED[v]) v = RENAMED[v];
      if (!LOOKS[v]) v = 'energy';
      try { localStorage.setItem(KEY, v); } catch (e) { /* not kept; still applied here */ }
      applyLook(v);
      changed();
    },
    paper: readPaper,
    setPaper: function (v) {
      if (!PAPERS[v]) v = 'day';
      try { localStorage.setItem(PAPER_KEY, v); } catch (e) { /* not kept; still applied here */ }
      applyPaper(v);
      changed();
    },
    // 'energy-day' ... 'contrast-night': the printing's id, as the booklet names it.
    printing: function () { return read() + '-' + readPaper(); },
  };
})();
