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
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '../../../i18n/config';
import { applyOutsideList, isOutsideList } from './listAwareCommands';
import { freshProjectBoardBlocks } from './insertProjectBoard';
import {
  SLASH_ALL_SECTION,
  SLASH_GROUP_FALLBACK_LABELS,
  SLASH_RECENT_SECTION,
  buildSlashSections,
  sortSlashItems,
} from './slashCommandSort';
import type { SlashGroup, SlashRailKey } from './slashCommandSort';
import { getRecentSlashCommands } from './slashCommandRecents';

// ==================== Command Definitions ====================

export interface SlashCommandItem {
  id: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  /** Section du menu (voir `SLASH_GROUP_ORDER`). */
  group: SlashGroup;
  aliases?: string[];
  /**
   * Rend `false` quand la commande n'a RIEN pu faire ici. Le texte tapé
   * (« /quote ») ayant déjà été effacé par l'extension avant l'appel, c'est ce
   * booléen qui lui permet de le remettre et de prévenir l'utilisateur plutôt
   * que de laisser un échec silencieux. Une action à effet différé (sélecteur
   * de fichier, évènement vers un composant React) rend `true` : elle a bien
   * démarré, son résultat viendra plus tard.
   */
  action: (editor: any) => boolean;
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
const H4Icon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <path d="M4 12h8M4 18V6M12 18V6" />
    <path d="M18 10v4h4M21 10v8" />
  </svg>
);
const BoldIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <path d="M6 4h7a4 4 0 010 8H6zM6 12h8a4 4 0 010 8H6z" />
  </svg>
);
const ItalicIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <line x1="19" y1="4" x2="10" y2="4" />
    <line x1="14" y1="20" x2="5" y2="20" />
    <line x1="15" y1="4" x2="9" y2="20" />
  </svg>
);
const UnderlineIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <path d="M6 4v6a6 6 0 0012 0V4" />
    <line x1="4" y1="20" x2="20" y2="20" />
  </svg>
);
const StrikeIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <line x1="4" y1="12" x2="20" y2="12" />
    <path d="M16 6.5C15 5 13.6 4.5 12 4.5 9.5 4.5 8 5.7 8 7.5c0 1.6 1.2 2.6 3.5 3.2M8 17c1 1.4 2.4 2 4 2 2.6 0 4.2-1.2 4.2-3 0-.6-.1-1.1-.4-1.5" />
  </svg>
);
const InlineCodeIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <polyline points="15,16 19,12 15,8" />
    <polyline points="9,8 5,12 9,16" />
  </svg>
);
const HighlightIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <path d="M13 3l6 6-7 7H8l-2-2z" />
    <line x1="4" y1="21" x2="20" y2="21" />
  </svg>
);
const ClearFormatIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <path d="M4 7V4h13v3M10 20h5M12 4l-2 16" />
    <line x1="16" y1="14" x2="21" y2="19" />
    <line x1="21" y1="14" x2="16" y2="19" />
  </svg>
);
const ProjectBoardIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <line x1="9" y1="3" x2="9" y2="21" />
    <line x1="15" y1="3" x2="15" y2="21" />
    <line x1="3" y1="9" x2="9" y2="9" />
    <line x1="9" y1="14" x2="15" y2="14" />
  </svg>
);
const LinkNoteIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <path d="M8 4H5v16h3M16 4h3v16h-3" />
    <line x1="10" y1="12" x2="14" y2="12" />
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

const VaultEmbedIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <rect x="3" y="11" width="18" height="10" rx="2" />
    <path d="M7 11V7a5 5 0 0110 0v4" />
  </svg>
);

// Plan gate for the "Vault note" slash command (E3-8c). NoteEditor flips this from
// selectCanUseTeamVaults so a free account never sees a command it cannot use.
let vaultEmbedEnabled = false;
export function setVaultEmbedEnabled(enabled: boolean): void {
  vaultEmbedEnabled = enabled;
}
export function isVaultEmbedEnabled(): boolean {
  return vaultEmbedEnabled;
}

