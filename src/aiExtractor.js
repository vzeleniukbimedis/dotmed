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

// Seen in production: a provider rate-limits under load from the job queue
// processing items back-to-back with no gaps. A brief pause here gives its
// per-minute window room before the next attempt (next model, or the next
// provider entirely) fires.
function getRateLimitBackoffMs() {
  return Number(process.env.AI_RATE_LIMIT_BACKOFF_MS) || 3_000;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Multiple independent AI providers, tried in order — when one is rate-
// limited, out of quota, or down, extraction automatically moves to the
// next. Provider 1 keeps the original env var names for backward
// compatibility; providers 2+ follow AI_PROVIDER{n}_*.
function getProviders() {
  const providers = [];

  if (process.env.OPENAI_BASE_URL && process.env.OPENAI_API_KEY && process.env.MODEL_NAME) {
    const models = [process.env.MODEL_NAME];
    if (process.env.MODEL_NAME_FALLBACK) models.push(process.env.MODEL_NAME_FALLBACK);
    providers.push({ name: 'provider1', baseUrl: process.env.OPENAI_BASE_URL, apiKey: process.env.OPENAI_API_KEY, models });
  }

  for (let i = 2; i <= 9; i++) {
    const baseUrl = process.env[`AI_PROVIDER${i}_BASE_URL`];
    const apiKey = process.env[`AI_PROVIDER${i}_API_KEY`];
    const model = process.env[`AI_PROVIDER${i}_MODEL`];
    if (!baseUrl || !apiKey || !model) continue;

    const models = [model];
    const fallback = process.env[`AI_PROVIDER${i}_MODEL_FALLBACK`];
    if (fallback) models.push(fallback);
    providers.push({ name: `provider${i}`, baseUrl, apiKey, models });
  }

  return providers;
}

// Captured live from each real API response — providers like Mistral/Groq
// send their actual per-minute request/token budget on every call, so this
// is real usage data rather than a hardcoded guess at plan limits.
let lastRateLimitInfo = null;

function captureRateLimitHeaders(providerName, model, res) {
  const get = (name) => res.headers.get(name);
  const limitReq = get('x-ratelimit-limit-req-minute') ?? get('x-ratelimit-limit-requests');
  const remainingReq = get('x-ratelimit-remaining-req-minute') ?? get('x-ratelimit-remaining-requests');
  const limitTokens = get('x-ratelimit-limit-tokens-minute') ?? get('x-ratelimit-limit-tokens');
  const remainingTokens = get('x-ratelimit-remaining-tokens-minute') ?? get('x-ratelimit-remaining-tokens');
  if (limitReq == null && limitTokens == null) return; // provider doesn't expose these

  lastRateLimitInfo = {
    provider: providerName,
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

async function callModel(provider, model, input, { systemPrompt, maxTokens, maxInputChars } = {}) {
  const baseUrl = provider.baseUrl.replace(/\/+$/, '');
  const timeoutMs = getTimeoutMs();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let res;
  try {
    res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${provider.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt || buildSystemPrompt(LISTING_SCHEMA) },
          { role: 'user', content: input.slice(0, maxInputChars || MAX_MARKDOWN_CHARS) },
        ],
        response_format: { type: 'json_object' },
        temperature: 0,
        ...(maxTokens ? { max_tokens: maxTokens } : {}),
      }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`AI-провайдер не відповів за ${timeoutMs / 1000}с (${provider.name}, модель "${model}")`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }

  captureRateLimitHeaders(provider.name, model, res);

  let body;
  try {
    body = await res.json();
  } catch {
    throw new Error(`Провайдер повернув не-JSON відповідь (HTTP ${res.status}, ${provider.name}, модель "${model}")`);
  }

  if (!res.ok) {
    const detail = body?.error?.message || JSON.stringify(body).slice(0, 300);
    if (res.status === 429) {
      await sleep(getRateLimitBackoffMs());
    }
    throw new Error(`Виклик до ${provider.name} (${model}) не вдався (HTTP ${res.status}): ${detail}`);
  }

  const content = body?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error(`${provider.name} (${model}) не повернув вміст відповіді`);
  }

  try {
    return JSON.parse(content);
  } catch (err) {
    throw new Error(`${provider.name} (${model}) повернув невалідний JSON: ${err.message}`);
  }
}

