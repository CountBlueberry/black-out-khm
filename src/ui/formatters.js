const formatDateUa = (isoDate) => {
    const [y, m, d] = String(isoDate).split('-');
    if (!y || !m || !d) return isoDate;
    return `${d}.${m}.${y}`;
};

const formatOutageLine = (o) => {
    const end = o.toNextDay ? `${o.to} (+1 день)` : o.to;
    return `${o.from}–${end}`;
};

const formatScheduleMessage = ({ queue, schedules }) => {
    if (!schedules || schedules.length === 0) {
        return `Підчерга ${queue}: відключень не знайдено.`;
    }

    const lines = [];
    lines.push(`Підчерга ${queue}:`);

    for (const s of schedules) {
        lines.push(`\n${formatDateUa(s.date)}`);
        for (const o of s.outages) {
            lines.push(`• ${formatOutageLine(o)}`);
        }
    }

    return lines.join('\n');
};

const formatMultiQueueMessage = ({ day, dayIso, results }) => {
    const lines = [];
    lines.push(day === 'tomorrow' ? `Графік на завтра (${formatDateUa(dayIso)}):` : `Графік на сьогодні (${formatDateUa(dayIso)}):`);

    const hasAny = results.some((r) => r.schedules && r.schedules.some((s) => s.outages.length > 0));

    if (!hasAny) {
        lines.push('\nВідключень для твоїх черг не знайдено.');
        return lines.join('\n');
    }

    for (const r of results) {
        const msg = formatScheduleMessage({ queue: r.queue, schedules: r.schedules });
        lines.push(`\n${msg}`);
    }

    return lines.join('\n');
};

module.exports = {
    formatDateUa,
    formatScheduleMessage,
    formatMultiQueueMessage,
};
