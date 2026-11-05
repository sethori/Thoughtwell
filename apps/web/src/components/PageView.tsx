import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import { roleAtLeast, type PMNode } from '@notes/shared';
import { ApiError, api, type Page, type PMDoc } from '../lib/api';
import { editorExtensions } from '../lib/extensions';
import { downloadMarkdown } from '../lib/markdown';
import { Icon } from './Icon';
import { ConfirmDialog, Dialog } from './Dialog';

type SaveState = 'saved' | 'saving' | 'unsaved' | 'conflict' | 'error';

const SAVE_LABEL: Record<SaveState, string> = {
  saved: 'Saved',
  saving: 'Saving…',
  unsaved: 'Unsaved changes',
  conflict: 'Not saved: someone else edited this page',
  error: 'Not saved: connection problem',
};

/** Uploads an image file and returns its URL. Shared with the tools panel. */
export async function uploadImage(pageId: string, file: File): Promise<string> {
  const form = new FormData();
  form.append('file', file);
  const r = await api.post<{ url: string }>(`/api/pages/${pageId}/assets`, form);
  return r.url;
}

export function PageView({
  pageId,
  onEditor,
  onSaved,
  onClosed,
  notify,
}: {
  pageId: string;
  onEditor: (e: Editor | null) => void;
  onSaved: () => void;
  onClosed: () => void;
  notify: (msg: string) => void;
}) {
  const [page, setPage] = useState<Page | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [save, setSave] = useState<SaveState>('saved');
  const [showPublished, setShowPublished] = useState(false);
  const [versions, setVersions] = useState<{ number: number; title: string; created_at: string; created_by: string }[] | null>(null);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const rev = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const inFlight = useRef<Promise<void> | null>(null);

  const canEdit = page ? roleAtLeast(page.role, 'contributor') : false;

  const editor = useEditor(
    {
      extensions: editorExtensions,
      editable: false,
      content: '',
      editorProps: {
        attributes: { 'aria-label': 'Page content' },
        handlePaste: (_view, event) => {
          const file = event.clipboardData?.files?.[0];
          if (file && file.type.startsWith('image/')) {
            void uploadImage(pageId, file).then((src) => editorRef.current?.chain().focus().setImage({ src }).run());
            return true;
          }
          return false;
        },
      },
      onUpdate: () => schedule(),
    },
    [pageId],
  );
  const editorRef = useRef<Editor | null>(null);
  editorRef.current = editor;

  const titleRef = useRef(title);
  titleRef.current = title;

  const flush = useCallback(async () => {
    const ed = editorRef.current;
    if (!ed || !ed.isEditable) return;
    if (inFlight.current) await inFlight.current;
    setSave('saving');
    const run = (async () => {
      try {
        const r = await api.put<{ rev: number }>(`/api/pages/${pageId}/draft`, {
          title: titleRef.current,
          content: ed.getJSON(),
          baseRev: rev.current,
        });
        rev.current = r.rev;
        setSave('saved');
        onSaved();
      } catch (err) {
        setSave(err instanceof ApiError && err.status === 409 ? 'conflict' : 'error');
      }
    })();
    inFlight.current = run;
    await run;
    inFlight.current = null;
  }, [pageId, onSaved]);

  const schedule = useCallback(() => {
    setSave((s) => (s === 'conflict' ? s : 'unsaved'));
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), 1200);
  }, [flush]);

  // Load the page.
  useEffect(() => {
    let cancelled = false;
    api
      .get<Page>(`/api/pages/${pageId}`)
      .then((p) => {
        if (cancelled) return;
        setPage(p);
        setTitle(p.title);
        rev.current = p.draft?.rev ?? 0;
      })
      .catch((err) => !cancelled && setError((err as Error).message));
    return () => {
      cancelled = true;
    };
  }, [pageId]);

  // Put the content into the editor once both are ready.
  useEffect(() => {
    if (!editor || !page) return;
    const content: PMDoc = (showPublished || !page.draft ? page.published?.content : page.draft.content) ?? { type: 'doc', content: [] };
    editor.commands.setContent(content as object, false);
    editor.setEditable(canEdit && !showPublished);
    onEditor(canEdit && !showPublished ? editor : null);
  }, [editor, page, showPublished, canEdit, onEditor]);

  // Save on leave.
  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current);
        void flush();
      }
      onEditor(null);
    },
    [flush, onEditor],
  );

  if (error) {
    return (
      <div className="stage">
        <div className="banner bad">{error}</div>
      </div>
    );
  }
  if (!page || !editor) return <div className="stage" />;

  const publish = async () => {
    clearTimeout(timer.current);
    await flush();
    try {
      const r = await api.post<{ number: number }>(`/api/pages/${pageId}/publish`);
      notify(`Published version ${r.number}`);
      const fresh = await api.get<Page>(`/api/pages/${pageId}`);
      setPage(fresh);
      rev.current = fresh.draft?.rev ?? rev.current;
      onSaved();
    } catch (err) {
      notify((err as Error).message);
    }
  };

  const statusChip =
    page.status === 'draft' ? (
      <span className="chip">Draft</span>
    ) : page.status === 'changed' || save !== 'saved' ? (
      <span className="chip warn">Edited since v{page.published?.number}</span>
    ) : (
      <span className="chip ok">Published v{page.published?.number}</span>
    );

  const fb = (label: string, active: boolean, run: () => void, content: ReactNode) => (
    <button type="button" className={`fb ${active ? 'on' : ''}`} aria-label={label} title={label} aria-pressed={active} onClick={run} disabled={!editor.isEditable}>
      {content}
    </button>
  );
  const c = () => editor.chain().focus();

  return (
    <>
      <div className="topbar">
        <Icon name="note" />
        <input
          className="title-input"
          aria-label="Page title"
          value={title}
          readOnly={!canEdit || showPublished}
          onChange={(e) => {
            setTitle(e.target.value);
            schedule();
          }}
        />
        {statusChip}
        {canEdit && <span className={`chip ${save === 'conflict' || save === 'error' ? 'bad' : ''}`}>{SAVE_LABEL[save]}</span>}
        <span className="push" />
        {page.published && canEdit && (
          <button type="button" className="btn" onClick={() => setShowPublished((v) => !v)}>
            {showPublished ? 'Back to draft' : 'View published'}
          </button>
        )}
        <button
          type="button"
          className="ib"
          aria-label="Version history"
          title="Version history"
          onClick={async () => setVersions(await api.get(`/api/pages/${pageId}/versions`))}
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
        {canEdit && (
          <button type="button" className="btn pri" onClick={publish} disabled={showPublished || save === 'conflict'}>
            <Icon name="publish" small />
            Publish
          </button>
        )}
      </div>

      {canEdit && !showPublished && (
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
          {editor.isActive('table') && (
            <>
              <span className="sep" />
              {fb('Add row', false, () => c().addRowAfter().run(), <span>+ Row</span>)}
              {fb('Add column', false, () => c().addColumnAfter().run(), <span>+ Col</span>)}
              {fb('Delete row', false, () => c().deleteRow().run(), <span>− Row</span>)}
              {fb('Delete column', false, () => c().deleteColumn().run(), <span>− Col</span>)}
              {fb('Delete table', false, () => c().deleteTable().run(), <Icon name="trash" small />)}
            </>
          )}
        </div>
      )}

      <div className="stage">
        <div className="crumbs">{page.breadcrumb.map((b) => b.name).join(' / ')}</div>
        {save === 'conflict' && (
          <div className="banner bad" role="alert">
            Someone else saved this page after you opened it. Copy anything you need, then
            <button type="button" className="btn" onClick={() => location.reload()}>
              Reload
            </button>
          </div>
        )}
        {showPublished && (
          <div className="banner warn">
            You are viewing published version {page.published?.number}. Editing happens in the draft.
          </div>
        )}
        {!canEdit && !page.published && <div className="banner warn">This page has not been published yet.</div>}
        <article className="sheet">
          <EditorContent editor={editor} />
        </article>
      </div>

      {versions && (
        <Dialog title="Version history" sub="Each publish creates a version that never changes." onClose={() => setVersions(null)}>
          <div className="list">
            {versions.map((v) => (
              <div key={v.number}>
                <span className="chip">v{v.number}</span>
                <span style={{ flex: 1 }}>{v.title}</span>
                <span className="meta" style={{ color: 'var(--faint)', fontSize: 12 }}>
                  {new Date(v.created_at).toLocaleString()} · {v.created_by}
                </span>
              </div>
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
            clearTimeout(timer.current);
            timer.current = undefined;
            await api.del(`/api/pages/${pageId}`);
            onClosed();
          }}
        />
      )}
    </>
  );
}
