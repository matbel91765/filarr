/**
 * Application configuration — local-only build.
 *
 * Cloud sync, hosted backend and BYOS storage have been removed from the
 * public source tree. Forks that wish to reintroduce remote storage
 * should layer their own config on top of this file.
 */

export type StorageMode = 'local';

export interface AppConfig {
  storageMode: StorageMode;

  theme: 'light' | 'dark' | 'system';
  language: string;

  enableNotifications: boolean;
  enableAutoSave: boolean;
  autoSaveInterval: number;

  encryptionEnabled: boolean;
  encryptionAlgorithm: string;

  isDevelopment: boolean;
  debugMode: boolean;
}

const defaultConfig: AppConfig = {
  storageMode: 'local',
  theme: 'light',
  language: 'fr',
  enableNotifications: true,
  enableAutoSave: true,
  autoSaveInterval: 5 * 60 * 1000,
  encryptionEnabled: true,
  encryptionAlgorithm: 'AES-256-GCM',
  isDevelopment: process.env.NODE_ENV === 'development',
  debugMode: false,
};

export const getDefaultConfig = (): AppConfig => ({
  ...defaultConfig,
  debugMode: process.env.NODE_ENV === 'development',
});

let currentConfig: AppConfig = getDefaultConfig();

export const loadConfig = async (): Promise<AppConfig> => {
  try {
    const storedConfig = await window.electron.ipcRenderer.invoke('getConfig');
    return { ...getDefaultConfig(), ...storedConfig };
  } catch (error) {
    console.error('Error loading configuration:', error);
    return getDefaultConfig();
  }
};

export const saveConfig = async (config: AppConfig): Promise<void> => {
  try {
    await window.electron.ipcRenderer.invoke('saveConfig', config);
  } catch (error) {
    console.error('Error saving configuration:', error);
  }
};

export const initConfig = async (): Promise<AppConfig> => {
  currentConfig = await loadConfig();
  return currentConfig;
};

export const getConfig = (): AppConfig => currentConfig;

export const updateConfig = async (newConfig: Partial<AppConfig>): Promise<AppConfig> => {
  currentConfig = { ...currentConfig, ...newConfig };
  await saveConfig(currentConfig);
  return currentConfig;
};

export const setNotifications = (enabled: boolean) => updateConfig({ enableNotifications: enabled });
export const setTheme = (theme: 'light' | 'dark' | 'system') => updateConfig({ theme });
export const setLanguage = (language: string) => updateConfig({ language });

export default {
  getConfig,
  initConfig,
  updateConfig,
  setNotifications,
  setTheme,
  setLanguage,
};
