const express = require('express');
const session = require('express-session');
const path = require('path');
const jobStore = require('./jobStore');
const { runJob, resumeJob, pauseJob, unpauseJob, stopJob, getRunState } = require('./jobRunner');
const { isStorefrontUrl } = require('./dotmedParser');
const { discoverListings } = require('./storefrontScraper');
const { verifyGoogleToken, getAllowlist, requireAuth } = require('./auth');
const settingsStore = require('./settingsStore');

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

app.get('/api/settings', async (req, res) => {
  res.json(await settingsStore.getAllSettings());
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

async function expandUrls(urls, types) {
  const entries = [];
  for (const url of urls) {
    if (!isStorefrontUrl(url)) {
      entries.push({ url });
      continue;
    }
    try {
      const listingUrls = await discoverListings(url, types);
      if (listingUrls.length === 0) {
        entries.push({ url, error: 'У продавця не знайдено оголошень для обраних типів (Обладнання/Запчастини).' });
      } else {
        entries.push(...listingUrls.map((u) => ({ url: u })));
      }
    } catch (err) {
      entries.push({ url, error: err.message });
    }
  }
  return entries;
}

app.post('/api/jobs', async (req, res) => {
  const urls = (req.body.urls || [])
    .map((u) => String(u).trim())
    .filter(Boolean);
  const types = Array.isArray(req.body.types) && req.body.types.length
    ? req.body.types
    : ['equipment', 'parts'];

  if (urls.length === 0) {
    return res.status(400).json({ error: 'No URLs provided' });
  }

  let entries;
  try {
    entries = await expandUrls(urls, types);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }

  const job = await jobStore.createJob(entries, req.session.user.email);
  runJob(job).catch((err) => console.error('Job failed:', err));
  res.json({ jobId: job.id });
});

app.get('/api/jobs', async (req, res) => {
  res.json({ jobs: await jobStore.listJobs(req.session.user.email) });
});

async function loadOwnedJob(req, res) {
  const job = await jobStore.loadJob(req.params.id);
  if (!job || job.ownerEmail !== req.session.user.email) {
    res.status(404).json({ error: 'Job not found' });
    return null;
  }
  return job;
}

app.get('/api/jobs/:id', async (req, res) => {
  const job = await loadOwnedJob(req, res);
  if (!job) return;
  res.json({ ...job, runState: getRunState(job.id) });
});

app.post('/api/jobs/:id/resume', async (req, res) => {
  const job = await loadOwnedJob(req, res);
  if (!job) return;
  resumeJob(job).catch((err) => console.error('Resume failed:', err));
  res.json({ ...job, runState: getRunState(job.id) });
});

app.post('/api/jobs/:id/pause', async (req, res) => {
  const job = await loadOwnedJob(req, res);
  if (!job) return;
  pauseJob(job.id);
  res.json({ runState: getRunState(job.id) });
});

app.post('/api/jobs/:id/unpause', async (req, res) => {
  const job = await loadOwnedJob(req, res);
  if (!job) return;
  unpauseJob(job.id);
  res.json({ runState: getRunState(job.id) });
});

app.post('/api/jobs/:id/stop', async (req, res) => {
  const job = await loadOwnedJob(req, res);
  if (!job) return;
  stopJob(job.id);
  res.json({ runState: getRunState(job.id) });
});

app.delete('/api/jobs/:id/items', async (req, res) => {
  const job = await loadOwnedJob(req, res);
  if (!job) return;
  const { url } = req.body || {};
  if (!url) return res.status(400).json({ error: 'Missing url' });
  await jobStore.deleteItem(job.id, url);
  const updated = await jobStore.loadJob(job.id);
  res.json({ ...updated, runState: getRunState(job.id) });
});

async function recoverInterruptedJobs() {
  const jobIds = await jobStore.recoverOrphanedItems();
  for (const jobId of jobIds) {
    const job = await jobStore.loadJob(jobId);
    if (!job) continue;
    console.log(`Recovering job ${jobId} interrupted by a previous restart/crash`);
    resumeJob(job).catch((err) => console.error(`Auto-recovery failed for job ${jobId}:`, err));
  }
}

recoverInterruptedJobs().catch((err) => console.error('Startup recovery failed:', err));

app.listen(PORT, () => {
  console.log(`DOTmed parser running at http://localhost:${PORT}`);
});
