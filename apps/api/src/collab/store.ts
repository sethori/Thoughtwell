import type { IncomingMessage } from 'node:http';
import type pg from 'pg';
import { roleAtLeast } from '@notes/shared';
import { hashToken, SESSION_COOKIE } from '../auth/session.js';
import { one, withOrg, withoutOrg } from '../db.js';
import { roleOn } from '../services/access.js';
import type { CollabStore, CollabUser, StoredDraft } from './server.js';
import type { JsonNode } from './ydoc.js';

function cookie(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
}

/** Postgres-backed storage for live editing, with the same session and role checks as the API. */
export function pgCollabStore(pool: pg.Pool): CollabStore {
  return {
    async authenticate(headers: IncomingMessage['headers'], pageId: string): Promise<CollabUser | null> {
      const token = cookie(headers.cookie, SESSION_COOKIE);
      if (!token) return null;
      const s = await withoutOrg(pool, (db) =>
        one<{ user_id: string; org_id: string }>(db, 'SELECT user_id, org_id FROM auth_get_session($1)', [hashToken(token)]),
      );
      if (!s) return null;
      return withOrg(pool, s.org_id, async (db) => {
        const page = await one(db, 'SELECT 1 FROM pages WHERE id = $1 AND archived_at IS NULL', [pageId]);
        if (!page) return null;
        const role = await roleOn(db, s.user_id, 'page', pageId);
        // Drafts are for contributors and above; viewers only see published versions.
        if (!roleAtLeast(role, 'contributor')) return null;
        const u = await one<{ display_name: string }>(db, 'SELECT display_name FROM users WHERE id = $1', [s.user_id]);
        return { userId: s.user_id, orgId: s.org_id, displayName: u?.display_name ?? 'Someone', canEdit: true };
      });
    },

    async load(orgId: string, pageId: string): Promise<StoredDraft | null> {
      return withOrg(pool, orgId, async (db) => {
        const row = await one<{ title: string; draft_content: JsonNode; draft_state: Buffer | null }>(
          db,
          'SELECT title, draft_content, draft_state FROM pages WHERE id = $1 AND archived_at IS NULL',
          [pageId],
        );
        if (!row) return null;
        return { title: row.title, content: row.draft_content, state: row.draft_state ? new Uint8Array(row.draft_state) : null };
      });
    },

    async save(orgId: string, pageId: string, draft: StoredDraft, changed: boolean, userId: string | null): Promise<void> {
      await withOrg(pool, orgId, async (db) => {
        const state = draft.state ? Buffer.from(draft.state) : null;
        if (!changed) {
          await db.query('UPDATE pages SET draft_state = $2 WHERE id = $1', [pageId, state]);
          return;
        }
        await db.query(
          `UPDATE pages SET draft_state = $2, draft_content = $3, title = $4, draft_rev = draft_rev + 1,
                  draft_updated_at = now(), draft_updated_by = coalesce($5, draft_updated_by)
           WHERE id = $1`,
          [pageId, state, draft.content, draft.title || 'Untitled', userId],
        );
      });
    },
  };
}
