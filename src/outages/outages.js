const axios = require('axios');
const cheerio = require('cheerio');

const OUTAGES_URL = 'https://hoe.com.ua/page/pogodinni-vidkljuchennja';
const { sanitizeTimeStr } = require('../utils/time');

const normalizeTime = (t) => sanitizeTimeStr(t);

const normalizeSpaces = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

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

    const m = t.match(/ГПВ-(\d{2})\.(\d{2})\.(\d{2}|\d{4})/i);
    if (!m) return null;

    const dd = m[1];
    const mm = m[2];
    let yyyy = m[3];

    if (yyyy.length === 2) yyyy = `20${yyyy}`;

    return `${yyyy}-${mm}-${dd}`;
};

const findNextUlAfter = ($, imgEl) => {
    const startBlock = imgEl.closest('p').length ? imgEl.closest('p') : imgEl.parent();

    let el = startBlock.next();

    while (el && el.length) {
        if (el.is('ul')) return el;

        const nestedUl = el.find('ul');
        if (nestedUl.length > 0) return nestedUl.first();

        if ((el.is('p') && el.find('img').length > 0) || el.find('img').length > 0) return null;

        el = el.next();
    }

    return null;
};

const extractTextFromNode = ($, node) => {
    if (!node || !node.length) return '';
    return normalizeSpaces($(node).text());
};

const isAdjustmentLi = (text) => {
    const t = normalizeSpaces(text).toLowerCase();
    return (
        t.includes('підчерг') ||
        t.includes('підчерги') ||
        t.includes('підчергу') ||
        t.includes('відключ') ||
        t.includes('знеструм') ||
        t.includes('заживлен')
    );
};

const isLikelyAdjustmentParagraph = (text) => {
    const t = normalizeSpaces(text).toLowerCase();
    if (!t) return false;
    return (
        t.includes('збільшення обсягу погодинних відключень') ||
        t.includes('ще одне збільшення') ||
        t.includes('відповідно') ||
        t.includes('розпорядження') ||
        t.includes('укренерго') ||
        t.includes('збільшено обсяг погодинних відключень')
    );
};

const parseAdjustmentLine = (line, sectionTitle) => {
    const text = normalizeSpaces(line);
    const lower = text.toLowerCase();

    const queues = (text.match(/\d+\.\d+/g) || []).map((q) => String(q));
    if (queues.length === 0) return null;

    const timeMatch = text.match(/(\d{1,2}:\d{2})/);
    if (!timeMatch) return null;

    const time = sanitizeTimeStr(timeMatch[1]).time;

    let kind = null;

    if (/(заживлен)/i.test(lower) && /(розпоч)/i.test(lower) && /о\s*\d{1,2}:\d{2}/i.test(lower)) {
        kind = 'power_on_at';
    } else if (/(триватиме\s*до)/i.test(lower) || /\bдо\s*\d{1,2}:\d{2}\b/i.test(lower)) {
        kind = 'end_at';
    } else if (/(розпоч)/i.test(lower) || /(знеструмлен)/i.test(lower) || /о\s*\d{1,2}:\d{2}/i.test(lower)) {
        kind = 'start_at';
    }

    if (!kind) return null;

    return {
        queues,
        kind,
        time,
        text,
        sectionTitle: sectionTitle ? normalizeSpaces(sectionTitle) : undefined,
    };
};

const extractAdjustmentsBeforeImg = ($, imgEl) => {
    const img = $(imgEl);
    const startBlock = img.closest('p').length ? img.closest('p') : img.parent();

    const items = [];
    let el = startBlock.prev();

    while (el && el.length) {
        const elHasImg = el.find('img').length > 0 || (el.is('p') && el.find('img').length > 0);
        if (elHasImg) break;

        if (el.is('hr')) {
            el = el.prev();
            continue;
        }

        if (el.is('ul')) {
            const lis = [];
            el.find('li').each((_, li) => {
                const liText = normalizeSpaces($(li).text());
                if (isAdjustmentLi(liText)) lis.push(liText);
            });

            if (lis.length > 0) {
                let sectionTitle = null;

                const prev = el.prev();
                if (prev && prev.length && prev.is('p')) {
                    const pText = extractTextFromNode($, prev);
                    if (isLikelyAdjustmentParagraph(pText)) sectionTitle = pText;
                }

                items.unshift({ sectionTitle, lis });
            }

            el = el.prev();
            continue;
        }

        el = el.prev();
    }

    const adjustments = [];

    for (const block of items) {
        for (const li of block.lis) {
            const adj = parseAdjustmentLine(li, block.sectionTitle);
            if (adj) adjustments.push(adj);
        }
    }

    return adjustments;
};

const parseUlToSchedule = (ul) => {
    const schedule = {};

    const getQueue = (text) => {
        const m = text.match(/(\d+\.\d+)/);
        return m ? m[1] : null;
    };

    ul.find('li').each((_, el) => {
        const text = normalizeSpaces(ul.find(el).text());
        const lower = text.toLowerCase();
        if (!lower.includes('підчерг')) return;

        const queue = getQueue(text);
        if (!queue) return;

        const reRange = /з\s*(\d{1,2}:\d{2})\s*до\s*(\d{1,2}:\d{2})/gi;
        const ranges = [];

        let m;
        while ((m = reRange.exec(text)) !== null) {
            ranges.push({ fromRaw: m[1], toRaw: m[2] });
        }

        if (ranges.length === 0) return;

        if (!schedule[queue]) schedule[queue] = [];

        for (const r of ranges) {
            const fromN = normalizeTime(r.fromRaw);
            const toN = normalizeTime(r.toRaw);

            schedule[queue].push({
                from: fromN.time,
                to: toN.time,
                toNextDay: toN.nextDay,
                raw: text,
            });
        }
    });

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

        if (seenDates.has(date)) continue;
        seenDates.add(date);

        const schedule = parseUlToSchedule(ul);
        const adjustments = extractAdjustmentsBeforeImg($, imgEl);

        schedulesByDate.push({ date, schedule, adjustments });
    }

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
        .map((s) => {
            const outages = s.schedule[queue] ?? [];
            const adjustments = (s.adjustments ?? []).filter((a) => (a.queues ?? []).includes(String(queue)));

            return {
                date: s.date,
                outages,
                adjustments,
            };
        })
        .filter((s) => s.outages.length > 0 || s.adjustments.length > 0);

    return {
        ok: true,
        source: OUTAGES_URL,
        generatedAt: new Date().toISOString(),
        queue,
        schedules: resultSchedules,
    };
};

module.exports = { getScheduleForQueue, kyivDateISO, parseOutagesFromHtml };
