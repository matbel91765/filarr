/**
 * Adaptateur de stockage (TypeScript)
 *
 * Ce module sert d'interface entre la logique métier et les mécanismes de stockage spécifiques
 * (Electron/local ou cloud à l'avenir). Il permet de découpler la logique métier des détails
 * d'implémentation du stockage.
 */

import type { IStorageImplementation, Folder, Item, Reminder, VaultShortcutRef } from '../../types';
import apiClient from '../network/apiClient';
import { getConfig } from '../../config';
import { encryptFileContent, decryptFileContent, hasHybridKey } from '../auth/hybridCrypto';

/**
 * Sentinelle de racine pour les déplacements (`moveItem`). La racine n'est pas
 * un dossier stocké : un dossier de premier niveau est un dossier sans
 * `parentId`. Les implémentations traitent ce côté à part au lieu d'appeler
 * `getFolder('root')`, qui fabriquerait un faux dossier « Folder root ».
 */
export const ROOT_FOLDER_ID = 'root';

/**
 * Classe d'adaptateur de stockage
 * Pattern Adapter pour découpler la logique métier du stockage
 */
class StorageAdapter {
  private implementation: IStorageImplementation;

  /**
   * Constructeur
   * @param implementation - Implémentation spécifique du stockage
   */
  constructor(implementation: IStorageImplementation) {
    this.implementation = implementation;
  }

  /**
   * Sauvegarde un dossier
   * @param folder - Dossier à sauvegarder
   * @returns Dossier sauvegardé
   */
  async saveFolder(folder: Folder): Promise<Folder> {
    return this.implementation.saveFolder(folder);
  }

  /**
   * Récupère tous les dossiers
   * @returns Liste des dossiers
   */
  async getFolders(): Promise<Folder[]> {
    return this.implementation.getFolders();
  }

  /**
   * Récupère un dossier par son ID
   * @param id - ID du dossier
   * @returns Dossier
   */
  async getFolder(id: string): Promise<Folder> {
    return this.implementation.getFolder(id);
  }

  /**
   * Met à jour un dossier
   * @param id - ID du dossier
   * @param updatedFolder - Données mises à jour du dossier
   * @returns Dossier mis à jour
   */
  async updateFolder(id: string, updatedFolder: Folder): Promise<Folder> {
    return this.implementation.updateFolder(id, updatedFolder);
  }

  /**
   * Supprime un dossier
   * @param id - ID du dossier
   * @param permanent - Si true, supprime définitivement; si false, soft delete (corbeille)
   * @returns Succès de la suppression
   */
  async deleteFolder(id: string, permanent?: boolean): Promise<boolean> {
    return this.implementation.deleteFolder(id, permanent);
  }

  /**
   * Ajoute un élément à un dossier
   * @param folderId - ID du dossier
   * @param item - Élément à ajouter
   * @returns Dossier mis à jour
   */
  async addItemToFolder(folderId: string, item: Item): Promise<Folder> {
    return this.implementation.addItemToFolder(folderId, item);
  }

  /**
   * Supprime un élément d'un dossier
   * @param folderId - ID du dossier
   * @param itemId - ID de l'élément
   * @returns Dossier mis à jour
   */
  async removeItemFromFolder(folderId: string, itemId: string): Promise<Folder> {
    return this.implementation.removeItemFromFolder(folderId, itemId);
  }

  /**
   * Renomme un élément
   * @param parentId - ID du dossier parent
   * @param itemId - ID de l'élément
   * @param oldName - Ancien nom
   * @param newName - Nouveau nom
   * @returns Succès du renommage
   */
  async renameItem(
    parentId: string,
    itemId: string,
    oldName: string,
    newName: string
  ): Promise<boolean> {
    return this.implementation.renameItem(parentId, itemId, oldName, newName);
  }

  /**
   * Lit un fichier chiffré
   * @param folderId - ID du dossier
   * @param fileName - Nom du fichier
   * @param onProgress - Optional progress callback (0-100)
   * @returns Contenu chiffré du fichier
   */
  async readEncryptedFile(
    folderId: string,
    fileName: string,
    onProgress?: (percent: number) => void
  ): Promise<Buffer> {
    return this.implementation.readEncryptedFile(folderId, fileName, onProgress);
  }

  /**
   * Sauvegarde un fichier chiffré
   * @param folderId - ID du dossier
   * @param fileName - Nom du fichier
   * @param content - Contenu à chiffrer et sauvegarder
   */
  async saveEncryptedFile(folderId: string, fileName: string, content: Buffer): Promise<void> {
    return this.implementation.saveEncryptedFile(folderId, fileName, content);
  }

  /**
   * Import V3 en streaming : chiffre un fichier directement depuis son chemin
   * OS dans le main process (mémoire plate, progression via 'file:importProgress').
   * Disponible en modes de stockage local et hybride.
   * @param folderId - ID du dossier de destination
   * @param fileName - Nom du fichier dans le coffre
   * @param sourcePath - Chemin OS du fichier source
   */
  async saveEncryptedFileFromPath(
    folderId: string,
    fileName: string,
    sourcePath: string
  ): Promise<{ size: number }> {
    if (!this.implementation.saveEncryptedFileFromPath) {
      throw new Error(
        "L'import en streaming n'est disponible qu'en modes de stockage local et hybride pour le moment."
      );
    }
    return this.implementation.saveEncryptedFileFromPath(folderId, fileName, sourcePath);
  }

  /**
   * Ajoute un rappel
   * @param itemId - ID de l'élément
   * @param reminder - Rappel à ajouter
   * @returns Rappel ajouté
   */
  async addReminder(itemId: string, reminder: Reminder): Promise<Reminder> {
    return this.implementation.addReminder(itemId, reminder);
  }

  /**
   * Met à jour un rappel
   * @param itemId - ID de l'élément
   * @param reminderId - ID du rappel
   * @param updatedReminder - Données mises à jour du rappel
   * @returns Rappel mis à jour
   */
  async updateReminder(
    itemId: string,
    reminderId: string,
    updatedReminder: Partial<Reminder>
  ): Promise<Reminder> {
    return this.implementation.updateReminder(itemId, reminderId, updatedReminder);
  }

  /**
   * Supprime un rappel
   * @param itemId - ID de l'élément
   * @param reminderId - ID du rappel
   * @returns Succès de la suppression
   */
  async deleteReminder(itemId: string, reminderId: string): Promise<boolean> {
    return this.implementation.deleteReminder(itemId, reminderId);
  }

  /**
   * Récupère tous les rappels
   * @returns Liste des rappels
   */
  async getAllReminders(): Promise<Reminder[]> {
    return this.implementation.getAllReminders();
  }

  /**
   * Récupère les rappels d'un élément
   * @param itemId - ID de l'élément
   * @returns Liste des rappels
   */
  async getReminders(itemId: string): Promise<Reminder[]> {
    return this.implementation.getReminders(itemId);
  }

  /**
   * Récupère un élément par son ID
   * @param id - ID de l'élément
   * @returns Élément
   */
  async getItem(id: string): Promise<Item> {
    return this.implementation.getItem(id);
  }

