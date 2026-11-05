import { expect, test, type Browser, type Page } from '@playwright/test';

const username = process.env.E2E_USERNAME ?? 'seth';
const password = process.env.E2E_PASSWORD ?? 'change-me-admin';

async function signIn(browser: Browser, user: string, pass: string, path = '/'): Promise<Page> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(path);
  await page.getByLabel('Username').fill(user);
  await page.getByLabel('Password').fill(pass);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
  return page;
}

test('two people edit live; a review marks changes inline and publishes on approval', async ({ browser }) => {
  test.setTimeout(90_000);
  const admin = await signIn(browser, username, password);
  const api = admin.request;

  // A writer with contributor access to a folder that requires approval.
  const stamp = Date.now();
  const ws = await (await api.get('/api/workspace')).json();
  const unitId: string = ws.units[0].id;
  const folder = await (await api.post('/api/folders', { data: { unitId, name: `Reviewed ${stamp}` } })).json();
  const writer = await (
    await api.post('/api/admin/users', { data: { username: `writer${stamp}`, displayName: 'Wendy Writer', password: 'password-123' } })
  ).json();
  await api.post('/api/grants', { data: { principalType: 'user', principalId: writer.id, resourceType: 'folder', resourceId: folder.id, role: 'contributor' } });
  const page = await (await api.post('/api/pages', { data: { folderId: folder.id, title: 'Budget' } })).json();
  await api.put(`/api/pages/${page.id}/draft`, {
    data: { title: 'Budget', baseRev: 0, content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Spend 100.' }] }] } },
  });
  expect((await api.post(`/api/pages/${page.id}/publish`)).ok()).toBeTruthy();
  await api.put(`/api/workflow/folder/${folder.id}`, { data: { key: 'approval.required', value: true } });

  // Both open the page; each sees the other.
  await admin.goto(`/?page=${page.id}`);
  const w = await signIn(browser, `writer${stamp}`, 'password-123', `/?page=${page.id}`);
  await expect(w.getByText('Saved', { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(admin.locator('.presence .av')).toHaveCount(2, { timeout: 10_000 });

  // The writer adds a line; the admin sees it appear.
  const editor = w.getByLabel('Page content');
  await editor.click();
  await w.keyboard.press('Control+End');
  await w.keyboard.press('Enter');
  await w.keyboard.type('Also hire a designer.');
  await expect(admin.getByLabel('Page content')).toContainText('Also hire a designer.', { timeout: 10_000 });

  // The writer cannot publish here, only submit.
  await expect(w.getByRole('button', { name: 'Publish', exact: true })).toHaveCount(0);
  await w.getByRole('button', { name: 'Submit for review' }).first().click();
  await w.getByLabel('Note for the reviewer (optional)').fill('Please check the new line');
  await w.getByRole('button', { name: 'Submit', exact: true }).click();
  await expect(w.getByText('In review')).toBeVisible();

  // The approver opens it from the inbox and sees the change marked up.
  await admin.getByRole('button', { name: 'Review inbox' }).click();
  await admin.getByRole('dialog').getByRole('button', { name: /Budget/ }).first().click();
  const change = admin.locator('.change', { hasText: 'Also hire a designer.' });
  await expect(change).toBeVisible();
  await expect(admin.locator('.ProseMirror .chg-add')).toHaveCount(1);

  await change.getByRole('button', { name: 'Accept' }).click();
  await admin.getByRole('button', { name: 'Publish accepted changes' }).click();
  await admin.getByRole('button', { name: 'Approve and publish' }).click();
  await expect(admin.getByText(/Approved and published version 2/)).toBeVisible();

  const after = await (await api.get(`/api/pages/${page.id}`)).json();
  expect(JSON.stringify(after.published.content)).toContain('Also hire a designer.');
});
