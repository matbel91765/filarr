/**
 * Redux Slice pour les paramètres de l'application
 *
 * Gère tout l'état relatif aux paramètres utilisateur et à la configuration
 * de l'application (préférences, sécurité, notifications, etc.).
 */

import { createSlice, createAsyncThunk, createSelector, PayloadAction } from '@reduxjs/toolkit';
import type { ViewMode, SortOption, SortDirection } from '../../types';
import profileStorage from '../../services/core/profileStorage';

// Paramètres "Protection du bureau" (Wave 1 — surface desktop) :
// mode d'import (copier vs déplacer-dans-le-coffre, renderer-only) +
// réglages MIROITÉS vers le main process via filarr-flags.json (raccourcis
// globaux, verrouillage lié à la session OS, purge des fichiers temporaires).
// IMPORTANT : les défauts des champs miroités doivent rester IDENTIQUES à
// DEFAULT_DESKTOP_PROTECTION_SETTINGS (electron/desktopProtection.ts) — un
// premier miroir avec d'autres valeurs écraserait le comportement main-side.
export interface DesktopProtectionSettings {
  /** Comportement d'import par défaut : copier, ou déplacer dans le coffre (supprime l'original). */
  importMode: 'copy' | 'move';
  /** Afficher le choix copier/déplacer à chaque import. */
  askImportMode: boolean;
  /** Activer les raccourcis clavier globaux (mini-mode / verrouillage). */
  hotkeysEnabled: boolean;
  /** Accélérateur Electron pour ouvrir le mini-mode. */
  hotkeyMini: string;
  /** Accélérateur Electron pour tout verrouiller. */
  hotkeyLock: string;
  /** Verrouiller le coffre quand la session OS est verrouillée. */
  lockOnOsLock: boolean;
  /** Verrouiller le coffre à la mise en veille. */
  lockOnSuspend: boolean;
  /** Purger les fichiers temporaires en clair au verrouillage. */
  purgeTempOnLock: boolean;
}

export const DESKTOP_PROTECTION_DEFAULTS: DesktopProtectionSettings = {
  importMode: 'copy',
  askImportMode: false,
  hotkeysEnabled: true,
  // Mnémonique de marque (« F » du glyphe) ; Ctrl+Alt+L verrouille la session
  // sur certains systèmes — évité à dessein. Mêmes valeurs que le main.
  hotkeyMini: 'CommandOrControl+Alt+F',
  hotkeyLock: 'CommandOrControl+Alt+Shift+L',
  lockOnOsLock: true,
  lockOnSuspend: true,
  purgeTempOnLock: true,
};

// Types pour l'état des paramètres
export interface SettingsState {
  // Préférences générales
  general: {
    language: string;
    dateFormat: string;
    timeFormat: '12h' | '24h';
    firstDayOfWeek: 0 | 1; // 0 = Sunday, 1 = Monday
    timezone: string;
  };

  // Préférences d'affichage
  display: {
    defaultViewMode: ViewMode;
    defaultSortBy: SortOption;
    defaultSortOrder: SortDirection;
    itemsPerPage: number;
    showHiddenFiles: boolean;
    showFileExtensions: boolean;
    compactMode: boolean;
    gridSize: 'small' | 'medium' | 'large';
  };

  // Paramètres de sécurité
  security: {
    autoLockEnabled: boolean;
    autoLockTimeout: number; // en minutes
    requirePasswordOnStartup: boolean;
    encryptionEnabled: boolean;
    defaultEncryptionAlgorithm: string;
    biometricAuthEnabled: boolean;
    sessionTimeout: number; // en minutes
  };

  // Paramètres de synchronisation
  sync: {
    autoSyncEnabled: boolean;
    syncInterval: number; // en minutes
    syncOnlyOnWiFi: boolean;
    conflictResolution: 'manual' | 'local' | 'remote' | 'newest';
    syncFolders: string[]; // IDs des dossiers à synchroniser
  };

  // Paramètres de notifications
  notifications: {
    enabled: boolean;
    soundEnabled: boolean;
    desktopNotifications: boolean;
    emailNotifications: boolean;
    reminderNotifications: boolean;
    syncNotifications: boolean;
    errorNotifications: boolean;
    notificationPosition: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
    notificationDuration: number; // en millisecondes
  };

