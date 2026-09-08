/**
 * NoteTree Component — Filarr Notes
 *
 * Collapsible tree view showing notes organized by parent-child relationships.
 * Supports drag-and-drop to re-parent notes and a "move to root" drop zone.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector, useDispatch } from 'react-redux';
import type { RootState, AppDispatch } from '../../../store';
import {
  selectFilteredNotes,
  updateNote,
  selectNote,
  deleteNote,
  togglePinNote,
} from '../../../store/slices/notesSlice';
import type { Note } from '../../../types/notes';
import { NoteSharedBadge } from './NoteSharedBadge';
import './NoteTree.css';

// ==================== Icons ====================

const ChevronIcon = () => (
  <svg
    width="12"
    height="12"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2.5}
  >
    <polyline points="9,6 15,12 9,18" />
  </svg>
);

const NoteIcon = () => (
  <svg
    width="16"
    height="16"
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

const CalendarIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <rect x="3" y="4" width="18" height="18" rx="2" />
    <line x1="16" y1="2" x2="16" y2="6" />
    <line x1="8" y1="2" x2="8" y2="6" />
    <line x1="3" y1="10" x2="21" y2="10" />
  </svg>
);

const PinIcon: React.FC<{ filled?: boolean }> = ({ filled }) => (
  <svg
    width="12"
    height="12"
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
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <polyline points="3,6 5,6 21,6" />
    <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
  </svg>
);

// ==================== Helpers ====================

interface TreeNode {
  note: Note;
  children: TreeNode[];
}

/**
 * Build a tree from a flat list of notes using parentId relationships.
 * Notes whose parentId references a note not in `notesMap` are treated as root.
 */
function buildTree(notes: Note[], notesMap: Record<string, Note>): TreeNode[] {
  const childrenMap = new Map<string | null, Note[]>();

  for (const note of notes) {
    // Treat as root if parentId is null or the parent isn't in the current note set
    const effectiveParent =
      note.parentId && notesMap[note.parentId] && !notesMap[note.parentId]?.deletedAt
        ? note.parentId
        : null;

    const list = childrenMap.get(effectiveParent) || [];
    list.push(note);
    childrenMap.set(effectiveParent, list);
  }

  function buildNodes(parentId: string | null): TreeNode[] {
    const children = childrenMap.get(parentId) || [];
    return children.map((note) => ({
      note,
      children: buildNodes(note.id),
    }));
  }

  return buildNodes(null);
}

/**
 * Recursively check if `candidateChildId` is an ancestor of `noteId`.
 * Used to prevent circular parenting when dragging.
 */
function isDescendantOf(
  noteId: string,
  candidateAncestorId: string,
  notesMap: Record<string, Note>
): boolean {
  let current = notesMap[noteId];
  const visited = new Set<string>();
  while (current?.parentId) {
    if (visited.has(current.id)) return false; // cycle guard
    visited.add(current.id);
    if (current.parentId === candidateAncestorId) return true;
    current = notesMap[current.parentId];
  }
  return false;
}

// ==================== Props ====================

interface NoteTreeProps {
  onSelectNote: (id: string) => void;
  /**
   * Clic droit sur une ligne. L'arbre n'a PAS de menu à lui : l'hôte (la
   * liste des notes) possède déjà le menu contextuel des cartes et le branche
   * ici — un seul menu, un seul jeu de gestes, quelle que soit la vue.
   */
  onContextMenu?: (e: React.MouseEvent, noteId: string) => void;
}

// ==================== Component ====================

