const ICONS = { lottery: '🏈', bracket: '⚡', trivia: '🧠' };

function modePill(mode) {
  const label = mode === 'live' ? 'Live' : 'Async';
  return `<span class="pill ${mode === 'live' ? 'active' : ''}">${label}</span>`;
}

async function loadGames() {
  const container = document.getElementById('game-cards');
  try {
    const { games } = await api('GET', '/api/game-catalog');
    container.innerHTML = games.map((g) => `
      <div class="panel">
        <div style="font-size:1.8rem">${ICONS[g.category] || '🎮'}</div>
        <h3 style="margin:8px 0 4px">${escapeHtml(g.name)}</h3>
        <p class="muted">${escapeHtml(g.description || '')}</p>
        <div style="display:flex; gap:6px; flex-wrap:wrap">${g.supportedModes.map(modePill).join('')}</div>
      </div>
    `).join('');
  } catch (err) {
    container.innerHTML = `<p class="error">Couldn't load games: ${escapeHtml(err.message)}</p>`;
  }
}

loadGames();
