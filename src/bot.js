const { Telegraf } = require('telegraf');

const { handleShowDay } = require('./handlers/showDay');
const { registerManageQueuesHandlers } = require('./handlers/manageQueues');
const { createNotifier } = require('./notifications/notifier');

const { notifySettingsKeyboard, quietKeyboard, leadKeyboard, mainMenu } = require('./ui/keyboards');

const { getPrefs, updatePrefs } = require('./db/prefsRepo');
const { startOutagesJob } = require('./outages/refresher');
const { addQueue, removeQueue, listQueues, listAllSubscriptions } = require('./db/subscriptionsRepo');

const { createOutagesChangeNotifier } = require('./services/outagesChangeNotifier');

const { migrate } = require('./db/db');
migrate();

if (!process.env.BOT_TOKEN) {
    throw new Error('BOT_TOKEN is not set');
}

const bot = new Telegraf(process.env.BOT_TOKEN);
const pendingQuietByChatId = new Map();

const isValidQueue = (q) => /^\d+\.\d+$/.test(String(q));

const buildSettingsText = (prefs) => {
    return `⚙️ Налаштування сповіщень\n\n` +
        `Попередження: ${prefs.leadMinutes} хв\n` +
        `До відключення: ${prefs.notifyBefore ? 'увімкнено' : 'вимкнено'}\n` +
        `Початок: ${prefs.notifyStart ? 'увімкнено' : 'вимкнено'}\n` +
        `Кінець: ${prefs.notifyEnd ? 'увімкнено' : 'вимкнено'}\n` +
        `Тиша: ${prefs.quiet.enabled ? 'увімкнено' : 'вимкнено'} (${prefs.quiet.start}-${prefs.quiet.end})`;
};

bot.start(async (ctx) => {
    const text =
        `Привіт! 👋\n\n` +
        `1) Спочатку обери свою підчергу: натисни «Керувати чергами» і відміть потрібні.\n\n` +
        `2) Кнопками «Сьогодні» та «Завтра» ти можеш подивитись актуальні відключення для вибраних черг.\n\n` +
        `3) У «⚙️ Налаштування» можна керувати сповіщеннями:\n` +
        `• надсилати до відключення\n` +
        `• на початку відключення\n` +
        `• в кінці відключення\n` +
        `• налаштувати «тиху годину», коли сповіщення не приходитимуть\n` +
        `• вибрати, за скільки хвилин попереджати про відключення.`;

    await ctx.reply(text, mainMenu());
});

bot.command('subscribe', async (ctx) => {
    const text = ctx.message?.text ?? '';
    const parts = text.split(' ').map((p) => p.trim()).filter(Boolean);
    const queues = parts.slice(1);

    if (queues.length === 0) {
        await ctx.reply('Використання: /subscribe 1.1 5.2');
        return;
    }

    const invalid = queues.filter((q) => !isValidQueue(q));
    if (invalid.length > 0) {
        await ctx.reply(`Некоректні черги: ${invalid.join(', ')}. Приклад: 1.1`);
        return;
    }

    for (const q of queues) addQueue(ctx.chat.id, q);

    const current = listQueues(ctx.chat.id);
    await ctx.reply(`Підписано: ${current.join(', ')}`, mainMenu());
});

bot.command('unsubscribe', async (ctx) => {
    const text = ctx.message?.text ?? '';
    const parts = text.split(' ').map((p) => p.trim()).filter(Boolean);
    const queues = parts.slice(1);

    if (queues.length === 0) {
        await ctx.reply('Використання: /unsubscribe 1.1 5.2');
        return;
    }

    for (const q of queues) removeQueue(ctx.chat.id, q);

    const current = listQueues(ctx.chat.id);
    await ctx.reply(current.length ? `Залишились: ${current.join(', ')}` : 'Підписок немає.', mainMenu());
});

bot.command('myqueues', async (ctx) => {
    const current = listQueues(ctx.chat.id);
    await ctx.reply(
        current.length ? `Твої черги: ${current.join(', ')}` : 'Підписок немає. Додай: "Керувати чергами".',
        mainMenu()
    );
});

bot.command('today', async (ctx) => {
    try {
        await handleShowDay(ctx, 'today', 'reply');
    } catch (e) {
        await ctx.reply(`Помилка: ${e?.message ?? 'unknown'}`);
    }
});

bot.command('tomorrow', async (ctx) => {
    try {
        await handleShowDay(ctx, 'tomorrow', 'reply');
    } catch (e) {
        await ctx.reply(`Помилка: ${e?.message ?? 'unknown'}`);
    }
});

bot.command('lead', async (ctx) => {
    const text = ctx.message?.text ?? '';
    const parts = text.split(' ').map((p) => p.trim()).filter(Boolean);
    const n = Number(parts[1]);

    if (!Number.isFinite(n) || n < 0 || n > 180) {
        await ctx.reply('Використання: /lead 30 (0..180 хв)');
        return;
    }

    const prefs = updatePrefs(ctx.chat.id, { leadMinutes: n });
    await ctx.reply(`Готово. Попереджатиму за ${prefs.leadMinutes} хв.`);
});

