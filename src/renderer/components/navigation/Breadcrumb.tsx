/**
 * Composant Breadcrumb
 *
 * Affiche le chemin de navigation du dossier courant avec segments cliquables.
 * Collapse les chemins profonds (>5 niveaux) avec "..." au milieu.
 * Chaque segment est aussi une cible de dépôt : on y dépose l'élément traîné
 * pour le remonter d'un ou plusieurs niveaux, ou on s'y attarde pour naviguer.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState, DragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import {
  FILARR_FILE_MIME,
  FILARR_FOLDER_MIME,
  SPRING_LOAD_DELAY_MS,
} from '../../../hooks/useDragAndDrop';
import { SpringDwellRing } from '../ui/SpringDwellRing';
import { selectFolderPathById } from '../../../store/selectors/folderSelectors';
import type { RootState } from '../../../store';
import type { Folder } from '../../../types';

interface BreadcrumbProps {
  folderId: string;
  className?: string;
  /** Dépôt sur un segment ancêtre — le parent effectue le déplacement */
  onDropOnSegment?: (folderId: string, e: DragEvent) => void;
  /** Dépôt sur « Accueil » — remonte à la racine (dossiers uniquement) */
  onDropOnRoot?: (e: DragEvent) => void;
}

const ChevronIcon: React.FC = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 20 20"
    fill="currentColor"
    className="w-3.5 h-3.5 shrink-0"
  >
    <path
      fillRule="evenodd"
      d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z"
      clipRule="evenodd"
    />
  </svg>
);

const MAX_VISIBLE = 5;

/** Identifiant interne du segment racine dans l'état de survol */
const ROOT_SEGMENT = '__root__';

type SegmentDragHandlers = Partial<
  Pick<
    React.DOMAttributes<HTMLButtonElement>,
    'onDragEnter' | 'onDragOver' | 'onDragLeave' | 'onDrop'
  >
>;

export const Breadcrumb: React.FC<BreadcrumbProps> = ({
  folderId,
  className,
  onDropOnSegment,
  onDropOnRoot,
}) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState(false);
  const [hoveredSegment, setHoveredSegment] = useState<string | null>(null);

  const folderPath = useSelector((state: RootState) =>
    folderId ? selectFolderPathById(folderId)(state) : []
  );

  const droppable = Boolean(onDropOnSegment || onDropOnRoot);

  // Attente avant navigation : s'attarder sur un segment l'ouvre sans lâcher
  // l'élément traîné, ce qui permet de composer un déplacement en plusieurs pas.
  const dwellRef = useRef<{ key: string; timer: ReturnType<typeof setTimeout> } | null>(null);

  const cancelDwell = useCallback(() => {
    if (dwellRef.current) {
      clearTimeout(dwellRef.current.timer);
      dwellRef.current = null;
    }
    setHoveredSegment(null);
  }, []);

  useEffect(() => cancelDwell, [cancelDwell]);

  const scheduleDwell = useCallback(
    (key: string, target: string | null) => {
      if (dwellRef.current?.key === key) return;
      cancelDwell();
      const timer = setTimeout(() => {
        dwellRef.current = null;
        setHoveredSegment(null);
        navigate(target ? `/folder/${target}` : '/');
      }, SPRING_LOAD_DELAY_MS);
      dwellRef.current = { key, timer };
      setHoveredSegment(key);
    },
    [cancelDwell, navigate]
  );

  /**
   * La racine n'accueille que des dossiers : un fichier doit vivre dans un
   * dossier. Le type du contenu est lisible dès `dragover` via le marqueur
   * dédié, le payload complet ne l'étant pas.
   */
  const acceptsDrag = useCallback((e: DragEvent, rootSegment: boolean): boolean => {
    if (!e.dataTransfer.types.includes(FILARR_FILE_MIME)) return false;
    return rootSegment ? e.dataTransfer.types.includes(FILARR_FOLDER_MIME) : true;
  }, []);

  const dragHandlers = useCallback(
    (key: string, target: string | null): SegmentDragHandlers => {
      if (!droppable) return {};
      const isRoot = target === null;
      if (isRoot && !onDropOnRoot) return {};
      if (!isRoot && !onDropOnSegment) return {};

      return {
        onDragEnter: (e: DragEvent) => {
          if (!acceptsDrag(e, isRoot)) return;
          e.preventDefault();
          e.stopPropagation();
          scheduleDwell(key, target);
        },
        onDragOver: (e: DragEvent) => {
          if (!acceptsDrag(e, isRoot)) return;
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = 'move';
        },
        onDragLeave: (e: DragEvent) => {
          if (e.currentTarget !== e.target) return;
          cancelDwell();
        },
        onDrop: (e: DragEvent) => {
          if (!acceptsDrag(e, isRoot)) return;
          cancelDwell();
          if (isRoot) onDropOnRoot?.(e);
          else onDropOnSegment?.(target as string, e);
        },
      };
    },
    [droppable, onDropOnRoot, onDropOnSegment, acceptsDrag, scheduleDwell, cancelDwell]
  );

  const segments = useMemo((): Array<{ type: 'folder'; folder: Folder } | { type: 'ellipsis' }> => {
    if (folderPath.length <= MAX_VISIBLE || expanded) {
      return folderPath.map((f) => ({ type: 'folder' as const, folder: f }));
    }

    // Collapse: first 2, ..., last 2
    const first = folderPath.slice(0, 2).map((f) => ({ type: 'folder' as const, folder: f }));
    const last = folderPath.slice(-2).map((f) => ({ type: 'folder' as const, folder: f }));
    return [...first, { type: 'ellipsis' as const }, ...last];
  }, [folderPath, expanded]);

  if (folderPath.length === 0) return null;

  // `relative` : l'anneau d'attente se pose en surimpression sur le segment.
  // Le clignotement d'antan ne disait pas combien de temps il restait à tenir.
  const dropHighlight = 'relative ring-2 ring-[var(--color-primary-400)] rounded';

  return (
    <nav className={`flex items-center gap-1 min-w-0 text-sm ${className || ''}`}>
      <button
        onClick={() => navigate('/')}
        {...dragHandlers(ROOT_SEGMENT, null)}
        className={`shrink-0 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] transition-colors px-1
          ${hoveredSegment === ROOT_SEGMENT ? dropHighlight : ''}`}
      >
        {t('sidebar.home')}
        {hoveredSegment === ROOT_SEGMENT && <SpringDwellRing />}
      </button>

      {segments.map((segment, index) => {
        if (segment.type === 'ellipsis') {
          return (
            <React.Fragment key="ellipsis">
              <ChevronIcon />
              <button
                onClick={() => setExpanded(true)}
                className="shrink-0 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] transition-colors px-1"
                title={t('breadcrumb.showFullPath')}
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
                {...dragHandlers(segment.folder.id, segment.folder.id)}
                className={`shrink-0 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] transition-colors truncate max-w-[150px] px-1
                  ${hoveredSegment === segment.folder.id ? dropHighlight : ''}`}
              >
                {segment.folder.name}
                {hoveredSegment === segment.folder.id && <SpringDwellRing />}
              </button>
            )}
          </React.Fragment>
        );
      })}
    </nav>
  );
};

export default Breadcrumb;
