const leagueId = qs('id');
if (!leagueId) document.body.innerHTML = '<main><p class="error">No league id in URL.</p></main>';

let catalog = [];
let lastMemberIds = [];

async function loadCatalogOnce() {
  if (catalog.length) return catalog;
  const { games } = await api('GET', '/api/game-catalog');
  catalog = games;
  return catalog;
}

function renderLeagueInfo(league) {
  document.getElementById('league-name').textContent = league.name;
  document.getElementById('join-code').textContent = league.joinCode;
  const link = `${window.location.origin}/join.html?code=${league.joinCode}`;
  document.getElementById('join-link').innerHTML = `Direct link: <a href="${link}" target="_blank">${link}</a>`;
  document.getElementById('member-count').textContent = league.members.length;

  const list = document.getElementById('member-list');
  if (league.members.length === 0) {
    list.innerHTML = '<li class="muted">No one has joined yet.</li>';
  } else {
    list.innerHTML = league.members.map((m) => `<li>${escapeHtml(m.name)}</li>`).join('');
  }
}

function modeOptions(supportedModes) {
  return supportedModes.map((m) => `<option value="${m}">${m === 'live' ? 'Live (real-time, everyone at once)' : 'Async (self-paced)'}</option>`).join('');
}

function renderGameChoices(members) {
  const container = document.getElementById('game-choices');
  container.innerHTML = catalog.map((g) => {
    const oddsInputs = g.id === 'lottery'
      ? `<div class="lottery-odds" data-for="${g.id}" style="display:none; margin-top:10px">
          <label>Odds weight per member (higher = better odds at pick #1)</label>
          <div class="row">
            ${members.map((m) => `
              <div>
                <label style="margin:6px 0 2px">${escapeHtml(m.name)}</label>
                <input type="number" min="0" step="0.5" value="1" data-odds-member="${m.id}" data-odds-game="${g.id}" />
              </div>`).join('')}
          </div>
        </div>`
      : '';
    return `
      <div class="game-choice" data-game="${g.id}">
        <div class="game-choice-head">
          <input type="checkbox" id="chk-${g.id}" data-game-checkbox="${g.id}" />
          <label for="chk-${g.id}" style="margin:0">${g.name}</label>
        </div>
        <select data-game-mode="${g.id}" style="margin-top:8px" ${g.supportedModes.length === 1 ? 'disabled' : ''}>
          ${modeOptions(g.supportedModes)}
        </select>
        ${oddsInputs}
      </div>`;
  }).join('');

  container.querySelectorAll('[data-game-checkbox]').forEach((chk) => {
    chk.addEventListener('change', () => {
      const card = chk.closest('.game-choice');
      card.classList.toggle('checked', chk.checked);
      const odds = card.querySelector('.lottery-odds');
      if (odds) odds.style.display = chk.checked ? 'block' : 'none';
    });
  });
}

function buildGamesPayload() {
  const games = [];
  document.querySelectorAll('[data-game-checkbox]:checked').forEach((chk) => {
    const gameType = chk.dataset.gameCheckbox;
    const mode = document.querySelector(`[data-game-mode="${gameType}"]`).value;
    let config = {};
    if (gameType === 'lottery') {
      const odds = {};
      document.querySelectorAll(`[data-odds-game="${gameType}"]`).forEach((inp) => {
        odds[inp.dataset.oddsMember] = Number(inp.value) || 1;
      });
      config = { odds };
    }
    games.push({ gameType, mode, config });
  });
  return games;
}

function statusPill(status) {
  const cls = status === 'completed' ? 'completed' : (status === 'active' ? 'active' : '');
  return `<span class="pill ${cls}">${status}</span>`;
}

