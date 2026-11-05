import { useState } from 'react';
import { api } from '../lib/api';
import { Icon } from './Icon';

export function Login({ onSignedIn }: { onSignedIn: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <div className="login">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await api.post('/api/auth/login', { username, password });
            onSignedIn();
          } catch (err) {
            setError((err as Error).message);
            setBusy(false);
          }
        }}
      >
        <div className="logo" aria-hidden="true">
          <Icon name="note" />
        </div>
        <h1>Sign in to Notes</h1>
        <label className="field">
          <span>Username</span>
          <input
            className="input"
            name="username"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
          />
        </label>
        <label className="field">
          <span>Password</span>
          <input
            className="input"
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="actions">
          <button type="submit" className="btn pri" style={{ width: '100%' }} disabled={busy || !username || !password}>
            Sign in
          </button>
        </div>
      </form>
    </div>
  );
}
