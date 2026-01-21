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

const sortAsc = (a, b) => String(a.date).localeCompare(String(b.date));

const cloneInterval = (x) => ({
    from: x.from,
    to: x.to,
    toNextDay: !!x.toNextDay,
    raw: x.raw,
    shadow: !!x.shadow,
});

const mergeMidnightIntervals = ({ schedulesByDate }) => {
    const days = Array.isArray(schedulesByDate) ? schedulesByDate.slice().sort(sortAsc) : [];
    if (days.length < 2) return { schedulesByDate: days };

    for (let i = 0; i < days.length - 1; i += 1) {
        const d1 = days[i];
        const d2 = days[i + 1];

        const s1 = d1.schedule || {};
        const s2 = d2.schedule || {};

        const queues = new Set([...Object.keys(s1), ...Object.keys(s2)]);

        for (const queue of queues) {
            const a = Array.isArray(s1[queue]) ? s1[queue] : [];
            const b = Array.isArray(s2[queue]) ? s2[queue] : [];

            if (a.length === 0 || b.length === 0) continue;

            const lastA = a[a.length - 1];
            const firstB = b[0];

            const endsAtMidnight = String(lastA.to) === '00:00' && !lastA.toNextDay;
            const startsAtMidnight = String(firstB.from) === '00:00';

            if (!endsAtMidnight || !startsAtMidnight) continue;

            const merged = {
                from: String(lastA.from),
                to: String(firstB.to),
                toNextDay: true, // because it spans into next day (from day1 POV)
                raw: `${lastA.raw} | ${firstB.raw}`,
            };

            const nextA = a.slice(0, a.length - 1).map(cloneInterval);
            nextA.push(merged);
            s1[queue] = nextA;

            const shadowMerged = {
                from: String(lastA.from),
                to: String(firstB.to),
                toNextDay: false, // from day2 POV end is on same date
                raw: `${lastA.raw} | ${firstB.raw}`,
                shadow: true, // notifier must ignore to avoid duplicates
            };

            const nextB = b.slice(1).map(cloneInterval);
            nextB.unshift(shadowMerged);
            s2[queue] = nextB;
        }

        d1.schedule = s1;
        d2.schedule = s2;
    }

    return { schedulesByDate: days };
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

    const merged = mergeMidnightIntervals(parsed);

    persistSnapshots(merged);

    return {
        ok: true,
        changed: true,
        dates: (merged.schedulesByDate || []).map((s) => s.date),
    };
};

const startOutagesJob = ({
                             intervalMs = 30 * 60 * 1000,
                             runOnStart = true,
                             onError = null,
                             onChange = null,
                         } = {}) => {
    let timer = null;

    const safeRun = async () => {
        try {
            const res = await refreshOutagesOnce();
            if (res.changed && typeof onChange === 'function') onChange(res);
        } catch (e) {
            if (typeof onError === 'function') onError(e);
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
