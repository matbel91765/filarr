/**
 * NoteBreadcrumb — Filarr Notes
 *
 * Horizontal trail of recently visited notes.
 * Always shows "Notes" root and current note title.
 * Clicking a breadcrumb navigates back to that note.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector, useDispatch } from 'react-redux';
import type { AppDispatch } from '../../../store';
import { selectVisitHistory, setEditingNote } from '../../../store/slices/notesSlice';

const ChevronRight = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} opacity={0.3}>
    <polyline points="9,6 15,12 9,18" />
  </svg>
);

const NotesIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <path d="M14.5 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V7.5L14.5 2z" />
    <polyline points="14,2 14,8 20,8" />
  </svg>
);

export const NoteBreadcrumb: React.FC<{ currentNoteId: string }> = React.memo(
  function NoteBreadcrumb({ currentNoteId }) {
    const { t } = useTranslation();
    const dispatch = useDispatch<AppDispatch>();
    const history = useSelector(selectVisitHistory);

    // Show last 4 visited notes (excluding current)
    const crumbs = history
      .filter((n) => n.id !== currentNoteId)
      .slice(-4);

    const currentNote = history.find((n) => n.id === currentNoteId);
    const currentTitle = currentNote?.title || t('notes.untitled', 'Untitled');

    return (
      <div className="note-breadcrumb">
        <span className="note-breadcrumb__root">
          <NotesIcon />
          <span>{t('notes.title', 'Notes')}</span>
        </span>
        <ChevronRight />
        {crumbs.map((note) => (
          <React.Fragment key={note.id}>
            <button
              className="note-breadcrumb__item"
              onClick={() => dispatch(setEditingNote(note.id))}
              title={note.title || t('notes.untitled', 'Untitled')}
            >
              {note.title || t('notes.untitled', 'Untitled')}
            </button>
            <ChevronRight />
          </React.Fragment>
        ))}
        <span className="note-breadcrumb__current">
          {currentTitle}
        </span>
      </div>
    );
  }
);

export default NoteBreadcrumb;
