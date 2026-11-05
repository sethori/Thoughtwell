import { Extension, type Editor } from '@tiptap/react';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, TextSelection, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { cellAddress, evaluateGrid, FORMULA_ERROR_HELP, formatResult } from '@notes/shared';

/**
 * Table formulas. A cell whose text starts with "=" shows its result; put the
 * cursor in it to see and edit the formula. The formula text is what is saved,
 * so drafts, versions and Markdown export keep it.
 */

interface CellInfo {
  pos: number;
  node: PMNode;
  row: number;
  col: number;
}

/** Cells of a table with their grid positions. Merged cells take the first column they cover. */
function tableCells(table: PMNode, tablePos: number): CellInfo[] {
  const cells: CellInfo[] = [];
  table.forEach((rowNode, rowOffset, row) => {
    let col = 0;
    rowNode.forEach((cell, cellOffset) => {
      cells.push({ pos: tablePos + 1 + rowOffset + 1 + cellOffset, node: cell, row, col });
      col += Number(cell.attrs.colspan ?? 1) || 1;
    });
  });
  return cells;
}

function toGrid(cells: CellInfo[]): string[][] {
  const grid: string[][] = [];
  for (const c of cells) {
    const row = (grid[c.row] ??= []);
    row[c.col] = c.node.textContent;
  }
  // Fill gaps left by merged cells so ranges across them read as blank.
  const width = Math.max(0, ...grid.map((r) => r.length));
  return grid.map((r) => Array.from({ length: width }, (_, i) => r[i] ?? ''));
}

function decorate(state: EditorState): DecorationSet {
  const decorations: Decoration[] = [];
  const { from } = state.selection;
  state.doc.descendants((node, pos) => {
    if (node.type.name !== 'table') return true;
    const cells = tableCells(node, pos);
    const results = evaluateGrid(toGrid(cells));
    for (const cell of cells) {
      const res = results[cell.row]?.[cell.col];
      if (!res) continue;
      const editing = from > cell.pos && from < cell.pos + cell.node.nodeSize;
      const shown = formatResult(res);
      const formula = cell.node.textContent.trim();
      decorations.push(
        Decoration.node(cell.pos, cell.pos + cell.node.nodeSize, {
          class: ['formula-cell', editing ? 'formula-editing' : '', res.ok ? '' : 'formula-error'].join(' ').trim(),
          'data-result': editing ? `= ${shown}` : shown,
          title: res.ok ? `${cellAddress(cell.row, cell.col)}: ${formula}` : `${formula}\n${FORMULA_ERROR_HELP[res.error]}`,
        }),
      );
    }
    return false; // no tables inside tables
  });
  return DecorationSet.create(state.doc, decorations);
}

export const Formulas = Extension.create({
  name: 'formulas',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('formulas'),
        props: {
          decorations: decorate,
          handleDOMEvents: {
            // The formula text is hidden while a cell shows its result, so a click
            // would land somewhere unpredictable. Put the cursor at the end of the formula.
            mousedown(view, event) {
              const target = event.target as HTMLElement | null;
              const cellEl = target?.closest?.('.formula-cell:not(.formula-editing)');
              if (!cellEl || !view.editable) return false;
              const inside = view.posAtDOM(cellEl, 0);
              const $pos = view.state.doc.resolve(inside);
              for (let d = $pos.depth; d > 0; d--) {
                const n = $pos.node(d);
                if (n.type.name === 'tableCell' || n.type.name === 'tableHeader') {
                  const end = $pos.end(d) - 1; // inside the cell's last paragraph
                  view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(end), -1)));
                  view.focus();
                  event.preventDefault();
                  return true;
                }
              }
              return false;
            },
          },
        },
      }),
    ];
  },
});

/** Where the cursor is in a table, if it is in one. */
export function currentCell(state: EditorState): { row: number; col: number; address: string; headerRows: number; cellPos: number; cell: PMNode } | null {
  const $from = state.selection.$from;
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name !== 'table') continue;
    const table = $from.node(d);
    const tablePos = $from.before(d);
    const cells = tableCells(table, tablePos);
    const hit = cells.find((c) => $from.pos > c.pos && $from.pos < c.pos + c.node.nodeSize);
    if (!hit) return null;
    // Leading rows made only of header cells, so a column total skips them.
    let headerRows = 0;
    let counting = true;
    table.forEach((row) => {
      if (!counting) return;
      let allHeader = row.childCount > 0;
      row.forEach((cell) => {
        if (cell.type.name !== 'tableHeader') allHeader = false;
      });
      if (allHeader) headerRows++;
      else counting = false;
    });
    return { row: hit.row, col: hit.col, address: cellAddress(hit.row, hit.col), headerRows, cellPos: hit.pos, cell: hit.node };
  }
  return null;
}

/**
 * Fills the current cell with =SUM(...) or =AVERAGE(...) of the cells above it in
 * the same column (below any header rows). Returns false outside a table or in the top row.
 */
export function insertColumnFormula(editor: Editor, fn: 'SUM' | 'AVERAGE'): boolean {
  const here = currentCell(editor.state);
  if (!here) return false;
  const firstRow = here.headerRows;
  if (here.row <= firstRow) return false;
  const col = cellAddress(firstRow, here.col).replace(/\d+$/, '');
  const text = `=${fn}(${col}${firstRow + 1}:${col}${here.row})`;
  const { state, view } = editor;
  const paragraph = state.schema.nodes.paragraph!.create(null, state.schema.text(text));
  const from = here.cellPos + 1;
  const to = here.cellPos + here.cell.nodeSize - 1;
  const tr = state.tr.replaceWith(from, to, paragraph);
  // Leave the cursor after the formula so the result shows once you move on.
  tr.setSelection(TextSelection.near(tr.doc.resolve(from + paragraph.nodeSize - 1), -1));
  view.dispatch(tr);
  view.focus();
  return true;
}

