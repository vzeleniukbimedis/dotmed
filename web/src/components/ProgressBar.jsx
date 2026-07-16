function formatSeconds(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}с`;
  return `${Math.floor(s / 60)}хв ${s % 60}с`;
}

export default function ProgressBar({ items, createdAt }) {
  if (items.length === 0) return null;

  const total = items.length;
  const done = items.filter((i) => i.status === 'success' || i.status === 'error').length;
  const percent = Math.round((done / total) * 100);
  const elapsedMs = Date.now() - new Date(createdAt).getTime();
  const avgPerItem = done > 0 ? elapsedMs / done : null;
  const remainingCount = total - done;
  const etaMs = avgPerItem && remainingCount > 0 ? avgPerItem * remainingCount : null;

  return (
    <div className="progress-block">
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${percent}%` }} />
      </div>
      <div className="progress-meta">
        <span>{done}/{total} · {percent}%</span>
        <span>Минуло {formatSeconds(elapsedMs)}{etaMs != null && ` · ще ~${formatSeconds(etaMs)}`}</span>
      </div>
    </div>
  );
}
