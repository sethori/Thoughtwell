import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Area } from '@notes/shared';
import { tw, type SearchHit } from '../lib/vault';
import { Icon } from './Icon';

/** Ctrl+K: search every note and file in the vault, or only one area. */
export function SearchDialog({ onOpen, onClose }: { onOpen: (path: string) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [area, setArea] = useState<Area | undefined>(undefined);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => input.current?.focus(), []);
  useEffect(() => {
    let stale = false;
    const t = setTimeout(async () => {
      const r = q.trim() ? await tw.search(q, area) : [];
      if (!stale) {
        setHits(r);
        setActive(0);
      }
    }, 120);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [q, area]);

  const pick = (h: SearchHit | undefined) => {
    if (!h) return;
    onOpen(h.path);
    onClose();
  };

  return createPortal(
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog wide search-dialog" role="dialog" aria-label="Search">
        <div className="search big">
          <Icon name="search" small />
          <input
            ref={input}
            value={q}
            placeholder="Search notes, summaries and files"
            aria-label="Search"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose();
              else if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((a) => Math.min(hits.length - 1, a + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((a) => Math.max(0, a - 1));
              } else if (e.key === 'Enter') pick(hits[active]);
            }}
          />
        </div>
        <div className="segs">
          {([
            [undefined, 'Everything'],
            ['me', 'Me'],
            ['brain', 'Brain'],
          ] as const).map(([a, label]) => (
            <button key={label} type="button" className={`seg ${area === a ? 'on' : ''}`} onClick={() => setArea(a)}>
              {label}
            </button>
          ))}
        </div>
        <div className="results">
          {hits.map((h, i) => (
            <button key={h.path} type="button" className={`rel ${i === active ? 'sel' : ''}`} onMouseEnter={() => setActive(i)} onClick={() => pick(h)}>
              <span className="rel-t">
                <Icon name={h.kind === 'note' ? 'note' : 'folder'} small />
                {h.title}
                <span className="rel-path">{h.path}</span>
              </span>
              {(h.snippet || h.summary) && <span className="rel-s">{h.snippet || h.summary}</span>}
            </button>
          ))}
          {q.trim() && hits.length === 0 && <div className="hint">Nothing found.</div>}
        </div>
      </div>
    </div>,
    document.body,
  );
}
