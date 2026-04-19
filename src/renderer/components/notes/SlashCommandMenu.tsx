/**
 * SlashCommandMenu — Filarr Notes
 *
 * Dropdown menu that appears when the user types "/" in the editor.
 * Provides quick insertion of block types (headings, lists, code, etc.)
 */

import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';

// ==================== Command Definitions ====================

export interface SlashCommandItem {
  id: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  aliases?: string[];
  action: (editor: any) => void;
}

const H1Icon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <path d="M4 12h8M4 18V6M12 18V6M17 12l3-2v8" />
  </svg>
);
const H2Icon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <path d="M4 12h8M4 18V6M12 18V6" />
    <path d="M21 18h-4c0-4 4-3 4-6 0-1.5-2-2.5-4-1" />
  </svg>
);
const H3Icon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <path d="M4 12h8M4 18V6M12 18V6" />
    <path d="M17.5 10.5c1.7-1 3.5 0 3.5 1.5a2 2 0 01-2 2c1.5 0 2 1 2 2a2 2 0 01-3.5 1.5" />
  </svg>
);
const BulletListIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <line x1="9" y1="6" x2="20" y2="6" />
    <line x1="9" y1="12" x2="20" y2="12" />
    <line x1="9" y1="18" x2="20" y2="18" />
    <circle cx="5" cy="6" r="1" fill="currentColor" />
    <circle cx="5" cy="12" r="1" fill="currentColor" />
    <circle cx="5" cy="18" r="1" fill="currentColor" />
  </svg>
);
const NumberListIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <line x1="10" y1="6" x2="21" y2="6" />
    <line x1="10" y1="12" x2="21" y2="12" />
    <line x1="10" y1="18" x2="21" y2="18" />
    <path d="M4 6h1v4M4 10h2M6 18H4c0-1 2-2 2-3s-1-1.5-2-1" />
  </svg>
);
const TaskListIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <rect x="3" y="5" width="6" height="6" rx="1" />
    <path d="M5 8l1.5 1.5L9 7" />
    <line x1="13" y1="8" x2="21" y2="8" />
    <rect x="3" y="14" width="6" height="6" rx="1" />
    <line x1="13" y1="17" x2="21" y2="17" />
  </svg>
);
const QuoteIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V21z" />
    <path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3z" />
  </svg>
);
const CodeBlockIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <polyline points="16,18 22,12 16,6" />
    <polyline points="8,6 2,12 8,18" />
  </svg>
);
const TableIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <line x1="3" y1="9" x2="21" y2="9" />
    <line x1="3" y1="15" x2="21" y2="15" />
    <line x1="9" y1="3" x2="9" y2="21" />
    <line x1="15" y1="3" x2="15" y2="21" />
  </svg>
);
const DividerIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <line x1="2" y1="12" x2="22" y2="12" />
  </svg>
);
const TextIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <path d="M4 7V4h16v3M9 20h6M12 4v16" />
  </svg>
);
const ImageIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <circle cx="8.5" cy="8.5" r="1.5" />
    <polyline points="21,15 16,10 5,21" />
  </svg>
);
const FileEmbedIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
  </svg>
);
const CalloutIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <line x1="3" y1="3" x2="3" y2="21" strokeWidth={4} />
    <circle cx="12" cy="10" r="1" fill="currentColor" />
    <line x1="12" y1="13" x2="12" y2="16" />
  </svg>
);
const PageIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
    <polyline points="14,2 14,8 20,8" />
    <line x1="9" y1="13" x2="15" y2="13" />
    <line x1="9" y1="17" x2="13" y2="17" />
  </svg>
);

