const { extractPhotos } = require('./dotmedParser');
const proxyRotator = require('./proxyRotator');
const aiExtractor = require('./aiExtractor');
const logger = require('./logger').child({ module: 'firecrawlClient' });

const FIRECRAWL_URL = process.env.FIRECRAWL_URL || 'http://localhost:3002';
const MAX_ATTEMPTS = 3;
// Firecrawl renders the page in a real browser, so this needs more headroom
// than a plain AI call — but it's still a hang guard: without it a stalled
// (not erroring) Firecrawl request blocks this worker, and every job queued
// behind it, forever. Overridable via env for fast tests.
function getTimeoutMs() {
  return Number(process.env.FIRECRAWL_REQUEST_TIMEOUT_MS) || 45_000;
}

// Seen repeatedly on redeploy: dotmed-parser boots and auto-resumes queued
// jobs faster than the sibling Firecrawl container finishes its own startup
// (depends on redis/rabbitmq/playwright-service), so the first few items hit
// ECONNREFUSED and burn all 3 attempts almost instantly. A longer pause here
// (vs. immediate retry) gives Firecrawl real time to finish booting instead
// of silently error-ing out items that would have succeeded moments later.
function isConnectionError(err) {
  return err.code === 'ECONNREFUSED' || err.cause?.code === 'ECONNREFUSED' || /ECONNREFUSED/i.test(err.message);
}

function getConnectionErrorBackoffMs() {
  return Number(process.env.FIRECRAWL_CONNECTION_BACKOFF_MS) || 5_000;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isBlockedResponse(data) {
  const statusCode = data?.metadata?.statusCode;
  const markdown = data?.markdown || '';
  return statusCode === 403
    && (markdown.includes('Performing security verification') || markdown.includes('malicious bots'));
}

function isRateLimited(data) {
  return data?.metadata?.statusCode === 429;
}

function isEmptyExtraction(result) {
  // Photos come from a separate markdown regex, not the AI extraction — their
  // presence doesn't prove the AI actually returned structured data. Require
  // a real extracted field regardless of whether photos were found.
  return !(result.title || result.brand || result.description);
}

// Firecrawl only fetches/renders the page here — we no longer ask its
// internal jsonOptions.schema extraction to do anything, since that step is
// an opaque self-hosted black box (known to silently return empty JSON with
// no surfaced error — see github.com/firecrawl/firecrawl/issues/1656). We
// extract structured data ourselves via aiExtractor so failures are visible.
async function requestScrape(url) {
  const timeoutMs = getTimeoutMs();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let res;
  try {
    res = await fetch(`${FIRECRAWL_URL}/v1/scrape`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url,
        formats: ['markdown'],
        onlyMainContent: true,
      }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`Firecrawl не відповів за ${timeoutMs / 1000}с`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }

  let body;
  try {
    body = await res.json();
  } catch {
    throw new Error(`Firecrawl повернув не-JSON відповідь (HTTP ${res.status})`);
  }
  if (!res.ok || !body.success) {
    const detail = body?.error ? `: ${body.error}` : '';
    throw new Error(`Firecrawl request failed (HTTP ${res.status})${detail}`);
  }
  return body.data;
}

async function scrapeListing(url, onProgress = () => {}) {
  let lastError;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    onProgress({ stage: 'scraping', attempt, maxAttempts: MAX_ATTEMPTS });

    let data;
    try {
      data = await requestScrape(url);
    } catch (err) {
      lastError = err;
      logger.error({ url, attempt, maxAttempts: MAX_ATTEMPTS, err }, 'scrape request failed');
      if (attempt < MAX_ATTEMPTS) {
        onProgress({ stage: 'retrying', attempt, maxAttempts: MAX_ATTEMPTS });
        if (isConnectionError(err)) {
          await sleep(getConnectionErrorBackoffMs());
        }
      }
      continue;
    }

    const statusCode = data?.metadata?.statusCode;
    const markdown = data?.markdown || '';

    if (isRateLimited(data)) {
      logger.error({ url, attempt, maxAttempts: MAX_ATTEMPTS, statusCode }, 'rate limited (429)');
      lastError = new Error('DOTmed тимчасово обмежив кількість запитів (HTTP 429)');
      if (attempt < MAX_ATTEMPTS) {
        onProgress({ stage: 'rotating_ip', attempt, maxAttempts: MAX_ATTEMPTS });
        await proxyRotator.rotateIp();
      }
      continue;
    }

    if (isBlockedResponse(data)) {
      logger.error({ url, attempt, maxAttempts: MAX_ATTEMPTS, statusCode }, 'blocked by Cloudflare');
      lastError = new Error('Заблоковано Cloudflare (security verification)');
      if (attempt < MAX_ATTEMPTS) {
        onProgress({ stage: 'rotating_ip', attempt, maxAttempts: MAX_ATTEMPTS });
        await proxyRotator.rotateIp();
      }
      continue;
    }

    onProgress({ stage: 'extracting', attempt, maxAttempts: MAX_ATTEMPTS });
    try {
      const json = await aiExtractor.extractListingData(markdown, url);
      const result = { url, ...json, photos: extractPhotos(markdown) };

      if (!isEmptyExtraction(result)) {
        logger.info({ url, attempt, title: result.title, photos: result.photos.length }, 'extraction succeeded');
        return result;
      }

      logger.error(
        { url, attempt, maxAttempts: MAX_ATTEMPTS, statusCode, markdownLen: markdown.length, photos: result.photos.length, json },
        'AI returned all-empty fields',
      );
      lastError = new Error(
        `AI повернув порожні поля (HTTP ${statusCode}, markdown ${markdown.length} символів, фото ${result.photos.length})`,
      );
    } catch (err) {
      logger.error({ url, attempt, maxAttempts: MAX_ATTEMPTS, err }, 'AI extraction call failed');
      lastError = new Error(`AI-екстракція не вдалась: ${err.message}`);
    }

    if (attempt < MAX_ATTEMPTS) {
      onProgress({ stage: 'retrying', attempt, maxAttempts: MAX_ATTEMPTS });
    }
  }

  throw new Error(`Не вдалось відсканувати після ${MAX_ATTEMPTS} спроб: ${lastError.message}`);
}

module.exports = { scrapeListing, isBlockedResponse };
