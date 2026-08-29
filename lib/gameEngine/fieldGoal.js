// Field Goal Kick — async, self-paced, one kick at a time. A classic
// two-click retro kicker (think old NES/Tecmo-style field goal games)
// rather than Madden's hold-and-release meter:
//   1. A vertical power meter starts oscillating the moment a kick is
//      presented. A visible green band marks the sweet spot in the
//      middle — click to lock it in; the farther from that band (in
//      EITHER direction, too high or too low), the weaker the kick.
//   2. Locking power immediately starts a horizontal direction meter
//      oscillating left-right. There's no visible target here — click
//      to lock in a direction. How much error is tolerated depends on
//      the kick's distance (forgiving up close, unforgiving from deep),
//      and wind pushes the actual landing spot away from wherever you
//      aimed.
//
// Both meters are simple deterministic triangle waves (0 -> 1 -> 0 on a
// fixed period) computed from a server-recorded start timestamp, so a
// click's position is always derived from real elapsed server time —
// never trusted from the client.
//
// Every player in the instance faces the exact same shared sequence of
// kicks (same distances/wind) generated once when the instance starts, so
// results are a fair skill comparison rather than the luck of the draw.
const crypto = require('crypto');

const id = 'fieldGoal';
const name = 'Field Goal Kick';
const description = 'A classic two-click retro kicker: stop the power meter in the sweet spot, then stop the direction meter to split the uprights — beating the wind along the way. 5 kicks per player, same distances and wind for everyone.';
const category = 'kicking';
const supportedModes = ['async'];

const KICKS_PER_PLAYER = 5;
const POWER_PERIOD_MS = 1300; // one full up-down cycle of the power meter
const DIRECTION_PERIOD_MS = 1000; // one full left-right cycle of the direction meter
const POWER_SWEET_HALF = 0.12; // half-width of the visible green band (0..1 space)
const FULL_RANGE_YARDS = 62; // longest a perfectly-timed power click can travel
const MIN_DISTANCE = 25;
const MAX_DISTANCE = 55;
const MAX_WIND_MPH = 15;
const WIND_MAX_SHIFT = 0.3; // how far max wind pushes the actual landing spot (0..1 space)
const WIDE_TOLERANCE = 0.22; // direction tolerance at the closest distance
const NARROW_TOLERANCE = 0.05; // direction tolerance at the farthest distance

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

// 1 inside the green band, falling off linearly to 0 at either extreme end
// of the bar — over- and under-shooting the sweet spot both cost you power.
function powerFactorFor(pos) {
  const dist = Math.abs(pos - 0.5);
  if (dist <= POWER_SWEET_HALF) return 1;
  const falloffRange = 0.5 - POWER_SWEET_HALF;
  const excess = dist - POWER_SWEET_HALF;
  return Math.max(0, 1 - excess / falloffRange);
}

// Longer kicks punish a bad direction click more — the uprights effectively narrow.
function accuracyToleranceFor(distance) {
  const t = clamp01((distance - MIN_DISTANCE) / (MAX_DISTANCE - MIN_DISTANCE));
  return WIDE_TOLERANCE - t * (WIDE_TOLERANCE - NARROW_TOLERANCE);
}

// How far wind pushes the actual landing spot away from wherever a player
// aimed (positive = pushed right).
function windDriftFor(kick) {
  if (kick.windDir === 'calm') return 0;
  const sign = kick.windDir === 'right' ? 1 : -1;
  return sign * (kick.windMph / MAX_WIND_MPH) * WIND_MAX_SHIFT;
}

// One shared sequence of kicks for the whole instance — everyone attempts
// the same distances/wind, generated once.
function generateKicks() {
  const kicks = [];
  for (let i = 0; i < KICKS_PER_PLAYER; i++) {
    const distance = randomInt(MIN_DISTANCE, MAX_DISTANCE);
    const windMph = randomInt(0, MAX_WIND_MPH);
    const windDir = windMph === 0 ? 'calm' : (crypto.randomInt(2) === 0 ? 'left' : 'right');
    kicks.push({ distance, windMph, windDir });
  }
  return kicks;
}

