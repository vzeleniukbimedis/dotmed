const { test } = require('node:test');
const assert = require('node:assert/strict');
require('dotenv').config();
const { getAllowlist, requireAuth } = require('../src/auth');
const settingsStore = require('../src/settingsStore');
const db = require('../src/db');

let originalAllowlist;

test.before(async () => {
  originalAllowlist = await settingsStore.getSetting('allowed_google_emails');
});

test('getAllowlist parses, trims and lowercases a comma-separated list', async () => {
  await settingsStore.setSetting('allowed_google_emails', ' Alice@Example.com, bob@example.com ,,');
  const list = await getAllowlist();
  assert.deepEqual(list, ['alice@example.com', 'bob@example.com']);
});

test('getAllowlist returns an empty array when unset', async () => {
  await settingsStore.setSetting('allowed_google_emails', '');
  const list = await getAllowlist();
  assert.deepEqual(list, []);
});

test('requireAuth blocks requests with no session user', () => {
  let statusCode;
  let body;
  const req = { session: {} };
  const res = {
    status(code) { statusCode = code; return this; },
    json(payload) { body = payload; },
  };
  let nextCalled = false;
  requireAuth(req, res, () => { nextCalled = true; });

  assert.equal(nextCalled, false);
  assert.equal(statusCode, 401);
  assert.deepEqual(body, { error: 'Not authenticated' });
});

test('requireAuth allows requests with a session user', () => {
  const req = { session: { user: { email: 'x@example.com' } } };
  let nextCalled = false;
  requireAuth(req, {}, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
});

test.after(async () => {
  if (originalAllowlist !== undefined) {
    await settingsStore.setSetting('allowed_google_emails', originalAllowlist);
  }
  await db.pool.end();
});
