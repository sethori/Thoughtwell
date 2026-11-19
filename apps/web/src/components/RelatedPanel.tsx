import { useEffect, useState } from 'react';
import { areaOf } from '@notes/shared';
import { tw, type SearchHit } from '../lib/vault';
import { Icon } from './Icon';

/**
 * Links from the open note into the rest of the vault. For your own notes,
 * the main list is "From your Brain": what your agents have gathered that
 * relates to what you are writing.
 */
export function RelatedPanel({
  path,
  draft,
  version,
  onOpen,
}: {
  path: string;
  /** The note's current text, so suggestions follow what you are writing before it is saved. */
  draft: string;
  /** Changes when the vault changes, to refresh. */
  version: number;
  onOpen: (path: string) => void;
}) {
  const area = areaOf(path);
  const [related, setRelated] = useState<SearchHit[]>([]);
  const [mine, setMine] = useState<SearchHit[]>([]);
  const [backlinks, setBacklinks] = useState<SearchHit[]>([]);

  useEffect(() => {
    let stale = false;
    const t = setTimeout(async () => {
      const input = { path, text: draft.slice(0, 20_000) };
      const [r, m, b] = await Promise.all([
        tw.related(input, 'brain'),
        area === 'brain' ? tw.related(input, 'me') : Promise.resolve([]),
        tw.backlinks(path),
      ]);
      if (stale) return;
      setRelated(r.slice(0, 8));
      setMine(m.slice(0, 5));
      setBacklinks(b);
    }, 400);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [path, draft, version, area]);

  const list = (hits: SearchHit[]) =>
    hits.map((h) => (
      <button key={h.path} type="button" className="rel" onClick={() => onOpen(h.path)} title={h.path}>
        <span className="rel-t">
          <Icon name={h.kind === 'note' ? 'note' : 'folder'} small />
          {h.title}
        </span>
        {(h.summary || h.snippet) && <span className="rel-s">{h.summary || h.snippet}</span>}
        {h.tags.length > 0 && (
          <span className="rel-tags">
            {h.tags.slice(0, 4).map((t) => (
              <span key={t} className="tagchip">
                #{t}
              </span>
            ))}
          </span>
        )}
      </button>
    ));

  return (
    <>
      <div className="sech">
        <span>{area === 'me' ? 'From your Brain' : 'Related in Brain'}</span>
      </div>
      {related.length ? list(related) : <div className="hint">{area === 'me' ? 'Nothing related yet. Keep writing, or add material to Brain/Inbox for your agents.' : 'Nothing related yet.'}</div>}
      {mine.length > 0 && (
        <>
          <div className="sech">
            <span>In your notes</span>
          </div>
          {list(mine)}
        </>
      )}
      {backlinks.length > 0 && (
        <>
          <div className="sech">
            <span>Linked from</span>
          </div>
          {list(backlinks)}
        </>
      )}
    </>
  );
}
