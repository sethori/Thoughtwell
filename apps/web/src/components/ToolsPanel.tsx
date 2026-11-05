import { useRef } from 'react';
import type { Editor } from '@tiptap/react';
import { Icon, type IconName } from './Icon';
import { uploadImage } from './PageView';

/**
 * The right-hand panel: blocks to insert, plus review and page tools.
 * Graph, sketch and flowchart blocks are planned; they show as coming soon.
 */
export function ToolsPanel({ editor, pageId, notify }: { editor: Editor | null; pageId: string | null; notify: (msg: string) => void }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const can = Boolean(editor);
  const c = () => editor!.chain().focus();

  const tool = (label: string, icon: IconName, run: (() => void) | null) => (
    <button
      type="button"
      className="it"
      disabled={!can || !run}
      onClick={() => run?.()}
      title={run ? `Insert ${label.toLowerCase()}` : `${label} blocks are coming in a later phase`}
    >
      <Icon name={icon} small />
      <span className="label">{label}</span>
      {!run && <span className="soon">SOON</span>}
    </button>
  );

  return (
    <aside className="right" aria-label="Note tools">
      <div className="rhd">Note Studio</div>
      <div className="rsub">{can ? 'Click a tool to insert it at the cursor' : pageId ? 'Read only' : 'Open a page to use the tools'}</div>

      <div className="sech">
        <span>Insert block</span>
      </div>
      {tool('Text', 'text', () => c().setParagraph().run())}
      {tool('Heading', 'heading', () => c().toggleHeading({ level: 2 }).run())}
      {tool('List and tasks', 'tasks', () => c().toggleTaskList().run())}
      {tool('Table', 'table', () => c().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run())}
      {tool('Image', 'image', () => fileInput.current?.click())}
      {tool('Code', 'code', () => c().toggleCodeBlock().run())}
      {tool('Quote', 'quote', () => c().toggleBlockquote().run())}
      {tool('Divider', 'callout', () => c().setHorizontalRule().run())}
      {tool('Graph', 'graph', null)}
      {tool('Sketch diagram', 'sketch', null)}
      {tool('Flowchart', 'flow', null)}

      <div className="sech">
        <span>Review</span>
      </div>
      {tool('Track changes', 'settings', null)}
      {tool('Submit for review', 'review', null)}
      <div className="hint" style={{ margin: '6px 8px' }}>
        Tracked changes and approvals arrive in phase 3. Until then, publishing makes the draft live.
      </div>

      <input
        ref={fileInput}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file || !editor || !pageId) return;
          try {
            const src = await uploadImage(pageId, file);
            editor.chain().focus().setImage({ src, alt: file.name }).run();
          } catch (err) {
            notify((err as Error).message);
          }
        }}
      />
    </aside>
  );
}
