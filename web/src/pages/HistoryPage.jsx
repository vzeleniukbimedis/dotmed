import { motion } from 'framer-motion';
import { History as HistoryIcon } from 'lucide-react';
import PageHeader from '../components/PageHeader.jsx';

function formatDate(iso) {
  return new Date(iso).toLocaleString('uk-UA', { dateStyle: 'short', timeStyle: 'short' });
}

function runStateLabel(job) {
  if (job.runState === 'queued') return `У черзі${job.queuePosition ? ` (${job.queuePosition}-та)` : ''}`;
  if (job.runState === 'running') return 'Виконується';
  if (job.runState === 'paused') return 'На паузі';
  return null;
}

export default function HistoryPage({ jobs, activeJobId, onSelectJob }) {
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18 }}>
      <PageHeader icon={HistoryIcon} title="Історія задач" subtitle="Усі попередні сканування — клікни, щоб переглянути результат" />

      {jobs.length === 0 ? (
        <div className="empty-state">
          <HistoryIcon size={28} strokeWidth={1.5} />
          <p>Ще немає жодної задачі.</p>
        </div>
      ) : (
        <ul className="history-page-list">
          {jobs.map((job) => (
            <li key={job.id}>
              <motion.button
                whileHover={{ scale: 1.01 }}
                whileTap={{ scale: 0.99 }}
                className={`history-page-row ${job.id === activeJobId ? 'active' : ''}`}
                onClick={() => onSelectJob(job.id)}
              >
                <span className="job-history-date">{formatDate(job.createdAt)}</span>
                {runStateLabel(job) && <span className="job-history-runstate">{runStateLabel(job)}</span>}
                <span className="job-history-stats">
                  {job.total} · <span className="ok">{job.success}</span> / <span className="fail">{job.error}</span>
                </span>
              </motion.button>
            </li>
          ))}
        </ul>
      )}
    </motion.div>
  );
}
