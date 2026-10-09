// Two-Minute Drill: the rules, with no 3D and no DOM in here -- the clock, downs and distance,
// scoring, how a throw is judged, the field-goal odds, and the playbook. The game page
// (play-two-minute-drill.js) drives the 3D simulation and calls into this for every decision that
// is really "a rule", so those can be checked on their own.
//
// Field frame (same as Kickoff Return / the stadium): x is across the field, z runs downfield
// toward -Z, the offense's own goal line is z = 0 and the opponent's goal line is z = -100. A
// "yard" value below is yards from the offense's OWN goal line (so the drive starts at 25 and a
// touchdown is 100).

export const FIELD_YARDS = 100;
export const START_YARD = 25;
export const CLOCK_SECONDS = 120;
export const TIMEOUTS = 3;
export const TOUCHDOWN_POINTS = 7;
export const FIELD_GOAL_POINTS = 3;
export const MAX_FIELD_GOAL_KICK = 62; // yards, from the line of scrimmage + 17 (endzone and holder), the most anyone will attempt

// A small seeded random generator (mulberry32): every member of a league gets the same seed, so
// they all see the same plays and the same coverage luck.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

// ---- the drive's state ---------------------------------------------------------------------
export function createDrive({ startYard = START_YARD, clockSeconds = CLOCK_SECONDS, timeouts = TIMEOUTS } = {}) {
  return {
    startYard,
    losYard: startYard,     // where the next snap happens
    down: 1,
    toGo: Math.min(10, FIELD_YARDS - startYard),
    clock: clockSeconds,
    clockRunning: false,    // the first snap starts it
    timeouts,
    plays: 0,
    over: false,
    endReason: null,        // 'touchdown' | 'field goal' | 'missed field goal' | 'interception' | 'turnover on downs' | 'time expired' | 'safety'
    touchdown: false,
    fieldGoal: false,
    points: 0,
  };
}

export function ordinal(n) { return ['', '1st', '2nd', '3rd', '4th'][n] || `${n}th`; }

export function downAndDistanceText(d) {
  const goalToGo = d.losYard + d.toGo >= FIELD_YARDS;
  return `${ordinal(d.down)} & ${goalToGo ? 'Goal' : d.toGo}`;
}

export function ballOnText(yard) {
  const y = Math.round(yard);
  if (y === 50) return 'the 50';
  return y < 50 ? `OWN ${y}` : `OPP ${FIELD_YARDS - y}`;
}

export function clockText(seconds) {
  const s = Math.max(0, Math.ceil(seconds - 1e-9));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// Advance the game clock by dt real seconds, if it's running. Returns true when it just hit zero.
export function tickClock(d, dt) {
  if (d.over || !d.clockRunning || d.clock <= 0) return false;
  d.clock = Math.max(0, d.clock - dt);
  return d.clock <= 0;
}

export function snap(d) { d.clockRunning = true; }

// Spend a timeout: only while the clock is actually running (a timeout when it's already
// stopped would be wasted).
export function useTimeout(d) {
  if (d.over || d.timeouts <= 0 || !d.clockRunning) return false;
  d.timeouts -= 1;
  d.clockRunning = false;
  return true;
}

// Field-goal odds from the kick distance: a short one is nearly automatic, a long one is a
// coin flip or worse. (A real kicking mini-game can replace this later.)
export function fieldGoalKickDistance(losYard) { return (FIELD_YARDS - losYard) + 17; }
export function fieldGoalAllowed(losYard) { return fieldGoalKickDistance(losYard) <= MAX_FIELD_GOAL_KICK; }
export function fieldGoalChance(losYard) {
  const k = fieldGoalKickDistance(losYard);
  if (k > MAX_FIELD_GOAL_KICK) return 0;
  const pts = [[20, 0.99], [30, 0.96], [40, 0.88], [50, 0.72], [56, 0.5], [62, 0.2]];
  if (k <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    if (k <= pts[i][0]) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
      return y0 + (y1 - y0) * ((k - x0) / (x1 - x0));
    }
  }
  return 0.2;
}

