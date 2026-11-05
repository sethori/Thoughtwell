import { randomBytes } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import pg from 'pg';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createPool } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { seed, type SeedResult } from '../src/seed.js';

/**
 * Each test file gets its own throwaway database on a real Postgres.
 * TEST_DATABASE_ADMIN_URL must be a role that can create databases and
 * roles, e.g. postgres://postgres:postgres@localhost:5432/postgres
 */
const ADMIN_URL = process.env.TEST_DATABASE_ADMIN_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';
const APP_PASSWORD = 'test-app-password';

export interface TestEnv {
  app: FastifyInstance;
  ownerUrl: string;
  appUrl: string;
  seeded: SeedResult;
  close(): Promise<void>;
}

function withDb(url: string, db: string): string {
  const u = new URL(url);
  u.pathname = '/' + db;
  return u.toString();
}

export async function setup(): Promise<TestEnv> {
  const dbName = 'notes_test_' + randomBytes(4).toString('hex');
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${dbName}`);
  await admin.end();

  const ownerUrl = withDb(ADMIN_URL, dbName);
  await migrate(ownerUrl, APP_PASSWORD, () => {});
  const seeded = await seed(ownerUrl, {
    orgName: 'Test Org',
    admin: { username: 'admin', password: 'admin-password', displayName: 'Admin' },
    placeholders: true,
  });

  const appUrlObj = new URL(ownerUrl);
  appUrlObj.username = 'notes_app';
  appUrlObj.password = APP_PASSWORD;
  const appUrl = appUrlObj.toString();

  const pool = createPool(appUrl);
  const config = loadConfig({
    appDatabaseUrl: appUrl,
    ownerDatabaseUrl: ownerUrl,
    sessionSecret: 'x'.repeat(40),
    storageDir: await mkdtemp(join(tmpdir(), 'notes-assets-')),
    logLevel: 'silent',
  });
  const app = await buildApp({ config, pool });

  return {
    app,
    ownerUrl,
    appUrl,
    seeded,
    async close() {
      await app.close();
      await pool.end();
      const a = new pg.Client({ connectionString: ADMIN_URL });
      await a.connect();
      await a.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
      await a.end();
    },
  };
}

/** A signed-in HTTP client for one user. */
export class Client {
  constructor(
    private readonly app: FastifyInstance,
    private cookie = '',
  ) {}

  static async login(app: FastifyInstance, username: string, password: string): Promise<Client> {
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username, password } });
    if (res.statusCode !== 200) throw new Error(`login ${username} failed: ${res.statusCode} ${res.body}`);
    const set = res.headers['set-cookie'];
    const raw = Array.isArray(set) ? set[0]! : String(set);
    return new Client(app, raw.split(';')[0]!);
  }

  async req(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: unknown): Promise<LightMyRequestResponse> {
    return this.app.inject({
      method,
      url,
      headers: this.cookie ? { cookie: this.cookie } : {},
      ...(payload !== undefined ? { payload: payload as object } : {}),
    });
  }

  async json<T = any>(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: unknown, expect = [200, 201]): Promise<T> {
    const res = await this.req(method, url, payload);
    if (!expect.includes(res.statusCode)) throw new Error(`${method} ${url} -> ${res.statusCode}: ${res.body}`);
    return res.json() as T;
  }

  async upload(url: string, filename: string, mime: string, body: Buffer): Promise<LightMyRequestResponse> {
    const boundary = '----notes' + randomBytes(8).toString('hex');
    const payload = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`,
      ),
      body,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    return this.app.inject({
      method: 'POST',
      url,
      headers: { cookie: this.cookie, 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload,
    });
  }
}

export const emptyDoc = { type: 'doc', content: [] };
export const doc = (text: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});
