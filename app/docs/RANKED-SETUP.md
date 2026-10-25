# Setting up online play

> **Only for WebMUGEN, the web version of your build.** Everything here - the
> lobby relay, the queue, TURN and the leaderboard - reaches players through a
> Website export (and room codes through Test in Browser). A **Desktop export**
> is the stock Ikemen GO and uses none of it: its own online play connects two
> players directly by IP address and never talks to these servers.

So you want your build to have online matches — maybe just friends swapping a
room code, maybe a full ranked ladder with names and ratings.

This guide is for someone comfortable with MUGEN who has never run a server. It
explains what each piece does, what you can skip, and how to get the rest.

**The short version:** online play already works with none of this. For the
rest, the desktop Studio can set up your own servers for you: one free
Cloudflare account, one pasted key, one button (§3). Everything runs on
accounts you own, and you can stop at any point in the list.

---

## 1. Do you actually need any of this?

Probably less than you think. Read down until you hit the row that describes you
and stop there.

| What you want | What you need to run |
|---|---|
| Two friends play online, occasionally | **Nothing.** It already works |
| Friends play without pasting a huge blob of text | A **lobby relay** |
| "Find me a match" (casual or ranked) against whoever's around | A relay with a **queue**, plus **player names**. The queue only lets in players who have claimed a name, casual too |
| Ratings and a leaderboard | The **leaderboard server** (the same server that keeps the names) |
| Players on awkward home internet can connect too | Add a **TURN relay** |

**The Studio's "Set up my servers" button gives you the first four rows at
once:** the relay, the queue, player names and the leaderboard, on one free
Cloudflare account of yours (§3). TURN is separate and optional (§4).

### Why "nothing" is a real option

Two players can connect right now by copying a block of text to each other — one
creates the connection, sends the blob over a chat app, the other pastes it back.
Ugly, but it needs no server, costs nothing, and always works. Everything below
exists to hide that copy-paste, not to enable the match.

**None of this is required, and none of it can break a match.** If your server is
down, slow, or you never set one up, the game still plays. The code checks for
each piece and quietly skips what isn't there.

---

## 2. The pieces, in plain terms

### The lobby relay — "swap a room code instead of a paragraph"

When two players connect, their computers have to exchange a long block of
technical text describing how to reach each other. The relay is a middleman that
holds that text for a moment so the players can trade a short code like
`spicy-tiger-42` instead.

**It only helps them find each other.** Once connected, the match runs directly
between the two players — the relay sees none of the game. It is doing nothing
99% of the time, which is why it is cheap to run.

### The queue — "find me an opponent"

Same server, one more job: keep a list of who's waiting and pair them up. This is
what NETWORK ▸ CASUAL MATCH and NETWORK ▸ RANKED MATCH talk to.

It needs to know who is who, so **a player must claim a name before queueing**
(NETWORK ▸ PLAYER NAME). That is why a queue always comes with the names half of
the leaderboard server.

Its other real responsibility: **don't pair players whose games would disagree.**
Different characters installed, or a different netcode setting, means the two
copies drift apart mid-match and it looks like lag or cheating. The queue is
handed enough information to refuse those pairings — use it.

### The leaderboard server — "who you are, and your rating"

Stores a player name, the code that proves it's yours, and the win/loss record.
When a ranked match ends, **both players tell this server what happened**, and it
compares the two stories before recording anything.

This is the only piece that keeps data, so it is the one with real
responsibilities (see § 6).

### TURN — "for players whose internet won't cooperate"

Most players connect directly. Some home routers and mobile networks won't allow
it, and for those a TURN server relays the actual game traffic as a fallback.

**This is the one piece that gets more expensive the more players you have**,
since relayed matches pass their traffic through your server. Skipping it is
completely reasonable — you just accept that some people can't connect.

---

## 3. The easy way: let the Studio set up your servers

The desktop Studio can put the lobby relay, the queue, player names and the
leaderboard on a free Cloudflare account of your own. You make the account and a
key for it, and the Studio does the rest. The first time takes about 10 minutes.

### What you get

One small server program (Cloudflare calls it a **Worker**) on your own account.
Everything lives at one address:

```
https://<server name>.<your workers.dev name>.workers.dev
```

- The **server name** is `mugen-online` unless you type another.
- The **workers.dev name** is picked once for your whole Cloudflare account.
- The lobby relay is the same address, starting with `wss://` instead of
  `https://`, with `/ws` on the end. You never type either one: the Studio fills
  them in.

