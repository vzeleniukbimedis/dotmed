import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Settings, Gauge } from 'lucide-react';
import PageHeader from '../components/PageHeader.jsx';
import { getSettings, updateSettings, getAiLimits } from '../lib/api.js';

const AI_LIMITS_POLL_MS = 5000;

export default function SettingsPage() {
  const [form, setForm] = useState(null);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState(null);
  const [aiLimits, setAiLimits] = useState(null);

  useEffect(() => {
    getSettings()
      .then((s) => {
        setForm({
          dotmed_email: s.dotmed_email || '',
          dotmed_password: '',
          proxy_change_ip_url: s.proxy_change_ip_url || '',
        });
        setStatus('ready');
      })
      .catch((err) => {
        setError(err.message);
        setStatus('error');
      });
  }, []);

  // Live per-minute request/token budget as last reported by the AI
  // provider's own response headers — updates as real scans happen.
  useEffect(() => {
    const poll = () => getAiLimits().then(setAiLimits).catch(() => {});
    poll();
    const interval = setInterval(poll, AI_LIMITS_POLL_MS);
    return () => clearInterval(interval);
  }, []);

  function setField(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSave() {
    setStatus('saving');
    setError(null);
    try {
      await updateSettings(form);
      setForm((f) => ({ ...f, dotmed_password: '' }));
      setStatus('saved');
      setTimeout(() => setStatus('ready'), 1500);
    } catch (err) {
      setError(err.message);
      setStatus('error');
    }
  }

  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18 }}>
      <PageHeader icon={Settings} title="Налаштування" subtitle="Логін DOTmed та ротація проксі" />

      {status === 'loading' && <p>Завантаження…</p>}

      {form && (
        <div className="panel">
          <label className="settings-field">
            <span>DOTmed email</span>
            <input
              type="text"
              value={form.dotmed_email}
              onChange={(e) => setField('dotmed_email', e.target.value)}
            />
          </label>

          <label className="settings-field">
            <span>DOTmed пароль</span>
            <input
              type="password"
              placeholder="••••••••"
              value={form.dotmed_password}
              onChange={(e) => setField('dotmed_password', e.target.value)}
            />
          </label>

          <label className="settings-field">
            <span>URL ротації проксі (changeip)</span>
            <input
              type="text"
              value={form.proxy_change_ip_url}
              onChange={(e) => setField('proxy_change_ip_url', e.target.value)}
            />
          </label>

          {error && <p className="error-text">{error}</p>}

          <div className="settings-actions">
            <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }} onClick={handleSave} disabled={status === 'saving'}>
              {status === 'saving' ? 'Зберігаємо…' : status === 'saved' ? 'Збережено' : 'Зберегти'}
            </motion.button>
          </div>
        </div>
      )}

      <div className="panel">
        <div className="panel-label"><Gauge size={14} /> AI-провайдер — ліміти (наживо)</div>
        {aiLimits ? (
          <>
            <div className="ai-limits-grid">
              <div className="ai-limit-item">
                <div className="ai-limit-value">{aiLimits.remainingRequestsPerMinute ?? '—'} / {aiLimits.limitRequestsPerMinute ?? '—'}</div>
                <div className="ai-limit-label">Запитів/хв ({aiLimits.model})</div>
              </div>
              <div className="ai-limit-item">
                <div className="ai-limit-value">{aiLimits.remainingTokensPerMinute ?? '—'} / {aiLimits.limitTokensPerMinute ?? '—'}</div>
                <div className="ai-limit-label">Токенів/хв</div>
              </div>
            </div>
            <p className="info-text">Оновлено: {new Date(aiLimits.updatedAt).toLocaleTimeString('uk-UA')}</p>
          </>
        ) : (
          <p className="info-text">Даних ще немає — з'являться після першого реального сканування.</p>
        )}
      </div>
    </motion.div>
  );
}
