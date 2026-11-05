import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { roleAtLeast } from '@notes/shared';
import { many, one } from '../db.js';
import { audit } from '../lib/audit.js';
import { conflict, notFound } from '../lib/errors.js';
import { idParams, parse, uuid } from '../lib/validate.js';
import { requireRole } from '../services/access.js';

/**
 * draft: never published. published: the draft matches the live version.
 * changed: published, with draft edits since. Needs `pv` joined on the
 * published version.
 */
export const PAGE_STATUS_SQL = `CASE
  WHEN p.published_version_id IS NULL THEN 'draft'
  WHEN p.draft_updated_at > pv.created_at THEN 'changed'
  ELSE 'published' END`;

// A ProseMirror document: { type: 'doc', content: [...] }. Shape is checked
// by the editor schema on load; here we cap size and require the root.
const docSchema = z
  .object({ type: z.literal('doc'), content: z.array(z.unknown()).optional() })
  .passthrough()
  .refine((d) => JSON.stringify(d).length <= 5_000_000, 'Page is too large (5 MB limit)');

const createBody = z.object({
  folderId: uuid,
  title: z.string().trim().max(300).optional(),
  content: docSchema.optional(),
});
const draftBody = z.object({
  title: z.string().trim().max(300),
  content: docSchema,
  baseRev: z.number().int().nonnegative(),
});
const versionParams = z.object({ id: uuid, number: z.coerce.number().int().positive() });

