import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCursor from '@tiptap/extension-collaboration-cursor';
import { roleAtLeast, type DocChange, type JsonNode, type PMNode } from '@notes/shared';
import { api, type Me, type Page, type PMDoc, type Review } from '../lib/api';
import { colorFor, openCollab, peersOf, type CollabSession, type Peer } from '../lib/collab';
import { CODE_LANGUAGES, extensions, placeholder } from '../lib/extensions';
import { currentCell, insertColumnFormula } from '../lib/formulas';
import { downloadMarkdown } from '../lib/markdown';
import { rejectChange, reviewChanges, ReviewMarkup, setReview } from '../lib/review';
import { initials } from './Rail';
import { Icon } from './Icon';
import { ConfirmDialog, Dialog, PromptDialog } from './Dialog';
import { ToolsPanel, type PageTools } from './ToolsPanel';

type Sync = 'connecting' | 'saved' | 'saving' | 'offline' | 'denied';

const SYNC_LABEL: Record<Sync, string> = {
  connecting: 'Connecting…',
  saved: 'Saved',
  saving: 'Saving…',
  offline: 'Offline: edits sync when the connection is back',
  denied: 'Live editing is not available for you on this page',
};

/** Uploads an image file and returns its URL. Shared with the tools panel. */
export async function uploadImage(pageId: string, file: File): Promise<string> {
  const form = new FormData();
  form.append('file', file);
  const r = await api.post<{ url: string }>(`/api/pages/${pageId}/assets`, form);
  return r.url;
}

const EMPTY: PMDoc = { type: 'doc', content: [] };

export function PageView({
  pageId,
  me,
  rightSlot,
  openReview,
  openNonce = 0,
  onSaved,
  onClosed,
  notify,
}: {
  pageId: string;
  me: Me;
  openNonce?: number;
  /** Where the right-hand tools panel goes. */
  rightSlot: HTMLElement | null;
  /** Opened from the review inbox or a notification: start with the review panel showing. */
  openReview?: boolean;
  onSaved: () => void;
  onClosed: () => void;
  notify: (msg: string) => void;
}) {
  const [page, setPage] = useState<Page | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<CollabSession | null>(null);
  const [view, setView] = useState<'draft' | 'published' | number>('draft');

  const load = useCallback(async () => {
    try {
      const p = await api.get<Page>(`/api/pages/${pageId}`);
      setPage(p);
      return p;
    } catch (err) {
      setError((err as Error).message);
      return null;
    }
  }, [pageId]);

  // Reload when opened again from a list, when the window regains focus, and
  // every half minute, so review status changes made by others show up.
  useEffect(() => {
    void load();
  }, [load, openNonce]);
  useEffect(() => {
    const again = () => void load();
    window.addEventListener('focus', again);
    const t = setInterval(again, 30_000);
    return () => {
      window.removeEventListener('focus', again);
      clearInterval(t);
    };
  }, [load]);

  const hasDraft = Boolean(page?.draft);
  // One live connection per page, for anyone who can see the draft.
  useEffect(() => {
    if (!hasDraft) return;
    const s = openCollab(pageId, (reason) => notify(`Live editing refused: ${reason}`));
    setSession(s);
    return () => {
      s.destroy();
      setSession(null);
    };
  }, [pageId, hasDraft, notify]);

  if (error) {
    return (
      <div className="stage">
        <div className="banner bad">{error}</div>
      </div>
    );
  }
  if (!page) return <div className="stage" />;

  if (!page.draft || view !== 'draft') {
    return (
      <StaticPage
        page={page}
        view={view}
        onBack={page.draft ? () => setView('draft') : undefined}
        rightSlot={rightSlot}
        notify={notify}
      />
    );
  }
  if (!session) return <div className="stage" />;
  return (
    <LivePage
      key={pageId}
      page={page}
      me={me}
      session={session}
      rightSlot={rightSlot}
      startInReview={Boolean(openReview)}
      openNonce={openNonce}
      reload={load}
      onShowVersion={(v) => setView(v)}
      onSaved={onSaved}
      onClosed={onClosed}
      notify={notify}
    />
  );
}

