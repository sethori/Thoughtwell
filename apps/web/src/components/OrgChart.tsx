import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { buildTree, UNIT_LABELS, type TreeNode } from '@notes/shared';
import type { Directory, Person, Unit } from '../lib/api';
import { Icon } from './Icon';
import { initials } from './Rail';
import { colorFor, PersonDialog } from './OrgTree';

const SHOW_PEOPLE_KEY = 'thoughtwell.orgchart.people';
const ZOOM_MIN = 0.3;
const ZOOM_MAX = 1.6;

function readShowPeople(): boolean {
  try {
    return localStorage.getItem(SHOW_PEOPLE_KEY) !== 'off';
  } catch {
    return true;
  }
}

/**
 * Where each person appears on the chart: the highest of the units they are
 * assigned to. Someone assigned to a division and to branches inside it shows
 * only at the division. Someone in two unrelated places shows at both.
 */
export function chartPlacement(directory: Directory): Map<string, Person[]> {
  const parent = new Map(directory.units.map((u) => [u.id, u.parent_id]));
  const out = new Map<string, Person[]>();
  for (const p of directory.people) {
    const assigned = new Set(p.unit_ids?.length ? p.unit_ids : p.home_unit_id ? [p.home_unit_id] : []);
    for (const id of assigned) {
      if (!parent.has(id)) continue;
      // Skip this unit when one of its ancestors is also one of theirs.
      let up = parent.get(id) ?? null;
      let covered = false;
      while (up) {
        if (assigned.has(up)) {
          covered = true;
          break;
        }
        up = parent.get(up) ?? null;
      }
      if (!covered) out.set(id, [...(out.get(id) ?? []), p]);
    }
  }
  return out;
}

