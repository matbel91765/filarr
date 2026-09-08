/**
 * NotesList Component — Filarr Notes
 *
 * Sidebar list of notes with search, sort, and new note actions.
 * Supports grid and list view modes.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState, forwardRef } from 'react';
import { Virtuoso } from 'react-virtuoso';
import { useTranslation } from 'react-i18next';
import { useSelector, useDispatch } from 'react-redux';
import type { RootState, AppDispatch } from '../../../store';
import {
  selectFilteredNotes,
  selectOrphanNoteIds,
  selectVisitHistory,
  selectNote,
  selectAllNotes,
  selectAllNotebooks,
  selectNotebookTree,
  selectTrashedNotes,
  selectSuspectNotes,
  selectConflictResolutions,
  setNotesSearchQuery,
  setNotesSortBy,
  setNotesSortOrder,
  setNotesFilterNotebook,
  setNotesFilterUnfiled,
  setNotesFilterShared,
  createNewNote,
  getOrCreateDailyNote,
  deleteNote,
  deleteNotesBatch,
  reorderNote,
  saveNotesToDisk,
  togglePinNote,
  addNote,
  addNotebook,
  updateNotebook,
  deleteNotebook as deleteNotebookAction,
  setNoteNotebook,
  addTemplate,
  setEditingNote,
  selectEditingNote,
} from '../../../store/slices/notesSlice';
import { NotesTrashModal } from './NotesTrashModal';
import { NotesCleanupModal } from './NotesCleanupModal';
import { NoteConflictModal } from './NoteConflictModal';
import type { Note, NotesState, NoteTemplate, Notebook } from '../../../types/notes';
import { TemplateManager } from './TemplateManager';
import { FlashcardView } from './FlashcardView';
import { InAppWiki } from './InAppWiki';
import { Dropdown, type DropdownItem } from '../ui/Dropdown';
import { ConfirmModal } from '../ui/ConfirmModal/ConfirmModal';
import { ReminderModal } from '../ui/ReminderModal/ReminderModal';
import { ExportDialog } from './ExportDialog';
import { NoteTree } from './NoteTree';
import { NoteSyncBadge } from './NoteSyncBadge';
import { NoteSharedBadge } from './NoteSharedBadge';
import { importNoteFromFile, importBulkFromJson } from '../../../services/notes/noteImportService';
// La condition d'affichage de « Ajouter au coffre partagé… », partagée avec
// l'explorateur et l'accueil (elle inclut déjà le droit `selectCanUseTeamVaults`).
import {
  AddToVaultDialog,
  useVaultAddTargets,
  type AddToVaultSource,
} from '../vaults/AddToVaultDialog';
import { selectCanUseTeamVaults } from '../../../store/selectors/authSelectors';
import { VaultNotesSection } from './VaultNotesSection';
import { selectSharedNoteIds } from '../../../store/selectors/noteShareSelectors';
import { addToVaultMenuState } from './noteShareActionsModel';
import ImportWizard from './ImportWizard';
import { isWebPlatform } from '../../../services/platform/isWebPlatform';
import './NotesList.css';

import * as profileStorage from '../../../services/core/profileStorage';
import { searchFieldProps } from '../ui/searchFieldProps';
// ==================== Icons ====================

const PlusIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

const CalendarIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <rect x="3" y="4" width="18" height="18" rx="2" />
    <line x1="16" y1="2" x2="16" y2="6" />
    <line x1="8" y1="2" x2="8" y2="6" />
    <line x1="3" y1="10" x2="21" y2="10" />
  </svg>
);

const SearchIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);

const PinIcon: React.FC<{ filled?: boolean }> = ({ filled }) => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill={filled ? 'currentColor' : 'none'}
    stroke="currentColor"
    strokeWidth={2}
  >
    <path d="M12 17v5" />
    <path d="M9 10.76a2 2 0 01-1.11 1.79l-1.78.9A2 2 0 005 15.24V16a1 1 0 001 1h12a1 1 0 001-1v-.76a2 2 0 00-1.11-1.79l-1.78-.9A2 2 0 0115 10.76V7a1 1 0 011-1 1 1 0 001-1V4a1 1 0 00-1-1H8a1 1 0 00-1 1v1a1 1 0 001 1 1 1 0 011 1z" />
  </svg>
);

const TrashIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <polyline points="3,6 5,6 21,6" />
    <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
  </svg>
);

const NoteIcon = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
  >
    <path d="M14.5 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V7.5L14.5 2z" />
    <polyline points="14,2 14,8 20,8" />
    <line x1="16" y1="13" x2="8" y2="13" />
    <line x1="16" y1="17" x2="8" y2="17" />
    <line x1="10" y1="9" x2="8" y2="9" />
  </svg>
);

const SortIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <path d="M11 5h10" />
    <path d="M11 9h7" />
    <path d="M11 13h4" />
    <path d="M3 17l3 3 3-3" />
    <path d="M6 18V4" />
  </svg>
);

const DuplicateIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <rect x="9" y="9" width="13" height="13" rx="2" />
    <rect x="2" y="2" width="13" height="13" rx="2" />
  </svg>
);

const ExportIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
    <polyline points="7,10 12,15 17,10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);

const TemplateIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <line x1="3" y1="9" x2="21" y2="9" />
    <line x1="9" y1="21" x2="9" y2="9" />
  </svg>
);

// ==================== Context Menu ====================

interface NoteContextMenuProps {
  note: Note;
  x: number;
  y: number;
  onClose: () => void;
  onPin: (e: React.MouseEvent, id: string) => void;
  onDelete: (e: React.MouseEvent, id: string) => void;
  onDuplicate: (note: Note) => void;
  onSaveAsTemplate: (note: Note) => void;
  onExport: (note: Note) => void;
  onAddReminder: (note: Note) => void;
  notebooks: Notebook[];
  onMoveToNotebook: (noteId: string, notebookId: string | null) => void;
  /** Present only for Teams/Enterprise users — opens the move/copy-to-vault dialog. */
  onMoveToVault?: (note: Note) => void;
  /**
   * Le droit existe mais aucun coffre déverrouillé n'accepte un dépôt : l'entrée
   * reste VISIBLE, désactivée, avec ce motif — plutôt qu'absente (« le partage a
   * disparu ? ») ou active vers une boîte vide. Sans le droit, ni l'un ni
   * l'autre : pas d'entrée (`addToVaultMenuState`).
   */
  moveToVaultDisabledReason?: string;
}

const NoteContextMenu: React.FC<NoteContextMenuProps> = ({
  note,
  x,
  y,
  onClose,
  onPin,
  onDelete,
  onDuplicate,
  onSaveAsTemplate,
  onExport,
  onAddReminder,
  notebooks,
  onMoveToNotebook,
  onMoveToVault,
  moveToVaultDisabledReason,
}) => {
  const { t } = useTranslation();
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  // Adjust position so menu doesn't overflow viewport
  const style: React.CSSProperties = {
    position: 'fixed',
    left: x,
    top: y,
    zIndex: 9999,
  };

  return (
    <div className="note-context-menu" ref={menuRef} style={style}>
      <button
        className="note-context-menu__item"
        onClick={(e) => {
          onPin(e, note.id);
          onClose();
        }}
      >
        <PinIcon filled={note.isPinned} />
        <span>{note.isPinned ? t('notes.unpin', 'Unpin') : t('notes.pin', 'Pin')}</span>
      </button>
      <button
        className="note-context-menu__item"
        onClick={() => {
          onDuplicate(note);
          onClose();
        }}
      >
        <DuplicateIcon />
        <span>{t('notes.duplicate', 'Duplicate')}</span>
      </button>
      <button
        className="note-context-menu__item"
        onClick={() => {
          onSaveAsTemplate(note);
          onClose();
        }}
      >
        <TemplateIcon />
        <span>{t('notes.saveAsTemplate', 'Save as Template')}</span>
      </button>
      <button
        className="note-context-menu__item"
        onClick={() => {
          onExport(note);
          onClose();
        }}
      >
        <ExportIcon />
        <span>{t('notes.export', 'Export')}</span>
      </button>
      {(onMoveToVault || moveToVaultDisabledReason) && (
        <button
          className="note-context-menu__item"
          disabled={!onMoveToVault}
          aria-disabled={!onMoveToVault}
          title={onMoveToVault ? undefined : moveToVaultDisabledReason}
          style={onMoveToVault ? undefined : { opacity: 0.55, cursor: 'not-allowed' }}
          onClick={() => {
            if (!onMoveToVault) return;
            onMoveToVault(note);
            onClose();
          }}
        >
          <span style={{ display: 'inline-flex', width: 16, height: 16 }} aria-hidden="true">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.6}
              stroke="currentColor"
              width="16"
              height="16"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 0h10.5a1.5 1.5 0 0 1 1.5 1.5v6a1.5 1.5 0 0 1-1.5 1.5H6.75a1.5 1.5 0 0 1-1.5-1.5v-6a1.5 1.5 0 0 1 1.5-1.5Z"
              />
            </svg>
          </span>
          {/* Le MÊME libellé qu'à l'accueil et dans l'explorateur : un seul
              geste, une seule phrase, quel que soit l'objet visé. Le motif
              d'indisponibilité vient en second, plus petit. */}
          <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
            <span>{t('teamVaults.addToVault.menu')}</span>
            {!onMoveToVault && moveToVaultDisabledReason && (
              <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
                {moveToVaultDisabledReason}
              </span>
            )}
          </span>
        </button>
      )}
      <button
        className="note-context-menu__item"
        onClick={() => {
          onAddReminder(note);
          onClose();
        }}
      >
        <span style={{ display: 'inline-flex', width: 16, height: 16 }} aria-hidden="true">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.6}
            stroke="currentColor"
            width="16"
            height="16"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0"
            />
          </svg>
        </span>
        <span>{t('notes.addReminder', 'Add reminder')}</span>
      </button>
      {notebooks.length > 0 && (
        <>
          <div className="note-context-menu__separator" />
          <div className="note-context-menu__label">{t('notes.moveToNotebook', 'Move to...')}</div>
          {note.notebookId && (
            <button
              className="note-context-menu__item"
              onClick={() => {
                onMoveToNotebook(note.id, null);
                onClose();
              }}
            >
              <span>{t('notes.removeFromNotebook', 'No notebook')}</span>
            </button>
          )}
          {notebooks
            .filter((nb) => nb.id !== note.notebookId)
            .map((nb) => (
              <button
                key={nb.id}
                className="note-context-menu__item"
                onClick={() => {
                  onMoveToNotebook(note.id, nb.id);
                  onClose();
                }}
              >
                <span
                  className="note-context-menu__nb-dot"
                  style={{ background: nb.color || '#4682b4' }}
                />
                <span>
                  {nb.icon || ''} {nb.name}
                </span>
              </button>
            ))}
        </>
      )}
      <div className="note-context-menu__separator" />
      <button
        className="note-context-menu__item note-context-menu__item--danger"
        onClick={(e) => {
          onDelete(e, note.id);
          onClose();
        }}
      >
        <TrashIcon />
        <span>{t('notes.delete', 'Delete')}</span>
      </button>
    </div>
  );
};

