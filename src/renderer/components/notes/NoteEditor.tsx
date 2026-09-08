/**
 * NoteEditor Component — Filarr Notes
 *
 * TipTap-based rich text editor with:
 * - WYSIWYG markdown editing
 * - Slash commands (type "/" for block insertion menu)
 * - Wiki-link autocomplete (type "[[" to link notes/files/folders)
 * - Task lists, tables, code blocks
 */

import React, { useMemo, useCallback, useEffect, useRef, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import { sinkListItem, liftListItem } from 'prosemirror-schema-list';
import { TextSelection } from '@tiptap/pm/state';
import { Node as PMNode, Slice } from '@tiptap/pm/model';
import type { EditorView } from '@tiptap/pm/view';
import { BubbleMenu } from '@tiptap/react/menus';
import Placeholder from '@tiptap/extension-placeholder';
import { useTranslation } from 'react-i18next';
import { useSelector, useDispatch } from 'react-redux';
import { findOrphanCommentIds } from '../../../services/notes/commentOrphans';
import {
  upsertNoteComment,
  resolveNoteComment,
  deleteNoteComment,
} from '../../../store/slices/notesSlice';
import store from '../../../store';
import type { RootState, AppDispatch } from '../../../store';
import {
  selectAllNotes,
  selectNoteIdByTitle,
  setEditingNote,
  clearScrollToHeading,
} from '../../../store/slices/notesSlice';
import { addTab } from '../../../store/slices/tabsSlice';
import type { Note } from '../../../types/notes';
// Le menu « / », le menu d'émojis et leur branchement React vivent dans
// `interactiveNoteExtensions` : l'éditeur de coffre partagé monte EXACTEMENT
// les mêmes, et deux copies auraient divergé au premier ajout de commande.
import { slashCommandExtension, emojiShortcodesExtension } from './interactiveNoteExtensions';
import { applyOutsideList } from './listAwareCommands';
import { DragHandleExtension } from './extensions/dragHandlePlugin';
import { stripWikiLinks } from '../../../services/notes/noteLinkParser';
import { isWebPlatform } from '../../../services/platform/isWebPlatform';
import { BlockLinkContextMenu } from './BlockLinkContextMenu';
import { useNotification } from '../ui/Notification';
import { extractHeadings } from '../../../services/notes/transclusionHelpers';
import { syncEditorContent } from '../../../services/notes/noteEditorSync';
import { migrateLegacyImageNodes } from '../../../services/notes/legacyImageMigration';
import { hasRichHtml, looksLikeMarkdown } from '../../../services/notes/markdownPaste';
import { markdownToTipTap } from '../../../services/notes/noteImportService';
import { TemplatePickerModal } from './TemplatePickerModal';
import {
  areTemplateSuggestionsEnabled,
  markTemplatesOffered,
  wasTemplatesOffered,
} from './templateSuggestionPrefs';
import { prepareTemplate } from '../../../services/notes/applyTemplate';
import type { NoteTemplate } from '../../../types/notes';
import { acquireNoteEditor } from '../../../services/notes/noteEditorRegistry';
import { NoteSyncBadge } from './NoteSyncBadge';
import { NoteSharedBadge } from './NoteSharedBadge';
import { SaveStateIndicator } from './SaveStateIndicator';
import { NoteIcon } from './pickers/NoteIcon';
import {
  resolveChrome,
  decideHeaderStage,
  initialScrollCollapse,
  COMPACT_HEADER_PX,
} from './editorChromeModel';
import { setVaultEmbedEnabled } from './SlashCommandMenu';
import { VaultNotePicker } from '../vaults/VaultNotePicker';
import { selectCanUseTeamVaults } from '../../../store/selectors/authSelectors';
import { WikiLinkDecorationExtension } from './extensions/wikiLinkDecorationPlugin';
import {
  PotentialLinkDecorationExtension,
  POTENTIAL_LINK_CLASS,
  ignorePotentialLink,
  resolveTitleOccurrence,
  flashRange,
} from './extensions/potentialLinkDecorationPlugin';
import type { PotentialLinkCandidate } from './extensions/potentialLinkDecorationPlugin';
import { HeadingCollapserExtension } from './extensions/headingCollapserExtension';
import { DATE_KEYWORDS } from './extensions/naturalLanguageDatesExtension';
import { AutoLinkTitleExtension } from './extensions/autoLinkTitleExtension';
import { DrawingOverlay } from './DrawingOverlay';
import { PageCover } from './PageCover';
import { CommentsPanel } from './CommentsPanel';
import type { NoteComment } from './CommentsPanel';
import { updateNote } from '../../../store/slices/notesSlice';
import { VersionHistoryHub } from './versioning/VersionHistoryHub';
// saveVersion lives in the main process now: notes:save triggers
// recordSnapshots() server-side with dedup + encrypted disk storage.
import { ExportDialog } from './ExportDialog';
import { NoteShareButton } from './NoteShareButton';
import type { StyleSettings } from './StyleSettingsPanel';
import { isDarkTheme } from '../../utils/theme';
import * as profileStorage from '../../../services/core/profileStorage';
import { getActiveProfileId } from '../../../services/core/profileStorage';
import { fold } from '../../../utils/textFold';
import {
  createHeadingScrollStabilizer,
  computeScrollTopForTarget,
  findHeadingPosByRank,
  HEADING_SCROLL_STABILIZE_WINDOW_MS,
} from './scrollToHeadingStabilizer';
import type { HeadingScrollStabilizer } from './scrollToHeadingStabilizer';
import { LINK_POTENTIAL_EVENT } from '../../../services/notes/autoLinkService';
import type { LinkPotentialDetail } from '../../../services/notes/autoLinkService';
import { buildNoteSchemaExtensions } from './extensions/schemaExtensions';
import { buildCollabExtensions, starterKitOptions } from './collab/collabExtensions';
import {
  COLLAB_READY_TIMEOUT_MS,
  computeWriteBack,
  createWriteBackDebouncer,
  decideCollabSettle,
  decideStaleSharedDoc,
  SHARED_META_MAP,
  SHARED_STORE_STAMP_KEY,
  isExternalNoteWrite,
  isStaleCollabSession,
  shouldSkipWriteBack,
  writeBackDelayMs,
} from './collab/collabWriteBack';
import { composeDisplayName } from './collab/collabPresence';
import { useCollabSession, useLiveCollabEnabled } from './collab/useCollabSession';
import type { CollabSessionState } from './collab/useCollabSession';
import { CollabPresenceBar } from './collab/CollabPresenceBar';
import { RoomFullNotice } from './collab/RoomFullNotice';
import './NoteEditor.css';
import './editor-themes/default.css';
import './editor-themes/writer.css';
import './editor-themes/developer.css';

// ==================== Toolbar Collapse ====================

/**
 * Au-dela, une note vide n'est plus « celle qu'on vient de creer ».
 *
 * Assez large pour couvrir la creation puis l'ouverture (rendu, hydratation,
 * amorcage collaboratif), assez court pour qu'une note laissee vide hier ne
 * relance jamais la fenetre.
 */
const FRESH_NOTE_MS = 30_000;

const TOOLBAR_COLLAPSED_KEY = 'filarr-editor-toolbar-collapsed';

// Défaut : repliée sur le web (chrome minimal, bubble menu + slash suffisent),
// déployée sur bureau ; le choix persisté de l'utilisateur prime partout.
function loadToolbarCollapsed(): boolean {
  const stored = profileStorage.getItemWithLegacyFallback(TOOLBAR_COLLAPSED_KEY);
  if (stored === '1') return true;
  if (stored === '0') return false;
  return isWebPlatform();
}

// ==================== Style Settings Helpers ====================

export const STYLE_SETTINGS_KEY = 'filarr-style-settings';

/**
 * Version du schéma persisté dans `filarr-style-settings`.
 *
 * v1 écrivait TOUJOURS une couleur en dur pour le fond, le texte et l'accent —
 * et le panneau de style épinglait le blanc du thème clair dès sa première
 * ouverture, même sous un thème sombre. Résultat : la page de notes revenait au
 * blanc sur minuit (et sur tous les thèmes sombres) sans que rien n'ait été
 * choisi. Depuis v2, `null` veut dire « suis le thème » et seule une couleur
 * VRAIMENT choisie par l'utilisateur est écrite.
 */
const STYLE_SETTINGS_VERSION = 2;

const FONT_FAMILY_MAP: Record<string, string> = {
  system: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  serif: 'Georgia, "Times New Roman", Times, serif',
  'sans-serif': '"Helvetica Neue", Helvetica, Arial, sans-serif',
  monospace: '"Fira Code", "JetBrains Mono", "Cascadia Code", Consolas, monospace',
};

export function getAppTheme(): string {
  return document.documentElement.getAttribute('data-theme') || 'light';
}

/** Returns the correct default editor background for the given (or current) app theme */
export function getThemeEditorBg(theme: string = getAppTheme()): string {
  switch (theme) {
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
    case 'minuit':
      return '#101728';
    default:
      return '#ffffff';
  }
}

/** Returns the correct default text color for the given (or current) app theme */
export function getThemeTextColor(theme: string = getAppTheme()): string {
  switch (theme) {
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
    case 'minuit':
      return '#f2ece0';
    default:
      return '#1e293b';
  }
}

/** Returns the correct default accent color for the given (or current) app theme */
export function getThemeAccentColor(theme: string = getAppTheme()): string {
  return isDarkTheme(theme) ? '#60a5fa' : '#3b82f6';
}

const THEME_PRESETS_LIGHT: Record<string, Partial<StyleSettings>> = {
  default: {
    fontFamily: 'system',
    fontSize: 16,
    lineHeight: 1.6,
    headingScale: 1.25,
    // null = « suis le thème » : le préréglage « Défaut » ne fige aucune couleur.
    accentColor: null,
    editorBg: null,
    textColor: null,
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
    accentColor: null,
    editorBg: null,
    textColor: null,
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
  return isDarkTheme() ? THEME_PRESETS_DARK : THEME_PRESETS_LIGHT;
}

/**
 * Réglages de départ. Les trois couleurs valent `null` : « suis le thème de
 * l'application ». Rien n'est figé tant que l'utilisateur n'a pas choisi
 * lui-même — c'est ce qui empêche le blanc de se réinstaller sur minuit.
 */
export function getStyleDefaults(): StyleSettings {
  return {
    fontFamily: 'system',
    fontSize: 16,
    lineHeight: 1.6,
    headingScale: 1.25,
    accentColor: null,
    editorBg: null,
    textColor: null,
    editorPadding: 48,
    contentMaxWidth: 1100,
    showLineNumbers: false,
    typewriterMode: false,
    spacingScale: 1,
  };
}

/** Résout les couleurs « suis le thème » (null) en valeurs concrètes. */
export function resolveStyleColors(
  settings: StyleSettings,
  theme: string = getAppTheme()
): { accentColor: string; editorBg: string; textColor: string } {
  return {
    accentColor: settings.accentColor ?? getThemeAccentColor(theme),
    editorBg: settings.editorBg ?? getThemeEditorBg(theme),
    textColor: settings.textColor ?? getThemeTextColor(theme),
  };
}

// Toutes les couleurs qu'un thème ou un préréglage a pu poser TOUT SEUL du
// temps de la v1. Une valeur stockée qui figure ici n'était pas un choix de
// l'utilisateur : la migration la rend au thème.
const V1_AUTO_EDITOR_BGS = new Set([
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
  'rgba(15, 29, 21, 0.5)',
  '#101728', // foret, minuit
  '#fefcf7', // ancien fond « writer » du panneau de style
]);
const V1_AUTO_TEXT_COLORS = new Set([
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
  '#e0ecdc',
  '#f2ece0', // foret, minuit
]);
const V1_AUTO_ACCENTS = new Set(['#3b82f6', '#60a5fa']);

export function saveStyleSettings(settings: StyleSettings): void {
  try {
    profileStorage.setItem(
      STYLE_SETTINGS_KEY,
      JSON.stringify({ ...settings, v: STYLE_SETTINGS_VERSION })
    );
  } catch {
    /* ignore */
  }
}

export function loadStyleSettings(): StyleSettings {
  const defaults = getStyleDefaults();
  try {
    const raw = profileStorage.getItemWithLegacyFallback(STYLE_SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<StyleSettings> & { v?: number };
      const version = parsed.v;
      delete parsed.v;
      // Migrate old default width (720) to new default
      if (parsed.contentMaxWidth === 720) delete parsed.contentMaxWidth;
      const merged: StyleSettings = { ...defaults, ...parsed };
      if (version !== STYLE_SETTINGS_VERSION) {
        if (typeof merged.editorBg === 'string' && V1_AUTO_EDITOR_BGS.has(merged.editorBg)) {
          merged.editorBg = null;
        }
        if (typeof merged.textColor === 'string' && V1_AUTO_TEXT_COLORS.has(merged.textColor)) {
          merged.textColor = null;
        }
        if (typeof merged.accentColor === 'string' && V1_AUTO_ACCENTS.has(merged.accentColor)) {
          merged.accentColor = null;
        }
        // La correction est PERSISTÉE : sans cela le prochain enregistrement
        // (quel qu'il soit) ré-épinglerait la couleur d'origine, et le blanc
        // reviendrait sur la page de notes au premier réglage touché.
        saveStyleSettings(merged);
      }
      return merged;
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

// ==================== Image Paste / Drop ====================

/** Only images are intercepted; anything else falls through to ProseMirror. */
function imageFilesFrom(list: FileList | null | undefined): File[] {
  return Array.from(list ?? []).filter((f) => /^image\//i.test(f.type));
}

/**
 * Inserts images at the current selection as data-URLs, in the same node shape
 * as the `/image` command. The bytes travel INSIDE the note (encrypted with
 * it) — no disk reference, no remote src (the renderer CSP would block one).
 */
function insertImageFiles(view: EditorView, files: File[]) {
  const type = view.state.schema.nodes.fileEmbed;
  if (!type) return;
  files.forEach((file, idx) => {
    const reader = new FileReader();
    reader.onload = () => {
      const src = reader.result;
      if (typeof src !== 'string' || view.isDestroyed) return;
      const node = type.create({
        fileId: `local-${Date.now()}-${idx}`,
        fileName: file.name || 'image',
        fileType: file.type,
        src,
      });
      view.dispatch(view.state.tr.replaceSelectionWith(node).scrollIntoView());
    };
    reader.readAsDataURL(file);
  });
}

// ==================== Wiki-link Search Helpers ====================

// ==================== Potential-link Helpers ====================

/**
 * One cache slot for the potential-link candidates. `selectAllNotes` is a
 * reselect selector, so its identity only moves when a note actually does —
 * comparing it is enough to keep the (debounced) editor scan from rebuilding
 * the whole title list on every pass.
 */
let potentialCandidateCache: { source: Note[]; value: PotentialLinkCandidate[] } | null = null;

/**
 * Every note that could be mentioned in `currentNoteId`, minus the ones it
 * already links to — the same exclusion `findPotentialLinks` applies, so the
 * editor hints and the backlinks panel never disagree about what is "potential".
 */
function potentialLinkCandidates(currentNoteId: string | null): PotentialLinkCandidate[] {
  const state = store.getState();
  const notes = selectAllNotes(state);
  if (potentialCandidateCache?.source !== notes) {
    potentialCandidateCache = {
      source: notes,
      value: notes
        .filter((n) => n.title.trim().length > 0)
        .map((n) => ({ id: n.id, title: n.title.trim() })),
    };
  }
  const all = potentialCandidateCache.value;
  const current = currentNoteId ? state.notes.byId[currentNoteId] : undefined;
  const linked = new Set(current?.linkedNoteIds ?? []);
  return linked.size === 0 ? all : all.filter((c) => !linked.has(c.id));
}

/**
 * The two-item popover a dotted hint raises. Same dismissal contract as
 * `BlockLinkContextMenu` (outside click, Escape, scroll) and, deliberately, no
 * work of its own: it only reports which button was pressed, so opening it
 * never re-runs the scan that produced the hint.
 */
const PotentialLinkMenu: React.FC<{
  x: number;
  y: number;
  title: string;
  onLink: () => void;
  onIgnore: () => void;
  onClose: () => void;
}> = ({ x, y, title, onLink, onIgnore, onClose }) => {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onOutside = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      // Escape always; otherwise any key typed OUTSIDE the popover — the user
      // clicked into the word to edit it, not to answer us, and a suggestion
      // that hovers over the text being typed is in the way.
      if (e.key === 'Escape' || !ref.current?.contains(document.activeElement)) onClose();
    };
    // One tick, so the click that opened us doesn't close us right back.
    const handle = setTimeout(() => {
      document.addEventListener('mousedown', onOutside);
      document.addEventListener('keydown', onKey);
      document.addEventListener('scroll', onClose, true);
    }, 0);
    return () => {
      clearTimeout(handle);
      document.removeEventListener('mousedown', onOutside);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('scroll', onClose, true);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="potential-link-menu"
      style={{ left: Math.min(x, window.innerWidth - 220), top: y, position: 'fixed' }}
      role="menu"
    >
      <span className="potential-link-menu__title" title={title}>
        {title}
      </span>
      <button type="button" role="menuitem" className="potential-link-menu__item" onClick={onLink}>
        {t('notes.potentialLinkAction', 'Link')}
      </button>
      <button
        type="button"
        role="menuitem"
        className="potential-link-menu__item potential-link-menu__item--muted"
        onClick={onIgnore}
      >
        {t('notes.potentialLinkIgnore', 'Ignore')}
      </button>
    </div>
  );
};

/** Loose last resort: every char of `needle`, in order, somewhere in `hay`. */
function isSubsequence(needle: string, hay: string): boolean {
  const chars = needle.replace(/\s+/g, '');
  if (!chars) return false;
  let i = 0;
  for (let j = 0; j < hay.length && i < chars.length; j++) {
    if (hay[j] === chars[i]) i++;
  }
  return i === chars.length;
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
  /** Mode sans distraction : replie le chrome sans toucher aux préférences. */
  focusMode?: boolean;
}

interface NoteEditorInnerProps extends NoteEditorProps {
  /** Session vivante de la note ouverte — `session: null` quand il n'y en a pas. */
  collab: CollabSessionState;
  /** Le nom qui SIGNE un commentaire — le profil, jamais « You ». */
  authorName: string;
}

// ==================== Component ====================

const NoteEditorInner: React.FC<NoteEditorInnerProps> = function NoteEditorInner({
  note,
  onUpdate,
  onTitleChange,
  onCommentsChange,
  commentsHandleRef,
  readOnly = false,
  onOpenStyleSettings,
  focusMode = false,
  collab,
  authorName,
}) {
  const { t } = useTranslation();
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  /** Ce que le repli LIBÈRE, mesuré pendant que l'en-tête est déployé. */
  const collapsibleHeightRef = useRef(0);
  /** Ce que le seul escamotage du bandeau libère. */
  const coverHeightRef = useRef(0);
  /** Ajustement de la barre valable le temps du focus — jamais écrit sur disque. */
  const [toolbarFocusOverride, setToolbarFocusOverride] = useState<boolean | null>(null);
  const [isFocused, setIsFocused] = useState(false);
  const [colorPickerOpen, setColorPickerOpen] = useState(false);
  const colorPickerRef = useRef<HTMLDivElement>(null);
  const [editorTheme, setEditorTheme] = useState<'default' | 'writer' | 'developer'>('default');
  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [isDrawingMode, setIsDrawingMode] = useState(false);
  /**
   * LES COMMENTAIRES VIENNENT DE LA NOTE, plus d'un état d'écran. L'ancien
   * useState était effacé au changement de note et jamais persisté : chaque
   * commentaire jamais écrit mourait à la fermeture, pendant que sa MARQUE,
   * elle, était persistée — orpheline. Les mutations passent par le slice, qui
   * bouscule `updatedAt` pour que la fusion nuage les respecte.
   */
  // Mémoïsé : `?? {}` fabriquerait un objet NEUF à chaque rendu, et l'effet qui
  // republie les commentaires au panneau partirait en boucle infinie.
  const noteComments = useMemo(() => note.comments ?? {}, [note.comments]);
  const dispatch = useDispatch<AppDispatch>();
  const [commentInputOpen, setCommentInputOpen] = useState(false);
  const [commentInputValue, setCommentInputValue] = useState('');
  const [pendingCommentId, setPendingCommentId] = useState<string | null>(null);
  const commentInputRef = useRef<HTMLInputElement>(null);
  const [linkInputOpen, setLinkInputOpen] = useState(false);
  const [linkInputValue, setLinkInputValue] = useState('');
  const linkInputRef = useRef<HTMLInputElement>(null);
  const editorBodyRef = useRef<HTMLDivElement>(null);
  // ── Le chrome de l'en-tête : DEUX sources, jamais une seule ──────────────
  // `headerManual` est le choix explicite (null = « laisse l'automatique
  // décider »), `scrollCollapse` le verdict du défilement. Les fondre en un
  // seul booléen ferait annuler un repli manuel au premier cran de molette.
  // La composition est dans `editorChromeModel`, qui est testé.
  const [headerManual, setHeaderManual] = useState<boolean | null>(null);
  const [scrollCollapse, setScrollCollapse] = useState(initialScrollCollapse);
  const [coverPickerOpen, setCoverPickerOpen] = useState(false);
  const [toolbarPref, setToolbarPref] = useState(loadToolbarCollapsed);
  const [styleSettings, setStyleSettings] = useState<StyleSettings>(loadStyleSettings);
  // Le thème de l'application n'est pas dans React : sans cet état, un
  // changement de thème ne redessinerait pas les couleurs « suis le thème ».
  const [appTheme, setAppTheme] = useState(getAppTheme);
  const [textColorPickerOpen, setTextColorPickerOpen] = useState(false);
  const textColorRef = useRef<HTMLDivElement>(null);
  const [writeBack] = useState(createWriteBackDebouncer);

  // ---- Édition vivante ----
  // Le remontage est piloté par la clé posée sur ce composant : `collab.session`
  // ne change donc jamais d'identité pendant la vie de l'instance.
  const collabSession = collab.session;
  const collabActive = collabSession !== null;
  const collabMount = collabSession
    ? {
        fragment: collabSession.fragment,
        awareness: collabSession.awareness,
        user: collab.identity,
      }
    : null;
  const collabSessionRef = useRef(collabSession);
  collabSessionRef.current = collabSession;
  const collabActiveRef = useRef(collabActive);
  collabActiveRef.current = collabActive;
  const noteContentRef = useRef(note.content);
  noteContentRef.current = note.content;
  const noteUpdatedAtRef = useRef(note.updatedAt);
  noteUpdatedAtRef.current = note.updatedAt;

  /**
   * Note dans le document partagé l'horloge du magasin qu'il vient de voir
   * (voir decideStaleSharedDoc). Silencieux hors session.
   */
  const stampSharedDoc = (
    session: { doc: { getMap: (name: string) => { set: (k: string, v: unknown) => void } } } | null,
    stamp: string | undefined
  ): void => {
    if (!session || !stamp) return;
    try {
      session.doc.getMap(SHARED_META_MAP).set(SHARED_STORE_STAMP_KEY, stamp);
    } catch {
      /* un document fermé ne se marque plus */
    }
  };
  // « La session est tranchée » : elle est arrivée garnie, nous venons de la
  // semer, ou le plafond d'attente est passé. Tant que c'est faux, RIEN ne part
  // vers le magasin — voir l'effet de semis plus bas.
  const collabReadyRef = useRef(false);
  const collabSeededRef = useRef(false);
  // Une écriture a été refusée pendant l'attente : il faudra la rejouer une
  // fois la session tranchée, sinon ce qui a été tapé entre-temps ne serait
  // jamais persisté (le CRDT le garde, le magasin ne l'aurait jamais vu).
  const collabMissedWriteRef = useRef(false);

  const chrome = resolveChrome({
    focusMode,
    // Les panneaux latéraux sont l'affaire de NotesView : ici on ne lit que ce
    // qui concerne l'en-tête et la barre d'outils.
    hoverPref: false,
    listPinned: true,
    rightPinned: true,
    listPeek: false,
    rightPeek: false,
    headerManual,
    scrollStage: scrollCollapse.stage,
    toolbarPref,
    toolbarFocusOverride,
    // Ce composant N'EXISTE que monté sur une note.
    noteOpen: true,
  });
  const noteHeaderCollapsed = chrome.headerCollapsed;
  /** Palier intermédiaire : le bandeau s'efface, le titre reste. */
  const coverHidden = chrome.headerStage === 'title';
  const toolbarCollapsed = chrome.toolbarCollapsed;

  const toggleToolbarCollapsed = useCallback(() => {
    const next = !toolbarCollapsed;
    // Pendant le mode sans distraction, la poignée n'ajuste que la session :
    // écrire la préférence disque ferait qu'un geste ponctuel survivrait au
    // mode et changerait le réglage de l'utilisateur à son insu.
    if (focusMode) {
      setToolbarFocusOverride(next);
      return;
    }
    profileStorage.setItem(TOOLBAR_COLLAPSED_KEY, next ? '1' : '0');
    setToolbarPref(next);
  }, [toolbarCollapsed, focusMode]);

  // Listen for style settings changes (from StyleSettingsPanel saving to localStorage)
  useEffect(() => {
    const reload = () => setStyleSettings(loadStyleSettings());
    const onStorage = (e: StorageEvent) => {
      if (profileStorage.matchesKey(e.key, STYLE_SETTINGS_KEY)) reload();
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener('filarr-style-settings-changed', reload);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('filarr-style-settings-changed', reload);
    };
  }, []);

  // Suivre le thème de l'application. Les couleurs laissées à `null` sont
  // résolues à l'affichage, donc il suffit de provoquer un rendu ; la migration
  // v1 → v2 (et sa persistance) est faite par loadStyleSettings au montage.
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setAppTheme(getAppTheme());
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    return () => observer.disconnect();
  }, []);

  // Build CSS custom properties from style settings — applied on .note-editor container
  // so they cascade into .ProseMirror via var() references in NoteEditor.css
  const resolvedStyleColors = resolveStyleColors(styleSettings, appTheme);
  const editorCssVars: React.CSSProperties = {
    ['--ss-font-family' as string]:
      FONT_FAMILY_MAP[styleSettings.fontFamily] || styleSettings.fontFamily,
    ['--ss-font-size' as string]: `${styleSettings.fontSize}px`,
    ['--ss-line-height' as string]: String(styleSettings.lineHeight),
    ['--ss-text-color' as string]: resolvedStyleColors.textColor,
    ['--ss-editor-bg' as string]: resolvedStyleColors.editorBg,
    ['--ss-content-max-width' as string]: `${styleSettings.contentMaxWidth}px`,
    ['--ss-accent-color' as string]: resolvedStyleColors.accentColor,
    ['--ss-heading-scale' as string]: String(styleSettings.headingScale),
    ['--ss-spacing-scale' as string]: String(styleSettings.spacingScale ?? 1),
  };

  // Notify parent when comments change
  useEffect(() => {
    onCommentsChange?.(noteComments);
  }, [noteComments, onCommentsChange]);

  // Handle ref is assigned after editor is created (see below)

  /**
   * Déclare cette note comme TENUE par un éditeur, tant que celui-ci est monté.
   * Une écriture venue d'ailleurs (ligne créée depuis une base inline, colonne
   * miroir posée par une base voisine) s'en sert pour renoncer : le document en
   * mémoire de ProseMirror la réécrirait à la frappe suivante. La vue scindée en
   * monte plusieurs — un identifiant unique dans le store n'en désignerait qu'un.
   */
  useEffect(() => acquireNoteEditor(note.id), [note.id]);

  // Wiki-link autocomplete state
  const allNotes = useSelector(selectAllNotes);
  const filesById = useSelector((s: RootState) => s.files.byId);
  const foldersById = useSelector((s: RootState) => s.folders.byId);
  const pendingScrollToHeading = useSelector((s: RootState) => s.notes.pendingScrollToHeading);

  // Shared-vault note embed (E3-3c): a slash action runs outside React and can't open
  // a modal, so the "Vault note" command fires a window event; we open the picker here,
  // gated on the shared-vault entitlement (which also toggles the command's visibility).
  const canUseTeamVaults = useSelector(selectCanUseTeamVaults);
  const [vaultPickerOpen, setVaultPickerOpen] = useState(false);
  // Latest editor instance, read inside the global-event handler so only the FOCUSED
  // pane opens the picker (split view mounts two editors sharing the window event).
  const embedEditorRef = useRef<ReturnType<typeof useEditor>>(null) as React.MutableRefObject<
    ReturnType<typeof useEditor>
  >;
  useEffect(() => {
    // The flag mirrors the (global) entitlement, so DON'T reset it on unmount — in
    // split view another editor may still be mounted and entitled; force-disabling here
    // would wrongly hide the command for it. A downgrade re-runs this with false.
    setVaultEmbedEnabled(canUseTeamVaults);
    if (!canUseTeamVaults) return;
    const handler = () => {
      // Only the editor where the slash was typed (the focused one) should respond,
      // else both panes open a picker and the wrong note could receive the embed.
      if (embedEditorRef.current?.isFocused) setVaultPickerOpen(true);
    };
    window.addEventListener('filarr:embed-vault-note', handler);
    return () => window.removeEventListener('filarr:embed-vault-note', handler);
  }, [canUseTeamVaults]);
  const [wikiQuery, setWikiQuery] = useState('');
  const [wikiOpen, setWikiOpen] = useState(false);
  const [wikiPos, setWikiPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [wikiSelected, setWikiSelected] = useState(0);
  const wikiStartPos = useRef<number | null>(null);
  // Track which trigger character opened the popup: '[[' or '@'
  const wikiTrigger = useRef<'[[' | '@'>('[[');
  // Tracks which start-position the popup was opened at — used to
  // distinguish the initial trigger detection (where we want to seed the
  // mode from context) from re-detections on subsequent transactions
  // (where the popup is already open and the user may have manually
  // switched modes via Tab/click; we must NOT overwrite that choice).
  const wikiOpenAtPos = useRef<number | null>(null);
  // Insertion mode — derived initially from the trigger context but the
  // user can switch with Tab or the popup's mode buttons without having
  // to retype the prefix. Affects what `insertWikiLink` puts in the doc:
  //   link  → `[[Title]]`
  //   embed → `![[Title]]` (converted to a transclusion node by the rule)
  //   date  → date items only (`@`-trigger default)
  const [wikiMode, setWikiMode] = useState<'link' | 'embed' | 'date'>('link');

  // Right-click "Copier le lien vers ce bloc" menu
  const [blockLinkMenu, setBlockLinkMenu] = useState<{ x: number; y: number; pos: number } | null>(
    null
  );
  // "Link / Ignore" popover raised by clicking a dotted potential-link hint.
  // `pos` is where the hint sat when it was clicked — a hint, not an authority:
  // the range is re-resolved against the live document before any rewrite.
  const [potentialMenu, setPotentialMenu] = useState<{
    x: number;
    y: number;
    title: string;
    pos: number;
  } | null>(null);
  const { success: notifySuccess, error: notifyError } = useNotification();

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
  /**
   * OUVRIR N'EST PAS MODIFIER. Le document tel que l'éditeur le sérialise
   * juste après avoir reçu le contenu du magasin. Cette forme diffère souvent
   * de la chaîne stockée (attributs par défaut, migrations à la lecture,
   * ordre des clés) : sans ce repère, la première transaction venue —
   // balayage des marques, plugin, perte de focus — renvoyait au magasin un
   * document « différent » qui n'avait pas changé, datait la note, la
   * marquait à synchroniser, et faisait repartir dix mégaoctets. Le retour
   * au magasin ne part que si l'éditeur sérialise AUTRE CHOSE que ce repère.
   */
  const editorCanonicalRef = useRef<string | null>(null);

  // Retour au stockage — un seul chemin pour la frappe locale et pour la
  // session vivante. `emit` reste paramétrable parce que la bascule de note
  // doit vider la file avec le callback de la note SORTANTE.
  type WriteBackEditor = {
    isDestroyed: boolean;
    getJSON: () => unknown;
    getText: () => string;
  } | null;
  const emitWriteBack = (ed: WriteBackEditor, emit: (json: string, text: string) => void) => {
    if (!ed || ed.isDestroyed) return;
    if (
      shouldSkipWriteBack({
        collabActive: collabActiveRef.current,
        ready: collabReadyRef.current,
      })
    ) {
      collabMissedWriteRef.current = true;
      return;
    }
    collabMissedWriteRef.current = false;
    // FILET : jamais le document d'une AUTRE note. Une session qui ne désigne
    // pas la note courante est un décalage de rendu (l'enveloppe le prévient
    // désormais) — s'en servir écrirait le texte d'une note dans une autre.
    const open = collabSessionRef.current;
    const session = open && open.noteId === noteIdRef.current ? open : null;
    const payload = computeWriteBack({
      getCollabJson: session ? () => session.getTiptapJson() : null,
      getEditorJson: () => ed.getJSON(),
      getPlainText: () => stripWikiLinks(ed.getText()),
    });
    // Rien n'a bougé depuis la lecture : pas d'écriture, pas de date, pas de
    // synchronisation. Voir editorCanonicalRef.
    if (editorCanonicalRef.current !== null && payload.json === editorCanonicalRef.current) return;
    editorCanonicalRef.current = payload.json;
    lastSyncedContentRef.current = payload.json;
    // Le magasin va être daté de maintenant : le document partagé le note,
    // pour qu'un pair qui rejoint plus tard sache que ce qu'il lit vaut
    // au moins ce magasin-là.
    stampSharedDoc(session, new Date().toISOString());
    emit(payload.json, payload.plainText);
  };

  // Build wiki-link suggestions (includes date keywords when trigger is @)
  // Track trigger in state so memo re-computes properly
  const [activeTrigger, setActiveTrigger] = useState<'[[' | '@'>('[[');

  const wikiSuggestions = React.useMemo(() => {
    const q = fold(wikiQuery);
    const tokens = q.split(/\s+/).filter(Boolean);
    const results: {
      label: string;
      insert: string;
      type: 'note' | 'file' | 'folder' | 'date' | 'heading';
      dateValue?: string;
      /** Folder trail shown under the label — two "Notes" are told apart by it. */
      path?: string;
      /** When set, `insertWikiLink` skips the text path and inserts a
       *  transclusion node directly. Needed because TipTap input rules
       *  don't fire on programmatic inserts via `chain().insertContent`. */
      embed?: { noteId: string; noteTitle: string; section?: string };
    }[] = [];

    // Heading mode: when the query contains a `#`, the part before is the
    // note title and the part after is a heading filter. We resolve the
    // title against the store, walk the resolved note's content for
    // headings, and surface those as suggestions. Selecting a heading
    // inserts `![[Title#Heading]]` (embed) or `[[Title#Heading]]` (link)
    // in one shot, no second autocomplete round-trip.
    const hashIdx = wikiQuery.indexOf('#');
    if (hashIdx !== -1 && wikiMode !== 'date') {
      const titlePart = wikiQuery.slice(0, hashIdx).trim();
      const headingQuery = fold(wikiQuery.slice(hashIdx + 1));
      const titleMap = selectNoteIdByTitle(store.getState());
      const targetId = titleMap.get(titlePart.toLowerCase());
      const targetNote = targetId ? store.getState().notes.byId[targetId] : undefined;
      if (targetNote && targetNote.content) {
        let json: unknown;
        try {
          json = JSON.parse(targetNote.content);
        } catch {
          json = null;
        }
        const headings = json ? extractHeadings(json) : [];
        const wrap = (h: { text: string }) =>
          wikiMode === 'embed'
            ? `![[${targetNote.title}#${h.text}]]`
            : `[[${targetNote.title}#${h.text}]]`;
        for (const h of headings) {
          if (!headingQuery || fold(h.text).includes(headingQuery)) {
            results.push({
              label: `${'#'.repeat(h.level)} ${h.text}`,
              insert: wrap(h),
              type: 'heading',
              embed:
                wikiMode === 'embed'
                  ? { noteId: targetNote.id, noteTitle: targetNote.title, section: h.text }
                  : undefined,
            });
          }
          if (results.length >= 15) break;
        }
        return results;
      }
      // Title didn't resolve — fall through so the user keeps seeing note
      // suggestions until they fix the spelling.
    }

    // Date mode (the @ trigger) keeps date keywords at the TOP, but no longer
    // owns the menu: the match is by PREFIX and the search below always runs.
    // The old version matched anywhere and returned as soon as one keyword hit,
    // so `@ma` showed Mardi/Samedi/Dimanche and hid « Marketing » entirely.
    if (wikiMode === 'date') {
      const maxDates = q ? 4 : 6;
      for (const dk of DATE_KEYWORDS) {
        if (results.length >= maxDates) break;
        if (!q || fold(dk.keyword).startsWith(q) || fold(dk.label).startsWith(q)) {
          results.push({ label: dk.label, insert: '', type: 'date', dateValue: dk.resolve() });
        }
      }
    }

    // Link / embed modes — wrap inserts based on the active mode so the
    // text path / direct-node path each get the right markup.
    const wrapNote = (title: string) => (wikiMode === 'embed' ? `![[${title}]]` : `[[${title}]]`);
    const wrapFile = (name: string) =>
      wikiMode === 'embed' ? `![[file:${name}]]` : `[[file:${name}]]`;
    const wrapFolder = (name: string) =>
      wikiMode === 'embed' ? `![[folder:${name}]]` : `[[folder:${name}]]`;

    // Rank every candidate, then sort — the previous version took the first
    // 20 notes in store order and stopped, so a note whose title STARTS with
    // the query could be cut before it was ever considered while an unrelated
    // note that merely contained the letters ranked above it. Files and
    // folders were then appended without any cap and could crowd notes out of
    // the final 15.
    type Ranked = {
      entry: (typeof results)[number];
      rank: number;
      at: number;
      len: number;
      mtime: number;
    };
    const ranked: Ranked[] = [];

    /** Folder trail of an item, deepest last. Guarded against a parent cycle. */
    const trailOf = (parentId: string | null | undefined) => {
      const parts: string[] = [];
      let cursor = parentId ?? null;
      for (let depth = 0; cursor && depth < 12; depth++) {
        const folder = foldersById[cursor];
        if (!folder) break;
        parts.unshift(folder.name);
        cursor = folder.parentId ?? null;
      }
      return parts.join(' / ');
    };

    const consider = (
      text: string,
      entry: (typeof results)[number],
      typeBias: number,
      mtime: number
    ) => {
      const lower = fold(text);
      let rank: number;
      let at = 0;
      if (!q) {
        rank = 4;
      } else if (lower === q) {
        rank = 0;
      } else if (lower.startsWith(q)) {
        rank = 1;
      } else {
        at = lower.indexOf(q);
        if (at !== -1) {
          // Matching right after a separator reads as a word start to a human.
          rank = /[\s\-_/([.]/.test(lower[at - 1] ?? '') ? 2 : 3;
        } else if (tokens.length > 1 && tokens.every((tk) => lower.includes(tk))) {
          // Words typed in any order — « compte rendu » finds « Rendu de compte ».
          at = Math.max(lower.indexOf(tokens[0]), 0);
          rank = 4;
        } else if (isSubsequence(q, lower)) {
          // Last resort: initials and skipped letters (« nrj » → « Note Réunion Juin »).
          at = lower.length;
          rank = 5;
        } else {
          return;
        }
      }
      // Bias keeps notes ahead of files/folders at EQUAL relevance, without
      // letting a weak note match outrank a strong file match.
      ranked.push({ entry, rank: rank * 4 + typeBias, at, len: text.length, mtime });
    };

    for (const n of allNotes) {
      if (n.id === note.id) continue;
      consider(
        n.title || 'Untitled',
        {
          label: n.title || 'Untitled',
          insert: wrapNote(n.title),
          type: 'note',
          path: trailOf(n.parentId),
          embed:
            wikiMode === 'embed' ? { noteId: n.id, noteTitle: n.title || 'Untitled' } : undefined,
        },
        0,
        Date.parse(n.updatedAt) || 0
      );
    }
    for (const f of Object.values(filesById)) {
      consider(
        f.name,
        { label: f.name, insert: wrapFile(f.name), type: 'file', path: trailOf(f.parentId) },
        1,
        Date.parse(f.updatedAt || f.createdAt || '') || 0
      );
    }
    for (const f of Object.values(foldersById)) {
      consider(
        f.name,
        { label: f.name, insert: wrapFolder(f.name), type: 'folder', path: trailOf(f.parentId) },
        2,
        Date.parse(f.updatedAt || f.createdAt || '') || 0
      );
    }

    // Recency is the tie-breaker that makes an EMPTY query useful: every entry
    // then ranks the same, so the menu opens on the notes touched last.
    ranked.sort(
      (a, b) =>
        a.rank - b.rank ||
        a.at - b.at ||
        b.mtime - a.mtime ||
        a.len - b.len ||
        a.entry.label.localeCompare(b.entry.label)
    );

    for (const candidate of ranked) {
      if (results.length >= 15) break;
      results.push(candidate.entry);
    }

    return results;
  }, [wikiQuery, wikiMode, allNotes, filesById, foldersById, note.id]);

  /**
   * LE MENU EST-IL A L'ECRAN ? Une seule expression, deux lecteurs.
   *
   * Le rendu et le detournement du clavier repondaient chacun de leur cote —
   * l'un sur « au moins une suggestion », l'autre sur `wikiOpen` seul — et
   * c'est cet ecart qui avalait Entree derriere un @ sans rien montrer. Ils
   * lisent desormais la meme variable : ils ne peuvent plus diverger.
   */
  const wikiMenuVisible = wikiOpen && wikiSuggestions.length > 0;

  // TipTap editor setup
  const editor = useEditor({
    extensions: buildNoteSchemaExtensions({
      // Le SCHÉMA du document — nœuds, marques, attributs globaux — n'est plus
      // écrit ici : il vient de la source unique partagée avec les surfaces de
      // coffre partagé et de version. Une extension d'attribut global présente
      // d'un côté et absente de l'autre ne « manque » pas discrètement,
      // ProseMirror EFFACE l'attribut au premier aller-retour du document.
      // Ne restent ici que les extensions d'interaction, celles qui capturent
      // t(), le store ou des popups React ; les `slots` les remettent
      // exactement à la place qu'elles occupaient dans la liste d'origine,
      // parce que l'ordre décide de la priorité des greffons ProseMirror.
      //
      // `starterKitOptions` coupe l'historique du StarterKit dès qu'Yjs est
      // monté : le CRDT apporte le sien, les deux ne peuvent pas coexister.
      starterKit: starterKitOptions(collabActive),
      // Poignées de redimensionnement des colonnes : propres à l'éditeur.
      tableResizable: true,
      // Memoised title→id selector keeps the input rule O(1) even with
      // thousands of notes. Read from the live store on every call so the
      // resolution sees notes added since the editor mounted (the
      // extension instance outlives any individual render).
      resolveTransclusionByTitle: (title: string) => {
        const map = selectNoteIdByTitle(store.getState());
        const id = map.get(title.toLowerCase());
        if (!id) return undefined;
        const note = store.getState().notes.byId[id];
        return note ? { id: note.id, title: note.title } : undefined;
      },
      slots: {
        afterStarterKit: [
          ...buildCollabExtensions(collabMount),
          Placeholder.configure({
            placeholder: t(
              'notes.editorPlaceholder',
              'Start writing, type / for commands or [[ to link...'
            ),
          }),
        ],
        afterCodeBlock: [DragHandleExtension],
        afterBlockId: [
          WikiLinkDecorationExtension,
          // Dotted hints under mentions of other notes' titles. Every callback is
          // read at scan time (never captured): the extension instance outlives any
          // render, so closing over `note` here would freeze the hints on the note
          // that happened to be open when this editor mounted.
          PotentialLinkDecorationExtension.configure({
            getCandidates: () => potentialLinkCandidates(noteIdRef.current),
            getCurrentNoteId: () => noteIdRef.current,
          }),
        ],
        afterComment: [HeadingCollapserExtension],
        afterFootnote: [emojiShortcodesExtension(), AutoLinkTitleExtension],
        // L'espace PERSONNEL offre tout le catalogue : `link-note`,
        // `embed-note`, `sub-page` et `dataview` visent ses propres notes, et
        // c'est ici — et ici seulement — qu'elles ont un sens.
        trailing: [slashCommandExtension()],
      },
    }),
    // En session vivante le document initial vient du CRDT : passer `content`
    // ici le dupliquerait à chaque montage. L'amorçage éventuel se fait dans
    // l'effet de semis plus bas, une seule fois, et seulement si le partagé
    // est réellement vide.
    content: collabActive
      ? ''
      : note.content
        ? (() => {
            try {
              // Rattrapage des notes importees avant le 2026-08-26 : leurs
              // nœuds `image` seraient SUPPRIMES au parse, et la premiere
              // frappe les effacerait du stockage. Voir legacyImageMigration.
              return migrateLegacyImageNodes(JSON.parse(note.content)).doc;
            } catch {
              return note.content;
            }
          })()
        : '',
    editable: !readOnly,
    onUpdate: ({ editor: ed }) => {
      writeBack.schedule(() => {
        emitWriteBack(ed, (json, text) => onUpdateRef.current(json, text));
        // Version snapshot happens in the main process as part of notes:save
        // (see recordSnapshots in electron/main.ts), so nothing to do here.
      }, writeBackDelayMs(collabActiveRef.current));
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
      if (writeBack.cancelPending()) {
        emitWriteBack(ed, (json, text) => onUpdateRef.current(json, text));
      }
    },
    editorProps: {
      attributes: {
        class: 'note-editor__content',
        spellcheck: 'false',
      },
      // Screenshot / image in the clipboard → inline embed. Returning false on
      // anything else is load-bearing: the URL paste handler of
      // `autoLinkTitleExtension` runs after this one and must keep seeing text.
      handlePaste: (view, event) => {
        const images = imageFilesFrom(event.clipboardData?.files);
        if (images.length > 0) {
          event.preventDefault();
          insertImageFiles(view, images);
          return true;
        }

        // Coller du MARKDOWN : titres, listes, tableaux et blocs de code
        // arrivaient en texte brut, a reformater a la main.
        const plain = event.clipboardData?.getData('text/plain') ?? '';
        const html = event.clipboardData?.getData('text/html') ?? '';
        // Dans un bloc de code, le Markdown est le CONTENU : le convertir
        // detruirait precisement ce qu'on venait coller.
        const inCode = view.state.selection.$from.parent.type.spec.code === true;
        if (!inCode && !hasRichHtml(html) && looksLikeMarkdown(plain)) {
          try {
            const { doc: parsed } = markdownToTipTap(plain);
            if ((parsed.content ?? []).length > 0) {
              // Passage par le SCHEMA : un nœud que l'éditeur ne connaît pas
              // fait lever ici, et le collage retombe alors sur le
              // comportement natif — jamais sur un document amputé.
              const converted = PMNode.fromJSON(view.state.schema, parsed);
              event.preventDefault();
              view.dispatch(
                view.state.tr.replaceSelection(new Slice(converted.content, 0, 0)).scrollIntoView()
              );
              return true;
            }
          } catch {
            // Conversion impossible : on laisse ProseMirror coller le texte.
          }
        }

        return false;
      },
      // Images dragged in from the OS. `moved` means ProseMirror is moving its
      // own content around — never our business.
      handleDrop: (view, event, _slice, moved) => {
        if (moved) return false;
        const images = imageFilesFrom(event.dataTransfer?.files);
        if (images.length === 0) return false;
        event.preventDefault();
        const dropped = view.posAtCoords({ left: event.clientX, top: event.clientY });
        if (dropped) {
          // Move the selection to the drop point first: every image then lands
          // through `replaceSelectionWith`, so several files keep their order.
          view.dispatch(
            view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(dropped.pos)))
          );
        }
        insertImageFiles(view, images);
        return true;
      },
      handleKeyDown: (view, event) => {
        // Wiki-link autocomplete: intercept keys when open.
        //
        // « OUVERT » N'EST PAS « VISIBLE ». Le menu ne se peint que s'il a au
        // moins une suggestion ; `wikiOpen`, lui, reste vrai tant que le `@`
        // court toujours — donc apres « @toto » qui ne ressemble a rien de
        // connu. Detourner les touches sur `wikiOpen` seul avalait alors Entree
        // EN SILENCE : plus moyen de passer a la ligne derriere un @, et rien a
        // l'ecran pour l'expliquer. On detourne sur ce que l'utilisateur VOIT.
        if (wikiMenuVisible) {
          if (event.key === 'Escape') {
            setWikiOpen(false);
            wikiOpenAtPos.current = null;
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
          // Tab cycles between insertion modes (link → embed → date → link).
          // Holding Shift reverses the cycle. The popup re-filters on the
          // next render via the `wikiMode` dep in `wikiSuggestions`.
          if (event.key === 'Tab' && event.shiftKey) {
            setWikiMode((m) => (m === 'link' ? 'date' : m === 'date' ? 'embed' : 'link'));
            setWikiSelected(0);
            return true;
          }
          if (event.key === 'Tab' && !event.shiftKey) {
            setWikiMode((m) => (m === 'link' ? 'embed' : m === 'embed' ? 'date' : 'link'));
            setWikiSelected(0);
            return true;
          }
          if (event.key === 'Enter') {
            const sel = wikiSuggestions[wikiSelected];
            if (sel) {
              insertWikiLink(sel.insert, sel.dateValue, sel.embed);
            }
            return true;
          }
        }

        // Tab / Shift+Tab: indent/outdent in lists and task lists.
        if (event.key === 'Tab') {
          const { state, dispatch } = view;
          const { $from } = state.selection;

          // Inside a table cell → let the Table extension move between cells
          // (goToNextCell). Returning false without preventDefault lets its
          // keymap run instead of swallowing the Tab.
          for (let d = $from.depth; d > 0; d--) {
            const nodeName = $from.node(d).type.name;
            if (nodeName === 'tableCell' || nodeName === 'tableHeader') return false;
          }

          event.preventDefault();

          // Inside a code block → insert a soft tab instead of eating the key.
          if ($from.parent.type.name === 'codeBlock') {
            dispatch(state.tr.insertText('  '));
            return true;
          }

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

  const hasCover = !!(note.coverPresetId || note.coverImage || note.coverColor);

  /**
   * Le repli au défilement.
   *
   * La couverture n'est PAS dans le conteneur qui défile — l'en-tête est un
   * frère `flex-shrink: 0` au-dessus de `.note-editor__body-wrapper`. Rien ne
   * peut donc « coller » ni sortir de l'écran tout seul : on écoute, et on
   * replie. Déplacer l'en-tête dans le scroller donnerait un sticky natif au
   * prix des coordonnées de tous les tracés déjà enregistrés (DrawingOverlay
   * dimensionne son canevas depuis ce wrapper) — hors de question.
   *
   * Toute la décision est dans `decideHeaderStage`, qui est testé : c'est lui
   * qui porte les trois paliers, leurs hystérésis, le verrou temporel et les
   * trois refus.
   */
  const scrollLocked = !!pendingScrollToHeading || isDrawingMode || coverPickerOpen;
  const scrollLockedRef = useRef(scrollLocked);
  scrollLockedRef.current = scrollLocked;
  const hasCoverRef = useRef(hasCover);
  hasCoverRef.current = hasCover;

  useEffect(() => {
    const wrapper = editorBodyRef.current;
    if (!wrapper) return;

    const onScroll = () => {
      // Mesurer l'en-tête COURANT donnerait ~280 px entier et ~36 px replié : le
      // garde-fou anti-oscillation deviendrait permissif juste après le premier
      // repli. On ne rafraîchit donc les deltas qu'au palier ENTIER, seul état
      // où les deux sont lisibles ensemble.
      const el = headerRef.current;
      const banner = el?.querySelector<HTMLElement>('.page-cover__banner');
      if (el && banner) {
        coverHeightRef.current = banner.offsetHeight;
        collapsibleHeightRef.current = Math.max(0, el.offsetHeight - COMPACT_HEADER_PX);
      }
      setScrollCollapse((prev) => {
        const { next, rearm } = decideHeaderStage(prev, {
          scrollTop: wrapper.scrollTop,
          clientHeight: wrapper.clientHeight,
          scrollHeight: wrapper.scrollHeight,
          coverHeight: coverHeightRef.current,
          collapsibleHeight: collapsibleHeightRef.current,
          now: performance.now(),
          locked: scrollLockedRef.current,
          hasCover: hasCoverRef.current,
        });
        if (rearm) setHeaderManual(null);
        return next === prev ? prev : next;
      });
    };

    wrapper.addEventListener('scroll', onScroll, { passive: true });
    return () => wrapper.removeEventListener('scroll', onScroll);
    // `editor` en dépendance, et surtout PAS un tableau vide : ce composant rend
    // `null` tant que l'éditeur n'existe pas (:2702 plus bas), donc au premier
    // passage le conteneur qui défile n'est pas encore dans le DOM. Avec `[]`,
    // l'effet ne s'exécutait qu'à cet instant-là, trouvait la ref vide et
    // n'attachait jamais rien : la couverture ne se repliait pas.
  }, [editor]);

  /**
   * Repartir à zéro en changeant de note.
   *
   * Hors collaboration la clé de remontage est la CONSTANTE 'local' : changer
   * de note ne remonte pas ce composant, et `.note-editor__body-wrapper` garde
   * son `scrollTop`. Sans cette remise à zéro, ouvrir une note longue après
   * une note longue la présentait en-tête replié, au milieu du document, et
   * aucun événement de défilement ne venait rétablir quoi que ce soit.
   */
  useEffect(() => {
    setHeaderManual(null);
    setScrollCollapse(initialScrollCollapse);
    collapsibleHeightRef.current = 0;
    coverHeightRef.current = 0;
    if (editorBodyRef.current) editorBodyRef.current.scrollTop = 0;
  }, [note.id]);

  /** Sortir du focus rend la main aux préférences : sinon un ajustement fait
   *  pendant le mode figerait le chrome après la sortie. */
  useEffect(() => {
    if (!focusMode) setToolbarFocusOverride(null);
    setHeaderManual(null);
  }, [focusMode]);

  // Keep the embed-event handler pointed at the current editor (focus-gated above).
  embedEditorRef.current = editor;

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
          const startPos = from - query.length - 2;
          setWikiQuery(query);
          wikiStartPos.current = startPos;
          wikiTrigger.current = '[[';
          // Only seed mode + reset selection on the INITIAL detection
          // (when the popup is either closed or anchored at a different
          // start pos). Subsequent transactions at the same anchor must
          // preserve the user's manual Tab/click mode switch.
          if (wikiOpenAtPos.current !== startPos) {
            setWikiSelected(0);
            setActiveTrigger('[[');
            const charBefore = textBefore.charAt(openIdx - 1);
            setWikiMode(charBefore === '!' ? 'embed' : 'link');
            wikiOpenAtPos.current = startPos;
          }

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

        // Un `@` collé à un mot n'ouvre RIEN : « contact@filarr.com » est une
        // adresse, pas une mention. La règle est prise par la négative — tout
        // sauf une lettre ou un chiffre arme le menu — pour ne pas avoir à
        // deviner la liste des caractères qui terminent un mot.
        const charBeforeAt = atIdx > 0 ? textBefore.charAt(atIdx - 1) : '';
        const atStartsWord = charBeforeAt === '' || !/[a-z0-9à-öø-ÿ]/i.test(charBeforeAt);

        if (!insideBrackets && atStartsWord) {
          const query = textBefore.slice(atIdx + 1);
          // Don't open if query contains newlines or spaces at start (email-like patterns)
          if (!query.includes('\n') && !/^\s/.test(query)) {
            const startPos = from - query.length - 1; // 1 for '@'
            setWikiQuery(query);
            wikiStartPos.current = startPos;
            wikiTrigger.current = '@';
            // Only seed mode + reset selection on the INITIAL detection;
            // see comment in the `[[` branch above.
            if (wikiOpenAtPos.current !== startPos) {
              setWikiSelected(0);
              setActiveTrigger('@');
              setWikiMode('date');
              wikiOpenAtPos.current = startPos;
            }

            const coords = editor.view.coordsAtPos(from);
            setWikiPos({ x: coords.left, y: coords.bottom + 4 });
            setWikiOpen(true);
            return;
          }
        }
      }

      setWikiOpen(false);
      wikiOpenAtPos.current = null;
    };

    editor.on('transaction', handleTransaction);
    return () => {
      editor.off('transaction', handleTransaction);
    };
  }, [editor]);

  // Insert a wiki-link suggestion or date node
  const insertWikiLink = useCallback(
    (
      linkText: string,
      dateValue?: string,
      embedPayload?: { noteId: string; noteTitle: string; section?: string }
    ) => {
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
      } else if (embedPayload) {
        // Embed mode: insert a transclusion node directly. We can't rely on
        // the text path + InputRule conversion because TipTap input rules
        // only fire on actual keystrokes, not on programmatic
        // `chain().insertContent` calls (which is what the autocomplete
        // does). Also extend the deletion to include a leading `!` if the
        // user got to embed mode by typing it before `[[`.
        let from0 = startPos;
        const charBefore = editor.state.doc.textBetween(Math.max(0, startPos - 1), startPos, '');
        if (charBefore === '!') from0 = startPos - 1;

        // Delete the typed trigger first, then insert the block via the
        // dedicated command — more robust than chaining
        // `insertContent({type: 'transclusion'})` in a single chain, which
        // silently fails to render when the block lands inline. Splitting
        // matches the working SubPage slash-command pattern.
        editor.chain().focus().deleteRange({ from: from0, to: from }).run();
        editor.commands.insertTransclusion({
          noteId: embedPayload.noteId,
          noteTitle: embedPayload.noteTitle,
          section: embedPayload.section ?? null,
          blockId: null,
          alias: null,
          preview: '',
        });
      } else {
        // Link mode (no embed payload, no date): plain text insertion. The
        // `WikiLinkDecorationPlugin` styles `[[Title]]` text in place.
        let from0 = startPos;
        if (linkText.startsWith('!')) {
          const charBefore = editor.state.doc.textBetween(Math.max(0, startPos - 1), startPos, '');
          if (charBefore === '!') from0 = startPos - 1;
        }
        editor
          .chain()
          .focus()
          .deleteRange({ from: from0, to: from })
          .insertContent(linkText + ' ')
          .run();
      }
      // Reset state to prevent stale references
      wikiStartPos.current = null;
      wikiOpenAtPos.current = null;
      setWikiOpen(false);
    },
    [editor]
  );

  // Toolbar action: insert [[ at cursor to trigger wiki-link autocomplete
  const insertWikiLinkTrigger = useCallback(() => {
    if (!editor) return;
    editor.chain().focus().insertContent('[[').run();
  }, [editor]);

  /**
   * Wraps one mention of `title` in `[[…]]`. The range is resolved against the
   * document as it stands NOW — never against a position captured earlier —
   * because the decoration set is rebuilt on a debounce and the panel works
   * from `plainText` offsets, neither of which survives an edit. The wiki-link
   * decoration then takes over on its own, and `linkedNoteIds` follows through
   * the ordinary save pipeline.
   */
  const closePotentialMenu = useCallback(() => setPotentialMenu(null), []);

  const linkPotentialMention = useCallback(
    (title: string, hintPos?: number | null): boolean => {
      if (!editor || !editor.isEditable) return false;
      const range = resolveTitleOccurrence(editor.state.doc, title, hintPos);
      if (!range) return false;
      const inserted = `[[${title}]]`;
      // `scrollIntoView` is the difference between a rewrite the user SEES and
      // one they have to go looking for — the request often comes from the
      // backlinks panel, aimed at a mention that is nowhere near the viewport.
      editor.chain().focus().insertContentAt(range, inserted).scrollIntoView().run();
      // The replacement starts where the old range did and is exactly as long
      // as what we inserted; clamped because a concurrent CRDT patch could have
      // shortened the document between the chain and here.
      const to = Math.min(range.from + inserted.length, editor.state.doc.content.size);
      flashRange(editor.view, range.from, to);
      return true;
    },
    [editor]
  );

  /**
   * Says out loud what just happened. Silence after a "Link" click is
   * indistinguishable from a bug — and the failure case is real: the mention is
   * resolved against the LIVE document, which may no longer hold the text the
   * panel scanned (`plainText` lags behind by a debounce).
   */
  const reportLinkOutcome = useCallback(
    (linked: string[], failed: string[]) => {
      if (linked.length === 1) {
        notifySuccess(
          t('notes.potentialLinkLinked', 'Linked to [[{{title}}]]', { title: linked[0] })
        );
      } else if (linked.length > 1) {
        notifySuccess(
          t('notes.potentialLinkLinkedMany', '{{count}} mentions linked', { count: linked.length })
        );
      }
      if (failed.length === 1) {
        notifyError(
          t(
            'notes.potentialLinkMissing',
            'Mention « {{title}} » not found — the text may have changed',
            { title: failed[0] }
          )
        );
      } else if (failed.length > 1) {
        notifyError(
          t(
            'notes.potentialLinkMissingMany',
            '{{count}} mentions could not be linked — the text may have changed',
            { count: failed.length }
          )
        );
      }
    },
    [t, notifySuccess, notifyError]
  );

  /**
   * The backlinks panel asks (it can't rewrite the document itself — this
   * editor holds it). `handled` closes the split-view case where two panes show
   * the same note: the first one to answer claims the request. `linked` /
   * `failed` travel back OUT through the same detail object: `dispatchEvent` is
   * synchronous, so the panel reads them the moment its call returns.
   */
  useEffect(() => {
    if (!editor) return;
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<LinkPotentialDetail>).detail;
      if (!detail || detail.handled) return;
      if (detail.noteId !== noteIdRef.current) return;
      detail.handled = true;
      // The two out-parameters are part of the contract, but a crash here would
      // take the editor down — a request built by hand simply gets no report.
      if (!Array.isArray(detail.linked)) detail.linked = [];
      if (!Array.isArray(detail.failed)) detail.failed = [];
      // Sequentially: each replacement shifts every position after it, so the
      // next title has to be located again in the rewritten document.
      detail.titles.forEach((title) => {
        if (linkPotentialMention(title)) detail.linked.push(title);
        else detail.failed.push(title);
      });
      reportLinkOutcome(detail.linked, detail.failed);
    };
    window.addEventListener(LINK_POTENTIAL_EVENT, handler);
    return () => window.removeEventListener(LINK_POTENTIAL_EVENT, handler);
  }, [editor, linkPotentialMention, reportLinkOutcome]);

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
      if (writeBack.cancelPending()) {
        emitWriteBack(editor, (json, text) => onUpdateRef.current(json, text));
      }
    };
    // `editor` seul : `writeBack`/`emitWriteBack` ne lisent que des refs.
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
      if (writeBack.cancelPending()) {
        emitWriteBack(editor, (json, text) => prevOnUpdateRef.current(json, text));
      }
      // Reset per-note UI state that would otherwise leak across notes
      // now that we no longer force-remount via a `key` prop. (Les commentaires
      // ne sont plus de l'état d'écran : ils suivent la note elle-même.)
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
      // A hint popover left open would now name a mention from the note we
      // just left, and its "Ignore" would land on the wrong note.
      setPotentialMenu(null);
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
    // `writeBack`/`emitWriteBack` omis aussi : le premier est stable, le
    // second ne lit que des refs.
  }, [note.id, onUpdate, editor]);

  // Sync content when note changes — including content mutations from
  // outside the editor (e.g. restoring a previous version through the
  // version-history viewer dispatches updateNoteContent, which must
  // reach this editor instance). Logic extracted to syncEditorContent
  // so the round-trip-short-circuit is unit-tested in isolation
  // (see noteEditorSync.test.ts).
  useEffect(() => {
    if (collabActive) {
      // En session vivante, le CRDT est la source du document — mais c'est
      // aussi par ici que passe une RESTAURATION DE VERSION. On ne coupe donc
      // que l'écho de notre propre retour au stockage ; une écriture externe,
      // elle, entre dans le partagé et se propage aux autres appareils.
      const session = collabSessionRef.current;
      let sessionContent: string | null = null;
      try {
        sessionContent = session ? session.getContentJSON() : null;
      } catch {
        sessionContent = null;
      }
      if (
        !isExternalNoteWrite({
          stored: note.content,
          lastWritten: lastSyncedContentRef.current,
          sessionContent,
        })
      ) {
        return;
      }
    }
    syncEditorContent(editor, note.content, lastSyncedContentRef);
    // Le repère « rien n'a bougé » : la forme que l'éditeur donne à ce qu'il
    // vient de recevoir (voir editorCanonicalRef).
    try {
      editorCanonicalRef.current = editor ? JSON.stringify(editor.getJSON()) : null;
    } catch {
      editorCanonicalRef.current = null;
    }
    // Une écriture externe versée dans le partagé : il vaut désormais ce
    // magasin-là, et le dit.
    if (collabActive) stampSharedDoc(collabSessionRef.current, note.updatedAt);
  }, [note.id, note.content, note.updatedAt, editor, collabActive]);

  /**
   * BALAYAGE DES MARQUES ORPHELINES — la dette de l'ancien bogue. Le texte des
   * commentaires n'ayant jamais été persisté, toute marque antérieure à la
   * réparation pointe dans le vide. Une fois par note ouverte : si des marques
   * sans texte subsistent, on les retire, ce qui repasse par onUpdate et
   * persiste le document nettoyé.
   *
   * Déclaré APRÈS la synchronisation du contenu, et gardé par `note.id` : au
   * changement de note, l'éditeur porte encore l'ANCIEN document pendant un
   * rendu — balayer à cet instant comparerait le doc sortant aux commentaires
   * entrants et mutilerait la nouvelle note à l'écriture suivante.
   */
  const orphanSweptRef = useRef<string | null>(null);
  useEffect(() => {
    if (!editor || readOnly) return;
    if (orphanSweptRef.current === note.id) return;
    // En session vivante, ne rien écrire avant que le partagé soit tranché :
    // un retrait posé dans un CRDT non semé se propagerait avant le semis.
    if (collabActive && collab.status !== 'synced') return;
    const orphans = findOrphanCommentIds(
      editor.getJSON(),
      note.comments ?? {},
      pendingCommentId ? [pendingCommentId] : []
    );
    orphanSweptRef.current = note.id;
    if (orphans.length === 0) return;
    let chaine = editor.chain();
    for (const id of orphans) chaine = chaine.removeCommentById(id);
    chaine.run();
  });

  // Semis de la session. Deux cas : le document partagé arrive garni et il fait
  // foi, ou il arrive vide ET LE REJEU EST TERMINÉ — on y verse alors le
  // contenu du magasin, une seule fois. Tant que ce n'est pas tranché,
  // `collabReadyRef` reste faux et RIEN ne part vers le magasin : ni un
  // document vide qui effacerait la note, ni un document à moitié synchronisé
  // qui la tronquerait.
  useEffect(() => {
    if (!collabActive || !editor || !collabSession) return undefined;
    if (collabSeededRef.current) return undefined;

    let disposed = false;
    let docLoaded = false;
    let timedOut = false;
    let status = collabSession.status;

    const seed = () => {
      const stored = noteContentRef.current;
      if (!stored) return;
      try {
        editor.commands.setContent(migrateLegacyImageNodes(JSON.parse(stored)).doc, {
          emitUpdate: false,
        });
      } catch {
        editor.commands.setContent(stored, { emitUpdate: false });
      }
      lastSyncedContentRef.current = stored;
    };

    const settle = (decision: 'adopt' | 'seed') => {
      if (collabSeededRef.current) return;
      // Marqué AVANT de semer : le semis fait bouger le document partagé, donc
      // repasse par `evaluate` — la garde doit déjà être posée.
      collabSeededRef.current = true;
      collabReadyRef.current = true;
      // UN DOCUMENT GARNI NE FAIT FOI QUE S'IL N'EST PAS PÉRIMÉ. S'il porte
      // un texte différent de celui du magasin, et que le magasin a été écrit
      // APRÈS ce que le document a vu de lui (sync descendue, restauration),
      // c'est le magasin qu'on verse dans le partagé — l'inverse écrirait la
      // vieille version dans le magasin avec une date neuve, et l'enverrait.
      // Un seul pair remplace (même arbitre que le semis) : le CRDT propage
      // le remplacement aux autres, qui l'auront adopté entre-temps.
      let effective: 'adopt' | 'seed' = decision;
      if (decision === 'adopt') {
        let docContent: string | null = null;
        let seen: unknown = null;
        try {
          docContent = collabSession.getContentJSON();
          seen = collabSession.doc.getMap(SHARED_META_MAP).get(SHARED_STORE_STAMP_KEY);
        } catch {
          docContent = null;
        }
        const verdict = decideStaleSharedDoc({
          storeContent: noteContentRef.current,
          docContent,
          storeUpdatedAt: noteUpdatedAtRef.current,
          docStoreUpdatedAt: typeof seen === 'string' ? seen : null,
        });
        if (verdict === 'replace' && (collabSessionRef.current?.isSeedResponsible() ?? true)) {
          effective = 'seed';
          console.warn('[collab] document partagé périmé — le magasin, plus récent, le remplace');
        }
      }
      if (effective === 'seed') {
        seed();
        stampSharedDoc(collabSession, noteUpdatedAtRef.current);
      } // Rejouer la seule écriture qui a pu être refusée pendant l'attente.
      // Rien à rejouer = rien à écrire : on ne réveille pas le magasin pour
      // réécrire à l'identique ce qu'il contient déjà.
      if (collabMissedWriteRef.current) {
        collabMissedWriteRef.current = false;
        writeBack.schedule(() => {
          emitWriteBack(editor, (json, text) => onUpdateRef.current(json, text));
        }, writeBackDelayMs(true));
      }
    };

    const evaluate = () => {
      if (disposed || collabSeededRef.current) return;
      const decision = decideCollabSettle({
        status,
        fragmentEmpty: collabSession.fragment.length === 0,
        docLoaded,
        timedOut,
      });
      if (decision === 'wait') return;
      // UN SEUL APPAREIL VERSE le contenu du magasin dans une salle vide : deux
      // semeurs, et le CRDT — qui ne perd rien — garde les deux copies, la note
      // apparaît en double. Les autres attendent que le semis leur parvienne.
      // Le délai d'attente reste l'issue de secours : si l'élu ne verse jamais
      // rien, tout le monde finit par semer plutôt que de regarder une note
      // vide. Même arbitre que l'éditeur de coffre (VaultNoteEditor).
      const maySeed = collabSessionRef.current?.isSeedResponsible() ?? true;
      if (decision === 'seed' && !timedOut && !maySeed) return;
      settle(decision);
    };

    // La persistance locale d'abord : un fragment vide parce qu'IndexedDB n'a
    // pas encore répondu n'est pas un fragment vide.
    void collabSession.whenLoaded.then(() => {
      docLoaded = true;
      evaluate();
    });
    // Le rejeu du relais arrive par des mises à jour du document ET par un
    // changement d'état : on écoute les deux plutôt que de sonder.
    const onDocUpdate = () => evaluate();
    collabSession.doc.on('update', onDocUpdate);
    const offStatus = collabSession.onStatus((next) => {
      status = next;
      evaluate();
    });
    const timer = setTimeout(() => {
      timedOut = true;
      evaluate();
    }, COLLAB_READY_TIMEOUT_MS);
    evaluate();

    return () => {
      disposed = true;
      clearTimeout(timer);
      try {
        collabSession.doc.off('update', onDocUpdate);
      } catch {
        /* document déjà détruit */
      }
      try {
        offStatus();
      } catch {
        /* désabonnement déjà fait */
      }
    };
    // `writeBack` est stable, `emitWriteBack` ne lit que des refs.
  }, [collabActive, editor, collabSession]);

  // Expose comment actions to parent via ref (needs editor)
  useEffect(() => {
    if (!commentsHandleRef || !editor) return;
    commentsHandleRef.current = {
      resolveComment: (commentId: string) => {
        dispatch(resolveNoteComment({ noteId: note.id, commentId }));
      },
      deleteComment: (commentId: string) => {
        // La marque d'abord, la donnée ensuite : l'inverse laisserait une
        // marque orpheline le temps d'un rendu.
        editor.commands.removeCommentById(commentId);
        dispatch(deleteNoteComment({ noteId: note.id, commentId }));
      },
    };
  }, [editor, commentsHandleRef, dispatch, note.id]);

  // Auto-resize title textarea
  /**
   * La note est-elle encore VIERGE ?
   *
   * On interroge le document vivant, pas la chaine stockee : une note ouverte
   * puis videe doit reproposer les modeles, et une note qui vient d'etre
   * amorcee par la collaboration ne doit surtout pas les proposer.
   */
  const isBlankNote =
    !readOnly && !!editor && editor.isEmpty && (note.title ?? '').trim().length === 0;

  /**
   * Fenetre des modeles, OUVERTE A LA CREATION.
   *
   * Deux garde-fous, parce qu'une fenetre coute plus cher qu'une bande :
   *  - `isFreshNote` : seule une note qu'on VIENT de creer la declenche.
   *    Rouvrir une vieille note restee vide ne doit pas relancer un dialogue ;
   *  - `wasTemplatesOffered` : une fois par note et par session. Fermer puis
   *    revenir sur la note ne repropose pas.
   */
  const [templateModalOpen, setTemplateModalOpen] = useState(false);

  useEffect(() => {
    if (!isBlankNote) return;
    if (!areTemplateSuggestionsEnabled() || wasTemplatesOffered(note.id)) return;

    const createdAt = Date.parse(note.createdAt ?? '');
    const isFreshNote = Number.isFinite(createdAt) && Date.now() - createdAt < FRESH_NOTE_MS;
    if (!isFreshNote) return;

    markTemplatesOffered(note.id);
    setTemplateModalOpen(true);
  }, [isBlankNote, note.id, note.createdAt]);

  // La langue courante decide du format de date substitue dans le modele.
  const i18nLanguage = useTranslation().i18n.language;

  const applyTemplate = useCallback(
    (template: NoteTemplate) => {
      if (!editor) return;
      const prepared = prepareTemplate(template, { title: note.title, locale: i18nLanguage });
      if (!prepared) return;
      editor.commands.setContent(prepared.doc as never, { emitUpdate: true });
      // Le titre n'est pose que s'il n'y en a pas : jamais ecraser ce que
      // l'utilisateur a deja tape.
      if (!(note.title ?? '').trim()) onTitleChange(prepared.suggestedTitle);
      editor.commands.focus('end');
    },
    [editor, note.title, onTitleChange, i18nLanguage]
  );

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

      // Potential-link hint → offer to link it (or to stop suggesting it).
      // Never navigates: the mention is still plain text, so a click here is a
      // question about THIS note, not a request to leave it. And no
      // `preventDefault` — the hinted word is ORDINARY TEXT, so the click must
      // still place the caret in it; the popover merely appears alongside, and
      // the first keystroke dismisses it.
      const hint = target.closest(`.${POTENTIAL_LINK_CLASS}`) as HTMLElement | null;
      // A drag-select or a double-click that ENDS on a hint is a selection, not
      // a question: only a collapsed caret opens the popover.
      if (hint && window.getSelection()?.isCollapsed !== false) {
        const hintTitle = hint.getAttribute('data-potential-title') || '';
        if (!hintTitle) return;
        const rect = hint.getBoundingClientRect();
        let pos = -1;
        try {
          pos = editor.view.posAtDOM(hint, 0);
        } catch {
          // Detached decoration — `resolveTitleOccurrence` falls back to a scan.
        }
        setPotentialMenu({ x: rect.left, y: rect.bottom + 4, title: hintTitle, pos });
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

  // Carte mentale → éditeur : un titre cliqué dans la carte demande à
  // l'éditeur de s'y rendre, via un drapeau Redux transitoire.
  //
  // LA CONVENTION DE `index` EST LE RANG DU TITRE dans le document, titres
  // vides compris — la même que `extractHeadings` et que le sommaire latéral.
  // Ce n'est PLUS un index dans `doc.content` : la carte mentale voit
  // désormais les titres imbriqués (encadré, colonne, volet repliable), qui
  // n'ont aucun rang de premier niveau. `findHeadingPosByRank` parcourt donc
  // le document en profondeur et compte les titres rencontrés.
  //
  // UNE SEULE FRAME NE SUFFIT PAS. Le clic dans la carte remonte cet éditeur
  // à neuf (bascule de mode de vue) ; les NodeViews React (encadré, mermaid,
  // images, bases inline) se montent APRÈS la première frame et décalent
  // tout ce qui précède le titre : un défilement calculé à ce moment-là
  // atterrit à côté — c'est exactement le cas du titre dans un encadré. On
  // vise donc une première fois, puis on observe la taille du document
  // pendant une courte fenêtre et on re-vise à chaque décalage
  // (`scrollToHeadingStabilizer`, logique pure testée à part). Toute
  // intention de l'utilisateur (molette, toucher, touche, pointeur) abandonne
  // la re-visée : le défilement ne se bat jamais contre lui.
  //
  // Le drapeau est effacé À L'ARRÊT du stabilisateur, pas après la première
  // visée : l'effacer plus tôt ferait rejouer ce même effet (le drapeau est
  // une dépendance), dont le nettoyage démonterait l'observateur à peine posé.
  // Et il l'est aussi au nettoyage, pour qu'un remontage ne rejoue pas le saut.
  useEffect(() => {
    if (!editor || !pendingScrollToHeading) return;
    if (pendingScrollToHeading.noteId !== note.id) return;
    const target = pendingScrollToHeading.index;

    // Premier ancêtre qui défile verticalement : en pratique
    // `.note-editor__body-wrapper`, mais on le CHERCHE plutôt que de le
    // supposer, la même vue vivant dans plusieurs gabarits.
    const findScrollContainer = (from: HTMLElement): HTMLElement | null => {
      let el: HTMLElement | null = from.parentElement;
      while (el && el !== document.body) {
        const overflowY = getComputedStyle(el).overflowY;
        if (overflowY === 'auto' || overflowY === 'scroll') return el;
        el = el.parentElement;
      }
      return null;
    };

    // Viser : amener le haut du titre juste sous le bord du conteneur. On
    // défile CE conteneur et lui seul — `scrollIntoView` natif fait aussi
    // défiler tous les ancêtres, `overflow: hidden` compris, et disloque le
    // gabarit. Retourne `false` si le titre n'est plus dans le DOM.
    const aim = (pmPos: number): boolean => {
      if (editor.isDestroyed || pmPos > editor.state.doc.content.size) return false;
      const { node } = editor.view.domAtPos(pmPos);
      const base = (
        node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement
      ) as HTMLElement | null;
      if (!base || !base.isConnected) return false;
      const headingEl = (base.closest('h1,h2,h3,h4,h5,h6') as HTMLElement | null) ?? base;
      const container = findScrollContainer(headingEl);
      if (!container) {
        headingEl.scrollIntoView({ block: 'start' });
        return true;
      }
      container.scrollTop = computeScrollTopForTarget({
        containerTop: container.getBoundingClientRect().top,
        containerScrollTop: container.scrollTop,
        containerScrollHeight: container.scrollHeight,
        containerClientHeight: container.clientHeight,
        targetTop: headingEl.getBoundingClientRect().top,
      });
      return true;
    };

    let raf = 0;
    let stabilizer: HeadingScrollStabilizer | null = null;
    let observer: ResizeObserver | null = null;
    let deadlineTimer: ReturnType<typeof setTimeout> | null = null;
    // Capture sur `document` : l'intention peut naître hors de l'éditeur (la
    // molette au-dessus de la liste des notes défile aussi la page).
    const intentEvents = ['wheel', 'touchmove', 'keydown', 'pointerdown'] as const;
    const onUserIntent = () => stabilizer?.onUserIntent();
    const teardown = () => {
      observer?.disconnect();
      observer = null;
      if (deadlineTimer !== null) {
        clearTimeout(deadlineTimer);
        deadlineTimer = null;
      }
      for (const ev of intentEvents) document.removeEventListener(ev, onUserIntent, true);
    };

    // Une frame d'attente : ProseMirror doit avoir posé le document avant
    // qu'on résolve des positions dans son DOM.
    raf = requestAnimationFrame(() => {
      raf = 0;
      let pmPos: number | null = null;
      try {
        pmPos = findHeadingPosByRank(editor.state.doc, target);
        if (pmPos !== null) {
          // Le curseur se pose dans le titre ; le défilement, lui, est le
          // nôtre (`scrollIntoView: false`), pour que première visée et
          // re-visées atterrissent au même endroit.
          editor.commands.focus(pmPos, { scrollIntoView: false });
          if (!aim(pmPos)) pmPos = null;
        }
      } catch (err) {
        console.warn('[NoteEditor] scroll-to-heading failed:', err);
        pmPos = null;
      }
      if (pmPos === null) {
        dispatch(clearScrollToHeading());
        return;
      }
      const resolvedPos = pmPos;

      stabilizer = createHeadingScrollStabilizer({
        aim: () => aim(resolvedPos),
        now: () => performance.now(),
        onStop: () => {
          teardown();
          dispatch(clearScrollToHeading());
        },
      });
      // ResizeObserver livre au plus une notification par frame, après la
      // mise en page et avant la peinture : re-viser dans son rappel corrige
      // la position sans qu'une image intermédiaire ne s'affiche.
      if (typeof ResizeObserver !== 'undefined') {
        observer = new ResizeObserver(() => stabilizer?.onLayoutShift());
        observer.observe(editor.view.dom);
      }
      for (const ev of intentEvents) {
        document.addEventListener(ev, onUserIntent, { capture: true, passive: true });
      }
      // Une frame de marge : un décalage livré PILE à l'échéance est encore
      // re-visé, l'horloge du stabilisateur tranchant de toute façon.
      deadlineTimer = setTimeout(
        () => stabilizer?.onDeadline(),
        HEADING_SCROLL_STABILIZE_WINDOW_MS + 16
      );
    });

    return () => {
      if (raf) cancelAnimationFrame(raf);
      // `dispose` passe par `onStop` → capteurs débranchés + drapeau effacé ;
      // déjà arrêté, il ne fait rien et `teardown` (idempotent) suffit.
      stabilizer?.dispose();
      teardown();
    };
  }, [editor, pendingScrollToHeading, note.id, dispatch]);

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
    heading: (
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path d="M6 4v16M18 4v16M6 12h12" />
      </svg>
    ),
  };

  const editorContent = (
    <div
      className={`note-editor ${isFocused ? 'note-editor--focused' : ''} ${readOnly ? 'note-editor--readonly' : ''} ${focusMode ? 'note-editor--focus' : ''}`}
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
        ref={headerRef}
        className={`note-editor__header note-editor__header--${chrome.headerStage} ${
          noteHeaderCollapsed ? 'note-editor__header--collapsed' : ''
        }`}
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
              coverHidden={coverHidden}
              onPickerOpenChange={setCoverPickerOpen}
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
                <SaveStateIndicator note={note} />
                <NoteSyncBadge note={note} variant="full" />
                <NoteSharedBadge noteId={note.id} variant="full" />
                {collabActive && (
                  <CollabPresenceBar participants={collab.participants} status={collab.status} />
                )}
              </div>
              {/* SALLE PLEINE : le relais refuse un pair de plus. Sans cet
                  encart, la frappe en direct s'arrêtait sans que rien ne le
                  dise — ni ce qui continue de fonctionner, ni où est la sortie. */}
              {collabActive && collab.status === 'room-full' && (
                <div className="mt-3">
                  <RoomFullNotice />
                </div>
              )}
            </div>
          </>
        )}
        {noteHeaderCollapsed && (
          <div className="note-editor__header-compact">
            {/*
              `note.icon` est ENCODÉ (emoji | 'lucide:Id' | 'img:data:…') : le rendre
              brut affichait littéralement « lucide:Rocket » et crachait des data URL
              entières. `NoteIcon` décode les trois formes — et depuis que le
              défilement replie l'en-tête tout seul, cette barre est la vue habituelle.
            */}
            <NoteIcon icon={note.icon} size={19} className="note-editor__header-compact-icon" />
            <span className="note-editor__header-compact-title">
              {note.title || t('notes.titlePlaceholder', 'Untitled')}
            </span>
            <span className="note-editor__header-compact-meta">
              {note.wordCount} {t('notes.words', 'words')}
            </span>
            {/*
              L'indicateur d'enregistrement ne vivait QUE dans l'en-tête déployé : le
              repli le faisait disparaître. Tant que le repli était un geste rare c'était
              discutable ; maintenant qu'il est automatique, écrire sans jamais voir
              « enregistré » ne l'est plus.
            */}
            <SaveStateIndicator note={note} />
            <NoteSyncBadge note={note} variant="compact" />
            <NoteSharedBadge noteId={note.id} variant="dot" />
            {collabActive && (
              <CollabPresenceBar
                participants={collab.participants}
                status={collab.status}
                variant="compact"
              />
            )}
          </div>
        )}
        <button
          className="note-editor__header-toggle"
          onClick={() => setHeaderManual(!noteHeaderCollapsed)}
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
      {!readOnly && !toolbarCollapsed && (
        <div className="note-editor__toolbar">
          {/*
            Wrapper interne : c'est LUI qui centre. Poser `justify-content: center`
            sur la barre serait inerte — `.note-editor__toolbar-collapse` portait
            `margin-left: auto`, et une marge auto absorbe tout l'espace libre de
            l'axe principal AVANT que `justify-content` ne s'applique. Le wrapper
            en `flex: 1` centre les groupes et repousse seul le bouton de repli.
          */}
          <div className="note-editor__toolbar-main">
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
                    style={{
                      background: editor.getAttributes('textStyle').color || 'currentColor',
                    }}
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
                {[
                  10, 11, 12, 13, 14, 15, 16, 18, 20, 22, 24, 28, 32, 36, 40, 48, 56, 64, 72, 96,
                ].map((s) => (
                  <option key={s} value={`${s}px`}>
                    {s}
                  </option>
                ))}
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
                <option
                  value={FONT_FAMILY_MAP[styleSettings.fontFamily] || styleSettings.fontFamily}
                >
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
                // `toggleBlockquote` seul est un no-op silencieux quand le caret
                // est dans une puce (`listItem` n'accepte pas d'être enveloppé) :
                // le bouton semblait mort. `applyOutsideList` sort la ligne de la
                // liste d'abord, comme le fait déjà « /quote » du menu slash.
                onClick={() =>
                  applyOutsideList(
                    editor,
                    () => editor.can().toggleBlockquote(),
                    () => editor.chain().focus().toggleBlockquote().run()
                  )
                }
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
              {/* Partage vers un coffre — autoportant, nul hors nuage (NoteShareButton). */}
              <NoteShareButton noteId={note.id} title={note.title} content={note.content} />
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
                    saveStyleSettings(merged);
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
          <button
            onClick={toggleToolbarCollapsed}
            className="note-editor__toolbar-btn note-editor__toolbar-collapse"
            aria-label={t('notes.hideToolbar', 'Hide toolbar')}
            title={t('notes.hideToolbar', 'Hide toolbar')}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
            </svg>
          </button>
        </div>
      )}
      {!readOnly && toolbarCollapsed && (
        <button
          onClick={toggleToolbarCollapsed}
          className="note-editor__toolbar-expand"
          aria-label={t('notes.showToolbar', 'Show toolbar')}
          title={t('notes.showToolbar', 'Show toolbar')}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
          </svg>
        </button>
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
                dispatch(
                  upsertNoteComment({
                    noteId: note.id,
                    comment: {
                      id: pendingCommentId,
                      text: commentInputValue.trim(),
                      // Le nom du profil, pas « You » : un commentaire est signé
                      // pour être lu par quelqu'un d'autre, un jour, ailleurs.
                      author: authorName,
                      createdAt: new Date().toISOString(),
                      resolved: false,
                    },
                  })
                );
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
                dispatch(
                  upsertNoteComment({
                    noteId: note.id,
                    comment: {
                      id: pendingCommentId,
                      text: commentInputValue.trim(),
                      // Le nom du profil, pas « You » : un commentaire est signé
                      // pour être lu par quelqu'un d'autre, un jour, ailleurs.
                      author: authorName,
                      createdAt: new Date().toISOString(),
                      resolved: false,
                    },
                  })
                );
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

      {/* Modeles proposes A LA CREATION (cf. TemplatePickerModal) */}
      <TemplatePickerModal
        isOpen={templateModalOpen}
        onApply={(template) => {
          applyTemplate(template);
          setTemplateModalOpen(false);
        }}
        onClose={() => setTemplateModalOpen(false)}
      />

      {/* Editor content + Drawing overlay */}
      <div
        className="note-editor__body-wrapper"
        ref={editorBodyRef}
        onContextMenu={(e) => {
          if (!editor) return;
          // Resolve the click coords to a ProseMirror position so we know
          // which block was clicked. posAtCoords returns null when the
          // user right-clicked outside the editor content (margins, etc).
          const coords = editor.view.posAtCoords({ left: e.clientX, top: e.clientY });
          if (!coords) return;
          const $pos = editor.state.doc.resolve(coords.pos);
          // Walk up to find a paragraph or heading. If neither is in the
          // ancestor chain (e.g. click landed on a code block / table / a
          // node we don't support yet), fall through to the native menu.
          let blockPos: number | null = null;
          for (let d = $pos.depth; d > 0; d--) {
            const node = $pos.node(d);
            if (node.type.name === 'paragraph' || node.type.name === 'heading') {
              blockPos = $pos.before(d);
              break;
            }
          }
          if (blockPos === null) return;
          e.preventDefault();
          setBlockLinkMenu({ x: e.clientX, y: e.clientY, pos: blockPos });
        }}
      >
        <EditorContent editor={editor} className="note-editor__body" />
        <DrawingOverlay
          strokes={note.drawingStrokes}
          isActive={isDrawingMode}
          onStrokesChange={handleDrawingStrokesChange}
          editorBodyRef={editorBodyRef}
        />
      </div>

      {blockLinkMenu && (
        <BlockLinkContextMenu
          x={blockLinkMenu.x}
          y={blockLinkMenu.y}
          onClose={() => setBlockLinkMenu(null)}
          onCopy={() => {
            if (!editor) return;
            // Move the selection into the clicked block so assignBlockIdHere
            // operates on the right node, then run the command. The command
            // writes a fresh id only if the block doesn't already carry one.
            editor
              .chain()
              .focus()
              .setTextSelection(blockLinkMenu.pos + 1)
              .assignBlockIdHere((id: string) => {
                const link = `![[${note.title || 'Untitled'}^${id}]]`;
                navigator.clipboard
                  .writeText(link)
                  .then(() => notifySuccess(`Lien copié : ${link}`))
                  .catch(() => notifyError('Impossible de copier dans le presse-papier'));
              })
              .run();
          }}
        />
      )}

      {potentialMenu && (
        <PotentialLinkMenu
          x={potentialMenu.x}
          y={potentialMenu.y}
          title={potentialMenu.title}
          onClose={closePotentialMenu}
          onLink={() => {
            // Same report as the panel route: the popover's own answer used to
            // be thrown away, so a click that resolved to nothing looked
            // exactly like a click that worked.
            const ok = linkPotentialMention(potentialMenu.title, potentialMenu.pos);
            reportLinkOutcome(ok ? [potentialMenu.title] : [], ok ? [] : [potentialMenu.title]);
            setPotentialMenu(null);
          }}
          onIgnore={() => {
            // Silences this title in THIS note only — the same mention
            // elsewhere is still worth suggesting.
            ignorePotentialLink(note.id, potentialMenu.title);
            setPotentialMenu(null);
          }}
        />
      )}

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
      {wikiMenuVisible &&
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
              <div className="wiki-link-menu__modes" role="tablist">
                {(['link', 'embed', 'date'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    role="tab"
                    aria-selected={wikiMode === m}
                    className={`wiki-link-menu__mode${
                      wikiMode === m ? ' wiki-link-menu__mode--active' : ''
                    }`}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      setWikiMode(m);
                      setWikiSelected(0);
                    }}
                  >
                    {m === 'link'
                      ? t('notes.mode.link', 'Lien')
                      : m === 'embed'
                        ? t('notes.mode.embed', 'Embed')
                        : t('notes.mode.date', 'Date')}
                  </button>
                ))}
              </div>
              {wikiSuggestions.map((item, i) => (
                <button
                  key={`${i}-${item.type}-${item.label}`}
                  className={`wiki-link-menu__item ${i === wikiSelected ? 'is-selected' : ''}`}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    insertWikiLink(item.insert, item.dateValue, item.embed);
                  }}
                  onMouseEnter={() => setWikiSelected(i)}
                >
                  <span className={`wiki-link-menu__type wiki-link-menu__type--${item.type}`}>
                    {typeIcons[item.type]}
                  </span>
                  <span className="wiki-link-menu__text">
                    <span className="wiki-link-menu__label">{item.label}</span>
                    {item.path && <span className="wiki-link-menu__path">{item.path}</span>}
                  </span>
                  {item.dateValue && (
                    <span className="wiki-link-menu__date-preview">{item.dateValue}</span>
                  )}
                  <span className="wiki-link-menu__badge">{item.type}</span>
                </button>
              ))}
              <div className="wiki-link-menu__hint">
                {t(
                  'notes.wikiLinkHint',
                  '\u2191\u2193 navigate \u00b7 Enter select \u00b7 Tab change mode \u00b7 Esc close'
                )}
              </div>
            </div>
          );
        })()}
      {canUseTeamVaults && (
        <VaultNotePicker
          isOpen={vaultPickerOpen}
          onClose={() => setVaultPickerOpen(false)}
          onPick={(p) =>
            editor
              ?.chain()
              .focus()
              .insertTransclusion({
                noteId: `vault:${p.vaultId}:${p.itemId}`,
                noteTitle: p.title,
              })
              .run()
          }
        />
      )}
    </div>
  );

  return editorContent;
};

