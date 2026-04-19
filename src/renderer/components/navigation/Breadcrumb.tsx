/**
 * Composant Breadcrumb
 *
 * Affiche le chemin de navigation du dossier courant avec segments cliquables.
 * Collapse les chemins profonds (>5 niveaux) avec "..." au milieu.
 */

import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { selectFolderPathById } from '../../../store/selectors/folderSelectors';
import type { RootState } from '../../../store';
import type { Folder } from '../../../types';

interface BreadcrumbProps {
  folderId: string;
  className?: string;
}

const ChevronIcon: React.FC = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5 shrink-0">
    <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
  </svg>
);

const MAX_VISIBLE = 5;

export const Breadcrumb: React.FC<BreadcrumbProps> = ({ folderId, className }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState(false);

  const folderPath = useSelector((state: RootState) =>
    folderId ? selectFolderPathById(folderId)(state) : []
  );

  const segments = useMemo((): Array<{ type: 'folder'; folder: Folder } | { type: 'ellipsis' }> => {
    if (folderPath.length <= MAX_VISIBLE || expanded) {
      return folderPath.map(f => ({ type: 'folder' as const, folder: f }));
    }

    // Collapse: first 2, ..., last 2
    const first = folderPath.slice(0, 2).map(f => ({ type: 'folder' as const, folder: f }));
    const last = folderPath.slice(-2).map(f => ({ type: 'folder' as const, folder: f }));
    return [...first, { type: 'ellipsis' as const }, ...last];
  }, [folderPath, expanded]);

  if (folderPath.length === 0) return null;

  return (
    <nav className={`flex items-center gap-1 min-w-0 text-sm ${className || ''}`}>
      <button
        onClick={() => navigate('/')}
        className="shrink-0 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] transition-colors"
      >
        {t('sidebar.home')}
      </button>

      {segments.map((segment, index) => {
        if (segment.type === 'ellipsis') {
          return (
            <React.Fragment key="ellipsis">
              <ChevronIcon />
              <button
                onClick={() => setExpanded(true)}
                className="shrink-0 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] transition-colors px-1"
                title="Afficher le chemin complet"
              >
                ...
              </button>
            </React.Fragment>
          );
        }

        const isLast = index === segments.length - 1;
        return (
          <React.Fragment key={segment.folder.id}>
            <ChevronIcon />
            {isLast ? (
              <span className="font-semibold text-[var(--color-text-primary)] truncate max-w-[200px]">
                {segment.folder.name}
              </span>
            ) : (
              <button
                onClick={() => navigate(`/folder/${segment.folder.id}`)}
                className="shrink-0 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] transition-colors truncate max-w-[150px]"
              >
                {segment.folder.name}
              </button>
            )}
          </React.Fragment>
        );
      })}
    </nav>
  );
};

export default Breadcrumb;
