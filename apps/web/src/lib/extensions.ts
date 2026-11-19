import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { Extension } from '@tiptap/react';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';
import { common, createLowlight } from 'lowlight';
import { Formulas } from './formulas';
import { displaySrc } from './vault';
import { ChartBlock } from '../blocks/ChartBlock';
import { FlowchartBlock } from '../blocks/FlowchartBlock';
import { SketchBlock } from '../blocks/SketchBlock';
import { RawBlock } from '../blocks/RawBlock';

/** Syntax highlighting for the ~35 most common languages. */
export const lowlight = createLowlight(common);

/** Languages offered in the code block picker, by highlight.js name. */
export const CODE_LANGUAGES: { id: string; label: string }[] = [
  { id: '', label: 'Plain text' },
  { id: 'bash', label: 'Bash / shell' },
  { id: 'c', label: 'C' },
  { id: 'cpp', label: 'C++' },
  { id: 'csharp', label: 'C#' },
  { id: 'css', label: 'CSS' },
  { id: 'diff', label: 'Diff' },
  { id: 'go', label: 'Go' },
  { id: 'ini', label: 'INI / TOML' },
  { id: 'java', label: 'Java' },
  { id: 'javascript', label: 'JavaScript' },
  { id: 'json', label: 'JSON' },
  { id: 'kotlin', label: 'Kotlin' },
  { id: 'markdown', label: 'Markdown' },
  { id: 'php', label: 'PHP' },
  { id: 'powershell', label: 'PowerShell' },
  { id: 'python', label: 'Python' },
  { id: 'ruby', label: 'Ruby' },
  { id: 'rust', label: 'Rust' },
  { id: 'sql', label: 'SQL' },
  { id: 'swift', label: 'Swift' },
  { id: 'typescript', label: 'TypeScript' },
  { id: 'xml', label: 'HTML / XML' },
  { id: 'yaml', label: 'YAML' },
].filter((l) => !l.id || lowlight.registered(l.id));

/** Images keep the link as written in the file (relative to the note) and show the vault file. */
const VaultImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      src: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-src') ?? el.getAttribute('src'),
        renderHTML: (attrs: Record<string, unknown>) => {
          const src = String(attrs.src ?? '');
          return { src: displaySrc(src), 'data-src': src };
        },
      },
    };
  },
}).configure({ inline: true, allowBase64: true });

const WIKILINK = /\[\[([^\]\n|#]+)(?:#[^\]\n|]*)?(?:\|([^\]\n]*))?\]\]/g;

function wikilinkDecorations(doc: PMNode): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text || node.marks.some((m) => m.type.name === 'code')) return;
    for (const m of node.text.matchAll(WIKILINK)) {
      const from = pos + m.index!;
      decorations.push(
        Decoration.inline(from, from + m[0].length, {
          class: 'wikilink',
          'data-target': m[1]!.trim(),
          title: `${m[1]!.trim()} (Ctrl+click to open)`,
        }),
      );
    }
  });
  return DecorationSet.create(doc, decorations);
}

/** [[Note name]] links stay as typed in the file and show as links. NoteView opens them on click. */
export const Wikilinks = Extension.create({
  name: 'wikilinks',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('wikilinks'),
        state: {
          init: (_, state) => wikilinkDecorations(state.doc),
          apply: (tr, old) => (tr.docChanged ? wikilinkDecorations(tr.doc) : old),
        },
        props: {
          decorations(state) {
            return this.getState(state);
          },
        },
      }),
    ];
  },
});

/**
 * The block types a note can hold. Every one of them has a Markdown form
 * (see @notes/shared markdown.ts and parse.ts), because notes are stored as Markdown.
 */
export const extensions = [
  StarterKit.configure({ heading: { levels: [1, 2, 3, 4, 5, 6] }, codeBlock: false }),
  CodeBlockLowlight.configure({ lowlight, defaultLanguage: null }),
  VaultImage,
  Link.configure({ openOnClick: false, autolink: true, protocols: ['http', 'https', 'mailto'] }),
  Table.configure({ resizable: false }),
  TableRow,
  TableHeader,
  TableCell,
  TaskList,
  TaskItem.configure({ nested: true }),
  Formulas,
  ChartBlock,
  SketchBlock,
  FlowchartBlock,
  RawBlock,
  Wikilinks,
];

export const placeholder = Placeholder.configure({ placeholder: 'Start writing. Link other notes with [[Note name]], or add a block from the tools on the right.' });
