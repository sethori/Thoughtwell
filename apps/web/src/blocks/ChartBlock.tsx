import { useState } from 'react';
import { mergeAttributes, Node, NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react';
import { CHART_TYPES, normalizeChart, type ChartData, type ChartType } from '@notes/shared';
import { Dialog } from '../components/Dialog';
import { ChartSvg } from './ChartSvg';
import { dataAttr } from './attrs';

const TYPE_LABEL: Record<ChartType, string> = { bar: 'Bar', line: 'Line', pie: 'Pie' };

/** A graph block. Its data lives on the block, so drafts, versions and review all carry it. */
export const ChartBlock = Node.create({
  name: 'chart',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      chartType: dataAttr('chartType', 'bar', false),
      title: dataAttr('title', '', false),
      labels: dataAttr<string[]>('labels', []),
      series: dataAttr<unknown[]>('series', []),
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="chart"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'chart' })];
  },
  addNodeView() {
    return ReactNodeViewRenderer(ChartView);
  },
});

function ChartView({ node, updateAttributes, editor, selected }: NodeViewProps) {
  const [editing, setEditing] = useState(false);
  const data = normalizeChart(node.attrs);
  return (
    <NodeViewWrapper className={`embed ${selected ? 'sel' : ''}`} data-drag-handle>
      <ChartSvg data={data} />
      {editor.isEditable && (
        <div className="embed-bar" contentEditable={false}>
          <button type="button" className="btn" onClick={() => setEditing(true)}>
            Edit data
          </button>
        </div>
      )}
      {editing && (
        <ChartEditor
          initial={data}
          onClose={() => setEditing(false)}
          onSave={(d) => {
            updateAttributes(d);
            setEditing(false);
          }}
        />
      )}
    </NodeViewWrapper>
  );
}

/** A small grid: rows are labels, columns are series. */
function ChartEditor({ initial, onSave, onClose }: { initial: ChartData; onSave: (d: ChartData) => void; onClose: () => void }) {
  const [chartType, setChartType] = useState<ChartType>(initial.chartType);
  const [title, setTitle] = useState(initial.title);
  const [labels, setLabels] = useState<string[]>(initial.labels.length ? initial.labels : ['A']);
  const [names, setNames] = useState<string[]>(initial.series.length ? initial.series.map((s) => s.name) : ['Series 1']);
  const [cells, setCells] = useState<string[][]>(() =>
    (initial.labels.length ? initial.labels : ['A']).map((_, r) =>
      (initial.series.length ? initial.series : [{ values: [] as (number | null)[] }]).map((s) => (s.values[r] ?? '').toString()),
    ),
  );

  const draft: ChartData = normalizeChart({
    chartType,
    title,
    labels,
    series: names.map((name, c) => ({ name, values: cells.map((row) => row[c] ?? '') })),
  });

  const setCell = (r: number, c: number, v: string) => setCells((g) => g.map((row, i) => (i === r ? row.map((x, j) => (j === c ? v : x)) : row)));

  return (
    <Dialog title="Graph data" sub="Each row is a label on the axis; each column is a series." wide onClose={onClose}>
      <div className="row">
        <label className="field" style={{ flex: '2 1 220px' }}>
          <span>Title</span>
          <input className="input" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <div className="field" style={{ flex: '1 1 200px' }}>
          <span>Type</span>
          <div className="choices">
            {CHART_TYPES.map((t) => (
              <button key={t} type="button" className={`choice ${chartType === t ? 'on' : ''}`} aria-pressed={chartType === t} onClick={() => setChartType(t)}>
                {TYPE_LABEL[t]}
              </button>
            ))}
          </div>
        </div>
      </div>
      {chartType === 'pie' && names.length > 1 && <p className="sub">A pie chart shows the first series only.</p>}

      <div className="grid-editor">
        <table>
          <thead>
            <tr>
              <th>Label</th>
              {names.map((n, c) => (
                <th key={c}>
                  <input
                    className="input"
                    aria-label={`Series ${c + 1} name`}
                    value={n}
                    onChange={(e) => setNames((ns) => ns.map((x, j) => (j === c ? e.target.value : x)))}
                  />
                  {names.length > 1 && (
                    <button
                      type="button"
                      className="link-btn"
                      aria-label={`Remove series ${n}`}
                      onClick={() => {
                        setNames((ns) => ns.filter((_, j) => j !== c));
                        setCells((g) => g.map((row) => row.filter((_, j) => j !== c)));
                      }}
                    >
                      Remove
                    </button>
                  )}
                </th>
              ))}
              <th>
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setNames((ns) => [...ns, `Series ${ns.length + 1}`]);
                    setCells((g) => g.map((row) => [...row, '']));
                  }}
                >
                  + Series
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {labels.map((l, r) => (
              <tr key={r}>
                <td>
                  <input className="input" aria-label={`Label ${r + 1}`} value={l} onChange={(e) => setLabels((ls) => ls.map((x, i) => (i === r ? e.target.value : x)))} />
                </td>
                {names.map((_, c) => (
                  <td key={c}>
                    <input
                      className="input num"
                      inputMode="decimal"
                      aria-label={`${names[c]}, ${l}`}
                      value={cells[r]?.[c] ?? ''}
                      onChange={(e) => setCell(r, c, e.target.value)}
                    />
                  </td>
                ))}
                <td>
                  {labels.length > 1 && (
                    <button
                      type="button"
                      className="link-btn"
                      aria-label={`Remove row ${l}`}
                      onClick={() => {
                        setLabels((ls) => ls.filter((_, i) => i !== r));
                        setCells((g) => g.filter((_, i) => i !== r));
                      }}
                    >
                      Remove
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button
          type="button"
          className="btn"
          onClick={() => {
            setLabels((ls) => [...ls, `Item ${ls.length + 1}`]);
            setCells((g) => [...g, names.map(() => '')]);
          }}
        >
          + Row
        </button>
      </div>

      <div className="chart-preview">
        <ChartSvg data={draft} />
      </div>
      <div className="actions">
        <button type="button" className="btn" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn pri" onClick={() => onSave(draft)}>
          Save graph
        </button>
      </div>
    </Dialog>
  );
}
