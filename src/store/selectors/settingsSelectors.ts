/**
 * Sélecteurs pour les paramètres (Settings)
 *
 * Ces sélecteurs optimisent l'accès aux paramètres de l'application dans le store Redux,
 * en utilisant la memoization pour éviter les calculs redondants.
 */

import { createSelector } from '@reduxjs/toolkit';
import type { RootState } from '../index';

// Sélecteurs de base (non-memoized)
const selectSettingsState = (state: RootState) => state.settings;

// Sélecteurs memoized par catégorie de paramètres
// ================================================

/**
 * Sélectionne tous les paramètres
 */
export const selectAllSettings = createSelector(
  [selectSettingsState],
  (settings) => settings
);

/**
 * Paramètres généraux
 */
export const selectGeneralSettings = createSelector(
  [selectSettingsState],
  (settings) => settings.general
);

export const selectLanguage = createSelector(
  [selectGeneralSettings],
  (general) => general.language
);

export const selectDateFormat = createSelector(
  [selectGeneralSettings],
  (general) => general.dateFormat
);

export const selectTimeFormat = createSelector(
  [selectGeneralSettings],
  (general) => general.timeFormat
);

export const selectFirstDayOfWeek = createSelector(
  [selectGeneralSettings],
  (general) => general.firstDayOfWeek
);

export const selectTimezone = createSelector(
  [selectGeneralSettings],
  (general) => general.timezone
);

/**
 * Paramètres d'affichage
 */
export const selectDisplaySettings = createSelector(
  [selectSettingsState],
  (settings) => settings.display
);

export const selectDefaultViewMode = createSelector(
  [selectDisplaySettings],
  (display) => display.defaultViewMode
);

export const selectDefaultSort = createSelector(
  [selectDisplaySettings],
  (display) => ({
    field: display.defaultSortBy,
    order: display.defaultSortOrder
  })
);

export const selectItemsPerPage = createSelector(
  [selectDisplaySettings],
  (display) => display.itemsPerPage
);

export const selectShowHiddenFiles = createSelector(
  [selectDisplaySettings],
  (display) => display.showHiddenFiles
);

export const selectShowFileExtensions = createSelector(
  [selectDisplaySettings],
  (display) => display.showFileExtensions
);

export const selectCompactMode = createSelector(
  [selectDisplaySettings],
  (display) => display.compactMode
);

export const selectGridSize = createSelector(
  [selectDisplaySettings],
  (display) => display.gridSize
);

/**
 * Paramètres de sécurité
 */
export const selectSecuritySettings = createSelector(
  [selectSettingsState],
  (settings) => settings.security
);

export const selectAutoLockSettings = createSelector(
  [selectSecuritySettings],
  (security) => ({
    enabled: security.autoLockEnabled,
    timeout: security.autoLockTimeout
  })
);

export const selectEncryptionEnabled = createSelector(
  [selectSecuritySettings],
  (security) => security.encryptionEnabled
);

export const selectDefaultEncryptionAlgorithm = createSelector(
  [selectSecuritySettings],
  (security) => security.defaultEncryptionAlgorithm
);

export const selectBiometricAuthEnabled = createSelector(
  [selectSecuritySettings],
  (security) => security.biometricAuthEnabled
);

export const selectSessionTimeout = createSelector(
  [selectSecuritySettings],
  (security) => security.sessionTimeout
);

/**
 * Paramètres de notifications
 */
export const selectNotificationSettings = createSelector(
  [selectSettingsState],
  (settings) => settings.notifications
);

export const selectNotificationsEnabled = createSelector(
  [selectNotificationSettings],
  (notifications) => notifications.enabled
);

export const selectNotificationSoundEnabled = createSelector(
  [selectNotificationSettings],
  (notifications) => notifications.soundEnabled
);

export const selectDesktopNotificationsEnabled = createSelector(
  [selectNotificationSettings],
  (notifications) => notifications.desktopNotifications
);

export const selectReminderNotificationsEnabled = createSelector(
  [selectNotificationSettings],
  (notifications) => notifications.reminderNotifications
);

export const selectNotificationPosition = createSelector(
  [selectNotificationSettings],
  (notifications) => notifications.notificationPosition
);

export const selectNotificationDuration = createSelector(
  [selectNotificationSettings],
  (notifications) => notifications.notificationDuration
);

/**
 * Paramètres de sauvegarde
 */
export const selectBackupSettings = createSelector(
  [selectSettingsState],
  (settings) => settings.backup
);

export const selectAutoBackupSettings = createSelector(
  [selectBackupSettings],
  (backup) => ({
    enabled: backup.autoBackupEnabled,
    frequency: backup.backupFrequency,
    keepBackups: backup.keepBackups
  })
);

export const selectBackupLocation = createSelector(
  [selectBackupSettings],
  (backup) => backup.backupLocation
);

export const selectLastBackupDate = createSelector(
  [selectBackupSettings],
  (backup) => backup.lastBackupDate
);

/**
 * Paramètres de performance
 */
export const selectPerformanceSettings = createSelector(
  [selectSettingsState],
  (settings) => settings.performance
);

