const { test } = require('node:test');
const assert = require('node:assert/strict');
const dotmedAuth = require('../src/dotmedAuth');
const { discoverListings, extractSellerId } = require('../src/storefrontScraper');

test('extractSellerId parses webstore, profile, and query-string URLs', () => {
  assert.equal(extractSellerId('https://www.dotmed.com/webstore/74'), '74');
  assert.equal(extractSellerId('https://www.dotmed.com/virtual-trade-show/category/profiles/robert-manetta/74'), '74');
  assert.equal(extractSellerId('https://www.dotmed.com/webstore/?user=74&type=equipment'), '74');
  assert.equal(extractSellerId('https://www.dotmed.com/listing/ct-scanner/ge/x/1'), null);
});

test('discoverListings recovers from a transiently-empty page instead of truncating pagination', async (t) => {
  const originalEnsureSession = dotmedAuth.ensureSession;
  const originalFetch = global.fetch;

  dotmedAuth.ensureSession = async () => ['session=fake'];

  function pageHtml(indexes) {
    return indexes.map((i) => `<a href="/listing/x/y/${i}">l</a>`).join('');
  }

  let callCount = 0;
  global.fetch = async (url) => {
    callCount++;
    const offset = Number(new URL(url).searchParams.get('offset'));

    if (offset === 0) {
      return { text: async () => pageHtml(Array.from({ length: 100 }, (_, i) => i)) };
    }
    if (offset === 100) {
      // Simulate dotmed's real flakiness: the very first request at this offset
      // comes back empty; a retry at the same offset succeeds with a full page.
      const isRetry = callCount > 2;
      return { text: async () => (isRetry ? pageHtml(Array.from({ length: 100 }, (_, i) => 100 + i)) : '') };
    }
    if (offset === 200) {
      return { text: async () => pageHtml(Array.from({ length: 30 }, (_, i) => 200 + i)) };
    }
    return { text: async () => '' };
  };

  t.after(() => {
    dotmedAuth.ensureSession = originalEnsureSession;
    global.fetch = originalFetch;
  });

  const urls = await discoverListings('https://www.dotmed.com/webstore/999', ['equipment']);
  assert.equal(urls.length, 230, 'must include the retried page (100-199), not stop at the transient empty response');
});
