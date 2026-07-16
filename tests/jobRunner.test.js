const { test } = require('node:test');
const assert = require('node:assert/strict');
require('dotenv').config();
const jobStore = require('../src/jobStore');
const db = require('../src/db');
const firecrawlClient = require('../src/firecrawlClient');
const { runJob, stopJob, getRunState } = require('../src/jobRunner');

const OWNER = 'test-jobrunner-owner@example.com';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitUntil(predicate, { timeoutMs = 3000, intervalMs = 20 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await sleep(intervalMs);
  }
  throw new Error('waitUntil timed out');
}

test('a second job only starts after the first one finishes (sequential queue)', async (t) => {
  const originalScrape = firecrawlClient.scrapeListing;
  const order = [];

  firecrawlClient.scrapeListing = async (url) => {
    order.push(url);
    await sleep(30);
    return { title: 'x', condition: '', description: 'x', isPart: false, photos: [] };
  };

  t.after(() => {
    firecrawlClient.scrapeListing = originalScrape;
  });

  const jobA = await jobStore.createJob(
    ['https://www.dotmed.com/listing/queue-a/1', 'https://www.dotmed.com/listing/queue-a/2'],
    OWNER,
  );
  const jobB = await jobStore.createJob(['https://www.dotmed.com/listing/queue-b/1'], OWNER);

  runJob(jobA);
  runJob(jobB);

  assert.equal(getRunState(jobB.id), 'queued', 'second job must wait while the first is active');

  await waitUntil(async () => {
    const loaded = await jobStore.loadJob(jobB.id);
    return loaded.items[0].status !== 'pending';
  });

  const bIndex = order.indexOf('https://www.dotmed.com/listing/queue-b/1');
  assert.equal(bIndex, 2, 'job B\'s item must run only after both of job A\'s items');
});

test('stopping a queued job cancels it before it ever starts', async (t) => {
  const originalScrape = firecrawlClient.scrapeListing;

  firecrawlClient.scrapeListing = async () => {
    await sleep(50);
    return { title: 'x', condition: '', description: 'x', isPart: false, photos: [] };
  };

  t.after(() => {
    firecrawlClient.scrapeListing = originalScrape;
  });

  const jobA = await jobStore.createJob(['https://www.dotmed.com/listing/cancel-a/1'], OWNER);
  const jobB = await jobStore.createJob(['https://www.dotmed.com/listing/cancel-b/1'], OWNER);

  runJob(jobA);
  runJob(jobB);
  assert.equal(getRunState(jobB.id), 'queued');

  stopJob(jobB.id);
  assert.equal(getRunState(jobB.id), 'idle', 'cancelled-while-queued job must not report as queued anymore');

  await waitUntil(async () => {
    const loaded = await jobStore.loadJob(jobA.id);
    return loaded.items[0].status !== 'pending';
  });
  await sleep(50);

  const loadedB = await jobStore.loadJob(jobB.id);
  assert.equal(loadedB.items[0].status, 'pending', 'a job cancelled while queued must never actually run');
});

test.after(async () => {
  await db.query('DELETE FROM jobs WHERE owner_email = $1', [OWNER]);
  await db.pool.end();
});