  // Paramètres de sauvegarde
  backup: {
    autoBackupEnabled: boolean;
    backupFrequency: 'daily' | 'weekly' | 'monthly';
    backupLocation: string;
    keepBackups: number; // nombre de sauvegardes à conserver
    lastBackupDate: string | null;
  };

  // Paramètres de performance
  performance: {
    enableVirtualization: boolean;
    cacheEnabled: boolean;
    cacheSize: number; // en MB
    preloadImages: boolean;
    hardwareAcceleration: boolean;
  };

  // Paramètres avancés
  advanced: {
    developerMode: boolean;
    debugMode: boolean;
    telemetryEnabled: boolean;
    crashReportsEnabled: boolean;
    betaFeatures: boolean;
    experimentalFeatures: string[]; // Liste des fonctionnalités expérimentales activées
  };

  // Protection du bureau (Wave 1).
  // Optionnel car redux-persist (autoMergeLevel1) remplace le slice entier
  // par la version persistée : un état persisté antérieur à cette fonctionnalité
  // n'a pas ce groupe. Toujours lire via selectDesktopProtection.
  desktop?: DesktopProtectionSettings;

  // Métadonnées
  loading: boolean;
  error: SerializedError | null;
  lastSaved: string | null;
}

// Type pour les erreurs sérialisées
export interface SerializedError {
  name?: string;
  message?: string;
  details?: any;
  type?: string;
}

// État initial avec des valeurs par défaut sensées
const initialState: SettingsState = {
  general: {
    language: 'fr',
    dateFormat: 'DD/MM/YYYY',
    timeFormat: '24h',
    firstDayOfWeek: 1,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  },

  display: {
    defaultViewMode: 'grid',
    defaultSortBy: 'name',
    defaultSortOrder: 'asc',
    itemsPerPage: 20,
    showHiddenFiles: false,
    showFileExtensions: true,
    compactMode: false,
    gridSize: 'medium',
  },

  security: {
    autoLockEnabled: false,
    autoLockTimeout: 15,
    requirePasswordOnStartup: false,
    encryptionEnabled: true,
    defaultEncryptionAlgorithm: 'AES-256-GCM',
    biometricAuthEnabled: false,
    sessionTimeout: 60,
  },

  sync: {
    autoSyncEnabled: false,
    syncInterval: 15,
    syncOnlyOnWiFi: false,
    conflictResolution: 'manual',
    syncFolders: [],
  },

  notifications: {
    enabled: true,
    soundEnabled: true,
    desktopNotifications: true,
    emailNotifications: false,
    reminderNotifications: true,
    syncNotifications: true,
    errorNotifications: true,
    notificationPosition: 'top-right',
    notificationDuration: 5000,
  },

  backup: {
    autoBackupEnabled: false,
    backupFrequency: 'weekly',
    backupLocation: '',
    keepBackups: 5,
    lastBackupDate: null,
  },

  performance: {
    enableVirtualization: true,
    cacheEnabled: true,
    cacheSize: 100,
    preloadImages: true,
    hardwareAcceleration: true,
  },

  advanced: {
    developerMode: false,
    debugMode: false,
    telemetryEnabled: true,
    crashReportsEnabled: true,
    betaFeatures: false,
    experimentalFeatures: [],
  },

  desktop: DESKTOP_PROTECTION_DEFAULTS,

  loading: false,
  error: null,
  lastSaved: null,
};

// Thunks (actions asynchrones)
// -----------------------------

/**
 * Charge les paramètres depuis le stockage local
 */
export const loadSettings = createAsyncThunk<
  Partial<SettingsState>,
  void,
  { rejectValue: SerializedError }
>('settings/load', async (_, { rejectWithValue }) => {
  try {
    // Charger les paramètres depuis le localStorage
    const savedSettings = profileStorage.getItem('appSettings');

    if (savedSettings) {
      return JSON.parse(savedSettings);
    }

    return {};
  } catch (error) {
    return rejectWithValue({
      name: 'SettingsLoadError',
      message: 'Impossible de charger les paramètres',
      details: error,
    });
  }
});

/**
 * Sauvegarde les paramètres dans le stockage local
 */
