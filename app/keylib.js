'use strict';
// KEY AND GAMEPAD BINDINGS - the [Keys_Pn] and [Joystick_Pn] sections.
//
// settings-schema.js catalogs 133 config keys and deliberately leaves these
// out, in its own words, because "they need a capture UI, not a text field".
// This is that: the names the engine parses, the shipped defaults, the conflict
// rule the engine's own key-config screen uses, and the ini text both exports
// write. The Studio page renders what this serves and sends back what was
// pressed; nothing about a binding is decided in the page.
//
// THE ENGINE RULES (source at ikemen-go-src/src, 96413d2):
//
//  * A NAME IS A NAME OR IT IS NOTHING. StringToKey (input_js.go:318,
//    input_sdl.go:231) is a map lookup with KeyUnknown - zero - as the missing
//    value, and OnKeyPressed never records a press for KeyUnknown
//    (input.go:160), so keyState[0] is never true. An unrecognized name is
//    therefore a SILENTLY DEAD binding: that action can never fire, with no
//    warning anywhere. Buttons behave the same in effect - a bad token was
//    driven in-game and the button was simply absent, not stacked onto A.
//  * THE TWO BACKENDS ACCEPT EXACTLY THE SAME 117 NAMES. KeyToStringLUT is
//    written out twice, once for the browser build (input_js.go:161-193) and
//    once for SDL (input_sdl.go:49-165), and the two lists are identical - so
//    one set of names is right for the website and for a desktop export.
//  * "Not used" IS NOT A KEY NAME. It is the screenpack's `nokey` value, and
//    it unbinds precisely because StringToKey does not know it. The engine
//    reads the sentinel back out of its own shipped defaults - `[Keys_P3] menu`
//    (system.go:1509) - and compares by string, which is why that line must
//    never leave defaultConfig.ini.
//  * `Players` DECIDES HOW MANY SLOTS EXIST. sysSet loops 1..Players
//    (config.go:407) and builds one keyboard and one joystick config per slot.
//    A keyboard slot with no section gets KeyConfig{Joy: -1} - every action
//    dead (config.go:431). A joystick slot with no section gets
//    KeyConfig{Joy: i-1} with every field left at zero, and zero is button A
//    (config.go:456), so all fourteen actions land on A at once. The engine
//    ships [Keys_P1..P4] and [Joystick_P1..P4], so that only bites slots 5-8.
//  * A PARTIAL SECTION IS FINE. loadConfig merges the engine's own
//    defaultConfig.ini first and overlays the user file key by key
//    (config.go:311-315), so a section may name only the bindings this build
//    decides and the rest stay the engine's.
//  * CONFLICTS ARE GROUPED BY CONTROLLER, NOT BY SLOT. The engine's key-config
//    screen counts every bound token per `Joystick` value
//    (external/script/options.lua:1917-1931) and marks a row that shares one.
//    Every keyboard section carries Joystick = -1, so P1 and P2 sharing a key
//    is a conflict on that screen; two pads on different indexes are not. The
//    unbound sentinel is excluded from the count.
//
// Pure data and text: no file IO, no roster, no DOM.

// The fourteen actions, in the order the engine reads and writes them
// (config.go:409-423, KeysProperties at config.go:21-39).
//
// X Y Z ARE THE PUNCHES AND A B C THE KICKS. The engine gives the buttons no
// meaning - a character's .cmd does - and the convention every character is
// written to is the reference one's: KFM's light punch is `command = "x"` and
// its light kick `command = "a"` (release/chars/kfm/kfm.cmd). This list had
// them the other way round. The build's own layouts agree: P1's i o p (top
// row) are x y z, its k l ; (home row) a b c.
//
// `group` places an action on the Controls page (move, attack, system);
// `kind` and `strength` pick an attack's icon.
const ACTIONS = [
  { key: 'up', label: 'Up', group: 'move' },
  { key: 'down', label: 'Down', group: 'move' },
  { key: 'left', label: 'Left', group: 'move' },
  { key: 'right', label: 'Right', group: 'move' },
  { key: 'a', label: 'A (light kick)', group: 'attack', kind: 'kick', strength: 'light' },
  { key: 'b', label: 'B (medium kick)', group: 'attack', kind: 'kick', strength: 'medium' },
  { key: 'c', label: 'C (heavy kick)', group: 'attack', kind: 'kick', strength: 'heavy' },
  { key: 'x', label: 'X (light punch)', group: 'attack', kind: 'punch', strength: 'light' },
  { key: 'y', label: 'Y (medium punch)', group: 'attack', kind: 'punch', strength: 'medium' },
  { key: 'z', label: 'Z (heavy punch)', group: 'attack', kind: 'punch', strength: 'heavy' },
  { key: 'start', label: 'Start', group: 'system' },
  { key: 'd', label: 'D (extra)', group: 'system' },
  { key: 'w', label: 'W (extra)', group: 'system' },
  { key: 'menu', label: 'Menu', group: 'system' },
];

