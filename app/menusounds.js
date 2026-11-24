'use strict';
// MENU SOUNDS PLAY THROUGH: one Lua add-on, shipped by the website build and
// the desktop export alike as external/mods/mugen-studio/menu-sounds.lua (the
// Mods tab can switch it off: modmgr.js, 'menu-sounds').
//
// The modern-input engine (our web engine since 2.5, and upstream's official
// build the desktop export runs) stops a screenpack sound that is still
// playing when the same sound plays again: upstream 78eba6a3, "menu sounds no
// longer stack when moving quickly", sets Snd.restart on the motif's sounds
// only (motif.go), and Snd.play then stops every copy of that sound first
// (sound.go). So moving the cursor quickly cut each cursor sound off with the
// next one. MUGEN and the 2.4 web engine let each one play to its end.
//
// Every menu the Lua scripts draw (title, select, options, pause, the
// Studio's own add-ons) plays the screenpack's sounds through motif.Snd. This
// add-on points motif.Snd at a second copy of the same .snd file, loaded with
// sndNew, which never sets restart: those plays layer again. Nothing else
// changes. Character, stage and fight-screen sounds are other objects, so a
// character's PlaySnd on a channel still stops that channel's last sound.
// The few screenpack sounds the engine plays from Go (continue screen,
// hiscore entry, the on-screen keyboard, the challenger screen) keep the
// engine's own copy and still restart. The cost is the .snd loaded twice.
//
// Loaded after main.lua has built motif (the engine loads every .lua under
// external/mods then), before any menu sound plays. A screenpack with no
// sound file, or one sndNew cannot read, keeps the engine's copy.

// In the folder that holds every add-on of the Studio's: modmgr.js VPATHS,
// the add-ons' registry, names the same string (tools/test-mods-build.js
// checks the two agree).
const MENU_SOUNDS_VPATH = 'external/mods/mugen-studio/menu-sounds.lua';

function menuSoundsLua() {
  return [
    '-- Mugen Studio: menu sounds play through, as in MUGEN (menusounds.js).',
    '-- The engine restarts a screenpack sound that is still playing when it',
    '-- plays again (Snd.restart on the motif\'s sounds), which cut each cursor',
    '-- sound off with the next. The menus play their sounds through motif.Snd;',
    '-- a second copy of the same file from sndNew has no restart, so they layer.',
    'if motif ~= nil and motif.Snd ~= nil and motif.files ~= nil',
    '\tand type(motif.files.snd) == \'string\' and motif.files.snd ~= \'\' then',
    '\tlocal ok, snd = pcall(sndNew, motif.files.snd)',
    '\tif ok and snd ~= nil then',
    '\t\tmotif.Snd = snd',
    '\t\tprint(\'[menu-sounds] menu sounds play through: \' .. motif.files.snd)',
    '\telse',
    '\t\tprint(\'[menu-sounds] kept the engine\\\'s copy: \' .. tostring(snd))',
    '\tend',
    'end',
    '',
  ].join('\n');
}

module.exports = { MENU_SOUNDS_VPATH, menuSoundsLua };
