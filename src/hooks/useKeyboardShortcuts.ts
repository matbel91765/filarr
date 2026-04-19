/**
 * useKeyboardShortcuts Hook
 *
 * Hook React pour la gestion des raccourcis clavier globaux.
 * Permet aux composants de s'abonner aux événements de raccourcis et de les gérer.
 * Connecté à Redux pour les actions de fichiers, navigation et UI.
 */

import { useEffect, useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import shortcutsService, {
  KeyboardShortcut,
  ShortcutCategory,
  ShortcutEvent
} from '../services/platform/shortcutsService';
import type { RootState, AppDispatch } from '../store';
import { deleteFile } from '../store/slices/filesSlice';
import { setCurrentFolder, deleteFolder } from '../store/slices/foldersSlice';
import { toggleSidebar, setViewMode, openModal, addNotification } from '../store/slices/uiSlice';
import { createNewNote, getOrCreateDailyNote } from '../store/slices/notesSlice';
import { selectFavoriteByShortcut } from '../store/slices/favoritesSlice';
import { addTab, closeActiveTab, activateNextTab, activatePreviousTab, focusPanel, splitPanel, unsplit } from '../store/slices/tabsSlice';
import { selectFocusedPanel, selectIsSplit, selectFocusedActiveTab } from '../store/selectors/tabSelectors';

// Types pour le hook
export interface UseKeyboardShortcutsOptions {
  /** Activer les raccourcis clavier */
  enabled?: boolean;
  /** Ignorer les raccourcis quand un input est focalisé */
  ignoreInputs?: boolean;
  /** Actions personnalisées pour les raccourcis */
  actions?: Record<string, (event: ShortcutEvent) => void>;
  /** Callback global pour tous les raccourcis */
  onShortcut?: (event: ShortcutEvent) => void;
}

export interface UseKeyboardShortcutsReturn {
  /** Tous les raccourcis disponibles */
  shortcuts: KeyboardShortcut[];
  /** Récupérer les raccourcis par catégorie */
  getShortcutsByCategory: (category: ShortcutCategory) => KeyboardShortcut[];
  /** Mettre à jour les touches d'un raccourci */
  updateShortcutKeys: (id: string, keys: string[]) => boolean;
  /** Activer/désactiver un raccourci */
  toggleShortcut: (id: string, enabled: boolean) => boolean;
  /** Réinitialiser un raccourci */
  resetShortcut: (id: string) => boolean;
  /** Réinitialiser tous les raccourcis */
  resetAllShortcuts: () => void;
  /** Formater les touches pour l'affichage */
  formatKeys: (keys: string[]) => string;
  /** Vérifier un conflit de touches */
  hasConflict: (id: string, keys: string[]) => KeyboardShortcut | undefined;
  /** Catégories disponibles */
  categories: { id: ShortcutCategory; name: string }[];
  /** Enregistrer en train d'écouter les touches */
  isRecording: boolean;
  /** Démarrer l'enregistrement pour un raccourci */
  startRecording: (shortcutId: string) => void;
  /** Arrêter l'enregistrement */
  stopRecording: () => void;
  /** Touches actuellement enregistrées */
  recordedKeys: string[];
  /** ID du raccourci en cours d'enregistrement */
  recordingShortcutId: string | null;
}

/**
 * Hook pour gérer les raccourcis clavier
 */
export function useKeyboardShortcuts(
  options: UseKeyboardShortcutsOptions = {}
): UseKeyboardShortcutsReturn {
  const {
    enabled = true,
    ignoreInputs = true,
    actions = {},
    onShortcut
  } = options;

  const [shortcuts, setShortcuts] = useState<KeyboardShortcut[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [recordedKeys, setRecordedKeys] = useState<string[]>([]);
  const [recordingShortcutId, setRecordingShortcutId] = useState<string | null>(null);
  const actionsRef = useRef(actions);
  const onShortcutRef = useRef(onShortcut);

  // Mettre à jour les refs quand les props changent
  useEffect(() => {
    actionsRef.current = actions;
  }, [actions]);

  useEffect(() => {
    onShortcutRef.current = onShortcut;
  }, [onShortcut]);

  // Charger les raccourcis au montage
  useEffect(() => {
    setShortcuts(shortcutsService.getAllShortcuts());
  }, []);

  // Vérifier si un élément de formulaire est focalisé
  const isInputFocused = useCallback((): boolean => {
    const activeElement = document.activeElement;
    if (!activeElement) return false;

    const tagName = activeElement.tagName.toLowerCase();
    const isEditable = activeElement.getAttribute('contenteditable') === 'true';
    const isInput = ['input', 'textarea', 'select'].includes(tagName);

    return isInput || isEditable;
  }, []);

  // Gestionnaire d'événements clavier
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      // Mode enregistrement
      if (isRecording) {
        event.preventDefault();
        event.stopPropagation();

        const newKeys: string[] = [];
        if (event.ctrlKey || event.metaKey) newKeys.push('Ctrl');
        if (event.altKey) newKeys.push('Alt');
        if (event.shiftKey) newKeys.push('Shift');

        // Ignorer les touches modificatrices seules
        const key = event.key;
        if (!['Control', 'Alt', 'Shift', 'Meta'].includes(key)) {
          // Normaliser la touche
          let normalizedKey = key;
          if (key.length === 1) {
            normalizedKey = key.toUpperCase();
          } else if (key.startsWith('Arrow')) {
            normalizedKey = key.replace('Arrow', '');
          }
          newKeys.push(normalizedKey);
        }

        if (newKeys.length > 0 && !['Control', 'Alt', 'Shift', 'Meta'].includes(key)) {
          setRecordedKeys(newKeys);
        }

        return;
      }

      if (!enabled) return;

      // Allow Ctrl+Shift shortcuts through even when an input/contenteditable is focused
      // (e.g. TipTap editor). These multi-modifier combos are clearly intentional shortcuts.
      const hasCtrlShift = (event.ctrlKey || event.metaKey) && event.shiftKey;
      if (ignoreInputs && isInputFocused() && !hasCtrlShift) return;

      // Vérifier si le raccourci correspond
      const shortcut = shortcutsService.matchShortcut(event);
      if (!shortcut) return;

      // Empêcher le comportement par défaut
      event.preventDefault();
      event.stopPropagation();

      // Créer l'événement de raccourci
      const shortcutEvent: ShortcutEvent = {
        shortcutId: shortcut.id,
        action: shortcut.action,
        timestamp: Date.now()
      };

      // Exécuter l'action personnalisée si elle existe
      const customAction = actionsRef.current[shortcut.action];
      if (customAction) {
        customAction(shortcutEvent);
      }

      // Appeler le callback global si défini
      if (onShortcutRef.current) {
        onShortcutRef.current(shortcutEvent);
      }

      // Déclencher les callbacks du service
      shortcutsService.trigger(shortcut);
    },
    [enabled, ignoreInputs, isInputFocused, isRecording]
  );

  // Gestionnaire pour arrêter l'enregistrement avec Escape ou Enter
  const handleRecordingKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (!isRecording) return;

      if (event.key === 'Escape') {
        event.preventDefault();
        setIsRecording(false);
        setRecordedKeys([]);
        setRecordingShortcutId(null);
      } else if (event.key === 'Enter' && recordedKeys.length > 0 && recordingShortcutId) {
        event.preventDefault();
        // Appliquer les touches enregistrées
        const success = shortcutsService.updateShortcutKeys(recordingShortcutId, recordedKeys);
        if (success) {
          setShortcuts(shortcutsService.getAllShortcuts());
        }
        setIsRecording(false);
        setRecordedKeys([]);
        setRecordingShortcutId(null);
      }
    },
    [isRecording, recordedKeys, recordingShortcutId]
  );

  // Attacher les écouteurs d'événements
  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('keydown', handleRecordingKeyDown, true);

    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('keydown', handleRecordingKeyDown, true);
    };
  }, [handleKeyDown, handleRecordingKeyDown]);

  // Fonctions utilitaires
  const getShortcutsByCategory = useCallback(
    (category: ShortcutCategory): KeyboardShortcut[] => {
      return shortcuts.filter(s => s.category === category);
    },
    [shortcuts]
  );

  const updateShortcutKeys = useCallback((id: string, keys: string[]): boolean => {
    const success = shortcutsService.updateShortcutKeys(id, keys);
    if (success) {
      setShortcuts(shortcutsService.getAllShortcuts());
    }
    return success;
  }, []);

  const toggleShortcut = useCallback((id: string, enabledState: boolean): boolean => {
    const success = shortcutsService.toggleShortcut(id, enabledState);
    if (success) {
      setShortcuts(shortcutsService.getAllShortcuts());
    }
    return success;
  }, []);

  const resetShortcut = useCallback((id: string): boolean => {
    const success = shortcutsService.resetShortcut(id);
    if (success) {
      setShortcuts(shortcutsService.getAllShortcuts());
    }
    return success;
  }, []);

  const resetAllShortcuts = useCallback((): void => {
    shortcutsService.resetAllShortcuts();
    setShortcuts(shortcutsService.getAllShortcuts());
  }, []);

  const formatKeys = useCallback((keys: string[]): string => {
    return shortcutsService.formatKeys(keys);
  }, []);

  const hasConflict = useCallback(
    (id: string, keys: string[]): KeyboardShortcut | undefined => {
      return shortcutsService.hasConflict(id, keys);
    },
    []
  );

  const startRecording = useCallback((shortcutId: string): void => {
    setIsRecording(true);
    setRecordedKeys([]);
    setRecordingShortcutId(shortcutId);
  }, []);

  const stopRecording = useCallback((): void => {
    setIsRecording(false);
    setRecordedKeys([]);
    setRecordingShortcutId(null);
  }, []);

  return {
    shortcuts,
    getShortcutsByCategory,
    updateShortcutKeys,
    toggleShortcut,
    resetShortcut,
    resetAllShortcuts,
    formatKeys,
    hasConflict,
    categories: shortcutsService.getCategories(),
    isRecording,
    startRecording,
    stopRecording,
    recordedKeys,
    recordingShortcutId
  };
}

