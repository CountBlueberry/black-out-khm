
# Power Outage Alert Bot (Khmelnytskyi, Ukraine)

This Telegram bot parses the official outage schedule page from **АТ «Хмельницькобленерго»** and can notify users about power outage times for a selected queue (підчерга).

Source page:
https://hoe.com.ua/page/pogodinni-vidkljuchennja

---

## Requirements

- **Node.js** v18+ (recommended)
- **npm**
- Telegram bot token from **@BotFather**

---

## Project structure

`bot.js` is located inside the `src` folder:

```

black-out-telegram-bot/
├── src/
│ ├── bot.js
│ ├── db/
│ │ ├── db.js
│ │ ├── prefsRepo.js
│ │ ├── sentEventsRepo.js
│ │ └── subscriptionsRepo.js
│ ├── handlers/
│ │ ├── manageQueues.js
│ │ └── showDay.js
│ ├── notifications/
│ │ └── notifier.js
│ ├── outages/
│ │ ├── outages.js
│ │ ├── provider.js
│ │ └── provider.mock.js
│ └── ui/
│ ├── formatters.js
│ └── keyboards.js
├── data.sqlite
├── data.sqlite-shm
├── data.sqlite-wal
├── package.json
├── package-lock.json
└── README.md

````

---

## Install dependencies

From the project root:

```bash
npm install
````

---

## Configure BOT_TOKEN

The bot reads the token from the environment variable `BOT_TOKEN`.

### PowerShell (Windows)

```powershell
$env:BOT_TOKEN="<YOUR_BOT_TOKEN>"
node src/bot.js
```

### CMD (Windows)

```cmd
set BOT_TOKEN=<YOUR_BOT_TOKEN>
node src\bot.js
```

### Linux / macOS (bash/zsh)

```bash
export BOT_TOKEN="<YOUR_BOT_TOKEN>"
node src/bot.js
```

---

## Start the bot

From the project root:

```bash
node src/bot.js
```

---

## Notes

* The bot fetches and parses data directly from the official website.
* The schedule may change multiple times per day.
* If the page structure changes, the parser may require updates.

---

## Troubleshooting

### `BOT_TOKEN` is not set

Make sure you exported / set the environment variable before running the bot.

### `Cannot find module ...`

Run:

```bash
npm install
```

### No schedules returned

The website might be down, or the page markup may have changed.

---

## Disclaimer

This bot is for informational purposes only and relies on publicly available data.
Always follow official updates from **АТ «Хмельницькобленерго»**.

```
::contentReference[oaicite:0]{index=0}
```
