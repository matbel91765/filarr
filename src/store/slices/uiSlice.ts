/**
 * Redux Slice pour l'interface utilisateur (UI)
 *
 * Gère tout l'état relatif à l'interface utilisateur, comme les modales,
 * les notifications, les préférences d'affichage, les thèmes, etc.
 */

import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import type { ViewMode, SortOption, SortDirection, UINotification } from '../../types';
import type {
  Theme,
  DensitySettings,
  DensityMode,
  ViewType,
} from '../../services/platform/themeService';
import {
  DEFAULT_DENSITY_SETTINGS,
  loadThemePreferences,
  loadDensitySettings,
} from '../../services/platform/themeService';

// Types pour l'état UI
export interface UIState {
  // Préférences d'affichage
  theme:
    | 'light'
    | 'dark'
    | 'space'
    | 'lofi'
    | 'sky'
    | 'aurora'
    | 'sakura'
    | 'crepuscule'
    | 'foret'
    | 'custom';
  customTheme: Record<string, string> | null;
  sidebarOpen: boolean;
  viewMode: ViewMode;
  itemsPerPage: number;
  sortBy: {
    field: SortOption;
    order: SortDirection;
  };

  // Theme System
  activeThemeId: string;
  customThemes: Theme[];
  useSystemTheme: boolean;

  // Density Settings
  density: DensitySettings;

  // Gestion des modales
  modal: {
    isOpen: boolean;
    type: string | null; // 'reminder', 'customization', 'passwordPrompt', etc.
    props: Record<string, any>;
  };

  // Notifications
  notifications: UINotification[];
  nextNotificationId: number;

  // Drag & Drop
  dragAndDrop: {
    isDragging: boolean;
    draggedItemId: string | null;
    draggedItemType: string | null;
    dropTargetId: string | null;
    dropTargetType: string | null;
  };

  // Progression des opérations
  operations: {
    isLoading: boolean;
    message: string;
    progress: number;
    operationType: string | null;
  };

  // Groupement
  groupBy: {
    field: 'none' | 'type' | 'date' | 'firstLetter';
    enabled: boolean;
  };

  // Active context menu item
  activeContextMenuItem: { action: string; item: any } | null;

  // Profile switch request
  profileSwitchRequested: boolean;
}

interface AddNotificationPayload {
  type?: 'success' | 'error' | 'warning' | 'info';
  message: string;
  autoClose?: boolean;
  duration?: number;
  actions?: any[];
  metadata?: Record<string, any>;
}

interface OpenModalPayload {
  type: string;
  props?: Record<string, any>;
}

interface DraggingPayload {
  isDragging: boolean;
  itemId?: string | null;
  itemType?: string | null;
}

interface DropTargetPayload {
  targetId: string | null;
  targetType: string | null;
}

interface StartOperationPayload {
  message?: string;
  operationType?: string;
}

// Load saved preferences (safe for SSR)
const getSavedPreferences = () => {
  if (typeof window === 'undefined') {
    return {
      themePreferences: {
        activeThemeId: 'light',
        customThemes: [],
        useSystemTheme: false,
      },
      densitySettings: DEFAULT_DENSITY_SETTINGS,
    };
  }
  return {
    themePreferences: loadThemePreferences(),
    densitySettings: loadDensitySettings(),
  };
};

const { themePreferences, densitySettings } = getSavedPreferences();

// État initial
const initialState: UIState = {
  // Préférences d'affichage
  theme: 'light',
  customTheme: null,
  sidebarOpen: true,
  viewMode: 'grid',
  itemsPerPage: 20,
  sortBy: {
    field: 'name',
    order: 'asc',
  },

  // Theme System
  activeThemeId: themePreferences.activeThemeId,
  customThemes: themePreferences.customThemes,
  useSystemTheme: themePreferences.useSystemTheme,

  // Density Settings
  density: densitySettings,

  // Gestion des modales
  modal: {
    isOpen: false,
    type: null,
    props: {},
  },

  // Notifications
  notifications: [],
  nextNotificationId: 1,

  // Drag & Drop
  dragAndDrop: {
    isDragging: false,
    draggedItemId: null,
    draggedItemType: null,
    dropTargetId: null,
    dropTargetType: null,
  },

  // Progression des opérations
  operations: {
    isLoading: false,
    message: '',
    progress: 0,
    operationType: null,
  },

  // Groupement
  groupBy: {
    field: 'none',
    enabled: false,
  },

  // Active context menu item
  activeContextMenuItem: null,

  // Profile switch request (triggers ProfilePicker)
  profileSwitchRequested: false,
};

