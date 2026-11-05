import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ROLES } from '@notes/shared';
import { many, one } from '../db.js';
import { audit } from '../lib/audit.js';
import { badRequest, notFound } from '../lib/errors.js';
import { idParams, parse, uuid } from '../lib/validate.js';
import { requireRole } from '../services/access.js';

const resourceType = z.enum(['unit', 'folder', 'page']);
const listQuery = z.object({ resourceType, resourceId: uuid });
const createBody = z.object({
  principalType: z.enum(['user', 'group']),
  principalId: uuid,
  resourceType,
  resourceId: uuid,
  role: z.enum(ROLES),
});

/** Share and permissions: who holds which role on a unit, folder or page. */
export async function grantRoutes(app: FastifyInstance) {
  app.get('/api/grants', async (req) => {
    const q = parse(listQuery, req.query);
    return req.tx(async (db, auth) => {
      await requireRole(db, auth.userId, q.resourceType, q.resourceId, 'admin');
      return many(
        db,
        `SELECT g.id, g.principal_type, g.principal_id, g.role, g.created_at,
                coalesce(u.display_name, gr.name) AS principal_name
         FROM grants g
         LEFT JOIN users u ON g.principal_type = 'user' AND u.id = g.principal_id
         LEFT JOIN groups gr ON g.principal_type = 'group' AND gr.id = g.principal_id
         WHERE g.resource_type = $1 AND g.resource_id = $2
         ORDER BY principal_name`,
        [q.resourceType, q.resourceId],
      );
    });
  });

  app.post('/api/grants', async (req, reply) => {
    const body = parse(createBody, req.body);
    const grant = await req.tx(async (db, auth) => {
      await requireRole(db, auth.userId, body.resourceType, body.resourceId, 'admin');
      const table = body.principalType === 'user' ? 'users' : 'groups';
      const principal = await one(db, `SELECT 1 FROM ${table} WHERE id = $1`, [body.principalId]);
      if (!principal) throw badRequest(`That ${body.principalType} does not exist`);
      const row = await one<{ id: string }>(
        db,
        `INSERT INTO grants (org_id, principal_type, principal_id, resource_type, resource_id, role, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (principal_type, principal_id, resource_type, resource_id)
         DO UPDATE SET role = EXCLUDED.role
         RETURNING id, principal_type, principal_id, resource_type, resource_id, role`,
        [auth.orgId, body.principalType, body.principalId, body.resourceType, body.resourceId, body.role, auth.userId],
      );
      await audit(db, auth, 'grant.set', body.resourceType, body.resourceId, {
        principalType: body.principalType,
        principalId: body.principalId,
        role: body.role,
      });
      return row;
    });
    reply.code(201);
    return grant;
  });

  app.delete('/api/grants/:id', async (req, reply) => {
    const { id } = parse(idParams, req.params);
    await req.tx(async (db, auth) => {
      const g = await one<{ resource_type: 'unit' | 'folder' | 'page'; resource_id: string; principal_id: string; role: string }>(
        db,
        'SELECT resource_type, resource_id, principal_id, role FROM grants WHERE id = $1',
        [id],
      );
      if (!g) throw notFound('Grant not found');
      await requireRole(db, auth.userId, g.resource_type, g.resource_id, 'admin');
      await db.query('DELETE FROM grants WHERE id = $1', [id]);
      await audit(db, auth, 'grant.remove', g.resource_type, g.resource_id, { principalId: g.principal_id, role: g.role });
    });
    reply.code(204);
  });
}
