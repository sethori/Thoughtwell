import { useRef, useState } from 'react';
import type { Editor, JSONContent } from '@tiptap/react';
import { NodeSelection } from '@tiptap/pm/state';
import { SAMPLE_CHART, type DocChange } from '@notes/shared';
import type { Page, Review } from '../lib/api';
import { focusChange } from '../lib/review';
import { FLOWCHART_TEMPLATES } from '../blocks/FlowchartBlock';
import { Icon, type IconName } from './Icon';
import { PromptDialog } from './Dialog';
import { uploadImage } from './PageView';

/** What the open page offers the panel: its review state and the actions on it. */
export interface PageTools {
  /** The live editor, even when this person cannot edit (for scrolling to changes). */
  editor: Editor;
  page: Page;
  review: Review | null;
  changes: DocChange[];
  showChanges: boolean;
  setShowChanges: (on: boolean) => void;
  submit: () => void;
  withdraw: () => Promise<void>;
  decide: (c: DocChange, decision: 'accepted' | 'rejected' | null) => Promise<void>;
  approve: (note?: string) => Promise<void>;
  sendBack: (note: string) => Promise<void>;
  comment: (body: string, changeKey?: string) => Promise<void>;
}

/** The right-hand panel: blocks to insert, then review. */
export function ToolsPanel({
  editor,
  pageId,
  notify,
  tools,
}: {
  editor: Editor | null;
  pageId: string | null;
  notify: (msg: string) => void;
  tools?: PageTools;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const can = Boolean(editor);
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
  const reviewing = tools && (tools.showChanges || tools.review?.status === 'open');

  const tool = (label: string, icon: IconName, run: () => void, hint?: string) => (
    <button type="button" className="it" disabled={!can} onClick={run} title={hint ?? `Insert ${label.toLowerCase()}`}>
      <Icon name={icon} small />
      <span className="label">{label}</span>
    </button>
  );

  return (
    <aside className="right" aria-label="Note tools">
      <div className="rhd">Note Studio</div>
      <div className="rsub">{can ? 'Click a tool to insert it at the cursor' : pageId ? 'Read only' : 'Open a page to use the tools'}</div>

      {!reviewing && (
        <>
          <div className="sech">
            <span>Insert block</span>
          </div>
          {tool('Text', 'text', () => c().setParagraph().run())}
          {tool('Heading', 'heading', () => c().toggleHeading({ level: 2 }).run())}
          {tool('List and tasks', 'tasks', () => c().toggleTaskList().run())}
          {tool('Table', 'table', () => c().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(), 'Insert a table; type = in a cell for formulas')}
          {tool('Image', 'image', () => fileInput.current?.click())}
          {tool('Code', 'code', () => c().toggleCodeBlock().run(), 'Insert a code block with syntax highlighting')}
          {tool('Quote', 'quote', () => c().toggleBlockquote().run())}
          {tool('Divider', 'callout', () => block({ type: 'horizontalRule' }))}
          {tool('Graph', 'graph', () => block({ type: 'chart', attrs: { ...SAMPLE_CHART } }), 'Insert a bar, line or pie chart')}
          {tool('Sketch diagram', 'sketch', () => block({ type: 'sketch' }), 'Insert a freehand diagram (Excalidraw)')}
          {tool('Flowchart', 'flow', () => block({ type: 'flowchart', attrs: { code: FLOWCHART_TEMPLATES.Flowchart } }), 'Insert a flowchart written as text')}
        </>
      )}

      {tools && <ReviewSection tools={tools} />}

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
            block({ type: 'image', attrs: { src, alt: file.name } });
          } catch (err) {
            notify((err as Error).message);
          }
        }}
      />
    </aside>
  );
}

const KIND_LABEL: Record<DocChange['kind'], string> = { added: 'Added', modified: 'Changed', removed: 'Removed' };

