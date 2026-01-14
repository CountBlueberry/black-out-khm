const { db } = require('./db');

const nowIso = () => new Date().toISOString();

const addQueue = (chatId, queue) => {
    const stmt = db.prepare(`
        INSERT OR IGNORE INTO subscriptions (chat_id, queue, created_at)
        VALUES (?, ?, ?)
    `);
    stmt.run(String(chatId), String(queue), nowIso());
};

const removeQueue = (chatId, queue) => {
    db.prepare(`DELETE FROM subscriptions WHERE chat_id = ? AND queue = ?`).run(String(chatId), String(queue));
};

const clearQueues = (chatId) => {
    db.prepare(`DELETE FROM subscriptions WHERE chat_id = ?`).run(String(chatId));
};

const listQueues = (chatId) => {
    const rows = db.prepare(`SELECT queue FROM subscriptions WHERE chat_id = ? ORDER BY queue`).all(String(chatId));
    return rows.map((r) => r.queue);
};

const listAllSubscriptions = () => {
    const rows = db.prepare(`SELECT chat_id, queue FROM subscriptions ORDER BY chat_id, queue`).all();
    const map = new Map();

    for (const r of rows) {
        if (!map.has(r.chat_id)) map.set(r.chat_id, []);
        map.get(r.chat_id).push(r.queue);
    }

    return Array.from(map.entries()).map(([chatId, queues]) => ({ chatId, queues }));
};

module.exports = { addQueue, removeQueue, clearQueues, listQueues, listAllSubscriptions };
