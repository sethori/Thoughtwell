import { useEffect, useState } from 'react';
import { api, type WorkflowSettings } from '../lib/api';
import { Dialog } from './Dialog';

type Key = 'approval.required' | 'approval.allow_self';

const ROWS: { key: Key; label: string; help: string }[] = [
  {
    key: 'approval.required',
    label: 'Require approval before publishing',
    help: 'Writers submit drafts for review; an approver accepts or rejects the changes and publishes.',
  },
  {
    key: 'approval.allow_self',
    label: 'Approvers may approve their own changes',
    help: 'For one-person areas. Admins can also allow this for single people under People.',
  },
];

/** Review rules for a unit or folder. Each one is inherited from above unless set here. */
export function WorkflowDialog({ scope, id, name, onClose }: { scope: 'unit' | 'folder'; id: string; name: string; onClose: () => void }) {
  const [s, setS] = useState<WorkflowSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => api.get<WorkflowSettings>(`/api/workflow/${scope}/${id}`).then(setS);
  useEffect(() => {
    void load();
  }, [scope, id]);

  const set = async (key: Key, value: boolean | null) => {
    setError(null);
    try {
      await api.put(`/api/workflow/${scope}/${id}`, { key, value });
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <Dialog title={`Review settings: ${name}`} sub="Settings apply to everything below unless something nearer sets its own." wide onClose={onClose}>
      {!s && <p>Loading…</p>}
      {s &&
        ROWS.map((row) => {
          const own = s.own[row.key];
          const choice = own === undefined ? 'inherit' : own ? 'on' : 'off';
          return (
            <div key={row.key} className="field">
              <span>{row.label}</span>
              <div className="choices">
                {(['inherit', 'on', 'off'] as const).map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={`choice ${choice === c ? 'on' : ''}`}
                    aria-pressed={choice === c}
                    disabled={!s.canEdit}
                    onClick={() => void set(row.key, c === 'inherit' ? null : c === 'on')}
                  >
                    {c === 'inherit' ? 'Inherit from above' : c === 'on' ? 'On' : 'Off'}
                  </button>
                ))}
              </div>
              <p className="sub">
                {row.help} Now: <strong>{s.effective[row.key] ? 'on' : 'off'}</strong>.
              </p>
            </div>
          );
        })}
      {s && !s.canEdit && <p className="sub">Only admins of this area can change these.</p>}
      {error && <p className="error">{error}</p>}
      <div className="actions">
        <button type="button" className="btn pri" onClick={onClose}>
          Done
        </button>
      </div>
    </Dialog>
  );
}
