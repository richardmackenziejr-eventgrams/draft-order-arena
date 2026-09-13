// Kickoff Return — real-time and entirely client-simulated, unlike every
// other game on this site. The server only ever decides how hard the NEXT
// return should be (how many defenders, how fast — see currentReturn on
// the game instance) and scores whatever {yardsGained, touchdown} this
// client reports back once a return ends. Everything about the actual
// dodge — the runner, the defenders, collisions — is simulated entirely in
// the browser and trusted, the same "server sets it up, client measures
// its own outcome" split every other async game here already uses (e.g.
// Field Goal Kick trusting the client's own elapsed-time reading).
//
// Classic Tecmo Bowl style: a horizontally-scrolling field (the kickoff
// comes in from the right, the return runs right-to-left toward the goal
// on the left), no juke/spin — arrow keys only, and the only way past a
// defender is reading their dive and changing direction before it lands.
const instanceId = qs('instance');
const leagueId = qs('league');
const memberId = qs('member');
document.getElementById('back-link').href = leagueId ? `/member-home.html?league=${leagueId}` : '/';

// ---- Desktop-only gate ---------------------------------------------------
// No touch controls exist for this game yet (v1 is keyboard-only) — a
// coarse pointer (finger, not a mouse) means arrow keys almost certainly
// aren't available at all, so show a plain message instead of a canvas
// nothing can control.
if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) {
  document.getElementById('status-line').style.display = 'none';
  document.getElementById('desktop-only-panel').style.display = 'block';
  throw new Error('kickoff-return: desktop-only, coarse pointer detected');
}

// ---- Canvas / world setup -------------------------------------------------
// The canvas is landscape (the field runs horizontally): worldY (yards
// gained downfield) maps to screen X and scrolls; worldX (lateral position
// across the field's width) maps to screen Y and is fixed/inset. Forward
// progress moves toward smaller screen X (right-to-left), matching a
// kickoff return in the classic side-view orientation.
const canvas = document.getElementById('kr-canvas');
const ctx = canvas.getContext('2d');
const CANVAS_WIDTH = canvas.width;
const CANVAS_HEIGHT = canvas.height;

const FIELD_WIDTH_YARDS = 53.3;
const RUNNER_HALF_WIDTH = 0.6;
// The playing field is inset from the canvas's top/bottom edges so there's
// room to draw stadium stands there — purely cosmetic, doesn't touch
// gameplay math, since world-yard coordinates (movement, collision,
// clamping) never reference pixels at all.
const STADIUM_MARGIN_PX = 30;
const FIELD_TOP_PX = STADIUM_MARGIN_PX;
const FIELD_BOTTOM_PX = CANVAS_HEIGHT - STADIUM_MARGIN_PX;
const PX_PER_YARD_LATERAL = (FIELD_BOTTOM_PX - FIELD_TOP_PX) / FIELD_WIDTH_YARDS;
const PX_PER_YARD_FORWARD = 14;
const RUNNER_SCREEN_X = CANVAS_WIDTH * 0.68; // the runner is always drawn here; the world scrolls around it, leaving more room to the left (ahead) than the right (behind)
const START_FIELD_POSITION = 0; // worldY=0 is the player's own goal line (matches kickoffReturn.js server-side) — an authentic Tecmo-style catch right at the goal
const OWN_GOAL_WORLD_Y = 0; // same point as the start, but kept as its own name for the yard-stripe clamp below (nothing renderable exists behind it)

// How deep (in screen pixels, back from the goal line) the end-zone-plus-
// stadium backdrop actually extends — see drawField()'s end zone blocks.
// Not to real yardage scale; this exists purely so the camera clamp below
// knows exactly where the drawn world runs out.
const EZ_DEPTH_PX = 130; // was 55 -- real Tecmo Super Bowl's end zone is a substantial chunk of the screen, not a thin sliver
const STADIUM_CROWD_DEPTH_PX = 140; // the flat crowd band behind the far end zone -- see drawCrowdBand()
const BACKDROP_DEPTH_PX = EZ_DEPTH_PX + STADIUM_CROWD_DEPTH_PX;
const GOALPOST_DEPTH_PX = 105; // screen-space depth into the end zone (in front of the stadium deck), not world yards -- was 36, sitting right next to the returner at the start; real Tecmo Super Bowl's goalpost stands at the BACK of the end zone, right up against the stands

// worldY is always "yards gained from the return's start," but a real
// field's painted numbers count up from EITHER goal line to midfield (50)
// and back down — not a raw distance-traveled odometer. Convert once here
// so the yard-line labels read like an actual broadcast field.
function fieldPositionLabel(worldY) {
  const fieldPos = START_FIELD_POSITION + worldY;
  if (fieldPos >= 100 || fieldPos <= 0) return 'GOAL';
  return String(Math.round(fieldPos <= 50 ? fieldPos : 100 - fieldPos));
}

function screenYLateral(worldX) {
  return CANVAS_HEIGHT / 2 + worldX * PX_PER_YARD_LATERAL;
}
// The camera follows the runner, but only up to the point where the back
// of the drawn stadium would already be in view at the left edge of the
// canvas — past that it holds still (the runner keeps closing on a now
// screen-fixed goal line) instead of continuing to scroll the world and
// exposing empty canvas beyond whatever's actually drawn back there.
function cameraMaxWorldY() {
  return fieldYards + (BACKDROP_DEPTH_PX - RUNNER_SCREEN_X) / PX_PER_YARD_FORWARD;
}
// When set, the camera ignores the runner entirely and follows this value
// instead — used only during the kickoff intro (see playCatchAnimation()),
// so it can pan across the field from the kicking team to the returner
// without moving the runner's own (still-waiting) sprite. Every draw
// function already goes through screenXForward()/cameraWorldY(), so
// setting this is the only change needed to redirect the whole scene.
let cameraOverride = null;
function cameraWorldY() {
  if (cameraOverride != null) return cameraOverride;
  return Math.min(runner.worldY, cameraMaxWorldY());
}
function screenXForward(worldY) {
  return RUNNER_SCREEN_X - (worldY - cameraWorldY()) * PX_PER_YARD_FORWARD;
}
function clampNum(x, min, max) {
  return Math.max(min, Math.min(max, x));
}

// ---- Tunable constants -----------------------------------------------------
const RUNNER_FORWARD_SPEED = 9; // yards/sec at full forward speed
const RUNNER_BACKWARD_SPEED = 4; // yards/sec if backpedaling
const RUNNER_LATERAL_SPEED = 7; // yards/sec, plain directional movement

const DEFENDER_BASE_SPEED = 7.5; // yards/sec pursuit at a defenderSpeed multiplier of 1.0
const DEFENDER_TRIGGER_DISTANCE = 6; // yards — closing to this range starts a defender's wind-up
const DEFENDER_BASE_WINDUP_MS = 550; // the visible telegraph window at defenderSpeed 1.0
const DEFENDER_MIN_WINDUP_MS = 280; // floor — higher difficulty shortens this but never past this, so it's always reactable
const DEFENDER_WINDUP_SHRINK_PER_SPEED = 220; // ms shaved off per +1.0x of defenderSpeed above 1.0
const DEFENDER_LUNGE_MS = 260;
const DEFENDER_LUNGE_LATERAL_LEAD = 1.3; // how far to the committed side the lunge aims, on top of closing the gap
const TACKLE_RADIUS = 1.1; // yards — collision distance during a lunge
const DEFENDER_RECOVER_MS = 550;

const RESULT_HOLD_MS = 1400;

// Formation depths below are taken from the NFL's current kickoff setup
// (own goal line = worldY 0, same axis our field already uses):
//   - Kicker: kicking team's own 35 -> 65 yards from the receiving goal.
//   - The other 10 kicking-team players: receiving team's 40 -> worldY 40.
//   - Receiving team's blockers: a 5-yard "setup zone" between the
//     receiving team's 30 and 35 -> worldY 30-35.
// (Sources: FanDuel Research / NFL.com's explainers on the 2024 "dynamic
// kickoff" rule.) The one deliberate deviation from the real rule is where
// the RETURNER stands — real kickoffs are caught anywhere in the 0-20
// "landing zone" (usually resulting in a touchback to the 30), but this
// game catches every kickoff right at the goal line by design, for a
// longer, more Tecmo-authentic return.

// Return-team blockers — 10 of them (plus the runner makes 11), arranged in
// two waves within the real 30-35 setup zone. Each blocker runs its own
// simple escort AI (the "Seek"/"Arrive" behaviors from Craig Reynolds'
// "Steering Behaviors For Autonomous Characters," the standard reference
// for exactly this move-to-intercept-or-guard pattern — see
// https://www.red3d.com/cwr/papers/1999/gdc99steer.pdf): every frame, an
// unengaged blocker either (a) seeks the single nearest live defender to
// go meet and hold up, in ANY direction including backward — a defender
// that's slipped behind the returner still has to be met head on — or (b)
// if nothing needs blocking right now, advances to a guard position just
// ahead of the returner, moving only FORWARD (the returner's own direction
// of travel), ready for the next threat. A block holds for a randomized
// duration (see updateDefenders()'s blocking check for how that produces
// an actual, visible, in-place battle, not an abstract timer) and then
// both are released — the blocker isn't spent, it just goes right back to
// seeking or escorting, so the same blocker can pick up a second defender
// later in the return if it's the one that gets there first.
const BLOCKER_LATERAL_SLOTS = [-20, -10, 0, 10, 20]; // 5 lanes across the field's width
const BLOCKER_WAVE1_FORWARD = 35; // the setup zone's near edge (closer to the coverage team)
const BLOCKER_WAVE2_FORWARD = 31; // the setup zone's far edge (closer to the returner)
const BLOCKER_WAVE2_LATERAL_SHIFT = 5; // offsets wave 2's lanes from wave 1's, so it's not a rigid grid
const BLOCKER_SEEK_SPEED = 8.5; // yards/sec while actively closing on a defender to block
const BLOCKER_ESCORT_SPEED = 6; // yards/sec while repositioning to the guard lead with no threat nearby
const BLOCKER_GUARD_LEAD_YARDS = 9; // how far ahead of the runner an unassigned blocker tries to stay
const BLOCKER_MAX_CHASE_DISTANCE = 40; // give up a chase and fall back to escorting if it strays this far from the runner
const BLOCKER_RELEVANCE_MARGIN = 4; // yards -- a defender this far behind the runner has already been passed; not worth a blocker abandoning the escort to keep fighting it
const BLOCK_ENGAGE_DISTANCE = 3.5; // yards — how close a blocker needs to get to a live defender to hold it up

