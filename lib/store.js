// Postgres-backed data store — same pattern as the `eventgrams` project: one
// table holding the whole app state as a single JSONB blob, keyed by id=1.
// That keeps every call site elsewhere in the app unchanged (they just get/set
// a plain JS object), while giving us real persistence across redeploys.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
});
// pg.Pool is an EventEmitter -- an error on an already-connected IDLE client
// (e.g. the DB dropping a connection) fires 'error' on the pool itself, not
// on any in-flight query's promise, and Node kills the whole process on an
// EventEmitter 'error' with no listener. Without this, a single dropped
// connection takes the entire server down, not just that one query.
pool.on('error', (err) => {
  console.error('Postgres pool idle client error (non-fatal, connection will be replaced):', err);
});

const EMPTY_DB = { leagues: {}, competitions: {}, gameInstances: {} };

// Retries with backoff rather than failing on the first attempt -- seen in
// production as `EAI_AGAIN` resolving Railway's internal Postgres hostname
// (postgres.railway.internal) for a few seconds right after a deploy/restart,
// which used to take the whole app down permanently (server.js's own catch
// calls process.exit(1), and Railway doesn't auto-restart a crashed deploy),
// requiring a manual restart click even once the DB was reachable again.
async function initDb(retries = 8, delayMs = 1500) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS appdb (
          id INTEGER PRIMARY KEY,
          data JSONB NOT NULL
        )
      `);
      const result = await pool.query('SELECT id FROM appdb WHERE id = 1');
      if (result.rows.length === 0) {
        // First boot against a fresh database — seed from the old local
        // data/db.json if one happens to be sitting next to the code (carries
        // over prototype data from before the Postgres migration), else start empty.
        const legacyPath = path.join(__dirname, '..', 'data', 'db.json');
        let seed = EMPTY_DB;
        if (fs.existsSync(legacyPath)) {
          try {
            seed = JSON.parse(fs.readFileSync(legacyPath, 'utf8'));
            console.log('Migrated existing data/db.json into Postgres.');
          } catch { /* ignore malformed legacy file, start empty */ }
        }
        await pool.query('INSERT INTO appdb (id, data) VALUES (1, $1)', [JSON.stringify(seed)]);
      }
      return;
    } catch (err) {
      if (attempt === retries) throw err;
      console.error(`initDb attempt ${attempt}/${retries} failed (${err.code || err.message}), retrying in ${delayMs}ms...`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      delayMs = Math.min(delayMs * 1.5, 10000);
    }
  }
}

async function load() {
  const result = await pool.query('SELECT data FROM appdb WHERE id = 1');
  return result.rows[0] ? result.rows[0].data : EMPTY_DB;
}

async function save(db) {
  await pool.query('UPDATE appdb SET data = $1 WHERE id = 1', [JSON.stringify(db)]);
}

// Short, URL/typeable id (used for record ids).
function makeId(prefix) {
  const rand = crypto.randomBytes(4).toString('hex');
  return prefix ? `${prefix}_${rand}` : rand;
}

// Human-friendly join code, e.g. "PLKQ7X" — the thing members type in to join a league.
function makeJoinCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I ambiguity
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += alphabet[crypto.randomInt(alphabet.length)];
  }
  return code;
}

module.exports = { initDb, load, save, makeId, makeJoinCode };
