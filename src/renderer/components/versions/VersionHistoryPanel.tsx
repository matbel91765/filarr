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

  if (diffMins < 1) return "A l'instant";
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
  /**
   * La version immédiatement plus ancienne, s'il y en a une. C'est elle qui
   * donne son sens au geste « Changements ».
   */
  precedente: FileVersion | null;
  onVoirChangements: (version: FileVersion, precedente: FileVersion) => void;
  onRestore: (version: FileVersion) => void;
  onExport: (version: FileVersion) => void;
  onDelete: (version: FileVersion) => void;
}

/**
 * UNE VERSION DANS LA LISTE, et le geste qu'on attend d'elle.
 *
 * La comparaison n'était accessible que par deux boutons « A » et « B » :
 * il fallait deviner qu'on en marque une A, puis une autre B, et que la
 * comparaison se déclenche alors toute seule. Personne ne devine cela.
 *
 * « Changements » répond à la question qu'on se pose vraiment devant un
 * historique — qu'est-ce que CETTE version a changé — en la comparant à
 * celle qui la précède. Les repères A et B restent, pour comparer deux
 * versions quelconques, mais ils ne sont plus le seul chemin.
 */
const VersionItemComponent: FC<VersionItemProps> = ({
  version,
  isSelected,
  isCompareA,
  isCompareB,
  precedente,
  onSelect,
  onCompareSelect,
  onVoirChangements,
  onRestore,
  onExport,
  onDelete,
}) => {
  return (
    <div
      className={`flex flex-col gap-2 p-3 mb-2 rounded-lg border cursor-pointer transition-all duration-200
        bg-[var(--color-surface,#ffffff)] border-[var(--color-border,#e5e7eb)]
        hover:border-[var(--color-primary-300)] hover:shadow-sm
        ${isSelected ? 'border-[var(--color-primary-500)] bg-[var(--color-selected)]' : ''}
        ${isCompareA ? 'border-l-[3px] border-l-emerald-500' : ''}
        ${isCompareB ? 'border-l-[3px] border-l-amber-500' : ''}`}
      onClick={() => onSelect(version)}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 font-semibold text-[var(--color-text-primary)]">
          <span className="text-[var(--color-primary-500)]">
            <ClockIcon />
          </span>
          <span>Version {version.versionNumber}</span>
        </div>
        <div className="text-xs text-[var(--color-text-secondary,#6b7280)]">
          {formatRelativeTime(version.createdAt)}
        </div>
      </div>

      {/* Meta */}
      <div className="flex items-center gap-3 text-sm">
        <span className="text-[var(--color-text-secondary,#6b7280)]">
          {formatBytes(version.size)}
        </span>
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
        {/* Le geste principal, en toutes lettres. Il est absent sur la plus
            ancienne version : il n'y a rien avant elle à quoi la comparer,
            et un bouton qui ne peut rien faire vaut moins que pas de bouton. */}
        {precedente && (
          <button
            className="flex items-center gap-1 h-7 px-2 rounded-md border border-[var(--color-border,#e5e7eb)] bg-[var(--color-surface,#ffffff)] text-[var(--color-text-secondary,#6b7280)] text-xs font-semibold cursor-pointer transition-all duration-200 hover:border-[var(--color-primary-500)] hover:text-[var(--color-primary-500)] hover:bg-[var(--color-selected)]"
            onClick={(e) => {
              e.stopPropagation();
              onVoirChangements(version, precedente);
            }}
            title={`Comparer avec la version ${precedente.versionNumber}`}
          >
            Changements
          </button>
        )}
        <button
          className={`flex items-center justify-center w-7 h-7 rounded-md border text-xs font-semibold cursor-pointer transition-all duration-200
            ${
              isCompareA
                ? 'border-[var(--color-primary-500)] bg-[var(--color-primary-500)] text-[var(--color-text-inverted)]'
                : 'border-[var(--color-border,#e5e7eb)] bg-[var(--color-surface,#ffffff)] text-[var(--color-text-secondary,#6b7280)] hover:border-[var(--color-primary-500)] hover:text-[var(--color-primary-500)] hover:bg-[var(--color-selected)]'
            }`}
          onClick={(e) => {
            e.stopPropagation();
            onCompareSelect(version, 'A');
          }}
          title="Marquer comme première version a comparer (A)"
        >
          A
        </button>
        <button
          className={`flex items-center justify-center w-7 h-7 rounded-md border text-xs font-semibold cursor-pointer transition-all duration-200
            ${
              isCompareB
                ? 'border-[var(--color-primary-500)] bg-[var(--color-primary-500)] text-[var(--color-text-inverted)]'
                : 'border-[var(--color-border,#e5e7eb)] bg-[var(--color-surface,#ffffff)] text-[var(--color-text-secondary,#6b7280)] hover:border-[var(--color-primary-500)] hover:text-[var(--color-primary-500)] hover:bg-[var(--color-selected)]'
            }`}
          onClick={(e) => {
            e.stopPropagation();
            onCompareSelect(version, 'B');
          }}
          title="Marquer comme seconde version a comparer (B)"
        >
          B
        </button>
        <button
          className="flex items-center justify-center w-7 h-7 rounded-md border border-[var(--color-border,#e5e7eb)] bg-[var(--color-surface,#ffffff)] text-[var(--color-text-secondary,#6b7280)] text-xs font-semibold cursor-pointer transition-all duration-200 hover:border-[var(--color-primary-500)] hover:text-[var(--color-primary-500)] hover:bg-[var(--color-selected)]"
          onClick={(e) => {
            e.stopPropagation();
            onRestore(version);
          }}
          title="Restaurer cette version"
        >
          <RestoreIcon />
        </button>
        <button
          className="flex items-center justify-center w-7 h-7 rounded-md border border-[var(--color-border,#e5e7eb)] bg-[var(--color-surface,#ffffff)] text-[var(--color-text-secondary,#6b7280)] text-xs font-semibold cursor-pointer transition-all duration-200 hover:border-[var(--color-primary-500)] hover:text-[var(--color-primary-500)] hover:bg-[var(--color-selected)]"
          onClick={(e) => {
            e.stopPropagation();
            onExport(version);
          }}
          title="Exporter"
        >
          <DownloadIcon />
        </button>
        <button
          className="flex items-center justify-center w-7 h-7 rounded-md border border-[var(--color-border,#e5e7eb)] bg-[var(--color-surface,#ffffff)] text-[var(--color-text-secondary,#6b7280)] text-xs font-semibold cursor-pointer transition-all duration-200 hover:border-[var(--color-error-500)] hover:text-[var(--color-error-500)] hover:bg-[var(--color-error-50)]"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(version);
          }}
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

