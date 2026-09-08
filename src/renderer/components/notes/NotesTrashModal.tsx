/**
 * NotesTrashModal — surfaces soft-deleted notes so the user can restore
 * or permanently delete them. The modal closes the data-loss gap that
 * was hidden before: the existing delete UI silently set `deletedAt` (or
 * worse, hard-deleted on multi-select) without any way to recover.
 *
 * Layout: a list of trashed notes sorted by deletion time, each row with
 * a restore button and a permanent-delete button. "Vider la corbeille"
 * at the footer hard-deletes everything.
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector, useDispatch } from 'react-redux';
import Modal, { ModalBody, ModalFooter } from '../ui/Modal/Modal';
import Button from '../ui/Button/Button';
import {
  selectTrashedNotes,
  restoreNote,
  permanentlyDeleteNote,
  permanentlyDeleteNotesBatch,
} from '../../../store/slices/notesSlice';
import type { AppDispatch } from '../../../store';
import { useNotification } from '../ui/Notification';

interface NotesTrashModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/** Display a deletion timestamp as a relative-ish label ("aujourd'hui", "hier", or date). */
function formatDeletedAt(iso: string | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  const now = new Date();
  const ms = now.getTime() - date.getTime();
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));
  if (days < 1) return "aujourd'hui";
  if (days < 2) return 'hier';
  if (days < 7) return `il y a ${days} jours`;
  return date.toLocaleDateString();
}

export const NotesTrashModal: React.FC<NotesTrashModalProps> = ({ isOpen, onClose }) => {
  const { t } = useTranslation();
  const dispatch = useDispatch<AppDispatch>();
  const trashedNotes = useSelector(selectTrashedNotes);
  const { success, error } = useNotification();
  const [confirmEmpty, setConfirmEmpty] = useState(false);

  const handleRestore = (id: string, title: string) => {
    dispatch(restoreNote(id));
    success(t('notes.trash.restored', { title }));
  };

  const handlePermanentDelete = (id: string, title: string) => {
    if (!window.confirm(t('notes.trash.confirmDelete', { title }))) {
      return;
    }
    dispatch(permanentlyDeleteNote(id));
  };

  const handleEmptyTrash = () => {
    if (!confirmEmpty) {
      setConfirmEmpty(true);
      return;
    }
    const ids = trashedNotes.map((n) => n.id);
    if (ids.length === 0) return;
    dispatch(permanentlyDeleteNotesBatch(ids));
    success(t('notes.trash.emptied', { count: ids.length }));
    setConfirmEmpty(false);
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => {
        setConfirmEmpty(false);
        onClose();
      }}
      title={t('notes.trash.title', 'Corbeille des notes')}
      size="md"
    >
      <ModalBody>
        {trashedNotes.length === 0 ? (
          <p className="text-sm text-[var(--color-text-tertiary)] text-center py-6">
            {t('notes.trash.empty', 'Aucune note supprimée')}
          </p>
        ) : (
          <ul className="notes-trash-list">
            {trashedNotes.map((note) => (
              <li key={note.id} className="notes-trash-list__item">
                <div className="notes-trash-list__meta">
                  <span className="notes-trash-list__title">{note.title || 'Untitled'}</span>
                  <span className="notes-trash-list__date">
                    {t('notes.trash.deletedAt', 'Supprimée')} {formatDeletedAt(note.deletedAt)}
                  </span>
                </div>
                <div className="notes-trash-list__actions">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => handleRestore(note.id, note.title || 'Untitled')}
                  >
                    {t('notes.trash.restore', 'Restaurer')}
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => handlePermanentDelete(note.id, note.title || 'Untitled')}
                  >
                    {t('notes.trash.delete', 'Supprimer')}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" onClick={onClose}>
          {t('common.close', 'Fermer')}
        </Button>
        {trashedNotes.length > 0 && (
          <Button variant="danger" onClick={handleEmptyTrash}>
            {confirmEmpty
              ? t('notes.trash.confirmEmpty', 'Confirmer : tout supprimer')
              : t('notes.trash.empty_action', 'Vider la corbeille')}
          </Button>
        )}
      </ModalFooter>
    </Modal>
  );
};
