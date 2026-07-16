const { test } = require('node:test');
const assert = require('node:assert/strict');
const { extractListingData } = require('../src/aiExtractor');

// Constant across every test below — only MODEL_NAME/MODEL_NAME_FALLBACK
// (and the AI_PROVIDER2_* set, where used) vary per test.
process.env.OPENAI_BASE_URL = 'https://example-provider.test/v1';
process.env.OPENAI_API_KEY = 'test-key';

function mockChatResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    headers: { get: () => null },
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

test('extractListingData backs off briefly on HTTP 429 before propagating the error', async (t) => {
  const originalFetch = global.fetch;
  const originalBackoff = process.env.AI_RATE_LIMIT_BACKOFF_MS;
  process.env.MODEL_NAME = 'rate-limited-model';
  process.env.AI_RATE_LIMIT_BACKOFF_MS = '40';
  delete process.env.MODEL_NAME_FALLBACK;

  global.fetch = async () => mockChatResponse(429, { status: 429, title: 'Too Many Requests' });

  t.after(() => {
    global.fetch = originalFetch;
    if (originalBackoff === undefined) delete process.env.AI_RATE_LIMIT_BACKOFF_MS;
    else process.env.AI_RATE_LIMIT_BACKOFF_MS = originalBackoff;
  });

  const start = Date.now();
  await assert.rejects(
    () => extractListingData('# markdown', 'https://example.com/1'),
    /HTTP 429/,
  );
  assert.ok(Date.now() - start >= 40, 'must pause for the backoff window before the error surfaces');
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

test('extractListingData tries the fallback when the primary succeeds but returns all-empty fields', async (t) => {
  const originalFetch = global.fetch;
  process.env.MODEL_NAME = 'flaky-model';
  process.env.MODEL_NAME_FALLBACK = 'good-model';

  global.fetch = async (url, opts) => {
    const { model } = JSON.parse(opts.body);
    if (model === 'flaky-model') {
      return mockChatResponse(200, {
        choices: [{ message: { content: JSON.stringify({ title: '', condition: '', description: '', isPart: false }) } }],
      });
    }
    return mockChatResponse(200, {
      choices: [{ message: { content: JSON.stringify({ title: 'Real Title', condition: 'Used', description: 'x', isPart: false }) } }],
    });
  };

  t.after(() => {
    global.fetch = originalFetch;
    delete process.env.MODEL_NAME_FALLBACK;
  });

  const result = await extractListingData('# markdown', 'https://example.com/1');
  assert.equal(result.title, 'Real Title');
});

test('extractListingData throws a timeout error instead of hanging forever', async (t) => {
  const originalFetch = global.fetch;
  const originalTimeout = process.env.AI_REQUEST_TIMEOUT_MS;
  process.env.MODEL_NAME = 'slow-model';
  process.env.AI_REQUEST_TIMEOUT_MS = '50';
  delete process.env.MODEL_NAME_FALLBACK;

  // Simulates a stalled request that only ever settles when aborted — matches
  // real fetch()'s behavior under AbortController, unlike a promise that
  // simply never resolves (which would make this test hang instead of pass).
  global.fetch = (url, opts) => new Promise((resolve, reject) => {
    opts.signal.addEventListener('abort', () => {
      const err = new Error('The operation was aborted.');
      err.name = 'AbortError';
      reject(err);
    });
  });

  t.after(() => {
    global.fetch = originalFetch;
    if (originalTimeout === undefined) delete process.env.AI_REQUEST_TIMEOUT_MS;
    else process.env.AI_REQUEST_TIMEOUT_MS = originalTimeout;
  });

  await assert.rejects(
    () => extractListingData('# markdown', 'https://example.com/1'),
    /не відповів/,
  );
});

test('extractListingData moves to the next provider when provider 1 fails outright', async (t) => {
  const originalFetch = global.fetch;
  process.env.MODEL_NAME = 'p1-model';
  delete process.env.MODEL_NAME_FALLBACK;
  process.env.AI_PROVIDER2_BASE_URL = 'https://provider2.test/v1';
  process.env.AI_PROVIDER2_API_KEY = 'p2-key';
  process.env.AI_PROVIDER2_MODEL = 'p2-model';

  global.fetch = async (url) => {
    if (url.startsWith('https://example-provider.test')) {
      return mockChatResponse(500, { error: { message: 'provider 1 down' } });
    }
    return mockChatResponse(200, {
      choices: [{ message: { content: JSON.stringify({ title: 'Provider 2 Title', condition: '', description: '', isPart: false }) } }],
    });
  };

  t.after(() => {
    global.fetch = originalFetch;
    delete process.env.AI_PROVIDER2_BASE_URL;
    delete process.env.AI_PROVIDER2_API_KEY;
    delete process.env.AI_PROVIDER2_MODEL;
  });

  const result = await extractListingData('# markdown', 'https://example.com/1');
  assert.equal(result.title, 'Provider 2 Title');
});

test('extractListingData returns the primary all-empty result when there is no fallback configured', async (t) => {
  const originalFetch = global.fetch;
  process.env.MODEL_NAME = 'flaky-model';
  delete process.env.MODEL_NAME_FALLBACK;

  global.fetch = async () => mockChatResponse(200, {
    choices: [{ message: { content: JSON.stringify({ title: '', condition: '', description: '', isPart: false }) } }],
  });

  t.after(() => { global.fetch = originalFetch; });

  const result = await extractListingData('# markdown', 'https://example.com/1');
  assert.equal(result.title, '');
});
