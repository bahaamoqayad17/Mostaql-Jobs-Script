# Mostaql Job Notifier

A small Node.js script that watches this filtered Mostaql projects page:

```text
https://mostaql.com/projects?category=development,ai-machine-learning&sort=latest
```

It checks for newly posted jobs, remembers projects it has already seen in `seen-jobs.json`, and sends a desktop notification for each new project.

## Setup

```bash
npm install
```

## Run

```bash
npm start
```

On the first run, the script saves the currently visible jobs without notifying you. After that, it notifies only for jobs that appear later.

To test the parser and print current jobs without sending desktop notifications or changing `seen-jobs.json`:

```bash
npm run dry-run
```

To run only one check:

```bash
npm run once
```

## Options

You can change settings with environment variables:

```bash
MOSTAQL_INTERVAL_SECONDS=120 npm start
MOSTAQL_NOTIFY_INITIAL=true npm start
MOSTAQL_URL="https://mostaql.com/projects?category=development,ai-machine-learning&sort=latest" npm start
MOSTAQL_STATE_FILE="./seen-jobs.json" npm start
```

On Windows PowerShell:

```powershell
$env:MOSTAQL_INTERVAL_SECONDS = "120"
npm start
```

The minimum polling interval is 30 seconds. A slower interval, such as 60-120 seconds, is friendlier to Mostaql and is usually enough for job alerts.
