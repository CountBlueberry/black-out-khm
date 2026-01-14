const axios = require('axios');
const cheerio = require('cheerio');

const OUTAGES_URL = 'https://hoe.com.ua/page/pogodinni-vidkljuchennja';

const normalizeSpaces = (s) => s.replace(/\s+/g, ' ').trim();

const normalizeTime = (t) => {
    if (t === '24:00') return { time: '00:00', nextDay: true };
    return { time: t, nextDay: false };
};

const kyivDateISO = (offsetDays = 0) => {
    const ms = Date.now() + offsetDays * 24 * 60 * 60 * 1000;
    const dtf = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Kyiv',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    });
    return dtf.format(new Date(ms));
};

const parseDateFromAlt = (alt) => {
    const t = String(alt ?? '').trim();

    // "ГПВ-27.12.25" або "ГПВ-27.12.2025"
    const m = t.match(/ГПВ-(\d{2})\.(\d{2})\.(\d{2}|\d{4})/i);
    if (!m) return null;

    const dd = m[1];
    const mm = m[2];
    let yyyy = m[3];

    if (yyyy.length === 2) yyyy = `20${yyyy}`;

    return `${yyyy}-${mm}-${dd}`;
};

const findNextUlAfter = ($, imgEl) => {
    // imgEl — це cheerio-об'єкт <img>
    // Переходимо до контейнера (зазвичай <p>), щоб іти далі по документу
    const startBlock = imgEl.closest('p').length ? imgEl.closest('p') : imgEl.parent();

    let el = startBlock.next();

    while (el && el.length) {
        if (el.is('ul')) return el;

        const nestedUl = el.find('ul');
        if (nestedUl.length > 0) return nestedUl.first();

        // якщо дійшли до наступної картинки — stop (це вже інший блок графіка)
        if (el.find('img').length > 0 || el.is('p') && el.find('img').length > 0) return null;

        el = el.next();
    }

    return null;
};


const parseUlToSchedule = (ul) => {
    const lines = [];
    ul.find('li').each((_, el) => {
        const text = normalizeSpaces(ul.find(el).text());
        if (text.toLowerCase().includes('підчерга')) lines.push(text);
    });

    const re = /підчерга\s+(\d+\.\d+)\s*[–-]\s*з\s*(\d{2}:\d{2})\s*до\s*(\d{2}:\d{2})/i;

    const schedule = {};

    for (const line of lines) {
        const m = line.match(re);
        if (!m) continue;

        const queue = m[1];
        const fromRaw = m[2];
        const toRaw = m[3];

        const fromN = normalizeTime(fromRaw);
        const toN = normalizeTime(toRaw);

        if (!schedule[queue]) schedule[queue] = [];
        schedule[queue].push({
            from: fromN.time,
            to: toN.time,
            toNextDay: toN.nextDay,
            raw: line,
        });
    }

    return schedule;
};

const parseOutagesFromHtml = (html) => {
    const $ = cheerio.load(html);

    const schedulesByDate = [];
    const seenDates = new Set();

    const imgs = $('img').toArray();

    for (const imgEl of imgs) {
        const img = $(imgEl);
        const alt = img.attr('alt');
        const date = parseDateFromAlt(alt);
        if (!date) continue;

        const ul = findNextUlAfter($, img);
        if (!ul) continue;

        const schedule = parseUlToSchedule(ul);

        if (seenDates.has(date)) continue;
        seenDates.add(date);

        schedulesByDate.push({ date, schedule });
    }

    // сортуємо по даті спаданням (новіші зверху)
    schedulesByDate.sort((a, b) => String(b.date).localeCompare(String(a.date)));

    return { schedulesByDate };
};

const fetchOutageSchedule = async () => {
    const res = await axios.get(OUTAGES_URL, {
        headers: {
            'User-Agent': 'Mozilla/5.0',
            'Accept-Language': 'uk-UA,uk;q=0.9,en;q=0.7',
        },
        timeout: 15000,
    });

    return parseOutagesFromHtml(res.data);
};

const isValidQueue = (q) => /^\d+\.\d+$/.test(String(q));

const getScheduleForQueue = async (queue) => {
    if (!isValidQueue(queue)) {
        return { ok: false, error: 'Invalid queue format. Expected like "1.1"', queue: String(queue) };
    }

    const { schedulesByDate } = await fetchOutageSchedule();

    const resultSchedules = schedulesByDate
        .map((s) => ({
            date: s.date,
            outages: s.schedule[queue] ?? [],
        }))
        .filter((s) => s.outages.length > 0);

    return {
        ok: true,
        source: OUTAGES_URL,
        generatedAt: new Date().toISOString(),
        queue,
        schedules: resultSchedules,
    };
};

module.exports = { getScheduleForQueue, kyivDateISO };
