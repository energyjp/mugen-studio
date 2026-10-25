'use strict';
//
// THE H GALLERY'S MOB GIVERS (a prototype mode: gallerymodes/index.js).
//
// A MOB GIVER brings his helpers on her - many of them, of several kinds -
// and they do the grabbing (towerofbloodyfight and its builds: tobf+, Gnoll
// Raid2, MR1_ProjectRose; ZHE's Futas). The core walk sees each kind as one
// summon whose helper plays the scene at random ("the grab", every scene of
// every member at once); this mode gives each MEMBER TYPE steps of its own,
// position by position, one member on her at a time. This file is the data
// half (read, pair); the runtime half (trim, hook lines, Lua) is
// gallerymodes/mob-rt.js, which rides on this module's exports. Every rule is
// read from his files - never a name, a folder or a fixed state number.
//
// A MEMBER: a helper id of his (never his companion's) that one of his
// Helper controllers spawns by a ROUTE, that can be out MORE THAN ONCE (or
// ONE AT A TIME, below), and whose own states hold a GRAB:
//   ROUTE (how the runtime brings it out):
//     press  a Helper in his -1/-2/-3 that fires for a human root standing
//            in his idle (AILevel 0, round state 2, his own helpers absent,
//            his variables at their round-start 0 or where the pair's setup
//            holds them) on exactly one playable command of his, and not
//            without it (TOBF's a/b/c/x). Its `time > N` atom is `after` N+1
//            (his state time before a press acts). A press that would also
//            start a move of his (a ChangeState/SelfState/HitDef of his
//            negative states on that command, in his idle) is no route.
//     state  a Helper in a state of his a fight can enter (the summon state
//            the core enters with Lua changeState: ZHE's 100000), its first
//            time atom (`!time`, `Time = N`) its `after`. A summon state the
//            core knows comes first.
//     press into a state: a Helper in a state S of his that his -1/-2/-3
//            enter on one playable command in his idle (WrestlerX's qcb+kick
//            -> 1400); S's first tick reads that command (its `!time`
//            VarSets: `var(19) = ifelse(command = "zombiea", 0, ...)`) and
//            the Helper fires on that tick (`AnimElem = 1` is it): the
//            command whose first tick spawns this member is pressed.
//     present a Helper in his -1/-2/-3 on no command that holds in his
//            idle with the member absent (Colette's striker 2000,
//            `Numhelper(2000) = 0`, `RoundState <= 2`): one is always out.
//     In his idle at round start his ctrl is on and his helpers' variables
//     (`helper(4712),var(5)`, GoblinParty's attachers) are at their 0.
//     A Helper only his AI calls (`AILevel > 0`), or one his pair's setup
//     keeps shut (ZHE's AI Futa 500 behind var(53) < 1), is no route.
//   MORE THAN ONE: a Helper of it that wants fewer than N >= 2 of it out
//     (`NumHelper(15000) < 8`), a count variable under N >= 2 (below), or
//     two Helpers of it in one state. (So a dog, a horse or a god summoned
//     one at a time - Sanae's Suwako on her own motion - stays the core's.)
//   ONE AT A TIME: a member out only once (Colette's striker, GoblinParty's
//     player goblin) where the core knows no summon of it, kept for a pair
//     only where the core walk has no step of his at all.
//   COUNT GATE: a variable of his that a state route's Helper compares
//     (`var(53) < 2`) and that a member raises with ParentVarAdd: a killed
//     member never lowers it, so the step's setup holds it - at the pair's
//     own setup value where that passes the gate, else at 0.
//   TYPE PINS: a variable some member's idle states write with a nonzero
//     number on a trigger true at its spawn (`trigger1 = 1`, `!time`), that a
//     HitDef's p1/p2stateno or a ChangeState's value reads, and whose value
//     differs between his kinds that grab (TOBF's var(15): the Skeleton's 2,
//     the Ghoul's 4, the Titan's 3 - the Zombie writes none and is 0; ZHE's
//     one Futa has none). Each member is pinned at its own value (0 where it
//     writes none): the states its kinds share (the grab 16666, the return
//     16302) pick its art and its way by it.
//   ITS IDLE: its spawn states and those they go on to by lines that read
//     none of its variables, never into a grab or a state that puts her in
//     one (a line that reads its type is a state its kinds share: TOBF's
//     onlookers 66999 send each kind home by var(15)).
//   ITS REACH: its spawn states and every state its ChangeStates, SelfStates
//     and hits' p1stateno lead to, a line false under its type pins never
//     followed and another kind's idle never entered. ITS GRAB: a state
//     there whose HitDef catches a standing partner (the core's
//     standingGrab) into a scene of his (p2stateno, or a p1stateno that
//     TargetStates her at once - ZHE's 7470 -> 7477), never into the state's
//     own number (TOBF's return 16302); never a hit only his own side takes
//     (`affectteam = F`, GoblinParty's GRAB PARTNER 322); never one whose
//     trigger cannot hold for its OWN ID (`IsHelper(N)` read against the
//     member's helper id, in its reach too: WrestlerX's Momo hammer 47470
//     catches her only as his Royal Rumble copy, `isHelper(7442)`, so Momo
//     47400 grabs nothing and is no member). ROOT TYPES: where
//     a variable of his root sends it into a grab (Colette's striker enters
//     7470 from 2020 and 17470 from 2040 at once on `root,var(40) = 3`, her
//     intro's random pick of her striker), those are its grabs, each with
//     that value held on him by the step's setup (a flag at rest, `= 0`, is
//     no type). Else, where its idle enters some grabs directly (its AI's
//     own), only those. Several grabs (ZHE's normal 7470
//     and boss 17470, which its decider picks at random) are each its own;
//     two that land in one family are one (the first).
//   FAMILIES: a variable its grab state draws at random that the HitDef's
//     p1/p2stateno read (the Ghoul's `fvar(1) = random%100`, p1 41399 or
//     41487) gives a family per outcome, pinned at the middle of the values
//     that give it (the companion's rule); else a variable its grab state
//     draws at random that a later state of its chain goes on by
//     (GoblinParty's 323 draws `var(49) = random%2 + 1`; 4000 goes on to 324
//     on 1, to 350 on 2) gives a family per value, pinned at it (the pin is
//     held every frame, so the draw is overwritten); else one p1stateno is
//     one family.
//   GAP: where the hook stands it beside her - the middle of the
//     P2BodyDist X window of its ChangeState into the grab, plus the Helper's
//     size.ground.front, plus 16, between 24 and 64 px (36 without a
//     window).
//   SETTLE: its spawn states that write its own variables on their first
//     tick and leave on it (ZHE's 300 -> 200): the runtime waits until it
//     has left them.
//   AMBIENT GRABBERS: helpers of his that his -1/-2/-3 spawn by themselves -
//     on a trigger group that names no command and is no AI's own, a timer
//     or a count (GoblinParty's 'Goblin creator npc' 10000: `GameTime % 210
//     = 1`, up to 8 of them) - whose reach holds a grab that fires for their
//     own id. Nothing brings one on demand, so they are no member and never
//     steps; they join every member's `ids`, so while a mob step plays they
//     go (his crowd never walks into a member's scene) and they are on the
//     pair's kill list.
//   RELAYED MEMBERS (gallerymodes/mob-relay.js, its header has the rules):
//     a Helper whose ID and stateno are one variable of his, set one state
//     before it (`var(8) := 7141` in ero_helper_zero's 1002) - no literal id
//     for the reading above - whose grab hands her on to a judge of her art
//     and whose scene is a RELAY HUB (one state, every phase, told apart by
//     the trampoline that entered it). Its steps come after his literal
//     members', per member, position and look; the pair's setup holds his
//     flags at rest (her clone's var(13) among them) and his timers shut.
//
// ITS MACHINE, per family, is the walker's flow from the family's p1stateno
// with no input, its pins frozen and her actions known (per receiver). Her
// scenes per state of its are what its TargetStates (and its hit) give her,
// never a state of its own number - and the states of his played on her
// that change themselves on her grabber's state read off the hit
// (`PlayerID(GetHitVar(fall.envshake.ampl)),stateno = 4000` -> 4001,
// GoblinParty's victim): while it is in 4000 she goes to 4001. HER RELAYS
// are followed too: a state of his played on her that shows no art of its
// own, which she passes on her way (GoblinParty's 334, her LAS initial,
// the one tick between its 324 and its 325; 351 for its 350 and 352). A
// state of its where she is in a relay is one of its scenes, but a relay is
// never a step's `until` (only her states with art are shown). Held in a
// state, a TargetState on the
// very trigger of one of its exits (the meter's next rung, a loop's end) is
// the next state's, on the way. Each exit of a state is read by its
// trigger: a LOOP (a random draw at a loop's end or after a while: the
// Zombie's 16301 <-> 16401 <-> 16501 at AnimTime = 0, ZHE's 7481 -> 7482 or
// 7483 at `time >= 364`), a METER (its own variable >= or > a number, no
// random: 16501 -> 16601 at var(58) >= 4000), a TIME (`time >= N`), a PICK
// (a random value at no such moment) or another.
//   POSITIONS: what its p1stateno leads to - the state itself where it is a
//     base (a meter goes on from it, a loop of it can come back to it, or
//     its scenes are keyed on its animation); else each state it goes on to
//     (a draw that never comes back is a pick: the Zombie's 16667 -> 162998
//     or 164000); a state whose only way on is one scene state of its is
//     that position's INTRO (162998 before 16301), shown as its speed 0. A
//     state an earlier position already holds is that one's, and positions
//     are numbered as their steps come.
//   ANIMATION-KEYED (the Bao clones: the Ghoul's 41401, the Titan's 31401):
//     a position state whose TargetStates key her state on its animation is
//     read by readCompanionPlay (the companion's play, gallerydata.js) - its
//     speeds (each animation, held by the hook), its meter and climax
//     pictures (the meter pinned past its top), its return. Where that finds
//     no meter (the Titan's `var(58) >= (5000 + (random%200 -
//     random%200))`), the same reading here: the meter pinned one past the
//     highest value its comparison draws.
//   STATE-KEYED otherwise (the Zombie): its SPEEDS are the states its loops
//     join (the position first, then by number), its PHASES the states its
//     meter enters below its top number (the meter pinned at the middle of
//     the rung), its CLIMAX the states the top number enters (several, from
//     a random pick: its pictures), the meter pinned one past the top; a
//     meter ladder with no loop (the Skeleton's 22000 -> 22100 -> 22200 ->
//     22300) is phase 1, 2, 3 and its climax. With no meter, a state its
//     speeds go on to by time alone that holds her is the climax (ZHE's 7483
//     -> 7489). Every other step holds the meter at 0.
//   ANIMATION BY OFFSET (GoblinParty's LAS and HAS, before every other
//     reading of a family): a state P of its machine whose animation is
//     `K + var(V)` - its header's (325: `551121019 + var(45)`), or a
//     ChangeAnim's on its first tick whose other conditions are values of
//     its own variables (352: `551121045 + var(53)` on `var(54) = 0 &&
//     var(50) = 0`) - where her state there (one with art) keys her
//     animation on its animation (her 335's ChangeAnim2 lines on
//     `PlayerID(GetHitVar(fall.envshake.ampl)),anim = 551121020` ...
//     551121044): each keyed N is the offset N - K. Its POSITIONS are the
//     rows of the TABLE that writes var(V): the VarSets of var(V) on
//     `var(W) = k`, one key variable, in the state of its machine nearest
//     before P (4000's 'CHOOSES DOGGY TO PLAY' var(45) = 0 on var(51) = 1,
//     'FRONT MISSIONAIRE' 5, 'BOTTOM COWGIRL' 15, 'FRONT MISSIONAIRE VAR 2'
//     10, 'BLOWJOB' 20), in key order, named by the rows' own labels (the
//     words they do not all share). Its SPEEDS: where its RELAY - the state
//     before P that goes on to it on its first ticks (324 at `time = 1`) -
//     adds to var(V) on its first tick (324's VarAdd +1, once per pass),
//     the row's value plus one pass, two, ... until THE LADDER'S END: the
//     value P's way back to its relay excludes (325's `anim != 551121024 &&
//     ...`) is the pass after which the pose leaves for good, its AFTERMATH
//     (her 335 calls it 'AFTER CUM'); the pass before it its CLIMAX ('CUM',
//     where her state takes life); the passes before that its speeds (SEC
//     1-3). (Read as the climax before, the aftermath played as the climax
//     and the climax as the top speed - the owner's report.) Where the row
//     draws at random (350's `var(53) = random%4 + 6` for 'FRONT
//     MISSIONARE'), each value drawn, and a row of the same key on a further
//     condition of a variable (`var(52) = 10`, 'CUMMING') its climax - that
//     variable held off it on the speeds; ITS AFTERMATH there is a
//     first-tick ChangeAnim of P to a literal animation her state keys,
//     asking the row's key and a flag P raises on the climax's animation
//     (352: `var(51) = 1 && var(54) = 1` -> 454541211, var(54) = 1 on
//     `anim = 551121049`), held with that key and flag. The aftermath is the
//     climax's next picture: Space shows the climax, Delete / End step to it.
//     Only offsets her state keys are kept. A step holds var(V) at its offset and the line's
//     own conditions (so P's own entry makes the pose, and the layers it
//     keys on its animation with it), holds P at K + offset and RE-ENTERS P
//     where the animation is another (a pose changed in place: P's own
//     entry makes the new pose's layers, the cut takes the old ones), and
//     goes to the relay (her follow chain runs through it: 4001 -> 334 ->
//     335). THE HEAD FIRST: where her state cannot follow the relay from
//     where it stands (her struggle 4003 follows its 4000 only), the go
//     takes it to the state of its she follows from there first (`via`:
//     4002 -> 4000, then 4000 -> 324). Her follow lines decide both sets,
//     over every family's machine (a move in place from LAS to HAS goes
//     through 4000). A state of its machine with no table (4000, whose
//     beginning pose `1154283 + var(48)` reads the attacher's draw on its
//     first tick) makes no step.
//   THE AUTHOR'S BIND: where every Explod of the pose state is `postype =
//     p1` with a `bindid` naming another player by PlayerID (325's and
//     352's layers, the goblin's body among them: `bindid =
//     PlayerID(helper(4711 + var(22)),var(0)),id`, the attacher's victim),
//     the hold carries `bind`: Ikemen 1.0.0 sets an Explod's position after
//     its bindid, and a p1 position binds it to its owner again
//     (bytecode.go, explod's Run: setPos after the parameter loop; char.go,
//     Explod.setPos), so the layers stand where the member stands - and
//     GoblinParty's goblin parks itself off the stage on its first tick in
//     4000 and 4002 (PosSet y = 9999999999, 'HIDES GOBLIN IN THE BACKGROUND
//     TO PREVENT TARGETING DURING SEX'): its body was drawn there, never on
//     her. The runtime stands the member where its layers belong instead,
//     and its hold carries `at`, HER POSE'S CONTACT POINT less its layers'
//     own offset: her animation keyed on his (45122124) draws her at its
//     first frame's x from her (65, his .air), his layers stand at their
//     pos from her (`var(32) - 38`: -38, the variable his own arrow keys
//     nudge left out), so the member stands 65 - 38 = 27 along her facing
//     and the layers stand at her pose's axis (missionary 20 - 14, cowgirl
//     20 - 14, blowjob 25 - 14). His numbers alone put the goblin 27 / 6 /
//     11 toward her head (the owner's 'too far to the left on all
//     positions'); the same in every reading of the engines (MUGEN 1.1 and
//     Ikemen 0.98 bind the space = stage layer to her with the pos as it
//     is, a mirror of this), and his round 2 intro nudges them back by 16 /
//     6 / 6 / 6 (var(32) = -16 ... on `roundstate = [0,1]`).
//   ITS OWN COLORS: a member whose own state repaints every palette of his
//     sprite file onto one (RemapPal `source = -1, 0`, `dest = 1,palno`, on
//     a line that always fires: the goblin's 10000), where that file is SFF
//     v1, makes its own-palette layers (ownpal = 1, `remappal = 18952,0`:
//     the x-ray inset, the cum effects) copy that repaint, and the remappal
//     cannot undo it (an SFF v1 sprite palette has no key: char.go
//     forceRemapPal finds none and keeps the copy) - the inset drawn in the
//     goblin's colors, black with yellow specks. Its hold carries `colors`,
//     the dest as written; the runtime clears the repaint before its state
//     and makes it again after.
//   A position state it leaves in its first ticks (an exact `time = 1`
//     exit, the boss chain's 17477) cannot be held: no step.
//   HOLD: the hook holds the member in the step's state at the state's own
//     animation (`hold` { state, anim, skip, restart }): no loop's end comes,
//     and a state that leaves by `time >= N` (N >= 60, a random pick or not)
//     is entered again at N - 1 (`restart`). The animation is the one the
//     state SETTLES ON: its own ChangeAnim/ChangeAnim2 lines whose only
//     conditions are `anim = <a>` and pinned variables are followed (Project
//     Rose's 22303 turns 7231 into 27231 each tick on its Skeleton's
//     `var(15) = 2`; held at 7231, the hook and the state would swap it back
//     and forth every tick). An animation-keyed speed that settles on another
//     speed's animation is that speed, and one whose animation the state
//     never shows under the pins (no header, no ChangeAnim line not false
//     gives it) is another kind's: TOBF+'s Zombie in 22303 has no steps at
//     the Skeleton's 27231-27235. An INTRO's hold FREEZES instead
//     (`freeze`, with `explods`: the literal ids of the Explods it makes on
//     its first tick): it plays once and holds its last frame, those layers
//     and her side with it (a restart of the animation alone replays the
//     Zombie's insertion, its time-0 head-and-mane layer 3343 gone at the
//     first pass's end).
//   HIS CAMERA CURSORS (`cams`): helpers of his - no member, companion or
//     summon - whose own state holds the camera on them (a ScreenBound with a
//     nonzero movecamera x on a line that always fires: TOBF's and ZHE's
//     22401 'Camera'). The runtime hides them and keeps one.
//   AWAY: his root is out of the scene while his mob plays - his idle (his
//     state 0 and the states it and his -1/-2/-3 go on to with no command
//     and no AI, never a move or a scene: TOBF's 1000 and 1001) PosSets him
//     off the ground. The runtime holds such a root beside her while a member
//     plays; a root that stays where the place stood it (Colette, WrestlerX,
//     ZHE, and GoblinParty's, blank there) plays as it stands.
//   BORROWED ART: a giver built on another's files (his PEERS: the
//     characters beside him that ship the state files its idle and grab come
//     from, by name - Project Rose, Gnoll Raid2, TOBF+ and TOBF all ship
//     TowerOfBloodyfight-Ske.st) that drew some member type anew - none of
//     its idle and grab sprites the same as a peer's - while another's idle
//     and grab sprites are all a peer's, the same pixels (the palette aside):
//     that one wears the base's art, and its steps' labels say "[base art]"
//     first. Project Rose redrew Roccas and the Fox Demon, and its Skeleton
//     is TOBF+'s yellow-and-pink thug (1110, 1121; its pos 1 scenes the new
//     wolf 17220, its pos 2 the thug's 27230); Gnoll Raid2 redrew the Zombie
//     and the Skeleton as gnolls, and its Titan is TOBF's. A build that
//     redrew none (TOBF+ beside TOBF) marks nothing. Its idle: its own idle
//     states (never one its kinds share, the onlookers 66999) and its grab,
//     at the animations they show on their first tick under its pins and
//     its OWN NUMBERS (what his -1/-2/-3 set on it by its helper id alone:
//     TOBF's `var(1) = 20000*IsHelper(20000) + ...`, the Skeleton's idle
//     21000 at `var(1)+1000`).
//
// THE STEPS of a member type, a group named by its Helper ("Zombie"), after
// the core steps - or in place of the core's summon steps whose `clear` is
// one of its member ids (the "the grab" of every member at once), at the
// first one's place: "the grab (<its button>)" ("the grab 1", "the grab 2"
// for several families; until her first scene - and the scenes of the
// states its grab state passes on to in its first ticks, ZHE's 7477 -> 7480
// at `time = 1`, her 1409 and 1410, since the core sees her state from the
// tick after the grab; it holds its grab state, the Zombie's 16667 restarted
// before its `time > 250`, or the one state it passes on to), then per position "pos k,
// intro", "pos k, speed i" (or "pos k" alone), "pos k, phase j", "pos k,
// climax" ("climax i" with several pictures). `entry` is the member's first
// spawn state (never entered: the runtime brings the member by its route),
// `nav` its place: pos "<group> <k>" (the grab "<group> grab"), speed 0 the
// intro, 1..n its speeds then its phases, climax true on a climax (speed i
// its picture). Her scenes a step reaches that the core walk listed
// unreachable count for her (counts).
//
// step.mob (the runtime half's input; pre-trim):
//   { id, who, ids, route: { cmd?, state?, present?, after }, starts, settle, gap,
//     scenes: [[a, b]], grab, pins: [{ kind, index, value, why }],
//     go?: { state, home: [[a, b]], in?: [[a, b]], via?: { state, in }, hub? },
//     hold?: { state, anim, skip, restart?, freeze?, explods?, enter?, bind?, at?, colors?, hub? },
//     cams?: [id], away?: true, park?: true }
//   id      the member's helper id; who its name; ids every member id of his
//           and his ambient grabbers
//   route   cmd: the command pressed on him (latin1 name), or state: the
//           state of his entered with Lua changeState, or present: one is
//           always out; after: his state time before it acts
//   starts  its spawn states; settle: the ones it is not jumped from
//   scenes  its own states that hold her (the go acts only from them)
//   grab    its grab state (the hook stands it beside her, facing her, and
//           selfStates it there: its AI's distance and random gates skipped)
//   pins    held on it every frame: type pins, its family, its meter, its
//           return
//   go      the state the hook moves it into once it holds her, unless it is
//           already in `home` (from its states in `in`, its scenes when not
//           said; via: the state it goes to first from the states in its
//           own `in` - THE HEAD FIRST)
//   hold    the animation the hook holds it at in that state (freeze: an
//           intro's, played once and held on its last frame with its
//           explods; enter: an offset pose's, the state entered again where
//           the animation is another; bind: its layers name her, THE
//           AUTHOR'S BIND, and `at` where it stands from her along her
//           facing; colors: ITS OWN COLORS, the repaint's dest)
//   cams    his camera cursors' helper ids (hidden, one kept)
//   away    his root is held beside her while the member plays
//   hub     a relayed member's (go: { state, prev, anim? }, hold: its lines;
//           gallerymodes/mob-rt.js has them)
//   park    it is held far above the stage until its jump
// The step's own `setup` holds the count gate and a root type on him (a
// relayed member's: his position lock).
//
// SWITCHED OFF (its Mods tab row, or this file gone), nothing here runs: the
// gallery is the core's.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ID = 'mob';
const CAP_REACH = 400;        // states a member's reach may hold
const RESTART_MIN = 60;       // a time exit this late is held by a restart
const EARLY = 2;              // a grab state gone by this time passes her on
const CTRL_VAR = 'sysvar(9999)'; // his ctrl, as rewriteAtoms (more.ctrl) writes it
const GAP_DEF = 36, GAP_MIN = 24, GAP_MAX = 64;
const OFFSET_MAX = 64;        // offsets an ANIMATION BY OFFSET reading looks at

