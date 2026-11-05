import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { isAllowedType, maxUploadBytes, normalizeUploadPolicy } from '@notes/shared';
import { one } from '../db.js';
import { audit } from '../lib/audit.js';
import { badRequest, notFound, tooLarge } from '../lib/errors.js';
import { idParams, parse } from '../lib/validate.js';
import type { Storage } from '../lib/storage.js';
import { groupIdsOf, requireRole } from '../services/access.js';

// Raster images display in the page; everything else (SVG included, since it
// can carry script) downloads as an attachment.
const INLINE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif']);

export async function assetRoutes(app: FastifyInstance, deps: { storage: Storage }) {
  const { storage } = deps;

  app.post('/api/pages/:id/assets', async (req, reply) => {
    const { id } = parse(idParams, req.params);
    // Work out this person's limit first, then read the upload with that limit.
    const { limit, policy } = await req.tx(async (db, auth) => {
      const role = await requireRole(db, auth.userId, 'page', id, 'contributor');
      const org = await one<{ settings: Record<string, unknown> }>(db, 'SELECT settings FROM orgs WHERE id = $1', [auth.orgId]);
      const policy = normalizeUploadPolicy(org?.settings?.uploads);
      return { policy, limit: maxUploadBytes(policy, role, await groupIdsOf(db, auth.userId)) };
    });

    const file = await req.file({ limits: { fileSize: limit, files: 1 } });
    if (!file) throw badRequest('Attach a file in the "file" field');
    if (!isAllowedType(policy, file.mimetype)) {
      file.file.resume();
      throw badRequest(`Files of type ${file.mimetype} are not allowed`);
    }

    const auth = req.auth!;
    const assetId = randomUUID();
    const key = `${auth.orgId}/${assetId}`;
    const limitText = `Files can be at most ${+(limit / 1024 / 1024).toFixed(2)} MB`;
    let size: number;
    try {
      size = await storage.put(key, file.file);
    } catch (err) {
      // The multipart parser aborts the stream when the size limit is hit.
      await storage.remove(key);
      if ((err as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') throw tooLarge(limitText);
      throw err;
    }
    if (file.file.truncated) {
      await storage.remove(key);
      throw tooLarge(limitText);
    }

    const asset = await req.tx(async (db) => {
      const row = await one(
        db,
        `INSERT INTO assets (id, org_id, page_id, storage_key, filename, mime, size_bytes, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, filename, mime, size_bytes`,
        [assetId, auth.orgId, id, key, file.filename.slice(0, 255), file.mimetype, size, auth.userId],
      );
      await audit(db, auth, 'asset.upload', 'page', id, { assetId, filename: file.filename, size });
      return row;
    });
    reply.code(201);
    return { ...asset, url: `/api/assets/${assetId}` };
  });

  app.get('/api/assets/:id', async (req, reply) => {
    const { id } = parse(idParams, req.params);
    const asset = await req.tx(async (db, auth) => {
      const a = await one<{ page_id: string | null; storage_key: string; filename: string; mime: string; size_bytes: string }>(
        db,
        'SELECT page_id, storage_key, filename, mime, size_bytes FROM assets WHERE id = $1',
        [id],
      );
      if (!a) throw notFound();
      if (a.page_id) await requireRole(db, auth.userId, 'page', a.page_id, 'viewer');
      return a;
    });
    const inline = INLINE_TYPES.has(asset.mime);
    reply
      .header('Content-Type', asset.mime)
      .header('Content-Length', asset.size_bytes)
      .header('X-Content-Type-Options', 'nosniff')
      .header('Cache-Control', 'private, max-age=3600')
      .header(
        'Content-Disposition',
        `${inline ? 'inline' : 'attachment'}; filename="${asset.filename.replace(/["\\\r\n]/g, '_')}"`,
      );
    return reply.send(storage.get(asset.storage_key));
  });
}
