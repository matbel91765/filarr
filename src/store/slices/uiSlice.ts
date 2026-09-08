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
  loadProfileAppearance,
  applyProfileAppearance,
  defaultThemeName,
} from '../../services/platform/themeService';
// Les préférences durables d'affichage passent par profileStorage : sans lui,
// deux profils du même poste partagent leur chrome, et un profil de diversion
// se trahit par ses réglages. Lecture de repli sur l'ancienne clé nue, jamais
// d'écriture sur celle-ci.
import * as profileStorage from '../../services/core/profileStorage';

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
    | 'terracotta'
    | 'papier'
    | 'minuit'
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
  /**
   * L'espace VISÉ par la demande de bascule, quand il y en a un.
   *
   * `null` = « rends-moi le portail », le comportement d'origine : la personne
   * rechoisit son espace puis son profil. Une valeur = « emmène-moi directement
   * là », ce que demande l'entrée « créer mon espace professionnel » : passer
   * par le portail pour y recliquer sur la carte qu'on vient de nommer est un
   * détour que rien ne justifie.
   */
  profileSwitchSpace: 'personal' | 'enterprise' | null;

  // File click behavior — 'details' opens the details panel on single click
  // (open requires double-click); 'open' opens the file on single click.
  fileClickBehavior: 'details' | 'open';

  // Affichage des barres — décomposition (barre supérieure visible|masquée|
  // au survol) × (barre d'onglets visible|masquée). Ctrl+Shift+B cycle.
  barsMode: BarsMode;

  // Widget « Notes récentes » sur l'accueil. Activé par défaut : l'accueil ne
  // présente les notes que par dossier, donc sans lui les dernières notes
  // écrites n'apparaissent nulle part.
  homeRecentNotes: boolean;

  // Fonds de thème animés (« Minuit vivant » et ses successeurs). Activé par
  // défaut : c'est le caractère du thème, on ne le découvrirait jamais s'il
  // fallait aller le chercher. Décoché → data-animated-bg='off' sur <html>,
  // et le CSS fige ses couches sans les effacer.
  animatedBackground: boolean;

  // Panneaux latéraux des notes révélés au survol seulement. ÉTEINT par défaut :
  // c'est un acquiescement explicite, contrairement aux deux réglages
  // ci-dessus — masquer d'office la moitié de l'écran d'un utilisateur qui
  // n'a rien demandé serait une régression, pas une préférence.
  notesPanelsHover: boolean;

  // Mode sans distraction. NON persisté, contrairement à tout ce qui précède :
  // un mode qui survit au redémarrage et qu'on a oublié d'éteindre ne se lit
  // pas comme une préférence, il se lit comme une application cassée.
  notesFocusMode: boolean;
}

/**
 * Modes d'affichage des barres de chrome de la fenêtre.
 *
 * - `all`         barre supérieure (recherche/sync/profil) + barre d'onglets
 * - `floating`    même barre, mais en pilule détachée et centrée + onglets
 * - `side`        même barre pliée en rail vertical à gauche + onglets
 * - `autohide`    barre supérieure révélée à l'approche du haut + onglets
 * - `tabs-only`   onglets seuls (la barre supérieure ne rend plus rien)
 * - `search-only` barre supérieure seule (les onglets sont masqués)
 * - `none`        aucune barre — Ctrl+Shift+B est le seul retour
 *
 * Remplace l'ancien `HeaderMode` qui ne pilotait que la barre supérieure ;
 * la migration de l'ancienne clé se fait en lecture (cf. loadBarsMode).
 */
export type BarsMode =
  | 'all'
  | 'floating'
  | 'side'
  | 'autohide'
  | 'tabs-only'
  | 'search-only'
  | 'none';

// L'ordre pilote À LA FOIS la grille des Paramètres et le cycle Ctrl+Maj+B :
// on part du plus garni pour aller au plus nu, les trois dispositions
// complètes (toutes / flottante / rail) d'abord.
export const BARS_MODES: readonly BarsMode[] = [
  'all',
  'floating',
  'side',
  'autohide',
  'tabs-only',
  'search-only',
  'none',
];

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

