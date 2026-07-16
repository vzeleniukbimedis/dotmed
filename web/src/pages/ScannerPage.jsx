import { motion } from 'framer-motion';
import { Inbox, ScanLine, Pause, Play, Square } from 'lucide-react';
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
  const hasPending = job.items.some((i) => i.status === 'pending');
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

  if (hasPending) {
    return (
      <div className="job-controls">
        <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }} onClick={onResumeStopped}>
          <Play size={14} /> Відновити сканування
        </motion.button>
      </div>
    );
  }

  return null;
}

export default function ScannerPage({
  urlsText, onUrlsChange, onSubmit, submitting, running, error, job, items,
  onPause, onUnpause, onStop, onResumeStopped, onDeleteItem,
}) {
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18 }}>
      <PageHeader icon={ScanLine} title="Сканер" subtitle="Встав лінки на оголошення dotmed.com або на продавця" />

      <UrlInput value={urlsText} onChange={onUrlsChange} onSubmit={onSubmit} disabled={running} />

      {error && <p className="error-text">Помилка: {error}</p>}

      <StatsBar items={items} />
      {job && <ProgressBar items={items} createdAt={job.createdAt} />}
      <JobControls job={job} onPause={onPause} onUnpause={onUnpause} onStop={onStop} onResumeStopped={onResumeStopped} />
      <ExportButtons items={items} />

      {items.length === 0 ? (
        <div className="empty-state">
          <Inbox size={28} strokeWidth={1.5} />
          <p>Немає даних. Встав лінки вище і натисни «Сканувати».</p>
        </div>
      ) : (
        <motion.div className="results-grid" variants={gridVariants} initial="hidden" animate="show">
          {items.map((item) => (
            <motion.div key={item.url} variants={cardVariants}>
              <ListingCard item={item} onDelete={onDeleteItem} />
            </motion.div>
          ))}
        </motion.div>
      )}

      <Help />
    </motion.div>
  );
}
