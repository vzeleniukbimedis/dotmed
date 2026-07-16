import { GoogleLogin } from '@react-oauth/google';

export default function LoginGate({ onLogin, error }) {
  return (
    <div className="login-gate">
      <div className="login-panel">
        <h1>DOTmed Parser</h1>
        <p>Доступ лише для команди. Увійди через Google-акаунт зі списку дозволених.</p>
        <div className="login-button">
          <GoogleLogin
            onSuccess={(cred) => onLogin(cred.credential)}
            onError={() => onLogin(null, 'Не вдалось увійти через Google')}
          />
        </div>
        {error && <p className="error-text">{error}</p>}
      </div>
    </div>
  );
}
