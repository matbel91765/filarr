/**
 * Service de gestion des fichiers (TypeScript)
 *
 * Ce module encapsule la logique métier liée aux fichiers, en utilisant l'adaptateur
 * de stockage pour les opérations de persistance.
 */

import storageAdapter from './storageAdapter';
import { generateUniqueId } from '../../utils/idGenerator';
import errorService from '../platform/errorService';
import { encryptFileContent, hasHybridKey } from '../auth/hybridCrypto';
import type { Folder, FileItem, FileCreateData, DownloadResult, Item } from '../../types';
import {
  MAX_FILE_SIZE,
  MAX_FILES_BATCH,
  FILE_ERRORS,
  isExtensionAllowed,
  formatBytes,
} from '../../constants/limits';

// Track active file watchers to avoid duplicates
const _activeWatchers = new Set<string>();

/**
 * Sets up a listener for file-changed events in hybrid mode.
 * When the user edits a file in an external app, this re-encrypts
 * the modified content locally and queues an upload to cloud.
 */
function setupHybridFileWatcher(folderId: string, fileName: string): void {
  const watchKey = `${folderId}/${fileName}`;
  if (_activeWatchers.has(watchKey)) return;
  _activeWatchers.add(watchKey);

  if (!window.electron?.ipcRenderer) return;

  const handler = async (...args: any[]) => {
    const data = args[0];
    // The file-changed event may carry the temp file path or metadata
    const changedFileName = data?.fileName || data?.name;
    const tempPath = data?.tempPath || data?.path;

    console.log('[Hybrid Watcher] file-changed event received:', {
      changedFileName,
      tempPath,
      expectedFileName: fileName,
    });

    // Only handle events for our file
    if (changedFileName && changedFileName !== fileName) {
      console.log(
        '[Hybrid Watcher] Ignoring — fileName mismatch:',
        changedFileName,
        '!==',
        fileName
      );
      return;
    }

    if (!tempPath) {
      console.warn('[Hybrid Watcher] No tempPath in event, skipping');
      return;
    }

    if (!hasHybridKey()) {
      console.warn('[Hybrid Watcher] No hybrid key available — cannot re-encrypt');
      return;
    }

    try {
      // Read the modified temp file (returns number[] from main process)
      const modifiedContent: number[] | Uint8Array | null =
        await window.electron.ipcRenderer.invoke('readTempFile', tempPath);
      if (!modifiedContent || (Array.isArray(modifiedContent) && modifiedContent.length === 0)) {
        console.warn('[Hybrid Watcher] readTempFile returned empty content');
        return;
      }

      const contentArray =
        modifiedContent instanceof Uint8Array
          ? modifiedContent
          : new Uint8Array(
              Array.isArray(modifiedContent) ? modifiedContent : Object.values(modifiedContent)
            );

      console.log(
        '[Hybrid Watcher] Re-encrypting modified file:',
        fileName,
        'size:',
        contentArray.byteLength
      );

      // Re-encrypt with FEK
      const encrypted = await encryptFileContent(contentArray.buffer as ArrayBuffer);

      // Write back to local storage
      await window.electron.ipcRenderer.invoke(
        'hybrid:writeRawBlob',
        folderId,
        fileName,
        encrypted
      );

      console.log('[Hybrid Watcher] Successfully re-encrypted file locally:', fileName);
    } catch (error) {
      console.error('[Hybrid] Error re-encrypting modified file:', error);
    }
  };

  window.electron.ipcRenderer.on('file-changed', handler);

  // Auto-cleanup after 30 minutes (file editing session timeout)
  setTimeout(
    () => {
      _activeWatchers.delete(watchKey);
      window.electron?.ipcRenderer?.removeListener('file-changed', handler);
    },
    30 * 60 * 1000
  );
}

/**
 * Validates a file before upload
 * @param file - File to validate
 * @throws Error if file is invalid
 */
export const validateFile = (file: FileCreateData): void => {
  if (!file.name) {
    throw errorService.createValidationError('Le nom du fichier est requis');
  }

  // Check file extension
  if (!isExtensionAllowed(file.name)) {
    throw errorService.createValidationError(`${FILE_ERRORS.BLOCKED_EXTENSION}: ${file.name}`);
  }

  // Check file size
  const fileSize = file.size || (file.content ? file.content.length : 0);
  if (fileSize > MAX_FILE_SIZE) {
    throw errorService.createValidationError(
      `${FILE_ERRORS.TOO_LARGE}. File size: ${formatBytes(fileSize)}, Maximum: ${formatBytes(MAX_FILE_SIZE)}`
    );
  }
};

