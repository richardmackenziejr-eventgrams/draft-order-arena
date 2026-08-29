const instanceId = qs('instance');
const leagueId = qs('league');
const memberId = qs('member');
document.getElementById('back-link').href = leagueId ? `/member-home.html?league=${leagueId}` : '/';

let aimValue = 0;
let AIM_MIN = -10;
let AIM_MAX = 10;
let meterDurationMs = 1600;
let sweetSpotStart = 0.68;
let sweetSpotEnd = 0.88;
let zonesPainted = false;

let holdInFlight = false; // hold-start request in flight
let holdConfirmed = false; // server has started the meter clock
let pendingRelease = false; // release happened before the server confirmed the hold started
let released = false;

function windLine(k) {
  if (k.windDir === 'calm') return 'Wind: calm';
  const arrow = k.windDir === 'left' ? '←' : '→';
  return `Wind: ${k.windMph} mph ${arrow}`;
}

function aimReadout(v) {
  if (v === 0) return '0';
  return v > 0 ? `${v} →` : `${Math.abs(v)} ←`;
}

function renderAimMarker() {
  const pct = ((aimValue - AIM_MIN) / (AIM_MAX - AIM_MIN)) * 100;
  document.getElementById('aim-marker').style.left = `${pct}%`;
  document.getElementById('aim-value').textContent = aimReadout(aimValue);
}

function showPhase(phase) {
  document.getElementById('aim-step').style.display = phase === 'aim' ? 'block' : 'none';
  document.getElementById('power-step').style.display = phase === 'power' ? 'block' : 'none';
  document.getElementById('result-step').style.display = phase === 'result' ? 'block' : 'none';
}

function paintMeterZones() {
  if (zonesPainted) return;
  zonesPainted = true;
  const track = document.getElementById('meter-track');
  const a = sweetSpotStart * 100;
  const b = sweetSpotEnd * 100;
  track.style.background = `linear-gradient(to top,
    var(--bg-panel-2) 0%, var(--bg-panel-2) ${a}%,
    var(--accent) ${a}%, var(--accent) ${b}%,
    var(--danger) ${b}%, var(--danger) 100%)`;
}

function resetMeterVisual() {
  paintMeterZones();
  const marker = document.getElementById('meter-marker');
  marker.style.transition = 'none';
  marker.style.bottom = '0%';
  void marker.offsetWidth; // force reflow so a later transition doesn't get skipped
}

function startMeterAnimation() {
  const marker = document.getElementById('meter-marker');
  requestAnimationFrame(() => {
    marker.style.transition = `bottom ${meterDurationMs}ms linear`;
    marker.style.bottom = '100%';
  });
}

function renderKick(gi) {
  const k = gi.currentKick;
  meterDurationMs = gi.meterDurationMs || meterDurationMs;
  AIM_MIN = gi.aimMin != null ? gi.aimMin : AIM_MIN;
  AIM_MAX = gi.aimMax != null ? gi.aimMax : AIM_MAX;
  sweetSpotStart = gi.sweetSpotStart != null ? gi.sweetSpotStart : sweetSpotStart;
  sweetSpotEnd = gi.sweetSpotEnd != null ? gi.sweetSpotEnd : sweetSpotEnd;

  document.getElementById('kick-panel').style.display = 'block';
  document.getElementById('done-panel').style.display = 'none';
  document.getElementById('status-line').textContent = `Kick ${k.index + 1} of ${k.total}`;
  document.getElementById('kick-info').textContent = `${k.distance} yard Field Goal`;
  document.getElementById('wind-line').textContent = windLine(k);

  if (k.phase === 'result') {
    showResult(k.attempt, k.distance);
    return;
  }

  if (k.phase === 'ready') {
    aimValue = k.aim;
    renderAimMarker();
    document.getElementById('your-aim-line').textContent = `Your aim: ${aimReadout(aimValue)}`;
    holdInFlight = false;
    holdConfirmed = false;
    pendingRelease = false;
    released = false;
    resetMeterVisual();
    showPhase('power');
    return;
  }

  aimValue = 0;
  renderAimMarker();
  showPhase('aim');
}

document.getElementById('aim-left').addEventListener('click', () => {
  aimValue = Math.max(AIM_MIN, aimValue - 1);
  renderAimMarker();
});
document.getElementById('aim-right').addEventListener('click', () => {
  aimValue = Math.min(AIM_MAX, aimValue + 1);
  renderAimMarker();
});

document.getElementById('lock-aim-btn').addEventListener('click', async () => {
  const btn = document.getElementById('lock-aim-btn');
  btn.disabled = true;
  try {
    const { gameInstance: gi } = await api('POST', `/api/game-instances/${instanceId}/field-goal/aim`, { memberId, aim: aimValue });
    renderKick(gi);
  } catch (err) {
    alert(err.message);
  } finally {
    btn.disabled = false;
  }
});

async function onHoldStart() {
  if (holdInFlight || holdConfirmed || released) return;
  holdInFlight = true;
  try {
    await api('POST', `/api/game-instances/${instanceId}/field-goal/hold-start`, { memberId });
  } catch (err) {
    holdInFlight = false;
    alert(err.message);
    return;
  }
  holdInFlight = false;
  if (released) return; // released while the hold-start request was in flight
  holdConfirmed = true;
  startMeterAnimation();
  if (pendingRelease) onHoldRelease();
}

async function onHoldRelease() {
  if (released) return;
  if (!holdConfirmed) {
    // They let go before the server confirmed the hold started — score it
    // the instant that confirmation lands instead of losing the input.
    pendingRelease = true;
    return;
  }
  released = true;
  try {
    const { outcome, gameInstance: gi } = await api('POST', `/api/game-instances/${instanceId}/field-goal/release`, { memberId });
    showResult(outcome, gi.currentKick ? gi.currentKick.distance : outcome.distance);
  } catch (err) {
    alert(err.message);
  }
}

const holdBtn = document.getElementById('hold-btn');
holdBtn.addEventListener('mousedown', onHoldStart);
holdBtn.addEventListener('touchstart', (e) => { e.preventDefault(); onHoldStart(); });
holdBtn.addEventListener('mouseup', onHoldRelease);
holdBtn.addEventListener('mouseleave', onHoldRelease);
holdBtn.addEventListener('touchend', (e) => { e.preventDefault(); onHoldRelease(); });

function outcomeText(outcome, distance) {
  if (outcome.outcome === 'made') return `IT'S GOOD! ${distance} yards — +${outcome.points} point${outcome.points === 1 ? '' : 's'}`;
  if (outcome.outcome === 'shank') return `SHANKED IT ${outcome.detail === 'left' ? 'LEFT' : 'RIGHT'}! You held the meter too long.`;
  if (outcome.outcome === 'short') return "NO GOOD — didn't have the distance. Charge the meter longer next time.";
  if (outcome.outcome === 'wide-left') return 'WIDE LEFT — your aim overcorrected.';
  if (outcome.outcome === 'wide-right') return "WIDE RIGHT — didn't counter the wind enough.";
  return outcome.outcome;
}

function showResult(outcome, distance) {
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
  meterDurationMs = gi.meterDurationMs || meterDurationMs;
  AIM_MIN = gi.aimMin != null ? gi.aimMin : AIM_MIN;
  AIM_MAX = gi.aimMax != null ? gi.aimMax : AIM_MAX;
  sweetSpotStart = gi.sweetSpotStart != null ? gi.sweetSpotStart : sweetSpotStart;
  sweetSpotEnd = gi.sweetSpotEnd != null ? gi.sweetSpotEnd : sweetSpotEnd;

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
