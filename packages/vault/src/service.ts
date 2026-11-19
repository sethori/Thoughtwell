import { readdir, stat } from 'node:fs/promises';
import { sep } from 'node:path';
import { watch, type FSWatcher } from 'chokidar';
import { fileKind, isNotePath } from '@notes/shared';
import { isHidden, MAX_INDEXED_BYTES, Vault } from './vault.js';
import { SearchIndex } from './search.js';

export interface ChangeEvent {
  /** Vault-relative paths that were added, changed or removed since the last event. */
  paths: string[];
}

/**
 * A vault, its search index and a watcher that keeps both current when
 * anything (you, an agent, a sync tool) changes the folder.
 */
export class VaultService {
  readonly index = new SearchIndex();
  private watcher: FSWatcher | null = null;
  private pending = new Set<string>();
  private timer: NodeJS.Timeout | null = null;
  private listeners = new Set<(e: ChangeEvent) => void>();
  private ready: Promise<void>;

  private constructor(readonly vault: Vault) {
    this.ready = this.rebuild();
  }

  static async open(root: string, opts: { watch?: boolean } = {}): Promise<VaultService> {
    const s = new VaultService(await Vault.open(root));
    await s.ready;
    if (opts.watch !== false) await s.startWatching();
    return s;
  }

  get root(): string {
    return this.vault.root;
  }

  onChange(fn: (e: ChangeEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  async rebuild(): Promise<void> {
    for (const e of await this.vault.list()) {
      if (e.kind === 'dir') continue;
      await this.indexPath(e.path, e.kind === 'note' ? e.size : 0, e.mtime);
    }
  }

  private async indexPath(rel: string, size?: number, mtime?: number): Promise<void> {
    if (isHidden(rel)) return;
    if (size === undefined || mtime === undefined) {
      const info = await stat(this.vault.resolve(rel)).catch(() => null);
      if (!info) {
        this.index.removeUnder(rel);
        return;
      }
      if (info.isDirectory()) {
        // A folder moved or copied in: index what it holds.
        const names = await readdir(this.vault.resolve(rel), { recursive: true }).catch(() => [] as string[]);
        for (const n of names) {
          const child = `${rel}/${n.split(sep).join('/')}`;
          if (!isHidden(child) && !(await stat(this.vault.resolve(child)).catch(() => null))?.isDirectory()) await this.indexPath(child);
        }
        return;
      }
      size = info.size;
      mtime = info.mtimeMs;
    }
    if (isNotePath(rel) && size <= MAX_INDEXED_BYTES) {
      const { content } = await this.vault.read(rel).catch(() => ({ content: null }));
      if (content === null) this.index.remove(rel);
      else this.index.setNote(rel, content, mtime);
    } else this.index.setFile(rel, fileKind(rel), mtime);
  }

  /** Updates the index straight away for a path the app itself just wrote, moved or deleted. */
  async touched(...paths: string[]): Promise<void> {
    for (const p of paths) await this.indexPath(p);
  }

  private async startWatching(): Promise<void> {
    const root = this.vault.root;
    this.watcher = watch(root, {
      ignoreInitial: true,
      ignored: (abs: string) => abs !== root && isHidden(this.vault.rel(abs)),
      // Wait until a file stops growing (large copies, agent writes) before reporting it.
      awaitWriteFinish: { stabilityThreshold: 250, pollInterval: 100 },
    });
    this.watcher.on('all', (_event, abs) => {
      this.pending.add(this.vault.rel(abs));
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(() => void this.flush(), 150);
    });
    await new Promise<void>((resolve) => this.watcher!.once('ready', () => resolve()));
  }

  private async flush(): Promise<void> {
    this.timer = null;
    const paths = [...this.pending];
    this.pending.clear();
    for (const p of paths) await this.indexPath(p).catch(() => this.index.removeUnder(p));
    for (const fn of this.listeners) fn({ paths });
  }

  async close(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    await this.watcher?.close();
    this.watcher = null;
    this.listeners.clear();
  }
}