// Coverage (kicking) team — 10 defenders plus a trailing kicker makes 11.
// All spawn at once at the snap (no lazy proximity spawning — "the kickoff
// team doesn't start running until the ball is kicked" just falls out of
// updateDefenders() only ever being called once runner.state is 'running').
// Of the 10, only defenderCount (the server's difficulty-scaled value)
// ever actually become tackle threats — the rest are harmless filler,
// exactly like the extra players a real coverage unit carries beyond
// whoever actually gets to the ball carrier.
const COVERAGE_TEAM_SIZE = 10;
const COVERAGE_SPAWN_WORLDY = 50; // was 40 -- with jitter, that left as little as ~1.4 yards between the nearest defender and the nearest blocker (35.6), so the two formations could spawn visibly overlapping before the ball was even kicked. 50 keeps real clearance between the wedge (31-35) and the coverage line even at the jitter extremes.
const COVERAGE_SPAWN_SPREAD = 3; // +/- jitter on the shared starting depth — a real column running down together, not staggered front-to-back
const KICKER_SPAWN_WORLDY = 65; // kicking team's own 35
const KICKER_SPEED = 4.5; // yards/sec, never blocked
const KICKER_LATERAL_TRACK_SPEED = 3; // yards/sec -- a lazy drift toward the returner's lane while jogging/winding, so he visibly angles in rather than jogging in a straight line regardless of where you are
const KICKER_TRIGGER_DISTANCE = 5; // yards -- tighter than a real defender's; the kicker isn't hunting, only reacts if the runner comes right at him
const KICKER_WINDUP_MS = 700; // slow to react -- a genuine last resort, not a real tackler
const KICKER_LUNGE_MS = 300;
const KICKER_RECOVER_MS = 700;
const PASSIVE_DEFENDER_SPEED = 6; // yards/sec — a simple straight jog for coverage players that were never a real threat, once they get past the wedge
const BLOCK_MIN_MS = 550;
const BLOCK_RANDOM_MS = 700; // a blocker's FIRST hold is BLOCK_MIN_MS + random() * BLOCK_RANDOM_MS, then divided by defenderSpeed so higher difficulty also sheds blocks faster — a quick individual holdup, not a sustained multi-second scrum (real footage shows scattered, fast 1-on-1 blocks resolving in about a second, not one long line-wide battle). Shortened from 800-2000ms per direction to raise the pace defenders break free and come after the returner -- the wedge was holding too long and the game played too easy.
const REBLOCK_MIN_MS = 150;
const REBLOCK_RANDOM_MS = 200; // a blocker that's already made its one full block can still step in front of a later defender, but only for a brief, glancing hold -- it already spent its best effort on the first one
const BLOCK_COOLDOWN_MS = 500; // grace period after a defender is released before ANY blocker (including the one that just held it) can engage it again -- without this, a freshly-released defender sitting right next to its blocker gets re-engaged the very next frame, which looks exactly like both of them frozen in place
const BLOCKED_SLIDE_TACKLE_RANGE = 11; // yards -- how close the returner has to run past a restrained defender to draw a swipe. Was 6 (barely more than a normal defender's own 6-yard trigger, despite this one being a restrained, shorter-reach swipe) and, worse, less than NEARBY_BREAK_RANGE -- so the fast-release fix usually ended the block before a swipe even got a chance to start. Wider than NEARBY_BREAK_RANGE now on purpose, so the swipe reliably gets first crack once the returner's in the area.
const BLOCKED_SLIDE_TACKLE_WINDUP_MS = 200; // blind (no glow, like every other lunge now) but not instant -- a fast enough direction change still beats it
const BLOCKED_SLIDE_TACKLE_LUNGE_MS = 220; // the actual physical slide toward the returner -- this IS the visible "a defender is sliding into me" cue the wind-up alone can't give
const BLOCKED_SLIDE_TACKLE_COOLDOWN_MS = 350; // after a miss, before this defender can try again
const NEARBY_BREAK_RANGE = 8; // yards -- once the returner is this close, a blocked defender fights to break free right away instead of riding out its full randomly-rolled hold
const NEARBY_BREAK_MS = 200; // the shortened hold once that happens -- still divided by defenderSpeed like the normal hold, so higher difficulty breaks even faster

// ---- Game state -------------------------------------------------------------
let returnsPerPlayer = 5;
let fieldYards = 100;
let currentReturnConfig = null; // {index, defenderCount, defenderSpeed}

const runner = {
  worldX: 0,
  worldY: 0,
  lateralDir: 'none', // 'up' | 'down' | 'none' — whichever lateral arrow is CURRENTLY held
  lastLateralDir: null,
  state: 'idle', // 'idle' | 'catching' | 'running' | 'tackled' | 'touchdown'
  vx: 0, vy: 0, // yards/sec, last frame's actual velocity — used to lead a defender's lunge target
  facingLeft: true, // which way the side-profile sprite is drawn — see drawPlayerSprite()
};

let defenders = [];
let blockers = [];
let kicker = { worldX: 0, worldY: 0, number: 3 };
let animationHandle = null;
let lastFrameAt = 0;

// ---- Input ------------------------------------------------------------------
// Left/Right drive forward/backward (the direction of travel on screen);
// Up/Down dodge laterally across the field's width — matching the original
// Tecmo Bowl's side-view control scheme.
const heldKeys = new Set();
const ARROW_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
window.addEventListener('keydown', (e) => {
  if (ARROW_KEYS.has(e.key)) e.preventDefault(); // stop the page itself from scrolling
  heldKeys.add(e.key);
});
window.addEventListener('keyup', (e) => {
  heldKeys.delete(e.key);
});

// The runner's lateral side right now, for defender tackle-matchup
// purposes — just their held direction; there's no juke/spin burst to
// override it with.
function currentRunnerSide() {
  return runner.lateralDir;
}

// ---- Runner movement ----------------------------------------------------
function updateRunner(dtSec) {
  const forward = heldKeys.has('ArrowLeft');
  const backward = heldKeys.has('ArrowRight');
  const up = heldKeys.has('ArrowUp');
  const down = heldKeys.has('ArrowDown');

  let vy = 0; // forward-axis intent: +1 forward (toward the opponent's goal), -1 backward
  let vx = 0; // lateral-axis intent
  if (forward && !backward) vy = 1;
  else if (backward && !forward) vy = -1;
  if (down && !up) vx = 1;
  else if (up && !down) vx = -1;

  // Normalize so a diagonal isn't faster than a single direction.
  const mag = Math.hypot(vx, vy);
  if (mag > 0) { vx /= mag; vy /= mag; }

  const forwardSpeed = vy >= 0 ? RUNNER_FORWARD_SPEED : RUNNER_BACKWARD_SPEED;
  const worldYVelocity = vy * forwardSpeed;
  runner.worldY = clampNum(runner.worldY + worldYVelocity * dtSec, 0, fieldYards);

  const worldXVelocity = vx * RUNNER_LATERAL_SPEED;
  runner.worldX += worldXVelocity * dtSec;
  const halfField = FIELD_WIDTH_YARDS / 2 - RUNNER_HALF_WIDTH;
  runner.worldX = clampNum(runner.worldX, -halfField, halfField);

  // Kept around so a defender starting a lunge can aim at where the runner
  // is headed rather than only where they are right now — see the "lunging"
  // targeting comment in updateDefenders() for why this matters.
  runner.vx = worldXVelocity;
  runner.vy = worldYVelocity;
  // Face the direction actually being run (forward = left on screen); hold
  // the last facing during a pure lateral dodge with no forward/back input.
  if (worldYVelocity > 0.05) runner.facingLeft = true;
  else if (worldYVelocity < -0.05) runner.facingLeft = false;

  if (up && !down) { runner.lateralDir = 'up'; runner.lastLateralDir = 'up'; }
  else if (down && !up) { runner.lateralDir = 'down'; runner.lastLateralDir = 'down'; }
  else runner.lateralDir = 'none';

  if (runner.worldY >= fieldYards) {
    runner.state = 'touchdown';
  }
}

// Builds the 10-player blocker wedge (two waves of 5) at the real setup-
// zone depth — called once at the start of a return. See updateBlockers()
// for how they move afterward (Seek a live threat, or Arrive at a guard
// position ahead of the returner).
function makeBlockers() {
  const list = [];
  BLOCKER_LATERAL_SLOTS.forEach((lateral, i) => {
    list.push({
      worldX: runner.worldX + lateral,
      worldY: runner.worldY + BLOCKER_WAVE1_FORWARD + (i % 2 === 0 ? 0.6 : -0.6),
      number: 30 + i,
      hasBlocked: false, // flips true the first time it holds up a defender -- it can still block again later, just more briefly (see REBLOCK_MIN_MS/REBLOCK_RANDOM_MS)
      facingLeft: true,
    });
  });
  BLOCKER_LATERAL_SLOTS.forEach((lateral, i) => {
    list.push({
      worldX: runner.worldX + lateral + BLOCKER_WAVE2_LATERAL_SHIFT,
      worldY: runner.worldY + BLOCKER_WAVE2_FORWARD + (i % 2 === 0 ? -0.6 : 0.6),
      number: 40 + i,
      hasBlocked: false,
      facingLeft: true,
    });
  });
  return list;
}

