const { db } = require('./db');

const nowIso = () => new Date().toISOString();

const defaultPrefs = () => ({
    leadMinutes: 30,
    notifyBefore: true,
    notifyStart: true,
    notifyEnd: true,
    quiet: { enabled: true, start: '22:00', end: '08:00' },
});

const getPrefs = (chatId) => {
    const row = db.prepare(`SELECT * FROM notification_prefs WHERE chat_id = ?`).get(String(chatId));

    if (!row) {
        const d = defaultPrefs();
        db.prepare(`
            INSERT INTO notification_prefs (
                chat_id, lead_minutes, notify_before, notify_start, notify_end,
                quiet_enabled, quiet_start, quiet_end, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            String(chatId),
            d.leadMinutes,
            d.notifyBefore ? 1 : 0,
            d.notifyStart ? 1 : 0,
            d.notifyEnd ? 1 : 0,
            d.quiet.enabled ? 1 : 0,
            d.quiet.start,
            d.quiet.end,
            nowIso()
        );
        return d;
    }

    return {
        leadMinutes: row.lead_minutes,
        notifyBefore: !!row.notify_before,
        notifyStart: !!row.notify_start,
        notifyEnd: !!row.notify_end,
        quiet: { enabled: !!row.quiet_enabled, start: row.quiet_start, end: row.quiet_end },
    };
};

const updatePrefs = (chatId, patch) => {
    const current = getPrefs(chatId);

    const next = {
        ...current,
        ...patch,
        quiet: { ...current.quiet, ...(patch.quiet ?? {}) },
    };

    db.prepare(`
        UPDATE notification_prefs SET
            lead_minutes = ?,
            notify_before = ?,
            notify_start = ?,
            notify_end = ?,
            quiet_enabled = ?,
            quiet_start = ?,
            quiet_end = ?,
            updated_at = ?
        WHERE chat_id = ?
    `).run(
        next.leadMinutes,
        next.notifyBefore ? 1 : 0,
        next.notifyStart ? 1 : 0,
        next.notifyEnd ? 1 : 0,
        next.quiet.enabled ? 1 : 0,
        next.quiet.start,
        next.quiet.end,
        nowIso(),
        String(chatId)
    );

    return next;
};

module.exports = { getPrefs, updatePrefs };
