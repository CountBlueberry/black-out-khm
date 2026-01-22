const pad2 = (n) => String(n).padStart(2, '0');

const sanitizeTimeStr = (raw) => {
    const t = String(raw ?? '').trim();

    const m = t.match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return { time: t, nextDay: false };

    const hh = Number(m[1]);
    const mm = Number(m[2]);

    if (!Number.isFinite(hh) || !Number.isFinite(mm)) {
        return { time: t, nextDay: false };
    }

    // 24:00 → next day
    if (hh === 24 && mm === 0) {
        return { time: '00:00', nextDay: true };
    }

    // 🛠 HOE bug: 00:03 → 03:00
    if (hh === 0 && mm > 0 && mm <= 23) {
        return { time: `${pad2(mm)}:00`, nextDay: false };
    }

    if (hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59) {
        return { time: `${pad2(hh)}:${pad2(mm)}`, nextDay: false };
    }

    return { time: t, nextDay: false };
};

module.exports = { sanitizeTimeStr };
