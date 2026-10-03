// Field Goal Kick — async, self-paced, one kick at a time. A two-click
// kicker rather than Madden's hold-and-release meter:
//   1. A vertical power meter starts oscillating the moment a kick is
//      presented. A visible green band marks the sweet spot in the
//      middle — click to lock it in; the farther from that band (in
//      EITHER direction, too high or too low), the weaker the kick.
//   2. Locking power immediately starts a horizontal direction meter
//      oscillating left-right. There's no visible target here — click
//      to lock in a direction. How much error is tolerated depends on
//      the kick's distance (forgiving up close, unforgiving from deep),
//      and wind pushes the actual landing spot away from wherever you
//      aimed — the farther the kick, the more wind can push it.
//
// A power click just outside the green band isn't necessarily wasted: a
// precise enough direction click can still "save" it (a near-miss), same
// as a real kicker muscling a slightly-mishit ball through with a clean
// swing. Land badly outside even that margin and no direction is precise
// enough to save it.
//
// Both meters are simple deterministic triangle waves (0 -> 1 -> 0 on a
// fixed period) computed from a server-recorded start timestamp, so a
// click's position is always derived from real elapsed server time —
// never trusted from the client.
//
// 10 kicks per player on an adaptive difficulty ladder rather than a fixed
// shared sequence: kick 1 is always short (30-39 yards); making a kick
// bumps the NEXT one up a tier (short -> mid -> long), missing one drops it
// back down a tier (long -> mid -> short) — floored at short, capped at
// long, since there's no tier above it. Every player's own run of makes and
// misses steers their own path, so two players can end up facing entirely
// different distances/wind by the end — this is deliberately a skill-based
// ladder (reward a hot streak, ease off a cold one) rather than the
// identical-shared-kicks fairness model earlier versions of this game used.
const crypto = require('crypto');

const id = 'fieldGoal';
const name = 'Field Goal Kick';
const description = 'A two-click 3D kicker: stop the power meter in the sweet spot, then stop the direction meter to split the uprights — beating the wind along the way. 10 kicks per player on a rising/falling difficulty ladder: start at 30-39 yards, move up a tier on a make, drop back down on a miss.';
const category = 'kicking';
const supportedModes = ['async'];

const KICKS_PER_PLAYER = 10;
// The three ladder tiers a kick can be at — 'short' is always where a
// player starts, 'long' is the ceiling (a make there just stays at long,
// there's nothing further to climb to).
const TIER_RANGES = { short: [30, 39], mid: [41, 49], long: [50, 55] };
const TIER_ORDER = ['short', 'mid', 'long'];
const POWER_PERIOD_MS = 1000; // one full up-down cycle of the power meter
const DIRECTION_PERIOD_MS = 1000; // one full left-right cycle of the direction meter
// The green band's width isn't fixed — it narrows for longer kicks, so the
// meter itself visibly communicates how much distance a kick needs: land
// inside it and you've got enough power for THIS kick, land outside it and
// you don't. 50+ yards demands real precision; under 40 is quite forgiving.
const POWER_SWEET_HALF_LONG = 0.05; // 50+ yards
const POWER_SWEET_HALF_MID = 0.09; // 40-49 yards
const POWER_SWEET_HALF_SHORT = 0.14; // under 40 yards
const LONG_DISTANCE_THRESHOLD = 50;
const MID_DISTANCE_THRESHOLD = 40;
const MIN_DISTANCE = 25;
const MAX_DISTANCE = 55;
const MAX_WIND_MPH = 15;
const WIND_MAX_SHIFT = 0.15; // how far max wind pushes the actual landing spot (0..1 space)
// Wind matters more the farther the kick travels — a 55-yard ball spends a
// lot more time in the air catching a crosswind than a 25-yard chip shot.
const WIND_DISTANCE_SCALE_MIN = 0.7; // wind's effective multiplier at MIN_DISTANCE
const WIND_DISTANCE_SCALE_MAX = 1.4; // wind's effective multiplier at MAX_DISTANCE
const WIDE_TOLERANCE = 0.22; // direction tolerance at the closest distance
const NARROW_TOLERANCE = 0.05; // direction tolerance at the farthest distance
// A power click just outside the green band, within this extra margin, is a
// "near miss" — recoverable if the direction click lands precisely enough.
const NEAR_MISS_POWER_MARGIN = 0.03;