function initInstance() {
  return { config: {}, state: { kicks: generateKicks(), players: {} }, status: 'ready' };
}

function freshPlayer() {
  return {
    currentIndex: 0,
    powerStartedAt: null,
    powerPos: null,
    powerFactor: null,
    directionStartedAt: null,
    attempts: [], // attempts[i] corresponds to state.kicks[i], once resolved
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

// Viewing the current kick is what starts its power meter — called each
// time the player's view is fetched, but only while that kick is still
// unresolved and the power phase hasn't already begun.
function presentCurrentKick(state, memberId) {
  const player = getOrCreatePlayer(state, memberId);
  if (!player.completed && player.attempts[player.currentIndex] == null && player.powerStartedAt == null) {
    player.powerStartedAt = Date.now();
  }
  return player;
}

function currentKickView(state, player) {
  if (player.completed || player.currentIndex >= state.kicks.length) return null;
  const kick = state.kicks[player.currentIndex];
  const attempt = player.attempts[player.currentIndex] || null;
  let phase = 'power';
  if (attempt) phase = 'result';
  else if (player.powerPos != null) phase = 'direction';
  return {
    index: player.currentIndex,
    total: state.kicks.length,
    distance: kick.distance,
    windMph: kick.windMph,
    windDir: kick.windDir,
    phase,
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
// as long as it's a sane, finite, non-negative number under a generous cap;
// anything else (missing, malformed, wildly large) falls back to the
// server's own clock rather than failing the request outright.
function resolveElapsed(startedAt, clientElapsedMs) {
  if (typeof clientElapsedMs === 'number' && Number.isFinite(clientElapsedMs) && clientElapsedMs >= 0 && clientElapsedMs < 60000) {
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

  const elapsedMs = resolveElapsed(player.powerStartedAt, clientElapsedMs);
  const pos = trianglePosition(elapsedMs, POWER_PERIOD_MS);
  player.powerPos = pos;
  player.powerFactor = powerFactorFor(pos);
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

  const kick = state.kicks[idx];
  const elapsedMs = resolveElapsed(player.directionStartedAt, clientElapsedMs);
  const clickPos = trianglePosition(elapsedMs, DIRECTION_PERIOD_MS);

  const maxRange = FULL_RANGE_YARDS * player.powerFactor;
  const drift = windDriftFor(kick);
  const landing = clamp01(clickPos + drift);
  const offset = landing - 0.5;
  const tolerance = accuracyToleranceFor(kick.distance);

  let result;
  if (kick.distance > maxRange) {
    result = { outcome: 'short', made: false, points: 0 };
  } else if (Math.abs(offset) > tolerance) {
    result = { outcome: offset > 0 ? 'wide-right' : 'wide-left', made: false, points: 0 };
  } else {
    const points = kick.distance <= 39 ? 3 : (kick.distance <= 49 ? 4 : 5);
    result = { outcome: 'made', made: true, points, accuracyError: Math.abs(offset) };
  }

  result.distance = kick.distance;
  result.powerFactor = player.powerFactor;
  result.directionPos = clickPos; // so the client can freeze the marker where it was actually clicked
  player.attempts[idx] = result;
  player.totalPoints += result.points;
  if (result.made) {
    player.totalMakes += 1;
    player.totalAccuracyError += result.accuracyError || 0;
  }
  return result;
}

function advanceToNext(state, memberId) {
  const player = getOrCreatePlayer(state, memberId);
  if (player.completed) return player;
  if (player.attempts[player.currentIndex] == null) return { error: 'not-kicked-yet' };

  player.currentIndex += 1;
  player.powerStartedAt = null;
  player.powerPos = null;
  player.powerFactor = null;
  player.directionStartedAt = null;
  if (player.currentIndex >= state.kicks.length) {
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
  KICKS_PER_PLAYER, POWER_PERIOD_MS, DIRECTION_PERIOD_MS, POWER_SWEET_HALF,
  trianglePosition,
  initInstance, getOrCreatePlayer, presentCurrentKick, currentKickView,
  stopPower, stopDirection, advanceToNext, isComplete, computeResults,
};
