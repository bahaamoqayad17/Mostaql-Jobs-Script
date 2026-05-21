# Job Notifier

A small Node.js script that watches a filtered Mostaql projects page and the latest Baaeed remote jobs page:

```text
https://mostaql.com/projects?category=development,ai-machine-learning&sort=latest
https://baaeed.com/remote-jobs?sort=latest
```

It checks for newly posted jobs, remembers jobs it has already seen in `seen-jobs.json`, and sends mobile push notifications through ntfy. Desktop notifications can be enabled when running on a machine with a desktop session.

## Setup

```bash
npm install
```

Edit `.env` to configure the watcher. The main setting for mobile notifications is:

```text
NTFY_TOPIC=mostaql-jobs-yourname-9f4c2a81
```

## Run

```bash
npm start
```

On the first run for each source, the script saves the currently visible jobs without notifying you. After that, it notifies only for jobs that appear later.

To test the parser and print current jobs without sending desktop notifications or changing `seen-jobs.json`:

```bash
npm run dry-run
```

To run only one check:

```bash
npm run once
```

## Mobile notifications

This script supports mobile notifications through [ntfy](https://ntfy.sh/), a simple push notification service.

1. Install the ntfy app on your phone.
   - Android: search for `ntfy` in Google Play or F-Droid.
   - iPhone: search for `ntfy` in the App Store.
2. Pick a private topic name. Treat it like a password because anyone who knows it can publish to it. Example:

```text
mostaql-jobs-yourname-9f4c2a81
```

3. Subscribe to that same topic in the ntfy mobile app.
4. Put the topic in `.env`:

```text
NTFY_TOPIC=mostaql-jobs-yourname-9f4c2a81
```

5. Send a test:

```powershell
npm run test-mobile
```

6. If the test arrives on your phone, start the watcher:

```powershell
npm start
```

When a new Mostaql or Baaeed job is found, your phone notification will include a tap-to-open link for the job.

## Options

You can change settings in `.env`:

```text
MOSTAQL_INTERVAL_SECONDS=120
MOSTAQL_NOTIFY_INITIAL=true
MOSTAQL_URL=https://mostaql.com/projects?category=development,ai-machine-learning&sort=latest
BAAEED_URL=https://baaeed.com/remote-jobs?sort=latest
MOSTAQL_STATE_FILE=seen-jobs.json
MOSTAQL_DESKTOP_NOTIFICATIONS=false
NTFY_TOPIC=mostaql-jobs-yourname-9f4c2a81
NTFY_SERVER=https://ntfy.sh
NTFY_PRIORITY=4
```

You can also override any setting with environment variables:

```bash
MOSTAQL_INTERVAL_SECONDS=120 npm start
MOSTAQL_NOTIFY_INITIAL=true npm start
MOSTAQL_URL="https://mostaql.com/projects?category=development,ai-machine-learning&sort=latest" npm start
BAAEED_URL="https://baaeed.com/remote-jobs?sort=latest" npm start
MOSTAQL_STATE_FILE="./seen-jobs.json" npm start
MOSTAQL_DESKTOP_NOTIFICATIONS=true npm start
NTFY_TOPIC="mostaql-jobs-yourname-9f4c2a81" npm start
NTFY_SERVER="https://ntfy.sh" npm start
NTFY_PRIORITY=4 npm start
```

On Windows PowerShell:

```powershell
$env:MOSTAQL_INTERVAL_SECONDS = "120"
npm start
```

The minimum polling interval is 30 seconds. A slower interval, such as 60-120 seconds, is friendlier to Mostaql and is usually enough for job alerts.
