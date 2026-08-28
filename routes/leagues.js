const express = require('express');
const store = require('../lib/store');
const { listModules, getModule } = require('../lib/gameEngine');
const { checkAndFinalizeCompetition } = require('../lib/competition');

const router = express.Router();

router.get('/game-catalog', (req, res) => {
  res.json({ games: listModules() });
});

// --- Leagues ---------------------------------------------------------------

router.post('/leagues', async (req, res) => {
  const { name, commissionerName } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'League name is required.' });
  if (!commissionerName || !commissionerName.trim()) return res.status(400).json({ error: 'Commissioner name is required.' });

  const db = await store.load();
  const id = store.makeId('lg');
  const league = {
    id,
    name: name.trim(),
    commissionerName: commissionerName.trim(),
    joinCode: store.makeJoinCode(),
    members: [],
    competitions: [],
    createdAt: Date.now(),
  };
  db.leagues[id] = league;
  await store.save(db);
  res.status(201).json({ league });
});

router.get('/leagues/by-code/:code', async (req, res) => {
  const db = await store.load();
  const code = req.params.code.toUpperCase();
  const league = Object.values(db.leagues).find((l) => l.joinCode === code);
  if (!league) return res.status(404).json({ error: 'No league found with that code.' });
  res.json({ league });
});

router.get('/leagues/:id', async (req, res) => {
  const db = await store.load();
  const league = db.leagues[req.params.id];
  if (!league) return res.status(404).json({ error: 'League not found.' });
  const competitions = league.competitions.map((cid) => summarizeCompetition(db.competitions[cid]));
  res.json({ league, competitions });
});

router.post('/leagues/:id/members', async (req, res) => {
  const { name } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required.' });

  const db = await store.load();
  const league = db.leagues[req.params.id];
  if (!league) return res.status(404).json({ error: 'League not found.' });

  const existing = league.members.find((m) => m.name.toLowerCase() === name.trim().toLowerCase());
  if (existing) {
    return res.json({ member: existing, league }); // rejoin with same name = same member (prototype-simple)
  }
  const member = { id: store.makeId('mem'), name: name.trim() };
  league.members.push(member);
  await store.save(db);
  res.status(201).json({ member, league });
});

// --- Competitions ------------------------------------------------------------

router.post('/leagues/:id/competitions', async (req, res) => {
  const { name, games } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'Competition name is required.' });
  if (!Array.isArray(games) || games.length === 0) return res.status(400).json({ error: 'Pick at least one game.' });

  const db = await store.load();
  const league = db.leagues[req.params.id];
  if (!league) return res.status(404).json({ error: 'League not found.' });
  if (league.members.length < 2) return res.status(400).json({ error: 'At least 2 members need to join before creating a competition.' });

  const competitionId = store.makeId('comp');
  const gameInstanceIds = [];
  for (const g of games) {
    let mod;
    try { mod = getModule(g.gameType); } catch { return res.status(400).json({ error: `Unknown game type: ${g.gameType}` }); }
    if (!mod.supportedModes.includes(g.mode)) {
      return res.status(400).json({ error: `${mod.name} doesn't support "${g.mode}" mode.` });
    }
    const giId = store.makeId('gi');
    db.gameInstances[giId] = {
      id: giId,
      competitionId,
      gameType: g.gameType,
      mode: g.mode,
      config: g.config || {},
      status: 'draft',
      state: {},
      results: [],
    };
    gameInstanceIds.push(giId);
  }

  db.competitions[competitionId] = {
    id: competitionId,
    leagueId: league.id,
    name: name.trim(),
    status: 'draft', // draft -> active -> completed
    games: gameInstanceIds,
    finalOrder: null,
    createdAt: Date.now(),
  };
  league.competitions.push(competitionId);
  await store.save(db);
  res.status(201).json({ competition: db.competitions[competitionId] });
});

router.post('/competitions/:id/start', async (req, res) => {
  const db = await store.load();
  const competition = db.competitions[req.params.id];
  if (!competition) return res.status(404).json({ error: 'Competition not found.' });
  if (competition.status !== 'draft') return res.status(400).json({ error: 'Competition already started.' });

  const league = db.leagues[competition.leagueId];
  const members = league.members;

  competition.games.forEach((giId) => {
    const gi = db.gameInstances[giId];
    const mod = getModule(gi.gameType);
    const init = mod.initInstance(gi.config, members);
    gi.config = init.config;
    gi.state = init.state;
    gi.status = init.status;

    // Weighted lottery in async mode has no "play" step — resolve it immediately.
    if (gi.gameType === 'lottery' && gi.mode === 'async') {
      const order = mod.runDraw(members, gi.config.odds);
      gi.state.order = order;
      gi.results = mod.toResults(order);
      gi.status = 'completed';
    }

    // Tiny leagues can resolve a bracket entirely via byes right at init.
    if (gi.gameType === 'reactionBracket' && mod.isComplete(gi.state.bracket)) {
      gi.results = mod.computeResults(gi.state.bracket);
      gi.status = 'completed';
    }
  });

  competition.status = 'active';
  checkAndFinalizeCompetition(db, competition.id);
  await store.save(db);
  res.json({ competition });
});

router.get('/competitions/:id', async (req, res) => {
  const db = await store.load();
  const competition = db.competitions[req.params.id];
  if (!competition) return res.status(404).json({ error: 'Competition not found.' });
  const league = db.leagues[competition.leagueId];
  const games = competition.games.map((giId) => publicGameInstance(db.gameInstances[giId]));
  res.json({ competition, games, league: { id: league.id, name: league.name, members: league.members } });
});

function summarizeCompetition(c) {
  if (!c) return null;
  return { id: c.id, name: c.name, status: c.status, gameCount: c.games.length };
}

// Strip mode-specific spoilers (e.g. an un-revealed lottery order, trivia answer key).
function publicGameInstance(gi) {
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
    return { ...base, bracket: gi.state.bracket, results: gi.status === 'completed' ? gi.results : [] };
  }
  if (gi.gameType === 'trivia') {
    const submittedBy = Object.keys((gi.state && gi.state.submissions) || {});
    return { ...base, questionCount: mod.QUESTIONS.length, submittedBy, results: gi.status === 'completed' ? gi.results : [] };
  }
  return base;
}

module.exports = router;
