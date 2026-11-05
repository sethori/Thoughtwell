import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { Hocuspocus } from '@hocuspocus/server';
import { WebSocketServer } from 'ws';
import * as Y from 'yjs';
import { canonical } from '@notes/shared';
import { writeJsonToYDoc, yDocToJson, type JsonNode } from './ydoc.js';

/**
 * Live co-editing. Every open page is a shared Yjs document, kept in memory
 * while anyone has it open, synced to each editor over a WebSocket and saved
 * to the page's draft a couple of seconds after each change.
 *
 * Storage and permission checks are passed in (see store.ts), so this file
 * only deals with documents and connections.
 */

export const COLLAB_PATH = '/api/collab';
const NAME = /^page\.([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

export interface CollabUser {
  userId: string;
  orgId: string;
  displayName: string;
  /** Contributors and above edit; anyone else is refused (drafts are not theirs to see). */
  canEdit: boolean;
}

export interface StoredDraft {
  title: string;
  content: JsonNode;
  state: Uint8Array | null;
}

export interface CollabStore {
  /** Who is connecting, from the request's cookies; null when not signed in or not allowed on this page. */
  authenticate(headers: IncomingMessage['headers'], pageId: string): Promise<CollabUser | null>;
  load(orgId: string, pageId: string): Promise<StoredDraft | null>;
  /** Saves the shared state; `changed` is false when only the Yjs bookkeeping moved. */
  save(orgId: string, pageId: string, draft: StoredDraft, changed: boolean, userId: string | null): Promise<void>;
}

export interface Collab {
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void;
  /** True while someone has the page open. */
  isOpen(pageId: string): boolean;
  /** Saves an open page now (before publishing, so the version has the latest edits). */
  flush(pageId: string): Promise<void>;
  /**
   * Replaces a page's draft from outside the editor (the REST API, imports,
   * later the AI agent). Open editors receive the change live.
   */
  replace(orgId: string, pageId: string, content: JsonNode, title: string | null, userId: string): Promise<void>;
  close(): Promise<void>;
}

interface Ctx extends CollabUser {
  pageId: string;
}

/** The page title lives beside the content so renames show live too. */
function titleOf(doc: Y.Doc, fallback: string): string {
  const t = doc.getMap('meta').get('title');
  return typeof t === 'string' ? t.slice(0, 300) : fallback;
}

export function createCollab(store: CollabStore, opts: { allowedOrigins?: (origin: string, host: string) => boolean } = {}): Collab {
  // Last known org and editor per open page, for saves that are not triggered by a connection.
  const owners = new Map<string, { orgId: string; userId: string | null; title: string; content: string }>();

  const persist = async (pageId: string, doc: Y.Doc, userId: string | null) => {
    const owner = owners.get(pageId);
    if (!owner) return;
    const content = yDocToJson(doc);
    const title = titleOf(doc, owner.title);
    const key = canonical(content);
    const changed = key !== owner.content || title !== owner.title;
    await store.save(owner.orgId, pageId, { title, content, state: Y.encodeStateAsUpdate(doc) }, changed, userId ?? owner.userId);
    owner.content = key;
    owner.title = title;
  };

  const sameOrigin = opts.allowedOrigins ?? ((origin: string, host: string) => {
    try {
      return new URL(origin).host === host;
    } catch {
      return false;
    }
  });

  const hocuspocus = new Hocuspocus({
    quiet: true,
    debounce: 2000,
    maxDebounce: 10000,

    async onAuthenticate({ documentName, requestHeaders, connection }) {
      const m = NAME.exec(documentName);
      if (!m) throw new Error('Unknown document');
      // Browsers always send Origin on WebSockets; refuse other sites' pages.
      const origin = requestHeaders.origin;
      const host = String(requestHeaders['x-forwarded-host'] ?? requestHeaders.host ?? '');
      if (origin && !sameOrigin(origin, host)) throw new Error('Cross-site connection refused');
      const user = await store.authenticate(requestHeaders, m[1]!);
      if (!user) throw new Error('Not allowed');
      connection.readOnly = !user.canEdit;
      return { ...user, pageId: m[1]! } satisfies Ctx;
    },

    async onLoadDocument({ document, context }) {
      const ctx = context as Ctx;
      const draft = await store.load(ctx.orgId, ctx.pageId);
      if (!draft) throw new Error('Page not found');
      owners.set(ctx.pageId, { orgId: ctx.orgId, userId: ctx.userId, title: draft.title, content: canonical(draft.content) });
      if (draft.state?.length) {
        Y.applyUpdate(document, draft.state);
      } else {
        writeJsonToYDoc(document, draft.content);
        // Save the starting state at once: every later load and every
        // reconnecting editor must build on this same history, or content doubles.
        await store.save(ctx.orgId, ctx.pageId, { ...draft, state: Y.encodeStateAsUpdate(document) }, false, null);
      }
      const meta = document.getMap('meta');
      if (meta.get('title') === undefined) meta.set('title', draft.title);
    },

    async onStoreDocument({ document, context, documentName }) {
      const m = NAME.exec(documentName);
      if (!m) return;
      await persist(m[1]!, document, (context as Ctx | undefined)?.userId ?? null);
    },

    async afterUnloadDocument({ documentName }) {
      const m = NAME.exec(documentName);
      if (m) owners.delete(m[1]!);
    },
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 * 1024 });

  return {
    handleUpgrade(req, socket, head) {
      wss.handleUpgrade(req, socket, head, (ws) => hocuspocus.handleConnection(ws, req));
    },

    isOpen(pageId) {
      return hocuspocus.documents.has(`page.${pageId}`);
    },

    async flush(pageId) {
      const doc = hocuspocus.documents.get(`page.${pageId}`);
      if (doc) await persist(pageId, doc, null);
    },

    async replace(orgId, pageId, content, title, userId) {
      const doc = hocuspocus.documents.get(`page.${pageId}`);
      if (doc) {
        doc.transact(() => {
          writeJsonToYDoc(doc, content);
          if (title !== null) doc.getMap('meta').set('title', title);
        });
        await persist(pageId, doc, userId);
        return;
      }
      // Not open: rewrite the stored state so it keeps one history.
      const draft = await store.load(orgId, pageId);
      if (!draft) throw new Error('Page not found');
      const ydoc = new Y.Doc();
      if (draft.state?.length) Y.applyUpdate(ydoc, draft.state);
      ydoc.transact(() => {
        writeJsonToYDoc(ydoc, content);
        ydoc.getMap('meta').set('title', title ?? draft.title);
      });
      await store.save(orgId, pageId, { title: title ?? draft.title, content, state: Y.encodeStateAsUpdate(ydoc) }, true, userId);
      ydoc.destroy();
    },

    async close() {
      for (const [name, doc] of hocuspocus.documents) {
        const m = NAME.exec(name);
        if (m) await persist(m[1]!, doc, null).catch(() => {});
      }
      hocuspocus.closeConnections();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
    },
  };
}
