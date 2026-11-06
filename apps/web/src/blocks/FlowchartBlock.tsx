import { useEffect, useMemo, useState } from 'react';
import { mergeAttributes, Node, NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react';
import { normalizeDiagram } from '@notes/shared';
import { Dialog } from '../components/Dialog';
import { Icon } from '../components/Icon';
import { dataAttr } from './attrs';
import { FlowCanvas } from './FlowCanvas';
import { isDark, renderMermaid, svgDataUrl } from './mermaid';

export const FLOWCHART_TEMPLATES: Record<string, string> = {
  Flowchart: `flowchart TD
  Start([Request received]) --> Check{Approved?}
  Check -- Yes --> Do[Do the work]
  Check -- No --> Back[Send back with a note]
  Do --> Done([Done])`,
  Sequence: `sequenceDiagram
  participant W as Writer
  participant A as Approver
  W->>A: Submit for review
  A-->>W: Send back with notes
  W->>A: Submit again
  A->>W: Approve and publish`,
  Timeline: `gantt
  dateFormat YYYY-MM-DD
  title Project plan
  section Build
  Design      :a1, 2026-01-05, 10d
  Build       :after a1, 20d
  section Launch
  Testing     :2026-02-05, 7d`,
  'Org chart': `flowchart TD
  Org[Organization] --> D1[Directorate 1]
  D1 --> DivA[Division A]
  DivA --> B1[Branch A1]
  B1 --> S1[Section 1]`,
};

/**
 * A flowchart. New ones are drawn right on the page (shapes and arrows,
 * stored in `diagram`). Older ones were written as Mermaid text (`code`) and
 * keep their text editor.
 */
export const FlowchartBlock = Node.create({
  name: 'flowchart',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    return {
      code: dataAttr('code', '', false),
      diagram: dataAttr<unknown>('diagram', null),
      height: dataAttr('height', 320),
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="flowchart"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'flowchart' })];
  },
  addNodeView() {
    return ReactNodeViewRenderer(FlowchartView, {
      // The drawing handles its own pointer and keys; only the grip moves the block.
      stopEvent: ({ event }) => !(event.target instanceof Element && event.target.closest('[data-drag-handle]')),
    });
  },
});

function useDiagram(code: string) {
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      renderMermaid(code, isDark())
        .then((s) => {
          if (!live) return;
          setSvg(s);
          setError(null);
        })
        .catch((e: Error) => live && setError(e.message.split('\n').slice(0, 3).join(' ')));
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [code]);
  return { svg, error };
}

function Diagram({ code }: { code: string }) {
  const { svg, error } = useDiagram(code);
  if (error) return <div className="embed-error">This diagram has a mistake: {error}</div>;
  if (!svg) return <div className="chart-empty">Drawing…</div>;
  return <img className="diagram" src={svgDataUrl(svg)} alt="Flowchart" />;
}

function FlowchartView({ node, updateAttributes, editor, selected }: NodeViewProps) {
  const code = String(node.attrs.code ?? '');
  const diagram = useMemo(() => normalizeDiagram(node.attrs.diagram), [node.attrs.diagram]);
  const legacy = Boolean(code.trim()) && diagram.nodes.length === 0;
  return legacy ? (
    <MermaidView code={code} editable={editor.isEditable} selected={selected} onSave={(c) => updateAttributes({ code: c })} />
  ) : (
    <NodeViewWrapper className={`embed flow-embed ${selected ? 'sel' : ''}`}>
      {editor.isEditable && (
        <span className="embed-grip" data-drag-handle draggable="true" contentEditable={false} title="Drag to move the flowchart">
          <Icon name="move" small />
        </span>
      )}
      <div contentEditable={false}>
        <FlowCanvas
          diagram={diagram}
          height={Number(node.attrs.height) || 320}
          editable={editor.isEditable}
          onChange={(d) => updateAttributes({ diagram: d })}
          onHeight={(h) => updateAttributes({ height: h })}
        />
      </div>
    </NodeViewWrapper>
  );
}

/** An older flowchart written as Mermaid text. */
function MermaidView({ code, editable, selected, onSave }: { code: string; editable: boolean; selected: boolean; onSave: (code: string) => void }) {
  const [editing, setEditing] = useState(false);
  return (
    <NodeViewWrapper className={`embed ${selected ? 'sel' : ''}`} data-drag-handle>
      <Diagram code={code} />
      {editable && (
        <div className="embed-bar" contentEditable={false}>
          <button type="button" className="btn" onClick={() => setEditing(true)}>
            Edit diagram
          </button>
        </div>
      )}
      {editing && (
        <FlowchartEditor
          initial={code}
          onClose={() => setEditing(false)}
          onSave={(c) => {
            onSave(c);
            setEditing(false);
          }}
        />
      )}
    </NodeViewWrapper>
  );
}

function FlowchartEditor({ initial, onSave, onClose }: { initial: string; onSave: (code: string) => void; onClose: () => void }) {
  const [code, setCode] = useState(initial);
  return (
    <Dialog title="Flowchart" sub="Write the diagram as text; the preview updates as you type." wide onClose={onClose}>
      <div className="field">
        <span>Start from</span>
        <div className="choices">
          {Object.keys(FLOWCHART_TEMPLATES).map((name) => (
            <button key={name} type="button" className="choice" onClick={() => setCode(FLOWCHART_TEMPLATES[name]!)}>
              {name}
            </button>
          ))}
        </div>
      </div>
      <div className="split">
        <textarea className="input code" aria-label="Diagram text" spellCheck={false} value={code} onChange={(e) => setCode(e.target.value)} rows={14} />
        <div className="chart-preview">
          <Diagram code={code} />
        </div>
      </div>
      <p className="sub">
        Uses Mermaid syntax: <code>A --&gt; B</code> draws an arrow, <code>{'{Question?}'}</code> a decision.
      </p>
      <div className="actions">
        <button type="button" className="btn" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn pri" onClick={() => onSave(code)}>
          Save diagram
        </button>
      </div>
    </Dialog>
  );
}
