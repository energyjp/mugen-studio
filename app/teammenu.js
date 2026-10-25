'use strict';
//
// teammenu.js - the engine's own team menu, brought whole into a pack that
// blanked its own, at the pack's scale.
//
// Training on this build walks through the team menu (the training-team mod
// turns Simul on for the dummy side, and two choices make the engine show the
// menu). A pack with no team modes on its title menu routinely blanks that
// menu - item fonts -1, empty titles, a cursor on an animation it never
// defines - so it is worked blind. Patching single keys gave a menu, but a
// messy one: the engine's icons are drawn for a 1280x720 screenpack and a
// 452x254 pack draws them nearly three times too large, over its own text.
//
// So the whole menu comes over as ONE thing: every `teammenu` key of the
// engine's screenpack (positions, spacing, titles, item fonts, cursor,
// count icons, item names), scaled to the pack by k = pack height / 720 -
// positions, offsets, spacings and scales multiplied, and a scale of k given
// to every element the engine's screenpack drew at 1 - together with what
// those keys name: the font (copied into the theme's fonts/ and given the
// next free fontN), the cursor animations (their [Begin Action] blocks
// appended, renumbered if the pack already uses those numbers) and the
// sprites those and the icons draw (lent into the pack's sprite file under
// the same keys, lendsprites.js). The pack's own sounds for the menu are
// kept: its system.snd is what plays. Everything else of the pack is
// untouched, and a pack whose menu is visible is left exactly as it is.
const fs = require('fs');
const path = require('path');
const lendsprites = require('./lendsprites.js');

const SEC = /^\s*\[\s*([^\]]+?)\s*\]/;
const MENU_KEY = /^\s*(p[12]\.)?teammenu\./i;
const nums = (v) => String(v).split(',').map((x) => parseFloat(x));
const fmt = (n) => (Math.round(n * 100) / 100).toString();

// the lines of one section: { start (first line after the header), end (next header or EOF) } or null
function section(lines, name) {
  const want = name.toLowerCase();
  for (let i = 0; i < lines.length; i++) {
    const m = SEC.exec(lines[i]);
    if (!m || m[1].toLowerCase() !== want) continue;
    let e = i + 1;
    while (e < lines.length && !SEC.test(lines[e])) e++;
    return { header: i, start: i + 1, end: e };
  }
  return null;
}
const keyOf = (line) => { const m = /^\s*([^=;\s]+)\s*=\s*([^;\r\n]*?)\s*(;.*)?$/.exec(line); return m ? { key: m[1].toLowerCase(), value: m[2], comment: m[3] || '' } : null; };
const localcoordOf = (lines) => {
  const info = section(lines, 'Info');
  if (info) for (let i = info.start; i < info.end; i++) { const kv = keyOf(lines[i]); if (kv && kv.key === 'localcoord') { const n = nums(kv.value); if (n.length >= 2 && n[1] > 0) return [n[0], n[1]]; } }
  return [320, 240];
};
const actionsOf = (lines) => {
  const out = new Map();
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*\[Begin Action\s+(\d+)\s*\]/i.exec(lines[i]);
    if (!m) continue;
    let e = i + 1;
    while (e < lines.length && !/^\s*\[/.test(lines[e])) e++;
    out.set(+m[1], lines.slice(i, e));
  }
  return out;
};

// does the pack draw its team menu for both players? an item font absent or -1 on either side = no
function blanked(packText) {
  const lines = packText.split(/\r?\n/), sel = section(lines, 'Select Info');
  if (!sel) return false;
  const font = { p1: null, p2: null };
  for (let i = sel.start; i < sel.end; i++) { const kv = keyOf(lines[i]); if (kv && /^p[12]\.teammenu\.item\.font$/.test(kv.key)) font[kv.key.slice(0, 2)] = kv.value.trim(); }
  return ['p1', 'p2'].some((p) => font[p] === null || /^-1\b/.test(font[p]));
}

