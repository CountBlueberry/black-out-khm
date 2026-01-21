const { DateTime } = require('luxon');

const KYIV_TZ = 'Europe/Kyiv';

const toMinutes = (hhmm) => {
    const [h, m] = String(hhmm).split(':').map((x) => Number(x));
    return h * 60 + m;
};

const isWithinQuietHours = (now, quiet) => {
    if (!quiet?.enabled) return false;

    const startM = toMinutes(quiet.start);
    const endM = toMinutes(quiet.end);

    const nowKyiv = now?.isValid ? now.setZone(KYIV_TZ) : DateTime.now().setZone(KYIV_TZ);
    const nowM = nowKyiv.hour * 60 + nowKyiv.minute;

    if (startM === endM) return true;

    if (startM < endM) {
        return nowM >= startM && nowM < endM;
    }

    return nowM >= startM || nowM < endM;
};

module.exports = { isWithinQuietHours, KYIV_TZ };
