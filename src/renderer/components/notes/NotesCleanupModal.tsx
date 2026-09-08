/**
 * NotesCleanupModal — nettoyage ASSISTÉ des notes parasites (copies de conflit
 * fabriquées en boucle, notes miroir sans titre). Voisin direct de
 * `NotesTrashModal` : même Modal, mêmes composants du design system, même
 * ancrage dans la barre latérale des notes.
 *
 * QUATRE RÈGLES DE SÛRETÉ, parce que cet écran supprime DÉFINITIVEMENT :
 *  1. Rien n'est coché d'avance qui ne soit PROUVÉ sans perte — ni par « tout
 *     cocher », qui ne porte que sur les lignes sûres. Une copie dont l'original
 *     a disparu, dont le texte ou le document ne se retrouvent pas chez lui, ou
 *     que l'utilisateur a retravaillée, est listée « à garder », case VIDE.
 *  2. La suppression demande une confirmation explicite qui affiche le compte
 *     exact et dit que l'action est irréversible — la bannière vit dans le PIED,
 *     sous les yeux de qui clique, et non au bas d'un corps qui défile.
 *  3. Elle passe par `permanentlyDeleteNotesBatch`, qui pose les pierres
 *     tombales de purge. Une suppression ordinaire (`deleteNotesBatch`, qui
 *     n'écrit qu'un `deletedAt`) laisserait la fusion ramener les notes du nuage
 *     au cycle suivant — le nettoyage serait défait tout seul.
 *  4. `permanentlyDeleteNotesBatch` est un réducteur PUR : les pierres tombales
 *     ne vivent qu'en mémoire tant que rien ne les écrit. On enchaîne donc
 *     `saveNotesToDisk` et on n'annonce le succès qu'après — comme le fait déjà
 *     la purge de la corbeille (`purgeExpiredTrashedNotes`).
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector, useDispatch } from 'react-redux';
import Modal, { ModalBody, ModalFooter } from '../ui/Modal/Modal';
import Button from '../ui/Button/Button';
import Checkbox from '../ui/Checkbox/Checkbox';
import {
  selectSuspectNotes,
  permanentlyDeleteNotesBatch,
  saveNotesToDisk,
} from '../../../store/slices/notesSlice';
import { defaultSelection } from '../../../services/notes/ghostNotes';
import type { SuspectFamily, SuspectNote } from '../../../services/notes/ghostNotes';
import type { AppDispatch } from '../../../store';
import { useNotification } from '../ui/Notification';

interface NotesCleanupModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const FAMILY_ORDER: SuspectFamily[] = ['conflictCopy', 'mirror'];

/** Dates dans la langue de l'APPLICATION, pas dans celle du système. */
function formatDate(iso: string, locale: string): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  try {
    return date.toLocaleString(locale || undefined);
  } catch {
    return date.toLocaleString();
  }
}

/** Id DOM stable pour relier une ligne à sa case (les ids de note sont libres). */
function rowDomId(id: string): string {
  return `notes-cleanup-${id.replace(/[^\w-]/g, '_')}`;
}

