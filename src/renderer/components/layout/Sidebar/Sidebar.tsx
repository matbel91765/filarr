/**
 * Sidebar Component
 *
 * Barre laterale de navigation avec favoris et fichiers recents.
 */

import React, { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useLocation } from 'react-router-dom';
import { useSelector, useDispatch } from 'react-redux';
import { FavoritesSection } from '../../sidebar/FavoritesSection';
import type { RootState, AppDispatch } from '../../../../store';
import { setCurrentFolder } from '../../../../store/slices/foldersSlice';
import { addTab, updateTabRoute } from '../../../../store/slices/tabsSlice';
import { routeToTitle } from '../../../../hooks/useTabNavigation';
import { selectFilesStats } from '../../../../store/selectors/fileSelectors';
import './Sidebar.css';

interface NavItem {
  id: string;
  label: string;
  path: string;
  icon: React.ReactNode;
}

const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 o';
  const units = ['o', 'Ko', 'Mo', 'Go', 'To'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)} ${units[Math.min(i, units.length - 1)]}`;
};

const StorageFooter: React.FC = () => {
  const { t } = useTranslation();
  const fileStats = useSelector(selectFilesStats);
  const usedBytes = fileStats.totalSize;
  // Local mode: no hard limit, just show usage
  return (
    <div className="p-3 border-t border-[var(--color-border)] bg-[var(--color-background-secondary)]">
      <div className="flex flex-col gap-1.5">
        <p className="text-xs text-[var(--color-text-secondary)] m-0">
          {t('sidebar.storageUsed', { size: formatBytes(usedBytes) })}
        </p>
      </div>
    </div>
  );
};

export interface SidebarProps {
  isOpen?: boolean;
  onClose?: () => void;
  className?: string;
}

export const Sidebar: React.FC<SidebarProps> = React.memo(function Sidebar({
  isOpen = true,
  onClose,
  className,
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const dispatch = useDispatch<AppDispatch>();

  const foldersById = useSelector((state: RootState) => state.folders.byId);
  const filesById = useSelector((state: RootState) => state.files?.byId ?? {});
  const isSplit = useSelector((state: RootState) => state.tabs.panels.length > 1);
  const focusedPanelId = useSelector((state: RootState) => state.tabs.focusedPanelId);
  const focusedPanel = useSelector((state: RootState) =>
    state.tabs.panels.find((p) => p.id === state.tabs.focusedPanelId)
  );

  const navItems: NavItem[] = useMemo(
    () => [
      {
        id: 'home',
        label: t('sidebar.home', 'Accueil'),
        path: '/',
        icon: (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
            className="w-5 h-5"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25"
            />
          </svg>
        ),
      },
      {
        id: 'trash',
        label: t('sidebar.trash', 'Corbeille'),
        path: '/trash',
        icon: (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
            className="w-5 h-5"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"
            />
          </svg>
        ),
      },
      {
        id: 'notes',
        label: t('sidebar.notes', 'Notes'),
        path: '/notes',
        icon: (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
            className="w-5 h-5"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
            />
          </svg>
        ),
      },
      {
        id: 'collections',
        label: t('sidebar.collections', 'Collections'),
        path: '/collections',
        icon: (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
            className="w-5 h-5"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z"
            />
          </svg>
        ),
      },
      {
        id: 'timeline',
        label: t('sidebar.timeline', 'Chronologie'),
        path: '/timeline',
        icon: (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
            className="w-5 h-5"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        ),
      },
      {
        id: 'automation',
        label: t('sidebar.automation', 'Automatisation'),
        path: '/automation',
        icon: (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
            className="w-5 h-5"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z"
            />
          </svg>
        ),
      },
      {
        id: 'settings',
        label: t('sidebar.settings', 'Parametres'),
        path: '/settings',
        icon: (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
            className="w-5 h-5"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
            />
          </svg>
        ),
      },
    ],
    [t]
  );

  const handleNavigate = useCallback(
    (path: string): void => {
      if (isSplit && focusedPanel) {
        // In split mode, update the focused panel's active tab directly via Redux
        // instead of going through React Router (which can only represent 1 URL).
        const title = routeToTitle(path, foldersById);
        const folderMatch = path.match(/^\/folder\/(.+)$/);
        dispatch(
          updateTabRoute({
            panelId: focusedPanelId,
            tabId: focusedPanel.activeTabId,
            route: path,
            title,
            folderId: folderMatch ? folderMatch[1] : undefined,
          })
        );
      }
      // Always navigate so URL stays in sync with focused panel
      navigate(path);
      if (onClose) {
        onClose();
      }
    },
    [navigate, onClose, isSplit, focusedPanel, focusedPanelId, foldersById, dispatch]
  );

  const handleFavoriteClick = useCallback(
    (itemId: string, itemType: 'file' | 'folder') => {
      let targetPath = '/';
      if (itemType === 'folder') {
        dispatch(setCurrentFolder(itemId));
        targetPath = `/folder/${itemId}`;
      } else {
        const file = filesById[itemId];
        const parentId = file?.parentId;
        if (parentId) {
          dispatch(setCurrentFolder(parentId));
          targetPath = `/folder/${parentId}`;
        } else {
          const parentFolderId = Object.keys(foldersById).find((fId) => {
            const folder = foldersById[fId];
            if (!folder?.items) return false;
            return folder.items.some((item: any) => {
              const id = typeof item === 'string' ? item : item?.id;
              return id === itemId;
            });
          });
          if (parentFolderId) {
            dispatch(setCurrentFolder(parentFolderId));
            targetPath = `/folder/${parentFolderId}`;
          }
        }
      }
      handleNavigate(targetPath);
    },
    [dispatch, handleNavigate, filesById, foldersById]
  );

  const handleMiddleClick = useCallback(
    (e: React.MouseEvent, path: string, label: string): void => {
      if (e.button === 1) {
        e.preventDefault();
        const folderMatch = path.match(/^\/folder\/(.+)$/);
        dispatch(
          addTab({
            route: path,
            title: label,
            ...(folderMatch ? { folderId: folderMatch[1] } : {}),
          })
        );
      }
    },
    [dispatch]
  );

  const handleBackdropClick = useCallback((): void => {
    if (onClose) {
      onClose();
    }
  }, [onClose]);

  return (
    <>
      {/* Backdrop pour mobile */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-[calc(var(--z-index-sidebar)-1)] lg:hidden cursor-pointer"
          style={{ top: 'var(--spacing-layout-header-height)' }}
          onClick={handleBackdropClick}
          aria-hidden="true"
        />
      )}

      <aside
        className={`
          fixed top-[var(--spacing-layout-header-height)] left-0 bottom-0
          w-[var(--spacing-layout-sidebar-width)]
          bg-[var(--color-surface)] border-r border-[var(--color-border)]
          shadow-[var(--shadow-sidebar)]
          z-[var(--z-index-sidebar)]
          transition-transform duration-200 ease-out overflow-hidden
          ${isOpen ? 'translate-x-0' : '-translate-x-full'}
          ${className || ''}
        `}
      >
        <div className="flex flex-col h-full overflow-y-auto overflow-x-hidden">
          {/* Navigation principale */}
          <nav className="p-3" role="navigation" data-tour-sidebar>
            <ul className="flex flex-col gap-0.5 list-none m-0 p-0">
              {navItems.map((item) => {
                const isActive = location.pathname === item.path;

                return (
                  <li key={item.id}>
                    <button
                      className={`
                        flex items-center gap-3 w-full px-3 py-2
                        rounded-lg text-sm font-medium
                        border-none cursor-pointer text-left select-none
                        transition-colors duration-150
                        ${
                          isActive
                            ? 'text-[var(--color-primary-700)] bg-[var(--color-primary-50)] font-semibold'
                            : 'text-[var(--color-text-secondary)] bg-transparent hover:text-[var(--color-text-primary)] hover:bg-[var(--color-hover-overlay)]'
                        }
                      `}
                      onClick={() => handleNavigate(item.path)}
                      onMouseDown={(e) => handleMiddleClick(e, item.path, item.label)}
                      aria-current={isActive ? 'page' : undefined}
                      {...(item.id === 'settings' ? { 'data-tour-settings': true } : {})}
                      {...(item.id === 'notes' ? { 'data-tour-notes': true } : {})}
                      {...(item.id === 'collections' ? { 'data-tour-collections': true } : {})}
                      {...(item.id === 'automation' ? { 'data-tour-automation': true } : {})}
                      {...(item.id === 'trash' ? { 'data-tour-trash': true } : {})}
                    >
                      <span className="inline-flex items-center justify-center shrink-0">
                        {item.icon}
                      </span>
                      <span className="flex-1 truncate">{item.label}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>

          {/* Separateur */}
          <div className="mx-3 border-t border-[var(--color-border-light)]" />

          {/* Favoris et Recents */}
          <div className="flex-1 px-3 pb-3 overflow-y-auto min-h-0">
            <FavoritesSection onItemClick={handleFavoriteClick} />
          </div>

          {/* Footer — Storage usage */}
          <StorageFooter />
        </div>
      </aside>
    </>
  );
});

export default Sidebar;
