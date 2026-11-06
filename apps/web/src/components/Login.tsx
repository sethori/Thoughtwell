import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Icon } from './Icon';

export function Login({ onSignedIn }: { onSignedIn: () => void }) {
  // A brand-new desktop workspace asks for its first admin instead of a sign-in.
  const [setup, setSetup] = useState<boolean | null>(null);
  useEffect(() => {
    api
      .get<{ needed: boolean }>('/api/setup')
      .then((r) => setSetup(r.needed))
      .catch(() => setSetup(false));
  }, []);

  if (setup === null) return null;
  return setup ? <FirstRunSetup onDone={onSignedIn} onAlreadySetUp={() => setSetup(false)} /> : <SignIn onSignedIn={onSignedIn} />;
}

function SignIn({ onSignedIn }: { onSignedIn: () => void }) {
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

/** First launch: name the organization and create the admin account, then go straight in. */
function FirstRunSetup({ onDone, onAlreadySetUp }: { onDone: () => void; onAlreadySetUp: () => void }) {
  const [orgName, setOrgName] = useState('My Organization');
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const mismatch = confirm.length > 0 && confirm !== password;
  const short = password.length > 0 && password.length < 8;
  const ready = orgName.trim() && displayName.trim() && username.trim() && password.length >= 8 && confirm === password;

  return (
    <div className="login">
      <form
        className="setup"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!ready) return;
          setBusy(true);
          setError(null);
          try {
            await api.post('/api/setup', { orgName, displayName, username, password });
            onDone();
          } catch (err) {
            const msg = (err as Error).message;
            if (/already set up/i.test(msg)) onAlreadySetUp();
            else setError(msg);
            setBusy(false);
          }
        }}
      >
        <div className="logo" aria-hidden="true">
          <Icon name="note" />
        </div>
        <h1>Set up your workspace</h1>
        <p className="setup-sub">Create the first account. It has full admin rights, so you can add people, units and groups after.</p>
        <label className="field">
          <span>Organization name</span>
          <input className="input" name="organization" value={orgName} onChange={(e) => setOrgName(e.target.value)} />
        </label>
        <label className="field">
          <span>Your name</span>
          <input
            className="input"
            name="name"
            autoComplete="name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            autoFocus
          />
        </label>
        <label className="field">
          <span>Username</span>
          <input
            className="input"
            name="username"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </label>
        <label className="field">
          <span>Password</span>
          <input
            className="input"
            name="new-password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={short}
          />
          {short && <small className="field-note">At least 8 characters.</small>}
        </label>
        <label className="field">
          <span>Confirm password</span>
          <input
            className="input"
            name="confirm-password"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            aria-invalid={mismatch}
          />
          {mismatch && <small className="field-note">The passwords don't match.</small>}
        </label>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="actions">
          <button type="submit" className="btn pri" style={{ width: '100%' }} disabled={busy || !ready}>
            {busy ? 'Creating…' : 'Create admin account'}
          </button>
        </div>
      </form>
    </div>
  );
}