  /**
   * Met à jour un élément (fichier ou dossier) dans un dossier spécifique
   * @param folderId - ID du dossier parent (peut être null si l'élément est à la racine)
   * @param itemId - ID de l'élément à mettre à jour
   * @param itemData - Données mises à jour de l'élément
   * @returns Élément mis à jour
   */
  async updateItemInFolder(
    folderId: string | null,
    itemId: string,
    itemData: Partial<Item>
  ): Promise<Item> {
    return this.implementation.updateItemInFolder(folderId, itemId, itemData);
  }

  /**
   * Transforme une fiche de fichier en raccourci vers un coffre : octets
   * effacés de l'espace personnel, fiche conservée avec `vaultRef`.
   * @returns Dossier mis à jour
   */
  async convertFileToVaultShortcut(
    folderId: string,
    fileId: string,
    ref: VaultShortcutRef
  ): Promise<Folder> {
    return this.implementation.convertFileToVaultShortcut(folderId, fileId, ref);
  }

  /**
   * Déplace un élément d'un dossier source vers un dossier cible
   * @param itemId - ID de l'élément à déplacer
   * @param sourceFolderId - ID du dossier source
   * @param targetFolderId - ID du dossier cible
   * @returns Résultat du déplacement avec les dossiers mis à jour
   */
  async moveItem(
    itemId: string,
    sourceFolderId: string,
    targetFolderId: string
  ): Promise<import('../../types').MoveResult> {
    return this.implementation.moveItem(itemId, sourceFolderId, targetFolderId);
  }

  /**
   * Copie un élément d'un dossier source vers un dossier cible
   * @param itemId - ID de l'élément à copier
   * @param sourceFolderId - ID du dossier source
   * @param targetFolderId - ID du dossier cible
   * @param newName - Nouveau nom pour la copie (optionnel)
   * @returns Résultat de la copie avec le dossier cible et le nouvel élément
   */
  async copyItem(
    itemId: string,
    sourceFolderId: string,
    targetFolderId: string,
    newName?: string
  ): Promise<import('../../types').CopyResult> {
    return this.implementation.copyItem(itemId, sourceFolderId, targetFolderId, newName);
  }
}

/**
 * Implémentation du stockage pour Electron
 * Utilise l'IPC d'Electron pour communiquer avec le main process
 */
class ElectronStorageImplementation implements IStorageImplementation {
  /**
   * Sauvegarde un dossier
   */
  async saveFolder(folder: Folder): Promise<Folder> {
    return window.electron.ipcRenderer.invoke('saveFolder', folder);
  }

  /**
   * Récupère tous les dossiers
   */
  async getFolders(): Promise<Folder[]> {
    return window.electron.ipcRenderer.invoke('getFolders');
  }

  /**
   * Récupère un dossier par son ID
   */
  async getFolder(id: string): Promise<Folder> {
    return window.electron.ipcRenderer.invoke('getFolder', id);
  }

  /**
   * Met à jour un dossier
   */
  async updateFolder(id: string, updatedFolder: Folder): Promise<Folder> {
    return window.electron.ipcRenderer.invoke('updateFolder', id, updatedFolder);
  }

  /**
   * Supprime un dossier
   */
  async deleteFolder(id: string, permanent: boolean = false): Promise<boolean> {
    return window.electron.ipcRenderer.invoke('storage:deleteFolder', id, permanent);
  }

  /**
   * Ajoute un élément à un dossier
   */
  async addItemToFolder(folderId: string, item: Item): Promise<Folder> {
    return window.electron.ipcRenderer.invoke('addItemToFolder', folderId, item);
  }

  /**
   * Supprime un élément d'un dossier
   */
  async removeItemFromFolder(folderId: string, itemId: string): Promise<Folder> {
    return window.electron.ipcRenderer.invoke('removeItemFromFolder', folderId, itemId);
  }

  /**
   * Renomme un élément
   */
  async renameItem(
    parentId: string,
    itemId: string,
    oldName: string,
    newName: string
  ): Promise<boolean> {
    return window.electron.ipcRenderer.invoke('renameItem', parentId, itemId, oldName, newName);
  }

  /**
   * Lit un fichier chiffré
   */
  async readEncryptedFile(folderId: string, fileName: string): Promise<Buffer> {
    return window.electron.ipcRenderer.invoke('readEncryptedFile', folderId, fileName);
  }

  /**
   * Sauvegarde un fichier chiffré
   */
  async saveEncryptedFile(folderId: string, fileName: string, content: Buffer): Promise<void> {
    return window.electron.ipcRenderer.invoke('saveEncryptedFile', folderId, fileName, content);
  }

  /**
   * Import V3 en streaming : le main process lit + chiffre le fichier
   * chunk par chunk depuis son chemin OS. Le contenu ne transite jamais
   * par le renderer ; la progression arrive sur 'file:importProgress'.
   */
  async saveEncryptedFileFromPath(
    folderId: string,
    fileName: string,
    sourcePath: string
  ): Promise<{ size: number }> {
    return window.electron.ipcRenderer.invoke(
      'saveEncryptedFileFromPath',
      folderId,
      fileName,
      sourcePath
    );
  }

  /**
   * Ajoute un rappel
   */
  async addReminder(itemId: string, reminder: Reminder): Promise<Reminder> {
    return window.electron.ipcRenderer.invoke('addReminder', itemId, reminder);
  }

  /**
   * Met à jour un rappel
   */
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

  /**
   * Supprime un rappel
   */
  async deleteReminder(itemId: string, reminderId: string): Promise<boolean> {
    return window.electron.ipcRenderer.invoke('deleteReminder', itemId, reminderId);
  }

  /**
   * Récupère tous les rappels
   */
  async getAllReminders(): Promise<Reminder[]> {
    return window.electron.ipcRenderer.invoke('getAllReminders');
  }

  /**
   * Récupère les rappels d'un élément
   */
  async getReminders(itemId: string): Promise<Reminder[]> {
    return window.electron.ipcRenderer.invoke('getReminders', itemId);
  }

  /**
   * Récupère un élément par son ID
   */
  async getItem(id: string): Promise<Item> {
    return window.electron.ipcRenderer.invoke('getItem', id);
  }

  /**
   * Met à jour un élément dans un dossier
   */
  async updateItemInFolder(
    folderId: string | null,
    itemId: string,
    itemData: Partial<Item>
  ): Promise<Item> {
    return window.electron.ipcRenderer.invoke('updateItemInFolder', folderId, itemId, itemData);
  }

  /**
   * Raccourci vers un coffre : tout se passe côté main (effacement sûr du
   * blob, avis au manifeste de synchro, fiche réécrite), sous le verrou du dossier.
   */
  async convertFileToVaultShortcut(
    folderId: string,
    fileId: string,
    ref: VaultShortcutRef
  ): Promise<Folder> {
    return window.electron.ipcRenderer.invoke('convertFileToVaultShortcut', folderId, fileId, ref);
  }

  /**
   * Déplace un élément d'un dossier source vers un dossier cible
   */
  async moveItem(
    itemId: string,
    sourceFolderId: string,
    targetFolderId: string
  ): Promise<import('../../types').MoveResult> {
    return window.electron.ipcRenderer.invoke('moveItem', itemId, sourceFolderId, targetFolderId);
  }

