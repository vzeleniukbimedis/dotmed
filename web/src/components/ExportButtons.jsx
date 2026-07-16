import { downloadJson, downloadCsv, downloadXlsx } from '../lib/exportUtils.js';

export default function ExportButtons({ items }) {
  const successCount = items.filter((i) => i.status === 'success').length;
  if (successCount === 0) return null;

  return (
    <div className="export-actions">
      <button className="secondary" onClick={() => downloadXlsx(items)}>Експорт Excel</button>
      <button className="secondary" onClick={() => downloadCsv(items)}>Експорт CSV</button>
      <button className="secondary" onClick={() => downloadJson(items)}>Експорт JSON</button>
    </div>
  );
}