export const NoteTree: React.FC<NoteTreeProps> = React.memo(function NoteTree({
  onSelectNote,
  onContextMenu,
}) {
  const { t } = useTranslation();
  const dispatch = useDispatch<AppDispatch>();

  const notes = useSelector(selectFilteredNotes);
  const notesById = useSelector((s: RootState) => s.notes.byId);
  const selectedNoteId = useSelector((s: RootState) => s.notes.selectedNoteId);

  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [rootDragOver, setRootDragOver] = useState(false);

  // Build tree from the filtered, sorted notes list
  const tree = useMemo(() => buildTree(notes, notesById), [notes, notesById]);

  // ---- Expand / Collapse ----

  const toggleExpand = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  // ---- Selection ----

  const handleSelect = useCallback(
    (id: string) => {
      dispatch(selectNote(id));
      onSelectNote(id);
    },
    [dispatch, onSelectNote]
  );

  // ---- Delete / Pin ----

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

  // ---- Drag & Drop ----

  const handleDragStart = useCallback((e: React.DragEvent, noteId: string) => {
    e.dataTransfer.setData('application/x-filarr-note', noteId);
    e.dataTransfer.effectAllowed = 'move';
    // Set a clean drag image from the row element
    const el = e.currentTarget as HTMLElement;
    if (el) {
      e.dataTransfer.setDragImage(el, 20, 14);
    }
    setDraggingId(noteId);
  }, []);

  const handleDragEnd = useCallback(() => {
    setDraggingId(null);
    setDragOverId(null);
    setRootDragOver(false);
  }, []);

  const handleDragOver = useCallback(
    (e: React.DragEvent, targetId: string) => {
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';

      if (draggingId && targetId !== draggingId) {
        setDragOverId(targetId);
      }
    },
    [draggingId]
  );

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverId(null);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent, targetId: string) => {
      e.preventDefault();
      e.stopPropagation();

      const sourceId = e.dataTransfer.getData('application/x-filarr-note');
      if (!sourceId || sourceId === targetId) {
        setDragOverId(null);
        return;
      }

      // Prevent making a note a child of its own descendant
      if (isDescendantOf(targetId, sourceId, notesById)) {
        setDragOverId(null);
        return;
      }

      dispatch(updateNote({ id: sourceId, changes: { parentId: targetId } }));

      // Auto-expand the target so the dropped note is visible
      setExpandedIds((prev) => {
        const next = new Set(prev);
        next.add(targetId);
        return next;
      });

      setDragOverId(null);
      setDraggingId(null);
    },
    [dispatch, notesById]
  );

  // ---- Root Drop Zone ----

  const handleRootDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setRootDragOver(true);
  }, []);

  const handleRootDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setRootDragOver(false);
  }, []);

  const handleRootDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const sourceId = e.dataTransfer.getData('application/x-filarr-note');
      if (!sourceId) return;

      dispatch(updateNote({ id: sourceId, changes: { parentId: null } }));
      setRootDragOver(false);
      setDraggingId(null);
    },
    [dispatch]
  );

  // ---- Render ----

  if (notes.length === 0) {
    return (
      <div className="note-tree">
        <div className="note-tree__empty">
          <NoteIcon />
          <p>{t('notes.emptyTitle', 'No notes yet')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`note-tree ${draggingId ? 'note-tree--dragging' : ''}`}>
      {tree.map((node) => (
        <TreeNodeRow
          key={node.note.id}
          node={node}
          depth={0}
          selectedNoteId={selectedNoteId}
          expandedIds={expandedIds}
          draggingId={draggingId}
          dragOverId={dragOverId}
          onToggleExpand={toggleExpand}
          onSelect={handleSelect}
          onDelete={handleDelete}
          onPin={handlePin}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onContextMenu={onContextMenu}
        />
      ))}

      {/* Move to root drop zone */}
      <div
        className={`note-tree__root-drop ${rootDragOver ? 'note-tree__root-drop--drag-over' : ''}`}
        onDragOver={handleRootDragOver}
        onDragLeave={handleRootDragLeave}
        onDrop={handleRootDrop}
      >
        {t('notes.treeDropRoot', 'Drop here to move to root level')}
      </div>
    </div>
  );
});

// ==================== Tree Node Row ====================

interface TreeNodeRowProps {
  node: TreeNode;
  depth: number;
  selectedNoteId: string | null;
  expandedIds: Set<string>;
  draggingId: string | null;
  dragOverId: string | null;
  onToggleExpand: (id: string, e: React.MouseEvent) => void;
  onSelect: (id: string) => void;
  onDelete: (e: React.MouseEvent, id: string) => void;
  onPin: (e: React.MouseEvent, id: string) => void;
  onDragStart: (e: React.DragEvent, id: string) => void;
  onDragEnd: () => void;
  onDragOver: (e: React.DragEvent, targetId: string) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent, targetId: string) => void;
  onContextMenu?: (e: React.MouseEvent, noteId: string) => void;
}

const INDENT_PX = 16;

