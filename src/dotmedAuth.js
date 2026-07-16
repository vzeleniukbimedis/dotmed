const fs = require('fs');
const path = require('path');
const { ProxyAgent } = require('undici');
const { getSetting } = require('./settingsStore');
const proxyRotator = require('./proxyRotator');
const logger = require('./logger').child({ module: 'dotmedAuth' });

const SESSION_PATH = path.join(__dirname, '..', 'data', 'dotmed-session.json');
const MAX_SESSION_AGE_MS = 12 * 60 * 60 * 1000;
const MAX_ATTEMPTS = 3;

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

function parseSetCookies(res) {
  const raw = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  return raw.map((c) => c.split(';')[0]);
}

function mergeCookies(existing, incoming) {
  const map = new Map(existing.map((c) => [c.split('=')[0], c]));
  for (const c of incoming) map.set(c.split('=')[0], c);
  return [...map.values()];
}

function isCloudflareBlock(html, status) {
  return status === 403
    && (html.includes('Attention Required') || html.includes('cf-turnstile') || html.includes('Performing security verification'));
}

async function attemptLogin(email, password) {
  let cookies = [];

  const loginPage = await fetch('https://www.dotmed.com/login', {
    redirect: 'manual',
    headers: BROWSER_HEADERS,
    dispatcher: proxyDispatcher,
  });
  cookies = mergeCookies(cookies, parseSetCookies(loginPage));
  logger.debug({ status: loginPage.status, cookieNames: cookies.map((c) => c.split('=')[0]) }, 'fetched login page');

  const body = new URLSearchParams({ user: email, pass: password, refer: '', backfromssl: '0' });
  const res = await fetch('https://www.dotmed.com/login.html', {
    method: 'POST',
    redirect: 'manual',
    headers: {
      ...BROWSER_HEADERS,
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: cookies.join('; '),
    },
    body: body.toString(),
    dispatcher: proxyDispatcher,
  });
  cookies = mergeCookies(cookies, parseSetCookies(res));
  logger.debug(
    { status: res.status, location: res.headers.get('location'), cookieNames: cookies.map((c) => c.split('=')[0]) },
    'submitted login form',
  );

  const check = await fetch('https://www.dotmed.com/users/my/', {
    headers: { ...BROWSER_HEADERS, Cookie: cookies.join('; ') },
    redirect: 'follow',
    dispatcher: proxyDispatcher,
  });
  const html = await check.text();
  const titleMatch = html.match(/<title>([^<]*)<\/title>/i);
  const success = html.includes('logout.html');
  const blocked = !success && isCloudflareBlock(html, check.status);

  if (!success) {
    logger.error(
      {
        status: check.status,
        finalUrl: check.url,
        pageTitle: titleMatch?.[1]?.trim() || null,
        htmlLength: html.length,
        hasLoginForm: html.includes('name="pass"'),
        cloudflareBlock: blocked,
      },
      'login check failed on /users/my/',
    );
  }

  return { success, blocked, cookies };
}

async function login() {
  const email = await getSetting('dotmed_email');
  const password = await getSetting('dotmed_password');
  if (!email || !password) {
    throw new Error('Дані для входу на DOTmed не задані (Налаштування → DOTmed логін)');
  }

  logger.info({ email }, 'attempting login');

  let result;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    result = await attemptLogin(email, password);
    if (result.success || !result.blocked) break;

    if (attempt < MAX_ATTEMPTS) {
      logger.info({ attempt, maxAttempts: MAX_ATTEMPTS }, 'blocked by Cloudflare, rotating IP and retrying');
      try {
        await proxyRotator.rotateIp();
      } catch (err) {
        logger.error({ err }, 'IP rotation failed, retrying without it');
      }
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

module.exports = { ensureSession, login, invalidateAndRelogin, SESSION_PATH, BROWSER_HEADERS, proxyDispatcher };
