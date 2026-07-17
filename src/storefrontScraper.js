const dotmedAuth = require('./dotmedAuth');
const aiExtractor = require('./aiExtractor');
const logger = require('./logger').child({ module: 'storefrontScraper' });

const LISTINGS_PER_PAGE = 100;
const TYPE_LABELS = { equipment: 'Обладнання', parts: 'Запчастини' };

function extractSellerId(url) {
  const webstoreMatch = url.match(/\/webstore\/(\d+)/);
  if (webstoreMatch) return webstoreMatch[1];
  const profileMatch = url.match(/\/virtual-trade-show\/category\/profiles\/[^/]+\/(\d+)/);
  if (profileMatch) return profileMatch[1];
  const queryMatch = url.match(/[?&]user=(\d+)/);
  if (queryMatch) return queryMatch[1];
  return null;
}

function isBlockedOrLoggedOut(html) {
  const isChallenged = html.includes('Performing security verification') || html.includes('cf-turnstile');
  const isLoginPage = html.includes('name="user"') && html.includes('name="pass"');
  return isChallenged || isLoginPage;
}

// Each item on a storefront page is wrapped in <div id="listing_<id>_" ...>,
// and that same item's own href appears several times within its row
// (thumbnail, title, "view more", seller name) — so neither a raw nor a
// deduped href count reliably reflects "how many items are on this page".
// The row wrapper itself is the one signal that maps 1:1 to real items.
function countListingRows(html) {
  return (html.match(/<div id="listing_\d+_"/g) || []).length;
}

// Full mode: just the deduped listing URLs, to be individually scraped +
// AI-extracted later (existing behavior).
function extractListingUrls(html) {
  const paths = [...html.matchAll(/href="(\/listing\/[^"]+)"/g)].map((m) => m[1]);
  const uniquePaths = [...new Set(paths)];
  return uniquePaths.map((p) => `https://www.dotmed.com${p}`);
}

// Simplified mode: title + asking price straight from the seller's own
// listing-row markup — no per-listing fetch. Real-world storefront markup
// varies in ways a hand-written regex can't reliably track, so this hands
// the page HTML to the AI extraction chain instead of pattern-matching it.
async function extractStorefrontSummaries(html, pageUrl) {
  const items = await aiExtractor.extractStorefrontListings(html, pageUrl);
  return items
    .filter((item) => item?.url)
    .map((item) => ({
      url: item.url,
      title: (item.title || '').trim(),
      price: (item.price || '').trim(),
    }));
}

async function fetchStorePage(sellerId, type, offset, cookies) {
  const url = `https://www.dotmed.com/webstore/?user=${sellerId}&type=${type}&mode=all&order=&sort=&listings_per_page=${LISTINGS_PER_PAGE}&offset=${offset}`;
  const res = await fetch(url, {
    headers: { ...dotmedAuth.BROWSER_HEADERS, Cookie: cookies.join('; ') },
    dispatcher: dotmedAuth.proxyDispatcher,
  });
  return res.text();
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const EMPTY_PAGE_RETRIES = 3;
const EMPTY_PAGE_RETRY_DELAY_MS = 1500;

// extractFn(html, pageUrl) -> items[] — shared pagination/retry/re-login
// mechanics; only the per-page extraction differs between full and
// simplified mode.
//
// The stop condition prefers countListingRows (cheap, and avoids an
// off-by-one dedup edge case that once truncated a full page), but some
// real sellers' pages don't use the `<div id="listing_N_">` wrapper this
// regex expects at all (confirmed live: webstore/42358 returns rowCount 0
// on a page the AI still correctly reads 19 real items off of). When the
// row count says "empty" but extraction actually found items, the row
// count is simply wrong for this page's markup — fall back to the
// extracted count instead of trusting a signal that's clearly blind here.
async function paginateType(sellerId, type, cookies, extractFn) {
  const all = [];
  let offset = 0;
  for (;;) {
    let html = await fetchStorePage(sellerId, type, offset, cookies);
    if (isBlockedOrLoggedOut(html)) {
      cookies = await dotmedAuth.invalidateAndRelogin();
      html = await fetchStorePage(sellerId, type, offset, cookies);
      if (isBlockedOrLoggedOut(html)) {
        throw new Error(`Сесія DOTmed недійсна навіть після повторного логіну (тип: ${TYPE_LABELS[type] || type})`);
      }
    }

    const pageUrl = `https://www.dotmed.com/webstore/?user=${sellerId}&type=${type}&offset=${offset}`;
    let rowCount = countListingRows(html);
    let extracted = await extractFn(html, pageUrl);

    // dotmed.com's webstore endpoint is flaky: an offset can transiently
    // return 0 results and then return a full page again at the very same
    // offset a moment later. Only retry when BOTH signals agree the page
    // is empty — if extraction already found real items, the page is not
    // empty regardless of what the row-count regex says.
    if (rowCount === 0 && extracted.length === 0) {
      for (let attempt = 1; attempt <= EMPTY_PAGE_RETRIES && extracted.length === 0; attempt++) {
        await sleep(EMPTY_PAGE_RETRY_DELAY_MS);
        html = await fetchStorePage(sellerId, type, offset, cookies);
        rowCount = countListingRows(html);
        extracted = await extractFn(html, pageUrl);
      }
    }

    const pageCount = rowCount > 0 ? rowCount : extracted.length;

    if (pageCount > 0 && extracted.length === 0) {
      logger.error({ sellerId, type, offset, rowCount }, 'page had listing rows but extraction returned none');
    } else {
      logger.info({ sellerId, type, offset, rowCount, extractedCount: extracted.length }, 'storefront page extracted');
    }

    all.push(...extracted);

    if (pageCount < LISTINGS_PER_PAGE) break;
    offset += LISTINGS_PER_PAGE;
  }
  return all;
}

async function discoverListings(storefrontUrl, types = ['equipment', 'parts']) {
  const sellerId = extractSellerId(storefrontUrl);
  if (!sellerId) {
    throw new Error('Не вдалось визначити ID продавця з цього лінку');
  }

  const cookies = await dotmedAuth.ensureSession();

  const all = [];
  for (const type of types) {
    const urls = await paginateType(sellerId, type, cookies, extractListingUrls);
    all.push(...urls);
  }
  return [...new Set(all)];
}

// Same seller, same pages — just pulls title+price instead of URLs, for the
// "simplified" scan mode (no per-item AI extraction).
async function discoverListingSummaries(storefrontUrl, types = ['equipment', 'parts']) {
  const sellerId = extractSellerId(storefrontUrl);
  if (!sellerId) {
    throw new Error('Не вдалось визначити ID продавця з цього лінку');
  }

  const cookies = await dotmedAuth.ensureSession();

  const all = [];
  for (const type of types) {
    const summaries = await paginateType(sellerId, type, cookies, extractStorefrontSummaries);
    all.push(...summaries);
  }

  const seen = new Set();
  return all.filter((s) => {
    if (seen.has(s.url)) return false;
    seen.add(s.url);
    return true;
  });
}

module.exports = { discoverListings, discoverListingSummaries, extractSellerId };
