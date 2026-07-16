const { LISTING_SCHEMA } = require('./dotmedParser');
const logger = require('./logger').child({ module: 'aiExtractor' });

// Real listing pages logged so far run 7-9k chars of markdown — this leaves
// headroom while keeping requests small and within any model's context limit.
const MAX_MARKDOWN_CHARS = 12000;

// Real model responses measured at 3-20s — this is a hang guard, not a
// latency budget. Without it, a stalled (not erroring) provider request
// blocks the single-concurrency worker forever, and now blocks every other
// queued job behind it too. Overridable via env for fast tests.
function getTimeoutMs() {
  return Number(process.env.AI_REQUEST_TIMEOUT_MS) || 30_000;
}

// Seen in production: the provider rate-limits a specific model under load
// from the job queue processing items back-to-back with no gaps. A brief
// pause here gives its per-minute window room before the next attempt
// (whole-scrape retry or the fallback model) fires.
function getRateLimitBackoffMs() {
  return Number(process.env.AI_RATE_LIMIT_BACKOFF_MS) || 3_000;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Captured live from each real API response — providers like Mistral send
// their actual per-minute request/token budget on every call, so this is
// real usage data rather than a hardcoded guess at plan limits.
let lastRateLimitInfo = null;

function captureRateLimitHeaders(model, res) {
  const get = (name) => res.headers.get(name);
  const limitReq = get('x-ratelimit-limit-req-minute') ?? get('x-ratelimit-limit-requests');
  const remainingReq = get('x-ratelimit-remaining-req-minute') ?? get('x-ratelimit-remaining-requests');
  const limitTokens = get('x-ratelimit-limit-tokens-minute') ?? get('x-ratelimit-limit-tokens');
  const remainingTokens = get('x-ratelimit-remaining-tokens-minute') ?? get('x-ratelimit-remaining-tokens');
  if (limitReq == null && limitTokens == null) return; // provider doesn't expose these

  lastRateLimitInfo = {
    model,
    limitRequestsPerMinute: limitReq != null ? Number(limitReq) : null,
    remainingRequestsPerMinute: remainingReq != null ? Number(remainingReq) : null,
    limitTokensPerMinute: limitTokens != null ? Number(limitTokens) : null,
    remainingTokensPerMinute: remainingTokens != null ? Number(remainingTokens) : null,
    updatedAt: new Date().toISOString(),
  };
}

function getRateLimitInfo() {
  return lastRateLimitInfo;
}

function schemaFieldLines(schema) {
  return Object.entries(schema.properties)
    .map(([key, def]) => `- "${key}" (${def.type}): ${def.description}`)
    .join('\n');
}

function buildSystemPrompt(schema) {
  return [
    'You extract structured data from a DOTmed.com medical equipment listing page, given its markdown content.',
    'Respond with ONLY a single JSON object matching the fields below — no prose, no markdown code fences.',
    'Fields:',
    schemaFieldLines(schema),
    `Required fields (always include, use "" or false if genuinely absent from the page): ${schema.required.join(', ')}`,
  ].join('\n');
}

async function callModel(model, markdown) {
  const baseUrl = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const timeoutMs = getTimeoutMs();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let res;
  try {
    res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: buildSystemPrompt(LISTING_SCHEMA) },
          { role: 'user', content: markdown.slice(0, MAX_MARKDOWN_CHARS) },
        ],
        response_format: { type: 'json_object' },
        temperature: 0,
      }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`AI-провайдер не відповів за ${timeoutMs / 1000}с (модель "${model}")`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }

  captureRateLimitHeaders(model, res);

  let body;
  try {
    body = await res.json();
  } catch {
    throw new Error(`Провайдер повернув не-JSON відповідь (HTTP ${res.status}, модель "${model}")`);
  }

  if (!res.ok) {
    const detail = body?.error?.message || JSON.stringify(body).slice(0, 300);
    if (res.status === 429) {
      await sleep(getRateLimitBackoffMs());
    }
    throw new Error(`Виклик до моделі "${model}" не вдався (HTTP ${res.status}): ${detail}`);
  }

  const content = body?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error(`Модель "${model}" не повернула вміст відповіді`);
  }

  try {
    return JSON.parse(content);
  } catch (err) {
    throw new Error(`Модель "${model}" повернула невалідний JSON: ${err.message}`);
  }
}

// Matches firecrawlClient's isEmptyExtraction signal fields — a model can
// return HTTP 200 with syntactically valid JSON whose fields are simply
// blank, which isn't an exception and must still trigger the fallback.
function isEmptyResult(json) {
  return !(json?.title || json?.brand || json?.description);
}

async function extractListingData(markdown, url) {
  const primaryModel = process.env.MODEL_NAME || 'gpt-4';
  const fallbackModel = process.env.MODEL_NAME_FALLBACK;

  let primaryResult;
  try {
    primaryResult = await callModel(primaryModel, markdown);
    if (!isEmptyResult(primaryResult)) return primaryResult;
    logger.error({ url, model: primaryModel }, 'primary model returned valid but all-empty JSON');
  } catch (err) {
    logger.error({ url, model: primaryModel, err }, 'primary model extraction failed');
    if (!fallbackModel) throw err;
  }

  if (!fallbackModel) return primaryResult;

  logger.info({ url, model: fallbackModel }, 'retrying extraction with fallback model');
  try {
    return await callModel(fallbackModel, markdown);
  } catch (fallbackErr) {
    logger.error({ url, model: fallbackModel, err: fallbackErr }, 'fallback model extraction failed');
    if (primaryResult !== undefined) return primaryResult;
    throw fallbackErr;
  }
}

module.exports = { extractListingData, buildSystemPrompt, getRateLimitInfo };
