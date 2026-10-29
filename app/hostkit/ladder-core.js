// Ladder core: online player names (identity) and the ranked leaderboard for
// the Mugen Studio host kit. Pure logic on a synchronous SQL handle, so the
// same code runs inside the kit's Ladder Durable Object (ladder.js, on
// ctx.storage.sql) and under Node's node:sqlite in tools/test-hostkit-ladder.js.
//
// It is a port of the reference identity + leaderboard server: the same name
// rules, recovery codes, two-report agreement, Elo, tiers and reply shapes, so
// today's clients (identity.js, webrtc.js, board.html, standings.html) talk to
// it unchanged. Left out on purpose: chat announcements, set sessions
// (link/end) and the board image.
//
// New in the kit (host settings, both ON by default and each a named
// constant below so it can flip):
//   - a report counts only when this kit's own queue recorded the pairing
//     (recordPairing, called by the Queue before it sends `match`);
//   - the per-pairing match counter `seq` is capped. A ranked set is first to
//     2 and draws never advance seq (webrtc.js reportResult), so an honest set
//     sends at most seq 3.
//
// RULES. The rating constants below are only the DEFAULTS. A host can change
// the start rating, the K-factor, the placement games and the ranks (names +
// floors) through PUT /admin/mugen/leaderboard/rules; they live in the `rules`
// table and the reference server keeps the same object in rules.json. Ranks
// are worked out at read time from the stored rating and games, so a rules
// change moves every player to the new ranks at once without rewriting a row,
// and a tier-up is only ever the before/after of ONE counted match under one
// set of rules.
//
// ADAPTER. sql.exec(query, ...bindings) returns a cursor with toArray();
// tx(fn) runs fn synchronously and atomically and returns its value (in the
// Durable Object that is ctx.storage.transactionSync). Bindings are only
// strings, numbers and null - never booleans or undefined, which the Durable
// Object SQL API refuses.
//
// HASH BEFORE THE TRANSACTION. Web Crypto is async, and an await inside a
// read-check-write would let another request run in the gap. So every method
// hashes first and then does all of its reads and writes in ONE synchronous
// tx; nothing can interleave inside it.
//
// No imports: crypto.subtle and crypto.getRandomValues are global in Workers
// and in Node 20+, so the Worker needs no nodejs_compat flag.

// ---------------------------------------------------------------- rating --
export const START_RATING = 1000;
// Brisk on purpose: a small community should see movement after an evening.
export const K_FACTOR = 32;
// Tiers stay unassigned until a player has played this many counted games.
export const PLACEMENT_GAMES = 3;
// 50-point bands, sized to the range Elo actually reaches on a small ladder.
export const TIERS = [
  { name: 'GRANDMASTER', min: 1200 },
  { name: 'MASTER', min: 1150 },
  { name: 'DIAMOND', min: 1100 },
  { name: 'PLATINUM', min: 1050 },
  { name: 'GOLD', min: 975 },
  { name: 'SILVER', min: 925 },
  { name: 'BRONZE', min: 0 },
];

// The rules a ladder has until its host saves others, and what GET .../rules
// offers as `defaults`. Frozen: every caller gets a copy (copyRules).
export const DEFAULT_RULES = Object.freeze({
  startRating: START_RATING,
  kFactor: K_FACTOR,
  placementGames: PLACEMENT_GAMES,
  ranks: Object.freeze(TIERS.map((t) => Object.freeze({ name: t.name, min: t.min }))),
});

// What a host may set. Wide enough for any ladder a community runs, narrow
// enough that a stray keystroke (a K of 3200, a floor of 50000) is refused
// instead of wrecking the board. Both servers use these exact ranges.
export const RULE_LIMITS = Object.freeze({
  startRating: Object.freeze([100, 3000]),
  kFactor: Object.freeze([4, 100]),
  placementGames: Object.freeze([0, 10]),
  ranks: Object.freeze([1, 12]),
  rankMin: Object.freeze([0, 5000]),
});
// After trim + uppercase. UNRANKED is refused separately: it is the name of
// placement, and a rank called that would be indistinguishable from it.
const RANK_NAME_RE = /^[A-Z0-9 ._-]{1,16}$/;
const PLACEMENT_NAME = 'UNRANKED';

// ------------------------------------------------------------- reporting --
// A half-report older than this is abandoned (the opponent never reported).
export const PENDING_TTL_MS = 10 * 60 * 1000;
// How many counted match ids are remembered to refuse a re-report.
export const MAX_RECENT_MATCHES = 5000;
export const MAX_CHAR_LEN = 40;
// Recent picks that decide a player's "main", and the minimum before one is named.
const RECENT_WINDOW = 10;
const MAIN_MIN_GAMES = 3;

// --------------------------------------------- kit rules (host settings) --
// true: a report counts only for a pairing this kit's queue recorded.
export const REQUIRE_PAIRING = true;
// Highest seq accepted for one pairing; 0 turns the cap off.
export const SEQ_CAP = 3;
// How long a recorded pairing stays reportable, from when it was recorded.
export const PAIRING_TTL_MS = 2 * 60 * 60 * 1000;

