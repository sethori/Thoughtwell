import type { Db } from '../db.js';
import type { AuthContext } from '../types.js';

/**
 * Writes an audit row in the same transaction as the action it records, so
 * the log can never claim something that was rolled back, or miss something
 * that happened.
 */
export async function audit(
  db: Db,
  auth: AuthContext,
  action: string,
  resourceType: string | null,
  resourceId: string | null,
  detail: Record<string, unknown> = {},
): Promise<void> {
  await db.query(
    `INSERT INTO audit_log (org_id, actor_id, actor_kind, action, resource_type, resource_id, detail, ip)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [auth.orgId, auth.userId, auth.kind, action, resourceType, resourceId, detail, auth.ip ?? null],
  );
}
