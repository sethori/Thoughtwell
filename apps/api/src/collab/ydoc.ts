import * as Y from 'yjs';

/**
 * Converts between the editor's JSON documents and the Yjs document that live
 * editing shares. The layout matches y-prosemirror, which the editor uses:
 * a fragment named "default", one XmlElement per node (attributes = node
 * attributes) and XmlText for text (formatting attributes = marks).
 */

export interface JsonNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: JsonNode[];
  text?: string;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
}

export const FRAGMENT = 'default';

type Entry =
  | { kind: 'text'; y: Y.XmlText; runs: { text: string; attrs: Record<string, unknown> }[] }
  | { kind: 'el'; y: Y.XmlElement; node: JsonNode };

function fill(parent: Y.XmlElement | Y.XmlFragment, nodes: JsonNode[]): void {
  const entries: Entry[] = [];
  for (const node of nodes) {
    if (node.type === 'text') {
      const last = entries[entries.length - 1];
      const attrs: Record<string, unknown> = {};
      for (const m of node.marks ?? []) attrs[m.type] = m.attrs ?? {};
      const run = { text: node.text ?? '', attrs };
      if (last?.kind === 'text') last.runs.push(run);
      else entries.push({ kind: 'text', y: new Y.XmlText(), runs: [run] });
    } else {
      entries.push({ kind: 'el', y: new Y.XmlElement(node.type), node });
    }
  }
  // Insert first, then fill: Yjs types can only be written once they are in a document.
  parent.insert(0, entries.map((e) => e.y));
  for (const e of entries) {
    if (e.kind === 'text') {
      let at = 0;
      for (const run of e.runs) {
        if (!run.text) continue;
        e.y.insert(at, run.text, Object.keys(run.attrs).length ? run.attrs : undefined);
        at += run.text.length;
      }
    } else {
      for (const [key, value] of Object.entries(e.node.attrs ?? {})) {
        // y-prosemirror stores attribute values as they are (numbers, arrays, objects).
        if (value !== null && value !== undefined) e.y.setAttribute(key, value as string);
      }
      if (e.node.content?.length) fill(e.y, e.node.content);
    }
  }
}

/** Writes `doc` into an empty Yjs document. */
export function writeJsonToYDoc(ydoc: Y.Doc, doc: JsonNode): void {
  const fragment = ydoc.getXmlFragment(FRAGMENT);
  ydoc.transact(() => {
    if (fragment.length) fragment.delete(0, fragment.length);
    fill(fragment, doc.content ?? []);
  });
}

function serialize(item: Y.XmlElement | Y.XmlText | Y.XmlHook): JsonNode[] {
  if (item instanceof Y.XmlText) {
    return (item.toDelta() as { insert: unknown; attributes?: Record<string, unknown> }[])
      .filter((d) => typeof d.insert === 'string' && d.insert.length)
      .map((d) => {
        const node: JsonNode = { type: 'text', text: d.insert as string };
        if (d.attributes && Object.keys(d.attributes).length) {
          node.marks = Object.entries(d.attributes).map(([type, attrs]) => {
            const a = attrs as Record<string, unknown> | null;
            return a && typeof a === 'object' && Object.keys(a).length ? { type, attrs: a } : { type };
          });
        }
        return node;
      });
  }
  if (item instanceof Y.XmlElement) {
    const node: JsonNode = { type: item.nodeName };
    const attrs = item.getAttributes() as Record<string, unknown>;
    if (Object.keys(attrs).length) node.attrs = attrs;
    const content = item.toArray().flatMap((c) => serialize(c as Y.XmlElement | Y.XmlText));
    if (content.length) node.content = content;
    return [node];
  }
  return [];
}

/** The editor JSON for a Yjs document. */
export function yDocToJson(ydoc: Y.Doc): JsonNode {
  const fragment = ydoc.getXmlFragment(FRAGMENT);
  return { type: 'doc', content: fragment.toArray().flatMap((c) => serialize(c as Y.XmlElement | Y.XmlText)) };
}
