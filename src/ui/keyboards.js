const { Markup } = require('telegraf');

const ALL_QUEUES = [
    '1.1', '1.2',
    '2.1', '2.2',
    '3.1', '3.2',
    '4.1', '4.2',
    '5.1', '5.2',
    '6.1', '6.2',
];

const mainMenu = () => Markup.inlineKeyboard([
    [Markup.button.callback('Сьогодні', 'SHOW:today'), Markup.button.callback('Завтра', 'SHOW:tomorrow')],
    [
        Markup.button.callback('Мої черги', 'SHOW:myqueues'),
        Markup.button.callback('Керувати чергами', 'MANAGE_QUEUES')
    ],
    [
        Markup.button.callback('⏳ Попередження', 'OPEN_LEAD'),
        Markup.button.callback('⚙️ Налаштування', 'OPEN_SETTINGS')
    ],
    [Markup.button.callback('💛 Підтримати розробника', 'OPEN_DONATE')],
    [Markup.button.url('🇺🇦 Донат на ЗСУ', 'https://send.monobank.ua/jar/2JbpBYkhMv')]
]);

const refreshKeyboard = (day) => Markup.inlineKeyboard([
    [Markup.button.callback('Оновити', `REFRESH:${day}`)],
    [Markup.button.callback('Сьогодні', 'SHOW:today'), Markup.button.callback('Завтра', 'SHOW:tomorrow')],
    [
        Markup.button.callback('Мої черги', 'SHOW:myqueues'),
        Markup.button.callback('Керувати чергами', 'MANAGE_QUEUES')
    ],
    [
        Markup.button.callback('⏳ Попередження', 'OPEN_LEAD'),
        Markup.button.callback('⚙️ Налаштування', 'OPEN_SETTINGS')
    ],
    [Markup.button.callback('💛 Підтримати розробника', 'OPEN_DONATE')],
    [Markup.button.url('🇺🇦 Донат на ЗСУ', 'https://send.monobank.ua/jar/2JbpBYkhMv')]
]);

const queuesKeyboard = (selectedQueues) => {
    const set = new Set(selectedQueues);

    const rows = [];
    for (let i = 0; i < ALL_QUEUES.length; i += 2) {
        const a = ALL_QUEUES[i];
        const b = ALL_QUEUES[i + 1];

        const aLabel = `${set.has(a) ? '✅' : '☐'} ${a}`;
        const bLabel = `${set.has(b) ? '✅' : '☐'} ${b}`;

        rows.push([
            Markup.button.callback(aLabel, `TOGGLE:${a}`),
            Markup.button.callback(bLabel, `TOGGLE:${b}`),
        ]);
    }

    rows.push([Markup.button.callback('Очистити', 'CLEAR_QUEUES'), Markup.button.callback('Готово', 'DONE_QUEUES')]);
    rows.push([Markup.button.callback('Назад', 'BACK_MAIN')]);

    return Markup.inlineKeyboard(rows);
};

const leadKeyboard = (currentLead, backAction = 'BACK_MAIN') => Markup.inlineKeyboard([
    [
        Markup.button.callback(`${currentLead === 5 ? '✅ ' : ''}5 хв`, 'LEAD:5'),
        Markup.button.callback(`${currentLead === 15 ? '✅ ' : ''}15 хв`, 'LEAD:15'),
    ],
    [
        Markup.button.callback(`${currentLead === 30 ? '✅ ' : ''}30 хв`, 'LEAD:30'),
        Markup.button.callback(`${currentLead === 60 ? '✅ ' : ''}60 хв`, 'LEAD:60'),
    ],
    [Markup.button.callback('Назад', backAction)],
]);

const notifySettingsKeyboard = (prefs) => {
    const b = prefs.notifyBefore ? '✅' : '☐';
    const s = prefs.notifyStart ? '✅' : '☐';
    const e = prefs.notifyEnd ? '✅' : '☐';

    return Markup.inlineKeyboard([
        [Markup.button.callback(`⏳ Попереджати (${prefs.leadMinutes} хв)`, 'OPEN_LEAD')],
        [
            Markup.button.callback(`${b} До відключення`, 'TOGGLE_NOTIFY:before'),
            Markup.button.callback(`${s} Початок`, 'TOGGLE_NOTIFY:start'),
        ],
        [Markup.button.callback(`${e} Кінець`, 'TOGGLE_NOTIFY:end')],
        [Markup.button.callback(`🌙 Тиша: ${prefs.quiet.enabled ? 'увімкн.' : 'вимкн.'} (${prefs.quiet.start}-${prefs.quiet.end})`, 'OPEN_QUIET')],
        [Markup.button.callback('Назад', 'BACK_MAIN')],
    ]);
};

const quietKeyboard = (prefs) => {
    const on = prefs.quiet.enabled ? '✅' : '☐';
    const off = !prefs.quiet.enabled ? '✅' : '☐';

    return Markup.inlineKeyboard([
        [Markup.button.callback(`${on} Увімкнути`, 'QUIET_ON'), Markup.button.callback(`${off} Вимкнути`, 'QUIET_OFF')],
        [
            Markup.button.callback('22:00–08:00', 'QUIET_PRESET:22:00-08:00'),
            Markup.button.callback('23:00–07:00', 'QUIET_PRESET:23:00-07:00'),
        ],
        [
            Markup.button.callback('00:00–08:00', 'QUIET_PRESET:00:00-08:00'),
            Markup.button.callback('21:00–09:00', 'QUIET_PRESET:21:00-09:00'),
        ],
        [Markup.button.callback('✍️ Ввести вручну', 'QUIET_CUSTOM')],
        [Markup.button.callback('Назад', 'OPEN_SETTINGS')],
    ]);
};


module.exports = {
    mainMenu,
    refreshKeyboard,
    queuesKeyboard,
    leadKeyboard,
    notifySettingsKeyboard,
    quietKeyboard,
    ALL_QUEUES,
};
