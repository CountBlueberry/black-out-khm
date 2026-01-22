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

const normalizeIntervals = (payload) => {
    const outages = payload?.outages ?? [];
    return Array.isArray(outages) ? outages.filter((x) => !x?.shadow) : [];
};

const parseToDateTime = (dateIso, timeStr) => {
    const t = String(timeStr || '').trim();
    const m = t.match(/^(\d{2}):(\d{2})$/);
    if (!m) return null;

    const hh = Number(m[1]);
    const mm = Number(m[2]);
    if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;

    return DateTime.fromISO(dateIso, { zone: KYIV_TZ }).set({
        hour: hh,
        minute: mm,
        second: 0,
        millisecond: 0,
    });
};

const hasAnyUpcomingOrOngoingOutage = (now, dateIso, payload) => {
    const outages = normalizeIntervals(payload);
    for (const interval of outages) {
        const start = parseToDateTime(dateIso, interval.from);
        if (!start) continue;

        let end = parseToDateTime(dateIso, interval.to);
        if (!end) continue;

        if (interval.toNextDay) end = end.plus({ days: 1 });

        if (end.toMillis() > now.toMillis()) return true;
    }
    return false;
};

const isLikelyMidnightMergeOnly = ({ dateIso, payload, hasAdjustments }) => {
    if (hasAdjustments) return false;

    const outages = normalizeIntervals(payload);
    if (outages.length !== 1) return false;

    const o = outages[0];

    if (!o?.toNextDay) return false;
    if (!String(o?.raw || '').includes('|')) return false;

    const from = String(o?.from || '');
    const to = String(o?.to || '');

    if (!/^\d{2}:\d{2}$/.test(from) || !/^\d{2}:\d{2}$/.test(to)) return false;

    if (from === '00:00') return false;
    if (to === '00:00') return false;

    const start = parseToDateTime(dateIso, from);
    if (!start) return false;

    return start.hour >= 20;
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

        const payloadByDateQueue = new Map();
        for (const c of changes) {
            const date = String(c?.date || '');
            const queue = String(c?.queue || '');
            if (!date || !queue) continue;
            payloadByDateQueue.set(`${date}|${queue}`, c?.payload || null);
        }

        const hasUpcomingForDateFromChanges = (dateIso) => {
            const keys = Array.from(payloadByDateQueue.keys()).filter((k) => k.startsWith(`${dateIso}|`));
            if (keys.length === 0) return false;

            for (const k of keys) {
                const payload = payloadByDateQueue.get(k);
                if (payload && hasAnyUpcomingOrOngoingOutage(now, dateIso, payload)) return true;
            }
            return false;
        };

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
                if (date === today && !hasUpcomingForDateFromChanges(today)) {
                    setCacheValue(key, hasAnyOutages ? '1' : '0');
                    continue;
                }

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

                    const isTomorrow = date === tomorrow;
                    const msg = isTomorrow
                        ? `⚠️ Увага! З’явився графік відключень на завтра.\nНатисни кнопку нижче, щоб побачити свій графік.`
                        : `⚠️ Увага! На сьогодні з’явились погодинні відключення.\nНатисни кнопку нижче, щоб побачити свій графік.`;

                    const keyboard = isTomorrow ? buildCheckScheduleKeyboard('tomorrow') : buildTodayTomorrowKeyboard();

                    await bot.telegram.sendMessage(chatId, msg, keyboard);

                    markSent({
                        eventId,
                        chatId,
                        queue: 'ALL',
                        type: 'DAY_ON',
                        scheduledAt: now.toISO(),
                    });
                }
            }

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
                    const isTomorrow = date === tomorrow;
                    const isToday = date === today;

                    const payload = c?.payload || {};
                    const outagesText = formatIntervalsShort(payload.outages);
                    const adjText = formatAdjustmentsShort(payload.adjustments, queue);

                    if (isToday && isLikelyMidnightMergeOnly({
                        dateIso: today,
                        payload,
                        hasAdjustments: !!adjText,
                    })) {
                        continue;
                    }

                    const nextHash = String(c?.nextHash || sha256(JSON.stringify(payload || {})));
                    const eventId = `${chatId}|${queue}|${date}|QUEUE_CHANGE|${nextHash}`;
                    if (wasSent(eventId)) continue;

                    const appeared = !c?.prevHash;

                    let header = '🔄 Графік оновлено';
                    if (isTomorrow) {
                        header = appeared ? '✅ З’явився графік на завтра' : '🔄 Графік оновлено на завтра';
                    } else if (isToday) {
                        header = '🔄 Графік оновлено на сьогодні';
                        if (adjText && !appeared) header = '⚠️ Оперативні зміни на сьогодні';
                    } else {
                        header = appeared ? '✅ З’явились відключення' : '🔄 Графік оновлено';
                    }

                    if (adjText && isTomorrow && !appeared) {
                        header = '⚠️ Оперативні зміни на завтра';
                    }

                    const lines = [];
                    lines.push(header);
                    lines.push(`Підчерга ${queue} (${date}): ${outagesText}`);

                    if (adjText) {
                        lines.push('');
                        lines.push(adjText);
                    }

                    lines.push('');
                    lines.push('Натисни кнопку нижче, щоб швидко перевірити графік.');

                    const day = isTomorrow ? 'tomorrow' : 'today';
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