// The unbound sentinel. The screenpack owns the string and the shipped one
// says this; the engine reads it back out of [Keys_P3] menu and compares by
// equality, so it is a literal on both sides.
const NOKEY = 'Not used';

// Every name StringToKey accepts, in the order KeyToStringLUT is written, and
// the browser KeyboardEvent.code that produces each one (jsCodeToKey,
// input_js.go:251-299). A code that is not in this table has no engine name at
// all and a capture has to say so rather than write something that would read
// as 0.
const KEY_CODES = [
  ['Enter', 'RETURN'], ['Escape', 'ESCAPE'], ['Backspace', 'BACKSPACE'],
  ['Tab', 'TAB'], ['Space', 'SPACE'], ['Quote', 'QUOTE'], ['Comma', 'COMMA'],
  ['Minus', 'MINUS'], ['Period', 'PERIOD'], ['Slash', 'SLASH'],
  ['Digit0', '0'], ['Digit1', '1'], ['Digit2', '2'], ['Digit3', '3'],
  ['Digit4', '4'], ['Digit5', '5'], ['Digit6', '6'], ['Digit7', '7'],
  ['Digit8', '8'], ['Digit9', '9'],
  ['Semicolon', 'SEMICOLON'], ['Equal', 'EQUALS'], ['BracketLeft', 'LBRACKET'],
  ['Backslash', 'BACKSLASH'], ['BracketRight', 'RBRACKET'], ['Backquote', 'BACKQUOTE'],
  ['KeyA', 'a'], ['KeyB', 'b'], ['KeyC', 'c'], ['KeyD', 'd'], ['KeyE', 'e'],
  ['KeyF', 'f'], ['KeyG', 'g'], ['KeyH', 'h'], ['KeyI', 'i'], ['KeyJ', 'j'],
  ['KeyK', 'k'], ['KeyL', 'l'], ['KeyM', 'm'], ['KeyN', 'n'], ['KeyO', 'o'],
  ['KeyP', 'p'], ['KeyQ', 'q'], ['KeyR', 'r'], ['KeyS', 's'], ['KeyT', 't'],
  ['KeyU', 'u'], ['KeyV', 'v'], ['KeyW', 'w'], ['KeyX', 'x'], ['KeyY', 'y'],
  ['KeyZ', 'z'],
  ['CapsLock', 'CAPSLOCK'],
  ['F1', 'F1'], ['F2', 'F2'], ['F3', 'F3'], ['F4', 'F4'], ['F5', 'F5'],
  ['F6', 'F6'], ['F7', 'F7'], ['F8', 'F8'], ['F9', 'F9'], ['F10', 'F10'],
  ['F11', 'F11'], ['F12', 'F12'], ['F13', 'F13'], ['F14', 'F14'], ['F15', 'F15'],
  ['F16', 'F16'], ['F17', 'F17'], ['F18', 'F18'], ['F19', 'F19'], ['F20', 'F20'],
  ['F21', 'F21'], ['F22', 'F22'], ['F23', 'F23'], ['F24', 'F24'],
  ['PrintScreen', 'PRINTSCREEN'], ['ScrollLock', 'SCROLLLOCK'], ['Pause', 'PAUSE'],
  ['Insert', 'INSERT'], ['Home', 'HOME'], ['PageUp', 'PAGEUP'],
  ['Delete', 'DELETE'], ['End', 'END'], ['PageDown', 'PAGEDOWN'],
  ['ArrowRight', 'RIGHT'], ['ArrowLeft', 'LEFT'], ['ArrowDown', 'DOWN'], ['ArrowUp', 'UP'],
  ['NumLock', 'NUMLOCKCLEAR'],
  ['NumpadDivide', 'KP_DIVIDE'], ['NumpadMultiply', 'KP_MULTIPLY'],
  ['NumpadSubtract', 'KP_MINUS'], ['NumpadAdd', 'KP_PLUS'], ['NumpadEnter', 'KP_ENTER'],
  ['Numpad1', 'KP_1'], ['Numpad2', 'KP_2'], ['Numpad3', 'KP_3'], ['Numpad4', 'KP_4'],
  ['Numpad5', 'KP_5'], ['Numpad6', 'KP_6'], ['Numpad7', 'KP_7'], ['Numpad8', 'KP_8'],
  ['Numpad9', 'KP_9'], ['Numpad0', 'KP_0'], ['NumpadDecimal', 'KP_PERIOD'],
  ['NumpadEqual', 'KP_EQUALS'],
  ['ContextMenu', 'MENU'],
  ['ControlLeft', 'LCTRL'], ['ShiftLeft', 'LSHIFT'], ['AltLeft', 'LALT'], ['MetaLeft', 'LGUI'],
  ['ControlRight', 'RCTRL'], ['ShiftRight', 'RSHIFT'], ['AltRight', 'RALT'], ['MetaRight', 'RGUI'],
];
const KEY_NAMES = KEY_CODES.map((p) => p[1]);
const CODE_TO_NAME = {};
for (const [code, name] of KEY_CODES) CODE_TO_NAME[code] = name;

