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
      const people = await many(
        db,
        `SELECT id, display_name, title, email, phone, home_unit_id, kind
         FROM users WHERE disabled_at IS NULL ORDER BY display_name`,
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
