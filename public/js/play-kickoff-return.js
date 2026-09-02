// Kickoff Return — real-time and entirely client-simulated, unlike every
// other game on this site. The server only ever decides how hard the NEXT
// return should be (how many defenders, how fast — see currentReturn on
// the game instance) and scores whatever {yardsGained, touchdown} this
// client reports back once a return ends. Everything about the actual
// dodge — the runner, the defenders, collisions, juke/spin — is simulated
// entirely in the browser and trusted, the same "server sets it up, client
// measures its own outcome" split every other async game here already
// uses (e.g. Field Goal Kick trusting the client's own elapsed-time
// reading).
const instanceId = qs('instance');
const leagueId = qs('league');
const memberId = qs('member');
document.getElementById('back-link').href = leagueId ? `/member-home.html?league=${leagueId}` : '/';

// ---- Desktop-only gate ---------------------------------------------------
// No touch controls exist for this game yet (v1 is keyboard-only) — a
// coarse pointer (finger, not a mouse) means arrow keys/Z/X almost
// certainly aren't available at all, so show a plain message instead of a
// canvas nothing can control.
if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) {
  document.getElementById('status-line').style.display = 'none';
  document.getElementById('desktop-only-panel').style.display = 'block';
  throw new Error('kickoff-return: desktop-only, coarse pointer detected');
}

// ---- Canvas / world setup -------------------------------------------------
const canvas = document.getElementById('kr-canvas');
const ctx = canvas.getContext('2d');
const CANVAS_WIDTH = canvas.width;
const CANVAS_HEIGHT = canvas.height;

const FIELD_WIDTH_YARDS = 53.3;
const RUNNER_HALF_WIDTH = 0.6;
// The playing field is inset from the canvas edges so there's room to draw
// stadium stands in the margins on both sides — purely cosmetic, doesn't
// touch gameplay math, since world-yard coordinates (movement, collision,
// clamping) never reference pixels at all.
const STADIUM_MARGIN_PX = 34;
const FIELD_LEFT_PX = STADIUM_MARGIN_PX;
const FIELD_RIGHT_PX = CANVAS_WIDTH - STADIUM_MARGIN_PX;
const PX_PER_YARD_X = (FIELD_RIGHT_PX - FIELD_LEFT_PX) / FIELD_WIDTH_YARDS;
const PX_PER_YARD_Y = 14;
const RUNNER_SCREEN_Y = CANVAS_HEIGHT * 0.68; // the runner is always drawn here; the world scrolls around it
const GOALPOST_DEPTH_YARDS = 7; // how far behind the goal line the posts sit

function worldToScreenX(worldX) {
  return CANVAS_WIDTH / 2 + worldX * PX_PER_YARD_X;
}
function worldToScreenY(worldY) {
  return RUNNER_SCREEN_Y - (worldY - runner.worldY) * PX_PER_YARD_Y;
}
function clampNum(x, min, max) {
  return Math.max(min, Math.min(max, x));
}

// ---- Tunable constants -----------------------------------------------------
const RUNNER_FORWARD_SPEED = 9; // yards/sec at full forward speed
const RUNNER_BACKWARD_SPEED = 4; // yards/sec if backpedaling
const RUNNER_LATERAL_SPEED = 7; // yards/sec, plain directional movement

const EVADE_BURST_SPEED = 12; // yards/sec lateral during an active juke/spin
const EVADE_WINDOW_MS = 250; // how long a juke/spin's burst + "current side" lasts
const EVADE_COOLDOWN_MS = 500; // time before juke/spin can be used again — without this a player could just hold evasive forever and never be readable

const DEFENDER_BASE_SPEED = 7.5; // yards/sec pursuit at a defenderSpeed multiplier of 1.0
const DEFENDER_TRIGGER_DISTANCE = 6; // yards — closing to this range starts a defender's wind-up
const DEFENDER_BASE_WINDUP_MS = 550; // the visible telegraph window at defenderSpeed 1.0
const DEFENDER_MIN_WINDUP_MS = 280; // floor — higher difficulty shortens this but never past this, so it's always reactable
const DEFENDER_WINDUP_SHRINK_PER_SPEED = 220; // ms shaved off per +1.0x of defenderSpeed above 1.0
const DEFENDER_LUNGE_MS = 260;
const DEFENDER_LUNGE_LATERAL_LEAD = 1.3; // how far to the committed side the lunge aims, on top of closing the gap
const TACKLE_RADIUS = 1.1; // yards — collision distance during a lunge
const DEFENDER_RECOVER_MS = 550;

