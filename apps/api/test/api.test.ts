import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { Client, doc, setup, type TestEnv } from './helpers.js';

let env: TestEnv;
let admin: Client;

before(async () => {
  env = await setup();
  admin = await Client.login(env.app, 'admin', 'admin-password');
});
after(async () => {
  await env?.close();
});

async function createUser(username: string, extra: Record<string, unknown> = {}) {
  return admin.json('POST', '/api/admin/users', {
    username,
    displayName: username,
    password: 'password-123',
    ...extra,
  });
}

async function grant(principalId: string, resourceType: string, resourceId: string | undefined, role: string) {
  assert.ok(resourceId, 'missing resource id');
  return admin.json('POST', '/api/grants', { principalType: 'user', principalId, resourceType, resourceId, role });
}

describe('sign-in', () => {
  test('rejects a wrong password and an unknown user the same way', async () => {
    const a = await env.app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password: 'nope' } });
    const b = await env.app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'ghost', password: 'nope' } });
    assert.equal(a.statusCode, 401);
    assert.equal(b.statusCode, 401);
    assert.equal(a.json().error.message, b.json().error.message);
  });

  test('requires a session for the API', async () => {
    const res = await env.app.inject({ method: 'GET', url: '/api/me' });
    assert.equal(res.statusCode, 401);
  });

  test('returns the profile with default preferences', async () => {
    const me = await admin.json('GET', '/api/me');
    assert.equal(me.user.username, 'admin');
    assert.deepEqual(me.user.preferences, { mode: 'dark', accent: 'blue', density: 'comfortable' });
  });

  test('saves preferences per user', async () => {
    const r = await admin.json('PATCH', '/api/me/preferences', { mode: 'light', density: 'compact' });
    assert.deepEqual(r.preferences, { mode: 'light', accent: 'blue', density: 'compact' });
    const bad = await admin.req('PATCH', '/api/me/preferences', { mode: 'neon' });
    assert.equal(bad.statusCode, 400);
  });

  test('logout ends the session', async () => {
    const c = await Client.login(env.app, 'admin', 'admin-password');
    await c.json('POST', '/api/auth/logout');
    assert.equal((await c.req('GET', '/api/me')).statusCode, 401);
  });

  test('a disabled person can no longer sign in', async () => {
    const u = await createUser('leaver');
    const c = await Client.login(env.app, 'leaver', 'password-123');
    await admin.json('PATCH', `/api/admin/users/${u.id}`, { disabled: true });
    assert.equal((await c.req('GET', '/api/me')).statusCode, 401);
    await assert.rejects(Client.login(env.app, 'leaver', 'password-123'));
  });
});

