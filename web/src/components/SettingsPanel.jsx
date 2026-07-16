import { useEffect, useState } from 'react';
import { getSettings, updateSettings } from '../lib/api.js';

export default function SettingsPanel({ onClose }) {
  const [form, setForm] = useState(null);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState(null);

  useEffect(() => {
    getSettings()
      .then((s) => {
        setForm({
          dotmed_email: s.dotmed_email || '',
          dotmed_password: '',
          proxy_change_ip_url: s.proxy_change_ip_url || '',
          allowed_google_emails: s.allowed_google_emails || '',
        });
        setStatus('ready');
      })
      .catch((err) => {
        setError(err.message);
        setStatus('error');
      });
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
    <div className="settings-overlay">
      <div className="settings-panel">
        <div className="settings-header">
          <h2>Налаштування</h2>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        {status === 'loading' && <p>Завантаження…</p>}

        {form && (
          <>
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

            <label className="settings-field">
              <span>Дозволені Google-акаунти (через кому)</span>
              <textarea
                value={form.allowed_google_emails}
                onChange={(e) => setField('allowed_google_emails', e.target.value)}
              />
            </label>

            {error && <p className="error-text">{error}</p>}

            <div className="settings-actions">
              <button onClick={handleSave} disabled={status === 'saving'}>
                {status === 'saving' ? 'Зберігаємо…' : status === 'saved' ? 'Збережено' : 'Зберегти'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
