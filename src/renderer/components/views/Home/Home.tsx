/**
 * Home View
 *
 * Vue principale style Google Drive affichant les dossiers
 */

import { useCallback, useState, useMemo, FC, MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import { Button } from '../../ui/Button';
import { ContextMenu } from '../../ui/ContextMenu';
import { PromptModal } from '../../ui/PromptModal';
import { ConfirmModal } from '../../ui/ConfirmModal';
import { ColorPickerModal } from '../../ui/ColorPickerModal';
import { ReminderModal, type ReminderData } from '../../ui/ReminderModal';
import { DeleteFolderConfirmModal } from '../../ui/DeleteFolderConfirmModal';
import useFolder from '../../../../hooks/useFolder';
import useUI from '../../../../hooks/useUI';
import useContextMenu from '../../../../hooks/useContextMenu';
import useDragAndDrop from '../../../../hooks/useDragAndDrop';
import { useNotification } from '../../ui/Notification';
import { addRecentFile } from '../../../../store/slices/favoritesSlice';
import type { Folder, Reminder, Item } from '../../../../types';
import type { AppDispatch } from '../../../../store';
import type { FolderDeletionInfo } from '../../../../hooks/useFolderOperations';
import { isProtected, isUnlockedForSession } from '../../../../services/auth/filePasswordService';
import { DashboardStats } from './DashboardStats';

// Icônes SVG pour le menu contextuel
const FolderOpenIcon: FC = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={2}
    stroke="currentColor"
    width="16"
    height="16"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 00-1.883 2.542l.857 6a2.25 2.25 0 002.227 1.932H19.05a2.25 2.25 0 002.227-1.932l.857-6a2.25 2.25 0 00-1.883-2.542m-16.5 0V6A2.25 2.25 0 016 3.75h3.879a1.5 1.5 0 011.06.44l2.122 2.12a1.5 1.5 0 001.06.44H18A2.25 2.25 0 0120.25 9v.776"
    />
  </svg>
);

const EditIcon: FC = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={2}
    stroke="currentColor"
    width="16"
    height="16"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10"
    />
  </svg>
);

const PaletteIcon: FC = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={2}
    stroke="currentColor"
    width="16"
    height="16"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M4.098 19.902a3.75 3.75 0 005.304 0l6.401-6.402M6.75 21A3.75 3.75 0 013 17.25V4.125C3 3.504 3.504 3 4.125 3h5.25c.621 0 1.125.504 1.125 1.125v4.072M6.75 21a3.75 3.75 0 003.75-3.75V8.197M6.75 21h13.125c.621 0 1.125-.504 1.125-1.125v-5.25c0-.621-.504-1.125-1.125-1.125h-4.072M10.5 8.197l2.88-2.88c.438-.439 1.15-.439 1.59 0l3.712 3.713c.44.44.44 1.152 0 1.59l-2.879 2.88M6.75 17.25h.008v.008H6.75v-.008z"
    />
  </svg>
);

const BellIcon: FC = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={2}
    stroke="currentColor"
    width="16"
    height="16"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0"
    />
  </svg>
);

const TrashIcon: FC = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={2}
    stroke="currentColor"
    width="16"
    height="16"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"
    />
  </svg>
);

/**
 * Composant Home - Style Google Drive
 */
