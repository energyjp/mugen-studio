// THE H GALLERY'S DATA: for every giver in the roster and every other
// character, the scenes that show her and the PATH of the giver's own
// commands that reaches each one inside a running scene.
//
// The gallery (gallery.js, the in-game mode) stands the pair close and idle,
// puts the giver into his grab state with Lua changeState - a state of HIS
// table, the only kind it accepts - and then plays a step's path: named
// commands of his made true with AssertCommand in a common [StateDef -4]
// hook (held, pressed or sustained), a jump into one of his own states, a
// set of his variables made by the hook, or a wait. This module decides, from
// the files alone, which path shows which scene:
//
//   buildGalleryData(opts) -> {
//     version: 2,
//     pairs: [{ giver: { select, name, display, nameHex? }, receiver: { same, helper?, stance? },
//               counts: { scenes, tailored, renders, partial, getHitOnly, vanishes, unknown, root?, unreachable },
//               setup?: [{ kind: 'var'|'fvar', index, value, why }], cmdAlias?: { name: [aliases] },
//               cutscene?: { helper, state, ends },
//               swap?: [{ state, from, to }],
//               steps: [{ entry, group, label, verdict, shown?, states, alsoStates?, place?, approach?: { id, state, dist }, clear?, clearAlso?, edgeOnly?, proj?,
//                         reach?, reachMin?, air?: { y, vx, vy }, lift?: { y, anim }, high?,
//                         setup?: [{ kind, index, value, why, art? }],
//                         companion?: { id, name, cmd, ready, pins: [{ kind, index, value, art?, meter? }], behind,
//                                       go?: { kind, index, value, state, in: [[a, b]], home: [[a, b]] },
//                                       hold?: { state, anim, skip: [[elem, toElem, elemtime]] }, art? },
//                         reroll?: [{ from, at, her }],
//                         ext?, withCtrl?, noGrab?, [ext]?: { the mode's own },
//                         anims?, path: [{ cmd?, mode?, jump?, at?, set?, hold?, from?, until?, anim?, fromAnim?, patience? }],
//                         nav: { pos, speed, ver, climax, stage } }] }] }
//
// `nav` is the step's place on the gallery's axes (NAVIGATION, near the end of
// this file): which position it belongs to, and its speed, version, climax and
// stage there. The gallery's keys move along them.
// An action is a command (cmd + mode, until), a jump (jump + at, until), a set
// alone (set, until: made once, then done when until shows) or a wait (until,
// patience). A command's mode is hold, press, sustain (asserted while the
// step is on screen) or mash (pressed every few frames while it is: a hub
// that answers every press, Kur0maru's eating throw). `set` is at most 4
// {kind, index, value}; `from` lists the states
// of his where a press acts (his -1 names them: the runtime may grab again at
// once when he is elsewhere). `place` {front, gap} stands her `front` px from
// the screen edge he faces and him `gap` px behind her (a summon whose helper
// walks to that edge); `clear` is the id of the helper a summon calls (waited
// out before the grab, and removed at every reset); `edgeOnly` marks a
// summon whose helper walks toward her or can take his own side (with several
// pairs, an edge slot only); `proj` a grab that is a projectile's hit (the
// engine removes a projectile past the view's edge: zoomed on another pair,
// its pair grabs only while it is in view). `setup` is the step's own, over
// the pair's (the same variable replaced); `companion` marks a step of his
// companion (below). `ext` names the prototype mode a step comes from
// (PROTOTYPE MODES, below), whose own fields are under step[ext];
// `withCtrl` lets his commands act while he stands in his basic states with
// control; `noGrab` starts the path with no grab. `reach` is the distance (320
// units) the pair stands apart for the grab to connect and `reachMin` the
// least that does (GRAB REACH); `air` where his grab starts in the air, in
// his own units (AIR START); `lift` where she is held in the air for a grab
// whose box is over her head, her own units and the action she is held on
// (AN ANTI-AIR GRAB); `high` how high his feet go in a scene he holds in the
// air, 320 units (A SCENE IN THE AIR). The pair's `cmdAlias` names, per
// command its steps assert, the commands one key makes true with it, which
// the hook asserts together (COMMAND ALIASES).
// The pair's `swap` lists, per scene of his, his action the hook plays on
// her in place of the one his probe picks for her, which draws none of her
// sprites (HIS OTHER BRANCH).
// `receiver.helper` { id, name, helperName, cmd, spawn, ready, immune, art,
// own, hideExplods, scale, rootScale, badge? } marks a pair whose receiver is an
// assist helper of the receiving character, a receiver of her own (A
// RECEIVER'S HELPER, below): the character loaded is her root (`select`),
// and `counts.root` is her scenes that draw her as her root.
// THE CONTRACT: the last action's `until` is exactly the step's `states`.
//
// A SCENE is a custom state the giver puts her into that the pair bench shows
// a number for (a guarded or assumed demand, an H-number fallback, or a
// computed table in the H windows - modlib.pairBenchIn's own rule), or whose
// fallback action draws from scene sprite groups (Kur0maru's 2234 on the
// Kuromaru receiver group 19230), so the gallery counts what the bench lists
// and what his art needs of her. A scene that changes her into a state his
// files never define (Kur0maru's 6225 -> 6229) is never a step's.
//
// A SITUATION is where a scene has settled after a path: the states his code
// runs through with no input, and the variables they carry. The grab alone is
// the first one. In a situation, a SWITCH is a command of his whose assertion
// changes what a controller of a state he is in does - a TargetState, a
// ChangeState, and also a VarSet/VarAdd (DongHwan's speeds and climax are
// command VarSets feeding a computed TargetState with no command of its own)
// - and his negative states' controllers count as his hub's (Minotaur picks
// his foreplay with -1 VarSets on `command && StateNo = 1011`). Each switch
// leads to a new situation; the walk goes three switches deep. What a switch
// shows is the step's `until`: the scenes it brings up that the situation did
// not show before, or - when it only narrows what was already possible (a
// random choice made certain, kuromaru's hold x at 6000; a speed made certain
// while auto runs, Brian's hold y) or picks her art (a variable her custom
// states read of him, kuromaru's variant var(35)) - the scenes it brings up
// first. One command can do different things in different states (c picks a
// variant in kuromaru's foreplay): each effect is its own switch.
//
// THE PAIR THE RUNTIME SETS UP, as the walk reads it: a human giver (AILevel
// 0), round state 2 with nobody winning or losing (Win, Lose, MatchOver read
// 0: Murakami's AI flag var(51), set on `Win = 1`, stays 0), palette 1, his
// power kept at its maximum ([Data] power),
// her life over half (the hook refills it), his ctrl as his statedefs set it,
// a helper his files never spawn absent (numhelper(N) 0, helper(N),x
// undefined) and a helper's own variables at 0. A variable keeps its round-
// start 0 until a VarSet that can fire writes it (var and fvar alike); one
// that none of his states writes stays 0 all match (Minotaur's AI switch
// var(59), set only inside his AI helper); a VarSet counts only in the states
// the grab's own machine runs through (Minotaur's var(1), a normal's cancel
// window, stays 0 in the buster). A state that re-applies a ChangeAnim every
// tick never reaches AnimTime 0. She is never KO'd (her alive, her life) and
// `target,StateNo` is the state he last put her in when she stays there
// (Brian's grope stage 6000 waits for her to leave the 6200 his grab gave
// her). Where he stands with control the scene is over: no switch there, and
// none that needs his control (the super throw his -1 allows on ctrl).
//
// A switch whose effect the scene undoes by itself (DongHwan's speed: 6002's
// end zeroes var(39) and re-targets the base) is TRANSIENT: a short cycle is
// SUSTAINED (asserted for as long as the step is on screen), a long one (a
// climax) is held until it shows. A transient step is a leaf; so is AUTO (a
// persistent switch that plays through the transient ones by itself). Every
// other switch is a POSITION, which the walk explores further.
//
// Never in a path: a switch that ends the scene (him into a basic state), a
// toggle (a VarSet/VarAdd that only flips its own variable: see-through,
// screen effects, continuous mode), one that stops time (a Pause longer than
// a few seconds), and one that can hang (a state whose only exit waits for an
// animation of his that never ends; an AnimTime behind a redirect waits on
// hers: f.sanae's insertion 15002 plays 3342 of time -1 and leaves on
// `Target,animtime = 0`). AI commands (the long AI_n/cpu_n motions) are
// not a player's and are never asserted.
//
// SETUP, held by the hook every frame. A gauge no input in the scene can fill
// (Minotaur's insertion check Var(16)+Var(56) < 6000, which sends every
// insertion into the groin kick at round start), at the value his own files
// use; a companion helper his negative states spawn that grabs her on its own
// (Brian's Striker), kept from spawning by its variable gate (its own steps
// open it again, below); a random
// position a Baomaru climax draws behind a switch variable (the extra
// edition's var(18)), switched off; a meter his scenes fill that makes his
// negative states interrupt any step (Brian's fvar(39) = 48 fires her orgasm,
// where he waits for x; his stun fvar(7) >= 49 spawns a slow-motion helper),
// held at 0; a FINISH COUNTER (below), held at 0; a GAUGE only his strokes
// fill (Murakami's var(25): a press in his hold 1000 enters the stroke 1002,
// which adds 600, and 1000's `Var(25) >= 12000` starts his climax by
// itself), held at 0 - its climax is a step of its own (A GAUGE CLIMAX).
//
// FINISHES (finishCounters, meterFires, gateFails; readBao, ladderOf,
// pairStages, rootBranchShut):
//   HER ORGASM per position: a held meter whose firing puts her in a scene
//   (Brian's -2 on fvar(39) = 48: her 6600) is set once at the end of each
//   hub position's way (and at the grope stage, after a short wait for its
//   own state), judged per position under his position variable.
//   STAGES: a variable his climax state or a held meter's firing adds to,
//   set to nothing but 0, that his or her art compares with a number
//   (Brian's var(4), DongHwan's var(32)) is held at 0, and each step whose
//   art changes at one of those numbers gets a copy held there (", stage k",
//   nav.stage = k): his art starting in the step's states, a new picture of
//   hers (frames, not numbers), or a scene of his a ChangeState of hers
//   starts giving there.
//   A POSITION HIS HUB DROPS (Brian's position 5: only his climax state's
//   F,s sets it, and his hub, with no animation for it, zeroes it on its
//   animation's end): the step's last action holds it (`hold`, from that
//   action on), with the hub's wait at its least; a speed that can hang is
//   left out alone, with auto.
//   A GAUGE GATE'S FAILURE (Minotaur's groin kick): the gate's own scene,
//   the gauge at its round-start 0 in the step's setup, led by the
//   insertion's press.
//   A RANDOM BRANCH THAT DRAWS A RECEIVER'S HELPER AS HER ROOT (DongHwan's
//   6005 -> 72001/72002 on Chichi): held shut where its draw is tested on a
//   later tick, re-rolled by the hook's +1 where it is tested on the tick
//   it is drawn (`reroll`).
//   NAV on each step this adds is the deriver's too, with what it says of
//   them (`navHint`, `navStage`): her orgasm is a climax, his climax's
//   second finish (a `leaf`: leaving it grabs again); a gate's failure a
//   one-off; a stage copy its step's place at its stage, and a scene a
//   stage adds after the step's own states its end (`endStates`).
//
// READ FROM THE STATES THEMSELVES, where an idiom says every step:
//   THE BAOMARU HUB (GRAIL 4.10 C): positions numbered by his own position
//   variable, each held until its base shows, with its speeds sustained, its
//   own climax held (or jumped into when his files gate its command shut for
//   the gallery's pair) and auto pressed; every step but auto turns auto off
//   on its first action (and again once the base shows, where auto turns on
//   by itself on the way). A grab that stops before the hub (Brian's grope
//   stage) has its own step, and every other path starts with the press that
//   leaves it, until every state past it.
//   AN EXTRA TERM: a third variable in both computed values, at most three
//   values in his files, 0 among them (f.sanae's big-cum flag var(25), 0 or
//   100, in `16195+(var(55)*5)+(1+var(54))+var(25)`), read at its 0; a hub
//   read exactly comes first. A BUFF'S CLIMAX: where his climax command sets
//   that term behind a variable his files give one value only, in states
//   outside the grab (her stamina drug 3782's `var(0) = 1`, never reset), each
//   position gets "climax 2", the buff held as the step's setup and the
//   command held until it shows (its random half drawn again each climax).
//   Two grabs read as hubs are named by their own names ("Bao (grab
//   B,F,x)"), and a hub read for one grab is that grab's: another grab's
//   walk steps through it (Moses' Miracle into the Lesbian Raper's 16001)
//   give way to the reader's.
//   AN INSERTION LADDER (Minotaur's x0..x4): the position by its button, speed
//   2 and 3 by its own button in x1/x2, the climax by time; short patience, so
//   a press where it cannot act grabs again soon. A pick hub's first position
//   is its button, not its default. The lead's `from` is where that button
//   acts or leads on by itself (the pick hub, the family's x0-x2, the position
//   change), so a step started in x3 or an aftermath grabs again at once. His
//   CONTINUOUS MODE (a variable that alone keeps x3 from climaxing by time,
//   written only by a toggle a player makes: Minotaur's var(52) on c) is SET
//   by the hook - never the toggle command: on for the position and speeds,
//   off for the climax, on the lead's first action.
//   A SUMMON: his state whose helper grabs her - by its HitDef's p2stateno, or
//   by a TargetState of the helper's own state on the hit (Kur0maru's dogs,
//   tentacle trap, upper throw, Jedah: throws with no p2stateno), or by a hit
//   that HANDS HER ON: a ChangeState on the hit into the helper's own states,
//   one of which puts her in an H scene within six hops (ero_helper_gs' 2100
//   -> 2000 -> 2101 -> 2102 -> 2103 -> 3000, `StateNo + 1000`: her 4000; a
//   release on the way is no end). With a hub
//   his negative states enter on the helper's state (Minotaur's horse), the
//   walk starts there and the helper's states that follow his show her
//   scenes. With none, THE HELPER PLAYS THE SCENE: the summon state is the
//   entry, the walk starts in it (or in the follow-up it enters on the
//   helper's state or hit: Jedah's 4140, the upper throw's 3401), and her states are
//   everything the helper's own states give her, per receiver (the dog
//   girl's piston sequence where she ships 19230, else the small dog's hold;
//   its counters never pinned). A copy of him that starts in a state of his
//   own (kuromaru_plus's time-stop clone in his Bao) and a summon state that
//   stops time are none. Ranked after his grabs.
//   NESTED: a helper whose states only spawn the one that grabs (Ripps' ant
//   8000 spawns the hole 8001 at her, whose 8002 grabs) is a summon too: the
//   Helper controllers in its states join its reach, three deep; `clear` is
//   the helper that grabs, `clearAlso` the ones on the way (removed at every
//   reset with it). A nested summon ranks after the direct ones, so of two
//   that show her the same the direct one stays (Tendril's 980, not his
//   clone 905). Her states there are closed over her own chain before they
//   are judged: a lead-in with no art (Succubus' Bulleta: 47000, then 47001-
//   47004 at Time 190) is not the end of what the helper gives her.
//   A summon's helper that reads HIS commands (`root,command`,
//   `parent,command`: the hole's 4862 -> 9900 on x, 10500 on a) reads the
//   commands the step asserts on him - none - so a branch on one is none of
//   its scenes (listed "issued by a helper"): he stands with control while
//   it plays, and each of those buttons is an attack of his there.
//   TWO COMMANDS ON ONE TICK (Minotaur's mount): a jump from where he waits.
//   A FINISHER BY COUNT (Kur0maru's chair): the press repeated until it shows,
//   with the grab's hold and the press's reaction on screen meanwhile.
//   A GAUGE CLIMAX (Murakami's hubs, the gauge held at 0 by the setup): the
//   grab's hold waited for, then the gauge SET by the hook to its number once
//   ("press a, gauge full": twenty-odd strokes, and he leaves after 60 idle
//   ticks between them), until her scenes from his climax state on and where
//   her own states take her (1007, then her dizzy 1010); the climax of the
//   hub the stroke is pressed in, its stroke a speed there. ITS STROKES GO
//   ON: the stroke's command is sustained ("hold a"), so it comes round
//   again for as long as the step is on screen; the climax waits as long as
//   the longest animation on its way and 120 more, where that is past the
//   default (his 2002 576 ticks, her 2005 628: 748).
//   A HUB THAT ANSWERS EVERY PRESS (Kur0maru's eating throw 3160: the same
//   press re-issues the same TargetState and he stays put): mashed.
//   A HIT THAT HANDS ON (Kur0maru's milking 51305: no p1/p2stateno, a
//   ChangeState on movehit into 51306, which puts her in 52218 on its first
//   tick): a grab; one only a launcher enters, routing on her art (51300 on
//   `enemynear,SelfAnimExist(52219) || (110810)`), is hers only when a route
//   is open for her.
//   A COMPANION DRIVEN IN HIS STANCE (Brian's Striker Bao, helper 69000: his
//   readme's "Command Stance"): the gated helper, spawned with keyctrl, whose
//   own negative-state lines read him while he stands in a state of his a
//   command of his enters (66000 on s). ITS GRAB: a line of its into a state
//   whose HitDef catches her, on `Root,StateNo = <stance>` and a command of
//   its OWN command list (hold Up or Down: a keyctrl helper reads the
//   player's keys through a copy of his), from the idle states that line
//   names (69000-69003); where the HitDef's p1/p2stateno read a variable its
//   state draws at random (41400's fvar(1) = random%100), each outcome is a
//   FAMILY, pinned on the companion to a value inside it (98: the intro
//   41399/41398; 7: the rapid grab 21998, which lands in 22000 at once). ITS
//   POSITIONS: a counter of its own his command adds 1 to (`parent,command =
//   "b"` -> var(2), in the states that line names) and its ChangeStates on the
//   counter's value (1 41488, 2 41401, 3 22000, 4 51488). ITS ART VARIANTS:
//   a variable its lines or states draw at random that its animations read
//   (41401's var(3): him upright on his knees behind her or bent over her
//   back; var(33), drawn in its idle state and on the line into 51488: her
//   lying under him or sitting on him) is pinned on it per step, at 0 or 1:
//   each variant of a position is steps of its own, with his copy of it (its
//   ParentVarSet var(23) = var(33), which her 51409 reads for her art) held
//   at the step's value in the step's setup. ITS PLAY (readCompanionPlay):
//   its meter var(58), pinned past its top on a climax, at the middle of a
//   rung on position 3's phases and at 0 on every other step; its return
//   var(59) = 1, so a climax stays; its speeds var(0) where a position holds
//   its animation at it (41401: five, 51488: three, named in his a's order),
//   and where none does, the animations its TargetStates key her states on
//   (41488's 464001-464003, which it picks at random: her 41409-41411); each
//   climax PICTURE its own step (464004/464005, her 41412/41413). THE HOOK
//   HOLDS every speed and picture at its animation (`companion.hold`: set
//   when another plays, restarted on its last tick, the first tick of an
//   element where the state swaps it away skipped), so none flashes another
//   at a loop's end and one moved to in place, out of a climax too, shows at
//   once. ITS JOINS: a state of his his stance enters on a command where its
//   own lines put her in a scene (c -> his 69230, its -2 -> her 69232: the
//   threesome), gated on a variable of his only its ParentVarSet writes from
//   a probe of her (var(45) from 69229): one step where the probe passes, c
//   pressed in his stance; elsewhere "needs her action 69229".
//   Its steps are a GROUP after his own ("Striker Bao": the Helper's name
//   and the author's comment on the line that spawns it), each with the gate
//   open as its own setup (the value his files spawn it with: config state
//   999969's var(14) = 1; none where another value that state writes shuts
//   the Helper: "bao ON/OFF" var(55) = 0), entered through his stance: the
//   grab of a family that lands in no position (the intro: her 41398, then
//   41401's speeds), and per position a fresh grab of the family that lands
//   in the set with no intro, then the position SET BY THE HOOK (`go`: its
//   counter to k and its state to the position's, from the states the
//   counter's line names; a ladder's rung at home in its own), the path
//   waiting for the step's own states: position 1 and its climax; position 2
//   per variant, its five speeds and its climax; position 3's phases and its
//   climax; position 4 per variant, its three speeds and its climax. Never
//   his b pressed until it shows: b counts 1, 2, 3, 4, 0 through every
//   position between, and the line into 51488 draws var(33) on the tick it
//   enters, before any pin. Per partner: a family whose first state lets go
//   of her at once is none for her (21998 on `var(57) = Target,
//   SelfAnimExist(22001)`), a position whose state throws out a partner
//   lacking its art (her 22001 on her own `SelfAnimExist(22001)`) is none
//   (and keeps no other from her: the hook never passes it), and so is one
//   that may hand her on to another position on its first tick (51488 back
//   to 41401 unless she ships an anim it probes); position 4 per variant is
//   judged under his var(23) (heldJudge: a probe is no art, and a piece of
//   her is no body - pieceFrames: Miyako's 12260 feet), and its steps carry
//   the variant (`companion.art`: her state reads it on entry only, so a
//   switch in place that keeps her state grabs again). A grab's first
//   state is the grab's, never a position's own (51488 hands her back to
//   41398 at its climax's end). Edge slots only, the helper spawning behind
//   him.
//
// NAV ROLES: what a walk step is in its grab, read from what its last switch
// does (`navRole`, for the deriver, where no label or group places it):
//   its HUB is the state of his where its scene comes to rest - the first,
//   from where the switch sent him, that he stays in, the walk switches in
//   (or two commands act in), and he does not leave by time for another
//   state of his (FutaRB's 51000; 51001 once Up is pressed). Steps of one
//   grab that rest in one hub are one position.
//   A SPEED: the switch sends him into a state a command of the hub also
//   enters, and that state goes back into the hub by itself (FutaRB's Fuck1:
//   51000 -> 50110 -> 51000 at AnimTime 0; the same press made in 50110 while
//   it plays, a then Forward, is 50510, Fuck1's own of the blowjob hub
//   51004). Speeds rank in the order the hub's controllers list them.
//   A BASE: any other switch that rests in a hub, and the grab alone.
//   A FINISH: a switch whose scene has no hub and ends by itself (him back
//   in a basic state), after two scenes or one that releases her, is the
//   climax of the hub it is made in; so is a finisher by count (Kur0maru's
//   chair: the grab and its 6th press are one position).
//   RUNGS: positions whose only way on is the command that led there,
//   pressed again (BUTA's y, y, y: each stage holds until the next press),
//   two or more in a row, are phases of the position they start from; the
//   last one, where it ends the scene by itself, its climax (one scene is
//   enough there).
//   A position that is one step stays a one-off, and two steps in one place
//   (two bases of one hub: the horse's foreplays) are its versions.
//
// TIMED LADDERS (timedLadderOf): a step of the grab itself or one switch
// into it whose scene goes on with no input through states of his, one
// after another, each giving her her next scene after a while (Roberth's
// 89100 -> 89101 -> ... -> 89105 at `time >= 200 && animtime = 0`, each with
// a TargetState at its first tick; the dragon's 11206 -> 11209 at `time >=
// 300`, each with the next one's TargetState on its last tick), three rungs
// or more, is one step per rung: "phase k", the first the step's own path,
// every other that path and a wait for its rung (patience from the ticks the
// rungs wait, `from` the states of his where it can still come: his scene
// past it, the step is grabbed again at once). Its last rung is the climax
// where his scene then ends by itself; what he gives her on the tick he lets
// go (a TargetState on his ChangeState's own trigger into a basic state:
// the dragon's 30091) is on its last rung. Her states her own chain moves her
// on to are the rung they follow. A state of his where another step of the
// grab makes its switch is the hub the ladder ends in: its last rung, no
// climax - and no ladder before three rungs of its own (Minotaur's buster
// 1250 after its lift and slam: a grab with an intro). A rung waits at least
// 15 ticks; never two that lead back to each other. Its own group where the
// grab has other steps; its first rung keeps the grab's role (Ryu's hold a,
// then hold a: still RUNGS of it).
//
// ANIM HUBS (animHubOf): a grab whose scene of hers draws HIS animation (her
// ChangeAnim2 on `enemynear,anim + 1000`: the FutaBT 50004) and whose one
// hub state of his on the way picks his animations by ChangeAnims on his
// commands (FutaBT's 50003) keeps her state for every pose, so each of his
// animations is a step: the hub's controllers are run tick by tick on his
// animation and the variables they read (AnimTime 0 on an animation's last
// tick only, no explod on screen, anything unknown never fires). From the
// grab's own idle, a press whose animation he stays in is a POSITION (Down,
// Up, Back: 70030, 70010, 70020, ranked by number), one whose animation goes
// back to the idle by itself a SPEED of the position it is made in
// (sustained: a, b, c - idle + 1..3), and a ChangeAnim no command reaches
// because a variable it compares is below the number (`Var(34) >= 26`, a
// meter only his thrusts fill) its CLIMAX: the hook sets the meter there
// once, at the position's idle (idle + 4). Every other step holds the meter
// at the value the hub starts it with (5), and every step holds at 0 a
// variable the hub adds to on a climax animation (his finish count var(49),
// which turns on overlays). Each action names his animation (`anim`: done
// only when it shows too) and the animations it acts from (`fromAnim`: a
// position's loop, back at its idle by itself; in place elsewhere, the step
// is grabbed again), and the step the ones it shows in (`anims`: out of
// them a while, the climax plays again). Roles are read from the
// controllers: the trio's meters are var(34), var(42) and var(53). A grab
// alone keeps everything it shows, her way in (50002) too.
//
// RANDOM SIBLINGS: two ChangeStates in a row on `Random < 100` are two
// chances - each `random` is drawn afresh - so each is followed (Morrigan's
// 11990 -> 12000 / 12010 / 12020), never taken for one exit waiting on the
// same thing.
//
// THE FIX PASS (2026-10-07), each rule read from the files:
//   GRAB REACH (galreach.js): his grab's first ticks replayed as the engine
//   plays them (his motion, the Clsn1 of each element while his HitDef is
//   live, her standing Clsn2 core, push only from a frame with a Clsn2); a
//   grab the default stand misses (FutaRB Mina's dash 35330, Succubus' run
//   21000) gets `reach`, the least distance that connects plus a margin.
//   THE HEIGHT (2026-10-08): a box counts only where one of its rectangles
//   reaches her body's height (as high and as low as any frame of her
//   standing 0 reaches). AN ANTI-AIR GRAB (stampReach, galreach liftOf): a
//   grab whose box is over her head and whose HitDef hits the air gets
//   `lift`, the height (her units) and action (her neutral jump, else her
//   stand) she is held in the air on until it takes her (Murakami's 484
//   "grab c" and his other anim-420 grabs). A SCENE IN THE AIR (galreach
//   highOf): a grab that takes her off the ground into a state of his that
//   holds him there gets `high`, how high his feet go (his winged demon 487:
//   -149), and one pair's view zooms out for it.
//   A grab that connects there gets nothing. NO CLSN1, NO GRAB: a HitDef
//   state none of whose animations has a Clsn1 never hits (Allosaurus'
//   22004). A summon whose helper spawns at his side (Creatures' worm) reads
//   the helper's motion. AIR START: a grab state with physics A is lifted to
//   where his lead's arc meets its ChangeState (FutamaruPlus' 1800 into
//   1801), else to his jump's apex (Tendril's 610): `air`. A Projectile in
//   the grab's first ticks is inert for his motion (Tendril 610's afterimage:
//   reach 27 on A-Shi). A SUMMON'S FRONT STAND (summonFront): a summon placed
//   at the edge (postype front) whose helper's box, scaled by his xscale,
//   stops short of her back at the default `place.front` stands her nearer
//   the edge (YarimusiHIVE's mino: 95 -> 80 on R.Mika).
//   COMMAND ALIASES (commandAliases): commands with one definition are one
//   key; the walk reads them together and the hook asserts them together
//   (dragon_futa2's `holdfwd ^^ holdfwd2` AI detector stays false).
//   PRESS SUMMONS: a Helper of his -1 on one button with control that
//   nothing else of his reads is pressed while he stands (`noGrab`,
//   `withCtrl`; Marasama's six creatures, each its own step); a press that
//   brings a whole mob is the mob prototype's.
//   SIGNALED GRABS: a grab his -2 enters only on a variable a helper sets
//   for him is entered through the state that spawns that helper (Monsters'
//   FlowerGirl: 1000, not 6000), named by the helper. THE APPROACH: where
//   the helper walks to her and goes on toward its signal only on
//   `P2BodyDist X <= N` (the creatures' 1100-4100, a crawl of .17 px a
//   tick), the step carries `approach` { id, state, dist } and no place:
//   the runtime stands it there and the scene plays at the center.
//   A CUTSCENE INTRO (cutsceneIntro): a helper his negative states spawn in
//   round state 0-1 that asserts Intro and goes only by its own time past
//   600 ticks (Goblin Party's guild, a minute) is the pair's `cutscene`
//   { helper, state, ends }: the runtime cuts it at once.
//   CLIMAX BY DRAIN (detectSetup, drainOf): a meter his speeds drain toward
//   a climax ChangeState (FutaRB's var(41)) is held at its grab value, and
//   each position gets a climax step that holds it at the number ("hold a,
//   gauge empty"). AUTO BY SET (autoOf): a toggle his speed's way back reads
//   (FutaRB's AutoRape var(42)) is held at 1 in one auto step per position
//   ("hold a, looping"; never the toggle pressed).
//   LONG CYCLE IS A FINISH (roleOf): a speed that holds him longer than
//   SUSTAIN_MAX is its hub's climax (GnollK's ejaculate, FutaCR's FuckCum).
//   SPEED FROM: a walk speed's press acts only in its hub and the hub's own
//   speed states; made in place elsewhere, the step grabs again.
//   RUNG 0'S WAIT: a timed ladder whose first rung comes after a long hold
//   waits that long (Murakami's 2900). A PRESS AFTER A TIMED HANDOFF waits
//   in `from` the states where it acts, as long as the way there lasts
//   (Yarimusi's 25400 -> 4862 at time 960).
//   VARIABLE ANIM HUBS (varHubOf): a hub whose ChangeAnim value reads
//   variables his commands set (FutaNT Android 21's 70000 + fvar(32) +
//   fvar(31)) is read by its axes: position, speed, version and climax, each
//   step SET by the hook and done when his animation shows. A version his
//   .air has no table for is dropped, not the hub (its toggle read at 0); a
//   version's climax drawn with an animation an earlier version already
//   gave at that position is that climax (FutaNT's 70006 + position); a hub
//   that makes no step leaves the walk's own steps.
//
// WHICH STEPS. Shortest paths first; a position step that only shows scenes
// an earlier step listed goes (1590 reaches the ground positions with two
// presses, 1599 with one), except a narrowing one switch deep (a choice, a
// variant); two switches deep a step must show something new. Speeds,
// climaxes and auto stay whenever their scenes differ. A scene is her state
// AND the state of his that gives it: two switches of one situation that
// show the same states from states of his with none in common are two steps
// (Minotaur's buster y, his finger 1260, and b, his vibrator 1271, both give
// her 1265); so are a grab of his and a summon whose helper plays the scene
// that give her the same states (Lilith's doggie 8771, his own 6072, and her
// dog summon 6060, its helper's 6061: both her 6064) - two summons or two
// grabs of his stay one (Kur0maru's two dogs on Gardevoir, his thunder x
// and y). A jump is only for a state of his no command of his enters (an
// AI-only or timed pick) and no setup gate guards.
//
// PER RECEIVER, per scene (the bench's verdicts, as the build ships her):
//   tailored    she ships a number the giver asks for, every frame present
//               (or as a frameless flag his own states route on: R.Mika's
//               110810 for Kur0maru's milking);
//   renders     his fallback action draws her scene art (a sprite group in
//               the H windows or 10000 and up) with every frame present;
//   partial     scene art, some of its frames missing; `shown` is the share
//               of that art's time (one pass of the action, in ticks, blanks
//               not drawn) whose sprites she has, the least of a step's
//               partial states (Brian's 6219 on Kur0maru: 43%) - a measured
//               fact of her files, shown as "[partial 43%]", never a score;
//   getHitOnly  what draws her uses only her ordinary sprites;
//   vanishes    nothing he plays on her has a frame she owns;
//   unknown     nothing to judge (no sprite file, or he names no action).
// A step is listed for her when at least one scene of its `until` is
// tailored, renders or partial; `states` lists those (and the last action's
// until becomes exactly them), `alsoStates` the rest and what the step passes
// through (the intro, the lift). Two steps that show her the same states are
// one. Counts only, never a percentage (GRAIL 4.3). A receiver's own action
// counts only where it plays for her (not replaced on her first tick, not
// behind another character's name), and never her hit spark (an action her
// HitDefs spark with) nor, in a companion's scenes only, her HUD (an action
// her own Explods hold on the screen with no window art: Mai's groove label
// 22001). What the grab puts her in before its
// scenes (the eating throw's swallow 3200) is on screen too where she draws.
// A RECEIVER'S HELPER, a receiver of her own (declared by id in
// HELPER_RECEIVERS: Dr. Kira's Chichi, helper 2017851216 - no detector, there
// is no second case): a helper shares her root's animation table, so every
// number a giver plays on her is the ROOT's, and the root's art on a helper
// spawned at another scale is the root's body at that scale (Kira at 0.5,
// Chichi at 1: a double-size Kira). She is a receiver only through her root's
// [Statedef +1] (run after the state, ungated), whose ChangeAnims gated on
// IsHelper(<id>) turn his numbers into her art. Read from the root's files:
// the summon (a Helper of that id in its negative states that one command of
// the root's alone spawns: summontagA; not the summons that want power or a
// variable), her states from its stateno, the READY ones (standing still on a
// Clsn2: her taunts), her immunity per giver (her NotHitBy, slot 0, time
// 320000, with his .air for her badge check: `,NT,ST,HT`, so only a grab
// that hits as an attack pairs with her - DongHwan's 4501, S,NA), and the
// bridge (the +1 ChangeAnims in order). Her BADGE (the number N of her
// `Enemy,NumExplod(N) && Enemy,AnimExist(N)` checks, 125234: her author's
// grab flag, an explod and an action of his) is given by the gallery to a
// giver none of whose own grabs she lets through without it, where it opens
// one: `badge` { n, sets } lists, per ready state, the HitBy/NotHitBy her
// state ends with under it where that differs (NotHitBy ,HP for a tick), and
// the hook runs those on her in its state +1; nobody's files change, so a
// real fight never sees it (on the Main roster it opens every throw of
// Brian, Minotaur and Kur0maru, but none of their scenes draws her and never
// Kira on its way: no pair). Per scene, every animation his state
// can play on her, through the bridge: sent to an action that draws none of
// the number's own sprites is her art (tailored/partial/vanishes by its
// frames: the bridge's blank 1891119 for his left-side position is
// `vanishes`); unbridged is `root`, the root's body on her. His EXPLODS in a
// state she runs are hers and resolve in her root's table too (no F prefix),
// where no bridge reaches: each one whose action there draws a sprite is
// listed by id for the hook to remove on her after the state runs
// (`hideExplods`: his intro 7201's 43434 is Kira's close-up 19230, a big Kira
// beside her), and one it cannot name (no id, or an id her own Explods use)
// makes its state `root`. A step is listed only where she is drawn in her art
// and never as her root anywhere on its way, the grab's INTRO included - the
// states its steps pass that none of them shows (7201), on the way of every
// step of that grab, since each is grabbed fresh at times (not DongHwan's
// position 1 climax or auto: 6005 sends her at random to 72001/72002, his
// ChangeAnim2 on Kira's 19230). `own` is what her own states draw her with
// (her run in, taunts and run out), for the headless watch. A variable of
// his that she reads of him to pick an alternative of the root's (`enemyNear,var(32) >= 5`
// picks Kira's broken press 1180207-1180211) is held at 0 in the pair's
// setup, where his files read it for art only. His own grabs only (never a
// summon or a companion: her taunt lasts seconds), each step `edgeOnly`
// (she comes in from the screen edge her root faces). The pair comes right
// after her root's, "Chichi (Dr.Kira)": her name and the root's first word.
//
// WHO IS PAIRED: a detected giver who is no receiver answers another giver's
// demands mostly with his own giver art (DongHwan's hub overlay 42249 on
// group 4251, Brian's 27230, Minotaur's 36699 on 6699): one of his own
// actions counts as her answer only where its frames draw a sprite group
// inside the receiver windows that his .sff has (Kur0maru's
// Kuromaru-template woman, 17231-17234 on 17230) and no H art outside them
// (Brian's 69280-69581 mix in his own scene art), and he is never a receiver
// when his -2, which runs in her custom state too, would act there: a
// helper, a state change, a hit, a Pause, an Explod or ChangeAnim, a move, a
// bind, invisibility (Brian's Striker, DongHwan's SuperPause and Explods).
// His fallback art is judged as anyone's. A pair
// must show at least one scene that is not a GENERIC REACTION - her own
// answer to a guarded number outside the H windows whose frames draw no
// scene group (Kur0maru's thunder -> her electrocuted 7696, his Bliss -> her
// Midnight Bliss 9020).
//
// Names: a command name reaches the runtime only as `cmd` (its exact latin1
// bytes; Shift-JIS names are common); labels are ASCII and name inputs the
// way the .cmd defines them ("hold Up", "press x", "motion D,DF,F,x"). A step's
// GROUP names what it belongs to and its label never repeats it (the runtime
// draws the group on a line of its own): "speed 2 (press x)" under
// "grab F,D,B,b: position 1". A giver with several grabs names each: "Bao" for
// the Baomaru hub, else the move name his -1 gives it when that is ASCII,
// unique, no command's and the only one that block's state has (Kur0maru's
// "Beam a" and "Beam b" both name 4700: its input), else a summon's helper
// name ("horse"; one several summons share is told apart by each one's input:
// Kur0maru's "dog hold Back+z" and "dog hold Down+z"), else its input ("grab F,D,B,b" -
// Minotaur's own names are Japanese). A projectile's own step is "the hit",
// a grab's "the grab".
//
// PROTOTYPE MODES (gallerymodes/): a prototype is a module of its own,
// gallerymodes/<id>.js, switched per bundle by its Mods tab row
// (gallerymodes/index.js enabled(roster)). buildGalleryData takes the modes
// as opts.modes; with none, the data is the core's byte for byte. Per giver,
// a mode's read(base, ctx) runs once, kept with his base (so by his files'
// signature): ctx.fns are his base's readers (his walker W, standingGrab,
// issuesCustom, issuesAtOnce, HIT_GATE, trigTxt, xMoves, helperReach), ctx.lib
// this module's exports and helpers, ctx.memo the mode's own. A read that
// answers null leaves him out of that mode. Per pair, pair(G, R, ctx) answers
// null or { steps, claims?, counts?, setup? }, kept like a core pair; ctx
// adds `reading` (what read answered), walk() (his walk for her), judge,
// verdict and shownOf (the pair's judging, as the core's), pairSteps
// (walk-shaped steps judged for her, carrying ext, withCtrl, noGrab and
// step[id]) and finishPair. Its steps are in the output shape above, each
// tagged `ext: <id>`, and come after the core steps of the same pair, so
// those keep their indices - or, where it CLAIMS core steps, in their place,
// at the first claimed one's. A claim is a list of his grabs (honored only
// for a grab one of its own steps has as its entry; never a companion's
// step) or a predicate over the pair's steps; a mode never claims another
// mode's steps. Where the core has no pair for her, its steps make a pair of
// their own at the same place in the list (his scenes and what his walk
// leaves unreachable counted; his setup, unless it gives one). A mode's
// `counts` are added to the pair's (a scene it now reaches: +1 to its
// verdict, -1 to unreachable; never below 0). Never in her helper's pair
// (Dr. Kira's Chichi). A read or pair that throws leaves that mode out for
// that giver or pair, with a warning. Modes run in their rows' order;
// deriveNav places every step after them. A mode's walk may read the round
// another way through makeWalker opts.gate (rewriteAtoms more.gate: the round
// state, a win, her alive and her life as the gate says), a walker that keeps
// its own caches.
//
// CACHES: a giver's base (with every walk made on it), a receiver's reading
// and a pair's steps are kept per process while their files are unchanged
// (path, size and time of the .def and every file its [Files] names), so the
// build inside every VFS build costs almost nothing when nothing changed.
// `name` is the [Info] name as the engine's name() returns it; `nameHex`
// carries its exact bytes when they are not UTF-8.
'use strict';
const fs = require('fs');
const path = require('path');
const S = require('./scenelib.js');
const X = require('./cnsexpr.js');
const modlib = require('./modlib.js');
const hmodule = require('./hmodule.js');
// (The grab reach model: GRAB REACH below. A build without it keeps today's
// steps, with no reach, air or no-Clsn1 drop.)
let galreach = null;
try { galreach = require('./galreach.js'); } catch (e) { galreach = null; }

// ---- H numbers and groups (modlib's own tables) ------------------------------
const REGISTRY = modlib.H_FAMILIES.filter((f) => f.registry !== false).flatMap((f) => f.ranges);
const isHNumber = (n) => REGISTRY.some(([a, b]) => n >= a && n <= b) || (n >= 90000 && n <= 90999)
  || n >= 100000 || modlib.hFamily(n) === 'Kuromaru victim standard';
const isHGroup = (g) => g >= 10000 || modlib.hFamily(g) !== 'other';
const isBasic = (n) => !Number.isFinite(n) || n <= 199 || (n >= 5000 && n <= 5999);
const INPUT_ORDER = ['F', 'U', 'B', 'D', 'a', 'b', 'c', 'x', 'y', 'z', 's'];
const KEY_WORD = { F: 'Forward', U: 'Up', B: 'Back', D: 'Down' };
const NO_INPUT = new Set();
const CTRL = 'sysvar(9999)';  // his ctrl flag, tracked like a variable
const HER = 'sysvar(9998)';   // the custom state he last put her in, tracked the same way
const PALNO = 1;              // the palette the gallery selects
const HER_LIFE = 1000;        // her life, kept over half by the hook
const DEPTH_MAX = 3;          // switches in a row
const SITUATION_CAP = 72;     // situations explored per grab
const SUSTAIN_MAX = 150;      // a transient effect this short is sustained
const PATIENCE = 600;         // the runtime's default wait for an action
const TIME_STOP = 240;        // a Pause/SuperPause this long stops the scene
const GAUGE_ATOM = /^\s*(f?var)\s*\(\s*(\d+)\s*\)\s*(>=|>)\s*(\d+)\s*$/i;  // a gauge's check: var(25) >= 12000
const DRAIN_ATOM = /^\s*(f?var)\s*\(\s*(\d+)\s*\)\s*(<=|<)\s*(-?\d+)\s*$/i;  // a drain's check: Var(41) <= 0
const SWITCH_TYPES = new Set(['targetstate', 'changestate', 'selfstate', 'varset', 'varadd', 'varrandom', 'hitdef', 'projectile', 'ctrlset']);

// ---- a character's [Info] name, the engine's way -----------------------------
// char.go reads the FIRST [Info] section; a key's first value wins
// (IniSection.Parse, common.go:1002-1022); a `;` ends the line; getText
// strips the enclosing quotes (common.go:1170-1181). displayname defaults to
// name.
function readInfo(dir, def) {
  let text;
  try { text = fs.readFileSync(path.join(dir, def), 'latin1'); } catch (e) { return null; }
  if (text.charCodeAt(0) === 0xef && text.charCodeAt(1) === 0xbb && text.charCodeAt(2) === 0xbf) text = text.slice(3);
  const lines = text.split('\n').map(S.trimGo);
  let info = null;
  for (let i = 0; i < lines.length && !info; i++) {
    const l = lines[i];
    if (!l || l[0] !== '[') continue;
    const sec = S.trimGo(l.split(';')[0]);
    if (sec[sec.length - 1] !== ']') continue;
    let nm = sec.slice(1, sec.indexOf(']'));
    const sp = nm.indexOf(' ');
    if (sp >= 0) nm = nm.slice(0, sp + 1);
    if (nm.toLowerCase() !== 'info') continue;
    info = new Map();
    for (i++; i < lines.length; i++) {
      if (lines[i] && lines[i][0] === '[') break;
      const line = S.trimGo(lines[i].split(';')[0]);
      const ia = line.search(/[= \t]/);
      if (ia <= 0) continue;
      const key = line.slice(0, ia).toLowerCase();
      const eq = line.indexOf('=');
      if (!info.has(key)) info.set(key, eq >= 0 ? S.trimGo(line.slice(eq + 1)) : '');
    }
  }
  const getText = (k) => { if (!info || !info.has(k)) return null; const v = info.get(k); return v.length >= 2 && v[0] === '"' && v[v.length - 1] === '"' ? v.slice(1, -1) : v; };
  const name = getText('name') || '';
  const shown = getText('displayname');
  const asText = (latin1) => {
    const b = Buffer.from(latin1, 'latin1');
    const u = b.toString('utf8');
    return Buffer.from(u, 'utf8').equals(b) ? { text: u, hex: null } : { text: latin1, hex: b.toString('hex') };
  };
  const n = asText(name), d = asText(shown !== null ? shown : name);
  const out = { name: n.text, display: d.text || n.text };
  if (n.hex) out.nameHex = n.hex;
  // An Ikemen GO character says so; one that does not was written for MUGEN.
  const ikv = getText('ikemenversion');
  if (ikv) out.ikemenversion = ikv;
  return out;
}

// The [Files] value of one key of the .def (the first wins), resolved.
function defFileKey(dir, def, key) {
  let text;
  try { text = fs.readFileSync(path.join(dir, def), 'latin1'); } catch (e) { return null; }
  let inFiles = false;
  for (const raw of text.split('\n')) {
    const l = S.trimGo(raw.split(';')[0]);
    if (!l) continue;
    if (l[0] === '[') { inFiles = /^\[\s*files\s*\]/i.test(l); continue; }
    if (!inFiles) continue;
    const m = /^([^=\s]+)\s*=\s*(.*)$/.exec(l);
    if (m && m[1].toLowerCase() === key) {
      const rel = m[2].replace(/"/g, '').replace(/\\/g, '/').trim();
      return rel ? modlib.resolveCI(dir, rel) : null;
    }
  }
  return null;
}

// His power gauge's maximum: [Data] power in the constants file (the engine's
// default is 3000). The runtime keeps him at it, so `power` reads as this.
function readPowerMax(dir, def) {
  const abs = defFileKey(dir, def, 'cns');
  let text = '';
  try { if (abs) text = fs.readFileSync(abs, 'latin1'); } catch (e) { text = ''; }
  let inData = false;
  for (const raw of text.split('\n')) {
    const l = S.trimGo(raw.split(';')[0]);
    if (!l) continue;
    if (l[0] === '[') { inData = /^\[\s*data\s*\]/i.test(l); continue; }
    const m = inData && /^power\s*=\s*(-?\d+)/i.exec(l);
    if (m) return parseInt(m[1], 10);
  }
  return 3000;
}

// ---- the .cmd, as the engine reads it -----------------------------------------
// Every section whose lowercased name starts with "command" is one command;
// its first `name` and `command` win (IniSection.Parse); several sections may
// share a name, and the command fires when any of them does
// (compiler.go:8278-8330). -> Map name -> [command strings]
function readCommands(abs) {
  const out = new Map();
  let text;
  try { text = fs.readFileSync(abs, 'latin1'); } catch (e) { return out; }
  const lines = text.split('\n').map(S.trimGo);
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!l || l[0] !== '[') continue;
    const sec = S.trimGo(l.split(';')[0]);
    if (!sec || sec[sec.length - 1] !== ']') continue;
    let nm = sec.slice(1, sec.indexOf(']'));
    const sp = nm.indexOf(' ');
    if (sp >= 0) nm = nm.slice(0, sp + 1);
    if (!nm.toLowerCase().startsWith('command')) continue;
    const kv = new Map();
    for (i++; i < lines.length; i++) {
      if (lines[i] && lines[i][0] === '[') { i--; break; }
      const line = S.trimGo(lines[i].split(';')[0]);
      const ia = line.search(/[= \t]/);
      if (ia <= 0) continue;
      const key = line.slice(0, ia).toLowerCase();
      const eq = line.indexOf('=');
      if (!kv.has(key)) kv.set(key, eq >= 0 ? S.trimGo(line.slice(eq + 1)) : '');
    }
    const raw = kv.get('name');
    if (!raw || raw.length < 2 || raw[0] !== '"' || raw[raw.length - 1] !== '"') continue;
    const name = raw.slice(1, -1);
    if (!out.has(name)) out.set(name, []);
    out.get(name).push(kv.get('command') || '');
  }
  return out;
}

// ONE INPUT: a single step, a single key, held (`/`) or pressed, directions in
// the .cmd's own F/B (relative to facing). `$` only widens a direction to its
// diagonals. -> { hold|press: key } | null
function singleInput(cmd) {
  const s = String(cmd || '').replace(/\s+/g, '');
  if (!s || /[,+|~]/.test(s)) return null;
  const m = /^([>/$]*)([UDFB]|[abcxyzs])$/.exec(s);
  if (!m) return null;
  const pre = m[1];
  if (/(.).*\1/.test(pre)) return null;
  return pre.includes('/') ? { hold: m[2] } : { press: m[2] };
}
const inputWords = (inp) => (inp.hold ? 'hold ' : 'press ') + (KEY_WORD[inp.hold || inp.press] || (inp.hold || inp.press));
const elementsOf = (def) => { const s = String(def || '').replace(/\s+/g, ''); return s ? s.split(',').filter(Boolean) : []; };
// What a player presses for a command, from its .cmd definition: "hold Up",
// "press x", "press x+y", "hold Down+y", "motion D,DF,F,x". ASCII only.
function commandWords(defs) {
  const list = (defs || []).map((d) => String(d || '').replace(/\s+/g, '')).filter(Boolean);
  if (!list.length) return 'input';
  const one = list.map(singleInput).find(Boolean);
  if (one) return inputWords(one);
  const d = list.slice().sort((a, b) => elementsOf(a).length - elementsOf(b).length || a.length - b.length)[0];
  const els = elementsOf(d);
  const clean = (e) => e.replace(/^[~>/$\d]+/, '').replace(/[$/>]/g, '');
  const key = (e) => { const c = clean(e); return KEY_WORD[c] || c; };
  // A held element (`/B`) is said as a hold: Kur0maru's `/B,z` is "hold
  // Back+z" (hold Back while pressing z), never the motion "B,z".
  const held = (e) => { const m = /^[~>/$\d]+/.exec(e); return !!m && m[0].includes('/') && !m[0].includes('~'); };
  let out;
  if (els.length === 1) out = (els[0].includes('/') ? 'hold ' : 'press ') + els[0].split('+').map(key).join('+');
  else if (els.length === 2 && held(els[0]) && /^[abcxyzs](\+[abcxyzs])*$/.test(els[1])) out = 'hold ' + key(els[0]) + '+' + els[1];
  else out = 'motion ' + els.map((e) => (held(e) ? 'hold ' + key(e) : clean(e))).join(',');
  return out.replace(/[^\x20-\x7e]/g, '?');
}
// A command a player can enter. The AI's long "commands" (AI_1 ... AI31,
// cpu1 ... cpu50: 8 to 19 elements no hand plays) are not.
function isPlayable(name, defs) {
  if (/^(ai|cpu)[\s_-]*\d/i.test(name)) return false;
  return (defs || []).some((d) => { const n = elementsOf(d).length; return n >= 1 && n <= 7; });
}
// A held command: some definition is one element with `/` (`/$U`, `/y`).
const isHoldDef = (defs) => (defs || []).some((d) => { const e = elementsOf(d); return e.length === 1 && e[0].includes('/') && !e[0].includes('~'); });
function commandInfo(name, defs) {
  const words = commandWords(defs);
  const one = (defs || []).map(singleInput).find(Boolean);
  const hold = isHoldDef(defs);
  const k = one ? (one.hold || one.press) : null;
  const multi = (defs || []).every((d) => elementsOf(d).length > 1);
  const rank = one ? INPUT_ORDER.indexOf(k) * 4 + (one.hold ? 0 : 1) : (multi ? 200 : 100) + Math.min(...(defs || ['']).map((d) => elementsOf(d).length));
  return { name, defs, words, hold, playable: isPlayable(name, defs), rank, key: k };
}
// COMMAND ALIASES: two commands a player's one key makes true together
// (dragon_futa2's holdfwd and holdfwd2, both `/$F`). The engine's
// AssertCommand asserts only the command it names (input.go CommandList.
// Assert), so the gallery asserts every alias with it, and the walk reads a
// command as on when an alias of it is. A command's own definition is the
// one its words name (its first single input, else its fewest elements);
// its aliases are every other PLAYABLE command with a definition equal to it,
// whitespace removed (case kept: B is Back, b a button). -> Map name ->
// [aliases], symmetric; only commands that have one.
function commandAliases(commands) {
  const out = new Map();
  const norm = (d) => String(d || '').replace(/\s+/g, '');
  const own = (defs) => {
    const list = (defs || []).map(norm).filter(Boolean);
    if (!list.length) return null;
    const one = list.find((d) => singleInput(d));
    return one || list.slice().sort((a, b) => elementsOf(a).length - elementsOf(b).length || a.length - b.length)[0];
  };
  const names = [...commands.keys()].filter((n) => isPlayable(n, commands.get(n)));
  const add = (a, b) => { if (!out.has(a)) out.set(a, []); if (!out.get(a).includes(b)) out.get(a).push(b); };
  for (const n of names) {
    const d = own(commands.get(n));
    if (!d) continue;
    for (const m of names) if (m !== n && (commands.get(m) || []).map(norm).includes(d)) { add(n, m); add(m, n); }
  }
  for (const v of out.values()) v.sort();
  return out;
}
// A command read as on: asserted, or an alias of it asserted.
const cmdOn = (inputs, name, more) => inputs.has(name) || !!(more && more.cmdAlias && more.cmdAlias.has(name) && more.cmdAlias.get(name).some((n) => inputs.has(n)));

// ---- the .air's timing ----------------------------------------------------------
// Each action's length in ticks (the sum of its frame times), -1 when a frame
// lasts forever: the engine's totaltime is -1 then and AnimTime never reaches
// 0 (anim.go:432-433). The first definition of an action wins.
function readAirTimes(abs) {
  const out = new Map();
  let text;
  try { text = fs.readFileSync(abs, 'latin1'); } catch (e) { return out; }
  let cur = null, sum = 0, inf = false;
  const flush = () => { if (cur !== null && !out.has(cur)) out.set(cur, inf ? -1 : sum); };
  for (const raw of text.split(/\r?\n/)) {
    const l = raw.replace(/;.*$/, '').trim();
    const b = /^\[\s*begin\s+action\s+(-?\d+)\s*\]/i.exec(l);
    if (b) { flush(); cur = +b[1]; sum = 0; inf = false; continue; }
    if (cur === null || !l || l[0] === '[' || /^(clsn|loopstart|interpolate|axis)/i.test(l)) continue;
    const f = l.split(',').map((x) => x.trim());
    if (f.length < 5 || !/^-?\d+$/.test(f[0]) || !/^-?\d+$/.test(f[4])) continue;
    const t = +f[4];
    if (t === -1) inf = true; else if (t > 0) sum += t;
  }
  flush();
  return out;
}
// Each action's frames in play order with their times: { key, t }, key
// 'group,index' or null for a blank (group -1). One pass of the action; a
// frame that lasts forever (-1) counts 60 ticks, a 0 counts 1. The first
// definition of an action wins, as the engine keeps it.
function readAirTicks(abs) {
  const out = new Map();
  let text;
  try { text = abs ? fs.readFileSync(abs, 'latin1') : ''; } catch (e) { return out; }
  let cur = null;
  for (const raw of text.split(/\r?\n/)) {
    const l = raw.replace(/;.*$/, '').trim();
    const b = /^\[\s*begin\s+action\s+(-?\d+)\s*\]/i.exec(l);
    if (b) { cur = +b[1]; if (out.has(cur)) cur = null; else out.set(cur, []); continue; }
    if (cur === null || !l || l[0] === '[' || /^(clsn|loopstart|interpolate|axis)/i.test(l)) continue;
    const f = l.split(',').map((x) => x.trim());
    if (f.length < 5 || !/^-?\d+$/.test(f[0]) || !/^-?\d+$/.test(f[1]) || !/^-?\d+$/.test(f[4])) continue;
    const t = +f[4];
    out.get(cur).push({ key: +f[0] >= 0 ? (+f[0]) + ',' + (+f[1]) : null, t: t < 0 ? 60 : Math.max(1, t) });
  }
  return out;
}
// The share of an action's time (percent, rounded) whose sprite she has: a
// PARTIAL scene counted in ticks, not frames (Brian's 6219 on Kur0maru draws
// 17233, 4 of its 6 frames his .sff has, 43% of its time). Blanks are time
// she is not drawn. Null when the action has no timed frame.
function drawnShare(frames, has) {
  if (!frames || !frames.length) return null;
  let tot = 0, vis = 0;
  for (const x of frames) { tot += x.t; if (x.key !== null && has(x.key)) vis += x.t; }
  return tot ? Math.round((100 * vis) / tot) : null;
}

// ---- walking his states the way the runtime drives them -----------------------
// The pair the runtime sets up: the giver is a human player (AILevel 0), the
// round is running (RoundState 2), both are alive, palette 1, his power kept
// at its maximum, and no input reaches him but the command it asserts. Those
// atoms are rewritten to numbers before the three-valued evaluator reads the
// trigger; a command becomes 1 or 0 by whether it is asserted (or stays
// unknown when `inputs` is null). An atom redirected to someone else
// (`enemy,command`, `enemynear(0), AILevel`) is hers and stays unknown.
//   more.power          `power` and `powermax` read as this
//   more.herLife        her life (`enemy,life`, `p2life`) reads as this: the
//                       hook refills it under half and no KO comes
//   more.missingHelpers (id) -> true when no helper of that id can exist:
//                       `numhelper(id)` reads 0
//   more.ctrl           `ctrl` reads his tracked ctrl flag
//   more.helperVars     a helper's variables read as 0
//   more.animRestart    `animtime` is never 0: the state re-applies a
//                       ChangeAnim every tick and the engine restarts the
//                       animation each time (char.go:4656-4673)
//   more.herState       her state as he reads it (`target,StateNo`,
//                       `enemynear,StateNo`, `p2stateno`) is the tracked
//                       custom state he last put her in (HER): Brian's grope
//                       stage leaves by itself only when she is NOT in the
//                       6200 his grab just put her in
// Her KO atoms (`target,alive`, `enemy,alive = 0`) read as alive: the hook
// sets globalNoKo and refills her life, so a branch that waits for her KO
// never runs (82100's 5150, 63405's 63503).
//   more.gate           a GATE, a prototype mode's walker option (makeWalker
//                       opts.gate; gallerymodes/): { round, over, herAlive,
//                       herLife } read instead of the running round's -
//                       `roundstate` as gate.round (left unknown for 'any'),
//                       MatchOver, Win and WinKO as 1 when gate.over (Lose
//                       stays 0), her alive and her life as gate.herAlive and
//                       gate.herLife. Each one left out reads as above; with
//                       no gate nothing here changes.
const redirected = (str, off) => /,\s*$/.test(str.slice(0, off));
const HER_STATE_ATOM = /\b(?:target|enemynear|enemy|p2)(?:\s*\(\s*\d*\s*\))?\s*,\s*stateno\b|\bp2stateno\b/gi;
function rewriteAtoms(expr, inputs, stateNo, prev, more) {
  let s = String(expr);
  if (more && more.herState) s = s.replace(HER_STATE_ATOM, (all, off, str) => (/[a-z0-9_)]\s*,\s*$/i.test(str.slice(0, off)) ? all : HER));
  // The state he came from, when the walk knows it: a grab the runtime forces
  // is entered from standing (0).
  if (Number.isFinite(prev)) s = s.replace(/\bprevstateno\b/gi, (all, off, str) => (redirected(str, off) ? all : '(' + prev + ')'));
  // (A summon's helper reads his commands as `root,command` or
  // `parent,command`: in its walk, the commands asserted on him.)
  if (more && more.rootCmds && inputs !== null) s = s.replace(/\b(?:root|parent)\s*,\s*command\s*(!=|=)\s*"([^"]*)"/gi, (all, op, name) => ((op === '=') === cmdOn(inputs, name, more) ? '1' : '0'));
  s = s.replace(/\b((?:self)?command)(\s*)(!=|=)(\s*)"([^"]*)"/gi, (all, kw, a, op, b, name, off, str) => {
    if (inputs === null || redirected(str, off)) return all;
    // (An alias asserted with it: COMMAND ALIASES.)
    const on = cmdOn(inputs, name, more);
    return (op === '=' ? on : !on) ? '1' : '0';
  });
  s = s.replace(/\bailevel\b/gi, (all, off, str) => (redirected(str, off) ? all : '0'));
  // (more.gate: the round a prototype mode's walk reads instead.)
  const gate = more && more.gate && typeof more.gate === 'object' ? more.gate : null;
  const round = gate && (Number.isFinite(gate.round) || gate.round === 'any') ? gate.round : 2;
  s = s.replace(/\broundstate\b/gi, (all, off, str) => (redirected(str, off) || round === 'any' ? all : String(round)));
  // (Nobody has won while the round runs: Murakami's -2 AI flag `var(51)`
  // set on `Win = 1` never fires. Text in quotes is a name, never an atom.)
  const won = gate && gate.over ? /^(?:matchover|winko|win)$/i : null;
  s = s.split('"').map((part, i) => (i % 2 ? part : part.replace(/\b(?:matchover|winko|wintime|winperfect|win|loseko|losetime|lose)\b/gi, (all, off, str) => (redirected(str, off) ? all : won && won.test(all) ? '1' : '0')))).join('"');
  s = s.replace(/\balive\b/gi, (all, off, str) => (redirected(str, off) ? all : '1'));
  if (Number.isFinite(stateNo) && stateNo >= 0) s = s.replace(/\bstateno\b/gi, (all, off, str) => (redirected(str, off) || /prev$/i.test(str.slice(0, off)) ? all : '(' + stateNo + ')'));
  if (more) {
    const herLife = gate && Number.isFinite(gate.herLife) ? gate.herLife : more.herLife;
    const herAlive = gate && (gate.herAlive === 0 || gate.herAlive === 1) ? gate.herAlive : 1;
    if (Number.isFinite(herLife)) {
      s = s.replace(/\b(?:enemy|enemynear|p2|target)(?:\s*\(\s*\d*\s*\))?\s*,\s*alive\b/gi, '(' + herAlive + ')');
      s = s.replace(/\b(?:enemy|enemynear|p2|target)(?:\s*\(\s*\d*\s*\))?\s*,\s*life\b(?!max)/gi, '(' + herLife + ')');
      s = s.replace(/\bp2life\b(?!max)/gi, (all, off, str) => (redirected(str, off) ? all : '(' + herLife + ')'));
    }
    if (Number.isFinite(more.power)) {
      s = s.replace(/\bpowermax\b/gi, (all, off, str) => (redirected(str, off) ? all : '(' + more.power + ')'));
      s = s.replace(/\bpower\b/gi, (all, off, str) => (redirected(str, off) ? all : '(' + more.power + ')'));
    }
    // A helper's own variables (`Helper(26357+ID),var(59)`, Minotaur's AI
    // helper's flag; `helper(1219),var(45)`, kuromaru's escape counter of HER
    // presses) keep their round-start 0 for the gallery's human pair.
    if (more.helperVars) s = s.replace(/\bhelper\s*\((?:[^()]|\([^()]*\))*\)\s*,\s*f?var\s*\(\s*\d+\s*\)/gi, (all, off, str) => (redirected(str, off) ? all : '(0)'));
    if (Number.isFinite(more.palno)) s = s.replace(/\bpalno\b/gi, (all, off, str) => (redirected(str, off) ? all : '(' + more.palno + ')'));
    if (typeof more.missingHelpers === 'function') s = s.replace(/\bnumhelper\s*\(\s*(\d+)\s*\)/gi, (all, id, off, str) => (redirected(str, off) || !more.missingHelpers(+id) ? all : '(0)'));
    if (more.ctrl) s = s.replace(/\bctrl\b/gi, (all, off, str) => (redirected(str, off) ? all : CTRL));
    if (more.animRestart) s = s.replace(/\banimtime\b/gi, (all, off, str) => (redirected(str, off) ? all : '(-1)'));
  }
  return s;
}
const inputsKey = (inputs) => (inputs === null ? '*' : [...inputs].sort().join('\u0001'));
// The un-redirected commands a trigger set asks for with `=` (and with `!=`
// too when `neg`: a command that makes a controller false is a switch).
const cmdsMemo = new WeakMap();
function commandsIn(trig, neg) {
  let per = cmdsMemo.get(trig);
  if (per && per[neg ? 1 : 0]) return per[neg ? 1 : 0];
  const out = commandsInFresh(trig, neg);
  if (!per) { per = []; cmdsMemo.set(trig, per); }
  per[neg ? 1 : 0] = out;
  return out;
}
function commandsInFresh(trig, neg) {
  const out = [];
  const re = neg ? /\b(?:self)?command\s*!?=\s*"([^"]*)"/gi : /\b(?:self)?command\s*=\s*"([^"]*)"/gi;
  const scan = (e) => {
    const str = String(e);
    for (const m of str.matchAll(re)) {
      if (redirected(str, m.index)) continue;
      if (!out.includes(m[1])) out.push(m[1]);
    }
  };
  for (const e of trig.all) scan(e);
  for (const g of trig.groups) for (const e of g) scan(e);
  return out;
}

// The variables he carries are tracked as SETS of values, one set per
// variable (absent = unknown), joined where two paths meet.
const SET_CAP = 8;
const keyMemo = new WeakMap();
const keyOf = (A) => {
  let k = keyMemo.get(A);
  if (k === undefined) { k = Object.keys(A).sort().map((n) => n + '=' + A[n].join('/')).join(','); keyMemo.set(A, k); }
  return k;
};
const joinA = (a, b) => {
  const out = {};
  for (const k of Object.keys(a)) {
    if (!b[k]) continue;
    const u = [...new Set([...a[k], ...b[k]])].sort((x, y) => x - y);
    if (u.length <= SET_CAP) out[k] = u;
  }
  return out;
};
const trigText = (t) => [...t.all.map((e) => 'A:' + e), ...t.groups.map((g, i) => 'G' + i + ':' + g.join('&&'))].map((s) => s.toLowerCase().replace(/\s+/g, '')).sort().join('|');
const CTRL_WORD = /\bctrl\b/i;
const TIMEISH = /\b(time|animtime|animelem|animelemtime|animelemno|anim|movehit|movecontact|movereversed|hitcount|uniqhitcount|gametime|random|numtarget|numexplod|numprojid|p2\w*|enemy\w*|target\w*)\b/i;

// opts: { victimHas: Set (her actions), helperIds: Set (every Helper id in
//   his files), power, frozen: { name: value } (setup variables: kept at the
//   value, never written), offCtrls: Set (controllers the setup keeps from
//   firing), airTimes: Map (his action lengths), cmdAlias: Map (COMMAND
//   ALIASES: a command reads as on when an alias of it is asserted), gate: { round, over,
//   herAlive, herLife } (a prototype mode's view of the round: rewriteAtoms'
//   more.gate; a gated walker keeps its own caches, never a shared trigCache,
//   memo or sharedFlows, since every answer depends on the gate),
//   parentVars: Map ('var(N)' -> value: a summon's helper walked with his
//   variables pinned, as a step's setup holds them - `Parent,var(1)` and
//   `Root,var(1)` read the value, every other variable of his stays
//   unknown; such a walker keeps its own memo and sharedFlows) }
function makeWalker(an, opts) {
  opts = opts || {};
  const states = an.states;
  const victimHas = opts.victimHas instanceof Set ? opts.victimHas : null;
  const helperIds = opts.helperIds instanceof Set ? opts.helperIds : null;
  const frozen = opts.frozen || {};
  const frozenNames = Object.keys(frozen);
  const offCtrls = opts.offCtrls instanceof Set ? opts.offCtrls : new Set();
  const onCtrls = opts.onCtrls instanceof Set ? opts.onCtrls : new Set();
  const airTimes = opts.airTimes instanceof Map ? opts.airTimes : new Map();
  const relevantVars = opts.relevantVars instanceof Set ? opts.relevantVars : null;
  const boolValues = !!opts.boolValues;
  // Which helpers can exist: every one his files spawn, unless narrowed per
  // grab (a forced grab never spawns the horse 7000 that 7102's hit waits for).
  let present = null, presentKey = '';
  const missing = (id) => (present ? !present.has(id) : (helperIds ? !helperIds.has(id) : false));
  const more = { power: opts.power, palno: PALNO, missingHelpers: missing, ctrl: true, herLife: HER_LIFE, helperVars: true, herState: !!opts.herState, rootCmds: !!opts.rootCmds };
  if (opts.cmdAlias instanceof Map && opts.cmdAlias.size) more.cmdAlias = opts.cmdAlias;
  const gate = opts.gate && typeof opts.gate === 'object' ? opts.gate : null;
  if (gate) more.gate = gate;
  const moreRestart = Object.assign({}, more, { animRestart: true });
  // HER: a custom state she stays in until he moves her (no ChangeState or
  // SelfState of her own) is where she is while his states run; one she
  // leaves by herself is not known after it.
  const herStay = new Map();
  const herStable = (C) => {
    if (!herStay.has(C)) { const s = states.get(C); herStay.set(C, !!s && !s.sctrls.some((sc) => sc.type === 'changestate' || sc.type === 'selfstate')); }
    return herStay.get(C);
  };
  const putHer = (A, list, sure) => {
    if (!more.herState) return A;
    const drop = () => { if (!Object.prototype.hasOwnProperty.call(A, HER)) return A; const o = Object.assign({}, A); delete o[HER]; return o; };
    if (!list.length || !list.every(herStable)) return drop();
    const vals = sure ? [...new Set(list)] : (A[HER] ? [...new Set([...A[HER], ...list])] : null);
    if (!vals || vals.length > SET_CAP) return drop();
    vals.sort((a, b) => a - b);
    if (A[HER] && A[HER].length === vals.length && A[HER].every((v, i) => v === vals[i])) return A;
    return Object.assign({}, A, { [HER]: vals });
  };
  const missingRedirect = (name, id, hasId) => name === 'helper' && hasId && Number.isFinite(id) && missing(id);
  // (opts.parentVars: a helper's walk with its parent's variables pinned -
  // `Parent,var(1)` / `Root,var(1)` read the pinned value, anything else of
  // theirs stays unknown.)
  const parentVars = opts.parentVars instanceof Map && opts.parentVars.size ? opts.parentVars : null;
  const parentRead = parentVars ? (name, id, v) => {
    const who = String(name).toLowerCase();
    return (who === 'parent' || who === 'root') && parentVars.has(v) ? parentVars.get(v) : undefined;
  } : null;
  const ctxOf = (c) => { const x = Object.assign({ isHelper: false }, c); if (victimHas) x.victimHas = victimHas; x.missingRedirect = missingRedirect; if (parentRead) x.redirVar = parentRead; return x; };
  const custom = new Set(an.scenes.keys());
  const domains = an.domains;
  // A variable every write of which is a value with no variable in it
  // (`fvar(36) = random%20`) is always one of those values or its round-
  // start 0: unknown, it is still enumerated over them.
  const complete = opts.complete || {};
  const dom = (v) => (complete[v] ? complete[v] : domains[v] && domains[v].length ? domains[v] : Array.from({ length: 16 }, (_, i) => i));
  const withFrozen = (A) => {
    if (!frozenNames.length || frozenNames.every((k) => A[k] && A[k].length === 1 && A[k][0] === frozen[k])) return A;
    const out = Object.assign({}, A);
    for (const k of frozenNames) out[k] = [frozen[k]];
    return out;
  };
  const varsCache = new Map();
  const varsIn = (e) => { if (!varsCache.has(e)) varsCache.set(e, X.varsOf(e)); return varsCache.get(e); };
  const trigCache = opts.trigCache instanceof WeakMap && !gate ? opts.trigCache : new WeakMap();
  const trigOf = (sc, inputs, no, prev, restart) => {
    let per = trigCache.get(sc);
    if (!per) { per = new Map(); trigCache.set(sc, per); }
    const k = inputsKey(inputs) + '#' + no + (Number.isFinite(prev) ? '<' + prev : '') + (restart ? '!' : '') + presentKey;
    let t = per.get(k);
    if (!t) {
      const rw = (e) => rewriteAtoms(e, inputs, no, prev, restart ? moreRestart : more);
      t = { all: sc.trig.all.map(rw), groups: sc.trig.groups.map((g) => g.map(rw)) };
      t.vars = [...new Set([...t.all, ...t.groups.flat()].flatMap(varsIn))];
      t.text = trigText(sc.trig);
      t.random = [...t.all, ...t.groups.flat()].some((e) => { try { return X.usesRandom(e); } catch (err) { return false; } });
      t.probes = [...new Set([...t.all, ...t.groups.flat()].flatMap((e) => [...String(e).matchAll(PROBE_ANY)].map((m) => +m[1])))];
      t.key = k;
      per.set(k, t);
    }
    return t;
  };
  // A trigger set under one assignment; with `random` in it, over random's
  // spread - DongHwan's auto counter `var(37) = [54-random%20, ...]` is false
  // for every draw while var(37) is 0, not unknown.
  const evalSet = (t, c) => {
    const ctx = ctxOf(c);
    const once = X.evalTriggerSet(t, ctx);
    // An answer with random unknown does not depend on it.
    if (!t.random || once !== null) return once;
    let v;
    for (const r of X.RANDOM_SAMPLES) {
      ctx.random = r;
      const w = X.evalTriggerSet(t, ctx);
      if (w === null) return null;
      if (v === undefined) v = w; else if (v !== w) return null;
    }
    return v;
  };
  // Every combination of the listed values of `vars` (a variable with none
  // is left out and reads as unknown). null past 256.
  const combos = (vars, A) => {
    const keys = [], sets = [];
    let size = 1;
    for (const v of vars) {
      const set = A[v] || complete[v];
      if (!set) continue;
      keys.push(v); sets.push(set);
      size *= set.length;
      if (size > 256) return null;
    }
    const out = new Array(size);
    for (let i = 0; i < size; i++) {
      const c = {};
      let r = i;
      for (let j = keys.length - 1; j >= 0; j--) { const s = sets[j]; c[keys[j]] = s[r % s.length]; r = (r - (r % s.length)) / s.length; }
      out[i] = c;
    }
    return out;
  };
  // true / false / null over every combination. `forced`: a Set of
  // controllers known to fire this tick (a switch's own). `tick0`: the
  // state's first tick, when Time is 0.
  // Results by the values of the variables a trigger reads (and her
  // answers to the probes in it), shared by the walks of one giver.
  const memo = opts.memo instanceof WeakMap && !gate && !parentVars ? opts.memo : new WeakMap();
  // Evaluations that asked her about her art: a walk that made none is the
  // same for every partner, and the giver's other walks reuse it.
  let touches = 0;
  const sharedFlows = opts.sharedFlows instanceof Map && !gate && !parentVars ? opts.sharedFlows : null;
  const trig = (sc, A, inputs, no, forced, tick0, prev, restart) => {
    if (offCtrls.has(sc)) return false;
    if (onCtrls.has(sc)) return true;
    if (forced && typeof forced.has === 'function' && forced.has(sc)) return forcedGate(sc, A, inputs, no, prev, restart);
    const t = trigOf(sc, inputs, no, prev, restart);
    if (typeof forced === 'string' && t.text === forced) return true;
    if (t.probes.length) touches++;
    let per = memo.get(sc);
    if (!per) { per = new Map(); memo.set(sc, per); }
    let mk = t.key + '|' + (tick0 ? '0' : '') + '|';
    for (const v of t.vars) { const set = A[v] || complete[v]; mk += (set ? set.join('/') : '?') + ','; }
    if (t.probes.length) mk += '|' + (victimHas ? t.probes.map((n) => (victimHas.has(n) ? 1 : 0)).join('') : '?');
    if (per.has(mk)) return per.get(mk);
    let res;
    const cs = combos(t.vars, A);
    if (!cs) res = null;
    else {
      let sawT = false, sawF = false;
      res = undefined;
      for (const c of cs) {
        if (tick0) c.time = 0;
        const v = evalSet(t, c);
        if (v === null) { res = null; break; }
        if (v) sawT = true; else sawF = true;
        if (sawT && sawF) { res = null; break; }
      }
      if (res === undefined) res = sawT;
    }
    if (per.size > 4000) per.clear();
    per.set(mk, res);
    return res;
  };
  // A switch's own ChangeState/TargetState fires with its command, but its
  // triggerall still asks what the scene's history left in a variable the
  // walk does not know here: kuromaru_plus's c in foreplay goes to the
  // virginity break 6008 on `var(43) > 0` and to the insertion 6006 on
  // `var(43) <= 0` - the first Bao scene of a round breaks, every later one
  // inserts. Over the values his files give that variable, the gate may go
  // either way (both are the switch's), or never (neither is).
  const gateMemo = new WeakMap();
  const forcedGate = (sc, A, inputs, no, prev, restart) => {
    if ((sc.type !== 'changestate' && sc.type !== 'targetstate') || !sc.trig.all.length) return true;
    let per = gateMemo.get(sc);
    if (!per) {
      const rw = sc.trig.all.map((e) => rewriteAtoms(e, inputs, no, prev, restart ? moreRestart : more).replace(/\b(animtime|animelem|time|statetime)\s*(=|>=|<=|>|<)\s*-?\d+(\s*,\s*(=|>=|<=|>|<)?\s*-?\d+)?/gi, '1'));
      per = { rw, vars: [...new Set(rw.flatMap(varsIn))].filter((v) => VARNAME.test(v)), memo: new Map() };
      gateMemo.set(sc, per);
    }
    const open = per.vars.filter((v) => !A[v] && !complete[v]);
    if (!open.length) return true;
    const mk = per.vars.map((v) => (A[v] ? A[v].join('/') : complete[v] ? 'c' : '?')).join(',');
    if (per.memo.has(mk)) return per.memo.get(mk);
    const keys = [...per.vars];
    // (and either side of each number the gate compares it with: var(43) is
    // set to 100 by a status helper his own states do not list)
    const around = (v) => {
      const esc = v.replace(/[()]/g, (ch) => '\\' + ch);
      const out = new Set(dom(v));
      for (const e of per.rw) for (const m of String(e).matchAll(new RegExp('\\b' + esc + '\\s*(?:>=|<=|!=|=|>|<)\\s*(-?\\d+)', 'gi'))) for (const d of [-1, 0, 1]) out.add(+m[1] + d);
      return [...out];
    };
    const sets = keys.map((v) => A[v] || complete[v] || around(v));
    let size = sets.reduce((n, s2) => n * s2.length, 1);
    let res = true;
    if (size <= 256) {
      let sawT = false, sawF = false, unk = false;
      for (let i = 0; i < size; i++) {
        const c = {};
        let r = i;
        for (let j = keys.length - 1; j >= 0; j--) { const s2 = sets[j]; c[keys[j]] = s2[r % s2.length]; r = (r - (r % s2.length)) / s2.length; }
        const v = evalSet({ all: per.rw, groups: [], random: false }, c);
        if (v === true) sawT = true; else if (v === false) sawF = true; else unk = true;
      }
      res = sawF && !sawT && !unk ? false : sawF ? null : true;
    }
    per.memo.set(mk, res);
    return res;
  };
  // Only the trigger groups that name a command (with triggerall): does
  // asserting it make the controller fire through them? true / false / null.
  const byCommand = (sc, A, inputs, no, tick0, k) => {
    const t = trigOf(sc, inputs, no);
    const needle = new RegExp('\\bcommand\\s*=\\s*"' + k.replace(/[.*+?^${}()|[\]\\]/g, (m) => '\\' + m) + '"', 'i');
    const idx = sc.trig.groups.map((g, i) => (g.some((e) => needle.test(String(e))) ? i : -1)).filter((i) => i >= 0);
    const sub = idx.length ? { all: t.all, groups: idx.map((i) => t.groups[i]), vars: t.vars, random: t.random } : t;
    const cs = combos(t.vars, A);
    if (!cs) return null;
    let sawT = false, sawF = false;
    for (const c of cs) {
      if (tick0) c.time = 0;
      const v = evalSet(sub, c);
      if (v === null) return null;
      if (v) sawT = true; else sawF = true;
      if (sawT && sawF) return null;
    }
    return sawT;
  };
  const narrow = (sc, A, inputs, no) => {
    const t = trigOf(sc, inputs, no);
    const cs = combos(t.vars, A);
    if (!cs) return A;
    const keep = cs.filter((c) => evalSet(t, c) !== false);
    if (!keep.length) return null;
    const out = Object.assign({}, A);
    for (const v of t.vars) if (A[v]) out[v] = [...new Set(keep.map((c) => c[v]))].sort((x, y) => x - y);
    return out;
  };
  // Every value an expression takes: the known variables' sets, the unknown
  // ones over the domains the file assigns them, `random` sampled.
  const valCache = new Map();
  const values = (rawIn, A, no, prev) => {
    if (rawIn === undefined || rawIn === null) return [];
    const n = S.lit(rawIn);
    if (n !== null) return [n];
    const raw = rewriteAtoms(rawIn, null, no, prev, more);
    if (/animexist/i.test(raw)) touches++;
    const vars = varsIn(raw);
    const ck = raw + '|' + presentKey + '|' + vars.map((v) => v + '=' + (A[v] ? A[v].join('/') : '?')).join(',');
    if (valCache.has(ck)) return valCache.get(ck);
    const out = new Set();
    if (X.parses(raw)) {
      const random = X.usesRandom(raw);
      let total = 1;
      for (const v of vars) total *= (A[v] || dom(v)).length;
      if (vars.length <= 6 && total <= 4096) {
        const ctx = ctxOf({});
        const rec = (i) => {
          if (i === vars.length) {
            for (const v0 of (random ? X.evalRandom(raw, ctx) : [X.evalExpr(raw, ctx)])) {
              // (boolValues: a comparison's answer is the 1 or 0 the engine
              // stores - `var(57) = Target,SelfAnimExist(22001)`.)
              const v = boolValues && typeof v0 === 'boolean' ? +v0 : v0;
              if (Number.isFinite(v)) out.add(Math.trunc(v));
            }
            return;
          }
          for (const x of (A[vars[i]] || dom(vars[i]))) { ctx[vars[i]] = x; rec(i + 1); }
          delete ctx[vars[i]];
        };
        rec(0);
      }
      if (!out.size) for (const v of X.leavesOf(raw)) out.add(v);
    }
    const res = [...out];
    if (valCache.size > 50000) valCache.clear();
    valCache.set(ck, res);
    return res;
  };
  // The same, each value with the assignment narrowed to the variables'
  // values that give it: 6000+1+var(39) is 6002 only when var(39) = 1.
  // Cached as the partition (each value with the narrowed sets), rebuilt on
  // the caller's assignment.
  const vaCache = new Map();
  const valuesA = (rawIn, A, no, prev) => {
    const n = S.lit(rawIn);
    if (n !== null) return [{ v: n, A }];
    if (rawIn === undefined || rawIn === null) return [];
    const raw = rewriteAtoms(rawIn, null, no, prev, more);
    const vars = varsIn(raw);
    const ck = raw + '|' + presentKey + '|' + vars.map((v) => (A[v] ? A[v].join('/') : '?')).join(',');
    let part = vaCache.get(ck);
    if (!part) {
      part = compute();
      if (vaCache.size > 20000) vaCache.clear();
      vaCache.set(ck, part);
    }
    return part.map((p) => ({ v: p.v, A: p.sets ? Object.assign({}, A, p.sets) : A }));
    function compute() {
      const known = vars.filter((v) => (A[v] && A[v].length > 1) || (!A[v] && complete[v]));
      const plain = () => values(rawIn, A, no, prev).map((v) => ({ v, sets: null }));
      if (!known.length) return plain();
      const cs = combos(known, A);
      if (!cs) return plain();
      const byV = new Map();
      for (const c of cs) {
        const A1 = Object.assign({}, A);
        for (const k of known) A1[k] = [c[k]];
        for (const v of values(rawIn, A1, no, prev)) { if (!byV.has(v)) byV.set(v, []); byV.get(v).push(c); }
        if (byV.size > 64) return plain();
      }
      return [...byV].map(([v, list]) => {
        const sets = {};
        for (const k of known) sets[k] = [...new Set(list.map((c) => c[k]))].sort((x, y) => x - y);
        return { v, sets };
      });
    }
  };
  // A VarSet-family controller's writes: [[name, raw value]] (both forms).
  const writesOf = (sc) => {
    const out = [];
    const v = S.lit(sc.params.get('v')), fv = S.lit(sc.params.get('fv'));
    if (v !== null) out.push(['var(' + v + ')', sc.params.get('value')]);
    if (fv !== null) out.push(['fvar(' + fv + ')', sc.params.get('value')]);
    for (const [k, val] of sc.params) { const m = /^(var|fvar|sysvar|sysfvar)\((\d+)\)$/.exec(k); if (m) out.push([m[1] + '(' + m[2] + ')', val]); }
    return out;
  };
  const write = (A, type, name, raw, tv, no) => {
    if (Object.prototype.hasOwnProperty.call(frozen, name)) return A;
    let vals = null;
    if (type === 'varset') vals = values(raw, A, no);
    else if (type === 'varadd' && A[name]) { const d = values(raw, A, no); if (d.length) vals = [...new Set(A[name].flatMap((x) => d.map((y) => x + y)))]; }
    const unset = () => { if (!A[name]) return A; const out = Object.assign({}, A); delete out[name]; return out; };
    if (!vals || !vals.length || vals.length > SET_CAP) return unset();
    if (tv === null) { if (!A[name]) return A; vals = [...new Set([...A[name], ...vals])]; }
    if (vals.length > SET_CAP) return unset();
    vals.sort((x, y) => x - y);
    // The same values again (a hub's VarSet every tick): nothing to copy.
    const old = A[name];
    if (old && old.length === vals.length && old.every((x, i) => x === vals[i])) return A;
    const out = Object.assign({}, A);
    out[name] = vals;
    return out;
  };
  // `fvar(23) = 1` behind `trigger1 = fvar(23) != 1` (Brian's 7001, every
  // tick): whether it fires or not, the variable is 1 after it. True when the
  // trigger is false with the variable at the value and true at every other
  // value its domain gives it.
  const idemMemo = new WeakMap();
  const idempotent = (sc, A, inputs, no, tick0, prev, restart, name, v) => {
    const t = trigOf(sc, inputs, no, prev, restart);
    let per = idemMemo.get(sc);
    if (!per) { per = new Map(); idemMemo.set(sc, per); }
    let mk = t.key + '|' + (tick0 ? 1 : 0) + '|' + name + '=' + v + '|';
    for (const x of t.vars) if (x !== name) { const set = A[x] || complete[x]; mk += (set ? set.join('/') : '?') + ','; }
    if (t.probes.length && victimHas) mk += '|' + t.probes.map((n) => (victimHas.has(n) ? 1 : 0)).join('');
    if (per.has(mk)) return per.get(mk);
    const res = idempotentFresh(sc, A, inputs, no, tick0, prev, restart, name, v);
    if (per.size > 2000) per.clear();
    per.set(mk, res);
    return res;
  };
  const idempotentFresh = (sc, A, inputs, no, tick0, prev, restart, name, v) => {
    const at = Object.assign({}, A, { [name]: [v] });
    if (trig(sc, at, inputs, no, null, tick0, prev, restart) !== false) return false;
    const others = dom(name).filter((x) => x !== v);
    if (!others.length) return false;
    return others.every((x) => trig(sc, Object.assign({}, A, { [name]: [x] }), inputs, no, null, tick0, prev, restart) === true);
  };
  // A state that re-applies a ChangeAnim every tick (a trigger with no time
  // in it, on the variables that pick the pose) never reaches AnimTime 0:
  // the engine installs a fresh copy of the animation on every ChangeAnim
  // (char.go:4656-4673), so DongHwan's, Brian's and kuromaru's hub exits on
  // `AnimTime = 0` never fire. The pose variables are often only partly
  // known here (Brian's copies his speed into fvar(6) every tick), so one
  // such ChangeAnim that may fire is enough.
  const restarts = (no, A, inputs) => {
    const s = states.get(no);
    if (!s) return false;
    for (const sc of s.sctrls) {
      if (sc.type !== 'changeanim') continue;
      const txt = [...sc.trig.all, ...sc.trig.groups.flat()].join(' ');
      if (TIMEISH.test(txt) || /\bcommand\b/i.test(txt)) continue;
      if (trig(sc, A, inputs, no, null, false) !== false) return true;
    }
    return false;
  };
  const RELEVANT = new Set(['varset', 'varadd', 'varrandom', 'targetstate', 'hitdef', 'projectile', 'changestate', 'selfstate', 'ctrlset']);
  // ONE STATE'S CONTROLLERS, in file order, under an assignment: what it
  // issues (TargetState, HitDef/Projectile p2stateno), where it goes
  // (ChangeState/SelfState, HitDef p1stateno) and the variables after it. A
  // ChangeState that certainly fires leaves the state there. Otherwise run
  // again from where a tick left the variables, up to three ticks.
  //   o.forced  Set of controllers known to fire on the first tick
  //   o.fresh   he has just entered it (the first tick is Time 0)
  //   o.prev    the state he came from
  //   o.extra   controllers of his negative states that run before it
  function runState(no, A0, inputs, o, legacyForced, legacyFresh, legacyPrev) {
    if (typeof o === 'number' || o === undefined || o === null) o = { passes: o, forced: legacyForced, fresh: legacyFresh, prev: legacyPrev };
    const s = states.get(no);
    const issued = [], next = [], exits = [];
    if (!s) return { A: A0, issued, next, exits, left: false };
    let start = withFrozen(A0), end = start, left = false;
    const ends = [];
    let forced = o.forced || null;
    const list = o.extra && o.extra.length ? [...o.extra, ...s.sctrls] : s.sctrls;
    for (let pass = 0; pass < (o.passes || 3); pass++) {
      let A = start;
      const waits = new Set();
      const tick0 = pass === 0 && o.fresh !== false;
      if (tick0) { const hc = S.lit(s.header.get('ctrl')); if (hc !== null) A = Object.assign({}, A, { [CTRL]: [hc ? 1 : 0] }); }
      const restart = restarts(no, A, inputs);
      for (const sc of list) {
        const t = sc.type;
        if (!RELEVANT.has(t)) continue;
        // A variable no flow controller reads and no scene of hers looks at
        // (Brian's var(9) art flag, set from her anims) changes nothing a
        // walk decides: its writes are not followed, so her answers they ask
        // do not split his walks.
        if (relevantVars && (t === 'varset' || t === 'varadd' || t === 'varrandom') && !writesOf(sc).some(([nm]) => relevantVars.has(nm) || !VARNAME.test(nm))) continue;
        const tv = trig(sc, A, inputs, no, forced, tick0, o.prev, restart);
        if (tv === false) continue;
        if (t === 'varset' || t === 'varadd' || t === 'varrandom') {
          for (const [name, raw] of writesOf(sc)) {
            if (t === 'varrandom') { if (!Object.prototype.hasOwnProperty.call(frozen, name)) { A = Object.assign({}, A); delete A[name]; } continue; }
            const lit = t === 'varset' ? S.lit(raw) : null;
            if (tv === null && lit !== null && !(A[name] && A[name].length === 1 && A[name][0] === lit) && idempotent(sc, A, inputs, no, tick0, o.prev, restart, name, lit)) A = write(A, t, name, raw, true, no);
            else A = write(A, t, name, raw, tv, no);
          }
        } else if (t === 'ctrlset') {
          const v = S.lit(sc.params.get('value'));
          const nw = Object.assign({}, A);
          if (v === null) delete nw[CTRL];
          else if (tv === true) nw[CTRL] = [v ? 1 : 0];
          else if (A[CTRL]) nw[CTRL] = [...new Set([...A[CTRL], v ? 1 : 0])].sort();
          A = nw;
        } else if (t === 'targetstate') {
          const put = [];
          let out = false;
          for (const x of valuesA(sc.params.get('value'), A, no, o.prev)) {
            if (custom.has(x.v)) { issued.push({ C: x.v, from: no, A: x.A, via: sc }); put.push(x.v); }
            else { out = true; if (isBasic(x.v) && x.v >= 0) exits.push({ her: x.v, via: sc }); }
          }
          if (more.herState && (put.length || out)) A = out ? putHer(A, [], true) : putHer(A, put, tv === true);
        } else if (t === 'hitdef' || t === 'projectile') {
          const p2 = values(sc.params.get('p2stateno'), A, no, o.prev);
          for (const v of p2) if (custom.has(v)) issued.push({ C: v, from: no, A, via: sc });
          // On the hit that takes him to p1stateno she is in p2stateno.
          const Ahit = more.herState ? putHer(A, p2.filter((v) => custom.has(v)).length === p2.length ? p2 : [], true) : A;
          for (const v of values(sc.params.get('p1stateno'), A, no, o.prev)) if (v !== no) next.push({ no: v, A: Ahit, via: sc });
        } else {
          // A ChangeState that may fire splits the variables: where it goes,
          // they are what makes it fire; on the tick that goes on, what does
          // not (Brian's lift `fvar(3) <= 0` not taken: fvar(3) is 1).
          let At = A, Ac = A;
          if (tv === null && !(forced && typeof forced.has === 'function' && forced.has(sc))) {
            const sp = split(sc, A, inputs, no, tick0, o.prev, restart);
            if (sp) { At = sp.yes || A; Ac = sp.no; }
          }
          const vals = valuesA(sc.params.get('value'), At, no, o.prev);
          if (tv === null) {
            const r = residual(sc, A, inputs, no, tick0, o.prev, restart);
            // (Each `random` is drawn afresh: two exits on `Random < 100` in a
            // row are two chances, each followed - RANDOM SIBLINGS.)
            if (r !== null && !/\brandom\b/.test(r) && waits.has(r)) continue;
            if (r !== null) waits.add(r);
          }
          const cp = S.lit(sc.params.get('ctrl'));
          for (const x of vals) {
            if (x.v === no) continue;
            next.push({ no: x.v, A: cp !== null ? Object.assign({}, x.A, { [CTRL]: [cp ? 1 : 0] }) : x.A, via: sc, sure: tv === true });
            if (isBasic(x.v) && x.v >= 0) exits.push({ him: x.v, via: sc });
          }
          if (tv === true && vals.length) { left = true; break; }
          if (tv === null && vals.length && Ac === null) { left = true; break; }
          if (Ac) A = Ac;
        }
      }
      end = A;
      if (left) break;
      if (ends.some((e) => keyOf(e) === keyOf(end))) break;
      ends.push(end);
      start = ends.length > 1 ? joinA(ends[ends.length - 2], end) : end;
      forced = null;
    }
    return { A: end, issued, next, exits, left };
  }
  // A trigger's combinations split by its answer: { yes: the variables'
  // values where it may fire, no: where it may not } (null: none). Only the
  // variables whose values are listed narrow; a combination the evaluator
  // cannot settle stays on both sides.
  function split(sc, A, inputs, no, tick0, prev, restart) {
    const t = trigOf(sc, inputs, no, prev, restart);
    if (!t.vars.length) return null;
    const cs = combos(t.vars, A);
    if (!cs || cs.length < 2) return null;
    const yes = [], nope = [];
    for (const c of cs) {
      const c2 = Object.assign({}, c);
      if (tick0) c2.time = 0;
      const v = evalSet(t, c2);
      if (v !== false) yes.push(c);
      if (v !== true) nope.push(c);
    }
    const mk = (list) => {
      if (!list.length) return null;
      const out = Object.assign({}, A);
      for (const v of t.vars) if (A[v] || complete[v]) out[v] = [...new Set(list.map((c) => c[v]))].sort((x, y) => x - y);
      return out;
    };
    return { yes: mk(yes), no: mk(nope) };
  }
  // What a ChangeState's trigger still depends on once everything known is
  // settled: two exits in one state that wait on the same thing fire
  // together, and the first one listed is the one taken.
  function residual(sc, A, inputs, no, tick0, prev, restart) {
    const t = trigOf(sc, inputs, no, prev, restart);
    const cs = combos(t.vars, A);
    if (!cs || cs.length !== 1) return null;
    const ctx = ctxOf(cs[0]);
    if (tick0) ctx.time = 0;
    const line = (e) => { const v = X.evalExpr(e, ctx); return v === null ? null : typeof v === 'boolean' ? v : (Number.isNaN(v) ? false : v !== 0); };
    const norm = (e) => String(e).toLowerCase().replace(/\s+/g, '');
    const all = [];
    for (const e of t.all) { const v = line(e); if (v === false) return null; if (v === null) all.push(norm(e)); }
    const groups = [];
    for (const g of t.groups) {
      const kept = [];
      let dead = false;
      for (const e of g) { const v = line(e); if (v === false) { dead = true; break; } if (v === null) kept.push(norm(e)); }
      if (!dead) groups.push(kept.sort().join('&&'));
    }
    return all.sort().join('&&') + '|' + groups.sort().join('||');
  }
  // WHAT HIS STATES REACH from some starting points: each state entered with
  // the join of every assignment that reaches it, re-run when that grows,
  // stopping at a basic state or a state his files do not define. Memoized.
  const flowMemo = new Map();
  function flow(starts, inputs, cap) {
    const mk = inputsKey(inputs) + presentKey + '#' + starts.map((x) => (x.cont ? '~' : '') + x.no + (Number.isFinite(x.prev) ? '<' + x.prev : '') + ':' + keyOf(x.A)).sort().join(';');
    if (flowMemo.has(mk)) return flowMemo.get(mk);
    if (sharedFlows && sharedFlows.has(mk)) return sharedFlows.get(mk);
    const before = touches;
    const res = walk(starts, inputs, cap);
    if (flowMemo.size > 4000) flowMemo.clear();
    flowMemo.set(mk, res);
    if (sharedFlows && touches === before) { if (sharedFlows.size > 6000) sharedFlows.clear(); sharedFlows.set(mk, res); }
    return res;
  }
  function walk(starts, inputs, cap) {
    const at = new Map();      // giver state -> the assignment he enters it with
    const stay = new Map();    // giver state he stays in -> the assignment while he does
    const issued = new Map();  // custom state -> Set of issuing giver states
    const edges = new Map();   // giver state -> Set of states it goes on to
    const contStay = new Map();
    const stayed = (no, r, cont) => {
      if (r.left) return;
      const m = cont ? contStay : stay;
      const old = m.get(no);
      m.set(no, old ? joinA(old, r.A) : r.A);
    };
    const edge = (a, b) => { if (!edges.has(a)) edges.set(a, new Set()); edges.get(a).add(b); };
    const queued = new Set(), q = [];
    const prevs = new Map();
    const prevOf = (no) => { const ps = prevs.get(no); if (!ps || ps.size !== 1) return undefined; const v = [...ps][0]; return Number.isNaN(v) ? undefined : v; };
    const enter = (no, A, prev) => {
      if (isBasic(no) || no < 0 || !states.has(no)) return;
      const p = Number.isFinite(prev) ? prev : NaN;
      if (!prevs.has(no)) prevs.set(no, new Set());
      const grew = !prevs.get(no).has(p);
      prevs.get(no).add(p);
      const old = at.get(no);
      const nw = old ? joinA(old, A) : A;
      if (old && keyOf(old) === keyOf(nw) && !grew) return;
      at.set(no, nw);
      if (!queued.has(no)) { queued.add(no); q.push(no); }
    };
    const took = (no, r, cont) => {
      stayed(no, r, cont);
      for (const i of r.issued) { if (!issued.has(i.C)) issued.set(i.C, new Set()); issued.get(i.C).add(i.from); }
      for (const x of r.next) { edge(no, x.no); enter(x.no, x.A, no); }
    };
    const contAt = new Map();
    for (const s of starts) {
      if (!s.cont) { enter(s.no, s.A, s.prev); continue; }
      if (!states.has(s.no)) continue;
      if (!contAt.has(s.no)) contAt.set(s.no, s.A);
      took(s.no, runState(s.no, s.A, inputs, { passes: 3, fresh: false }), true);
    }
    let n = 0;
    const limit = cap || 3000;
    while (q.length && n < limit) {
      const no = q.shift();
      queued.delete(no);
      n++;
      took(no, runState(no, at.get(no), inputs, { prev: prevOf(no) }));
    }
    // A state he goes on in only from where a switch left him keeps that
    // tick's assignment; one he is entered into again keeps the entries'.
    for (const [no, A] of contStay) if (!stay.has(no)) stay.set(no, A);
    for (const [no, A] of contAt) if (!at.has(no)) at.set(no, A);
    return { at, stay, issued, edges, truncated: q.length > 0 };
  }
  // WHAT HIS OWN STATES CAN EVER BE IN, from what the engine enters by
  // itself during a fight (the negative states, 0-169, the 5000s) through
  // ChangeState/SelfState and a hit's p1stateno. A controller the root can
  // never run (a -2 ChangeState behind IsHelper(69000): the Striker's) is not
  // followed, and neither is a Helper controller's stateno.
  function rootReach(extraRoots, helperSide) {
    const seen = new Set();
    const q = [];
    const push = (n) => { if (!seen.has(n) && states.has(n)) { seen.add(n); q.push(n); } };
    if (extraRoots) for (const n of extraRoots) push(n);
    else for (const n of states.keys()) if (n < 0 || (n >= 0 && n <= 169) || (n >= 5000 && n <= 5999)) push(n);
    while (q.length) {
      const no = q.shift();
      for (const sc of states.get(no).sctrls) {
        let raw;
        if (sc.type === 'changestate' || sc.type === 'selfstate') raw = sc.params.get('value');
        else if (sc.type === 'hitdef' || sc.type === 'projectile' || sc.type === 'reversaldef') raw = sc.params.get('p1stateno');
        else continue;
        if (!helperSide && X.evalTriggerSet(sc.trig, { isHelper: false }) === false) continue;
        for (const v of values(raw, {}, no)) push(v);
      }
    }
    return seen;
  }
  // His action's length in ticks for the animations a state can show on its
  // first tick under an assignment (header value, ChangeAnims that may fire
  // at Time 0): { max, infinite }.
  function firstAnims(no, A) {
    const s = states.get(no);
    let anims = new Set();
    if (s.anim !== null && s.anim !== undefined) for (const v of values(s.anim, A, no)) anims.add(v);
    for (const sc of s.sctrls) {
      if (sc.type !== 'changeanim') continue;
      const tv = trig(sc, A, NO_INPUT, no, null, true);
      if (tv === false) continue;
      const vals = values(sc.params.get('value'), A, no);
      if (tv === true) anims = new Set(vals); else for (const v of vals) anims.add(v);
    }
    return anims;
  }
  function animTicks(no, A) {
    const s = states.get(no);
    if (!s) return { max: null, infinite: false, anims: [] };
    const anims = firstAnims(no, A);
    let max = null, infinite = false;
    for (const a of anims) {
      const t = airTimes.get(a);
      if (t === undefined) continue;
      if (t < 0) { infinite = true; continue; }
      if (max === null || t > max) max = t;
    }
    return { max, infinite, anims: [...anims] };
  }
  // The first-tick animations for each combination of the known values of
  // the variables its ChangeAnims read: [[combination, Set of anims]].
  function animsByCombo(no, A) {
    const s = states.get(no);
    if (!s) return [];
    const vars = new Set();
    for (const sc of s.sctrls) if (sc.type === 'changeanim') for (const e of [...sc.trig.all, ...sc.trig.groups.flat(), sc.params.get('value')]) if (e !== undefined) for (const v of varsIn(String(e))) if (A[v] || complete[v]) vars.add(v);
    const cs = combos([...vars], A);
    if (!cs) return [[{}, firstAnims(no, A)]];
    return cs.map((c) => {
      const A1 = Object.assign({}, A);
      for (const k of Object.keys(c)) A1[k] = [c[k]];
      return [c, firstAnims(no, A1)];
    });
  }
  const setPresent = (ids) => {
    present = ids ? new Set(ids) : null;
    presentKey = present ? '@' + [...present].sort((a, b) => a - b).join(',') : '';
  };
  return { states, custom, trig, byCommand, narrow, values, valuesA, runState, flow, trigOf, rootReach, animTicks, animsByCombo, restarts, setPresent, writesOf, dom };
}

// ---- the giver, once per build ------------------------------------------------
function readAirFrames(abs) {
  try { return abs ? modlib.airFrames(fs.readFileSync(abs, 'latin1')) : new Map(); } catch (e) { return new Map(); }
}
const PROBE_ANY = /\b(?:target|enemy|enemynear|p2|p4|partner)(?:\s*\(\s*\d*\s*\))?\s*,\s*(?:self)?animexist\s*\(\s*(\d+)\s*\)/gi;
const VICTIM_PROBE = /\b(?:target|enemy|enemynear|p2|p4|partner)(?:\s*\(\s*\d*\s*\))?\s*,\s*(?:self)?animexist\s*\(\s*(\d+)\s*\)/gi;
const HIM = new Set(['enemynear', 'enemy', 'target', 'p2', 'stateowner', 'root', 'parent']);
const VARNAME = /^f?var\(\d+\)$/;
const varRef = (name) => { const m = /^(f?var)\((\d+)\)$/.exec(name); return m ? { kind: m[1], index: +m[2] } : null; };

// The states of his a trigger set limits him to (`StateNo = 1011`,
// `StateNo = [1611,1612]`, `StateNo = 200 || StateNo = 400`), or null when
// some way through it names none.
const namedMemo = new WeakMap();
function statesNamed(trig) {
  if (!namedMemo.has(trig)) namedMemo.set(trig, statesNamedFresh(trig));
  return namedMemo.get(trig);
}
function statesNamedFresh(trig) {
  const one = (list) => {
    const out = new Set();
    for (const x of list) {
      const str = String(x);
      const alts = str.split('||');
      const sets = [];
      for (const alt of alts) {
        const got = new Set();
        for (const m of alt.matchAll(/\bstateno\s*=\s*(?:\[\s*(\d+)\s*,\s*(\d+)\s*\]|(\d+))/gi)) {
          if (/(prev|,\s*)$/i.test(alt.slice(0, m.index))) continue;
          if (m[3] !== undefined) got.add(+m[3]); else for (let n = +m[1]; n <= +m[2] && n - +m[1] < 200; n++) got.add(n);
        }
        if (!got.size) { sets.length = 0; break; }
        sets.push(got);
      }
      if (sets.length) { for (const g of sets) for (const n of g) out.add(n); return out; }
    }
    return null;
  };
  const all = one(trig.all);
  if (all) return all;
  if (!trig.groups.length) return null;
  const out = new Set();
  for (const g of trig.groups) { const got = one(g); if (!got) return null; for (const n of got) out.add(n); }
  return out;
}

// ---- caches: the same files are read once per process ---------------------------
// The data is rebuilt inside every VFS build (vfslib makeGeneratedFiles ->
// gallery.buildForRoster), which the server runs again after most Studio
// edits. What was read from a character's files is kept, keyed by those files:
// his .def and every file its [Files] section names (states, commands, .air,
// .sff, sounds), each by path, size and modification time. A giver's base
// (and with it every walk made on it), a receiver's reading and a pair's
// steps are reused while their files are unchanged; a change to one
// receiver's files recomputes her pairs only.
const CACHE = { givers: new Map(), receivers: new Map(), pairs: new Map() };
function fileSig(dir, def) {
  const parts = [];
  const add = (abs) => { try { const st = fs.statSync(abs); parts.push(abs + ':' + st.size + ':' + st.mtimeMs); } catch (e) { parts.push(abs + ':-'); } };
  const defAbs = path.join(dir, def);
  add(defAbs);
  let text = '';
  try { text = fs.readFileSync(defAbs, 'latin1'); } catch (e) { return parts.join('|'); }
  let inFiles = false;
  for (const raw of text.split('\n')) {
    const l = S.trimGo(raw.split(';')[0]);
    if (!l) continue;
    if (l[0] === '[') { inFiles = /^\[\s*files\s*\]/i.test(l); continue; }
    if (!inFiles) continue;
    const m = /^([^=\s]+)\s*=\s*(.*)$/.exec(l);
    if (!m) continue;
    const rel = m[2].replace(/"/g, '').replace(/\\/g, '/').trim();
    if (!rel) continue;
    const abs = modlib.resolveCI(dir, rel);
    if (abs) add(abs); else parts.push(rel + ':none');
  }
  return parts.join('|');
}
function cachedIn(map, key, sig, make, onMake) {
  if (map === CACHE.pairs && PAIRS_USED) PAIRS_USED.add(key);
  const hit = map.get(key);
  if (hit && hit.sig === sig) return hit.val;
  const val = make();
  map.set(key, { sig, val });
  if (onMake) onMake();
  return val;
}

// THE PAIRS, KEPT ACROSS STARTS (opts.persist; the build asks for it through
// gallery.buildForRoster). The caches above live one process, so every start
// of the server paid the whole walk again inside its first build - 25 to 44 s
// on Main with the module on, on the server's one thread, while the page's
// first read waited. A pair's answer depends on the two characters' files
// (its sig, as above) and on this program's code, so the pairs a build used
// are written to one file per bundle and read back by the next process:
//   <bundle>/backups/gallery-pairs.json   (the folder beside roster.json that
//   layout.js names, where the roster's own backups go: the bundle's, never
//   in a character's folder, writable in a build opened in place, and ignored
//   by git in the checkout)
// The first line names the code: a hash of this file and every local module
// it requires, all the way down (and the modes' folder, codeVersionOf), so any
// change to the program drops the whole file. Then one pair per line, [key, sig, value], read only while the sig
// still matches - cachedIn's own check. Only the pairs this process's builds
// USED are written (a smaller build - an export's public roster - adds none
// and drops none), so the file is the roster's size, never what every past
// roster added; and it stops at PERSIST_MAX bytes (UTF-8). A value goes in only when a copy is the same thing
// (plain objects, arrays, finite numbers, strings, Maps and Sets of plain
// keys, no object in two places); anything else is worked out again, as
// before. A damaged line or file is skipped, a write that fails is said once,
// and neither ever fails the build.
const PERSIST_MAX = 64 * 1024 * 1024;
const PERSIST_FORMAT = 'gallery-pairs 1';
const PERSIST = { file: null, loaded: false, onDisk: new Map(), used: new Set(), warned: false };
let PAIRS_USED = null;
let CODE_VERSION;
function codeVersion() {
  if (CODE_VERSION === undefined) {
    try { CODE_VERSION = codeVersionOf(__filename); } catch (e) { CODE_VERSION = null; }
  }
  return CODE_VERSION;
}
// The walk follows literal require calls of a relative path. A module loaded by a path it
// builds is named here instead: every .js in gallerymodes/ (the modes load each
// other), and self.js's director by name - present or not, since deleting it
// turns the director off (gallerymodes/self.js directorOf).
const CODE_BY_NAME = ['gallerymodes/self-director.js'];
function codeVersionOf(entry) {
  const root = path.dirname(entry);
  const h = require('crypto').createHash('sha256');
  const seen = new Set();
  const add = (f) => {
    seen.add(f);
    const src = fs.readFileSync(f);
    h.update(path.relative(root, f).replace(/\\/g, '/') + '\0');
    h.update(src);
    h.update('\0');
    return src;
  };
  const todo = [entry];
  while (todo.length) {
    const f = todo.shift();
    if (seen.has(f)) continue;
    const src = add(f);
    if (!/\.js$/i.test(f)) continue;
    for (const m of src.toString('latin1').matchAll(/require\(\s*['"](\.{1,2}\/[^'"]*|\.{1,2})['"]\s*\)/g)) {
      const base = path.resolve(path.dirname(f), m[1]);
      const hit = [base, base + '.js', base + '.json', path.join(base, 'index.js')].find((p) => { try { return fs.statSync(p).isFile(); } catch (e) { return false; } });
      if (hit) todo.push(hit);
    }
  }
  let modes = [];
  try { modes = fs.readdirSync(path.join(root, 'gallerymodes')).filter((n) => /\.js$/i.test(n)).map((n) => 'gallerymodes/' + n); } catch (e) { /* no modes folder */ }
  for (const rel of [...new Set([...modes, ...CODE_BY_NAME])].sort()) {
    const f = path.join(root, rel);
    if (seen.has(f)) continue;
    let file = false;
    try { file = fs.statSync(f).isFile(); } catch (e) { /* absent */ }
    if (file) add(f);
    else h.update(rel + '\0(absent)\0');
  }
  return h.digest('hex').slice(0, 32);
}
function pairsFile() {
  try { return path.join(path.dirname(require('./layout.js').dir('roster.json')), 'backups', 'gallery-pairs.json'); } catch (e) { return null; }
}
const TAG_MAP = '\u0001map', TAG_SET = '\u0001set';
const UNSAFE = new Error('not kept: a copy would not be the same value');
const NOT_KEPT = new WeakSet();   // values found not copyable, not tried again
const plainKey = (k) => typeof k === 'string' || (typeof k === 'number' && Number.isFinite(k) && !Object.is(k, -0));
// seen: every object met so far, or with `shared` only the ones above this one
// (a loop is never kept; one object in two places is, written twice)
function encodeVal(v, seen, shared) {
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return v;
  if (typeof v === 'number') { if (!Number.isFinite(v) || Object.is(v, -0)) throw UNSAFE; return v; }
  if (typeof v !== 'object' || seen.has(v) || !Object.isExtensible(v) || Object.getOwnPropertySymbols(v).length) throw UNSAFE;
  seen.add(v);
  try { return encodeObj(v, seen, shared); } finally { if (shared) seen.delete(v); }
}
function encodeObj(v, seen, shared) {
  const proto = Object.getPrototypeOf(v);
  const names = Object.getOwnPropertyNames(v);
  if (proto === Array.prototype) {
    if (names.length !== v.length + 1) throw UNSAFE;                  // its items and `length`, nothing else
    const out = new Array(v.length);
    for (let i = 0; i < v.length; i++) { if (!(i in v)) throw UNSAFE; out[i] = encodeVal(v[i], seen, shared); }
    return out;
  }
  if (proto === Map.prototype || proto === Set.prototype) {
    if (names.length) throw UNSAFE;
    if (proto === Set.prototype) { const out = []; for (const k of v) { if (!plainKey(k)) throw UNSAFE; out.push(k); } return { [TAG_SET]: out }; }
    const out = [];
    for (const [k, x] of v) { if (!plainKey(k)) throw UNSAFE; out.push([k, encodeVal(x, seen, shared)]); }
    return { [TAG_MAP]: out };
  }
  if (proto !== Object.prototype) throw UNSAFE;
  const out = {};
  for (const k of names) {
    const d = Object.getOwnPropertyDescriptor(v, k);
    if (!d.enumerable || !('value' in d) || k === '__proto__' || k.charCodeAt(0) === 1) throw UNSAFE;
    out[k] = encodeVal(d.value, seen, shared);
  }
  return out;
}
function decodeVal(v) {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) { for (let i = 0; i < v.length; i++) v[i] = decodeVal(v[i]); return v; }
  const keys = Object.keys(v);
  if (keys.length === 1 && keys[0] === TAG_MAP) return new Map(v[TAG_MAP].map(([k, x]) => [k, decodeVal(x)]));
  if (keys.length === 1 && keys[0] === TAG_SET) return new Set(v[TAG_SET]);
  for (const k of keys) {
    if (k === '__proto__' || k.charCodeAt(0) === 1) throw new Error('damaged entry');
    v[k] = decodeVal(v[k]);
  }
  return v;
}
function persistLoad() {
  if (PERSIST.loaded) return;
  PERSIST.loaded = true;
  PERSIST.file = pairsFile();
  const version = codeVersion();
  if (!PERSIST.file || !version) return;
  persistSweep(PERSIST.file);
  let text;
  try { text = fs.readFileSync(PERSIST.file, 'utf8'); } catch (e) { return; }
  const lines = text.split('\n');
  let head = null;
  try { head = JSON.parse(lines[0]); } catch (e) { return; }
  if (!head || head.format !== PERSIST_FORMAT || head.version !== version) return;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    try {
      const e = JSON.parse(line);
      if (!Array.isArray(e) || e.length !== 3 || typeof e[0] !== 'string' || typeof e[1] !== 'string') continue;
      const val = decodeVal(e[2]);
      if (!CACHE.pairs.has(e[0])) CACHE.pairs.set(e[0], { sig: e[1], val });
      PERSIST.onDisk.set(e[0], { sig: e[1], val, line, size: Buffer.byteLength(line) + 1 });
    } catch (err) { /* a damaged line: that pair is worked out again */ }
  }
}
// A temp file a process left when it stopped between its write and its rename
// (<file>.<pid>.tmp): removed once its process is gone.
function persistSweep(file) {
  const dir = path.dirname(file), base = path.basename(file) + '.';
  let names;
  try { names = fs.readdirSync(dir); } catch (e) { return; }
  for (const n of names) {
    const m = n.startsWith(base) && /^(\d+)\.tmp$/.exec(n.slice(base.length));
    if (!m || Number(m[1]) === process.pid || pidAlive(Number(m[1]))) continue;
    try { require('./lifebars.js').rmFile(path.join(dir, n)); } catch (e) { /* left for the next start */ }
  }
}
function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}
// The bundle's roster as the pair keys spell a character (its folder in the
// layout's characters folder, then its .def, as rosterChars builds them), or
// null when there is no roster to read (a build of a given list of characters).
function rosterPairSides() {
  try {
    const layout = require('./layout.js');
    const roster = JSON.parse(fs.readFileSync(layout.dir('roster.json'), 'utf8').replace(/^﻿/, ''));
    const cacheDir = layout.dir('cache');
    return new Set((roster.chars || []).filter((c) => c && c.folder && c.select)
      .map((c) => path.join(cacheDir, c.folder) + '|' + String(c.select).split('/').slice(1).join('/')));
  } catch (e) { return null; }
}
function persistSave(used) {
  const version = codeVersion();
  if (!PERSIST.file || !version) return;
  const lines = [], next = new Map();
  let bytes = 0, same = true;
  for (const key of used) {
    const hit = CACHE.pairs.get(key);
    if (!hit) continue;
    const prev = PERSIST.onDisk.get(key);
    let line, size;
    if (prev && prev.sig === hit.sig && prev.val === hit.val) { line = prev.line; size = prev.size; }
    else {
      if (hit.val && typeof hit.val === 'object' && NOT_KEPT.has(hit.val)) continue;
      // (A core pair's value - no '#' in its key - is read only through a JSON
      // copy of its steps and its counts' numbers, so an object it holds in two
      // places is two after that copy anyway: those may share.)
      try { line = JSON.stringify([key, hit.sig, encodeVal(hit.val, new Set(), !key.includes('#'))]); } catch (e) {
        if (hit.val && typeof hit.val === 'object') NOT_KEPT.add(hit.val);
        continue;
      }
      size = Buffer.byteLength(line) + 1;
      same = false;
    }
    // (at the cap the rest is left out; a file already holding exactly the
    // kept lines is not written again)
    if (bytes + size > PERSIST_MAX) break;
    bytes += size;
    lines.push(line);
    next.set(key, { sig: hit.sig, val: hit.val, line, size });
  }
  // A PAIR THIS PROCESS DID NOT USE STAYS while the bundle's roster holds both
  // of its characters. A process whose only build is part of the roster - a
  // command-line public export, a tool - used to write back its part alone,
  // and the next start walked every other pair again. A character gone from the roster still drops
  // out with every pair it was in, so the file stays the roster's size.
  const sides = rosterPairSides();
  if (sides) {
    for (const [key, prev] of PERSIST.onDisk) {
      if (next.has(key)) continue;
      const pair = key.split('#')[0].split('>');
      if (pair.length !== 2 || !sides.has(pair[0]) || !sides.has(pair[1])) continue;
      if (bytes + prev.size > PERSIST_MAX) break;
      bytes += prev.size;
      lines.push(prev.line);
      next.set(key, prev);
    }
  }
  if (same && next.size === PERSIST.onDisk.size) return;
  const tmp = PERSIST.file + '.' + process.pid + '.tmp';
  try {
    fs.mkdirSync(path.dirname(PERSIST.file), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify({ format: PERSIST_FORMAT, version }) + '\n' + lines.join('\n') + '\n');
    for (let i = 0; ; i++) {
      try { fs.renameSync(tmp, PERSIST.file); break; } catch (e) {
        if (i >= 5 || !['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) throw e;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
      }
    }
    PERSIST.onDisk = next;
  } catch (e) {
    try { require('./lifebars.js').rmFile(tmp); } catch (e2) { /* the write's own error is the one to say */ }
    if (!PERSIST.warned) { PERSIST.warned = true; console.warn('H gallery: the pair cache was not saved (' + e.message + ')'); }
  }
}
// Her actions, as a walk asks them: a walk depends only on the answers it
// asked for, so a partner with the same answers shares it (Brian's walks for
// 17 receivers were 9 by his 60-odd probes, most of which one walk never asks).
class AskSet extends Set {
  constructor(src) { super(); this.src = src; this.asked = new Map(); }
  has(n) { const v = this.src.has(n); this.asked.set(n, v); return v; }
}

// What a giver is, whoever he meets: his scenes, the states a fight can put
// him in, his grabs, his commands, the numbers his own states ask a partner
// about, and the setup the gallery gives him.
function giverBase(dir, def, sig) {
  return cachedIn(CACHE.givers, dir + '|' + def, sig || fileSig(dir, def), () => giverBaseFresh(dir, def), () => { stat.givers++; });
}
const stat = { givers: 0, receivers: 0, pairs: 0, walks: 0 };
function giverBaseFresh(dir, def) {
  const t0 = Date.now();
  const resolve = (rel) => modlib.resolveCI(dir, rel);
  const gf = modlib.defFiles(dir, def);
  const gAir = readAirFrames(gf.anim);
  const airTimes = gf.anim ? readAirTimes(gf.anim) : new Map();
  const gAirTicks = readAirTicks(gf.anim);
  const an = S.analyzeGiver(dir, def, { resolve, giverActions: new Set(gAir.keys()), detail: true });
  const cmdFile = S.stateFiles(dir, def, resolve).find((f) => f.key === 'cmd' && f.abs);
  const commands = cmdFile ? readCommands(cmdFile.abs) : new Map();
  const cmdInfo = new Map([...commands].map(([k, defs]) => [k, commandInfo(k, defs)]));
  // (Commands one key makes true together: COMMAND ALIASES.)
  const cmdAlias = commandAliases(commands);
  const power = readPowerMax(dir, def);
  const helperIds = new Set();
  const helperCtrls = [];
  for (const s of an.states.values()) for (const sc of s.sctrls) if (sc.type === 'helper') {
    const id = S.lit(sc.params.get('id'));
    if (id !== null) helperIds.add(id);
    helperCtrls.push({ state: s.no, sc, id });
  }
  // Complete domains: every write of the variable, anywhere in his files
  // (a helper's ParentVarSet included), is a VarSet of a value with no
  // variable and no redirect in it.
  const complete = {};
  {
    const bad = new Set(), vals = new Map();
    const note = (name, raw, set) => {
      if (bad.has(name)) return;
      if (!set) { const n = S.lit(raw); if (n !== null) set = [n]; }
      if (!set) {
        const txt = String(raw === undefined ? '' : raw);
        if (!X.parses(txt) || X.varsOf(txt).length || /,/.test(txt)) { bad.add(name); return; }
        const out = [];
        for (const r of X.RANDOM_SAMPLES) { const v = X.evalExpr(txt, { random: r }); if (!Number.isFinite(v)) { bad.add(name); return; } out.push(Math.trunc(v)); }
        set = out;
      }
      if (!vals.has(name)) vals.set(name, new Set([0]));
      for (const v of set) vals.get(name).add(v);
    };
    const wr = (sc) => {
      const out = [];
      const v = S.lit(sc.params.get('v')), fv = S.lit(sc.params.get('fv'));
      if (v !== null) out.push(['var(' + v + ')', sc.params.get('value')]);
      if (fv !== null) out.push(['fvar(' + fv + ')', sc.params.get('value')]);
      for (const [k, val] of sc.params) { const m = /^(var|fvar)\((\d+)\)$/.exec(k); if (m) out.push([m[1] + '(' + m[2] + ')', val]); }
      return out;
    };
    for (const st of an.states.values()) for (const sc of st.sctrls) {
      for (const e of [...sc.trig.all, ...sc.trig.groups.flat(), ...sc.params.values()]) for (const m of String(e).matchAll(/\b(f?var)\s*\(\s*(\d+)\s*\)\s*:=/gi)) bad.add(m[1].toLowerCase() + '(' + m[2] + ')');
      if (sc.type === 'varset' || sc.type === 'parentvarset') for (const [nm, raw] of wr(sc)) note(nm, raw);
      else if (['varadd', 'varrandom', 'parentvaradd', 'varrangeset'].includes(sc.type)) for (const [nm] of wr(sc)) bad.add(nm);
    }
    for (const [nm, set] of vals) if (!bad.has(nm) && set.size <= 24) complete[nm] = [...set].sort((a, b) => a - b);
  }
  // Her state as he reads it is tracked only for a giver whose own states
  // ask it (Brian's grope stage): elsewhere it would only split his walks.
  let readsHer = false;
  for (const s of an.states.values()) {
    if (readsHer) break;
    if (an.scenes.has(s.no)) continue;
    for (const sc of s.sctrls) {
      if (!['changestate', 'targetstate', 'selfstate', 'hitdef', 'projectile'].includes(sc.type)) continue;
      if ([...sc.trig.all, ...sc.trig.groups.flat(), sc.params.get('value')].some((e) => e !== undefined && new RegExp(HER_STATE_ATOM.source, 'i').test(String(e)))) { readsHer = true; break; }
    }
  }
  const walkerOpts = { helperIds, power, airTimes, complete, memo: new WeakMap(), trigCache: new WeakMap(), herState: readsHer, cmdAlias };
  const W = makeWalker(an, walkerOpts);

  const computedTables = (K) => {
    const out = [];
    for (const [n, fr] of gAir) if (fr.size && modlib.hFamily(n) !== 'other' && gAir.has(n - K)) out.push(n);
    return out;
  };
  // A fallback outside the H windows still shows a scene when his action
  // draws from scene sprite groups (Kur0maru's 2234 and 12260 are frames of
  // the Kuromaru receiver groups 19230 and 18300): she needs those sprites,
  // exactly as for an H number.
  const drawsScene = (a) => [...(gAir.get(a) || [])].some((k) => { const g = +String(k).split(',')[0]; return g !== 99999 && isHGroup(g); });
  const hScenes = new Set();
  for (const sc of an.scenes.values()) {
    const d = sc.demands;
    const computed = (d.computed || []).some((cd) => [cd.offset, cd.whenShipped, cd.otherwise].some((K) => Number.isFinite(K) && computedTables(K).length));
    if (d.guarded.length || d.assumed.length || d.fallbacks.some(isHNumber) || d.fallbacks.some(drawsScene) || computed) hScenes.add(sc.state);
  }
  // A scene that sends her into a state his files never define (Kur0maru's
  // position-5 climax 6225, a pasted block that changes her into 6229): the
  // engine gives her an empty state, so no step goes there.
  const broken = new Map();
  for (const C of hScenes) {
    const s = an.states.get(C);
    if (!s) continue;
    for (const sc of s.sctrls) {
      if (sc.type !== 'changestate') continue;
      const v = S.lit(sc.params.get('value'));
      if (v !== null && !isBasic(v) && v >= 0 && !an.states.has(v) && X.evalTriggerSet(sc.trig, {}) !== false) { broken.set(C, v); break; }
    }
  }

  const root = W.rootReach();
  // A helper's states: its spawn state's reach, and the negative-state
  // ChangeStates only a helper can take (behind IsHelper(N)).
  const helperRoots = [];
  for (const h of helperCtrls) helperRoots.push(...W.values(h.sc.params.get('stateno'), {}, h.state));
  for (const [no, s] of an.states) if (no < 0) for (const sc of s.sctrls) {
    if (sc.type !== 'changestate') continue;
    if (X.evalTriggerSet(sc.trig, { isHelper: false }) !== false) continue;
    helperRoots.push(...W.values(sc.params.get('value'), {}, no));
  }
  const helperReach = W.rootReach(helperRoots, true);

  // THE GRABS: a HitDef or Projectile that catches a standing, idle partner
  // (hitflag with H or M, never `+`, no trigger that waits for her to be KO'd
  // or down), in a state of his a fight can enter.
  const standingGrab = (sc) => {
    if (sc.type !== 'hitdef' && sc.type !== 'projectile') return false;
    const hf = String(sc.params.has('hitflag') ? sc.params.get('hitflag') : 'MAF').replace(/\s+/g, '').toUpperCase();
    if (hf.includes('+') || !/[HM]/.test(hf)) return false;
    const txt = [...sc.trig.all, ...sc.trig.groups.flat()].join(' ').toLowerCase();
    if (/(enemy|enemynear|p2|target)[^,]*,\s*alive\s*=\s*0|p2life\s*(<=|=)\s*0|p2statetype\s*=\s*l\b/.test(txt)) return false;
    return true;
  };
  // A hit catches her into a scene only when it names her custom state
  // (p2stateno), takes him to a state of his that issues one (p1stateno,
  // two hops), or a TargetState in the same state waits for the hit
  // (movehit, numtarget). A cosmetic splash projectile with no p2stateno
  // (Kur0maru's 7000, 15153, 15154: follow-up phases that TargetState her at
  // time 0 because she is already his) catches nobody.
  const issuesCustom = (no, hops, seen) => {
    const s = an.states.get(no);
    if (!s || seen.has(no)) return false;
    seen.add(no);
    for (const sc of s.sctrls) {
      if (sc.type === 'targetstate' && W.values(sc.params.get('value'), {}, no).some((v) => W.custom.has(v))) return true;
      if (hops > 0 && sc.type === 'changestate') for (const v of W.values(sc.params.get('value'), {}, no)) if (!isBasic(v) && issuesCustom(v, hops - 1, seen)) return true;
    }
    return false;
  };
  const HIT_GATE = /\b(movehit|movecontact|numtarget|hitcount|uniqhitcount)\b/i;
  const trigTxt = (sc) => [...sc.trig.all, ...sc.trig.groups.flat()].join(' ');
  // A state that puts her in a custom state on its first tick (Kur0maru's
  // 51306: TargetState 52218 at time = 0).
  const issuesAtOnce = (no) => {
    const s = an.states.get(no);
    if (!s || isBasic(no)) return false;
    return s.sctrls.some((sc) => {
      if (sc.type !== 'targetstate' || !W.values(sc.params.get('value'), {}, no).some((v) => W.custom.has(v))) return false;
      try { return X.evalTriggerSet(sc.trig, { time: 0, isHelper: false }) !== false; } catch (e) { return false; }
    });
  };
  const grabs = [];
  for (const [no, s] of an.states) {
    if (isBasic(no) || no < 0 || (no >= 170 && no <= 199) || !root.has(no)) continue;
    const hits = s.sctrls.filter(standingGrab);
    if (!hits.length) continue;
    // (NO CLSN1, NO GRAB: a HitDef state none of whose animations has a
    // Clsn1 can never hit - Allosaurus' 22004.)
    if (galreach && galreach.neverHits({ an, dir, def }, no)) continue;
    const p2 = hits.some((sc) => W.values(sc.params.get('p2stateno'), {}, no).some((v) => W.custom.has(v)));
    const gated = s.sctrls.some((sc) => sc.type === 'targetstate' && HIT_GATE.test(trigTxt(sc))
      && W.values(sc.params.get('value'), {}, no).some((v) => W.custom.has(v)));
    const viaP1 = hits.some((sc) => W.values(sc.params.get('p1stateno'), {}, no).some((v) => v !== no && !isBasic(v) && issuesCustom(v, 2, new Set())));
    // The hit's own state hands him on when it connects (a ChangeState on
    // movehit/numtarget) to a state that puts her in a custom state on its
    // first tick: Kur0maru's milking 51305 (no p1/p2stateno; movehit = 1 ->
    // 51306, which TargetStates her 52218 at time = 0). One hop; a splash
    // with no such handoff (7000, 15153, 15154) is still none.
    const viaGate = !p2 && !gated && !viaP1 && s.sctrls.some((sc) => sc.type === 'changestate' && HIT_GATE.test(trigTxt(sc))
      && W.values(sc.params.get('value'), {}, no).some((v) => v !== no && issuesAtOnce(v)));
    if (!p2 && !gated && !viaP1 && !viaGate) continue;
    // A projectile catches nobody: its step is "the hit" (Kur0maru's gas and
    // thunder: her 1081/1086/2220 are a paralysis and a shock, not a hold).
    const handoff = viaGate ? s.sctrls.filter((sc) => sc.type === 'changestate' && HIT_GATE.test(trigTxt(sc))).flatMap((sc) => W.values(sc.params.get('value'), {}, no)).filter((v) => v !== no && issuesAtOnce(v)) : [];
    grabs.push({ no, direct: p2 || gated, projectile: hits.every((sc) => sc.type === 'projectile'), handoff });
  }
  grabs.sort((a, b) => (a.direct === b.direct ? a.no - b.no : a.direct ? -1 : 1));
  // A GRAB ONLY A LAUNCHER ENTERS, BY HER ART: every ChangeState into it asks
  // what she ships (Kur0maru's 51300 goes on to 51305 only when
  // `enemynear,SelfAnimExist(52219) || (110810)`, else to the toilet 51205).
  // The routes are kept with their time atoms read as come; a partner for
  // whom every route is shut gets no step of that grab.
  const TIME_ATOMS = /\b(animtime|animelem|animelemtime|time|statetime)\s*(=|>=|<=|>|<)\s*-?\d+(\s*,\s*(=|>=|<=|>|<)?\s*-?\d+)?/gi;
  const launchers = new Map();
  for (const g of grabs) {
    const routes = [];
    let open = false;
    for (const no of root) {
      if (no === g.no) continue;
      for (const sc of an.states.get(no).sctrls) {
        if ((sc.type !== 'changestate' && sc.type !== 'selfstate') || !W.values(sc.params.get('value'), {}, no).includes(g.no)) continue;
        if (!new RegExp(PROBE_ANY.source, 'i').test(trigTxt(sc))) { open = true; break; }
        const rw = (e) => String(e).replace(TIME_ATOMS, '1');
        routes.push({ from: no, sc: { type: sc.type, state: sc.state, params: sc.params, trig: { all: sc.trig.all.map(rw), groups: sc.trig.groups.map((gr) => gr.map(rw)) } } });
      }
      if (open) break;
    }
    if (!open && routes.length) launchers.set(g.no, routes);
  }

  // A HELPER THAT FOLLOWS HIS STATE (idiom D): a helper state entered on
  // `Root,StateNo = N` that puts her in a scene is that scene's while he is
  // in N - Minotaur's horse goes 7041 -> 7051 when he is in 7050 and 7051
  // gives her 7057, so his press of x in 7010 shows her 7057.
  const helperFollow = new Map();
  for (const no of helperReach) {
    const s = an.states.get(no);
    if (!s) continue;
    for (const sc of s.sctrls) {
      if (sc.type !== 'changestate') continue;
      const txt = [...sc.trig.all, ...sc.trig.groups.flat()].join(' ');
      const m = /\b(?:root|parent)\s*,\s*stateno\s*=\s*(\d+)\b/i.exec(txt);
      if (!m) continue;
      const N = +m[1];
      if (!root.has(N) || N < 0 || isBasic(N)) continue;
      for (const J of W.values(sc.params.get('value'), {}, no)) {
        const js = an.states.get(J);
        if (!js || !helperReach.has(J)) continue;
        const got = js.sctrls.filter((c) => c.type === 'targetstate').flatMap((c) => W.values(c.params.get('value'), {}, J)).filter((C) => W.custom.has(C));
        if (!got.length) continue;
        if (!helperFollow.has(N)) helperFollow.set(N, new Set());
        for (const C of got) helperFollow.get(N).add(C);
      }
    }
  }
  // A SUMMON: a state of his whose Helper grabs a standing partner by
  // itself - its HitDef names her custom state (Minotaur's 7000 spawns the
  // horse, whose 7030 HitDef gives her 7045), or the helper's own state puts
  // her in one on the hit (Kur0maru's dog 6061: a throw with no p2stateno and
  // `TargetState 6064` on `MoveHit = 1 && NumTarget`). Then either he enters
  // his hub on his own through -1 once the helper holds her
  // (`Helper(7000),StateNo = 7041` -> 7010), and the walk starts from the hub
  // with the hold the helper's states after the hit give her; or THE HELPER
  // PLAYS THE SCENE: nothing of his negative states waits on it, and he goes
  // back to standing (the dogs, the tentacle trap) or on to a follow-up of his
  // own summon state that waits on the helper (the Jedah summon's 4100 ->
  // 4140 on `helper(4100),StateNo = 4120`, the upper throw's 3400 -> 3401 on
  // its MoveHit) - the walk starts there, and her scenes are everything the
  // helper's own states give her, read per receiver (the dog girl's
  // `target,SelfAnimExist(19230)` picks her piston sequence or the small
  // dog's hold). The runtime enters the summon state. A helper that spawns
  // relative to the screen edge (postype front/back) and walks there has her
  // placed from that edge: 95 px from it with him 60 px behind her, the
  // middle of the band measured to grab (25-130 px). One that walks along x
  // on its own or whose hit takes his own side too (affectteam B/F: the
  // dogs) could take someone else when several pairs stand side by side:
  // `edgeOnly`, its steps play only in an edge slot, facing that edge.
  const summons = [];
  const xMoves = (no) => {
    const s = an.states.get(no);
    if (!s) return false;
    const hv = String(s.header.get('velset') === undefined ? '' : s.header.get('velset')).split(',')[0].trim();
    if (hv && S.lit(hv) !== 0) return true;
    return s.sctrls.some((sc) => (sc.type === 'velset' || sc.type === 'veladd') && sc.params.has('x') && S.lit(sc.params.get('x')) !== 0);
  };
  // PRESS SUMMONS: a Helper of his [Statedef -1] (-2, -3) on one button
  // alone, with control (Marasama's six creatures on x, b, c, a, y, z: each
  // spawns a spawner whose helper grabs her). Its trigger holds with that
  // command and his control, never with no input, and nothing else of his
  // negative or basic states reads that button (or an alias of it): a press
  // there spawns it and does nothing else. Its step presses the button while
  // he stands with control (`noGrab`, `withCtrl`: no grab state is entered);
  // its key (`entry`) is the helper's first state, which he never enters, and
  // its walk is the grab alone.
  const pressOf = (h) => {
    if (h.id === null || h.state >= 0 || h.state < -3) return null;
    const ks = [...new Set(commandsIn(h.sc.trig))].filter((k) => cmdInfo.has(k) && cmdInfo.get(k).playable && cmdInfo.get(k).key);
    if (ks.length !== 1) return null;
    const k = ks[0];
    const A1 = { [CTRL]: [1] };
    if (W.trig(h.sc, A1, new Set([k]), h.state) === false || W.trig(h.sc, A1, NO_INPUT, h.state) !== false) return null;
    const same = new Set([k, ...(cmdAlias.get(k) || [])]);
    for (const [no, st] of an.states) {
      if (!(no < 0 || isBasic(no))) continue;
      for (const sc of st.sctrls) if (sc.type !== 'helper' && commandsIn(sc.trig).some((x) => same.has(x))) return null;
    }
    return k;
  };
  for (const h of helperCtrls) {
    const press = h.state < 0 ? pressOf(h) : null;
    if (h.id === null || (h.state < 0 && !press) || (h.state >= 0 && (isBasic(h.state) || !root.has(h.state)))) continue;
    const starts = W.values(h.sc.params.get('stateno'), {}, h.state).filter((v) => an.states.has(v));
    // (A press summon's key: the helper's first state.)
    const key = press ? starts[0] : h.state;
    if (key === undefined || summons.some((sm) => sm.no === key)) continue;
    // Not a summon: a copy of him that starts in a state of his own
    // (kuromaru_plus's time-stop clone, helpertype player, starts in his Bao
    // entry 4501 - his grabs are that scene), or a summon state that stops
    // time (its Pause of var(58) = 10000 and more).
    if (starts.some((v) => root.has(v))) continue;
    if (an.states.get(key).sctrls.some((sc) => (sc.type === 'pause' || sc.type === 'superpause') && sc.params.get('time') !== undefined
      && (S.lit(sc.params.get('time')) === null || S.lit(sc.params.get('time')) >= TIME_STOP))) continue;
    // NESTED SUMMONS: a helper whose states only spawn the one that grabs
    // (Ripps' ant 8000 spawns the hole 8001 at her, whose 8002 grabs): its
    // Helper controllers' states join the summon's, three deep, and every id
    // on the way is the summon's to clear.
    let hs = W.rootReach(starts, true);
    const chain = [h.id];
    const idOf = new Map();
    for (let depth = 0; depth < 3; depth++) {
      const more = [];
      for (const hc of helperCtrls) {
        if (hc.id === null || hc.state < 0 || !hs.has(hc.state)) continue;
        for (const v of W.values(hc.sc.params.get('stateno'), {}, hc.state)) {
          if (!an.states.has(v) || hs.has(v) || root.has(v) || more.includes(v)) continue;
          more.push(v);
          idOf.set(v, hc.id);
          if (!chain.includes(hc.id)) chain.push(hc.id);
        }
      }
      if (!more.length) break;
      starts.push(...more);
      hs = W.rootReach(starts, true);
    }
    let hit = null;
    for (const no of hs) {
      for (const sc of an.states.get(no).sctrls) {
        if (!standingGrab(sc)) continue;
        const p2 = W.values(sc.params.get('p2stateno'), {}, no).filter((v) => W.custom.has(v));
        if (p2.length) { hit = { state: no, sc, p2, p1: W.values(sc.params.get('p1stateno'), {}, no) }; break; }
      }
      if (hit) break;
    }
    // (No p2stateno anywhere: a standing throw whose own state puts her in a
    // custom state on the hit.)
    if (!hit) {
      for (const no of hs) {
        const st = an.states.get(no);
        const hd = st.sctrls.find(standingGrab);
        if (!hd) continue;
        const on = st.sctrls.filter((sc) => sc.type === 'targetstate' && HIT_GATE.test(trigTxt(sc)))
          .flatMap((sc) => W.values(sc.params.get('value'), {}, no)).filter((v) => W.custom.has(v));
        if (on.length) { hit = { state: no, sc: hd, p2: [...new Set(on)], p1: [] }; break; }
      }
    }
    // (A HIT THAT HANDS ON, helper side: neither, but a ChangeState on the
    // hit - movehit, numtarget - into the helper's own states, which put her
    // in an H scene within six hops: ero_helper_gs' 2100 goes to 2000 on
    // `MoveHit = 1 && NumTarget`, then 2101, 2102, 2103 and 3000, whose
    // `TargetState StateNo + 1000` gives her 4000. Each hop any ChangeState
    // of its reach; a state that only lets her go - 2105's 2106, a release
    // with no scene art - is no end.)
    if (!hit) {
      for (const no of hs) {
        const st = an.states.get(no);
        const hd = st.sctrls.find(standingGrab);
        if (!hd) continue;
        const q = st.sctrls.filter((sc) => sc.type === 'changestate' && HIT_GATE.test(trigTxt(sc)))
          .flatMap((sc) => W.values(sc.params.get('value'), {}, no)).filter((v) => v !== no && hs.has(v)).map((v) => [v, 1]);
        const seen = new Set([no]);
        while (q.length && !hit) {
          const [x, hop] = q.shift();
          if (seen.has(x)) continue;
          seen.add(x);
          const xs = an.states.get(x);
          if (!xs) continue;
          const got = xs.sctrls.filter((sc) => sc.type === 'targetstate').flatMap((sc) => W.values(sc.params.get('value'), {}, x)).filter((v) => W.custom.has(v) && hScenes.has(v));
          if (got.length) { hit = { state: no, sc: hd, p2: [...new Set(got)], p1: [] }; break; }
          if (hop < 6) for (const sc of xs.sctrls) if (sc.type === 'changestate') for (const v of W.values(sc.params.get('value'), {}, x)) if (hs.has(v) && !seen.has(v)) q.push([v, hop + 1]);
        }
        if (hit) break;
      }
    }
    if (!hit) continue;
    // Her hold: what the helper's own states after the hit put her in.
    const hold = new Set();
    for (const no of W.rootReach(hit.p1.filter((v) => an.states.has(v)), true)) {
      if (!hs.has(no)) continue;
      for (const sc of an.states.get(no).sctrls) if (sc.type === 'targetstate' && S.lit(sc.params.get('value')) !== null) { const v = S.lit(sc.params.get('value')); if (W.custom.has(v) && !hit.p2.includes(v)) hold.add(v); }
      if (hold.size) break;
    }
    // His hub: a -1/-2/-3 ChangeState that waits on the helper's state.
    let hub = null;
    const re = new RegExp('\\bhelper\\s*\\(\\s*' + h.id + '\\s*\\)\\s*,\\s*stateno\\b', 'i');
    for (const neg of [-1, -2, -3]) {
      const st = an.states.get(neg);
      if (!st || hub !== null) continue;
      for (const sc of st.sctrls) {
        if (sc.type !== 'changestate' || !re.test([...sc.trig.all, ...sc.trig.groups.flat()].join(' '))) continue;
        const v = S.lit(sc.params.get('value'));
        if (v !== null && an.states.has(v) && !isBasic(v)) { hub = v; break; }
      }
    }
    // Else the helper plays the scene: his follow-up, if his summon state
    // goes on to one when the helper holds her (anything it reads of the
    // helper: its state, its hit).
    const helperPlays = hub === null;
    if (helperPlays && !press) {
      const reH = new RegExp('\\bhelper\\s*\\(\\s*' + h.id + '\\s*\\)\\s*,', 'i');
      for (const sc of an.states.get(h.state).sctrls) {
        if (sc.type !== 'changestate' || !reH.test(trigTxt(sc))) continue;
        const v = S.lit(sc.params.get('value'));
        if (v !== null && v !== h.state && an.states.has(v) && !isBasic(v)) { hub = v; break; }
      }
    }
    const pt = String(h.sc.params.get('postype') || '').toLowerCase().replace(/\s+/g, '');
    const place = pt === 'front' || pt === 'back' ? { front: 95, gap: 60 } : null;
    const at = String(hit.sc.params.get('affectteam') === undefined ? '' : hit.sc.params.get('affectteam')).trim().toLowerCase();
    // What he summons, by the Helper's own name when it is a word (Minotaur's
    // `name = "Horse"`): the grab's name for the viewer.
    const hn = String(h.sc.params.get('name') || '').replace(/^\s*"|"\s*$/g, '').trim();
    // (Nested: the helper that grabs is the one the step waits out; the
    // others on the way are cleared with it.)
    let grabber = h.id, nested = false;
    if (chain.length > 1) {
      const own = W.rootReach(starts.filter((v) => !idOf.has(v)), true);
      if (!own.has(hit.state)) { nested = true; for (const [v, id] of idOf) if (W.rootReach([v], true).has(hit.state)) { grabber = id; break; } }
    }
    // (A press that brings a whole mob - a dozen helpers on the way to the
    // one that grabs, TOBF's a/b/c/x - is the mob prototype's, not one
    // creature's: a press summon has at most one helper before its grabber.)
    if (press && chain.length > 2) continue;
    summons.push(Object.assign({ no: key, helper: grabber, also: nested ? chain.filter((id) => id !== grabber) : [], nested, hub, grab: hit.p2, hold: [...hold], place, helperPlays,
      starts: nested ? starts : starts.filter((v) => !idOf.has(v)),
      edgeOnly: !place && ([...new Set([...starts, hit.state])].some(xMoves) || /^[bf]/.test(at)),
      name: /^[a-z][a-z ]{2,20}$/i.test(hn) ? hn.toLowerCase() : press ? 'summon ' + cmdInfo.get(press).words.replace(/^press /, '') : null },
      press ? { press } : {}));
  }
  // (A nested summon after the ones whose own helper grabs: two that show
  // her the same are one, and the direct one is it - Tendril's 980, not his
  // clone 905 that spawns its helpers.)
  summons.sort((a, b) => (a.nested ? 1 : 0) - (b.nested ? 1 : 0));
  // SIGNALED GRABS: a grab his negative states enter only on a variable a
  // helper of his sets from its own states (Monsters' FlowerGirl walks to her
  // and, close, ParentVarSets var(11) = 1; his -2 goes into the grab 6000 on
  // `var(11) = 1`, and 6000 sets it back to 0). Entered as the game does:
  // through his state that spawns that helper (1000), the helper the step's
  // to clear, placed from the screen edge where it spawns there. The walk
  // still reads the grab itself.
  // THE APPROACH: a state of the helper's way there that goes on toward its
  // signal only once it is close - a ChangeState on `P2BodyDist X <= N` (or
  // its abs) into a state the signal's writer is reached from (FlowerGirl's
  // 1100: `abs(P2BodyDist X) <= 10` -> 1400). Its walk never decides: it adds
  // .17 a tick under physics S, which Ikemen's friction cut (a speed under one
  // pixel stops) keeps at .17 px a tick, half a minute across the screen, and
  // the runtime gave up on the bee and the demon girl before they arrived.
  // The runtime stands it N - 2 px from her (`approach` { id, state, dist }),
  // and its own line takes it on at once. Such a step has no place: it plays
  // where every grab does, at the center.
  // -> base.signaled: grab -> { no, helper, place, approach }
  const signaled = new Map();
  {
    const SIGNAL = /\b(f?var)\s*\(\s*(\d+)\s*\)\s*=\s*(-?\d+)\b(?!\s*[,.])/gi;
    // `P2BodyDist X <= N`, `< N` or the same of its abs, unredirected.
    const NEAR = /\b(abs\s*\(\s*)?p2bodydist\s+x\s*(\)\s*)?(<=?)\s*(\d+)\b(?!\s*\.)/gi;
    const nearOf = (sc) => {
      for (const grp of sc.trig.groups) {
        const txt = [...sc.trig.all, ...grp].join(' && ');
        for (const m of txt.matchAll(NEAR)) {
          if (redirected(txt, m.index) || !!m[1] !== !!m[2]) continue;
          const n = +m[4] - (m[3] === '<' ? 1 : 0);
          if (n >= 0) return n;
        }
      }
      return null;
    };
    const approachOf = (h, from) => {
      const reach = W.rootReach(W.values(h.sc.params.get('stateno'), {}, h.state).filter((v) => an.states.has(v)), true);
      for (const no of reach) {
        if (from.has(no)) continue;
        for (const sc of an.states.get(no).sctrls) {
          if (sc.type !== 'changestate') continue;
          const to = W.values(sc.params.get('value'), {}, no).filter((v) => an.states.has(v) && v !== no);
          if (!to.length || !to.every((v) => [...W.rootReach([v], true)].some((n) => from.has(n)))) continue;
          const dist = nearOf(sc);
          if (dist !== null) return { id: h.id, state: no, dist };
        }
      }
      return null;
    };
    for (const g of grabs) {
      let V = null, k = null, only = true, any = false;
      for (const no of root) {
        if (no === g.no) continue;
        for (const sc of an.states.get(no).sctrls) {
          if ((sc.type !== 'changestate' && sc.type !== 'selfstate') || !W.values(sc.params.get('value'), {}, no).includes(g.no)) continue;
          any = true;
          if (no >= 0) { only = false; break; }
          const ms = [...trigTxt(sc).matchAll(SIGNAL)].filter((m) => !redirected(trigTxt(sc), m.index) && +m[3] !== 0);
          if (ms.length !== 1) { only = false; break; }
          const v = ms[0][1].toLowerCase() + '(' + ms[0][2] + ')';
          if ((V !== null && V !== v) || (k !== null && k !== +ms[0][3])) { only = false; break; }
          V = v; k = +ms[0][3];
        }
        if (!only) break;
      }
      if (!any || !only || V === null) continue;
      // Its only nonzero writers: ParentVarSets in a helper's states.
      let ok = true;
      const from = new Set();
      for (const [no2, s2] of an.states) for (const x of s2.sctrls) {
        if (!/^(var|parentvar)(set|add)$|^varrandom$|^varrangeset$/.test(x.type)) continue;
        for (const [nm, raw] of W.writesOf(x)) {
          if (nm !== V) continue;
          const v = S.lit(raw);
          if ((x.type === 'varset' || x.type === 'parentvarset') && v === 0) continue;
          if (x.type === 'parentvarset' && v !== null && helperReach.has(no2) && !root.has(no2)) from.add(no2);
          else ok = false;
        }
      }
      if (!ok || !from.size) continue;
      for (const h of helperCtrls) {
        if (h.id === null || h.state < 0 || isBasic(h.state) || !root.has(h.state)) continue;
        const reach = W.rootReach(W.values(h.sc.params.get('stateno'), {}, h.state).filter((v) => an.states.has(v)), true);
        if (![...from].some((no2) => reach.has(no2))) continue;
        const pt = String(h.sc.params.get('postype') || '').toLowerCase().replace(/\s+/g, '');
        // (With no approach, she stands near the edge it spawns at: it walks to
        // her before it signals - FlowerGirl at a fifth of a pixel a tick -,
        // and his grab's own reach does the rest. 95 px took longer than the
        // runtime waits. A helper that spawns at the edge behind him -
        // DemonGirl, postype back - has no place the runtime can give: from
        // the edge he faces.)
        const approach = h.id !== null ? approachOf(h, from) : null;
        signaled.set(g.no, { no: h.state, helper: h.id, place: pt === 'front' && !approach ? { front: 40, gap: 60 } : null, approach, v: V, k });
        // (Named by the helper, as a summon is: "flowergirl".)
        const hn = String(h.sc.params.get('name') || '').replace(/^\s*"|"\s*$/g, '').trim();
        if (/^[a-z][a-z ]{2,20}$/i.test(hn)) g.name = hn.toLowerCase();
        break;
      }
    }
  }

  // Only where the answer can change where he goes or what he issues: a
  // ChangeState/TargetState/HitDef, or a VarSet of a variable such a
  // controller reads (closed over VarSets) - not a VarSet that only picks
  // his art (Brian's var(9) missionary flag, read by ChangeAnims alone).
  const FLOW = new Set(['changestate', 'selfstate', 'targetstate', 'hitdef', 'projectile']);
  const exprs = (sc) => [...sc.trig.all, ...sc.trig.groups.flat(), ...sc.params.values()].map(String);
  const flowVars = new Set();
  for (const no of root) for (const sc of an.states.get(no).sctrls) if (FLOW.has(sc.type)) for (const e of exprs(sc)) for (const v of X.varsOf(e)) flowVars.add(v);
  for (let grew = true; grew;) {
    grew = false;
    for (const no of root) for (const sc of an.states.get(no).sctrls) {
      if (!['varset', 'varadd'].includes(sc.type) || !W.writesOf(sc).some(([nm]) => flowVars.has(nm))) continue;
      for (const e of exprs(sc)) for (const v of X.varsOf(e)) if (!flowVars.has(v)) { flowVars.add(v); grew = true; }
    }
  }
  const probes = new Set();
  for (const no of root) for (const sc of an.states.get(no).sctrls) {
    const counts = FLOW.has(sc.type) || (['varset', 'varadd'].includes(sc.type) && W.writesOf(sc).some(([nm]) => flowVars.has(nm)));
    if (!counts) continue;
    for (const e of exprs(sc)) for (const m of e.matchAll(VICTIM_PROBE)) probes.add(+m[1]);
  }
  const chains = new Map(), follows = new Map(), chainPrev = new Map();
  // Her own chain, read on her side: `life` and `alive` are hers, and she is
  // never KO'd in the gallery (1086 -> 6230 on life <= 0 never runs). A
  // chain that asks which state she came from (1222 -> 1267 on PrevStateNo =
  // 1266) is followed only where she can have come from there.
  const herSide = (e) => String(e).replace(/\b(life|alive)\b/gi, (all, w, off, str) => (redirected(str, off) ? all : (w.toLowerCase() === 'life' ? '(' + HER_LIFE + ')' : '(1)')));
  const prevsIn = (list) => {
    const out = new Set();
    for (const x of list) for (const m of String(x).matchAll(/\bprevstateno\s*=\s*(?:\[\s*(\d+)\s*,\s*(\d+)\s*\]|(\d+))/gi)) {
      if (redirected(String(x), m.index)) continue;
      if (m[3] !== undefined) out.add(+m[3]); else for (let n = +m[1]; n <= +m[2] && n - +m[1] < 64; n++) out.add(n);
    }
    return out;
  };
  for (const e of an.edges) {
    if (e.kind === 'chain') {
      const et = e.trig || (e.sc && e.sc.trig);
      if (et) {
        const t = { all: et.all.map(herSide), groups: et.groups.map((g) => g.map(herSide)) };
        let dead = false;
        try { dead = X.evalTriggerSet(t, {}) === false; } catch (err) { dead = false; }
        if (dead) continue;
        let prevs = prevsIn(et.all);
        if (!prevs.size && et.groups.length) {
          const per = et.groups.map(prevsIn);
          if (per.every((p) => p.size)) prevs = new Set(per.flatMap((p) => [...p]));
        }
        if (prevs.size) chainPrev.set(e.from + '>' + e.to, prevs);
      }
      if (!chains.has(e.from)) chains.set(e.from, []); chains.get(e.from).push(e.to);
    }
    else if (e.kind === 'follows' && e.offset !== null) { if (!follows.has(e.from)) follows.set(e.from, []); follows.get(e.from).push(e.to); }
  }
  // His negative states' controllers that a command gates, in the order the
  // engine runs them (-3, -2, -1): a hub's switches include them.
  const negCtrls = [];
  for (const no of [-3, -2, -1]) {
    const s = an.states.get(no);
    if (s) for (const sc of s.sctrls) if (SWITCH_TYPES.has(sc.type) && commandsIn(sc.trig, true).length) negCtrls.push(sc);
  }

  // INSERTION LADDERS (Minotaur): his states x0..x0+4 that put her in
  // c0..c0+4 - the insertion, three speeds and the position's own climax -
  // where x1 -> x2 -> x3 come by time or by the position's own button (a -1
  // VarSet on `StateNo = [x1,x2]` that x1's exit into x2 reads) and x3 -> x4
  // by time alone. The walk sees the whole ladder once the insertion starts
  // (its phases run by time), so the steps come from the ladder itself.
  const ladders = new Map();
  {
    const tsLits = (no) => { const s = an.states.get(no); return s ? s.sctrls.filter((sc) => sc.type === 'targetstate').flatMap((sc) => W.values(sc.params.get('value'), {}, no)) : []; };
    for (const [no] of an.states) {
      if (no < 0 || isBasic(no) || an.scenes.has(no) || ![1, 2, 3, 4].every((i) => an.states.has(no + i))) continue;
      for (const c0 of tsLits(no)) {
        if (![1, 2, 3, 4].every((i) => an.scenes.has(c0 + i) && tsLits(no + i).includes(c0 + i))) continue;
        let own = null;
        for (const sc of negCtrls) {
          if (sc.type !== 'varset') continue;
          const named = statesNamed(sc.trig);
          if (!named || !named.has(no + 1)) continue;
          const cmds = commandsIn(sc.trig).filter((k) => cmdInfo.has(k) && cmdInfo.get(k).playable);
          if (!cmds.length) continue;
          const wrote = W.writesOf(sc).map(([nm]) => nm);
          const reads = an.states.get(no + 1).sctrls.some((c) => c.type === 'changestate' && W.values(c.params.get('value'), {}, no + 1).includes(no + 2)
            && [...c.trig.all, ...c.trig.groups.flat()].some((e) => X.varsOf(String(e)).some((v) => wrote.includes(v))));
          if (reads) { own = { cmd: cmds[0], from: [no + 1, no + 2].filter((n) => named.has(n)), sc }; break; }
        }
        // (Only with its own button: a chain that runs by time alone - kuromaru's
        // slime insertion chain - is one scene of the switch that starts it.)
        if (own) ladders.set(no, { x0: no, c0, own });
        break;
      }
    }
    for (const L of ladders.values()) {
      const fam = [...ladders.values()].filter((M) => Math.floor(M.x0 / 100) === Math.floor(L.x0 / 100)).map((M) => M.x0).sort((a, b) => a - b);
      L.n = fam.indexOf(L.x0) + 1;
    }
  }

  // THE AI FLAG. A variable that no VarSet of his can make nonzero with any
  // command a player can enter and AILevel 0 keeps its round-start value, 0,
  // for the gallery's giver (Kuromaru 4's var(51); kuromaru_plus's, whose AI
  // VarSet also reads helper(10000), a helper he never spawns). An XOR of
  // two aliases (dragon_futa2's `holdfwd ^^ holdfwd2`, an AI detector) is
  // false for a player, and the hook asserts both: COMMAND ALIASES.
  const playable = new Set([...cmdInfo.values()].filter((c) => c.playable).map((c) => c.name));
  const writers = [];
  const touched = new Set();
  for (const no of root) for (const sc of an.states.get(no).sctrls) {
    if (!['varset', 'varadd', 'varrandom'].includes(sc.type)) continue;
    const writes = W.writesOf(sc).filter(([name]) => VARNAME.test(name));
    if (!writes.length) continue;
    writers.push({ no, sc, writes });
    for (const [name] of writes) touched.add(name);
  }
  // A variable his own states read but none of them writes (nor a helper's
  // ParentVarSet) keeps its round-start 0 all match: Minotaur's AI switch
  // var(59) is set only inside his AI helper's own states.
  const neverWritten = new Set();
  {
    const read = new Set(), written = new Set();
    for (const no of root) for (const sc of an.states.get(no).sctrls) {
      for (const e of [...sc.trig.all, ...sc.trig.groups.flat(), ...sc.params.values()]) {
        const str = String(e);
        for (const v of X.varsOf(str)) if (VARNAME.test(v)) read.add(v);
        for (const m of str.matchAll(/\b(f?var)\s*\(\s*(\d+)\s*\)\s*:=/gi)) written.add(m[1].toLowerCase() + '(' + m[2] + ')');
      }
      for (const [nm] of W.writesOf(sc)) written.add(nm);
    }
    for (const st of an.states.values()) for (const sc of st.sctrls) {
      if (!/^parentvar(set|add)$/.test(sc.type) && !/^varrangeset$/.test(sc.type)) continue;
      if (sc.type === 'varrangeset') { for (let i = 0; i < 60; i++) { written.add('var(' + i + ')'); written.add('fvar(' + i + ')'); } continue; }
      for (const [nm] of W.writesOf(sc)) written.add(nm);
    }
    for (const v of read) if (!written.has(v)) neverWritten.add(v);
  }
  const initial = {};
  for (const name of neverWritten) initial[name] = [0];
  {
    const nonzero = new Set();
    for (const w of writers) {
      const fires = W.trig(w.sc, {}, playable, w.no) !== false;
      for (const [name, raw] of w.writes) if (fires && (w.sc.type !== 'varset' || S.lit(raw) !== 0)) nonzero.add(name);
    }
    for (const name of touched) if (!nonzero.has(name)) initial[name] = [0];
  }

  // WHAT ONE ASSERTED COMMAND CAN CHANGE. A variable keeps its round-start 0
  // until a VarSet that can fire with that command - and with the variables
  // still pinned - writes it something else, to a fixpoint. The setup's
  // variables keep their value. `inputs`: a Set of command names.
  // `scope` (a Set of his states): only VarSets in those states and his
  // negative states count - a grab's own machine. Minotaur's var(1), written
  // only by his normals' cancel windows, stays 0 through the buster, so the
  // super throw his -1 allows on `var(1)` is no switch there.
  const pinMemo = new Map();
  const scopeIds = new WeakMap();
  let frozen = {};
  const pinsFor = (inputs, scope) => {
    if (scope && !scopeIds.has(scope)) scopeIds.set(scope, [...scope].sort((a, b) => a - b).join(','));
    const key = inputsKey(inputs) + (scope ? '@' + scopeIds.get(scope) : '');
    if (pinMemo.has(key)) return pinMemo.get(key);
    const A = {};
    for (const name of touched) A[name] = [0];
    for (const name of neverWritten) A[name] = [0];
    for (const [k, v] of Object.entries(frozen)) A[k] = [v];
    for (let changed = true; changed;) {
      changed = false;
      for (const w of writers) {
        if (scope && w.no >= 0 && !scope.has(w.no)) continue;
        if (scope && w.no < 0) { const named = statesNamed(w.sc.trig); if (named && ![...named].some((n) => scope.has(n))) continue; }
        if (!w.writes.some(([name]) => A[name] && !Object.prototype.hasOwnProperty.call(frozen, name))) continue;
        if (W.trig(w.sc, A, inputs, w.no) === false) continue;
        for (const [name, raw] of w.writes) {
          if (!A[name] || Object.prototype.hasOwnProperty.call(frozen, name)) continue;
          if (w.sc.type !== 'varrandom') {
            const vals = W.values(raw, A, w.no);
            if (vals.length && vals.every((x) => x === 0)) continue;
          }
          delete A[name];
          changed = true;
        }
      }
    }
    pinMemo.set(key, A);
    return A;
  };

  // THE CONTINUOUS MODE OF A LADDER (Minotaur's var(52), his "keep going"): the one
  // variable that keeps x3 from climaxing by time (1613 -> 1614 on `!Var(52)`
  // and `Time >= 120`), written by nothing but a toggle a player makes (his c:
  // VarAdd ifelse(Var(52),-1,1)) and by writers the gallery's pair never runs
  // (his AI's `var(59) >= 1` reset, shut with every variable pinned as any
  // command a player has leaves it). The hook SETS it (a set is not the
  // toggle command): on, a position or speed stays on screen; off, the climax
  // comes by time once its own step turns it off.
  const anyPins = ladders.size ? pinsFor(playable) : null;
  for (const L of ladders.values()) {
    const x3 = an.states.get(L.x0 + 3);
    if (!x3) continue;
    for (const sc of x3.sctrls) {
      if (L.cont || sc.type !== 'changestate' || !W.values(sc.params.get('value'), {}, L.x0 + 3).includes(L.x0 + 4)) continue;
      const txt = trigTxt(sc);
      if (!new RegExp(TIME_ATOMS.source, 'i').test(txt)) continue;
      const rw = (e) => String(e).replace(TIME_ATOMS, '1');
      const t = { all: sc.trig.all.map(rw), groups: sc.trig.groups.map((g) => g.map(rw)) };
      for (const v of [...new Set([...sc.trig.all, ...sc.trig.groups.flat()].flatMap((e) => X.varsOf(String(e))))].filter((x) => VARNAME.test(x))) {
        const at = (x) => { try { return X.evalTriggerSet(t, { [v]: x, isHelper: false }); } catch (e) { return null; } };
        if (at(0) !== true) continue;
        const on = [1, -1].find((x) => at(x) === false);
        if (on === undefined) continue;
        let toggles = 0, other = false;
        for (const [no, st] of an.states) for (const w of st.sctrls) {
          if (!/^(parent)?var(set|add|random)$/.test(w.type)) continue;
          for (const [nm, raw] of W.writesOf(w)) {
            if (nm !== v) continue;
            if (w.type !== 'varrandom' && X.varsOf(String(raw)).includes(v)) { toggles++; continue; }
            if (W.trig(w, anyPins, playable, no) !== false) other = true;
          }
        }
        if (!toggles || other) continue;
        const ref = varRef(v);
        L.cont = { kind: ref.kind, index: ref.index, on, off: 0 };
        break;
      }
    }
  }

  // VISUAL VARIABLES: what her custom states read of him to pick her art
  // (kuromaru's variant: `enemynear,var(35)` picks her 180xxx/181xxx/182xxx).
  const visual = new Set();
  const readVars = (e, via) => { try { return X.readsOf(e).filter((r) => (via ? HIM.has(r.via) : !r.via) && VARNAME.test(r.field)).map((r) => r.field); } catch (err) { return []; } };
  for (const C of hScenes) {
    const s = an.states.get(C);
    if (s) for (const sc of s.sctrls) {
      if (sc.type !== 'changeanim' && sc.type !== 'changeanim2') continue;
      for (const e of [...sc.trig.all, ...sc.trig.groups.flat(), sc.params.get('value')]) if (e !== undefined) for (const f of readVars(e, true)) visual.add(f);
    }
  }

  // THE NAME OF EACH GRAB, for the viewer: the move name his .cmd gives the
  // -1 ChangeState a player starts it with (an ASCII label that is no
  // command name: Kur0maru's "Buster", "Triangular horse"), else the input
  // (Minotaur's labels are Japanese: "grab F,D,B,b"), else an AI block's
  // label, else its number. A launcher counts (236236a -> 1900 -> 1903). A
  // summon is named for the helper it calls when that helper's name is a word
  // (Minotaur's "horse"). A move his -1 gives two names (Kur0maru's "Beam a"
  // and "Beam b", both 4700) has neither: the simplest input of those blocks.
  const grabNames = new Map();
  {
    const leadsTo = (from, to) => {
      const seen = new Set(), q = [[from, 0]];
      while (q.length) {
        const [no, d] = q.shift();
        if (no === to) return true;
        if (seen.has(no) || d >= 3 || isBasic(no) || !an.states.has(no)) continue;
        seen.add(no);
        for (const sc of an.states.get(no).sctrls) if (sc.type === 'changestate') for (const v of W.values(sc.params.get('value'), {}, no)) q.push([v, d + 1]);
      }
      return false;
    };
    const cmdNames = new Set([...commands.keys()].map((k) => k.toLowerCase()));
    const human = new Map(), words = new Map(), ai = new Map(), labels = new Map();
    const note = (m, no, v) => { if (!m.has(no)) m.set(no, v); };
    const byLabel = new Map();   // grab -> the words of its labeled blocks, with their rank
    for (const neg of [-1, -2, -3]) {
      const st = an.states.get(neg);
      if (!st) continue;
      for (const sc of st.sctrls) {
        if (sc.type !== 'changestate') continue;
        // (A value that reads a command - `800+(command = "holdback")` - is
        // each of its answers.)
        const rawV = String(sc.params.get('value'));
        const vals = [...W.values(sc.params.get('value'), {}, neg), ...(/\bcommand\b/i.test(rawV)
          ? [new Set(), new Set(commandsIn(sc.trig).concat([...rawV.matchAll(/command\s*=\s*"([^"]*)"/gi)].map((m) => m[1])))].map((inp) => X.evalExpr(rewriteAtoms(rawV, inp, neg), {})).filter((v) => typeof v === 'number' && Number.isFinite(v)).map(Math.trunc) : [])];
        const hits = [...grabs, ...summons].filter((g) => vals.some((v) => v === g.no || leadsTo(v, g.no)));
        if (!hits.length) continue;
        const cmdsHere = commandsIn(sc.trig).filter((k) => cmdInfo.has(k) && cmdInfo.get(k).playable);
        const forHuman = cmdsHere.length > 0 && W.trig(sc, initial, new Set(cmdsHere), neg) !== false;
        const lab = String(sc.label || '').trim();
        const okLabel = /^[\x20-\x7e]+$/.test(lab) && /[a-z]{3}/i.test(lab) && !cmdNames.has(lab.toLowerCase()) && ![...cmdNames].some((k) => k.length > 2 && lab.toLowerCase() === k);
        for (const g of hits) {
          if (forHuman) {
            // (Two names count only on blocks that enter it themselves: a
            // launcher's fallback - the milking 51300's toilet 51205 - is
            // another move's.)
            const direct = okLabel && vals.includes(g.no);
            if (direct && !labels.has(g.no)) { labels.set(g.no, new Set()); byLabel.set(g.no, []); }
            if (okLabel) note(human, g.no, lab);
            if (direct) labels.get(g.no).add(lab.toLowerCase());
            // Two commands one trigger line needs together (Minotaur's b and
            // y on one tick) are one input: b+y.
            const combo = sc.trig.groups.map((gr) => commandsIn({ all: sc.trig.all, groups: [gr] }).filter((k) => cmdsHere.includes(k))).find((ks) => ks.length > 1);
            const best = cmdsHere.slice().sort((a, b) => cmdInfo.get(a).rank - cmdInfo.get(b).rank)[0];
            const w = combo ? combo.map((k) => cmdInfo.get(k).words.replace(/^(motion|press) /, '')).join('+')
              : cmdInfo.get(best).words.replace(/^(motion|press) /, '');
            note(words, g.no, 'grab ' + w);
            if (direct) byLabel.get(g.no).push({ w: 'grab ' + w, rank: combo ? 300 : cmdInfo.get(best).rank });
          } else if (okLabel) note(ai, g.no, lab);
        }
      }
    }
    // A label an author gave two different moves names neither.
    const useOf = (maps) => {
      const u = new Map();
      for (const m of maps) for (const [no, v] of m) { const k = v.toLowerCase(); if (!u.has(k)) u.set(k, new Set()); u.get(k).add(no); }
      return (v) => (v && u.get(v.toLowerCase()).size === 1 ? v : null);
    };
    const uniqHuman = useOf([human]), uniqAi = useOf([human, ai]);
    const used = new Map();
    // A helper name several summons share (Kur0maru's three "dog" helpers) is
    // told apart by each one's input: "dog hold Back+z", "dog hold Down+z".
    const helperNames = new Map();
    for (const g of summons) if (g.name) helperNames.set(g.name, (helperNames.get(g.name) || 0) + 1);
    for (const g of [...grabs, ...summons]) {
      const twoNames = labels.has(g.no) && labels.get(g.no).size > 1;
      const simplest = twoNames ? byLabel.get(g.no).slice().sort((a, b) => a.rank - b.rank)[0].w : null;
      const hname = g.name && helperNames.get(g.name) > 1 && words.has(g.no) ? g.name + ' ' + words.get(g.no).replace(/^grab /, '') : g.name;
      let n = (twoNames ? null : uniqHuman(human.get(g.no))) || hname || simplest || words.get(g.no) || uniqAi(ai.get(g.no)) || 'grab ' + g.no;
      n = n.replace(/[^\x20-\x7e]/g, '?').replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
      const k = n.toLowerCase();
      used.set(k, (used.get(k) || 0) + 1);
      if (used.get(k) > 1) n += ' (' + used.get(k) + ')';
      grabNames.set(g.no, n);
    }
  }

  const base = { dir, def, an, gAir, gAirTicks, airTimes, commands, cmdInfo, cmdAlias, power, helperIds, helperCtrls, hScenes, root, helperReach, grabs, grabNames, launchers,
    probes: [...probes].sort((a, b) => a - b), walkList: [], chains, follows, chainPrev, broken, readsHer, ladders, helperFollow, summons, signaled, initial, pinsFor, negCtrls, visual, walks: new Map(),
    setup: [], frozen: {}, offCtrls: new Set(), walkerOpts };
  // THE SETUP, then the pins under it.
  detectSetup(base, W);
  frozen = base.frozen;
  pinMemo.clear();
  base.walkerOpts = Object.assign({}, walkerOpts, { frozen: base.frozen, offCtrls: base.offCtrls, sharedFlows: new Map(), relevantVars: new Set([...flowVars, ...visual]) });
  // His companion, driven by his own commands in his stance.
  base.companions = readCompanions(base, W, standingGrab);
  // (His own flow its release made look like hers - readCompanions: his
  // stance 66000 and his 69230 - is no scene of hers.)
  base.ownFlow = new Set(base.companions.flatMap((C) => [...(C.ownFlow || [])]));
  for (const c of base.ownFlow) base.hScenes.delete(c);
  // (Where her HUD is no answer: its scenes.)
  base.companionScenes = new Set(base.companions.flatMap((C) => [...C.scenes]));
  // (The readers above, for a prototype mode's read(base, ctx): ctx.fns.
  // Not enumerable, so nothing that copies or prints a base carries them.)
  Object.defineProperty(base, 'fns', { value: Object.freeze({ W, standingGrab, issuesCustom, issuesAtOnce, HIT_GATE, trigTxt, xMoves, helperReach }), enumerable: false });
  base.baseMs = Date.now() - t0;
  return base;
}

// ---- the companion ------------------------------------------------------------------
// THE NAMES OF A COMPANION'S ART VARIANTS, for its steps' labels only. His
// files carry no name for them (41401's var(3) picks sprite family 2224 or
// 2225, 51488's var(33) 6961 or 6350); these are what the pixels show, looked
// at in the headless runs (GRAIL 4.10b): Bao upright on his knees behind
// her, or bent over her back; her lying under him, or sitting on top of him. Declared by the helper's
// id, as HELPER_RECEIVERS is: there is no second companion to read a rule
// from. Any other variant is "art <value + 1>".
const COMPANION_ART_NAMES = { 69000: { 'var(3)': ['upright', 'bent over'], 'var(33)': ['under him', 'on top'] } };
// A trigger set of a state as the engine reads it there: `stateno` is that
// state (un-redirected), and a probe of a sum of numbers is of the sum
// (`!target,selfanimexist(stateno+228812)` in 51488 asks her for 280300).
function stateTrig(trig, no) {
  const fix = (e) => {
    const s = String(e);
    let out = '';
    let i = 0;
    for (const m of s.matchAll(/\bstateno\b/gi)) {
      out += s.slice(i, m.index) + (redirected(s, m.index) ? m[0] : String(no));
      i = m.index + m[0].length;
    }
    out += s.slice(i);
    return out.replace(/(animexist\s*\(\s*)(\d+)\s*\+\s*(\d+)(\s*\))/gi, (x, a, b, c2, d) => a + (+b + +c2) + d);
  };
  return { all: trig.all.map(fix), groups: trig.groups.map((g) => g.map(fix)) };
}
// A COMPANION is the helper the setup keeps from spawning because it grabs her
// on its own (Brian's Striker, helper 69000, behind var(14)). Its own steps
// release the gate and play it the way his readme says a player does
// ("Command Stance"): he stands in a STANCE, a state of his a command of his
// enters from his negative states (Brian's 66000 on s), in which the
// companion's own lines read him:
//   ITS GRAB: a line of the companion's (a negative-state ChangeState only a
//     helper runs) into a state of its whose HitDef catches her, on
//     `Root,StateNo = <stance>` and a command read from its OWN command list
//     (a helper with keyctrl reads the player's keys through a copy of his:
//     Brian's `Root,stateno = 66000 && Command = "holddown"` -> 41400), from
//     the idle states that line names (69000-69003). Where the HitDef's
//     p1/p2stateno depend on a variable its state draws at random (41400's
//     fvar(1) = random%100: > 50 is the intro 41399/41398, else the rapid
//     grab 21998/21999), each outcome is a FAMILY, pinned by the hook on the
//     companion to a value inside it.
//   ITS POSITIONS: a counter of its own that his command adds to (`parent,
//     command = "b"` -> var(2) += 1, while it is in one of the states that
//     line names) and its ChangeStates on the counter's value (1 -> 41488,
//     2 -> 41401, 3 -> 22000, 4 -> 51488): position k is k presses away from
//     a fresh grab, and a pressed position stays (the ChangeState fires again
//     whenever it is elsewhere in the set).
// Read from his files; the runtime only gets the numbers the steps carry.
function readCompanions(base, W, standingGrab) {
  const { an, cmdInfo } = base;
  const out = [];
  const trigTxt = (sc) => [...sc.trig.all, ...sc.trig.groups.flat()].join(' ');
  const helperOnly = (sc) => { try { return X.evalTriggerSet(sc.trig, { isHelper: false }) === false; } catch (e) { return false; } };
  const negLines = [];
  for (const neg of [-3, -2, -1]) { const st = an.states.get(neg); if (st) for (const sc of st.sctrls) negLines.push(sc); }
  const playable = (k) => cmdInfo.has(k) && cmdInfo.get(k).playable;
  const byRank = (a, b) => cmdInfo.get(a).rank - cmdInfo.get(b).rank || (a < b ? -1 : 1);
  const STANCE_RE = /\b(?:root|parent)\s*,\s*stateno\s*=\s*(\d+)\b/i;
  const HIS_CMD_RE = /\b(?:root|parent)\s*,\s*command\s*=\s*"([^"]*)"/gi;
  // The states a triggerall line names (`stateno = 41488 || stateno =
  // [22000,22300]`), as ranges: the first line that names some.
  const rangesNamed = (list) => {
    for (const x of list) {
      const out = [];
      for (const alt of String(x).split('||')) {
        const m = /(?:^|[^,\w])stateno\s*=\s*(?:\[\s*(\d+)\s*,\s*(\d+)\s*\]|(\d+))/i.exec(alt);
        if (!m) { out.length = 0; break; }
        out.push(m[3] !== undefined ? [+m[3], +m[3]] : [+m[1], +m[2]]);
      }
      if (out.length) return out;
    }
    return null;
  };
  for (const cg of base.companionGates || []) {
    const { h, gate } = cg;
    // It reads commands only with keyctrl (char.go: a helper without it has
    // no command list of its own and command() is false).
    const kc = S.lit(String(h.sc.params.get('keyctrl') === undefined ? '' : h.sc.params.get('keyctrl')).split(',')[0]);
    if (!kc) continue;
    // The value his own files release the gate with (Brian's config state
    // 999969: var(14) = 1).
    let spawn = null;
    for (const [no, s] of an.states) {
      if (spawn) break;
      for (const sc of s.sctrls) {
        if (sc.type !== 'varset') continue;
        for (const [nm, raw] of W.writesOf(sc)) {
          const x = S.lit(raw);
          if (nm !== gate.name || x === null || x === gate.hold) continue;
          if (X.evalTriggerSet(h.sc.trig, { [nm]: x, isHelper: false }) === false) continue;
          spawn = { value: x, state: no };
          break;
        }
        if (spawn) break;
      }
    }
    if (!spawn) continue;
    // Its other gates, at the values that same state writes (Brian's config
    // 999969 has "bao ON/OFF" var(55) = 1 beside the Striker's var(14), and
    // the Helper wants both): a value that shuts the Helper's trigger set
    // means it never spawns, so it has no steps. Only a variable nothing else
    // of his can write in the gallery is the config's to decide (his AI's
    // `var(59) = [1,14]` lines that also set var(55) never fire there).
    {
      const inputs = new Set([...cmdInfo.values()].filter((c) => c.playable).map((c) => c.name));
      const A = base.pinsFor(inputs);
      const writers = new Map();
      for (const [no, s] of an.states) for (const sc of s.sctrls) {
        if (!['varset', 'varadd', 'varrandom', 'parentvarset', 'parentvaradd'].includes(sc.type)) continue;
        if (no !== spawn.state && W.trig(sc, A, inputs, no) === false) continue;
        for (const [nm] of W.writesOf(sc)) writers.set(nm, (writers.get(nm) || 0) + 1);
      }
      const cfg = { [gate.name]: spawn.value, isHelper: false };
      for (const sc of an.states.get(spawn.state).sctrls) {
        if (sc.type !== 'varset' || X.evalTriggerSet(sc.trig, {}) !== true) continue;
        for (const [nm, raw] of W.writesOf(sc)) {
          const x = S.lit(raw);
          if (x !== null && nm !== gate.name && writers.get(nm) === 1) cfg[nm] = x;
        }
      }
      if (X.evalTriggerSet(h.sc.trig, cfg) === false) continue;
    }
    const own = negLines.filter(helperOnly);
    // Its grab by its own command in his stance.
    let grab = null;
    for (const sc of own) {
      if (grab || sc.type !== 'changestate') continue;
      const G = S.lit(sc.params.get('value'));
      const gs = G === null ? null : an.states.get(G);
      if (!gs) continue;
      const hd = gs.sctrls.find((c) => c.type === 'hitdef' && standingGrab(c));
      if (!hd) continue;
      for (const grp of sc.trig.groups) {
        const m = STANCE_RE.exec(grp.join(' && '));
        if (!m) continue;
        const N = +m[1];
        const cmds = commandsIn({ all: [], groups: [grp] }).filter(playable).sort(byRank);
        if (!cmds.length || !an.states.has(N)) continue;
        // The stance: a state of his his negative states enter on a command
        // of his (Brian's -2 `command = "s"` -> 66000).
        const into = negLines.find((c) => !helperOnly(c) && c.type === 'changestate' && S.lit(c.params.get('value')) === N && commandsIn(c.trig).some(playable));
        if (!into) continue;
        const ready = statesNamed({ all: sc.trig.all, groups: [] });
        grab = { state: G, hd, cmd: cmds[0], stance: N, stanceCmd: commandsIn(into.trig).filter(playable).sort(byRank)[0], ready: ready ? [...ready].sort((a, b) => a - b) : [] };
        break;
      }
    }
    if (!grab || !grab.ready.length) continue;
    // Its families: the outcomes of the variable its grab state draws.
    const p1raw = grab.hd.params.get('p1stateno'), p2raw = grab.hd.params.get('p2stateno');
    const drawn = [...new Set([...X.varsOf(String(p1raw || '')), ...X.varsOf(String(p2raw || ''))])].filter((v) => VARNAME.test(v));
    const families = [];
    if (drawn.length === 1) {
      const v = drawn[0];
      const setter = an.states.get(grab.state).sctrls.find((c) => c.type === 'varset' && W.writesOf(c).some(([nm, raw]) => nm === v && /\brandom\b/i.test(String(raw))));
      if (setter) {
        const raw = W.writesOf(setter).find(([nm]) => nm === v)[1];
        const samples = [...new Set(X.evalRandom(String(raw), {}).filter(Number.isFinite).map(Math.trunc))].sort((a, b) => a - b);
        const by = new Map();
        for (const x of samples) {
          const p1 = W.values(p1raw, { [v]: [x] }, grab.state), p2 = W.values(p2raw, { [v]: [x] }, grab.state);
          if (p1.length !== 1 || p2.length !== 1) continue;
          const key = p1[0] + '>' + p2[0];
          if (!by.has(key)) by.set(key, { p1: p1[0], p2: p2[0], xs: [] });
          by.get(key).xs.push(x);
        }
        const ref = varRef(v);
        // The pin: the middle of the values that give the outcome (clear of
        // its edges).
        for (const f of by.values()) families.push({ p1: f.p1, p2: f.p2, pin: { kind: ref.kind, index: ref.index, value: f.xs[Math.floor(f.xs.length / 2)] } });
      }
    }
    if (!families.length) {
      const p1 = W.values(p1raw, {}, grab.state), p2 = W.values(p2raw, {}, grab.state);
      if (p1.length === 1 && p2.length === 1) families.push({ p1: p1[0], p2: p2[0], pin: null });
    }
    if (!families.length) continue;
    // Its positions: a counter his command adds to, and its ChangeStates on
    // the counter's value.
    // (A counter: one press adds 1, in the states the line names; of several,
    // the one the most ChangeStates read.)
    let counter = null, positions = [];
    for (const sc of own) {
      if (sc.type !== 'varadd') continue;
      const his = [...new Set([...trigTxt(sc).matchAll(HIS_CMD_RE)].map((m) => m[1]))].filter(playable);
      if (his.length !== 1) continue;
      const w = W.writesOf(sc);
      if (w.length !== 1 || !VARNAME.test(w[0][0]) || S.lit(w[0][1]) !== 1) continue;
      const set = rangesNamed(sc.trig.all);
      if (!set) continue;
      const ref = varRef(w[0][0]);
      const cand = { name: w[0][0], kind: ref.kind, index: ref.index, cmd: his[0], set };
      const inSet = (n) => set.some(([a, b]) => n >= a && n <= b);
      const esc = cand.name.replace(/[()]/g, (c) => '\\' + c);
      const re = new RegExp('(^|[^,\\w])' + esc + '\\s*=\\s*(\\d+)\\b', 'i');
      const ps = [];
      for (const c of own) {
        if (c.type !== 'changestate') continue;
        const P = S.lit(c.params.get('value'));
        if (P === null || !an.states.has(P) || !inSet(P)) continue;
        const m = re.exec(trigTxt(c));
        if (!m || +m[2] < 1 || ps.some((p) => p.k === +m[2])) continue;
        // Its home: the states the line leaves it in (`stateno !=
        // [22000,22300]`: 22000 goes on to 22100-22300 by its meter).
        const hm = /\bstateno\s*!=\s*(?:\[\s*(\d+)\s*,\s*(\d+)\s*\]|(\d+))/i.exec(trigTxt(c));
        const home = hm ? (hm[3] !== undefined ? [[+hm[3], +hm[3]]] : [[+hm[1], +hm[2]]]) : [[P, P]];
        ps.push({ k: +m[2], state: P, home });
      }
      if (ps.length > positions.length) { counter = cand; positions = ps.sort((a, b) => a.k - b.k); }
    }
    // ITS ART VARIANTS: a variable of its own that its lines or states draw
    // at random (`random` in a VarSet's value or trigger) and that its
    // animations read, in the states its steps show: 41401's `random%100 <=
    // 50` sets var(3) = 1 on its first tick and its anims are 463xxx +
    // var(3)*10000 (him upright behind her, or bent over her back); its idle
    // state and the line into 51488 draw var(33) = random%2 and 51488 plays
    // 465001 + var(33)*1000 (her lying under him, or sitting on him). One step
    // shows one of them, so each is pinned on it at the value it spawns with,
    // 0 - the variant its own speed lines read too (a/x act on `anim =
    // 463001+(var(3)*10000)` only then). The family's variable is pinned
    // already and the counter is the step's. A copy of one into his own
    // variables (its ParentVarSet `var(23) = var(33)`, which her 51409 reads
    // for her art on its first tick) is held on him at the same value: its
    // `mirrors`.
    const shows = new Set([grab.state, ...families.map((f) => f.p1), ...positions.map((p) => p.state)]);
    {
      const inRanges = (n) => !!counter && counter.set.some(([a, b]) => n >= a && n <= b);
      const q = [...shows];
      while (q.length) {
        const s = an.states.get(q.shift());
        if (!s) continue;
        for (const sc of s.sctrls) {
          if (sc.type !== 'changestate' && sc.type !== 'selfstate') continue;
          const raw = String(sc.params.get('value') === undefined ? '' : sc.params.get('value'));
          const lit = S.lit(raw);
          for (const n of lit !== null ? [lit] : X.leavesOf(raw)) if (inRanges(n) && an.states.has(n) && !shows.has(n)) { shows.add(n); q.push(n); }
        }
      }
    }
    const ownVars = (raw) => X.readsOf(String(raw === undefined ? '' : raw)).filter((r) => r.via === null && VARNAME.test(r.field)).map((r) => r.field.toLowerCase());
    const animReads = new Set();
    for (const no of shows) {
      const s = an.states.get(no);
      if (!s) continue;
      for (const v of ownVars(s.anim)) animReads.add(v);
      for (const sc of s.sctrls) {
        const k = sc.type === 'changeanim' || sc.type === 'changeanim2' ? 'value' : sc.type === 'explod' ? 'anim' : null;
        if (k) for (const v of ownVars(sc.params.get(k))) animReads.add(v);
      }
    }
    const random = (sc) => [...sc.trig.all, ...sc.trig.groups.flat()].some((e) => X.usesRandom(String(e)));
    const drawnAt = new Set();
    const drawLines = [...own, ...negLines.filter((sc) => !own.includes(sc) && /\bstateno\b/i.test(trigTxt(sc)) && [...(rangesNamed(sc.trig.all) || [])].some(([a, b]) => [...shows].some((n) => n >= a && n <= b)))];
    for (const no of [...shows, ...grab.ready]) { const s = an.states.get(no); if (s) drawLines.push(...s.sctrls); }
    for (const sc of drawLines) {
      if (sc.type !== 'varset' && sc.type !== 'varadd') continue;
      for (const [nm, raw] of W.writesOf(sc)) if (VARNAME.test(nm) && (X.usesRandom(String(raw)) || random(sc))) drawnAt.add(nm.toLowerCase());
    }
    const skip = new Set([...families.map((f) => f.pin && (f.pin.kind + '(' + f.pin.index + ')')), counter && counter.name.toLowerCase()].filter(Boolean));
    const art = [...drawnAt].filter((v) => animReads.has(v) && !skip.has(v)).sort().map((v) => Object.assign(varRef(v), { value: 0, art: true }));
    const mirrors = [];
    for (const sc of [...negLines, ...drawLines]) {
      if (sc.type !== 'parentvarset') continue;
      for (const [nm, raw] of W.writesOf(sc)) {
        const src = String(raw === undefined ? '' : raw).trim().toLowerCase();
        const a = art.find((x) => x.kind + '(' + x.index + ')' === src);
        const ref = varRef(nm);
        if (a && ref && !mirrors.some((m) => m.kind === ref.kind && m.index === ref.index)) mirrors.push(Object.assign(ref, { value: a.value, of: src }));
      }
    }
    // ITS SCENES: her states that only its states give her (every way in is
    // from one of its states, or from another of them). There, her HUD is no
    // answer (receiverHud: Mai's groove label 22001 in its 22001).
    const scenes = new Set();
    // HIS OWN FLOW READ AS HERS: its escape's `TargetState value = 0` (41401,
    // on `var(10) >= 49`) makes his 0 look like one of her custom states, and
    // his own ChangeStates on from it like her chain - his stance 66000 (from
    // his 0 on s) and his threesome 69230 (from 66000 on c). A state every way
    // into which is such a chain, from a basic state its release targets, is
    // his: never her scene (giverBase drops it from his scenes), and neither a
    // basic state nor it is one of its scenes. (The same reading in givers with
    // no companion - kuromaru_girl_plus, kuromaru_c, Umbra ero in his other
    // builds - is left as it was: it would change their counts.)
    const ownFlow = new Set();
    {
      // (Its states: those its steps show, its idle states, and where its own
      // lines send it - its AI's ground grab 69198 gives her 51409 too.)
      const mine = new Set([...shows, ...grab.ready]);
      for (const sc of own) if (sc.type === 'changestate') { const v = S.lit(sc.params.get('value')); if (v !== null) mine.add(v); }
      const released = new Set([...an.scenes].filter(([c, sc]) => isBasic(c) && sc.entries.some((e) => mine.has(e.from))).map(([c]) => c));
      for (let grew = true; grew;) {
        grew = false;
        for (const [c, sc] of an.scenes) {
          if (ownFlow.has(c) || isBasic(c) || !sc.entries.length) continue;
          if (sc.entries.every((e) => e.kind === 'chain' && (released.has(e.from) || ownFlow.has(e.from)))) { ownFlow.add(c); grew = true; }
        }
      }
      for (let changed = true; changed;) {
        changed = false;
        for (const [c, sc] of an.scenes) {
          if (scenes.has(c) || !sc.entries.length || isBasic(c) || ownFlow.has(c)) continue;
          if (sc.entries.every((e) => mine.has(e.from) || scenes.has(e.from))) { scenes.add(c); changed = true; }
        }
      }
    }
    // Its names: the Helper's own name ("Striker"), and the one the author
    // wrote beside the controller that spawns it (`[State -2, A/Helper_1];
    // Bao`) - his name for it.
    const hn = String(h.sc.params.get('name') || '').replace(/^\s*"|"\s*$/g, '').trim();
    let author = '';
    try {
      const abs = modlib.resolveCI(base.dir, h.sc.file);
      const line = abs ? fs.readFileSync(abs, 'latin1').split('\n')[h.sc.line - 1] : '';
      const m = /^\s*\[[^\]]*\]\s*;\s*([A-Za-z][A-Za-z0-9 ]{1,15}?)\s*$/.exec(line || '');
      if (m) author = m[1];
    } catch (e) { author = ''; }
    const word = /^[A-Za-z][A-Za-z0-9 ]{1,15}$/.test(hn) ? hn : '';
    const name = author || word || 'helper ' + h.id;
    const group = word && author && word.toLowerCase() !== author.toLowerCase() ? word + ' ' + author : name;
    // Where it spawns: behind him (Brian's pos = -100,0 from p1) puts it
    // between him and a screen edge he turns his back to.
    const pt = String(h.sc.params.get('postype') || 'p1').replace(/\s+/g, '').toLowerCase();
    const px = S.lit(String(h.sc.params.get('pos') || '0').split(',')[0]);
    const play = readCompanionPlay({ an, W, negLines, counter, positions, art, mirrors, shows, drawLines, gAir: base.gAir, gAirTicks: base.gAirTicks, hScenes: base.hScenes });
    // ITS JOINS: a state of his his stance enters on a command of his, where
    // the companion's own lines put her in a scene of theirs - he and it on
    // her at once, a threesome (Brian's 66000 `anim = 66002 && command = "c"
    // && var(45) = 1` -> his 69230, and its -2 `parent,stateno = 69230` ->
    // TargetState 69232). Its gates: a variable of his that line compares
    // with a number and that only a ParentVarSet of the companion's writes,
    // from a probe of her (`var(45) = ifelse(target,selfanimexist(69229),1,
    // 0)`): the step is hers only where the probe gives the value the line
    // wants (a partner lacking 69229 never gets past the stance).
    const joins = [];
    const stanceSt = an.states.get(grab.stance);
    for (const sc of stanceSt ? stanceSt.sctrls : []) {
      if (sc.type !== 'changestate') continue;
      const N = S.lit(sc.params.get('value'));
      if (N === null || N === grab.stance || !an.states.has(N)) continue;
      const cmds = commandsIn(sc.trig).filter(playable).sort(byRank);
      if (!cmds.length) continue;
      const reN = new RegExp('\\b(?:parent|root)\\s*,\\s*stateno\\s*=\\s*' + N + '\\b', 'i');
      const her = [];
      for (const t of own) {
        if (t.type !== 'targetstate' || !reN.test(trigTxt(t))) continue;
        const H = S.lit(t.params.get('value'));
        if (H !== null && base.hScenes.has(H) && !her.includes(H)) her.push(H);
      }
      if (!her.length) continue;
      const gates = [];
      for (const a of [...sc.trig.all, ...sc.trig.groups.flat()].map(String)) {
        for (const m of a.matchAll(/(^|[^,\w\s])\s*(f?var\(\d+\))\s*=\s*(-?\d+)\b/gi)) {
          const name = m[2].toLowerCase();
          for (const w of own) {
            if (w.type !== 'parentvarset') continue;
            const wr = W.writesOf(w).find(([nm]) => nm.toLowerCase() === name);
            if (!wr) continue;
            const probes = [...String(wr[1]).matchAll(PROBE_ANY)].map((x) => +x[1]);
            if (probes.length) gates.push({ name, want: +m[3], value: String(wr[1]), probes });
          }
        }
      }
      joins.push({ his: N, cmd: cmds[0], her: her.sort((a, b) => a - b), gates });
    }
    out.push({ id: h.id, gate, spawn, stance: grab.stance, stanceCmd: grab.stanceCmd, grab: { state: grab.state, cmd: grab.cmd, ready: grab.ready },
      families, counter, positions, art, mirrors, scenes, name, group, behind: (pt === 'p1' || pt === 'p2') && px !== null && px < 0, play, ownFlow, joins });
  }
  return out;
}

// ITS PLAY: what a player of the companion gets by time and by his other
// commands, read so the hook can pin each of it on a step of its own (GRAIL
// 4.10b). -> null, or { meter, ret, artValues, pos: Map k -> position }.
//   ITS METER: a variable of its own that its position states add to (a
//     VarAdd of a positive amount: 41401's `var(58) = 60+random%20` on a
//     thrust's element) and that a ChangeAnim of a position state, or a
//     ChangeState into another of its position states, compares with a
//     number (`var(58) >= 5000`: the climax animation; 22000's `var(58) >
//     1000`: 22100). Her escape meter var(10) is none: every comparison of it
//     leaves the position set (16302, its idle 69000) - a release.
//   ITS CLIMAX in each position: the meter pinned one past the highest number
//     that position compares it with (5001), and 0 on every other step, so
//     no step climaxes by itself (HEAD's Arina: position 2, about 17 s in).
//     A LADDER - a position whose home holds several of its states, each
//     entered from the one before on the meter (22000 `> 1000` 22100 `> 2000`
//     22200 `> 5000` 22300) - is a PHASE per rung: 0 for the first, the middle
//     of its window for each middle one (1500, 3500), one past the last number
//     for the last, its climax. Her state in a rung is what its TargetState
//     that reads no variable of its own gives her (22001, 22101, 22201,
//     22301); the meter's own TargetStates are the next rung's.
//   Her CLIMAX STATES elsewhere: what its TargetStates give her on the
//     animations its meter's ChangeAnims play (41401's `ifelse(random...,
//     463004+..., 463005+...)`) and on those its own ChangeAnims swap between
//     from there (463004 <-> 463005); a meter line gated on her name (`target,
//     name = "Makoto"`) is hers alone, and one with no timing in it (`anim !=
//     473114` aside) HOLDS its animation every tick: her climax is that one
//     only (Makoto: 473114, her 41405). Her plain states are what the rest of
//     the animations its TargetStates key give her.
//   ITS RETURN: the variable a position's ChangeState tests at a climax's end
//     to stay or go (`ifelse(var(59)>20,51488,41401)` in 41401), pinned at the
//     least value that stays and that none of its draws of it fires on (its
//     `var(59) < 0 || !var(59)` re-rolls 0 with random%101): 1.
//   ITS SPEEDS: a variable of its own that a position's ChangeAnim holds the
//     animation at every tick (`value = var(0)+463000+(var(3)*10000)` on
//     `var(0)+463000+(var(3)*10000) != anim`), at each value whose animation
//     one of the position's TargetStates keys her state on and no meter line
//     plays (41401: 1, 2, 22, 3, 33 - her 41402, 41403, 41407, 41404, 41408),
//     in the order his own commands step it from the position's first
//     animation (his a, `parent,command = "a"`, in his negative states: 1 -> 2
//     -> 22 -> 3 -> 33; x steps back).
//   ITS ART VARIANTS per position: the art variables the animations its
//     TargetStates key read (41401: var(3); 51488: var(33)), at each value its
//     files draw (0, the spawn value, and 1), where those animations exist.
function readCompanionPlay(c) {
  const { an, W, negLines, counter, positions, gAir, hScenes } = c;
  if (!counter || !positions.length) return null;
  const inSet = (n) => counter.set.some(([a, b]) => n >= a && n <= b);
  const posStates = [...c.shows].filter((n) => inSet(n) && an.states.has(n)).sort((a, b) => a - b);
  if (!posStates.length) return null;
  const atomsOf = (sc) => [...sc.trig.all, ...sc.trig.groups.flat()].map(String);
  const partsOf = (sc) => atomsOf(sc).flatMap((a) => a.split(/&&|\|\|/));
  const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // An own variable (never redirected) compared with a number: `var(58) >= 5000`.
  const cmpOf = (sc, name) => {
    const re = new RegExp('(^|[^,\\s])\\s*' + escRe(name) + '\\s*(>=|>)\\s*(\\d+)', 'gi');
    const out = [];
    for (const a of atomsOf(sc)) for (const m of (' ' + a).matchAll(re)) out.push({ op: m[2], t: +m[3] });
    return out;
  };
  const inPos = (sc) => sc.type === 'changestate' && posStates.includes(S.lit(sc.params.get('value')));
  // The meter.
  const up = new Set();
  for (const no of posStates) for (const sc of an.states.get(no).sctrls) {
    if (sc.type !== 'varadd') continue;
    for (const [nm, raw] of W.writesOf(sc)) {
      if (!VARNAME.test(nm)) continue;
      const t = String(raw == null ? '' : raw);
      let vals = [];
      try { vals = X.usesRandom(t) ? X.evalRandom(t, {}) : [X.evalExpr(t, {})]; } catch (e) { vals = []; }
      if (vals.length && vals.every((x) => Number.isFinite(x) && x > 0)) up.add(nm.toLowerCase());
    }
  }
  const byUse = [];
  for (const v of up) {
    let n = 0;
    for (const no of posStates) for (const sc of an.states.get(no).sctrls) if ((sc.type === 'changeanim' || inPos(sc)) && cmpOf(sc, v).length) n++;
    if (n) byUse.push([v, n]);
  }
  byUse.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  if (!byUse.length) return null;
  const meterName = byUse[0][0];
  const meterRef = varRef(meterName);
  // An expression's values with its variables pinned (one its files leave
  // unset is its spawn 0: 41488's var(22)).
  const valAt = (raw, pins, no) => {
    const t = String(raw == null ? '' : raw).trim();
    const lit = S.lit(t);
    if (lit !== null) return [lit];
    if (!t) return [];
    const A = {};
    for (const v of X.varsOf(t)) A[v] = [Object.prototype.hasOwnProperty.call(pins, v) ? pins[v] : 0];
    return W.values(t, A, no);
  };
  // Its art variables and the values its files draw them at (with the spawn 0).
  const artNames = (c.art || []).map((a) => a.kind + '(' + a.index + ')');
  const artValues = {};
  for (const n of artNames) {
    const vals = new Set([0]);
    for (const sc of c.drawLines) {
      if (sc.type !== 'varset') continue;
      for (const [nm, raw] of W.writesOf(sc)) if (nm.toLowerCase() === n) for (const x of valAt(raw, {}, sc.state)) if (Number.isInteger(x) && x >= 0 && x < 16) vals.add(x);
    }
    artValues[n] = [...vals].sort((a, b) => a - b);
  }
  // Her states by his animation: a TargetState keyed on `anim = <expr>` (not
  // one at the animation's end: 51488's hand-back to the intro 41398 on
  // `anim = 465004` and `animtime = 0`).
  const ATEND = /\b(animtime|animelem|animelemtime)\b/i;
  const herByAnim = (no, pins) => {
    const m = new Map();
    for (const sc of an.states.get(no).sctrls) {
      if (sc.type !== 'targetstate' || atomsOf(sc).some((a) => ATEND.test(a))) continue;
      const H = S.lit(sc.params.get('value'));
      if (H === null || !hScenes.has(H)) continue;
      for (const p of partsOf(sc)) {
        const mm = /^\s*anim\s*=\s*([^=\[].*?)\s*$/i.exec(p);
        if (!mm) continue;
        for (const A of valAt(mm[1], pins, no)) { if (!m.has(A)) m.set(A, new Set()); m.get(A).add(H); }
      }
    }
    return m;
  };
  // Which art variables a position's keyed animations read.
  const keyVars = (no) => {
    const out = new Set();
    for (const sc of an.states.get(no).sctrls) {
      if (sc.type !== 'targetstate') continue;
      for (const p of partsOf(sc)) { const mm = /^\s*anim\s*=\s*([^=\[].*?)\s*$/i.exec(p); if (mm) for (const v of X.varsOf(mm[1])) if (artNames.includes(v)) out.add(v); }
    }
    return [...out].sort();
  };
  const NAME_RE = /\b(?:target|enemy|enemynear|p2)\s*,\s*name\s*=\s*"([^"]*)"/i;
  const TIMING = /\b(time|animtime|animelem|animelemtime|random|statetime)\b/i;
  const animEq = (sc) => partsOf(sc).map((p) => /^\s*anim\s*=\s*([^=\[].*?)\s*$/i.exec(p)).filter(Boolean).map((m) => m[1]);
  // Its climax animations in a state: { all, plain, byName: [{ name, anims, holds }] }.
  // (The lines comparing it with its highest number: 41401's `var(58) > 1000`
  // at Time 0 only picks a faster speed.)
  const topOf = (no) => Math.max(0, ...an.states.get(no).sctrls.filter((sc) => sc.type === 'changeanim').flatMap((sc) => cmpOf(sc, meterName).map((q) => q.t)));
  const climaxOf = (no, pins) => {
    const s = an.states.get(no);
    const top = topOf(no);
    const lines = s.sctrls.filter((sc) => sc.type === 'changeanim' && cmpOf(sc, meterName).some((q) => q.t === top));
    const close = (set) => {
      for (let grew = true; grew;) {
        grew = false;
        for (const sc of s.sctrls) {
          if (sc.type !== 'changeanim' || lines.includes(sc)) continue;
          if (!animEq(sc).some((e) => valAt(e, pins, no).some((A) => set.has(A)))) continue;
          for (const A of valAt(sc.params.get('value'), pins, no)) if (gAir.has(A) && !set.has(A)) { set.add(A); grew = true; }
        }
      }
      return set;
    };
    const plain = new Set(), byName = [];
    for (const sc of lines) {
      const vals = valAt(sc.params.get('value'), pins, no).filter((A) => gAir.has(A));
      const nm = atomsOf(sc).map((a) => NAME_RE.exec(a)).find(Boolean);
      if (!nm) { for (const A of vals) plain.add(A); continue; }
      const holds = atomsOf(sc).every((a) => !TIMING.test(a.replace(/\banim\s*!=\s*-?\d+/gi, '')));
      byName.push({ name: nm[1].toLowerCase(), anims: new Set(vals), holds });
    }
    close(plain);
    for (const b of byName) close(b.anims);
    const all = new Set([...plain, ...byName.flatMap((b) => [...b.anims])]);
    return { all, plain, byName };
  };
  // The line that holds its animation at a speed, and the speed variable.
  const norm = (x) => String(x == null ? '' : x).replace(/\s+/g, '').toLowerCase();
  const holdOf = (no) => {
    for (const sc of an.states.get(no).sctrls) {
      if (sc.type !== 'changeanim') continue;
      const v = norm(sc.params.get('value'));
      if (!v || !partsOf(sc).some((p) => { const q = norm(p); return q === v + '!=anim' || q === 'anim!=' + v; })) continue;
      const vars = X.varsOf(String(sc.params.get('value'))).filter((x) => VARNAME.test(x) && !artNames.includes(x) && x !== meterName);
      if (vars.length === 1) return { expr: String(sc.params.get('value')), name: vars[0] };
    }
    return null;
  };
  const one = (list) => (list.length === 1 ? list[0] : null);
  // THE HOOK'S HOLD OF AN ANIMATION A in a position state: its ChangeAnims
  // that leave A on an element of it (`anim = 464004` and `animelem = 2 ||
  // animelem = 14 || animelem = 24`, random: 464005, the climax's other
  // picture) would change her state for a tick before the hold brings A
  // back, so the hold keeps that element's first tick from ever coming: on
  // it the hook sets the animation one tick on (element E at elemtime 1, or
  // the next element where E lasts one tick). Its lines at the animation's
  // end (`animTime = 0`) the hold's restart pre-empts. -> [[E, elem, elemtime]].
  const ELEM_EQ = /^\s*animelem\s*=\s*(\d+)\s*$/i;
  const skipOf = (no, A, pins) => {
    const es = new Set();
    const keyed = (atoms) => atoms.flatMap((a) => a.split(/&&|\|\|/)).some((p) => { const m = /^\s*anim\s*=\s*([^=\[].*?)\s*$/i.exec(p); return !!m && valAt(m[1], pins, no).includes(A); });
    for (const sc of an.states.get(no).sctrls) {
      if (sc.type !== 'changeanim') continue;
      const vals = valAt(sc.params.get('value'), pins, no);
      if (vals.length && vals.every((x) => x === A)) continue;
      const all = sc.trig.all.map(String);
      for (const g of sc.trig.groups.map((x) => x.map(String))) {
        if (!keyed([...all, ...g])) continue;
        for (const a of [...all, ...g]) for (const p of a.replace(/[()]/g, ' ').split(/\|\||&&/)) { const m = ELEM_EQ.exec(p); if (m) es.add(+m[1]); }
      }
    }
    const fr = (c.gAirTicks && c.gAirTicks.get(A)) || [];
    const out = [];
    for (const E of [...es].sort((a, b) => a - b)) {
      if (E < 1 || E > fr.length) continue;
      let e = E, t = 1;
      while (e <= fr.length && t >= fr[e - 1].t) { e++; t = es.has(e) ? 1 : 0; }
      if (e <= fr.length) out.push([E, e, t]);
    }
    return out;
  };
  // His commands that step the speed variable (`parent,command = "a"` in his
  // negative states, a VarSet of it from the animation it plays).
  const HIS_CMD = /\b(?:root|parent)\s*,\s*command\s*=\s*"([^"]*)"/i;
  const stepLines = (name) => negLines.filter((sc) => sc.type === 'varset' && W.writesOf(sc).some(([nm]) => nm.toLowerCase() === name) && atomsOf(sc).some((a) => HIS_CMD.test(a)));
  const speedsOf = (no, hold, pins, cl) => {
    const base = one(valAt(hold.expr, Object.assign({}, pins, { [hold.name]: 0 }), no));
    if (base === null) return [];
    const her = herByAnim(no, pins);
    const out = [];
    for (const [A, H] of her) {
      if (cl.all.has(A) || !gAir.has(A)) continue;
      const v = A - base;
      if (!v || one(valAt(hold.expr, Object.assign({}, pins, { [hold.name]: v }), no)) !== A) continue;
      out.push({ v, anim: A, her: [...H].sort((a, b) => a - b) });
    }
    // In the order his own commands step it from the position's first
    // animation (the spawn values of its art).
    const pins0 = Object.assign({}, pins);
    for (const n of artNames) pins0[n] = 0;
    const base0 = one(valAt(hold.expr, Object.assign({}, pins0, { [hold.name]: 0 }), no));
    const head = one(valAt(an.states.get(no).anim, pins0, no));
    const known = new Set(out.map((x) => x.v));
    const edges = new Map();
    for (const sc of stepLines(hold.name)) {
      const cmd = atomsOf(sc).map((a) => HIS_CMD.exec(a)).find(Boolean)[1];
      const raw = String(W.writesOf(sc).find(([nm]) => nm.toLowerCase() === hold.name)[1]);
      for (const v of known) {
        const ctx = Object.assign({ anim: base0 + v, isHelper: true }, pins0);
        let t = null, nx = null;
        try { t = X.evalTriggerSet(sc.trig, ctx); } catch (e) { t = null; }
        if (t === false) continue;
        try { nx = X.evalExpr(raw, ctx); } catch (e) { nx = null; }
        if (!Number.isFinite(nx) || !known.has(Math.trunc(nx)) || Math.trunc(nx) === v) continue;
        if (!edges.has(cmd)) edges.set(cmd, new Map());
        if (!edges.get(cmd).has(v)) edges.get(cmd).set(v, Math.trunc(nx));
      }
    }
    let order = [];
    if (head !== null && base0 !== null && known.has(head - base0)) {
      for (const [, e] of edges) {
        const seq = [head - base0];
        for (let cur = seq[0]; e.has(cur) && !seq.includes(e.get(cur));) { cur = e.get(cur); seq.push(cur); }
        if (seq.length > order.length) order = seq;
      }
      if (!order.length) order = [head - base0];
    }
    const rank = (v) => (order.includes(v) ? order.indexOf(v) : order.length + v);
    return out.sort((a, b) => rank(a.v) - rank(b.v) || a.v - b.v).map((x) => Object.assign(x, { skip: skipOf(no, x.anim, pins) }));
  };
  // A POSITION WITH NO SPEED VARIABLE (41488: its ChangeAnims pick 464001,
  // 464002 or 464003 at random at each loop's end): each animation one of its
  // TargetStates keys her state on, but a climax's, is a speed the hook holds
  // by the animation itself (`v` null), its own first animation first, then
  // by number. One animation is no choice: the position stays one step.
  const animSpeedsOf = (no, pins, cl) => {
    const her = herByAnim(no, pins);
    const head = one(valAt(an.states.get(no).anim, pins, no));
    const out = [...her].filter(([A]) => gAir.has(A) && !cl.all.has(A)).map(([A, H]) => ({ v: null, anim: A, her: [...H].sort((a, b) => a - b), skip: skipOf(no, A, pins) }));
    out.sort((a, b) => (a.anim === head ? -1 : b.anim === head ? 1 : a.anim - b.anim));
    return out.length > 1 ? out : [];
  };
  // Its return variable.
  let ret = null;
  for (const no of posStates) for (const sc of an.states.get(no).sctrls) {
    if (sc.type !== 'changestate') continue;
    const m = /^\s*ifelse\s*\(\s*\(?\s*(f?var\(\d+\))\s*(>=|<=|!=|>|<|=)\s*(-?\d+)\s*\)?\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*\)\s*$/i.exec(String(sc.params.get('value')));
    if (!m) continue;
    const stayIf = +m[4] === no ? true : +m[5] === no ? false : null;
    if (stayIf === null) continue;
    const R = m[1].toLowerCase();
    const draws = posStates.flatMap((n) => an.states.get(n).sctrls).filter((d) => d.type === 'varset' && W.writesOf(d).some(([nm, raw]) => nm.toLowerCase() === R && X.usesRandom(String(raw))));
    for (let v = 0; v < 64; v++) {
      if (X.evalExpr(R + m[2] + m[3], { [R]: v }) !== stayIf) continue;
      if (draws.some((d) => { let t = null; try { t = X.evalTriggerSet(d.trig, { [R]: v }); } catch (e) { t = null; } return t !== false; })) continue;
      if (!ret) ret = { name: R, value: v };
      else if (ret.name === R) ret.value = Math.max(ret.value, v);
      break;
    }
  }
  // Per position.
  const pos = new Map();
  for (const p of positions) {
    const home = (p.home || [[p.state, p.state]]);
    const mine = posStates.filter((n) => home.some(([a, b]) => n >= a && n <= b));
    if (!mine.includes(p.state)) continue;
    // A ladder: its rungs from the position's own state on the meter.
    let ladder = null;
    if (mine.length > 1) {
      const rungs = [{ state: p.state, tIn: null }];
      for (let cur = p.state; ;) {
        const sc = an.states.get(cur).sctrls.find((x) => x.type === 'changestate' && mine.includes(S.lit(x.params.get('value'))) && cmpOf(x, meterName).length);
        if (!sc) break;
        const nx = S.lit(sc.params.get('value'));
        if (rungs.some((r) => r.state === nx)) break;
        rungs.push({ state: nx, tIn: Math.max(...cmpOf(sc, meterName).map((q) => q.t)) });
        cur = nx;
      }
      if (rungs.length > 1) {
        ladder = rungs.map((r, i) => {
          const her = an.states.get(r.state).sctrls.filter((x) => x.type === 'targetstate' && !atomsOf(x).some((a) => ATEND.test(a) || X.varsOf(a).some((v) => VARNAME.test(v))))
            .map((x) => S.lit(x.params.get('value'))).filter((H) => H !== null && hScenes.has(H));
          const pin = i === 0 ? 0 : i === rungs.length - 1 ? r.tIn + 1 : Math.floor((r.tIn + rungs[i + 1].tIn) / 2);
          return { state: r.state, her: [...new Set(her)].sort((a, b) => a - b), pin, climax: i === rungs.length - 1 };
        });
      }
    }
    // Its variants, and per variant its climax and speeds.
    const kv = keyVars(p.state);
    const combos = [{}];
    for (const v of kv) {
      const next = [];
      for (const cmb of combos) for (const x of artValues[v] || [0]) next.push(Object.assign({}, cmb, { [v]: x }));
      combos.splice(0, combos.length, ...next);
    }
    const hold = holdOf(p.state);
    const variants = [];
    for (const cmb of combos) {
      const pins = {};
      for (const n of artNames) pins[n] = 0;
      Object.assign(pins, cmb);
      const her = herByAnim(p.state, pins);
      if (![...her.keys()].some((A) => gAir.has(A))) continue;
      const cl = climaxOf(p.state, pins);
      const top = topOf(p.state);
      const plainAnims = [...her.keys()].filter((A) => gAir.has(A) && !cl.all.has(A));
      const statesOf = (anims) => [...new Set([...anims].flatMap((A) => [...(her.get(A) || [])]))].sort((a, b) => a - b);
      // (Its climax PICTURES: each animation its top meter line plays, and
      // those its ChangeAnims swap between from there - 464004 <-> 464005 -
      // each her own state of the climax; held by the hook one at a time.)
      const climAnims = [...cl.plain].sort((a, b) => a - b);
      variants.push({
        art: cmb, pins,
        plain: { anims: plainAnims.sort((a, b) => a - b), her: statesOf(plainAnims) },
        climax: cl.all.size ? { pin: top + 1, anims: climAnims, her: statesOf(cl.plain),
          pictures: climAnims.map((A) => ({ anim: A, her: statesOf([A]), skip: skipOf(p.state, A, pins) })).filter((x) => x.her.length),
          byName: cl.byName.map((b) => ({ name: b.name, holds: b.holds, anims: [...b.anims].sort((x, y) => x - y), her: statesOf(b.anims) })), allHer: statesOf(cl.all) } : null,
        speeds: hold ? speedsOf(p.state, hold, pins, cl) : animSpeedsOf(p.state, pins, cl),
      });
    }
    pos.set(p.k, { state: p.state, mine, ladder, hold: hold ? hold.name : null, variants, keyVars: kv });
  }
  return { meter: { name: meterName, kind: meterRef.kind, index: meterRef.index }, ret: ret ? Object.assign(varRef(ret.name), { value: ret.value }) : null, artValues, pos };
}

// ---- the Baomaru hub ----------------------------------------------------------
// A state of his whose TargetState computes her state from two variables,
// the position P and the phase Ph (`6195+(var(40)*5)+(1+var(39))`), with a
// ChangeState on the same trigger that computes his next state from Ph
// alone (`6000+1+var(39)`): GRAIL 4.10 C. `only`: the states to look in.
function findHubs(an, only) {
  const out = [];
  for (const [H, st] of an.states) {
    if ((only && !only.has(H)) || H < 0 || an.scenes.has(H)) continue;
    for (const ts of st.sctrls) {
      if (ts.type !== 'targetstate') continue;
      const raw = ts.params.get('value');
      if (raw === undefined || S.lit(raw) !== null) continue;
      let vars;
      try { vars = [...new Set(X.varsOf(String(raw)).filter((v) => VARNAME.test(v)))]; } catch (e) { continue; }
      if (vars.length < 2 || vars.length > 3) continue;
      // The same trigger (kuromaru_plus's TargetState adds a triggerall of
      // its own: var(48) < 10 for the normal family).
      const tt = trigText({ all: [], groups: ts.trig.groups });
      // AN EXTRA TERM: a third variable in both values whose files give it
      // at most three values, 0 among them, fewer than the phase's (f.sanae's
      // big-cum flag var(25), 0 or 100, in `16195+(var(55)*5)+(1+var(54))+
      // var(25)` and `16000+1+var(54)+var(25)`): read at its round-start 0.
      const dom = (v) => (an.domains && an.domains[v]) || [];
      const phOf = (sc) => {
        let v;
        try { v = [...new Set(X.varsOf(String(sc.params.get('value'))).filter((x) => VARNAME.test(x)))]; } catch (e) { return null; }
        if (!v.length || !v.every((x) => vars.includes(x))) return null;
        if (vars.length === 2) return v.length === 1 ? v[0] : null;
        if (v.length !== 2) return null;
        const [a, b] = v.slice().sort((x, y) => dom(y).length - dom(x).length);
        const xd = dom(b);
        return xd.length <= 3 && xd.includes(0) && xd.length < dom(a).length ? a : null;
      };
      const cs = st.sctrls.find((sc) => sc.type === 'changestate' && trigText({ all: [], groups: sc.trig.groups }) === tt && phOf(sc));
      if (!cs) continue;
      const Ph = phOf(cs);
      const csVars = [...new Set(X.varsOf(String(cs.params.get('value'))).filter((x) => VARNAME.test(x)))];
      const extra = vars.filter((v) => v !== Ph && csVars.includes(v));
      const P = vars.find((v) => v !== Ph && !extra.includes(v));
      if (!P) continue;
      const zero = Object.fromEntries(extra.map((v) => [v, 0]));
      const num = (txt, ctx) => { const n = X.evalExpr(txt, ctx); return typeof n === 'number' && Number.isFinite(n) ? Math.trunc(n) : null; };
      out.push({ H, P, Ph, extra, ts, cs, at: (k, s) => num(String(raw), Object.assign({ [P]: k, [Ph]: s }, zero)), next: (s) => num(String(cs.params.get('value')), Object.assign({ [Ph]: s }, zero)) });
      break;
    }
  }
  // (A hub read exactly comes first: Moses' Miracle routes by her art to
  // 26001 or to 16001, and 26001 is its own.)
  return out.sort((a, b) => a.extra.length - b.extra.length);
}

// ---- the setup ----------------------------------------------------------------
// GAUGE GATES. A ChangeState/TargetState in one of his states that fires on
// `<variables> < T` (T 1000 or more: a gauge, not a counter) while the
// variables hold their round-start 0, and whose firing keeps the scenes the
// state would otherwise go on to from ever showing: Minotaur's insertions
// check Var(16)+Var(56) < 6000 on their third element and fall into the
// groin kick (1690/1695) instead of 1611-1619. The setup sets the variable to
// the largest value his own files give it that keeps the check false
// (Minotaur's debug state 930 sets var(56) = 12000), and the walk reads the
// gate as never firing.
// A COMPANION HELPER. A Helper his negative states spawn whose own states
// grab her (Brian's Striker, id 69000, spawned by -2 on var(14) > 0 and
// grabbing her from -3 behind IsHelper(69000)): when its spawn trigger has a
// plain variable comparison, the setup sets that variable so it never fires.
function detectSetup(base, W) {
  const { an, hScenes, root } = base;
  const setup = [], frozen = {}, offCtrls = new Set(), companionGates = [];
  const lines = (sc) => [...sc.trig.all, ...sc.trig.groups.flat()];
  const GATE = /^((?:[-+]?(?:\d+\*)?f?var\(\d+\))+)(<=|<|>=|>)(-?\d+)$/;
  const gates = new Map();   // normalized line -> { line, lhsVars, ctrls: [], states: Set }
  for (const no of root) {
    if (no < 0 || (no >= 170 && no <= 199)) continue;
    for (const sc of an.states.get(no).sctrls) {
      if (!['changestate', 'targetstate', 'selfstate'].includes(sc.type)) continue;
      for (const e of lines(sc)) {
        const norm = String(e).toLowerCase().replace(/\s+/g, '');
        const m = GATE.exec(norm);
        if (!m || Math.abs(+m[3]) < 1000) continue;
        const vars = X.varsOf(norm);
        if (!vars.length) continue;
        const zero = Object.fromEntries(vars.map((v) => [v, 0]));
        if (X.evalExpr(norm, zero) !== true) continue;
        if (!gates.has(norm)) gates.set(norm, { line: String(e).trim(), vars, ctrls: [], states: new Set() });
        gates.get(norm).ctrls.push(sc);
        gates.get(norm).states.add(no);
      }
    }
  }
  const A0 = {};
  const shownBy = (f) => new Set([...f.issued.keys()].filter((C) => hScenes.has(C)));
  for (const [norm, g] of gates) {
    // Does the gate keep scenes from showing? The state's own walk with the
    // gate firing against the walk with it never firing.
    const off = new Set(g.ctrls);
    const W2 = makeWalker(an, Object.assign({}, base.walkerOpts, { offCtrls: off }));
    const W1 = makeWalker(an, Object.assign({}, base.walkerOpts, { onCtrls: off }));
    const opened = new Set();
    const zero = Object.assign({}, A0, Object.fromEntries(g.vars.map((v) => [v, [0]])));
    for (const no of g.states) {
      const on = shownBy(W1.flow([{ no, A: zero }], NO_INPUT));
      for (const C of shownBy(W2.flow([{ no, A: zero }], NO_INPUT))) if (!on.has(C)) opened.add(C);
    }
    if (!opened.size) continue;
    // The variable and value: the largest literal his files assign that
    // keeps the check false with the other variables at 0.
    let best = null;
    for (const v of g.vars) {
      for (const x of [...(an.domains[v] || [])].sort((a, b) => b - a)) {
        const ctx = Object.fromEntries(g.vars.map((u) => [u, u === v ? x : 0]));
        if (X.evalExpr(norm, ctx) === false) { if (!best || x > best.value) best = { name: v, value: x, literal: true }; break; }
      }
    }
    if (!best) {
      const m = GATE.exec(norm);
      const T = +m[3], v = g.vars[g.vars.length - 1];
      for (const x of [T, T + 1, T - 1, T * 2]) {
        const ctx = Object.fromEntries(g.vars.map((u) => [u, u === v ? x : 0]));
        if (X.evalExpr(norm, ctx) === false) { best = { name: v, value: x, literal: false }; break; }
      }
    }
    if (!best) continue;
    const ref = varRef(best.name);
    if (!ref) continue;
    let where = '';
    if (best.literal) {
      const setters = [];
      for (const [no, s] of an.states) for (const sc of s.sctrls) {
        if (sc.type !== 'varset') continue;
        if (W.writesOf(sc).some(([nm, raw]) => nm === best.name && S.lit(raw) === best.value)) setters.push(no);
      }
      if (setters.length) where = '; his state ' + [...new Set(setters)].slice(0, 3).join('/') + ' sets ' + best.name + ' = ' + best.value;
    }
    const sts = [...g.states].sort((a, b) => a - b);
    const why = ('keeps ' + g.line + ' false in ' + sts.slice(0, 6).join(', ') + (sts.length > 6 ? ' and ' + (sts.length - 6) + ' more' : '')
      + ': at round start it sends the scene into its failure branch' + where).replace(/[^\x20-\x7e]/g, '?');
    if (!Object.prototype.hasOwnProperty.call(frozen, best.name)) {
      frozen[best.name] = best.value;
      setup.push({ kind: ref.kind, index: ref.index, value: best.value, why });
    }
    g.held = { name: best.name, kind: ref.kind, index: ref.index };
    for (const sc of g.ctrls) offCtrls.add(sc);
  }
  // Companion helpers.
  for (const h of base.helperCtrls) {
    if (h.state >= 0 || h.id === null) continue;
    const roots = W.values(h.sc.params.get('stateno'), {}, h.state).slice();
    for (const [no, s] of an.states) if (no < 0) for (const sc of s.sctrls) {
      if (sc.type !== 'changestate') continue;
      const txt = lines(sc).join(' ');
      if (!new RegExp('\\bishelper\\s*\\(\\s*' + h.id + '\\s*\\)', 'i').test(txt)) continue;
      roots.push(...W.values(sc.params.get('value'), {}, no));
    }
    const reach = W.rootReach(roots, true);
    let grabsHer = false;
    for (const no of reach) {
      for (const sc of an.states.get(no).sctrls) {
        const raw = sc.type === 'targetstate' ? sc.params.get('value') : (sc.type === 'hitdef' || sc.type === 'projectile') ? sc.params.get('p2stateno') : undefined;
        if (raw !== undefined && W.values(raw, {}, no).some((v) => hScenes.has(v))) { grabsHer = true; break; }
      }
      if (grabsHer) break;
    }
    if (!grabsHer) continue;
    // A plain variable comparison in its spawn trigger, and the value that
    // makes the whole trigger false.
    // Of several (Brian's extra edition gates the Striker on its "bao
    // switch" var(55) and on var(14)), the one fewest other controllers
    // read - the helper's own switch - and the last listed on a tie.
    const readCount = (name) => {
      let n = 0;
      for (const st of an.states.values()) for (const sc of st.sctrls) {
        if (sc === h.sc) continue;
        for (const e of [...sc.trig.all, ...sc.trig.groups.flat(), ...sc.params.values()]) if (X.varsOf(String(e)).includes(name)) n++;
      }
      return n;
    };
    let pick = null;
    for (const e of lines(h.sc)) {
      const vars = X.varsOf(e);
      if (vars.length !== 1 || !VARNAME.test(vars[0])) continue;
      const norm = String(e).replace(/\s+/g, '');
      if (!/^!?f?var\(\d+\)((<=|>=|!=|=|<|>)-?\d+)?$/i.test(norm)) continue;
      for (const x of [0, 1, -1]) {
        if (X.evalTriggerSet(h.sc.trig, { [vars[0]]: x, isHelper: false }) !== false) continue;
        const cand = { name: vars[0], value: x, line: String(e).trim(), reads: readCount(vars[0]) };
        if (!pick || cand.reads <= pick.reads) pick = cand;
        break;
      }
    }
    if (!pick || Object.prototype.hasOwnProperty.call(frozen, pick.name)) continue;
    const ref = varRef(pick.name);
    frozen[pick.name] = pick.value;
    setup.push({ kind: ref.kind, index: ref.index, value: pick.value,
      why: ('keeps his helper ' + h.id + ' from spawning (state ' + h.state + ', ' + pick.line + '): it grabs her on its own').replace(/[^\x20-\x7e]/g, '?') });
    // (Its own steps release the gate again: readCompanions.)
    companionGates.push({ h, gate: { name: pick.name, kind: ref.kind, index: ref.index, hold: pick.value, line: pick.line }, roots });
  }
  // How many controllers read a variable (the fewest-readers pick).
  const readers = (name, but) => {
    let n = 0;
    for (const st of an.states.values()) for (const sc of st.sctrls) {
      if (but && but.has(sc)) continue;
      for (const e of [...sc.trig.all, ...sc.trig.groups.flat(), ...sc.params.values()]) if (X.varsOf(String(e)).includes(name)) { n++; break; }
    }
    return n;
  };
  const hold = (name, value, why) => {
    const ref = varRef(name);
    if (!ref || Object.prototype.hasOwnProperty.call(frozen, name)) return;
    frozen[name] = value;
    setup.push({ kind: ref.kind, index: ref.index, value, why: why.replace(/[^\x20-\x7e]/g, '?') });
  };
  const noCmd = (sc) => !commandsIn(sc.trig).length;
  // A RANDOM POSITION. In a Baomaru hub or the state it climaxes in, a
  // VarSet of the position that no input makes and that draws at random,
  // behind a switch variable (Brian's extra edition: var(18) = 2 from his
  // config state re-rolls the position at every climax's end while auto
  // runs): the switch is held where it keeps the draw off - of the variables
  // that do, the one the fewest other controllers read.
  for (const hub of findHubs(an, root)) {
    const places = new Set([hub.H]);
    for (let s = 0; s <= 8; s++) { const n = hub.next(s); if (n !== null && an.states.has(n)) places.add(n); }
    for (const no of places) {
      // (A draw its trigger gates on the position itself follows another
      // draw - Brian's `fvar(23) = -100` marker - and needs no switch of its own.)
      const draws = an.states.get(no).sctrls.filter((sc) => sc.type === 'varset' && noCmd(sc) && W.writesOf(sc).some(([nm]) => nm === hub.P)
        && [...sc.trig.all, ...sc.trig.groups.flat(), ...sc.params.values()].some((e) => /\brandom\b/i.test(String(e)))
        && ![...sc.trig.all, ...sc.trig.groups.flat()].some((e) => X.varsOf(String(e)).includes(hub.P)));
      if (!draws.length) continue;
      const cands = new Map();
      for (const sc of draws) {
        const vars = [...new Set([...sc.trig.all, ...sc.trig.groups.flat()].flatMap((e) => X.varsOf(String(e))))].filter((v) => VARNAME.test(v) && v !== hub.P && v !== hub.Ph);
        for (const v of vars) if (!Object.prototype.hasOwnProperty.call(frozen, v) && W.trig(sc, { [v]: [0] }, NO_INPUT, no) === false) cands.set(v, (cands.get(v) || 0) + 1);
      }
      // It must shut every draw.
      const all = [...cands].filter(([, n]) => n === draws.length).map(([v]) => v);
      if (!all.length) continue;
      const but = new Set(draws);
      const pick = all.sort((a, b) => readers(a, but) - readers(b, but) || (a < b ? -1 : 1))[0];
      hold(pick, 0, 'keeps state ' + no + ' from changing the position at random (' + pick + ' switches the draw on)');
    }
  }
  // A GAUGE ONLY HIS STROKES FILL (Murakami's var(25): his stroke 1002, which
  // a press in the hold 1000 enters, adds 600, and 1000's `Var(25) >= 12000`
  // with no command starts his climax): held at 0, so neither the grab nor a
  // stroke climaxes by itself; the climax is a step of its own that sets it
  // there (a GAUGE CLIMAX, in the walk). Every write of it in his own states
  // is a positive VarAdd in a state the gauge's state enters only on a
  // command, a decay or a VarSet to 0, or one that cannot fire with it at 0
  // (his clamp `Var(25) > 12000`, a palette's `PalNo = [7,12]` bonus).
  for (const no of root) {
    if (no < 0) continue;
    for (const sc of an.states.get(no).sctrls) {
      if (sc.type !== 'changestate' || !noCmd(sc)) continue;
      const m = [...sc.trig.all, ...sc.trig.groups.flat()].map((e) => GAUGE_ATOM.exec(String(e))).find(Boolean);
      if (!m) continue;
      const G = m[1].toLowerCase() + '(' + m[2] + ')', N = +m[4] + (m[3] === '>' ? 1 : 0);
      if (N < 1000 || Object.prototype.hasOwnProperty.call(frozen, G)) continue;
      const into = (S2) => an.states.get(no).sctrls.filter((x) => x.type === 'changestate' && W.values(x.params.get('value'), {}, no).includes(S2));
      let ok = true;
      const strokes = new Set();
      for (const [no2, s2] of an.states) {
        if (no2 < 0) continue;
        for (const x of s2.sctrls) {
          if (!['varset', 'varadd', 'varrandom'].includes(x.type)) continue;
          for (const [nm, raw] of W.writesOf(x)) {
            if (nm !== G) continue;
            const v = S.lit(raw);
            if (x.type === 'varadd' && v !== null && v > 0 && no2 !== no) strokes.add(no2);
            else if (!(x.type === 'varset' && v === 0) && !(x.type === 'varadd' && v !== null && v < 0)
              && W.trig(x, Object.assign({}, base.initial || {}, { [G]: [0] }), null, no2) !== false) ok = false;
          }
        }
      }
      if (!ok || !strokes.size || ![...strokes].some((S2) => into(S2).length) || [...strokes].some((S2) => into(S2).some(noCmd))) continue;
      hold(G, 0, 'keeps ' + G + ' at 0: only his strokes fill it (' + [...strokes].filter((S2) => into(S2).length).slice(0, 3).join('/') + '), and at ' + N + ' state ' + no + ' climaxes by itself; its climax step sets it');
    }
  }
  // A CLIMAX BY DRAIN (FutaRB's var(41): 75 at the grab, each speed cycle
  // takes 5 or 15, and the speed's `Var(41) <= 0` at its animation's end goes
  // into the cum 50113, which fills it to 70 again): held at the grab's own
  // value, so no speed climaxes by itself; the climax is a step of its own
  // that holds it at the number (drainOf, in the walk). Read where a
  // ChangeState with no command, in a state of his, compares the variable
  // `<= N` / `< N` and goes into a state that issues a scene, and every write
  // of it is a literal VarSet above N, a VarAdd whose results are all
  // negative, or a positive one only HER command (`Enemy,Command`: her
  // resistance, never pressed - the gallery's receiver takes no input) or her
  // AI fires.
  base.drains = [];
  {
    const TIMES = /\b(animtime|animelem|animelemtime|time|statetime)\s*(=|>=|<=|>|<)\s*-?\d+(\s*,\s*(=|>=|<=|>|<)?\s*-?\d+)?/gi;
    const cands = new Map();   // V -> { N, ref, at: Map(state -> [into]) }
    for (const no of root) {
      if (no < 0) continue;
      for (const sc of an.states.get(no).sctrls) {
        if (sc.type !== 'changestate' || !noCmd(sc)) continue;
        for (const m of [...sc.trig.all, ...sc.trig.groups.flat()].map((e) => DRAIN_ATOM.exec(String(e))).filter(Boolean)) {
        const V = m[1].toLowerCase() + '(' + m[2] + ')', N = +m[4] - (m[3] === '<' ? 1 : 0);
        const ref = varRef(V);
        if (!ref || Object.prototype.hasOwnProperty.call(frozen, V)) continue;
        // (One a player's walk can fire, the drained variable at the number
        // and its time come: never the AI's own exit on `AILevel`.)
        const rw = (e) => String(e).replace(TIMES, '1');
        if (W.trig({ trig: { all: sc.trig.all.map(rw), groups: sc.trig.groups.map((g) => g.map(rw)) } }, { [V]: [N] }, NO_INPUT, no) === false) continue;
        const into = W.values(sc.params.get('value'), {}, no).filter((v) => v !== no && !isBasic(v) && an.states.has(v));
        if (!into.some((v) => an.states.get(v).sctrls.some((x) => x.type === 'targetstate' && W.values(x.params.get('value'), {}, v).some((C) => hScenes.has(C))))) continue;
        if (!cands.has(V)) cands.set(V, { N, ref, at: new Map() });
        const c = cands.get(V);
        if (c.N !== N) { c.bad = true; continue; }
        c.at.set(no, into);
        }
      }
    }
    const HERS = /\b(?:enemy|enemynear|p2|target)(?:\s*\(\s*\d*\s*\))?\s*,\s*(command\s*(!=|=)\s*"[^"]*"|ailevel)/gi;
    const herOff = (e) => String(e).replace(HERS, (all, what, op) => (/^ailevel$/i.test(what) ? '(0)' : op === '=' ? '0' : '1'));
    for (const [V, c] of cands) {
      if (c.bad) continue;
      const N = c.N;
      const climaxes = new Set([...c.at.values()].flat());
      let ok = true;
      const sets = [], drainsIn = new Set();
      for (const [no2, s2] of an.states) {
        for (const x of s2.sctrls) {
          if (!/^(var|parentvar)(set|add)$|^varrandom$|^varrangeset$/.test(x.type)) continue;
          for (const [nm, raw] of W.writesOf(x)) {
            if (nm !== V) continue;
            if (x.type !== 'varset' && x.type !== 'varadd') { ok = false; continue; }
            const v = S.lit(raw);
            if (x.type === 'varset') { if (v === null || v <= N) ok = false; else sets.push({ no: no2, v }); continue; }
            // (Every value it can take: `Ifelse(random<500,-5,-15)`.)
            const leaves = v !== null ? [v] : X.evalRandom(String(raw), {});
            if (leaves.length && leaves.every((y) => typeof y === 'number' && y < 0)) { if (c.at.has(no2)) drainsIn.add(no2); continue; }
            // (A positive add only her command or her AI fires.)
            const t = { all: x.trig.all.map(herOff), groups: x.trig.groups.map((g) => g.map(herOff)) };
            let fires = null;
            try { fires = X.evalTriggerSet(t, { isHelper: false }); } catch (e) { fires = null; }
            if (fires !== false) ok = false;
          }
        }
      }
      // (It must drain: the state of the ChangeState takes from it itself -
      // FutaRB's 50110 at its sixth element -, never a flag set once, Brian's
      // one-time check fvar(3).)
      if (!ok || !sets.length || !drainsIn.size) continue;
      for (const no of [...c.at.keys()]) if (!drainsIn.has(no)) c.at.delete(no);
      // The grab's own value: a VarSet outside every climax it goes into
      // (75 at 50001, not the 70 each cum refills), else the least.
      const own = sets.filter((x) => !climaxes.has(x.no));
      const K = (own.length ? own : sets).map((x) => x.v).sort((p, q) => p - q)[0];
      const first = [...c.at.keys()].sort((p, q) => p - q)[0];
      hold(V, K, 'holds ' + V + ' at ' + K + ' (its value at the grab): his speeds drain it, and at ' + N + ' state ' + first + ' climaxes by itself; the climax step of each position holds it there');
      if (frozen[V] !== K) continue;
      base.drains.push({ V, kind: c.ref.kind, index: c.ref.index, N, K, states: new Set(c.at.keys()), into: c.at });
    }
  }
  // A METER HIS NEGATIVE STATES ACT ON. A variable his states add to (a
  // pleasure or stun meter) that, past a number, makes -1/-2/-3 put her in a
  // scene, move him out of the one running, or spawn a helper - from any
  // state (Brian's fvar(39) = 48 fires her orgasm 6600/6400, where he waits
  // for x; his stun fvar(7) >= 49 spawns the slow-motion helper 6969): held
  // at 0, so no step is interrupted by it.
  const adds = new Set();
  const meters = new Set();
  for (const st of an.states.values()) for (const sc of st.sctrls) if (sc.type === 'varadd') for (const [nm] of W.writesOf(sc)) adds.add(nm);
  for (const neg of [-3, -2, -1]) {
    const st = an.states.get(neg);
    if (!st) continue;
    for (const sc of st.sctrls) {
      if (!noCmd(sc) || X.evalTriggerSet(sc.trig, { isHelper: false }) === false) continue;
      // What it does must take over a scene: put her in one of his scenes,
      // send him to a state that does, or spawn a helper that grabs her or
      // stops time (Brian's 6969: Pause and SuperPause).
      const takesOver = (no, hops) => {
        const st2 = an.states.get(no);
        if (!st2) return false;
        for (const c of st2.sctrls) {
          if ((c.type === 'targetstate' || c.type === 'hitdef' || c.type === 'projectile') && W.values(c.params.get(c.type === 'targetstate' ? 'value' : 'p2stateno'), {}, no).some((v) => hScenes.has(v))) return true;
          if (c.type === 'pause' || c.type === 'superpause') return true;
          if (hops > 0 && c.type === 'changestate') for (const v of W.values(c.params.get('value'), {}, no)) if (!isBasic(v) && v !== no && takesOver(v, hops - 1)) return true;
        }
        return false;
      };
      let acts = false;
      if (sc.type === 'helper') acts = W.values(sc.params.get('stateno'), {}, neg).some((v) => takesOver(v, 2));
      else if (sc.type === 'targetstate') acts = W.values(sc.params.get('value'), {}, neg).some((v) => hScenes.has(v));
      else if (sc.type === 'changestate') acts = W.values(sc.params.get('value'), {}, neg).some((v) => !isBasic(v) && an.states.has(v) && takesOver(v, 1));
      if (!acts) continue;
      // (Not one that needs his control - an attack of his AI - nor a
      // variable that keeps its 0 for the gallery's giver anyway.)
      if (W.trig(sc, { [CTRL]: [0] }, NO_INPUT, neg) === false) continue;
      const vars = [...new Set([...sc.trig.all, ...sc.trig.groups.flat()].flatMap((e) => X.varsOf(String(e))))].filter((v) => VARNAME.test(v) && adds.has(v)
        && !Object.prototype.hasOwnProperty.call(frozen, v) && !(base.initial[v] && base.initial[v].length === 1 && base.initial[v][0] === 0));
      for (const v of vars) {
        // Past a number: `fvar(39) = 48`, `fvar(7) >= 49` - not a flag
        // (`fvar(22) != 0`, Brian's in-scene flag) or a switch (`var(56) = 1`).
        const esc = v.replace(/[()]/g, (c) => '\\' + c);
        const past = [...sc.trig.all, ...sc.trig.groups.flat()].some((e) => [...String(e).matchAll(new RegExp('\\b' + esc + '\\s*(>=|>|=)\\s*(\\d+(?:\\.\\d+)?)', 'gi'))].some((m) => +m[2] >= 10));
        if (!past) continue;
        if (W.trig(sc, { [v]: [0] }, NO_INPUT, neg) !== false) continue;
        const line = [...sc.trig.all, ...sc.trig.groups.flat()].find((e) => X.varsOf(String(e)).includes(v));
        const what = sc.type === 'helper' ? 'spawning helper ' + (S.lit(sc.params.get('id')) !== null ? S.lit(sc.params.get('id')) : '') : sc.type === 'targetstate' ? 'putting her in ' + W.values(sc.params.get('value'), {}, neg).join('/') : 'sending him to ' + W.values(sc.params.get('value'), {}, neg).join('/');
        hold(v, 0, 'keeps state ' + neg + ' from ' + what + ' on ' + String(line || v).trim() + ': a meter his scenes fill, which would interrupt any step');
        meters.add(v);
        break;
      }
    }
  }
  base.setup = setup;
  base.frozen = frozen;
  base.offCtrls = offCtrls;
  base.companionGates = companionGates;
  base.meterFires = meterFires(base, W, meters);
  base.gateFails = gateFails(base, W, gates);
  base.finishCounters = finishCounters(base, W, hold);
}

// A HELD METER'S FIRING, a step of its own. A meter the setup holds at 0
// (above) whose negative states' TargetState puts her in a scene of his on a
// value of it (Brian's -2 on `fvar(39) = 48`: her orgasm 6600, his own
// ChangeState to 6400 beside it) is set to that value by the hook once, after
// the hold, in a step per position of his hub (readBao): the scene his files
// show when the meter fills there. -> [{ name, kind, index, value, her, state }]
function meterFires(base, W, meters) {
  const { an, hScenes } = base;
  const out = [];
  for (const neg of [-3, -2, -1]) {
    const st = an.states.get(neg);
    if (!st) continue;
    for (const sc of st.sctrls) {
      if (sc.type !== 'targetstate' || commandsIn(sc.trig).length) continue;
      const her = [...new Set(W.values(sc.params.get('value'), {}, neg).filter((v) => hScenes.has(v)))].sort((a, b) => a - b);
      if (!her.length) continue;
      for (const e of [...sc.trig.all, ...sc.trig.groups.flat()]) {
        for (const m of String(e).matchAll(/\b(f?var)\s*\(\s*(\d+)\s*\)\s*(>=|=)\s*(\d+)(?![.\d])/gi)) {
          const name = m[1].toLowerCase() + '(' + m[2] + ')';
          if (!meters.has(name)) continue;
          const value = +m[4];
          if (W.trig(sc, { [name]: [value] }, NO_INPUT, neg) === false) continue;
          const ref = varRef(name);
          if (!ref || out.some((x) => x.name === name && x.value === value && x.her.join() === her.join())) continue;
          out.push({ name, kind: ref.kind, index: ref.index, value, her, state: neg });
        }
      }
    }
  }
  return out;
}

// A GAUGE GATE'S FAILURE, a step of its own. The setup holds a gauge where
// its gate never fires (Minotaur's var(56) = 12000: every insertion goes on);
// the scene the gate's own TargetState gives her when it does (the groin
// kick: her 1695 from 1610-1640, 1895 from 1810-1840, at the insertion's
// third element) is a step with the gauge at its round-start 0 in the step's
// own setup, over the pair's, led the way the insertion is (ladderOf).
// -> [{ kind, index, value, line, state, her }]
function gateFails(base, W, gates) {
  const out = [];
  for (const g of gates.values()) {
    if (!g.held) continue;
    const zero = Object.fromEntries(g.vars.map((v) => [v, 0]));
    if (X.evalExpr(String(g.line).toLowerCase().replace(/\s+/g, ''), zero) !== true) continue;
    for (const sc of g.ctrls) {
      if (sc.type !== 'targetstate') continue;
      const her = [...new Set(W.values(sc.params.get('value'), {}, sc.state).filter((v) => base.hScenes.has(v)))].sort((a, b) => a - b);
      if (!her.length) continue;
      out.push({ kind: g.held.kind, index: g.held.index, value: 0, line: g.line, state: sc.state, her });
    }
  }
  return out;
}

// A FINISH COUNTER, his "stage" system: a variable of his that a VarAdd of a
// positive number adds to on a finish - in the state a hub of his climaxes
// in (DongHwan's 6005 at AnimTime 0: var(32), his climax count; Brian's 6005
// at Time 0: var(4), his "baomaru particles"), or in his negative states on a
// held meter's firing (Brian's -2 on `fvar(39) = 48`: var(4) again) - that
// his states set to nothing but 0 (DongHwan's grab 6000 zeroes var(32)), and
// that art compares with a number: his own (a ChangeAnim, ChangeAnim2,
// Explod or Helper of his, in his own states: DongHwan's position-2 press
// 42249/4249 at var(32) >= 5, Brian's "siru" helper at var(4) > 1) or hers
// (a ChangeAnim, ChangeAnim2, Explod or ChangeState in a scene of his,
// reading it of him: Brian's 1805000 at `enemyNear,var(4) >= 4`, Bao's
// 16303 into 65069). Held at 0 in the pair's setup - the art his grab starts
// with - so no step's art depends on how many finishes were viewed before
// it; each number the art changes at is a LEVEL (a stage), and pairStages
// gives each step whose art it changes a copy held at that level.
// -> [{ name, kind, index, levels }]
const STAGE_ART_HIS = new Set(['changeanim', 'changeanim2', 'explod', 'helper']);
const STAGE_ART_HERS = new Set(['changeanim', 'changeanim2', 'explod', 'changestate']);
function finishCounters(base, W, hold) {
  const { an, root, hScenes } = base;
  // The states his hubs climax in: the next state of a phase that is not
  // the one most of his phases share (6002, the speed cycle).
  const finishing = new Set();
  for (const hub of findHubs(an, root)) {
    const nexts = new Map();
    for (let s = 1; s <= 8; s++) { const n = hub.next(s); if (n !== null && an.states.has(n)) nexts.set(n, (nexts.get(n) || 0) + 1); }
    if (nexts.size < 2) continue;
    const top = [...nexts].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
    for (const n of nexts.keys()) if (n !== top) finishing.add(n);
  }
  const fires = base.meterFires || [];
  const firesOn = (sc) => fires.some((M) => [...sc.trig.all, ...sc.trig.groups.flat()].some((e) =>
    new RegExp('\\b' + M.kind + '\\s*\\(\\s*' + M.index + '\\s*\\)\\s*(>=|=)\\s*' + M.value + '(?![.\\d])', 'i').test(String(e))));
  const cands = new Set();
  for (const [no, st] of an.states) {
    if (!(finishing.has(no) || no < 0)) continue;
    for (const sc of st.sctrls) {
      if (sc.type !== 'varadd' || commandsIn(sc.trig).length) continue;
      if (no < 0 && !firesOn(sc)) continue;
      for (const [nm, raw] of W.writesOf(sc)) { const d = S.lit(raw); if (d !== null && d > 0 && VARNAME.test(nm)) cands.add(nm); }
    }
  }
  const out = [];
  for (const name of [...cands].sort()) {
    if (Object.prototype.hasOwnProperty.call(base.frozen || {}, name)) continue;
    // Set to nothing but 0.
    let other = false;
    for (const st of an.states.values()) for (const sc of st.sctrls) {
      if (sc.type !== 'varset' && sc.type !== 'varrandom') continue;
      for (const [nm, raw] of W.writesOf(sc)) if (nm === name && S.lit(raw) !== 0) other = true;
    }
    if (other) continue;
    const esc = name.replace(/[()]/g, (c) => '\\' + c);
    const cmp = new RegExp('\\b' + esc + '\\s*(>=|<=|!=|=|>|<)\\s*(\\d+)(?![.\\d])', 'gi');
    const levels = new Set();
    const addLevels = (text) => {
      for (const m of String(text).matchAll(cmp)) {
        const n = +m[2];
        const at = m[1] === '>=' || m[1] === '<' ? [n] : m[1] === '>' || m[1] === '<=' ? [n + 1] : [n, n + 1];
        for (const L of at) if (L >= 1 && L <= 100) levels.add(L);
      }
    };
    for (const [no, st] of an.states) {
      const hers = hScenes.has(no);
      for (const sc of st.sctrls) {
        if (!(hers ? STAGE_ART_HERS : STAGE_ART_HIS).has(sc.type)) continue;
        for (const e of [...sc.trig.all, ...sc.trig.groups.flat(), ...sc.params.values()]) {
          let reads = [];
          try { reads = X.readsOf(String(e)); } catch (er) { reads = []; }
          if (!reads.some((r) => r.field === name && (hers ? r.via && HIM_REDIRECT.has(String(r.via).toLowerCase()) : !r.via))) continue;
          addLevels(e);
        }
      }
    }
    if (!levels.size) continue;
    const ref = varRef(name);
    hold(name, 0, 'keeps his ' + name + ' at 0, where his grab starts it: a count his finishes add to that his and her art compare (at '
      + [...levels].sort((a, b) => a - b).join(', ') + '); each of those is a stage of its own');
    if (!base.frozen || base.frozen[name] !== 0) continue;
    out.push({ name, kind: ref.kind, index: ref.index, levels: [...levels].sort((a, b) => a - b) });
  }
  return out;
}

// MUGEN'S HITDEF DEFAULT, p1sprpriority = 1: in MUGEN a HitDef that connects
// puts the attacker at sprite priority 1 unless it names its own; Ikemen GO
// 1.0.0 leaves him where he was (char.go: p1sprpriority IErr, "1 in Mugen").
// A MUGEN-authored scene layers on it: Kur0maru's glory hole 51205 holds him
// at 2 in its header, her hips at 2 in 51219, and she is meant to draw over
// his tentacle mass once his hit drops him to 1 - on Ikemen the tie draws the
// attacker on top. The gallery gives it back for a giver with no
// ikemenversion: `keep` lists his states whose HitDef names its own priority
// (`p1sprpriority`, or its alias `sprpriority`), where the default never
// applied.
function mugenP1Spr(G, info) {
  if (!G || !info || info.ikemenversion) return null;
  const keep = [];
  for (const s of G.an.states.values()) {
    if (s.sctrls.some((sc) => sc.type === 'hitdef' && (sc.params.has('p1sprpriority') || sc.params.has('sprpriority')))) keep.push(s.no);
  }
  return { keep: keep.sort((a, b) => a - b) };
}

// A CUTSCENE INTRO: a Helper his negative states spawn in round state 0-1
// whose state asserts the intro flag and goes only by its own time, later
// than INTRO_HOLD ticks (Goblin Party's ADVENTURE GUILD, helper 33517: his -1
// spawns it on `time = 0 && roundno = 1 && roundstate = [0,1]`, its 54119
// asserts Intro every frame, draws the guild and a talk at its desk in
// screen-space explods, and destroys itself at time 3600 or 4250 - a minute).
// In versus the round waits for it; the gallery's held intro (gallery.js
// DATA.introMax, the same 600) would sit in it for 600 ticks at every load
// before cutting it. The pair carries `cutscene` { helper, state, ends } (the
// least time it goes at), and the runtime cuts it at once. An exit on
// anything but its time (an AI's command, a variable alone) is no cutscene:
// that intro may end by itself, and the held intro still has it. Read once
// per giver.
const INTRO_HOLD = 600;
const INTRO_EARLY = /\broundstate\s*(?:=\s*\[\s*0\s*,\s*1\s*\]|<\s*2\b|<=\s*1\b|=\s*[01]\b(?!\s*[,.]))/i;
const TIME_FROM = /\btime\s*(>=|>|=)\s*(\d+)\b(?!\s*[,.])/gi;
function cutsceneIntro(G) {
  if (!G || !G.an || !Array.isArray(G.helperCtrls)) return null;
  if (G.cutscene !== undefined) return G.cutscene;
  // The groups of a controller, each with its triggerall lines.
  const groupsOf = (sc) => sc.trig.groups.map((g) => [...sc.trig.all, ...g]);
  // The least time a group can be true at (null: one that reads no time). A
  // line with an `||` in it bounds nothing.
  const fromTime = (lines) => {
    let lo = null;
    for (const txt of lines) {
      if (txt.includes('||')) continue;
      for (const m of txt.matchAll(TIME_FROM)) {
        if (redirected(txt, m.index)) continue;
        const n = +m[2] + (m[1] === '>' ? 1 : 0);
        lo = lo === null ? n : Math.max(lo, n);
      }
    }
    return lo;
  };
  let out = null;
  for (const h of G.helperCtrls) {
    if (h.state >= 0 || h.id === null) continue;
    const gs = groupsOf(h.sc);
    if (!gs.length || !gs.every((lines) => lines.some((t) => !t.includes('||') && INTRO_EARLY.test(t)))) continue;
    const no = S.lit(h.sc.params.get('stateno'));
    const s = no !== null && G.an.states.get(no);
    if (!s) continue;
    const intro = s.sctrls.some((sc) => sc.type === 'assertspecial' && ['flag', 'flag2', 'flag3'].some((k) => String(sc.params.get(k) || '').trim().toLowerCase() === 'intro'));
    const exits = s.sctrls.filter((sc) => sc.type === 'destroyself' || sc.type === 'changestate' || sc.type === 'selfstate');
    if (!intro || !exits.length) continue;
    const times = exits.flatMap((sc) => groupsOf(sc).map(fromTime));
    if (!times.length || times.some((t) => t === null)) continue;
    const ends = Math.min(...times);
    if (ends > INTRO_HOLD) { out = { helper: h.id, state: no, ends }; break; }
  }
  G.cutscene = out;
  return out;
}

// ---- the steps ------------------------------------------------------------------
// The steps for a partner whose answers to his probes are `victimHas` (null:
// not known). Cached per answer.
function giverSteps(base, victimHasIn) {
  if (!victimHasIn) { if (base.walks.has('?')) return base.walks.get('?'); }
  else for (const w of base.walkList) {
    let same = true;
    for (const [n, v] of w.asked) if (victimHasIn.has(n) !== v) { same = false; break; }
    if (same) return w.res;
  }
  stat.walks++;
  const victimHas = victimHasIn ? new AskSet(victimHasIn) : null;
  const t0 = Date.now();
  const { an, hScenes, root, cmdInfo } = base;
  const W = makeWalker(an, Object.assign({}, base.walkerOpts, { victimHas }));
  // A HELPER THAT PLAYS A SCENE, walked on its own: its variables are its
  // counters (the dog girl's thrusts, `Var(1) >= 5` then `>= 16`, added to
  // on animation elements), which no bounded walk counts up, so they are
  // never pinned - every phase they gate may come. Its flows are its own.
  let HW = null;
  const helperWalker = () => {
    if (!HW) { HW = makeWalker(an, Object.assign({}, base.walkerOpts, { victimHas, relevantVars: new Set(), sharedFlows: null, frozen: {}, rootCmds: true, memo: new WeakMap(), trigCache: new WeakMap() })); }
    HW.setPresent(presentNow);
    return HW;
  };
  let presentNow = null;
  const states = an.states;
  const isRelease = (C) => { const sc = an.scenes.get(C); return !!(sc && sc.release); };
  // What she is shown in: every custom state his states issue, the ones she
  // follows him into, and everything her own chains move her on to.
  const shownFrom = (issuedSet, f) => {
    const got = new Set(issuedSet);
    if (f) for (const [g, list] of base.follows) if (f.at.has(g)) for (const C of list) got.add(C);
    if (f) for (const [N, list] of base.helperFollow) if (f.at.has(N)) for (const C of list) got.add(C);
    for (let grew = true; grew;) {
      grew = false;
      for (const C of [...got]) for (const C2 of base.chains.get(C) || []) {
        if (got.has(C2)) continue;
        const need = base.chainPrev.get(C + '>' + C2);
        if (need && ![...need].some((p) => got.has(p))) continue;
        got.add(C2);
        grew = true;
      }
    }
    return new Set([...got].filter((C) => hScenes.has(C) && !isRelease(C)));
  };
  const shown = (f, more) => shownFrom([...f.issued.keys(), ...(more || [])], f);
  // The pins of the grab being walked (its machine's states), set per grab.
  let pinScope = null;
  let A0 = base.pinsFor(NO_INPUT);
  const scopeOf = new Map();
  const useScope = (E) => { pinScope = scopeOf.get(E) || null; A0 = base.pinsFor(NO_INPUT, pinScope); };
  const relax = (A, names) => {
    const P = base.pinsFor(new Set(names), pinScope);
    const out = Object.assign({}, A);
    for (const name of Object.keys(A0)) if (!P[name]) delete out[name];
    return out;
  };
  const sorted = (set) => [...set].sort((a, b) => a - b);
  const sameSet = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));
  const minus = (a, b) => new Set([...a].filter((x) => !b.has(x)));
  const mergeFlows = (list) => {
    if (list.length === 1) return list[0];
    const at = new Map(), stay = new Map(), issued = new Map(), edges = new Map();
    for (const f of list) {
      for (const [k, A] of f.at) at.set(k, at.has(k) ? joinA(at.get(k), A) : A);
      for (const [k, A] of f.stay) stay.set(k, stay.has(k) ? joinA(stay.get(k), A) : A);
      for (const [C, from] of f.issued) { if (!issued.has(C)) issued.set(C, new Set()); for (const x of from) issued.get(C).add(x); }
      for (const [a, bs] of f.edges || []) { if (!edges.has(a)) edges.set(a, new Set()); for (const b of bs) edges.get(a).add(b); }
    }
    return { at, stay, issued, edges };
  };
  const cmdRank = (k) => { const c = cmdInfo.get(k); return c ? c.rank : 1e6; };

  // A trigger that asks which state he is in (Minotaur's -1 on StateNo = 1011).
  const namesState = (sc) => [...sc.trig.all, ...sc.trig.groups.flat()].some((e) => {
    const str = String(e);
    for (const m of str.matchAll(/\b(?:prev)?stateno\b/gi)) if (!redirected(str, m.index)) return true;
    return false;
  });
  // The variables a state's controllers read (triggers and values).
  const readsCache = new Map();
  const readsOfState = (no) => {
    if (readsCache.has(no)) return readsCache.get(no);
    const out = new Set();
    const s = states.get(no);
    if (s) for (const sc of s.sctrls) for (const e of [...sc.trig.all, ...sc.trig.groups.flat(), ...sc.params.values()]) for (const v of X.varsOf(String(e))) out.add(v);
    if (s && s.anim !== null && s.anim !== undefined) for (const v of X.varsOf(String(s.anim))) out.add(v);
    readsCache.set(no, out);
    return out;
  };

  // WHERE A COMMAND CAN TAKE EFFECT in a situation: the states he stays in,
  // and - for a held command, asserted before he gets there - the states he
  // passes through in one tick (kuromaru's 6000 reads hold x on its only
  // tick). A controller of the state or of his negative states is a switch
  // on a command when asserting it changes whether the controller fires.
  const switchesOf = (Sit) => {
    if (Sit.switches) return Sit.switches;
    const out = new Map();   // command -> [{ H, A, zero, forced: Set, neg }]
    const f = Sit.flow;
    // A negative state's VarSet counts only when the situation's states read
    // what it writes (Minotaur's var(36), read by 1011's ChangeState) - not
    // a direction tracker nothing in the scene looks at.
    const reads = new Set();
    for (const no of f.at.keys()) for (const v of readsOfState(no)) reads.add(v);
    const relevantNeg = base.negCtrls.filter((sc) => (!['varset', 'varadd', 'varrandom'].includes(sc.type) && namesState(sc))
      || W.writesOf(sc).some(([nm]) => reads.has(nm)));
    for (const [H, Aat] of f.at) {
      if (!states.has(H)) continue;
      const stayA = f.stay.get(H);
      const zero = !stayA;
      const A = stayA || Aat;
      // Where he stands with control the scene is over (Minotaur's 999 after
      // the aftermath): a button there is an attack, and the runtime never
      // asserts one (the super throw 3121 is not a buster step).
      if (A[CTRL] && A[CTRL].length === 1 && A[CTRL][0] === 1) continue;
      const list = [...relevantNeg, ...states.get(H).sctrls];
      const per = new Map();
      for (const sc of list) {
        if (!SWITCH_TYPES.has(sc.type)) continue;
        const names = commandsIn(sc.trig, true);
        if (!names.length) continue;
        const b = W.trig(sc, A, NO_INPUT, H, null, zero);
        const pos = commandsIn(sc.trig);
        for (const k of names) {
          const info = cmdInfo.get(k);
          if (!info || !info.playable) continue;
          if (zero && !info.hold) continue;
          const v = W.trig(sc, A, new Set([k]), H, null, zero);
          // A switch that needs his control is never driven.
          if (v !== false && CTRL_WORD.test(trigText(sc.trig)) && W.trig(sc, Object.assign({}, A, { [CTRL]: [0] }), new Set([k]), H, null, zero) === false) continue;
          // Asserting it makes the controller false where it could fire (a
          // choice suppressed: hold x at kuromaru's 6000), or makes it fire
          // - also where it already might by other means (Brian's speed
          // VarSet, which auto can fire too: hold y makes it certain).
          if (v === false) { if (b !== false) { if (!per.has(k)) per.set(k, { H, A, zero, forced: new Set(), neg: 0 }); per.get(k).neg++; } continue; }
          if (b === true || (v === b && !pos.includes(k))) continue;
          if (v === b && W.byCommand(sc, A, new Set([k]), H, zero, k) === false) continue;
          if (!per.has(k)) per.set(k, { H, A, zero, forced: new Set(), neg: 0 });
          per.get(k).forced.add(sc);
        }
      }
      for (const [k, L] of per) { if (!out.has(k)) out.set(k, []); out.get(k).push(L); }
    }
    // (An alias of a command already listed is the same key: COMMAND ALIASES.)
    if (base.cmdAlias && base.cmdAlias.size) for (const k of [...out.keys()]) if ((base.cmdAlias.get(k) || []).some((a) => a !== k && out.has(a) && [...out.keys()].indexOf(a) < [...out.keys()].indexOf(k))) out.delete(k);
    Sit.switches = out;
    return out;
  };

  // The scenes a switch brings up first: what the switching tick issues, and
  // what the states it hands to issue on their own first tick (through
  // zero-tick shells).
  const firstOf = (r, H, forced) => {
    const got = new Set(r.issued.filter((i) => !forced || forced.has(i.via)).map((i) => i.C));
    let front = r.next.filter((x) => !forced || x.sure || forced.has(x.via)).map((x) => ({ no: x.no, A: x.A, prev: H }));
    for (let hop = 0; hop < 4 && front.length; hop++) {
      const nf = [];
      for (const x of front) {
        if (isBasic(x.no) || x.no < 0 || !states.has(x.no)) continue;
        const r2 = W.runState(x.no, x.A, NO_INPUT, { passes: 1, fresh: true, prev: x.prev });
        for (const i of r2.issued) got.add(i.C);
        if (r2.left) for (const y of r2.next) nf.push({ no: y.no, A: y.A, prev: x.no });
      }
      front = nf;
    }
    return got;
  };
  // Through zero-tick shells to the state he settles in (6003 -> 6002).
  const settle = (no, A) => {
    let cur = { no, A };
    for (let hop = 0; hop < 4; hop++) {
      if (isBasic(cur.no) || !states.has(cur.no)) return cur;
      const r = W.runState(cur.no, cur.A, NO_INPUT, { passes: 1, fresh: true });
      if (!r.left || !r.next.length) return cur;
      const nx = r.next[r.next.length - 1];
      cur = { no: nx.no, A: nx.A };
    }
    return cur;
  };
  // Does a state go to H once its time comes? A ChangeState of it into H
  // (or into a zero-tick shell that goes there), with the time atoms read
  // as come.
  const TIME_ATOM = /\b(animtime|animelem|time|statetime)\s*(=|>=|<=|>|<)\s*-?\d+(\s*,\s*(=|>=|<=|>|<)?\s*-?\d+)?/gi;
  const returnsByTime = (no, A, H) => {
    const st = states.get(no);
    if (!st) return false;
    for (const sc of st.sctrls) {
      if (sc.type !== 'changestate') continue;
      const to = W.values(sc.params.get('value'), A, no);
      if (!to.includes(H) && !to.some((v) => settle(v, A).no === H)) continue;
      const rw = (e) => String(e).replace(TIME_ATOM, '1');
      const fake = { trig: { all: sc.trig.all.map(rw), groups: sc.trig.groups.map((g) => g.map(rw)) } };
      if (W.trig(fake, A, NO_INPUT, no) === true) return true;
    }
    return false;
  };
  // A state that can hang: every way out waits for AnimTime 0 and one of the
  // animations it can play never ends (Brian's position-5 speed 1, anim 3335).
  const trapMemo = new Map();
  const trapIn = (f, known) => {
    for (const [no, A] of f.at) {
      if (known && known.has(no) && keyOf(known.get(no)) === keyOf(A)) continue;
      const tk = no + '#' + keyOf(A);
      if (trapMemo.has(tk)) { const t = trapMemo.get(tk); if (t) return t; continue; }
      const t = trapAt(no, A);
      trapMemo.set(tk, t);
      if (t) return t;
    }
    return null;
  };
  // (An AnimTime behind a redirect waits on someone else's animation - her
  // own, f.sanae's 15002 on `Target,animtime = 0` while he plays 3342 of
  // time -1 - so that way out is no wait on his.)
  const OWN_ANIMTIME = (e) => /\banimtime\b/i.test(String(e).replace(/\b(?:target|enemynear|enemy|p2|partner|parent|root|helper|helperindex|playerid|player|stateowner)\b\s*(?:\(\s*[^()]*\))?\s*,\s*animtime\b/gi, ''));
  const trapAt = (no, A) => {
    const s = states.get(no);
    if (!s) return null;
    const exits = s.sctrls.filter((sc) => (sc.type === 'changestate' || sc.type === 'selfstate') && W.trig(sc, A, NO_INPUT, no) !== false);
    if (!exits.length || !exits.every((sc) => OWN_ANIMTIME([...sc.trig.all, ...sc.trig.groups.flat()].join(' ')))) return null;
    for (const [, anims] of W.animsByCombo(no, A)) {
      const known = [...anims].filter((a) => base.airTimes.has(a));
      if (known.length && known.every((a) => base.airTimes.get(a) === -1)) return { state: no, anims: known };
    }
    return null;
  };
  // A state that stops the scene: a Pause or SuperPause longer than a few
  // seconds, or one whose length his variables decide (kuromaru's 60010,
  // `time = var(58)`, 10000 ticks and up).
  const stopsTime = (f, known) => {
    for (const no of f.at.keys()) {
      if (known && known.has(no)) continue;
      const s = states.get(no);
      if (!s) continue;
      for (const sc of s.sctrls) {
        if (sc.type !== 'pause' && sc.type !== 'superpause') continue;
        const raw = sc.params.get('time');
        if (raw === undefined) continue;
        const n = S.lit(raw);
        if (n === null || n >= TIME_STOP) return no;
      }
    }
    return null;
  };
  // Ticks from the start of a situation's walk to a state, along the
  // shortest way through it: each state's animation length (60 when unknown).
  const ticksTo = (Sit, H) => {
    const f = Sit.flow;
    const dist = new Map();
    const q = [];
    for (const s of Sit.starts) if (f.at.has(s)) { dist.set(s, 0); q.push(s); }
    while (q.length) {
      const no = q.shift();
      if (no === H) return dist.get(no);
      const t = W.animTicks(no, f.at.get(no) || {});
      const d = dist.get(no) + (t.max !== null ? Math.min(t.max, 1200) : 60);
      for (const b of (f.edges && f.edges.get(no)) || []) if (!dist.has(b) && f.at.has(b)) { dist.set(b, d); q.push(b); }
    }
    return 0;
  };

  // ONE SWITCH, made in a situation: the new situation it leads to.
  // THE PLACES OF ONE COMMAND, by what it does there: the same writes and
  // targets make one switch (hold Down is see-through in foreplay and in
  // the hub alike); different ones are different switches (c picks a
  // variant in kuromaru's foreplay; x chooses at his 6000 and restarts
  // foreplay at a climax's end).
  const groupsOf = (Sit, k) => {
    const locs = switchesOf(Sit).get(k) || [];
    const by = new Map();
    for (const L of locs) {
      const sig = [...L.forced].map((sc) => {
        if (sc.type === 'varset' || sc.type === 'varadd' || sc.type === 'varrandom') return sc.type + ':' + W.writesOf(sc).map(([nm, raw]) => nm + '=' + String(raw).replace(/\s+/g, '')).join(',');
        const raw = sc.type === 'hitdef' || sc.type === 'projectile' ? sc.params.get('p2stateno') : sc.params.get('value');
        return sc.type + ':' + String(raw).replace(/\s+/g, '');
      }).sort().join(';') + (L.neg ? '|neg@' + L.H : '');
      if (!by.has(sig)) by.set(sig, []);
      by.get(sig).push(L);
    }
    return [...by].map(([sig, list]) => Object.assign(list, { sig }));
  };
  const tCache = new WeakMap();
  const transitionOf = (Sit, k, g) => {
    if (!tCache.has(Sit)) tCache.set(Sit, new Map());
    const m = tCache.get(Sit);
    const key = k + '\u0001' + g.sig;
    if (!m.has(key)) m.set(key, transition(Sit, k, g));
    return m.get(key);
  };
  // The same switch (command and effect) made one situation up: what it
  // showed there. A switch deeper in the walk that shows nothing more is the
  // same step again (kuromaru's see-through, made again after a foreplay
  // choice, shows the family it showed from the grab).
  const sameAbove = (Sit, k) => {
    const P = Sit.parent;
    if (!P) return null;
    const out = new Set();
    for (const g of groupsOf(P, k)) {
      const U = transitionOf(P, k, g);
      if (U && !U.unsafe && U.differs) for (const C of U.until) out.add(C);
    }
    return out;
  };
  // A place's own tick and walk without any command: the baseline every
  // command made there is measured against.
  const baseCache = new WeakMap();
  const baselineAt = (Sit, L) => {
    if (!baseCache.has(Sit)) baseCache.set(Sit, new Map());
    const m = baseCache.get(Sit);
    const key = L.H + (L.zero ? 'z' : '');
    if (!m.has(key)) {
      const rb = W.runState(L.H, L.A, NO_INPUT, { passes: 1, fresh: L.zero });
      const starts = [...(rb.left ? [] : [{ no: L.H, A: rb.A, cont: true }]), ...rb.next.map((n) => ({ no: n.no, A: n.A, prev: L.H }))];
      m.set(key, { rb, fb: W.flow(starts, NO_INPUT), first: firstOf(rb, L.H) });
    }
    return m.get(key);
  };
  const transition = (Sit, k, locsIn) => {
    const locs = locsIn || (switchesOf(Sit).get(k) || []);
    if (!locs.length) return null;
    const on = new Set([k]);
    const info = cmdInfo.get(k);
    const flows = [], bflows = [];
    let issued = new Set(), bIssued = new Set(), first = new Set(), bFirst = new Set();
    const written = new Map();       // variable -> Set of values the switch writes
    let unsafe = null, trap = null, transient = false, dur = null, hasEffect = false;
    const at = [];
    let toggles = 0, regrabs = 0;
    const sureFirst = new Set();     // what the switch's own controllers and certain exits bring first
    const ownTick = new Set();       // what its own TargetStates issue on the switching tick
    const setOnly = new Set();       // variables the switch sets to a value (not adds to)
    const tickFrom = new Map();      // what the switching tick issues -> the states of his it is made in
    let rehit = 0, places = 0;       // places where he stays and the press re-issues her reaction
    for (const L of locs) {
      // A place where the command only flips a variable of its own (a
      // see-through or effects toggle) is no place to make it; a command
      // that does nothing else anywhere is never made.
      const forcedList = [...L.forced];
      if (!L.neg && forcedList.length && forcedList.every((sc) => {
        if (sc.type === 'varadd') return true;
        if (sc.type !== 'varset') return false;
        return W.writesOf(sc).every(([nm, raw]) => X.varsOf(String(raw)).includes(nm));
      })) { toggles++; continue; }
      let A = L.A;
      for (const sc of L.forced) A = W.narrow(sc, A, on, L.H) || A;
      A = relax(A, [k]);
      const extra = [...L.forced].filter((sc) => sc.state < 0);
      const r = W.runState(L.H, A, on, { passes: 1, forced: L.forced, fresh: L.zero, extra });
      const bl = baselineAt(Sit, L);
      const rb = bl.rb;
      // Never: a switch that ends the scene; none either that starts
      // another of his grabs (a super re-grabbing her from inside a scene).
      if (r.exits.some((x) => L.forced.has(x.via))) unsafe = unsafe || 'it ends the scene';
      if (r.next.some((x) => L.forced.has(x.via) && grabStates.has(x.no))) { regrabs++; continue; }
      if (L.forced.size || L.neg) hasEffect = true;
      const wr = new Map();
      for (const sc of forcedList) if (sc.type === 'varset' || sc.type === 'varadd') {
        for (const [nm, raw] of W.writesOf(sc)) {
          if (sc.type === 'varset') setOnly.add(nm);
          if (!wr.has(nm)) wr.set(nm, new Set());
          for (const v of W.values(raw, A, L.H)) wr.get(nm).add(v);
        }
      }
      for (const [nm, vals] of wr) { if (!written.has(nm)) written.set(nm, new Set()); for (const v of vals) written.get(nm).add(v); }
      const starts = (x) => [...(x.left ? [] : [{ no: L.H, A: x.A, cont: true }]), ...x.next.map((n) => ({ no: n.no, A: n.A, prev: L.H }))];
      const f = W.flow(starts(r), NO_INPUT), fb = bl.fb;
      flows.push(f); bflows.push(fb);
      for (const i of r.issued) issued.add(i.C);
      for (const i of rb.issued) bIssued.add(i.C);
      for (const C of firstOf(r, L.H)) first.add(C);
      for (const C of firstOf(r, L.H, L.forced)) sureFirst.add(C);
      for (const i of r.issued) if (L.forced.has(i.via)) ownTick.add(i.C);
      for (const i of r.issued) { if (!tickFrom.has(i.C)) tickFrom.set(i.C, new Set()); tickFrom.get(i.C).add(i.from); }
      // A HUB THAT ANSWERS EVERY PRESS: the press re-issues her reaction with
      // a TargetState of the state he stays in, and nothing moves him.
      places++;
      const ts = forcedList.filter((sc) => sc.type === 'targetstate');
      if (ts.length && !r.left && !forcedList.some((sc) => ['changestate', 'selfstate', 'hitdef', 'projectile'].includes(sc.type))
        && ts.every((sc) => W.trig(sc, r.A, on, L.H) !== false)) rehit++;
      for (const C of bl.first) bFirst.add(C);
      const stop = stopsTime(f, Sit.flow.at);
      if (stop !== null) unsafe = unsafe || 'it stops time (state ' + stop + ')';
      const tr = trapIn(f, Sit.flow.at);
      if (tr) trap = trap || tr;
      // TRANSIENT: the switch sends him out (J) and back to where it was
      // made, and on the way a state of his undoes what it wrote - sets it
      // back to what it was before (DongHwan's 6002 zeroes the speed var(39);
      // a climax that re-seeds the auto counter var(37) does not undo x).
      const outs = r.next.filter((x) => !isBasic(x.no) && states.has(x.no));
      if (wr.size && outs.length && !L.zero) {
        const J = settle(outs[0].no, outs[0].A);
        const seen = new Set(), q = outs.map((x) => ({ no: x.no, d: 1 }));
        let back = false, undone = false;
        while (q.length) {
          const { no, d } = q.shift();
          if (seen.has(no)) continue;
          seen.add(no);
          if (no === L.H) { back = true; continue; }
          if (d > 4) continue;
          const A1 = f.at.get(no);
          if (!A1) continue;
          for (const sc of states.get(no).sctrls) {
            if (sc.type !== 'varset' || W.trig(sc, A1, NO_INPUT, no) === false) continue;
            if ([...sc.trig.all, ...sc.trig.groups.flat()].some((e) => /\brandom\b/i.test(String(e)))) continue;
            for (const [nm, raw] of W.writesOf(sc)) {
              if (!wr.has(nm)) continue;
              // A definite reset: a constant (not a draw, not a copy) that is
              // the value the variable had before, or - that not known -
              // one the switch never writes.
              if (X.varsOf(String(raw)).length || X.usesRandom(String(raw)) || !Number.isFinite(X.evalExpr(String(raw), {}))) continue;
              const vals = W.values(raw, A1, no);
              const before = L.A[nm];
              if (vals.length && (before && before.length === 1 ? vals.every((v) => before.includes(v)) && !before.every((v) => wr.get(nm).has(v)) : vals.every((v) => !wr.get(nm).has(v)))) undone = true;
            }
          }
          for (const b of (f.edges.get(no) || [])) q.push({ no: b, d: d + 1 });
        }
        // One cycle: he goes back when his time there is up (DongHwan's
        // 6002 at AnimTime 0). A move that goes back only on something else
        // (Minotaur's hug punch 1020: the restraint timer or her escape) is a
        // position that lasts.
        if (back && undone && !returnsByTime(J.no, f.at.get(J.no) || J.A, L.H)) back = false;
        if (back && undone) {
          transient = true;
          const t = W.animTicks(J.no, f.at.get(J.no) || J.A);
          if (t.max !== null) dur = dur === null ? t.max : Math.max(dur, t.max);
        }
      }
      at.push(L.H);
    }
    // Nothing but toggles: never made. Nothing but a new grab, or nothing
    // at all: no switch.
    if (!hasEffect && toggles) return { k, info, unsafe: 'it only toggles a variable', new: new Set(), until: new Set(), at: [] };
    if (!hasEffect) return null;
    const f = mergeFlows(flows), fb = mergeFlows(bflows);
    const sh = shown(f, issued), bsh = shown(fb, bIssued);
    const fs1 = shownFrom(first), bfs = shownFrom(bFirst);
    const hubB = shownFrom(bIssued);
    const nw = minus(sh, Sit.shown);
    // The visual variables the switch writes, against what the scene has
    // there without it.
    const vis = {};
    for (const [nm, vals] of written) if (base.visual.has(nm) && setOnly.has(nm)) vis[nm] = [...vals].sort((a, b) => a - b);
    const bVis = {};
    for (const nm of Object.keys(vis)) {
      const all = new Set();
      let unknown = false;
      for (const A of fb.stay.values()) { if (!A[nm]) { unknown = true; break; } for (const v of A[nm]) all.add(v); }
      bVis[nm] = unknown ? '?' : [...all].sort((a, b) => a - b).join('/');
    }
    const visDiff = Object.keys(vis).some((nm) => bVis[nm] !== vis[nm].join('/'));
    // A switch that shows nothing new counts when it NARROWS what could
    // show - fewer scenes than the scene has there without it, or fewer on
    // the switching tick or first (kuromaru's hold x: breast-suck and never
    // the kiss; Brian's hold y while auto runs: speed 1 of 1-4) - or when it
    // picks her art (a variant).
    const strict = (a, b) => a.size < b.size && [...a].every((C) => b.has(C));
    const hubI = shownFrom(issued);
    const narrows = strict(minus(sh, hubB), minus(bsh, hubB)) || strict(minus(fs1, hubB), minus(bfs, hubB)) || (hubI.size > 0 && strict(hubI, hubB));
    const differs = nw.size > 0 || narrows || visDiff;
    // What the switch shows: the scenes it brings that the situation did
    // not show; else - it narrows what was possible - what the switching
    // tick itself issues when that narrows what the tick issues without it
    // (Brian's hold c while auto runs: 6205 of 6201-6205), else what its own
    // controllers and certain exits bring up first, else what it brings up
    // first at all, besides the hub's own re-target.
    let until = nw;
    if (!until.size && hubI.size && strict(hubI, hubB)) until = hubI;
    const sure = minus(shownFrom(sureFirst), hubB);
    if (!until.size && sure.size) until = sure;
    // A switch that picks her art (kuromaru_plus's c/z/y in foreplay: the
    // variant var(35)) shows what its own controllers bring first, every
    // time - the insertion 6016/6017 or the virginity break 6231/6232 - not
    // only what the situation had not shown yet.
    const own = shownFrom(ownTick);
    if (visDiff && own.size) until = own;
    if (!until.size && minus(fs1, hubB).size) until = minus(fs1, hubB);
    // Nothing but the hub's own re-target leaves until empty: no step of
    // its own (the walk drops it).
    // MASHED (Kur0maru's eating throw: a/b/x/y in 3160 each re-issue her 3220,
    // which goes back to 3210 at AnimTime 0, and he stays in 3160): one press
    // shows her reaction for a few frames, so the press is made again and
    // again for as long as the step is on screen - where the reaction goes
    // back by itself to what the scene already showed.
    const mashed = !transient && !info.hold && places > 0 && rehit === places && ownTick.size > 0
      && [...ownTick].every((C) => (base.chains.get(C) || []).some((C2) => Sit.shown.has(C2)));
    // (Where her reaction goes back to between two presses: on screen too.)
    const mashBack = mashed ? sorted(new Set([...ownTick].flatMap((C) => (base.chains.get(C) || []).filter((C2) => Sit.shown.has(C2) && !ownTick.has(C2))))) : [];
    const mode = mashed ? 'mash' : transient ? (dur !== null && dur <= SUSTAIN_MAX ? 'sustain' : (info.hold ? 'hold' : 'press')) : (info.hold ? 'hold' : 'press');
    const fired = new Set(locs.flatMap((L) => [...L.forced]));
    // Which states of his put her in each scene (a scene is a custom state
    // and the edge he gives it: GRAIL 4.10).
    const issuers = new Map();
    for (const [C, from] of [...(f.issued || []), ...tickFrom]) { if (!issuers.has(C)) issuers.set(C, new Set()); for (const x of from) issuers.get(C).add(x); }
    return { k, info, locs, at: [...new Set(at)], flow: f, shown: sh, first: fs1, new: nw, until, differs, transient, dur, mode, fired, issuers, mashBack,
      unsafe: unsafe || (trap ? 'it can hang (state ' + trap.state + ' plays ' + trap.anims.join('/') + ', which never ends)' : null),
      written, vis, rule: nw.size ? 'new' : 'narrow' };
  };

  // Jumps for the switches a player makes with two commands on one tick.
  const comboJumps = (Sit) => {
    const out = [];
    const seen = new Set();
    for (const [H, A] of Sit.flow.stay) {
      if (A[CTRL] && A[CTRL].length === 1 && A[CTRL][0] === 1) continue;
      const st = states.get(H);
      if (!st) continue;
      for (const sc of st.sctrls) {
        if (sc.type !== 'changestate') continue;
        for (const g of sc.trig.groups) {
          const cs = commandsIn({ all: sc.trig.all, groups: [g] }).filter((k) => cmdInfo.has(k) && cmdInfo.get(k).playable);
          if (cs.length < 2) continue;
          if (W.trig(sc, A, new Set(cs), H) === false) continue;
          if (cs.some((k) => W.trig(sc, A, new Set([k]), H) !== false)) continue;
          for (const J of W.values(sc.params.get('value'), A, H)) {
            if (!states.has(J) || isBasic(J) || seen.has(H + '>' + J)) continue;
            seen.add(H + '>' + J);
            const hc = S.lit(states.get(J).header.get('ctrl'));
            const f = W.flow([{ no: J, A: Object.assign({}, A, hc !== null ? { [CTRL]: [hc ? 1 : 0] } : {}), prev: H }], NO_INPUT);
            if (stopsTime(f, Sit.flow.at) !== null || trapIn(f, Sit.flow.at)) continue;
            const sh = shown(f);
            const nw = minus(sh, Sit.shown);
            const r = W.runState(J, A, NO_INPUT, { passes: 1, fresh: true, prev: H });
            // What it puts her in first, a scene or not (the mount's 1515 is her
            // hold there): the presses made from it are the steps.
            let first = minus(shownFrom(new Set(r.issued.map((i) => i.C))), Sit.shown);
            if (!first.size) first = new Set(r.issued.map((i) => i.C).filter((C) => W.custom.has(C) && !Sit.shown.has(C)));
            if (!first.size) continue;
            // (One input, compact: hold Down + press y is 'hold Down+y'.)
            const words = cs.map((k, i) => (i ? cmdInfo.get(k).words.replace(/^(press|hold|motion) /, '') : cmdInfo.get(k).words)).join('+');
            out.push({ k: null, jump: J, info: { words, hold: false, rank: 300 }, at: [H], flow: f, shown: sh, first: nw, new: nw, until: first,
              differs: true, transient: false, dur: null, mode: null, fired: new Set([sc]), written: new Map(), vis: {}, rule: 'new', unsafe: null });
          }
        }
      }
    }
    return out;
  };

  // ---- the walk, per grab --------------------------------------------------------
  const cands = [];            // candidate steps, every grab
  const firstSit = new Map();  // grab -> its own situation
  const notes = [];            // scenes only an unsafe or unexplored switch reaches
  const entries = [];
  const covered = new Set();   // every state of his some situation runs through
  const grabStates = new Set(base.grabs.filter((g) => g.direct).map((g) => g.no));
  const presentOf = new Map();  // grab -> the helpers that can exist during it
  const summonOf = new Map();   // summon entry -> base.summons' entry
  const actionT = new WeakMap(); // a path action -> the switch it makes
  const jumpWords = new WeakMap(); // a jump for two commands -> the input it stands for
  const entryStates = new Map(); // grab -> every state of his its walk ran through
  const entryEdges = new Map();  // grab -> his state -> the states it goes on to by itself
  // Which helpers can exist during a grab: the ones his negative states
  // spawn (unless the setup keeps them off) and the ones the grab's own
  // states can spawn.
  const always = new Set();
  for (const h of base.helperCtrls) {
    if (h.state >= 0 || h.id === null) continue;
    if (W.trig(h.sc, Object.assign({}, A0), null, h.state) === false) continue;
    always.add(h.id);
  }
  for (const grab of [...base.grabs, ...base.summons.map((sm) => ({ no: sm.no, direct: true, summon: sm }))]) {
    const E = grab.no;
    // A grab its launcher sends her to only by her art (Kur0maru's milking
    // 51305, for a partner with anim 52219 or 110810): none for a partner
    // every route passes by.
    if (victimHas && base.launchers.has(E)) {
      W.setPresent(null);
      // (Commands unknown: a -1 block asks its own input too.)
      if (base.launchers.get(E).every((r) => W.trig(r.sc, base.initial, null, r.from) === false)) continue;
    }
    // A summon's walk starts in the hub he enters once his helper holds her
    // (none: in the summon state itself).
    const start = grab.summon && grab.summon.hub !== null ? grab.summon.hub : E;
    if (grab.summon) summonOf.set(E, grab.summon);
    W.setPresent(null);
    const machine0 = W.flow([{ no: start, A: base.initial, prev: 0 }], null);
    const present = new Set(always);
    if (grab.summon) for (const id of [grab.summon.helper, ...(grab.summon.also || [])]) present.add(id);
    for (const h of base.helperCtrls) if (h.state >= 0 && h.id !== null && machine0.at.has(h.state)) present.add(h.id);
    W.setPresent(present);
    presentNow = present;
    presentOf.set(E, present);
    scopeOf.set(E, new Set(machine0.at.keys()));
    useScope(E);
    // A grab whose states reach no scene whatever he is told (his ordinary
    // throws) has nothing to walk.
    // A helper that plays the scene: whatever its own states give her from
    // where it starts, her answers to their probes deciding (the dog girl's
    // piston sequence 1806070-1806079 where she ships 19230, else the small
    // dog's hold 6064).
    const hold = !grab.summon ? []
      : grab.summon.helperPlays ? [...shownFrom([...helperWalker().flow(grab.summon.starts.map((no) => ({ no, A: {}, prev: 0 })), NO_INPUT).issued.keys()], null)]
        : grab.summon.hold.filter((C) => hScenes.has(C));
    if (!shown(W.flow([{ no: start, A: base.initial, prev: 0 }], null), hold).size) continue;
    const own = W.flow([{ no: start, A: Object.assign({ [CTRL]: [grab.summon ? 0 : 1] }, A0), prev: 0 }], NO_INPUT);
    if (!grab.direct && [...own.at.keys()].some((n) => n !== E && grabStates.has(n))) continue;
    const S0 = { id: 0, depth: 0, parent: null, flow: own, shown: shown(own, hold), starts: [start], path: [], kind: 'own', vis: {} };
    // (A press summon's key is a helper state: no switch of his is made there.)
    if (grab.summon && grab.summon.press) S0.leaf = true;
    firstSit.set(E, S0);
    const sits = [S0];
    const byKey = new Map();
    // Two situations are one when they are the same kind (a position never
    // merges with a speed or climax) and their switch shows the same scenes
    // in a scene that shows the same (Brian's hold Up in the hub and on a
    // climax's last tick are one position 2).
    // A position whose path set variables is the one those values make (last
    // write wins: kuromaru's Up then Down is Down; DongHwan's 2 then 3 is 3).
    const sitKey = (Sit) => {
      const w = JSON.stringify(Object.keys(Sit.wmap || {}).sort().map((k) => [k, Sit.wmap[k]]));
      if (Sit.kind === 'position' && Sit.T && Sit.T.written.size) return 'P|' + w;
      return (Sit.kind === 'own' || Sit.kind === 'position' ? 'P' : 'L:' + Sit.kind) + '|' + (Sit.T ? sorted(Sit.T.until).join(',') : '') + '|'
        + sorted(Sit.shown).join(',') + '|' + JSON.stringify(Sit.vis) + '|' + w;
    };
    byKey.set(sitKey(S0), S0);
    let returnAction = null;
    // A command the first position does not answer to, or answers to with
    // nothing that shows (Brian's holdfwd on a climax's last tick sets the
    // position he is already in).
    const s0T = new Map();
    const harmlessAtFirst = (k) => {
      if (!switchesOf(S0).has(k)) return true;
      if (!s0T.has(k)) s0T.set(k, groupsOf(S0, k).map((g) => transitionOf(S0, k, g)));
      return s0T.get(k).every((T0) => !T0 || (!T0.unsafe && !T0.differs));
    };
    for (let i = 0; i < sits.length && sits.length < SITUATION_CAP; i++) {
      const Sit = sits[i];
      const sw = switchesOf(Sit);
      Sit.hubs = new Set([...sw.values()].flatMap((ls) => ls.map((L) => L.H)));
      if (Sit.depth >= DEPTH_MAX || Sit.leaf) continue;
      const trans = [];
      for (const [k, locs] of [...sw.keys()].sort((a, b) => cmdRank(a) - cmdRank(b) || (a < b ? -1 : 1)).flatMap((k2) => groupsOf(Sit, k2).map((g) => [k2, g]))) {
        const T = transitionOf(Sit, k, locs);
        if (T && !T.unsafe && T.differs && Sit.parent) {
          const U = sameAbove(Sit, k);
          if (U && U.size && [...T.until].every((C) => U.has(C))) continue;
        }
        if (!T) continue;
        if (T.unsafe) { if (T.new.size) notes.push({ scenes: [...T.new], why: 'switched to by ' + T.info.words + ', which the gallery never asserts: ' + T.unsafe }); continue; }
        if (!T.differs || !T.until.size) continue;
        trans.push(T);
      }
      // TWO COMMANDS ON ONE TICK (Minotaur's mount: 1011 goes to 1510 on
      // `command = "holddown" && command = "y"`): the runtime asserts one
      // command per action, so the state it enters is jumped into from where
      // he waits for it, with the scene carried on from there.
      if (Sit.depth < DEPTH_MAX && !Sit.leaf) for (const T of comboJumps(Sit)) trans.push(T);
      // AUTO: a persistent switch whose scenes include what two or more
      // transient ones show (DongHwan's x plays speeds 1-3 and the climax).
      // A press and its held twin firing the same controller (DongHwan's
      // y and hold_y): the held one stays - it lands on the hub's one
      // cycle-end tick, and it is the one that also turns auto off.
      // One command's second place that shows only part of what its first
      // place shows (Minotaur's b in a position's later phase: that
      // position one phase up) is the same step.
      for (let a = trans.length - 1; a >= 0; a--) {
        const T = trans[a];
        if (trans.some((U) => U !== T && U.k === T.k && U.until.size > T.until.size && [...T.until].every((C) => U.until.has(C)))) trans.splice(a, 1);
      }
      for (let a = trans.length - 1; a >= 0; a--) {
        const T = trans[a];
        if (T.info.hold) continue;
        if (trans.some((U) => U !== T && U.info.hold && [...T.fired].some((sc) => U.fired.has(sc)))) trans.splice(a, 1);
      }
      const tr = trans.filter((T) => T.transient);
      for (const T of trans) {
        if (T.transient) continue;
        const inside = tr.filter((u) => [...u.until].every((C) => T.until.has(C))).length;
        if (inside >= 2) T.auto = true;
      }
      for (const T of trans) {
        const kind = T.transient ? (T.mode === 'sustain' ? 'speed' : 'climax') : T.auto ? 'auto' : T.mode === 'mash' ? 'mash' : 'position';
        // The way back to the grab's first position, in place: a switch the
        // first position does not answer to (DongHwan's holdfwd is guarded
        // there) that writes the values it has.
        if (kind === 'position' && Sit !== S0 && harmlessAtFirst(T.k) && [...T.shown].every((C) => S0.shown.has(C))) {
          const same = [...T.written].every(([nm, vals]) => T.at.every((H) => {
            const A = S0.flow.stay.get(H);
            return A && A[nm] && A[nm].length === vals.size && A[nm].every((v) => vals.has(v));
          }));
          if (same && T.written.size) { if (!returnAction) returnAction = T; continue; }
        }
        const vis = Object.assign({}, Sit.vis, Object.fromEntries(Object.entries(T.vis).map(([nm, v]) => [nm, v.join('/')])));
        const N = { id: sits.length, depth: Sit.depth + 1, parent: Sit, flow: T.flow, shown: T.shown, first: T.first, starts: T.at,
          T, kind, vis, leaf: kind !== 'position',
          wmap: Object.assign({}, Sit.wmap || {}, Object.fromEntries([...T.written].map(([nm, vals]) => [nm, [...vals].sort((a, b) => a - b).join('/')]))) };
        // (The commands that lead on from a situation: NAV ROLES' rungs.)
        if (T.k) (Sit.kidCmds || (Sit.kidCmds = new Set())).add(T.k);
        for (const H of T.at || []) (Sit.kidAt || (Sit.kidAt = new Set())).add(H);
        const kk = sitKey(N);
        if (byKey.has(kk)) continue;
        byKey.set(kk, N);
        sits.push(N);
      }
    }
    // Leaves looked into once more, only to say why what they alone reach is
    // not listed (Brian's position 5: a motion on a climax's last tick).
    for (const Sit of sits) {
      if (!Sit.leaf || Sit.depth > 2) continue;
      for (const [k, locs] of [...switchesOf(Sit).keys()].flatMap((k2) => groupsOf(Sit, k2).map((g) => [k2, g]))) {
        const T = transitionOf(Sit, k, locs);
        if (!T || !T.new.size) continue;
        notes.push({ scenes: [...T.new], why: 'switched to only from inside a ' + (Sit.kind === 'speed' ? 'speed cycle' : Sit.kind === 'auto' ? 'running auto mode' : 'climax')
          + ' (' + T.info.words + ')' + (T.unsafe ? ', and ' + T.unsafe : '') });
      }
    }
    for (const Sit of sits) for (const no of Sit.flow.at.keys()) covered.add(no);
    entryStates.set(E, new Set(sits.flatMap((Sx) => [...Sx.flow.at.keys()])));
    // Where his states go by themselves, over every situation of the grab.
    const eg = new Map();
    for (const Sx of sits) for (const [a, bs] of Sx.flow.edges || []) { if (!eg.has(a)) eg.set(a, new Set()); for (const b2 of bs) eg.get(a).add(b2); }
    entryEdges.set(E, eg);
    // The path to each situation.
    // The grab's own step carries the way back to it; so do its speeds,
    // climax and auto, which are made from it. Another position's path
    // starts where the scene is.
    const ownPath = () => (returnAction ? [actionOf(returnAction, S0, true)] : []);
    const pathOf = (Sit) => {
      if (Sit === S0) return ownPath();
      const p = Sit.parent === S0 ? (Sit.kind === 'position' ? [] : ownPath()) : pathOf(Sit.parent);
      return [...p, actionOf(Sit.T, Sit.parent)];
    };
    const actionOf = (T, from, isReturn) => {
      const until = isReturn ? sorted(new Set([...S0.shown, ...T.until])) : sorted(T.until);
      const a = T.jump !== undefined ? { jump: T.jump, at: T.at[0], until } : { cmd: T.k, mode: T.mode, until };
      if (T.jump !== undefined) jumpWords.set(a, T.info.words);
      actionT.set(a, T);
      const est = Math.max(0, ...T.at.map((H) => ticksTo(from, H)));
      const pat = Math.max(PATIENCE, Math.min(12000, 3 * est + 120));
      if (pat > PATIENCE) a.patience = pat;
      return a;
    };
    for (const Sit of sits) {
      const path2 = pathOf(Sit);
      const until = Sit === S0 ? S0.shown : Sit.T.until;
      if (!until.size) continue;
      const iss = Sit === S0 ? S0.flow.issued : Sit.T.issuers;
      const via = {};
      for (const C of until) via[C] = sorted(new Set((iss && iss.get(C)) || []));
      cands.push({ entry: E, sit: Sit, until: sorted(until), path: path2, kind: Sit.kind, depth: Sit.depth, via,
        rule: Sit === S0 ? 'own' : Sit.T.rule, visKey: JSON.stringify(Sit.vis), order: cands.length, returned: Sit === S0 && !!returnAction });
    }
    entries.push(E);
  }

  // ---- the Baomaru hub, read from the hub itself (GRAIL 4.10 C) --------------------
  // Where a grab lands in a hub whose TargetState computes her state from a
  // position P and a phase Ph (`6195+(var(40)*5)+(1+var(39))`, with his next
  // state `6000+1+var(39)` on the same trigger), the hub's own controllers
  // say every step, numbered the way his files number them:
  //   position k  a command VarSet P = k (DongHwan's holdfwd..holddown,
  //               Kur0maru's F/B/U/D/s presses, Brian's four holds and
  //               x+a / x+b); held when it is guarded where it already is,
  //               so it lands on the first tick he is in the hub
  //   speed s     a command VarSet Ph = s whose next state is the shared
  //               short cycle (6002): the held command, sustained
  //   climax      the phase whose next state is his long one (6005): held
  //               until it shows; a climax command his files gate shut for
  //               the gallery's pair (kuromaru_plus's `enemy,life <= 10`)
  //               becomes a jump into that state, when the state itself
  //               sends her to her climax
  //   auto        a command VarSet of the counter the phase bands read (x)
  // Every step but auto turns auto off on its first action, with the value
  // his own held speeds write (DongHwan's and Kur0maru's var(37) = 0, Brian's
  // fvar(27) = 0); where auto turns on by itself on the way to the hub
  // (Brian's intro), a set of its own follows the position too. A grab that
  // stops before the hub (Brian's grope stage: 6000 leaves only on a press of
  // Up while she is in the 6200 his grab put her in) has its own step, and
  // every other path starts with that press, until every state past it - so
  // it is never pressed in the hub, where Up is a see-through toggle.
  const bao = new Map();
  const readBao = (E) => {
    const S0 = firstSit.get(E);
    if (!S0) return null;
    W.setPresent(presentOf.get(E) || null);
    useScope(E);
    const machine = W.flow([{ no: E, A: base.initial, prev: 0 }], null);
    const hub = findHubs(an, new Set(machine.at.keys()))[0];
    if (!hub) return null;
    const { H, P, Ph } = hub;
    let exit = null, arrive = null;
    if (S0.flow.at.has(H)) arrive = { flow: S0.flow, starts: S0.starts, shown: S0.shown };
    else {
      const ks = [...switchesOf(S0).keys()].sort((a, b) => cmdRank(a) - cmdRank(b) || (a < b ? -1 : 1));
      for (const k of ks) {
        for (const g of groupsOf(S0, k)) {
          const T = transitionOf(S0, k, g);
          if (T && !T.unsafe && T.flow && T.flow.at.has(H)) { exit = T; break; }
        }
        if (exit) break;
      }
      if (!exit) return null;
      arrive = { flow: exit.flow, starts: exit.at, shown: exit.shown };
    }
    const Ahub = arrive.flow.stay.get(H) || arrive.flow.at.get(H) || A0;
    const st = states.get(H);
    const withP = (k, s) => Object.assign({}, Ahub, { [P]: [k] }, s === undefined ? {} : { [Ph]: [s] });
    const k0 = Ahub[P] && Ahub[P].length === 1 ? Ahub[P][0] : null;
    const playable = (c) => cmdInfo.has(c) && cmdInfo.get(c).playable;
    // Positions.
    const posSw = new Map();
    for (const sc of st.sctrls) {
      if (sc.type !== 'varset') continue;
      for (const [nm, raw] of W.writesOf(sc)) {
        const k = nm === P ? S.lit(raw) : null;
        if (k === null || k <= 0) continue;
        const b = hub.at(k, 0);
        if (b === null || !hScenes.has(b)) continue;
        for (const c of commandsIn(sc.trig)) if (playable(c)) { if (!posSw.has(k)) posSw.set(k, []); posSw.get(k).push({ sc, c, info: cmdInfo.get(c) }); }
      }
    }
    const kAll = [...new Set([...posSw.keys(), ...(k0 !== null ? [k0] : [])])].filter((k) => hub.at(k, 0) !== null && hScenes.has(hub.at(k, 0))).sort((a, b) => a - b);
    if (!kAll.length) return null;
    const posCmd = new Map();
    for (const [k, list] of posSw) {
      const others = kAll.filter((j) => j !== k);
      const ok = list.filter(({ sc, c }) => others.some((j) => W.byCommand(sc, withP(j, 0), new Set([c]), H, false, c) !== false));
      if (!ok.length) continue;
      ok.sort((a, b) => (b.info.hold ? 1 : 0) - (a.info.hold ? 1 : 0) || a.info.rank - b.info.rank);
      const pick = ok[0];
      const guarded = W.trig(pick.sc, withP(k, 0), new Set([pick.c]), H) === false;
      posCmd.set(k, { c: pick.c, mode: guarded || pick.info.hold ? 'hold' : 'press', sc: pick.sc });
    }
    const kList = kAll.filter((k) => posCmd.has(k) || k === k0);
    // Phases: each value's command, the plain one (not the random or auto
    // alternative that writes it too: Brian's y that is sometimes speed 3).
    const phase = new Map();
    const bandVars = new Set();
    for (const sc of st.sctrls) {
      if (sc.type !== 'varset') continue;
      for (const [nm, raw] of W.writesOf(sc)) {
        if (nm !== Ph) continue;
        const s = S.lit(raw);
        if (s === null || s <= 0) continue;
        const allTxt = sc.trig.all.join(' ');
        for (const g of sc.trig.groups) {
          const cs = commandsIn({ all: [], groups: [g] });
          if (!cs.length) {
            // The counter the band compares (the first variable: var(37) in
            // `var(37) = [54-random%20, 150+var(36)]`, not its draw var(36)).
            const v = X.varsOf(g.join(' ')).find((x) => VARNAME.test(x) && x !== P && x !== Ph);
            if (v) bandVars.add(v);
            if (!phase.has(s)) phase.set(s, { list: [], band: false });
            phase.get(s).band = true;
            continue;
          }
          const plain = !/\brandom\b/i.test(allTxt + ' ' + g.join(' '));
          if (!phase.has(s)) phase.set(s, { list: [], band: false });
          for (const c of cs) if (playable(c)) phase.get(s).list.push({ sc, c, info: cmdInfo.get(c), plain });
        }
      }
    }
    const kRef = k0 !== null ? k0 : kList[0];
    const phaseCmd = new Map();
    for (const [s, ph] of phase) {
      // Drivable through its own command's trigger lines (not a band that
      // may fire anyway): kuromaru_plus's c needs her life <= 10, never so here.
      const ok = ph.list.filter((x) => x.plain && W.byCommand(x.sc, withP(kRef, 0), new Set([x.c]), H, false, x.c) !== false);
      ok.sort((a, b) => (b.info.hold ? 1 : 0) - (a.info.hold ? 1 : 0) || a.info.rank - b.info.rank);
      if (ok.length) phaseCmd.set(s, { c: ok[0].c, sc: ok[0].sc });
    }
    // Speed or climax: the short shared cycle, or his long state.
    const nextOf = new Map();
    for (const s of phase.keys()) {
      const n = hub.next(s);
      if (n === null) continue;
      const J = settle(n, withP(kRef, s));
      const t = W.animTicks(J.no, withP(kRef, s));
      nextOf.set(s, { no: J.no, ticks: t.max });
    }
    const counts = new Map();
    for (const x of nextOf.values()) counts.set(x.no, (counts.get(x.no) || 0) + 1);
    const cyc = [...counts].sort((a, b) => b[1] - a[1])[0];
    const isClimax = (s) => { const x = nextOf.get(s); return !!x && (x.no !== (cyc && cyc[0]) || (x.ticks !== null && x.ticks > SUSTAIN_MAX)); };
    const speeds = [...phase.keys()].filter((s) => nextOf.has(s) && !isClimax(s)).sort((a, b) => a - b);
    const climaxS = [...phase.keys()].filter((s) => nextOf.has(s) && isClimax(s)).sort((a, b) => b - a)[0];
    // Auto: the command VarSet of a counter the bands read; auto off: the
    // value his other commands write it.
    let auto = null;
    const offs = new Map();
    for (const sc of st.sctrls) {
      if (sc.type !== 'varset') continue;
      for (const [nm, raw] of W.writesOf(sc)) {
        if (!bandVars.has(nm)) continue;
        const cs = commandsIn(sc.trig).filter(playable);
        if (!cs.length) continue;
        if (S.lit(raw) === 0) { if (!offs.has(nm)) offs.set(nm, 0); continue; }
        if (!auto) {
          const c = cs.slice().sort((a, b) => (cmdInfo.get(a).hold ? 1 : 0) - (cmdInfo.get(b).hold ? 1 : 0) || cmdInfo.get(a).rank - cmdInfo.get(b).rank)[0];
          if (W.trig(sc, withP(kRef, 0), new Set([c]), H) !== false) auto = { name: nm, c };
        }
      }
    }
    const offRef = auto && offs.has(auto.name) ? varRef(auto.name) : null;
    const autoOff = offRef ? [{ kind: offRef.kind, index: offRef.index, value: offs.get(auto.name) }] : null;
    const autoOnArrival = !!auto && (!Ahub[auto.name] || Ahub[auto.name].some((v) => v !== 0));
    // The states of the hub's own family, and what each position's switch
    // brings first beside its base (Brian's lift 72001, once per match).
    const family = new Set();
    for (const k of kAll) for (const s of [0, ...phase.keys()]) { const C = hub.at(k, s); if (C !== null) family.add(C); }
    const firstExtra = (k) => {
      const pc = posCmd.get(k);
      if (!pc) return [];
      const j = kList.find((x) => x !== k && W.trig(pc.sc, withP(x, 0), new Set([pc.c]), H) !== false);
      if (j === undefined) return [];
      // What the command adds to the hub's own tick (not the climax auto
      // may start anyway, kuromaru_plus's 6222).
      const r = W.runState(H, withP(j, 0), new Set([pc.c]), { passes: 1, fresh: false });
      const r0 = W.runState(H, withP(j, 0), NO_INPUT, { passes: 1, fresh: false });
      const own = new Set(st.sctrls.filter((sc) => commandsIn(sc.trig).includes(pc.c)));
      const without = new Set([...r0.issued.map((i) => i.C), ...firstOf(r0, H)]);
      const got = new Set([...r.issued.map((i) => i.C), ...firstOf(r, H, own)]);
      return sorted(new Set([...got].filter((C) => hScenes.has(C) && !family.has(C) && !without.has(C))));
    };
    const bases = new Set(kAll.map((k) => hub.at(k, 0)));
    const issuedFrom = (start, A) => {
      const got = new Set(), seen = new Set(), q = [{ no: start, A, d: 0 }];
      while (q.length) {
        const { no, A: A1, d } = q.shift();
        // The climax state itself (after its zero-tick shells): what comes
        // after it is the next scene (kuromaru_plus's foreplay again).
        if (seen.has(no) || no === H || isBasic(no) || no < 0 || !states.has(no) || d > 0) continue;
        seen.add(no);
        const r = W.runState(no, A1, NO_INPUT, { passes: 3, fresh: true });
        for (const i of r.issued) got.add(i.C);
        for (const x of r.next) q.push({ no: x.no, A: x.A, d: d + 1 });
      }
      // (Her bases, where the climax sends her back, are not followed: position
      // 2's base chains on into the once-per-match lift 72001.)
      return shownFrom(new Set([...got].filter((C) => !bases.has(C))));
    };
    const climaxStates = (k) => {
      if (climaxS === undefined) return [];
      const main = hub.at(k, climaxS);
      const nx = nextOf.get(climaxS);
      const more = nx ? issuedFrom(nx.no, withP(k, climaxS)) : new Set();
      const own = new Set([...family].filter((C) => kAll.some((j) => j !== k && [0, ...phase.keys()].some((s) => hub.at(j, s) === C))));
      const out = new Set(main !== null && hScenes.has(main) ? [main] : []);
      for (const C of more) if (!bases.has(C) && !own.has(C) && !speeds.some((s) => hub.at(k, s) === C)) out.add(C);
      return sorted(out);
    };
    // Patience for the first position from a fresh grab: his own walk there,
    // and far more when it loops on the way (kuromaru_plus's foreplay
    // countdown, the virginity break).
    const arriveSit = exit ? { flow: exit.flow, starts: exit.at } : S0;
    let est = ticksTo(arriveSit, H);
    {
      const seen = new Set(), q = [...arriveSit.starts];
      let loops = false;
      while (q.length && !loops) {
        const no = q.shift();
        if (seen.has(no) || no === H) continue;
        seen.add(no);
        for (const b of (arriveSit.flow.edges && arriveSit.flow.edges.get(no)) || []) { if (b === no || (seen.has(b) && b !== H)) loops = true; else q.push(b); }
      }
      if (loops) est = Math.max(est, 800);
    }
    const leadPatience = Math.max(PATIENCE, Math.min(12000, 3 * est + 120));
    const bad = (list) => list.some((C) => base.broken.has(C));
    const steps = [];
    const exitAct = exit ? { cmd: exit.k, mode: exit.mode === 'sustain' ? 'press' : exit.mode, until: null } : null;
    const lead = (k) => {
      const b = hub.at(k, 0);
      const pc = posCmd.get(k);
      const a = pc ? { cmd: pc.c, mode: pc.mode, until: [b] } : autoOff ? { set: autoOff, until: [b] } : { until: [b] };
      if (pc && autoOff) a.set = autoOff;
      if (k === kRef && leadPatience > PATIENCE) a.patience = leadPatience;
      const out = [...(exitAct ? [exitAct] : []), a];
      if (autoOnArrival && autoOff && pc) out.push({ set: autoOff, until: [b] });
      return out;
    };
    const words = (c) => cmdInfo.get(c).words;
    const introAlso = exit ? [...arrive.shown].filter((C) => !family.has(C)) : [...S0.shown].filter((C) => !family.has(C));
    const order = [...(k0 !== null && kList.includes(k0) ? [k0] : []), ...kList.filter((k) => k !== k0)];
    // A speed state whose cycle never ends (an animation of time -1) hangs:
    // that speed is never a step, and neither is auto, which plays it by
    // itself (Brian's position 5 speed 1, anim 3335); the position's other
    // speeds and its climax are.
    const hangsAt = (k, s) => { const x = nextOf.get(s); return !!(x && trapAt(x.no, withP(k, s))); };
    // His states and variables in each kind of step, for his art's stages
    // (hubStages): the hub at the base, the speed cycle, the climax state.
    const hisOf = (k, kind, s) => {
      if (kind === 'position') return [{ no: H, A: withP(k, 0) }];
      if (kind === 'speed') { const x = nextOf.get(s); return x ? [{ no: x.no, A: withP(k, s) }] : []; }
      if (kind === 'climax') { const x = climaxS !== undefined ? nextOf.get(climaxS) : null; return x ? [{ no: x.no, A: withP(k, climaxS) }] : []; }
      if (kind === 'auto') return [...speeds.filter((s2) => phase.get(s2).band).flatMap((s2) => hisOf(k, 'speed', s2)), ...hisOf(k, 'climax')];
      return [];
    };
    // (`hold`: what the hook holds from the step's own action on - a position
    // his hub drops, below.)
    const posSteps = (k, name, b, way, hold) => {
      const out = [];
      speeds.forEach((s, i) => {
        const pcS = phaseCmd.get(s), C = hub.at(k, s);
        if (!pcS || C === null || !hScenes.has(C) || bad([C]) || hangsAt(k, s)) return;
        // (She is in the base between two cycles: it counts as on screen.)
        out.push({ kind: 'speed', k, name, label: 'speed ' + (i + 1) + ' (' + words(pcS.c) + ')', until: [C], also: [b],
          path: [...way, Object.assign({ cmd: pcS.c, mode: 'sustain', until: [C] }, hold ? { hold } : {})], his: hisOf(k, 'speed', s) });
      });
      return out;
    };
    // HER ORGASM, per position (meterFires): the position's way, then the
    // meter set once to the value that fires it (Brian's fvar(39) = 48: his
    // -2 puts her in 6600 and him in 6400, where he waits for x). Her art
    // there reads his position (`EnemyNear,fvar(23) = k`), so it is judged
    // per position (`held`). A leaf: his way back is x after 150 ticks.
    // The set lasts one frame (the setup holds the meter at 0 again the
    // next), and made during his climax it never took (position 5, in
    // place from its climax: fvar(39) = 48 set at her 6225 and his 6005, no
    // 6600 within the patience). So no action on the way counts the
    // position's climax as done: moved to from the climax (position 5's way
    // counts every state of the position), the step waits for the climax
    // to end, as every other position's does (their ways wait for the base).
    const fires = base.meterFires || [];
    const orgasmSteps = (k, name, b, way, hold) => {
      const cl = new Set(climaxStates(k));
      const w = way.map((a) => {
        if (a === exitAct || !Array.isArray(a.until)) return a;
        const u = a.until.filter((C) => !cl.has(C));
        return u.length && u.length < a.until.length ? Object.assign({}, a, { until: u }) : a;
      });
      return fires.filter((M) => !bad(M.her)).map((M) => ({ kind: 'orgasm', k, name, label: 'orgasm', until: M.her.slice(), also: [b],
        held: [[P, k]], artKey: 'orgasm ' + k, path: [...w, Object.assign({ set: [{ kind: M.kind, index: M.index, value: M.value }], until: M.her.slice() }, hold ? { hold } : {})] }));
    };
    // A BUFF'S CLIMAX: the hub's extra term set by its climax command (f.sanae's
    // c: `var(25) = 100`, her 16305-16320) behind a variable his files give
    // one value only, in states outside this grab (her stamina drug 3782's
    // `var(0) = 1`, never reset): one step per position, the buff held by
    // the hook (the step's setup) and the climax command held until it shows.
    const buffs = [];
    {
      const pcC = climaxS !== undefined ? phaseCmd.get(climaxS) : null;
      const inMachine = (g) => [...states].some(([no, s2]) => machine.at.has(no) && s2.sctrls.some((sc) => sc.type === 'varset' && W.writesOf(sc).some(([nm]) => nm === g)));
      const writtenBy = (g) => [...states].filter(([, s2]) => s2.sctrls.some((sc) => (sc.type === 'varset' || sc.type === 'varadd') && W.writesOf(sc).some(([nm]) => nm === g))).map(([no]) => no);
      for (const sc of pcC && (hub.extra || []).length ? st.sctrls : []) {
        if (sc.type !== 'varset' || !commandsIn(sc.trig).includes(pcC.c)) continue;
        for (const [nm, raw] of W.writesOf(sc)) {
          const v = S.lit(raw);
          if (!hub.extra.includes(nm) || !v) continue;
          const gates = [...new Set(sc.trig.all.flatMap((e) => X.varsOf(String(e))))].filter((x) => VARNAME.test(x) && x !== nm && x !== P && x !== Ph);
          for (const g of gates) {
            const dom = (an.domains && an.domains[g]) || [];
            if (dom.length !== 1 || dom[0] === 0 || inMachine(g)) continue;
            const by = writtenBy(g);
            if (!by.length || by.some((no) => no < 0 || !root.has(no))) continue;
            if (W.trig(sc, withP(kRef, 0), new Set([pcC.c]), H) !== false) continue;
            if (W.trig(sc, Object.assign(withP(kRef, 0), { [g]: [dom[0]] }), new Set([pcC.c]), H) === false) continue;
            const ref = varRef(g);
            if (!ref || buffs.some((x) => x.name === nm && x.value === v)) continue;
            buffs.push({ name: nm, value: v, c: pcC.c, setup: [{ kind: ref.kind, index: ref.index, value: dom[0],
              why: ('his ' + g + ' = ' + dom[0] + ', which only his state ' + by.slice(0, 3).join('/') + ' sets: the climax command sets ' + nm + ' = ' + v + ' with it, a second finish').replace(/[^\x20-\x7e]/g, '?') }] });
          }
        }
      }
    }
    const buffAt = (k, x) => {
      const n = X.evalExpr(String(hub.ts.params.get('value')), Object.assign(Object.fromEntries((hub.extra || []).map((v) => [v, 0])), { [P]: k, [Ph]: climaxS, [x.name]: x.value }));
      return typeof n === 'number' && Number.isFinite(n) ? Math.trunc(n) : null;
    };
    for (const k of order) {
      const b = hub.at(k, 0);
      if (bad([b])) continue;
      const pc = posCmd.get(k);
      const name = 'position ' + k;
      const also = [...(k === kRef ? introAlso : []), ...firstExtra(k)];
      steps.push({ kind: 'position', k, name, label: pc ? words(pc.c) : 'as grabbed', until: [b], also: sorted(new Set(also)), path: lead(k), his: hisOf(k, 'position') });
      steps.push(...posSteps(k, name, b, lead(k)));
      const cl = climaxStates(k);
      const climaxOk = cl.length && !bad(cl);
      if (climaxOk && climaxS !== undefined) {
        const pcC = phaseCmd.get(climaxS);
        if (pcC) steps.push({ kind: 'climax', k, name, label: 'climax (' + words(pcC.c) + ')', until: cl, path: [...lead(k), { cmd: pcC.c, mode: 'hold', until: cl }], his: hisOf(k, 'climax') });
        else {
          // No command his files let the gallery's pair use: a jump into
          // his climax state from the hub, when that state itself sends
          // her to her climax (not only back to the base).
          const nx = nextOf.get(climaxS);
          const jcs = nx ? sorted(new Set([...issuedFrom(nx.no, withP(k, climaxS))].filter((C) => !family.has(C) && !bad([C])))) : [];
          if (nx && jcs.length) steps.push({ kind: 'climax', k, name, label: 'climax', until: jcs, jump: nx.no, path: [...lead(k), { jump: nx.no, at: H, until: jcs, patience: 900 }], his: hisOf(k, 'climax') });
        }
        buffs.forEach((x, i) => {
          const C = buffAt(k, x);
          if (C === null || !hScenes.has(C) || bad([C]) || cl.includes(C)) return;
          steps.push({ kind: 'climax', k, name, label: 'climax ' + (i + 2) + ' (' + words(x.c) + ')', until: [C], setup: x.setup.map((y) => Object.assign({}, y)), buff: true,
            path: [...lead(k), { cmd: x.c, mode: 'hold', until: [C], patience: 2400 }], his: hisOf(k, 'climax') });
        });
      }
      if (auto && !speeds.some((s) => hangsAt(k, s))) {
        const au = [];
        for (const s of speeds) if (phase.get(s).band) { const C = hub.at(k, s); if (C !== null && hScenes.has(C)) au.push(C); }
        if (climaxS !== undefined && phase.get(climaxS).band && climaxOk) au.push(...cl);
        if (au.length && !bad(au) && (climaxS === undefined || !phase.get(climaxS).band || climaxOk)) {
          const pathA = lead(k);
          steps.push({ kind: 'auto', k, name, label: 'auto (' + words(auto.c) + ')', until: sorted(new Set(au)), path: [...pathA, { cmd: auto.c, mode: 'press', until: sorted(new Set(au)) }], his: hisOf(k, 'auto') });
        }
      }
      steps.push(...orgasmSteps(k, name, b, lead(k)));
    }
    // A POSITION ONLY A CLIMAX ENTERS: a command VarSet of the position in
    // the state his climax plays (Brian's 6005: `manguri6-2` at AnimTime 0
    // sets fvar(23) = 5, and its end gives her 6196 + fvar(23)*5), for a
    // position none of the hub's own commands set (its lines for it are
    // commented out). Where the hub animates it, the way there is the first
    // position's climax with that command held across its end. Where none
    // of its ChangeAnims does and it zeroes the position on its animation's
    // end (Brian's 6001: he arrives on the climax's last tick, its own
    // `AnimTime = 0` line sets fvar(23) = 0 that very tick, and on the
    // animation's next end it releases her), his files cannot keep it: the
    // hook HOLDS it instead, from the step's own action on (`hold`: the
    // position, and the hub's wait - `time > fvar(38)` - at the least his
    // files draw it, 3, so the hub moves on before any speed's animation
    // ends), from the first position's base. Each action on the way also
    // counts the position's own states as done, so a step of it is reached
    // in place from another. Its base draws nothing of its own (6221 plays no
    // animation), so its steps are its speeds (never one that hangs), its
    // climax and her orgasm.
    const nxC = climaxS !== undefined ? nextOf.get(climaxS) : null;
    const pcClimax = climaxS !== undefined ? phaseCmd.get(climaxS) : null;
    const kVia = pcClimax ? order.find((j) => { const c = climaxStates(j); return c.length && !bad(c); }) : undefined;
    const readsP = (sc) => [...sc.trig.all, ...sc.trig.groups.flat()].some((e) => X.varsOf(String(e)).includes(P));
    const animates = (k) => st.sctrls.some((sc) => (sc.type === 'changeanim' || sc.type === 'changeanim2') && readsP(sc) && W.trig(sc, withP(k, 0), NO_INPUT, H) !== false);
    // (A trigger group of its own on AnimTime, beside the release's commands:
    // `trigger1 = AnimTime = 0`, `trigger2 = command = "z"`.)
    const drops = st.sctrls.some((sc) => sc.type === 'varset' && W.writesOf(sc).some(([nm, raw]) => nm === P && S.lit(raw) === 0)
      && sc.trig.groups.some((g) => !commandsIn({ all: sc.trig.all, groups: [g] }).length && g.some((e) => /\banimtime\b/i.test(String(e)))));
    // (The hub's wait: the variable its TargetState's `time > X` reads, at
    // the least value his VarSets of it can give.)
    const waitHold = () => {
      const m = /\btime>(f?var\(\d+\))/.exec(trigText({ all: hub.ts.trig.all, groups: hub.ts.trig.groups }));
      if (!m) return null;
      const valsOf = (name, dom) => {
        const out = [];
        for (const s2 of states.values()) for (const sc of s2.sctrls) if (sc.type === 'varset') for (const [nm, raw] of W.writesOf(sc)) {
          if (nm !== name) continue;
          const vs = X.valueSet(String(raw), dom);
          if (!vs) return null;
          out.push(...vs);
        }
        return out.length ? out : null;
      };
      const vs = valsOf(m[1], (n) => valsOf(n, () => null));
      const ref = varRef(m[1]);
      return vs && ref ? { kind: ref.kind, index: ref.index, value: Math.min(...vs) } : null;
    };
    if (nxC && states.has(nxC.no) && kVia !== undefined) {
      const seen = new Set();
      for (const sc of states.get(nxC.no).sctrls) {
        if (sc.type !== 'varset') continue;
        for (const [nm, raw] of W.writesOf(sc)) {
          const k = nm === P ? S.lit(raw) : null;
          if (k === null || k <= 0 || kAll.includes(k) || seen.has(k) || hub.at(k, 0) === null) continue;
          const c = commandsIn(sc.trig).filter(playable).find((x) => W.byCommand(sc, withP(kVia, climaxS), new Set([x]), nxC.no, false, x) !== false);
          if (!c) continue;
          seen.add(k);
          const b = hub.at(k, 0), name = 'position ' + k;
          const own = sorted(new Set([b, ...[...phase.keys()].map((s) => hub.at(k, s)).filter((C) => C !== null)]));
          const widen = (a) => (a === exitAct ? a : Object.assign({}, a, { until: sorted(new Set([...a.until, ...own])) }));
          let way, hold = null;
          if (animates(k) || !drops) way = [...lead(kVia).map(widen), { cmd: pcClimax.c, mode: 'hold', until: sorted(new Set([...climaxStates(kVia), ...own])) }, { cmd: c, mode: 'hold', until: own.slice() }];
          else {
            const ref = varRef(P), w = waitHold();
            if (!ref || !w) continue;
            hold = [{ kind: ref.kind, index: ref.index, value: k }, w];
            way = lead(kVia).map(widen);
          }
          const ps = posSteps(k, name, b, way, hold);
          const cl = climaxStates(k);
          if (cl.length && !bad(cl)) ps.push({ kind: 'climax', k, name, label: 'climax (' + words(pcClimax.c) + ')', until: cl, also: [b],
            path: [...way, Object.assign({ cmd: pcClimax.c, mode: 'hold', until: cl }, hold ? { hold } : {})], his: hisOf(k, 'climax') });
          if (!ps.length) continue;
          for (const x of ps) x.fresh = true;
          // (In its place among the positions: before the first higher one.)
          const at = steps.findIndex((x) => Number.isFinite(x.k) && x.k > k);
          // (Her orgasm there comes in its first speed: his 6400 keeps the
          // animation he plays when it fires, and at the position's base he
          // plays none of his own - set there, in place from the climax, he
          // was drawn as nothing beside her. His meter fills in a speed in
          // his game too. The speed is held until it shows, then let go.)
          const sp = hold ? ps.find((x) => x.kind === 'speed') : null;
          const wayO = sp ? [...way, Object.assign({}, sp.path[sp.path.length - 1], { mode: 'hold' })] : way;
          steps.splice(at < 0 ? steps.length : at, 0, ...ps, ...orgasmSteps(k, name, b, wayO, hold));
        }
      }
    }
    if (!steps.length) return null;
    // Before the hub: the grab's own step, and the press every path starts
    // with, until everything past it.
    const pre = [];
    if (exit) {
      const past = new Set([...arrive.shown]);
      // (Not her orgasm: from the grope stage's own, his press is the way on
      // into the hub - 6400 on `fvar(23) = 0` takes the grope exit too.)
      for (const s of steps) if (s.kind !== 'orgasm') for (const C of [...s.until, ...(s.also || [])]) past.add(C);
      for (const C of S0.shown) past.delete(C);
      exitAct.until = sorted(past);
      if (S0.shown.size) {
        pre.push({ kind: 'own', name: 'the grab', label: 'before ' + words(exit.k), until: sorted(S0.shown), path: [] });
        // Her orgasm at the grope stage: a short wait for the grab's own
        // state first, so that in place from anywhere else it grabs again
        // (a fresh grab waits the default for it; the meter set in a
        // position would show that position's orgasm under this label).
        const g0 = (S0.flow.stay.get(E) || S0.flow.at.get(E) || A0)[P];
        const p0 = g0 && g0.length === 1 ? g0[0] : 0;
        for (const M of fires) if (!bad(M.her)) pre.push({ kind: 'orgasm', name: 'the grab', label: 'orgasm', until: M.her.slice(), also: sorted(S0.shown), held: [[P, p0]], artKey: 'orgasm grab',
          path: [{ until: sorted(S0.shown), patience: 30 }, { set: [{ kind: M.kind, index: M.index, value: M.value }], until: M.her.slice() }] });
      }
    }
    // HIS ART'S STAGES (finishCounters): the levels of a counter at which his
    // own art in a step's states starts - an Explod, ChangeAnim, ChangeAnim2
    // or Helper of his that may fire there and not at the level below
    // (DongHwan's position-2 press 42249 at var(32) >= 5; Brian's "siru"
    // helper in his speed cycle at var(4) > 1). Her art: pairStages.
    for (const s of steps) {
      if (!s.his || !s.his.length) continue;
      const out = {};
      for (const V of base.finishCounters || []) {
        const lv = [];
        let prev = 0;
        for (const L of V.levels) {
          if (s.his.some(({ no, A }) => hisArtStarts(no, A, V.name, prev, L))) lv.push(L);
          prev = L;
        }
        if (lv.length) out[V.name] = lv;
      }
      if (Object.keys(out).length) s.hisStages = out;
    }
    const cmds = new Set([...[...posCmd.values()].map((x) => x.c), ...[...phaseCmd.values()].map((x) => x.c), ...(auto ? [auto.c] : []), ...(exit ? [exit.k] : [])]);
    return { E, H, exit, steps: [...pre, ...steps], cmds, autoOff };
  };
  const hisArtStarts = (no, A, name, prev, L) => {
    const st = states.get(no);
    if (!st) return false;
    for (const sc of st.sctrls) {
      if (!STAGE_ART_HIS.has(sc.type)) continue;
      if (![...sc.trig.all, ...sc.trig.groups.flat()].some((e) => X.varsOf(String(e)).includes(name))) continue;
      if (W.trig(sc, Object.assign({}, A, { [name]: [L] }), NO_INPUT, no) !== false && W.trig(sc, Object.assign({}, A, { [name]: [prev] }), NO_INPUT, no) === false) return true;
    }
    return false;
  };
  for (const E of entries) {
    const r = readBao(E);
    if (r) bao.set(E, r);
  }
  // The walk's own candidates the hub reader says better: the grab's own
  // situation and everything made through the hub's switches (or the press
  // that leads there).
  // (A hub read for one grab is that grab's: another grab that reaches it
  // - f.sanae's Moses' Miracle into the Lesbian Raper's 16001, beside its
  // own 26001 - plays it through the reader's steps.)
  const superseded = (c) => {
    const r = bao.get(c.entry);
    for (let Sit = c.sit; Sit; Sit = Sit.parent) {
      if (Sit.kind === 'own') { if (r && Sit === c.sit) return true; continue; }
      if (!Sit.T) continue;
      if (r && (Sit.T === r.exit || (r.cmds.has(Sit.T.k) && Sit.T.at.includes(r.H)))) return true;
      for (const o of bao.values()) if (o.E !== c.entry && (!r || o.H !== r.H) && o.cmds.has(Sit.T.k) && Sit.T.at.includes(o.H)) return true;
    }
    return false;
  };
  for (let i = cands.length - 1; i >= 0; i--) if (superseded(cands[i])) cands.splice(i, 1);

  // ---- which candidates become steps ----------------------------------------------
  // Shortest paths first, grab order next: a switch that only shows scenes
  // an earlier step already listed goes (1590 reaches the ground positions
  // with two presses; 1599 with one), except a transient step or auto (a
  // position's speeds and climax stay even when a lump listed them) and one
  // that changes what shows without new scenes (a choice made certain, a
  // variant).
  // A scene is her custom state and the edge he gives it (GRAIL 4.10): two
  // switches made in the same situation that show her the same states from
  // states of his with none in common are two steps - TWINS (Minotaur's buster
  // y, his finger 1260, and b, his vibrator 1270 -> 1271, both give her 1265).
  // (A summon whose helper plays the scene gives her its states from the
  // helper's own: Kur0maru's two dogs give Gardevoir 6064 from one.)
  const helperIss = new Map();
  const edgesOf = (c, C) => {
    const v = (c.via && c.via[C]) || [];
    const sm = !c.sit.parent && summonOf.get(c.entry);
    if (v.length || !sm || !sm.helperPlays) return v;
    if (!helperIss.has(c.entry)) helperIss.set(c.entry, helperWalker().flow((sm.starts || []).map((no) => ({ no, A: {}, prev: 0 })), NO_INPUT).issued);
    return sorted(new Set(helperIss.get(c.entry).get(C) || []));
  };
  // (Grabs alone are twins across his grabs and summons: his doggie grab and
  // a dog helper's that give her the same state are two.)
  const twinKey = (c) => (c.sit.parent ? c.entry + '|' + c.sit.parent.id : 'grab') + '|' + c.kind + '|' + c.until.join(',');
  const twinSig = (c) => c.until.map((C) => edgesOf(c, C).join('/')).join(',');
  {
    const byTwin = new Map();
    for (const c of cands) { if (!c.sit.parent && c.kind !== 'own') continue; const k = twinKey(c); if (!byTwin.has(k)) byTwin.set(k, []); byTwin.get(k).push(c); }
    for (const list of byTwin.values()) {
      if (list.length < 2) continue;
      // (Grabs alone: his own grab and a summon whose helper plays it - two
      // bodies; two summons or two grabs of his stay one, as Kur0maru's two
      // dogs on Gardevoir and his thunder x and y.)
      const helperPlays = (x) => { const sm = !x.sit.parent && summonOf.get(x.entry); return !!(sm && sm.helperPlays); };
      // (Two PRESS SUMMONS are two creatures where their helpers give her the
      // scene from states none in common: Marasama's dog, demon, panther.)
      const pressed = (x) => { const sm = !x.sit.parent && summonOf.get(x.entry); return !!(sm && sm.press); };
      const apart = (x, y) => (x.sit.parent || helperPlays(x) !== helperPlays(y) || (pressed(x) && pressed(y)))
        && x.until.every((C) => edgesOf(x, C).length && edgesOf(y, C).length && !edgesOf(x, C).some((H) => edgesOf(y, C).includes(H)));
      for (const c of list) if (list.some((o) => o !== c && apart(c, o))) c.twin = true;
    }
  }
  const claimed = new Set();
  for (const r of bao.values()) for (const s of r.steps) for (const C of s.until) claimed.add(C);
  const keys = new Set();
  const keptTwins = new Set();
  const kept = new Set();
  // At one depth, the cheaper input first (a press before a motion), then
  // the grab order.
  // (His grabs in their order, then his summons.)
  const grabOrder = (E) => { const i = base.grabs.findIndex((g) => g.no === E); return i >= 0 ? i : base.grabs.length + base.summons.findIndex((sm) => sm.no === E); };
  const lastRank = (c) => { const a = c.path.length ? c.path[c.path.length - 1] : null; return a && a.cmd !== undefined ? cmdRank(a.cmd) : -1; };
  const byPriority = cands.slice().sort((a, b) => a.depth - b.depth || lastRank(a) - lastRank(b) || a.until.length - b.until.length
    || grabOrder(a.entry) - grabOrder(b.entry) || a.order - b.order);
  for (const c of byPriority) {
    const dk = c.until.join(',') + '|' + (c.rule === 'narrow' ? c.visKey : '') + (c.twin ? '|' + twinSig(c) : '');
    if (keys.has(dk)) continue;
    if (!(c.twin && keptTwins.has(twinKey(c))) && (c.kind === 'position' || c.kind === 'own') && (c.rule !== 'narrow' || c.depth >= 2) && c.until.every((C) => claimed.has(C))) continue;
    keys.add(dk);
    kept.add(c);
    if (c.twin) keptTwins.add(twinKey(c));
    for (const C of c.until) claimed.add(C);
  }

  // ---- jumps: his own states nothing the walk asserts reaches ---------------------
  // Positions a player enters some other way (an AI-only pick): still his own
  // states, so a jump from the hub - unless it stops time, hangs or ends the
  // scene. A jump into a state the walk runs through anyway (DongHwan's
  // climax 6005, reached with hold c) is never one.
  const jumpSteps = [];
  // States his files enter only through a gate the setup keeps shut.
  // A jump is only for a state a player never picks with a command (an AI-
  // only or timed position): one a command enters is the walk's to reach
  // or to leave out (Minotaur's injection 1256 is a motion in his buster
  // hub, not a jump from the hug), and one only a setup gate enters is the
  // failure the setup keeps shut (his groin kick 1690).
  const gateOnly = new Set();
  {
    const into = new Map();
    for (const no of root) for (const sc of states.get(no).sctrls) {
      if (sc.type !== 'changestate' && sc.type !== 'selfstate') continue;
      for (const v of W.values(sc.params.get('value'), {}, no)) { if (!into.has(v)) into.set(v, []); into.get(v).push(sc); }
    }
    for (const [v, list] of into) {
      if (list.some((sc) => base.offCtrls.has(sc))) gateOnly.add(v);
      else if (list.some((sc) => commandsIn(sc.trig).some((k) => cmdInfo.has(k) && cmdInfo.get(k).playable))) gateOnly.add(v);
    }
  }
  for (const E of entries) {
    const S0 = firstSit.get(E);
    W.setPresent(null);
    const machine = W.flow([{ no: E, A: base.initial, prev: 0 }], null);
    if (!S0) continue;
    // Made from his hub: the state with the most switches, else the last
    // one he settles in.
    const count = new Map();
    for (const ls of switchesOf(S0).values()) for (const L of ls) count.set(L.H, (count.get(L.H) || 0) + 1);
    let hub = [...count].sort((a, b) => b[1] - a[1]).map(([H]) => H)[0];
    if (hub === undefined) hub = [...S0.flow.at.keys()].filter((n) => S0.flow.stay.has(n)).pop();
    if (hub === undefined) continue;
    const during = S0.flow.stay.get(hub) || A0;
    for (const J of [...machine.at.keys()].sort((a, b) => a - b)) {
      if (covered.has(J) || J === E || gateOnly.has(J)) continue;
      const A = machine.at.get(J);
      const issuesHere = states.get(J).sctrls.some((sc) => sc.type === 'targetstate' && W.values(sc.params.get('value'), A, J).some((v) => hScenes.has(v)));
      if (!issuesHere) continue;
      const f = W.flow([{ no: J, A: during }], NO_INPUT);
      if (stopsTime(f, null) !== null || trapIn(f, null)) continue;
      const r = W.runState(J, during, NO_INPUT, { passes: 1, fresh: true });
      if (r.exits.length && r.left) continue;
      const sc2 = sorted(minus(shown(f), claimed));
      if (!sc2.length) continue;
      for (const C of sc2) claimed.add(C);
      jumpSteps.push({ entry: E, until: sc2, path: [{ jump: J, at: hub, until: sc2 }], kind: 'jump', jump: J });
    }
  }

  // ---- the steps, in order, with their labels --------------------------------------
  // Per grab, named for the viewer (the Baomaru hub is "Bao" - GRAIL 4.10 C's
  // own name for the idiom - and any other grab by the move name or input
  // his .cmd gives it; no prefix when the giver has one grab): the hub's
  // positions, each with its speeds, climax and auto; an insertion family's
  // position with its speeds and climax; every other step by its inputs, in
  // the order the walk found them (fewest switches first).
  // An insertion ladder the walk reached with one switch (or the grab's own
  // pick, by time): four steps - the position, speed 2 and speed 3 by its
  // own button in x1/x2, and its climax, which comes by time from x3. The
  // position's lead is the button that picks it (the pick hub's own for the
  // grab's first position: x in 1597 for doggy, not the 80-tick default),
  // with a short patience: pressed where it cannot act (x3, the climax, the
  // aftermath) it misses at once and the scene is grabbed again. The pick
  // hub, the insertion and the aftermath count as on screen, never as shown.
  // A FINISHER BY COUNT (Kur0maru's chair: every accepted press of a button
  // in 1110 gives her 1220 and adds 1 to var(1); the press that finds var(1)
  // = 6 gives her 1230): the same press, repeated until the finisher shows,
  // with the patience the presses need (each is taken 43 ticks after the
  // last; the runtime presses every 20 frames).
  const finisherOf = (c) => {
    const T = c.sit && c.sit.T;
    if (!T || !T.fired || !T.k || (T.mode !== 'press' && T.mode !== 'mash') || !c.path.length) return null;
    const adds = [...T.fired].filter((sc) => sc.type === 'varadd').flatMap((sc) => W.writesOf(sc).filter(([, raw]) => { const n = S.lit(raw); return n !== null && n > 0; }).map(([nm, raw]) => ({ nm, d: S.lit(raw) })));
    if (!adds.length) return null;
    for (const H of T.at) {
      const st = states.get(H);
      if (!st) continue;
      const A = (T.locs && (T.locs.find((L) => L.H === H) || {}).A) || A0;
      for (const sc of st.sctrls) {
        if (sc.type !== 'targetstate' || T.fired.has(sc) || !commandsIn(sc.trig).includes(T.k)) continue;
        const reads = new Set([...sc.trig.all, ...sc.trig.groups.flat()].flatMap((e) => X.varsOf(String(e))));
        const add = adds.find((x) => reads.has(x.nm));
        if (!add) continue;
        const C2 = W.values(sc.params.get('value'), A, H).filter((C) => hScenes.has(C));
        if (!C2.length) continue;
        if (W.trig(sc, A, new Set([T.k]), H) !== false) continue;
        let need = null;
        for (let v = add.d; v <= 40 && need === null; v += add.d) if (W.trig(sc, Object.assign({}, A, { [add.nm]: [v] }), new Set([T.k]), H) !== false) need = v / add.d;
        if (need === null) continue;
        const path = [...c.path.slice(0, -1), { cmd: T.k, mode: 'press', until: sorted(new Set(C2)), patience: Math.max(PATIENCE, need * 80 + 120) }];
        return { label: cmdInfo.get(T.k).words + ', ' + need + ' times', until: sorted(new Set(C2)), path };
      }
    }
    return null;
  };
  // A GAUGE CLIMAX (Murakami's hubs: his stroke 1002, entered by a press in
  // the hold 1000, adds 600 to var(25), and 1000's `Var(25) >= 12000` with
  // no command goes into his climax 1006, her 1007): a ChangeState of the
  // state the press is made in on a variable at a number of 1000 or more, the
  // variable added to only in the states the press goes through. Its step:
  // the grab's hold, then the variable SET by the hook to that number once
  // (twenty-odd presses, and he leaves after 60 idle ticks between them);
  // her scenes from his climax state on are its own, not the stroke's.
  const gaugeDone = new Set();
  // A CLIMAX BY DRAIN (base.drains, detectSetup: FutaRB's var(41), held at
  // its grab value so no speed climaxes by itself): once per hub, from its
  // first speed whose way runs through a drained state, a climax step - the
  // speed sustained, then the variable held at the number from there on, so
  // the speed's own ChangeState goes into the climax at its animation's end
  // (and again each time it comes back). Its scenes: what that climax state
  // gives her with the variable there, and where her own states take her.
  const drainDone = new Set();
  // AUTO BY SET (FutaRB's AutoRape: x toggles var(42), and each speed state
  // goes back to the hub only on `! Var(42) = 1`, so with it on a speed goes
  // on by itself): once per hub, from its first speed whose way back reads a
  // variable only toggles a command of his makes (`ifelse(V = 0, 1, 0)`),
  // an auto step - the speed sustained with the variable HELD at 1 by the
  // hook (never the toggle pressed). -> { key, hub, V, path, words } | null
  const autoDone = new Set();
  const autoOf = (c) => {
    const role = roleOf(c);
    if (!role || role.role !== 'speed' || !c.sit || !c.sit.flow) return null;
    const last = c.path[c.path.length - 1];
    if (!last || last.cmd === undefined) return null;
    const playable = (k) => cmdInfo.has(k) && cmdInfo.get(k).playable;
    const TIMEW = /\b(animtime|animelem|time|statetime)\s*(=|>=|<=|>|<)\s*-?\d+(\s*,\s*(=|>=|<=|>|<)?\s*-?\d+)?/gi;
    for (const J of enteredOf(c.sit)) {
      if (J === role.hub || isBasic(J) || !states.has(J)) continue;
      const A = c.sit.flow.at.get(J) || A0;
      for (const sc of states.get(J).sctrls) {
        if (sc.type !== 'changestate' || commandsIn(sc.trig).length || !W.values(sc.params.get('value'), A, J).includes(role.hub)) continue;
        const rw = (e) => String(e).replace(TIMEW, '1');
        const back = { trig: { all: sc.trig.all.map(rw), groups: sc.trig.groups.map((g) => g.map(rw)) } };
        for (const V of [...new Set([...sc.trig.all, ...sc.trig.groups.flat()].flatMap((e) => X.varsOf(String(e))))].filter((v) => VARNAME.test(v))) {
          let ok = true, toggles = 0, cmd = null;
          for (const [, s2] of states) for (const x of s2.sctrls) for (const [nm, raw] of W.writesOf(x)) {
            if (nm !== V) continue;
            const L = X.leavesOf(String(raw)), vs = X.varsOf(String(raw));
            if (x.type === 'varset' && vs.length === 1 && vs[0] === V && L.includes(0) && L.includes(1) && commandsIn(x.trig).some(playable)) { toggles++; cmd = cmd || commandsIn(x.trig).filter(playable)[0]; }
            else if (!(x.type === 'varset' && S.lit(raw) === 0)) ok = false;
          }
          if (!ok || !toggles) continue;
          if (W.trig(back, Object.assign({}, A, { [V]: [1] }), NO_INPUT, J) !== false || W.trig(back, Object.assign({}, A, { [V]: [0] }), NO_INPUT, J) === false) continue;
          const ref = varRef(V);
          if (!ref) continue;
          const sp = speedFromPath(c, role);
          const path = [...sp.slice(0, -1), Object.assign({}, sp[sp.length - 1], { mode: 'sustain', hold: [{ kind: ref.kind, index: ref.index, value: 1 }] })];
          return { key: c.entry + '|' + role.hub + '|' + V, hub: role.hub, V, path, words: cmdInfo.get(last.cmd).words };
        }
      }
    }
    return null;
  };
  // A PRESS AFTER A TIMED HANDOFF: a press that acts only in states of his
  // the scene reaches by itself after a long while (Yarimusi's 25400 hands
  // on to 4862 at `time = 960`, where a acts) waits for them: `from` those
  // states, patience the ticks on the way (holdOf, the shortest way) + 300.
  // Over half the default patience only. -> the path.
  const handoffPath = (c, path) => {
    let out = null;
    for (let i = 0; i < path.length; i++) {
      const a = path[i];
      if (a.cmd === undefined || a.from) continue;
      const T = actionT.get(a);
      if (!T || !T.locs) continue;
      const acting = sorted(new Set(T.locs.map((L) => L.H).filter((H) => H >= 0)));
      if (!acting.length) continue;
      const S0 = i === 0 ? firstSit.get(c.entry) : null, Tp = i > 0 ? actionT.get(path[i - 1]) : null;
      const flow = i === 0 ? S0 && S0.flow : Tp && Tp.flow;
      const starts = i === 0 ? S0 && S0.starts : Tp && Tp.at;
      if (!flow || !flow.edges || !starts || !starts.length || starts.some((x) => acting.includes(x))) continue;
      const best = new Map(), q = starts.map((x) => [x, 0]);
      let S = null;
      while (q.length) {
        q.sort((p, r) => p[1] - r[1]);
        const [no, d] = q.shift();
        if (best.has(no)) continue;
        best.set(no, d);
        if (acting.includes(no)) { S = d; break; }
        const h = flow.at.has(no) ? holdOf(no, flow.stay.get(no) || flow.at.get(no)) : 0;
        for (const b of flow.edges.get(no) || []) if (!best.has(b)) q.push([b, d + h]);
      }
      if (S === null || S <= PATIENCE / 2) continue;
      if (!out) out = path.slice();
      const o = Object.assign({}, a, { from: acting, patience: Math.max(a.patience || 0, S + 300) });
      if (actionT.has(a)) actionT.set(o, T);
      out[i] = o;
    }
    return out || path;
  };
  // A SPEED'S FROM: a speed's press acts in its hub and in the hub's own
  // speed states (each back in the hub by itself) - nowhere else: made in
  // place from another position (FutaRB White-Len's 51004 blowjob, whose a
  // is its own Fuck1), the step is grabbed again at once instead of showing
  // that position's speed. -> the path, its last action with `from`.
  const speedFromPath = (c, role) => {
    const last = c.path[c.path.length - 1];
    if (!role || role.role !== 'speed' || !last || last.cmd === undefined || last.from || !c.sit || !c.sit.flow) return c.path;
    const H = role.hub, st = states.get(H);
    if (!st) return c.path;
    const Sit = c.sit, A = Sit.flow.stay.get(H) || Sit.flow.at.get(H) || A0;
    const from = new Set([H]);
    for (const sc of st.sctrls) {
      if (sc.type !== 'changestate' || !commandsIn(sc.trig).some((k) => cmdInfo.has(k) && cmdInfo.get(k).playable)) continue;
      for (const J of W.values(sc.params.get('value'), A, H)) if (J !== H && !isBasic(J) && states.has(J) && returnsByTime(J, Sit.flow.at.get(J) || A, H)) from.add(J);
    }
    return [...c.path.slice(0, -1), Object.assign({}, last, { from: sorted(from) })];
  };
  const drainOf = (c, ownUntil) => {
    if (!base.drains || !base.drains.length || !c.sit || !c.sit.flow || !c.path.length) return null;
    const role = roleOf(c);
    if (!role || role.role !== 'speed') return null;
    const f = c.sit.flow;
    const last = c.path[c.path.length - 1];
    if (!last || last.cmd === undefined) return null;
    for (const D of base.drains) {
      const at = [...D.states].filter((no) => f.at.has(no));
      if (!at.length) continue;
      const her = new Set();
      for (const no of at) {
        const A = Object.assign({}, f.at.get(no), { [D.V]: [D.N] });
        for (const Cx of D.into.get(no) || []) {
          if (!states.has(Cx) || isBasic(Cx)) continue;
          for (const C of W.flow([{ no: Cx, A, prev: no }], NO_INPUT).issued.keys()) if (hScenes.has(C)) her.add(C);
        }
      }
      for (const C of [...her]) for (const q = [C]; q.length;) for (const D2 of (base.chains && base.chains.get(q.shift())) || []) if (hScenes.has(D2) && !her.has(D2)) { her.add(D2); q.push(D2); }
      // (Not what the way there already shows: back in the hub after it.)
      for (const C of [...(ownUntil || []), ...c.path.slice(0, -1).flatMap((a) => a.until || [])]) her.delete(C);
      const until = sorted(her);
      const before = (last.until || []).filter((C) => !her.has(C));
      if (!until.length || !before.length) continue;
      const sp = speedFromPath(c, role);
      const path = [...sp.slice(0, -1), Object.assign({}, sp[sp.length - 1], { mode: 'sustain', until: before }), { until: until.slice(), hold: [{ kind: D.kind, index: D.index, value: D.N }] }];
      return { key: c.entry + '|' + role.hub + '|' + D.V, hub: role.hub, until, also: before, path, words: cmdInfo.get(last.cmd).words };
    }
    return null;
  };
  const gaugeOf = (c, holdStates) => {
    const T = c.sit && c.sit.T;
    if (!T || !T.k || !T.flow || !c.sit.parent || c.sit.parent.kind !== 'own' || !c.path.length) return null;
    for (const H of T.at) {
      const st = states.get(H);
      if (!st) continue;
      for (const sc of st.sctrls) {
        if (sc.type !== 'changestate' || commandsIn(sc.trig).length) continue;
        const m = [...sc.trig.all, ...sc.trig.groups.flat()].map((e) => GAUGE_ATOM.exec(String(e))).find(Boolean);
        if (!m) continue;
        const G = m[1].toLowerCase() + '(' + m[2] + ')', N = +m[4] + (m[3] === '>' ? 1 : 0);
        const ref = varRef(G);
        if (N < 1000 || !ref) continue;
        const adds = (no) => (states.get(no) || { sctrls: [] }).sctrls.some((x) => x.type === 'varadd' && W.writesOf(x).some(([nm, raw]) => nm === G && (S.lit(raw) || 0) > 0));
        if (adds(H) || ![...T.flow.at.keys()].some((no) => no !== H && adds(no))) continue;
        const A = Object.assign({}, T.flow.at.get(H) || A0, { [G]: [N] });
        const her = new Set();
        for (const Cx of W.values(sc.params.get('value'), A, H)) {
          if (!states.has(Cx) || isBasic(Cx)) continue;
          for (const C of W.flow([{ no: Cx, A, prev: H }], NO_INPUT).issued.keys()) if (hScenes.has(C)) her.add(C);
        }
        // (And where her own states take her from there: 1007, then her dizzy 1010.)
        for (const C of [...her]) for (const q = [C]; q.length;) for (const D of (base.chains && base.chains.get(q.shift())) || []) if (hScenes.has(D) && !her.has(D)) { her.add(D); q.push(D); }
        const until = sorted(her);
        const hold = holdStates.filter((C) => !until.includes(C));
        if (!until.length || !hold.length) continue;
        // (Its patience: the longest animation on its way - his climax state's
        // and each of hers - and a margin, where that is past the default: a
        // partner who has no art for the climax itself waits for what comes
        // after it, Murakami's 2005, 628 ticks, before her dizzy 1011 -
        // "did not reach this scene" at 600 on Kung Fu Girl Z.)
        // (Hers by the animations her state names - his fallback's length in
        // his .air: what draws her where she has no art of her own.)
        const named = (no) => [states.get(no).header.get('anim'), ...states.get(no).sctrls.filter((x) => x.type === 'changeanim' || x.type === 'changeanim2').map((x) => x.params.get('value'))]
          .map((v) => S.lit(v)).filter((v) => v !== null).map((a) => base.airTimes.get(a)).filter((t) => Number.isFinite(t) && t >= 0);
        let longest = 0;
        for (const no of W.values(sc.params.get('value'), A, H)) { const t = states.has(no) ? W.animTicks(no, A).max : null; if (t !== null && t > longest) longest = t; }
        for (const C of her) if (states.has(C)) for (const t of named(C)) if (t > longest) longest = t;
        const set = Object.assign({ set: [{ kind: ref.kind, index: ref.index, value: N }], until: until.slice() }, longest + 120 > PATIENCE ? { patience: longest + 120 } : {});
        const path = [...c.path.slice(0, -1), { until: hold.slice() }, set];
        return { key: c.entry + '|' + H + '|' + G, H, until, also: hold, path };
      }
    }
    return null;
  };
  // WHERE A LEAD'S PRESS ACTS (the runtime's `from`: it presses only while
  // he is in one of these, and an in-place step that starts anywhere else -
  // x3, a climax's aftermath - grabs again at once): the states its own
  // controllers act in (the state's own, or the -1's `StateNo = ...`), the
  // states where the same command writes the same value (Minotaur's x sets
  // var(21) = 1 in the pick hub 1597 and in every position's x1/x2, where it
  // changes position to doggy; the standing pick hub 1591 enters 1810 on x
  // with a ChangeState, and x in the other standing positions' x1/x2 is the
  // same -1 VarSet), and the grab's states that go on by themselves into one
  // of those (each x0, the position changes 1700 and 1900). His horse QCF
  // acts only in the hub and its foreplays: 7010, 7050-7080.
  const actsFrom = (E, a, L) => {
    const T = actionT.get(a);
    const scope = entryStates.get(E);
    if (!T || !T.fired || !T.k || a.cmd !== T.k || !scope) return null;
    W.setPresent(presentOf.get(E) || null);
    const pins = base.pinsFor(NO_INPUT, scopeOf.get(E) || null);
    // Does the command's write, made in state n, take him into this ladder
    // (its x0-x2) within three ticks' hops? (x in missionary's x1 1621: to
    // 1700, then 1611; x in doggy's own x1 1611: to 1612; x in the standing
    // family's 1811 goes to 1812 - not the ground's.)
    const target = new Set([L.x0, L.x0 + 1, L.x0 + 2]);
    const leadsIn = (n, wr) => {
      if (target.has(n)) return true;
      const A = Object.assign({}, pins);
      for (const [nm, v] of wr) A[nm] = [v];
      let front = [{ no: n, A, fresh: false }];
      for (let hop = 0; hop < 3 && front.length; hop++) {
        const nf = [];
        for (const x of front) {
          if (!states.has(x.no) || isBasic(x.no)) continue;
          const r = W.runState(x.no, x.A, NO_INPUT, { passes: 1, fresh: x.fresh });
          for (const y of r.next) { if (target.has(y.no)) return true; nf.push({ no: y.no, A: y.A, fresh: true }); }
        }
        front = nf;
      }
      return false;
    };
    const out = new Set(), writes = [];
    for (const sc of T.fired) {
      if (sc.state >= 0) { if (scope.has(sc.state)) out.add(sc.state); } else {
        const named = statesNamed(sc.trig);
        if (!named) return null;
        for (const n of named) if (scope.has(n)) out.add(n);
      }
      if (sc.type === 'varset') for (const [nm, raw] of W.writesOf(sc)) { const v = S.lit(raw); if (v !== null) writes.push([nm, v]); }
    }
    if (!out.size) return null;
    // The same command writing the same value elsewhere in the grab, where
    // that leads into this ladder too.
    const wkey = new Set(writes.map(([nm, v]) => nm + '=' + v));
    const same = (sc) => sc.type === 'varset' && commandsIn(sc.trig).includes(T.k) && W.writesOf(sc).some(([nm, raw]) => wkey.has(nm + '=' + S.lit(raw)));
    const add = (n, wr) => { if (scope.has(n) && !out.has(n) && leadsIn(n, wr)) out.add(n); };
    for (const sc of base.negCtrls) if (same(sc)) { const named = statesNamed(sc.trig); if (named) for (const n of named) add(n, writes); }
    for (const no of scope) if (states.has(no) && states.get(no).sctrls.some(same)) add(no, writes);
    // The position's own button is also the change into it from the other
    // positions of its family: its -1 VarSet names their x1/x2.
    if (L.own && L.own.sc && a.cmd === L.own.cmd) {
      const named = statesNamed(L.own.sc.trig);
      const wr = W.writesOf(L.own.sc).map(([nm, raw]) => [nm, S.lit(raw)]).filter(([, v]) => v !== null);
      if (named) for (const n of named) add(n, wr);
    }
    // And the states that go on by themselves, in one hop, into one of those
    // (each x0, the position changes 1700 and 1900).
    const eg = entryEdges.get(E) || new Map();
    for (const x of [...scope]) if (!out.has(x) && x !== E && [...(eg.get(x) || [])].some((y) => out.has(y) && y !== x)) out.add(x);
    return sorted(out);
  };
  const ladderDone = new Map();
  const ladderOf = (c) => {
    if (c.kind !== 'position' && c.kind !== 'own') return null;
    const hits = [...base.ladders.values()].filter((L) => [1, 2, 3, 4].every((i) => c.until.includes(L.c0 + i)));
    if (!hits.length) return null;
    if (!ladderDone.has(c.entry)) ladderDone.set(c.entry, new Set());
    const done = ladderDone.get(c.entry);
    const rungs = (L) => [1, 2, 3, 4].map((i) => L.c0 + i);
    const inLadders = new Set(hits.flatMap(rungs));
    const rest = c.until.filter((C) => !inLadders.has(C));
    const out = [];
    for (const L of hits.sort((a, b) => a.x0 - b.x0)) {
      if (done.has(L.x0)) continue;
      let lead;
      if (c.sit.kind === 'own') {
        const S0 = c.sit;
        // The button whose walk reaches this ladder and the fewest others
        // (a in 1597 reaches cowgirl, and doggy only by the 80-tick default).
        let B = null, best = Infinity;
        for (const k of [...switchesOf(S0).keys()].sort((a, b) => cmdRank(a) - cmdRank(b) || (a < b ? -1 : 1))) {
          for (const g of groupsOf(S0, k)) {
            const T = transitionOf(S0, k, g);
            if (!T || T.unsafe || !T.flow || !T.flow.at.has(L.x0)) continue;
            const others = [...base.ladders.keys()].filter((x) => x !== L.x0 && T.flow.at.has(x)).length;
            if (others < best) { best = others; B = T; }
          }
        }
        if (!B) continue;
        lead = [{ cmd: B.k, mode: B.mode === 'sustain' || B.mode === 'mash' ? 'press' : B.mode, until: rungs(L), patience: 180 }];
        actionT.set(lead[0], B);
      } else {
        lead = c.path.map((a) => { const o = Object.assign({}, a, { until: a.until.slice() }); if (actionT.has(a)) actionT.set(o, actionT.get(a)); return o; });
        const last = lead[lead.length - 1];
        last.until = rungs(L);
        last.patience = 180;
      }
      for (const a of lead) if (a.cmd !== undefined && !a.from) { const fr = actsFrom(c.entry, a, L); if (fr && fr.length) a.from = fr; }
      done.add(L.x0);
      // The position and its speeds keep his continuous mode on (a phase
      // held stays on screen); the climax turns it off (x3 then climaxes by
      // time). Made on the lead's first action, every time.
      const leadSet = (v) => {
        if (!L.cont) return lead;
        return lead.map((a, i) => {
          if (i) return a;
          const o = Object.assign({}, a, { set: [...(a.set || []), { kind: L.cont.kind, index: L.cont.index, value: v }].slice(0, 4) });
          if (actionT.has(a)) actionT.set(o, actionT.get(a));
          return o;
        });
      };
      const name = 'position ' + L.n;
      const w = cmdInfo.get(lead[lead.length - 1].cmd).words;
      const also = sorted(new Set([...rest, L.c0].filter((C) => !rungs(L).includes(C))));
      const on = L.cont ? L.cont.on : null, off = L.cont ? L.cont.off : null;
      out.push({ kind: 'position', name, n: L.n, label: w, until: rungs(L), also, path: leadSet(on) });
      if (!L.own) continue;
      const ow = cmdInfo.get(L.own.cmd).words;
      const sp = (until, pat) => Object.assign({ cmd: L.own.cmd, mode: 'press', until }, L.own.from.length ? { from: L.own.from.slice() } : {}, pat ? { patience: pat } : {});
      const r = rungs(L);
      out.push({ kind: 'speed', name, n: L.n, label: 'speed 2 (' + ow + ')', until: [r[1]], path: [...leadSet(on), sp([r[1]], 180)] });
      out.push({ kind: 'speed', name, n: L.n, label: 'speed 3 (' + ow + ')', until: [r[2]], path: [...leadSet(on), sp([r[1], r[2]], 180), sp([r[2]], 180)] });
      out.push({ kind: 'climax', name, n: L.n, label: 'climax', until: [r[3]], path: [...leadSet(off), sp([r[1], r[2], r[3]], 180), sp([r[2], r[3]], 180), { until: [r[3]], patience: 400 }] });
    }
    // A GAUGE GATE'S FAILURE (gateFails): where the insertion's first state
    // is one the setup's gauge gate sits in, the scene its TargetState gives
    // her when it fires (the groin kick, her 1695 or 1895) is a step: the
    // insertion's own lead with the gauge at its round-start 0 in the step's
    // setup, over the pair's hold. Once per scene per grab; it ends his
    // scene (1690 goes to 999), so it plays again from a fresh grab.
    for (const L of hits.sort((a, b) => a.x0 - b.x0)) {
      for (const F of base.gateFails || []) {
        if (F.state !== L.x0 || failDone.has(c.entry + '|' + F.her.join())) continue;
        const lp = out.find((x) => x.kind === 'position' && x.n === L.n);
        if (!lp) continue;
        failDone.add(c.entry + '|' + F.her.join());
        const path = lp.path.map((a, i) => (i === lp.path.length - 1 ? Object.assign({}, a, { until: F.her.slice() }) : a));
        for (let i = 0; i < path.length; i++) if (actionT.has(lp.path[i])) actionT.set(path[i], actionT.get(lp.path[i]));
        const w = cmdInfo.get(path[path.length - 1].cmd).words;
        out.push({ kind: 'fail', name: lp.name, n: L.n, label: 'insertion fails (' + w + ')', until: F.her.slice(), also: [L.c0], path, fail: true,
          setup: [{ kind: F.kind, index: F.index, value: F.value, why: ('lets ' + F.line + ' fire in ' + F.state + ': at its round-start ' + F.value + ' his gauge sends the insertion into its failure branch').replace(/[^\x20-\x7e]/g, '?') }] });
      }
    }
    return out;
  };
  const failDone = new Set();
  // What a grab's own controllers put her in before any scene of it shows
  // (Kur0maru's eating throw 3100: her 60-tick swallow 3200, drawn on her
  // own sprites; his milking 51305 hands on to 51306, whose first tick puts
  // her in 52218): on screen during the grab step, where she draws.
  const preOf = (E) => {
    const g = base.grabs.find((x) => x.no === E);
    const out = new Set();
    for (const no of [E, ...((g && g.handoff) || [])]) for (const sc of (states.get(no) || { sctrls: [] }).sctrls) {
      const raw = sc.type === 'targetstate' ? sc.params.get('value') : (sc.type === 'hitdef' || sc.type === 'projectile') ? sc.params.get('p2stateno') : undefined;
      if (raw === undefined) continue;
      for (const C of W.values(raw, {}, no)) if (W.custom.has(C) && !hScenes.has(C) && !isRelease(C)) out.add(C);
    }
    return sorted(out);
  };
  // NAV ROLES (deriveNav reads them where no other rule places a step): what
  // a walk step is in its grab, from what its last switch does there.
  //   Its HUB: the state of his where the step's scene comes to rest - the
  //   first state on his way from where the switch sent him that he stays
  //   in, has walk switches (or two commands or more acting there) and does
  //   not leave by time (FutaRB's 51000, and 51001 once Up is pressed).
  //   Steps that rest in one hub are one position.
  //   A SPEED: the switch sends him into a state the hub's own command also
  //   enters, which goes back into the hub by itself (FutaRB's Fuck1: 51000
  //   -> 50110 -> 51000 at AnimTime 0; Murakami's stroke 1002 back to 1000).
  //   Ranked in the order the hub's controllers list them (Fuck1 < Fuck2 <
  //   Fuck3), so a speed pressed elsewhere (a then Forward: 50510, Fuck1's of
  //   the blowjob hub 51004) takes its rank there.
  //   Its BASE: any other switch that rests in the hub (Up into 51001), and
  //   the grab alone in its own.
  //   A FINISH: a switch whose scene ends by itself (him back in a basic
  //   state) with no hub, after two scenes or one that releases her, is the
  //   climax of the hub it is pressed in; so is a finisher by count.
  //   A RUNG: a position whose only way on is the command that led there
  //   (BUTA's y, y, y: each stage holds until the next press) - two or more
  //   in a row are phases of the position they start from, the last one a
  //   finish where it is one.
  // (A state he leaves by himself once its time comes, for another state of
  // his - not a hub: FutaRB's speed 50110 at AnimTime 0. A hub that lets go
  // of her when he idles - Murakami's 1000 into 0 - still is one.)
  const leavesByTime = (no, A) => {
    const st = states.get(no);
    if (!st) return true;
    const rw = (e) => String(e).replace(TIME_ATOM, '1');
    return st.sctrls.some((sc) => sc.type === 'changestate' && !commandsIn(sc.trig).length
      && W.values(sc.params.get('value'), A, no).some((v) => v !== no && !isBasic(v) && states.has(v))
      && W.trig({ trig: { all: sc.trig.all.map(rw), groups: sc.trig.groups.map((g) => g.map(rw)) } }, A, NO_INPUT, no) === true);
  };
  // (The states a switch sent him into: where its own ChangeStates send
  // him - not where his state would go anyway, FutaRB's meter climax -, else
  // those of its walk nothing in it enters.)
  const enteredOf = (Sit) => {
    const own = [];
    for (const sc of (Sit.T && Sit.T.fired) || []) {
      if (sc.type !== 'changestate') continue;
      for (const L of Sit.T.locs || []) if (L.forced.has(sc)) for (const v of W.values(sc.params.get('value'), L.A, L.H)) if (Sit.flow.at.has(v) && !own.includes(v)) own.push(v);
    }
    if (own.length) return own;
    const inc = new Set();
    for (const [a, bs] of Sit.flow.edges || []) for (const b of bs) if (b !== a) inc.add(b);
    const out = [...Sit.flow.at.keys()].filter((n) => !inc.has(n));
    return out.length ? out : (Sit.T ? Sit.T.at.slice() : Sit.starts || []);
  };
  // (The first state on his way, from where the switch sent him, that he
  // stays in with a switch of his own and does not leave by time.)
  const homeMemo = new Map();
  const homeOf = (Sit) => {
    if (!Sit) return null;
    if (homeMemo.has(Sit)) return homeMemo.get(Sit);
    // (Where the walk made its switches, and where two commands or more
    // would act: a lone see-through toggle in his grab state makes no hub.)
    const hubs = new Set([...(Sit.kidAt || [])].filter((H) => Sit.flow.stay.has(H)));
    const by = new Map();
    for (const [k, ls] of switchesOf(Sit)) for (const L of ls) if (!L.zero && Sit.flow.stay.has(L.H)) { if (!by.has(L.H)) by.set(L.H, new Set()); by.get(L.H).add(k); }
    for (const [H, ks] of by) if (ks.size >= 2) hubs.add(H);
    const rests = (no) => hubs.has(no) && !leavesByTime(no, Sit.flow.stay.get(no) || Sit.flow.at.get(no) || A0);
    let home = null;
    const seen = new Set(), q = enteredOf(Sit).slice();
    while (q.length && home === null) {
      const no = q.shift();
      if (seen.has(no)) continue;
      seen.add(no);
      if (rests(no)) { home = no; break; }
      for (const b of (Sit.flow.edges && Sit.flow.edges.get(no)) || []) q.push(b);
    }
    if (home === null) home = [...Sit.flow.at.keys()].find(rests);
    if (home === undefined) home = null;
    homeMemo.set(Sit, home);
    return home;
  };
  // (Where in the hub's controllers a command takes him into J: -1 none.)
  const hubIndex = (Sit, H, J) => {
    const st = states.get(H);
    if (!st) return -1;
    const A = Sit.flow.stay.get(H) || Sit.flow.at.get(H) || A0;
    return st.sctrls.findIndex((sc) => sc.type === 'changestate' && commandsIn(sc.trig).some((k) => cmdInfo.has(k) && cmdInfo.get(k).playable)
      && W.values(sc.params.get('value'), A, H).includes(J));
  };
  const endsScene = (Sit) => [...(Sit.flow.edges || new Map()).values()].some((bs) => [...bs].some((b) => isBasic(b)));
  const roleOf = (c) => {
    const Sit = c.sit;
    if (!Sit || c.kind === 'jump' || c.kind === 'mash') return null;
    if (Sit.kind === 'own') { const h = homeOf(Sit); return h === null ? null : { hub: h, role: 'base' }; }
    if (Sit.kind !== 'position') return null;
    const home = homeOf(Sit);
    if (home === null) {
      const ph = homeOf(Sit.parent);
      if (ph === null || !endsScene(Sit)) return null;
      const iss = Sit.T && Sit.T.issuers ? [...Sit.T.issuers.keys()] : [];
      if (c.until.length >= 2 || iss.some(isRelease)) return { hub: ph, role: 'climax' };
      // (One scene alone: a finish only as a ladder's last rung.)
      return { hub: ph, role: 'end' };
    }
    for (const J of enteredOf(Sit)) {
      if (J === home || isBasic(J)) continue;
      const i = hubIndex(Sit, home, J);
      if (i >= 0 && returnsByTime(J, Sit.flow.at.get(J) || A0, home)) {
        // A LONG CYCLE IS A FINISH: one that holds him longer than a
        // sustained speed lasts (SUSTAIN_MAX) and gives her a scene of its own
        // is the hub's climax, not a speed (GnollK's ejaculate 9025, 434 ticks
        // against tugs of 42-92; FutaCR's FuckCum).
        const parentShows = new Set((Sit.parent && Sit.parent.shown) || []);
        if (holdOf(J, Sit.flow.at.get(J) || A0) > SUSTAIN_MAX && c.until.some((C) => !parentShows.has(C))) return { hub: home, role: 'climax' };
        return { hub: home, role: 'speed', rank: i };
      }
    }
    return { hub: home, role: 'base' };
  };
  // The rungs of one grab's steps (`navSit`, its situation), made one
  // position with the step they start from.
  const rungsOf = (list) => {
    const pathKey = (p) => JSON.stringify(p.map((a) => [a.cmd, a.mode, a.jump]));
    const byPath = new Map(list.filter((s) => s.navRole).map((s) => [pathKey(s.path), s]));
    const lastCmd = (x) => x.path[x.path.length - 1].cmd;
    const next = (p, k) => [...byPath.values()].filter((x) => x.path.length === p.length + 1 && pathKey(x.path.slice(0, -1)) === pathKey(p)
      && lastCmd(x) !== undefined && (k === null || lastCmd(x) === k) && !x.navRole.rung && x.navRole.role !== 'speed');
    for (const s of list) {
      if (!s.navRole || s.navRole.role !== 'base' || s.navRole.rung) continue;
      for (const first of next(s.path, null)) {
        if (first.navRole.rung) continue;
        const k = lastCmd(first);
        const chain = [];
        let nx = first;
        // (Each rung but the last leads on only by the command.)
        while (nx) {
          chain.push(nx);
          const kids = (nx.navSit && nx.navSit.kidCmds) || new Set();
          if (nx.navRole.role === 'climax' || nx.navRole.role === 'end' || !kids.size || [...kids].some((x) => x !== k)) break;
          nx = next(nx.path, k)[0] || null;
        }
        if (chain.length < 2) continue;
        chain.forEach((x, i) => {
          x.navRole = { hub: s.navRole.hub, role: x.navRole.role === 'climax' || x.navRole.role === 'end' ? 'climax' : 'speed', rank: i, rung: true };
        });
      }
    }
  };
  // A TIMED LADDER (TIMED LADDERS in the header): a step whose scene goes
  // on by itself through states of his, each giving her the next scene
  // after a while, made one step per rung.
  // (How long a state of his stays before it leaves by time: the ticks its
  // timed exits wait - `time >= 300`, an animation's end -, 0 where it
  // leaves at once or never by time.)
  const holdMemo = new Map();
  const holdOf = (no, A) => {
    const mk = no + '#' + keyOf(A);
    if (holdMemo.has(mk)) return holdMemo.get(mk);
    const st = states.get(no);
    let best = null;
    for (const sc of (st ? st.sctrls : [])) {
      if (sc.type !== 'changestate' || commandsIn(sc.trig).length) continue;
      if (!W.values(sc.params.get('value'), A, no).some((v) => v !== no)) continue;
      const atoms = [...sc.trig.all, ...sc.trig.groups.flat()].map(String).join(' ').match(TIME_ATOM) || [];
      if (!atoms.length) { if (W.trig(sc, A, NO_INPUT, no) === true) { best = 0; break; } continue; }
      const rw = (e) => String(e).replace(TIME_ATOM, '1');
      if (W.trig({ trig: { all: sc.trig.all.map(rw), groups: sc.trig.groups.map((g) => g.map(rw)) } }, A, NO_INPUT, no) === false) continue;
      let t = 0;
      for (const m of atoms) {
        const w = m.toLowerCase();
        const n = Number((/-?\d+/.exec(w.slice(w.search(/[=<>]/))) || [0])[0]);
        if (w.startsWith('animtime')) { const at = W.animTicks(no, A); t = Math.max(t, at.max !== null ? at.max : 60); }
        else if (w.startsWith('animelem')) t = Math.max(t, 30);
        else t = Math.max(t, n);
      }
      best = best === null ? t : Math.min(best, t);
    }
    holdMemo.set(mk, best || 0);
    return best || 0;
  };
  const LADDER_HOLD = 15;   // ticks a rung lasts at least
  const timedLadderOf = (c, hubs) => {
    const Sit = c.sit;
    // (The grab itself, or one switch into it: a deeper switch's scene is
    // a hub's own - FutaRB's finishes -, which NAV ROLES places.)
    if (!Sit || !Sit.flow || (c.kind !== 'own' && c.kind !== 'position') || c.depth > 1 || c.until.length < 3) return null;
    const f = Sit.flow;
    const edges = f.edges || new Map();
    // (His states in the order the scene reaches them.)
    const dist = new Map();
    const q = [];
    // (From where the scene starts: a switch that sent him on at once
    // starts where it sent him - the states nothing in it enters.)
    const inc = new Set();
    for (const [a, bs] of edges) for (const b of bs) if (b !== a) inc.add(b);
    for (const s of [...(Sit.starts || []), ...[...f.at.keys()].filter((n) => !inc.has(n))]) if (f.at.has(s) && !dist.has(s)) { dist.set(s, 0); q.push(s); }
    while (q.length) { const no = q.shift(); for (const b of edges.get(no) || []) if (!dist.has(b) && f.at.has(b)) { dist.set(b, dist.get(no) + 1); q.push(b); } }
    const reachMemo = new Map();
    const reachFrom = (a) => {
      if (reachMemo.has(a)) return reachMemo.get(a);
      const seen = new Set([a]), qq = [a];
      while (qq.length) { const no = qq.shift(); for (const b of edges.get(no) || []) if (!seen.has(b)) { seen.add(b); qq.push(b); } }
      reachMemo.set(a, seen);
      return seen;
    };
    // (Each of her states by the first state of his on the way that gives
    // it; one her own chain moves her on to, by the scene it follows.)
    const rungOf = new Map();
    for (const C of c.until) {
      const hs = ((c.via && c.via[C]) || []).filter((H) => dist.has(H)).sort((a, b) => dist.get(a) - dist.get(b));
      if (hs.length) rungOf.set(C, hs[0]);
    }
    for (let grew = true; grew;) {
      grew = false;
      for (const C of c.until) {
        if (rungOf.has(C)) continue;
        const P = c.until.find((P2) => rungOf.has(P2) && (base.chains.get(P2) || []).includes(C));
        if (P !== undefined) { rungOf.set(C, rungOf.get(P)); grew = true; }
      }
    }
    // (Each refusal says why, for whoever reads this code: no ladder.)
    const dbg = () => null;
    if (c.until.some((C) => !rungOf.has(C))) return dbg('not his: ' + c.until.filter((C) => !rungOf.has(C)).join(','));
    // (What he gives her as he lets go - the TargetState on the tick he
    // goes back to a basic state of his - is the scene's end, no rung.)
    const norm = (sc) => [...sc.trig.all, ...sc.trig.groups.flat()].map((e) => String(e).toLowerCase().replace(/\s+/g, '')).sort().join('&');
    const letGo = (C) => {
      const st = states.get(rungOf.get(C));
      if (!st) return false;
      const outs = st.sctrls.filter((sc) => sc.type === 'changestate' && W.values(sc.params.get('value'), f.at.get(rungOf.get(C)) || A0, rungOf.get(C)).some((v) => isBasic(v) && v >= 0)).map(norm);
      return outs.length > 0 && st.sctrls.some((sc) => sc.type === 'targetstate' && outs.includes(norm(sc))
        && W.values(sc.params.get('value'), f.at.get(rungOf.get(C)) || A0, rungOf.get(C)).includes(C));
    };
    const end = c.until.filter(letGo);
    let hs = [...new Set(c.until.filter((C) => !end.includes(C)).map((C) => rungOf.get(C)))].sort((a, b) => dist.get(a) - dist.get(b));
    // (A state of his where a step of this grab makes its switch is the
    // scene's hub: the ladder's last rung, no climax, with all it shows from
    // there - and none before three rungs of its own: Minotaur's buster 1250
    // after its lift and slam is a grab with an intro.)
    const full = hs;
    const hubAt = hs.findIndex((H) => hubs && hubs.has(H));
    if (hubAt >= 0 && hubAt < 3) return dbg('a hub after ' + hubAt + ' rungs');
    if (hubAt >= 0) hs = hs.slice(0, hubAt + 1);
    if (hs.length < 3) return dbg('rungs ' + hs.length);
    // One line, never back, a rung lasting a while: a state of his from one
    // giver to the next (both included) that leaves by time after a while.
    for (let i = 0; i + 1 < hs.length; i++) {
      if (!reachFrom(hs[i]).has(hs[i + 1]) || reachFrom(hs[i + 1]).has(hs[i])) return dbg('not one line at ' + hs[i] + '>' + hs[i + 1]);
      const way = [...reachFrom(hs[i])].filter((x) => x === hs[i + 1] || reachFrom(x).has(hs[i + 1]));
      if (!way.some((x) => f.at.has(x) && holdOf(x, f.stay.get(x) || f.at.get(x)) >= LADDER_HOLD)) return dbg('no wait ' + hs[i] + '>' + hs[i + 1]);
    }
    const rungs = hs.map((H, i) => sorted(c.until.filter((C) => !end.includes(C) && Math.min(full.indexOf(rungOf.get(C)), hs.length - 1) === i)));
    // (What he lets her go into ends the last rung: shown after it, as before.)
    if (end.length) rungs[rungs.length - 1] = sorted(new Set([...rungs[rungs.length - 1], ...end]));
    // (Its last rung is a climax where the scene then ends by itself.)
    const climax = hubAt < 0 && [...reachFrom(hs[hs.length - 1])].some((x) => isBasic(x) && x >= 0);
    // (His states where a rung can still come: from the grab to its giver.)
    const before = (H) => sorted([...dist.keys()].filter((x) => reachFrom(x).has(H) && !isBasic(x)));
    // (The ticks from the step's start to each rung, for its patience.)
    const ticks = [0];
    for (let i = 1; i < hs.length; i++) {
      const way = [...reachFrom(hs[i - 1])].filter((x) => x === hs[i] || reachFrom(x).has(hs[i]));
      ticks.push(ticks[i - 1] + way.reduce((n, x) => n + (f.at.has(x) ? holdOf(x, f.stay.get(x) || f.at.get(x)) : 0), 0));
    }
    // (RUNG 0'S WAIT: the ticks he holds on his way from where the step
    // starts to the first rung's giver - Murakami's 2900 holds her in 2920
    // some 700 ticks first -, for the first rung's patience.)
    let ticks0 = 0;
    {
      // (Along one shortest way there: of two random branches, one is taken.)
      const par = new Map(), q0 = [...dist.keys()].filter((x) => dist.get(x) === 0);
      for (const x of q0) par.set(x, null);
      while (q0.length) { const no = q0.shift(); if (no === hs[0]) break; for (const b of edges.get(no) || []) if (!par.has(b) && f.at.has(b)) { par.set(b, no); q0.push(b); } }
      for (let x = par.has(hs[0]) ? par.get(hs[0]) : null; x !== null && x !== undefined; x = par.get(x)) ticks0 += holdOf(x, f.stay.get(x) || f.at.get(x));
    }
    return { rungs, givers: hs, before, ticks, ticks0, climax, end };
  };
  // AN ANIM HUB (ANIM HUBS in the header): a grab whose scene of hers draws
  // HIS animation (her ChangeAnim on `enemynear,anim + 1000`), in a hub of
  // his whose positions, speeds and climax are his own animations, picked by
  // ChangeAnims on his commands. Her state never changes there, so each of
  // his animations is a step of its own.
  // A VARIABLE-DRIVEN ANIM HUB (FutaNT Android 21's 50003: one ChangeAnim at
  // `time = 0 || animtime = 0` to 70000 + fvar(32) + fvar(31), +10000 where
  // fvar(34) = 1): a state of the grab's own scene whose ChangeAnim value
  // reads variables his commands VarSet in that state. Each such variable is
  // an axis, read from its writers there: one whose value picks a number by
  // the command pressed (`ifElse(command = "back", 80, ...)`) is the POSITION
  // (each number a position, 0 his grab's own); one stepping itself
  // (`ifelse(fvar(32) = 1, 2, ...)` on y, back down on x) the SPEED, its
  // values the numbers its steps name; a toggle (`ifelse(fvar(34) = 1, 0,
  // 1)`) a VERSION (each step a copy at 0 and 1, held in the step's setup).
  // The CLIMAX: a literal VarSet of the speed variable to a number outside its
  // steps, on a command (z: 6); a meter its trigger asks above a number
  // (fvar(35) > 10, a cum bar his negative states fill up to < 41.5, and
  // under 1 cuts the cum off) is held at that cap in the climax steps. Every
  // variable is SET once by the hook (never pressed: y pressed again and
  // again overshoots), and each action is done when his animation shows.
  // Only animations his .air has. -> { H, p, s, ver, pos, speeds, climax, anim } | null
  const varHubMemo = new Map();
  const varHubOf = (c) => {
    const Sit = c.sit;
    if (!Sit || Sit.kind !== 'own' || !Sit.flow) return null;
    if (varHubMemo.has(c.entry)) return varHubMemo.get(c.entry);
    let out = null;
    const playable = (k) => cmdInfo.has(k) && cmdInfo.get(k).playable;
    const axisOf = (V) => { const r = varRef(V); return r ? { V, n: V, kind: r.kind, index: r.index } : null; };
    for (const [H] of Sit.flow.at) {
      if (out || H < 0 || isBasic(H)) continue;
      const st = states.get(H);
      if (!st) continue;
      for (const ca of st.sctrls) {
        if (out || ca.type !== 'changeanim') continue;
        const prepV = String(ca.params.get('value') || '').replace(/\bnumexplod\s*\(\s*\d*\s*\)/gi, '(0)');
        const vars = X.varsOf(prepV).filter((v) => VARNAME.test(v));
        if (vars.length < 2 || vars.length > 3) continue;
        const wr = new Map();
        for (const sc of st.sctrls) {
          if (sc.type !== 'varset') continue;
          const cmds = commandsIn(sc.trig).filter(playable);
          if (!cmds.length) continue;
          for (const [nm, r] of W.writesOf(sc)) if (vars.includes(nm)) { if (!wr.has(nm)) wr.set(nm, []); wr.get(nm).push({ sc, raw: String(r), cmds }); }
        }
        let p = null, s = null, ver = null, climax = null;
        for (const V of vars) {
          const ws = wr.get(V) || [];
          if (!ws.length) continue;
          const toggle = ws.find((w) => { const vs = X.varsOf(w.raw), L = X.leavesOf(w.raw); return vs.length === 1 && vs[0] === V && L.length === 2 && L.includes(0) && L.includes(1); });
          const byCmd = ws.filter((w) => /\bcommand\s*=/i.test(w.raw));
          const steps = ws.filter((w) => w !== toggle && !byCmd.includes(w) && X.varsOf(w.raw).includes(V));
          if (toggle && !steps.length && !byCmd.length) { ver = Object.assign(axisOf(V), { cmd: toggle.cmds[0], values: [0, 1] }); continue; }
          if (byCmd.length && !p) {
            // (Each number by the command whose branch gives it.)
            const pos = new Map([[0, null]]);
            for (const w of byCmd) for (const k of w.cmds) {
              const txt = w.raw.replace(/\bcommand\s*(!=|=)\s*"([^"]*)"/gi, (all, op, name) => ((op === '=') === (name === k) ? '1' : '0'));
              const v = X.evalExpr(txt, { [V]: 0 });
              if (typeof v === 'number' && Number.isFinite(v) && !pos.has(v)) pos.set(v, k);
            }
            if (pos.size >= 2) p = Object.assign(axisOf(V), { pos: [...pos].sort((a, b) => a[0] - b[0]).map(([value, cmd]) => ({ value, cmd })) });
            continue;
          }
          if (steps.length && !s) {
            const vals = new Set(steps.flatMap((w) => X.leavesOf(w.raw)).filter((v) => Number.isInteger(v)));
            if (vals.size < 2) continue;
            s = Object.assign(axisOf(V), { values: [...vals].sort((a, b) => a - b) });
            // (Its climax: a literal set of it outside its steps, on a command.)
            for (const sc of st.sctrls) {
              if (sc.type !== 'varset' || climax) continue;
              const cmds = commandsIn(sc.trig).filter(playable);
              if (!cmds.length) continue;
              for (const [nm, r] of W.writesOf(sc)) {
                const v = S.lit(r);
                if (nm !== V || v === null || vals.has(v)) continue;
                climax = { value: v, cmd: cmds[0] };
                // (A meter its trigger asks above a number, held at the cap
                // his negative states fill it to.)
                for (const m of trigTextOf(sc).matchAll(/\b(f?var)\s*\(\s*(\d+)\s*\)\s*>\s*(-?[\d.]+)/gi)) {
                  const M = m[1].toLowerCase() + '(' + m[2] + ')';
                  if (M === V) continue;
                  let cap = null;
                  for (const neg of [-3, -2, -1]) for (const x of (states.get(neg) || { sctrls: [] }).sctrls) {
                    if (x.type !== 'varadd' || !W.writesOf(x).some(([nm2]) => nm2 === M)) continue;
                    const cm = new RegExp('\\b' + m[1] + '\\s*\\(\\s*' + m[2] + '\\s*\\)\\s*<\\s*(-?[\\d.]+)', 'i').exec(trigTextOf(x));
                    if (cm) cap = Math.max(cap === null ? -Infinity : cap, parseFloat(cm[1]));
                  }
                  const rf = varRef(M);
                  const value = cap !== null ? cap : parseFloat(m[3]) + 1;
                  if (rf) climax.meter = { kind: rf.kind, index: rf.index, value, why: clean('holds his ' + M + ' at ' + value + ': ' + cmdInfo.get(cmds[0]).words + ' climaxes only over ' + m[3]) };
                  break;
                }
              }
            }
          }
        }
        if (!p || !s) continue;
        // (After the climax value, the numbers his own lines with no command
        // give the speed variable before it comes back to its steps - the cum
        // sequence 9..18 -: the climax's animations too.)
        if (climax) {
          const after = new Set();
          for (const sc of st.sctrls) {
            if (sc.type !== 'varset' || commandsIn(sc.trig).length) continue;
            for (const [nm, r] of W.writesOf(sc)) {
              if (nm !== s.V) continue;
              const lit0 = S.lit(r);
              // (Its other variables - the cum in/out switch - at small values.)
              const others = X.varsOf(String(r)).filter((x) => x !== s.V);
              const ctxs = others.length === 1 ? [0, 1, 2, 3].map((k) => ({ [others[0]]: k })) : [{}];
              for (const v of lit0 !== null ? [lit0] : [...X.leavesOf(String(r)), ...ctxs.flatMap((cx) => X.evalRandom(String(r), cx))]) if (Number.isInteger(v) && !s.values.includes(v) && v !== climax.value) after.add(v);
            }
          }
          climax.after = [...after].sort((a, b) => a - b);
        }
        const known = [p.V, s.V, ...(ver ? [ver.V] : [])];
        if (vars.some((v) => !known.includes(v))) continue;
        // (The toggle's variable is read even once its version is dropped: at
        // 0, the table he draws with it off.)
        const togV = ver ? ver.V : null;
        const anim = (pv, sv, vv) => {
          const n = X.evalExpr(prepV, Object.assign({ [p.V]: pv, [s.V]: sv }, togV ? { [togV]: vv || 0 } : {}));
          return typeof n === 'number' && Number.isInteger(n) && base.gAir.has(n) ? n : null;
        };
        // (A version his .air has no animation for is none - the version, not
        // the hub.)
        if (ver && !p.pos.some((P) => s.values.some((sv) => anim(P.value, sv, 1) !== null))) ver = null;
        out = { H, p, s, ver, pos: p.pos, speeds: s.values, climax, anim };
      }
    }
    varHubMemo.set(c.entry, out);
    return out;
  };
  const trigTextOf = (sc) => [...sc.trig.all, ...sc.trig.groups.flat()].join(' && ');
  const HIS_ANIM = /\b(?:enemynear|enemy|target|stateowner|p2)\s*(?:\(\s*\d*\s*\))?\s*,\s*anim\b/i;
  const ANIM_CTRL = new Set(['changeanim', 'changeanim2']);
  const animKeyed = (C) => { const st = states.get(C); return !!st && st.sctrls.some((sc) => ANIM_CTRL.has(sc.type) && HIS_ANIM.test(String(sc.params.get('value') || ''))); };
  const playableCmd = (k) => cmdInfo.has(k) && cmdInfo.get(k).playable;
  const animHubOf = (c) => {
    if (!c.sit || c.sit.kind !== 'own' || !c.sit.flow || !c.until.some(animKeyed)) return null;
    const f = c.sit.flow;
    // (The hub: the one state of his on the scene's way with ChangeAnims his
    // commands make.)
    const hubs = [...f.at.keys()].filter((H) => !isBasic(H) && states.has(H) && states.get(H).sctrls.some((sc) => ANIM_CTRL.has(sc.type) && commandsIn(sc.trig).some(playableCmd)));
    if (hubs.length !== 1) return null;
    const H = hubs[0];
    const sctrls = states.get(H).sctrls.filter((sc) => ANIM_CTRL.has(sc.type) || sc.type === 'varset' || sc.type === 'varadd');
    const writes = (sc) => {
      const out = [];
      const v = S.lit(sc.params.get('v')), fv = S.lit(sc.params.get('fv'));
      if (v !== null) out.push(['var(' + v + ')', sc.params.get('value')]);
      if (fv !== null) out.push(['fvar(' + fv + ')', sc.params.get('value')]);
      for (const [k, val] of sc.params) { const m = /^(var|fvar)\((\d+)\)$/.exec(k); if (m) out.push([m[1] + '(' + m[2] + ')', val]); }
      return out;
    };
    // (A tick of the hub, read as the engine runs it: his ChangeAnims and the
    // variables they read, in file order. AnimTime is 0 on an animation's
    // last tick only; an explod comes and goes, so the picture he rests in
    // is read with none on screen; anything else unknown never fires.)
    const prepMemo = new Map();
    const prep = (e, inputs, end) => {
      const k = String(e) + '|' + inputsKey(inputs) + '|' + (end ? 1 : 0);
      if (prepMemo.has(k)) return prepMemo.get(k);
      const s = rewriteAtoms(e, inputs, H, null, { herLife: HER_LIFE, helperVars: true, power: base.power, palno: PALNO, cmdAlias: base.cmdAlias })
        .replace(/\banimtime\b/gi, (all, off, str) => (redirected(str, off) ? all : end ? '(0)' : '(-1)'))
        .replace(/\bnumexplod\s*\(\s*\d*\s*\)/gi, (all, off, str) => (redirected(str, off) ? all : '(0)'));
      prepMemo.set(k, s);
      return s;
    };
    const tracked = new Set();
    for (const sc of sctrls) if (ANIM_CTRL.has(sc.type)) for (const e of [...sc.trig.all, ...sc.trig.groups.flat(), sc.params.get('value') || '']) for (const v of X.varsOf(prep(e, null, false))) tracked.add(v);
    for (let i = 0; i < 3; i++) for (const sc of sctrls) if (!ANIM_CTRL.has(sc.type) && writes(sc).some(([n]) => tracked.has(n))) for (const e of [...sc.trig.all, ...sc.trig.groups.flat()]) for (const v of X.varsOf(prep(e, null, false))) tracked.add(v);
    const evalN = (e, ctx) => { let v; try { v = X.evalExpr(e, ctx); } catch (err) { v = null; } return typeof v === 'boolean' ? +v : Number.isFinite(v) ? v : null; };
    const tick = (s0, inputs, end, t0) => {
      let anim = s0.anim;
      const vars = Object.assign({}, s0.vars);
      for (const sc of sctrls) {
        if (!ANIM_CTRL.has(sc.type) && !writes(sc).some(([n]) => tracked.has(n))) continue;
        const ctx = Object.assign({ anim, time: t0 ? 0 : 1, isHelper: false }, vars);
        let ok;
        try { ok = X.evalTriggerSet({ all: sc.trig.all.map((e) => prep(e, inputs, end)), groups: sc.trig.groups.map((g) => g.map((e) => prep(e, inputs, end))) }, ctx); } catch (err) { ok = null; }
        if (ok !== true) continue;
        if (ANIM_CTRL.has(sc.type)) {
          const v = evalN(prep(sc.params.get('value') || '', inputs, end), ctx);
          if (v !== null && base.airTimes.has(Math.trunc(v))) anim = Math.trunc(v);
          continue;
        }
        for (const [n, raw] of writes(sc)) {
          if (!tracked.has(n)) continue;
          const v = evalN(prep(raw, inputs, end), ctx);
          if (v === null) delete vars[n]; else vars[n] = sc.type === 'varadd' ? (vars[n] || 0) + v : v;
        }
      }
      return { anim, vars };
    };
    const keyS = (s) => s.anim + '|' + Object.keys(s.vars).sort().map((k) => k + '=' + s.vars[k]).join(',');
    // (Left alone: his animations' ends, one after another, until he rests.)
    const settle = (s) => {
      const anims = [];
      const seen = new Set([keyS(s)]);
      for (let i = 0; i < 8; i++) {
        s = tick(tick(s, NO_INPUT, true, false), NO_INPUT, false, false);
        anims.push(s.anim);
        if (seen.has(keyS(s))) break;
        seen.add(keyS(s));
      }
      return { s, anims };
    };
    const hd = states.get(H);
    const A = f.stay.get(H) || f.at.get(H) || {};
    const vars0 = {};
    for (const v of tracked) vars0[v] = A[v] && A[v].length === 1 ? A[v][0] : 0;
    const anim0 = S.lit(hd.anim);
    if (anim0 === null || !base.airTimes.has(anim0)) return null;
    const start = settle(tick({ anim: anim0, vars: vars0 }, NO_INPUT, false, true)).s;
    const cmds = [];
    for (const sc of sctrls) for (const k of commandsIn(sc.trig)) if (playableCmd(k) && !cmds.includes(k)) cmds.push(k);
    // Its POSITIONS: his command's ChangeAnim to an animation he stays in;
    // its SPEEDS: one that plays its animation and goes back by itself.
    const pos = [{ s: start, speeds: [], press: null }];
    const byAnim = new Map([[start.anim, pos[0]]]);
    const turn = (P, k) => {
      const a1 = tick(P.s, new Set([k]), false, false);
      if (keyS(a1) === keyS(P.s)) return null;
      const st2 = settle(a1);
      const shown = [a1.anim, ...st2.anims].find((x) => x !== P.s.anim);
      return { back: keyS(st2.s) === keyS(P.s), rest: st2.s, shown };
    };
    for (let i = 0; i < pos.length && pos.length < 12; i++) {
      const P = pos[i];
      for (const k of cmds) {
        const t = turn(P, k);
        if (!t || t.shown === undefined) continue;
        if (t.back) { if (!P.speeds.some((x) => x.anim === t.shown)) P.speeds.push({ k, anim: t.shown }); continue; }
        // (Only the grab's own position leads on: one press from it.)
        if (i === 0 && t.rest.anim !== P.s.anim && !byAnim.has(t.rest.anim) && keyS(settle(t.rest).s) === keyS(t.rest)) {
          const N = { s: t.rest, speeds: [], press: k };
          byAnim.set(t.rest.anim, N);
          pos.push(N);
        }
      }
    }
    if (pos.length < 2 && !pos[0].speeds.length) return null;
    // (In the order of his animations: the grab's own first.)
    pos.splice(1, pos.length - 1, ...pos.slice(1).sort((x, y) => x.s.anim - y.s.anim));
    // Its CLIMAX: a ChangeAnim of the hub no command reaches because a
    // variable it compares (`Var(34) >= 26`, a meter only his thrusts fill) is
    // below the number - the hook sets it there once, at the position's idle.
    const meters = [];
    for (const sc of sctrls) {
      if (!ANIM_CTRL.has(sc.type)) continue;
      for (const e of [...sc.trig.all, ...sc.trig.groups.flat()]) {
        const m = /^\s*(f?var)\s*\(\s*(\d+)\s*\)\s*(>=|>)\s*(-?\d+)\s*(?:;.*)?$/i.exec(String(e));
        if (!m) continue;
        const n = m[1].toLowerCase() + '(' + m[2] + ')';
        const val = +m[4] + (m[3] === '>' ? 1 : 0);
        if (!tracked.has(n) || pos.some((P) => (P.s.vars[n] || 0) >= val) || meters.some((x) => x.n === n)) continue;
        meters.push({ n, kind: m[1].toLowerCase(), index: +m[2], value: val });
      }
    }
    for (const P of pos) {
      for (const M of meters) {
        const a1 = tick({ anim: P.s.anim, vars: Object.assign({}, P.s.vars, { [M.n]: M.value }) }, NO_INPUT, false, false);
        if (a1.anim !== P.s.anim && !P.climax) P.climax = { anim: a1.anim, meter: M };
      }
    }
    // (Only a meter that makes a climax: the auto flag his auto idles compare
    // with `var(45) >= 1` is none.)
    meters.splice(0, meters.length, ...meters.filter((M) => pos.some((P) => P.climax && P.climax.meter === M)));
    // (A finish counter: a variable the hub adds to on a climax animation,
    // held at 0 so every climax is the first.)
    const climaxAnims = pos.filter((P) => P.climax).map((P) => P.climax.anim);
    const counters = [];
    for (const sc of sctrls) {
      if (sc.type !== 'varadd') continue;
      const txt = [...sc.trig.all, ...sc.trig.groups.flat()].join(' ');
      if (!climaxAnims.some((a) => new RegExp('\\banim\\s*=\\s*' + a + '\\b', 'i').test(txt))) continue;
      for (const [n] of writes(sc)) { const r = varRef(n); if (r && !counters.some((x) => x.n === n)) counters.push(Object.assign({ n }, r)); }
    }
    return { H, pos, meters, counters, start, keyed: c.until.filter(animKeyed), turn };
  };
  const steps = [];
  const perEntry = new Map();
  for (const E of entries) {
    const mine = cands.filter((c) => c.entry === E && kept.has(c));
    const js = jumpSteps.filter((j) => j.entry === E);
    const r = bao.get(E);
    if (mine.length || js.length || r) perEntry.set(E, { mine, js, r });
  }
  const multi = perEntry.size > 1;
  const clean = (s) => String(s).replace(/[^\x20-\x7e]/g, '?');
  // A mashed press reads "mash a".
  const wordsOf = (p) => p.filter((a) => a.cmd !== undefined || jumpWords.has(a)).map((a) => (a.cmd !== undefined ? cmdInfo.get(a.cmd).words.replace(/^press /, a.mode === 'mash' ? 'mash ' : 'press ') : jumpWords.get(a)));
  // LABELS never repeat the group (the runtime draws it on a line of its
  // own): "speed 2 (press x)" under "grab F,D,B,b: position 1".
  // (Two grabs read as hubs are told apart by their own names: "Bao (grab
  // B,F,x)".)
  const baoMany = [...perEntry.values()].filter((x) => x.r).length > 1;
  for (const [E, { mine, js, r }] of perEntry) {
    const ownName = base.grabNames.get(E) || 'grab ' + E;
    const name = r ? (baoMany ? 'Bao (' + ownName + ')' : 'Bao') : ownName;
    const pfx = multi ? name + ': ' : '';
    const sm = summonOf.get(E);
    const scope = entryStates.get(E);
    const grabInfo = base.grabs.find((g) => g.no === E);
    const fromFor = (a) => {
      const T = actionT.get(a);
      if (!T || !T.fired) return [];
      const out = new Set();
      for (const sc of T.fired) {
        if (sc.state >= 0 || sc.type !== 'varset') continue;
        const named = statesNamed(sc.trig);
        if (named) for (const n of named) if (!scope || scope.has(n)) out.add(n);
      }
      return sorted(out);
    };
    const push = (st) => {
      const o = Object.assign({ entry: E }, st, { group: clean(st.group), label: clean(st.label) });
      // A grab that is a projectile's hit (Kur0maru's gas): the engine removes
      // a projectile past the view's edge, so the runtime grabs only with the
      // pair in view.
      if (grabInfo && grabInfo.projectile) o.proj = true;
      // (A SIGNALED GRAB: entered through the state that spawns the helper
      // whose signal sends him into it; stood at its approach's distance from
      // her by the runtime where it has one.)
      const sig = !sm && base.signaled && base.signaled.get(E);
      if (sig) {
        o.entry = sig.no; o.clear = sig.helper;
        if (sig.place) o.place = Object.assign({}, sig.place);
        if (sig.approach) o.approach = Object.assign({}, sig.approach);
      }
      if (sm) {
        if (sm.place) o.place = Object.assign({}, sm.place);
        if (sm.edgeOnly) o.edgeOnly = true;
        o.clear = sm.helper;
        if (sm.also && sm.also.length) o.clearAlso = sm.also.slice();
        // (A PRESS SUMMON: his button pressed while he stands with control,
        // no grab state entered.)
        if (sm.press) { o.noGrab = true; o.withCtrl = true; o.path = [{ cmd: sm.press, mode: 'press', until: (o.until || []).slice() }, ...o.path]; }
        o.path = o.path.map((a) => { if (a.cmd === undefined || a.from) return a; const fr = fromFor(a); return fr.length ? Object.assign({}, a, { from: fr }) : a; });
      }
      steps.push(o);
    };
    // (A step new to the hub reader - her orgasm, a position only a climax
    // enters - carries its nav; `held` and `hisStages` are for pairStages.)
    if (r) for (const s of r.steps) push(Object.assign({ group: pfx + s.name, label: s.label, kind: s.kind, until: s.until, also: s.also, path: s.path, reader: true },
      s.held ? { held: s.held } : {}, s.hisStages ? { hisStages: s.hisStages } : {}, s.artKey ? { artKey: s.artKey } : {}, s.kind === 'orgasm' || s.fresh || s.buff ? { navNew: true } : {}, s.setup ? { setup: s.setup.map((y) => Object.assign({}, y)) } : {},
      s.kind === 'orgasm' ? { leaf: true } : {}));
    const grp = name;
    const ordered = mine.slice().sort((a, b) => (a.sit.kind === 'own' ? 0 : 1) - (b.sit.kind === 'own' ? 0 : 1) || a.depth - b.depth || a.order - b.order);
    // Insertion ladders in their own order (1610, 1620, ...), right after
    // the grab's own step.
    const ladderSteps = [];
    const rest = [];
    for (const c of ordered) {
      const ld = ladderOf(c);
      if (ld) ladderSteps.push(...ld); else rest.push(c);
    }
    ladderSteps.sort((a, b) => a.n - b.n);
    const own = rest.filter((c) => c.sit.kind === 'own');
    const pushWalk = (c, alsoMore) => {
      const w = wordsOf(c.path);
      // (A gauge's strokes, sustained: said as a hold.)
      if (c.strokes && w.length) w[w.length - 1] = w[w.length - 1].replace(/^press /, 'hold ');
      let label;
      // (A projectile's step is its hit: nobody is held.)
      if (c.sit.kind === 'own') label = (grabInfo && grabInfo.projectile ? 'the hit' : 'the grab') + (w.length ? ' (' + w.join(', then ') + ')' : '');
      else label = w.join(', then ') + (c.kind === 'auto' ? ', auto' : c.kind === 'climax' ? ', climax' : c.kind === 'speed' ? ', speed' : '');
      const extra = {};
      if (c.sit.kind === 'own' && sm) extra.also = sm.grab.slice();
      if (c.sit.kind === 'own' && !sm) { const pre = preOf(E).filter((C) => !c.until.includes(C)); if (pre.length) extra.pre = pre; }
      if (c.twin) extra.edge = twinSig(c);
      const lastA = c.path[c.path.length - 1];
      if (lastA && lastA.mode === 'mash' && c.sit.T && c.sit.T.mashBack.length) extra.also = c.sit.T.mashBack.filter((C) => !c.until.includes(C));
      if (alsoMore && alsoMore.length) extra.also = sorted(new Set([...(extra.also || []), ...alsoMore.filter((C) => !c.until.includes(C))]));
      // (Its role in the grab, for the deriver: NAV ROLES.)
      const role = roleOf(c);
      if (role) { extra.navRole = role; extra.navSit = c.sit; }
      push(Object.assign({ group: grp, label, kind: c.kind, until: c.until, path: handoffPath(c, speedFromPath(c, role)) }, extra));
    };
    // A TIMED LADDER: one step per rung, "phase k" and its last the
    // climax; its own group where the grab has other steps (one position).
    const alone = mine.length === 1 && !js.length && !r && !ladderSteps.length;
    const pushLadder = (c) => {
      const L = timedLadderOf(c, new Set(mine.filter((c2) => c2.sit.parent === c.sit && c2.sit.T).flatMap((c2) => c2.sit.T.at)));
      if (!L) return false;
      const w = wordsOf(c.path);
      const group = alone ? grp : grp + ': ' + (c.sit.kind === 'own' ? (grabInfo && grabInfo.projectile ? 'the hit' : 'the grab') : w.join(', then '));
      const keepT = (a, o) => { if (actionT.has(a)) actionT.set(o, actionT.get(a)); return o; };
      const cpath = handoffPath(c, c.path);
      L.rungs.forEach((R, i) => {
        const last = L.climax && i === L.rungs.length - 1;
        const also = c.until.filter((C) => !R.includes(C));
        let path;
        if (i === 0) {
          path = cpath.map((a, j) => (j === cpath.length - 1 ? keepT(a, Object.assign({}, a, { until: R.slice() })) : a));
          // (A long way to the first rung waits as long: L.ticks0.)
          const pat0 = Math.min(12000, 2 * (L.ticks0 || 0) + 120);
          if ((L.ticks0 || 0) > PATIENCE) path = path.length ? path.map((a, j) => (j === path.length - 1 ? keepT(a, Object.assign({}, a, { patience: Math.max(a.patience || 0, pat0) })) : a)) : [{ until: R.slice(), patience: pat0 }];
        }
        else {
          // (Waited for; where his scene is past the rung, grabbed again.)
          const wait = { until: R.slice(), from: L.before(L.givers[i]) };
          const pat = Math.min(12000, 2 * L.ticks[i] + 120);
          if (pat > PATIENCE) wait.patience = pat;
          path = [...cpath, wait];
        }
        // (Its first rung keeps the grab's role: the steps made from it are
        // still RUNGS of it - Ryu's hold a, then hold a.)
        const role = i === 0 ? roleOf(c) : null;
        push(Object.assign({ group, label: last ? 'climax' : 'phase ' + (i + 1), kind: i === 0 ? c.kind : last ? 'climax' : 'phase', until: R, path },
          also.length ? { also } : {}, role ? { navRole: role, navSit: c.sit } : {}));
      });
      return true;
    };
    // A VARIABLE-DRIVEN ANIM HUB (VARIABLE ANIM HUBS in the header): per
    // version, position and speed, the variables SET once by the hook and his
    // animation the step's (`anim`); the climax the speed variable set to the
    // value only a command of his gives it.
    const pushVarHub = (c) => {
      const Vh = varHubOf(c);
      if (!Vh) return false;
      const until = c.until.slice();
      const nm = (P) => (P.cmd ? cmdInfo.get(P.cmd).words : 'the grab');
      const verCount = Vh.ver ? Vh.ver.values.length : 1;
      let pushed = 0;
      Vh.pos.forEach((P, pi) => {
        // (A version's climax drawn with the animation an earlier version's
        // already has at this position is that one: FutaNT's 70006 + position
        // in both tables, the +10000 one only below the climax.)
        const climaxSeen = new Set();
        for (let vi = 0; vi < verCount; vi++) {
          const vv = Vh.ver ? Vh.ver.values[vi] : null;
          const group = grp + ': position ' + (pi + 1) + ' (' + nm(P) + ')';
          const setupV = Vh.ver ? [{ kind: Vh.ver.kind, index: Vh.ver.index, value: vv, why: clean('holds his ' + Vh.ver.n + ' at ' + vv + ': his hub ' + Vh.H + ' draws its other animation table there (' + cmdInfo.get(Vh.ver.cmd).words + ' toggles it)') }] : [];
          const one = (label, sets, A, speed, climax, extraSetup, more) => {
            const setup = [...setupV, ...(extraSetup || [])];
            pushed++;
            push(Object.assign({ group, label, kind: climax ? 'climax' : speed === 1 ? 'position' : 'speed', until: until.slice(),
              path: [...c.path, { set: sets, until: until.slice(), anim: [A] }], reader: true, artKey: 'his anim ' + A, anims: [A, ...(more || [])],
              nav: { pos: group.replace(/ \([^)]*\)$/, ''), speed: climax ? null : speed, ver: vi, climax, stage: 0 } }, setup.length ? { setup } : {}));
          };
          Vh.speeds.forEach((sv, si) => {
            const A = Vh.anim(P.value, sv, vv);
            if (A === null) return;
            one('speed ' + (si + 1), [{ kind: Vh.p.kind, index: Vh.p.index, value: P.value }, { kind: Vh.s.kind, index: Vh.s.index, value: sv }], A, si + 1, false);
          });
          if (Vh.climax) {
            const A = Vh.anim(P.value, Vh.climax.value, vv);
            const seq = (Vh.climax.after || []).map((v) => Vh.anim(P.value, v, vv)).filter((x) => x !== null && x !== A);
            if (A !== null && !climaxSeen.has(A)) one('climax (' + cmdInfo.get(Vh.climax.cmd).words + ')', [{ kind: Vh.p.kind, index: Vh.p.index, value: P.value }, { kind: Vh.s.kind, index: Vh.s.index, value: Vh.climax.value }], A, null, true, Vh.climax.meter ? [Vh.climax.meter] : [], [...new Set(seq)]);
            if (A !== null) climaxSeen.add(A);
          }
        }
      });
      // (A hub none of whose animations he has makes no step: the walk's own
      // steps stay.)
      return pushed > 0;
    };
    // AN ANIM HUB: per position of his (the grab's own, then each one press
    // away) its base, its speeds (sustained) and its climax (the meter set
    // once at its idle); each action done when his animation shows too.
    const pushAnimHub = (c) => {
      const Hb = animHubOf(c);
      if (!Hb) return false;
      const until = Hb.keyed;
      const also = c.until.filter((C) => !until.includes(C));
      const words = (k) => cmdInfo.get(k).words;
      const held = (climax) => [
        ...(climax ? [] : Hb.meters.map((M) => ({ kind: M.kind, index: M.index, value: Hb.start.vars[M.n] || 0,
          why: clean('holds his ' + M.n + ' at ' + (Hb.start.vars[M.n] || 0) + ': his hub ' + Hb.H + ' climaxes on its own when it reaches ' + M.value) }))),
        ...Hb.counters.map((K) => ({ kind: K.kind, index: K.index, value: 0, why: clean('holds his ' + K.n + ' at 0: his hub ' + Hb.H + ' counts his climaxes in it') }))];
      Hb.pos.forEach((P, i) => {
        const group = Hb.pos.length > 1 ? grp + ': position ' + (i + 1) : grp;
        // (Everything a position plays, back at its idle by itself.)
        const loopOf = (Q) => [Q.s.anim, ...Q.speeds.map((x) => x.anim), ...(Q.climax ? [Q.climax.anim] : [])];
        const loop = loopOf(P);
        // (A press acts from a position it leads here from - once back at its
        // idle -, or waits here for this one's idle.)
        const pressFrom = P.press === null ? [] : sorted(new Set([...loop, ...Hb.pos.filter((Q) => Q !== P && (() => { const t = Hb.turn(Q, P.press); return t && !t.back && t.rest.anim === P.s.anim; })()).flatMap(loopOf)]));
        const lead = P.press === null ? c.path.slice() : [...c.path, { cmd: P.press, mode: 'press', until: until.slice(), anim: [P.s.anim], from: [Hb.H], fromAnim: pressFrom }];
        const one = (label, kind, path, anims, climax) => push(Object.assign({ group, label, kind, until: until.slice(), path, reader: true, artKey: 'his anim ' + anims[0], anims },
          also.length ? { also: also.slice() } : {}, held(climax).length ? { setup: held(climax) } : {}));
        // (The grab alone shows everything it did before, her way in too, and
        // is done at the grab's own idle: her state is the same in every
        // position, so reached in place from another position's loop he is
        // grabbed again - else it would show that position under its label.)
        if (P.press === null) {
          const gate = { anim: [P.s.anim], fromAnim: loop.slice() };
          const path = c.path.length ? c.path.map((a, j) => (j === c.path.length - 1 ? Object.assign({}, a, gate) : a)) : [Object.assign({ until: c.until.slice() }, gate)];
          push(Object.assign({ group, label: 'the grab', kind: 'own', until: c.until.slice(), path, reader: true, anims: [P.s.anim] }, held(false).length ? { setup: held(false) } : {}));
        } else one(words(P.press), 'position', lead, [P.s.anim], false);
        P.speeds.forEach((sp, j) => one('speed ' + (j + 1) + ' (' + words(sp.k).replace(/^press /, 'hold ') + ')', 'speed',
          [...lead, { cmd: sp.k, mode: 'sustain', until: until.slice(), anim: [sp.anim], from: [Hb.H], fromAnim: loop.slice() }], [sp.anim, P.s.anim], false));
        if (P.climax) {
          const M = P.climax.meter;
          one('climax', 'climax', [...lead, { until: until.slice(), anim: [P.s.anim], from: [Hb.H], fromAnim: loop.slice() },
            { set: [{ kind: M.kind, index: M.index, value: M.value }], until: until.slice(), anim: [P.climax.anim] }], [P.climax.anim], true);
        }
      });
      return true;
    };
    const firstStep = steps.length;
    for (const c of own) if (!pushVarHub(c) && !pushAnimHub(c) && !pushLadder(c)) pushWalk(c);
    const ownUntil = own.flatMap((c) => c.until);
    for (const c of rest) {
      if (c.sit.kind === 'own') continue;
      const fin = finisherOf(c);
      const gauge = fin ? null : gaugeOf(c, ownUntil);
      if (gauge) {
        // A GAUGE CLIMAX: the press shows its stroke alone, and the climax is
        // its own step - the gauge set once by the hook at the grab's hold.
        // ITS STROKES GO ON: the stroke is what a player keeps doing (each
        // one fills the gauge his hold climaxes on, and the hold lets her go
        // when idle: Murakami's 1000 on `Time > 60`), so its command is
        // SUSTAINED while the step is on screen, "hold a": the stroke comes
        // round again and again (the setup keeps the gauge from climaxing).
        // Pressed once, it played one stroke and his hold let her go a
        // second later (headless, 2026-10-08: on screen 45-60%).
        const cut = (list) => list.filter((C) => !gauge.until.includes(C));
        if (cut(c.until).length) pushWalk(Object.assign({}, c, { strokes: true, until: cut(c.until), path: c.path.map((a, i) => (i === c.path.length - 1 ? Object.assign({}, a, { until: cut(a.until) }, a.mode === 'press' ? { mode: 'sustain' } : {}) : a)) }), ownUntil);
        if (!gaugeDone.has(gauge.key)) {
          gaugeDone.add(gauge.key);
          push(Object.assign({ group: grp, label: cmdInfo.get(c.sit.T.k).words + ', gauge full', kind: 'climax', until: gauge.until.slice(), path: gauge.path }, gauge.also.length ? { also: gauge.also.slice() } : {},
            { navRole: { hub: gauge.H, role: 'climax' } }));
        }
        continue;
      }
      if (!fin) {
        if (!pushLadder(c)) pushWalk(c);
        // (Its hub's auto by set, once: autoOf.)
        const au = autoOf(c);
        if (au && !autoDone.has(au.key)) {
          autoDone.add(au.key);
          // (Not "auto" in its label: a label the nav reads would make the
          // whole grab one labeled position. The role says auto.)
          push(Object.assign({ group: grp, label: au.words + ', looping', kind: 'auto', until: c.until.slice(), path: au.path, artKey: 'auto ' + au.V }, { navRole: { hub: au.hub, role: 'auto' } }));
        }
        // (Its hub's climax by drain, once: drainOf.)
        const dr = drainOf(c, ownUntil);
        if (dr && !drainDone.has(dr.key)) {
          drainDone.add(dr.key);
          // (Named as the gauge climax is - "hold a, gauge empty" -: a label
          // that says climax would make the whole grab one labeled position.)
          push(Object.assign({ group: grp, label: dr.words + ', gauge empty', kind: 'climax', until: dr.until, path: dr.path, also: dr.also.slice() }, { navRole: { hub: dr.hub, role: 'climax' } }));
        }
        continue;
      }
      // The press itself shows the step before the count is reached (a
      // press, never mashed: each one counts toward the finisher).
      const cut = (list) => list.filter((C) => !fin.until.includes(C));
      // (Between two presses she is back in the grab's hold: on screen, so the
      // step is not replayed - each replay would count toward the finisher.)
      if (cut(c.until).length) pushWalk(Object.assign({}, c, { until: cut(c.until), path: c.path.map((a, i) => (i === c.path.length - 1 ? Object.assign({}, a, { until: cut(a.until) }, a.mode === 'mash' ? { mode: 'press' } : {}) : a)) }), ownUntil);
      // While the count builds up she is in the grab's hold and the press's
      // reaction (the chair's 1200 and 1220): the finisher step is on screen.
      const alsoF = sorted(new Set([...ownUntil, ...cut(c.until)].filter((C) => !fin.until.includes(C))));
      // (The finisher is the climax of the hub the press is made in.)
      const fh = homeOf(c.sit.parent);
      push(Object.assign({ group: grp, label: fin.label, kind: 'climax', until: fin.until, path: fin.path }, alsoF.length ? { also: alsoF } : {},
        fh !== null ? { navRole: { hub: fh, role: 'climax' } } : {}));
    }
    rungsOf(steps.slice(firstStep));
    for (const s of steps.slice(firstStep)) {
      delete s.navSit;
      if (s.navRole && s.navRole.role === 'end') delete s.navRole;
      if (s.navRole) s.navRole = Object.assign({ key: E + '|' + s.group + '|hub ' + s.navRole.hub }, s.navRole);
    }
    for (const s of ladderSteps) push(Object.assign({}, s, { group: pfx + s.name, label: s.label, reader: true }));
    for (const j of js) push({ group: grp, label: 'state ' + j.jump + ' (jump)', kind: 'jump', until: j.until, path: j.path });
  }

  // ---- his companion's steps (readCompanions) -------------------------------------
  // Grouped under the companion (the author's name for it with the Helper's:
  // "Striker Bao"), after his own. Each releases the gate for itself (the
  // value his own files spawn it with) and is entered through his stance (a
  // state of his: Lua changeState, as every grab), where the runtime waits for
  // the companion to stand in one of its idle states and holds its grab
  // command on it until she is in its scene:
  //   the grab of a family that lands in no position (Brian's intro 41399:
  //     her 41398, then what it goes on to by itself);
  //   position k: a family that lands there (the rapid grab's 22000: position
  //     3), else a fresh grab of the family that lands in the position set
  //     with no intro and his counter command pressed until it shows (Brian's
  //     b, in his stance only).
  // Her states per companion state as the walk reads them for her: the rapid
  // grab 21998 lets go at once of a partner with no anim 22001 (`var(57) =
  // Target,SelfAnimExist(22001)`), so for her only the intro's family is
  // left. The family is pinned by the hook on the companion, per step.
  // Several pairs: edge slots only (it spawns behind him and goes for the
  // nearest enemy), and with him facing the other pairs, so it spawns between
  // him and the screen edge.
  const joinWhy = new Map();
  for (const C of base.companions || []) {
    const WC = makeWalker(an, Object.assign({}, base.walkerOpts, { victimHas, relevantVars: null, sharedFlows: null, frozen: {}, memo: new WeakMap(), trigCache: new WeakMap(), boolValues: true }));
    WC.setPresent(null);
    const inSet = (n) => !!C.counter && C.counter.set.some(([a, b]) => n >= a && n <= b);
    const scene = (c) => hScenes.has(c) && !isRelease(c);
    // Where a state of its settles: through the ones it leaves at once.
    const settleC = (no) => {
      let cur = no;
      for (let hop = 0; hop < 4; hop++) {
        if (!states.has(cur)) return cur;
        const r = WC.runState(cur, {}, NO_INPUT, { passes: 1, fresh: true });
        if (!r.left || !r.next.length) return cur;
        cur = r.next[r.next.length - 1].no;
      }
      return cur;
    };
    // Her states in a companion state (its own TargetStates), and what its
    // machine goes on to by itself inside the position set (a position's
    // later phases by its meter: 22000 -> 22100 -> 22200 -> 22300). A grab's
    // first state is the grab's, never a position's own (51488 hands her back
    // to the intro 41398 at its climax's end).
    const grabFirst = new Set(C.families.map((f) => f.p2));
    const her = (P) => {
      const f = WC.flow([{ no: P, A: {}, prev: 0 }], NO_INPUT);
      const reach = new Set([P]);
      const q = [P];
      while (q.length) { const a = q.shift(); for (const b of (f.edges && f.edges.get(a)) || []) if (!reach.has(b) && inSet(b)) { reach.add(b); q.push(b); } }
      const own = [], also = [];
      for (const [c, from] of f.issued) {
        if (!scene(c)) continue;
        if (from.has(P) && !grabFirst.has(c)) own.push(c); else if ([...from].some((x) => reach.has(x))) also.push(c);
      }
      return { own: sorted(new Set(own)), also: sorted(new Set(also.filter((c) => !own.includes(c)))) };
    };
    const words = (k) => cmdInfo.get(k).words;
    // (With the gate, his copies of its art variants: its var(33) copied into
    // his var(23), which her 51409 reads for her art.)
    const setupC = [{ kind: C.gate.kind, index: C.gate.index, value: C.spawn.value,
      why: clean('lets his helper ' + C.id + ' spawn (' + C.gate.line + '; his state ' + C.spawn.state + ' sets ' + C.gate.name + ' = ' + C.spawn.value + ')') },
    ...(C.mirrors || []).map((m) => ({ kind: m.kind, index: m.index, value: m.value, art: true,
      why: clean('holds his ' + m.kind + '(' + m.index + ') at ' + m.value + ': his helper ' + C.id + ' copies its ' + m.of + ' into it, an art variant pinned on it') }))];
    const fams = [];
    for (const f of C.families) {
      const land = settleC(f.p1);
      // (Back in its idle states at once: the family lets her go.)
      if (C.grab.ready.includes(land) || isBasic(land)) continue;
      fams.push(Object.assign({}, f, { land }));
    }
    if (!fams.length) continue;
    // (Its pins: the family's, then its art variants - at 0, or the step's
    // variant - then, where its play is read (readCompanionPlay), a speed, its
    // meter - 0 but on a climax or a phase - and its return. `o`: { art, speed,
    // meter }.)
    const P = C.play || null;
    const artKey = (a) => a.kind + '(' + a.index + ')';
    const artPins = (vals) => (C.art || []).map((a) => Object.assign({}, a, vals && Object.prototype.hasOwnProperty.call(vals, artKey(a)) ? { value: vals[artKey(a)] } : {}));
    const playPins = (o) => (P ? [...(o.speed ? [o.speed] : []), { kind: P.meter.kind, index: P.meter.index, value: o.meter || 0, meter: true },
      ...(P.ret ? [{ kind: P.ret.kind, index: P.ret.index, value: P.ret.value }] : [])] : []);
    // (`o.hold`: the animation the hook holds it at in the position's state -
    // a speed, a climax picture - and the elements it skips the first tick of;
    // `o.art`: the step's art variant where her state reads his copy of it on
    // its first tick only, so the runtime grabs again rather than switch it in
    // place with her state unchanged.)
    const comp = (f, go, o) => Object.assign({ id: C.id, name: C.name, cmd: C.grab.cmd, ready: C.grab.ready.slice(),
      pins: [...(f.pin ? [Object.assign({}, f.pin)] : []), ...artPins(o && o.art), ...playPins(o || {})], behind: C.behind }, go ? { go } : {},
      o && o.hold ? { hold: { state: o.hold.state, anim: o.hold.anim, skip: (o.hold.skip || []).map((x) => x.slice()) } } : {},
      o && o.artEntry ? { art: o.artEntry } : {});
    // (Her states that read his copy of an art variant on their first tick
    // only - 51409-51412's `enemy,var(23)`: heldReads.)
    const mirrorNames = new Set((C.mirrors || []).map((m) => m.kind + '(' + m.index + ')'));
    const artEntryOf = (until, vals) => (mirrorNames.size && vals && until.some((x) => heldReads(base, x, mirrorNames))
      ? Object.keys(vals).sort().map((k) => k + '=' + vals[k]).join(',') : null);
    // THE STEP'S PLACE AMONG ITS POSITIONS (`nav`, GRAIL 4.10b): the position
    // (its counter's value; the grab and a join are positions of their own),
    // the speed (1..n in the order the step list has them; a ladder's rungs
    // below its climax; a climax's pictures when it has several), the art
    // version (the variant's index among the values its files draw), climax.
    const navOf = (pos, speed, ver, climax) => ({ pos: clean(C.group) + ' ' + pos, speed, ver: ver || 0, climax: !!climax, stage: 0 });
    // (His copies of its art variants at the step's variant: its var(33) = 1
    // is his var(23) = 1.)
    const setupFor = (vals) => setupC.map((x) => {
      const m = x.art ? (C.mirrors || []).find((q) => q.kind === x.kind && q.index === x.index) : null;
      const v = m && vals && Object.prototype.hasOwnProperty.call(vals, m.of) ? vals[m.of] : x.value;
      return v === x.value ? Object.assign({}, x) : Object.assign({}, x, { value: v, why: clean('holds his ' + x.kind + '(' + x.index + ') at ' + v + ': his helper ' + C.id + ' copies its ' + m.of + ' into it, the art variant this step pins on it') });
    });
    const pushC = (st) => steps.push(Object.assign({ entry: C.stance, group: clean(C.group), kind: 'companion' }, st,
      { label: clean(st.label), setup: setupFor(st.variant), edgeOnly: true }));
    // (Her climax states, any position and variant: never on a step's way
    // but a climax's own.)
    const climaxHer = new Set();
    if (P) for (const [, x] of P.pos) {
      for (const v of x.variants) if (v.climax) for (const c of v.climax.allHer) climaxHer.add(c);
      for (const r of x.ladder || []) if (r.climax) for (const c of r.her) climaxHer.add(c);
    }
    const lands = new Map();
    for (const f of fams) {
      if (inSet(f.land)) { if (!lands.has(f.land)) lands.set(f.land, f); continue; }
      const h = her(f.land);
      const first = [f.p2].filter(scene);
      const until = first.length ? first : h.own.filter((c) => !climaxHer.has(c));
      if (!until.length) continue;
      const also = sorted(new Set([...h.own, ...h.also].filter((c) => !until.includes(c) && !climaxHer.has(c))));
      pushC({ label: 'the grab (' + words(C.grab.cmd) + ')', until, also, path: [], companion: comp(f, null, {}), artKey: 'grab ' + f.p1, nav: navOf('grab', null, 0, false) });
    }
    // A state of hers that checks her own art and throws her out without it
    // (Bao's 22001: `var(57) = SelfAnimExist(22001)` on its first tick, then
    // ChangeState 16302 on `var(57) = 0`): a position that puts her there
    // rejects a partner who lacks it (Kotaro, with no anim 22001, is thrown
    // out at 3). A position after it stays out for her too, though the hook
    // sets it without passing 3: its verdict rests on a probe of 51488/51409
    // she ships (1801131) that the state only tests, never plays, and
    // Kotaro's 51409 drew Bao alone (headless). Miyako's drew her legs; the
    // bench would have to learn that probe before either is listed.
    const rejects = (X) => {
      const st = states.get(X);
      if (!st || !victimHas) return false;
      for (const sc of st.sctrls) {
        if (sc.type !== 'varset') continue;
        for (const [nm, raw] of WC.writesOf(sc)) {
          const m = /^\s*selfanimexist\s*\(\s*(\d+)\s*\)\s*$/i.exec(String(raw));
          if (!m) continue;
          const zero = new RegExp('^\\s*' + nm.replace(/[()]/g, (c) => '\\' + c) + '\\s*=\\s*0\\s*$', 'i');
          const out = st.sctrls.some((c) => c.type === 'changestate' && S.lit(c.params.get('value')) !== X && [...c.trig.all, ...c.trig.groups.flat()].some((e) => zero.test(String(e))));
          if (out && !victimHas.has(+m[1])) return true;
        }
      }
      return false;
    };
    const blocked = new Set(C.positions.filter((p) => her(p.state).own.some(rejects)).map((p) => p.k));
    // A position that may hand her on to another position on its first tick
    // is reached only where that exit is certainly shut for her: 51488 goes
    // back to 41401 at Time = 0 unless she ships one of the anims it probes
    // (one of them computed, `stateno+228812`, which no reading can answer),
    // and the counter's line puts him in 51488 again every tick - Mai, who
    // ships none of them, bounced between the two and never showed 51409.
    const bounces = (p) => {
      const r = WC.runState(p.state, {}, NO_INPUT, { passes: 1, fresh: true });
      return r.next.some((x) => inSet(x.no) && !(p.home || [[p.state, p.state]]).some(([a, b]) => x.no >= a && x.no <= b));
    };
    // POSITION k, SET BY THE HOOK: its counter to k and the companion into
    // the position's state (a selfState in its -4, before its own lines run),
    // while it holds her in one of the states the counter's line names and is
    // not already at home there. A player's b counts 1, 2, 3, 4, 0 from where
    // it is, through every position between (her 22001 at 3 throws out a
    // partner lacking it, and Mai's is her HUD); and the line into 51488 draws
    // var(33) = random%2 on the very tick it enters, before any pin of the
    // hook's can hold it. The path waits for her states. The label says the
    // player's way there.
    const lead = fams.find((f) => inSet(f.land)) || fams[0];
    // An art variant her files shut for her: a VarSet of the variable (or a
    // ParentVarSet of his copy of it) to another value in the position's
    // state, on a trigger certainly true for her (51488's `var(33) = 0` for a
    // partner who ships 280121 and 100541 but none of 1801131, 280221, 10531).
    const mirrorOf = (n) => { const m = (C.mirrors || []).find((q) => q.kind + '(' + q.index + ')' === n); return m ? m.of : null; };
    const shut = (no, vals) => {
      if (!victimHas || !states.has(no)) return false;
      for (const sc of states.get(no).sctrls) {
        if (sc.type !== 'varset' && sc.type !== 'parentvarset') continue;
        for (const [nm, raw] of WC.writesOf(sc)) {
          const key = sc.type === 'varset' ? nm.toLowerCase() : mirrorOf(nm.toLowerCase());
          const x = S.lit(raw);
          if (!key || !Object.prototype.hasOwnProperty.call(vals, key) || x === null || x === vals[key]) continue;
          if (X.evalTriggerSet(stateTrig(sc.trig, no), { victimHas, isHelper: true }) === true) return true;
        }
      }
      return false;
    };
    // POSITION k, SET BY THE HOOK: its counter to k and the companion into
    // the position's state (a selfState in its -4, before its own lines run),
    // while it holds her in one of the states the counter's line names and is
    // not already at home there; the path waits for her states. Never b
    // pressed from where it is: b counts 1, 2, 3, 4, 0 through every position
    // between (her 22001 at 3 throws out a partner lacking it, and Mai's is
    // her HUD), and the line into 51488 draws var(33) = random%2 on the very
    // tick it enters, before any pin of the hook's can hold it. The hook never
    // passes a position on its way to another, so one that throws her out
    // keeps no other from her. With its play read, a position is a step per
    // speed (its speed variable pinned) and a climax (its meter pinned one
    // past its top), per art variant her files leave open (each variant's
    // copy held on him in the step's setup); a ladder a step per rung, each
    // at home in its own rung - the hook climbs it from the position's state
    // on the meter, and goes back down the same way. Every other step holds
    // the meter at 0. Its labels say "pos k": the overlay's line is 51
    // characters with the scene number and the verdict, and "position 2
    // upright, speed 1" lost its speed there.
    const nameOf = (vals) => Object.keys(vals || {}).sort().map((v) => {
      const names = COMPANION_ART_NAMES[C.id] && COMPANION_ART_NAMES[C.id][v];
      return names && names[vals[v]] ? names[vals[v]] : 'art ' + (vals[v] + 1);
    }).join(' ');
    const goFor = (p, home) => ({ kind: C.counter.kind, index: C.counter.index, value: p.k, state: p.state, in: C.counter.set.map((r) => r.slice()), home: home.map((r) => r.slice()) });
    const keep = (list, h) => list.filter((c) => scene(c) && (h.own.includes(c) || h.also.includes(c)));
    for (const p of C.positions) {
      const h = her(p.state);
      if (!h.own.length || blocked.has(p.k) || bounces(p)) continue;
      const x = P ? P.pos.get(p.k) : null;
      const home = p.home || [[p.state, p.state]];
      if (!x || (!x.ladder && !x.variants.length)) {
        const direct = lands.get(p.state);
        if (direct && !P) { pushC({ label: 'position ' + p.k + ' (' + words(C.grab.cmd) + ')', until: h.own, also: h.also, path: [], companion: comp(direct), nav: navOf(p.k, null, 0, false) }); continue; }
        const until = h.own.filter((c) => !climaxHer.has(c));
        if (!until.length) continue;
        pushC({ label: 'position ' + p.k + ' (' + words(C.counter.cmd) + ')', until, also: h.also.filter((c) => !climaxHer.has(c)),
          path: [{ until: until.slice() }], companion: comp(lead, goFor(p, home), {}), artKey: 'position ' + p.k, nav: navOf(p.k, null, 0, false) });
        continue;
      }
      if (x.ladder) {
        const passed = [];
        x.ladder.forEach((r, i) => {
          const until = keep(r.her, h);
          if (until.length) {
            const also = r.climax ? [...new Set([...passed, ...h.own, ...h.also])].filter((c) => !until.includes(c) && scene(c)) : passed.filter((c) => !until.includes(c));
            pushC({ label: 'pos ' + p.k + (r.climax ? ', climax' : ', phase ' + (i + 1)), until, also: sorted(new Set(also)),
              path: [{ until: until.slice() }], companion: comp(lead, goFor(p, [[r.state, r.state]]), { meter: r.pin }), artKey: 'rung ' + r.state,
              nav: navOf(p.k, r.climax ? null : i + 1, 0, r.climax) });
          }
          for (const c of r.her) if (!passed.includes(c)) passed.push(c);
        });
        continue;
      }
      // (What the position gives her beside its speeds and climaxes - her
      // 41401 at a climax's end, the intro 41398 after 51488's - is on its
      // steps' way.)
      const keyed = new Set(x.variants.flatMap((v) => [...v.plain.her, ...(v.climax ? v.climax.allHer : [])]));
      const alsoH = sorted(new Set([...h.own, ...h.also].filter((c) => !climaxHer.has(c) && !keyed.has(c) && scene(c))));
      for (const v of x.variants) {
        if (shut(p.state, v.art)) continue;
        const vn = nameOf(v.art);
        const at = 'pos ' + p.k + (vn ? ' ' + vn : '');
        const ver = x.variants.indexOf(v);
        // (Every speed and climax picture is held by the hook at its own
        // animation: no flash of another at a loop's end, and a step moved to
        // in place - out of a climax too - shows at once.)
        const holdAt = (A, skip) => ({ state: p.state, anim: A, skip });
        if (v.speeds.length) {
          let n = 0;
          v.speeds.forEach((sp) => {
            const until = keep(sp.her, h);
            if (!until.length) return;
            n++;
            pushC({ label: at + ', speed ' + n, until, also: alsoH.filter((c) => !until.includes(c)), path: [{ until: until.slice() }], variant: v.art,
              companion: comp(lead, goFor(p, home), { art: v.art, speed: sp.v === null ? null : { kind: varRef(x.hold).kind, index: varRef(x.hold).index, value: sp.v },
                hold: holdAt(sp.anim, sp.skip), artEntry: artEntryOf(until, v.art) }), artKey: 'anim ' + sp.anim, nav: navOf(p.k, n, ver, false) });
          });
        } else {
          const until = keep(v.plain.her, h);
          if (until.length) pushC({ label: at + ' (' + words(C.counter.cmd) + ')', until, also: alsoH.filter((c) => !until.includes(c)),
            path: [{ until: until.slice() }], variant: v.art, companion: comp(lead, goFor(p, home), { art: v.art, artEntry: artEntryOf(until, v.art) }), artKey: 'anims ' + v.plain.anims.join(','),
            nav: navOf(p.k, null, ver, false) });
        }
        if (v.climax) {
          const until = keep(v.climax.her, h);
          const plain = keep(v.plain.her, h);
          // (A meter line of hers alone, by her name: Makoto's 473114, which
          // holds its animation - her climax is that one only.)
          const byName = v.climax.byName.map((b) => ({ name: b.name, holds: b.holds, until: keep(b.her, h), artKey: 'climax ' + b.anims.join(','),
            hold: b.holds && b.anims.length === 1 ? holdAt(b.anims[0], []) : null })).filter((b) => b.until.length);
          const also0 = [...new Set([...plain, ...alsoH])];
          // ITS PICTURES, each a step of its own where it has several (41488's
          // 464004 and 464005, her 41412 and 41413), the hook holding one.
          const pics = (v.climax.pictures || []).map((q) => Object.assign({}, q, { until: keep(q.her, h) })).filter((q) => q.until.length);
          if (pics.length > 1) {
            pics.forEach((q, i) => {
              const others = pics.filter((o) => o !== q).flatMap((o) => o.until);
              pushC({ label: at + ', climax ' + (i + 1), baseLabel: at + ', climax', climaxHer: v.climax.her.slice(), until: q.until, also: [...new Set([...also0, ...others])].filter((c) => !q.until.includes(c)).sort((a, b) => a - b),
                path: [{ until: q.until.slice() }], variant: v.art, companion: comp(lead, goFor(p, home), { art: v.art, meter: v.climax.pin, hold: holdAt(q.anim, q.skip), artEntry: artEntryOf(q.until, v.art) }),
                artKey: 'climax ' + q.anim, byName, nav: navOf(p.k, i + 1, ver, true) });
            });
          } else if (until.length || byName.length) {
            const one = pics.length === 1 ? pics[0] : null;
            pushC({ label: at + ', climax', until: until.length ? until : byName[0].until, also: also0.filter((c) => !until.includes(c)).sort((a, b) => a - b),
              path: [{ until: (until.length ? until : byName[0].until).slice() }], variant: v.art,
              companion: comp(lead, goFor(p, home), { art: v.art, meter: v.climax.pin, hold: one ? holdAt(one.anim, one.skip) : null, artEntry: artEntryOf(until.length ? until : byName[0].until, v.art) }),
              artKey: 'climax ' + v.climax.anims.join(','), byName, nav: navOf(p.k, null, ver, true) });
          }
        }
      }
    }
    // ITS JOINS (readCompanions: his threesome), after its positions: his
    // command pressed in his stance until her state shows, from the grab that
    // lands in a position (it acts from any of them; the intro's family
    // waits it out). A partner the join's probe shuts gets none, and the
    // scene says why (`joinWhy`).
    for (const j of C.joins || []) {
      const until = j.her.filter(scene);
      if (!until.length) continue;
      // (Her probes answered first: the evaluator reads `ifelse(target,
      // selfanimexist(69229),1,0)`'s redirect comma as an argument's.)
      const probed = (t) => t.replace(new RegExp(PROBE_ANY.source, 'gi'), (m0, n) => (victimHas.has(+n) ? '1' : '0'));
      const shutBy = victimHas ? j.gates.filter((g) => { let v = null; try { v = X.evalExpr(probed(g.value), {}); } catch (e) { v = null; } return v !== null && v !== g.want; }) : [];
      if (shutBy.length) {
        const need = [...new Set(shutBy.flatMap((g) => g.probes))].sort((a, b) => a - b);
        for (const c of until) joinWhy.set(c, 'needs her action' + (need.length > 1 ? 's ' : ' ') + need.join(', '));
        continue;
      }
      pushC({ label: 'threesome (' + words(j.cmd) + ')', until, also: [], path: [{ cmd: j.cmd, mode: 'press', from: [C.stance], until: until.slice(), patience: 300 }],
        companion: comp(lead, null, {}), artKey: 'join ' + j.his, nav: navOf('threesome', null, 0, false) });
    }
  }

  // What no step reaches, and why.
  const listed = new Set(steps.flatMap((s) => [...s.until, ...(s.also || [])]));
  // Where the setup's gates would have sent him and her.
  const gateTargets = new Set();
  for (const sc of base.offCtrls) for (const v of W.values(sc.params.get('value'), {}, sc.state)) gateTargets.add(v);
  const unreachable = [];
  for (const C of sorted(hScenes)) {
    if (listed.has(C)) continue;
    const sc = an.scenes.get(C);
    const issuers = an.edges.filter((e) => e.to === C && (e.kind === 'targetstate' || e.kind === 'hitdef')).map((e) => e.from);
    let why = 'no path the gallery takes reaches it';
    const note = notes.find((x) => x.scenes.includes(C));
    const into = an.edges.filter((e) => e.to === C && e.trig && (e.kind === 'targetstate' || e.kind === 'hitdef'));
    const text = (e) => [...e.trig.all, ...e.trig.groups.flat()].join(' ');
    if (sc && sc.release) why = 'a release';
    else if (joinWhy.has(C)) why = joinWhy.get(C);
    else if (base.broken.has(C)) why = 'it changes her into state ' + base.broken.get(C) + ', which his files never define (the engine leaves her in an empty state)';
    else if (issuers.length && issuers.every((f) => !root.has(f) || (f >= 170 && f <= 199))) {
      if (issuers.some((f) => base.helperReach.has(f))) why = 'issued by a helper';
      else if (issuers.some((f) => f < 0 || (f >= 170 && f <= 199))) why = 'post-KO / win';
      else why = 'dead code';
    } else if (gateTargets.has(C) || (issuers.length && issuers.every((f) => gateTargets.has(f)))) {
      why = 'the failure branch the setup keeps shut';
    } else if (issuers.length && issuers.every((f) => f < 0)) {
      // (Kept off on purpose when its condition is a meter the setup holds:
      // Brian's orgasm 6600 on fvar(39) = 48.)
      const held = Object.keys(base.frozen).filter((v) => into.some((e) => [...e.trig.all, ...e.trig.groups.flat()].some((x) => X.varsOf(String(x)).includes(v))));
      why = held.length ? 'kept off by the setup (' + held.join(', ') + '): his state ' + [...new Set(issuers)].join('/') + ' would put her there from any step'
        : 'issued by his state ' + [...new Set(issuers)].join('/') + ' on its own condition (a meter or timer), not by a path';
    } else if (into.length && into.every((e) => W.trig({ trig: e.trig }, A0, null, e.from) === false)) {
      why = into.some((e) => /\b(alive|life|roundstate|matchover|win|lose)\b/i.test(text(e))) ? 'waits for her KO or the round to end' : 'its trigger never holds for the gallery\'s pair';
    } else if (note) why = note.why;
    unreachable.push({ state: C, why: why.replace(/[^\x20-\x7e]/g, '?') });
  }
  W.setPresent(null);
  const res = { steps, entries: [...new Set(steps.filter((s) => s.kind !== 'companion').map((s) => s.entry))], unreachable, notes, setup: base.setup, ms: Date.now() - t0 };
  if (victimHas) base.walkList.push({ asked: victimHas.asked, res }); else base.walks.set('?', res);
  return res;
}

// One giver, read on his own (opts.victimHas: a partner's actions).
function describeGiver(dir, def, opts) {
  const base = giverBase(dir, def);
  const walk = giverSteps(base, opts && opts.victimHas instanceof Set ? opts.victimHas : null);
  return Object.assign({}, base, walk, { ms: base.baseMs + walk.ms });
}

// ---- the receiver, once per build ---------------------------------------------
// What a giver-receiver's -2 may not do while he is in another giver's scene.
const IN_SCENE_ACTS = new Set(['helper', 'changestate', 'selfstate', 'targetstate', 'hitdef', 'projectile', 'pause', 'superpause', 'explod',
  'changeanim', 'changeanim2', 'posset', 'posadd', 'velset', 'veladd', 'targetbind', 'bindtotarget']);
function describeReceiver(dir, def, sig) {
  return cachedIn(CACHE.receivers, dir + '|' + def, sig || fileSig(dir, def), () => describeReceiverFresh(dir, def), () => { stat.receivers++; });
}
function describeReceiverFresh(dir, def) {
  const rh = modlib.hScan(dir, def);
  const rf = modlib.defFiles(dir, def);
  const rAir = readAirFrames(rf.anim);
  const rSff = rf.sprite ? modlib.sffSpriteKeys(rf.sprite) : null;
  let standIns = new Set();
  try {
    const fx = require('./futafix.js').repairFor(dir, def);
    if (fx) standIns = new Set(fx.aliases.map((a) => a.key));
  } catch (e) { /* not repairable: her file is what ships */ }
  const info = readInfo(dir, def);
  // A GIVER WHO IS NO RECEIVER answers another giver's demands from his own
  // table, and most of what it has there is his own giver art: DongHwan's
  // hub overlay 42249 draws group 4251 (an explod of his 6001), Brian's 27230
  // group 27230, Minotaur's 36699 group 6699. One of his actions counts as
  // her answer only where its frames draw a sprite group inside the receiver
  // windows that his .sff actually has (Kur0maru's 17231-17234 on the
  // Kuromaru-template woman 17230), and none of its frames is H art outside
  // those windows: an action that mixes a window group with his own giver
  // scene art is none (Brian's 69280-69581 draw his 16520 and 16011/16181
  // beside it). A frame of an ordinary group may lead in (kuromaru_girl_plus's
  // 15600 starts on her own win pose 182 and goes on to her Kuromaru pose
  // 15600). Missing window frames are judged as for anyone (partial). His
  // fallback art (the other giver's ChangeAnim2 on his sprites) is too.
  let answers = null;
  if (rh.giver && !rh.receiver) {
    answers = new Set();
    const inWindow = (g) => REGISTRY.some(([a, b]) => g >= a && g <= b);
    for (const [n, fr] of rAir) {
      const drawn = [...fr].map((k) => ({ k, g: +String(k).split(',')[0] })).filter((x) => x.g !== 99999);
      if (rSff && drawn.some((x) => inWindow(x.g) && rSff.has(x.k)) && !drawn.some((x) => !inWindow(x.g) && isHGroup(x.g))) answers.add(n);
    }
  }
  let parsed = null;
  try { parsed = S.parseStates(S.stateFiles(dir, def, (rel) => modlib.resolveCI(dir, rel)), {}); } catch (e) { parsed = null; }
  // And what of his own would act while he is in the other giver's scene:
  // his -2 runs whoever's state he is in (char.go actionRun; -3 and -1 only
  // in his own), so a -2 that spawns a helper, changes state or puts anyone
  // in a state (Brian's Striker, his slow-motion stun) would act during it,
  // and so would one that stops time, draws, moves him, binds anyone or
  // hides him (a Pause or SuperPause, an Explod, a ChangeAnim, a PosSet,
  // PosAdd, VelSet or VelAdd, a TargetBind or BindToTarget, an AssertSpecial
  // of `invisible`: DongHwan's -2 has a SuperPause and three Explods) - each
  // unless its trigger is certainly false. Kur0maru's -2 only removes an
  // explod, stops his own sound channel 3, sets a variable and his defense.
  let actsInScene = null;
  if (answers) {
    const neg2 = parsed && parsed.states.get(-2);
    const acting = (sc) => IN_SCENE_ACTS.has(sc.type)
      || (sc.type === 'assertspecial' && [...sc.params].some(([k, v]) => /^flag\d?$/.test(k) && /\binvisible\b/i.test(String(v))));
    actsInScene = neg2 ? neg2.sctrls.filter((sc) => acting(sc)
      && (() => { try { return X.evalTriggerSet(sc.trig, { isHelper: false }) !== false; } catch (e) { return true; } })()).map((sc) => sc.type) : [];
  }
  // An assist helper of hers that is a receiver of its own (HELPER_RECEIVERS).
  const helpers = helperReceivers(dir, def, parsed, rf.anim, info, rh.airActions);
  // (Her standing body, for a grab's reach: GRAB REACH; and the action she is
  // held on in the air for an anti-air grab, with its body: AN ANTI-AIR GRAB.)
  let body = null, liftBody = null;
  try { body = galreach ? galreach.bodyOf(dir, def) : null; } catch (e) { body = null; }
  try { liftBody = galreach && galreach.liftBodyOf ? galreach.liftBodyOf(dir, def, rSff ? (k) => rSff.has(k) : null) : null; } catch (e) { liftBody = null; }
  return { body, liftBody, airActions: rh.airActions, rAir, rAirTicks: readAirTicks(rf.anim), rSff, sprite: rf.sprite || null, standIns, answers, actsInScene, effects: receiverEffects(parsed), hud: receiverHud(parsed, rAir), isGiver: rh.giver, isReceiver: rh.receiver, name: info ? info.name : null, helpers, stance: rf.anim ? restStance(rf.anim, rSff) : null, poseGroups: herPoseGroups(rAir) };
}

// HER POSE SPRITES (2026-10-08): a sprite group of hers outside the H windows
// and MUGEN's standard numbers (0-5999: her basic states, her moves, her
// get-hit) that an action of hers in the H windows draws, and none of her
// actions numbered 0-5999, is a pose of her H art: his fallback that draws it
// on her shows a scene (renders, partial), not her ordinary body
// (getHitOnly). Murakami's demon on a receiver without his 17850 art plays
// his 3606 / 3608, her 9005 - the upside-down pose Mai, Kung Fu Girl Z,
// R.Mika and Yoko each draw in H actions of their own (Mai's 17850 and
// 36221, Kung Fu Girl Z's 17860 and 109005, R.Mika's 36255, Yoko's 36646),
// and the owner played it on Kung Fu Girl Z in a fight. Her get-hit sprites stay ordinary even where an H
// action of hers reuses one (Mai's 5040 in a Minotaur action).
function herPoseGroups(rAir) {
  const h = new Set(), ordinary = new Set();
  for (const [n, fr] of rAir || []) {
    const into = modlib.hFamily(n) !== 'other' ? h : (n >= 0 && n <= 5999 ? ordinary : null);
    if (!into) continue;
    for (const k of fr) { const g = +String(k).split(',')[0]; if (g >= 6000 && !isHGroup(g)) into.add(g); }
  }
  return new Set([...h].filter((g) => !ordinary.has(g)));
}

// A RECEIVER WITH NO BODY AT REST: her standing animation (0) draws nothing or
// carries no hurtbox, so no grab takes her where the gallery stands her.
// Murakami Ryona Mob's 0 is one blank frame (his crowd is drawn by helpers of
// his) and his state 0 is NotHitBy every throw besides; his body shows only in
// his moves and his get-hit animations. The gallery holds such a receiver in
// a stance of its own instead (data/hgallery.zss) on her stand get-hit
// animation: her body as a hit shows it, with its hurtbox. Null: she stands
// in her own state 0 as everyone does.
function restStance(animFile, rSff) {
  let text;
  try { text = fs.readFileSync(animFile, 'latin1'); } catch (e) { return null; }
  const acts = airHurt(text);
  const rest = acts.get(0);
  if (rest && rest.draws && rest.hurt) return null;
  for (const n of [5000, 5010, 5001, 5011]) {
    const a = acts.get(n);
    if (a && a.hurt && a.keys.some((k) => !rSff || rSff.has(k))) return { anim: n };
  }
  return null;
}
// action -> { draws, hurt, keys }: whether a frame draws a sprite (group 0
// up), whether a drawn frame carries a Clsn2 box (its own `Clsn2: n` line or
// the action's Clsn2Default), and the frames' 'group,index'. The first
// definition of a number wins, as in the engine.
function airHurt(text) {
  const out = new Map();
  let cur = null, dflt = false, next = false;
  for (const raw of String(text || '').split(/\r?\n/)) {
    const l = raw.replace(/;.*$/, '').trim();
    const b = /^\[begin action\s+(-?\d+)\]/i.exec(l);
    if (b) { cur = out.has(+b[1]) ? null : { draws: false, hurt: false, keys: [] }; if (cur) out.set(+b[1], cur); dflt = false; next = false; continue; }
    if (!cur) continue;
    let m;
    if ((m = /^clsn2default\s*:\s*(\d+)/i.exec(l))) { dflt = +m[1] > 0; continue; }
    if ((m = /^clsn2\s*:\s*(\d+)/i.exec(l))) { next = +m[1] > 0; continue; }
    if ((m = /^(-?\d+)\s*,\s*(-?\d+)\s*,/.exec(l))) {
      if (+m[1] >= 0) { cur.draws = true; cur.keys.push(m[1] + ',' + m[2]); if (dflt || next) cur.hurt = true; }
      next = false;
    }
  }
  return out;
}
// HER HIT SPARKS: actions of her own table that her own HitDefs, ReversalDefs
// and Projectiles draw as a hit spark (sparkno / guard.sparkno = sN: the S
// prefix is her own .air) and that her states never play as a pose (a
// statedef anim, a ChangeAnim/ChangeAnim2 value). Kotaro's 10050 and 10051
// are her hit sparks (kotaro.cns sparkno = s10050+var(17)*5, s10051+...): a
// giver whose state asks SelfAnimExist(10050) of her (Kur0maru's hanging
// 82140/82141/82143, his Whip pose) plays a spark in her place, not her.
// Explods are not read: an explod of an action is no proof it is not her
// body (Cynthia's 15600, the FIRST of two definitions and the one the engine
// keeps, is her Kuromaru pose on 19230; her super explods it as a tile).
function receiverEffects(parsed) {
  const out = new Set();
  if (!parsed) return out;
  const poses = new Set();
  const lead = (raw, prefix) => {
    const m = new RegExp('^\\s*' + prefix + '\\s*(\\d+)', 'i').exec(String(raw === undefined ? '' : raw));
    return m ? parseInt(m[1], 10) : null;
  };
  for (const s of parsed.states.values()) {
    const a = S.lit(s.anim);
    if (a !== null) poses.add(a);
    for (const sc of s.sctrls) {
      if (sc.type === 'changeanim' || sc.type === 'changeanim2') { const v = S.lit(sc.params.get('value')); if (v !== null) poses.add(v); continue; }
      const keys = sc.type === 'hitdef' || sc.type === 'reversaldef' || sc.type === 'projectile' ? [['sparkno', 's'], ['guard.sparkno', 's']] : [];
      for (const [k, prefix] of keys) {
        const n = lead(sc.params.get(k), prefix);
        if (n !== null) out.add(n);
      }
    }
  }
  for (const n of poses) out.delete(n);
  return out;
}
// HER HUD: an action her own Explods hold on the screen (`postype = left` /
// `right` / `front` / `back`, the screen's edges, never on a player), that
// her states never play as a pose and whose frames draw nothing inside the
// receiver windows. Mai's 22001, `anim = Ifelse((Root,var(43)),27001,22001)`
// at `postype = Left` in her Cvs2_system.cns, is her CvS groove label:
// Brian's Striker Bao put her in his 22001 and she was drawn as "A-GROOVE"
// under his feet. It is no answer ONLY in a companion's scenes (G.
// companionScenes): read everywhere, even held to the screen, it changed
// pairs of other builds (33 of 3831 in one, 27 of 8071 in another: a grope
// stage 6200 on a Makoto whose 6200 is a HUD explod too) - the owner's call,
// not this fix's.
// An Explod that can fire only once the round is over (RoundState = 4,
// MatchOver, Win or Lose in every way its triggers can hold) never fires in
// the gallery, whose round never ends: it is no HUD there (Kung Fu Girl's
// lose picture 22201, `postype = left` on `RoundState = 4` and `Lose && ...
// && matchover`; Brian's Striker puts her in his 22201 and she is drawn).
const ROUND_END = { roundstate: '2', matchover: '0', win: '0', winko: '0', wintime: '0', winperfect: '0', lose: '0', loseko: '0', losetime: '0' };
function endOnly(trig) {
  const fix = (e) => String(e).split('"').map((part, i) => (i % 2 ? part : part.replace(/\b(roundstate|matchover|winko|wintime|winperfect|win|loseko|losetime|lose)\b/gi, (w) => ROUND_END[w.toLowerCase()]))).join('"');
  try { return X.evalTriggerSet({ all: trig.all.map(fix), groups: trig.groups.map((g) => g.map(fix)) }, {}) === false; } catch (e) { return false; }
}
const HUD_POSTYPES = new Set(['left', 'right', 'front', 'back']);
function receiverHud(parsed, rAir) {
  const out = new Set();
  if (!parsed || !rAir) return out;
  const poses = new Set();
  const inWindow = (g) => REGISTRY.some(([a, b]) => g >= a && g <= b);
  for (const s of parsed.states.values()) {
    const a = S.lit(s.anim);
    if (a !== null) poses.add(a);
    for (const sc of s.sctrls) {
      if (sc.type === 'changeanim' || sc.type === 'changeanim2') { const v = S.lit(sc.params.get('value')); if (v !== null) poses.add(v); continue; }
      if (sc.type !== 'explod') continue;
      const pt = String(sc.params.get('postype') === undefined ? 'p1' : sc.params.get('postype')).replace(/\s+/g, '').toLowerCase();
      if (!HUD_POSTYPES.has(pt) || endOnly(sc.trig)) continue;
      const raw = String(sc.params.get('anim') === undefined ? '' : sc.params.get('anim')).trim();
      if (!raw || /^[fs]\s*\d/i.test(raw)) continue;
      let leaves = [];
      try { leaves = S.lit(raw) !== null ? [S.lit(raw)] : X.leavesOf(raw); } catch (e) { leaves = []; }
      for (const n of leaves) {
        const fr = rAir.get(n);
        if (fr && fr.size && ![...fr].some((k) => inWindow(+String(k).split(',')[0]))) out.add(n);
      }
    }
  }
  for (const n of poses) out.delete(n);
  return out;
}

// ---- a receiver's helper, a receiver of its own ------------------------------------
// An ASSIST HELPER whose author drew her own scene art beside her root's and
// sends a giver's numbers to it for that helper alone: Dr. Kira's Chichi,
// helper 2017851216. A helper shares her root's animation table (char.go
// selfAnimExist: c.gi() is the root's), so a giver's probe asks the ROOT and
// a truthful "yes" plays the root's art on her body - spawned at
// size.xscale 1 against Kira's [Size] 0.5, a double-size Kira (GRAIL 4.5).
// What makes her a receiver is a [Statedef +1] of the root's, which the
// engine runs after the state with no gate (char.go actionRun, internal
// state -10), whose ChangeAnims, gated on IsHelper(<id>), turn the numbers a
// giver plays on her into her own art (the Baomaru-to-MvS bridge in Kira's
// k-2.cns). DECLARED here by the helper's id and her name - one such helper
// exists in any build he has - and read from the root's files for the rest:
//   the SPAWN: a Helper of that id in the root's negative states that one
//     command of the root's spawns with nothing else asked (`Command =
//     "summontagA"` beside `!NumHelper(id)`: the two summons that want power
//     and a variable are not the gallery's to make), its stateno and size;
//   her STATES: the ones her spawn state leads to by its ChangeStates; READY,
//     the ones she stands still in (no VelSet, VelAdd or PosAdd along x, no
//     DestroySelf) on an animation with a Clsn2: her taunts 14195, 14186,
//     14187 and 14182 (she runs in, 79995, and out, 14100, which destroys her
//     at time 75: about 3.5-4.5 s alive in all);
//   her IMMUNITY, per giver: the NotHitBy of her states (value, slot 0, time
//     320000: it holds for her whole life) whose trigger fires against him
//     (her badge check `Enemy,AnimExist(125234)` reads his .air): `,NT,ST,HT`
//     against every giver without the badge - a throw never catches her, a
//     grab that hits as an attack does (DongHwan's 4501, attr S,NA);
//   her BADGE: the number both halves of that check name, `Enemy,NumExplod(N)
//     && Enemy,AnimExist(N)` (an explod he carries and an action of his: Drunk
//     Samurai spawns explod 125234 in his grab and his .air has a blank
//     125234), which the gallery can give (helperGrabs, helperPair);
//   the BRIDGE: what a number becomes on her - the +1 ChangeAnims in their
//     order, each reading the anim the one before it left.
// Her pairs: his own grabs whose hit her immunity lets through (never a
// summon or a companion: their helpers walk to her, and she leaves in a few
// seconds), each step judged on her (helperSceneJudge), `edgeOnly` (she
// comes in from the screen edge her root faces). The runtime summons her with
// her root's command, from the hook, and grabs her once she is ready.
const HELPER_RECEIVERS = [{ id: 2017851216, name: 'Chichi' }];
const ATK_GROUPS = { AA: ['NA', 'SA', 'HA'], AT: ['NT', 'ST', 'HT'], AP: ['NP', 'SP', 'HP'] };
// A HitDef/HitBy attribute string: its state types and attack types.
function hitAttr(raw) {
  const parts = String(raw == null ? '' : raw).split(',').map((x) => x.trim().toUpperCase());
  const sca = new Set((parts[0] || '').replace(/[^SCA]/g, '').split('').filter(Boolean));
  const types = new Set();
  for (const p of parts.slice(1)) {
    if (ATK_GROUPS[p]) ATK_GROUPS[p].forEach((t) => types.add(t));
    else if (/^[NSH][ATP]$/.test(p)) types.add(p);
  }
  return { sca, types };
}
const meets = (a, b) => [...a].some((x) => b.has(x));
// Whether a HitBy/NotHitBy slot keeps a hit off her (char.go checkHitBySlot:
// a NotHitBy blocks a hit that matches its state types or its attack types;
// a HitBy lets through only a hit that matches both).
const blocks = (w, hit) => (w.not ? meets(w.attr.sca, hit.sca) || meets(w.attr.types, hit.types)
  : !(meets(w.attr.sca, hit.sca) && meets(w.attr.types, hit.types)));
// A trigger set as the helper reads it, with what the text alone cannot give
// the evaluator made literal: IsHelper(<id>), SelfAnimExist(anim + K) on the
// anim she has, her enemy's AnimExist(N) (his .air) and NumExplod(N) (an
// explod of that id he carries: `giverExplod` true, false, or null where his
// files may spawn one - left to the evaluator).
function helperTrig(trig, id, env) {
  const sub = (e) => String(e)
    .replace(/\bishelper\s*\(\s*(\d+)\s*\)/gi, (m, n) => (+n === id ? '1' : '0'))
    .replace(/\bselfanimexist\s*\(\s*anim\s*([+-])\s*(\d+)\s*\)/gi, (m, op, k) => (Number.isFinite(env.anim) ? 'selfanimexist(' + (op === '+' ? env.anim + +k : env.anim - +k) + ')' : m))
    .replace(/\b(?:enemy|enemynear|p2)(?:\s*\(\s*\d*\s*\))?\s*,\s*animexist\s*\(\s*(\d+)\s*\)/gi, (m, n) => (env.giverHas ? (env.giverHas(+n) ? '1' : '0') : m))
    .replace(/\b(?:enemy|enemynear|p2)(?:\s*\(\s*\d*\s*\))?\s*,\s*numexplod\s*\(\s*(\d+)\s*\)/gi, (m, n) => {
      const v = env.giverExplod ? env.giverExplod(+n) : null;
      return v === null ? m : (v ? '1' : '0');
    });
  return { all: trig.all.map(sub), groups: trig.groups.map((g) => g.map(sub)) };
}
// The variables a VarSet-family controller writes.
function writtenVars(sc) {
  const out = [];
  const v = S.lit(sc.params.get('v')), fv = S.lit(sc.params.get('fv'));
  if (v !== null) out.push(['var(' + v + ')', sc.params.get('value')]);
  if (fv !== null) out.push(['fvar(' + fv + ')', sc.params.get('value')]);
  for (const [k, val] of sc.params) { const m = /^(var|fvar)\((\d+)\)$/.exec(k); if (m) out.push([m[1] + '(' + m[2] + ')', val]); }
  return out;
}
// The actions of an .air that carry a Clsn2 box (a character is hit only on one).
function airClsn2(abs) {
  const out = new Set();
  let text = '';
  try { text = abs ? fs.readFileSync(abs, 'latin1') : ''; } catch (e) { return out; }
  let cur = null;
  for (const raw of text.split(/\r?\n/)) {
    const l = raw.replace(/;.*$/, '').trim();
    const b = /^\[\s*begin\s+action\s+(-?\d+)\s*\]/i.exec(l);
    if (b) { cur = +b[1]; continue; }
    if (cur !== null && /^clsn2(default)?\s*:\s*[1-9]/i.test(l)) out.add(cur);
  }
  return out;
}
// [Size] xscale of a character's constants (the engine's default 1).
function readXScale(dir, def) {
  const abs = defFileKey(dir, def, 'cns');
  let text = '';
  try { if (abs) text = fs.readFileSync(abs, 'latin1'); } catch (e) { text = ''; }
  let inSize = false;
  for (const raw of text.split('\n')) {
    const l = S.trimGo(raw.split(';')[0]);
    if (!l) continue;
    if (l[0] === '[') { inSize = /^\[\s*size\s*\]/i.test(l); continue; }
    const m = inSize && /^xscale\s*=\s*(-?[\d.]+)/i.exec(l);
    if (m) return parseFloat(m[1]);
  }
  return 1;
}
function helperReceivers(dir, def, parsed, animAbs, info, airActions) {
  const out = [];
  if (!parsed) return out;
  const rootHas = airActions instanceof Set ? airActions : new Set(airActions || []);
  const plus = parsed.states.get(-10);
  let clsn2 = null;
  for (const decl of HELPER_RECEIVERS) {
    const id = decl.id;
    const gated = (sc) => sc.trig.all.some((e) => new RegExp('\\bishelper\\s*\\(\\s*' + id + '\\s*\\)', 'i').test(String(e)));
    const bridgeCtrls = plus ? plus.sctrls.filter((sc) => sc.type === 'changeanim' && gated(sc)) : [];
    if (!bridgeCtrls.length) continue;
    let spawn = null;
    for (const neg of [-1, -2, -3]) {
      const s = parsed.states.get(neg);
      if (!s || spawn) continue;
      for (const sc of s.sctrls) {
        if (sc.type !== 'helper' || S.lit(sc.params.get('id')) !== id) continue;
        const st = S.lit(sc.params.get('stateno'));
        if (st === null || !parsed.states.has(st)) continue;
        const text = [...sc.trig.all, ...sc.trig.groups.flat()].map(String);
        const cmds = [...new Set(text.flatMap((e) => [...e.matchAll(/\bcommand\s*=\s*"([^"]*)"/gi)].map((m) => m[1])))];
        if (cmds.length !== 1 || !cmds[0]) continue;
        // Her root's command alone, with no helper of hers out: certainly.
        const rw = (e) => String(e).replace(/\bcommand\s*=\s*"[^"]*"/gi, '1').replace(/\bnumhelper\s*\(\s*(\d+)\s*\)/gi, (m, n) => (+n === id ? '0' : m));
        let v = null;
        try { v = X.evalTriggerSet({ all: sc.trig.all.map(rw), groups: sc.trig.groups.map((g) => g.map(rw)) }, { isHelper: false }); } catch (e) { v = null; }
        if (v !== true) continue;
        spawn = { sc, state: st, cmd: cmds[0] };
        break;
      }
    }
    if (!spawn) continue;
    // Her states, from her spawn state by her own ChangeStates.
    const states = new Set();
    const queue = [spawn.state];
    while (queue.length) {
      const n = queue.shift();
      if (states.has(n) || !parsed.states.has(n)) continue;
      states.add(n);
      for (const sc of parsed.states.get(n).sctrls) {
        if (sc.type !== 'changestate' && sc.type !== 'selfstate') continue;
        const v = S.lit(sc.params.get('value'));
        if (v !== null && v >= 0 && !isBasic(v) && parsed.states.has(v)) queue.push(v);
      }
    }
    if (!clsn2) clsn2 = airClsn2(animAbs);
    const per = new Map();
    for (const n of states) {
      const s = parsed.states.get(n);
      const hv = String(s.header.get('velset') === undefined ? '' : s.header.get('velset')).split(',')[0].trim();
      const moves = (hv !== '' && S.lit(hv) !== 0)
        || s.sctrls.some((sc) => (sc.type === 'velset' || sc.type === 'veladd' || sc.type === 'posadd') && sc.params.has('x') && S.lit(sc.params.get('x')) !== 0);
      const destroys = s.sctrls.some((sc) => sc.type === 'destroyself');
      const anim = S.lit(s.anim);
      const slots = s.sctrls.filter((sc) => (sc.type === 'nothitby' || sc.type === 'hitby') && sc.params.has('value'))
        .map((sc) => ({ not: sc.type === 'nothitby', attr: hitAttr(sc.params.get('value')), trig: sc.trig,
          value: String(sc.params.get('value')).trim(), time: sc.params.has('time') ? S.lit(sc.params.get('time')) : 1 }));
      per.set(n, { moves, destroys, anim, hittable: anim !== null && clsn2.has(anim), slots });
    }
    const ready = [...states].filter((n) => { const x = per.get(n); return !x.moves && !x.destroys && x.hittable; }).sort((a, b) => a - b);
    if (!ready.length) continue;
    // Her BADGE: the number N of a check on her enemy that her HitBy/NotHitBy
    // triggers make, `Enemy,NumExplod(N) && Enemy,AnimExist(N)` - an explod
    // of that id he carries and an action of that number in his table (her
    // author's grab flag: Drunk Samurai's grab state spawns explod 125234 and
    // his .air has a blank 125234). The same N in both halves, on her enemy.
    const RD = '(?:enemy|enemynear|p2)(?:\\s*\\(\\s*\\d*\\s*\\))?\\s*,\\s*';
    const badgeNs = new Map();
    for (const n of states) for (const w of per.get(n).slots) {
      const text = [...w.trig.all, ...w.trig.groups.flat()].map(String).join(' ');
      const ex = new Set([...text.matchAll(new RegExp(RD + 'numexplod\\s*\\(\\s*(\\d+)\\s*\\)', 'gi'))].map((m) => +m[1]));
      for (const m of text.matchAll(new RegExp(RD + 'animexist\\s*\\(\\s*(\\d+)\\s*\\)', 'gi'))) if (ex.has(+m[1])) badgeNs.set(+m[1], (badgeNs.get(+m[1]) || 0) + 1);
    }
    const badge = badgeNs.size === 1 ? [...badgeNs.keys()][0] : null;
    // What her own states draw her with (her run in, her taunts, her run out:
    // the header anims and her literal ChangeAnims), and the ids her own
    // Explods use (the hook never removes one of those on her).
    const ownAnims = new Set(), ownExplodIds = new Set();
    for (const n of states) {
      if (per.get(n).anim !== null) ownAnims.add(per.get(n).anim);
      for (const sc of parsed.states.get(n).sctrls) {
        if (sc.type === 'changeanim' || sc.type === 'changeanim2') { const v = S.lit(sc.params.get('value')); if (v !== null) ownAnims.add(v); }
        if (sc.type === 'explod') { const e = S.lit(sc.params.get('id')); if (e !== null) ownExplodIds.add(e); }
      }
    }
    // The variables she writes (her states, her bridge): unknown to a scene's
    // triggers; every other one of hers is 0 (a helper starts at 0).
    const herVars = new Set();
    for (const n of states) for (const sc of parsed.states.get(n).sctrls) if (/^var(set|add|random)$/.test(sc.type)) for (const [k] of writtenVars(sc)) herVars.add(k);
    for (const sc of plus.sctrls) if (/^var(set|add|random)$/.test(sc.type) && gated(sc)) for (const [k] of writtenVars(sc)) herVars.add(k);
    // The bridge: each ChangeAnim in order, reading the anim the one before
    // it left, again until nothing changes (the engine runs +1 every tick).
    const bridge = (n) => {
      let cur = n;
      for (let pass = 0; pass < 4; pass++) {
        let changed = false;
        for (const sc of bridgeCtrls) {
          let v = null;
          try { v = X.evalTriggerSet(helperTrig(sc.trig, id, { anim: cur }), { anim: cur, isHelper: true, selfHas: rootHas }); } catch (e) { v = null; }
          if (v !== true) continue;
          const to = X.evalExpr(sc.params.get('value'), { anim: cur });
          if (!Number.isFinite(to) || to === cur) continue;
          cur = to;
          changed = true;
        }
        if (!changed) break;
      }
      return cur;
    };
    const rootDisplay = info ? String(info.display || info.name || '') : '';
    const short = /\s/.test(rootDisplay.trim()) ? rootDisplay.trim().split(/\s+/)[0] : rootDisplay.trim();
    const hname = String(spawn.sc.params.get('name') === undefined ? '' : spawn.sc.params.get('name')).replace(/"/g, '').trim();
    const sx = S.lit(spawn.sc.params.get('size.xscale'));
    out.push({ id, name: decl.name, helperName: hname, display: decl.name + (short ? ' (' + short + ')' : ''), root: short || rootDisplay, cmd: spawn.cmd,
      spawn: spawn.state, states: [...states].sort((a, b) => a - b), ready, per, herVars, bridgeCtrls, bridgeOf: bridge, badge,
      own: [...ownAnims].sort((a, b) => a - b), ownExplodIds,
      scale: sx === null ? readXScale(dir, def) : sx, rootScale: readXScale(dir, def) });
  }
  return out;
}
// The explod ids a giver's own Explods use (literal ids; any computed one
// makes every number possible).
function giverExplodIds(G) {
  if (G._explodIds !== undefined) return G._explodIds;
  const ids = new Set();
  let any = false;
  for (const s of G.an.states.values()) for (const sc of s.sctrls) {
    if (sc.type !== 'explod' || !sc.params.has('id')) continue;
    const v = S.lit(sc.params.get('id'));
    if (v === null) any = true; else ids.add(v);
  }
  G._explodIds = any ? null : ids;
  return G._explodIds;
}
// Her immunity against one giver: in each ready state, the HitBy/NotHitBy
// that holds there (the last of that state's own that certainly fires,
// else the one her way there left: slot 0, time 320000). With `badge`, he
// carries her badge (the gallery's: both halves true). -> Map state -> slot|null
function helperSlots(H, G, badge) {
  const giverHas = (n) => (badge && n === H.badge) || G.gAir.has(n);
  const own = giverExplodIds(G);
  const giverExplod = (n) => ((badge && n === H.badge) ? true : own && !own.has(n) ? false : null);
  const fired = (n) => {
    const x = H.per.get(n);
    if (!x) return null;
    let last = null;
    for (const w of x.slots) {
      let v = null;
      try { v = X.evalTriggerSet(helperTrig(w.trig, H.id, { giverHas, giverExplod }), { isHelper: true }); } catch (e) { v = null; }
      if (v === true) last = w;
    }
    return last;
  };
  const out = new Map();
  const spawnSlot = fired(H.spawn);
  for (const n of H.ready) out.set(n, fired(n) || spawnSlot);
  return out;
}
// The hits of his entry state that could catch her, as attributes (a MUGEN
// giver's invincibility check reads his own state type, not the HitDef's).
function entryHits(G, E, info) {
  const s = G.an.states.get(E);
  if (!s) return [];
  const st = String(s.header.get('type') === undefined ? 's' : s.header.get('type')).trim().toUpperCase()[0] || 'S';
  return s.sctrls.filter((sc) => sc.type === 'hitdef' && sc.params.has('attr')).map((sc) => {
    const a = hitAttr(sc.params.get('attr'));
    if (!(info && info.ikemenversion) && 'SCA'.includes(st)) a.sca.add(st);
    return a;
  });
}
// HER VERDICT IN A SCENE. Every animation his state can play on her - the
// header, then each ChangeAnim/ChangeAnim2 that can fire for her (her own
// variables at 0 but those her states write; the last certain one on the
// first tick replaces what came before it) - through the bridge:
//   her art   the bridge sent it to an action of the root's that draws none
//             of the number's own sprites (181611 on 12450, for 180211 on
//             12250): tailored, partial or vanishes by its frames, as for
//             anyone (1891119, the blank it gives the left-side position
//             280120-280124, draws nothing);
//   root      it plays unbridged: the root's own answer, or his fallback on
//             the root's sprites - the root's body on her, at her scale
//             (72001's ChangeAnim2 133338 on Kira's 19230).
// A scene where any is `root` is `root`: she may be drawn as the root there.
// `held` (Map name -> value) are his variables the pair's setup holds; each
// `root` alternative gated on a variable of his that she reads of him
// (`enemyNear,var(32) >= 5`) is returned in `reads`.
const HIM_REDIRECT = new Set(['enemynear', 'enemy', 'p2']);
function helperSceneJudge(G, R, H, C, held) {
  const s = G.an.states.get(C);
  const none = { verdict: 'unknown', shown: null, reads: [] };
  if (!s) return none;
  const scenesWrite = helperSceneJudge.written || (helperSceneJudge.written = new WeakMap());
  if (!scenesWrite.has(G)) {
    const w = new Set();
    for (const C2 of G.an.scenes.keys()) { const s2 = G.an.states.get(C2); if (s2) for (const sc of s2.sctrls) if (/^var(set|add|random)$/.test(sc.type)) for (const [k] of writtenVars(sc)) w.add(k); }
    scenesWrite.set(G, w);
  }
  const unknownVars = new Set([...H.herVars, ...scenesWrite.get(G)]);
  const ctxFor = (trig, time) => {
    const ctx = { selfHas: R.airActions, isHelper: true, redirVar: (name, id, v) => (HIM_REDIRECT.has(String(name).toLowerCase()) && held && held.has(v) ? held.get(v) : null) };
    if (time !== undefined) ctx.time = time;
    for (const e of [...trig.all, ...trig.groups.flat()]) for (const v of X.varsOf(String(e))) if (!unknownVars.has(v)) ctx[v] = 0;
    return ctx;
  };
  const T0 = /\btime\s*=\s*0\b/i;
  let cands = [];
  const head = S.lit(s.anim);
  if (head !== null) cands.push({ n: head, own: true, reads: [] });
  let certain = head !== null;
  for (const sc of s.sctrls) {
    if (sc.type !== 'changeanim' && sc.type !== 'changeanim2') continue;
    const n = S.lit(sc.params.get('value'));
    if (n === null) continue;
    const t0 = [...sc.trig.all, ...sc.trig.groups.flat()].some((e) => T0.test(String(e)));
    const trig = helperTrig(sc.trig, H.id, {});
    let v = null;
    try { v = X.evalTriggerSet(trig, ctxFor(trig, t0 ? 0 : undefined)); } catch (e) { v = null; }
    if (v === false) continue;
    if (sc.type === 'changeanim' && !R.airActions.has(n)) continue;
    const reads = [...new Set([...sc.trig.all, ...sc.trig.groups.flat()].flatMap((e) => X.readsOf(String(e)))
      .filter((r) => r.via && HIM_REDIRECT.has(String(r.via).toLowerCase()) && /^f?var\(\d+\)$/.test(r.field)).map((r) => r.field))];
    const c = { n, own: sc.type === 'changeanim', reads };
    if (t0 && v === true) { cands = [c]; certain = true; } else cands.push(c);
  }
  if (!cands.length) return none;
  const has = (k) => (R.rSff ? R.rSff.has(k) : false) || R.standIns.has(k);
  const judged = cands.map((c) => {
    const to = H.bridgeOf(c.n);
    const from = [...((c.own ? R.rAir : G.gAir).get(c.n) || [])];
    if (to === c.n) {
      // Unbridged: the root's body, or (his fallback) nothing where the root
      // lacks every sprite it names.
      if (!c.own && from.length && R.rSff && !from.some(has)) return { v: 'vanishes', shown: null, c };
      return { v: 'root', shown: null, c };
    }
    const fr = [...(R.rAir.get(to) || [])];
    if (!R.airActions.has(to)) return { v: 'unknown', shown: null, c };
    if (!fr.length) return { v: 'vanishes', shown: null, c };
    if (fr.some((k) => from.includes(k))) return { v: 'root', shown: null, c };
    if (!R.rSff) return { v: 'unknown', shown: null, c };
    const present = fr.filter(has).length;
    const v = present === fr.length ? 'tailored' : present ? 'partial' : 'vanishes';
    return { v, shown: v === 'partial' ? drawnShare(R.rAirTicks && R.rAirTicks.get(to), has) : null, c };
  });
  const reads = [...new Set(judged.filter((j) => j.v === 'root').flatMap((j) => j.c.reads))];
  if (judged.some((j) => j.v === 'root')) return { verdict: 'root', shown: null, reads, certain };
  const worst = judged.reduce((a, b) => (RANK[a.v] <= RANK[b.v] ? a : b));
  return { verdict: worst.v, shown: worst.v === 'partial' ? worst.shown : null, reads, certain, to: [...new Set(judged.map((j) => H.bridgeOf(j.c.n)))] };
}
// A RANDOM BRANCH THAT DRAWS HER ROOT, shut for her. DongHwan's position-1
// climax 6005 draws var(49) = random%100, var(30) = random%50 and var(31) =
// random%30 on its first tick, then TargetStates her into 72002 (Kira's
// 133339 on her, unbridged) on `var(31) > var(49)` at AnimElem = 1 - the same
// tick - and into 72001 on `var(30) > var(49)` at AnimElem 41/43/47, each
// with a ChangeState of his on the same test (70002, 70001). A draw tested
// only on a later tick is HELD by the step's setup at the least value his
// files write it that keeps the test false for every value of the other side
// (var(30) = 0, the reset his 6005 makes past 100: 0 > random%100 never
// holds; the hook's -4 undoes the first tick's draw before element 41). One
// tested on the very tick it is drawn cannot be held - the draw runs after
// the hook's -4 - so the hook's +1 RE-ROLLS it: when his ChangeState on that
// test has taken him on (70002 from 6005), it puts him back in the state that
// draws (6005 runs again that tick and draws again) and her back in the
// step's own state that state gives her (6205), before she runs that frame
// (he, attacking, runs before her, a helper). -> { drop, setup, reroll } |
// null (no root state, or one this cannot shut: the step stays out).
function rootBranchShut(G, st, isRoot) {
  const bad = [...new Set([...st.until, ...(st.also || [])])].filter(isRoot);
  if (!bad.length) return null;
  const setup = [], reroll = [];
  const flat = (e) => String(e).toLowerCase().replace(/\s+/g, '');
  const atomsOf = (trig) => [...trig.all, ...trig.groups.flat()].map(flat);
  const laterElem = (a) => a.split('||').every((p) => { const m = /^animelem=(\d+)$/.exec(p); return !!m && +m[1] > 1; });
  for (const Cb of bad) {
    const by = [];
    for (const [no, s] of G.an.states) {
      if (no < 0 || G.an.scenes.has(no)) continue;
      for (const sc of s.sctrls) if (sc.type === 'targetstate' && S.lit(sc.params.get('value')) === Cb) by.push({ no, s, sc });
    }
    if (!by.length) return null;
    for (const { no, s, sc } of by) {
      let cmp = null;
      for (const a of atomsOf(sc.trig)) { const m = /^(f?var\(\d+\))(>|<)(f?var\(\d+\))$/.exec(a); if (m) { cmp = m[2] === '>' ? { hi: m[1], lo: m[3] } : { hi: m[3], lo: m[1] }; break; } }
      if (!cmp) return null;
      const drawOf = (v) => s.sctrls.filter((c) => c.type === 'varset' && writtenVars(c).some(([k, raw]) => k === v && X.usesRandom(String(raw))));
      const dHi = drawOf(cmp.hi), dLo = drawOf(cmp.lo);
      if (!dHi.length || !dLo.length || ![...dHi, ...dLo].every((c) => atomsOf(c.trig).includes('time=0'))) return null;
      const later = sc.trig.all.some((e) => laterElem(flat(e)))
        || (sc.trig.groups.length > 0 && sc.trig.groups.every((g) => g.some((e) => laterElem(flat(e)))));
      if (later) {
        const lits = [];
        for (const s2 of G.an.states.values()) for (const c of s2.sctrls) if (c.type === 'varset') for (const [k, raw] of writtenVars(c)) if (k === cmp.hi && S.lit(raw) !== null) lits.push(S.lit(raw));
        const lows = dLo.flatMap((c) => writtenVars(c).filter(([k]) => k === cmp.lo).map(([, raw]) => { const vs = X.valueSet(String(raw), () => null); return vs && vs.length ? Math.min(...vs) : -Infinity; }));
        const v = lits.length ? Math.min(...lits) : null;
        if (v === null || !lows.length || !(v <= Math.min(...lows))) return null;
        const ref = varRef(cmp.hi);
        if (!setup.some((x) => x.kind === ref.kind && x.index === ref.index)) setup.push({ kind: ref.kind, index: ref.index, value: v,
          why: ('holds his ' + cmp.hi + ' at ' + v + ': his ' + no + ' draws it at random and gives her ' + Cb + ' on ' + cmp.hi + ' > ' + cmp.lo + ', her root\'s art on her').replace(/[^\x20-\x7e]/g, '?') });
      } else {
        const key = atomsOf(sc.trig).sort().join('&');
        const cs = s.sctrls.find((c) => c.type === 'changestate' && atomsOf(c.trig).sort().join('&') === key);
        const to = cs ? S.lit(cs.params.get('value')) : null;
        if (to === null || to === no) return null;
        const her = st.until.filter((C) => !isRoot(C) && s.sctrls.some((c) => c.type === 'targetstate' && S.lit(c.params.get('value')) === C));
        if (!her.length) return null;
        if (!reroll.some((r) => r.from === no && r.at === to)) reroll.push({ from: no, at: to, her: her[0] });
      }
    }
  }
  return { drop: bad, setup, reroll };
}
// A variable of his whose every reader is art (his ChangeAnims, Explods,
// sounds, sprite priority, her ChangeAnims reading him), written by nothing
// but its own counter: holding it at 0, the value his grab starts it at,
// changes what is drawn and nothing else (var(32), his climax count: position
// 2's "broken" versions, his and hers).
const ART_ONLY = new Set(['changeanim', 'changeanim2', 'explod', 'modifyexplod', 'removeexplod', 'playsnd', 'stopsnd', 'sprpriority', 'palfx', 'afterimage', 'afterimagetime', 'envshake']);
function artOnlyVar(G, name) {
  for (const [no, s] of G.an.states) {
    const custom = G.an.scenes.has(no);
    for (const sc of s.sctrls) {
      const exprs = [...sc.trig.all, ...sc.trig.groups.flat(), ...[...sc.params].map(([, v]) => v)].map(String);
      const reads = exprs.flatMap((e) => X.readsOf(e)).some((r) => r.field === name
        && (custom ? r.via && HIM_REDIRECT.has(String(r.via).toLowerCase()) : !r.via || /^(root|parent)$/i.test(String(r.via))));
      if (!reads) continue;
      if (ART_ONLY.has(sc.type)) continue;
      if (!custom && (sc.type === 'varset' || sc.type === 'varadd') && writtenVars(sc).every(([k]) => k === name)) continue;
      return false;
    }
  }
  return true;
}
// HER BADGE, IN THE GALLERY ONLY. A giver none of whose own grabs she lets
// through (every throw, against `,NT,ST,HT`) is given her badge by the
// gallery where it opens one: the hook runs, after her state, what her own
// states run when her enemy carries it (`badge.sets`: in her taunts NotHitBy
// `,HP` for a tick, which a throw passes), while her root's map says the
// pair's giver is this one. Nobody's files change, so a real fight never sees
// it; a giver she already lets through (DongHwan's S,NA) keeps his pair as it
// is. -> { plain, badge: his own grab entries she lets through without and
// with it, `catchIn` per slot map, the two slot maps }
function helperGrabs(G, H, walk, info) {
  const catchIn = (slots) => {
    const entryOk = new Map();
    return (E) => {
      if (!entryOk.has(E)) {
        const g = G.grabs.find((x) => x.no === E && x.direct && !x.projectile);
        const hits = g ? entryHits(G, E, info) : [];
        entryOk.set(E, hits.length ? H.ready.filter((n) => hits.some((hit) => !(slots.get(n) && blocks(slots.get(n), hit)))) : []);
      }
      return entryOk.get(E);
    };
  };
  const entries = [...new Set(walk.steps.filter((st) => !st.companion && st.clear === undefined && !st.place).map((st) => st.entry))].sort((a, b) => a - b);
  const slots0 = helperSlots(H, G, false);
  const slots1 = H.badge != null ? helperSlots(H, G, true) : null;
  const c0 = catchIn(slots0), c1 = slots1 ? catchIn(slots1) : null;
  return { slots0, slots1, catchIn, c0, c1, plain: entries.filter((E) => c0(E).length), badge: c1 ? entries.filter((E) => c1(E).length) : [] };
}
// Her pair with one giver: the walk made for her root (her table IS his),
// her verdicts, his grabs she can be caught by (with her badge where only it
// opens one). -> { counts, steps, holds, ready, immune, badge } | null
function helperPair(G, R, H, walk, info) {
  const hg = helperGrabs(G, H, walk, info);
  const ownOf = (catchable) => walk.steps.filter((st) => !st.companion && st.clear === undefined && !st.place && catchable(st.entry).length);
  const slots0 = hg.slots0;
  let slots = slots0, catchable = hg.c0, own = ownOf(catchable), badged = false;
  if (!own.length && hg.c1) {
    const own1 = ownOf(hg.c1);
    if (own1.length) { slots = hg.slots1; catchable = hg.c1; own = own1; badged = true; }
  }
  if (!own.length) return null;
  const scenes = new Set(own.flatMap((st) => [...st.until, ...(st.also || []), ...(st.pre || [])]).filter((C) => G.an.scenes.has(C)));
  // His variables to hold: read by an alternative that draws the root, and
  // read by nothing of his but art.
  const reads = new Set();
  for (const C of scenes) for (const r of helperSceneJudge(G, R, H, C, null).reads) reads.add(r);
  const held = new Map([...reads].filter((n) => /^var\(\d+\)$/.test(n) && artOnlyVar(G, n)).map((n) => [n, 0]));
  const judged = new Map();
  const judge = (C) => { if (!judged.has(C)) judged.set(C, helperSceneJudge(G, R, H, C, held)); return judged.get(C); };
  // HIS EXPLODS ON HER: an Explod in a state of his she runs is hers, and one
  // whose anim names no fightfx action (no F prefix) resolves in her ROOT's
  // table, where no bridge reaches it: what it draws was never drawn for her
  // (his intro 7201's 43434 is Kira's own close-up 19230, a big Kira beside
  // her through every grab intro; 6216's 14250 a second body). The hook
  // removes those by id on her after her state and her root's bridge run
  // (a [Statedef +1] of its own), so none is ever drawn. One it cannot name
  // (no id, or an id her own Explods use) draws the root on her: `root`.
  const exploded = new Map();
  const drawsSprite = (k) => !R.rSff || R.rSff.has(k) || R.standIns.has(k);
  const explodsOf = (C) => {
    if (exploded.has(C)) return exploded.get(C);
    const r = { ids: [], bad: false };
    const s = G.an.states.get(C);
    for (const sc of (s ? s.sctrls : [])) {
      if (sc.type !== 'explod') continue;
      const raw = String(sc.params.get('anim') === undefined ? '' : sc.params.get('anim')).trim();
      if (!raw || /^[fs]\s*\d/i.test(raw)) continue;
      let leaves = [];
      try { leaves = S.lit(raw) !== null ? [S.lit(raw)] : X.leavesOf(raw); } catch (e) { leaves = []; }
      if (leaves.length && !leaves.some((n) => R.airActions.has(n) && [...(R.rAir.get(n) || [])].some(drawsSprite))) continue;
      const id = S.lit(sc.params.get('id'));
      if (Number.isInteger(id) && id >= 0 && !H.ownExplodIds.has(id)) { if (!r.ids.includes(id)) r.ids.push(id); } else r.bad = true;
    }
    exploded.set(C, r);
    return r;
  };
  const verdict = (C) => (explodsOf(C).bad ? 'root' : judge(C).verdict);
  // A grab's INTRO is on the way of every step of it (each is grabbed fresh
  // at times: a new pair, a reload, a scene out of place), though the walk
  // lists it with the first alone (DongHwan's 7201 with position 1): the
  // states its steps pass that none of them shows. An intro that may draw
  // her as her root spoils every step of that grab.
  const shownAny = new Set(own.flatMap((st) => st.until));
  const introOf = (E) => [...new Set(own.filter((st) => st.entry === E).flatMap((st) => [...(st.pre || []), ...(st.also || [])]))].filter((C) => !shownAny.has(C));
  const way = (st) => [...st.until, ...(st.also || []), ...(st.pre || []), ...introOf(st.entry)];
  // (A step whose only root states are random branches of his that can be
  // shut - rootBranchShut - is listed without them, shut.)
  const isRoot = (C) => verdict(C) === 'root';
  const clean = own.filter((st) => !introOf(st.entry).some(isRoot)).map((st) => {
    const sh = rootBranchShut(G, st, isRoot);
    if (!sh) return st;
    const cut = (list) => (list || []).filter((C) => !sh.drop.includes(C));
    const until = cut(st.until);
    if (!until.length) return st;
    return Object.assign({}, st, { until, also: cut(st.also), path: st.path.map((a, i) => (i === st.path.length - 1 ? Object.assign({}, a, { until: until.slice() }) : a)),
      setup: [...(st.setup || []), ...sh.setup], reroll: sh.reroll, navNew: true });
  });
  const steps = pairSteps(G, { steps: clean }, verdict, (C) => judge(C).shown, { spoils: (C) => verdict(C) === 'root' });
  if (!steps.length) return null;
  // (The steps the shut adds to her pair are the deriver's kind of step, new
  // to her: their nav is the deriver's, as her other steps'.)
  for (const st of steps) {
    if (st.setup && !st.setup.length) delete st.setup;
    if (st.reroll && !st.reroll.length) delete st.reroll;
    delete st.held; delete st.hisStages; delete st.navNew; delete st.fail;
  }
  // The ids to remove on her: his explods in every state her listed steps
  // pass (what they show, what they pass through, the grab's intro).
  const shows = (C) => !G.broken.has(C) && ['tailored', 'renders', 'partial'].includes(verdict(C));
  const hideExplods = [...new Set(clean.filter((st) => st.until.some(shows) && !way(st).some((C) => verdict(C) === 'root'))
    .flatMap(way).flatMap((C) => explodsOf(C).ids))].sort((a, b) => a - b);
  // A hold stays only where a listed scene needs it (her art with it, the
  // root's without it).
  const used = [...held.keys()].filter((n) => steps.some((st) => [...st.states, ...(st.alsoStates || [])].some((C) => helperSceneJudge(G, R, H, C, null).verdict === 'root' && verdict(C) !== 'root' && helperSceneJudge(G, R, H, C, null).reads.includes(n))));
  const counts = { scenes: G.hScenes.size, tailored: 0, renders: 0, partial: 0, getHitOnly: 0, vanishes: 0, unknown: 0, root: 0, unreachable: walk.unreachable.length };
  for (const C of new Set(walk.steps.flatMap((st) => [...st.until, ...(st.also || [])]).filter((C) => G.hScenes.has(C)))) counts[verdict(C)] = (counts[verdict(C)] || 0) + 1;
  const entries = [...new Set(steps.map((st) => st.entry))];
  const ready = H.ready.filter((n) => entries.every((E) => catchable(E).includes(n)));
  if (!ready.length) return null;
  for (const st of steps) st.edgeOnly = true;
  const immune = [...new Set(ready.flatMap((n) => (slots.get(n) && slots.get(n).not ? [...slots.get(n).attr.types] : [])))].sort();
  // Her ART: the actions her steps' scenes draw her with (the bridge's
  // targets) - what the log's "helper art" line must show, never a number
  // of the root's own.
  const art = [...new Set(steps.flatMap((st) => [...st.states, ...(st.alsoStates || [])]).flatMap((C) => judge(C).to || []))].sort((a, b) => a - b);
  // The badge's slots, for the hook: in each ready state where the one her
  // state ends with under the badge is another than without it, that one
  // (its type, value and time as her file writes them), grouped.
  let badge = null;
  if (badged) {
    const sets = [];
    for (const n of H.ready) {
      const w = slots.get(n), w0 = slots0.get(n);
      if (!w || w === w0 || !Number.isInteger(w.time) || w.time < 1) continue;
      const k = (w.not ? 'n' : 'h') + '|' + w.value + '|' + w.time;
      let e = sets.find((x) => x.k === k);
      if (!e) { e = { k, not: w.not, value: w.value, time: w.time, states: [] }; sets.push(e); }
      e.states.push(n);
    }
    if (!sets.length) return null;
    badge = { n: H.badge, sets: sets.map(({ not, value, time, states }) => ({ not, value, time, states })) };
  }
  return { counts, steps, art, hideExplods, badge, holds: used.map((n) => ({ kind: 'var', index: +/\d+/.exec(n)[0], value: 0,
    why: ('holds his ' + n + ' at 0, where his grab starts it: past it her scenes pick ' + (H.root || 'her root') + '\'s own art, a double-size '
      + (H.root || 'root') + ' on her').replace(/[^\x20-\x7e]/g, '?') })), ready, immune };
}

// ---- one scene, one receiver ----------------------------------------------------
const RANK = { tailored: 6, renders: 5, partial: 4, getHitOnly: 3, vanishes: 2, unknown: 1 };
// A frame of his drawn on her shows a scene where its sprite group is scene
// art: in the H windows (or 10000 and up), or one of HER POSE SPRITES
// (herPoseGroups) - never one of her ordinary sprites (getHitOnly).
const sceneFrame = (R) => (k) => { const g = +String(k).split(',')[0]; return g !== 99999 && (isHGroup(g) || !!(R.poseGroups && R.poseGroups.has(g))); };
// Her state's header animation, replaced before it is ever drawn: a
// ChangeAnim/ChangeAnim2 on her first tick that certainly fires for her
// (Brian's extra edition: 6200's `Time = 0 && !SelfAnimExist(62000)` puts
// his 891 on her sprites, so her own 6200 never shows unless she ships 62000).
const headerMemo = new WeakMap();
function headerReplaced(G, R, C) {
  let per = headerMemo.get(G);
  if (!per) { per = new Map(); headerMemo.set(G, per); }
  if (!per.has(C)) {
    const s = G.an.states.get(C);
    const list = s ? s.sctrls.filter((sc) => (sc.type === 'changeanim' || sc.type === 'changeanim2')
      && [...sc.trig.all, ...sc.trig.groups.flat()].some((e) => /\btime\s*=\s*0\b/i.test(String(e)))) : [];
    per.set(C, { header: s ? S.lit(s.anim) : null, list });
  }
  const { header, list } = per.get(C);
  if (header === null) return null;
  for (const sc of list) {
    let v = null;
    try { v = X.evalTriggerSet(sc.trig, { time: 0, selfHas: R.airActions, isHelper: false }); } catch (e) { v = null; }
    if (v === true) return header;
  }
  return null;
}
// Whether her own action N can play in her state C: the header unless it is
// replaced on her first tick, and a ChangeAnim of N only when its trigger is
// not certainly false for her (`name = "Mai Natsume"` for anyone else, a
// dead `0 && SelfAnimExist(6202)`). N that no ChangeAnim of C names (a probe
// of another controller's trigger) plays as the bench counts it - except a
// probe that picks HIS art, and for her an action that draws none of her
// (HIS PROBE PICKS HIS ART, BLIND): her N never plays there.
const animCtrlMemo = new WeakMap();
function playsFor(G, R, C, n) {
  if (probePicks(G, R, C).some((p) => p.n === n && p.blind)) return false;
  const replaced = headerReplaced(G, R, C);
  let per = animCtrlMemo.get(G);
  if (!per) { per = new Map(); animCtrlMemo.set(G, per); }
  if (!per.has(C)) {
    const s = G.an.states.get(C);
    const byN = new Map();
    if (s) for (const sc of s.sctrls) {
      if (sc.type !== 'changeanim') continue;
      const v = S.lit(sc.params.get('value'));
      if (v === null) continue;
      if (!byN.has(v)) byN.set(v, []);
      byN.get(v).push(sc);
    }
    per.set(C, { header: s ? S.lit(s.anim) : null, byN });
  }
  const { header, byN } = per.get(C);
  if (n === header) return n !== replaced || (byN.has(n) && byN.get(n).some((sc) => fires(sc)));
  if (!byN.has(n)) return true;
  return byN.get(n).some((sc) => fires(sc));
  function fires(sc) {
    const nm = R.name ? R.name.toLowerCase() : null;
    const ctx = { selfHas: R.airActions, isHelper: false, nameEq: (which, text) => (which === 'name' && nm !== null ? nm === String(text).toLowerCase() : null) };
    try { return X.evalTriggerSet(sc.trig, ctx) !== false; } catch (e) { return true; }
  }
}
// HIS PROBE PICKS HIS ART (2026-10-08). A probe `SelfAnimExist(N)` of his
// state C that only ChangeAnim2 lines of his read (literal actions), one for
// her shipping N and one for her lacking it, with no ChangeAnim of C naming N
// or a computed number and N not C's header, asks her nothing to play:
// either way she is drawn in an action of HIS, on her own sprites, and her N
// never plays. Murakami's winged demon: 3605 plays his 3605 (the sprites
// 17850,0-2) where she ships an action 17850, else his 3606 (9005,0-2); Mai
// ships 17850, built from her 9005 sprites, and no sprite 17850 at all - her
// own 17850 never shows and his 3605 draws nothing of her (headless,
// 2026-10-08: she in 3605 on his 3605 for the whole move, nobody on screen
// but him, under "[tailored]"); his compat holds the same on R.Mika (1004,
// 1005: his 41025 / 41027, sprites 26626 she lacks - round 2's own headless
// shots show him alone on the floor). Where the action it picks for her
// draws none of her sprites (BLIND), her N is no answer (playsFor): she
// shows his other branch where the gallery plays it (HIS OTHER BRANCH), else
// nothing. Where it draws her sprites, her N is read as her answer, as
// before (Roper's 825 picks his 827 on her 9005 for her 15905, which draws
// the same 9005). A probe with a line one way only (Brian's 6200: his 891
// where she lacks 62000, her header where she ships it) is her answer, as
// before.
// hisProbes -> Map(N -> [{ a, sc }]), the lines (memoized per giver);
// probePicks -> [{ n, mine: [a], other: [a], blind }] for N she ships, what
// fires for her, what would where she lacked N, and whether all of what fires
// for her draws none of her sprites.
const hisProbeMemo = new WeakMap();
const PROBE_ATOM = /\bselfanimexist\s*\(\s*(\d+)\s*\)/gi;
const REDIRECTED_PROBE = /\b(?:target|enemy|enemynear|p2|partner|parent|root|helper|playerid\([^)]*\))\s*,\s*selfanimexist\s*\(\s*\d+\s*\)/gi;
function hisProbes(G, C) {
  let per = hisProbeMemo.get(G);
  if (!per) { per = new Map(); hisProbeMemo.set(G, per); }
  if (per.has(C)) return per.get(C);
  const out = new Map();
  per.set(C, out);
  const s = G.an.states.get(C);
  if (!s) return out;
  const probesOf = (sc) => {
    const ns = new Set();
    for (const e of [...sc.trig.all, ...sc.trig.groups.flat()]) for (const m of String(e).replace(REDIRECTED_PROBE, ' ').matchAll(PROBE_ATOM)) ns.add(+m[1]);
    return ns;
  };
  const header = S.lit(s.anim);
  const lines = new Map(), spoiled = new Set();
  let computed = false;
  for (const sc of s.sctrls) {
    if (sc.type === 'changeanim' && S.lit(sc.params.get('value')) === null) computed = true;
    for (const n of probesOf(sc)) {
      const a = S.lit(sc.params.get('value'));
      if (sc.type !== 'changeanim2' || a === null) { spoiled.add(n); continue; }
      if (!lines.has(n)) lines.set(n, []);
      lines.get(n).push({ a, sc });
    }
    if (sc.type === 'changeanim') { const v = S.lit(sc.params.get('value')); if (v !== null) spoiled.add(v); }
  }
  if (computed) return out;
  for (const [n, ls] of lines) if (!spoiled.has(n) && n !== header) out.set(n, ls);
  return out;
}
// Her actions with one answer set aside (the expression reader asks a Set).
class AnsweredAs extends Set {
  constructor(src, n, v) { super(); this.src = src; this.n = n; this.v = v; }
  has(x) { return x === this.n ? this.v : this.src.has(x); }
}
const probePickMemo = new WeakMap();
function probePicks(G, R, C) {
  let byG = probePickMemo.get(R);
  if (!byG) { byG = new WeakMap(); probePickMemo.set(R, byG); }
  let per = byG.get(G);
  if (!per) { per = new Map(); byG.set(G, per); }
  if (per.has(C)) return per.get(C);
  const out = [];
  per.set(C, out);
  const nm = R.name ? R.name.toLowerCase() : null;
  const firesWith = (sc, n, shipped) => {
    const selfHas = new AnsweredAs(R.airActions, n, shipped);
    const ctx = { selfHas, isHelper: false, nameEq: (which, text) => (which === 'name' && nm !== null ? nm === String(text).toLowerCase() : null) };
    try { return X.evalTriggerSet(sc.trig, ctx) !== false; } catch (e) { return true; }
  };
  for (const [n, ls] of hisProbes(G, C)) {
    if (!R.airActions.has(n)) continue;
    const mine = ls.filter((l) => firesWith(l.sc, n, true) && !firesWith(l.sc, n, false));
    const other = ls.filter((l) => firesWith(l.sc, n, false) && !firesWith(l.sc, n, true));
    if (!mine.length || !other.length) continue;
    const my = [...new Set(mine.map((l) => l.a))];
    const blind = !!R.rSff && my.every((a) => { const fr = [...(G.gAir.get(a) || [])]; return fr.length > 0 && !fr.some((k) => R.rSff.has(k) || R.standIns.has(k)); });
    out.push({ n, mine: my, other: [...new Set(other.map((l) => l.a))], blind });
  }
  return out;
}
// HIS OTHER BRANCH (2026-10-08): where the action his probe picks for her
// draws none of her sprites, and the probe's other line (his art for a
// receiver without N) is one action whose every frame she has, the gallery
// plays that one on her in its place (the pair's `swap`, the hook's
// _gal_sw). Mai's 17850 is her 9005 pose, so his 3606 / 3608 (her 9005,
// upright and then upside down, as Kung Fu Girl Z shows it in a fight) in
// place of his 3605 / 3607 (17850, which she lacks). -> [{ from, to }] for C.
function hisOtherBranch(G, R, C) {
  const out = [];
  if (!R.rSff) return out;
  const has = (k) => R.rSff.has(k) || R.standIns.has(k);
  for (const p of probePicks(G, R, C)) {
    if (!p.blind || p.mine.length !== 1 || p.other.length !== 1) continue;
    const from = p.mine[0], to = p.other[0];
    const fa = [...(G.gAir.get(from) || [])], fb = [...(G.gAir.get(to) || [])];
    if (!fa.length || !fb.length || fa.some(has) || !fb.every(has)) continue;
    if (!out.some((x) => x.from === from)) out.push({ from, to });
  }
  return out;
}
const fallbackMemo = new WeakMap();
function fallbackFires(G, R, C, a) {
  let per = fallbackMemo.get(G);
  if (!per) { per = new Map(); fallbackMemo.set(G, per); }
  if (!per.has(C)) {
    const s = G.an.states.get(C);
    const byN = new Map();
    if (s) for (const sc of s.sctrls) {
      if (sc.type !== 'changeanim2') continue;
      const v = S.lit(sc.params.get('value'));
      if (v === null) continue;
      if (!byN.has(v)) byN.set(v, []);
      byN.get(v).push(sc);
    }
    per.set(C, byN);
  }
  const list = per.get(C).get(a);
  if (!list) return true;
  const nm = R.name ? R.name.toLowerCase() : null;
  const ctx = { selfHas: R.airActions, isHelper: false, nameEq: (which, text) => (which === 'name' && nm !== null ? nm === String(text).toLowerCase() : null) };
  return list.some((sc) => { if (sc.neverTrue) return false; try { return X.evalTriggerSet(sc.trig, ctx) !== false; } catch (e) { return true; } });
}
// Her action that is no answer to his demand: her hit spark anywhere, her
// HUD (receiverHud) in a companion's scenes only.
function noAnswer(G, R, C, n) {
  if (R.effects && R.effects.has(n)) return true;
  return !!(R.hud && R.hud.has(n) && G.companionScenes && G.companionScenes.has(C));
}
function sceneVerdict(G, R, C) {
  return sceneJudge(G, R, C).verdict;
}

// A PIECE OF HER, NOT HER: his fallback (his action on her sprites) finds a
// sprite of hers under the number it draws, but the number is only a key -
// what she ships there can be a part of her body. Miyako's 12260,0-2 are her
// two raised feet (her own .air draws them only as a layer, 1601061 over
// 160106's body), so Brian's 12261 under Bao drew her legs and no body, and
// the bench said "renders". A frame of his fallback whose sprite of hers
// covers under a third of what her sprites cover in his other fallbacks'
// scene groups (the template's other body poses she ships: Miyako's 12250
// and 12252, 11984 pixels, against 2650-3618) is judged as a frame she
// lacks. The measure is her own: sprites of one set are drawn at one scale
// (Kira's fight sprites are twice her scene art's; Gardevoir's curled 19230 is
// 42% of her 12250, a whole body). Needs two such groups or none is judged.
// Her pixels are counted once per sprite file, as far as asked. Read where
// her art is judged under his held variables (heldJudge: a companion's
// scenes); read in every scene (sceneJudge's fallbacks), the rule changed 38
// pairs of his Degenerate Mugen build (26 of them Kuroyukihime_K's) and 32
// of MUGEN-HYPER-EDITION, none Brian's, unchecked - the owner's call.
const PIECE_SHARE = 1 / 3;
const areaCache = new Map();
function spriteAreas(file, keys) {
  let st = null;
  try { st = fs.statSync(file); } catch (e) { return new Map(); }
  const sig = st.size + ':' + st.mtimeMs;
  let c = areaCache.get(file);
  if (!c || c.sig !== sig) { c = { sig, areas: new Map() }; areaCache.set(file, c); }
  const miss = keys.filter((k) => !c.areas.has(k));
  if (miss.length) {
    let sff = null;
    try { sff = require('./tools/sff-decode.js').readSff(file); } catch (e) { sff = null; }
    const SD = require('./tools/sff-decode.js');
    for (const k of miss) {
      let n = null;
      if (sff) {
        const [g, i] = k.split(',').map(Number);
        let im = null;
        try { im = SD.spritePixels(sff, g, i); } catch (e) { im = null; }
        if (im && im.px && im.w && im.h) {
          n = 0;
          const all = im.w * im.h, rgba = im.kind !== 'indexed';
          for (let p = 0; p < all; p++) if (rgba ? im.px[p * 4 + 3] : im.px[p]) n++;
        }
      }
      c.areas.set(k, n);
    }
  }
  return c.areas;
}
const fbGroupsMemo = new WeakMap();
function fallbackGroups(G) {
  if (!fbGroupsMemo.has(G)) {
    const gs = new Set();
    for (const [, sc] of G.an.scenes) for (const a of (sc.demands && sc.demands.fallbacks) || []) for (const k of G.gAir.get(a) || []) { const g = +String(k).split(',')[0]; if (g !== 99999 && isHGroup(g)) gs.add(g); }
    fbGroupsMemo.set(G, [...gs].sort((a, b) => a - b));
  }
  return fbGroupsMemo.get(G);
}
const firstOfMemo = new WeakMap();
function firstSpriteOf(R, g) {
  let m = firstOfMemo.get(R);
  if (!m) {
    m = new Map();
    for (const k of R.rSff || []) { const [gg, i] = String(k).split(',').map(Number); if (!m.has(gg) || i < m.get(gg)) m.set(gg, i); }
    firstOfMemo.set(R, m);
  }
  return m.has(g) ? g + ',' + m.get(g) : null;
}
// -> the frames of his action `a` that draw a piece of her (a Set, maybe empty).
function pieceFrames(G, R, a) {
  const none = new Set();
  if (!R.sprite || !R.rSff) return none;
  const fr = [...(G.gAir.get(a) || [])].filter((k) => R.rSff.has(k));
  if (!fr.length) return none;
  const own = new Set(fr.map((k) => +String(k).split(',')[0]));
  const refKeys = fallbackGroups(G).filter((g) => !own.has(g)).map((g) => firstSpriteOf(R, g)).filter(Boolean);
  if (refKeys.length < 2) return none;
  const areas = spriteAreas(R.sprite, [...fr, ...refKeys]);
  const ref = refKeys.map((k) => areas.get(k)).filter((n) => Number.isFinite(n) && n > 0).sort((x, y) => x - y);
  if (ref.length < 2) return none;
  const mid = ref.length % 2 ? ref[(ref.length - 1) / 2] : (ref[ref.length / 2 - 1] + ref[ref.length / 2]) / 2;
  return new Set(fr.filter((k) => { const n = areas.get(k); return Number.isFinite(n) && n < mid * PIECE_SHARE; }));
}
// The verdict and, for a partial one, `shown`: the share of the art's time
// she is drawn (drawnShare) for the action that gives the verdict, the
// larger where several give it, as the verdict takes the best of them.
function sceneJudge(G, R, C) {
  const sc = G.an.scenes.get(C);
  if (!sc) return { verdict: 'unknown', shown: null };
  const d = sc.demands;
  const has = (k) => (R.rSff ? R.rSff.has(k) : false) || R.standIns.has(k);
  const keep = (slot, v, share) => {
    if (!slot.v || RANK[v] > RANK[slot.v]) { slot.v = v; slot.shown = share === undefined ? null : share; return; }
    if (RANK[v] === RANK[slot.v] && share !== null && share !== undefined && (slot.shown === null || share > slot.shown)) slot.shown = share;
  };
  const judged = (slot) => ({ verdict: slot.v, shown: slot.v === 'partial' ? slot.shown : null });
  const own = { v: null, shown: null };
  let effect = false;
  for (const n of [...d.guarded, ...d.assumed]) {
    if (!R.airActions.has(n) || !playsFor(G, R, C, n)) continue;
    // (A giver who is no receiver: only his actions on receiver-window art.)
    if (R.answers && !R.answers.has(n)) continue;
    const fr = [...(R.rAir.get(n) || [])];
    if (fr.length && noAnswer(G, R, C, n)) { effect = true; continue; }
    // A FLAG: an action she ships with no frame (R.Mika's 110810, "necessary
    // flag") that his own states route on (Kur0maru's milking launcher 51300
    // and its branches in 51308): his scene plays the path made for her.
    if (!fr.length) { if (d.guarded.includes(n) && G.probes.includes(n)) keep(own, 'tailored'); continue; }
    if (!R.rSff) { keep(own, 'unknown'); continue; }
    const present = fr.filter(has).length;
    keep(own, present === fr.length ? 'tailored' : present ? 'partial' : 'vanishes', present && present < fr.length ? drawnShare(R.rAirTicks && R.rAirTicks.get(n), has) : null);
  }
  if (own.v && own.v !== 'unknown') return judged(own);
  // His fallback plays only where a ChangeAnim2 of his state that names it
  // can fire for her: 4821's `SelfAnimExist(18200) = 1` branch is dead for
  // a receiver who ships the 18200 sprites but no action 18200 (Kotaro), who
  // gets the `= 0` branch, 4831, on 18300 sprites she lacks.
  const acts = new Set(d.fallbacks.filter((a) => fallbackFires(G, R, C, a)));
  // (HIS OTHER BRANCH: the hook plays it on her in place of the one his
  // probe picks, which draws nothing of her.)
  for (const x of hisOtherBranch(G, R, C)) if (acts.delete(x.from)) acts.add(x.to);
  const poses = new Set(sc.entries.flatMap((e) => e.poses.map((p) => p.anim)).filter(Number.isFinite));
  for (const cd of d.computed || []) {
    const K = cd.flag === null ? cd.offset : (R.airActions.has(cd.flag) ? cd.whenShipped : cd.otherwise);
    const all = [];
    for (const [n, fr] of G.gAir) if (fr.size && modlib.hFamily(n) !== 'other' && G.gAir.has(n - K)) all.push(n);
    const mine = all.filter((n) => poses.has(n - K));
    for (const n of (mine.length ? mine : all)) acts.add(n);
  }
  const best = { v: null, shown: null };
  for (const a of acts) {
    const fr = [...(G.gAir.get(a) || [])];
    if (!fr.length || !R.rSff) continue;
    const shownFr = fr.filter(has);
    const scene = shownFr.some(sceneFrame(R));
    const v = !shownFr.length ? 'vanishes' : !scene ? 'getHitOnly' : shownFr.length === fr.length ? 'renders' : 'partial';
    keep(best, v, v === 'partial' ? drawnShare(G.gAirTicks && G.gAirTicks.get(a), has) : null);
  }
  if (best.v) return judged(best);
  if (own.v) return judged(own);
  return { verdict: effect ? 'vanishes' : 'unknown', shown: null };
}

// HER ART UNDER HIS VARIABLES: her state's animation lines, where one reads a
// variable of his that a step holds (a companion's art variant copied into
// his var(23), which her 51409-51412 read as `enemy,var(23)`), played as the
// engine plays them on her first tick: the header, then each ChangeAnim /
// ChangeAnim2 in order, each over what the one before left (`anim = 12261` ->
// `anim+267860`, her own 280121: the Kuromaru-template branch), with his held
// variables at the step's values and his others at the 0 his grab starts them
// at (`enemyNear,var(4) > 4`, his climax count, is no first picture), her
// probes answered by her table (`stateno` is the state: `selfanimexist(
// stateno+228812)`), and a line it cannot decide (`helper(69000),anim`) both
// ways. An action of hers she lacks, or of his he lacks, changes nothing (the
// engine ignores it). A PROBE IS NO ART: only what a line plays counts - her
// 1801131, which 51409 only tests, is no answer of hers (the bench's own
// reading counts every number asked). Her own answer first, else his
// fallback on her sprites, each judged by its frames as sceneJudge does.
// -> { verdict, shown, anims } | null when the state reads none of `held`.
const heldReadMemo = new WeakMap();
function heldReads(G, C, names) {
  let per = heldReadMemo.get(G);
  if (!per) { per = new Map(); heldReadMemo.set(G, per); }
  const k = C + '|' + [...names].sort().join(',');
  if (!per.has(k)) {
    const s = G.an.states.get(C);
    per.set(k, !!s && s.sctrls.some((sc) => (sc.type === 'changeanim' || sc.type === 'changeanim2')
      && [...sc.trig.all, ...sc.trig.groups.flat()].flatMap((e) => X.readsOf(String(e))).some((r) => r.via && HIM_REDIRECT.has(String(r.via).toLowerCase()) && names.has(r.field))));
  }
  return per.get(k);
}
function heldJudge(G, R, C, held) {
  const s = G.an.states.get(C);
  if (!s) return { verdict: 'unknown', shown: null, anims: [] };
  const nm = R.name ? R.name.toLowerCase() : null;
  const ctxOf = (anim) => {
    const ctx = { time: 0, selfHas: R.airActions, isHelper: false,
      nameEq: (which, text) => (which === 'name' && nm !== null ? nm === String(text).toLowerCase() : null),
      redirVar: (name, id, v) => (HIM_REDIRECT.has(String(name).toLowerCase()) ? (held.has(v) ? held.get(v) : 0) : undefined) };
    if (Number.isFinite(anim)) ctx.anim = anim;
    return ctx;
  };
  const head = S.lit(s.anim);
  let alts = [{ n: head, own: true }];
  for (const sc of s.sctrls) {
    if (sc.type !== 'changeanim' && sc.type !== 'changeanim2') continue;
    const own = sc.type === 'changeanim';
    const trig = stateTrig(sc.trig, C);
    const raw = stateTrig({ all: [String(sc.params.get('value') === undefined ? '' : sc.params.get('value'))], groups: [] }, C).all[0];
    const next = [];
    for (const a of alts) {
      let v = null;
      try { v = X.evalTriggerSet(trig, ctxOf(a.n)); } catch (e) { v = null; }
      if (v === false) { next.push(a); continue; }
      let n = S.lit(raw);
      if (n === null) { try { n = X.evalExpr(raw, ctxOf(a.n)); } catch (e) { n = null; } }
      n = Number.isFinite(n) ? Math.trunc(n) : null;
      if (n === null || !(own ? R.airActions.has(n) : G.gAir.has(n))) { next.push(a); continue; }
      if (v !== true) next.push(a);
      next.push({ n, own });
    }
    alts = [];
    for (const a of next) if (!alts.some((b) => b.n === a.n && b.own === a.own)) alts.push(a);
  }
  const has = (k) => (R.rSff ? R.rSff.has(k) : false) || R.standIns.has(k);
  const keep = (slot, v, share) => {
    if (!slot.v || RANK[v] > RANK[slot.v]) { slot.v = v; slot.shown = share === undefined ? null : share; return; }
    if (RANK[v] === RANK[slot.v] && share !== null && share !== undefined && (slot.shown === null || share > slot.shown)) slot.shown = share;
  };
  const mine = { v: null, shown: null }, his = { v: null, shown: null };
  for (const a of alts) {
    if (a.n === null) continue;
    if (a.own) {
      if (!R.airActions.has(a.n) || noAnswer(G, R, C, a.n)) continue;
      const fr = [...(R.rAir.get(a.n) || [])];
      if (!fr.length) continue;
      if (!R.rSff) { keep(mine, 'unknown'); continue; }
      const present = fr.filter(has).length;
      keep(mine, present === fr.length ? 'tailored' : present ? 'partial' : 'vanishes', present && present < fr.length ? drawnShare(R.rAirTicks && R.rAirTicks.get(a.n), has) : null);
    } else {
      const fr = [...(G.gAir.get(a.n) || [])];
      if (!fr.length || !R.rSff) continue;
      // (A frame drawing a piece of her - pieceFrames - is one she lacks.)
      const piece = fr.some(has) ? pieceFrames(G, R, a.n) : new Set();
      const body = (k) => has(k) && !piece.has(k);
      const shownFr = fr.filter(body);
      const scene = shownFr.some(sceneFrame(R));
      const v = !shownFr.length ? 'vanishes' : !scene ? 'getHitOnly' : shownFr.length === fr.length ? 'renders' : 'partial';
      keep(his, v, v === 'partial' ? drawnShare(G.gAirTicks && G.gAirTicks.get(a.n), body) : null);
    }
  }
  const slot = mine.v && mine.v !== 'unknown' ? mine : his.v ? his : mine;
  return { verdict: slot.v || 'unknown', shown: slot.v === 'partial' ? slot.shown : null, anims: alts.filter((a) => a.n !== null).map((a) => a.n) };
}

// His companion's steps as one receiver sees them (null for a giver with
// none): her states that read his copy of its art variant judged under the
// variant each step holds (its setup's art entries) - on their own, the best
// of the values his files draw it at - and a climax whose meter line is gated
// on her name taken as hers (`target, name = "Makoto"` holding 473114: her
// climax is her 41405 only, one step for both of its variants).
function companionHeld(G, R, judge0) {
  const judge = judge0 || ((C) => sceneJudge(G, R, C));
  const comps = (G.companions || []).filter((c) => c.play && (c.mirrors || []).length);
  if (!comps.length) return null;
  const names = new Set(comps.flatMap((c) => c.mirrors.map((m) => m.kind + '(' + m.index + ')')));
  const values = new Map();
  for (const c of comps) for (const m of c.mirrors) values.set(m.kind + '(' + m.index + ')', (c.play.artValues && c.play.artValues[m.of]) || [m.value]);
  const reads = (C) => G.companionScenes && G.companionScenes.has(C) && heldReads(G, C, names);
  const memo = new Map();
  const judgeAt = (C, held) => {
    const k = C + '|' + [...held].map(([n, v]) => n + '=' + v).join(',');
    if (!memo.has(k)) memo.set(k, heldJudge(G, R, C, held));
    return memo.get(k);
  };
  const best = (C) => {
    let out = null;
    const keys = [...values.keys()];
    const rec = (i, held) => {
      if (i === keys.length) {
        const j = judgeAt(C, new Map(held));
        if (!out || RANK[j.verdict] > RANK[out.verdict] || (RANK[j.verdict] === RANK[out.verdict] && (j.shown || 0) > (out.shown || 0))) out = j;
        return;
      }
      for (const v of values.get(keys[i])) rec(i + 1, [...held, [keys[i], v]]);
    };
    rec(0, []);
    return out;
  };
  const heldOf = (st) => new Map((st.setup || []).filter((x) => x.art && names.has(x.kind + '(' + x.index + ')')).map((x) => [x.kind + '(' + x.index + ')', x.value]));
  const nm = R.name ? R.name.toLowerCase() : null;
  const adapt = (walk) => {
    let changed = false;
    const steps = walk.steps.map((st) => {
      const b = st.kind === 'companion' && nm !== null && (st.byName || []).find((x) => x.name === nm);
      if (!b) return st;
      changed = true;
      const until = b.holds ? b.until.slice() : [...new Set([...st.until, ...b.until])].sort((x, y) => x - y);
      // (Hers held, her climax is one picture: the step is the climax, its
      // hold her line's animation - never a picture the line takes over.)
      const more = b.holds ? { label: st.baseLabel || st.label, companion: Object.assign({}, st.companion, { hold: b.hold || undefined }),
        nav: st.nav ? Object.assign({}, st.nav, { speed: null }) : st.nav } : {};
      if (more.companion && !more.companion.hold) delete more.companion.hold;
      // (Hers held: the other pictures' states never come.)
      return Object.assign({}, st, { until, also: (st.also || []).filter((c) => !until.includes(c) && !(b.holds && (st.climaxHer || []).includes(c))), artKey: b.holds ? b.artKey : st.artKey + '|' + b.artKey,
        path: st.path.map((a, i) => (i === st.path.length - 1 ? Object.assign({}, a, { until: until.slice() }) : a)) }, more);
    });
    return changed ? Object.assign({}, walk, { steps }) : walk;
  };
  const stepVerdict = (st) => (st.kind === 'companion' ? (C) => (reads(C) ? judgeAt(C, heldOf(st)).verdict : judge(C).verdict) : null);
  const stepShown = (st) => (st.kind === 'companion' ? (C) => (reads(C) ? judgeAt(C, heldOf(st)).shown : judge(C).shown) : null);
  return { reads, best, adapt, stepVerdict, stepShown };
}

// A GENERIC REACTION: a scene that shows her only through her own answer to a
// guarded demand whose number is outside the H windows and whose frames draw
// no scene sprite group (Kur0maru's thunder 2220 -> her electrocuted 7696,
// his Bliss 3650 -> her Midnight Bliss 9020). His own scene art (renders,
// partial) is never generic.
function genericScene(G, R, C) {
  const sc = G.an.scenes.get(C);
  if (!sc) return true;
  const d = sc.demands;
  const has = (k) => (R.rSff ? R.rSff.has(k) : false) || R.standIns.has(k);
  const ownNums = [...d.guarded, ...d.assumed].filter((n) => R.airActions.has(n) && playsFor(G, R, C, n) && !noAnswer(G, R, C, n) && (!R.answers || R.answers.has(n))
    && (R.rAir.get(n) || new Set()).size && [...R.rAir.get(n)].some(has));
  if (!ownNums.length) return false;
  // (Her pose sprites are scene art too: HER POSE SPRITES.)
  const sceneArt = (n) => [...R.rAir.get(n)].some(sceneFrame(R));
  return ownNums.every((n) => !isHNumber(n) && !sceneArt(n));
}

// ---- one pair's steps -------------------------------------------------------------
// The giver's steps as one receiver sees them. A step is listed for her when
// a scene of its `until` shows her (tailored, renders, partial); `states` are
// those, `alsoStates` the rest (and what the step passes through on its way:
// the intro, the lift). THE CONTRACT: the last action's `until` is exactly
// the step's `states`, so the runtime never counts a step as shown on a state
// she does not draw (Kula's cowgirl insertion 1635, fallback art under a
// tailored badge). An auto step whose first speed does not show her is none
// (only its climax, a minute away), and a step of the walk that shows nothing
// the steps before it did not is the same step again.
function pairSteps(G, walk, verdict0, shownOf0, opts) {
  const spoils = opts && typeof opts.spoils === 'function' ? opts.spoils : null;
  // (A step may be judged under its own variables: a companion's step under
  // the art variant it pins - opts.stepVerdict / stepShown, per step.)
  const stepVerdict = opts && typeof opts.stepVerdict === 'function' ? opts.stepVerdict : null;
  const stepShown = opts && typeof opts.stepShown === 'function' ? opts.stepShown : null;
  const out = [];
  const seen = new Set();
  for (const st of walk.steps) {
    const verdict = (stepVerdict && stepVerdict(st)) || verdict0;
    const shownOf = (stepShown && stepShown(st)) || shownOf0;
    const shows = (C) => !G.broken.has(C) && ['tailored', 'renders', 'partial'].includes(verdict(C));
    // (What the grab puts her in before its scenes - `pre` - counts where she
    // is drawn at all, her own sprites included.)
    const drawn = (C) => ['tailored', 'renders', 'partial', 'getHitOnly'].includes(verdict(C));
    const showing = st.until.filter(shows);
    if (!showing.length) continue;
    // (A helper receiver: a step that may draw her as her root anywhere on
    // its way is none for her.)
    if (spoils && [...st.until, ...(st.also || []), ...(st.pre || [])].some(spoils)) continue;
    if (st.kind === 'auto' && !shows(st.until[0])) continue;
    if (st.kind !== 'own' && !st.reader && !st.edge && showing.every((C) => seen.has(C)) && (st.kind === 'position' || st.kind === 'jump')) continue;
    const rest = [...new Set([...st.until, ...(st.also || []), ...(st.pre || []).filter(drawn)])].filter((C) => !showing.includes(C));
    const worst = showing.map(verdict).reduce((a, b) => (RANK[a] <= RANK[b] ? a : b));
    const step = { entry: st.entry, group: st.group, label: st.label, verdict: worst, states: showing };
    // A partial step says how much of the time she is drawn: the least of
    // its partial states' shares (the overlay's "[partial 43%]").
    if (worst === 'partial' && shownOf) {
      const shares = showing.filter((C) => verdict(C) === 'partial').map(shownOf).filter(Number.isFinite);
      if (shares.length) step.shown = Math.min(...shares);
    }
    // One drawn at most half the time whose scene also holds her where she
    // vanishes is the giver posing alone for most of it: none (Kur0maru's
    // Jedah on Sakura, 4132 on half its time, 4130 on sprites she lacks).
    if (step.shown !== undefined && step.shown <= 50 && rest.some((C) => verdict(C) === 'vanishes')) continue;
    if (rest.length) step.alsoStates = rest.sort((a, b) => a - b);
    step.path = st.path.map((a) => {
      const o = Object.assign({}, a);
      if (a.until) o.until = a.until.slice();
      if (a.set) o.set = a.set.map((x) => Object.assign({}, x));
      if (a.from) o.from = a.from.slice();
      return o;
    });
    if (step.path.length) step.path[step.path.length - 1].until = showing.slice();
    for (const k of ['place', 'approach', 'clear', 'clearAlso', 'edgeOnly', 'proj', 'setup', 'companion', 'nav', 'navRole', 'held', 'hisStages', 'navNew', 'fail', 'reroll', 'leaf', 'anims', 'noGrab', 'withCtrl', 'ext']) if (st[k] !== undefined) step[k] = JSON.parse(JSON.stringify(st[k]));
    // (A mode's step keeps its own field too, named by its ext.)
    if (st.ext && st[st.ext] !== undefined) step[st.ext] = JSON.parse(JSON.stringify(st[st.ext]));
    for (const C of showing) seen.add(C);
    // Two steps that show her the same states are one: the one made for
    // exactly those (Miyako's chausu climax, not the position whose rungs
    // she draws only at the climax; Kotaro's speed 1, not the auto that
    // shows her only its first speed).
    // (Twins - the same states from other states of his - stay two; so do a
    // companion's steps that show her the same states in another of its
    // animations: its art variants.)
    const key = JSON.stringify(showing) + (st.edge ? '|' + st.edge : '') + (st.artKey ? '|' + st.artKey : '');
    const narrowed = showing.length < st.until.length;
    const i = out.findIndex((x) => x.key === key);
    if (i >= 0) { if (out[i].narrowed && !narrowed) out[i] = Object.assign(step, { key }); continue; }
    step.narrowed = narrowed;
    step.key = key;
    out.push(step);
  }
  for (const s of out) { delete s.narrowed; delete s.key; }
  return out;
}

// ---- finishes: her orgasm per position, and the stages of his finish count ---------
// HER ART OVER A STATE'S OWN TIMES, under his held variables: her orgasm
// 6600 reads his position (`time = 0 && EnemyNear,fvar(23) = 1 &&
// selfanimexist(1805005)`, then `time = 100 && ...` 1805006, else 180500,
// else his 2234 on her sprites). The chain heldJudge plays on her first tick
// is played again at each later time a ChangeAnim line names, over what the
// tick before left; what the last leaves is what stays on screen, judged as
// heldJudge judges (her own answer first, else his fallback). A state that
// plays nothing at all is `unknown`: she keeps the pose of the state before,
// which is no answer of this one.
function heldChain(G, R, C, held, time, start) {
  const s = G.an.states.get(C);
  const nm = R.name ? R.name.toLowerCase() : null;
  const ctxOf = (anim) => {
    const ctx = { time, selfHas: R.airActions, isHelper: false,
      nameEq: (which, text) => (which === 'name' && nm !== null ? nm === String(text).toLowerCase() : null),
      redirVar: (name, id, v) => (HIM_REDIRECT.has(String(name).toLowerCase()) ? (held.has(v) ? held.get(v) : 0) : undefined) };
    if (Number.isFinite(anim)) ctx.anim = anim;
    return ctx;
  };
  let alts = start.slice();
  for (const sc of s.sctrls) {
    if (sc.type !== 'changeanim' && sc.type !== 'changeanim2') continue;
    const own = sc.type === 'changeanim';
    const trig = stateTrig(sc.trig, C);
    const raw = stateTrig({ all: [String(sc.params.get('value') === undefined ? '' : sc.params.get('value'))], groups: [] }, C).all[0];
    const next = [];
    for (const a of alts) {
      let v = null;
      try { v = X.evalTriggerSet(trig, ctxOf(a.n)); } catch (e) { v = null; }
      if (v === false) { next.push(a); continue; }
      let n = S.lit(raw);
      if (n === null) { try { n = X.evalExpr(raw, ctxOf(a.n)); } catch (e) { n = null; } }
      n = Number.isFinite(n) ? Math.trunc(n) : null;
      if (n === null || !(own ? R.airActions.has(n) : G.gAir.has(n))) { next.push(a); continue; }
      if (v !== true) next.push(a);
      next.push({ n, own });
    }
    alts = [];
    for (const a of next) if (!alts.some((b) => b.n === a.n && b.own === a.own)) alts.push(a);
  }
  return alts;
}
function timedJudge(G, R, C, held) {
  const s = G.an.states.get(C);
  if (!s) return { verdict: 'unknown', shown: null, anims: [] };
  const times = new Set([0]);
  for (const sc of s.sctrls) {
    if (sc.type !== 'changeanim' && sc.type !== 'changeanim2') continue;
    for (const e of [...sc.trig.all, ...sc.trig.groups.flat()]) for (const m of String(e).matchAll(/\btime\s*(?:=|>=)\s*(\d+)/gi)) { const t = +m[1]; if (t > 0 && t <= 1200) times.add(t); }
  }
  let alts = [{ n: S.lit(s.anim), own: true }];
  for (const t of [...times].sort((a, b) => a - b)) alts = heldChain(G, R, C, held, t, alts);
  const has = (k) => (R.rSff ? R.rSff.has(k) : false) || R.standIns.has(k);
  const keep = (slot, v, share) => {
    if (!slot.v || RANK[v] > RANK[slot.v]) { slot.v = v; slot.shown = share === undefined ? null : share; return; }
    if (RANK[v] === RANK[slot.v] && share !== null && share !== undefined && (slot.shown === null || share > slot.shown)) slot.shown = share;
  };
  const mine = { v: null, shown: null }, his = { v: null, shown: null };
  for (const a of alts) {
    if (a.n === null) continue;
    if (a.own) {
      if (!R.airActions.has(a.n) || noAnswer(G, R, C, a.n)) continue;
      const fr = [...(R.rAir.get(a.n) || [])];
      if (!fr.length) continue;
      if (!R.rSff) { keep(mine, 'unknown'); continue; }
      const present = fr.filter(has).length;
      keep(mine, present === fr.length ? 'tailored' : present ? 'partial' : 'vanishes', present && present < fr.length ? drawnShare(R.rAirTicks && R.rAirTicks.get(a.n), has) : null);
    } else {
      const fr = [...(G.gAir.get(a.n) || [])];
      if (!fr.length || !R.rSff) continue;
      const shownFr = fr.filter(has);
      const scene = shownFr.some(sceneFrame(R));
      const v = !shownFr.length ? 'vanishes' : !scene ? 'getHitOnly' : shownFr.length === fr.length ? 'renders' : 'partial';
      keep(his, v, v === 'partial' ? drawnShare(G.gAirTicks && G.gAirTicks.get(a.n), has) : null);
    }
  }
  const slot = mine.v && mine.v !== 'unknown' ? mine : his.v ? his : mine;
  return { verdict: slot.v || 'unknown', shown: slot.v === 'partial' ? slot.shown : null, anims: alts.filter((a) => a.n !== null).map((a) => a.n) };
}
// His variables a step holds for judging her: `held` (her orgasm's position,
// fvar(23) = k) and his copies of a companion's art variant in its setup.
const heldOf = (st) => new Map([...(st.held || []), ...(st.setup || []).filter((x) => x.art).map((x) => [x.kind + '(' + x.index + ')', x.value])]);

// A STEP PER STAGE (finishCounters): each listed step whose art changes at a
// level of his finish counter gets a copy right after it, held at that level
// (the step's own setup, over the pair's 0): where his own art in the step's
// states starts there (hisStages: DongHwan's position-2 press 42249 at
// var(32) = 5, Brian's "siru" helper in his speed cycle at var(4) = 2), or
// hers - a ChangeAnim, ChangeAnim2 or Explod of a state the step shows or
// passes that reads the counter of him and starts firing at the level with an
// action she draws (Brian's 1805000 at `enemyNear,var(4) >= 4` for a partner
// who ships it), or a ChangeState there into a scene of his that shows her
// (Bao's 16303 into her 65069 at `enemy,var(4) >= 4`: on the copy's way).
// Her own lines are read with his other variables at the 0 his grab starts
// them at, but those the step holds. `nav.stage` is the level's place among
// the counter's levels, and the label says it ("..., stage 3").
function pairStages(G, R, steps, verdict) {
  const counters = G.finishCounters || [];
  const shows = (C) => !G.broken.has(C) && ['tailored', 'renders', 'partial'].includes(verdict(C));
  const has = (k) => (R.rSff ? R.rSff.has(k) : false) || R.standIns.has(k);
  const nm = R.name ? R.name.toLowerCase() : null;
  // (Frames, not numbers: Kira's 1805000 is the same sprite as her 180500,
  // no new picture. Her animation is the state's chain played at each of
  // its times under the level - heldChain, as timedJudge plays it - and her
  // explods are the ones its lines fire there.)
  const framesOf = (list) => new Set(list.filter((a) => a.n !== null).flatMap((a) => [...((a.own ? R.rAir : G.gAir).get(a.n) || [])]));
  const sameSet = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));
  const chainAt = (C, heldL) => {
    const s = G.an.states.get(C);
    const times = new Set([0]);
    for (const sc of s.sctrls) {
      if (sc.type !== 'changeanim' && sc.type !== 'changeanim2') continue;
      for (const e of [...sc.trig.all, ...sc.trig.groups.flat()]) for (const m of String(e).matchAll(/\btime\s*(?:=|>=)\s*(\d+)/gi)) { const t = +m[1]; if (t > 0 && t <= 1200) times.add(t); }
    }
    let alts = [{ n: S.lit(s.anim), own: true }];
    for (const t of [...times].sort((a, b) => a - b)) alts = heldChain(G, R, C, heldL, t, alts);
    return alts;
  };
  const herStarts = (C, V, prev, L, held) => {
    const s = G.an.states.get(C);
    const out = { art: false, scenes: [] };
    if (!s || !G.an.scenes.has(C)) return out;
    const ctx = (x) => ({ selfHas: R.airActions, isHelper: false,
      nameEq: (which, text) => (which === 'name' && nm !== null ? nm === String(text).toLowerCase() : null),
      redirVar: (name, id, v) => (HIM_REDIRECT.has(String(name).toLowerCase()) ? (v === V.name ? x : held.has(v) ? held.get(v) : 0) : undefined) });
    const at = (x) => new Map([...held, [V.name, x]]);
    const explods = { 0: [], 1: [] };
    let reads = false;
    for (const sc of s.sctrls) {
      if (!STAGE_ART_HERS.has(sc.type)) continue;
      const r = [...sc.trig.all, ...sc.trig.groups.flat()].some((e) => { try { return X.readsOf(String(e)).some((q) => q.field === V.name && q.via && HIM_REDIRECT.has(String(q.via).toLowerCase())); } catch (er) { return false; } });
      if (!r) continue;
      reads = true;
      if (sc.type === 'changeanim' || sc.type === 'changeanim2') continue;
      const trig = stateTrig(sc.trig, C);
      const key = sc.type === 'explod' ? 'anim' : 'value';
      const raw = String(sc.params.get(key) === undefined ? '' : sc.params.get(key)).trim();
      if (sc.type === 'explod' && /^[fs]\s*\d/i.test(raw)) continue;
      const fires = [prev, L].map((x) => { try { return X.evalTriggerSet(trig, ctx(x)); } catch (er) { return null; } });
      [prev, L].forEach((x, i) => {
        if (fires[i] === false) return;
        let n = S.lit(raw);
        if (n === null) { try { n = X.evalExpr(stateTrig({ all: [raw], groups: [] }, C).all[0], ctx(x)); } catch (er) { n = null; } }
        n = Number.isFinite(n) ? Math.trunc(n) : null;
        if (n === null) return;
        // (A ChangeState that starts at the level: a scene of his on the way.)
        if (sc.type === 'changestate') { if (i === 1 && fires[0] === false && n !== C && G.hScenes.has(n) && shows(n)) out.scenes.push(n); return; }
        if (R.airActions.has(n)) explods[i].push({ n, own: true });
      });
    }
    if (!reads) return out;
    // (A new picture: an alternative her state may play at the level whose
    // frames none of the level below's give - a line the reading cannot
    // decide keeps both ways at either level.)
    const pics = (alts) => alts.filter((a) => a.n !== null).map((a) => framesOf([a])).filter((f) => f.size);
    const p0 = pics(chainAt(C, at(prev)));
    const newAnim = pics(chainAt(C, at(L))).some((f) => [...f].some(has) && !p0.some((g) => sameSet(f, g)));
    const e1 = framesOf(explods[1]), e0 = framesOf(explods[0]);
    const newExplod = !sameSet(e1, e0) && [...e1].some(has);
    out.art = newAnim || newExplod;
    return out;
  };
  const out = [];
  for (const st of steps) {
    out.push(st);
    const held = heldOf(st);
    for (const V of counters) {
      let prev = 0;
      V.levels.forEach((L, i) => {
        const his = !!(st.hisStages && st.hisStages[V.name] && st.hisStages[V.name].includes(L));
        let art = his;
        const scenes = [];
        for (const C of [...st.states, ...(st.alsoStates || [])]) {
          const h = herStarts(C, V, prev, L, held);
          if (h.art) art = true;
          for (const C2 of h.scenes) if (!scenes.includes(C2)) scenes.push(C2);
        }
        prev = L;
        if (!art && !scenes.length) return;
        const cp = JSON.parse(JSON.stringify(st));
        cp.label = st.label + ', stage ' + (i + 1);
        cp.setup = [...(st.setup || []).filter((x) => !(x.kind === V.kind && x.index === V.index)),
          { kind: V.kind, index: V.index, value: L, why: ('holds his ' + V.name + ' at ' + L + ': stage ' + (i + 1) + ' of his finish count, where '
            + (his ? 'his' : 'her') + ' art changes (the stages: ' + V.levels.join(', ') + ')').replace(/[^\x20-\x7e]/g, '?') }];
        if (scenes.length) cp.alsoStates = [...new Set([...(cp.alsoStates || []), ...scenes])].filter((C) => !cp.states.includes(C)).sort((a, b) => a - b);
        // (That scene comes after the step's own states and is where it
        // ends: Bao's 65069, her lie-down, which she never leaves. The runtime
        // grabs again once it has been on screen a while.)
        const ends = scenes.filter((C) => !cp.states.includes(C));
        if (ends.length) cp.endStates = [...new Set([...(cp.endStates || []), ...ends])].sort((a, b) => a - b);
        cp.stageOf = { base: st, stage: i + 1 };
        out.push(cp);
      });
    }
  }
  return out;
}

// NAV of the steps this build adds (the NAVIGATION section below has the
// axes). The deriver (deriveNav) places them as every step a companion's walk
// has not placed (navOf), with what is said here: `navHint` - her orgasm is
// a climax, the other finish of his (Delete/End step between the two), a
// gauge gate's failure a one-off - and `navStage`, a stage copy's stage (its
// step's place at that stage). A copy of a step that has nav already (a
// companion's) takes it here.
function navHintOf(st) {
  if (st.companion) return null;
  if (st.fail) return { oneOff: true };
  if (/^orgasm\b/.test(String(st.label || ''))) return { climax: true, finish: true };
  // (A buff's climax, "climax 2 (hold c)": a second finish of its position.)
  if (/^climax \d+ \(/.test(String(st.label || ''))) return { climax: true, finish: true };
  return null;
}
// The pair's steps as the runtime gets them: the stage copies after each
// step, what the deriver needs of this build's own new steps, and the working
// fields dropped.
function finishPair(G, R, steps, verdict) {
  const all = pairStages(G, R, steps, verdict);
  // (The base comes before its copies, so its nav is set by then.)
  for (const st of all) {
    if (st.stageOf) {
      if (st.stageOf.base.nav) st.nav = Object.assign({}, st.stageOf.base.nav, { stage: st.stageOf.stage });
      else st.navStage = st.stageOf.stage;
    } else if (st.navNew || st.fail) {
      const h = navHintOf(st);
      if (h) st.navHint = h;
    }
  }
  for (const st of all) { delete st.stageOf; delete st.held; delete st.hisStages; delete st.navNew; delete st.fail; }
  return all;
}

// ---- NAVIGATION: the axes the gallery's keys move along ---------------------------
// Every step carries `nav` { pos, speed, ver, climax, stage } (gallery.js moves
// along it: Left/Right the position, Up/Down its version, Delete/End its speed,
// Space its climax, Home its stage):
//   pos     a string key: steps with the same key are ONE position; positions
//           are ordered by first appearance in the pair's list; a one-off (a
//           grab alone, a summon, a dog) is a position of its own;
//   speed   0 the position's base (its hold), 1..n its speeds in the order his
//           own inputs step them, 'auto' his auto mode (after the top speed);
//           null on a climax and where the position has no speeds;
//   ver     the 0-based version: an art look (a companion's art pins: Bao's
//           var(3), upright or bent over; var(33), under him or on top), or
//           where NAV ROLES put two bases or two speeds of one rank in one
//           hub, each of them (Minotaur's horse foreplays); 0 with one;
//   climax  true on its climax;
//   stage   0 the base, 1..n finish-count stage levels.
// deriveNav gives it to every step that has none, from what the steps carry
// (never a giver's name or state numbers): a group whose name ends in
// "position k" (DongHwan's hub, Kur0maru's Bao, Minotaur's ladder, Brian's
// positions) is one position, and so is a group whose labels mark a speed, a
// phase, a climax or auto; a companion's step is its position by its `go` (its
// counter's value: Bao's positions 1-4), its grab alone a one-off; a walk
// step none of that places, by its NAV ROLE (its hub, where two or more steps
// share it: base 0, speeds ranked as the hub lists them, a finish its climax,
// several finishes its pictures, a second base or speed in one place a
// version); any other step is a one-off. Speeds come from the labels ("speed k", a ladder's "phase
// k"), ranked 1..n, the unmarked step being the base; versions are the
// companion's art pins in order of first appearance in the position; stages
// are 0. A step that has nav keeps it, and a step without one joins the
// position of a step with nav that this rule puts beside it (its key wins).
// A stage copy of a step without nav (the finishes' `navStage`) takes its
// step's nav, at its stage.
const NAV_STEP = /\b(?:speed|phase) (\d+)\b/i;
const NAV_CLIMAX = /\bclimax\b/i;
const NAV_AUTO = /\bauto\b/i;
// (A speed the walker names with no number: "hold a, speed".)
const NAV_SPEED_BARE = /, speed$/i;
const navMarked = (label) => NAV_STEP.test(label) || NAV_CLIMAX.test(label) || NAV_AUTO.test(label);
function validNav(n) {
  return !!n && typeof n === 'object' && ((typeof n.pos === 'string' && n.pos !== '') || Number.isFinite(n.pos))
    && (n.speed == null || n.speed === 'auto' || (Number.isInteger(n.speed) && n.speed >= 0))
    && (n.ver == null || (Number.isInteger(n.ver) && n.ver >= 0))
    && (n.climax == null || typeof n.climax === 'boolean')
    && (n.stage == null || (Number.isInteger(n.stage) && n.stage >= 0));
}
function deriveNav(pair) {
  const steps = pair && Array.isArray(pair.steps) ? pair.steps : [];
  const hintOf = (s) => (s && s.navHint && typeof s.navHint === 'object' ? s.navHint : null);
  // The groups that are one position (a step the finishes add to a group -
  // her orgasm at the grope stage - makes it one: the grab and her orgasm
  // there are one position).
  const posGroup = new Set();
  for (const s of steps) {
    if (!s || s.companion || Number.isInteger(s.navStage)) continue;
    const g = String(s.group || ''), h = hintOf(s);
    if (h && h.oneOff) continue;
    if (/\bposition \d+$/i.test(g) || navMarked(String(s.label || '')) || h) posGroup.add(s.entry + '|' + g);
  }
  // (Its key is the group's name; the grab's too where two grabs of the pair
  // have a group of that name.)
  const entriesOf = new Map();
  for (const k of posGroup) { const g = k.slice(k.indexOf('|') + 1); entriesOf.set(g, (entriesOf.get(g) || 0) + 1); }
  // (A walk step's role in its grab - `navRole`, NAV ROLES in giverSteps -
  // places a step no rule above does, where two or more share its hub.)
  const roleOf = (s) => (s && !s.companion && !Number.isInteger(s.navStage) && s.navRole && typeof s.navRole.key === 'string'
    && !posGroup.has(s.entry + '|' + String(s.group || '')) && !(hintOf(s) || {}).oneOff ? s.navRole : null);
  const roleCount = new Map();
  for (const s of steps) { const r = roleOf(s); if (r && !validNav(s.nav)) roleCount.set(r.key, (roleCount.get(r.key) || 0) + 1); }
  const roleKey = (s) => { const r = roleOf(s); return r && roleCount.get(r.key) > 1 ? r.key : null; };
  const natural = (s, i) => {
    if (s.companion) {
      const go = s.companion.go;
      return go && Number.isFinite(go.value) ? 'companion ' + s.companion.id + ' position ' + go.value : 'one-off ' + (i + 1);
    }
    const h = hintOf(s);
    if (h && h.oneOff) return 'one-off ' + (i + 1);
    const g = String(s.group || ''), k = s.entry + '|' + g;
    return posGroup.has(k) ? (entriesOf.get(g) > 1 ? k : g) : roleKey(s) || 'one-off ' + (i + 1);
  };
  // A step that has nav keeps it; its key names the position for the rest.
  const keyOf = new Map();
  steps.forEach((s, i) => { if (s && validNav(s.nav) && !keyOf.has(natural(s, i))) keyOf.set(natural(s, i), String(s.nav.pos)); });
  const byPos = new Map();
  steps.forEach((s, i) => {
    if (!s || validNav(s.nav) || Number.isInteger(s.navStage)) return;
    const n = natural(s, i);
    const pos = keyOf.get(n) || n;
    if (!byPos.has(pos)) byPos.set(pos, []);
    byPos.get(pos).push(s);
  });
  for (const [pos, list] of byPos) {
    // A position of roles: its speeds ranked as the hub lists them, its
    // finishes a climax (several: its pictures, Delete/End between them), and
    // a second step in one place a version of it.
    if (list.every((s) => roleKey(s) === pos)) {
      const ranks = [...new Set(list.filter((s) => s.navRole.role === 'speed').map((s) => s.navRole.rank))].sort((a, b) => a - b);
      const cls = list.filter((s) => s.navRole.role === 'climax');
      const used = new Map();
      for (const s of list) {
        const r = s.navRole;
        const climax = r.role === 'climax';
        // (An auto role is the position's auto: AUTO BY SET, in the walk.)
        const speed = climax ? (cls.length > 1 ? cls.indexOf(s) + 1 : null) : r.role === 'auto' ? 'auto' : ranks.length ? (r.role === 'speed' ? ranks.indexOf(r.rank) + 1 : 0) : null;
        const slot = (climax ? 'c' : 's') + speed;
        const ver = used.get(slot) || 0;
        used.set(slot, ver + 1);
        s.nav = { pos, speed, ver, climax, stage: 0 };
      }
      continue;
    }
    // Its speeds, ranked in the order the labels number them.
    const plain = list.filter((s) => !hintOf(s));
    const nums = [...new Set(plain.map((s) => String(s.label || '')).filter((l) => !NAV_CLIMAX.test(l) && !NAV_AUTO.test(l))
      .map((l) => NAV_STEP.exec(l)).filter(Boolean).map((m) => +m[1]))].sort((a, b) => a - b);
    const auto = plain.some((s) => NAV_AUTO.test(String(s.label || '')) && !NAV_CLIMAX.test(String(s.label || '')));
    // (Speeds named with no number - JenetBonne's "hold a, speed", "hold b,
    // speed", "hold y, speed" - after the numbered ones, in list order.)
    const bare = [...new Set(plain.map((s) => String(s.label || '')).filter((l) => !NAV_CLIMAX.test(l) && !NAV_AUTO.test(l) && !NAV_STEP.test(l) && NAV_SPEED_BARE.test(l)))];
    // Its versions: a companion's art pins, in order of first appearance.
    const vers = [];
    const verOf = (s) => {
      const pins = (s.companion && Array.isArray(s.companion.pins) ? s.companion.pins : []).filter((e) => e && e.art)
        .map((e) => e.kind + '(' + e.index + ')=' + e.value).sort().join(',');
      let v = vers.indexOf(pins);
      if (v < 0) { vers.push(pins); v = vers.length - 1; }
      return v;
    };
    for (const s of list) {
      const l = String(s.label || '');
      const climax = NAV_CLIMAX.test(l);
      let speed = null;
      if (!climax && (nums.length || auto || bare.length)) {
        const m = NAV_STEP.exec(l);
        speed = NAV_AUTO.test(l) ? 'auto' : m ? nums.indexOf(+m[1]) + 1 : bare.includes(l) ? nums.length + bare.indexOf(l) + 1 : 0;
      }
      s.nav = { pos, speed, ver: verOf(s), climax, stage: 0 };
      // (What the finishes said of it: her orgasm is a climax.)
      const h = hintOf(s);
      if (h && h.finish) { s.nav.climax = true; s.nav.speed = null; }
    }
    // Her orgasm is his climax's other finish: where the position has a
    // climax of its own at that version, that one is finish 1 and hers
    // finish 2 (Delete/End step between them, as between a climax's
    // pictures); else hers is its only climax (the grab's), still numbered
    // 2, so Left/Right from one orgasm go to the next position's orgasm.
    const cls = new Map();
    for (const s of list) if (s.nav.climax) { const v = s.nav.ver; if (!cls.has(v)) cls.set(v, []); cls.get(v).push(s); }
    for (const cl of cls.values()) {
      const fin = cl.filter((s) => (hintOf(s) || {}).finish);
      if (!fin.length) continue;
      const own = cl.filter((s) => !(hintOf(s) || {}).finish);
      let n = own.length ? 0 : 1;
      for (const s of own) { if (!Number.isInteger(s.nav.speed)) s.nav.speed = n + 1; n = Math.max(n, s.nav.speed); }
      for (const s of fin) s.nav.speed = ++n;
    }
  }
  // A stage copy (`navStage`, from the finishes) is its step's place at its
  // stage: its step is the nearest step before it that is no copy.
  let base = null;
  for (const s of steps) {
    if (!s) continue;
    if (!Number.isInteger(s.navStage)) { base = s; continue; }
    if (!validNav(s.nav)) s.nav = Object.assign({}, base && validNav(base.nav) ? base.nav : { pos: 'one-off ' + (steps.indexOf(s) + 1), speed: null, ver: 0, climax: false }, { stage: s.navStage });
    delete s.navStage;
  }
  // Versions are 0-based among the looks the pair's position HAS: 0 where it
  // has one (Gardevoir's Bao position 4, on top only, whose walk numbered it
  // by the variant: 1).
  const versAt = new Map();
  for (const s of steps) if (s && validNav(s.nav)) { const k = String(s.nav.pos); if (!versAt.has(k)) versAt.set(k, new Set()); versAt.get(k).add(s.nav.ver || 0); }
  for (const s of steps) {
    if (!s) continue;
    delete s.navHint;
    delete s.navRole;
    if (!validNav(s.nav)) continue;
    const vs = [...versAt.get(String(s.nav.pos))].sort((a, b) => a - b);
    s.nav.ver = vs.indexOf(s.nav.ver || 0);
  }
  return pair;
}

// ---- GRAB REACH and AIR START (galreach.js) ------------------------------------
// Every step of a grab the model says misses from the runtime's default
// stand carries `reach` (the stand distance, 320 units) and `reachMin` (the
// least that connects); every step of a grab state with physics A carries
// `air` { y, vx, vy } (his own units: where his lead's arc or his jump's apex
// puts him). Per entry, never on a step that has its own place, a companion's
// or a nested summon's; a summon whose helper spawns at his side reads the
// helper's motion. A summon placed at the edge (postype front)
// has its place.front brought in to where the helper's box reaches her back
// (galreach summonFront). Absent = today's behavior.
// AN ANTI-AIR GRAB (galreach liftOf; the step's `lift` { y, anim }): a grab of
// his whose box never reaches her standing height and hits the air is played
// with her held in the air - `y` her own units, up negative, on her `anim`
// (her neutral jump, else her stand) - and a `reach` where the default stand
// misses her there. Murakami's high grabs (484 "grab c" and the other anim-420
// ones) caught nobody standing: "this scene did not start".
// A SCENE IN THE AIR (galreach highOf; the step's `high`, 320 units, up
// negative): where his grab takes her off the ground and his scene holds him
// up there, how high his feet go - the runtime zooms one pair's view out so
// both are on screen (Murakami's winged demon, 487: -149).
function stampReach(G, R, steps) {
  if (!galreach || !R || !R.body) return;
  const per = new Map();
  for (const st of steps) {
    // (A summon placed at the edge whose helper stands where it spawns: her
    // stand from the edge so her back reaches its box - galreach summonFront.)
    if (st.place && st.clear !== undefined && !st.companion && !st.ext && galreach.summonFront) {
      let f = null;
      try {
        const sm = (G.summons || []).find((x) => x.no === st.entry && x.helper === st.clear);
        f = sm ? galreach.summonFront(G, sm, R.body) : null;
      } catch (e) { f = null; }
      if (f !== null && f < st.place.front) st.place = Object.assign({}, st.place, { front: f });
      continue;
    }
    if (st.companion || st.place || st.ext) continue;
    if (!per.has(st.entry)) {
      let r = null, air = null, lift = null, high = null;
      try {
        const sm = st.clear !== undefined ? (G.summons || []).find((x) => x.no === st.entry && x.helper === st.clear) : null;
        if (st.clear !== undefined) r = sm ? galreach.summonReach(G, sm, R.body) : null;
        else {
          r = galreach.giverReach(G, st.entry, R.body); air = galreach.airOf(G, st.entry);
          lift = !r && R.liftBody && galreach.liftOf ? galreach.liftOf(G, st.entry, R.body, R.liftBody) : null;
          high = !r && !lift && galreach.highOf ? galreach.highOf(G, st.entry, R.body) : null;
        }
      } catch (e) { r = null; air = null; lift = null; high = null; }
      per.set(st.entry, { r, air, lift, high });
    }
    const { r, air, lift, high } = per.get(st.entry);
    if (r) { st.reach = r.d; st.reachMin = r.lo; }
    if (air) st.air = { y: air.y, vx: air.vx, vy: air.vy };
    if (lift) {
      st.lift = { y: lift.y, anim: lift.anim };
      if (Number.isFinite(lift.d)) st.reach = lift.d;
    }
    if (Number.isFinite(high)) st.high = high;
  }
}

// A pair's COMMAND ALIASES: { name: [aliases] } for the commands its steps
// assert that have one (the hook asserts them together), or null.
function cmdAliasOf(G, steps) {
  if (!G.cmdAlias || !G.cmdAlias.size) return null;
  const out = {};
  for (const st of steps) for (const a of st.path || []) if (typeof a.cmd === 'string' && G.cmdAlias.has(a.cmd)) out[a.cmd] = G.cmdAlias.get(a.cmd).slice();
  return Object.keys(out).length ? out : null;
}

// ---- the build ----------------------------------------------------------------
function rosterChars(roster, cacheDir) {
  const V = require('./vfslib.js');
  const mounts = V.mountNames(roster);
  const out = [];
  const seen = new Set();
  for (const c of (roster && roster.chars) || []) {
    if (c.kind || !c.folder || !c.select) continue;
    const select = V.selectPathFor(c, mounts);
    if (seen.has(select)) continue;
    seen.add(select);
    out.push(Object.assign({ select, dir: path.join(cacheDir, c.folder), def: String(c.select).split('/').slice(1).join('/') },
      c.hRole ? { hRole: c.hRole } : {}));
  }
  return out;
}

// ---- PROTOTYPE MODES (gallerymodes/): their steps, beside the core's ---------------
// (The rules are in the header's PROTOTYPE MODES paragraph.)
const MODE_ID = /^[a-z][a-z0-9]{1,11}$/;
// The fields pairSteps does not carry that a mode's walk-shaped steps may
// have (ctx.pairSteps carries them, and the mode's own `step[id]`).
const MODE_CARRY = ['ext', 'withCtrl', 'noGrab'];
// A mode's read of a giver, once per base (a base is made again when his
// files change, so this is kept by his files' signature too).
const modeReads = new WeakMap();
const modeWarn = (M, what, e) => console.warn('H gallery: mode ' + M.id + ' left out ' + what + ': ' + String((e && e.message) || e).slice(0, 200));
// gallerydata's exports and the module helpers a mode may need (ctx.lib).
let modeLibMemo = null;
const modeLib = () => modeLibMemo || (modeLibMemo = Object.freeze(Object.assign({}, module.exports,
  { NO_INPUT, VARNAME, varRef, readCompanionPlay, isBasic, fileSig, HER_LIFE, X, S, modlib })));
// The modes asked for: each a module with a valid id, once; anything else
// is left out with a warning.
function modeList(list) {
  const out = [];
  for (const M of Array.isArray(list) ? list : []) {
    if (!M || typeof M !== 'object' || !MODE_ID.test(String(M.id))) { console.warn('H gallery: a mode without a valid id is left out'); continue; }
    if (out.some((x) => x.id === M.id)) continue;
    out.push(M);
  }
  return out;
}
// Per mode and giver: its memo (ctx.memo) and its read(base, ctx) (ctx.reading;
// undefined for a mode with no read). A read that throws is null, warned.
function modeGiver(M, G, g) {
  let per = modeReads.get(G);
  if (!per) { per = new Map(); modeReads.set(G, per); }
  if (!per.has(M.id)) {
    const memo = new Map();
    let reading;
    if (typeof M.read === 'function') {
      try { reading = M.read(G, { id: M.id, g, fns: G.fns || {}, memo, lib: modeLib() }); } catch (e) { modeWarn(M, 'for ' + g.select, e); reading = null; }
      if (reading === undefined) reading = null;
    }
    per.set(M.id, { memo, reading });
  }
  return per.get(M.id);
}
// One mode's part of one pair, kept like the core's: { steps, claims, counts,
// setup } or null. Its steps are tagged `ext: <id>`.
function modePair(M, G, R, g, r) {
  if (typeof M.pair !== 'function') return null;
  const mg = modeGiver(M, G, g);
  // (A mode that reads givers is asked only about the ones its read answered.)
  if (typeof M.read === 'function' && mg.reading == null) return null;
  return cachedIn(CACHE.pairs, g.dir + '|' + g.def + '>' + r.dir + '|' + r.def + '#mode:' + M.id, g.sig + '>' + r.sig, () => {
    // The pair's judging, as the core's (made only when the mode asks).
    const judged = new Map();
    const judge = (C) => { if (!judged.has(C)) judged.set(C, sceneJudge(G, R, C)); return judged.get(C); };
    let hc;
    const held = () => (hc === undefined ? (hc = companionHeld(G, R, judge)) : hc);
    const verdict = (C) => (held() && held().reads(C) ? held().best(C).verdict : judge(C).verdict);
    const shownOf = (C) => (held() && held().reads(C) ? held().best(C).shown : judge(C).shown);
    const clone = (v) => JSON.parse(JSON.stringify(v));
    const ctx = {
      id: M.id, g, r, reading: mg.reading, memo: mg.memo, fns: G.fns || {}, lib: modeLib(),
      walk: () => giverSteps(G, R.airActions),
      judge, verdict, shownOf,
      // Walk-shaped steps judged for her (pairSteps), carrying MODE_CARRY and
      // step[id]; a mode's steps keep one entry + group + label each.
      pairSteps: (steps, o) => {
        const src = new Map();
        for (const st of steps) { const k = st.entry + '|' + st.group + '|' + st.label; if (!src.has(k)) src.set(k, st); }
        const out = pairSteps(G, { steps }, verdict, shownOf, o);
        for (const s of out) {
          const st = src.get(s.entry + '|' + s.group + '|' + s.label);
          if (!st) continue;
          for (const k of [...MODE_CARRY, M.id]) if (st[k] !== undefined && s[k] === undefined) s[k] = clone(st[k]);
        }
        return out;
      },
      finishPair: (steps) => finishPair(G, R, steps, verdict),
    };
    let x = null;
    try { x = M.pair(G, R, ctx); } catch (e) { modeWarn(M, 'for ' + g.select + ' x ' + r.select, e); return null; }
    if (!x || typeof x !== 'object') return null;
    let steps = Array.isArray(x.steps) ? x.steps.filter((s) => s && typeof s === 'object' && Array.isArray(s.states) && Array.isArray(s.path)) : [];
    try { steps = clone(steps); } catch (e) { modeWarn(M, 'for ' + g.select + ' x ' + r.select, e); return null; }
    if (!steps.length) return null;
    for (const s of steps) s.ext = M.id;
    const claims = typeof x.claims === 'function' ? x.claims : Array.isArray(x.claims) || x.claims instanceof Set ? [...x.claims].filter(Number.isFinite) : null;
    const counts = x.counts && typeof x.counts === 'object' ? Object.fromEntries(Object.entries(x.counts).filter(([, v]) => Number.isFinite(v))) : null;
    const setup = Array.isArray(x.setup) ? clone(x.setup) : null;
    return { steps, claims, counts, setup };
  });
}
// A mode's steps into the pair's list: in place of the core steps it CLAIMS
// (at the first one's place), else after every step before it.
function modeInto(list, x, M) {
  let at = -1;
  if (x.claims) {
    let claimed;
    if (typeof x.claims === 'function') {
      claimed = (st) => { try { return !!x.claims(st); } catch (e) { modeWarn(M, 'its claims', e); return false; } };
    } else {
      // (an entry only where one of its own steps grabs with it)
      const want = new Set(x.claims.filter((e) => x.steps.some((s) => s.entry === e)));
      claimed = (st) => !st.companion && want.has(st.entry);
    }
    const kept = [];
    for (const st of list) {
      if (!st.ext && claimed(st)) { if (at < 0) at = kept.length; } else kept.push(st);
    }
    list = kept;
  }
  const mine = JSON.parse(JSON.stringify(x.steps));
  return at < 0 ? list.concat(mine) : [...list.slice(0, at), ...mine, ...list.slice(at)];
}
// The counts of a pair only modes make, before their own counts are added:
// his scenes, and what his walk for her leaves unreachable.
function modeCounts(G, R) {
  let walk = null;
  try { walk = giverSteps(G, R.airActions); } catch (e) { walk = null; }
  return { scenes: G.hScenes.size, tailored: 0, renders: 0, partial: 0, getHitOnly: 0, vanishes: 0, unknown: 0, unreachable: walk ? walk.unreachable.length : 0 };
}

// opts:
//   roster    the roster object (default: the active roster.json)
//   cacheDir  where its folders live (default: the layout's characters folder)
//   chars     [{ select, dir, def }] instead of a roster (tests, other sets)
//   stats     an object to fill with timings and sizes (optional)
//   modes     the prototype modes, as gallerymodes/index.js enabled(roster)
//             or load(ids) gives them (default none: the gallery as it was)
//   persist   keep the pairs in the bundle's pair file across starts (THE
//             PAIRS, KEPT ACROSS STARTS above; the build's own call)
// A character whose files cannot be read is left out, never fatal.
function buildGalleryData(opts) {
  if (!(opts && opts.persist)) return buildGalleryDataNow(opts);
  try { persistLoad(); } catch (e) { /* no file read: every pair is worked out */ }
  PAIRS_USED = PERSIST.used;
  let out;
  try { out = buildGalleryDataNow(opts); } finally { PAIRS_USED = null; }
  try { persistSave(PERSIST.used); } catch (e) { /* never the build's failure */ }
  return out;
}
function buildGalleryDataNow(opts) {
  opts = opts || {};
  const t0 = Date.now();
  const modes = modeList(opts.modes);
  let chars = opts.chars;
  if (!chars) {
    const roster = opts.roster || require('./vfslib.js').readRoster();
    const cacheDir = opts.cacheDir || require('./layout.js').dir('cache');
    chars = rosterChars(roster, cacheDir);
  }
  const before = Object.assign({}, stat);
  const people = [];
  for (const ch of chars) {
    let info = null;
    try { if (fs.statSync(path.join(ch.dir, ch.def)).isFile()) info = readInfo(ch.dir, ch.def); } catch (e) { info = null; }
    if (!info) continue;
    people.push(Object.assign({}, ch, { info, sig: fileSig(ch.dir, ch.def) }));
  }
  const recvCache = new Map();
  const receiver = (p) => {
    if (!recvCache.has(p.select)) { let r = null; try { r = describeReceiver(p.dir, p.def, p.sig); } catch (e) { r = null; } recvCache.set(p.select, r); }
    return recvCache.get(p.select);
  };
  const tScan = Date.now();
  // THE OWNER'S WORD (chars[i].hRole, hmodule.js) over the scan's: 'none' is in
  // no pair at all; 'receiver' is never a giver here, 'giver' never a
  // receiver; 'giver' and 'both' are tried as givers even where the scan saw
  // none - the gallery then shows only the scenes it can read.
  for (let i = people.length - 1; i >= 0; i--) if (people[i].hRole === 'none') people.splice(i, 1);
  const givers = [];
  for (const p of people) {
    const r = receiver(p);
    if (p.hRole === 'receiver') continue;
    if ((r && r.isGiver) || p.hRole === 'giver' || p.hRole === 'both') givers.push(p);
  }
  const scanMs = Date.now() - tScan;
  const who = (p) => { const o = { select: p.select, name: p.info.name, display: p.info.display }; if (p.info.nameHex) o.nameHex = p.info.nameHex; return o; };
  const byName = (a, b) => a.info.display.toLowerCase().localeCompare(b.info.display.toLowerCase()) || a.select.localeCompare(b.select);
  const pairs = [];
  const giverMs = {}, walks = {};
  let pairMs = 0;
  for (const g of givers.slice().sort(byName)) {
    const tg = Date.now();
    let G = null;
    try { G = giverBase(g.dir, g.def, g.sig); } catch (e) { G = null; }
    giverMs[g.select] = Date.now() - tg;
    if (!G || !G.hScenes.size) continue;
    const tp = Date.now();
    // THE MIRROR PAIR (2026-10-12): a character who is both - the owner's
    // hRole 'both', or the scan's giver AND receiver with no word of his - is
    // also his own receiver, the same character on both sides (Minotaur's
    // victim states ChangeAnim to her own action where SelfAnimExist, so his
    // own female art in groups 6000-7999 shows only when a Minotaur is the
    // one grabbed). Judged like any pair; a plain giver gets none.
    const mirrors = (p) => { const R = receiver(p); return !!R && hmodule.effectiveRole(p, { giver: R.isGiver, receiver: R.isReceiver }).receiver; };
    for (const r of people.filter((x) => (x.select !== g.select || mirrors(g)) && x.hRole !== 'giver').sort(byName)) {
      let R = receiver(r);
      if (!R) continue;
      // (In his own mirror pair the owner's 'both' is the receiver verdict
      // the scan did not reach: the GIVER WHO IS NO RECEIVER reading below -
      // his own actions as her answer only where they draw receiver-window
      // groups, none when his -2 acts - is for another giver's scene. Here
      // the engine answers SelfAnimExist from his whole .air, as for anyone
      // the scan reads as both.)
      if (r.select === g.select && R.answers) R = Object.assign({}, R, { answers: null, actsInScene: null });
      // A giver who is no receiver is one only where his art answers with
      // receiver-window sprites (R.answers, in sceneVerdict: Kur0maru's
      // Kuromaru-template woman for DongHwan and Brian; never DongHwan's hub
      // overlay 42249 or Brian's 27230), and never when his -2 would act in
      // the scene (a helper, a state change: Brian's Striker).
      if (R.answers && R.actsInScene && R.actsInScene.length) continue;
      // One pair's steps and counts, kept while both characters' files are.
      const made = cachedIn(CACHE.pairs, g.dir + '|' + g.def + '>' + r.dir + '|' + r.def, g.sig + '>' + r.sig, () => {
        let walk = null;
        try { walk = giverSteps(G, R.airActions); } catch (e) { walk = null; }
        if (!walk || !walk.steps.length) return null;
        const judged = new Map();
        const judge = (C) => { if (!judged.has(C)) judged.set(C, sceneJudge(G, R, C)); return judged.get(C); };
        // (Her state in his companion's scenes that reads his copy of its art
        // variant - `enemy,var(23)` in 51409-51412 - is judged under the
        // variant a step holds (heldJudge), and on its own by the best of the
        // variants his files draw.)
        const hc = companionHeld(G, R, judge);
        const verdict = (C) => (hc && hc.reads(C) ? hc.best(C).verdict : judge(C).verdict);
        const counts = { scenes: G.hScenes.size, tailored: 0, renders: 0, partial: 0, getHitOnly: 0, vanishes: 0, unknown: 0, unreachable: walk.unreachable.length };
        const reachable = new Set(walk.steps.flatMap((st) => [...st.until, ...(st.also || [])]).filter((C) => G.hScenes.has(C)));
        for (const C of reachable) counts[verdict(C)]++;
        const shownOf = (C) => (hc && hc.reads(C) ? hc.best(C).shown : judge(C).shown);
        // (Her orgasm reads his position of him: a step that holds his
        // variables for judging - `held` - is judged under them, over her
        // state's own times: timedJudge.)
        const timed = new Map();
        const timedAt = (C, held) => {
          const k = C + '|' + [...held].map(([n, v]) => n + '=' + v).join(',');
          if (!timed.has(k)) timed.set(k, timedJudge(G, R, C, held));
          return timed.get(k);
        };
        const heldRead = (st, C) => heldReads(G, C, new Set(st.held.map(([n]) => n)));
        const stepVerdict = (st) => (st.held ? (C) => (heldRead(st, C) ? timedAt(C, heldOf(st)).verdict : verdict(C)) : hc ? hc.stepVerdict(st) : null);
        const stepShown = (st) => (st.held ? (C) => (heldRead(st, C) ? timedAt(C, heldOf(st)).shown : shownOf(C)) : hc ? hc.stepShown(st) : null);
        const steps = finishPair(G, R, pairSteps(G, hc ? hc.adapt(walk) : walk, verdict, shownOf, { stepVerdict, stepShown }), verdict);
        // No pair of generic reactions alone (Kur0maru x Guile: only his
        // electric shock, her common 7696): one of its steps must show a
        // scene of the H idiom.
        if (!steps.some((st) => st.states.some((C) => !genericScene(G, R, C)))) return null;
        stampReach(G, R, steps);
        return { counts, steps };
      }, () => { stat.pairs++; });
      // A prototype mode's steps (gallerymodes/): after the core's, or in
      // place of the core steps it claims; a pair of their own, at this
      // place, where the core has none for her. Never on her helper's pair.
      const core = made && made.steps.length ? made : null;
      const extra = [];
      for (const M of modes) { const x = modePair(M, G, R, g, r); if (x) extra.push([M, x]); }
      if (core || extra.length) {
        const counts = Object.assign({}, core ? core.counts : modeCounts(G, R));
        let steps = core ? JSON.parse(JSON.stringify(core.steps)) : [];
        for (const [M, x] of extra) {
          steps = modeInto(steps, x, M);
          if (x.counts) for (const [k, v] of Object.entries(x.counts)) counts[k] = Math.max(0, (counts[k] || 0) + v);
        }
        const pair = { giver: who(g), receiver: who(r), counts };
        // (No body at rest: the stance the gallery holds her in - restStance.)
        if (R.stance) pair.receiver.stance = R.stance.anim;
        // (A pair only modes make takes the first one's setup, if it gives one.)
        const own = core ? null : extra.find(([, x]) => x.setup);
        const setup = own ? own[1].setup : G.setup;
        if (setup.length) pair.setup = setup.map((x) => Object.assign({}, x));
        const p1spr = mugenP1Spr(G, g.info);
        if (p1spr) pair.p1spr = p1spr;
        // (A cutscene intro of his: the runtime cuts it at once.)
        const cut = cutsceneIntro(G);
        if (cut) pair.cutscene = Object.assign({}, cut);
        // (HIS OTHER BRANCH in any scene of his: the hook plays it on her in
        // place of the art his probe picks - in a step's own states and on
        // the way to them, his strokes before a gauge climax.)
        const swap = [];
        for (const C of [...G.an.scenes.keys()].sort((a, b) => a - b)) {
          for (const x of hisOtherBranch(G, R, C)) swap.push({ state: C, from: x.from, to: x.to });
        }
        if (swap.length) pair.swap = swap;
        pair.steps = steps;
        { const ca = cmdAliasOf(G, steps); if (ca) pair.cmdAlias = ca; }
        pairs.push(pair);
      }
      // Her assist helper, a receiver of its own (HELPER_RECEIVERS): a pair
      // right after hers, the same character loaded, her helper grabbed.
      for (const H of R.helpers || []) {
        const hm = cachedIn(CACHE.pairs, g.dir + '|' + g.def + '>' + r.dir + '|' + r.def + '#' + H.id, g.sig + '>' + r.sig, () => {
          let walk = null;
          try { walk = giverSteps(G, R.airActions); } catch (e) { walk = null; }
          if (!walk || !walk.steps.length) return null;
          try { return helperPair(G, R, H, walk, g.info); } catch (e) { return null; }
        }, () => { stat.pairs++; });
        if (!hm || !hm.steps.length) continue;
        const rec = Object.assign(who(r), { display: H.display, helper: { id: H.id, name: H.name, helperName: H.helperName, cmd: H.cmd, spawn: H.spawn,
          ready: hm.ready.slice(), immune: hm.immune.slice(), art: hm.art.slice(), own: H.own.slice(), hideExplods: hm.hideExplods.slice(), scale: H.scale, rootScale: H.rootScale } });
        if (hm.badge) rec.helper.badge = JSON.parse(JSON.stringify(hm.badge));
        const pair = { giver: who(g), receiver: rec, counts: Object.assign({}, hm.counts) };
        // (Where his setup already holds the variable at the same value - a
        // finish counter her art reads too, DongHwan's var(32) - both reasons.)
        const setup = [...G.setup.map((x) => {
          const h = hm.holds.find((y) => y.kind === x.kind && y.index === x.index && y.value === x.value);
          return Object.assign({}, x, h ? { why: h.why + '; and ' + x.why } : {});
        }), ...hm.holds.filter((h) => !G.setup.some((x) => x.kind === h.kind && x.index === h.index)).map((x) => Object.assign({}, x))];
        if (setup.length) pair.setup = setup;
        const p1spr = mugenP1Spr(G, g.info);
        if (p1spr) pair.p1spr = p1spr;
        // (A cutscene intro of his: the runtime cuts it at once.)
        const cut = cutsceneIntro(G);
        if (cut) pair.cutscene = Object.assign({}, cut);
        pair.steps = JSON.parse(JSON.stringify(hm.steps));
        { const ca = cmdAliasOf(G, pair.steps); if (ca) pair.cmdAlias = ca; }
        pairs.push(pair);
      }
    }
    pairMs += Date.now() - tp;
    walks[g.select] = G.walkList.length + G.walks.size;
  }
  // Every step's place on the gallery's axes (a step that has one keeps it).
  for (const p of pairs) deriveNav(p);
  if (opts.stats && typeof opts.stats === 'object') {
    const recomputed = {};
    for (const k of Object.keys(stat)) recomputed[k] = stat[k] - before[k];
    Object.assign(opts.stats, { ms: Date.now() - t0, characters: people.length, givers: givers.length, pairs: pairs.length,
      scanMs, giverMs, pairMs, walks, recomputed });
  }
  return { version: 2, pairs };
}

module.exports = { buildGalleryData, deriveNav, validNav, navHintOf, giverBase, giverSteps, describeGiver, describeReceiver, sceneVerdict, sceneJudge, pieceFrames, helperSceneJudge, helperPair, helperGrabs, readInfo, readCommands,
  readAirTimes, readAirTicks, readPowerMax, singleInput, commandWords, isPlayable, rosterChars, isHNumber, isHGroup, makeWalker, rewriteAtoms, commandsIn,
  pairSteps, finishPair, cachedIn, cutsceneIntro, codeVersionOf };

// node gallerydata.js                      the active roster, as JSON
// node gallerydata.js <giverDir> [def]     one giver's steps and unreachable scenes
//   --modes <ids|all>                      with those prototype modes (gallerymodes/)
if (require.main === module) {
  const argv = process.argv.slice(2);
  const mi = argv.indexOf('--modes');
  let modes = [];
  if (mi >= 0) {
    const ids = String(argv[mi + 1] || '');
    argv.splice(mi, 2);
    modes = require('./gallerymodes').load(ids === 'all' ? null : ids.split(',').filter(Boolean));
  }
  const arg = argv[0];
  if (arg) {
    const def = argv[1] || modlib.findMainDef(arg);
    const G = describeGiver(arg, def);
    console.log(JSON.stringify({ scenes: [...G.hScenes].sort((a, b) => a - b), entries: G.entries, setup: G.setup,
      steps: G.steps.map((s) => ({ entry: s.entry, group: s.group, label: s.label, until: s.until, path: s.path })),
      unreachable: G.unreachable, ms: G.ms }, null, 1));
  } else {
    const stats = {};
    const out = buildGalleryData({ stats, modes });
    console.log(JSON.stringify(out, null, 1));
    console.error(JSON.stringify(stats));
  }
}
