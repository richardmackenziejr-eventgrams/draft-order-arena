const express = require('express');
const store = require('../lib/store');
const { getModule } = require('../lib/gameEngine');
const { checkAndFinalizeCompetition } = require('../lib/competition');
const trivia = require('../lib/gameEngine/trivia');

// Routes need `io` to broadcast the live lottery reveal, so this module is a
// factory: server.js calls games(io) to get the mounted router.
module.exports = function gamesRouter(io) {
  const router = express.Router();

  router.get('/game-instances/:id', async (req, res) => {
    const db = await store.load();
    const gi = db.gameInstances[req.params.id];
    if (!gi) return res.status(404).json({ error: 'Game instance not found.' });
    const memberId = req.query.memberId;

    // Viewing a trivia question is what starts its 10-second clock — record
    // that here (server-authoritative, not trusted from the client) before
    // building the response, and persist it since it's real game state.
    if (gi.gameType === 'trivia' && memberId && gi.status !== 'completed') {
      trivia.presentCurrentQuestion(gi.state, memberId);
      await store.save(db);
    }

    res.json({ gameInstance: viewForMember(gi, memberId) });
  });

  // Scores the player's current question (idempotent — a retried request
  // won't double-score) but does NOT advance them; /trivia/next does that.
  // Keeping "answer" and "advance" separate lets the client show the
  // right/wrong outcome and a Next button before moving on.
  router.post('/game-instances/:id/trivia/answer', async (req, res) => {
    const { memberId, choiceIndex } = req.body || {};
    if (!memberId) return res.status(400).json({ error: 'memberId is required.' });

    const db = await store.load();
    const gi = db.gameInstances[req.params.id];
    if (!gi || gi.gameType !== 'trivia') return res.status(404).json({ error: 'Trivia game not found.' });
    if (gi.status === 'completed') return res.status(400).json({ error: 'This trivia contest is already finished.' });
    // Solo test instances (see /leagues/:id/test-trivia) have no real
    // competition/league behind them — nothing to check membership against.
    if (!gi.isTest) {
      const league = db.leagues[db.competitions[gi.competitionId].leagueId];
      if (!league.members.some((m) => m.id === memberId)) return res.status(403).json({ error: 'Not a member of this league.' });
    }

    const outcome = trivia.submitAnswer(gi.state, memberId, choiceIndex == null ? null : Number(choiceIndex));
    if (outcome && outcome.error) return res.status(400).json({ error: outcome.error });

    await store.save(db);
    res.json({ outcome, gameInstance: viewForMember(gi, memberId) });
  });

  router.post('/game-instances/:id/trivia/next', async (req, res) => {
    const { memberId } = req.body || {};
    if (!memberId) return res.status(400).json({ error: 'memberId is required.' });

    const db = await store.load();
    const gi = db.gameInstances[req.params.id];
    if (!gi || gi.gameType !== 'trivia') return res.status(404).json({ error: 'Trivia game not found.' });
    if (gi.status === 'completed') return res.status(400).json({ error: 'This trivia contest is already finished.' });

    let league = null;
    if (!gi.isTest) {
      league = db.leagues[db.competitions[gi.competitionId].leagueId];
      if (!league.members.some((m) => m.id === memberId)) return res.status(403).json({ error: 'Not a member of this league.' });
    }

    const player = trivia.advanceToNext(gi.state, memberId);
    if (player && player.error) return res.status(400).json({ error: player.error });
    // Start the new current question's clock now — the client renders it
    // immediately from this response without a follow-up GET, so nothing
    // else would ever set presentedAt for it.
    trivia.presentCurrentQuestion(gi.state, memberId);

    // A solo test instance completes as soon as its one "player" finishes —
    // there's no real league to wait on, and nothing to finalize.
    if (gi.isTest) {
      if (player.completed) {
        gi.results = trivia.computeResults(gi.state);
        gi.status = 'completed';
      }
    } else {
      const memberIds = league.members.map((m) => m.id);
      if (trivia.isComplete(gi.state, memberIds)) {
        gi.results = trivia.computeResults(gi.state);
        gi.status = 'completed';
        checkAndFinalizeCompetition(db, gi.competitionId);
      }
    }
    await store.save(db);
    res.json({ gameInstance: viewForMember(gi, memberId) });
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
    revealNextPick(gi.id, order, 0, room);

    res.status(202).json({ status: 'revealing' });
  });

  // Runs outside any request's lifecycle (a chain of setTimeouts), so a transient
  // DB hiccup here is wrapped rather than left to crash the whole process as an
  // uncaught exception — it just stops that one draw's reveal.
  // Picks are revealed best to worst (pick #1 first) — first to finish the
  // race wins the top pick, matching how the race actually reads.
  function revealNextPick(giId, order, positionIndex, room) {
    if (positionIndex >= order.length) {
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
    revealNextPick(giId, order, positionIndex + 1, room);
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

  if (gi.gameType === 'trivia') {
    const players = gi.state.players || {};
    const player = memberId ? players[memberId] : null;
    const completedBy = Object.entries(players).filter(([, p]) => p.completed).map(([mid]) => mid);
    return {
      ...base,
      questionsPerPlayer: mod.QUESTIONS_PER_PLAYER,
      countdownSeconds: mod.COUNTDOWN_SECONDS,
      hasCompleted: player ? player.completed : false,
      yourScore: player ? player.totalPoints : null,
      // The question the player should see right now (with the answer key
      // stripped, unless they've already answered it), or null once done.
      currentQuestion: player ? mod.currentQuestionView(player) : null,
      completedBy,
      results: gi.status === 'completed' ? gi.results : [],
    };
  }

  return base;
}
