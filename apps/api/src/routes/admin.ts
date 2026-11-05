import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { normalizeUploadPolicy } from '@notes/shared';
import { hashPassword } from '../auth/password.js';
import { many, one, type Db } from '../db.js';
import { audit } from '../lib/audit.js';
import { forbidden, notFound } from '../lib/errors.js';
import { idParams, name, parse, uuid } from '../lib/validate.js';
import { requireRole } from '../services/access.js';
import type { AuthContext } from '../types.js';
import { brandingOf } from './me.js';
import type { AppDeps } from '../app.js';
import { normalizeNotificationSettings, publicNotificationSettings } from '../lib/delivery.js';

function requireOrgAdmin(auth: AuthContext) {
  if (!auth.isOrgAdmin) throw forbidden('Only organization admins can do this');
}

const USER_COLUMNS = `id, username, display_name, email, title, phone, kind, home_unit_id,
  is_org_admin, can_self_approve, disabled_at, created_at`;

const createUser = z
  .object({
    username: z.string().trim().min(2).max(64).regex(/^[a-zA-Z0-9._-]+$/, 'Letters, digits, dot, dash, underscore'),
    displayName: name,
    kind: z.enum(['person', 'agent']).default('person'),
    password: z.string().min(8).max(500).optional(),
    email: z.string().email().optional(),
    title: z.string().max(200).optional(),
    phone: z.string().max(50).optional(),
    homeUnitId: uuid.optional(),
    isOrgAdmin: z.boolean().optional(),
  })
  .refine((u) => u.kind === 'agent' || Boolean(u.password), 'People need a password');

const updateUser = z
  .object({
    displayName: name,
    email: z.string().email().nullable(),
    title: z.string().max(200).nullable(),
    phone: z.string().max(50).nullable(),
    homeUnitId: uuid.nullable(),
    isOrgAdmin: z.boolean(),
    canSelfApprove: z.boolean(),
    disabled: z.boolean(),
    password: z.string().min(8).max(500),
  })
  .partial();

const settingsBody = z.object({
  branding: z
    .object({
      name: z.string().max(100).nullable().optional(),
      brandColor: z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/, 'Use a #rrggbb color')
        .nullable()
        .optional(),
    })
    .optional(),
  uploads: z
    .object({
      defaultMaxMb: z.number().positive().max(2048).optional(),
      byRole: z.record(z.number().positive().max(2048)).optional(),
      byGroup: z.record(z.number().positive().max(2048)).optional(),
      allowedTypes: z.array(z.string().max(100)).optional(),
    })
    .optional(),
  notifications: z
    .object({
      email: z
        .object({
          enabled: z.boolean(),
          host: z.string().max(255),
          port: z.number().int().min(1).max(65535),
          secure: z.boolean(),
          username: z.string().max(255),
          /** Omit to keep the saved password; an empty string clears it. */
          password: z.string().max(500),
          from: z.string().max(255),
        })
        .partial()
        .optional(),
      teams: z
        .object({ enabled: z.boolean(), webhookUrl: z.union([z.string().url().startsWith('https://'), z.literal('')]) })
        .partial()
        .optional(),
    })
    .optional(),
});

