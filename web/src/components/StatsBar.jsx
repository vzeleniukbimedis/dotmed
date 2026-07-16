export default function StatsBar({ counts }) {
  const { total, success, error, parts, pending: pendingCount, running, stopped = 0 } = counts;
  const pending = pendingCount + running;

  const vitals = [
    { label: 'Всього', value: total },
    { label: 'Успішно', value: success, tone: 'ok' },
    { label: 'Помилки', value: error, tone: error > 0 ? 'error' : undefined },
    { label: 'Запчастини', value: parts },
    { label: 'В процесі', value: pending, tone: pending > 0 ? 'pending' : undefined },
    ...(stopped > 0 ? [{ label: 'Зупинено', value: stopped, tone: 'pending' }] : []),
  ];

  return (
    <div className="vitals-strip">
      {vitals.map((v) => (
        <div key={v.label} className={`vital ${v.tone || ''}`}>
          <div className="vital-value">{String(v.value).padStart(2, '0')}</div>
          <div className="vital-label">{v.label}</div>
        </div>
      ))}
    </div>
  );
}
