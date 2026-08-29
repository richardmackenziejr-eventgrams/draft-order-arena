const instanceId = qs('instance');
const leagueId = qs('league');
document.getElementById('back-link').href = leagueId ? `/member-home.html?league=${leagueId}` : '/';

let members = [];
let totalPicks = 0;
let finalResults = []; // set once the draw is known — lets the Replay button re-run it

// Everyone races at once, and every runner ends up at the same spot — a
// little past the goal line, inside the end zone (which starts at 88%) —
// regardless of pick. Nobody visually reaches FINISH_PCT except by actually
// finishing: the jitter loop is capped short of it (JITTER_CEILING) so nobody
// "spoils" the reveal by looking done before their pick is announced.
const LANE_MARGIN = 2;
const JITTER_CEILING = 84;
const FINISH_PCT = 94;

const racing = new Set(); // memberIds currently in the stride loop
const released = new Map(); // memberId -> rank, once their pick is revealed
const stumbleTimers = new Map(); // memberId -> timeout id, for reverting the stumble pose

function nameFor(memberId) {
  const m = members.find((x) => x.id === memberId);
  return m ? m.name : memberId;
}

// A little pixel runner made of separately-animatable blocks (see .runner
// .part rules in style.css) rather than a single circle — team identity
// comes from the lane label above, not from anything printed on the figure.
const RUNNER_FIGURE_HTML = `
  <div class="part head"></div>
  <div class="part torso"></div>
  <div class="part arm-l"></div>
  <div class="part arm-r"></div>
  <div class="part leg-l"></div>
  <div class="part leg-r"></div>
`;

function renderField() {
  const field = document.getElementById('field');
  field.innerHTML = members.map((m) => `
    <div class="lane" data-member="${m.id}">
      <span class="lane-name">${escapeHtml(m.name)}</span>
      <div class="lane-track">
        <div class="runner idle-jitter" id="runner-${m.id}" style="left:${LANE_MARGIN}%">${RUNNER_FIGURE_HTML}</div>
      </div>
    </div>
  `).join('') + '<div class="end-zone">100&nbsp;YD</div>';
}

// Puts every runner back at the goal line and clears all race state — used
// both before the very first run and before a replay.
function resetField() {
  racing.clear();
  released.clear();
  stumbleTimers.forEach((t) => clearTimeout(t));
  stumbleTimers.clear();
  document.getElementById('latest-pick').style.display = 'none';
  hideResultsOverlay();
  renderField();
}

function showLatest(rank, memberId) {
  const el = document.getElementById('latest-pick');
  el.style.display = 'block';
  el.innerHTML = `<div class="pick-num">Pick #${rank}</div><div class="pick-name">${escapeHtml(nameFor(memberId))}</div>`;
}

function showResultsOverlay(results) {
  const ordered = results.slice().sort((a, b) => a.rank - b.rank);
  document.getElementById('overlay-order-list').innerHTML =
    ordered.map((r) => `<li>${escapeHtml(nameFor(r.memberId))}</li>`).join('');
  document.getElementById('results-overlay').style.display = 'flex';
}

function hideResultsOverlay() {
  document.getElementById('results-overlay').style.display = 'none';
}

// Every team runs continuously once the race starts — nobody's runner sits
// still waiting their turn. Two phases, both made of visible strides (never
// one smooth glide):
//   - cruising: slow, jittery, backward slips included — this is most of the
//     race, and it's deliberately unhurried.
//   - kicking: once a pick is revealed, the runner switches to a quicker,
//     always-forward sprint for the line — like a real racer's finishing
//     kick, not a teleport. It's still made of the same kind of hops, just
//     faster ones, and it's what keeps the finish from dragging on: reveals
//     are only ~1.8s apart, and cruising pace alone could take a cruising
//     runner *much* longer than that to close an arbitrary remaining gap.
// None of this affects the actual outcome, which was already decided
// server-side — it's purely what it looks like getting there.
function startJitter(memberId) {
  racing.add(memberId);
  const runner = document.getElementById(`runner-${memberId}`);
  if (!runner) return;
  runner.classList.remove('idle-jitter');
  runner.classList.add('running');

  const tick = () => {
    if (!racing.has(memberId)) return; // finished (or race reset) — stop looping
    const pos = parseFloat(runner.style.left) || LANE_MARGIN;
    const rank = released.get(memberId);
    const kicking = rank != null;
    // Smaller, more frequent steps than a single big leap — keeps the pace
    // similar while each individual hop stays modest.
    const step = kicking
      ? 2.5 + Math.random() * 3.5 // 2.5-6%, always forward — the finishing kick
      : -0.5 + Math.random() * 2.5; // -0.5 to 2, mostly forward — the cruise
    const ceiling = kicking ? FINISH_PCT : JITTER_CEILING;
    const next = Math.max(LANE_MARGIN, Math.min(ceiling, pos + step));
    runner.style.left = `${next}%`;

    if (kicking && next >= FINISH_PCT - 0.1) {
      racing.delete(memberId);
      clearTimeout(stumbleTimers.get(memberId));
      runner.classList.remove('running', 'stumble');
      finishRunner(rank, memberId, runner);
      return;
    }
    // A backward slip mid-cruise — caught off balance, down on one knee for
    // a beat before getting back up and rejoining the run.
    if (!kicking && step < 0) {
      runner.classList.remove('running');
      runner.classList.add('stumble');
      clearTimeout(stumbleTimers.get(memberId));
      stumbleTimers.set(memberId, setTimeout(() => {
        if (racing.has(memberId)) {
          runner.classList.remove('stumble');
          runner.classList.add('running');
        }
      }, 260));
    }
    setTimeout(tick, kicking ? 130 + Math.random() * 90 : 220 + Math.random() * 180);
  };
  setTimeout(tick, Math.random() * 300); // stagger everyone's first stride so they don't move in lockstep
}

