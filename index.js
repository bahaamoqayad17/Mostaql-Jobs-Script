const fs = require('node:fs/promises');
const path = require('node:path');
const cheerio = require('cheerio');
const notifier = require('node-notifier');
require('dotenv').config({ quiet: true });

const DEFAULT_MOSTAQL_URL = 'https://mostaql.com/projects?category=development,ai-machine-learning&sort=latest';
const DEFAULT_BAAEED_URL = 'https://baaeed.com/remote-jobs?sort=latest';
const args = new Set(process.argv.slice(2));

const config = {
  mostaqlUrl: process.env.MOSTAQL_URL || DEFAULT_MOSTAQL_URL,
  baaeedUrl: process.env.BAAEED_URL || DEFAULT_BAAEED_URL,
  intervalSeconds: Math.max(30, Number(process.env.MOSTAQL_INTERVAL_SECONDS || 60)),
  stateFile: path.resolve(process.cwd(), process.env.MOSTAQL_STATE_FILE || 'seen-jobs.json'),
  ntfyTopic: process.env.NTFY_TOPIC || '',
  ntfyServer: (process.env.NTFY_SERVER || 'https://ntfy.sh').replace(/\/+$/, ''),
  ntfyPriority: Math.min(5, Math.max(1, Number(process.env.NTFY_PRIORITY || 4) || 4)),
  desktopNotifications: process.env.MOSTAQL_DESKTOP_NOTIFICATIONS === 'true',
  notifyInitial: args.has('--notify-initial') || process.env.MOSTAQL_NOTIFY_INITIAL === 'true',
  once: args.has('--once'),
  dryRun: args.has('--dry-run'),
  testMobile: args.has('--test-mobile'),
};

const DEFAULT_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml',
  'Accept-Language': 'ar,en;q=0.8',
  'Cache-Control': 'no-cache',
};

const sources = [
  {
    id: 'mostaql',
    name: 'Mostaql',
    url: config.mostaqlUrl,
    parseJobs: parseMostaqlJobs,
    emptyMessage: 'No Mostaql project rows were found. The page layout may have changed.',
    legacyIds: true,
  },
  {
    id: 'baaeed',
    name: 'Baaeed',
    url: config.baaeedUrl,
    parseJobs: parseBaaeedJobs,
    emptyMessage: 'No Baaeed job cards were found. The page layout may have changed.',
  },
];

async function readState() {
  try {
    const raw = await fs.readFile(config.stateFile, 'utf8');
    const state = JSON.parse(raw);
    const seenIds = Array.isArray(state.seenIds) ? state.seenIds : [];
    const initializedSources = Array.isArray(state.initializedSources)
      ? state.initializedSources
      : ['mostaql'];

    return {
      existed: true,
      seenIds,
      initializedSources,
      lastCheckedAt: state.lastCheckedAt || null,
    };
  } catch (error) {
    if (error.code === 'ENOENT') {
      return { existed: false, seenIds: [], initializedSources: [], lastCheckedAt: null };
    }

    throw error;
  }
}

