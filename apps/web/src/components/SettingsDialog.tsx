import { useEffect, useState } from 'react';
import { ACCENT_PRESETS, deriveScheme, isHexColor, type AccentChoice, type Preferences } from '@notes/shared';
import { api, type Me } from '../lib/api';
import { applyTheme } from '../lib/theme';
import { Dialog } from './Dialog';

interface Delivery {
  email: { enabled: boolean; host: string; port: number; secure: boolean; username: string; from: string; passwordSet: boolean };
  teams: { enabled: boolean; webhookUrl: string };
}

/** Per-person appearance and notifications, plus organization branding, limits and delivery for admins. */
export function SettingsDialog({ me, onClose, onChanged }: { me: Me; onClose: () => void; onChanged: () => Promise<void> }) {
  const [prefs, setPrefs] = useState<Preferences>(me.user.preferences);
  const [brandColor, setBrandColor] = useState(me.org.branding.brandColor ?? '#3856d6');
  const [brandName, setBrandName] = useState(me.org.branding.name ?? '');
  const [maxMb, setMaxMb] = useState<number | null>(null);
  const [delivery, setDelivery] = useState<Delivery | null>(null);
  const [smtpPassword, setSmtpPassword] = useState('');
  const [testResult, setTestResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isAdmin = me.user.is_org_admin;

  useEffect(() => {
    if (isAdmin) {
      void api.get<{ uploads: { defaultMaxMb: number }; notifications: Delivery }>('/api/admin/settings').then((s) => {
        setMaxMb(s.uploads.defaultMaxMb);
        setDelivery(s.notifications);
      });
    }
  }, [isAdmin]);

  // Preview as you choose.
  useEffect(() => {
    const brand = isHexColor(brandColor) ? deriveScheme(brandColor) : me.org.branding.scheme;
    applyTheme(prefs, prefs.accent === 'brand' ? brand : me.org.branding.scheme);
  }, [prefs, brandColor, me.org.branding.scheme]);

  const choose = <K extends keyof Preferences>(key: K, value: Preferences[K]) => setPrefs((p) => ({ ...p, [key]: value }));

  const saveDelivery = async () => {
    if (!delivery) return;
    const { passwordSet: _ignore, ...email } = delivery.email;
    const saved = await api.put<{ notifications: Delivery }>('/api/admin/settings', {
      notifications: { email: { ...email, ...(smtpPassword ? { password: smtpPassword } : {}) }, teams: delivery.teams },
    });
    setDelivery(saved.notifications);
    setSmtpPassword('');
  };

  const close = () => {
    applyTheme(me.user.preferences, me.org.branding.scheme);
    onClose();
  };

  const accents: { id: AccentChoice; color: string; label: string }[] = [
    ...Object.entries(ACCENT_PRESETS).map(([id, c]) => ({ id: id as AccentChoice, color: c[prefs.mode], label: id[0]!.toUpperCase() + id.slice(1) })),
    ...(me.org.branding.scheme || isAdmin
      ? [{ id: 'brand' as const, color: (me.org.branding.scheme ?? deriveScheme(brandColor))[prefs.mode].accent, label: 'Brand' }]
      : []),
  ];

  return (
    <Dialog title="Settings" sub="Appearance applies to you only." wide onClose={close}>
      <div className="field">
        <span>Mode</span>
        <div className="choices">
          {(['dark', 'light'] as const).map((m) => (
            <button key={m} type="button" className={`choice ${prefs.mode === m ? 'on' : ''}`} aria-pressed={prefs.mode === m} onClick={() => choose('mode', m)}>
              {m === 'dark' ? 'Dark' : 'Light'}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <span>Density</span>
        <div className="choices">
          {(['comfortable', 'compact'] as const).map((d) => (
            <button key={d} type="button" className={`choice ${prefs.density === d ? 'on' : ''}`} aria-pressed={prefs.density === d} onClick={() => choose('density', d)}>
              {d === 'comfortable' ? 'Comfortable' : 'Compact'}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <span>Accent</span>
        <div className="choices">
          {accents.map((a) => (
            <button key={a.id} type="button" className={`choice ${prefs.accent === a.id ? 'on' : ''}`} aria-pressed={prefs.accent === a.id} onClick={() => choose('accent', a.id)}>
              <span className="swatch" style={{ background: a.color }} />
              {a.label}
            </button>
          ))}
        </div>
      </div>

      <hr className="sep-line" />
      <h2>Notifications</h2>
      <p className="sub">You always see them under the bell. Choose where else they reach you{me.user.email ? ` (${me.user.email})` : ''}.</p>
      <div className="field">
        <span>Also send to</span>
        <div className="choices">
          <button
            type="button"
            className={`choice ${prefs.notify.email ? 'on' : ''}`}
            aria-pressed={prefs.notify.email}
            disabled={!me.org.channels.email && !isAdmin}
            onClick={() => choose('notify', { ...prefs.notify, email: !prefs.notify.email })}
          >
            Email
          </button>
          <button
            type="button"
            className={`choice ${prefs.notify.teams ? 'on' : ''}`}
            aria-pressed={prefs.notify.teams}
            disabled={!me.org.channels.teams && !isAdmin}
            onClick={() => choose('notify', { ...prefs.notify, teams: !prefs.notify.teams })}
          >
            Teams
          </button>
        </div>
        {(!me.org.channels.email || !me.org.channels.teams) && (
          <p className="sub">
            {!me.org.channels.email && !me.org.channels.teams
              ? 'An admin has not set up email or Teams delivery yet.'
              : !me.org.channels.email
                ? 'An admin has not set up email delivery yet.'
                : 'An admin has not set up Teams delivery yet.'}
            {!me.user.email && ' Your account also needs an email address.'}
          </p>
        )}
      </div>

      {isAdmin && (
        <>
          <hr className="sep-line" />
          <h2>Organization</h2>
          <p className="sub">Branding and limits apply to everyone.</p>
          <div className="row">
            <label className="field" style={{ flex: '2 1 200px' }}>
              <span>Brand name</span>
              <input className="input" value={brandName} onChange={(e) => setBrandName(e.target.value)} maxLength={100} />
            </label>
            <label className="field" style={{ flex: '1 1 140px' }}>
              <span>Brand color</span>
              <div className="row" style={{ flexWrap: 'nowrap' }}>
                <input type="color" value={brandColor} onChange={(e) => setBrandColor(e.target.value)} aria-label="Pick brand color" style={{ width: 40, height: 36, border: 0, background: 'none' }} />
                <input className="input" value={brandColor} onChange={(e) => setBrandColor(e.target.value)} aria-label="Brand color hex" />
              </div>
            </label>
          </div>
          {isHexColor(brandColor) && (
            <p className="sub">
              Derived accents, adjusted to stay readable: light{' '}
              <span className="swatch" style={{ display: 'inline-block', verticalAlign: 'middle', background: deriveScheme(brandColor).light.accent }} /> · dark{' '}
              <span className="swatch" style={{ display: 'inline-block', verticalAlign: 'middle', background: deriveScheme(brandColor).dark.accent }} />
            </p>
          )}
          <label className="field" style={{ maxWidth: 220 }}>
            <span>Attachment limit (MB)</span>
            <input
              className="input"
              type="number"
              min={1}
              max={2048}
              value={maxMb ?? ''}
              onChange={(e) => setMaxMb(e.target.value ? Number(e.target.value) : null)}
            />
          </label>

          {delivery && (
            <>
              <h3>Email delivery (SMTP)</h3>
              <label className="check">
                <input
                  type="checkbox"
                  checked={delivery.email.enabled}
                  onChange={(e) => setDelivery({ ...delivery, email: { ...delivery.email, enabled: e.target.checked } })}
                />
                Send notifications by email
              </label>
              <div className="row">
                <label className="field" style={{ flex: '3 1 200px' }}>
                  <span>Server</span>
                  <input className="input" placeholder="smtp.office365.com" value={delivery.email.host} onChange={(e) => setDelivery({ ...delivery, email: { ...delivery.email, host: e.target.value } })} />
                </label>
                <label className="field" style={{ flex: '1 1 90px' }}>
                  <span>Port</span>
                  <input
                    className="input"
                    type="number"
                    value={delivery.email.port}
                    onChange={(e) => setDelivery({ ...delivery, email: { ...delivery.email, port: Number(e.target.value) || 587 } })}
                  />
                </label>
                <label className="check" style={{ alignSelf: 'end', marginBottom: 10 }}>
                  <input type="checkbox" checked={delivery.email.secure} onChange={(e) => setDelivery({ ...delivery, email: { ...delivery.email, secure: e.target.checked } })} />
                  TLS from the start (port 465)
                </label>
              </div>
              <div className="row">
                <label className="field" style={{ flex: '1 1 160px' }}>
                  <span>Username</span>
                  <input className="input" autoComplete="off" value={delivery.email.username} onChange={(e) => setDelivery({ ...delivery, email: { ...delivery.email, username: e.target.value } })} />
                </label>
                <label className="field" style={{ flex: '1 1 160px' }}>
                  <span>Password</span>
                  <input
                    className="input"
                    type="password"
                    autoComplete="new-password"
                    placeholder={delivery.email.passwordSet ? 'Saved (type to replace)' : ''}
                    value={smtpPassword}
                    onChange={(e) => setSmtpPassword(e.target.value)}
                  />
                </label>
                <label className="field" style={{ flex: '1 1 200px' }}>
                  <span>From address</span>
                  <input className="input" placeholder="notes@example.com" value={delivery.email.from} onChange={(e) => setDelivery({ ...delivery, email: { ...delivery.email, from: e.target.value } })} />
                </label>
              </div>

              <h3>Teams delivery</h3>
              <label className="check">
                <input
                  type="checkbox"
                  checked={delivery.teams.enabled}
                  onChange={(e) => setDelivery({ ...delivery, teams: { ...delivery.teams, enabled: e.target.checked } })}
                />
                Send notifications to Teams
              </label>
              <label className="field">
                <span>Power Automate workflow URL</span>
                <input
                  className="input"
                  placeholder="https://…logic.azure.com/workflows/…"
                  value={delivery.teams.webhookUrl}
                  onChange={(e) => setDelivery({ ...delivery, teams: { ...delivery.teams, webhookUrl: e.target.value } })}
                />
              </label>
              <p className="sub">
                Make a Teams workflow that starts “When a Teams webhook request is received” and posts a chat message to the person in{' '}
                <code>to</code>. The README has the steps.
              </p>
              <div className="row">
                <button
                  type="button"
                  className="btn"
                  onClick={async () => {
                    setTestResult('Sending…');
                    try {
                      await saveDelivery();
                      const r = await api.post<{ email: string; teams: string }>('/api/admin/notifications/test');
                      setTestResult(`Email: ${r.email}. Teams: ${r.teams}.`);
                    } catch (err) {
                      setTestResult((err as Error).message);
                    }
                  }}
                >
                  Save and send me a test
                </button>
                {testResult && <span className="sub">{testResult}</span>}
              </div>
            </>
          )}
        </>
      )}

      {error && <p className="error">{error}</p>}
      <div className="actions">
        <button type="button" className="btn" onClick={close}>
          Cancel
        </button>
        <button
          type="button"
          className="btn pri"
          onClick={async () => {
            setError(null);
            try {
              await api.patch('/api/me/preferences', prefs);
              if (isAdmin) {
                await api.put('/api/admin/settings', {
                  branding: { name: brandName || null, brandColor: isHexColor(brandColor) ? brandColor : null },
                  ...(maxMb ? { uploads: { defaultMaxMb: maxMb } } : {}),
                });
                await saveDelivery();
              }
              await onChanged();
              onClose();
            } catch (err) {
              setError((err as Error).message);
            }
          }}
        >
          Save
        </button>
      </div>
    </Dialog>
  );
}
