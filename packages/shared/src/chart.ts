/** Data behind a graph block. Stored on the block itself, so versions and review see it. */
export const CHART_TYPES = ['bar', 'line', 'pie'] as const;
export type ChartType = (typeof CHART_TYPES)[number];

export interface ChartSeries {
  name: string;
  values: (number | null)[];
}

export interface ChartData {
  chartType: ChartType;
  title: string;
  labels: string[];
  series: ChartSeries[];
}

export const SAMPLE_CHART: ChartData = {
  chartType: 'bar',
  title: '',
  labels: ['Q1', 'Q2', 'Q3', 'Q4'],
  series: [
    { name: 'This year', values: [12, 18, 15, 22] },
    { name: 'Last year', values: [10, 14, 16, 17] },
  ],
};

const MAX_LABELS = 200;
const MAX_SERIES = 12;

/** Cleans block attributes into chart data: right types, equal lengths, sane limits. */
export function normalizeChart(raw: unknown): ChartData {
  const r = (raw ?? {}) as Partial<Record<keyof ChartData, unknown>>;
  const chartType = CHART_TYPES.includes(r.chartType as ChartType) ? (r.chartType as ChartType) : 'bar';
  const labels = (Array.isArray(r.labels) ? r.labels : []).slice(0, MAX_LABELS).map((l) => String(l ?? ''));
  const series = (Array.isArray(r.series) ? r.series : []).slice(0, MAX_SERIES).map((s, i) => {
    const so = (s ?? {}) as { name?: unknown; values?: unknown };
    const values = Array.isArray(so.values) ? so.values : [];
    return {
      name: typeof so.name === 'string' && so.name.trim() ? so.name : `Series ${i + 1}`,
      values: labels.map((_, k) => {
        const v = values[k];
        const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
        return Number.isFinite(n) ? n : null;
      }),
    };
  });
  return { chartType, title: typeof r.title === 'string' ? r.title.slice(0, 200) : '', labels, series };
}
