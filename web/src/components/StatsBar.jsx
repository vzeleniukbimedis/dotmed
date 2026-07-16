export default function StatsBar({ items }) {
  const total = items.length;
  const success = items.filter((i) => i.status === 'success').length;
  const error = items.filter((i) => i.status === 'error').length;
  const parts = items.filter((i) => i.status === 'success' && i.data.isPart).length;
  const pending = items.filter((i) => i.status === 'pending' || i.status === 'running').length;

  const vitals = [
    { label: 'Всього', value: total },
    { label: 'Успішно', value: success, tone: 'ok' },
    { label: 'Помилки', value: error, tone: error > 0 ? 'error' : undefined },
    { label: 'Запчастини', value: parts },
    { label: 'В процесі', value: pending, tone: pending > 0 ? 'pending' : undefined },
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
