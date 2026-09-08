/**
 * Application Configuration
 *
 * This file contains the application configuration, including the choice
 * of storage mechanism (local or cloud) and other parameters.
 */

/**
 * Application configuration interface
 */
export type StorageMode = 'local' | 'hybrid' | 'cloud' | 'byos';

export interface AppConfig {
  // Storage
  useCloudStorage: boolean;
  storageMode: StorageMode;
  cloudStorageUrl: string;
  authToken: string | null;

  // User Interface
  theme: 'light' | 'dark' | 'system';
  language: string;

  // Features
  enableNotifications: boolean;
  enableAutoSave: boolean;
  autoSaveInterval: number;

  // Security
  encryptionEnabled: boolean;
  encryptionAlgorithm: string;

  // Synchronization
  syncEnabled: boolean;
  syncInterval: number;

  // Development
  isDevelopment: boolean;
  debugMode: boolean;
}

/**
 * Default configuration
 */
const defaultConfig: AppConfig = {
  // Storage
  useCloudStorage: false,
  storageMode: 'local' as StorageMode,
  cloudStorageUrl: 'https://api.example.com/v1',
  authToken: null,

  // User Interface
  theme: 'light',
  language: 'fr',

  // Features
  enableNotifications: true,
  enableAutoSave: true,
  autoSaveInterval: 5 * 60 * 1000,

  // Security
  encryptionEnabled: true,
  encryptionAlgorithm: 'AES-256-GCM',

  // Synchronization
  syncEnabled: false,
  syncInterval: 30 * 1000,

  // Development
  isDevelopment: process.env.NODE_ENV === 'development',
  debugMode: false,
};

/**
 * Development environment configuration
 */
const developmentConfig: AppConfig = {
  ...defaultConfig,
  debugMode: true,
  cloudStorageUrl: 'https://api.filarr.com', // Cloudflare Worker (filarr-api) — routes at root, no /v1
};

/**
 * Production environment configuration
 */
const productionConfig: AppConfig = {
  ...defaultConfig,
  cloudStorageUrl: 'https://api.filarr.com', // Cloudflare Worker (filarr-api) — routes at root, no /v1
};

/**
 * Test environment configuration
 */
const testConfig: AppConfig = {
  ...defaultConfig,
  cloudStorageUrl: 'https://api-test.filarr.com/v1', // TODO Phase 2 : URL finale du Worker test
};

/**
 * Get default configuration based on environment
 */
export const getDefaultConfig = (): AppConfig => {
  if (process.env.NODE_ENV === 'development') {
    return developmentConfig;
  } else if (process.env.NODE_ENV === 'test') {
    return testConfig;
  } else {
    return productionConfig;
  }
};

/**
 * Current application configuration
 */
let currentConfig: AppConfig = getDefaultConfig();

/**
 * Load configuration from local storage
 */
export const loadConfig = async (): Promise<AppConfig> => {
  try {
    const storedConfig = await window.electron.ipcRenderer.invoke('getConfig');
    return {
      ...getDefaultConfig(),
      ...storedConfig,
    };
  } catch (error) {
    console.error('Error loading configuration:', error);
    return getDefaultConfig();
  }
};

/**
 * Save configuration to local storage
 */
export const saveConfig = async (config: AppConfig): Promise<void> => {
  try {
    await window.electron.ipcRenderer.invoke('saveConfig', config);
  } catch (error) {
    console.error('Error saving configuration:', error);
  }
};

/**
 * Initialize application configuration
 */
export const initConfig = async (): Promise<AppConfig> => {
  currentConfig = await loadConfig();
  return currentConfig;
};

/**
 * Get current application configuration
 */
export const getConfig = (): AppConfig => {
  return currentConfig;
};

/**
 * Update application configuration
 */
export const updateConfig = async (newConfig: Partial<AppConfig>): Promise<AppConfig> => {
  currentConfig = {
    ...currentConfig,
    ...newConfig,
  };

  // Keep the API client base URL in sync when the cloud storage URL changes
  if (newConfig.cloudStorageUrl) {
    // Lazy import to avoid circular dependency (apiClient imports config)
    const { updateApiClientBaseURL } = await import('./services/network/apiClient');
    updateApiClientBaseURL(newConfig.cloudStorageUrl);
  }

  await saveConfig(currentConfig);
  return currentConfig;
};

/**
 * Enable or disable cloud storage
 */
export const setCloudStorage = async (
  enabled: boolean,
  authToken: string | null = null
): Promise<AppConfig> => {
  return await updateConfig({
    useCloudStorage: enabled,
    authToken: authToken,
  });
};

/**
 * Enable or disable notifications
 */
export const setNotifications = async (enabled: boolean): Promise<AppConfig> => {
  return await updateConfig({
    enableNotifications: enabled,
  });
};

/**
 * Change interface theme
 */
export const setTheme = async (theme: 'light' | 'dark' | 'system'): Promise<AppConfig> => {
  return await updateConfig({
    theme,
  });
};

/**
 * Change interface language
 */
export const setLanguage = async (language: string): Promise<AppConfig> => {
  return await updateConfig({
    language,
  });
};

export default {
  getConfig,
  initConfig,
  updateConfig,
  setCloudStorage,
  setNotifications,
  setTheme,
  setLanguage,
};
