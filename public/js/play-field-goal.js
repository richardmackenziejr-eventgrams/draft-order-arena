const instanceId = qs('instance');
const leagueId = qs('league');
const memberId = qs('member');
document.getElementById('back-link').href = leagueId ? `/member-home.html?league=${leagueId}` : '/';

let powerPeriodMs = 1000;
let directionPeriodMs = 1000;

let powerAnimId = null;
let directionAnimId = null;

// The exact server-provided start times the meters currently on screen are
// animating from — kept around so a click handler can measure "how long
// was I actually looking at this before I clicked" itself, in the same
// Date.now()-startedAt terms the animation is drawn in, and send THAT to
// the server rather than let the server's own (network-latency-delayed)
// receipt time silently score a different moment than what was on screen.
let currentPowerStartedAt = null;
let currentDirectionStartedAt = null;

// Same deterministic triangle wave the server scores with (0 -> 1 -> 0 over
// one period) — used here purely to draw the marker; the server trusts the
// client's own elapsed-time reading at click time (see resolveElapsed() in
// lib/gameEngine/fieldGoal.js for why), not its own receipt time.
function trianglePosition(elapsedMs, periodMs) {
  const cycle = ((elapsedMs % periodMs) + periodMs) % periodMs;
  const t = cycle / periodMs;
  return t < 0.5 ? t * 2 : 2 - t * 2;
}

function stopAnimations() {
  if (powerAnimId) cancelAnimationFrame(powerAnimId);
  if (directionAnimId) cancelAnimationFrame(directionAnimId);
  powerAnimId = null;
  directionAnimId = null;
}

function animatePower(startedAt) {
  currentPowerStartedAt = startedAt;
  const marker = document.getElementById('power-marker');
  function frame() {
    const pos = trianglePosition(Date.now() - startedAt, powerPeriodMs);
    marker.style.bottom = `${pos * 100}%`;
    powerAnimId = requestAnimationFrame(frame);
  }
  frame();
}

function animateDirection(startedAt) {
  currentDirectionStartedAt = startedAt;
  const marker = document.getElementById('direction-marker');
  function frame() {
    const pos = trianglePosition(Date.now() - startedAt, directionPeriodMs);
    marker.style.left = `${pos * 100}%`;
    directionAnimId = requestAnimationFrame(frame);
  }
  frame();
}

// The green band's width isn't fixed anymore — it's sized per-kick to that
// kick's distance (narrower for longer kicks), so this repaints every kick
// rather than once.
function paintPowerZone(sweetHalf) {
  const sweet = document.getElementById('power-sweet');
  sweet.style.bottom = `${(0.5 - sweetHalf) * 100}%`;
  sweet.style.height = `${sweetHalf * 2 * 100}%`;
}

// The direction meter sits idle (dimmed, disabled, marker parked dead
// center) until power gets locked in — it only "wakes up" then.
function setDirectionIdle() {
  document.getElementById('direction-track').classList.add('idle');
  document.getElementById('direction-stop-btn').disabled = true;
  document.getElementById('direction-marker').style.left = '50%';
}

function setDirectionActive(startedAt) {
  document.getElementById('direction-track').classList.remove('idle');
  document.getElementById('direction-stop-btn').disabled = false;
  animateDirection(startedAt);
}

function renderWindOverlay(k) {
  const el = document.getElementById('wind-overlay');
  if (k.windDir === 'calm') {
    el.textContent = 'Calm';
    return;
  }
  const arrow = k.windDir === 'left' ? '←' : '→';
  el.textContent = `${arrow} ${k.windMph} mph`;
}

function hideResultOverlay() {
  document.getElementById('result-overlay').style.display = 'none';
}