// Names a capture cannot reach, and why. They are still accepted if typed,
// which is the whole reason the text box stays: the engine takes them, an
// ordinary keyboard just cannot produce them.
const UNREACHABLE = {};
for (let i = 13; i <= 24; i++) UNREACHABLE['F' + i] = 'no ordinary keyboard has this key';

// Gamepad tokens, by the number the engine stores them as
// (ButtonToStringLUT, input_js.go:246-256 and input_sdl.go:185-211). 0-14 are
// the SDL GameController buttons, 15-24 are stick and trigger directions read
// as buttons, 25 is the unbound sentinel.
const BUTTON_TOKENS = [
  [0, 'A'], [1, 'B'], [2, 'X'], [3, 'Y'], [4, 'BACK'], [5, 'HOME'], [6, 'START'],
  [7, 'LS'], [8, 'RS'], [9, 'LB'], [10, 'RB'],
  [11, 'DP_U'], [12, 'DP_D'], [13, 'DP_L'], [14, 'DP_R'],
  [15, 'LS_Y-'], [16, 'LS_X-'], [17, 'LS_X+'], [18, 'LS_Y+'],
  [19, 'LT'], [20, 'RT'],
  [21, 'RS_Y-'], [22, 'RS_X-'], [23, 'RS_X+'], [24, 'RS_Y+'],
];
const BUTTON_NAMES = BUTTON_TOKENS.map((p) => p[1]);

// SDL GameController button order -> the browser's standard-mapping button
// index (sdlOrderToBrowser, input_js.go:167-183). Inverted here, because a
// capture reads a browser index and has to write the engine's token.
const SDL_TO_BROWSER = [0, 1, 2, 3, 8, 16, 9, 10, 11, 4, 5, 12, 13, 14, 15];
const PAD_BUTTON_TO_TOKEN = {};
SDL_TO_BROWSER.forEach((browserIdx, sdlIdx) => { PAD_BUTTON_TO_TOKEN[browserIdx] = BUTTON_NAMES[sdlIdx]; });
// The triggers are buttons 6 and 7 to the browser and axes 4 and 5 to the
// engine (input_js.go:427-433), so they are tokens, not buttons.
PAD_BUTTON_TO_TOKEN[6] = 'LT';
PAD_BUTTON_TO_TOKEN[7] = 'RT';
// Browser standard axes are LX LY RX RY; each end of each one is its own token.
const PAD_AXIS_TO_TOKEN = [['LS_X-', 'LS_X+'], ['LS_Y-', 'LS_Y+'], ['RS_X-', 'RS_X+'], ['RS_Y-', 'RS_Y+']];

