import { motion } from 'framer-motion';
import { Inbox, Loader2, ScanLine, Pause, Play, Square } from 'lucide-react';
import PageHeader from '../components/PageHeader.jsx';
import UrlInput from '../components/UrlInput.jsx';
import StatsBar from '../components/StatsBar.jsx';
import ProgressBar from '../components/ProgressBar.jsx';
import ExportButtons from '../components/ExportButtons.jsx';
import ListingCard from '../components/ListingCard.jsx';
import Help from '../components/Help.jsx';

const gridVariants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.04 } },
};

const cardVariants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0 },
};

function JobControls({ job, onPause, onUnpause, onStop, onResumeStopped }) {
  if (!job) return null;
  // resumeJob() retries both 'pending' and 'error' items — the button must
  // show for either, not just pending, or finished-with-failures jobs have
  // no way back in even though a retry is one click away on the backend.
  const hasRetryable = (job.counts?.pending ?? 0) + (job.counts?.error ?? 0) > 0;
  const runState = job.runState || 'idle';

  if (runState === 'running') {
    return (
      <div className="job-controls">
        <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }} className="secondary" onClick={onPause}>
          <Pause size={14} /> Пауза
        </motion.button>
        <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }} className="secondary" onClick={onStop}>
          <Square size={14} /> Зупинити
        </motion.button>
      </div>
    );
  }

  if (runState === 'paused') {
    return (
      <div className="job-controls">
        <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }} onClick={onUnpause}>
          <Play size={14} /> Продовжити
        </motion.button>
        <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }} className="secondary" onClick={onStop}>
          <Square size={14} /> Зупинити
        </motion.button>
      </div>
    );
  }

  if (hasRetryable) {
    return (
      <div className="job-controls">
        <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }} onClick={onResumeStopped}>
          <Play size={14} /> Повторити невдалі ({job.counts?.error ?? 0}) / продовжити
        </motion.button>
      </div>
    );
  }

  return null;
}

export default function ScannerPage({
  urlsText, onUrlsChange, onSubmit, submitting, running, error, job, jobLoading, items,
  onPause, onUnpause, onStop, onResumeStopped, onDeleteItem, onLoadMoreItems,
}) {
  const counts = job?.counts;
  const hasMore = counts && items.length < counts.total;

  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18 }}>
      <PageHeader icon={ScanLine} title="Сканер" subtitle="Встав лінки на оголошення dotmed.com або на продавця" />

      <UrlInput value={urlsText} onChange={onUrlsChange} onSubmit={onSubmit} disabled={running} />

      {error && <p className="error-text">Помилка: {error}</p>}

      {counts && <StatsBar counts={counts} />}
      {job && counts && <ProgressBar counts={counts} createdAt={job.createdAt} />}
      <JobControls job={job} onPause={onPause} onUnpause={onUnpause} onStop={onStop} onResumeStopped={onResumeStopped} />
      {job && <ExportButtons jobId={job.id} successCount={counts?.success ?? 0} />}

      {jobLoading ? (
        <div className="empty-state">
          <Loader2 size={28} strokeWidth={1.5} className="spin" />
          <p>Завантажуємо задачу…</p>
        </div>
      ) : items.length === 0 ? (
        <div className="empty-state">
          <Inbox size={28} strokeWidth={1.5} />
          <p>Немає даних. Встав лінки вище і натисни «Сканувати».</p>
        </div>
      ) : (
        <>
          <motion.div className="results-grid" variants={gridVariants} initial="hidden" animate="show">
            {items.map((item) => (
              <motion.div key={item.url} variants={cardVariants}>
                <ListingCard item={item} onDelete={onDeleteItem} />
              </motion.div>
            ))}
          </motion.div>
          {hasMore && (
            <div className="load-more-row">
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.97 }}
                className="secondary"
                onClick={onLoadMoreItems}
              >
                Завантажити ще ({items.length} з {counts.total})
              </motion.button>
            </div>
          )}
        </>
      )}

      <Help />
    </motion.div>
  );
}