function outcomeText(outcome, distance) {
  if (outcome.outcome === 'made') return `IT'S GOOD! ${distance} yards — +${outcome.points} point${outcome.points === 1 ? '' : 's'}`;
  if (outcome.outcome === 'short') return "NO GOOD — didn't have the distance. Time the power meter's green zone better.";
  if (outcome.outcome === 'wide-left') return 'WIDE LEFT!';
  if (outcome.outcome === 'wide-right') return 'WIDE RIGHT!';
  return outcome.outcome;
}

// Both meters freeze right where they were clicked and stay visible behind
// the result card, instead of disappearing — a nice "here's what actually
// happened" recap alongside the call. When `animate` is true (a kick just
// resolved live), the ball flies to its outcome and both referees throw
// their signal before the result card appears; when false (restoring an
// already-resolved kick, e.g. a page refresh), everything just jumps
// straight to its final state — no need to replay the show twice.
async function freezeAndShowResult(k, animate) {
  stopAnimations();
  document.getElementById('power-marker').style.bottom = `${(k.powerPos || 0) * 100}%`;
  document.getElementById('direction-marker').style.left = `${(k.attempt.directionPos || 0) * 100}%`;
  document.getElementById('direction-track').classList.remove('idle');
  document.getElementById('power-stop-btn').disabled = true;
  document.getElementById('direction-stop-btn').disabled = true;

  if (animate) {
    await animateKickerApproach();
    // The swing is what "hits" the ball, so it starts at the same instant
    // the ball's flight does — wait for both together.
    await Promise.all([animateKickerSwing(), animateBallFlight(k.attempt.outcome)]);
    await animateReferees(k.attempt.made);
  } else {
    showBallAtFinalSpot(k.attempt.outcome);
    setRefereeFinalPose(k.attempt.made);
  }

  const el = document.getElementById('result-text');
  el.textContent = outcomeText(k.attempt, k.distance);
  el.className = `fg-result ${k.attempt.made ? 'made' : 'missed'}`;
  document.getElementById('result-overlay').style.display = 'flex';
}

function renderKick(gi) {
  const k = gi.currentKick;
  powerPeriodMs = gi.powerPeriodMs || powerPeriodMs;
  directionPeriodMs = gi.directionPeriodMs || directionPeriodMs;

  document.getElementById('kick-panel').style.display = 'block';
  document.getElementById('done-panel').style.display = 'none';
  document.getElementById('status-line').textContent = `Kick ${k.index + 1} of ${k.total}`;
  document.getElementById('kick-info').textContent = `${k.distance} yard Field Goal`;
  renderWindOverlay(k);

  stopAnimations();
  resetBall();
  resetReferees();
  resetKicker();
  showTeeBall();
  paintPowerZone(k.powerSweetHalf);

  if (k.phase === 'result') {
    freezeAndShowResult(k, false); // already resolved — restore instantly, don't replay
    return;
  }

  hideResultOverlay();

  if (k.phase === 'direction') {
    // Power's already locked — freeze its marker right where it landed
    // instead of animating, and hand control over to the direction meter.
    document.getElementById('power-marker').style.bottom = `${(k.powerPos || 0) * 100}%`;
    document.getElementById('power-stop-btn').disabled = true;
    setDirectionActive(k.directionStartedAt);
  } else {
    document.getElementById('power-stop-btn').disabled = false;
    animatePower(k.powerStartedAt);
    setDirectionIdle();
  }
}

document.getElementById('power-stop-btn').addEventListener('click', async () => {
  const btn = document.getElementById('power-stop-btn');
  if (btn.disabled) return;
  // Measured first, before anything else runs — this is what the player
  // actually saw the instant they clicked.
  const elapsedMs = currentPowerStartedAt != null ? Date.now() - currentPowerStartedAt : 0;
  btn.disabled = true;
  stopAnimations();
  // Snap the marker to the exact position this elapsedMs maps to right now,
  // instead of leaving it wherever the last animation frame (up to ~16ms
  // stale) happened to land — the server will confirm this same spot once
  // it responds, so there's nothing left to visibly "jump" to afterward.
  document.getElementById('power-marker').style.bottom = `${trianglePosition(elapsedMs, powerPeriodMs) * 100}%`;
  try {
    const { gameInstance: gi } = await api('POST', `/api/game-instances/${instanceId}/field-goal/power-stop`, { memberId, elapsedMs });
    renderKick(gi); // sets the right disabled state for both buttons based on the new phase
  } catch (err) {
    alert(err.message);
    btn.disabled = false; // only re-enable on failure, so they can retry
  }
});