// ==================== Helpers ====================

function formatRelativeDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function getNotePreview(plainText: string, maxLen = 80): string {
  if (!plainText) return '';
  const clean = plainText.replace(/\s+/g, ' ').trim();
  return clean.length > maxLen ? clean.slice(0, maxLen) + '...' : clean;
}

// ==================== Component ====================

interface NotesListProps {
  onSelectNote?: (noteId: string) => void;
  /**
   * Signale qu'une surface plein écran est ouverte DANS ce panneau.
   *
   * Onze modales, boîtes de confirmation et menus contextuels sont rendus en
   * `position: fixed` comme enfants de `.notes-list`, sans portail : masquer
   * le panneau les masquerait avec lui. Un utilisateur qui ouvre « Vider la
   * corbeille » depuis une liste révélée au survol, puis éloigne la souris
   * pour lire la boîte de dialogue centrée, la verrait disparaître.
   *
   * Optionnel : les appelants qui ne masquent jamais le panneau l'ignorent.
   */
  onOverlayOpenChange?: (open: boolean) => void;
}

const TemplateButtonIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <line x1="3" y1="9" x2="21" y2="9" />
    <line x1="9" y1="21" x2="9" y2="9" />
  </svg>
);
const FlashcardIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <rect x="2" y="4" width="20" height="16" rx="2" />
    <line x1="2" y1="10" x2="22" y2="10" />
  </svg>
);
const WikiIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <path d="M4 19.5A2.5 2.5 0 016.5 17H20" />
    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" />
  </svg>
);

const ImportIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
    <polyline points="17,8 12,3 7,8" />
    <line x1="12" y1="3" x2="12" y2="15" />
  </svg>
);

const MoreIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none">
    <circle cx="5" cy="12" r="1.7" />
    <circle cx="12" cy="12" r="1.7" />
    <circle cx="19" cy="12" r="1.7" />
  </svg>
);

const ImportExternalIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <path d="M12 3v12" />
    <path d="M8 11l4 4 4-4" />
    <rect x="3" y="17" width="18" height="4" rx="1" />
  </svg>
);

const ListViewIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <line x1="8" y1="6" x2="21" y2="6" />
    <line x1="8" y1="12" x2="21" y2="12" />
    <line x1="8" y1="18" x2="21" y2="18" />
    <line x1="3" y1="6" x2="3.01" y2="6" />
    <line x1="3" y1="12" x2="3.01" y2="12" />
    <line x1="3" y1="18" x2="3.01" y2="18" />
  </svg>
);

const TreeViewIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <path d="M6 3v12" />
    <path d="M6 15h6" />
    <path d="M6 9h6" />
    <rect x="12" y="6" width="8" height="4" rx="1" />
    <rect x="12" y="12" width="8" height="4" rx="1" />
    <rect x="2" y="1" width="8" height="4" rx="1" />
  </svg>
);