await bot.telegram.setMyCommands([
    { command: 'today', description: 'Показати графік на сьогодні' },
    { command: 'tomorrow', description: 'Показати графік на завтра' },
    { command: 'myqueues', description: 'Мої черги' },
    { command: 'subscribe', description: 'Підписатися на черги' },
    { command: 'unsubscribe', description: 'Відписатися від черг' },
    { command: 'lead', description: 'Налаштувати попередження' },
]);

bot.action('OPEN_SETTINGS', async (ctx) => {
    await ctx.answerCbQuery();
    const prefs = getPrefs(ctx.chat.id);
    await ctx.reply(buildSettingsText(prefs), notifySettingsKeyboard(prefs));
});

bot.action(/^TOGGLE_NOTIFY:(before|start|end)$/, async (ctx) => {
    const key = ctx.match[1];
    await ctx.answerCbQuery();

    const prefs = getPrefs(ctx.chat.id);

    const patch = {};
    if (key === 'before') patch.notifyBefore = !prefs.notifyBefore;
    if (key === 'start') patch.notifyStart = !prefs.notifyStart;
    if (key === 'end') patch.notifyEnd = !prefs.notifyEnd;

    const nextPrefs = updatePrefs(ctx.chat.id, patch);

    try {
        await ctx.editMessageText(buildSettingsText(nextPrefs), notifySettingsKeyboard(nextPrefs));
    } catch (e) {
        const description = e?.response?.description ?? e?.description ?? e?.message ?? '';
        if (String(description).toLowerCase().includes('message is not modified')) return;
        await ctx.reply(buildSettingsText(nextPrefs), notifySettingsKeyboard(nextPrefs));
    }
});

bot.action('OPEN_LEAD', async (ctx) => {
    await ctx.answerCbQuery();
    const prefs = getPrefs(ctx.chat.id);
    const text = `⏳ За скільки хвилин попереджати?\n\nЗараз: ${prefs.leadMinutes} хв`;
    await ctx.reply(text, leadKeyboard(prefs.leadMinutes));
});

bot.action(/^LEAD:(\d+)$/, async (ctx) => {
    const n = Number(ctx.match[1]);
    await ctx.answerCbQuery();

    if (!Number.isFinite(n) || n < 0 || n > 180) {
        await ctx.reply('Некоректне значення. Доступно 0..180 хв.', mainMenu());
        return;
    }

    const prefs = updatePrefs(ctx.chat.id, { leadMinutes: n });

    try {
        await ctx.editMessageText(
            `✅ Готово. Попереджатиму за ${prefs.leadMinutes} хв.\n\nМожеш змінити тут:`,
            leadKeyboard(prefs.leadMinutes)
        );
    } catch (e) {
        const description = e?.response?.description ?? e?.description ?? e?.message ?? '';
        if (String(description).toLowerCase().includes('message is not modified')) return;
        await ctx.reply(`✅ Готово. Попереджатиму за ${prefs.leadMinutes} хв.`, mainMenu());
    }
});

bot.action(/^SHOW:(today|tomorrow)$/, async (ctx) => {
    const day = ctx.match[1];
    await ctx.answerCbQuery();

    try {
        await handleShowDay(ctx, day, 'reply');
    } catch (e) {
        await ctx.reply(`Помилка: ${e?.message ?? 'unknown'}`);
    }
});

bot.action(/^REFRESH:(today|tomorrow)$/, async (ctx) => {
    const day = ctx.match[1];
    await ctx.answerCbQuery();

    try {
        await handleShowDay(ctx, day, 'edit');
    } catch (e) {
        await ctx.reply(`Помилка: ${e?.message ?? 'unknown'}`);
    }
});

bot.action('OPEN_QUIET', async (ctx) => {
    await ctx.answerCbQuery();
    const prefs = getPrefs(ctx.chat.id);

    const text = `🌙 Тиша (не турбувати)\n\n` +
        `Статус: ${prefs.quiet.enabled ? 'увімкнено' : 'вимкнено'}\n` +
        `Період: ${prefs.quiet.start}–${prefs.quiet.end}\n\n` +
        `Під час тиші сповіщення не надсилатимуться.`;

    await ctx.reply(text, quietKeyboard(prefs));
});

bot.action('QUIET_ON', async (ctx) => {
    await ctx.answerCbQuery('Увімкнено', { show_alert: false });
    const prefs = getPrefs(ctx.chat.id);
    const nextPrefs = updatePrefs(ctx.chat.id, { quiet: { ...prefs.quiet, enabled: true } });
    const text = `🌙 Тиша: увімкнено (${nextPrefs.quiet.start}–${nextPrefs.quiet.end})`;
    await ctx.editMessageText(text, quietKeyboard(nextPrefs));
});

