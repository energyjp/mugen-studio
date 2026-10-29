# Mugen Studio language packs

This folder holds the Studio's translations. Each language is one file, named
for its language code:

- `es-419.json` - Spanish (Latin America)
- `pt-BR.json` - Portuguese (Brazil)

English is not a file: it is what the Studio is written in, and every pack is
made from it. `en-keys.json` is the list of every English string the Studio
shows, with the place in the source it comes from. The Studio does not read
it; it is the list you translate from.

Every window of the Studio follows the language picked in the main window:
E-Select, Moves, the animation and palette editors and the guide read the
choice when they open. A window that is already open when you switch keeps
its language until you open it again. The messages the Studio's server sends
(an export's notes, an error) are translated where the window shows them,
from the same pack.

## What a pack looks like

```json
{
 "lang": "es-419",
 "name": "Español",
 "english": "Spanish (Latin America)",
 "studio": "2.2",
 "strings": {
  "Characters": "Personajes",
  "{n} characters": "{n} personajes",
  "Press <b>Enter</b> to save.": "Presiona <b>Enter</b> para guardar."
 }
}
```

- `lang` is the language code, the same as the file name.
- `name` is the language's name in the language itself. `english` is its name
  in English.
- `studio` is the Studio version the pack was last brought up to date with.
- `strings` is the translation. The left side is the English, exactly as it is
  in `en-keys.json`. The right side is your translation. Only ever change the
  right side.

A string the pack does not have, or leaves empty (`""`), shows in English. So
a pack can be finished a piece at a time.

## Rules for the right-hand side

- Keep every `{placeholder}` exactly as it is written, braces and all. The
  Studio puts a number or a name there. You may move it to wherever your
  sentence needs it: `"{n} characters"` can become `"personajes: {n}"`.
- Keep HTML tags such as `<b>`, `<i>`, `<kbd>` and `<a href="...">` - the
  same tags, with the same attributes. Put them around the words that mean the
  same thing in your language.
- A title (the text that shows when you hover over something) may have line
  breaks, written `\n` in the file. Keep them where they still help.
- Keyboard keys stay as they are printed on the key: Ctrl, Shift, Enter, Esc.
- Leave names in English: MUGEN, Ikemen GO, Mugen Studio, E-Select, H-MUGEN,
  WebMUGEN, energy.jp, KFM, the band's names (WB, DJ AR, SHiZUKA), file names
  and extensions (`.def`, `.cns`, `.sff`, `select.def`, ...), engine setting
  names (GameWidth, ...), and the words the MUGEN scene uses as they are:
  screenpack, lifebars, sprite, netplay, roster, mods.
- Buttons, tabs and labels have little room: try to stay within about a
  quarter longer than the English. Longer hover texts are fine.
- Translate what the English says. Do not add explanations.

Each pack has a glossary next to it (`glossary-es-419.md`,
`glossary-pt-BR.md`) with the words chosen for the Studio's own terms. Use
the same word for the same thing everywhere.

## Messages and templates

Many strings have `{placeholders}` because the Studio puts the text
together when it shows it: `"no such character: {folder}"`,
`"Export failed: {error}"`, `"{n} characters in the build"`. The messages
the Studio's server sends are matched against these keys as they arrive, so
a whole message shows translated with its names and numbers as they came.

- A placeholder named `error`, `err`, `reason`, `message`, `msg`, `detail`,
  `details`, `why` or `cause` (sometimes with a number after it, `error2`)
  is filled with **another message**, already translated from the same
  pack. Write your sentence so a whole clause reads well there:
  `"Export failed: {error}"` can be `"Falló la exportación: {error}"`.
- Every other placeholder is **data**: a name, a file, a number, a list of
  names. It is never translated, so do not make the words around it depend
  on it (no article or ending that only fits some names).
- Two keys with the same words and different placeholder names
  (`"no such bundle: {id}"`, `"no such bundle: {key}"`) are one message from
  two places: translate them the same way.
- A short word on its own (`"Play"`, `"Up"`, `"Start"`) has one translation
  wherever it shows, and it may show in more than one window (`en-keys.json`
  names only the first place). Pick a word that fits every place it could be.

## Starting a new pack, or bringing one up to date

1. Copy an existing pack to `<code>.json` (or start from the example above)
   and set `lang`, `name`, `english` and `studio`.
2. Make sure `en-keys.json` is current: from the Studio's folder, run

   ```
   node tools/i18n-extract.js
   ```

3. Check your pack against it:

   ```
   node tools/i18n-extract.js --check public/lang/<code>.json
   ```

   It lists the English strings your pack is MISSING (they show in English),
   the EXTRA ones the Studio no longer has (safe to delete), and any
   PLACEHOLDER or TAG MISMATCH - a translation whose `{placeholders}` or tags
   differ from the English. Those must be fixed: the check fails until there
   are none.

4. Translate the missing strings, then run the check again.

## Trying it

In the Studio, open **Options** and pick the language from the **Language**
row. The window reloads in that language. The choice is kept on this computer
only, the same way the Look and Printing choices are.

## Your own pack

A pack does not have to go into the Studio's own files. Put it in the
**languages** folder inside the Studio's **Settings** folder, and it shows up
in Options > Language the next time the main window opens:

- in a copy of the Studio you downloaded: `Settings\languages\`, in the same
  folder as `MugenStudio.exe` (make the `languages` folder if it is not there)
- in a copy run from the source (`node server.js`): `languages/` beside
  `server.js`

Name the file after its language code, the same as the pack's `lang`:
`fr.json` holds `"lang": "fr"`, `de-CH.json` holds `"lang": "de-CH"`. A code
is a language of two or three letters and up to two more parts, each after a
dash (`pt-BR`, `es-419`, `zh-Hant-TW`). A file whose name is not a code, that
is not valid JSON, or whose `lang` is not its name is not used.

- A pack with a new code gets its own button after the three flags, with the
  pack's `name` on it. For a flag, put a picture beside the pack with the
  same name, `fr.png` or `fr.svg` (it is shown 18 x 12 pixels, so a 3:2
  picture fits best). Without one, the button shows the code.
- A pack with the code of a pack the Studio ships (`es-419.json`,
  `pt-BR.json`) is used instead of the shipped one; hold the pointer over its
  button and it says so. That is how a fix can be tried, or passed around,
  before the next version of the Studio has it. Take the file out of the
  folder to go back to the shipped pack.

To start one, copy a shipped pack into the folder (in a downloaded copy they
are in `app\public\lang\`) and change `lang`, `name` and `english`; or start
from `en-keys.json`: each English string there is a key for your pack's
`strings`, with your translation on the right. Strings you leave out show in
English.

To check it against the Studio's current English, run the check from
"Starting a new pack" above with the pack's own path:

```
node tools/i18n-extract.js --check <the Settings folder>/languages/fr.json
```
