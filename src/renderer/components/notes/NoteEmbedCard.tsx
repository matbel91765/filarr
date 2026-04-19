/**
 * NoteEmbedCard — Filarr Notes
 *
 * Compact card for displaying a note embedded in a folder view.
 * Shows title, preview, word count, and link count.
 */

import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useDispatch } from 'react-redux';
import type { AppDispatch } from '../../../store';
import { setEditingNote } from '../../../store/slices/notesSlice';
import { addTab } from '../../../store/slices/tabsSlice';
import type { Note } from '../../../types/notes';
import './NoteEmbedCard.css';

// ==================== Icon ====================

const NoteIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
    <path d="M14.5 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V7.5L14.5 2z" />
    <polyline points="14,2 14,8 20,8" />
    <line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" />
  </svg>
);

// ==================== Component ====================

interface NoteEmbedCardProps {
  note: Note;
}

export const NoteEmbedCard: React.FC<NoteEmbedCardProps> = React.memo(
  function NoteEmbedCard({ note }) {
    const { t } = useTranslation();
    const dispatch = useDispatch<AppDispatch>();

    const handleClick = useCallback(() => {
      dispatch(
        addTab({
          route: `/notes/${note.id}`,
          title: note.title || t('notes.untitled', 'Untitled'),
        })
      );
      dispatch(setEditingNote(note.id));
    }, [dispatch, note.id, note.title]);

    return (
      <div className="note-embed-card" onClick={handleClick} role="button" tabIndex={0}>
        <div className="note-embed-card__icon">
          <NoteIcon />
        </div>
        <div className="note-embed-card__body">
          <div className="note-embed-card__title">
            {note.title || t('notes.untitled', 'Untitled')}
          </div>
          {note.plainText && (
            <div className="note-embed-card__preview">
              {note.plainText.slice(0, 100)}
            </div>
          )}
          <div className="note-embed-card__meta">
            <span>{note.wordCount} {t('notes.words', 'words')}</span>
            {note.isDaily && (
              <span className="note-embed-card__badge">Daily</span>
            )}
          </div>
        </div>
      </div>
    );
  }
);

export default NoteEmbedCard;
