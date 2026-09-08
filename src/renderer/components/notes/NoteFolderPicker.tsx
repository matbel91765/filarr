/**
 * NoteFolderPicker — Assign a note to a folder.
 *
 * Displayed in the right panel of NotesView.
 * Lets the user pick a parent folder for the current note,
 * so it appears in that folder's view alongside files.
 */

import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useDispatch } from 'react-redux';
import type { AppDispatch } from '../../../store';
import { updateNote } from '../../../store/slices/notesSlice';
import { InlineFolderPicker } from '../automation/InlineFolderPicker';

interface NoteFolderPickerProps {
  noteId: string;
  currentParentId: string | null;
}

export function NoteFolderPicker({ noteId, currentParentId }: NoteFolderPickerProps) {
  const { t } = useTranslation();
  const dispatch = useDispatch<AppDispatch>();

  // Contrat inchangé : chaîne vide (bouton « effacer » du picker) ⇒ racine.
  const handleChange = useCallback(
    (folderId: string) => {
      dispatch(
        updateNote({
          id: noteId,
          changes: { parentId: folderId || null },
        })
      );
    },
    [dispatch, noteId]
  );

  return (
    <div className="px-3 py-3 border-b border-[var(--color-border-light)]">
      <div className="flex items-center gap-2 mb-2">
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-[var(--color-text-tertiary)]"
        >
          <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
        </svg>
        <span className="text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wide">
          {t('notes.parentFolder', 'Folder')}
        </span>
      </div>
      <InlineFolderPicker
        value={currentParentId}
        onChange={handleChange}
        placeholder={t('notes.noFolder', 'None (root)')}
      />
    </div>
  );
}
