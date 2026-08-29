const leagueId = qs('league');
const member = leagueId ? getMembership(leagueId) : null;

if (!leagueId || !member) {
  document.body.innerHTML = '<main><p class="error">You need to join this league first. <a href="/join.html">Join here</a>.</p></main>';
  throw new Error('not a member');
}

document.getElementById('greeting').textContent = `Hi, ${member.name}!`;

function gameLink(gi) {
  const pageByType = { lottery: 'play-lottery.html', trivia: 'play-trivia.html', fieldGoal: 'play-field-goal.html' };
  return `/${pageByType[gi.gameType]}?instance=${gi.id}&league=${leagueId}&member=${member.id}`;
}

function actionLabel(gi) {
  if (gi.status === 'completed') return 'View result';
  if (gi.gameType === 'lottery') return 'Watch the draw';
  if (gi.gameType === 'trivia') return gi.hasCompleted ? 'View / waiting' : 'Take the quiz';
  if (gi.gameType === 'fieldGoal') return gi.hasCompleted ? 'View / waiting' : 'Take your kicks';
  return 'Open';
}

async function render() {
  const { league, competitions } = await api('GET', `/api/leagues/${leagueId}`);
  document.getElementById('league-name').textContent = league.name;

  const container = document.getElementById('competitions');
  const active = competitions.filter((c) => c.status !== 'draft');
  if (!active.length) {
    container.innerHTML = '<p class="muted">No competitions yet — waiting on your commissioner.</p>';
    return;
  }

  container.innerHTML = (await Promise.all(active.map(async (c) => {
    const { competition, games } = await api('GET', `/api/competitions/${c.id}`);
    const gamesHtml = (await Promise.all(games.map(async (giSummary) => {
      const { gameInstance: gi } = await api('GET', `/api/game-instances/${giSummary.id}?memberId=${member.id}`);
      return `
        <li>
          <span>${escapeHtml(gi.gameName)} <span class="muted">(${gi.mode})</span></span>
          <a class="btn secondary" style="margin-top:0" href="${gameLink(gi)}">${actionLabel(gi)}</a>
        </li>`;
    }))).join('');

    const resultLink = competition.status === 'completed'
      ? `<a class="btn" href="/results.html?competition=${competition.id}">View final draft order</a>`
      : `<a class="btn secondary" href="/results.html?competition=${competition.id}">Live results</a>`;

    return `
      <div class="panel panel-2" style="margin-bottom:14px">
        <strong>${escapeHtml(competition.name)}</strong> <span class="pill ${competition.status}">${competition.status}</span>
        <ul class="clean" style="margin-top:10px">${gamesHtml}</ul>
        ${resultLink}
      </div>`;
  }))).join('');
}

render();
setInterval(render, 5000);