// ---- the slots --------------------------------------------------------------

// MaxSimul is 4 and Players is clamped to 1..MaxSimul*2 (config.go:333,
// system.go:29), so eight is the most slots there can ever be.
const MAX_PLAYERS = 8;
const SLOT_KINDS = ['Keys', 'Joystick'];
const slotId = (kind, n) => (kind + '_P' + n).toLowerCase();
const slotName = (kind, n) => kind + '_P' + n;

// WHAT A SLOT FALLS BACK TO WHEN THIS BUILD SAYS NOTHING.
//
// Keys_P1 and Keys_P2 are this build's own layout - WASD with the attack
// buttons on the home row, and arrows with the numpad - and are written into
// every export. Everything else is the engine's own defaultConfig.ini, which
// the engine merges in before it reads ours, so leaving a slot alone really
// does mean "whatever the engine ships".
const DEFAULTS = {
  keys_p1: {
    Joystick: -1,
    up: 'w', down: 's', left: 'a', right: 'd',
    a: 'k', b: 'l', c: 'SEMICOLON', x: 'i', y: 'o', z: 'p',
    start: 'RETURN', d: 'q', w: 'e', menu: NOKEY,
  },
  keys_p2: {
    Joystick: -1,
    up: 'UP', down: 'DOWN', left: 'LEFT', right: 'RIGHT',
    a: 'KP_1', b: 'KP_2', c: 'KP_3', x: 'KP_4', y: 'KP_5', z: 'KP_6',
    start: 'KP_ENTER', d: 'KP_7', w: 'KP_8', menu: NOKEY,
  },
  keys_p3: { Joystick: -1 },
  keys_p4: { Joystick: -1 },
};
for (const k of ['up', 'down', 'left', 'right', 'a', 'b', 'c', 'x', 'y', 'z', 'start', 'd', 'w', 'menu']) {
  DEFAULTS.keys_p3[k] = NOKEY;
  DEFAULTS.keys_p4[k] = NOKEY;
}
for (let n = 1; n <= 4; n++) {
  DEFAULTS[slotId('Joystick', n)] = {
    Joystick: n - 1, RumbleOn: 1,
    up: 'DP_U', down: 'DP_D', left: 'DP_L', right: 'DP_R',
    a: 'A', b: 'B', c: 'RT', x: 'X', y: 'Y', z: 'RB',
    start: 'START', d: 'LB', w: 'LT', menu: 'BACK',
  };
}

// This build states Keys_P1 and Keys_P2 because they are its own layout; every
// other slot is stated only once someone has changed it, so an untouched build
// generates the file it has always generated.
const ALWAYS_WRITTEN = ['keys_p1', 'keys_p2'];

function isKeyboard(id) { return String(id).startsWith('keys_'); }
function slotNumber(id) { return parseInt(String(id).split('_p')[1], 10) || 0; }

// ---- validation -------------------------------------------------------------

const KEY_SET = new Set(KEY_NAMES);
const BUTTON_SET = new Set(BUTTON_NAMES);

// A token this build may write, or the reason it may not. The engine takes
// anything and reports nothing, so this is the only check there is.
function checkBinding(id, token) {
  const t = String(token === null || token === undefined ? '' : token).trim();
  if (t === '' || t === NOKEY) return { ok: true, token: NOKEY, unbound: true };
  if (isKeyboard(id)) {
    if (!KEY_SET.has(t)) {
      // Case is not free here: the lookup is a plain map and `A` and `a` are
      // different entries - `a` is the letter and `A` is nothing at all.
      const near = KEY_NAMES.find((n) => n.toLowerCase() === t.toLowerCase());
      return { ok: false, reason: near
        ? 'the engine spells that ' + near + ' - key names are matched exactly, so this would bind nothing'
        : 'the engine has no key called ' + t + ', so this action would never fire' };
    }
    return { ok: true, token: t, unreachable: UNREACHABLE[t] || null };
  }
  if (!BUTTON_SET.has(t)) {
    const near = BUTTON_NAMES.find((n) => n.toLowerCase() === t.toLowerCase());
    return { ok: false, reason: near
      ? 'the engine spells that ' + near
      : 'the engine has no gamepad button called ' + t + ', so this action would be quietly dead' };
  }
  return { ok: true, token: t };
}

