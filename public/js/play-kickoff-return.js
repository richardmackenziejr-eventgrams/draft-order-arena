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
const PX_PER_YARD_X = CANVAS_WIDTH / FIELD_WIDTH_YARDS;
const PX_PER_YARD_Y = 14;
const RUNNER_SCREEN_Y = CANVAS_HEIGHT * 0.68; // the runner is always drawn here; the world scrolls around it

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
function drawField() {
  ctx.fillStyle = '#2f6b3f';
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

  // Alternating 5-yard stripes + yard numbers, scrolling with the runner.
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = 2;
  ctx.font = 'bold 16px sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.textAlign = 'center';
  const startYard = Math.floor(runner.worldY / 5) * 5 - 20;
  const endYard = startYard + 90;
  for (let y = startYard; y <= endYard; y += 5) {
    if (y < 0 || y > fieldYards) continue;
    const screenY = worldToScreenY(y);
    if (screenY < -20 || screenY > CANVAS_HEIGHT + 20) continue;
    ctx.beginPath();
    ctx.moveTo(0, screenY);
    ctx.lineTo(CANVAS_WIDTH, screenY);
    ctx.stroke();
    if (y % 10 === 0) {
      const label = y === fieldYards ? 'GOAL' : String(Math.round(y));
      ctx.fillText(label, CANVAS_WIDTH / 2, screenY - 6);
    }
  }

  // End zone shading near the goal line.
  const goalScreenY = worldToScreenY(fieldYards);
  if (goalScreenY > -60 && goalScreenY < CANVAS_HEIGHT + 60) {
    ctx.fillStyle = 'rgba(74, 222, 128, 0.18)';
    ctx.fillRect(0, Math.max(0, goalScreenY - 60), CANVAS_WIDTH, 60);
  }
}

function drawRunner() {
  const x = worldToScreenX(runner.worldX);
  const y = RUNNER_SCREEN_Y;
  ctx.fillStyle = '#2f5fbf';
  ctx.fillRect(x - 9, y - 12, 18, 20);
  ctx.fillStyle = '#f0d9a0';
  ctx.beginPath();
  ctx.arc(x, y - 18, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#eceff1';
  ctx.fillText('1', x, y + 2);
}

function drawDefenders() {
  for (const d of defenders) {
    const x = worldToScreenX(d.worldX);
    const y = worldToScreenY(d.worldY);
    if (y < -30 || y > CANVAS_HEIGHT + 30) continue;

    ctx.fillStyle = '#c0392b';
    ctx.fillRect(x - 8, y - 11, 16, 18);
    ctx.fillStyle = '#e8b98a';
    ctx.beginPath();
    ctx.arc(x, y - 16, 6, 0, Math.PI * 2);
    ctx.fill();

    if (d.state === 'windingUp') {
      // The telegraph: a flashing icon over the defender showing which way
      // they've committed — the whole "tell" the player reacts to.
      const flashing = Math.floor(performance.now() / 120) % 2 === 0;
      ctx.fillStyle = flashing ? '#ffcc33' : '#fff3c4';
      ctx.font = 'bold 20px sans-serif';
      const icon = d.committedSide === 'left' ? '⬅' : d.committedSide === 'right' ? '➡' : '❗';
      ctx.fillText(icon, x, y - 30);
      ctx.font = 'bold 16px sans-serif';
    } else if (d.state === 'lunging') {
      ctx.strokeStyle = '#ffe08a';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x - 10, y);
      ctx.lineTo(x + 10, y);
      ctx.stroke();
    }
  }
}

function drawHud() {
  ctx.fillStyle = 'rgba(8, 16, 12, 0.55)';
  ctx.fillRect(0, 0, CANVAS_WIDTH, 30);
  ctx.fillStyle = '#eaf3ec';
  ctx.font = 'bold 15px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(`Return ${currentReturnConfig.index + 1} of ${returnsPerPlayer}`, 10, 20);
  ctx.textAlign = 'right';
  const yardsToGo = Math.max(0, Math.round(fieldYards - runner.worldY));
  ctx.fillText(`${yardsToGo} yd to go`, CANVAS_WIDTH - 10, 20);
  ctx.textAlign = 'center';
}

function render() {
  drawField();
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
