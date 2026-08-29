const instanceId = qs('instance');
const leagueId = qs('league');
const memberId = qs('member');
document.getElementById('back-link').href = leagueId ? `/member-home.html?league=${leagueId}` : '/';

let countdownInterval = null;
let timeoutTimer = null;
let answered = false;

function clearTimers() {
  if (countdownInterval) clearInterval(countdownInterval);
  if (timeoutTimer) clearTimeout(timeoutTimer);
  countdownInterval = null;
  timeoutTimer = null;
}

// A ticking whole-number readout, colored green/yellow/red by how much time
// is left — purely visual, the server is what actually times the answer.
// clearTimers() (called the instant a choice is clicked) stops this dead, so
// it never keeps ticking past the moment someone's answered.
function timerColorClass(remaining) {
  if (remaining >= 5) return '';
  if (remaining >= 3) return 'warn';
  return 'danger';
}

function startCountdown(seconds, onExpire) {
  const num = document.getElementById('timer-num');
  let remaining = seconds;
  num.textContent = remaining;
  num.className = `trivia-timer-num ${timerColorClass(remaining)}`;
  countdownInterval = setInterval(() => {
    remaining -= 1;
    const shown = Math.max(remaining, 0);
    num.textContent = shown;
    num.className = `trivia-timer-num ${timerColorClass(shown)}`;
    if (remaining <= 0) { clearInterval(countdownInterval); countdownInterval = null; }
  }, 1000);
  timeoutTimer = setTimeout(onExpire, seconds * 1000 + 80); // small buffer past the server's own clock
}

function renderQuestion(gi) {
  answered = false;
  const q = gi.currentQuestion;
  document.getElementById('quiz-panel').style.display = 'block';
  document.getElementById('done-panel').style.display = 'none';
  document.getElementById('status-line').textContent = `Question ${q.index + 1} of ${q.total}`;
  document.getElementById('question-text').textContent = q.text;
  document.getElementById('feedback').style.display = 'none';
  document.getElementById('next-btn').style.display = 'none';

  const choicesEl = document.getElementById('choices');
  choicesEl.innerHTML = q.choices.map((choice, i) =>
    `<button class="choice-btn secondary" data-choice="${i}">${escapeHtml(choice)}</button>`).join('');

  if (q.answered) {
    // Already answered (e.g. a page refresh landed here) — show the outcome
    // as-is, no countdown, just wait for them to hit Next.
    showOutcome(q.answered);
    return;
  }

  choicesEl.querySelectorAll('.choice-btn').forEach((btn) => {
    btn.addEventListener('click', () => submitChoice(Number(btn.dataset.choice)));
  });
  startCountdown(gi.countdownSeconds || 10, () => submitChoice(null));
}

async function submitChoice(choiceIndex) {
  if (answered) return; // clicking is answering — first click (or the timeout) wins, no submit button
  answered = true;
  clearTimers();
  document.querySelectorAll('.choice-btn').forEach((b) => { b.disabled = true; });
  try {
    const { outcome } = await api('POST', `/api/game-instances/${instanceId}/trivia/answer`, { memberId, choiceIndex });
    showOutcome(outcome);
  } catch (err) {
    alert(err.message);
  }
}

function showOutcome(outcome) {
  clearTimers();
  document.querySelectorAll('.choice-btn').forEach((btn, i) => {
    btn.disabled = true;
    if (i === outcome.correctIndex) btn.classList.add('choice-correct');
    else if (i === outcome.choiceIndex) btn.classList.add('choice-wrong');
  });
  const feedback = document.getElementById('feedback');
  feedback.style.display = 'block';
  if (outcome.correct) {
    feedback.textContent = `Correct! +${outcome.points} point${outcome.points === 1 ? '' : 's'}`;
    feedback.className = 'trivia-feedback correct';
  } else {
    feedback.textContent = outcome.choiceIndex == null ? "Time's up — 0 points." : 'Not quite — 0 points.';
    feedback.className = 'trivia-feedback incorrect';
  }
  document.getElementById('next-btn').style.display = 'inline-block';
}

document.getElementById('next-btn').addEventListener('click', async () => {
  const btn = document.getElementById('next-btn');
  btn.disabled = true;
  try {
    const { gameInstance: gi } = await api('POST', `/api/game-instances/${instanceId}/trivia/next`, { memberId });
    if (gi.hasCompleted) {
      showDone(`You finished with ${gi.yourScore} point${gi.yourScore === 1 ? '' : 's'}! Waiting on the rest of the league…`);
    } else {
      renderQuestion(gi);
    }
  } catch (err) {
    alert(err.message);
  } finally {
    btn.disabled = false;
  }
});

function showDone(message) {
  clearTimers();
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

  if (gi.status === 'completed') {
    showDone(gi.yourScore != null ? `Contest finished. You scored ${gi.yourScore} point${gi.yourScore === 1 ? '' : 's'}.` : 'Contest finished.');
    return;
  }
  if (gi.hasCompleted) {
    showDone(`You finished with ${gi.yourScore} point${gi.yourScore === 1 ? '' : 's'}! Waiting on the rest of the league…`);
    poll();
    return;
  }
  renderQuestion(gi);
}

function poll() {
  setInterval(async () => {
    const { gameInstance: gi } = await api('GET', `/api/game-instances/${instanceId}?memberId=${memberId}`);
    if (gi.status === 'completed') {
      showDone(gi.yourScore != null ? `Contest finished. You scored ${gi.yourScore} point${gi.yourScore === 1 ? '' : 's'}.` : 'Contest finished.');
    }
  }, 4000);
}

init();