// ---------------------------------------------------------------- read-only views

function StaticPage({
  page,
  view,
  onBack,
  rightSlot,
  notify,
}: {
  page: Page;
  view: 'draft' | 'published' | number;
  onBack?: () => void;
  rightSlot: HTMLElement | null;
  notify: (msg: string) => void;
}) {
  const [content, setContent] = useState<{ title: string; content: PMDoc; label: string } | null>(null);

  useEffect(() => {
    if (typeof view === 'number') {
      void api
        .get<{ title: string; content: PMDoc; number: number }>(`/api/pages/${page.id}/versions/${view}`)
        .then((v) => setContent({ title: v.title, content: v.content, label: `Version ${v.number}` }))
        .catch((e: Error) => notify(e.message));
    } else if (page.published) {
      setContent({ title: page.published.title, content: page.published.content, label: `Published version ${page.published.number}` });
    } else {
      setContent({ title: page.title, content: EMPTY, label: 'Not published yet' });
    }
  }, [page, view, notify]);

  const editor = useEditor({ extensions, editable: false, content: '' }, []);
  useEffect(() => {
    if (editor && content) editor.commands.setContent(content.content as object, false);
  }, [editor, content]);

  return (
    <>
      <div className="topbar">
        <Icon name="note" />
        <h1 className="title-static">{content?.title ?? page.title}</h1>
        <span className="chip">{content?.label}</span>
        <span className="push" />
        {onBack && (
          <button type="button" className="btn" onClick={onBack}>
            Back to draft
          </button>
        )}
        <button
          type="button"
          className="ib"
          aria-label="Export as Markdown"
          title="Export as Markdown"
          onClick={() => editor && downloadMarkdown(content?.title ?? page.title, editor.getJSON() as unknown as PMNode)}
        >
          <Icon name="download" />
        </button>
      </div>
      <div className="stage">
        <div className="crumbs">{page.breadcrumb.map((b) => b.name).join(' / ')}</div>
        {!page.published && typeof view !== 'number' && <div className="banner warn">This page has not been published yet.</div>}
        <article className="sheet">{editor && <EditorContent editor={editor} />}</article>
      </div>
      {rightSlot && createPortal(<ToolsPanel editor={null} pageId={page.id} notify={notify} />, rightSlot)}
    </>
  );
}

// ---------------------------------------------------------------- the live draft