const SPAWN_LEAD_YARDS = 13; // defenders spawn this far ahead of the runner
const SPAWN_LATERAL_SPREAD = FIELD_WIDTH_YARDS * 0.42;

const CATCH_ANIMATION_MS = 1400;
const RESULT_HOLD_MS = 1400;

// ---- Game state -------------------------------------------------------------
let powerPeriodMsUnused; // (placeholder removed below — kept out of exports intentionally)
let returnsPerPlayer = 5;
let fieldYards = 80;
let currentReturnConfig = null; // {index, defenderCount, defenderSpeed}

const runner = {
  worldX: 0,
  worldY: 0,
  lateralDir: 'none', // 'left' | 'right' | 'none' — whichever lateral arrow is CURRENTLY held
  lastLateralDir: null, // last nonzero lateral direction, for spin's fallback when centered
  evasiveSide: null, // 'left' | 'right' | null — the active juke/spin burst direction
  evasiveUntil: 0,
  nextEvasiveAllowedAt: 0,
  state: 'idle', // 'idle' | 'catching' | 'running' | 'tackled' | 'touchdown'
  vx: 0, vy: 0, // yards/sec, last frame's actual velocity — used to lead a defender's lunge target
};

let defenders = [];
let spawnSchedule = [];
let animationHandle = null;
let lastFrameAt = 0;

// ---- Input ------------------------------------------------------------------
const heldKeys = new Set();
const ARROW_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
window.addEventListener('keydown', (e) => {
  if (ARROW_KEYS.has(e.key)) e.preventDefault(); // stop the page itself from scrolling
  heldKeys.add(e.key);
  if (e.key === 'z' || e.key === 'Z') tryEvade('juke');
  if (e.key === 'x' || e.key === 'X') tryEvade('spin');
});
window.addEventListener('keyup', (e) => {
  heldKeys.delete(e.key);
});

// Juke bursts in the runner's CURRENT lateral direction; spin bursts in the
// OPPOSITE of it (falling back to the last direction moved, if currently
// centered, so spin still means something even from a dead stop). Both
// share one cooldown — see EVADE_COOLDOWN_MS's comment above for why a
// cooldown exists at all.
function tryEvade(kind) {
  if (runner.state !== 'running') return;
  const now = performance.now();
  if (now < runner.nextEvasiveAllowedAt) return;

  let side;
  if (kind === 'juke') {
    if (runner.lateralDir === 'none') return; // nothing to burst further in
    side = runner.lateralDir;
  } else {
    const base = runner.lateralDir !== 'none' ? runner.lateralDir : runner.lastLateralDir;
    if (!base) return; // never moved laterally yet — nothing to reverse
    side = base === 'left' ? 'right' : 'left';
  }

  runner.evasiveSide = side;
  runner.evasiveUntil = now + EVADE_WINDOW_MS;
  runner.nextEvasiveAllowedAt = now + EVADE_COOLDOWN_MS;
}

// The runner's side for tackle-matchup purposes right now: an active
// juke/spin burst overrides plain directional movement while it's live.
function currentRunnerSide() {
  if (performance.now() < runner.evasiveUntil) return runner.evasiveSide;
  return runner.lateralDir;
}

