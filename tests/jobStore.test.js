const { test } = require('node:test');
const assert = require('node:assert/strict');
require('dotenv').config();
const jobStore = require('../src/jobStore');
const db = require('../src/db');

const OWNER_A = 'test-owner-a@example.com';
const OWNER_B = 'test-owner-b@example.com';

test('createJob persists items with correct initial status', async () => {
  const job = await jobStore.createJob(
    ['https://www.dotmed.com/listing/a/1', { url: 'https://www.dotmed.com/listing/b/2', error: 'boom' }],
    OWNER_A,
  );
  assert.equal(job.items.length, 2);
  assert.equal(job.items[0].status, 'pending');
  assert.equal(job.items[1].status, 'error');
  assert.equal(job.items[1].error, 'boom');
});

test('saveJob updates item fields and loadJob reflects them', async () => {
  const job = await jobStore.createJob(['https://www.dotmed.com/listing/a/1'], OWNER_A);
  job.items[0].status = 'success';
  job.items[0].data = { brand: 'GE', photos: [] };
  await jobStore.saveJob(job);

  const loaded = await jobStore.loadJob(job.id);
  assert.equal(loaded.items[0].status, 'success');
  assert.equal(loaded.items[0].data.brand, 'GE');
});

test('loadJob returns null for a nonexistent id', async () => {
  const loaded = await jobStore.loadJob('00000000-0000-0000-0000-000000000000');
  assert.equal(loaded, null);
});

test('listJobs only returns jobs owned by that email (per-user isolation)', async () => {
  const jobA = await jobStore.createJob(['https://www.dotmed.com/listing/a/1'], OWNER_A);
  await jobStore.createJob(['https://www.dotmed.com/listing/b/2'], OWNER_B);

  const listA = await jobStore.listJobs(OWNER_A);
  const listB = await jobStore.listJobs(OWNER_B);

  assert.ok(listA.some((j) => j.id === jobA.id));
  assert.ok(!listB.some((j) => j.id === jobA.id), 'owner B must not see owner A jobs');
});

test('listJobs summary counts success/error correctly', async () => {
  const job = await jobStore.createJob(
    ['https://www.dotmed.com/listing/a/1', 'https://www.dotmed.com/listing/a/2'],
    OWNER_A,
  );
  job.items[0].status = 'success';
  job.items[1].status = 'error';
  job.items[1].error = 'failed';
  await jobStore.saveJob(job);

  const list = await jobStore.listJobs(OWNER_A);
  const summary = list.find((j) => j.id === job.id);
  assert.equal(summary.total, 2);
  assert.equal(summary.success, 1);
  assert.equal(summary.error, 1);
});

test('markPendingAsStopped only touches pending items, leaving success/error alone', async () => {
  const job = await jobStore.createJob(
    ['https://www.dotmed.com/listing/a/1', 'https://www.dotmed.com/listing/a/2', 'https://www.dotmed.com/listing/a/3'],
    OWNER_A,
  );
  job.items[0].status = 'success';
  await jobStore.saveJob(job);

  await jobStore.markPendingAsStopped(job.id);

  const loaded = await jobStore.loadJob(job.id);
  assert.equal(loaded.items[0].status, 'success', 'already-finished items must not be touched');
  assert.equal(loaded.items[1].status, 'stopped');
  assert.equal(loaded.items[2].status, 'stopped');
  assert.equal(loaded.counts.stopped, 2);
});

test('deleteJob removes the job and cascades to its items', async () => {
  const job = await jobStore.createJob(['https://www.dotmed.com/listing/a/1'], OWNER_A);
  await jobStore.deleteJob(job.id);

  const loaded = await jobStore.loadJob(job.id);
  assert.equal(loaded, null);
});

test('createJob with discoveryStatus "pending" starts with 0 items until completeDiscovery fills them in', async () => {
  const job = await jobStore.createJob([], OWNER_A, {
    discoveryStatus: 'pending', discoveryUrl: 'https://www.dotmed.com/webstore/1', discoveryTypes: ['equipment'], discoveryMode: 'simplified',
  });
  assert.equal(job.items.length, 0);
  assert.equal(job.discoveryStatus, 'pending');

  const loaded = await jobStore.loadJob(job.id);
  assert.equal(loaded.discoveryStatus, 'pending');
  assert.equal(loaded.counts.total, 0);

  const completed = await jobStore.completeDiscovery(job.id, [{ url: 'https://www.dotmed.com/listing/a/1', data: { title: 'x', price: '$1' } }]);
  assert.equal(completed.discoveryStatus, 'done');
  assert.equal(completed.items.length, 1);

  const loadedAfter = await jobStore.loadJob(job.id);
  assert.equal(loadedAfter.discoveryStatus, 'done');
  assert.equal(loadedAfter.counts.total, 1);
});

test('createJob persists mode, and completeDiscovery/loadJob both reflect it', async () => {
  const job = await jobStore.createJob([], OWNER_A, {
    discoveryStatus: 'pending', discoveryUrl: 'https://www.dotmed.com/webstore/3', discoveryTypes: ['equipment'], discoveryMode: 'simplified', mode: 'simplified',
  });
  assert.equal(job.mode, 'simplified');

  const completed = await jobStore.completeDiscovery(job.id, [{ url: 'https://www.dotmed.com/listing/a/1', data: { title: 'x', price: '$1' } }]);
  assert.equal(completed.mode, 'simplified');

  const loaded = await jobStore.loadJob(job.id);
  assert.equal(loaded.mode, 'simplified');
});

test('findStuckDiscoveries returns only jobs still pending discovery, with their original params', async () => {
  const stuck = await jobStore.createJob([], OWNER_A, {
    discoveryStatus: 'pending', discoveryUrl: 'https://www.dotmed.com/webstore/2', discoveryTypes: ['equipment', 'parts'], discoveryMode: 'full',
  });
  const done = await jobStore.createJob(['https://www.dotmed.com/listing/a/1'], OWNER_A);

  const found = await jobStore.findStuckDiscoveries();
  assert.ok(found.some((d) => d.id === stuck.id));
  assert.ok(!found.some((d) => d.id === done.id));

  const match = found.find((d) => d.id === stuck.id);
  assert.equal(match.url, 'https://www.dotmed.com/webstore/2');
  assert.deepEqual(match.types, ['equipment', 'parts']);
  assert.equal(match.mode, 'full');
});

test.after(async () => {
  await db.query('DELETE FROM jobs WHERE owner_email IN ($1, $2)', [OWNER_A, OWNER_B]);
  await db.pool.end();
});
