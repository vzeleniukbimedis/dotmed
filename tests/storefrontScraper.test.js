const { test } = require('node:test');
const assert = require('node:assert/strict');
const dotmedAuth = require('../src/dotmedAuth');
const { discoverListings, discoverListingSummaries, extractSellerId } = require('../src/storefrontScraper');

// Real markup from a live storefront listing row (dotmed.com), used to lock
// in the title/price regex against actual structure rather than a synthetic
// approximation.
function realListingRow(id, title, price) {
  return `<div id="listing_${id}_" class="row listing-list ml-0 mr-0 mt-3 mb-3 listings-d">
    <div class="col-xs-12 col-md-3 listing-img mt-1 mb-1">
        <div class="row">
            <div class="col-md-10 col-xs-12 text-center">
                <a href="/listing/podiatric-x-ray/curvebeam/ped-cat/${id}">
                    <img loading="lazy" src="https://images.dotmed.com/cgi-bin/size.pl?i=${id}.jpg" alt="DOTmed Listing">
                </a>
            </div>
        </div>
    </div>
    <div class="col-xs-12 col-md-9 pt-1 listing-text">
        <div class="row">
            <div class="col-md-9 col-xs-12 listing-info">
                <h4><a href="/listing/podiatric-x-ray/curvebeam/ped-cat/${id}">${title}</a></h4>
                <p>PRODUCT DESCRIPTION: some description text
                <a href="/listing/podiatric-x-ray/curvebeam/ped-cat/${id}"> view more </a>
</p>
            </div>
            <div class="col-xs-12 col-md-12 col-lg-3 listing-date">
            <b>July&nbsp;16</b>
            <p>Asking Price:<br><span class="price">${price}
</span></p>
            </div>
        </div>
    </div>
    <div class="col-12">
    <div class="listings-d-bottom col-12">
        <div class="row">
            <div class="col-9 row">
                <div class="col-12"><b><a href="/listing/podiatric-x-ray/curvebeam/ped-cat/${id}">Seller Name</a></b><br></div>
            </div>
            <div class="col-3 text-right">
                <h5 class="badge-webstore"><a rel="nofollow" href="/webstore/42358/?type=equipment" class="badge badge-success">Webstore</a></h5>
            </div>
        </div>
    </div>
    </div>
</div>`;
}

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
    return indexes.map((i) => `<div id="listing_${i}_"><a href="/listing/x/y/${i}">l</a></div>`).join('');
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

test('discoverListings paginates by row count, unaffected by each item linking itself several times', async (t) => {
  const originalEnsureSession = dotmedAuth.ensureSession;
  const originalFetch = global.fetch;

  dotmedAuth.ensureSession = async () => ['session=fake'];

  // Real storefront rows link the same item 4x (thumbnail, title, "view
  // more", seller name) — counting hrefs (raw or deduped) instead of rows
  // would badly misjudge "is this a full page", so this uses the real
  // multi-href-per-row shape rather than the one-href-per-item shorthand.
  global.fetch = async (url) => {
    const offset = Number(new URL(url).searchParams.get('offset'));
    if (offset === 0) {
      const rows = Array.from({ length: 100 }, (_, i) => realListingRow(String(i), `Item ${i}`, '$1 USD'));
      return { text: async () => rows.join('\n') };
    }
    if (offset === 100) {
      const rows = Array.from({ length: 30 }, (_, i) => realListingRow(String(100 + i), `Item ${100 + i}`, '$1 USD'));
      return { text: async () => rows.join('\n') };
    }
    return { text: async () => '' };
  };

  t.after(() => {
    dotmedAuth.ensureSession = originalEnsureSession;
    global.fetch = originalFetch;
  });

  const urls = await discoverListings('https://www.dotmed.com/webstore/888', ['equipment']);
  assert.equal(urls.length, 130, 'must include both the full 100-row page and the 30-row page after it');
});

test('discoverListingSummaries extracts title and price from real storefront row markup', async (t) => {
  const originalEnsureSession = dotmedAuth.ensureSession;
  const originalFetch = global.fetch;

  dotmedAuth.ensureSession = async () => ['session=fake'];

  global.fetch = async () => ({
    text: async () => [
      realListingRow('5582241', 'CurveBeam Ped CAT Podiatric X-Ray For Sale', '$15,950 USD'),
      realListingRow('5582242', 'GE Optima CT660 For Sale', '$45,000 USD'),
    ].join('\n'),
  });

  t.after(() => {
    dotmedAuth.ensureSession = originalEnsureSession;
    global.fetch = originalFetch;
  });

  const summaries = await discoverListingSummaries('https://www.dotmed.com/webstore/42358', ['equipment']);
  assert.equal(summaries.length, 2);
  assert.deepEqual(summaries[0], {
    url: 'https://www.dotmed.com/listing/podiatric-x-ray/curvebeam/ped-cat/5582241',
    title: 'CurveBeam Ped CAT Podiatric X-Ray For Sale',
    price: '$15,950 USD',
  });
  assert.equal(summaries[1].price, '$45,000 USD');
});

test('discoverListingSummaries paginates past a full 100-row page to the next', async (t) => {
  const originalEnsureSession = dotmedAuth.ensureSession;
  const originalFetch = global.fetch;

  dotmedAuth.ensureSession = async () => ['session=fake'];

  global.fetch = async (url) => {
    const offset = Number(new URL(url).searchParams.get('offset'));
    if (offset === 0) {
      const rows = Array.from({ length: 100 }, (_, i) => realListingRow(String(i), `Item ${i}`, '$1 USD'));
      return { text: async () => rows.join('\n') };
    }
    if (offset === 100) {
      const rows = Array.from({ length: 20 }, (_, i) => realListingRow(String(100 + i), `Item ${100 + i}`, '$1 USD'));
      return { text: async () => rows.join('\n') };
    }
    return { text: async () => '' };
  };

  t.after(() => {
    dotmedAuth.ensureSession = originalEnsureSession;
    global.fetch = originalFetch;
  });

  const summaries = await discoverListingSummaries('https://www.dotmed.com/webstore/999', ['equipment']);
  assert.equal(summaries.length, 120, 'must continue past the first full page (100 rows) to the second');
});
