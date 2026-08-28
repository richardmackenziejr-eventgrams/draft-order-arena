const instanceId = qs('instance');
const leagueId = qs('league');
const memberId = qs('member');
document.getElementById('back-link').href = leagueId ? `/member-home.html?league=${leagueId}` : '/';

let members = [];
let mode = null;
let socket = null;
let boxState = 'idle'; // idle | waiting | go | done
let currentMatchId = null;
let asyncWaitTimer = null;
let asyncGoAt = null;

function nameFor(id) {
  if (!id) return 'BYE';
  const m = members.find((x) => x.id === id);
  return m ? m.name : id;
}

function renderBracket(bracket) {
  const el = document.getElementById('bracket');
  el.innerHTML = bracket.rounds.map((round, i) => {
    const label = i === bracket.rounds.length - 1 && round.length === 1 ? 'Final' : `Round ${i + 1}`;
    const matches = round.map((m) => {
      const aTxt = m.winner === m.a ? `<span class="winner">${escapeHtml(nameFor(m.a))}</span>` : escapeHtml(nameFor(m.a));
      const bTxt = m.b == null ? '<span class="muted">BYE</span>' : (m.winner === m.b ? `<span class="winner">${escapeHtml(nameFor(m.b))}</span>` : escapeHtml(nameFor(m.b)));
      return `<div class="match-card"><span>${aTxt}</span><span>vs</span><span>${bTxt}</span></div>`;
    }).join('');
    return `<div class="bracket-round"><div class="muted" style="margin-bottom:4px">${label}</div>${matches}</div>`;
  }).join('');
}

function setBox(cls, text) {
  const box = document.getElementById('reaction-box');
  box.className = `reaction-box ${cls}`;
  box.textContent = text;
}

function resetMatchUiForNewMatch(match) {
  currentMatchId = match.id;
  boxState = 'idle';
  document.getElementById('match-panel').style.display = 'block';
  const opponent = match.a === memberId ? match.b : match.a;
  document.getElementById('match-title').textContent = `Your match vs ${nameFor(opponent)}`;
  if (mode === 'live') {
    setBox('idle', 'Click when you’re ready to duel');
    document.getElementById('match-hint').textContent = 'Wait for the green screen, then click as fast as you can. Clicking early is a foul!';
  } else {
    const mySide = match.a === memberId ? 'a' : 'b';
    if (match.times[mySide] != null) {
      setBox('idle', 'Waiting for your opponent…');
      boxState = 'done';
    } else {
      setBox('idle', 'Tap to test your reaction time');
    }
    document.getElementById('match-hint').textContent = 'The box will wait, then turn green — click the instant it does. Clicking early resets you.';
  }
}

function clearAsyncTimer() {
  if (asyncWaitTimer) { clearTimeout(asyncWaitTimer); asyncWaitTimer = null; }
}

function startAsyncWait() {
  clearAsyncTimer();
  boxState = 'waiting';
  setBox('wait', 'Wait for it…');
  const delay = 1200 + Math.floor(Math.random() * 3000);
  asyncWaitTimer = setTimeout(() => {
    boxState = 'go';
    asyncGoAt = Date.now();
    setBox('go', 'CLICK NOW!');
  }, delay);
}

async function submitAsyncAttempt(reactionTimeMs) {
  boxState = 'done';
  setBox('idle', 'Submitting…');
  try {
    const { gameInstance } = await api('POST', `/api/game-instances/${instanceId}/reaction/attempt`, { memberId, reactionTimeMs });
    setBox('idle', `Submitted: ${reactionTimeMs}ms — waiting for opponent/result.`);
    applyInstance(gameInstance);
  } catch (err) {
    setBox('idle', `Couldn't submit: ${err.message}`);
  }
}

document.getElementById('reaction-box').addEventListener('click', () => {
  if (!currentMatchId) return;

  if (mode === 'live') {
    if (boxState === 'idle') {
      boxState = 'waiting';
      setBox('wait', 'Get ready… (don’t click yet)');
      socket.emit('reaction:ready', { gameInstanceId: instanceId, memberId, matchId: currentMatchId });
    } else if (boxState === 'waiting' || boxState === 'go') {
      // Server is authoritative on foul-vs-legit timing — just report the click.
      boxState = 'done';
      setBox('idle', 'Click sent — waiting for result…');
      socket.emit('reaction:click', { gameInstanceId: instanceId, memberId, matchId: currentMatchId });
    }
    return;
  }

  // Async mode.
  // NOTE (prototype limitation): the reaction time is measured and self-reported
  // by the browser, not verified by the server — fine for a demo, not for a
  // competition you'd trust real stakes on.
  if (boxState === 'idle') {
    startAsyncWait();
  } else if (boxState === 'waiting') {
    clearAsyncTimer();
    setBox('wait', 'Too soon! Resetting…');
    setTimeout(startAsyncWait, 900);
  } else if (boxState === 'go') {
    clearAsyncTimer();
    const reactionTimeMs = Date.now() - asyncGoAt;
    submitAsyncAttempt(reactionTimeMs);
  }
});

function applyInstance(gi) {
  renderBracket(gi.bracket);
  if (gi.status === 'completed') {
    document.getElementById('status-line').textContent = 'Bracket complete!';
    document.getElementById('match-panel').style.display = 'none';
    return;
  }
  document.getElementById('status-line').textContent = `Bracket in progress (${gi.mode} mode).`;
  if (memberId && gi.yourMatch && gi.yourMatch.status !== 'complete') {
    if (gi.yourMatch.id !== currentMatchId) resetMatchUiForNewMatch(gi.yourMatch);
  } else if (memberId) {
    document.getElementById('match-panel').style.display = 'block';
    document.getElementById('match-title').textContent = 'You’re through this round';
    setBox('idle', 'Waiting on the rest of the bracket…');
    currentMatchId = null;
  }
}

async function refreshInstance() {
  const url = `/api/game-instances/${instanceId}` + (memberId ? `?memberId=${memberId}` : '');
  const { gameInstance } = await api('GET', url);
  applyInstance(gameInstance);
}

async function init() {
  const { league } = await api('GET', `/api/leagues/${leagueId}`);
  members = league.members;

  const url = `/api/game-instances/${instanceId}` + (memberId ? `?memberId=${memberId}` : '');
  const { gameInstance } = await api('GET', url);
  mode = gameInstance.mode;
  applyInstance(gameInstance);

  socket = io();
  socket.emit('join-room', { gameInstanceId: instanceId });
  socket.on('reaction:go', ({ matchId }) => {
    if (matchId !== currentMatchId || boxState !== 'waiting') return;
    boxState = 'go';
    setBox('go', 'CLICK NOW!');
  });
  socket.on('reaction:match-result', () => refreshInstance());
  socket.on('bracket:update', ({ bracket }) => renderBracket(bracket));
  socket.on('bracket:complete', () => refreshInstance());
}

init();
