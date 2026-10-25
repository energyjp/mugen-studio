'use strict';
//
// THE MOB MODE'S RUNTIME: its steps trimmed for the runtime, its lines in the
// hook (data/hgallery.zss) and its chunk of the driver (hgallery.lua). The
// mode's entry, gallerymodes/mob.js, hands these hooks on (trimStep, zss,
// lua); gallerymodes/index.js has the mode contract, gallery.js the seams.
//
// A MOB GIVER is one whose helpers - many, of several kinds - do the grabbing
// (towerofbloodyfight's zombies, ZHE's futa). A mob step is ONE MEMBER of his
// mob (a helper id) in one of its scenes. Each step carries step.mob (the
// walk side's, gallerymodes/mob.js):
//   id       the member's helper id
//   who      its name (the Helper's name in his files)
//   ids      every member id of his, and his ambient grabbers (all of them
//            go at every reset and while a mob step plays)
//   route    how his own files bring it out: { cmd, after?, from? } his
//            command pressed on him (from his state time `after` on, only in
//            his states `from` where named); { state, after? } his summon
//            state, entered with Lua changeState (`after`: ticks it may take);
//            { present: true } one is always out
//   settle?  its states (numbers or [a, b] ranges) it must have left before
//            it is put in its grab (its start states that set its variables)
//   scenes?  its states that hold her ([a, b] ranges)
//   gap?     where it is stood for its grab: this far past her, from him
//            (320-wide units; 36 if not said, at most 200)
//   grab     its own grab state
//   pins?    [{ kind, index, value }] of its variables, held on it every frame
//            (its type, its family, its meter; at most 6)
//   go?      { state, in?, home?, set?, via? }: the step's position, set by
//            the hook from any of its states in `in` (default: scenes)
//            unless at `home` (default: the state itself); via { state, in }:
//            from its states in via's `in`, the state it goes to first (THE
//            HEAD FIRST)
//   hold?    { state, anim, skip?, restart?, freeze?, explods?, enter? }: the
//            animation held in the position's state (anim null: none read,
//            only the restart); restart: its state time at which the state
//            starts again (a state that leaves on its time: N - 1 for an exit
//            at time >= N); freeze: an intro's, played once and held on its
//            last frame, with its layers (explods: their ids, at most 4);
//            enter: an offset pose's, the state entered again where the
//            animation is another; bind: its layers name her (THE AUTHOR'S
//            BIND), at: where it stands from her along her facing (her
//            pose's contact point less its layers' own offset), aty: the
//            same in height (from her y); colors:
//            [group, index] its own repaint goes to (ITS OWN COLORS), a
//            number or palno each
//   cams?    his camera cursors' helper ids (helpers of his whose own state
//            holds the camera on them: TOBF's and ZHE's 22401)
//   away?    his root's idle PosSets him off the ground (TOBF's 1000/1001)
//   park?    it is held far above the stage until its jump (PARKED UNTIL ITS
//            JUMP)
//   A RELAYED MEMBER's (gallerymodes/mob-relay.js) go and hold name its hub:
//   go.hub { state, prev, anim? }: home is the hub entered from the
//            trampoline `prev` (go.state, the way there), with its look
//   hold.hub [{ prev, at, end?, to } | { prev, at, stop }]: in the hub
//            entered from `prev`, from its state time `at` (on its
//            animation's last tick where `end`), the trampoline `to` entered
//            again, or (stop) THE CLOCK HELD; with an intro's freeze
//            (freeze, explods) as any hold's
//
// THE RULES (generic: everything comes from the step's data):
// - ONE MEMBER ON HER. The pair is placed as for any step; then his mob
//   brings the member out by its route, and the driver takes the newest
//   instance of its id (its player id). While the step plays every other
//   instance of his member ids goes (recursive, with its explods), so his
//   own extra spawns never join the scene.
// - THE JUMP. Once the member has been out 2 ticks and left its settle
//   states, the hook stands it on her far side (gap past her, from him),
//   facing her, and puts it in its own grab state: its AI's random,
//   distance and life gates never decide. The grab connects as his files
//   make it. A member out of its grab with her not taken for 15 ticks
//   missed: it is asked again, at most 3 times per grab (the driver's own
//   enter limit then grabs again from the reset).
// - PINS every frame from the pick on, before its own lines run (so its
//   grab state starts with them); the POSITION (go) while the step's path
//   waits for her state; the HOLD while the step plays (act and show), its
//   animation restarted on its last tick (no loop end draws a random) and
//   its state restarted before a time exit.
// - THE CUT: a cut cleans what it cuts. The position's jump and a hold's
//   restart take the member out of the author's own flow (his way into a
//   position may clear every explod on the way - TOBF's 164000 - and the
//   jump skips it), so on that same frame, before the new state runs and
//   before anything is drawn, its own explods go (RemoveExplod with no id:
//   the no-id pictures too, Colette's 7520-7524) and its child helpers go
//   (it marks its own map _gal_mob_cut; they run after it, being made later;
//   one its new state makes on that very tick stays). The new position's own
//   time-0 layers come after the cut, and its -2's status ones come back the
//   same frame. A change in place never replays the grab.
// - AN INTRO FREEZES (hold.freeze): it plays once and holds its last frame -
//   the member's animation, its listed explods (ModifyExplod) and her side
//   (_gal_mob_hz on her) - in place of an animation restart, which replays
//   the insertion without the layers its state made at time 0 (the Zombie's
//   head and mane 3343, removetime -2, gone at the first pass's end). Any
//   other step lets go. (A time exit still needs its restart: a freeze cannot
//   stop the state's clock.)
// - THE HEAD FIRST (go.via): her state follows his by her own lines (her
//   4001 goes to 334 while he is in 324), and from some of his states hers
//   cannot follow the step's position (her struggle 4003 follows only his
//   4000): from those the go takes him to the head first (4002 -> 4000), and
//   from the head to the position one tick later (`time > 0`), once she has
//   followed it (she sees his state of the tick before).
// - AN OFFSET POSE RE-ENTERS (hold.enter): a pose that is an offset of one
//   animation (GoblinParty's 325, `551121019 + var(45)`, var(45) pinned) is
//   made by the state's own entry - its header's animation and the layers it
//   keys on it (persistent 0: once per entry). Where the animation is
//   another (a pose changed in place), the state is entered again, after the
//   cut: a ChangeAnim alone would leave the old pose's layers on screen and
//   never make the new one's again.
// - THE AUTHOR'S BIND (hold.bind): the pose state's layers name her as the
//   player they bind to (`bindid = PlayerID(helper(4711 + var(22)),var(0)),id`),
//   and this engine binds a p1 explod to its owner whatever its bindid says
//   - GoblinParty's goblin, parked off the stage by its own PosSet, drew its
//   body there. While it plays a hold that binds, after its state ([StateDef
//   +1], before the frame's layers are bound and drawn, so this tick's new
//   ones too), the member stands where its layers belong: at her x plus
//   hold.at along her facing (_gal_mob_at: her pose's contact point less
//   its layers' own offset, so they stand at her pose's axis), at her
//   height plus hold.aty (_gal_mob_aty, the same in y), facing her, pushing no one (it stands on her now). Its layers
//   stay bound to it as the engine binds them. (Round 2 bound them to her
//   with ModifyExplod: the same place with at 0, his numbers' place - 27
//   toward her head on doggy, the owner's 'too far to the left'.)
// - ITS OWN COLORS (hold.colors): its own state repaints every palette onto
//   one (RemapPal source -1: the goblin's 10000, every frame), and its
//   own-palette layers copy that repaint when made; their remappal (a
//   sprite's palette, which an SFF v1 file has no key for) cannot undo it,
//   so the x-ray inset is drawn in the goblin's colors - black. While such a
//   hold plays, the first line of its play block clears the repaint (before
//   any jump there: a SelfState in that block runs the new state at once,
//   and its time-0 layers copy the repaint they find), and after its state
//   (+1) the repaint is made again as its files make it (the dest they
//   name): the layers it made keep their own colors, its others wear its
//   palette as before.
// - A RELAY HUB (go.hub, hold.hub): one state of the member that is every
//   phase of its scene, told apart by the trampoline that entered it
//   (ero_helper_zero's 7002 after 7010..7024, each one ChangeState into it;
//   its TargetState gives her `3220000 + PrevStateNo + ...`). The go and the
//   hold enter a TRAMPOLINE, after the cut, never the hub itself: entered
//   from itself its PrevStateNo would read the hub, and her 3220000 + 7002
//   is 3227002, the state that spawns her clone. A speed or the climax plays
//   on as the hub plays it: its trampoline entered again on the very tick the
//   hub would leave (the hook runs before its state's lines). Its go acts
//   while the step shows too: her state is the same for every look of one
//   trampoline (the mangri 7420 and the mating press 7430 both give her
//   3227020), so from a fresh grab her scene shows - and the act ends -
//   with the look its judge drew at random, before the go has made the
//   step's. In the step's home nothing moves it.
// - THE CLOCK HELD (hold.hub stop): an intro that PAUSES where its state
//   leaves on its own time (the hub's `time >= 170` -> a random speed, on
//   the insertion's last tick): from a tick before it the member is held in
//   a hit pause (ModifyPlayer hitpausetime 1, every frame), so its state's
//   own lines wait and its time stays (char.go: no time++ in a hit pause),
//   while the hook's ignorehitpause lines go on - the freeze on its last
//   frame with its layers, and her side (_gal_mob_hz). A freeze alone cannot
//   stop the state's clock; this does, and any other step lets go (its pause
//   ends with the frame).
// - PARKED UNTIL ITS JUMP (park): a member whose hit is live from its first
//   tick, wherever it comes out (ero_helper_zero's Birdie from `pos x - 80`
//   past a screen edge: on screen beside another pair, its hit box 2,900
//   tall), is held 10000 above the stage in [StateDef +1] - after its own
//   state, before the frame's hits - until the jump marks it (_gal_mob_j on
//   the member): its own flight catches no one and is never drawn.
// - HE IS NEVER A TARGET while a mob step plays (NotHitBy, his slot 7): a
//   member's hit that takes its own side (affectteam = B, Colette's support)
//   would take him before her.
// - HIS CAMERA CURSORS (cams): invisible and out of the camera for a pair
//   with them, from the match's first frame (the round intro would pull the
//   view to them already), and one only - his -2 brings one back whenever
//   none is out (never all destroyed: one would come and go every frame),
//   and his round state's own spawn at its time 0, which every reset passes
//   (Bloody Tower, Gnoll Raid2, Project Rose), would add one per grab: a
//   newcomer goes on its first tick, before it is drawn.
// - AN AWAY ROOT (away) is held beside her, GAP behind her as the place
//   stood him, at his place's facing, through every phase his member is
//   out ([StateDef +1], after his own PosSet off the ground): the pair's
//   center, its markers and the side the member is stood on all read his
//   place. He moves the camera only where the core asks nothing of it.
// - RESETS. From the reset to the grab, and while a step is given up on
//   (stuck), every instance of his member ids goes (_gal_mob_id = -1); the
//   ids are on the pair's kill list too (clearAlso), as a summon's are.
//   A giver whose step is no longer a mob step, or a fight not in round
//   state 2, has every map of the mode at 0.
// - IN PLACE: a move to another step of the same member, with it out, whose
//   position the hook sets (a step with no position - its grab - only while
//   her state is already one of its own: nothing but a grab brings it). The
//   member on her is found again (the driver clears a mode's state at every
//   step change): the newest instance in a state that holds her. Another
//   member, or a step not of the mode, grabs again.
// - No lean is learned for a mob step (LEAN.ok answers no): the member is
//   stood by her, and her place is what it follows. A step's own setup (a
//   count gate his members raise) holds while the member comes out too
//   (SETUP_PHASES 'mob:out').
//
// THE HOOK'S MAPS, on his root (the member reads them with root,): _gal_mob_id
// the instance that plays (-1: none may stay), _gal_mob_c his command pressed
// (the build's number), _gal_mob_p the pin set, _gal_mob_g the grab set (one
// frame) with _gal_mob_x (where, in his units: from the camera, or from the
// stage's center with his _gal_abs) and _gal_mob_f (its facing), _gal_mob_o
// the position set, _gal_mob_a the hold set, _gal_mob_b his hold beside her
// with _gal_mob_bx (where, in his units from the stage's center),
// _gal_mob_cam his camera cursors hidden, _gal_mob_her her player id while a
// hold's layers name her, with _gal_mob_at (where it stands from her),
// _gal_mob_pal 1 while a hold keeps its own colors. On her root: _gal_mob_hz, her side
// of an intro held still. On the member itself: _gal_mob_cut, 1 on a cut's
// frame (its children read it with parent,), and _gal_mob_j, 1 from its jump
// on (a parked member).
//
// THE LOG (-hgallerylog): 'mob: <who> <id> out pid=<p> after <t> at y <y>'
// (-10000 parked), 'mob: grab asked at x <x> (her at <x>) facing <f>, her
// helpers out <n>' (before the grab: the count her clone would raise), 'mob:
// its <state> t=<t>' on each
// change, 'mob: its <state> restarted at <time>' when its state time goes
// back in the same state (a hold's restart), 'mob: its <state> clock held at
// <time>' when it stays, 'mob: its explods <id>:<anim>,...'
// each time the set of the member's explods changes (no id twice, the step's
// own layers), 'mob: members out <id>=<n>,...', 'mob: her helpers out <n>'
// (her clone would be one) and 'mob: his camera cursors
// <id>=<n>' (one at most) at each show, 'mob: his root at <x> y <y> (her at
// <x>), camera at <x>' at each show of an away root, 'mob: her intro held
// still <0|1>', 'mob: its grab missed - again'. The driver's own 'grab: his
// summoned helpers out' must read 0.

