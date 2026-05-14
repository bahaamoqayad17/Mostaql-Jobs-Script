const fs = require('node:fs/promises');
const path = require('node:path');
const cheerio = require('cheerio');
const notifier = require('node-notifier');

const DEFAULT_URL = 'https://mostaql.com/projects?category=development,ai-machine-learning&sort=latest';
const args = new Set(process.argv.slice(2));

const config = {
  url: process.env.MOSTAQL_URL || DEFAULT_URL,
  intervalSeconds: Math.max(30, Number(process.env.MOSTAQL_INTERVAL_SECONDS || 60)),
  stateFile: path.resolve(process.cwd(), process.env.MOSTAQL_STATE_FILE || 'seen-jobs.json'),
  notifyInitial: args.has('--notify-initial') || process.env.MOSTAQL_NOTIFY_INITIAL === 'true',
  once: args.has('--once'),
  dryRun: args.has('--dry-run'),
};

async function readState() {
  try {
    const raw = await fs.readFile(config.stateFile, 'utf8');
    const state = JSON.parse(raw);

    return {
      existed: true,
      seenIds: Array.isArray(state.seenIds) ? state.seenIds : [],
      lastCheckedAt: state.lastCheckedAt || null,
    };
  } catch (error) {
    if (error.code === 'ENOENT') {
      return { existed: false, seenIds: [], lastCheckedAt: null };
    }

    throw error;
  }
}

async function writeState(seenIds) {
  const state = {
    lastCheckedAt: new Date().toISOString(),
    seenIds: seenIds.slice(0, 200),
  };

  const tmpFile = `${config.stateFile}.tmp`;
  await fs.writeFile(tmpFile, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  await fs.rename(tmpFile, config.stateFile);
}

async function fetchProjectsPage() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(config.url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; MostaqlJobNotifier/1.0; +https://mostaql.com)',
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'ar,en;q=0.8',
        'Cache-Control': 'no-cache',
      },
    });

    if (!response.ok) {
      throw new Error(`Mostaql returned HTTP ${response.status}`);
    }

    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeText(text) {
  return text.replace(/\s+/g, ' ').trim();
}

function projectIdFromUrl(url) {
  const match = url.match(/\/(?:project|go)\/(\d+)/);
  return match ? match[1] : url;
}

function parseJobs(html) {
  const $ = cheerio.load(html);

  return $('tr.project-row')
    .map((_, row) => {
      const $row = $(row);
      const $titleLink = $row.find('.card--title h2 a').first();
      const url = $titleLink.attr('href');
      const title = normalizeText($titleLink.text());

      if (!url || !title) {
        return null;
      }

      const metaItems = $row
        .find('.project__meta li')
        .map((_, item) => normalizeText($(item).text()))
        .get();

      return {
        id: projectIdFromUrl(url),
        title,
        url,
        author: normalizeText($row.find('.project__meta bdi').first().text()),
        postedAt: $row.find('time').first().attr('datetime') || '',
        postedText: normalizeText($row.find('time').first().text()),
        bids: metaItems.find((item) => item.includes('\u0639\u0631\u0636')) || '',
        brief: normalizeText($row.find('.project__brief a').first().text()),
      };
    })
    .get()
    .filter(Boolean);
}

function logJob(prefix, job) {
  const extra = [job.postedText, job.bids].filter(Boolean).join(' | ');
  console.log(`${prefix} ${job.title}`);
  console.log(`   ${job.url}`);

  if (extra) {
    console.log(`   ${extra}`);
  }
}

async function notifyJob(job) {
  logJob('[new]', job);

  if (config.dryRun) {
    return;
  }

  const messageParts = [job.postedText, job.bids, job.brief].filter(Boolean);
  const message = messageParts.join(' | ').slice(0, 250);

  await new Promise((resolve) => {
    notifier.notify(
      {
        title: `Mostaql: ${job.title}`.slice(0, 120),
        message: message || job.url,
        open: job.url,
        sound: true,
        wait: false,
      },
      (error) => {
        if (error) {
          console.warn(`[warn] Could not show desktop notification: ${error.message}`);
        }

        resolve();
      },
    );
  });
}

async function checkOnce() {
  const state = await readState();
  const knownIds = new Set(state.seenIds);
  const html = await fetchProjectsPage();
  const jobs = parseJobs(html);

  if (jobs.length === 0) {
    throw new Error('No project rows were found. The page layout may have changed.');
  }

  const newJobs = jobs.filter((job) => !knownIds.has(job.id));
  const shouldNotify = state.existed || config.notifyInitial;

  if (newJobs.length === 0) {
    console.log(`[ok] No new jobs. Checked ${jobs.length} visible projects at ${new Date().toLocaleString()}.`);
  } else if (!shouldNotify) {
    console.log(`[first run] Saved ${jobs.length} current jobs. Future checks will notify only new jobs.`);
  } else {
    console.log(`[ok] Found ${newJobs.length} new job(s).`);

    for (const job of [...newJobs].reverse()) {
      await notifyJob(job);
    }
  }

  if (config.dryRun) {
    console.log('[dry-run] State file was not changed.');
    return;
  }

  const updatedSeenIds = [...new Set([...jobs.map((job) => job.id), ...state.seenIds])];
  await writeState(updatedSeenIds);
}

async function main() {
  console.log('Mostaql job notifier');
  console.log(`URL: ${config.url}`);
  console.log(`State: ${config.stateFile}`);

  if (config.dryRun) {
    console.log('Mode: dry run, desktop notifications are disabled.');
  }

  if (config.once) {
    await checkOnce();
    return;
  }

  console.log(`Polling every ${config.intervalSeconds} seconds. Press Ctrl+C to stop.`);

  let running = false;

  async function runCheck() {
    if (running) {
      console.log('[skip] Previous check is still running.');
      return;
    }

    running = true;

    try {
      await checkOnce();
    } catch (error) {
      console.error(`[error] ${error.message}`);
    } finally {
      running = false;
    }
  }

  await runCheck();
  setInterval(runCheck, config.intervalSeconds * 1000);
}

main().catch((error) => {
  console.error(`[fatal] ${error.message}`);
  process.exitCode = 1;
});
