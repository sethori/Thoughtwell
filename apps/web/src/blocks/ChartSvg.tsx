import type { ChartData } from '@notes/shared';

const W = 640;
const H = 300;
const PAD = { top: 16, right: 16, bottom: 44, left: 48 };
const SERIES = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)', 'var(--s6)'];
const color = (i: number) => SERIES[i % SERIES.length]!;

/** A tick step of 1, 2 or 5 × 10^n giving about five gridlines. */
function niceScale(min: number, max: number): { lo: number; hi: number; step: number } {
  if (min === max) {
    min = Math.min(0, min);
    max = max === 0 ? 1 : Math.max(0, max);
  }
  const raw = (max - min) / 5;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  return { lo: Math.floor(min / step) * step, hi: Math.ceil(max / step) * step, step };
}

const fmt = (n: number) => (Math.abs(n) >= 1000 ? n.toLocaleString() : String(Number(n.toPrecision(6))));

function Legend({ data }: { data: ChartData }) {
  if (data.series.length < 2 && data.chartType !== 'pie') return null;
  const items = data.chartType === 'pie' ? data.labels : data.series.map((s) => s.name);
  return (
    <div className="chart-legend">
      {items.map((name, i) => (
        <span key={i}>
          <i style={{ background: color(i) }} />
          {name}
        </span>
      ))}
    </div>
  );
}

export function ChartSvg({ data }: { data: ChartData }) {
  const { labels, series, chartType, title } = data;
  const values = series.flatMap((s) => s.values.filter((v): v is number => v !== null));
  if (labels.length === 0 || values.length === 0) {
    return <div className="chart-empty">No data yet. Use Edit data to add some.</div>;
  }

  if (chartType === 'pie') {
    const vals = labels.map((_, i) => Math.max(0, series[0]?.values[i] ?? 0));
    const total = vals.reduce((a, b) => a + b, 0) || 1;
    const cx = W / 2;
    const cy = H / 2;
    const r = H / 2 - 16;
    let angle = -Math.PI / 2;
    return (
      <figure className="chart">
        {title && <figcaption>{title}</figcaption>}
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title || 'Pie chart'}>
          {vals.map((v, i) => {
            const a0 = angle;
            const a1 = angle + (v / total) * Math.PI * 2;
            angle = a1;
            if (v <= 0) return null;
            const large = a1 - a0 > Math.PI ? 1 : 0;
            const p = (a: number) => `${cx + r * Math.cos(a)} ${cy + r * Math.sin(a)}`;
            const d = v >= total ? `M ${cx - r} ${cy} a ${r} ${r} 0 1 0 ${2 * r} 0 a ${r} ${r} 0 1 0 ${-2 * r} 0` : `M ${cx} ${cy} L ${p(a0)} A ${r} ${r} 0 ${large} 1 ${p(a1)} Z`;
            return (
              <path key={i} d={d} fill={color(i)} stroke="var(--page)" strokeWidth={2}>
                <title>{`${labels[i]}: ${fmt(v)} (${Math.round((v / total) * 100)}%)`}</title>
              </path>
            );
          })}
        </svg>
        <Legend data={data} />
      </figure>
    );
  }

  const { lo, hi, step } = niceScale(Math.min(0, ...values), Math.max(0, ...values));
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const y = (v: number) => PAD.top + plotH - ((v - lo) / (hi - lo)) * plotH;
  const band = plotW / labels.length;
  const x = (i: number) => PAD.left + band * i + band / 2;
  const ticks: number[] = [];
  for (let t = lo; t <= hi + step / 2; t += step) ticks.push(Number(t.toPrecision(12)));
  const showEvery = Math.ceil(labels.length / 12);

  return (
    <figure className="chart">
      {title && <figcaption>{title}</figcaption>}
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title || `${chartType} chart`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} className={t === 0 ? 'axis' : 'grid'} />
            <text x={PAD.left - 8} y={y(t)} className="tick" textAnchor="end" dominantBaseline="middle">
              {fmt(t)}
            </text>
          </g>
        ))}
        {labels.map((l, i) =>
          i % showEvery === 0 ? (
            <text key={i} x={x(i)} y={H - PAD.bottom + 18} className="tick" textAnchor="middle">
              {l.length > 14 ? `${l.slice(0, 13)}…` : l}
            </text>
          ) : null,
        )}
        {chartType === 'bar' &&
          series.map((s, si) => {
            const groupW = band * 0.72;
            const barW = groupW / series.length;
            return s.values.map((v, i) => {
              if (v === null) return null;
              const top = y(Math.max(0, v));
              const height = Math.abs(y(v) - y(0));
              return (
                <rect key={`${si}-${i}`} x={x(i) - groupW / 2 + si * barW + 1} y={top} width={Math.max(1, barW - 2)} height={Math.max(1, height)} rx={2} fill={color(si)}>
                  <title>{`${s.name}, ${labels[i]}: ${fmt(v)}`}</title>
                </rect>
              );
            });
          })}
        {chartType === 'line' &&
          series.map((s, si) => {
            const pts = s.values.map((v, i) => (v === null ? null : `${x(i)},${y(v)}`));
            // Gaps in the data break the line rather than drawing to zero.
            const runs: string[][] = [[]];
            for (const p of pts) {
              if (p) runs[runs.length - 1]!.push(p);
              else if (runs[runs.length - 1]!.length) runs.push([]);
            }
            return (
              <g key={si}>
                {runs.filter((r) => r.length).map((r, k) => (
                  <polyline key={k} points={r.join(' ')} fill="none" stroke={color(si)} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
                ))}
                {s.values.map((v, i) =>
                  v === null ? null : (
                    <circle key={i} cx={x(i)} cy={y(v)} r={3.5} fill={color(si)} stroke="var(--page)" strokeWidth={1.5}>
                      <title>{`${s.name}, ${labels[i]}: ${fmt(v)}`}</title>
                    </circle>
                  ),
                )}
              </g>
            );
          })}
      </svg>
      <Legend data={data} />
    </figure>
  );
}
