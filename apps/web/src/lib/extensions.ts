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
import { generateJSON } from '@tiptap/react';
import { common, createLowlight } from 'lowlight';
import type { PMDoc } from './api';
import { Formulas } from './formulas';
import { ChartBlock } from '../blocks/ChartBlock';
import { FlowchartBlock } from '../blocks/FlowchartBlock';
import { SketchBlock } from '../blocks/SketchBlock';

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

/**
 * The block types a page can hold. Shared by the live editor, read-only views
 * and Markdown import, so every view understands the same document.
 */
export const extensions = [
  // Undo history comes from live editing (each person undoes their own changes).
  StarterKit.configure({ heading: { levels: [1, 2, 3] }, codeBlock: false, history: false }),
  CodeBlockLowlight.configure({ lowlight, defaultLanguage: null }),
  Image.configure({ inline: false }),
  Link.configure({ openOnClick: false, autolink: true, protocols: ['http', 'https', 'mailto'] }),
  Table.configure({ resizable: true }),
  TableRow,
  TableHeader,
  TableCell,
  TaskList,
  TaskItem.configure({ nested: true }),
  Formulas,
  ChartBlock,
  SketchBlock,
  FlowchartBlock,
];

export const placeholder = Placeholder.configure({ placeholder: 'Start writing, or use the tools on the right to add a block' });

interface JsonNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: JsonNode[];
  text?: string;
}

/** A ```mermaid fence in Markdown becomes a flowchart block rather than code. */
function mermaidToFlowcharts(node: JsonNode): JsonNode {
  if (node.type === 'codeBlock' && node.attrs?.language === 'mermaid') {
    return { type: 'flowchart', attrs: { code: (node.content ?? []).map((c) => c.text ?? '').join('') } };
  }
  return node.content ? { ...node, content: node.content.map(mermaidToFlowcharts) } : node;
}

/** HTML (from a Markdown import) to the editor's document format. */
export function htmlToDoc(html: string): PMDoc {
  return mermaidToFlowcharts(generateJSON(html, extensions) as JsonNode) as PMDoc;
}
