// THE STUDIO'S LANGUAGE, per viewer: English (the source, and the default),
// Spanish for Latin America (es-419), Brazilian Portuguese (pt-BR), or any
// other pack a code names. Loaded in <head> by every Studio window, right
// after theme.js, so a page is translated as the parser builds it and never
// flashes English first.
//
// ENGLISH IS THE KEY. A pack, public/lang/<code>.json, maps an exact English
// string to its translation:
//   { "lang": "es-419", "name": "Español", "english": "Spanish (Latin America)",
//     "studio": "2.2", "strings": { "<English>": "<translation>", ... } }
// A string the pack lacks shows in English. tools/i18n-extract.js lists every
// key the Studio has (public/lang/en-keys.json) and checks a pack against it;
// public/lang/README.md is the translator's page.
//
// ENGLISH MODE DOES NOTHING. No pack is requested, no observer is installed,
// <html> gets no lang attribute, and t() hands back the English with its
// {placeholders} filled: the page behaves exactly as it did before languages.
//
// ANOTHER LANGUAGE: the pack is read SYNCHRONOUSLY here in <head> (a
// same-origin request to the Studio's own server, a few milliseconds), so it
// is ready before any script in the body calls t(). A pack that is missing or
// malformed leaves the page in English, with one console warning. Then a
// MutationObserver on the whole document translates what the parser and the
// scripts put into it:
//   - a TEXT NODE whose text, with every whitespace run collapsed to one space
//     and trimmed, is a key (or matches a template, below): the translation
//     replaces it, keeping the node's own leading and trailing whitespace;
//   - the attributes title, placeholder, aria-label and alt: the value trimmed
//     (line breaks kept - titles use &#10; on purpose) is the key;
//   - an element marked data-i18n="html": its whole innerHTML, whitespace
//     collapsed, is ONE key and the translation is set as its innerHTML, for a
//     sentence with inline <b>, <i>, <a> or <kbd> that has to move as a whole.
//     Its descendants are not visited on their own;
//   - never anything under translate="no" (the standard attribute): the
//     Studio's data - names, files, paths, logs - lives there; nor script or
//     style; nor the text in a textarea, code, pre or a contenteditable
//     element (their own title or placeholder still is). Input values are
//     never touched.
// What it writes it remembers, per node and per attribute, so its own writes
// do not come back around. A <template>'s contents are translated when a
// clone of them enters the document.
//
// TEMPLATES: TEXT THAT ARRIVES ALREADY FILLED IN. The server writes English
// ("Could not read kfm.def: it is empty") and never learns the language; a
// page shows that text as it comes. So a key with {placeholders} whose literal
// parts hold at least 4 letters is also a TEMPLATE: "Could not read {file}:
// {error}" is compiled once into an anchored pattern (the literal parts as
// they are, each placeholder a lazy group) and text the pack has no exact key
// for is matched against it. The templates are found through an index on the
// leading literal (else the trailing one, else a whole word inside), so the
// cost per text node does not grow with the pack. Two placeholders with
// nothing between them are never matched (tools/i18n-extract.js reports
// them). When several templates match, the one with the most literal
// characters wins, then the first in the pack. The translation is filled with
// the values the groups caught.
// MESSAGE PLACEHOLDERS: a placeholder named error, err, reason, message, msg,
// detail, details, why or cause (or one of those numbered: error2) holds a
// message, not data, so its value is itself looked up - exact, then template,
// at most 3 levels deep (a message in a message in a message in the text) -
// before it is filled in. That holds inside a template
// match and in t(): t('Export failed: {error}', { error: j.error }) shows the
// server's English translated. Every other placeholder's value (a name, a
// file, a number) is filled in exactly as it is.
// I18n.server(s) is the same lookup for code that shows server text where the
// observer cannot see it (alert, confirm, a canvas, document.title, a value
// joined into a string by hand); in English it returns s.
//
// PACK SAFETY: a translation whose HTML tags (every <...> token, attributes
// included) differ from its key's is left out when the pack is read, so that
// string shows in English, and one console warning gives the count. A key
// with no tags can therefore never be given markup by a pack.
//
// The choice is kept in localStorage `studio.lang` (like theme.js's
// `studio.look`); missing, blocked or not a language code is English. A code
// is a language and up to two subtags (es-419, pt-BR, fr, zh-Hant-TW): any
// such code is asked for as /lang/<code>.json, and a pack that is not there
// leaves the window in English. LANGS below is what the main window's Options
// row draws a flag for. Switching reloads the main window; another window
// keeps the language it opened with until it is opened again. TESTS ONLY:
// when `studio.langPack` holds a pack whose "lang" equals `studio.lang`, that
// pack is used instead of a file - the pseudo pack (qps) reaches the page
// this way.
//
// The key rules, the tag rule and the matcher are exported to Node as well, so
// the tools and the tests use exactly the browser's code.
(function () {
  'use strict';
  var KEY = 'studio.lang', PACK_KEY = 'studio.langPack';
  // The languages the Options row offers, each named in its own language.
  var LANGS = {
    'en': { name: 'English', title: 'English' },
    'es-419': { name: 'Español', title: 'Español (Latinoamérica)' },
    'pt-BR': { name: 'Português', title: 'Português (Brasil)' }
  };
  // A pack's code: a language of 2 or 3 letters and up to two subtags. Nothing
  // else is ever put into a URL.
  var CODE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8}){0,2}$/;
  // HTML's own whitespace, not \s: a no-break space is part of the text.
  var WS = /[ \t\n\r\f]+/g;
  var LEAD = /^[ \t\n\r\f]*/, TRAIL = /[ \t\n\r\f]*$/;
  function textKey(s) { return String(s == null ? '' : s).replace(WS, ' ').replace(/^ | $/g, ''); }
  function attrKey(s) { return String(s == null ? '' : s).replace(/^[ \t\n\r\f]+|[ \t\n\r\f]+$/g, ''); }
  var PH = /\{([A-Za-z_$][\w$]*)\}/g;
  // {name} placeholders filled from vars; a name vars does not have stays as written.
  function fill(s, vars) {
    s = String(s);
    if (!vars) return s;
    return s.replace(PH, function (m, k) {
      return Object.prototype.hasOwnProperty.call(vars, k) && vars[k] != null ? String(vars[k]) : m;
    });
  }
  // The placeholder names in a string, in order (a name used twice is listed twice).
  function placeholders(s) {
    var out = [], re = new RegExp(PH.source, 'g'), m;
    while ((m = re.exec(String(s)))) out.push(m[1]);
    return out;
  }
  var MESSAGE_NAMES = ['error', 'err', 'reason', 'message', 'msg', 'detail', 'details', 'why', 'cause'];
  var MESSAGE = new RegExp('^(' + MESSAGE_NAMES.join('|') + ')[0-9]*$');
  function isMessageName(name) { return MESSAGE.test(String(name)); }
  // A string's HTML tags: every <tag ...> and </tag> token (quoted attribute
  // values read whole, so a ">" inside one does not end the tag), whitespace
  // runs in it collapsed, sorted. tools/i18n-extract.js --check uses the same.
  var TAG = /<\/?[A-Za-z](?:[^>"']|"[^"]*"|'[^']*')*>/g;
  function tagsOf(s) {
    return (String(s).match(TAG) || []).map(function (x) { return x.replace(/\s+/g, ' '); }).sort();
  }
  function sameTags(a, b) { return tagsOf(a).join('\u0000') === tagsOf(b).join('\u0000'); }

  // ---- the matcher: exact keys, templates, message placeholders --------------------
  var MIN_LETTERS = 4, MAX_DEPTH = 3, HEAD = 8;
  var LETTER = /[A-Za-z]/g;
  function letters(s) { var m = String(s).match(LETTER); return m ? m.length : 0; }
  var FOUR = /[A-Za-z][^A-Za-z]*[A-Za-z][^A-Za-z]*[A-Za-z][^A-Za-z]*[A-Za-z]/;
  function reEscape(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  // A key with placeholders as a template: { key, lits, names, re, size }, or
  // null when it cannot be matched (no placeholder, two placeholders with
  // nothing between them, fewer than 4 letters in its literal parts).
  function template(key) {
    key = String(key);
    var lits = [], names = [], re = new RegExp(PH.source, 'g'), at = 0, m;
    while ((m = re.exec(key))) { lits.push(key.slice(at, m.index)); names.push(m[1]); at = m.index + m[0].length; }
    if (!names.length) return null;
    lits.push(key.slice(at));
    for (var i = 1; i < lits.length - 1; i++) if (lits[i] === '') return null;
    var all = lits.join('');
    if (letters(all) < MIN_LETTERS) return null;
    // a name used twice is the same value twice: a backreference
    var src = '^', group = {}, n = 0;
    for (i = 0; i < names.length; i++) {
      src += reEscape(lits[i]);
      if (Object.prototype.hasOwnProperty.call(group, names[i])) src += '\\' + group[names[i]];
      else { group[names[i]] = ++n; src += '([\\s\\S]+?)'; }
    }
    src += reEscape(lits[lits.length - 1]) + '$';
    return { key: key, lits: lits, names: names, re: new RegExp(src), size: all.length };
  }
  // A whole word of a template's literal parts (a run of 3+ letters with a
  // non-letter or the end of the key on each side, never against a
  // placeholder), the longest: the index for a template whose ends are both
  // placeholders.
  function innerWord(tp) {
    var best = '';
    for (var i = 0; i < tp.lits.length; i++) {
      var s = tp.lits[i], re = /[A-Za-z]{3,}/g, m;
      while ((m = re.exec(s))) {
        var a = m.index, b = a + m[0].length;
        if ((a === 0 && i > 0) || (b === s.length && i < tp.lits.length - 1)) continue;
        if (m[0].length > best.length) best = m[0];
      }
    }
    return best;
  }
  // The lookup over one pack: strings is a Map (or an object) of key -> translation.
  function matcher(strings) {
    var map = strings instanceof Map ? strings : new Map(Object.keys(strings || {}).map(function (k) { return [k, strings[k]]; }));
    var heads = new Map(), tails = new Map(), words = new Map(), scan = [], headLens = [], tailLens = [], count = 0, order = 0;
    function put(idx, k, tp) { var l = idx.get(k); if (!l) idx.set(k, l = []); l.push(tp); }
    function addLen(list, n) { if (list.indexOf(n) < 0) { list.push(n); list.sort(function (a, b) { return a - b; }); } }
    map.forEach(function (tr, key) {
      if (key.indexOf('{') < 0) return;
      var tp = template(key);
      if (!tp) return;
      tp.tr = tr; tp.order = order++; count++;
      var lead = tp.lits[0], tail = tp.lits[tp.lits.length - 1], w;
      if (lead.length >= 3 || (lead && tail.length < 3)) { var h = lead.slice(0, HEAD); put(heads, h, tp); addLen(headLens, h.length); }
      else if (tail) { var e = tail.slice(-HEAD); put(tails, e, tp); addLen(tailLens, e.length); }
      else if ((w = innerWord(tp))) put(words, w, tp);
      else scan.push(tp);
    });
    // the templates text could match, each once
    function candidates(text) {
      var out = [], i, l;
      for (i = 0; i < headLens.length && headLens[i] <= text.length; i++) if ((l = heads.get(text.slice(0, headLens[i])))) out.push.apply(out, l);
      for (i = 0; i < tailLens.length && tailLens[i] <= text.length; i++) if ((l = tails.get(text.slice(text.length - tailLens[i])))) out.push.apply(out, l);
      if (words.size) {
        var seen = new Set(), re = /[A-Za-z]{3,}/g, m;
        while ((m = re.exec(text))) if (!seen.has(m[0])) { seen.add(m[0]); if ((l = words.get(m[0]))) out.push.apply(out, l); }
      }
      return scan.length ? out.concat(scan) : out;
    }
    // the best template for one form of the text: [template, its match] or null
    function best(k) {
      if (!FOUR.test(k)) return null;
      var list = candidates(k), tp0 = null, m0 = null;
      for (var i = 0; i < list.length; i++) {
        var tp = list[i];
        if (tp0 && (tp.size < tp0.size || (tp.size === tp0.size && tp.order > tp0.order))) continue;
        var ok = true;
        for (var j = 0; j < tp.lits.length && ok; j++) if (tp.lits[j] && k.indexOf(tp.lits[j]) < 0) ok = false;
        if (!ok) continue;
        var m = tp.re.exec(k);
        if (m) { tp0 = tp; m0 = m; }
      }
      return tp0 ? [tp0, m0] : null;
    }
    // { key, translation, values } for text, or null. The text as it is, then
    // trimmed (an attribute's key: inner line breaks and spaces kept), then
    // with every whitespace run collapsed (a text node's key); templates are
    // tried on the last two. depth: how many messages deep this lookup is (0
    // for the text itself, 1 for a message inside it, at most MAX_DEPTH).
    function match(text, depth) {
      if (text == null) return null;
      text = String(text);
      if (!text) return null;
      var a = attrKey(text), c = textKey(text), forms = [text];
      if (a !== text) forms.push(a);
      if (c !== a) forms.push(c);
      for (var f = 0; f < forms.length; f++) {
        var tr = map.get(forms[f]);
        if (tr !== undefined && forms[f]) return { key: forms[f], translation: tr, values: null };
      }
      if (!count) return null;
      var hit = best(a) || (c !== a ? best(c) : null);
      if (!hit) return null;
      var tp = hit[0], m = hit[1], values = {}, g = 0;
      for (var n = 0; n < tp.names.length; n++) {
        var name = tp.names[n];
        if (Object.prototype.hasOwnProperty.call(values, name)) continue;
        var v = m[++g];
        values[name] = isMessageName(name) ? message(v, depth + 1) : v;
      }
      return { key: tp.key, translation: fill(tp.tr, values), values: values };
    }
    // a message's text, translated when the pack knows it (exact or template)
    function message(v, depth) {
      if (typeof v !== 'string' || depth > MAX_DEPTH) return v;
      var r = match(v, depth);
      return r ? r.translation : v;
    }
    function lookup(text) { var r = match(text, 0); return r ? r.translation : undefined; }
    // t(): the exact key (never normalized, never a template), its message
    // placeholders' values looked up
    function t(en, vars) {
      en = String(en);
      var tr = map.get(en);
      return fill(tr !== undefined ? tr : en, messages(vars, 0));
    }
    function messages(vars, depth) {
      if (!vars || typeof vars !== 'object') return vars;
      var out = null;
      for (var k in vars) {
        if (!Object.prototype.hasOwnProperty.call(vars, k) || !isMessageName(k) || typeof vars[k] !== 'string') continue;
        var v = message(vars[k], depth + 1);
        if (v !== vars[k]) { if (!out) out = Object.assign({}, vars); out[k] = v; }
      }
      return out || vars;
    }
    function server(s) { var r = typeof s === 'string' ? lookup(s) : undefined; return r !== undefined ? r : s; }
    return { lookup: lookup, match: function (text) { return match(text, 0); }, exact: function (k) { return map.get(k); }, t: t, server: server,
      templates: count, size: map.size,
      index: { heads: heads.size, tails: tails.size, words: words.size, scan: scan.length, headLens: headLens.slice(), tailLens: tailLens.slice() } };
  }
  // A pack's strings as the page uses them: empty translations are untranslated
  // strings, and a translation whose tags differ from its key's is left out.
  function packStrings(strings) {
    var m = new Map(), dropped = [];
    for (var k in strings) {
      if (!Object.prototype.hasOwnProperty.call(strings, k)) continue;
      var tr = strings[k];
      if (typeof tr !== 'string' || attrKey(tr) === '') continue;
      if (!sameTags(k, tr)) { dropped.push(k); continue; }
      m.set(k, tr);
    }
    return { map: m, dropped: dropped };
  }
  var rules = { LANGS: LANGS, KEY: KEY, PACK_KEY: PACK_KEY, CODE: CODE, MESSAGE_NAMES: MESSAGE_NAMES, MIN_LETTERS: MIN_LETTERS, MAX_DEPTH: MAX_DEPTH,
    textKey: textKey, attrKey: attrKey, fill: fill, placeholders: placeholders, isMessageName: isMessageName,
    tagsOf: tagsOf, sameTags: sameTags, template: template, matcher: matcher, packStrings: packStrings };
  if (typeof module === 'object' && module && module.exports) { module.exports = rules; return; }

  // ---- which language, and its strings --------------------------------------------
  var wanted = 'en';
  try { var v = localStorage.getItem(KEY); if (v) wanted = v; } catch (e) { /* blocked: English */ }
  var lang = 'en', M = null;
  function packFrom(p, code) {
    if (!p || typeof p !== 'object' || p.lang !== code || !p.strings || typeof p.strings !== 'object') return null;
    var r = packStrings(p.strings);
    if (r.dropped.length) console.warn('i18n: ' + r.dropped.length + ' translation' + (r.dropped.length === 1 ? '' : 's') + ' in the ' + code
      + ' pack left out: the HTML tags differ from the English (those strings show in English). The first: ' + JSON.stringify(r.dropped[0]));
    return r.map;
  }
  if (wanted !== 'en' && CODE.test(wanted)) {
    var pack = null, why = '';
    try {
      var raw = localStorage.getItem(PACK_KEY);
      if (raw) { var p = JSON.parse(raw); if (p && p.lang === wanted) pack = packFrom(p, wanted); }
    } catch (e) { /* no test pack */ }
    if (!pack) {
      try {
        var x = new XMLHttpRequest();
        x.open('GET', '/lang/' + wanted + '.json', false);
        x.overrideMimeType('text/plain; charset=utf-8');
        x.send();
        if (x.status !== 200) why = 'HTTP ' + x.status;
        else {
          try { pack = packFrom(JSON.parse(x.responseText), wanted); } catch (e) { why = 'not valid JSON (' + e.message + ')'; }
          if (!pack && !why) why = 'not a ' + wanted + ' pack ("lang" and "strings" are required)';
        }
      } catch (e) { why = String(e && e.message || e); }
      if (!pack) console.warn('i18n: the ' + wanted + ' pack /lang/' + wanted + '.json could not be used (' + why + '); the Studio stays in English.');
    }
    if (pack) { lang = wanted; M = matcher(pack); }
  }

  function lookup(key) { return M && key ? M.lookup(key) : undefined; }
  function t(en, vars) { return M ? M.t(en, vars) : fill(en, vars); }
  function server(s) { return M ? M.server(s) : s; }
  var stats = { visits: 0, writes: 0 };
  // The Options row's switch: true when the choice is kept (the caller reloads).
  function choose(code) {
    if (typeof code !== 'string' || !CODE.test(code)) return false;
    try { localStorage.setItem(KEY, code); return localStorage.getItem(KEY) === code; } catch (e) { return false; }
  }
  window.t = t;
  window.I18n = {
    lang: lang, wanted: wanted, LANGS: LANGS, active: false,
    t: t, server: server, choose: choose, textKey: textKey, attrKey: attrKey, fill: fill,
    stats: function () { return { visits: stats.visits, writes: stats.writes, keys: M ? M.size : 0, templates: M ? M.templates : 0 }; },
    pass: function () { /* English: nothing to translate */ }
  };
  if (lang === 'en') return;

  // ---- the observer (another language only) ---------------------------------------
  var root = document.documentElement;
  root.setAttribute('lang', lang);
  var ATTRS = ['title', 'placeholder', 'aria-label', 'alt'];
  var textMem = new WeakMap();   // Text -> { src: the English, out: what was written }
  var attrMem = new WeakMap();   // Element -> { attribute: what was written }
  var htmlMem = new WeakMap();   // Element (data-i18n="html") -> its innerHTML as written
  // 2: leave the element and everything in it alone, its own attributes too
  // (translate="no", script, style); 1: leave what is IN it alone but
  // translate its own attributes - a textarea's placeholder is UI, its text is
  // the user's (textarea, code, pre, contenteditable); 0: translate it.
  // tools/i18n-extract.js has the same rule.
  function skipLevel(n) {
    var tr = n.getAttribute('translate');
    if (tr !== null && tr.toLowerCase() === 'no') return 2;
    var name = n.localName;
    if (name === 'script' || name === 'style') return 2;
    if (name === 'textarea' || name === 'code' || name === 'pre') return 1;
    var ce = n.getAttribute('contenteditable');
    return ce !== null && ce.toLowerCase() !== 'false' ? 1 : 0;
  }
  // Where an element stands: inside something skipped, or inside a
  // data-i18n="html" element (which then owns it), or free. self: the
  // question is the element's own attributes, not what is in it.
  function place(n, self) {
    var html = null;
    for (var e = n; e && e.nodeType === 1; e = e.parentNode) {
      var own = self && e === n, lv = skipLevel(e);
      if (lv === 2 || (lv === 1 && !own)) return { skip: true };
      if (!own && e.getAttribute('data-i18n') === 'html') html = e;
    }
    return { skip: false, html: html };
  }
  function doText(node) {
    stats.visits++;
    var data = node.data, m = textMem.get(node), src = data;
    if (m) {
      if (data === m.out) return;
      // The parser appended the rest of a long text to a node already
      // translated: the English is what was there plus what came after.
      if (m.out && data.length > m.out.length && data.slice(0, m.out.length) === m.out) src = m.src + data.slice(m.out.length);
    }
    var tr = lookup(textKey(src));
    if (tr === undefined) {
      if (m) { textMem.delete(node); if (src !== data) { stats.writes++; node.data = src; } }
      return;
    }
    var out = LEAD.exec(src)[0] + tr + TRAIL.exec(src)[0];
    textMem.set(node, { src: src, out: out });
    if (out !== data) { stats.writes++; node.data = out; }
  }
  function doAttrs(el) {
    for (var i = 0; i < ATTRS.length; i++) {
      var a = ATTRS[i], v = el.getAttribute(a);
      if (v === null) continue;
      var m = attrMem.get(el);
      if (m && m[a] === v) continue;
      var tr = lookup(attrKey(v));
      if (tr === undefined) { if (m) delete m[a]; continue; }
      if (!m) attrMem.set(el, m = {});
      m[a] = tr;
      if (tr !== v) { stats.writes++; el.setAttribute(a, tr); }
    }
  }
  // a data-i18n="html" sentence is one exact key (a static sentence, never a template)
  function doHtml(el) {
    stats.visits++;
    var s = el.innerHTML;
    if (htmlMem.get(el) === s) return;
    var tr = M.exact(textKey(s));
    if (tr === undefined) return;
    stats.writes++;
    el.innerHTML = tr;
    htmlMem.set(el, el.innerHTML);
  }
  // An element whose own attributes are done here, and whether to go inside it.
  function enter(n) {
    var lv = skipLevel(n);
    if (lv === 2) return false;
    doAttrs(n);
    if (lv === 1) return false;
    if (n.getAttribute('data-i18n') === 'html') { doHtml(n); return false; }
    return true;
  }
  var FILTER = {
    acceptNode: function (n) {
      if (n.nodeType === 3) return NodeFilter.FILTER_ACCEPT;
      return enter(n) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    }
  };
  // A node and everything under it, from a node already known to be free.
  function walk(n) {
    if (n.nodeType === 3) { doText(n); return; }
    if (n.nodeType !== 1 || !enter(n) || !n.firstChild) return;
    var w = document.createTreeWalker(n, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, FILTER), c;
    while ((c = w.nextNode())) if (c.nodeType === 3) doText(c);
  }
  function visit(n) {
    if (!n.isConnected) return;
    var parent = n.parentNode;
    if (!parent || (parent.nodeType !== 1 && parent.nodeType !== 9)) return;
    var at = parent.nodeType === 1 ? place(parent, false) : { skip: false, html: null };
    if (at.skip) return;
    if (at.html) { doHtml(at.html); return; }
    walk(n);
  }
  var mo = new MutationObserver(function (list) {
    // One batch can name a node more than once; a node is walked once and an
    // element's four attributes are read once.
    var walked = new Set(), attrsRead = new Set();
    for (var i = 0; i < list.length; i++) {
      var r = list[i], n;
      if (r.type === 'childList') {
        for (var j = 0; j < r.addedNodes.length; j++) {
          n = r.addedNodes[j];
          if (!walked.has(n)) { walked.add(n); visit(n); }
        }
      } else if (r.type === 'characterData') {
        n = r.target;
        if (!walked.has(n)) { walked.add(n); visit(n); }
      } else if (!attrsRead.has(r.target)) {
        attrsRead.add(r.target);
        var at = place(r.target, true);
        if (at.skip) continue;
        if (at.html) doHtml(at.html); else doAttrs(r.target);
      }
    }
  });
  mo.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  window.I18n.active = true;
  // A whole subtree on demand; and once the parser is done, the whole page.
  window.I18n.pass = function (n) { visit(n || document.documentElement); };
  document.addEventListener('DOMContentLoaded', function () { visit(document.documentElement); });
})();
