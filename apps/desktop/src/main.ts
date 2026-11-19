import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, shell, type MenuItemConstructorOptions } from 'electron';
import { AREA_DIR, BRAIN_DIRS } from '@notes/shared';
import { VaultError, VaultService } from '@notes/vault';
import { CALLS, type Bridge, type Call, type Reply } from './bridge';
import { handleApp, handleVault, registerSchemes } from './protocols';

// --smoke: start on a throwaway vault, check the app end to end, print SMOKE OK and exit.
const SMOKE = process.argv.includes('--smoke');
const DEV_URL = process.env.THOUGHTWELL_DEV_URL;
const here = dirname(fileURLToPath(import.meta.url));

// AppImages cannot ship the SUID helper Chromium's sandbox wants.
if (process.env.APPIMAGE || SMOKE) app.commandLine.appendSwitch('no-sandbox');
if (SMOKE) app.setPath('userData', mkdtempSync(join(tmpdir(), 'thoughtwell-smoke-')));

registerSchemes();

const resources = process.env.THOUGHTWELL_RESOURCES ?? process.resourcesPath;
const settingsFile = () => join(app.getPath('userData'), 'settings.json');

interface Settings {
  vaultPath?: string;
}

function loadSettings(): Settings {
  try {
    return JSON.parse(readFileSync(settingsFile(), 'utf8')) as Settings;
  } catch {
    return {};
  }
}

function saveSettings(s: Settings): void {
  mkdirSync(dirname(settingsFile()), { recursive: true });
  writeFileSync(settingsFile(), JSON.stringify(s, null, 2));
}

let service: VaultService | null = null;
let win: BrowserWindow | null = null;
let unwatch: (() => void) | null = null;

/** A folder is fine for a vault if it is empty, missing, or already looks like one. */
function looksUsable(dir: string): boolean {
  if (!existsSync(dir)) return true;
  const names = readdirSync(dir).filter((n) => !n.startsWith('.'));
  return names.length === 0 || (names.includes(AREA_DIR.me) && names.includes(AREA_DIR.brain));
}

async function askForVault(parent: BrowserWindow | null, firstRun: boolean): Promise<string | null> {
  const suggested = join(homedir(), 'Thoughtwell');
  if (firstRun) {
    const r = await dialog.showMessageBox({
      type: 'question',
      buttons: [`Use ${suggested}`, 'Choose another folder…', 'Quit'],
      defaultId: 0,
      cancelId: 2,
      message: 'Where should Thoughtwell keep your notes?',
      detail:
        'Your notes are ordinary Markdown files in a folder on this computer. Thoughtwell adds Me/ for your notes and Brain/ for your AI agents. ' +
        'You can point agents, backup tools or sync tools at the same folder.',
    });
    if (r.response === 2) return null;
    if (r.response === 0) {
      if (looksUsable(suggested)) return suggested;
      await dialog.showMessageBox({ type: 'info', message: `${suggested} already has other files in it.`, detail: 'Choose an empty folder or an existing Thoughtwell vault.' });
    }
  }
  for (;;) {
    const opts: Electron.OpenDialogOptions = {
      title: 'Choose a vault folder',
      buttonLabel: 'Use this folder',
      defaultPath: homedir(),
      properties: ['openDirectory', 'createDirectory'],
    };
    const picked = parent ? await dialog.showOpenDialog(parent, opts) : await dialog.showOpenDialog(opts);
    const dir = picked.canceled ? undefined : picked.filePaths[0];
    if (!dir) return null;
    if (looksUsable(dir)) return dir;
    const r = await dialog.showMessageBox({
      type: 'warning',
      buttons: ['Choose again', 'Use it anyway'],
      defaultId: 0,
      cancelId: 0,
      message: 'That folder already has other files in it.',
      detail: 'Thoughtwell will add Me/, Brain/ and AGENTS.md next to them, and show everything else in it too. It never deletes or changes your existing files.',
    });
    if (r.response === 1) return dir;
  }
}

async function openVault(dir: string): Promise<void> {
  unwatch?.();
  await service?.close();
  service = await VaultService.open(dir, { watch: true });
  unwatch = service.onChange((e) => win?.webContents.send('tw:changed', e.paths));
}

