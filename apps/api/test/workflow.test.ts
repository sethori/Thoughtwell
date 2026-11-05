import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import WebSocket from 'ws';
import * as Y from 'yjs';
import { Client, doc, setup, type TestEnv } from './helpers.js';
import { yDocToJson } from '../src/collab/ydoc.js';

let env: TestEnv;
let admin: Client;
let folderId: string;
const users: Record<string, { id: string; client: Client }> = {};

async function createUser(username: string, role: string, extra: Record<string, unknown> = {}) {
  const u = await admin.json('POST', '/api/admin/users', {
    username,
    displayName: username,
    password: 'password-123',
    email: `${username}@example.test`,
    ...extra,
  });
  await admin.json('POST', '/api/grants', { principalType: 'user', principalId: u.id, resourceType: 'folder', resourceId: folderId, role });
  users[username] = { id: u.id, client: await Client.login(env.app, username, 'password-123') };
  return users[username]!;
}

before(async () => {
  env = await setup();
  admin = await Client.login(env.app, 'admin', 'admin-password');
  folderId = (await admin.json('POST', '/api/folders', { unitId: env.seeded.units.section1, name: 'Reviewed docs' })).id;
  await createUser('writer', 'contributor');
  await createUser('checker', 'approver');
  await createUser('watcher', 'viewer');
});
after(async () => {
  await env?.close();
});

describe('review settings', () => {
  test('settings inherit down the tree and the nearest one wins', async () => {
    await admin.json('PUT', `/api/workflow/unit/${env.seeded.units.divA}`, { key: 'approval.required', value: true });
    let s = await admin.json('GET', `/api/workflow/folder/${folderId}`);
    assert.equal(s.effective['approval.required'], true);
    assert.deepEqual(s.own, {});

    await admin.json('PUT', `/api/workflow/folder/${folderId}`, { key: 'approval.required', value: false });
    s = await admin.json('GET', `/api/workflow/folder/${folderId}`);
    assert.equal(s.effective['approval.required'], false);

    // Clearing the folder's own value inherits again.
    await admin.json('PUT', `/api/workflow/folder/${folderId}`, { key: 'approval.required', value: null });
    s = await admin.json('GET', `/api/workflow/folder/${folderId}`);
    assert.equal(s.effective['approval.required'], true);
  });

  test('only admins of the area change its settings', async () => {
    const res = await users.checker!.client.req('PUT', `/api/workflow/folder/${folderId}`, { key: 'approval.required', value: false });
    assert.equal(res.statusCode, 403);
    const s = await users.checker!.client.json('GET', `/api/workflow/folder/${folderId}`);
    assert.equal(s.canEdit, false);
  });
});

