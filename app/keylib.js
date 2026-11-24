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

// ============================================================================
// THE MODERN-INPUT ENGINE (engine 2.5, IKEMEN_V2): keyboard controllers and a
// button setup in place of player slots.
//
// Upstream's modern-input engine reads no [Keys_Pn] or [Joystick_Pn] at all
// (it warns "Failed to assign key" for each line and goes on). Input there is
// two steps (input.go: "physical keys or SDL controls -> Controller Mapping ->
// virtual controller -> Button Setup -> engine buttons"):
//
//  * [ControllerMapping_Keyboard1] / [ControllerMapping_Keyboard2]: the key behind
//    each of the 24 controls of a standard pad (DP_U .. RS, config.go
//    ControllerMappingProperties), one key name per control, `-` for none. The
//    key names are the same 117 StringToKey takes above. A pad needs no
//    mapping: it maps every control to itself.
//  * [ButtonSetup_Standard]: the control behind each engine button (and
//    behind each combination row, xa .. abc), one control name or `-`
//    (config.go ButtonSetupProperties, parseVirtualControl). A device
//    uses the setup named by `[Input] ButtonSetup.<device>`.
//  * `[Input] PreferredSide.<device>`: the team side a device plays on when a
//    mode starts without the side select screen.
//
// THE OVERLAY IS KEY BY KEY (config.go loadConfig: the user file over
// defaultConfig.ini), so a mapping that left a control out would keep the
// engine's key for it, and the engine's keys collide with ours (its LS is e,
// which is LB here). So a written mapping states ALL 24 controls.
//
// WHAT THE WEB ENGINE SHIPS: the browser build swaps upstream's keyboard
// layouts for WebMUGEN's own (events_js.go webKeyboardDefaults, Decision 30):
// Keyboard Controller 1 = WASD with the attacks on k l ; and i o p, Keyboard
// Controller 2 = the arrows with the numpad. WEB_KEYBOARDS below is that
// table, exactly; the Standard setup is upstream's, unchanged (Decision 13:
// d = LT, w = LB, which the old Joystick_Pn defaults had the other way round).
//
// A DEDICATED SETUP SECTION IS AUTHORITATIVE. Once the user file holds any
// [ButtonSetup_*], the engine drops every setup it does not name
// (config.go dropDeletedSetups), so when this build writes a setup it writes
// [ButtonSetup_Standard] whole, under that name, and only then.

// The 24 controls, in the engine's VirtualControl order (input.go
// virtualControlNames), with a label and the page group each sits in.
const CONTROLS = [
  { key: 'DP_U', label: 'D-pad up', group: 'dpad' },
  { key: 'DP_D', label: 'D-pad down', group: 'dpad' },
  { key: 'DP_L', label: 'D-pad left', group: 'dpad' },
  { key: 'DP_R', label: 'D-pad right', group: 'dpad' },
  { key: 'A', label: 'A', group: 'face' },
  { key: 'B', label: 'B', group: 'face' },
  { key: 'X', label: 'X', group: 'face' },
  { key: 'Y', label: 'Y', group: 'face' },
  { key: 'START', label: 'Start', group: 'system' },
  { key: 'BACK', label: 'Back', group: 'system' },
  { key: 'LB', label: 'Left bumper', group: 'shoulder' },
  { key: 'RB', label: 'Right bumper', group: 'shoulder' },
  { key: 'LT', label: 'Left trigger', group: 'shoulder' },
  { key: 'RT', label: 'Right trigger', group: 'shoulder' },
  { key: 'LS_Y-', label: 'Left stick up', group: 'stick' },
  { key: 'LS_Y+', label: 'Left stick down', group: 'stick' },
  { key: 'LS_X-', label: 'Left stick left', group: 'stick' },
  { key: 'LS_X+', label: 'Left stick right', group: 'stick' },
  { key: 'RS_Y-', label: 'Right stick up', group: 'stick' },
  { key: 'RS_Y+', label: 'Right stick down', group: 'stick' },
  { key: 'RS_X-', label: 'Right stick left', group: 'stick' },
  { key: 'RS_X+', label: 'Right stick right', group: 'stick' },
  { key: 'LS', label: 'Left stick click', group: 'stick' },
  { key: 'RS', label: 'Right stick click', group: 'stick' },
];
const CONTROL_NAMES = CONTROLS.map((c) => c.key);
// No key / no control: the engine skips "" and "-" (ControllerMapping.sample) and
// parseVirtualControl gives VC_None for anything it does not know.
const UNBOUND = '-';

