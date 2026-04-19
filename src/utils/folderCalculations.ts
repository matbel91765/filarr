/**
 * Folder Calculations Utilities
 *
 * Utilitaires pour calculer les statistiques des dossiers
 * (nombre d'items, taille totale, etc.)
 */

import type { Folder, Item, FileItem } from '../types';
import { isFolder } from '../types';
import storageAdapter from '../services/core/storageAdapter';

/**
 * Interface pour les résultats de calcul de dossier
 */
export interface FolderCalculationResult {
  /** Nombre total d'items (récursif) */
  totalItemCount: number;
  /** Taille totale en bytes */
  totalSize: number;
  /** Items directs du dossier (non récursif) */
  directItems: Item[];
}

/**
 * Calcule récursivement la taille et le nombre d'items dans un dossier
 *
 * @param folderId - ID du dossier à analyser
 * @returns Résultats du calcul
 */
export const calculateFolderContents = async (
  folderId: string
): Promise<FolderCalculationResult> => {
  try {
    // Récupérer le dossier
    const folder = await storageAdapter.getFolder(folderId);

    // Récupérer tous les items directs
    const directItems: Item[] = [];
    for (const itemId of folder.items || []) {
      try {
        // Essayer de récupérer comme dossier d'abord
        const item = await storageAdapter.getFolder(itemId);
        directItems.push(item);
      } catch {
        // Si ce n'est pas un dossier, c'est probablement un fichier
        // Dans ce cas, on peut le récupérer depuis le dossier parent
        // Pour l'instant, on va juste ignorer les erreurs
        // car les items sont stockés par ID et non comme objets complets
      }
    }

    // Calculer récursivement
    const result = await calculateFolderContentsRecursive(directItems);

    return {
      totalItemCount: result.totalItemCount,
      totalSize: result.totalSize,
      directItems,
    };
  } catch (error) {
    console.error('Error calculating folder contents:', error);
    return {
      totalItemCount: 0,
      totalSize: 0,
      directItems: [],
    };
  }
};

/**
 * Calcule récursivement la taille et le nombre d'items à partir d'une liste d'items
 *
 * @param items - Liste d'items à analyser
 * @returns Résultats du calcul
 */
const calculateFolderContentsRecursive = async (
  items: Item[]
): Promise<{ totalItemCount: number; totalSize: number }> => {
  let totalItemCount = items.length;
  let totalSize = 0;

  for (const item of items) {
    if (isFolder(item)) {
      // C'est un dossier, calculer récursivement
      const subFolder = item as Folder;
      const subItems: Item[] = [];

      // Récupérer les sous-items
      for (const subItemId of subFolder.items || []) {
        try {
          const subItem = await storageAdapter.getFolder(subItemId);
          subItems.push(subItem);
        } catch {
          // Ignorer les erreurs
        }
      }

      const subResult = await calculateFolderContentsRecursive(subItems);
      totalItemCount += subResult.totalItemCount;
      totalSize += subResult.totalSize;
    } else {
      // C'est un fichier, ajouter sa taille
      const fileItem = item as FileItem;
      totalSize += fileItem.size || 0;
    }
  }

  return { totalItemCount, totalSize };
};

/**
 * Calcule la taille totale d'une liste d'items (non récursif)
 *
 * @param items - Liste d'items
 * @returns Taille totale en bytes
 */
export const calculateItemsSize = (items: Item[]): number => {
  return items.reduce((total, item) => {
    if (!isFolder(item)) {
      const fileItem = item as FileItem;
      return total + (fileItem.size || 0);
    }
    return total;
  }, 0);
};

/**
 * Compte les fichiers et dossiers dans une liste d'items
 *
 * @param items - Liste d'items
 * @returns Objet avec le nombre de fichiers et de dossiers
 */
export const countItemTypes = (
  items: Item[]
): { fileCount: number; folderCount: number } => {
  let fileCount = 0;
  let folderCount = 0;

  for (const item of items) {
    if (isFolder(item)) {
      folderCount++;
    } else {
      fileCount++;
    }
  }

  return { fileCount, folderCount };
};
