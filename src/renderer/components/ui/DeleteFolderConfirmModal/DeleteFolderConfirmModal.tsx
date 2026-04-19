/**
 * DeleteFolderConfirmModal Component
 *
 * Modal de confirmation pour la suppression de dossiers
 * Affiche les informations sur le contenu du dossier (nombre d'items, taille totale, liste des items)
 */

import { FC } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, ModalHeader, ModalBody, ModalFooter } from '../Modal/Modal';
import { Button } from '../Button/Button';
import { formatBytes } from '../../../../constants/limits';
import type { Item } from '../../../../types';
import './DeleteFolderConfirmModal.css';

export interface DeleteFolderConfirmModalProps {
  /** Modal ouvert ou fermé */
  isOpen: boolean;
  /** Callback de fermeture */
  onClose: () => void;
  /** Callback de confirmation */
  onConfirm: () => void;
  /** Nom du dossier à supprimer */
  folderName: string;
  /** Liste des items dans le dossier */
  items: Item[];
  /** Nombre total d'items (incluant sous-dossiers récursifs) */
  totalItemCount: number;
  /** Taille totale en bytes */
  totalSize: number;
  /** Nombre de notes dans le dossier */
  noteCount?: number;
  /** Indique si la suppression est en cours */
  isDeleting?: boolean;
}

/**
 * Icône d'avertissement
 */
const WarningIcon: FC = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={2}
    stroke="currentColor"
    width="24"
    height="24"
    className="warning-icon"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
    />
  </svg>
);

/**
 * Icône de fichier
 */
const FileIcon: FC = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={1.5}
    stroke="currentColor"
    width="16"
    height="16"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
    />
  </svg>
);

/**
 * Icône de dossier
 */
const FolderIcon: FC = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={1.5}
    stroke="currentColor"
    width="16"
    height="16"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z"
    />
  </svg>
);

/**
 * Détermine si un item est un dossier
 */
const isFolder = (item: Item): boolean => {
  return 'items' in item && Array.isArray(item.items);
};

/**
 * Composant DeleteFolderConfirmModal
 */
export const DeleteFolderConfirmModal: FC<DeleteFolderConfirmModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  folderName,
  items,
  totalItemCount,
  totalSize,
  noteCount = 0,
  isDeleting = false,
}) => {
  const { t } = useTranslation();
  // Limiter l'affichage à 10 items max
  const displayItems = items.slice(0, 10);
  const hasMoreItems = items.length > 10;
  const remainingCount = items.length - 10;

  // Calculer le nombre de fichiers et dossiers
  const fileCount = items.filter((item) => !isFolder(item)).length;
  const folderCount = items.filter((item) => isFolder(item)).length;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="md"
      closeOnBackdrop={!isDeleting}
      closeOnEsc={!isDeleting}
    >
      <ModalHeader onClose={onClose} showCloseButton={!isDeleting}>
        <div className="delete-folder-modal__header">
          <WarningIcon />
          <span>{t('deleteFolder.confirmTitle')}</span>
        </div>
      </ModalHeader>

      <ModalBody>
        <div className="delete-folder-modal__body">
          <div className="delete-folder-modal__message">
            <p>{t('deleteFolder.confirmMessage', { name: folderName })}</p>
            <p className="delete-folder-modal__warning">{t('deleteFolder.warning')}</p>
          </div>

          {items.length > 0 && (
            <div className="delete-folder-modal__info">
              <div className="delete-folder-modal__stats">
                <div className="delete-folder-modal__stat">
                  <span className="stat-label">{t('deleteFolder.directItems')}</span>
                  <span className="stat-value">
                    {fileCount > 0 && t('deleteFolder.fileCount', { count: fileCount })}
                    {fileCount > 0 && folderCount > 0 && ', '}
                    {folderCount > 0 && t('deleteFolder.folderCount', { count: folderCount })}
                  </span>
                </div>

                {totalItemCount !== items.length && (
                  <div className="delete-folder-modal__stat">
                    <span className="stat-label">{t('deleteFolder.totalRecursive')}</span>
                    <span className="stat-value">
                      {t('deleteFolder.itemCount', { count: totalItemCount })}
                    </span>
                  </div>
                )}

                {noteCount > 0 && (
                  <div className="delete-folder-modal__stat">
                    <span className="stat-label">{t('deleteFolder.notes', 'Notes')}</span>
                    <span className="stat-value">
                      {t('deleteFolder.noteCount', {
                        count: noteCount,
                        defaultValue: `${noteCount} note(s)`,
                      })}
                    </span>
                  </div>
                )}

                <div className="delete-folder-modal__stat">
                  <span className="stat-label">{t('deleteFolder.totalSize')}</span>
                  <span className="stat-value">{formatBytes(totalSize)}</span>
                </div>
              </div>

              <div className="delete-folder-modal__items-list">
                <h4>{t('deleteFolder.folderContent')}</h4>
                <ul>
                  {displayItems.map((item) => (
                    <li key={item.id} className="delete-folder-modal__item">
                      {isFolder(item) ? <FolderIcon /> : <FileIcon />}
                      <span className="item-name">{item.name}</span>
                      {!isFolder(item) && 'size' in item && item.size && (
                        <span className="item-size">({formatBytes(item.size)})</span>
                      )}
                    </li>
                  ))}
                </ul>

                {hasMoreItems && (
                  <p className="delete-folder-modal__more">
                    {t('deleteFolder.andMore', { count: remainingCount })}
                  </p>
                )}
              </div>
            </div>
          )}

          {items.length === 0 && (
            <div className="delete-folder-modal__empty">
              <p>{t('deleteFolder.emptyFolder')}</p>
            </div>
          )}
        </div>
      </ModalBody>

      <ModalFooter>
        <div className="delete-folder-modal__actions">
          <Button variant="secondary" onClick={onClose} disabled={isDeleting}>
            {t('common.cancel')}
          </Button>
          <Button variant="danger" onClick={onConfirm} disabled={isDeleting}>
            {isDeleting ? t('deleteFolder.deleting') : t('deleteFolder.delete')}
          </Button>
        </div>
      </ModalFooter>
    </Modal>
  );
};

export default DeleteFolderConfirmModal;