const FILE_CLICK_BEHAVIOR_KEY = 'filarr-file-click-behavior';
const loadFileClickBehavior = (): 'details' | 'open' => {
  if (typeof window === 'undefined') return 'details';
  const v = profileStorage.getItemWithLegacyFallback(FILE_CLICK_BEHAVIOR_KEY);
  return v === 'open' ? 'open' : 'details';
};

const BARS_MODE_KEY = 'filarr-bars-mode';
// Ancienne clé (réglage « Barre supérieure »). Elle n'est jamais réécrite :
// la migration se fait en LECTURE, tant qu'aucun choix neuf n'a été posé.
const LEGACY_HEADER_MODE_KEY = 'filarr-header-mode';

const loadBarsMode = (): BarsMode => {
  if (typeof window === 'undefined') return 'all';
  const v = profileStorage.getItemWithLegacyFallback(BARS_MODE_KEY);
  if (v && (BARS_MODES as readonly string[]).includes(v)) {
    return v as BarsMode;
  }
  // Migration : visible → all, autohide → autohide, hidden → tabs-only.
  // « hidden » ne masquait QUE la barre supérieure : les onglets restaient
  // à l'écran, donc l'équivalent fidèle est 'tabs-only', pas 'none'.
  const legacy = profileStorage.getItemWithLegacyFallback(LEGACY_HEADER_MODE_KEY);
  if (legacy === 'autohide') return 'autohide';
  if (legacy === 'hidden') return 'tabs-only';
  return 'all';
};

const HOME_RECENT_NOTES_KEY = 'filarr-home-recent-notes';
const loadHomeRecentNotes = (): boolean => {
  if (typeof window === 'undefined') return true;
  // Activé sauf refus explicite : une préférence jamais écrite doit laisser
  // le widget visible, pas le cacher.
  return profileStorage.getItemWithLegacyFallback(HOME_RECENT_NOTES_KEY) !== 'off';
};

const ANIMATED_BACKGROUND_KEY = 'filarr-animated-background';
const loadAnimatedBackground = (): boolean => {
  if (typeof window === 'undefined') return true;
  // Même logique que ci-dessus : seul un refus explicite éteint le mouvement.
  return profileStorage.getItemWithLegacyFallback(ANIMATED_BACKGROUND_KEY) !== 'off';
};

const NOTES_PANELS_HOVER_KEY = 'filarr-notes-panels-hover';
const loadNotesPanelsHover = (): boolean => {
  if (typeof window === 'undefined') return false;
  // Seul un « oui » explicite l'active : l'inverse des deux réglages ci-dessus.
  return profileStorage.getItemWithLegacyFallback(NOTES_PANELS_HOVER_KEY) === 'on';
};