export const saveSettings = createAsyncThunk<
  void,
  Partial<SettingsState>,
  { rejectValue: SerializedError }
>('settings/save', async (settings, { rejectWithValue }) => {
  try {
    // Sauvegarder les paramètres dans le localStorage
    profileStorage.setItem('appSettings', JSON.stringify(settings));
    return;
  } catch (error) {
    return rejectWithValue({
      name: 'SettingsSaveError',
      message: 'Impossible de sauvegarder les paramètres',
      details: error,
    });
  }
});

/**
 * Réinitialise les paramètres aux valeurs par défaut
 */
export const resetSettings = createAsyncThunk<void, void, { rejectValue: SerializedError }>(
  'settings/reset',
  async (_, { rejectWithValue }) => {
    try {
      // Supprimer les paramètres du localStorage
      profileStorage.removeItem('appSettings');
      return;
    } catch (error) {
      return rejectWithValue({
        name: 'SettingsResetError',
        message: 'Impossible de réinitialiser les paramètres',
        details: error,
      });
    }
  }
);

// Slice
const settingsSlice = createSlice({
  name: 'settings',
  initialState,
  reducers: {
    // Actions synchrones pour mettre à jour les paramètres

    // Général
    setLanguage(state, action: PayloadAction<string>) {
      state.general.language = action.payload;
      state.lastSaved = new Date().toISOString();
    },

    setDateFormat(state, action: PayloadAction<string>) {
      state.general.dateFormat = action.payload;
      state.lastSaved = new Date().toISOString();
    },

    setTimeFormat(state, action: PayloadAction<'12h' | '24h'>) {
      state.general.timeFormat = action.payload;
      state.lastSaved = new Date().toISOString();
    },

    setFirstDayOfWeek(state, action: PayloadAction<0 | 1>) {
      state.general.firstDayOfWeek = action.payload;
      state.lastSaved = new Date().toISOString();
    },

    // Affichage
    setDefaultViewMode(state, action: PayloadAction<ViewMode>) {
      state.display.defaultViewMode = action.payload;
      state.lastSaved = new Date().toISOString();
    },

    setDefaultSort(state, action: PayloadAction<{ field: SortOption; order: SortDirection }>) {
      state.display.defaultSortBy = action.payload.field;
      state.display.defaultSortOrder = action.payload.order;
      state.lastSaved = new Date().toISOString();
    },

    setItemsPerPage(state, action: PayloadAction<number>) {
      state.display.itemsPerPage = action.payload;
      state.lastSaved = new Date().toISOString();
    },

    setShowHiddenFiles(state, action: PayloadAction<boolean>) {
      state.display.showHiddenFiles = action.payload;
      state.lastSaved = new Date().toISOString();
    },

    setCompactMode(state, action: PayloadAction<boolean>) {
      state.display.compactMode = action.payload;
      state.lastSaved = new Date().toISOString();
    },

    setGridSize(state, action: PayloadAction<'small' | 'medium' | 'large'>) {
      state.display.gridSize = action.payload;
      state.lastSaved = new Date().toISOString();
    },

    // Sécurité
    setAutoLock(state, action: PayloadAction<{ enabled: boolean; timeout?: number }>) {
      state.security.autoLockEnabled = action.payload.enabled;
      if (action.payload.timeout !== undefined) {
        state.security.autoLockTimeout = action.payload.timeout;
      }
      state.lastSaved = new Date().toISOString();
    },

    setEncryptionEnabled(state, action: PayloadAction<boolean>) {
      state.security.encryptionEnabled = action.payload;
      state.lastSaved = new Date().toISOString();
    },

    setBiometricAuth(state, action: PayloadAction<boolean>) {
      state.security.biometricAuthEnabled = action.payload;
      state.lastSaved = new Date().toISOString();
    },

    setSessionTimeout(state, action: PayloadAction<number>) {
      state.security.sessionTimeout = action.payload;
      state.lastSaved = new Date().toISOString();
    },

    // Synchronisation
    setAutoSync(state, action: PayloadAction<{ enabled: boolean; interval?: number }>) {
      state.sync.autoSyncEnabled = action.payload.enabled;
      if (action.payload.interval !== undefined) {
        state.sync.syncInterval = action.payload.interval;
      }
      state.lastSaved = new Date().toISOString();
    },

    setConflictResolution(state, action: PayloadAction<'manual' | 'local' | 'remote' | 'newest'>) {
      state.sync.conflictResolution = action.payload;
      state.lastSaved = new Date().toISOString();
    },

    addSyncFolder(state, action: PayloadAction<string>) {
      if (!state.sync.syncFolders.includes(action.payload)) {
        state.sync.syncFolders.push(action.payload);
        state.lastSaved = new Date().toISOString();
      }
    },

    removeSyncFolder(state, action: PayloadAction<string>) {
      state.sync.syncFolders = state.sync.syncFolders.filter((id) => id !== action.payload);
      state.lastSaved = new Date().toISOString();
    },

    // Notifications
    setNotificationsEnabled(state, action: PayloadAction<boolean>) {
      state.notifications.enabled = action.payload;
      state.lastSaved = new Date().toISOString();
    },

    setNotificationSound(state, action: PayloadAction<boolean>) {
      state.notifications.soundEnabled = action.payload;
      state.lastSaved = new Date().toISOString();
    },

    setDesktopNotifications(state, action: PayloadAction<boolean>) {
      state.notifications.desktopNotifications = action.payload;
      state.lastSaved = new Date().toISOString();
    },

    setReminderNotifications(state, action: PayloadAction<boolean>) {
      state.notifications.reminderNotifications = action.payload;
      state.lastSaved = new Date().toISOString();
    },

    setNotificationPosition(
      state,
      action: PayloadAction<'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'>
    ) {
      state.notifications.notificationPosition = action.payload;
      state.lastSaved = new Date().toISOString();
    },

    // Sauvegarde
    setAutoBackup(
      state,
      action: PayloadAction<{ enabled: boolean; frequency?: 'daily' | 'weekly' | 'monthly' }>
    ) {
      state.backup.autoBackupEnabled = action.payload.enabled;
      if (action.payload.frequency) {
        state.backup.backupFrequency = action.payload.frequency;
      }
      state.lastSaved = new Date().toISOString();
    },

    setBackupLocation(state, action: PayloadAction<string>) {
      state.backup.backupLocation = action.payload;
      state.lastSaved = new Date().toISOString();
    },

    updateLastBackupDate(state) {
      state.backup.lastBackupDate = new Date().toISOString();
    },

    // Performance
    setVirtualization(state, action: PayloadAction<boolean>) {
      state.performance.enableVirtualization = action.payload;
      state.lastSaved = new Date().toISOString();
    },

    setCacheEnabled(state, action: PayloadAction<boolean>) {
      state.performance.cacheEnabled = action.payload;
      state.lastSaved = new Date().toISOString();
    },

    setHardwareAcceleration(state, action: PayloadAction<boolean>) {
      state.performance.hardwareAcceleration = action.payload;
      state.lastSaved = new Date().toISOString();
    },

    // Avancé
    setDeveloperMode(state, action: PayloadAction<boolean>) {
      state.advanced.developerMode = action.payload;
      state.lastSaved = new Date().toISOString();
    },

    setDebugMode(state, action: PayloadAction<boolean>) {
      state.advanced.debugMode = action.payload;
      state.lastSaved = new Date().toISOString();
    },

    setTelemetry(state, action: PayloadAction<boolean>) {
      state.advanced.telemetryEnabled = action.payload;
      state.lastSaved = new Date().toISOString();
    },

    setBetaFeatures(state, action: PayloadAction<boolean>) {
      state.advanced.betaFeatures = action.payload;
      state.lastSaved = new Date().toISOString();
    },

    toggleExperimentalFeature(state, action: PayloadAction<string>) {
      const featureName = action.payload;
      const index = state.advanced.experimentalFeatures.indexOf(featureName);

      if (index > -1) {
        state.advanced.experimentalFeatures.splice(index, 1);
      } else {
        state.advanced.experimentalFeatures.push(featureName);
      }
      state.lastSaved = new Date().toISOString();
    },

    // Protection du bureau (Wave 1)
    updateDesktopProtection(state, action: PayloadAction<Partial<DesktopProtectionSettings>>) {
      // L'état persisté peut ne pas contenir le groupe (voir le commentaire du
      // type) : toujours repartir des défauts avant d'appliquer le patch.
      state.desktop = {
        ...DESKTOP_PROTECTION_DEFAULTS,
        ...(state.desktop ?? {}),
        ...action.payload,
      };
      state.lastSaved = new Date().toISOString();
    },

    // Mettre à jour plusieurs paramètres en une fois
    updateSettings(state, action: PayloadAction<Partial<SettingsState>>) {
      return {
        ...state,
        ...action.payload,
        lastSaved: new Date().toISOString(),
      };
    },

    clearSettingsError(state) {
      state.error = null;
    },
  },
  extraReducers: (builder) => {
    builder
      // Gestion de loadSettings
      .addCase(loadSettings.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(loadSettings.fulfilled, (state, action) => {
        state.loading = false;

        // Fusionner les paramètres chargés avec l'état actuel
        if (action.payload.general) {
          state.general = { ...state.general, ...action.payload.general };
        }
        if (action.payload.display) {
          state.display = { ...state.display, ...action.payload.display };
        }
        if (action.payload.security) {
          state.security = { ...state.security, ...action.payload.security };
        }
        if (action.payload.sync) {
          state.sync = { ...state.sync, ...action.payload.sync };
        }
        if (action.payload.notifications) {
          state.notifications = { ...state.notifications, ...action.payload.notifications };
        }
        if (action.payload.backup) {
          state.backup = { ...state.backup, ...action.payload.backup };
        }
        if (action.payload.performance) {
          state.performance = { ...state.performance, ...action.payload.performance };
        }
        if (action.payload.advanced) {
          state.advanced = { ...state.advanced, ...action.payload.advanced };
        }
        if (action.payload.desktop) {
          state.desktop = {
            ...DESKTOP_PROTECTION_DEFAULTS,
            ...(state.desktop ?? {}),
            ...action.payload.desktop,
          };
        }
      })
      .addCase(loadSettings.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload ?? null;
      })

      // Gestion de saveSettings
      .addCase(saveSettings.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(saveSettings.fulfilled, (state) => {
        state.loading = false;
        state.lastSaved = new Date().toISOString();
      })
      .addCase(saveSettings.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload ?? null;
      })

      // Gestion de resetSettings
      .addCase(resetSettings.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(resetSettings.fulfilled, () => {
        // Retourner l'état initial
        return { ...initialState, lastSaved: new Date().toISOString() };
      })
      .addCase(resetSettings.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload ?? null;
      });
  },
});