/** The whole organization as a top-down chart, with people under the unit where they lead. */
export function OrgChart({ directory }: { directory: Directory }) {
  const tree = useMemo(() => buildTree(directory.units, (a, b) => a.name.localeCompare(b.name)), [directory.units]);
  const placed = useMemo(() => chartPlacement(directory), [directory]);
  const [showPeople, setShowPeople] = useState(readShowPeople);
  const [query, setQuery] = useState('');
  const [zoom, setZoom] = useState(1);
  const [person, setPerson] = useState<Person | null>(null);
  // Collapsed units; everything starts open down to division level.
  const [collapsed, setCollapsed] = useState<Set<string>>(
    () => new Set(directory.units.filter((u) => u.type === 'division').map((u) => u.id)),
  );
  const scroller = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      localStorage.setItem(SHOW_PEOPLE_KEY, showPeople ? 'on' : 'off');
    } catch {
      /* storage unavailable: the choice lasts for this visit */
    }
  }, [showPeople]);

  const q = query.trim().toLowerCase();
  // While searching, matching units and units holding matching people light up, and their branches open.
  const { hits, open } = useMemo(() => {
    const hits = new Set<string>();
    const open = new Set<string>();
    if (!q) return { hits, open };
    const parent = new Map(directory.units.map((u) => [u.id, u.parent_id]));
    const mark = (id: string) => {
      hits.add(id);
      let up = parent.get(id) ?? null;
      while (up) {
        open.add(up);
        up = parent.get(up) ?? null;
      }
    };
    for (const u of directory.units) if (u.name.toLowerCase().includes(q)) mark(u.id);
    for (const [unitId, people] of placed) {
      if (people.some((p) => p.display_name.toLowerCase().includes(q) || (p.title ?? '').toLowerCase().includes(q))) mark(unitId);
    }
    return { hits, open };
  }, [q, directory.units, placed]);

  const toggle = (id: string) =>
    setCollapsed((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const fit = useCallback(() => {
    const sc = scroller.current;
    const treeEl = canvas.current?.querySelector('.oc-tree');
    if (!sc || !treeEl) return;
    // The drawn width at the current zoom, back to its size at 100%.
    const natural = treeEl.getBoundingClientRect().width / zoomRef.current;
    const next = Math.min(1, Math.max(ZOOM_MIN, (sc.clientWidth - 32) / natural));
    setZoom(Number(next.toFixed(2)));
    requestAnimationFrame(() => {
      sc.scrollLeft = 0;
      sc.scrollTop = 0;
    });
  }, []);

  // Ctrl/Cmd + wheel zooms, like a map.
  useEffect(() => {
    const sc = scroller.current;
    if (!sc) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setZoom((z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Number((z * (e.deltaY < 0 ? 1.1 : 0.9)).toFixed(2)))));
    };
    sc.addEventListener('wheel', onWheel, { passive: false });
    return () => sc.removeEventListener('wheel', onWheel);
  }, []);

  // Drag the empty background to pan.
  const pan = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button, input, a')) return;
    const sc = scroller.current!;
    pan.current = { x: e.clientX, y: e.clientY, left: sc.scrollLeft, top: sc.scrollTop };
    sc.setPointerCapture(e.pointerId);
    sc.classList.add('panning');
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const p = pan.current;
    if (!p) return;
    const sc = scroller.current!;
    sc.scrollLeft = p.left - (e.clientX - p.x);
    sc.scrollTop = p.top - (e.clientY - p.y);
  };
  const endPan = () => {
    pan.current = null;
    scroller.current?.classList.remove('panning');
  };

  const total = directory.people.length;

  function renderUnit(node: TreeNode<Unit>) {
    const u = node.item;
    const people = placed.get(u.id) ?? [];
    const isOpen = q ? open.has(u.id) || !collapsed.has(u.id) : !collapsed.has(u.id);
    const kids = node.children.length;
    return (
      <li key={u.id}>
        <div className={`oc-card t-${u.type} ${hits.has(u.id) ? 'hit' : ''} ${q && !hits.has(u.id) ? 'dim' : ''}`}>
          <div className="oc-type">{UNIT_LABELS[u.type]}</div>
          <div className="oc-name">{u.name}</div>
          {showPeople && people.length > 0 && (
            <div className="oc-people">
              {people.map((p) => {
                const match = q && (p.display_name.toLowerCase().includes(q) || (p.title ?? '').toLowerCase().includes(q));
                return (
                  <button key={p.id} type="button" className={`oc-person ${match ? 'hit' : ''}`} onClick={() => setPerson(p)} title="Contact details">
                    <span className="avatar sm" style={{ background: colorFor(p.id), color: '#fff' }}>
                      {initials(p.display_name)}
                    </span>
                    <span className="oc-pname">
                      {p.display_name}
                      {(p.title || p.kind === 'agent') && <small>{p.kind === 'agent' ? 'Agent' : p.title}</small>}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
          {!showPeople && people.length > 0 && (
            <div className="oc-count">
              {people.length} {people.length === 1 ? 'person' : 'people'}
            </div>
          )}
          {kids > 0 && (
            <button
              type="button"
              className="oc-toggle"
              aria-expanded={isOpen}
              aria-label={isOpen ? `Collapse ${u.name}` : `Expand ${u.name}`}
              title={isOpen ? 'Collapse' : `Show ${kids} below`}
              onClick={() => toggle(u.id)}
            >
              {isOpen ? <Icon name="minus" small /> : <span>{kids}</span>}
            </button>
          )}
        </div>
        {kids > 0 && isOpen && <ul>{node.children.map(renderUnit)}</ul>}
      </li>
    );
  }

  return (
    <div className="orgchart">
      <div className="topbar">
        <h1 className="title-static">Org chart</h1>
        <span className="chip">
          {directory.units.length} units · {total} {total === 1 ? 'person' : 'people'}
        </span>
        <div className="search oc-search">
          <Icon name="search" small />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a unit or person" aria-label="Find a unit or person" />
        </div>
        <label className="oc-switch" title="Show the people under each unit">
          <input type="checkbox" role="switch" checked={showPeople} onChange={(e) => setShowPeople(e.target.checked)} />
          <span className="track" aria-hidden="true" />
          <span>Show people</span>
        </label>
        <span className="push" />
        <button type="button" className="btn" onClick={() => setCollapsed(new Set())} title="Open every unit">
          Expand all
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => setCollapsed(new Set(directory.units.filter((u) => u.type !== 'org').map((u) => u.id)))}
          title="Close everything below the top"
        >
          Collapse
        </button>
        <span className="sep" />
        <button type="button" className="ib" aria-label="Zoom out" title="Zoom out" onClick={() => setZoom((z) => Math.max(ZOOM_MIN, Number((z - 0.1).toFixed(2))))}>
          <Icon name="minus" small />
        </button>
        <button type="button" className="oc-zoom" onClick={() => setZoom(1)} title="Reset to 100%">
          {Math.round(zoom * 100)}%
        </button>
        <button type="button" className="ib" aria-label="Zoom in" title="Zoom in" onClick={() => setZoom((z) => Math.min(ZOOM_MAX, Number((z + 0.1).toFixed(2))))}>
          <Icon name="plus" small />
        </button>
        <button type="button" className="ib" aria-label="Fit to width" title="Fit to width" onClick={fit}>
          <Icon name="fit" small />
        </button>
      </div>
      <div
        className="oc-scroll"
        ref={scroller}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPan}
        onPointerCancel={endPan}
      >
        <div className="oc-canvas" ref={canvas} style={{ zoom }}>
          {tree.length ? <ul className="oc-tree">{tree.map(renderUnit)}</ul> : <div className="hint">No units yet.</div>}
        </div>
      </div>
      {person && <PersonDialog person={person} directory={directory} onClose={() => setPerson(null)} />}
    </div>
  );
}