describe('review flow', () => {
  let pageId: string;
  let reviewId: string;

  before(async () => {
    await users.watcher!.client.json('PUT', '/api/watches', { scopeType: 'folder', scopeId: folderId, events: ['published'] });
    const p = await users.writer!.client.json('POST', '/api/pages', { folderId, title: 'Budget' });
    pageId = p.id;
    await users.writer!.client.json('PUT', `/api/pages/${pageId}/draft`, { title: 'Budget', content: doc('Spend 100'), baseRev: 0 });
  });

  test('a contributor cannot publish where approval is required', async () => {
    const page = await users.writer!.client.json('GET', `/api/pages/${pageId}`);
    assert.equal(page.policy.approvalRequired, true);
    assert.equal(page.policy.canPublishDirectly, false);
    const res = await users.writer!.client.req('POST', `/api/pages/${pageId}/publish`);
    assert.equal(res.statusCode, 409);
  });

  test('submitting notifies approvers and shows in their inbox', async () => {
    const r = await users.writer!.client.json('POST', `/api/pages/${pageId}/reviews`, { note: 'First budget' });
    reviewId = r.id;
    const dup = await users.writer!.client.req('POST', `/api/pages/${pageId}/reviews`, {});
    assert.equal(dup.statusCode, 409, 'one open review at a time');

    const inbox = await users.checker!.client.json('GET', '/api/reviews?scope=inbox');
    assert.ok(inbox.some((x: any) => x.id === reviewId && x.latest_note === 'First budget'));
    const writerInbox = await users.writer!.client.json('GET', '/api/reviews?scope=inbox');
    assert.ok(!writerInbox.some((x: any) => x.id === reviewId), 'contributors do not review');
    const mine = await users.writer!.client.json('GET', '/api/reviews?scope=mine');
    assert.ok(mine.some((x: any) => x.id === reviewId));

    const n = await users.checker!.client.json('GET', '/api/notifications');
    assert.equal(n.unread, 1);
    assert.equal(n.items[0].type, 'review.submitted');
    assert.match(n.items[0].title, /Review requested/);
  });

  test('approvers record per-change decisions; contributors cannot', async () => {
    const d = await users.checker!.client.json('PUT', `/api/reviews/${reviewId}/decisions`, { key: 'abc', decision: 'accepted' });
    assert.deepEqual(d.decisions, { abc: 'accepted' });
    const cleared = await users.checker!.client.json('PUT', `/api/reviews/${reviewId}/decisions`, { key: 'abc', decision: null });
    assert.deepEqual(cleared.decisions, {});
    const res = await users.writer!.client.req('PUT', `/api/reviews/${reviewId}/decisions`, { key: 'abc', decision: 'rejected' });
    assert.equal(res.statusCode, 403);
  });

  test('sending back needs a note, closes the review and tells the writer', async () => {
    const empty = await users.checker!.client.req('POST', `/api/reviews/${reviewId}/send-back`, { note: '' });
    assert.equal(empty.statusCode, 400);
    await users.checker!.client.json('POST', `/api/reviews/${reviewId}/send-back`, { note: 'Add the totals' });
    const page = await users.writer!.client.json('GET', `/api/pages/${pageId}`);
    assert.equal(page.review.status, 'sent_back');
    const n = await users.writer!.client.json('GET', '/api/notifications');
    assert.equal(n.items[0].type, 'review.sent_back');
    assert.match(n.items[0].body, /Add the totals/);
    const r = await users.writer!.client.json('GET', `/api/reviews/${reviewId}`);
    assert.deepEqual(
      r.notes.map((x: any) => x.kind),
      ['submit', 'send_back'],
    );
  });

  test('approving publishes the draft and tells the writer and watchers', async () => {
    await users.writer!.client.json('PUT', `/api/pages/${pageId}/draft`, {
      title: 'Budget',
      content: doc('Spend 100, total 100'),
      baseRev: (await users.writer!.client.json('GET', `/api/pages/${pageId}`)).draft.rev,
    });
    const r = await users.writer!.client.json('POST', `/api/pages/${pageId}/reviews`, { note: 'Totals added' });
    assert.equal((await users.writer!.client.json('GET', `/api/reviews/${r.id}`)).round, 2);
    const v = await users.checker!.client.json('POST', `/api/reviews/${r.id}/approve`, { note: 'Looks right' });
    assert.equal(v.number, 1);

    const page = await users.watcher!.client.json('GET', `/api/pages/${pageId}`);
    assert.deepEqual(page.published.content, doc('Spend 100, total 100'));
    const versions = await users.watcher!.client.json('GET', `/api/pages/${pageId}/versions`);
    assert.equal(versions.length, 1);

    const writerN = await users.writer!.client.json('GET', '/api/notifications');
    assert.equal(writerN.items[0].type, 'review.approved');
    const watcherN = await users.watcher!.client.json('GET', '/api/notifications');
    assert.equal(watcherN.items[0].type, 'page.published');
    assert.match(watcherN.items[0].body, /version 1/);

    const again = await users.checker!.client.req('POST', `/api/reviews/${r.id}/approve`, {});
    assert.equal(again.statusCode, 409, 'a closed review cannot be approved twice');
  });

  test('approvers cannot approve their own work unless self-approval is on', async () => {
    const p = await users.checker!.client.json('POST', '/api/pages', { folderId, title: 'Mine' });
    assert.equal((await users.checker!.client.req('POST', `/api/pages/${p.id}/publish`)).statusCode, 409);
    const r = await users.checker!.client.json('POST', `/api/pages/${p.id}/reviews`, {});
    assert.equal((await users.checker!.client.req('POST', `/api/reviews/${r.id}/approve`, {})).statusCode, 403);

    // An org admin allows it for this person (the one-person-folder case).
    await admin.json('PATCH', `/api/admin/users/${users.checker!.id}`, { canSelfApprove: true });
    const page = await users.checker!.client.json('GET', `/api/pages/${p.id}`);
    assert.equal(page.policy.canPublishDirectly, true);
    const v = await users.checker!.client.json('POST', `/api/reviews/${r.id}/approve`, {});
    assert.equal(v.number, 1);
    await admin.json('PATCH', `/api/admin/users/${users.checker!.id}`, { canSelfApprove: false });
  });

  test('the folder setting allows self-approval for everyone who approves there', async () => {
    await admin.json('PUT', `/api/workflow/folder/${folderId}`, { key: 'approval.allow_self', value: true });
    const p = await users.checker!.client.json('POST', '/api/pages', { folderId, title: 'Solo' });
    const v = await users.checker!.client.json('POST', `/api/pages/${p.id}/publish`);
    assert.equal(v.number, 1);
    await admin.json('PUT', `/api/workflow/folder/${folderId}`, { key: 'approval.allow_self', value: null });
  });

  test('the writer can withdraw; others cannot', async () => {
    const r = await users.writer!.client.json('POST', `/api/pages/${pageId}/reviews`, {});
    assert.equal((await users.checker!.client.req('POST', `/api/reviews/${r.id}/withdraw`)).statusCode, 403);
    await users.writer!.client.json('POST', `/api/reviews/${r.id}/withdraw`);
    assert.equal((await users.writer!.client.json('GET', `/api/reviews/${r.id}`)).status, 'withdrawn');
  });

  test('marking notifications read', async () => {
    const c = users.watcher!.client;
    assert.ok((await c.json('GET', '/api/notifications/unread')).unread > 0);
    await c.json('POST', '/api/notifications/read', {});
    assert.equal((await c.json('GET', '/api/notifications/unread')).unread, 0);
  });
});