export async function pageRoutes(app: FastifyInstance) {
  app.post('/api/pages', async (req, reply) => {
    const body = parse(createBody, req.body);
    const page = await req.tx(async (db, auth) => {
      await requireRole(db, auth.userId, 'folder', body.folderId, 'contributor');
      const row = await one<{ id: string }>(
        db,
        `INSERT INTO pages (org_id, folder_id, title, draft_content, created_by, draft_updated_by)
         VALUES ($1, $2, $3, $4, $5, $5)
         RETURNING id, folder_id, title, draft_rev`,
        [auth.orgId, body.folderId, body.title || 'Untitled', body.content ?? { type: 'doc', content: [] }, auth.userId],
      );
      await audit(db, auth, 'page.create', 'page', row!.id, { title: body.title, imported: Boolean(body.content) });
      return row;
    });
    reply.code(201);
    return page;
  });

  app.get('/api/pages/:id', async (req) => {
    const { id } = parse(idParams, req.params);
    return req.tx(async (db, auth) => {
      const role = await requireRole(db, auth.userId, 'page', id, 'viewer');
      const page = await one<Record<string, unknown> & { folder_id: string; published_version_id: string | null }>(
        db,
        `SELECT p.id, p.title, p.folder_id, p.draft_content, p.draft_rev, p.draft_updated_at,
                du.display_name AS draft_updated_by_name, p.published_version_id,
                pv.number AS published_number, pv.title AS published_title, pv.content AS published_content,
                pv.created_at AS published_at, ${PAGE_STATUS_SQL} AS status
         FROM pages p
         LEFT JOIN page_versions pv ON pv.id = p.published_version_id
         LEFT JOIN users du ON du.id = p.draft_updated_by
         WHERE p.id = $1 AND p.archived_at IS NULL`,
        [id],
      );
      if (!page) throw notFound('Page not found');
      const breadcrumb = await many<{ name: string; kind: string; id: string }>(
        db,
        `SELECT * FROM (
           SELECT a.id, a.name, 'unit' AS kind, nlevel(a.path) AS depth
           FROM folders f JOIN org_units u ON u.id = f.unit_id JOIN org_units a ON a.path @> u.path
           WHERE f.id = $1
           UNION ALL
           SELECT a.id, a.name, 'folder' AS kind, 1000 + nlevel(a.path) AS depth
           FROM folders f JOIN folders a ON a.path @> f.path WHERE f.id = $1
         ) c ORDER BY depth`,
        [page.folder_id],
      );
      const canSeeDraft = roleAtLeast(role, 'contributor');
      const {
        draft_content,
        draft_rev,
        draft_updated_at,
        draft_updated_by_name,
        published_title,
        published_content,
        published_number,
        published_at,
        ...rest
      } = page;
      return {
        ...rest,
        role,
        breadcrumb: breadcrumb.map(({ id, name, kind }) => ({ id, name, kind })),
        draft: canSeeDraft
          ? { content: draft_content, rev: draft_rev, updatedAt: draft_updated_at, updatedBy: draft_updated_by_name }
          : null,
        published: page.published_version_id
          ? { number: published_number, title: published_title, content: published_content, at: published_at }
          : null,
      };
    });
  });

  /** Saves the draft. Phase 2 replaces this with live Yjs sync; until then, last save must match. */
  app.put('/api/pages/:id/draft', async (req) => {
    const { id } = parse(idParams, req.params);
    const body = parse(draftBody, req.body);
    return req.tx(async (db, auth) => {
      await requireRole(db, auth.userId, 'page', id, 'contributor');
      const row = await one<{ draft_rev: number; draft_updated_at: string }>(
        db,
        `UPDATE pages SET title = $2, draft_content = $3, draft_rev = draft_rev + 1,
                draft_updated_at = now(), draft_updated_by = $4
         WHERE id = $1 AND draft_rev = $5 AND archived_at IS NULL
         RETURNING draft_rev, draft_updated_at`,
        [id, body.title || 'Untitled', body.content, auth.userId, body.baseRev],
      );
      if (!row) throw conflict('Someone else saved this page after you opened it. Reload to see their changes.');
      return { rev: row.draft_rev, updatedAt: row.draft_updated_at };
    });
  });

  /**
   * Phase 1 publishes directly. A folder whose settings require approval is
   * refused here until the review flow arrives in phase 3.
   */
  app.post('/api/pages/:id/publish', async (req) => {
    const { id } = parse(idParams, req.params);
    return req.tx(async (db, auth) => {
      await requireRole(db, auth.userId, 'page', id, 'contributor');
      const page = await one<{ folder_id: string; title: string; draft_content: unknown }>(
        db,
        'SELECT folder_id, title, draft_content FROM pages WHERE id = $1 AND archived_at IS NULL FOR UPDATE',
        [id],
      );
      if (!page) throw notFound();
      const approval = await one<{ v: unknown }>(db, `SELECT resolve_setting($1, 'approval.required') AS v`, [
        page.folder_id,
      ]);
      if (approval?.v === true) {
        throw conflict('This folder requires approval before publishing. Review arrives in phase 3.');
      }
      const version = await one<{ id: string; number: number; created_at: string }>(
        db,
        `INSERT INTO page_versions (org_id, page_id, number, title, content, created_by)
         VALUES ($1, $2, (SELECT coalesce(max(number), 0) + 1 FROM page_versions WHERE page_id = $2), $3, $4, $5)
         RETURNING id, number, created_at`,
        [auth.orgId, id, page.title, page.draft_content, auth.userId],
      );
      await db.query('UPDATE pages SET published_version_id = $2 WHERE id = $1', [id, version!.id]);
      await audit(db, auth, 'page.publish', 'page', id, { version: version!.number });
      return { number: version!.number, at: version!.created_at };
    });
  });

  app.get('/api/pages/:id/versions', async (req) => {
    const { id } = parse(idParams, req.params);
    return req.tx(async (db, auth) => {
      await requireRole(db, auth.userId, 'page', id, 'viewer');
      return many(
        db,
        `SELECT v.number, v.title, v.created_at, u.display_name AS created_by
         FROM page_versions v LEFT JOIN users u ON u.id = v.created_by
         WHERE v.page_id = $1 AND v.archived_at IS NULL ORDER BY v.number DESC`,
        [id],
      );
    });
  });

  app.get('/api/pages/:id/versions/:number', async (req) => {
    const { id, number } = parse(versionParams, req.params);
    return req.tx(async (db, auth) => {
      await requireRole(db, auth.userId, 'page', id, 'viewer');
      const v = await one(
        db,
        `SELECT number, title, content, created_at FROM page_versions
         WHERE page_id = $1 AND number = $2 AND archived_at IS NULL`,
        [id, number],
      );
      if (!v) throw notFound('Version not found');
      return v;
    });
  });

  /** Archives rather than deletes, so published history and the audit trail stay intact. */
  app.delete('/api/pages/:id', async (req, reply) => {
    const { id } = parse(idParams, req.params);
    await req.tx(async (db, auth) => {
      await requireRole(db, auth.userId, 'page', id, 'editor');
      await db.query('UPDATE pages SET archived_at = now() WHERE id = $1 AND archived_at IS NULL', [id]);
      await audit(db, auth, 'page.archive', 'page', id);
    });
    reply.code(204);
  });
}
