import type { NotificationPayload, NotificationType } from '@notes/shared';
import { many, one, type Db } from '../db.js';
import type { AuthContext } from '../types.js';

/**
 * Records notifications in the same transaction as the event, so nobody hears
 * about something that was rolled back. Email and Teams delivery happen after
 * the request (see delivery.ts), from these rows.
 */
export async function notify(
  db: Db,
  auth: AuthContext,
  type: NotificationType,
  recipients: Iterable<string>,
  payload: Omit<NotificationPayload, 'actorName'>,
): Promise<number> {
  const to = [...new Set(recipients)].filter((id) => id !== auth.userId);
  if (to.length === 0) return 0;
  const actor = await one<{ display_name: string }>(db, 'SELECT display_name FROM users WHERE id = $1', [auth.userId]);
  const full: NotificationPayload = { ...payload, actorName: actor?.display_name ?? 'Someone' };
  await db.query(
    `INSERT INTO notifications (org_id, user_id, type, payload, actor_id)
     SELECT $1, u, $3, $4, $5 FROM unnest($2::uuid[]) AS u`,
    [auth.orgId, to, type, full, auth.userId],
  );
  return to.length;
}

export async function approversOf(db: Db, pageId: string): Promise<string[]> {
  return (await many<{ id: string }>(db, 'SELECT page_approvers AS id FROM page_approvers($1)', [pageId])).map((r) => r.id);
}

export async function watchersOf(db: Db, pageId: string, event: 'published' | 'review'): Promise<string[]> {
  return (await many<{ id: string }>(db, 'SELECT page_watchers AS id FROM page_watchers($1, $2)', [pageId, event])).map((r) => r.id);
}