// Bookkeeping once a runner has actually crossed the line.
function finishRunner(rank, memberId, runner) {
  if (!runner.querySelector('.pick-flag')) {
    const flag = document.createElement('div');
    flag.className = 'pick-flag';
    flag.textContent = `#${rank}`;
    runner.appendChild(flag);
  }
  if (rank === 1) runner.classList.add('runner-winner');
  showLatest(rank, memberId);
}

// A pick's been revealed — let that runner's next few strides carry it past
// JITTER_CEILING and on to FINISH_PCT instead of stopping short.
function crossFinishLine(rank, memberId) {
  released.set(memberId, rank);
}

// Late joiners catching up on picks that were already revealed before they
// connected — no need to replay any of it, just place them at the line.
function snapToFinish(rank, memberId) {
  const runner = document.getElementById(`runner-${memberId}`);
  if (!runner) return;
  racing.delete(memberId);
  clearTimeout(stumbleTimers.get(memberId));
  runner.classList.remove('idle-jitter', 'running', 'stumble');
  runner.style.left = `${FINISH_PCT}%`;
  finishRunner(rank, memberId, runner);
}

function beginRace(stillRacingIds) {
  document.getElementById('status-line').textContent = 'The race is on…';
  document.getElementById('run-panel').style.display = 'none';
  stillRacingIds.forEach(startJitter);
}

// Runs the (already-decided) draw for anyone loading a finished lottery, or
// replaying one — same pacing and jitter as watching it live, purely for the
// show of it. `onDone`, if given, fires once the results overlay is showing.
function replayAsync(results, onDone) {
  finalResults = results;
  const order = results.slice().sort((a, b) => a.rank - b.rank); // best to worst — pick #1 finishes first
  beginRace(order.map((r) => r.memberId));
  let i = 0;
  const step = () => {
    if (i >= order.length) {
      document.getElementById('status-line').textContent = 'Draw complete!';
      showResultsOverlay(results);
      if (onDone) onDone();
      return;
    }
    const { rank, memberId } = order[i];
    crossFinishLine(rank, memberId);
    i++;
    setTimeout(step, 1800);
  };
  setTimeout(step, 900);
}

function wireResultsControls() {
  const replayBtn = document.getElementById('replay-btn');
  replayBtn.addEventListener('click', () => {
    replayBtn.disabled = true;
    resetField();
    replayAsync(finalResults, () => { replayBtn.disabled = false; });
  });

  document.getElementById('results-close').addEventListener('click', hideResultsOverlay);

  document.getElementById('copy-link-btn').addEventListener('click', async () => {
    const feedback = document.getElementById('copy-feedback');
    try {
      await navigator.clipboard.writeText(window.location.href);
      feedback.textContent = 'Link copied!';
    } catch {
      feedback.textContent = window.location.href; // clipboard blocked — show it to copy by hand
    }
    setTimeout(() => { feedback.textContent = ''; }, 2500);
  });
}

async function init() {
  const { gameInstance: gi } = await api('GET', `/api/game-instances/${instanceId}`);
  const { league } = await api('GET', `/api/leagues/${leagueId}`);
  members = league.members;

  totalPicks = gi.totalPicks || members.length;
  renderField();
  wireResultsControls();

  if (gi.status === 'completed') {
    replayAsync(gi.results);
    return;
  }

  // Late joiner during a live reveal — snap the decided picks into place, and
  // get everyone still in it moving right away (the race is already underway).
  const alreadyRevealedIds = new Set();
  (gi.revealedPicks || []).forEach(({ pick, memberId }) => {
    snapToFinish(pick, memberId);
    alreadyRevealedIds.add(memberId);
  });
  if (gi.status === 'revealing') {
    const stillRacing = members.map((m) => m.id).filter((id) => !alreadyRevealedIds.has(id));
    beginRace(stillRacing);
  }

  if (gi.mode === 'live' && gi.status === 'ready' && isCommish(leagueId)) {
    document.getElementById('run-panel').style.display = 'block';
    document.getElementById('run-btn').addEventListener('click', async () => {
      document.getElementById('run-btn').disabled = true;
      try { await api('POST', `/api/game-instances/${instanceId}/lottery/run`); }
      catch (err) { alert(err.message); document.getElementById('run-btn').disabled = false; }
    });
  }

  if (gi.status !== 'revealing') {
    document.getElementById('status-line').textContent = gi.mode === 'live'
      ? 'Waiting for the commissioner to start the race…'
      : 'Waiting for the race to run…';
  }

  const socket = io();
  socket.emit('join-room', { gameInstanceId: instanceId });
  socket.on('lottery:started', () => beginRace(members.map((m) => m.id)));
  socket.on('lottery:reveal', ({ pick, memberId }) => crossFinishLine(pick, memberId));
  socket.on('lottery:complete', ({ results }) => {
    finalResults = results;
    document.getElementById('status-line').textContent = 'Draw complete!';
    showResultsOverlay(results);
  });
}

init();