document.getElementById('direction-stop-btn').addEventListener('click', async () => {
  const btn = document.getElementById('direction-stop-btn');
  if (btn.disabled) return;
  const elapsedMs = currentDirectionStartedAt != null ? Date.now() - currentDirectionStartedAt : 0;
  btn.disabled = true;
  stopAnimations();
  document.getElementById('direction-marker').style.left = `${trianglePosition(elapsedMs, directionPeriodMs) * 100}%`;
  try {
    const { gameInstance: gi } = await api('POST', `/api/game-instances/${instanceId}/field-goal/direction-stop`, { memberId, elapsedMs });
    await freezeAndShowResult(gi.currentKick, true); // ball flight + ref signal, then the result card
  } catch (err) {
    alert(err.message);
    btn.disabled = false;
  }
});

document.getElementById('next-kick-btn').addEventListener('click', async () => {
  const btn = document.getElementById('next-kick-btn');
  btn.disabled = true;
  try {
    const { gameInstance: gi } = await api('POST', `/api/game-instances/${instanceId}/field-goal/next`, { memberId });
    if (gi.status === 'completed') {
      // Whole contest just finished on this move (e.g. a solo test instance,
      // or the last real player to finish) — nothing left to wait on.
      showDone(`Contest finished. You went ${gi.yourMakes}/${gi.kicksPerPlayer} for ${gi.yourScore} point${gi.yourScore === 1 ? '' : 's'}.`);
    } else if (gi.hasCompleted) {
      showDone(`You finished ${gi.yourMakes}/${gi.kicksPerPlayer} for ${gi.yourScore} point${gi.yourScore === 1 ? '' : 's'}! Waiting on the rest of the league…`);
    } else {
      renderKick(gi);
    }
  } catch (err) {
    alert(err.message);
  } finally {
    btn.disabled = false;
  }
});

function showDone(message) {
  stopAnimations();
  hideResultOverlay();
  document.getElementById('kick-panel').style.display = 'none';
  document.getElementById('done-panel').style.display = 'block';
  document.getElementById('done-message').textContent = message;
}

// --- Pre-snap scene: a static illustration of the kick about to happen ---
// (just the kicker and the ball on a tee, distant goalposts behind, a
// referee on each side of the goal line). Built once — it doesn't change
// between kicks; the ball and referee arms animate in place afterward.
function ballOnTeeSvg() {
  return `
    <svg viewBox="0 0 16 22" width="16" height="22" xmlns="http://www.w3.org/2000/svg">
      <rect x="6.7" y="13" width="2.6" height="9" rx="1.2" fill="#d9d9dc" />
      <ellipse cx="8" cy="10.5" rx="6.2" ry="3.8" fill="#8a4b26" transform="rotate(-14 8 10.5)" />
      <path d="M3.3 9.6 L12.7 11.4" stroke="#f2e6d6" stroke-width="0.8" transform="rotate(-14 8 10.5)" />
    </svg>
  `;
}

// Just the ball, no tee — what flies through the air after a kick.
function flyingBallSvg() {
  return `
    <svg viewBox="0 0 16 12" width="16" height="12" xmlns="http://www.w3.org/2000/svg">
      <ellipse cx="8" cy="6" rx="7.2" ry="4.6" fill="#8a4b26" />
      <path d="M2 5.3 L14 6.7" stroke="#f2e6d6" stroke-width="0.9" />
    </svg>
  `;
}

