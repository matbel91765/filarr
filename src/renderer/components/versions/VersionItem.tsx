/**
 * VersionItem Component
 *
 * Individual version row component for the version history panel.
 * Shows version metadata and action buttons.
 */

import React, { FC, memo } from 'react';
import clsx from 'clsx';
import type { FileVersion } from '../../../services/core/versionService';
import './VersionItem.css';

// ==================== TYPES ====================

export interface VersionItemProps {
  /** The version data */
  version: FileVersion;
  /** Whether this version is currently selected */
  isSelected?: boolean;
  /** Whether this version is selected for comparison slot A */
  isCompareA?: boolean;
  /** Whether this version is selected for comparison slot B */
  isCompareB?: boolean;
  /** Callback when the version is clicked */
  onSelect?: (version: FileVersion) => void;
  /** Callback when compare slot is clicked */
  onCompareSelect?: (version: FileVersion, slot: 'A' | 'B') => void;
  /** Callback when restore is clicked */
  onRestore?: (version: FileVersion) => void;
  /** Callback when export is clicked */
  onExport?: (version: FileVersion) => void;
  /** Callback when delete is clicked */
  onDelete?: (version: FileVersion) => void;
  /** Additional CSS class */
  className?: string;
  /** Whether actions are disabled */
  disabled?: boolean;
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

// ==================== HELPER FUNCTIONS ====================

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

  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
};

const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

// ==================== COMPONENT ====================

export const VersionItem: FC<VersionItemProps> = memo(({
  version,
  isSelected = false,
  isCompareA = false,
  isCompareB = false,
  onSelect,
  onCompareSelect,
  onRestore,
  onExport,
  onDelete,
  className,
  disabled = false,
}) => {
  const itemClasses = clsx(
    'version-item',
    {
      'version-item--selected': isSelected,
      'version-item--compare-a': isCompareA,
      'version-item--compare-b': isCompareB,
      'version-item--disabled': disabled,
    },
    className
  );

  const handleClick = () => {
    if (!disabled && onSelect) {
      onSelect(version);
    }
  };

  const handleCompareClick = (slot: 'A' | 'B') => (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!disabled && onCompareSelect) {
      onCompareSelect(version, slot);
    }
  };

  /**
   * Sans octets conserves, il n'y a rien a restaurer NI a exporter.
   *
   * Le bouton est desactive plutot que masque : une action qui disparait sans
   * explication laisse croire a un bug, alors qu'un bouton grise avec son
   * info-bulle DIT pourquoi. C'est le garde-fou qui empeche le retour du
   * defaut d'origine — un « Restaurer » qui annoncait sa reussite sans avoir
   * jamais reecrit un octet.
   */
  const contenuIndisponible = version.contentAvailable !== true;

  const handleRestoreClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!disabled && !contenuIndisponible && onRestore) {
      onRestore(version);
    }
  };

  const handleExportClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!disabled && !contenuIndisponible && onExport) {
      onExport(version);
    }
  };

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!disabled && onDelete) {
      onDelete(version);
    }
  };

  return (
    <div
      className={itemClasses}
      onClick={handleClick}
      role="button"
      tabIndex={disabled ? -1 : 0}
      onKeyPress={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          handleClick();
        }
      }}
    >
      {/* Header */}
      <div className="version-item__header">
        <div className="version-item__number">
          <ClockIcon />
          <span>Version {version.versionNumber}</span>
        </div>
        <div className="version-item__time">
          {formatRelativeTime(version.createdAt)}
        </div>
      </div>

      {/* Metadata */}
      <div className="version-item__meta">
        <span className="version-item__size">{formatBytes(version.size)}</span>
        {version.createdBy && (
          <span className="version-item__author">par {version.createdBy}</span>
        )}
        {version.comment && (
          <span className="version-item__comment" title={version.comment}>
            {version.comment}
          </span>
        )}
      </div>

      {/* Actions */}
      <div className="version-item__actions">
        <button
          className={clsx('version-item__action version-item__action--compare', {
            'version-item__action--active': isCompareA,
          })}
          onClick={handleCompareClick('A')}
          disabled={disabled}
          title="Selectionner pour comparaison (A)"
          aria-label="Comparer version A"
        >
          A
        </button>
        <button
          className={clsx('version-item__action version-item__action--compare', {
            'version-item__action--active': isCompareB,
          })}
          onClick={handleCompareClick('B')}
          disabled={disabled}
          title="Selectionner pour comparaison (B)"
          aria-label="Comparer version B"
        >
          B
        </button>
        <button
          className="version-item__action"
          onClick={handleRestoreClick}
          disabled={disabled || contenuIndisponible}
          title={
            contenuIndisponible
              ? "Le contenu de cette version n'a pas ete conserve : restauration impossible"
              : 'Restaurer cette version'
          }
          aria-label="Restaurer"
        >
          <RestoreIcon />
        </button>
        <button
          className="version-item__action"
          onClick={handleExportClick}
          disabled={disabled || contenuIndisponible}
          title={
            contenuIndisponible
              ? "Le contenu de cette version n'a pas ete conserve : export impossible"
              : 'Exporter cette version'
          }
          aria-label="Exporter"
        >
          <DownloadIcon />
        </button>
        <button
          className="version-item__action version-item__action--danger"
          onClick={handleDeleteClick}
          disabled={disabled}
          title="Supprimer cette version"
          aria-label="Supprimer"
        >
          <TrashIcon />
        </button>
      </div>

      {/* Compare Indicators */}
      {(isCompareA || isCompareB) && (
        <div className="version-item__indicator">
          {isCompareA && <span className="version-item__indicator-a">A</span>}
          {isCompareB && <span className="version-item__indicator-b">B</span>}
        </div>
      )}
    </div>
  );
});

VersionItem.displayName = 'VersionItem';

export default VersionItem;