// The two keyboard controllers this build states, as the web engine ships
// them (events_js.go webKeyboardDefaults; tools/test-keybinds.js reads that
// table and fails on any difference).
const WEB_KEYBOARDS = {
  keyboard1: {
    section: 'ControllerMapping_Keyboard1', name: 'Keyboard Controller 1', side: 1,
    map: {
      DP_U: 'w', DP_D: 's', DP_L: 'a', DP_R: 'd', A: 'k', B: 'l', X: 'i', Y: 'o',
      START: 'RETURN', BACK: '-', LB: 'e', RB: 'p', LT: 'q', RT: 'SEMICOLON',
      'LS_Y-': '-', 'LS_Y+': '-', 'LS_X-': '-', 'LS_X+': '-',
      'RS_Y-': '-', 'RS_Y+': '-', 'RS_X-': '-', 'RS_X+': '-', LS: '-', RS: '-',
    },
  },
  keyboard2: {
    section: 'ControllerMapping_Keyboard2', name: 'Keyboard Controller 2', side: 2,
    map: {
      DP_U: 'UP', DP_D: 'DOWN', DP_L: 'LEFT', DP_R: 'RIGHT', A: 'KP_1', B: 'KP_2', X: 'KP_4', Y: 'KP_5',
      START: 'KP_ENTER', BACK: '-', LB: 'KP_8', RB: 'KP_6', LT: 'KP_7', RT: 'KP_3',
      'LS_Y-': '-', 'LS_Y+': '-', 'LS_X-': '-', 'LS_X+': '-',
      'RS_Y-': '-', 'RS_Y+': '-', 'RS_X-': '-', 'RS_X+': '-', LS: '-', RS: '-',
    },
  },
};
const KEYBOARD_IDS = Object.keys(WEB_KEYBOARDS);

// The engine buttons a setup binds, then its combination rows, in the order
// defaultConfig.ini [ButtonSetup_Standard] lists them, and that section's
// values (Decision 13: upstream's Standard setup as it ships).
const SETUP_BUTTONS = ['up', 'down', 'left', 'right', 'a', 'b', 'c', 'x', 'y', 'z', 'start', 'd', 'w', 'menu'];
const SETUP_COMBOS = ['xa', 'yb', 'zc', 'xy', 'xz', 'yz', 'xyz', 'ab', 'ac', 'bc', 'abc'];
const SETUP_ROWS = SETUP_BUTTONS.concat(SETUP_COMBOS);
const STANDARD_SETUP = {
  up: 'DP_U', down: 'DP_D', left: 'DP_L', right: 'DP_R',
  a: 'A', b: 'B', c: 'RT', x: 'X', y: 'Y', z: 'RB',
  start: 'START', d: 'LT', w: 'LB', menu: 'BACK',
  xa: '-', yb: '-', zc: '-', xy: '-', xz: '-', yz: '-', xyz: 'RS', ab: '-', ac: '-', bc: '-', abc: 'LS',
};
const SETUP_SECTION = 'ButtonSetup_Standard';
const SETUP_NAME = 'Standard';

// The old slots' actions -> the controls they become through the Standard
// setup, so a bundle that changed [Keys_P1] or [Keys_P2] in the Studio before
// keeps that layout on this engine (its own keyboard; menu = BACK).
const ACTION_TO_CONTROL = {
  up: 'DP_U', down: 'DP_D', left: 'DP_L', right: 'DP_R',
  a: 'A', b: 'B', c: 'RT', x: 'X', y: 'Y', z: 'RB', start: 'START', d: 'LT', w: 'LB', menu: 'BACK',
};

// A key this build may write for a control, or the reason it may not. The same
// names as the old slots; `-` (or blank, or the old "Not used") is no key.
function checkKey(token) {
  const t = String(token === null || token === undefined ? '' : token).trim();
  if (t === '' || t === UNBOUND || t === NOKEY) return { ok: true, token: UNBOUND, unbound: true };
  if (!KEY_SET.has(t)) {
    const near = KEY_NAMES.find((n) => n.toLowerCase() === t.toLowerCase());
    return { ok: false, reason: near
      ? 'the engine spells that ' + near + ' - key names are matched exactly, so this would bind nothing'
      : 'the engine has no key called ' + t + ', so this control would never fire' };
  }
  return { ok: true, token: t, unreachable: UNREACHABLE[t] || null };
}

