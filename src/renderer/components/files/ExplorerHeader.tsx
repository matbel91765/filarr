/**
 * ExplorerHeader — la barre d'en-tête d'un explorateur de fichiers.
 *
 * Extrait de `views/FolderView/FolderView.tsx` : SEULE la coque est partagée
 * (hauteur, fond, bordure, bouton retour et sa cible de dépôt, emplacement du
 * fil d'Ariane, zone d'actions à droite). Le contenu — quel fil d'Ariane, quels
 * boutons — reste chez l'appelant, parce qu'il est indissociable de son état
 * (imports en cours, greffons d'édition installés, droits du coffre…).
 *
 * C'est le juste niveau : l'espace personnel et le navigateur de coffre
 * partagent la chrome au pixel près sans que le second hérite des actions du
 * premier.
 */

import { FC, ReactNode, DragEvent } from 'react';
import { SpringDwellRing } from '../ui/SpringDwellRing';

const BackIcon: FC = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={2}
    stroke="currentColor"
    width="20"
    height="20"
  >
    <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
  </svg>
);

export interface ExplorerHeaderProps {
  /** Remonter d'un cran. Omis = pas de bouton retour du tout. */
  onBack?: () => void;
  /** Libellé accessible du bouton retour — traduit par l'appelant. */
  backLabel?: string;
  /**
   * Le bouton retour est aussi une CIBLE DE DÉPÔT (remonter un élément d'un
   * cran). `backDropActive` allume l'anneau de temps restant, exactement comme
   * sur un segment du fil d'Ariane.
   */
  onBackDragOver?: (e: DragEvent<HTMLButtonElement>) => void;
  onBackDragLeave?: (e: DragEvent<HTMLButtonElement>) => void;
  onBackDrop?: (e: DragEvent<HTMLButtonElement>) => void;
  backDropActive?: boolean;
  /** Fil d'Ariane (ou tout autre repère de position) — rendu par l'appelant. */
  breadcrumb?: ReactNode;
  /** Boutons d'action, alignés à droite. */
  actions?: ReactNode;
}

export const ExplorerHeader: FC<ExplorerHeaderProps> = ({
  onBack,
  backLabel,
  onBackDragOver,
  onBackDragLeave,
  onBackDrop,
  backDropActive = false,
  breadcrumb,
  actions,
}) => (
  <div className="flex items-center justify-between h-16 px-6 bg-[var(--color-surface)] border-b border-[var(--color-border)] shrink-0">
    <div className="flex items-center gap-3 min-w-0">
      {onBack && (
        <button
          onClick={onBack}
          onDragOver={onBackDragOver}
          onDragLeave={onBackDragLeave}
          onDrop={onBackDrop}
          className={`relative shrink-0 flex items-center justify-center w-9 h-9 rounded-full
              text-[var(--color-text-secondary)] hover:bg-[var(--color-background-secondary)]
              ${backDropActive ? 'ring-2 ring-[var(--color-primary-400)]' : ''}`}
          aria-label={backLabel}
        >
          <BackIcon />
          {/* Même minuteur que le fil d'Ariane, donc même anneau : le
                clignotement d'avant ne disait pas combien de temps tenir. */}
          {backDropActive && <SpringDwellRing />}
        </button>
      )}
      {breadcrumb}
    </div>
    <div className="flex items-center gap-2 shrink-0">{actions}</div>
  </div>
);

ExplorerHeader.displayName = 'ExplorerHeader';

export default ExplorerHeader;
