const { getScheduleForQueue: realGetSchedule } = require('./outages');
const { getScheduleForQueue: mockGetSchedule } = require('./provider.mock');

const USE_MOCK = process.env.OUTAGES_MOCK === 'true';

const getScheduleForQueue = async (queue) => {
    if (USE_MOCK) {
        return mockGetSchedule(queue);
    }
    return realGetSchedule(queue);
};

module.exports = { getScheduleForQueue };