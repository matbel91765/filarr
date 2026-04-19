/**
 * Storage adapter — local Electron-only implementation.
 *
 * Cloud / BYOS / hybrid implementations have been removed from the public
 * source tree. The adapter delegates every call to the Electron main
 * process via IPC.
 */

import type { IStorageImplementation, Folder, Item, Reminder } from '../../types';

class StorageAdapter {
  private implementation: IStorageImplementation;

  constructor(implementation: IStorageImplementation) {
    this.implementation = implementation;
  }

  async saveFolder(folder: Folder): Promise<Folder> {
    return this.implementation.saveFolder(folder);
  }
  async getFolders(): Promise<Folder[]> {
    return this.implementation.getFolders();
  }
  async getFolder(id: string): Promise<Folder> {
    return this.implementation.getFolder(id);
  }
  async updateFolder(id: string, updatedFolder: Folder): Promise<Folder> {
    return this.implementation.updateFolder(id, updatedFolder);
  }
  async deleteFolder(id: string, permanent?: boolean): Promise<boolean> {
    return this.implementation.deleteFolder(id, permanent);
  }
  async addItemToFolder(folderId: string, item: Item): Promise<Folder> {
    return this.implementation.addItemToFolder(folderId, item);
  }
  async removeItemFromFolder(folderId: string, itemId: string): Promise<Folder> {
    return this.implementation.removeItemFromFolder(folderId, itemId);
  }
  async renameItem(
    parentId: string,
    itemId: string,
    oldName: string,
    newName: string
  ): Promise<boolean> {
    return this.implementation.renameItem(parentId, itemId, oldName, newName);
  }
  async readEncryptedFile(
    folderId: string,
    fileName: string,
    onProgress?: (percent: number) => void
  ): Promise<Buffer> {
    return this.implementation.readEncryptedFile(folderId, fileName, onProgress);
  }
  async saveEncryptedFile(folderId: string, fileName: string, content: Buffer): Promise<void> {
    return this.implementation.saveEncryptedFile(folderId, fileName, content);
  }
  async addReminder(itemId: string, reminder: Reminder): Promise<Reminder> {
    return this.implementation.addReminder(itemId, reminder);
  }
  async updateReminder(
    itemId: string,
    reminderId: string,
    updatedReminder: Partial<Reminder>
  ): Promise<Reminder> {
    return this.implementation.updateReminder(itemId, reminderId, updatedReminder);
  }
  async deleteReminder(itemId: string, reminderId: string): Promise<boolean> {
    return this.implementation.deleteReminder(itemId, reminderId);
  }
  async getAllReminders(): Promise<Reminder[]> {
    return this.implementation.getAllReminders();
  }
  async getReminders(itemId: string): Promise<Reminder[]> {
    return this.implementation.getReminders(itemId);
  }
  async getItem(id: string): Promise<Item> {
    return this.implementation.getItem(id);
  }
  async updateItemInFolder(
    folderId: string | null,
    itemId: string,
    itemData: Partial<Item>
  ): Promise<Item> {
    return this.implementation.updateItemInFolder(folderId, itemId, itemData);
  }
  async moveItem(
    itemId: string,
    sourceFolderId: string,
    targetFolderId: string
  ): Promise<import('../../types').MoveResult> {
    return this.implementation.moveItem(itemId, sourceFolderId, targetFolderId);
  }
  async copyItem(
    itemId: string,
    sourceFolderId: string,
    targetFolderId: string,
    newName?: string
  ): Promise<import('../../types').CopyResult> {
    return this.implementation.copyItem(itemId, sourceFolderId, targetFolderId, newName);
  }
}

class ElectronStorageImplementation implements IStorageImplementation {
  async saveFolder(folder: Folder): Promise<Folder> {
    return window.electron.ipcRenderer.invoke('saveFolder', folder);
  }
  async getFolders(): Promise<Folder[]> {
    return window.electron.ipcRenderer.invoke('getFolders');
  }
  async getFolder(id: string): Promise<Folder> {
    return window.electron.ipcRenderer.invoke('getFolder', id);
  }
  async updateFolder(id: string, updatedFolder: Folder): Promise<Folder> {
    return window.electron.ipcRenderer.invoke('updateFolder', id, updatedFolder);
  }
  async deleteFolder(id: string, permanent: boolean = false): Promise<boolean> {
    return window.electron.ipcRenderer.invoke('storage:deleteFolder', id, permanent);
  }
  async addItemToFolder(folderId: string, item: Item): Promise<Folder> {
    return window.electron.ipcRenderer.invoke('addItemToFolder', folderId, item);
  }
  async removeItemFromFolder(folderId: string, itemId: string): Promise<Folder> {
    return window.electron.ipcRenderer.invoke('removeItemFromFolder', folderId, itemId);
  }
  async renameItem(
    parentId: string,
    itemId: string,
    oldName: string,
    newName: string
  ): Promise<boolean> {
    return window.electron.ipcRenderer.invoke('renameItem', parentId, itemId, oldName, newName);
  }
  async readEncryptedFile(folderId: string, fileName: string): Promise<Buffer> {
    return window.electron.ipcRenderer.invoke('readEncryptedFile', folderId, fileName);
  }
  async saveEncryptedFile(folderId: string, fileName: string, content: Buffer): Promise<void> {
    return window.electron.ipcRenderer.invoke('saveEncryptedFile', folderId, fileName, content);
  }
  async addReminder(itemId: string, reminder: Reminder): Promise<Reminder> {
    return window.electron.ipcRenderer.invoke('addReminder', itemId, reminder);
  }
  async updateReminder(
    itemId: string,
    reminderId: string,
    updatedReminder: Partial<Reminder>
  ): Promise<Reminder> {
    return window.electron.ipcRenderer.invoke(
      'updateReminder',
      itemId,
      reminderId,
      updatedReminder
    );
  }
  async deleteReminder(itemId: string, reminderId: string): Promise<boolean> {
    return window.electron.ipcRenderer.invoke('deleteReminder', itemId, reminderId);
  }
  async getAllReminders(): Promise<Reminder[]> {
    return window.electron.ipcRenderer.invoke('getAllReminders');
  }
  async getReminders(itemId: string): Promise<Reminder[]> {
    return window.electron.ipcRenderer.invoke('getReminders', itemId);
  }
  async getItem(id: string): Promise<Item> {
    return window.electron.ipcRenderer.invoke('getItem', id);
  }
  async updateItemInFolder(
    folderId: string | null,
    itemId: string,
    itemData: Partial<Item>
  ): Promise<Item> {
    return window.electron.ipcRenderer.invoke('updateItemInFolder', folderId, itemId, itemData);
  }
  async moveItem(
    itemId: string,
    sourceFolderId: string,
    targetFolderId: string
  ): Promise<import('../../types').MoveResult> {
    return window.electron.ipcRenderer.invoke('moveItem', itemId, sourceFolderId, targetFolderId);
  }
  async copyItem(
    itemId: string,
    sourceFolderId: string,
    targetFolderId: string,
    newName?: string
  ): Promise<import('../../types').CopyResult> {
    return window.electron.ipcRenderer.invoke(
      'copyItem',
      itemId,
      sourceFolderId,
      targetFolderId,
      newName
    );
  }
}

export type StorageMode = 'local';

export function createStorageAdapter(_mode: StorageMode = 'local'): StorageAdapter {
  return new StorageAdapter(new ElectronStorageImplementation());
}

const defaultAdapter = createStorageAdapter('local');

export default defaultAdapter;
