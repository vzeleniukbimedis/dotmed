const fs = require('fs');
const path = require('path');
const { ProxyAgent } = require('undici');
const { chromium } = require('playwright');
const { getSetting } = require('./settingsStore');
const logger = require('./logger').child({ module: 'dotmedAuth' });

const SESSION_PATH = path.join(__dirname, '..', 'data', 'dotmed-session.json');
const MAX_SESSION_AGE_MS = 12 * 60 * 60 * 1000;
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 3_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// A bare fetch() sends no User-Agent/Accept headers, which Cloudflare's bot
// detection fingerprints and blocks on sight — these make the request look
// like it came from a real browser.
const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

// Without this, requests leave the container on its own datacenter IP —
// rotateIp() would be pointless since it only rotates the IP *behind* this
// proxy, not the container's own address. Same proxy the Firecrawl scraper uses.
function buildProxyDispatcher() {
  const uri = process.env.PROXY_SERVER;
  if (!uri) {
    logger.warn('PROXY_SERVER not set — login requests will go out on the container\'s own IP');
    return undefined;
  }
  const opts = { uri };
  if (process.env.PROXY_USERNAME) {
    opts.token = `Basic ${Buffer.from(`${process.env.PROXY_USERNAME}:${process.env.PROXY_PASSWORD || ''}`).toString('base64')}`;
  }
  return new ProxyAgent(opts);
}

const proxyDispatcher = buildProxyDispatcher();

// Cloudflare serves more than one challenge page depending on how
// suspicious it finds the request — "Attention Required!" is a hard block,
// but "Just a moment..." (its JS/managed challenge interstitial) is just as
// real a block and was slipping through undetected, which silently skipped
// the IP-rotation retry entirely and surfaced a misleading "check your
// credentials" error for what was actually a Cloudflare block.
function isCloudflareBlock(html, status) {
  return status === 403
    && (html.includes('Attention Required')
      || html.includes('cf-turnstile')
      || html.includes('Performing security verification')
      || html.includes('Just a moment')
      || html.includes('challenge-platform'));
}