// Exporter les actions
export const {
  // Général
  setLanguage,
  setDateFormat,
  setTimeFormat,
  setFirstDayOfWeek,

  // Affichage
  setDefaultViewMode,
  setDefaultSort,
  setItemsPerPage,
  setShowHiddenFiles,
  setCompactMode,
  setGridSize,

  // Sécurité
  setAutoLock,
  setEncryptionEnabled,
  setBiometricAuth,
  setSessionTimeout,

  // Synchronisation
  setAutoSync,
  setConflictResolution,
  addSyncFolder,
  removeSyncFolder,

  // Notifications
  setNotificationsEnabled,
  setNotificationSound,
  setDesktopNotifications,
  setReminderNotifications,
  setNotificationPosition,

  // Sauvegarde
  setAutoBackup,
  setBackupLocation,
  updateLastBackupDate,

  // Performance
  setVirtualization,
  setCacheEnabled,
  setHardwareAcceleration,

  // Avancé
  setDeveloperMode,
  setDebugMode,
  setTelemetry,
  setBetaFeatures,
  toggleExperimentalFeature,

  // Protection du bureau
  updateDesktopProtection,

  // Utilitaires
  updateSettings,
  clearSettingsError,
} = settingsSlice.actions;

// Sélecteur mémoïsé : les réglages "Protection du bureau" complétés par les
// défauts (l'état persisté peut prédater le groupe — voir le type).
export const selectDesktopProtection = createSelector(
  (state: { settings: SettingsState }) => state.settings.desktop,
  (desktop): DesktopProtectionSettings => ({
    ...DESKTOP_PROTECTION_DEFAULTS,
    ...(desktop ?? {}),
  })
);

// Exporter le reducer
export default settingsSlice.reducer;
