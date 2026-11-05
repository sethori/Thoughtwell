import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { roleAtLeast } from '@notes/shared';
import { many, one } from '../db.js';
import { audit } from '../lib/audit.js';
import { forbidden } from '../lib/errors.js';
import { parse, uuid } from '../lib/validate.js';
import { requireRole } from '../services/access.js';
import { WORKFLOW_KEYS } from '../services/workflow.js';

const scopeParams = z.object({ scope: z.enum(['unit', 'folder']), id: uuid });
const setBody = z.object({ key: z.enum(WORKFLOW_KEYS), value: z.boolean().nullable() });

/**
 * Review settings on a unit or folder. A value set here applies to everything
 * below unless something nearer sets its own. Null clears it, so it inherits again.
 */
export async function workflowRoutes(app: FastifyInstance) {
  app.get('/api/workflow/:scope/:id', async (req) => {
    const { scope, id } = parse(scopeParams, req.params);
    return req.tx(async (db, auth) => {
      const role = await requireRole(db, auth.userId, scope, id, 'viewer').catch(async (e) => {
        // Units are a public directory, so anyone may read their settings.
        if (scope === 'unit') return null;
        throw e;
      });
      const own = await many<{ key: string; value: unknown }>(
        db,
        'SELECT key, value FROM workflow_settings WHERE scope_type = $1 AND scope_id = $2',
        [scope, id],
      );
      const effective: Record<string, unknown> = {};
      for (const key of WORKFLOW_KEYS) {
        const row = await one<{ v: unknown }>(
          db,
          scope === 'folder' ? 'SELECT resolve_setting($1, $2) AS v' : 'SELECT resolve_unit_setting($1, $2) AS v',
          [id, key],
        );
        effective[key] = row?.v ?? false;
      }
      return {
        own: Object.fromEntries(own.map((r) => [r.key, r.value])),
        effective,
        canEdit: auth.isOrgAdmin || roleAtLeast(role, 'admin'),
      };
    });
  });

  app.put('/api/workflow/:scope/:id', async (req) => {
    const { scope, id } = parse(scopeParams, req.params);
    const body = parse(setBody, req.body);
    return req.tx(async (db, auth) => {
      const role = await requireRole(db, auth.userId, scope, id, 'viewer');
      if (!auth.isOrgAdmin && !roleAtLeast(role, 'admin')) throw forbidden('Only admins of this area can change its review settings');
      if (body.value === null) {
        await db.query('DELETE FROM workflow_settings WHERE scope_type = $1 AND scope_id = $2 AND key = $3', [scope, id, body.key]);
      } else {
        await db.query(
          `INSERT INTO workflow_settings (org_id, scope_type, scope_id, key, value) VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (scope_type, scope_id, key) DO UPDATE SET value = EXCLUDED.value`,
          [auth.orgId, scope, id, body.key, JSON.stringify(body.value)],
        );
      }
      await audit(db, auth, 'workflow.set', scope, id, { key: body.key, value: body.value });
      return { ok: true };
    });
  });
}
