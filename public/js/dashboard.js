const leagueId = qs('id');
if (!leagueId) document.body.innerHTML = '<main><p class="error">No league id in URL.</p></main>';

let catalog = [];
let lastMemberIds = [];
let currentMembers = [];
const MAX_LOTTERY_TEAMS = 12;

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

// The lottery doesn't need anyone to actually join — it's a one-shot draw, not
// something people play. So instead of pulling from league.members, the commissioner
// just types up to 12 team names (and last year's finish) directly here. Rows for
// members who *have* already joined are pre-filled as a convenience, but any name
// typed in — matched or not — becomes (or reuses) a real league member the moment
// the competition is created, so results/aggregation don't need special-casing.
function renderGameChoices(members) {
  const container = document.getElementById('game-choices');
  const defaultTeamCount = Math.min(MAX_LOTTERY_TEAMS, Math.max(members.length, 8));

  container.innerHTML = catalog.map((g) => {
    const oddsInputs = g.id === 'lottery'
      ? `<div class="lottery-odds" data-for="${g.id}" style="display:none; margin-top:10px">
          <label style="display:flex; align-items:center; gap:8px; margin-top:0">
            <input type="checkbox" data-randomize-game="${g.id}" style="width:auto" />
            <span>Make it completely random (ignore standings)</span>
          </label>
          <label for="team-count">Number of teams (2–${MAX_LOTTERY_TEAMS} — typically 8, 10, or 12)</label>
          <input type="number" id="team-count" min="2" max="${MAX_LOTTERY_TEAMS}" value="${defaultTeamCount}" style="max-width:100px" />
          <div data-standings-for="${g.id}" style="margin-top:10px">
            <label style="margin-top:0">Team name and last year's finish (1 = champion, higher = worse — worse finish automatically gets better odds at pick #1). Teams that have already joined are filled in — add the rest yourself, no need to wait on anyone.</label>
            <div class="row" id="lottery-team-rows">
              ${Array.from({ length: MAX_LOTTERY_TEAMS }).map((_, i) => `
                <div data-team-row="${i}" style="${i < defaultTeamCount ? '' : 'display:none'}">
                  <input type="text" placeholder="Team ${i + 1} name" value="${escapeHtml((members[i] && members[i].name) || '')}" data-team-name-idx="${i}" />
                  <input type="number" min="1" step="1" value="${i + 1}" data-team-finish-idx="${i}" style="margin-top:6px" />
                </div>`).join('')}
            </div>
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

  container.querySelectorAll('[data-randomize-game]').forEach((chk) => {
    chk.addEventListener('change', () => {
      const standings = container.querySelector(`[data-standings-for="${chk.dataset.randomizeGame}"]`);
      if (standings) standings.style.display = chk.checked ? 'none' : 'block';
    });
  });

  const teamCountInput = container.querySelector('#team-count');
  if (teamCountInput) {
    teamCountInput.addEventListener('input', () => {
      const count = Math.min(MAX_LOTTERY_TEAMS, Math.max(2, Number(teamCountInput.value) || 2));
      container.querySelectorAll('[data-team-row]').forEach((row) => {
        row.style.display = Number(row.dataset.teamRow) < count ? '' : 'none';
      });
    });
  }
}

// Finds (by exact case-insensitive name) or creates a league member for a
// commissioner-typed team name — this is what lets the lottery run without
// anyone having joined: typing the name here *is* how they get added.
async function ensureMember(name) {
  const existing = currentMembers.find((m) => m.name.toLowerCase() === name.toLowerCase());
  if (existing) return existing.id;
  const { member } = await api('POST', `/api/leagues/${leagueId}/members`, { name });
  currentMembers.push(member);
  return member.id;
}

async function buildGamesPayload() {
  const games = [];
  for (const chk of document.querySelectorAll('[data-game-checkbox]:checked')) {
    const gameType = chk.dataset.gameCheckbox;
    const mode = document.querySelector(`[data-game-mode="${gameType}"]`).value;
    let config = {};
    if (gameType === 'lottery') {
      const randomize = document.querySelector(`[data-randomize-game="${gameType}"]`).checked;
      const teamCount = Math.min(MAX_LOTTERY_TEAMS, Math.max(2, Number(document.getElementById('team-count').value) || 2));
      // Validate before creating anything — a rejected submit shouldn't leave
      // half-created members sitting in the league.
      const entries = [];
      for (let i = 0; i < teamCount; i++) {
        const name = document.querySelector(`[data-team-name-idx="${i}"]`).value.trim();
        if (!name) continue;
        const finish = Number(document.querySelector(`[data-team-finish-idx="${i}"]`).value) || 1;
        entries.push({ name, finish });
      }
      if (entries.length < 2) {
        throw new Error('Enter at least 2 team names for the lottery.');
      }

      const odds = {};
      for (const entry of entries) {
        const memberId = await ensureMember(entry.name);
        // Weight = finish position directly: last place (highest number) naturally
        // gets the most weight, i.e. the best odds at pick #1 — no extra math needed.
        odds[memberId] = randomize ? 1 : entry.finish;
      }
      config = { odds, randomized: randomize };
    }
    games.push({ gameType, mode, config });
  }
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
    if (gi.status === 'revealing') return `Revealing… (${gi.revealedPicks ? gi.revealedPicks.length : 0}/${gi.totalPicks || '?'})`;
    if (gi.mode === 'live') return 'Ready — commissioner triggers the reveal';
    return 'Pending';
  }
  if (gi.gameType === 'reactionBracket') {
    if (gi.status === 'completed') return 'Bracket complete';
    return `Bracket in progress (${gi.mode})`;
  }
  if (gi.gameType === 'trivia') {
    const n = (gi.completedBy || []).length;
    return gi.status === 'completed' ? 'Trivia complete' : `${n} finished so far`;
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
  currentMembers = league.members;

  const memberIds = league.members.map((m) => m.id).join(',');
  if (memberIds !== lastMemberIds) {
    lastMemberIds = memberIds;
    renderGameChoices(league.members);
  }
  document.getElementById('comp-hint').textContent = league.members.length < 2
    ? 'Need at least 2 members to create a bracket or trivia competition — the lottery doesn\'t need anyone to have joined, just type in team names below.'
    : '';

  await renderCompetitions(competitions);
}

document.getElementById('comp-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = document.getElementById('comp-err');
  clearError(errEl);
  const name = document.getElementById('comp-name').value.trim();
  const submitBtn = document.querySelector('#comp-form button[type="submit"]');
  try {
    submitBtn.disabled = true;
    const games = await buildGamesPayload();
    if (!games.length) throw new Error('Pick at least one game.');
    await api('POST', `/api/leagues/${leagueId}/competitions`, { name, games });
    document.getElementById('comp-form').reset();
    document.querySelectorAll('.game-choice').forEach((c) => c.classList.remove('checked'));
    document.querySelectorAll('.lottery-odds').forEach((o) => { o.style.display = 'none'; });
    document.querySelectorAll('[data-randomize-game]').forEach((c) => { c.checked = false; });
    document.querySelectorAll('[data-standings-for]').forEach((s) => { s.style.display = 'block'; });
    await refresh();
  } catch (err) {
    showError(errEl, err);
  } finally {
    submitBtn.disabled = false;
  }
});

document.getElementById('test-trivia-btn').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  try {
    const { instanceId } = await api('POST', `/api/leagues/${leagueId}/test-trivia`, {});
    window.location.href = `/play-trivia.html?instance=${instanceId}&league=${leagueId}&member=solo-test`;
  } catch (err) {
    alert(err.message);
    btn.disabled = false;
  }
});

(async () => {
  await loadCatalogOnce();
  await refresh();
  setInterval(refresh, 4000);
})();