/**
 * LA COMPARAISON, telle qu'elle se lit.
 *
 * Trois états, et chacun est DIT plutôt que deviné :
 *  — deux textes : les lignes ajoutées et retirées, avec un signe en marge ;
 *  — du binaire ou un contenu absent : le message porté par la comparaison
 *    elle-même, qui explique POURQUOI on ne peut pas comparer — la vue
 *    affichait auparavant deux phrases génériques et jetait ce message ;
 *  — aucun changement : on le dit, au lieu de laisser un panneau vide qui se
 *    lit comme un échec.
 *
 * Le signe en marge n'est pas décoratif : coder l'ajout et la suppression par
 * la seule couleur les rend indistinguables pour qui ne la perçoit pas.
 */
const DiffView: FC<DiffViewProps> = ({ diff, onClose }) => {
  const texte = diff.type === 'text';
  // Les messages que la comparaison porte quand elle ne peut pas comparer.
  const explications = diff.changes.filter((c) => c.type === 'modify');
  const lignes = diff.changes.filter((c) => c.type !== 'modify');

  return (
    <div className="flex-1 flex flex-col border-t border-[var(--color-border,#e5e7eb)] bg-[var(--color-background-elevated)]">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border,#e5e7eb)]">
        <h4 className="m-0 text-sm font-semibold text-[var(--color-text-primary)]">
          Comparaison des versions
        </h4>
        <button
          className="flex items-center justify-center w-6 h-6 border-none bg-transparent rounded-md text-[var(--color-text-secondary,#6b7280)] cursor-pointer transition-all duration-200 hover:bg-[var(--color-hover-overlay)]"
          onClick={onClose}
          aria-label="Fermer la comparaison"
        >
          <CloseIcon />
        </button>
      </div>

      {/* Le décompte dit son UNITÉ : des lignes pour du texte, des octets pour
          du binaire. Le même mot pour les deux laissait lire « 4096 ajouts »
          sur une image, ce qui ne veut rien dire. */}
      <div className="flex gap-4 px-4 py-2 bg-[var(--color-surface,#ffffff)] border-b border-[var(--color-border,#e5e7eb)]">
        <span className="flex items-center gap-1 text-sm font-medium text-emerald-500">
          <PlusIcon />
          {diff.additions} {texte ? (diff.additions > 1 ? 'lignes' : 'ligne') : 'octets'}
        </span>
        <span className="flex items-center gap-1 text-sm font-medium text-red-500">
          <MinusIcon />
          {diff.deletions} {texte ? (diff.deletions > 1 ? 'lignes' : 'ligne') : 'octets'}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {explications.length > 0 && (
          <div className="mb-3 rounded-md border border-[var(--color-border,#e5e7eb)] bg-[var(--color-warning-50)] p-3 text-sm text-[var(--color-text-primary)]">
            {explications.map((c, i) => (
              <p key={i} className="m-0 [&+p]:mt-2">
                <strong>{c.oldContent}</strong>
                {c.newContent ? ` — ${c.newContent}` : ''}
              </p>
            ))}
          </div>
        )}

        {diff.changes.length === 0 ? (
          <p className="text-center p-4 m-0 text-[var(--color-text-secondary,#6b7280)]">
            Ces deux versions ont exactement le même contenu.
          </p>
        ) : (
          <div className="font-mono text-sm">
            {lignes.map((change, index) => (
              <div
                key={index}
                className={`flex p-1 px-2 rounded mb-0.5
                  ${change.type === 'add' ? 'bg-[var(--color-success-50)] text-[var(--color-success-700)]' : ''}
                  ${change.type === 'remove' ? 'bg-[var(--color-error-50)] text-[var(--color-error-700)]' : ''}`}
              >
                <span className="min-w-[40px] text-right pr-2 text-[var(--color-text-tertiary,#9ca3af)] select-none">
                  {change.lineNumber ?? ''}
                </span>
                <span className="w-4 select-none" aria-hidden="true">
                  {change.type === 'add' ? '+' : '\u2212'}
                </span>
                <span className="flex-1 whitespace-pre-wrap break-all">
                  <span className="sr-only">
                    {change.type === 'add' ? 'Ligne ajoutee : ' : 'Ligne supprimee : '}
                  </span>
                  {change.content === '' ? '\u00a0' : change.content}
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
  const versions = useSelector(
    (state: RootState) => (state as any).versions?.byFileId[fileId] ?? []
  );
  const selectedVersionId = useSelector(
    (state: RootState) => (state as any).versions?.selectedVersionId
  );
  const compareVersionIds = useSelector(
    (state: RootState) => (state as any).versions?.compareVersionIds ?? [null, null]
  );
  const currentDiff = useSelector((state: RootState) => (state as any).versions?.currentDiff);
  const loading = useSelector((state: RootState) => (state as any).versions?.loading ?? false);
  const comparing = useSelector((state: RootState) => (state as any).versions?.comparing ?? false);
  const restoring = useSelector((state: RootState) => (state as any).versions?.restoring ?? false);

  // Local state
  const [confirmRestoreVersion, setConfirmRestoreVersion] = useState<FileVersion | null>(null);
  const [confirmDeleteVersion, setConfirmDeleteVersion] = useState<FileVersion | null>(null);

  // Charger les versions au montage
  useEffect(() => {
    dispatch(fetchVersions(fileId));
  }, [dispatch, fileId]);

  // Handlers
  const handleSelectVersion = useCallback(
    (version: FileVersion) => {
      dispatch(selectVersion(version.id));
    },
    [dispatch]
  );

  const handleCompareSelect = useCallback(
    (version: FileVersion, slot: 'A' | 'B') => {
      const newCompareIds: [string | null, string | null] = [...compareVersionIds] as [
        string | null,
        string | null,
      ];

      if (slot === 'A') {
        newCompareIds[0] = newCompareIds[0] === version.id ? null : version.id;
      } else {
        newCompareIds[1] = newCompareIds[1] === version.id ? null : version.id;
      }

      dispatch(setCompareVersions(newCompareIds));

      // Lancer la comparaison si les deux slots sont remplis
      if (newCompareIds[0] && newCompareIds[1]) {
        dispatch(
          compareVersions({
            versionIdA: newCompareIds[0],
            versionIdB: newCompareIds[1],
          })
        );
      }
    },
    [dispatch, compareVersionIds]
  );

  /**
   * « Voir les changements » — comparer une version à celle qui la précède.
   *
   * Les deux repères A et B sont posés au passage : la comparaison affichée
   * doit se lire dans la liste, sinon on ne sait plus ce qu'on regarde.
   * A = la plus ancienne, B = celle sur laquelle on a cliqué — dans cet
   * ordre, la différence se lit comme « ce que cette version a apporté ».
   */
  const handleVoirChangements = useCallback(
    (version: FileVersion, precedente: FileVersion) => {
      dispatch(setCompareVersions([precedente.id, version.id]));
      dispatch(compareVersions({ versionIdA: precedente.id, versionIdB: version.id }));
    },
    [dispatch]
  );

  const handleRestore = useCallback((version: FileVersion) => {
    setConfirmRestoreVersion(version);
  }, []);

  const confirmRestore = useCallback(async () => {
    if (!confirmRestoreVersion) return;

    try {
      await dispatch(
        restoreVersion({
          versionId: confirmRestoreVersion.id,
          fileId,
        })
      ).unwrap();

      success(`Version ${confirmRestoreVersion.versionNumber} restauree avec succes`);
      setConfirmRestoreVersion(null);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : 'Unknown error';
      notifyError(`Erreur lors de la restauration: ${errMsg}`);
    }
  }, [dispatch, confirmRestoreVersion, fileId, success, notifyError]);

  const handleExport = useCallback(
    async (version: FileVersion) => {
      try {
        await dispatch(exportVersion({ versionId: version.id })).unwrap();
        success(`Version ${version.versionNumber} exportee`);
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : 'Unknown error';
        notifyError(`Erreur lors de l'export: ${errMsg}`);
      }
    },
    [dispatch, success, notifyError]
  );

  const handleDelete = useCallback((version: FileVersion) => {
    setConfirmDeleteVersion(version);
  }, []);

  const confirmDelete = useCallback(async () => {
    if (!confirmDeleteVersion) return;

    try {
      await dispatch(
        deleteVersion({
          fileId,
          versionId: confirmDeleteVersion.id,
        })
      ).unwrap();

      success(`Version ${confirmDeleteVersion.versionNumber} supprimee`);
      setConfirmDeleteVersion(null);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : 'Unknown error';
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
      await dispatch(
        createVersion({
          folderId,
          fileId,
          fileName,
          comment: 'Version manuelle',
          size: fileSize || 0,
          force: true,
        })
      ).unwrap();
      success('Nouvelle version creee');
      // Refresh the list
      dispatch(fetchVersions(fileId));
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : 'Unknown error';
      notifyError(`Erreur lors de la creation: ${errMsg || 'Erreur inconnue'}`);
    } finally {
      setCreatingVersion(false);
    }
  }, [dispatch, folderId, fileId, fileName, fileSize, success, notifyError]);

  return (
    <div
      className={`flex flex-col w-full h-full bg-[var(--color-surface,#ffffff)] rounded-xl overflow-hidden ${className || ''}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border,#e5e7eb)] bg-[var(--color-background-elevated)]">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="text-[var(--color-primary-500)] flex-shrink-0">
            <ClockIcon />
          </span>
          <div className="min-w-0">
            <h3 className="m-0 text-sm font-semibold text-[var(--color-text-primary)] leading-tight">
              Historique des versions
            </h3>
            <span className="block text-xs text-[var(--color-text-secondary,#6b7280)] truncate max-w-[300px]">
              {fileName}
            </span>
          </div>
        </div>
        <button
          className="flex items-center justify-center w-7 h-7 flex-shrink-0 border-none bg-transparent rounded-md text-[var(--color-text-secondary,#6b7280)] cursor-pointer transition-colors duration-150 hover:bg-[var(--color-hover-overlay)] hover:text-[var(--color-text-primary)]"
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
            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-[var(--color-primary-600)] bg-[var(--color-selected)] border border-[var(--color-selected-border)] rounded-md cursor-pointer transition-colors duration-150 hover:bg-[var(--color-selected-hover)] hover:border-[var(--color-primary-300)] disabled:opacity-50 disabled:cursor-not-allowed"
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
              <p className="mt-3 text-sm text-[var(--color-text-secondary,#6b7280)]">
                Chargement des versions...
              </p>
            </div>
          ) : versions.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-8 text-center">
              <span className="text-[var(--color-text-tertiary,#9ca3af)] mb-3">
                <svg
                  width="40"
                  height="40"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                >
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
              </span>
              <p className="m-0 text-sm text-[var(--color-text-secondary,#6b7280)]">
                Aucune version disponible
              </p>
              <span className="mt-1 text-xs text-[var(--color-text-tertiary,#9ca3af)]">
                Cliquez sur "Nouvelle version" pour creer un point de sauvegarde.
              </span>
            </div>
          ) : (
            <>
              {!folderId && (
                <div className="flex items-center justify-between px-2 py-2 mb-2 text-xs text-[var(--color-text-secondary,#6b7280)]">
                  <span>
                    {versions.length} version{versions.length !== 1 ? 's' : ''}
                  </span>
                </div>
              )}

              {(compareVersionIds[0] || compareVersionIds[1]) && (
                <div className="flex items-center justify-end px-2 pb-2">
                  <button
                    className="px-2 py-1 text-xs text-[var(--color-primary-500)] bg-transparent border border-[var(--color-primary-300)] rounded cursor-pointer transition-colors duration-150 hover:bg-[var(--color-selected)]"
                    onClick={() => dispatch(setCompareVersions([null, null]))}
                  >
                    Effacer la selection
                  </button>
                </div>
              )}

              {/* La liste va de la plus récente à la plus ancienne : la version
                  qui PRÉCÈDE celle-ci est donc la suivante dans le tableau. */}
              {versions.map((version: FileVersion, index: number) => (
                <VersionItemComponent
                  key={version.id}
                  version={version}
                  isSelected={selectedVersionId === version.id}
                  isCompareA={compareVersionIds[0] === version.id}
                  isCompareB={compareVersionIds[1] === version.id}
                  precedente={versions[index + 1] ?? null}
                  onSelect={handleSelectVersion}
                  onCompareSelect={handleCompareSelect}
                  onVoirChangements={handleVoirChangements}
                  onRestore={handleRestore}
                  onExport={handleExport}
                  onDelete={handleDelete}
                />
              ))}
            </>
          )}
        </div>

        {/* Diff view */}
        {currentDiff && <DiffView diff={currentDiff} onClose={handleCloseDiff} />}

        {/* Comparing loader */}
        {comparing && (
          <div className="flex flex-col items-center justify-center p-8 text-center">
            <ProgressBar value={50} max={100} variant="primary" />
            <p className="mt-3 text-[var(--color-text-secondary,#6b7280)]">
              Comparaison en cours...
            </p>
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
          <p className="mt-2 px-3 py-2 bg-[var(--color-warning-50)] rounded-md text-[var(--color-warning-700)] text-sm">
            La version actuelle sera sauvegardee avant la restauration.
          </p>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setConfirmRestoreVersion(null)}>
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
          <p className="mt-2 px-3 py-2 bg-[var(--color-error-50)] rounded-md text-[var(--color-error-700)] text-sm">
            Cette action est irreversible.
          </p>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setConfirmDeleteVersion(null)}>
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
