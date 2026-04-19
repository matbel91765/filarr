/**
 * Read-only extension set for rendering stored note content.
 *
 * Mirrors the node/mark set registered in NoteEditor so that a
 * snapshot's JSON can be fully rendered in a viewer without any
 * nodes being silently dropped. Behavioral plugins (slash command,
 * drag handle, suggestions, etc.) are intentionally omitted —
 * they're irrelevant in a read-only context and would attach
 * unwanted listeners to the preview.
 *
 * If a new node type is added to NoteEditor, it must also be added
 * here or stored snapshots using it will render blank in the
 * history viewer.
 */

import StarterKit from '@tiptap/starter-kit';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Link from '@tiptap/extension-link';
import Highlight from '@tiptap/extension-highlight';
import Typography from '@tiptap/extension-typography';
import Underline from '@tiptap/extension-underline';
import { TextStyle } from '@tiptap/extension-text-style';
import { Color } from '@tiptap/extension-color';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import { common, createLowlight } from 'lowlight';

import { EnhancedCodeBlockExtension } from '../extensions/codeBlockExtension';
import { FileEmbedExtension } from '../extensions/fileEmbedExtension';
import { TransclusionExtension } from '../extensions/transclusionExtension';
import { WikiLinkDecorationExtension } from '../extensions/wikiLinkDecorationPlugin';
import { CalloutExtension } from '../extensions/calloutExtension';
import { BookmarkExtension } from '../extensions/bookmarkExtension';
import { CalendarBlockExtension } from '../extensions/calendarBlockExtension';
import { ToggleExtension, ToggleSummaryExtension } from '../extensions/toggleExtension';
import { MathBlockExtension, MathInlineExtension } from '../extensions/mathExtension';
import { ColumnsExtension, ColumnExtension } from '../extensions/columnsExtension';
import { TocExtension } from '../extensions/tocExtension';
import { MermaidExtension } from '../extensions/mermaidExtension';
import { DateExtension } from '../extensions/dateExtension';
import { EmbedExtension } from '../extensions/embedExtension';
import { CommentExtension } from '../extensions/commentExtension';
import { FootnoteExtension } from '../extensions/footnotesExtension';
import { DataviewExtension } from '../extensions/dataviewExtension';
import { SubPageExtension } from '../extensions/subPageExtension';

const lowlight = createLowlight(common);

/**
 * Build the extension list for a read-only viewer. Called fresh per
 * VersionRender mount so each editor gets its own instance tree.
 */
export function buildReadOnlyExtensions() {
  return [
    StarterKit.configure({
      // NoteEditor disables the bundled codeBlock in favor of the
      // lowlight-based one; we mirror that exactly so code blocks
      // round-trip through both editors with the same schema.
      codeBlock: false,
      heading: { levels: [1, 2, 3, 4] },
      link: false,
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Link.configure({
      openOnClick: false,
      HTMLAttributes: { class: 'note-link' },
    }),
    Highlight.configure({ multicolor: true }),
    Underline,
    TextStyle,
    Color,
    Typography,
    Table.configure({ resizable: false }),
    TableRow,
    TableCell,
    TableHeader,
    EnhancedCodeBlockExtension.configure({ lowlight }),
    FileEmbedExtension,
    TransclusionExtension,
    WikiLinkDecorationExtension,
    CalloutExtension,
    BookmarkExtension,
    CalendarBlockExtension,
    ToggleExtension,
    ToggleSummaryExtension,
    MathBlockExtension,
    MathInlineExtension,
    ColumnsExtension,
    ColumnExtension,
    TocExtension,
    MermaidExtension,
    DateExtension,
    EmbedExtension,
    CommentExtension,
    FootnoteExtension,
    DataviewExtension,
    SubPageExtension,
  ];
}