// ------------------------------------------------------------------ misc --
export const LEADERBOARD_MAX = 200;
export const SCHEMA_VERSION = 2;
export const KIT_NAME = 'mugen-studio-hostkit';

// Names: 3-12 characters from the in-game name entry's alphabet. Case is kept
// for display and ignored for uniqueness ("Alice" and "alice" are one name).
export const NAME_MIN = 3;
export const NAME_MAX = 12;
const NAME_RE = /^[A-Za-z0-9_.\-]+$/;

export function validName(name) {
  return typeof name === 'string' && name.length >= NAME_MIN && name.length <= NAME_MAX && NAME_RE.test(name);
}

// ---------------------------------------------------------------- crypto --
const encoder = new TextEncoder();

export async function sha256Hex(text) {
  const buf = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(String(text))));
  let out = '';
  for (const b of buf) out += b.toString(16).padStart(2, '0');
  return out;
}

// Constant-time string compare for equal-length strings (two sha256 hex
// digests). Only the length can leak, and every digest has the same length.
export function sameHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Compare two secrets of any length without leaking where they differ or how
// long the right one is: hash both, then compare the digests.
export async function sameSecret(given, expected) {
  if (typeof expected !== 'string' || !expected) return false;
  const [a, b] = await Promise.all([sha256Hex(String(given || '')), sha256Hex(expected)]);
  return sameHex(a, b);
}

// Recovery codes: 12 characters from a 31-letter alphabet with lookalikes
// removed (no 0/O/1/I/L), grouped "K7PF-3XQM-9RTZ". Shown to the player once;
// only its sha256 is ever stored.
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const CODE_BYTE_LIMIT = 256 - (256 % CODE_ALPHABET.length); // bytes at or above this would bias the modulo

function newCode() {
  const chars = [];
  while (chars.length < 12) {
    for (const b of crypto.getRandomValues(new Uint8Array(24))) {
      if (b < CODE_BYTE_LIMIT && chars.length < 12) chars.push(CODE_ALPHABET[b % CODE_ALPHABET.length]);
    }
  }
  return chars.slice(0, 4).join('') + '-' + chars.slice(4, 8).join('') + '-' + chars.slice(8).join('');
}

// Case and separators do not matter: "k7pf 3xqm 9rtz" from a sticky note works.
function normalizeCode(code) {
  return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function hashCode(code) {
  return sha256Hex(normalizeCode(code));
}

// ----------------------------------------------------------------- rules --
export function copyRules(r) {
  return {
    startRating: r.startRating,
    kFactor: r.kFactor,
    placementGames: r.placementGames,
    ranks: r.ranks.map((t) => ({ name: t.name, min: t.min })),
  };
}

// A whole rules object from a host -> {ok:true, rules} with the names trimmed
// and uppercased and the last floor set to 0, or {ok:false, reason:'badvalue',
// field, why}. `field` is the key at fault, down to the rank ('ranks[2].name',
// 'ranks[2].min', 'ranks[2]') so the Studio can mark that box; `why` is a
// sentence the Studio can show as it is. Both are word for word the reference
// server's (ranked.js validateRules), so one form reads either server the same
// way. A host's own text is never echoed back unless it already passed the
// name check. Unknown keys are ignored.
export function validateRules(input) {
  const bad = (field, why) => ({ ok: false, reason: 'badvalue', field, why });
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return bad('rules', 'The rules must be an object with startRating, kFactor, placementGames and ranks.');
  }
  const L = RULE_LIMITS;
  const whole = (v, range) => typeof v === 'number' && Number.isInteger(v) && v >= range[0] && v <= range[1];
  if (!whole(input.startRating, L.startRating)) {
    return bad('startRating', 'The starting rating must be a whole number from ' + L.startRating[0] + ' to ' + L.startRating[1] + '.');
  }
  if (!whole(input.kFactor, L.kFactor)) {
    return bad('kFactor', 'The K-factor must be a whole number from ' + L.kFactor[0] + ' to ' + L.kFactor[1] + '.');
  }
  if (!whole(input.placementGames, L.placementGames)) {
    return bad('placementGames', 'Placement games must be a whole number from ' + L.placementGames[0] + ' to ' + L.placementGames[1] + '.');
  }
  const list = input.ranks;
  if (!Array.isArray(list) || list.length < L.ranks[0] || list.length > L.ranks[1]) {
    return bad('ranks', 'There must be from ' + L.ranks[0] + ' to ' + L.ranks[1] + ' ranks.');
  }
  const ranks = [];
  const seen = new Set();
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    const at = 'ranks[' + i + ']';
    if (!e || typeof e !== 'object' || Array.isArray(e)) return bad(at, 'Rank ' + (i + 1) + ' needs a name and a minimum rating.');
    const name = typeof e.name === 'string' ? e.name.trim().toUpperCase() : '';
    if (!RANK_NAME_RE.test(name)) {
      return bad(at + '.name', 'Rank ' + (i + 1) + ' needs a name of 1 to 16 letters, digits, spaces, dots, dashes or underscores.');
    }
    if (name === PLACEMENT_NAME) {
      return bad(at + '.name', 'A rank cannot be called ' + PLACEMENT_NAME + ': that name is kept for players still playing their placement games.');
    }
    if (seen.has(name)) return bad(at + '.name', 'Two ranks are called ' + name + ': each rank needs its own name.');
    seen.add(name);
    if (!whole(e.min, L.rankMin)) {
      return bad(at + '.min', name + "'s minimum rating must be a whole number from " + L.rankMin[0] + ' to ' + L.rankMin[1] + '.');
    }
    ranks.push({ name, min: e.min });
  }
  // The last rank is the floor: every rating below the rank above it lands
  // there, so its own minimum is 0 whatever was sent. Floored before the order
  // check, so what was sent for it can never be why a rule set is refused.
  ranks[ranks.length - 1].min = 0;
  for (let i = 1; i < ranks.length; i++) {
    if (ranks[i].min < ranks[i - 1].min) continue;
    if (i === ranks.length - 1) {
      return bad('ranks[' + (i - 1) + '].min', ranks[i - 1].name + "'s minimum rating must be above 0: the lowest rank, " +
        ranks[i].name + ', always starts at 0.');
    }
    return bad('ranks[' + i + '].min', ranks[i].name + "'s minimum rating must be lower than " + ranks[i - 1].name +
      "'s: ranks are listed from the highest to the lowest.");
  }
  return {
    ok: true,
    rules: { startRating: input.startRating, kFactor: input.kFactor, placementGames: input.placementGames, ranks },
  };
}

