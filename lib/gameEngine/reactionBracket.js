// Reaction Duel Bracket — single-elimination bracket where each match is a
// reaction-time race. Covers both the "bracket tournament" and "skill/luck
// mini-game" categories at once, and supports both modes:
//   - live:  two members race in real time in a Socket.IO room
//            (sockets/liveRooms.js sends the "go" signal and records clicks).
//   - async: each member clicks "test my reaction time" on their own schedule;
//            once both sides of a match have a time, the faster one advances.
const crypto = require('crypto');

const id = 'reactionBracket';
const name = 'Reaction Duel Bracket';
const category = 'bracket';
const supportedModes = ['live', 'async'];

function nextPow2(n) {
  let p = 1;
  while (p < n) p *= 2;
  return Math.max(p, 2);
}

function shuffle(arr) {
  const copy = arr.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function makeMatchId() {
  return `m_${crypto.randomBytes(3).toString('hex')}`;
}

function initInstance(config, members) {
  const seeds = shuffle(members.map((m) => m.id));
  const size = nextPow2(seeds.length);
  const totalMatches = size / 2;
  const byes = size - seeds.length;

  const round0 = [];
  let idx = 0;
  for (let i = 0; i < totalMatches; i++) {
    if (i < byes) {
      const a = seeds[idx++];
      round0.push({ id: makeMatchId(), a, b: null, winner: a, times: {}, status: 'complete' });
    } else {
      const a = seeds[idx++];
      const b = seeds[idx++];
      round0.push({ id: makeMatchId(), a, b, winner: null, times: {}, status: 'pending' });
    }
  }

  const bracket = { seeds, rounds: [round0], status: 'in-progress' };
  advanceIfRoundComplete(bracket, 0);
  return { config: {}, state: { bracket }, status: 'ready' };
}

function advanceIfRoundComplete(bracket, roundIndex) {
  const round = bracket.rounds[roundIndex];
  if (!round.every((m) => m.status === 'complete')) return;
  if (round.length === 1) {
    bracket.status = 'complete';
    return;
  }
  if (bracket.rounds.length === roundIndex + 1) {
    const winners = round.map((m) => m.winner);
    const nextRound = [];
    for (let i = 0; i < winners.length; i += 2) {
      nextRound.push({ id: makeMatchId(), a: winners[i], b: winners[i + 1], winner: null, times: {}, status: 'pending' });
    }
    bracket.rounds.push(nextRound);
    advanceIfRoundComplete(bracket, roundIndex + 1); // in case that round is somehow already resolvable
  }
}

function findMatch(bracket, matchId) {
  for (let ri = 0; ri < bracket.rounds.length; ri++) {
    const m = bracket.rounds[ri].find((x) => x.id === matchId);
    if (m) return { match: m, roundIndex: ri };
  }
  return null;
}

// The one currently-pending match a member is part of, if any (a member appears
// in exactly one live match at a time — once eliminated they appear in no more).
function getMatchForMember(bracket, memberId) {
  for (let ri = bracket.rounds.length - 1; ri >= 0; ri--) {
    const m = bracket.rounds[ri].find((x) => (x.a === memberId || x.b === memberId) && x.status !== 'complete');
    if (m) return { match: m, roundIndex: ri };
  }
  return null;
}

function recordResult(bracket, matchId, winnerId) {
  const found = findMatch(bracket, matchId);
  if (!found) throw new Error('Match not found');
  const { match, roundIndex } = found;
  if (match.status === 'complete') return; // already resolved
  if (winnerId !== match.a && winnerId !== match.b) throw new Error('Winner must be a match participant');
  match.winner = winnerId;
  match.status = 'complete';
  advanceIfRoundComplete(bracket, roundIndex);
}

// Async: a member submits their own reaction time whenever. Match resolves once
// both sides have one (lower time wins).
function recordAsyncAttempt(bracket, memberId, reactionTimeMs) {
  const found = getMatchForMember(bracket, memberId);
  if (!found) return { accepted: false, reason: 'No pending match for this member.' };
  const { match } = found;
  const side = match.a === memberId ? 'a' : 'b';
  match.times[side] = reactionTimeMs;
  if (match.times.a != null && match.times.b != null) {
    const winnerId = match.times.a <= match.times.b ? match.a : match.b;
    recordResult(bracket, match.id, winnerId);
  }
  return { accepted: true };
}

function isComplete(bracket) {
  return bracket.status === 'complete';
}

// Champion = rank 1; everyone else ranked by how late they were eliminated,
// ties within the same round broken by original seed order (deterministic).
function computeResults(bracket) {
  const eliminatedAt = {};
  let championId = null;
  bracket.rounds.forEach((round, ri) => {
    round.forEach((m) => {
      if (m.status !== 'complete' || !m.winner) return;
      const loser = m.a === m.winner ? m.b : m.a;
      if (loser) eliminatedAt[loser] = ri;
      if (ri === bracket.rounds.length - 1) championId = m.winner;
    });
  });

  const groups = {};
  bracket.seeds.forEach((mid) => {
    if (mid === championId) return;
    const r = eliminatedAt[mid];
    if (r === undefined) return;
    (groups[r] = groups[r] || []).push(mid);
  });

  const results = [];
  if (championId) results.push({ memberId: championId, rank: 1 });
  let rank = 2;
  for (let r = bracket.rounds.length - 1; r >= 0; r--) {
    (groups[r] || []).forEach((mid) => {
      results.push({ memberId: mid, rank });
      rank++;
    });
  }
  return results;
}

module.exports = {
  id, name, category, supportedModes,
  initInstance, recordResult, recordAsyncAttempt,
  getMatchForMember, findMatch, isComplete, computeResults,
};