function LivePage({
  page,
  me,
  session,
  rightSlot,
  startInReview,
  openNonce,
  reload,
  onShowVersion,
  onSaved,
  onClosed,
  notify,
}: {
  page: Page;
  me: Me;
  session: CollabSession;
  rightSlot: HTMLElement | null;
  startInReview: boolean;
  openNonce: number;
  reload: () => Promise<Page | null>;
  onShowVersion: (v: 'published' | number) => void;
  onSaved: () => void;
  onClosed: () => void;
  notify: (msg: string) => void;
}) {
  const { provider, ydoc } = session;
  const canEdit = roleAtLeast(page.role, 'contributor');
  const [sync, setSync] = useState<Sync>('connecting');
  const [peers, setPeers] = useState<Peer[]>([]);
  const [title, setTitleState] = useState(page.title);
  const [showChanges, setShowChanges] = useState(startInReview || page.review?.status === 'open');
  const [changes, setChanges] = useState<DocChange[]>([]);
  const [review, setReviewData] = useState<Review | null>(null);
  const [versions, setVersions] = useState<{ number: number; title: string; created_at: string; created_by: string }[] | null>(null);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [askSubmit, setAskSubmit] = useState(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout>>();

  const user = useMemo(() => ({ name: me.user.display_name, color: colorFor(me.user.id) }), [me.user]);

  const editor = useEditor(
    {
      extensions: [
        ...extensions,
        placeholder,
        Collaboration.configure({ document: ydoc }),
        CollaborationCursor.configure({ provider, user }),
        ReviewMarkup,
      ],
      editable: canEdit,
      editorProps: {
        attributes: { 'aria-label': 'Page content' },
        handlePaste: (_view, event) => {
          const file = event.clipboardData?.files?.[0];
          if (file && file.type.startsWith('image/')) {
            void uploadImage(page.id, file)
              .then((src) => editorRef.current?.chain().focus().setImage({ src }).run())
              .catch((e: Error) => notify(e.message));
            return true;
          }
          return false;
        },
        handleDrop: (_view, event) => {
          const file = (event as DragEvent).dataTransfer?.files?.[0];
          if (file && file.type.startsWith('image/')) {
            void uploadImage(page.id, file)
              .then((src) => editorRef.current?.chain().focus().setImage({ src }).run())
              .catch((e: Error) => notify(e.message));
            return true;
          }
          return false;
        },
      },
      onTransaction: ({ editor: ed }) => setChanges(reviewChanges(ed)),
    },
    [ydoc, provider],
  );
  const editorRef = useRef<Editor | null>(null);
  editorRef.current = editor;

  // Connection, saving and presence.
  useEffect(() => {
    const onStatus = ({ status }: { status: string }) => setSync(status === 'connected' ? 'saved' : status === 'connecting' ? 'connecting' : 'offline');
    const onUnsynced = () => {
      setSync(provider.hasUnsyncedChanges ? 'saving' : 'saved');
      // Refresh the library a little after edits settle (status, recent pages).
      clearTimeout(savedTimer.current);
      if (!provider.hasUnsyncedChanges) savedTimer.current = setTimeout(onSaved, 3000);
    };
    const onAwareness = () => setPeers(peersOf(provider));
    const onDenied = () => setSync('denied');
    provider.on('status', onStatus);
    provider.on('unsyncedChanges', onUnsynced);
    provider.on('awarenessChange', onAwareness);
    provider.on('authenticationFailed', onDenied);
    if (provider.isSynced) setSync('saved');
    onAwareness();
    return () => {
      provider.off('status', onStatus);
      provider.off('unsyncedChanges', onUnsynced);
      provider.off('awarenessChange', onAwareness);
      provider.off('authenticationFailed', onDenied);
      clearTimeout(savedTimer.current);
    };
  }, [provider, onSaved]);

  // The title is part of the live document, so renames show for everyone.
  useEffect(() => {
    const meta = ydoc.getMap('meta');
    const read = () => {
      const t = meta.get('title');
      if (typeof t === 'string') setTitleState(t);
    };
    read();
    meta.observe(read);
    return () => meta.unobserve(read);
  }, [ydoc]);
  const setTitle = (t: string) => {
    setTitleState(t);
    ydoc.getMap('meta').set('title', t);
  };

  // Opening the page from the review inbox or a notification shows the changes.
  useEffect(() => {
    if (startInReview) setShowChanges(true);
  }, [startInReview, openNonce]);
  // A review someone else opened while this page was open turns markup on too.
  const reviewOpen = page.review?.status === 'open';
  useEffect(() => {
    if (reviewOpen && page.policy.canApprove) setShowChanges(true);
  }, [reviewOpen, page.policy.canApprove]);

  // Review markup compares the draft with the live version.
  const base = (page.published?.content ?? null) as JsonNode | null;
  useEffect(() => {
    if (editor) setReview(editor, { enabled: showChanges, base, focus: null });
  }, [editor, showChanges, base]);

  const loadReview = useCallback(async () => {
    if (!page.review) return setReviewData(null);
    setReviewData(await api.get<Review>(`/api/reviews/${page.review.id}`));
  }, [page.review]);
  useEffect(() => {
    void loadReview();
  }, [loadReview]);

  if (!editor) return <div className="stage" />;

  const refresh = async () => {
    await reload();
    onSaved();
  };

  const publish = async () => {
    try {
      const r = await api.post<{ number: number }>(`/api/pages/${page.id}/publish`);
      notify(`Published version ${r.number}`);
      await refresh();
    } catch (err) {
      notify((err as Error).message);
    }
  };

  const tools: PageTools = {
    editor,
    page,
    review,
    changes,
    showChanges,
    setShowChanges,
    submit: () => setAskSubmit(true),
    async withdraw() {
      if (!review) return;
      await api.post(`/api/reviews/${review.id}/withdraw`);
      notify('Review withdrawn');
      await refresh();
    },
    async decide(c, decision) {
      if (!review) return;
      if (decision === 'rejected' && !rejectChange(editor, c)) {
        notify('That change could not be undone automatically. Edit it by hand.');
        return;
      }
      const r = await api.put<{ decisions: Review['decisions'] }>(`/api/reviews/${review.id}/decisions`, { key: c.key, decision });
      setReviewData({ ...review, decisions: r.decisions });
    },
    async approve(note) {
      if (!review) return;
      try {
        const r = await api.post<{ number: number }>(`/api/reviews/${review.id}/approve`, note ? { note } : {});
        notify(`Approved and published version ${r.number}`);
        await refresh();
      } catch (err) {
        notify((err as Error).message);
      }
    },
    async sendBack(note) {
      if (!review) return;
      await api.post(`/api/reviews/${review.id}/send-back`, { note });
      notify('Sent back with your note');
      await refresh();
    },
    async comment(body, changeKey) {
      if (!review) return;
      await api.post(`/api/reviews/${review.id}/notes`, { body, ...(changeKey ? { changeKey } : {}) });
      await loadReview();
    },
  };

  const status = page.review?.status === 'open' ? (
    <span className="chip warn">In review</span>
  ) : page.status === 'draft' ? (
    <span className="chip">Draft</span>
  ) : page.status === 'changed' ? (
    <span className="chip warn">Edited since v{page.published?.number}</span>
  ) : (
    <span className="chip ok">Published v{page.published?.number}</span>
  );

  const watching = page.watching.length > 0;
  const inReview = page.review?.status === 'open';

  return (
    <>
      <div className="topbar">
        <Icon name="note" />
        <input className="title-input" aria-label="Page title" value={title} readOnly={!canEdit} maxLength={300} onChange={(e) => setTitle(e.target.value)} />
        {status}
        <span className={`chip ${sync === 'offline' || sync === 'denied' ? 'bad' : ''}`} role="status">
          {SYNC_LABEL[sync]}
        </span>
        <span className="push" />
        <Presence peers={peers} />
        {page.published && (
          <button type="button" className="btn" onClick={() => onShowVersion('published')}>
            View published
          </button>
        )}
        <button
          type="button"
          className={`ib ${watching ? 'on' : ''}`}
          aria-label={watching ? 'Stop watching this page' : 'Watch this page'}
          title={watching ? 'Watching: you hear about reviews and publishes' : 'Watch this page'}
          aria-pressed={watching}
          onClick={async () => {
            await api.put('/api/watches', { scopeType: 'page', scopeId: page.id, events: watching ? [] : ['published', 'review'] });
            await reload();
          }}
        >
          <Icon name="eye" />
        </button>
        <button
          type="button"
          className="ib"
          aria-label="Version history"
          title="Version history"
          onClick={async () => setVersions(await api.get(`/api/pages/${page.id}/versions`))}
        >
          <Icon name="history" />
        </button>
        <button
          type="button"
          className="ib"
          aria-label="Export as Markdown"
          title="Export as Markdown"
          onClick={() => downloadMarkdown(title, editor.getJSON() as unknown as PMNode)}
        >
          <Icon name="download" />
        </button>
        {roleAtLeast(page.role, 'editor') && (
          <button type="button" className="ib" aria-label="Archive page" title="Archive page" onClick={() => setConfirmArchive(true)}>
            <Icon name="trash" />
          </button>
        )}
        {canEdit && page.policy.canPublishDirectly && (
          <button type="button" className="btn pri" onClick={publish}>
            <Icon name="publish" small />
            Publish
          </button>
        )}
        {canEdit && !page.policy.canPublishDirectly && !inReview && (
          <button type="button" className="btn pri" onClick={() => setAskSubmit(true)}>
            <Icon name="review" small />
            Submit for review
          </button>
        )}
        {inReview && review?.canDecide && !showChanges && (
          <button type="button" className="btn pri" onClick={() => setShowChanges(true)}>
            <Icon name="review" small />
            Review changes
          </button>
        )}
      </div>

      {canEdit && <FormatBar editor={editor} />}

      <div className="stage">
        <div className="crumbs">{page.breadcrumb.map((b) => b.name).join(' / ')}</div>
        {sync === 'offline' && <div className="banner warn">You are offline. Keep writing; your edits sync when the connection returns.</div>}
        {page.review?.status === 'sent_back' && page.review.mine && review && (
          <div className="banner warn">
            <strong>Sent back for changes.</strong> {review.notes.filter((n) => n.kind === 'send_back').at(-1)?.body}
          </div>
        )}
        {inReview && !review?.canDecide && <div className="banner">Waiting for review. You can keep editing; the reviewer sees the latest draft.</div>}
        {showChanges && (
          <div className="banner">
            Showing changes since {page.published ? `version ${page.published.number}` : 'the start (never published)'}:{' '}
            <span className="chg-ins">added</span> and <span className="chg-del">removed</span>.
          </div>
        )}
        <article className="sheet">
          <EditorContent editor={editor} />
        </article>
      </div>

      {rightSlot && createPortal(<ToolsPanel editor={canEdit ? editor : null} pageId={page.id} notify={notify} tools={tools} />, rightSlot)}

      {askSubmit && (
        <PromptDialog
          title="Submit for review"
          label="Note for the reviewer (optional)"
          multiline
          confirm="Submit"
          allowEmpty
          onClose={() => setAskSubmit(false)}
          onSubmit={async (note) => {
            await api.post(`/api/pages/${page.id}/reviews`, note ? { note } : {});
            notify('Submitted for review. Approvers have been told.');
            setAskSubmit(false);
            await refresh();
          }}
        />
      )}
      {versions && (
        <Dialog title="Version history" sub="Each publish creates a version that never changes." onClose={() => setVersions(null)}>
          <div className="list">
            {versions.map((v) => (
              <button
                key={v.number}
                type="button"
                className="list-row"
                onClick={() => {
                  setVersions(null);
                  onShowVersion(v.number);
                }}
              >
                <span className="chip">v{v.number}</span>
                <span style={{ flex: 1 }}>{v.title}</span>
                <span className="meta">
                  {new Date(v.created_at).toLocaleString()} · {v.created_by}
                </span>
              </button>
            ))}
            {versions.length === 0 && <div>Not published yet.</div>}
          </div>
        </Dialog>
      )}
      {confirmArchive && (
        <ConfirmDialog
          title={`Archive ${title}?`}
          message="The page leaves the folder. Its published versions and history are kept."
          confirm="Archive"
          danger
          onClose={() => setConfirmArchive(false)}
          onConfirm={async () => {
            await api.del(`/api/pages/${page.id}`);
            onClosed();
          }}
        />
      )}
    </>
  );
}

function Presence({ peers }: { peers: Peer[] }) {
  if (peers.length < 2) return null;
  return (
    <div className="presence" aria-label={`${peers.length} people here`}>
      {peers.slice(0, 5).map((p) => (
        <span key={p.clientId} className="av" style={{ background: p.color }} title={p.self ? `${p.name} (you)` : p.name}>
          {initials(p.name)}
        </span>
      ))}
      {peers.length > 5 && <span className="av more">+{peers.length - 5}</span>}
    </div>
  );
}

function FormatBar({ editor }: { editor: Editor }) {
  const fb = (label: string, active: boolean, run: () => void, content: ReactNode) => (
    <button type="button" className={`fb ${active ? 'on' : ''}`} aria-label={label} title={label} aria-pressed={active} onClick={run} disabled={!editor.isEditable}>
      {content}
    </button>
  );
  const c = () => editor.chain().focus();
  const cell = editor.isActive('table') ? currentCell(editor.state) : null;

  return (
    <div className="fmt" role="toolbar" aria-label="Formatting">
      {fb('Undo', false, () => c().undo().run(), <Icon name="undo" small />)}
      {fb('Redo', false, () => c().redo().run(), <Icon name="redo" small />)}
      <span className="sep" />
      {fb('Bold', editor.isActive('bold'), () => c().toggleBold().run(), <b>B</b>)}
      {fb('Italic', editor.isActive('italic'), () => c().toggleItalic().run(), <i>I</i>)}
      {fb('Strikethrough', editor.isActive('strike'), () => c().toggleStrike().run(), <s>S</s>)}
      {fb('Inline code', editor.isActive('code'), () => c().toggleCode().run(), <Icon name="code" small />)}
      <span className="sep" />
      {fb('Heading 1', editor.isActive('heading', { level: 1 }), () => c().toggleHeading({ level: 1 }).run(), <b>H1</b>)}
      {fb('Heading 2', editor.isActive('heading', { level: 2 }), () => c().toggleHeading({ level: 2 }).run(), <b>H2</b>)}
      {fb('Heading 3', editor.isActive('heading', { level: 3 }), () => c().toggleHeading({ level: 3 }).run(), <b>H3</b>)}
      {fb('Bulleted list', editor.isActive('bulletList'), () => c().toggleBulletList().run(), <Icon name="list" small />)}
      {fb('Task list', editor.isActive('taskList'), () => c().toggleTaskList().run(), <Icon name="tasks" small />)}
      {fb('Quote', editor.isActive('blockquote'), () => c().toggleBlockquote().run(), <Icon name="quote" small />)}
      {fb(
        'Link',
        editor.isActive('link'),
        () => {
          const prev = editor.getAttributes('link').href as string | undefined;
          const href = window.prompt('Link address', prev ?? 'https://');
          if (href === null) return;
          if (href === '') c().unsetLink().run();
          else c().extendMarkRange('link').setLink({ href }).run();
        },
        <Icon name="link" small />,
      )}
      {editor.isActive('codeBlock') && (
        <>
          <span className="sep" />
          <select
            className="input lang"
            aria-label="Code language"
            value={String(editor.getAttributes('codeBlock').language ?? '')}
            onChange={(e) => c().updateAttributes('codeBlock', { language: e.target.value || null }).run()}
          >
            {CODE_LANGUAGES.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
        </>
      )}
      {editor.isActive('table') && (
        <>
          <span className="sep" />
          {fb('Add row', false, () => c().addRowAfter().run(), <span>+ Row</span>)}
          {fb('Add column', false, () => c().addColumnAfter().run(), <span>+ Col</span>)}
          {fb('Delete row', false, () => c().deleteRow().run(), <span>− Row</span>)}
          {fb('Delete column', false, () => c().deleteColumn().run(), <span>− Col</span>)}
          {fb('Delete table', false, () => c().deleteTable().run(), <Icon name="trash" small />)}
          <span className="sep" />
          {fb('Sum the cells above', false, () => insertColumnFormula(editor, 'SUM'), <span>Σ Sum</span>)}
          {fb('Average the cells above', false, () => insertColumnFormula(editor, 'AVERAGE'), <span>x̄ Avg</span>)}
          {cell && (
            <span className="cell-ref" title="Type = in a cell to start a formula, for example =SUM(B2:B5). Columns are A, B, C… from the left; rows count from 1 at the top.">
              {cell.address}
            </span>
          )}
        </>
      )}
    </div>
  );
}