export const NotesList: React.FC<NotesListProps> = React.memo(function NotesList({
  onSelectNote,
  onOverlayOpenChange,
}) {
  const { t } = useTranslation();
  const dispatch = useDispatch<AppDispatch>();

  const [viewType, setViewType] = useState<'list' | 'tree'>('list');
  const [showTemplateManager, setShowTemplateManager] = useState(false);
  const [showFlashcards, setShowFlashcards] = useState(false);
  const [showWiki, setShowWiki] = useState(false);
  const [trashModalOpen, setTrashModalOpen] = useState(false);
  const trashedNotesCount = useSelector((s: RootState) => selectTrashedNotes(s).length);
  const [cleanupModalOpen, setCleanupModalOpen] = useState(false);
  const suspectNotesCount = useSelector((s: RootState) => selectSuspectNotes(s).length);
  const [conflictModalOpen, setConflictModalOpen] = useState(false);
  const conflictCount = useSelector((s: RootState) => selectConflictResolutions(s).length);
  const [contextMenu, setContextMenu] = useState<{ noteId: string; x: number; y: number } | null>(
    null
  );
  const [exportNote, setExportNote] = useState<Note | null>(null);
  const editingNote = useSelector(selectEditingNote);
  const notes = useSelector(selectFilteredNotes);
  const selectedNoteId = useSelector((s: RootState) => s.notes.selectedNoteId);
  const orphanIds = useSelector(selectOrphanNoteIds);
  const searchQuery = useSelector((s: RootState) => s.notes.searchQuery);
  const sortBy = useSelector((s: RootState) => s.notes.sortBy);
  const sortOrder = useSelector((s: RootState) => s.notes.sortOrder);
  const notebooks = useSelector(selectAllNotebooks);
  const notebookTree = useSelector(selectNotebookTree);
  const filterNotebookId = useSelector((s: RootState) => s.notes.filterNotebookId);
  const filterUnfiled = useSelector((s: RootState) => s.notes.filterUnfiled);
  const filterShared = useSelector((s: RootState) => s.notes.filterShared);
  // Le compte de « Partagées » : le MÊME ensemble que `selectFilteredNotes`
  // sous `filterShared`. Masqué hors nuage — le partage n'y existe pas, même
  // si un marqueur `sharedTo` a voyagé avec une note.
  const sharedNoteIds = useSelector(selectSharedNoteIds);
  const accountMode = useSelector((s: RootState) => s.auth.accountMode);
  const sharedNoteCount = accountMode === 'cloud' ? sharedNoteIds.size : 0;
  const allNotesForCount = useSelector(selectAllNotes);
  const foldersById = useSelector((s: RootState) => s.folders.byId);
  const [notebooksExpanded, setNotebooksExpanded] = useState(true);
  const [newNotebookName, setNewNotebookName] = useState<string | null>(null);
  /** Parent the pending new notebook will be created under (null = top level). */
  const [newNotebookParentId, setNewNotebookParentId] = useState<string | null>(null);
  /** Notebook currently hovered as a re-parent target while dragging another. */
  const [notebookDropTargetId, setNotebookDropTargetId] = useState<string | null>(null);
  /** Card the dragged note would land above/below, in manual sort mode. */
  const [reorderTarget, setReorderTarget] = useState<{
    noteId: string;
    edge: 'above' | 'below';
  } | null>(null);
  const [editingNotebookId, setEditingNotebookId] = useState<string | null>(null);
  const [dropTargetNotebookId, setDropTargetNotebookId] = useState<string | null>(null);
  const [pinnedExpanded, setPinnedExpanded] = useState(true);
  const [recentExpanded, setRecentExpanded] = useState(true);

  /**
   * L'ÉCRAN COURANT — c'est tout le changement de disposition.
   *
   * La navigation et la liste de notes se disputaient un SEUL conteneur
   * défilant, navigation en premier : elle servait donc toujours en premier, et
   * il restait une note et demie en bas de colonne. Pire, la navigation
   * grandissait toute seule — un carnet ajouté, c'étaient 26 px de moins pour
   * les notes, pour toujours.
   *
   * Elles ne cohabitent plus : 'browse' donne toute la colonne à la navigation
   * (qui cesse d'être tassée), 'notes' la donne aux notes. Aucune des deux ne
   * peut plus rogner l'autre, quelle que soit la hauteur de la fenêtre.
   *
   * La PORTÉE, elle, n'est pas un état d'écran : elle vit déjà dans Redux
   * (`filterNotebookId` / `filterUnfiled` / `filterShared`), qui est persisté.
   * Rouvrir l'application retombe donc sur la dernière portée consultée, sans
   * qu'on ait à mémoriser quoi que ce soit de plus — et sans payer le geste de
   * navigation supplémentaire à chaque lancement.
   */
  const [screen, setScreen] = useState<'browse' | 'notes'>('notes');
  const importInputRef = useRef<HTMLInputElement>(null);
  const [importWizardOpen, setImportWizardOpen] = useState(false);

  // Multi-select state
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleteProgress, setDeleteProgress] = useState<{ current: number; total: number } | null>(
    null
  );
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const pinnedNotes = useMemo(() => allNotesForCount.filter((n) => n.isPinned), [allNotesForCount]);

  // Recently-visited notes (newest first, excluding the open note + pinned ones
  // which already have their own section) — the everyday "jump back" loop.
  const visitHistoryNotes = useSelector(selectVisitHistory);
  const recentNotes = useMemo(() => {
    const pinnedIds = new Set(pinnedNotes.map((n) => n.id));
    return [...visitHistoryNotes]
      .reverse()
      .filter((n) => n.id !== selectedNoteId && !pinnedIds.has(n.id))
      .slice(0, 6);
  }, [visitHistoryNotes, selectedNoteId, pinnedNotes]);

  const notebooksMap = useMemo(() => {
    const map: Record<string, Notebook> = {};
    for (const nb of notebooks) map[nb.id] = nb;
    return map;
  }, [notebooks]);

  // Notes rangées nulle part — la destination du raccourci de l'accueil, et la
  // seule entrée d'où on peut les reprendre en main. Les quotidiennes, sans
  // dossier elles aussi, sont écartées : elles noieraient le compte.
  const unfiledNoteCount = useMemo(
    () => allNotesForCount.filter((n) => !n.parentId && !n.isDaily).length,
    [allNotesForCount]
  );

  /** Choisir un carnet (ou « Toutes les notes ») lève aussi le filtre « sans
   *  dossier » — le réducteur s'en charge, les deux vues étant exclusives. */
  const handleSelectNotebook = useCallback(
    (notebookId: string | null) => {
      dispatch(setNotesFilterNotebook(notebookId));
      setScreen('notes');
    },
    [dispatch]
  );

  const handleSelectUnfiled = useCallback(() => {
    dispatch(setNotesFilterNotebook(null));
    dispatch(setNotesFilterUnfiled(true));
    setScreen('notes');
  }, [dispatch]);

  /** « Partagées » — le réducteur quitte lui-même le carnet et « sans dossier ». */
  const handleSelectShared = useCallback(() => {
    dispatch(setNotesFilterShared(true));
    setScreen('notes');
  }, [dispatch]);

  /** Vrai quand la portée est « tout » — aucun filtre posé. */
  const scopeIsAll = !filterNotebookId && !filterUnfiled && !filterShared;

  /** Le nom de la portée courante : c'est le titre de l'écran « notes ». */
  const scopeLabel = useMemo(() => {
    if (filterUnfiled) return t('notes.unfiled', 'Sans dossier');
    if (filterShared) return t('notes.sharedFilter', 'Shared');
    if (filterNotebookId) return notebooksMap[filterNotebookId]?.name ?? t('notes.title', 'Notes');
    return t('notes.allNotes', 'All Notes');
  }, [filterUnfiled, filterShared, filterNotebookId, notebooksMap, t]);

  /**
   * Chercher, c'est vouloir un RÉSULTAT, pas un carnet : une frappe dans le
   * champ fait donc passer à la liste. Sans cela, l'écran « parcourir »
   * avalerait la recherche en silence — on taperait, et rien ne bougerait.
   */
  useEffect(() => {
    if (searchQuery) setScreen('notes');
  }, [searchQuery]);

  /**
   * LA RECHERCHE EST BORNÉE PAR LA PORTÉE, et il faut le dire.
   *
   * `selectFilteredNotes` applique le texte APRÈS le filtre de carnet :
   * chercher depuis « Filarr » ne trouve donc rien qui vive ailleurs. C'était
   * déjà vrai avant, mais la navigation restait sous les yeux — on voyait
   * qu'on était dans un carnet. Une colonne qui ne montre qu'une portée à la
   * fois rendrait ce silence trompeur : on chercherait une note qui existe, et
   * on conclurait qu'elle a disparu.
   *
   * On ne change pas le sélecteur (il sert ailleurs) : on rend l'issue
   * VISIBLE, avec un bouton qui élargit à tout.
   */
  const searchIsScoped = !!searchQuery && !scopeIsAll;

  const handleSearchEverywhere = useCallback(() => {
    dispatch(setNotesFilterNotebook(null));
    dispatch(setNotesFilterUnfiled(false));
    dispatch(setNotesFilterShared(false));
  }, [dispatch]);

  const notebookNoteCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const note of allNotesForCount) {
      if (note.notebookId) {
        counts[note.notebookId] = (counts[note.notebookId] || 0) + 1;
      }
    }
    return counts;
  }, [allNotesForCount]);

  // Créer une note, c'est vouloir l'écrire : la colonne bascule sur la liste,
  // où la nouvelle venue est visible et sélectionnée. Rester sur « parcourir »
  // donnerait une note ouverte à droite dont on ne verrait pas la trace à
  // gauche. Même raison pour la note du jour.
  const handleNewNote = useCallback(() => {
    setScreen('notes');
    dispatch(createNewNote({ title: '' })).then((action: any) => {
      if (filterNotebookId && action.payload?.id) {
        dispatch(setNoteNotebook({ noteId: action.payload.id, notebookId: filterNotebookId }));
      }
    });
  }, [dispatch, filterNotebookId]);

  const handleDailyNote = useCallback(() => {
    setScreen('notes');
    dispatch(getOrCreateDailyNote());
  }, [dispatch]);

  const handleImportFile = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const content = reader.result as string;
          // Bulk JSON import (array of notes)
          if (file.name.endsWith('.json')) {
            const notes = importBulkFromJson(content);
            for (const note of notes) {
              dispatch(addNote(note));
            }
            if (notes.length > 0) dispatch(setEditingNote(notes[0].id));
            return;
          }
          // Single file import
          const note = importNoteFromFile(content, file.name);
          dispatch(addNote(note));
          dispatch(setEditingNote(note.id));
        } catch (err) {
          console.error('[NotesList] Import failed:', err);
        }
      };
      reader.readAsText(file);
      e.target.value = '';
    },
    [dispatch]
  );

  /**
   * Les actions OCCASIONNELLES de l'en-tete, rangees dans le menu « … ».
   *
   * La colonne fait 320 px de large : le titre de la portee, la fleche de
   * retour et sept boutons ne tenaient pas sur une ligne — et c'est le TITRE
   * qui payait, reduit a « T.. ». L'import externe reste desktop-only : les
   * canaux `import:*` n'existent pas sur le web.
   */
  const headerMenuItems = useMemo<DropdownItem[]>(() => {
    const items: DropdownItem[] = [
      {
        label: t('notes.wiki', 'Help'),
        icon: <WikiIcon />,
        onClick: () => setShowWiki(true),
      },
      {
        label: t('notes.flashcards', 'Flashcards'),
        icon: <FlashcardIcon />,
        onClick: () => setShowFlashcards(true),
      },
      {
        label: t('notes.templateManager', 'Templates'),
        icon: <TemplateButtonIcon />,
        onClick: () => setShowTemplateManager(true),
        divider: true,
      },
      {
        label: t('notes.importNote', 'Import Note'),
        icon: <ImportIcon />,
        onClick: () => importInputRef.current?.click(),
      },
    ];
    if (!isWebPlatform()) {
      items.push({
        label: t('notes.importExternal', 'Import from Obsidian, Notion, Evernote...'),
        icon: <ImportExternalIcon />,
        onClick: () => setImportWizardOpen(true),
      });
    }
    return items;
  }, [t]);

  const handleSelect = useCallback(
    (id: string) => {
      dispatch(selectNote(id));
      onSelectNote?.(id);
    },
    [dispatch, onSelectNote]
  );

  const handleDelete = useCallback(
    (e: React.MouseEvent, id: string) => {
      e.stopPropagation();
      dispatch(deleteNote(id));
    },
    [dispatch]
  );

  const handlePin = useCallback(
    (e: React.MouseEvent, id: string) => {
      e.stopPropagation();
      dispatch(togglePinNote(id));
    },
    [dispatch]
  );

  const toggleNoteSelection = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAllNotesFn = useCallback(() => {
    setSelectedIds(new Set(notes.map((n) => n.id)));
  }, [notes]);

  const deselectAll = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const executeDeleteSelected = useCallback(async () => {
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    const count = ids.length;
    setDeleteProgress({ current: 0, total: count });

    const CHUNK = 500;
    for (let i = 0; i < ids.length; i += CHUNK) {
      dispatch(deleteNotesBatch(ids.slice(i, i + CHUNK)));
      setDeleteProgress({ current: Math.min(i + CHUNK, count), total: count });
      await new Promise((r) => setTimeout(r, 0));
    }

    await dispatch(saveNotesToDisk());
    setDeleteProgress(null);
    setSelectedIds(new Set());
    setSelectionMode(false);
  }, [selectedIds, dispatch]);

  // Pin/unpin the whole selection, then persist (reuses the single-note reducer).
  const handlePinSelected = useCallback(async () => {
    if (selectedIds.size === 0) return;
    selectedIds.forEach((id) => dispatch(togglePinNote(id)));
    await dispatch(saveNotesToDisk());
    setSelectedIds(new Set());
    setSelectionMode(false);
  }, [selectedIds, dispatch]);

  const handleSearch = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      dispatch(setNotesSearchQuery(e.target.value));
    },
    [dispatch]
  );

  /**
   * Remember the chosen sort across restarts.
   *
   * `manualOrder` lives on each note and is saved with them, but `sortBy`
   * itself is not persisted anywhere — the notes slice is excluded from
   * redux-persist and the encrypted payload only carries notes/notebooks. So
   * without this, arranging the list by hand and reopening the app dropped
   * you back on "Modified" and the arrangement looked lost. localStorage
   * keeps it a pure UI preference, out of the encrypted store.
   */
  const SORT_PREF_KEY = 'filarr.notes.sort';
  const sortPrefLoadedRef = useRef(false);

  useEffect(() => {
    try {
      const raw = profileStorage.getItemWithLegacyFallback(SORT_PREF_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as Partial<{
          sortBy: NotesState['sortBy'];
          sortOrder: NotesState['sortOrder'];
        }>;
        const allowed: NotesState['sortBy'][] = [
          'updatedAt',
          'title',
          'createdAt',
          'wordCount',
          'manual',
        ];
        if (saved.sortBy && allowed.includes(saved.sortBy)) dispatch(setNotesSortBy(saved.sortBy));
        if (saved.sortOrder === 'asc' || saved.sortOrder === 'desc') {
          dispatch(setNotesSortOrder(saved.sortOrder));
        }
      }
    } catch {
      /* unreadable preference — the defaults are fine */
    }
    sortPrefLoadedRef.current = true;
  }, [dispatch]);

  useEffect(() => {
    // Skip the first render: writing before the restore above has run would
    // save the default over the user's stored choice.
    if (!sortPrefLoadedRef.current) return;
    try {
      profileStorage.setItem(SORT_PREF_KEY, JSON.stringify({ sortBy, sortOrder }));
    } catch {
      /* storage full or blocked — not worth surfacing */
    }
  }, [sortBy, sortOrder]);

  const handleSortToggle = useCallback(() => {
    const sorts: NotesState['sortBy'][] = [
      'updatedAt',
      'title',
      'createdAt',
      'wordCount',
      'manual',
    ];
    const idx = sorts.indexOf(sortBy);
    const next = sorts[(idx + 1) % sorts.length];
    dispatch(setNotesSortBy(next));
  }, [dispatch, sortBy]);

  const handleSortOrderToggle = useCallback(() => {
    dispatch(setNotesSortOrder(sortOrder === 'asc' ? 'desc' : 'asc'));
  }, [dispatch, sortOrder]);

  // ---- Manual reordering (drag a note to a new position) ----

  const handleReorderDragOver = useCallback((e: React.DragEvent, noteId: string) => {
    if (!e.dataTransfer.types.includes('application/x-filarr-note')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    // Above or below the hovered card, decided by the midpoint — the same
    // gesture the Kanban board already uses.
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const edge: 'above' | 'below' = e.clientY < rect.top + rect.height / 2 ? 'above' : 'below';
    setReorderTarget((prev) =>
      prev?.noteId === noteId && prev.edge === edge ? prev : { noteId, edge }
    );
  }, []);

  const handleReorderDragEnd = useCallback(() => setReorderTarget(null), []);

  const handleReorderDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const draggedId = e.dataTransfer.getData('application/x-filarr-note');
      const target = reorderTarget;
      setReorderTarget(null);
      if (!draggedId || !target) return;

      // Dropping below a card means "insert before the one after it"; at the
      // end of the list there is no such note, hence null = append.
      const order = notes.map((n) => n.id);
      let beforeNoteId: string | null = target.noteId;
      if (target.edge === 'below') {
        const idx = order.indexOf(target.noteId);
        beforeNoteId = idx >= 0 && idx + 1 < order.length ? order[idx + 1] : null;
      }
      if (beforeNoteId === draggedId) return;

      dispatch(reorderNote({ noteId: draggedId, beforeNoteId, visibleIds: order }));
      void dispatch(saveNotesToDisk());
    },
    [dispatch, notes, reorderTarget]
  );

  const handleSaveAsTemplate = useCallback(() => {
    if (!editingNote) return;
    const tpl: NoteTemplate = {
      id: `tpl-custom-${Date.now()}`,
      name: editingNote.title || 'Untitled Template',
      description: `Created from "${editingNote.title || 'Untitled'}"`,
      icon: 'default',
      content: editingNote.content,
      variables: [],
      isBuiltIn: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    dispatch(addTemplate(tpl));
  }, [dispatch, editingNote]);

  const handleContextMenu = useCallback((e: React.MouseEvent, noteId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ noteId, x: e.clientX, y: e.clientY });
  }, []);

  const handleCloseContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  /**
   * « Ajouter au coffre partagé… » — la MÊME condition d'affichage que dans
   * l'explorateur et à l'accueil : il faut au moins un coffre DÉVERROUILLÉ où
   * ce compte peut écrire. L'offre seule ne suffisait pas : avec le droit mais
   * sans aucun coffre (ou avec le seul rôle de lecteur), l'entrée s'affichait
   * et n'ouvrait qu'une boîte vide qui répondait « aucun coffre déverrouillé ».
   */
  const canUseTeamVaults = useSelector(selectCanUseTeamVaults);
  const vaultAddTargets = useVaultAddTargets();
  const hasVaultTargets = vaultAddTargets.length > 0;
  // Droit × cible → trois états (`noteShareActionsModel`) : sans le droit, pas
  // d'entrée ; avec le droit mais sans coffre déverrouillé, une entrée
  // désactivée qui dit pourquoi ; sinon, l'entrée active.
  const addToVaultState = addToVaultMenuState({
    canUse: canUseTeamVaults,
    hasTargets: hasVaultTargets,
  });
  const canAddToVault = addToVaultState === 'enabled';
  const [moveToVaultNote, setMoveToVaultNote] = useState<Note | null>(null);
  // UNE note vers un coffre : le MÊME dialogue que le lot et l'explorateur
  // (`AddToVaultDialog`), la note décrite comme source `note`. L'ancienne
  // redirection `MoveNoteToVaultDialog` ne faisait que cela (lot A, C6).
  const moveToVaultSource = useMemo<AddToVaultSource | null>(
    () =>
      moveToVaultNote
        ? {
            kind: 'note',
            id: moveToVaultNote.id,
            title: moveToVaultNote.title,
            content: moveToVaultNote.content,
          }
        : null,
    [moveToVaultNote]
  );
  /** Le LOT de la sélection multiple — `null` tant que la boîte est fermée. */
  const [batchVaultSource, setBatchVaultSource] = useState<AddToVaultSource | null>(null);
  const handleAddSelectionToVault = useCallback(() => {
    // Dans l'ordre de la liste, pas dans l'ordre des clics : c'est l'ordre
    // que l'utilisateur a sous les yeux, et celui de la jauge ensuite.
    const picked = notes
      .filter((n) => selectedIds.has(n.id))
      .map((n) => ({ id: n.id, title: n.title, content: n.content }));
    if (picked.length === 0) return;
    setBatchVaultSource({ kind: 'notes', notes: picked });
  }, [notes, selectedIds]);

  const handleDuplicate = useCallback(
    (note: Note) => {
      dispatch(
        createNewNote({
          title: `${note.title || 'Untitled'} (copy)`,
          content: note.content,
        })
      );
    },
    [dispatch]
  );

  const handleSaveNoteAsTemplate = useCallback(
    (note: Note) => {
      const tpl: NoteTemplate = {
        id: `tpl-custom-${Date.now()}`,
        name: note.title || 'Untitled Template',
        description: `Created from "${note.title || 'Untitled'}"`,
        icon: 'default',
        content: note.content,
        variables: [],
        isBuiltIn: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      dispatch(addTemplate(tpl));
    },
    [dispatch]
  );

  const handleExportNote = useCallback((note: Note) => {
    setExportNote(note);
  }, []);

  const [reminderNote, setReminderNote] = useState<Note | null>(null);
  const handleAddReminderToNote = useCallback((note: Note) => {
    setReminderNote(note);
  }, []);
  const handleConfirmNoteReminder = useCallback(
    async (data: {
      date: string;
      time: string;
      message: string;
      recurring?: string;
      priority?: string;
      datetime?: string;
    }) => {
      if (!reminderNote) return;
      const ipc = window.electron?.ipcRenderer;
      if (!ipc) return;
      try {
        const reminder = {
          id: Date.now().toString(),
          itemId: reminderNote.id,
          itemName: reminderNote.title || 'Note',
          itemType: 'note',
          date: data.datetime || new Date(`${data.date}T${data.time}`).toISOString(),
          message: data.message,
          recurring: (data.recurring as any) || 'none',
          priority: (data.priority as any) || 'normal',
        };
        await ipc.invoke('addReminderToNote', {
          noteId: reminderNote.id,
          noteName: reminderNote.title || 'Note',
          reminder,
        });
      } catch (err) {
        console.warn('[NotesList] addReminderToNote failed:', err);
      } finally {
        setReminderNote(null);
      }
    },
    [reminderNote]
  );

  const handleMoveToNotebook = useCallback(
    (noteId: string, notebookId: string | null) => {
      dispatch(setNoteNotebook({ noteId, notebookId }));
    },
    [dispatch]
  );

  const handleCreateNotebook = useCallback(
    (name: string) => {
      dispatch(addNotebook({ name, parentId: newNotebookParentId }));
      setNewNotebookName(null);
      setNewNotebookParentId(null);
    },
    [dispatch, newNotebookParentId]
  );

  /** Open the inline creation field, nested under `parentId` when given. */
  const startCreatingNotebook = useCallback((parentId: string | null) => {
    setNewNotebookParentId(parentId);
    setNewNotebookName('');
    setNotebooksExpanded(true);
  }, []);

  const handleReparentNotebook = useCallback(
    (id: string, parentId: string | null) => {
      if (id === parentId) return;
      dispatch(updateNotebook({ id, changes: { parentId } }));
    },
    [dispatch]
  );

  const handleDeleteNotebook = useCallback(
    (e: React.MouseEvent, id: string) => {
      e.stopPropagation();
      dispatch(deleteNotebookAction(id));
    },
    [dispatch]
  );

  const overlayOpen =
    showTemplateManager ||
    showFlashcards ||
    showWiki ||
    trashModalOpen ||
    cleanupModalOpen ||
    conflictModalOpen ||
    importWizardOpen ||
    showDeleteConfirm ||
    !!contextMenu ||
    !!reminderNote ||
    !!exportNote;
  const overlayReportRef = useRef(onOverlayOpenChange);
  overlayReportRef.current = onOverlayOpenChange;
  useEffect(() => {
    onOverlayOpenChange?.(overlayOpen);
  }, [overlayOpen, onOverlayOpenChange]);
  // Idem : démonter le panneau ferme ce qu'il contenait.
  useEffect(() => () => overlayReportRef.current?.(false), []);

  const contextMenuNote = useMemo(
    () =>
      contextMenu ? (allNotesForCount.find((n) => n.id === contextMenu.noteId) ?? null) : null,
    [contextMenu, allNotesForCount]
  );

  const sortLabel = useMemo(() => {
    const labels: Record<NotesState['sortBy'], string> = {
      updatedAt: t('notes.sortUpdated', 'Modified'),
      title: t('notes.sortTitle', 'Title'),
      createdAt: t('notes.sortCreated', 'Created'),
      wordCount: t('notes.sortWords', 'Words'),
      manual: t('notes.sortManual', 'Custom order'),
    };
    return labels[sortBy];
  }, [sortBy, t]);

  return (
    <div className="notes-list">
      {/* Header */}
      <div className="notes-list__header">
        {/* Le retour est AUSSI une cible de dépôt : les carnets vivent sur
            l'autre écran, un glisser-déposer d'une note vers un carnet doit
            donc pouvoir y remonter. Survoler le bouton en tenant une note
            ouvre « parcourir », le glisser se poursuit sur le carnet visé —
            c'est le geste du Finder, et sans lui la disposition retirerait une
            fonction qui marchait. */}
        {screen === 'notes' && (
          <button
            className="notes-list__back"
            onClick={() => setScreen('browse')}
            onDragOver={(e) => {
              if (e.dataTransfer.types.includes('application/x-filarr-note')) {
                e.preventDefault();
                setScreen('browse');
              }
            }}
            title={t('notes.backToBrowse', 'Parcourir')}
            aria-label={t('notes.backToBrowse', 'Parcourir')}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.2}
            >
              <path d="m15 6-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
        <h2 className="notes-list__title" title={screen === 'notes' ? scopeLabel : undefined}>
          {screen === 'notes' ? scopeLabel : t('notes.title', 'Notes')}
        </h2>
        <div className="notes-list__actions">
          {/* La colonne ne fait que 320 px : sept boutons n'y laissaient au titre
              de la portee qu'une poignee de pixels (« T.. »). Les actions
              occasionnelles vivent maintenant dans le menu « … » ; la note du
              jour et la nouvelle note restent sous le doigt. */}
          <input
            ref={importInputRef}
            type="file"
            accept=".md,.markdown,.html,.htm,.filarr,.txt,.json"
            style={{ display: 'none' }}
            onChange={handleImportFile}
          />
          <Dropdown
            position="bottom-right"
            items={headerMenuItems}
            trigger={
              <span
                className="notes-list__action-btn"
                title={t('notes.moreActions', 'More actions')}
                aria-label={t('notes.moreActions', 'More actions')}
              >
                <MoreIcon />
              </span>
            }
          />
          <button
            className="notes-list__action-btn notes-list__action-btn--daily"
            onClick={handleDailyNote}
            title={t('notes.dailyNote', 'Daily Note')}
          >
            <CalendarIcon />
          </button>
          <button
            className="notes-list__action-btn notes-list__action-btn--new"
            onClick={handleNewNote}
            title={t('notes.newNote', 'New Note')}
          >
            <PlusIcon />
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="notes-list__search">
        <SearchIcon />
        <input
          {...searchFieldProps(
            'filarr-notes-search',
            t('notes.searchPlaceholder', 'Search notes...')
          )}
          className="notes-list__search-input"
          placeholder={t('notes.searchPlaceholder', 'Search notes...')}
          value={searchQuery}
          onChange={handleSearch}
        />
        <button
          className={`notes-list__action-btn ${selectionMode ? 'is-active' : ''}`}
          onClick={() => {
            setSelectionMode((v) => !v);
            if (selectionMode) setSelectedIds(new Set());
          }}
          title={t('notes.selectMode', 'Sélection multiple')}
          style={{
            flexShrink: 0,
            padding: 4,
            marginLeft: 4,
            color: selectionMode ? 'var(--color-primary-500)' : undefined,
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
            <rect x="3" y="3" width="18" height="18" rx="3" />
            {selectionMode && <polyline points="9,12 11,14 15,10" />}
          </svg>
        </button>
      </div>

      {/* Sort bar \u2014 elle d\u00e9crit la LISTE, elle n'a donc rien \u00e0 faire sur
          l'\u00e9cran \u00ab parcourir \u00bb, o\u00f9 il n'y a pas de liste \u00e0 trier. */}
      {screen === 'notes' && (
        <div className="notes-list__sort-bar">
          <button className="notes-list__sort-btn" onClick={handleSortToggle}>
            <SortIcon />
            <span>{sortLabel}</span>
          </button>
          <button className="notes-list__sort-order-btn" onClick={handleSortOrderToggle}>
            {sortOrder === 'asc' ? '\u2191' : '\u2193'}
          </button>
          <button
            className={`notes-list__view-toggle-btn ${viewType === 'tree' ? 'notes-list__view-toggle-btn--active' : ''}`}
            onClick={() => setViewType(viewType === 'list' ? 'tree' : 'list')}
            title={
              viewType === 'list'
                ? t('notes.treeView', 'Tree View')
                : t('notes.listView', 'List View')
            }
          >
            {viewType === 'list' ? <TreeViewIcon /> : <ListViewIcon />}
          </button>
          <span className="notes-list__count">
            {notes.length} {t('notes.notesCount', 'note(s)')}
          </span>
        </div>
      )}

      {/* L'issue de la recherche born\u00e9e : sans elle, une note qui existe
          ailleurs passerait pour disparue. */}
      {screen === 'notes' && searchIsScoped && (
        <button className="notes-list__search-widen" onClick={handleSearchEverywhere}>
          {t('notes.searchEverywhere', 'Chercher dans toutes les notes')}
        </button>
      )}

      {/* Scrollable content area */}
      <div className="notes-list__scroll-area">
        {/* ===== Écran « parcourir » : la navigation a TOUTE la colonne =====
            Ces sections n'ont pas changé de forme — elles ont simplement cessé
            de disputer leurs pixels à la liste de notes, qui vit maintenant sur
            l'autre écran. Cliquer une note récente ou épinglée l'ouvre
            directement : on ne descend pas d'un niveau pour rien. */}
        {screen === 'browse' && (
          <>
            {/* Recently visited */}
            {recentNotes.length > 0 && (
              <div className="notes-list__pinned">
                <div className="notes-list__pinned-header">
                  <button
                    className="notes-list__pinned-toggle"
                    onClick={() => setRecentExpanded(!recentExpanded)}
                  >
                    <svg
                      width="10"
                      height="10"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      style={{
                        transform: recentExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                        transition: 'transform 0.15s',
                      }}
                    >
                      <path d="M8 5l8 7-8 7z" />
                    </svg>
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <circle cx="12" cy="12" r="9" />
                      <path d="M12 7v5l3 2" strokeLinecap="round" />
                    </svg>
                    <span>{t('notes.recentNotes', 'Récents')}</span>
                    <span className="notes-list__pinned-count">{recentNotes.length}</span>
                  </button>
                </div>
                {recentExpanded && (
                  <div className="notes-list__pinned-list">
                    {recentNotes.map((note) => (
                      <div
                        key={note.id}
                        className={`notes-list__pinned-item ${note.id === selectedNoteId ? 'is-active' : ''}`}
                        onClick={() => handleSelect(note.id)}
                        onContextMenu={(e) => handleContextMenu(e, note.id)}
                        role="button"
                        tabIndex={0}
                      >
                        <span className="notes-list__pinned-item-icon">
                          {note.isDaily ? <CalendarIcon /> : <NoteIcon />}
                        </span>
                        <span className="notes-list__pinned-item-title">
                          {note.title || t('notes.untitled', 'Untitled')}
                        </span>
                        <NoteSharedBadge noteId={note.id} variant="dot" />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Pinned / Bookmarks */}
            {pinnedNotes.length > 0 && (
              <div className="notes-list__pinned">
                <div className="notes-list__pinned-header">
                  <button
                    className="notes-list__pinned-toggle"
                    onClick={() => setPinnedExpanded(!pinnedExpanded)}
                  >
                    <svg
                      width="10"
                      height="10"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      style={{
                        transform: pinnedExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                        transition: 'transform 0.15s',
                      }}
                    >
                      <path d="M8 5l8 7-8 7z" />
                    </svg>
                    <PinIcon filled />
                    <span>{t('notes.pinnedNotes', 'Pinned')}</span>
                    <span className="notes-list__pinned-count">{pinnedNotes.length}</span>
                  </button>
                </div>
                {pinnedExpanded && (
                  <div className="notes-list__pinned-list">
                    {pinnedNotes.map((note) => (
                      <div
                        key={note.id}
                        className={`notes-list__pinned-item ${note.id === selectedNoteId ? 'is-active' : ''}`}
                        onClick={() => handleSelect(note.id)}
                        onContextMenu={(e) => handleContextMenu(e, note.id)}
                        role="button"
                        tabIndex={0}
                      >
                        <span className="notes-list__pinned-item-icon">
                          {note.isDaily ? <CalendarIcon /> : <NoteIcon />}
                        </span>
                        <span className="notes-list__pinned-item-title">
                          {note.title || t('notes.untitled', 'Untitled')}
                        </span>
                        <NoteSharedBadge noteId={note.id} variant="dot" />
                        <span
                          className="notes-list__pinned-item-unpin"
                          role="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handlePin(e, note.id);
                          }}
                          title={t('notes.unpin', 'Unpin')}
                        >
                          <svg
                            width="10"
                            height="10"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth={2.5}
                          >
                            <line x1="18" y1="6" x2="6" y2="18" />
                            <line x1="6" y1="6" x2="18" y2="18" />
                          </svg>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/*
          LES NOTES DES COFFRES PARTAGÉS — une section À PART, et pas un
          mélange. Elle se rend `null` d'elle-même hors compte nuage, sans le
          droit aux coffres d'équipe, ou sans le moindre coffre (règle 13) :
          rien à garder ici.

          Elle ne dépose RIEN dans `notesSlice`, et c'est ce qui la tient hors
          de la recherche globale, du graphe, des modèles et des raccourcis —
          tous lisent le magasin des notes, et ce qui n'y entre pas ne peut pas
          y être ramassé par accident.
        */}
            <VaultNotesSection />

            {/* Notebooks */}
            <div className="notes-list__notebooks">
              <div className="notes-list__notebooks-header">
                <button
                  className="notes-list__notebooks-toggle"
                  onClick={() => setNotebooksExpanded(!notebooksExpanded)}
                >
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    style={{
                      transform: notebooksExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                      transition: 'transform 0.15s',
                    }}
                  >
                    <path d="M8 5l8 7-8 7z" />
                  </svg>
                  <span>{t('notes.notebooks', 'Notebooks')}</span>
                </button>
                <button
                  className="notes-list__notebooks-add"
                  onClick={() => startCreatingNotebook(null)}
                  title={t('notes.newNotebook', 'New Notebook')}
                >
                  <PlusIcon />
                </button>
              </div>
              {notebooksExpanded && (
                <div className="notes-list__notebooks-list">
                  <div
                    className={`notes-list__notebook-item ${filterNotebookId === null && !filterUnfiled && !filterShared ? 'is-active' : ''} ${dropTargetNotebookId === '__all__' ? 'is-drop-target' : ''}`}
                    onClick={() => handleSelectNotebook(null)}
                    role="button"
                    onDragOver={(e) => {
                      if (e.dataTransfer.types.includes('application/x-filarr-note')) {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'move';
                        setDropTargetNotebookId('__all__');
                      }
                    }}
                    onDragLeave={() => setDropTargetNotebookId(null)}
                    onDrop={(e) => {
                      e.preventDefault();
                      const noteId = e.dataTransfer.getData('application/x-filarr-note');
                      if (noteId) dispatch(setNoteNotebook({ noteId, notebookId: null }));
                      // Dropping a notebook here promotes it back to the top level.
                      const notebookId = e.dataTransfer.getData('application/x-filarr-notebook');
                      if (notebookId) handleReparentNotebook(notebookId, null);
                      setDropTargetNotebookId(null);
                      setNotebookDropTargetId(null);
                    }}
                  >
                    <span className="notes-list__notebook-icon">{'📓'}</span>
                    <span className="notes-list__notebook-name">
                      {t('notes.allNotes', 'All Notes')}
                    </span>
                    <span className="notes-list__notebook-count">{allNotesForCount.length}</span>
                  </div>
                  {/* Notes sans dossier — un carnet de plus en apparence, mais la
                  seule porte vers les notes que rien ne range. Le raccourci de
                  l'accueil atterrit ici. */}
                  {unfiledNoteCount > 0 && (
                    <div
                      className={`notes-list__notebook-item ${filterUnfiled ? 'is-active' : ''}`}
                      onClick={handleSelectUnfiled}
                      role="button"
                      tabIndex={0}
                    >
                      <span className="notes-list__notebook-icon">{'🗒️'}</span>
                      <span className="notes-list__notebook-name">
                        {t('notes.unfiled', 'Sans dossier')}
                      </span>
                      <span className="notes-list__notebook-count">{unfiledNoteCount}</span>
                    </div>
                  )}
                  {/* Notes déposées dans un coffre — calquée sur « Sans dossier »,
                  masquée à zéro (rien à retrouver) et hors nuage. La palette
                  (« Notes partagées ») atterrit ici. */}
                  {sharedNoteCount > 0 && (
                    <div
                      className={`notes-list__notebook-item ${filterShared ? 'is-active' : ''}`}
                      onClick={handleSelectShared}
                      role="button"
                      tabIndex={0}
                    >
                      <span className="notes-list__notebook-icon">{'\u{1F510}'}</span>
                      <span className="notes-list__notebook-name">
                        {t('notes.sharedFilter', 'Shared')}
                      </span>
                      <span className="notes-list__notebook-count">{sharedNoteCount}</span>
                    </div>
                  )}
                  {notebookTree.map(({ notebook: nb, depth }) => (
                    <React.Fragment key={nb.id}>
                      <div
                        className={`notes-list__notebook-item ${filterNotebookId === nb.id && !filterUnfiled && !filterShared ? 'is-active' : ''} ${dropTargetNotebookId === nb.id || notebookDropTargetId === nb.id ? 'is-drop-target' : ''}`}
                        // Indentation is what makes the nesting readable; the tree
                        // is rendered flat so the list stays one map, not a
                        // recursive component.
                        style={{ paddingLeft: 8 + depth * 14 }}
                        onClick={() => handleSelectNotebook(nb.id)}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setEditingNotebookId(nb.id);
                        }}
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.effectAllowed = 'move';
                          e.dataTransfer.setData('application/x-filarr-notebook', nb.id);
                        }}
                        onDragOver={(e) => {
                          const types = e.dataTransfer.types;
                          if (types.includes('application/x-filarr-note')) {
                            e.preventDefault();
                            e.dataTransfer.dropEffect = 'move';
                            setDropTargetNotebookId(nb.id);
                          } else if (types.includes('application/x-filarr-notebook')) {
                            e.preventDefault();
                            e.dataTransfer.dropEffect = 'move';
                            setNotebookDropTargetId(nb.id);
                          }
                        }}
                        onDragLeave={() => {
                          setDropTargetNotebookId(null);
                          setNotebookDropTargetId(null);
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          const noteId = e.dataTransfer.getData('application/x-filarr-note');
                          if (noteId) dispatch(setNoteNotebook({ noteId, notebookId: nb.id }));
                          // Dropping a notebook onto another nests it there. The
                          // reducer refuses a move that would make a notebook its
                          // own descendant, so no guard is needed here.
                          const notebookId = e.dataTransfer.getData(
                            'application/x-filarr-notebook'
                          );
                          if (notebookId) handleReparentNotebook(notebookId, nb.id);
                          setDropTargetNotebookId(null);
                          setNotebookDropTargetId(null);
                        }}
                        role="button"
                        tabIndex={0}
                      >
                        <span
                          className="notes-list__notebook-dot"
                          style={{ background: nb.color || '#4682b4' }}
                        />
                        <span className="notes-list__notebook-icon">{nb.icon || '📕'}</span>
                        <span className="notes-list__notebook-name">{nb.name}</span>
                        <span className="notes-list__notebook-count">
                          {notebookNoteCounts[nb.id] || 0}
                        </span>
                        <span
                          className="notes-list__notebook-add-child"
                          role="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            startCreatingNotebook(nb.id);
                          }}
                          title={t('notes.newSubNotebook', 'New notebook inside this one')}
                        >
                          <svg
                            width="10"
                            height="10"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth={2.5}
                          >
                            <line x1="12" y1="5" x2="12" y2="19" />
                            <line x1="5" y1="12" x2="19" y2="12" />
                          </svg>
                        </span>
                        <span
                          className="notes-list__notebook-delete"
                          role="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteNotebook(e as any, nb.id);
                          }}
                          title={t('notes.deleteNotebook', 'Delete Notebook')}
                        >
                          <svg
                            width="10"
                            height="10"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth={2.5}
                          >
                            <line x1="18" y1="6" x2="6" y2="18" />
                            <line x1="6" y1="6" x2="18" y2="18" />
                          </svg>
                        </span>
                      </div>
                      {/* The creation field appears directly under its parent, so
                      where the new notebook will land is visible before typing. */}
                      {newNotebookName !== null && newNotebookParentId === nb.id && (
                        <div
                          className="notes-list__notebook-new"
                          style={{ paddingLeft: 8 + (depth + 1) * 14 }}
                        >
                          <input
                            autoFocus
                            value={newNotebookName}
                            onChange={(e) => setNewNotebookName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && newNotebookName.trim()) {
                                handleCreateNotebook(newNotebookName.trim());
                              }
                              if (e.key === 'Escape') {
                                setNewNotebookName(null);
                                setNewNotebookParentId(null);
                              }
                            }}
                            onBlur={() => {
                              if (newNotebookName?.trim())
                                handleCreateNotebook(newNotebookName.trim());
                              else {
                                setNewNotebookName(null);
                                setNewNotebookParentId(null);
                              }
                            }}
                            placeholder={t('notes.notebookName', 'Notebook name...')}
                            className="notes-list__notebook-input"
                          />
                        </div>
                      )}
                    </React.Fragment>
                  ))}
                  {newNotebookName !== null && newNotebookParentId === null && (
                    <div className="notes-list__notebook-new">
                      <input
                        autoFocus
                        value={newNotebookName}
                        onChange={(e) => setNewNotebookName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && newNotebookName.trim()) {
                            handleCreateNotebook(newNotebookName.trim());
                          }
                          if (e.key === 'Escape') setNewNotebookName(null);
                        }}
                        onBlur={() => {
                          if (newNotebookName?.trim()) handleCreateNotebook(newNotebookName.trim());
                          else setNewNotebookName(null);
                        }}
                        placeholder={t('notes.notebookName', 'Notebook name...')}
                        className="notes-list__notebook-input"
                      />
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Trash entry — visible only when there's something to recover.
            Clicking opens the trash modal. */}
            {trashedNotesCount > 0 && (
              <div className="notes-list__trash-entry">
                <button
                  type="button"
                  className="notes-list__notebook-item notes-list__trash-button"
                  onClick={() => setTrashModalOpen(true)}
                  title={t('notes.trash.title', 'Corbeille des notes')}
                >
                  <span className="notes-list__notebook-icon">🗑️</span>
                  <span className="notes-list__notebook-name">
                    {t('notes.trash.sidebar', 'Corbeille')}
                  </span>
                  <span className="notes-list__notebook-count">{trashedNotesCount}</span>
                </button>
              </div>
            )}

            {/* Conflits en attente d'arbitrage. La pastille ATTEND : un conflit naît
            d'un cycle de synchronisation, donc à un instant arbitraire, et faire
            surgir la fenêtre en pleine frappe serait pire que le conflit. */}
            {conflictCount > 0 && (
              <div className="notes-list__trash-entry">
                <button
                  type="button"
                  className="notes-list__notebook-item notes-list__trash-button"
                  onClick={() => setConflictModalOpen(true)}
                  title={t('notes.conflict.title', 'Resolve conflicts')}
                >
                  <span className="notes-list__notebook-icon">⚠️</span>
                  <span className="notes-list__notebook-name">
                    {t('notes.conflict.sidebar', 'Conflicts to resolve')}
                  </span>
                  <span className="notes-list__notebook-count">{conflictCount}</span>
                </button>
              </div>
            )}

            {/* Nettoyage des notes parasites — même emplacement que la corbeille,
            visible uniquement quand le détecteur a trouvé quelque chose. */}
            {suspectNotesCount > 0 && (
              <div className="notes-list__trash-entry">
                <button
                  type="button"
                  className="notes-list__notebook-item notes-list__trash-button"
                  onClick={() => setCleanupModalOpen(true)}
                  title={t('notes.cleanup.title', 'Clean up ghost notes')}
                >
                  <span className="notes-list__notebook-icon">🧹</span>
                  <span className="notes-list__notebook-name">
                    {t('notes.cleanup.sidebar', 'Ghost notes')}
                  </span>
                  <span className="notes-list__notebook-count">{suspectNotesCount}</span>
                </button>
              </div>
            )}
          </>
        )}

        {/* Les fenêtres restent montées quel que soit l'écran : elles s'ouvrent
            depuis « parcourir », mais un changement d'écran ne doit pas les
            faire disparaître sous les doigts. */}
        <NotesTrashModal isOpen={trashModalOpen} onClose={() => setTrashModalOpen(false)} />
        <NotesCleanupModal isOpen={cleanupModalOpen} onClose={() => setCleanupModalOpen(false)} />
        <NoteConflictModal isOpen={conflictModalOpen} onClose={() => setConflictModalOpen(false)} />

        {/* Notebook Editor Popover */}
        {editingNotebookId &&
          (() => {
            const nb = notebooks.find((n) => n.id === editingNotebookId);
            if (!nb) return null;
            const NOTEBOOK_COLORS = [
              '#4682b4',
              '#e63946',
              '#2a9d8f',
              '#e9c46a',
              '#f4a261',
              '#8338ec',
              '#ff006e',
              '#06d6a0',
            ];
            const NOTEBOOK_ICONS = [
              '📕',
              '📗',
              '📘',
              '📙',
              '📓',
              '📔',
              '📒',
              '🗂️',
              '💼',
              '🎓',
              '🔬',
              '💡',
            ];
            return (
              <div className="notes-list__notebook-editor" onClick={(e) => e.stopPropagation()}>
                <div className="notes-list__notebook-editor-header">
                  <span>{t('notes.editNotebook', 'Edit Notebook')}</span>
                  <span
                    className="notes-list__notebook-editor-close"
                    role="button"
                    onClick={() => setEditingNotebookId(null)}
                  >
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2.5}
                    >
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </span>
                </div>
                <input
                  className="notes-list__notebook-editor-name"
                  value={nb.name}
                  onChange={(e) =>
                    dispatch(updateNotebook({ id: nb.id, changes: { name: e.target.value } }))
                  }
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === 'Escape') setEditingNotebookId(null);
                  }}
                  placeholder={t('notes.notebookName', 'Notebook name...')}
                  autoFocus
                />
                <div className="notes-list__notebook-editor-label">
                  {t('notes.notebookColor', 'Color')}
                </div>
                <div className="notes-list__notebook-editor-colors">
                  {NOTEBOOK_COLORS.map((c) => (
                    <span
                      key={c}
                      className={`notes-list__notebook-editor-color ${nb.color === c ? 'is-active' : ''}`}
                      style={{ background: c }}
                      role="button"
                      onClick={() => dispatch(updateNotebook({ id: nb.id, changes: { color: c } }))}
                    />
                  ))}
                </div>
                <div className="notes-list__notebook-editor-label">
                  {t('notes.notebookIcon', 'Icon')}
                </div>
                <div className="notes-list__notebook-editor-icons">
                  {NOTEBOOK_ICONS.map((icon) => (
                    <span
                      key={icon}
                      className={`notes-list__notebook-editor-icon ${nb.icon === icon ? 'is-active' : ''}`}
                      role="button"
                      onClick={() => dispatch(updateNotebook({ id: nb.id, changes: { icon } }))}
                    >
                      {icon}
                    </span>
                  ))}
                </div>
              </div>
            );
          })()}

        {/* ===== Écran « notes » : rien que la portée choisie ===== */}
        {screen === 'notes' && (
          <>
            {/* Selection action bar */}
            {selectionMode && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '5px 10px',
                  borderBottom: '1px solid var(--color-border-light)',
                  background: 'var(--color-background-secondary)',
                }}
              >
                <button
                  onClick={selectedIds.size === notes.length ? deselectAll : selectAllNotesFn}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: 11,
                    color: 'var(--color-text-secondary)',
                    padding: '3px 6px',
                    borderRadius: 4,
                  }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.background = 'var(--color-hover-overlay)')
                  }
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
                >
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2.5}
                  >
                    <rect x="3" y="3" width="18" height="18" rx="3" />
                    {selectedIds.size === notes.length && <polyline points="9,12 11,14 15,10" />}
                  </svg>
                  {selectedIds.size === notes.length ? 'Aucune' : 'Toutes'}
                </button>
                <span
                  style={{
                    fontSize: 11,
                    color: 'var(--color-text-tertiary)',
                    flex: 1,
                    textAlign: 'center',
                  }}
                >
                  {selectedIds.size > 0
                    ? `${selectedIds.size} / ${notes.length}`
                    : `${notes.length} notes`}
                </span>
                {selectedIds.size > 0 && (
                  <button
                    onClick={handlePinSelected}
                    title={t('notes.pinSelected', 'Épingler / désépingler la sélection')}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      fontSize: 11,
                      color: 'var(--color-text-secondary)',
                      padding: '3px 6px',
                      borderRadius: 4,
                    }}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.background = 'var(--color-hover-overlay)')
                    }
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
                  >
                    <PinIcon />
                    {t('notes.pin', 'Pin')}
                  </button>
                )}
                {/* « Ajouter au coffre » en lot — visible seulement s'il existe un
                coffre déverrouillé où déposer (même condition que le menu). */}
                {selectedIds.size > 0 && canAddToVault && (
                  <button
                    onClick={handleAddSelectionToVault}
                    title={t('notes.addSelectionToVault', 'Add the selection to a shared vault')}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      fontSize: 11,
                      color: 'var(--color-text-secondary)',
                      padding: '3px 6px',
                      borderRadius: 4,
                    }}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.background = 'var(--color-hover-overlay)')
                    }
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
                  >
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2.5}
                    >
                      <rect x="3" y="4" width="18" height="16" rx="2" />
                      <circle cx="12" cy="12" r="3.5" />
                    </svg>
                    {t('teamVaults.addToVault.batchButton', 'Add to vault')}
                  </button>
                )}
                {selectedIds.size > 0 && (
                  <button
                    onClick={() => setShowDeleteConfirm(true)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      fontSize: 11,
                      color: 'var(--color-error, #ef4444)',
                      padding: '3px 6px',
                      borderRadius: 4,
                    }}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.background = 'rgba(239,68,68,0.08)')
                    }
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
                  >
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2.5}
                    >
                      <path d="M3 6h18M8 6V4h8v2M5 6v14a2 2 0 002 2h10a2 2 0 002-2V6" />
                    </svg>
                    Supprimer
                  </button>
                )}
              </div>
            )}

            {/* Delete progress overlay */}
            {deleteProgress && (
              <div
                style={{
                  padding: '16px 12px',
                  textAlign: 'center',
                  background: 'var(--color-background-secondary)',
                  borderBottom: '1px solid var(--color-border-light)',
                }}
              >
                <div
                  style={{
                    height: 4,
                    borderRadius: 2,
                    overflow: 'hidden',
                    background: 'var(--color-border-light)',
                    marginBottom: 8,
                  }}
                >
                  <div
                    style={{
                      height: '100%',
                      borderRadius: 2,
                      background: 'var(--color-error, #ef4444)',
                      width: `${(deleteProgress.current / deleteProgress.total) * 100}%`,
                      transition: 'width 0.15s',
                    }}
                  />
                </div>
                <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
                  Suppression — {deleteProgress.current}/{deleteProgress.total}
                </span>
              </div>
            )}

            {/* Notes list or tree */}
            {viewType === 'tree' ? (
              <NoteTree onSelectNote={handleSelect} onContextMenu={handleContextMenu} />
            ) : notes.length === 0 ? (
              <div className="notes-list__items">
                <div className="notes-list__empty">
                  <NoteIcon />
                  <p>{t('notes.emptyTitle', 'No notes yet')}</p>
                  <button className="notes-list__empty-btn" onClick={handleNewNote}>
                    {t('notes.createFirst', 'Create your first note')}
                  </button>
                </div>
              </div>
            ) : (
              <Virtuoso
                style={{ flex: 1 }}
                totalCount={notes.length}
                overscan={200}
                defaultItemHeight={72}
                components={{
                  List: forwardRef((props, ref) => (
                    <div {...props} ref={ref} className="notes-list__items" />
                  )),
                }}
                itemContent={(index) => {
                  const note = notes[index];
                  if (!note) return null;
                  return (
                    <NoteCard
                      key={note.id}
                      note={note}
                      isSelected={note.id === selectedNoteId}
                      isOrphan={orphanIds.has(note.id)}
                      folderName={note.parentId ? foldersById[note.parentId]?.name : undefined}
                      notebookName={
                        note.notebookId ? notebooksMap[note.notebookId]?.name : undefined
                      }
                      notebookColor={
                        note.notebookId ? notebooksMap[note.notebookId]?.color : undefined
                      }
                      onSelect={handleSelect}
                      onDelete={handleDelete}
                      onPin={handlePin}
                      onContextMenu={handleContextMenu}
                      selectionMode={selectionMode}
                      isChecked={selectedIds.has(note.id)}
                      onToggleCheck={toggleNoteSelection}
                      reorderable={sortBy === 'manual' && !selectionMode}
                      dropEdge={reorderTarget?.noteId === note.id ? reorderTarget.edge : null}
                      onReorderDragOver={handleReorderDragOver}
                      onReorderDrop={handleReorderDrop}
                      onReorderDragEnd={handleReorderDragEnd}
                    />
                  );
                }}
              />
            )}
          </>
        )}
      </div>
      {/* end notes-list__scroll-area */}

      {/* Save as template button (visible when editing a note) */}
      {editingNote && (
        <div className="notes-list__save-template">
          <button className="notes-list__save-template-btn" onClick={handleSaveAsTemplate}>
            <TemplateButtonIcon />
            <span>{t('notes.saveAsTemplate', 'Save as Template')}</span>
          </button>
        </div>
      )}

      {/* Template Manager Modal */}
      <TemplateManager isOpen={showTemplateManager} onClose={() => setShowTemplateManager(false)} />

      {/* Flashcard View Modal */}
      {showFlashcards && <FlashcardView onClose={() => setShowFlashcards(false)} />}

      {/* In-App Wiki Modal */}
      {showWiki && <InAppWiki onClose={() => setShowWiki(false)} />}

      {/* Note Context Menu */}
      {contextMenu && contextMenuNote && (
        <NoteContextMenu
          note={contextMenuNote}
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={handleCloseContextMenu}
          onPin={handlePin}
          onDelete={handleDelete}
          onDuplicate={handleDuplicate}
          onSaveAsTemplate={handleSaveNoteAsTemplate}
          onExport={handleExportNote}
          onAddReminder={handleAddReminderToNote}
          notebooks={notebooks}
          onMoveToNotebook={handleMoveToNotebook}
          onMoveToVault={canAddToVault ? setMoveToVaultNote : undefined}
          moveToVaultDisabledReason={
            addToVaultState === 'disabled'
              ? t('teamVaults.addToVault.noUnlockedVault', 'No unlocked vault available')
              : undefined
          }
        />
      )}

      {canAddToVault && (
        <AddToVaultDialog
          isOpen={!!moveToVaultNote}
          onClose={() => setMoveToVaultNote(null)}
          source={moveToVaultSource}
        />
      )}

      {/* Le lot de la sélection — le MÊME dialogue, source « notes ». Après un
          « Déplacer », les notes sont à la corbeille : la sélection, qui les
          désignait, est vidée (`onLocalChanged`). */}
      {canAddToVault && (
        <AddToVaultDialog
          isOpen={!!batchVaultSource}
          onClose={() => setBatchVaultSource(null)}
          source={batchVaultSource}
          onLocalChanged={deselectAll}
        />
      )}

      {/* Reminder modal — note-scoped (reuses the generic ReminderModal,
         which is already battle-tested on folders/files). */}
      {reminderNote && (
        <ReminderModal
          isOpen={!!reminderNote}
          onClose={() => setReminderNote(null)}
          onSubmit={handleConfirmNoteReminder}
          itemName={reminderNote.title}
        />
      )}

      {/* Export Dialog */}
      {exportNote && <ExportDialog note={exportNote} onClose={() => setExportNote(null)} />}

      {/* External Import Wizard */}
      <ImportWizard isOpen={importWizardOpen} onClose={() => setImportWizardOpen(false)} />

      {/* Delete confirmation modal */}
      <ConfirmModal
        isOpen={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        onConfirm={executeDeleteSelected}
        title={`Supprimer ${selectedIds.size} note(s)`}
        message={`Vous êtes sur le point de supprimer ${selectedIds.size} note(s). Cette action est irréversible.`}
        confirmText={`Supprimer (${selectedIds.size})`}
        cancelText="Annuler"
        variant="danger"
      />
    </div>
  );
});

