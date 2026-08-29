const instanceId = qs('instance');
const leagueId = qs('league');
document.getElementById('back-link').href = leagueId ? `/member-home.html?league=${leagueId}` : '/';

let members = [];
let totalPicks = 0;
let finalResults = []; // set once the draw is known — lets the Replay button re-run it
let onRaceFullyDone = null; // fires once every runner has actually crossed the line

// Everyone races at once, and every runner ends up at the same spot — a
// little past the goal line, inside the end zone (which starts at 88%) —
// regardless of pick. Nobody visually reaches FINISH_PCT except by actually
// finishing: the jitter loop is capped short of it (JITTER_CEILING) so nobody
// "spoils" the reveal by looking done before their pick is announced.
const LANE_MARGIN = 2;
const JITTER_CEILING = 84;
const FINISH_PCT = 94;

const racing = new Set(); // memberIds currently in the stride loop
const released = new Map(); // memberId -> rank, once their pick is revealed
const finishedIds = new Set(); // memberIds that have actually crossed the line
const stumbleTimers = new Map(); // memberId -> timeout id, for reverting the stumble pose
// Bumped on every resetField() so any in-flight stride loop from a previous
// race (e.g. one still mid-kick when Replay is clicked) recognizes it's
// stale and stops, instead of two loops fighting over the same runner.
let raceGeneration = 0;

function nameFor(memberId) {
  const m = members.find((x) => x.id === memberId);
  return m ? m.name : memberId;
}

// A small SVG football player — helmet, jersey with a trim stripe, padded
// arms/legs, cleats — built from a handful of shapes rather than a photo or
// 3D model (this is a self-contained static site, no asset pipeline for
// that), but with the same "little animated character" spirit. The jersey
// and helmet use currentColor so a team's assigned color (and the winner's
// gold override) both come from the outer .runner element's CSS `color`,
// same mechanism as before — only the pants/cleats/facemask are fixed
// colors so they don't flip gold too.
function runnerFigureSvg() {
  return `
    <svg viewBox="0 0 24 32" width="23" height="30" xmlns="http://www.w3.org/2000/svg">
      <g class="leg leg-l">
        <rect x="8" y="19" width="4" height="9" rx="2" fill="#e9e9ec" />
        <ellipse cx="10" cy="28.4" rx="3" ry="1.7" fill="#232323" />
      </g>
      <g class="leg leg-r">
        <rect x="12" y="19" width="4" height="9" rx="2" fill="#e9e9ec" />
        <ellipse cx="14" cy="28.4" rx="3" ry="1.7" fill="#232323" />
      </g>
      <path class="torso" d="M6 8 Q6 6.5 8 6.5 L16 6.5 Q18 6.5 18 8 L17.3 19 Q12 20.6 6.7 19 Z" fill="currentColor" />
      <rect x="6.2" y="9.6" width="11.6" height="2" fill="rgba(255,255,255,0.32)" />
      <g class="arm arm-l">
        <rect x="2.2" y="8.5" width="4.4" height="9.5" rx="2.2" fill="currentColor" />
      </g>
      <g class="arm arm-r">
        <rect x="17.4" y="8.5" width="4.4" height="9.5" rx="2.2" fill="currentColor" />
      </g>
      <circle class="head" cx="12" cy="5" r="5.4" fill="currentColor" stroke="rgba(0,0,0,0.35)" stroke-width="0.5" />
      <path d="M12 0.2 L12 5.6" stroke="rgba(255,255,255,0.4)" stroke-width="1.1" />
      <path class="facemask" d="M7.6 5.6 Q12 8.6 16.4 5.6" fill="none" stroke="#f4f4f4" stroke-width="1.1" stroke-linecap="round" />
    </svg>
  `;
}

// A distinct jersey color per team, assigned by roster position so it stays
// the same across re-renders/replays — closer to real team colors than
// everyone racing in one flat color.
const JERSEY_COLORS = ['#e63946', '#2a9d8f', '#3a86ff', '#f4a261', '#8338ec', '#06d6a0', '#ef476f', '#118ab2', '#ffbe0b', '#c1121f', '#4cc9f0', '#7209b7'];