// `applyOutsideList` / `isOutsideList` vivent dans `listAwareCommands.ts` :
// la barre d'outils et le menu de la poignée de bloc en ont besoin sans
// pouvoir importer ce composant React (cycle + arbre React dans un plugin PM).

// Résolution i18n à l'usage (jamais figée au chargement du module) : les
// label/description anglais de SLASH_COMMANDS servent de fallback.
export function getSlashLabel(item: SlashCommandItem): string {
  return i18n.t(`notes.slash.${item.id}.label`, { defaultValue: item.label });
}

export function getSlashDescription(item: SlashCommandItem): string {
  return i18n.t(`notes.slash.${item.id}.description`, { defaultValue: item.description });
}

export const SLASH_COMMANDS: SlashCommandItem[] = [
  {
    id: 'text',
    group: 'basic',
    label: 'Text',
    description: 'Plain text paragraph',
    icon: <TextIcon />,
    aliases: ['paragraph', 'p'],
    // `setParagraph` rend FALSE quand le bloc est déjà un paragraphe (sonde :
    // `setBlockType` sort en `applicable = false` s'il n'y a rien à changer).
    // C'est un succès du point de vue de l'utilisateur — sans ce garde-fou,
    // « /text » dans un paragraphe déclencherait le message « indisponible ici ».
    action: (editor) => editor.chain().focus().setParagraph().run() || editor.isActive('paragraph'),
  },
  {
    id: 'h1',
    group: 'basic',
    label: 'Heading 1',
    description: 'Large section heading',
    icon: <H1Icon />,
    aliases: ['h1', 'title', 'heading'],
    action: (editor) =>
      applyOutsideList(
        editor,
        () => editor.can().toggleHeading({ level: 1 }),
        () => editor.chain().focus().toggleHeading({ level: 1 }).run()
      ),
  },
  {
    id: 'h2',
    group: 'basic',
    label: 'Heading 2',
    description: 'Medium section heading',
    icon: <H2Icon />,
    aliases: ['h2', 'subtitle'],
    action: (editor) =>
      applyOutsideList(
        editor,
        () => editor.can().toggleHeading({ level: 2 }),
        () => editor.chain().focus().toggleHeading({ level: 2 }).run()
      ),
  },
  {
    id: 'h3',
    group: 'basic',
    label: 'Heading 3',
    description: 'Small section heading',
    icon: <H3Icon />,
    aliases: ['h3', 'subheading'],
    action: (editor) =>
      applyOutsideList(
        editor,
        () => editor.can().toggleHeading({ level: 3 }),
        () => editor.chain().focus().toggleHeading({ level: 3 }).run()
      ),
  },
  {
    id: 'h4',
    label: 'Heading 4',
    description: 'Smallest section heading',
    icon: <H4Icon />,
    group: 'basic',
    aliases: ['h4', 'heading 4', 'sous-titre'],
    action: (editor) =>
      applyOutsideList(
        editor,
        () => editor.can().toggleHeading({ level: 4 }),
        () => editor.chain().focus().toggleHeading({ level: 4 }).run()
      ),
  },
  {
    id: 'bullet-list',
    group: 'basic',
    label: 'Bullet List',
    description: 'Unordered list with bullets',
    icon: <BulletListIcon />,
    aliases: ['ul', 'unordered', 'list', 'bullet'],
    action: (editor) => editor.chain().focus().toggleBulletList().run(),
  },
  {
    id: 'ordered-list',
    group: 'basic',
    label: 'Numbered List',
    description: 'Ordered list with numbers',
    icon: <NumberListIcon />,
    aliases: ['ol', 'ordered', 'numbered'],
    action: (editor) => editor.chain().focus().toggleOrderedList().run(),
  },
  {
    id: 'task-list',
    group: 'basic',
    label: 'Task List',
    description: 'Checklist with checkboxes',
    icon: <TaskListIcon />,
    aliases: ['todo', 'checklist', 'checkbox', 'task'],
    action: (editor) => editor.chain().focus().toggleTaskList().run(),
  },
  {
    id: 'blockquote',
    group: 'basic',
    label: 'Quote',
    description: 'Block quotation',
    icon: <QuoteIcon />,
    aliases: ['quote', 'blockquote', 'citation'],
    action: (editor) =>
      applyOutsideList(
        editor,
        () => editor.can().toggleBlockquote(),
        () => editor.chain().focus().toggleBlockquote().run()
      ),
  },
  {
    id: 'code-block',
    group: 'basic',
    label: 'Code Block',
    description: 'Syntax-highlighted code',
    icon: <CodeBlockIcon />,
    aliases: ['code', 'codeblock', 'pre', 'snippet'],
    action: (editor) =>
      applyOutsideList(
        editor,
        () => editor.can().toggleCodeBlock(),
        () => editor.chain().focus().toggleCodeBlock().run()
      ),
  },
  {
    id: 'table',
    group: 'layout',
    label: 'Table',
    description: '3×3 table with header',
    icon: <TableIcon />,
    aliases: ['table', 'grid'],
    action: (editor) =>
      applyOutsideList(
        editor,
        () => isOutsideList(editor),
        () => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
      ),
  },
  {
    id: 'divider',
    group: 'basic',
    label: 'Divider',
    description: 'Horizontal separator line',
    icon: <DividerIcon />,
    aliases: ['hr', 'divider', 'separator', 'line'],
    action: (editor) => editor.chain().focus().setHorizontalRule().run(),
  },
  {
    id: 'callout-info',
    group: 'callout',
    label: 'Callout',
    description: 'Info callout box',
    icon: <CalloutIcon />,
    aliases: ['callout', 'info', 'alert', 'box', 'encadre', 'encadré'],
    action: (editor) => editor.chain().focus().insertCallout('info').run(),
  },
  {
    id: 'callout-warning',
    group: 'callout',
    label: 'Warning',
    description: 'Warning callout box',
    icon: <CalloutIcon />,
    aliases: ['warning', 'attention', 'avertissement'],
    action: (editor) => editor.chain().focus().insertCallout('warning').run(),
  },
  {
    id: 'callout-success',
    group: 'callout',
    label: 'Success',
    description: 'Success callout box',
    icon: <CalloutIcon />,
    aliases: ['success', 'done', 'réussite'],
    action: (editor) => editor.chain().focus().insertCallout('success').run(),
  },
  {
    id: 'callout-error',
    label: 'Error',
    description: 'Error callout box',
    icon: <CalloutIcon />,
    group: 'callout',
    aliases: ['error', 'erreur', 'danger', 'echec'],
    action: (editor) => editor.chain().focus().insertCallout('error').run(),
  },
  {
    id: 'callout-tip',
    group: 'callout',
    label: 'Tip',
    description: 'Tip callout box',
    icon: <CalloutIcon />,
    aliases: ['tip', 'astuce', 'hint', 'conseil'],
    action: (editor) => editor.chain().focus().insertCallout('tip').run(),
  },
  {
    id: 'callout-important',
    group: 'callout',
    label: 'Important',
    description: 'Important callout box',
    icon: <CalloutIcon />,
    aliases: ['important', 'critical', 'crucial'],
    action: (editor) => editor.chain().focus().insertCallout('important').run(),
  },
  {
    id: 'callout-note',
    group: 'callout',
    label: 'Note Box',
    description: 'Note callout box',
    icon: <CalloutIcon />,
    aliases: ['notebox', 'memo', 'remarque'],
    action: (editor) => editor.chain().focus().insertCallout('note').run(),
  },
  {
    id: 'callout-bug',
    group: 'callout',
    label: 'Bug',
    description: 'Bug report callout',
    icon: <CalloutIcon />,
    aliases: ['bug', 'issue', 'problème'],
    action: (editor) => editor.chain().focus().insertCallout('bug').run(),
  },
  {
    id: 'callout-example',
    group: 'callout',
    label: 'Example',
    description: 'Example callout box',
    icon: <CalloutIcon />,
    aliases: ['example', 'exemple', 'demo'],
    action: (editor) => editor.chain().focus().insertCallout('example').run(),
  },
  {
    id: 'callout-quote',
    group: 'callout',
    label: 'Quote Box',
    description: 'Styled quote callout',
    icon: <CalloutIcon />,
    aliases: ['quotebox', 'citation'],
    action: (editor) => editor.chain().focus().insertCallout('quote').run(),
  },
  // ---- New block types ----
  {
    id: 'toggle',
    group: 'layout',
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
    id: 'project-board',
    label: 'Project board',
    description: 'Goal, kanban of tasks, decisions and risks',
    icon: <ProjectBoardIcon />,
    group: 'advanced',
    aliases: ['project', 'projet', 'kanban', 'board', 'gestion de projet', 'suivi', 'tableau'],
    // Les memes blocs que le modele « Projet », identite de base re-frappee :
    // deux insertions ne peuvent pas produire deux bases jumelles.
    action: (editor) => editor.chain().focus().insertContent(freshProjectBoardBlocks()).run(),
  },
  {
    id: 'math',
    group: 'advanced',
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
    group: 'advanced',
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
    group: 'layout',
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
    group: 'layout',
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
    id: '4-columns',
    label: '4 Columns',
    description: 'Four-column layout',
    icon: (
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
      >
        <rect x="2" y="3" width="4" height="18" rx="1" />
        <rect x="7" y="3" width="4" height="18" rx="1" />
        <rect x="12" y="3" width="4" height="18" rx="1" />
        <rect x="17" y="3" width="4" height="18" rx="1" />
      </svg>
    ),
    group: 'layout',
    aliases: ['4col', 'four-columns', 'quatre colonnes'],
    action: (editor) => editor.chain().focus().insertColumns(4).run(),
  },
  {
    id: 'toc',
    group: 'layout',
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
    group: 'advanced',
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
    group: 'advanced',
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
    group: 'advanced',
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
    id: 'inline-database',
    group: 'advanced',
    label: 'Database',
    description: 'Table with typed properties',
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
        <line x1="3" y1="9" x2="21" y2="9" />
        <line x1="3" y1="15" x2="21" y2="15" />
        <line x1="10" y1="3" x2="10" y2="21" />
      </svg>
    ),
    aliases: ['database', 'base de données', 'bdd', 'table', 'db', 'board'],
    action: (editor) => editor.chain().focus().insertInlineDatabase().run(),
  },
  {
    id: 'bookmark',
    group: 'media',
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
    id: 'embed-url',
    group: 'media',
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
    group: 'advanced',
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
    group: 'advanced',
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
    group: 'media',
    label: 'Image',
    description: 'Embed an image from your files',
    icon: <ImageIcon />,
    aliases: ['image', 'img', 'photo', 'picture'],
    // Effet différé : le sélecteur de fichier s'ouvre, l'insertion arrive plus
    // tard (ou jamais si l'utilisateur annule). La commande a bien démarré,
    // donc `true` — remettre « /image » ici serait un faux échec.
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
      return true;
    },
  },
  {
    id: 'file',
    group: 'media',
    label: 'File',
    description: 'Attach a document or file',
    icon: <FileEmbedIcon />,
    aliases: ['file', 'attach', 'attachment', 'document'],
    // Effet différé, même raison que pour « /image ».
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
      return true;
    },
  },
  {
    id: 'sub-page',
    group: 'pages',
    label: 'Page',
    description: 'Create a sub-page inside this note',
    icon: <PageIcon />,
    aliases: ['page', 'sous-page', 'subpage', 'child', 'new page'],
    action: (editor) => editor.chain().focus().insertSubPage().run(),
  },
  {
    id: 'link-note',
    label: 'Link to note',
    description: 'Reference another note ([[note]])',
    icon: <LinkNoteIcon />,
    group: 'pages',
    aliases: ['link', 'lien', 'wikilink', 'reference', 'mention'],
    // Meme levier que l'integration d'une note, a un caractere pres : on pose
    // le declencheur, et l'autocompletion de liens wiki prend la suite.
    action: (editor) => editor.chain().focus().insertContent('[[').run(),
  },
  {
    id: 'embed-note',
    group: 'pages',
    label: 'Embed note',
    description: 'Embed another note inline (![[note]])',
    icon: <PageIcon />,
    aliases: ['embed', 'transclude', 'transclusion', 'inline', 'include'],
    // Insert the `![[` trigger so the existing wiki-link autocomplete picks
    // up from there — the user selects a note, the autocomplete inserts
    // `![[Title]]` and the transclusion InputRule rewrites it into the
    // node. Avoids building a second picker UI for a one-character delta.
    action: (editor) => editor.chain().focus().insertContent('![[').run(),
  },
  {
    id: 'vault-embed',
    group: 'pages',
    label: 'Vault note',
    description: 'Embed a note from a team vault',
    icon: <VaultEmbedIcon />,
    aliases: ['vault', 'team', 'coffre', 'embed vault'],
    // The picker is React; a slash action runs outside it, so we signal the
    // NoteEditor host via a window event to open VaultNotePicker. Hidden from the
    // menu for non-Teams users (see the items() filter in slashCommandExtension).
    // Effet différé : l'évènement part, le sélecteur s'ouvre au tour suivant.
    action: () => {
      window.dispatchEvent(new CustomEvent('filarr:embed-vault-note'));
      return true;
    },
  },
  // ---- Format (marques de texte) ----
  // Sans selection, TipTap pose une marque EN ATTENTE : le texte tape juste
  // apres sort deja mis en forme. C'est le comportement de Notion, et c'est
  // pour ca que ces commandes rendent `true` meme sur un bloc vide.
  {
    id: 'bold',
    label: 'Bold',
    description: 'Bold text',
    icon: <BoldIcon />,
    group: 'format',
    aliases: ['bold', 'gras', 'strong', 'b'],
    action: (editor) => editor.chain().focus().toggleBold().run(),
  },
  {
    id: 'italic',
    label: 'Italic',
    description: 'Italic text',
    icon: <ItalicIcon />,
    group: 'format',
    aliases: ['italic', 'italique', 'em', 'i'],
    action: (editor) => editor.chain().focus().toggleItalic().run(),
  },
  {
    id: 'underline',
    label: 'Underline',
    description: 'Underlined text',
    icon: <UnderlineIcon />,
    group: 'format',
    aliases: ['underline', 'souligne', 'u'],
    action: (editor) => editor.chain().focus().toggleUnderline().run(),
  },
  {
    id: 'strike',
    label: 'Strikethrough',
    description: 'Crossed-out text',
    icon: <StrikeIcon />,
    group: 'format',
    aliases: ['strike', 'barre', 'strikethrough', 's'],
    action: (editor) => editor.chain().focus().toggleStrike().run(),
  },
  {
    id: 'inline-code',
    label: 'Inline Code',
    description: 'Monospaced code inside a line',
    icon: <InlineCodeIcon />,
    group: 'format',
    aliases: ['inline-code', 'code inline', 'monospace', 'tt'],
    action: (editor) => editor.chain().focus().toggleCode().run(),
  },
  {
    id: 'highlight',
    label: 'Highlight',
    description: 'Highlighted text',
    icon: <HighlightIcon />,
    group: 'format',
    aliases: ['highlight', 'surligner', 'surlignage', 'marker', 'mark'],
    action: (editor) => editor.chain().focus().toggleHighlight().run(),
  },
  {
    id: 'clear-format',
    label: 'Clear formatting',
    description: 'Strip marks and block styles',
    icon: <ClearFormatIcon />,
    group: 'format',
    aliases: ['clear', 'effacer', 'reset', 'plain', 'nettoyer'],
    action: (editor) => editor.chain().focus().unsetAllMarks().clearNodes().run(),
  },
];

