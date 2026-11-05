import { useEffect, useState } from 'react';
import { ACCENT_PRESETS, deriveScheme, isHexColor, type AccentChoice, type Preferences } from '@notes/shared';
import { api, type Me } from '../lib/api';
import { applyTheme } from '../lib/theme';
import { Dialog } from './Dialog';

/** Per-person appearance, plus organization branding and upload limits for admins. */
export function SettingsDialog({ me, onClose, onChanged }: { me: Me; onClose: () => void; onChanged: () => Promise<void> }) {
  const [prefs, setPrefs] = useState<Preferences>(me.user.preferences);
  const [brandColor, setBrandColor] = useState(me.org.branding.brandColor ?? '#3856d6');
  const [brandName, setBrandName] = useState(me.org.branding.name ?? '');
  const [maxMb, setMaxMb] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isAdmin = me.user.is_org_admin;

  useEffect(() => {
    if (isAdmin) void api.get<{ uploads: { defaultMaxMb: number } }>('/api/admin/settings').then((s) => setMaxMb(s.uploads.defaultMaxMb));
  }, [isAdmin]);

  // Preview as you choose.
  useEffect(() => {
    const brand = isHexColor(brandColor) ? deriveScheme(brandColor) : me.org.branding.scheme;
    applyTheme(prefs, prefs.accent === 'brand' ? brand : me.org.branding.scheme);
  }, [prefs, brandColor, me.org.branding.scheme]);

  const choose = <K extends keyof Preferences>(key: K, value: Preferences[K]) => setPrefs((p) => ({ ...p, [key]: value }));

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

      {isAdmin && (
        <>
          <hr style={{ border: 0, borderTop: '1px solid var(--line)', margin: '18px 0' }} />
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
