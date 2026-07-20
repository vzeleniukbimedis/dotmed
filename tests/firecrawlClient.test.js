const { test } = require('node:test');
const assert = require('node:assert/strict');
const proxyRotator = require('../src/proxyRotator');
const aiExtractor = require('../src/aiExtractor');
const { scrapeListing } = require('../src/firecrawlClient');

function firecrawlResponse(statusCode, markdown) {
  return {
    ok: true,
    json: async () => ({ success: true, data: { markdown, metadata: { statusCode } } }),
  };
}

test('scrapeListing returns extracted data with photos on success', async (t) => {
  const originalFetch = global.fetch;
  const originalExtract = aiExtractor.extractListingData;

  global.fetch = async () => firecrawlResponse(200, '![](https://images.dotmed.com/images/listingpics2/abc.jpg)');
  aiExtractor.extractListingData = async () => ({ title: 'CT Scanner', condition: 'Used', description: 'x', isPart: false });

  t.after(() => {
    global.fetch = originalFetch;
    aiExtractor.extractListingData = originalExtract;
  });

  const result = await scrapeListing('https://www.dotmed.com/listing/x/y/1');
  assert.equal(result.title, 'CT Scanner');
  assert.equal(result.photos.length, 1);
});

test('scrapeListing tells Firecrawl its own scrape timeout explicitly, not relying on Firecrawl\'s default', async (t) => {
  const originalFetch = global.fetch;
  const originalExtract = aiExtractor.extractListingData;
  const originalScrapeTimeout = process.env.FIRECRAWL_SCRAPE_TIMEOUT_MS;
  process.env.FIRECRAWL_SCRAPE_TIMEOUT_MS = '60000';

  let requestedTimeout;
  global.fetch = async (input, opts) => {
    requestedTimeout = JSON.parse(opts.body).timeout;
    return firecrawlResponse(200, 'real content');
  };
  aiExtractor.extractListingData = async () => ({ title: 'OK', condition: '', description: 'd', isPart: false });

  t.after(() => {
    global.fetch = originalFetch;
    aiExtractor.extractListingData = originalExtract;
    if (originalScrapeTimeout === undefined) delete process.env.FIRECRAWL_SCRAPE_TIMEOUT_MS;
    else process.env.FIRECRAWL_SCRAPE_TIMEOUT_MS = originalScrapeTimeout;
  });

  await scrapeListing('https://www.dotmed.com/listing/x/y/7');
  assert.equal(requestedTimeout, 60000);
});

test('scrapeListing retries when the AI returns all-empty fields, then throws after MAX_ATTEMPTS', async (t) => {
  const originalFetch = global.fetch;
  const originalExtract = aiExtractor.extractListingData;

  let calls = 0;
  global.fetch = async () => firecrawlResponse(200, 'some real markdown content');
  aiExtractor.extractListingData = async () => {
    calls++;
    return {};
  };

  t.after(() => {
    global.fetch = originalFetch;
    aiExtractor.extractListingData = originalExtract;
  });

  await assert.rejects(
    () => scrapeListing('https://www.dotmed.com/listing/x/y/2'),
    /Не вдалось відсканувати після 3 спроб/,
  );
  assert.equal(calls, 3);
});

test('scrapeListing rotates the proxy IP and retries on HTTP 429', async (t) => {
  const originalFetch = global.fetch;
  const originalExtract = aiExtractor.extractListingData;
  const originalRotate = proxyRotator.rotateIp;

  let rotateCalls = 0;
  let fetchCalls = 0;
  proxyRotator.rotateIp = async () => {
    rotateCalls++;
  };
  global.fetch = async () => {
    fetchCalls++;
    if (fetchCalls < 2) return firecrawlResponse(429, '');
    return firecrawlResponse(200, 'real content');
  };
  aiExtractor.extractListingData = async () => ({ title: 'OK', condition: '', description: 'd', isPart: false });

  t.after(() => {
    global.fetch = originalFetch;
    aiExtractor.extractListingData = originalExtract;
    proxyRotator.rotateIp = originalRotate;
  });

  const result = await scrapeListing('https://www.dotmed.com/listing/x/y/3');
  assert.equal(result.title, 'OK');
  assert.equal(rotateCalls, 1);
});

test('scrapeListing backs off before retrying a connection-refused failure (Firecrawl still booting)', async (t) => {
  const originalFetch = global.fetch;
  const originalExtract = aiExtractor.extractListingData;
  const originalBackoff = process.env.FIRECRAWL_CONNECTION_BACKOFF_MS;
  process.env.FIRECRAWL_CONNECTION_BACKOFF_MS = '30';

  let fetchCalls = 0;
  global.fetch = async () => {
    fetchCalls++;
    if (fetchCalls < 2) {
      const err = new TypeError('fetch failed');
      err.cause = { code: 'ECONNREFUSED' };
      throw err;
    }
    return firecrawlResponse(200, 'real content');
  };
  aiExtractor.extractListingData = async () => ({ title: 'OK', condition: '', description: 'd', isPart: false });

  t.after(() => {
    global.fetch = originalFetch;
    aiExtractor.extractListingData = originalExtract;
    if (originalBackoff === undefined) delete process.env.FIRECRAWL_CONNECTION_BACKOFF_MS;
    else process.env.FIRECRAWL_CONNECTION_BACKOFF_MS = originalBackoff;
  });

  const start = Date.now();
  const result = await scrapeListing('https://www.dotmed.com/listing/x/y/5');
  assert.equal(result.title, 'OK');
  assert.ok(Date.now() - start >= 30, 'must pause before retrying after ECONNREFUSED');
});

test('scrapeListing routes through DOTMED_PROXY_URL when configured, and un-rewrites image URLs before extraction', async (t) => {
  const originalFetch = global.fetch;
  const originalExtract = aiExtractor.extractListingData;
  const originalProxyUrl = process.env.DOTMED_PROXY_URL;
  process.env.DOTMED_PROXY_URL = 'https://dotmed-proxy.example.workers.dev';

  let requestedUrl;
  global.fetch = async (input, opts) => {
    requestedUrl = JSON.parse(opts.body).url;
    return firecrawlResponse(200, '![](https://dotmed-proxy.example.workers.dev/__img__/images/listingpics2/abc.jpg)');
  };
  aiExtractor.extractListingData = async () => ({ title: 'CT Scanner', condition: '', description: 'x', isPart: false });

  t.after(() => {
    global.fetch = originalFetch;
    aiExtractor.extractListingData = originalExtract;
    if (originalProxyUrl === undefined) delete process.env.DOTMED_PROXY_URL;
    else process.env.DOTMED_PROXY_URL = originalProxyUrl;
  });

  const result = await scrapeListing('https://www.dotmed.com/listing/x/y/6?ref=abc');
  assert.equal(requestedUrl, 'https://dotmed-proxy.example.workers.dev/listing/x/y/6?ref=abc');
  assert.deepEqual(result.photos, ['https://images.dotmed.com/images/listingpics2/abc.jpg']);
});

test('scrapeListing surfaces the AI extraction call error message on repeated failure', async (t) => {
  const originalFetch = global.fetch;
  const originalExtract = aiExtractor.extractListingData;

  global.fetch = async () => firecrawlResponse(200, 'real content');
  aiExtractor.extractListingData = async () => {
    throw new Error('model not found');
  };

  t.after(() => {
    global.fetch = originalFetch;
    aiExtractor.extractListingData = originalExtract;
  });

  await assert.rejects(
    () => scrapeListing('https://www.dotmed.com/listing/x/y/4'),
    /model not found/,
  );
});
