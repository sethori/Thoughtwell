import type { Area } from '@notes/shared';
import { Icon, type IconName } from './Icon';

export function Rail({ area, inbox, onArea, onSearch, onSettings }: { area: Area; inbox: number; onArea: (a: Area) => void; onSearch: () => void; onSettings: () => void }) {
  const btn = (on: boolean, icon: IconName, label: string, run: () => void, badge = 0) => (
    <button type="button" className={`rb ${on ? 'on' : ''}`} aria-label={badge ? `${label}, ${badge} in the inbox` : label} title={label} aria-pressed={on} onClick={run}>
      <Icon name={icon} />
      {badge > 0 && <span className="badge">{badge > 99 ? '99+' : badge}</span>}
    </button>
  );
  return (
    <nav className="rail" aria-label="Main">
      <div className="logo" aria-hidden="true">
        <Icon name="note" />
      </div>
      {btn(area === 'me', 'user', 'Me: your notes', () => onArea('me'))}
      {btn(area === 'brain', 'sparkle', 'Brain: your agents’ area', () => onArea('brain'), inbox)}
      {btn(false, 'search', 'Search (Ctrl+K)', onSearch)}
      <div className="spacer" />
      {btn(false, 'settings', 'Settings', onSettings)}
    </nav>
  );
}
