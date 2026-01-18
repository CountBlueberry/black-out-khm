const { db } = require('./db');

const ensureSnapshotTable = () => {
    db.exec(`
    CREATE TABLE IF NOT EXISTS outages_snapshot (
      date TEXT NOT NULL,
      queue TEXT NOT NULL,
      json TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (date, queue)
    );
  `);
};

const upsertQueueSnapshot = ({ date, queue, json }) => {
    ensureSnapshotTable();
    const now = new Date().toISOString();

    db.prepare(`
    INSERT INTO outages_snapshot (date, queue, json, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(date, queue) DO UPDATE SET
      json = excluded.json,
      updated_at = excluded.updated_at
  `).run(String(date), String(queue), String(json), now);
};

const getQueueSnapshot = ({ date, queue }) => {
    ensureSnapshotTable();

    const row = db.prepare(`
    SELECT json, updated_at
    FROM outages_snapshot
    WHERE date = ? AND queue = ?
  `).get(String(date), String(queue));

    if (!row) return null;

    return {
        json: row.json,
        updatedAt: row.updated_at,
    };
};

module.exports = { upsertQueueSnapshot, getQueueSnapshot };
