/**
 * NoteBreadcrumb — Filarr Notes
 *
 * Hierarchical ancestor trail (Notion-style): Notes > parent > … > current.
 * Ancestry is derived from sub-page blocks (a note "contains" the notes its
 * sub-page nodes point to). Clicking a segment navigates to that note.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector, useDispatch } from 'react-redux';
import type { RootState, AppDispatch } from '../../../store';
import { selectSubPageParentMap, setEditingNote } from '../../../store/slices/notesSlice';
import type { Note } from '../../../types/notes';

// Au-delà de 3 ancêtres affichés : racine > … > parent immédiat
const MAX_ANCESTORS_SHOWN = 3;

const ChevronRight = () => (
  <svg
    width="10"
    height="10"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2.5}
    opacity={0.3}
  >
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
    const byId = useSelector((state: RootState) => state.notes.byId);
    const parentOf = useSelector(selectSubPageParentMap);

    // Chaîne d'ancêtres en remontant parent par parent (garde anti-cycle)
    const ancestors: Note[] = [];
    const visited = new Set<string>([currentNoteId]);
    let cursor = parentOf.get(currentNoteId);
    while (cursor && !visited.has(cursor)) {
      const parent = byId[cursor];
      if (!parent || parent.deletedAt) break;
      visited.add(cursor);
      ancestors.unshift(parent);
      cursor = parentOf.get(cursor);
    }

    const truncated = ancestors.length > MAX_ANCESTORS_SHOWN;
    const crumbs = truncated ? [ancestors[0], ancestors[ancestors.length - 1]] : ancestors;

    const currentTitle = byId[currentNoteId]?.title || t('notes.untitled', 'Untitled');

    return (
      <div className="note-breadcrumb">
        <span className="note-breadcrumb__root">
          <NotesIcon />
          <span>{t('notes.title', 'Notes')}</span>
        </span>
        <ChevronRight />
        {crumbs.map((note, index) => (
          <React.Fragment key={note.id}>
            <button
              className="note-breadcrumb__item"
              onClick={() => dispatch(setEditingNote(note.id))}
              title={note.title || t('notes.untitled', 'Untitled')}
            >
              {note.title || t('notes.untitled', 'Untitled')}
            </button>
            <ChevronRight />
            {truncated && index === 0 && (
              <>
                <span className="note-breadcrumb__root">…</span>
                <ChevronRight />
              </>
            )}
          </React.Fragment>
        ))}
        <span className="note-breadcrumb__current">{currentTitle}</span>
      </div>
    );
  }
);

export default NoteBreadcrumb;
