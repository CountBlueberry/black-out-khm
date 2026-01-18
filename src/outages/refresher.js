const axios = require('axios');

const { getCacheValue, setCacheValue } = require('../db/cacheRepo');
const { upsertQueueSnapshot } = require('../db/outagesSnapshotRepo');
const { fingerprintOutagesPage } = require('./fingerprint');
const { parseOutagesFromHtml } = require('./outages');

const OUTAGES_URL = 'https://hoe.com.ua/page/pogodinni-vidkljuchennja';

const CACHE_KEY = 'outages_page_fingerprint';

const fetchHtml = async () => {
    const res = await axios.get(OUTAGES_URL, {
        headers: {
            'User-Agent': 'Mozilla/5.0',
            'Accept-Language': 'uk-UA,uk;q=0.9,en;q=0.7',
        },
        timeout: 15000,
    });

    return res.data;
};

const persistSnapshots = ({ schedulesByDate }) => {
    for (const day of schedulesByDate) {
        const date = day.date;
        const schedule = day.schedule || {};
        const adjustments = day.adjustments || [];

        const queues = new Set([
            ...Object.keys(schedule),
            ...adjustments.flatMap((a) => (a.queues ? a.queues : [])),
        ]);

        for (const queue of queues) {
            const payload = {
                date,
                queue,
                outages: schedule[queue] || [],
                adjustments: adjustments.filter((a) => (a.queues || []).includes(queue)),
            };

            upsertQueueSnapshot({
                date,
                queue,
                json: JSON.stringify(payload),
            });
        }
    }
};

const refreshOutagesOnce = async () => {
    const html = await fetchHtml();

    const { fingerprint } = fingerprintOutagesPage(html);
    const prev = getCacheValue(CACHE_KEY);

    if (prev && prev === fingerprint) {
        return { ok: true, changed: false };
    }

    setCacheValue(CACHE_KEY, fingerprint);

    const parsed = parseOutagesFromHtml(html);

    persistSnapshots(parsed);

    return {
        ok: true,
        changed: true,
        dates: (parsed.schedulesByDate || []).map((s) => s.date),
    };
};

const startOutagesJob = ({
                             intervalMs = 30 * 60 * 1000,
                             runOnStart = true,
                             onError = null,
                             onChange = null,
                         } = {}) => {
    let timer = null;

    let isRunning = false;

    const safeRun = async () => {
        if (isRunning) return;
        isRunning = true;

        try {
            const res = await refreshOutagesOnce();
            if (res.changed && typeof onChange === 'function') onChange(res);
        } catch (e) {
            if (typeof onError === 'function') onError(e);
        } finally {
            isRunning = false;
        }
    };

    if (runOnStart) safeRun();

    timer = setInterval(() => {
        safeRun();
    }, intervalMs);

    return () => {
        if (timer) clearInterval(timer);
    };
};

module.exports = { startOutagesJob, refreshOutagesOnce };
