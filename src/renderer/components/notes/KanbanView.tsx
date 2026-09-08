/**
 * KanbanView — Filarr Notes
 *
 * Kanban board for organizing notes into columns.
 * Columns can represent tags, status, or custom groups.
 * Drag & drop between columns using native HTML5 DnD.
 */

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector, useDispatch } from 'react-redux';
import type { AppDispatch, RootState } from '../../../store';
import {
  selectFilteredNotes,
  setEditingNote,
  reorderKanbanCard,
  migrateKanbanIconPollution,
  updateNote,
  addNote,
} from '../../../store/slices/notesSlice';
import { createNote } from '../../../services/notes/noteService';
import type { Note } from '../../../types/notes';
import './KanbanView.css';

import * as profileStorage from '../../../services/core/profileStorage';
// ==================== Types ====================

interface KanbanColumn {
  id: string;
  title: string;
  color: string;
}

const DEFAULT_COLUMNS: KanbanColumn[] = [
  { id: 'inbox', title: 'Inbox', color: '#94a3b8' },
  { id: 'in-progress', title: 'In Progress', color: '#3b82f6' },
  { id: 'review', title: 'Review', color: '#f59e0b' },
  { id: 'done', title: 'Done', color: '#22c55e' },
];

// ==================== Icons ====================

const PlusIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

const GripIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" opacity={0.3}>
    <circle cx="9" cy="5" r="1.5" />
    <circle cx="15" cy="5" r="1.5" />
    <circle cx="9" cy="12" r="1.5" />
    <circle cx="15" cy="12" r="1.5" />
    <circle cx="9" cy="19" r="1.5" />
    <circle cx="15" cy="19" r="1.5" />
  </svg>
);

// ==================== Helpers ====================

function getNoteColumn(note: Note): string {
  return note.kanbanStatus || 'inbox';
}

// ==================== Component ====================

interface KanbanViewProps {
  /** See MasonryView — clicking a card switches to list mode + opens editor. */
  onOpenNote?: (id: string) => void;
}

