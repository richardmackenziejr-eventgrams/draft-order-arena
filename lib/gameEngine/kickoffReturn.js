// Kickoff Return — async, self-paced, one return at a time. Real-time and
// keyboard-driven, unlike the site's other games: the player controls a
// runner with arrow keys (plus a juke and a spin move) to dodge defenders
// on a top-down field, entirely simulated in the browser. This engine never
// runs that simulation itself — it only decides how hard the NEXT return
// should be (how many defenders, how fast) and scores whatever outcome the
// client reports back, the same "server decides the setup and trusts the
// client's report" split every other async game here already uses (e.g.
// Field Goal Kick trusting the client's own elapsed-time reading).
//
// 5 returns per player, each starting at the player's own 20-yard line (80
// yards from the opposing goal line). Every return scores 0.1 points per
// yard gained plus a 7-point bonus for reaching the end zone (a touchdown
// is always exactly 80 yards, so a max return is worth 8 + 7 = 15; a max
// session is 75). A per-player difficulty LEVEL — not a named tier like
// Field Goal's short/mid/long ladder, since this needs to climb
// indefinitely rather than pick from a fixed set — steers how the NEXT
// return is set up: a touchdown jumps it up a lot, gaining 50-79 yards
// bumps it up a little, 21-49 holds it steady, and 20 or fewer eases it
// back down (floored at the level a player started at — it never gets
// easier than where they began, no matter how many short returns they have
// in a row). The level itself can climb forever, but what it actually
// produces (defender count/speed) saturates at a sane maximum so an
// extreme streak stays a playable, not literally-impossible, next return.
const id = 'kickoffReturn';
const name = 'Kickoff Return';
const description = 'Real-time and keyboard-controlled: catch the kick and dodge your way upfield with the arrow keys, a juke, and a spin move. 5 returns per player — the better you do, the tougher the coverage gets on your next one.';
const category = 'arcade';
const supportedModes = ['async'];

const RETURNS_PER_PLAYER = 5;
const FIELD_YARDS = 80; // own 20-yard line to the opposing goal line
const YARDS_PER_POINT = 0.1;
const TOUCHDOWN_BONUS = 7;

// Difficulty-level step sizes for the ladder described above.
const LEVEL_STEP_TOUCHDOWN = 2;
const LEVEL_STEP_BIG_GAIN = 1; // 50-79 yards
const LEVEL_STEP_DOWN = 1; // 20 yards or fewer
const BIG_GAIN_THRESHOLD = 50;
const HOLD_THRESHOLD = 21; // 21-49 yards holds; this file's nextLevelFor() checks the 20-or-fewer case first
const MIN_LEVEL = 0;

// What a difficulty level actually produces for the client to simulate
// against — these saturate at a sane maximum regardless of how high the
// level itself climbs, so a long hot streak makes the next return
// noticeably harder without ever making it unplayable.
const BASE_DEFENDER_COUNT = 3;
const MAX_DEFENDER_COUNT = 7;
const DEFENDER_COUNT_LEVELS_PER_STEP = 2; // +1 defender every 2 levels
const BASE_DEFENDER_SPEED = 1; // multiplier the client applies to its own base pursuit speed
const MAX_DEFENDER_SPEED = 1.6;
const DEFENDER_SPEED_PER_LEVEL = 0.05;

function clamp(x, min, max) {
  return Math.max(min, Math.min(max, x));
}

// Where the ladder sends a player's difficulty after a resolved return —
// bigger gains push it up (a touchdown more than a merely-good return),
// small gains ease it back down, floored so it never gets easier than
// where a player started.
function nextLevelFor(currentLevel, yardsGained, touchdown) {
  if (touchdown) return currentLevel + LEVEL_STEP_TOUCHDOWN;
  if (yardsGained >= BIG_GAIN_THRESHOLD) return currentLevel + LEVEL_STEP_BIG_GAIN;
  if (yardsGained >= HOLD_THRESHOLD) return currentLevel;
  return Math.max(MIN_LEVEL, currentLevel - LEVEL_STEP_DOWN);
}

function defenderCountFor(level) {
  return Math.min(MAX_DEFENDER_COUNT, BASE_DEFENDER_COUNT + Math.floor(level / DEFENDER_COUNT_LEVELS_PER_STEP));
}

function defenderSpeedFor(level) {
  return Math.min(MAX_DEFENDER_SPEED, BASE_DEFENDER_SPEED + level * DEFENDER_SPEED_PER_LEVEL);
}

function initInstance() {
  return { config: {}, state: { players: {} }, status: 'ready' };
}

