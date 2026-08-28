const instanceId = qs('instance');
const leagueId = qs('league');
document.getElementById('back-link').href = leagueId ? `/member-home.html?league=${leagueId}` : '/';

let members = [];
let totalPicks = 0;
let revealed = []; // index = pick-1, value = memberId or null

// The racing lane occupies the left LANE_PCT of the field; the rest is the end zone.
const LANE_PCT = 88;
const LANE_MARGIN = 2;

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

// A team's final resting spot on the field encodes their draft slot directly:
// pick #1 sprints the full length into the end zone, the last pick barely
// leaves the goal line. Reveals arrive worst-to-first, so the field fills in
// with progressively longer runs, saving the full-field sprint for #1.
function revealPick(rank, memberId) {
  const runner = document.getElementById(`runner-${memberId}`);
  if (!runner) return;
  runner.classList.remove('idle-jitter');
  const progress = (totalPicks - rank + 1) / totalPicks;
  const targetPct = LANE_MARGIN + progress * (LANE_PCT - LANE_MARGIN);
  runner.style.left = `${targetPct}%`;
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
    gi.results.forEach((r) => revealPick(r.rank, r.memberId));
    return;
  }

  // Late joiner during a live reveal — snap straight to whatever's already known.
  (gi.revealedPicks || []).forEach(({ pick, memberId }) => revealPick(pick, memberId));

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
  socket.on('lottery:reveal', ({ pick, memberId }) => revealPick(pick, memberId));
  socket.on('lottery:complete', () => {
    document.getElementById('status-line').textContent = 'Draw complete!';
  });
}

init();
