/**
 * useCommandPalette Hook
 *
 * Hook React pour la gestion de la palette de commandes.
 * Gère les commandes, la recherche fuzzy, l'historique et les catégories.
 * Intégré avec Redux pour les actions et shortcutsService pour les raccourcis.
 */

import { useState, useCallback, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector, useDispatch } from 'react-redux';
import profileStorage from '../services/core/profileStorage';
import { useNavigate } from 'react-router-dom';
import type { RootState, AppDispatch } from '../store';
import type { FileItem, Folder } from '../types';
import shortcutsService from '../services/platform/shortcutsService';
import { setCurrentFolder } from '../store/slices/foldersSlice';
import { toggleSidebar, setViewMode, setTheme, openModal } from '../store/slices/uiSlice';
import { showWidget as showPomodoroWidget } from '../store/slices/pomodoroSlice';
import { selectFavorites, selectRecentFiles, addRecentFile } from '../store/slices/favoritesSlice';

// Types pour les commandes
export type CommandCategory = 'files' | 'actions' | 'settings' | 'navigation' | 'recent';

export interface Command {
  id: string;
  name: string;
  description?: string;
  category: CommandCategory;
  icon?: string;
  shortcut?: string[];
  action: () => void;
  keywords?: string[];
  priority?: number;
}

export interface CommandPaletteState {
  isOpen: boolean;
  query: string;
  selectedIndex: number;
}

// Clé de stockage pour l'historique
const HISTORY_STORAGE_KEY = 'filarr_command_palette_history';
const MAX_HISTORY_ITEMS = 20;

