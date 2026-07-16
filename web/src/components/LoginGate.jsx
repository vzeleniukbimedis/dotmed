import { GoogleLogin } from '@react-oauth/google';
import { motion } from 'framer-motion';
import { Terminal } from 'lucide-react';

export default function LoginGate({ onLogin, error }) {
  return (
    <div className="login-gate">
      <div className="login-grid" aria-hidden="true" />

      <motion.div
        className="login-card"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: 'easeOut' }}
      >
        <div className="login-scanline" aria-hidden="true" />

        <span className="login-eyebrow">
          <Terminal size={12} /> ДОСТУП ОБМЕЖЕНО
        </span>

        <div className="login-brand">
          <span className="logo-text">Parser</span>
          <span className="logo-asterisk">✳︎</span>
        </div>

        <p>Доступ лише для команди. Увійди через Google-акаунт зі списку дозволених.</p>

        <div className="login-button">
          <GoogleLogin
            onSuccess={(cred) => onLogin(cred.credential)}
            onError={() => onLogin(null, 'Не вдалось увійти через Google')}
            theme="filled_black"
            shape="pill"
          />
        </div>

        {error && <p className="error-text">{error}</p>}
      </motion.div>
    </div>
  );
}
