import { useMemo, useState, type DragEvent } from 'react';
import { AREA_DIR, BRAIN_DIRS, BRAIN_LOG, dirname, joinPath, noteName, safeFileName, type Area, type Entry } from '@notes/shared';
import { errorText, tw } from '../lib/vault';
import { keep, remember } from '../lib/theme';
import { Icon, type IconName } from './Icon';
import { ContextMenu, PromptDialog, type MenuItem } from './Dialog';

interface TreeNode {
  entry: Entry;
  children: TreeNode[];
}

function buildTree(entries: Entry[], rootDir: string): TreeNode[] {
  const nodes = new Map<string, TreeNode>();
  const top: TreeNode[] = [];
  for (const e of entries) {
    if (!e.path.startsWith(rootDir + '/')) continue;
    const node: TreeNode = { entry: e, children: [] };
    nodes.set(e.path, node);
    const parent = nodes.get(dirname(e.path));
    (parent ? parent.children : top).push(node);
  }
  const sort = (list: TreeNode[]) => {
    list.sort((a, b) => Number(b.entry.kind === 'dir') - Number(a.entry.kind === 'dir') || a.entry.name.localeCompare(b.entry.name, undefined, { numeric: true, sensitivity: 'base' }));
    list.forEach((n) => sort(n.children));
  };
  sort(top);
  return top;
}

const ICON: Partial<Record<Entry['kind'], IconName>> = { dir: 'folder', note: 'note', image: 'image', sketch: 'sketch', text: 'text' };

/** Brain folders in the order an agent's work flows through them. */
const BRAIN_ORDER: string[] = [BRAIN_DIRS.inbox, BRAIN_DIRS.summaries, BRAIN_DIRS.topics, BRAIN_DIRS.sources, BRAIN_LOG];

/** Internal drags carry a vault path; drops from the desktop carry files. */
const DRAG_TYPE = 'application/x-thoughtwell-path';

type Ask = { kind: 'note' | 'folder'; dir: string } | { kind: 'rename'; entry: Entry };

