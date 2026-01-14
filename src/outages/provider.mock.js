const { DateTime } = require('luxon');

const KYIV_TZ = 'Europe/Kyiv';

const now = DateTime.now().setZone(KYIV_TZ);

// ❗️спеціально робимо події через кілька хвилин
const start = now.plus({ minutes: 2 }).toFormat('HH:mm');
const end = now.plus({ minutes: 4 }).toFormat('HH:mm');

const today = now.toFormat('yyyy-LL-dd');

const getScheduleForQueue = async (queue) => {
    return {
        ok: true,
        source: 'MOCK',
        generatedAt: new Date().toISOString(),
        queue,
        schedules: [
            {
                date: today,
                outages: [
                    {
                        from: start,
                        to: end,
                        toNextDay: false,
                        raw: 'MOCK DATA',
                    },
                ],
            },
        ],
    };
};

module.exports = { getScheduleForQueue };
