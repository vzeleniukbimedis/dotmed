import { PackageSearch, TriangleAlert, Trash2 } from 'lucide-react';
import { motion } from 'framer-motion';

const FIELD_LABELS = [
  ['brand', 'Бренд'],
  ['model', 'Модель'],
  ['category', 'Тип'],
  ['condition', 'Стан'],
  ['price', 'Ціна'],
  ['year', 'Рік'],
  ['warranty', 'Гарантія'],
  ['partNumber', 'Парт-номер'],
  ['partsDescription', 'Опис запчастини'],
];

function elapsedLabel(startedAt) {
  if (!startedAt) return null;
  const s = Math.round((Date.now() - new Date(startedAt).getTime()) / 1000);
  return `${s}с`;
}

function DeleteButton({ onClick }) {
  return (
    <motion.button
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
      className="secondary card-delete-btn"
      onClick={onClick}
      title="Видалити з результатів"
    >
      <Trash2 size={13} />
    </motion.button>
  );
}

function PendingCard({ item }) {
  const elapsed = elapsedLabel(item.startedAt);
  return (
    <div className="card card-pending">
      <div className="scan-box" />
      <div className="pending-text">
        {item.stageLabel || 'Скануємо'}{elapsed && ` · ${elapsed}`}
        <span className="pending-url">{item.url}</span>
      </div>
    </div>
  );
}

function ErrorCard({ url, error, onDelete }) {
  return (
    <div className="card card-error">
      <div className="card-body">
        <div className="card-header">
          <h3><TriangleAlert size={13} className="error-icon" />{url}</h3>
          {onDelete && <DeleteButton onClick={() => onDelete(url)} />}
        </div>
        <p>{error}</p>
      </div>
    </div>
  );
}

export default function ListingCard({ item, onDelete }) {
  if (item.status === 'pending' || item.status === 'running') {
    return <PendingCard item={item} />;
  }
  if (item.status === 'error') {
    return <ErrorCard url={item.url} error={item.error} onDelete={onDelete} />;
  }

  const d = item.data;
  return (
    <div className="card">
      <div className="card-body">
        <div className="card-header">
          <h3>{d.title || item.url}</h3>
          <div className="card-header-actions">
            {d.isPart && (
              <span className="status-tag">
                <PackageSearch size={12} />
                Запчастина
              </span>
            )}
            {onDelete && <DeleteButton onClick={() => onDelete(item.url)} />}
          </div>
        </div>

        {d.photos?.length > 0 && (
          <div className="reticle-frame">
            <div className="photos">
              {d.photos.map((src) => (
                <img key={src} src={src} loading="lazy" alt="" />
              ))}
            </div>
          </div>
        )}

        <table className="ledger">
          <tbody>
            {FIELD_LABELS.map(([key, label]) => (
              d[key] ? (
                <tr key={key}>
                  <td>{label}</td>
                  <td>{d[key]}</td>
                </tr>
              ) : null
            ))}
          </tbody>
        </table>

        {d.description && <div className="description">{d.description}</div>}

        <a className="source-link" href={item.url} target="_blank" rel="noreferrer">
          Відкрити оголошення →
        </a>
      </div>
    </div>
  );
}
