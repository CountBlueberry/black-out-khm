const axios = require('axios');
const crypto = require('crypto');

const { getCacheValue, setCacheValue } = require('../db/cacheRepo');
const { upsertQueueSnapshot, getQueueSnapshot } = require('../db/outagesSnapshotRepo');
const { fingerprintOutagesPage } = require('./fingerprint');
const { parseOutagesFromHtml } = require('./outages');

const OUTAGES_URL = 'https://hoe.com.ua/page/pogodinni-vidkljuchennja';
const CACHE_KEY = 'outages_page_fingerprint:v2';

const sha256 = (s) =>
    crypto.createHash('sha256').update(String(s)).digest('hex');

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

const sortAsc = (a, b) => String(a?.date || '').localeCompare(String(b?.date || ''));

const cloneInterval = (x) => ({
    from: x?.from,
    to: x?.to,
    toNextDay: !!x?.toNextDay,
    raw: x?.raw,
    shadow: !!x?.shadow,
});

const mergeMidnightIntervals = ({ schedulesByDate }) => {
    const days = Array.isArray(schedulesByDate)
        ? schedulesByDate.slice().sort(sortAsc)
        : [];

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

            if (!lastA || !firstB) continue;

            const endsAtMidnight =
                String(lastA.to) === '00:00' && !lastA.toNextDay;
            const startsAtMidnight =
                String(firstB.from) === '00:00';

            if (!endsAtMidnight || !startsAtMidnight) continue;

            const merged = {
                from: String(lastA.from),
                to: String(firstB.to),
                toNextDay: true,
                raw: `${lastA.raw || ''} | ${firstB.raw || ''}`.trim(),
            };

            s1[queue] = [...a.slice(0, -1).map(cloneInterval), merged];

            const shadowMerged = {
                from: merged.from,
                to: merged.to,
                toNextDay: false,
                raw: merged.raw,
                shadow: true,
            };

            s2[queue] = [shadowMerged, ...b.slice(1).map(cloneInterval)];
        }

        d1.schedule = s1;
        d2.schedule = s2;
    }

    return { schedulesByDate: days };
};

const computeDayStatus = (schedulesByDate) => {
    return (Array.isArray(schedulesByDate) ? schedulesByDate : []).map((d) => {
        const schedule = d?.schedule || {};
        const hasAnyOutages = Object.values(schedule).some(
            (arr) => Array.isArray(arr) && arr.some((x) => !x?.shadow)
        );

        return { date: d?.date, hasAnyOutages };
    });
};

const persistSnapshotsWithDiff = ({ schedulesByDate }) => {
    const changes = [];

    for (const day of schedulesByDate || []) {
        const date = day?.date;
        if (!date) continue;

        const schedule = day.schedule || {};
        const adjustments = day.adjustments || [];

        const queues = new Set([
            ...Object.keys(schedule),
            ...adjustments.flatMap((a) => a?.queues || []),
        ]);

        for (const queue of queues) {
            const payload = {
                date,
                queue: String(queue),
                outages: schedule[queue] || [],
                adjustments: adjustments.filter((a) =>
                    (a?.queues || []).includes(queue)
                ),
            };

            const json = JSON.stringify(payload);
            const nextHash = sha256(json);

            const prev = getQueueSnapshot({ date, queue });
            const prevHash = prev ? sha256(prev.json) : null;

            if (prevHash !== nextHash) {
                changes.push({
                    date,
                    queue: String(queue),
                    prevHash,
                    nextHash,
                    payload,
                });
            }

            upsertQueueSnapshot({ date, queue, json });
        }
    }

    return changes;
};

const refreshOutagesOnce = async () => {
    const html = await fetchHtml();

    const { fingerprint } = fingerprintOutagesPage(html);
    const prev = getCacheValue(CACHE_KEY);

    if (prev && prev === fingerprint) {
        return {
            ok: true,
            changed: false,
            changes: [],
            dayStatus: [],
        };
    }

    setCacheValue(CACHE_KEY, fingerprint);

    const parsed = parseOutagesFromHtml(html);
    const merged = mergeMidnightIntervals(parsed);
    const changes = persistSnapshotsWithDiff(merged);

    return {
        ok: true,
        changed: true,
        changes,
        dayStatus: computeDayStatus(merged.schedulesByDate),
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
            if (res.changed && typeof onChange === 'function') {
                await onChange(res);
            }
        } catch (e) {
            if (typeof onError === 'function') onError(e);
        }
    };

    if (runOnStart) safeRun();
    timer = setInterval(safeRun, intervalMs);

    return () => timer && clearInterval(timer);
};

module.exports = { startOutagesJob, refreshOutagesOnce };
