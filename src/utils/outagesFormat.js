const formatIntervalsShort = (outages) => {
    if (!Array.isArray(outages) || outages.length === 0) return '—';

    const clean = outages.filter((x) => !x?.shadow);
    if (clean.length === 0) return '—';

    return clean
        .map((o) => {
            const suffix = o.toNextDay ? ' (+1 день)' : '';
            return `${o.from}–${o.to}${suffix}`;
        })
        .join(', ');
};

const formatAdjustmentsShort = (adjustments, queue, limit = 3) => {
    if (!Array.isArray(adjustments) || adjustments.length === 0) return null;

    const forQueue = adjustments
        .filter((a) => Array.isArray(a?.queues) && a.queues.includes(String(queue)))
        .map((a) => String(a.text || '').trim())
        .filter(Boolean);

    if (forQueue.length === 0) return null;

    return forQueue.slice(0, limit).map((t) => `• ${t}`).join('\n');
};

module.exports = { formatIntervalsShort, formatAdjustmentsShort };