// The referee who kicks things off — same low-poly-shapes approach as the
// runners, just a one-off figure instead of something rendered per lane.
function refereeFigureSvg() {
  return `
    <svg viewBox="0 0 24 34" width="34" height="48" xmlns="http://www.w3.org/2000/svg">
      <rect x="8" y="23" width="4" height="9" rx="1.6" fill="#1c1c1c" />
      <rect x="12" y="23" width="4" height="9" rx="1.6" fill="#1c1c1c" />
      <ellipse cx="10" cy="32.3" rx="2.6" ry="1.4" fill="#050505" />
      <ellipse cx="14" cy="32.3" rx="2.6" ry="1.4" fill="#050505" />
      <clipPath id="refStripes">
        <path d="M6.5 9 Q6.5 7.2 8.3 7.2 L15.7 7.2 Q17.5 7.2 17.5 9 L16.9 23 Q12 24.4 7.1 23 Z" />
      </clipPath>
      <g clip-path="url(#refStripes)">
        <rect x="6.5" y="7.2" width="2.2" height="17" fill="#f4f4f4" />
        <rect x="8.7" y="7.2" width="2.2" height="17" fill="#151515" />
        <rect x="10.9" y="7.2" width="2.2" height="17" fill="#f4f4f4" />
        <rect x="13.1" y="7.2" width="2.2" height="17" fill="#151515" />
        <rect x="15.3" y="7.2" width="2.2" height="17" fill="#f4f4f4" />
        <rect x="17.5" y="7.2" width="2.2" height="17" fill="#151515" />
      </g>
      <rect x="2.6" y="9.5" width="4" height="9.5" rx="2" fill="#151515" />
      <rect x="15.7" y="4.6" width="4" height="9.5" rx="2" fill="#151515" transform="rotate(-34 17.7 9.35)" />
      <circle cx="18.4" cy="6.1" r="1.15" fill="#e8e8e8" />
      <circle cx="12" cy="4.8" r="4.8" fill="#e8b98a" />
      <path d="M7.3 3.1 Q12 -0.8 16.7 3.1 L16.5 4.3 Q12 2.3 7.5 4.3 Z" fill="#151515" />
    </svg>
  `;
}
document.getElementById('referee-figure').innerHTML = refereeFigureSvg();

// "Ready... Set... GO!" in a speech bubble before the runners start moving —
// on a fresh live race and on every replay alike. `onDone` fires right as GO!
// clears, which is when the actual race (jitter loops, reveal schedule)
// should begin — this is purely a pre-roll, it doesn't affect the outcome.
function playReadySetGo(onDone) {
  const overlay = document.getElementById('ready-overlay');
  const bubble = document.getElementById('ready-bubble');
  const text = document.getElementById('ready-text');
  overlay.style.display = 'flex';

  const steps = [
    { word: 'Ready…', ms: 650 },
    { word: 'Set…', ms: 650 },
    { word: 'GO!', ms: 500 },
  ];
  let i = 0;
  const showNext = () => {
    if (i >= steps.length) {
      overlay.style.display = 'none';
      bubble.classList.remove('go-word');
      onDone();
      return;
    }
    const { word, ms } = steps[i];
    text.textContent = word;
    bubble.classList.toggle('go-word', word === 'GO!');
    // Restart the pop-in animation for each new word (just toggling the
    // class wouldn't retrigger it, since it'd already be present).
    bubble.classList.remove('pop');
    void bubble.offsetWidth;
    bubble.classList.add('pop');
    i++;
    setTimeout(showNext, ms);
  };
  showNext();
}

function renderField() {
  const field = document.getElementById('field');
  field.innerHTML = members.map((m, i) => `
    <div class="lane" data-member="${m.id}">
      <span class="lane-name">${escapeHtml(m.name)}</span>
      <div class="lane-track">
        <div class="runner idle-jitter" id="runner-${m.id}" style="left:${LANE_MARGIN}%; color:${JERSEY_COLORS[i % JERSEY_COLORS.length]}">${runnerFigureSvg()}</div>
      </div>
    </div>
  `).join('') + '<div class="end-zone">100&nbsp;YD</div>';
}

// Puts every runner back at the goal line and clears all race state — used
// both before the very first run and before a replay.
function resetField() {
  raceGeneration++;
  racing.clear();
  released.clear();
  finishedIds.clear();
  stumbleTimers.forEach((t) => clearTimeout(t));
  stumbleTimers.clear();
  document.getElementById('latest-pick').style.display = 'none';
  hideResultsOverlay();
  renderField();
}

function showLatest(rank, memberId) {
  const el = document.getElementById('latest-pick');
  el.style.display = 'block';
  el.innerHTML = `<div class="pick-num">Pick #${rank}</div><div class="pick-name">${escapeHtml(nameFor(memberId))}</div>`;
}

function showResultsOverlay(results) {
  const ordered = results.slice().sort((a, b) => a.rank - b.rank);
  document.getElementById('overlay-order-list').innerHTML =
    ordered.map((r) => `<li>${escapeHtml(nameFor(r.memberId))}</li>`).join('');
  document.getElementById('results-overlay').style.display = 'flex';
}

