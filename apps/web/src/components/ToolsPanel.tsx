import { useRef } from 'react';
import type { Editor, JSONContent } from '@tiptap/react';
import { NodeSelection } from '@tiptap/pm/state';
import { SAMPLE_CHART } from '@notes/shared';
import { FLOWCHART_TEMPLATES } from '../blocks/FlowchartBlock';
import { errorText, tw } from '../lib/vault';
import { Icon, type IconName } from './Icon';

/** Saves an image file into the note's attachments folder and returns the link for the note. */
export async function attachImage(notePath: string, file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { link } = await tw.saveAttachment(notePath, file.name || 'image.png', bytes);
  return link;
}

/** Blocks to insert into the open note. */
export function ToolsPanel({ editor, notePath, notify }: { editor: Editor | null; notePath: string | null; notify: (msg: string) => void }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const can = Boolean(editor?.isEditable);
  // When a block (graph, image…) is selected, new things go after it rather than replacing it.
  const c = () => {
    const ed = editor!;
    const sel = ed.state.selection;
    if (sel instanceof NodeSelection) {
      return ed.chain().focus().insertContentAt(sel.to, { type: 'paragraph' }).setTextSelection(sel.to + 1);
    }
    return ed.chain().focus();
  };
  /** Inserts a block with an empty paragraph after it, so writing can carry on below. */
  const block = (content: JSONContent) => {
    const ed = editor!;
    const sel = ed.state.selection;
    const items = [content, { type: 'paragraph' }];
    if (sel instanceof NodeSelection) ed.chain().focus().insertContentAt(sel.to, items).run();
    else ed.chain().focus().insertContent(items).run();
  };

  const tool = (label: string, icon: IconName, run: () => void, hint?: string) => (
    <button type="button" className="it" disabled={!can} onClick={run} title={hint ?? `Insert ${label.toLowerCase()}`}>
      <Icon name={icon} small />
      <span className="label">{label}</span>
    </button>
  );

  if (!can) return null;
  return (
    <>
      <div className="sech">
        <span>Insert block</span>
      </div>
      {tool('Heading', 'heading', () => c().toggleHeading({ level: 2 }).run())}
      {tool('List and tasks', 'tasks', () => c().toggleTaskList().run())}
      {tool('Table', 'table', () => c().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(), 'Insert a table; type = in a cell for formulas')}
      {tool('Image', 'image', () => fileInput.current?.click(), 'Insert an image (saved in an attachments folder beside the note)')}
      {tool('Code', 'code', () => c().toggleCodeBlock().run(), 'Insert a code block with syntax highlighting')}
      {tool('Quote', 'quote', () => c().toggleBlockquote().run())}
      {tool('Divider', 'callout', () => block({ type: 'horizontalRule' }))}
      {tool('Graph', 'graph', () => block({ type: 'chart', attrs: { ...SAMPLE_CHART } }), 'Insert a bar, line or pie chart')}
      {tool('Sketch diagram', 'sketch', () => block({ type: 'sketch' }), 'Insert a freehand diagram (Excalidraw)')}
      {tool('Diagram', 'flow', () => block({ type: 'flowchart', attrs: { code: FLOWCHART_TEMPLATES['Mind map'] } }), 'Insert a mind map, flowchart or timeline written as text (Mermaid)')}

      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file || !editor || !notePath) return;
          try {
            const src = await attachImage(notePath, file);
            editor.chain().focus().setImage({ src, alt: file.name }).run();
          } catch (err) {
            notify(errorText(err));
          }
        }}
      />
    </>
  );
}
