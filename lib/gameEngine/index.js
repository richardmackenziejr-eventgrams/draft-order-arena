// Registry of GameModules + the logic that combines one-or-more finished
// GameInstances into a single competition draft order.
const crypto = require('crypto');
const lottery = require('./lottery');
const trivia = require('./trivia');
const fieldGoal = require('./fieldGoal');
const kickoffReturn = require('./kickoffReturn');

const MODULES = {
  [lottery.id]: lottery,
  [trivia.id]: trivia,
  [fieldGoal.id]: fieldGoal,
  [kickoffReturn.id]: kickoffReturn,
};

function listModules() {
  return Object.values(MODULES).map((m) => ({
    id: m.id, name: m.name, description: m.description, category: m.category, supportedModes: m.supportedModes,
  }));
}

function getModule(gameType) {
  const mod = MODULES[gameType];
  if (!mod) throw new Error(`Unknown game type: ${gameType}`);
  return mod;
}

// Combine each completed GameInstance's rank list into one final order via a
// Borda count: sum each member's rank across every game (lowest total = pick 1).
// Ties are broken with a random draw, recorded so the reveal page can show it.
function aggregateFinalOrder(memberIds, gameInstances) {
  const totals = {};
  memberIds.forEach((id) => { totals[id] = 0; });
  gameInstances.forEach((gi) => {
    (gi.results || []).forEach((r) => {
      if (totals[r.memberId] == null) totals[r.memberId] = 0;
      totals[r.memberId] += r.rank;
    });
  });

  // Random, recorded tiebreak value per member — stable once computed since callers
  // persist the result rather than recomputing.
  const tiebreak = {};
  memberIds.forEach((id) => { tiebreak[id] = crypto.randomInt(1_000_000); });

  const order = memberIds.slice().sort((a, b) => (totals[a] - totals[b]) || (tiebreak[a] - tiebreak[b]));
  return order.map((memberId, i) => ({ memberId, rank: i + 1, totalPoints: totals[memberId] }));
}

module.exports = { MODULES, listModules, getModule, aggregateFinalOrder };