export const Home: FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const dispatch = useDispatch<AppDispatch>();
  const { folders, addFolder, editFolder, removeFolder } = useFolder();
  const { viewMode } = useUI();
  const { contextMenu, openContextMenu, closeContextMenu } = useContextMenu();
  const { success, error } = useNotification();

  // View mode local: grid ou list
  const [localViewMode, setLocalViewMode] = useState<'grid' | 'list'>('grid');

  // Search
  const [searchQuery, setSearchQuery] = useState('');

  // Hook drag and drop
  const {
    draggedItem,
    dropTarget,
    handleDragStart,
    handleDragEnd,
    handleDragOver,
    handleDragEnter,
    handleDragLeave,
    handleDrop: handleDropItem,
  } = useDragAndDrop(
    undefined,
    (message) => success(message),
    (message) => error(message)
  );

  // États pour les modals
  const [createModalOpen, setCreateModalOpen] = useState<boolean>(false);
  const [renameModalOpen, setRenameModalOpen] = useState<boolean>(false);
  const [folderToRename, setFolderToRename] = useState<Folder | null>(null);
  const [deleteModalOpen, setDeleteModalOpen] = useState<boolean>(false);
  const [folderToDelete, setFolderToDelete] = useState<Folder | null>(null);
  const [colorModalOpen, setColorModalOpen] = useState<boolean>(false);
  const [folderToCustomize, setFolderToCustomize] = useState<Folder | null>(null);
  const [reminderModalOpen, setReminderModalOpen] = useState<boolean>(false);
  const [folderForReminder, setFolderForReminder] = useState<Folder | null>(null);
  const [folderDeleteModalOpen, setFolderDeleteModalOpen] = useState<boolean>(false);
  const [folderDeletionInfo, setFolderDeletionInfo] = useState<FolderDeletionInfo | null>(null);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);

  // Filtrer pour afficher uniquement les dossiers racine (sans parentId)
  const rootFolders = useMemo(() => {
    return folders.filter((folder) => !folder.parentId || folder.parentId === null);
  }, [folders]);

  // Filtrer par recherche
  const filteredFolders = useMemo(() => {
    if (!searchQuery.trim()) return rootFolders;
    const q = searchQuery.toLowerCase();
    return rootFolders.filter((folder) => folder.name.toLowerCase().includes(q));
  }, [rootFolders, searchQuery]);

  // Séparer les dossiers récents (les 4 derniers) et tous les dossiers
  const suggestedFolders = useMemo(() => {
    return [...rootFolders]
      .sort((a, b) => {
        const dateA = (a as any).updatedAt || (a as any).createdAt || '';
        const dateB = (b as any).updatedAt || (b as any).createdAt || '';
        return dateB.localeCompare(dateA);
      })
      .slice(0, 4);
  }, [rootFolders]);

  const handleCreateFolder = useCallback(() => {
    setCreateModalOpen(true);
  }, []);

  const handleConfirmCreate = useCallback(
    async (folderName: string) => {
      try {
        await addFolder({ name: folderName });
        success(t('home.createSuccess', 'Dossier créé avec succès'));
      } catch (err) {
        error(t('home.createError', 'Échec de la création du dossier'));
      }
    },
    [addFolder, success, error, t]
  );

  const handleOpenFolder = useCallback(
    (folderId: string) => {
      const folder = rootFolders.find((f) => f.id === folderId);
      if (folder) {
        dispatch(addRecentFile({ item: folder as any, path: `/folder/${folderId}` }));
      }
      navigate(`/folder/${folderId}`);
    },
    [navigate, rootFolders, dispatch]
  );

  const handleRenameFolder = useCallback((folder: Folder) => {
    setFolderToRename(folder);
    setRenameModalOpen(true);
  }, []);

  const handleConfirmRename = useCallback(
    async (newName: string) => {
      if (folderToRename && newName !== folderToRename.name) {
        try {
          await editFolder(folderToRename.id, { name: newName });
          success(t('home.renameSuccess', 'Dossier renommé avec succès'));
        } catch (err) {
          error(t('home.renameError', 'Échec du renommage'));
        }
      }
    },
    [folderToRename, editFolder, success, error, t]
  );

  const handleCustomizeFolder = useCallback((folder: Folder) => {
    setFolderToCustomize(folder);
    setColorModalOpen(true);
  }, []);

  const handleConfirmCustomize = useCallback(
    async (color: string) => {
      if (folderToCustomize) {
        try {
          await editFolder(folderToCustomize.id, { color });
          success(t('home.customizeSuccess', 'Couleur appliquée avec succès'));
        } catch (err) {
          error(t('home.customizeError', 'Échec de la personnalisation'));
        }
      }
    },
    [folderToCustomize, editFolder, success, error, t]
  );

  const calculateFolderInfo = useCallback((folder: Folder): { count: number; size: number } => {
    if (!folder.items || folder.items.length === 0) {
      return { count: 0, size: 0 };
    }

    let totalCount = 0;
    let totalSize = 0;

    folder.items.forEach((itemOrId) => {
      if (typeof itemOrId !== 'object' || itemOrId === null) return;
      const itemObj = itemOrId as Item;

      totalCount++;

      if ('size' in itemObj && typeof (itemObj as any).size === 'number') {
        totalSize += (itemObj as any).size;
      }

      if ('items' in itemObj && Array.isArray((itemObj as any).items)) {
        const subResult = calculateFolderInfo(itemObj as Folder);
        totalCount += subResult.count;
        totalSize += subResult.size;
      }
    });

    return { count: totalCount, size: totalSize };
  }, []);

  const handleDeleteFolder = useCallback(
    (folder: Folder) => {
      const directItems: Item[] = (folder.items || [])
        .map((itemOrId) => (typeof itemOrId === 'object' ? (itemOrId as Item) : null))
        .filter((item): item is Item => item !== null);

      if (directItems.length > 0) {
        const { count: totalItemCount, size: totalSize } = calculateFolderInfo(folder);

        const deletionInfo: FolderDeletionInfo = {
          folderName: folder.name,
          items: directItems,
          totalItemCount,
          totalSize,
          noteCount: 0,
        };

        setFolderDeletionInfo(deletionInfo);
        setFolderToDelete(folder);
        setFolderDeleteModalOpen(true);
      } else {
        setFolderToDelete(folder);
        setDeleteModalOpen(true);
      }
    },
    [calculateFolderInfo]
  );

  const handleConfirmDelete = useCallback(async () => {
    if (folderToDelete) {
      try {
        await removeFolder(folderToDelete.id);
        success(t('home.deleteSuccess', 'Dossier supprimé avec succès'));
      } catch (err) {
        error(t('home.deleteError', 'Échec de la suppression'));
      }
    }
  }, [folderToDelete, removeFolder, success, error, t]);

  const handleConfirmFolderDelete = useCallback(async () => {
    if (!folderToDelete) return;

    try {
      setIsDeleting(true);
      await removeFolder(folderToDelete.id);
      success(t('home.deleteSuccess', 'Dossier supprimé avec succès'));
      setFolderDeleteModalOpen(false);
      setFolderDeletionInfo(null);
      setFolderToDelete(null);
    } catch (err) {
      error(t('home.deleteError', 'Échec de la suppression'));
    } finally {
      setIsDeleting(false);
    }
  }, [folderToDelete, removeFolder, success, error, t]);

  const handleAddReminder = useCallback((folder: Folder) => {
    setFolderForReminder(folder);
    setReminderModalOpen(true);
  }, []);

  const handleConfirmReminder = useCallback(
    async (reminderData: ReminderData) => {
      if (folderForReminder) {
        try {
          const existingReminders: Reminder[] = (folderForReminder as any).reminders || [];

          const newReminder: Reminder = {
            id: Date.now().toString(),
            itemId: folderForReminder.id,
            itemName: folderForReminder.name,
            itemType: 'folder',
            date:
              reminderData.datetime ||
              new Date(`${reminderData.date}T${reminderData.time}`).toISOString(),
            message: reminderData.message,
          };

          const newReminders = [...existingReminders, newReminder];

          await editFolder(folderForReminder.id, { reminders: newReminders } as any);
          success(t('home.reminderSuccess', 'Rappel ajouté avec succès'));
        } catch (err) {
          error(t('home.reminderError', "Échec de l'ajout du rappel"));
        }
      }
    },
    [folderForReminder, editFolder, success, error, t]
  );

  const handleFolderContextMenu = useCallback(
    (e: MouseEvent<HTMLDivElement>, folder: Folder) => {
      openContextMenu(e as any, [
        {
          label: t('contextMenu.open', 'Ouvrir'),
          icon: <FolderOpenIcon />,
          onClick: () => {
            handleOpenFolder(folder.id);
            closeContextMenu();
          },
        },
        {
          label: t('contextMenu.rename', 'Renommer'),
          icon: <EditIcon />,
          onClick: () => {
            handleRenameFolder(folder);
            closeContextMenu();
          },
        },
        {
          label: t('contextMenu.customize', 'Personnaliser'),
          icon: <PaletteIcon />,
          onClick: () => {
            handleCustomizeFolder(folder);
            closeContextMenu();
          },
        },
        {
          label: t('contextMenu.addReminder', 'Ajouter un rappel'),
          icon: <BellIcon />,
          onClick: () => {
            handleAddReminder(folder);
            closeContextMenu();
          },
        },
        { divider: true },
        {
          label: t('contextMenu.delete', 'Supprimer'),
          icon: <TrashIcon />,
          onClick: () => {
            handleDeleteFolder(folder);
            closeContextMenu();
          },
          danger: true,
          shortcut: 'Suppr',
        },
      ]);
    },
    [
      openContextMenu,
      closeContextMenu,
      handleOpenFolder,
      handleRenameFolder,
      handleCustomizeFolder,
      handleAddReminder,
      handleDeleteFolder,
      t,
    ]
  );

  return (
    <div className="flex flex-col w-full min-h-full bg-[var(--color-background-secondary)]">
      {/* ===== Welcome banner with subtle background ===== */}
      <div className="bg-[var(--color-surface)] border-b border-[var(--color-border-light)] px-6 py-6">
        <div className="max-w-[1400px] mx-auto">
          <h1 className="text-2xl font-normal text-[var(--color-text-primary)] mb-1">
            {t('home.welcome', 'Bienvenue dans Filarr')}
          </h1>
          <p className="text-sm text-[var(--color-text-tertiary)]">
            {t('home.subtitle', 'Gérez vos fichiers de manière simple et sécurisée')}
          </p>
        </div>
      </div>

      <div className="max-w-[1400px] mx-auto w-full px-6 py-6 flex flex-col gap-6">
        {/* ===== Dashboard Stats ===== */}
        <DashboardStats />

        {/* ===== Dossiers suggérés (horizontal cards like Google Drive) ===== */}
        {suggestedFolders.length > 0 && !searchQuery && (
          <section>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)] mb-3 flex items-center gap-2">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
                className="w-4 h-4"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 00-1.883 2.542l.857 6a2.25 2.25 0 002.227 1.932H19.05a2.25 2.25 0 002.227-1.932l.857-6a2.25 2.25 0 00-1.883-2.542m-16.5 0V6A2.25 2.25 0 016 3.75h3.879a1.5 1.5 0 011.06.44l2.122 2.12a1.5 1.5 0 001.06.44H18A2.25 2.25 0 0120.25 9v.776"
                />
              </svg>
              {t('home.suggestedFolders', 'Dossiers suggérés')}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {suggestedFolders.map((folder) => (
                <div
                  key={`suggested-${folder.id}`}
                  onClick={() => handleOpenFolder(folder.id)}
                  onContextMenu={(e) => handleFolderContextMenu(e, folder)}
                  className="flex items-center gap-3 px-4 py-3 rounded-xl cursor-pointer
                    bg-[var(--color-surface)] border border-[var(--color-border)]
                    shadow-sm hover:shadow-md hover:border-[var(--color-primary-200)]
                    transition-all duration-150 select-none group"
                >
                  <div
                    className="shrink-0 w-10 h-10 rounded-lg flex items-center justify-center"
                    style={{
                      backgroundColor: folder.color
                        ? `${folder.color}20`
                        : 'var(--color-primary-50)',
                    }}
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      fill={folder.color || 'var(--color-primary-500)'}
                      viewBox="0 0 24 24"
                      className="w-5 h-5"
                    >
                      <path d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
                    </svg>
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
                      handleFolderContextMenu(e as any, folder);
                    }}
                    className="opacity-0 group-hover:opacity-100 shrink-0 p-1 rounded-full
                      hover:bg-[var(--color-background-secondary)] transition-opacity duration-150"
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
              ))}
            </div>
          </section>
        )}

        {/* ===== Tous les dossiers (main section) ===== */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)]">
              {searchQuery
                ? t('home.searchResults', 'Résultats de recherche')
                : t('home.allFolders', 'Tous les dossiers')}
            </h2>
            <div className="flex items-center gap-1">
              {/* View mode toggle */}
              <div className="flex items-center bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg p-0.5 mr-2">
                <button
                  onClick={() => setLocalViewMode('list')}
                  className={`p-1.5 rounded-md transition-all duration-150
                    ${
                      localViewMode === 'list'
                        ? 'bg-[var(--color-primary-50)] text-[var(--color-primary-600)] shadow-sm'
                        : 'text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]'
                    }`}
                  title={t('home.listView', 'Vue liste')}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={2}
                    stroke="currentColor"
                    className="w-4 h-4"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5"
                    />
                  </svg>
                </button>
                <button
                  onClick={() => setLocalViewMode('grid')}
                  className={`p-1.5 rounded-md transition-all duration-150
                    ${
                      localViewMode === 'grid'
                        ? 'bg-[var(--color-primary-50)] text-[var(--color-primary-600)] shadow-sm'
                        : 'text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]'
                    }`}
                  title={t('home.gridView', 'Vue grille')}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={2}
                    stroke="currentColor"
                    className="w-4 h-4"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z"
                    />
                  </svg>
                </button>
              </div>

              {/* New folder button */}
              <Button
                variant="primary"
                size="sm"
                data-tour-new
                onClick={handleCreateFolder}
                leftIcon={
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={2}
                    stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                  </svg>
                }
              >
                {t('home.newFolder', 'Nouveau')}
              </Button>
            </div>
          </div>

          {/* Empty state */}
          {filteredFolders.length === 0 ? (
            <div
              className="flex flex-col items-center justify-center py-20 text-center
              bg-[var(--color-surface)] rounded-2xl border border-[var(--color-border)] shadow-sm"
            >
              <div className="w-24 h-24 rounded-full bg-[var(--color-primary-50)] flex items-center justify-center mb-6">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1}
                  stroke="var(--color-primary-400)"
                  className="w-12 h-12"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z"
                  />
                </svg>
              </div>
              {searchQuery ? (
                <>
                  <h3 className="text-lg font-medium text-[var(--color-text-primary)] mb-2">
                    {t('home.noResults', 'Aucun résultat')}
                  </h3>
                  <p className="text-sm text-[var(--color-text-secondary)] max-w-md">
                    {t('home.noResultsText', 'Aucun dossier ne correspond à votre recherche.')}
                  </p>
                </>
              ) : (
                <>
                  <h3 className="text-lg font-medium text-[var(--color-text-primary)] mb-2">
                    {t('home.emptyTitle', 'Aucun dossier')}
                  </h3>
                  <p className="text-sm text-[var(--color-text-secondary)] max-w-md mb-6">
                    {t(
                      'home.emptyText',
                      'Créez votre premier dossier pour commencer à organiser vos fichiers'
                    )}
                  </p>
                  <Button variant="primary" size="md" onClick={handleCreateFolder}>
                    {t('home.createFirst', 'Créer mon premier dossier')}
                  </Button>
                </>
              )}
            </div>
          ) : localViewMode === 'grid' ? (
            /* ===== Grid View (Google Drive file cards) ===== */
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
              {filteredFolders.map((folder) => (
                <div
                  key={folder.id}
                  onClick={() => handleOpenFolder(folder.id)}
                  onContextMenu={(e) => handleFolderContextMenu(e, folder)}
                  draggable
                  onDragStart={(e) => handleDragStart(e, folder)}
                  onDragEnd={handleDragEnd}
                  onDragOver={(e) => handleDragOver(e, folder.id)}
                  onDragEnter={(e) => handleDragEnter(e, folder.id)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDropItem(e, folder.id, '')}
                  className={`group relative rounded-xl border cursor-pointer select-none
                    transition-all duration-200 overflow-hidden
                    bg-[var(--color-surface)] border-[var(--color-border)] shadow-sm
                    hover:shadow-lg hover:border-[var(--color-primary-200)] hover:-translate-y-0.5
                    ${dropTarget === folder.id ? 'ring-2 ring-[var(--color-primary-400)] border-dashed border-[var(--color-primary-400)]' : ''}
                    ${draggedItem?.id === folder.id ? 'opacity-50 scale-95' : ''}`}
                >
                  {/* Thumbnail / preview area */}
                  <div
                    className="h-[120px] flex items-center justify-center"
                    style={{
                      backgroundColor: folder.color
                        ? `${folder.color}15`
                        : 'var(--color-background-secondary)',
                    }}
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      fill={folder.color || 'var(--color-primary-400)'}
                      viewBox="0 0 24 24"
                      className="w-14 h-14 opacity-50"
                    >
                      <path d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
                    </svg>
                  </div>

                  {/* Info bar */}
                  <div className="flex items-center gap-3 px-3 py-2.5 bg-[var(--color-surface)] border-t border-[var(--color-border-light)]">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      fill={folder.color || 'var(--color-primary-500)'}
                      viewBox="0 0 24 24"
                      className="w-5 h-5 shrink-0"
                    >
                      <path d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
                    </svg>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-[var(--color-text-primary)] truncate">
                        {folder.name}
                      </p>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleFolderContextMenu(e as any, folder);
                      }}
                      className="opacity-0 group-hover:opacity-100 p-1 rounded-full
                        hover:bg-[var(--color-background-secondary)] transition-opacity duration-150"
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

                  {/* Badges */}
                  <div className="absolute top-2 right-2 flex items-center gap-1.5">
                    {isProtected(folder.id) && (
                      <div
                        className={`flex items-center justify-center w-6 h-6 rounded-full shadow-sm
                        ${
                          isUnlockedForSession(folder.id)
                            ? 'bg-green-500/90 text-white'
                            : 'bg-[var(--color-text-secondary)]/90 text-white'
                        }`}
                        title={
                          isUnlockedForSession(folder.id)
                            ? t('password.unlockedSession')
                            : t('password.protected')
                        }
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          fill="none"
                          viewBox="0 0 24 24"
                          strokeWidth={2.5}
                          stroke="currentColor"
                          className="w-3 h-3"
                        >
                          {isUnlockedForSession(folder.id) ? (
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
                      </div>
                    )}
                    {(folder as any).reminders && (folder as any).reminders.length > 0 && (
                      <div className="bg-amber-500 text-white text-xs font-medium px-2 py-0.5 rounded-full flex items-center gap-1 shadow-sm">
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          fill="none"
                          viewBox="0 0 24 24"
                          strokeWidth={2}
                          stroke="currentColor"
                          className="w-3 h-3"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0"
                          />
                        </svg>
                        {(folder as any).reminders.length}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            /* ===== List View ===== */
            <div className="flex flex-col rounded-xl border border-[var(--color-border)] overflow-hidden bg-[var(--color-surface)] shadow-sm">
              {filteredFolders.map((folder, index) => (
                <div
                  key={folder.id}
                  onClick={() => handleOpenFolder(folder.id)}
                  onContextMenu={(e) => handleFolderContextMenu(e, folder)}
                  draggable
                  onDragStart={(e) => handleDragStart(e, folder)}
                  onDragEnd={handleDragEnd}
                  onDragOver={(e) => handleDragOver(e, folder.id)}
                  onDragEnter={(e) => handleDragEnter(e, folder.id)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDropItem(e, folder.id, '')}
                  className={`group flex items-center gap-4 px-4 py-3 cursor-pointer select-none
                    transition-colors duration-100
                    hover:bg-[var(--color-background-secondary)]
                    ${index !== 0 ? 'border-t border-[var(--color-border-light)]' : ''}
                    ${dropTarget === folder.id ? 'ring-2 ring-inset ring-[var(--color-primary-400)]' : ''}
                    ${draggedItem?.id === folder.id ? 'opacity-50' : ''}`}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill={folder.color || 'var(--color-primary-500)'}
                    viewBox="0 0 24 24"
                    className="w-6 h-6 shrink-0"
                  >
                    <path d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
                  </svg>
                  <span className="flex-1 text-sm text-[var(--color-text-primary)] truncate font-medium flex items-center gap-1.5">
                    {folder.name}
                    {isProtected(folder.id) && (
                      <span
                        className={`shrink-0 ${isUnlockedForSession(folder.id) ? 'text-green-500' : 'text-[var(--color-text-tertiary)]'}`}
                        title={
                          isUnlockedForSession(folder.id)
                            ? t('password.unlockedSession')
                            : t('password.protected')
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
                          {isUnlockedForSession(folder.id) ? (
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
                  </span>
                  <span className="text-xs text-[var(--color-text-tertiary)] hidden sm:inline">
                    {folder.items?.length || 0} {t('home.items', 'élément(s)')}
                  </span>
                  {(folder as any).reminders && (folder as any).reminders.length > 0 && (
                    <span className="text-xs text-amber-500 flex items-center gap-1">
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                        strokeWidth={2}
                        stroke="currentColor"
                        className="w-3.5 h-3.5"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0"
                        />
                      </svg>
                      {(folder as any).reminders.length}
                    </span>
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleFolderContextMenu(e as any, folder);
                    }}
                    className="opacity-0 group-hover:opacity-100 p-1 rounded-full
                      hover:bg-[var(--color-background-secondary)] transition-opacity duration-150"
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
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Context Menu */}
      {contextMenu.isOpen && (
        <ContextMenu
          items={contextMenu.items}
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={closeContextMenu}
        />
      )}

      {/* Modal création de dossier */}
      <PromptModal
        isOpen={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        onSubmit={handleConfirmCreate}
        title={t('home.newFolderTitle', 'Nouveau dossier')}
        label={t('home.newFolderLabel', 'Nom du dossier')}
        placeholder={t('home.newFolderPlaceholder', 'Ex: Documents')}
        submitText={t('common.create', 'Créer')}
        cancelText={t('common.cancel', 'Annuler')}
      />

      {/* Modal renommage de dossier */}
      <PromptModal
        isOpen={renameModalOpen}
        onClose={() => {
          setRenameModalOpen(false);
          setFolderToRename(null);
        }}
        onSubmit={handleConfirmRename}
        title={t('home.renameTitle', 'Renommer le dossier')}
        label={t('home.renameLabel', 'Nouveau nom')}
        defaultValue={folderToRename?.name || ''}
        submitText={t('common.rename', 'Renommer')}
        cancelText={t('common.cancel', 'Annuler')}
      />

      {/* Modal confirmation de suppression simple */}
      <ConfirmModal
        isOpen={deleteModalOpen}
        onClose={() => {
          setDeleteModalOpen(false);
          setFolderToDelete(null);
        }}
        onConfirm={handleConfirmDelete}
        title={t('home.deleteTitle', 'Supprimer le dossier')}
        message={
          folderToDelete
            ? t(
                'home.deleteConfirm',
                `Êtes-vous sûr de vouloir supprimer le dossier "${folderToDelete.name}" ? Cette action est irréversible.`
              )
            : ''
        }
        confirmText={t('common.delete', 'Supprimer')}
        cancelText={t('common.cancel', 'Annuler')}
        variant="danger"
      />

      {/* Modal confirmation de suppression détaillée */}
      {folderDeletionInfo && (
        <DeleteFolderConfirmModal
          isOpen={folderDeleteModalOpen}
          onClose={() => {
            setFolderDeleteModalOpen(false);
            setFolderDeletionInfo(null);
            setFolderToDelete(null);
          }}
          onConfirm={handleConfirmFolderDelete}
          folderName={folderDeletionInfo.folderName}
          items={folderDeletionInfo.items}
          totalItemCount={folderDeletionInfo.totalItemCount}
          totalSize={folderDeletionInfo.totalSize}
          isDeleting={isDeleting}
        />
      )}

      {/* Modal personnalisation de couleur */}
      <ColorPickerModal
        isOpen={colorModalOpen}
        onClose={() => {
          setColorModalOpen(false);
          setFolderToCustomize(null);
        }}
        onSubmit={handleConfirmCustomize}
        defaultColor={folderToCustomize?.color}
        title={t('home.customizeTitle', 'Personnaliser la couleur')}
      />

      {/* Modal ajout de rappel */}
      <ReminderModal
        isOpen={reminderModalOpen}
        onClose={() => {
          setReminderModalOpen(false);
          setFolderForReminder(null);
        }}
        onSubmit={handleConfirmReminder}
        title={t('home.reminderTitle', 'Ajouter un rappel')}
        itemName={folderForReminder?.name}
      />
    </div>
  );
};

export default Home;