// ------------------------------------------------------ rating functions --
// Each takes the rules in force; left out, the defaults (what the reference
// server's own functions use, so the two compare one to one).
export function tierOf(rating, games, rules = DEFAULT_RULES) {
  const placement = rules.placementGames;
  if (games < placement) {
    return { name: PLACEMENT_NAME, min: 0, placement: placement - games };
  }
  const ranks = rules.ranks;
  const t = ranks.find((x) => rating >= x.min) || ranks[ranks.length - 1];
  return { name: t.name, min: t.min, placement: 0 };
}

// Height of a tier, bigger is better (BRONZE 0 ... GRANDMASTER 6). UNRANKED is
// -1 and never counts as a promotion: leaving placement is not a climb. So is
// a name the rules do not have.
export function tierRankOf(name, rules = DEFAULT_RULES) {
  const ranks = rules.ranks;
  const i = ranks.findIndex((t) => t.name === name);
  return i < 0 ? -1 : ranks.length - 1 - i;
}

function expectedScore(mine, theirs) {
  return 1 / (1 + Math.pow(10, (theirs - mine) / 400));
}

// Both deltas are computed from the two PRE-match ratings, so the exchange is
// symmetric.
export function ratingDelta(myRating, oppRating, won, rules = DEFAULT_RULES) {
  return Math.round(rules.kFactor * ((won ? 1 : 0) - expectedScore(myRating, oppRating)));
}

// Lower bound of the Wilson score interval (95%): a record's pessimistic win
// rate, shown on the board as an arcade-style score.
const WILSON_Z = 1.96;

export function wilsonScore(wins, games) {
  if (!games) return 0;
  const z = WILSON_Z;
  const p = wins / games;
  const z2 = z * z;
  const denom = 1 + z2 / games;
  const center = p + z2 / (2 * games);
  const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * games)) / games);
  return Math.max(0, (center - margin) / denom);
}

export function arcadeScore(wins, games) {
  return Math.round(wilsonScore(wins, games) * 1000000 / 10) * 10;
}

// The session is one pairing; startedAt is the queue's pairing time, sent
// verbatim to both peers, so both derive the same id without talking.
export async function sessionId(a, b, startedAt) {
  const pair = [String(a).toLowerCase(), String(b).toLowerCase()].sort().join('|');
  return (await sha256Hex(pair + '|' + Number(startedAt || 0))).slice(0, 16);
}

// One match inside that session; seq is the per-pairing counter both keep.
export async function matchId(a, b, startedAt, seq) {
  const sid = await sessionId(a, b, startedAt);
  return (await sha256Hex(sid + '|' + (Number(seq) || 0))).slice(0, 16);
}

// "Main" only when one character holds a MAJORITY of the recent picks.
export function mainChar(p) {
  const recent = p.recent || [];
  if (recent.length < MAIN_MIN_GAMES) return '';
  const counts = {};
  for (const c of recent) counts[c] = (counts[c] || 0) + 1;
  let best = '', n = 0;
  for (const [c, k] of Object.entries(counts)) if (k > n) { best = c; n = k; }
  return n > recent.length / 2 ? best : '';
}

// The portrait: a real main, else whoever they played last.
function portraitChar(p) {
  return mainChar(p) || p.lastChar || '';
}

