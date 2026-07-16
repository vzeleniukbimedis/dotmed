const dotmedAuth = require('./dotmedAuth');

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

function extractListingLinks(html) {
  const matches = html.matchAll(/href="(\/listing\/[^"]+)"/g);
  const paths = [...new Set([...matches].map((m) => m[1]))];
  return paths.map((p) => `https://www.dotmed.com${p}`);
}

async function fetchStorePage(sellerId, type, offset, cookies) {
  const url = `https://www.dotmed.com/webstore/?user=${sellerId}&type=${type}&mode=all&order=&sort=&listings_per_page=${LISTINGS_PER_PAGE}&offset=${offset}`;
  const res = await fetch(url, { headers: { Cookie: cookies.join('; ') } });
  return res.text();
}

async function fetchTypeListings(sellerId, type, cookies) {
  const urls = [];
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

    const links = extractListingLinks(html);
    urls.push(...links);

    if (links.length < LISTINGS_PER_PAGE) break;
    offset += LISTINGS_PER_PAGE;
  }
  return urls;
}

async function discoverListings(storefrontUrl, types = ['equipment', 'parts']) {
  const sellerId = extractSellerId(storefrontUrl);
  if (!sellerId) {
    throw new Error('Не вдалось визначити ID продавця з цього лінку');
  }

  const cookies = await dotmedAuth.ensureSession();

  const all = [];
  for (const type of types) {
    const urls = await fetchTypeListings(sellerId, type, cookies);
    all.push(...urls);
  }
  return [...new Set(all)];
}

module.exports = { discoverListings, extractSellerId };
