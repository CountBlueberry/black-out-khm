const { db } = require('./db');

const nowIso = () => new Date().toISOString();

const wasSent = (eventId) => {
    const row = db.prepare(`SELECT event_id FROM sent_events WHERE event_id = ?`).get(String(eventId));
    return !!row;
};

const markSent = ({ eventId, chatId, queue, type, scheduledAt }) => {
    db.prepare(`
        INSERT OR IGNORE INTO sent_events (event_id, chat_id, queue, type, scheduled_at, sent_at)
        VALUES (?, ?, ?, ?, ?, ?)
    `).run(String(eventId), String(chatId), String(queue), String(type), String(scheduledAt), nowIso());
};

const cleanupOld = (days = 7) => {
    db.prepare(`
        DELETE FROM sent_events
        WHERE sent_at < datetime('now', ?)
    `).run(`-${days} days`);
};

module.exports = { wasSent, markSent, cleanupOld };