// -> { text, needs: { fonts: Map(stockIndex -> stockPath), actions: Map(stockNo -> newNo), sprites: [[g,i]] }, k }
// opts.fontIndexOf(stockIndex, stockPath) -> the fontN the pack will have for it (the caller copies the file)
function convert(packText, stockText, opts) {
  const eol = /\r\n/.test(packText) ? '\r\n' : '\n';
  const pack = packText.split(/\r?\n/), stock = stockText.split(/\r?\n/);
  const sel = section(pack, 'Select Info'), ssel = section(stock, 'Select Info');
  if (!sel || !ssel) throw new Error('no [Select Info]');
  const k = localcoordOf(pack)[1] / localcoordOf(stock)[1];
  // the stock fonts, by index
  const stockFonts = new Map();
  const sfiles = section(stock, 'Files');
  if (sfiles) for (let i = sfiles.start; i < sfiles.end; i++) { const kv = keyOf(stock[i]); const m = kv && /^font(\d*)$/.exec(kv.key); if (m && kv.value.trim()) stockFonts.set(m[1] === '' ? 1 : +m[1], kv.value.trim().replace(/\\/g, '/')); }
  // the pack's own sounds for the menu stay
  const packSnd = new Map();
  for (let i = sel.start; i < sel.end; i++) { const kv = keyOf(pack[i]); if (kv && /^p[12]\.teammenu\.(move|value|done)\.snd$/.test(kv.key)) packSnd.set(kv.key, pack[i]); }
  const packActions = actionsOf(pack), stockActions = actionsOf(stock);
  const usedActions = new Set(packActions.keys());
  const actionMap = new Map();
  const fonts = new Map(), fontIndex = new Map(), sprites = [];
  const fontIndexOf = (idx, p) => { if (!fontIndex.has(idx)) fontIndex.set(idx, opts.fontIndexOf(idx, p)); return fontIndex.get(idx); };
  const addSprite = (g, i) => { if (Number.isFinite(g) && Number.isFinite(i) && g >= 0 && !sprites.some((s) => s[0] === g && s[1] === i)) sprites.push([g, i]); };
  const out = [];
  const seen = new Set();
  for (let i = ssel.start; i < ssel.end; i++) {
    const line = stock[i];
    if (!MENU_KEY.test(line)) continue;
    const kv = keyOf(line);
    if (!kv) continue;
    seen.add(kv.key);
    let value = kv.value;
    if (/\.snd$/.test(kv.key)) { if (packSnd.has(kv.key)) { out.push(packSnd.get(kv.key)); continue; } }
    else if (/\.(pos|offset|spacing|scale|focallength)$/.test(kv.key)) value = nums(value).map((n) => fmt(n * k)).join(',');
    else if (/\.font$/.test(kv.key)) {
      const parts = value.split(',');
      const idx = parseInt(parts[0], 10);
      if (idx >= 0 && stockFonts.has(idx)) { if (!fonts.has(idx)) fonts.set(idx, stockFonts.get(idx)); parts[0] = String(fontIndexOf(idx, stockFonts.get(idx))); }
      value = parts.join(',');
    } else if (/\.anim$/.test(kv.key)) {
      const no = parseInt(value, 10);
      if (Number.isFinite(no) && no >= 0 && stockActions.has(no)) {
        if (!actionMap.has(no)) { let n = no; while (usedActions.has(n)) n++; usedActions.add(n); actionMap.set(no, n); }
        value = String(actionMap.get(no));
        for (const l of stockActions.get(no).slice(1)) { const f = /^\s*(-?\d+)\s*,\s*(-?\d+)/.exec(l.replace(/;.*$/, '')); if (f) addSprite(+f[1], +f[2]); }
      }
    } else if (/\.spr$/.test(kv.key)) { const n = nums(value); addSprite(n[0], n[1]); }
    out.push(kv.key + ' = ' + value + (kv.comment ? ' ' + kv.comment : ''));
  }
  // elements the engine's screenpack draws at 1 and this pack must draw at k
  for (const p of ['p1', 'p2']) for (const el of ['item', 'item.active', 'item.active2', 'item.cursor', 'value.icon', 'value.empty.icon']) {
    const key = p + '.teammenu.' + el + '.scale';
    if (!seen.has(key)) out.push(key + ' = ' + fmt(k) + ',' + fmt(k));
  }
  // the pack's own team-menu lines go, the converted block lands at the end of its [Select Info]
  const kept = pack.slice(0, sel.end).filter((l, i) => i < sel.start || !MENU_KEY.test(l));
  let tail = pack.slice(sel.end);
  const insert = ['; the team menu, from the engine\'s own screenpack, at this pack\'s scale (x' + fmt(k) + ')', ...out, ''];
  // the cursor animations, appended after everything the pack defines
  const blocks = [];
  for (const [no, n] of actionMap) {
    const src = stockActions.get(no).slice();
    src[0] = src[0].replace(/\[Begin Action\s+\d+\s*\]/i, '[Begin Action ' + n + ']');
    blocks.push(...src.filter((l) => l.trim() !== ''), '');
  }
  while (tail.length && tail[tail.length - 1].trim() === '') tail.pop();
  const text = [...kept, ...insert, ...tail, ...(blocks.length ? ['', '; team menu cursors, from the engine\'s own screenpack', ...blocks] : [])].join(eol) + eol;
  return { text, needs: { fonts, actions: actionMap, sprites }, k };
}

