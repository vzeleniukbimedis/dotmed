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
  const [error, setError] = useState(null);
  const [urlsText, setUrlsText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [, setTick] = useState(0);
  const pollRef = useRef(null);
  const tickRef = useRef(null);

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
  }, []);

  function isRunning(j) {
    return j?.items.some((i) => i.status === 'pending' || i.status === 'running');
  }

  function startPolling(jobId) {
    clearInterval(pollRef.current);
    clearInterval(tickRef.current);
    tickRef.current = setInterval(() => setTick((t) => t + 1), TICK_INTERVAL_MS);
    pollRef.current = setInterval(async () => {
      const j = await getJob(jobId);
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
    setSubmitting(true);
    try {
      const jobId = await createJob(urls, types);
      const j = await getJob(jobId);
      setJob(j);
      startPolling(jobId);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSelectHistory(jobId) {
    const j = await getJob(jobId);
    setJob(j);
    if (isRunning(j)) startPolling(jobId);
  }

  async function handlePause() {
    if (!job) return;
    await pauseJobApi(job.id);
    setJob(await getJob(job.id));
  }

  async function handleUnpause() {
    if (!job) return;
    await unpauseJobApi(job.id);
    const j = await getJob(job.id);
    setJob(j);
    if (isRunning(j)) startPolling(job.id);
  }

  async function handleStop() {
    if (!job) return;
    await stopJobApi(job.id);
    setJob(await getJob(job.id));
  }

  async function handleResumeStopped() {
    if (!job) return;
    await resumeJobApi(job.id);
    const j = await getJob(job.id);
    setJob(j);
    startPolling(job.id);
  }

  async function handleDeleteItem(url) {
    if (!job) return;
    const updated = await deleteJobItem(job.id, url);
    setJob(updated);
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
              job={job}
              items={items}
              onPause={handlePause}
              onUnpause={handleUnpause}
              onStop={handleStop}
              onResumeStopped={handleResumeStopped}
              onDeleteItem={handleDeleteItem}
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
