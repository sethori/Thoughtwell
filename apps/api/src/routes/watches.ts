import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { WATCH_EVENTS } from '@notes/shared';
import { one } from '../db.js';
import { parse, uuid } from '../lib/validate.js';
import { requireRole } from '../services/access.js';

const scope = z.object({ scopeType: z.enum(['unit', 'folder', 'page']), scopeId: uuid });
const setBody = scope.extend({ events: z.array(z.enum(WATCH_EVENTS)).max(WATCH_EVENTS.length) });

/** Watching a unit, folder or page: hear about publishes and, for contributors, reviews. Empty events stops watching. */
export async function watchRoutes(app: FastifyInstance) {
  app.get('/api/watches', async (req) => {
    const q = parse(scope, req.query);
    return req.tx(async (db, auth) => {
      const w = await one<{ events: string[] }>(
        db,
        'SELECT events FROM watches WHERE user_id = $1 AND scope_type = $2 AND scope_id = $3',
        [auth.userId, q.scopeType, q.scopeId],
      );
      return { events: w?.events ?? [] };
    });
  });

  app.put('/api/watches', async (req) => {
    const body = parse(setBody, req.body);
    return req.tx(async (db, auth) => {
      await requireRole(db, auth.userId, body.scopeType, body.scopeId, 'viewer').catch((e) => {
        if (body.scopeType !== 'unit') throw e;
      });
      const events = [...new Set(body.events)];
      if (events.length === 0) {
        await db.query('DELETE FROM watches WHERE user_id = $1 AND scope_type = $2 AND scope_id = $3', [
          auth.userId,
          body.scopeType,
          body.scopeId,
        ]);
      } else {
        await db.query(
          `INSERT INTO watches (org_id, user_id, scope_type, scope_id, events) VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (user_id, scope_type, scope_id) DO UPDATE SET events = EXCLUDED.events`,
          [auth.orgId, auth.userId, body.scopeType, body.scopeId, events],
        );
      }
      return { events };
    });
  });
}
