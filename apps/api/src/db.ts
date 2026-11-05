import pg from 'pg';

export type Db = pg.PoolClient;

export function createPool(connectionString: string): pg.Pool {
  return new pg.Pool({ connectionString, max: 10 });
}

/**
 * Runs `fn` in one transaction scoped to an organization. The org id is set
 * transaction-locally, so it cannot leak to the next request that reuses the
 * pooled connection, and row-level security filters every query inside.
 */
export async function withOrg<T>(pool: pg.Pool, orgId: string, fn: (db: Db) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.org_id', $1, true)", [orgId]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** For the few queries that run before an organization is known (sign-in). */
export async function withoutOrg<T>(pool: pg.Pool, fn: (db: Db) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

export async function one<T extends pg.QueryResultRow>(db: Db, sql: string, params: unknown[] = []): Promise<T | undefined> {
  const r = await db.query<T>(sql, params);
  return r.rows[0];
}

export async function many<T extends pg.QueryResultRow>(db: Db, sql: string, params: unknown[] = []): Promise<T[]> {
  const r = await db.query<T>(sql, params);
  return r.rows;
}