  /**
   * Copie un élément d'un dossier source vers un dossier cible
   */
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

/**
 * Implémentation BYOS (Bring Your Own Storage)
 * Utilise l'IPC Electron pour communiquer avec le S3 client du main process.
 * Les fichiers sont chiffrés ZK côté client avant envoi.
 */
class BYOSStorageImplementation implements IStorageImplementation {
  // BYOS delegates folder/item metadata to local Electron storage
  // Only file content goes to the remote S3
  private local = new ElectronStorageImplementation();

  async saveFolder(folder: Folder): Promise<Folder> {
    return this.local.saveFolder(folder);
  }
  async getFolders(): Promise<Folder[]> {
    return this.local.getFolders();
  }
  async getFolder(id: string): Promise<Folder> {
    return this.local.getFolder(id);
  }
  async updateFolder(id: string, updatedFolder: Folder): Promise<Folder> {
    return this.local.updateFolder(id, updatedFolder);
  }
  async deleteFolder(id: string, permanent?: boolean): Promise<boolean> {
    return this.local.deleteFolder(id, permanent);
  }
  async addItemToFolder(folderId: string, item: Item): Promise<Folder> {
    return this.local.addItemToFolder(folderId, item);
  }
  async removeItemFromFolder(folderId: string, itemId: string): Promise<Folder> {
    return this.local.removeItemFromFolder(folderId, itemId);
  }
  async renameItem(
    parentId: string,
    itemId: string,
    oldName: string,
    newName: string
  ): Promise<boolean> {
    return this.local.renameItem(parentId, itemId, oldName, newName);
  }

  // File content operations go through BYOS IPC
  async readEncryptedFile(folderId: string, fileName: string): Promise<Buffer> {
    if (window.electron?.ipcRenderer) {
      try {
        return await window.electron.ipcRenderer.invoke('byos:download', folderId, fileName);
      } catch {
        // Fallback to local
        return this.local.readEncryptedFile(folderId, fileName);
      }
    }
    return this.local.readEncryptedFile(folderId, fileName);
  }

  async saveEncryptedFile(folderId: string, fileName: string, content: Buffer): Promise<void> {
    if (window.electron?.ipcRenderer) {
      try {
        await window.electron.ipcRenderer.invoke('byos:upload', folderId, fileName, content);
        return;
      } catch {
        // Fallback to local
      }
    }
    return this.local.saveEncryptedFile(folderId, fileName, content);
  }

  // Reminders/items stay local
  async addReminder(itemId: string, reminder: Reminder): Promise<Reminder> {
    return this.local.addReminder(itemId, reminder);
  }
  async updateReminder(
    itemId: string,
    reminderId: string,
    updatedReminder: Partial<Reminder>
  ): Promise<Reminder> {
    return this.local.updateReminder(itemId, reminderId, updatedReminder);
  }
  async deleteReminder(itemId: string, reminderId: string): Promise<boolean> {
    return this.local.deleteReminder(itemId, reminderId);
  }
  async getAllReminders(): Promise<Reminder[]> {
    return this.local.getAllReminders();
  }
  async getReminders(itemId: string): Promise<Reminder[]> {
    return this.local.getReminders(itemId);
  }
  async getItem(id: string): Promise<Item> {
    return this.local.getItem(id);
  }
  async updateItemInFolder(
    folderId: string | null,
    itemId: string,
    itemData: Partial<Item>
  ): Promise<Item> {
    return this.local.updateItemInFolder(folderId, itemId, itemData);
  }
  /**
   * BYOS : la fiche est locale, elle suit le chemin local. Limite honnête :
   * les octets déposés sur le S3 de l'utilisateur ne sont pas retirés ici
   * (aucun `byos:delete` n'existe) — même situation qu'un `removeItemFromFolder`
   * en BYOS aujourd'hui.
   */
  async convertFileToVaultShortcut(
    folderId: string,
    fileId: string,
    ref: VaultShortcutRef
  ): Promise<Folder> {
    return this.local.convertFileToVaultShortcut(folderId, fileId, ref);
  }
  async moveItem(
    itemId: string,
    sourceFolderId: string,
    targetFolderId: string
  ): Promise<import('../../types').MoveResult> {
    return this.local.moveItem(itemId, sourceFolderId, targetFolderId);
  }
  async copyItem(
    itemId: string,
    sourceFolderId: string,
    targetFolderId: string,
    newName?: string
  ): Promise<import('../../types').CopyResult> {
    return this.local.copyItem(itemId, sourceFolderId, targetFolderId, newName);
  }
}

/**
 * Implémentation Cloud (Filarr server mode)
 * Utilise apiClient pour communiquer avec le backend REST API.
 * Toutes les données sont stockées sur le serveur Filarr.
 */
/** Create an Error with a cause (ES2020-compatible, satisfies preserve-caught-error) */
function cloudError(msg: string, cause: unknown): Error {
  const err = new Error(msg);
  (err as any).cause = cause;
  return err;
}

/**
 * Maps a backend folder response (snake_case) to the client Folder type (camelCase).
 * The backend returns: { id, name, color, parent_id, protected, created_at, updated_at, file_count }
 * The client expects: { id, name, color, parentId, protected, createdAt, updatedAt, items }
 */
function mapBackendFolder(raw: any, files?: any[]): Folder {
  const items: any[] = files
    ? files.map((f: any) => ({
        id: f.id,
        name: f.name || f.original_name,
        type: f.type || 'file',
        size: typeof f.size === 'string' ? parseInt(f.size, 10) : f.size || 0,
        createdAt: f.created_at ?? f.createdAt,
        updatedAt: f.updated_at ?? f.updatedAt,
      }))
    : raw.items || [];
  return {
    id: raw.id,
    name: raw.name,
    color: raw.color || '#3498db',
    items,
    parentId: raw.parent_id ?? raw.parentId ?? undefined,
    protected: raw.protected ?? false,
    createdAt: raw.created_at ?? raw.createdAt,
    updatedAt: raw.updated_at ?? raw.updatedAt,
  };
}

// TODO Phase 5 : migrer vers nouveau Cloudflare Worker (api.filarr.com)
class CloudStorageImplementation implements IStorageImplementation {
  /**
   * Sauvegarde un dossier via POST /folders
   */
  async saveFolder(folder: Folder): Promise<Folder> {
    try {
      const body: Record<string, unknown> = {
        name: folder.name,
        color: folder.color,
      };
      // Backend expects snake_case "parent_id" and it must be a valid UUID or null
      if (folder.parentId) {
        body.parent_id = folder.parentId;
      }
      // Only send password/protected when the folder is actually protected
      // (backend Joi schema marks password as "forbidden" when protected is false)
      if (folder.protected) {
        body.protected = true;
        body.password = folder.password;
      }
      const response = await apiClient.post('/folders', body);
      return mapBackendFolder(response.data?.data || response.data);
    } catch (error) {
      throw cloudError(
        `Cloud saveFolder failed: ${error instanceof Error ? error.message : String(error)}`,
        error
      );
    }
  }

  /**
   * Récupère tous les dossiers via GET /folders
   */
  async getFolders(): Promise<Folder[]> {
    try {
      const response = await apiClient.get('/folders', {
        params: { limit: 100 }, // fetch all folders at once
      });
      const data = response.data?.data;
      // Backend returns { folders: [...], pagination: {...} }
      const rawFolders = data?.folders || data || [];

      // Fetch contents for each folder so files are available for dashboard stats
      const folders = await Promise.all(
        (rawFolders as any[]).map(async (f) => {
          try {
            const contentsRes = await apiClient.get(`/folders/${f.id}/contents`);
            const cd = contentsRes.data?.data || contentsRes.data;
            return mapBackendFolder(cd.folder || f, cd.files);
          } catch {
            return mapBackendFolder(f);
          }
        })
      );
      return folders;
    } catch (error) {
      throw cloudError(
        `Cloud getFolders failed: ${error instanceof Error ? error.message : String(error)}`,
        error
      );
    }
  }

