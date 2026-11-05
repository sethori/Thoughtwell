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
import { generateJSON } from '@tiptap/react';
import type { PMDoc } from './api';

/**
 * The block types a page can hold. Graphs, sketch diagrams and flowcharts
 * join this list in later phases; the content model already allows them.
 */
export const extensions = [
  StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
  Image.configure({ inline: false }),
  Link.configure({ openOnClick: false, autolink: true, protocols: ['http', 'https', 'mailto'] }),
  Table.configure({ resizable: true }),
  TableRow,
  TableHeader,
  TableCell,
  TaskList,
  TaskItem.configure({ nested: true }),
];

export const editorExtensions = [...extensions, Placeholder.configure({ placeholder: 'Start writing, or use the tools on the right to add a block' })];

/** HTML (from a Markdown import) to the editor's document format. */
export function htmlToDoc(html: string): PMDoc {
  return generateJSON(html, extensions) as PMDoc;
}