function vault(): VaultService {
  if (!service) throw new VaultError('not_found', 'No vault is open');
  return service;
}

// ---------------------------------------------------------------- calls from the web app

const handlers: { [K in Call]: (...args: Parameters<Bridge[K]>) => ReturnType<Bridge[K]> | Awaited<ReturnType<Bridge[K]>> } = {
  info: () => ({ root: vault().root, version: app.getVersion(), appData: app.getPath('userData') }),
  list: () => vault().vault.list(),
  read: (path) => vault().vault.read(path),
  async write(path, content, expectedMtime) {
    const r = await vault().vault.write(path, content, { expectedMtime });
    await vault().touched(path);
    return r;
  },
  async createNote(dir, title, body) {
    const p = await vault().vault.createNote(dir, title, body);
    await vault().touched(p);
    return p;
  },
  createFolder: (dir, name) => vault().vault.createFolder(dir, name),
  async move(from, to) {
    const p = await vault().vault.move(from, to);
    vault().index.removeUnder(from);
    await vault().touched(p);
    return p;
  },
  async trash(path) {
    const abs = vault().vault.checkDeletable(path);
    await shell.trashItem(abs);
    vault().index.removeUnder(path);
  },
  async saveAttachment(notePath, fileName, bytes) {
    const r = await vault().vault.saveAttachment(notePath, fileName, bytes);
    await vault().touched(r.path);
    return r;
  },
  async importPaths(absPaths, destDir) {
    const out = await vault().vault.importPaths(absPaths, destDir);
    await vault().touched(...out);
    return out;
  },
  async pickAndImport(destDir) {
    const opts: Electron.OpenDialogOptions = { title: 'Add files to your Brain inbox', buttonLabel: 'Add', properties: ['openFile', 'multiSelections'] };
    const picked = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    if (picked.canceled) return [];
    return handlers.importPaths(picked.filePaths, destDir ?? BRAIN_DIRS.inbox);
  },
  search: (q, area) => vault().index.search(q, { area, limit: 50 }),
  related: (input, area) => vault().index.related(input, { area: area ?? 'brain', limit: 12 }),
  backlinks: (path) => vault().index.backlinks(path),
  resolveLink: (target, from) => vault().index.resolveLink(target, from),
  tags: (area) => vault().index.tags(area),
  async reveal(path) {
    shell.showItemInFolder(vault().vault.resolve(path));
  },
  async openWithDefaultApp(path) {
    const err = await shell.openPath(vault().vault.resolve(path));
    if (err) throw new VaultError('invalid', err);
  },
  async openUrl(url) {
    if (!/^(https?|mailto):/i.test(url)) throw new VaultError('invalid', 'Only web and mail links open outside the app');
    await shell.openExternal(url);
  },
  async chooseVault() {
    const dir = await askForVault(win, false);
    if (!dir) return;
    await openVault(dir);
    saveSettings({ ...loadSettings(), vaultPath: dir });
    win?.webContents.reload();
  },
  async copyText(text) {
    clipboard.writeText(text);
  },
};

function registerCalls(): void {
  for (const name of CALLS) {
    ipcMain.handle(`tw:${name}`, async (event, ...args: unknown[]): Promise<Reply<unknown>> => {
      // Only our own window may call in.
      if (!win || event.sender !== win.webContents) return { ok: false, code: 'denied', message: 'Not allowed' };
      try {
        const fn = handlers[name] as (...a: unknown[]) => unknown;
        return { ok: true, value: await fn(...args) };
      } catch (err) {
        const code = err instanceof VaultError ? err.code : 'error';
        return { ok: false, code, message: (err as Error).message };
      }
    });
  }
}

// ---------------------------------------------------------------- window and menu

function appUrl(): string {
  return DEV_URL ?? 'app://thoughtwell/index.html';
}

