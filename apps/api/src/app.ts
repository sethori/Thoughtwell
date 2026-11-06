import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import type pg from 'pg';
import { hashToken, SESSION_COOKIE } from './auth/session.js';
import type { Config } from './config.js';
import { one, withOrg, withoutOrg } from './db.js';
import { fromPgError, HttpError, unauthorized } from './lib/errors.js';
import { LocalStorage, type Storage } from './lib/storage.js';
import { adminRoutes } from './routes/admin.js';
import { assetRoutes } from './routes/assets.js';
import { authRoutes } from './routes/auth.js';
import { setupRoutes } from './routes/setup.js';
import { directoryRoutes } from './routes/directory.js';
import { folderRoutes } from './routes/folders.js';
import { grantRoutes } from './routes/grants.js';
import { meRoutes } from './routes/me.js';
import { pageRoutes } from './routes/pages.js';
import { unitRoutes } from './routes/units.js';
import { notificationRoutes } from './routes/notifications.js';
import { reviewRoutes } from './routes/reviews.js';
import { watchRoutes } from './routes/watches.js';
import { workflowRoutes } from './routes/workflow.js';
import { COLLAB_PATH, createCollab, type Collab } from './collab/server.js';
import { pgCollabStore } from './collab/store.js';
import { createDispatcher, type Dispatcher } from './lib/delivery.js';
import type { AuthContext } from './types.js';
import './types.js';

export interface AppDeps {
  config: Config;
  pool: pg.Pool;
  storage?: Storage;
  /** Live co-editing. Created by buildApp unless passed in. */
  collab?: Collab;
  /** Email and Teams delivery. Created by buildApp unless passed in. */
  dispatcher?: Dispatcher;
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const { config, pool } = deps;
  const storage = deps.storage ?? new LocalStorage(config.storageDir);
  const collab = deps.collab ?? createCollab(pgCollabStore(pool));
  const dispatcher = deps.dispatcher ?? createDispatcher(pool, config.publicUrl);
  const full: AppDeps = { ...deps, storage, collab, dispatcher };

  const app = Fastify({
    logger: { level: config.logLevel, redact: ['req.headers.cookie', 'req.headers.authorization'] },
    // Behind your nginx, so the client IP comes from X-Forwarded-For.
    trustProxy: true,
    bodyLimit: 10 * 1024 * 1024,
  });

  await app.register(cookie, { secret: config.sessionSecret });
  await app.register(multipart);

  app.decorateRequest('auth', undefined);
  app.decorateRequest('tx', function <T>(this: { auth?: AuthContext }, fn: (db: import('./db.js').Db, auth: AuthContext) => Promise<T>) {
    const auth = this.auth;
    if (!auth) throw unauthorized();
    return withOrg(pool, auth.orgId, (db) => fn(db, auth));
  });

  // Every /api route needs a signed-in session unless it opts out.
  app.addHook('onRequest', async (req) => {
    if (req.routeOptions.config?.public || !req.url.startsWith('/api/')) return;
    const token = req.cookies[SESSION_COOKIE];
    if (!token) throw unauthorized();
    const s = await withoutOrg(pool, (db) =>
      one<{ session_id: string; user_id: string; org_id: string; kind: 'person' | 'agent'; is_org_admin: boolean }>(
        db,
        'SELECT * FROM auth_get_session($1)',
        [hashToken(token)],
      ),
    );
    if (!s) throw unauthorized('Your session has expired. Sign in again.');
    req.auth = {
      userId: s.user_id,
      orgId: s.org_id,
      sessionId: s.session_id,
      kind: s.kind,
      isOrgAdmin: s.is_org_admin,
      ip: req.ip,
    };
  });

  app.setErrorHandler((err: FastifyError, req, reply) => {
    const mapped = err instanceof HttpError ? err : fromPgError(err);
    if (mapped) {
      return reply.status(mapped.status).send({ error: { code: mapped.code, message: mapped.message } });
    }
    if (err.statusCode && err.statusCode < 500) {
      return reply.status(err.statusCode).send({ error: { code: err.code ?? 'bad_request', message: err.message } });
    }
    req.log.error(err);
    return reply.status(500).send({ error: { code: 'internal', message: 'Something went wrong' } });
  });

  app.get('/api/health', { config: { public: true } }, async () => {
    await withoutOrg(pool, (db) => db.query('SELECT 1'));
    return { ok: true };
  });

  await authRoutes(app, full);
  await setupRoutes(app, full);
  await meRoutes(app);
  await directoryRoutes(app);
  await unitRoutes(app);
  await folderRoutes(app);
  await pageRoutes(app, full);
  await reviewRoutes(app, full);
  await workflowRoutes(app);
  await watchRoutes(app);
  await notificationRoutes(app);
  await grantRoutes(app);
  await adminRoutes(app, full);
  await assetRoutes(app, { storage });

  // Live editing shares the API's port: WebSocket upgrades on /api/collab.
  app.server.on('upgrade', (req, socket, head) => {
    const path = (req.url ?? '').split('?')[0];
    if (path === COLLAB_PATH || path?.startsWith(`${COLLAB_PATH}/`)) collab.handleUpgrade(req, socket, head);
    else socket.destroy();
  });
  app.addHook('preClose', async () => {
    await collab.close();
    dispatcher.close();
  });

  return app;
}
