import { constants, existsSync, realpathSync } from 'node:fs';
import { copyFile, cp, lstat, mkdir, open, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import { AREA_DIR, ATTACHMENTS_DIR, BRAIN_DIRS, fileKind, safeFileName, type Entry } from '@notes/shared';

export type { Entry };
import { starterFiles } from './templates.js';

export class VaultError extends Error {
  constructor(
    public readonly code: 'outside' | 'not_found' | 'exists' | 'conflict' | 'invalid' | 'protected',
    message: string,
  ) {
    super(message);
  }
}

/** Notes bigger than this are listed but not read into the search index. */
export const MAX_INDEXED_BYTES = 4 * 1024 * 1024;

const toPosix = (p: string) => p.split(sep).join('/');

/** Hidden files and folders (.git, .obsidian, .thoughtwell, editor swap files) are left out of the tree. */
export function isHidden(rel: string): boolean {
  return rel.split('/').some((part) => part.startsWith('.') || part === 'node_modules' || part.endsWith('~'));
}

/**
 * A vault on disk. Every path from outside is vault-relative and checked so it
 * cannot reach outside the folder, including through symlinks.
 */
export class Vault {
  readonly root: string;
  private readonly realRoot: string;

  private constructor(root: string) {
    this.root = resolve(root);
    this.realRoot = realpathSync(this.root);
  }

  /** Opens (and if needed creates) a vault, adding any missing standard folders and starter files. */
  static async open(root: string, today = new Date().toISOString().slice(0, 10)): Promise<Vault> {
    await mkdir(root, { recursive: true });
    const v = new Vault(root);
    for (const dir of [AREA_DIR.me, AREA_DIR.brain, ...Object.values(BRAIN_DIRS)]) await mkdir(join(v.root, dir), { recursive: true });
    for (const [rel, content] of Object.entries(starterFiles(today))) {
      // 'wx' fails if the file exists, so nothing of yours is replaced.
      await writeFile(join(v.root, rel), content, { flag: 'wx' }).catch((e: NodeJS.ErrnoException) => {
        if (e.code !== 'EEXIST') throw e;
      });
    }
    return v;
  }

  /** Absolute path for a vault-relative one. Throws if it would leave the vault. */
  resolve(rel: string): string {
    if (typeof rel !== 'string' || rel.includes('\0')) throw new VaultError('invalid', 'Invalid path');
    const abs = resolve(this.root, rel.replace(/^\/+/, ''));
    if (abs !== this.root && !abs.startsWith(this.root + sep)) throw new VaultError('outside', 'That path is outside the vault');
    // Follow symlinks on the part that exists, so a link cannot point out of the vault.
    let probe = abs;
    while (!existsSync(probe) && probe !== this.root) probe = dirname(probe);
    const real = realpathSync(probe);
    if (real !== this.realRoot && !real.startsWith(this.realRoot + sep)) throw new VaultError('outside', 'That path is outside the vault');
    return abs;
  }

  rel(abs: string): string {
    return toPosix(relative(this.root, abs));
  }

  /** Every visible file and folder, folders first, then by name. */
  async list(): Promise<Entry[]> {
    const out: Entry[] = [];
    const walk = async (absDir: string): Promise<void> => {
      const items = await readdir(absDir, { withFileTypes: true }).catch(() => []);
      for (const it of items) {
        const abs = join(absDir, it.name);
        const rel = this.rel(abs);
        if (isHidden(rel)) continue;
        const info = await stat(abs).catch(() => null);
        if (!info) continue;
        if (info.isDirectory()) {
          if (it.isSymbolicLink()) continue; // never walk out of the vault, or in circles
          out.push({ path: rel, name: it.name, kind: 'dir', size: 0, mtime: info.mtimeMs });
          await walk(abs);
        } else if (info.isFile()) {
          out.push({ path: rel, name: it.name, kind: fileKind(it.name), size: info.size, mtime: info.mtimeMs });
        }
      }
    };
    await walk(this.root);
    return out.sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true, sensitivity: 'base' }));
  }

  async read(rel: string): Promise<{ content: string; mtime: number }> {
    const abs = this.resolve(rel);
    const info = await stat(abs).catch(() => null);
    if (!info?.isFile()) throw new VaultError('not_found', `${rel} no longer exists`);
    return { content: await readFile(abs, 'utf8'), mtime: info.mtimeMs };
  }

  async readBytes(rel: string): Promise<Buffer> {
    return readFile(this.resolve(rel));
  }

  /**
   * Writes a text file atomically (temporary file, then rename), so an agent
   * reading at the same moment never sees half a note. With expectedMtime,
   * refuses to overwrite a file someone else changed since it was read.
   */
  async write(rel: string, content: string | Uint8Array, opts: { expectedMtime?: number | null; create?: boolean } = {}): Promise<{ mtime: number }> {
    const abs = this.resolve(rel);
    const current = await stat(abs).catch(() => null);
    if (opts.create && current) throw new VaultError('exists', `${rel} already exists`);
    if (opts.expectedMtime != null && current && Math.abs(current.mtimeMs - opts.expectedMtime) > 1) {
      throw new VaultError('conflict', `${rel} was changed outside Thoughtwell`);
    }
    if (opts.expectedMtime != null && !current) throw new VaultError('conflict', `${rel} was moved or deleted outside Thoughtwell`);
    await mkdir(dirname(abs), { recursive: true });
    const tmp = join(dirname(abs), `.${basename(abs)}.${randomBytes(4).toString('hex')}.tmp`);
    const fh = await open(tmp, 'w', current ? current.mode & 0o777 : 0o644);
    try {
      await fh.writeFile(content);
      await fh.sync();
    } finally {
      await fh.close();
    }
    await rename(tmp, abs).catch(async (e) => {
      await unlink(tmp).catch(() => {});
      throw e;
    });
    return { mtime: (await stat(abs)).mtimeMs };
  }

  /** A free path like "Folder/Name.md", "Folder/Name 2.md"… */
  async uniquePath(dirRel: string, fileName: string): Promise<string> {
    const ext = extname(fileName);
    const stem = fileName.slice(0, fileName.length - ext.length) || 'Untitled';
    for (let n = 1; n < 10_000; n++) {
      const candidate = toPosix(join(dirRel, n === 1 ? `${stem}${ext}` : `${stem} ${n}${ext}`));
      if (!existsSync(this.resolve(candidate))) return candidate;
    }
    throw new VaultError('exists', 'Could not find a free file name');
  }

  async createNote(dirRel: string, title: string, body?: string): Promise<string> {
    const name = safeFileName(title);
    const path = await this.uniquePath(dirRel, `${name}.md`);
    await this.write(path, body ?? '', { create: true });
    return path;
  }

  async createFolder(dirRel: string, name: string): Promise<string> {
    const path = await this.uniquePath(dirRel, safeFileName(name));
    await mkdir(this.resolve(path));
    return path;
  }

  private guard(rel: string) {
    const clean = rel.replace(/^\/+|\/+$/g, '');
    if (clean === '' || clean === AREA_DIR.me || clean === AREA_DIR.brain) {
      throw new VaultError('protected', 'The Me and Brain folders cannot be moved, renamed or deleted');
    }
  }

  /** Renames or moves a file or folder. Never replaces an existing one. */
  async move(fromRel: string, toRel: string): Promise<string> {
    this.guard(fromRel);
    const from = this.resolve(fromRel);
    const to = this.resolve(toRel);
    if (!(await lstat(from).catch(() => null))) throw new VaultError('not_found', `${fromRel} no longer exists`);
    if (to === from) return this.rel(to);
    if (to.startsWith(from + sep)) throw new VaultError('invalid', 'A folder cannot be moved into itself');
    // Case-only renames on case-insensitive disks look like the target exists.
    const sameFile = from.toLowerCase() === to.toLowerCase();
    if (!sameFile && (await lstat(to).catch(() => null))) throw new VaultError('exists', `${toRel} already exists`);
    await mkdir(dirname(to), { recursive: true });
    await rename(from, to);
    return this.rel(to);
  }

  /** The path to delete, checked. Deleting itself goes to the system trash (done by the desktop app). */
  checkDeletable(rel: string): string {
    this.guard(rel);
    return this.resolve(rel);
  }

  /** Saves bytes into the attachments folder beside a note and returns the link to use in that note. */
  async saveAttachment(notePath: string, fileName: string, bytes: Uint8Array): Promise<{ path: string; link: string }> {
    const noteDir = toPosix(dirname(notePath)) === '.' ? '' : toPosix(dirname(notePath));
    const dir = noteDir ? `${noteDir}/${ATTACHMENTS_DIR}` : ATTACHMENTS_DIR;
    const path = await this.uniquePath(dir, safeFileName(fileName));
    await this.write(path, bytes, { create: true });
    return { path, link: encodeURI(path.slice(noteDir ? noteDir.length + 1 : 0)) };
  }

  /** Copies files or folders from elsewhere on the computer into the vault (by default, the Brain inbox). */
  async importPaths(absPaths: string[], destDir: string = BRAIN_DIRS.inbox): Promise<string[]> {
    this.resolve(destDir);
    const out: string[] = [];
    for (const src of absPaths) {
      const info = await stat(src).catch(() => null);
      if (!info) continue;
      const target = await this.uniquePath(destDir, basename(src));
      const abs = this.resolve(target);
      await mkdir(dirname(abs), { recursive: true });
      if (info.isDirectory()) await cp(src, abs, { recursive: true, errorOnExist: true, force: false });
      else await copyFile(src, abs, constants.COPYFILE_EXCL);
      out.push(target);
    }
    return out;
  }

  async exists(rel: string): Promise<boolean> {
    return Boolean(await stat(this.resolve(rel)).catch(() => null));
  }
}