**What it costs:** nothing, on Cloudflare's free Workers plan, for a
friends-and-regulars community. The free plan has daily limits, and the servers
are built to stay inside them: a player waiting in the queue is let go after 10
minutes, and a room nobody joins closes after 30. Check Cloudflare's current
limits yourself; they change.

**What it does not do:**

- **Put your game online.** You still upload your Website export somewhere:
  itch.io, GitHub Pages, Cloudflare Pages, Neocities or your own site.
- **TURN.** Optional, and separate (§4).
- **Desktop builds.** Room codes, names, ranked and casual are for the Website
  export. A desktop export has no online menu.

### Step by step

Open **Settings → Online** in the desktop Studio. The first group is **Your own
servers (Cloudflare)**, and its numbered steps are these.

1. **A Cloudflare account.** Press **Open Cloudflare sign-up** and make a free
   account. Then open the email Cloudflare sends you and press its link to
   **verify your email address**. Cloudflare will not run servers for an
   account that is not verified. Already have an account? Go on to step 2.
2. **A token for the Studio.** Make it as shown in *Making the token*, below,
   and paste it into **Paste the token**. The Studio checks it with Cloudflare
   right away: you should see **The token works** and your account's name.
3. **Which account.** This step only appears when your token reaches more than
   one Cloudflare account. Pick the one the servers should live in.
4. **Server name.** Keep `mugen-online` or type your own: lowercase letters,
   digits and dashes. It becomes the first part of your address, so players see
   it. If your Cloudflare account has no workers.dev name yet, a **Your
   workers.dev name** box appears too: pick one (every Worker on the account
   shares it, and it also shows in your address) and wait for **free**.
5. **Set up.** Press **Set up my servers**. A list shows each step as it
   happens. The first time takes a few minutes: after the upload, Cloudflare
   needs about 1 to 5 minutes to switch on a new address (the first real setup
   needed 14 checks, about two and a half minutes). The list then says
   **Cloudflare is switching on your new address** and **Still waiting for
   Cloudflare** with the time so far: nothing is broken, the Studio keeps
   checking on its own. It ends with **Done: your servers are ready**.

**What the button changes on your computer:**

- **This computer's lobby relay address** (the **Lobby relay** group lower on the
  tab). Test in browser and your Website exports use it.
- **The open bundle's leaderboard address**, and it ticks the bundle's **Online
  menu**, so the game shows PLAYER NAME, CASUAL MATCH, RANKED MATCH and YOUR
  RANK.
- **Nothing else without asking.** If either address already holds something
  else, the Studio lists what it would replace and changes nothing until you
  press **Replace them**.

Then **export your website with Public build off**, upload it, and check it
works (§7).

### Making the token

A token is a key that lets the Studio work on your Cloudflare account. It can do
only what it was made for, and you can delete it at any time.

1. In the Studio, press **Create my token**. Your web browser opens Cloudflare's
   token page (sign in if it asks) with everything already filled in: the name
   **Mugen Studio servers** and the two permissions in the table below.
2. Scroll down and press **Continue to summary**, then **Create Token**.
3. Cloudflare shows the token **only once**. Press **Copy**, then paste it into
   the Studio's **Paste the token** box.

| Permission | What the Studio uses it for |
|---|---|
| **Workers Scripts: Edit** | Putting the servers on your account, turning on their workers.dev address, updating them and removing them |
| **Account Settings: Read** | Finding which Cloudflare account is yours, and its name |

**If the button does not open the page:** in Cloudflare, go to **My Profile** →
**API Tokens** → **Create Token** → **Create Custom Token**. Name it, add those
two permissions (both are under **Account**), choose your account under
**Account Resources**, then carry on from step 2. Cloudflare moves its buttons
around now and then; if one is not where this says, look for **API Tokens**
under your profile.

**What the Studio does with it:**