// The relayed members' reading (gallerymodes/mob-relay.js), when it is there:
// without it the mode reads his literal members only. A relay read that
// throws is no relay, said once per message.
let RELAY = null;
try {
  RELAY = require('./mob-relay.js');
} catch (e) {
  if (!(e && e.code === 'MODULE_NOT_FOUND' && /mob-relay/.test(String(e.message)))) console.warn('H gallery: mode mob reads no relayed members: ' + String((e && e.message) || e).split('\n')[0].slice(0, 200));
}
const relayWarned = new Set();
const warnRelay = (e) => {
  const msg = String((e && e.message) || e).split('\n')[0].slice(0, 200);
  if (relayWarned.has(msg)) return;
  relayWarned.add(msg);
  console.warn('H gallery: mode mob reads no relayed members here: ' + msg);
};

const ascii = (s) => String(s).replace(/[^\x20-\x7e]/g, '?');
const sortN = (it) => [...new Set(it)].sort((a, b) => a - b);
const ranges = (list) => {
  const out = [];
  for (const n of sortN(list)) {
    const last = out[out.length - 1];
    if (last && n === last[1] + 1) last[1] = n; else out.push([n, n]);
  }
  return out;
};
const inRanges = (rs, n) => rs.some(([a, b]) => n >= a && n <= b);
const atomsOf = (trig) => [...trig.all, ...trig.groups.flat()].map(String);
const redirectedAt = (s, off) => /[a-z0-9_)\]]\s*,\s*$/i.test(s.slice(0, off));

