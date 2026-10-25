// THE COMPARE BOX'S JUDGE, kept out of the page so node can test it.
//
// The boot page prints a Build ID line and asks two players to match twelve
// hex characters by eye, over chat, twice (the Engine ID too) - and the online
// check that follows only ever says "differ", never which rule broke. This
// module does the reading instead. "Copy mine" turns the page's globals into
// one chat-pasteable line; "Check" takes a friend's line back - the old plain
// boot line or the richer copied one - and returns one verdict per rule that
// netplay enforces: content, engine, netcode, theme. When both lines carry
// the three part hashes it also names WHICH of shipped / mods / theme moved,
// which is the one question the wire check cannot answer.
//
// Pure functions, no DOM, no network: the page hands in its own globals and
// renders the strings that come back with textContent. Everything a friend
// typed passes through here as data and only ever compares equal or not.
//
//   ikemenBuildCompare.parse(text)          -> { build, engine, engineUnavailable, netcode, upload, parts }
//   ikemenBuildCompare.line(mine)           -> 'Build ID: ...   Engine: ...   Netcode: ...   Upload: ...   Parts: s/m/t'
//   ikemenBuildCompare.verdict(mine, text)  -> { lines: [{ state, text }], ready }
//
// `mine` is { build, engine, netcode, upload, parts } straight from the page:
// engine undefined = the wasm is still downloading, '' = its hash failed
// (the page writes exactly those two), upload absent on an unpacked dev
// server, parts { shipped, mods, motif } from the shared Build ID function.
(function (root) {
  'use strict';

  // Twelve hex and not one more: a longer token is some other number, not a
  // Build ID with extra digits, and must not be silently truncated to fit.
  const HEX12 = '([0-9a-f]{12})(?![0-9a-f])';
  function hex(v) {
    const s = String(v == null ? '' : v).trim().toLowerCase();
    return /^[0-9a-f]{12}$/.test(s) ? s : '';
  }
  function grab(text, label) {
    const m = new RegExp(label + '\\s*:?\\s*' + HEX12, 'i').exec(text);
    return m ? m[1].toLowerCase() : '';
  }

  // Tolerant on purpose: the friend may paste the line from their loading
  // screen (with its trailing parenthetical), the copied line with every
  // field, the older fallback where the Engine ID sits on its own line, the
  // whole boot log, or just two bare numbers. Labeled fields win; bare
  // twelve-hex tokens fill in Build and Engine, in that order, only when the
  // labels are missing.
  function parse(text) {
    const t = String(text == null ? '' : text);
    const out = {
      build: grab(t, 'Build ID'),
      engine: grab(t, 'Engine(?: ID)?'),
      engineUnavailable: /Engine(?: ID)?\s*:?\s*unavailable/i.test(t),
      netcode: '',
      upload: grab(t, 'Upload'),
      parts: null,
    };
    const pm = new RegExp('Parts\\s*:?\\s*' + HEX12 + '\\s*/\\s*' + HEX12 + '\\s*/\\s*' + HEX12, 'i').exec(t);
    if (pm) out.parts = { shipped: pm[1].toLowerCase(), mods: pm[2].toLowerCase(), motif: pm[3].toLowerCase() };
    // A tick wins: a copy of the whole boot strip carries BOTH selector
    // labels run together ("Online netcode: RollbackDelay \u2713"), which
    // neither the label nor a bare word can read - the ticked one is the
    // choice. Then the labeled field of the copied line, then a bare word.
    const nm = /(rollback|delay)\s*\u2713/i.exec(t)
      || /Netcode\s*:?\s*(rollback|delay)\b/i.exec(t)
      || /\b(rollback|delay)\b/i.exec(t);
    if (nm) out.netcode = nm[1].toLowerCase();
    if (!out.build || !out.engine) {
      // Bare tokens, minus the ones a label already claimed - an Upload stamp
      // must never be mistaken for a Build ID because the label was missing,
      // and a labeled Build ID must not double as the engine when that line
      // reads "Engine: unavailable".
      const claimed = [out.build, out.engine, out.upload]
        .concat(out.parts ? [out.parts.shipped, out.parts.mods, out.parts.motif] : []).filter(Boolean);
      const re = /(^|[^0-9a-f])([0-9a-f]{12})(?![0-9a-f])/gi;
      const bare = [];
      let m;
      while ((m = re.exec(t))) {
        const v = m[2].toLowerCase();
        const i = claimed.indexOf(v);
        if (i >= 0) claimed.splice(i, 1); else bare.push(v);
      }
      if (!out.build && bare.length) out.build = bare.shift();
      if (!out.engine && bare.length) out.engine = bare.shift();
    }
    return out;
  }

  function normMine(mine) {
    const m = mine || {};
    const p = m.parts || {};
    const parts = hex(p.shipped) && hex(p.mods) && hex(p.motif)
      ? { shipped: hex(p.shipped), mods: hex(p.mods), motif: hex(p.motif) } : null;
    const nc = String(m.netcode || '').toLowerCase();
    return {
      build: hex(m.build),
      engine: hex(m.engine),
      enginePending: m.engine === undefined || m.engine === null,
      engineFailed: m.engine === '',
      netcode: nc === 'rollback' || nc === 'delay' ? nc : '',
      upload: hex(m.upload),
      parts: parts,
    };
  }

  // The chat line. Same three-space rhythm as the boot line so the two look
  // like one family, and a field that is not known is left out rather than
  // written as a placeholder - the verdict treats an absent field as unknown,
  // and a placeholder would parse as nothing anyway.
  function line(mine) {
    const m = normMine(mine);
    const out = ['Build ID: ' + (m.build || 'unavailable')];
    if (m.engine) out.push('Engine: ' + m.engine);
    else if (m.engineFailed) out.push('Engine: unavailable');
    if (m.netcode) out.push('Netcode: ' + m.netcode);
    if (m.upload) out.push('Upload: ' + m.upload);
    if (m.parts) out.push('Parts: ' + m.parts.shipped + '/' + m.parts.mods + '/' + m.parts.motif);
    return out.join('   ');
  }

  function cap(nc) { return nc === 'delay' ? 'Delay' : nc === 'rollback' ? 'Rollback' : nc; }
  function joinList(a) {
    return a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];
  }

  // One line per rule, then a summary. States: ok / differs / unknown, plus
  // error for the two cases where there is nothing to judge at all. The
  // wording steers to "same upload / same build", never "install the same
  // mods": two builds assembled separately from the same mods never share an
  // ID, so that advice would send players in circles.
  function verdict(mine, text) {
    const me = normMine(mine);
    const t = parse(text);
    const lines = [];
    const add = (state, msg) => { lines.push({ state: state, text: msg }); };
    if (!me.build) {
      add('error', 'Your own Build ID is not available - hard-refresh (Ctrl+F5) and try again.');
      return { lines: lines, ready: 'error' };
    }
    if (!t.build) {
      add('error', "No Build ID found. Copy the whole 'Build ID: ...' line from their loading screen.");
      return { lines: lines, ready: 'error' };
    }

    // Rule 1, content. The combined ID is the verdict; the parts only explain
    // it, so a matching ID is a match even if a mangled Parts field disagrees.
    const sameBuild = me.build === t.build;
    const parts = !sameBuild && me.parts && t.parts ? {
      shipped: me.parts.shipped !== t.parts.shipped,
      mods: me.parts.mods !== t.parts.mods,
      motif: me.parts.motif !== t.parts.motif,
    } : null;
    const STUDIO_FIX = 'Make both sides identical (Send my build / Import a build on the Studio page), '
      + 'or use Reset (Browser data, below) on the side that changed things. A refresh will NOT clear it.';
    const UPLOAD_FIX = 'Both open the same link and hard-refresh (Ctrl+F5).';
    if (sameBuild) {
      add('ok', 'Content: same (Build ID matches - roster, added content and theme agree)');
    } else if (parts) {
      const causes = [], fixes = [];
      if (parts.shipped) { causes.push('different upload of the site'); fixes.push(UPLOAD_FIX); }
      if (parts.mods) { causes.push('added or changed content in the Studio'); fixes.push(STUDIO_FIX); }
      if (parts.motif) { causes.push('a different theme'); fixes.push('Pick the same theme on both sides (Studio page).'); }
      if (!causes.length) {
        add('differs', 'Content: DIFFERS - yet all three parts match, so the pasted line is probably mangled. Copy it again.');
      } else {
        add('differs', 'Content: DIFFERS - ' + joinList(causes) + '. ' + fixes.join(' '));
      }
    } else if (me.upload && t.upload && me.upload !== t.upload) {
      add('differs', 'Content: DIFFERS - you are on different uploads of the site. ' + UPLOAD_FIX);
    } else {
      let msg = 'Content: DIFFERS - one of you added, removed, edited or rearranged something in the Studio, '
        + 'or picked a different theme. ' + STUDIO_FIX;
      if (!(me.upload && t.upload)) msg += ' (No Upload stamp on both lines to compare, so a different upload of the site is possible too.)';
      add('differs', msg);
    }

    // Rule 1, engine. Pending is not a match: the wasm lands last.
    if (me.enginePending) add('unknown', 'Engine: not loaded yet - wait for the engine download to finish, then Check again');
    else if (me.engineFailed || !me.engine) add('unknown', "Engine: yours reads 'unavailable' - hard-refresh (Ctrl+F5) and try again");
    else if (t.engineUnavailable && !t.engine) add('unknown', "Engine: theirs reads 'unavailable' - they should hard-refresh (Ctrl+F5) and copy the line again");
    else if (!t.engine) add('unknown', "Engine: not in the pasted text - their line should read 'Engine: ...'");
    else if (me.engine === t.engine) add('ok', 'Engine: same');
    else add('differs', 'Engine: DIFFERS - one of you has an older copy of the site. Both hard-refresh (Ctrl+F5); if it still differs you are on different versions.');

    // Rule 2, netcode. The selector is the row below this one.
    if (!me.netcode) add('unknown', 'Netcode: your own setting is not available - reload the page');
    else if (!t.netcode) add('unknown', 'Netcode: not in the pasted text - ask which button is ticked on their side (yours: ' + cap(me.netcode) + ')');
    else if (me.netcode === t.netcode) add('ok', 'Netcode: same (' + cap(me.netcode) + ')');
    else add('differs', 'Netcode: DIFFERS - you: ' + cap(me.netcode) + ', them: ' + cap(t.netcode) + '. One of you switches it below.');

    // Rule 3, theme. It is hashed into the Build ID, so a matching ID settles
    // it; apart from that only the motif part can tell it from other content.
    if (sameBuild) add('ok', 'Theme: same (it is part of the Build ID)');
    else if (parts) {
      if (parts.motif) add('differs', 'Theme: DIFFERS - pick the same theme on both sides (Studio page).');
      else add('ok', 'Theme: same');
    } else {
      add('unknown', 'Theme: cannot be told apart - their line has no Parts field (older copy of the site), so the Content line covers it');
    }

    const states = lines.map((l) => l.state);
    const ready = states.indexOf('differs') >= 0 ? 'not-ready' : states.indexOf('unknown') >= 0 ? 'unknown' : 'ready';
    if (ready === 'ready') add('ok', 'Ready to play.');
    else if (ready === 'unknown') add('unknown', 'Ready once the unknown lines are confirmed.');
    else add('differs', 'Not ready - fix the lines marked DIFFERS first.');
    return { lines: lines, ready: ready };
  }

  const api = { parse: parse, line: line, verdict: verdict };
  root.ikemenBuildCompare = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