function applyResult(p, opponent, won, character, delta, whenIso) {
  p.games++;
  p.rating = Math.max(0, (p.rating ?? START_RATING) + delta);
  if (p.rating > (p.peakRating || 0)) p.peakRating = p.rating;
  p.lastDelta = delta;
  if (won) {
    p.wins++;
    p.streak = p.streak >= 0 ? p.streak + 1 : 1;
    if (p.streak > p.bestStreak) p.bestStreak = p.streak;
  } else {
    p.losses++;
    p.streak = p.streak <= 0 ? p.streak - 1 : -1;
  }
  const c = String(character || '').slice(0, MAX_CHAR_LEN).trim();
  if (c) {
    p.chars[c] = (p.chars[c] || 0) + 1;
    p.lastChar = c;
    p.recent = (p.recent || []).concat(c).slice(-RECENT_WINDOW);
  }
  p.lastOpponent = String(opponent || '').slice(0, 40);
  p.lastPlayed = whenIso;
}

// Numeric fields a moderator may correct by hand. Never `name` (the key) or
// the derived character and opponent history.
const PATCHABLE = ['rating', 'peakRating', 'wins', 'losses', 'games', 'streak', 'bestStreak'];

// ---------------------------------------------------------------- schema --
// Each entry moves the data from version-1 to version. A later kit appends an
// entry; it never edits a shipped one.
const MIGRATIONS = [
  {
    version: 1,
    steps: [
      `CREATE TABLE IF NOT EXISTS names (
        key TEXT PRIMARY KEY, name TEXT NOT NULL, code_hash TEXT NOT NULL,
        created_at TEXT NOT NULL, last_recovered_at TEXT, code_reset_at TEXT)`,
      `CREATE TABLE IF NOT EXISTS players (
        key TEXT PRIMARY KEY, name TEXT NOT NULL,
        rating INTEGER NOT NULL, peak_rating INTEGER NOT NULL,
        wins INTEGER NOT NULL, losses INTEGER NOT NULL, games INTEGER NOT NULL,
        streak INTEGER NOT NULL, best_streak INTEGER NOT NULL, last_delta INTEGER NOT NULL,
        chars TEXT NOT NULL, recent TEXT NOT NULL, last_char TEXT NOT NULL,
        last_opponent TEXT NOT NULL, first_seen TEXT NOT NULL, last_played TEXT)`,
      'CREATE INDEX IF NOT EXISTS players_rank ON players (rating DESC, games DESC)',
      `CREATE TABLE IF NOT EXISTS pending (
        match_id TEXT PRIMARY KEY, at INTEGER NOT NULL, name TEXT NOT NULL,
        opponent TEXT NOT NULL, won INTEGER NOT NULL, character TEXT NOT NULL, build_id TEXT NOT NULL)`,
      // Plain INTEGER PRIMARY KEY (no AUTOINCREMENT): only the oldest rows are
      // ever trimmed, so max(n)+1 keeps counting up.
      'CREATE TABLE IF NOT EXISTS done (n INTEGER PRIMARY KEY, match_id TEXT UNIQUE NOT NULL)',
      // Pairings the kit's queue made: the two names lowercased and sorted,
      // the queue's pairing time, and when the Ladder recorded it.
      `CREATE TABLE IF NOT EXISTS pairings (
        a TEXT NOT NULL, b TEXT NOT NULL, at INTEGER NOT NULL, created INTEGER NOT NULL,
        PRIMARY KEY (a, b, at))`,
      'CREATE INDEX IF NOT EXISTS pairings_created ON pairings (created)',
    ],
  },
  {
    version: 2,
    steps: [
      // The host's rules, one row. No row means DEFAULT_RULES, so a ladder
      // from kit 1.0.0 keeps ranking exactly as it did. ranks is JSON
      // [{name, min}], highest first.
      `CREATE TABLE IF NOT EXISTS rules (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        start_rating INTEGER NOT NULL, k_factor INTEGER NOT NULL, placement_games INTEGER NOT NULL,
        ranks TEXT NOT NULL, updated_at TEXT NOT NULL)`,
    ],
  },
];

function rowToPlayer(r) {
  return {
    name: r.name, rating: r.rating, peakRating: r.peak_rating, wins: r.wins, losses: r.losses,
    games: r.games, streak: r.streak, bestStreak: r.best_streak, lastDelta: r.last_delta,
    chars: JSON.parse(r.chars), recent: JSON.parse(r.recent), lastChar: r.last_char,
    lastOpponent: r.last_opponent, firstSeen: r.first_seen, lastPlayed: r.last_played,
  };
}

function pairKey(a, b) {
  return [String(a).toLowerCase(), String(b).toLowerCase()].sort();
}

// ------------------------------------------------------------------ core --
export class LadderCore {
  // opts (tests and hosts): now() clock, requirePairing, seqCap,
  // pairingTtlMs, maxDone. Anything left out takes the constants above.
  constructor(sql, tx, opts = {}) {
    this.sql = sql;
    this.tx = tx || ((fn) => fn());
    this.now = typeof opts.now === 'function' ? opts.now : () => Date.now();
    this.requirePairing = opts.requirePairing !== undefined ? !!opts.requirePairing : REQUIRE_PAIRING;
    this.seqCap = opts.seqCap !== undefined ? Math.max(0, Math.floor(Number(opts.seqCap) || 0)) : SEQ_CAP;
    this.pairingTtlMs = opts.pairingTtlMs > 0 ? opts.pairingTtlMs : PAIRING_TTL_MS;
    this.maxDone = opts.maxDone > 0 ? Math.floor(opts.maxDone) : MAX_RECENT_MATCHES;
    this.migrate();
  }

