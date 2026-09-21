function modePill(mode) {
  const label = mode === 'live' ? 'Live' : 'Async';
  return `<span class="pill ${mode === 'live' ? 'active' : ''}">${label}</span>`;
}

// A real screenshot from each game (see public/images/game-shots/) instead
// of an icon/emoji standing in for it — one static shot per category, not
// per game, since category and game are currently 1:1.
function thumbFor(category, name) {
  return `<img class="game-thumb" src="/images/game-shots/${category}.png" alt="${escapeHtml(name)} screenshot" loading="lazy">`;
}

async function loadGames() {
  const container = document.getElementById('game-cards');
  try {
    const { games } = await api('GET', '/api/game-catalog');
    container.innerHTML = games.map((g) => `
      <div class="panel">
        ${thumbFor(g.category, g.name)}
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
