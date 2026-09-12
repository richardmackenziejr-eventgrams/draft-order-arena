// Kickoff Return — graphics test sandbox. NOT wired to any real league or
// server — a pure local tool that plays a full session (5 returns, real
// scoring/difficulty ladder) so it can actually be played while the real
// game's rendering/mechanics are iterated on, same idea as the earlier
// fg3d-test.html/js prototype used to build out the 3D Field Goal scene.
// The simulation code below (movement, defender AI, drawing) is copied
// verbatim from public/js/play-kickoff-return.js — keep the two in sync by
// hand if the real game changes; this file has no build step or import to
// do that automatically. Not linked from anywhere on the site.

// ---- Canvas / world setup -------------------------------------------------
// Landscape (the field runs horizontally): worldY (yards downfield) maps to
// screen X and scrolls; worldX (lateral position) maps to screen Y and is
// fixed/inset. Forward progress moves toward smaller screen X
// (right-to-left), matching a kickoff return in the classic side view.
const canvas = document.getElementById('kr-canvas');
const ctx = canvas.getContext('2d');
const CANVAS_WIDTH = canvas.width;
const CANVAS_HEIGHT = canvas.height;

const FIELD_WIDTH_YARDS = 53.3;
const RUNNER_HALF_WIDTH = 0.6;
const STADIUM_MARGIN_PX = 30;
const FIELD_TOP_PX = STADIUM_MARGIN_PX;
const FIELD_BOTTOM_PX = CANVAS_HEIGHT - STADIUM_MARGIN_PX;
const PX_PER_YARD_LATERAL = (FIELD_BOTTOM_PX - FIELD_TOP_PX) / FIELD_WIDTH_YARDS;
const PX_PER_YARD_FORWARD = 14;
const RUNNER_SCREEN_X = CANVAS_WIDTH * 0.68;
const START_FIELD_POSITION = 0;
const OWN_GOAL_WORLD_Y = 0;

const EZ_DEPTH_PX = 55;
const STADIUM_DECK_DEPTH_PX = 120;
const STADIUM_ROOF_DEPTH_PX = 22;
const BACKDROP_DEPTH_PX = EZ_DEPTH_PX + STADIUM_DECK_DEPTH_PX + STADIUM_ROOF_DEPTH_PX;
const GOALPOST_DEPTH_PX = 36;

function fieldPositionLabel(worldY) {
  const fieldPos = START_FIELD_POSITION + worldY;
  if (fieldPos >= 100 || fieldPos <= 0) return 'GOAL';
  return String(Math.round(fieldPos <= 50 ? fieldPos : 100 - fieldPos));
}

function screenYLateral(worldX) {
  return CANVAS_HEIGHT / 2 + worldX * PX_PER_YARD_LATERAL;
}
function cameraMaxWorldY() {
  return fieldYards + (BACKDROP_DEPTH_PX - RUNNER_SCREEN_X) / PX_PER_YARD_FORWARD;
}
function cameraWorldY() {
  return Math.min(runner.worldY, cameraMaxWorldY());
}
function screenXForward(worldY) {
  return RUNNER_SCREEN_X - (worldY - cameraWorldY()) * PX_PER_YARD_FORWARD;
}
function clampNum(x, min, max) {
  return Math.max(min, Math.min(max, x));
}

// ---- Tunable constants (mirrors play-kickoff-return.js exactly) -----------
const RUNNER_FORWARD_SPEED = 9;
const RUNNER_BACKWARD_SPEED = 4;
const RUNNER_LATERAL_SPEED = 7;

const DEFENDER_BASE_SPEED = 7.5;
const DEFENDER_TRIGGER_DISTANCE = 6;
const DEFENDER_BASE_WINDUP_MS = 550;
const DEFENDER_MIN_WINDUP_MS = 280;
const DEFENDER_WINDUP_SHRINK_PER_SPEED = 220;
const DEFENDER_LUNGE_MS = 260;
const DEFENDER_LUNGE_LATERAL_LEAD = 1.3;
const TACKLE_RADIUS = 1.1;
const DEFENDER_RECOVER_MS = 550;

const SPAWN_LEAD_YARDS = 13;
const SPAWN_LATERAL_SPREAD = FIELD_WIDTH_YARDS * 0.42;

const BLOCKER_OFFSETS = [
  { forward: 3, lateral: 0 },
  { forward: 1, lateral: -4.5 },
  { forward: 1, lateral: 4.5 },
];

