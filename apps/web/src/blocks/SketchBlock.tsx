import { lazy, Suspense, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { mergeAttributes, Node, NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react';
import { Icon } from '../components/Icon';
import { dataAttr } from './attrs';
import { svgDataUrl } from './mermaid';

// Excalidraw is large; it loads only when someone starts drawing.
const SketchEditor = lazy(() => import('./SketchEditor'));

const MIN_HEIGHT = 160;

/**
 * A freehand diagram (boxes, arrows, shapes, text) drawn in Excalidraw, right
 * on the page. The scene is kept for editing, plus an SVG picture for showing,
 * exporting and review.
 */
export const SketchBlock = Node.create({
  name: 'sketch',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    return { scene: dataAttr('scene', '', false), svg: dataAttr('svg', '', false), height: dataAttr('height', 360) };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="sketch"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'sketch' })];
  },
  addNodeView() {
    return ReactNodeViewRenderer(SketchView, {
      // While drawing, Excalidraw gets every key and pointer; the grip still moves the block.
      stopEvent: ({ event }) => !(event.target instanceof Element && event.target.closest('[data-drag-handle]')),
    });
  },
});

function SketchView({ node, updateAttributes, editor, selected }: NodeViewProps) {
  const svg = String(node.attrs.svg ?? '');
  const scene = String(node.attrs.scene ?? '');
  const height = Number(node.attrs.height) || 360;
  const editable = editor.isEditable;
  const [editing, setEditing] = useState(false);
  const [h, setH] = useState(height);
  const opened = useRef(false);
  useEffect(() => setH(height), [height]);

  // A sketch just placed on the page opens ready to draw.
  useEffect(() => {
    if (opened.current || !editable || !selected || scene || svg) return;
    opened.current = true;
    setEditing(true);
  }, [editable, selected, scene, svg]);

  const resize = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = h;
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    let last = startH;
    const move = (ev: PointerEvent) => {
      last = Math.max(MIN_HEIGHT, Math.round(startH + ev.clientY - startY));
      setH(last);
    };
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
      if (last !== startH) updateAttributes({ height: last });
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  };

  return (
    <NodeViewWrapper className={`embed sketch-embed ${selected ? 'sel' : ''} ${editing ? 'drawing' : ''}`}>
      {editable && (
        <span className="embed-grip" data-drag-handle draggable="true" contentEditable={false} title="Drag to move the sketch">
          <Icon name="move" small />
        </span>
      )}
      <div contentEditable={false}>
        {editing ? (
          <Suspense fallback={<div className="chart-empty" style={{ height: h }}>Loading the drawing tools…</div>}>
            <SketchEditor scene={scene} height={h} onSave={(s, picture) => updateAttributes({ scene: s, svg: picture })} onDone={() => setEditing(false)} />
          </Suspense>
        ) : svg ? (
          <button
            type="button"
            className="sketch-preview"
            style={{ height: h }}
            disabled={!editable}
            title={editable ? 'Click to draw' : undefined}
            onClick={() => setEditing(true)}
          >
            {/* Shown as an image, so nothing inside the drawing can run as part of the page. */}
            <img className="diagram" src={svgDataUrl(svg)} alt="Sketch diagram" />
          </button>
        ) : (
          <button type="button" className="sketch-preview empty" style={{ height: h }} disabled={!editable} onClick={() => setEditing(true)}>
            {editable ? 'Empty sketch. Click to draw.' : 'Empty sketch.'}
          </button>
        )}
        {editable && <div className="flow-height" role="separator" aria-label="Drag to change the height" title="Drag to change the height" onPointerDown={resize} />}
      </div>
    </NodeViewWrapper>
  );
}
