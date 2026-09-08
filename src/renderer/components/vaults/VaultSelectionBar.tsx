/**
 * VaultSelectionBar — la barre d'actions d'une SÉLECTION dans l'explorateur de
 * coffre, sur le patron de `BatchActionToolbar` (l'explorateur personnel) :
 * flottante, collée en bas, présente seulement quand quelque chose est coché.
 *
 * Ce qu'elle ne décide PAS : quelles actions existent. C'est l'hôte qui pose
 * (ou non) chaque gestionnaire, selon la matrice de droits du coffre — une
 * action absente est RETIRÉE, pas grisée, comme dans les menus contextuels :
 * un bouton grisé invite à chercher pourquoi, un bouton absent dit que ce rôle
 * consulte. Seule exception : pendant un lot en vol (téléchargement,
 * duplication, suppression), tout est gelé et la progression est dite.
 *
 * DEUX RANGS D'ACTIONS. Les gestes de LOT (déplacer, dupliquer, télécharger,
 * partager, supprimer) portent sur toute la sélection. Les gestes UNITAIRES
 * (ouvrir, renommer, détails, historique, lien public, gérer l'accès) n'ont de
 * sens que pour UN élément : l'hôte ne les pose que dans ce cas, avec les
 * MÊMES gestionnaires que le menu contextuel — jamais une seconde logique.
 *
 * Briques du design system uniquement (`Button`), jetons de couleur du thème :
 * la barre de l'explorateur perso est peinte en dur sur un gris sombre, ce qui
 * la rend illisible sur les thèmes clairs — on ne reproduit pas ce défaut.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui';
import {
  DownloadIcon,
  MoveIcon,
  CopyIcon,
  DeleteIcon,
  PersonShareIcon,
  FolderOpenIcon,
  EditIcon,
  InfoIcon,
  HistoryIcon,
  ShareIcon,
  PeopleIcon,
} from '../files/itemContextMenu';

export interface VaultSelectionBarProps {
  selectedCount: number;
  /** Tout ce qui est à l'écran (dossiers + fichiers) — pour « Tout sélectionner ». */
  totalCount: number;
  /** Combien de DOSSIERS sont cochés — le téléchargement et la duplication les excluent, et le disent. */
  folderCount: number;
  /** Un lot en vol : la barre se gèle et montre où il en est. */
  progress?: { done: number; total: number; label: string } | null;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  // — Gestes UNITAIRES (un seul élément coché) — mêmes gestionnaires que le menu.
  onOpen?: () => void;
  onRename?: () => void;
  onDetails?: () => void;
  onVersions?: () => void;
  /** Le lien public (partage E2EE par lien) — un fichier, nuage seulement. */
  onShareLink?: () => void;
  /** « Gérer l'accès » — le dialogue unifié, tout membre, nuage seulement. */
  onManageAccess?: () => void;
  // — Gestes de LOT.
  onMove?: () => void;
  /** « Dupliquer ici » — fichiers seulement (re-chiffrement, quota). */
  onCopy?: () => void;
  onDownload?: () => void;
  onShareWithPerson?: () => void;
  onDelete?: () => void;
}

