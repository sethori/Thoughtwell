import { useEffect, useState } from 'react';
import { ROLES, type Role } from '@notes/shared';
import { api, type Directory, type Grant } from '../lib/api';
import { Dialog } from './Dialog';

const ROLE_HELP: Record<Role, string> = {
  viewer: 'Reads published pages',
  contributor: 'Writes drafts and publishes',
  editor: 'Also manages folders',
  approver: 'Also reviews changes',
  admin: 'Also manages access and the tree',
};

/** Who holds which role here. Roles also reach everything beneath. */
export function AccessDialog({
  resourceType,
  resourceId,
  resourceName,
  directory,
  onClose,
}: {
  resourceType: 'unit' | 'folder' | 'page';
  resourceId: string;
  resourceName: string;
  directory: Directory;
  onClose: () => void;
}) {
  const [grants, setGrants] = useState<Grant[] | null>(null);
  const [groups, setGroups] = useState<{ id: string; name: string; unit_name: string }[]>([]);
  const [principal, setPrincipal] = useState('');
  const [role, setRole] = useState<Role>('contributor');
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      setGrants(await api.get<Grant[]>(`/api/grants?resourceType=${resourceType}&resourceId=${resourceId}`));
    } catch (err) {
      setError((err as Error).message);
    }
  };
  useEffect(() => {
    void load();
    void api.get<typeof groups>('/api/groups').then(setGroups).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resourceId]);

  return (
    <Dialog
      title={`Access to ${resourceName}`}
      sub={resourceType === 'page' ? 'Roles apply to this page.' : 'Roles here also apply to everything beneath.'}
      wide
      onClose={onClose}
    >
      <div className="list">
        {grants?.map((g) => (
          <div key={g.id}>
            <span style={{ flex: 1 }}>
              {g.principal_name}
              {g.principal_type === 'group' && <span className="chip" style={{ marginLeft: 8 }}>Group</span>}
            </span>
            <span className="chip">{g.role}</span>
            <button
              type="button"
              className="btn danger"
              onClick={async () => {
                await api.del(`/api/grants/${g.id}`);
                await load();
              }}
            >
              Remove
            </button>
          </div>
        ))}
        {grants?.length === 0 && <div>No one has a role here directly. Roles may still come from above.</div>}
      </div>

      <form
        style={{ marginTop: 16 }}
        onSubmit={async (e) => {
          e.preventDefault();
          if (!principal) return;
          const [principalType, principalId] = principal.split(':') as ['user' | 'group', string];
          setError(null);
          try {
            await api.post('/api/grants', { principalType, principalId, resourceType, resourceId, role });
            setPrincipal('');
            await load();
          } catch (err) {
            setError((err as Error).message);
          }
        }}
      >
        <div className="row">
          <select className="input" style={{ flex: '2 1 200px' }} value={principal} onChange={(e) => setPrincipal(e.target.value)} aria-label="Person or group">
            <option value="">Choose a person or group</option>
            <optgroup label="People">
              {directory.people.map((p) => (
                <option key={p.id} value={`user:${p.id}`}>
                  {p.display_name}
                  {p.kind === 'agent' ? ' (agent)' : ''}
                </option>
              ))}
            </optgroup>
            {groups.length > 0 && (
              <optgroup label="Groups">
                {groups.map((g) => (
                  <option key={g.id} value={`group:${g.id}`}>
                    {g.name} · {g.unit_name}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
          <select className="input" style={{ flex: '1 1 140px' }} value={role} onChange={(e) => setRole(e.target.value as Role)} aria-label="Role">
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r} · {ROLE_HELP[r]}
              </option>
            ))}
          </select>
          <button type="submit" className="btn pri" disabled={!principal}>
            Add
          </button>
        </div>
        {error && <p className="error">{error}</p>}
      </form>
      <div className="actions">
        <button type="button" className="btn" onClick={onClose}>
          Done
        </button>
      </div>
    </Dialog>
  );
}
