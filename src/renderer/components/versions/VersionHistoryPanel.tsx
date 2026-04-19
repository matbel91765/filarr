/**
 * Version History Panel Component
 *
 * Panneau affichant l'historique des versions d'un fichier avec:
 * - Liste des versions avec metadata
 * - Selection et preview d'une version
 * - Comparaison entre versions (diff view)
 * - Actions: restaurer, exporter, supprimer
 */

import React, { useEffect, useState, useCallback, FC } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import Button from '../ui/Button/Button';
import Modal, { ModalBody, ModalFooter } from '../ui/Modal/Modal';
import ProgressBar from '../ui/ProgressBar/ProgressBar';
import { useNotification } from '../ui/Notification';
import {
  fetchVersions,
  createVersion,
  compareVersions,
  restoreVersion,
  deleteVersion,
  exportVersion,
  selectVersion,
  closeVersionPanel,
  setCompareVersions,
  clearDiff,
} from '../../../store/slices/versionsSlice';
import type { FileVersion, VersionDiff } from '../../../services/core/versionService';
import type { AppDispatch, RootState } from '../../../store';

// ==================== TYPES ====================

interface VersionHistoryPanelProps {
  fileId: string;
  fileName: string;
  folderId?: string;
  fileSize?: number;
  onClose?: () => void;
  className?: string;
}

// ==================== ICONS ====================

const ClockIcon: FC = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </svg>
);

const RestoreIcon: FC = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
    <path d="M3 3v5h5" />
  </svg>
);

const DownloadIcon: FC = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);

const TrashIcon: FC = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </svg>
);

const CloseIcon: FC = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const PlusIcon: FC = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

const MinusIcon: FC = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

// ==================== HELPER FUNCTIONS ====================

const formatDate = (dateString: string): string => {
  const date = new Date(dateString);
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
};

const formatRelativeTime = (dateString: string): string => {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'A l\'instant';
  if (diffMins < 60) return `Il y a ${diffMins} min`;
  if (diffHours < 24) return `Il y a ${diffHours}h`;
  if (diffDays < 7) return `Il y a ${diffDays}j`;
  return formatDate(dateString);
};

const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

// ==================== SUB-COMPONENTS ====================

interface VersionItemProps {
  version: FileVersion;
  isSelected: boolean;
  isCompareA: boolean;
  isCompareB: boolean;
  onSelect: (version: FileVersion) => void;
  onCompareSelect: (version: FileVersion, slot: 'A' | 'B') => void;
  onRestore: (version: FileVersion) => void;
  onExport: (version: FileVersion) => void;
  onDelete: (version: FileVersion) => void;
}

