const express = require('express');
const session = require('express-session');
const path = require('path');
const jobStore = require('./jobStore');
const { runJob, resumeJob, pauseJob, unpauseJob, stopJob, getRunState, getQueuePosition } = require('./jobRunner');
const { isStorefrontUrl } = require('./dotmedParser');
const { discoverListings, discoverListingSummaries } = require('./storefrontScraper');
const dotmedAuth = require('./dotmedAuth');
const { verifyGoogleToken, getAllowlist, requireAuth } = require('./auth');
const settingsStore = require('./settingsStore');
const aiExtractor = require('./aiExtractor');
const logger = require('./logger').child({ module: 'server' });

const app = express();
const PORT = process.env.PORT || 4000;

app.set('trust proxy', 1);
app.use(express.json());

app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    // Separate from NODE_ENV on purpose: this app is often deployed behind a
    // plain-HTTP LAN address (no public DNS -> no Let's Encrypt cert possible),
    // where a hardcoded "secure in production" cookie would silently break login.
    secure: process.env.COOKIE_SECURE === 'true',
    maxAge: 30 * 24 * 60 * 60 * 1000,
  },
  // Intentional: in-memory session store. Only 2 users — losing sessions on
  // redeploy/restart is an acceptable tradeoff, no Redis/DB needed for this.
}));

app.get('/healthz', (req, res) => res.status(200).send('ok'));

app.post('/api/auth/google', async (req, res) => {
  const { credential } = req.body;
  if (!credential) return res.status(400).json({ error: 'Missing credential' });

  let payload;
  try {
    payload = await verifyGoogleToken(credential);
  } catch {
    return res.status(401).json({ error: 'Invalid Google token' });
  }

  const email = (payload.email || '').toLowerCase();
  const allowlist = await getAllowlist();
  if (!payload.email_verified || !allowlist.includes(email)) {
    return res.status(403).json({ error: 'Цей акаунт не має доступу до інструменту.' });
  }

  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: 'Session error' });
    req.session.user = { email, name: payload.name, picture: payload.picture };
    res.json({ user: req.session.user });
  });
});

