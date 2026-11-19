import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import type { EditorView } from '@tiptap/pm/view';
import {
  areaOf,
  dirname,
  docToMarkdown,
  joinFrontmatter,
  joinPath,
  markdownToDoc,
  noteName,
  parseMeta,
  safeFileName,
  splitFrontmatter,
  type NoteMeta,
  type PMNode,
} from '@notes/shared';
import { CODE_LANGUAGES, extensions, placeholder } from '../lib/extensions';
import { currentCell, insertColumnFormula } from '../lib/formulas';
import { errorCode, errorText, resolveFromNote, setCurrentNote, tw } from '../lib/vault';
import { Icon } from './Icon';
import { ConfirmDialog } from './Dialog';
import { attachImage, ToolsPanel } from './ToolsPanel';
import { RelatedPanel } from './RelatedPanel';

type SaveState = 'saved' | 'unsaved' | 'saving' | 'conflict' | 'gone' | 'error';

const SAVE_LABEL: Record<SaveState, string> = {
  saved: 'Saved',
  unsaved: 'Editing…',
  saving: 'Saving…',
  conflict: 'Not saved: changed elsewhere',
  gone: 'File missing',
  error: 'Not saved',
};

interface Loaded {
  frontmatter: string | null;
  meta: NoteMeta;
  doc: PMNode;
  /** The file's text as last read or written, to tell our own changes from others'. */
  text: string;
  /** The file's version as last read or written (for conflict checks). */
  version: string;
  /** Bumped to remount the editor with fresh content. */
  n: number;
}

