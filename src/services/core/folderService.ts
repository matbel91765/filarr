/**
 * Service de gestion des dossiers (TypeScript)
 *
 * Ce module encapsule la logique métier liée aux dossiers, en utilisant l'adaptateur
 * de stockage pour les opérations de persistance.
 */

import storageAdapter, { ROOT_FOLDER_ID } from './storageAdapter';
import { generateUniqueId } from '../../utils/idGenerator';
import type { Folder, FolderCreateData, PathItem } from '../../types';

export { ROOT_FOLDER_ID };

/**
 * Récupère tous les dossiers
 * @returns Liste des dossiers
 * @throws Error si la récupération échoue
 */
export const getFolders = async (): Promise<Folder[]> => {
  try {
    return await storageAdapter.getFolders();
  } catch (error) {
    console.error('Erreur lors de la récupération des dossiers:', error);
    throw new Error('Impossible de récupérer les dossiers', { cause: error });
  }
};

/**
 * Récupère un dossier par son ID
 * @param id - ID du dossier
 * @returns Dossier
 * @throws Error si l'ID est manquant ou si la récupération échoue
 */
export const getFolder = async (id: string): Promise<Folder> => {
  if (!id) {
    throw new Error('ID de dossier requis');
  }

  try {
    return await storageAdapter.getFolder(id);
  } catch (error) {
    console.error(`Erreur lors de la récupération du dossier ${id}:`, error);
    throw new Error(`Impossible de récupérer le dossier ${id}`, { cause: error });
  }
};

/**
 * Crée un nouveau dossier
 * @param folderData - Données du dossier à créer
 * @returns Dossier créé
 * @throws Error si le nom est manquant ou si la création échoue
 */