  q(query, ...args) {
    return this.sql.exec(query, ...args).toArray();
  }

  iso() {
    return new Date(this.now()).toISOString();
  }

  schemaVersion() {
    const row = this.q('SELECT version FROM schema_version WHERE id = 1')[0];
    return row ? Number(row.version) : 0;
  }

  migrate() {
    this.q('CREATE TABLE IF NOT EXISTS schema_version (id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL)');
    const have = this.schemaVersion();
    // Data written by a newer kit: refuse rather than guess at its tables.
    if (have > SCHEMA_VERSION) throw new Error('ladder data has schema ' + have + ', this kit knows ' + SCHEMA_VERSION);
    if (have === SCHEMA_VERSION) return;
    this.tx(() => {
      for (const m of MIGRATIONS) {
        if (m.version <= have) continue;
        for (const step of m.steps) this.q(step);
      }
      this.q('INSERT OR REPLACE INTO schema_version (id, version) VALUES (1, ?)', SCHEMA_VERSION);
    });
  }

  // --------------------------------------------------------------- rules --
  // The rules in force, read fresh on every call (one row; a request reads it
  // once and passes it along). Only setRules writes the row, after
  // validateRules passed, so a row that fails it now was damaged outside the
  // kit: that throws (the request answers 500) rather than rank everyone by
  // a guess.
  rules() {
    const r = this.q('SELECT * FROM rules WHERE id = 1')[0];
    if (!r) return copyRules(DEFAULT_RULES);
    let ranks = null;
    try {
      ranks = JSON.parse(r.ranks);
    } catch {
      ranks = null;
    }
    const v = validateRules({ startRating: r.start_rating, kFactor: r.k_factor, placementGames: r.placement_games, ranks });
    if (!v.ok) throw new Error('stored ladder rules are damaged (' + v.field + '): ' + v.why);
    return v.rules;
  }

  getRules() {
    return { ok: true, rules: this.rules(), defaults: copyRules(DEFAULT_RULES) };
  }

  // A whole rules object -> {ok:true, rules} as stored, or the badvalue reply
  // from validateRules with nothing written. No player row is touched: ranks
  // are derived when read, and no tier event comes from a rules change.
  setRules(input) {
    const v = validateRules(input);
    if (!v.ok) return v;
    const r = v.rules;
    return this.tx(() => {
      this.q(`INSERT OR REPLACE INTO rules (id, start_rating, k_factor, placement_games, ranks, updated_at)
        VALUES (1, ?, ?, ?, ?, ?)`, r.startRating, r.kFactor, r.placementGames, JSON.stringify(r.ranks), this.iso());
      return { ok: true, rules: copyRules(r) };
    });
  }

  // ------------------------------------------------------------ identity --
  isTaken(name) {
    if (!validName(name)) return false;
    return this.q('SELECT 1 FROM names WHERE key = ?', name.toLowerCase()).length > 0;
  }

  // -> {ok:true, name, code} (the code appears here and nowhere else, ever)
  // -> {ok:false, reason:'invalid'|'taken'}
  async claim(name) {
    if (!validName(name)) return { ok: false, reason: 'invalid' };
    if (this.isTaken(name)) return { ok: false, reason: 'taken' };
    const code = newCode();
    const hash = await hashCode(code);
    return this.tx(() => {
      // Checked again: another claim may have landed during the hash.
      if (this.isTaken(name)) return { ok: false, reason: 'taken' };
      this.q('INSERT INTO names (key, name, code_hash, created_at) VALUES (?, ?, ?, ?)',
        name.toLowerCase(), name, hash, this.iso());
      return { ok: true, name, code };
    });
  }

  // -> {ok:true, name} | {ok:false}. One answer for unknown name AND wrong
  // code, so it does not confirm which names exist.
  async recover(name, code) {
    if (!validName(name)) return { ok: false };
    const hash = await hashCode(code);
    return this.tx(() => {
      const e = this.q('SELECT name, code_hash FROM names WHERE key = ?', name.toLowerCase())[0];
      if (!e || !sameHex(hash, e.code_hash)) return { ok: false };
      this.q('UPDATE names SET last_recovered_at = ? WHERE key = ?', this.iso(), name.toLowerCase());
      return { ok: true, name: e.name };
    });
  }

  // The display name when name+code identify a real player, else ''. Read
  // only (recover() is the one that stamps last_recovered_at).
  async verifiedName(name, code) {
    if (!validName(name)) return '';
    const hash = await hashCode(code);
    const e = this.q('SELECT name, code_hash FROM names WHERE key = ?', name.toLowerCase())[0];
    return e && sameHex(hash, e.code_hash) ? e.name : '';
  }

