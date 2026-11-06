/**
 * A flowchart drawn by hand on the page: shapes placed on a canvas and
 * arrows between them. Stored as plain data in the block, so it diffs,
 * reviews and exports like everything else.
 */

export const FLOW_SHAPES = ['rect', 'pill', 'diamond', 'ellipse', 'note'] as const;
export type FlowShape = (typeof FLOW_SHAPES)[number];

export const FLOW_SHAPE_LABELS: Record<FlowShape, string> = {
  rect: 'Step',
  pill: 'Start / end',
  diamond: 'Decision',
  ellipse: 'Circle',
  note: 'Note',
};

export interface FlowNode {
  id: string;
  shape: FlowShape;
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
}

export interface FlowEdge {
  id: string;
  from: string;
  to: string;
  label: string;
}

export interface Diagram {
  v: 1;
  nodes: FlowNode[];
  edges: FlowEdge[];
}

export const FLOW_DEFAULT_SIZE: Record<FlowShape, { w: number; h: number }> = {
  rect: { w: 140, h: 56 },
  pill: { w: 140, h: 48 },
  diamond: { w: 120, h: 84 },
  ellipse: { w: 96, h: 96 },
  note: { w: 160, h: 64 },
};

export function emptyDiagram(): Diagram {
  return { v: 1, nodes: [], edges: [] };
}

const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const str = (v: unknown) => (typeof v === 'string' ? v.slice(0, 500) : '');

/** Reads a stored diagram, dropping anything malformed instead of failing. */
export function normalizeDiagram(raw: unknown): Diagram {
  let value = raw;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return emptyDiagram();
    }
  }
  if (!value || typeof value !== 'object') return emptyDiagram();
  const v = value as { nodes?: unknown; edges?: unknown };
  const nodes: FlowNode[] = [];
  const ids = new Set<string>();
  for (const n of Array.isArray(v.nodes) ? v.nodes : []) {
    if (!n || typeof n !== 'object') continue;
    const o = n as Record<string, unknown>;
    const id = str(o.id);
    if (!id || ids.has(id)) continue;
    const shape = (FLOW_SHAPES as readonly string[]).includes(o.shape as string) ? (o.shape as FlowShape) : 'rect';
    const size = FLOW_DEFAULT_SIZE[shape];
    ids.add(id);
    nodes.push({
      id,
      shape,
      x: num(o.x, 0),
      y: num(o.y, 0),
      w: Math.max(24, num(o.w, size.w)),
      h: Math.max(24, num(o.h, size.h)),
      label: str(o.label),
    });
  }
  const edges: FlowEdge[] = [];
  for (const e of Array.isArray(v.edges) ? v.edges : []) {
    if (!e || typeof e !== 'object') continue;
    const o = e as Record<string, unknown>;
    const from = str(o.from);
    const to = str(o.to);
    if (!ids.has(from) || !ids.has(to) || from === to) continue;
    edges.push({ id: str(o.id) || `${from}-${to}`, from, to, label: str(o.label) });
  }
  return { v: 1, nodes, edges };
}

/** Where a line from the shape's centre toward a point leaves the shape's outline. */
export function anchorPoint(n: FlowNode, toward: { x: number; y: number }): { x: number; y: number } {
  const cx = n.x + n.w / 2;
  const cy = n.y + n.h / 2;
  const dx = toward.x - cx;
  const dy = toward.y - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const a = n.w / 2;
  const b = n.h / 2;
  let t: number;
  if (n.shape === 'ellipse') {
    t = 1 / Math.sqrt((dx * dx) / (a * a) + (dy * dy) / (b * b));
  } else if (n.shape === 'diamond') {
    t = 1 / (Math.abs(dx) / a + Math.abs(dy) / b);
  } else {
    t = Math.min(dx === 0 ? Infinity : a / Math.abs(dx), dy === 0 ? Infinity : b / Math.abs(dy));
  }
  return { x: cx + dx * t, y: cy + dy * t };
}

/** The diagram as Mermaid text, so a Markdown export keeps it readable and redrawable elsewhere. */
export function diagramToMermaid(d: Diagram): string {
  const ids = new Map(d.nodes.map((n, i) => [n.id, `n${i + 1}`]));
  const q = (s: string) => `"${(s || ' ').replace(/"/g, '#quot;').replace(/\n/g, ' ')}"`;
  const shape = (n: FlowNode) => {
    const t = q(n.label);
    switch (n.shape) {
      case 'pill':
        return `([${t}])`;
      case 'diamond':
        return `{${t}}`;
      case 'ellipse':
        return `((${t}))`;
      case 'note':
        return `>${t}]`;
      default:
        return `[${t}]`;
    }
  };
  // Top to bottom, in reading order.
  const nodes = [...d.nodes].sort((a, b) => a.y - b.y || a.x - b.x);
  const lines = ['flowchart TD'];
  for (const n of nodes) lines.push(`  ${ids.get(n.id)}${shape(n)}`);
  for (const e of d.edges) {
    const from = ids.get(e.from);
    const to = ids.get(e.to);
    if (!from || !to) continue;
    lines.push(e.label ? `  ${from} -- ${q(e.label)} --> ${to}` : `  ${from} --> ${to}`);
  }
  return lines.join('\n');
}

/** The words in a diagram, for search and change summaries. */
export function diagramText(d: Diagram): string {
  return [...d.nodes.map((n) => n.label), ...d.edges.map((e) => e.label)].filter(Boolean).join(' · ');
}