// A referee dedicated to this scene (as opposed to the shared
// refereeFigureSvg() the 40 Yard Dash uses) because its arms need to be
// independently animatable between idle/good/no-good poses — reusing the
// shared one and changing its arm structure would've altered that other
// game's already-shipped look. Idle pose (both arms hanging) is the
// default; .fg-ref-arm-l/.fg-ref-arm-r get rotated via animateReferees().
function signalRefSvg() {
  return `
    <svg viewBox="0 0 24 34" width="34" height="48" xmlns="http://www.w3.org/2000/svg">
      <g class="fg-ref-leg-l">
        <rect x="8" y="23" width="4" height="9" rx="1.6" fill="#1c1c1c" />
        <ellipse cx="10" cy="32.3" rx="2.6" ry="1.4" fill="#050505" />
      </g>
      <g class="fg-ref-leg-r">
        <rect x="12" y="23" width="4" height="9" rx="1.6" fill="#1c1c1c" />
        <ellipse cx="14" cy="32.3" rx="2.6" ry="1.4" fill="#050505" />
      </g>
      <clipPath id="fgRefStripes">
        <path d="M6.5 9 Q6.5 7.2 8.3 7.2 L15.7 7.2 Q17.5 7.2 17.5 9 L16.9 23 Q12 24.4 7.1 23 Z" />
      </clipPath>
      <g clip-path="url(#fgRefStripes)">
        <rect x="6.5" y="7.2" width="2.2" height="17" fill="#f4f4f4" />
        <rect x="8.7" y="7.2" width="2.2" height="17" fill="#151515" />
        <rect x="10.9" y="7.2" width="2.2" height="17" fill="#f4f4f4" />
        <rect x="13.1" y="7.2" width="2.2" height="17" fill="#151515" />
        <rect x="15.3" y="7.2" width="2.2" height="17" fill="#f4f4f4" />
        <rect x="17.5" y="7.2" width="2.2" height="17" fill="#151515" />
      </g>
      <g class="fg-ref-arm-l" style="transform-box: fill-box; transform-origin: top center;">
        <rect x="2.6" y="9.5" width="4" height="9.5" rx="2" fill="#151515" />
      </g>
      <g class="fg-ref-arm-r" style="transform-box: fill-box; transform-origin: top center;">
        <rect x="17.4" y="9.5" width="4" height="9.5" rx="2" fill="#151515" />
      </g>
      <circle cx="12" cy="4.8" r="4.8" fill="#e8b98a" />
      <path d="M7.3 3.1 Q12 -0.8 16.7 3.1 L16.5 4.3 Q12 2.3 7.5 4.3 Z" fill="#151515" />
    </svg>
  `;
}

function buildScene() {
  const el = document.getElementById('fg-scene-bg');
  const offense = '#2a4a78';

  el.innerHTML = `
    <div class="fg-yardline fg-goal-line" style="top:33%"></div>
    <div class="fg-yardline" style="top:58%"></div>
    <div class="fg-goalpost" style="color:#f4c542">${goalpostSvg()}</div>
    <div class="fg-referee fg-referee-left">${signalRefSvg()}</div>
    <div class="fg-referee fg-referee-right">${signalRefSvg()}</div>
    <div class="fg-tee" id="fg-tee">${ballOnTeeSvg()}</div>
    <div class="fg-ball" id="fg-ball" style="display:none">${flyingBallSvg()}</div>
    <div class="fg-kicker" id="fg-kicker" style="color:${offense}">${runnerFigureSvg()}</div>
  `;
}

// The ball's flight path per outcome, as [left%, top%, scale] keyframes —
// tee position, an arc peak, then where it ends up. Shared between the
// animated flight and the "just show me the final spot" restore path.
const BALL_PATHS = {
  made: [[50, 80, 1], [50, 35, 0.7], [50, 12, 0.4]],
  'wide-left': [[50, 80, 1], [38, 35, 0.7], [24, 18, 0.45]],
  'wide-right': [[50, 80, 1], [62, 35, 0.7], [76, 18, 0.45]],
  short: [[50, 80, 1], [50, 58, 0.85], [50, 46, 0.75]],
};

