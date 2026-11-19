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
}

export interface Bridge {
  info(): Promise<VaultInfo>;
  list(): Promise<Entry[]>;
  read(path: string): Promise<{ content: string; mtime: number }>;
  /** expectedMtime: refuse if the file changed since it was read (null to skip the check). */
  write(path: string, content: string, expectedMtime: number | null): Promise<{ mtime: number }>;
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