// A control a setup row may name, or the reason it may not. The engine matches
// the name without regard to case (parseVirtualControl); it is written in the
// engine's own spelling.
function checkSetupValue(value) {
  const t = String(value === null || value === undefined ? '' : value).trim();
  if (t === '' || t === UNBOUND) return { ok: true, token: UNBOUND, unbound: true };
  const hit = CONTROL_NAMES.find((n) => n.toLowerCase() === t.toLowerCase());
  if (!hit) return { ok: false, reason: 'the engine has no control called ' + t + ', so this button would never be pressed' };
  return { ok: true, token: hit };
}

const own = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);

// What the Studio stored for this engine (roster.controls), with an older
// bundle's [Keys_P1] / [Keys_P2] changes carried over for a keyboard it has
// not set on this engine: { keyboard1: {control: key}, keyboard2: ..., setup: {row: control} }.
// The old [Joystick_Pn] changes have no place here (a pad maps every control
// to itself; the setup is shared by every device) and are left out.
function controlsOf(roster) {
  const r = roster || {};
  const saved = !!r.controls && typeof r.controls === 'object';
  const stored = saved ? r.controls : {};
  const out = {};
  for (const id of KEYBOARD_IDS) {
    if (stored[id] && Object.keys(stored[id]).length) { out[id] = Object.assign({}, stored[id]); continue; }
    // roster.controls exists once this engine's page has saved: from then on
    // it is the whole story, and the old slots are not read again.
    const old = !saved && r.keys && r.keys[id === 'keyboard1' ? 'keys_p1' : 'keys_p2'];
    if (!old) continue;
    const carried = {};
    for (const [action, control] of Object.entries(ACTION_TO_CONTROL)) {
      if (!own(old, action)) continue;
      const c = checkKey(old[action]);
      if (c.ok) carried[control] = c.token;
    }
    if (Object.keys(carried).length) out[id] = carried;
  }
  if (stored.setup && Object.keys(stored.setup).length) out.setup = Object.assign({}, stored.setup);
  return out;
}

// The keyboard mapping and the setup this build writes, in full.
function keyboardMap(controls, id) {
  const set = (controls || {})[id] || {};
  const out = {};
  for (const c of CONTROL_NAMES) out[c] = own(set, c) ? String(set[c]) : WEB_KEYBOARDS[id].map[c];
  return out;
}
function setupMap(controls) {
  const set = (controls || {}).setup || {};
  const out = {};
  for (const r of SETUP_ROWS) out[r] = own(set, r) ? String(set[r]) : STANDARD_SETUP[r];
  return out;
}

// The pad control each engine button sits on through this build's setup (the
// Command List's Xbox / PlayStation pictures follow it, buttonstyle.js).
function setupPadMap(controls, list) {
  const s = setupMap(controls);
  const out = {};
  for (const b of list || SETUP_BUTTONS) out[b] = s[b];
  return out;
}

// Only what differs from what the web engine ships is kept, like the engine
// settings and the old slots: an untouched control follows the shipped layout.
function normalizeControls(controls) {
  const out = {};
  for (const [rawId, sec] of Object.entries(controls || {})) {
    const id = String(rawId).toLowerCase();
    if (!sec || typeof sec !== 'object') continue;
    if (KEYBOARD_IDS.includes(id)) {
      const kept = {};
      for (const [rawC, v] of Object.entries(sec)) {
        const c = CONTROL_NAMES.find((n) => n.toLowerCase() === String(rawC).toLowerCase());
        if (!c) { const e = new Error(WEB_KEYBOARDS[id].name + ': the engine has no control called ' + rawC); e.code = 'invalid'; throw e; }
        const k = checkKey(v);
        if (!k.ok) { const e = new Error(WEB_KEYBOARDS[id].name + ' ' + c + ': ' + k.reason); e.code = 'invalid'; throw e; }
        if (k.token !== WEB_KEYBOARDS[id].map[c]) kept[c] = k.token;
      }
      if (Object.keys(kept).length) out[id] = kept;
    } else if (id === 'setup') {
      const kept = {};
      for (const [rawR, v] of Object.entries(sec)) {
        const r = String(rawR).toLowerCase();
        if (!SETUP_ROWS.includes(r)) { const e = new Error(SETUP_NAME + ': the engine has no button called ' + rawR); e.code = 'invalid'; throw e; }
        const s = checkSetupValue(v);
        if (!s.ok) { const e = new Error(SETUP_NAME + ' ' + r + ': ' + s.reason); e.code = 'invalid'; throw e; }
        if (s.token !== STANDARD_SETUP[r]) kept[r] = s.token;
      }
      if (Object.keys(kept).length) out.setup = kept;
    }
  }
  return out;
}

