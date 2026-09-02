// Kickoff Return — graphics test sandbox. NOT wired to any game state, API,
// league, or server — a pure visual tool for judging the field/stadium/
// player rendering directly, same idea as the earlier fg3d-test.html/js
// prototype used to iterate on the 3D Field Goal scene before it shipped.
// The simulation code below (movement, defender AI, drawing) is copied
// verbatim from public/js/play-kickoff-return.js — keep the two in sync by
// hand if the real game's rendering changes; this file has no build step
// or import to do that automatically. Not linked from anywhere on the site.

// ---- Canvas / world setup -------------------------------------------------
const canvas = document.getElementById('kr-canvas');
const ctx = canvas.getContext('2d');
const CANVAS_WIDTH = canvas.width;
const CANVAS_HEIGHT = canvas.height;

const FIELD_WIDTH_YARDS = 53.3;
const RUNNER_HALF_WIDTH = 0.6;
const STADIUM_MARGIN_PX = 34;
const FIELD_LEFT_PX = STADIUM_MARGIN_PX;
const FIELD_RIGHT_PX = CANVAS_WIDTH - STADIUM_MARGIN_PX;
const PX_PER_YARD_X = (FIELD_RIGHT_PX - FIELD_LEFT_PX) / FIELD_WIDTH_YARDS;
const PX_PER_YARD_Y = 14;
const RUNNER_SCREEN_Y = CANVAS_HEIGHT * 0.68;
const START_FIELD_POSITION = 20;
const OWN_GOAL_WORLD_Y = -START_FIELD_POSITION;

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

function worldToScreenX(worldX) {
  return CANVAS_WIDTH / 2 + worldX * PX_PER_YARD_X;
}
function cameraMaxWorldY() {
  return fieldYards + (BACKDROP_DEPTH_PX - RUNNER_SCREEN_Y) / PX_PER_YARD_Y;
}
function cameraWorldY() {
  return Math.min(runner.worldY, cameraMaxWorldY());
}
function worldToScreenY(worldY) {
  return RUNNER_SCREEN_Y - (worldY - cameraWorldY()) * PX_PER_YARD_Y;
}
function clampNum(x, min, max) {
  return Math.max(min, Math.min(max, x));
}

// ---- Tunable constants (mirrors play-kickoff-return.js exactly) -----------
const RUNNER_FORWARD_SPEED = 9;
const RUNNER_BACKWARD_SPEED = 4;
const RUNNER_LATERAL_SPEED = 7;

const EVADE_BURST_SPEED = 12;
const EVADE_WINDOW_MS = 250;
const EVADE_COOLDOWN_MS = 500;

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

// ---- Sandbox state ----------------------------------------------------------
let fieldYards = 80;
let currentReturnConfig = { index: 0, defenderCount: BASE_DEFENDER_COUNT, defenderSpeed: BASE_DEFENDER_SPEED };

const runner = {
  worldX: 0, worldY: 0,
  lateralDir: 'none', lastLateralDir: null,
  evasiveSide: null, evasiveUntil: 0, nextEvasiveAllowedAt: 0,
  state: 'running', // sandbox starts already running — no catch gate, no server round-trip
  vx: 0, vy: 0,
};

let defenders = [];
let spawnSchedule = [];
let animationHandle = null;
let lastFrameAt = 0;

// ---- Input ------------------------------------------------------------------
const heldKeys = new Set();
const ARROW_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
window.addEventListener('keydown', (e) => {
  if (ARROW_KEYS.has(e.key)) e.preventDefault();
  heldKeys.add(e.key);
  if (e.key === 'z' || e.key === 'Z') tryEvade('juke');
  if (e.key === 'x' || e.key === 'X') tryEvade('spin');
});
window.addEventListener('keyup', (e) => {
  heldKeys.delete(e.key);
});

