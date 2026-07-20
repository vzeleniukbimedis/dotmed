// Property-access, not destructured, so tests can monkey-patch
// settingsStore.getSetting without proxyRotator holding a stale reference.
const settingsStore = require('./settingsStore');

// Overridable via env so tests don't have to wait out real 25s/12s delays.
function getCooldownMs() {
  return Number(process.env.PROXY_ROTATE_COOLDOWN_MS) || 25_000;
}
function getPropagationDelayMs() {
  return Number(process.env.PROXY_ROTATE_PROPAGATION_DELAY_MS) || 12_000;
}

let lastRotatedAt = 0;
let inFlight = null;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function rotateIp() {
  const changeIpUrl = await settingsStore.getSetting('proxy_change_ip_url');
  if (!changeIpUrl) {
    throw new Error('PROXY_CHANGE_IP_URL не задано (ні в налаштуваннях, ні в .env)');
  }

  if (inFlight) {
    return inFlight;
  }

  inFlight = (async () => {
    try {
      // Below the cooldown, the previous rotation is recent enough that
      // calling the provider again could fail/no-op — but a caller reaching
      // rotateIp() has already hit a fresh block and genuinely needs a new
      // IP, so wait out the remainder rather than silently skipping (this
      // used to make a login retry loop's 2nd/3rd attempt reuse the exact
      // same still-blocked IP instead of ever getting a new one).
      const sinceLastRotation = Date.now() - lastRotatedAt;
      const cooldownMs = getCooldownMs();
      if (sinceLastRotation < cooldownMs) {
        await sleep(cooldownMs - sinceLastRotation);
      }
      await fetch(changeIpUrl);
      lastRotatedAt = Date.now();
      await sleep(getPropagationDelayMs());
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

module.exports = { rotateIp };