// The single nearest defender that isn't already someone else's block in
// progress — a blocker's target for the "Seek" behavior below.
function nearestUnblockedDefender(b) {
  let best = null;
  let bestDist = Infinity;
  for (const d of defenders) {
    if (d.state === 'blocked') continue; // already being held by another blocker
    // Already behind the runner -- the play has moved past this one, so
    // chasing it back down just strands a blocker fighting a stale threat
    // instead of running with the returner. Without this, a blocker and a
    // leftover defender can keep re-engaging each other in the same spot
    // indefinitely (release -> immediately back in block range -> blocked
    // again), which looks like both of them just standing still forever,
    // while the wedge never advances to stay with the runner.
    if (d.worldY < runner.worldY - BLOCKER_RELEVANCE_MARGIN) continue;
    const dist = Math.hypot(d.worldX - b.worldX, d.worldY - b.worldY);
    if (dist < bestDist) { bestDist = dist; best = d; }
  }
  return best;
}

function updateBlockers(dtSec) {
  for (const b of blockers) {
    // While actively holding a defender, a blocker doesn't move at all —
    // that IS the block, the two of them battling in place until it ends.
    const isEngaged = defenders.some((d) => d.state === 'blocked' && d.blockedByBlocker === b);
    if (isEngaged) continue;

    // A blocker that's already made one block can still pick up another
    // later in the return (nearestUnblockedDefender doesn't care about
    // hasBlocked) -- it just holds it more briefly the second time, since
    // it already spent its best effort on the first one. See updateDefenders()
    // for where that shorter REBLOCK_* duration actually gets applied.
    const target = nearestUnblockedDefender(b);
    const distFromRunner = Math.hypot(b.worldX - runner.worldX, b.worldY - runner.worldY);
    if (target && distFromRunner < BLOCKER_MAX_CHASE_DISTANCE) {
      // Seek: seek the nearest live threat directly, in any direction —
      // this is the one case a blocker moves backward, since a defender
      // that's slipped behind the returner still has to be met head-on.
      const dx = target.worldX - b.worldX;
      const dy = target.worldY - b.worldY;
      const dist = Math.hypot(dx, dy);
      if (dist > 0.01) {
        b.worldX += (dx / dist) * BLOCKER_SEEK_SPEED * dtSec;
        b.worldY += (dy / dist) * BLOCKER_SEEK_SPEED * dtSec;
        if (Math.abs(dy) > 0.01) b.facingLeft = dy > 0;
      }
    } else {
      // Nothing worth chasing right now (or the chase strayed too far) —
      // hold an escort position just ahead of the returner instead, moving
      // only FORWARD (their own direction of travel), never back toward
      // their own goal.
      const guardWorldY = runner.worldY + BLOCKER_GUARD_LEAD_YARDS;
      if (b.worldY < guardWorldY) {
        b.worldY = Math.min(guardWorldY, b.worldY + BLOCKER_ESCORT_SPEED * dtSec);
      }
      const lateralDx = clampNum(runner.worldX - b.worldX, -1, 1);
      b.worldX += lateralDx * BLOCKER_ESCORT_SPEED * 0.5 * dtSec;
      b.facingLeft = true; // escorting is always a forward move
    }
  }
}

// ---- Defenders --------------------------------------------------------------
function windupMsFor(defenderSpeed) {
  const extra = Math.max(0, defenderSpeed - 1) * DEFENDER_WINDUP_SHRINK_PER_SPEED;
  return Math.max(DEFENDER_MIN_WINDUP_MS, DEFENDER_BASE_WINDUP_MS - extra);
}

// Builds the full 10-player coverage line (plus the trailing kicker set
// separately) at the runner's current position — called once at the start
// of a return. `activeCount` of the 10 are real tackle threats (the
// server's difficulty-scaled defenderCount); the rest are harmless filler
// that still run the field but can never wind up or lunge. All 10 start
// 'blocked' — see updateDefenders() — so none of them move at all until
// they individually shed that block at a staggered time.
function makeCoverageTeam(activeCount) {
  const positions = [];
  for (let i = 0; i < COVERAGE_TEAM_SIZE; i++) {
    positions.push({
      // Spread across the field's width (real coverage lines up in
      // multiple lanes, not single-file), but tight in DEPTH — all ten
      // start at roughly the same yard line, a real column running down
      // the field together rather than staggered front-to-back. Tightening
      // the lateral spread too (tried once) collapsed every blocker's
      // "nearest defender" onto the same tiny spot, since blockers seek
      // whichever coverage player is closest — with coverage clustered in
      // one place, that's always the same place, and the whole formation
      // collapses into a single clump instead of the several separate
      // battles scattered across the field the reference footage shows.
      worldX: runner.worldX + (i - (COVERAGE_TEAM_SIZE - 1) / 2) * (FIELD_WIDTH_YARDS / COVERAGE_TEAM_SIZE) + (Math.random() * 2 - 1) * 1.5,
      worldY: runner.worldY + COVERAGE_SPAWN_WORLDY + (Math.random() * 2 - 1) * COVERAGE_SPAWN_SPREAD,
    });
  }
  // Randomize which indices are "active" so it's not always the same lanes.
  const shuffledIdx = positions.map((_, i) => i).sort(() => Math.random() - 0.5);
  const activeSet = new Set(shuffledIdx.slice(0, activeCount));

  return positions.map((p, i) => ({
    worldX: p.worldX,
    worldY: p.worldY,
    number: 50 + i,
    active: activeSet.has(i),
    facingLeft: false, // spawns ahead of the runner and starts by closing the gap, i.e. moving right
    // approaching -> blocked (on contact with an available blocker) ->
    // approaching again -> windingUp -> lunging -> recovering (active only;
    // passive just jogs once it's past the wedge, whether or not it was
    // ever actually held up by one).
    state: 'approaching',
    blockedUntil: 0,
    blockedByBlocker: null,
    blockImmuneUntil: 0, // brief grace period after release before anyone can engage this defender again
    slideTackleState: null, // null | 'winding' | 'lunging' -- a short, independent swipe attempt while still 'blocked', see updateDefenders()
    slideTackleWindupAt: 0,
    slideTackleCommittedSide: null,
    slideTackleLungeStartedAt: 0,
    slideTackleStartX: 0, slideTackleStartY: 0,
    slideTackleTargetX: 0, slideTackleTargetY: 0,
    slideTackleBaseX: 0, slideTackleBaseY: 0, // snapped back to on a miss -- still held, not actually freed
    nextSlideTackleAt: 0,
    committedSide: null,
    windupStartedAt: 0,
    lungeStartedAt: 0,
    lungeStartX: 0, lungeStartY: 0,
    lungeTargetX: 0, lungeTargetY: 0,
    recoverStartedAt: 0,
  }));
}

function makeKicker() {
  return {
    worldX: runner.worldX,
    worldY: runner.worldY + KICKER_SPAWN_WORLDY,
    number: 3,
    state: 'jogging', // 'jogging' | 'windingUp' | 'lunging' | 'recovering'
    committedSide: null,
    windupStartedAt: 0,
    lungeStartedAt: 0,
    lungeStartX: 0, lungeStartY: 0,
    lungeTargetX: 0, lungeTargetY: 0,
    recoverStartedAt: 0,
  };
}

