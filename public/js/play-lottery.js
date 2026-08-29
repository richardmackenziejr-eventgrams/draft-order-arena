const instanceId = qs('instance');
const leagueId = qs('league');
document.getElementById('back-link').href = leagueId ? `/member-home.html?league=${leagueId}` : '/';

let members = [];
let totalPicks = 0;
let revealed = []; // index = pick-1, value = memberId or null

// Every runner races the same course to the same spot — a little past the
// goal line, inside the end zone (which starts at 88%) — regardless of pick.
const LANE_MARGIN = 2;
const FINISH_PCT = 94;

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

// Bookkeeping once a runner has actually crossed the line — same regardless
// of whether they got there by running it out or by snapping into place.
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

// Every team actually runs the full course and crosses the finish line —
// nobody stops short. The pick number is just which order they got there in
// (reveals arrive worst-to-first, so the #1 pick's sprint is the finale).
// Motion is a string of small, slightly uneven hops rather than one smooth
// glide, so it reads as running rather than sliding.
function runToFinish(rank, memberId) {
  const runner = document.getElementById(`runner-${memberId}`);
  if (!runner) return;
  runner.classList.remove('idle-jitter');
  runner.classList.add('running');

  let pos = parseFloat(runner.style.left) || LANE_MARGIN;
  const steps = 8 + Math.floor(Math.random() * 3); // 8-10 hops
  let stepsLeft = steps;

  const hop = () => {
    stepsLeft--;
    if (stepsLeft <= 0) {
      runner.style.left = `${FINISH_PCT}%`;
      runner.classList.remove('running');
      finishRunner(rank, memberId, runner);
      return;
    }
    const remainingDistance = FINISH_PCT - pos;
    const avgStep = remainingDistance / (stepsLeft + 1);
    const variance = avgStep * 0.4;
    pos = Math.min(FINISH_PCT, pos + avgStep + (Math.random() * 2 - 1) * variance);
    runner.style.left = `${pos}%`;
    setTimeout(hop, 110 + Math.random() * 70);
  };
  setTimeout(hop, 20 + Math.random() * 80);
}

// Late joiners catching up on picks that were already revealed before they
// connected — no need to replay the run, just place them at the line.
function snapToFinish(rank, memberId) {
  const runner = document.getElementById(`runner-${memberId}`);
  if (!runner) return;
  runner.classList.remove('idle-jitter');
  runner.style.left = `${FINISH_PCT}%`;
  finishRunner(rank, memberId, runner);
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
    document.getElementById('status-line').textContent = 'Draw complete!';
    gi.results.forEach((r) => runToFinish(r.rank, r.memberId));
    return;
  }

  // Late joiner during a live reveal — snap straight to whatever's already known.
  (gi.revealedPicks || []).forEach(({ pick, memberId }) => snapToFinish(pick, memberId));

  if (gi.mode === 'live' && gi.status === 'ready' && isCommish(leagueId)) {
    document.getElementById('run-panel').style.display = 'block';
    document.getElementById('run-btn').addEventListener('click', async () => {
      document.getElementById('run-btn').disabled = true;
      try { await api('POST', `/api/game-instances/${instanceId}/lottery/run`); }
      catch (err) { alert(err.message); document.getElementById('run-btn').disabled = false; }
    });
  }

  document.getElementById('status-line').textContent = gi.status === 'revealing'
    ? 'The race is on…'
    : (gi.mode === 'live' ? 'Waiting for the commissioner to start the race…' : 'Waiting for the race to run…');

  const socket = io();
  socket.emit('join-room', { gameInstanceId: instanceId });
  socket.on('lottery:started', () => {
    document.getElementById('status-line').textContent = 'The race is on…';
    document.getElementById('run-panel').style.display = 'none';
  });
  socket.on('lottery:reveal', ({ pick, memberId }) => runToFinish(pick, memberId));
  socket.on('lottery:complete', () => {
    document.getElementById('status-line').textContent = 'Draw complete!';
  });
}

init();
