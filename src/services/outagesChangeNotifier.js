const { DateTime } = require('luxon');

const { getPrefs } = require('../db/prefsRepo');
const { getCacheValue, setCacheValue } = require('../db/cacheRepo');
const { wasSent, markSent } = require('../db/sentEventsRepo');

const { sha256 } = require('../utils/hash');
const { isWithinQuietHours, KYIV_TZ } = require('../utils/quietHours');
const { formatIntervalsShort, formatAdjustmentsShort } = require('../utils/outagesFormat');

const buildTodayTomorrowKeyboard = () => ({
    reply_markup: {
        inline_keyboard: [
            [
                { text: 'Сьогодні', callback_data: 'SHOW:today' },
                { text: 'Завтра', callback_data: 'SHOW:tomorrow' },
            ],
            [{ text: 'Меню', callback_data: 'BACK_MAIN' }],
        ],
    },
});

const buildCheckScheduleKeyboard = (day) => {
    const dayLabel = day === 'tomorrow' ? 'Перевірити графік на завтра' : 'Перевірити графік на сьогодні';

    return {
        reply_markup: {
            inline_keyboard: [
                [{ text: dayLabel, callback_data: `SHOW:${day}` }],
                [{ text: 'Меню', callback_data: 'BACK_MAIN' }],
            ],
        },
    };
};

/**
 * Factory
 */
const createOutagesChangeNotifier = ({ bot, listAllSubscriptions }) => {
    /**
     * Main entrypoint called from outages refresher job
     */
    const handleJobResult = async (res) => {
        const now = DateTime.now().setZone(KYIV_TZ);
        const today = now.toFormat('yyyy-LL-dd');
        const tomorrow = now.plus({ days: 1 }).toFormat('yyyy-LL-dd');

        const relevantDates = new Set([today, tomorrow]);

        const changes = Array.isArray(res?.changes) ? res.changes : [];
        const dayStatus = Array.isArray(res?.dayStatus) ? res.dayStatus : [];

        // ============================
        // 1) Broadcast: day flip 0 -> 1 (no outages -> outages exist)
        // ============================
        for (const d of dayStatus) {
            const date = String(d?.date || '');
            if (!relevantDates.has(date)) continue;

            const hasAnyOutages = !!d?.hasAnyOutages;
            const key = `day_has_outages:${date}`;
            const prev = getCacheValue(key);
            const prevBool = prev === '1';

            if (!prevBool && hasAnyOutages) {
                const subs = listAllSubscriptions();
                const uniqueChats = Array.from(new Set(subs.map((x) => String(x.chatId))));

                const dayVersionSeed = (() => {
                    const byDay = changes
                        .filter((c) => String(c?.date) === date)
                        .map((c) => String(c?.nextHash || ''))
                        .join('|');

                    return byDay || String(res?.fingerprint || res?.pageFingerprint || now.toISO());
                })();

                const dayVersion = sha256(dayVersionSeed);

                for (const chatId of uniqueChats) {
                    const prefs = getPrefs(chatId);
                    if (isWithinQuietHours(now, prefs.quiet)) continue;

                    const eventId = `${chatId}|ALL|${date}|DAY_ON|${dayVersion}`;
                    if (wasSent(eventId)) continue;

                    const label = date === today ? 'сьогодні' : 'завтра';
                    const msg =
                        `⚠️ Увага! На ${label} з’явились погодинні відключення.\n` +
                        `Натисни кнопку нижче, щоб побачити свій графік.`;

                    await bot.telegram.sendMessage(chatId, msg, buildTodayTomorrowKeyboard());

                    markSent({
                        eventId,
                        chatId,
                        queue: 'ALL',
                        type: 'DAY_ON',
                        scheduledAt: now.toISO(),
                    });
                }
            }

            // Persist current state
            setCacheValue(key, hasAnyOutages ? '1' : '0');
        }

        if (changes.length === 0) return;

        // ============================
        // 2) Targeted: queue-specific changes
        // ============================
        const changesByQueue = new Map();

        for (const c of changes) {
            const date = String(c?.date || '');
            if (!relevantDates.has(date)) continue;

            const queue = String(c?.queue || '');
            if (!queue) continue;

            if (!changesByQueue.has(queue)) changesByQueue.set(queue, []);
            changesByQueue.get(queue).push(c);
        }

        if (changesByQueue.size === 0) return;

        const subs = listAllSubscriptions();

        for (const { chatId, queues } of subs) {
            const prefs = getPrefs(chatId);
            if (isWithinQuietHours(now, prefs.quiet)) continue;

            for (const queue of queues) {
                const list = changesByQueue.get(String(queue));
                if (!list || list.length === 0) continue;

                for (const c of list) {
                    const date = String(c?.date);
                    const nextHash = String(c?.nextHash || sha256(JSON.stringify(c?.payload || {})));

                    const eventId = `${chatId}|${queue}|${date}|QUEUE_CHANGE|${nextHash}`;
                    if (wasSent(eventId)) continue;

                    const payload = c?.payload || {};
                    const outagesText = formatIntervalsShort(payload.outages);
                    const adjText = formatAdjustmentsShort(payload.adjustments, queue);

                    const appeared = !c?.prevHash;

                    let header = appeared ? '✅ З’явились відключення' : '🔄 Графік оновлено';
                    if (adjText && !appeared) header = '⚠️ Оперативні зміни';

                    const lines = [];
                    lines.push(header);
                    lines.push(`Підчерга ${queue} (${date}): ${outagesText}`);

                    if (adjText) {
                        lines.push('');
                        lines.push(adjText);
                    }

                    lines.push('');
                    lines.push('Натисни кнопку нижче, щоб швидко перевірити графік.');

                    const day = date === tomorrow ? 'tomorrow' : 'today';
                    await bot.telegram.sendMessage(chatId, lines.join('\n'), buildCheckScheduleKeyboard(day));

                    markSent({
                        eventId,
                        chatId,
                        queue: String(queue),
                        type: 'QUEUE_CHANGE',
                        scheduledAt: now.toISO(),
                    });
                }
            }
        }
    };

    return { handleJobResult };
};

module.exports = { createOutagesChangeNotifier };