/**
 * Validates a batch of files before upload
 * @param files - Files to validate
 * @throws Error if batch is invalid
 */
export const validateFileBatch = (files: FileCreateData[]): void => {
  if (files.length > MAX_FILES_BATCH) {
    throw errorService.createValidationError(FILE_ERRORS.TOO_MANY_FILES);
  }

  files.forEach((file) => validateFile(file));
};

/**
 * Ajoute un fichier à un dossier
 * @param folderId - ID du dossier
 * @param file - Fichier à ajouter (avec propriétés name, type, size, content)
 * @returns Dossier mis à jour
 * @throws Error si les paramètres sont invalides ou si l'ajout échoue
 */
export const addFileToFolder = async (folderId: string, file: FileCreateData): Promise<Folder> => {
  if (!folderId) {
    throw errorService.createValidationError('ID de dossier requis');
  }

  // Validate file before processing
  validateFile(file);

  // Préparer le fichier avec un ID unique et d'autres métadonnées
  const newFile: FileItem = {
    id: file.id || generateUniqueId(),
    name: file.name,
    type: file.type || 'file',
    size: file.size || (file.content ? file.content.length : 0),
    createdAt: file.date || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  try {
    // Si le fichier a un contenu, le sauvegarder séparément
    if (file.content) {
      await storageAdapter.saveEncryptedFile(folderId, file.name, file.content);
    }

    // Ajouter les métadonnées du fichier au dossier
    return await storageAdapter.addItemToFolder(folderId, newFile);
  } catch (error) {
    throw errorService.createFileSystemError(
      `Impossible d'ajouter le fichier au dossier ${folderId}`,
      error as Error,
      { folderId, fileName: file.name }
    );
  }
};

/**
 * Lit le contenu d'un fichier
 * @param folderId - ID du dossier
 * @param fileName - Nom du fichier
 * @param decrypt - Si true, retourne le contenu déchiffré; si false, retourne le contenu chiffré
 * @returns Contenu du fichier (chiffré ou déchiffré selon le paramètre)
 * @throws Error si les paramètres sont manquants ou si la lecture échoue
 */
export const readFile = async (
  folderId: string,
  fileName: string,
  decrypt: boolean = true,
  onProgress?: (percent: number) => void
): Promise<Buffer> => {
  if (!folderId || !fileName) {
    throw errorService.createValidationError('ID de dossier et nom de fichier requis');
  }

  try {
    let fileData: Buffer;

    if (decrypt && window.electron?.ipcRenderer) {
      fileData = await window.electron.ipcRenderer.invoke(
        'readEncryptedFileForCopy',
        folderId,
        fileName
      );
    } else {
      fileData = await storageAdapter.readEncryptedFile(folderId, fileName, onProgress);
    }

    return fileData;
  } catch (error) {
    const isNotFound =
      error instanceof Error &&
      (error.message.includes('ENOENT') || error.message.includes('not found'));
    if (!isNotFound) {
      console.error('[FILE SERVICE] Error reading file:', error);
    }
    throw errorService.createFileSystemError(
      `Impossible de lire le fichier ${fileName}`,
      error as Error,
      { folderId, fileName, decrypt }
    );
  }
};

/**
 * Supprime un fichier (soft delete - déplace vers la corbeille)
 * @param folderId - ID du dossier
 * @param itemId - ID du fichier ou nom du fichier
 * @param permanent - Si true, supprime définitivement; si false, soft delete (corbeille)
 * @returns Dossier mis à jour
 * @throws Error si les paramètres sont manquants ou si la suppression échoue
 */
export const deleteFile = async (
  folderId: string,
  itemId: string,
  permanent: boolean = false
): Promise<Folder> => {
  if (!folderId || !itemId) {
    throw errorService.createValidationError('ID de dossier et ID de fichier requis');
  }

  try {
    // Récupérer le dossier pour vérifier si l'item existe et obtenir son nom
    const folder: any = await storageAdapter.getFolder(folderId);

    // Find the file by ID or name
    const fileItem = folder.items.find((item: any) => item.id === itemId || item.name === itemId);

    if (!fileItem) {
      throw errorService.createNotFoundError(
        `Fichier ${itemId} non trouvé dans le dossier ${folderId}`,
        { folderId, itemId }
      );
    }

    // Use the proper IPC handler that supports soft delete
    // Pass the file NAME (not ID) to the IPC handler
    await window.electron.ipcRenderer.invoke(
      'storage:deleteFile',
      folderId,
      fileItem.name,
      permanent
    );

    // Return the updated folder
    return await storageAdapter.getFolder(folderId);
  } catch (error) {
    console.error('[FILE SERVICE] deleteFile - error:', error);
    // Si c'est déjà une AppError, la renvoyer directement
    if ((error as any).name === 'AppError') {
      throw error;
    }

    throw errorService.createFileSystemError(
      `Impossible de supprimer le fichier ${itemId}`,
      error as Error,
      { folderId, itemId }
    );
  }
};

/**
 * Renomme un fichier
 * @param folderId - ID du dossier
 * @param itemId - ID du fichier
 * @param newName - Nouveau nom
 * @returns true si le renommage a réussi
 * @throws Error si les paramètres sont manquants ou si le renommage échoue
 */
export const renameFile = async (
  folderId: string,
  itemId: string,
  newName: string
): Promise<boolean> => {
  if (!folderId || !itemId || !newName) {
    throw errorService.createValidationError('ID de dossier, ID de fichier et nouveau nom requis');
  }

  try {
    // Récupérer le dossier pour vérifier si l'item existe
    const folder = await storageAdapter.getFolder(folderId);

    // folder.items peut contenir des strings (IDs) ou des objets ({id, name, ...})
    const folderItems = folder.items as any[];
    const foundItem = folderItems.find((item: any) =>
      typeof item === 'string' ? item === itemId : item?.id === itemId
    );
    if (!foundItem) {
      throw errorService.createNotFoundError(
        `Fichier ${itemId} non trouvé dans le dossier ${folderId}`,
        { folderId, itemId, newName }
      );
    }

    // Extraire le nom actuel directement depuis l'item trouvé
    const oldName = typeof foundItem === 'string' ? foundItem : foundItem.name;

    return await storageAdapter.renameItem(folderId, itemId, oldName, newName);
  } catch (error) {
    // Si c'est déjà une AppError, la renvoyer directement
    if ((error as any).name === 'AppError') {
      throw error;
    }

    throw errorService.createFileSystemError(
      `Impossible de renommer le fichier ${itemId}`,
      error as Error,
      { folderId, itemId, newName }
    );
  }
};

/**
 * Ouvre un fichier
 * @param folderId - ID du dossier
 * @param fileName - Nom du fichier
 * @param shouldOpen - Indique si le fichier doit être ouvert après déchiffrement
 * @returns Chemin du fichier temporaire
 * @throws Error si les paramètres sont manquants ou si l'ouverture échoue
 */
export const openFile = async (
  folderId: string,
  fileName: string,
  shouldOpen: boolean = true,
  onProgress?: (percent: number) => void
): Promise<string> => {
  if (!folderId || !fileName) {
    throw errorService.createValidationError('ID de dossier et nom de fichier requis');
  }

  try {
    if (window.electron?.ipcRenderer) {
      return await window.electron.ipcRenderer.invoke(
        'openEncryptedFile',
        folderId,
        fileName,
        shouldOpen
      );
    }

    // Browser fallback: read via storage adapter, open via blob URL
    const data = await storageAdapter.readEncryptedFile(folderId, fileName, onProgress);
    const blob = new Blob([new Uint8Array(data)], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    if (shouldOpen) {
      window.open(url, '_blank');
    }
    return url;
  } catch (error) {
    throw errorService.createFileSystemError(
      `Impossible d'ouvrir le fichier ${fileName}`,
      error as Error,
      { folderId, fileName, shouldOpen }
    );
  }
};

/**
 * Télécharge un fichier
 * @param folderId - ID du dossier
 * @param itemId - ID du fichier
 * @param password - Mot de passe (si le fichier est protégé)
 * @returns Résultat du téléchargement
 * @throws Error si les paramètres sont manquants ou si le téléchargement échoue
 */
export const downloadFile = async (
  folderId: string,
  itemId: string,
  password: string | null = null
): Promise<DownloadResult> => {
  if (!folderId || !itemId) {
    throw errorService.createValidationError('ID de dossier et ID de fichier requis');
  }

  try {
    // Récupérer l'élément pour vérifier s'il est protégé
    const item = await storageAdapter.getItem(itemId);

    if ('protected' in item && item.protected && !password) {
      throw errorService.createAuthenticationError('Mot de passe requis pour ce fichier protégé');
    }

    const savePath = await window.electron.ipcRenderer.invoke('showSaveDialog', {
      defaultPath: item.name,
    });

    if (!savePath) {
      return { success: false, canceled: true };
    }

    return await window.electron.ipcRenderer.invoke('downloadItem', {
      folderId,
      itemId,
      savePath,
      password,
    });
  } catch (error) {
    // Si c'est déjà une AppError, la renvoyer directement
    if ((error as any).name === 'AppError') {
      throw error;
    }

    throw errorService.createFileSystemError(
      'Impossible de télécharger le fichier',
      error as Error,
      { folderId, itemId }
    );
  }
};

/**
 * Télécharge plusieurs fichiers en tant qu'archive ZIP
 * @param folderId - ID du dossier contenant les fichiers
 * @param itemIds - IDs des éléments à télécharger
 * @returns Résultat du téléchargement
 */
export const downloadMultipleFiles = async (
  folderId: string,
  itemIds: string[]
): Promise<DownloadResult> => {
  if (!folderId || !itemIds.length) {
    throw errorService.createValidationError('ID de dossier et éléments requis');
  }

  try {
    const timestamp = new Date().toISOString().slice(0, 10);
    const defaultName = `filarr-${itemIds.length}-fichiers-${timestamp}.zip`;

    const savePath = await window.electron.ipcRenderer.invoke('showSaveDialog', {
      defaultPath: defaultName,
      filters: [{ name: 'Archive ZIP', extensions: ['zip'] }],
    });

    if (!savePath) {
      return { success: false, canceled: true };
    }

    return await window.electron.ipcRenderer.invoke('downloadMultipleAsZip', {
      folderId,
      itemIds,
      savePath,
    });
  } catch (error) {
    if ((error as any).name === 'AppError') {
      throw error;
    }
    throw errorService.createFileSystemError(
      'Impossible de télécharger les fichiers',
      error as Error,
      { folderId }
    );
  }
};

/**
 * Met à jour les métadonnées d'un fichier
 * @param folderId - ID du dossier
 * @param itemId - ID du fichier
 * @param updatedData - Données mises à jour
 * @returns Fichier mis à jour
 * @throws Error si les paramètres sont manquants ou si la mise à jour échoue
 */
export const updateFileMetadata = async (
  folderId: string,
  itemId: string,
  updatedData: Partial<Item>
): Promise<Item> => {
  if (!folderId || !itemId) {
    throw errorService.createValidationError('ID de dossier et ID de fichier requis');
  }

  try {
    return await storageAdapter.updateItemInFolder(folderId, itemId, updatedData);
  } catch (error) {
    throw errorService.createFileSystemError(
      `Impossible de mettre à jour les métadonnées du fichier ${itemId}`,
      error as Error,
      { folderId, itemId, updatedData }
    );
  }
};

/**
 * Déplace un fichier d'un dossier vers un autre
 * @param fileId - ID du fichier
 * @param sourceFolderId - ID du dossier source
 * @param targetFolderId - ID du dossier cible
 * @returns Résultat du déplacement
 * @throws Error si les paramètres sont manquants ou si le déplacement échoue
 */
export const moveFile = async (
  fileId: string,
  sourceFolderId: string,
  targetFolderId: string
): Promise<import('../../types').MoveResult> => {
  if (!fileId || !sourceFolderId || !targetFolderId) {
    throw errorService.createValidationError(
      'ID de fichier, ID de dossier source et ID de dossier cible requis'
    );
  }

  if (sourceFolderId === targetFolderId) {
    throw errorService.createValidationError(
      'Le dossier source et le dossier cible doivent être différents'
    );
  }

  try {
    return await storageAdapter.moveItem(fileId, sourceFolderId, targetFolderId);
  } catch (error) {
    throw errorService.createFileSystemError(
      `Impossible de déplacer le fichier ${fileId}`,
      error as Error,
      { fileId, sourceFolderId, targetFolderId }
    );
  }
};

/**
 * Copie un fichier d'un dossier vers un autre
 * @param fileId - ID du fichier
 * @param sourceFolderId - ID du dossier source
 * @param targetFolderId - ID du dossier cible
 * @param newName - Nouveau nom pour la copie (optionnel)
 * @returns Résultat de la copie
 * @throws Error si les paramètres sont manquants ou si la copie échoue
 */
export const copyFile = async (
  fileId: string,
  sourceFolderId: string,
  targetFolderId: string,
  newName?: string
): Promise<import('../../types').CopyResult> => {
  if (!fileId || !sourceFolderId || !targetFolderId) {
    throw errorService.createValidationError(
      'ID de fichier, ID de dossier source et ID de dossier cible requis'
    );
  }

  try {
    return await storageAdapter.copyItem(fileId, sourceFolderId, targetFolderId, newName);
  } catch (error) {
    throw errorService.createFileSystemError(
      `Impossible de copier le fichier ${fileId}`,
      error as Error,
      { fileId, sourceFolderId, targetFolderId, newName }
    );
  }
};
