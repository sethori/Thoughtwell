import { useMemo, useState, type MouseEvent } from 'react';
import { buildTree, childTypeOf, UNIT_LABELS, UNIT_TYPES, type TreeNode, type UnitType } from '@notes/shared';
import { api, type Directory, type Person, type Unit } from '../lib/api';
import { ConfirmDialog, ContextMenu, Dialog, PromptDialog, type MenuItem } from './Dialog';
import { Icon } from './Icon';
import { AccessDialog } from './AccessDialog';
import { WorkflowDialog } from './WorkflowDialog';
import { initials } from './Rail';

type Pending =
  | { kind: 'add'; unit: Unit; childType: UnitType }
  | { kind: 'rename'; unit: Unit }
  | { kind: 'move'; unit: Unit }
  | { kind: 'delete'; unit: Unit }
  | { kind: 'access'; unit: Unit }
  | { kind: 'workflow'; unit: Unit }
  | { kind: 'folder'; unit: Unit }
  | { kind: 'group'; unit: Unit }
  | { kind: 'person'; person: Person };

const COLORS = ['#c2306f', '#1f7a8c', '#6a3fd6', '#a1561c', '#2f6fd1', '#3a7d2c'];
const colorFor = (id: string) => COLORS[parseInt(id.slice(0, 6), 16) % COLORS.length];

/**
 * The whole organization, for reference: every unit and the people in it.
 * Admins right-click a unit to add, rename, move or delete it.
 */