export const selectVirtualizationEnabled = createSelector(
  [selectPerformanceSettings],
  (performance) => performance.enableVirtualization
);

export const selectCacheSettings = createSelector(
  [selectPerformanceSettings],
  (performance) => ({
    enabled: performance.cacheEnabled,
    size: performance.cacheSize
  })
);

export const selectHardwareAccelerationEnabled = createSelector(
  [selectPerformanceSettings],
  (performance) => performance.hardwareAcceleration
);

/**
 * Paramètres avancés
 */
export const selectAdvancedSettings = createSelector(
  [selectSettingsState],
  (settings) => settings.advanced
);

export const selectDeveloperMode = createSelector(
  [selectAdvancedSettings],
  (advanced) => advanced.developerMode
);

export const selectDebugMode = createSelector(
  [selectAdvancedSettings],
  (advanced) => advanced.debugMode
);

export const selectTelemetryEnabled = createSelector(
  [selectAdvancedSettings],
  (advanced) => advanced.telemetryEnabled
);

export const selectBetaFeatures = createSelector(
  [selectAdvancedSettings],
  (advanced) => advanced.betaFeatures
);

export const selectExperimentalFeatures = createSelector(
  [selectAdvancedSettings],
  (advanced) => advanced.experimentalFeatures
);

export const selectIsExperimentalFeatureEnabled = (featureName: string) => createSelector(
  [selectExperimentalFeatures],
  (features) => features.includes(featureName)
);

/**
 * Métadonnées des paramètres
 */
export const selectIsLoadingSettings = createSelector(
  [selectSettingsState],
  (settings) => settings.loading
);

export const selectSettingsError = createSelector(
  [selectSettingsState],
  (settings) => settings.error
);

export const selectLastSaved = createSelector(
  [selectSettingsState],
  (settings) => settings.lastSaved
);

/**
 * Sélecteurs combinés et dérivés
 */

/**
 * Vérifie si les notifications sont activées globalement et pour les rappels
 */
export const selectShouldShowReminderNotifications = createSelector(
  [selectNotificationsEnabled, selectReminderNotificationsEnabled],
  (globalEnabled, reminderEnabled) => globalEnabled && reminderEnabled
);

/**
 * Retourne les paramètres d'affichage complets pour l'UI
 */
export const selectUIDisplayPreferences = createSelector(
  [selectDisplaySettings, selectCompactMode, selectGridSize],
  (display, compactMode, gridSize) => ({
    viewMode: display.defaultViewMode,
    sortBy: display.defaultSortBy,
    sortOrder: display.defaultSortOrder,
    itemsPerPage: display.itemsPerPage,
    compactMode,
    gridSize,
    showHiddenFiles: display.showHiddenFiles,
    showFileExtensions: display.showFileExtensions
  })
);

/**
 * Retourne tous les paramètres de sécurité critiques
 */
export const selectSecurityStatus = createSelector(
  [selectSecuritySettings],
  (security) => ({
    isSecure: security.encryptionEnabled && security.requirePasswordOnStartup,
    encryptionEnabled: security.encryptionEnabled,
    autoLockEnabled: security.autoLockEnabled,
    biometricEnabled: security.biometricAuthEnabled,
    sessionTimeout: security.sessionTimeout
  })
);

/**
 * Retourne un résumé des paramètres de sauvegarde
 */
export const selectBackupStatus = createSelector(
  [selectBackupSettings],
  (backup) => ({
    isConfigured: backup.autoBackupEnabled && backup.backupLocation !== '',
    enabled: backup.autoBackupEnabled,
    lastBackup: backup.lastBackupDate,
    frequency: backup.backupFrequency,
    needsBackup: backup.lastBackupDate
      ? isBackupNeeded(backup.lastBackupDate, backup.backupFrequency)
      : true
  })
);

/**
 * Fonction helper pour déterminer si une sauvegarde est nécessaire
 */
function isBackupNeeded(lastBackupDate: string, frequency: 'daily' | 'weekly' | 'monthly'): boolean {
  const lastBackup = new Date(lastBackupDate);
  const now = new Date();
  const diffInDays = Math.floor((now.getTime() - lastBackup.getTime()) / (1000 * 60 * 60 * 24));

  switch (frequency) {
    case 'daily':
      return diffInDays >= 1;
    case 'weekly':
      return diffInDays >= 7;
    case 'monthly':
      return diffInDays >= 30;
    default:
      return false;
  }
}

/**
 * Retourne les paramètres exportables (sans métadonnées)
 */
export const selectExportableSettings = createSelector(
  [selectSettingsState],
  (settings) => ({
    general: settings.general,
    display: settings.display,
    security: {
      ...settings.security,
      // Ne pas exporter les mots de passe ou tokens
    },
    notifications: settings.notifications,
    backup: settings.backup,
    performance: settings.performance,
    advanced: settings.advanced
  })
);

/**
 * Vérifie si les paramètres ont été modifiés récemment (moins de 5 minutes)
 */
export const selectHasRecentChanges = createSelector(
  [selectLastSaved],
  (lastSaved) => {
    if (!lastSaved) return false;
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    return new Date(lastSaved) > fiveMinutesAgo;
  }
);
