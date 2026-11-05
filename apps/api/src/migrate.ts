import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

/**
 * Applies numbered SQL files in order, once each, then re-applies the app
 * role's privileges. Runs as the database owner.
 */
export async function migrate(
  ownerUrl: string,
  appPassword: string,
  log = console.log,
  migrationsDir = MIGRATIONS_DIR,
): Promise<string[]> {
  const client = new pg.Client({ connectionString: ownerUrl });
  await client.connect();
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);

    // The restricted role the API connects as. It never owns tables, so
    // row-level security always applies to it.
    const role = await client.query(`SELECT 1 FROM pg_roles WHERE rolname = 'notes_app'`);
    if (role.rowCount === 0) {
      await client.query(`CREATE ROLE notes_app LOGIN PASSWORD ${client.escapeLiteral(appPassword)}`);
      log('created role notes_app');
    } else {
      await client.query(`ALTER ROLE notes_app WITH LOGIN PASSWORD ${client.escapeLiteral(appPassword)}`);
    }

    const done = new Set((await client.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
    const files = (await readdir(migrationsDir)).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();
    const applied: string[] = [];
    for (const file of files) {
      if (done.has(file)) continue;
      const sql = await readFile(join(migrationsDir, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
      }
      applied.push(file);
      log(`applied ${file}`);
    }
    await client.query(await readFile(join(migrationsDir, 'grants.sql'), 'utf8'));
    log(applied.length ? `${applied.length} migration(s) applied` : 'database is up to date');
    return applied;
  } finally {
    await client.end();
  }
}

if (!process.versions.electron && process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const url = process.env.DATABASE_URL;
  const appPassword = process.env.APP_DB_PASSWORD;
  if (!url || !appPassword) {
    console.error('Set DATABASE_URL (owner) and APP_DB_PASSWORD. See .env.example.');
    process.exit(1);
  }
  migrate(url, appPassword).catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
