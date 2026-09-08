/**
 * SaveStateIndicator — local disk save state for the note editor.
 *
 * Reads notesSlice.saveStatus + notesSlice.lastSavedAt + the active note's
 * updatedAt to derive a human-readable state:
 *   - 'saving'  → mid-flight `saveNotesToDisk`
 *   - 'error'   → previous save failed
 *   - 'pending' → note has been edited since last successful save (debounce
 *                 hasn't fired yet)
 *   - 'synced'  → on disk, no local changes ahead of it
 *
 * Distinct from NoteSyncBadge, which describes *cloud* sync. This badge is
 * always meaningful — local-only users care about disk persistence too.
 *
 * Accessibility: a single `aria-live="polite"` region announces transitions
 * so screen readers can pick up "Saving" / "Synced" without yelling.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import type { RootState } from '../../../store';
import type { Note } from '../../../types/notes';

interface SaveStateIndicatorProps {
  note: Note;
}

type DerivedState = 'synced' | 'saving' | 'pending' | 'error';

function deriveState(
  saveStatus: 'synced' | 'saving' | 'error' | undefined,
  lastSavedAt: string | null | undefined,
  noteUpdatedAt: string
): DerivedState {
  if (saveStatus === 'saving') return 'saving';
  if (saveStatus === 'error') return 'error';
  // 'synced' from the slice perspective doesn't mean "this note's latest
  // edit is on disk" — it means the last save call completed. If the user
  // typed again after that call resolved, we're pending until the next
  // debounce fires.
  if (!lastSavedAt) return 'pending';
  if (new Date(noteUpdatedAt).getTime() > new Date(lastSavedAt).getTime()) return 'pending';
  return 'synced';
}

export const SaveStateIndicator: React.FC<SaveStateIndicatorProps> = ({ note }) => {
  const { t } = useTranslation();
  const saveStatus = useSelector((s: RootState) => s.notes.saveStatus);
  const lastSavedAt = useSelector((s: RootState) => s.notes.lastSavedAt);

  const state = deriveState(saveStatus, lastSavedAt, note.updatedAt);

  const config: Record<DerivedState, { label: string; tone: string }> = {
    synced: {
      label: t('notes.saveStateSynced', 'Enregistré'),
      tone: 'synced',
    },
    saving: {
      label: t('notes.saveStateSaving', 'Enregistrement…'),
      tone: 'saving',
    },
    pending: {
      label: t('notes.saveStatePending', 'Modifications en attente'),
      tone: 'pending',
    },
    error: {
      label: t('notes.saveStateError', "Échec de l'enregistrement"),
      tone: 'error',
    },
  };

  const { label, tone } = config[state];

  return (
    <span
      className={`note-editor__save-state note-editor__save-state--${tone}`}
      aria-live="polite"
      role="status"
      title={label}
    >
      <span className={`note-editor__save-dot note-editor__save-dot--${tone}`} aria-hidden="true" />
      <span className="note-editor__save-label">{label}</span>
    </span>
  );
};

export default SaveStateIndicator;
