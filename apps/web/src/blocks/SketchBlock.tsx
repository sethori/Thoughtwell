import { lazy, Suspense, useState } from 'react';
import { mergeAttributes, Node, NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react';
import { ATTACHMENTS_DIR, dirname, joinPath, SKETCH_SUFFIX } from '@notes/shared';
import { currentNotePath, errorText, resolveFromNote, tw, vaultUrl } from '../lib/vault';

// Excalidraw is large; it loads only when someone opens a sketch to edit.
const SketchEditor = lazy(() => import('./SketchEditor'));

/**
 * A freehand diagram drawn in Excalidraw. In the note it is an image link to
 * an SVG picture (name.excalidraw.svg), so any Markdown viewer shows it; the
 * editable scene sits beside it as name.excalidraw.
 */
export const SketchBlock = Node.create({
  name: 'sketch',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    return { src: { default: '' }, alt: { default: 'Sketch' } };
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
  const [editing, setEditing] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const src = String(node.attrs.src ?? '');
  const picture = src ? resolveFromNote(src) : null;

  const open = async () => {
    setError(null);
    if (!picture) return setEditing('');
    try {
      setEditing((await tw.read(picture.slice(0, -'.svg'.length))).content);
    } catch {
      setEditing(''); // the scene file is missing: start from an empty canvas
    }
  };

  const save = async (scene: string, svg: string) => {
    try {
      let target = picture;
      let link = src;
      if (!target) {
        const note = currentNotePath();
        const name = `sketch-${Date.now().toString(36)}${SKETCH_SUFFIX}`;
        target = joinPath(dirname(note), ATTACHMENTS_DIR, name);
        link = `${ATTACHMENTS_DIR}/${name}`;
      }
      await tw.write(target.slice(0, -'.svg'.length), scene, null);
      await tw.write(target, svg || '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>', null);
      if (link !== src) updateAttributes({ src: link });
      setVersion(Date.now());
      setEditing(null);
    } catch (err) {
      setError(errorText(err));
    }
  };

  return (
    <NodeViewWrapper className={`embed ${selected ? 'sel' : ''}`} data-drag-handle>
      {picture ? (
        // Shown as an image, so nothing inside the drawing can run as part of the page.
        <img className="diagram" src={vaultUrl(picture, version)} alt={String(node.attrs.alt || 'Sketch')} />
      ) : (
        <div className="chart-empty">Empty sketch. {editor.isEditable ? 'Use Edit sketch to draw.' : ''}</div>
      )}
      {error && <div className="embed-error">{error}</div>}
      {editor.isEditable && (
        <div className="embed-bar" contentEditable={false}>
          <button type="button" className="btn" onClick={() => void open()}>
            Edit sketch
          </button>
        </div>
      )}
      {editing !== null && (
        <Suspense fallback={<div className="scrim"><div className="dialog">Loading the drawing tools…</div></div>}>
          <SketchEditor scene={editing} onClose={() => setEditing(null)} onSave={(scene, svg) => void save(scene, svg)} />
        </Suspense>
      )}
    </NodeViewWrapper>
  );
}
