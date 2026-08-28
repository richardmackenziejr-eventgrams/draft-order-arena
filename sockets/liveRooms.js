// Live-mode gameplay over Socket.IO. Two things happen here:
//   1. Spectators/players join a room per game instance (`game:<id>`) so the
//      HTTP-triggered live lottery reveal (routes/games.js) has somewhere to
//      broadcast to.
//   2. The Reaction Duel Bracket's live races are run end-to-end here: both
//      players signal ready, the server sends a "go" after a random delay, and
//      whoever clicks first (without a false start) wins the match.
const store = require('../lib/store');
const reactionBracket = require('../lib/gameEngine/reactionBracket');
const { checkAndFinalizeCompetition } = require('../lib/competition');

// In-memory only — race timing doesn't need to survive a server restart.
// matchId -> { readySides: Set<memberId>, goAt: number|null, resolved: boolean, timer }
const races = new Map();

function getRace(matchId) {
  if (!races.has(matchId)) races.set(matchId, { readySides: new Set(), goAt: null, resolved: false, timer: null });
  return races.get(matchId);
}

function setup(io) {
  io.on('connection', (socket) => {
    socket.on('join-room', ({ gameInstanceId }) => {
      if (gameInstanceId) socket.join(`game:${gameInstanceId}`);
    });

    socket.on('reaction:ready', async ({ gameInstanceId, memberId, matchId }) => {
      const db = await store.load();
      const gi = db.gameInstances[gameInstanceId];
      if (!gi || gi.gameType !== 'reactionBracket') return;
      const found = reactionBracket.findMatch(gi.state.bracket, matchId);
      if (!found || found.match.status === 'complete') return;
      if (found.match.a !== memberId && found.match.b !== memberId) return;

      const room = `game:${gameInstanceId}`;
      const race = getRace(matchId);
      race.readySides.add(memberId);
      io.to(room).emit('reaction:opponent-ready', { matchId, memberId });

      const bothReady = found.match.b == null || (race.readySides.has(found.match.a) && race.readySides.has(found.match.b));
      if (bothReady && race.goAt == null) {
        const delay = 1500 + Math.floor(Math.random() * 3000); // 1.5s-4.5s, unpredictable on purpose
        race.timer = setTimeout(() => {
          race.goAt = Date.now();
          io.to(room).emit('reaction:go', { matchId, goAt: race.goAt });
        }, delay);
      }
    });

    socket.on('reaction:click', async ({ gameInstanceId, memberId, matchId }) => {
      const db = await store.load();
      const gi = db.gameInstances[gameInstanceId];
      if (!gi || gi.gameType !== 'reactionBracket') return;
      const found = reactionBracket.findMatch(gi.state.bracket, matchId);
      if (!found || found.match.status === 'complete') return;
      const { match } = found;
      if (match.a !== memberId && match.b !== memberId) return;

      const race = getRace(matchId);
      if (race.resolved) return;

      const now = Date.now();
      const foul = race.goAt == null || now < race.goAt;
      const opponentId = match.a === memberId ? match.b : match.a;

      race.resolved = true;
      const room = `game:${gameInstanceId}`;
      let winnerId;
      if (foul) {
        // False start — opponent wins outright (unless there's no opponent, e.g. a bye).
        winnerId = opponentId || memberId;
        io.to(room).emit('reaction:foul', { matchId, memberId });
      } else {
        winnerId = memberId;
      }

      const reactionMs = race.goAt != null ? now - race.goAt : null;
      match.times[match.a === memberId ? 'a' : 'b'] = reactionMs;
      reactionBracket.recordResult(gi.state.bracket, matchId, winnerId);

      let payload = { matchId, winnerId, reactionMs };
      if (reactionBracket.isComplete(gi.state.bracket)) {
        gi.results = reactionBracket.computeResults(gi.state.bracket);
        gi.status = 'completed';
        checkAndFinalizeCompetition(db, gi.competitionId);
      }
      await store.save(db);

      io.to(room).emit('reaction:match-result', payload);
      if (gi.status === 'completed') {
        io.to(room).emit('bracket:complete', { results: gi.results });
      } else {
        io.to(room).emit('bracket:update', { bracket: gi.state.bracket });
      }
      races.delete(matchId);
    });
  });
}

module.exports = { setup };
