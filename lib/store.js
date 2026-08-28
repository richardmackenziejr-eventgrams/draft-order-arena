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

const EMPTY_DB = { leagues: {}, competitions: {}, gameInstances: {} };

async function initDb() {
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
