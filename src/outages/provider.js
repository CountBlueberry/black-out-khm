const { getQueueSnapshot } = require('../db/outagesSnapshotRepo');
const { kyivDateISO, getScheduleForQueue: realGetSchedule } = require('./outages');
const { getScheduleForQueue: mockGetSchedule } = require('./provider.mock');

const USE_MOCK = process.env.OUTAGES_MOCK === 'true';

const getScheduleForQueue = async (queue, dayIso = kyivDateISO(0)) => {
    if (USE_MOCK) {
        return mockGetSchedule(queue);
    }

    const snap = getQueueSnapshot({ date: dayIso, queue: String(queue) });
    if (snap) {
        const payload = JSON.parse(snap.json);

        return {
            ok: true,
            source: 'snapshot',
            generatedAt: snap.updatedAt,
            queue: String(queue),
            schedules: [payload],
        };
    }

    const data = await realGetSchedule(queue);
    return {
        ...data,
        schedules: (data.schedules ?? []).filter((s) => s.date === dayIso),
    };
};

module.exports = { getScheduleForQueue };
