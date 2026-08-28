const instanceId = qs('instance');
const leagueId = qs('league');
const memberId = qs('member');
document.getElementById('back-link').href = leagueId ? `/member-home.html?league=${leagueId}` : '/';

let startedAt = Date.now();

function renderQuiz(gi) {
  document.getElementById('quiz-panel').style.display = 'block';
  const form = document.getElementById('quiz-form');
  form.innerHTML = gi.questions.map((q, qi) => `
    <div style="margin-bottom:20px">
      <label style="font-size:1rem;color:var(--text)">${qi + 1}. ${escapeHtml(q.text)}</label>
      ${q.choices.map((choice, ci) => `
        <label style="display:flex;align-items:center;gap:8px;font-weight:400;font-size:0.95rem;margin:4px 0">
          <input type="radio" name="${q.id}" value="${ci}" required style="width:auto" />
          ${escapeHtml(choice)}
        </label>`).join('')}
    </div>`).join('') + '<button type="submit">Submit answers</button><p class="error" id="err" style="display:none"></p>';

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('err');
    clearError(errEl);
    const answers = {};
    gi.questions.forEach((q) => {
      const checked = form.querySelector(`input[name="${q.id}"]:checked`);
      answers[q.id] = checked ? Number(checked.value) : -1;
    });
    const elapsedMs = Date.now() - startedAt;
    try {
      const { outcome } = await api('POST', `/api/game-instances/${instanceId}/trivia/submit`, { memberId, answers, elapsedMs });
      showDone(`You scored ${outcome.score}/${outcome.total}. Waiting on the rest of the league…`);
    } catch (err) {
      showError(errEl, err);
    }
  });
}

function showDone(message) {
  document.getElementById('quiz-panel').style.display = 'none';
  document.getElementById('done-panel').style.display = 'block';
  document.getElementById('done-message').textContent = message;
}

async function init() {
  if (!memberId) {
    document.getElementById('status-line').textContent = 'This is a spectator link — trivia is answered individually by each member.';
    return;
  }
  const { gameInstance: gi } = await api('GET', `/api/game-instances/${instanceId}?memberId=${memberId}`);
  document.getElementById('status-line').textContent = `${gi.questionCount} questions — answer at your own pace.`;

  if (gi.status === 'completed') {
    showDone(gi.yourScore != null ? `Contest finished. You scored ${gi.yourScore}/${gi.questionCount}.` : 'Contest finished.');
    return;
  }
  if (gi.hasSubmitted) {
    showDone(`You scored ${gi.yourScore}/${gi.questionCount}. Waiting on the rest of the league…`);
    poll();
    return;
  }
  renderQuiz(gi);
}

async function poll() {
  setInterval(async () => {
    const { gameInstance: gi } = await api('GET', `/api/game-instances/${instanceId}?memberId=${memberId}`);
    if (gi.status === 'completed') {
      showDone(gi.yourScore != null ? `Contest finished. You scored ${gi.yourScore}/${gi.questionCount}.` : 'Contest finished.');
    }
  }, 4000);
}

init();
