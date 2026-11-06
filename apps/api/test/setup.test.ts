import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Client, setup, type TestEnv } from './helpers.js';

describe('first-run setup (desktop build)', () => {
  let env: TestEnv;
  before(async () => {
    env = await setup({ empty: true });
  });
  after(async () => {
    await env.close();
  });

  test('asks for setup while there is no organization', async () => {
    const res = await env.app.inject({ method: 'GET', url: '/api/setup' });
    assert.deepEqual(res.json(), { needed: true });
  });

  test('rejects a short password', async () => {
    const res = await env.app.inject({
      method: 'POST',
      url: '/api/setup',
      payload: { orgName: 'Lab', displayName: 'Seth', username: 'seth', password: 'short' },
    });
    assert.equal(res.statusCode, 400);
    assert.match(res.json().message, /8 characters/);
  });

  test('creates the organization and a full admin, and signs them in', async () => {
    const res = await env.app.inject({
      method: 'POST',
      url: '/api/setup',
      payload: { orgName: 'Lab', displayName: 'Seth', username: 'seth', password: 'a-good-password' },
    });
    assert.equal(res.statusCode, 200, res.body);
    const set = res.headers['set-cookie'];
    const cookie = (Array.isArray(set) ? set[0]! : String(set)).split(';')[0]!;
    const me = await new Client(env.app, cookie).json('GET', '/api/me');
    assert.equal(me.user.display_name, 'Seth');
    assert.equal(me.user.is_org_admin, true);

    // The account works for normal sign-in too.
    const again = await Client.login(env.app, 'seth', 'a-good-password');
    const dir = await again.json('GET', '/api/directory');
    assert.ok(dir.units.some((u: any) => u.type === 'org' && u.name === 'Lab'));
  });

  test('cannot be run a second time', async () => {
    const status = await env.app.inject({ method: 'GET', url: '/api/setup' });
    assert.deepEqual(status.json(), { needed: false });
    const res = await env.app.inject({
      method: 'POST',
      url: '/api/setup',
      payload: { orgName: 'Takeover', displayName: 'Someone', username: 'someone', password: 'another-password' },
    });
    assert.equal(res.statusCode, 409);
  });
});

describe('first-run setup on a server', () => {
  let env: TestEnv;
  before(async () => {
    env = await setup();
  });
  after(async () => {
    await env.close();
  });

  test('is off unless turned on', async () => {
    const status = await env.app.inject({ method: 'GET', url: '/api/setup' });
    assert.deepEqual(status.json(), { needed: false });
    const res = await env.app.inject({
      method: 'POST',
      url: '/api/setup',
      payload: { displayName: 'Someone', username: 'someone', password: 'another-password' },
    });
    assert.equal(res.statusCode, 404);
  });
});
