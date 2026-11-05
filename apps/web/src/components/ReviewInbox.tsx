import { useEffect, useState } from 'react';
import { api, type ReviewListItem } from '../lib/api';
import { Dialog } from './Dialog';

const STATUS: Record<ReviewListItem['status'], string> = {
  open: 'Waiting',
  sent_back: 'Sent back',
  approved: 'Approved',
  withdrawn: 'Withdrawn',
};

/** Reviews waiting for you, and the ones you asked for. */
export function ReviewInbox({ onOpen, onClose }: { onOpen: (pageId: string) => void; onClose: () => void }) {
  const [tab, setTab] = useState<'inbox' | 'mine'>('inbox');
  const [items, setItems] = useState<ReviewListItem[] | null>(null);

  useEffect(() => {
    setItems(null);
    void api.get<ReviewListItem[]>(`/api/reviews?scope=${tab}`).then(setItems);
  }, [tab]);

  return (
    <Dialog title="Reviews" sub="Drafts waiting for an approver, and the ones you submitted." wide onClose={onClose}>
      <div className="tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'inbox'} className={tab === 'inbox' ? 'on' : ''} onClick={() => setTab('inbox')}>
          To review
        </button>
        <button type="button" role="tab" aria-selected={tab === 'mine'} className={tab === 'mine' ? 'on' : ''} onClick={() => setTab('mine')}>
          Submitted by me
        </button>
      </div>
      <div className="list">
        {items === null && <div>Loading…</div>}
        {items?.length === 0 && <div>{tab === 'inbox' ? 'Nothing is waiting for you.' : 'You have no reviews in progress.'}</div>}
        {items?.map((r) => (
          <button
            key={r.id}
            type="button"
            className="list-row"
            onClick={() => {
              onOpen(r.page_id);
              onClose();
            }}
          >
            <span className={`chip ${r.status === 'open' ? 'warn' : r.status === 'sent_back' ? 'bad' : r.status === 'approved' ? 'ok' : ''}`}>{STATUS[r.status]}</span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <strong>{r.page_title}</strong>
              <span className="meta">
                {' '}
                · {r.folder_name} · {r.submitted_by_name ?? 'someone'} · round {r.round}
              </span>
              {r.latest_note && <span className="meta block">“{r.latest_note}”</span>}
            </span>
            <span className="meta">{new Date(r.created_at).toLocaleDateString()}</span>
          </button>
        ))}
      </div>
    </Dialog>
  );
}
