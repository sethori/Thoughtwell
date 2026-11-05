import { expect, test } from '@playwright/test';

const username = process.env.E2E_USERNAME ?? 'seth';
const password = process.env.E2E_PASSWORD ?? 'change-me-admin';

test('sign in, write a page, publish it and switch theme', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();

  // Create a page in the seeded "Notes" folder via its right-click menu.
  // The folder row (the rail also has a Notes button).
  const folder = page.locator('button[aria-expanded]', { hasText: 'Notes' }).first();
  await folder.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'New page' }).click();
  const title = `E2E page ${Date.now()}`;
  await page.getByLabel('Title').fill(title);
  await page.getByRole('button', { name: 'Create' }).click();

  const editor = page.getByLabel('Page content');
  await editor.click();
  await page.keyboard.type('Written by the end-to-end test.');
  await expect(page.getByText('Saved', { exact: true })).toBeVisible({ timeout: 10_000 });

  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.getByText(/Published version 1/)).toBeVisible();

  // The tools panel inserts a table.
  await editor.click();
  await page.getByRole('button', { name: 'Table', exact: true }).click();
  await expect(editor.locator('table')).toBeVisible();

  // Formulas: the Sum button totals the column above, and typed formulas work too.
  const cells = editor.locator('table td');
  await cells.nth(0).click();
  await page.keyboard.type('2');
  await cells.nth(3).click();
  await page.keyboard.type('3');
  await page.getByRole('button', { name: 'Add row' }).click();
  await cells.nth(6).click();
  await page.getByRole('button', { name: 'Sum the cells above' }).click();
  await expect(cells.nth(6)).toContainText('=SUM(A2:A3)');
  await cells.nth(7).click();
  await page.keyboard.type('=A4 * 2');
  await cells.nth(8).click();
  await expect(cells.nth(6)).toHaveAttribute('data-result', '5');
  await expect(cells.nth(7)).toHaveAttribute('data-result', '10');

  // Appearance follows the person's settings.
  await page.getByRole('button', { name: 'Settings and appearance' }).click();
  await page.getByRole('button', { name: 'Light' }).click();
  await page.getByRole('button', { name: 'Compact' }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-mode', 'light');
  await expect(page.locator('html')).toHaveAttribute('data-density', 'compact');
});

test('the org directory shows the tree for everyone', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('tab', { name: 'Org directory' }).click();
  await expect(page.getByText('Directorate 1')).toBeVisible();
});
