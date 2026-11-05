import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { childPath } from '@notes/shared';
import { many, one } from '../db.js';
import { audit } from '../lib/audit.js';
import { conflict, notFound } from '../lib/errors.js';
import { idParams, name, parse, uuid } from '../lib/validate.js';
import { requireRole } from '../services/access.js';
import { PAGE_STATUS_SQL } from './pages.js';

const createBody = z.object({ unitId: uuid.optional(), parentId: uuid.optional(), name }).refine(
  (b) => Boolean(b.unitId) !== Boolean(b.parentId),
  'Give either unitId for a top-level folder or parentId for a subfolder',
);

export async function folderRoutes(app: FastifyInstance) {
  /** Everything the signed-in person works in: their units, folders, groups, recent and shared pages. */
  app.get('/api/workspace', async (req) =>
    req.tx(async (db, auth) => {
      const units = await many(
        db,
        `SELECT u.id, u.parent_id, u.type, u.name, a.role
         FROM accessible_units($1) a JOIN org_units u ON u.id = a.unit_id
         ORDER BY nlevel(u.path), u.name`,
        [auth.userId],
      );
      const folders = await many(
        db,
        `SELECT f.id, f.unit_id, f.parent_id, f.name, a.role,
                EXISTS (SELECT 1 FROM watches w WHERE w.user_id = $1 AND w.scope_type = 'folder' AND w.scope_id = f.id) AS watching,
                (SELECT count(*)::int FROM pages p WHERE p.folder_id = f.id AND p.archived_at IS NULL) AS page_count
         FROM accessible_folders($1) a JOIN folders f ON f.id = a.folder_id
         ORDER BY f.name`,
        [auth.userId],
      );
      const recent = await many(
        db,
        `SELECT p.id, p.title, p.folder_id, f.name AS folder_name, u.name AS unit_name,
                p.draft_updated_at AS updated_at, ${PAGE_STATUS_SQL} AS status
         FROM pages p
         JOIN accessible_folders($1) a ON a.folder_id = p.folder_id
         JOIN folders f ON f.id = p.folder_id
         JOIN org_units u ON u.id = f.unit_id
         LEFT JOIN page_versions pv ON pv.id = p.published_version_id
         WHERE p.archived_at IS NULL
         ORDER BY p.draft_updated_at DESC LIMIT 8`,
        [auth.userId],
      );
      const shared = await many(
        db,
        `SELECT DISTINCT ON (p.id) p.id, p.title, p.draft_updated_at AS updated_at, cu.display_name AS shared_by,
                ${PAGE_STATUS_SQL} AS status
         FROM grants g
         JOIN principals_of($1) pr ON pr.ptype = g.principal_type AND pr.pid = g.principal_id
         JOIN pages p ON p.id = g.resource_id
         LEFT JOIN page_versions pv ON pv.id = p.published_version_id
         LEFT JOIN users cu ON cu.id = g.created_by
         WHERE g.resource_type = 'page' AND p.archived_at IS NULL
         ORDER BY p.id`,
        [auth.userId],
      );
      const groups = await many(
        db,
        `SELECT g.id, g.name, g.unit_id, u.name AS unit_name,
                (SELECT count(*)::int FROM group_members m WHERE m.group_id = g.id) AS members
         FROM group_members gm JOIN groups g ON g.id = gm.group_id JOIN org_units u ON u.id = g.unit_id
         WHERE gm.user_id = $1 ORDER BY g.name`,
        [auth.userId],
      );
      return { units, folders, recent, shared, groups };
    }),
  );

  app.post('/api/folders', async (req, reply) => {
    const body = parse(createBody, req.body);
    const folder = await req.tx(async (db, auth) => {
      let unitId: string;
      let parentPath: string | null = null;
      if (body.parentId) {
        await requireRole(db, auth.userId, 'folder', body.parentId, 'editor');
        const parent = await one<{ unit_id: string; path: string }>(
          db,
          'SELECT unit_id, path::text AS path FROM folders WHERE id = $1',
          [body.parentId],
        );
        unitId = parent!.unit_id;
        parentPath = parent!.path;
      } else {
        await requireRole(db, auth.userId, 'unit', body.unitId!, 'editor');
        unitId = body.unitId!;
      }
      const id = randomUUID();
      const created = await one(
        db,
        `INSERT INTO folders (id, org_id, unit_id, parent_id, name, path, created_by)
         VALUES ($1, $2, $3, $4, $5, $6::ltree, $7)
         RETURNING id, unit_id, parent_id, name`,
        [id, auth.orgId, unitId, body.parentId ?? null, body.name, childPath(parentPath, id), auth.userId],
      );
      await audit(db, auth, 'folder.create', 'folder', id, { name: body.name, unitId });
      return created;
    });
    reply.code(201);
    return folder;
  });

  app.patch('/api/folders/:id', async (req) => {
    const { id } = parse(idParams, req.params);
    const body = parse(z.object({ name }), req.body);
    return req.tx(async (db, auth) => {
      await requireRole(db, auth.userId, 'folder', id, 'editor');
      const row = await one(db, 'UPDATE folders SET name = $2 WHERE id = $1 RETURNING id, unit_id, parent_id, name', [
        id,
        body.name,
      ]);
      await audit(db, auth, 'folder.rename', 'folder', id, { to: body.name });
      return row;
    });
  });

  app.delete('/api/folders/:id', async (req, reply) => {
    const { id } = parse(idParams, req.params);
    await req.tx(async (db, auth) => {
      await requireRole(db, auth.userId, 'folder', id, 'editor');
      const use = await one<{ n: number }>(
        db,
        `SELECT (SELECT count(*) FROM folders WHERE parent_id = $1) + (SELECT count(*) FROM pages WHERE folder_id = $1) AS n`,
        [id],
      );
      if (Number(use?.n) > 0) throw conflict('Only empty folders can be deleted');
      await db.query(`DELETE FROM grants WHERE resource_type = 'folder' AND resource_id = $1`, [id]);
      await db.query(`DELETE FROM watches WHERE scope_type = 'folder' AND scope_id = $1`, [id]);
      await db.query('DELETE FROM folders WHERE id = $1', [id]);
      await audit(db, auth, 'folder.delete', 'folder', id);
    });
    reply.code(204);
  });

  app.get('/api/folders/:id/pages', async (req) => {
    const { id } = parse(idParams, req.params);
    return req.tx(async (db, auth) => {
      await requireRole(db, auth.userId, 'folder', id, 'viewer');
      return many(
        db,
        `SELECT p.id, p.title, p.draft_updated_at AS updated_at, ${PAGE_STATUS_SQL} AS status
         FROM pages p LEFT JOIN page_versions pv ON pv.id = p.published_version_id
         WHERE p.folder_id = $1 AND p.archived_at IS NULL ORDER BY p.title`,
        [id],
      );
    });
  });

  app.put('/api/folders/:id/watch', async (req) => {
    const { id } = parse(idParams, req.params);
    const body = parse(z.object({ watching: z.boolean() }), req.body);
    return req.tx(async (db, auth) => {
      await requireRole(db, auth.userId, 'folder', id, 'viewer');
      if (body.watching) {
        await db.query(
          `INSERT INTO watches (org_id, user_id, scope_type, scope_id, events) VALUES ($1, $2, 'folder', $3, ARRAY['published', 'review'])
           ON CONFLICT DO NOTHING`,
          [auth.orgId, auth.userId, id],
        );
      } else {
        await db.query(`DELETE FROM watches WHERE user_id = $1 AND scope_type = 'folder' AND scope_id = $2`, [
          auth.userId,
          id,
        ]);
      }
      return { watching: body.watching };
    });
  });

  app.get('/api/folders/:id', async (req) => {
    const { id } = parse(idParams, req.params);
    return req.tx(async (db, auth) => {
      const role = await requireRole(db, auth.userId, 'folder', id, 'viewer');
      const folder = await one(db, 'SELECT id, unit_id, parent_id, name FROM folders WHERE id = $1', [id]);
      if (!folder) throw notFound();
      return { ...folder, role };
    });
  });
}
