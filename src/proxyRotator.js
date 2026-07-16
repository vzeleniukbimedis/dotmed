const { getSetting } = require('./settingsStore');

const COOLDOWN_MS = 25_000;
const PROPAGATION_DELAY_MS = 12_000;

let lastRotatedAt = 0;
let inFlight = null;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function rotateIp() {
  const changeIpUrl = await getSetting('proxy_change_ip_url');
  if (!changeIpUrl) {
    throw new Error('PROXY_CHANGE_IP_URL не задано (ні в налаштуваннях, ні в .env)');
  }

  const sinceLastRotation = Date.now() - lastRotatedAt;
  if (sinceLastRotation < COOLDOWN_MS) {
    return; // another caller rotated recently enough, skip
  }
  if (inFlight) {
    return inFlight;
  }

  inFlight = (async () => {
    try {
      await fetch(changeIpUrl);
      lastRotatedAt = Date.now();
      await sleep(PROPAGATION_DELAY_MS);
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

module.exports = { rotateIp };
