function formatDate(iso) {
  return new Date(iso).toLocaleString('uk-UA', { dateStyle: 'short', timeStyle: 'short' });
}

export default function JobHistory({ jobs, onSelect, activeJobId }) {
  if (jobs.length === 0) {
    return (
      <div className="job-history job-history-empty">
        <span className="panel-label">Історія задач</span>
        <p className="empty-note">Ще немає жодної задачі.</p>
      </div>
    );
  }

  return (
    <div className="job-history">
      <span className="panel-label">Історія задач</span>
      <ul className="job-history-list">
        {jobs.map((job) => (
          <li key={job.id}>
            <button
              className={`job-history-item ${job.id === activeJobId ? 'active' : ''}`}
              onClick={() => onSelect(job.id)}
            >
              <span className="job-history-date">{formatDate(job.createdAt)}</span>
              <span className="job-history-stats">
                {job.total} · <span className="ok">{job.success}</span> / <span className="fail">{job.error}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
