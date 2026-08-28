const express = require('express');
const store = require('../lib/store');
const { getModule } = require('../lib/gameEngine');
const { checkAndFinalizeCompetition } = require('../lib/competition');
const trivia = require('../lib/gameEngine/trivia');
const reactionBracket = require('../lib/gameEngine/reactionBracket');

// Routes need `io` to broadcast the live lottery reveal, so this module is a
// factory: server.js calls games(io) to get the mounted router.
module.exports = function gamesRouter(io) {
  const router = express.Router();

  router.get('/game-instances/:id', async (req, res) => {
    const db = await store.load();
    const gi = db.gameInstances[req.params.id];
    if (!gi) return res.status(404).json({ error: 'Game instance not found.' });
    const memberId = req.query.memberId;
    res.json({ gameInstance: viewForMember(gi, memberId) });
  });

  router.post('/game-instances/:id/trivia/submit', async (req, res) => {
    const { memberId, answers, elapsedMs } = req.body || {};
    if (!memberId) return res.status(400).json({ error: 'memberId is required.' });

    const db = await store.load();
    const gi = db.gameInstances[req.params.id];
    if (!gi || gi.gameType !== 'trivia') return res.status(404).json({ error: 'Trivia game not found.' });
    if (gi.status === 'completed') return res.status(400).json({ error: 'This trivia contest is already finished.' });
    const league = db.leagues[db.competitions[gi.competitionId].leagueId];
    if (!league.members.some((m) => m.id === memberId)) return res.status(403).json({ error: 'Not a member of this league.' });

    const outcome = trivia.submit(gi.state, memberId, answers || {}, elapsedMs);

    const memberIds = league.members.map((m) => m.id);
    if (trivia.isComplete(gi.state, memberIds)) {
      gi.results = trivia.computeResults(gi.state);
      gi.status = 'completed';
      checkAndFinalizeCompetition(db, gi.competitionId);
    }
    await store.save(db);
    res.json({ outcome, gameInstance: viewForMember(gi, memberId) });
  });

  router.post('/game-instances/:id/reaction/attempt', async (req, res) => {
    const { memberId, reactionTimeMs } = req.body || {};
    if (!memberId || typeof reactionTimeMs !== 'number') {
      return res.status(400).json({ error: 'memberId and reactionTimeMs are required.' });
    }

    const db = await store.load();
    const gi = db.gameInstances[req.params.id];
    if (!gi || gi.gameType !== 'reactionBracket') return res.status(404).json({ error: 'Bracket game not found.' });
    if (gi.mode !== 'async') return res.status(400).json({ error: 'This bracket is live-mode — play it in the live room instead.' });
    if (gi.status === 'completed') return res.status(400).json({ error: 'This bracket is already finished.' });

    const outcome = reactionBracket.recordAsyncAttempt(gi.state.bracket, memberId, reactionTimeMs);
    if (reactionBracket.isComplete(gi.state.bracket)) {
      gi.results = reactionBracket.computeResults(gi.state.bracket);
      gi.status = 'completed';
      checkAndFinalizeCompetition(db, gi.competitionId);
    }
    await store.save(db);
    res.json({ outcome, gameInstance: viewForMember(gi, memberId) });
  });

  // Commissioner triggers the live, animated lottery reveal — picks are announced
  // one at a time (last pick to first) with a short delay between each, broadcast
  // over the game's Socket.IO room so every spectator sees the same sequence.
  router.post('/game-instances/:id/lottery/run', async (req, res) => {
    const db = await store.load();
    const gi = db.gameInstances[req.params.id];
    if (!gi || gi.gameType !== 'lottery') return res.status(404).json({ error: 'Lottery game not found.' });
    if (gi.mode !== 'live') return res.status(400).json({ error: 'Only live-mode lotteries need to be triggered — async ones resolve automatically.' });
    if (gi.status === 'completed') return res.status(400).json({ error: 'This draw has already happened.' });
    if (gi.status === 'revealing') return res.status(400).json({ error: 'This draw is already running.' });

    const mod = getModule('lottery');
    const league = db.leagues[db.competitions[gi.competitionId].leagueId];
    const order = gi.state.order || mod.runDraw(league.members, gi.config.odds);
    gi.state.order = order;
    gi.state.revealedPicks = [];
    gi.status = 'revealing';
    await store.save(db);

    const room = `game:${gi.id}`;
    io.to(room).emit('lottery:started', { totalPicks: order.length });
    revealNextPick(gi.id, order, order.length - 1, room);

    res.status(202).json({ status: 'revealing' });
  });

  // Runs outside any request's lifecycle (a chain of setTimeouts), so a transient
  // DB hiccup here is wrapped rather than left to crash the whole process as an
  // uncaught exception — it just stops that one draw's reveal.
  function revealNextPick(giId, order, positionIndex, room) {
    if (positionIndex < 0) {
      finishReveal(giId, order, room).catch((err) => console.error('Lottery reveal finish failed:', err));
      return;
    }
    setTimeout(() => {
      revealOnePick(giId, order, positionIndex, room).catch((err) => console.error('Lottery reveal step failed:', err));
    }, 1800);
  }

  async function revealOnePick(giId, order, positionIndex, room) {
    const db = await store.load();
    const gi = db.gameInstances[giId];
    if (!gi || gi.status !== 'revealing') return; // safety: instance vanished/changed
    gi.state.revealedPicks.push({ pick: positionIndex + 1, memberId: order[positionIndex] });
    await store.save(db);
    io.to(room).emit('lottery:reveal', { pick: positionIndex + 1, memberId: order[positionIndex] });
    revealNextPick(giId, order, positionIndex - 1, room);
  }

  async function finishReveal(giId, order, room) {
    const db = await store.load();
    const gi = db.gameInstances[giId];
    const mod = getModule('lottery');
    gi.results = mod.toResults(order);
    gi.status = 'completed';
    checkAndFinalizeCompetition(db, gi.competitionId);
    await store.save(db);
    io.to(room).emit('lottery:complete', { results: gi.results });
  }

  return router;
};

// Strip spoilers based on who's asking (an un-submitted member shouldn't see the
// trivia answer key; a live reveal in progress shouldn't leak un-revealed picks).
function viewForMember(gi, memberId) {
  const mod = getModule(gi.gameType);
  const base = { id: gi.id, gameType: gi.gameType, gameName: mod.name, mode: gi.mode, status: gi.status, config: gi.config };

  if (gi.gameType === 'lottery') {
    return {
      ...base,
      revealedPicks: gi.state.revealedPicks || [],
      totalPicks: (gi.state.order || []).length,
      results: gi.status === 'completed' ? gi.results : [],
    };
  }

  if (gi.gameType === 'reactionBracket') {
    const yourMatch = memberId ? reactionBracket.getMatchForMember(gi.state.bracket, memberId) : null;
    return { ...base, bracket: gi.state.bracket, yourMatch: yourMatch ? yourMatch.match : null, results: gi.status === 'completed' ? gi.results : [] };
  }

  if (gi.gameType === 'trivia') {
    const submission = memberId ? gi.state.submissions[memberId] : null;
    return {
      ...base,
      questions: mod.publicQuestions(),
      questionCount: mod.QUESTIONS.length,
      hasSubmitted: !!submission,
      yourScore: submission ? submission.score : null,
      submittedBy: Object.keys(gi.state.submissions || {}),
      results: gi.status === 'completed' ? gi.results : [],
    };
  }

  return base;
}
