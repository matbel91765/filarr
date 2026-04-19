/**
 * Types globaux pour TypeScript
 * Déclarations de types pour les APIs globales (window.electron, etc.)
 */

/**
 * Interface pour l'API Electron exposée via le preload
 */
interface ElectronAPI {
  ipcRenderer: {
    invoke(channel: string, ...args: any[]): Promise<any>;
    send(channel: string, data: any): void;
    on(channel: string, listener: (...args: any[]) => void): void;
    once(channel: string, listener: (...args: any[]) => void): void;
    removeListener(channel: string, listener: (...args: any[]) => void): void;
    removeAllListeners(channel: string): void;
  };
  getHostname?: () => string;

  // Generic invoke method for any channel
  invoke(channel: string, ...args: any[]): Promise<any>;

  // Méthodes helper pour la corbeille
  invoke(channel: 'storage:getTrashItems'): Promise<any[]>;
  invoke(channel: 'storage:restoreItem', itemId: string): Promise<any>;
  invoke(channel: 'storage:permanentlyDeleteItem', itemId: string, folderId?: string): Promise<boolean>;
  invoke(channel: 'storage:emptyTrash', olderThanDays?: number): Promise<number>;
  invoke(channel: 'storage:autoCleanupTrash'): Promise<number>;
  invoke(channel: 'storage:deleteFolder', id: string, permanent?: boolean): Promise<boolean>;
  invoke(channel: 'storage:deleteFile', folderId: string, fileName: string, permanent?: boolean): Promise<any>;
}

/**
 * Extension de l'interface Window pour inclure l'API Electron
 */
declare global {
  interface Window {
    electron: ElectronAPI;
  }
}

export {};
