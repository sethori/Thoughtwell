import type { Preferences, Role, UnitType, DerivedScheme } from '@notes/shared';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const isForm = body instanceof FormData;
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: body !== undefined && !isForm ? { 'Content-Type': 'application/json' } : {},
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = (data as { error?: { code: string; message: string } }).error;
    throw new ApiError(res.status, err?.code ?? 'error', err?.message ?? res.statusText);
  }
  return data as T;
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body?: unknown) => request<T>('POST', url, body ?? {}),
  put: <T>(url: string, body: unknown) => request<T>('PUT', url, body),
  patch: <T>(url: string, body: unknown) => request<T>('PATCH', url, body),
  del: <T = void>(url: string) => request<T>('DELETE', url),
};

// ---------- response shapes

export type PageStatus = 'draft' | 'published' | 'changed';

export interface Me {
  user: {
    id: string;
    username: string;
    display_name: string;
    title: string | null;
    kind: 'person' | 'agent';
    is_org_admin: boolean;
    home_unit_name: string | null;
    preferences: Preferences;
  };
  org: { id: string; name: string; branding: { name: string | null; brandColor: string | null; scheme: DerivedScheme | null } };
  groups: { id: string; name: string; unit_name: string }[];
}

export interface Unit {
  id: string;
  parent_id: string | null;
  type: UnitType;
  name: string;
  people?: number;
  role?: Role;
}

export interface Person {
  id: string;
  display_name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  home_unit_id: string | null;
  kind: 'person' | 'agent';
}

export interface Directory {
  units: Unit[];
  people: Person[];
  manageableUnitIds: string[];
}

export interface Folder {
  id: string;
  unit_id: string;
  parent_id: string | null;
  name: string;
  role: Role;
  watching: boolean;
  page_count: number;
}

export interface PageSummary {
  id: string;
  title: string;
  status: PageStatus;
  updated_at: string;
  folder_name?: string;
  unit_name?: string;
  shared_by?: string | null;
}

export interface Workspace {
  units: Unit[];
  folders: Folder[];
  recent: PageSummary[];
  shared: PageSummary[];
  groups: { id: string; name: string; unit_name: string; members: number }[];
}

export interface PMDoc {
  type: 'doc';
  content?: unknown[];
}

export interface Page {
  id: string;
  title: string;
  folder_id: string;
  status: PageStatus;
  role: Role;
  breadcrumb: { id: string; name: string; kind: 'unit' | 'folder' }[];
  draft: { content: PMDoc; rev: number; updatedAt: string; updatedBy: string | null } | null;
  published: { number: number; title: string; content: PMDoc; at: string } | null;
}

export interface Grant {
  id: string;
  principal_type: 'user' | 'group';
  principal_id: string;
  principal_name: string;
  role: Role;
}