// The whole thing on a theme folder. stock: { def, dir } = the engine's screenpack def and its data/ folder.
// -> null when the pack's menu is visible, else { k, fonts: [...], actions: [...], sprites: [...], skipped: [...] }
function bring(themeDir, stock) {
  const sysDef = path.join(themeDir, 'system.def');
  const packText = fs.readFileSync(sysDef, 'latin1');
  if (!blanked(packText)) return null;
  const stockText = fs.readFileSync(stock.def, 'latin1');
  const lines = packText.split(/\r?\n/), files = section(lines, 'Files');
  if (!files) throw new Error('no [Files]');
  // the next free fontN, and the sprite file the pack draws its screens from
  let maxFont = 0, sprRel = null;
  for (let i = files.start; i < files.end; i++) { const kv = keyOf(lines[i]); if (!kv) continue; const m = /^font(\d*)$/.exec(kv.key); if (m && kv.value.trim()) maxFont = Math.max(maxFont, m[1] === '' ? 1 : +m[1]); if (kv.key === 'spr') sprRel = kv.value.trim().replace(/\\/g, '/'); }
  const fontLines = [], copied = [];
  const fontIndexOf = (idx, stockPath) => {
    const have = copied.find((c) => c.stockIndex === idx);
    if (have) return have.index;
    const srcDef = path.join(stock.dir, ...stockPath.split('/'));
    const defText = fs.readFileSync(srcDef, 'latin1');
    const base = path.basename(stockPath);
    fs.mkdirSync(path.join(themeDir, 'fonts'), { recursive: true });
    const dstDef = path.join(themeDir, 'fonts', base);
    fs.writeFileSync(dstDef, defText, 'latin1');
    const fm = /^\s*file\s*=\s*([^;\r\n]+)/im.exec(defText);
    if (fm) { const f = fm[1].trim(); try { fs.copyFileSync(path.join(path.dirname(srcDef), f), path.join(themeDir, 'fonts', path.basename(f))); } catch (e) { /* a def with no separate file */ } }
    const index = ++maxFont;
    copied.push({ stockIndex: idx, index, file: 'fonts/' + base });
    fontLines.push('font' + index + ' = fonts/' + base);
    return index;
  };
  const r = convert(packText, stockText, { fontIndexOf });
  // the font lines, after the pack's last one
  const out = r.text.split(/\r?\n/), eol = /\r\n/.test(r.text) ? '\r\n' : '\n';
  const f2 = section(out, 'Files');
  let at = f2.start;
  for (let i = f2.start; i < f2.end; i++) { const kv = keyOf(out[i]); if (kv && /^font\d*$/.test(kv.key)) at = i + 1; }
  out.splice(at, 0, ...fontLines);
  fs.writeFileSync(sysDef, out.join(eol), 'latin1');
  // the sprites the menu draws, lent under their own keys
  let lent = { lent: [], skipped: [] };
  const sprAbs = sprRel && path.join(themeDir, ...sprRel.split('/'));
  const stockSff = stock.sff;
  if (sprAbs && fs.existsSync(sprAbs) && stockSff && fs.existsSync(stockSff) && r.needs.sprites.length) {
    lent = lendsprites.lend(fs.readFileSync(sprAbs), fs.readFileSync(stockSff), r.needs.sprites);
    if (lent.buf) fs.writeFileSync(sprAbs, lent.buf);
  }
  return { k: r.k, fonts: copied.map((c) => c.file), actions: [...r.needs.actions].map(([a, b]) => a + (a === b ? '' : ' -> ' + b)), sprites: lent.lent, skipped: lent.skipped.filter((s) => !/target has it/.test(s.why)) };
}

module.exports = { blanked, convert, bring };