app.get('/api/auth/me', (req, res) => {
  res.json({ user: req.session.user || null });
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.use(express.static(path.join(__dirname, '..', 'public')));

app.use('/api/jobs', requireAuth);
app.use('/api/settings', requireAuth);
app.use('/api/ai-limits', requireAuth);

app.get('/api/settings', async (req, res) => {
  res.json(await settingsStore.getAllSettings());
});

// Live per-minute request/token budget as last reported by the AI provider's
// own response headers (not a hardcoded plan description) — null until the
// first real extraction call happens after boot.
app.get('/api/ai-limits', (req, res) => {
  res.json(aiExtractor.getRateLimitInfo());
});

app.put('/api/settings', async (req, res) => {
  const updates = req.body || {};
  const unknownKeys = Object.keys(updates).filter((k) => !settingsStore.KNOWN_KEYS.includes(k));
  if (unknownKeys.length > 0) {
    return res.status(400).json({ error: `Невідомі поля: ${unknownKeys.join(', ')}` });
  }

  for (const key of settingsStore.KNOWN_KEYS) {
    const value = updates[key];
    if (value === undefined || value === '') continue;
    await settingsStore.setSetting(key, String(value));
  }

  res.json(await settingsStore.getAllSettings());
});

// mode 'simplified' reads title/price straight off the seller's storefront
// page (no per-item Firecrawl+AI scrape) — items come back already
// 'success', never queued for scraping. mode 'full' (default) is the
// existing behavior: just discover the listing URLs, scrape each one.
async function expandStorefront(url, types, mode) {
  try {
    if (mode === 'simplified') {
      const summaries = await discoverListingSummaries(url, types);
      if (summaries.length === 0) {
        return [{ url, error: 'У продавця не знайдено оголошень для обраних типів (Обладнання/Запчастини).' }];
      }
      return summaries.map((s) => ({
        url: s.url,
        data: { title: s.title, price: s.price, condition: '', description: '', isPart: false, photos: [] },
      }));
    }

    const listingUrls = await discoverListings(url, types);
    if (listingUrls.length === 0) {
      return [{ url, error: 'У продавця не знайдено оголошень для обраних типів (Обладнання/Запчастини).' }];
    }
    return listingUrls.map((u) => ({ url: u }));
  } catch (err) {
    return [{ url, error: err.message }];
  }
}

// Discovering a storefront's listings (paginating + AI-reading each page) can
// take minutes for a large seller — run it after the job is created rather
// than awaiting it inline, so a slow scan never blocks the HTTP response
// long enough to hit the reverse proxy's own request timeout (which surfaces
// to the client as an HTML error page failing to parse as JSON).
async function runStorefrontDiscovery(jobId, storefrontUrl, types, mode) {
  const entries = await expandStorefront(storefrontUrl, types, mode);
  const job = await jobStore.completeDiscovery(jobId, entries);
  runJob(job);
}

// Each storefront becomes its own job (independent progress/pause/export);
// direct listing links submitted together share one job. Jobs run one at a
// time (see jobRunner's queue) rather than in parallel, so submitting
// several sellers at once doesn't hammer dotmed.com with concurrent requests.
app.post('/api/jobs', async (req, res) => {
  const urls = (req.body.urls || [])
    .map((u) => String(u).trim())
    .filter(Boolean);
  const types = Array.isArray(req.body.types) && req.body.types.length
    ? req.body.types
    : ['equipment', 'parts'];
  const mode = req.body.mode === 'simplified' ? 'simplified' : 'full';

  if (urls.length === 0) {
    return res.status(400).json({ error: 'No URLs provided' });
  }

  const storefrontUrls = urls.filter(isStorefrontUrl);
  const directUrls = urls.filter((u) => !isStorefrontUrl(u));

  let jobIds;
  try {
    jobIds = [];
    for (const storefrontUrl of storefrontUrls) {
      const job = await jobStore.createJob([], req.session.user.email, {
        discoveryStatus: 'pending', discoveryUrl: storefrontUrl, discoveryTypes: types, discoveryMode: mode, mode,
      });
      runStorefrontDiscovery(job.id, storefrontUrl, types, mode)
        .catch((err) => logger.error({ jobId: job.id, err }, 'storefront discovery failed'));
      jobIds.push(job.id);
    }
    if (directUrls.length > 0) {
      const job = await jobStore.createJob(directUrls.map((url) => ({ url })), req.session.user.email);
      runJob(job);
      jobIds.push(job.id);
    }
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }

  res.json({ jobIds });
});

app.get('/api/jobs', async (req, res) => {
  const jobs = await jobStore.listJobs(req.session.user.email);
  res.json({
    jobs: jobs.map((j) => ({ ...j, runState: getRunState(j.id), queuePosition: getQueuePosition(j.id) })),
  });
});

// Full job load (with items) — only for routes that actually need the item
// rows (initial/paginated display, resume's pending/error scan).
async function loadOwnedJob(req, res, jobOptions) {
  const job = await jobStore.loadJob(req.params.id, jobOptions);
  if (!job || job.ownerEmail !== req.session.user.email) {
    res.status(404).json({ error: 'Job not found' });
    return null;
  }
  return job;
}

// Cheap ownership check for control routes (pause/unpause/stop/delete) that
// don't need item rows at all — avoids loading/serializing tens of thousands
// of items just to flip a control flag on a large storefront job.
async function checkOwnership(req, res) {
  const ownerEmail = await jobStore.getJobOwner(req.params.id);
  if (!ownerEmail || ownerEmail !== req.session.user.email) {
    res.status(404).json({ error: 'Job not found' });
    return false;
  }
  return true;
}

app.get('/api/jobs/:id', async (req, res) => {
  const limit = req.query.limit != null ? parseInt(req.query.limit, 10) : undefined;
  const offset = req.query.offset != null ? parseInt(req.query.offset, 10) : 0;
  const job = await loadOwnedJob(req, res, { offset, limit });
  if (!job) return;
  res.json({ ...job, runState: getRunState(job.id), queuePosition: getQueuePosition(job.id) });
});

app.post('/api/jobs/:id/resume', async (req, res) => {
  const job = await loadOwnedJob(req, res);
  if (!job) return;
  resumeJob(job);
  res.json({ runState: getRunState(job.id) });
});

app.post('/api/jobs/:id/pause', async (req, res) => {
  if (!(await checkOwnership(req, res))) return;
  pauseJob(req.params.id);
  res.json({ runState: getRunState(req.params.id) });
});

app.post('/api/jobs/:id/unpause', async (req, res) => {
  if (!(await checkOwnership(req, res))) return;
  unpauseJob(req.params.id);
  res.json({ runState: getRunState(req.params.id) });
});

app.post('/api/jobs/:id/stop', async (req, res) => {
  if (!(await checkOwnership(req, res))) return;
  await stopJob(req.params.id);
  res.json({ runState: getRunState(req.params.id) });
});

app.delete('/api/jobs/:id/items', async (req, res) => {
  if (!(await checkOwnership(req, res))) return;
  const { url } = req.body || {};
  if (!url) return res.status(400).json({ error: 'Missing url' });
  await jobStore.deleteItem(req.params.id, url);
  res.json({ ok: true });
});

app.delete('/api/jobs/:id', async (req, res) => {
  if (!(await checkOwnership(req, res))) return;
  await stopJob(req.params.id); // cancel first if still queued/running
  await jobStore.deleteJob(req.params.id);
  res.json({ ok: true });
});

async function recoverInterruptedJobs() {
  const jobIds = await jobStore.findIncompleteJobs();
  for (const jobId of jobIds) {
    const job = await jobStore.loadJob(jobId);
    if (!job) continue;
    logger.info({ jobId }, 'recovering incomplete job (interrupted or never started before restart)');
    runJob(job); // enqueues in creation order — sequential, not all-at-once
  }

  const stuckDiscoveries = await jobStore.findStuckDiscoveries();
  for (const { id, url, types, mode } of stuckDiscoveries) {
    logger.info({ jobId: id, url }, 'resuming storefront discovery interrupted by restart');
    runStorefrontDiscovery(id, url, types, mode)
      .catch((err) => logger.error({ jobId: id, err }, 'storefront discovery failed'));
  }
}

dotmedAuth.seedSessionFromEnv();
recoverInterruptedJobs().catch((err) => logger.error({ err }, 'startup recovery failed'));

app.listen(PORT, () => {
  logger.info({ port: PORT }, 'DOTmed parser running');
});