// Slice
const uiSlice = createSlice({
  name: 'ui',
  initialState,
  reducers: {
    // Actions pour les préférences d'affichage
    setTheme(
      state,
      action: PayloadAction<
        | 'light'
        | 'dark'
        | 'space'
        | 'lofi'
        | 'sky'
        | 'aurora'
        | 'sakura'
        | 'crepuscule'
        | 'foret'
        | 'custom'
      >
    ) {
      state.theme = action.payload;
      // Appliquer le thème au document pour les variables CSS
      if (typeof document !== 'undefined') {
        document.documentElement.setAttribute('data-theme', action.payload);
      }
    },

    setCustomTheme(state, action: PayloadAction<Record<string, string>>) {
      state.customTheme = action.payload;
      state.theme = 'custom';

      // Si un thème personnalisé est appliqué, mettre à jour les variables CSS
      if (typeof document !== 'undefined' && action.payload) {
        document.documentElement.setAttribute('data-theme', 'custom');

        // Appliquer les variables CSS personnalisées
        Object.entries(action.payload).forEach(([key, value]) => {
          document.documentElement.style.setProperty(`--${key}`, value);
        });
      }
    },

    toggleSidebar(state) {
      state.sidebarOpen = !state.sidebarOpen;
    },

    setSidebarOpen(state, action: PayloadAction<boolean>) {
      state.sidebarOpen = action.payload;
    },

    setViewMode(state, action: PayloadAction<ViewMode>) {
      state.viewMode = action.payload;
    },

    setItemsPerPage(state, action: PayloadAction<number>) {
      state.itemsPerPage = action.payload;
    },

    setSortBy(state, action: PayloadAction<{ field: SortOption; order: SortDirection }>) {
      state.sortBy = action.payload;
    },

    setGroupBy(
      state,
      action: PayloadAction<{ field: 'none' | 'type' | 'date' | 'firstLetter'; enabled: boolean }>
    ) {
      state.groupBy = action.payload;
    },

    // Actions pour les modales
    openModal(state, action: PayloadAction<OpenModalPayload>) {
      state.modal = {
        isOpen: true,
        type: action.payload.type,
        props: action.payload.props || {},
      };
    },

    closeModal(state) {
      state.modal = {
        isOpen: false,
        type: null,
        props: {},
      };
    },

    updateModalProps(state, action: PayloadAction<Record<string, any>>) {
      state.modal.props = {
        ...state.modal.props,
        ...action.payload,
      };
    },

    // Actions pour les notifications
    addNotification(state, action: PayloadAction<AddNotificationPayload>) {
      const notification: UINotification = {
        id: state.nextNotificationId,
        type: action.payload.type || 'info',
        message: action.payload.message,
        autoClose: action.payload.autoClose !== undefined ? action.payload.autoClose : true,
        duration: action.payload.duration || 5000,
        timestamp: new Date().toISOString(),
        actions: action.payload.actions || [],
        metadata: action.payload.metadata || {},
      };

      state.notifications.push(notification);
      state.nextNotificationId += 1;
    },

    removeNotification(state, action: PayloadAction<number>) {
      const notificationId = action.payload;
      state.notifications = state.notifications.filter(
        (notification) => notification.id !== notificationId
      );
    },

    clearAllNotifications(state) {
      state.notifications = [];
    },

    // Actions pour le drag & drop
    setDragging(state, action: PayloadAction<DraggingPayload>) {
      const { isDragging, itemId, itemType } = action.payload;
      state.dragAndDrop = {
        ...state.dragAndDrop,
        isDragging,
        draggedItemId: itemId ?? null,
        draggedItemType: itemType ?? null,
      };
    },

    setDropTarget(state, action: PayloadAction<DropTargetPayload>) {
      const { targetId, targetType } = action.payload;
      state.dragAndDrop.dropTargetId = targetId;
      state.dragAndDrop.dropTargetType = targetType;
    },

    resetDragAndDrop(state) {
      state.dragAndDrop = {
        isDragging: false,
        draggedItemId: null,
        draggedItemType: null,
        dropTargetId: null,
        dropTargetType: null,
      };
    },

    // Actions pour les indicateurs d'opérations
    startOperation(state, action: PayloadAction<StartOperationPayload>) {
      state.operations = {
        isLoading: true,
        message: action.payload.message || 'Opération en cours...',
        progress: 0,
        operationType: action.payload.operationType ?? null,
      };
    },

    updateOperationProgress(state, action: PayloadAction<number>) {
      state.operations.progress = action.payload;
    },

    endOperation(state) {
      state.operations = {
        isLoading: false,
        message: '',
        progress: 0,
        operationType: null,
      };
    },

    // Action for context menu
    setActiveContextMenuItem(state, action: PayloadAction<{ action: string; item: any } | null>) {
      state.activeContextMenuItem = action.payload;
    },

    // ===== Theme System Actions =====

    // Set active theme ID
    setActiveThemeId(state, action: PayloadAction<string>) {
      state.activeThemeId = action.payload;
    },

    // Set use system theme
    setUseSystemTheme(state, action: PayloadAction<boolean>) {
      state.useSystemTheme = action.payload;
    },

    // Add a custom theme
    addCustomTheme(state, action: PayloadAction<Theme>) {
      state.customThemes.push(action.payload);
    },

    // Update a custom theme
    updateCustomThemeInStore(state, action: PayloadAction<Theme>) {
      const index = state.customThemes.findIndex((t) => t.id === action.payload.id);
      if (index !== -1) {
        state.customThemes[index] = action.payload;
      }
    },

    // Remove a custom theme
    removeCustomTheme(state, action: PayloadAction<string>) {
      state.customThemes = state.customThemes.filter((t) => t.id !== action.payload);
    },

    // Set all custom themes (for import)
    setCustomThemes(state, action: PayloadAction<Theme[]>) {
      state.customThemes = action.payload;
    },

    // ===== Density Settings Actions =====

    // Set density mode
    setDensityMode(state, action: PayloadAction<DensityMode>) {
      state.density.mode = action.payload;
    },

    // Set view type
    setViewType(state, action: PayloadAction<ViewType>) {
      state.density.viewType = action.payload;
    },

    // Set list columns
    setListColumns(state, action: PayloadAction<string[]>) {
      state.density.listColumns = action.payload;
    },

    // Set grid item size
    setGridItemSize(state, action: PayloadAction<'small' | 'medium' | 'large'>) {
      state.density.gridItemSize = action.payload;
    },

    // Set full density settings
    setDensitySettings(state, action: PayloadAction<DensitySettings>) {
      state.density = action.payload;
    },

    // Reset density to defaults
    resetDensityToDefaults(state) {
      state.density = DEFAULT_DENSITY_SETTINGS;
    },

    // Profile switch
    requestProfileSwitch(state) {
      state.profileSwitchRequested = true;
    },
    clearProfileSwitchRequest(state) {
      state.profileSwitchRequested = false;
    },
  },
});

