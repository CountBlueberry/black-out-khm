const { getScheduleForQueue, kyivDateISO } = require('../outages/outages');
const { listQueues } = require('../db/subscriptionsRepo');
const { refreshKeyboard, mainMenu } = require('../ui/keyboards');
const { formatMultiQueueMessage } = require('../ui/formatters');

const buildSchedulesForQueues = async (queues, day) => {
    const dayIso = day === 'tomorrow' ? kyivDateISO(1) : kyivDateISO(0);

    const results = [];
    for (const q of queues) {
        const data = await getScheduleForQueue(q);
        const schedules = (data.schedules ?? []).filter((s) => s.date === dayIso);
        results.push({ queue: q, schedules });
    }

    return { dayIso, results };
};

const safeEditMessageText = async (ctx, text, keyboard) => {
    try {
        await ctx.editMessageText(text, keyboard);
    } catch (e) {
        const description = e?.response?.description ?? e?.description ?? e?.message ?? '';
        if (String(description).toLowerCase().includes('message is not modified')) {
            await ctx.answerCbQuery('Без змін', { show_alert: false });
            return;
        }
        throw e;
    }
};

const handleShowDay = async (ctx, day, mode) => {
    const queues = listQueues(ctx.chat.id);

    if (queues.length === 0) {
        const text = 'Підписок немає. Додай черги натиснувши "Керувати чергами".';
        if (mode === 'edit') await safeEditMessageText(ctx, text, mainMenu());
        else await ctx.reply(text, mainMenu());
        return;
    }

    const { dayIso, results } = await buildSchedulesForQueues(queues, day);
    const msg = formatMultiQueueMessage({ day, dayIso, results });
    const kb = refreshKeyboard(day);

    if (mode === 'edit') {
        await safeEditMessageText(ctx, msg, kb);
        return;
    }

    await ctx.reply(msg, kb);
};

module.exports = { handleShowDay };
