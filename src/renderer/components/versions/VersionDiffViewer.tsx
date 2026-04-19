/**
 * VersionDiffViewer Component
 *
 * Displays a comparison between two versions of a file.
 * Shows additions, deletions, and modifications with line-by-line diff.
 */

import React, { FC, useMemo } from 'react';
import clsx from 'clsx';
import type { VersionDiff, DiffChange } from '../../../services/core/versionService';
import './VersionDiffViewer.css';

// ==================== TYPES ====================

export interface VersionDiffViewerProps {
  /** The diff data to display */
  diff: VersionDiff;
  /** Callback when the diff viewer should be closed */
  onClose?: () => void;
  /** Additional CSS class */
  className?: string;
  /** Whether to show line numbers */
  showLineNumbers?: boolean;
  /** Whether to show the header */
  showHeader?: boolean;
  /** Optional title for the comparison */
  title?: string;
}

// ==================== ICONS ====================

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

const ChangeIcon: FC = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M12 5v14M5 12h14" />
  </svg>
);

const FileIcon: FC = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
  </svg>
);

// ==================== SUB-COMPONENTS ====================

interface DiffLineProps {
  change: DiffChange;
  showLineNumber: boolean;
}

const DiffLine: FC<DiffLineProps> = ({ change, showLineNumber }) => {
  const lineClasses = clsx('diff-viewer__line', {
    'diff-viewer__line--add': change.type === 'add',
    'diff-viewer__line--remove': change.type === 'remove',
    'diff-viewer__line--modify': change.type === 'modify',
  });

  const prefixIcon = useMemo(() => {
    switch (change.type) {
      case 'add':
        return <PlusIcon />;
      case 'remove':
        return <MinusIcon />;
      case 'modify':
        return <ChangeIcon />;
      default:
        return null;
    }
  }, [change.type]);

  return (
    <div className={lineClasses}>
      {showLineNumber && change.lineNumber && (
        <span className="diff-viewer__line-number">{change.lineNumber}</span>
      )}
      <span className="diff-viewer__line-prefix">{prefixIcon}</span>
      <span className="diff-viewer__line-content">
        {change.type === 'modify' ? (
          <>
            <span className="diff-viewer__old-content">{change.oldContent}</span>
            <span className="diff-viewer__arrow">&rarr;</span>
            <span className="diff-viewer__new-content">{change.newContent}</span>
          </>
        ) : (
          change.content
        )}
      </span>
    </div>
  );
};

interface DiffStatsProps {
  additions: number;
  deletions: number;
  modifications?: number;
}

const DiffStats: FC<DiffStatsProps> = ({ additions, deletions, modifications = 0 }) => {
  return (
    <div className="diff-viewer__stats">
      <span className="diff-viewer__stat diff-viewer__stat--add">
        <PlusIcon />
        <span>{additions} ajout{additions !== 1 ? 's' : ''}</span>
      </span>
      <span className="diff-viewer__stat diff-viewer__stat--remove">
        <MinusIcon />
        <span>{deletions} suppression{deletions !== 1 ? 's' : ''}</span>
      </span>
      {modifications > 0 && (
        <span className="diff-viewer__stat diff-viewer__stat--modify">
          <ChangeIcon />
          <span>{modifications} modification{modifications !== 1 ? 's' : ''}</span>
        </span>
      )}
    </div>
  );
};

// ==================== MAIN COMPONENT ====================

export const VersionDiffViewer: FC<VersionDiffViewerProps> = ({
  diff,
  onClose,
  className,
  showLineNumbers = true,
  showHeader = true,
  title = 'Comparaison des versions',
}) => {
  // Calculate modification count from changes
  const modifications = useMemo(() => {
    return diff.changes.filter((c) => c.type === 'modify').length;
  }, [diff.changes]);

  const viewerClasses = clsx('diff-viewer', className);

  return (
    <div className={viewerClasses}>
      {showHeader && (
        <div className="diff-viewer__header">
          <div className="diff-viewer__title">
            <FileIcon />
            <h4>{title}</h4>
          </div>
          {onClose && (
            <button
              className="diff-viewer__close"
              onClick={onClose}
              aria-label="Fermer"
            >
              <CloseIcon />
            </button>
          )}
        </div>
      )}

      <DiffStats
        additions={diff.additions}
        deletions={diff.deletions}
        modifications={modifications}
      />

      <div className="diff-viewer__content">
        {diff.type === 'binary' ? (
          <div className="diff-viewer__binary">
            <FileIcon />
            <p>Les fichiers binaires ne peuvent pas etre compares en detail.</p>
            <p className="diff-viewer__binary-hint">
              Differences detectees entre les deux versions.
            </p>
          </div>
        ) : diff.changes.length === 0 ? (
          <div className="diff-viewer__empty">
            <p>Aucune difference detectee entre les versions.</p>
          </div>
        ) : (
          <div className="diff-viewer__lines">
            {diff.changes.map((change, index) => (
              <DiffLine
                key={index}
                change={change}
                showLineNumber={showLineNumbers}
              />
            ))}
          </div>
        )}
      </div>

      <div className="diff-viewer__footer">
        <span className="diff-viewer__version-info">
          Version A: {diff.versionA}
        </span>
        <span className="diff-viewer__vs">vs</span>
        <span className="diff-viewer__version-info">
          Version B: {diff.versionB}
        </span>
      </div>
    </div>
  );
};

export default VersionDiffViewer;