function freshPlayer() {
  return {
    currentIndex: 0,
    difficultyLevel: MIN_LEVEL, // ladder position — always starts at the floor
    returns: [], // returns[i] is this player's difficulty setup for attempt i, rolled lazily as they reach it
    attempts: [], // attempts[i] corresponds to returns[i], once resolved
    totalPoints: 0,
    totalYards: 0, // tiebreak
    touchdowns: 0, // secondary tiebreak — more touchdowns wins a points tie
    completed: false,
  };
}

function getOrCreatePlayer(state, memberId) {
  if (!state.players[memberId]) state.players[memberId] = freshPlayer();
  return state.players[memberId];
}

// Viewing the current return is what rolls its difficulty setup — the
// FIRST time it's viewed (same setup on every subsequent view/reload,
// never re-rolled out from under a return already in progress; a reload
// mid-return just restarts that same return from the kickoff catch with
// the same defenders it already had).
function presentCurrentReturn(state, memberId) {
  const player = getOrCreatePlayer(state, memberId);
  if (player.completed) return player;
  const idx = player.currentIndex;
  if (player.attempts[idx] == null && player.returns[idx] == null) {
    const level = player.difficultyLevel;
    player.returns[idx] = {
      index: idx,
      level,
      defenderCount: defenderCountFor(level),
      defenderSpeed: defenderSpeedFor(level),
    };
  }
  return player;
}

function currentReturnView(state, player) {
  if (player.completed || player.currentIndex >= RETURNS_PER_PLAYER) return null;
  const ret = player.returns[player.currentIndex];
  const attempt = player.attempts[player.currentIndex] || null;
  return {
    index: player.currentIndex,
    total: RETURNS_PER_PLAYER,
    fieldYards: FIELD_YARDS,
    defenderCount: ret.defenderCount,
    defenderSpeed: ret.defenderSpeed,
    attempt,
  };
}

// Scores the player's CURRENT return — idempotent, so a duplicate/retried
// request doesn't re-score it. Trusts the client's report the same way
// every other async game here trusts its own client-measured input, but
// still enforces the one invariant that must always hold regardless of
// what's reported: a touchdown is exactly FIELD_YARDS, nothing else is.
function submitReturn(state, memberId, yardsGainedRaw, touchdownRaw) {
  const player = getOrCreatePlayer(state, memberId);
  if (player.completed) return { error: 'already-completed' };
  const idx = player.currentIndex;
  if (player.attempts[idx] != null) return player.attempts[idx];
  if (player.returns[idx] == null) return { error: 'return-not-started' };

  const rawYards = typeof yardsGainedRaw === 'number' && Number.isFinite(yardsGainedRaw) ? yardsGainedRaw : 0;
  const reportedTouchdown = !!touchdownRaw;
  const clampedYards = clamp(Math.round(rawYards), 0, FIELD_YARDS);
  const touchdown = reportedTouchdown || clampedYards >= FIELD_YARDS;
  const yardsGained = touchdown ? FIELD_YARDS : clampedYards;

  const points = yardsGained * YARDS_PER_POINT + (touchdown ? TOUCHDOWN_BONUS : 0);
  const result = { yardsGained, touchdown, points };

  player.attempts[idx] = result;
  player.totalPoints += points;
  player.totalYards += yardsGained;
  if (touchdown) player.touchdowns += 1;
  return result;
}

function advanceToNext(state, memberId) {
  const player = getOrCreatePlayer(state, memberId);
  if (player.completed) return player;
  const attempt = player.attempts[player.currentIndex];
  if (attempt == null) return { error: 'not-returned-yet' };

  // Off the just-completed attempt and the CURRENT (pre-increment) level —
  // a retried call re-reads attempts[] at the NEW currentIndex below, finds
  // it null, and errors out above before ever reaching this line again, so
  // this can't double-apply.
  player.difficultyLevel = nextLevelFor(player.difficultyLevel, attempt.yardsGained, attempt.touchdown);

  player.currentIndex += 1;
  if (player.currentIndex >= RETURNS_PER_PLAYER) {
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
    touchdowns: p.touchdowns,
    totalYards: p.totalYards,
  }));
  entries.sort((x, y) => (y.totalPoints - x.totalPoints) || (y.touchdowns - x.touchdowns) || (y.totalYards - x.totalYards));
  return entries.map((e, i) => ({ memberId: e.memberId, rank: i + 1 }));
}

module.exports = {
  id, name, description, category, supportedModes,
  RETURNS_PER_PLAYER, FIELD_YARDS,
  nextLevelFor, defenderCountFor, defenderSpeedFor,
  initInstance, getOrCreatePlayer, presentCurrentReturn, currentReturnView,
  submitReturn, advanceToNext, isComplete, computeResults,
};
