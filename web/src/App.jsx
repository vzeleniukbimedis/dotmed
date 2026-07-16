import { useEffect, useRef, useState } from 'react';
import Navbar from './components/Navbar.jsx';
import LoginGate from './components/LoginGate.jsx';
import JobHistory from './components/JobHistory.jsx';
import SettingsPanel from './components/SettingsPanel.jsx';
import UrlInput from './components/UrlInput.jsx';
import StatsBar from './components/StatsBar.jsx';
import ProgressBar from './components/ProgressBar.jsx';
import ListingCard from './components/ListingCard.jsx';
import ExportButtons from './components/ExportButtons.jsx';
import Help from './components/Help.jsx';
import { createJob, getJob, listJobs } from './lib/api.js';
import { fetchMe, loginWithGoogle, logout } from './lib/auth.js';

const POLL_INTERVAL_MS = 1500;
const TICK_INTERVAL_MS = 1000;

export default function App() {
  const [authState, setAuthState] = useState('loading'); // loading | anon | authed
  const [user, setUser] = useState(null);
  const [authError, setAuthError] = useState(null);
  const [history, setHistory] = useState([]);
  const [showSettings, setShowSettings] = useState(false);

  const [job, setJob] = useState(null);
  const [error, setError] = useState(null);
  const [urlsText, setUrlsText] = useState('');
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
    try {
      const jobId = await createJob(urls, types);
      const j = await getJob(jobId);
      setJob(j);
      startPolling(jobId);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleSelectHistory(jobId) {
    const j = await getJob(jobId);
    setJob(j);
    if (isRunning(j)) startPolling(jobId);
  }

  if (authState === 'loading') {
    return <div className="app-loading" />;
  }

  if (authState === 'anon') {
    return (
      <div className="app">
        <Navbar user={null} />
        <LoginGate onLogin={handleLogin} error={authError} />
      </div>
    );
  }

  const items = job?.items || [];
  const running = isRunning(job);

  return (
    <div className="app">
      <Navbar user={user} onLogout={handleLogout} onOpenSettings={() => setShowSettings(true)} />

      <main className="content">
        <JobHistory jobs={history} onSelect={handleSelectHistory} activeJobId={job?.id} />

        <UrlInput value={urlsText} onChange={setUrlsText} onSubmit={handleSubmit} disabled={running} />

        {error && <p className="error-text">Помилка: {error}</p>}

        <StatsBar items={items} />
        {job && <ProgressBar items={items} createdAt={job.createdAt} />}
        <ExportButtons items={items} />

        {items.length === 0 ? (
          <p className="empty-state">Немає даних. Встав лінки вище і натисни «Сканувати».</p>
        ) : (
          <div className="results-grid">
            {items.map((item) => (
              <ListingCard key={item.url} item={item} />
            ))}
          </div>
        )}

        <Help />
      </main>

      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}
    </div>
  );
}
