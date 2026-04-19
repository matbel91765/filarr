/**
 * NotesView Component — Filarr Notes
 *
 * Main view orchestrating the Notes feature:
 * - Left panel: NotesList (sidebar with all notes)
 * - Center: NoteEditor (TipTap)
 * - Bottom: BacklinksPanel
 * - Graph mode: GraphView
 */

import React, { Component, useCallback, useEffect, useRef, useState } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector, useDispatch } from 'react-redux';
import type { RootState, AppDispatch } from '../../../store';
import {
  selectEditingNote,
  selectNote,
  setEditingNote,
  updateNoteContent,
  updateNote,
  addNote,
  resolveNoteLinks,
  setNotesViewMode,
} from '../../../store/slices/notesSlice';
import {
  createDailyNote as createDailyNoteForDate,
  createNote as createNoteService,
} from '../../../services/notes/noteService';
import { NotesList } from './NotesList';
import { NoteEditor } from './NoteEditor';
import type { NoteEditorCommentsHandle } from './NoteEditor';
import { BacklinksPanel } from './BacklinksPanel';
import { NoteFolderPicker } from './NoteFolderPicker';
import { NoteBreadcrumb } from './NoteBreadcrumb';
import { LinkPreviewPopover } from './LinkPreviewPopover';
import { GraphView } from './GraphView';
import { MasonryView } from './MasonryView';
import { KanbanView } from './KanbanView';
import { StickyNotesView } from './StickyNotesView';
import { DatabaseView } from './DatabaseView';
import { SmartTagsSuggestion } from './SmartTagsSuggestion';
import { OutlinePanel } from './OutlinePanel';
import { CommentsPanel } from './CommentsPanel';
import type { NoteComment } from './CommentsPanel';
import { TasksAggregator } from './TasksAggregator';
import MindMapView from './MindMapView';
import { CalendarWidget } from './CalendarWidget';
import { PeriodicNotes } from './PeriodicNotes';
import StyleSettingsPanel from './StyleSettingsPanel';
import QuickSwitcherPlus from './QuickSwitcherPlus';
import { TemplaterModal } from './TemplaterModal';
import './NotesView.css';

// ==================== Icons ====================

const ListViewIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <line x1="8" y1="6" x2="21" y2="6" />
    <line x1="8" y1="12" x2="21" y2="12" />
    <line x1="8" y1="18" x2="21" y2="18" />
    <line x1="3" y1="6" x2="3.01" y2="6" />
    <line x1="3" y1="12" x2="3.01" y2="12" />
    <line x1="3" y1="18" x2="3.01" y2="18" />
  </svg>
);

const GraphViewIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <circle cx="6" cy="6" r="3" />
    <circle cx="18" cy="6" r="3" />
    <circle cx="6" cy="18" r="3" />
    <circle cx="18" cy="18" r="3" />
    <line x1="8.5" y1="7.5" x2="15.5" y2="16.5" />
    <line x1="15.5" y1="7.5" x2="8.5" y2="16.5" />
  </svg>
);

const MasonryViewIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <rect x="3" y="3" width="7" height="10" rx="1" />
    <rect x="14" y="3" width="7" height="6" rx="1" />
    <rect x="3" y="16" width="7" height="5" rx="1" />
    <rect x="14" y="12" width="7" height="9" rx="1" />
  </svg>
);

const KanbanViewIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <rect x="3" y="3" width="5" height="18" rx="1" />
    <rect x="10" y="3" width="5" height="12" rx="1" />
    <rect x="17" y="3" width="5" height="15" rx="1" />
  </svg>
);

const StickyViewIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <path d="M15.5 3H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V8.5L15.5 3z" />
    <path d="M14 3v6h6" />
  </svg>
);

const DatabaseViewIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <line x1="3" y1="9" x2="21" y2="9" />
    <line x1="3" y1="15" x2="21" y2="15" />
    <line x1="9" y1="3" x2="9" y2="21" />
  </svg>
);

const TasksViewIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <rect x="3" y="5" width="6" height="6" rx="1" />
    <path d="M5 8l1.5 1.5L9 7" />
    <line x1="13" y1="8" x2="21" y2="8" />
    <rect x="3" y="14" width="6" height="6" rx="1" />
    <path d="M5 17l1.5 1.5L9 16" />
    <line x1="13" y1="17" x2="21" y2="17" />
  </svg>
);

const MindMapViewIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <circle cx="12" cy="12" r="3" />
    <line x1="15" y1="12" x2="20" y2="6" />
    <line x1="15" y1="12" x2="20" y2="18" />
    <line x1="9" y1="12" x2="4" y2="8" />
    <line x1="9" y1="12" x2="4" y2="16" />
    <circle cx="20" cy="6" r="2" />
    <circle cx="20" cy="18" r="2" />
    <circle cx="4" cy="8" r="2" />
    <circle cx="4" cy="16" r="2" />
  </svg>
);

const EmptyNoteIcon = () => (
  <svg
    width="64"
    height="64"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={0.8}
    opacity={0.3}
  >
    <path d="M14.5 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V7.5L14.5 2z" />
    <polyline points="14,2 14,8 20,8" />
    <line x1="16" y1="13" x2="8" y2="13" />
    <line x1="16" y1="17" x2="8" y2="17" />
    <line x1="10" y1="9" x2="8" y2="9" />
  </svg>
);

// ==================== Graph Error Boundary ====================

interface GraphErrorBoundaryProps {
  children: ReactNode;
  onReset: () => void;
}

interface GraphErrorBoundaryState {
  hasError: boolean;
}

class GraphErrorBoundary extends Component<GraphErrorBoundaryProps, GraphErrorBoundaryState> {
  state: GraphErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): GraphErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[GraphView] Crashed:', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="notes-view__empty">
          <p style={{ opacity: 0.6 }}>Graph view encountered an error.</p>
          <button
            className="notes-view__mode-btn"
            style={{
              marginTop: 12,
              padding: '6px 16px',
              background: 'var(--color-primary-600, #4682b4)',
              color: '#fff',
              borderRadius: 6,
              border: 'none',
              cursor: 'pointer',
            }}
            onClick={() => {
              this.setState({ hasError: false });
              this.props.onReset();
            }}
          >
            Switch to List View
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ==================== Component ====================

interface NotesViewProps {
  initialNoteId?: string;
}