export const SLASH_COMMANDS: SlashCommandItem[] = [
  {
    id: 'text',
    label: 'Text',
    description: 'Plain text paragraph',
    icon: <TextIcon />,
    aliases: ['paragraph', 'p'],
    action: (editor) => editor.chain().focus().setParagraph().run(),
  },
  {
    id: 'h1',
    label: 'Heading 1',
    description: 'Large section heading',
    icon: <H1Icon />,
    aliases: ['h1', 'title', 'heading'],
    action: (editor) => editor.chain().focus().toggleHeading({ level: 1 }).run(),
  },
  {
    id: 'h2',
    label: 'Heading 2',
    description: 'Medium section heading',
    icon: <H2Icon />,
    aliases: ['h2', 'subtitle'],
    action: (editor) => editor.chain().focus().toggleHeading({ level: 2 }).run(),
  },
  {
    id: 'h3',
    label: 'Heading 3',
    description: 'Small section heading',
    icon: <H3Icon />,
    aliases: ['h3', 'subheading'],
    action: (editor) => editor.chain().focus().toggleHeading({ level: 3 }).run(),
  },
  {
    id: 'bullet-list',
    label: 'Bullet List',
    description: 'Unordered list with bullets',
    icon: <BulletListIcon />,
    aliases: ['ul', 'unordered', 'list', 'bullet'],
    action: (editor) => editor.chain().focus().toggleBulletList().run(),
  },
  {
    id: 'ordered-list',
    label: 'Numbered List',
    description: 'Ordered list with numbers',
    icon: <NumberListIcon />,
    aliases: ['ol', 'ordered', 'numbered'],
    action: (editor) => editor.chain().focus().toggleOrderedList().run(),
  },
  {
    id: 'task-list',
    label: 'Task List',
    description: 'Checklist with checkboxes',
    icon: <TaskListIcon />,
    aliases: ['todo', 'checklist', 'checkbox', 'task'],
    action: (editor) => editor.chain().focus().toggleTaskList().run(),
  },
  {
    id: 'blockquote',
    label: 'Quote',
    description: 'Block quotation',
    icon: <QuoteIcon />,
    aliases: ['quote', 'blockquote', 'citation'],
    action: (editor) => editor.chain().focus().toggleBlockquote().run(),
  },
  {
    id: 'code-block',
    label: 'Code Block',
    description: 'Syntax-highlighted code',
    icon: <CodeBlockIcon />,
    aliases: ['code', 'codeblock', 'pre', 'snippet'],
    action: (editor) => editor.chain().focus().toggleCodeBlock().run(),
  },
  {
    id: 'table',
    label: 'Table',
    description: '3×3 table with header',
    icon: <TableIcon />,
    aliases: ['table', 'grid'],
    action: (editor) =>
      editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  },
  {
    id: 'divider',
    label: 'Divider',
    description: 'Horizontal separator line',
    icon: <DividerIcon />,
    aliases: ['hr', 'divider', 'separator', 'line'],
    action: (editor) => editor.chain().focus().setHorizontalRule().run(),
  },
  {
    id: 'callout-info',
    label: 'Callout',
    description: 'Info callout box',
    icon: <CalloutIcon />,
    aliases: ['callout', 'info', 'alert', 'box', 'encadre', 'encadré'],
    action: (editor) => editor.chain().focus().insertCallout('info').run(),
  },
  {
    id: 'callout-warning',
    label: 'Warning',
    description: 'Warning callout box',
    icon: <CalloutIcon />,
    aliases: ['warning', 'attention', 'avertissement'],
    action: (editor) => editor.chain().focus().insertCallout('warning').run(),
  },
  {
    id: 'callout-success',
    label: 'Success',
    description: 'Success callout box',
    icon: <CalloutIcon />,
    aliases: ['success', 'done', 'réussite'],
    action: (editor) => editor.chain().focus().insertCallout('success').run(),
  },
  {
    id: 'callout-tip',
    label: 'Tip',
    description: 'Tip callout box',
    icon: <CalloutIcon />,
    aliases: ['tip', 'astuce', 'hint', 'conseil'],
    action: (editor) => editor.chain().focus().insertCallout('tip').run(),
  },
  {
    id: 'callout-important',
    label: 'Important',
    description: 'Important callout box',
    icon: <CalloutIcon />,
    aliases: ['important', 'critical', 'crucial'],
    action: (editor) => editor.chain().focus().insertCallout('important').run(),
  },
  {
    id: 'callout-note',
    label: 'Note Box',
    description: 'Note callout box',
    icon: <CalloutIcon />,
    aliases: ['notebox', 'memo', 'remarque'],
    action: (editor) => editor.chain().focus().insertCallout('note').run(),
  },
  {
    id: 'callout-bug',
    label: 'Bug',
    description: 'Bug report callout',
    icon: <CalloutIcon />,
    aliases: ['bug', 'issue', 'problème'],
    action: (editor) => editor.chain().focus().insertCallout('bug').run(),
  },
  {
    id: 'callout-example',
    label: 'Example',
    description: 'Example callout box',
    icon: <CalloutIcon />,
    aliases: ['example', 'exemple', 'demo'],
    action: (editor) => editor.chain().focus().insertCallout('example').run(),
  },
  {
    id: 'callout-quote',
    label: 'Quote Box',
    description: 'Styled quote callout',
    icon: <CalloutIcon />,
    aliases: ['quotebox', 'citation'],
    action: (editor) => editor.chain().focus().insertCallout('quote').run(),
  },
  // ---- New block types ----
  {
    id: 'toggle',
    label: 'Toggle',
    description: 'Collapsible section',
    icon: (
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path d="M6 9l6 6 6-6" />
      </svg>
    ),
    aliases: ['toggle', 'collapse', 'fold', 'details', 'accordion'],
    action: (editor) => editor.chain().focus().insertToggle().run(),
  },
  {
    id: 'math',
    label: 'Math Block',
    description: 'LaTeX math equation',
    icon: (
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
      >
        <text
          x="4"
          y="18"
          fontSize="16"
          fontFamily="serif"
          fontStyle="italic"
          fill="currentColor"
          stroke="none"
        >
          fx
        </text>
      </svg>
    ),
    aliases: ['math', 'latex', 'equation', 'formula', 'katex'],
    action: (editor) => editor.chain().focus().insertMathBlock().run(),
  },
  {
    id: 'math-inline',
    label: 'Inline Math',
    description: 'Inline LaTeX expression',
    icon: (
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
      >
        <text
          x="4"
          y="16"
          fontSize="14"
          fontFamily="serif"
          fontStyle="italic"
          fill="currentColor"
          stroke="none"
        >
          x²
        </text>
      </svg>
    ),
    aliases: ['inline-math', 'inline-latex'],
    action: (editor) => editor.chain().focus().insertMathInline().run(),
  },
  {
    id: '2-columns',
    label: '2 Columns',
    description: 'Two-column layout',
    icon: (
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
      >
        <rect x="3" y="3" width="8" height="18" rx="1" />
        <rect x="13" y="3" width="8" height="18" rx="1" />
      </svg>
    ),
    aliases: ['columns', '2col', 'two-columns', 'side-by-side'],
    action: (editor) => editor.chain().focus().insertColumns(2).run(),
  },
  {
    id: '3-columns',
    label: '3 Columns',
    description: 'Three-column layout',
    icon: (
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
      >
        <rect x="2" y="3" width="5" height="18" rx="1" />
        <rect x="9" y="3" width="5" height="18" rx="1" />
        <rect x="16" y="3" width="5" height="18" rx="1" />
      </svg>
    ),
    aliases: ['3col', 'three-columns'],
    action: (editor) => editor.chain().focus().insertColumns(3).run(),
  },
  {
    id: 'toc',
    label: 'Table of Contents',
    description: 'Auto-generated heading outline',
    icon: (
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
      >
        <line x1="8" y1="6" x2="21" y2="6" />
        <line x1="8" y1="12" x2="21" y2="12" />
        <line x1="8" y1="18" x2="21" y2="18" />
        <line x1="3" y1="6" x2="3.01" y2="6" />
        <line x1="3" y1="12" x2="3.01" y2="12" />
        <line x1="3" y1="18" x2="3.01" y2="18" />
      </svg>
    ),
    aliases: ['toc', 'table-of-contents', 'outline', 'sommaire'],
    action: (editor) => editor.chain().focus().insertTableOfContents().run(),
  },
  {
    id: 'mermaid',
    label: 'Mermaid Diagram',
    description: 'Flowchart, sequence diagram, etc.',
    icon: (
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
      >
        <rect x="3" y="3" width="7" height="5" rx="1" />
        <rect x="14" y="16" width="7" height="5" rx="1" />
        <line x1="6" y1="8" x2="6" y2="13" />
        <line x1="6" y1="13" x2="17" y2="13" />
        <line x1="17" y1="13" x2="17" y2="16" />
      </svg>
    ),
    aliases: ['mermaid', 'diagram', 'flowchart', 'sequence', 'chart'],
    action: (editor) => editor.chain().focus().insertMermaidBlock().run(),
  },
  {
    id: 'date',
    label: 'Date',
    description: 'Insert an inline date',
    icon: (
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
      >
        <rect x="3" y="4" width="18" height="18" rx="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
      </svg>
    ),
    aliases: ['date', 'calendar', 'today', 'datepicker'],
    action: (editor) => editor.chain().focus().insertDate().run(),
  },
  {
    id: 'calendar-block',
    label: 'Calendar',
    description: 'Interactive calendar widget',
    icon: (
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
      >
        <rect x="3" y="4" width="18" height="18" rx="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
        <rect x="7" y="14" width="3" height="3" rx="0.5" fill="currentColor" stroke="none" />
      </svg>
    ),
    aliases: ['calendar', 'calendrier', 'cal', 'month', 'planning'],
    action: (editor) => editor.chain().focus().insertCalendarBlock().run(),
  },
  {
    id: 'bookmark',
    label: 'Bookmark',
    description: 'Web link preview card',
    icon: (
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z" />
      </svg>
    ),
    aliases: ['bookmark', 'link-preview', 'web', 'signet', 'aperçu'],
    action: (editor) => editor.chain().focus().insertBookmark('').run(),
  },
  {
    id: 'embed',
    label: 'Embed URL',
    description: 'YouTube, Vimeo, or any link',
    icon: (
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" />
        <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
      </svg>
    ),
    aliases: ['embed', 'youtube', 'video', 'vimeo', 'iframe', 'url'],
    action: (editor) => editor.chain().focus().insertEmbed('').run(),
  },
  {
    id: 'footnote',
    label: 'Footnote',
    description: 'Add a footnote reference',
    icon: (
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path d="M4 19h16M4 15h16M4 11h10M12 3v4" />
        <circle cx="12" cy="3" r="1" fill="currentColor" />
      </svg>
    ),
    aliases: ['footnote', 'fn', 'note', 'ref'],
    action: (editor) => editor.chain().focus().insertFootnote('').run(),
  },
  {
    id: 'dataview',
    label: 'Dataview',
    description: 'Query your notes with Dataview',
    icon: (
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
      >
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="M8 7h8M8 12h5M8 17h8" />
        <circle cx="17" cy="12" r="2" />
      </svg>
    ),
    aliases: ['dataview', 'query', 'dv', 'database-query'],
    action: (editor) =>
      editor
        .chain()
        .focus()
        .insertDataview('LIST\nFROM notes\nSORT updatedAt DESC\nLIMIT 10')
        .run(),
  },
  {
    id: 'image',
    label: 'Image',
    description: 'Embed an image from your files',
    icon: <ImageIcon />,
    aliases: ['image', 'img', 'photo', 'picture'],
    action: (editor) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = () => {
        const file = input.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          const src = reader.result as string;
          editor
            .chain()
            .focus()
            .insertContent({
              type: 'fileEmbed',
              attrs: {
                fileId: `local-${Date.now()}`,
                fileName: file.name,
                fileType: file.type,
                src,
              },
            })
            .run();
        };
        reader.readAsDataURL(file);
      };
      input.click();
    },
  },
  {
    id: 'file',
    label: 'File',
    description: 'Attach a document or file',
    icon: <FileEmbedIcon />,
    aliases: ['file', 'attach', 'attachment', 'document'],
    action: (editor) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.onchange = () => {
        const file = input.files?.[0];
        if (!file) return;
        const isImage = file.type.startsWith('image/');
        if (isImage) {
          const reader = new FileReader();
          reader.onload = () => {
            editor
              .chain()
              .focus()
              .insertContent({
                type: 'fileEmbed',
                attrs: {
                  fileId: `local-${Date.now()}`,
                  fileName: file.name,
                  fileType: file.type,
                  src: reader.result as string,
                },
              })
              .run();
          };
          reader.readAsDataURL(file);
        } else {
          editor
            .chain()
            .focus()
            .insertContent({
              type: 'fileEmbed',
              attrs: {
                fileId: `local-${Date.now()}`,
                fileName: file.name,
                fileType: file.type,
                src: '',
              },
            })
            .run();
        }
      };
      input.click();
    },
  },
  {
    id: 'sub-page',
    label: 'Page',
    description: 'Create a sub-page inside this note',
    icon: <PageIcon />,
    aliases: ['page', 'sous-page', 'subpage', 'child', 'new page'],
    action: (editor) => editor.chain().focus().insertSubPage().run(),
  },
];

