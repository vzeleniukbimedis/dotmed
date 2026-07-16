const { LISTING_SCHEMA, extractPhotos } = require('./dotmedParser');
const proxyRotator = require('./proxyRotator');
const logger = require('./logger').child({ module: 'firecrawlClient' });

const FIRECRAWL_URL = process.env.FIRECRAWL_URL || 'http://localhost:3002';
const MAX_ATTEMPTS = 3;

function isBlockedResponse(data) {
  const statusCode = data?.metadata?.statusCode;
  const markdown = data?.markdown || '';
  return statusCode === 403
    && (markdown.includes('Performing security verification') || markdown.includes('malicious bots'));
}

function isEmptyExtraction(result) {
  // Photos come from a separate markdown regex, not the AI extraction — their
  // presence doesn't prove the AI actually returned structured data. Require
  // a real extracted field regardless of whether photos were found.
  return !(result.title || result.brand || result.description);
}

async function requestScrape(url) {
  const res = await fetch(`${FIRECRAWL_URL}/v1/scrape`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url,
      formats: ['markdown', 'json'],
      jsonOptions: { schema: LISTING_SCHEMA },
      onlyMainContent: true,
    }),
  });

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
      }
      continue;
    }

    const statusCode = data?.metadata?.statusCode;
    const markdownLen = (data?.markdown || '').length;

    if (!isBlockedResponse(data)) {
      const result = {
        url,
        ...data.json,
        photos: extractPhotos(data.markdown || ''),
      };

      if (!isEmptyExtraction(result)) {
        return result;
      }

      logger.error(
        {
          url,
          attempt,
          maxAttempts: MAX_ATTEMPTS,
          statusCode,
          markdownLen,
          photos: result.photos.length,
          jsonKeys: Object.keys(data?.json || {}),
        },
        'empty extraction',
      );
      lastError = new Error(
        `Порожній результат сканування (HTTP ${statusCode}, markdown ${markdownLen} символів, фото ${result.photos.length})`,
      );
      if (attempt < MAX_ATTEMPTS) {
        onProgress({ stage: 'retrying', attempt, maxAttempts: MAX_ATTEMPTS });
      }
      continue;
    }

    logger.error({ url, attempt, maxAttempts: MAX_ATTEMPTS, statusCode }, 'blocked by Cloudflare');
    lastError = new Error('Заблоковано Cloudflare (security verification)');
    if (attempt < MAX_ATTEMPTS) {
      onProgress({ stage: 'rotating_ip', attempt, maxAttempts: MAX_ATTEMPTS });
      await proxyRotator.rotateIp();
    }
  }

  throw new Error(`Не вдалось відсканувати після ${MAX_ATTEMPTS} спроб: ${lastError.message}`);
}

module.exports = { scrapeListing, isBlockedResponse };