// A browser KeyboardEvent.code -> the engine's own name, or null when the key
// has no name at all (IntlBackslash, the media keys, anything a keyboard has
// that the engine's table does not).
function nameForCode(code) {
  return Object.prototype.hasOwnProperty.call(CODE_TO_NAME, code) ? CODE_TO_NAME[code] : null;
}

// ---- the model --------------------------------------------------------------

// Everything the panel needs: the slots the engine will build, what each
// binding is now, what it falls back to, and every conflict.
function model(keys, players) {
  const n = Math.max(1, Math.min(MAX_PLAYERS, parseInt(players, 10) || 4));
  const stored = keys || {};
  const slots = [];
  for (const kind of SLOT_KINDS) {
    for (let i = 1; i <= MAX_PLAYERS; i++) {
      const id = slotId(kind, i);
      const def = DEFAULTS[id] || null;
      const set = stored[id] || {};
      const bindings = ACTIONS.map((a) => ({
        action: a.key,
        label: a.label,
        group: a.group,
        kind: a.kind,
        strength: a.strength,
        value: Object.prototype.hasOwnProperty.call(set, a.key) ? String(set[a.key])
          : (def ? def[a.key] : null),
        set: Object.prototype.hasOwnProperty.call(set, a.key),
        def: def ? def[a.key] : null,
      }));
      slots.push({
        id, name: slotName(kind, i), kind, player: i,
        keyboard: kind === 'Keys',
        built: i <= n,
        // Only a slot beyond what the engine ships has no fallback at all, and
        // the two kinds fail differently - the keyboard one goes dead, the
        // joystick one puts every action on A.
        hasEngineDefault: !!def,
        joystick: Object.prototype.hasOwnProperty.call(set, 'Joystick') ? Number(set.Joystick)
          : (def ? def.Joystick : (kind === 'Keys' ? -1 : i - 1)),
        rumble: kind === 'Joystick'
          ? (Object.prototype.hasOwnProperty.call(set, 'RumbleOn') ? Number(set.RumbleOn) : (def ? def.RumbleOn : 1))
          : null,
        changed: Object.keys(set).length > 0,
        bindings,
      });
    }
  }
  return { players: n, maxPlayers: MAX_PLAYERS, slots, conflicts: conflicts(slots) };
}

// THE ENGINE'S OWN CONFLICT RULE, not an approximation of it: every bound
// token counted per `Joystick` value across the slots the engine builds, and a
// row marked when its token is shared (options.lua:1917-1931, 2295-2299). The
// unbound sentinel never counts. Because every keyboard slot carries
// Joystick = -1, P1 and P2 taking the same key IS a conflict on the engine's
// own screen, which is why this is not grouped by slot.
function conflicts(slots) {
  const byController = new Map();
  for (const s of slots) {
    if (!s.built) continue;
    for (const b of s.bindings) {
      if (!b.value || b.value === NOKEY) continue;
      const k = s.joystick + '\u0000' + b.value;
      if (!byController.has(k)) byController.set(k, []);
      byController.get(k).push({ slot: s.id, slotName: s.name, action: b.action, label: b.label });
    }
  }
  const out = [];
  for (const [k, list] of byController) {
    if (list.length < 2) continue;
    out.push({
      controller: Number(k.split('\u0000')[0]),
      token: k.split('\u0000').slice(1).join('\u0000'),
      where: list,
    });
  }
  return out.sort((a, b) => a.token.localeCompare(b.token));
}

// ---- writing ---------------------------------------------------------------

