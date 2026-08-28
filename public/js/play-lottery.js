const instanceId = qs('instance');
const leagueId = qs('league');
document.getElementById('back-link').href = leagueId ? `/member-home.html?league=${leagueId}` : '/';

let members = [];
let totalPicks = 0;
let revealed = []; // index = pick-1, value = memberId or null

function nameFor(memberId) {
  const m = members.find((x) => x.id === memberId);
  return m ? m.name : memberId;
}

function renderOrderList() {
  const list = document.getElementById('order-list');
  list.innerHTML = revealed.map((memberId) => `<li>${memberId ? escapeHtml(nameFor(memberId)) : '<span class="muted">TBD</span>'}</li>`).join('');
}

function renderLatest(pick, memberId) {
  document.getElementById('latest-pick').innerHTML =
    `<div class="muted">Pick #${pick}</div><div style="font-size:2rem;font-weight:800;color:var(--gold)">${escapeHtml(nameFor(memberId))}</div>`;
}

async function init() {
  const { gameInstance: gi } = await api('GET', `/api/game-instances/${instanceId}`);
  const { league } = await api('GET', `/api/leagues/${leagueId}`);
  members = league.members;

  totalPicks = gi.totalPicks || members.length;
  revealed = new Array(totalPicks).fill(null);
  (gi.revealedPicks || []).forEach(({ pick, memberId }) => {
    revealed[pick - 1] = memberId;
  });

  if (gi.status === 'completed') {
    document.getElementById('status-line').textContent = 'Draw complete!';
    gi.results.forEach((r) => { revealed[r.rank - 1] = r.memberId; });
    renderOrderList();
    return;
  }

  if (gi.mode === 'live' && gi.status === 'ready' && isCommish(leagueId)) {
    document.getElementById('run-panel').style.display = 'block';
    document.getElementById('run-btn').addEventListener('click', async () => {
      document.getElementById('run-btn').disabled = true;
      try { await api('POST', `/api/game-instances/${instanceId}/lottery/run`); }
      catch (err) { alert(err.message); document.getElementById('run-btn').disabled = false; }
    });
  }

  document.getElementById('status-line').textContent = gi.status === 'revealing'
    ? 'Revealing picks…'
    : (gi.mode === 'live' ? 'Waiting for the commissioner to start the draw…' : 'Waiting for the draw to run…');

  renderOrderList();

  const socket = io();
  socket.emit('join-room', { gameInstanceId: instanceId });
  socket.on('lottery:started', () => {
    document.getElementById('status-line').textContent = 'Revealing picks…';
    document.getElementById('run-panel').style.display = 'none';
  });
  socket.on('lottery:reveal', ({ pick, memberId }) => {
    revealed[pick - 1] = memberId;
    renderLatest(pick, memberId);
    renderOrderList();
  });
  socket.on('lottery:complete', () => {
    document.getElementById('status-line').textContent = 'Draw complete!';
  });
}

init();
