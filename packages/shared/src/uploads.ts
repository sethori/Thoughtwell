import { type Role, ROLES } from './roles.js';

/**
 * Attachment limits, set by admins in the organization settings.
 * A role override applies to anyone whose effective role on the page is
 * that role; group overrides apply to members of that group.
 * The most generous applicable limit wins, matching additive grants.
 */
export interface UploadPolicy {
  defaultMaxMb: number;
  byRole?: Partial<Record<Role, number>>;
  byGroup?: Record<string, number>;
  /** MIME types or prefixes like "image/". Empty means anything. */
  allowedTypes?: string[];
}

export const DEFAULT_UPLOAD_POLICY: UploadPolicy = {
  defaultMaxMb: 25,
  byRole: {},
  byGroup: {},
  allowedTypes: ['image/', 'application/pdf', 'text/', 'application/vnd.openxmlformats-officedocument.'],
};

export function normalizeUploadPolicy(input: unknown): UploadPolicy {
  const p = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined);
  const byRole: Partial<Record<Role, number>> = {};
  if (p.byRole && typeof p.byRole === 'object') {
    for (const role of ROLES) {
      const v = num((p.byRole as Record<string, unknown>)[role]);
      if (v !== undefined) byRole[role] = v;
    }
  }
  const byGroup: Record<string, number> = {};
  if (p.byGroup && typeof p.byGroup === 'object') {
    for (const [k, v] of Object.entries(p.byGroup as Record<string, unknown>)) {
      const n = num(v);
      if (n !== undefined) byGroup[k] = n;
    }
  }
  const allowedTypes = Array.isArray(p.allowedTypes)
    ? p.allowedTypes.filter((t): t is string => typeof t === 'string')
    : DEFAULT_UPLOAD_POLICY.allowedTypes;
  return { defaultMaxMb: num(p.defaultMaxMb) ?? DEFAULT_UPLOAD_POLICY.defaultMaxMb, byRole, byGroup, allowedTypes };
}

/** Largest file size in bytes this person may attach. */
export function maxUploadBytes(policy: UploadPolicy, role: Role | null, groupIds: string[]): number {
  const candidates = [policy.defaultMaxMb];
  if (role && policy.byRole?.[role] !== undefined) candidates.push(policy.byRole[role]!);
  for (const g of groupIds) {
    const v = policy.byGroup?.[g];
    if (v !== undefined) candidates.push(v);
  }
  return Math.max(...candidates) * 1024 * 1024;
}

export function isAllowedType(policy: UploadPolicy, mime: string): boolean {
  const allowed = policy.allowedTypes ?? [];
  if (allowed.length === 0) return true;
  return allowed.some((t) => (t.endsWith('/') || t.endsWith('.') ? mime.startsWith(t) : mime === t));
}