// Only what differs from the fallback is kept, the way the engine settings are
// stored: an untouched binding then follows whatever this build or the engine
// ships, instead of being pinned to today's value forever.
function normalize(keys) {
  const out = {};
  for (const [rawId, sec] of Object.entries(keys || {})) {
    const id = String(rawId).toLowerCase();
    if (!/^(keys|joystick)_p[1-8]$/.test(id)) continue;
    const def = DEFAULTS[id] || {};
    const kept = {};
    for (const a of ACTIONS) {
      if (!Object.prototype.hasOwnProperty.call(sec, a.key)) continue;
      const c = checkBinding(id, sec[a.key]);
      if (!c.ok) { const e = new Error(slotName(id.startsWith('keys') ? 'Keys' : 'Joystick', slotNumber(id)) + ' ' + a.key + ': ' + c.reason); e.code = 'invalid'; throw e; }
      if (def[a.key] !== undefined && c.token === def[a.key]) continue;
      kept[a.key] = c.token;
    }
    if (Object.prototype.hasOwnProperty.call(sec, 'Joystick')) {
      const j = parseInt(sec.Joystick, 10);
      if (!Number.isInteger(j) || j < -1 || j > 15) { const e = new Error('Joystick must be -1 for a keyboard, or the pad number'); e.code = 'invalid'; throw e; }
      if (def.Joystick === undefined || j !== def.Joystick) kept.Joystick = j;
    }
    if (!id.startsWith('keys') && Object.prototype.hasOwnProperty.call(sec, 'RumbleOn')) {
      const r = sec.RumbleOn ? 1 : 0;
      if (def.RumbleOn === undefined || r !== def.RumbleOn) kept.RumbleOn = r;
    }
    if (Object.keys(kept).length) out[id] = kept;
  }
  return out;
}

// Which sections a config this build writes will carry.
function sectionsWritten(keys, players) {
  const n = Math.max(1, Math.min(MAX_PLAYERS, parseInt(players, 10) || 4));
  const stored = keys || {};
  const out = [];
  for (const kind of SLOT_KINDS) {
    for (let i = 1; i <= n; i++) {
      const id = slotId(kind, i);
      if (ALWAYS_WRITTEN.includes(id) || (stored[id] && Object.keys(stored[id]).length)) out.push(slotName(kind, i));
    }
  }
  return out;
}

// The ini text. Column-aligned the way the engine's own file is, and byte for
// byte what this build has always written when nothing has been changed - a
// generated file that changes size changes the Build ID, and an untouched
// build must keep the number it had.
function iniLines(keys, players) {
  const n = Math.max(1, Math.min(MAX_PLAYERS, parseInt(players, 10) || 4));
  const stored = keys || {};
  const lines = [];
  for (const kind of SLOT_KINDS) {
    for (let i = 1; i <= n; i++) {
      const id = slotId(kind, i);
      const set = stored[id] || {};
      const def = DEFAULTS[id] || {};
      if (!ALWAYS_WRITTEN.includes(id) && !Object.keys(set).length) continue;
      lines.push('');
      if (id === 'keys_p1' && !Object.keys(set).length) {
        lines.push('; P1: WASD movement, K/L/; = A/B/C, I/O/P = X/Y/Z - same layout as v1.');
      }
      lines.push('[' + slotName(kind, i) + ']');
      const joy = Object.prototype.hasOwnProperty.call(set, 'Joystick') ? Number(set.Joystick)
        : (def.Joystick !== undefined ? def.Joystick : (kind === 'Keys' ? -1 : i - 1));
      lines.push('Joystick = ' + joy);
      for (const a of ACTIONS) {
        const v = Object.prototype.hasOwnProperty.call(set, a.key) ? set[a.key] : def[a.key];
        if (v === undefined || v === null) continue;
        lines.push(a.key.padEnd(8, ' ') + ' = ' + v);
      }
      if (kind === 'Joystick') {
        const r = Object.prototype.hasOwnProperty.call(set, 'RumbleOn') ? (set.RumbleOn ? 1 : 0)
          : (def.RumbleOn !== undefined ? def.RumbleOn : 1);
        lines.push('RumbleOn = ' + r);
      }
    }
  }
  if (lines.length) lines.push('');
  return lines;
}

module.exports = {
  ACTIONS, NOKEY, KEY_NAMES, KEY_CODES, CODE_TO_NAME, UNREACHABLE,
  BUTTON_TOKENS, BUTTON_NAMES, SDL_TO_BROWSER, PAD_BUTTON_TO_TOKEN, PAD_AXIS_TO_TOKEN,
  MAX_PLAYERS, SLOT_KINDS, DEFAULTS, ALWAYS_WRITTEN,
  slotId, slotName, isKeyboard, slotNumber,
  checkBinding, nameForCode, model, conflicts, normalize, sectionsWritten, iniLines,
};