// Difficulty curve, copied from lib/gameEngine/kickoffReturn.js so the
// "spawn a wave at this level" control matches what real gameplay would
// actually throw at a player at that level.
const BASE_DEFENDER_COUNT = 3;
const MAX_DEFENDER_COUNT = 7;
const DEFENDER_COUNT_LEVELS_PER_STEP = 2;
const BASE_DEFENDER_SPEED = 1;
const MAX_DEFENDER_SPEED = 1.6;
const DEFENDER_SPEED_PER_LEVEL = 0.05;
function defenderCountFor(level) {
  return Math.min(MAX_DEFENDER_COUNT, BASE_DEFENDER_COUNT + Math.floor(level / DEFENDER_COUNT_LEVELS_PER_STEP));
}
function defenderSpeedFor(level) {
  return Math.min(MAX_DEFENDER_SPEED, BASE_DEFENDER_SPEED + level * DEFENDER_SPEED_PER_LEVEL);
}

// Difficulty ladder + scoring, copied from lib/gameEngine/kickoffReturn.js —
// this page plays a full real session (5 returns, real progression/scoring)
// entirely client-side, so there's no server module to actually call.
const RETURNS_PER_PLAYER = 5;
const YARDS_PER_POINT = 0.1;
const TOUCHDOWN_BONUS = 7;
const LEVEL_STEP_TOUCHDOWN = 2;
const LEVEL_STEP_BIG_GAIN = 1;
const LEVEL_STEP_DOWN = 1;
const BIG_GAIN_THRESHOLD = 50;
const HOLD_THRESHOLD = 21;
const MIN_LEVEL = 0;
function nextLevelFor(currentLevel, yardsGained, touchdown) {
  if (touchdown) return currentLevel + LEVEL_STEP_TOUCHDOWN;
  if (yardsGained >= BIG_GAIN_THRESHOLD) return currentLevel + LEVEL_STEP_BIG_GAIN;
  if (yardsGained >= HOLD_THRESHOLD) return currentLevel;
  return Math.max(MIN_LEVEL, currentLevel - LEVEL_STEP_DOWN);
}

// ---- Game/session state ----------------------------------------------------
let fieldYards = 100;
let currentReturnConfig = { index: 0, defenderCount: BASE_DEFENDER_COUNT, defenderSpeed: BASE_DEFENDER_SPEED };

function freshPlayer() {
  return { currentIndex: 0, difficultyLevel: MIN_LEVEL, totalPoints: 0, totalYards: 0, touchdowns: 0, completed: false };
}
let player = freshPlayer();

const runner = {
  worldX: 0, worldY: 0,
  lateralDir: 'none', lastLateralDir: null,
  state: 'idle', // idle -> catching -> running -> tackled/touchdown, exactly like the real game
  vx: 0, vy: 0,
};

let defenders = [];
let spawnSchedule = [];
let blockers = BLOCKER_OFFSETS.map(() => ({ worldX: 0, worldY: 0 }));
let animationHandle = null;
let lastFrameAt = 0;

// ---- Input ------------------------------------------------------------------
// Left/Right drive forward/backward; Up/Down dodge laterally — matching the
// original Tecmo Bowl's side-view control scheme (no juke/spin).
const heldKeys = new Set();
const ARROW_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
window.addEventListener('keydown', (e) => {
  if (ARROW_KEYS.has(e.key)) e.preventDefault();
  heldKeys.add(e.key);
});
window.addEventListener('keyup', (e) => {
  heldKeys.delete(e.key);
});

function currentRunnerSide() {
  return runner.lateralDir;
}