export async function adminRoutes(app: FastifyInstance, deps: Pick<AppDeps, 'dispatcher'> = {}) {
  // ---------------- people
  app.get('/api/admin/users', async (req) =>
    req.tx(async (db, auth) => {
      requireOrgAdmin(auth);
      return many(db, `SELECT ${USER_COLUMNS} FROM users ORDER BY display_name`);
    }),
  );

  app.post('/api/admin/users', async (req, reply) => {
    const body = parse(createUser, req.body);
    const passwordHash = body.password ? await hashPassword(body.password) : null;
    const user = await req.tx(async (db, auth) => {
      requireOrgAdmin(auth);
      const row = await one<{ id: string }>(
        db,
        `INSERT INTO users (org_id, username, display_name, kind, password_hash, email, title, phone, home_unit_id, is_org_admin)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING ${USER_COLUMNS}`,
        [
          auth.orgId,
          body.username,
          body.displayName,
          body.kind,
          passwordHash,
          body.email ?? null,
          body.title ?? null,
          body.phone ?? null,
          body.homeUnitId ?? null,
          body.isOrgAdmin ?? false,
        ],
      );
      await audit(db, auth, 'user.create', 'user', row!.id, { username: body.username, kind: body.kind });
      return row;
    });
    reply.code(201);
    return user;
  });

  app.patch('/api/admin/users/:id', async (req) => {
    const { id } = parse(idParams, req.params);
    const body = parse(updateUser, req.body);
    const passwordHash = body.password ? await hashPassword(body.password) : undefined;
    return req.tx(async (db, auth) => {
      requireOrgAdmin(auth);
      const sets: string[] = [];
      const params: unknown[] = [id];
      const set = (col: string, v: unknown) => {
        params.push(v);
        sets.push(`${col} = $${params.length}`);
      };
      if (body.displayName !== undefined) set('display_name', body.displayName);
      if (body.email !== undefined) set('email', body.email);
      if (body.title !== undefined) set('title', body.title);
      if (body.phone !== undefined) set('phone', body.phone);
      if (body.homeUnitId !== undefined) set('home_unit_id', body.homeUnitId);
      if (body.isOrgAdmin !== undefined) set('is_org_admin', body.isOrgAdmin);
      if (body.canSelfApprove !== undefined) set('can_self_approve', body.canSelfApprove);
      if (body.disabled !== undefined) sets.push(body.disabled ? 'disabled_at = coalesce(disabled_at, now())' : 'disabled_at = NULL');
      if (passwordHash) set('password_hash', passwordHash);
      if (sets.length) {
        const r = await db.query(`UPDATE users SET ${sets.join(', ')} WHERE id = $1`, params);
        if (r.rowCount === 0) throw notFound('User not found');
      }
      if (body.disabled) await db.query('DELETE FROM sessions WHERE user_id = $1', [id]);
      const { password: _omit, ...logged } = body;
      await audit(db, auth, 'user.update', 'user', id, { ...logged, passwordChanged: Boolean(passwordHash) });
      return one(db, `SELECT ${USER_COLUMNS} FROM users WHERE id = $1`, [id]);
    });
  });

  // ---------------- groups (managed by admins of the group's unit)
  app.get('/api/groups', async (req) =>
    req.tx((db) =>
      many(
        db,
        `SELECT g.id, g.name, g.unit_id, u.name AS unit_name,
                (SELECT count(*)::int FROM group_members m WHERE m.group_id = g.id) AS members
         FROM groups g JOIN org_units u ON u.id = g.unit_id ORDER BY u.name, g.name`,
      ),
    ),
  );

  app.post('/api/groups', async (req, reply) => {
    const body = parse(z.object({ unitId: uuid, name }), req.body);
    const group = await req.tx(async (db, auth) => {
      await requireRole(db, auth.userId, 'unit', body.unitId, 'admin');
      const row = await one<{ id: string }>(
        db,
        'INSERT INTO groups (org_id, unit_id, name) VALUES ($1, $2, $3) RETURNING id, unit_id, name',
        [auth.orgId, body.unitId, body.name],
      );
      await audit(db, auth, 'group.create', 'group', row!.id, { name: body.name, unitId: body.unitId });
      return row;
    });
    reply.code(201);
    return group;
  });

  async function groupUnit(db: Db, groupId: string) {
    const g = await one<{ unit_id: string }>(db, 'SELECT unit_id FROM groups WHERE id = $1', [groupId]);
    if (!g) throw notFound('Group not found');
    return g.unit_id;
  }

  app.get('/api/groups/:id/members', async (req) => {
    const { id } = parse(idParams, req.params);
    return req.tx(async (db) => {
      await groupUnit(db, id);
      return many(
        db,
        `SELECT u.id, u.display_name, u.title, u.kind FROM group_members m JOIN users u ON u.id = m.user_id
         WHERE m.group_id = $1 ORDER BY u.display_name`,
        [id],
      );
    });
  });

  app.post('/api/groups/:id/members', async (req, reply) => {
    const { id } = parse(idParams, req.params);
    const body = parse(z.object({ userId: uuid }), req.body);
    await req.tx(async (db, auth) => {
      await requireRole(db, auth.userId, 'unit', await groupUnit(db, id), 'admin');
      await db.query(
        'INSERT INTO group_members (org_id, group_id, user_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
        [auth.orgId, id, body.userId],
      );
      await audit(db, auth, 'group.add_member', 'group', id, { userId: body.userId });
    });
    reply.code(204);
  });

  app.delete('/api/groups/:id/members/:userId', async (req, reply) => {
    const { id, userId } = parse(z.object({ id: uuid, userId: uuid }), req.params);
    await req.tx(async (db, auth) => {
      await requireRole(db, auth.userId, 'unit', await groupUnit(db, id), 'admin');
      await db.query('DELETE FROM group_members WHERE group_id = $1 AND user_id = $2', [id, userId]);
      await audit(db, auth, 'group.remove_member', 'group', id, { userId });
    });
    reply.code(204);
  });

  // ---------------- organization settings
  app.get('/api/admin/settings', async (req) =>
    req.tx(async (db, auth) => {
      requireOrgAdmin(auth);
      const org = await one<{ settings: Record<string, unknown> }>(db, 'SELECT settings FROM orgs WHERE id = $1', [auth.orgId]);
      return {
        branding: brandingOf(org?.settings),
        uploads: normalizeUploadPolicy(org?.settings?.uploads),
        notifications: publicNotificationSettings(normalizeNotificationSettings(org?.settings?.notifications)),
      };
    }),
  );

  app.post('/api/admin/notifications/test', async (req) => {
    const auth = req.auth!;
    requireOrgAdmin(auth);
    if (!deps.dispatcher) return { email: 'not available', teams: 'not available' };
    return deps.dispatcher.sendTest(auth.orgId, auth.userId);
  });

  app.put('/api/admin/settings', async (req) => {
    const body = parse(settingsBody, req.body);
    return req.tx(async (db, auth) => {
      requireOrgAdmin(auth);
      const org = await one<{ settings: Record<string, unknown> }>(db, 'SELECT settings FROM orgs WHERE id = $1', [auth.orgId]);
      const current = org?.settings ?? {};
      const next: Record<string, unknown> = {
        ...current,
        ...(body.branding ? { branding: { ...(current.branding as object), ...body.branding } } : {}),
        ...(body.uploads ? { uploads: normalizeUploadPolicy({ ...(current.uploads as object), ...body.uploads }) } : {}),
      };
      if (body.notifications) {
        const was = normalizeNotificationSettings(current.notifications);
        next.notifications = normalizeNotificationSettings({
          email: { ...was.email, ...body.notifications.email },
          teams: { ...was.teams, ...body.notifications.teams },
        });
      }
      await db.query('UPDATE orgs SET settings = $2 WHERE id = $1', [auth.orgId, next]);
      // Never write the SMTP password into the audit log.
      const logged = body.notifications?.email?.password !== undefined
        ? { ...body, notifications: { ...body.notifications, email: { ...body.notifications.email, password: '(changed)' } } }
        : body;
      await audit(db, auth, 'org.settings', 'org', auth.orgId, logged);
      return {
        branding: brandingOf(next),
        uploads: normalizeUploadPolicy(next.uploads),
        notifications: publicNotificationSettings(normalizeNotificationSettings(next.notifications)),
      };
    });
  });

  app.get('/api/admin/audit', async (req) => {
    const q = parse(z.object({ limit: z.coerce.number().int().min(1).max(500).default(100) }), req.query);
    return req.tx(async (db, auth) => {
      requireOrgAdmin(auth);
      return many(
        db,
        `SELECT a.id, a.at, a.action, a.resource_type, a.resource_id, a.detail, a.actor_kind,
                u.display_name AS actor_name
         FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
         ORDER BY a.at DESC LIMIT $1`,
        [q.limit],
      );
    });
  });
}