  async verify(name, code) {
    return (await this.verifiedName(name, code)) !== '';
  }

  // Issue a NEW code for an existing name; the old one stops working. The new
  // code comes back once. Codes are stored only as sha256 and cannot be read
  // back by anyone, so reissue is the answer to a lost code.
  async adminResetCode(name) {
    if (!validName(name)) return { ok: false, reason: 'invalid' };
    const code = newCode();
    const hash = await hashCode(code);
    return this.tx(() => {
      const e = this.q('SELECT name FROM names WHERE key = ?', name.toLowerCase())[0];
      if (!e) return { ok: false, reason: 'unknown' };
      this.q('UPDATE names SET code_hash = ?, code_reset_at = ? WHERE key = ?', hash, this.iso(), name.toLowerCase());
      return { ok: true, name: e.name, code };
    });
  }

  // The only way a name leaves the registry. The board row is separate.
  adminRelease(name) {
    if (!validName(name)) return { ok: false, reason: 'invalid' };
    return this.tx(() => {
      const e = this.q('SELECT name FROM names WHERE key = ?', name.toLowerCase())[0];
      if (!e) return { ok: false, reason: 'unknown' };
      this.q('DELETE FROM names WHERE key = ?', name.toLowerCase());
      return { ok: true, name: e.name };
    });
  }

  // Every claimed name with its dates - never a code or a code hash.
  adminList() {
    const names = this.q('SELECT name, created_at, last_recovered_at, code_reset_at FROM names ORDER BY key')
      .map((e) => ({
        name: e.name,
        createdAt: e.created_at || null,
        lastRecoveredAt: e.last_recovered_at || null,
        codeResetAt: e.code_reset_at || null,
      }));
    return { ok: true, count: names.length, names };
  }

  // ------------------------------------------------------------ pairings --
  // Called by the kit's Queue BEFORE it sends `match` to a ranked pair, with
  // the two verified names and the `at` it is about to send.
  // -> {ok:true} | {ok:false, reason:'invalid'|'self'}
  recordPairing(a, b, at) {
    if (!validName(a) || !validName(b)) return { ok: false, reason: 'invalid' };
    const t = Number(at);
    if (!Number.isSafeInteger(t) || t <= 0) return { ok: false, reason: 'invalid' };
    const [x, y] = pairKey(a, b);
    if (x === y) return { ok: false, reason: 'self' };
    return this.tx(() => {
      const now = this.now();
      this.q('DELETE FROM pairings WHERE created < ?', now - this.pairingTtlMs);
      this.q('INSERT OR REPLACE INTO pairings (a, b, at, created) VALUES (?, ?, ?, ?)', x, y, t, now);
      return { ok: true };
    });
  }

  // Inside a tx only.
  isPaired(name, opponent, startedAt) {
    const [x, y] = pairKey(name, opponent);
    const t = Number(startedAt || 0);
    if (!Number.isFinite(t)) return false;
    return this.q('SELECT 1 FROM pairings WHERE a = ? AND b = ? AND at = ? AND created >= ?',
      x, y, t, this.now() - this.pairingTtlMs).length > 0;
  }

  // -------------------------------------------------------------- ranked --
  getPlayer(key) {
    const r = this.q('SELECT * FROM players WHERE key = ?', key)[0];
    return r ? rowToPlayer(r) : null;
  }

  ensurePlayer(name, rules = this.rules()) {
    return this.getPlayer(name.toLowerCase()) || {
      name, rating: rules.startRating, peakRating: rules.startRating, wins: 0, losses: 0, games: 0,
      streak: 0, bestStreak: 0, lastDelta: 0, chars: {}, recent: [], lastChar: '',
      lastOpponent: '', firstSeen: this.iso(), lastPlayed: null,
    };
  }

