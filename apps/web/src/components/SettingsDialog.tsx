import { ACCENT_PRESETS, DENSITIES, THEME_MODES, type AccentPreset, type Preferences } from '@notes/shared';
import { tw, type VaultInfo } from '../lib/vault';
import { Dialog } from './Dialog';

export function SettingsDialog({
  prefs,
  info,
  onChange,
  onClose,
}: {
  prefs: Preferences;
  info: VaultInfo;
  onChange: (p: Preferences) => void;
  onClose: () => void;
}) {
  const choice = <T extends string>(label: string, values: readonly T[], value: T, set: (v: T) => void, swatch?: (v: T) => string) => (
    <div className="field">
      <span>{label}</span>
      <div className="choices">
        {values.map((v) => (
          <button key={v} type="button" className={`choice ${v === value ? 'on' : ''}`} onClick={() => set(v)}>
            {swatch && <i className="swatch" style={{ background: swatch(v) }} />}
            {v[0]!.toUpperCase() + v.slice(1)}
          </button>
        ))}
      </div>
    </div>
  );
  return (
    <Dialog title="Settings" onClose={onClose}>
      {choice('Mode', THEME_MODES, prefs.mode, (mode) => onChange({ ...prefs, mode }))}
      {choice('Accent', Object.keys(ACCENT_PRESETS) as AccentPreset[], prefs.accent, (accent) => onChange({ ...prefs, accent }), (v) => ACCENT_PRESETS[v][prefs.mode])}
      {choice('Density', DENSITIES, prefs.density, (density) => onChange({ ...prefs, density }))}
      <div className="field">
        <span>Vault folder</span>
        <code className="path">{info.root}</code>
        <div className="row">
          <button type="button" className="btn" onClick={() => void tw.copyText(info.root)}>
            Copy path
          </button>
          <button type="button" className="btn" onClick={() => void tw.reveal('AGENTS.md')}>
            Show in file manager
          </button>
          <button type="button" className="btn" onClick={() => void tw.chooseVault()}>
            Open another vault…
          </button>
        </div>
      </div>
      <p className="hint">
        Thoughtwell {info.version}. Everything stays on this computer: your notes are the Markdown files in the vault folder. App settings live in {info.appData}.
      </p>
    </Dialog>
  );
}
