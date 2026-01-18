const { db } = require('./db');

const ensureCacheTable = () => {
    db.exec(`
    CREATE TABLE IF NOT EXISTS cache_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
};

const getCacheValue = (key) => {
    ensureCacheTable();
    const row = db.prepare(`SELECT value FROM cache_state WHERE key = ?`).get(key);
    return row ? row.value : null;
};

const setCacheValue = (key, value) => {
    ensureCacheTable();
    const now = new Date().toISOString();
    db.prepare(`
    INSERT INTO cache_state (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = excluded.updated_at
  `).run(key, String(value), now);
};

module.exports = { getCacheValue, setCacheValue };
