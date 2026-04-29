/**
 * NoteEditor Component — Filarr Notes
 *
 * TipTap-based rich text editor with:
 * - WYSIWYG markdown editing
 * - Slash commands (type "/" for block insertion menu)
 * - Wiki-link autocomplete (type "[[" to link notes/files/folders)
 * - Task lists, tables, code blocks
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useEditor, EditorContent, ReactRenderer } from '@tiptap/react';
import { sinkListItem, liftListItem } from 'prosemirror-schema-list';
import { BubbleMenu } from '@tiptap/react/menus';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
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
import { EnhancedCodeBlockExtension } from './extensions/codeBlockExtension';
import { useTranslation } from 'react-i18next';
import { useSelector, useDispatch } from 'react-redux';
import type { RootState, AppDispatch } from '../../../store';
import { selectAllNotes, setEditingNote } from '../../../store/slices/notesSlice';
import { addTab } from '../../../store/slices/tabsSlice';
import type { Note } from '../../../types/notes';
import { SlashCommandExtension } from './slashCommandExtension';
import { SlashCommandMenu } from './SlashCommandMenu';
import type { SlashCommandMenuRef, SlashCommandItem } from './SlashCommandMenu';
import { DragHandleExtension } from './extensions/dragHandlePlugin';
import { stripWikiLinks } from '../../../services/notes/noteLinkParser';
import { syncEditorContent } from '../../../services/notes/noteEditorSync';
import { FileEmbedExtension } from './extensions/fileEmbedExtension';
import { TransclusionExtension } from './extensions/transclusionExtension';
import { WikiLinkDecorationExtension } from './extensions/wikiLinkDecorationPlugin';
import { CalloutExtension } from './extensions/calloutExtension';
import { BookmarkExtension } from './extensions/bookmarkExtension';
import { CalendarBlockExtension } from './extensions/calendarBlockExtension';
import { ToggleExtension, ToggleSummaryExtension } from './extensions/toggleExtension';
import { MathBlockExtension, MathInlineExtension } from './extensions/mathExtension';
import { ColumnsExtension, ColumnExtension } from './extensions/columnsExtension';
import { TocExtension } from './extensions/tocExtension';
import { MermaidExtension } from './extensions/mermaidExtension';
import { DateExtension } from './extensions/dateExtension';
import { EmbedExtension } from './extensions/embedExtension';
import { CommentExtension } from './extensions/commentExtension';
import { HeadingCollapserExtension } from './extensions/headingCollapserExtension';
import { FootnoteExtension } from './extensions/footnotesExtension';
import { DATE_KEYWORDS } from './extensions/naturalLanguageDatesExtension';
import { EmojiShortcodesExtension } from './extensions/emojiShortcodesExtension';
import type { EmojiItem } from './extensions/emojiShortcodesExtension';
import EmojiSuggestionMenu from './EmojiSuggestionMenu';
import type { EmojiSuggestionMenuRef } from './EmojiSuggestionMenu';
import { AutoLinkTitleExtension } from './extensions/autoLinkTitleExtension';
import { DataviewExtension } from './extensions/dataviewExtension';
import { SubPageExtension } from './extensions/subPageExtension';
import { FontSizeExtension } from './extensions/fontSizeExtension';
import { BlockSpacingExtension } from './extensions/blockSpacingExtension';
import { DrawingOverlay } from './DrawingOverlay';
import { PageCover } from './PageCover';
import { CommentsPanel } from './CommentsPanel';
import type { NoteComment } from './CommentsPanel';
import { updateNote } from '../../../store/slices/notesSlice';
import { VersionHistoryHub } from './versioning/VersionHistoryHub';
// saveVersion lives in the main process now: notes:save triggers
// recordSnapshots() server-side with dedup + encrypted disk storage.
import { ExportDialog } from './ExportDialog';
import type { StyleSettings } from './StyleSettingsPanel';
import './NoteEditor.css';
import './editor-themes/default.css';
import './editor-themes/writer.css';
import './editor-themes/developer.css';

const lowlight = createLowlight(common);

// ==================== Style Settings Helpers ====================

const STYLE_SETTINGS_KEY = 'filarr-style-settings';

const FONT_FAMILY_MAP: Record<string, string> = {
  system: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  serif: 'Georgia, "Times New Roman", Times, serif',
  'sans-serif': '"Helvetica Neue", Helvetica, Arial, sans-serif',
  monospace: '"Fira Code", "JetBrains Mono", "Cascadia Code", Consolas, monospace',
};

function isDarkMode(): boolean {
  const theme = document.documentElement.getAttribute('data-theme');
  return (
    theme === 'dark' ||
    theme === 'space' ||
    theme === 'aurora' ||
    theme === 'crepuscule' ||
    theme === 'foret'
  );
}

function getAppTheme(): string {
  return document.documentElement.getAttribute('data-theme') || 'light';
}

/** Returns the correct default editor background for the current app theme */
function getThemeEditorBg(): string {
  switch (getAppTheme()) {
    case 'dark':
      return '#10141F';
    case 'space':
      return 'rgba(8, 10, 22, 0.5)';
    case 'aurora':
      return 'rgba(11, 17, 32, 0.5)';
    case 'lofi':
      return '#F5F0E8';
    case 'sky':
      return '#EBF4FE';
    case 'sakura':
      return 'rgba(255, 248, 249, 0.6)';
    case 'crepuscule':
      return 'rgba(26, 16, 24, 0.5)';
    case 'foret':
      return 'rgba(15, 29, 21, 0.5)';
    default:
      return '#ffffff';
  }
}

/** Returns the correct default text color for the current app theme */
function getThemeTextColor(): string {
  switch (getAppTheme()) {
    case 'dark':
      return '#F0F8FF';
    case 'space':
      return '#E8E0F0';
    case 'aurora':
      return '#e2e8f0';
    case 'lofi':
      return '#3D3229';
    case 'sky':
      return '#1A3A5C';
    case 'sakura':
      return '#4a2035';
    case 'crepuscule':
      return '#f0e0dc';
    case 'foret':
      return '#e0ecdc';
    default:
      return '#1e293b';
  }
}

const THEME_PRESETS_LIGHT: Record<string, Partial<StyleSettings>> = {
  default: {
    fontFamily: 'system',
    fontSize: 16,
    lineHeight: 1.6,
    headingScale: 1.25,
    accentColor: '#3b82f6',
    editorBg: '#ffffff',
    textColor: '#1e293b',
    editorPadding: 48,
    contentMaxWidth: 1100,
  },
  writer: {
    fontFamily: 'serif',
    fontSize: 18,
    lineHeight: 1.8,
    editorPadding: 60,
    contentMaxWidth: 640,
    editorBg: '#faf8f5',
    textColor: '#2c2c2c',
  },
  developer: {
    fontFamily: 'monospace',
    fontSize: 14,
    lineHeight: 1.5,
    editorPadding: 24,
    contentMaxWidth: 1100,
    editorBg: '#0d1117',
    textColor: '#c9d1d9',
  },
};

const THEME_PRESETS_DARK: Record<string, Partial<StyleSettings>> = {
  default: {
    fontFamily: 'system',
    fontSize: 16,
    lineHeight: 1.6,
    headingScale: 1.25,
    accentColor: '#60a5fa',
    editorBg: '#10141F',
    textColor: '#F0F8FF',
    editorPadding: 48,
    contentMaxWidth: 1100,
  },
  writer: {
    fontFamily: 'serif',
    fontSize: 18,
    lineHeight: 1.8,
    editorPadding: 60,
    contentMaxWidth: 640,
    editorBg: '#1a1a14',
    textColor: '#e8e4df',
  },
  developer: {
    fontFamily: 'monospace',
    fontSize: 14,
    lineHeight: 1.5,
    editorPadding: 24,
    contentMaxWidth: 1100,
    editorBg: '#0d1117',
    textColor: '#c9d1d9',
  },
};

function getThemePresets(): Record<string, Partial<StyleSettings>> {
  return isDarkMode() ? THEME_PRESETS_DARK : THEME_PRESETS_LIGHT;
}

function getStyleDefaults(): StyleSettings {
  return {
    fontFamily: 'system',
    fontSize: 16,
    lineHeight: 1.6,
    headingScale: 1.25,
    accentColor: isDarkMode() ? '#60a5fa' : '#3b82f6',
    editorBg: getThemeEditorBg(),
    textColor: getThemeTextColor(),
    editorPadding: 48,
    contentMaxWidth: 1100,
    showLineNumbers: false,
    typewriterMode: false,
    spacingScale: 1,
  };
}

function loadStyleSettings(): StyleSettings {
  const defaults = getStyleDefaults();
  try {
    const raw = localStorage.getItem(STYLE_SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      // Migrate old default width (720) to new default
      if (parsed.contentMaxWidth === 720) delete parsed.contentMaxWidth;
      return { ...defaults, ...parsed };
    }
  } catch {
    /* ignore */
  }
  return { ...defaults };
}

// ==================== SVG Icons ====================

const BoldIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2.5}
  >
    <path d="M6 4h8a4 4 0 014 4 4 4 0 01-4 4H6z" />
    <path d="M6 12h9a4 4 0 014 4 4 4 0 01-4 4H6z" />
  </svg>
);
const ItalicIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2.5}
  >
    <line x1="19" y1="4" x2="10" y2="4" />
    <line x1="14" y1="20" x2="5" y2="20" />
    <line x1="15" y1="4" x2="9" y2="20" />
  </svg>
);
const StrikeIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2.5}
  >
    <path d="M16 4H9a3 3 0 000 6h6a3 3 0 010 6H8" />
    <line x1="4" y1="12" x2="20" y2="12" />
  </svg>
);
const CodeIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <polyline points="16,18 22,12 16,6" />
    <polyline points="8,6 2,12 8,18" />
  </svg>
);
const HighlightIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z" />
  </svg>
);
const LinkIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
  </svg>
);
const HeadingIcon: React.FC<{ level: number }> = ({ level }) => (
  <span className="note-editor__toolbar-heading">H{level}</span>
);
const ListIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <line x1="8" y1="6" x2="21" y2="6" />
    <line x1="8" y1="12" x2="21" y2="12" />
    <line x1="8" y1="18" x2="21" y2="18" />
    <line x1="3" y1="6" x2="3.01" y2="6" />
    <line x1="3" y1="12" x2="3.01" y2="12" />
    <line x1="3" y1="18" x2="3.01" y2="18" />
  </svg>
);
const OrderedListIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <line x1="10" y1="6" x2="21" y2="6" />
    <line x1="10" y1="12" x2="21" y2="12" />
    <line x1="10" y1="18" x2="21" y2="18" />
    <path d="M4 6h1v4" />
    <path d="M4 10h2" />
    <path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1" />
  </svg>
);
const ChecklistIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <path d="M9 11l3 3L22 4" />
    <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
  </svg>
);
const QuoteIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
    <path d="M14.017 21v-7.391c0-5.704 3.731-9.57 8.983-10.609l.995 2.151c-2.432.917-3.995 3.638-3.995 5.849h4v10H14.017zM0 21v-7.391c0-5.704 3.731-9.57 8.983-10.609l.995 2.151C7.546 6.068 5.983 8.789 5.983 11H10v10H0z" />
  </svg>
);
const TableIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <line x1="3" y1="9" x2="21" y2="9" />
    <line x1="3" y1="15" x2="21" y2="15" />
    <line x1="9" y1="3" x2="9" y2="21" />
    <line x1="15" y1="3" x2="15" y2="21" />
  </svg>
);
const HrIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <line x1="2" y1="12" x2="22" y2="12" />
  </svg>
);
const UnderlineIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2.5}
  >
    <path d="M6 3v7a6 6 0 006 6 6 6 0 006-6V3" />
    <line x1="4" y1="21" x2="20" y2="21" />
  </svg>
);
const VersionIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <circle cx="12" cy="12" r="10" />
    <polyline points="12,6 12,12 16,14" />
  </svg>
);
const ExportIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
    <polyline points="7,10 12,15 17,10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);
const DrawIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <path d="M12 19l7-7 3 3-7 7-3-3z" />
    <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
    <path d="M2 2l7.586 7.586" />
    <circle cx="11" cy="11" r="2" />
  </svg>
);
const WikiLinkIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
    <path d="M8 2H6a2 2 0 00-2 2v2" />
    <path d="M18 22h2a2 2 0 002-2v-2" />
  </svg>
);

// ==================== Highlight Colors ====================

const HIGHLIGHT_COLORS = [
  { name: 'yellow', color: 'rgba(255, 213, 79, 0.4)', label: 'Yellow' },
  { name: 'green', color: 'rgba(52, 211, 153, 0.4)', label: 'Green' },
  { name: 'blue', color: 'rgba(96, 165, 250, 0.4)', label: 'Blue' },
  { name: 'purple', color: 'rgba(167, 139, 250, 0.4)', label: 'Purple' },
  { name: 'pink', color: 'rgba(244, 114, 182, 0.4)', label: 'Pink' },
  { name: 'red', color: 'rgba(248, 113, 113, 0.4)', label: 'Red' },
  { name: 'orange', color: 'rgba(251, 146, 60, 0.4)', label: 'Orange' },
  { name: 'gray', color: 'rgba(156, 163, 175, 0.3)', label: 'Gray' },
] as const;

// ==================== Text Colors ====================

const TEXT_COLORS = [
  { name: 'default', color: '', label: 'Default' },
  // Grays
  { name: 'light-gray', color: '#d1d5db', label: 'Light Gray' },
  { name: 'gray', color: '#9ca3af', label: 'Gray' },
  { name: 'dark-gray', color: '#4b5563', label: 'Dark Gray' },
  { name: 'black', color: '#111827', label: 'Black' },
  // Warm
  { name: 'brown', color: '#92400e', label: 'Brown' },
  { name: 'red', color: '#ef4444', label: 'Red' },
  { name: 'dark-red', color: '#b91c1c', label: 'Dark Red' },
  { name: 'orange', color: '#f97316', label: 'Orange' },
  { name: 'amber', color: '#f59e0b', label: 'Amber' },
  { name: 'yellow', color: '#eab308', label: 'Yellow' },
  // Cool
  { name: 'lime', color: '#84cc16', label: 'Lime' },
  { name: 'green', color: '#22c55e', label: 'Green' },
  { name: 'emerald', color: '#059669', label: 'Emerald' },
  { name: 'teal', color: '#14b8a6', label: 'Teal' },
  { name: 'cyan', color: '#06b6d4', label: 'Cyan' },
  { name: 'blue', color: '#3b82f6', label: 'Blue' },
  { name: 'dark-blue', color: '#1d4ed8', label: 'Dark Blue' },
  { name: 'indigo', color: '#6366f1', label: 'Indigo' },
  { name: 'purple', color: '#a855f7', label: 'Purple' },
  { name: 'pink', color: '#ec4899', label: 'Pink' },
] as const;

// ==================== Suggestion Popup Helper ====================

/**
 * Creates a DOM-based popup anchored to a clientRect.
 * Replaces tippy.js to avoid module resolution issues with baseUrl.
 */
function createSuggestionPopup() {
  const container = document.createElement('div');
  container.style.position = 'fixed';
  container.style.zIndex = '9999';
  container.style.pointerEvents = 'auto';
  document.body.appendChild(container);

  return {
    element: container,
    updatePosition: (getRect: (() => DOMRect | null) | null) => {
      if (!getRect) return;
      const rect = getRect();
      if (!rect) return;

      const menuHeight = container.offsetHeight || 320; // estimate if not yet rendered
      const viewportHeight = window.innerHeight;
      const spaceBelow = viewportHeight - rect.bottom;
      const spaceAbove = rect.top;

      container.style.left = `${rect.left}px`;
      if (spaceBelow < menuHeight && spaceAbove > spaceBelow) {
        // Position above the cursor
        container.style.top = '';
        container.style.bottom = `${viewportHeight - rect.top + 4}px`;
      } else {
        // Position below the cursor (default)
        container.style.bottom = '';
        container.style.top = `${rect.bottom + 4}px`;
      }
    },
    destroy: () => {
      container.remove();
    },
  };
}

// ==================== Types ====================

export interface NoteEditorCommentsHandle {
  resolveComment: (id: string) => void;
  deleteComment: (id: string) => void;
}

interface NoteEditorProps {
  note: Note;
  onUpdate: (content: string, plainText: string) => void;
  onTitleChange: (title: string) => void;
  onCommentsChange?: (comments: Record<string, NoteComment>) => void;
  commentsHandleRef?: React.MutableRefObject<NoteEditorCommentsHandle | null>;
  readOnly?: boolean;
  onOpenStyleSettings?: () => void;
}

// ==================== Component ====================