function createWindow(show: boolean): BrowserWindow {
  const w = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    show,
    backgroundColor: '#0f1115',
    title: 'Thoughtwell',
    webPreferences: {
      preload: join(here, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // The built-in PDF viewer.
      plugins: true,
    },
  });
  w.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(https?|mailto):/i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  w.webContents.on('will-navigate', (e, target) => {
    if (target.startsWith(appUrl().replace(/index\.html$/, ''))) return;
    e.preventDefault();
    if (/^(https?|mailto):/i.test(target)) void shell.openExternal(target);
  });
  return w;
}

async function loadApp(w: BrowserWindow): Promise<void> {
  // In development the Vite server may still be starting.
  for (let i = 0; ; i++) {
    try {
      await w.loadURL(appUrl());
      return;
    } catch (err) {
      if (!DEV_URL || i > 60) throw err;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}

const send = (command: string) => () => win?.webContents.send('tw:command', command);

function buildMenu(): void {
  const template: MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        { label: 'New note', accelerator: 'CmdOrCtrl+N', click: send('new-note') },
        { label: 'Add files to Brain inbox…', accelerator: 'CmdOrCtrl+Shift+I', click: send('import') },
        { label: 'Search', accelerator: 'CmdOrCtrl+K', click: send('search') },
        { type: 'separator' },
        { label: 'Open another vault folder…', click: () => void handlers.chooseVault() },
        { label: 'Show vault in file manager', click: () => service && void shell.openPath(service.root) },
        { label: 'Copy vault path (for your AI agents)', click: () => service && clipboard.writeText(service.root) },
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

// ---------------------------------------------------------------- smoke test

async function smokeTest(w: BrowserWindow): Promise<void> {
  const run = <T>(js: string) => w.webContents.executeJavaScript(js, true) as Promise<T>;
  // Wait for the web app to render.
  for (let i = 0; i < 100; i++) {
    if (await run<boolean>(`Boolean(document.querySelector('[data-app-ready]'))`)) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  const result = await run<string>(`(async () => {
    const tw = window.thoughtwell;
    if (!tw) return 'no bridge in the window';
    if (!document.querySelector('[data-app-ready]')) return 'the app did not render';
    const paths = (await tw.list()).map((e) => e.path);
    for (const p of ['AGENTS.md', 'Me/Welcome.md', 'Brain/Inbox']) if (!paths.includes(p)) return 'missing ' + p;
    const note = await tw.createNote('Me', 'Smoke idea', '# Smoke idea\\n\\nzebra crossing\\n');
    const r = await tw.read(note);
    await tw.write(note, r.content + 'more\\n', r.mtime);
    try { await tw.write(note, 'stale', r.mtime); return 'a stale write was not refused'; } catch (e) { if (!e.message.startsWith('[conflict]')) return 'wrong error: ' + e.message; }
    try { await tw.read('../outside.md'); return 'read outside the vault'; } catch (e) { if (!e.message.startsWith('[outside]')) return 'wrong error: ' + e.message; }
    const hits = await tw.search('zebra');
    if (hits[0]?.path !== note) return 'search did not find the new note';
    const img = await fetch('vault://f/AGENTS.md');
    if (!img.ok) return 'vault:// returned ' + img.status;
    const part = await fetch('vault://f/AGENTS.md', { headers: { Range: 'bytes=0-9' } });
    if (part.status !== 206 || (await part.text()).length !== 10) return 'range requests do not work';
    return 'ok';
  })()`);
  if (result !== 'ok') throw new Error(result);
  await uiChecks(w);
}

/** Drives the real UI: open notes, type, autosave, agent-note properties, wikilinks, backlinks, search. */
async function uiChecks(w: BrowserWindow): Promise<void> {
  await vault().vault.write(
    'Brain/Summaries/Building a second brain.md',
    '---\ntitle: Building a second brain\ntype: summary\nsource: Brain/Sources/second-brain.pdf\ntags: [pkm, ai-agents]\nsummary: Capture, organize, distill, express.\nauthor: claude\n---\n\n# Building a second brain\n\nCapture what resonates. Related: [[Smoke idea]].\n\n```mermaid\nflowchart LR\n  Capture --> Organize\n```\n',
  );
  await vault().vault.write('Brain/Inbox/meeting recording.mp4', 'not really a video');
  await vault().touched('Brain/Summaries/Building a second brain.md', 'Brain/Inbox/meeting recording.mp4');
  const result = (await w.webContents.executeJavaScript(
    `(async () => {
      const $ = (s) => document.querySelector(s);
      const wait = async (what, fn, ms = 5000) => {
        for (let t = 0; t < ms; t += 50) { const v = fn(); if (v) return v; await new Promise((r) => setTimeout(r, 50)); }
        throw new Error('timed out waiting for ' + what);
      };
      const text = () => document.body.innerText;
      try {
        location.hash = '';
        await wait('home', () => text().includes('Your notes'));
        (await wait('note in tree', () => $('[title="Me/Smoke idea.md"]'))).click();
        const pm = await wait('editor', () => $('.ProseMirror[contenteditable="true"]'));
        await wait('note text', () => pm.innerText.includes('zebra crossing'));
        if ($('.title-input').value !== 'Smoke idea') return 'title is ' + $('.title-input').value;
        pm.focus();
        const sel = getSelection(); sel.selectAllChildren(pm); sel.collapseToEnd();
        document.execCommand('insertText', false, ' typed in the app');
        let disk = '';
        for (let t = 0; t < 4000 && !disk.includes('typed in the app'); t += 100) {
          await new Promise((r) => setTimeout(r, 100));
          disk = (await window.thoughtwell.read('Me/Smoke idea.md')).content;
        }
        if (!disk.includes('typed in the app')) return 'typing was not saved: ' + JSON.stringify(disk);
        await wait('saved label', () => text().includes('Saved'));
        await wait('backlink in side panel', () => $('.right') && $('.right').innerText.includes('Building a second brain'));

        $('[aria-label^="Brain"]').click();
        await wait('brain home', () => text().includes('1 item waiting'));
        (await wait('summary in tree', () => $('[title="Brain/Summaries/Building a second brain.md"]'))).click();
        await wait('read-only agent note', () => $('.ProseMirror[contenteditable="false"]'));
        await wait('properties', () => $('.props') && $('.props').innerText.includes('#pkm') && $('.props').innerText.includes('by claude'));
        if (!$('.embed')) return 'the mermaid diagram block did not render';
        const link = await wait('wikilink', () => $('.wikilink'));
        link.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
        await wait('wikilink opened the note', () => $('.title-input') && $('.title-input').value === 'Smoke idea');

        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));
        const input = await wait('search box', () => $('.search-dialog input'));
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'resonates');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await wait('search result', () => $('.results') && $('.results').innerText.includes('Building a second brain'));
        return 'ok';
      } catch (e) { return 'ui: ' + e.message; }
    })()`,
    true,
  )) as string;
  if (result !== 'ok') throw new Error(result);
}

// ---------------------------------------------------------------- start

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
  app.on('before-quit', () => {
    void service?.close();
  });

  await app.whenReady();
  buildMenu();
  registerCalls();
  if (!DEV_URL) handleApp(join(resources, 'web'));
  handleVault(() => service?.vault ?? null);

  let dir: string | null | undefined = SMOKE ? join(app.getPath('userData'), 'vault') : loadSettings().vaultPath;
  if (dir && !existsSync(dir) && !SMOKE) {
    await dialog.showMessageBox({ type: 'warning', message: 'Your vault folder is missing', detail: `${dir} could not be found. It may be on a drive that is not connected. Choose where your vault is.` });
    dir = null;
  }
  if (!dir) {
    dir = await askForVault(null, true);
    if (!dir) {
      app.quit();
      return;
    }
    saveSettings({ ...loadSettings(), vaultPath: dir });
  }
  await openVault(dir);

  win = createWindow(!SMOKE);
  try {
    await loadApp(win);
  } catch (err) {
    if (!SMOKE) dialog.showErrorBox('Thoughtwell could not start', (err as Error).message);
    throw err;
  }

  if (SMOKE) {
    try {
      await smokeTest(win);
      console.log('SMOKE OK');
      await service?.close();
      app.exit(0);
    } catch (err) {
      console.error(`SMOKE FAILED: ${(err as Error).message}`);
      app.exit(1);
    }
  }
}

main().catch((err) => {
  console.error(err);
  if (SMOKE) console.error('SMOKE FAILED');
  app.exit(1);
});