// Exporter les actions
export const {
  // Préférences d'affichage
  setTheme,
  setCustomTheme,
  toggleSidebar,
  setSidebarOpen,
  setViewMode,
  setItemsPerPage,
  setSortBy,
  setGroupBy,

  // Modales
  openModal,
  closeModal,
  updateModalProps,

  // Notifications
  addNotification,
  removeNotification,
  clearAllNotifications,

  // Drag & Drop
  setDragging,
  setDropTarget,
  resetDragAndDrop,

  // Opérations
  startOperation,
  updateOperationProgress,
  endOperation,

  // Context Menu
  setActiveContextMenuItem,

  // Theme System
  setActiveThemeId,
  setUseSystemTheme,
  addCustomTheme,
  updateCustomThemeInStore,
  removeCustomTheme,
  setCustomThemes,

  // Density Settings
  setDensityMode,
  setViewType,
  setListColumns,
  setGridItemSize,
  setDensitySettings,
  resetDensityToDefaults,

  // Profile Switch
  requestProfileSwitch,
  clearProfileSwitchRequest,
} = uiSlice.actions;

// Action creator pour afficher une notification de succès
export const showSuccessNotification = (
  message: string,
  options: Partial<AddNotificationPayload> = {}
) => {
  return addNotification({
    type: 'success',
    message,
    ...options,
  });
};

// Action creator pour afficher une notification d'erreur
export const showErrorNotification = (
  message: string,
  options: Partial<AddNotificationPayload> = {}
) => {
  return addNotification({
    type: 'error',
    message,
    duration: options.duration || 7000,
    ...options,
  });
};

// Action creator pour afficher une notification d'avertissement
export const showWarningNotification = (
  message: string,
  options: Partial<AddNotificationPayload> = {}
) => {
  return addNotification({
    type: 'warning',
    message,
    ...options,
  });
};

// Action creator pour afficher une notification d'information
export const showInfoNotification = (
  message: string,
  options: Partial<AddNotificationPayload> = {}
) => {
  return addNotification({
    type: 'info',
    message,
    ...options,
  });
};

// Types pour le dialogue de confirmation
interface ConfirmationDialogOptions {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm?: () => void;
  onCancel?: () => void;
  confirmColor?: string;
  cancelColor?: string;
  isDestructive?: boolean;
}

// Action creator pour afficher le dialogue de confirmation
export const showConfirmationDialog = (options: ConfirmationDialogOptions) => {
  return openModal({
    type: 'confirmation',
    props: {
      title: options.title || 'Confirmation',
      message: options.message,
      confirmText: options.confirmText || 'Confirmer',
      cancelText: options.cancelText || 'Annuler',
      onConfirm: options.onConfirm,
      onCancel: options.onCancel,
      confirmColor: options.confirmColor || 'primary',
      cancelColor: options.cancelColor || 'secondary',
      isDestructive: options.isDestructive || false,
    },
  });
};

// Exporter le reducer
export default uiSlice.reducer;