function ballPathFor(outcome) {
  return BALL_PATHS[outcome] || BALL_PATHS.short;
}

function resetBall() {
  const ball = document.getElementById('fg-ball');
  ball.getAnimations().forEach((a) => a.cancel());
  ball.style.display = 'none';
}

function resetReferees() {
  document.querySelectorAll('.fg-ref-arm-l, .fg-ref-arm-r').forEach((el) => {
    el.getAnimations().forEach((a) => a.cancel());
    el.style.transform = '';
  });
}

function hideTeeBall() {
  document.getElementById('fg-tee').style.display = 'none';
}
function showTeeBall() {
  document.getElementById('fg-tee').style.display = '';
}

function resetKicker() {
  const kicker = document.getElementById('fg-kicker');
  kicker.getAnimations().forEach((a) => a.cancel());
  kicker.style.left = '';
  kicker.style.top = '';
  const legR = kicker.querySelector('.leg-r');
  if (legR) {
    legR.getAnimations().forEach((a) => a.cancel());
    legR.style.transform = '';
  }
}

// The kicker steps up from its resting spot to right behind the ball —
// resolves once the approach is complete (i.e. right before contact).
function animateKickerApproach() {
  const kicker = document.getElementById('fg-kicker');
  return kicker.animate(
    [{ left: '38%', top: '76%' }, { left: '45%', top: '78%' }],
    { duration: 500, easing: 'ease-in', fill: 'forwards' },
  ).finished;
}

// The follow-through of the kicking (right) leg swinging forward — this is
// what "hits" the ball, so it should start at the same moment as the ball's
// flight animation, not before or after it.
function animateKickerSwing() {
  const legR = document.querySelector('#fg-kicker .leg-r');
  return legR.animate(
    [{ transform: 'rotate(0deg)' }, { transform: 'rotate(75deg)' }, { transform: 'rotate(30deg)' }],
    { duration: 350, easing: 'ease-out', fill: 'forwards' },
  ).finished;
}

// Kicks off, arcs toward the target, and settles — resolves once it lands.
// The ball on the tee is a separate element from this one (so it can sit
// there motionless while idle) — it disappears the instant this one takes
// over, so there's never a moment with two balls visible at once.
function animateBallFlight(outcome) {
  hideTeeBall();
  const ball = document.getElementById('fg-ball');
  ball.style.display = 'block';
  const keyframes = ballPathFor(outcome).map(([left, top, scale]) => ({
    left: `${left}%`, top: `${top}%`, transform: `translate(-50%, -50%) scale(${scale})`,
  }));
  return ball.animate(keyframes, { duration: 900, easing: 'ease-out', fill: 'forwards' }).finished;
}

function showBallAtFinalSpot(outcome) {
  hideTeeBall();
  const ball = document.getElementById('fg-ball');
  const pts = ballPathFor(outcome);
  const [left, top, scale] = pts[pts.length - 1];
  ball.style.display = 'block';
  ball.style.left = `${left}%`;
  ball.style.top = `${top}%`;
  ball.style.transform = `translate(-50%, -50%) scale(${scale})`;
}

// Good: both arms sweep straight up. No good: arms cross in front, then
// swing straight out to the sides — both referees signal in sync. Resolves
// once the signal is thrown.
function animateReferees(made) {
  const leftKeyframes = made
    ? [{ transform: 'rotate(0deg)' }, { transform: 'rotate(180deg)' }]
    : [{ transform: 'rotate(0deg)' }, { transform: 'rotate(-110deg)' }, { transform: 'rotate(90deg)' }];
  const rightKeyframes = made
    ? [{ transform: 'rotate(0deg)' }, { transform: 'rotate(180deg)' }]
    : [{ transform: 'rotate(0deg)' }, { transform: 'rotate(110deg)' }, { transform: 'rotate(-90deg)' }];
  const duration = made ? 400 : 600;
  const anims = [];
  document.querySelectorAll('.fg-ref-arm-l').forEach((el) => {
    anims.push(el.animate(leftKeyframes, { duration, easing: 'ease-in-out', fill: 'forwards' }).finished);
  });
  document.querySelectorAll('.fg-ref-arm-r').forEach((el) => {
    anims.push(el.animate(rightKeyframes, { duration, easing: 'ease-in-out', fill: 'forwards' }).finished);
  });
  return Promise.all(anims);
}