function tryEvade(kind) {
  if (runner.state !== 'running') return;
  const now = performance.now();
  if (now < runner.nextEvasiveAllowedAt) return;
  let side;
  if (kind === 'juke') {
    if (runner.lateralDir === 'none') return;
    side = runner.lateralDir;
  } else {
    const base = runner.lateralDir !== 'none' ? runner.lateralDir : runner.lastLateralDir;
    if (!base) return;
    side = base === 'left' ? 'right' : 'left';
  }
  runner.evasiveSide = side;
  runner.evasiveUntil = now + EVADE_WINDOW_MS;
  runner.nextEvasiveAllowedAt = now + EVADE_COOLDOWN_MS;
}

function currentRunnerSide() {
  if (performance.now() < runner.evasiveUntil) return runner.evasiveSide;
  return runner.lateralDir;
}

// ---- Runner movement (unchanged from the real game, minus the touchdown/
// tackle end-of-return handling — the sandbox just keeps going) ------------
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

  const mag = Math.hypot(vx, vy);
  if (mag > 0) { vx /= mag; vy /= mag; }

  const forwardSpeed = vy >= 0 ? RUNNER_FORWARD_SPEED : RUNNER_BACKWARD_SPEED;
  const worldYVelocity = vy * forwardSpeed;
  // No upper clamp at fieldYards here — the sandbox lets you run past the
  // goal line into the end zone/stadium on purpose, to inspect that view.
  runner.worldY = Math.max(0, runner.worldY + worldYVelocity * dtSec);

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

  runner.vx = worldXVelocity;
  runner.vy = worldYVelocity;

  if (left && !right) { runner.lateralDir = 'left'; runner.lastLateralDir = 'left'; }
  else if (right && !left) { runner.lateralDir = 'right'; runner.lastLateralDir = 'right'; }
  else runner.lateralDir = 'none';
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
        const lateralLead = d.committedSide === 'left' ? -DEFENDER_LUNGE_LATERAL_LEAD
          : d.committedSide === 'right' ? DEFENDER_LUNGE_LATERAL_LEAD : 0;
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
        // Sandbox doesn't end the "return" on a hit — just recovers, so you
        // can keep testing without resetting.
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

