const path = require('path');
const Database = require('better-sqlite3');

const dbPath = process.env.DB_PATH || path.join(process.cwd(), 'data.sqlite');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');

const migrate = () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS subscriptions (
            chat_id TEXT NOT NULL,
            queue TEXT NOT NULL,
            created_at TEXT NOT NULL,
            PRIMARY KEY (chat_id, queue)
        );

        CREATE TABLE IF NOT EXISTS notification_prefs (
            chat_id TEXT PRIMARY KEY,
            lead_minutes INTEGER NOT NULL,
            notify_before INTEGER NOT NULL,
            notify_start INTEGER NOT NULL,
            notify_end INTEGER NOT NULL,
            quiet_enabled INTEGER NOT NULL,
            quiet_start TEXT NOT NULL,
            quiet_end TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS sent_events (
            event_id TEXT PRIMARY KEY,
            chat_id TEXT NOT NULL,
            queue TEXT NOT NULL,
            type TEXT NOT NULL,
            scheduled_at TEXT NOT NULL,
            sent_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_sent_events_sent_at ON sent_events(sent_at);
    `);
};

module.exports = { db, migrate };