// Icônes SVG pour les catégories
const CATEGORY_ICONS: Record<CommandCategory, string> = {
  files: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`,
  actions: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,
  settings: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`,
  navigation: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>`,
  recent: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
};

// Category names are now resolved via i18n inside the hook (see getCategoryName)

/**
 * Hook pour la palette de commandes
 */
export function useCommandPalette() {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [recentCommands, setRecentCommands] = useState<Command[]>([]);
  const [customCommands, setCustomCommands] = useState<Command[]>([]);

  // Redux hooks
  const dispatch = useDispatch<AppDispatch>();
  const navigate = useNavigate();

  // Récupérer les fichiers et dossiers depuis le store
  const files = useSelector((state: RootState) => state.files.byId);
  const folders = useSelector((state: RootState) => state.folders.byId);
  const currentFolderId = useSelector((state: RootState) => state.folders.currentFolderId);
  const viewMode = useSelector((state: RootState) => state.ui.viewMode);
  const theme = useSelector((state: RootState) => state.ui.theme);

  // Get favorites and recent files from store
  const favorites = useSelector(selectFavorites);
  const recentFiles = useSelector(selectRecentFiles);

  // Helper to get shortcut display for a command action
  const getShortcutForAction = useCallback((action: string): string[] | undefined => {
    const shortcut = shortcutsService.getAllShortcuts().find((s) => s.action === action);
    return shortcut?.keys;
  }, []);

  // Charger l'historique au montage
  useEffect(() => {
    try {
      const saved = profileStorage.getItem(HISTORY_STORAGE_KEY);
      if (saved) {
        const history = JSON.parse(saved) as string[];
        // Reconstituer les commandes récentes à partir des IDs
        const commands = history
          .map((id) => getDefaultCommands().find((cmd) => cmd.id === id))
          .filter((cmd): cmd is Command => cmd !== undefined)
          .slice(0, MAX_HISTORY_ITEMS);
        setRecentCommands(commands);
      }
    } catch (error) {
      console.error("Erreur lors du chargement de l'historique:", error);
    }
  }, []);

  // Commandes par défaut - Wired to Redux actions
  const getDefaultCommands = useCallback((): Command[] => {
    const commands: Command[] = [
      // Actions
      {
        id: 'action-new-file',
        name: t('commandPalette.commands.newFile'),
        description: t('commandPalette.commands.newFileDesc'),
        category: 'actions',
        shortcut: getShortcutForAction('file:new') || ['Ctrl', 'N'],
        keywords: ['créer', 'ajouter', 'file', 'new'],
        priority: 10,
        action: () => {
          dispatch(openModal({ type: 'newFile', props: { folderId: currentFolderId } }));
        },
      },
      {
        id: 'action-new-folder',
        name: t('commandPalette.commands.newFolder'),
        description: t('commandPalette.commands.newFolderDesc'),
        category: 'actions',
        shortcut: getShortcutForAction('folder:new') || ['Ctrl', 'Shift', 'N'],
        keywords: ['créer', 'ajouter', 'folder', 'new'],
        priority: 10,
        action: () => {
          dispatch(openModal({ type: 'newFolder', props: { parentId: currentFolderId } }));
        },
      },
      {
        id: 'action-delete',
        name: t('commandPalette.commands.delete'),
        description: t('commandPalette.commands.deleteDesc'),
        category: 'actions',
        shortcut: getShortcutForAction('item:delete') || ['Ctrl', 'D'],
        keywords: ['effacer', 'remove', 'delete', 'trash'],
        priority: 8,
        action: () => {
          dispatch(openModal({ type: 'deleteConfirmation', props: {} }));
        },
      },
      {
        id: 'action-rename',
        name: t('commandPalette.commands.rename'),
        description: t('commandPalette.commands.renameDesc'),
        category: 'actions',
        shortcut: getShortcutForAction('item:rename') || ['Ctrl', 'R'],
        keywords: ['modifier', 'edit', 'name'],
        priority: 8,
        action: () => {
          dispatch(openModal({ type: 'rename', props: {} }));
        },
      },
      {
        id: 'action-copy',
        name: t('commandPalette.commands.copy'),
        description: t('commandPalette.commands.copyDesc'),
        category: 'actions',
        shortcut: getShortcutForAction('edit:copy') || ['Ctrl', 'C'],
        keywords: ['dupliquer', 'duplicate'],
        priority: 7,
        action: () => {
          // Trigger copy action via shortcut service
          const shortcut = shortcutsService.getShortcut('copy');
          if (shortcut) shortcutsService.trigger(shortcut);
        },
      },
      {
        id: 'action-paste',
        name: t('commandPalette.commands.paste'),
        description: t('commandPalette.commands.pasteDesc'),
        category: 'actions',
        shortcut: getShortcutForAction('edit:paste') || ['Ctrl', 'V'],
        keywords: ['paste'],
        priority: 7,
        action: () => {
          // Trigger paste action via shortcut service
          const shortcut = shortcutsService.getShortcut('paste');
          if (shortcut) shortcutsService.trigger(shortcut);
        },
      },
      {
        id: 'action-cut',
        name: t('commandPalette.commands.cut'),
        description: t('commandPalette.commands.cutDesc'),
        category: 'actions',
        shortcut: getShortcutForAction('edit:cut') || ['Ctrl', 'X'],
        keywords: ['move', 'déplacer'],
        priority: 7,
        action: () => {
          // Trigger cut action via shortcut service
          const shortcut = shortcutsService.getShortcut('cut');
          if (shortcut) shortcutsService.trigger(shortcut);
        },
      },
      {
        id: 'action-select-all',
        name: t('commandPalette.commands.selectAll'),
        description: t('commandPalette.commands.selectAllDesc'),
        category: 'actions',
        shortcut: getShortcutForAction('edit:select-all') || ['Ctrl', 'A'],
        keywords: ['select all', 'sélection'],
        priority: 6,
        action: () => {
          // Trigger select all action via shortcut service
          const shortcut = shortcutsService.getShortcut('select-all');
          if (shortcut) shortcutsService.trigger(shortcut);
        },
      },
      {
        id: 'action-focus-timer',
        name: t('commandPalette.commands.focusTimer', 'Focus timer'),
        description: t('commandPalette.commands.focusTimerDesc', 'Open the Pomodoro focus timer'),
        category: 'actions',
        keywords: ['pomodoro', 'focus', 'timer', 'concentration'],
        priority: 6,
        action: () => {
          dispatch(showPomodoroWidget());
        },
      },
      {
        id: 'action-refresh',
        name: t('commandPalette.commands.refresh'),
        description: t('commandPalette.commands.refreshDesc'),
        category: 'actions',
        shortcut: getShortcutForAction('system:refresh') || ['F5'],
        keywords: ['reload', 'actualiser'],
        priority: 5,
        action: () => {
          window.location.reload();
        },
      },

      // Navigation
      {
        id: 'nav-home',
        name: t('tabs.home'),
        description: t('tabs.home'),
        category: 'navigation',
        shortcut: getShortcutForAction('navigation:home') || ['Alt', 'Home'],
        keywords: ['home', 'root', 'racine'],
        priority: 9,
        action: () => {
          dispatch(setCurrentFolder(null));
          navigate('/');
        },
      },
      {
        id: 'nav-notes',
        name: t('notes.title', 'Notes'),
        description: t('notes.title', 'Notes'),
        category: 'navigation',
        shortcut: ['Ctrl', 'Shift', 'N'],
        keywords: ['notes', 'note', 'write', 'markdown', 'knowledge'],
        priority: 9,
        action: () => {
          navigate('/notes');
        },
      },
      {
        id: 'note-daily',
        name: t('notes.dailyNote', 'Daily Note'),
        description: t('notes.dailyNote', 'Daily Note'),
        category: 'actions',
        shortcut: ['Ctrl', 'Shift', 'D'],
        keywords: ['daily', 'journal', 'today', 'quotidien'],
        priority: 8,
        action: () => {
          navigate('/notes');
          // The daily note creation will be handled by the NotesView
        },
      },
      {
        id: 'nav-back',
        name: t('commandPalette.commands.back'),
        description: t('commandPalette.commands.backDesc'),
        category: 'navigation',
        shortcut: getShortcutForAction('navigation:back') || ['Alt', 'Left'],
        keywords: ['back', 'previous', 'précédent'],
        priority: 9,
        action: () => {
          navigate(-1);
        },
      },
      {
        id: 'nav-forward',
        name: t('commandPalette.commands.forward'),
        description: t('commandPalette.commands.forwardDesc'),
        category: 'navigation',
        shortcut: getShortcutForAction('navigation:forward') || ['Alt', 'Right'],
        keywords: ['forward', 'next'],
        priority: 9,
        action: () => {
          navigate(1);
        },
      },
      {
        id: 'nav-parent',
        name: t('commandPalette.commands.parentFolder'),
        description: t('commandPalette.commands.parentFolderDesc'),
        category: 'navigation',
        shortcut: getShortcutForAction('navigation:parent') || ['Alt', 'Up'],
        keywords: ['parent', 'up', 'remonter'],
        priority: 9,
        action: () => {
          if (currentFolderId) {
            const currentFolder = folders[currentFolderId];
            if (currentFolder?.parentId) {
              dispatch(setCurrentFolder(currentFolder.parentId));
              navigate(`/folder/${currentFolder.parentId}`);
            } else {
              dispatch(setCurrentFolder(null));
              navigate('/');
            }
          }
        },
      },
      {
        id: 'nav-calendar',
        name: t('commandPalette.commands.calendar'),
        description: t('commandPalette.commands.calendarDesc'),
        category: 'navigation',
        keywords: ['calendar', 'date', 'rappels'],
        priority: 8,
        action: () => {
          navigate('/calendar');
        },
      },
      {
        id: 'nav-trash',
        name: t('commandPalette.commands.trash'),
        description: t('commandPalette.commands.trashDesc'),
        category: 'navigation',
        keywords: ['trash', 'delete', 'supprimé'],
        priority: 8,
        action: () => {
          navigate('/trash');
        },
      },
      // Password Manager — disabled until v2.x
      // { id: 'nav-passwords', ... },
      // { id: 'nav-password-generator', ... },

      // Settings
      {
        id: 'settings-general',
        name: t('commandPalette.commands.generalSettings'),
        description: t('commandPalette.commands.generalSettingsDesc'),
        category: 'settings',
        shortcut: getShortcutForAction('system:settings') || ['Ctrl', ','],
        keywords: ['options', 'préférences', 'configuration'],
        priority: 8,
        action: () => {
          navigate('/settings');
        },
      },
      // Keyboard shortcuts panel — disabled until Settings tab is built
      // { id: 'settings-shortcuts', navigate('/settings?tab=shortcuts') },
      {
        id: 'settings-theme-light',
        name: t('commandPalette.commands.lightTheme'),
        description: t('commandPalette.commands.lightThemeDesc'),
        category: 'settings',
        keywords: ['light', 'lumineux', 'white'],
        priority: 6,
        action: () => {
          dispatch(setTheme('light'));
        },
      },
      {
        id: 'settings-theme-dark',
        name: t('commandPalette.commands.darkTheme'),
        description: t('commandPalette.commands.darkThemeDesc'),
        category: 'settings',
        keywords: ['dark', 'noir', 'black'],
        priority: 6,
        action: () => {
          dispatch(setTheme('dark'));
        },
      },
      {
        id: 'settings-view-grid',
        name: t('commandPalette.commands.gridView'),
        description: t('commandPalette.commands.gridViewDesc'),
        category: 'settings',
        keywords: ['grid', 'cards', 'cartes'],
        priority: 5,
        action: () => {
          dispatch(setViewMode('grid'));
        },
      },
      {
        id: 'settings-view-list',
        name: t('commandPalette.commands.listView'),
        description: t('commandPalette.commands.listViewDesc'),
        category: 'settings',
        keywords: ['list', 'lignes', 'rows'],
        priority: 5,
        action: () => {
          dispatch(setViewMode('list'));
        },
      },
      {
        id: 'settings-toggle-sidebar',
        name: t('commandPalette.commands.toggleSidebar'),
        description: t('commandPalette.commands.toggleSidebarDesc'),
        category: 'settings',
        shortcut: getShortcutForAction('view:toggle-sidebar') || ['Ctrl', 'B'],
        keywords: ['sidebar', 'panel', 'panneau'],
        priority: 5,
        action: () => {
          dispatch(toggleSidebar());
        },
      },
      {
        id: 'settings-security',
        name: t('commandPalette.commands.security'),
        description: t('commandPalette.commands.securityDesc'),
        category: 'settings',
        keywords: ['security', 'encryption', 'password', 'mot de passe'],
        priority: 4,
        action: () => {
          navigate('/settings?tab=security');
        },
      },

      // Extended navigation — feature pages
      {
        id: 'nav-file-requests',
        name: t('commandPalette.commands.fileRequests'),
        description: t('commandPalette.commands.fileRequestsDesc'),
        category: 'navigation',
        keywords: ['file request', 'upload link', 'demande', 'lien'],
        priority: 7,
        action: () => {
          navigate('/file-requests');
        },
      },
      {
        id: 'nav-data-rooms',
        name: t('commandPalette.commands.dataRooms'),
        description: t('commandPalette.commands.dataRoomsDesc'),
        category: 'navigation',
        keywords: ['data room', 'secure', 'sécurisé', 'NDA'],
        priority: 7,
        action: () => {
          navigate('/data-rooms');
        },
      },
      {
        id: 'nav-vault',
        name: t('commandPalette.commands.vault'),
        description: t('commandPalette.commands.vaultDesc'),
        category: 'navigation',
        keywords: ['vault', 'coffre', 'chiffré', 'encrypted', 'secret'],
        priority: 7,
        action: () => {
          navigate('/vault');
        },
      },
      {
        id: 'nav-collections',
        name: t('commandPalette.commands.collections'),
        description: t('commandPalette.commands.collectionsDesc'),
        category: 'navigation',
        keywords: ['collection', 'groupe', 'tag', 'étiquette'],
        priority: 6,
        action: () => {
          navigate('/collections');
        },
      },
      {
        id: 'nav-automation',
        name: t('commandPalette.commands.automation'),
        description: t('commandPalette.commands.automationDesc'),
        category: 'navigation',
        keywords: ['automation', 'règle', 'auto', 'workflow'],
        priority: 6,
        action: () => {
          navigate('/automation');
        },
      },
      {
        id: 'nav-timeline',
        name: t('commandPalette.commands.timeline'),
        description: t('commandPalette.commands.timelineDesc'),
        category: 'navigation',
        keywords: ['timeline', 'historique', 'activity', 'journal'],
        priority: 6,
        action: () => {
          navigate('/timeline');
        },
      },
      {
        id: 'nav-duplicates',
        name: t('commandPalette.commands.duplicates'),
        description: t('commandPalette.commands.duplicatesDesc'),
        category: 'navigation',
        keywords: ['duplicate', 'doublon', 'copie', 'identique'],
        priority: 6,
        action: () => {
          navigate('/duplicates');
        },
      },
      {
        id: 'nav-admin',
        name: t('commandPalette.commands.admin'),
        description: t('commandPalette.commands.adminDesc'),
        category: 'navigation',
        keywords: ['admin', 'administration', 'gestion', 'manage'],
        priority: 7,
        action: () => {
          navigate('/admin');
        },
      },
      {
        id: 'nav-share-links',
        name: t('commandPalette.commands.shareLinks'),
        description: t('commandPalette.commands.shareLinksDesc'),
        category: 'navigation',
        keywords: ['share', 'link', 'partage', 'lien', 'public'],
        priority: 6,
        action: () => {
          navigate('/share-links');
        },
      },
      {
        id: 'nav-api-keys',
        name: t('commandPalette.commands.apiKeys'),
        description: t('commandPalette.commands.apiKeysDesc'),
        category: 'navigation',
        keywords: ['api', 'key', 'clé', 'token', 'access'],
        priority: 5,
        action: () => {
          navigate('/api-keys');
        },
      },
      {
        id: 'nav-msp-portal',
        name: t('commandPalette.commands.mspPortal'),
        description: t('commandPalette.commands.mspPortalDesc'),
        category: 'navigation',
        keywords: ['msp', 'tenant', 'multi', 'organisation', 'portal'],
        priority: 5,
        action: () => {
          navigate('/msp-portal');
        },
      },
      {
        id: 'nav-permissions',
        name: t('commandPalette.commands.permissions'),
        description: t('commandPalette.commands.permissionsDesc'),
        category: 'navigation',
        keywords: ['permission', 'role', 'droit', 'accès', 'matrix'],
        priority: 5,
        action: () => {
          navigate('/permissions');
        },
      },
    ];

    return commands;
  }, [dispatch, navigate, currentFolderId, folders, getShortcutForAction, t]);

  // Commandes de fichiers générées à partir du store
  const fileCommands = useMemo((): Command[] => {
    const commands: Command[] = [];

    // Ajouter les dossiers
    Object.values(folders).forEach((folder: Folder) => {
      commands.push({
        id: `file-folder-${folder.id}`,
        name: folder.name,
        description: t('commandPalette.fileItem.folder'),
        category: 'files',
        icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`,
        keywords: ['folder', 'dossier'],
        priority: 5,
        action: () => {
          dispatch(setCurrentFolder(folder.id));
          navigate(`/folder/${folder.id}`);
          // Track as recent
          dispatch(addRecentFile({ item: folder as any }));
        },
      });
    });

    // Ajouter les fichiers
    Object.values(files).forEach((file: FileItem) => {
      const extension = file.name.split('.').pop()?.toLowerCase() || '';
      const fileIcon = getFileIcon(extension);

      commands.push({
        id: `file-item-${file.id}`,
        name: file.name,
        description: `${file.type || t('commandPalette.fileItem.file')} - ${formatFileSize(file.size)}`,
        category: 'files',
        icon: fileIcon,
        keywords: ['file', 'fichier', extension],
        priority: 4,
        action: () => {
          // Open file preview modal
          dispatch(
            openModal({
              type: 'filePreview',
              props: { fileId: file.id, fileName: file.name },
            })
          );
          // Track as recent
          dispatch(addRecentFile({ item: file as any }));
        },
      });
    });

    return commands;
  }, [files, folders, dispatch, navigate]);

  // Commands from favorites
  const favoriteCommands = useMemo((): Command[] => {
    return favorites.map((fav, index) => ({
      id: `favorite-${fav.id}`,
      name: fav.name,
      description: t('commandPalette.fileItem.favorite', {
        shortcut: fav.shortcutKey ? `(Ctrl+${fav.shortcutKey})` : '',
      }),
      category: 'navigation' as CommandCategory,
      icon:
        fav.itemType === 'folder'
          ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`
          : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`,
      shortcut: fav.shortcutKey ? ['Ctrl', String(fav.shortcutKey)] : undefined,
      keywords: ['favorite', 'favori', 'épinglé'],
      priority: 10 - index,
      action: () => {
        if (fav.itemType === 'folder') {
          dispatch(setCurrentFolder(fav.itemId));
          navigate(`/folder/${fav.itemId}`);
        } else {
          dispatch(
            openModal({
              type: 'filePreview',
              props: { fileId: fav.itemId, fileName: fav.name },
            })
          );
        }
      },
    }));
  }, [favorites, dispatch, navigate]);

  // Commands from recent files
  const recentFileCommands = useMemo((): Command[] => {
    return recentFiles.slice(0, 10).map((recent, index) => ({
      id: `recent-${recent.id}`,
      name: recent.name,
      description: t('commandPalette.fileItem.accessedTimes', { count: recent.accessCount }),
      category: 'recent' as CommandCategory,
      icon:
        recent.itemType === 'folder'
          ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`
          : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`,
      keywords: ['recent', 'récent', 'historique'],
      priority: 5 - index * 0.1,
      action: () => {
        if (recent.itemType === 'folder') {
          dispatch(setCurrentFolder(recent.itemId));
          navigate(`/folder/${recent.itemId}`);
        } else {
          dispatch(
            openModal({
              type: 'filePreview',
              props: { fileId: recent.itemId, fileName: recent.name },
            })
          );
        }
      },
    }));
  }, [recentFiles, dispatch, navigate]);

  // Toutes les commandes combinées
  const allCommands = useMemo(() => {
    return [
      ...getDefaultCommands(),
      ...favoriteCommands,
      ...recentFileCommands,
      ...fileCommands,
      ...customCommands,
    ];
  }, [getDefaultCommands, favoriteCommands, recentFileCommands, fileCommands, customCommands]);

  // Filtrer les commandes avec recherche fuzzy
  const filteredCommands = useMemo(() => {
    if (!query.trim()) {
      // Sans recherche, retourner les commandes triées par priorité
      return [...allCommands].sort((a, b) => (b.priority || 0) - (a.priority || 0));
    }

    const lowerQuery = query.toLowerCase();
    const scored = allCommands.map((cmd) => {
      let score = 0;

      // Score basé sur le nom
      const lowerName = cmd.name.toLowerCase();
      if (lowerName === lowerQuery) {
        score += 100;
      } else if (lowerName.startsWith(lowerQuery)) {
        score += 80;
      } else if (lowerName.includes(lowerQuery)) {
        score += 60;
      } else if (fuzzyMatch(lowerQuery, lowerName)) {
        score += 40;
      }

      // Score basé sur la description
      if (cmd.description) {
        const lowerDesc = cmd.description.toLowerCase();
        if (lowerDesc.includes(lowerQuery)) {
          score += 20;
        }
      }

      // Score basé sur les mots-clés
      if (cmd.keywords) {
        cmd.keywords.forEach((keyword) => {
          if (keyword.toLowerCase().includes(lowerQuery)) {
            score += 30;
          }
        });
      }

      // Bonus de priorité
      score += (cmd.priority || 0) * 2;

      return { command: cmd, score };
    });

    return scored
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((item) => item.command);
  }, [query, allCommands]);

  // Réinitialiser l'index sélectionné quand la recherche change
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Exécuter une commande
  const executeCommand = useCallback((command: Command) => {
    // Ajouter à l'historique
    setRecentCommands((prev) => {
      const filtered = prev.filter((cmd) => cmd.id !== command.id);
      const updated = [command, ...filtered].slice(0, MAX_HISTORY_ITEMS);

      // Sauvegarder dans le localStorage
      try {
        const ids = updated.map((cmd) => cmd.id);
        profileStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(ids));
      } catch (error) {
        console.error("Erreur lors de la sauvegarde de l'historique:", error);
      }

      return updated;
    });

    // Exécuter l'action
    command.action();
  }, []);

  // Ajouter une commande personnalisée
  const addCommand = useCallback((command: Command) => {
    setCustomCommands((prev) => [...prev, command]);
  }, []);

  // Supprimer une commande personnalisée
  const removeCommand = useCallback((commandId: string) => {
    setCustomCommands((prev) => prev.filter((cmd) => cmd.id !== commandId));
  }, []);

  // Effacer l'historique
  const clearHistory = useCallback(() => {
    setRecentCommands([]);
    profileStorage.removeItem(HISTORY_STORAGE_KEY);
  }, []);

  // Obtenir l'icône d'une catégorie (retourne le HTML brut)
  const getCategoryIcon = useCallback((category: CommandCategory): string => {
    return CATEGORY_ICONS[category];
  }, []);

  // Obtenir le nom d'une catégorie
  const getCategoryName = useCallback(
    (category: CommandCategory): string => {
      return t(`commandPalette.categories.${category}`);
    },
    [t]
  );

  // Catégories disponibles
  const CATEGORY_IDS: CommandCategory[] = ['files', 'actions', 'settings', 'navigation', 'recent'];
  const categories = useMemo(() => {
    return CATEGORY_IDS.map((id) => ({
      id,
      name: t(`commandPalette.categories.${id}`),
    }));
  }, [t]);

  return {
    query,
    setQuery,
    filteredCommands,
    selectedIndex,
    setSelectedIndex,
    executeCommand,
    recentCommands,
    addCommand,
    removeCommand,
    clearHistory,
    allCommands,
    categories,
    getCategoryIcon,
    getCategoryName,
  };
}

