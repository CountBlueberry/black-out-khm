# Power Outage Alert Bot (Khmelnytskyi, Ukraine)

Telegram bot that tracks and notifies users about scheduled power outages
based on the official data published by **АТ «Хмельницькобленерго»**.

The bot allows users to select their power queue (підчерга), view outage schedules
for today and tomorrow, and receive configurable notifications.

Source page:
https://hoe.com.ua/page/pogodinni-vidkljuchennja

---

## Requirements

- **Node.js** v18+
- **npm**
- Telegram bot token from **@BotFather**

---

## Project structure

```

black-out-khm/
├── src/
│   ├── bot.js                     # Bot entry point (controller)
│   ├── db/
│   │   ├── db.js                  # DB initialization & migrations
│   │   ├── cacheRepo.js           # Key-value cache (fingerprints, flags)
│   │   ├── outagesSnapshotRepo.js # Outage snapshots per date & queue
│   │   ├── prefsRepo.js           # User notification preferences
│   │   ├── sentEventsRepo.js      # Deduplication of sent notifications
│   │   └── subscriptionsRepo.js  # User queue subscriptions
│   ├── handlers/
│   │   ├── manageQueues.js        # UI logic for managing queues
│   │   └── showDay.js             # Show outages for today / tomorrow
│   ├── notifications/
│   │   └── notifier.js            # Time-based outage notifications
│   ├── outages/
│   │   ├── fingerprint.js         # Page fingerprinting
│   │   ├── outages.js             # HTML parsing logic
│   │   ├── provider.js            # Schedule provider (DB / live)
│   │   ├── provider.mock.js       # Mock provider for testing
│   │   └── refresher.js           # Periodic refresh & diff detection
│   ├── services/
│   │   └── outagesChangeNotifier.js # Notifications on schedule changes
│   ├── ui/
│   │   ├── formatters.js          # Text formatting helpers
│   │   └── keyboards.js           # Telegram inline keyboards
│   └── utils/
│       ├── hash.js                # Hash utilities
│       ├── outagesFormat.js       # Outage formatting helpers
│       └── quietHours.js          # Quiet-hours logic (Europe/Kyiv)
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

### Linux / macOS

```bash
export BOT_TOKEN="<YOUR_BOT_TOKEN>"
node src/bot.js
```

---

## Start the bot

```bash
node src/bot.js
```

Recommended for production:

```bash
npm install -g pm2
pm2 start src/bot.js --name blackout-bot
pm2 save
pm2 startup
```

---

## Features

* Queue (підчерга) subscription management
* View outages for **today** and **tomorrow**
* Notifications:

    * Before outage (configurable lead time)
    * At outage start
    * At outage end
* Quiet hours (Do Not Disturb)
* Automatic detection of schedule changes
* Notifications when outages appear or change
* Deduplication to avoid repeated alerts

---

## Notes

* All times are processed in **Europe/Kyiv** timezone
* Data is fetched from the official provider website
* The schedule may change multiple times per day
* If the website markup changes, the parser may need updates

---

## Troubleshooting

### `BOT_TOKEN is not set`

Make sure the environment variable is set before running the bot.

### `Cannot find module ...`

Run:

```bash
npm install
```

### No outages shown

* The website may be temporarily unavailable
* The schedule may not be published yet
* The page structure may have changed

---

## Disclaimer

This bot is provided for informational purposes only and relies on publicly
available data from **АТ «Хмельницькобленерго»**.
Always follow official announcements.

```
```
