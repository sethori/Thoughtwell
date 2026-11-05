import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';

/**
 * Where uploaded images and files live. Phase 1 writes to local disk; an
 * S3-compatible driver (MinIO) can replace this without touching the routes.
 */
export interface Storage {
  put(key: string, body: Readable): Promise<number>;
  get(key: string): Readable;
  remove(key: string): Promise<void>;
}

export class LocalStorage implements Storage {
  private readonly root: string;
  constructor(root: string) {
    this.root = resolve(root);
  }

  private pathFor(key: string): string {
    const p = resolve(join(this.root, key));
    if (!p.startsWith(this.root + sep)) throw new Error('Invalid storage key');
    return p;
  }

  async put(key: string, body: Readable): Promise<number> {
    const p = this.pathFor(key);
    await mkdir(dirname(p), { recursive: true });
    await pipeline(body, createWriteStream(p, { flags: 'wx' }));
    return (await stat(p)).size;
  }

  get(key: string): Readable {
    return createReadStream(this.pathFor(key));
  }

  async remove(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }
}
