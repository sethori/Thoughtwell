import { Extension, type Editor, type JSONContent } from '@tiptap/react';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import { emptyDiagram } from '@notes/shared';

/**
 * Placing a block by hand: a table, flowchart or sketch can be drawn onto the
 * page (click the tool, then drag a rectangle where it should go) or dragged
 * from the tools panel and dropped, then sized. While that happens a ghost box
 * sits in the document itself, so the writing around it moves down and the
 * new block always lands just below the pointer.
 */

export type PlaceKind = 'table' | 'flowchart' | 'sketch';

interface GhostState {
  pos: number | null;
  el: HTMLElement | null;
}

export const placementKey = new PluginKey<GhostState>('placement');

/** Shows the ghost box as a widget in the document. Local only: it never reaches the shared document. */
export const Placement = Extension.create({
  name: 'placement',
  addProseMirrorPlugins() {
    return [
      new Plugin<GhostState>({
        key: placementKey,
        state: {
          init: () => ({ pos: null, el: null }),
          apply(tr, value) {
            const meta = tr.getMeta(placementKey) as GhostState | undefined;
            if (meta) return meta;
            if (value.pos === null) return value;
            // Someone else may be editing above the ghost; keep it on the same spot.
            return { ...value, pos: tr.mapping.map(value.pos) };
          },
        },
        props: {
          decorations(state) {
            const s = placementKey.getState(state);
            if (!s || s.pos === null || !s.el) return null;
            const el = s.el;
            return DecorationSet.create(state.doc, [
              Decoration.widget(s.pos, () => el, { side: -1, key: 'placement-ghost', ignoreSelection: true, stopEvent: () => true }),
            ]);
          },
        },
      }),
    ];
  },
});

// ------------------------------------------------------------ sizes

const CELL_W = 110;
const CELL_H = 34;

export const PLACE_LABEL: Record<PlaceKind, string> = { table: 'table', flowchart: 'flowchart', sketch: 'sketch' };

const MIN: Record<PlaceKind, { w: number; h: number }> = {
  table: { w: CELL_W * 0.6, h: CELL_H * 1.5 },
  flowchart: { w: 200, h: 160 },
  sketch: { w: 200, h: 160 },
};
const DEFAULT: Record<PlaceKind, { w: number; h: number }> = {
  table: { w: CELL_W * 3, h: CELL_H * 3 },
  flowchart: { w: 640, h: 320 },
  sketch: { w: 640, h: 360 },
};

function tableShape(w: number, h: number) {
  const cols = Math.max(1, Math.min(20, Math.round(w / CELL_W)));
  // A header row plus at least one body row.
  const rows = Math.max(2, Math.min(60, Math.round(h / CELL_H)));
  return { cols, rows };
}

function sizeLabel(kind: PlaceKind, w: number, h: number) {
  if (kind === 'table') {
    const { cols, rows } = tableShape(w, h);
    return `${cols} × ${rows}`;
  }
  return `${Math.round(h)} px tall`;
}

/** The document content for a placed block of the given size. */
export function placedContent(kind: PlaceKind, w: number, h: number): JSONContent {
  if (kind === 'table') {
    const { cols, rows } = tableShape(w, h);
    const colwidth = Math.max(60, Math.round(w / cols));
    return {
      type: 'table',
      content: Array.from({ length: rows }, (_, r) => ({
        type: 'tableRow',
        content: Array.from({ length: cols }, () => ({
          type: r === 0 ? 'tableHeader' : 'tableCell',
          attrs: { colspan: 1, rowspan: 1, colwidth: [colwidth] },
          content: [{ type: 'paragraph' }],
        })),
      })),
    };
  }
  const height = Math.round(Math.max(MIN[kind].h, h));
  if (kind === 'flowchart') return { type: 'flowchart', attrs: { diagram: emptyDiagram(), height, code: '' } };
  return { type: 'sketch', attrs: { height } };
}

/** Puts a block of the given kind and size into the document at a top-level position. */
export function insertPlaced(editor: Editor, kind: PlaceKind, pos: number, w: number, h: number) {
  const content = placedContent(kind, w, h);
  const atEnd = pos >= editor.state.doc.content.size;
  // At the very end, a paragraph follows so writing can carry on below.
  const items = atEnd ? [content, { type: 'paragraph' }] : [content];
  const chain = editor.chain().focus().insertContentAt(pos, items, { updateSelection: false });
  if (kind === 'table') chain.setTextSelection(pos + 4);
  else chain.setNodeSelection(pos);
  chain.run();
}

/** The default-size block at the cursor, for keyboard use of the tools. */
export function insertAtCursor(editor: Editor, kind: PlaceKind) {
  const { $from } = editor.state.selection;
  const pos = $from.depth === 0 ? $from.pos : $from.after(1);
  insertPlaced(editor, kind, pos, DEFAULT[kind].w, DEFAULT[kind].h);
}

// ------------------------------------------------------------ the ghost and the pointer