/**
 * Correspondance fuzzy simple
 */
function fuzzyMatch(pattern: string, str: string): boolean {
  let patternIdx = 0;
  let strIdx = 0;

  while (patternIdx < pattern.length && strIdx < str.length) {
    if (pattern[patternIdx] === str[strIdx]) {
      patternIdx++;
    }
    strIdx++;
  }

  return patternIdx === pattern.length;
}

/**
 * Obtenir l'icône selon l'extension du fichier
 */
function getFileIcon(extension: string): string {
  const iconMap: Record<string, string> = {
    pdf: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M9 15v-2h2a1 1 0 0 1 1 1 1 1 0 0 1-1 1H9z"/></svg>`,
    doc: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/></svg>`,
    docx: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/></svg>`,
    xls: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><rect x="8" y="12" width="8" height="6"/></svg>`,
    xlsx: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><rect x="8" y="12" width="8" height="6"/></svg>`,
    jpg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`,
    jpeg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`,
    png: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`,
    gif: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`,
    mp3: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`,
    mp4: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>`,
    zip: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 8v13H3V3h12l6 5z"/><path d="M12 3v5h5"/><path d="M10 12h4v4h-4z"/></svg>`,
    txt: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/></svg>`,
  };

  return (
    iconMap[extension] ||
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`
  );
}

/**
 * Formater la taille d'un fichier
 */
function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';

  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export default useCommandPalette;
