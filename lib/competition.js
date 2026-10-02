// Shared helpers used by both the HTTP routes and the live-room socket handlers,
// since a competition can finish because of an async submission (HTTP) or the
// last live match ending (socket) — both paths need to check for completion the
// same way.
const { getModule, aggregateFinalOrder, isKnownGameType } = require('./gameEngine');

function getLeagueMembers(db, leagueId) {
  const league = db.leagues[leagueId];
  return league ? league.members : [];
}

// Call this after a GameInstance's `status` is set to 'completed' — checks whether
// every game in its competition is now done, and if so computes the final order.
function checkAndFinalizeCompetition(db, competitionId) {
  const competition = db.competitions[competitionId];
  if (!competition || competition.status === 'completed') return competition;

  // A game type that's been removed from the app (the old 40 Yard Dash
  // lottery) can still be sitting in an older competition's saved data. Its
  // result still counts if it already finished, but an unfinished one can
  // never be played anymore, so it must not hold the competition open.
  const instances = competition.games
    .map((giId) => db.gameInstances[giId])
    .filter((gi) => gi && (isKnownGameType(gi.gameType) || gi.status === 'completed'));
  if (instances.length === 0) return competition;
  const allDone = instances.every((gi) => gi.status === 'completed');
  if (!allDone) return competition;

  const members = getLeagueMembers(db, competition.leagueId);
  const memberIds = members.map((m) => m.id);
  competition.finalOrder = aggregateFinalOrder(memberIds, instances);
  competition.status = 'completed';
  return competition;
}

module.exports = { getLeagueMembers, checkAndFinalizeCompetition, getModule };