export function OrgTree({
  directory,
  query,
  onChanged,
  notify,
}: {
  directory: Directory;
  query: string;
  onChanged: () => Promise<void>;
  notify: (msg: string) => void;
}) {
  const tree = useMemo(() => buildTree(directory.units, (a, b) => a.name.localeCompare(b.name)), [directory.units]);
  const peopleByUnit = useMemo(() => {
    const m = new Map<string, Person[]>();
    for (const p of directory.people) {
      if (!p.home_unit_id) continue;
      m.set(p.home_unit_id, [...(m.get(p.home_unit_id) ?? []), p]);
    }
    return m;
  }, [directory.people]);
  const manageable = useMemo(() => new Set(directory.manageableUnitIds), [directory.manageableUnitIds]);
  const [open, setOpen] = useState<Set<string>>(() => new Set(directory.units.filter((u) => u.type === 'org' || u.type === 'directorate').map((u) => u.id)));
  const [menu, setMenu] = useState<{ x: number; y: number; items: (MenuItem | 'sep')[] } | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);

  // While searching, show any unit or person that matches, with its ancestors.
  const visible = useMemo(() => {
    if (!query) return null;
    const keep = new Set<string>();
    const byId = new Map(directory.units.map((u) => [u.id, u]));
    const keepUp = (id: string | null) => {
      while (id && !keep.has(id)) {
        keep.add(id);
        id = byId.get(id)?.parent_id ?? null;
      }
    };
    for (const u of directory.units) if (u.name.toLowerCase().includes(query)) keepUp(u.id);
    for (const p of directory.people) {
      if (p.display_name.toLowerCase().includes(query) || (p.title ?? '').toLowerCase().includes(query)) keepUp(p.home_unit_id);
    }
    return keep;
  }, [query, directory]);

  function unitMenu(e: MouseEvent, u: Unit) {
    e.preventDefault();
    if (!manageable.has(u.id)) return;
    const child = childTypeOf(u.type);
    const items: (MenuItem | 'sep')[] = [];
    if (child) {
      items.push({
        label: `Add ${UNIT_LABELS[child].toLowerCase()}`,
        icon: <Icon name="plus" small />,
        onSelect: () => setPending({ kind: 'add', unit: u, childType: child }),
      });
    }
    items.push({ label: 'New folder here', icon: <Icon name="folder" small />, onSelect: () => setPending({ kind: 'folder', unit: u }) });
    items.push({ label: 'New group', icon: <Icon name="people" small />, onSelect: () => setPending({ kind: 'group', unit: u }) });
    items.push({ label: 'Manage access', icon: <Icon name="lock" small />, onSelect: () => setPending({ kind: 'access', unit: u }) });
    items.push({ label: 'Review settings', icon: <Icon name="review" small />, onSelect: () => setPending({ kind: 'workflow', unit: u }) });
    if (u.parent_id) {
      items.push('sep');
      items.push({ label: 'Rename', icon: <Icon name="edit" small />, onSelect: () => setPending({ kind: 'rename', unit: u }) });
      items.push({ label: 'Move to…', icon: <Icon name="move" small />, onSelect: () => setPending({ kind: 'move', unit: u }) });
      items.push({ label: 'Delete', danger: true, icon: <Icon name="trash" small />, onSelect: () => setPending({ kind: 'delete', unit: u }) });
    } else {
      items.push({ label: 'Rename', icon: <Icon name="edit" small />, onSelect: () => setPending({ kind: 'rename', unit: u }) });
    }
    setMenu({ x: e.clientX, y: e.clientY, items });
  }

  function render(node: TreeNode<Unit>, depth: number) {
    const u = node.item;
    if (visible && !visible.has(u.id)) return null;
    const isOpen = Boolean(visible) || open.has(u.id);
    const people = (peopleByUnit.get(u.id) ?? []).filter(
      (p) => !query || p.display_name.toLowerCase().includes(query) || (p.title ?? '').toLowerCase().includes(query) || u.name.toLowerCase().includes(query),
    );
    const hasChildren = node.children.length > 0 || people.length > 0;
    return (
      <div key={u.id}>
        <button
          type="button"
          className="it"
          style={{ paddingLeft: 10 + depth * 14 }}
          aria-expanded={hasChildren ? isOpen : undefined}
          title={manageable.has(u.id) ? 'Right-click for actions' : UNIT_LABELS[u.type]}
          onClick={() =>
            setOpen((s) => {
              const n = new Set(s);
              if (n.has(u.id)) n.delete(u.id);
              else n.add(u.id);
              return n;
            })
          }
          onContextMenu={(e) => unitMenu(e, u)}
        >
          <Icon name={hasChildren ? (isOpen ? 'chevronDown' : 'chevronRight') : 'org'} small />
          <span className="label">{u.name}</span>
          <span className="meta">{u.people ? `${u.people} ${u.people === 1 ? 'person' : 'people'}` : UNIT_LABELS[u.type]}</span>
        </button>
        {isOpen && (
          <>
            {people.map((p) => (
              <button key={p.id} type="button" className="it" style={{ paddingLeft: 28 + depth * 14 }} onClick={() => setPending({ kind: 'person', person: p })}>
                <span className="avatar sm" style={{ background: colorFor(p.id), color: '#fff' }}>
                  {initials(p.display_name)}
                </span>
                <span className="label">{p.display_name}</span>
                <span className="meta">{p.kind === 'agent' ? 'Agent' : (p.title ?? '')}</span>
              </button>
            ))}
            {node.children.map((c) => render(c, depth + 1))}
          </>
        )}
      </div>
    );
  }

  const moveTargets = (u: Unit) => {
    const parentType = UNIT_TYPES[UNIT_TYPES.indexOf(u.type) - 1];
    const byId = new Map(directory.units.map((x) => [x.id, x]));
    const insideMoved = (id: string | null): boolean => {
      while (id) {
        if (id === u.id) return true;
        id = byId.get(id)?.parent_id ?? null;
      }
      return false;
    };
    return directory.units.filter((t) => t.type === parentType && t.id !== u.parent_id && manageable.has(t.id) && !insideMoved(t.id));
  };

  return (
    <>
      <div className="hint">Everyone can browse the org tree and contact people. Your working area shows only your own spaces.</div>
      {tree.map((n) => render(n, 0))}

      {menu && <ContextMenu {...menu} onClose={() => setMenu(null)} />}

      {pending?.kind === 'add' && (
        <PromptDialog
          title={`Add ${UNIT_LABELS[pending.childType].toLowerCase()} to ${pending.unit.name}`}
          label="Name"
          confirm="Add"
          onClose={() => setPending(null)}
          onSubmit={async (name) => {
            await api.post('/api/units', { parentId: pending.unit.id, name });
            setOpen((s) => new Set(s).add(pending.unit.id));
            await onChanged();
          }}
        />
      )}
      {pending?.kind === 'rename' && (
        <PromptDialog
          title={`Rename ${UNIT_LABELS[pending.unit.type].toLowerCase()}`}
          label="Name"
          initial={pending.unit.name}
          onClose={() => setPending(null)}
          onSubmit={async (name) => {
            await api.patch(`/api/units/${pending.unit.id}`, { name });
            await onChanged();
          }}
        />
      )}
      {pending?.kind === 'move' && (
        <Dialog title={`Move ${pending.unit.name}`} sub="Everything beneath it moves too, and its access is inherited from the new place." onClose={() => setPending(null)}>
          <div className="list">
            {moveTargets(pending.unit).map((t) => (
              <div key={t.id}>
                <Icon name="org" small />
                <span style={{ flex: 1 }}>{t.name}</span>
                <button
                  type="button"
                  className="btn"
                  onClick={async () => {
                    try {
                      await api.patch(`/api/units/${pending.unit.id}`, { parentId: t.id });
                      setPending(null);
                      await onChanged();
                      notify(`Moved ${pending.unit.name} under ${t.name}`);
                    } catch (err) {
                      notify((err as Error).message);
                    }
                  }}
                >
                  Move here
                </button>
              </div>
            ))}
            {moveTargets(pending.unit).length === 0 && <div>No other place at the right level that you manage.</div>}
          </div>
        </Dialog>
      )}
      {pending?.kind === 'delete' && (
        <ConfirmDialog
          title={`Delete ${pending.unit.name}?`}
          message="A unit can only be deleted once it holds no sub-units, folders, groups or people."
          confirm="Delete"
          danger
          onClose={() => setPending(null)}
          onConfirm={async () => {
            await api.del(`/api/units/${pending.unit.id}`);
            await onChanged();
          }}
        />
      )}
      {pending?.kind === 'folder' && (
        <PromptDialog
          title={`New folder in ${pending.unit.name}`}
          label="Name"
          confirm="Create"
          onClose={() => setPending(null)}
          onSubmit={async (name) => {
            await api.post('/api/folders', { unitId: pending.unit.id, name });
            await onChanged();
            notify('Folder created. Find it under My workspace.');
          }}
        />
      )}
      {pending?.kind === 'group' && (
        <PromptDialog
          title={`New group in ${pending.unit.name}`}
          label="Group name"
          confirm="Create"
          onClose={() => setPending(null)}
          onSubmit={async (name) => {
            await api.post('/api/groups', { unitId: pending.unit.id, name });
            await onChanged();
            notify('Group created. Add members from People.');
          }}
        />
      )}
      {pending?.kind === 'workflow' && (
        <WorkflowDialog scope="unit" id={pending.unit.id} name={pending.unit.name} onClose={() => setPending(null)} />
      )}
      {pending?.kind === 'access' && (
        <AccessDialog
          resourceType="unit"
          resourceId={pending.unit.id}
          resourceName={pending.unit.name}
          directory={directory}
          onClose={() => setPending(null)}
        />
      )}
      {pending?.kind === 'person' && (
        <Dialog title={pending.person.display_name} sub={pending.person.title ?? undefined} onClose={() => setPending(null)}>
          <div className="list">
            <div>
              <Icon name="org" small />
              {directory.units.find((u) => u.id === pending.person.home_unit_id)?.name ?? 'No home unit'}
            </div>
            {pending.person.email && (
              <div>
                <Icon name="mail" small />
                <a href={`mailto:${pending.person.email}`} style={{ color: 'var(--accent)' }}>
                  {pending.person.email}
                </a>
              </div>
            )}
            {pending.person.phone && (
              <div>
                <Icon name="user" small />
                <a href={`tel:${pending.person.phone}`} style={{ color: 'var(--accent)' }}>
                  {pending.person.phone}
                </a>
              </div>
            )}
          </div>
          <div className="actions">
            <button type="button" className="btn" onClick={() => setPending(null)}>
              Close
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}
