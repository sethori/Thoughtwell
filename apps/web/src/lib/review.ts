import { Extension, type Editor } from '@tiptap/react';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { blockLabel, diffDocs, type DocChange, type JsonNode } from '@notes/shared';

/**
 * Inline review markup: compares the draft in the editor with the published
 * version and marks what changed, live, as people keep editing. Added words
 * are underlined, removed words shown struck through, whole added or removed
 * blocks outlined. Turning it on or off never changes the document itself.
 */

interface ReviewState {
  enabled: boolean;
  base: JsonNode | null;
  changes: DocChange[];
  decorations: DecorationSet;
  focus: string | null;
}

export const reviewKey = new PluginKey<ReviewState>('reviewMarkup');

type Meta = Partial<Pick<ReviewState, 'enabled' | 'base' | 'focus'>>;

/** Text positions inside a block, so word offsets from the diff map onto the document. */
function textMap(block: PMNode, blockPos: number) {
  const segs: { from: number; to: number; pos: number }[] = [];
  let offset = 0;
  block.descendants((n, p) => {
    if (n.isText) {
      const len = n.text!.length;
      segs.push({ from: offset, to: offset + len, pos: blockPos + 1 + p });
      offset += len;
    }
    return true;
  });
  return (off: number): number => {
    for (const s of segs) if (off >= s.from && off <= s.to) return s.pos + (off - s.from);
    const last = segs[segs.length - 1];
    return last ? last.pos + (last.to - last.from) : blockPos + 1;
  };
}

function struck(text: string, key: string): HTMLElement {
  const el = document.createElement('span');
  el.className = 'chg-del';
  el.dataset.change = key;
  el.textContent = text;
  el.contentEditable = 'false';
  return el;
}

function removedBlock(c: Extract<DocChange, { kind: 'removed' }>, focus: boolean): HTMLElement {
  const el = document.createElement('div');
  el.className = `chg-removed${focus ? ' focus' : ''}`;
  el.dataset.change = c.key;
  el.contentEditable = 'false';
  const label = document.createElement('span');
  label.className = 'chg-tag';
  label.textContent = `Removed ${blockLabel(c.oldBlock).toLowerCase()}`;
  el.append(label, document.createTextNode(c.summary.replace(/^[^:]+:\s*/, '')));
  return el;
}

function build(state: EditorState, base: JsonNode | null, focus: string | null) {
  const doc = state.doc;
  const changes = diffDocs(base, doc.toJSON() as JsonNode);
  const starts: number[] = [];
  doc.forEach((_n, offset) => starts.push(offset));
  const decos: Decoration[] = [];

  for (const c of changes) {
    const isFocus = c.key === focus;
    if (c.kind === 'removed') {
      const pos = c.insertAt < starts.length ? starts[c.insertAt]! : doc.content.size;
      decos.push(Decoration.widget(pos, () => removedBlock(c, isFocus), { side: -1, key: `rm-${c.key}-${isFocus}` }));
      continue;
    }
    const pos = starts[c.index];
    const node = pos === undefined ? null : doc.child(c.index);
    if (pos === undefined || !node) continue;
    const cls = c.kind === 'added' ? 'chg-add' : 'chg-mod';
    decos.push(Decoration.node(pos, pos + node.nodeSize, { class: `${cls}${isFocus ? ' focus' : ''}`, 'data-change': c.key }));
    if (c.kind !== 'modified' || c.words.length === 0) continue;
    const at = textMap(node, pos);
    let off = 0;
    for (const w of c.words) {
      if (w.op === 'eq') off += w.text.length;
      else if (w.op === 'ins') {
        const from = at(off);
        off += w.text.length;
        const to = at(off);
        if (to > from) decos.push(Decoration.inline(from, to, { class: 'chg-ins' }));
      } else {
        const text = w.text;
        decos.push(Decoration.widget(at(off), () => struck(text, c.key), { side: -1, key: `del-${c.key}-${off}-${text.length}` }));
      }
    }
  }
  return { changes, decorations: DecorationSet.create(doc, decos) };
}

export const ReviewMarkup = Extension.create({
  name: 'reviewMarkup',
  addProseMirrorPlugins() {
    return [
      new Plugin<ReviewState>({
        key: reviewKey,
        state: {
          init: () => ({ enabled: false, base: null, changes: [], decorations: DecorationSet.empty, focus: null }),
          apply(tr: Transaction, prev: ReviewState, _old, next: EditorState): ReviewState {
            const meta = tr.getMeta(reviewKey) as Meta | undefined;
            const s = meta ? { ...prev, ...meta } : prev;
            if (!s.enabled) return s.enabled === prev.enabled && !meta ? prev : { ...s, changes: [], decorations: DecorationSet.empty };
            if (!meta && !tr.docChanged) return s;
            return { ...s, ...build(next, s.base, s.focus) };
          },
        },
        props: {
          decorations: (state) => reviewKey.getState(state)?.decorations ?? DecorationSet.empty,
        },
      }),
    ];
  },
});

export function setReview(editor: Editor, meta: Meta) {
  editor.view.dispatch(editor.state.tr.setMeta(reviewKey, meta).setMeta('addToHistory', false));
}

export function reviewChanges(editor: Editor | null): DocChange[] {
  if (!editor || editor.isDestroyed) return [];
  return reviewKey.getState(editor.state)?.changes ?? [];
}

/** Puts one change back the way it was published. The edit goes to everyone live. */
export function rejectChange(editor: Editor, c: DocChange): boolean {
  const { state } = editor;
  const doc = state.doc;
  const starts: number[] = [];
  doc.forEach((_n, offset) => starts.push(offset));
  let tr = state.tr;
  try {
    if (c.kind === 'modified') {
      const pos = starts[c.index]!;
      tr = tr.replaceWith(pos, pos + doc.child(c.index).nodeSize, state.schema.nodeFromJSON(c.oldBlock));
    } else if (c.kind === 'added') {
      const pos = starts[c.index]!;
      tr = tr.delete(pos, pos + doc.child(c.index).nodeSize);
      if (tr.doc.childCount === 0) tr = tr.insert(0, state.schema.nodes.paragraph!.create());
    } else {
      const pos = c.insertAt < starts.length ? starts[c.insertAt]! : doc.content.size;
      tr = tr.insert(pos, state.schema.nodeFromJSON(c.oldBlock));
    }
  } catch {
    return false;
  }
  editor.view.dispatch(tr);
  return true;
}

/** Scrolls a change into view and highlights it. */
export function focusChange(editor: Editor, key: string) {
  setReview(editor, { focus: key });
  const el = editor.view.dom.querySelector(`[data-change="${CSS.escape(key)}"]`);
  el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
}
