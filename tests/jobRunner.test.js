const { test } = require('node:test');
const assert = require('node:assert/strict');
require('dotenv').config();
const jobStore = require('../src/jobStore');
const db = require('../src/db');
const firecrawlClient = require('../src/firecrawlClient');
const { runJob, resumeJob, stopJob, getRunState } = require('../src/jobRunner');

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

  // Wait for a fully terminal state, not just "started" — otherwise this
  // test can return while jobB is still mid-flight, leaving stale state in
  // the shared module-level queue for the next test to trip over.
  await waitUntil(async () => {
    const loaded = await jobStore.loadJob(jobB.id);
    return loaded.items[0].status === 'success';
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

  await stopJob(jobB.id);
  assert.equal(getRunState(jobB.id), 'idle', 'cancelled-while-queued job must not report as queued anymore');

  await waitUntil(async () => {
    const loaded = await jobStore.loadJob(jobA.id);
    return loaded.items[0].status === 'success';
  });

  const loadedB = await jobStore.loadJob(jobB.id);
  assert.equal(loadedB.items[0].status, 'stopped', 'a job cancelled while queued must never actually run');
});

test('a job stopped mid-run is not picked up again by findIncompleteJobs (crash-recovery must not resurrect it)', async (t) => {
  const originalScrape = firecrawlClient.scrapeListing;

  firecrawlClient.scrapeListing = async () => {
    await sleep(30);
    return { title: 'x', condition: '', description: 'x', isPart: false, photos: [] };
  };

  t.after(() => {
    firecrawlClient.scrapeListing = originalScrape;
  });

  const job = await jobStore.createJob(
    ['https://www.dotmed.com/listing/stop-recover/1', 'https://www.dotmed.com/listing/stop-recover/2'],
    OWNER,
  );

  runJob(job);
  // Wait for the first item to actually start scraping — stopping any
  // earlier would set control.stopped before the worker ever picks up item
  // 1, which stops the job before it does any work at all rather than
  // testing the intended "stopped mid-run" scenario.
  await waitUntil(async () => {
    const loaded = await jobStore.loadJob(job.id);
    return loaded.items[0].status === 'running';
  });

  await stopJob(job.id);

  await waitUntil(async () => {
    const loaded = await jobStore.loadJob(job.id);
    return loaded.items[0].status === 'success' && loaded.items[1].status === 'stopped';
  });

  const incompleteJobIds = await jobStore.findIncompleteJobs();
  assert.ok(!incompleteJobIds.includes(job.id), 'a deliberately-stopped job must not be treated as crash-interrupted');

  // resume must still be able to pick the stopped item back up on request —
  // reload from DB first, same as server.js does before every resume call,
  // since markPendingAsStopped updates the DB directly, not the in-memory
  // job object still held from the original runJob() call above.
  const freshJob = await jobStore.loadJob(job.id);
  resumeJob(freshJob);
  await waitUntil(async () => {
    const loaded = await jobStore.loadJob(job.id);
    return loaded.items[1].status === 'success';
  });
});

test.after(async () => {
  await db.query('DELETE FROM jobs WHERE owner_email = $1', [OWNER]);
  await db.pool.end();
});
