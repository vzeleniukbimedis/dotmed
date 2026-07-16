const fs = require('fs');
const path = require('path');
const { getSetting } = require('./settingsStore');

const SESSION_PATH = path.join(__dirname, '..', 'data', 'dotmed-session.json');
const MAX_SESSION_AGE_MS = 12 * 60 * 60 * 1000;

function parseSetCookies(res) {
  const raw = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  return raw.map((c) => c.split(';')[0]);
}

function mergeCookies(existing, incoming) {
  const map = new Map(existing.map((c) => [c.split('=')[0], c]));
  for (const c of incoming) map.set(c.split('=')[0], c);
  return [...map.values()];
}

async function login() {
  const email = await getSetting('dotmed_email');
  const password = await getSetting('dotmed_password');
  if (!email || !password) {
    throw new Error('Дані для входу на DOTmed не задані (Налаштування → DOTmed логін)');
  }

  let cookies = [];

  const loginPage = await fetch('https://www.dotmed.com/login', { redirect: 'manual' });
  cookies = mergeCookies(cookies, parseSetCookies(loginPage));

  const body = new URLSearchParams({ user: email, pass: password, refer: '', backfromssl: '0' });
  const res = await fetch('https://www.dotmed.com/login.html', {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: cookies.join('; '),
    },
    body: body.toString(),
  });
  cookies = mergeCookies(cookies, parseSetCookies(res));

  const check = await fetch('https://www.dotmed.com/users/my/', {
    headers: { Cookie: cookies.join('; ') },
    redirect: 'follow',
  });
  const html = await check.text();
  if (!html.includes('logout.html')) {
    throw new Error('Логін на DOTmed не вдався — перевір дані в Налаштуваннях');
  }

  fs.mkdirSync(path.dirname(SESSION_PATH), { recursive: true });
  fs.writeFileSync(SESSION_PATH, JSON.stringify({ cookies, createdAt: Date.now() }, null, 2));
  return cookies;
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

module.exports = { ensureSession, login, invalidateAndRelogin, SESSION_PATH };