const VersionItemComponent: FC<VersionItemProps> = ({
  version,
  isSelected,
  isCompareA,
  isCompareB,
  onSelect,
  onCompareSelect,
  onRestore,
  onExport,
  onDelete,
}) => {
  return (
    <div
      className={`flex flex-col gap-2 p-3 mb-2 rounded-lg border cursor-pointer transition-all duration-200
        bg-[var(--color-surface,#ffffff)] border-[var(--color-border,#e5e7eb)]
        hover:border-blue-300 hover:shadow-sm
        ${isSelected ? 'border-blue-500 bg-blue-50' : ''}
        ${isCompareA ? 'border-l-[3px] border-l-emerald-500' : ''}
        ${isCompareB ? 'border-l-[3px] border-l-amber-500' : ''}`}
      onClick={() => onSelect(version)}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 font-semibold text-[var(--color-text,#1f2937)]">
          <span className="text-blue-500"><ClockIcon /></span>
          <span>Version {version.versionNumber}</span>
        </div>
        <div className="text-xs text-[var(--color-text-secondary,#6b7280)]">
          {formatRelativeTime(version.createdAt)}
        </div>
      </div>

      {/* Meta */}
      <div className="flex items-center gap-3 text-sm">
        <span className="text-[var(--color-text-secondary,#6b7280)]">{formatBytes(version.size)}</span>
        {version.comment && (
          <span
            className="flex-1 italic text-[var(--color-text-tertiary,#9ca3af)] overflow-hidden text-ellipsis whitespace-nowrap"
            title={version.comment}
          >
            {version.comment}
          </span>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-1 pt-2 border-t border-[var(--color-border-light,#f3f4f6)]">
        <button
          className={`flex items-center justify-center w-7 h-7 rounded-md border text-xs font-semibold cursor-pointer transition-all duration-200
            ${isCompareA
              ? 'border-blue-500 bg-blue-500 text-white'
              : 'border-[var(--color-border,#e5e7eb)] bg-[var(--color-surface,#ffffff)] text-[var(--color-text-secondary,#6b7280)] hover:border-blue-500 hover:text-blue-500 hover:bg-blue-50'
            }`}
          onClick={(e) => { e.stopPropagation(); onCompareSelect(version, 'A'); }}
          title="Comparer (A)"
        >
          A
        </button>
        <button
          className={`flex items-center justify-center w-7 h-7 rounded-md border text-xs font-semibold cursor-pointer transition-all duration-200
            ${isCompareB
              ? 'border-blue-500 bg-blue-500 text-white'
              : 'border-[var(--color-border,#e5e7eb)] bg-[var(--color-surface,#ffffff)] text-[var(--color-text-secondary,#6b7280)] hover:border-blue-500 hover:text-blue-500 hover:bg-blue-50'
            }`}
          onClick={(e) => { e.stopPropagation(); onCompareSelect(version, 'B'); }}
          title="Comparer (B)"
        >
          B
        </button>
        <button
          className="flex items-center justify-center w-7 h-7 rounded-md border border-[var(--color-border,#e5e7eb)] bg-[var(--color-surface,#ffffff)] text-[var(--color-text-secondary,#6b7280)] text-xs font-semibold cursor-pointer transition-all duration-200 hover:border-blue-500 hover:text-blue-500 hover:bg-blue-50"
          onClick={(e) => { e.stopPropagation(); onRestore(version); }}
          title="Restaurer cette version"
        >
          <RestoreIcon />
        </button>
        <button
          className="flex items-center justify-center w-7 h-7 rounded-md border border-[var(--color-border,#e5e7eb)] bg-[var(--color-surface,#ffffff)] text-[var(--color-text-secondary,#6b7280)] text-xs font-semibold cursor-pointer transition-all duration-200 hover:border-blue-500 hover:text-blue-500 hover:bg-blue-50"
          onClick={(e) => { e.stopPropagation(); onExport(version); }}
          title="Exporter"
        >
          <DownloadIcon />
        </button>
        <button
          className="flex items-center justify-center w-7 h-7 rounded-md border border-[var(--color-border,#e5e7eb)] bg-[var(--color-surface,#ffffff)] text-[var(--color-text-secondary,#6b7280)] text-xs font-semibold cursor-pointer transition-all duration-200 hover:border-red-500 hover:text-red-500 hover:bg-red-50"
          onClick={(e) => { e.stopPropagation(); onDelete(version); }}
          title="Supprimer"
        >
          <TrashIcon />
        </button>
      </div>
    </div>
  );
};

interface DiffViewProps {
  diff: VersionDiff;
  onClose: () => void;
}

const DiffView: FC<DiffViewProps> = ({ diff, onClose }) => {
  return (
    <div className="flex-1 flex flex-col border-t border-[var(--color-border,#e5e7eb)] bg-[var(--color-surface-elevated,#fafafa)]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border,#e5e7eb)]">
        <h4 className="m-0 text-sm font-semibold text-[var(--color-text,#1f2937)]">
          Comparaison des versions
        </h4>
        <button
          className="flex items-center justify-center w-6 h-6 border-none bg-transparent rounded-md text-[var(--color-text-secondary,#6b7280)] cursor-pointer transition-all duration-200 hover:bg-gray-100"
          onClick={onClose}
        >
          <CloseIcon />
        </button>
      </div>

      {/* Stats */}
      <div className="flex gap-4 px-4 py-2 bg-[var(--color-surface,#ffffff)] border-b border-[var(--color-border,#e5e7eb)]">
        <span className="flex items-center gap-1 text-sm font-medium text-emerald-500">
          <PlusIcon /> {diff.additions} ajouts
        </span>
        <span className="flex items-center gap-1 text-sm font-medium text-red-500">
          <MinusIcon /> {diff.deletions} suppressions
        </span>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3">
        {diff.type === 'binary' ? (
          <div className="text-center p-4 text-[var(--color-text-secondary,#6b7280)]">
            <p>Les fichiers binaires ne peuvent pas etre compares en detail.</p>
            <p>Differences detectees entre les deux versions.</p>
          </div>
        ) : (
          <div className="font-mono text-sm">
            {diff.changes.map((change, index) => (
              <div
                key={index}
                className={`flex p-1 px-2 rounded mb-0.5
                  ${change.type === 'add' ? 'bg-emerald-50 text-emerald-800' : ''}
                  ${change.type === 'remove' ? 'bg-red-50 text-red-800' : ''}
                  ${change.type === 'modify' ? 'bg-amber-50' : ''}`}
              >
                {change.lineNumber && (
                  <span className="min-w-[40px] text-[var(--color-text-tertiary,#9ca3af)] select-none">
                    {change.lineNumber}
                  </span>
                )}
                <span className="flex-1 break-all">
                  {change.type === 'modify' ? (
                    <>
                      <span className="line-through text-red-500">{change.oldContent}</span>
                      <span className="text-[var(--color-text-tertiary,#9ca3af)]"> &rarr; </span>
                      <span className="text-emerald-500">{change.newContent}</span>
                    </>
                  ) : (
                    change.content
                  )}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

// ==================== MAIN COMPONENT ====================

const CreateVersionIcon: FC = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="8" x2="12" y2="16" />
    <line x1="8" y1="12" x2="16" y2="12" />
  </svg>
);

export const VersionHistoryPanel: FC<VersionHistoryPanelProps> = ({
  fileId,
  fileName,
  folderId,
  fileSize,
  onClose,
  className,
}) => {
  const dispatch = useDispatch<AppDispatch>();
  const { success, error: notifyError } = useNotification();

  // Redux state
  const versions = useSelector((state: RootState) =>
    (state as any).versions?.byFileId[fileId] ?? []
  );
  const selectedVersionId = useSelector((state: RootState) =>
    (state as any).versions?.selectedVersionId
  );
  const compareVersionIds = useSelector((state: RootState) =>
    (state as any).versions?.compareVersionIds ?? [null, null]
  );
  const currentDiff = useSelector((state: RootState) =>
    (state as any).versions?.currentDiff
  );
  const loading = useSelector((state: RootState) =>
    (state as any).versions?.loading ?? false
  );
  const comparing = useSelector((state: RootState) =>
    (state as any).versions?.comparing ?? false
  );
  const restoring = useSelector((state: RootState) =>
    (state as any).versions?.restoring ?? false
  );

  // Local state
  const [confirmRestoreVersion, setConfirmRestoreVersion] = useState<FileVersion | null>(null);
  const [confirmDeleteVersion, setConfirmDeleteVersion] = useState<FileVersion | null>(null);

  // Charger les versions au montage
  useEffect(() => {
    dispatch(fetchVersions(fileId));
  }, [dispatch, fileId]);

  // Handlers
  const handleSelectVersion = useCallback((version: FileVersion) => {
    dispatch(selectVersion(version.id));
  }, [dispatch]);

  const handleCompareSelect = useCallback((version: FileVersion, slot: 'A' | 'B') => {
    const newCompareIds: [string | null, string | null] = [...compareVersionIds] as [string | null, string | null];

    if (slot === 'A') {
      newCompareIds[0] = newCompareIds[0] === version.id ? null : version.id;
    } else {
      newCompareIds[1] = newCompareIds[1] === version.id ? null : version.id;
    }

    dispatch(setCompareVersions(newCompareIds));

    // Lancer la comparaison si les deux slots sont remplis
    if (newCompareIds[0] && newCompareIds[1]) {
      dispatch(compareVersions({
        versionIdA: newCompareIds[0],
        versionIdB: newCompareIds[1],
      }));
    }
  }, [dispatch, compareVersionIds]);

  const handleRestore = useCallback((version: FileVersion) => {
    setConfirmRestoreVersion(version);
  }, []);

  const confirmRestore = useCallback(async () => {
    if (!confirmRestoreVersion) return;

    try {
      await dispatch(restoreVersion({
        versionId: confirmRestoreVersion.id,
        fileId,
      })).unwrap();

      success(`Version ${confirmRestoreVersion.versionNumber} restauree avec succes`);
      setConfirmRestoreVersion(null);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : "Unknown error";
      notifyError(`Erreur lors de la restauration: ${errMsg}`);
    }
  }, [dispatch, confirmRestoreVersion, fileId, success, notifyError]);

  const handleExport = useCallback(async (version: FileVersion) => {
    try {
      await dispatch(exportVersion({ versionId: version.id })).unwrap();
      success(`Version ${version.versionNumber} exportee`);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : "Unknown error";
      notifyError(`Erreur lors de l'export: ${errMsg}`);
    }
  }, [dispatch, success, notifyError]);

  const handleDelete = useCallback((version: FileVersion) => {
    setConfirmDeleteVersion(version);
  }, []);

  const confirmDelete = useCallback(async () => {
    if (!confirmDeleteVersion) return;

    try {
      await dispatch(deleteVersion({
        fileId,
        versionId: confirmDeleteVersion.id,
      })).unwrap();

      success(`Version ${confirmDeleteVersion.versionNumber} supprimee`);
      setConfirmDeleteVersion(null);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : "Unknown error";
      notifyError(`Erreur lors de la suppression: ${errMsg}`);
    }
  }, [dispatch, confirmDeleteVersion, fileId, success, notifyError]);

  const handleCloseDiff = useCallback(() => {
    dispatch(clearDiff());
  }, [dispatch]);

  const handleClose = useCallback(() => {
    dispatch(closeVersionPanel());
    onClose?.();
  }, [dispatch, onClose]);

  const [creatingVersion, setCreatingVersion] = useState(false);

  const handleCreateVersion = useCallback(async () => {
    if (!folderId) {
      notifyError('Impossible de creer une version: dossier inconnu');
      return;
    }
    setCreatingVersion(true);
    try {
      await dispatch(createVersion({
        folderId,
        fileId,
        fileName,
        comment: 'Version manuelle',
        size: fileSize || 0,
        force: true,
      })).unwrap();
      success('Nouvelle version creee');
      // Refresh the list
      dispatch(fetchVersions(fileId));
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : "Unknown error";
      notifyError(`Erreur lors de la creation: ${errMsg || 'Erreur inconnue'}`);
    } finally {
      setCreatingVersion(false);
    }
  }, [dispatch, folderId, fileId, fileName, fileSize, success, notifyError]);

  return (
    <div className={`flex flex-col w-full h-full bg-[var(--color-surface,#ffffff)] rounded-xl overflow-hidden ${className || ''}`}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border,#e5e7eb)] bg-[var(--color-surface-elevated,#fafafa)]">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="text-blue-500 flex-shrink-0"><ClockIcon /></span>
          <div className="min-w-0">
            <h3 className="m-0 text-sm font-semibold text-[var(--color-text,#1f2937)] leading-tight">
              Historique des versions
            </h3>
            <span className="block text-xs text-[var(--color-text-secondary,#6b7280)] truncate max-w-[300px]">
              {fileName}
            </span>
          </div>
        </div>
        <button
          className="flex items-center justify-center w-7 h-7 flex-shrink-0 border-none bg-transparent rounded-md text-[var(--color-text-secondary,#6b7280)] cursor-pointer transition-colors duration-150 hover:bg-gray-100 hover:text-[var(--color-text,#1f2937)]"
          onClick={handleClose}
          aria-label="Fermer"
        >
          <CloseIcon />
        </button>
      </div>

      {/* Action bar */}
      {folderId && (
        <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--color-border,#e5e7eb)] bg-[var(--color-surface,#ffffff)]">
          <span className="text-xs text-[var(--color-text-secondary,#6b7280)]">
            {versions.length} version{versions.length !== 1 ? 's' : ''}
          </span>
          <button
            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-blue-600 bg-blue-50 border border-blue-200 rounded-md cursor-pointer transition-colors duration-150 hover:bg-blue-100 hover:border-blue-300 disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={handleCreateVersion}
            disabled={creatingVersion}
            title="Creer une nouvelle version manuellement"
          >
            <CreateVersionIcon />
            {creatingVersion ? 'Creation...' : 'Nouvelle version'}
          </button>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Version list */}
        <div className="flex-1 overflow-y-auto p-3">
          {loading && versions.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-8 text-center">
              <ProgressBar value={50} max={100} variant="primary" />
              <p className="mt-3 text-sm text-[var(--color-text-secondary,#6b7280)]">Chargement des versions...</p>
            </div>
          ) : versions.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-8 text-center">
              <span className="text-[var(--color-text-tertiary,#9ca3af)] mb-3">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
              </span>
              <p className="m-0 text-sm text-[var(--color-text-secondary,#6b7280)]">Aucune version disponible</p>
              <span className="mt-1 text-xs text-[var(--color-text-tertiary,#9ca3af)]">
                Cliquez sur "Nouvelle version" pour creer un point de sauvegarde.
              </span>
            </div>
          ) : (
            <>
              {!folderId && (
                <div className="flex items-center justify-between px-2 py-2 mb-2 text-xs text-[var(--color-text-secondary,#6b7280)]">
                  <span>{versions.length} version{versions.length !== 1 ? 's' : ''}</span>
                </div>
              )}

              {(compareVersionIds[0] || compareVersionIds[1]) && (
                <div className="flex items-center justify-end px-2 pb-2">
                  <button
                    className="px-2 py-1 text-xs text-blue-500 bg-transparent border border-blue-300 rounded cursor-pointer transition-colors duration-150 hover:bg-blue-50"
                    onClick={() => dispatch(setCompareVersions([null, null]))}
                  >
                    Effacer la selection
                  </button>
                </div>
              )}

              {versions.map((version: FileVersion) => (
                <VersionItemComponent
                  key={version.id}
                  version={version}
                  isSelected={selectedVersionId === version.id}
                  isCompareA={compareVersionIds[0] === version.id}
                  isCompareB={compareVersionIds[1] === version.id}
                  onSelect={handleSelectVersion}
                  onCompareSelect={handleCompareSelect}
                  onRestore={handleRestore}
                  onExport={handleExport}
                  onDelete={handleDelete}
                />
              ))}
            </>
          )}
        </div>

        {/* Diff view */}
        {currentDiff && (
          <DiffView diff={currentDiff} onClose={handleCloseDiff} />
        )}

        {/* Comparing loader */}
        {comparing && (
          <div className="flex flex-col items-center justify-center p-8 text-center">
            <ProgressBar value={50} max={100} variant="primary" />
            <p className="mt-3 text-[var(--color-text-secondary,#6b7280)]">Comparaison en cours...</p>
          </div>
        )}
      </div>

      {/* Restore confirmation modal */}
      <Modal
        isOpen={!!confirmRestoreVersion}
        onClose={() => setConfirmRestoreVersion(null)}
        size="sm"
        title="Restaurer la version"
      >
        <ModalBody>
          <p>
            Etes-vous sur de vouloir restaurer la version{' '}
            <strong>{confirmRestoreVersion?.versionNumber}</strong> ?
          </p>
          <p className="mt-2 px-3 py-2 bg-amber-50 rounded-md text-amber-800 text-sm">
            La version actuelle sera sauvegardee avant la restauration.
          </p>
        </ModalBody>
        <ModalFooter>
          <Button
            variant="secondary"
            onClick={() => setConfirmRestoreVersion(null)}
          >
            Annuler
          </Button>
          <Button
            variant="primary"
            onClick={confirmRestore}
            loading={restoring}
            leftIcon={<RestoreIcon />}
          >
            Restaurer
          </Button>
        </ModalFooter>
      </Modal>

      {/* Delete confirmation modal */}
      <Modal
        isOpen={!!confirmDeleteVersion}
        onClose={() => setConfirmDeleteVersion(null)}
        size="sm"
        title="Supprimer la version"
      >
        <ModalBody>
          <p>
            Etes-vous sur de vouloir supprimer la version{' '}
            <strong>{confirmDeleteVersion?.versionNumber}</strong> ?
          </p>
          <p className="mt-2 px-3 py-2 bg-red-50 rounded-md text-red-800 text-sm">
            Cette action est irreversible.
          </p>
        </ModalBody>
        <ModalFooter>
          <Button
            variant="secondary"
            onClick={() => setConfirmDeleteVersion(null)}
          >
            Annuler
          </Button>
          <Button
            variant="danger"
            onClick={confirmDelete}
            loading={loading}
            leftIcon={<TrashIcon />}
          >
            Supprimer
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
};

export default VersionHistoryPanel;