export function NoteView({
  path,
  changed,
  rightSlot,
  onOpen,
  onRenamed,
  onClosed,
  notify,
}: {
  path: string;
  /** The latest batch of paths changed on disk, with a counter so repeats are noticed. */
  changed: { paths: string[]; n: number };
  rightSlot: HTMLElement | null;
  onOpen: (path: string) => void;
  onRenamed: (path: string) => void;
  onClosed: () => void;
  notify: (msg: string) => void;
}) {
  const area = areaOf(path);
  const [note, setNote] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<SaveState>('saved');
  // Brain notes are your agents' work: they open for reading, and you choose to edit.
  const [editing, setEditing] = useState(area !== 'brain');
  const [draft, setDraft] = useState('');
  const [confirmTrash, setConfirmTrash] = useState(false);
  const editorRef = useRef<Editor | null>(null);
  const noteRef = useRef<Loaded | null>(null);
  const timer = useRef<number | null>(null);
  const saving = useRef<Promise<void> | null>(null);
  const dirty = useRef(false);

  const load = useCallback(async () => {
    try {
      const { content, version } = await tw.read(path);
      const { frontmatter, body } = splitFrontmatter(content);
      const loaded: Loaded = { frontmatter, meta: parseMeta(frontmatter), doc: markdownToDoc(body), text: content, version, n: (noteRef.current?.n ?? 0) + 1 };
      setCurrentNote(path);
      noteRef.current = loaded;
      dirty.current = false;
      setNote(loaded);
      setState('saved');
      setError(null);
    } catch (err) {
      if (errorCode(err) === 'not_found' && noteRef.current) setState('gone');
      else setError(errorText(err));
    }
  }, [path]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Writes the editor's content back to the file, unless someone else changed the file since we read it. */
  const save = useCallback(
    async (force = false) => {
      const ed = editorRef.current;
      const cur = noteRef.current;
      if (!ed || !cur || (!dirty.current && !force)) return;
      if (saving.current) await saving.current;
      const text = joinFrontmatter(cur.frontmatter, docToMarkdown(ed.getJSON() as PMNode));
      dirty.current = false;
      if (text === cur.text && !force) {
        setState('saved');
        return;
      }
      setState('saving');
      const run = (async () => {
        try {
          const { version } = await tw.write(path, text, force ? null : cur.version);
          cur.text = text;
          cur.version = version;
          setState(dirty.current ? 'unsaved' : 'saved');
        } catch (err) {
          dirty.current = true;
          const code = errorCode(err);
          setState(code === 'conflict' ? 'conflict' : 'error');
          if (code !== 'conflict') notify(errorText(err));
        }
      })();
      saving.current = run;
      await run;
      saving.current = null;
    },
    [path, notify],
  );

  const scheduleSave = useCallback(() => {
    dirty.current = true;
    setState('unsaved');
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void save(), 700);
  }, [save]);

  // Save straight away when leaving the note or the app.
  useEffect(() => {
    const flush = () => {
      if (timer.current) window.clearTimeout(timer.current);
      if (dirty.current) void save();
    };
    window.addEventListener('beforeunload', flush);
    return () => {
      window.removeEventListener('beforeunload', flush);
      flush();
    };
  }, [save]);

  // Someone else (an agent, a sync tool, another editor) changed this file.
  useEffect(() => {
    if (!changed.paths.includes(path) || !noteRef.current) return;
    void (async () => {
      if (saving.current) await saving.current;
      const cur = noteRef.current!;
      let disk: { content: string; version: string };
      try {
        disk = await tw.read(path);
      } catch {
        setState('gone');
        return;
      }
      if (disk.content === cur.text) {
        cur.version = disk.version; // our own write, or a touch
        return;
      }
      if (dirty.current) setState('conflict');
      else {
        await load();
        notify(`${noteName(path)} was updated on disk`);
      }
    })();
  }, [changed, path, load, notify]);

  const rename = async (title: string) => {
    const name = safeFileName(title);
    if (!name || name === noteName(path)) return;
    await save();
    try {
      onRenamed(await tw.move(path, joinPath(dirname(path), `${name}.md`)));
    } catch (err) {
      notify(errorText(err));
    }
  };

  /** Links: web links open in the browser; vault links and [[wikilinks]] open here. */
  const onClickSheet = async (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const editable = editorRef.current?.isEditable;
    if (editable && !(e.ctrlKey || e.metaKey)) return;
    const wiki = target.closest<HTMLElement>('.wikilink');
    if (wiki?.dataset.target) {
      e.preventDefault();
      const found = await tw.resolveLink(wiki.dataset.target, path);
      if (found) onOpen(found);
      else notify(`No note named "${wiki.dataset.target}" yet`);
      return;
    }
    const a = target.closest('a');
    const href = a?.getAttribute('href');
    if (!href) return;
    e.preventDefault();
    if (/^(https?|mailto):/i.test(href)) void tw.openUrl(href);
    else {
      const p = resolveFromNote(href, path);
      if (p) onOpen(p);
    }
  };

  if (error) {
    return (
      <div className="stage">
        <div className="banner bad">{error}</div>
      </div>
    );
  }
  if (!note) return <div className="stage" />;

  const editable = editing && state !== 'gone';
  return (
    <>
      <div className="topbar">
        <Icon name="note" />
        <TitleInput key={path} value={noteName(path)} onCommit={(t) => void rename(t)} />
        <span className={`chip ${state === 'conflict' || state === 'error' || state === 'gone' ? 'bad' : state === 'saved' ? '' : 'warn'}`}>{SAVE_LABEL[state]}</span>
        <span className="push" />
        {area === 'brain' && (
          <button type="button" className={`btn ${editing ? 'pri' : ''}`} onClick={() => setEditing((v) => !v)} title="Brain notes belong to your agents; edit them only when you mean to">
            {editing ? 'Done editing' : 'Edit'}
          </button>
        )}
        <button type="button" className="ib" title="Show in file manager" aria-label="Show in file manager" onClick={() => void tw.reveal(path)}>
          <Icon name="folder" />
        </button>
        <button type="button" className="ib" title="Open in another app" aria-label="Open in another app" onClick={() => void tw.openWithDefaultApp(path).catch((e) => notify(errorText(e)))}>
          <Icon name="share" />
        </button>
        <button type="button" className="ib" title="Move to trash" aria-label="Move to trash" onClick={() => setConfirmTrash(true)}>
          <Icon name="trash" />
        </button>
      </div>
      {editable && editorRef.current && <FormatBar editor={editorRef.current} />}
      <div className="stage" onClick={(e) => void onClickSheet(e)}>
        <div className="crumbs">{dirname(path).split('/').join(' / ')}</div>
        {state === 'conflict' && (
          <div className="banner warn">
            This note changed on disk while you were editing it (perhaps an agent updated it).
            <span className="push" />
            <button type="button" className="btn" onClick={() => void load()}>
              Load the version on disk
            </button>
            <button type="button" className="btn" onClick={() => void save(true)}>
              Keep mine
            </button>
          </div>
        )}
        {state === 'gone' && <div className="banner bad">This note was moved or deleted outside Thoughtwell. Copy anything you need from it.</div>}
        <Properties meta={note.meta} path={path} onOpen={onOpen} />
        <div className="sheet">
          <NoteEditor
            key={note.n}
            doc={note.doc}
            notePath={path}
            editable={editable}
            onReady={(ed) => {
              editorRef.current = ed;
              setDraft(ed.getText());
            }}
            onChange={(ed) => {
              scheduleSave();
              setDraft(ed.getText());
            }}
            notify={notify}
          />
        </div>
      </div>
      {rightSlot &&
        createPortal(
          <aside className="right" aria-label="Note tools">
            <ToolsPanel editor={editable ? editorRef.current : null} notePath={path} notify={notify} />
            <RelatedPanel path={path} draft={draft} version={changed.n} onOpen={onOpen} />
          </aside>,
          rightSlot,
        )}
      {confirmTrash && (
        <ConfirmDialog
          title={`Move ${noteName(path)} to the trash?`}
          message="You can restore it from your system's trash."
          confirm="Move to trash"
          danger
          onClose={() => setConfirmTrash(false)}
          onConfirm={async () => {
            dirty.current = false;
            if (timer.current) window.clearTimeout(timer.current);
            await tw.trash(path);
            onClosed();
          }}
        />
      )}
    </>
  );
}