- **It checks it first.** The Studio asks Cloudflare whether the token works
  and whether it can manage Workers on your account. A token made without
  **Workers Scripts: Edit** gets a red "missing a permission" right away, and
  **Set up my servers** stays off until you paste one that has it. Pasting it
  with `Bearer ` in front (the way Cloudflare's own example shows it) is fine.
- **It remembers it on this computer**, once Cloudflare has accepted it, in the
  same private settings file as the TURN key. After that the Studio only ever
  shows its last four characters ("saved, ends in …").
- **It never puts it in a build.** Every export, and every copy of the Studio,
  is checked for it before it is reported as done, and one that contains it
  stops with an error that says which files. That happens if the token was
  pasted into the wrong box, such as the site title or credit: take it out
  there and export again.
- **You only need it again to update or remove your servers.** They keep running
  without it. **Forget token** deletes the Studio's copy; Cloudflare still
  accepts the token until you delete it on its **API Tokens** page (the Studio
  offers a button for that page).

**Keep it to yourself.** Anyone with the token can change the Workers on your
account. The Studio only ever changes the one it made: it marks its own servers,
and it refuses to overwrite or remove a Worker without that mark. If you already
run other Workers on this Cloudflare account and want them fully out of reach, use
a separate free account for the game.

### Once it is set up

The group then shows:

- **Lobby relay** and **Leaderboard:** your two addresses.
- **Test my servers:** asks your servers for a room and for the leaderboard, the
  way a player's game does. Both should say **answered**. Right after the first
  setup, give a brand-new workers.dev name a few minutes.
- **This bundle:** each bundle keeps its own leaderboard address. To give another
  bundle the same servers, open that bundle and press **Use them in this
  bundle** (it asks before replacing a different address). Every bundle that
  uses your servers shares one set of names and one leaderboard.
- **Token:** saved or not, and **Forget token**.
- **Update my servers:** after you update the Studio, this puts its version of
  the servers on Cloudflare. Every name and rating is kept.
- **Save a copy of the leaderboard:** every player name and rating, as a `.json`
  file on this computer, in your servers' own backup format. **Save a copy**
  under **Players** saves the same names and records in another layout,
  straight to your download folder.

To see and change the players themselves - a lost recovery code, a test name to
free, a record to fix - use the **Players** group under **Leaderboard** on the
same tab (*Managing players*, in §4). It already has your servers' key.

### Removing them, or starting over

**Remove my servers** deletes the servers from your Cloudflare account, and with
them **every player name and rating, for good.** The Studio asks you to type the
server name first and offers **Save a copy first**. Afterward, room codes, names
and ranked stop working in any build that uses them, and the Studio clears the
two addresses from this computer and from the open bundle. Another bundle that
used them keeps the old address until you clear its **Leaderboard address** or
set up again and press **Use them in this bundle** there; the Studio names those
bundles when it asks you to confirm, and again once the servers are gone. Remove
needs the token, so paste it again first if you pressed **Forget token**.

- **Start over with an empty leaderboard:** Remove, then **Set up my servers**
  again.
- **Stop for good:** Remove, press **Forget token**, then delete the token on
  Cloudflare's **API Tokens** page.
- **On a new computer:** the Studio remembers your servers on the computer that
  set them up. On another one, paste a token and set up with the **same server
  name**: the Studio updates the same servers and keeps every name and rating.
  Only the first computer can save a copy of the leaderboard, because it holds
  the servers' private admin key.

---

## 4. Telling your build where they are

**The button fills all of this in for you.** Read on to know what the fields
mean, to add TURN, or to use servers you run somewhere else.

Two files hold the addresses, and neither is ever copied into a build you give to
somebody else. The desktop Studio's **Settings → Online** tab edits both and has
a **Test** per group, so you need not open them in an editor.

**`local-config.json`** in the `Settings` folder beside `app` (where Mugen
Studio keeps your own settings and keys, so an update never replaces them; a
checkout of the source keeps it beside the program) — this computer's relay and
TURN:

```json
{
  "signalUrl":  "wss://your-relay-host/ws",
  "meteredApp": "yourname",
  "meteredKey": "your-api-key"
}
```

`meteredApp` is the *yourname* in your Metered address, `yourname.metered.live`
(the Online tab also takes the whole address and keeps just the name). Leave any
of them as `""` to turn that piece off. **The Studio ships with all three blank
on purpose** — a fresh copy is a working game with the lobby off, and you add
what you have. The same file also keeps what **Set up my servers** made, with
its token, so the Studio can update or remove them later.

**`roster.json`** — each bundle's leaderboard and online menu:

```json
{
  "identityUrl": "https://your-leaderboard-host",
  "onlineName":  true
}
```

Blank `identityUrl` switches names, ratings, the queue and the whole ranked
display off.

**Where each one ends up:**

- **Test in browser** uses this computer's lobby relay, but never the leaderboard.
  So room codes work there, while names, casual and ranked need an exported
  site. (It also keeps test matches off your real leaderboard.)
- **A Website export with Public build off** carries both: the relay, the
  leaderboard address, the name system, the NETWORK menu entries and
  `leaderboard.html`.
- **A Public build** leaves all of it out (see *Export with Public build off*,
  below).
- **A desktop export** has no online menu.

**The leaderboard page.** With an address set, the Online tab offers a page for
players to see the ranking - a plain standings table, or an arcade-style
"Score Ranking" board - with a preview. The Website export puts it next to the
game as `leaderboard.html`, already pointed at your server; link to it from
your site. It reads `GET /mugen/leaderboard?limit=N` (section 5), and only while
someone has it open, so it never keeps a sleeping server awake.

**The board's character art.** The Score Ranking board shows each player's
character: a portrait on every row, and 1st place opens up with that
character's win pose. The Studio makes this art from the characters in your
build once the leaderboard address is set: every Website export (Public
build off) makes it again, so a character you add gets its art, and the
**Make it now** button under the page choice makes it without exporting, so
the preview shows it. It is kept with your content, in
`Content\<bundle>\leaderboard-art\`, and the export puts a copy beside
`leaderboard.html` as `leaderboard-art/` - upload that folder with the rest
of the site. The plain standings page draws no art, so none is copied beside
it. A character's pose and colors are picked for you (the win pose the game
plays, in its default colors); to choose another, show that action in the
character's animation panel and tick **Leaderboard win pose** in its GIF
options (the arrow beside GIF). A copy without the GIF button always uses the
pose the game plays.

**Export with Public build off.** Your own site is a normal Website export. A
Public build is for handing the game to other people, so it leaves the
leaderboard address, the name system, the ranked menu and `leaderboard.html`
out.

> **Keep your keys in `local-config.json` and nowhere else.** The build tool
> knows that file is private and refuses to copy it into anything you export. If
> you paste a key into a source file instead, the export guard will catch it and
> stop the build — that is the check doing its job, not a bug.

### Adding TURN (optional)

The Studio's servers do not include TURN. For it, use **Metered**: the **TURN
relay** group on the same tab walks you through making the account and pasting
its app name and key. Each player's game fetches its own short-lived relay pass
with that key, so anyone who looks can find it and use your allowance - fine for
friends, worth a thought before a public site.

### Running your servers somewhere else (the manual path)

You do not have to use the button. Any server that speaks the protocol in §5
works: type its addresses into the **Lobby relay** and **Leaderboard** groups
and press their **Test**.

| Piece | Where it can run |
|---|---|
| **Lobby relay + queue** | Cloudflare Workers with Durable Objects (what the button uses), or any always-on Node/Python/Go host with WebSockets — Railway, Render, Fly.io, a small VPS |
| **Names + leaderboard** | Any small web app with storage — Fly.io, Railway, Render, a $5-a-month VPS. Your queue has to check names against it |
| **TURN relay** | Metered (hosted, nothing to maintain), Twilio's TURN, or **coturn** on a VPS of your own |
| **The game itself** | Any static web host — itch.io, GitHub Pages, Cloudflare Pages, Neocities, your own box |

**On cost:** the relay and queue do almost nothing per match, so they fit free
tiers. A separate leaderboard server is a small always-on app — cheap, but
usually not free. TURN is the one that scales with use. Check current pricing
yourself; these change and this document will go stale.

### Managing players

**Settings → Online → Players**, right under **Leaderboard**, lists every name
claimed on the open bundle's leaderboard with each player's rating, wins,
losses and games, and lets you change them without touching the server. Type
in **Find a name** to narrow the list.

| Button | What it does |
|---|---|
| **New code** | Makes a new recovery code for that name and shows it **once**, with a **Copy** button. Give it to the player: with their name, it gets them back in under NETWORK ▸ PLAYER NAME. Their old code stops working. The server keeps no copy of a code it could show you, so this is the answer to "I lost my code" |
| **Release name** | Frees the name so anyone can claim it. The player's code stops working. If they have a leaderboard row, **Also take their rating and record off the leaderboard** is ticked: leave it ticked, because a rating and record left on the leaderboard go to whoever claims the name next (their first ranked match continues that row) |
| **Remove from leaderboard** | Deletes the player's rating and record. The name stays theirs, and their next ranked match starts them again at 1000 |
| **Edit numbers** | Corrects the rating, wins, losses or games. Games is raised to at least wins + losses |
| **Save a copy** | Every name, rating and record, as a `.json` file on this computer |
| **Reset the leaderboard** | Deletes every rating and record. Names stay claimed. You type `reset` to confirm, and a copy is saved first |

Each button asks before it changes anything. To take a test account away
completely, press **Release name** and keep the tick: the Studio takes the
leaderboard row off first, then frees the name. The name and the leaderboard
row are separate records on the server, and removing only one leaves the
other: a row without its name waits for whoever claims that name next.

A name with no leaderboard row reads *not on the leaderboard*: it has not
played a ranked match yet, or its row was removed.

The group stays closed until you open it, so opening the Online tab never
wakes a leaderboard server that sleeps while nobody plays.

**The admin key.** Every change is made with your leaderboard server's admin
key.

- **Servers the Studio set up for you** (§3): nothing to do. The Studio
  already has their key, on the computer that set them up. If they were set up
  again from another computer, they refuse this computer's key, and the group
  shows **Admin key for this leaderboard**: paste the key from that computer
  and press **Test**. From then on it is the one used; **Forget key** goes back
  to the old one.
- **Any other leaderboard server:** paste the admin key it was set up with (its
  `ADMIN_KEY`) into **Admin key for this leaderboard** and press **Test**. The
  Studio keeps the key only if the server accepts it, and only for that one
  leaderboard address. Another bundle with another address needs its own.
- The key stays on this computer, in `local-config.json` beside the Cloudflare
  token. The Studio shows only that it is saved, never any part of it,
  **Forget key** removes it, and every export and copy of the Studio is checked
  for it and refused if it carries it. On some servers the admin key opens more
  than the leaderboard, so treat it like a password.
- It is sent only to the address it was saved for: over `https://` (plain
  `http://` only to this computer or your own home network), and never on to
  another address the server points at.