  /**
   * Récupère un dossier avec ses fichiers via GET /folders/:id/contents
   */
  async getFolder(id: string): Promise<Folder> {
    try {
      const response = await apiClient.get(`/folders/${id}/contents`);
      const data = response.data?.data || response.data;
      return mapBackendFolder(data.folder || data, data.files);
    } catch (error) {
      throw cloudError(
        `Cloud getFolder failed: ${error instanceof Error ? error.message : String(error)}`,
        error
      );
    }
  }

  /**
   * Met à jour un dossier via PUT /folders/:id
   */
  async updateFolder(id: string, updatedFolder: Folder): Promise<Folder> {
    try {
      // Only send fields the backend updateFolderSchema accepts
      const body: Record<string, unknown> = {};
      if (updatedFolder.name !== undefined) body.name = updatedFolder.name;
      if (updatedFolder.color !== undefined) body.color = updatedFolder.color;
      if (updatedFolder.protected !== undefined) body.protected = updatedFolder.protected;
      if (updatedFolder.password) body.password = updatedFolder.password;
      const response = await apiClient.put(`/folders/${id}`, body);
      return mapBackendFolder(response.data?.data || response.data);
    } catch (error) {
      throw cloudError(
        `Cloud updateFolder failed: ${error instanceof Error ? error.message : String(error)}`,
        error
      );
    }
  }

  /**
   * Supprime un dossier via DELETE /folders/:id?permanent=true
   */
  async deleteFolder(id: string, permanent?: boolean): Promise<boolean> {
    try {
      const params = permanent ? { permanent: 'true' } : {};
      const response = await apiClient.delete(`/folders/${id}`, { params });
      return response.data?.success ?? true;
    } catch (error) {
      throw cloudError(
        `Cloud deleteFolder failed: ${error instanceof Error ? error.message : String(error)}`,
        error
      );
    }
  }

  /**
   * Ajoute un élément à un dossier.
   * In cloud mode, file uploads via POST /files/upload already associate the file
   * with the folder, so we just return the current folder state.
   */
  async addItemToFolder(folderId: string, _item: Item): Promise<Folder> {
    try {
      // Backend has no separate "add item to folder" endpoint;
      // the upload endpoint handles folder association.
      // Just return the folder so the caller gets an updated reference.
      return await this.getFolder(folderId);
    } catch (error) {
      throw cloudError(
        `Cloud addItemToFolder failed: ${error instanceof Error ? error.message : String(error)}`,
        error
      );
    }
  }

  /**
   * Supprime un élément d'un dossier.
   * In cloud mode, deletes the file via DELETE /files/:itemId, then returns the folder.
   */
  async removeItemFromFolder(folderId: string, itemId: string): Promise<Folder> {
    try {
      await apiClient.delete(`/files/${itemId}`);
      return await this.getFolder(folderId);
    } catch (error) {
      throw cloudError(
        `Cloud removeItemFromFolder failed: ${error instanceof Error ? error.message : String(error)}`,
        error
      );
    }
  }

  /**
   * Renomme un élément via PUT /files/:itemId/rename
   */
  async renameItem(
    _parentId: string,
    itemId: string,
    _oldName: string,
    newName: string
  ): Promise<boolean> {
    try {
      const response = await apiClient.put(`/files/${itemId}/rename`, { name: newName });
      return response.data?.success ?? true;
    } catch (error) {
      throw cloudError(
        `Cloud renameItem failed: ${error instanceof Error ? error.message : String(error)}`,
        error
      );
    }
  }

  /**
   * Lit un fichier via GET /files/:id/download
   * Finds the file ID by listing folder contents, then downloads by ID.
   */
  async readEncryptedFile(
    folderId: string,
    fileName: string,
    onProgress?: (percent: number) => void
  ): Promise<Buffer> {
    try {
      // Find file ID by listing files in the folder
      const listResponse = await apiClient.get('/files', {
        params: { folder_id: folderId, limit: 100 },
      });
      const files = listResponse.data?.data?.files || [];
      const file = files.find((f: any) => f.name === fileName || f.original_name === fileName);
      if (!file) {
        throw new Error(`File not found: ${fileName} in folder ${folderId}`);
      }

      // Download by ID with progress tracking
      const response = await apiClient.get(`/files/${file.id}/download`, {
        responseType: 'arraybuffer',
        onDownloadProgress: onProgress
          ? (progressEvent) => {
              if (progressEvent.total) {
                const percent = Math.round((progressEvent.loaded * 100) / progressEvent.total);
                onProgress(percent);
              } else if (progressEvent.loaded) {
                // If total unknown, report loaded bytes as negative indicator
                onProgress(-1);
              }
            }
          : undefined,
      });
      // Use Uint8Array instead of Buffer (Buffer not available in renderer/browser)
      return new Uint8Array(response.data) as any;
    } catch (error) {
      throw cloudError(
        `Cloud readEncryptedFile failed: ${error instanceof Error ? error.message : String(error)}`,
        error
      );
    }
  }

