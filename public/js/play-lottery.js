const instanceId = qs('instance');
const leagueId = qs('league');
document.getElementById('back-link').href = leagueId ? `/member-home.html?league=${leagueId}` : '/';

let members = [];
let totalPicks = 0;
let revealed = []; // index = pick-1, value = memberId or null

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

function nameFor(memberId) {
  const m = members.find((x) => x.id === memberId);
  return m ? m.name : memberId;
}

function initials(name) {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  const letters = parts.length >= 2 ? parts[0][0] + parts[1][0] : (name || '?').slice(0, 2);
  return letters.toUpperCase();
}

function renderField() {
  const field = document.getElementById('field');
  field.innerHTML = members.map((m) => `
    <div class="lane" data-member="${m.id}">
      <span class="lane-name">${escapeHtml(m.name)}</span>
      <div class="lane-track">
        <div class="runner idle-jitter" id="runner-${m.id}" style="left:${LANE_MARGIN}%">${escapeHtml(initials(m.name))}</div>
      </div>
    </div>
  `).join('') + '<div class="end-zone">PICK&nbsp;#1</div>';
}

function renderOrderList() {
  const list = document.getElementById('order-list');
  list.innerHTML = revealed.map((memberId) => `<li>${memberId ? escapeHtml(nameFor(memberId)) : '<span class="muted">TBD</span>'}</li>`).join('');
}

function showLatest(rank, memberId) {
  const el = document.getElementById('latest-pick');
  el.style.display = 'block';
  el.innerHTML = `<div class="pick-num">Pick #${rank}</div><div class="pick-name">${escapeHtml(nameFor(memberId))}</div>`;
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
    const step = kicking
      ? 4 + Math.random() * 5 // 4-9%, always forward — the finishing kick
      : -1 + Math.random() * 4.5; // -1 to 3.5, mostly forward — the cruise
    const ceiling = kicking ? FINISH_PCT : JITTER_CEILING;
    const next = Math.max(LANE_MARGIN, Math.min(ceiling, pos + step));
    runner.style.left = `${next}%`;

    if (kicking && next >= FINISH_PCT - 0.1) {
      racing.delete(memberId);
      runner.classList.remove('running');
      finishRunner(rank, memberId, runner);
      return;
    }
    setTimeout(tick, kicking ? 150 + Math.random() * 80 : 280 + Math.random() * 220);
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

  revealed[rank - 1] = memberId;
  showLatest(rank, memberId);
  renderOrderList();
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
  runner.classList.remove('idle-jitter', 'running');
  runner.style.left = `${FINISH_PCT}%`;
  finishRunner(rank, memberId, runner);
}

function beginRace(stillRacingIds) {
  document.getElementById('status-line').textContent = 'The race is on…';
  document.getElementById('run-panel').style.display = 'none';
  stillRacingIds.forEach(startJitter);
}

// Replays the (already-decided) draw for anyone loading a finished async
// lottery — same pacing and jitter as a live race, purely for the show of it.
function replayAsync(results) {
  const order = results.slice().sort((a, b) => a.rank - b.rank); // best to worst — pick #1 finishes first
  beginRace(order.map((r) => r.memberId));
  let i = 0;
  const step = () => {
    if (i >= order.length) {
      document.getElementById('status-line').textContent = 'Draw complete!';
      return;
    }
    const { rank, memberId } = order[i];
    crossFinishLine(rank, memberId);
    i++;
    setTimeout(step, 1800);
  };
  setTimeout(step, 900);
}

async function init() {
  const { gameInstance: gi } = await api('GET', `/api/game-instances/${instanceId}`);
  const { league } = await api('GET', `/api/leagues/${leagueId}`);
  members = league.members;

  totalPicks = gi.totalPicks || members.length;
  revealed = new Array(totalPicks).fill(null);
  renderField();
  renderOrderList();

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
  socket.on('lottery:complete', () => {
    document.getElementById('status-line').textContent = 'Draw complete!';
  });
}

init();
