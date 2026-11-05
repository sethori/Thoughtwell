import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { DUMMY_HASH, verifyPassword } from '../auth/password.js';
import { hashToken, newSessionToken, SESSION_COOKIE } from '../auth/session.js';
import { one, withOrg, withoutOrg } from '../db.js';
import { unauthorized } from '../lib/errors.js';
import { parse } from '../lib/validate.js';
import type { AppDeps } from '../app.js';

const loginBody = z.object({
  username: z.string().trim().min(1).max(100),
  password: z.string().min(1).max(500),
});

export async function authRoutes(app: FastifyInstance, deps: AppDeps) {
  const { pool, config } = deps;

  app.post('/api/auth/login', { config: { public: true } }, async (req, reply) => {
    const body = parse(loginBody, req.body);
    const found = await withoutOrg(pool, (db) =>
      one<{ id: string; org_id: string; password_hash: string | null; disabled: boolean }>(
        db,
        'SELECT * FROM auth_find_user($1)',
        [body.username],
      ),
    );
    // Always run a hash comparison so a missing user takes as long as a wrong password.
    const ok = await verifyPassword(body.password, found?.password_hash ?? DUMMY_HASH);
    if (!found || !ok || found.disabled) {
      if (found) {
        await withOrg(pool, found.org_id, (db) =>
          db.query(
            `INSERT INTO audit_log (org_id, actor_id, action, resource_type, resource_id, ip)
             VALUES ($1, NULL, 'auth.login_failed', 'user', $2, $3)`,
            [found.org_id, found.id, req.ip],
          ),
        );
      }
      throw unauthorized('Wrong username or password');
    }

    const token = newSessionToken();
    const expires = new Date(Date.now() + config.sessionDays * 86_400_000);
    await withOrg(pool, found.org_id, async (db) => {
      await db.query(
        `INSERT INTO sessions (org_id, user_id, token_hash, expires_at, ip, user_agent)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [found.org_id, found.id, hashToken(token), expires, req.ip, req.headers['user-agent'] ?? null],
      );
      await db.query(
        `INSERT INTO audit_log (org_id, actor_id, actor_kind, action, resource_type, resource_id, ip)
         VALUES ($1, $2, 'person', 'auth.login', 'user', $2, $3)`,
        [found.org_id, found.id, req.ip],
      );
    });

    reply.setCookie(SESSION_COOKIE, token, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: config.cookieSecure,
      expires,
    });
    return { ok: true };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    await req.tx(async (db, auth) => {
      await db.query('DELETE FROM sessions WHERE id = $1', [auth.sessionId]);
    });
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });
}
