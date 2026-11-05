/**
 * Role ladder. Each role includes everything the roles before it can do.
 * Grants are additive: a person's effective role on a resource is the
 * highest role found among all grants that reach it.
 */
export const ROLES = ['viewer', 'contributor', 'editor', 'approver', 'admin'] as const;
export type Role = (typeof ROLES)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

export function roleRank(role: Role): number {
  return ROLES.indexOf(role);
}

/** True when `have` is at least as strong as `need`. A missing role never satisfies. */
export function roleAtLeast(have: Role | null | undefined, need: Role): boolean {
  if (!have) return false;
  return roleRank(have) >= roleRank(need);
}

/** Highest role in the list, or null when there are none. */
export function maxRole(roles: Iterable<Role | null | undefined>): Role | null {
  let best: Role | null = null;
  for (const r of roles) {
    if (r && (best === null || roleRank(r) > roleRank(best))) best = r;
  }
  return best;
}

/** What each role may do. Kept here so the API and the UI agree. */
export const CAPABILITIES = {
  read: 'viewer',
  editDraft: 'contributor',
  createPage: 'contributor',
  manageFolders: 'editor',
  review: 'approver',
  manageAccess: 'admin',
  manageUnit: 'admin',
} as const satisfies Record<string, Role>;

export type Capability = keyof typeof CAPABILITIES;

export function can(role: Role | null | undefined, capability: Capability): boolean {
  return roleAtLeast(role, CAPABILITIES[capability]);
}