function hideResultsOverlay() {
  document.getElementById('results-overlay').style.display = 'none';
}

// Every team runs continuously once the race starts — nobody's runner sits
// still waiting their turn. Two phases, both made of visible strides (never
// one smooth glide):
//   - cruising: slow, jittery, backward slips included — this is most of the
//     race, and it's deliberately unhurried.
//   - kicking: once a pick is revealed, the runner switches to a quicker,
//     always-forward sprint for the line — like a real racer's finishing
//     kick, not a teleport. It's still made of the same kind of hops, just
//     faster ones, and it's what keeps the finish from dragging on: reveals
//     are only ~1.8s apart, and cruising pace alone could take a cruising
//     runner *much* longer than that to close an arbitrary remaining gap.
// None of this affects the actual outcome, which was already decided
// server-side — it's purely what it looks like getting there.
function startJitter(memberId) {
  if (racing.has(memberId)) return; // already looping this generation — don't double up
  const myGeneration = raceGeneration;
  racing.add(memberId);
  const runner = document.getElementById(`runner-${memberId}`);
  if (!runner) return;
  runner.classList.remove('idle-jitter');
  runner.classList.add('running');

  const tick = () => {
    // Stale loop from a previous race (e.g. Replay was clicked mid-kick) — stop.
    if (myGeneration !== raceGeneration || !racing.has(memberId)) return;
    const pos = parseFloat(runner.style.left) || LANE_MARGIN;
    const rank = released.get(memberId);
    const kicking = rank != null;
    // Smaller, more frequent steps than a single big leap — keeps the pace
    // similar while each individual hop stays modest.
    const step = kicking
      ? 1.5 + Math.random() * 3.5 // 1.5-5%, always forward — the finishing kick
      : -0.5 + Math.random() * 2.5; // -0.5 to 2, mostly forward — the cruise
    const ceiling = kicking ? FINISH_PCT : JITTER_CEILING;
    const next = Math.max(LANE_MARGIN, Math.min(ceiling, pos + step));
    runner.style.left = `${next}%`;

    if (kicking && next >= FINISH_PCT - 0.1) {
      racing.delete(memberId);
      clearTimeout(stumbleTimers.get(memberId));
      runner.classList.remove('running', 'stumble');
      finishRunner(rank, memberId, runner);
      return;
    }
    // A backward slip mid-cruise — caught off balance, down on one knee for
    // a beat before getting back up and rejoining the run.
    if (!kicking && step < 0) {
      runner.classList.remove('running');
      runner.classList.add('stumble');
      clearTimeout(stumbleTimers.get(memberId));
      stumbleTimers.set(memberId, setTimeout(() => {
        if (myGeneration === raceGeneration && racing.has(memberId)) {
          runner.classList.remove('stumble');
          runner.classList.add('running');
        }
      }, 260));
    }
    setTimeout(tick, kicking ? 130 + Math.random() * 90 : 220 + Math.random() * 180);
  };
  setTimeout(tick, Math.random() * 300); // stagger everyone's first stride so they don't move in lockstep
}

// Bookkeeping once a runner has actually crossed the line. The results
// overlay waits for *this* — every member actually finished animating — not
// for the reveal events alone, which arrive well before the last runner's
// kick animation actually completes.
function finishRunner(rank, memberId, runner) {
  if (!runner.querySelector('.pick-flag')) {
    const flag = document.createElement('div');
    flag.className = 'pick-flag';
    flag.textContent = `#${rank}`;
    runner.appendChild(flag);
  }
  if (rank === 1) runner.classList.add('runner-winner');
  showLatest(rank, memberId);

  finishedIds.add(memberId);
  if (finishedIds.size === members.length && finalResults.length) {
    document.getElementById('status-line').textContent = 'Draw complete!';
    showResultsOverlay(finalResults);
    if (onRaceFullyDone) { const cb = onRaceFullyDone; onRaceFullyDone = null; cb(); }
  }
}

// A pick's been revealed — let that runner's next few strides carry it past
// JITTER_CEILING and on to FINISH_PCT instead of stopping short.
function crossFinishLine(rank, memberId) {
  released.set(memberId, rank);
}

// Late joiners catching up on picks that were already revealed before they
// connected — no need to replay any of it, just place them at the line.
function snapToFinish(rank, memberId) {
  const runner = document.getElementById(`runner-${memberId}`);
  if (!runner) return;
  racing.delete(memberId);
  clearTimeout(stumbleTimers.get(memberId));
  runner.classList.remove('idle-jitter', 'running', 'stumble');
  runner.style.left = `${FINISH_PCT}%`;
  finishRunner(rank, memberId, runner);
}