  /**
   * Sauvegarde un fichier chiffré via POST /files/upload (multipart form data)
   */
  async saveEncryptedFile(folderId: string, fileName: string, content: Buffer): Promise<void> {
    try {
      const formData = new FormData();
      const blob = new Blob([new Uint8Array(content)], { type: 'application/octet-stream' });
      formData.append('file', blob, fileName);
      // Backend expects snake_case "folder_id" (Joi uploadFileSchema)
      formData.append('folder_id', folderId);
      formData.append('encrypted', 'true');
      await apiClient.post('/files/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
    } catch (error) {
      throw cloudError(
        `Cloud saveEncryptedFile failed: ${error instanceof Error ? error.message : String(error)}`,
        error
      );
    }
  }

  /**
   * Ajoute un rappel via POST /reminders
   */
  async addReminder(itemId: string, reminder: Reminder): Promise<Reminder> {
    try {
      const response = await apiClient.post('/reminders', { ...reminder, itemId });
      return response.data?.data || response.data;
    } catch (error) {
      throw cloudError(
        `Cloud addReminder failed: ${error instanceof Error ? error.message : String(error)}`,
        error
      );
    }
  }

  /**
   * Met à jour un rappel via PUT /reminders/:reminderId
   */
  async updateReminder(
    itemId: string,
    reminderId: string,
    updatedReminder: Partial<Reminder>
  ): Promise<Reminder> {
    try {
      const response = await apiClient.put(`/reminders/${reminderId}`, updatedReminder);
      return response.data?.data || response.data;
    } catch (error) {
      throw cloudError(
        `Cloud updateReminder failed: ${error instanceof Error ? error.message : String(error)}`,
        error
      );
    }
  }

  /**
   * Supprime un rappel via DELETE /reminders/:reminderId
   */
  async deleteReminder(itemId: string, reminderId: string): Promise<boolean> {
    try {
      const response = await apiClient.delete(`/reminders/${reminderId}`);
      return response.data?.success ?? true;
    } catch (error) {
      throw cloudError(
        `Cloud deleteReminder failed: ${error instanceof Error ? error.message : String(error)}`,
        error
      );
    }
  }

  /**
   * Récupère tous les rappels via GET /reminders
   */
  async getAllReminders(): Promise<Reminder[]> {
    try {
      const response = await apiClient.get('/reminders');
      return response.data?.data || response.data || [];
    } catch (error) {
      throw cloudError(
        `Cloud getAllReminders failed: ${error instanceof Error ? error.message : String(error)}`,
        error
      );
    }
  }

  /**
   * Récupère les rappels d'un élément via GET /reminders?itemId=...
   */
  async getReminders(itemId: string): Promise<Reminder[]> {
    try {
      const response = await apiClient.get('/reminders', { params: { itemId } });
      return response.data?.data || response.data || [];
    } catch (error) {
      throw cloudError(
        `Cloud getReminders failed: ${error instanceof Error ? error.message : String(error)}`,
        error
      );
    }
  }

  /**
   * Récupère un élément par son ID via GET /files/:id
   */
  async getItem(id: string): Promise<Item> {
    try {
      const response = await apiClient.get(`/files/${id}`);
      return response.data?.data || response.data;
    } catch (error) {
      throw cloudError(
        `Cloud getItem failed: ${error instanceof Error ? error.message : String(error)}`,
        error
      );
    }
  }

  /**
   * Met à jour un élément dans un dossier via PUT /files/:itemId
   */
  async updateItemInFolder(
    folderId: string | null,
    itemId: string,
    itemData: Partial<Item>
  ): Promise<Item> {
    try {
      const response = await apiClient.put(`/files/${itemId}`, itemData);
      return response.data?.data || response.data;
    } catch (error) {
      throw cloudError(
        `Cloud updateItemInFolder failed: ${error instanceof Error ? error.message : String(error)}`,
        error
      );
    }
  }

  /**
   * Nuage pur : l'API n'a pas de « supprimer le blob seul » — le seul
   * effacement est DELETE /files/:id, qui emporte la fiche avec lui, et
   * recréer la fiche changerait son identifiant (interdit : le fichier
   * perdrait rappels et liens). On ne peut donc que réécrire la fiche :
   * `vaultRef` posé, octets retirés (`null`, pas `undefined` : un
   * `undefined` ne traverse pas JSON et laisserait les champs en place).
   * Les octets côté serveur restent orphelins tant qu'un nettoyage n'existe
   * pas — dit tel quel dans la remise, pas masqué.
   */
  async convertFileToVaultShortcut(
    folderId: string,
    fileId: string,
    ref: VaultShortcutRef
  ): Promise<Folder> {
    try {
      await apiClient.put(`/files/${fileId}`, {
        vaultRef: ref,
        encryptedData: null,
        iv: null,
        updatedAt: new Date().toISOString(),
      });
      return await this.getFolder(folderId);
    } catch (error) {
      throw cloudError(
        `Cloud convertFileToVaultShortcut failed: ${error instanceof Error ? error.message : String(error)}`,
        error
      );
    }
  }

  /**
   * Déplace un élément via PUT /files/:itemId/move
   */
  async moveItem(
    itemId: string,
    _sourceFolderId: string,
    targetFolderId: string
  ): Promise<import('../../types').MoveResult> {
    try {
      // Backend expects { folder_id } (snake_case, destination folder UUID)
      const response = await apiClient.put(`/files/${itemId}/move`, {
        folder_id: targetFolderId,
      });
      return response.data?.data || response.data;
    } catch (error) {
      throw cloudError(
        `Cloud moveItem failed: ${error instanceof Error ? error.message : String(error)}`,
        error
      );
    }
  }

  /**
   * Copie un élément via POST /files/:itemId/copy
   */
  async copyItem(
    itemId: string,
    sourceFolderId: string,
    targetFolderId: string,
    newName?: string
  ): Promise<import('../../types').CopyResult> {
    try {
      const response = await apiClient.post(`/files/${itemId}/copy`, {
        sourceFolderId,
        targetFolderId,
        newName,
      });
      return response.data?.data || response.data;
    } catch (error) {
      throw cloudError(
        `Cloud copyItem failed: ${error instanceof Error ? error.message : String(error)}`,
        error
      );
    }
  }
}

/**
 * Hybrid Storage Implementation (local-first + cloud sync)
 *
 * Metadata (folders, items, reminders) → Cloud API as source of truth, local cache fallback.
 * File content → Written locally first (encrypted with FEK), then uploaded to cloud in background.
 * Reading → Local if available, otherwise download from cloud → save locally → return.
 */
// TODO Phase 5 : migrer vers nouveau Cloudflare Worker (api.filarr.com)
class HybridStorageImplementation implements IStorageImplementation {
  private cloud = new CloudStorageImplementation();
  private local = new ElectronStorageImplementation();

  private isOnline(): boolean {
    return navigator.onLine;
  }

  // --- Metadata: Cloud as source of truth, local fallback ---

  async saveFolder(folder: Folder): Promise<Folder> {
    if (this.isOnline()) {
      try {
        const result = await this.cloud.saveFolder(folder);
        try {
          await this.local.saveFolder(result);
        } catch {
          /* best effort */
        }
        return result;
      } catch (error) {
        console.warn('[Hybrid] Cloud saveFolder failed, falling back to local:', error);
      }
    }
    return this.local.saveFolder(folder);
  }

  /**
   * Cloud is the source of truth for metadata, but some folders only exist
   * locally for a while: the desktop inbox created MAIN-side by tray /
   * mini-mode protect imports, and anything created while offline. Returning
   * the cloud list verbatim made them invisible for as long as the cloud
   * answered — a file protected from the tray simply never appeared, and the
   * tray's "Protégés récemment" entry navigated to a folder the store had
   * never heard of (OrphanFolderFallback).
   *
   * So: cloud list, plus the local folders the cloud does not know yet (union
   * by id, cloud wins on collision). Locally trashed folders are excluded so
   * nothing comes back from the dead — the Electron local impl already drops
   * `deletedAt` folders, the filter is belt-and-braces for the other impls.
   *
   * Honest limit: a folder hard-deleted in the cloud FROM ANOTHER DEVICE whose
   * directory still exists on this machine reappears in the list until sync
   * prunes that directory. The Folder type carries no "was known to the cloud"
   * marker, so it cannot be told apart from a genuinely new local folder; the
   * previous behavior traded that for making local-only folders unreachable,
   * which is the worse of the two.
   */
  async getFolders(): Promise<Folder[]> {
    if (this.isOnline()) {
      try {
        const cloudFolders = await this.cloud.getFolders();
        let localFolders: Folder[] = [];
        try {
          localFolders = await this.local.getFolders();
        } catch (error) {
          // Cloud answered — a local read failure must not lose that list.
          console.warn('[Hybrid] Local getFolders failed, using cloud list only:', error);
          return cloudFolders;
        }
        const cloudIds = new Set(cloudFolders.map((f) => f.id));
        const localOnly = (localFolders || []).filter(
          (f) => f && !cloudIds.has(f.id) && !f.deletedAt
        );
        if (localOnly.length > 0) {
          console.log('[Hybrid getFolders] local-only folders merged:', localOnly.length);
          return [...cloudFolders, ...localOnly];
        }
        return cloudFolders;
      } catch (error) {
        console.warn('[Hybrid] Cloud getFolders failed, falling back to local:', error);
      }
    }
    return this.local.getFolders();
  }