describe('email and Teams delivery', () => {
  test('admins set up delivery; the password is never shown or logged', async () => {
    const s = await admin.json('PUT', '/api/admin/settings', {
      notifications: {
        email: { enabled: true, host: 'smtp.example.test', port: 587, secure: false, username: 'mailer', password: 's3cret-pass', from: 'notes@example.test' },
        teams: { enabled: true, webhookUrl: 'https://prod.example.test/workflows/abc' },
      },
    });
    assert.equal(s.notifications.email.passwordSet, true);
    assert.equal(JSON.stringify(s).includes('s3cret-pass'), false);
    // Saving other fields keeps the password.
    const again = await admin.json('PUT', '/api/admin/settings', { notifications: { email: { port: 2525 } } });
    assert.equal(again.notifications.email.passwordSet, true);
    const audit = await admin.json('GET', '/api/admin/audit');
    assert.equal(JSON.stringify(audit).includes('s3cret-pass'), false);
    const me = await users.writer!.client.json('GET', '/api/me');
    assert.deepEqual(me.org.channels, { email: true, teams: true });
  });

  test('messages go out by the channels each person chose', async () => {
    await users.watcher!.client.json('PATCH', '/api/me/preferences', { notify: { email: true, teams: true } });
    await users.writer!.client.json('PATCH', '/api/me/preferences', { notify: { email: false, teams: false } });
    env.sent.length = 0;
    const p = await users.writer!.client.json('POST', '/api/pages', { folderId, title: 'Delivered' });
    const r = await users.writer!.client.json('POST', `/api/pages/${p.id}/reviews`, {});
    await users.checker!.client.json('POST', `/api/reviews/${r.id}/approve`, {});
    await env.dispatcher.run(env.seeded.orgId);

    const to = (who: string) => env.sent.filter((s) => s.message.to === `${who}@example.test`).map((s) => s.channel).sort();
    assert.deepEqual(to('watcher'), ['email', 'teams']);
    assert.deepEqual(to('writer'), [], 'opted out of both');
    assert.deepEqual(to('checker'), ['email'], 'defaults: email on, Teams off');
    const msg = env.sent.find((s) => s.message.to === 'watcher@example.test')!.message;
    assert.equal(msg.url, `https://notes.test/?page=${p.id}`);
    assert.match(msg.subject, /Published: “Delivered”/);

    // Delivered once only.
    const count = env.sent.length;
    await env.dispatcher.run(env.seeded.orgId);
    assert.equal(env.sent.length, count);
  });
});