// The pass rush: a defender breaks free of the line and blocks the kick if the
// player takes too long. The clock starts at the HIKE (not when the kick is
// first shown) and covers BOTH clicks -- if the kick isn't fully resolved
// within BLOCK_TIME_MS the kick is blocked, 0 points, counted as a miss for
// the ladder. Judged on the server's own clock (hikedAt vs now), so it can't be
// stretched by the client. BLOCK_GRACE_MS forgives network latency on a click
// that was made in time but arrived a moment late; TIMEOUT_EARLY_TOLERANCE_MS
// lets the client's own timeout call land a touch before the server's clock
// agrees (the client starts counting once the hike response arrives).
const BLOCK_TIME_MS = 5000;
const BLOCK_GRACE_MS = 1200;
const TIMEOUT_EARLY_TOLERANCE_MS = 500;

function randomInt(min, max) {
  return min + crypto.randomInt(max - min + 1);
}

function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}

// A deterministic triangle wave: 0 at the start of each period, rising to 1
// at the halfway point, back to 0 at the end — the same shape a linear
// bounce-between-two-ends animation traces out. Identical math is used to
// drive the client's visual animation, so what a player sees is exactly
// what gets scored (just always from the server's own elapsed-time clock).
function trianglePosition(elapsedMs, periodMs) {
  const cycle = ((elapsedMs % periodMs) + periodMs) % periodMs;
  const t = cycle / periodMs;
  return t < 0.5 ? t * 2 : 2 - t * 2;
}

// Where the power marker is, elapsed ms after the hike. The wave above starts at 0 (the bottom of
// the bar); the power meter is meant to start at the TOP and sweep down, so it runs half a period
// ahead. The client draws and snaps it with the exact same formula (see powerWave() in
// public/js/play-field-goal.js), so what's on screen is what gets scored.
function powerPosition(elapsedMs) {
  return trianglePosition(elapsedMs + POWER_PERIOD_MS / 2, POWER_PERIOD_MS);
}

// The green band's half-width for this specific kick's distance.
function powerSweetHalfFor(distance) {
  if (distance >= LONG_DISTANCE_THRESHOLD) return POWER_SWEET_HALF_LONG;
  if (distance >= MID_DISTANCE_THRESHOLD) return POWER_SWEET_HALF_MID;
  return POWER_SWEET_HALF_SHORT;
}

// Longer kicks punish a bad direction click more — the uprights effectively narrow.
function accuracyToleranceFor(distance) {
  const t = clamp01((distance - MIN_DISTANCE) / (MAX_DISTANCE - MIN_DISTANCE));
  return WIDE_TOLERANCE - t * (WIDE_TOLERANCE - NARROW_TOLERANCE);
}

// How far wind pushes the actual landing spot away from wherever a player
// aimed (positive = pushed right). Scales up with distance — the same wind
// speed shoves a 55-yard kick further off-line than a 25-yard one.
function windDriftFor(kick) {
  if (kick.windDir === 'calm') return 0;
  const sign = kick.windDir === 'right' ? 1 : -1;
  const t = clamp01((kick.distance - MIN_DISTANCE) / (MAX_DISTANCE - MIN_DISTANCE));
  const distanceScale = WIND_DISTANCE_SCALE_MIN + t * (WIND_DISTANCE_SCALE_MAX - WIND_DISTANCE_SCALE_MIN);
  return sign * (kick.windMph / MAX_WIND_MPH) * WIND_MAX_SHIFT * distanceScale;
}

// One kick, rolled fresh for a specific player at a specific ladder tier —
// distance comes from that tier's own range; wind is unrelated to the
// ladder and rolls the same way regardless of tier.
function rollKick(tier) {
  const [min, max] = TIER_RANGES[tier];
  const distance = randomInt(min, max);
  const windMph = randomInt(0, MAX_WIND_MPH);
  const windDir = windMph === 0 ? 'calm' : (crypto.randomInt(2) === 0 ? 'left' : 'right');
  return { distance, windMph, windDir };
}

// Where the ladder sends a player next: up a tier on a make, down a tier on
// a miss, clamped at both ends (long has nothing above it to climb to;
// short has nothing below it to fall to).
function nextTierFor(currentTier, made) {
  const idx = TIER_ORDER.indexOf(currentTier);
  return made ? TIER_ORDER[Math.min(idx + 1, TIER_ORDER.length - 1)] : TIER_ORDER[Math.max(idx - 1, 0)];
}