// Matches firecrawlClient's isEmptyExtraction signal fields — a model can
// return HTTP 200 with syntactically valid JSON whose fields are simply
// blank, which isn't an exception and must still trigger the next attempt.
function isEmptyResult(json) {
  return !(json?.title || json?.brand || json?.description);
}

// Tries every configured model on every configured provider, in order,
// stopping at the first real (non-empty) success. A provider that's out of
// quota, rate-limited, or down just gets skipped in favor of the next one.
async function extractListingData(markdown, url) {
  const providers = getProviders();
  if (providers.length === 0) {
    throw new Error('Не налаштовано жодного AI-провайдера (OPENAI_BASE_URL/OPENAI_API_KEY/MODEL_NAME)');
  }

  let lastEmptyResult;
  let lastError;

  for (const provider of providers) {
    for (const model of provider.models) {
      try {
        const result = await callModel(provider, model, markdown);
        if (!isEmptyResult(result)) return result;
        lastEmptyResult = result;
        logger.error({ url, provider: provider.name, model }, 'returned valid but all-empty JSON');
      } catch (err) {
        lastError = err;
        logger.error({ url, provider: provider.name, model, err }, 'extraction attempt failed');
      }
    }
  }

  if (lastEmptyResult !== undefined) return lastEmptyResult;
  throw lastError;
}

// Storefront pages list many items on one page — a regex over the raw HTML
// is brittle (dotmed's markup for this varies in ways we don't fully know),
// so this hands the (cleaned, trimmed) page HTML to the same model chain and
// asks it to read off every listing's url/title/price directly, the way a
// person skimming the page would.
const STOREFRONT_MAX_HTML_CHARS = 60_000;
const STOREFRONT_MAX_TOKENS = 6_000;

function cleanStorefrontHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<head[\s\S]*?<\/head>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/[ \t]{2,}/g, ' ');
}

function buildStorefrontSystemPrompt() {
  return [
    'You read a DOTmed.com seller storefront page (raw HTML) listing multiple medical equipment/parts items for sale.',
    'Each item appears in a block similar to this real example:',
    '<div id="listing_5582241_" ...><h4><a href="/listing/podiatric-x-ray/curvebeam/ped-cat/5582241">CurveBeam Ped CAT Podiatric X-Ray For Sale</a></h4> ... <span class="price">$15,950 USD</span> ... </div>',
    'For EVERY item block found anywhere on the page, extract:',
    '- "url": the href starting with /listing/, made absolute as "https://www.dotmed.com" + href',
    '- "title": the link text inside the <h4>',
    '- "price": the text inside the price element exactly as shown, "" if genuinely absent',
    'Do not skip any item, and do not invent items that are not on the page.',
    'Respond with ONLY a JSON object: {"items": [{"url": "...", "title": "...", "price": "..."}, ...]}',
  ].join('\n');
}

async function extractStorefrontListings(html, pageUrl) {
  const providers = getProviders();
  if (providers.length === 0) {
    throw new Error('Не налаштовано жодного AI-провайдера (OPENAI_BASE_URL/OPENAI_API_KEY/MODEL_NAME)');
  }

  const cleaned = cleanStorefrontHtml(html);
  const systemPrompt = buildStorefrontSystemPrompt();

  let lastError;
  for (const provider of providers) {
    for (const model of provider.models) {
      try {
        const result = await callModel(provider, model, cleaned, {
          systemPrompt,
          maxTokens: STOREFRONT_MAX_TOKENS,
          maxInputChars: STOREFRONT_MAX_HTML_CHARS,
        });
        const items = Array.isArray(result?.items) ? result.items : [];
        if (items.length > 0) return items;
        logger.error({ pageUrl, provider: provider.name, model }, 'storefront page extraction returned no items');
      } catch (err) {
        lastError = err;
        logger.error({ pageUrl, provider: provider.name, model, err }, 'storefront listing extraction attempt failed');
      }
    }
  }

  if (lastError) throw lastError;
  return [];
}

module.exports = { extractListingData, extractStorefrontListings, buildSystemPrompt, getRateLimitInfo, getProviders };