describe('live co-editing', () => {
  let base: string;
  let pageId: string;

  before(async () => {
    const address = await env.app.listen({ port: 0, host: '127.0.0.1' });
    base = address.replace('http', 'ws');
    const p = await users.writer!.client.json('POST', '/api/pages', { folderId, title: 'Live page' });
    pageId = p.id;
    await users.writer!.client.json('PUT', `/api/pages/${pageId}/draft`, { title: 'Live page', content: doc('Start'), baseRev: 0 });
  });

  function connect(cookie: string, origin = base.replace('ws', 'http')) {
    class WS extends WebSocket {
      constructor(u: string, p?: string | string[]) {
        super(u, p, { headers: { cookie, origin } });
      }
    }
    const ydoc = new Y.Doc();
    let failed = false;
    const ws = new HocuspocusProviderWebsocket({ url: `${base}/api/collab`, WebSocketPolyfill: WS as never });
    const provider = new HocuspocusProvider({
      websocketProvider: ws,
      name: `page.${pageId}`,
      token: 'session',
      document: ydoc,
      onAuthenticationFailed: () => {
        failed = true;
      },
    });
    const synced = new Promise<void>((resolve) => provider.on('synced', () => resolve()));
    return {
      ydoc,
      synced,
      failed: () => failed,
      close() {
        provider.destroy();
        ws.destroy();
      },
    };
  }
  const until = async (cond: () => boolean, ms = 8000) => {
    const end = Date.now() + ms;
    while (!cond()) {
      if (Date.now() > end) throw new Error('timed out');
      await new Promise((r) => setTimeout(r, 25));
    }
  };

  test('two people edit the same draft and the result is what gets published', async () => {
    const a = connect(users.writer!.client.cookie);
    const b = connect(users.checker!.client.cookie);
    await Promise.all([a.synced, b.synced]);
    assert.deepEqual(yDocToJson(a.ydoc), doc('Start'));

    const frag = a.ydoc.getXmlFragment('default');
    a.ydoc.transact(() => {
      const p = new Y.XmlElement('paragraph');
      frag.insert(frag.length, [p]);
      const t = new Y.XmlText();
      p.insert(0, [t]);
      t.insert(0, 'Added live');
    });
    await until(() => JSON.stringify(yDocToJson(b.ydoc)).includes('Added live'));

    // Approving publishes the latest live state, without waiting for the save delay.
    const r = await users.writer!.client.json('POST', `/api/pages/${pageId}/reviews`, {});
    const v = await users.checker!.client.json('POST', `/api/reviews/${r.id}/approve`, {});
    const page = await users.writer!.client.json('GET', `/api/pages/${pageId}`);
    assert.equal(page.published.number, v.number);
    assert.ok(JSON.stringify(page.published.content).includes('Added live'));

    // A REST save while people are editing reaches them live.
    await users.writer!.client.json('PUT', `/api/pages/${pageId}/draft`, { title: 'Live page', content: doc('Replaced'), baseRev: page.draft.rev });
    await until(() => JSON.stringify(yDocToJson(a.ydoc)) === JSON.stringify(doc('Replaced')));
    a.close();
    b.close();
  });

  test('viewers, strangers and other sites are refused', async () => {
    const viewer = connect(users.watcher!.client.cookie);
    const nobody = connect('');
    const other = connect(users.writer!.client.cookie, 'https://evil.example');
    await until(() => viewer.failed() && nobody.failed() && other.failed());
    for (const c of [viewer, nobody, other]) {
      assert.deepEqual(yDocToJson(c.ydoc).content, []);
      c.close();
    }
  });
});
