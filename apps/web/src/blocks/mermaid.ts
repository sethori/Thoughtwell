/** Mermaid is large, so it loads the first time a flowchart is shown. */
type Mermaid = typeof import('mermaid').default;
let loading: Promise<Mermaid> | null = null;
let seq = 0;

/** Renders Mermaid source to SVG markup. Throws with Mermaid's message when the source has a mistake. */
export async function renderMermaid(code: string, dark: boolean): Promise<string> {
  const mermaid = await (loading ??= import('mermaid').then((m) => m.default));
  mermaid.initialize({
    startOnLoad: false,
    // Strict: no scripts or click handlers from diagram text.
    securityLevel: 'strict',
    theme: dark ? 'dark' : 'default',
    // Plain SVG text instead of HTML labels, so the picture can be shown as an image.
    flowchart: { htmlLabels: false },
    fontFamily: 'Inter, system-ui, sans-serif',
  });
  const id = `mmd-${++seq}`;
  try {
    await mermaid.parse(code);
    const { svg } = await mermaid.render(id, code);
    return svg;
  } finally {
    // Mermaid leaves a scratch element behind when rendering fails.
    document.getElementById(`d${id}`)?.remove();
    document.getElementById(id)?.remove();
  }
}

export function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export const isDark = () => document.documentElement.dataset.mode !== 'light';