**Copies, and the reset.** A reset always saves a copy first and only resets
once that copy is on your disk. Copies go to your **Downloads** folder (or the
download folder you picked in the Studio, unless it is inside the Studio's own
folder, your bundles or an export folder, where a build could pick one up),
named
`leaderboard-<server>-<date and time>.json`, with `-before-reset` at the end
of the one a reset made. The page shows the folder before you confirm and the
file afterward. A copy holds names and records, never a key or a recovery
code. There is no button to load one back into a server: it is a record to
keep, and to rebuild from by hand if you ever need to.

| What you see | What to do |
|---|---|
| The leaderboard server refused that key | The key is not the one the server was set up with. Check it and paste it again |
| It refused the saved admin key | The key was changed on the server. Press **Forget key** and paste the new one |
| Your servers refused the admin key this Studio saved | They were set up again from another computer, which now has their key. Paste it into **Admin key for this leaderboard** and press **Test** |
| The leaderboard server did not answer | Check the **Leaderboard address**. A server that sleeps while nobody plays can take a moment: press **Refresh** |
| The leaderboard server answered 503 (or another number). Try again in a minute | The server had an error. Nothing was sent to it but a plain "are you there": press **Refresh** in a minute |
| Every row says *record unreadable*, and the server says its leaderboard file is damaged | The server cannot read its own file, so it cannot reset it either. **Save a copy**: it holds the file's raw contents, to repair or replace the file on the server itself |
| The server has no player admin routes | It is an older leaderboard server, or not one at all |
| It answered with a move to another address | Put that final address in **Leaderboard address** |
| The address starts with `http://` | Use the server's `https://` address |
| Nobody has claimed that name, or it is not on the leaderboard | Someone changed it meanwhile: press **Refresh** |

