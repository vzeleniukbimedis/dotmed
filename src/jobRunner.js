const { scrapeListing } = require('./firecrawlClient');
const jobStore = require('./jobStore');

const CONCURRENCY = 1;

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
      jobStore.saveJob(job).catch((err) => console.error('Progress save failed:', err));
    });
    item.status = 'success';
    delete item.error;
    delete item.stageLabel;
  } catch (err) {
    item.status = 'error';
    item.error = err.message;
    delete item.stageLabel;
  }
  item.finishedAt = new Date().toISOString();
  await jobStore.saveJob(job);
}

async function runItems(job, items) {
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const item = items[next++];
      await processItem(job, item);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker));
}

async function runJob(job) {
  const pending = job.items.filter((i) => i.status === 'pending');
  await runItems(job, pending);
}

async function resumeJob(job) {
  const pending = job.items.filter((i) => i.status === 'pending' || i.status === 'error');
  await runItems(job, pending);
}

module.exports = { runJob, resumeJob };