function initInstance() {
  return { config: {}, state: { players: {} }, status: 'ready' };
}

function freshPlayer() {
  return {
    currentIndex: 0,
    tier: 'short', // ladder position — always starts at the easiest tier
    kicks: [], // kicks[i] is THIS player's own kick for attempt i, rolled lazily as they reach it (see presentCurrentKick)
    hikedAt: null, // when the play started -- the block clock's zero (same instant powerStartedAt is armed)
    powerStartedAt: null,
    powerPos: null,
    directionStartedAt: null,
    attempts: [], // attempts[i] corresponds to kicks[i], once resolved
    totalPoints: 0,
    totalMakes: 0,
    totalAccuracyError: 0, // tiebreak: sum of |offset| on made kicks (lower = more precise)
    completed: false,
  };
}

function getOrCreatePlayer(state, memberId) {
  if (!state.players[memberId]) state.players[memberId] = freshPlayer();
  return state.players[memberId];
}

// Viewing the current kick is what rolls it (the FIRST time it's viewed —
// same distance/wind on every subsequent view/reload, never re-rolled out
// from under a kick already in progress or already locked). Called each time
// the player's view is fetched. It does NOT start any clock: the kick sits in
// the 'ready' phase (offense and defense set at the line, meters parked) until
// the player hikes the ball -- see hike().
function presentCurrentKick(state, memberId) {
  const player = getOrCreatePlayer(state, memberId);
  if (player.completed) return player;
  const idx = player.currentIndex;
  if (player.attempts[idx] == null && player.kicks[idx] == null) {
    player.kicks[idx] = rollKick(player.tier);
  }
  return player;
}

// Snaps the ball: arms the power meter and the block clock together. Idempotent
// -- a duplicate/retried request keeps the original start time.
function hike(state, memberId) {
  const player = getOrCreatePlayer(state, memberId);
  if (player.completed) return { error: 'already-completed' };
  const idx = player.currentIndex;
  if (player.attempts[idx] != null) return { error: 'already-kicked' };
  if (player.kicks[idx] == null) player.kicks[idx] = rollKick(player.tier);
  if (player.powerStartedAt == null) {
    const now = Date.now();
    player.hikedAt = now;
    player.powerStartedAt = now;
  }
  return player;
}

// A kick already under way when this shipped (powerStartedAt set, no hikedAt)
// counts its block clock from the moment its meter started.
function hikeTimeOf(player) {
  return player.hikedAt != null ? player.hikedAt : player.powerStartedAt;
}

function blockClockExpired(player, graceMs) {
  const hikedAt = hikeTimeOf(player);
  if (hikedAt == null) return false;
  return Date.now() - hikedAt > BLOCK_TIME_MS + graceMs;
}

// Records the kick as blocked: 0 points, a miss for the ladder, never a make.
function resolveBlocked(player) {
  const idx = player.currentIndex;
  const kick = player.kicks[idx];
  const result = { outcome: 'blocked', made: false, points: 0, nearMissSaved: false, distance: kick.distance, directionPos: null };
  player.attempts[idx] = result;
  return result;
}

function currentKickView(state, player) {
  if (player.completed || player.currentIndex >= KICKS_PER_PLAYER) return null;
  const kick = player.kicks[player.currentIndex];
  const attempt = player.attempts[player.currentIndex] || null;
  let phase = 'power';
  if (attempt) phase = 'result';
  else if (player.powerPos != null) phase = 'direction';
  else if (player.powerStartedAt == null) phase = 'ready'; // waiting on the hike
  return {
    index: player.currentIndex,
    total: KICKS_PER_PLAYER,
    distance: kick.distance,
    windMph: kick.windMph,
    windDir: kick.windDir,
    phase,
    powerSweetHalf: powerSweetHalfFor(kick.distance),
    hikedAt: hikeTimeOf(player),
    blockTimeMs: BLOCK_TIME_MS,
    serverNow: Date.now(), // lets the client measure its clock's offset from the server's, for the block countdown
    powerStartedAt: player.powerStartedAt,
    powerPos: player.powerPos,
    directionStartedAt: player.directionStartedAt,
    attempt,
  };
}

