// Field Goal Kick — async, self-paced, one kick at a time. Loosely modeled on
// Madden's kick meter: hold a button to charge power and release at the
// right moment. Release too early and it's weak; hold too long and you're
// in the red — a shanked kick, wide left or right, no matter what. Before
// each kick you also set your aim to counter the wind.
//
// Every player in the instance faces the exact same shared sequence of
// kicks (same distances/wind) generated once when the instance starts, so
// results are a fair skill comparison rather than the luck of the draw.
const crypto = require('crypto');

const id = 'fieldGoal';
const name = 'Field Goal Kick';
const description = 'Charge the kick meter and beat the wind, Madden-style — release too early and it\'s weak, too late and you shank it. 5 kicks per player, same distances and wind for everyone.';
const category = 'kicking';
const supportedModes = ['async'];

const KICKS_PER_PLAYER = 5;
const METER_DURATION_MS = 1600; // full 0-100% fill time for a held kick
const SWEET_SPOT_START = 0.68; // fraction of fill where full power begins
const SWEET_SPOT_END = 0.88; // fraction of fill where the red/shank zone begins
const MAX_RANGE_YARDS = 62; // longest a full-power kick can travel
const MIN_DISTANCE = 25;
const MAX_DISTANCE = 55;
const MAX_WIND_MPH = 15;
const AIM_MIN = -10;
const AIM_MAX = 10;

function randomInt(min, max) {
  return min + crypto.randomInt(max - min + 1);
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

// The aim (in yards, negative = left) that exactly cancels the wind's drift.
function idealAimFor(kick) {
  if (kick.windDir === 'calm') return 0;
  const sign = kick.windDir === 'right' ? -1 : 1; // wind pushes right -> aim left, and vice versa
  return sign * kick.windMph * 0.6;
}

// Longer kicks punish a bad aim more — the uprights effectively "narrow".
function aimToleranceFor(distance) {
  return Math.max(1.5, 5 - distance * 0.045);
}

function initInstance() {
  return { config: {}, state: { kicks: generateKicks(), players: {} }, status: 'ready' };
}

function getOrCreatePlayer(state, memberId) {
  if (!state.players[memberId]) {
    state.players[memberId] = {
      currentIndex: 0,
      aim: null, // this kick's chosen aim, once set
      meterStartedAt: null, // server timestamp of when the hold began
      attempts: [], // attempts[i] corresponds to state.kicks[i], once resolved
      totalPoints: 0,
      totalMakes: 0,
      totalAimError: 0, // tiebreak: sum of aim error on made kicks (lower = more precise)
      completed: false,
    };
  }
  return state.players[memberId];
}

function currentKickView(state, player) {
  if (player.completed || player.currentIndex >= state.kicks.length) return null;
  const kick = state.kicks[player.currentIndex];
  const attempt = player.attempts[player.currentIndex] || null;
  let phase = 'aim';
  if (attempt) phase = 'result';
  else if (player.aim != null) phase = 'ready';
  return {
    index: player.currentIndex,
    total: state.kicks.length,
    distance: kick.distance,
    windMph: kick.windMph,
    windDir: kick.windDir,
    phase,
    aim: player.aim,
    attempt,
  };
}

function setAim(state, memberId, aimValue) {
  const player = getOrCreatePlayer(state, memberId);
  if (player.completed) return { error: 'already-completed' };
  const idx = player.currentIndex;
  if (player.attempts[idx] != null) return { error: 'already-kicked' };
  const clamped = Math.max(AIM_MIN, Math.min(AIM_MAX, Math.round(Number(aimValue) || 0)));
  player.aim = clamped;
  player.meterStartedAt = null; // aim can be re-set until the hold actually starts
  return player;
}

function startHold(state, memberId) {
  const player = getOrCreatePlayer(state, memberId);
  if (player.completed) return { error: 'already-completed' };
  const idx = player.currentIndex;
  if (player.attempts[idx] != null) return { error: 'already-kicked' };
  if (player.aim == null) return { error: 'aim-not-set' };
  if (player.meterStartedAt == null) player.meterStartedAt = Date.now();
  return player;
}

// Resolves the current kick from the server-measured hold duration —
// idempotent, so a retried/duplicate release request won't re-score it.
function release(state, memberId) {
  const player = getOrCreatePlayer(state, memberId);
  if (player.completed) return { error: 'already-completed' };
  const idx = player.currentIndex;
  if (player.attempts[idx] != null) return player.attempts[idx];
  if (player.aim == null || player.meterStartedAt == null) return { error: 'not-ready' };

  const kick = state.kicks[idx];
  const elapsedMs = Math.max(0, Date.now() - player.meterStartedAt);
  const fill = elapsedMs / METER_DURATION_MS;

  let result;
  if (fill >= SWEET_SPOT_END) {
    const wentLeft = crypto.randomInt(2) === 0;
    result = { outcome: 'shank', made: false, points: 0, detail: wentLeft ? 'left' : 'right' };
  } else {
    const idealAim = idealAimFor(kick);
    const tolerance = aimToleranceFor(kick.distance);
    const aimError = Math.abs(player.aim - idealAim);

    let maxRange = MAX_RANGE_YARDS;
    if (fill < SWEET_SPOT_START) {
      maxRange = MAX_RANGE_YARDS * (fill / SWEET_SPOT_START);
    }

    if (kick.distance > maxRange) {
      result = { outcome: 'short', made: false, points: 0, detail: null };
    } else if (aimError > tolerance) {
      result = { outcome: player.aim > idealAim ? 'wide-right' : 'wide-left', made: false, points: 0, detail: null };
    } else {
      const points = kick.distance <= 39 ? 3 : (kick.distance <= 49 ? 4 : 5);
      result = { outcome: 'made', made: true, points, detail: null };
      result.aimError = aimError;
    }
  }

  result.fill = Math.min(fill, 1.5);
  result.distance = kick.distance;
  player.attempts[idx] = result;
  player.totalPoints += result.points;
  if (result.made) {
    player.totalMakes += 1;
    player.totalAimError += result.aimError || 0;
  }
  return result;
}

function advanceToNext(state, memberId) {
  const player = getOrCreatePlayer(state, memberId);
  if (player.completed) return player;
  if (player.attempts[player.currentIndex] == null) return { error: 'not-kicked-yet' };

  player.currentIndex += 1;
  player.aim = null;
  player.meterStartedAt = null;
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
    totalAimError: p.totalAimError,
  }));
  entries.sort((x, y) => (y.totalPoints - x.totalPoints) || (y.totalMakes - x.totalMakes) || (x.totalAimError - y.totalAimError));
  return entries.map((e, i) => ({ memberId: e.memberId, rank: i + 1 }));
}

module.exports = {
  id, name, description, category, supportedModes,
  KICKS_PER_PLAYER, METER_DURATION_MS, SWEET_SPOT_START, SWEET_SPOT_END, AIM_MIN, AIM_MAX,
  initInstance, getOrCreatePlayer, currentKickView, setAim, startHold, release, advanceToNext,
  isComplete, computeResults,
};
