import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { UserPlus, Trash2, Mail, Users } from 'lucide-react';
import PageHeader from '../components/PageHeader.jsx';
import { getSettings, updateSettings } from '../lib/api.js';

export default function TeamPage() {
  const [emails, setEmails] = useState([]);
  const [newEmail, setNewEmail] = useState('');
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState(null);

  useEffect(() => {
    getSettings()
      .then((s) => {
        setEmails((s.allowed_google_emails || '').split(',').map((e) => e.trim()).filter(Boolean));
        setStatus('ready');
      })
      .catch((err) => {
        setError(err.message);
        setStatus('error');
      });
  }, []);

  async function persist(nextEmails) {
    const prev = emails;
    setEmails(nextEmails);
    try {
      await updateSettings({ allowed_google_emails: nextEmails.join(',') });
      setError(null);
    } catch (err) {
      setEmails(prev);
      setError(err.message);
    }
  }

  function handleAdd() {
    const email = newEmail.trim().toLowerCase();
    if (!email || emails.includes(email)) return;
    setNewEmail('');
    persist([...emails, email]);
  }

  function handleRemove(email) {
    persist(emails.filter((e) => e !== email));
  }

  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18 }}>
      <PageHeader icon={Users} title="Команда" subtitle="Google-акаунти, яким дозволено заходити в інструмент" />

      {status === 'loading' && <p>Завантаження…</p>}

      {status !== 'loading' && (
        <>
          <div className="team-add-form">
            <input
              type="email"
              placeholder="new-user@example.com"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            />
            <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }} onClick={handleAdd}>
              <UserPlus size={15} /> Додати
            </motion.button>
          </div>

          {error && <p className="error-text">{error}</p>}

          <ul className="team-list">
            <AnimatePresence initial={false}>
              {emails.map((email) => (
                <motion.li
                  key={email}
                  className="team-row"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                >
                  <Mail size={14} className="team-row-icon" />
                  <span className="team-row-email">{email}</span>
                  <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    className="secondary team-row-remove"
                    onClick={() => handleRemove(email)}
                  >
                    <Trash2 size={14} />
                  </motion.button>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        </>
      )}
    </motion.div>
  );
}
