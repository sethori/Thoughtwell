import { lazy, Suspense, useState } from 'react';
import { mergeAttributes, Node, NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react';
import { dataAttr } from './attrs';
import { svgDataUrl } from './mermaid';

// Excalidraw is large; it loads only when someone opens a sketch to edit.
const SketchEditor = lazy(() => import('./SketchEditor'));

/**
 * A freehand diagram (boxes, arrows, shapes, text) drawn in Excalidraw. The
 * scene is kept for editing, plus an SVG picture for showing, exporting and review.
 */
export const SketchBlock = Node.create({
  name: 'sketch',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    return { scene: dataAttr('scene', '', false), svg: dataAttr('svg', '', false) };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="sketch"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'sketch' })];
  },
  addNodeView() {
    return ReactNodeViewRenderer(SketchView);
  },
});

function SketchView({ node, updateAttributes, editor, selected }: NodeViewProps) {
  const [editing, setEditing] = useState(false);
  const svg = String(node.attrs.svg ?? '');
  return (
    <NodeViewWrapper className={`embed ${selected ? 'sel' : ''}`} data-drag-handle>
      {svg ? (
        // Shown as an image, so nothing inside the drawing can run as part of the page.
        <img className="diagram" src={svgDataUrl(svg)} alt="Sketch diagram" />
      ) : (
        <div className="chart-empty">Empty sketch. {editor.isEditable ? 'Use Edit sketch to draw.' : ''}</div>
      )}
      {editor.isEditable && (
        <div className="embed-bar" contentEditable={false}>
          <button type="button" className="btn" onClick={() => setEditing(true)}>
            Edit sketch
          </button>
        </div>
      )}
      {editing && (
        <Suspense fallback={<div className="scrim"><div className="dialog">Loading the drawing tools…</div></div>}>
          <SketchEditor
            scene={String(node.attrs.scene ?? '')}
            onClose={() => setEditing(false)}
            onSave={(scene, picture) => {
              updateAttributes({ scene, svg: picture });
              setEditing(false);
            }}
          />
        </Suspense>
      )}
    </NodeViewWrapper>
  );
}
