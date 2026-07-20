const { test, mock } = require('node:test');
const assert = require('node:assert/strict');
const settingsStore = require('../src/settingsStore');

// proxyRotator keeps lastRotatedAt/inFlight as module-level state — a fresh
// require per test keeps each test's timing independent of the others.
function freshProxyRotator() {
  delete require.cache[require.resolve('../src/proxyRotator')];
  return require('../src/proxyRotator');
}

// mock.timers only fires callbacks already scheduled at tick() time — a
// setTimeout scheduled after an intervening `await fetch(...)` needs a real
// microtask flush first so tick() can see it.
const flush = () => new Promise((resolve) => setImmediate(resolve));

test('rotateIp calls the provider endpoint to request a new IP', async (t) => {
  const proxyRotator = freshProxyRotator();
  const originalGetSetting = settingsStore.getSetting;
  const originalFetch = global.fetch;
  settingsStore.getSetting = async () => 'https://proxy.test/change-ip';
  let fetchCalls = 0;
  global.fetch = async () => { fetchCalls++; return { ok: true }; };
  mock.timers.enable({ apis: ['setTimeout'] });

  t.after(() => {
    settingsStore.getSetting = originalGetSetting;
    global.fetch = originalFetch;
    mock.timers.reset();
  });

  const rotation = proxyRotator.rotateIp();
  await flush();
  mock.timers.tick(15_000); // past the propagation delay
  await rotation;

  assert.equal(fetchCalls, 1);
});

test('a second rotateIp call within the cooldown window still triggers a genuine new rotation instead of silently skipping', async (t) => {
  // Regression test: this cooldown used to make a login retry loop's 2nd/3rd
  // attempt silently reuse the exact same still-blocked IP, because a call
  // arriving before the cooldown elapsed just returned without rotating.
  const proxyRotator = freshProxyRotator();
  const originalGetSetting = settingsStore.getSetting;
  const originalFetch = global.fetch;
  settingsStore.getSetting = async () => 'https://proxy.test/change-ip';
  let fetchCalls = 0;
  global.fetch = async () => { fetchCalls++; return { ok: true }; };
  mock.timers.enable({ apis: ['setTimeout'] });

  t.after(() => {
    settingsStore.getSetting = originalGetSetting;
    global.fetch = originalFetch;
    mock.timers.reset();
  });

  const first = proxyRotator.rotateIp();
  await flush();
  mock.timers.tick(15_000);
  await first;
  assert.equal(fetchCalls, 1);

  // Called immediately after — well inside the cooldown window.
  const second = proxyRotator.rotateIp();
  await flush();
  mock.timers.tick(25_000); // cooldown wait
  await flush();
  mock.timers.tick(15_000); // fetch, then propagation delay
  await second;
  assert.equal(fetchCalls, 2, 'must actually rotate again, not skip and reuse the same IP');
});

test('concurrent rotateIp calls share a single in-flight rotation', async (t) => {
  const proxyRotator = freshProxyRotator();
  const originalGetSetting = settingsStore.getSetting;
  const originalFetch = global.fetch;
  settingsStore.getSetting = async () => 'https://proxy.test/change-ip';
  let fetchCalls = 0;
  global.fetch = async () => { fetchCalls++; return { ok: true }; };
  mock.timers.enable({ apis: ['setTimeout'] });

  t.after(() => {
    settingsStore.getSetting = originalGetSetting;
    global.fetch = originalFetch;
    mock.timers.reset();
  });

  const a = proxyRotator.rotateIp();
  const b = proxyRotator.rotateIp();
  await flush();
  mock.timers.tick(15_000);
  await Promise.all([a, b]);

  assert.equal(fetchCalls, 1, 'two overlapping callers must not each trigger their own rotation');
});

test('rotateIp throws when no change-ip URL is configured', async () => {
  const proxyRotator = freshProxyRotator();
  const originalGetSetting = settingsStore.getSetting;
  settingsStore.getSetting = async () => null;

  try {
    await assert.rejects(() => proxyRotator.rotateIp(), /PROXY_CHANGE_IP_URL/);
  } finally {
    settingsStore.getSetting = originalGetSetting;
  }
});