// ==================== Menu Component ====================

export interface SlashCommandMenuRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

interface SlashCommandMenuProps {
  items: SlashCommandItem[];
  command: (item: SlashCommandItem) => void;
  /** Texte tapé après le « / » (vide = catalogue). */
  query?: string;
}

/** Libellé traduit d'une entrée du rail. */
function getSectionLabel(key: SlashRailKey): string {
  if (key === SLASH_ALL_SECTION) {
    return i18n.t('notes.slash.group.all', { defaultValue: 'All results' });
  }
  if (key === SLASH_RECENT_SECTION) {
    return i18n.t('notes.slash.group.recent', { defaultValue: 'Recently used' });
  }
  return i18n.t(`notes.slash.group.${key}`, {
    defaultValue: SLASH_GROUP_FALLBACK_LABELS[key],
  });
}

/** Position canonique d'une commande, pour départager à score égal. */
const DECLARATION_ORDER = new Map(SLASH_COMMANDS.map((item, index) => [item.id, index]));

export const SlashCommandMenu = forwardRef<SlashCommandMenuRef, SlashCommandMenuProps>(
  ({ items, command, query = '' }, ref) => {
    const { t } = useTranslation();
    const [selectedIndex, setSelectedIndex] = useState(0);
    const menuRef = useRef<HTMLDivElement>(null);
    const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

    // Les récents sont lus À L'OUVERTURE et figés pour la durée du menu : les
    // relire à chaque frappe ferait sauter une ligne sous le curseur au moment
    // même où l'utilisateur vise, et la commande en cours n'est de toute façon
    // enregistrée qu'une fois appliquée.
    const [recents] = useState<string[]>(() => getRecentSlashCommands());

    // `null` = « laisse le menu choisir » (première catégorie, ou « Tout »
    // pendant une recherche). Dès que l'utilisateur clique ou navigue au
    // clavier, son choix prime — jusqu'au changement de régime.
    const [pickedKey, setPickedKey] = useState<SlashRailKey | null>(null);

    const searching = query.trim().length > 0;

    const { sorted, sections } = useMemo(() => {
      const ordered = sortSlashItems(items, query, {
        resolve: (item) => ({
          label: getSlashLabel(item),
          description: getSlashDescription(item),
        }),
        recents,
        order: (item) => DECLARATION_ORDER.get(item.id) ?? 0,
      });
      return { sorted: ordered, sections: buildSlashSections(ordered, query, recents) };
    }, [items, query, recents]);

    const rail = useMemo(() => {
      const entries = sections.map((section) => ({
        key: section.key as SlashRailKey,
        label: getSectionLabel(section.key),
        count: section.items.length,
      }));
      if (!searching) return entries;
      // Pendant une recherche, « Tout » ouvre le classement complet ; les
      // catégories ne sont là que pour resserrer.
      return [
        {
          key: SLASH_ALL_SECTION as SlashRailKey,
          label: getSectionLabel(SLASH_ALL_SECTION),
          count: sorted.length,
        },
        ...entries,
      ];
    }, [sections, searching, sorted.length]);

    // Un choix qui n'existe plus (catégorie vidée par la frappe suivante) ne
    // doit pas laisser le volet vide : on retombe sur la première entrée.
    const activeKey: SlashRailKey | null =
      (pickedKey && rail.some((entry) => entry.key === pickedKey) ? pickedKey : rail[0]?.key) ??
      null;

    const visibleItems = useMemo(() => {
      if (activeKey === null || activeKey === SLASH_ALL_SECTION) return sorted;
      return sections.find((section) => section.key === activeKey)?.items ?? [];
    }, [activeKey, sections, sorted]);

    // Passer de « recherche » à « catalogue » (et retour) change ce que le rail
    // signifie : le choix précédent n'a plus de sens, on repart du défaut.
    useEffect(() => {
      setPickedKey(null);
    }, [searching]);

    // Reset selection when the visible list changes
    useEffect(() => {
      setSelectedIndex(0);
    }, [visibleItems]);

    // Scroll selected item into view
    useEffect(() => {
      itemRefs.current[selectedIndex]?.scrollIntoView({ block: 'nearest' });
    }, [selectedIndex]);

    const selectItem = useCallback(
      (index: number) => {
        const item = visibleItems[index];
        if (item) command(item);
      },
      [visibleItems, command]
    );

    /** Déplacement dans le rail (flèches gauche/droite, Tab). */
    const moveCategory = useCallback(
      (delta: number) => {
        if (rail.length < 2) return;
        const current = rail.findIndex((entry) => entry.key === activeKey);
        const next = (current + delta + rail.length) % rail.length;
        setPickedKey(rail[next].key);
        setSelectedIndex(0);
      },
      [rail, activeKey]
    );

    useImperativeHandle(ref, () => ({
      onKeyDown: ({ event }: { event: KeyboardEvent }) => {
        if (event.key === 'ArrowUp') {
          setSelectedIndex((i) => (i <= 0 ? visibleItems.length - 1 : i - 1));
          return true;
        }
        if (event.key === 'ArrowDown') {
          setSelectedIndex((i) => (i >= visibleItems.length - 1 ? 0 : i + 1));
          return true;
        }
        // Les flèches horizontales ne changent de catégorie QUE dans le
        // catalogue. Pendant une recherche, l'utilisateur est en train
        // d'écrire : lui confisquer gauche/droite l'empêcherait de corriger
        // une faute de frappe. Tab reste disponible dans les deux cas.
        if (event.key === 'ArrowLeft' && !searching) {
          moveCategory(-1);
          return true;
        }
        if (event.key === 'ArrowRight' && !searching) {
          moveCategory(1);
          return true;
        }
        if (event.key === 'Tab') {
          moveCategory(event.shiftKey ? -1 : 1);
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
        <div className="slash-menu slash-menu--empty">
          <div className="slash-menu__empty">
            {t('notes.slash.noResults', { defaultValue: 'No matching commands' })}
          </div>
        </div>
      );
    }

    return (
      <div className="slash-menu" ref={menuRef}>
        <div
          className="slash-menu__rail"
          role="tablist"
          aria-orientation="vertical"
          aria-label={t('notes.slash.categories', { defaultValue: 'Categories' })}
        >
          {rail.map((entry) => (
            <button
              key={entry.key}
              type="button"
              role="tab"
              aria-selected={entry.key === activeKey}
              className={`slash-menu__rail-item ${entry.key === activeKey ? 'is-active' : ''}`}
              // Clic et non survol : le curseur traverse forcément le rail pour
              // atteindre la liste, et un survol actif ferait alors changer la
              // catégorie sous la main de l'utilisateur.
              onClick={() => {
                setPickedKey(entry.key);
                setSelectedIndex(0);
              }}
            >
              <span className="slash-menu__rail-label">{entry.label}</span>
              <span className="slash-menu__rail-count">{entry.count}</span>
            </button>
          ))}
        </div>

        <div
          className="slash-menu__list"
          role="tabpanel"
          aria-label={activeKey ? getSectionLabel(activeKey) : undefined}
        >
          {visibleItems.map((item, index) => (
            <button
              key={item.id}
              type="button"
              ref={(el) => {
                itemRefs.current[index] = el;
              }}
              className={`slash-menu__item ${index === selectedIndex ? 'is-selected' : ''}`}
              onClick={() => selectItem(index)}
              onMouseEnter={() => setSelectedIndex(index)}
            >
              <span className="slash-menu__icon">{item.icon}</span>
              <span className="slash-menu__text">
                <span className="slash-menu__label">{getSlashLabel(item)}</span>
                <span className="slash-menu__desc">{getSlashDescription(item)}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    );
  }
);

SlashCommandMenu.displayName = 'SlashCommandMenu';