bot.action('QUIET_OFF', async (ctx) => {
    await ctx.answerCbQuery('Вимкнено', { show_alert: false });
    const prefs = getPrefs(ctx.chat.id);
    const nextPrefs = updatePrefs(ctx.chat.id, { quiet: { ...prefs.quiet, enabled: false } });
    const text = `🌙 Тиша: вимкнено (${nextPrefs.quiet.start}–${nextPrefs.quiet.end})`;
    await ctx.editMessageText(text, quietKeyboard(nextPrefs));
});

bot.action(/^QUIET_PRESET:(\d{2}:\d{2})-(\d{2}:\d{2})$/, async (ctx) => {
    const start = ctx.match[1];
    const end = ctx.match[2];
    await ctx.answerCbQuery();

    const prefs = getPrefs(ctx.chat.id);
    const nextPrefs = updatePrefs(ctx.chat.id, { quiet: { ...prefs.quiet, start, end } });
    const text = `🌙 Тиша: ${nextPrefs.quiet.enabled ? 'увімкнено' : 'вимкнено'} (${nextPrefs.quiet.start}–${nextPrefs.quiet.end})`;
    await ctx.editMessageText(text, quietKeyboard(nextPrefs));
});

bot.action('QUIET_CUSTOM', async (ctx) => {
    await ctx.answerCbQuery();
    pendingQuietByChatId.set(ctx.chat.id, true);
    await ctx.reply('Введи період у форматі: 22:00-08:00');
});

bot.action('OPEN_DONATE', async (ctx) => {
    await ctx.answerCbQuery();

    const text =
        `💛 Підтримка\n\n` +
        `Цей бот створений і підтримується добровільно, щоб допомагати орієнтуватись у відключеннях.\n\n` +
        `Якщо хочеш підтримати розробника — буду вдячний 💙\n` +
        `Але ще краще — задонать на русоріз 🇺🇦\n` +
        `Щоб одного дня такі боти просто стали не потрібні.\n\n` +
        `Дякую за підтримку!`;

    await ctx.reply(text, {
        reply_markup: {
            inline_keyboard: [
                [{ text: '💛 Підтримати розробника', url: 'https://donatello.to/VladyslavYurovskyi' }],
                [{ text: '🇺🇦 Донат на ЗСУ', url: 'https://send.monobank.ua/jar/2JbpBYkhMv' }],
                [{ text: '⬅️ Назад', callback_data: 'BACK_MAIN' }],
            ],
        },
    });
});

bot.action('BACK_MAIN', async (ctx) => {
    await ctx.answerCbQuery();
    try {
        await ctx.editMessageText('Меню:', mainMenu());
    } catch (e) {
        const description = e?.response?.description ?? e?.description ?? e?.message ?? '';
        if (String(description).toLowerCase().includes('message is not modified')) return;
        await ctx.reply('Меню:', mainMenu());
    }
});


bot.on('text', async (ctx, next) => {
    const pending = pendingQuietByChatId.get(ctx.chat.id);
    if (!pending) return next();

    const text = (ctx.message?.text ?? '').trim();
    const m = text.match(/^(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})$/);

    if (!m) {
        await ctx.reply('Некоректно. Приклад: 22:00-08:00');
        return;
    }

    const start = m[1];
    const end = m[2];

    pendingQuietByChatId.delete(ctx.chat.id);

    const prefs = getPrefs(ctx.chat.id);
    const nextPrefs = updatePrefs(ctx.chat.id, { quiet: { ...prefs.quiet, start, end } });

    await ctx.reply(
        `✅ Збережено. Тиша: ${nextPrefs.quiet.enabled ? 'увімкнено' : 'вимкнено'} (${nextPrefs.quiet.start}–${nextPrefs.quiet.end})`
    );
    await ctx.reply(buildSettingsText(nextPrefs), notifySettingsKeyboard(nextPrefs));
});

registerManageQueuesHandlers(bot);

const outagesChangeNotifier = createOutagesChangeNotifier({
    bot,
    listAllSubscriptions,
});

const stopOutagesJob = startOutagesJob({
    intervalMs: 15 * 60 * 1000,
    runOnStart: true,
    onError: (e) => {
        console.error('[outages-job] error:', e);
    },
    onChange: async (res) => {
        try {
            await outagesChangeNotifier.handleJobResult(res);
        } catch (e) {
            console.error('[outages-job] handleJobResult error:', e);
        }
    },
});

const notifier = createNotifier({
    bot,
    listAllSubscriptions,
});

notifier.start();

bot.launch();

process.once('SIGINT', () => {
    stopOutagesJob();
    bot.stop('SIGINT');
});
process.once('SIGTERM', () => {
    stopOutagesJob();
    bot.stop('SIGTERM');
});
