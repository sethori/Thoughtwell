import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { Readable } from 'node:stream';
import { protocol } from 'electron';
import type { Vault } from '@notes/vault';

/**
 * Two schemes:
 *   app://thoughtwell/…   the built web app (in a packaged build)
 *   vault://f/<path>      files in the vault, for images, PDFs, video and audio in notes
 */
export function registerSchemes(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
    { scheme: 'vault', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
  ]);
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.pdf': 'application/pdf',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.ogv': 'video/ogg',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.flac': 'audio/flac',
};

function typeOf(path: string): string {
  return TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream';
}

/** Serves a file, honouring Range requests so video and audio can seek. */
async function serveFile(abs: string, request: Request, headers: Record<string, string>): Promise<Response> {
  const info = await stat(abs).catch(() => null);
  if (!info?.isFile()) return new Response('Not found', { status: 404 });
  const size = info.size;
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range') ?? '');
  const base = { 'Accept-Ranges': 'bytes', 'X-Content-Type-Options': 'nosniff', ...headers };
  if (range && size > 0) {
    let start = range[1] ? Number(range[1]) : NaN;
    let end = range[2] ? Number(range[2]) : size - 1;
    if (Number.isNaN(start)) {
      // "bytes=-500" means the last 500 bytes.
      start = Math.max(0, size - end);
      end = size - 1;
    }
    end = Math.min(end, size - 1);
    if (start > end || start >= size) {
      return new Response(null, { status: 416, headers: { ...base, 'Content-Range': `bytes */${size}` } });
    }
    const body = Readable.toWeb(createReadStream(abs, { start, end })) as ReadableStream;
    return new Response(body, {
      status: 206,
      headers: { ...base, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) },
    });
  }
  const body = Readable.toWeb(createReadStream(abs)) as ReadableStream;
  return new Response(body, { status: 200, headers: { ...base, 'Content-Length': String(size) } });
}

/** The built web app, falling back to index.html for anything that is not a file. */
export function handleApp(webRoot: string): void {
  const base = normalize(webRoot);
  protocol.handle('app', async (request) => {
    let rel = '/';
    try {
      rel = decodeURIComponent(new URL(request.url).pathname);
    } catch {
      /* malformed: serve the app shell */
    }
    let target = normalize(join(base, rel));
    const inside = target === base || target.startsWith(base + sep);
    if (!inside || !(await stat(target).catch(() => null))?.isFile()) target = join(base, 'index.html');
    return serveFile(target, request, { 'Content-Type': typeOf(target), 'Cache-Control': 'no-cache' });
  });
}

/**
 * Vault files. Anything that could run code when opened directly (HTML, SVG,
 * scripts) is served sandboxed or as plain text, since agents may save web
 * pages and other material from the internet into the vault.
 */
export function handleVault(getVault: () => Vault | null): void {
  protocol.handle('vault', async (request) => {
    const vault = getVault();
    if (!vault) return new Response('No vault open', { status: 503 });
    let abs: string;
    try {
      const url = new URL(request.url);
      abs = vault.resolve(decodeURIComponent(url.pathname));
    } catch {
      return new Response('Not allowed', { status: 403 });
    }
    let type = typeOf(abs);
    if (/^text\/(html|javascript)/.test(type) || type.startsWith('application/json')) type = 'text/plain; charset=utf-8';
    // Only this app's window can load vault:// at all, so any origin of it (app:// or the dev server) may read.
    const headers: Record<string, string> = { 'Content-Type': type, 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' };
    // The PDF viewer needs to run; everything else gets no scripts at all.
    if (type !== 'application/pdf') headers['Content-Security-Policy'] = "sandbox; default-src 'none'; img-src vault: data:; media-src vault:; style-src 'unsafe-inline'";
    return serveFile(abs, request, headers);
  });
}

/** The vault:// URL for a vault path. Mirrored in the web app (lib/vault.ts). */
export function vaultUrl(path: string): string {
  return 'vault://f/' + path.split('/').map(encodeURIComponent).join('/');
}
