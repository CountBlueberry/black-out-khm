const { DateTime } = require('luxon');
const { getScheduleForQueue } = require('../outages/provider');
const { getPrefs } = require('../db/prefsRepo');

const KYIV_TZ = 'Europe/Kyiv';

const sentEventIds = new Set();

const minuteKey = (dt) => dt.setZone(KYIV_TZ).toFormat('yyyy-LL-dd HH:mm');

const buildEventId = (chatId, queue, dateIso, type, time) => `${chatId}|${queue}|${dateIso}|${type}|${time}`;

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

const getIntervalsForDate = (schedules, dateIso) => {
    const s = schedules.find((x) => x.date === dateIso);
    return s ? s.outages : [];
};

const shouldFireNow = (nowMinute, target) => minuteKey(target) === nowMinute;

const createNotifier = ({ bot, listAllSubscriptions }) => {
    let running = false;

    const tick = async () => {
        if (running) return;
        running = true;

        try {
            const now = DateTime.now().setZone(KYIV_TZ);
            const nowMinute = minuteKey(now);

            const subs = listAllSubscriptions();
            for (const { chatId, queues } of subs) {
                const prefs = getPrefs(chatId);
                const lead = prefs.leadMinutes;

                for (const queue of queues) {
                    let data;
                    try {
                        data = await getScheduleForQueue(queue);
                    } catch (e) {
                        continue;
                    }

                    const today = now.toFormat('yyyy-LL-dd');
                    const tomorrow = now.plus({ days: 1 }).toFormat('yyyy-LL-dd');

                    const candidates = [
                        { dateIso: today, outages: getIntervalsForDate(data.schedules, today) },
                        { dateIso: tomorrow, outages: getIntervalsForDate(data.schedules, tomorrow) },
                    ];

                    for (const day of candidates) {
                        for (const interval of day.outages) {
                            const start = parseToDateTime(day.dateIso, interval.from);

                            let end = parseToDateTime(day.dateIso, interval.to);
                            if (interval.toNextDay) end = end.plus({ days: 1 });

                            const before = start.minus({ minutes: lead });

                            if (prefs.notifyBefore && shouldFireNow(nowMinute, before)) {
                                if (isWithinQuietHours(now, prefs.quiet)) continue;

                                const id = buildEventId(chatId, queue, day.dateIso, 'BEFORE', before.toISO());
                                if (sentEventIds.has(id)) continue;

                                sentEventIds.add(id);
                                await bot.telegram.sendMessage(
                                    chatId,
                                    `⏳ Підчерга ${queue}: через ${lead} хв буде відключення (${start.toFormat('HH:mm')}–${end.toFormat('HH:mm')}).`
                                );
                            }

                            if (prefs.notifyStart && shouldFireNow(nowMinute, start)) {
                                if (isWithinQuietHours(now, prefs.quiet)) continue;

                                const id = buildEventId(chatId, queue, day.dateIso, 'START', start.toISO());
                                if (sentEventIds.has(id)) continue;

                                sentEventIds.add(id);
                                await bot.telegram.sendMessage(
                                    chatId,
                                    `🔌 Підчерга ${queue}: відключення почалось (${start.toFormat('HH:mm')}–${end.toFormat('HH:mm')}).`
                                );
                            }

                            if (prefs.notifyEnd && shouldFireNow(nowMinute, end)) {
                                if (isWithinQuietHours(now, prefs.quiet)) continue;

                                const id = buildEventId(chatId, queue, day.dateIso, 'END', end.toISO());
                                if (sentEventIds.has(id)) continue;

                                sentEventIds.add(id);
                                await bot.telegram.sendMessage(
                                    chatId,
                                    `✅ Підчерга ${queue}: відключення завершилось (мало з’явитись світло).`
                                );
                            }
                        }
                    }
                }
            }

            if (sentEventIds.size > 5000) {
                sentEventIds.clear();
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
