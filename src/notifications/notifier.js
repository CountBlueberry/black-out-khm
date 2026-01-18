const { DateTime } = require('luxon');
const { getScheduleForQueue } = require('../outages/provider');
const { getPrefs } = require('../db/prefsRepo');
const { wasSent, markSent, cleanupOld } = require('../db/sentEventsRepo');

const KYIV_TZ = 'Europe/Kyiv';

const minuteKey = (dt) => dt.setZone(KYIV_TZ).toFormat('yyyy-LL-dd HH:mm');

const buildEventId = (chatId, queue, dateIso, type, atIso) => `${chatId}|${queue}|${dateIso}|${type}|${atIso}`;

const parseToDateTime = (dateIso, timeStr) => {
    const [hh, mm] = timeStr.split(':').map((x) => Number(x));
    return DateTime.fromISO(dateIso, { zone: KYIV_TZ }).set({ hour: hh, minute: mm, second: 0, millisecond: 0 });
};

const isWithinQuietHours = (now, quiet) => {
    if (!quiet?.enabled) return false;

    const toMinutes = (hhmm) => {
        const [h, m] = hhmm.split(':').map((x) => Number(x));
        return h * 60 + m;
    };

    const startM = toMinutes(quiet.start);
    const endM = toMinutes(quiet.end);
    const nowM = now.hour * 60 + now.minute;

    if (startM === endM) return true;

    if (startM < endM) {
        return nowM >= startM && nowM < endM;
    }

    return nowM >= startM || nowM < endM;
};

const shouldFireNow = (nowMinute, target) => minuteKey(target) === nowMinute;

const normalizeIntervals = (payload) => {
    const outages = payload?.outages ?? [];
    return Array.isArray(outages) ? outages : [];
};

const createNotifier = ({ bot, listAllSubscriptions }) => {
    let running = false;
    let tickCount = 0;

    const tick = async () => {
        if (running) return;
        running = true;

        try {
            const now = DateTime.now().setZone(KYIV_TZ);
            const nowMinute = minuteKey(now);

            const today = now.toFormat('yyyy-LL-dd');
            const tomorrow = now.plus({ days: 1 }).toFormat('yyyy-LL-dd');

            // lightweight cleanup once per ~6 hours (360 ticks)
            tickCount += 1;
            if (tickCount % 360 === 0) {
                try {
                    cleanupOld(7);
                } catch (e) {
                    // ignore cleanup errors
                }
            }

            const subs = listAllSubscriptions();

            // Cache schedules per tick to avoid repeated DB reads
            // key: `${queue}|${dateIso}` -> payload {date, queue, outages, adjustments}
            const scheduleCache = new Map();

            const getPayload = async (queue, dateIso) => {
                const key = `${queue}|${dateIso}`;
                if (scheduleCache.has(key)) return scheduleCache.get(key);

                let data;
                try {
                    data = await getScheduleForQueue(queue, dateIso);
                } catch (e) {
                    scheduleCache.set(key, null);
                    return null;
                }

                const payload = Array.isArray(data?.schedules) && data.schedules.length > 0 ? data.schedules[0] : null;
                scheduleCache.set(key, payload);
                return payload;
            };

            for (const { chatId, queues } of subs) {
                const prefs = getPrefs(chatId);
                const lead = prefs.leadMinutes;

                for (const queue of queues) {
                    const payloadToday = await getPayload(queue, today);
                    const payloadTomorrow = await getPayload(queue, tomorrow);

                    const candidates = [
                        { dateIso: today, payload: payloadToday },
                        { dateIso: tomorrow, payload: payloadTomorrow },
                    ];

                    for (const day of candidates) {
                        if (!day.payload) continue;

                        const outages = normalizeIntervals(day.payload);
                        if (outages.length === 0) continue;

                        for (const interval of outages) {
                            const start = parseToDateTime(day.dateIso, interval.from);

                            let end = parseToDateTime(day.dateIso, interval.to);
                            if (interval.toNextDay) end = end.plus({ days: 1 });

                            const before = start.minus({ minutes: lead });

                            if (prefs.notifyBefore && shouldFireNow(nowMinute, before)) {
                                if (isWithinQuietHours(now, prefs.quiet)) continue;

                                const id = buildEventId(chatId, queue, day.dateIso, 'BEFORE', before.toISO());
                                if (wasSent(id)) continue;

                                await bot.telegram.sendMessage(
                                    chatId,
                                    `⏳ Підчерга ${queue}: через ${lead} хв буде відключення (${start.toFormat('HH:mm')}–${end.toFormat('HH:mm')}).`
                                );

                                markSent({
                                    eventId: id,
                                    chatId,
                                    queue,
                                    type: 'BEFORE',
                                    scheduledAt: before.toISO(),
                                });
                            }

                            if (prefs.notifyStart && shouldFireNow(nowMinute, start)) {
                                if (isWithinQuietHours(now, prefs.quiet)) continue;

                                const id = buildEventId(chatId, queue, day.dateIso, 'START', start.toISO());
                                if (wasSent(id)) continue;

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

                            if (prefs.notifyEnd && shouldFireNow(nowMinute, end)) {
                                if (isWithinQuietHours(now, prefs.quiet)) continue;

                                const endDateIso = end.toFormat('yyyy-LL-dd');
                                const id = buildEventId(chatId, queue, endDateIso, 'END', end.toISO());
                                if (wasSent(id)) continue;

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
        } finally {
            running = false;
        }
    };

    const start = () => {
        tick();
        setInterval(() => tick(), 60 * 1000);
    };

    return { start };
};

module.exports = { createNotifier };
