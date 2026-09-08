/**
 * SubfolderCard — la tuile d'un sous-dossier dans l'explorateur.
 *
 * Extraite telle quelle de `views/FolderView/FolderView.tsx`. Comme FileCard,
 * elle ne lit ni Redux ni la route : tout arrive par les props, pour que le
 * navigateur de coffre partagé rende EXACTEMENT la même tuile.
 */

import React, { MouseEvent, DragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { SpringDwellRing } from '../ui/SpringDwellRing';
import { MovingOverlay } from './FileCard';
import { SharedBadge } from './SharedBadge';

/**
 * Forme minimale d'un dossier affichable. `Folder` (le type Redux de l'espace
 * personnel) y est assignable tel quel.
 */
export interface ExplorerFolder {
  id: string;
  name: string;
  color?: string;
  emoji?: string;
  /** Identifiants des éléments contenus — sert au compteur « n element(s) ». */
  items?: string[];
}

// Props pour SubfolderCard
export interface SubfolderCardProps<F extends ExplorerFolder = ExplorerFolder> {
  subfolder: F;
  onItemClick: (item: F) => void;
  onContextMenu: (e: MouseEvent<HTMLDivElement>, item: F) => void;
  onDragStart: (e: DragEvent<HTMLDivElement>, item: F) => void;
  onDragEnd: () => void;
  onDragOver: (e: DragEvent<HTMLDivElement>, itemId: string) => void;
  onDragEnter: (e: DragEvent<HTMLDivElement>, itemId: string) => void;
  onDragLeave: (e: DragEvent<HTMLDivElement>) => void;
  onDrop: (e: DragEvent<HTMLDivElement>, itemId: string) => void;
  isDropTarget: boolean;
  isDragging: boolean;
  /** Dossier armé pour l'ouverture automatique : la tuile s'allume et son
   *  pourtour montre le temps qu'il reste à tenir avant qu'elle s'ouvre. */
  isSpringTarget?: boolean;
  /** Déplacement de ce dossier en vol : la carte est gelée le temps de l'aller-retour */
  isMoving?: boolean;
  protectionStatus?: { isProtected: boolean; isUnlocked: boolean };
  /**
   * Le CUMUL de partage du dossier : combien d'éléments partagés il contient,
   * et l'infobulle déjà traduite. Absent = rien de partagé dedans (pas de
   * badge). L'objet doit être STABLE entre deux rendus (mémoïsé par
   * l'appelant, cf. `buildSharedCardProps`), sinon `React.memo` ne tient pas.
   */
  sharedRollup?: { count: number; title: string };
}

// Composant SubfolderCard (memoized pour eviter les re-renders inutiles)
const SubfolderCardInner = React.memo(
  <F extends ExplorerFolder>({
    subfolder,
    onItemClick,
    onContextMenu,
    onDragStart,
    onDragEnd,
    onDragOver,
    onDragEnter,
    onDragLeave,
    onDrop,
    isDropTarget,
    isDragging,
    isSpringTarget,
    isMoving,
    protectionStatus,
    sharedRollup,
  }: SubfolderCardProps<F>) => {
    const { t } = useTranslation();
    return (
      <div
        data-item-id={subfolder.id}
        onClick={() => onItemClick(subfolder)}
        onContextMenu={(e) => onContextMenu(e, subfolder)}
        draggable
        onDragStart={(e) => onDragStart(e, subfolder)}
        onDragEnd={onDragEnd}
        onDragOver={(e) => onDragOver(e, subfolder.id)}
        onDragEnter={(e) => onDragEnter(e, subfolder.id)}
        onDragLeave={onDragLeave}
        onDrop={(e) => onDrop(e, subfolder.id)}
        className={`group relative flex items-center gap-3 px-4 py-3 rounded-xl cursor-pointer
        bg-[var(--color-surface)] border border-[var(--color-border)]
        shadow-sm hover:border-[var(--color-primary-200)]
        select-none [contain:content] overflow-hidden
        ${isDropTarget ? 'ring-2 ring-[var(--color-primary-400)] border-dashed border-[var(--color-primary-400)]' : ''}
        ${isDragging ? 'opacity-50 scale-95' : ''}
        ${isMoving ? 'pointer-events-none' : ''}`}
        style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 56px' }}
      >
        {/* Monté seulement tant que la cible est armée : le balayage repart donc
            en même temps que le minuteur, sans `key` à tenir à jour. */}
        {isSpringTarget && <SpringDwellRing />}
        {isMoving && <MovingOverlay />}
        <div
          className="shrink-0 w-10 h-10 rounded-lg flex items-center justify-center"
          style={{
            backgroundColor: subfolder.color ? `${subfolder.color}20` : 'var(--color-primary-50)',
          }}
        >
          {subfolder.emoji ? (
            <span className="text-xl leading-none">{subfolder.emoji}</span>
          ) : (
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill={subfolder.color || 'var(--color-primary-500)'}
              viewBox="0 0 24 24"
              className="w-5 h-5"
            >
              <path d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
            </svg>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-[var(--color-text-primary)] truncate flex items-center gap-1.5">
            {subfolder.name}
            {protectionStatus?.isProtected && (
              <span
                className={`shrink-0 ${protectionStatus.isUnlocked ? 'text-green-500' : 'text-[var(--color-text-tertiary)]'}`}
                title={
                  protectionStatus.isUnlocked
                    ? t('password.unlockedSession', 'Déverrouillé pour cette session')
                    : t('password.protected', 'Protégé par mot de passe')
                }
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                  stroke="currentColor"
                  className="w-3.5 h-3.5"
                >
                  {protectionStatus.isUnlocked ? (
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M13.5 10.5V6.75a4.5 4.5 0 119 0v3.75M3.75 21.75h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H3.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"
                    />
                  ) : (
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"
                    />
                  )}
                </svg>
              </span>
            )}
            {sharedRollup && (
              <SharedBadge
                variant="inline"
                count={sharedRollup.count}
                title={sharedRollup.title}
                className="shrink-0"
              />
            )}
          </p>
          <p className="text-xs text-[var(--color-text-tertiary)]">
            {subfolder.items?.length || 0} element(s)
          </p>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onContextMenu(e as any, subfolder);
          }}
          className="opacity-0 group-hover:opacity-100 shrink-0 p-1 rounded-full
          hover:bg-[var(--color-background-secondary)]"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
            className="w-4 h-4 text-[var(--color-text-secondary)]"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 6.75a.75.75 0 110-1.5.75.75 0 010 1.5zM12 12.75a.75.75 0 110-1.5.75.75 0 010 1.5zM12 18.75a.75.75 0 110-1.5.75.75 0 010 1.5z"
            />
          </svg>
        </button>
      </div>
    );
  }
);

SubfolderCardInner.displayName = 'SubfolderCard';

/** Même restauration de généricité que pour `FileCard` — voir le commentaire là-bas. */
export const SubfolderCard = SubfolderCardInner as unknown as (<F extends ExplorerFolder>(
  props: SubfolderCardProps<F>
) => React.ReactElement | null) & { displayName?: string };