// ---- Runner movement (unchanged from the real game) ------------------------
function updateRunner(dtSec) {
  const forward = heldKeys.has('ArrowLeft');
  const backward = heldKeys.has('ArrowRight');
  const up = heldKeys.has('ArrowUp');
  const down = heldKeys.has('ArrowDown');

  let vy = 0;
  let vx = 0;
  if (forward && !backward) vy = 1;
  else if (backward && !forward) vy = -1;
  if (down && !up) vx = 1;
  else if (up && !down) vx = -1;

  const mag = Math.hypot(vx, vy);
  if (mag > 0) { vx /= mag; vy /= mag; }

  const forwardSpeed = vy >= 0 ? RUNNER_FORWARD_SPEED : RUNNER_BACKWARD_SPEED;
  const worldYVelocity = vy * forwardSpeed;
  runner.worldY = clampNum(runner.worldY + worldYVelocity * dtSec, 0, fieldYards);

  const worldXVelocity = vx * RUNNER_LATERAL_SPEED;
  runner.worldX += worldXVelocity * dtSec;
  const halfField = FIELD_WIDTH_YARDS / 2 - RUNNER_HALF_WIDTH;
  runner.worldX = clampNum(runner.worldX, -halfField, halfField);

  runner.vx = worldXVelocity;
  runner.vy = worldYVelocity;

  if (up && !down) { runner.lateralDir = 'up'; runner.lastLateralDir = 'up'; }
  else if (down && !up) { runner.lateralDir = 'down'; runner.lastLateralDir = 'down'; }
  else runner.lateralDir = 'none';

  if (runner.worldY >= fieldYards) {
    runner.state = 'touchdown';
  }
}

// Cosmetic return-team teammates, held in a fixed formation relative to the
// runner — no interaction with defenders, just visual.
function updateBlockers() {
  BLOCKER_OFFSETS.forEach((offset, i) => {
    const b = blockers[i];
    b.worldY = clampNum(runner.worldY + offset.forward, 0, fieldYards);
    b.worldX = clampNum(runner.worldX + offset.lateral, -(FIELD_WIDTH_YARDS / 2 - RUNNER_HALF_WIDTH), FIELD_WIDTH_YARDS / 2 - RUNNER_HALF_WIDTH);
  });
}

// ---- Defenders (unchanged AI from the real game) ---------------------------
function windupMsFor(defenderSpeed) {
  const extra = Math.max(0, defenderSpeed - 1) * DEFENDER_WINDUP_SHRINK_PER_SPEED;
  return Math.max(DEFENDER_MIN_WINDUP_MS, DEFENDER_BASE_WINDUP_MS - extra);
}

function scheduleDefenders(defenderCount) {
  const schedule = [];
  const spacing = fieldYards / (defenderCount + 1);
  for (let i = 1; i <= defenderCount; i++) {
    const jitterY = (Math.random() * 2 - 1) * (spacing * 0.3);
    const worldY = clampNum(runner.worldY + spacing * i + jitterY, runner.worldY + 6, runner.worldY + fieldYards);
    const worldX = (Math.random() * 2 - 1) * SPAWN_LATERAL_SPREAD;
    schedule.push({ worldY, worldX, spawned: false });
  }
  schedule.sort((a, b) => a.worldY - b.worldY);
  return schedule;
}

function makeDefender(worldX, worldY, state, committedSide) {
  return {
    worldX, worldY,
    number: 20 + Math.floor(Math.random() * 79),
    state: state || 'approaching',
    committedSide: committedSide || null,
    windupStartedAt: performance.now(),
    lungeStartedAt: performance.now(),
    lungeStartX: worldX, lungeStartY: worldY,
    lungeTargetX: worldX, lungeTargetY: worldY - 6,
    recoverStartedAt: performance.now(),
    despawn: false,
  };
}