// ==================== Enveloppe « édition vivante » ====================

/**
 * Seule cette enveloppe ouvre une session. Elle remonte l'éditeur quand la
 * session apparaît ou change de note : les extensions Yjs se lient à un
 * fragment donné à la création et ne se remplacent pas à chaud.
 *
 * Drapeau éteint (le défaut), lecture seule ou aperçu : la clé reste `local`,
 * l'éditeur n'est jamais remonté et le comportement est celui d'avant.
 *
 * LE DÉFAUT QUE L'ATTELAGE `noteFige`/`clé` FERME — il fabriquait des notes
 * fantômes qui recopiaient la frappe. `useCollabSession` rend un ÉTAT : la
 * session change UN RENDU APRÈS `noteId`. La clé de remontage, elle, était
 * bâtie sur `props.note.id`, qui change TOUT DE SUITE. Au premier rendu après
 * un changement de note, l'éditeur était donc remonté pour la note B en se
 * liant au fragment Yjs de la note A — et `useEditor` n'ayant pas de tableau de
 * dépendances, ce lien devenait DÉFINITIF. À partir de là, le retour au
 * stockage écrivait dans la note B le `plainText` du document de la note A
 * (`computeWriteBack` prend le texte de l'ÉDITEUR et le document du CRDT) : la
 * note B — souvent fraîche, donc « Sans titre » — recopiait mot à mot ce qui
 * était tapé en collaboration, et l'effet de synchronisation de contenu
 * poussait en prime le contenu de B dans le CRDT de A.
 *
 * LA RÈGLE ICI : la note MONTRÉE n'avance qu'avec la session, et la clé est
 * bâtie sur la note DE LA SESSION. Les deux ne peuvent donc plus se contredire,
 * et le rendu d'attente ne remonte rien (clé et note strictement inchangées).
 */
