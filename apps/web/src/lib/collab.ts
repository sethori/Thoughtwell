import { HocuspocusProvider } from '@hocuspocus/provider';
import * as Y from 'yjs';

/** Distinct, readable cursor colors; each person keeps theirs across sessions. */
const COLORS = ['#e5484d', '#e38627', '#2f9e44', '#0b8fd9', '#7c4dff', '#d6409f', '#12a594', '#b07d00'];

export function colorFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return COLORS[Math.abs(h) % COLORS.length]!;
}

export interface Peer {
  clientId: number;
  name: string;
  color: string;
  self: boolean;
}

export interface CollabSession {
  ydoc: Y.Doc;
  provider: HocuspocusProvider;
  destroy(): void;
}

/**
 * Connects to the live copy of a page's draft. The session cookie signs the
 * connection in; the token is only a placeholder the protocol requires.
 */
export function openCollab(pageId: string, onAuthFailed: (reason: string) => void): CollabSession {
  const ydoc = new Y.Doc();
  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/collab`;
  const provider = new HocuspocusProvider({
    url,
    name: `page.${pageId}`,
    token: 'session',
    document: ydoc,
    onAuthenticationFailed: ({ reason }) => onAuthFailed(reason),
  });
  return {
    ydoc,
    provider,
    destroy() {
      provider.destroy();
      ydoc.destroy();
    },
  };
}

/** Everyone with this page open, from the shared presence (awareness) state. */
export function peersOf(provider: HocuspocusProvider): Peer[] {
  const awareness = provider.awareness;
  if (!awareness) return [];
  const self = awareness.clientID;
  const out: Peer[] = [];
  awareness.getStates().forEach((state, clientId) => {
    const user = (state as { user?: { name?: string; color?: string } }).user;
    if (user?.name) out.push({ clientId, name: user.name, color: user.color ?? '#888', self: clientId === self });
  });
  // One entry per person, even with the page open in two tabs.
  const seen = new Set<string>();
  return out
    .sort((a, b) => Number(b.self) - Number(a.self))
    .filter((p) => (seen.has(p.name) ? false : (seen.add(p.name), true)));
}
