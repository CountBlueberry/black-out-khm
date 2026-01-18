const crypto = require('crypto');
const cheerio = require('cheerio');

const normalizeSpaces = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

const pickRelevantText = (html) => {
    const $ = cheerio.load(html);

    const parts = [];

    $('p, ul, img').each((_, el) => {
        const node = $(el);

        if (node.is('img')) {
            const alt = normalizeSpaces(node.attr('alt'));
            if (alt && /ГПВ-\d{2}\.\d{2}\.(\d{2}|\d{4})/i.test(alt)) {
                parts.push(`IMG:${alt}`);
            }
            return;
        }

        if (node.is('p')) {
            const t = normalizeSpaces(node.text());
            if (!t) return;

            const lower = t.toLowerCase();
            if (
                lower.includes('збільшення обсягу погодинних відключень') ||
                lower.includes('ще одне збільшення') ||
                lower.includes('збільшено обсяг погодинних відключень') ||
                lower.includes('відповідно') ||
                lower.includes('розпорядження') ||
                lower.includes('укренерго') ||
                lower.includes('електроенергія у підчерг буде відсутня')
            ) {
                parts.push(`P:${t}`);
            }
            return;
        }

        if (node.is('ul')) {
            const lis = [];
            node.find('li').each((__, li) => {
                const liText = normalizeSpaces($(li).text());
                const lower = liText.toLowerCase();

                if (
                    lower.includes('підчерг') ||
                    lower.includes('підчерги') ||
                    lower.includes('підчергу') ||
                    lower.includes('відключ') ||
                    lower.includes('знеструм') ||
                    lower.includes('заживлен')
                ) {
                    lis.push(liText);
                }
            });

            if (lis.length > 0) parts.push(`UL:${lis.join(' | ')}`);
        }
    });

    return parts.join('\n');
};

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

const fingerprintOutagesPage = (html) => {
    const relevant = pickRelevantText(html);
    return {
        fingerprint: sha256(relevant),
        relevantText: relevant,
    };
};

module.exports = { fingerprintOutagesPage };
