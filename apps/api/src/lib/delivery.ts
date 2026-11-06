import type pg from 'pg';
import { describeNotification, normalizePreferences, type NotificationPayload } from '@notes/shared';
import { many, one, withOrg } from '../db.js';

/** Organization-wide delivery settings, set by an admin. In-app notifications need none. */
export interface NotificationSettings {
  email: { enabled: boolean; host: string; port: number; secure: boolean; username: string; password: string; from: string };
  /**
   * A Power Automate (Teams Workflows) "When an HTTP request is received" URL.
   * The flow receives { to, subject, text, url } and posts to that person in Teams.
   */
  teams: { enabled: boolean; webhookUrl: string };
}

export function normalizeNotificationSettings(raw: unknown): NotificationSettings {
  const r = (raw ?? {}) as { email?: Record<string, unknown>; teams?: Record<string, unknown> };
  const e = r.email ?? {};
  const t = r.teams ?? {};
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  return {
    email: {
      enabled: e.enabled === true,
      host: str(e.host),
      port: Number.isInteger(e.port) ? (e.port as number) : 587,
      secure: e.secure === true,
      username: str(e.username),
      password: str(e.password),
      from: str(e.from),
    },
    teams: { enabled: t.enabled === true, webhookUrl: str(t.webhookUrl) },
  };
}

/** The settings as an admin sees them: the SMTP password is never sent back. */
export function publicNotificationSettings(s: NotificationSettings) {
  const { password, ...email } = s.email;
  return { email: { ...email, passwordSet: password.length > 0 }, teams: s.teams };
}

export interface Message {
  to: string;
  toName: string;
  subject: string;
  text: string;
  url: string;
}

export interface Senders {
  email(settings: NotificationSettings['email'], m: Message): Promise<void>;
  teams(settings: NotificationSettings['teams'], m: Message): Promise<void>;
}

export const defaultSenders: Senders = {
  async email(s, m) {
    const nodemailer = await import('nodemailer');
    const transport = nodemailer.createTransport({
      host: s.host,
      port: s.port,
      secure: s.secure,
      auth: s.username ? { user: s.username, pass: s.password } : undefined,
    });
    await transport.sendMail({
      from: s.from || s.username,
      to: m.toName ? `"${m.toName.replace(/"/g, '')}" <${m.to}>` : m.to,
      subject: m.subject,
      text: m.url ? `${m.text}\n\nOpen it: ${m.url}` : m.text,
    });
  },
  async teams(s, m) {
    const res = await fetch(s.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'thoughtwell.notification', to: m.to, toName: m.toName, subject: m.subject, text: m.text, url: m.url }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Teams workflow returned ${res.status}`);
  },
};

export interface Dispatcher {
  /** Delivers this organization's pending notifications soon. */
  kick(orgId: string): void;
  /** Delivers now and waits (tests and the admin test button). */
  run(orgId: string): Promise<void>;
  sendTest(orgId: string, userId: string): Promise<{ email: string; teams: string }>;
  close(): void;
}

interface Pending {
  id: string;
  type: string;
  payload: NotificationPayload;
  email: string | null;
  display_name: string;
  preferences: unknown;
}

/**
 * Sends pending notifications by email and Teams, as each person chose.
 * Runs after requests and on a timer, so a mail server that is down only
 * delays messages; after three failed tries a message is given up on.
 */
export function createDispatcher(pool: pg.Pool, publicUrl: string, senders: Senders = defaultSenders, intervalMs = 60_000): Dispatcher {
  const orgs = new Set<string>();
  const running = new Map<string, Promise<void>>();
  const attempts = new Map<string, number>();

  const link = (p: NotificationPayload) => (publicUrl ? `${publicUrl}/?page=${p.pageId}` : '');

  async function deliverOrg(orgId: string): Promise<void> {
    await withOrg(pool, orgId, async (db) => {
      const org = await one<{ settings: Record<string, unknown> }>(db, 'SELECT settings FROM orgs WHERE id = $1', [orgId]);
      const settings = normalizeNotificationSettings(org?.settings?.notifications);
      const rows = await many<Pending>(
        db,
        `SELECT n.id, n.type, n.payload, u.email, u.display_name, u.preferences
         FROM notifications n JOIN users u ON u.id = n.user_id
         WHERE n.delivered_at IS NULL ORDER BY n.created_at LIMIT 100
         FOR UPDATE OF n SKIP LOCKED`,
      );
      for (const row of rows) {
        const prefs = normalizePreferences(row.preferences).notify;
        const { title, body } = describeNotification(row.type, row.payload);
        const m: Message = { to: row.email ?? '', toName: row.display_name, subject: title, text: body, url: link(row.payload) };
        const errors: string[] = [];
        if (m.to && prefs.email && settings.email.enabled && settings.email.host) {
          await senders.email(settings.email, m).catch((e: Error) => errors.push(`email: ${e.message}`));
        }
        if (m.to && prefs.teams && settings.teams.enabled && settings.teams.webhookUrl) {
          await senders.teams(settings.teams, m).catch((e: Error) => errors.push(`teams: ${e.message}`));
        }
        const tries = (attempts.get(row.id) ?? 0) + 1;
        if (errors.length && tries < 3) {
          attempts.set(row.id, tries);
          continue; // try again on the next run
        }
        attempts.delete(row.id);
        await db.query('UPDATE notifications SET delivered_at = now(), delivery_error = $2 WHERE id = $1', [
          row.id,
          errors.length ? errors.join('; ').slice(0, 1000) : null,
        ]);
      }
    });
  }

  const run = (orgId: string): Promise<void> => {
    orgs.add(orgId);
    const current = running.get(orgId);
    if (current) return current.then(() => run(orgId));
    const p = deliverOrg(orgId)
      .catch((err) => console.error('notification delivery failed', err))
      .finally(() => running.delete(orgId));
    running.set(orgId, p);
    return p;
  };

  const timer = setInterval(() => {
    for (const orgId of orgs) void run(orgId);
  }, intervalMs);
  timer.unref();

  return {
    kick(orgId) {
      setImmediate(() => void run(orgId));
    },
    run,
    async sendTest(orgId, userId) {
      return withOrg(pool, orgId, async (db) => {
        const org = await one<{ settings: Record<string, unknown> }>(db, 'SELECT settings FROM orgs WHERE id = $1', [orgId]);
        const settings = normalizeNotificationSettings(org?.settings?.notifications);
        const u = await one<{ email: string | null; display_name: string }>(db, 'SELECT email, display_name FROM users WHERE id = $1', [userId]);
        const m: Message = {
          to: u?.email ?? '',
          toName: u?.display_name ?? '',
          subject: 'Test notification from Notes',
          text: 'If you can read this, notifications reach you here.',
          url: publicUrl,
        };
        const result = { email: 'not enabled', teams: 'not enabled' };
        if (!m.to) return { email: 'your account has no email address', teams: 'your account has no email address' };
        if (settings.email.enabled) {
          result.email = await senders.email(settings.email, m).then(() => 'sent', (e: Error) => `failed: ${e.message}`);
        }
        if (settings.teams.enabled) {
          result.teams = await senders.teams(settings.teams, m).then(() => 'sent', (e: Error) => `failed: ${e.message}`);
        }
        return result;
      });
    },
    close() {
      clearInterval(timer);
    },
  };
}