function setRefereeFinalPose(made) {
  const leftDeg = made ? 180 : 90;
  const rightDeg = made ? 180 : -90;
  document.querySelectorAll('.fg-ref-arm-l').forEach((el) => { el.style.transform = `rotate(${leftDeg}deg)`; });
  document.querySelectorAll('.fg-ref-arm-r').forEach((el) => { el.style.transform = `rotate(${rightDeg}deg)`; });
}

// If the tab gets backgrounded while a meter is actively running (switching
// apps/tabs, a notification, the screen locking), the animation pauses —
// same as any browser tab — but real elapsed time doesn't. Rather than let
// a click after coming back silently score off however far the clock
// drifted while nobody was watching, ask the server for a fresh start on
// whichever meter was running the moment we're looking again.
let needsResync = false;
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'hidden') {
    if (powerAnimId || directionAnimId) needsResync = true;
    return;
  }
  if (!needsResync || !memberId) return;
  needsResync = false;
  try {
    const { gameInstance: gi } = await api('POST', `/api/game-instances/${instanceId}/field-goal/resync`, { memberId });
    if (gi.status === 'completed') {
      showDone(gi.yourScore != null ? `Contest finished. You went ${gi.yourMakes}/${gi.kicksPerPlayer} for ${gi.yourScore} point${gi.yourScore === 1 ? '' : 's'}.` : 'Contest finished.');
    } else if (gi.hasCompleted) {
      showDone(`You finished ${gi.yourMakes}/${gi.kicksPerPlayer} for ${gi.yourScore} point${gi.yourScore === 1 ? '' : 's'}! Waiting on the rest of the league…`);
    } else {
      renderKick(gi);
    }
  } catch {
    // Best-effort — worst case the meter's just slightly stale until the
    // next click naturally corrects it anyway.
  }
});

async function init() {
  buildScene();
  if (!memberId) {
    document.getElementById('status-line').textContent = 'This is a spectator link — field goals are kicked individually by each member.';
    return;
  }
  const { gameInstance: gi } = await api('GET', `/api/game-instances/${instanceId}?memberId=${memberId}`);
  powerPeriodMs = gi.powerPeriodMs || powerPeriodMs;
  directionPeriodMs = gi.directionPeriodMs || directionPeriodMs;

  if (gi.status === 'completed') {
    showDone(gi.yourScore != null ? `Contest finished. You went ${gi.yourMakes}/${gi.kicksPerPlayer} for ${gi.yourScore} point${gi.yourScore === 1 ? '' : 's'}.` : 'Contest finished.');
    return;
  }
  if (gi.hasCompleted) {
    showDone(`You finished ${gi.yourMakes}/${gi.kicksPerPlayer} for ${gi.yourScore} point${gi.yourScore === 1 ? '' : 's'}! Waiting on the rest of the league…`);
    poll();
    return;
  }
  renderKick(gi);
}

function poll() {
  setInterval(async () => {
    const { gameInstance: gi } = await api('GET', `/api/game-instances/${instanceId}?memberId=${memberId}`);
    if (gi.status === 'completed') {
      showDone(gi.yourScore != null ? `Contest finished. You went ${gi.yourMakes}/${gi.kicksPerPlayer} for ${gi.yourScore} point${gi.yourScore === 1 ? '' : 's'}.` : 'Contest finished.');
    }
  }, 4000);
}

init();