// The client renders its meter with the exact same triangle-wave formula
// off the exact same server-provided start time, so its own elapsed-time
// reading at the moment of the click is a faithful record of what the
// player actually saw and clicked on — using the server's OWN receipt time
// instead would silently drift the scored position later by however long
// the request took in flight, which on a real network is easily enough to
// turn a dead-on click into a miss. So the client-reported value is trusted
// as-is whenever it's a genuine finite number.
//
// This used to also reject anything outside [0, 60000) and fall back to
// Math.max(0, Date.now() - startedAt) on the server's own clock instead —
// meant only as a guard against a missing/malformed value, but it had a real
// bug: a player whose system clock doesn't exactly match the server's (no
// NTP sync, a stale VM clock, anything) computes a client-side elapsedMs
// that's honestly off by however large that skew is — which for a
// meter-length in the *seconds* can easily land outside a 60-second window,
// or even go negative. That's not malformed, it's just arithmetic on a
// clock that disagrees with the server's — but the old code discarded it
// and substituted the server's own (unrelated) elapsed time instead, which
// the player never saw: the marker could sit visibly inside the green the
// whole time and still score as a miss, because the number that actually
// got scored had nothing to do with what was on screen. trianglePosition()
// already reduces any finite input mod its period, so there's no actual
// need to bound it here — trust whatever finite number the client reports,
// exactly like the marker itself does, so the two can never disagree.
function resolveElapsed(startedAt, clientElapsedMs) {
  if (typeof clientElapsedMs === 'number' && Number.isFinite(clientElapsedMs)) {
    return clientElapsedMs;
  }
  return Math.max(0, Date.now() - startedAt);
}

// Locks in the power meter's position — idempotent, so a duplicate/retried
// request doesn't re-roll it. Immediately arms the direction meter's clock
// too, since locking power is what starts it.
function stopPower(state, memberId, clientElapsedMs) {
  const player = getOrCreatePlayer(state, memberId);
  if (player.completed) return { error: 'already-completed' };
  const idx = player.currentIndex;
  if (player.attempts[idx] != null) return { error: 'already-kicked' };
  if (player.powerStartedAt == null) return { error: 'power-not-started' };
  if (player.powerPos != null) return player; // already locked, direction phase already armed
  if (blockClockExpired(player, BLOCK_GRACE_MS)) { resolveBlocked(player); return player; }

  const elapsedMs = resolveElapsed(player.powerStartedAt, clientElapsedMs);
  const pos = powerPosition(elapsedMs);
  player.powerPos = pos;
  player.directionStartedAt = Date.now();
  return player;
}

// Locks in the direction meter's position and resolves the whole kick —
// idempotent, so a retried request doesn't re-score it.
function stopDirection(state, memberId, clientElapsedMs) {
  const player = getOrCreatePlayer(state, memberId);
  if (player.completed) return { error: 'already-completed' };
  const idx = player.currentIndex;
  if (player.attempts[idx] != null) return player.attempts[idx];
  if (player.powerPos == null || player.directionStartedAt == null) return { error: 'power-not-locked' };

  if (blockClockExpired(player, BLOCK_GRACE_MS)) return resolveBlocked(player);

  const kick = player.kicks[idx];
  const elapsedMs = resolveElapsed(player.directionStartedAt, clientElapsedMs);
  const clickPos = trianglePosition(elapsedMs, DIRECTION_PERIOD_MS);

  // In the green (sized for THIS kick's distance) means enough power for
  // this kick, no questions asked. Just outside it is a near miss — still
  // recoverable if the direction click is precise enough to save it.
  const deviation = Math.abs(player.powerPos - 0.5);
  const sweetHalf = powerSweetHalfFor(kick.distance);
  const hadPower = deviation <= sweetHalf;
  const isNearMiss = !hadPower && deviation <= sweetHalf + NEAR_MISS_POWER_MARGIN;
  const drift = windDriftFor(kick);
  const landing = clamp01(clickPos + drift);
  const offset = landing - 0.5;
  const tolerance = accuracyToleranceFor(kick.distance);
  const nearMissSaved = isNearMiss && Math.abs(offset) <= tolerance / 2;
  const enoughPower = hadPower || nearMissSaved;

  let result;
  if (!enoughPower) {
    result = { outcome: 'short', made: false, points: 0 };
  } else if (Math.abs(offset) > tolerance) {
    result = { outcome: offset > 0 ? 'wide-right' : 'wide-left', made: false, points: 0 };
  } else {
    const points = kick.distance <= 39 ? 3 : (kick.distance <= 49 ? 4 : 5);
    result = { outcome: 'made', made: true, points, accuracyError: Math.abs(offset) };
  }

  result.nearMissSaved = nearMissSaved;
  result.distance = kick.distance;
  result.directionPos = clickPos; // so the client can freeze the marker where it was actually clicked
  player.attempts[idx] = result;
  player.totalPoints += result.points;
  if (result.made) {
    player.totalMakes += 1;
    player.totalAccuracyError += result.accuracyError || 0;
  }
  return result;
}

