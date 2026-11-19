import { Node, NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react';

/**
 * Markdown the editor has no block for (HTML, link definitions). It is shown
 * as written and saved back exactly as it was, so nothing in a file is lost.
 */
export const RawBlock = Node.create({
  name: 'rawMarkdown',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    return { source: { default: '' } };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="raw-markdown"]', getAttrs: (el) => ({ source: (el as HTMLElement).textContent ?? '' }) }];
  },
  renderHTML({ node }) {
    return ['div', { 'data-type': 'raw-markdown' }, String(node.attrs.source ?? '')];
  },
  addNodeView() {
    return ReactNodeViewRenderer(RawView);
  },
});

function RawView({ node, selected }: NodeViewProps) {
  return (
    <NodeViewWrapper className={`raw-block ${selected ? 'sel' : ''}`} data-drag-handle>
      <div className="raw-label" contentEditable={false}>
        Kept as written in the file
      </div>
      <pre contentEditable={false}>{String(node.attrs.source ?? '')}</pre>
    </NodeViewWrapper>
  );
}