export const NoteEditor: React.FC<NoteEditorProps> = React.memo(function NoteEditor({
  note,
  onUpdate,
  onTitleChange,
  onCommentsChange,
  commentsHandleRef,
  readOnly = false,
  onOpenStyleSettings,
}) {
  const { t } = useTranslation();
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const [isFocused, setIsFocused] = useState(false);
  const [colorPickerOpen, setColorPickerOpen] = useState(false);
  const colorPickerRef = useRef<HTMLDivElement>(null);
  const [editorTheme, setEditorTheme] = useState<'default' | 'writer' | 'developer'>('default');
  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [isDrawingMode, setIsDrawingMode] = useState(false);
  const [noteComments, setNoteComments] = useState<Record<string, NoteComment>>({});
  const [commentInputOpen, setCommentInputOpen] = useState(false);
  const [commentInputValue, setCommentInputValue] = useState('');
  const [pendingCommentId, setPendingCommentId] = useState<string | null>(null);
  const commentInputRef = useRef<HTMLInputElement>(null);
  const [linkInputOpen, setLinkInputOpen] = useState(false);
  const [linkInputValue, setLinkInputValue] = useState('');
  const linkInputRef = useRef<HTMLInputElement>(null);
  const editorBodyRef = useRef<HTMLDivElement>(null);
  const [noteHeaderCollapsed, setNoteHeaderCollapsed] = useState(false);
  const [styleSettings, setStyleSettings] = useState<StyleSettings>(loadStyleSettings);
  const [textColorPickerOpen, setTextColorPickerOpen] = useState(false);
  const textColorRef = useRef<HTMLDivElement>(null);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Listen for style settings changes (from StyleSettingsPanel saving to localStorage)
  useEffect(() => {
    const reload = () => setStyleSettings(loadStyleSettings());
    const onStorage = (e: StorageEvent) => {
      if (e.key === STYLE_SETTINGS_KEY) reload();
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener('filarr-style-settings-changed', reload);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('filarr-style-settings-changed', reload);
    };
  }, []);

  // Re-apply theme-appropriate defaults when dark/light mode toggles
  useEffect(() => {
    const observer = new MutationObserver(() => {
      const defaults = getStyleDefaults();
      setStyleSettings((prev) => {
        // Only update bg/text/accent if they match the OLD theme defaults
        // (i.e., user hasn't customized them)
        // All known default values for each theme (so we can detect "user hasn't customized")
        const knownEditorBgs = new Set([
          '#ffffff',
          '#10141F',
          '#faf8f5',
          '#1a1a14',
          '#0d1117', // light, dark, writer, developer
          'rgba(8, 10, 22, 0.5)',
          '#F5F0E8',
          '#EBF4FE', // space, lofi, sky
          'rgba(11, 17, 32, 0.5)',
          'rgba(255, 248, 249, 0.6)',
          'rgba(26, 16, 24, 0.5)', // aurora, sakura, crepuscule
        ]);
        const knownTextColors = new Set([
          '#1e293b',
          '#F0F8FF',
          '#2c2c2c',
          '#e8e4df',
          '#c9d1d9', // light, dark, writer, developer
          '#E8E0F0',
          '#3D3229',
          '#1A3A5C', // space, lofi, sky
          '#e2e8f0',
          '#4a2035',
          '#f0e0dc', // aurora, sakura, crepuscule
        ]);
        const knownAccents = new Set(['#3b82f6', '#60a5fa']);
        const isOldDefault = (key: 'editorBg' | 'textColor' | 'accentColor') =>
          key === 'editorBg'
            ? knownEditorBgs.has(prev[key])
            : key === 'textColor'
              ? knownTextColors.has(prev[key])
              : knownAccents.has(prev[key]);
        return {
          ...prev,
          ...(isOldDefault('editorBg') ? { editorBg: defaults.editorBg } : {}),
          ...(isOldDefault('textColor') ? { textColor: defaults.textColor } : {}),
          ...(isOldDefault('accentColor') ? { accentColor: defaults.accentColor } : {}),
        };
      });
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    return () => observer.disconnect();
  }, []);

  // Build CSS custom properties from style settings — applied on .note-editor container
  // so they cascade into .ProseMirror via var() references in NoteEditor.css
  const editorCssVars: React.CSSProperties = {
    ['--ss-font-family' as string]:
      FONT_FAMILY_MAP[styleSettings.fontFamily] || styleSettings.fontFamily,
    ['--ss-font-size' as string]: `${styleSettings.fontSize}px`,
    ['--ss-line-height' as string]: String(styleSettings.lineHeight),
    ['--ss-text-color' as string]: styleSettings.textColor,
    ['--ss-editor-bg' as string]: styleSettings.editorBg,
    ['--ss-content-max-width' as string]: `${styleSettings.contentMaxWidth}px`,
    ['--ss-accent-color' as string]: styleSettings.accentColor,
    ['--ss-heading-scale' as string]: String(styleSettings.headingScale),
    ['--ss-spacing-scale' as string]: String(styleSettings.spacingScale ?? 1),
  };

  // Notify parent when comments change
  useEffect(() => {
    onCommentsChange?.(noteComments);
  }, [noteComments, onCommentsChange]);

  // Handle ref is assigned after editor is created (see below)

  // Wiki-link autocomplete state
  const allNotes = useSelector(selectAllNotes);
  const filesById = useSelector((s: RootState) => s.files.byId);
  const foldersById = useSelector((s: RootState) => s.folders.byId);
  const [wikiQuery, setWikiQuery] = useState('');
  const [wikiOpen, setWikiOpen] = useState(false);
  const [wikiPos, setWikiPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [wikiSelected, setWikiSelected] = useState(0);
  const wikiStartPos = useRef<number | null>(null);
  // Track which trigger character opened the popup: '[[' or '@'
  const wikiTrigger = useRef<'[[' | '@'>('[[');

  // Keep a ref to onUpdate so the TipTap closure always calls the latest version
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;
  const noteIdRef = useRef(note.id);
  noteIdRef.current = note.id;

  // Last content string this editor instance pushed to Redux. Used to
  // short-circuit the resync effect below: on round-trip saves the
  // incoming note.content is byte-identical to what we just emitted,
  // so an O(1) string compare replaces an O(n) JSON.stringify of the
  // whole document on every keystroke-debounce cycle and every
  // unrelated re-render.
  //
  // Seeded with the initial note.content so the first pass of the
  // resync effect (right after useEditor finished parsing the same
  // string to build its initial doc) is a no-op — prevents a second
  // JSON.parse + setContent on every note open. NotesView mounts us
  // with key={note.id}, so this ref is fresh on each note switch.
  const lastSyncedContentRef = useRef<string | null>(note.content ?? null);

  // Build wiki-link suggestions (includes date keywords when trigger is @)
  // Track trigger in state so memo re-computes properly
  const [activeTrigger, setActiveTrigger] = useState<'[[' | '@'>('[[');

  const wikiSuggestions = React.useMemo(() => {
    const q = wikiQuery.toLowerCase();
    const results: {
      label: string;
      insert: string;
      type: 'note' | 'file' | 'folder' | 'date';
      dateValue?: string;
    }[] = [];

    // Date keywords (only for @ trigger, shown first — max 5 to leave room for notes)
    if (activeTrigger === '@') {
      let dateCount = 0;
      for (const dk of DATE_KEYWORDS) {
        if (dateCount >= 5) break;
        if (!q || dk.keyword.includes(q) || dk.label.toLowerCase().includes(q)) {
          const dateVal = dk.resolve();
          results.push({ label: dk.label, insert: '', type: 'date', dateValue: dateVal });
          dateCount++;
        }
      }
    }

    // Notes (limit to 20 results to prevent lag with thousands of notes)
    let noteCount = 0;
    for (const n of allNotes) {
      if (noteCount >= 20) break;
      if (n.id === note.id) continue;
      if (!q || n.title.toLowerCase().includes(q)) {
        results.push({ label: n.title || 'Untitled', insert: `[[${n.title}]]`, type: 'note' });
        noteCount++;
      }
    }
    // Files
    for (const f of Object.values(filesById)) {
      if (!q || f.name.toLowerCase().includes(q)) {
        results.push({ label: f.name, insert: `[[file:${f.name}]]`, type: 'file' });
      }
    }
    // Folders
    for (const f of Object.values(foldersById)) {
      if (!q || f.name.toLowerCase().includes(q)) {
        results.push({ label: f.name, insert: `[[folder:${f.name}]]`, type: 'folder' });
      }
    }

    return results.slice(0, 15);
  }, [wikiQuery, activeTrigger, allNotes, filesById, foldersById, note.id]);

  // TipTap editor setup
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        codeBlock: false,
        heading: { levels: [1, 2, 3, 4] },
        link: false,
      }),
      Placeholder.configure({
        placeholder: t(
          'notes.editorPlaceholder',
          'Start writing, type / for commands or [[ to link...'
        ),
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
      Table.configure({ resizable: true }),
      TableRow,
      TableCell,
      TableHeader,
      EnhancedCodeBlockExtension.configure({ lowlight }),
      DragHandleExtension,
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
      HeadingCollapserExtension,
      FootnoteExtension,
      EmojiShortcodesExtension.configure({
        suggestion: {
          render: () => {
            let component: ReactRenderer<EmojiSuggestionMenuRef> | null = null;
            let popup: ReturnType<typeof createSuggestionPopup> | null = null;

            return {
              onStart: (props: any) => {
                component = new ReactRenderer(EmojiSuggestionMenu, {
                  props: { items: props.items, command: (item: EmojiItem) => props.command(item) },
                  editor: props.editor,
                });
                popup = createSuggestionPopup();
                popup.element.appendChild(component.element);
                popup.updatePosition(props.clientRect);
              },
              onUpdate: (props: any) => {
                component?.updateProps({
                  items: props.items,
                  command: (item: EmojiItem) => props.command(item),
                });
                popup?.updatePosition(props.clientRect);
              },
              onKeyDown: (props: any) => {
                if (props.event.key === 'Escape') {
                  popup?.destroy();
                  return true;
                }
                return component?.ref?.onKeyDown(props) ?? false;
              },
              onExit: () => {
                popup?.destroy();
                component?.destroy();
              },
            };
          },
        },
      }),
      AutoLinkTitleExtension,
      DataviewExtension,
      SubPageExtension,
      FontSizeExtension,
      BlockSpacingExtension,
      SlashCommandExtension.configure({
        suggestion: {
          render: () => {
            let component: ReactRenderer<SlashCommandMenuRef> | null = null;
            let popup: ReturnType<typeof createSuggestionPopup> | null = null;

            return {
              onStart: (props: any) => {
                component = new ReactRenderer(SlashCommandMenu, {
                  props: {
                    items: props.items,
                    command: (item: SlashCommandItem) => props.command(item),
                  },
                  editor: props.editor,
                });

                popup = createSuggestionPopup();
                popup.element.appendChild(component.element);
                popup.updatePosition(props.clientRect);
              },
              onUpdate: (props: any) => {
                component?.updateProps({
                  items: props.items,
                  command: (item: SlashCommandItem) => props.command(item),
                });
                popup?.updatePosition(props.clientRect);
              },
              onKeyDown: (props: any) => {
                if (props.event.key === 'Escape') {
                  popup?.destroy();
                  return true;
                }
                return component?.ref?.onKeyDown(props) ?? false;
              },
              onExit: () => {
                popup?.destroy();
                component?.destroy();
              },
            };
          },
        },
      }),
    ],
    content: note.content
      ? (() => {
          try {
            return JSON.parse(note.content);
          } catch {
            return note.content;
          }
        })()
      : '',
    editable: !readOnly,
    onUpdate: ({ editor: ed }) => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      debounceTimer.current = setTimeout(() => {
        const json = JSON.stringify(ed.getJSON());
        const text = stripWikiLinks(ed.getText());
        lastSyncedContentRef.current = json;
        onUpdateRef.current(json, text);
        // Version snapshot happens in the main process as part of notes:save
        // (see recordSnapshots in electron/main.ts), so nothing to do here.
      }, 300);
    },
    onFocus: () => setIsFocused(true),
    onBlur: ({ editor: ed }) => {
      setIsFocused(false);
      // Synchronous safety net: when the editor loses focus (clicking
      // another note, switching to the file tree, Cmd+Tab…), flush any
      // in-flight debounced content immediately. onUpdateRef still
      // points to the callback bound to the current note at the moment
      // of blur — the note switch that caused the blur hasn't been
      // dispatched yet in React's queue.
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
        debounceTimer.current = null;
        if (ed && !ed.isDestroyed) {
          const json = JSON.stringify(ed.getJSON());
          const text = stripWikiLinks(ed.getText());
          lastSyncedContentRef.current = json;
          onUpdateRef.current(json, text);
        }
      }
    },
    editorProps: {
      attributes: {
        class: 'note-editor__content',
        spellcheck: 'false',
      },
      handleKeyDown: (view, event) => {
        // Wiki-link autocomplete: intercept keys when open
        if (wikiOpen) {
          if (event.key === 'Escape') {
            setWikiOpen(false);
            return true;
          }
          if (event.key === 'ArrowDown') {
            setWikiSelected((i) => Math.min(i + 1, wikiSuggestions.length - 1));
            return true;
          }
          if (event.key === 'ArrowUp') {
            setWikiSelected((i) => Math.max(i - 1, 0));
            return true;
          }
          if (event.key === 'Enter' || event.key === 'Tab') {
            const sel = wikiSuggestions[wikiSelected];
            if (sel) {
              insertWikiLink(sel.insert, sel.dateValue);
            }
            return true;
          }
        }

        // Tab / Shift+Tab: indent/outdent in lists and task lists
        if (event.key === 'Tab') {
          event.preventDefault();
          const { state, dispatch } = view;
          const taskItemType = state.schema.nodes.taskItem;
          const listItemType = state.schema.nodes.listItem;

          if (event.shiftKey) {
            if (taskItemType && liftListItem(taskItemType)(state, dispatch)) return true;
            if (listItemType && liftListItem(listItemType)(state, dispatch)) return true;
          } else {
            if (taskItemType && sinkListItem(taskItemType)(state, dispatch)) return true;
            if (listItemType && sinkListItem(listItemType)(state, dispatch)) return true;
          }
          return true; // consume Tab even outside lists to prevent focus jump
        }

        return false;
      },
    },
  });

  // Detect [[ or @ typing to open wiki-link autocomplete
  useEffect(() => {
    if (!editor) return;

    const handleTransaction = () => {
      const { state } = editor;
      const { from } = state.selection;

      // Skip detection if cursor is inside a code block or inline code
      const $pos = state.doc.resolve(from);
      const parentNode = $pos.parent;
      if (parentNode.type.name === 'codeBlock') {
        setWikiOpen(false);
        return;
      }
      // Check for inline code mark at cursor position
      const marks = $pos.marks();
      if (marks.some((m: any) => m.type.name === 'code')) {
        setWikiOpen(false);
        return;
      }

      const textBefore = state.doc.textBetween(Math.max(0, from - 50), from, '\n');

      // Find the last [[ not closed
      const openIdx = textBefore.lastIndexOf('[[');
      const closeIdx = textBefore.lastIndexOf(']]');

      if (openIdx !== -1 && openIdx > closeIdx) {
        const query = textBefore.slice(openIdx + 2);
        // Don't open if query contains newlines
        if (!query.includes('\n')) {
          setWikiQuery(query);
          setWikiSelected(0);
          wikiStartPos.current = from - query.length - 2;
          wikiTrigger.current = '[[';
          setActiveTrigger('[[');

          // Position the popup near cursor
          const coords = editor.view.coordsAtPos(from);
          setWikiPos({ x: coords.left, y: coords.bottom + 4 });
          setWikiOpen(true);
          return;
        }
      }

      // Find the last @ that's not inside [[ ]]
      const atIdx = textBefore.lastIndexOf('@');
      if (atIdx !== -1) {
        // Check that the @ is not preceded by an unclosed [[
        const openBefore = textBefore.lastIndexOf('[[', atIdx);
        const closeBefore = textBefore.lastIndexOf(']]', atIdx);
        const insideBrackets = openBefore !== -1 && openBefore > closeBefore;

        if (!insideBrackets) {
          const query = textBefore.slice(atIdx + 1);
          // Don't open if query contains newlines or spaces at start (email-like patterns)
          if (!query.includes('\n') && !/^\s/.test(query)) {
            setWikiQuery(query);
            setWikiSelected(0);
            wikiStartPos.current = from - query.length - 1; // 1 for '@'
            wikiTrigger.current = '@';
            setActiveTrigger('@');

            const coords = editor.view.coordsAtPos(from);
            setWikiPos({ x: coords.left, y: coords.bottom + 4 });
            setWikiOpen(true);
            return;
          }
        }
      }

      setWikiOpen(false);
    };

    editor.on('transaction', handleTransaction);
    return () => {
      editor.off('transaction', handleTransaction);
    };
  }, [editor]);

  // Insert a wiki-link suggestion or date node
  const insertWikiLink = useCallback(
    (linkText: string, dateValue?: string) => {
      if (!editor || wikiStartPos.current === null) return;
      const { from } = editor.state.selection;
      const startPos = wikiStartPos.current;

      // Sanity check: ensure we're not deleting more than what we typed
      const deleteLen = from - startPos;
      if (deleteLen < 0 || deleteLen > 200) return;

      if (dateValue) {
        // Insert an inlineDate node
        const inlineDateType = editor.schema.nodes.inlineDate;
        if (inlineDateType) {
          editor
            .chain()
            .focus()
            .deleteRange({ from: startPos, to: from })
            .insertContent({ type: 'inlineDate', attrs: { date: dateValue } })
            .insertContent(' ')
            .run();
        } else {
          // Fallback: insert date as text
          editor
            .chain()
            .focus()
            .deleteRange({ from: startPos, to: from })
            .insertContent(dateValue + ' ')
            .run();
        }
      } else {
        // Insert wiki-link text + trailing space to prevent text concatenation
        editor
          .chain()
          .focus()
          .deleteRange({ from: startPos, to: from })
          .insertContent(linkText + ' ')
          .run();
      }
      // Reset state to prevent stale references
      wikiStartPos.current = null;
      setWikiOpen(false);
    },
    [editor]
  );

  // Toolbar action: insert [[ at cursor to trigger wiki-link autocomplete
  const insertWikiLinkTrigger = useCallback(() => {
    if (!editor) return;
    editor.chain().focus().insertContent('[[').run();
  }, [editor]);

  // Flush pending debounce on unmount so content isn't lost.
  // Note switch no longer remounts this component (see NotesView — the
  // `key` prop was removed to avoid a ~700 ms rebuild of TipTap + all
  // extensions on every click). Flushing is now handled by:
  //   • the per-note-id reset effect below (which runs before the
  //     sync effect swaps content, with onUpdateRef still bound to
  //     the OUTGOING note via a pre-render snapshot), and
  //   • an onBlur flush inside useEditor config, so clicking another
  //     note immediately stashes the in-flight debounced content.
  useEffect(() => {
    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
        debounceTimer.current = null;
        if (editor && !editor.isDestroyed) {
          const json = JSON.stringify(editor.getJSON());
          const text = stripWikiLinks(editor.getText());
          lastSyncedContentRef.current = json;
          onUpdateRef.current(json, text);
        }
      }
    };
  }, [editor]);

  // Flush any pending debounced content BEFORE we swap the editor over
  // to the new note. `prevOnUpdateRef` holds the onUpdate callback that
  // was bound to the outgoing note — we update it at the end of this
  // effect so the NEXT switch has the correct snapshot. Without this,
  // the flush would run with the new note's onUpdate and dump the old
  // note's content into the new note.
  const prevOnUpdateRef = useRef(onUpdate);
  const prevNoteIdRef = useRef(note.id);
  useEffect(() => {
    if (prevNoteIdRef.current !== note.id) {
      // Flush pending debounce using the OUTGOING handler.
      if (debounceTimer.current && editor && !editor.isDestroyed) {
        clearTimeout(debounceTimer.current);
        debounceTimer.current = null;
        const json = JSON.stringify(editor.getJSON());
        const text = stripWikiLinks(editor.getText());
        prevOnUpdateRef.current(json, text);
      }
      // Reset per-note UI state that would otherwise leak across notes
      // now that we no longer force-remount via a `key` prop.
      setNoteComments({});
      setWikiOpen(false);
      setWikiQuery('');
      setWikiSelected(0);
      wikiStartPos.current = null;
      setActiveTrigger('[[');
      setCommentInputOpen(false);
      setCommentInputValue('');
      setPendingCommentId(null);
      setLinkInputOpen(false);
      setLinkInputValue('');
      setShowVersionHistory(false);
      setShowExportDialog(false);
      setIsDrawingMode(false);
      // Do NOT re-seed lastSyncedContentRef here. It still holds the
      // outgoing note's content — which is what TipTap's doc actually
      // contains right now. The sync effect that runs right after will
      // see note.content (incoming) !== ref (outgoing) and correctly
      // issue a single setContent. Re-seeding to the incoming content
      // would short-circuit the sync and leave the editor showing the
      // previous note.
      prevNoteIdRef.current = note.id;
    }
    prevOnUpdateRef.current = onUpdate;
    // note.content intentionally omitted — it is only read on the
    // note.id-changed branch, and we do not want this effect to fire
    // on every keystroke that updates note.content for the current
    // note (it would reset UI state and clobber the typing flow).
     
  }, [note.id, onUpdate, editor]);

  // Sync content when note changes — including content mutations from
  // outside the editor (e.g. restoring a previous version through the
  // version-history viewer dispatches updateNoteContent, which must
  // reach this editor instance). Logic extracted to syncEditorContent
  // so the round-trip-short-circuit is unit-tested in isolation
  // (see noteEditorSync.test.ts).
  useEffect(() => {
    syncEditorContent(editor, note.content, lastSyncedContentRef);
  }, [note.id, note.content, editor]);

  // Expose comment actions to parent via ref (needs editor)
  useEffect(() => {
    if (!commentsHandleRef || !editor) return;
    commentsHandleRef.current = {
      resolveComment: (commentId: string) => {
        setNoteComments((prev) => ({
          ...prev,
          [commentId]: { ...prev[commentId], resolved: true },
        }));
      },
      deleteComment: (commentId: string) => {
        editor.commands.removeCommentById(commentId);
        setNoteComments((prev) => {
          const next = { ...prev };
          delete next[commentId];
          return next;
        });
      },
    };
  }, [editor, commentsHandleRef]);

  // Auto-resize title textarea
  const handleTitleInput = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      onTitleChange(e.target.value);
      const el = e.target;
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight}px`;
    },
    [onTitleChange]
  );

  const handleTitleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        editor?.commands.focus('start');
      }
    },
    [editor]
  );

  useEffect(() => {
    if (titleRef.current) {
      titleRef.current.style.height = 'auto';
      titleRef.current.style.height = `${titleRef.current.scrollHeight}px`;
    }
  }, [note.title]);

  // Close popovers on click outside
  useEffect(() => {
    if (!colorPickerOpen && !textColorPickerOpen) return;
    const handler = (e: MouseEvent) => {
      if (
        colorPickerOpen &&
        colorPickerRef.current &&
        !colorPickerRef.current.contains(e.target as Node)
      ) {
        setColorPickerOpen(false);
      }
      if (
        textColorPickerOpen &&
        textColorRef.current &&
        !textColorRef.current.contains(e.target as Node)
      ) {
        setTextColorPickerOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [colorPickerOpen, textColorPickerOpen]);

  // Ctrl+Click on wiki-links → open in new tab (for split editing)
  const dispatch = useDispatch<AppDispatch>();
  useEffect(() => {
    if (!editor || !editor.isEditable) return;
    let el: HTMLElement;
    try {
      el = editor.view.dom;
    } catch {
      // Editor view not yet mounted — skip
      return;
    }

    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const isCtrl = e.ctrlKey || e.metaKey;

      // Check wiki-link decorations first
      const wikiLink = target.closest('.wiki-link') as HTMLElement | null;
      if (wikiLink) {
        e.preventDefault();
        e.stopPropagation();
        const linkType = wikiLink.getAttribute('data-link-type') || 'note';
        const linkTarget = wikiLink.getAttribute('data-link-target') || '';
        if (linkType === 'note') {
          const linkedNote = allNotes.find(
            (n) => n.title.toLowerCase() === linkTarget.toLowerCase()
          );
          if (linkedNote) {
            if (isCtrl) {
              // Ctrl+Click → open in new tab (split editing)
              dispatch(
                addTab({ route: `/notes/${linkedNote.id}`, title: linkedNote.title || 'Untitled' })
              );
            } else {
              // Simple click → navigate to the note in current editor
              dispatch(setEditingNote(linkedNote.id));
            }
          }
        }
        return;
      }

      // Fallback: standard links — only on Ctrl+Click
      if (!isCtrl) return;
      const linkEl = target.closest('.note-link, a[href]') as HTMLElement | null;
      if (!linkEl) return;

      e.preventDefault();
      e.stopPropagation();

      const href = linkEl.getAttribute('href') || '';
      const linkText = (linkEl.textContent || '').replace(/^\[\[|\]\]$/g, '').trim();

      // External URL → open in browser
      if (href.startsWith('http://') || href.startsWith('https://')) {
        window.electron?.ipcRenderer?.send('open-external', href);
        return;
      }

      // Internal note link → navigate
      const linkedNote = allNotes.find((n) => n.title.toLowerCase() === linkText.toLowerCase());
      if (linkedNote) {
        dispatch(
          addTab({
            route: `/notes/${linkedNote.id}`,
            title: linkedNote.title || 'Untitled',
          })
        );
      }
    };

    el.addEventListener('click', handleClick, true);
    return () => el.removeEventListener('click', handleClick, true);
  }, [editor, allNotes, dispatch]);

  // Task list toggle: click on the chevron (::before pseudo-element area) to collapse/expand nested content
  useEffect(() => {
    if (!editor) return;
    const el = editor.view.dom;
    if (!el) return;

    const handleToggle = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      // Task list <li> with nested content — the ::before chevron occupies the left 16px
      const li = target.closest('ul[data-type="taskList"] > li');
      if (!li) return;
      // Only toggle if the click is in the chevron area (first 20px from the left of the li)
      const liRect = li.getBoundingClientRect();
      if (e.clientX - liRect.left > 20) return;
      // Check if this li actually has nested content
      const nestedList = li.querySelector(':scope > div > ul');
      if (!nestedList) return;
      e.preventDefault();
      e.stopPropagation();
      li.classList.toggle('task-collapsed');
    };

    el.addEventListener('click', handleToggle);
    return () => el.removeEventListener('click', handleToggle);
  }, [editor]);

  const addLink = useCallback(() => {
    if (!editor) return;
    if (editor.isActive('link')) {
      editor.chain().focus().unsetLink().run();
      return;
    }
    setLinkInputValue('');
    setLinkInputOpen(true);
    setTimeout(() => linkInputRef.current?.focus(), 50);
  }, [editor]);

  const confirmLink = useCallback(() => {
    if (!editor || !linkInputValue.trim()) {
      setLinkInputOpen(false);
      return;
    }
    let href = linkInputValue.trim();
    if (!/^https?:\/\//i.test(href) && !href.startsWith('mailto:')) {
      href = 'https://' + href;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
    setLinkInputOpen(false);
  }, [editor, linkInputValue]);

  const insertTable = useCallback(() => {
    editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
  }, [editor]);

  const handleDrawingStrokesChange = useCallback(
    (strokes: string) => {
      dispatch(updateNote({ id: note.id, changes: { drawingStrokes: strokes } }));
    },
    [dispatch, note.id]
  );

  if (!editor) return null;

  const typeIcons: Record<string, React.ReactNode> = {
    note: (
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path d="M14.5 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V7.5L14.5 2z" />
        <polyline points="14,2 14,8 20,8" />
      </svg>
    ),
    file: (
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z" />
        <polyline points="13,2 13,9 20,9" />
      </svg>
    ),
    folder: (
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
      </svg>
    ),
    date: (
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
      >
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
      </svg>
    ),
  };

  const editorContent = (
    <div
      className={`note-editor ${isFocused ? 'note-editor--focused' : ''} ${readOnly ? 'note-editor--readonly' : ''}`}
      data-editor-theme={editorTheme}
      style={editorCssVars}
    >
      {/* Floating Bubble Menu — appears on text selection (hidden inside wiki-links) */}
      {!readOnly && editor && (
        <BubbleMenu
          editor={editor}
          className="note-editor__bubble-menu"
          shouldShow={({ editor: ed, from, to }) => {
            if (from === to) return false;
            // Don't show inside wiki-links — the LinkPreviewPopover handles those
            const textBefore = ed.state.doc.textBetween(Math.max(0, from - 2), from, '');
            const textAfter = ed.state.doc.textBetween(
              to,
              Math.min(ed.state.doc.content.size, to + 2),
              ''
            );
            const fullText = ed.state.doc.textBetween(
              Math.max(0, from - 50),
              Math.min(ed.state.doc.content.size, to + 50),
              ''
            );
            const selText = ed.state.doc.textBetween(from, to, '');
            // Check if selection is inside [[ ... ]]
            const beforeSel = fullText.slice(0, fullText.indexOf(selText));
            const openBracket = beforeSel.lastIndexOf('[[');
            const closeBracket = beforeSel.lastIndexOf(']]');
            if (openBracket !== -1 && openBracket > closeBracket) return false;
            return true;
          }}
        >
          <button
            onClick={() => editor.chain().focus().toggleBold().run()}
            className={`note-editor__bubble-btn ${editor.isActive('bold') ? 'is-active' : ''}`}
            title="Bold"
          >
            <BoldIcon />
          </button>
          <button
            onClick={() => editor.chain().focus().toggleItalic().run()}
            className={`note-editor__bubble-btn ${editor.isActive('italic') ? 'is-active' : ''}`}
            title="Italic"
          >
            <ItalicIcon />
          </button>
          <button
            onClick={() => editor.chain().focus().toggleUnderline().run()}
            className={`note-editor__bubble-btn ${editor.isActive('underline') ? 'is-active' : ''}`}
            title="Underline"
          >
            <UnderlineIcon />
          </button>
          <button
            onClick={() => editor.chain().focus().toggleStrike().run()}
            className={`note-editor__bubble-btn ${editor.isActive('strike') ? 'is-active' : ''}`}
            title="Strikethrough"
          >
            <StrikeIcon />
          </button>
          <button
            onClick={() => editor.chain().focus().toggleCode().run()}
            className={`note-editor__bubble-btn ${editor.isActive('code') ? 'is-active' : ''}`}
            title="Code"
          >
            <CodeIcon />
          </button>
          <div className="note-editor__bubble-divider" />
          {/* Highlight with color picker */}
          <div className="note-editor__highlight-wrapper" ref={colorPickerRef}>
            <button
              onClick={() => setColorPickerOpen((o) => !o)}
              className={`note-editor__bubble-btn ${editor.isActive('highlight') ? 'is-active' : ''}`}
              title="Highlight"
            >
              <HighlightIcon />
              <span
                className="note-editor__highlight-dot"
                style={{
                  background: editor.getAttributes('highlight').color || HIGHLIGHT_COLORS[0].color,
                }}
              />
            </button>
            {colorPickerOpen && (
              <div className="note-editor__color-picker">
                {HIGHLIGHT_COLORS.map((c) => (
                  <button
                    key={c.name}
                    className={`note-editor__color-swatch ${editor.getAttributes('highlight').color === c.color ? 'is-active' : ''}`}
                    style={{ background: c.color }}
                    title={c.label}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      editor.chain().focus().toggleHighlight({ color: c.color }).run();
                      setColorPickerOpen(false);
                    }}
                  />
                ))}
                <button
                  className="note-editor__color-swatch note-editor__color-swatch--clear"
                  title="Remove highlight"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    editor.chain().focus().unsetHighlight().run();
                    setColorPickerOpen(false);
                  }}
                >
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={3}
                  >
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            )}
          </div>
          {/* Text color picker */}
          <div className="note-editor__highlight-wrapper" ref={textColorRef}>
            <button
              onClick={() => setTextColorPickerOpen((o) => !o)}
              className={`note-editor__bubble-btn ${editor.isActive('textStyle') ? 'is-active' : ''}`}
              title="Text Color"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path d="M4 20h16M9.5 4L4 16h2l1.5-4h9L18 16h2L12.5 4h-3z" />
              </svg>
              <span
                className="note-editor__highlight-dot"
                style={{ background: editor.getAttributes('textStyle').color || 'currentColor' }}
              />
            </button>
            {textColorPickerOpen && (
              <div className="note-editor__color-picker">
                {TEXT_COLORS.map((c) => (
                  <button
                    key={c.name}
                    className={`note-editor__color-swatch ${editor.getAttributes('textStyle').color === c.color ? 'is-active' : ''}`}
                    style={{ background: c.color || 'var(--color-text-primary, #1e293b)' }}
                    title={c.label}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      if (c.color) {
                        editor.chain().focus().setColor(c.color).run();
                      } else {
                        editor.chain().focus().unsetColor().run();
                      }
                      setTextColorPickerOpen(false);
                    }}
                  />
                ))}
              </div>
            )}
          </div>
          <div className="note-editor__bubble-divider" />
          <button
            onClick={addLink}
            className={`note-editor__bubble-btn ${editor.isActive('link') ? 'is-active' : ''}`}
            title="Link"
          >
            <LinkIcon />
          </button>
        </BubbleMenu>
      )}

      {/* Collapsible Note Header (Cover + Title + Meta) */}
      <div
        className={`note-editor__header ${noteHeaderCollapsed ? 'note-editor__header--collapsed' : ''}`}
      >
        {!noteHeaderCollapsed && (
          <>
            <PageCover
              icon={note.icon}
              coverPresetId={note.coverPresetId}
              coverImage={note.coverImage}
              coverPosition={note.coverPosition}
              coverPositionX={note.coverPositionX}
              coverScale={note.coverScale}
              coverColor={note.coverColor}
              onIconChange={(icon) =>
                dispatch(updateNote({ id: note.id, changes: { icon: icon ?? undefined } }))
              }
              onCoverChange={(change) => {
                // Each change kind maps to a distinct set of fields to
                // clear/set on the note so the three cover sources
                // remain mutually exclusive (image > preset > legacy).
                switch (change.type) {
                  case 'preset':
                    dispatch(
                      updateNote({
                        id: note.id,
                        changes: {
                          coverPresetId: change.presetId,
                          coverImage: undefined,
                          coverPosition: undefined,
                          coverPositionX: undefined,
                          coverScale: undefined,
                          coverColor: undefined,
                        },
                      })
                    );
                    break;
                  case 'image':
                    dispatch(
                      updateNote({
                        id: note.id,
                        changes: {
                          coverImage: change.dataUrl,
                          coverPosition: note.coverPosition ?? 50,
                          coverPositionX: note.coverPositionX ?? 50,
                          coverScale: note.coverScale ?? 100,
                          coverPresetId: undefined,
                          coverColor: undefined,
                        },
                      })
                    );
                    break;
                  case 'position':
                    dispatch(
                      updateNote({
                        id: note.id,
                        changes: { coverPosition: change.position },
                      })
                    );
                    break;
                  case 'positionX':
                    dispatch(
                      updateNote({
                        id: note.id,
                        changes: { coverPositionX: change.positionX },
                      })
                    );
                    break;
                  case 'scale':
                    dispatch(
                      updateNote({
                        id: note.id,
                        changes: { coverScale: change.scale },
                      })
                    );
                    break;
                  case 'clear':
                    dispatch(
                      updateNote({
                        id: note.id,
                        changes: {
                          coverPresetId: undefined,
                          coverImage: undefined,
                          coverPosition: undefined,
                          coverPositionX: undefined,
                          coverScale: undefined,
                          coverColor: undefined,
                        },
                      })
                    );
                    break;
                }
              }}
              readOnly={readOnly}
            />
            <div className="note-editor__title-area">
              <textarea
                ref={titleRef}
                className="note-editor__title"
                value={note.title}
                onChange={handleTitleInput}
                onKeyDown={handleTitleKeyDown}
                placeholder={t('notes.titlePlaceholder', 'Untitled')}
                readOnly={readOnly}
                rows={1}
              />
              <div className="note-editor__meta">
                <span className="note-editor__meta-item">
                  {note.wordCount} {t('notes.words', 'words')}
                </span>
                <span className="note-editor__meta-item">
                  {new Date(note.updatedAt).toLocaleDateString('fr-FR', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </div>
            </div>
          </>
        )}
        {noteHeaderCollapsed && (
          <div className="note-editor__header-compact">
            {note.icon && <span className="note-editor__header-compact-icon">{note.icon}</span>}
            <span className="note-editor__header-compact-title">
              {note.title || t('notes.titlePlaceholder', 'Untitled')}
            </span>
            <span className="note-editor__header-compact-meta">
              {note.wordCount} {t('notes.words', 'words')}
            </span>
          </div>
        )}
        <button
          className="note-editor__header-toggle"
          onClick={() => setNoteHeaderCollapsed((prev) => !prev)}
          title={
            noteHeaderCollapsed
              ? t('notes.expandHeader', "Afficher l'en-tête")
              : t('notes.collapseHeader', "Réduire l'en-tête")
          }
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
          >
            {noteHeaderCollapsed ? (
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
            )}
          </svg>
        </button>
      </div>

      {/* Toolbar */}
      {!readOnly && (
        <div className="note-editor__toolbar">
          <div className="note-editor__toolbar-group">
            <button
              onClick={() => editor.chain().focus().toggleBold().run()}
              className={`note-editor__toolbar-btn ${editor.isActive('bold') ? 'is-active' : ''}`}
              title="Bold (Ctrl+B)"
            >
              <BoldIcon />
            </button>
            <button
              onClick={() => editor.chain().focus().toggleItalic().run()}
              className={`note-editor__toolbar-btn ${editor.isActive('italic') ? 'is-active' : ''}`}
              title="Italic (Ctrl+I)"
            >
              <ItalicIcon />
            </button>
            <button
              onClick={() => editor.chain().focus().toggleUnderline().run()}
              className={`note-editor__toolbar-btn ${editor.isActive('underline') ? 'is-active' : ''}`}
              title="Underline (Ctrl+U)"
            >
              <UnderlineIcon />
            </button>
            <button
              onClick={() => editor.chain().focus().toggleStrike().run()}
              className={`note-editor__toolbar-btn ${editor.isActive('strike') ? 'is-active' : ''}`}
              title="Strikethrough"
            >
              <StrikeIcon />
            </button>
            <button
              onClick={() => editor.chain().focus().toggleCode().run()}
              className={`note-editor__toolbar-btn ${editor.isActive('code') ? 'is-active' : ''}`}
              title="Inline Code"
            >
              <CodeIcon />
            </button>
            {/* Highlight with color dropdown */}
            <div
              className="note-editor__highlight-wrapper"
              ref={!colorPickerOpen ? undefined : colorPickerRef}
            >
              <button
                onClick={() => editor.chain().focus().toggleHighlight().run()}
                className={`note-editor__toolbar-btn ${editor.isActive('highlight') ? 'is-active' : ''}`}
                title="Highlight"
              >
                <HighlightIcon />
              </button>
            </div>
            {/* Text color dropdown */}
            <div className="note-editor__highlight-wrapper" ref={textColorRef}>
              <button
                onClick={() => setTextColorPickerOpen((o) => !o)}
                className={`note-editor__toolbar-btn ${editor.isActive('textStyle') ? 'is-active' : ''}`}
                title={t('notes.textColor', 'Text Color')}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path d="M4 20h16M9.5 4L4 16h2l1.5-4h9L18 16h2L12.5 4h-3z" />
                </svg>
                <span
                  className="note-editor__highlight-dot"
                  style={{ background: editor.getAttributes('textStyle').color || 'currentColor' }}
                />
              </button>
              {textColorPickerOpen && (
                <div className="note-editor__color-picker">
                  {TEXT_COLORS.map((c) => (
                    <button
                      key={c.name}
                      className={`note-editor__color-swatch ${editor.getAttributes('textStyle').color === c.color ? 'is-active' : ''}`}
                      style={{ background: c.color || 'var(--color-text-primary, #1e293b)' }}
                      title={c.label}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        if (c.color) {
                          editor.chain().focus().setColor(c.color).run();
                        } else {
                          editor.chain().focus().unsetColor().run();
                        }
                        setTextColorPickerOpen(false);
                      }}
                    />
                  ))}
                </div>
              )}
            </div>
            <button onClick={addLink} className="note-editor__toolbar-btn" title="Link">
              <LinkIcon />
            </button>
            <button
              onClick={insertWikiLinkTrigger}
              className="note-editor__toolbar-btn"
              title={t('notes.linkNote', 'Link Note (@)')}
            >
              <WikiLinkIcon />
            </button>
          </div>
          <div className="note-editor__toolbar-sep" />
          {/* Inline font size, font family, page margins */}
          <div className="note-editor__toolbar-group">
            <select
              className="note-editor__fontsize-select"
              value={editor.getAttributes('textStyle').fontSize || `${styleSettings.fontSize}px`}
              onChange={(e) => {
                const v = e.target.value;
                // If value matches the document-level setting, remove inline override
                if (v === `${styleSettings.fontSize}px`) {
                  editor.chain().focus().unsetFontSize().run();
                } else {
                  editor.chain().focus().setFontSize(v).run();
                }
              }}
              title={t('notes.fontSize', 'Font Size')}
            >
              {[10, 11, 12, 13, 14, 15, 16, 18, 20, 22, 24, 28, 32, 36, 40, 48, 56, 64, 72, 96].map(
                (s) => (
                  <option key={s} value={`${s}px`}>
                    {s}
                  </option>
                )
              )}
            </select>
            <select
              className="note-editor__fontfamily-select"
              value={
                editor.getAttributes('textStyle').fontFamily ||
                FONT_FAMILY_MAP[styleSettings.fontFamily] ||
                styleSettings.fontFamily
              }
              onChange={(e) => {
                const v = e.target.value;
                const docFont =
                  FONT_FAMILY_MAP[styleSettings.fontFamily] || styleSettings.fontFamily;
                if (v === docFont) {
                  editor
                    .chain()
                    .focus()
                    .setMark('textStyle', { fontFamily: null })
                    .removeEmptyTextStyle()
                    .run();
                } else {
                  editor.chain().focus().setMark('textStyle', { fontFamily: v }).run();
                }
              }}
              title={t('notes.fontFamily', 'Font Family')}
            >
              <option value={FONT_FAMILY_MAP[styleSettings.fontFamily] || styleSettings.fontFamily}>
                {styleSettings.fontFamily === 'system'
                  ? 'System'
                  : styleSettings.fontFamily.charAt(0).toUpperCase() +
                    styleSettings.fontFamily.slice(1)}
              </option>
              {[
                { label: 'Inter', value: 'Inter, sans-serif' },
                { label: 'Arial', value: 'Arial, sans-serif' },
                { label: 'Helvetica', value: 'Helvetica, sans-serif' },
                { label: 'Georgia', value: 'Georgia, serif' },
                { label: 'Times New Roman', value: "'Times New Roman', serif" },
                { label: 'Courier New', value: "'Courier New', monospace" },
                { label: 'Fira Code', value: "'Fira Code', monospace" },
                { label: 'Verdana', value: 'Verdana, sans-serif' },
                { label: 'Tahoma', value: 'Tahoma, sans-serif' },
                { label: 'Trebuchet MS', value: "'Trebuchet MS', sans-serif" },
                { label: 'Comic Sans', value: "'Comic Sans MS', cursive" },
                { label: 'Impact', value: 'Impact, sans-serif' },
              ]
                .filter(
                  (f) =>
                    f.value !==
                    (FONT_FAMILY_MAP[styleSettings.fontFamily] || styleSettings.fontFamily)
                )
                .map((f) => (
                  <option key={f.label} value={f.value} style={{ fontFamily: f.value }}>
                    {f.label}
                  </option>
                ))}
            </select>
            <select
              className="note-editor__spacing-select"
              value={(() => {
                // Show spacing of current block, or global default
                const { $from } = editor.state.selection;
                for (let d = $from.depth; d >= 0; d--) {
                  const n = $from.node(d);
                  if (n.attrs.lineSpacing != null) return String(n.attrs.lineSpacing);
                }
                return String(styleSettings.spacingScale ?? 1);
              })()}
              onChange={(e) => {
                const val = Number(e.target.value);
                const defaultScale = styleSettings.spacingScale ?? 1;
                if (val === defaultScale) {
                  editor.chain().focus().unsetBlockSpacing().run();
                } else {
                  editor.chain().focus().setBlockSpacing(val).run();
                }
              }}
              title={t('notes.spacing', 'Spacing')}
            >
              <option value="0.5">{t('notes.spacingTight', 'Tight')}</option>
              <option value="0.75">{t('notes.spacingCompact', 'Compact')}</option>
              <option value="1">{t('notes.spacingNormal', 'Normal')}</option>
              <option value="1.25">{t('notes.spacingRelaxed', 'Relaxed')}</option>
              <option value="1.5">{t('notes.spacingSpacious', 'Spacious')}</option>
              <option value="2">{t('notes.spacingDouble', 'Double')}</option>
            </select>
          </div>
          <div className="note-editor__toolbar-sep" />
          <div className="note-editor__toolbar-group">
            <button
              onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
              className={`note-editor__toolbar-btn ${editor.isActive('heading', { level: 1 }) ? 'is-active' : ''}`}
              title="Heading 1"
            >
              <HeadingIcon level={1} />
            </button>
            <button
              onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
              className={`note-editor__toolbar-btn ${editor.isActive('heading', { level: 2 }) ? 'is-active' : ''}`}
              title="Heading 2"
            >
              <HeadingIcon level={2} />
            </button>
            <button
              onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
              className={`note-editor__toolbar-btn ${editor.isActive('heading', { level: 3 }) ? 'is-active' : ''}`}
              title="Heading 3"
            >
              <HeadingIcon level={3} />
            </button>
          </div>
          <div className="note-editor__toolbar-sep" />
          <div className="note-editor__toolbar-group">
            <button
              onClick={() => editor.chain().focus().toggleBulletList().run()}
              className={`note-editor__toolbar-btn ${editor.isActive('bulletList') ? 'is-active' : ''}`}
              title="Bullet List"
            >
              <ListIcon />
            </button>
            <button
              onClick={() => editor.chain().focus().toggleOrderedList().run()}
              className={`note-editor__toolbar-btn ${editor.isActive('orderedList') ? 'is-active' : ''}`}
              title="Ordered List"
            >
              <OrderedListIcon />
            </button>
            <button
              onClick={() => editor.chain().focus().toggleTaskList().run()}
              className={`note-editor__toolbar-btn ${editor.isActive('taskList') ? 'is-active' : ''}`}
              title="Checklist"
            >
              <ChecklistIcon />
            </button>
          </div>
          <div className="note-editor__toolbar-sep" />
          <div className="note-editor__toolbar-group">
            <button
              onClick={() => editor.chain().focus().toggleBlockquote().run()}
              className={`note-editor__toolbar-btn ${editor.isActive('blockquote') ? 'is-active' : ''}`}
              title="Quote"
            >
              <QuoteIcon />
            </button>
            <button
              onClick={() => editor.chain().focus().toggleCodeBlock().run()}
              className={`note-editor__toolbar-btn ${editor.isActive('codeBlock') ? 'is-active' : ''}`}
              title="Code Block"
            >
              <CodeIcon />
            </button>
            <button onClick={insertTable} className="note-editor__toolbar-btn" title="Table">
              <TableIcon />
            </button>
            <button
              onClick={() => editor.chain().focus().setHorizontalRule().run()}
              className="note-editor__toolbar-btn"
              title="Horizontal Rule"
            >
              <HrIcon />
            </button>
          </div>
          <div className="note-editor__toolbar-sep" />
          <div className="note-editor__toolbar-group">
            <button
              onClick={() => setShowVersionHistory(!showVersionHistory)}
              className={`note-editor__toolbar-btn ${showVersionHistory ? 'is-active' : ''}`}
              title={t('notes.versionHistory', 'Version History')}
            >
              <VersionIcon />
            </button>
            <button
              onClick={() => setShowExportDialog(true)}
              className="note-editor__toolbar-btn"
              title={t('notes.exportNote', 'Export Note')}
            >
              <ExportIcon />
            </button>
            <button
              onClick={() => setIsDrawingMode((d) => !d)}
              className={`note-editor__toolbar-btn ${isDrawingMode ? 'is-active' : ''}`}
              title={t('notes.drawingMode', 'Drawing Mode')}
            >
              <DrawIcon />
            </button>
            <button
              onClick={() => {
                if (!editor) return;
                const { from, to } = editor.state.selection;
                if (from === to) return;
                const commentId = `comment-${Date.now()}`;
                editor.chain().focus().setComment(commentId).run();
                setPendingCommentId(commentId);
                setCommentInputValue('');
                setCommentInputOpen(true);
                setTimeout(() => commentInputRef.current?.focus(), 50);
              }}
              className={`note-editor__toolbar-btn ${commentInputOpen ? 'is-active' : ''}`}
              title={t('notes.addComment', 'Add Comment')}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
              </svg>
            </button>
            <select
              className="note-editor__theme-select"
              value={editorTheme}
              onChange={(e) => {
                const theme = e.target.value as 'default' | 'writer' | 'developer';
                setEditorTheme(theme);
                // Apply theme preset to style settings
                const preset = getThemePresets()[theme];
                if (preset) {
                  const merged = { ...loadStyleSettings(), ...preset };
                  localStorage.setItem(STYLE_SETTINGS_KEY, JSON.stringify(merged));
                  setStyleSettings(merged);
                  window.dispatchEvent(new Event('filarr-style-settings-changed'));
                }
              }}
              title={t('notes.editorTheme', 'Editor Theme')}
            >
              <option value="default">{t('notes.themeDefault', 'Default')}</option>
              <option value="writer">{t('notes.themeWriter', 'Writer')}</option>
              <option value="developer">{t('notes.themeDeveloper', 'Developer')}</option>
            </select>
            {onOpenStyleSettings && (
              <button
                onClick={onOpenStyleSettings}
                className="note-editor__toolbar-btn"
                title={t('notes.styleSettings.title', 'Style Settings')}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
                </svg>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Inline link input */}
      {linkInputOpen && (
        <div className="note-editor__link-input-bar">
          <LinkIcon />
          <input
            ref={linkInputRef}
            type="text"
            className="note-editor__link-input"
            value={linkInputValue}
            onChange={(e) => setLinkInputValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                confirmLink();
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                setLinkInputOpen(false);
                editor?.commands.focus();
              }
            }}
            placeholder="https://example.com"
          />
          <button className="note-editor__link-apply" onClick={confirmLink}>
            {t('common.apply', 'Apply')}
          </button>
          <button
            className="note-editor__link-cancel"
            onClick={() => {
              setLinkInputOpen(false);
              editor?.commands.focus();
            }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.5}
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      )}

      {/* Inline comment input */}
      {commentInputOpen && (
        <div className="note-editor__link-input-bar">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
          </svg>
          <input
            ref={commentInputRef}
            type="text"
            className="note-editor__link-input"
            value={commentInputValue}
            onChange={(e) => setCommentInputValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && commentInputValue.trim() && pendingCommentId) {
                e.preventDefault();
                setNoteComments((prev) => ({
                  ...prev,
                  [pendingCommentId]: {
                    id: pendingCommentId,
                    text: commentInputValue.trim(),
                    author: 'You',
                    createdAt: new Date().toISOString(),
                    resolved: false,
                  },
                }));
                setCommentInputOpen(false);
                setPendingCommentId(null);
                setCommentInputValue('');
                editor?.commands.focus();
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                // Cancel: remove the comment mark
                if (pendingCommentId) {
                  editor?.chain().focus().unsetComment().run();
                }
                setCommentInputOpen(false);
                setPendingCommentId(null);
                setCommentInputValue('');
                editor?.commands.focus();
              }
            }}
            placeholder={t('notes.addComment', 'Add comment...')}
          />
          <button
            className="note-editor__link-apply"
            onClick={() => {
              if (commentInputValue.trim() && pendingCommentId) {
                setNoteComments((prev) => ({
                  ...prev,
                  [pendingCommentId]: {
                    id: pendingCommentId,
                    text: commentInputValue.trim(),
                    author: 'You',
                    createdAt: new Date().toISOString(),
                    resolved: false,
                  },
                }));
              }
              setCommentInputOpen(false);
              setPendingCommentId(null);
              setCommentInputValue('');
              editor?.commands.focus();
            }}
          >
            {t('common.apply', 'Apply')}
          </button>
          <button
            className="note-editor__link-cancel"
            onClick={() => {
              if (pendingCommentId) {
                editor?.chain().focus().unsetComment().run();
              }
              setCommentInputOpen(false);
              setPendingCommentId(null);
              setCommentInputValue('');
              editor?.commands.focus();
            }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.5}
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      )}

      {/* Editor content + Drawing overlay */}
      <div className="note-editor__body-wrapper" ref={editorBodyRef}>
        <EditorContent editor={editor} className="note-editor__body" />
        <DrawingOverlay
          strokes={note.drawingStrokes}
          isActive={isDrawingMode}
          onStrokesChange={handleDrawingStrokesChange}
          editorBodyRef={editorBodyRef}
        />
      </div>

      {/* Version History — sidebar / scrapbook / scrubber via the hub */}
      {showVersionHistory && (
        <VersionHistoryHub
          noteId={note.id}
          currentContent={note.content}
          currentPlainText={note.plainText}
          onClose={() => setShowVersionHistory(false)}
        />
      )}

      {/* Export Dialog */}
      {showExportDialog && <ExportDialog note={note} onClose={() => setShowExportDialog(false)} />}

      {/* Comments Panel is rendered in NotesView right sidebar via onCommentsChange */}

      {/* Wiki-link autocomplete popup */}
      {wikiOpen &&
        wikiSuggestions.length > 0 &&
        (() => {
          const menuHeight = 280; // max-height 260 + padding
          const spaceBelow = window.innerHeight - wikiPos.y;
          const flipUp = spaceBelow < menuHeight;
          const menuStyle: React.CSSProperties = {
            left: Math.min(wikiPos.x, window.innerWidth - 350),
            ...(flipUp
              ? { bottom: window.innerHeight - wikiPos.y + 24, top: 'auto' }
              : { top: wikiPos.y }),
          };
          return (
            <div className="wiki-link-menu" style={menuStyle}>
              <div className="wiki-link-menu__header">
                {activeTrigger === '@'
                  ? t('notes.linkNoteAt', 'Dates & Notes (@)')
                  : t('notes.linkNoteBracket', 'Link note ([[)')}
              </div>
              {wikiSuggestions.map((item, i) => (
                <button
                  key={`${item.type}-${item.label}`}
                  className={`wiki-link-menu__item ${i === wikiSelected ? 'is-selected' : ''}`}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    insertWikiLink(item.insert, item.dateValue);
                  }}
                  onMouseEnter={() => setWikiSelected(i)}
                >
                  <span className={`wiki-link-menu__type wiki-link-menu__type--${item.type}`}>
                    {typeIcons[item.type]}
                  </span>
                  <span className="wiki-link-menu__label">{item.label}</span>
                  {item.dateValue && (
                    <span className="wiki-link-menu__date-preview">{item.dateValue}</span>
                  )}
                  <span className="wiki-link-menu__badge">{item.type}</span>
                </button>
              ))}
              <div className="wiki-link-menu__hint">
                {t('notes.wikiLinkHint', '\u2191\u2193 to navigate, Enter to select, Esc to close')}
              </div>
            </div>
          );
        })()}
    </div>
  );

  return editorContent;
});

export default NoteEditor;