  async getFolder(id: string): Promise<Folder> {
    if (this.isOnline()) {
      try {
        return await this.cloud.getFolder(id);
      } catch (error) {
        console.warn('[Hybrid] Cloud getFolder failed, falling back to local:', error);
      }
    }
    return this.local.getFolder(id);
  }

  async updateFolder(id: string, updatedFolder: Folder): Promise<Folder> {
    if (this.isOnline()) {
      try {
        const result = await this.cloud.updateFolder(id, updatedFolder);
        try {
          await this.local.updateFolder(id, result);
        } catch {
          /* best effort */
        }
        return result;
      } catch (error) {
        console.warn('[Hybrid] Cloud updateFolder failed, falling back to local:', error);
      }
    }
    return this.local.updateFolder(id, updatedFolder);
  }

  async deleteFolder(id: string, permanent?: boolean): Promise<boolean> {
    if (this.isOnline()) {
      try {
        const result = await this.cloud.deleteFolder(id, permanent);
        try {
          await this.local.deleteFolder(id, permanent);
        } catch {
          /* best effort */
        }
        return result;
      } catch (error) {
        console.warn('[Hybrid] Cloud deleteFolder failed, falling back to local:', error);
      }
    }
    return this.local.deleteFolder(id, permanent);
  }

  async addItemToFolder(folderId: string, item: Item): Promise<Folder> {
    console.log('[Hybrid addItemToFolder]', folderId, item?.name, 'online:', this.isOnline());
    let localFolder: Folder | null = null;
    try {
      localFolder = await this.local.addItemToFolder(folderId, item);
    } catch (localErr) {
      console.warn('[Hybrid] Local addItemToFolder failed:', localErr);
    }
    if (this.isOnline()) {
      try {
        const cloudFolder = await this.cloud.addItemToFolder(folderId, item);
        console.log(
          '[Hybrid addItemToFolder] Cloud returned folder with',
          cloudFolder?.items?.length,
          'items'
        );
        // Cloud addItemToFolder just fetches the folder — the new item may not be
        // there yet (content upload is async). Merge the local item into cloud result.
        if (cloudFolder?.items && item) {
          const exists = (cloudFolder.items as any[]).some(
            (i: any) => i.id === item.id || i.name === item.name
          );
          if (!exists) {
            (cloudFolder.items as any[]).push(item);
          }
        }
        return cloudFolder;
      } catch (error) {
        console.warn('[Hybrid] Cloud addItemToFolder failed:', error);
      }
    }
    return localFolder || this.local.getFolder(folderId);
  }

  async removeItemFromFolder(folderId: string, itemId: string): Promise<Folder> {
    let fileName: string | undefined;
    try {
      const folder = await this.local.getFolder(folderId);
      const item = (folder.items as any[])?.find((i: any) => i.id === itemId);
      fileName = item?.name;
    } catch {
      /* ignore */
    }

    if (fileName && window.electron?.ipcRenderer) {
      try {
        await window.electron.ipcRenderer.invoke('hybrid:deleteBlob', folderId, fileName);
      } catch {
        /* ignore */
      }
    }

    try {
      await this.local.removeItemFromFolder(folderId, itemId);
    } catch {
      /* ignore */
    }

    if (this.isOnline()) {
      try {
        return await this.cloud.removeItemFromFolder(folderId, itemId);
      } catch (error) {
        console.warn('[Hybrid] Cloud removeItemFromFolder failed:', error);
      }
    }
    return this.local.getFolder(folderId);
  }

  async renameItem(
    parentId: string,
    itemId: string,
    oldName: string,
    newName: string
  ): Promise<boolean> {
    /**
     * LE DÉPLACEMENT DU BLOB EST LA PARTIE QUI DOIT ÉCHOUER FORT.
     *
     * Ce bloc avalait ses erreurs et la méthode rendait `true` sans condition.
     * L'appelant croyait donc le renommage acquis : `FilePluginEditorModal`
     * adopte le nouveau nom dans `nameRef` sur cette seule foi, et la
     * sauvegarde suivante écrit sous un nom dont les octets ne sont pas là —
     * le dossier finit avec DEUX fichiers, l'ancien complet et un nouveau
     * partiel.
     *
     * Et le déplacement passait par un aller-retour complet du contenu en
     * mémoire du renderer (`readRawBlob` → `writeRawBlob` → `deleteBlob`) :
     * plusieurs centaines de méga-octets recopiés pour changer un nom.
     * `hybrid:renameBlob` fait un `fs.rename`, atomique et sans lecture.
     */
    if (window.electron?.ipcRenderer) {
      await window.electron.ipcRenderer.invoke('hybrid:renameBlob', parentId, oldName, newName);
    }

    try {
      await this.local.renameItem(parentId, itemId, oldName, newName);
    } catch (error) {
      // La MÉTADONNÉE locale, elle, reste tolérante : les octets sont déjà
      // sous le bon nom, et la prochaine relecture du dossier corrigera la
      // ligne. Échouer ici annulerait un renommage qui a réellement eu lieu.
      console.warn('[Hybrid] renameItem local metadata failed:', error);
    }

    if (this.isOnline()) {
      try {
        return await this.cloud.renameItem(parentId, itemId, oldName, newName);
      } catch (error) {
        console.warn('[Hybrid] Cloud renameItem failed:', error);
      }
    }
    return true;
  }

  // --- File content: local-first ---

