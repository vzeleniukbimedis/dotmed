import { useState } from 'react';

export default function UrlInput({ value, onChange, onSubmit, disabled }) {
  const [includeEquipment, setIncludeEquipment] = useState(true);
  const [includeParts, setIncludeParts] = useState(true);

  function handleSubmit() {
    const urls = value.split('\n').map((s) => s.trim()).filter(Boolean);
    if (urls.length === 0) return;
    const types = [
      ...(includeEquipment ? ['equipment'] : []),
      ...(includeParts ? ['parts'] : []),
    ];
    onSubmit(urls, types);
  }

  return (
    <div className="panel" id="scanner">
      <label className="panel-label" htmlFor="url-input">Лінки на оголошення або на продавця</label>
      <textarea
        id="url-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={'https://www.dotmed.com/listing/...\nhttps://www.dotmed.com/webstore/...'}
        disabled={disabled}
      />
      <div className="type-toggle">
        <span className="type-toggle-label">Якщо це лінк на продавця, тягнути:</span>
        <label className="type-checkbox">
          <input
            type="checkbox"
            checked={includeEquipment}
            onChange={(e) => setIncludeEquipment(e.target.checked)}
            disabled={disabled}
          />
          Обладнання
        </label>
        <label className="type-checkbox">
          <input
            type="checkbox"
            checked={includeParts}
            onChange={(e) => setIncludeParts(e.target.checked)}
            disabled={disabled}
          />
          Запчастини
        </label>
      </div>
      <div className="panel-actions">
        <button onClick={handleSubmit} disabled={disabled || (!includeEquipment && !includeParts)}>
          {disabled ? 'Сканування…' : 'Сканувати'}
        </button>
      </div>
    </div>
  );
}
