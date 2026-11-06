import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { app, BrowserWindow, dialog, Menu, shell, type MenuItemConstructorOptions } from 'electron';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { buildApp } from '../../api/src/app.js';
import { loadConfig } from '../../api/src/config.js';
import { createPool } from '../../api/src/db.js';
import { migrate } from '../../api/src/migrate.js';
import { EmbeddedPostgres, freePort } from './postgres.js';
import { registerStatic } from './static.js';

// A test build: everything runs on this machine and is stored under the user's config folder.
const SMOKE = process.argv.includes('--smoke');
const PREFERRED_PORT = 47831;

// AppImages cannot ship the SUID helper Chromium's sandbox wants.
if (process.env.APPIMAGE || SMOKE) app.commandLine.appendSwitch('no-sandbox');
if (SMOKE) app.setPath('userData', mkdtempSync(join(tmpdir(), 'notes-smoke-')));

const resources = process.env.NOTES_RESOURCES ?? process.resourcesPath;
const userData = app.getPath('userData');
const dataDir = join(userData, 'data');

interface Settings {
  ownerPassword: string;
  appPassword: string;
  sessionSecret: string;
}

interface Backend {
  postgres: EmbeddedPostgres;
  pool: pg.Pool;
  api: FastifyInstance;
  url: string;
}

let backend: Backend | undefined;
let win: BrowserWindow | undefined;
let quitting = false;

function loadSettings(): Settings {
  const file = join(dataDir, 'settings.json');
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8')) as Settings;
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const s: Settings = {
    ownerPassword: randomBytes(24).toString('hex'),
    appPassword: randomBytes(24).toString('hex'),
    sessionSecret: randomBytes(32).toString('hex'),
  };
  writeFileSync(file, JSON.stringify(s), { mode: 0o600 });
  return s;
}

async function startBackend(): Promise<Backend> {
  const settings = loadSettings();
  const postgres = new EmbeddedPostgres(
    join(resources, 'pg'),
    join(dataDir, 'pgdata'),
    settings.ownerPassword,
    join(dataDir, 'postgres.log'),
  );
  await postgres.start();

  await migrate(postgres.ownerUrl, settings.appPassword, () => {}, join(resources, 'migrations'));

  // No organization yet? The window opens on a setup screen where the first
  // person names the organization and creates their own admin account.
  const appUrl = `postgres://notes_app:${settings.appPassword}@127.0.0.1:${postgres.port}/notes`;
  const assets = join(dataDir, 'assets');
  mkdirSync(assets, { recursive: true });
  const config = loadConfig({
    appDatabaseUrl: appUrl,
    ownerDatabaseUrl: postgres.ownerUrl,
    sessionSecret: settings.sessionSecret,
    storageDir: assets,
    cookieSecure: false,
    logLevel: 'warn',
    firstRunSetup: true,
  });
  const pool = createPool(config.appDatabaseUrl);
  const api = await buildApp({ config, pool });
  registerStatic(api, join(resources, 'web'));

  // Keep the same port between runs so the browser's saved theme settings carry over.
  let port = PREFERRED_PORT;
  try {
    await api.listen({ host: '127.0.0.1', port });
  } catch {
    port = await freePort();
    await api.listen({ host: '127.0.0.1', port });
  }
  return { postgres, pool, api, url: `http://127.0.0.1:${port}` };
}

async function stopBackend(): Promise<void> {
  const b = backend;
  backend = undefined;
  if (!b) return;
  await b.api.close().catch(() => {});
  await b.pool.end().catch(() => {});
  await b.postgres.stop();
}