export function Sidebar({
  area,
  entries,
  selected,
  onOpen,
  onMoved,
  onSearch,
  notify,
}: {
  area: Area;
  entries: Entry[];
  selected: string | null;
  onOpen: (path: string) => void;
  /** A file or folder was renamed or moved (old path, new path). */
  onMoved: (from: string, to: string) => void;
  onSearch: () => void;
  notify: (msg: string) => void;
}) {
  const root = AREA_DIR[area];
  const [open, setOpen] = useState<Record<string, boolean>>(() => remember('openFolders', { [BRAIN_DIRS.inbox]: true, [BRAIN_DIRS.summaries]: true, [BRAIN_DIRS.topics]: true }));
  const [menu, setMenu] = useState<{ x: number; y: number; items: (MenuItem | 'sep')[] } | null>(null);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  const tree = useMemo(() => {
    const t = buildTree(entries, root);
    if (area === 'brain') t.sort((a, b) => rank(a.entry.path) - rank(b.entry.path));
    return t;
  }, [entries, root, area]);
  const inbox = useMemo(() => entries.filter((e) => dirname(e.path) === BRAIN_DIRS.inbox).length, [entries]);

  const toggle = (path: string, value?: boolean) =>
    setOpen((o) => {
      const next = { ...o, [path]: value ?? !o[path] };
      keep('openFolders', next);
      return next;
    });

  const newNote = async (dir: string, title: string) => {
    const p = await tw.createNote(dir, title, `# ${title}\n\n`);
    toggle(dir, true);
    onOpen(p);
  };

  const move = async (from: string, toDir: string) => {
    const name = from.split('/').pop()!;
    if (dirname(from) === toDir || toDir === from || toDir.startsWith(from + '/')) return;
    try {
      onMoved(from, await tw.move(from, joinPath(toDir, name)));
    } catch (err) {
      notify(errorText(err));
    }
  };

  const onDrop = async (e: DragEvent, dir: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDropTarget(null);
    const internal = e.dataTransfer.getData(DRAG_TYPE);
    if (internal) return move(internal, dir);
    const paths = [...e.dataTransfer.files].map((f) => tw.pathForFile(f)).filter(Boolean);
    if (!paths.length) return;
    try {
      const added = await tw.importPaths(paths, dir);
      toggle(dir, true);
      notify(`Added ${added.length} item${added.length === 1 ? '' : 's'} to ${dir}`);
    } catch (err) {
      notify(errorText(err));
    }
  };

  const dropProps = (dir: string) => ({
    onDragOver: (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDropTarget(dir);
    },
    onDragLeave: () => setDropTarget((d) => (d === dir ? null : d)),
    onDrop: (e: DragEvent) => void onDrop(e, dir),
  });

  const contextFor = (entry: Entry | null, x: number, y: number) => {
    const dir = entry ? (entry.kind === 'dir' ? entry.path : dirname(entry.path)) : root;
    const items: (MenuItem | 'sep')[] = [
      { label: 'New note here', onSelect: () => setAsk({ kind: 'note', dir }) },
      { label: 'New folder here', onSelect: () => setAsk({ kind: 'folder', dir }) },
      { label: 'Add files here…', onSelect: () => void tw.pickAndImport(dir).then((a) => a.length && notify(`Added ${a.length} to ${dir}`)) },
    ];
    if (entry) {
      items.push('sep', { label: 'Rename…', onSelect: () => setAsk({ kind: 'rename', entry }) });
      items.push({ label: 'Show in file manager', onSelect: () => void tw.reveal(entry.path) });
      items.push({ label: 'Copy path (for an agent)', onSelect: () => void tw.copyText(entry.path) });
      items.push('sep', {
        label: 'Move to trash',
        danger: true,
        onSelect: () =>
          void tw
            .trash(entry.path)
            .then(() => notify(`Moved ${entry.name} to the trash`))
            .catch((err) => notify(errorText(err))),
      });
    }
    setMenu({ x, y, items });
  };

  const row = (node: TreeNode, depth: number) => {
    const e = node.entry;
    const isDir = e.kind === 'dir';
    const label = e.kind === 'note' ? noteName(e.path) : e.name;
    const count = isDir && e.path === BRAIN_DIRS.inbox ? inbox : 0;
    return (
      <div key={e.path}>
        <button
          type="button"
          className={`it tree-row ${selected === e.path ? 'sel' : ''} ${dropTarget === e.path ? 'drop' : ''}`}
          style={{ paddingLeft: 10 + depth * 14 }}
          title={e.path}
          draggable
          onDragStart={(ev) => {
            ev.dataTransfer.setData(DRAG_TYPE, e.path);
            ev.dataTransfer.effectAllowed = 'move';
          }}
          onClick={() => (isDir ? toggle(e.path) : onOpen(e.path))}
          onContextMenu={(ev) => {
            ev.preventDefault();
            contextFor(e, ev.clientX, ev.clientY);
          }}
          {...(isDir ? dropProps(e.path) : {})}
        >
          {isDir && <span className={`caret ${open[e.path] ? 'open' : ''}`} aria-hidden="true" />}
          <Icon name={ICON[e.kind] ?? 'note'} small />
          <span className="label">{label}</span>
          {count > 0 && <span className="meta count">{count}</span>}
        </button>
        {isDir && open[e.path] && node.children.map((c) => row(c, depth + 1))}
      </div>
    );
  };

  return (
    <section className="lib" aria-label={area === 'me' ? 'Your notes' : 'Brain'}>
      <div className="lhd">
        <span>{area === 'me' ? 'Me' : 'Brain'}</span>
        <span className="lhd-actions">
          {area === 'brain' && (
            <button type="button" className="ib" title="Add files to the Brain inbox" aria-label="Add files to the Brain inbox" onClick={() => void tw.pickAndImport(BRAIN_DIRS.inbox).then((a) => a.length && notify(`Added ${a.length} to the inbox`))}>
              <Icon name="upload" />
            </button>
          )}
          <button type="button" className="ib" title="New note" aria-label="New note" onClick={() => setAsk({ kind: 'note', dir: area === 'brain' ? BRAIN_DIRS.topics : root })}>
            <Icon name="plus" />
          </button>
        </span>
      </div>
      <button type="button" className="search" onClick={onSearch}>
        <Icon name="search" small />
        <span>Search everything</span>
        <kbd>Ctrl K</kbd>
      </button>
      <div
        className={`lbody ${dropTarget === root ? 'drop' : ''}`}
        {...dropProps(area === 'brain' ? BRAIN_DIRS.inbox : root)}
        onContextMenu={(ev) => {
          if (ev.target !== ev.currentTarget) return;
          ev.preventDefault();
          contextFor(null, ev.clientX, ev.clientY);
        }}
      >
        {area === 'brain' && <div className="hint drop-hint">Drop files here to add them to the inbox. Your agents pick them up from there.</div>}
        {tree.map((n) => row(n, 0))}
        {tree.length === 0 && <div className="empty">No notes yet. Use + to write one.</div>}
      </div>

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
      {ask?.kind === 'note' && <PromptDialog title="New note" label="Name" sub={`In ${ask.dir}`} confirm="Create" onClose={() => setAsk(null)} onSubmit={(t) => newNote(ask.dir, t)} />}
      {ask?.kind === 'folder' && (
        <PromptDialog
          title="New folder"
          label="Name"
          sub={`In ${ask.dir}`}
          confirm="Create"
          onClose={() => setAsk(null)}
          onSubmit={async (name) => {
            await tw.createFolder(ask.dir, name);
            toggle(ask.dir, true);
          }}
        />
      )}
      {ask?.kind === 'rename' && (
        <PromptDialog
          title="Rename"
          label="Name"
          initial={ask.entry.kind === 'note' ? noteName(ask.entry.path) : ask.entry.name}
          confirm="Rename"
          onClose={() => setAsk(null)}
          onSubmit={async (name) => {
            const e = ask.entry;
            const clean = safeFileName(name);
            const next = joinPath(dirname(e.path), e.kind === 'note' && !/\.md$/i.test(clean) ? `${clean}.md` : clean);
            onMoved(e.path, await tw.move(e.path, next));
          }}
        />
      )}
    </section>
  );
}

function rank(path: string): number {
  const i = BRAIN_ORDER.indexOf(path);
  return i < 0 ? BRAIN_ORDER.length : i;
}
