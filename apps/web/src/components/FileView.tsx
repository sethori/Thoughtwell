import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { BRAIN_DIRS, dirname, fileKind, type Entry } from '@notes/shared';
import { errorText, tw, vaultUrl, type SearchHit } from '../lib/vault';
import { Icon } from './Icon';
import { ConfirmDialog } from './Dialog';

const MAX_TEXT = 2 * 1024 * 1024;

function size(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

/** Shows a file that is not a note: PDFs, video, audio, images and text right here; anything else opens in its own app. */
export function FileView({
  entry,
  rightSlot,
  onOpen,
  onClosed,
  notify,
}: {
  entry: Entry;
  rightSlot: HTMLElement | null;
  onOpen: (path: string) => void;
  onClosed: () => void;
  notify: (msg: string) => void;
}) {
  const kind = fileKind(entry.path);
  const [text, setText] = useState<string | null>(null);
  const [notes, setNotes] = useState<SearchHit[]>([]);
  const [confirmTrash, setConfirmTrash] = useState(false);
  const url = vaultUrl(entry.path, Math.round(entry.mtime));

  useEffect(() => {
    setText(null);
    if ((kind === 'text' || kind === 'sketch') && entry.size <= MAX_TEXT) {
      void tw
        .read(entry.path)
        .then((r) => setText(r.content))
        .catch((e) => notify(errorText(e)));
    }
  }, [entry.path, entry.mtime, entry.size, kind, notify]);

  // Notes that point back at this file, such as an agent's summary of it.
  useEffect(() => {
    const name = entry.name;
    void tw.search(name.replace(/\.[^.]+$/, '')).then((hits) => setNotes(hits.filter((h) => h.kind === 'note' && h.path !== entry.path).slice(0, 8)));
  }, [entry.path, entry.name]);

  const inInbox = entry.path.startsWith(BRAIN_DIRS.inbox + '/');

  return (
    <>
      <div className="topbar">
        <Icon name={kind === 'image' ? 'image' : 'folder'} />
        <h1 className="title-static">{entry.name}</h1>
        <span className="chip">{size(entry.size)}</span>
        {inInbox && <span className="chip warn">Waiting for an agent</span>}
        <span className="push" />
        <button type="button" className="btn" onClick={() => void tw.openWithDefaultApp(entry.path).catch((e) => notify(errorText(e)))}>
          Open in its app
        </button>
        <button type="button" className="ib" title="Show in file manager" aria-label="Show in file manager" onClick={() => void tw.reveal(entry.path)}>
          <Icon name="folder" />
        </button>
        <button type="button" className="ib" title="Move to trash" aria-label="Move to trash" onClick={() => setConfirmTrash(true)}>
          <Icon name="trash" />
        </button>
      </div>
      <div className="stage file-stage">
        <div className="crumbs">{dirname(entry.path).split('/').join(' / ')}</div>
        {kind === 'image' && <img className="file-image" src={url} alt={entry.name} />}
        {kind === 'pdf' && <iframe className="file-frame" src={url} title={entry.name} />}
        {kind === 'video' && <video className="file-media" src={url} controls preload="metadata" />}
        {kind === 'audio' && <audio className="file-audio" src={url} controls preload="metadata" />}
        {(kind === 'text' || kind === 'sketch') &&
          (entry.size > MAX_TEXT ? (
            <div className="banner">This file is too large to show here. Open it in its app.</div>
          ) : (
            <pre className="file-text">{text ?? ''}</pre>
          ))}
        {kind === 'other' && (
          <div className="welcome">
            <p>Thoughtwell can't show this kind of file. Open it in its own app, or ask an agent to summarize it.</p>
          </div>
        )}
      </div>
      {rightSlot &&
        createPortal(
          <aside className="right" aria-label="About this file">
            <div className="sech">
              <span>Notes about this file</span>
            </div>
            {notes.length ? (
              notes.map((h) => (
                <button key={h.path} type="button" className="rel" onClick={() => onOpen(h.path)} title={h.path}>
                  <span className="rel-t">
                    <Icon name="note" small />
                    {h.title}
                  </span>
                  {(h.summary || h.snippet) && <span className="rel-s">{h.summary || h.snippet}</span>}
                </button>
              ))
            ) : (
              <div className="hint">{inInbox ? 'Not processed yet. Ask an agent to process the Brain inbox.' : 'No notes mention this file yet.'}</div>
            )}
          </aside>,
          rightSlot,
        )}
      {confirmTrash && (
        <ConfirmDialog
          title={`Move ${entry.name} to the trash?`}
          message="You can restore it from your system's trash."
          confirm="Move to trash"
          danger
          onClose={() => setConfirmTrash(false)}
          onConfirm={async () => {
            await tw.trash(entry.path);
            onClosed();
          }}
        />
      )}
    </>
  );
}