export const NoteEditor: React.FC<NoteEditorProps> = React.memo(function NoteEditor(props) {
  const { t } = useTranslation();
  const liveCollabEnabled = useLiveCollabEnabled();

  const reduxProfileId = useSelector(
    (state: RootState) =>
      state.profiles?.manifest?.activeProfileId || state.profiles?.activeProfileId || ''
  );
  const profileName = useSelector((state: RootState) => {
    const manifest = state.profiles?.manifest;
    const id = manifest?.activeProfileId;
    if (!manifest?.profiles || !id) return '';
    return manifest.profiles.find((p) => p.id === id)?.name || '';
  });
  const profileId = reduxProfileId || getActiveProfileId() || null;

  const displayName = composeDisplayName(
    profileName,
    isWebPlatform()
      ? t('notes.collab.platformWeb', 'Web')
      : t('notes.collab.platformDesktop', 'Bureau')
  );

  const collab = useCollabSession({
    noteId: props.note.id,
    profileId,
    enabled: liveCollabEnabled && !props.readOnly,
    displayName,
  });

  // Une session qui ne désigne pas la note demandée est une session PÉRIMÉE
  // D'UN RENDU : on gèle TOUT ce qui descend (la note comme les rappels, qui
  // sont déjà liés à la note suivante) jusqu'à ce que sa session arrive. Sans
  // session du tout (drapeau éteint, création refusée), rien à attendre.
  const stale = isStaleCollabSession(collab.session?.noteId, props.note.id);
  const shownPropsRef = useRef(props);
  if (!stale) shownPropsRef.current = props;

  return (
    <NoteEditorInner
      key={collab.session ? `collab:${collab.session.noteId}` : 'local'}
      authorName={profileName || t('notes.commentAuthorMe', 'Moi')}
      {...shownPropsRef.current}
      collab={collab}
    />
  );
});

export default NoteEditor;
