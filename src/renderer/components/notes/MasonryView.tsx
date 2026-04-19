/**
 * MasonryView — Filarr Notes
 *
 * CSS column-count masonry layout showing note cards
 * with title, preview, color accent, and badges.
 */

import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector, useDispatch } from 'react-redux';
import type { RootState, AppDispatch } from '../../../store';
import { selectFilteredNotes, setEditingNote } from '../../../store/slices/notesSlice';
import type { Note } from '../../../types/notes';
import './MasonryView.css';

// ==================== Card Colors ====================

const CARD_COLORS_LIGHT = [
  'rgba(135, 206, 235, 0.1)',
  'rgba(52, 211, 153, 0.08)',
  'rgba(251, 191, 36, 0.08)',
  'rgba(167, 139, 250, 0.08)',
  'rgba(244, 114, 182, 0.08)',
  'rgba(96, 165, 250, 0.08)',
];

const CARD_COLORS_DARK = [
  'rgba(135, 206, 235, 0.08)',
  'rgba(52, 211, 153, 0.10)',
  'rgba(251, 191, 36, 0.10)',
  'rgba(167, 139, 250, 0.10)',
  'rgba(244, 114, 182, 0.10)',
  'rgba(96, 165, 250, 0.10)',
];

function getCardColor(index: number): string {
  const theme = document.documentElement.getAttribute('data-theme');
  const isDark =
    theme === 'dark' ||
    theme === 'space' ||
    theme === 'aurora' ||
    theme === 'crepuscule' ||
    theme === 'foret';
  const colors = isDark ? CARD_COLORS_DARK : CARD_COLORS_LIGHT;
  return colors[index % colors.length];
}

function getPreview(plainText: string, maxLen = 120): string {
  if (!plainText) return '';
  const clean = plainText.replace(/\s+/g, ' ').trim();
  return clean.length > maxLen ? clean.slice(0, maxLen) + '...' : clean;
}

// ==================== Component ====================

export const MasonryView: React.FC = React.memo(function MasonryView() {
  const { t } = useTranslation();
  const dispatch = useDispatch<AppDispatch>();
  const notes = useSelector(selectFilteredNotes);
  const selectedNoteId = useSelector((s: RootState) => s.notes.selectedNoteId);

  const handleSelect = useCallback(
    (noteId: string) => {
      dispatch(setEditingNote(noteId));
    },
    [dispatch]
  );

  if (notes.length === 0) {
    return (
      <div className="masonry-view__empty">
        <p>{t('notes.emptyTitle', 'No notes yet')}</p>
      </div>
    );
  }

  return (
    <div className="masonry-view">
      {notes.map((note, i) => (
        <MasonryCard
          key={note.id}
          note={note}
          index={i}
          isSelected={note.id === selectedNoteId}
          onSelect={handleSelect}
        />
      ))}
    </div>
  );
});

// ==================== Card ====================

interface MasonryCardProps {
  note: Note;
  index: number;
  isSelected: boolean;
  onSelect: (id: string) => void;
}

const MasonryCard: React.FC<MasonryCardProps> = React.memo(function MasonryCard({
  note,
  index,
  isSelected,
  onSelect,
}) {
  const { t } = useTranslation();
  const preview = getPreview(note.plainText);

  return (
    <div
      className={`masonry-card ${isSelected ? 'masonry-card--selected' : ''} ${note.isPinned ? 'masonry-card--pinned' : ''}`}
      style={{ background: getCardColor(index) }}
      onClick={() => onSelect(note.id)}
      role="button"
      tabIndex={0}
    >
      <div className="masonry-card__header">
        <h3 className="masonry-card__title">{note.title || t('notes.untitled', 'Untitled')}</h3>
        {note.isPinned && (
          <span className="masonry-card__pin">
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="currentColor"
              stroke="currentColor"
              strokeWidth={1}
            >
              <path d="M12 17v5" />
              <path d="M9 10.76a2 2 0 01-1.11 1.79l-1.78.9A2 2 0 005 15.24V16a1 1 0 001 1h12a1 1 0 001-1v-.76a2 2 0 00-1.11-1.79l-1.78-.9A2 2 0 0115 10.76V7a1 1 0 011-1 1 1 0 001-1V4a1 1 0 00-1-1H8a1 1 0 00-1 1v1a1 1 0 001 1 1 1 0 011 1z" />
            </svg>
          </span>
        )}
      </div>
      {preview && <p className="masonry-card__preview">{preview}</p>}
      <div className="masonry-card__footer">
        <span className="masonry-card__date">
          {new Date(note.updatedAt).toLocaleDateString(undefined, {
            day: 'numeric',
            month: 'short',
          })}
        </span>
        {note.wordCount > 0 && (
          <span className="masonry-card__words">
            {note.wordCount} {t('notes.words', 'words')}
          </span>
        )}
        {note.linkedNoteIds.length > 0 && (
          <span className="masonry-card__links">
            {note.linkedNoteIds.length} {t('notes.links', 'links')}
          </span>
        )}
        {note.isDaily && (
          <span className="masonry-card__badge masonry-card__badge--daily">
            {t('notes.dailyNote', 'Daily')}
          </span>
        )}
      </div>
    </div>
  );
});

export default MasonryView;
