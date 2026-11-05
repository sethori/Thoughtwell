import { roleAtLeast, type Role } from '@notes/shared';
import { one, type Db } from '../db.js';
import { forbidden, notFound } from '../lib/errors.js';

export type ResourceType = 'unit' | 'folder' | 'page';

const TABLES: Record<ResourceType, string> = { unit: 'org_units', folder: 'folders', page: 'pages' };

/** The user's effective role on a resource, from all grants that reach it. */
export async function roleOn(db: Db, userId: string, type: ResourceType, id: string): Promise<Role | null> {
  const row = await one<{ role: Role | null }>(db, 'SELECT effective_role($1, $2::resource_type, $3) AS role', [
    userId,
    type,
    id,
  ]);
  return row?.role ?? null;
}

/**
 * Throws unless the user holds at least `need`. Content the user cannot read
 * is reported as not found, so its existence does not leak.
 */
export async function requireRole(db: Db, userId: string, type: ResourceType, id: string, need: Role): Promise<Role> {
  const exists = await one(db, `SELECT 1 FROM ${TABLES[type]} WHERE id = $1`, [id]);
  if (!exists) throw notFound();
  const role = await roleOn(db, userId, type, id);
  // The org tree itself is a directory everyone may read; folders and pages are not.
  if (!role && type !== 'unit') throw notFound();
  if (!roleAtLeast(role, need)) throw forbidden();
  return role!;
}

export async function groupIdsOf(db: Db, userId: string): Promise<string[]> {
  const r = await db.query<{ group_id: string }>('SELECT group_id FROM group_members WHERE user_id = $1', [userId]);
  return r.rows.map((x) => x.group_id);
}
