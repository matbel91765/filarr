/**
 * Bloc « Dossiers suggérés » — les quatre derniers dossiers touchés.
 *
 * Cartes horizontales, comme avant. Elles ne portent PAS de glisser-déposer :
 * c'était déjà le cas, et c'est cohérent — on ne range pas dans un raccourci,
 * on range dans la liste complète.
 */

import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import type { RootState } from '../../../../store';
import type { Folder } from '../../../../types';
import { useHomeActions } from '../HomeActionsContext';
import { selectSuggestedFolders } from '../homeSelectors';
import type { WidgetProps } from '../widgetOptions';
import { SectionHeading } from './SectionHeading';

/** Aucun dossier à la racine ⇒ aucun bloc (le bloc principal dit déjà le vide). */
export function isSuggestedFoldersEmpty(state: RootState): boolean {
  return selectSuggestedFolders(state).length === 0;
}

const FolderStackIcon: React.FC = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={1.5}
    stroke="currentColor"
    className="w-4 h-4"
    aria-hidden="true"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 00-1.883 2.542l.857 6a2.25 2.25 0 002.227 1.932H19.05a2.25 2.25 0 002.227-1.932l.857-6a2.25 2.25 0 00-1.883-2.542m-16.5 0V6A2.25 2.25 0 016 3.75h3.879a1.5 1.5 0 011.06.44l2.122 2.12a1.5 1.5 0 001.06.44H18A2.25 2.25 0 0120.25 9v.776"
    />
  </svg>
);

const MoreDotsIcon: React.FC = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={2}
    stroke="currentColor"
    className="w-4 h-4 text-[var(--color-text-secondary)]"
    aria-hidden="true"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M12 6.75a.75.75 0 110-1.5.75.75 0 010 1.5zM12 12.75a.75.75 0 110-1.5.75.75 0 010 1.5zM12 18.75a.75.75 0 110-1.5.75.75 0 010 1.5z"
    />
  </svg>
);

/** Une carte, isolée pour que ses rappels aient une identité stable par dossier. */
const SuggestedFolderCard: React.FC<{
  folder: Folder;
  onOpen: (folderId: string) => void;
  onMenu: (event: React.MouseEvent<HTMLElement>, folder: Folder) => void;
}> = React.memo(function SuggestedFolderCard({ folder, onOpen, onMenu }) {
  const { t } = useTranslation();

  const open = useCallback(() => onOpen(folder.id), [onOpen, folder.id]);
  const menu = useCallback(
    (e: React.MouseEvent<HTMLElement>) => onMenu(e, folder),
    [onMenu, folder]
  );

  return (
    <div
      onClick={open}
      onContextMenu={menu}
      className="flex items-center gap-3 px-4 py-3 rounded-xl cursor-pointer
      bg-[var(--color-surface)] border border-[var(--color-border)]
      shadow-sm hover:shadow-md hover:border-[var(--color-primary-200)]
      transition-all duration-150 select-none group"
    >
      <div
        className="shrink-0 w-10 h-10 rounded-lg flex items-center justify-center"
        style={{
          backgroundColor: folder.color ? `${folder.color}20` : 'var(--color-primary-50)',
        }}
      >
        {folder.emoji ? (
          <span className="text-xl leading-none">{folder.emoji}</span>
        ) : (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill={folder.color || 'var(--color-primary-500)'}
            viewBox="0 0 24 24"
            className="w-5 h-5"
          >
            <path d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
          </svg>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-[var(--color-text-primary)] truncate">
          {folder.name}
        </p>
        <p className="text-xs text-[var(--color-text-tertiary)]">
          {folder.items?.length || 0} {t('home.items', 'élément(s)')}
        </p>
      </div>
      <button
        onClick={(e) => {
          e.stopPropagation();
          menu(e);
        }}
        className="opacity-0 group-hover:opacity-100 shrink-0 p-1 rounded-full
        hover:bg-[var(--color-background-secondary)] transition-opacity duration-150"
      >
        <MoreDotsIcon />
      </button>
    </div>
  );
});

export const SuggestedFoldersWidget: React.FC<WidgetProps> = React.memo(
  function SuggestedFoldersWidget({ editing }) {
    const { t } = useTranslation();
    const actions = useHomeActions();
    const suggested = useSelector(selectSuggestedFolders);

    if (suggested.length === 0 && !editing) return null;

    return (
      <section>
        <SectionHeading
          icon={<FolderStackIcon />}
          label={t('home.suggestedFolders', 'Dossiers suggérés')}
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {suggested.map((folder) => (
            <SuggestedFolderCard
              key={`suggested-${folder.id}`}
              folder={folder}
              onOpen={actions.openFolder}
              onMenu={actions.folderContextMenu}
            />
          ))}
        </div>
      </section>
    );
  }
);

export default SuggestedFoldersWidget;
