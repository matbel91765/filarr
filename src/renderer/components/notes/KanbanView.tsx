/**
 * KanbanView — Filarr Notes
 *
 * Kanban board for organizing notes into columns.
 * Columns can represent tags, status, or custom groups.
 * Drag & drop between columns using native HTML5 DnD.
 */

import React, { useState, useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector, useDispatch } from 'react-redux';
import type { RootState, AppDispatch } from '../../../store';
import { selectFilteredNotes, setEditingNote, updateNote } from '../../../store/slices/notesSlice';
import type { Note } from '../../../types/notes';
import './KanbanView.css';

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
    <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

const GripIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" opacity={0.3}>
    <circle cx="9" cy="5" r="1.5" /><circle cx="15" cy="5" r="1.5" />
    <circle cx="9" cy="12" r="1.5" /><circle cx="15" cy="12" r="1.5" />
    <circle cx="9" cy="19" r="1.5" /><circle cx="15" cy="19" r="1.5" />
  </svg>
);

// ==================== Helpers ====================

function getNoteColumn(note: Note): string {
  // Use icon field as column status marker, default to 'inbox'
  return note.icon || 'inbox';
}

// ==================== Component ====================

export const KanbanView: React.FC = React.memo(function KanbanView() {
  const { t } = useTranslation();
  const dispatch = useDispatch<AppDispatch>();
  const notes = useSelector(selectFilteredNotes);
  const [columns, setColumns] = useState<KanbanColumn[]>(DEFAULT_COLUMNS);
  const [draggedNoteId, setDraggedNoteId] = useState<string | null>(null);
  const [dropTargetCol, setDropTargetCol] = useState<string | null>(null);
  const [newColName, setNewColName] = useState('');
  const [showAddCol, setShowAddCol] = useState(false);

  // Group notes by column
  const columnNotes = useMemo(() => {
    const groups: Record<string, Note[]> = {};
    for (const col of columns) {
      groups[col.id] = [];
    }
    for (const note of notes) {
      const colId = getNoteColumn(note);
      if (groups[colId]) {
        groups[colId].push(note);
      } else {
        // Default to first column
        groups[columns[0]?.id || 'inbox']?.push(note);
      }
    }
    return groups;
  }, [notes, columns]);

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

  const handleDragLeave = useCallback(() => {
    setDropTargetCol(null);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent, colId: string) => {
      e.preventDefault();
      setDropTargetCol(null);
      if (draggedNoteId) {
        // Update note's column (stored in icon field)
        dispatch(updateNote({ id: draggedNoteId, changes: { icon: colId } }));
        setDraggedNoteId(null);
      }
    },
    [draggedNoteId, dispatch]
  );

  const handleDragEnd = useCallback(() => {
    setDraggedNoteId(null);
    setDropTargetCol(null);
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
              <span
                className="kanban-column__dot"
                style={{ background: col.color }}
              />
              <span className="kanban-column__title">{col.title}</span>
              <span className="kanban-column__count">
                {columnNotes[col.id]?.length || 0}
              </span>
              {columns.length > 1 && (
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
              {(columnNotes[col.id] || []).map((note) => (
                <div
                  key={note.id}
                  className={`kanban-card ${draggedNoteId === note.id ? 'kanban-card--dragging' : ''}`}
                  draggable
                  onDragStart={(e) => handleDragStart(e, note.id)}
                  onDragEnd={handleDragEnd}
                  onClick={() => dispatch(setEditingNote(note.id))}
                >
                  <div className="kanban-card__grip">
                    <GripIcon />
                  </div>
                  <div className="kanban-card__content">
                    <div className="kanban-card__title">
                      {note.title || t('notes.untitled', 'Untitled')}
                    </div>
                    {note.plainText && (
                      <div className="kanban-card__preview">
                        {note.plainText.slice(0, 80)}
                      </div>
                    )}
                    <div className="kanban-card__meta">
                      <span>{note.wordCount} {t('notes.words', 'words')}</span>
                      {note.linkedNoteIds.length > 0 && (
                        <span>{note.linkedNoteIds.length} links</span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}

        {/* Add column */}
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
            <button
              className="kanban-view__add-col-trigger"
              onClick={() => setShowAddCol(true)}
            >
              <PlusIcon />
              <span>{t('notes.addColumn', 'Add Column')}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
});

export default KanbanView;
