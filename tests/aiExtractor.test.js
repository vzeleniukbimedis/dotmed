const { test } = require('node:test');
const assert = require('node:assert/strict');
const { extractListingData } = require('../src/aiExtractor');

function mockChatResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

test('extractListingData parses the model JSON response', async (t) => {
  const originalFetch = global.fetch;
  process.env.MODEL_NAME = 'test-model';
  delete process.env.MODEL_NAME_FALLBACK;

  global.fetch = async () => mockChatResponse(200, {
    choices: [{ message: { content: JSON.stringify({ title: 'CT Scanner', condition: 'Used', description: 'x', isPart: false }) } }],
  });

  t.after(() => { global.fetch = originalFetch; });

  const result = await extractListingData('# markdown', 'https://example.com/1');
  assert.equal(result.title, 'CT Scanner');
});

test('extractListingData surfaces the provider error detail on HTTP failure', async (t) => {
  const originalFetch = global.fetch;
  process.env.MODEL_NAME = 'bad-model';
  delete process.env.MODEL_NAME_FALLBACK;

  global.fetch = async () => mockChatResponse(404, { error: { message: 'model not found' } });

  t.after(() => { global.fetch = originalFetch; });

  await assert.rejects(
    () => extractListingData('# markdown', 'https://example.com/1'),
    /model not found/,
  );
});

test('extractListingData throws a distinct error on invalid JSON content', async (t) => {
  const originalFetch = global.fetch;
  process.env.MODEL_NAME = 'test-model';
  delete process.env.MODEL_NAME_FALLBACK;

  global.fetch = async () => mockChatResponse(200, {
    choices: [{ message: { content: 'not json' } }],
  });

  t.after(() => { global.fetch = originalFetch; });

  await assert.rejects(
    () => extractListingData('# markdown', 'https://example.com/1'),
    /невалідний JSON/,
  );
});

test('extractListingData retries with MODEL_NAME_FALLBACK when the primary model fails', async (t) => {
  const originalFetch = global.fetch;
  process.env.MODEL_NAME = 'bad-model';
  process.env.MODEL_NAME_FALLBACK = 'good-model';

  global.fetch = async (url, opts) => {
    const { model } = JSON.parse(opts.body);
    if (model === 'bad-model') return mockChatResponse(500, { error: { message: 'internal error' } });
    return mockChatResponse(200, {
      choices: [{ message: { content: JSON.stringify({ title: 'Fallback Title', condition: '', description: '', isPart: false }) } }],
    });
  };

  t.after(() => {
    global.fetch = originalFetch;
    delete process.env.MODEL_NAME_FALLBACK;
  });

  const result = await extractListingData('# markdown', 'https://example.com/1');
  assert.equal(result.title, 'Fallback Title');
});

test('extractListingData throws the fallback error when both models fail', async (t) => {
  const originalFetch = global.fetch;
  process.env.MODEL_NAME = 'bad-model';
  process.env.MODEL_NAME_FALLBACK = 'also-bad-model';

  global.fetch = async () => mockChatResponse(500, { error: { message: 'still broken' } });

  t.after(() => {
    global.fetch = originalFetch;
    delete process.env.MODEL_NAME_FALLBACK;
  });

  await assert.rejects(
    () => extractListingData('# markdown', 'https://example.com/1'),
    /still broken/,
  );
});