function updateDefenders(dtSec) {
  const now = performance.now();

  for (const d of defenders) {
    if (d.state === 'blocked') {
      // Even physically restrained, an active defender can still take one
      // quick swipe at the returner if they run close enough past -- per
      // direction, "just run around the pile" was too safe. This runs
      // entirely independently of the release timer below (the blocker
      // never learns about it -- it's a reach, not an escape) and can end
      // the return on its own. Unlike the earlier version, the swipe
      // actually SLIDES the defender's position toward the returner during
      // the lunge phase -- a static "invisible" hit-check was confusing
      // (no visible defender anywhere near you when you got tackled); this
      // is the same visible-motion cue a normal defender's own lunge gives.
      if (d.active) {
        if (d.slideTackleState === 'winding') {
          if (now - d.slideTackleWindupAt >= BLOCKED_SLIDE_TACKLE_WINDUP_MS) {
            d.slideTackleState = 'lunging';
            d.slideTackleLungeStartedAt = now;
            d.slideTackleStartX = d.worldX;
            d.slideTackleStartY = d.worldY;
            d.slideTackleBaseX = d.worldX;
            d.slideTackleBaseY = d.worldY;
            const leadSec = BLOCKED_SLIDE_TACKLE_LUNGE_MS / 1000;
            d.slideTackleTargetX = runner.worldX + runner.vx * leadSec;
            d.slideTackleTargetY = runner.worldY + runner.vy * leadSec;
          }
        } else if (d.slideTackleState === 'lunging') {
          const t = Math.min(1, (now - d.slideTackleLungeStartedAt) / BLOCKED_SLIDE_TACKLE_LUNGE_MS);
          d.worldX = d.slideTackleStartX + (d.slideTackleTargetX - d.slideTackleStartX) * t;
          d.worldY = d.slideTackleStartY + (d.slideTackleTargetY - d.slideTackleStartY) * t;
          const dist = Math.hypot(runner.worldX - d.worldX, runner.worldY - d.worldY);
          if (dist <= TACKLE_RADIUS) {
            const runnerSide = currentRunnerSide();
            const hit = d.slideTackleCommittedSide === 'direct' || d.slideTackleCommittedSide === runnerSide;
            if (hit) {
              runner.state = 'tackled';
              return; // the return is over — no need to keep updating anything else this frame
            }
            d.worldX = d.slideTackleBaseX; // recoils back into the hold, still just "blocked" -- this was a swipe, not an escape
            d.worldY = d.slideTackleBaseY;
            d.slideTackleState = null;
            d.nextSlideTackleAt = now + BLOCKED_SLIDE_TACKLE_COOLDOWN_MS;
          } else if (t >= 1) {
            d.worldX = d.slideTackleBaseX;
            d.worldY = d.slideTackleBaseY;
            d.slideTackleState = null;
            d.nextSlideTackleAt = now + BLOCKED_SLIDE_TACKLE_COOLDOWN_MS;
          }
        } else if (now >= d.nextSlideTackleAt) {
          const dist = Math.hypot(runner.worldX - d.worldX, runner.worldY - d.worldY);
          if (dist <= BLOCKED_SLIDE_TACKLE_RANGE) {
            d.slideTackleState = 'winding';
            d.slideTackleWindupAt = now;
            const side = currentRunnerSide();
            d.slideTackleCommittedSide = side === 'none' ? 'direct' : side;
          }
        }
      }

      // Fight harder to get free the instant the ball carrier is actually
      // right there -- without this, a defender just sits out its randomly
      // rolled hold time regardless of whether the runner is passing by
      // this exact moment or is nowhere close yet, which is how a return
      // could run straight through a whole cluster of blockers/defenders
      // without a single one caring. This only ever pulls the release time
      // EARLIER (never later), and re-checks every frame, so a defender
      // already blocked when the runner arrives breaks free almost as fast
      // as one that only just got engaged. Skipped while a swipe is already
      // winding up or lunging -- otherwise this and the swipe race each
      // other (both resolve in a couple hundred ms), and the release almost
      // always won, ending the block before the swipe ever got to finish.
      if (!d.slideTackleState && Math.hypot(runner.worldX - d.worldX, runner.worldY - d.worldY) <= NEARBY_BREAK_RANGE) {
        d.blockedUntil = Math.min(d.blockedUntil, now + NEARBY_BREAK_MS / currentReturnConfig.defenderSpeed);
      }

      // Actually held up by the specific blocker it ran into — released
      // after a randomized duration (or the shortened one above, if the
      // runner's in the area). The blocker isn't spent: it can pick up
      // another defender later (updateBlockers() sends it right back to
      // seeking/escorting), just for a shorter REBLOCK_* hold next time,
      // since it already gave its best effort on the first one. Each
      // engagement happening at a different moment as defenders reach the
      // wedge at different times is the whole "get by them and converge on
      // the returner at different times" effect — no extra logic needed
      // beyond the collision check below and this timer.
      if (now >= d.blockedUntil) {
        d.blockedByBlocker = null;
        d.state = 'approaching';
        // A short window where NOTHING can re-engage this defender, even
        // the blocker that just released it. Without this, a freshly-freed
        // defender is usually still standing right on top of its blocker
        // (well within BLOCK_ENGAGE_DISTANCE) and gets grabbed again on the
        // very next frame — which looks exactly like both of them frozen
        // in place, forever, instead of the defender actually breaking away.
        d.blockImmuneUntil = now + BLOCK_COOLDOWN_MS;
        d.slideTackleState = null; // breaking free outright supersedes any swipe in progress
      }
      continue;
    }

    // Get held up by the first available blocker within range — checked
    // for every defender (active or passive), since blocking is physical
    // and doesn't care whether this particular defender was ever going to
    // be a real threat. "Available" means not already holding someone else
    // and not within this defender's own post-release cooldown.
    if (now >= d.blockImmuneUntil) {
      const blocker = blockers.find((b) => {
        const alreadyEngaged = defenders.some((other) => other !== d && other.state === 'blocked' && other.blockedByBlocker === b);
        return !alreadyEngaged && Math.hypot(d.worldX - b.worldX, d.worldY - b.worldY) <= BLOCK_ENGAGE_DISTANCE;
      });
      if (blocker) {
        d.state = 'blocked';
        d.blockedByBlocker = blocker;
        const [minMs, randomMs] = blocker.hasBlocked ? [REBLOCK_MIN_MS, REBLOCK_RANDOM_MS] : [BLOCK_MIN_MS, BLOCK_RANDOM_MS];
        d.blockedUntil = now + (minMs + Math.random() * randomMs) / currentReturnConfig.defenderSpeed;
        blocker.hasBlocked = true;
        continue;
      }
    }

    if (!d.active) {
      // Shed the block but was never a real threat — a simple straight
      // jog downfield in its own lane, visual filler only.
      d.worldY = Math.max(0, d.worldY - PASSIVE_DEFENDER_SPEED * currentReturnConfig.defenderSpeed * dtSec);
      d.facingLeft = false; // always jogging toward smaller worldY, i.e. right
      continue;
    }
    if (d.state === 'approaching') {
      const dx = runner.worldX - d.worldX;
      const dy = runner.worldY - d.worldY;
      const dist = Math.hypot(dx, dy);
      if (dist > 0.01) {
        const speed = DEFENDER_BASE_SPEED * currentReturnConfig.defenderSpeed;
        d.worldX += (dx / dist) * speed * dtSec;
        d.worldY += (dy / dist) * speed * dtSec;
        if (Math.abs(dy) > 0.01) d.facingLeft = dy > 0;
      }
      if (dist <= DEFENDER_TRIGGER_DISTANCE) {
        d.state = 'windingUp';
        d.windupStartedAt = now;
        // The commit: snapshot the runner's CURRENT side right now. This is
        // frozen from here on regardless of what the runner does next — a
        // late direction change is exactly what's supposed to beat it.
        const side = currentRunnerSide();
        d.committedSide = side === 'none' ? 'direct' : side;
      }
    } else if (d.state === 'windingUp') {
      if (now - d.windupStartedAt >= windupMsFor(currentReturnConfig.defenderSpeed)) {
        d.state = 'lunging';
        d.lungeStartedAt = now;
        d.lungeStartX = d.worldX;
        d.lungeStartY = d.worldY;
        const lateralLead = d.committedSide === 'up' ? -DEFENDER_LUNGE_LATERAL_LEAD
          : d.committedSide === 'down' ? DEFENDER_LUNGE_LATERAL_LEAD : 0;
        // Aim not at where the runner IS right now but at where they'll BE
        // once the lunge's flight time (DEFENDER_LUNGE_MS) has elapsed,
        // projecting forward from their current velocity — a runner just
        // running straight is genuinely catchable this way; without this
        // lead, a defender's fixed-line dive always undershoots because the
        // runner keeps moving during the lunge's own flight time, and a
        // "correct read" would whiff regardless of committedSide. This is
        // still a "fixed line" lunge in the sense the plan means: it's
        // computed once here and never re-tracked during the flight itself,
        // so a late direction change (which changes the runner's ACTUAL
        // velocity after this point) still beats it via the committedSide
        // mismatch check below, even though the predicted spot was
        // accurate for a runner who didn't change direction.
        const leadSec = DEFENDER_LUNGE_MS / 1000;
        d.lungeTargetX = runner.worldX + runner.vx * leadSec + lateralLead;
        d.lungeTargetY = runner.worldY + runner.vy * leadSec;
        // Face the direction of the dive itself, not whatever was left over
        // from the chase beforehand -- the lunge can head a different way
        // than the approach did (e.g. a lateral lead on a runner who's
        // barely moving forward), and a sprite diving one way while facing
        // another reads as broken/backwards.
        if (Math.abs(d.lungeTargetY - d.lungeStartY) > 0.01) d.facingLeft = d.lungeTargetY > d.lungeStartY;
      }
    } else if (d.state === 'lunging') {
      const t = Math.min(1, (now - d.lungeStartedAt) / DEFENDER_LUNGE_MS);
      d.worldX = d.lungeStartX + (d.lungeTargetX - d.lungeStartX) * t;
      d.worldY = d.lungeStartY + (d.lungeTargetY - d.lungeStartY) * t;

      const dist = Math.hypot(runner.worldX - d.worldX, runner.worldY - d.worldY);
      if (dist <= TACKLE_RADIUS) {
        const runnerSide = currentRunnerSide();
        const hit = d.committedSide === 'direct' || d.committedSide === runnerSide;
        if (hit) {
          runner.state = 'tackled';
          return; // the return is over — no need to keep updating anything else this frame
        }
        d.state = 'recovering';
        d.recoverStartedAt = now;
      } else if (t >= 1) {
        d.state = 'recovering';
        d.recoverStartedAt = now;
      }
    } else if (d.state === 'recovering') {
      // Spent — becomes harmless filler for the rest of the play (the
      // 11-player roster stays visible the whole return, matching a real
      // kickoff coverage unit; a defender who's already dived doesn't just
      // vanish, they're just no longer a threat this return).
      if (now - d.recoverStartedAt >= DEFENDER_RECOVER_MS) {
        d.active = false;
      }
    }
  }

  // The kicker trails the whole play at a slow jog and never engages the
  // wedge (never blocks, never gets blocked) -- but per direction, they
  // shouldn't look totally oblivious if the returner actually runs right at
  // them. A real kicker's job ends the instant the ball leaves their foot,
  // so this mirrors a defender's own windingUp -> lunging pipeline but
  // tuned deliberately weak: a longer wind-up and a tight trigger range, a
  // genuine last-resort attempt easily beaten rather than a real threat.
  if (kicker.state === 'windingUp') {
    // Lean toward the returner's lane while winding up, same as jogging —
    // otherwise he visibly commits to a tackle attempt while still facing
    // whatever direction he happened to be jogging in.
    const lateralDx = clampNum(runner.worldX - kicker.worldX, -1, 1);
    kicker.worldX += lateralDx * KICKER_LATERAL_TRACK_SPEED * dtSec;
    if (now - kicker.windupStartedAt >= KICKER_WINDUP_MS) {
      kicker.state = 'lunging';
      kicker.lungeStartedAt = now;
      kicker.lungeStartX = kicker.worldX;
      kicker.lungeStartY = kicker.worldY;
      const leadSec = KICKER_LUNGE_MS / 1000;
      kicker.lungeTargetX = runner.worldX + runner.vx * leadSec;
      kicker.lungeTargetY = runner.worldY + runner.vy * leadSec;
    }
  } else if (kicker.state === 'lunging') {
    const t = Math.min(1, (now - kicker.lungeStartedAt) / KICKER_LUNGE_MS);
    kicker.worldX = kicker.lungeStartX + (kicker.lungeTargetX - kicker.lungeStartX) * t;
    kicker.worldY = kicker.lungeStartY + (kicker.lungeTargetY - kicker.lungeStartY) * t;
    const dist = Math.hypot(runner.worldX - kicker.worldX, runner.worldY - kicker.worldY);
    if (dist <= TACKLE_RADIUS) {
      const runnerSide = currentRunnerSide();
      const hit = kicker.committedSide === 'direct' || kicker.committedSide === runnerSide;
      if (hit) {
        runner.state = 'tackled';
        return; // the return is over — no need to keep updating anything else this frame
      }
      kicker.state = 'recovering';
      kicker.recoverStartedAt = now;
    } else if (t >= 1) {
      kicker.state = 'recovering';
      kicker.recoverStartedAt = now;
    }
  } else if (kicker.state === 'recovering') {
    kicker.worldY = Math.max(0, kicker.worldY - KICKER_SPEED * 0.4 * dtSec); // still trailing, slower while picking himself back up
    if (now - kicker.recoverStartedAt >= KICKER_RECOVER_MS) kicker.state = 'jogging';
  } else {
    kicker.worldY = Math.max(0, kicker.worldY - KICKER_SPEED * dtSec);
    // A lazy angle-in toward the returner's current lane -- not a real
    // chase (KICKER_LATERAL_TRACK_SPEED is much slower than any real
    // pursuit speed), just enough that he doesn't look oblivious jogging
    // past in a dead-straight line regardless of where the returner is.
    const jogLateralDx = clampNum(runner.worldX - kicker.worldX, -1, 1);
    kicker.worldX += jogLateralDx * KICKER_LATERAL_TRACK_SPEED * dtSec;
    const dist = Math.hypot(runner.worldX - kicker.worldX, runner.worldY - kicker.worldY);
    if (dist <= KICKER_TRIGGER_DISTANCE) {
      kicker.state = 'windingUp';
      kicker.windupStartedAt = now;
      const side = currentRunnerSide();
      kicker.committedSide = side === 'none' ? 'direct' : side;
    }
  }
}