// ---- reading a giver: his members ------------------------------------------
// His members as the rules above read them, and his RELAYED MEMBERS (the
// header's paragraph; gallerymodes/mob-relay.js). The two never share an id:
// the first reads only literal helper ids, the second only variable ones.
function read(G, ctx) {
  const plain = readPlain(G, ctx);
  let relay = null;
  if (RELAY) {
    try { relay = RELAY.relayRead(G, ctx); } catch (e) { relay = null; warnRelay(e); }
  }
  if (!plain && !relay) return null;
  return Object.assign(plain || { members: [], ids: [] }, relay ? { relay } : {});
}
function readPlain(G, ctx) {
  const L = ctx.lib, F = ctx.fns || {};
  if (!G || !G.an || !Array.isArray(G.helperCtrls) || !F.W || typeof F.standingGrab !== 'function') return null;
  const { X, S } = L;
  const an = G.an, W = F.W;
  const isBasic = L.isBasic;
  const playable = (k) => G.cmdInfo.has(k) && G.cmdInfo.get(k).playable;
  const companionIds = new Set((G.companions || []).map((c) => c.id));
  const ids = sortN(G.helperCtrls.map((h) => h.id).filter((id) => Number.isInteger(id) && !companionIds.has(id)));
  // (A name may start with a digit - WrestlerX's '1stMomo' - but holds a letter.)
  const nameOf = (sc) => { const hn = String(sc.params.get('name') || '').replace(/^\s*"|"\s*$/g, '').trim(); return /^[A-Za-z0-9][A-Za-z0-9 ]{1,15}$/.test(hn) && /[A-Za-z]/.test(hn) ? hn : ''; };
  const setupVal = (kind, index) => { const s = (G.setup || []).find((x) => x.kind === kind && x.index === index); return s ? s.value : null; };
  // His variables at their round-start 0 - or at the value the pair's setup
  // holds them at (ZHE's var(53) = 1 keeps his AI's Futa 500 from coming) -
  // and a time.
  const held = {};
  for (const s of G.setup || []) held[s.kind + '(' + s.index + ')'] = s.value;
  const zeroVars = (exprs, base) => {
    const ctx0 = Object.assign({ isHelper: false, [CTRL_VAR]: 1 }, held, base || {});
    for (const e of exprs) for (const v of X.varsOf(e)) if (!Object.prototype.hasOwnProperty.call(ctx0, v)) ctx0[v] = 0;
    return ctx0;
  };
  // (In his idle at round start: his helpers' variables at their 0 - the
  // attachers GoblinParty's spawn line reads - and his ctrl on.)
  const more = { power: G.power, herLife: L.HER_LIFE, missingHelpers: () => true, helperVars: true, ctrl: true };
  const rewrite = (trig, inputs, stateNo) => ({ all: trig.all.map((e) => L.rewriteAtoms(e, inputs, stateNo, undefined, more)), groups: trig.groups.map((g) => g.map((e) => L.rewriteAtoms(e, inputs, stateNo, undefined, more))) });
  const timeAtoms = (exprs) => {
    const out = [];
    for (const e of exprs) for (const m of String(e).matchAll(/(!?)\s*\btime\b\s*(>=|>|=)?\s*(\d+)?/gi)) {
      if (redirectedAt(String(e), m.index + m[1].length)) continue;
      if (m[1] === '!' && !m[2]) out.push({ op: '=', n: 0 });
      else if (m[2] && m[3] !== undefined) out.push({ op: m[2], n: +m[3] });
    }
    return out;
  };

  // ROUTES, per id.
  const routeOf = (id) => {
    const ctrls = G.helperCtrls.filter((h) => h.id === id);
    // press
    for (const c of ctrls) {
      if (c.state > -1 || c.state < -3) continue;
      const trig = c.sc.trig;
      for (const grp of trig.groups.length ? trig.groups : [[]]) {
        const set = { all: trig.all, groups: [grp] };
        const cmds = L.commandsIn(set).filter(playable);
        if (cmds.length !== 1) continue;
        const cmd = cmds[0];
        const atoms = [...set.all, ...grp].map(String);
        const ta = timeAtoms(atoms);
        const after = ta.reduce((m, t) => Math.max(m, t.op === '>' ? t.n + 1 : t.n), 0);
        const on = rewrite(set, new Set([cmd]), 0), off = rewrite(set, new Set(), 0);
        const ctxOn = zeroVars([...on.all, ...on.groups.flat()], { time: Math.max(after, 1) + 600 });
        const ctxOff = zeroVars([...off.all, ...off.groups.flat()], { time: Math.max(after, 1) + 600 });
        let yes = null, no = null;
        try { yes = X.evalTriggerSet(on, ctxOn); no = X.evalTriggerSet(off, ctxOff); } catch (e) { yes = null; }
        if (yes !== true || no !== false) continue;
        // (A press that would start a move of his in his idle: no route.)
        let moves = false;
        for (const neg of [-1, -2, -3]) {
          const st = an.states.get(neg);
          if (!st || moves) continue;
          for (const sc of st.sctrls) {
            if (!['changestate', 'selfstate', 'hitdef'].includes(sc.type) || !L.commandsIn(sc.trig).includes(cmd)) continue;
            const rw = rewrite(sc.trig, new Set([cmd]), 0);
            let t = null;
            try { t = X.evalTriggerSet(rw, zeroVars([...rw.all, ...rw.groups.flat()], { time: 600 })); } catch (e) { t = null; }
            if (t !== false) { moves = true; break; }
          }
        }
        if (moves) continue;
        const starts = sortN(W.values(c.sc.params.get("stateno"), {}, c.state).filter((v) => an.states.has(v)));
        if (!starts.length) continue;
        return { kind: 'press', cmd, after, starts, sc: c.sc, ctrlState: c.state };
      }
    }
    // state: a summon state the core knows first
    const known = (G.summons || []).filter((s) => s.helper === id || (s.also || []).includes(id)).map((s) => s.no);
    const cand = ctrls.filter((c) => c.state >= 0 && !isBasic(c.state) && G.root && G.root.has(c.state))
      .sort((a, b) => (known.includes(a.state) ? 0 : 1) - (known.includes(b.state) ? 0 : 1) || a.state - b.state);
    for (const c of cand) {
      const trig = c.sc.trig;
      const exprs = atomsOf(trig);
      // (No AI-only Helper.)
      if (exprs.some((e) => /\bailevel\s*(>|>=|!=)\s*0|\bailevel\s*=\s*[1-9]/i.test(e))) continue;
      const gates = countGates(trig, id);
      const times = [{ op: '=', n: 0 }, ...timeAtoms(exprs)];
      let after = null;
      const rw = rewrite(trig, new Set(), c.state);
      for (const t of times) {
        const tv = t.op === '>' ? t.n + 1 : t.n;
        const base = { time: tv };
        for (const g of gates) base[g.name] = g.value;
        let v = null;
        try { v = X.evalTriggerSet(rw, zeroVars([...rw.all, ...rw.groups.flat()], base)); } catch (e) { v = null; }
        if (v === true) { after = tv; break; }
      }
      if (after === null) continue;
      const starts = sortN(W.values(c.sc.params.get('stateno'), {}, c.state).filter((v) => an.states.has(v)));
      if (!starts.length) continue;
      return { kind: 'state', state: c.state, after, starts, sc: c.sc, ctrlState: c.state, gates };
    }
    // press into a state: a Helper in a state S of his that his -1/-2/-3
    // enter on one playable command in his idle (WrestlerX's qcb+kick ->
    // 1400). S's first tick reads that command (`var(19) = ifelse(command =
    // "zombiea", 0, ...)`, its VarSets on `!time`), then the Helper's trigger
    // at S's time 0 (`AnimElem = 1` is that tick): the command whose first
    // tick spawns this member is pressed.
    for (const c of ctrls) {
      const S = c.state;
      if (S < 0 || isBasic(S) || !(G.root && G.root.has(S))) continue;
      for (const neg of [-1, -2, -3]) {
        const st = an.states.get(neg);
        if (!st) continue;
        for (const sc of st.sctrls) {
          if ((sc.type !== 'changestate' && sc.type !== 'selfstate') || !W.values(sc.params.get('value'), {}, neg).includes(S)) continue;
          for (const cmd of L.commandsIn(sc.trig).filter(playable)) {
            const on = rewrite(sc.trig, new Set([cmd]), 0), off = rewrite(sc.trig, new Set(), 0);
            let yes = null, no = null;
            try { yes = X.evalTriggerSet(on, zeroVars(atomsOf(on), { time: 600 })); no = X.evalTriggerSet(off, zeroVars(atomsOf(off), { time: 600 })); } catch (e) { yes = false; }
            if (yes === false || no !== false) continue;
            const first = firstTick(S, cmd);
            const hrw = rewrite({ all: c.sc.trig.all.map(animElem1), groups: c.sc.trig.groups.map((g) => g.map(animElem1)) }, new Set([cmd]), S);
            let v = null;
            try { v = X.evalTriggerSet(hrw, zeroVars(atomsOf(hrw), Object.assign({ time: 0 }, first))); } catch (e) { v = null; }
            if (v !== true) continue;
            const starts = sortN(W.values(c.sc.params.get('stateno'), {}, S).filter((x) => an.states.has(x)));
            if (!starts.length) continue;
            return { kind: 'press', cmd, after: 0, starts, sc: c.sc, ctrlState: S, via: S };
          }
        }
      }
    }
    // present: a Helper in his -1/-2/-3 on no command that holds for him in
    // his idle with the member absent - one is always out (Colette's striker
    // 2000, `Numhelper(2000) = 0` and `RoundState <= 2`). Not his AI's.
    for (const c of ctrls) {
      if (c.state > -1 || c.state < -3) continue;
      const trig = c.sc.trig;
      if (L.commandsIn(trig).length || atomsOf(trig).some((e) => /\bailevel\b/i.test(e))) continue;
      const rw = rewrite(trig, new Set(), 0);
      let v = null;
      try { v = X.evalTriggerSet(rw, zeroVars(atomsOf(rw), { time: 600 })); } catch (e) { v = null; }
      if (v !== true) continue;
      const starts = sortN(W.values(c.sc.params.get('stateno'), {}, c.state).filter((x) => an.states.has(x)));
      if (!starts.length) continue;
      return { kind: 'present', after: 0, starts, sc: c.sc, ctrlState: c.state };
    }
    return null;
  };
  // (`AnimElem = 1` is a state's first tick.)
  function animElem1(e) { return String(e).replace(/\banimelem\s*=\s*1\b(?!\s*[,.\d])/gi, (all, off, str) => (redirectedAt(str, off) ? all : '(time = 0)')); }
  // His variables a state S writes on its first tick (`!time`, `time = 0`)
  // with that command pressed: { 'var(19)': 1 }.
  function firstTick(S, cmd) {
    const out = {};
    const st = an.states.get(S);
    if (!st) return out;
    for (const sc of st.sctrls) {
      if (sc.type !== 'varset') continue;
      const rw = rewrite(sc.trig, new Set([cmd]), S);
      let t = null;
      try { t = X.evalTriggerSet(rw, zeroVars(atomsOf(rw), Object.assign({ time: 0 }, out))); } catch (e) { t = null; }
      if (t !== true) continue;
      for (const [nm, raw] of W.writesOf(sc)) {
        if (!L.VARNAME.test(nm)) continue;
        let v = null;
        try { v = X.evalExpr(L.rewriteAtoms(String(raw), new Set([cmd]), S, undefined, more), zeroVars([String(raw)], out)); } catch (e) { v = null; }
        if (typeof v === 'number' && Number.isFinite(v)) out[nm.toLowerCase()] = v;
      }
    }
    return out;
  }
  // COUNT GATES: `var(N) < K` in a Helper's trigger, var(N) raised by a
  // ParentVarAdd somewhere in his files.
  const raisedByParentAdd = new Set();
  for (const st of an.states.values()) for (const sc of st.sctrls) if (sc.type === 'parentvaradd') for (const [nm] of W.writesOf(sc)) raisedByParentAdd.add(nm.toLowerCase());
  function countGates(trig, id) {
    const out = [];
    for (const e of atomsOf(trig)) for (const m of e.matchAll(/(^|[^,\w\s])\s*(f?var)\s*\(\s*(\d+)\s*\)\s*(<=|<)\s*(\d+)/gi)) {
      const name = m[2].toLowerCase() + '(' + m[3] + ')';
      if (!raisedByParentAdd.has(name)) continue;
      const K = +m[5] + (m[4] === '<=' ? 1 : 0);
      const own = setupVal(m[2].toLowerCase(), +m[3]);
      const value = own !== null && own < K ? own : 0;
      if (!out.some((g) => g.name === name)) out.push({ name, kind: m[2].toLowerCase(), index: +m[3], value, under: K, own: own === value });
    }
    return out;
  }
  // MORE THAN ONE: NumHelper(id) < N >= 2, a count gate under N >= 2, or two
  // Helpers of it in one state of his own (his negative states' Helpers of
  // one id are ways of calling it - a button, his AI - not two at once).
  const manyOf = (id, route) => {
    const ctrls = G.helperCtrls.filter((h) => h.id === id);
    const re = new RegExp('\\bnumhelper\\s*\\(\\s*' + id + '\\s*\\)\\s*(<=|<)\\s*(\\d+)', 'i');
    for (const c of ctrls) for (const e of atomsOf(c.sc.trig)) { const m = re.exec(e); if (m && +m[2] + (m[1] === '<=' ? 1 : 0) >= 2) return true; }
    if ((route.gates || []).some((g) => g.under >= 2)) return true;
    const per = new Map();
    for (const c of ctrls) if (c.state >= 0) per.set(c.state, (per.get(c.state) || 0) + 1);
    return [...per.values()].some((n) => n >= 2);
  };

  // IDLE STATES of a member: from its spawn, never into a grab or a scene.
  // (A hit only his own side takes - `affectteam = F`, GoblinParty's 322
  // GRAB PARTNER - never catches her.)
  const grabsIn = (no) => (an.states.get(no) ? an.states.get(no).sctrls.filter((sc) => F.standingGrab(sc) && !/^\s*f\s*$/i.test(String(sc.params.get('affectteam') === undefined ? '' : sc.params.get('affectteam')))) : []);
  // OWN ID: a grab HitDef fires for the member only where its trigger can
  // hold for the member's own helper id (cnsexpr ctx.helperId). WrestlerX's
  // Momo hammer 47470 grabs (p1stateno 27477) only on `isHelper(7442)`, his
  // Royal Rumble copy; for its own id 47400 it is a plain hit on
  // `!isHelper(7442)`, so Momo grabs nothing and is no member.
  const ownFires = (hd, num) => { let t = null; try { t = X.evalTriggerSet(hd.trig, num); } catch (e) { t = null; } return t !== false; };
  const idleOf = (starts) => {
    const seen = new Set(), q = [];
    const push = (n) => { if (!seen.has(n) && an.states.has(n) && !isBasic(n) && seen.size < 40) { seen.add(n); q.push(n); } };
    starts.forEach(push);
    while (q.length) {
      const no = q.shift();
      const st = an.states.get(no);
      if (grabsIn(no).length || st.sctrls.some((sc) => sc.type === 'targetstate')) continue;
      for (const sc of st.sctrls) {
        if (sc.type !== 'changestate' && sc.type !== 'selfstate') continue;
        // (Only its own fixed ways: a line whose value or trigger reads a
        // variable of its own is a state its kinds share, which picks the
        // way by its type - TOBF's onlookers 66999 into each kind's idle.)
        const raw = String(sc.params.get('value') === undefined ? '' : sc.params.get('value'));
        if (X.varsOf(raw).length || atomsOf(sc.trig).some((e) => X.readsOf(e).some((r) => r.via === null && L.VARNAME.test(r.field)))) continue;
        for (const v of W.values(raw, {}, no)) if (!grabsIn(v).length) push(v);
      }
    }
    return seen;
  };
  const initWrites = (states) => {
    const out = new Map();
    for (const no of states) for (const sc of an.states.get(no).sctrls) {
      if (sc.type !== 'varset') continue;
      let t = null;
      try { t = X.evalTriggerSet(sc.trig, zeroVars(atomsOf(sc.trig), { time: 0, isHelper: true })); } catch (e) { t = null; }
      if (t !== true) continue;
      for (const [nm, raw] of W.writesOf(sc)) { const v = S.lit(raw); if (v !== null && L.VARNAME.test(nm) && !out.has(nm.toLowerCase())) out.set(nm.toLowerCase(), v); }
    }
    return out;
  };
  // Variables a HitDef's p1/p2stateno or a ChangeState's value reads.
  const routeVars = new Set();
  for (const st of an.states.values()) for (const sc of st.sctrls) {
    const raws = sc.type === 'hitdef' ? [sc.params.get('p1stateno'), sc.params.get('p2stateno')] : sc.type === 'changestate' || sc.type === 'selfstate' ? [sc.params.get('value')] : [];
    for (const r of raws) if (r !== undefined) for (const v of X.varsOf(String(r))) routeVars.add(v.toLowerCase());
  }

  // Pass 1: routes and idle writes.
  // (ONE AT A TIME: a helper out only once - Colette's striker, GoblinParty's
  // player goblin - is a member where the core knows no summon of it, and a
  // pair keeps it only where the core walk has no step of his: pair().)
  const summoned = (id) => (G.summons || []).some((s) => s.helper === id || (s.also || []).includes(id));
  const cands = [];
  for (const id of ids) {
    const route = routeOf(id);
    if (!route) continue;
    const one = !manyOf(id, route);
    if (one && summoned(id)) continue;
    const idle = idleOf(route.starts);
    cands.push({ id, route, idle, writes: initWrites(idle), one });
  }
  if (!cands.length) return null;
  // Pass 2: the type variables.
  const typeVars = new Set();
  for (const c of cands) for (const [nm, v] of c.writes) if (v !== 0 && routeVars.has(nm)) typeVars.add(nm);
  // (A type tells kinds apart: one their values do not differ in is none.
  // Only kinds whose states hold a grab at all count - not ZHE's effects,
  // and never a grab that fires only for another helper id: OWN ID below.)
  const grabbing = cands.filter((c) => [...W.rootReach(c.route.starts, true)].some((no) => grabsIn(no).some((hd) => hd.type === 'hitdef' && ownFires(hd, { isHelper: true, helperId: c.id })
    && (W.values(hd.params.get('p2stateno'), {}, no).some((v) => G.hScenes.has(v) && v !== no) || W.values(hd.params.get('p1stateno'), {}, no).some((v) => v !== no && F.issuesAtOnce(v))))));
  for (const nm of [...typeVars]) if (new Set(grabbing.map((c) => (c.writes.has(nm) ? c.writes.get(nm) : 0))).size < 2) typeVars.delete(nm);
  // ITS ART (for BORROWED ART), under its pins and its OWN NUMBERS: what his
  // -1/-2/-3 set on it by its helper id alone (TOBF's -2 `var(1) =
  // 10000*IsHelper(10000) + 15000*IsHelper(15000) + ...` on `!var(1)`: the
  // Skeleton's var(1) is 20000, its idle 21000's animation `var(1)+1000`).
  const ownNumbers = (id) => {
    const out = {};
    for (const neg of [-3, -2, -1]) {
      const st = an.states.get(neg);
      if (!st) continue;
      for (const sc of st.sctrls) {
        if (sc.type !== 'varset') continue;
        const ws = W.writesOf(sc);
        if (![...atomsOf(sc.trig), ...ws.map(([, raw]) => String(raw))].some((e) => /\bishelper\s*\(/i.test(e))) continue;
        let t = null;
        try { t = X.evalTriggerSet(sc.trig, zeroVars(atomsOf(sc.trig), { isHelper: true, helperId: id, time: 0 })); } catch (e) { t = null; }
        if (t !== true) continue;
        for (const [nm, raw] of ws) {
          if (!L.VARNAME.test(nm) || Object.prototype.hasOwnProperty.call(out, nm.toLowerCase())) continue;
          let v = null;
          try { v = X.evalExpr(String(raw), { isHelper: true, helperId: id }); } catch (e) { v = null; }
          if (typeof v === 'number' && Number.isFinite(v)) out[nm.toLowerCase()] = v;
        }
      }
    }
    return out;
  };
  // The sprites ('g,i') some states stand in: the animations each shows on
  // its first tick (its header's, and its ChangeAnims' that can fire then -
  // the grab 16666's `ifelse(var(15)=2,86300,16300)` at `time = 0`).
  const drawn = (nos, A) => {
    const keys = new Set();
    for (const no of nos) {
      let anims = [];
      try { anims = W.animTicks(no, A).anims; } catch (e) { anims = []; }
      for (const a of anims) for (const k of G.gAir.get(a) || []) keys.add(String(k));
    }
    return [...keys];
  };
  const arts = new Map();
  // Pass 3: per member, its pins, reach, grabs and families. (Its reach never
  // enters another member's idle states: a shared state that hands a kind
  // back to its own idle is no way into another kind's grab.)
  const members = [];
  for (const c of cands) {
    const others = new Set(cands.filter((o) => o !== c).flatMap((o) => [...o.idle]).filter((n) => !c.idle.has(n)));
    const pins = [...typeVars].sort().map((nm) => Object.assign(L.varRef(nm), { value: c.writes.has(nm) ? c.writes.get(nm) : 0,
      why: ascii('its type: ' + (c.writes.has(nm) ? 'its spawn states set ' + nm + ' = ' + c.writes.get(nm) : 'it never sets ' + nm + ', which its kinds\' shared states read')) }));
    const A = {}, num = { isHelper: true, helperId: c.id };
    for (const p of pins) { A[p.kind + '(' + p.index + ')'] = [p.value]; num[p.kind + '(' + p.index + ')'] = p.value; }
    // ITS REACH, its pins and its own id read.
    const reach = new Set(), q = [];
    const push = (n) => { if (!reach.has(n) && !others.has(n) && an.states.has(n) && !isBasic(n) && n >= 0 && reach.size < CAP_REACH) { reach.add(n); q.push(n); } };
    c.route.starts.forEach(push);
    while (q.length) {
      const no = q.shift();
      for (const sc of an.states.get(no).sctrls) {
        let raw;
        if (sc.type === 'changestate' || sc.type === 'selfstate') raw = sc.params.get('value');
        else if (sc.type === 'hitdef' || sc.type === 'projectile') raw = sc.params.get('p1stateno');
        else continue;
        if (raw === undefined) continue;
        let t = null;
        try { t = X.evalTriggerSet(sc.trig, num); } catch (e) { t = null; }
        if (t === false) continue;
        for (const v of W.values(raw, A, no)) push(v);
      }
    }
    // ITS GRABS. (Where its idle states enter some directly - its AI's own
    // grab - only those: a grab it reaches through a state its kinds share is
    // another kind's. Two grabs that land in one family are one, the first.)
    let grabs = [];
    const fromIdle = new Set();
    for (const no of c.idle) for (const sc of an.states.get(no).sctrls) if (sc.type === 'changestate' || sc.type === 'selfstate') for (const v of W.values(sc.params.get('value'), A, no)) fromIdle.add(v);
    for (const no of sortN(reach)) {
      for (const hd of grabsIn(no)) {
        if (hd.type !== 'hitdef' || !ownFires(hd, num)) continue;
        const p2 = W.values(hd.params.get('p2stateno'), A, no).filter((v) => G.hScenes.has(v) && v !== no);
        const p1 = W.values(hd.params.get('p1stateno'), A, no).filter((v) => v !== no && an.states.has(v));
        const atOnce = p1.filter((v) => F.issuesAtOnce(v));
        if (!p2.length && !atOnce.length) continue;
        if (grabs.some((g) => g.state === no)) continue;
        grabs.push({ state: no, hd, families: familiesOf(no, hd, A), direct: fromIdle.has(no) });
      }
    }
    // (ROOT TYPES: where a variable of his root sends it into a grab -
    // Colette's striker enters 7470 from 2020 and 17470 from 2040 at once on
    // `root,var(40) = 3`, her intro's random pick of her striker - those are
    // its grabs, each with that value held on him by the step's setup; a
    // flag at its rest, `root,var(36) = 0`, is no type.)
    const keyed = [];
    for (const no of sortN(reach)) for (const sc of an.states.get(no).sctrls) {
      if (sc.type !== 'changestate' && sc.type !== 'selfstate') continue;
      const atom = atomsOf(sc.trig).map((e) => /^\s*(?:root|parent)\s*,\s*(f?var)\s*\(\s*(\d+)\s*\)\s*=\s*(-?\d+)\s*$/i.exec(e)).find(Boolean);
      if (!atom || +atom[3] === 0) continue;
      for (const v of W.values(sc.params.get('value'), A, no)) {
        const g = grabs.find((x) => x.state === v);
        if (g && !keyed.some((k) => k.state === v)) keyed.push(Object.assign({}, g, { rootPin: { kind: atom[1].toLowerCase(), index: +atom[2], value: +atom[3] } }));
      }
    }
    if (keyed.length) grabs = keyed;
    else if (grabs.some((g) => g.direct)) grabs = grabs.filter((g) => g.direct);
    {
      const seenFam = new Set();
      for (const g of grabs) g.families = g.families.filter((f) => { const k = f.p1 + '|' + (f.pin ? f.pin.kind + f.pin.index + '=' + f.pin.value : ''); if (seenFam.has(k)) return false; seenFam.add(k); return true; });
      grabs = grabs.filter((g) => g.families.length);
    }
    if (!grabs.length) continue;
    // ITS NAME, its gap, its settle.
    const who = nameOf(c.route.sc) || (G.helperCtrls.filter((h) => h.id === c.id).map((h) => nameOf(h.sc)).find(Boolean)) || 'helper ' + c.id;
    const front = S.lit(String(c.route.sc.params.get('size.ground.front') === undefined ? '' : c.route.sc.params.get('size.ground.front')));
    let mid = null;
    for (const no of reach) for (const sc of an.states.get(no).sctrls) {
      if (mid !== null || sc.type !== 'changestate' || !grabs.some((g) => W.values(sc.params.get('value'), A, no).includes(g.state))) continue;
      for (const e of atomsOf(sc.trig)) {
        const m = /\bp2bodydist\s*x\s*=\s*\[\s*(-?\d+)\s*,\s*(-?\d+)\s*\]/i.exec(e) || /\bp2bodydist\s*x\s*(<=|<)\s*(-?\d+)/i.exec(e);
        if (!m) continue;
        mid = m.length === 3 && m[1] !== '<' && m[1] !== '<=' ? Math.round((+m[1] + +m[2]) / 2) : Math.round(+m[2] / 2);
        break;
      }
    }
    const gap = mid === null ? GAP_DEF : Math.max(GAP_MIN, Math.min(GAP_MAX, mid + (front || 0) + 16));
    // (A spawn state it leaves on its first tick, writing its variables.)
    const first = (sc) => { const a = atomsOf(sc.trig); return a.length > 0 && a.every((e) => /^\s*(!\s*time|time\s*=\s*0|1)\s*$/i.test(e)); };
    const settle = c.route.starts.filter((no) => {
      const sc = an.states.get(no).sctrls;
      return sc.some((x) => ['varset', 'varadd', 'parentvaradd', 'parentvarset'].includes(x.type) && first(x)) && sc.some((x) => x.type === 'changestate' && first(x));
    });
    // (Its art, for BORROWED ART: the files of its own idle - never a state
    // its kinds share, TOBF's onlookers 66999 - and its grab, and the sprites
    // they stand in.)
    const grabSet = new Set(grabs.map((g) => g.state));
    const idleNos = [...[...c.idle].filter((no) => !cands.some((o) => o !== c && o.idle.has(no))), ...grabSet];
    const artA = Object.assign({}, A);
    for (const [nm, v] of Object.entries(ownNumbers(c.id))) if (!artA[nm]) artA[nm] = [v];
    arts.set(c.id, { files: [...new Set(idleNos.map((no) => an.states.get(no).file).filter(Boolean))], idle: drawn(idleNos, artA) });
    members.push(Object.assign({ id: c.id, who, route: { kind: c.route.kind, cmd: c.route.cmd, state: c.route.state, after: c.route.after },
      gates: c.route.gates || [], starts: c.route.starts, settle, gap, pins, grabs: grabs.map((g) => Object.assign({ state: g.state, families: g.families }, g.rootPin ? { rootPin: g.rootPin } : {})) }, c.one ? { one: true } : {}));
  }
  if (!members.length) return null;
  // BORROWED ART (the header's rule): a member type that wears a peer's
  // sprites in its idle and its grab, in a giver that drew another member
  // type anew.
  {
    let based = null;
    try { based = borrowedArt(G, arts, L); } catch (e) { based = null; }
    for (const m of members) if (based && based.has(m.id)) m.baseArt = { from: based.get(m.id) };
  }
  // HIS CAMERA CURSORS: a helper of his - no member, companion or summon -
  // whose own state holds the camera on it, a ScreenBound with a nonzero
  // movecamera x on a line that always fires (TOBF's and ZHE's 22401
  // 'Camera', the author's cursor his fwd/back walks; its picture is the
  // floating head the gallery showed). His -2 brings one back whenever none
  // is out, so the runtime hides it and keeps one.
  const memberIds = new Set(members.map((m) => m.id));
  const movesCamera = (no) => {
    const st = an.states.get(no);
    if (!st) return false;
    return st.sctrls.some((sc) => {
      if (sc.type !== 'screenbound') return false;
      const mx = S.lit(String(sc.params.get('movecamera') === undefined ? '' : sc.params.get('movecamera')).split(',')[0]);
      if (!mx) return false;
      let t = null;
      try { t = X.evalTriggerSet(sc.trig, {}); } catch (e) { t = null; }
      return t === true;
    });
  };
  const cams = sortN(G.helperCtrls.filter((h) => Number.isInteger(h.id) && !memberIds.has(h.id) && !companionIds.has(h.id) && !summoned(h.id)
    && W.values(h.sc.params.get('stateno'), {}, h.state).some(movesCamera)).map((h) => h.id));
  // AWAY: his root out of the scene while his mob plays. His idle - his state
  // 0, where the gallery's reset stands him, and the states it and his
  // -1/-2/-3 go on to with no command and no AI, never a move or a scene
  // (TOBF's 0 -> 1000 -> 98989 -> 1001) - PosSets him off the ground on a
  // line that always fires there (1000: `trigger1 = 1`, `Y = -999`; 1001
  // then keeps him there and off the stage). The runtime then holds him
  // beside her while a member plays: the pair's center, its markers and the
  // member's side all read his place. (A root that only draws nothing is not
  // away, and neither is one whose PosSet waits on what the read cannot
  // settle: GoblinParty's state 0 shows a blank action, and hides him only
  // on a name its attacher's target has.)
  const away = (() => {
    const quiet = (sc, no, sure) => {
      if (L.commandsIn(sc.trig).length || atomsOf(sc.trig).some((e) => /\bailevel\s*(>|>=|!=)\s*0|\bailevel\s*=\s*[1-9]/i.test(e))) return false;
      const rw = rewrite(sc.trig, new Set(), no < 0 ? 0 : no);
      let t = null;
      try { t = X.evalTriggerSet(rw, zeroVars(atomsOf(rw), { time: 600 })); } catch (e) { t = null; }
      return sure ? t === true : t !== false;
    };
    const plays = (no) => { const st = an.states.get(no); return !st || st.sctrls.some((sc) => ['hitdef', 'projectile', 'targetstate'].includes(sc.type)); };
    const seen = new Set([0]), q = [0];
    const onTo = (no) => {
      const st = an.states.get(no);
      if (!st) return;
      for (const sc of st.sctrls) {
        if ((sc.type !== 'changestate' && sc.type !== 'selfstate') || !quiet(sc, no)) continue;
        for (const v of W.values(sc.params.get('value'), {}, no)) {
          if (v < 0 || seen.has(v) || seen.size >= 12 || !an.states.has(v) || !(G.root && G.root.has(v)) || plays(v)) continue;
          seen.add(v); q.push(v);
        }
      }
    };
    for (const neg of [-1, -2, -3]) onTo(neg);
    while (q.length) onTo(q.shift());
    for (const no of seen) {
      for (const sc of an.states.get(no).sctrls) {
        if (sc.type !== 'posset') continue;
        const y = S.lit(String(sc.params.get('y') === undefined ? '' : sc.params.get('y')));
        if (y && quiet(sc, no, true)) return true;
      }
    }
    return false;
  })();
  // AMBIENT GRABBERS: helpers his -1/-2/-3 spawn by themselves - a trigger
  // group that names no command and is no AI's, not false in his idle
  // (GoblinParty's 'Goblin creator npc' 10000 on `GameTime % 210 = 1`) -
  // whose reach holds a grab that fires for their own id. (A helper with no
  // grab - an attacher, a gauge, a cutscene - is the scene's and stays.)
  const byItself = (sc) => {
    const groups = sc.trig.groups.length ? sc.trig.groups : [[]];
    return groups.some((g) => {
      const set = { all: sc.trig.all, groups: [g] };
      if (L.commandsIn(set).length || atomsOf(set).some((e) => /\bailevel\s*(>|>=|!=)\s*0|\bailevel\s*=\s*[1-9]/i.test(e))) return false;
      const rw = rewrite(set, new Set(), 0);
      let t = null;
      try { t = X.evalTriggerSet(rw, zeroVars(atomsOf(rw), { time: 600 })); } catch (e) { t = null; }
      return t !== false;
    });
  };
  const grabsHer = (id, starts) => [...W.rootReach(starts, true)].some((no) => grabsIn(no).some((hd) => hd.type === 'hitdef' && ownFires(hd, { isHelper: true, helperId: id })
    && (W.values(hd.params.get('p2stateno'), {}, no).some((v) => G.hScenes.has(v) && v !== no) || W.values(hd.params.get('p1stateno'), {}, no).some((v) => v !== no && F.issuesAtOnce(v)))));
  const ambient = sortN(G.helperCtrls.filter((h) => Number.isInteger(h.id) && h.state <= -1 && h.state >= -3 && !memberIds.has(h.id) && !companionIds.has(h.id)
    && !cams.includes(h.id) && !summoned(h.id) && byItself(h.sc)
    && grabsHer(h.id, sortN(W.values(h.sc.params.get('stateno'), {}, h.state).filter((v) => an.states.has(v))))).map((h) => h.id));
  return Object.assign({ members, ids: members.map((m) => m.id) }, cams.length ? { cams } : {}, away ? { away: true } : {}, ambient.length ? { ambient } : {});

  // FAMILIES of a grab.
  function familiesOf(no, hd, A) {
    const p1raw = hd.params.get('p1stateno'), p2raw = hd.params.get('p2stateno');
    const drawn = sortN([...X.varsOf(String(p1raw || '')), ...X.varsOf(String(p2raw || ''))].filter((v) => L.VARNAME.test(v) && !Object.prototype.hasOwnProperty.call(A, v.toLowerCase()))).map(String);
    const out = [];
    const firstOf = (vals) => vals.filter((v) => an.states.has(v) && v !== no);
    if (drawn.length === 1) {
      const v = drawn[0];
      const setter = an.states.get(no).sctrls.find((sc) => sc.type === 'varset' && W.writesOf(sc).some(([nm, raw]) => nm.toLowerCase() === v.toLowerCase() && X.usesRandom(String(raw))));
      if (setter) {
        const raw = W.writesOf(setter).find(([nm]) => nm.toLowerCase() === v.toLowerCase())[1];
        const samples = sortN(X.evalRandom(String(raw), {}).filter(Number.isFinite).map(Math.trunc));
        const by = new Map();
        for (const x of samples) {
          const AA = Object.assign({}, A, { [v.toLowerCase()]: [x] });
          const p1 = firstOf(W.values(p1raw, AA, no)), p2 = W.values(p2raw, AA, no);
          if (p1.length !== 1) continue;
          const key = p1[0] + '>' + p2.join('/');
          if (!by.has(key)) by.set(key, { p1: p1[0], p2: p2.filter((c) => G.hScenes.has(c)), xs: [] });
          by.get(key).xs.push(x);
        }
        const ref = L.varRef(v.toLowerCase());
        for (const f of by.values()) out.push({ p1: f.p1, p2: f.p2, pin: { kind: ref.kind, index: ref.index, value: f.xs[Math.floor(f.xs.length / 2)], why: ascii('its family: its grab ' + no + ' draws ' + v + ' at random, and ' + f.xs[Math.floor(f.xs.length / 2)] + ' takes it to ' + f.p1) } });
      }
    }
    // (A variable its grab state draws at random that a later state of its
    // chain chooses its way by - GoblinParty's 323 draws `var(49) = random%2
    // + 1`, and 4000 goes on to 324 on var(49) = 1, to 350 on 2 - gives a
    // family per value, pinned at it.)
    if (!out.length) {
      const p1s = firstOf(W.values(p1raw, A, no));
      const draws = an.states.get(no).sctrls.filter((sc) => sc.type === 'varset').flatMap((sc) => W.writesOf(sc))
        .filter(([nm, raw]) => L.VARNAME.test(nm) && X.usesRandom(String(raw)) && !Object.prototype.hasOwnProperty.call(A, nm.toLowerCase()));
      const chooses = (v) => {
        const seen = new Set(p1s), q = [...p1s];
        while (q.length && seen.size < 24) {
          const s = q.shift();
          for (const sc of an.states.get(s) ? an.states.get(s).sctrls : []) {
            if (sc.type !== 'changestate' && sc.type !== 'selfstate') continue;
            if (atomsOf(sc.trig).some((e) => X.varsOf(e).map((x) => x.toLowerCase()).includes(v))) return true;
            for (const t of W.values(sc.params.get('value'), A, s)) if (!seen.has(t) && an.states.has(t) && !isBasic(t)) { seen.add(t); q.push(t); }
          }
        }
        return false;
      };
      const d = draws.find(([nm]) => chooses(nm.toLowerCase()));
      if (d && p1s.length === 1) {
        const samples = sortN(X.evalRandom(String(d[1]), {}).filter(Number.isFinite).map(Math.trunc));
        const ref = L.varRef(d[0].toLowerCase());
        if (samples.length >= 2 && samples.length <= 8) for (const x of samples) out.push({ p1: p1s[0], p2: W.values(p2raw, A, no).filter((c) => G.hScenes.has(c)),
          pin: { kind: ref.kind, index: ref.index, value: x, why: ascii('its family: its grab ' + no + ' draws ' + d[0] + ' at random, and its chain goes on by ' + d[0] + ' = ' + x) } });
      }
    }
    if (!out.length) {
      for (const p1 of firstOf(W.values(p1raw, A, no))) out.push({ p1, p2: W.values(p2raw, A, no).filter((c) => G.hScenes.has(c)), pin: null });
    }
    return out;
  }
}

// ---- one pair: the member steps for her -----------------------------------
function pair(G, R, ctx) {
  const rd = ctx.reading;
  if (!rd || ((!rd.members || !rd.members.length) && !rd.relay)) return null;
  const L = ctx.lib, F = ctx.fns || {};
  const { X, S } = L;
  const an = G.an;
  const victimHas = R && R.airActions instanceof Set ? R.airActions : null;
  const words = (k) => (G.cmdInfo.has(k) ? G.cmdInfo.get(k).words : k);
  const isRelease = (C) => { const sc = an.scenes.get(C); return !!(sc && sc.release); };
  const scene = (C) => G.hScenes.has(C) && !isRelease(C) && !(G.broken && G.broken.has(C));
  // HER STATES THAT FOLLOW ITS: a scene state of his played on her that
  // changes itself on her grabber's state, read off the hit
  // (`PlayerID(GetHitVar(fall.envshake.ampl)),stateno = 324` -> 334,
  // GoblinParty's victim): while the member is in 324 she goes to 334 - a
  // RELAY (no art of its own), followed like a scene: from 334 she goes to
  // 335 while it is in 325. herFollows: per state of hers, the states of its
  // she follows from there (the go's chain is read off them).
  const relay = (C) => { const sc = an.scenes.get(C); return !!sc && !G.hScenes.has(C) && !sc.release && !(G.broken && G.broken.has(C)); };
  const follow = new Map(), herFollows = new Map();
  for (const H of new Set([...G.hScenes, ...an.scenes.keys()])) {
    const st = an.states.get(H);
    if (!st || !(G.hScenes.has(H) || relay(H))) continue;
    for (const sc of st.sctrls) {
      if (sc.type !== 'changestate' && sc.type !== 'selfstate') continue;
      const to = S.lit(String(sc.params.get('value') === undefined ? '' : sc.params.get('value')));
      if (to === null || to === H || !(scene(to) || relay(to))) continue;
      for (const e of atomsOf(sc.trig)) {
        const mm = /^\s*playerid\s*\(\s*gethitvar\s*\([^()]*\)\s*\)\s*,\s*stateno\s*=\s*(\d+)\s*$/i.exec(e);
        if (!mm) continue;
        if (!follow.has(+mm[1])) follow.set(+mm[1], new Set());
        follow.get(+mm[1]).add(to);
        if (!herFollows.has(H)) herFollows.set(H, new Set());
        herFollows.get(H).add(+mm[1]);
      }
    }
  }
  const steps = [];
  const memberIds = rd.members.map((m) => m.id);
  // (His walk for her: a member out one at a time is the mode's only where
  // the core walk has no step of his at all - Colette, GoblinParty,
  // WrestlerX; Sanae's Suwako and Kanako stay her own moves.)
  let walk = null;
  try { walk = ctx.walk(); } catch (e) { walk = null; }
  const coreAny = !walk || !Array.isArray(walk.steps) || walk.steps.some((st) => !memberIds.includes(st.clear));
  for (const m of rd.members) {
    const group = ascii(m.who);
    const entry = m.starts[0];
    const route = m.route.kind === 'press' ? { cmd: m.route.cmd, after: m.route.after } : m.route.kind === 'present' ? { present: true } : { state: m.route.state, after: m.route.after };
    const setup = m.gates.filter((g) => !g.own).map((g) => ({ kind: g.kind, index: g.index, value: g.value,
      why: ascii('holds his ' + g.name + ' at ' + g.value + ': his ' + group + ' counts itself into it (ParentVarAdd) and comes only while it is under ' + g.under) }));
    const allScenes = new Set();
    const memberSteps = [], blocks = [], claimed = new Set();
    // (Every family's machine, and her states in each state of it: the offset
    // positions' go is read over all of them once they are known.)
    const machine = new Set(), herOfAll = new Map(), offsetGo = [];
    let pos = 0;
    for (const gr of m.grabs) {
      for (const fam of gr.families) {
        const pins0 = [...m.pins, ...(fam.pin ? [fam.pin] : [])];
        const frozen = {};
        for (const p of pins0) frozen[p.kind + '(' + p.index + ')'] = p.value;
        const W = L.makeWalker(an, Object.assign({}, G.walkerOpts, { victimHas, relevantVars: null, sharedFlows: null, frozen, offCtrls: new Set(), memo: new WeakMap(), trigCache: new WeakMap() }));
        W.setPresent(null);
        const f = W.flow([{ no: fam.p1, A: {}, prev: gr.state }], L.NO_INPUT);
        const M = new Set(f.at.keys());
        // Her scenes per state of its.
        const herIn = new Map();
        for (const [C, from] of f.issued) {
          if (!scene(C)) continue;
          for (const s of from) { if (s === C) continue; if (!herIn.has(s)) herIn.set(s, new Set()); herIn.get(s).add(C); }
        }
        for (const [S, Hs] of follow) if (M.has(S)) for (const H of Hs) { if (!herIn.has(S)) herIn.set(S, new Set()); herIn.get(S).add(H); }
        // (Her states with art only: a relay is never shown by itself.)
        const her = (s) => sortN([...(herIn.get(s) || [])].filter(scene));
        // (Held in a state, her scenes there are those it gives her while it
        // stays: a TargetState on the very trigger of one of its exits - its
        // meter's next rung, its loop's end - is the next state's.)
        const outOf = (s) => {
          const st = an.states.get(s);
          if (!st) return new Set();
          const key = (sc) => atomsOf(sc.trig).map((e) => e.toLowerCase().replace(/\s+/g, '')).sort().join('|');
          const exitKeys = new Set(st.sctrls.filter((sc) => (sc.type === 'changestate' || sc.type === 'selfstate') && !W.values(sc.params.get('value'), {}, s).includes(s)).map(key));
          return new Set(st.sctrls.filter((sc) => sc.type === 'targetstate' && exitKeys.has(key(sc))).flatMap((sc) => W.values(sc.params.get('value'), {}, s)));
        };
        const held = (s) => { const out = outOf(s); const h = her(s); const k = h.filter((C) => !out.has(C)); return { until: k.length ? k : h, also: k.length ? h.filter((C) => out.has(C)) : [] }; };
        for (const s of herIn.keys()) allScenes.add(s);
        allScenes.add(fam.p1);
        const herOf = (s, list) => { if (!herOfAll.has(s)) herOfAll.set(s, new Set()); for (const C of list) herOfAll.get(s).add(C); machine.add(s); };
        for (const [s, Hs] of herIn) if (M.has(s)) herOf(s, Hs);
        herOf(fam.p1, fam.p2);
        // Exits, by kind.
        const exitsOf = (no) => exits(W, an, no, frozen, L);
        const isScene = (s) => M.has(s) && herIn.has(s);
        const animKeyed = (s) => keyedAnims(an, s).size >= 2;
        // (A loop counts where its draw can come back: ZHE's 7481 -> 7482 ->
        // 7481; the Zombie's 16667 picks 162998 or 164000 after a while and
        // never comes back - its intro pick.)
        const loopsBack = (s) => {
          const seen = new Set(), q = [s];
          while (q.length && seen.size < 16) {
            const a = q.shift();
            for (const e of exitsOf(a)) if (e.kind === 'loop') for (const t of e.to) { if (t === s && a !== s) return true; if (!seen.has(t) && isScene(t)) { seen.add(t); q.push(t); } }
          }
          return false;
        };
        const isBase = (s) => exitsOf(s).some((e) => e.kind === 'meter' && e.to.some(isScene)) || loopsBack(s) || animKeyed(s);
        // The grab: until her first scene.
        const first = sortN([...fam.p2.filter(scene), ...(fam.p2.some(scene) ? [] : her(fam.p1))]);
        const meter0 = { name: null };
        const posts = [];
        // Heads: what p1 leads to.
        let heads;
        if (isBase(fam.p1)) heads = [fam.p1];
        else heads = sortN(exitsOf(fam.p1).filter((e) => e.kind !== 'release').flatMap((e) => e.to).filter(isScene));
        const seenBase = new Set();
        for (const h of heads) {
          let intro = null, base = h;
          if (!isBase(h)) {
            const on = sortN(exitsOf(h).flatMap((e) => e.to).filter((t) => t !== h && isScene(t)));
            if (on.length === 1) { intro = h; base = on[0]; }
          }
          if (seenBase.has(base)) continue;
          seenBase.add(base);
          posts.push({ intro, base });
        }
        const mobOf = (extra) => Object.assign({ id: m.id, who: group, ids: sortN([...memberIds, ...(rd.ambient || [])]), route, starts: m.starts.slice(), settle: m.settle.slice(), gap: m.gap,
          scenes: [], grab: gr.state }, rd.cams ? { cams: rd.cams.slice() } : {}, rd.away ? { away: true } : {}, extra);
        const holdOf = (state, anim) => {
          const out = { state, anim: settleAnim(an, state, anim === undefined ? animOf(W, an, state, frozen) : anim, frozen, L), skip: [] };
          const r = restartOf(exitsOf(state));
          if (r !== null) out.restart = r;
          return out;
        };
        const famSteps = [];
        // (A grab state it leaves on its first ticks - ZHE's 7477 puts her in
        // 1409 and goes on at `time = 1` - shows her the next state's scenes
        // too: the core sees her state from the tick after the grab. The grab
        // step holds its grab state, or the one state it passes on to.)
        const early = earlyOn(W, an, fam.p1, frozen, L);
        const grabUntil = early ? sortN([...first, ...early.flatMap(her)]) : first;
        const grabHold = early ? (early.length === 1 && her(early[0]).length ? holdOf(early[0]) : null) : holdOf(fam.p1);
        famSteps.push({ label: route.cmd ? ' (' + words(route.cmd) + ')' : '', grabStep: true, until: grabUntil, also: [], nav: { pos: group + ' grab', speed: null, ver: 0, climax: false, stage: 0 },
          artKey: 'mob ' + m.id + ' grab ' + gr.state + ' ' + fam.p1, mob: mobOf(grabHold && (grabHold.anim != null || grabHold.restart) ? { hold: grabHold } : {}), meterPin: 0 });
        // ANIMATION BY OFFSET: a family whose poses are offsets of one
        // animation is read by its table alone (its machine's states are
        // its relays and its pose states, which the other readings would
        // take for an intro and a climax by time).
        const offset = offsetPlay(L, W, an, M, follow, scene, exitsOf, (no) => earlyOn(W, an, no, frozen, L));
        // (His .air, for THE AUTHOR'S BIND's contact point; his sprite file's
        // version, for ITS OWN COLORS.)
        let airX = null, colors = null;
        if (offset.some((O) => O.bind)) {
          try { const df = L.modlib.defFiles(G.dir, G.def); airX = df.anim ? airFirstX(df.anim) : null; colors = ownColors(an, m, df.sprite); } catch (e) { airX = null; colors = null; }
        }
        for (const O of offset) {
          for (const p of O.pos) {
            pos++;
            const at = 'pos ' + pos + (p.name ? ' (' + p.name + ')' : '');
            const navPos = group + ' ' + pos;
            // (The go is read once every family is known: offsetGo below.)
            const go = O.relay !== null ? { state: O.relay, home: [[O.relay, O.relay], [O.state, O.state]] } : { state: O.state, home: [[O.state, O.state]] };
            const r = restartOf(exitsOf(O.state));
            // (v: the offset; or, an aftermath of its own animation, { anim,
            // on: the row's key and its flag }, the offset its climax's.)
            const stepOf = (v, label, nav, climax, aft) => {
              const anim = aft ? aft.anim : O.K + v;
              const pins = [Object.assign(L.varRef(O.V), { value: v, why: ascii('its pose: ' + O.V + ' = ' + v + ' makes ' + O.state + '\'s animation ' + (O.K + v)) })];
              for (const c of (aft ? aft.on : [])) pins.push(Object.assign(L.varRef(c.name), { value: c.value, why: ascii('its aftermath: ' + O.state + ' takes ' + anim + ' on ' + c.name + ' = ' + c.value) }));
              for (const c of O.cond) if (!pins.some((x) => x.kind + '(' + x.index + ')' === c.name)) pins.push(Object.assign(L.varRef(c.name), { value: c.value, why: ascii('its pose: ' + O.state + ' takes ' + O.K + ' + ' + O.V + ' on ' + c.name + ' = ' + c.value) }));
              for (const c of p.off) {
                const value = climax ? c.value : (c.value === 0 ? 1 : 0);
                if (!pins.some((x) => x.kind + '(' + x.index + ')' === c.name)) pins.push(Object.assign(L.varRef(c.name), { value, why: ascii('its ' + (climax ? 'climax: ' : 'speeds: ') + c.name + ' = ' + value + (climax ? ' gives' : ' keeps off') + ' the climax row') }));
              }
              const cp = O.bind ? contactAt(an, O.state, O.her, anim, airX) : null;
              const cy = O.bind ? contactAtY(an, O.state, anim) : null;
              const st = { label, until: [O.her], also: [], nav, artKey: 'mob ' + m.id + ' ' + O.state + ' ' + anim, meterPin: 0, extraPins: pins,
                mob: mobOf({ go: JSON.parse(JSON.stringify(go)), hold: Object.assign({ state: O.state, anim, skip: [], enter: true }, r !== null ? { restart: r } : {}, O.bind ? { bind: true } : {},
                  cp !== null ? { at: cp } : {}, cy ? { aty: cy } : {}, O.bind && colors ? { colors: colors.slice() } : {}) }) };
              offsetGo.push(st);
              famSteps.push(st);
            };
            p.speeds.forEach((v, i) => stepOf(v, p.speeds.length > 1 ? at + ', speed ' + (i + 1) : at, { pos: navPos, speed: p.speeds.length > 1 ? i + 1 : 0, ver: 0, climax: false, stage: 0 }, false));
            // Its climax, and its aftermath as the climax's next picture
            // (Space shows the climax, Delete / End step to what comes after).
            const pics = p.climax.length + p.after.length;
            p.climax.forEach((v, i) => stepOf(v, at + ', climax' + (p.climax.length > 1 ? ' ' + (i + 1) : ''), { pos: navPos, speed: pics > 1 ? i + 1 : null, ver: 0, climax: true, stage: 0 }, true));
            p.after.forEach((a, i) => stepOf(a.v !== undefined ? a.v : p.climax[p.climax.length - 1], at + ', after the climax' + (p.after.length > 1 ? ' ' + (i + 1) : ''),
              { pos: navPos, speed: p.climax.length + i + 1, ver: 0, climax: true, stage: 0 }, true, a.v !== undefined ? null : a));
          }
        }
        for (const P of (offset.length ? [] : posts)) {
          pos++;
          const at = 'pos ' + pos;
          const navPos = group + ' ' + pos;
          // ANIMATION-KEYED: readCompanionPlay.
          const play = animKeyed(P.base) ? companionPlay(L, W, an, G, M, [...herIn.keys()], P.base) : null;
          const x = play && play.pos.get(1);
          const v = x && x.variants.find((y) => y.speeds.length > 1 || (y.climax && (y.climax.pictures || []).length));
          // (An intro plays once and holds its last frame - a FREEZE, with
          // the layers it makes as it starts: the Zombie's 162998 makes its
          // head and mane, explod 3343, at `time = 0` with removetime -2, gone
          // at its animation's end; a restart of the animation alone would
          // replay the insertion without them.)
          if (P.intro) {
            const { until, also } = held(P.intro);
            if (until.length) famSteps.push({ label: at + ', intro', until, also, nav: { pos: navPos, speed: 0, ver: 0, climax: false, stage: 0 },
              artKey: 'mob ' + m.id + ' ' + P.intro, mob: mobOf({ go: { state: P.intro, home: [[P.intro, P.intro]] }, hold: Object.assign(holdOf(P.intro), { freeze: true, explods: layersAt0(an, P.intro, S) }) }), meterPin: 0 });
          }
          if (v) {
            const meter = play.meter;
            meter0.name = meter.kind + '(' + meter.index + ')';
            meter0.ref = meter;
            const ret = play.ret ? [Object.assign({}, play.ret, { why: ascii('its return: ' + play.ret.kind + '(' + play.ret.index + ') = ' + play.ret.value + ' keeps it in its position at a climax\'s end') })] : [];
            const home = [[P.base, P.base]];
            // (Each held at the animation it settles on; one that settles on
            // another's animation is that one - Project Rose's Skeleton's
            // 7231-7235 are its 27231-27235 - and one the state never shows
            // under its pins is another kind's: the Zombie's 27231 in TOBF+.)
            const own = new Set([...v.speeds, ...(v.climax ? v.climax.pictures || [] : [])].map((q) => q.anim)), used = new Set();
            const settled = (q) => {
              if (neverShows(W, an, P.base, q.anim, frozen, L)) return null;
              const a = settleAnim(an, P.base, q.anim, frozen, L);
              if ((a !== q.anim && own.has(a)) || used.has(a)) return null;
              used.add(a);
              return a;
            };
            let n = 0;
            for (const sp of v.speeds) {
              const until = sortN(sp.her.filter(scene));
              const anim = until.length ? settled(sp) : null;
              if (anim === null) continue;
              n++;
              famSteps.push({ label: at + ', speed ' + n, until, also: [], nav: { pos: navPos, speed: n, ver: 0, climax: false, stage: 0 }, artKey: 'mob ' + m.id + ' ' + P.base + ' ' + anim,
                mob: mobOf({ go: { state: P.base, home }, hold: { state: P.base, anim, skip: (sp.skip || []).map((q) => q.slice()) } }), meterPin: 0, extraPins: ret });
            }
            const pics = v.climax ? (v.climax.pictures || []).map((q) => Object.assign({}, q, { until: sortN(q.her.filter(scene)) })).filter((q) => q.until.length).map((q) => Object.assign(q, { anim: settled(q) })).filter((q) => q.anim !== null) : [];
            pics.forEach((q, i) => {
              famSteps.push({ label: at + ', climax' + (pics.length > 1 ? ' ' + (i + 1) : ''), until: q.until, also: [], nav: { pos: navPos, speed: pics.length > 1 ? i + 1 : null, ver: 0, climax: true, stage: 0 },
                artKey: 'mob ' + m.id + ' ' + P.base + ' ' + q.anim, mob: mobOf({ go: { state: P.base, home }, hold: { state: P.base, anim: q.anim, skip: (q.skip || []).map((z) => z.slice()) } }), meterPin: v.climax.pin, extraPins: ret });
            });
            continue;
          }
          // STATE-KEYED.
          // (A state an earlier position of its already holds is that one's:
          // ZHE's boss 17484 draws its way back to 17481.)
          const comp = [P.base];
          for (let i = 0; i < comp.length && comp.length < 12; i++) {
            for (const e of exitsOf(comp[i])) if (e.kind === 'loop') for (const t of e.to) if (isScene(t) && !comp.includes(t) && !claimed.has(t)) comp.push(t);
          }
          const speeds = [P.base, ...sortN(comp.slice(1))];
          for (const s of speeds) claimed.add(s);
          // Meter rungs from the speeds (and on).
          const rungs = [];
          const meterVar = new Set();
          const q = speeds.map((s) => ({ s, depth: 0 }));
          const seen = new Set(speeds);
          while (q.length) {
            const { s, depth } = q.shift();
            for (const e of exitsOf(s)) {
              if (e.kind !== 'meter') continue;
              const tos = e.to.filter((t) => isScene(t) && !seen.has(t));
              if (!tos.length) continue;
              meterVar.add(e.var);
              rungs.push({ t: e.t, gt: e.gt, to: sortN(tos), var: e.var });
              for (const t of tos) { seen.add(t); if (depth < 4) q.push({ s: t, depth: depth + 1 }); }
            }
          }
          const mv = meterVar.size === 1 ? [...meterVar][0] : null;
          const ts = sortN(rungs.filter((r) => r.var === mv).map((r) => r.t));
          const top = ts.length ? ts[ts.length - 1] : null;
          if (mv) { meter0.name = mv; meter0.ref = L.varRef(mv); }
          const holdSet = (s) => ({ go: { state: s, home: [[s, s]] }, hold: holdOf(s) });
          const phases = rungs.filter((r) => r.var === mv && r.t !== top).sort((a, b) => a.t - b.t);
          const climaxes = rungs.filter((r) => r.var === mv && r.t === top);
          const ladder = speeds.length === 1 && phases.length > 0;
          let n = 0;
          if (speeds.length > 1 || !phases.length) {
            for (const s of speeds) {
              const { until, also } = held(s);
              if (!until.length) continue;
              n++;
              famSteps.push({ label: speeds.length > 1 ? at + ', speed ' + n : at, until, also, nav: { pos: navPos, speed: speeds.length > 1 ? n : 0, ver: 0, climax: false, stage: 0 },
                artKey: 'mob ' + m.id + ' ' + s, mob: mobOf(holdSet(s)), meterPin: 0 });
            }
          } else if (ladder) {
            const { until, also } = held(P.base);
            if (until.length) { n++; famSteps.push({ label: at + ', phase ' + n, until, also, nav: { pos: navPos, speed: n, ver: 0, climax: false, stage: 0 }, artKey: 'mob ' + m.id + ' ' + P.base, mob: mobOf(holdSet(P.base)), meterPin: 0 }); }
          }
          for (const r of phases) {
            const next = ts.find((t) => t > r.t);
            const pin = next !== undefined ? Math.floor((r.t + next) / 2) : r.t + 1;
            for (const s of r.to) {
              const { until, also } = held(s);
              if (!until.length) continue;
              n++;
              famSteps.push({ label: at + ', phase ' + (ladder ? n : n - speeds.length), until, also, nav: { pos: navPos, speed: n, ver: 0, climax: false, stage: 0 },
                artKey: 'mob ' + m.id + ' ' + s, mob: mobOf(holdSet(s)), meterPin: pin });
            }
          }
          let cl = sortN(climaxes.flatMap((r) => r.to)).filter((s) => her(s).length);
          // (No meter: a state its speeds go on to by time alone, no random
          // in it, that holds her - ZHE's 7483 -> 7489 at `time >= 238` -
          // is its climax, held there by the restart.)
          const byTime = !cl.length;
          if (byTime) cl = sortN(speeds.flatMap((s) => exitsOf(s).filter((e) => e.kind === 'time').flatMap((e) => e.to)).filter((t) => isScene(t) && !seen.has(t) && her(t).length));
          cl.forEach((s, i) => {
            famSteps.push({ label: at + ', climax' + (cl.length > 1 ? ' ' + (i + 1) : ''), until: held(s).until, also: held(s).also, nav: { pos: navPos, speed: cl.length > 1 ? i + 1 : null, ver: 0, climax: true, stage: 0 },
              artKey: 'mob ' + m.id + ' ' + s, mob: mobOf(holdSet(s)), meterPin: byTime ? 0 : top + 1 });
          });
        }
        // The member's pins on each step: type, family, meter, return.
        for (const st of famSteps) {
          const pins = pins0.map((p) => Object.assign({}, p));
          if (meter0.ref) pins.push({ kind: meter0.ref.kind, index: meter0.ref.index, value: st.meterPin || 0, why: ascii('its meter: ' + (st.meterPin ? 'at ' + st.meterPin + ', where this step\'s state comes' : 'held at 0, so it never climaxes by itself')) });
          for (const p of st.extraPins || []) if (!pins.some((x) => x.kind === p.kind && x.index === p.index)) pins.push(Object.assign({}, p));
          st.mob.pins = pins;
          delete st.meterPin; delete st.extraPins;
        }
        if (gr.rootPin) for (const st of famSteps) st.rootPin = gr.rootPin;
        // (A position state it leaves in its first ticks cannot be held: no
        // step - the boss chain's 17477, a grab's landing. An offset pose is
        // held in its own state, whatever relay its go goes through.)
        blocks.push(famSteps.filter((st) => st.grabStep || !(st.mob.go && earlyOn(W, an, (st.mob.hold && st.mob.hold.enter ? st.mob.hold : st.mob.go).state, frozen, L))));
      }
    }
    // THE HEAD FIRST, for the offset poses: the go takes it to the relay from
    // the states of its where her state follows the relay; from those where
    // hers cannot, first to the state of its she follows from there (her
    // struggle 4003 and her HAS 353 follow its 4000, not its LAS relay 324).
    // Over every family's machine: a move in place goes from one to another.
    // (Never from its grab state: the grab lands first.)
    const grabStates = m.grabs.map((g) => g.state);
    for (const st of offsetGo) {
      const go = st.mob.go;
      const home = go.home.map((r) => r[0]);
      const can = (s, to) => [...(herOfAll.get(s) || [])].some((h) => herFollows.has(h) && herFollows.get(h).has(to));
      const rest = sortN(machine).filter((s) => !home.includes(s) && !grabStates.includes(s));
      const inn = rest.filter((s) => can(s, go.state));
      // (None: the go never acts - its author's own flow brings the pose.)
      go.in = ranges(inn.length ? inn : home);
      let via = null;
      for (const h0 of inn) {
        const vin = rest.filter((s) => !inn.includes(s) && can(s, h0));
        if (vin.length && (!via || vin.length > via.in.length)) via = { state: h0, in: vin };
      }
      if (via) go.via = { state: via.state, in: ranges(via.in) };
    }
    // (Several families of one member: "the grab 1", "the grab 2", each its
    // own one-off position; a family that shows her nothing is none.)
    const live = blocks.filter((b) => b.some((st) => st.until.length));
    live.forEach((famSteps, i) => {
      const tag = live.length > 1 ? ' ' + (i + 1) : '';
      const g = famSteps[0];
      if (g && g.grabStep) { g.label = 'the grab' + tag + g.label; g.nav.pos = group + ' grab' + tag; delete g.grabStep; }
      for (const st of famSteps) memberSteps.push(st);
    });
    // (Positions numbered 1..n in the order their steps come; one whose
    // steps show her nothing takes no number.)
    const renum = new Map();
    for (const st of memberSteps) {
      const mm = /^pos (\d+)\b/.exec(st.label);
      if (!mm || !st.until.length || renum.has(mm[1])) continue;
      renum.set(mm[1], String(renum.size + 1));
    }
    for (const st of memberSteps) {
      const mm = /^pos (\d+)\b/.exec(st.label);
      if (!mm || !renum.has(mm[1])) continue;
      st.label = 'pos ' + renum.get(mm[1]) + st.label.slice(mm[0].length);
      st.nav.pos = group + ' ' + renum.get(mm[1]);
    }
    if (m.one && coreAny) continue;
    const scenesR = ranges([...allScenes]);
    for (const st of memberSteps) {
      st.mob.scenes = scenesR.map((r) => r.slice());
      const until = sortN(st.until);
      if (!until.length) continue;
      const rp = st.rootPin;
      delete st.rootPin;
      const su = [...setup.map((x) => Object.assign({}, x)), ...(rp ? [{ kind: rp.kind, index: rp.index, value: rp.value,
        why: ascii('its type: his ' + rp.kind + '(' + rp.index + ') = ' + rp.value + ' sends his ' + group + ' into its grab') }] : [])];
      steps.push(Object.assign({ entry, group, kind: 'mob' }, st, { label: ascii(m.baseArt ? baseMarked(st.label) : st.label), until, also: sortN(st.also || []).filter((C) => !until.includes(C)), path: [{ until: until.slice() }] },
        su.length ? { setup: su } : {}));
    }
  }
  // HIS RELAYED MEMBERS' steps (mob-relay.js), after his literal members':
  // the pair's setup holds his flags at rest and his timers shut, each step's
  // own its position lock.
  let relaySetup = null;
  if (rd.relay && RELAY) {
    let rs = [];
    try { rs = RELAY.relayPair(G, R, ctx, rd.relay); } catch (e) { rs = []; warnRelay(e); }
    for (const st of rs) {
      const until = sortN(st.until);
      if (!until.length) continue;
      steps.push(Object.assign({ kind: 'mob' }, st, { until, also: sortN(st.also || []).filter((C) => !until.includes(C)), path: [{ until: until.slice() }] }));
    }
    if (rs.length && rd.relay.setup.length) relaySetup = rd.relay.setup.map((x) => Object.assign({}, x));
  }
  if (!steps.length) return null;
  const out = ctx.pairSteps(steps);
  if (!out.length) return null;
  // Her scenes the core walk left unreachable that these steps reach.
  const counts = {};
  if (walk && Array.isArray(walk.unreachable)) {
    const un = new Set(walk.unreachable.map((u) => u.state));
    const got = new Set(out.flatMap((s) => [...s.states, ...(s.alsoStates || [])]));
    for (const C of got) {
      if (!un.has(C)) continue;
      const v = ctx.verdict(C);
      counts[v] = (counts[v] || 0) + 1;
      counts.unreachable = (counts.unreachable || 0) - 1;
    }
  }
  const ids = new Set([...memberIds, ...(rd.relay ? rd.relay.ids : [])]);
  return Object.assign({ steps: out, claims: (st) => !st.companion && ids.has(st.clear), counts }, relaySetup ? { setup: relaySetup } : {});
}

// ---- BORROWED ART -------------------------------------------------------------
// (The rule is in the header's BORROWED ART paragraph.)
// A step label with the marker: first, after the core's own tags
// ("(violent)", "(experimental)" stay first - the overlay cuts a long label
// at its end).
const BASE_MARK = '[base art]';
function baseMarked(label) {
  const lead = /^(?:\([^()]*\)\s*)*/.exec(String(label))[0];
  return lead + BASE_MARK + ' ' + String(label).slice(lead.length);
}
// A file's signature: its size and time, or null.
function sigOf(abs) {
  try { const st = fs.statSync(abs); return st.size + ':' + st.mtimeMs; } catch (e) { return null; }
}
// HIS PEERS: the other characters beside him (his folder's siblings, the
// build's characters folder): per .def, the names of the state files its
// [Files] lists and its sprite file. Kept per .def by its signature.
const peerMemo = new Map();
function peersOf(dir, L) {
  const parent = path.dirname(dir), self = path.resolve(dir).toLowerCase();
  let folders = [];
  try { folders = fs.readdirSync(parent, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => path.join(parent, d.name)); } catch (e) { return []; }
  const out = [];
  for (const f of folders) {
    if (path.resolve(f).toLowerCase() === self) continue;
    let defs = [];
    try { defs = fs.readdirSync(f).filter((n) => /\.def$/i.test(n)); } catch (e) { continue; }
    for (const def of defs) {
      const abs = path.join(f, def), sig = sigOf(abs);
      if (!sig) continue;
      let p = peerMemo.get(abs);
      if (!p || p.sig !== sig) {
        const df = L.modlib.defFiles(f, def);
        p = { sig, dir: f, def, files: new Set(df.states.map((s) => path.basename(s.rel).toLowerCase())), sprite: df.sprite };
        peerMemo.set(abs, p);
      }
      if (p.sprite) out.push(p);
    }
  }
  return out;
}
// A SPRITE'S DIGEST in one sprite file: { kind, w, h, px } - px a hash of
// its pixels - or null where the file lacks it or it does not decode. Kept
// per file by its signature.
const digestMemo = new Map();
function digestOf(file, key, sffs) {
  const k = file + '|' + sigOf(file);
  let memo = digestMemo.get(k);
  if (!memo) { memo = new Map(); digestMemo.set(k, memo); if (digestMemo.size > 64) digestMemo.delete(digestMemo.keys().next().value); }
  if (memo.has(key)) return memo.get(key);
  const SD = require('../tools/sff-decode.js');
  if (!sffs.has(file)) { let s = null; try { s = SD.readSff(file); } catch (e) { s = null; } sffs.set(file, s); }
  const sff = sffs.get(file);
  let d = null;
  if (sff && sff.byKey.has(key)) {
    const [g, i] = key.split(',').map(Number);
    let p = null;
    try { p = SD.spritePixels(sff, g, i); } catch (e) { p = null; }
    const hash = (a) => crypto.createHash('sha1').update(Buffer.from(a.buffer || a, a.byteOffset || 0, a.byteLength || a.length)).digest('hex');
    if (p && p.px && p.w && p.h) d = { kind: p.kind, w: p.w, h: p.h, px: hash(p.px) };
  }
  memo.set(key, d);
  return d;
}
// The same art: the same pixels, the palette aside (a recolor is the same
// art).
const sameArt = (a, b) => !!(a && b && a.kind === b.kind && a.w === b.w && a.h === b.h && a.px === b.px);
// Per member id, the peer (its folder's name) whose sprites its idle and
// its grab wear, in a giver that drew another member type anew: Map, or
// null.
function borrowedArt(G, arts, L) {
  const mine = L.modlib.defFiles(G.dir, G.def).sprite;
  if (!mine || !arts.size) return null;
  const all = peersOf(G.dir, L);
  const sffs = new Map();
  const dg = (file, k) => digestOf(file, k, sffs);
  const kept = new Map();
  let drawnAnew = false;
  for (const [id, art] of arts) {
    if (!art.files.length || !art.idle.length) continue;
    // (A peer ships every state file its idle and its grab come from and a
    // sprite file of his sprite file's name - TowerOfBloodyfight.sff - but
    // another one: common names, helpers.cns or specials.cns, alone make no
    // peer. Each sprite file once.)
    const seen = new Set([path.resolve(mine).toLowerCase()]);
    const peers = all.filter((p) => {
      const at = path.resolve(p.sprite).toLowerCase();
      if (seen.has(at) || path.basename(at) !== path.basename(mine).toLowerCase() || !art.files.every((f) => p.files.has(path.basename(f).toLowerCase()))) return false;
      seen.add(at);
      return true;
    });
    if (!peers.length) continue;
    const idle = art.idle.filter((k) => dg(mine, k));
    if (!idle.length) continue;
    const from = peers.find((p) => idle.every((k) => sameArt(dg(mine, k), dg(p.sprite, k))));
    if (from) kept.set(id, path.basename(from.dir));
    else if (!idle.some((k) => peers.some((p) => sameArt(dg(mine, k), dg(p.sprite, k))))) drawnAnew = true;
  }
  return drawnAnew ? kept : new Map();
}

// ---- readers ------------------------------------------------------------------
// A state's exits under the pins: [{ kind, to, t?, gt?, var?, n? }].
function exits(W, an, no, frozen, L) {
  const st = an.states.get(no);
  if (!st) return [];
  const { X } = L;
  const num = Object.assign({ isHelper: true }, frozen);
  const out = [];
  for (const sc of st.sctrls) {
    if (sc.type !== 'changestate' && sc.type !== 'selfstate') continue;
    let t = null;
    try { t = X.evalTriggerSet(sc.trig, num); } catch (e) { t = null; }
    if (t === false) continue;
    const raw = String(sc.params.get('value') === undefined ? '' : sc.params.get('value'));
    const to = W.values(raw, {}, no).filter((v) => v !== no);
    if (!to.length) continue;
    const atoms = atomsOf(sc.trig);
    const rnd = atoms.some((e) => X.usesRandom(e));
    const animEnd = atoms.some((e) => /\banimtime\s*=\s*0\b/i.test(e));
    let meter = null;
    if (!rnd) for (const e of atoms) for (const m of (' ' + e).matchAll(/(^|[^,\w\s])\s*(f?var\(\d+\))\s*(>=|>)\s*(\d+)/gi)) { if (!meter) meter = { var: m[2].toLowerCase(), t: +m[4] + (m[3] === '>' ? 1 : 0), gt: m[3] === '>' }; }
    let time = null;
    for (const e of atoms) for (const m of e.matchAll(/\btime\s*(>=|>)\s*(\d+)/gi)) { if (redirectedAt(e, m.index)) continue; time = +m[2] + (m[1] === '>' ? 1 : 0); }
    // (A random draw at a loop's end or after a while - ZHE's 7481 -> 7482 or
    // 7483 at `time >= 364` - joins speeds; one at no such moment picks.)
    const kind = (animEnd || time !== null) && (rnd || X.usesRandom(raw)) ? 'loop' : meter ? 'meter' : X.usesRandom(raw) ? 'pick' : time !== null ? 'time' : 'other';
    out.push(Object.assign({ kind, to }, meter || {}, time !== null ? { n: time } : {}));
  }
  return out;
}
// The states a state passes on to in its first ticks (its time 0 to EARLY):
// every ChangeState/SelfState on a time atom that can hold then under the
// pins (ZHE's 7477 -> 7480 or 7481 at `time = 1`, by his variable 48); null
// when it has none.
function earlyOn(W, an, no, frozen, L) {
  const st = an.states.get(no);
  if (!st) return null;
  const { X } = L;
  const out = new Set();
  // (Only an exact early time - `time = 1`, `!time` - in the same trigger:
  // a release on `time > 1` and a target lost is no way on at once.)
  const exact = (e) => { const m = /^\s*(?:time\s*=\s*(\d+)|!\s*time)\s*$/i.exec(e); return !!m && (m[1] === undefined || +m[1] <= EARLY); };
  for (const sc of st.sctrls) {
    if (sc.type !== 'changestate' && sc.type !== 'selfstate') continue;
    const groups = sc.trig.groups.length ? sc.trig.groups : [[]];
    let hit = false;
    for (const g of groups) {
      if (![...sc.trig.all, ...g].map(String).some(exact)) continue;
      for (let t = 0; t <= EARLY && !hit; t++) {
        let v = null;
        try { v = X.evalTriggerSet({ all: sc.trig.all, groups: [g] }, Object.assign({ isHelper: true, time: t }, frozen)); } catch (e) { v = null; }
        if (v !== false) hit = true;
      }
    }
    if (!hit) continue;
    for (const v of W.values(sc.params.get('value'), {}, no)) if (v !== no && an.states.has(v)) out.add(v);
  }
  return out.size ? sortN(out) : null;
}
// The layers a state makes as it starts: the literal ids (at most 4) of its
// Explods on an exact first tick (`time = 0`, `!time`) that live as long as
// their animation or longer - the Zombie's 162998 makes its head and mane,
// 3343 (removetime -2), there. (One on its own clock, a positive removetime -
// Gnoll Raid2's random line 905150 - is no layer of the pose.)
function layersAt0(an, no, S) {
  const st = an.states.get(no);
  if (!st) return [];
  const exact0 = (e) => /^\s*(?:time\s*=\s*0|!\s*time)\s*$/i.test(String(e));
  const out = new Set();
  for (const sc of st.sctrls) {
    if (sc.type !== 'explod') continue;
    if (!(sc.trig.groups.length ? sc.trig.groups.some((g) => [...sc.trig.all, ...g].some(exact0)) : sc.trig.all.some(exact0))) continue;
    const rt = S.lit(String(sc.params.get('removetime') === undefined ? '' : sc.params.get('removetime')));
    if (rt !== null && rt > 0) continue;
    const v = S.lit(String(sc.params.get('id') === undefined ? '' : sc.params.get('id')));
    if (Number.isInteger(v) && v > 0) out.add(v);
  }
  return sortN(out).slice(0, 4);
}
// The hold's restart: a `time >= N` exit (N >= 60) is pre-empted at N - 1.
function restartOf(list) {
  const ns = list.filter((e) => Number.isFinite(e.n) && e.n >= RESTART_MIN).map((e) => e.n);
  return ns.length ? Math.min(...ns) - 1 : null;
}
// The animation a state shows on its first tick under the pins (one only).
function animOf(W, an, no, frozen) {
  const A = {};
  for (const k of Object.keys(frozen || {})) A[k] = [frozen[k]];
  try { const r = W.animTicks(no, A); return r.anims.length === 1 ? r.anims[0] : null; } catch (e) { return null; }
}
// THE ANIMATION A HOLD SETTLES ON: the state's own ChangeAnim/ChangeAnim2
// lines that fire on every tick of an animation under the pins - whose only
// conditions are `anim = <a>` and pinned variables, a literal value - are
// followed, in the order the engine runs them, until none fires: Project
// Rose's 22303 turns `anim = 7231` into 27231 on `var(15) = 2` (its
// Skeleton) each tick, so a hold of 7231 is one of 27231 (else the hook and
// the state swap it back and forth every tick). A loop of them, or one
// past 8 steps, leaves the animation as it was.
function settleAnim(an, no, anim, frozen, L) {
  const st = an.states.get(no);
  if (!st || !Number.isInteger(anim)) return anim;
  const { X, S } = L;
  let a = anim;
  const seen = new Set([a]);
  for (let n = 0; n < 8; n++) {
    let to = a;
    for (const sc of st.sctrls) {
      if (sc.type !== 'changeanim' && sc.type !== 'changeanim2') continue;
      const v = S.lit(String(sc.params.get('value') === undefined ? '' : sc.params.get('value')));
      if (!Number.isInteger(v) || v === to) continue;
      let t = null;
      try { t = X.evalTriggerSet(sc.trig, Object.assign({ isHelper: true }, frozen, { anim: to })); } catch (e) { t = null; }
      if (t === true) to = v;
    }
    if (to === a) return a;
    if (seen.has(to)) return anim;
    seen.add(to);
    a = to;
  }
  return anim;
}
// AN ANIMATION THE STATE NEVER SHOWS under the pins: not its header's, and
// every ChangeAnim/ChangeAnim2 line of its own that can give it is false
// under them - TOBF+'s 22303 keys her on 27231-27235 too, the Skeleton's
// art, which only its `var(15) = 2` lines play: the Zombie (var(15) = 0) in
// that state never shows them. (A state with no header animation, or a line
// whose value the read cannot list, shows anything: kept.)
function neverShows(W, an, no, anim, frozen, L) {
  const st = an.states.get(no);
  if (!st || st.anim === null || st.anim === undefined || !Number.isInteger(anim)) return false;
  const { X } = L;
  const A = {};
  for (const k of Object.keys(frozen || {})) A[k] = [frozen[k]];
  const head = W.values(st.anim, A, no);
  if (!head.length || head.includes(anim)) return false;
  for (const sc of st.sctrls) {
    if (sc.type !== 'changeanim' && sc.type !== 'changeanim2') continue;
    let t = null;
    try { t = X.evalTriggerSet(sc.trig, Object.assign({ isHelper: true }, frozen)); } catch (e) { t = null; }
    if (t === false) continue;
    const vals = W.values(sc.params.get('value'), A, no);
    if (!vals.length || vals.includes(anim)) return false;
  }
  return true;
}
// Her states a state keys on its animation (TargetStates on `anim = N`).
function keyedAnims(an, no) {
  const out = new Set();
  const st = an.states.get(no);
  if (!st) return out;
  for (const sc of st.sctrls) {
    if (sc.type !== 'targetstate') continue;
    for (const e of atomsOf(sc.trig)) for (const p of e.split(/&&|\|\|/)) { const m = /^\s*anim\s*=\s*(\d+)\s*$/i.exec(p); if (m) out.add(+m[1]); }
  }
  return out;
}
// The animations of his her state keys hers on: its ChangeAnim/ChangeAnim2
// lines on `PlayerID(GetHitVar(...)),anim = N` (her grabber, read off the
// hit) or `enemy,anim = N` - GoblinParty's 335 on 551121020 ... 551121044.
function hisAnimsKeyed(an, H) {
  const out = new Set();
  const st = an.states.get(H);
  if (!st) return out;
  for (const sc of st.sctrls) {
    if (sc.type !== 'changeanim' && sc.type !== 'changeanim2') continue;
    for (const e of atomsOf(sc.trig)) for (const p of e.split('&&')) {
      const m = /^\s*(?:playerid\s*\(\s*gethitvar\s*\([^()]*\)\s*\)|enemy(?:\s*\(\s*\d+\s*\))?)\s*,\s*anim\s*=\s*(\d+)\s*$/i.exec(p);
      if (m) out.add(+m[1]);
    }
  }
  return out;
}
// ANIMATION BY OFFSET (the header's rule) over one family's machine M:
// [{ state, relay, her, K, V, key, cond: [{ name, value }], bind, pos: [{ k,
// name, speeds: [v], climax: [v], after: [{ v } | { anim, on: [{ name,
// value }] }], off: [{ name, value }] }] }] - an empty list where no state
// of it has the shape. `after`: its aftermath, a pass (THE LADDER'S END) or
// an animation of its own on the row's key and a flag (ITS AFTERMATH).
// `off`: the variables a climax row of the table asks for besides its key
// (held off it on the speeds).
function offsetPlay(L, W, an, M, follow, scene, exitsOf, earlyOf) {
  const { X, S } = L;
  const out = [];
  const eqOf = (p) => { const m = /^\s*(f?var)\s*\(\s*(\d+)\s*\)\s*=\s*(-?\d+)\s*$/i.exec(p); return m ? { name: m[1].toLowerCase() + '(' + m[2] + ')', value: +m[3] } : null; };
  const tick0 = (p) => /^\s*(?:time\s*=\s*0|!\s*time)\s*$/i.test(p);
  const shapeOf = (raw) => {
    const t = String(raw == null ? '' : raw);
    const m = /^\s*(\d+)\s*\+\s*(f?var)\s*\(\s*(\d+)\s*\)\s*$/i.exec(t) || /^\s*()(f?var)\s*\(\s*(\d+)\s*\)\s*\+\s*(\d+)\s*$/i.exec(t);
    if (!m) return null;
    return { K: +(m[1] || m[4]), V: m[2].toLowerCase() + '(' + m[3] + ')' };
  };
  // (One trigger group, read as its && parts.)
  const partsOf = (sc) => {
    const groups = sc.trig.groups.length ? sc.trig.groups : [[]];
    return groups.length === 1 ? [...sc.trig.all, ...groups[0]].map(String).flatMap((e) => e.split('&&')).map((p) => p.trim()).filter(Boolean) : null;
  };
  // What comes before a state, over every exit of its machine under the pins.
  const pred = new Map();
  for (const s of M) for (const e of exitsOf(s)) for (const t of e.to) { if (!M.has(t)) continue; if (!pred.has(t)) pred.set(t, new Set()); pred.get(t).add(s); }
  for (const P of sortN(M)) {
    const st = an.states.get(P);
    if (!st) continue;
    // Its animation: K + var(V), its header's or a first-tick ChangeAnim's
    // whose other conditions are values of its own variables.
    let shape = shapeOf(st.anim), cond = [];
    if (!shape) for (const sc of st.sctrls) {
      if (sc.type !== 'changeanim') continue;
      const sh = shapeOf(sc.params.get('value'));
      const ps = sh ? partsOf(sc) : null;
      if (!ps || !ps.some(tick0) || !ps.every((p) => tick0(p) || eqOf(p))) continue;
      shape = sh; cond = ps.filter((p) => !tick0(p)).map(eqOf);
      break;
    }
    if (!shape) continue;
    // Her state there (one with art), and the offsets it keys hers on.
    const hers = [...(follow.get(P) || [])].filter(scene);
    if (hers.length !== 1) continue;
    const offs = new Set([...hisAnimsKeyed(an, hers[0])].map((N) => N - shape.K).filter((v) => v >= 0 && v < OFFSET_MAX));
    if (offs.size < 2) continue;
    // Its table: in the state nearest before it that writes var(V) on one key
    // variable, every row on `var(W) = k` (k a number) with a value that is a
    // number or a draw.
    const dist = new Map([[P, 0]]), q = [P];
    while (q.length) { const s = q.shift(); for (const p of pred.get(s) || []) if (!dist.has(p)) { dist.set(p, dist.get(s) + 1); q.push(p); } }
    let table = null;
    for (const T of [...dist.keys()].filter((T) => dist.get(T) > 0).sort((a, b) => dist.get(a) - dist.get(b) || a - b)) {
      const rows = [];
      let ok = true;
      for (const sc of an.states.get(T).sctrls) {
        if (sc.type !== 'varset') continue;
        for (const [nm, raw] of W.writesOf(sc)) {
          if (nm.toLowerCase() !== shape.V) continue;
          const ps = partsOf(sc);
          const lit = S.lit(String(raw)), draw = X.usesRandom(String(raw)) && !X.varsOf(String(raw)).length;
          if (!ps || (lit === null && !draw)) { ok = false; continue; }
          rows.push({ eqs: ps.map(eqOf).filter(Boolean), other: ps.filter((p) => !eqOf(p) && !tick0(p)), raw: String(raw), lit, draw, label: String(sc.label || '') });
        }
      }
      if (!ok || rows.length < 2) continue;
      // (The key: the variable every row asks a value of, two values or more.)
      const key = [...new Set(rows[0].eqs.map((e) => e.name))].find((nm) => rows.every((r) => r.eqs.some((e) => e.name === nm)) && new Set(rows.map((r) => r.eqs.find((e) => e.name === nm).value)).size >= 2);
      if (!key) continue;
      table = { state: T, key, rows: rows.map((r) => Object.assign(r, { k: r.eqs.find((e) => e.name === key).value, extra: r.eqs.filter((e) => e.name !== key) })) };
      break;
    }
    if (!table) continue;
    // Its relay: the state before it that goes on to it on its first ticks.
    const relay = sortN(pred.get(P) || []).find((R) => R !== P && (earlyOf(R) || []).includes(P));
    // Its pass: the relay adds to var(V) on its first tick, once per pass.
    let step = null;
    if (relay !== undefined) for (const sc of an.states.get(relay).sctrls) {
      if (sc.type !== 'varadd') continue;
      const ps = partsOf(sc);
      if (!ps || !ps.length || !ps.every(tick0)) continue;
      for (const [nm, raw] of W.writesOf(sc)) if (nm.toLowerCase() === shape.V && S.lit(String(raw))) step = S.lit(String(raw));
    }
    // Its climax, on a pass: the offsets its way back to the relay excludes.
    const excluded = new Set();
    if (relay !== undefined) for (const sc of st.sctrls) {
      if ((sc.type !== 'changestate' && sc.type !== 'selfstate') || !W.values(sc.params.get('value'), {}, P).includes(relay)) continue;
      for (const e of atomsOf(sc.trig)) for (const p of e.split('&&')) { const m = /^\s*anim\s*!=\s*(\d+)\s*$/i.exec(p); if (m) excluded.add(+m[1] - shape.K); }
    }
    // ITS AFTERMATH, on a climax row: a first-tick ChangeAnim of P to a
    // literal animation her state keys on, asking the row's key and a flag
    // that P itself raises on the climax's animation (352's `var(51) = 1 &&
    // var(54) = 1` -> 454541211, 'DOGGY AFTER CUM'; var(54) = 1 'AFTER CUM
    // VARIABLE' on `anim = 551121049`, the CUMMING row's).
    const herKeys = hisAnimsKeyed(an, hers[0]);
    const aftermathOf = (k, climax) => {
      if (!climax.length) return [];
      const raised = (F) => st.sctrls.some((sc) => {
        if (sc.type !== 'varset') return false;
        const ps = partsOf(sc);
        if (!ps || !ps.some((p) => climax.some((c) => new RegExp('^anim\\s*=\\s*' + (shape.K + c) + '$', 'i').test(p)))) return false;
        return [...W.writesOf(sc)].some(([nm, raw]) => nm.toLowerCase() === F.name && S.lit(String(raw)) === F.value);
      });
      const out = [];
      for (const sc of st.sctrls) {
        if (sc.type !== 'changeanim') continue;
        const A = S.lit(String(sc.params.get('value') === undefined ? '' : sc.params.get('value')));
        const ps = partsOf(sc);
        if (A === null || !herKeys.has(A) || !ps || !ps.some(tick0) || !ps.every((p) => tick0(p) || eqOf(p))) continue;
        const eqs = ps.filter((p) => !tick0(p)).map(eqOf);
        const key = eqs.filter((e) => e.name === table.key && e.value === k), flags = eqs.filter((e) => e.name !== table.key);
        if (key.length !== 1 || flags.length !== 1 || flags[0].value === 0 || !raised(flags[0])) continue;
        if (!out.some((x) => x.anim === A)) out.push({ anim: A, on: [key[0], flags[0]] });
      }
      return out;
    };
    const pos = [];
    for (const k of sortN(table.rows.map((r) => r.k))) {
      const rows = table.rows.filter((r) => r.k === k);
      const base = rows.find((r) => r.lit !== null && !r.extra.length && !r.other.length);
      const draws = rows.filter((r) => r.draw);
      const further = rows.filter((r) => r.lit !== null && r.extra.length);
      let speeds = [], climax = [], after = [], named = null;
      if (step && base && !draws.length) {
        named = base;
        // THE LADDER'S END: the value its way back to the relay excludes is
        // the pass after which the pose leaves for good (325 goes to 4000 on
        // 'AFTER CUM' 551121024) - its AFTERMATH; the pass before it is its
        // CLIMAX (551121023, 'CUM': her state takes life on it); the passes
        // before that its speeds. A ladder with one pass before its end
        // keeps it as a speed and the end as its climax.
        const ladder = [];
        let end = null;
        for (let i = 1, v = base.lit + step; i <= OFFSET_MAX && offs.has(v); i++, v += step) {
          if (excluded.has(v)) { end = v; break; }
          ladder.push(v);
        }
        if (end !== null && ladder.length >= 2) { speeds = ladder.slice(0, -1); climax = [ladder[ladder.length - 1]]; after = [{ v: end }]; }
        else { speeds = ladder; climax = end !== null ? [end] : []; }
      } else if (draws.length) {
        named = draws[0];
        speeds = sortN(draws.flatMap((r) => X.evalRandom(r.raw, {}).filter(Number.isInteger))).filter((v) => offs.has(v));
        climax = sortN(further.map((r) => r.lit)).filter((v) => offs.has(v) && !speeds.includes(v));
        after = aftermathOf(k, climax);
      } else if (base && offs.has(base.lit)) { named = base; speeds = [base.lit]; }
      if (!speeds.length) continue;
      const off = [];
      for (const r of further) for (const e of r.extra) if (!off.some((x) => x.name === e.name)) off.push(e);
      pos.push({ k, label: named.label, speeds, climax, after, off });
    }
    if (!pos.length) continue;
    // Their names: the words of the rows' labels they do not all share
    // ('CHOOSES DOGGY TO PLAY' -> doggy); none where that leaves one empty
    // or two alike.
    const words = pos.map((p) => p.label.toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean));
    const common = new Set(words.length > 1 ? words[0].filter((w) => words.every((ws) => ws.includes(w))) : []);
    const names = words.map((ws) => ws.filter((w) => !common.has(w)).join(' ').toLowerCase().slice(0, 24));
    const named = pos.length > 1 && names.every((n) => /[a-z]/.test(n)) && new Set(names).size === names.length;
    out.push({ state: P, relay: relay === undefined ? null : relay, her: hers[0], K: shape.K, V: shape.V, key: table.key, cond, bind: authorBind(an, P),
      pos: pos.map((p, i) => ({ k: p.k, name: named ? names[i] : '', speeds: p.speeds, climax: p.climax, after: p.after, off: p.off })) });
  }
  return out;
}
// HER POSE'S CONTACT POINT (THE AUTHOR'S BIND's `at`): for his animation N
// of the pose state P, her follow state's animation keyed on it (her
// ChangeAnim2 on `PlayerID(GetHitVar(...)),anim = N`: 45122124), its first
// frame's x offset in his .air (a ChangeAnim2 plays the state owner's
// table; the engine keeps an action's first definition: 65), and the x his
// layers made on N stand at from her (their pos `helper(...),var(32) - 38`:
// -38, the variable his own arrow keys nudge left out; the x most of them
// share, where a cum effect beside them stands elsewhere: blowjob's -14
// twice and -10). -> the member's place from her along her facing that
// stands those layers at her pose's axis (65 - 38 = 27), or null where any
// part is unread or no x is shared by most.
function contactAt(an, P, her, N, airX) {
  const hs = an.states.get(her), st = an.states.get(P);
  if (!hs || !st || typeof airX !== 'function') return null;
  let herAnim = null;
  for (const sc of hs.sctrls) {
    if (sc.type !== 'changeanim' && sc.type !== 'changeanim2') continue;
    const keyed = atomsOf(sc.trig).some((e) => e.split('&&').some((p) => {
      const m = /^\s*(?:playerid\s*\(\s*gethitvar\s*\([^()]*\)\s*\)|enemy(?:\s*\(\s*\d+\s*\))?)\s*,\s*anim\s*=\s*(\d+)\s*$/i.exec(p);
      return !!m && +m[1] === N;
    }));
    const v = /^\s*(\d+)\s*$/.exec(String(sc.params.get('value') === undefined ? '' : sc.params.get('value')));
    if (keyed && v) { herAnim = +v[1]; break; }
  }
  const ox = herAnim === null ? null : airX(herAnim);
  if (ox === null || ox === undefined) return null;
  // (A layer's x: a variable, redirected or not, plus or minus a number.)
  const xs = new Map();
  for (const sc of layersOn(st, N)) {
    const m = LAYER_X.exec(String(sc.params.get('pos') === undefined ? '' : sc.params.get('pos')));
    if (m) { const x = (m[1] === '-' ? -1 : 1) * +m[2]; xs.set(x, (xs.get(x) || 0) + 1); }
  }
  const top = [...xs].sort((a, b) => b[1] - a[1]);
  if (!top.length || (top.length > 1 && top[1][1] === top[0][1])) return null;
  return Math.round(ox + top[0][0]);
}
// ... and its HEIGHT (the hold's `aty`): THE AUTHOR'S ROUND-START HEIGHT.
// His layers' y reads a variable of the helper they name (`helper(...),
// var(33)`: doggy; var(35) missionary, var(37) cowgirl, var(39) blowjob),
// which his attacher's state sets at the round's start (`roundstate =
// [0,1]`: -8, -6, 3, 6) and back to 0 once the fight runs, where its arrow
// keys nudge it by hand. Those are the heights his art meets hers at: bound
// at her height with them at 0 the goblin sat too low in doggy and
// missionary and too high in cowgirl and blowjob, the owner's report
// (2026-10-08) pose by pose; her frame's own y offset (-30 / -17 / 20 / 25)
// overshot every one when played. -> the one nonzero literal his states set
// that variable to on a round-start trigger, for the variable most of his
// layers on N read in y (the first-made on a tie: the body before a cum
// effect), or null.
function contactAtY(an, P, N) {
  const st = an.states.get(P);
  if (!st) return null;
  const vars = new Map();
  for (const sc of layersOn(st, N)) {
    const pos = String(sc.params.get('pos') === undefined ? '' : sc.params.get('pos'));
    const m = LAYER_X.exec(pos);
    const my = m ? LAYER_Y.exec(pos.slice(m.index + m[0].length)) : null;
    if (my) vars.set(+my[1], (vars.get(+my[1]) || 0) + 1);
  }
  const top = [...vars].sort((a, b) => b[1] - a[1]);
  if (!top.length) return null;
  const V = top[0][0], vals = new Set();
  for (const s of an.states.values()) {
    for (const sc of (s && s.sctrls) || []) {
      if (sc.type !== 'varset') continue;
      const own = sc.params.get('var(' + V + ')');
      const val = own !== undefined ? own : (String(sc.params.get('v') === undefined ? '' : sc.params.get('v')).trim() === String(V) ? sc.params.get('value') : undefined);
      const lit = /^\s*(-?\d+)\s*$/.exec(String(val === undefined ? '' : val));
      if (!lit || +lit[1] === 0) continue;
      if (!atomsOf(sc.trig).some((e) => /\broundstate\s*(?:=\s*\[\s*0\s*,\s*1\s*\]|<\s*2\b|<=\s*1\b)/i.test(e))) continue;
      vals.add(+lit[1]);
    }
  }
  return vals.size === 1 ? [...vals][0] : null;
}
// His layers made on his animation N in the pose state, in the order made.
function layersOn(st, N) {
  return st.sctrls.filter((sc) => sc.type === 'explod' && atomsOf(sc.trig).some((e) => e.split('&&').some((p) => new RegExp('^\\s*anim\\s*=\\s*' + N + '\\s*$', 'i').test(p))));
}
// A layer's pos: its x a variable (redirected or not) plus or minus a number,
// then its y a variable plus or minus a number, or the variable alone.
const LAYER_X = /^\s*(?:[a-z]+\s*\((?:[^()]|\([^()]*\))*\)\s*,\s*)?f?var\s*\(\s*\d+\s*\)\s*([+-])\s*(\d+(?:\.\d+)?)\s*,/i;
const LAYER_Y = /^\s*(?:[a-z]+\s*\((?:[^()]|\([^()]*\))*\)\s*,\s*)?f?var\s*\(\s*(\d+)\s*\)\s*(?:[+-]\s*\d+(?:\.\d+)?)?\s*(?:,|$)/i;
// His .air's first-frame x offset per action (the first definition, as the
// engine keeps it), read once per file and size.
const AIR_X = new Map();
function airFirstX(file) {
  let key = null;
  try { const s = fs.statSync(file); key = file + '|' + s.size + '|' + s.mtimeMs; } catch (e) { return () => null; }
  if (!AIR_X.has(key)) {
    const out = new Map();
    let cur = null;
    try {
      for (const raw of fs.readFileSync(file, 'latin1').split(/\r?\n/)) {
        const l = raw.replace(/;.*$/, '').trim();
        const b = /^\[begin action\s+(-?\d+)\]/i.exec(l);
        if (b) { cur = out.has(+b[1]) ? null : +b[1]; continue; }
        if (cur === null || !l || /^\[/.test(l) || /^(clsn|loopstart|interpolate)/i.test(l)) continue;
        const f = /^-?\d+\s*,\s*-?\d+\s*,\s*(-?\d+)\s*,/.exec(l);
        if (f) { out.set(cur, +f[1]); cur = null; }
      }
    } catch (e) { /* no table: nothing read */ }
    if (AIR_X.size > 64) AIR_X.clear();
    AIR_X.set(key, out);
  }
  const t = AIR_X.get(key);
  return (a) => (t.has(a) ? t.get(a) : null);
}
// ITS OWN COLORS (the header's rule): the member repaints every palette of
// his sprite file onto one (a RemapPal `source = -1, 0` in a state of its
// on a line that always fires: GoblinParty's 10000, `dest = 1,palno`), and
// his sprite file is SFF v1 (its own-palette sprites have no palette key a
// remappal can name). -> [dest group, dest index] as written (a number or
// palno), or null.
function ownColors(an, m, sprite) {
  try {
    const b = Buffer.alloc(16);
    const fd = fs.openSync(sprite, 'r');
    try { fs.readSync(fd, b, 0, 16, 0); } finally { fs.closeSync(fd); }
    if (b.slice(0, 11).toString('latin1') !== 'ElecbyteSpr' || b[15] !== 1) return null;
  } catch (e) { return null; }
  const always = (sc) => !sc.trig.all.length && sc.trig.groups.length > 0 && sc.trig.groups.some((g) => g.length === 1 && /^\s*1\s*$/.test(String(g[0])));
  const part = (s) => (/^\s*-?\d+\s*$/.test(s) ? String(+s) : /^\s*palno\s*$/i.test(s) ? 'palno' : null);
  for (const no of new Set([...(m.starts || []), ...(m.settle || [])])) {
    const st = an.states.get(no);
    for (const sc of (st ? st.sctrls : [])) {
      if (sc.type !== 'remappal' || !always(sc)) continue;
      const src = String(sc.params.get('source') === undefined ? '' : sc.params.get('source')).split(',');
      const dst = String(sc.params.get('dest') === undefined ? '' : sc.params.get('dest')).split(',');
      if (src.length !== 2 || +src[0] !== -1 || dst.length !== 2) continue;
      const d = dst.map(part);
      if (d.every((x) => x !== null)) return d;
    }
  }
  return null;
}
// THE AUTHOR'S BIND (the header's rule): every Explod of the state is
// `postype = p1` with a `bindid` naming another player by PlayerID.
function authorBind(an, no) {
  const st = an.states.get(no);
  const ex = st ? st.sctrls.filter((sc) => sc.type === 'explod') : [];
  const par = (sc, k) => String(sc.params.get(k) === undefined ? '' : sc.params.get(k));
  return ex.length > 0 && ex.every((sc) => /^\s*p1\s*$/i.test(par(sc, 'postype')) && /^\s*playerid\s*\(/i.test(par(sc, 'bindid')));
}
// readCompanionPlay on a member's position state: { meter, ret, pos } or null.
function companionPlay(L, W, an, G, M, holding, base) {
  if (typeof L.readCompanionPlay !== 'function') return null;
  const shows = new Set([...M].filter((n) => n >= 0));
  // (Its position states: those that hold her - never its release, whose
  // meter, her escape, would read as its own.)
  const rec = { an, W, negLines: [], counter: { set: ranges(holding) }, positions: [{ k: 1, state: base, home: [[base, base]] }], art: [], mirrors: [], shows,
    drawLines: [], gAir: G.gAir, gAirTicks: G.gAirTicks, hScenes: G.hScenes };
  let P = null;
  try { P = L.readCompanionPlay(rec); } catch (e) { P = null; }
  const x = P && P.pos.get(1);
  if (x && x.variants.some((y) => y.speeds.length > 1 || (y.climax && (y.climax.pictures || []).length))) return P;
  return keyedPlay(L, W, an, G, base);
}
// THE SAME READING WHERE readCompanionPlay FINDS NO METER (the Titan's
// `var(58) >= (5000 + (random%200 - random%200))`): its speeds are the
// animations its TargetStates key her on, but those its meter's ChangeAnims
// play (and the ones they swap between); the meter pinned one past the
// highest value its comparison can draw; its return as readCompanionPlay
// reads it (an `ifelse(var(59) > 20, <away>, <itself>)` exit, pinned at the
// least value that stays and that no random draw of it in the state fires
// on). -> the readCompanionPlay shape, or null.
function keyedPlay(L, W, an, G, base) {
  const { X } = L;
  const st = an.states.get(base);
  if (!st) return null;
  const keyed = new Map();
  for (const sc of st.sctrls) {
    if (sc.type !== 'targetstate') continue;
    const H = L.S.lit(sc.params.get('value'));
    if (H === null || !G.hScenes.has(H)) continue;
    for (const e of atomsOf(sc.trig)) for (const p of e.split(/&&|\|\|/)) { const m = /^\s*anim\s*=\s*(\d+)\s*$/i.exec(p); if (m) { if (!keyed.has(+m[1])) keyed.set(+m[1], new Set()); keyed.get(+m[1]).add(H); } }
  }
  if (keyed.size < 2) return null;
  // The meter's ChangeAnims: an own variable compared (>=, >) with an
  // expression of no other variable.
  let meter = null, top = null;
  const climax = new Set();
  for (const sc of st.sctrls) {
    if (sc.type !== 'changeanim') continue;
    for (const e of atomsOf(sc.trig)) {
      const m = /^\s*(f?var\(\d+\))\s*(>=|>)\s*(.+)$/i.exec(e);
      if (!m || X.varsOf(m[3]).length) continue;
      const vals = X.evalRandom(m[3], {}).filter(Number.isFinite);
      if (!vals.length) continue;
      const t = Math.max(...vals) + (m[2] === '>' ? 1 : 0);
      if (meter && meter !== m[1].toLowerCase()) continue;
      meter = m[1].toLowerCase();
      top = top === null ? t : Math.max(top, t);
      for (const A of W.values(sc.params.get('value'), {}, base)) climax.add(A);
    }
  }
  if (!meter) return null;
  for (let grew = true; grew;) {
    grew = false;
    for (const sc of st.sctrls) {
      if (sc.type !== 'changeanim') continue;
      const from = atomsOf(sc.trig).flatMap((e) => e.split(/&&|\|\|/)).map((p) => /^\s*anim\s*=\s*(\d+)\s*$/i.exec(p)).filter(Boolean).map((m) => +m[1]);
      if (!from.some((A) => climax.has(A))) continue;
      for (const A of W.values(sc.params.get('value'), {}, base)) if (!climax.has(A) && keyed.has(A)) { climax.add(A); grew = true; }
    }
  }
  const head = L.S.lit(st.anim);
  const her = (A) => [...(keyed.get(A) || [])].sort((a, b) => a - b);
  const speeds = [...keyed.keys()].filter((A) => !climax.has(A) && G.gAir.has(A)).sort((a, b) => (a === head ? -1 : b === head ? 1 : a - b)).map((A) => ({ v: null, anim: A, her: her(A), skip: [] }));
  const pictures = [...climax].filter((A) => keyed.has(A) && G.gAir.has(A)).sort((a, b) => a - b).map((A) => ({ anim: A, her: her(A), skip: [] }));
  // Its return.
  let ret = null;
  for (const sc of st.sctrls) {
    if (sc.type !== 'changestate' || ret) continue;
    const m = /^\s*ifelse\s*\(\s*\(?\s*(f?var\(\d+\))\s*(>=|<=|!=|>|<|=)\s*(-?\d+)\s*\)?\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*\)\s*$/i.exec(String(sc.params.get('value')));
    if (!m) continue;
    const stayIf = +m[4] === base ? true : +m[5] === base ? false : null;
    if (stayIf === null) continue;
    const R = m[1].toLowerCase();
    const draws = st.sctrls.filter((d) => (d.type === 'varset' || d.type === 'varadd') && W.writesOf(d).some(([nm, raw]) => nm.toLowerCase() === R && X.usesRandom(String(raw))));
    for (let v = 0; v < 64 && !ret; v++) {
      if (X.evalExpr(R + m[2] + m[3], { [R]: v }) !== stayIf) continue;
      if (draws.some((d) => { let t = null; try { t = X.evalTriggerSet(d.trig, { [R]: v }); } catch (e) { t = null; } return t !== false; })) continue;
      ret = Object.assign(L.varRef(R), { value: v });
    }
  }
  const ref = L.varRef(meter);
  return { meter: { name: meter, kind: ref.kind, index: ref.index }, ret, artValues: {},
    pos: new Map([[1, { state: base, mine: [base], ladder: null, hold: null, keyVars: [],
      variants: [{ art: {}, pins: {}, plain: { anims: speeds.map((s) => s.anim), her: [] }, speeds,
        climax: pictures.length ? { pin: top + 1, anims: pictures.map((q) => q.anim), her: [], pictures, byName: [], allHer: [] } : null }] }]]) };
}

// (lib: the readers its test checks on their own.)
const lib = { settleAnim, neverShows, baseMarked, BASE_MARK, offsetPlay, authorBind, hisAnimsKeyed, contactAt, contactAtY, ownColors };
module.exports = { id: ID, read, pair, lib };

// The runtime half (trim, hook lines, Lua), when it is there.
try {
  Object.assign(module.exports, require('./mob-rt.js'), { id: ID, read, pair, lib });
} catch (e) {
  if (!(e && e.code === 'MODULE_NOT_FOUND' && /mob-rt/.test(String(e.message)))) console.warn('H gallery: mode mob runs without its runtime half: ' + String((e && e.message) || e).split('\n')[0].slice(0, 200));
}
