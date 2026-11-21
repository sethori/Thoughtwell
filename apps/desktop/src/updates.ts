// Self-update for the AppImage. Every push to main publishes a GitHub release with the AppImage and
// SHA256SUMS (.github/workflows/build.yml). This looks at the latest release, and if it is newer,
// downloads its AppImage next to the running one, checks it against SHA256SUMS, and renames it over
// the running file. The path stays the same, so desktop shortcuts and agents' MCP configs (which
// point at the AppImage) keep working. The running copy is already mounted and keeps going; the
// new version runs on the next start.
//
// No Electron imports, so it can be exercised under plain Node (THOUGHTWELL_UPDATE_API points it
// at a stand-in for the GitHub API).
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { access, chmod, constants, rename, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { appImageName, checksumFor, isNewer, type UpdateStatus } from '@notes/shared';

export const REPO = 'sethori/Thoughtwell';
const API = process.env.THOUGHTWELL_UPDATE_API ?? `https://api.github.com/repos/${REPO}`;

interface Asset {
  name: string;
  /** API URL: with Accept: application/octet-stream it redirects to the file. */
  url: string;
  size: number;
}
interface Release {
  tag_name: string;
  html_url: string;
  body?: string;
  draft?: boolean;
  prerelease?: boolean;
  assets: Asset[];
}

export interface UpdaterOptions {
  version: string;
  /** The running AppImage ($APPIMAGE), or undefined when not running from one. */
  appImage: string | undefined;
  arch: string;
  auto: () => boolean;
  onStatus: (s: UpdateStatus) => void;
}

export class Updater {
  private s: Omit<UpdateStatus, 'auto'>;
  private running: Promise<UpdateStatus> | null = null;

  constructor(private o: UpdaterOptions) {
    this.s = { state: o.appImage ? 'idle' : 'unsupported', current: o.version };
  }

  status(): UpdateStatus {
    return { ...this.s, auto: this.o.auto() };
  }

  private set(patch: Partial<UpdateStatus>, replace = false): void {
    this.s = replace ? { current: this.o.version, state: 'idle', ...patch } : { ...this.s, ...patch };
    this.o.onStatus(this.status());
  }

  /** Tells listeners again (after the options changed). */
  changed(): void {
    this.o.onStatus(this.status());
  }

  /** One check at a time; a second call while one runs gets the same result. */
  check(): Promise<UpdateStatus> {
    this.running ??= this.run().finally(() => (this.running = null));
    return this.running;
  }

  private async run(): Promise<UpdateStatus> {
    const keep = this.s.state === 'ready' ? this.s : null;
    this.set({ state: 'checking', message: undefined, progress: undefined });
    try {
      const rel = await this.latestRelease();
      const latest = rel.tag_name.replace(/^v/, '');
      const base = { latest, notes: rel.body?.trim() || undefined, releaseUrl: rel.html_url, checkedAt: Date.now() };
      if (keep && keep.latest === latest) {
        this.set({ ...keep, ...base, state: 'ready' }, true);
      } else if (!isNewer(latest, this.o.version)) {
        this.set({ ...base, state: 'current' }, true);
      } else if (!this.o.appImage) {
        this.set({ ...base, state: 'available', message: 'This copy is not running from an AppImage, so it cannot update itself.' }, true);
      } else {
        this.set({ ...base, state: 'downloading', progress: 0 }, true);
        await this.install(rel, latest, this.o.appImage);
        this.set({ state: 'ready', progress: undefined });
      }
    } catch (err) {
      const e = err as Error & { available?: boolean };
      this.set({ state: e.available ? 'available' : 'error', message: e.message, progress: undefined, checkedAt: Date.now() });
    }
    return this.status();
  }

  private headers(accept: string): Record<string, string> {
    return { Accept: accept, 'User-Agent': 'Thoughtwell-updater', 'X-GitHub-Api-Version': '2022-11-28' };
  }

  private async latestRelease(): Promise<Release> {
    let res: Response;
    try {
      res = await fetch(`${API}/releases/latest`, { headers: this.headers('application/vnd.github+json'), signal: AbortSignal.timeout(20_000) });
    } catch (err) {
      throw new Error(`Could not reach GitHub: ${(err as Error).message}`);
    }
    if (res.status === 404) throw new Error('GitHub found no Thoughtwell releases.');
    if (res.status === 403 || res.status === 429) throw new Error('GitHub is limiting requests from this network for now. Try again in an hour.');
    if (!res.ok) throw new Error(`GitHub answered ${res.status} ${res.statusText}`);
    return (await res.json()) as Release;
  }

  /** Downloads an asset, following GitHub's redirect to its file host. */
  private async download(asset: Asset): Promise<Response> {
    let res = await fetch(asset.url, { headers: this.headers('application/octet-stream'), redirect: 'manual', signal: AbortSignal.timeout(30 * 60_000) });
    const loc = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && loc) {
      res = await fetch(new URL(loc, asset.url), { headers: { 'User-Agent': 'Thoughtwell-updater' }, signal: AbortSignal.timeout(30 * 60_000) });
    }
    if (!res.ok || !res.body) throw new Error(`Downloading ${asset.name} failed: ${res.status} ${res.statusText}`);
    return res;
  }

  private async install(rel: Release, latest: string, target: string): Promise<void> {
    const name = appImageName(latest, this.o.arch);
    const asset = rel.assets.find((a) => a.name === name);
    const sumsAsset = rel.assets.find((a) => a.name === 'SHA256SUMS');
    if (!asset) throw Object.assign(new Error(`Release ${latest} has no ${name}.`), { available: true });
    if (!sumsAsset) throw new Error(`Release ${latest} has no SHA256SUMS, so its download can't be checked.`);

    const dir = dirname(target);
    try {
      await access(dir, constants.W_OK);
      await access(target, constants.W_OK);
    } catch {
      throw Object.assign(new Error(`Thoughtwell can't replace ${target} (no permission). Download the new AppImage from the release page instead.`), { available: true });
    }

    const expected = checksumFor(await (await this.download(sumsAsset)).text(), name);
    if (!expected) throw new Error(`SHA256SUMS in release ${latest} doesn't list ${name}.`);

    // Same folder as the target, so the final rename is atomic and never crosses file systems.
    const part = join(dir, `.${basename(target)}.update`);
    try {
      const res = await this.download(asset);
      const total = Number(res.headers.get('content-length')) || asset.size || 0;
      const hash = createHash('sha256');
      const out = createWriteStream(part, { mode: 0o755 });
      let got = 0;
      let shown = 0;
      try {
        for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
          hash.update(chunk);
          got += chunk.length;
          if (!out.write(chunk)) await new Promise<void>((r) => out.once('drain', () => r()));
          if (total && got / total - shown >= 0.02) {
            shown = got / total;
            this.set({ progress: Math.min(1, shown) });
          }
        }
      } finally {
        await new Promise<void>((resolve, reject) => out.end((err?: Error | null) => (err ? reject(err) : resolve())));
      }
      if (hash.digest('hex') !== expected) throw new Error(`The downloaded ${name} doesn't match SHA256SUMS, so it was not installed.`);
      await chmod(part, 0o755);
      await rename(part, target);
    } catch (err) {
      await rm(part, { force: true });
      throw err;
    }
  }
}