// ---- Rendering ----------------------------------------------------------
const SPRITE_SCALE = 1.35; // players read small next to real Tecmo Super Bowl sprites -- scale the whole figure up uniformly rather than re-deriving every coordinate below
// A shared sprite drawn for the runner, every defender, and every blocker —
// a classic Tecmo-style SIDE-PROFILE runner (not facing the camera), so two
// players standing near each other read as two distinct silhouettes rather
// than one flat front-on blob hiding whatever's directly behind it. Always
// authored facing left (running toward the goal, the play's usual forward
// direction) and mirrored via a horizontal flip when `facingLeft` is false —
// see the various updateX() functions for how each entity decides which way
// it's currently headed. `legPhase` drives the running stride. `blocking`
// (true for an engaged blocker or the defender it's holding) swaps the bent,
// pumping running arms for a straight, braced-out pair -- deliberately no
// other visual "a tackle is coming" telegraph anymore (removed per
// direction: it made the dodge mechanic too easy to react to).
function drawPlayerSprite(x, y, opts) {
  const { jersey, trim, pants, helmet, number, legPhase, facingLeft, blocking } = opts;
  const mirror = facingLeft === false;

  ctx.save();
  ctx.translate(x, y);
  if (mirror) ctx.scale(-1, 1);
  ctx.scale(SPRITE_SCALE, SPRITE_SCALE);

  // Ground shadow.
  ctx.fillStyle = 'rgba(0,0,0,0.32)';
  ctx.beginPath();
  ctx.ellipse(0, 3, 9, 3, 0, 0, Math.PI * 2);
  ctx.fill();

  const HIP_Y = -9;
  const SHOULDER_Y = -18;
  const swing = (Math.sin(legPhase) + 1) / 2; // 0..1, smoother to blend two poses across
  const kneeShade = shadeColor(pants, -22); // a visibly darker calf so the knee bend reads as two segments, not one line

  // A two-segment (thigh + shin) leg reads as an actual running stride, not
  // just a rigid stick swinging from the hip — the knee bend (helped by the
  // shin's darker shade and a small knee-cap dot) is what sells "mid-
  // stride" at this scale. `t` (0..1) blends between a leg fully extended
  // forward-and-down (planting) and one lifted with a bent knee
  // (recovering); the two legs are given opposite `t` so one is always
  // planting while the other recovers, like an actual gait. A blocker
  // braced against someone plants both feet instead of mid-stride.
  function leg(pivotY, t, thickness) {
    const thighAngle = blocking ? -0.15 : -0.9 + t * 1.5; // -0.9 (reaching forward) .. 0.6 (trailing back)
    // The knee has to fold OPPOSITE the thigh's own lean, not extend further
    // the same way -- a trailing/recovering leg's heel tucks up and forward
    // underneath it (less total backward reach than a straight leg would
    // have), while a forward-reaching leg stays close to straight as it
    // extends down to plant. Bending the shin further in the SAME direction
    // the thigh already leans (the previous formula) reads as the leg
    // folding the wrong way. `-thighAngle` makes it fold back toward
    // vertical, harder the more the thigh leans; the constant keeps a
    // baseline bend so it's never a dead-straight single line.
    const kneeBend = blocking ? 0.25 : -thighAngle * 0.75 - 0.2;
    ctx.save();
    ctx.translate(0, pivotY);
    ctx.rotate(thighAngle);
    ctx.fillStyle = pants;
    ctx.fillRect(-thickness / 2, 0, thickness, 5);
    ctx.translate(0, 5);
    ctx.beginPath();
    ctx.arc(0, 0, thickness * 0.42, 0, Math.PI * 2);
    ctx.fillStyle = kneeShade;
    ctx.fill();
    ctx.rotate(kneeBend);
    ctx.fillRect(-thickness / 2, 0, thickness, 5.5);
    ctx.restore();
  }

  // A two-segment arm, same shape as a leg but smaller, in `trim` (not
  // `jersey`) so it never blends into the torso behind it. Offset a little
  // fore/aft from center like a real shoulder, not the spine -- at x=0 even
  // a wide swing barely pokes past the torso's own width and reads as part
  // of it. Bent and pumping (opposite phase from the legs) while running;
  // locked out straight toward the front when blocking, like a lineman's
  // punch.
  function arm(pivotX, t, thickness) {
    const shoulderAngle = blocking ? -1.2 : -0.85 + t * 1.6;
    const elbowBend = blocking ? 0.15 : 0.4 + (1 - Math.abs(t - 0.5) * 2) * 1.1;
    ctx.save();
    ctx.translate(pivotX, SHOULDER_Y + 1);
    ctx.rotate(shoulderAngle);
    ctx.fillStyle = trim;
    ctx.fillRect(-thickness / 2, 0, thickness, 4.5);
    ctx.translate(0, 4.5);
    ctx.rotate(elbowBend);
    ctx.fillRect(-thickness / 2, 0, thickness, 4.5);
    ctx.restore();
  }

  // Trailing leg and arm first, so the torso and leading pair layer in front.
  leg(HIP_Y, 1 - swing, 3.2);
  arm(1.5, 1 - swing, 2.3);

  // Torso, leaning forward into the run — narrower than a front-on jersey
  // since we're now looking at it edge-on.
  ctx.save();
  ctx.translate(0, HIP_Y);
  ctx.rotate(-0.2);
  ctx.fillStyle = jersey;
  ctx.fillRect(-3.5, SHOULDER_Y - HIP_Y, 7, HIP_Y - SHOULDER_Y);
  ctx.fillStyle = trim;
  ctx.fillRect(-3.5, SHOULDER_Y - HIP_Y, 7, 2.5);
  ctx.restore();

  // Leading leg and arm, layered over the torso.
  leg(HIP_Y, swing, 3.2);
  arm(-1.5, swing, 2.3);

  // Head in profile (an oval, not a circle, so it doesn't read as a
  // front-on face) with a bold, solid facemask bar projecting out the
  // front — the single clearest "which way is this player headed" cue a
  // small side-view sprite has.
  const headX = -3, headY = SHOULDER_Y - 3;
  ctx.fillStyle = helmet;
  ctx.beginPath();
  ctx.ellipse(headX, headY, 4.6, 5.2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(headX - 8, headY - 0.5, 5.5, 2.2); // facemask bar, front-and-down from the helmet
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.beginPath();
  ctx.ellipse(headX + 0.5, headY - 2.5, 1.6, 1, -0.3, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();

  // Jersey number, floating just above the helmet — drawn in its own,
  // never-mirrored pass so the digits always read left-to-right no matter
  // which way the player is facing. Scaled by hand (this pass skips the
  // SPRITE_SCALE transform above so mirroring can't flip the text) to keep
  // it sized and positioned to match the now-larger head.
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = '#fff';
  ctx.font = `bold ${Math.round(8 * SPRITE_SCALE)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText(String(number), 0, (SHOULDER_Y - 11) * SPRITE_SCALE);
  ctx.restore();
}

// Darkens (or lightens, for a negative amt in the other direction) a '#rrggbb'
// color by `amt` per channel — used to give a leg's shin a visibly different
// shade from its thigh without needing a second color passed in everywhere
// drawPlayerSprite is called.
function shadeColor(hex, amt) {
  const num = parseInt(hex.slice(1), 16);
  const clamp = (v) => Math.max(0, Math.min(255, v));
  const r = clamp(((num >> 16) & 0xff) + amt);
  const g = clamp(((num >> 8) & 0xff) + amt);
  const b = clamp((num & 0xff) + amt);
  return `rgb(${r}, ${g}, ${b})`;
}

// A handful of flat, saturated colors standing in for fans' shirts -- Tecmo
// Super Bowl's actual crowd is small colored figures packed shoulder to
// shoulder, not a shaded, lit, multi-tier modern stadium bowl.
const CROWD_COLORS = ['#efefef', '#2f5fbf', '#e08fa0', '#c0392b', '#8a4b26'];
const CROWD_SPACING_PX = 8;

// A single tiny fan: a round head over a small rectangular body, the same
// reduced-to-two-shapes look real Tecmo Super Bowl's crowd sprites use.
function drawCrowdPerson(px, py, color) {
  ctx.fillStyle = color;
  ctx.fillRect(px - 2.5, py - 1, 5, 4.5);
  ctx.beginPath();
  ctx.arc(px, py - 2.5, 2, 0, Math.PI * 2);
  ctx.fill();
}

// The stadium crowd: a fixed (not randomized) staggered grid of tiny fan
// sprites, clipped to the given rect -- meant to read as actual people in
// the stands, not an abstract texture. `vertical` picks which axis the rows
// run along: false for a wide, short band (the sideline stands -- rows
// stacked down the height, each spanning the width) and true for a narrow,
// tall one (the end-zone backdrop -- rows stacked across the width, each
// spanning the height). Shared by both so the whole stadium reads as one
// consistent structure.
function drawCrowdBand(x, y, w, h, vertical) {
  if (w <= 0 || h <= 0) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.fillStyle = '#1a1e28';
  ctx.fillRect(x, y, w, h);

  if (!vertical) {
    const rows = Math.max(1, Math.round(h / CROWD_SPACING_PX));
    const startCol = Math.floor(x / CROWD_SPACING_PX);
    for (let r = 0; r < rows; r++) {
      const rowY = y + (r + 0.5) * (h / rows);
      const rowOffset = (r % 2) * (CROWD_SPACING_PX / 2);
      for (let px = startCol * CROWD_SPACING_PX - CROWD_SPACING_PX + rowOffset; px < x + w + CROWD_SPACING_PX; px += CROWD_SPACING_PX) {
        const col = Math.round(px / CROWD_SPACING_PX);
        const idx = (col * 3 + r * 7) % CROWD_COLORS.length;
        drawCrowdPerson(px, rowY, CROWD_COLORS[idx]);
      }
    }
  } else {
    const cols = Math.max(1, Math.round(w / CROWD_SPACING_PX));
    const startRow = Math.floor(y / CROWD_SPACING_PX);
    for (let c = 0; c < cols; c++) {
      const colX = x + (c + 0.5) * (w / cols);
      const colOffset = (c % 2) * (CROWD_SPACING_PX / 2);
      for (let py = startRow * CROWD_SPACING_PX - CROWD_SPACING_PX + colOffset; py < y + h + CROWD_SPACING_PX; py += CROWD_SPACING_PX) {
        const row = Math.round(py / CROWD_SPACING_PX);
        const idx = (row * 3 + c * 7) % CROWD_COLORS.length;
        drawCrowdPerson(colX, py, CROWD_COLORS[idx]);
      }
    }
  }
  ctx.restore();
}

// Top/bottom stadium stands filling the margins the field is inset from —
// one flat crowd band plus a low wall at the field's edge, static relative
// to the screen since the seating runs the length of the field and doesn't
// need to scroll in sync with the camera.
function drawStadiumStands() {
  // Real Tecmo Super Bowl only ever shows the ONE crowd band, along the top
  // of the screen (plus the backdrop behind the end zone) -- not a second
  // one along the bottom too. The bottom margin still exists (the field
  // needs the same inset both sides to stay centered), it's just a plain
  // sideline strip rather than a second crowd.
  drawCrowdBand(0, 0, CANVAS_WIDTH, FIELD_TOP_PX, false);
  ctx.fillStyle = '#e4e4e4';
  ctx.fillRect(0, FIELD_TOP_PX - 3, CANVAS_WIDTH, 3);

  ctx.fillStyle = '#1b1f26';
  ctx.fillRect(0, FIELD_BOTTOM_PX, CANVAS_WIDTH, CANVAS_HEIGHT - FIELD_BOTTOM_PX);
  ctx.fillStyle = '#e4e4e4';
  ctx.fillRect(0, FIELD_BOTTOM_PX, CANVAS_WIDTH, 3);
}

function drawField() {
  drawStadiumStands();

  ctx.fillStyle = '#2c6438';
  ctx.fillRect(0, FIELD_TOP_PX, CANVAS_WIDTH, FIELD_BOTTOM_PX - FIELD_TOP_PX);

  // Mowed-turf stripes: alternating shade per 5-yard band.
  // Uses the (possibly clamped) camera position, not the runner's own raw
  // worldY — once the camera has locked, the visible window is centered on
  // the lock point, not on wherever the runner has kept running to.
  const startYard = Math.floor(cameraWorldY() / 5) * 5 - 20;
  const endYard = startYard + 90;
  for (let y = startYard; y < endYard; y += 5) {
    // Real, drawable field extends back to the returner's own goal line —
    // only actual gameplay (movement) is clamped at worldY=0, not the view.
    if (y + 5 < OWN_GOAL_WORLD_Y || y > fieldYards) continue;
    const yStart = clampNum(y, OWN_GOAL_WORLD_Y, fieldYards);
    const yEnd = clampNum(y + 5, OWN_GOAL_WORLD_Y, fieldYards);
    const screenLeft = screenXForward(yEnd);
    const screenRight = screenXForward(yStart);
    const band = Math.round(y / 5);
    ctx.fillStyle = band % 2 === 0 ? '#2c6438' : '#316f3f';
    ctx.fillRect(screenLeft, FIELD_TOP_PX, screenRight - screenLeft, FIELD_BOTTOM_PX - FIELD_TOP_PX);
  }

  // Yard lines, hash marks, and numbers.
  ctx.textAlign = 'center';
  for (let y = startYard; y <= endYard; y += 5) {
    if (y < OWN_GOAL_WORLD_Y || y > fieldYards) continue;
    const screenX = screenXForward(y);
    if (screenX < -20 || screenX > CANVAS_WIDTH + 20) continue;
    const isTenYard = y % 10 === 0;
    ctx.strokeStyle = isTenYard ? 'rgba(255,255,255,0.65)' : 'rgba(255,255,255,0.4)';
    ctx.lineWidth = isTenYard ? 2 : 1.3;
    ctx.beginPath();
    ctx.moveTo(screenX, FIELD_TOP_PX);
    ctx.lineTo(screenX, FIELD_BOTTOM_PX);
    ctx.stroke();
    // Inbound hash marks at either side of the line.
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 2;
    [FIELD_TOP_PX + (FIELD_BOTTOM_PX - FIELD_TOP_PX) * 0.28, FIELD_TOP_PX + (FIELD_BOTTOM_PX - FIELD_TOP_PX) * 0.72].forEach((hy) => {
      ctx.beginPath();
      ctx.moveTo(screenX, hy - 5);
      ctx.lineTo(screenX, hy + 5);
      ctx.stroke();
    });
    if (isTenYard) {
      const label = fieldPositionLabel(y);
      ctx.font = 'bold 16px sans-serif';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(15,35,20,0.6)';
      ctx.strokeText(label, screenX, FIELD_TOP_PX + 22);
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fillText(label, screenX, FIELD_TOP_PX + 22);
    }
  }

  // Far end zone (the opponent's, at the far/left end of the scroll):
  // solid fill + bold centered "END ZONE" text, rotated to read along the
  // field's length — plain and clean like a real painted end zone.
  const goalScreenX = screenXForward(fieldYards);
  if (goalScreenX > -80) {
    const ezRight = Math.min(CANVAS_WIDTH + 80, goalScreenX);
    const ezLeft = Math.max(-80, goalScreenX - EZ_DEPTH_PX);
    ctx.fillStyle = '#1f4a29';
    ctx.fillRect(ezLeft, FIELD_TOP_PX, ezRight - ezLeft, FIELD_BOTTOM_PX - FIELD_TOP_PX);
    ctx.save();
    ctx.beginPath();
    ctx.rect(ezLeft, FIELD_TOP_PX, ezRight - ezLeft, FIELD_BOTTOM_PX - FIELD_TOP_PX);
    ctx.clip();
    ctx.translate((ezLeft + ezRight) / 2, CANVAS_HEIGHT / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = 'bold 15px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('E N D   Z O N E', 0, 4);
    ctx.restore();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(goalScreenX, FIELD_TOP_PX);
    ctx.lineTo(goalScreenX, FIELD_BOTTOM_PX);
    ctx.stroke();

    // Stadium crowd behind the end zone — the same flat crowd-band language
    // as the sidelines, so the whole thing reads as one consistent, simple
    // structure wrapping around the field rather than a different style
    // stuck on behind the goal line. Anchored to the goal line so it
    // scrolls into view exactly as the runner closes in on it.
    const deckRight = ezLeft;
    const deckLeft = deckRight - STADIUM_CROWD_DEPTH_PX;
    if (deckRight > -20) {
      drawCrowdBand(deckLeft, 0, deckRight - deckLeft, CANVAS_HEIGHT, true);
    }
  }

  // The returner's own end zone, mirrored the other way (screen X
  // increases going into it, since it's behind worldY=0 rather than beyond
  // fieldYards). A real field is painted at both ends, goalpost included —
  // and the returner catches the kick standing right in front of exactly
  // this one, same as real Tecmo Super Bowl. (A version of this used to
  // render UNDER a lingering brown ball sprite left over from the kickoff
  // catch animation's last frame, which was the actual "brown thing behind
  // the returner" -- see playCatchAnimation()'s forced extra render() call
  // for that fix; this end zone itself was never the problem.)
  const ownGoalScreenX = screenXForward(OWN_GOAL_WORLD_Y);
  if (ownGoalScreenX < CANVAS_WIDTH + 80) {
    const ownEzLeft = ownGoalScreenX;
    const ownEzRight = Math.min(CANVAS_WIDTH + 80, ownGoalScreenX + EZ_DEPTH_PX);
    ctx.fillStyle = '#1f4a29';
    ctx.fillRect(ownEzLeft, FIELD_TOP_PX, ownEzRight - ownEzLeft, FIELD_BOTTOM_PX - FIELD_TOP_PX);
    ctx.save();
    ctx.beginPath();
    ctx.rect(ownEzLeft, FIELD_TOP_PX, ownEzRight - ownEzLeft, FIELD_BOTTOM_PX - FIELD_TOP_PX);
    ctx.clip();
    ctx.translate((ownEzLeft + ownEzRight) / 2, CANVAS_HEIGHT / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = 'bold 15px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('E N D   Z O N E', 0, 4);
    ctx.restore();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(ownGoalScreenX, FIELD_TOP_PX);
    ctx.lineTo(ownGoalScreenX, FIELD_BOTTOM_PX);
    ctx.stroke();

    // Stadium crowd further behind it, same as the far end zone.
    const ownDeckLeft = ownEzRight;
    const ownDeckRight = ownDeckLeft + STADIUM_CROWD_DEPTH_PX;
    if (ownDeckLeft < CANVAS_WIDTH + 20) {
      drawCrowdBand(ownDeckLeft, 0, ownDeckRight - ownDeckLeft, CANVAS_HEIGHT, true);
    }
  }

  // Sidelines / out-of-bounds border, purely decorative (movement is still
  // clamped in world-yard space regardless of where this line is drawn).
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.fillRect(0, FIELD_TOP_PX - 5, CANVAS_WIDTH, 5);
  ctx.fillRect(0, FIELD_BOTTOM_PX, CANVAS_WIDTH, 5);
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.fillRect(0, FIELD_TOP_PX - 5, CANVAS_WIDTH, 2);
  ctx.fillRect(0, FIELD_BOTTOM_PX + 3, CANVAS_WIDTH, 2);
}

// The goalpost sits a fixed screen-depth into the end zone, dead center —
// anchored to the goal line itself (via GOALPOST_DEPTH_PX, a screen-space
// offset, not a world-yard one) so it always lands clearly on the painted
// end zone turf, in front of the stadium deck behind it. The crossbar
// spans the field's lateral width (screen Y), and the base pole/uprights
// extend further behind the goal line (screen X) — the same physical
// shape as before, just transposed for the horizontal camera. A real
// field has one of these at BOTH ends; `dir` is +1 or -1 for which way
// "further into the end zone" actually is on screen for that goal line.
function drawGoalPost(goalScreenX, dir) {
  const baseX = goalScreenX + dir * GOALPOST_DEPTH_PX;
  if (baseX < -70 || baseX > CANVAS_WIDTH + 70) return;
  const baseY = screenYLateral(0);
  const uprightOffsetPx = 3.08 * PX_PER_YARD_LATERAL; // NFL uprights are ~18.5ft apart
  const crossbarX = baseX + dir * 16;
  const uprightTipX = baseX + dir * 52;

  // Base pad.
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.ellipse(baseX, baseY, 2.5, 5, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = '#ffd400';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // Base pole.
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(baseX, baseY);
  ctx.lineTo(crossbarX, baseY);
  ctx.stroke();
  // Crossbar.
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  ctx.moveTo(crossbarX, baseY - uprightOffsetPx);
  ctx.lineTo(crossbarX, baseY + uprightOffsetPx);
  ctx.stroke();
  // Uprights.
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(crossbarX, baseY - uprightOffsetPx);
  ctx.lineTo(uprightTipX, baseY - uprightOffsetPx);
  ctx.moveTo(crossbarX, baseY + uprightOffsetPx);
  ctx.lineTo(uprightTipX, baseY + uprightOffsetPx);
  ctx.stroke();
  // A bright highlight down the base pole so it doesn't read as a flat line.
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(baseX, baseY - 1);
  ctx.lineTo(crossbarX, baseY - 1);
  ctx.stroke();
}

// A block visually nudges the two combatants apart perpendicular to their
// direction of travel (i.e. a few pixels up/down on screen) so an engaged
// blocker and defender read as two distinct figures side by side instead
// of one sprite sitting exactly on top of the other -- the two are often
// only a yard or two apart in world space when the hold starts, close
// enough on screen that one profile sprite fully hides the other.
const ENGAGE_DRAW_OFFSET_PX = 7; // a bit more than before now that SPRITE_SCALE makes each figure wider

function drawRunner() {
  const x = screenXForward(runner.worldY);
  const y = screenYLateral(runner.worldX);
  const moving = Math.abs(runner.vx) + Math.abs(runner.vy) > 0.5;
  const legPhase = moving ? performance.now() / 90 : 0;

  drawPlayerSprite(x, y, {
    jersey: '#2f5fbf', trim: '#16234f', pants: '#e7ebef', helmet: '#1c3f8f',
    number: 1, legPhase, facingLeft: runner.facingLeft,
  });
}

function drawBlockers() {
  blockers.forEach((b, i) => {
    const engagedWith = defenders.find((d) => d.state === 'blocked' && d.blockedByBlocker === b);
    const x = screenXForward(b.worldY);
    const y = screenYLateral(b.worldX) - (engagedWith ? ENGAGE_DRAW_OFFSET_PX : 0);
    const legPhase = engagedWith ? 0 : performance.now() / 95 + i * 1.7;
    drawPlayerSprite(x, y, {
      jersey: '#2f5fbf', trim: '#16234f', pants: '#e7ebef', helmet: '#123078',
      number: b.number, legPhase, facingLeft: b.facingLeft, blocking: !!engagedWith,
    });
  });
}

function drawKicker() {
  const x = screenXForward(kicker.worldY);
  const y = screenYLateral(kicker.worldX);
  const legPhase = performance.now() / 110;
  drawPlayerSprite(x, y, {
    jersey: '#c0392b', trim: '#5c150c', pants: '#26262a', helmet: '#8e2a1e',
    number: kicker.number, legPhase, facingLeft: false, // trails the play, always headed backward
  });
}

function drawDefenders() {
  for (const d of defenders) {
    const isBlocked = d.state === 'blocked';
    // A defender actively sliding into a swipe is visibly moving under its
    // own drawn position (worldX/worldY themselves are animating, see
    // updateDefenders()) -- treat it like any other active player rather
    // than the frozen/offset "held" look the rest of a block gets.
    const isSliding = d.slideTackleState === 'lunging';
    const x = screenXForward(d.worldY);
    const y = screenYLateral(d.worldX) + (isBlocked && !isSliding ? ENGAGE_DRAW_OFFSET_PX : 0);
    if (x < -30 || x > CANVAS_WIDTH + 30) continue;
    // Standing still while held up by the wedge — no leg-stride animation
    // for a defender that isn't actually moving.
    const legPhase = (isBlocked && !isSliding) ? 0 : performance.now() / 100 + d.worldX * 0.4;
    const facingLeft = isSliding ? d.slideTackleTargetY >= d.slideTackleStartY : d.facingLeft;

    drawPlayerSprite(x, y, {
      jersey: '#c0392b', trim: '#5c150c', pants: '#26262a', helmet: '#8e2a1e',
      number: d.number, legPhase, facingLeft, blocking: isBlocked && !isSliding,
    });
  }
}

function drawHud() {
  ctx.fillStyle = 'rgba(8, 16, 12, 0.6)';
  ctx.fillRect(0, 0, CANVAS_WIDTH, 34);
  ctx.fillStyle = '#eaf3ec';
  ctx.font = 'bold 15px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(`Return ${currentReturnConfig.index + 1} of ${returnsPerPlayer}`, 10, 20);
  ctx.textAlign = 'right';
  const yardsToGo = Math.max(0, Math.round(fieldYards - runner.worldY));
  ctx.fillText(`${yardsToGo} yd to go`, CANVAS_WIDTH - 10, 20);
  ctx.textAlign = 'center';

  // Field-position progress bar.
  const progress = clampNum(runner.worldY / fieldYards, 0, 1);
  const barX = 10;
  const barW = CANVAS_WIDTH - 20;
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.fillRect(barX, 26, barW, 4);
  ctx.fillStyle = '#4ade80';
  ctx.fillRect(barX, 26, barW * progress, 4);
}

function render() {
  drawField();
  drawGoalPost(screenXForward(fieldYards), -1);
  drawGoalPost(screenXForward(OWN_GOAL_WORLD_Y), 1);
  drawKicker();
  drawDefenders();
  drawBlockers();
  drawRunner();
  drawHud();
}

// ---- Game loop ---------------------------------------------------------
function tick(now) {
  const dtSec = Math.min((now - lastFrameAt) / 1000, 0.05); // clamp so a backgrounded-tab gap can't teleport anything
  lastFrameAt = now;

  if (runner.state === 'running') {
    updateRunner(dtSec);
    if (runner.state === 'running') {
      updateBlockers(dtSec);
      updateDefenders(dtSec);
    }
  }

  render();

  if (runner.state === 'running') {
    animationHandle = requestAnimationFrame(tick);
  } else {
    animationHandle = null;
    finishReturn();
  }
}

function stopLoop() {
  if (animationHandle != null) cancelAnimationFrame(animationHandle);
  animationHandle = null;
}

// ---- Return lifecycle ---------------------------------------------------
function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// A brief non-interactive beat before control hands over: the ball arcs in
// from the right and the runner makes the catch at the goal line. Purely
// cosmetic — the server-authoritative part of a return only ever starts
// once this resolves.
// Two-beat kickoff intro: first the camera holds on the kicking team (the
// kicker approaching the ball, teed up out near their own formation), then
// once the kick happens the camera pans across the field — following the
// ball's flight — down to the returner waiting at the goal line, exactly
// where the real return then picks up. Uses cameraOverride so every
// existing draw function (field, stands, both end zones, defenders,
// blockers, the kicker) renders this pan for free — only the ball's own
// position needs computing here.
const KICKOFF_FORMATION_MS = 550;
const KICKOFF_FLIGHT_MS = 2200; // was 1000 -- the ball crossed the whole field in about a second, way too fast to actually watch it fly
async function playCatchAnimation() {
  runner.state = 'catching';
  const kickoffSpotWorldY = kicker.worldY + 6; // a bit beyond the kicker, so the whole formation fits on screen
  const start = performance.now();
  const totalMs = KICKOFF_FORMATION_MS + KICKOFF_FLIGHT_MS;

  while (performance.now() - start < totalMs) {
    const elapsed = performance.now() - start;
    let ballWorldY;
    let ballArcPx;
    if (elapsed < KICKOFF_FORMATION_MS) {
      cameraOverride = kickoffSpotWorldY;
      ballWorldY = kicker.worldY;
      ballArcPx = 0; // sitting teed up, not yet in the air
    } else {
      const t = (elapsed - KICKOFF_FORMATION_MS) / KICKOFF_FLIGHT_MS;
      const eased = t * t * (3 - 2 * t); // smoothstep — gentle start/stop on the pan
      cameraOverride = kickoffSpotWorldY + (0 - kickoffSpotWorldY) * eased;
      ballWorldY = kicker.worldY + (0 - kicker.worldY) * eased;
      ballArcPx = Math.sin(t * Math.PI) * -70; // rises then falls back to the ground
    }

    drawField();
    drawGoalPost(screenXForward(fieldYards), -1);
    drawGoalPost(screenXForward(OWN_GOAL_WORLD_Y), 1);
    drawKicker();
    drawDefenders();
    drawBlockers();
    if (elapsed >= KICKOFF_FORMATION_MS) drawRunner(); // stays off-screen until the pan brings the goal line into view
    ctx.fillStyle = '#8a4b26';
    ctx.beginPath();
    ctx.ellipse(screenXForward(ballWorldY), screenYLateral(0) + ballArcPx, 7, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#eaf3ec';
    ctx.font = 'bold 20px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(elapsed < KICKOFF_FORMATION_MS ? 'Kickoff...' : '', CANVAS_WIDTH / 2, 60);
    await new Promise((r) => requestAnimationFrame(r));
  }

  cameraOverride = null; // hand back to the normal runner-following camera
}

// Starts a fresh return using the server-provided difficulty config —
// resets the runner/blockers/defenders/camera and hands control to the
// player once the catch animation finishes.
async function startReturn(returnConfig) {
  currentReturnConfig = returnConfig;
  runner.worldX = 0;
  runner.worldY = 0;
  runner.lateralDir = 'none';
  runner.lastLateralDir = null;
  runner.vx = 0;
  runner.vy = 0;
  blockers = makeBlockers();
  defenders = makeCoverageTeam(returnConfig.defenderCount);
  kicker = makeKicker();

  document.getElementById('return-info').textContent = `Return ${returnConfig.index + 1} of ${returnsPerPlayer}`;
  document.getElementById('kr-result').textContent = '';
  document.getElementById('next-return-btn').style.display = 'none';

  await playCatchAnimation();
  runner.state = 'running';
  lastFrameAt = performance.now();
  // The intro's own draw loop is the only thing that ever draws the ball,
  // and its very last frame lands it right on the returner (that's the
  // catch). Repaint immediately via the normal render() (which never draws
  // a ball) so there's no gap where that last brown-ball frame could still
  // be what's on screen while waiting for the first real tick().
  render();
  stopLoop();
  animationHandle = requestAnimationFrame(tick);
}

// Called once a return ends (tackled or reached the goal line) — reports
// the outcome and shows the result panel; "Next Return" is what actually
// advances.
async function finishReturn() {
  const touchdown = runner.state === 'touchdown';
  const yardsGained = Math.round(clampNum(runner.worldY, 0, fieldYards));

  render();
  ctx.fillStyle = touchdown ? 'rgba(74, 222, 128, 0.85)' : 'rgba(239, 68, 68, 0.85)';
  ctx.fillRect(0, CANVAS_HEIGHT / 2 - 30, CANVAS_WIDTH, 60);
  ctx.fillStyle = '#0a1410';
  ctx.font = 'bold 30px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(touchdown ? 'TOUCHDOWN!' : 'TACKLED!', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 10);
  await wait(RESULT_HOLD_MS);

  try {
    const { outcome } = await api('POST', `/api/game-instances/${instanceId}/kickoff-return/submit`, { memberId, yardsGained, touchdown });
    const resultEl = document.getElementById('kr-result');
    resultEl.textContent = outcome.touchdown
      ? `Touchdown! ${outcome.yardsGained} yards — +${outcome.points.toFixed(1)} points`
      : `Tackled after ${outcome.yardsGained} yards — +${outcome.points.toFixed(1)} points`;
    resultEl.style.color = outcome.touchdown ? '#4ade80' : '#ef4444';
    document.getElementById('next-return-btn').style.display = 'inline-block';
  } catch (err) {
    alert(err.message);
  }
}

document.getElementById('next-return-btn').addEventListener('click', async () => {
  const btn = document.getElementById('next-return-btn');
  btn.disabled = true;
  try {
    const { gameInstance: gi } = await api('POST', `/api/game-instances/${instanceId}/kickoff-return/next`, { memberId });
    if (gi.status === 'completed') {
      showDone(`Contest finished. You scored ${gi.yourScore.toFixed(1)} points (${gi.yourTouchdowns} touchdown${gi.yourTouchdowns === 1 ? '' : 's'}).`);
    } else if (gi.hasCompleted) {
      showDone(`You finished with ${gi.yourScore.toFixed(1)} points! Waiting on the rest of the league…`);
      poll();
    } else {
      returnsPerPlayer = gi.returnsPerPlayer || returnsPerPlayer;
      fieldYards = gi.currentReturn.fieldYards || fieldYards;
      startReturn(gi.currentReturn);
    }
  } catch (err) {
    alert(err.message);
  } finally {
    btn.disabled = false;
  }
});

function showDone(message) {
  stopLoop();
  document.getElementById('game-panel').style.display = 'none';
  document.getElementById('done-panel').style.display = 'block';
  document.getElementById('done-message').textContent = message;
}

async function init() {
  if (!memberId) {
    document.getElementById('status-line').textContent = 'This is a spectator link — kickoff returns are played individually by each member.';
    return;
  }
  const { gameInstance: gi } = await api('GET', `/api/game-instances/${instanceId}?memberId=${memberId}`);
  returnsPerPlayer = gi.returnsPerPlayer || returnsPerPlayer;

  if (gi.status === 'completed') {
    showDone(gi.yourScore != null ? `Contest finished. You scored ${gi.yourScore.toFixed(1)} points (${gi.yourTouchdowns} touchdown${gi.yourTouchdowns === 1 ? '' : 's'}).` : 'Contest finished.');
    return;
  }
  if (gi.hasCompleted) {
    showDone(`You finished with ${gi.yourScore.toFixed(1)} points! Waiting on the rest of the league…`);
    poll();
    return;
  }

  document.getElementById('status-line').style.display = 'none';
  document.getElementById('game-panel').style.display = 'block';
  fieldYards = gi.currentReturn.fieldYards || fieldYards;

  if (gi.currentReturn.index === 0) {
    // Don't throw the player into the catch animation the instant the page
    // loads — wait for a deliberate click so they're actually ready
    // (keyboard focused, hands on the arrows) first. Render one static
    // frame of the pre-kick formation so the field (and the wedge/coverage/
    // kicker, properly spawned) is visible behind the button instead of a
    // blank canvas -- or, without this, whatever the top-level `kicker` was
    // initialized to before its first real makeKicker() call, which is
    // {worldX:0, worldY:0} -- exactly the returner's own spot, drawn right
    // on top of them.
    currentReturnConfig = gi.currentReturn;
    blockers = makeBlockers();
    defenders = makeCoverageTeam(gi.currentReturn.defenderCount);
    kicker = makeKicker();
    render();
    document.getElementById('return-info').textContent = `Return 1 of ${returnsPerPlayer}`;
    document.getElementById('start-return-btn').style.display = 'inline-block';
    document.getElementById('start-return-btn').addEventListener('click', () => {
      document.getElementById('start-return-btn').style.display = 'none';
      startReturn(gi.currentReturn);
    }, { once: true });
  } else {
    startReturn(gi.currentReturn);
  }
}

function poll() {
  setInterval(async () => {
    const { gameInstance: gi } = await api('GET', `/api/game-instances/${instanceId}?memberId=${memberId}`);
    if (gi.status === 'completed') {
      showDone(gi.yourScore != null ? `Contest finished. You scored ${gi.yourScore.toFixed(1)} points (${gi.yourTouchdowns} touchdown${gi.yourTouchdowns === 1 ? '' : 's'}).` : 'Contest finished.');
    }
  }, 4000);
}

init();