function drawStadiumSides() {
  [{ x0: 0, x1: FIELD_LEFT_PX, side: 0 }, { x0: FIELD_RIGHT_PX, x1: CANVAS_WIDTH, side: 1 }].forEach(({ x0, x1, side }) => {
    const roofEdgeX = side === 0 ? x0 + 6 : x1 - 6;

    const lowerW = (x1 - x0) * 0.62;
    const lowerX = side === 0 ? x1 - lowerW : x0;
    ctx.fillStyle = '#17293b';
    ctx.fillRect(lowerX, 0, lowerW, CANVAS_HEIGHT);
    drawSeatedDeck(lowerX, 0, lowerW, CANVAS_HEIGHT, false, side * 97);

    const upperX0 = x0;
    const upperX1 = lowerX;
    ctx.fillStyle = '#070d13';
    ctx.fillRect(side === 0 ? upperX1 - 2 : upperX1, 0, 2, CANVAS_HEIGHT);

    const upperW = upperX1 - upperX0;
    ctx.fillStyle = '#101c29';
    ctx.fillRect(upperX0, 0, upperW, CANVAS_HEIGHT);
    drawSeatedDeck(upperX0, 0, upperW, CANVAS_HEIGHT, false, side * 97 + 1000);

    ctx.fillStyle = '#050a0f';
    ctx.fillRect(side === 0 ? 0 : CANVAS_WIDTH - 4, 0, 4, CANVAS_HEIGHT);

    for (let ly = 60; ly < CANVAS_HEIGHT; ly += 150) {
      const lx = roofEdgeX;
      ctx.strokeStyle = '#5a6672';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(lx, ly - 10);
      ctx.lineTo(lx, ly + 10);
      ctx.stroke();
      ctx.fillStyle = '#eef3f8';
      ctx.beginPath();
      ctx.arc(lx, ly, 2.4, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = '#e4e4e4';
    ctx.fillRect(side === 0 ? x1 - 3 : x0, 0, 3, CANVAS_HEIGHT);
  });
}

function drawField() {
  drawStadiumSides();

  ctx.fillStyle = '#2c6438';
  ctx.fillRect(FIELD_LEFT_PX, 0, FIELD_RIGHT_PX - FIELD_LEFT_PX, CANVAS_HEIGHT);

  const startYard = Math.floor(cameraWorldY() / 5) * 5 - 20;
  const endYard = startYard + 90;
  for (let y = startYard; y < endYard; y += 5) {
    if (y + 5 < OWN_GOAL_WORLD_Y || y > fieldYards) continue;
    const yTop = clampNum(y, OWN_GOAL_WORLD_Y, fieldYards);
    const yBottom = clampNum(y + 5, OWN_GOAL_WORLD_Y, fieldYards);
    const screenTop = worldToScreenY(yBottom);
    const screenBottom = worldToScreenY(yTop);
    const band = Math.round(y / 5);
    ctx.fillStyle = band % 2 === 0 ? '#2c6438' : '#316f3f';
    ctx.fillRect(FIELD_LEFT_PX, screenTop, FIELD_RIGHT_PX - FIELD_LEFT_PX, screenBottom - screenTop);
  }

  ctx.textAlign = 'center';
  for (let y = startYard; y <= endYard; y += 5) {
    if (y < OWN_GOAL_WORLD_Y || y > fieldYards) continue;
    const screenY = worldToScreenY(y);
    if (screenY < -20 || screenY > CANVAS_HEIGHT + 20) continue;
    const isTenYard = y % 10 === 0;
    ctx.strokeStyle = isTenYard ? 'rgba(255,255,255,0.65)' : 'rgba(255,255,255,0.4)';
    ctx.lineWidth = isTenYard ? 2 : 1.3;
    ctx.beginPath();
    ctx.moveTo(FIELD_LEFT_PX, screenY);
    ctx.lineTo(FIELD_RIGHT_PX, screenY);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 2;
    [FIELD_LEFT_PX + (FIELD_RIGHT_PX - FIELD_LEFT_PX) * 0.28, FIELD_LEFT_PX + (FIELD_RIGHT_PX - FIELD_LEFT_PX) * 0.72].forEach((hx) => {
      ctx.beginPath();
      ctx.moveTo(hx - 5, screenY);
      ctx.lineTo(hx + 5, screenY);
      ctx.stroke();
    });
    if (isTenYard) {
      const label = fieldPositionLabel(y);
      ctx.font = 'bold 16px sans-serif';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(15,35,20,0.6)';
      ctx.strokeText(label, CANVAS_WIDTH / 2, screenY - 8);
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fillText(label, CANVAS_WIDTH / 2, screenY - 8);
    }
  }

  const goalScreenY = worldToScreenY(fieldYards);
  if (goalScreenY < CANVAS_HEIGHT + 80) {
    const ezTop = Math.max(-80, goalScreenY - EZ_DEPTH_PX);
    const ezBottom = goalScreenY;
    ctx.fillStyle = '#1f4a29';
    ctx.fillRect(FIELD_LEFT_PX, ezTop, FIELD_RIGHT_PX - FIELD_LEFT_PX, ezBottom - ezTop);
    ctx.save();
    ctx.beginPath();
    ctx.rect(FIELD_LEFT_PX, ezTop, FIELD_RIGHT_PX - FIELD_LEFT_PX, ezBottom - ezTop);
    ctx.clip();
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = 'bold 15px sans-serif';
    ctx.fillText('E N D   Z O N E', CANVAS_WIDTH / 2, (ezTop + ezBottom) / 2 + 4);
    ctx.restore();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(FIELD_LEFT_PX, goalScreenY);
    ctx.lineTo(FIELD_RIGHT_PX, goalScreenY);
    ctx.stroke();

    const deckBottom = ezTop;
    const deckSplit = deckBottom - STADIUM_DECK_DEPTH_PX * 0.58;
    const roofBottom = deckBottom - STADIUM_DECK_DEPTH_PX;
    const roofTop = roofBottom - STADIUM_ROOF_DEPTH_PX;
    if (deckBottom > -20) {
      ctx.fillStyle = '#17293b';
      ctx.fillRect(0, deckSplit, CANVAS_WIDTH, deckBottom - deckSplit);
      drawSeatedDeck(0, deckSplit, CANVAS_WIDTH, deckBottom - deckSplit, true, 2000);
      ctx.fillStyle = '#070d13';
      ctx.fillRect(0, deckSplit - 2, CANVAS_WIDTH, 2);
      ctx.fillStyle = '#101c29';
      ctx.fillRect(0, roofBottom, CANVAS_WIDTH, deckSplit - roofBottom);
      drawSeatedDeck(0, roofBottom, CANVAS_WIDTH, deckSplit - roofBottom, true, 3000);
      ctx.fillStyle = '#050a0f';
      ctx.fillRect(0, roofTop, CANVAS_WIDTH, roofBottom - roofTop);
      for (let lx = FIELD_LEFT_PX + 30; lx < FIELD_RIGHT_PX; lx += 90) {
        ctx.strokeStyle = '#5a6672';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(lx, roofTop + 4);
        ctx.lineTo(lx, roofTop - 14);
        ctx.stroke();
        ctx.fillStyle = '#eef3f8';
        ctx.fillRect(lx - 6, roofTop - 19, 12, 7);
      }
    }
  }

  const ownGoalScreenY = worldToScreenY(OWN_GOAL_WORLD_Y);
  if (ownGoalScreenY < CANVAS_HEIGHT + 80) {
    const ownEzTop = ownGoalScreenY;
    const ownEzBottom = Math.min(CANVAS_HEIGHT + 80, ownGoalScreenY + EZ_DEPTH_PX);
    ctx.fillStyle = '#1f4a29';
    ctx.fillRect(FIELD_LEFT_PX, ownEzTop, FIELD_RIGHT_PX - FIELD_LEFT_PX, ownEzBottom - ownEzTop);
    ctx.save();
    ctx.beginPath();
    ctx.rect(FIELD_LEFT_PX, ownEzTop, FIELD_RIGHT_PX - FIELD_LEFT_PX, ownEzBottom - ownEzTop);
    ctx.clip();
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = 'bold 15px sans-serif';
    ctx.fillText('E N D   Z O N E', CANVAS_WIDTH / 2, (ownEzTop + ownEzBottom) / 2 + 4);
    ctx.restore();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(FIELD_LEFT_PX, ownGoalScreenY);
    ctx.lineTo(FIELD_RIGHT_PX, ownGoalScreenY);
    ctx.stroke();
    ctx.fillStyle = '#111c27';
    ctx.fillRect(0, ownEzBottom, CANVAS_WIDTH, Math.max(0, CANVAS_HEIGHT - ownEzBottom));
  }

  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.fillRect(FIELD_LEFT_PX - 5, 0, 5, CANVAS_HEIGHT);
  ctx.fillRect(FIELD_RIGHT_PX, 0, 5, CANVAS_HEIGHT);
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.fillRect(FIELD_LEFT_PX - 5, 0, 2, CANVAS_HEIGHT);
  ctx.fillRect(FIELD_RIGHT_PX + 3, 0, 2, CANVAS_HEIGHT);
}

function drawGoalPost() {
  const goalScreenY = worldToScreenY(fieldYards);
  const baseY = goalScreenY - GOALPOST_DEPTH_PX;
  if (baseY < -70 || baseY > CANVAS_HEIGHT + 70) return;
  const baseX = worldToScreenX(0);
  const uprightOffsetPx = 3.08 * PX_PER_YARD_X;
  const crossbarY = baseY - 16;
  const uprightTopY = baseY - 52;

  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.ellipse(baseX, baseY, 5, 2.5, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = '#ffd400';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(baseX, baseY);
  ctx.lineTo(baseX, crossbarY);
  ctx.stroke();
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  ctx.moveTo(baseX - uprightOffsetPx, crossbarY);
  ctx.lineTo(baseX + uprightOffsetPx, crossbarY);
  ctx.stroke();
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(baseX - uprightOffsetPx, crossbarY);
  ctx.lineTo(baseX - uprightOffsetPx, uprightTopY);
  ctx.moveTo(baseX + uprightOffsetPx, crossbarY);
  ctx.lineTo(baseX + uprightOffsetPx, uprightTopY);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(baseX - 1, baseY);
  ctx.lineTo(baseX - 1, crossbarY);
  ctx.stroke();
}

function drawRunner() {
  const x = worldToScreenX(runner.worldX);
  const y = worldToScreenY(runner.worldY);
  const moving = Math.abs(runner.vx) + Math.abs(runner.vy) > 0.5;
  const legPhase = moving ? performance.now() / 90 : 0;

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
  drawRunner();
}

// ---- Game loop ---------------------------------------------------------
function tick(now) {
  const dtSec = Math.min((now - lastFrameAt) / 1000, 0.05);
  lastFrameAt = now;

  if (runner.state === 'running') {
    updateRunner(dtSec);
    updateDefenders(dtSec);
  }
  render();
  animationHandle = requestAnimationFrame(tick);
}

function stopLoop() {
  if (animationHandle != null) cancelAnimationFrame(animationHandle);
  animationHandle = null;
}

// A cosmetic-only replay of the real game's catch animation, for judging
// that piece in isolation — doesn't gate anything here (control never
// hands off since the sandbox has no "running" state to switch into).
async function replayCatchAnimation() {
  stopLoop();
  const priorState = runner.state;
  runner.state = 'catching';
  const CATCH_ANIMATION_MS = 1400;
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
  runner.state = priorState;
  lastFrameAt = performance.now();
  animationHandle = requestAnimationFrame(tick);
}

// ---- Sandbox UI wiring ---------------------------------------------------
document.querySelectorAll('[data-jump]').forEach((btn) => {
  btn.addEventListener('click', () => {
    runner.worldY = Number(btn.dataset.jump);
    runner.worldX = 0;
  });
});

document.getElementById('krt-replay-catch').addEventListener('click', () => {
  replayCatchAnimation();
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
  currentReturnConfig = { index: 0, defenderCount: defenderCountFor(level), defenderSpeed: defenderSpeedFor(level) };
  spawnSchedule = scheduleDefenders(currentReturnConfig.defenderCount);
});

document.getElementById('krt-clear-defenders').addEventListener('click', () => {
  defenders = [];
  spawnSchedule = [];
});

// Click-to-place: convert the click's canvas-pixel position back to world
// yards (the inverse of worldToScreenX/Y) and drop a defender there in
// whatever state/side the toolbar has selected.
canvas.addEventListener('click', (e) => {
  const rect = canvas.getBoundingClientRect();
  const px = (e.clientX - rect.left) * (CANVAS_WIDTH / rect.width);
  const py = (e.clientY - rect.top) * (CANVAS_HEIGHT / rect.height);
  const worldX = (px - CANVAS_WIDTH / 2) / PX_PER_YARD_X;
  const worldY = cameraWorldY() - (py - RUNNER_SCREEN_Y) / PX_PER_YARD_Y;
  const state = document.getElementById('krt-place-state').value;
  const side = document.getElementById('krt-place-side').value;
  defenders.push(makeDefender(worldX, worldY, state, state === 'approaching' ? null : side));
});

lastFrameAt = performance.now();
animationHandle = requestAnimationFrame(tick);