function gameStatusLine(gi) {
  if (gi.status === 'draft') return 'Not started yet';
  if (gi.gameType === 'lottery') {
    if (gi.status === 'completed') return 'Draw complete';
    if (gi.status === 'revealing') return `Revealing… (${gi.revealedOrder ? gi.revealedOrder.length : 0}/${gi.totalPicks || '?'})`;
    if (gi.mode === 'live') return 'Ready — commissioner triggers the reveal';
    return 'Pending';
  }
  if (gi.gameType === 'reactionBracket') {
    if (gi.status === 'completed') return 'Bracket complete';
    return `Bracket in progress (${gi.mode})`;
  }
  if (gi.gameType === 'trivia') {
    const n = (gi.submittedBy || []).length;
    return gi.status === 'completed' ? 'Trivia complete' : `${n} submitted so far`;
  }
  return gi.status;
}

function gameLink(gi) {
  const pageByType = { lottery: 'play-lottery.html', reactionBracket: 'play-reaction-bracket.html', trivia: 'play-trivia.html' };
  const page = pageByType[gi.gameType];
  return `/${page}?instance=${gi.id}&league=${leagueId}`;
}

async function renderCompetitions(summaries) {
  const container = document.getElementById('competitions');
  if (!summaries.length) {
    container.innerHTML = '<p class="muted">No competitions yet.</p>';
    return;
  }
  const details = await Promise.all(summaries.map((s) => api('GET', `/api/competitions/${s.id}`).catch(() => null)));

  container.innerHTML = details.filter(Boolean).map(({ competition, games }) => {
    const gamesHtml = games.map((gi) => `
      <li>
        <span>${escapeHtml(gi.gameName)} <span class="muted">(${gi.mode})</span> — ${gameStatusLine(gi)}</span>
        ${competition.status !== 'draft' ? `<a class="btn secondary" style="margin-top:0" href="${gameLink(gi)}">Open</a>` : ''}
      </li>`).join('');

    const action = competition.status === 'draft'
      ? `<button data-start="${competition.id}">Start competition</button>`
      : (competition.status === 'completed'
        ? `<a class="btn" href="/results.html?competition=${competition.id}">View results</a>`
        : `<a class="btn secondary" href="/results.html?competition=${competition.id}">Live results</a>`);

    return `
      <div class="panel panel-2" style="margin-bottom:14px">
        <div class="row" style="align-items:center">
          <strong style="flex:2">${escapeHtml(competition.name)}</strong>
          ${statusPill(competition.status)}
        </div>
        <ul class="clean" style="margin-top:10px">${gamesHtml}</ul>
        ${action}
      </div>`;
  }).join('');

  container.querySelectorAll('[data-start]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        await api('POST', `/api/competitions/${btn.dataset.start}/start`);
        await refresh();
      } catch (err) {
        alert(err.message);
        btn.disabled = false;
      }
    });
  });
}

async function refresh() {
  const { league, competitions } = await api('GET', `/api/leagues/${leagueId}`);
  renderLeagueInfo(league);

  const memberIds = league.members.map((m) => m.id).join(',');
  if (memberIds !== lastMemberIds) {
    lastMemberIds = memberIds;
    renderGameChoices(league.members);
  }
  document.getElementById('comp-hint').textContent = league.members.length < 2
    ? 'Need at least 2 members to start a competition.'
    : '';

  await renderCompetitions(competitions);
}

document.getElementById('comp-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = document.getElementById('comp-err');
  clearError(errEl);
  const name = document.getElementById('comp-name').value.trim();
  const games = buildGamesPayload();
  if (!games.length) return showError(errEl, new Error('Pick at least one game.'));
  try {
    await api('POST', `/api/leagues/${leagueId}/competitions`, { name, games });
    document.getElementById('comp-form').reset();
    document.querySelectorAll('.game-choice').forEach((c) => c.classList.remove('checked'));
    document.querySelectorAll('.lottery-odds').forEach((o) => { o.style.display = 'none'; });
    await refresh();
  } catch (err) {
    showError(errEl, err);
  }
});

(async () => {
  await loadCatalogOnce();
  await refresh();
  setInterval(refresh, 4000);
})();
