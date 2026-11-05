import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { childPath, type UnitType } from '@notes/shared';
import { hashPassword } from './auth/password.js';

export interface SeedOptions {
  orgName: string;
  admin: { username: string; password: string; displayName: string };
  /** Adds the placeholder tree from the mockups. */
  placeholders?: boolean;
}

export interface SeedResult {
  orgId: string;
  adminId: string;
  units: Record<string, string>;
}

/**
 * Creates the single root organization and its first admin. Safe to run
 * once; refuses if an organization already exists. Runs as the owner.
 */
export async function seed(ownerUrl: string, opts: SeedOptions): Promise<SeedResult> {
  const client = new pg.Client({ connectionString: ownerUrl });
  await client.connect();
  try {
    const existing = await client.query('SELECT 1 FROM orgs LIMIT 1');
    if (existing.rowCount) throw new Error('An organization already exists; seed only runs on an empty database.');

    await client.query('BEGIN');
    const orgId = randomUUID();
    const slug = opts.orgName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'org';
    await client.query('INSERT INTO orgs (id, name, slug) VALUES ($1, $2, $3)', [orgId, opts.orgName, slug]);

    const units: Record<string, string> = {};
    const paths: Record<string, string> = {};
    const addUnit = async (key: string, type: UnitType, name: string, parentKey?: string) => {
      const id = randomUUID();
      const parentPath = parentKey ? paths[parentKey]! : null;
      const path = childPath(parentPath, id);
      await client.query(
        'INSERT INTO org_units (id, org_id, parent_id, type, name, path) VALUES ($1, $2, $3, $4, $5, $6::ltree)',
        [id, orgId, parentKey ? units[parentKey] : null, type, name, path],
      );
      units[key] = id;
      paths[key] = path;
    };

    await addUnit('org', 'org', opts.orgName);
    if (opts.placeholders) {
      await addUnit('dir1', 'directorate', 'Directorate 1', 'org');
      await addUnit('dir2', 'directorate', 'Directorate 2', 'org');
      await addUnit('divA', 'division', 'Division A', 'dir1');
      await addUnit('divB', 'division', 'Division B', 'dir1');
      await addUnit('branchA1', 'branch', 'Branch A1', 'divA');
      await addUnit('branchA2', 'branch', 'Branch A2', 'divA');
      await addUnit('section1', 'section', 'Section 1', 'branchA1');
      await addUnit('section2', 'section', 'Section 2', 'branchA1');
      await addUnit('project1', 'project', 'Project 1', 'section1');
    }

    const adminId = randomUUID();
    await client.query(
      `INSERT INTO users (id, org_id, username, display_name, password_hash, is_org_admin, home_unit_id)
       VALUES ($1, $2, $3, $4, $5, true, $6)`,
      [
        adminId,
        orgId,
        opts.admin.username,
        opts.admin.displayName,
        await hashPassword(opts.admin.password),
        units.section1 ?? units.org,
      ],
    );
    if (opts.placeholders) {
      // A starter folder so the workspace is not empty on first sign-in.
      const folderId = randomUUID();
      await client.query(
        `INSERT INTO folders (id, org_id, unit_id, name, path, created_by) VALUES ($1, $2, $3, 'Notes', $4::ltree, $5)`,
        [folderId, orgId, units.section1, childPath(null, folderId), adminId],
      );
    }
    await client.query(
      `INSERT INTO audit_log (org_id, actor_id, actor_kind, action, resource_type, resource_id, detail)
       VALUES ($1, $2, 'person', 'org.seed', 'org', $1, $3)`,
      [orgId, adminId, { placeholders: Boolean(opts.placeholders) }],
    );
    await client.query('COMMIT');
    return { orgId, adminId, units };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    await client.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const env = process.env;
  const url = env.DATABASE_URL;
  if (!url || !env.SEED_ADMIN_PASSWORD) {
    console.error('Set DATABASE_URL and SEED_ADMIN_PASSWORD. See .env.example.');
    process.exit(1);
  }
  seed(url, {
    orgName: env.SEED_ORG_NAME ?? 'My Organization',
    admin: {
      username: env.SEED_ADMIN_USERNAME ?? 'admin',
      password: env.SEED_ADMIN_PASSWORD,
      displayName: env.SEED_ADMIN_DISPLAY_NAME ?? 'Administrator',
    },
    placeholders: !process.argv.includes('--empty'),
  })
    .then((r) => console.log(`Seeded organization ${r.orgId}. Sign in as ${env.SEED_ADMIN_USERNAME ?? 'admin'}.`))
    .catch((err) => {
      console.error(err.message);
      process.exit(1);
    });
}