---

## 5. The technical contract

Skip this section unless you are the one writing the server. It is the exact
protocol the game speaks, taken from the shipping client. The Studio's own
servers follow it.

### Lobby relay — WebSocket

```
Create:  wss://<host>/ws?create=1[&pass=<password>]
   ←     {"t":"room","code":"<short code>"}
   ←     {"t":"deny","reason":"busy"}          that code was taken a moment ago;
                                               the player presses the button again

Join:    wss://<host>/ws?join=<code>[&pass=<password>]
   ←     {"t":"joined"}                        to the joiner
   ←     {"t":"peer"}                          to the creator
   ←     {"t":"deny","reason":"badcode"}       also "badpass", "full"

Waits:   {"t":"deny","reason":"timeout"}       to a creator nobody joined in time

Then:    {"t":"sdp", ...}   relayed VERBATIM both ways — do not rewrite it
         {"t":"bye"}        to the other player when one leaves
```

- **The room code is yours to generate**; the client just displays what you send.
  The Studio's servers make codes like `spicy-tiger-42`.
- **Codes are lowercase, and so is the lookup.** Players type what they see, often
  in capitals; lowercase the code you are given before looking the room up.
- **A wait limit is optional.** If you have one, it may only close a creator who
  is still alone. Never cut off a pair in the middle of connecting. The game's
  texts say codes expire after about 30 minutes, which is the Studio servers'
  limit.