// État initial
const initialState: UIState = {
  // Préférences d'affichage
  theme: 'light',
  customTheme: null,
  // Fermée au démarrage : la sidebar est un overlay, et Layout est désormais
  // branché sur cette valeur (avant, un useState local la forçait à false).
  sidebarOpen: false,
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
  profileSwitchSpace: null,

  // File click behavior — load from localStorage so the choice persists
  fileClickBehavior: loadFileClickBehavior(),

  // Affichage des barres — le slice ui n'est pas persisté par redux-persist,
  // d'où la lecture directe du localStorage comme pour fileClickBehavior.
  barsMode: loadBarsMode(),

  // Widget « Notes récentes » de l'accueil — même mécanique de persistance.
  homeRecentNotes: loadHomeRecentNotes(),

  // Fonds de thème animés — idem.
  animatedBackground: loadAnimatedBackground(),

  // Panneaux des notes au survol — idem.
  notesPanelsHover: loadNotesPanelsHover(),

  // Mode sans distraction — éphémère, aucun chargement.
  notesFocusMode: false,
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
        | 'terracotta'
        | 'papier'
        | 'minuit'
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

    setFileClickBehavior(state, action: PayloadAction<'details' | 'open'>) {
      state.fileClickBehavior = action.payload;
      try {
        profileStorage.setItem(FILE_CLICK_BEHAVIOR_KEY, action.payload);
      } catch {
        // localStorage may be unavailable
      }
    },

    setBarsMode(state, action: PayloadAction<BarsMode>) {
      state.barsMode = action.payload;
      try {
        profileStorage.setItem(BARS_MODE_KEY, action.payload);
      } catch {
        // localStorage may be unavailable
      }
    },

    setHomeRecentNotes(state, action: PayloadAction<boolean>) {
      state.homeRecentNotes = action.payload;
      try {
        profileStorage.setItem(HOME_RECENT_NOTES_KEY, action.payload ? 'on' : 'off');
      } catch {
        // localStorage may be unavailable
      }
    },

    setAnimatedBackground(state, action: PayloadAction<boolean>) {
      state.animatedBackground = action.payload;
      try {
        profileStorage.setItem(ANIMATED_BACKGROUND_KEY, action.payload ? 'on' : 'off');
      } catch {
        // localStorage may be unavailable
      }
    },

    setNotesPanelsHover(state, action: PayloadAction<boolean>) {
      state.notesPanelsHover = action.payload;
      try {
        profileStorage.setItem(NOTES_PANELS_HOVER_KEY, action.payload ? 'on' : 'off');
      } catch {
        // localStorage may be unavailable
      }
    },

    setNotesFocusMode(state, action: PayloadAction<boolean>) {
      state.notesFocusMode = action.payload;
    },

    /**
     * Recharge les préférences durables d'affichage depuis le stockage du
     * profil actif.
     *
     * `initialState` est calculé à l'ÉVALUATION du module, donc une seule fois
     * par lancement : quand on active un autre profil sans recharger la fenêtre
     * (le sélecteur de démarrage), l'état garderait le chrome du profil
     * précédent alors que les écritures partiraient déjà vers le nouveau. À
     * appeler juste après `profileStorage.setActiveProfile`.
     */
    hydrateDisplayPreferences(state) {
      state.fileClickBehavior = loadFileClickBehavior();
      state.barsMode = loadBarsMode();
      state.homeRecentNotes = loadHomeRecentNotes();
      state.animatedBackground = loadAnimatedBackground();
      state.notesPanelsHover = loadNotesPanelsHover();
      // Le mode sans distraction ne suit aucun profil : changer de compte le
      // laisse éteint, comme au lancement.
      state.notesFocusMode = false;

      // Préférences de thème du profil : même défaut d'origine que ci-dessus —
      // `initialState` les a lues sous le profil précédent.
      const prefs = loadThemePreferences();
      state.activeThemeId = prefs.activeThemeId;
      state.customThemes = prefs.customThemes;
      state.useSystemTheme = prefs.useSystemTheme;

      // THÈME ET ACCENT — le repli est le défaut de la PLATEFORME, jamais
      // `state.theme` : reprendre le thème à l'écran ferait hériter le profil
      // entrant de celui qu'on quitte, ce qu'on est précisément en train de
      // corriger. Un profil qui n'a jamais choisi s'ouvre neuf.
      const appearance = loadProfileAppearance(defaultThemeName());
      state.theme = applyProfileAppearance(appearance);
      // Le thème personnalisé du profil sortant n'a plus de variables CSS ici.
      state.customTheme = null;
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
    // La charge est FACULTATIVE : les appelants d'origine (l'en-tête, l'hôte
    // d'invitation) continuent d'appeler sans argument et retombent sur le
    // portail, exactement comme avant.
    requestProfileSwitch(state, action: PayloadAction<'personal' | 'enterprise' | undefined>) {
      state.profileSwitchRequested = true;
      state.profileSwitchSpace = action.payload ?? null;
    },
    clearProfileSwitchRequest(state) {
      state.profileSwitchRequested = false;
      state.profileSwitchSpace = null;
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
  setFileClickBehavior,
  setBarsMode,
  setHomeRecentNotes,
  setAnimatedBackground,
  setNotesPanelsHover,
  setNotesFocusMode,
  hydrateDisplayPreferences,

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
