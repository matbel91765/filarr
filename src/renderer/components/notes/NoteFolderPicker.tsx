/**
 * NoteFolderPicker — Assign a note to a folder.
 *
 * Displayed in the right panel of NotesView.
 * Lets the user pick a parent folder for the current note,
 * so it appears in that folder's view alongside files.
 */

import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector, useDispatch } from 'react-redux';
import type { RootState, AppDispatch } from '../../../store';
import type { Folder } from '../../../types';
import { updateNote } from '../../../store/slices/notesSlice';

interface NoteFolderPickerProps {
  noteId: string;
  currentParentId: string | null;
}

interface FolderOption {
  id: string;
  label: string;
}

export function NoteFolderPicker({ noteId, currentParentId }: NoteFolderPickerProps) {
  const { t } = useTranslation();
  const dispatch = useDispatch<AppDispatch>();
  const foldersById = useSelector((state: RootState) => state.folders.byId) as Record<
    string,
    Folder
  >;

  const folderOptions = useMemo((): FolderOption[] => {
    const folders = Object.values(foldersById);

    function getPath(folderId: string): string {
      const parts: string[] = [];
      let current: Folder | undefined = foldersById[folderId];
      while (current) {
        parts.unshift(current.name);
        current = current.parentId ? foldersById[current.parentId] : undefined;
      }
      return parts.join(' / ');
    }

    return folders
      .filter((f: Folder) => !f.deletedAt)
      .map((f: Folder) => ({ id: f.id, label: getPath(f.id) }))
      .sort((a: FolderOption, b: FolderOption) => a.label.localeCompare(b.label));
  }, [foldersById]);

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    dispatch(
      updateNote({
        id: noteId,
        changes: { parentId: value || null },
      })
    );
  };

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
      <select
        value={currentParentId || ''}
        onChange={handleChange}
        className="w-full px-2.5 py-1.5 text-sm rounded-lg
          bg-[var(--color-background-secondary)] text-[var(--color-text-primary)]
          border border-[var(--color-border)] cursor-pointer
          hover:border-[var(--color-border-strong)]
          focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-400)]"
      >
        <option value="">{t('notes.noFolder', 'None (root)')}</option>
        {folderOptions.map((f: FolderOption) => (
          <option key={f.id} value={f.id}>
            {f.label}
          </option>
        ))}
      </select>
    </div>
  );
}
