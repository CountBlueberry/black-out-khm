const { queuesKeyboard, mainMenu } = require('../ui/keyboards');
const { listQueues, clearQueues, addQueue, removeQueue } = require('../db/subscriptionsRepo');

const manageQueuesText = (chatId) => {
    const current = listQueues(chatId);
    return current.length
        ? `Твої черги: ${current.join(', ')}\n\nНатискай, щоб додати/зняти:`
        : 'Підписок немає.\n\nНатискай, щоб додати:';
};

const safeEditMessageTextNoThrow = async (ctx, text, keyboard) => {
    try {
        await ctx.editMessageText(text, keyboard);
    } catch (e) {
        const description = e?.response?.description ?? e?.description ?? e?.message ?? '';
        if (String(description).toLowerCase().includes('message is not modified')) return;
        throw e;
    }
};

const registerManageQueuesHandlers = (bot) => {
    bot.action('MANAGE_QUEUES', async (ctx) => {
        await ctx.answerCbQuery();
        const selected = listQueues(ctx.chat.id);
        const text = manageQueuesText(ctx.chat.id);
        await ctx.reply(text, queuesKeyboard(selected));
    });

    bot.action(/^TOGGLE:(\d+\.\d+)$/, async (ctx) => {
        const queue = ctx.match[1];

        const current = listQueues(ctx.chat.id);
        if (current.includes(queue)) removeQueue(ctx.chat.id, queue);
        else addQueue(ctx.chat.id, queue);

        await ctx.answerCbQuery();

        const selected = listQueues(ctx.chat.id);
        const text = manageQueuesText(ctx.chat.id);
        await safeEditMessageTextNoThrow(ctx, text, queuesKeyboard(selected));
    });

    bot.action('CLEAR_QUEUES', async (ctx) => {
        clearQueues(ctx.chat.id);

        await ctx.answerCbQuery('Очищено', { show_alert: false });

        const selected = listQueues(ctx.chat.id);
        const text = manageQueuesText(ctx.chat.id);
        await safeEditMessageTextNoThrow(ctx, text, queuesKeyboard(selected));
    });

    bot.action('DONE_QUEUES', async (ctx) => {
        await ctx.answerCbQuery();
        await safeEditMessageTextNoThrow(ctx, 'Готово ✅', mainMenu());
    });

    bot.action('BACK_MAIN', async (ctx) => {
        await ctx.answerCbQuery();
        await safeEditMessageTextNoThrow(ctx, 'Меню:', mainMenu());
    });

    bot.action(/^SHOW:(today|tomorrow|myqueues)$/, async (ctx) => {
        const action = ctx.match[1];
        await ctx.answerCbQuery();

        if (action !== 'myqueues') return;

        const current = listQueues(ctx.chat.id);
        await ctx.reply(
            current.length ? `Твої черги: ${current.join(', ')}` : 'Підписок немає. Додай: "Керувати чергами".',
            mainMenu()
        );
    });
};

module.exports = { registerManageQueuesHandlers };