function ReviewSection({ tools }: { tools: PageTools }) {
  const { page, review, changes, showChanges, setShowChanges } = tools;
  const [ask, setAsk] = useState<null | { kind: 'sendBack' } | { kind: 'approve' } | { kind: 'comment'; key?: string }>(null);
  const open = review?.status === 'open';
  const canDecide = Boolean(open && review?.canDecide);
  const decided = review?.decisions ?? {};
  const pending = changes.filter((c) => !decided[c.key]);
  const editor = tools.editor;

  return (
    <>
      <div className="sech">
        <span>Review</span>
        {open && <span className="chip warn">Round {review!.round}</span>}
      </div>
      <label className="it toggle">
        <input type="checkbox" checked={showChanges} onChange={(e) => setShowChanges(e.target.checked)} />
        <span className="label">Show changes since {page.published ? `v${page.published.number}` : 'the start'}</span>
      </label>

      {!open && roleAtLeastContributor(page) && !page.policy.canPublishDirectly && (
        <button type="button" className="it" onClick={tools.submit}>
          <Icon name="review" small />
          <span className="label">Submit for review</span>
        </button>
      )}
      {!open && page.policy.approvalRequired && (
        <div className="hint">This folder needs an approver before changes go live.</div>
      )}
      {!open && !page.policy.approvalRequired && <div className="hint">Publishing makes the draft live. You can still ask someone to review first.</div>}
      {!open && !page.policy.approvalRequired && roleAtLeastContributor(page) && (
        <button type="button" className="it" onClick={tools.submit}>
          <Icon name="review" small />
          <span className="label">Ask for a review</span>
        </button>
      )}

      {open && review && (
        <div className="review-meta">
          Submitted by {review.submitted_by_name ?? 'someone'} · {new Date(review.created_at).toLocaleDateString()}
          {review.canWithdraw && (
            <button type="button" className="link-btn" onClick={() => void tools.withdraw()}>
              Withdraw
            </button>
          )}
        </div>
      )}

      {showChanges && (
        <div className="changes" aria-label="Changes">
          {changes.length === 0 && <div className="hint">No changes from the published version.</div>}
          {changes.map((c) => {
            const d = decided[c.key];
            return (
              <div
                key={c.key}
                className={`change ${d ?? ''}`}
                role="button"
                tabIndex={0}
                onClick={() => focusChange(editor, c.key)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') focusChange(editor, c.key);
                }}
              >
                <div className="change-head">
                  <span className={`chip ${c.kind === 'removed' ? 'bad' : c.kind === 'added' ? 'ok' : 'warn'}`}>{KIND_LABEL[c.kind]}</span>
                  {d && <span className="chip">{d === 'accepted' ? 'Accepted' : 'Rejected'}</span>}
                </div>
                <div className="change-text">{c.summary}</div>
                {canDecide && (
                  <div className="change-actions" onClick={(e) => e.stopPropagation()}>
                    <button type="button" className={`btn ${d === 'accepted' ? 'pri' : ''}`} onClick={() => void tools.decide(c, d === 'accepted' ? null : 'accepted')}>
                      Accept
                    </button>
                    <button type="button" className="btn" onClick={() => void tools.decide(c, 'rejected')} title="Put this back the way it was published">
                      Reject
                    </button>
                    <button type="button" className="link-btn" onClick={() => setAsk({ kind: 'comment', key: c.key })}>
                      Comment
                    </button>
                  </div>
                )}
                {review?.notes
                  .filter((n) => n.change_key === c.key)
                  .map((n) => (
                    <div key={n.id} className="note">
                      <b>{n.author_name}</b> {n.body}
                    </div>
                  ))}
              </div>
            );
          })}
        </div>
      )}

      {review && review.notes.some((n) => !n.change_key && n.body) && (
        <div className="notes">
          <div className="sech">
            <span>Notes</span>
          </div>
          {review.notes
            .filter((n) => !n.change_key && n.body)
            .map((n) => (
              <div key={n.id} className={`note ${n.kind}`}>
                <b>{n.author_name}</b>
                {n.kind === 'send_back' ? ' sent it back: ' : n.kind === 'submit' ? ' asked for review: ' : n.kind === 'approve' ? ' approved: ' : ' '}
                {n.body}
              </div>
            ))}
        </div>
      )}

      {open && (
        <div className="review-actions">
          <button type="button" className="btn" onClick={() => setAsk({ kind: 'comment' })}>
            Comment
          </button>
          {canDecide && (
            <>
              <button type="button" className="btn" onClick={() => setAsk({ kind: 'sendBack' })}>
                Send back
              </button>
              <button type="button" className="btn pri" onClick={() => setAsk({ kind: 'approve' })}>
                {changes.length > 0 && pending.length === 0 ? 'Publish accepted changes' : 'Approve all and publish'}
              </button>
            </>
          )}
          {!canDecide && review && !review.canWithdraw && <div className="hint">Only an approver for this folder can approve.</div>}
        </div>
      )}

      {ask?.kind === 'sendBack' && (
        <PromptDialog
          title="Send back for changes"
          label="What needs to change?"
          sub="The writer sees this note on the page and gets a notification."
          multiline
          maxLength={5000}
          confirm="Send back"
          onClose={() => setAsk(null)}
          onSubmit={(note) => tools.sendBack(note)}
        />
      )}
      {ask?.kind === 'approve' && (
        <PromptDialog
          title={pending.length && changes.length ? 'Approve all changes and publish' : 'Approve and publish'}
          label="Note (optional)"
          sub={
            pending.length && changes.length
              ? `${pending.length} change${pending.length === 1 ? '' : 's'} not individually accepted will be published too. Rejected changes were already undone in the draft.`
              : 'The draft becomes the new published version.'
          }
          multiline
          allowEmpty
          maxLength={5000}
          confirm="Approve and publish"
          onClose={() => setAsk(null)}
          onSubmit={(note) => tools.approve(note || undefined)}
        />
      )}
      {ask?.kind === 'comment' && (
        <PromptDialog
          title="Comment"
          label={ask.key ? 'Comment on this change' : 'Comment on the review'}
          multiline
          maxLength={5000}
          confirm="Post"
          onClose={() => setAsk(null)}
          onSubmit={(body) => tools.comment(body, ask.key)}
        />
      )}
    </>
  );
}

function roleAtLeastContributor(page: Page) {
  return page.role !== 'viewer';
}