// ==================== Note Card ====================

interface NoteCardProps {
  note: Note;
  isSelected: boolean;
  isOrphan: boolean;
  folderName?: string;
  notebookName?: string;
  notebookColor?: string;
  onSelect: (id: string) => void;
  onDelete: (e: React.MouseEvent, id: string) => void;
  onPin: (e: React.MouseEvent, id: string) => void;
  onContextMenu?: (e: React.MouseEvent, noteId: string) => void;
  selectionMode?: boolean;
  isChecked?: boolean;
  onToggleCheck?: (id: string) => void;
  /**
   * Manual-order drag hooks. Only wired when the list is sorted manually —
   * reordering a list sorted by date would be meaningless, since the next
   * edit would move the note straight back.
   */
  reorderable?: boolean;
  dropEdge?: 'above' | 'below' | null;
  onReorderDragOver?: (e: React.DragEvent, noteId: string) => void;
  onReorderDrop?: (e: React.DragEvent) => void;
  onReorderDragEnd?: () => void;
}

const FolderSmallIcon = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
  </svg>
);

const NoteCard: React.FC<NoteCardProps> = React.memo(function NoteCard({
  note,
  isSelected,
  isOrphan,
  folderName,
  notebookName,
  notebookColor,
  onSelect,
  onDelete,
  onPin,
  onContextMenu,
  selectionMode,
  isChecked,
  onToggleCheck,
  reorderable,
  dropEdge,
  onReorderDragOver,
  onReorderDrop,
  onReorderDragEnd,
}) {
  const { t } = useTranslation();
  return (
    <div
      className={`notes-list__card ${isSelected ? 'notes-list__card--selected' : ''} ${note.isPinned ? 'notes-list__card--pinned' : ''} ${isChecked ? 'notes-list__card--checked' : ''} ${dropEdge ? `notes-list__card--drop-${dropEdge}` : ''}`}
      onClick={() => (selectionMode ? onToggleCheck?.(note.id) : onSelect(note.id))}
      onContextMenu={(e) => onContextMenu?.(e, note.id)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onSelect(note.id)}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('application/x-filarr-note', note.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      onDragOver={reorderable ? (e) => onReorderDragOver?.(e, note.id) : undefined}
      onDrop={reorderable ? onReorderDrop : undefined}
      onDragEnd={reorderable ? onReorderDragEnd : undefined}
    >
      <div className="notes-list__card-header">
        {selectionMode && (
          <div
            onClick={(e) => {
              e.stopPropagation();
              onToggleCheck?.(note.id);
            }}
            style={{
              width: 18,
              height: 18,
              borderRadius: 4,
              flexShrink: 0,
              cursor: 'pointer',
              border: isChecked ? 'none' : '2px solid var(--color-border-strong)',
              background: isChecked ? 'var(--color-primary-500)' : 'transparent',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginRight: 6,
            }}
          >
            {isChecked && (
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#fff"
                strokeWidth={3}
              >
                <polyline points="4,12 10,18 20,6" />
              </svg>
            )}
          </div>
        )}
        <div className="notes-list__card-icon">
          {note.isDaily ? <CalendarIcon /> : <NoteIcon />}
        </div>
        <h3 className="notes-list__card-title">{note.title || t('notes.untitled', 'Untitled')}</h3>
        <NoteSyncBadge note={note} variant="compact" />
        <NoteSharedBadge noteId={note.id} variant="dot" />
        {isOrphan && (
          <span className="notes-list__orphan-badge" title="Unlinked note — no connections">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="12" cy="12" r="10" />
            </svg>
          </span>
        )}
        <div className="notes-list__card-actions">
          <button
            className={`notes-list__card-action ${note.isPinned ? 'is-pinned' : ''}`}
            onClick={(e) => onPin(e, note.id)}
            title="Pin"
          >
            <PinIcon filled={note.isPinned} />
          </button>
          <button
            className="notes-list__card-action notes-list__card-action--delete"
            onClick={(e) => onDelete(e, note.id)}
            title="Delete"
          >
            <TrashIcon />
          </button>
        </div>
      </div>
      <p className="notes-list__card-preview">{getNotePreview(note.plainText)}</p>
      <div className="notes-list__card-meta">
        <span>{formatRelativeDate(note.updatedAt)}</span>
        {note.wordCount > 0 && (
          <span>
            {note.wordCount} {t('notes.words', 'words')}
          </span>
        )}
        {note.linkedNoteIds.length > 0 && (
          <span>
            {note.linkedNoteIds.length} {t('notes.links', 'links')}
          </span>
        )}
      </div>
      {/* La rangée existe aussi pour le seul chip « Coffre » : une note déposée
          sans dossier ni carnet doit quand même dire où sa copie est partie. */}
      {(folderName || notebookName || (note.sharedTo && note.sharedTo.length > 0)) && (
        <div className="notes-list__card-location">
          <NoteSharedBadge noteId={note.id} variant="chip" />
          {folderName && (
            <span className="notes-list__card-location-item" title={folderName}>
              <FolderSmallIcon />
              {folderName}
            </span>
          )}
          {notebookName && (
            <span className="notes-list__card-location-item" title={notebookName}>
              <span
                className="notes-list__card-location-dot"
                style={{ background: notebookColor || '#4682b4' }}
              />
              {notebookName}
            </span>
          )}
        </div>
      )}
    </div>
  );
});

export default NotesList;
