/**
 * Org tree levels, top to bottom. Each level may only hold children of the
 * next level down, so right-click "Add" always knows what it creates.
 */
export const UNIT_TYPES = ['org', 'directorate', 'division', 'branch', 'section', 'project'] as const;
export type UnitType = (typeof UNIT_TYPES)[number];

export const UNIT_LABELS: Record<UnitType, string> = {
  org: 'Organization',
  directorate: 'Directorate',
  division: 'Division',
  branch: 'Branch',
  section: 'Section',
  project: 'Project',
};

export function isUnitType(value: unknown): value is UnitType {
  return typeof value === 'string' && (UNIT_TYPES as readonly string[]).includes(value);
}

/** The type a new child of `parent` gets, or null when the level is the last one. */
export function childTypeOf(parent: UnitType): UnitType | null {
  const i = UNIT_TYPES.indexOf(parent);
  return UNIT_TYPES[i + 1] ?? null;
}

/** A unit of `childType` may sit directly under a unit of `parentType`. */
export function canContain(parentType: UnitType, childType: UnitType): boolean {
  return childTypeOf(parentType) === childType;
}

/**
 * ltree labels allow only [A-Za-z0-9_]. Paths are built from ids, never
 * names, so renaming a unit never rewrites a path.
 */
export function pathLabel(id: string): string {
  return 'u' + id.replace(/-/g, '');
}

export function childPath(parentPath: string | null, id: string): string {
  return parentPath ? `${parentPath}.${pathLabel(id)}` : pathLabel(id);
}

/** True when `ancestor` is `path` itself or one of its ancestors. */
export function isAncestorPath(ancestor: string, path: string): boolean {
  return path === ancestor || path.startsWith(ancestor + '.');
}

export interface TreeNode<T> {
  item: T;
  children: TreeNode<T>[];
}

/** Builds a nested tree from flat rows that carry `id` and `parent_id`. */
export function buildTree<T extends { id: string; parent_id: string | null }>(
  rows: T[],
  sort: (a: T, b: T) => number = () => 0,
): TreeNode<T>[] {
  const byId = new Map<string, TreeNode<T>>();
  for (const row of rows) byId.set(row.id, { item: row, children: [] });
  const roots: TreeNode<T>[] = [];
  for (const node of byId.values()) {
    const parent = node.item.parent_id ? byId.get(node.item.parent_id) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const sortRec = (nodes: TreeNode<T>[]) => {
    nodes.sort((a, b) => sort(a.item, b.item));
    nodes.forEach((n) => sortRec(n.children));
  };
  sortRec(roots);
  return roots;
}
