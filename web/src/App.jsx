import { useEffect, useRef, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { Menu, X } from 'lucide-react';
import Sidebar from './components/Sidebar.jsx';
import LoginGate from './components/LoginGate.jsx';
import ScannerPage from './pages/ScannerPage.jsx';
import HistoryPage from './pages/HistoryPage.jsx';
import TeamPage from './pages/TeamPage.jsx';
import SettingsPage from './pages/SettingsPage.jsx';
import {
  createJob, getJob, listJobs,
  pauseJob as pauseJobApi, unpauseJob as unpauseJobApi, stopJob as stopJobApi,
  resumeJob as resumeJobApi, deleteJobItem,
} from './lib/api.js';
import { fetchMe, loginWithGoogle, logout } from './lib/auth.js';

const POLL_INTERVAL_MS = 1500;
const TICK_INTERVAL_MS = 1000;
const ITEMS_PAGE_SIZE = 200;

function getInitialTheme() {
  return document.documentElement.getAttribute('data-theme') || 'light';
}

export default function App() {
  const [authState, setAuthState] = useState('loading'); // loading | anon | authed
  const [user, setUser] = useState(null);
  const [authError, setAuthError] = useState(null);
  const [history, setHistory] = useState([]);
  const [activePage, setActivePage] = useState('scanner');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [theme, setTheme] = useState(getInitialTheme);

  const [job, setJob] = useState(null);
  const [jobLoading, setJobLoading] = useState(false);
  const [error, setError] = useState(null);
  const [submitInfo, setSubmitInfo] = useState(null);
  const [urlsText, setUrlsText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [itemsLimit, setItemsLimit] = useState(ITEMS_PAGE_SIZE);
  const [, setTick] = useState(0);
  const pollRef = useRef(null);
  const tickRef = useRef(null);
  const historyPollRef = useRef(null);
  const itemsLimitRef = useRef(ITEMS_PAGE_SIZE);

  useEffect(() => {
    itemsLimitRef.current = itemsLimit;
  }, [itemsLimit]);

  useEffect(() => {
    fetchMe().then((u) => {
      if (u) {
        setUser(u);
        setAuthState('authed');
        listJobs().then(setHistory).catch(() => {});
      } else {
        setAuthState('anon');
      }
    });
  }, []);

  useEffect(() => () => {
    clearInterval(pollRef.current);
    clearInterval(tickRef.current);
    clearInterval(historyPollRef.current);
  }, []);

  // Keep History's queued/running/paused badges live while it's the open
  // page — stops itself once nothing in the list is still in flight.
  useEffect(() => {
    clearInterval(historyPollRef.current);
    const hasActiveJobs = history.some((j) => ['queued', 'running', 'paused'].includes(j.runState));
    if (activePage === 'history' && hasActiveJobs) {
      historyPollRef.current = setInterval(() => {
        listJobs().then(setHistory).catch(() => {});
      }, 3000);
    }
    return () => clearInterval(historyPollRef.current);
  }, [activePage, history]);

  function isRunning(j) {
    if (!j) return false;
    if (j.counts) return j.counts.pending > 0 || j.counts.running > 0;
    return j.items.some((i) => i.status === 'pending' || i.status === 'running');
  }

  async function refreshJob(jobId) {
    const j = await getJob(jobId, { offset: 0, limit: itemsLimitRef.current });
    setJob(j);
    return j;
  }

  function startPolling(jobId) {
    clearInterval(pollRef.current);
    clearInterval(tickRef.current);
    tickRef.current = setInterval(() => setTick((t) => t + 1), TICK_INTERVAL_MS);
    pollRef.current = setInterval(async () => {
      const j = await getJob(jobId, { offset: 0, limit: itemsLimitRef.current });
      setJob(j);
      if (!isRunning(j)) {
        clearInterval(pollRef.current);
        clearInterval(tickRef.current);
        listJobs().then(setHistory).catch(() => {});
      }
    }, POLL_INTERVAL_MS);
  }

  async function handleLogin(credential, errMsg) {
    if (!credential) {
      setAuthError(errMsg || 'Помилка входу');
      return;
    }
    try {
      const u = await loginWithGoogle(credential);
      setUser(u);
      setAuthState('authed');
      setAuthError(null);
      listJobs().then(setHistory).catch(() => {});
    } catch (err) {
      setAuthError(err.message);
    }
  }

  async function handleLogout() {
    await logout();
    setUser(null);
    setAuthState('anon');
    setJob(null);
    setHistory([]);
  }

  async function handleSubmit(urls, types) {
    setError(null);
    setSubmitInfo(null);
    setSubmitting(true);
    setItemsLimit(ITEMS_PAGE_SIZE);
    try {
      const jobIds = await createJob(urls, types);
      const j = await getJob(jobIds[0], { offset: 0, limit: ITEMS_PAGE_SIZE });
      setJob(j);
      startPolling(jobIds[0]);
      if (jobIds.length > 1) {
        setSubmitInfo(`Створено ${jobIds.length} задач — інші чекають у черзі, дивись Історію.`);
        listJobs().then(setHistory).catch(() => {});
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSelectHistory(jobId) {
    setError(null);
    setJobLoading(true);
    setItemsLimit(ITEMS_PAGE_SIZE);
    try {
      const j = await getJob(jobId, { offset: 0, limit: ITEMS_PAGE_SIZE });
      setJob(j);
      if (isRunning(j)) startPolling(jobId);
    } catch (err) {
      setError(err.message);
    } finally {
      setJobLoading(false);
    }
  }

  async function handleLoadMoreItems() {
    if (!job) return;
    const nextLimit = itemsLimit + ITEMS_PAGE_SIZE;
    setItemsLimit(nextLimit);
    itemsLimitRef.current = nextLimit;
    const j = await getJob(job.id, { offset: 0, limit: nextLimit });
    setJob(j);
  }

  async function handlePause() {
    if (!job) return;
    await pauseJobApi(job.id);
    await refreshJob(job.id);
  }

  async function handleUnpause() {
    if (!job) return;
    await unpauseJobApi(job.id);
    const j = await refreshJob(job.id);
    if (isRunning(j)) startPolling(job.id);
  }

  async function handleStop() {
    if (!job) return;
    await stopJobApi(job.id);
    await refreshJob(job.id);
  }

  async function handleResumeStopped() {
    if (!job) return;
    await resumeJobApi(job.id);
    await refreshJob(job.id);
    startPolling(job.id);
  }

  async function handleDeleteItem(url) {
    if (!job) return;
    await deleteJobItem(job.id, url);
    await refreshJob(job.id);
  }

  function handleNavigate(page) {
    setActivePage(page);
    setMobileNavOpen(false);
  }

  function handleToggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
  }

  if (authState === 'loading') {
    return <div className="app-loading" />;
  }

  if (authState === 'anon') {
    return <LoginGate onLogin={handleLogin} error={authError} />;
  }

  const items = job?.items || [];
  const running = isRunning(job) || submitting;

  return (
    <div className="shell">
      <Sidebar
        activePage={activePage}
        onNavigate={handleNavigate}
        user={user}
        onLogout={handleLogout}
        theme={theme}
        onToggleTheme={handleToggleTheme}
        mobileOpen={mobileNavOpen}
      />
      {mobileNavOpen && <div className="sidebar-backdrop" onClick={() => setMobileNavOpen(false)} />}

      <div className="topbar">
        <button className="hamburger-btn" onClick={() => setMobileNavOpen((o) => !o)} aria-label="Меню">
          {mobileNavOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
        <span className="logo-text">Parser</span>
      </div>

      <main className="shell-content">
        <AnimatePresence mode="wait">
          {activePage === 'scanner' && (
            <ScannerPage
              key="scanner"
              urlsText={urlsText}
              onUrlsChange={setUrlsText}
              onSubmit={handleSubmit}
              submitting={submitting}
              running={running}
              error={error}
              submitInfo={submitInfo}
              job={job}
              jobLoading={jobLoading}
              items={items}
              onPause={handlePause}
              onUnpause={handleUnpause}
              onStop={handleStop}
              onResumeStopped={handleResumeStopped}
              onDeleteItem={handleDeleteItem}
              onLoadMoreItems={handleLoadMoreItems}
            />
          )}
          {activePage === 'history' && (
            <HistoryPage
              key="history"
              jobs={history}
              activeJobId={job?.id}
              onSelectJob={(id) => { handleSelectHistory(id); setActivePage('scanner'); }}
            />
          )}
          {activePage === 'team' && <TeamPage key="team" />}
          {activePage === 'settings' && <SettingsPage key="settings" />}
        </AnimatePresence>
      </main>
    </div>
  );
}
