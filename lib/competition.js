// Shared helpers used by both the HTTP routes and the live-room socket handlers,
// since a competition can finish because of an async submission (HTTP) or the
// last live match ending (socket) — both paths need to check for completion the
// same way.
const { getModule, aggregateFinalOrder } = require('./gameEngine');

function getLeagueMembers(db, leagueId) {
  const league = db.leagues[leagueId];
  return league ? league.members : [];
}

// Call this after a GameInstance's `status` is set to 'completed' — checks whether
// every game in its competition is now done, and if so computes the final order.
function checkAndFinalizeCompetition(db, competitionId) {
  const competition = db.competitions[competitionId];
  if (!competition || competition.status === 'completed') return competition;

  const instances = competition.games.map((giId) => db.gameInstances[giId]);
  const allDone = instances.every((gi) => gi.status === 'completed');
  if (!allDone) return competition;

  const members = getLeagueMembers(db, competition.leagueId);
  const memberIds = members.map((m) => m.id);
  competition.finalOrder = aggregateFinalOrder(memberIds, instances);
  competition.status = 'completed';
  return competition;
}

module.exports = { getLeagueMembers, checkAndFinalizeCompetition, getModule };
