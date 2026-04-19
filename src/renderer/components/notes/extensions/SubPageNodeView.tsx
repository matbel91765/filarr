/**
 * SubPageNodeView — React NodeView for the SubPage TipTap node.
 *
 * Renders a Notion-style page link block.  On first mount, if noteId is empty
 * it creates a new note via Redux and updates the node attrs.
 * Click navigates to the linked note.
 */

import React, { useCallback, useEffect, useRef } from 'react';
import { NodeViewWrapper } from '@tiptap/react';
import { useSelector, useDispatch } from 'react-redux';
import type { RootState, AppDispatch } from '../../../../store';
import { addNote, setEditingNote } from '../../../../store/slices/notesSlice';
import { createNote } from '../../../../services/notes/noteService';

interface SubPageNodeViewProps {
  node: {
    attrs: {
      noteId: string;
      title: string;
      icon: string;
    };
  };
  updateAttributes: (attrs: Record<string, unknown>) => void;
  selected: boolean;
  deleteNode: () => void;
}

export const SubPageNodeView: React.FC<SubPageNodeViewProps> = ({
  node,
  updateAttributes,
  selected,
  deleteNode,
}) => {
  const dispatch = useDispatch<AppDispatch>();
  const { noteId, icon } = node.attrs;
  const created = useRef(false);

  // Read the linked note's current title from Redux (stays in sync)
  const linkedNote = useSelector((state: RootState) =>
    noteId ? state.notes.byId[noteId] : undefined
  );

  const displayTitle = linkedNote?.title || node.attrs.title || 'Untitled';
  const displayIcon = linkedNote?.icon || icon || '📄';

  // Auto-create the note on first mount when noteId is empty
  useEffect(() => {
    if (noteId || created.current) return;
    created.current = true;

    const newNote = createNote({ title: '' });
    dispatch(addNote(newNote));
    updateAttributes({ noteId: newNote.id, title: newNote.title, icon: '' });

    // Navigate to the new note so the user can start writing
    dispatch(setEditingNote(newNote.id));
  }, [noteId, dispatch, updateAttributes]);

  // Keep node attrs in sync with Redux note title
  useEffect(() => {
    if (linkedNote && linkedNote.title !== node.attrs.title) {
      updateAttributes({ title: linkedNote.title });
    }
    if (linkedNote?.icon && linkedNote.icon !== node.attrs.icon) {
      updateAttributes({ icon: linkedNote.icon });
    }
  }, [linkedNote, node.attrs.title, node.attrs.icon, updateAttributes]);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (noteId) {
        dispatch(setEditingNote(noteId));
      }
    },
    [dispatch, noteId]
  );

  const handleDelete = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      deleteNode();
    },
    [deleteNode]
  );

  // If the linked note was deleted, show a "broken link" state
  const isOrphan = noteId && !linkedNote;

  return (
    <NodeViewWrapper className="sub-page-wrapper" data-sub-page="">
      <div
        className={`sub-page-block ${selected ? 'sub-page-block--selected' : ''} ${isOrphan ? 'sub-page-block--orphan' : ''}`}
        onClick={handleClick}
        role="button"
        tabIndex={0}
      >
        <span className="sub-page-block__icon">{displayIcon}</span>
        <span className="sub-page-block__title">
          {isOrphan ? 'Deleted page' : displayTitle || 'Untitled'}
        </span>
        <span className="sub-page-block__arrow">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </span>
        {selected && (
          <button
            className="sub-page-block__remove"
            onClick={handleDelete}
            title="Remove link"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
      </div>
    </NodeViewWrapper>
  );
};
