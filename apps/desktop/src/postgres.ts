import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import pg from 'pg';

const run = promisify(execFile);
const PG_MAJOR = '16';

export const OWNER = 'notes_owner';
export const DATABASE = 'notes';

export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as net.AddressInfo;
      srv.close(() => resolve(port));
    });
  });
}

/** A PostgreSQL server shipped inside the app, with its data in a folder we choose. */
export class EmbeddedPostgres {
  port = 0;
  private child: ChildProcess | undefined;
  private socketDir: string | undefined;
  private readonly bin: string;
  private readonly env: NodeJS.ProcessEnv;

  /**
   * @param root the bundled `pg` folder (resources/pg)
   * @param dataDir where the cluster lives; created on first run
   * @param password the owner role's password
   * @param logFile where Postgres writes its log
   */
  constructor(
    private readonly root: string,
    private readonly dataDir: string,
    private readonly password: string,
    private readonly logFile: string,
  ) {
    this.bin = join(root, 'usr', 'lib', 'postgresql', PG_MAJOR, 'bin');
    this.env = {
      ...process.env,
      // The bundled copies of libraries Postgres needs (ICU, OpenSSL, ...).
      LD_LIBRARY_PATH: [join(root, 'lib'), process.env.LD_LIBRARY_PATH].filter(Boolean).join(':'),
      LC_ALL: 'C',
    };
  }

  get ownerUrl(): string {
    return `postgres://${OWNER}:${this.password}@127.0.0.1:${this.port}/${DATABASE}`;
  }

  async start(): Promise<void> {
    if (process.getuid?.() === 0) {
      throw new Error('PostgreSQL will not run as root. Start the app as your normal user.');
    }
    if (!existsSync(join(this.bin, 'postgres'))) {
      throw new Error(`The bundled database server is missing (${this.bin}).`);
    }

    await mkdir(this.dataDir, { recursive: true, mode: 0o700 });
    if (!existsSync(join(this.dataDir, 'PG_VERSION'))) await this.initdb();

    this.port = await freePort();
    this.socketDir = await mkdtemp(join(tmpdir(), 'notes-pg-'));
    const log = createWriteStream(this.logFile, { flags: 'a' });
    const child = spawn(
      join(this.bin, 'postgres'),
      [
        '-D', this.dataDir,
        '-p', String(this.port),
        '-k', this.socketDir,
        '-c', 'listen_addresses=127.0.0.1',
        '-c', 'jit=off',
        '-c', 'max_connections=40',
        '-c', 'shared_buffers=64MB',
        '-c', 'timezone=UTC',
        '-c', 'log_timezone=UTC',
      ],
      { env: this.env, stdio: ['ignore', log, log] },
    );
    this.child = child;
    const exited = new Promise<never>((_, reject) => {
      child.once('exit', (code, signal) =>
        reject(new Error(`The database server stopped during startup (${signal ?? `exit code ${code}`}). See ${this.logFile}`)),
      );
    });
    // Only the startup race matters; later exits are handled by stop().
    exited.catch(() => {});

    await Promise.race([this.waitUntilReady(), exited]);
    await this.ensureDatabase();
  }

  private async initdb(): Promise<void> {
    const pwfile = join(this.dataDir, '..', 'pgpass.tmp');
    await writeFile(pwfile, this.password, { mode: 0o600 });
    try {
      await run(
        join(this.bin, 'initdb'),
        ['-D', this.dataDir, '-U', OWNER, '--pwfile', pwfile, '--auth=scram-sha-256', '-E', 'UTF8', '--no-locale'],
        { env: this.env },
      );
    } catch (err) {
      const e = err as { stderr?: string; message: string };
      throw new Error(`Could not create the database: ${e.stderr?.trim() || e.message}`);
    } finally {
      await rm(pwfile, { force: true });
    }
  }

  private async waitUntilReady(): Promise<void> {
    const deadline = Date.now() + 45_000;
    let last: unknown;
    while (Date.now() < deadline) {
      const client = new pg.Client({ connectionString: this.url('postgres') });
      try {
        await client.connect();
        await client.end();
        return;
      } catch (err) {
        last = err;
        await client.end().catch(() => {});
        await new Promise((r) => setTimeout(r, 250));
      }
    }
    throw new Error(`The database server did not become ready: ${(last as Error | undefined)?.message ?? 'timeout'}`);
  }

  private url(db: string): string {
    return `postgres://${OWNER}:${this.password}@127.0.0.1:${this.port}/${db}`;
  }

  private async ensureDatabase(): Promise<void> {
    const client = new pg.Client({ connectionString: this.url('postgres') });
    await client.connect();
    try {
      const exists = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [DATABASE]);
      if (exists.rowCount === 0) await client.query(`CREATE DATABASE ${DATABASE}`);
    } finally {
      await client.end();
    }
  }

  /** Fast shutdown: lets Postgres finish writing, then exits. */
  async stop(): Promise<void> {
    const child = this.child;
    this.child = undefined;
    if (child && child.exitCode === null) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => child.kill('SIGKILL'), 15_000);
        child.once('exit', () => {
          clearTimeout(timer);
          resolve();
        });
        child.kill('SIGINT');
      });
    }
    if (this.socketDir) await rm(this.socketDir, { recursive: true, force: true });
    this.socketDir = undefined;
  }
}
