// Weighted Draft Lottery — the commissioner assigns each member an "odds weight"
// (default: equal), then a single weighted draw-without-replacement produces the
// full draft order at once. Supports both modes:
//   - async: the order is computed the moment the instance starts.
//   - live:  the order is computed up front, then revealed one pick at a time
//            (last pick to first, like a real draft lottery) via sockets/liveRooms.js.
const crypto = require('crypto');

const id = 'lottery';
const name = 'Weighted Draft Lottery';
const category = 'lottery';
const supportedModes = ['live', 'async'];

function defaultConfig(members) {
  const odds = {};
  members.forEach((m) => { odds[m.id] = 1; });
  return { odds };
}

// Weighted random pick without replacement -> full order of memberIds, index 0 = pick 1.
function runDraw(members, odds) {
  const pool = members.map((m) => ({ id: m.id, weight: Math.max(0.01, Number(odds[m.id]) || 1) }));
  const order = [];
  while (pool.length) {
    const total = pool.reduce((sum, p) => sum + p.weight, 0);
    let r = crypto.randomInt(1, Math.round(total * 1000) + 1) / 1000;
    let idx = 0;
    for (; idx < pool.length; idx++) {
      r -= pool[idx].weight;
      if (r <= 0) break;
    }
    idx = Math.min(idx, pool.length - 1);
    order.push(pool[idx].id);
    pool.splice(idx, 1);
  }
  return order;
}

function initInstance(config, members) {
  const cfg = { odds: { ...defaultConfig(members).odds, ...(config.odds || {}) } };
  return {
    config: cfg,
    // revealedPicks accumulates {pick, memberId} entries in the order they're
    // announced (last pick to first, for live suspense) — not sorted by pick
    // number, so clients place each entry at the right slot as it arrives.
    state: { order: null, revealedPicks: [] },
    status: 'ready', // ready -> (live: revealing) -> completed
  };
}

function toResults(order) {
  return order.map((memberId, i) => ({ memberId, rank: i + 1 }));
}

module.exports = { id, name, category, supportedModes, defaultConfig, runDraw, initInstance, toResults };
