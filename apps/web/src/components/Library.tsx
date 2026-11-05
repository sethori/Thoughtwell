import { useMemo, useRef, useState, type MouseEvent } from 'react';
import { buildTree, roleAtLeast, type TreeNode } from '@notes/shared';
import { api, type Directory, type Folder, type Me, type PageSummary, type Workspace } from '../lib/api';
import { markdownToHtml, titleFromMarkdown } from '../lib/markdown';
import { htmlToDoc } from '../lib/extensions';
import { ConfirmDialog, ContextMenu, Dialog, PromptDialog, type MenuItem } from './Dialog';
import { Icon } from './Icon';
import { OrgTree } from './OrgTree';
import { AccessDialog } from './AccessDialog';
import { initials } from './Rail';

type Pending =
  | { kind: 'newFolder'; unitId?: string; parentId?: string }
  | { kind: 'newPage'; folderId: string }
  | { kind: 'renameFolder'; folder: Folder }
  | { kind: 'deleteFolder'; folder: Folder }
  | { kind: 'access'; folder: Folder }
  | { kind: 'pickUnit' };

function timeAgo(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const STATUS_LABEL: Record<PageSummary['status'], string> = {
  draft: 'Draft',
  published: 'Published',
  changed: 'Edited since publish',
};

export function Library(props: {
  me: Me;
  view: 'workspace' | 'directory';
  onViewChange: (v: 'workspace' | 'directory') => void;
  workspace: Workspace | null;
  directory: Directory | null;
  selectedPageId: string | null;
  onOpenPage: (id: string) => void;
  onChanged: () => Promise<void>;
  notify: (msg: string) => void;
}) {
  const { me, view, onViewChange, workspace, directory, selectedPageId, onOpenPage, onChanged, notify } = props;
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [pagesByFolder, setPagesByFolder] = useState<Record<string, PageSummary[]>>({});
  const [menu, setMenu] = useState<{ x: number; y: number; items: (MenuItem | 'sep')[] } | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const importFor = useRef<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const q = query.trim().toLowerCase();
  const match = (s: string) => !q || s.toLowerCase().includes(q);

  // Folders grouped under the unit they belong to.
  const spaces = useMemo(() => {
    if (!workspace) return [];
    const unitName = new Map(workspace.units.map((u) => [u.id, u.name]));
    const dirName = new Map((directory?.units ?? []).map((u) => [u.id, u.name]));
    const byUnit = new Map<string, Folder[]>();
    for (const f of workspace.folders) {
      const list = byUnit.get(f.unit_id) ?? [];
      list.push(f);
      byUnit.set(f.unit_id, list);
    }
    return [...byUnit.entries()]
      .map(([unitId, folders]) => ({
        unitId,
        name: unitName.get(unitId) ?? dirName.get(unitId) ?? 'Unit',
        // A subfolder whose parent is not visible shows at the top level.
        tree: buildTree(
          folders.map((f) => ({ ...f, parent_id: folders.some((p) => p.id === f.parent_id) ? f.parent_id : null })),
          (a, b) => a.name.localeCompare(b.name),
        ),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [workspace, directory]);

  const editableUnits = useMemo(
    () => (workspace?.units ?? []).filter((u) => roleAtLeast(u.role ?? null, 'editor')),
    [workspace],
  );

  async function toggle(folderId: string) {
    const next = new Set(expanded);
    if (next.has(folderId)) next.delete(folderId);
    else {
      next.add(folderId);
      const pages = await api.get<PageSummary[]>(`/api/folders/${folderId}/pages`);
      setPagesByFolder((m) => ({ ...m, [folderId]: pages }));
    }
    setExpanded(next);
  }

  async function reloadFolder(folderId: string) {
    const pages = await api.get<PageSummary[]>(`/api/folders/${folderId}/pages`);
    setPagesByFolder((m) => ({ ...m, [folderId]: pages }));
    setExpanded((s) => new Set(s).add(folderId));
  }

  function folderMenu(e: MouseEvent, f: Folder) {
    e.preventDefault();
    const canWrite = roleAtLeast(f.role, 'contributor');
    const canManage = roleAtLeast(f.role, 'editor');
    const items: (MenuItem | 'sep')[] = [];
    if (canWrite) {
      items.push({ label: 'New page', icon: <Icon name="plus" small />, onSelect: () => setPending({ kind: 'newPage', folderId: f.id }) });
      items.push({
        label: 'Import Markdown',
        icon: <Icon name="upload" small />,
        onSelect: () => {
          importFor.current = f.id;
          fileInput.current?.click();
        },
      });
    }
    if (canManage) {
      items.push({ label: 'New subfolder', icon: <Icon name="folder" small />, onSelect: () => setPending({ kind: 'newFolder', parentId: f.id }) });
      items.push({ label: 'Rename', icon: <Icon name="edit" small />, onSelect: () => setPending({ kind: 'renameFolder', folder: f }) });
    }
    items.push({
      label: f.watching ? 'Stop watching' : 'Watch for changes',
      icon: <Icon name="eye" small />,
      onSelect: async () => {
        await api.put(`/api/folders/${f.id}/watch`, { watching: !f.watching });
        await onChanged();
      },
    });
    if (roleAtLeast(f.role, 'admin')) {
      items.push({ label: 'Manage access', icon: <Icon name="lock" small />, onSelect: () => setPending({ kind: 'access', folder: f }) });
    }
    if (canManage) {
      items.push('sep');
      items.push({ label: 'Delete folder', danger: true, icon: <Icon name="trash" small />, onSelect: () => setPending({ kind: 'deleteFolder', folder: f }) });
    }
    setMenu({ x: e.clientX, y: e.clientY, items });
  }

  function renderFolder(node: TreeNode<Folder>, depth: number) {
    const f = node.item;
    const open = expanded.has(f.id);
    const pages = (pagesByFolder[f.id] ?? []).filter((p) => match(p.title));
    if (q && !match(f.name) && pages.length === 0 && node.children.length === 0) return null;
    return (
      <div key={f.id}>
        <button
          type="button"
          className="it"
          style={{ paddingLeft: 10 + depth * 14 }}
          aria-expanded={open}
          onClick={() => toggle(f.id)}
          onContextMenu={(e) => folderMenu(e, f)}
        >
          <Icon name={open ? 'chevronDown' : 'chevronRight'} small />
          <span className="label">{f.name}</span>
          {f.watching ? <span className="watch">Watching</span> : <span className="meta">{f.page_count}</span>}
        </button>
        {open && (
          <>
            {node.children.map((c) => renderFolder(c, depth + 1))}
            {pages.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`it ${selectedPageId === p.id ? 'sel' : ''}`}
                style={{ paddingLeft: 28 + depth * 14 }}
                onClick={() => onOpenPage(p.id)}
              >
                <span className={`dot ${p.status}`} style={{ marginTop: 0 }} title={STATUS_LABEL[p.status]} />
                <span className="label">{p.title}</span>
              </button>
            ))}
            {pages.length === 0 && node.children.length === 0 && !q && (
              <div className="empty" style={{ paddingLeft: 18 + depth * 14 }}>
                Empty. Right-click the folder to add a page.
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  return (
    <aside className="lib" aria-label="Library">
      <div className="lhd">
        <span>Notes</span>
        {editableUnits.length > 0 && (
          <button type="button" className="ib" aria-label="New folder" title="New folder" onClick={() => setPending({ kind: 'pickUnit' })}>
            <Icon name="plus" />
          </button>
        )}
      </div>
      <label className="search">
        <Icon name="search" small />
        <input type="search" placeholder="Search notes and people" aria-label="Search" value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>
      <div className="segs" role="tablist">
        <button type="button" role="tab" aria-selected={view === 'workspace'} className={`seg ${view === 'workspace' ? 'on' : ''}`} onClick={() => onViewChange('workspace')}>
          My workspace
        </button>
        <button type="button" role="tab" aria-selected={view === 'directory'} className={`seg ${view === 'directory' ? 'on' : ''}`} onClick={() => onViewChange('directory')}>
          Org directory
        </button>
      </div>

      <div className="lbody">
        {view === 'directory' ? (
          directory && <OrgTree directory={directory} query={q} onChanged={onChanged} notify={notify} />
        ) : (
          <>
            <div className="sech">
              <span>Recent</span>
            </div>
            {(workspace?.recent ?? []).filter((p) => match(p.title)).map((p) => (
              <button key={p.id} type="button" className={`rec ${selectedPageId === p.id ? 'sel' : ''}`} onClick={() => onOpenPage(p.id)}>
                <span className={`dot ${p.status}`} />
                <span className="tx">
                  <div className="t">{p.title}</div>
                  <div className="s">
                    {STATUS_LABEL[p.status]} · {timeAgo(p.updated_at)} · {p.unit_name}
                  </div>
                </span>
              </button>
            ))}
            {workspace && workspace.recent.length === 0 && <div className="empty">No pages yet.</div>}

            <div className="sech">
              <span>My spaces</span>
            </div>
            {spaces.map((s) => (
              <div key={s.unitId}>
                <div className="it" style={{ color: 'var(--text)', fontWeight: 500 }}>
                  <Icon name="org" small />
                  <span className="label">{s.name}</span>
                </div>
                {s.tree.map((n) => renderFolder(n, 1))}
              </div>
            ))}
            {workspace && spaces.length === 0 && (
              <div className="empty">You have no folders yet. An admin can give you access to a unit or folder.</div>
            )}

            {workspace && workspace.groups.length > 0 && (
              <>
                <div className="sech">
                  <span>My groups</span>
                  <span>{workspace.groups.length}</span>
                </div>
                {workspace.groups.map((g) => (
                  <div key={g.id} className="it">
                    <Icon name="people" small />
                    <span className="label">{g.name}</span>
                    <span className="meta">{g.members}</span>
                  </div>
                ))}
              </>
            )}

            {workspace && workspace.shared.length > 0 && (
              <>
                <div className="sech">
                  <span>Shared with you</span>
                </div>
                {workspace.shared.filter((p) => match(p.title)).map((p) => (
                  <button key={p.id} type="button" className={`rec ${selectedPageId === p.id ? 'sel' : ''}`} onClick={() => onOpenPage(p.id)}>
                    <span className={`dot ${p.status}`} />
                    <span className="tx">
                      <div className="t">{p.title}</div>
                      <div className="s">
                        {timeAgo(p.updated_at)}
                        {p.shared_by ? ` · ${p.shared_by}` : ''}
                      </div>
                    </span>
                  </button>
                ))}
              </>
            )}
          </>
        )}
      </div>

      <div className="lfoot">
        <button type="button" className="askai" onClick={() => notify('The AI assistant is coming in a later phase.')}>
          <Icon name="sparkle" small />
          Ask AI about this note
        </button>
        <div className="me">
          <div className="avatar">{initials(me.user.display_name)}</div>
          <div>
            <div className="n">{me.user.display_name}</div>
            <div className="r">{me.user.home_unit_name ?? me.org.name}</div>
          </div>
        </div>
      </div>

      <input
        ref={fileInput}
        type="file"
        accept=".md,.markdown,text/markdown"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0];
          const folderId = importFor.current;
          e.target.value = '';
          if (!file || !folderId) return;
          const md = await file.text();
          const page = await api.post<{ id: string }>('/api/pages', {
            folderId,
            title: titleFromMarkdown(md, file.name.replace(/\.(md|markdown)$/i, '')),
            content: htmlToDoc(markdownToHtml(md)),
          });
          await reloadFolder(folderId);
          await onChanged();
          onOpenPage(page.id);
          notify(`Imported ${file.name}`);
        }}
      />

      {menu && <ContextMenu {...menu} onClose={() => setMenu(null)} />}

      {pending?.kind === 'newPage' && (
        <PromptDialog
          title="New page"
          label="Title"
          confirm="Create"
          onClose={() => setPending(null)}
          onSubmit={async (title) => {
            const page = await api.post<{ id: string }>('/api/pages', { folderId: pending.folderId, title });
            await reloadFolder(pending.folderId);
            await onChanged();
            onOpenPage(page.id);
          }}
        />
      )}
      {pending?.kind === 'newFolder' && (
        <PromptDialog
          title="New folder"
          label="Name"
          confirm="Create"
          onClose={() => setPending(null)}
          onSubmit={async (name) => {
            await api.post('/api/folders', pending.parentId ? { parentId: pending.parentId, name } : { unitId: pending.unitId, name });
            await onChanged();
          }}
        />
      )}
      {pending?.kind === 'pickUnit' && (
        <Dialog title="New folder" sub="Choose where the folder lives. Everyone with access to that unit will see it." onClose={() => setPending(null)}>
          <div className="list">
            {editableUnits.map((u) => (
              <div key={u.id}>
                <Icon name="org" small />
                <span style={{ flex: 1 }}>{u.name}</span>
                <button type="button" className="btn" onClick={() => setPending({ kind: 'newFolder', unitId: u.id })}>
                  Choose
                </button>
              </div>
            ))}
          </div>
        </Dialog>
      )}
      {pending?.kind === 'renameFolder' && (
        <PromptDialog
          title="Rename folder"
          label="Name"
          initial={pending.folder.name}
          onClose={() => setPending(null)}
          onSubmit={async (name) => {
            await api.patch(`/api/folders/${pending.folder.id}`, { name });
            await onChanged();
          }}
        />
      )}
      {pending?.kind === 'deleteFolder' && (
        <ConfirmDialog
          title={`Delete ${pending.folder.name}?`}
          message="Only empty folders can be deleted. Move or archive its pages first."
          confirm="Delete"
          danger
          onClose={() => setPending(null)}
          onConfirm={async () => {
            await api.del(`/api/folders/${pending.folder.id}`);
            await onChanged();
          }}
        />
      )}
      {pending?.kind === 'access' && directory && (
        <AccessDialog
          resourceType="folder"
          resourceId={pending.folder.id}
          resourceName={pending.folder.name}
          directory={directory}
          onClose={() => setPending(null)}
        />
      )}
    </aside>
  );
}
