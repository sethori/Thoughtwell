import { useEffect, useState } from 'react';
import { api, type Directory, type Me } from '../lib/api';
import { Dialog } from './Dialog';

interface AdminUser {
  id: string;
  username: string;
  display_name: string;
  title: string | null;
  kind: 'person' | 'agent';
  home_unit_id: string | null;
  is_org_admin: boolean;
  disabled_at: string | null;
}
interface Group {
  id: string;
  name: string;
  unit_name: string;
  members: number;
}

/** Organization admins add people, set their home unit, and manage group membership. */
export function PeopleDialog({ me, directory, onClose, onChanged }: { me: Me; directory: Directory; onClose: () => void; onChanged: () => Promise<void> }) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [form, setForm] = useState({ username: '', displayName: '', password: '', title: '', email: '', homeUnitId: '', kind: 'person' as 'person' | 'agent' });
  const [memberPick, setMemberPick] = useState<{ groupId: string; userId: string }>({ groupId: '', userId: '' });
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setUsers(await api.get<AdminUser[]>('/api/admin/users'));
    setGroups(await api.get<Group[]>('/api/groups'));
  };
  useEffect(() => {
    void load();
  }, []);

  const unitName = (id: string | null) => directory.units.find((u) => u.id === id)?.name ?? 'No home unit';
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <Dialog title="People" sub="Everyone here can sign in. Their home unit sets where they appear in the directory; access comes from roles." wide onClose={onClose}>
      <div className="list" style={{ maxHeight: 260, overflowY: 'auto' }}>
        {users.map((u) => (
          <div key={u.id}>
            <span style={{ flex: 1 }}>
              {u.display_name} <span style={{ color: 'var(--faint)' }}>@{u.username}</span>
            </span>
            {u.kind === 'agent' && <span className="chip">Agent</span>}
            {u.is_org_admin && <span className="chip ok">Admin</span>}
            <span className="chip">{unitName(u.home_unit_id)}</span>
            {u.id !== me.user.id && (
              <button
                type="button"
                className={u.disabled_at ? 'btn' : 'btn danger'}
                onClick={async () => {
                  await api.patch(`/api/admin/users/${u.id}`, { disabled: !u.disabled_at });
                  await load();
                  await onChanged();
                }}
              >
                {u.disabled_at ? 'Enable' : 'Disable'}
              </button>
            )}
          </div>
        ))}
      </div>

      <h2 style={{ marginTop: 20 }}>Add a person</h2>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          try {
            await api.post('/api/admin/users', {
              username: form.username,
              displayName: form.displayName,
              kind: form.kind,
              ...(form.kind === 'person' ? { password: form.password } : {}),
              ...(form.title ? { title: form.title } : {}),
              ...(form.email ? { email: form.email } : {}),
              ...(form.homeUnitId ? { homeUnitId: form.homeUnitId } : {}),
            });
            setForm({ username: '', displayName: '', password: '', title: '', email: '', homeUnitId: '', kind: 'person' });
            await load();
            await onChanged();
          } catch (err) {
            setError((err as Error).message);
          }
        }}
      >
        <div className="row">
          <label className="field" style={{ flex: '1 1 180px' }}>
            <span>Display name</span>
            <input className="input" value={form.displayName} onChange={set('displayName')} required />
          </label>
          <label className="field" style={{ flex: '1 1 140px' }}>
            <span>Username</span>
            <input className="input" value={form.username} onChange={set('username')} required autoComplete="off" />
          </label>
        </div>
        <div className="row">
          <label className="field" style={{ flex: '1 1 180px' }}>
            <span>Title</span>
            <input className="input" value={form.title} onChange={set('title')} />
          </label>
          <label className="field" style={{ flex: '1 1 180px' }}>
            <span>Email</span>
            <input className="input" type="email" value={form.email} onChange={set('email')} />
          </label>
        </div>
        <div className="row">
          <label className="field" style={{ flex: '1 1 180px' }}>
            <span>Home unit</span>
            <select className="input" value={form.homeUnitId} onChange={set('homeUnitId')}>
              <option value="">None</option>
              {directory.units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} ({u.type})
                </option>
              ))}
            </select>
          </label>
          <label className="field" style={{ flex: '1 1 120px' }}>
            <span>Kind</span>
            <select className="input" value={form.kind} onChange={set('kind')}>
              <option value="person">Person</option>
              <option value="agent">Agent (for a later AI integration)</option>
            </select>
          </label>
          {form.kind === 'person' && (
            <label className="field" style={{ flex: '1 1 160px' }}>
              <span>Temporary password</span>
              <input className="input" type="password" minLength={8} value={form.password} onChange={set('password')} required autoComplete="new-password" />
            </label>
          )}
        </div>
        {error && <p className="error">{error}</p>}
        <div className="actions" style={{ marginTop: 0 }}>
          <button type="submit" className="btn pri">
            Add person
          </button>
        </div>
      </form>

      {groups.length > 0 && (
        <>
          <h2 style={{ marginTop: 20 }}>Add someone to a group</h2>
          <div className="row">
            <select className="input" style={{ flex: '1 1 180px' }} value={memberPick.groupId} onChange={(e) => setMemberPick((m) => ({ ...m, groupId: e.target.value }))} aria-label="Group">
              <option value="">Choose a group</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name} · {g.unit_name} ({g.members})
                </option>
              ))}
            </select>
            <select className="input" style={{ flex: '1 1 180px' }} value={memberPick.userId} onChange={(e) => setMemberPick((m) => ({ ...m, userId: e.target.value }))} aria-label="Person">
              <option value="">Choose a person</option>
              {users
                .filter((u) => !u.disabled_at)
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.display_name}
                  </option>
                ))}
            </select>
            <button
              type="button"
              className="btn"
              disabled={!memberPick.groupId || !memberPick.userId}
              onClick={async () => {
                await api.post(`/api/groups/${memberPick.groupId}/members`, { userId: memberPick.userId });
                setMemberPick({ groupId: '', userId: '' });
                await load();
                await onChanged();
              }}
            >
              Add to group
            </button>
          </div>
        </>
      )}
      <div className="actions">
        <button type="button" className="btn" onClick={onClose}>
          Done
        </button>
      </div>
    </Dialog>
  );
}