*Dev note:* `?signal=<url>` in the page URL overrides the configured value, and a
page served from localhost falls back to `ws://localhost:8940/ws` automatically.

### Queue — the same WebSocket, entered with `queue=1`

```
wss://<host>/ws?queue=1&mode=<ranked|casual>&build=<hex>&nc=<0|1>
               &name=<player>&code=<their recovery code>

   ←  {"t":"qcount","n":<how many waiting>}
   ←  {"t":"match","role":"host"|"guest","at":<epoch ms>,
       "mode":"ranked"|"casual","opponent":"<name>"}
   ←  {"t":"deny","reason":"badident"}     wrong name or recovery code
   ←  {"t":"deny","reason":"identdown"}    the name check could not run
   ←  {"t":"deny","reason":"timeout"}      nobody to pair with in time

After "match", on the SAME socket:
      {"t":"sdp", ...}    relayed verbatim to the matched opponent
      {"t":"playing"}     sent by each game once it is connected: the hand-off
                          to the game. Do not relay it; a socket that closes
                          after it is a match that started, not one that died
      {"t":"bye"}         to the other player when one leaves
```

Things to get right:

1. **`role` picks sides.** `host` is player 1, `guest` player 2. Send one of each.
2. **`at` MUST be identical for both players.** It is the match's ID — both
   clients report their result separately and the leaderboard pairs the two
   reports using it. Generate it once on the server. A per-player timestamp means
   every match arrives as two halves that never match up. **This is the single
   most common thing to get wrong.**
3. **Check the name and code before pairing, in both modes.** The game sends
   them for casual too. Otherwise anyone can queue as anyone. When the check
   itself fails (your leaderboard server is down), say `identdown`, not
   `badident`, so players are not told their name is wrong.
4. **One queue per mode + build + netcode.** Only pair players with the same
   `mode`, the same `build` and the same `nc`; anything else desyncs. Accept only
   the values the game sends (`build` is short lowercase hex, `nc` is `0` or `1`,
   `mode` is `ranked` or `casual`), so a made-up value cannot create endless
   queues.
5. **Never pair a name with itself** (one player, two browser tabs).
6. **Remember each ranked pairing** (the two names and `at`) at the moment you
   make it, so the leaderboard can refuse results for matches that never
   happened (§6).
7. **A wait limit is optional here too**, and may only close a player who is
   still waiting, never a matched pair.

### Names + leaderboard — HTTP/JSON

