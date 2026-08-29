const ICONS = { trivia: '🧠' };

function modePill(mode) {
  const label = mode === 'live' ? 'Live' : 'Async';
  return `<span class="pill ${mode === 'live' ? 'active' : ''}">${label}</span>`;
}

// The 40 Yard Dash and Field Goal Kick get an actual runner/goalpost as
// their icon instead of an emoji; the other games keep a plain emoji.
function iconFor(category) {
  if (category === 'lottery') {
    return `<div style="color:#3a86ff; width:28px; height:36px; display:inline-block">${runnerFigureSvg()}</div>`;
  }
  if (category === 'kicking') {
    return `<div style="width:28px; height:36px; display:inline-block">${goalpostSvg()}</div>`;
  }
  return `<div style="font-size:1.8rem">${ICONS[category] || '🎮'}</div>`;
}

async function loadGames() {
  const container = document.getElementById('game-cards');
  try {
    const { games } = await api('GET', '/api/game-catalog');
    container.innerHTML = games.map((g) => `
      <div class="panel">
        ${iconFor(g.category)}
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