async function writeState(seenIds, initializedSources) {
  const state = {
    lastCheckedAt: new Date().toISOString(),
    initializedSources: [...initializedSources].sort(),
    seenIds: seenIds.slice(0, 500),
  };

  const tmpFile = `${config.stateFile}.tmp`;
  await fs.writeFile(tmpFile, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  await fs.rename(tmpFile, config.stateFile);
}

async function fetchJobsPage(source) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(source.url, {
      signal: controller.signal,
      headers: DEFAULT_HEADERS,
    });

    if (!response.ok) {
      throw new Error(`${source.name} returned HTTP ${response.status}`);
    }

    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeText(text) {
  return (text || '').replace(/\s+/g, ' ').trim();
}

function projectIdFromUrl(url) {
  const match = url.match(/\/(?:project|go)\/(\d+)/);
  return match ? match[1] : url;
}

function baaeedJobIdFromUrl(url) {
  try {
    const parsedUrl = new URL(url, 'https://baaeed.com');
    return parsedUrl.pathname.replace(/\/+$/, '');
  } catch {
    return url;
  }
}

function scopedJobId(sourceId, jobId) {
  return `${sourceId}:${jobId}`;
}

function parseMostaqlJobs(html) {
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

function parseBaaeedJobs(html) {
  const $ = cheerio.load(html);

  return $('section.baaeed-card')
    .map((_, card) => {
      const $card = $(card);
      const $titleLink = $card.find('h3.card-title a[href*="/remote-jobs/"]').first();
      const url = $titleLink.attr('href');
      const title = normalizeText($titleLink.text());

      if (!url || !title) {
        return null;
      }

      const metaItems = $card
        .find('.baaeed-list__meta-items li')
        .map((_, item) => normalizeText($(item).text()))
        .get();
      const $time = $card.find('time').first();

      return {
        id: baaeedJobIdFromUrl(url),
        title,
        url,
        company: metaItems[0] || '',
        category: metaItems[1] || '',
        postedAt: $time.attr('datetime') || '',
        postedText: normalizeText($time.text()),
        brief: normalizeText($card.find('.card-brief a.details-url').first().text()),
      };
    })
    .get()
    .filter(Boolean);
}

function jobDetails(job) {
  return [job.postedText, job.bids, job.company, job.category].filter(Boolean);
}

function logJob(prefix, job) {
  const extra = jobDetails(job).join(' | ');
  console.log(`${prefix} ${job.sourceName}: ${job.title}`);
  console.log(`   ${job.url}`);

  if (extra) {
    console.log(`   ${extra}`);
  }
}

function notificationMessage(job, limit = 250) {
  const messageParts = [...jobDetails(job), job.brief].filter(Boolean);
  return messageParts.join(' | ').slice(0, limit);
}

async function notifyDesktop(job) {
  await new Promise((resolve) => {
    notifier.notify(
      {
        title: `${job.sourceName}: ${job.title}`.slice(0, 120),
        message: notificationMessage(job) || job.url,
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

async function notifyMobile(job) {
  if (!config.ntfyTopic) {
    return;
  }

  const response = await fetch(config.ntfyServer, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      topic: config.ntfyTopic,
      title: `${job.sourceName}: ${job.title}`.slice(0, 120),
      message: notificationMessage(job, 900) || job.url,
      priority: config.ntfyPriority,
      tags: ['briefcase', job.sourceId],
      click: job.url,
      actions: [
        {
          action: 'view',
          label: 'Open job',
          url: job.url,
          clear: true,
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`ntfy returned HTTP ${response.status}`);
  }

  console.log('[mobile] Sent ntfy notification.');
}

async function notifyJob(job) {
  logJob('[new]', job);

  if (config.dryRun) {
    return;
  }

  const notifications = [notifyMobile(job)];

  if (config.desktopNotifications) {
    notifications.push(notifyDesktop(job));
  }

  const results = await Promise.allSettled(notifications);

  for (const result of results) {
    if (result.status === 'rejected') {
      console.warn(`[warn] Notification failed: ${result.reason.message}`);
    }
  }
}

async function checkOnce() {
  const state = await readState();
  const knownIds = new Set(state.seenIds);
  const initializedSources = new Set(state.initializedSources);
  const checkedSourceIds = [];
  const currentSeenIds = [];
  const errors = [];

  for (const source of sources) {
    try {
      const html = await fetchJobsPage(source);
      const jobs = source.parseJobs(html).map((job) => ({
        ...job,
        rawId: job.id,
        id: scopedJobId(source.id, job.id),
        sourceId: source.id,
        sourceName: source.name,
      }));

      if (jobs.length === 0) {
        throw new Error(source.emptyMessage);
      }

      const newJobs = jobs.filter((job) => {
        const knownScopedId = knownIds.has(job.id);
        const knownLegacyId = source.legacyIds && knownIds.has(job.rawId);
        return !knownScopedId && !knownLegacyId;
      });
      const shouldNotify = initializedSources.has(source.id) || config.notifyInitial;

      if (newJobs.length === 0) {
        console.log(`[ok] ${source.name}: No new jobs. Checked ${jobs.length} visible jobs at ${new Date().toLocaleString()}.`);
      } else if (!shouldNotify) {
        console.log(`[first run] ${source.name}: Saved ${jobs.length} current jobs. Future checks will notify only new jobs.`);
      } else {
        console.log(`[ok] ${source.name}: Found ${newJobs.length} new job(s).`);

        for (const job of [...newJobs].reverse()) {
          await notifyJob(job);
        }
      }

      checkedSourceIds.push(source.id);
      currentSeenIds.push(...jobs.map((job) => job.id));
    } catch (error) {
      console.error(`[error] ${source.name}: ${error.message}`);
      errors.push(error);
    }
  }

  if (checkedSourceIds.length === 0) {
    throw new Error(errors.map((error) => error.message).join(' | '));
  }

  if (config.dryRun) {
    console.log('[dry-run] State file was not changed.');
    return;
  }

  for (const sourceId of checkedSourceIds) {
    initializedSources.add(sourceId);
  }

  const updatedSeenIds = [...new Set([...currentSeenIds, ...state.seenIds])];
  await writeState(updatedSeenIds, initializedSources);
}

async function main() {
  console.log('Job notifier');
  console.log('Sources:');
  for (const source of sources) {
    console.log(`  ${source.name}: ${source.url}`);
  }
  console.log(`State: ${config.stateFile}`);
  console.log(`Mobile: ${config.ntfyTopic ? `${config.ntfyServer}/${config.ntfyTopic}` : 'disabled'}`);
  console.log(`Desktop: ${config.desktopNotifications ? 'enabled' : 'disabled'}`);

  if (config.dryRun) {
    console.log('Mode: dry run, notifications are disabled.');
  }

  if (config.testMobile) {
    if (!config.ntfyTopic) {
      throw new Error('Set NTFY_TOPIC before running --test-mobile.');
    }

    await notifyMobile({
      sourceId: 'test',
      sourceName: 'Job notifier',
      title: 'Test mobile notification',
      url: config.mostaqlUrl,
      postedText: 'Mobile notification test',
      bids: '',
      brief: 'Your Mostaql and Baaeed job notifier can reach your phone.',
    });
    console.log('[ok] Sent a test mobile notification.');
    return;
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
