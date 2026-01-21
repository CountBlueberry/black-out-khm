const { DateTime } = require('luxon');
const { getScheduleForQueue } = require('../outages/provider');
const { getPrefs } = require('../db/prefsRepo');
const { wasSent, markSent, cleanupOld } = require('../db/sentEventsRepo');

const { isWithinQuietHours, KYIV_TZ } = require('../utils/quietHours');

const buildEventId = (chatId, queue, dateIso, type, atIso) => `${chatId}|${queue}|${dateIso}|${type}|${atIso}`;

const parseToDateTime = (dateIso, timeStr) => {
    const safe = String(timeStr ?? '').trim();
    const m = safe.match(/^(\d{2}):(\d{2})$/);
    if (!m) return null;

    const hh = Number(m[1]);
    const mm = Number(m[2]);

    if (!Number.isInteger(hh) || !Number.isInteger(mm) || hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;

    const dt = DateTime.fromISO(String(dateIso), { zone: KYIV_TZ }).set({
        hour: hh,
        minute: mm,
        second: 0,
        millisecond: 0,
    });

    return dt.isValid ? dt : null;
};

// Fires if:
// - within "early" window before target (to handle tick jitter), OR
// - up to "catchupMinutes" late after target (restart / drift)
const shouldFire = (now, target, { earlySeconds = 30, catchupMinutes = 0 } = {}) => {
    if (!target || !target.isValid) return false;

    const diffMs = now.toMillis() - target.toMillis();

    const earlyMs = earlySeconds * 1000;
    const lateMs = catchupMinutes * 60 * 1000;

    return diffMs >= -earlyMs && diffMs <= lateMs;
};

const normalizeIntervals = (payload) => {
    if (!payload || typeof payload !== 'object') return [];
    const outages = payload.outages;
    if (!Array.isArray(outages)) return [];
    return outages.filter((x) => x && !x.shadow);
};

const createNotifier = ({ bot, listAllSubscriptions }) => {
    let running = false;
    let tickCount = 0;

    const tick = async () => {
        if (running) return;
        running = true;

        try {
            const now = DateTime.now().setZone(KYIV_TZ);

            const today = now.toFormat('yyyy-LL-dd');
            const tomorrow = now.plus({ days: 1 }).toFormat('yyyy-LL-dd');

            tickCount += 1;
            if (tickCount % 360 === 0) {
                try {
                    cleanupOld(7);
                } catch (_) {}
            }

            const subs = listAllSubscriptions();
            const scheduleCache = new Map();

            const getPayload = async (queue, dateIso) => {
                const key = `${queue}|${dateIso}`;
                if (scheduleCache.has(key)) return scheduleCache.get(key);

                try {
                    const data = await getScheduleForQueue(queue, dateIso);
                    const payload =
                        Array.isArray(data?.schedules) && data.schedules.length > 0 ? data.schedules[0] : null;
                    scheduleCache.set(key, payload);
                    return payload;
                } catch {
                    scheduleCache.set(key, null);
                    return null;
                }
            };

            for (const { chatId, queues } of subs) {
                const prefs = getPrefs(chatId);

                for (const queue of queues) {
                    const payloadToday = await getPayload(queue, today);
                    const payloadTomorrow = await getPayload(queue, tomorrow);

                    const days = [
                        { dateIso: today, payload: payloadToday },
                        { dateIso: tomorrow, payload: payloadTomorrow },
                    ];

                    for (const day of days) {
                        const outages = normalizeIntervals(day.payload);
                        if (outages.length === 0) continue;

                        const quietNow = isWithinQuietHours(now, prefs.quiet);

                        for (const interval of outages) {
                            const start = parseToDateTime(day.dateIso, interval?.from);
                            if (!start) continue;

                            let end = parseToDateTime(day.dateIso, interval?.to);
                            if (!end) continue;

                            if (interval?.toNextDay) end = end.plus({ days: 1 });

                            const before = start.minus({ minutes: prefs.leadMinutes });

                            if (
                                prefs.notifyBefore &&
                                !quietNow &&
                                shouldFire(now, before, { earlySeconds: 30, catchupMinutes: 5 })
                            ) {
                                const id = buildEventId(chatId, queue, day.dateIso, 'BEFORE', before.toISO());
                                if (!wasSent(id)) {
                                    await bot.telegram.sendMessage(
                                        chatId,
                                        `⏳ Підчерга ${queue}: через ${prefs.leadMinutes} хв буде відключення (${start.toFormat('HH:mm')}–${end.toFormat('HH:mm')}).`
                                    );
                                    markSent({
                                        eventId: id,
                                        chatId,
                                        queue,
                                        type: 'BEFORE',
                                        scheduledAt: before.toISO(),
                                    });
                                }
                            }

                            if (
                                prefs.notifyStart &&
                                !quietNow &&
                                shouldFire(now, start, { earlySeconds: 30, catchupMinutes: 2 })
                            ) {
                                const id = buildEventId(chatId, queue, day.dateIso, 'START', start.toISO());
                                if (!wasSent(id)) {
                                    await bot.telegram.sendMessage(
                                        chatId,
                                        `🔌 Підчерга ${queue}: відключення почалось (${start.toFormat('HH:mm')}–${end.toFormat('HH:mm')}).`
                                    );
                                    markSent({
                                        eventId: id,
                                        chatId,
                                        queue,
                                        type: 'START',
                                        scheduledAt: start.toISO(),
                                    });
                                }
                            }

                            if (
                                prefs.notifyEnd &&
                                !quietNow &&
                                shouldFire(now, end, { earlySeconds: 30, catchupMinutes: 2 })
                            ) {
                                const endDateIso = end.toFormat('yyyy-LL-dd');
                                const id = buildEventId(chatId, queue, endDateIso, 'END', end.toISO());
                                if (!wasSent(id)) {
                                    await bot.telegram.sendMessage(
                                        chatId,
                                        `✅ Підчерга ${queue}: відключення завершилось (мало з’явитись світло).`
                                    );
                                    markSent({
                                        eventId: id,
                                        chatId,
                                        queue,
                                        type: 'END',
                                        scheduledAt: end.toISO(),
                                    });
                                }
                            }
                        }
                    }
                }
            }
        } finally {
            running = false;
        }
    };

    const start = () => {
        tick();
        setInterval(tick, 60 * 1000);
    };

    return { start };
};

module.exports = { createNotifier };
