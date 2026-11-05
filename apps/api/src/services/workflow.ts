import { roleAtLeast, type Role } from '@notes/shared';
import { one, type Db } from '../db.js';
import { notFound } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import type { AuthContext } from '../types.js';
import { roleOn } from './access.js';

export const WORKFLOW_KEYS = ['approval.required', 'approval.allow_self'] as const;
export type WorkflowKey = (typeof WORKFLOW_KEYS)[number];

export interface PublishPolicy {
  role: Role | null;
  /** The folder (or a unit above it) says drafts need an approver before going live. */
  approvalRequired: boolean;
  /** This person may approve their own work here: an admin turned it on for them or for the folder. */
  selfApproval: boolean;
  /** May publish without a review. */
  canPublishDirectly: boolean;
  /** May approve someone's review here. */
  canApprove: boolean;
}

export async function publishPolicy(db: Db, userId: string, pageId: string): Promise<PublishPolicy & { folderId: string }> {
  const page = await one<{ folder_id: string }>(db, 'SELECT folder_id FROM pages WHERE id = $1', [pageId]);
  if (!page) throw notFound();
  const role = await roleOn(db, userId, 'page', pageId);
  const s = await one<{ required: unknown; allow_self: unknown; can_self_approve: boolean }>(
    db,
    `SELECT resolve_setting($1, 'approval.required') AS required,
            resolve_setting($1, 'approval.allow_self') AS allow_self,
            (SELECT can_self_approve FROM users WHERE id = $2) AS can_self_approve`,
    [page.folder_id, userId],
  );
  const approvalRequired = s?.required === true;
  const selfApproval = s?.allow_self === true || s?.can_self_approve === true;
  const canApprove = roleAtLeast(role, 'approver');
  return {
    folderId: page.folder_id,
    role,
    approvalRequired,
    selfApproval,
    canApprove,
    canPublishDirectly: approvalRequired ? canApprove && selfApproval : roleAtLeast(role, 'contributor'),
  };
}

/** Makes the current draft the live version. Used by direct publishing and by approval. */
export async function publishDraft(
  db: Db,
  auth: AuthContext,
  pageId: string,
  reviewId: string | null,
): Promise<{ id: string; number: number; created_at: string; title: string }> {
  const page = await one<{ title: string; draft_content: unknown }>(
    db,
    'SELECT title, draft_content FROM pages WHERE id = $1 AND archived_at IS NULL FOR UPDATE',
    [pageId],
  );
  if (!page) throw notFound();
  const version = await one<{ id: string; number: number; created_at: string }>(
    db,
    `INSERT INTO page_versions (org_id, page_id, number, title, content, created_by, review_request_id)
     VALUES ($1, $2, (SELECT coalesce(max(number), 0) + 1 FROM page_versions WHERE page_id = $2), $3, $4, $5, $6)
     RETURNING id, number, created_at`,
    [auth.orgId, pageId, page.title, page.draft_content, auth.userId, reviewId],
  );
  await db.query('UPDATE pages SET published_version_id = $2 WHERE id = $1', [pageId, version!.id]);
  await audit(db, auth, 'page.publish', 'page', pageId, { version: version!.number, reviewId });
  return { ...version!, title: page.title };
}
