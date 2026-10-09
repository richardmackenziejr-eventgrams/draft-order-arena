// Two-Minute Drill — async, self-paced, ONE drive per player. The player is the
// quarterback of an offense that starts at its own 25 with 2:00 on the clock
// and 3 timeouts, and plays a fully real-time drive in the browser (drop back,
// scramble, throw to an open receiver, spike the ball, call a timeout, kick a
// field goal). Like Kickoff Return this engine never runs that simulation: it
// hands out the drive's setup (a shared random seed, so every member of a
// league faces the same plays and the same coverage luck) and scores whatever
// outcome the client reports back, after normalizing it so the invariants that
// must always hold do hold.
//
// Scoring for the drive: a touchdown is worth 7, a made field goal 3, anything
// else 0. Players are ranked by points, then by yards gained on the drive (the
// ball's final spot minus the 25 it started at), then by time left on the
// clock (more is better — it only breaks a dead heat).
//
// `hidden: true` keeps the game out of the public catalog (the home page and the
// commissioner's game picker) while it is still a prototype; it is still a real
// registered type, so a solo test drive works. Flip it to false to release it.
const crypto = require('crypto');

const id = 'twoMinuteDrill';
const name = 'Two-Minute Drill';
const description = 'You are the quarterback with 2:00 on the clock. Drive your offense down the field in real time: read the defense, scramble away from the rush, throw to the open receiver, spike the ball to stop the clock, and score. A touchdown is 7, a field goal is 3.';
const category = 'drill';
const supportedModes = ['async'];
const hidden = true;

const DRIVES_PER_PLAYER = 1;
const FIELD_YARDS = 100; // own goal line to the opposing goal line
const START_YARD = 25; // the drive starts at the player's own 25
const CLOCK_SECONDS = 120;
const TIMEOUTS = 3;
const TOUCHDOWN_POINTS = 7;
const FIELD_GOAL_POINTS = 3;
const MAX_YARDS = FIELD_YARDS - START_YARD; // 75: a touchdown drive

function clamp(x, min, max) {
  return Math.max(min, Math.min(max, x));
}

function initInstance() {
  // One seed per game instance, shared by every player in it, so the plays and
  // the pass-rush timing a member sees are the same ones everyone else sees.
  return { config: {}, state: { players: {}, seed: crypto.randomInt(1, 2_000_000_000) }, status: 'ready' };
}

function freshPlayer() {
  return {
    attempt: null, // the resolved drive, once submitted
    totalPoints: 0,
    totalYards: 0,
    timeLeft: 0,
    completed: false,
  };
}

function getOrCreatePlayer(state, memberId) {
  if (!state.players[memberId]) state.players[memberId] = freshPlayer();
  return state.players[memberId];
}

// A game instance created before the seed existed (or a bare state) still gets one.
function seedOf(state) {
  if (state.seed == null) state.seed = crypto.randomInt(1, 2_000_000_000);
  return state.seed;
}

function currentDriveView(state, player) {
  if (player.completed) return null;
  return {
    index: 0,
    total: DRIVES_PER_PLAYER,
    seed: seedOf(state),
    fieldYards: FIELD_YARDS,
    startYard: START_YARD,
    clockSeconds: CLOCK_SECONDS,
    timeouts: TIMEOUTS,
    attempt: player.attempt,
  };
}

// Scores the player's drive — idempotent, so a duplicate/retried request keeps the
// first result. Trusts the client's report like every other async game here, but
// normalizes it: points come from the outcome (never from a reported number), yards
// are bounded by the field, and a touchdown is always exactly the full 75 yards.
function submitDrive(state, memberId, report) {
  const player = getOrCreatePlayer(state, memberId);
  if (player.attempt != null) return player.attempt;
  const r = report && typeof report === 'object' ? report : {};

  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const touchdown = !!r.touchdown;
  const fieldGoal = !touchdown && !!r.fieldGoal;
  const yards = touchdown ? MAX_YARDS : clamp(Math.round(num(r.yards)), 0, MAX_YARDS);
  const timeLeft = clamp(Math.round(num(r.timeLeft)), 0, CLOCK_SECONDS);
  const plays = clamp(Math.round(num(r.plays)), 0, 99);
  const points = touchdown ? TOUCHDOWN_POINTS : (fieldGoal ? FIELD_GOAL_POINTS : 0);
  const endReason = typeof r.endReason === 'string' ? r.endReason.slice(0, 40) : '';

  const result = { points, touchdown, fieldGoal, yards, timeLeft, plays, endReason };
  player.attempt = result;
  player.totalPoints = points;
  player.totalYards = yards;
  player.timeLeft = timeLeft;
  player.completed = true;
  player.completedAt = Date.now();
  return result;
}

function isComplete(state, memberIds) {
  return memberIds.every((mid) => state.players[mid] && state.players[mid].completed);
}

function computeResults(state) {
  const entries = Object.entries(state.players).map(([memberId, p]) => ({
    memberId,
    points: p.totalPoints,
    yards: p.totalYards,
    timeLeft: p.timeLeft,
  }));
  entries.sort((x, y) => (y.points - x.points) || (y.yards - x.yards) || (y.timeLeft - x.timeLeft));
  return entries.map((e, i) => ({ memberId: e.memberId, rank: i + 1 }));
}

module.exports = {
  id, name, description, category, supportedModes, hidden,
  DRIVES_PER_PLAYER, FIELD_YARDS, START_YARD, CLOCK_SECONDS, TIMEOUTS, TOUCHDOWN_POINTS, FIELD_GOAL_POINTS,
  initInstance, getOrCreatePlayer, currentDriveView, submitDrive, isComplete, computeResults,
};