// ---- applying the result of a play ------------------------------------------------------------
// play.kind:
//   'complete' | 'run' | 'sack'   the ball carrier was stopped at play.endYard (yards from own goal)
//   'incomplete'                  stops the clock, costs a down
//   'spike'                       stops the clock, costs a down
//   'interception'                the drive is over
//   'touchdown'                   the drive is over, 7 points
//   'fieldGoal'                   play.made true -> 3 points; either way the drive is over
// play.outOfBounds stops the clock after a complete/run. Returns a short text for the banner.
export function applyPlay(d, play) {
  if (d.over) return '';
  d.plays += 1;
  let text = '';

  if (play.kind === 'touchdown') {
    d.over = true; d.touchdown = true; d.points = TOUCHDOWN_POINTS; d.endReason = 'touchdown';
    d.losYard = FIELD_YARDS; d.clockRunning = false;
    return 'TOUCHDOWN!';
  }
  if (play.kind === 'fieldGoal') {
    d.over = true; d.clockRunning = false;
    if (play.made) { d.fieldGoal = true; d.points = FIELD_GOAL_POINTS; d.endReason = 'field goal'; return 'FIELD GOAL IS GOOD!'; }
    d.endReason = 'missed field goal';
    return 'FIELD GOAL IS NO GOOD';
  }
  if (play.kind === 'interception') {
    d.over = true; d.clockRunning = false; d.endReason = 'interception';
    return 'INTERCEPTED!';
  }

  if (play.kind === 'incomplete' || play.kind === 'spike') {
    d.down += 1; d.clockRunning = false;
    text = play.kind === 'spike' ? 'Ball spiked — clock stopped' : 'Incomplete';
  } else { // complete | run | sack
    const newYard = clamp(play.endYard, -5, FIELD_YARDS);
    if (newYard <= 0) { d.over = true; d.clockRunning = false; d.endReason = 'safety'; d.losYard = 0; return 'SAFETY'; }
    const gain = Math.round(newYard) - Math.round(d.losYard);
    d.losYard = newYard;
    if (gain >= d.toGo) {
      d.down = 1;
      d.toGo = Math.min(10, FIELD_YARDS - newYard);
      text = 'FIRST DOWN';
    } else {
      d.down += 1;
      d.toGo -= gain;
      text = play.kind === 'sack' ? `Sacked for a loss of ${Math.abs(gain)}` : (gain >= 0 ? `Gain of ${gain}` : `Loss of ${Math.abs(gain)}`);
    }
    d.clockRunning = !play.outOfBounds;
    if (play.outOfBounds) text += ' — out of bounds';
  }

  if (d.down > 4 && !d.over) { d.over = true; d.clockRunning = false; d.endReason = 'turnover on downs'; return 'TURNOVER ON DOWNS'; }
  if (d.clock <= 0 && !d.over) { d.over = true; d.clockRunning = false; d.endReason = 'time expired'; return 'TIME EXPIRED'; }
  return text;
}

// The pre-snap clock can also run out before the ball is ever snapped.
export function expireIfOutOfTime(d) {
  if (!d.over && d.clock <= 0) { d.over = true; d.clockRunning = false; d.endReason = 'time expired'; return true; }
  return false;
}

// What the drive reports to the server when it ends.
export function driveReport(d) {
  return {
    touchdown: d.touchdown,
    fieldGoal: d.fieldGoal,
    yards: d.touchdown ? FIELD_YARDS - d.startYard : Math.max(0, Math.round(d.losYard - d.startYard)),
    timeLeft: Math.round(d.clock),
    plays: d.plays,
    endReason: d.endReason || '',
  };
}