// Conflicts the way the engine sees them: a key on two controls of one
// keyboard controller presses both, and a key on both controllers is the
// engine's own keyboardConflict (system.go: two keyboard controllers sharing a
// physical key). `-` never counts.
function controlConflicts(controls) {
  const by = new Map();
  for (const id of KEYBOARD_IDS) {
    const m = keyboardMap(controls, id);
    for (const c of CONTROL_NAMES) {
      const k = m[c];
      if (!k || k === UNBOUND) continue;
      if (!by.has(k)) by.set(k, []);
      by.get(k).push({ keyboard: id, name: WEB_KEYBOARDS[id].name, control: c });
    }
  }
  const out = [];
  for (const [token, where] of by) if (where.length > 1) out.push({ token, where });
  return out.sort((a, b) => a.token.localeCompare(b.token));
}

// Two setup rows on one control: that control presses every engine button of
// both rows (d and w on LB: LB presses d and w). The engine takes it as written
// (ButtonSetupProperties.setup appends each row's control to its buttons,
// nothing refuses a repeat), so it is a warning, not an error: the build is
// saved and written as set. A combination row counts too (xa on LB beside w on
// LB: LB presses x, a and w). `-` never counts.
function setupConflicts(controls) {
  const s = setupMap(controls);
  const by = new Map();
  for (const r of SETUP_ROWS) {
    const c = checkSetupValue(s[r]);
    if (!c.ok || c.unbound) continue;
    const k = c.token;
    if (!by.has(k)) by.set(k, { control: k, buttons: [] });
    by.get(k).buttons.push(r);
  }
  return [...by.values()].filter((x) => x.buttons.length > 1).sort((a, b) => a.control.localeCompare(b.control));
}

// Everything the Controls panel needs on this engine.
function modelV2(controls) {
  const c = controls || {};
  const conflicts = controlConflicts(c);
  const shared = setupConflicts(c);
  const keyboards = KEYBOARD_IDS.map((id) => {
    const set = c[id] || {};
    const m = keyboardMap(c, id);
    return {
      id, name: WEB_KEYBOARDS[id].name, section: WEB_KEYBOARDS[id].section, side: WEB_KEYBOARDS[id].side,
      changed: Object.keys(set).length > 0,
      bindings: CONTROLS.map((ct) => ({
        control: ct.key, label: ct.label, group: ct.group,
        value: m[ct.key], def: WEB_KEYBOARDS[id].map[ct.key], set: own(set, ct.key),
        conflict: conflicts.some((x) => x.where.some((w) => w.keyboard === id && w.control === ct.key)),
      })),
    };
  });
  const sset = c.setup || {};
  const sm = setupMap(c);
  const setup = {
    name: SETUP_NAME, section: SETUP_SECTION, changed: Object.keys(sset).length > 0,
    rows: SETUP_ROWS.map((r) => ({ button: r, combo: !SETUP_BUTTONS.includes(r), value: sm[r], def: STANDARD_SETUP[r], set: own(sset, r),
      conflict: shared.some((x) => x.buttons.includes(r)) })),
  };
  return { keyboards, setup, conflicts, setupConflicts: shared };
}

// THE SECTION NAMES: ONE FORMAT, WEB AND DESKTOP. Upstream renamed the input
// sections while modern-input was a pre-release. Since the 2026-11-17 refresh
// (plan 1.28) the web engine is on the same upstream head as the official
// pre-release the desktop export ships (07c692fb), so both read the same names:
// the keyboards in [ControllerMapping_KeyboardN], the setup in
// [ButtonSetup_Standard], a device's setup in [Input] ButtonSetup.<device>;
// the game calls the screens Controller Mapping and Button Setup. The old
// names ([ButtonMapping_*], [ControllerSetup_*], 9237c644) are read by no
// engine the Studio builds on any more: formatV2 refuses them, and the desktop
// export refuses a zip whose engine still reads them (enginezip.engineFormat
// 'button-mapping'). A 2.5 test build's saved config in the old names is left
// to Phase 9 (2.5 has not shipped).
const FORMAT_V2 = { id: 'controller-mapping', mapping: 'ControllerMapping', setup: 'ButtonSetup', deviceKey: 'ButtonSetup',
  screens: 'Options > Input Settings > Controller Mapping', setupWord: 'button setup' };