/**
 * Hook simplifié pour écouter un raccourci spécifique
 */
export function useShortcut(
  shortcutId: string,
  callback: (event: ShortcutEvent) => void,
  deps: React.DependencyList = []
): void {
  const callbackRef = useRef(callback);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback, ...deps]);

  useEffect(() => {
    const unsubscribe = shortcutsService.on(shortcutId, (event) => {
      callbackRef.current(event);
    });

    return unsubscribe;
  }, [shortcutId]);
}

/**
 * Hook pour écouter une action de raccourci
 */
export function useShortcutAction(
  action: string,
  callback: (event: ShortcutEvent) => void,
  deps: React.DependencyList = []
): void {
  const callbackRef = useRef(callback);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback, ...deps]);

  useEffect(() => {
    const unsubscribe = shortcutsService.onAny((event) => {
      if (event.action === action) {
        callbackRef.current(event);
      }
    });

    return unsubscribe;
  }, [action]);
}

/**
 * Hook to wire global shortcuts to Redux actions
 * This should be used at app level to handle all global shortcuts
 */
export function useGlobalShortcuts(): void {
  const { t } = useTranslation();
  const dispatch = useDispatch<AppDispatch>();
  const navigate = useNavigate();

  // Get state from Redux
  const selectedFileIds = useSelector((state: RootState) => state.files.selectedIds);
  const currentFolderId = useSelector((state: RootState) => state.folders.currentFolderId);
  const folders = useSelector((state: RootState) => state.folders.byId);
  const favorites = useSelector((state: RootState) => state.favorites.favorites);

  // Clipboard state for copy/cut/paste
  const clipboardRef = useRef<{
    items: string[];
    action: 'copy' | 'cut' | null;
    sourceFolderId: string | null;
  }>({ items: [], action: null, sourceFolderId: null });

  // Command Palette (Ctrl+P / Ctrl+K)
  useShortcutAction('palette:open', () => {
    dispatch(openModal({ type: 'commandPalette', props: {} }));
  }, [dispatch]);

  useShortcutAction('search:quick', () => {
    dispatch(openModal({ type: 'commandPalette', props: {} }));
  }, [dispatch]);

  // File operations
  useShortcutAction('file:new', () => {
    dispatch(openModal({ type: 'newFile', props: { folderId: currentFolderId } }));
  }, [dispatch, currentFolderId]);

  useShortcutAction('folder:new', () => {
    dispatch(openModal({ type: 'newFolder', props: { parentId: currentFolderId } }));
  }, [dispatch, currentFolderId]);

  useShortcutAction('item:delete', () => {
    if (selectedFileIds.length > 0) {
      dispatch(openModal({
        type: 'deleteConfirmation',
        props: { itemIds: selectedFileIds, folderId: currentFolderId }
      }));
    }
  }, [dispatch, selectedFileIds, currentFolderId]);

  useShortcutAction('item:rename', () => {
    if (selectedFileIds.length === 1) {
      dispatch(openModal({
        type: 'rename',
        props: { itemId: selectedFileIds[0], folderId: currentFolderId }
      }));
    }
  }, [dispatch, selectedFileIds, currentFolderId]);

  // Edit operations
  useShortcutAction('edit:copy', () => {
    if (selectedFileIds.length > 0) {
      clipboardRef.current = {
        items: [...selectedFileIds],
        action: 'copy',
        sourceFolderId: currentFolderId
      };
      dispatch(addNotification({
        type: 'info',
        message: `${selectedFileIds.length} élément(s) copié(s)`,
        duration: 2000
      }));
    }
  }, [dispatch, selectedFileIds, currentFolderId]);

  useShortcutAction('edit:cut', () => {
    if (selectedFileIds.length > 0) {
      clipboardRef.current = {
        items: [...selectedFileIds],
        action: 'cut',
        sourceFolderId: currentFolderId
      };
      dispatch(addNotification({
        type: 'info',
        message: `${selectedFileIds.length} élément(s) coupé(s)`,
        duration: 2000
      }));
    }
  }, [dispatch, selectedFileIds, currentFolderId]);

  useShortcutAction('edit:paste', () => {
    const clipboard = clipboardRef.current;
    if (clipboard.items.length > 0 && clipboard.action) {
      dispatch(openModal({
        type: 'moveCopy',
        props: {
          itemIds: clipboard.items,
          action: clipboard.action,
          sourceFolderId: clipboard.sourceFolderId,
          targetFolderId: currentFolderId
        }
      }));
      // Clear clipboard after cut operation
      if (clipboard.action === 'cut') {
        clipboardRef.current = { items: [], action: null, sourceFolderId: null };
      }
    }
  }, [dispatch, currentFolderId]);

  useShortcutAction('edit:select-all', () => {
    // This needs to be handled by the component that displays items
    // We dispatch a custom event that components can listen to
    window.dispatchEvent(new CustomEvent('filarr:select-all'));
  }, []);

  // Navigation
  useShortcutAction('navigation:home', () => {
    dispatch(setCurrentFolder(null));
    navigate('/');
  }, [dispatch, navigate]);

  useShortcutAction('navigation:back', () => {
    navigate(-1);
  }, [navigate]);

  useShortcutAction('navigation:forward', () => {
    navigate(1);
  }, [navigate]);

  useShortcutAction('navigation:parent', () => {
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
  }, [dispatch, navigate, currentFolderId, folders]);

  // View operations
  useShortcutAction('view:toggle-sidebar', () => {
    dispatch(toggleSidebar());
  }, [dispatch]);

  useShortcutAction('view:toggle-mode', () => {
    // Toggle between grid and list
    dispatch(setViewMode('grid')); // Will be toggled based on current mode
    window.dispatchEvent(new CustomEvent('filarr:toggle-view-mode'));
  }, [dispatch]);

  // System operations
  useShortcutAction('system:settings', () => {
    navigate('/settings');
  }, [navigate]);

  useShortcutAction('system:help', () => {
    dispatch(openModal({ type: 'help', props: {} }));
  }, [dispatch]);

  useShortcutAction('system:refresh', () => {
    window.location.reload();
  }, []);

  // Tab shortcuts
  useShortcutAction('tab:new', () => {
    dispatch(addTab({ route: '/', title: t('tabs.home') }));
  }, [dispatch]);

  useShortcutAction('tab:close', () => {
    dispatch(closeActiveTab());
  }, [dispatch]);

  useShortcutAction('tab:next', () => {
    dispatch(activateNextTab());
  }, [dispatch]);

  useShortcutAction('tab:prev', () => {
    dispatch(activatePreviousTab());
  }, [dispatch]);

  // Panel shortcuts
  const panels = useSelector((state: RootState) => state.tabs.panels);
  const focusedPanelId = useSelector((state: RootState) => state.tabs.focusedPanelId);
  const isSplit = useSelector(selectIsSplit);
  const focusedActiveTab = useSelector(selectFocusedActiveTab);

  useShortcutAction('panel:focus-other', () => {
    if (isSplit && panels.length > 1) {
      const otherPanel = panels.find(p => p.id !== focusedPanelId);
      if (otherPanel) {
        dispatch(focusPanel(otherPanel.id));
      }
    }
  }, [dispatch, isSplit, panels, focusedPanelId]);

  useShortcutAction('panel:close', () => {
    if (isSplit) {
      dispatch(unsplit());
    }
  }, [dispatch, isSplit]);

  useShortcutAction('panel:split-right', () => {
    if (!isSplit && focusedActiveTab && focusedActiveTab.closable) {
      dispatch(splitPanel({
        tabId: focusedActiveTab.id,
        sourcePanelId: focusedPanelId,
        side: 'right',
      }));
    }
  }, [dispatch, isSplit, focusedActiveTab, focusedPanelId]);

  // Favorites shortcuts (Ctrl+1-9) - using single handler for all
  const handleFavoriteShortcut = useCallback((shortcutKey: number) => {
    const favorite = favorites.find(f => f.shortcutKey === shortcutKey);
    if (favorite) {
      if (favorite.itemType === 'folder') {
        dispatch(setCurrentFolder(favorite.itemId));
        navigate(`/folder/${favorite.itemId}`);
      } else {
        dispatch(openModal({
          type: 'filePreview',
          props: { fileId: favorite.itemId, fileName: favorite.name }
        }));
      }
    }
  }, [dispatch, navigate, favorites]);

  // Notes shortcuts
  useShortcutAction('note:new', () => {
    dispatch(createNewNote({ title: '' }));
    navigate('/notes');
  }, [dispatch, navigate]);

  useShortcutAction('note:daily', () => {
    dispatch(getOrCreateDailyNote());
    navigate('/notes');
  }, [dispatch, navigate]);

  // note:focus-mode is handled locally in NoteEditor.tsx (Ctrl+Shift+F)
  // note:graph is handled locally in NotesView.tsx (Ctrl+Shift+G)

  useShortcutAction('favorite:1', () => handleFavoriteShortcut(1), [handleFavoriteShortcut]);
  useShortcutAction('favorite:2', () => handleFavoriteShortcut(2), [handleFavoriteShortcut]);
  useShortcutAction('favorite:3', () => handleFavoriteShortcut(3), [handleFavoriteShortcut]);
  useShortcutAction('favorite:4', () => handleFavoriteShortcut(4), [handleFavoriteShortcut]);
  useShortcutAction('favorite:5', () => handleFavoriteShortcut(5), [handleFavoriteShortcut]);
  useShortcutAction('favorite:6', () => handleFavoriteShortcut(6), [handleFavoriteShortcut]);
  useShortcutAction('favorite:7', () => handleFavoriteShortcut(7), [handleFavoriteShortcut]);
  useShortcutAction('favorite:8', () => handleFavoriteShortcut(8), [handleFavoriteShortcut]);
  useShortcutAction('favorite:9', () => handleFavoriteShortcut(9), [handleFavoriteShortcut]);
}

export default useKeyboardShortcuts;
