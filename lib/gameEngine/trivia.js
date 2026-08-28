// Trivia Contest — async, self-paced. Each member answers the same fixed set of
// fantasy-football questions whenever suits them before the commissioner closes it;
// ranked by score (desc) then time taken (asc) as the tiebreak.
const id = 'trivia';
const name = 'Fantasy Football Trivia';
const description = 'An 8-question fantasy football quiz — everyone answers on their own time before the deadline, ranked by score and then speed.';
const category = 'trivia';
const supportedModes = ['async'];

const QUESTIONS = [
  { id: 'q1', text: 'How many players make up a standard fantasy football starting lineup (excluding bench/IR) in most standard leagues?', choices: ['7', '9', '11', '5'], correctIndex: 1 },
  { id: 'q2', text: 'In a PPR (points-per-reception) league, how many points does a reception typically earn?', choices: ['0.5', '1', '2', '3'], correctIndex: 1 },
  { id: 'q3', text: 'What does "waiver wire" refer to?', choices: ['Trading players between teams', 'The pool of unowned free-agent players', 'The playoff bracket', 'A penalty for missing lineup deadlines'], correctIndex: 1 },
  { id: 'q4', text: 'A "flex" roster spot can typically be filled by which positions?', choices: ['QB or TE', 'RB, WR, or TE', 'K or DST', 'Any position'], correctIndex: 1 },
  { id: 'q5', text: 'What is a "handcuff" in fantasy football?', choices: ['A rule locking your lineup once games start', 'Backup RB to your starting RB, drafted as insurance', 'A trade restriction', 'A penalty for tanking'], correctIndex: 1 },
  { id: 'q6', text: 'In a "snake" draft, the order:', choices: ['Stays the same every round', 'Reverses each round', 'Is randomized every round', 'Only applies to keeper leagues'], correctIndex: 1 },
  { id: 'q7', text: 'What does DST/D-ST stand for as a roster slot?', choices: ['Draft Selection Timer', 'Defense/Special Teams', 'Depth Starter', 'Division Standings'], correctIndex: 1 },
  { id: 'q8', text: 'Which of these best describes a "keeper league"?', choices: ['A league where the commissioner never changes', 'A league where teams keep some players year to year instead of a full re-draft', 'A league with no waivers', 'A league that only plays the playoffs'], correctIndex: 1 },
];

function publicQuestions() {
  return QUESTIONS.map((q) => ({ id: q.id, text: q.text, choices: q.choices }));
}

function initInstance() {
  return { config: {}, state: { submissions: {} }, status: 'ready' }; // submissions: memberId -> {score, elapsedMs, answers}
}

function scoreAnswers(answers) {
  let score = 0;
  QUESTIONS.forEach((q) => {
    if (answers[q.id] === q.correctIndex) score++;
  });
  return score;
}

function submit(state, memberId, answers, elapsedMs) {
  const score = scoreAnswers(answers);
  state.submissions[memberId] = { score, elapsedMs: Math.max(0, Number(elapsedMs) || 0), submittedAt: Date.now() };
  return { score, total: QUESTIONS.length };
}

function isComplete(state, memberIds) {
  return memberIds.every((mid) => state.submissions[mid] != null);
}

function computeResults(state) {
  const entries = Object.entries(state.submissions).map(([memberId, s]) => ({ memberId, ...s }));
  entries.sort((x, y) => (y.score - x.score) || (x.elapsedMs - y.elapsedMs));
  return entries.map((e, i) => ({ memberId: e.memberId, rank: i + 1 }));
}

module.exports = {
  id, name, description, category, supportedModes,
  QUESTIONS, publicQuestions, initInstance, submit, isComplete, computeResults,
};
