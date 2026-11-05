/**
 * Block attributes are stored in the document JSON. When a block is copied as
 * HTML (or imported), they travel as data- attributes; this reads and writes
 * them, as JSON for structured values.
 */
export function dataAttr<T>(key: string, fallback: T, json = true) {
  const name = `data-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
  return {
    default: fallback,
    parseHTML: (el: HTMLElement): T => {
      const raw = el.getAttribute(name);
      if (raw === null) return fallback;
      if (!json) return raw as unknown as T;
      try {
        return JSON.parse(raw) as T;
      } catch {
        return fallback;
      }
    },
    renderHTML: (attrs: Record<string, unknown>) => {
      const v = attrs[key];
      if (v === undefined || v === null) return {};
      return { [name]: json ? JSON.stringify(v) : String(v) };
    },
  };
}
