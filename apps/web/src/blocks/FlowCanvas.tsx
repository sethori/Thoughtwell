import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  anchorPoint,
  FLOW_DEFAULT_SIZE,
  FLOW_SHAPE_LABELS,
  FLOW_SHAPES,
  type Diagram,
  type FlowEdge,
  type FlowNode,
  type FlowShape,
} from '@notes/shared';
import { Icon, type IconName } from '../components/Icon';

const SNAP = 8;
const snap = (v: number) => Math.round(v / SNAP) * SNAP;
const newId = () => Math.random().toString(36).slice(2, 10);
const MIN_HEIGHT = 160;

const SHAPE_ICON: Record<FlowShape, IconName> = { rect: 'rect', pill: 'pill', diamond: 'diamond', ellipse: 'circle', note: 'callout' };

type Selection = { kind: 'node' | 'edge'; id: string } | null;

/** What the pointer is doing on the canvas. */
type Gesture =
  | { kind: 'move'; id: string; dx: number; dy: number; moved: boolean }
  | { kind: 'resize'; id: string; x: number; y: number; w: number; h: number }
  | { kind: 'connect'; from: string; x: number; y: number }
  | { kind: 'add'; shape: FlowShape; x: number; y: number; over: boolean }
  | { kind: 'height'; startY: number; startH: number };

function ShapeOutline({ n, className }: { n: FlowNode; className?: string }) {
  const { x, y, w, h } = n;
  switch (n.shape) {
    case 'pill':
      return <rect className={className} x={x} y={y} width={w} height={h} rx={h / 2} />;
    case 'diamond':
      return <polygon className={className} points={`${x + w / 2},${y} ${x + w},${y + h / 2} ${x + w / 2},${y + h} ${x},${y + h / 2}`} />;
    case 'ellipse':
      return <ellipse className={className} cx={x + w / 2} cy={y + h / 2} rx={w / 2} ry={h / 2} />;
    case 'note':
      return <path className={`${className ?? ''} note`} d={`M${x} ${y}h${w - 14}l14 14v${h - 14}h${-w}z`} />;
    default:
      return <rect className={className} x={x} y={y} width={w} height={h} rx={6} />;
  }
}

/**
 * A flowchart drawn right on the page. Drag shapes in from the palette (or
 * click one to add it below the selected shape, already connected), drag a
 * shape to move it, drag from a dot on its edge to another shape to connect
 * them, and double-click anything to type its label.
 */
