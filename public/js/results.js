const competitionId = qs('competition');
let members = [];
let polling = null;

function nameFor(id) {
  const m = members.find((x) => x.id === id);
  return m ? m.name : id;
}

function renderPerGame(games) {
  document.getElementById('per-game').innerHTML = games.map((gi) => {
    const rows = (gi.results || []).slice().sort((a, b) => a.rank - b.rank)
      .map((r) => `<li>#${r.rank} — ${escapeHtml(nameFor(r.memberId))}</li>`).join('');
    return `
      <div style="margin-bottom:16px">
        <strong>${escapeHtml(gi.gameName)}</strong> <span class="pill ${gi.status === 'completed' ? 'completed' : ''}">${gi.status}</span>
        <ul class="clean" style="margin-top:6px">${rows || '<li class="muted">Not finished yet</li>'}</ul>
      </div>`;
  }).join('');
}

async function load() {
  const { competition, games, league } = await api('GET', `/api/competitions/${competitionId}`);
  members = league.members;
  document.getElementById('comp-name').textContent = competition.name;

  renderPerGame(games);

  if (competition.status === 'completed' && competition.finalOrder) {
    document.getElementById('status-line').textContent = `${league.name} — draft order is set!`;
    document.getElementById('final-panel').style.display = 'block';
    const ordered = competition.finalOrder.slice().sort((a, b) => a.rank - b.rank);
    document.getElementById('final-order').innerHTML = ordered.map((r) =>
      `<li>${escapeHtml(nameFor(r.memberId))}</li>`).join('');
    if (polling) { clearInterval(polling); polling = null; }
  } else {
    document.getElementById('status-line').textContent = `${league.name} — waiting for all games to finish…`;
    if (!polling) polling = setInterval(load, 3000);
  }
}

load();
