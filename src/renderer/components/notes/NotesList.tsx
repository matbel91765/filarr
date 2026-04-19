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
  selectNote,
  selectAllNotes,
  selectAllNotebooks,
  setNotesSearchQuery,
  setNotesSortBy,
  setNotesSortOrder,
  setNotesFilterNotebook,
  createNewNote,
  getOrCreateDailyNote,
  deleteNote,
  deleteNotesBatch,
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
import type { Note, NotesState, NoteTemplate, Notebook } from '../../../types/notes';
import { TemplateManager } from './TemplateManager';
import { FlashcardView } from './FlashcardView';
import { InAppWiki } from './InAppWiki';
import { ConfirmModal } from '../ui/ConfirmModal/ConfirmModal';
import { ExportDialog } from './ExportDialog';
import { NoteTree } from './NoteTree';
import { importNoteFromFile, importBulkFromJson } from '../../../services/notes/noteImportService';
import ImportWizard from './ImportWizard';
import './NotesList.css';

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
  notebooks: Notebook[];
  onMoveToNotebook: (noteId: string, notebookId: string | null) => void;
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
  notebooks,
  onMoveToNotebook,
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

export const NotesList: React.FC<NotesListProps> = React.memo(function NotesList({ onSelectNote }) {
  const { t } = useTranslation();
  const dispatch = useDispatch<AppDispatch>();

  const [viewType, setViewType] = useState<'list' | 'tree'>('list');
  const [showTemplateManager, setShowTemplateManager] = useState(false);
  const [showFlashcards, setShowFlashcards] = useState(false);
  const [showWiki, setShowWiki] = useState(false);
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
  const filterNotebookId = useSelector((s: RootState) => s.notes.filterNotebookId);
  const allNotesForCount = useSelector(selectAllNotes);
  const foldersById = useSelector((s: RootState) => s.folders.byId);
  const [notebooksExpanded, setNotebooksExpanded] = useState(true);
  const [newNotebookName, setNewNotebookName] = useState<string | null>(null);
  const [editingNotebookId, setEditingNotebookId] = useState<string | null>(null);
  const [dropTargetNotebookId, setDropTargetNotebookId] = useState<string | null>(null);
  const [pinnedExpanded, setPinnedExpanded] = useState(true);
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

  const notebooksMap = useMemo(() => {
    const map: Record<string, Notebook> = {};
    for (const nb of notebooks) map[nb.id] = nb;
    return map;
  }, [notebooks]);

  const notebookNoteCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const note of allNotesForCount) {
      if (note.notebookId) {
        counts[note.notebookId] = (counts[note.notebookId] || 0) + 1;
      }
    }
    return counts;
  }, [allNotesForCount]);

  const handleNewNote = useCallback(() => {
    dispatch(createNewNote({ title: '' })).then((action: any) => {
      if (filterNotebookId && action.payload?.id) {
        dispatch(setNoteNotebook({ noteId: action.payload.id, notebookId: filterNotebookId }));
      }
    });
  }, [dispatch, filterNotebookId]);

  const handleDailyNote = useCallback(() => {
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

  const handleSearch = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      dispatch(setNotesSearchQuery(e.target.value));
    },
    [dispatch]
  );

  const handleSortToggle = useCallback(() => {
    const sorts: NotesState['sortBy'][] = ['updatedAt', 'title', 'createdAt', 'wordCount'];
    const idx = sorts.indexOf(sortBy);
    const next = sorts[(idx + 1) % sorts.length];
    dispatch(setNotesSortBy(next));
  }, [dispatch, sortBy]);

  const handleSortOrderToggle = useCallback(() => {
    dispatch(setNotesSortOrder(sortOrder === 'asc' ? 'desc' : 'asc'));
  }, [dispatch, sortOrder]);

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

  const handleMoveToNotebook = useCallback(
    (noteId: string, notebookId: string | null) => {
      dispatch(setNoteNotebook({ noteId, notebookId }));
    },
    [dispatch]
  );

  const handleCreateNotebook = useCallback(
    (name: string) => {
      dispatch(addNotebook({ name }));
      setNewNotebookName(null);
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
    };
    return labels[sortBy];
  }, [sortBy, t]);

  return (
    <div className="notes-list">
      {/* Header */}
      <div className="notes-list__header">
        <h2 className="notes-list__title">{t('notes.title', 'Notes')}</h2>
        <div className="notes-list__actions">
          <button
            className="notes-list__action-btn"
            onClick={() => setShowWiki(true)}
            title={t('notes.wiki', 'Help')}
          >
            <WikiIcon />
          </button>
          <button
            className="notes-list__action-btn"
            onClick={() => setShowFlashcards(true)}
            title={t('notes.flashcards', 'Flashcards')}
          >
            <FlashcardIcon />
          </button>
          <button
            className="notes-list__action-btn"
            onClick={() => setShowTemplateManager(true)}
            title={t('notes.templateManager', 'Templates')}
          >
            <TemplateButtonIcon />
          </button>
          <button
            className="notes-list__action-btn"
            onClick={() => importInputRef.current?.click()}
            title={t('notes.importNote', 'Import Note')}
          >
            <ImportIcon />
          </button>
          <input
            ref={importInputRef}
            type="file"
            accept=".md,.markdown,.html,.htm,.filarr,.txt,.json"
            style={{ display: 'none' }}
            onChange={handleImportFile}
          />
          <button
            className="notes-list__action-btn"
            onClick={() => setImportWizardOpen(true)}
            title={t('notes.importExternal', 'Import from Obsidian, Notion, Evernote...')}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path d="M12 3v12" />
              <path d="M8 11l4 4 4-4" />
              <rect x="3" y="17" width="18" height="4" rx="1" />
            </svg>
          </button>
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
          type="text"
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

      {/* Sort bar */}
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

      {/* Scrollable content area */}
      <div className="notes-list__scroll-area">
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
              onClick={() => setNewNotebookName('')}
              title={t('notes.newNotebook', 'New Notebook')}
            >
              <PlusIcon />
            </button>
          </div>
          {notebooksExpanded && (
            <div className="notes-list__notebooks-list">
              <div
                className={`notes-list__notebook-item ${filterNotebookId === null ? 'is-active' : ''} ${dropTargetNotebookId === '__all__' ? 'is-drop-target' : ''}`}
                onClick={() => dispatch(setNotesFilterNotebook(null))}
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
                  setDropTargetNotebookId(null);
                }}
              >
                <span className="notes-list__notebook-icon">{'📓'}</span>
                <span className="notes-list__notebook-name">
                  {t('notes.allNotes', 'All Notes')}
                </span>
                <span className="notes-list__notebook-count">{allNotesForCount.length}</span>
              </div>
              {notebooks.map((nb) => (
                <div
                  key={nb.id}
                  className={`notes-list__notebook-item ${filterNotebookId === nb.id ? 'is-active' : ''} ${dropTargetNotebookId === nb.id ? 'is-drop-target' : ''}`}
                  onClick={() => dispatch(setNotesFilterNotebook(nb.id))}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setEditingNotebookId(nb.id);
                  }}
                  onDragOver={(e) => {
                    if (e.dataTransfer.types.includes('application/x-filarr-note')) {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'move';
                      setDropTargetNotebookId(nb.id);
                    }
                  }}
                  onDragLeave={() => setDropTargetNotebookId(null)}
                  onDrop={(e) => {
                    e.preventDefault();
                    const noteId = e.dataTransfer.getData('application/x-filarr-note');
                    if (noteId) dispatch(setNoteNotebook({ noteId, notebookId: nb.id }));
                    setDropTargetNotebookId(null);
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
              ))}
              {newNotebookName !== null && (
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
                onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(239,68,68,0.08)')}
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
          <NoteTree onSelectNote={handleSelect} />
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
                  notebookName={note.notebookId ? notebooksMap[note.notebookId]?.name : undefined}
                  notebookColor={note.notebookId ? notebooksMap[note.notebookId]?.color : undefined}
                  onSelect={handleSelect}
                  onDelete={handleDelete}
                  onPin={handlePin}
                  onContextMenu={handleContextMenu}
                  selectionMode={selectionMode}
                  isChecked={selectedIds.has(note.id)}
                  onToggleCheck={toggleNoteSelection}
                />
              );
            }}
          />
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
          notebooks={notebooks}
          onMoveToNotebook={handleMoveToNotebook}
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
}) {
  const { t } = useTranslation();
  return (
    <div
      className={`notes-list__card ${isSelected ? 'notes-list__card--selected' : ''} ${note.isPinned ? 'notes-list__card--pinned' : ''} ${isChecked ? 'notes-list__card--checked' : ''}`}
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
      {(folderName || notebookName) && (
        <div className="notes-list__card-location">
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