  async readEncryptedFile(
    folderId: string,
    fileName: string,
    onProgress?: (percent: number) => void
  ): Promise<Buffer> {
    if (!window.electron?.ipcRenderer) {
      return this.cloud.readEncryptedFile(folderId, fileName, onProgress);
    }

    const localExists = await window.electron.ipcRenderer.invoke(
      'hybrid:fileExists',
      folderId,
      fileName
    );

    console.log(
      '[Hybrid readEncryptedFile]',
      folderId,
      fileName,
      'localExists:',
      localExists,
      'hasKey:',
      hasHybridKey()
    );

    if (localExists) {
      // Conteneur V3-FEK (gros fichier écrit par hybrid:saveFromPath) : le
      // déchiffrement se fait côté MAIN avec la FEK de session (chunks
      // vérifiés GCM, plafond d'aperçu 1 Gio). Le format legacy (marqueur
      // v0/v1/v2) reste déchiffré ici via hybridCrypto. En cas d'échec
      // (coffre verrouillé, fichier corrompu) l'erreur remonte SANS
      // supprimer le blob local — contrairement au chemin legacy, un échec
      // V3 ne signifie jamais « cache périmé ».
      const isV3Blob: boolean = await window.electron.ipcRenderer.invoke(
        'hybrid:isV3Blob',
        folderId,
        fileName
      );
      if (isV3Blob) {
        const plain: Uint8Array = await window.electron.ipcRenderer.invoke(
          'hybrid:readDecryptedV3',
          folderId,
          fileName
        );
        return new Uint8Array(plain) as unknown as Buffer;
      }

      const rawData: number[] = await window.electron.ipcRenderer.invoke(
        'hybrid:readRawBlob',
        folderId,
        fileName
      );
      const encryptedBlob = new Uint8Array(rawData);
      console.log('[Hybrid readEncryptedFile] Read local blob, size:', encryptedBlob.byteLength);

      if (hasHybridKey()) {
        try {
          const decrypted = await decryptFileContent(encryptedBlob);
          console.log(
            '[Hybrid readEncryptedFile] Decrypted successfully, size:',
            decrypted.byteLength
          );
          return new Uint8Array(decrypted) as any;
        } catch (decryptErr) {
          console.warn(
            '[Hybrid readEncryptedFile] Local decrypt failed (stale cache?), falling back to cloud:',
            decryptErr
          );
          // Delete stale local blob so it gets re-cached correctly
          try {
            await window.electron.ipcRenderer.invoke('hybrid:deleteBlob', folderId, fileName);
          } catch {
            /* best effort */
          }
          // Fall through to cloud fetch below
        }
      } else {
        console.warn('[Hybrid readEncryptedFile] No hybrid key — returning raw encrypted blob!');
        return encryptedBlob as any;
      }
    }

    if (!this.isOnline()) {
      throw new Error('File not available offline: ' + fileName);
    }

    const cloudData = await this.cloud.readEncryptedFile(folderId, fileName, onProgress);

    // The cloud may return client-encrypted data (FEK-encrypted).
    // Try to decrypt it; if it fails, the data is either plaintext (server-decrypted)
    // or encrypted with a different FEK we can't recover.
    let plainData: Uint8Array | Buffer = cloudData;
    if (hasHybridKey()) {
      try {
        const decrypted = await decryptFileContent(
          cloudData instanceof Uint8Array ? cloudData : new Uint8Array(cloudData as any)
        );
        plainData = new Uint8Array(decrypted) as any;
        console.log(
          '[Hybrid readEncryptedFile] Cloud data decrypted with FEK, size:',
          plainData.byteLength
        );
      } catch {
        // Not FEK-encrypted (server-decrypted plaintext) or key mismatch — use as-is
        console.log('[Hybrid readEncryptedFile] Cloud data not FEK-encrypted, using as-is');
      }

      // Cache locally: encrypt plainData with current FEK
      try {
        const toEncrypt =
          plainData instanceof Uint8Array
            ? (plainData.buffer as ArrayBuffer)
            : (plainData as unknown as ArrayBuffer);
        const encrypted = await encryptFileContent(toEncrypt, { fileName });
        await window.electron.ipcRenderer.invoke(
          'hybrid:writeRawBlob',
          folderId,
          fileName,
          encrypted
        );
      } catch (cacheError) {
        console.warn('[Hybrid] Failed to cache file locally:', cacheError);
      }
    }

    return plainData as any;
  }

  async saveEncryptedFile(folderId: string, fileName: string, content: Buffer): Promise<void> {
    console.log(
      '[Hybrid saveEncryptedFile]',
      folderId,
      fileName,
      'size:',
      content?.length,
      'hasKey:',
      hasHybridKey()
    );
    if (!window.electron?.ipcRenderer) {
      return this.cloud.saveEncryptedFile(folderId, fileName, content);
    }

    let blobToWrite: Uint8Array;
    if (hasHybridKey()) {
      // Normalize content to ArrayBuffer for Web Crypto API
      let contentBuffer: ArrayBuffer;
      if (content instanceof ArrayBuffer) {
        contentBuffer = content;
      } else if (content instanceof Uint8Array) {
        contentBuffer = content.buffer.slice(
          content.byteOffset,
          content.byteOffset + content.byteLength
        ) as ArrayBuffer;
      } else if (ArrayBuffer.isView(content)) {
        contentBuffer = (content as ArrayBufferView).buffer.slice(
          (content as ArrayBufferView).byteOffset,
          (content as ArrayBufferView).byteOffset + (content as ArrayBufferView).byteLength
        ) as ArrayBuffer;
      } else {
        // content is likely a string, number[], or serialized Buffer — convert via Uint8Array
        const bytes =
          typeof content === 'string'
            ? new TextEncoder().encode(content)
            : new Uint8Array(content as any);
        contentBuffer = bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength
        ) as ArrayBuffer;
      }
      blobToWrite = await encryptFileContent(contentBuffer, { fileName });
    } else {
      blobToWrite =
        content instanceof Uint8Array
          ? content
          : new Uint8Array(
              typeof content === 'string' ? new TextEncoder().encode(content) : (content as any)
            );
    }

    await window.electron.ipcRenderer.invoke(
      'hybrid:writeRawBlob',
      folderId,
      fileName,
      blobToWrite
    );
  }

  /**
   * Import V3 en streaming (gros fichiers > 500 Mo) : le main process
   * chiffre directement depuis le chemin OS avec la FEK de session —
   * conteneur V3 PORTABLE entre appareils, contenu jamais en mémoire
   * renderer. Erreur française « Coffre verrouille... » si la FEK de
   * session n'est pas chargée. Progression sur 'file:importProgress'.
   */
  async saveEncryptedFileFromPath(
    folderId: string,
    fileName: string,
    sourcePath: string
  ): Promise<{ size: number }> {
    return window.electron.ipcRenderer.invoke(
      'hybrid:saveFromPath',
      folderId,
      fileName,
      sourcePath
    );
  }

  // --- Reminders/items: delegate to cloud with local fallback ---

  async addReminder(itemId: string, reminder: Reminder): Promise<Reminder> {
    if (this.isOnline()) {
      try {
        return await this.cloud.addReminder(itemId, reminder);
      } catch {
        /* fallback */
      }
    }
    return this.local.addReminder(itemId, reminder);
  }

  async updateReminder(
    itemId: string,
    reminderId: string,
    updatedReminder: Partial<Reminder>
  ): Promise<Reminder> {
    if (this.isOnline()) {
      try {
        return await this.cloud.updateReminder(itemId, reminderId, updatedReminder);
      } catch {
        /* fallback */
      }
    }
    return this.local.updateReminder(itemId, reminderId, updatedReminder);
  }

  async deleteReminder(itemId: string, reminderId: string): Promise<boolean> {
    if (this.isOnline()) {
      try {
        return await this.cloud.deleteReminder(itemId, reminderId);
      } catch {
        /* fallback */
      }
    }
    return this.local.deleteReminder(itemId, reminderId);
  }

  async getAllReminders(): Promise<Reminder[]> {
    if (this.isOnline()) {
      try {
        return await this.cloud.getAllReminders();
      } catch {
        /* fallback */
      }
    }
    return this.local.getAllReminders();
  }

  async getReminders(itemId: string): Promise<Reminder[]> {
    if (this.isOnline()) {
      try {
        return await this.cloud.getReminders(itemId);
      } catch {
        /* fallback */
      }
    }
    return this.local.getReminders(itemId);
  }

  async getItem(id: string): Promise<Item> {
    if (this.isOnline()) {
      try {
        return await this.cloud.getItem(id);
      } catch {
        /* fallback */
      }
    }
    return this.local.getItem(id);
  }

  async updateItemInFolder(
    folderId: string | null,
    itemId: string,
    itemData: Partial<Item>
  ): Promise<Item> {
    try {
      await this.local.updateItemInFolder(folderId, itemId, itemData);
    } catch {
      /* best effort */
    }
    if (this.isOnline()) {
      try {
        return await this.cloud.updateItemInFolder(folderId, itemId, itemData);
      } catch {
        /* fallback */
      }
    }
    return this.local.updateItemInFolder(folderId, itemId, itemData);
  }

