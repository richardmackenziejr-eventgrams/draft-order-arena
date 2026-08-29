const instanceId = qs('instance');
const leagueId = qs('league');
const memberId = qs('member');
document.getElementById('back-link').href = leagueId ? `/member-home.html?league=${leagueId}` : '/';

let powerPeriodMs = 1300;
let directionPeriodMs = 1000;
let powerSweetHalf = 0.12;
let zonesPainted = false;

let powerAnimId = null;
let directionAnimId = null;

// Same deterministic triangle wave the server scores with (0 -> 1 -> 0 over
// one period) — used here purely to draw the marker; the server always
// recomputes this itself from its own elapsed time when a click lands.
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
  const marker = document.getElementById('power-marker');
  function frame() {
    const pos = trianglePosition(Date.now() - startedAt, powerPeriodMs);
    marker.style.bottom = `${pos * 100}%`;
    powerAnimId = requestAnimationFrame(frame);
  }
  frame();
}

function animateDirection(startedAt) {
  const marker = document.getElementById('direction-marker');
  function frame() {
    const pos = trianglePosition(Date.now() - startedAt, directionPeriodMs);
    marker.style.left = `${pos * 100}%`;
    directionAnimId = requestAnimationFrame(frame);
  }
  frame();
}

function paintPowerZone() {
  if (zonesPainted) return;
  zonesPainted = true;
  const sweet = document.getElementById('power-sweet');
  sweet.style.bottom = `${(0.5 - powerSweetHalf) * 100}%`;
  sweet.style.height = `${powerSweetHalf * 2 * 100}%`;
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
// happened" recap alongside the call.
function freezeAndShowResult(k) {
  stopAnimations();
  document.getElementById('power-marker').style.bottom = `${(k.powerPos || 0) * 100}%`;
  document.getElementById('direction-marker').style.left = `${(k.attempt.directionPos || 0) * 100}%`;
  document.getElementById('direction-track').classList.remove('idle');
  document.getElementById('power-stop-btn').disabled = true;
  document.getElementById('direction-stop-btn').disabled = true;

  const el = document.getElementById('result-text');
  el.textContent = outcomeText(k.attempt, k.distance);
  el.className = `fg-result ${k.attempt.made ? 'made' : 'missed'}`;
  document.getElementById('result-overlay').style.display = 'flex';
}

function renderKick(gi) {
  const k = gi.currentKick;
  powerPeriodMs = gi.powerPeriodMs || powerPeriodMs;
  directionPeriodMs = gi.directionPeriodMs || directionPeriodMs;
  powerSweetHalf = gi.powerSweetHalf != null ? gi.powerSweetHalf : powerSweetHalf;

  document.getElementById('kick-panel').style.display = 'block';
  document.getElementById('done-panel').style.display = 'none';
  document.getElementById('status-line').textContent = `Kick ${k.index + 1} of ${k.total}`;
  document.getElementById('kick-info').textContent = `${k.distance} yard Field Goal`;
  renderWindOverlay(k);

  stopAnimations();
  paintPowerZone();

  if (k.phase === 'result') {
    freezeAndShowResult(k);
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
  btn.disabled = true;
  stopAnimations();
  try {
    const { gameInstance: gi } = await api('POST', `/api/game-instances/${instanceId}/field-goal/power-stop`, { memberId });
    renderKick(gi); // sets the right disabled state for both buttons based on the new phase
  } catch (err) {
    alert(err.message);
    btn.disabled = false; // only re-enable on failure, so they can retry
  }
});

document.getElementById('direction-stop-btn').addEventListener('click', async () => {
  const btn = document.getElementById('direction-stop-btn');
  if (btn.disabled) return;
  btn.disabled = true;
  stopAnimations();
  try {
    const { gameInstance: gi } = await api('POST', `/api/game-instances/${instanceId}/field-goal/direction-stop`, { memberId });
    freezeAndShowResult(gi.currentKick); // disables both buttons — the kick's resolved
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

// --- Pre-snap scene: a static illustration of the play about to happen ---
// (kicker/holder up front, the offensive line crouched with their backs to
// us, the defensive line barely visible peeking over them, goalposts off in
// the distance). Built once — it doesn't change between kicks.
function kneelingHolderSvg() {
  return `
    <svg viewBox="0 0 24 32" width="20" height="27" xmlns="http://www.w3.org/2000/svg">
      <ellipse cx="12" cy="29.5" rx="7.5" ry="2.4" fill="rgba(0,0,0,0.3)" />
      <rect x="5.5" y="15" width="13" height="14" rx="5.5" fill="currentColor" />
      <circle cx="12" cy="9.5" r="5.2" fill="currentColor" stroke="rgba(0,0,0,0.35)" stroke-width="0.5" />
    </svg>
  `;
}

function buildScene() {
  const el = document.getElementById('fg-scene-bg');
  const offense = '#2a4a78';
  const defense = '#6e2733';

  const oLineXs = [12, 30, 50, 70, 88];
  const oLineHtml = oLineXs.map((x) => `
    <div class="fg-oline-player" style="left:${x}%; background:${offense}">
      <div class="fg-oline-helmet" style="background:${offense}"></div>
    </div>
  `).join('');

  const dLineXs = [28, 39, 50, 61, 72];
  const dLineHtml = dLineXs.map((x) => `
    <div class="fg-dline-helmet" style="left:${x}%; background:${defense}"></div>
  `).join('');

  el.innerHTML = `
    <div class="fg-yardline" style="top:38%"></div>
    <div class="fg-yardline" style="top:58%"></div>
    <div class="fg-goalpost" style="color:#f4c542">${goalpostSvg()}</div>
    ${dLineHtml}
    ${oLineHtml}
    <div class="fg-holder" style="color:${offense}">${kneelingHolderSvg()}</div>
    <div class="fg-kicker" style="color:${offense}">${runnerFigureSvg()}</div>
  `;
}

async function init() {
  buildScene();
  if (!memberId) {
    document.getElementById('status-line').textContent = 'This is a spectator link — field goals are kicked individually by each member.';
    return;
  }
  const { gameInstance: gi } = await api('GET', `/api/game-instances/${instanceId}?memberId=${memberId}`);
  powerPeriodMs = gi.powerPeriodMs || powerPeriodMs;
  directionPeriodMs = gi.directionPeriodMs || directionPeriodMs;
  powerSweetHalf = gi.powerSweetHalf != null ? gi.powerSweetHalf : powerSweetHalf;

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
