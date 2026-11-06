import type { FastifyInstance } from 'fastify';
import { many } from '../db.js';

/**
 * The whole org tree and the people in it. Everyone in the organization can
 * read this, so they can find and contact each other. It holds no content.
 */
export async function directoryRoutes(app: FastifyInstance) {
  app.get('/api/directory', async (req) =>
    req.tx(async (db, auth) => {
      const units = await many(
        db,
        `SELECT u.id, u.parent_id, u.type, u.name,
                (SELECT count(*)::int FROM users p WHERE p.home_unit_id = u.id AND p.disabled_at IS NULL) AS people
         FROM org_units u ORDER BY nlevel(u.path), u.name`,
      );
      // unit_ids: every unit someone is assigned to (their home unit and the
      // units of the groups they belong to), so the org chart can show them
      // once, at the highest of those places. Access grants are not counted.
      const people = await many(
        db,
        `SELECT p.id, p.display_name, p.title, p.email, p.phone, p.home_unit_id, p.kind,
                COALESCE(
                  (SELECT array_agg(DISTINCT a.unit_id::text) FROM (
                     SELECT p.home_unit_id AS unit_id WHERE p.home_unit_id IS NOT NULL
                     UNION
                     SELECT g.unit_id FROM group_members gm JOIN groups g ON g.id = gm.group_id WHERE gm.user_id = p.id
                   ) a),
                  '{}'::text[]
                ) AS unit_ids
         FROM users p WHERE p.disabled_at IS NULL ORDER BY p.display_name`,
      );
      // Units this person can manage, so the tree editor knows where to offer actions.
      const manageable = await many<{ unit_id: string }>(
        db,
        `SELECT unit_id FROM accessible_units($1) WHERE role = 'admin'`,
        [auth.userId],
      );
      return { units, people, manageableUnitIds: manageable.map((m) => m.unit_id) };
    }),
  );
}