async function smokeTest(b: Backend): Promise<void> {
  const fail = (msg: string): never => {
    throw new Error(msg);
  };
  const health = await fetch(`${b.url}/api/health`);
  if (!health.ok) fail(`health check returned ${health.status}`);

  const index = await (await fetch(`${b.url}/`)).text();
  if (!index.includes('id="root"')) fail('the web app is not being served');
  const spa = await fetch(`${b.url}/some/client/route`);
  if (!spa.ok) fail('client-side routes do not fall back to the web app');

  const bad = await fetch(`${b.url}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'wrong' }),
  });
  if (bad.status !== 401) fail(`a wrong password returned ${bad.status}, expected 401`);

  // A fresh workspace asks for setup, and setup creates the admin and signs them in.
  const status = (await (await fetch(`${b.url}/api/setup`)).json()) as { needed: boolean };
  if (!status.needed) fail('a fresh workspace did not ask for first-run setup');
  const account = { orgName: 'Smoke Test Org', displayName: 'Smoke Admin', username: 'smoke-admin', password: 'smoke-test-password' };
  const created = await fetch(`${b.url}/api/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(account),
  });
  if (!created.ok) fail(`setup returned ${created.status}: ${await created.text()}`);
  const again = await fetch(`${b.url}/api/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...account, username: 'second-admin' }),
  });
  if (again.status !== 409) fail(`a second setup returned ${again.status}, expected 409`);

  const login = await fetch(`${b.url}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: account.username, password: account.password }),
  });
  if (!login.ok) fail(`sign-in returned ${login.status}: ${await login.text()}`);
  const cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');

  const me = await fetch(`${b.url}/api/me`, { headers: { Cookie: cookie } });
  if (!me.ok) fail(`/api/me returned ${me.status}: ${await me.text()}`);
  const who = (await me.json()) as { user: { is_org_admin: boolean } };
  if (!who.user.is_org_admin) fail('the account made at setup is not an admin');
  const anon = await fetch(`${b.url}/api/me`);
  if (anon.status !== 401) fail(`/api/me without a session returned ${anon.status}, expected 401`);
}

function showWindow(): BrowserWindow {
  const w = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0f1115',
    title: 'Thoughtwell (test build)',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  w.webContents.setWindowOpenHandler(({ url: target }) => {
    if (/^https?:/.test(target)) void shell.openExternal(target);
    return { action: 'deny' };
  });
  w.webContents.on('will-navigate', (e, target) => {
    if (new URL(target).hostname !== '127.0.0.1') {
      e.preventDefault();
      if (/^https?:/.test(target)) void shell.openExternal(target);
    }
  });
  const splash = '<body style="margin:0;display:grid;place-items:center;height:100vh;background:#0f1115;color:#9aa4b2;font:15px system-ui">Starting the local database…</body>';
  void w.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(splash)}`);
  return w;
}

async function resetData(): Promise<void> {
  const answer = await dialog.showMessageBox({
    type: 'warning',
    buttons: ['Cancel', 'Delete everything and restart'],
    defaultId: 0,
    cancelId: 0,
    message: 'Delete all test data?',
    detail: 'This removes the local database and uploaded files, then starts fresh and asks you to create a new admin account. It cannot be undone.',
  });
  if (answer.response !== 1) return;
  quitting = true;
  await stopBackend();
  await rm(dataDir, { recursive: true, force: true });
  app.relaunch({ execPath: process.env.APPIMAGE ?? process.execPath, args: [] });
  app.exit(0);
}

function buildMenu(): void {
  const template: MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        { label: 'Open data folder', click: () => void shell.openPath(dataDir) },
        { label: 'Reset test data…', click: () => void resetData() },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' }],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function main(): Promise<void> {
  if (!SMOKE && !app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', (e) => {
    if (quitting) return;
    quitting = true;
    e.preventDefault();
    void stopBackend().finally(() => app.exit(0));
  });

  await app.whenReady();
  buildMenu();

  if (!SMOKE) win = showWindow();
  try {
    backend = await startBackend();
  } catch (err) {
    const message = (err as Error).message;
    console.error(message);
    if (SMOKE) {
      console.error('SMOKE FAILED');
      app.exit(1);
      return;
    }
    dialog.showErrorBox('Thoughtwell could not start', message);
    app.exit(1);
    return;
  }

  if (SMOKE) {
    try {
      await smokeTest(backend);
      console.log('SMOKE OK');
      quitting = true;
      await stopBackend();
      app.exit(0);
    } catch (err) {
      console.error(`SMOKE FAILED: ${(err as Error).message}`);
      quitting = true;
      await stopBackend();
      app.exit(1);
    }
    return;
  }

  const b = backend;
  await win!.loadURL(b.url);
  win!.setTitle('Thoughtwell (test build)');
}

main().catch((err) => {
  console.error(err);
  dialog.showErrorBox('Thoughtwell could not start', (err as Error).message);
  app.exit(1);
});