function updateDefenders(dtSec) {
  const now = performance.now();

  for (const entry of spawnSchedule) {
    if (entry.spawned) continue;
    if (entry.worldY - runner.worldY <= SPAWN_LEAD_YARDS) {
      entry.spawned = true;
      defenders.push(makeDefender(entry.worldX, entry.worldY, 'approaching', null));
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
          return;
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

// ---- Rendering (verbatim copy of play-kickoff-return.js's) ----------------
function drawPlayerSprite(x, y, opts) {
  const { jersey, trim, pants, helmet, number, legPhase, glowColor, glowStrength } = opts;
  ctx.save();
  ctx.translate(x, y);

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

  const stride = Math.sin(legPhase) * 3;
  ctx.fillStyle = pants;
  ctx.fillRect(-5.5, -7 + stride, 4.5, 10);
  ctx.fillRect(1, -7 - stride, 4.5, 10);

  ctx.fillStyle = jersey;
  ctx.fillRect(-8, -17, 16, 15);
  ctx.fillStyle = trim;
  ctx.fillRect(-8, -17, 2.5, 15);
  ctx.fillRect(5.5, -17, 2.5, 15);

  ctx.fillStyle = '#fff';
  ctx.font = 'bold 8px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(String(number), 0, -6);

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

function seededRandom(seed) {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function drawSeatedDeck(x, y, w, h, horizontal, seed) {
  if (w <= 0 || h <= 0) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  const rowSize = 4;
  if (horizontal) {
    for (let ry = y - (y % rowSize); ry < y + h; ry += rowSize) {
      ctx.fillStyle = Math.floor(ry / rowSize) % 2 === 0 ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.08)';
      ctx.fillRect(x, ry, w, rowSize);
    }
  } else {
    for (let rx = x - (x % rowSize); rx < x + w; rx += rowSize) {
      ctx.fillStyle = Math.floor(rx / rowSize) % 2 === 0 ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.08)';
      ctx.fillRect(rx, y, rowSize, h);
    }
  }
  ctx.fillStyle = 'rgba(226,208,170,0.6)';
  const dotCount = Math.round((w * h) / 260);
  for (let i = 0; i < dotCount; i++) {
    const px = x + seededRandom(seed + i * 3.7) * w;
    const py = y + seededRandom(seed + 500 + i * 8.3) * h;
    ctx.fillRect(px, py, 2, 2);
  }
  ctx.restore();
}

function drawStadiumStands() {
  [{ y0: 0, y1: FIELD_TOP_PX, side: 0 }, { y0: FIELD_BOTTOM_PX, y1: CANVAS_HEIGHT, side: 1 }].forEach(({ y0, y1, side }) => {
    const roofEdgeY = side === 0 ? y0 + 6 : y1 - 6;

    const lowerH = (y1 - y0) * 0.62;
    const lowerY = side === 0 ? y1 - lowerH : y0;
    ctx.fillStyle = '#17293b';
    ctx.fillRect(0, lowerY, CANVAS_WIDTH, lowerH);
    drawSeatedDeck(0, lowerY, CANVAS_WIDTH, lowerH, true, side * 97);

    const upperY0 = y0;
    const upperY1 = lowerY;
    ctx.fillStyle = '#070d13';
    ctx.fillRect(0, side === 0 ? upperY1 - 2 : upperY1, CANVAS_WIDTH, 2);

    const upperH = upperY1 - upperY0;
    ctx.fillStyle = '#101c29';
    ctx.fillRect(0, upperY0, CANVAS_WIDTH, upperH);
    drawSeatedDeck(0, upperY0, CANVAS_WIDTH, upperH, true, side * 97 + 1000);

    ctx.fillStyle = '#050a0f';
    ctx.fillRect(0, side === 0 ? 0 : CANVAS_HEIGHT - 4, CANVAS_WIDTH, 4);

    for (let lx = 60; lx < CANVAS_WIDTH; lx += 150) {
      const ly = roofEdgeY;
      ctx.strokeStyle = '#5a6672';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(lx - 10, ly);
      ctx.lineTo(lx + 10, ly);
      ctx.stroke();
      ctx.fillStyle = '#eef3f8';
      ctx.beginPath();
      ctx.arc(lx, ly, 2.4, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = '#e4e4e4';
    ctx.fillRect(0, side === 0 ? y1 - 3 : y0, CANVAS_WIDTH, 3);
  });
}

function drawField() {
  drawStadiumStands();

  ctx.fillStyle = '#2c6438';
  ctx.fillRect(0, FIELD_TOP_PX, CANVAS_WIDTH, FIELD_BOTTOM_PX - FIELD_TOP_PX);

  const startYard = Math.floor(cameraWorldY() / 5) * 5 - 20;
  const endYard = startYard + 90;
  for (let y = startYard; y < endYard; y += 5) {
    if (y + 5 < OWN_GOAL_WORLD_Y || y > fieldYards) continue;
    const yStart = clampNum(y, OWN_GOAL_WORLD_Y, fieldYards);
    const yEnd = clampNum(y + 5, OWN_GOAL_WORLD_Y, fieldYards);
    const screenLeft = screenXForward(yEnd);
    const screenRight = screenXForward(yStart);
    const band = Math.round(y / 5);
    ctx.fillStyle = band % 2 === 0 ? '#2c6438' : '#316f3f';
    ctx.fillRect(screenLeft, FIELD_TOP_PX, screenRight - screenLeft, FIELD_BOTTOM_PX - FIELD_TOP_PX);
  }

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

    const deckRight = ezLeft;
    const deckSplit = deckRight - STADIUM_DECK_DEPTH_PX * 0.58;
    const roofRight = deckRight - STADIUM_DECK_DEPTH_PX;
    const roofLeft = roofRight - STADIUM_ROOF_DEPTH_PX;
    if (deckRight > -20) {
      ctx.fillStyle = '#17293b';
      ctx.fillRect(deckSplit, 0, deckRight - deckSplit, CANVAS_HEIGHT);
      drawSeatedDeck(deckSplit, 0, deckRight - deckSplit, CANVAS_HEIGHT, false, 2000);
      ctx.fillStyle = '#070d13';
      ctx.fillRect(deckSplit - 2, 0, 2, CANVAS_HEIGHT);
      ctx.fillStyle = '#101c29';
      ctx.fillRect(roofRight, 0, deckSplit - roofRight, CANVAS_HEIGHT);
      drawSeatedDeck(roofRight, 0, deckSplit - roofRight, CANVAS_HEIGHT, false, 3000);
      ctx.fillStyle = '#050a0f';
      ctx.fillRect(roofLeft, 0, roofRight - roofLeft, CANVAS_HEIGHT);
      for (let ly = FIELD_TOP_PX + 30; ly < FIELD_BOTTOM_PX; ly += 90) {
        ctx.strokeStyle = '#5a6672';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(roofLeft + 4, ly);
        ctx.lineTo(roofLeft - 14, ly);
        ctx.stroke();
        ctx.fillStyle = '#eef3f8';
        ctx.fillRect(roofLeft - 19, ly - 6, 7, 12);
      }
    }
  }

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
    ctx.fillStyle = '#111c27';
    ctx.fillRect(Math.max(0, ownEzRight), 0, Math.max(0, CANVAS_WIDTH - ownEzRight), CANVAS_HEIGHT);
  }

  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.fillRect(0, FIELD_TOP_PX - 5, CANVAS_WIDTH, 5);
  ctx.fillRect(0, FIELD_BOTTOM_PX, CANVAS_WIDTH, 5);
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.fillRect(0, FIELD_TOP_PX - 5, CANVAS_WIDTH, 2);
  ctx.fillRect(0, FIELD_BOTTOM_PX + 3, CANVAS_WIDTH, 2);
}

function drawGoalPost() {
  const goalScreenX = screenXForward(fieldYards);
  const baseX = goalScreenX - GOALPOST_DEPTH_PX;
  if (baseX < -70 || baseX > CANVAS_WIDTH + 70) return;
  const baseY = screenYLateral(0);
  const uprightOffsetPx = 3.08 * PX_PER_YARD_LATERAL;
  const crossbarX = baseX - 16;
  const uprightTipX = baseX - 52;

  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.ellipse(baseX, baseY, 2.5, 5, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = '#ffd400';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(baseX, baseY);
  ctx.lineTo(crossbarX, baseY);
  ctx.stroke();
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  ctx.moveTo(crossbarX, baseY - uprightOffsetPx);
  ctx.lineTo(crossbarX, baseY + uprightOffsetPx);
  ctx.stroke();
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(crossbarX, baseY - uprightOffsetPx);
  ctx.lineTo(uprightTipX, baseY - uprightOffsetPx);
  ctx.moveTo(crossbarX, baseY + uprightOffsetPx);
  ctx.lineTo(uprightTipX, baseY + uprightOffsetPx);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(baseX, baseY - 1);
  ctx.lineTo(crossbarX, baseY - 1);
  ctx.stroke();
}

function drawRunner() {
  const x = screenXForward(runner.worldY);
  const y = screenYLateral(runner.worldX);
  const moving = Math.abs(runner.vx) + Math.abs(runner.vy) > 0.5;
  const legPhase = moving ? performance.now() / 90 : 0;

  drawPlayerSprite(x, y, {
    jersey: '#2f5fbf', trim: '#16234f', pants: '#e7ebef', helmet: '#1c3f8f',
    number: 1, legPhase,
  });
}

function drawBlockers() {
  blockers.forEach((b, i) => {
    const x = screenXForward(b.worldY);
    const y = screenYLateral(b.worldX);
    const legPhase = performance.now() / 95 + i * 1.7;
    drawPlayerSprite(x, y, {
      jersey: '#2f5fbf', trim: '#16234f', pants: '#e7ebef', helmet: '#123078',
      number: 20 + i, legPhase,
    });
  });
}

function drawDefenders() {
  for (const d of defenders) {
    const x = screenXForward(d.worldY);
    const y = screenYLateral(d.worldX);
    if (x < -30 || x > CANVAS_WIDTH + 30) continue;
    const legPhase = performance.now() / 100 + d.worldX * 0.4;

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

function render() {
  drawField();
  drawGoalPost();
  drawDefenders();
  drawBlockers();
  drawRunner();
}

// ---- Game loop (ends the return on tackle/touchdown, same as the real
// game) -----------------------------------------------------------------
function tick(now) {
  const dtSec = Math.min((now - lastFrameAt) / 1000, 0.05);
  lastFrameAt = now;

  if (runner.state === 'running') {
    updateRunner(dtSec);
    if (runner.state === 'running') {
      updateBlockers();
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

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// A brief non-interactive beat before control hands over — identical to the
// real game's.
async function playCatchAnimation() {
  runner.state = 'catching';
  const CATCH_ANIMATION_MS = 1400;
  const start = performance.now();
  while (performance.now() - start < CATCH_ANIMATION_MS) {
    const t = (performance.now() - start) / CATCH_ANIMATION_MS;
    drawField();
    drawBlockers();
    drawRunner();
    ctx.fillStyle = '#8a4b26';
    const ballX = RUNNER_SCREEN_X + 260 - t * 260;
    ctx.beginPath();
    ctx.ellipse(ballX, screenYLateral(runner.worldX), 8, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#eaf3ec';
    ctx.font = 'bold 20px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Kickoff...', CANVAS_WIDTH / 2, 60);
    await new Promise((r) => requestAnimationFrame(r));
  }
}

// ---- Session lifecycle (mirrors play-kickoff-return.js's startReturn/
// finishReturn/init, minus the server round-trip — scoring and the
// difficulty ladder are computed locally with the same formulas instead of
// POSTing to /kickoff-return/submit and /next) -------------------------------
function presentCurrentReturnLocal() {
  return {
    index: player.currentIndex,
    defenderCount: defenderCountFor(player.difficultyLevel),
    defenderSpeed: defenderSpeedFor(player.difficultyLevel),
  };
}

async function startReturn(returnConfig) {
  currentReturnConfig = returnConfig;
  runner.worldX = 0;
  runner.worldY = 0;
  runner.lateralDir = 'none';
  runner.lastLateralDir = null;
  runner.vx = 0;
  runner.vy = 0;
  blockers = BLOCKER_OFFSETS.map(() => ({ worldX: 0, worldY: 0 }));
  updateBlockers();
  defenders = [];
  spawnSchedule = scheduleDefenders(returnConfig.defenderCount);

  document.getElementById('krt-return-info').textContent = `Return ${returnConfig.index + 1} of ${RETURNS_PER_PLAYER}`;
  document.getElementById('krt-result').textContent = '';
  document.getElementById('krt-next-btn').style.display = 'none';

  await playCatchAnimation();
  runner.state = 'running';
  lastFrameAt = performance.now();
  stopLoop();
  animationHandle = requestAnimationFrame(tick);
}

let lastAttempt = null; // {yardsGained, touchdown} — read by the Next Return handler to advance the ladder

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
  await wait(1400);

  // Local equivalent of kickoffReturn.js's submitReturn(): same
  // normalization (touchdown always means exactly fieldYards) and scoring.
  const clampedYards = clampNum(Math.round(yardsGained), 0, fieldYards);
  const finalTouchdown = touchdown || clampedYards >= fieldYards;
  const finalYards = finalTouchdown ? fieldYards : clampedYards;
  const points = finalYards * YARDS_PER_POINT + (finalTouchdown ? TOUCHDOWN_BONUS : 0);
  player.totalPoints += points;
  player.totalYards += finalYards;
  if (finalTouchdown) player.touchdowns += 1;
  lastAttempt = { yardsGained: finalYards, touchdown: finalTouchdown };

  const resultEl = document.getElementById('krt-result');
  resultEl.textContent = finalTouchdown
    ? `Touchdown! ${finalYards} yards — +${points.toFixed(1)} points`
    : `Tackled after ${finalYards} yards — +${points.toFixed(1)} points`;
  resultEl.style.color = finalTouchdown ? '#4ade80' : '#ef4444';
  document.getElementById('krt-next-btn').style.display = 'inline-block';
}

document.getElementById('krt-start-btn').addEventListener('click', () => {
  document.getElementById('krt-start-btn').style.display = 'none';
  startReturn(presentCurrentReturnLocal());
});

document.getElementById('krt-next-btn').addEventListener('click', () => {
  // Local equivalent of kickoffReturn.js's advanceToNext() — off the
  // just-completed attempt and the pre-increment level, same as the server.
  player.difficultyLevel = nextLevelFor(player.difficultyLevel, lastAttempt.yardsGained, lastAttempt.touchdown);
  player.currentIndex += 1;
  if (player.currentIndex >= RETURNS_PER_PLAYER) {
    player.completed = true;
    document.getElementById('krt-next-btn').style.display = 'none';
    document.getElementById('krt-session-done').style.display = 'block';
    document.getElementById('krt-session-done').textContent =
      `Session finished — ${player.totalPoints.toFixed(1)} points, ${player.touchdowns} touchdown${player.touchdowns === 1 ? '' : 's'}, ${player.totalYards} total yards.`;
    document.getElementById('krt-restart-btn').style.display = 'inline-block';
  } else {
    startReturn(presentCurrentReturnLocal());
  }
});

document.getElementById('krt-restart-btn').addEventListener('click', () => {
  stopLoop();
  player = freshPlayer();
  defenders = [];
  spawnSchedule = [];
  runner.worldX = 0;
  runner.worldY = 0;
  runner.state = 'idle';
  document.getElementById('krt-result').textContent = '';
  document.getElementById('krt-session-done').style.display = 'none';
  document.getElementById('krt-restart-btn').style.display = 'none';
  currentReturnConfig = presentCurrentReturnLocal();
  document.getElementById('krt-return-info').textContent = `Return 1 of ${RETURNS_PER_PLAYER}`;
  render();
  document.getElementById('krt-start-btn').style.display = 'inline-block';
});

// ---- Dev tools wiring (jump/spawn/place — supplementary, act on whatever
// return is currently in progress; see the panel's own hint text) ----------
document.querySelectorAll('[data-jump]').forEach((btn) => {
  btn.addEventListener('click', () => {
    runner.worldY = Number(btn.dataset.jump);
    runner.worldX = 0;
    if (animationHandle == null) render(); // instant feedback even if no loop is currently running
  });
});

const levelInput = document.getElementById('krt-level');
const levelReadout = document.getElementById('krt-level-readout');
function updateLevelReadout() {
  const level = Number(levelInput.value);
  const count = defenderCountFor(level);
  const speed = defenderSpeedFor(level);
  levelReadout.textContent = `Level ${level} → ${count} defenders, ${speed.toFixed(2)}x speed`;
}
levelInput.addEventListener('input', updateLevelReadout);
updateLevelReadout();

document.getElementById('krt-spawn-wave').addEventListener('click', () => {
  const level = Number(levelInput.value);
  // Spawn every scheduled defender immediately, unlike the real game's
  // lead-distance gating (SPAWN_LEAD_YARDS) — that's meant to pace a
  // return you're actually running, but this dev tool is for instant
  // inspection regardless of whether the runner is currently moving.
  const schedule = scheduleDefenders(defenderCountFor(level));
  schedule.forEach((entry) => {
    defenders.push(makeDefender(entry.worldX, entry.worldY, 'approaching', null));
  });
  if (animationHandle == null) render();
});

document.getElementById('krt-clear-defenders').addEventListener('click', () => {
  defenders = [];
  spawnSchedule = [];
  if (animationHandle == null) render();
});

// Click-to-place: convert the click's canvas-pixel position back to world
// yards (the inverse of screenXForward/screenYLateral) and drop a defender
// there in whatever state/side the toolbar has selected.
canvas.addEventListener('click', (e) => {
  const rect = canvas.getBoundingClientRect();
  const px = (e.clientX - rect.left) * (CANVAS_WIDTH / rect.width);
  const py = (e.clientY - rect.top) * (CANVAS_HEIGHT / rect.height);
  const worldY = cameraWorldY() - (px - RUNNER_SCREEN_X) / PX_PER_YARD_FORWARD;
  const worldX = (py - CANVAS_HEIGHT / 2) / PX_PER_YARD_LATERAL;
  const state = document.getElementById('krt-place-state').value;
  const side = document.getElementById('krt-place-side').value;
  defenders.push(makeDefender(worldX, worldY, state, state === 'approaching' ? null : side));
  if (animationHandle == null) render();
});

// ---- Init: render one static idle frame and wait for "Start Return" ------
currentReturnConfig = presentCurrentReturnLocal();
document.getElementById('krt-return-info').textContent = `Return 1 of ${RETURNS_PER_PLAYER}`;
render();