/** The top-level position nearest the pointer: before the first block whose middle is below it. */
function blockPosAt(view: EditorView, y: number, ghost: HTMLElement | null, ghostPos: number | null): number {
  const doc = view.state.doc;
  const shift = ghost && ghostPos !== null ? ghost.getBoundingClientRect().height : 0;
  let pos = 0;
  for (let i = 0; i < doc.childCount; i++) {
    const child = doc.child(i);
    const dom = view.nodeDOM(pos);
    if (dom instanceof HTMLElement) {
      const r = dom.getBoundingClientRect();
      // Blocks after the ghost are pushed down by it; measure them where they would sit without it.
      const lift = ghostPos !== null && pos >= ghostPos ? shift : 0;
      const mid = (r.top + r.bottom) / 2 - lift;
      if (y < mid) return pos;
    }
    pos += child.nodeSize;
  }
  return doc.content.size;
}

function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY;
    if ((o === 'auto' || o === 'scroll') && p.scrollHeight > p.clientHeight) return p;
  }
  return null;
}

type Phase = 'armed' | 'dragging' | 'drawing' | 'sizing';

let active: PlacementSession | null = null;

/** Cancels any placement in progress (for example when the page closes). */
export function cancelPlacement() {
  active?.finish(false);
}

class PlacementSession {
  private phase: Phase;
  private ghost: HTMLElement;
  private box: HTMLElement;
  private label: HTMLElement;
  private overlay: HTMLElement;
  private hint: HTMLElement;
  private chip: HTMLElement | null = null;
  private pos: number | null = null;
  private offsetX = 0;
  private w = 0;
  private h = 0;
  private scroller: HTMLElement | null;
  private cleanup: (() => void)[] = [];