// ==================== Menu Component ====================

export interface SlashCommandMenuRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

interface SlashCommandMenuProps {
  items: SlashCommandItem[];
  command: (item: SlashCommandItem) => void;
}

export const SlashCommandMenu = forwardRef<SlashCommandMenuRef, SlashCommandMenuProps>(
  ({ items, command }, ref) => {
    const [selectedIndex, setSelectedIndex] = useState(0);
    const menuRef = useRef<HTMLDivElement>(null);
    const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

    // Reset selection when items change
    useEffect(() => {
      setSelectedIndex(0);
    }, [items]);

    // Scroll selected item into view
    useEffect(() => {
      itemRefs.current[selectedIndex]?.scrollIntoView({ block: 'nearest' });
    }, [selectedIndex]);

    const selectItem = useCallback(
      (index: number) => {
        const item = items[index];
        if (item) command(item);
      },
      [items, command]
    );

    useImperativeHandle(ref, () => ({
      onKeyDown: ({ event }: { event: KeyboardEvent }) => {
        if (event.key === 'ArrowUp') {
          setSelectedIndex((i) => (i <= 0 ? items.length - 1 : i - 1));
          return true;
        }
        if (event.key === 'ArrowDown') {
          setSelectedIndex((i) => (i >= items.length - 1 ? 0 : i + 1));
          return true;
        }
        if (event.key === 'Enter') {
          selectItem(selectedIndex);
          return true;
        }
        return false;
      },
    }));

    if (items.length === 0) {
      return (
        <div className="slash-menu">
          <div className="slash-menu__empty">No matching commands</div>
        </div>
      );
    }

    return (
      <div className="slash-menu" ref={menuRef}>
        {items.map((item, index) => (
          <button
            key={item.id}
            ref={(el) => {
              itemRefs.current[index] = el;
            }}
            className={`slash-menu__item ${index === selectedIndex ? 'is-selected' : ''}`}
            onClick={() => selectItem(index)}
            onMouseEnter={() => setSelectedIndex(index)}
          >
            <span className="slash-menu__icon">{item.icon}</span>
            <span className="slash-menu__text">
              <span className="slash-menu__label">{item.label}</span>
              <span className="slash-menu__desc">{item.description}</span>
            </span>
          </button>
        ))}
      </div>
    );
  }
);

SlashCommandMenu.displayName = 'SlashCommandMenu';
