import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { deriveScheme, isHexColor, normalizePreferences, THEME_MODES, DENSITIES, ACCENT_PRESETS } from '@notes/shared';
import { many, one } from '../db.js';
import { parse } from '../lib/validate.js';
import { normalizeNotificationSettings } from '../lib/delivery.js';

const prefsBody = z
  .object({
    mode: z.enum(THEME_MODES),
    density: z.enum(DENSITIES),
    accent: z.union([z.enum(Object.keys(ACCENT_PRESETS) as [string, ...string[]]), z.literal('brand')]),
    notify: z.object({ email: z.boolean(), teams: z.boolean() }).partial(),
  })
  .partial();

export function brandingOf(settings: Record<string, unknown> | null | undefined) {
  const b = (settings?.branding ?? {}) as { name?: string; brandColor?: string; logoAssetId?: string };
  return {
    name: b.name ?? null,
    brandColor: isHexColor(b.brandColor) ? b.brandColor : null,
    logoAssetId: b.logoAssetId ?? null,
    scheme: isHexColor(b.brandColor) ? deriveScheme(b.brandColor) : null,
  };
}

export async function meRoutes(app: FastifyInstance) {
  app.get('/api/me', async (req) =>
    req.tx(async (db, auth) => {
      const user = await one<Record<string, unknown>>(
        db,
        `SELECT u.id, u.username, u.display_name, u.email, u.title, u.kind, u.is_org_admin,
                u.home_unit_id, hu.name AS home_unit_name, u.preferences
         FROM users u LEFT JOIN org_units hu ON hu.id = u.home_unit_id
         WHERE u.id = $1`,
        [auth.userId],
      );
      const org = await one<{ id: string; name: string; settings: Record<string, unknown> }>(
        db,
        'SELECT id, name, settings FROM orgs WHERE id = $1',
        [auth.orgId],
      );
      const groups = await many(
        db,
        `SELECT g.id, g.name, g.unit_id, u.name AS unit_name
         FROM group_members gm JOIN groups g ON g.id = gm.group_id JOIN org_units u ON u.id = g.unit_id
         WHERE gm.user_id = $1 ORDER BY g.name`,
        [auth.userId],
      );
      return {
        user: { ...user, preferences: normalizePreferences(user?.preferences) },
        org: {
          id: org?.id,
          name: org?.name,
          branding: brandingOf(org?.settings),
          // Which delivery channels an admin has set up, so people know what they can turn on.
          channels: (() => {
            const n = normalizeNotificationSettings(org?.settings?.notifications);
            return { email: n.email.enabled && Boolean(n.email.host), teams: n.teams.enabled && Boolean(n.teams.webhookUrl) };
          })(),
        },
        groups,
      };
    }),
  );

  app.patch('/api/me/preferences', async (req) => {
    const body = parse(prefsBody, req.body);
    return req.tx(async (db, auth) => {
      const row = await one<{ preferences: unknown }>(db, 'SELECT preferences FROM users WHERE id = $1', [auth.userId]);
      const prev = normalizePreferences(row?.preferences);
      const merged = normalizePreferences({ ...prev, ...body, notify: { ...prev.notify, ...body.notify } });
      await db.query('UPDATE users SET preferences = $2 WHERE id = $1', [auth.userId, merged]);
      return { preferences: merged };
    });
  });
}