export const createFolder = async (folderData: FolderCreateData): Promise<Folder> => {
  if (!folderData.name) {
    throw new Error('Le nom du dossier est requis');
  }

  const folder: Folder = {
    id: folderData.id || generateUniqueId(),
    name: folderData.name,
    color: folderData.color || '#87CEEB',
    items: [], // items est un tableau de string (IDs), pas d'objets Item
    parentId: folderData.parentId || undefined,
    protected: folderData.protected || false,
    password: folderData.password || '',
    createdAt: folderData.date || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  try {
    return await storageAdapter.saveFolder(folder);
  } catch (error) {
    console.error('Erreur lors de la création du dossier:', error);
    throw new Error('Impossible de créer le dossier', { cause: error });
  }
};

/**
 * Met à jour un dossier
 * @param id - ID du dossier
 * @param updatedData - Données à mettre à jour (partielles)
 * @returns Dossier mis à jour
 * @throws Error si l'ID est manquant ou si la mise à jour échoue
 */
export const updateFolder = async (id: string, updatedData: Partial<Folder>): Promise<Folder> => {
  if (!id) {
    throw new Error('ID de dossier requis');
  }

  try {
    const existingFolder = await storageAdapter.getFolder(id);

    // Fusionner les données existantes avec les mises à jour
    const updatedFolder: Folder = {
      ...existingFolder,
      ...updatedData,
      id, // S'assurer que l'ID reste le même
      updatedAt: new Date().toISOString(),
    };

    return await storageAdapter.updateFolder(id, updatedFolder);
  } catch (error) {
    console.error(`Erreur lors de la mise à jour du dossier ${id}:`, error);
    throw new Error(`Impossible de mettre à jour le dossier ${id}`, { cause: error });
  }
};

/**
 * Supprime un dossier
 * @param id - ID du dossier
 * @param permanent - Si true, supprime définitivement; si false, soft delete (corbeille)
 * @returns true si la suppression a réussi
 * @throws Error si l'ID est manquant ou si la suppression échoue
 */
export const deleteFolder = async (id: string, permanent?: boolean): Promise<boolean> => {
  if (!id) {
    throw new Error('ID de dossier requis');
  }

  try {
    return await storageAdapter.deleteFolder(id, permanent);
  } catch (error) {
    console.error(`Erreur lors de la suppression du dossier ${id}:`, error);
    throw new Error(`Impossible de supprimer le dossier ${id}`, { cause: error });
  }
};

/**
 * Ajoute un élément à un dossier
 * @param folderId - ID du dossier
 * @param item - Élément à ajouter (fichier ou sous-dossier)
 * @returns Dossier mis à jour
 * @throws Error si les paramètres sont manquants ou si l'ajout échoue
 */
export const addItemToFolder = async (folderId: string, item: any): Promise<Folder> => {
  if (!folderId) {
    throw new Error('ID de dossier requis');
  }

  if (!item.name) {
    throw new Error("Le nom de l'élément est requis");
  }

  // Préparer l'élément avec un ID unique s'il n'en a pas déjà un
  const newItem = {
    ...item,
    id: item.id || generateUniqueId(),
    createdAt: item.date || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  try {
    return await storageAdapter.addItemToFolder(folderId, newItem);
  } catch (error) {
    console.error(`Erreur lors de l'ajout de l'élément au dossier ${folderId}:`, error);
    throw new Error(`Impossible d'ajouter l'élément au dossier ${folderId}`, { cause: error });
  }
};

/**
 * Supprime un élément d'un dossier
 * @param folderId - ID du dossier
 * @param itemId - ID de l'élément
 * @returns Dossier mis à jour
 * @throws Error si les paramètres sont manquants ou si la suppression échoue
 */
export const removeItemFromFolder = async (folderId: string, itemId: string): Promise<Folder> => {
  if (!folderId || !itemId) {
    throw new Error("ID de dossier et ID d'élément requis");
  }

  try {
    return await storageAdapter.removeItemFromFolder(folderId, itemId);
  } catch (error) {
    console.error(
      `Erreur lors de la suppression de l'élément ${itemId} du dossier ${folderId}:`,
      error
    );
    throw new Error(`Impossible de supprimer l'élément ${itemId} du dossier ${folderId}`, {
      cause: error,
    });
  }
};

/**
 * Renomme un élément
 * @param parentId - ID du dossier parent
 * @param itemId - ID de l'élément
 * @param newName - Nouveau nom
 * @returns true si le renommage a réussi
 * @throws Error si les paramètres sont manquants ou si le renommage échoue
 */
export const renameItem = async (
  parentId: string,
  itemId: string,
  newName: string
): Promise<boolean> => {
  if (!parentId || !itemId || !newName) {
    throw new Error("ID de dossier parent, ID d'élément et nouveau nom requis");
  }

  try {
    // Récupérer le dossier pour vérifier si l'item existe
    const folder = await storageAdapter.getFolder(parentId);

    if (!folder.items.includes(itemId)) {
      throw new Error(`Élément ${itemId} non trouvé dans le dossier ${parentId}`);
    }

    // Récupérer l'item pour obtenir son nom actuel
    const item = await storageAdapter.getItem(itemId);
    const oldName = item.name;

    return await storageAdapter.renameItem(parentId, itemId, oldName, newName);
  } catch (error) {
    console.error(`Erreur lors du renommage de l'élément ${itemId}:`, error);
    throw new Error(`Impossible de renommer l'élément ${itemId}`, { cause: error });
  }
};

/**
 * Récupère les éléments d'un dossier
 * @param folderId - ID du dossier
 * @returns Liste des éléments (fichiers et sous-dossiers)
 * @throws Error si l'ID est manquant ou si la récupération échoue
 */
export const getFolderItems = async (folderId: string): Promise<any[]> => {
  if (!folderId) {
    throw new Error('ID de dossier requis');
  }

  try {
    const folder = await storageAdapter.getFolder(folderId);
    return folder.items || [];
  } catch (error) {
    console.error(`Erreur lors de la récupération des éléments du dossier ${folderId}:`, error);
    throw new Error(`Impossible de récupérer les éléments du dossier ${folderId}`, {
      cause: error,
    });
  }
};

/**
 * Récupère le chemin complet d'un dossier (fil d'Ariane)
 * @param folderId - ID du dossier
 * @returns Chemin du dossier (liste de {id, name})
 * @throws Error si l'ID est manquant ou si la récupération échoue
 */
export const getFolderPath = async (folderId: string): Promise<PathItem[]> => {
  if (!folderId) {
    throw new Error('ID de dossier requis');
  }

  try {
    const path: PathItem[] = [];
    let currentId: string | undefined = folderId;

    while (currentId) {
      const folder = await storageAdapter.getFolder(currentId);
      path.unshift({ id: folder.id, name: folder.name });
      currentId = folder.parentId || undefined;
    }

    return path;
  } catch (error) {
    console.error(`Erreur lors de la récupération du chemin du dossier ${folderId}:`, error);
    throw new Error(`Impossible de récupérer le chemin du dossier ${folderId}`, { cause: error });
  }
};

/**
 * Déplace un dossier d'un dossier parent vers un autre
 *
 * `sourceFolderId`/`targetFolderId` acceptent la sentinelle {@link ROOT_FOLDER_ID} :
 * la racine n'est pas un dossier stocké, c'est l'absence de parent. Sans elle,
 * remonter un dossier au premier niveau était impossible.
 *
 * @param folderId - ID du dossier à déplacer
 * @param sourceFolderId - ID du dossier parent source (ou `'root'`)
 * @param targetFolderId - ID du dossier parent cible (ou `'root'`)
 * @returns Résultat du déplacement
 * @throws Error si les paramètres sont manquants ou si le déplacement échoue
 */
export const moveFolder = async (
  folderId: string,
  sourceFolderId: string,
  targetFolderId: string
): Promise<import('../../types').MoveResult> => {
  if (!folderId || !sourceFolderId || !targetFolderId) {
    throw new Error('ID de dossier, ID de dossier source et ID de dossier cible requis');
  }

  if (sourceFolderId === targetFolderId) {
    throw new Error('Le dossier source et le dossier cible doivent être différents');
  }

  if (folderId === targetFolderId || folderId === ROOT_FOLDER_ID) {
    throw new Error('Impossible de déplacer un dossier dans lui-même');
  }

  try {
    return await storageAdapter.moveItem(folderId, sourceFolderId, targetFolderId);
  } catch (error) {
    console.error(`Erreur lors du déplacement du dossier ${folderId}:`, error);
    // Conserver le motif : le toast de drag and drop l'affiche à l'utilisateur.
    const detail = error instanceof Error ? error.message : '';
    throw new Error(
      detail
        ? `Impossible de déplacer le dossier ${folderId} : ${detail}`
        : `Impossible de déplacer le dossier ${folderId}`,
      { cause: error }
    );
  }
};

/**
 * Copie un dossier d'un dossier parent vers un autre
 * @param folderId - ID du dossier à copier
 * @param sourceFolderId - ID du dossier parent source
 * @param targetFolderId - ID du dossier parent cible
 * @param newName - Nouveau nom pour la copie (optionnel)
 * @returns Résultat de la copie
 * @throws Error si les paramètres sont manquants ou si la copie échoue
 */
export const copyFolder = async (
  folderId: string,
  sourceFolderId: string,
  targetFolderId: string,
  newName?: string
): Promise<import('../../types').CopyResult> => {
  if (!folderId || !sourceFolderId || !targetFolderId) {
    throw new Error('ID de dossier, ID de dossier source et ID de dossier cible requis');
  }

  try {
    return await storageAdapter.copyItem(folderId, sourceFolderId, targetFolderId, newName);
  } catch (error) {
    console.error(`Erreur lors de la copie du dossier ${folderId}:`, error);
    throw new Error(`Impossible de copier le dossier ${folderId}`, { cause: error });
  }
};