export const VaultSelectionBar: React.FC<VaultSelectionBarProps> = ({
  selectedCount,
  totalCount,
  folderCount,
  progress,
  onSelectAll,
  onDeselectAll,
  onOpen,
  onRename,
  onDetails,
  onVersions,
  onShareLink,
  onManageAccess,
  onMove,
  onCopy,
  onDownload,
  onShareWithPerson,
  onDelete,
}) => {
  const { t } = useTranslation();
  if (selectedCount === 0) return null;
  const busy = !!progress;
  const allSelected = selectedCount >= totalCount;
  const hasUnit = !!(
    onOpen ||
    onRename ||
    onDetails ||
    onVersions ||
    onShareLink ||
    onManageAccess
  );
  const hasBatch = !!(onMove || onCopy || onDownload || onShareWithPerson);
  const foldersExcludedTitle =
    folderCount > 0
      ? t('teamVaults.selection.downloadFoldersExcluded', {
          count: folderCount,
          defaultValue: 'Folders are not downloaded ({{count}} excluded)',
        })
      : undefined;

  return (
    <div
      role="toolbar"
      aria-label={t('teamVaults.selection.toolbar', 'Selection actions')}
      // Hors lasso : un mousedown entre deux boutons ne doit pas vider la
      // sélection que la barre est justement en train de servir.
      data-no-rubber-band
      className="sticky bottom-4 mx-auto w-fit max-w-full z-40 flex items-center gap-1 flex-wrap px-3 py-2 rounded-xl
        bg-[var(--color-surface)] border border-[var(--color-border)] shadow-2xl"
    >
      <span className="text-sm font-medium pr-2 mr-1 border-r border-[var(--color-border)] text-[var(--color-text-primary)] whitespace-nowrap">
        {t('teamVaults.selection.count', {
          count: selectedCount,
          defaultValue: '{{count}} selected',
        })}
      </span>

      {progress ? (
        <span
          className="text-xs text-[var(--color-text-secondary)] whitespace-nowrap px-2"
          aria-live="polite"
        >
          {progress.label} {progress.done}/{progress.total}
        </span>
      ) : (
        <Button variant="ghost" size="sm" onClick={allSelected ? onDeselectAll : onSelectAll}>
          {allSelected
            ? t('teamVaults.selection.deselectAll', 'Deselect all')
            : t('teamVaults.selection.selectAll', 'Select all')}
        </Button>
      )}

      {/* ── Les gestes UNITAIRES — posés par l'hôte pour UN élément seulement ── */}
      {hasUnit && <div className="w-px h-5 bg-[var(--color-border)] mx-1" aria-hidden="true" />}
      {onOpen && (
        <Button
          variant="ghost"
          size="sm"
          leftIcon={<FolderOpenIcon />}
          disabled={busy}
          onClick={onOpen}
        >
          {t('contextMenu.open', 'Open')}
        </Button>
      )}
      {onRename && (
        <Button
          variant="ghost"
          size="sm"
          leftIcon={<EditIcon />}
          disabled={busy}
          onClick={onRename}
        >
          {t('contextMenu.rename', 'Rename')}
        </Button>
      )}
      {onDetails && (
        <Button
          variant="ghost"
          size="sm"
          leftIcon={<InfoIcon />}
          disabled={busy}
          onClick={onDetails}
        >
          {t('teamVaults.selection.details', 'Details')}
        </Button>
      )}
      {onVersions && (
        <Button
          variant="ghost"
          size="sm"
          leftIcon={<HistoryIcon />}
          disabled={busy}
          onClick={onVersions}
        >
          {t('teamVaults.selection.versions', 'History')}
        </Button>
      )}
      {onManageAccess && (
        <Button
          variant="ghost"
          size="sm"
          leftIcon={<PeopleIcon />}
          disabled={busy}
          onClick={onManageAccess}
        >
          {t('contextMenu.manageAccess', 'Manage access')}
        </Button>
      )}
      {onShareLink && (
        <Button
          variant="ghost"
          size="sm"
          leftIcon={<ShareIcon />}
          disabled={busy}
          onClick={onShareLink}
        >
          {t('teamVaults.selection.shareLink', 'Public link…')}
        </Button>
      )}

      {/* ── Les gestes de LOT ── */}
      {hasBatch && <div className="w-px h-5 bg-[var(--color-border)] mx-1" aria-hidden="true" />}
      {onMove && (
        <Button variant="ghost" size="sm" leftIcon={<MoveIcon />} disabled={busy} onClick={onMove}>
          {t('teamVaults.selection.move', 'Move')}
        </Button>
      )}
      {onCopy && (
        <Button
          variant="ghost"
          size="sm"
          leftIcon={<CopyIcon />}
          disabled={busy}
          onClick={onCopy}
          title={
            folderCount > 0
              ? t('teamVaults.selection.duplicateFoldersExcluded', {
                  count: folderCount,
                  defaultValue: 'Folders are not duplicated ({{count}} excluded)',
                })
              : t(
                  'teamVaults.selection.duplicateHint',
                  'Creates a re-encrypted copy in this folder (counts toward the quota)'
                )
          }
        >
          {t('teamVaults.selection.duplicate', 'Duplicate here')}
        </Button>
      )}
      {onDownload && (
        <Button
          variant="ghost"
          size="sm"
          leftIcon={<DownloadIcon />}
          disabled={busy}
          onClick={onDownload}
          title={foldersExcludedTitle}
        >
          {t('teamVaults.selection.download', 'Download')}
        </Button>
      )}
      {onShareWithPerson && (
        <Button
          variant="ghost"
          size="sm"
          leftIcon={<PersonShareIcon />}
          disabled={busy}
          onClick={onShareWithPerson}
        >
          {t('teamVaults.selection.shareWithPerson', 'Share with a person…')}
        </Button>
      )}

      {onDelete && (
        <>
          <div className="w-px h-5 bg-[var(--color-border)] mx-1" aria-hidden="true" />
          <Button
            variant="danger"
            size="sm"
            leftIcon={<DeleteIcon />}
            disabled={busy}
            onClick={onDelete}
          >
            {t('teamVaults.selection.delete', 'Delete')}
          </Button>
        </>
      )}

      <div className="w-px h-5 bg-[var(--color-border)] mx-1" aria-hidden="true" />
      <Button variant="ghost" size="sm" disabled={busy} onClick={onDeselectAll}>
        {t('teamVaults.selection.clear', 'Clear')}
      </Button>
    </div>
  );
};

export default VaultSelectionBar;
