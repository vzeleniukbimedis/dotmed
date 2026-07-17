import { useState } from 'react';
import { motion } from 'framer-motion';
import { ScanLine, Loader2 } from 'lucide-react';

export default function UrlInput({ value, onChange, onSubmit, disabled }) {
  const [includeEquipment, setIncludeEquipment] = useState(true);
  const [includeParts, setIncludeParts] = useState(false);
  const [mode, setMode] = useState('full');

  function handleSubmit() {
    const urls = value.split('\n').map((s) => s.trim()).filter(Boolean);
    if (urls.length === 0) return;
    const types = [
      ...(includeEquipment ? ['equipment'] : []),
      ...(includeParts ? ['parts'] : []),
    ];
    onSubmit(urls, types, mode);
  }

  return (
    <div className="panel">
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
      <div className="mode-toggle">
        <span className="type-toggle-label">Режим для продавців:</span>
        <label className="type-checkbox">
          <input
            type="radio"
            name="scan-mode"
            checked={mode === 'full'}
            onChange={() => setMode('full')}
            disabled={disabled}
          />
          Повний скан (AI, усі поля)
        </label>
        <label className="type-checkbox">
          <input
            type="radio"
            name="scan-mode"
            checked={mode === 'simplified'}
            onChange={() => setMode('simplified')}
            disabled={disabled}
          />
          Спрощений (лінк + ціна, швидко)
        </label>
      </div>
      <div className="panel-actions">
        <motion.button
          whileHover={disabled ? {} : { scale: 1.02 }}
          whileTap={disabled ? {} : { scale: 0.97 }}
          onClick={handleSubmit}
          disabled={disabled || (!includeEquipment && !includeParts)}
        >
          {disabled ? (
            <><Loader2 size={14} className="spin" /> Сканування…</>
          ) : (
            <><ScanLine size={14} /> Сканувати</>
          )}
        </motion.button>
      </div>
    </div>
  );
}
