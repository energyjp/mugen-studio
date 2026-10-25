# Frame Meter (training mode mod)

A frame meter for Ikemen GO's Training mode, in the style of modern fighting-game training modes. Two rows of small per-frame cells sit near the bottom of the fight screen. The top row is P1 and the bottom row is P2. Each cell is colored by what that character was doing on that game frame. Next to the rows you get the startup of P1's latest attack, P1's total frames, and each side's frame advantage once both characters can act again.

The mod only reads the characters. It never changes states, variables, inputs or AI, so it cannot affect a match.

## Install and remove

- **In Mugen Studio:** the Mods tab, Studio add-ons, **Frame meter (Training)**. It is off until you tick it; the next build of that bundle (website or desktop) carries it.

- **Install:** copy `framebar.lua` into `<Ikemen GO>/external/mods/`. The engine loads every `.lua` file in that folder at startup.
- **Remove:** delete `external/mods/framebar.lua`.
- **Disable without deleting:** rename it so the name starts with `-` (for example `-framebar.lua`). The engine skips files named that way.

## Using it

- Start a Training match. The meter is on by default.
- **F7** shows or hides it. F7 also works while the game is frozen with the Pause key, but not while the pause menu is open. It does nothing outside Training.
- Frame stepping works: each step adds one frame, and pausing adds nothing.

A **sequence** starts on the first frame where either character is not free to act. It continues while either character is busy, and ends on the first frame where both characters are free to act again. A fireball that lands after its thrower is already free starts a sequence of its own: the thrower's row stays empty (free to act), and the advantage counts from the hit. Each new sequence clears the meter. The numbers stay on screen until a sequence with an attack, a hit or a block replaces them: a dash or a landing on its own keeps them. If a sequence runs longer than 80 frames, the meter scrolls and shows the most recent 80.

## Colors

| Cell | Color | Meaning |
|---|---|---|
| Startup | green | Attacking, before the attack's hitbox comes out |
| Active | red | The attack's hitbox is out on this frame, or a projectile or helper attack appears (a fireball's first hitbox) |
| Recovery | blue | Still in the attack after its hitbox is gone, and any frames without control right after it (for example, landing after a jump attack) |
| Hitstun | amber | Being hit |
| Blockstun | cyan | Blocking a hit |
| Movement | gray-blue | Busy but not attacking or being hit: dashing, starting a jump, landing, getting up |
| Idle | empty | Free to act: standing, walking, crouching, in the air, or still being pushed back by a block after control has come back. The frame control comes back is still drawn as what came before it, because nothing can start on that frame (see Total below) |

Every 5th frame is drawn a little darker so you can count. The dark panel behind the meter keeps the colors readable on any stage.

## The numbers

- **Startup Nf** (top left): the frames from the first frame of P1's latest attack to its first active frame, counting both ends. A move that becomes active on its 5th frame shows `5f`. It appears as soon as the active frame happens. For a fireball it is the frame the fireball's hitbox appears, and it stays on screen when the fireball lands later; only P1 starting another attack replaces it.
- **Total Nf** (top left): how many frames P1 could not act, from the first frame of the move to the last frame before it can start another one. It is shown when the sequence ends and P1 attacked during it. Control usually comes back in the middle of a frame, after the game has already read that frame's inputs, so the frame it comes back on still counts as busy and the next move starts on the frame after. This is the usual fighting-game count: a standing light punch that is active on frame 4 and done 12 frames into its animation is `Total 13f`.
- **Advantage** (right end of each row): shown when the sequence ends, after a hit or a block (or when both characters were busy). A side that was free for the whole sequence, like a fireball's thrower who recovered before it landed, counts as able to act on its first frame, so the number is how long the thrower is free before the other side. `+N` means that side could act N frames before the other one, `-N` means it could act N frames later, and `±0` means both could act on the same frame. P2's number is always the opposite of P1's. The hand-back frame above counts for both sides, so it does not change the advantage.

### Hitstop

Frames where both characters are frozen by the same hit (hitstop), or by a super freeze, are left off the meter, just like in other games' frame meters. This includes a move that switches into its follow-up during the hitstop (a cancel): its startup is counted from the first frame after the freeze. When only one side is frozen, the frame is still recorded for both rows. This happens when a projectile or a helper's hit shakes the defender while the attacker keeps moving. Without it, the attacker's recovery would be undercounted and the advantage would come out wrong. To drop those frames too, set `FB_SKIP_ONE_SIDED_FREEZE = true` at the top of the file.

### Cancels and multi-part moves

A move made of several parts counts as one move. A new move is detected when:

- the character starts attacking after not attacking, or
- after the current move's hitbox, the character switches to a different move (or starts the same move over) **and** that move has a hitbox of its own.

In that case, the frames since the switch are recolored as the new move's startup, and the startup number follows the new move.

## Limits

- Only the two leaders are read (P1 and P2). In Simul or Tag matches, partners are not shown.
- Helpers (fireballs, thrown weapons, summoned attacks that a character creates as separate objects) are read as part of their owner, and so are projectiles. The frame a helper's or projectile's hitbox first appears is the owner's active frame. A helper that keeps attacking over many frames only marks that first frame on the owner's row; the rest of the row follows the owner's own animation.
- The meter tells moves apart by their state numbers, which usually come in blocks of ten per move. A character numbered differently can have a multi-part move read as a cancel, or the other way around.
- A jump or a landing is movement, so it starts a sequence of its own. After blocking in the air, a character can act again while still falling, so the block's sequence ends in the air and the landing then starts a new one. The numbers stay: a movement-only sequence does not replace them.
- The meter is drawn once per game frame. Keep the frame rate at 60 (`Framerate` in the `[Video]` section of `save/config.ini`) and Game Speed at normal. At a higher frame rate the meter flickers, because it is missing from the extra frames in between. At a faster Game Speed it can look darker on some frames, and at a slower one a hit can be recorded one frame late.
- The meter sits inside the central 4:3 area of the screen during the fight. While a pause menu is open, a widescreen screenpack can map that area differently, so the meter may shift sideways until the menu closes.

## For testing

These globals can be set by another mod or from the debug console:

- `framebarForce = true` runs the meter in every game mode, not only Training. Use it for quick matches or demo fights.
- `framebarLog = true` prints one line per finished sequence, for example (a standing light punch that hits):
  `FRAMEBAR startup=4 adv=+4 total=13 p1act=14 p2act=18 p2startup=- len=17 p1=SSSAAAARRRRRR.... p2=...HHHHHHHHHHHHHH`
  (`S` startup, `A` active, `R` recovery, `H` hitstun, `B` blockstun, `M` movement, `.` idle). The web build shows it in the browser console.
- `framebarLast` holds the last finished sequence: `p1` and `p2` (category names, one per frame), `startup`, `p2Startup`, `advantage`, `total`, `p1Actionable` and `p2Actionable` (the first frame each side could start a new move), `length`, and `offset` (frames dropped from the front when a sequence was longer than 600 frames).

## Works on

Stock Ikemen GO 1.0.0 and the browser build. The mod uses only scripting features that both have, and it draws its text with the stock small bitmap font (`f-6x9.def`) because the browser build cannot draw TrueType fonts.