// ---- Runner movement ----------------------------------------------------
function updateRunner(dtSec) {
  const up = heldKeys.has('ArrowUp');
  const down = heldKeys.has('ArrowDown');
  const left = heldKeys.has('ArrowLeft');
  const right = heldKeys.has('ArrowRight');

  let vx = 0;
  let vy = 0;
  if (left && !right) vx = -1;
  else if (right && !left) vx = 1;
  if (up && !down) vy = 1;
  else if (down && !up) vy = -1;

  // Normalize so a diagonal isn't faster than a single direction.
  const mag = Math.hypot(vx, vy);
  if (mag > 0) { vx /= mag; vy /= mag; }

  const forwardSpeed = vy >= 0 ? RUNNER_FORWARD_SPEED : RUNNER_BACKWARD_SPEED;
  const worldYVelocity = vy * forwardSpeed;
  runner.worldY = clampNum(runner.worldY + worldYVelocity * dtSec, 0, fieldYards);

  const evasiveActive = performance.now() < runner.evasiveUntil;
  let worldXVelocity;
  if (evasiveActive) {
    worldXVelocity = (runner.evasiveSide === 'left' ? -1 : 1) * EVADE_BURST_SPEED;
  } else {
    worldXVelocity = vx * RUNNER_LATERAL_SPEED;
  }
  runner.worldX += worldXVelocity * dtSec;
  const halfField = FIELD_WIDTH_YARDS / 2 - RUNNER_HALF_WIDTH;
  runner.worldX = clampNum(runner.worldX, -halfField, halfField);

  // Kept around so a defender starting a lunge can aim at where the runner
  // is headed rather than only where they are right now — see the "lunging"
  // targeting comment in updateDefenders() for why this matters.
  runner.vx = worldXVelocity;
  runner.vy = worldYVelocity;

  if (left && !right) { runner.lateralDir = 'left'; runner.lastLateralDir = 'left'; }
  else if (right && !left) { runner.lateralDir = 'right'; runner.lastLateralDir = 'right'; }
  else runner.lateralDir = 'none';

  if (runner.worldY >= fieldYards) {
    runner.state = 'touchdown';
  }
}

// ---- Defenders --------------------------------------------------------------
function windupMsFor(defenderSpeed) {
  const extra = Math.max(0, defenderSpeed - 1) * DEFENDER_WINDUP_SHRINK_PER_SPEED;
  return Math.max(DEFENDER_MIN_WINDUP_MS, DEFENDER_BASE_WINDUP_MS - extra);
}

// Lays out where (in world yards downfield) each of this return's
// defenders will spawn, spread across the field with some jitter so it's
// not a perfectly predictable rhythm. Actual spawning happens lazily in
// updateDefenders() as the runner approaches each scheduled point.
function scheduleDefenders(defenderCount) {
  const schedule = [];
  const spacing = fieldYards / (defenderCount + 1);
  for (let i = 1; i <= defenderCount; i++) {
    const jitterY = (Math.random() * 2 - 1) * (spacing * 0.3);
    const worldY = clampNum(spacing * i + jitterY, 6, fieldYards - 3);
    const worldX = (Math.random() * 2 - 1) * SPAWN_LATERAL_SPREAD;
    schedule.push({ worldY, worldX, spawned: false });
  }
  schedule.sort((a, b) => a.worldY - b.worldY);
  return schedule;
}