function TitleInput({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <input
      className="title-input"
      aria-label="Note name (the file name)"
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => onCommit(v)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          setV(value);
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}

/** What an agent recorded about a note: its kind, source, tags and one-line summary. */
function Properties({ meta, path, onOpen }: { meta: NoteMeta; path: string; onOpen: (p: string) => void }) {
  if (!meta.type && !meta.source && !meta.tags.length && !meta.summary && !meta.author) return null;
  const source = meta.source;
  const isUrl = source && /^https?:/i.test(source);
  return (
    <div className="props">
      <div className="props-row">
        {meta.type && <span className="chip">{meta.type}</span>}
        {meta.author && <span className="chip">by {meta.author}</span>}
        {source && (
          <button
            type="button"
            className="link-btn"
            title={source}
            onClick={(e) => {
              e.stopPropagation();
              if (isUrl) return void tw.openUrl(source);
              // Agents write vault paths from the root (Brain/Sources/x.pdf); a path relative to the note works too.
              const fromRoot = source.replace(/^\/+/, '');
              const target = areaOf(fromRoot) ? fromRoot : resolveFromNote(source, path);
              if (target) onOpen(target);
              else void tw.resolveLink(source, path).then((p) => p && onOpen(p));
            }}
          >
            Source: {source.split('/').pop()}
          </button>
        )}
        {meta.tags.map((t) => (
          <span key={t} className="tagchip">
            #{t}
          </span>
        ))}
      </div>
      {meta.summary && <div className="props-summary">{meta.summary}</div>}
    </div>
  );
}

function NoteEditor({
  doc,
  notePath,
  editable,
  onReady,
  onChange,
  notify,
}: {
  doc: PMNode;
  notePath: string;
  editable: boolean;
  onReady: (ed: Editor) => void;
  onChange: (ed: Editor) => void;
  notify: (msg: string) => void;
}) {
  const insertFiles = useCallback(
    (view: EditorView, files: File[], pos?: number): boolean => {
      if (!files.length || !view.editable) return false;
      void (async () => {
        for (const file of files) {
          try {
            let link: string;
            const real = tw.pathForFile(file);
            if (real) {
              // A file from disk: copy it beside the note rather than reading it into memory.
              const [copied] = await tw.importPaths([real], joinPath(dirname(notePath), 'attachments'));
              link = encodeURI(copied!.slice(dirname(notePath).length + 1));
            } else link = await attachImage(notePath, file);
            const { schema } = view.state;
            const node = file.type.startsWith('image/')
              ? schema.nodes.image!.create({ src: link, alt: file.name })
              : schema.text(file.name, [schema.marks.link!.create({ href: link })]);
            const at = pos ?? view.state.selection.from;
            view.dispatch(view.state.tr.insert(Math.min(at, view.state.doc.content.size), node));
          } catch (err) {
            notify(errorText(err));
          }
        }
      })();
      return true;
    },
    [notePath, notify],
  );

  const editor = useEditor(
    {
      extensions: [...extensions, placeholder],
      content: doc as object,
      editable,
      editorProps: {
        handlePaste: (view, event) => insertFiles(view, [...(event.clipboardData?.files ?? [])]),
        handleDrop: (view, event) => {
          const files = [...(event.dataTransfer?.files ?? [])];
          if (!files.length) return false;
          const at = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
          return insertFiles(view, files, at);
        },
      },
      onCreate: ({ editor: ed }) => onReady(ed as Editor),
      onUpdate: ({ editor: ed, transaction }) => {
        if (transaction.docChanged) onChange(ed as Editor);
      },
    },
    [],
  );

  useEffect(() => {
    editor?.setEditable(editable, false);
  }, [editor, editable]);

  return <EditorContent editor={editor} />;
}

function FormatBar({ editor }: { editor: Editor }) {
  const [, rerender] = useState(0);
  useEffect(() => {
    const f = () => rerender((n) => n + 1);
    editor.on('transaction', f);
    return () => {
      editor.off('transaction', f);
    };
  }, [editor]);
  const fb = (label: string, active: boolean, run: () => void, content: ReactNode) => (
    <button type="button" className={`fb ${active ? 'on' : ''}`} aria-label={label} title={label} aria-pressed={active} onClick={run}>
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
          const href = window.prompt('Link address (a web address, or a file path relative to this note)', prev ?? 'https://');
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