const ID = 'mob';
const MAX_PINS = 6;
const MAX_LAYERS = 4;
const GAP_DEFAULT = 36;
const GAP_MAX = 200;
// The hook's maps of the mode.
const MAPS = ['_gal_mob_id', '_gal_mob_c', '_gal_mob_p', '_gal_mob_g', '_gal_mob_x', '_gal_mob_f', '_gal_mob_o', '_gal_mob_a', '_gal_mob_b', '_gal_mob_bx',
  '_gal_mob_cam', '_gal_mob_hz', '_gal_mob_cut', '_gal_mob_her', '_gal_mob_at', '_gal_mob_aty', '_gal_mob_pal', '_gal_mob_j'];

const isNat = (n) => Number.isInteger(n) && n >= 0;
const sortNums = (a) => [...new Set(a)].sort((x, y) => x - y);
const natList = (a) => (Array.isArray(a) ? a.filter(isNat) : []);
// [a, b] ranges from numbers or ranges; null when one is malformed.
function ranges(v) {
  if (v == null) return [];
  const list = Array.isArray(v) ? v : [v];
  const out = [];
  for (const x of list) {
    if (isNat(x)) out.push([x, x]);
    else if (Array.isArray(x) && x.length === 2 && isNat(x[0]) && isNat(x[1]) && x[0] <= x[1]) out.push([x[0], x[1]]);
    else return null;
  }
  out.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return out.filter((r, i) => i === 0 || r[0] !== out[i - 1][0] || r[1] !== out[i - 1][1]);
}
// A name for the log and the overlay: plain ASCII, nothing the Lua or the
// ZSS would have to escape.
const plain = (s) => String(s == null ? '' : s).replace(/[^A-Za-z0-9 ._()+'-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
// The same variable request as the core's (gallery.js varReq), for a T
// that lacks one.
function varReqOf(e) {
  if (!e || (e.kind !== 'var' && e.kind !== 'fvar') || !isNat(e.index) || typeof e.value !== 'number' || !Number.isFinite(e.value)) return null;
  return { k: e.kind === 'var' ? 1 : 2, i: e.index, v: e.value };
}
const cmdOkOf = (c) => typeof c === 'string' && c.length > 0 && !/["\r\n\0]/.test(c) && !/[^\x00-\xff]/.test(c);

// This build's object of the mode (t.modeData.mob), made once.
function dataOf(T) {
  const D = T && typeof T.data === 'function' ? T.data(ID) : null;
  if (!D || typeof D !== 'object') return null;
  if (!Array.isArray(D.members)) Object.assign(D, { members: [], commands: [], ids: [], pinSets: [], grabSets: [], goSets: [], holdSets: [], cams: [], bind: false });
  return D;
}
// A set numbered by its key (1-based), the same set once.
function indexIn(list, key, make) {
  let i = list.findIndex((x) => x.key === key);
  if (i < 0) { list.push(Object.assign({ key }, make())); i = list.length - 1; }
  return i + 1;
}

// TRIM: a mob step checked, its runtime fields into out.mob = { m, p, g, gs,
// o, a, fz?, hb?, co?, b?, c?, ho? } (the member's number in the build, its
// pin, grab, position and hold sets, 0 for none; gs its grab state; fz 1 its
// hold freezes, hb 1 its hold's layers name her (it stands at her pose's
// contact point), co 1 its own colors are kept on the layers it makes, b 1
// his root is held beside her, c 1 his camera cursors are hidden, ho 1 its
// go is a relay hub's, on while the step shows too), its ids (his members and
// ambient grabbers) onto the pair's kill list, his camera cursors onto the
// build's. { bad } drops it ('a mob member the hook cannot drive').
function trimStep(s, out, T) {
  const m = s && s[ID];
  const bad = (why) => ({ bad: 'a mob member the hook cannot drive (' + why + ')' });
  if (!m || typeof m !== 'object') return bad('no member');
  const D = dataOf(T);
  if (!D) return bad('no build data');
  const varReq = (T && T.varReq) || varReqOf;
  const cmdOk = (T && T.cmdOk) || cmdOkOf;
  if (!isNat(m.id)) return bad('its id');
  if (!isNat(m.grab)) return bad('its grab state');
  const ids = [...new Set([m.id, ...natList(m.ids)])].sort((a, b) => a - b);
  // Its route: exactly one of a command, a summon state, always out.
  const r = m.route && typeof m.route === 'object' ? m.route : null;
  if (!r) return bad('no route');
  const kinds = [r.cmd != null, r.state != null, r.present === true].filter(Boolean).length;
  if (kinds !== 1) return bad('its route');
  if (r.cmd != null && !cmdOk(r.cmd)) return bad('a command name the hook cannot write');
  if (r.state != null && !(Number.isInteger(r.state) && r.state > 0)) return bad('its summon state');
  const after = r.after == null ? 0 : r.after;
  if (!isNat(after)) return bad('its route time');
  const from = r.from == null ? [] : natList(r.from);
  if (r.from != null && (!Array.isArray(r.from) || from.length !== r.from.length)) return bad('its route states');
  const settle = ranges(m.settle), scenes = ranges(m.scenes);
  if (!settle) return bad('its settle states');
  if (!scenes) return bad('its scene states');
  const gap = m.gap == null ? GAP_DEFAULT : Number(m.gap);
  if (!Number.isFinite(gap)) return bad('its gap');
  const pins = (Array.isArray(m.pins) ? m.pins : m.pins == null ? [] : [null]).map(varReq);
  if (pins.some((x) => !x)) return bad('its pins');
  if (pins.length > MAX_PINS) return bad('too many pins');
  let go = null;
  if (m.go != null) {
    const g = m.go;
    const gin = g.in == null ? scenes : ranges(g.in);
    const home = g.home == null ? [[g.state, g.state]] : ranges(g.home);
    const set = g.set == null ? null : varReq(g.set);
    const v = g.via == null ? null : g.via;
    const vin = v && typeof v === 'object' ? ranges(v.in) : null;
    if (!isNat(g.state) || !gin || !gin.length || !home || !home.length || (g.set != null && !set)
      || (v != null && (!vin || !vin.length || !isNat(v.state)))) return bad('its position');
    go = { state: g.state, in: gin, home };
    if (set) go.set = set;
    if (v) go.via = { state: v.state, in: vin };
    // (A RELAY HUB's: `state` is the trampoline, and home the hub entered
    // from it, with its look.)
    if (g.hub != null) {
      const hb = g.hub;
      if (!hb || typeof hb !== 'object' || !isNat(hb.state) || !isNat(hb.prev) || (hb.anim != null && !isNat(hb.anim)) || v != null) return bad('its relay position');
      go.hub = Object.assign({ state: hb.state, prev: hb.prev }, hb.anim != null ? { anim: hb.anim } : {});
    }
  }
  // (An animation the walk could not read is no hold of it: the restart, if
  // any, still holds the state.)
  let hold = null;
  if (m.hold != null && m.hold.hub != null) {
    // A RELAY HUB's hold: its lines { prev, at, end?, to } (entered again by
    // the trampoline `to`) or { prev, at, stop } (THE CLOCK HELD), and an
    // intro's freeze with its layers.
    const h = m.hold, lines = h.hub;
    const layers = h.explods == null ? [] : h.explods;
    const okLine = (x) => x && isNat(x.prev) && Number.isInteger(x.at) && x.at >= 1 && (x.end == null || typeof x.end === 'boolean')
      && ((isNat(x.to) && x.stop == null) || (x.stop === true && x.to == null));
    if (!isNat(h.state) || (h.anim != null && !isNat(h.anim)) || !Array.isArray(lines) || !lines.length || lines.length > MAX_LAYERS || !lines.every(okLine)
      || (h.freeze != null && typeof h.freeze !== 'boolean') || (h.freeze && h.anim == null) || h.restart != null || h.enter != null || h.bind != null || h.at != null || h.colors != null
      || !Array.isArray(layers) || layers.length > MAX_LAYERS || !layers.every((x) => Number.isInteger(x) && x > 0)) return bad('its relay hold');
    hold = Object.assign({ state: h.state, anim: h.anim == null ? null : h.anim, skip: [],
      hub: lines.map((x) => Object.assign({ prev: x.prev, at: x.at }, x.stop ? { stop: true } : { end: !!x.end, to: x.to })) },
    h.freeze ? { freeze: true, explods: [...new Set(layers)].sort((a, b) => a - b) } : {});
  } else if (m.hold != null) {
    const h = m.hold, skip = h.skip == null ? [] : h.skip;
    const okSkip = Array.isArray(skip) && skip.every((x) => Array.isArray(x) && x.length === 3 && Number.isInteger(x[0]) && x[0] >= 1 && Number.isInteger(x[1]) && x[1] >= 1 && isNat(x[2]));
    const layers = h.explods == null ? [] : h.explods;
    const okLayers = Array.isArray(layers) && layers.length <= MAX_LAYERS && layers.every((x) => Number.isInteger(x) && x > 0);
    // (Its contact point stands it along her facing, only where its layers
    // bind; its own colors name the palette its repaint goes back to: a
    // number or palno each.)
    const okColors = h.colors == null || (Array.isArray(h.colors) && h.colors.length === 2 && h.colors.every((x) => typeof x === 'string' && /^(-?\d{1,5}|palno)$/.test(x)));
    if (!isNat(h.state) || (h.anim != null && !isNat(h.anim)) || !okSkip || (h.restart != null && !(Number.isInteger(h.restart) && h.restart >= 1))
      || (h.freeze != null && typeof h.freeze !== 'boolean') || (h.enter != null && typeof h.enter !== 'boolean') || (h.freeze && h.enter)
      || (h.bind != null && typeof h.bind !== 'boolean') || (h.at != null && !(h.bind === true && Number.isInteger(h.at) && Math.abs(h.at) <= GAP_MAX))
      || (h.aty != null && !(h.bind === true && Number.isInteger(h.aty) && Math.abs(h.aty) <= GAP_MAX)) || !okColors || !okLayers) return bad('its animation hold');
    // (A freeze holds an animation: with none read there is nothing to hold
    // still.)
    if (h.anim != null) hold = Object.assign({ state: h.state, anim: h.anim, skip: skip.map((x) => x.slice()) }, h.freeze ? { freeze: true, explods: [...new Set(layers)].sort((a, b) => a - b) } : {},
      h.enter ? { enter: true } : {}, h.bind ? { bind: true } : {}, h.bind && h.at ? { at: h.at } : {}, h.bind && h.aty ? { aty: h.aty } : {}, h.colors ? { colors: h.colors.slice() } : {});
    if (h.restart != null) hold = Object.assign(hold || { state: h.state, anim: null, skip: [] }, { restart: h.restart });
  }
  // His camera cursors: helper ids of his, never one of his members.
  if (m.cams != null && (!Array.isArray(m.cams) || !m.cams.every(isNat))) return bad('its camera cursors');
  const cams = [...new Set(m.cams || [])].filter((id) => !ids.includes(id)).sort((a, b) => a - b);
  if (m.away != null && typeof m.away !== 'boolean') return bad('its root\'s place');
  if (m.park != null && typeof m.park !== 'boolean') return bad('its park');
  // The member, once per build: the same id, route and reading are one.
  const cmd = r.cmd != null ? (D.commands.indexOf(r.cmd) + 1 || D.commands.push(r.cmd)) : 0;
  const who = plain(m.who) || 'helper ' + m.id;
  const mem = Object.assign({ id: m.id, who, cmd, state: r.state != null ? r.state : 0, after, present: r.present === true, from, settle, scenes, gap: Math.max(0, Math.min(GAP_MAX, gap)), ids },
    m.park ? { park: true } : {});
  const mi = indexIn(D.members, JSON.stringify(mem), () => mem);
  for (const id of ids) if (!D.ids.includes(id)) D.ids.push(id);
  D.ids.sort((a, b) => a - b);
  const p = pins.length ? indexIn(D.pinSets, m.id + ':' + JSON.stringify(pins), () => ({ id: m.id, pins })) : 0;
  const g = indexIn(D.grabSets, m.id + ':' + m.grab, () => ({ id: m.id, state: m.grab }));
  const o = go ? indexIn(D.goSets, m.id + ':' + JSON.stringify(go), () => Object.assign({ id: m.id }, go)) : 0;
  const a = hold ? indexIn(D.holdSets, m.id + ':' + JSON.stringify(hold), () => Object.assign({ id: m.id }, hold)) : 0;
  out[ID] = Object.assign({ m: mi, p, g, gs: m.grab, o, a }, hold && hold.freeze ? { fz: 1 } : {}, hold && hold.bind ? { hb: 1 } : {}, hold && hold.bind && hold.at ? { at: hold.at } : {}, hold && hold.bind && hold.aty ? { aty: hold.aty } : {}, hold && hold.colors ? { co: 1 } : {}, m.away ? { b: 1 } : {},
    cams.length ? { c: 1 } : {}, go && go.hub ? { ho: 1 } : {});
  for (const id of cams) if (!D.cams.includes(id)) D.cams.push(id);
  D.cams.sort((x, y) => x - y);
  if (m.away) D.bind = true;
  // Every member id goes at every reset (the pair's kill list).
  const also = [...new Set([...(Array.isArray(out.clearAlso) ? out.clearAlso : []), ...ids])].filter((id) => id !== out.clear).sort((x, y) => x - y);
  if (also.length) out.clearAlso = also;
  return null;
}

// THE HOOK'S LINES: the press and his NotHitBy on his root (m4, inside the
// root's block), three lines and blocks per member id (m4blocks): every
// other instance goes; its cut mark is cleared; the one that plays takes its
// pins, its grab, its position and its hold. Then a member's children at a
// cut, her side of a frozen intro, and his camera cursors (one only, in -4;
// hidden and out of the camera in +1, p1blocks, as his away root's hold).
function zss(t) {
  const D = t && t.modeData && t.modeData[ID];
  const out = { m4: [], m4blocks: [], p1blocks: [], gates: {} };
  if (!D || !Array.isArray(D.members) || !D.members.length) return out;
  const L = (s) => out.m4blocks.push(s);
  const P = (s) => out.p1blocks.push(s);
  const rng = (rs) => rs.map(([a, b]) => (a === b ? 'stateNo = ' + a : '(stateNo >= ' + a + ' && stateNo <= ' + b + ')')).join(' || ');
  const setTxt = (e) => (e.k === 1 ? 'var(' : 'fvar(') + e.i + ') := ' + e.v + ';';
  if (D.commands.length) {
    out.m4.push('\t# A MOB member comes out by his own spawn command, pressed here on the');
    out.m4.push('\t# driver\'s frame (_gal_mob_c: the build\'s number).');
    out.m4.push('\tif map(_gal_mob_c) > 0 {');
    D.commands.forEach((name, i) => out.m4.push('\t\tif map(_gal_mob_c) = ' + (i + 1) + ' { assertCommand{name: "' + name + '"} }'));
    out.m4.push('\t}');
  }
  out.m4.push('\t# While a MOB step plays he is never a target: a member\'s hit that takes');
  out.m4.push('\t# its own side (affectteam = B, Colette\'s support) would take him before');
  out.m4.push('\t# her. Slot 7, clear of his own HitBy lines.');
  out.m4.push('\tif map(_gal_mob_id) != 0 { notHitBy{attr: SCA; slot: 7; time: 1} }');
  // THE CUT, the last lines before a jump: its own explods (every one, the
  // no-id pictures too), its mark for its children, then the jump.
  const cut = (set, state) => {
    L('\t\tremoveExplod{}');
    L('\t\tmap(_gal_mob_cut) := 1;');
    if (set) L('\t\t' + set);
    L('\t\tselfState{value: ' + state + '}');
  };
  L('# A MOB MEMBER of his (a helper of his mob) reads its root\'s requests:');
  L('# _gal_mob_id, the one instance that plays (its player id): every other');
  L('# instance of his member ids goes, with its own helpers and explods (-1:');
  L('# every one goes - from a reset to the grab, a step given up on).');
  L('# For the one that plays: _gal_mob_p, its pins (type, family, meter), every');
  L('# frame and first, so a state starts with them; _gal_mob_g, its grab, once:');
  L('# stood at _gal_mob_x (from the camera, or from the stage\'s center with his');
  L('# _gal_abs) facing _gal_mob_f, put in its own grab state - past its AI\'s');
  L('# random and distance gates; _gal_mob_o, the step\'s position, from a state');
  L('# of its that holds her; _gal_mob_a, the animation held in the position\'s');
  L('# state, restarted on its last tick (no loop end draws a random), and the');
  L('# state restarted before a time exit - or, an intro\'s, held still on its');
  L('# last ticks with the layers its state made at time 0 (ModifyExplod).');
  L('# THE CUT: the position\'s jump and a restart take it out of its author\'s');
  L('# flow, so its own explods go on that frame, before the new state makes');
  L('# its layers and before anything is drawn, and it marks _gal_mob_cut for');
  L('# its children (cleared first thing the next frame).');
  for (const id of D.ids) {
    L('ignorehitpause if isHelper(' + id + ') && gameMode = "hgallery" && root, map(_gal_mob_id) != 0 && id != root, map(_gal_mob_id) {');
    L('\tdestroySelf{recursive: 1; removeexplods: 1}');
    L('}');
    const pins = D.pinSets.map((x, i) => [x, i + 1]).filter(([x]) => x.id === id);
    const grabs = D.grabSets.map((x, i) => [x, i + 1]).filter(([x]) => x.id === id);
    const gos = D.goSets.map((x, i) => [x, i + 1]).filter(([x]) => x.id === id);
    const holds = D.holdSets.map((x, i) => [x, i + 1]).filter(([x]) => x.id === id);
    if (!pins.length && !grabs.length && !gos.length && !holds.length) continue;
    if (gos.length || holds.some(([x]) => x.restart || x.enter || x.hub)) {
      L('ignorehitpause if isHelper(' + id + ') && gameMode = "hgallery" && map(_gal_mob_cut) {');
      L('\tmap(_gal_mob_cut) := 0;');
      L('}');
    }
    const parks = D.members.some((mm) => mm.id === id && mm.park);
    L('ignorehitpause if isHelper(' + id + ') && gameMode = "hgallery" && id = root, map(_gal_mob_id) {');
    // (ITS OWN COLORS: its repaint cleared first thing, before any jump of
    // this block - a SelfState here runs the new state at once, and its
    // time-0 layers copy the repaint they find.)
    if (holds.some(([x]) => x.colors)) L('\tif root, map(_gal_mob_pal) { remapPal{source: -1, 0; dest: -1, 0} }');
    for (const [x, n] of pins) L('\tif root, map(_gal_mob_p) = ' + n + ' { ' + x.pins.map(setTxt).join(' ') + ' }');
    for (const [x, n] of grabs) {
      L('\tif root, map(_gal_mob_g) = ' + n + ' {');
      if (parks) L('\t\tmap(_gal_mob_j) := 1;');
      L('\t\tposSet{x: root, map(_gal_mob_x) - root, map(_gal_abs) * cameraPos x; y: 0}');
      L('\t\tvelSet{x: 0; y: 0}');
      L('\t\tif facing != root, map(_gal_mob_f) {');
      L('\t\t\tturn{}');
      L('\t\t}');
      L('\t\tselfState{value: ' + x.state + '}');
      L('\t}');
    }
    for (const [x, n] of gos) {
      // (A RELAY HUB: home is the hub entered from the trampoline, with its
      // look; the way there is the trampoline, never the hub itself.)
      if (x.hub) {
        const home = 'stateNo = ' + x.hub.state + ' && prevStateNo = ' + x.hub.prev + (x.hub.anim != null ? ' && anim = ' + x.hub.anim : '');
        L('\tif root, map(_gal_mob_o) = ' + n + ' && (' + rng(x.in) + ') && !(' + home + ') {');
        cut(x.set ? setTxt(x.set) : null, x.state);
        L('\t}');
        continue;
      }
      if (x.via) {
        L('\tif root, map(_gal_mob_o) = ' + n + ' && (' + rng(x.via.in) + ') {');
        cut(null, x.via.state);
        L('\t}');
      }
      L('\tif root, map(_gal_mob_o) = ' + n + ' && (' + rng(x.in) + ') && !(' + rng(x.home) + ')' + (x.via ? ' && time > 0' : '') + ' {');
      cut(x.set ? setTxt(x.set) : null, x.state);
      L('\t}');
    }
    // (A layer frozen by an intro's hold lets go wherever no hold that lists
    // it is on: one line per layer, after every hold.)
    const layers = new Map();
    for (const [x, n] of holds) {
      const on = 'root, map(_gal_mob_a) = ' + n + ' && stateNo = ' + x.state;
      if (x.hub) {
        // A RELAY HUB's hold, by the trampoline that entered it: an intro's
        // freeze (the member and its layers on their last ticks), THE CLOCK
        // HELD a tick before the hub's time exit (a hit pause: its state's
        // lines wait and its time stays), or the trampoline entered again
        // where the hub would leave.
        const prevs = '(' + [...new Set(x.hub.map((r) => r.prev))].map((p) => 'prevStateNo = ' + p).join(' || ') + ')';
        if (x.freeze) {
          L('\tif ' + on + ' && ' + prevs + ' && anim = ' + x.anim + ' && animTime >= -2 { assertSpecial{flag: animfreeze} }');
          for (const e of x.explods) {
            L('\tif ' + on + ' && ' + prevs + ' && anim = ' + x.anim + ' && animTime >= -2 && numExplod(' + e + ') > 0 { modifyExplod{id: ' + e + '; animfreeze: 1} }');
            if (!layers.has(e)) layers.set(e, []);
            layers.get(e).push('(' + on + ' && ' + prevs + ')');
          }
        }
        for (const r of x.hub) {
          if (r.stop) { L('\tif ' + on + ' && prevStateNo = ' + r.prev + ' && time >= ' + r.at + ' { modifyPlayer{hitpausetime: 1} }'); continue; }
          L('\tif ' + on + ' && prevStateNo = ' + r.prev + (r.end ? ' && animTime = 0' : '') + ' && time >= ' + r.at + ' {');
          cut(null, r.to);
          L('\t}');
        }
        continue;
      }
      if (x.anim != null) {
        // (An offset pose's: the state entered again, its own entry makes the
        // pose and its layers - a tick after it entered, which already made
        // them.)
        if (x.enter) {
          L('\tif ' + on + ' && anim != ' + x.anim + ' && time > 0 {');
          cut(null, x.state);
          L('\t}');
        } else L('\tif ' + on + ' && anim != ' + x.anim + ' { changeAnim{value: ' + x.anim + '} }');
        if (x.freeze) {
          L('\tif ' + on + ' && anim = ' + x.anim + ' && animTime >= -2 { assertSpecial{flag: animfreeze} }');
          for (const e of x.explods) {
            L('\tif ' + on + ' && anim = ' + x.anim + ' && animTime >= -2 && numExplod(' + e + ') > 0 { modifyExplod{id: ' + e + '; animfreeze: 1} }');
            if (!layers.has(e)) layers.set(e, []);
            layers.get(e).push('(' + on + ')');
          }
        } else L('\tif ' + on + ' && anim = ' + x.anim + ' && animTime = 0 { changeAnim{value: ' + x.anim + '} }');
        for (const [E, e, et] of x.skip) L('\tif ' + on + ' && anim = ' + x.anim + ' && animElemTime(' + E + ') = 0 { changeAnim{value: ' + x.anim + '; elem: ' + e + '; elemtime: ' + et + '} }');
      }
      if (x.restart) {
        L('\tif ' + on + ' && time >= ' + x.restart + ' {');
        cut(null, x.state);
        L('\t}');
      }
    }
    for (const [e, ons] of layers) L('\tif numExplod(' + e + ') > 0 && !(' + ons.join(' || ') + ') { modifyExplod{id: ' + e + '; animfreeze: 0} }');
    L('}');
  }
  if (D.goSets.length || D.holdSets.some((x) => x.restart || x.enter || x.hub)) {
    L('# THE CUT on a member\'s own helpers: a child of the member that jumped this');
    L('# frame (its mark) goes with its explods - it runs after the member, being');
    L('# made later. One its new state makes on that very tick (time 0) stays:');
    L('# the new scene\'s own. (parentExist first: a parent redirect on a helper');
    L('# whose parent is gone writes the engine\'s log every frame.)');
    L('ignorehitpause if isHelper && gameMode = "hgallery" && time > 0 && parentExist && parent, map(_gal_mob_cut) = 1 {');
    L('\tdestroySelf{recursive: 1; removeexplods: 1}');
    L('}');
  }
  if (D.holdSets.some((x) => x.freeze)) {
    L('# HER SIDE OF A FROZEN INTRO: while the driver marks her (_gal_mob_hz, the');
    L('# step shows), her own animation is held still on its last ticks too.');
    L('ignorehitpause if !isHelper && gameMode = "hgallery" && map(_gal_mob_hz) > 0 && animTime >= -2 {');
    L('\tassertSpecial{flag: animfreeze}');
    L('}');
  }
  const parked = sortNums(D.members.filter((mm) => mm.park).map((mm) => mm.id));
  if (parked.length) {
    P('# PARKED UNTIL ITS JUMP: a member whose hit is live from its first tick,');
    P('# wherever it comes out (past a screen edge beside another pair), is held');
    P('# far above the stage after its own state until the jump marks it');
    P('# (_gal_mob_j): its own flight catches no one and is never drawn.');
    for (const id of parked) {
      P('ignorehitpause if isHelper(' + id + ') && gameMode = "hgallery" && map(_gal_mob_j) = 0 {');
      P('\tposSet{y: -10000}');
      P('}');
    }
  }
  const her = '(playerID(root, map(_gal_mob_her)), ';
  for (const id of D.ids) {
    const binds = sortNums(D.holdSets.filter((x) => x.id === id && x.bind).map((x) => x.state));
    if (binds.length) {
      P('# THE AUTHOR\'S BIND for member ' + id + ': in its pose states its layers name her as');
      P('# the player they bind to, and this engine binds them to it instead (its own');
      P('# PosSet parks it off the stage). So after its state it stands at her');
      P('# pose\'s contact point less its layers\' own offset (_gal_mob_at along her');
      P('# facing, at her height plus _gal_mob_aty), facing her and pushing no one: its layers, bound');
      P('# to it as the engine binds them, stand on her.');
      P('ignorehitpause if isHelper(' + id + ') && gameMode = "hgallery" && id = root, map(_gal_mob_id) && root, map(_gal_mob_her) > 0 && (' + binds.map((n) => 'stateNo = ' + n).join(' || ') + ') {');
      P('\tposSet{x: ' + her + 'pos x) + (root, map(_gal_mob_at)) * ' + her + 'facing); y: ' + her + 'pos y) + (root, map(_gal_mob_aty))}');
      P('\tvelSet{x: 0; y: 0}');
      P('\tif facing = ' + her + 'facing) {');
      P('\t\tturn{}');
      P('\t}');
      P('\tplayerPush{value: 0}');
      P('}');
    }
    const cols = D.holdSets.filter((x) => x.id === id && x.colors);
    if (cols.length) {
      P('# ITS OWN COLORS for member ' + id + ': its own state repaints every palette of');
      P('# his sprite file onto one (RemapPal source -1), and the layers it makes with');
      P('# their own palettes (ownpal and a remappal naming a sprite\'s palette, which an');
      P('# SFF v1 file has no key for) copy that repaint: the x-ray drawn black. Its');
      P('# repaint is cleared before its state (its play block) and made again here,');
      P('# as its files make it: its other layers still wear its palette.');
      P('ignorehitpause if isHelper(' + id + ') && gameMode = "hgallery" && id = root, map(_gal_mob_id) && root, map(_gal_mob_pal) {');
      P('\tremapPal{source: -1, 0; dest: ' + cols[0].colors.join(', ') + '}');
      P('}');
    }
  }
  for (const id of D.cams) {
    L('# HIS CAMERA CURSOR ' + id + ' (his author\'s, walked by his fwd/back): one only.');
    L('# His round state spawns one at its time 0, which every reset passes: a');
    L('# newcomer goes on its first tick, before it is drawn (never every one -');
    L('# his -2 brings one back whenever none is out).');
    L('ignorehitpause if isHelper(' + id + ') && gameMode = "hgallery" && root, map(_gal_mob_cam) && root, numHelper(' + id + ') > 1 && time = 0 {');
    L('\tdestroySelf{recursive: 1; removeexplods: 1}');
    L('}');
    P('# HIS CAMERA CURSOR ' + id + ': after its own ScreenBound (value 1, movecamera');
    P('# 1, 1), it never moves the camera and is not drawn.');
    P('ignorehitpause if isHelper(' + id + ') && gameMode = "hgallery" && root, map(_gal_mob_cam) {');
    P('\tscreenBound{value: 0; movecamera: 0, 0}');
    P('\tassertSpecial{flag: invisible}');
    P('}');
  }
  if (D.bind) {
    P('# AN AWAY ROOT (his idle PosSets him off the ground and the stage): while');
    P('# his member is out and plays (_gal_mob_b), after his own PosSet, he stands');
    P('# at _gal_mob_bx (his units from the stage\'s center) on the ground, facing');
    P('# as placed, never pushing her - the pair\'s center, its markers and the');
    P('# member\'s side read his place - and moves the camera only where the core');
    P('# asks nothing of it (_gal_free = 0).');
    P('ignorehitpause if !isHelper && gameMode = "hgallery" && map(_gal_mob_b) {');
    P('\tposSet{x: map(_gal_mob_bx) - cameraPos x; y: 0}');
    P('\tvelSet{x: 0; y: 0}');
    P('\tif facing != map(_gal_face) {');
    P('\t\tturn{}');
    P('\t}');
    P('\tplayerPush{value: 0}');
    P('\tif map(_gal_free) = 0 {');
    P('\t\tscreenBound{value: 0; movecamera: 1, 1}');
    P('\t}');
    P('}');
  }
  return out;
}

// A Lua literal of the members (numbers, booleans, plain strings, lists).
function luaLit(v) {
  if (v === null || v === undefined) return 'nil';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '0';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'string') return '"' + plain(v) + '"';
  if (Array.isArray(v)) return '{' + v.map(luaLit).join(', ') + '}';
  return '{ ' + Object.keys(v).filter((k) => v[k] !== undefined && v[k] !== null).map((k) => k + ' = ' + luaLit(v[k])).join(', ') + ' }';
}

// THE DRIVER'S CHUNK. Its locals are its own function's (MODE.add), never the
// main chunk's. Phases: the core's reset and place; 'grab' (M.grab starts the
// route, the core goes on to 'enter', and the tick turns that into
// 'mob:out' the same tick); 'mob:out' (M.drive: the member out, picked,
// settled, its grab asked, then the core's 'enter' waits for her scene);
// then the core's act and show. M.tick writes the maps every tick of a mob
// step; M.frame zeroes them on a giver whose step is not one any more.
function lua(t) {
  const D = t && t.modeData && t.modeData[ID];
  if (!D || !Array.isArray(D.members) || !D.members.length) return '';
  const members = '{\n' + D.members.map((x) => '    ' + luaLit({ id: x.id, who: x.who, cmd: x.cmd, state: x.state, after: x.after, present: x.present,
    from: x.from.length ? x.from : null, settle: x.settle, scenes: x.scenes, gap: x.gap, ids: x.ids }) + ',').join('\n') + '\n  }';
  const cams = luaLit(Array.isArray(D.cams) ? D.cams : []);
  return `-- THE MOB (gallerymodes/mob-rt.js): a member of his mob on her, one at a time.
MODE.add('mob', function()
  local M = {}
  -- The build's members: id, who, cmd (his spawn command's number in the
  -- hook's press lines, 0 none), state (his summon state, 0 none), after
  -- (his state time a press waits for, or the ticks a summon may take),
  -- present (one is always out), from (his states a press acts in), settle,
  -- scenes, gap (320-wide units past her), ids (all his member ids).
  local MEM = ${members}
  -- His camera cursors' helper ids (the build's), and per pair (by its
  -- number) whether its steps hide them.
  local CAMS, CAMP = ${cams}, {}
  local MAPS = { '_gal_mob_id', '_gal_mob_c', '_gal_mob_p', '_gal_mob_g', '_gal_mob_o', '_gal_mob_a', '_gal_mob_b', '_gal_mob_bx', '_gal_mob_her', '_gal_mob_at', '_gal_mob_aty', '_gal_mob_pal' }
  -- A giver whose maps may not be 0 (by player number).
  local DIRTY = {}
  -- A member out of its grab this long with her not taken missed; a grab is
  -- asked at most ASKS times before the driver's own limit takes over. The
  -- log's explods line, at most once in EX_EVERY ticks.
  local MISS, ASKS, EX_EVERY = 15, 3, 30
  local function inR(n, rs)
    if n == nil or rs == nil then return false end
    for _, r in ipairs(rs) do if n >= r[1] and n <= r[2] then return true end end
    return false
  end
  local function count(id) return onP(GIVER, function() return numHelper(id) end) or 0 end
  -- The player id of an instance of the member: the newest, or (scene) the
  -- newest one in a state that holds her.
  local function find(mb, scene)
    return onP(GIVER, function()
      local n, best = numHelper(mb.id), nil
      for i = n - 1, 0, -1 do
        if player(GIVER) and helper(mb.id, i) then
          local pid, st = id(), stateNo()
          if not scene then return pid end
          if inR(st, mb.scenes) then return pid end
          if best == nil then best = pid end
        end
      end
      return best
    end)
  end
  -- A member's state by its player id (nil: it is gone).
  local function stateOf(pid)
    if pid == nil then return nil end
    return onP(GIVER, function() if playerId(pid) then return stateNo() end return nil end)
  end
  local function zero(pn) for _, k in ipairs(MAPS) do mset(pn, k, 0) end end
  -- Her player id (M.tick's own local id hides the engine's function).
  local function herPid() return onP(RECV, function() return id() end) end
  -- Where its grab stands it: gap past her, from him (he faces her), facing
  -- her; in his units, from the camera or (several pairs: the hook's
  -- _gal_abs) from the stage's center.
  local function askAt(mb)
    local f = onP(GIVER, function() return facing() end) or 1
    local ug = onP(GIVER, function() return localCoordX() / 320 end) or 1
    local hx
    if NSLOT > 1 then hx = absX(RECV) else hx = onP(RECV, function() return posX() * 320 / localCoordX() end) end
    hx = hx or 0
    return (hx + f * mb.gap) * ug, -f, hx + f * mb.gap, hx
  end
  -- No lean is learned for a mob step (the member stands by her), and a
  -- step's own setup holds while its member comes out.
  local leanOk = LEAN.ok
  LEAN.ok = function(s) if s and s.mob then return false end return leanOk(s) end
  SETUP_PHASES['mob:out'] = true

  -- The grab: his route starts (a summon state entered); the member comes
  -- out in 'mob:out' (the tick turns the driver's enter into it).
  function M.grab(s)
    local mb = s.mob and MEM[s.mob.m]
    G.m = { st = 'spawn', n0 = 0 }
    if mb == nil then return end
    if not mb.present then G.m.n0 = count(mb.id) end
    if mb.state > 0 then
      local ok = onP(GIVER, function() return changeState(mb.state) end)
      log('mob: his summon ' .. mb.state .. (ok == false and ' is missing' or ''))
    end
  end

  -- 'mob:out': pressed until a new instance is out, picked, let settle, its
  -- grab asked; then the driver's enter waits for her scene.
  function M.drive(s)
    if G.phase ~= 'mob:out' then return end
    local mb = s.mob and MEM[s.mob.m]
    if mb == nil then G.note = 'its mob member is missing'; return begin('stuck') end
    local m = G.m
    if m == nil then m = { n0 = mb.present and 0 or count(mb.id) }; G.m = m end
    m.st, m.press = 'out', 0
    if m.pid == nil then
      if count(mb.id) > m.n0 then
        m.pid, m.at = find(mb, false), G.t
        if m.pid then
          local y = LOG and onP(GIVER, function() if playerId(m.pid) then return posY() end return nil end)
          log('mob: ' .. mb.who .. ' ' .. mb.id .. ' out pid=' .. m.pid .. ' after ' .. G.t .. (y and string.format(' at y %.0f', y) or ''))
        end
      elseif mb.cmd > 0 then
        local ht = onP(GIVER, function() return time() end) or 0
        if ht >= mb.after and (mb.from == nil or member(giverState(), mb.from)) and (m.pt == nil or G.t - m.pt >= K.PRESS_EVERY) then
          m.press, m.pt = mb.cmd, G.t
        end
      end
    end
    if m.pid then
      local st = stateOf(m.pid)
      if st == nil then log('mob: its ' .. mb.who .. ' left before its grab'); m.pid = nil; return begin('reset') end
      if LOG and st ~= m.seen then m.seen = st; log('mob: its ' .. st .. ' t=' .. G.t) end
      if G.t - m.at >= 2 and not inR(st, mb.settle) then
        m.ask, m.asks, m.miss = true, 1, 0
        return begin('enter')
      end
    end
    if G.t > K.SUMMON_MAX + (mb.state > 0 and mb.after or 0) then
      G.note = 'his mob sent no ' .. mb.who
      begin('stuck')
    end
  end

  -- Every tick of a mob step, every phase: the hook's maps.
  function M.tick(s)
    local mob = s and s.mob
    local mb = mob and MEM[mob.m]
    if mb == nil then return end
    DIRTY[GIVER] = true
    local ph, m = G.phase, G.m
    -- (The driver went on from the grab to its enter: the member first.)
    if ph == 'enter' and m and m.st == 'spawn' then begin('mob:out'); ph = G.phase end
    -- (A move in place cleared the mode's state: the member on her again.)
    if (ph == 'enter' or ph == 'act' or ph == 'show') and (m == nil or m.pid == nil) then
      local pid = find(mb, true)
      if pid then m = m or {}; m.pid, m.st, m.asks, m.miss = pid, 'found', ASKS, 0; G.m = m end
    end
    local pid = m and m.pid
    if pid and (ph == 'enter' or ph == 'act' or ph == 'show') and stateOf(pid) == nil then
      log('mob: its ' .. mb.who .. ' is gone')
      m.pid, pid = nil, nil
      -- (Gone before its grab took her: grabbed again, as a grab that missed.)
      if ph == 'enter' then
        G.tries = G.tries + 1
        if G.tries < 3 then return begin('reset') end
        G.note = 'this scene did not start'
        return begin('stuck')
      end
    end
    local id = 0
    if ph == 'reset' or ph == 'place' or ph == 'grab' or ph == 'stuck' then id = -1
    elseif pid and (ph == 'mob:out' or ph == 'enter' or ph == 'act' or ph == 'show') then id = pid end
    mset(GIVER, '_gal_mob_id', id)
    mset(GIVER, '_gal_mob_c', (ph == 'mob:out' and m and m.press) or 0)
    mset(GIVER, '_gal_mob_p', (id > 0 and mob.p) or 0)
    -- Its grab: asked once by the drive, and again where it missed.
    local ask = false
    if ph == 'enter' and id > 0 then
      if m.ask then ask, m.ask = true, false
      elseif not inScene() then
        local st = stateOf(pid)
        if st ~= mob.gs and not inR(st, mb.scenes) then m.miss = (m.miss or 0) + 1 else m.miss = 0 end
        if m.miss > MISS and (m.asks or ASKS) < ASKS then
          ask, m.miss, m.asks = true, 0, m.asks + 1
          log('mob: its grab missed - again')
        end
      end
    end
    if ask then
      local x, f, at, hx = askAt(mb)
      mset(GIVER, '_gal_mob_x', x); mset(GIVER, '_gal_mob_f', f)
      log(string.format('mob: grab asked at x %.0f (her at %.0f) facing ', at, hx) .. tostring(f) .. ', her helpers out ' .. tostring(onP(RECV, function() return numHelper() end) or 0))
    end
    mset(GIVER, '_gal_mob_g', (ask and mob.g) or 0)
    -- (A relay hub's go while the step shows too: her state is the same for
    -- every look its judge draws.)
    mset(GIVER, '_gal_mob_o', ((ph == 'act' or (ph == 'show' and mob.ho == 1)) and id > 0 and mob.o) or 0)
    mset(GIVER, '_gal_mob_a', ((ph == 'act' or ph == 'show') and id > 0 and mob.a) or 0)
    -- THE AUTHOR'S BIND: her player id while a hold that binds plays, and
    -- its contact point; ITS OWN COLORS while a hold that keeps them plays.
    mset(GIVER, '_gal_mob_her', ((ph == 'act' or ph == 'show') and id > 0 and mob.hb == 1 and herPid()) or 0)
    mset(GIVER, '_gal_mob_at', ((ph == 'act' or ph == 'show') and id > 0 and mob.hb == 1 and mob.at) or 0)
    mset(GIVER, '_gal_mob_aty', ((ph == 'act' or ph == 'show') and id > 0 and mob.hb == 1 and mob.aty) or 0)
    mset(GIVER, '_gal_mob_pal', ((ph == 'act' or ph == 'show') and id > 0 and mob.co == 1) and 1 or 0)
    -- An away root, held beside her while his member is out and plays: GAP
    -- behind her as the place stood him (the far left of several pairs,
    -- mirrored, on her other side), in his units from the stage's center.
    local bind = mob.b == 1 and (ph == 'mob:out' or ph == 'enter' or ph == 'act' or ph == 'show')
    if bind then
      local fpl = (NSLOT > 1 and G.k == 1 and (s.edgeOnly or s.wide)) and -1 or 1
      local ug = onP(GIVER, function() return localCoordX() / 320 end) or 1
      mset(GIVER, '_gal_mob_bx', ((absX(RECV) or 0) - fpl * GAP) * ug)
    end
    mset(GIVER, '_gal_mob_b', bind and 1 or 0)
    -- Her side of a frozen intro, while it shows.
    local hz = (ph == 'show' and id > 0 and mob.fz == 1 and member(recvState(), s.states)) and 1 or 0
    mset(RECV, '_gal_mob_hz', hz)
    if LOG and m and hz ~= (m.hz or 0) then m.hz = hz; log('mob: her intro held still ' .. hz) end
    if LOG and m and pid and ph ~= 'mob:out' then
      local q = onP(GIVER, function() if playerId(pid) then return { stateNo(), time() } end return nil end) or {}
      local st, mt = q[1], q[2]
      if st ~= m.seen then m.seen = st; log('mob: its ' .. tostring(st) .. ' t=' .. G.t)
      elseif mt ~= nil and m.mt ~= nil and mt < m.mt then log('mob: its ' .. tostring(st) .. ' restarted at ' .. m.mt .. ' t=' .. G.t)
      elseif mt ~= nil and mt == m.mt and not m.held and MATCH.f - (m.mtF or MATCH.f) >= 3 then m.held = true; log('mob: its ' .. tostring(st) .. ' clock held at ' .. mt .. ' t=' .. G.t) end
      -- (Held: the same state time three match frames on - a phase change
      -- can tick the driver twice in one frame.)
      if mt ~= m.mt then m.held, m.mtF = nil, MATCH.f end
      m.mt = mt
    end
    -- (The member's explods, each time their set changes - at most once in
    -- EX_EVERY ticks, then the set as it is: none twice, the step's own.)
    if LOG and m and pid and (ph == 'act' or ph == 'show') then
      local ex = onP(GIVER, function()
        if not playerId(pid) then return nil end
        local t = {}
        for i = 0, math.min(numExplod(-1) or 0, 16) - 1 do t[#t + 1] = tostring(explodVar(-1, i, 'id')) .. ':' .. tostring(explodVar(-1, i, 'anim')) end
        table.sort(t)
        return table.concat(t, ',')
      end)
      if ex ~= nil and ex ~= m.ex and (m.exT == nil or G.t < m.exT or G.t - m.exT >= EX_EVERY) then
        m.ex, m.exT = ex, G.t
        log('mob: its explods ' .. (ex == '' and 'none' or ex))
      end
    end
    if LOG and ph == 'show' and G.t == 0 then
      local t = {}
      for _, i in ipairs(mb.ids) do t[#t + 1] = i .. '=' .. count(i) end
      log('mob: members out ' .. table.concat(t, ','))
      log('mob: her helpers out ' .. tostring(onP(RECV, function() return numHelper() end) or 0))
      if mob.c == 1 then
        local c = {}
        for _, i in ipairs(CAMS) do c[#c + 1] = i .. '=' .. count(i) end
        log('mob: his camera cursors ' .. table.concat(c, ','))
      end
      if mob.b == 1 then
        log(string.format('mob: his root at %.0f y %.0f (her at %.0f), camera at %.0f', absX(GIVER) or 0, onP(GIVER, function() return posY() end) or 0,
          absX(RECV) or 0, cameraPosX() * 320 / screenWidth()))
      end
    end
  end

  -- In place: another step of the same member, with an instance of it out
  -- (the scene its grab started is still running: the driver checks that),
  -- whose position the hook can set - a step with none (its grab) only while
  -- her state is one of its own already (only a grab brings it otherwise).
  function M.inPlace(prev, s)
    local a, b = prev and prev.mob, s and s.mob
    if not (a and b) or a.m ~= b.m then return false end
    if (b.o or 0) == 0 and not showing(s) then return false end
    local mb = MEM[b.m]
    return mb ~= nil and count(mb.id) > 0
  end
  -- The status line while his mob brings the member.
  function M.status(a, phase)
    if a == nil and phase == 'mob:out' then return 'his mob is coming...' end
    return nil
  end

  -- A pair whose steps hide his camera cursors (by its number, once).
  local function camsOf(pi)
    if CAMP[pi] == nil then
      local p = DATA.pairs[pi]
      CAMP[pi] = false
      for _, st in ipairs((p and p.steps) or {}) do if st.mob and st.mob.c == 1 then CAMP[pi] = true; break end end
    end
    return CAMP[pi]
  end
  -- Every match tick: his camera cursors hidden for a pair whose steps say
  -- so, from the match's first frame (the round intro pulls the view to
  -- them already); a giver whose step is no longer a mob step (or a fight
  -- not in round state 2, where no tick runs) has every other map at 0, and
  -- her side of an intro lets go.
  function M.frame()
    local rs = roundState()
    for k = 1, NSLOT do
      local pn = 2 * k - 1
      local g = SLOTS[k]
      if #CAMS > 0 then mset(pn, '_gal_mob_cam', (g and camsOf(g.pi)) and 1 or 0) end
      if DIRTY[pn] then
        local p = g and DATA.pairs[g.pi]
        local st = p and p.steps[g.si]
        if rs ~= 2 or not (st and st.mob) then zero(pn); mset(pn + 1, '_gal_mob_hz', 0); DIRTY[pn] = nil end
      end
    end
    return nil
  end
  -- A new match: every giver's maps once to 0 (a kept character keeps them).
  function M.match()
    DIRTY = {}
    for pn = 1, 8 do DIRTY[pn] = true end
    return nil
  end
  return M
end)`;
}

module.exports = { id: ID, trimStep, zss, lua, MAPS };
