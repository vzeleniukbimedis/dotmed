const firecrawlClient = require('./firecrawlClient');
const jobStore = require('./jobStore');
const logger = require('./logger').child({ module: 'jobRunner' });

const CONCURRENCY = 1;
const PAUSE_POLL_MS = 500;

// jobId -> { paused: boolean, stopped: boolean }
const controls = new Map();

// Only one job actively scrapes at a time — running several jobs in
// parallel would hammer dotmed.com with concurrent requests and undo the
// 429 rate-limit fix. Jobs beyond the active one wait here in creation order.
const queue = []; // [{ job, items }]
let activeJobId = null;
let activeJob = null; // the actual job object saveJob() reads from — see stopJob

function getControl(jobId) {
  if (!controls.has(jobId)) controls.set(jobId, { paused: false, stopped: false });
  return controls.get(jobId);
}

function getRunState(jobId) {
  if (activeJobId === jobId) {
    const c = controls.get(jobId);
    if (c?.stopped) return 'stopped';
    if (c?.paused) return 'paused';
    return 'running';
  }
  if (queue.some((q) => q.job.id === jobId)) return 'queued';
  return 'idle';
}

function getQueuePosition(jobId) {
  const idx = queue.findIndex((q) => q.job.id === jobId);
  return idx === -1 ? null : idx + 1;
}

function pauseJob(jobId) {
  if (activeJobId !== jobId) return; // not running yet — nothing to pause
  getControl(jobId).paused = true;
}

function unpauseJob(jobId) {
  if (activeJobId !== jobId) return;
  const c = controls.get(jobId);
  if (c) c.paused = false;
}

// Persists the stop to the DB (see jobStore.markPendingAsStopped) — without
// this, a stopped job's leftover 'pending' items are indistinguishable from
// a crash-interrupted job after a restart, and would get wrongly auto-resumed.
// Also mirrors the change onto the in-memory job object still held by the
// active processItem()/runItems() closure — saveJob() always rewrites every
// item from that in-memory array, so without this the next save (e.g. when
// the currently-scraping item finishes) would clobber the DB's 'stopped'
// status back to the stale in-memory 'pending'.
async function stopJob(jobId) {
  const queuedIdx = queue.findIndex((q) => q.job.id === jobId);
  if (queuedIdx !== -1) {
    queue.splice(queuedIdx, 1); // cancel before it ever starts
    await jobStore.markPendingAsStopped(jobId);
    return;
  }
  if (activeJobId !== jobId) return;
  const c = getControl(jobId);
  c.stopped = true;
  c.paused = false;
  if (activeJob) {
    for (const item of activeJob.items) {
      if (item.status === 'pending') item.status = 'stopped';
    }
  }
  await jobStore.markPendingAsStopped(jobId);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitWhilePaused(jobId) {
  const c = getControl(jobId);
  while (c.paused && !c.stopped) {
    await sleep(PAUSE_POLL_MS);
  }
}

function progressLabel({ stage, attempt, maxAttempts }) {
  if (stage === 'rotating_ip') return `Заблоковано — міняємо IP (спроба ${attempt}/${maxAttempts})`;
  if (stage === 'retrying') return `Помилка з'єднання — повторюємо (спроба ${attempt}/${maxAttempts})`;
  return attempt > 1 ? `Скануємо, спроба ${attempt}/${maxAttempts}` : 'Скануємо';
}

async function processItem(job, item) {
  item.status = 'running';
  item.startedAt = new Date().toISOString();
  item.stageLabel = 'Скануємо';
  await jobStore.saveJob(job);

  try {
    item.data = await firecrawlClient.scrapeListing(item.url, (progress) => {
      item.stageLabel = progressLabel(progress);
      jobStore.saveJob(job).catch((err) => logger.error({ jobId: job.id, url: item.url, err }, 'progress save failed'));
    });
    item.status = 'success';
    delete item.error;
    delete item.stageLabel;
  } catch (err) {
    item.status = 'error';
    item.error = err.message;
    delete item.stageLabel;
    logger.error({ jobId: job.id, url: item.url, err }, 'scrape failed');
  }
  item.finishedAt = new Date().toISOString();
  await jobStore.saveJob(job);
}

async function runItems(job, items) {
  const control = getControl(job.id);
  control.stopped = false;

  let next = 0;
  async function worker() {
    while (next < items.length) {
      if (control.stopped) return;
      await waitWhilePaused(job.id);
      if (control.stopped) return;
      const item = items[next++];
      if (!item) return;
      await processItem(job, item);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker));
  controls.delete(job.id);
}

function enqueue(job, items) {
  queue.push({ job, items });
  processQueue();
}

async function processQueue() {
  if (activeJobId !== null || queue.length === 0) return;
  const { job, items } = queue.shift();
  activeJobId = job.id;
  activeJob = job;
  try {
    await runItems(job, items);
  } catch (err) {
    logger.error({ jobId: job.id, err }, 'queued job run failed');
  } finally {
    activeJobId = null;
    activeJob = null;
    processQueue();
  }
}

function runJob(job) {
  enqueue(job, job.items.filter((i) => i.status === 'pending'));
}

function resumeJob(job) {
  enqueue(job, job.items.filter((i) => i.status === 'pending' || i.status === 'error' || i.status === 'stopped'));
}

module.exports = { runJob, resumeJob, pauseJob, unpauseJob, stopJob, getRunState, getQueuePosition };
