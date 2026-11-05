import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { describeNotification, type NotificationPayload } from '@notes/shared';
import { many, one } from '../db.js';
import { parse, uuid } from '../lib/validate.js';

const listQuery = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) });
const readBody = z.object({ ids: z.array(uuid).max(500).optional() });

export async function notificationRoutes(app: FastifyInstance) {
  app.get('/api/notifications', async (req) => {
    const q = parse(listQuery, req.query);
    return req.tx(async (db, auth) => {
      const rows = await many<{ id: string; type: string; payload: NotificationPayload; read_at: string | null; created_at: string }>(
        db,
        `SELECT id, type, payload, read_at, created_at FROM notifications
         WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
        [auth.userId, q.limit],
      );
      const unread = await one<{ n: number }>(
        db,
        'SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL',
        [auth.userId],
      );
      return {
        unread: unread?.n ?? 0,
        items: rows.map((r) => ({ ...r, ...describeNotification(r.type, r.payload) })),
      };
    });
  });

  app.get('/api/notifications/unread', async (req) =>
    req.tx(async (db, auth) => {
      const r = await one<{ n: number }>(db, 'SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL', [
        auth.userId,
      ]);
      return { unread: r?.n ?? 0 };
    }),
  );

  /** Marks the given notifications read, or all of them when no ids are sent. */
  app.post('/api/notifications/read', async (req) => {
    const body = parse(readBody, req.body);
    return req.tx(async (db, auth) => {
      if (body.ids) {
        await db.query('UPDATE notifications SET read_at = now() WHERE user_id = $1 AND id = ANY($2) AND read_at IS NULL', [
          auth.userId,
          body.ids,
        ]);
      } else {
        await db.query('UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL', [auth.userId]);
      }
      return { ok: true };
    });
  });
}