  putPlayer(p) {
    this.q(`INSERT OR REPLACE INTO players (key, name, rating, peak_rating, wins, losses, games,
      streak, best_streak, last_delta, chars, recent, last_char, last_opponent, first_seen, last_played)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    p.name.toLowerCase(), p.name, p.rating, p.peakRating, p.wins, p.losses, p.games,
    p.streak, p.bestStreak, p.lastDelta || 0, JSON.stringify(p.chars || {}), JSON.stringify(p.recent || []),
    p.lastChar || '', p.lastOpponent || '', p.firstSeen || this.iso(), p.lastPlayed || null);
  }

  // r: {name, opponent, won, character, startedAt, seq, buildId}, with the
  // reporter's identity ALREADY verified by the caller (ladder.js does it).
  // -> {ok, state:'pending'|'counted'|'conflict'|'duplicate'} as before, plus
  //    {ok:false, state:'refused', reason:'seq'|'unpaired'} from the kit rules.
  // A client that sees anything but 'counted' just polls /me, so the new
  // refusals need no client change.
  async report(r) {
    const name = String(r.name || '');
    const opponent = String(r.opponent || '');
    if (!name || !opponent || typeof r.won !== 'boolean') return { ok: false, reason: 'malformed' };
    if (this.seqCap > 0) {
      const s = Number(r.seq);
      if (!Number.isInteger(s) || s < 1 || s > this.seqCap) return { ok: false, state: 'refused', reason: 'seq' };
    }
    const id = await matchId(name, opponent, r.startedAt, r.seq);
    return this.tx(() => {
      if (this.q('SELECT 1 FROM done WHERE match_id = ?', id).length) return { ok: true, state: 'duplicate' };
      if (this.requirePairing && !this.isPaired(name, opponent, r.startedAt)) {
        return { ok: false, state: 'refused', reason: 'unpaired' };
      }
      const now = this.now();
      this.q('DELETE FROM pending WHERE at < ?', now - PENDING_TTL_MS);
      const mine = {
        name, opponent, won: r.won,
        character: String(r.character || '').slice(0, MAX_CHAR_LEN),
        buildId: String(r.buildId || '').slice(0, 32),
      };
      const o = this.q('SELECT * FROM pending WHERE match_id = ?', id)[0];
      if (!o) {
        this.q('INSERT INTO pending (match_id, at, name, opponent, won, character, build_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
          id, now, name, opponent, mine.won ? 1 : 0, mine.character, mine.buildId);
        return { ok: true, state: 'pending' };
      }
      // Same player reporting twice (two tabs?): keep the first, ignore this.
      if (o.name.toLowerCase() === name.toLowerCase()) return { ok: true, state: 'pending' };
      this.q('DELETE FROM pending WHERE match_id = ?', id);
      const other = { name: o.name, won: !!o.won, character: o.character };
      // The two reports must disagree about who won: exactly one winner.
      if (other.won === mine.won) return { ok: false, state: 'conflict' };

      const when = this.iso();
      // Read once, inside this tx: the before and after tiers below are
      // under the SAME rules, so a rules change between two matches can
      // never show up as a tier-up.
      const rules = this.rules();
      const pMine = this.ensurePlayer(mine.name, rules);
      const pOther = this.ensurePlayer(other.name, rules);
      const rMine = pMine.rating ?? rules.startRating;
      const rOther = pOther.rating ?? rules.startRating;
      const tierBefore = tierOf(rMine, pMine.games, rules);
      const dMine = ratingDelta(rMine, rOther, mine.won, rules);
      const dOther = ratingDelta(rOther, rMine, other.won, rules);
      applyResult(pMine, other.name, mine.won, mine.character, dMine, when);
      applyResult(pOther, mine.name, other.won, other.character, dOther, when);
      this.putPlayer(pMine);
      this.putPlayer(pOther);
      const n = (this.q('SELECT COALESCE(MAX(n), 0) AS m FROM done')[0].m || 0) + 1;
      this.q('INSERT INTO done (n, match_id) VALUES (?, ?)', n, id);
      this.q('DELETE FROM done WHERE n <= ?', n - this.maxDone);
      const tierAfter = tierOf(pMine.rating, pMine.games, rules);
      const heightBefore = tierRankOf(tierBefore.name, rules);
      // The numbers describe the REPORTER, never the opponent.
      return {
        ok: true,
        state: 'counted',
        rating: pMine.rating,
        oldRating: rMine,
        delta: dMine,
        tier: tierAfter.name,
        prevTier: tierBefore.name,
        tierUp: heightBefore >= 0 && tierRankOf(tierAfter.name, rules) > heightBefore,
        placement: tierAfter.placement,
        games: pMine.games,
        peakRating: pMine.peakRating,
      };
    });
  }

  // One player's own standing (the result screen polls this).
  me(name) {
    const rules = this.rules();
    const p = this.getPlayer(String(name || '').toLowerCase());
    if (!p) {
      // Where a first match would start them. With the default rules that is
      // the reference's reply exactly (UNRANKED, 3 placement games to go);
      // with placement off it is the rank the start rating sits in.
      const t = tierOf(rules.startRating, 0, rules);
      return {
        ok: true, found: false, rating: rules.startRating, tier: t.name, placement: t.placement,
        games: 0, wins: 0, losses: 0, lastDelta: 0, peakRating: rules.startRating, streak: 0,
      };
    }
    const rating = p.rating ?? rules.startRating;
    const t = tierOf(rating, p.games || 0, rules);
    return {
      ok: true, found: true, name: p.name, rating, tier: t.name, placement: t.placement,
      games: p.games || 0, wins: p.wins || 0, losses: p.losses || 0, lastDelta: p.lastDelta || 0,
      peakRating: p.peakRating ?? rating, streak: p.streak || 0, lastPlayed: p.lastPlayed,
    };
  }

  // Sorted by rating, then games, then name; limit clamped to 1-200. `ranks`
  // is the rules' list, highest first, so a board can draw a rank name it
  // has no built-in look for in its place among the others.
  leaderboard(limit = 50) {
    const rules = this.rules();
    const n = Math.floor(Math.max(1, Math.min(LEADERBOARD_MAX, Number(limit) || 0)));
    // The index finds the n-th row; everything tied with it comes along, and
    // the name tie-break is done here exactly as the reference does it.
    const cut = this.q('SELECT rating, games FROM players ORDER BY rating DESC, games DESC LIMIT 1 OFFSET ?', n - 1)[0];
    const rows = cut
      ? this.q('SELECT * FROM players WHERE rating > ? OR (rating = ? AND games >= ?)', cut.rating, cut.rating, cut.games)
      : this.q('SELECT * FROM players');
    const ranked = rows.map(rowToPlayer)
      .map((p) => ({ ...p, winRate: p.games ? p.wins / p.games : 0, score: arcadeScore(p.wins, p.games) }))
      .sort((a, b) => b.rating - a.rating || b.games - a.games || a.name.localeCompare(b.name))
      .slice(0, n);
    return {
      updated: this.iso(),
      players: ranked.map((p, i) => ({
        place: i + 1,
        name: p.name,
        rating: p.rating,
        tier: tierOf(p.rating, p.games, rules).name,
        placement: tierOf(p.rating, p.games, rules).placement,
        lastDelta: p.lastDelta || 0,
        peakRating: p.peakRating || p.rating,
        score: p.score,
        wins: p.wins,
        losses: p.losses,
        games: p.games,
        winRate: Math.round(p.winRate * 1000) / 10,
        streak: p.streak,
        bestStreak: p.bestStreak,
        character: portraitChar(p),
        main: mainChar(p),
        lastChar: p.lastChar || '',
        lastPlayed: p.lastPlayed,
      })),
      ranks: rules.ranks.map((t) => ({ name: t.name, min: t.min })),
    };
  }

  stats() {
    const s = this.q('SELECT COUNT(*) AS n, COALESCE(SUM(games), 0) AS g FROM players')[0];
    const pend = this.q('SELECT COUNT(*) AS n FROM pending')[0];
    return { players: s.n, matches: s.g / 2, pending: pend.n };
  }

  // ------------------------------------------------------------ moderation --
  // Clears the standings and the report buffers. Names, pairings and the
  // host's rules stay: a new season keeps its ranks.
  resetAll() {
    return this.tx(() => {
      this.q('DELETE FROM players');
      this.q('DELETE FROM pending');
      this.q('DELETE FROM done');
      return { ok: true, cleared: true };
    });
  }

  removePlayer(name) {
    const key = String(name || '').toLowerCase();
    return this.tx(() => {
      const had = this.q('SELECT 1 FROM players WHERE key = ?', key).length > 0;
      if (had) this.q('DELETE FROM players WHERE key = ?', key);
      return { ok: had };
    });
  }

  // Correct one player's numbers; only the fields present in `patch` change.
  // Returns before/after so the edit is auditable from the reply alone.
  setPlayer(name, patch) {
    const key = String(name || '').toLowerCase();
    return this.tx(() => {
      const p = this.getPlayer(key);
      if (!p) return { ok: false, reason: 'nosuchplayer' };
      const before = {};
      const after = {};
      let changed = false;
      for (const f of PATCHABLE) {
        if (patch == null || patch[f] === undefined) continue;
        const v = Number(patch[f]);
        if (!Number.isFinite(v)) return { ok: false, reason: 'badvalue', field: f };
        // Ratings floor at 0 as a result does; counts cannot go negative.
        const clean = Math.max(0, Math.round(v));
        if (p[f] !== clean) {
          before[f] = p[f];
          after[f] = clean;
          p[f] = clean;
          changed = true;
        }
      }
      // Keep the invariant the board's win rate assumes.
      if (changed && (patch.wins !== undefined || patch.losses !== undefined || patch.games !== undefined)) {
        if (p.games < p.wins + p.losses) {
          p.games = p.wins + p.losses;
          after.games = p.games;
        }
      }
      // peakRating never sits below the current rating.
      if (changed && (p.peakRating || 0) < p.rating) {
        before.peakRating = before.peakRating !== undefined ? before.peakRating : p.peakRating;
        p.peakRating = p.rating;
        after.peakRating = p.rating;
      }
      if (changed) this.putPlayer(p);
      return { ok: true, name: p.name, changed, before, after, tier: tierOf(p.rating, p.games, this.rules()).name };
    });
  }

  // A full backup of the standings (the reference export's shape: players by
  // key, pending {open, done}) plus the rules in force and the claimed names'
  // metadata. Never a code or a code hash.
  exportAll() {
    const players = {};
    for (const r of this.q('SELECT * FROM players ORDER BY key')) players[r.key] = rowToPlayer(r);
    const open = {};
    for (const r of this.q('SELECT * FROM pending ORDER BY at, match_id')) {
      open[r.match_id] = {
        at: r.at, name: r.name, opponent: r.opponent, won: !!r.won,
        character: r.character, buildId: r.build_id,
      };
    }
    const done = this.q('SELECT match_id FROM done ORDER BY n').map((r) => r.match_id);
    return {
      exported: this.iso(),
      kit: KIT_NAME,
      schema: this.schemaVersion(),
      rules: this.rules(),
      players,
      pending: { open, done },
      names: this.adminList().names,
      ok: true,
    };
  }
}