  /**
   * Hybride : le LOCAL fait autorité et DOIT réussir — c'est lui qui efface
   * les octets de façon sûre et marque le blob `deleted` dans le manifeste
   * main-side (le nuage perso R2 est nettoyé par le prochain cycle de synchro,
   * et la fiche voyage via `meta:folderId`). Le nuage legacy est ensuite
   * informé au mieux, comme pour `updateItemInFolder` : son échec ne défait
   * pas une conversion qui a réellement eu lieu. Pas de `hybrid:deleteBlob`
   * en plus : ce serait un `unlink` simple par-dessus un effacement sûr déjà fait.
   */
  async convertFileToVaultShortcut(
    folderId: string,
    fileId: string,
    ref: VaultShortcutRef
  ): Promise<Folder> {
    const folder = await this.local.convertFileToVaultShortcut(folderId, fileId, ref);
    if (this.isOnline()) {
      try {
        await this.cloud.convertFileToVaultShortcut(folderId, fileId, ref);
      } catch (error) {
        console.warn('[Hybrid] Cloud convertFileToVaultShortcut failed:', error);
      }
    }
    return folder;
  }

  async moveItem(
    itemId: string,
    sourceFolderId: string,
    targetFolderId: string
  ): Promise<import('../../types').MoveResult> {
    // Un côté à la racine ⇒ on déplace forcément un DOSSIER : il n'y a aucun
    // blob à relocaliser, et la racine n'a pas de répertoire de contenu.
    const touchesRoot = sourceFolderId === ROOT_FOLDER_ID || targetFolderId === ROOT_FOLDER_ID;

    let fileName: string | undefined;
    if (!touchesRoot) {
      try {
        const folder = await this.local.getFolder(sourceFolderId);
        const item = (folder.items as any[])?.find((i: any) => i.id === itemId);
        // Les dossiers n'ont pas de blob de contenu.
        if (item && item.type !== 'folder') fileName = item.name;
      } catch {
        /* ignore */
      }
    }

    if (fileName && window.electron?.ipcRenderer) {
      try {
        const exists = await window.electron.ipcRenderer.invoke(
          'hybrid:fileExists',
          sourceFolderId,
          fileName
        );
        if (exists) {
          const data: number[] = await window.electron.ipcRenderer.invoke(
            'hybrid:readRawBlob',
            sourceFolderId,
            fileName
          );
          await window.electron.ipcRenderer.invoke(
            'hybrid:writeRawBlob',
            targetFolderId,
            fileName,
            data
          );
          await window.electron.ipcRenderer.invoke('hybrid:deleteBlob', sourceFolderId, fileName);
        }
      } catch {
        /* ignore */
      }
    }

    // Le déplacement local n'est PAS rejouable : le rejouer en repli échouait
    // toujours (« item not found in source folder »), puisque le premier appel
    // avait déjà vidé le dossier source. On garde donc son résultat.
    let localResult: import('../../types').MoveResult | null = null;
    let localError: unknown = null;
    try {
      localResult = await this.local.moveItem(itemId, sourceFolderId, targetFolderId);
    } catch (error) {
      localError = error;
    }

    // Le nuage ne connaît pas la sentinelle racine (PUT /files/:id/move attend
    // un UUID de dossier) : un déplacement vers/depuis la racine reste local.
    if (this.isOnline() && !touchesRoot) {
      try {
        return await this.cloud.moveItem(itemId, sourceFolderId, targetFolderId);
      } catch {
        /* fallback */
      }
    }

    if (localResult) return localResult;
    throw localError instanceof Error ? localError : new Error('Move failed');
  }

  async copyItem(
    itemId: string,
    sourceFolderId: string,
    targetFolderId: string,
    newName?: string
  ): Promise<import('../../types').CopyResult> {
    let fileName: string | undefined;
    try {
      const folder = await this.local.getFolder(sourceFolderId);
      const item = (folder.items as any[])?.find((i: any) => i.id === itemId);
      fileName = item?.name;
    } catch {
      /* ignore */
    }

    if (fileName && window.electron?.ipcRenderer) {
      const targetName = newName || fileName;
      try {
        const exists = await window.electron.ipcRenderer.invoke(
          'hybrid:fileExists',
          sourceFolderId,
          fileName
        );
        if (exists) {
          const data: number[] = await window.electron.ipcRenderer.invoke(
            'hybrid:readRawBlob',
            sourceFolderId,
            fileName
          );
          await window.electron.ipcRenderer.invoke(
            'hybrid:writeRawBlob',
            targetFolderId,
            targetName,
            data
          );
        }
      } catch {
        /* ignore */
      }
    }

    if (this.isOnline()) {
      try {
        return await this.cloud.copyItem(itemId, sourceFolderId, targetFolderId, newName);
      } catch {
        /* fallback */
      }
    }
    return this.local.copyItem(itemId, sourceFolderId, targetFolderId, newName);
  }
}

export type StorageMode = 'local' | 'byos' | 'cloud' | 'hybrid';

/**
 * Creates a StorageAdapter with the appropriate implementation
 */
export function createStorageAdapter(mode: StorageMode = 'local'): StorageAdapter {
  switch (mode) {
    case 'byos':
      return new StorageAdapter(new BYOSStorageImplementation());
    case 'hybrid':
      return new StorageAdapter(new HybridStorageImplementation());
    case 'cloud':
      return new StorageAdapter(new CloudStorageImplementation());
    case 'local':
    default:
      return new StorageAdapter(new ElectronStorageImplementation());
  }
}

function getCurrentMode(): StorageMode {
  try {
    const config = getConfig();
    if (config.storageMode && config.storageMode !== 'local') {
      return config.storageMode as StorageMode;
    }
    // Default: server mode → hybrid (local-first + cloud sync)
    if (config.useCloudStorage) return 'hybrid';
  } catch {
    /* not available yet */
  }
  return 'local';
}

/**
 * Mode de stockage effectif (celui que le Proxy dynamicAdapter utilisera).
 * Exposé pour permettre aux flux d'upload de router les gros fichiers vers
 * l'import V3 en streaming (mode local uniquement).
 */
export function getCurrentStorageMode(): StorageMode {
  return getCurrentMode();
}

// Cache adapters to avoid re-creating them on every call
const adapterCache: Partial<Record<StorageMode, StorageAdapter>> = {};

function getCachedAdapter(mode: StorageMode): StorageAdapter {
  if (!adapterCache[mode]) {
    adapterCache[mode] = createStorageAdapter(mode);
  }
  return adapterCache[mode]!;
}

/**
 * Dynamic adapter that delegates to the correct implementation
 * based on the current config (useCloudStorage).
 * This ensures that when the user switches to server/cloud mode,
 * folder/file operations go through the cloud API instead of local IPC.
 */
const dynamicAdapter: StorageAdapter = new Proxy({} as StorageAdapter, {
  get(_target, prop: string) {
    const adapter = getCachedAdapter(getCurrentMode());
    const value = (adapter as any)[prop];
    if (typeof value === 'function') {
      return value.bind(adapter);
    }
    return value;
  },
});

export default dynamicAdapter;