  constructor(
    private editor: Editor,
    private kind: PlaceKind,
    start: 'armed' | 'dragging',
    point?: { x: number; y: number },
  ) {
    this.phase = start;
    this.scroller = scrollParent(editor.view.dom as HTMLElement);

    this.ghost = document.createElement('div');
    this.ghost.className = `place-ghost k-${kind}`;
    this.ghost.contentEditable = 'false';
    this.box = document.createElement('div');
    this.box.className = 'place-box';
    this.label = document.createElement('span');
    this.label.className = 'place-label';
    this.box.appendChild(this.label);
    this.ghost.appendChild(this.box);

    this.overlay = document.createElement('div');
    this.overlay.className = `place-overlay ${start}`;
    this.hint = document.createElement('div');
    this.hint.className = 'place-hint';
    this.hint.setAttribute('role', 'status');
    document.body.append(this.overlay, this.hint);

    if (start === 'dragging') {
      this.chip = document.createElement('div');
      this.chip.className = 'place-chip';
      this.chip.textContent = `${PLACE_LABEL[kind][0]!.toUpperCase()}${PLACE_LABEL[kind].slice(1)}`;
      document.body.appendChild(this.chip);
      this.setHint(`Drop the ${PLACE_LABEL[kind]} on the page · Esc to cancel`);
      if (point) this.onMove(point.x, point.y);
    } else {
      this.setHint(`Drag on the page to draw the ${PLACE_LABEL[kind]} · Esc to cancel`);
    }

    const move = (e: PointerEvent) => this.onMove(e.clientX, e.clientY);
    const down = (e: PointerEvent) => this.onDown(e);
    const up = (e: PointerEvent) => this.onUp(e);
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        this.finish(false);
      }
    };
    const wheel = (e: WheelEvent) => this.scroller?.scrollBy({ top: e.deltaY, left: e.deltaX });
    const menu = (e: MouseEvent) => {
      e.preventDefault();
      this.finish(false);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('keydown', key, true);
    this.overlay.addEventListener('wheel', wheel, { passive: true });
    this.overlay.addEventListener('contextmenu', menu);
    this.cleanup.push(
      () => window.removeEventListener('pointermove', move),
      () => window.removeEventListener('pointerdown', down, true),
      () => window.removeEventListener('pointerup', up, true),
      () => window.removeEventListener('keydown', key, true),
    );
  }

  private setHint(text: string) {
    this.hint.textContent = text;
  }

  /** The page area: the editor's scrolling stage, so the margins beside the page count too. */
  private overPage(x: number, y: number) {
    const r = (this.scroller ?? (this.editor.view.dom as HTMLElement)).getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  }

  private contentRect() {
    return (this.editor.view.dom as HTMLElement).getBoundingClientRect();
  }

  private showGhost(pos: number | null) {
    if (pos === this.pos) return;
    this.pos = pos;
    const { view } = this.editor;
    view.dispatch(view.state.tr.setMeta(placementKey, { pos, el: pos === null ? null : this.ghost }).setMeta('addToHistory', false));
  }

  /** Grows or shrinks the box from its top-left corner to the pointer. */
  private sizeTo(x: number, y: number) {
    const content = this.contentRect();
    const top = this.ghost.getBoundingClientRect().top;
    const maxW = content.width - this.offsetX;
    this.w = Math.min(maxW, Math.max(MIN[this.kind].w, x - (content.left + this.offsetX)));
    this.h = Math.max(MIN[this.kind].h, y - top);
    this.render();
  }

  private render() {
    this.box.style.marginLeft = `${this.offsetX}px`;
    this.box.style.width = `${this.w}px`;
    this.box.style.height = `${this.h}px`;
    if (this.kind === 'table') {
      const { cols, rows } = tableShape(this.w, this.h);
      this.box.style.backgroundSize = `${this.w / cols}px ${this.h / rows}px`;
    }
    this.label.textContent = sizeLabel(this.kind, this.w, this.h);
  }

  private autoScroll(y: number) {
    const sc = this.scroller;
    if (!sc) return;
    const r = sc.getBoundingClientRect();
    if (y > r.bottom - 40) sc.scrollBy({ top: 18 });
    else if (y < r.top + 40) sc.scrollBy({ top: -18 });
  }

  private onMove(x: number, y: number) {
    if (this.chip) {
      this.chip.style.transform = `translate(${x + 14}px, ${y + 10}px)`;
    }
    if (this.phase === 'dragging') {
      if (!this.overPage(x, y)) {
        this.showGhost(null);
        return;
      }
      this.autoScroll(y);
      // A slim drop marker that already pushes the text below it down.
      this.offsetX = 0;
      this.w = this.contentRect().width;
      this.h = 44;
      this.render();
      this.label.textContent = `Drop ${PLACE_LABEL[this.kind]} here`;
      this.showGhost(blockPosAt(this.editor.view, y, this.ghost, this.pos));
    } else if (this.phase === 'drawing' || this.phase === 'sizing') {
      this.autoScroll(y);
      this.sizeTo(x, y);
    }
  }

  private beginBox(x: number, y: number) {
    const content = this.contentRect();
    this.offsetX = Math.max(0, Math.min(content.width - MIN[this.kind].w, x - content.left));
    this.w = MIN[this.kind].w;
    this.h = MIN[this.kind].h;
    this.ghost.classList.add('boxed');
    this.render();
    this.showGhost(blockPosAt(this.editor.view, y, this.ghost, this.pos));
    this.sizeTo(x, y);
  }

  private onDown(e: PointerEvent) {
    // Everything under the overlay is out of reach until the placement ends.
    e.preventDefault();
    e.stopPropagation();
    if (e.button !== 0) return;
    if (this.phase === 'armed') {
      if (!this.overPage(e.clientX, e.clientY)) return this.finish(false);
      this.phase = 'drawing';
      this.overlay.className = 'place-overlay drawing';
      this.setHint('Release to place it · Esc to cancel');
      this.beginBox(e.clientX, e.clientY);
    } else if (this.phase === 'sizing') {
      this.finish(true);
    }
  }

  private onUp(e: PointerEvent) {
    if (this.phase === 'dragging') {
      e.preventDefault();
      if (this.pos === null || !this.overPage(e.clientX, e.clientY)) return this.finish(false);
      this.chip?.remove();
      this.chip = null;
      this.phase = 'sizing';
      this.overlay.className = 'place-overlay sizing';
      this.setHint('Move to size it, click to place · Esc to cancel');
      this.beginBox(e.clientX, e.clientY);
    } else if (this.phase === 'drawing') {
      e.preventDefault();
      // A click without a drag gets the usual size.
      const tiny = this.w <= MIN[this.kind].w + 4 && this.h <= MIN[this.kind].h + 4;
      if (tiny) {
        const content = this.contentRect();
        this.w = Math.min(DEFAULT[this.kind].w, content.width - this.offsetX);
        this.h = DEFAULT[this.kind].h;
      }
      this.finish(true);
    }
  }

  finish(place: boolean) {
    const pos = this.pos;
    for (const fn of this.cleanup) fn();
    this.overlay.remove();
    this.hint.remove();
    this.chip?.remove();
    if (!this.editor.isDestroyed) {
      this.showGhost(null);
      if (place && pos !== null) {
        // Read the mapped position: other people may have edited above it meanwhile.
        const mapped = placementKey.getState(this.editor.state)?.pos ?? pos;
        insertPlaced(this.editor, this.kind, Math.min(mapped, this.editor.state.doc.content.size), this.w, this.h);
      }
    }
    if (active === this) active = null;
  }
}

/**
 * Starts placing a block from a press on its tool. A press that moves becomes
 * a drag onto the page; a plain click arms drawing, and the next drag on the
 * page draws the block.
 */
export function pressTool(editor: Editor, kind: PlaceKind, e: { clientX: number; clientY: number; button: number }) {
  if (e.button !== 0) return;
  active?.finish(false);
  const sx = e.clientX;
  const sy = e.clientY;
  let started = false;
  const move = (ev: PointerEvent) => {
    if (started || Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return;
    started = true;
    stop();
    active = new PlacementSession(editor, kind, 'dragging', { x: ev.clientX, y: ev.clientY });
  };
  const up = () => {
    stop();
    if (!started) {
      // Let this click finish before listening for the drawing press.
      setTimeout(() => {
        active = new PlacementSession(editor, kind, 'armed');
      }, 0);
    }
  };
  const stop = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

/** True while a placement is waiting for or following the pointer. */
export function placing() {
  return active !== null;
}