// DOTmed's login sits behind a Cloudflare JS challenge ("Just a moment...")
// that a plain fetch() can never pass — it requires an actual JS engine to
// run the challenge script. A real (headless) browser solves it the same
// way a human's browser would, then we lift its session cookies back out
// for the rest of the app's plain fetch() calls to reuse.
//
// Deliberately NOT routed through PROXY_SERVER: confirmed live (both in
// production logs and reproduced locally with the same proxy credentials)
// that Cloudflare's challenge script itself makes a follow-up request to
// challenges.cloudflare.com to complete verification, and that request
// fails through this proxy with net::ERR_TUNNEL_CONNECTION_FAILED — the
// interstitial then hangs forever waiting for a verification that can
// never arrive. A real browser's own JS execution + fingerprint is usually
// enough to pass Cloudflare even from a datacenter IP (unlike raw fetch()),
// so going out directly avoids a proxy limitation that only makes this worse.
async function attemptLogin(email, password) {
  // --disable-dev-shm-usage: Docker's default /dev/shm (64MB) is too small
  // for Chromium's shared memory use and crashes it under real load —
  // without this flag the browser works fine locally but dies in the
  // container the moment memory pressure shows up.
  const browser = await chromium.launch({ headless: true, args: ['--disable-dev-shm-usage'] });
  try {
    const context = await browser.newContext({
      userAgent: BROWSER_HEADERS['User-Agent'],
      locale: 'en-US',
    });
    const page = await context.newPage();

    try {
      await page.goto('https://www.dotmed.com/login', { waitUntil: 'domcontentloaded', timeout: 45_000 });
      // If Cloudflare showed a challenge interstitial first, this waits
      // through its client-side redirect to the real login form.
      await page.waitForSelector('input[name="pass"]', { timeout: 30_000 });

      await page.fill('input[name="user"]', email);
      await page.fill('input[name="pass"]', password);
      await Promise.all([
        page.waitForLoadState('domcontentloaded'),
        page.click('input[type="submit"]'),
      ]);

      const check = await page.goto('https://www.dotmed.com/users/my/', { waitUntil: 'domcontentloaded', timeout: 45_000 });
      // Let any challenge interstitial on this page settle before reading it.
      await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {});

      const html = await page.content();
      const titleMatch = html.match(/<title>([^<]*)<\/title>/i);
      const success = html.includes('logout.html');
      const status = check?.status() ?? 0;
      const blocked = !success && isCloudflareBlock(html, status);
      const cookies = (await context.cookies()).map((c) => `${c.name}=${c.value}`);

      if (!success) {
        logger.error(
          {
            status,
            finalUrl: page.url(),
            pageTitle: titleMatch?.[1]?.trim() || null,
            htmlLength: html.length,
            hasLoginForm: html.includes('name="pass"'),
            cloudflareBlock: blocked,
          },
          'login check failed on /users/my/',
        );
      }

      return { success, blocked, cookies };
    } catch (err) {
      // A Playwright action (goto/waitForSelector/etc.) can throw outright —
      // e.g. the login form never appears because the browser got stuck on
      // a challenge interstitial that didn't resolve in time. Without this,
      // that exception would escape attemptLogin entirely and skip login()'s
      // retry+IP-rotation loop, surfacing a raw Playwright timeout to the
      // user instead of the flow already built to recover from exactly this.
      const html = await page.content().catch(() => '');
      const titleMatch = html.match(/<title>([^<]*)<\/title>/i);
      logger.error(
        { err, finalUrl: page.url(), pageTitle: titleMatch?.[1]?.trim() || null, htmlLength: html.length },
        'login flow threw before completing (stuck on interstitial or navigation failure?)',
      );
      const cookies = (await context.cookies().catch(() => [])).map((c) => `${c.name}=${c.value}`);
      return { success: false, blocked: true, cookies };
    }
  } finally {
    await browser.close();
  }
}

async function login() {
  const email = await getSetting('dotmed_email');
  const password = await getSetting('dotmed_password');
  if (!email || !password) {
    throw new Error('Дані для входу на DOTmed не задані (Налаштування → DOTmed логін)');
  }

  logger.info({ email }, 'attempting login');

  // No IP rotation here — the login browser goes out on the container's own
  // IP (see attemptLogin), so retrying just gives the challenge another
  // shot rather than working around an IP-reputation problem.
  let result;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    result = await attemptLogin(email, password);
    if (result.success || !result.blocked) break;

    if (attempt < MAX_ATTEMPTS) {
      logger.info({ attempt, maxAttempts: MAX_ATTEMPTS }, 'blocked by Cloudflare, retrying');
      await sleep(RETRY_DELAY_MS);
    }
  }

  if (!result.success) {
    throw new Error(
      result.blocked
        ? 'DOTmed заблокував запит (Cloudflare) — спробуйте ще раз за хвилину'
        : 'Логін на DOTmed не вдався — перевір дані в Налаштуваннях',
    );
  }

  logger.info('login confirmed');
  fs.mkdirSync(path.dirname(SESSION_PATH), { recursive: true });
  fs.writeFileSync(SESSION_PATH, JSON.stringify({ cookies: result.cookies, createdAt: Date.now() }, null, 2));
  return result.cookies;
}

function loadSession() {
  try {
    const data = JSON.parse(fs.readFileSync(SESSION_PATH, 'utf8'));
    if (Date.now() - data.createdAt > MAX_SESSION_AGE_MS) return null;
    return data.cookies;
  } catch {
    return null;
  }
}

async function ensureSession() {
  return loadSession() || login();
}

async function invalidateAndRelogin() {
  try {
    fs.unlinkSync(SESSION_PATH);
  } catch {
    // no-op: file may not exist
  }
  return login();
}

module.exports = { ensureSession, login, invalidateAndRelogin, SESSION_PATH, BROWSER_HEADERS, proxyDispatcher, isCloudflareBlock };