const FORMATS_V2 = [FORMAT_V2];
// A format by id or by its names (an enginezip.engineFormat result); FORMAT_V2 when none is given.
function formatV2(fmt) {
  if (!fmt) return FORMAT_V2;
  const id = typeof fmt === 'string' ? fmt : fmt.id;
  const f = FORMATS_V2.find((x) => x.id === id);
  if (!f) throw new Error('keylib: no config format called ' + id);
  return f;
}
const mappingSection = (id, fmt) => formatV2(fmt).mapping + '_' + WEB_KEYBOARDS[id].section.split('_').pop();
const setupSection = (fmt) => formatV2(fmt).setup + '_' + SETUP_NAME;

// The sections a config for this engine carries, in the order iniLinesV2 writes them.
function sectionsWrittenV2(controls, fmt) {
  const out = ['Input'].concat(KEYBOARD_IDS.map((id) => mappingSection(id, fmt)));
  if ((controls || {}).setup && Object.keys(controls.setup).length) out.push(setupSection(fmt));
  return out;
}

// The ini text for this engine: [Input] with each keyboard controller's setup
// and side, both keyboard mappings whole (24 controls each), and the Standard
// setup whole when this build changed it. No [Keys_Pn] or [Joystick_Pn]: the
// engine ignores them with a warning per line. `fmt`: the section names of
// the engine it is for (above); the web build's when left out.
function iniLinesV2(controls, fmt) {
  const F = formatV2(fmt);
  const c = controls || {};
  const pad = (k) => k.padEnd(5, ' ');
  const ini = ['', '[Input]',
    '; Which ' + F.setupWord + ' and which side each keyboard controller uses. A',
    '; player remaps keys in the game (' + F.screens + ').'];
  for (const id of KEYBOARD_IDS) ini.push(F.deviceKey + '.' + id + ' = ' + SETUP_NAME.toLowerCase());
  for (const id of KEYBOARD_IDS) ini.push('PreferredSide.' + id + ' = ' + WEB_KEYBOARDS[id].side);
  for (const id of KEYBOARD_IDS) {
    const m = keyboardMap(c, id);
    ini.push('', '[' + mappingSection(id, F) + ']');
    if (id === 'keyboard1' && !(c[id] && Object.keys(c[id]).length)) {
      ini.push('; WASD moves, K L ; = A B RT, I O P = X Y RB, Enter = Start, Q E = LT LB.');
    }
    ini.push(pad('Name') + ' = ' + WEB_KEYBOARDS[id].name);
    for (const ct of CONTROL_NAMES) ini.push(pad(ct) + ' = ' + m[ct]);
  }
  if (c.setup && Object.keys(c.setup).length) {
    const s = setupMap(c);
    ini.push('', '[' + setupSection(F) + ']', pad('Name') + ' = ' + SETUP_NAME);
    for (const r of SETUP_ROWS) ini.push(pad(r) + ' = ' + s[r]);
  }
  ini.push('');
  return ini;
}

module.exports = {
  ACTIONS, NOKEY, KEY_NAMES, KEY_CODES, CODE_TO_NAME, UNREACHABLE,
  BUTTON_TOKENS, BUTTON_NAMES, SDL_TO_BROWSER, PAD_BUTTON_TO_TOKEN, PAD_AXIS_TO_TOKEN,
  MAX_PLAYERS, SLOT_KINDS, DEFAULTS, ALWAYS_WRITTEN,
  slotId, slotName, isKeyboard, slotNumber,
  checkBinding, nameForCode, model, conflicts, normalize, sectionsWritten, iniLines,
  // the modern-input engine (IKEMEN_V2)
  CONTROLS, CONTROL_NAMES, UNBOUND, WEB_KEYBOARDS, KEYBOARD_IDS,
  SETUP_BUTTONS, SETUP_COMBOS, SETUP_ROWS, STANDARD_SETUP, SETUP_SECTION, SETUP_NAME, ACTION_TO_CONTROL,
  checkKey, checkSetupValue, controlsOf, keyboardMap, setupMap, setupPadMap, normalizeControls,
  controlConflicts, setupConflicts, modelV2, sectionsWrittenV2, iniLinesV2,
  FORMAT_V2, FORMATS_V2, formatV2, mappingSection, setupSection,
};
