/**
 * The calls the web app can make to the desktop app, shared by the main
 * process (which implements them), the preload script (which exposes them as
 * window.thoughtwell) and the web app (which types them).
 */
import type { Area, FileKind } from './layout.js';

export interface Entry {
  /** Vault-relative, forward slashes. */
  path: string;
  name: string;
  kind: 'dir' | FileKind;
  size: number;
  /** Modified time in milliseconds. */
  mtime: number;
}

export interface SearchHit {
  path: string;
  area: Area | null;
  kind: FileKind;
  title: string;
  summary?: string;
  tags: string[];
  snippet: string;
  score: number;
}

export interface VaultInfo {
  root: string;
  version: string;
  /** The app's own settings and logs folder (not the vault). */
  appData: string;
  /** Command and arguments that start this app as an MCP server for agents. */
  mcpCommand: string[];
}

export interface UpdateStatus {
  /**
   * idle: not checked yet. current: this is the latest release. available: a newer release exists
   * but can't be installed here (see message). ready: the newer AppImage is in place; it runs on
   * the next start. unsupported: this copy isn't an AppImage (development), so it can't update itself.
   */
  state: 'idle' | 'checking' | 'current' | 'available' | 'downloading' | 'ready' | 'error' | 'unsupported';
  current: string;
  latest?: string;
  /** 0 to 1 while downloading. */
  progress?: number;
  notes?: string;
  releaseUrl?: string;
  message?: string;
  /** When the last check finished, in milliseconds. */
  checkedAt?: number;
  /** Check (and download) when the app opens. */
  auto: boolean;
}

export interface Bridge {
  info(): Promise<VaultInfo>;
  updateStatus(): Promise<UpdateStatus>;
  /** Looks for a newer release and, if there is one, downloads and installs it for the next start. */
  checkForUpdates(): Promise<UpdateStatus>;
  setUpdateOptions(options: { auto?: boolean }): Promise<UpdateStatus>;
  /** Restarts into the installed update. */
  restartToUpdate(): Promise<void>;
  onUpdate(fn: (status: UpdateStatus) => void): () => void;
  list(): Promise<Entry[]>;
  /** version identifies this state of the file; pass it back to write. */
  read(path: string): Promise<{ content: string; version: string }>;
  /** expectedVersion: refuse if the file changed since it was read (null to skip the check). */
  write(path: string, content: string, expectedVersion: string | null): Promise<{ version: string }>;
  createNote(dir: string, title: string, body?: string): Promise<string>;
  createFolder(dir: string, name: string): Promise<string>;
  move(from: string, to: string): Promise<string>;
  /** Moves to the system trash, so it can be restored. */
  trash(path: string): Promise<void>;
  saveAttachment(notePath: string, fileName: string, bytes: Uint8Array): Promise<{ path: string; link: string }>;
  importPaths(absPaths: string[], destDir?: string): Promise<string[]>;
  /** Shows a file picker and copies what was picked into destDir (default Brain/Inbox). */
  pickAndImport(destDir?: string): Promise<string[]>;
  /** The real path of a file dropped onto the window. */
  pathForFile(file: File): string;
  search(query: string, area?: Area): Promise<SearchHit[]>;
  related(input: { path?: string; text?: string }, area?: Area): Promise<SearchHit[]>;
  backlinks(path: string): Promise<SearchHit[]>;
  resolveLink(target: string, fromPath?: string): Promise<string | null>;
  tags(area?: Area): Promise<{ tag: string; count: number }[]>;
  reveal(path: string): Promise<void>;
  openWithDefaultApp(path: string): Promise<void>;
  openUrl(url: string): Promise<void>;
  /** Asks for another vault folder, then reloads the app on it. */
  chooseVault(): Promise<void>;
  copyText(text: string): Promise<void>;
  /** Paths changed on disk by anyone (you, an agent, a sync tool). */
  onChange(fn: (paths: string[]) => void): () => void;
  /** Menu commands such as "new-note", "import", "search". */
  onCommand(fn: (command: string) => void): () => void;
}

/** Every call goes through one channel each; failures come back as data so the error code survives. */
export type Reply<T> = { ok: true; value: T } | { ok: false; code: string; message: string };

export const CALLS = [
  'info',
  'updateStatus',
  'checkForUpdates',
  'setUpdateOptions',
  'restartToUpdate',
  'list',
  'read',
  'write',
  'createNote',
  'createFolder',
  'move',
  'trash',
  'saveAttachment',
  'importPaths',
  'pickAndImport',
  'search',
  'related',
  'backlinks',
  'resolveLink',
  'tags',
  'reveal',
  'openWithDefaultApp',
  'openUrl',
  'chooseVault',
  'copyText',
] as const satisfies readonly (keyof Bridge)[];

export type Call = (typeof CALLS)[number];

/** Errors reach the page as "[code] message". parseError reads them back. */
export function errorMessage(code: string, message: string): string {
  return `[${code}] ${message}`;
}

export function parseError(err: unknown): { code: string; message: string } {
  const raw = String((err as Error)?.message ?? err).replace(/^Error invoking remote method '[^']+': (\w*Error: )?/, '');
  const m = /^\[([a-z_]+)\] ([\s\S]*)$/.exec(raw);
  return m ? { code: m[1]!, message: m[2]! } : { code: 'error', message: raw };
}
