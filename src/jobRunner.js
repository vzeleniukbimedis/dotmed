const { scrapeListing } = require('./firecrawlClient');
const jobStore = require('./jobStore');
const logger = require('./logger').child({ module: 'jobRunner' });

const CONCURRENCY = 1;
const PAUSE_POLL_MS = 500;

// jobId -> { paused: boolean, stopped: boolean }
const controls = new Map();

function getControl(jobId) {
  if (!controls.has(jobId)) controls.set(jobId, { paused: false, stopped: false });
  return controls.get(jobId);
}

function getRunState(jobId) {
  const c = controls.get(jobId);
  if (!c) return 'idle';
  if (c.stopped) return 'stopped';
  if (c.paused) return 'paused';
  return 'running';
}

function pauseJob(jobId) {
  getControl(jobId).paused = true;
}

function unpauseJob(jobId) {
  const c = controls.get(jobId);
  if (c) c.paused = false;
}

function stopJob(jobId) {
  const c = getControl(jobId);
  c.stopped = true;
  c.paused = false;
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
    item.data = await scrapeListing(item.url, (progress) => {
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

async function runJob(job) {
  const pending = job.items.filter((i) => i.status === 'pending');
  await runItems(job, pending);
}

async function resumeJob(job) {
  const pending = job.items.filter((i) => i.status === 'pending' || i.status === 'error');
  await runItems(job, pending);
}

module.exports = { runJob, resumeJob, pauseJob, unpauseJob, stopJob, getRunState };