export const NotesCleanupModal: React.FC<NotesCleanupModalProps> = ({ isOpen, onClose }) => {
  const { t, i18n } = useTranslation();
  const dispatch = useDispatch<AppDispatch>();
  const suspects = useSelector(selectSuspectNotes);
  const { success, error } = useNotification();
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [armed, setArmed] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // La présélection est recalculée à chaque OUVERTURE, jamais pendant : sinon un
  // cycle de synchronisation qui arrive en pleine lecture recocherait des cases
  // que l'utilisateur vient de décocher.
  useEffect(() => {
    if (!isOpen) return;
    setSelected(new Set(defaultSelection(suspects)));
    setArmed(false);
    setDeleting(false);
  }, [isOpen]);

  const groups = useMemo(() => {
    const byFamily = new Map<SuspectFamily, SuspectNote[]>();
    for (const family of FAMILY_ORDER) byFamily.set(family, []);
    for (const suspect of suspects) byFamily.get(suspect.family)?.push(suspect);
    return FAMILY_ORDER.map((family) => ({ family, items: byFamily.get(family) ?? [] })).filter(
      (group) => group.items.length > 0
    );
  }, [suspects]);

  // Une note peut disparaître du rapport entre deux rendus (synchronisation) :
  // on ne compte QUE des suspects encore présents, sinon le bouton annoncerait
  // un nombre que la suppression ne tiendrait pas.
  const selectedIds = useMemo(
    () => suspects.filter((s) => selected.has(s.id)).map((s) => s.id),
    [suspects, selected]
  );

  const toggle = (id: string): void => {
    setArmed(false);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const setGroup = (items: SuspectNote[], checked: boolean): void => {
    setArmed(false);
    setSelected((prev) => {
      const next = new Set(prev);
      for (const item of items) {
        if (checked) next.add(item.id);
        else next.delete(item.id);
      }
      return next;
    });
  };

  const clearAll = (): void => {
    setArmed(false);
    setSelected(new Set());
  };

  const handleDelete = async (): Promise<void> => {
    if (selectedIds.length === 0 || deleting) return;
    if (!armed) {
      setArmed(true);
      return;
    }
    const ids = selectedIds;
    setDeleting(true);
    // `permanentlyDeleteNotesBatch` pose les pierres tombales : sans elles, la
    // fusion ramènerait les notes du nuage. Mais c'est un réducteur pur — sans
    // l'écriture qui suit, fermer avant l'auto-sauvegarde débouncée perdrait la
    // purge, et les notes reviendraient au prochain chargement.
    dispatch(permanentlyDeleteNotesBatch(ids));
    try {
      await dispatch(saveNotesToDisk()).unwrap();
    } catch {
      setDeleting(false);
      setArmed(false);
      error(
        t(
          'notes.cleanup.saveFailed',
          'Deletion not written to disk. The notes may come back: please try again.'
        )
      );
      return;
    }
    success(
      t('notes.cleanup.deleted', {
        count: ids.length,
        defaultValue: '{{count}} ghost note(s) permanently deleted',
      })
    );
    setSelected(new Set());
    setArmed(false);
    setDeleting(false);
    onClose();
  };

  const close = (): void => {
    if (deleting) return;
    setArmed(false);
    onClose();
  };

  const familyLabel = (family: SuspectFamily): string =>
    family === 'conflictCopy'
      ? t('notes.cleanup.family.conflictCopy', 'Conflict copies')
      : t('notes.cleanup.family.mirror', 'Untitled mirror notes');

  const familyHint = (family: SuspectFamily): string =>
    family === 'conflictCopy'
      ? t(
          'notes.cleanup.family.conflictCopyHint',
          'Backups made by the merge. Checked only when the original note already holds all of their text AND all of their document.'
        )
      : t(
          'notes.cleanup.family.mirrorHint',
          'Untitled notes with an empty document. Checked only when another live note still holds their text.'
        );

  const verdictLabel = (suspect: SuspectNote): string => {
    switch (suspect.verdict) {
      case 'redundant':
        return t('notes.cleanup.verdict.redundant', 'Text and content already in the original');
      case 'uniqueText':
        return t('notes.cleanup.verdict.uniqueText', 'Text not found in the original');
      case 'uniqueContent':
        return t(
          'notes.cleanup.verdict.uniqueContent',
          'Content missing from the original (image, table, database…)'
        );
      case 'userEdited':
        return t('notes.cleanup.verdict.userEdited', 'Edited after the merge created it');
      case 'originGone':
        return t('notes.cleanup.verdict.originGone', 'Original gone');
      case 'mirrorOrphan':
        return t('notes.cleanup.verdict.mirrorOrphan', 'Text found in no other note');
      default:
        return t('notes.cleanup.verdict.mirror', 'Text found in another note');
    }
  };

  const originLabel = (suspect: SuspectNote): string =>
    suspect.family === 'mirror'
      ? t('notes.cleanup.holder', 'Text found in')
      : t('notes.cleanup.origin', 'Original');

  const confirmBanner = armed && (
    <p className="notes-cleanup__warning" role="alert">
      {t('notes.cleanup.confirmBanner', {
        count: selectedIds.length,
        defaultValue:
          'Permanently delete {{count}} note(s)? This cannot be undone: they do not go to the trash and will not come back from the cloud.',
      })}
    </p>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={close}
      title={t('notes.cleanup.title', 'Clean up ghost notes')}
      size="lg"
    >
      <ModalBody>
        {suspects.length === 0 ? (
          <p className="notes-cleanup__empty">
            {t('notes.cleanup.empty', 'No ghost notes detected.')}
          </p>
        ) : (
          <>
            <p className="notes-cleanup__intro">
              {t(
                'notes.cleanup.intro',
                'These notes were produced by sync defects, not by you. Check each excerpt before deleting: deletion is permanent.'
              )}
            </p>
            <p className="notes-cleanup__scope">
              {t(
                'notes.cleanup.scope',
                'This report covers NOTES only. The merge also makes conflict copies of notebooks (name followed by ⚠): spot and delete those in the notebook list.'
              )}
            </p>

            {groups.map(({ family, items }) => {
              // « Tout cocher » ne porte QUE sur les lignes prouvées sans perte :
              // cocher en masse ce qui est « à garder » annulerait tout le travail
              // de tri du rapport.
              const safeItems = items.filter((item) => item.safeToPurge);
              const canSelect = safeItems.some((item) => !selected.has(item.id));
              const anySelected = items.some((item) => selected.has(item.id));
              return (
                <section key={family} className="notes-cleanup__group">
                  <header className="notes-cleanup__group-header">
                    <div className="notes-cleanup__group-heading">
                      <h3 className="notes-cleanup__group-title">
                        {familyLabel(family)}
                        <span className="notes-cleanup__group-count">{items.length}</span>
                      </h3>
                      <p className="notes-cleanup__group-hint">{familyHint(family)}</p>
                    </div>
                    {(canSelect || anySelected) && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          canSelect ? setGroup(safeItems, true) : setGroup(items, false)
                        }
                      >
                        {canSelect
                          ? t('notes.cleanup.selectSafe', 'Check the safe ones')
                          : t('notes.cleanup.deselectGroup', 'Deselect all')}
                      </Button>
                    )}
                  </header>

                  <ul className="notes-cleanup__list">
                    {items.map((suspect) => {
                      const domId = rowDomId(suspect.id);
                      return (
                        <li
                          key={suspect.id}
                          className={`notes-cleanup__item${
                            suspect.safeToPurge ? '' : ' notes-cleanup__item--keep'
                          }`}
                        >
                          <Checkbox
                            checked={selected.has(suspect.id)}
                            onChange={() => toggle(suspect.id)}
                            // La ligne ENTIÈRE nomme la case : sur un écran qui
                            // supprime pour de bon, « Note sans titre » ne dit pas
                            // ce que l'on s'apprête à détruire.
                            aria-labelledby={`${domId}-title ${domId}-badge ${domId}-verdict`}
                          />
                          <div className="notes-cleanup__body">
                            <div className="notes-cleanup__head">
                              <span className="notes-cleanup__title" id={`${domId}-title`}>
                                {suspect.title || t('notes.cleanup.untitled', 'Untitled note')}
                              </span>
                              <span
                                id={`${domId}-badge`}
                                className={`notes-cleanup__badge${
                                  suspect.safeToPurge ? '' : ' notes-cleanup__badge--keep'
                                }`}
                              >
                                {suspect.safeToPurge
                                  ? t('notes.cleanup.badge.safe', 'No loss')
                                  : t('notes.cleanup.badge.keep', 'Keep')}
                              </span>
                            </div>
                            <p className="notes-cleanup__excerpt">
                              {suspect.excerpt
                                ? `${suspect.excerpt}${suspect.truncated ? '…' : ''}`
                                : t('notes.cleanup.noText', '(no text)')}
                            </p>
                            <p className="notes-cleanup__meta">
                              <span id={`${domId}-verdict`}>{verdictLabel(suspect)}</span>
                              {suspect.origin && (
                                <span>
                                  {originLabel(suspect)} :{' '}
                                  {suspect.origin.title ||
                                    t('notes.cleanup.untitled', 'Untitled note')}
                                </span>
                              )}
                              {formatDate(suspect.date, i18n.language) && (
                                <span>{formatDate(suspect.date, i18n.language)}</span>
                              )}
                            </p>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })}
          </>
        )}
      </ModalBody>

      <ModalFooter className="notes-cleanup__footer">
        {confirmBanner}
        <div className="notes-cleanup__actions">
          {suspects.length > 0 && (
            <span className="notes-cleanup__count">
              {t('notes.cleanup.selectedCount', {
                count: selectedIds.length,
                total: suspects.length,
                defaultValue: '{{count}} of {{total}} selected',
              })}
            </span>
          )}
          {selectedIds.length > 0 && (
            <Button variant="ghost" onClick={clearAll} disabled={deleting}>
              {t('notes.cleanup.clearAll', 'Deselect everything')}
            </Button>
          )}
          <Button variant="secondary" onClick={close} disabled={deleting}>
            {t('common.close', 'Close')}
          </Button>
          {suspects.length > 0 && (
            <Button
              variant="danger"
              onClick={() => void handleDelete()}
              disabled={selectedIds.length === 0 || deleting}
            >
              {armed
                ? t('notes.cleanup.confirmDelete', {
                    count: selectedIds.length,
                    defaultValue: 'Confirm deletion of {{count}} note(s)',
                  })
                : t('notes.cleanup.delete', {
                    count: selectedIds.length,
                    defaultValue: 'Delete {{count}} note(s)',
                  })}
            </Button>
          )}
        </div>
      </ModalFooter>
    </Modal>
  );
};

export default NotesCleanupModal;
