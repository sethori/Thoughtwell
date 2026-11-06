import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { z } from 'zod';
import { conflict, notFound } from '../lib/errors.js';
import { parse } from '../lib/validate.js';
import { seed } from '../seed.js';
import type { AppDeps } from '../app.js';
import { startSession } from './auth.js';

const setupBody = z.object({
  orgName: z.string().trim().min(1).max(200).default('My Organization'),
  displayName: z.string().trim().min(1).max(200),
  username: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .regex(/^[A-Za-z0-9._@-]+$/, 'Use letters, numbers, dots, dashes, underscores or @ in the username'),
  password: z.string().min(8, 'Use at least 8 characters for the password').max(500),
});

async function hasOrg(ownerUrl: string): Promise<boolean> {
  const client = new pg.Client({ connectionString: ownerUrl });
  await client.connect();
  try {
    return Boolean((await client.query('SELECT 1 FROM orgs LIMIT 1')).rowCount);
  } finally {
    await client.end();
  }
}

/**
 * First-run setup, only when the app was started with it turned on (the
 * desktop test build). While there is no organization yet, the first person
 * to open the app names it and creates their own admin account, and is
 * signed straight in. Once an organization exists these routes do nothing.
 */
export async function setupRoutes(app: FastifyInstance, deps: AppDeps) {
  const { config } = deps;
  // Remembered once true, so normal use does not open an owner connection per request.
  let done = !config.firstRunSetup;
  let running: Promise<unknown> | null = null;

  const needed = async () => {
    if (done) return false;
    if (await hasOrg(config.ownerDatabaseUrl)) done = true;
    return !done;
  };

  app.get('/api/setup', { config: { public: true } }, async () => ({ needed: await needed() }));

  app.post('/api/setup', { config: { public: true } }, async (req, reply) => {
    if (!config.firstRunSetup) throw notFound();
    const body = parse(setupBody, req.body);
    // Two windows submitting at once: only one gets to create the organization.
    if (running || !(await needed())) throw conflict('This workspace is already set up. Sign in instead.');
    const work = seed(config.ownerDatabaseUrl, {
      orgName: body.orgName,
      admin: { username: body.username, password: body.password, displayName: body.displayName },
      placeholders: true,
    });
    running = work;
    try {
      const result = await work;
      done = true;
      await startSession(deps, req, reply, result.adminId, result.orgId);
      return { ok: true };
    } catch (err) {
      if (/already exists/.test((err as Error).message)) {
        done = true;
        throw conflict('This workspace is already set up. Sign in instead.');
      }
      throw err;
    } finally {
      running = null;
    }
  });
}