// Restarts whichever meter is currently in play (power if it hasn't been
// locked yet, otherwise direction) — for when the client noticed its tab
// was backgrounded mid-meter and would rather give the player a fresh,
// honest shot than silently score off however far the clock drifted while
// nobody was looking (the animation itself pauses while backgrounded, same
// as any browser tab, but real elapsed time doesn't).
function resyncClock(state, memberId) {
  const player = getOrCreatePlayer(state, memberId);
  if (player.completed) return { error: 'already-completed' };
  const idx = player.currentIndex;
  if (player.attempts[idx] != null) return { error: 'already-kicked' };
  if (player.powerStartedAt == null) return player; // still waiting on the hike -- nothing running to restart
  if (blockClockExpired(player, 0)) { resolveBlocked(player); return player; }
  if (player.powerPos == null) {
    player.powerStartedAt = Date.now();
  } else {
    player.directionStartedAt = Date.now();
  }
  return player;
}

// The client's own countdown ran out with the kick still unresolved -- the pass
// rusher gets there. Idempotent (an already-resolved kick just returns its
// result), and refused if the server's clock says it's too soon.
function timeoutBlock(state, memberId) {
  const player = getOrCreatePlayer(state, memberId);
  if (player.completed) return { error: 'already-completed' };
  const idx = player.currentIndex;
  if (player.attempts[idx] != null) return player.attempts[idx];
  const hikedAt = hikeTimeOf(player);
  if (hikedAt == null) return { error: 'not-hiked' };
  if (Date.now() - hikedAt < BLOCK_TIME_MS - TIMEOUT_EARLY_TOLERANCE_MS) return { error: 'too-early' };
  return resolveBlocked(player);
}

function advanceToNext(state, memberId) {
  const player = getOrCreatePlayer(state, memberId);
  if (player.completed) return player;
  const attempt = player.attempts[player.currentIndex];
  if (attempt == null) return { error: 'not-kicked-yet' };

  // Off the just-completed attempt and the CURRENT (pre-increment) tier —
  // a retried call re-reads attempts[] at the NEW currentIndex below, finds
  // it null, and errors out above before ever reaching this line again, so
  // this can't double-apply.
  player.tier = nextTierFor(player.tier, attempt.made);

  player.currentIndex += 1;
  player.hikedAt = null;
  player.powerStartedAt = null;
  player.powerPos = null;
  player.directionStartedAt = null;
  if (player.currentIndex >= KICKS_PER_PLAYER) {
    player.completed = true;
    player.completedAt = Date.now();
  }
  return player;
}

function isComplete(state, memberIds) {
  return memberIds.every((mid) => state.players[mid] && state.players[mid].completed);
}

function computeResults(state) {
  const entries = Object.entries(state.players).map(([memberId, p]) => ({
    memberId,
    totalPoints: p.totalPoints,
    totalMakes: p.totalMakes,
    totalAccuracyError: p.totalAccuracyError,
  }));
  entries.sort((x, y) => (y.totalPoints - x.totalPoints) || (y.totalMakes - x.totalMakes) || (x.totalAccuracyError - y.totalAccuracyError));
  return entries.map((e, i) => ({ memberId: e.memberId, rank: i + 1 }));
}

module.exports = {
  id, name, description, category, supportedModes,
  KICKS_PER_PLAYER, POWER_PERIOD_MS, DIRECTION_PERIOD_MS, NEAR_MISS_POWER_MARGIN, TIER_RANGES,
  trianglePosition, powerPosition, powerSweetHalfFor, rollKick, nextTierFor,
  BLOCK_TIME_MS,
  initInstance, getOrCreatePlayer, presentCurrentKick, hike, currentKickView,
  stopPower, stopDirection, resyncClock, timeoutBlock, advanceToNext, isComplete, computeResults,
};