// ---- throwing -----------------------------------------------------------------------------------
// How far the ball misses its mark (yards). A short, clean throw is nearly perfect; a long one,
// one thrown with a rusher in the QB's face, or one thrown while he's scrambling, drifts. Returns
// { mag, ang } -- the miss distance and its direction in radians.
export function throwError({ dist, pressured, moving }, rng) {
  const mag = 0.2 + 0.035 * dist + (pressured ? 0.75 : 0) + (moving ? 0.45 : 0) + rng() * 0.35;
  return { mag, ang: rng() * Math.PI * 2 };
}

// What happens when the ball arrives. err = how far it missed the receiver (yards), sep = how far
// the nearest defender is from the ball's landing spot (yards).
export function resolveThrow({ err, sep }, rng) {
  const contest = clamp((sep - 0.5) / 2.2, 0, 1); // 0 = smothered, 1 = wide open
  if (err > 2.4) {
    return rng() < (sep < 1.2 ? 0.12 : 0.02) ? 'interception' : 'incomplete';
  }
  const base = 0.95 - 0.2 * err;
  const pComplete = base * (0.3 + 0.7 * contest);
  const r = rng();
  if (r < pComplete) return 'complete';
  const pInt = (1 - contest) * (sep < 1.5 ? 0.42 : 0.08);
  return rng() < pInt ? 'interception' : 'incomplete';
}

// ---- the playbook ----------------------------------------------------------------------------------
// Four eligible receivers, labeled 1-4 from the left. Each route is a list of [dx, dz] offsets from
// where that receiver lines up (dz is negative = downfield). `rush` says how the defense attacks:
// the DL that breaks free and when (seconds after the snap), and when the linebacker blitzes.
const WR_L = { x: -11, z: 0.8 }, TE = { x: -3.8, z: 0.5 }, SLOT = { x: 6, z: 1.0 }, WR_R = { x: 11, z: 0.8 };
export const RECEIVER_SPOTS = [WR_L, TE, SLOT, WR_R];

export const PLAYBOOK = [
  { name: 'Four Verticals', routes: [[[0, -14], [2, -34]], [[0, -9], [-1, -22]], [[0, -12], [-3, -32]], [[0, -16], [-2, -36]]] },
  { name: 'Slants and Outs', routes: [[[5, -5], [9, -14]], [[4, -3], [10, -5]], [[0, -9], [8, -9]], [[0, -13], [-1, -10]]] },
  { name: 'Curls and Seams', routes: [[[0, -12], [2, -9]], [[0, -18], [0, -32]], [[0, -10], [-2, -7]], [[1, -20], [3, -34]]] },
  { name: 'Crossers', routes: [[[0, -10], [9, -10]], [[0, -9], [5, -23]], [[0, -20], [0, -34]], [[0, -10], [-9, -10]]] },
  { name: 'Posts and Corners', routes: [[[0, -12], [6, -26]], [[0, -7], [-6, -9]], [[0, -9], [-5, -22]], [[0, -14], [-6, -28]]] },
];

// Pick this play's call and its pass-rush timing from the seeded generator: the same play number
// gives the same call and the same rush to every member of the league.
export function planPlay(seed, playIndex) {
  const rng = mulberry32((seed ^ Math.imul(playIndex + 1, 2654435761)) >>> 0);
  const call = PLAYBOOK[Math.floor(rng() * PLAYBOOK.length)];
  return {
    call,
    rusherA: Math.floor(rng() * 4),
    rusherB: Math.floor(rng() * 4),
    breakA: 2.7 + rng() * 0.9,   // the first DL gets free this many seconds after the snap
    breakB: 4.4 + rng() * 0.8,   // a second one, later
    blitzAt: 1.7 + rng() * 0.5,  // the linebacker comes
    // How good each defensive back's coverage is on this play, 0 (beaten) to 1 (glued to his man),
    // so a different receiver is open from play to play: that's the "read" the QB has to make.
    cover: [rng(), rng(), rng(), rng()],
    rngSeed: Math.floor(rng() * 2_000_000_000), // seeds the throw/tackle rolls for this play
  };
}
