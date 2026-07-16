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