export const NotesView: React.FC<NotesViewProps> = React.memo(function NotesView({
  initialNoteId,
}) {
  const { t } = useTranslation();
  const dispatch = useDispatch<AppDispatch>();

  const editorAreaRef = useRef<HTMLDivElement>(null);
  const commentsHandleRef = useRef<NoteEditorCommentsHandle | null>(null);

  // Draggable mode toggle bar
  const [modeBarPos, setModeBarPos] = useState<{ x: number; y: number } | null>(null);
  const [isDraggingModeBar, setIsDraggingModeBar] = useState(false);
  const modeBarDragOffset = useRef({ x: 0, y: 0 });

  const handleModeBarDragStart = useCallback(
    (e: React.MouseEvent) => {
      if ((e.target as HTMLElement).tagName === 'BUTTON') return;
      e.preventDefault();
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const parentRect = (e.currentTarget as HTMLElement).offsetParent?.getBoundingClientRect() || {
        left: 0,
        top: 0,
      };
      const currentX = modeBarPos?.x ?? rect.left - parentRect.left;
      const currentY = modeBarPos?.y ?? rect.top - parentRect.top;
      setIsDraggingModeBar(true);
      modeBarDragOffset.current = { x: e.clientX - currentX, y: e.clientY - currentY };
    },
    [modeBarPos]
  );

  useEffect(() => {
    if (!isDraggingModeBar) return;
    const handleMove = (e: MouseEvent) => {
      setModeBarPos({
        x: e.clientX - modeBarDragOffset.current.x,
        y: e.clientY - modeBarDragOffset.current.y,
      });
    };
    const handleUp = () => setIsDraggingModeBar(false);
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [isDraggingModeBar]);

  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const [notesListOpen, setNotesListOpen] = useState(true);
  const [editorComments, setEditorComments] = useState<Record<string, NoteComment>>({});
  const [quickSwitcherOpen, setQuickSwitcherOpen] = useState(false);
  const [templaterOpen, setTemplaterOpen] = useState(false);
  const [showStyleSettings, setShowStyleSettings] = useState(false);
  const viewMode = useSelector((s: RootState) => s.notes.viewMode);
  const globalEditingNote = useSelector(selectEditingNote);
  const selectedNoteId = useSelector((s: RootState) => s.notes.selectedNoteId);
  const allNotesById = useSelector((s: RootState) => s.notes.byId);
  const isSplit = useSelector((s: RootState) => s.tabs.panels.length > 1);

  // In split mode, each panel manages its own editing note locally to avoid
  // one panel overriding the other's state via global editingNoteId.
  const [localNoteId, setLocalNoteId] = useState<string | null>(initialNoteId ?? null);
  const useLocalState = isSplit || !!initialNoteId;

  // Derive editing note: split/fixed panels use local state, single-panel uses global
  const editingNote = useLocalState
    ? localNoteId
      ? (allNotesById[localNoteId] ?? null)
      : null
    : globalEditingNote;

  // Sync local state from global when entering split mode with an existing editing note
  useEffect(() => {
    if (useLocalState && !localNoteId && globalEditingNote) {
      setLocalNoteId(globalEditingNote.id);
    }
  }, [useLocalState, localNoteId, globalEditingNote]);

  // Auto-select note when opened via /notes/:noteId route (e.g. split editing)
  useEffect(() => {
    if (initialNoteId) {
      if (useLocalState) {
        setLocalNoteId(initialNoteId);
      } else {
        dispatch(setEditingNote(initialNoteId));
      }
    }
  }, [initialNoteId, dispatch, useLocalState]);

  // When selecting a note, set it as editing
  const handleSelectNote = useCallback(
    (noteId: string) => {
      if (useLocalState) {
        setLocalNoteId(noteId);
      } else {
        dispatch(setEditingNote(noteId));
      }
    },
    [dispatch, useLocalState]
  );

  // Handle content updates with link resolution
  const handleContentUpdate = useCallback(
    (content: string, plainText: string) => {
      if (!editingNote) return;
      dispatch(updateNoteContent({ id: editingNote.id, content, plainText }));
      // Debounced link resolution
      dispatch(resolveNoteLinks(editingNote.id));
    },
    [dispatch, editingNote]
  );

  const handleTitleChange = useCallback(
    (title: string) => {
      if (!editingNote) return;
      dispatch(updateNote({ id: editingNote.id, changes: { title } }));
    },
    [dispatch, editingNote]
  );

  const handleCommentsChange = useCallback((comments: Record<string, NoteComment>) => {
    setEditorComments(comments);
  }, []);

  // Handle calendar date selection — open or create daily note
  const notesById = useSelector((state: RootState) => state.notes.byId);
  const handleCalendarDate = useCallback(
    (date: string) => {
      const existing = Object.values(notesById).find(
        (n) => n.isDaily && n.dailyDate === date && !n.deletedAt
      );
      if (existing) {
        dispatch(setEditingNote(existing.id));
      } else {
        // Create a new daily note for the selected date
        const note = createDailyNoteForDate(date);
        dispatch(addNote(note));
        dispatch(setEditingNote(note.id));
      }
    },
    [dispatch, notesById]
  );

  // Handle periodic note creation
  const handleCreatePeriodicNote = useCallback(
    (title: string, _type: 'weekly' | 'monthly' | 'quarterly') => {
      const note = createNoteService({ title });
      dispatch(addNote(note));
      dispatch(setEditingNote(note.id));
    },
    [dispatch]
  );

  // Handle templater apply
  const handleApplyTemplate = useCallback((content: string, title: string) => {
    // This would create a new note with the template content
    setTemplaterOpen(false);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'G') {
        e.preventDefault();
        dispatch(setNotesViewMode(viewMode === 'graph' ? 'list' : 'graph'));
      }
      // Ctrl+B to toggle notes list sidebar
      if ((e.ctrlKey || e.metaKey) && e.key === 'b' && !e.shiftKey) {
        if (document.querySelector('.notes-view')) {
          e.preventDefault();
          setNotesListOpen((prev) => !prev);
        }
      }
      // Ctrl+P or Ctrl+K for quick switcher
      if ((e.ctrlKey || e.metaKey) && e.key === 'p' && !e.shiftKey) {
        // Only intercept if we're in the notes view
        if (document.querySelector('.notes-view')) {
          e.preventDefault();
          setQuickSwitcherOpen(true);
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [dispatch, viewMode]);

  return (
    <div className="notes-view">
      {/* View mode toggle (draggable) */}
      <div
        className="notes-view__mode-toggle"
        style={
          modeBarPos
            ? {
                left: modeBarPos.x,
                top: modeBarPos.y,
                transform: 'none',
                cursor: isDraggingModeBar ? 'grabbing' : 'grab',
              }
            : {
                cursor: 'grab',
              }
        }
        onMouseDown={handleModeBarDragStart}
      >
        <button
          className={`notes-view__mode-btn ${viewMode === 'list' ? 'is-active' : ''}`}
          onClick={() => dispatch(setNotesViewMode('list'))}
          title={t('notes.listView', 'List View')}
        >
          <ListViewIcon />
        </button>
        <button
          className={`notes-view__mode-btn ${viewMode === 'masonry' ? 'is-active' : ''}`}
          onClick={() => dispatch(setNotesViewMode('masonry'))}
          title={t('notes.masonryView', 'Masonry View')}
        >
          <MasonryViewIcon />
        </button>
        <button
          className={`notes-view__mode-btn ${viewMode === 'kanban' ? 'is-active' : ''}`}
          onClick={() => dispatch(setNotesViewMode('kanban'))}
          title={t('notes.kanbanView', 'Kanban View')}
        >
          <KanbanViewIcon />
        </button>
        <button
          className={`notes-view__mode-btn ${viewMode === 'sticky' ? 'is-active' : ''}`}
          onClick={() => dispatch(setNotesViewMode('sticky'))}
          title={t('notes.stickyView', 'Sticky Notes')}
        >
          <StickyViewIcon />
        </button>
        <button
          className={`notes-view__mode-btn ${viewMode === 'database' ? 'is-active' : ''}`}
          onClick={() => dispatch(setNotesViewMode('database'))}
          title={t('notes.databaseView', 'Database View')}
        >
          <DatabaseViewIcon />
        </button>
        <button
          className={`notes-view__mode-btn ${viewMode === 'tasks' ? 'is-active' : ''}`}
          onClick={() => dispatch(setNotesViewMode('tasks'))}
          title={t('notes.tasksView', 'Tasks')}
        >
          <TasksViewIcon />
        </button>
        <button
          className={`notes-view__mode-btn ${viewMode === 'mindmap' ? 'is-active' : ''}`}
          onClick={() => dispatch(setNotesViewMode('mindmap'))}
          title={t('notes.mindMapView', 'Mind Map')}
        >
          <MindMapViewIcon />
        </button>
        <button
          className={`notes-view__mode-btn ${viewMode === 'graph' ? 'is-active' : ''}`}
          onClick={() => dispatch(setNotesViewMode('graph'))}
          title={t('notes.graphView', 'Graph View (Ctrl+Shift+G)')}
        >
          <GraphViewIcon />
        </button>
      </div>

      {viewMode === 'graph' ? (
        <div className="notes-view__graph-container">
          <GraphErrorBoundary onReset={() => dispatch(setNotesViewMode('list'))}>
            <GraphView />
          </GraphErrorBoundary>
        </div>
      ) : viewMode === 'masonry' ? (
        <MasonryView />
      ) : viewMode === 'kanban' ? (
        <KanbanView />
      ) : viewMode === 'sticky' ? (
        <StickyNotesView />
      ) : viewMode === 'database' ? (
        <DatabaseView />
      ) : viewMode === 'tasks' ? (
        <TasksAggregator />
      ) : viewMode === 'mindmap' ? (
        <MindMapView note={editingNote || null} />
      ) : (
        <div className="notes-view__split">
          {/* Left: Notes list (collapsible) */}
          {notesListOpen && <NotesList onSelectNote={handleSelectNote} />}

          {/* Center: Editor */}
          <div className="notes-view__editor-area" ref={editorAreaRef}>
            {/* Toggle button for notes list sidebar */}
            <button
              className="notes-view__list-toggle"
              onClick={() => setNotesListOpen(!notesListOpen)}
              title={
                notesListOpen
                  ? t('notes.hideNotesList', 'Masquer la liste')
                  : t('notes.showNotesList', 'Afficher la liste')
              }
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
              >
                {notesListOpen ? (
                  <>
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <line x1="9" y1="3" x2="9" y2="21" />
                    <polyline points="14,9 12,12 14,15" />
                  </>
                ) : (
                  <>
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <line x1="9" y1="3" x2="9" y2="21" />
                    <polyline points="12,9 14,12 12,15" />
                  </>
                )}
              </svg>
            </button>
            {/* Toggle button for right panel */}
            <button
              className="notes-view__right-toggle"
              onClick={() => setRightPanelOpen(!rightPanelOpen)}
              title={
                rightPanelOpen
                  ? t('notes.hidePanel', 'Masquer le panneau')
                  : t('notes.showPanel', 'Afficher le panneau')
              }
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
              >
                {rightPanelOpen ? (
                  <>
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <line x1="15" y1="3" x2="15" y2="21" />
                    <polyline points="10,9 12,12 10,15" />
                  </>
                ) : (
                  <>
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <line x1="15" y1="3" x2="15" y2="21" />
                    <polyline points="12,9 10,12 12,15" />
                  </>
                )}
              </svg>
            </button>
            {editingNote ? (
              <>
                <NoteBreadcrumb currentNoteId={editingNote.id} />
                <NoteEditor
                  key={editingNote.id}
                  note={editingNote}
                  onUpdate={handleContentUpdate}
                  onTitleChange={handleTitleChange}
                  onCommentsChange={handleCommentsChange}
                  commentsHandleRef={commentsHandleRef}
                  onOpenStyleSettings={() => setShowStyleSettings(true)}
                />
                <LinkPreviewPopover editorEl={editorAreaRef.current} />
              </>
            ) : (
              <div className="notes-view__empty">
                <EmptyNoteIcon />
                <h3>{t('notes.selectOrCreate', 'Select or create a note')}</h3>
                <p>
                  {t(
                    'notes.emptyHint',
                    'Choose a note from the list, or create a new one to start writing.'
                  )}
                </p>
                <div className="notes-view__shortcuts">
                  <div className="notes-view__shortcut">
                    <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>N</kbd>
                    <span>{t('notes.shortcutNew', 'New note')}</span>
                  </div>
                  <div className="notes-view__shortcut">
                    <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>D</kbd>
                    <span>{t('notes.shortcutDaily', 'Daily note')}</span>
                  </div>
                  <div className="notes-view__shortcut">
                    <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>G</kbd>
                    <span>{t('notes.shortcutGraph', 'Graph view')}</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Right: Calendar + note-specific panels */}
          {rightPanelOpen && (
            <div className="notes-view__right-panel">
              <div className="notes-view__right-panel-content">
                <CalendarWidget onSelectDate={handleCalendarDate} />
                <PeriodicNotes
                  onSelectNote={(id) => dispatch(setEditingNote(id))}
                  onCreateNote={handleCreatePeriodicNote}
                />
                {editingNote && (
                  <>
                    <OutlinePanel noteId={editingNote.id} />
                    {Object.keys(editorComments).length > 0 && (
                      <CommentsPanel
                        comments={editorComments}
                        onAddComment={() => {}}
                        onResolveComment={(id) => commentsHandleRef.current?.resolveComment(id)}
                        onDeleteComment={(id) => commentsHandleRef.current?.deleteComment(id)}
                      />
                    )}
                    <NoteFolderPicker
                      noteId={editingNote.id}
                      currentParentId={editingNote.parentId}
                    />
                    <BacklinksPanel noteId={editingNote.id} />
                    <SmartTagsSuggestion noteId={editingNote.id} />
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Quick Switcher Modal */}
      <QuickSwitcherPlus
        isOpen={quickSwitcherOpen}
        onClose={() => setQuickSwitcherOpen(false)}
        onSelectNote={(noteId: string) => {
          dispatch(setEditingNote(noteId));
          setQuickSwitcherOpen(false);
        }}
      />

      {/* Templater Modal */}
      <TemplaterModal
        isOpen={templaterOpen}
        onClose={() => setTemplaterOpen(false)}
        onApplyTemplate={handleApplyTemplate}
      />

      {/* Style Settings Modal */}
      {showStyleSettings && (
        <div
          className="notes-view__modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowStyleSettings(false);
          }}
        >
          <div className="notes-view__modal">
            <div className="notes-view__modal-header">
              <h3 className="notes-view__modal-title">
                {t('notes.styleSettings.title', 'Style Settings')}
              </h3>
              <button
                className="notes-view__modal-close"
                onClick={() => setShowStyleSettings(false)}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="notes-view__modal-body">
              <StyleSettingsPanel
                onSettingsChange={() => {
                  // Trigger NoteEditor to reload settings from localStorage
                  // Same-tab storage writes don't fire StorageEvent, so dispatch a custom event
                  window.dispatchEvent(new Event('filarr-style-settings-changed'));
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

export default NotesView;
