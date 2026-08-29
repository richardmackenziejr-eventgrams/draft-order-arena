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

function windLine(k) {
  if (k.windDir === 'calm') return 'Wind: calm';
  const arrow = k.windDir === 'left' ? '←' : '→';
  return `Wind: ${k.windMph} mph ${arrow}`;
}

function showPhase(phase) {
  document.getElementById('power-step').style.display = phase === 'power' ? 'block' : 'none';
  document.getElementById('direction-step').style.display = phase === 'direction' ? 'block' : 'none';
  document.getElementById('result-step').style.display = phase === 'result' ? 'block' : 'none';
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
  document.getElementById('wind-line').textContent = windLine(k);

  stopAnimations();

  if (k.phase === 'result') {
    showResult(k.attempt, k.distance);
    return;
  }

  paintPowerZone();

  if (k.phase === 'direction') {
    showPhase('direction');
    animateDirection(k.directionStartedAt);
    return;
  }

  showPhase('power');
  animatePower(k.powerStartedAt);
}

document.getElementById('power-stop-btn').addEventListener('click', async () => {
  const btn = document.getElementById('power-stop-btn');
  if (btn.disabled) return;
  btn.disabled = true;
  stopAnimations();
  try {
    const { gameInstance: gi } = await api('POST', `/api/game-instances/${instanceId}/field-goal/power-stop`, { memberId });
    renderKick(gi);
  } catch (err) {
    alert(err.message);
  } finally {
    btn.disabled = false;
  }
});

document.getElementById('direction-stop-btn').addEventListener('click', async () => {
  const btn = document.getElementById('direction-stop-btn');
  if (btn.disabled) return;
  btn.disabled = true;
  stopAnimations();
  try {
    const { outcome, gameInstance: gi } = await api('POST', `/api/game-instances/${instanceId}/field-goal/direction-stop`, { memberId });
    showResult(outcome, gi.currentKick ? gi.currentKick.distance : outcome.distance);
  } catch (err) {
    alert(err.message);
  } finally {
    btn.disabled = false;
  }
});

function outcomeText(outcome, distance) {
  if (outcome.outcome === 'made') return `IT'S GOOD! ${distance} yards — +${outcome.points} point${outcome.points === 1 ? '' : 's'}`;
  if (outcome.outcome === 'short') return "NO GOOD — didn't have the distance. Time the power meter's green zone better.";
  if (outcome.outcome === 'wide-left') return 'WIDE LEFT!';
  if (outcome.outcome === 'wide-right') return 'WIDE RIGHT!';
  return outcome.outcome;
}

function showResult(outcome, distance) {
  stopAnimations();
  const el = document.getElementById('result-text');
  el.textContent = outcomeText(outcome, distance);
  el.className = `fg-result ${outcome.made ? 'made' : 'missed'}`;
  showPhase('result');
}

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
  document.getElementById('kick-panel').style.display = 'none';
  document.getElementById('done-panel').style.display = 'block';
  document.getElementById('done-message').textContent = message;
}

async function init() {
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