export const KanbanView: React.FC<KanbanViewProps> = React.memo(function KanbanView({
  onOpenNote,
}) {
  const { t } = useTranslation();
  const dispatch = useDispatch<AppDispatch>();
  const notes = useSelector(selectFilteredNotes);
  const notebooksById = useSelector((s: RootState) => s.notes.notebooks);
  const tagsArr = useSelector(
    (s: RootState) => (s.tags?.tags || []) as Array<{ id: string; name: string; color?: string }>
  );
  // Persisted like swimlanes below — otherwise custom columns vanish on reload
  // and cards carrying their kanbanStatus silently re-bucket into 'inbox'.
  const [columns, setColumns] = useState<KanbanColumn[]>(() => {
    try {
      const raw = profileStorage.getItemWithLegacyFallback('filarr.kanban.columns.v1');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (
          Array.isArray(parsed) &&
          parsed.length > 0 &&
          parsed.every((c) => c && typeof c.id === 'string' && typeof c.title === 'string')
        ) {
          return parsed as KanbanColumn[];
        }
      }
    } catch {
      /* corrupt / disabled */
    }
    return DEFAULT_COLUMNS;
  });
  useEffect(() => {
    try {
      profileStorage.setItem('filarr.kanban.columns.v1', JSON.stringify(columns));
    } catch {
      /* quota / disabled */
    }
  }, [columns]);
  const [draggedNoteId, setDraggedNoteId] = useState<string | null>(null);
  const [dropTargetCol, setDropTargetCol] = useState<string | null>(null);
  const [newColName, setNewColName] = useState('');
  const [showAddCol, setShowAddCol] = useState(false);

  // Swimlanes (#9): split the board horizontally by a secondary criterion.
  // Persisted in localStorage so the user's framing survives reloads.
  // Lane drag-drop is intentionally column-only — moving a card across
  // lanes would require mutating its tag / notebook / pinned state, which
  // is too implicit for a drag gesture.
  type SwimlaneBy = 'none' | 'notebook' | 'tag' | 'pinned';
  const [swimlaneBy, setSwimlaneBy] = useState<SwimlaneBy>(() => {
    try {
      const raw = profileStorage.getItemWithLegacyFallback('filarr.kanban.swimlaneBy.v1');
      if (raw === 'notebook' || raw === 'tag' || raw === 'pinned' || raw === 'none') return raw;
    } catch {
      /* */
    }
    return 'none';
  });
  useEffect(() => {
    try {
      profileStorage.setItem('filarr.kanban.swimlaneBy.v1', swimlaneBy);
    } catch {
      /* quota / disabled */
    }
  }, [swimlaneBy]);

  const [collapsedLanes, setCollapsedLanes] = useState<Set<string>>(() => {
    try {
      const raw = profileStorage.getItemWithLegacyFallback('filarr.kanban.collapsedLanes.v1');
      if (!raw) return new Set();
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? new Set(parsed) : new Set();
    } catch {
      return new Set();
    }
  });
  useEffect(() => {
    try {
      profileStorage.setItem(
        'filarr.kanban.collapsedLanes.v1',
        JSON.stringify([...collapsedLanes])
      );
    } catch {
      /* */
    }
  }, [collapsedLanes]);

  // Heal notes whose `icon` field was corrupted by the pre-kanbanStatus
  // drop handler (column ids were written into `icon`, leaking into
  // every other view). Runs once per mount — the reducer is idempotent.
  useEffect(() => {
    dispatch(migrateKanbanIconPollution());
  }, [dispatch]);

  // Group notes by column. Defense-in-depth: even though `selectAllNotes`
  // is supposed to filter out trashed notes, the Kanban view re-checks
  // `deletedAt` itself — a note moved to trash via a path that bypasses the
  // notes slice (e.g. file-level trash IPC) would otherwise stay clickable
  // and draggable in columns until full app reload.
  //
  // Within each column, sort by `kanbanOrder` (set by the user via
  // drag-to-reorder). Cards without an explicit order keep their position
  // from `selectFilteredNotes` (the global sort), placed after the
  // user-ordered ones.
  const columnNotes = useMemo(() => {
    const groups: Record<string, Note[]> = {};
    const originalIndex = new Map<string, number>();
    for (const col of columns) {
      groups[col.id] = [];
    }
    notes.forEach((note, idx) => {
      if (note.deletedAt) return;
      originalIndex.set(note.id, idx);
      const colId = getNoteColumn(note);
      if (groups[colId]) {
        groups[colId].push(note);
      } else {
        // Default to first column
        groups[columns[0]?.id || 'inbox']?.push(note);
      }
    });
    for (const id of Object.keys(groups)) {
      groups[id].sort((a, b) => {
        const ao = a.kanbanOrder ?? Number.MAX_SAFE_INTEGER;
        const bo = b.kanbanOrder ?? Number.MAX_SAFE_INTEGER;
        if (ao !== bo) return ao - bo;
        return (originalIndex.get(a.id) ?? 0) - (originalIndex.get(b.id) ?? 0);
      });
    }
    return groups;
  }, [notes, columns]);

  // Compute swimlanes from the visible notes. Each lane has a stable id
  // (used for the collapsed-lanes Set + the drag-drop scope), a label,
  // and the subset of `notes` that belongs to it. When swimlaneBy is
  // 'none' we return a single synthetic "all" lane so the rest of the
  // render stays a single code path.
  interface Lane {
    id: string;
    label: string;
    note: (n: Note) => boolean;
    color?: string;
  }

  const lanes: Lane[] = useMemo(() => {
    if (swimlaneBy === 'none') {
      return [{ id: '__all__', label: '', note: () => true }];
    }
    if (swimlaneBy === 'pinned') {
      return [
        {
          id: 'pinned',
          label: t('notes.kanbanLanePinned', 'Pinned'),
          note: (n) => !!n.isPinned,
        },
        {
          id: 'unpinned',
          label: t('notes.kanbanLaneUnpinned', 'Other notes'),
          note: (n) => !n.isPinned,
        },
      ];
    }
    if (swimlaneBy === 'notebook') {
      // One lane per notebook that has a card visible, plus a fallback
      // lane for notes without any notebook assignment.
      const seen = new Set<string>();
      for (const n of notes) {
        if (!n.deletedAt) seen.add(n.notebookId || '__none__');
      }
      const list = [...seen]
        .map((id) => ({
          id: `nb:${id}`,
          rawId: id,
          label:
            id === '__none__'
              ? t('notes.kanbanLaneNoNotebook', 'No notebook')
              : notebooksById[id]?.name || t('notes.kanbanLaneUnknown', 'Unknown'),
          color: id === '__none__' ? undefined : notebooksById[id]?.color,
        }))
        .sort((a, b) => a.label.localeCompare(b.label));
      return list.map((l) => ({
        id: l.id,
        label: l.label,
        color: l.color,
        note: (n) => (n.notebookId || '__none__') === l.rawId,
      }));
    }
    // 'tag': group by the first tag id (notes with multiple tags appear
    // only in the lane of their first tag — V1 simplification).
    const tagsById = new Map(tagsArr.map((tag) => [tag.id, tag]));
    const seen = new Set<string>();
    for (const n of notes) {
      if (n.deletedAt) continue;
      const first = n.tagIds?.[0] || '__none__';
      seen.add(first);
    }
    const list = [...seen]
      .map((id) => ({
        id: `tag:${id}`,
        rawId: id,
        label:
          id === '__none__'
            ? t('notes.kanbanLaneNoTag', 'Untagged')
            : tagsById.get(id)?.name || t('notes.kanbanLaneUnknown', 'Unknown'),
        color: id === '__none__' ? undefined : tagsById.get(id)?.color,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
    return list.map((l) => ({
      id: l.id,
      label: l.label,
      color: l.color,
      note: (n) => (n.tagIds?.[0] || '__none__') === l.rawId,
    }));
  }, [swimlaneBy, notes, notebooksById, tagsArr, t]);

  // For each lane, slice the per-column notes to only include cards
  // belonging to that lane. Returns the same shape as columnNotes so the
  // existing render path can iterate without branching.
  const laneColumnNotes = useMemo(() => {
    const result: Record<string, Record<string, Note[]>> = {};
    for (const lane of lanes) {
      const filtered: Record<string, Note[]> = {};
      for (const col of columns) {
        filtered[col.id] = (columnNotes[col.id] || []).filter(lane.note);
      }
      result[lane.id] = filtered;
    }
    return result;
  }, [lanes, columns, columnNotes]);

  const toggleLaneCollapsed = useCallback((laneId: string) => {
    setCollapsedLanes((prev) => {
      const next = new Set(prev);
      if (next.has(laneId)) next.delete(laneId);
      else next.add(laneId);
      return next;
    });
  }, []);

  // Drop indicator: which column + before which card the dragged note will
  // land. `beforeNoteId === null` means "at the end of the column".
  const [dropIndicator, setDropIndicator] = useState<{
    columnId: string;
    beforeNoteId: string | null;
  } | null>(null);

  // Inline title edit: which card is being renamed in place + the draft text.
  // Commit on Enter / blur, revert on Escape.
  const [editingTitleId, setEditingTitleId] = useState<string | null>(null);
  const [titleDraft, setTitleDraft] = useState('');

  const startTitleEdit = useCallback((note: Note) => {
    setEditingTitleId(note.id);
    setTitleDraft(note.title || '');
  }, []);

  const commitTitleEdit = useCallback(() => {
    if (!editingTitleId) return;
    const trimmed = titleDraft.trim();
    // Empty title is allowed (matches the rest of the app — note.title is
    // displayed as "Untitled" when blank).
    dispatch(updateNote({ id: editingTitleId, changes: { title: trimmed } }));
    setEditingTitleId(null);
    setTitleDraft('');
  }, [editingTitleId, titleDraft, dispatch]);

  const cancelTitleEdit = useCallback(() => {
    setEditingTitleId(null);
    setTitleDraft('');
  }, []);

  // Quick-add: create a new empty note already assigned to the clicked
  // column and immediately put its title into inline-edit mode so the
  // user can type without opening the full editor.
  const handleQuickAdd = useCallback(
    (columnId: string) => {
      const note = createNote({
        title: '',
        kanbanStatus: columnId,
      });
      dispatch(addNote(note));
      setEditingTitleId(note.id);
      setTitleDraft('');
    },
    [dispatch]
  );

  // DnD handlers
  const handleDragStart = useCallback((e: React.DragEvent, noteId: string) => {
    setDraggedNoteId(noteId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', noteId);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, colId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDropTargetCol(colId);
  }, []);

  // Card-level drag-over: pick "above" vs "below" the target based on the
  // cursor Y position relative to the card's vertical midpoint, then
  // surface that as the drop indicator.
  const handleCardDragOver = useCallback(
    (e: React.DragEvent, targetNoteId: string, colId: string) => {
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      setDropTargetCol(colId);
      if (!draggedNoteId || draggedNoteId === targetNoteId) return;
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const cards = columnNotes[colId] || [];
      const targetIdx = cards.findIndex((c) => c.id === targetNoteId);
      if (targetIdx < 0) return;
      const above = e.clientY < rect.top + rect.height / 2;
      let beforeNoteId: string | null;
      if (above) {
        beforeNoteId = targetNoteId;
      } else {
        // Drop after the target — anchor on the next card, or null if last.
        const next = cards[targetIdx + 1];
        beforeNoteId = next ? next.id : null;
      }
      setDropIndicator({ columnId: colId, beforeNoteId });
    },
    [draggedNoteId, columnNotes]
  );

  const handleDragLeave = useCallback(() => {
    setDropTargetCol(null);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent, colId: string) => {
      e.preventDefault();
      const indicator = dropIndicator;
      setDropTargetCol(null);
      setDropIndicator(null);
      if (!draggedNoteId) return;

      // If we have a precise drop indicator (set by card-level dragover),
      // honor it — supports both intra-column reorder and cross-column
      // drops at a specific position. Otherwise fall back to "append to
      // column", which is the legacy behavior for empty-column drops.
      if (indicator && indicator.columnId === colId) {
        dispatch(
          reorderKanbanCard({
            noteId: draggedNoteId,
            columnId: colId,
            beforeNoteId: indicator.beforeNoteId,
          })
        );
      } else {
        dispatch(
          reorderKanbanCard({
            noteId: draggedNoteId,
            columnId: colId,
            beforeNoteId: null,
          })
        );
      }
      setDraggedNoteId(null);
    },
    [draggedNoteId, dropIndicator, dispatch]
  );

  const handleDragEnd = useCallback(() => {
    setDraggedNoteId(null);
    setDropTargetCol(null);
    setDropIndicator(null);
  }, []);

  const handleAddColumn = useCallback(() => {
    if (!newColName.trim()) return;
    const id = newColName.trim().toLowerCase().replace(/\s+/g, '-');
    const colors = ['#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#6366f1'];
    setColumns((prev) => [
      ...prev,
      { id, title: newColName.trim(), color: colors[prev.length % colors.length] },
    ]);
    setNewColName('');
    setShowAddCol(false);
  }, [newColName]);

  const handleDeleteColumn = useCallback((colId: string) => {
    setColumns((prev) => prev.filter((c) => c.id !== colId));
  }, []);

  return (
    <div className="kanban-view">
      {/* Top toolbar with swimlane selector */}
      <div className="kanban-view__toolbar">
        <label className="kanban-view__swimlane-field">
          <span className="kanban-view__swimlane-label">
            {t('notes.kanbanSwimlanesLabel', 'Swimlanes')}
          </span>
          <select value={swimlaneBy} onChange={(e) => setSwimlaneBy(e.target.value as SwimlaneBy)}>
            <option value="none">{t('notes.kanbanSwimlanesNone', 'None')}</option>
            <option value="notebook">{t('notes.kanbanSwimlanesNotebook', 'Notebook')}</option>
            <option value="tag">{t('notes.kanbanSwimlanesTag', 'First tag')}</option>
            <option value="pinned">{t('notes.kanbanSwimlanesPinned', 'Pinned')}</option>
          </select>
        </label>
      </div>

      {lanes.map((lane, laneIndex) => {
        const laneCols = laneColumnNotes[lane.id] || {};
        const isLaneCollapsed = collapsedLanes.has(lane.id);
        const showHeader = swimlaneBy !== 'none';
        const totalInLane = columns.reduce((sum, col) => sum + (laneCols[col.id]?.length || 0), 0);
        return (
          <div
            key={lane.id}
            className={`kanban-lane ${isLaneCollapsed ? 'kanban-lane--collapsed' : ''}`}
          >
            {showHeader && (
              <button
                type="button"
                className="kanban-lane__header"
                onClick={() => toggleLaneCollapsed(lane.id)}
                title={
                  isLaneCollapsed
                    ? t('notes.kanbanLaneExpand', 'Expand lane')
                    : t('notes.kanbanLaneCollapse', 'Collapse lane')
                }
              >
                <span className="kanban-lane__chevron">{isLaneCollapsed ? '▸' : '▾'}</span>
                {lane.color && (
                  <span className="kanban-lane__dot" style={{ background: lane.color }} />
                )}
                <span className="kanban-lane__label">{lane.label}</span>
                <span className="kanban-lane__count">{totalInLane}</span>
              </button>
            )}

            {!isLaneCollapsed && (
              <div className="kanban-view__columns">
                {columns.map((col) => (
                  <div
                    key={col.id}
                    className={`kanban-column ${dropTargetCol === col.id ? 'kanban-column--drop-target' : ''}`}
                    onDragOver={(e) => handleDragOver(e, col.id)}
                    onDragLeave={handleDragLeave}
                    onDrop={(e) => handleDrop(e, col.id)}
                  >
                    <div className="kanban-column__header">
                      <span className="kanban-column__dot" style={{ background: col.color }} />
                      <span className="kanban-column__title">{col.title}</span>
                      <span className="kanban-column__count">{laneCols[col.id]?.length || 0}</span>
                      {/* Delete column only from the first (or only) lane —
                          deleting a column is global, not lane-scoped. */}
                      {columns.length > 1 && laneIndex === 0 && (
                        <button
                          className="kanban-column__delete"
                          onClick={() => handleDeleteColumn(col.id)}
                          title={t('common.delete', 'Delete')}
                        >
                          &times;
                        </button>
                      )}
                    </div>
                    <div className="kanban-column__cards">
                      {(laneCols[col.id] || []).map((note) => {
                        const showInsertLine =
                          dropIndicator?.columnId === col.id &&
                          dropIndicator.beforeNoteId === note.id &&
                          draggedNoteId !== note.id;
                        return (
                          <React.Fragment key={note.id}>
                            {showInsertLine && (
                              <div
                                className="kanban-column__drop-line"
                                style={{
                                  height: 2,
                                  background: 'var(--color-primary-500, #4682b4)',
                                  margin: '2px 0',
                                  borderRadius: 1,
                                }}
                              />
                            )}
                            <div
                              className={`kanban-card ${draggedNoteId === note.id ? 'kanban-card--dragging' : ''}`}
                              draggable={editingTitleId !== note.id}
                              role="button"
                              tabIndex={editingTitleId === note.id ? -1 : 0}
                              aria-label={note.title || t('notes.untitled', 'Untitled')}
                              onDragStart={(e) => handleDragStart(e, note.id)}
                              onDragOver={(e) => handleCardDragOver(e, note.id, col.id)}
                              onDragEnd={handleDragEnd}
                              onKeyDown={(e) => {
                                if (editingTitleId === note.id) return;
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  if (onOpenNote) onOpenNote(note.id);
                                  else dispatch(setEditingNote(note.id));
                                }
                              }}
                              onClick={() => {
                                // Don't trigger card-open when the user is in the
                                // middle of renaming the title in place.
                                if (editingTitleId === note.id) return;
                                if (onOpenNote) onOpenNote(note.id);
                                else dispatch(setEditingNote(note.id));
                              }}
                            >
                              <div className="kanban-card__grip">
                                <GripIcon />
                              </div>
                              <div className="kanban-card__content">
                                {editingTitleId === note.id ? (
                                  <input
                                    className="kanban-card__title-input"
                                    autoFocus
                                    value={titleDraft}
                                    onChange={(e) => setTitleDraft(e.target.value)}
                                    onClick={(e) => e.stopPropagation()}
                                    onKeyDown={(e) => {
                                      e.stopPropagation();
                                      if (e.key === 'Enter') {
                                        e.preventDefault();
                                        commitTitleEdit();
                                      } else if (e.key === 'Escape') {
                                        e.preventDefault();
                                        cancelTitleEdit();
                                      }
                                    }}
                                    onBlur={commitTitleEdit}
                                  />
                                ) : (
                                  <div
                                    className="kanban-card__title"
                                    onDoubleClick={(e) => {
                                      e.stopPropagation();
                                      startTitleEdit(note);
                                    }}
                                    title={t('notes.kanbanRenameHint', 'Double-click to rename')}
                                  >
                                    {note.title || t('notes.untitled', 'Untitled')}
                                  </div>
                                )}
                                {note.plainText && (
                                  <div className="kanban-card__preview">
                                    {note.plainText.slice(0, 80)}
                                  </div>
                                )}
                                <div className="kanban-card__meta">
                                  <span>
                                    {note.wordCount} {t('notes.words', 'words')}
                                  </span>
                                  {note.linkedNoteIds.length > 0 && (
                                    <span>{note.linkedNoteIds.length} links</span>
                                  )}
                                </div>
                              </div>
                            </div>
                          </React.Fragment>
                        );
                      })}
                      {/* End-of-column insert indicator (drop after last card) */}
                      {dropIndicator?.columnId === col.id &&
                        dropIndicator.beforeNoteId === null && (
                          <div
                            className="kanban-column__drop-line"
                            style={{
                              height: 2,
                              background: 'var(--color-primary-500, #4682b4)',
                              margin: '2px 0',
                              borderRadius: 1,
                            }}
                          />
                        )}
                      {/* Quick-add affordance — creates a new note already in this
                  column and immediately opens its title for in-place edit
                  so the user can capture an idea without breaking flow. */}
                      <button
                        type="button"
                        className="kanban-column__quick-add"
                        onClick={() => handleQuickAdd(col.id)}
                        title={t('notes.kanbanQuickAdd', 'Add a note to this column')}
                      >
                        <PlusIcon />
                        <span>{t('notes.kanbanAddCard', 'Add a card')}</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}

      {/* Add column — single global affordance, placed at the end of the
          board so it doesn't repeat across swimlanes. */}
      <div className="kanban-view__add-col">
        {showAddCol ? (
          <div className="kanban-view__add-col-form">
            <input
              className="kanban-view__add-col-input"
              value={newColName}
              onChange={(e) => setNewColName(e.target.value)}
              placeholder={t('notes.columnName', 'Column name...')}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAddColumn();
                if (e.key === 'Escape') setShowAddCol(false);
              }}
            />
            <button className="kanban-view__add-col-btn" onClick={handleAddColumn}>
              <PlusIcon />
            </button>
          </div>
        ) : (
          <button className="kanban-view__add-col-trigger" onClick={() => setShowAddCol(true)}>
            <PlusIcon />
            <span>{t('notes.addColumn', 'Add Column')}</span>
          </button>
        )}
      </div>
    </div>
  );
});

export default KanbanView;