describe('org tree editor', () => {
  test('adds the next level down automatically', async () => {
    const u = env.seeded.units;
    const div = await admin.json('POST', '/api/units', { parentId: u.dir2, name: 'Division C' });
    assert.equal(div.type, 'division');
    const branch = await admin.json('POST', '/api/units', { parentId: div.id, name: 'Branch C1' });
    assert.equal(branch.type, 'branch');
  });

  test('a project is the last level', async () => {
    const res = await admin.req('POST', '/api/units', { parentId: env.seeded.units.project1, name: 'Too deep' });
    assert.equal(res.statusCode, 400);
  });

  test('renames without touching paths', async () => {
    const r = await admin.json('PATCH', `/api/units/${env.seeded.units.branchA2}`, { name: 'Branch A2 (renamed)' });
    assert.equal(r.name, 'Branch A2 (renamed)');
  });

  test('moves a subtree and keeps its children with it', async () => {
    const u = env.seeded.units;
    // Branch A2 moves from Division A to Division B, taking a new section along.
    const sec = await admin.json('POST', '/api/units', { parentId: u.branchA2, name: 'Section moving' });
    await admin.json('PATCH', `/api/units/${u.branchA2}`, { parentId: u.divB });
    const dir = await admin.json('GET', '/api/directory');
    const byId = new Map(dir.units.map((x: any) => [x.id, x]));
    assert.equal((byId.get(u.branchA2) as any).parent_id, u.divB);
    assert.equal((byId.get(sec.id) as any).parent_id, u.branchA2);
    // The moved section still inherits from its new ancestors.
    const head = await createUser('divb-head');
    await grant(head.id, 'unit', u.divB, 'admin');
    const c = await Client.login(env.app, 'divb-head', 'password-123');
    const f = await c.req('POST', '/api/folders', { unitId: sec.id, name: 'Reachable after move' });
    assert.equal(f.statusCode, 201);
  });

  test('refuses moves that break the level order', async () => {
    const u = env.seeded.units;
    const res = await admin.req('PATCH', `/api/units/${u.section2}`, { parentId: u.divA });
    assert.equal(res.statusCode, 400);
  });

  test('refuses to delete a unit that still holds things', async () => {
    const res = await admin.req('DELETE', `/api/units/${env.seeded.units.divA}`);
    assert.equal(res.statusCode, 409);
    assert.match(res.json().error.message, /children/);
  });

  test('deletes an empty unit', async () => {
    const tmp = await admin.json('POST', '/api/units', { parentId: env.seeded.units.org, name: 'Temp' });
    assert.equal((await admin.req('DELETE', `/api/units/${tmp.id}`)).statusCode, 204);
  });

  test('only unit admins can change the tree', async () => {
    const viewer = await createUser('tree-viewer');
    const c = await Client.login(env.app, 'tree-viewer', 'password-123');
    const res = await c.req('POST', '/api/units', { parentId: env.seeded.units.divA, name: 'Nope' });
    assert.equal(res.statusCode, 403);
    // But everyone can read the directory.
    const dir = await c.json('GET', '/api/directory');
    assert.ok(dir.units.length > 5);
    assert.ok(dir.people.some((p: any) => p.id === viewer.id));
    assert.equal(dir.people[0].password_hash, undefined);
  });
});

describe('permissions', () => {
  let sec1Folder: string;
  let sec2Folder: string;
  let alice: Client; // contributor in Section 1
  let bob: Client; // viewer in Section 2

  before(async () => {
    const u = env.seeded.units;
    sec1Folder = (await admin.json('POST', '/api/folders', { unitId: u.section1, name: 'Sec1 Plans' })).id;
    sec2Folder = (await admin.json('POST', '/api/folders', { unitId: u.section2, name: 'Sec2 Plans' })).id;
    const a = await createUser('alice', { homeUnitId: u.section1 });
    const b = await createUser('bob', { homeUnitId: u.section2 });
    await grant(a.id, 'unit', u.section1, 'contributor');
    await grant(b.id, 'unit', u.section2, 'viewer');
    alice = await Client.login(env.app, 'alice', 'password-123');
    bob = await Client.login(env.app, 'bob', 'password-123');
  });

  test('a section grant reaches only that section', async () => {
    const ws = await alice.json('GET', '/api/workspace');
    const ids = ws.folders.map((f: any) => f.id);
    assert.ok(ids.includes(sec1Folder));
    assert.ok(!ids.includes(sec2Folder));
    // Content outside your grants is reported as not found.
    assert.equal((await alice.req('GET', `/api/folders/${sec2Folder}`)).statusCode, 404);
  });

  test('a grant higher in the tree covers everything below', async () => {
    const head = await createUser('diva-head');
    await grant(head.id, 'unit', env.seeded.units.divA, 'approver');
    const c = await Client.login(env.app, 'diva-head', 'password-123');
    const ws = await c.json('GET', '/api/workspace');
    const ids = ws.folders.map((f: any) => f.id);
    assert.ok(ids.includes(sec1Folder) && ids.includes(sec2Folder));
  });

  test('groups pass their grants to members', async () => {
    const carol = await createUser('carol');
    const g = await admin.json('POST', '/api/groups', { unitId: env.seeded.units.section2, name: 'Sec2 Team' });
    const added = await admin.req('POST', `/api/groups/${g.id}/members`, { userId: carol.id });
    assert.equal(added.statusCode, 204);
    await admin.json('POST', '/api/grants', {
      principalType: 'group',
      principalId: g.id,
      resourceType: 'unit',
      resourceId: env.seeded.units.section2,
      role: 'editor',
    });
    const c = await Client.login(env.app, 'carol', 'password-123');
    const f = await c.json('GET', `/api/folders/${sec2Folder}`);
    assert.equal(f.role, 'editor');
  });

  test('contributors write drafts, viewers only read published', async () => {
    const page = await alice.json('POST', '/api/pages', { folderId: sec1Folder, title: 'Alice plan' });
    await alice.json('PUT', `/api/pages/${page.id}/draft`, { title: 'Alice plan', content: doc('hello'), baseRev: 0 });

    const p = await admin.json('POST', '/api/pages', { folderId: sec2Folder, title: 'Sec2 page' });
    const asBob = await bob.json('GET', `/api/pages/${p.id}`);
    assert.equal(asBob.role, 'viewer');
    assert.equal(asBob.draft, null);
    const write = await bob.req('PUT', `/api/pages/${p.id}/draft`, { title: 'x', content: doc('x'), baseRev: 0 });
    assert.equal(write.statusCode, 403);
  });

  test('contributors cannot manage folders', async () => {
    const res = await alice.req('POST', '/api/folders', { unitId: env.seeded.units.section1, name: 'Nope' });
    assert.equal(res.statusCode, 403);
  });

  test('a page shared directly shows under shared with you', async () => {
    const p = await admin.json('POST', '/api/pages', { folderId: sec2Folder, title: 'Shared with Alice' });
    const me = await alice.json('GET', '/api/me');
    await grant(me.user.id, 'page', p.id, 'viewer');
    const ws = await alice.json('GET', '/api/workspace');
    assert.ok(ws.shared.some((s: any) => s.id === p.id));
    assert.equal((await alice.req('GET', `/api/pages/${p.id}`)).statusCode, 200);
  });
});

