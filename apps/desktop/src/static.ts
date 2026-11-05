import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

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
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

/** Serves the built web app, falling back to index.html for client-side routes. */
export function registerStatic(app: FastifyInstance, root: string): void {
  const base = normalize(root);
  const handler = async (req: FastifyRequest, reply: FastifyReply) => {
    const path = req.url.split('?')[0] ?? '/';
    if (path.startsWith('/api/')) {
      reply.code(404);
      return { error: { code: 'not_found', message: 'Not found' } };
    }
    let rel = '/';
    try {
      rel = decodeURIComponent(path);
    } catch {
      /* malformed escape: serve the app shell */
    }
    let target = normalize(join(base, rel));
    const inside = target === base || target.startsWith(base + sep);
    const info = inside ? await stat(target).catch(() => null) : null;
    if (!info?.isFile()) target = join(base, 'index.html');

    reply
      .header('Content-Type', TYPES[extname(target)] ?? 'application/octet-stream')
      .header('X-Content-Type-Options', 'nosniff')
      .header('Cache-Control', target.includes(`${sep}assets${sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache');
    return reply.send(createReadStream(target));
  };
  app.get('/', handler);
  app.get('/*', handler);
}
