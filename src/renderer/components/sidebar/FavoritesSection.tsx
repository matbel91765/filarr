/**
 * FavoritesSection Component
 *
 * Section de la sidebar pour afficher les favoris et fichiers recents.
 * Supporte le drag-and-drop pour reordonner et les raccourcis Ctrl+1-9.
 * Migre en Tailwind CSS. Filtre les elements supprimes.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  selectFavorites,
  selectRecentFiles,
  selectDragState,
  selectDisplayPreferences,
  removeFavorite,
  reorderFavorites,
  assignShortcut,
  removeRecentFile,
  clearRecentFiles,
  startDrag,
  setDropTarget,
  endDrag,
  toggleShowRecent,
  toggleShowFavorites,
  selectFavoriteByShortcut,
  FavoriteItem,
  RecentItem,
} from '../../../store/slices/favoritesSlice';
import { vaultRefOf } from '../../../store/selectors/fileShortcutSelectors';
import { vaultFolderRoute } from '../layout/RouteContent/routeCompat';
import type { RootState, AppDispatch } from '../../../store';

// ==================== ICONS ====================

const StarIcon: React.FC<{ filled?: boolean }> = ({ filled = false }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill={filled ? 'currentColor' : 'none'}
    viewBox="0 0 24 24"
    strokeWidth={1.5}
    stroke="currentColor"
    className="w-[18px] h-[18px] shrink-0"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z"
    />
  </svg>
);

const ClockIcon: React.FC = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={1.5}
    stroke="currentColor"
    className="w-[18px] h-[18px] shrink-0"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z"
    />
  </svg>
);

const FolderIcon: React.FC<{ color?: string }> = ({ color }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill={color || 'currentColor'}
    viewBox="0 0 24 24"
    strokeWidth={1.5}
    stroke="currentColor"
    className="w-[18px] h-[18px] shrink-0"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z"
    />
  </svg>
);

const FileIcon: React.FC = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={1.5}
    stroke="currentColor"
    className="w-[18px] h-[18px] shrink-0"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
    />
  </svg>
);

const ChevronIcon: React.FC<{ expanded: boolean }> = ({ expanded }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={2}
    stroke="currentColor"
    className={`w-4 h-4 shrink-0 transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`}
  >
    <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
  </svg>
);

const TrashIcon: React.FC = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={1.5}
    stroke="currentColor"
    className="w-3.5 h-3.5"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"
    />
  </svg>
);

const DragIcon: React.FC = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={1.5}
    stroke="currentColor"
    className="w-3.5 h-3.5"
  >
    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 9h16.5m-16.5 6.75h16.5" />
  </svg>
);

// ==================== PROPS ====================

export interface FavoritesSectionProps {
  onItemClick?: (itemId: string, itemType: 'file' | 'folder') => void;
  className?: string;
}

// ==================== COMPONENT ====================

export const FavoritesSection: React.FC<FavoritesSectionProps> = ({
  onItemClick,
  className = '',
}) => {
  const { t } = useTranslation();
  const dispatch = useDispatch<AppDispatch>();
  const navigate = useNavigate();

  // Selectors
  const favorites = useSelector(selectFavorites);
  const recentFiles = useSelector(selectRecentFiles);
  const dragState = useSelector(selectDragState);
  const displayPrefs = useSelector(selectDisplayPreferences);

  // Store data to check if items still exist
  const foldersById = useSelector((state: RootState) => state.folders.byId);
  const filesById = useSelector((state: RootState) => state.files?.byId ?? {});

  // Filter favorites to exclude deleted items
  const activeFavorites = useMemo(() => {
    return favorites.filter((fav) => {
      if (fav.itemType === 'folder') {
        const folder = foldersById[fav.itemId];
        return folder && !folder.deletedAt;
      } else {
        const file = filesById[fav.itemId];
        return file && !file.deletedAt;
      }
    });
  }, [favorites, foldersById, filesById]);

  // Filter recent files to exclude deleted items
  const activeRecentFiles = useMemo(() => {
    return recentFiles.filter((recent) => {
      if (recent.itemType === 'folder') {
        const folder = foldersById[recent.itemId];
        return folder && !folder.deletedAt;
      } else {
        const file = filesById[recent.itemId];
        return file && !file.deletedAt;
      }
    });
  }, [recentFiles, foldersById, filesById]);

  // Local state
  const [editingShortcut, setEditingShortcut] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    item: FavoriteItem | RecentItem;
    type: 'favorite' | 'recent';
  } | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);

  // ===== KEYBOARD SHORTCUTS =====

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key >= '1' && e.key <= '9') {
        const shortcutKey = parseInt(e.key);
        const favorite = selectFavoriteByShortcut(
          {
            favorites: {
              favorites,
              recentFiles,
              maxRecentFiles: 20,
              isDragging: false,
              draggedItemId: null,
              dropTargetIndex: null,
              showRecent: true,
              showFavorites: true,
              lastPersisted: null,
            },
          },
          shortcutKey
        );

        if (favorite) {
          e.preventDefault();
          handleItemClick(favorite.itemId, favorite.itemType);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [favorites]);

  // ===== HANDLERS =====

  const handleItemClick = useCallback(
    (itemId: string, itemType: 'file' | 'folder') => {
      if (onItemClick) {
        onItemClick(itemId, itemType);
      } else {
        if (itemType === 'folder') {
          navigate(`/folder/${itemId}`);
          return;
        }
        // Un RACCOURCI s'ouvre dans le coffre, sur l'élément : ses octets
        // ne sont plus ici.
        const shortcutRef = vaultRefOf(filesById[itemId]);
        if (shortcutRef) {
          navigate(vaultFolderRoute(shortcutRef.vaultId, { itemId: shortcutRef.itemId }));
          return;
        }
        navigate(`/file/${itemId}`);
      }
    },
    [onItemClick, navigate, filesById]
  );

  const handleRemoveFavorite = useCallback(
    (itemId: string) => {
      dispatch(removeFavorite(itemId));
    },
    [dispatch]
  );

  const handleRemoveRecent = useCallback(
    (itemId: string) => {
      dispatch(removeRecentFile(itemId));
    },
    [dispatch]
  );

  const handleClearRecent = useCallback(() => {
    dispatch(clearRecentFiles());
  }, [dispatch]);

  const handleToggleFavorites = useCallback(() => {
    dispatch(toggleShowFavorites());
  }, [dispatch]);

  const handleToggleRecent = useCallback(() => {
    dispatch(toggleShowRecent());
  }, [dispatch]);

  // ===== DRAG AND DROP =====

  const handleDragStart = useCallback(
    (e: React.DragEvent, favoriteId: string) => {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', favoriteId);
      dispatch(startDrag(favoriteId));
    },
    [dispatch]
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent, index: number) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      dispatch(setDropTarget(index));
    },
    [dispatch]
  );

  const handleDragLeave = useCallback(() => {
    dispatch(setDropTarget(null));
  }, [dispatch]);

  const handleDrop = useCallback(
    (e: React.DragEvent, targetIndex: number) => {
      e.preventDefault();
      const draggedId = e.dataTransfer.getData('text/plain');
      const sourceIndex = favorites.findIndex((f) => f.id === draggedId);

      if (sourceIndex !== -1 && sourceIndex !== targetIndex) {
        dispatch(reorderFavorites({ sourceIndex, destinationIndex: targetIndex }));
      }
      dispatch(endDrag());
    },
    [dispatch, favorites]
  );

  const handleDragEnd = useCallback(() => {
    dispatch(endDrag());
  }, [dispatch]);

  // ===== CONTEXT MENU =====

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, item: FavoriteItem | RecentItem, type: 'favorite' | 'recent') => {
      e.preventDefault();
      setContextMenu({ x: e.clientX, y: e.clientY, item, type });
    },
    []
  );

  const handleCloseContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  useEffect(() => {
    const handleClickOutside = () => setContextMenu(null);
    if (contextMenu) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
    return undefined;
  }, [contextMenu]);

  // ===== SHORTCUT EDITING =====

  const handleStartShortcutEdit = useCallback((favoriteId: string) => {
    setEditingShortcut(favoriteId);
  }, []);

  const handleShortcutKeyPress = useCallback(
    (e: React.KeyboardEvent, favoriteId: string) => {
      if (e.key >= '1' && e.key <= '9') {
        dispatch(assignShortcut({ favoriteId, shortcutKey: parseInt(e.key) }));
        setEditingShortcut(null);
      } else if (e.key === 'Escape' || e.key === 'Backspace') {
        dispatch(assignShortcut({ favoriteId, shortcutKey: null }));
        setEditingShortcut(null);
      }
    },
    [dispatch]
  );

  // ===== RENDER HELPERS =====

  const formatDate = (dateString: string): string => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return t('favorites.justNow', "A l'instant");
    if (diffMins < 60) return t('favorites.minutesAgo', '{{count}} min', { count: diffMins });
    if (diffHours < 24) return t('favorites.hoursAgo', '{{count}}h', { count: diffHours });
    if (diffDays < 7) return t('favorites.daysAgo', '{{count}}j', { count: diffDays });
    return date.toLocaleDateString();
  };

  const renderFavoriteItem = (favorite: FavoriteItem, index: number) => {
    const isDragging = dragState.isDragging && dragState.draggedItemId === favorite.id;
    const isDropTarget = dragState.dropTargetIndex === index;

    return (
      <div
        key={favorite.id}
        className={`
          group flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer
          text-sm text-[var(--color-text-secondary)] select-none relative
          transition-colors duration-150
          hover:bg-[var(--color-hover-overlay)] hover:text-[var(--color-text-primary)]
          focus:outline-2 focus:outline-[var(--color-primary-500)] focus:-outline-offset-2
          ${isDragging ? 'opacity-50 bg-[var(--color-primary-50)]' : ''}
          ${isDropTarget ? 'border-t-2 border-[var(--color-primary-500)]' : ''}
        `}
        draggable
        onDragStart={(e) => handleDragStart(e, favorite.id)}
        onDragOver={(e) => handleDragOver(e, index)}
        onDragLeave={handleDragLeave}
        onDrop={(e) => handleDrop(e, index)}
        onDragEnd={handleDragEnd}
        onClick={() => handleItemClick(favorite.itemId, favorite.itemType)}
        onContextMenu={(e) => handleContextMenu(e, favorite, 'favorite')}
        role="button"
        tabIndex={0}
        onKeyPress={(e) => e.key === 'Enter' && handleItemClick(favorite.itemId, favorite.itemType)}
      >
        <span className="flex items-center opacity-0 group-hover:opacity-100 cursor-grab text-[var(--color-text-tertiary)] transition-opacity duration-150">
          <DragIcon />
        </span>

        <span className="inline-flex items-center justify-center shrink-0">
          {favorite.itemType === 'folder' ? <FolderIcon color={favorite.color} /> : <FileIcon />}
        </span>

        <span className="flex-1 truncate">{favorite.name}</span>

        {favorite.shortcutKey && (
          <span className="text-xs text-[var(--color-text-tertiary)] bg-[var(--color-neutral-100)] dark:bg-[var(--color-neutral-700)] px-2 py-0.5 rounded font-mono">
            Ctrl+{favorite.shortcutKey}
          </span>
        )}

        {editingShortcut === favorite.id ? (
          <input
            type="text"
            className="w-[50px] px-2 py-0.5 text-xs border border-[var(--color-primary-500)] rounded bg-[var(--color-surface)] text-[var(--color-text-primary)] text-center focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-200)]"
            placeholder="1-9"
            autoFocus
            onKeyDown={(e) => handleShortcutKeyPress(e, favorite.id)}
            onBlur={() => setEditingShortcut(null)}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <button
            className="p-1 bg-transparent border-none cursor-pointer text-[var(--color-text-tertiary)] rounded opacity-0 group-hover:opacity-100 transition-opacity duration-150 flex items-center justify-center hover:text-[var(--color-error-500)] hover:bg-[var(--color-error-50)]"
            onClick={(e) => {
              e.stopPropagation();
              handleRemoveFavorite(favorite.itemId);
            }}
            title={t('favorites.remove', 'Retirer des favoris')}
          >
            <TrashIcon />
          </button>
        )}
      </div>
    );
  };

  const renderRecentItem = (recent: RecentItem) => (
    <div
      key={recent.id}
      className="
        group flex items-center gap-2 px-3 py-2 pr-2 rounded-lg cursor-pointer
        text-sm text-[var(--color-text-secondary)] select-none relative
        transition-colors duration-150
        hover:bg-[var(--color-hover-overlay)] hover:text-[var(--color-text-primary)]
        focus:outline-2 focus:outline-[var(--color-primary-500)] focus:-outline-offset-2
      "
      onClick={() => handleItemClick(recent.itemId, recent.itemType)}
      onContextMenu={(e) => handleContextMenu(e, recent, 'recent')}
      role="button"
      tabIndex={0}
      onKeyPress={(e) => e.key === 'Enter' && handleItemClick(recent.itemId, recent.itemType)}
    >
      <span className="inline-flex items-center justify-center shrink-0">
        {recent.itemType === 'folder' ? <FolderIcon /> : <FileIcon />}
      </span>

      <span className="flex-1 truncate">{recent.name}</span>

      <span className="text-xs text-[var(--color-text-tertiary)] shrink-0">
        {formatDate(recent.accessedAt)}
      </span>

      <button
        className="p-1 bg-transparent border-none cursor-pointer text-[var(--color-text-tertiary)] rounded opacity-0 group-hover:opacity-100 transition-opacity duration-150 flex items-center justify-center hover:text-[var(--color-error-500)] hover:bg-[var(--color-error-50)]"
        onClick={(e) => {
          e.stopPropagation();
          handleRemoveRecent(recent.itemId);
        }}
        title={t('favorites.removeRecent', 'Retirer des recents')}
      >
        <TrashIcon />
      </button>
    </div>
  );

  // ===== RENDER =====

  return (
    <div ref={containerRef} className={`flex flex-col gap-2 py-2 ${className}`}>
      {/* Favorites Section */}
      <div className="flex flex-col">
        <button
          className="
            flex items-center gap-2 w-full px-3 py-2
            bg-transparent border-none cursor-pointer text-left
            text-[var(--color-text-secondary)] text-sm font-medium
            rounded-lg transition-colors duration-150
            hover:bg-[var(--color-hover-overlay)] hover:text-[var(--color-text-primary)]
          "
          onClick={handleToggleFavorites}
          aria-expanded={displayPrefs.showFavorites}
        >
          <ChevronIcon expanded={displayPrefs.showFavorites} />
          <StarIcon filled />
          <span className="flex-1">{t('favorites.title', 'Favoris')}</span>
          <span className="text-xs text-[var(--color-text-tertiary)] bg-[var(--color-neutral-100)] dark:bg-[var(--color-neutral-700)] px-2 rounded-full min-w-[20px] text-center">
            {activeFavorites.length}
          </span>
        </button>

        {displayPrefs.showFavorites && (
          <div className="flex flex-col gap-0.5 py-1 ml-4">
            {activeFavorites.length > 0 ? (
              activeFavorites.map((fav, index) => renderFavoriteItem(fav, index))
            ) : (
              <p className="text-sm text-[var(--color-text-tertiary)] text-center py-4 px-2 m-0 italic">
                {t('favorites.empty', 'Aucun favori')}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Recent Files Section */}
      <div className="flex flex-col">
        <div className="group/header flex items-center gap-0">
          <button
            className="
              flex items-center gap-2 flex-1 px-3 py-2
              bg-transparent border-none cursor-pointer text-left
              text-[var(--color-text-secondary)] text-sm font-medium
              rounded-lg transition-colors duration-150
              hover:bg-[var(--color-hover-overlay)] hover:text-[var(--color-text-primary)]
            "
            onClick={handleToggleRecent}
            aria-expanded={displayPrefs.showRecent}
          >
            <ChevronIcon expanded={displayPrefs.showRecent} />
            <ClockIcon />
            <span className="flex-1">{t('favorites.recent', 'Recents')}</span>
            <span className="text-xs text-[var(--color-text-tertiary)] bg-[var(--color-neutral-100)] dark:bg-[var(--color-neutral-700)] px-2 rounded-full min-w-[20px] text-center">
              {activeRecentFiles.length}
            </span>
          </button>
          {activeRecentFiles.length > 0 && (
            <button
              className="p-1 mr-2 bg-transparent border-none cursor-pointer text-[var(--color-text-tertiary)] rounded opacity-0 group-hover/header:opacity-100 transition-opacity duration-150 hover:text-[var(--color-error-500)] hover:bg-[var(--color-error-50)]"
              onClick={handleClearRecent}
              title={t('favorites.clearRecent', 'Vider les recents')}
            >
              <TrashIcon />
            </button>
          )}
        </div>

        {displayPrefs.showRecent && (
          <div className="flex flex-col gap-0.5 py-1 ml-4">
            {activeRecentFiles.length > 0 ? (
              activeRecentFiles.slice(0, 10).map(renderRecentItem)
            ) : (
              <p className="text-sm text-[var(--color-text-tertiary)] text-center py-4 px-2 m-0 italic">
                {t('favorites.noRecent', 'Aucun fichier recent')}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <div
          className="fixed z-[var(--z-index-dropdown)] min-w-[180px] bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg shadow-lg p-1 animate-in fade-in zoom-in-95 duration-150"
          style={{ top: contextMenu.y, left: contextMenu.x }}
        >
          {contextMenu.type === 'favorite' && (
            <>
              <button
                className="
                  flex items-center gap-2 w-full px-3 py-2
                  bg-transparent border-none cursor-pointer text-left
                  text-[var(--color-text-secondary)] text-sm rounded
                  transition-colors duration-150
                  hover:bg-[var(--color-hover-overlay)] hover:text-[var(--color-text-primary)]
                "
                onClick={() => {
                  handleStartShortcutEdit((contextMenu.item as FavoriteItem).id);
                  handleCloseContextMenu();
                }}
              >
                {t('favorites.assignShortcut', 'Assigner raccourci (Ctrl+1-9)')}
              </button>
              <button
                className="
                  flex items-center gap-2 w-full px-3 py-2
                  bg-transparent border-none cursor-pointer text-left
                  text-[var(--color-text-secondary)] text-sm rounded
                  transition-colors duration-150
                  hover:bg-[var(--color-error-50)] hover:text-[var(--color-error-600)]
                "
                onClick={() => {
                  handleRemoveFavorite(contextMenu.item.itemId);
                  handleCloseContextMenu();
                }}
              >
                {t('favorites.remove', 'Retirer des favoris')}
              </button>
            </>
          )}
          {contextMenu.type === 'recent' && (
            <button
              className="
                flex items-center gap-2 w-full px-3 py-2
                bg-transparent border-none cursor-pointer text-left
                text-[var(--color-text-secondary)] text-sm rounded
                transition-colors duration-150
                hover:bg-[var(--color-error-50)] hover:text-[var(--color-error-600)]
              "
              onClick={() => {
                handleRemoveRecent(contextMenu.item.itemId);
                handleCloseContextMenu();
              }}
            >
              {t('favorites.removeRecent', 'Retirer des recents')}
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default FavoritesSection;
