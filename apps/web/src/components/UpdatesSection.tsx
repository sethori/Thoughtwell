import { useState } from 'react';
import { errorText, tw, type UpdateStatus } from '../lib/vault';

function ago(ms: number): string {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return new Date(ms).toLocaleString();
}

/** One line saying where updates stand. */
export function describeUpdate(u: UpdateStatus): string {
  switch (u.state) {
    case 'idle':
      return 'Not checked yet.';
    case 'checking':
      return 'Checking for updates…';
    case 'current':
      return `You have the latest version${u.checkedAt ? ` (checked ${ago(u.checkedAt)})` : ''}.`;
    case 'downloading':
      return `Downloading ${u.latest}… ${Math.round((u.progress ?? 0) * 100)}%`;
    case 'ready':
      return `Thoughtwell ${u.latest} is installed. It starts the next time you open Thoughtwell, or restart now.`;
    case 'available':
      return `Thoughtwell ${u.latest} is available. ${u.message ?? ''}`;
    case 'unsupported':
      return 'Updates install only in the AppImage. This copy runs from source, but you can still check for new releases.';
    case 'error':
      return u.message ?? 'The check failed.';
  }
}

export function UpdatesSection({ status }: { status: UpdateStatus }) {
  const [err, setErr] = useState<string | null>(null);
  const busy = status.state === 'checking' || status.state === 'downloading';
  const act = (fn: () => Promise<unknown>) => () => {
    setErr(null);
    fn().catch((e) => setErr(errorText(e)));
  };

  return (
    <div className="field">
      <span>Updates</span>
      <p className={`update-line ${status.state === 'error' ? 'bad' : ''}`} role="status">
        {describeUpdate(status)}
      </p>
      {status.state === 'downloading' && <progress className="update-progress" value={status.progress ?? 0} max={1} />}
      <div className="row">
        {status.state === 'ready' ? (
          <button type="button" className="btn pri" onClick={act(() => tw.restartToUpdate())}>
            Restart to update
          </button>
        ) : (
          <button type="button" className="btn" disabled={busy} onClick={act(() => tw.checkForUpdates())}>
            {busy ? 'Checking…' : 'Check for updates'}
          </button>
        )}
        {status.releaseUrl && (
          <button type="button" className="btn" onClick={act(() => tw.openUrl(status.releaseUrl!))}>
            Release notes
          </button>
        )}
      </div>
      <label className="check">
        <input type="checkbox" checked={status.auto} onChange={(e) => void tw.setUpdateOptions({ auto: e.target.checked })} />
        Check for updates when Thoughtwell opens
      </label>
      {err && <p className="error">{err}</p>}
    </div>
  );
}