function beginRace(stillRacingIds) {
  document.getElementById('status-line').textContent = 'The race is on…';
  document.getElementById('run-panel').style.display = 'none';
  stillRacingIds.forEach(startJitter);
}

// Runs the (already-decided) draw for anyone loading a finished lottery, or
// replaying one — same pacing and jitter as watching it live, purely for the
// show of it. `onDone`, if given, fires once every runner has actually
// crossed the line and the results overlay is up (not just once every pick
// has been handed off to a runner — those two can be several seconds apart).
function replayAsync(results, onDone) {
  finalResults = results;
  onRaceFullyDone = onDone || null;
  const order = results.slice().sort((a, b) => a.rank - b.rank); // best to worst — pick #1 finishes first
  document.getElementById('status-line').textContent = 'Get ready…';
  playReadySetGo(() => {
    beginRace(order.map((r) => r.memberId));
    let i = 0;
    const step = () => {
      if (i >= order.length) return; // all handed off — completion now waits on finishRunner
      const { rank, memberId } = order[i];
      crossFinishLine(rank, memberId);
      i++;
      setTimeout(step, 1800);
    };
    setTimeout(step, 900);
  });
}

function wireResultsControls() {
  const replayBtn = document.getElementById('replay-btn');
  replayBtn.addEventListener('click', () => {
    replayBtn.disabled = true;
    resetField();
    replayAsync(finalResults, () => { replayBtn.disabled = false; });
  });

  document.getElementById('results-close').addEventListener('click', hideResultsOverlay);

  document.getElementById('copy-link-btn').addEventListener('click', async () => {
    const feedback = document.getElementById('copy-feedback');
    try {
      await navigator.clipboard.writeText(window.location.href);
      feedback.textContent = 'Link copied!';
    } catch {
      feedback.textContent = window.location.href; // clipboard blocked — show it to copy by hand
    }
    setTimeout(() => { feedback.textContent = ''; }, 2500);
  });
}

async function init() {
  const { gameInstance: gi } = await api('GET', `/api/game-instances/${instanceId}`);
  const { league } = await api('GET', `/api/leagues/${leagueId}`);
  members = league.members;

  totalPicks = gi.totalPicks || members.length;
  renderField();
  wireResultsControls();

  if (gi.status === 'completed') {
    replayAsync(gi.results);
    return;
  }

  // Late joiner during a live reveal — snap the decided picks into place, and
  // get everyone still in it moving right away (the race is already underway).
  const alreadyRevealedIds = new Set();
  (gi.revealedPicks || []).forEach(({ pick, memberId }) => {
    snapToFinish(pick, memberId);
    alreadyRevealedIds.add(memberId);
  });
  if (gi.status === 'revealing') {
    const stillRacing = members.map((m) => m.id).filter((id) => !alreadyRevealedIds.has(id));
    beginRace(stillRacing);
  }

  if (gi.mode === 'live' && gi.status === 'ready' && isCommish(leagueId)) {
    document.getElementById('run-panel').style.display = 'block';
    document.getElementById('run-btn').addEventListener('click', async () => {
      document.getElementById('run-btn').disabled = true;
      try { await api('POST', `/api/game-instances/${instanceId}/lottery/run`); }
      catch (err) { alert(err.message); document.getElementById('run-btn').disabled = false; }
    });
  }

  if (gi.status !== 'revealing') {
    document.getElementById('status-line').textContent = gi.mode === 'live'
      ? 'Waiting for the commissioner to start the race…'
      : 'Waiting for the race to run…';
  }

  const socket = io();
  socket.emit('join-room', { gameInstanceId: instanceId });
  socket.on('lottery:started', () => {
    document.getElementById('status-line').textContent = 'Get ready…';
    playReadySetGo(() => beginRace(members.map((m) => m.id)));
  });
  socket.on('lottery:reveal', ({ pick, memberId }) => crossFinishLine(pick, memberId));
  socket.on('lottery:complete', ({ results }) => {
    // Every pick has been handed off to a runner, but the last one or two are
    // likely still mid-kick — finishRunner shows the overlay once they've
    // actually all arrived. Cover the (unlikely) case where they somehow beat
    // this event here rather than leave the overlay stuck.
    finalResults = results;
    if (finishedIds.size === members.length) {
      document.getElementById('status-line').textContent = 'Draw complete!';
      showResultsOverlay(results);
    }
  });
}

init();