const TreeNodeRow: React.FC<TreeNodeRowProps> = React.memo(function TreeNodeRow({
  node,
  depth,
  selectedNoteId,
  expandedIds,
  draggingId,
  dragOverId,
  onToggleExpand,
  onSelect,
  onDelete,
  onPin,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
  onContextMenu,
}) {
  const { t } = useTranslation();
  const { note, children } = node;
  const hasChildren = children.length > 0;
  const isExpanded = expandedIds.has(note.id);
  const isSelected = note.id === selectedNoteId;
  const isDragging = note.id === draggingId;
  const isDragOver = note.id === dragOverId;

  const rowClasses = [
    'note-tree__node-row',
    isSelected && 'note-tree__node-row--selected',
    note.isPinned && 'note-tree__node-row--pinned',
    isDragOver && 'note-tree__node-row--drag-over',
    isDragging && 'note-tree__node-row--dragging',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="note-tree__node">
      <div
        className={rowClasses}
        onClick={() => onSelect(note.id)}
        draggable
        onMouseDown={(e) => {
          // Prevent text selection on drag — allow clicks on buttons
          if ((e.target as HTMLElement).closest('button')) return;
          e.preventDefault();
        }}
        onDragStart={(e) => onDragStart(e, note.id)}
        onDragEnd={onDragEnd}
        onDragOver={(e) => onDragOver(e, note.id)}
        onDragLeave={onDragLeave}
        onDrop={(e) => onDrop(e, note.id)}
        onContextMenu={onContextMenu ? (e) => onContextMenu(e, note.id) : undefined}
        role="treeitem"
        tabIndex={0}
        aria-expanded={hasChildren ? isExpanded : undefined}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onSelect(note.id);
          if (e.key === 'ArrowRight' && hasChildren && !isExpanded)
            onToggleExpand(note.id, e as any);
          if (e.key === 'ArrowLeft' && hasChildren && isExpanded) onToggleExpand(note.id, e as any);
        }}
      >
        {/* Indent spacer */}
        {depth > 0 && <span className="note-tree__indent" style={{ width: depth * INDENT_PX }} />}

        {/* Expand/collapse chevron */}
        <button
          className={`note-tree__chevron ${isExpanded ? 'note-tree__chevron--expanded' : ''} ${!hasChildren ? 'note-tree__chevron--hidden' : ''}`}
          onClick={(e) => {
            if (hasChildren) onToggleExpand(note.id, e);
          }}
          tabIndex={-1}
          aria-label={
            isExpanded ? t('notes.treeCollapse', 'Collapse') : t('notes.treeExpand', 'Expand')
          }
        >
          <ChevronIcon />
        </button>

        {/* Note icon */}
        <span className="note-tree__node-icon">
          {note.isDaily ? <CalendarIcon /> : <NoteIcon />}
        </span>

        {/* Title */}
        <span className="note-tree__title">{note.title || t('notes.untitled', 'Untitled')}</span>

        {/* Badge « Partagée » (copie dans un coffre) */}
        <NoteSharedBadge noteId={note.id} variant="dot" />

        {/* Child count badge */}
        {hasChildren && <span className="note-tree__badge">{children.length}</span>}

        {/* Actions */}
        <div className="note-tree__node-actions">
          <button
            className={`note-tree__node-action ${note.isPinned ? 'is-pinned' : ''}`}
            onClick={(e) => onPin(e, note.id)}
            title={t('notes.pin', 'Pin')}
            tabIndex={-1}
          >
            <PinIcon filled={note.isPinned} />
          </button>
          <button
            className="note-tree__node-action note-tree__node-action--delete"
            onClick={(e) => onDelete(e, note.id)}
            title={t('notes.delete', 'Delete')}
            tabIndex={-1}
          >
            <TrashIcon />
          </button>
        </div>
      </div>

      {/* Children (collapsible) */}
      {hasChildren && (
        <div
          className={`note-tree__children ${isExpanded ? 'note-tree__children--expanded' : 'note-tree__children--collapsed'}`}
          role="group"
        >
          {children.map((child) => (
            <TreeNodeRow
              key={child.note.id}
              node={child}
              depth={depth + 1}
              selectedNoteId={selectedNoteId}
              expandedIds={expandedIds}
              draggingId={draggingId}
              dragOverId={dragOverId}
              onToggleExpand={onToggleExpand}
              onSelect={onSelect}
              onDelete={onDelete}
              onPin={onPin}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
              onContextMenu={onContextMenu}
            />
          ))}
        </div>
      )}
    </div>
  );
});

export default NoteTree;