describe('drafts and publishing', () => {
  let folderId: string;
  before(async () => {
    folderId = (await admin.json('POST', '/api/folders', { unitId: env.seeded.units.section1, name: 'Publishing' })).id;
  });

  test('saving with a stale revision is refused', async () => {
    const page = await admin.json('POST', '/api/pages', { folderId, title: 'Rev test' });
    await admin.json('PUT', `/api/pages/${page.id}/draft`, { title: 'Rev test', content: doc('one'), baseRev: 0 });
    const stale = await admin.req('PUT', `/api/pages/${page.id}/draft`, { title: 'Rev test', content: doc('two'), baseRev: 0 });
    assert.equal(stale.statusCode, 409);
  });

  test('publish creates numbered, immutable versions', async () => {
    const page = await admin.json('POST', '/api/pages', { folderId, title: 'Runbook' });
    await admin.json('PUT', `/api/pages/${page.id}/draft`, { title: 'Runbook', content: doc('v1'), baseRev: 0 });
    const v1 = await admin.json('POST', `/api/pages/${page.id}/publish`);
    assert.equal(v1.number, 1);
    let p = await admin.json('GET', `/api/pages/${page.id}`);
    assert.equal(p.status, 'published');

    await admin.json('PUT', `/api/pages/${page.id}/draft`, { title: 'Runbook', content: doc('v2 draft'), baseRev: p.draft.rev });
    p = await admin.json('GET', `/api/pages/${page.id}`);
    assert.equal(p.status, 'changed');
    assert.deepEqual(p.published.content, doc('v1'));

    const v2 = await admin.json('POST', `/api/pages/${page.id}/publish`);
    assert.equal(v2.number, 2);
    const versions = await admin.json('GET', `/api/pages/${page.id}/versions`);
    assert.deepEqual(versions.map((v: any) => v.number), [2, 1]);
    const old = await admin.json('GET', `/api/pages/${page.id}/versions/1`);
    assert.deepEqual(old.content, doc('v1'));
  });

  test('a folder that requires approval cannot publish directly yet', async () => {
    const owner = new pg.Client({ connectionString: env.ownerUrl });
    await owner.connect();
    await owner.query(
      `INSERT INTO workflow_settings (org_id, scope_type, scope_id, key, value)
       VALUES ($1, 'folder', $2, 'approval.required', 'true')`,
      [env.seeded.orgId, folderId],
    );
    await owner.end();
    const page = await admin.json('POST', '/api/pages', { folderId, title: 'Needs approval' });
    const res = await admin.req('POST', `/api/pages/${page.id}/publish`);
    assert.equal(res.statusCode, 409);
  });

  test('markdown import arrives as page content', async () => {
    const content = { type: 'doc', content: [{ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Imported' }] }] };
    const page = await admin.json('POST', '/api/pages', { folderId, title: 'Imported', content });
    const p = await admin.json('GET', `/api/pages/${page.id}`);
    assert.deepEqual(p.draft.content, content);
  });
});

describe('tenant isolation', () => {
  test('rows from another organization are invisible even to an org admin', async () => {
    const owner = new pg.Client({ connectionString: env.ownerUrl });
    await owner.connect();
    const other = await owner.query(
      `WITH o AS (INSERT INTO orgs (name, slug) VALUES ('Other', 'other') RETURNING id),
       u AS (INSERT INTO org_units (org_id, type, name, path) SELECT id, 'org', 'Other', 'uother' FROM o RETURNING id, org_id),
       f AS (INSERT INTO folders (org_id, unit_id, name, path) SELECT org_id, id, 'Secret', 'usecret' FROM u RETURNING id, org_id)
       INSERT INTO pages (org_id, folder_id, title) SELECT org_id, id, 'Secret page' FROM f RETURNING id`,
    );
    await owner.end();
    const res = await admin.req('GET', `/api/pages/${other.rows[0].id}`);
    assert.equal(res.statusCode, 404);
    const dir = await admin.json('GET', '/api/directory');
    assert.ok(!dir.units.some((u: any) => u.name === 'Other'));
  });

  test('the app role cannot read password hashes or rewrite the audit log', async () => {
    const app = new pg.Client({ connectionString: env.appUrl });
    await app.connect();
    await assert.rejects(app.query('SELECT password_hash FROM users'), /permission denied/);
    await assert.rejects(app.query('DELETE FROM audit_log'), /permission denied/);
    await app.end();
  });

  test('actions are written to the audit log', async () => {
    const log = await admin.json('GET', '/api/admin/audit?limit=500');
    const actions = new Set(log.map((e: any) => e.action));
    for (const a of ['auth.login', 'unit.create', 'unit.move', 'page.publish', 'grant.set']) {
      assert.ok(actions.has(a), `missing ${a}`);
    }
  });
});

describe('attachments', () => {
  let pageId: string;
  before(async () => {
    const folder = await admin.json('POST', '/api/folders', { unitId: env.seeded.units.section1, name: 'Files' });
    pageId = (await admin.json('POST', '/api/pages', { folderId: folder.id, title: 'With image' })).id;
  });

  test('uploads within the limit and serves the file back', async () => {
    const png = Buffer.from('89504e470d0a1a0a', 'hex');
    const res = await admin.upload(`/api/pages/${pageId}/assets`, 'tiny.png', 'image/png', png);
    assert.equal(res.statusCode, 201, res.body);
    const got = await admin.req('GET', res.json().url);
    assert.equal(got.statusCode, 200);
    assert.equal(got.headers['content-type'], 'image/png');
    assert.deepEqual(got.rawPayload, png);
  });

  test('enforces the admin-set size limit', async () => {
    await admin.json('PUT', '/api/admin/settings', { uploads: { defaultMaxMb: 0.001 } });
    const res = await admin.upload(`/api/pages/${pageId}/assets`, 'big.png', 'image/png', Buffer.alloc(5000));
    assert.equal(res.statusCode, 413);
    await admin.json('PUT', '/api/admin/settings', { uploads: { defaultMaxMb: 25 } });
  });

  test('refuses types the admin has not allowed', async () => {
    const res = await admin.upload(`/api/pages/${pageId}/assets`, 'tool.exe', 'application/x-msdownload', Buffer.alloc(10));
    assert.equal(res.statusCode, 400);
  });
});

describe('branding', () => {
  test('a brand color produces a readable scheme for both modes', async () => {
    const s = await admin.json('PUT', '/api/admin/settings', { branding: { name: 'Acme', brandColor: '#ffcc00' } });
    assert.ok(s.branding.scheme.light.accent);
    assert.ok(s.branding.scheme.dark.accent);
    const me = await admin.json('GET', '/api/me');
    assert.equal(me.org.branding.brandColor, '#ffcc00');
  });
});