export function FlowCanvas({
  diagram,
  height,
  editable,
  onChange,
  onHeight,
}: {
  diagram: Diagram;
  height: number;
  editable: boolean;
  onChange: (d: Diagram) => void;
  onHeight: (h: number) => void;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const [d, setD] = useState(diagram);
  const [h, setH] = useState(height);
  const [sel, setSel] = useState<Selection>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [editing, setEditing] = useState<Selection>(null);
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const gestureRef = useRef<Gesture | null>(null);
  gestureRef.current = gesture;
  const dRef = useRef(d);
  dRef.current = d;
  const wrap = useRef<HTMLDivElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const [viewW, setViewW] = useState(600);

  // Take in changes from others, except mid-gesture or while typing a label.
  useEffect(() => {
    if (!gestureRef.current && !editing) setD(diagram);
  }, [diagram, editing]);
  useEffect(() => {
    if (!gestureRef.current) setH(height);
  }, [height]);

  useLayoutEffect(() => {
    const el = scroll.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewW(el.clientWidth));
    ro.observe(el);
    setViewW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const byId = useMemo(() => new Map(d.nodes.map((n) => [n.id, n])), [d.nodes]);
  const bounds = useMemo(() => {
    let right = 0;
    let bottom = 0;
    let left = Infinity;
    let top = Infinity;
    for (const n of d.nodes) {
      right = Math.max(right, n.x + n.w);
      bottom = Math.max(bottom, n.y + n.h);
      left = Math.min(left, n.x);
      top = Math.min(top, n.y);
    }
    return { left: d.nodes.length ? left : 0, top: d.nodes.length ? top : 0, right, bottom };
  }, [d.nodes]);

  const commit = (next: Diagram) => {
    setD(next);
    onChange(next);
  };

  const point = (e: { clientX: number; clientY: number }) => {
    const r = svg.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const nodeAt = (x: number, y: number, except?: string) =>
    [...dRef.current.nodes].reverse().find((n) => n.id !== except && x >= n.x && x <= n.x + n.w && y >= n.y && y <= n.y + n.h);

  function addNode(shape: FlowShape, at?: { x: number; y: number }, connectFrom?: string) {
    const size = FLOW_DEFAULT_SIZE[shape];
    const cur = dRef.current;
    let x: number;
    let y: number;
    const from = connectFrom ? cur.nodes.find((n) => n.id === connectFrom) : undefined;
    if (at) {
      x = at.x - size.w / 2;
      y = at.y - size.h / 2;
    } else if (from) {
      // Below the selected shape, lined up on its centre.
      x = from.x + from.w / 2 - size.w / 2;
      y = from.y + from.h + 48;
    } else if (cur.nodes.length) {
      x = bounds.left;
      y = bounds.bottom + 48;
    } else {
      x = Math.max(24, viewW / 2 - size.w / 2);
      y = 24;
    }
    const node: FlowNode = { id: newId(), shape, x: snap(Math.max(0, x)), y: snap(Math.max(0, y)), ...size, label: '' };
    const edges = from ? [...cur.edges, { id: newId(), from: from.id, to: node.id, label: '' }] : cur.edges;
    commit({ ...cur, nodes: [...cur.nodes, node], edges });
    setSel({ kind: 'node', id: node.id });
    setEditing({ kind: 'node', id: node.id });
    // Grow the canvas when the new shape lands below it.
    if (node.y + node.h + 24 > h) {
      const nh = node.y + node.h + 48;
      setH(nh);
      onHeight(nh);
    }
  }

  function remove(s: Selection) {
    if (!s) return;
    const cur = dRef.current;
    if (s.kind === 'node') {
      commit({ ...cur, nodes: cur.nodes.filter((n) => n.id !== s.id), edges: cur.edges.filter((e) => e.from !== s.id && e.to !== s.id) });
    } else {
      commit({ ...cur, edges: cur.edges.filter((e) => e.id !== s.id) });
    }
    setSel(null);
  }

  function setLabel(s: NonNullable<Selection>, label: string) {
    const cur = dRef.current;
    if (s.kind === 'node') commit({ ...cur, nodes: cur.nodes.map((n) => (n.id === s.id ? { ...n, label } : n)) });
    else commit({ ...cur, edges: cur.edges.map((e) => (e.id === s.id ? { ...e, label } : e)) });
  }

  function setShape(id: string, shape: FlowShape) {
    const cur = dRef.current;
    commit({ ...cur, nodes: cur.nodes.map((n) => (n.id === id ? { ...n, shape } : n)) });
  }

  // ---------------------------------------------------------------- pointer handling

  const start = (e: ReactPointerEvent, g: Gesture) => {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    setGesture(g);
  };

  // Window listeners follow the pointer even when it leaves the canvas.
  useEffect(() => {
    if (!gesture) return;
    const move = (e: PointerEvent) => {
      const g = gestureRef.current;
      if (!g || !svg.current) return;
      const p = point(e);
      if (g.kind === 'move') {
        const x = snap(Math.max(0, p.x - g.dx));
        const y = snap(Math.max(0, p.y - g.dy));
        setD((cur) => ({ ...cur, nodes: cur.nodes.map((n) => (n.id === g.id ? { ...n, x, y } : n)) }));
        if (!g.moved) setGesture({ ...g, moved: true });
      } else if (g.kind === 'resize') {
        const w = snap(Math.max(40, g.w + p.x - g.x));
        const hh = snap(Math.max(32, g.h + p.y - g.y));
        setD((cur) => ({ ...cur, nodes: cur.nodes.map((n) => (n.id === g.id ? { ...n, w, h: hh } : n)) }));
      } else if (g.kind === 'connect') {
        setGesture({ ...g, x: p.x, y: p.y });
      } else if (g.kind === 'add') {
        const r = scroll.current!.getBoundingClientRect();
        const over = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
        setGesture({ ...g, x: p.x, y: p.y, over });
      } else if (g.kind === 'height') {
        setH(Math.max(MIN_HEIGHT, Math.round(g.startH + e.clientY - g.startY)));
      }
    };
    const up = (e: PointerEvent) => {
      const g = gestureRef.current;
      setGesture(null);
      if (!g || !svg.current) return;
      const p = point(e);
      if (g.kind === 'move' || g.kind === 'resize') {
        if (g.kind === 'resize' || g.moved) onChange(dRef.current);
      } else if (g.kind === 'connect') {
        const target = nodeAt(p.x, p.y, g.from);
        const cur = dRef.current;
        if (target) {
          if (!cur.edges.some((x) => x.from === g.from && x.to === target.id)) {
            commit({ ...cur, edges: [...cur.edges, { id: newId(), from: g.from, to: target.id, label: '' }] });
          }
        } else {
          const from = byId.get(g.from);
          if (from) {
            const dist = Math.hypot(p.x - (from.x + from.w / 2), p.y - (from.y + from.h / 2));
            // Dropped on empty space: a new step there, already connected.
            if (dist > Math.max(from.w, from.h)) addNode('rect', p, g.from);
          }
        }
      } else if (g.kind === 'add') {
        if (g.over) addNode(g.shape, p);
      } else if (g.kind === 'height') {
        onHeight(Math.max(MIN_HEIGHT, Math.round(g.startH + e.clientY - g.startY)));
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
    // Only (re)attach when a gesture starts or ends.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Boolean(gesture)]);

  /** A palette shape: drag it onto the canvas, or click it to add one below the selected shape. */
  const pressPalette = (e: ReactPointerEvent, shape: FlowShape) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const sx = e.clientX;
    const sy = e.clientY;
    const moveCheck = (ev: PointerEvent) => {
      if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 5) return;
      cleanup();
      const p = point(ev);
      setGesture({ kind: 'add', shape, x: p.x, y: p.y, over: false });
    };
    const upCheck = () => {
      cleanup();
      addNode(shape, undefined, sel?.kind === 'node' ? sel.id : undefined);
    };
    const cleanup = () => {
      window.removeEventListener('pointermove', moveCheck);
      window.removeEventListener('pointerup', upCheck);
    };
    window.addEventListener('pointermove', moveCheck);
    window.addEventListener('pointerup', upCheck);
  };

  // ---------------------------------------------------------------- drawing

  const pad = 24;
  const svgW = editable ? Math.max(viewW, bounds.right + pad) : Math.max(1, bounds.right + pad);
  const svgH = editable ? Math.max(h, bounds.bottom + pad) : Math.max(1, bounds.bottom + pad);
  const marker = `${uid}-arrow`;

  const edgeLine = (e: FlowEdge) => {
    const a = byId.get(e.from);
    const b = byId.get(e.to);
    if (!a || !b) return null;
    const p1 = anchorPoint(a, { x: b.x + b.w / 2, y: b.y + b.h / 2 });
    const p2 = anchorPoint(b, { x: a.x + a.w / 2, y: a.y + a.h / 2 });
    return { p1, p2, mid: { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 } };
  };

  const selNode = sel?.kind === 'node' ? byId.get(sel.id) : undefined;
  const editNode = editing?.kind === 'node' ? byId.get(editing.id) : undefined;
  const editEdge = editing?.kind === 'edge' ? d.edges.find((x) => x.id === editing.id) : undefined;
  const editEdgeLine = editEdge ? edgeLine(editEdge) : null;

  if (!editable) {
    if (!d.nodes.length) return <div className="chart-empty">Empty flowchart.</div>;
    // Read-only: the drawing scaled to fit the page width.
    return (
      <svg
        className="flow-svg readonly"
        viewBox={`${Math.max(0, bounds.left - pad)} ${Math.max(0, bounds.top - pad)} ${svgW - Math.max(0, bounds.left - pad)} ${svgH - Math.max(0, bounds.top - pad)}`}
        style={{ maxHeight: Math.max(height, 120) }}
        role="img"
        aria-label="Flowchart"
      >
        <Defs marker={marker} />
        <Drawing d={d} edgeLine={edgeLine} marker={marker} sel={null} hover={null} />
      </svg>
    );
  }

  return (
    <div
      className="flow"
      ref={wrap}
      tabIndex={0}
      onKeyDown={(e) => {
        if (editing) return;
        if ((e.key === 'Delete' || e.key === 'Backspace') && sel) {
          e.preventDefault();
          remove(sel);
        } else if (e.key === 'Escape') {
          setSel(null);
        } else if (e.key === 'Enter' && sel) {
          e.preventDefault();
          setEditing(sel);
        }
      }}
    >
      <div className="flow-palette" role="toolbar" aria-label="Shapes">
        {FLOW_SHAPES.map((s) => (
          <button
            key={s}
            type="button"
            className="ib"
            title={`${FLOW_SHAPE_LABELS[s]}: drag onto the canvas, or click to add${sel?.kind === 'node' ? ' below the selected shape' : ''}`}
            aria-label={`Add ${FLOW_SHAPE_LABELS[s].toLowerCase()}`}
            onPointerDown={(e) => pressPalette(e, s)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                addNode(s, undefined, sel?.kind === 'node' ? sel.id : undefined);
              }
            }}
          >
            <Icon name={SHAPE_ICON[s]} small />
          </button>
        ))}
        {sel && (
          <>
            <span className="flow-sep" />
            <button type="button" className="ib" title="Delete (Del)" aria-label="Delete selected" onClick={() => remove(sel)}>
              <Icon name="trash" small />
            </button>
          </>
        )}
      </div>
      {selNode && (
        <div className="flow-shapebar" role="toolbar" aria-label="Change shape">
          {FLOW_SHAPES.map((s) => (
            <button
              key={s}
              type="button"
              className={`ib ${selNode.shape === s ? 'on' : ''}`}
              title={`Make it a ${FLOW_SHAPE_LABELS[s].toLowerCase()}`}
              aria-pressed={selNode.shape === s}
              onClick={() => setShape(selNode.id, s)}
            >
              <Icon name={SHAPE_ICON[s]} small />
            </button>
          ))}
        </div>
      )}
      <div className="flow-scroll" ref={scroll} style={{ height: h }}>
        <div className="flow-inner" style={{ width: svgW, height: svgH }}>
          <svg
            ref={svg}
            className={`flow-svg ${gesture?.kind === 'connect' ? 'connecting' : ''}`}
            width={svgW}
            height={svgH}
            viewBox={`0 0 ${svgW} ${svgH}`}
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              // Focusing the canvas first lets a label being typed save itself.
              wrap.current?.focus({ preventScroll: true });
              setSel(null);
              setEditing(null);
            }}
            onDoubleClick={(e) => {
              if (e.target === svg.current) addNode('rect', point(e));
            }}
          >
            <Defs marker={marker} />
            <rect className="flow-grid" width={svgW} height={svgH} fill={`url(#${uid}-grid)`} />
            <Drawing
              d={d}
              edgeLine={edgeLine}
              marker={marker}
              sel={sel}
              hover={hover}
              onNodeDown={(e, n) => {
                if (e.button !== 0) return;
                wrap.current?.focus({ preventScroll: true });
                setSel({ kind: 'node', id: n.id });
                setEditing(null);
                const p = point(e);
                start(e, { kind: 'move', id: n.id, dx: p.x - n.x, dy: p.y - n.y, moved: false });
              }}
              onNodeEnter={(n) => setHover(n.id)}
              onNodeLeave={() => setHover(null)}
              onNodeDouble={(n) => {
                setSel({ kind: 'node', id: n.id });
                setEditing({ kind: 'node', id: n.id });
              }}
              onEdgeDown={(e, edge) => {
                e.stopPropagation();
                wrap.current?.focus({ preventScroll: true });
                setSel({ kind: 'edge', id: edge.id });
              }}
              onEdgeDouble={(edge) => {
                setSel({ kind: 'edge', id: edge.id });
                setEditing({ kind: 'edge', id: edge.id });
              }}
              onHandleDown={(e, n) => {
                if (e.button !== 0) return;
                const p = point(e);
                setSel({ kind: 'node', id: n.id });
                start(e, { kind: 'connect', from: n.id, x: p.x, y: p.y });
              }}
              onResizeDown={(e, n) => {
                if (e.button !== 0) return;
                const p = point(e);
                start(e, { kind: 'resize', id: n.id, x: p.x, y: p.y, w: n.w, h: n.h });
              }}
            />
            {gesture?.kind === 'connect' &&
              (() => {
                const from = byId.get(gesture.from);
                if (!from) return null;
                const a = anchorPoint(from, gesture);
                return <line className="flow-edge pending" x1={a.x} y1={a.y} x2={gesture.x} y2={gesture.y} markerEnd={`url(#${marker})`} />;
              })()}
            {gesture?.kind === 'add' && gesture.over && (
              <ShapeOutline
                className="flow-node ghost"
                n={{ id: 'ghost', shape: gesture.shape, label: '', ...FLOW_DEFAULT_SIZE[gesture.shape], x: gesture.x - FLOW_DEFAULT_SIZE[gesture.shape].w / 2, y: gesture.y - FLOW_DEFAULT_SIZE[gesture.shape].h / 2 }}
              />
            )}
          </svg>
          {editNode && (
            <LabelInput
              key={editNode.id}
              initial={editNode.label}
              style={{ left: editNode.x, top: editNode.y, width: editNode.w, height: editNode.h }}
              onDone={(label) => {
                if (label !== editNode.label) setLabel({ kind: 'node', id: editNode.id }, label);
                setEditing(null);
                wrap.current?.focus({ preventScroll: true });
              }}
            />
          )}
          {editEdge && editEdgeLine && (
            <LabelInput
              key={editEdge.id}
              initial={editEdge.label}
              single
              style={{ left: editEdgeLine.mid.x - 60, top: editEdgeLine.mid.y - 14, width: 120, height: 28 }}
              onDone={(label) => {
                if (label !== editEdge.label) setLabel({ kind: 'edge', id: editEdge.id }, label);
                setEditing(null);
                wrap.current?.focus({ preventScroll: true });
              }}
            />
          )}
        </div>
        {!d.nodes.length && !gesture && (
          <div className="flow-empty">Drag a shape from the left onto the canvas, or double-click anywhere to add a step.</div>
        )}
      </div>
      <div
        className="flow-height"
        role="separator"
        aria-orientation="horizontal"
        aria-label="Drag to change the height"
        title="Drag to change the height"
        onPointerDown={(e) => start(e, { kind: 'height', startY: e.clientY, startH: h })}
      />
    </div>
  );
}

function Defs({ marker }: { marker: string }) {
  const grid = marker.replace(/-arrow$/, '-grid');
  return (
    <defs>
      <marker id={marker} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
        <path d="M0 0L10 5L0 10z" className="flow-arrow" />
      </marker>
      <pattern id={grid} width={16} height={16} patternUnits="userSpaceOnUse">
        <circle cx={1} cy={1} r={1} className="flow-dot" />
      </pattern>
    </defs>
  );
}

interface DrawingProps {
  d: Diagram;
  edgeLine: (e: FlowEdge) => { p1: { x: number; y: number }; p2: { x: number; y: number }; mid: { x: number; y: number } } | null;
  marker: string;
  sel: Selection;
  hover: string | null;
  onNodeDown?: (e: ReactPointerEvent, n: FlowNode) => void;
  onNodeEnter?: (n: FlowNode) => void;
  onNodeLeave?: () => void;
  onNodeDouble?: (n: FlowNode) => void;
  onEdgeDown?: (e: ReactPointerEvent, edge: FlowEdge) => void;
  onEdgeDouble?: (edge: FlowEdge) => void;
  onHandleDown?: (e: ReactPointerEvent, n: FlowNode) => void;
  onResizeDown?: (e: ReactPointerEvent, n: FlowNode) => void;
}

function Drawing(p: DrawingProps) {
  const { d, edgeLine, marker, sel, hover } = p;
  return (
    <>
      {d.edges.map((e) => {
        const l = edgeLine(e);
        if (!l) return null;
        const on = sel?.kind === 'edge' && sel.id === e.id;
        const lw = Math.min(160, e.label.length * 7 + 14);
        return (
          <g key={e.id} className={`flow-edge-g ${on ? 'sel' : ''}`}>
            <line
              className="flow-edge-hit"
              x1={l.p1.x}
              y1={l.p1.y}
              x2={l.p2.x}
              y2={l.p2.y}
              onPointerDown={p.onEdgeDown ? (ev) => p.onEdgeDown!(ev, e) : undefined}
              onDoubleClick={p.onEdgeDouble ? () => p.onEdgeDouble!(e) : undefined}
            />
            <line className="flow-edge" x1={l.p1.x} y1={l.p1.y} x2={l.p2.x} y2={l.p2.y} markerEnd={`url(#${marker})`} />
            {e.label && (
              <foreignObject x={l.mid.x - lw / 2} y={l.mid.y - 11} width={lw} height={22} className="flow-edge-label-fo">
                <div className="flow-edge-label">{e.label}</div>
              </foreignObject>
            )}
          </g>
        );
      })}
      {d.nodes.map((n) => {
        const on = sel?.kind === 'node' && sel.id === n.id;
        const showHandles = p.onHandleDown && (on || hover === n.id);
        const cx = n.x + n.w / 2;
        const cy = n.y + n.h / 2;
        return (
          <g
            key={n.id}
            className={`flow-node-g ${on ? 'sel' : ''}`}
            data-node={n.id}
            onPointerDown={p.onNodeDown ? (e) => p.onNodeDown!(e, n) : undefined}
            onPointerEnter={p.onNodeEnter ? () => p.onNodeEnter!(n) : undefined}
            onPointerLeave={p.onNodeLeave}
            onDoubleClick={
              p.onNodeDouble
                ? (e) => {
                    e.stopPropagation();
                    p.onNodeDouble!(n);
                  }
                : undefined
            }
          >
            <ShapeOutline n={n} className={`flow-node s-${n.shape}`} />
            <foreignObject x={n.x + 4} y={n.y + 2} width={Math.max(1, n.w - 8)} height={Math.max(1, n.h - 4)} className="flow-label-fo">
              <div className={`flow-label ${n.label ? '' : 'empty'}`}>{n.label || (p.onNodeDown ? FLOW_SHAPE_LABELS[n.shape] : '')}</div>
            </foreignObject>
            {showHandles &&
              [
                { x: cx, y: n.y },
                { x: n.x + n.w, y: cy },
                { x: cx, y: n.y + n.h },
                { x: n.x, y: cy },
              ].map((h, i) => (
                <circle key={i} className="flow-handle" cx={h.x} cy={h.y} r={5} onPointerDown={(e) => p.onHandleDown!(e, n)}>
                  <title>Drag to connect</title>
                </circle>
              ))}
            {on && p.onResizeDown && (
              <rect className="flow-resize" x={n.x + n.w - 5} y={n.y + n.h - 5} width={10} height={10} onPointerDown={(e) => p.onResizeDown!(e, n)}>
                <title>Drag to resize</title>
              </rect>
            )}
          </g>
        );
      })}
    </>
  );
}

function LabelInput({
  initial,
  style,
  single,
  onDone,
}: {
  initial: string;
  style: { left: number; top: number; width: number; height: number };
  single?: boolean;
  onDone: (label: string) => void;
}) {
  const [v, setV] = useState(initial);
  const ref = useRef<HTMLTextAreaElement>(null);
  const done = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const finish = (value: string) => {
    if (done.current) return;
    done.current = true;
    onDone(value.trim());
  };
  return (
    <textarea
      ref={ref}
      className={`flow-input ${single ? 'single' : ''}`}
      style={style}
      value={v}
      maxLength={500}
      aria-label="Label"
      onChange={(e) => setV(e.target.value)}
      onPointerDown={(e) => e.stopPropagation()}
      onBlur={() => finish(v)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') {
          e.preventDefault();
          finish(initial);
        } else if (e.key === 'Enter' && (single || !e.shiftKey)) {
          e.preventDefault();
          finish(v);
        }
      }}
    />
  );
}