| Route | Send | Get back |
|---|---|---|
| `GET /mugen/identity/check?name=` | — | whether the name is taken (the Studio's **Test** calls this) |
| `POST /mugen/identity/claim` | `{name}` | `{"ok":true, "name":…, "code":…}`: the recovery code, **once, forever**. Or `"reason":"taken"` |
| `POST /mugen/identity/recover` | `{name, code}` | `{"ok":true, "name":…}`: re-attach on a new device |
| `GET /mugen/leaderboard?limit=N` | — | the standings, `{"players":[...]}` |
| `GET /mugen/leaderboard/me?name=` | — | one player's row; include `"ok":true`, `rating`, `tier` and `games` |
| `POST /mugen/leaderboard/report` | see below | `{"state":"<short status>", ...}` |

A name plus its recovery code is the entire account system — no password, no
email. The game never asks the server to "verify" a code by itself: that is your
queue's job (above), done however your servers talk to each other.

Replies the game understands everywhere: `429 {"ok":false,"reason":"ratelimited"}`
when someone tries too often, and `403 {"ok":false,"reason":"badident"}` for a
wrong name or code.

**Allow the game's site to call you.** The game runs on your website's address,
not your server's, so the browser checks permission first: every reply needs an
`Access-Control-Allow-Origin` header, and the server has to answer the `OPTIONS`
request the browser sends before each JSON `POST`.

**The result report**, sent by each player when a ranked match ends:

```json
{
  "name":      "my own name",
  "code":      "my own recovery code",
  "opponent":  "their name",
  "won":        true,
  "character":  "MY OWN character",
  "startedAt":  1700000000000,
  "seq":        1,
  "buildId":    "content hash"
}
```

- **Both players report.** Pair the two using the two names (lowercased and
  sorted, so both sides agree), `startedAt` exactly as the queue sent it (`at`),
  and `seq`. If one says it won and the other says it lost, record it. If both
  say they won, or both lost, it is a conflict: count it for nobody.
- **`seq` numbers the games inside one pairing** (1, 2, 3). A ranked set is first
  to 2 and a draw does not count, so an honest set never sends more than 3.
  **Cap it**; uncapped, one pairing can file unlimited results.
- **`character` is the reporter's own.** An earlier version sent the host's
  character from both sides and every row on the board showed the same fighter.
- **Casual and room-code matches never report.**
- **The reply is for display only** — a slow or broken leaderboard never spoils a
  match in progress. When a report completes a result, answer with the
  reporter's own numbers: `{"ok":true,"state":"counted","rating":1016,"delta":16,"tier":"...","games":4}`.
  For any other state (`pending` for the first of the two reports, `duplicate`,
  `conflict`, `refused`), the game checks `/me` a few times instead.
- **Tier names the game knows:** `UNRANKED` (still placing), `BRONZE`, `SILVER`,
  `GOLD`, `PLATINUM`, `DIAMOND`, `MASTER`, `GRANDMASTER`.

### Admin routes — what the Players panel calls

Optional: the game never calls these. Answer them and the Studio's **Players**
group can manage your leaderboard (§4, *Managing players*).

| Route | Send | Get back |
|---|---|---|
| `GET /admin/mugen/identity/names` | — | `{"ok":true, "count":N, "names":[{"name", "createdAt", "lastRecoveredAt", "codeResetAt"}]}`. Never a code or a code hash |
| `POST /admin/mugen/identity/name/<name>/reset` | — | `{"ok":true, "name":…, "code":…}`: a new recovery code, once; the old one stops working. Or `"reason":"unknown"` |
| `DELETE /admin/mugen/identity/name/<name>` | — | `{"ok":true, "name":…}`: the name is free to claim. Or `"reason":"unknown"` |
| `DELETE /admin/mugen/leaderboard/player/<name>` | — | `{"ok":true}`, or `{"ok":false}` when there is no such row |
| `PATCH /admin/mugen/leaderboard/player/<name>` | any of `rating`, `peakRating`, `wins`, `losses`, `games`, `streak`, `bestStreak` | `{"ok":true, "name", "changed", "before":{…}, "after":{…}}`, or `"reason":"nosuchplayer"` / `"badvalue"` |
| `POST /admin/mugen/leaderboard/reset` | — | `{"ok":true, "cleared":true}`. Clear the ratings and records, keep the names |
| `GET /admin/mugen/leaderboard/export` | — | everything, as one JSON object with `players` keyed by lowercased name |

- **The key.** A wrong or missing one is `403 {"error":"forbidden"}`. The
  Studio's own servers take it in an `x-admin-key` header; the Studio knows
  them because `GET /` answers `{"kit":"mugen-studio-hostkit", …}`. To any other
  server the Studio sends it as `?key=<key>` in the address, so it appears in
  whatever request log that server keeps: keep the log private, and compare
  the key in constant time.
- **`GET /`** is asked first, with no key, and needs no route of yours: a 404
  or a web page there is fine. A 5xx, 429 or 408 there stops the Studio before
  it sends the key, with "try again in a minute".
- **No redirects.** The Studio does not follow one with the key; answer on the
  address the host typed.
- `<name>` arrives URL-encoded. Compare names without case, as everywhere else.
- **A name and its row are separate.** Releasing a name leaves its row alone.
  When the host releases a name with its row, the Studio sends the row's
  `DELETE` first and the name's second, and stops if the first one fails.
- **Nothing else is called.** If your server keeps a picture of the board, an
  admin change does not redraw it: that is your server's business.

---

## 6. What the Studio's servers enforce, and what is still yours

### Built in

If you used **Set up my servers**, these rules are already running:

- **Names first.** The queue only lets in a player with a claimed name and its
  recovery code, for casual and ranked alike.
- **Real pairings only.** The queue records every ranked pairing before it tells
  the two players, and the leaderboard counts a result only for a pairing it
  recorded, within 2 hours. Two made-up names cannot file results for a match
  that never happened. If the pairing cannot be recorded, the two players are
  told the online name server did not answer, instead of starting a set that
  could never count.
- **No self-matches.** A name is never paired with itself.
- **Matching games only.** Players are paired only with the same mode, the same
  Build ID and the same netcode setting.
- **Two agreeing reports.** A result counts when exactly one of the two players
  says they won. A lone report is dropped after 10 minutes, and a repeat is
  ignored.
- **At most 3 results per pairing** (`seq` 1 to 3): a first-to-2 set.
- **Casual is never rated**, and room-code matches are never reported.
- **Wait limits.** 10 minutes in the queue and 30 minutes for a room nobody
  joined. Players who are already connecting are never cut off. This is what
  keeps the servers inside Cloudflare's free daily allowance.
- **Rate limits,** per hour: 10 name claims and 20 name recoveries from one
  internet address; 60 queue entries, 600 standing checks and 200 result reports
  per address and name. Requests over 16 KB are refused.
- **Names** are 3 to 12 characters (letters, digits, `_`, `.`, `-`), and case
  does not make a new name ("Alice" and "alice" are one). A recovery code is 12
  characters, and the server keeps only a scrambled copy of it (a hash).
- **Ratings** start at 1000 and move by Elo with K = 32. A player gets a tier
  after 3 placement games, in 50-point bands.
- **What is stored:** names, ratings, records and recent characters. No IP
  addresses.

### Still yours to decide

These are policy, and they matter far more once strangers are involved rather
than friends.

- **Moderation.** The **Players** group (§4, *Managing players*) can free a
  name, give a player a new code, take a player off the leaderboard, fix their
  numbers or reset the whole board. The Studio's servers still have no ban
  switch: a released name can be claimed again by anyone, the same person
  included. If you write your own server, build a ban switch before you need
  one — a `disabled` flag checked when a name is verified.
- **Name rules.** Free, permanent, unique names mean the first visitor who idly
  types a handle owns it forever, until you release it.
- **Tell players what you keep.** Playing peer-to-peer shows each player's IP to
  the other, and a server you write yourself may log IPs for moderation. Both
  deserve a plain sentence somewhere visible.
- **What quitting mid-set means.** "Unrated for both" is harmless among friends
  and a free escape from any loss among strangers.
- **Repeat pairings.** Two friends who queue together at a quiet hour can still
  feed each other wins. Elo blunts it, since beating the same player again and
  again earns less and less.
- **If your queue and leaderboard are separate servers,** you cannot share a
  pairing list as easily as the Studio's single server does: have the queue sign
  `(playerA, playerB, startedAt)` with a secret the leaderboard also knows, and
  reject reports that don't verify. **For a server you write, this is the most
  valuable thing on this list.**

---

## 7. Checking it works

In order — each step needs the one before it. Use **two different browsers**
(or one normal window and one private window) so each player has their own name:
the queue never pairs a name with itself. Both must load the **same** exported
site, or the queue keeps them apart.

1. **Servers:** press **Test my servers** (or each group's **Test**). Both should
   answer.
2. **Relay:** create a room in one browser, join with the code in the other. A
   match starts → the relay works. Test in browser is enough for this step.
3. **Names:** on your exported site, set NETWORK ▸ PLAYER NAME. The game shows a
   recovery code exactly once. Recover the name in a different browser with it.
4. **Queue:** enter CASUAL MATCH in both browsers. Both get a match, one as P1
   and one as P2 (the netplay log shows "queue matched"). On a server you wrote
   yourself, check that both got **the same `at`**.
5. **Report:** play a ranked set; check it settled into one result per game on
   `leaderboard.html`, not two halves.
6. **Standing:** NETWORK ▸ YOUR RANK shows the rating. It loads in the background,
   so give it a few seconds.

If matches pair but never settle, **check `at` first.** A per-player timestamp is
almost always the cause.

### When something goes wrong

| What you see | What to do |
|---|---|
| Cloudflare wants the email address verified | Open the email from Cloudflare and press its link (or resend it from your Cloudflare profile), then press the button again |
| The token is missing a permission, or Cloudflare refused it | Make a new one with **Create my token**, so both permissions come pre-filled |
| A Worker with that name exists that Mugen Studio did not make | Pick another server name. The Studio never overwrites someone else's Worker |
| That workers.dev name belongs to someone else | Try another name |
| **Test my servers** fails right after the first setup | A brand-new workers.dev name can take a few minutes. Wait, then test again |
| "Needs a claimed online name" in the game | Set NETWORK ▸ PLAYER NAME first. On Test in browser this cannot work: use your exported site |
| "The online name server did not answer" | Press **Test my servers**. If the leaderboard answers, try again in a minute |
| Two browsers never get matched | They need different names and the same exported site. The same name is never paired with itself |

---

## Where this came from

The game's ranked and casual modes ship with the Studio, blank. This project's
own services - its relay, its leaderboard server and players' data, its Discord
bot - are private and stay that way. The servers the Studio sets up for you are
a separate, blank kit written for other hosts: they carry none of this
project's addresses, keys or players. This guide exists so anyone can run their
own, on their own accounts, with none of it inherited.
