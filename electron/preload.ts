import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

/**
 * IPC Channel Allowlists
 * Only these channels can be used from the renderer process.
 */
const ALLOWED_INVOKE_CHANNELS = new Set([
  // App Config
  'getConfig', 'saveConfig',
  // Folders
  'saveFolder', 'getFolders', 'getFolderItems', 'getFolder',
  'updateFolder', 'deleteFolder',
  // Items
  'addItemToFolder', 'removeItemFromFolder', 'updateItemInFolder',
  'getItem', 'updateItem', 'moveItem', 'copyItem',
  // Files
  'saveFile', 'readFile', 'deleteFile', 'openFile',
  'readEncryptedFile', 'readEncryptedFileForCopy',
  'saveEncryptedFile', 'openEncryptedFile', 'renameItem',
  'readTempFile', 'deleteTempFile',
  'openVaultFile', 'downloadItem', 'downloadMultipleAsZip', 'writeRawFile',
  'prepareDragFile',
  // Reminders
  'addReminder', 'updateReminder', 'deleteReminder',
  'getAllReminders', 'getReminders', 'getReminder',
  'markReminderAsRead', 'markReminderAsDone', 'snoozeReminder',
  'getNotificationSettings', 'updateNotificationSettings',
  // Dialogs
  'showSaveDialog', 'showOpenDialog',
  // Storage
  'getStorageQuota', 'updateStorageQuota',
  // Trash
  'storage:getTrashItems', 'storage:restoreItem',
  'storage:permanentlyDeleteItem', 'storage:emptyTrash',
  'storage:autoCleanupTrash', 'storage:deleteFolder', 'storage:deleteFile',
  // Password Manager
  'pm:saveDatabase', 'pm:loadDatabase', 'pm:deleteDatabase',
  'pm:exportToFile', 'pm:importFromFile', 'pm:copyToClipboard',
  // Crypto
  'crypto:argon2Hash', 'crypto:argon2Verify', 'crypto:argon2DeriveKey',
  'crypto:hashPassword', 'crypto:verifyPassword',
  // Secure password hash store (file/folder passwords)
  'secureStore:getPasswordHashes', 'secureStore:setPasswordHashes',
  // Extension Bridge — disabled until Password Manager ships (v2.x)
  // 'extension:getStatus', 'extension:generatePairingCode',
  // 'extension:removePairedClient', 'extension:setPort',
  // Desktop Notifications
  'showDesktopNotification',
  // Export
  'export:gdprData',
  // Profiles
  'profile:getManifest', 'profile:create', 'profile:update', 'profile:delete',
  'profile:activate', 'profile:reorder', 'profile:verifyPin', 'profile:resetPin',
  'profile:fullReset',
  // Notes (encrypted disk persistence)
  'notes:save', 'notes:load',
  // Note version history (encrypted on-disk snapshots)
  'note-versions:list', 'note-versions:get', 'note-versions:delete', 'note-versions:clear',
  // Generic file open dialog
  'dialog:openFile',
  // External import (Obsidian, Notion, Evernote)
  'import:selectDirectory', 'import:selectFile', 'import:readDirectory', 'import:readFile',
  // Auto Link Title (fetch page title bypassing CORS)
  'fetchPageTitle',
  // Bookmark (fetch page metadata bypassing CORS)
  'fetchPageMetadata',
  // Local encrypted blob store
  'hybrid:writeRawBlob', 'hybrid:readRawBlob', 'hybrid:fileExists',
  'hybrid:computeChecksum', 'hybrid:deleteBlob',
  'hybrid:saveWrappedKey', 'hybrid:loadWrappedKey',
  'hybrid:storeFEK', 'hybrid:loadFEK', 'hybrid:clearFEK', 'hybrid:hasKey',
  // Vault export/import
  'vault:exportZip', 'vault:selectImportFile', 'vault:importZip', 'file:readForExport', 'file:getLocalPath',
  // Persistent flags (survives localStorage resets)
  'flag:get', 'flag:set', 'flag:remove',
  // Redux state sync
  'redux-state-changed',
  // Print
  'pdf:printRecoveryCodes',
  // Security (local FEK / vault password)
  'security:getEnhancedLock', 'security:setEnhancedLock',
  'security:fekStatus',
]);

const ALLOWED_SEND_CHANNELS = new Set([
  'restart_app', 'ondragstart', 'redux-state-changed', 'open-external',
]);

const ALLOWED_RECEIVE_CHANNELS = new Set([
  'foldersUpdated', 'update_available', 'update_downloaded', 'update_download_progress',
  'upcomingReminders', 'file-changed',
  'update-install-confirmed', 'show-notification',
  'folders-updated', 'files-updated', 'notes-updated', 'profiles-updated', 'main-process-error',
  'system-theme-changed',
]);

/**
 * IPC Renderer API exposed to the renderer process
 */
interface IpcRendererAPI {
  send: (channel: string, data: any) => void;
  on: (channel: string, func: (...args: any[]) => void) => void;
  invoke: (channel: string, ...args: any[]) => Promise<any>;
  removeListener: (channel: string, func: (...args: any[]) => void) => void;
}

/**
 * Electron API exposed to the renderer process via context bridge
 */
export interface ElectronAPI {
  ipcRenderer: IpcRendererAPI;
}

/**
 * Global Window type extension
 */
declare global {
  interface Window {
    electron: ElectronAPI;
    electronAPI: { getVersion: () => string };
  }
}

/**
 * Context Bridge - Exposes Electron API to renderer process securely
 * All channels are validated against allowlists.
 */
contextBridge.exposeInMainWorld('electron', {
  ipcRenderer: {
    send: (channel: string, data: any): void => {
      if (!ALLOWED_SEND_CHANNELS.has(channel)) {
        throw new Error(`Blocked send on unauthorized channel: ${channel}`);
      }
      ipcRenderer.send(channel, data);
    },
    on: (channel: string, func: (...args: any[]) => void): void => {
      if (!ALLOWED_RECEIVE_CHANNELS.has(channel)) {
        throw new Error(`Blocked listener on unauthorized channel: ${channel}`);
      }
      ipcRenderer.on(channel, (_event: IpcRendererEvent, ...args: any[]) => func(...args));
    },
    invoke: (channel: string, ...args: any[]): Promise<any> => {
      if (!ALLOWED_INVOKE_CHANNELS.has(channel)) {
        return Promise.reject(new Error(`Blocked invoke on unauthorized channel: ${channel}`));
      }
      return ipcRenderer.invoke(channel, ...args);
    },
    removeListener: (channel: string, func: (...args: any[]) => void): void => {
      ipcRenderer.removeListener(channel, func);
    },
  },
} as ElectronAPI);

// Expose app version synchronously (from package.json at build time)
contextBridge.exposeInMainWorld('electronAPI', {
  getVersion: () => ipcRenderer.sendSync('get-app-version'),
});