function updateDefenders(dtSec) {
  const now = performance.now();

  // Lazily spawn anything on the schedule that's now close enough ahead.
  for (const entry of spawnSchedule) {
    if (entry.spawned) continue;
    if (entry.worldY - runner.worldY <= SPAWN_LEAD_YARDS) {
      entry.spawned = true;
      defenders.push({
        worldX: entry.worldX,
        worldY: entry.worldY,
        number: 20 + Math.floor(Math.random() * 79), // cosmetic only, for the jersey sprite
        state: 'approaching', // approaching -> windingUp -> lunging -> recovering
        committedSide: null,
        windupStartedAt: 0,
        lungeStartedAt: 0,
        lungeStartX: 0, lungeStartY: 0,
        lungeTargetX: 0, lungeTargetY: 0,
        recoverStartedAt: 0,
        despawn: false,
      });
    }
  }

  for (const d of defenders) {
    if (d.state === 'approaching') {
      const dx = runner.worldX - d.worldX;
      const dy = runner.worldY - d.worldY;
      const dist = Math.hypot(dx, dy);
      if (dist > 0.01) {
        const speed = DEFENDER_BASE_SPEED * currentReturnConfig.defenderSpeed;
        d.worldX += (dx / dist) * speed * dtSec;
        d.worldY += (dy / dist) * speed * dtSec;
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
        const lateralLead = d.committedSide === 'left' ? -DEFENDER_LUNGE_LATERAL_LEAD
          : d.committedSide === 'right' ? DEFENDER_LUNGE_LATERAL_LEAD : 0;
        // Aim not at where the runner IS right now but at where they'll BE
        // once the lunge's flight time (DEFENDER_LUNGE_MS) has elapsed,
        // projecting forward from their current velocity — a runner just
        // running straight is genuinely catchable this way; without this
        // lead, a defender's fixed-line dive always undershoots because the
        // runner keeps moving during the lunge's own flight time, and a
        // "correct read" would whiff regardless of committedSide. This is
        // still a "fixed line" lunge in the sense the plan means: it's
        // computed once here and never re-tracked during the flight itself,
        // so a late juke/spin (which changes the runner's ACTUAL velocity
        // after this point) still beats it via the committedSide mismatch
        // check below, even though the predicted spot was accurate for a
        // runner who didn't evade.
        const leadSec = DEFENDER_LUNGE_MS / 1000;
        d.lungeTargetX = runner.worldX + runner.vx * leadSec + lateralLead;
        d.lungeTargetY = runner.worldY + runner.vy * leadSec;
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
      if (now - d.recoverStartedAt >= DEFENDER_RECOVER_MS) {
        d.despawn = true;
      }
    }
  }
  defenders = defenders.filter((d) => !d.despawn);
}

// ---- Rendering ----------------------------------------------------------
// A shared sprite drawn for both the runner and every defender — layered
// shadow/legs/jersey/helmet instead of a flat blob, so the field reads as
// actual players rather than colored rectangles. `legPhase` drives a small
// running-stride wobble; `glowColor` (used only for a winding-up defender's
// telegraph — see drawDefenders()) draws a pulsing ring with no directional
// information in it, on purpose: it tells the player a hit is coming, never
// which way to dodge.
function drawPlayerSprite(x, y, opts) {
  const { jersey, trim, pants, helmet, number, legPhase, glowColor, glowStrength } = opts;
  ctx.save();
  ctx.translate(x, y);

  // Ground shadow.
  ctx.fillStyle = 'rgba(0,0,0,0.32)';
  ctx.beginPath();
  ctx.ellipse(0, 3, 10, 3.5, 0, 0, Math.PI * 2);
  ctx.fill();

  if (glowColor) {
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 90);
    ctx.strokeStyle = glowColor;
    ctx.globalAlpha = (0.35 + 0.4 * pulse) * (glowStrength != null ? glowStrength : 1);
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(0, -9, 15 + pulse * 3, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // Legs — a simple alternating stride.
  const stride = Math.sin(legPhase) * 3;
  ctx.fillStyle = pants;
  ctx.fillRect(-5.5, -7 + stride, 4.5, 10);
  ctx.fillRect(1, -7 - stride, 4.5, 10);

  // Torso with side trim stripes.
  ctx.fillStyle = jersey;
  ctx.fillRect(-8, -17, 16, 15);
  ctx.fillStyle = trim;
  ctx.fillRect(-8, -17, 2.5, 15);
  ctx.fillRect(5.5, -17, 2.5, 15);

  // Jersey number.
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 8px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(String(number), 0, -6);

  // Helmet, with a facemask hint and a small shine highlight for depth.
  ctx.fillStyle = helmet;
  ctx.beginPath();
  ctx.arc(0, -21, 6.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(20,20,20,0.55)';
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.arc(0, -21, 4.6, -0.5, Math.PI + 0.5);
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.beginPath();
  ctx.ellipse(-2.2, -23.5, 2, 1.1, -0.4, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

// Deterministic pseudo-random in [0,1) from a seed — used for crowd-dot
// scatter so the stands don't shimmer/re-randomize every frame (this runs
// inside render(), called ~60x/sec).
function seededRandom(seed) {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

// Left/right stadium stands filling the margins the field is inset from.
// Static relative to the screen (not tied to worldY) — the seating bowl
// runs the length of the field, so a fixed backdrop reads fine while the
// camera scrolls, and it's far cheaper than trying to scroll a seating
// pattern in sync with the field.
function drawStadiumSides() {
  [{ x0: 0, x1: FIELD_LEFT_PX, side: 0 }, { x0: FIELD_RIGHT_PX, x1: CANVAS_WIDTH, side: 1 }].forEach(({ x0, x1, side }) => {
    const w = x1 - x0;
    ctx.fillStyle = '#0d1a26';
    ctx.fillRect(x0, 0, w, CANVAS_HEIGHT);
    // Tiered bleacher rows, each tier narrower toward the field so it reads
    // as a raked stand rather than a flat wall.
    const tiers = 5;
    for (let t = 0; t < tiers; t++) {
      const tierW = w * (0.9 - t * 0.13);
      const tx = side === 0 ? x1 - tierW : x0;
      ctx.fillStyle = t % 2 === 0 ? '#16283a' : '#1c3346';
      ctx.fillRect(tx, 0, tierW, CANVAS_HEIGHT);
    }
    // Crowd — a scatter of small dots.
    ctx.fillStyle = 'rgba(224,206,168,0.55)';
    for (let i = 0; i < 46; i++) {
      const px = x0 + seededRandom(side * 97 + i * 3.7) * w;
      const py = seededRandom(side * 51 + i * 8.3) * CANVAS_HEIGHT;
      ctx.fillRect(px, py, 2, 2);
    }
    // Low wall separating the stands from the field of play.
    ctx.fillStyle = '#e4e4e4';
    ctx.fillRect(side === 0 ? x1 - 3 : x0, 0, 3, CANVAS_HEIGHT);
  });
}

function drawField() {
  drawStadiumSides();

  ctx.fillStyle = '#2c6438';
  ctx.fillRect(FIELD_LEFT_PX, 0, FIELD_RIGHT_PX - FIELD_LEFT_PX, CANVAS_HEIGHT);

  // Mowed-turf stripes: alternating shade per 5-yard band.
  const startYard = Math.floor(runner.worldY / 5) * 5 - 20;
  const endYard = startYard + 90;
  for (let y = startYard; y < endYard; y += 5) {
    if (y + 5 < 0 || y > fieldYards) continue;
    const yTop = clampNum(y, 0, fieldYards);
    const yBottom = clampNum(y + 5, 0, fieldYards);
    const screenTop = worldToScreenY(yBottom);
    const screenBottom = worldToScreenY(yTop);
    const band = Math.round(y / 5);
    ctx.fillStyle = band % 2 === 0 ? '#2c6438' : '#316f3f';
    ctx.fillRect(FIELD_LEFT_PX, screenTop, FIELD_RIGHT_PX - FIELD_LEFT_PX, screenBottom - screenTop);
  }

  // Yard lines, hash marks, and numbers.
  ctx.textAlign = 'center';
  for (let y = startYard; y <= endYard; y += 5) {
    if (y < 0 || y > fieldYards) continue;
    const screenY = worldToScreenY(y);
    if (screenY < -20 || screenY > CANVAS_HEIGHT + 20) continue;
    const isTenYard = y % 10 === 0;
    ctx.strokeStyle = isTenYard ? 'rgba(255,255,255,0.65)' : 'rgba(255,255,255,0.4)';
    ctx.lineWidth = isTenYard ? 2 : 1.3;
    ctx.beginPath();
    ctx.moveTo(FIELD_LEFT_PX, screenY);
    ctx.lineTo(FIELD_RIGHT_PX, screenY);
    ctx.stroke();
    // Inbound hash marks at either side of the line.
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 2;
    [FIELD_LEFT_PX + (FIELD_RIGHT_PX - FIELD_LEFT_PX) * 0.28, FIELD_LEFT_PX + (FIELD_RIGHT_PX - FIELD_LEFT_PX) * 0.72].forEach((hx) => {
      ctx.beginPath();
      ctx.moveTo(hx - 5, screenY);
      ctx.lineTo(hx + 5, screenY);
      ctx.stroke();
    });
    if (isTenYard) {
      const label = y === fieldYards ? 'GOAL' : String(Math.round(y));
      ctx.font = 'bold 16px sans-serif';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(15,35,20,0.6)';
      ctx.strokeText(label, CANVAS_WIDTH / 2, screenY - 8);
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fillText(label, CANVAS_WIDTH / 2, screenY - 8);
    }
  }

  // End zone: diagonal stripes + vertical "END ZONE" text.
  const goalScreenY = worldToScreenY(fieldYards);
  if (goalScreenY < CANVAS_HEIGHT + 80) {
    const ezTop = Math.max(-80, goalScreenY - 55);
    const ezBottom = goalScreenY;
    ctx.save();
    ctx.beginPath();
    ctx.rect(FIELD_LEFT_PX, ezTop, FIELD_RIGHT_PX - FIELD_LEFT_PX, ezBottom - ezTop);
    ctx.clip();
    ctx.fillStyle = '#1f4a29';
    ctx.fillRect(FIELD_LEFT_PX, ezTop, FIELD_RIGHT_PX - FIELD_LEFT_PX, ezBottom - ezTop);
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 10;
    for (let sx = -CANVAS_HEIGHT; sx < CANVAS_WIDTH + CANVAS_HEIGHT; sx += 26) {
      ctx.beginPath();
      ctx.moveTo(sx, ezBottom + 20);
      ctx.lineTo(sx + CANVAS_HEIGHT, ezBottom - CANVAS_HEIGHT - 20);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = 'bold 13px sans-serif';
    ctx.fillText('E N D   Z O N E', CANVAS_WIDTH / 2, (ezTop + ezBottom) / 2 + 4);
    ctx.restore();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(FIELD_LEFT_PX, goalScreenY);
    ctx.lineTo(FIELD_RIGHT_PX, goalScreenY);
    ctx.stroke();

    // Stadium structure behind the end zone — an upper-deck backdrop with
    // its own crowd scatter, plus a pair of light towers — anchored to the
    // goal line so it scrolls into view as the runner closes in on it.
    const standBottom = ezTop;
    const standTop = standBottom - 90;
    if (standBottom > -20) {
      const visTop = Math.max(-20, standTop);
      ctx.fillStyle = '#111c27';
      ctx.fillRect(0, visTop, CANVAS_WIDTH, standBottom - visTop);
      ctx.fillStyle = '#0a141d';
      ctx.fillRect(0, standBottom - 6, CANVAS_WIDTH, 6);
      ctx.fillStyle = 'rgba(225,205,165,0.45)';
      for (let i = 0; i < 70; i++) {
        const px = seededRandom(i * 3.1) * CANVAS_WIDTH;
        const py = standTop + seededRandom(i * 7.7) * (standBottom - standTop - 8) + 4;
        if (py < -20 || py > CANVAS_HEIGHT + 20) continue;
        ctx.fillRect(px, py, 2, 2);
      }
      [FIELD_LEFT_PX - 16, FIELD_RIGHT_PX + 16].forEach((lx) => {
        ctx.strokeStyle = '#5a6672';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(lx, standTop);
        ctx.lineTo(lx, standTop - 26);
        ctx.stroke();
        ctx.fillStyle = '#dfe6ee';
        ctx.fillRect(lx - 7, standTop - 33, 14, 9);
      });
    }
  }

  // Sidelines / out-of-bounds border, purely decorative (movement is still
  // clamped in world-yard space regardless of where this line is drawn).
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.fillRect(FIELD_LEFT_PX - 5, 0, 5, CANVAS_HEIGHT);
  ctx.fillRect(FIELD_RIGHT_PX, 0, 5, CANVAS_HEIGHT);
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.fillRect(FIELD_LEFT_PX - 5, 0, 2, CANVAS_HEIGHT);
  ctx.fillRect(FIELD_RIGHT_PX + 3, 0, 2, CANVAS_HEIGHT);
}

// The goalpost sits a few yards behind the goal line, dead center — drawn
// in world space (via worldToScreenX/Y) so it scrolls into view exactly
// like everything else as the runner closes in on the end zone.
function drawGoalPost() {
  const baseX = worldToScreenX(0);
  const baseY = worldToScreenY(fieldYards + GOALPOST_DEPTH_YARDS);
  if (baseY < -70 || baseY > CANVAS_HEIGHT + 70) return;
  const uprightOffsetPx = 3.08 * PX_PER_YARD_X; // NFL uprights are ~18.5ft apart
  const crossbarY = baseY - 14;
  const uprightTopY = baseY - 48;

  ctx.strokeStyle = '#ffd400';
  ctx.lineCap = 'round';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(baseX, baseY);
  ctx.lineTo(baseX, crossbarY);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(baseX - uprightOffsetPx, crossbarY);
  ctx.lineTo(baseX + uprightOffsetPx, crossbarY);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(baseX - uprightOffsetPx, crossbarY);
  ctx.lineTo(baseX - uprightOffsetPx, uprightTopY);
  ctx.moveTo(baseX + uprightOffsetPx, crossbarY);
  ctx.lineTo(baseX + uprightOffsetPx, uprightTopY);
  ctx.stroke();
}

function drawRunner() {
  const x = worldToScreenX(runner.worldX);
  const y = RUNNER_SCREEN_Y;
  const moving = Math.abs(runner.vx) + Math.abs(runner.vy) > 0.5;
  const legPhase = moving ? performance.now() / 90 : 0;

  // Evasive-burst motion streaks — replaces the old defender-side arrows as
  // the game's directional "juice," now on the player's own move instead.
  if (performance.now() < runner.evasiveUntil) {
    const dir = runner.evasiveSide === 'left' ? 1 : -1;
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
      const sx = x + dir * (14 + i * 7);
      ctx.beginPath();
      ctx.moveTo(sx, y - 18 + i * 3);
      ctx.lineTo(sx + dir * 8, y - 18 + i * 3);
      ctx.stroke();
    }
  }

  drawPlayerSprite(x, y, {
    jersey: '#2f5fbf', trim: '#16234f', pants: '#e7ebef', helmet: '#1c3f8f',
    number: 1, legPhase,
  });
}

function drawDefenders() {
  for (const d of defenders) {
    const x = worldToScreenX(d.worldX);
    const y = worldToScreenY(d.worldY);
    if (y < -30 || y > CANVAS_HEIGHT + 30) continue;
    const legPhase = performance.now() / 100 + d.worldX * 0.4;

    // The telegraph: a pulsing ring while winding up, and a stronger flash
    // through the lunge itself — deliberately carries no left/right
    // information, only "this one's about to (or is) diving."
    let glowColor = null;
    let glowStrength = 1;
    if (d.state === 'windingUp') {
      glowColor = '#ffcc33';
    } else if (d.state === 'lunging') {
      glowColor = '#ff5c3d';
      glowStrength = 1.4;
    }

    drawPlayerSprite(x, y, {
      jersey: '#c0392b', trim: '#5c150c', pants: '#26262a', helmet: '#8e2a1e',
      number: d.number, legPhase, glowColor, glowStrength,
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
  drawGoalPost();
  drawDefenders();
  drawRunner();
  drawHud();
}

// ---- Game loop ---------------------------------------------------------
function tick(now) {
  const dtSec = Math.min((now - lastFrameAt) / 1000, 0.05); // clamp so a backgrounded-tab gap can't teleport anything
  lastFrameAt = now;

  if (runner.state === 'running') {
    updateRunner(dtSec);
    if (runner.state === 'running') updateDefenders(dtSec);
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
// and the runner makes the catch. Purely cosmetic — the server-authoritative
// part of a return only ever starts once this resolves.
async function playCatchAnimation() {
  runner.state = 'catching';
  const start = performance.now();
  while (performance.now() - start < CATCH_ANIMATION_MS) {
    const t = (performance.now() - start) / CATCH_ANIMATION_MS;
    drawField();
    drawRunner();
    ctx.fillStyle = '#8a4b26';
    const ballY = RUNNER_SCREEN_Y - 260 + t * 260;
    ctx.beginPath();
    ctx.ellipse(worldToScreenX(runner.worldX), ballY, 6, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#eaf3ec';
    ctx.font = 'bold 20px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Kickoff...', CANVAS_WIDTH / 2, 60);
    await new Promise((r) => requestAnimationFrame(r));
  }
}

// Starts a fresh return using the server-provided difficulty config —
// resets the runner/defenders/camera and hands control to the player once
// the catch animation finishes.
async function startReturn(returnConfig) {
  currentReturnConfig = returnConfig;
  runner.worldX = 0;
  runner.worldY = 0;
  runner.lateralDir = 'none';
  runner.lastLateralDir = null;
  runner.evasiveSide = null;
  runner.evasiveUntil = 0;
  runner.nextEvasiveAllowedAt = 0;
  runner.vx = 0;
  runner.vy = 0;
  defenders = [];
  spawnSchedule = scheduleDefenders(returnConfig.defenderCount);

  document.getElementById('return-info').textContent = `Return ${returnConfig.index + 1} of ${returnsPerPlayer}`;
  document.getElementById('kr-result').textContent = '';
  document.getElementById('next-return-btn').style.display = 'none';

  await playCatchAnimation();
  runner.state = 'running';
  lastFrameAt = performance.now();
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
  ctx.fillRect(0, CANVAS_HEIGHT / 2 - 40, CANVAS_WIDTH, 80);
  ctx.fillStyle = '#0a1410';
  ctx.font = 'bold 34px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(touchdown ? 'TOUCHDOWN!' : 'TACKLED!', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 12);
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
  startReturn(gi.currentReturn);
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
