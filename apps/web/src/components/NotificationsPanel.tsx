import { useEffect, useState } from 'react';
import { api, type NotificationItem } from '../lib/api';
import { Dialog } from './Dialog';

/** The bell: reviews and publishes on things you take part in or watch. */
export function NotificationsPanel({ onOpen, onClose, onRead }: { onOpen: (pageId: string, review: boolean) => void; onClose: () => void; onRead: () => void }) {
  const [items, setItems] = useState<NotificationItem[] | null>(null);

  const load = () => api.get<{ items: NotificationItem[] }>('/api/notifications').then((r) => setItems(r.items));
  useEffect(() => {
    void load();
  }, []);

  return (
    <Dialog title="Notifications" sub="Reviews you take part in, and pages you watch." wide onClose={onClose}>
      <div className="list">
        {items === null && <div>Loading…</div>}
        {items?.length === 0 && <div>Nothing yet. Right-click a folder and choose Watch to hear about its pages.</div>}
        {items?.map((n) => (
          <button
            key={n.id}
            type="button"
            className={`list-row ${n.read_at ? '' : 'unread'}`}
            onClick={async () => {
              if (!n.read_at) await api.post('/api/notifications/read', { ids: [n.id] });
              onRead();
              onOpen(n.payload.pageId, n.type.startsWith('review.'));
              onClose();
            }}
          >
            {!n.read_at && <span className="dot" aria-label="Unread" />}
            <span style={{ flex: 1, minWidth: 0 }}>
              <strong>{n.title}</strong>
              <span className="meta block">{n.body}</span>
            </span>
            <span className="meta">{new Date(n.created_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
          </button>
        ))}
      </div>
      <div className="actions">
        <button
          type="button"
          className="btn"
          disabled={!items?.some((n) => !n.read_at)}
          onClick={async () => {
            await api.post('/api/notifications/read', {});
            onRead();
            await load();
          }}
        >
          Mark all read
        </button>
        <button type="button" className="btn pri" onClick={onClose}>
          Done
        </button>
      </div>
    </Dialog>
  );
}
