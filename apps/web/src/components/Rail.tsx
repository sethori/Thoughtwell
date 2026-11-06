import type { Me } from '../lib/api';
import { Icon, type IconName } from './Icon';

export type RailView = 'notes' | 'orgchart' | 'review' | 'people' | 'settings' | 'notifications' | 'ai';

function initials(name: string) {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

export function Rail({
  me,
  view,
  unread = 0,
  onView,
  onSignOut,
}: {
  me: Me;
  view: RailView;
  unread?: number;
  onView: (v: RailView) => void;
  onSignOut: () => void;
}) {
  const btn = (v: RailView, icon: IconName, label: string, extra = '', badge = 0) => (
    <button
      type="button"
      className={`rb ${view === v ? 'on' : ''} ${extra}`}
      aria-label={badge ? `${label}, ${badge} unread` : label}
      title={label}
      aria-pressed={view === v}
      onClick={() => onView(v)}
    >
      <Icon name={icon} />
      {badge > 0 && <span className="badge">{badge > 99 ? '99+' : badge}</span>}
    </button>
  );
  return (
    <nav className="rail" aria-label="Main">
      <div className="logo" aria-hidden="true">
        <Icon name="note" />
      </div>
      {btn('notes', 'note', 'Notes')}
      {btn('orgchart', 'org', 'Org chart')}
      {btn('review', 'review', 'Review inbox')}
      {me.user.is_org_admin && btn('people', 'people', 'People')}
      <div className="spacer" />
      {btn('settings', 'settings', 'Settings and appearance')}
      {btn('notifications', 'bell', 'Notifications', '', unread)}
      {btn('ai', 'sparkle', 'AI assistant', 'ai')}
      <button type="button" className="rb" aria-label="Sign out" title="Sign out" onClick={onSignOut}>
        <Icon name="logout" />
      </button>
      <div className="avatar" role="img" aria-label={`Signed in as ${me.user.display_name}`} title={me.user.display_name}>
        {initials(me.user.display_name)}
      </div>
    </nav>
  );
}

export { initials };
