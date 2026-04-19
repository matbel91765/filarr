/**
 * Hook pour les opérations sur les dossiers
 *
 * Ce hook fournit des méthodes pour gérer les opérations courantes
 * sur les dossiers et leurs éléments (ajout, suppression, renommage, etc.)
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { toast } from 'react-toastify';
import { folderService, fileService } from '../services';
import type { Item, DownloadResult, Folder, FileItem } from '../types';
import { isFolder } from '../types';

/**
 * Progress state for uploads and downloads
 */
export interface ProgressState {
  [itemId: string]: number;
}

/**
 * Folder deletion information
 */
export interface FolderDeletionInfo {
  folderName: string;
  items: Item[];
  totalItemCount: number;
  totalSize: number;
  noteCount: number;
}

/**
 * Return type for useFolderOperations hook
 */
export interface UseFolderOperationsReturn {
  addItem: (newItem: Item) => Promise<Item>;
  deleteItem: (
    item: Item,
    onConfirm?: (info: FolderDeletionInfo) => Promise<boolean>
  ) => Promise<void>;
  renameItem: (item: Item, newName: string) => Promise<void>;
  openFile: (item: Item) => Promise<void>;
  downloadFile: (item: Item, password?: string | null) => Promise<void>;
  uploadProgress: ProgressState;
  setUploadProgress: React.Dispatch<React.SetStateAction<ProgressState>>;
  downloadProgress: ProgressState;
  setDownloadProgress: React.Dispatch<React.SetStateAction<ProgressState>>;
}

/**
 * Hook pour les opérations sur les dossiers
 * @param id - ID du dossier
 * @param setItems - Fonction pour mettre à jour les éléments
 * @param loadFolder - Fonction pour recharger le dossier
 * @returns Fonctions et états pour les opérations sur les dossiers
 */
export const useFolderOperations = (
  id: string,
  setItems: React.Dispatch<React.SetStateAction<Item[]>>,
  loadFolder: () => Promise<void>
): UseFolderOperationsReturn => {
  const [uploadProgress, setUploadProgress] = useState<ProgressState>({});
  const [downloadProgress, setDownloadProgress] = useState<ProgressState>({});
  const timerRefs = useRef<Map<string, NodeJS.Timeout>>(new Map());

  // Cleanup all timers on unmount
  useEffect(() => {
    return () => {
      timerRefs.current.forEach((timerId) => clearTimeout(timerId));
      timerRefs.current.clear();
    };
  }, []);

  /**
   * Ajoute un élément au dossier
   * @param newItem - Nouvel élément à ajouter
   * @returns Élément ajouté
   */
  const addItem = useCallback(
    async (newItem: Item): Promise<Item> => {
      try {
        let addedItem: Item;

        // Déterminer si c'est un fichier ou un dossier
        if ('items' in newItem) {
          // C'est un dossier
          addedItem = await folderService.addItemToFolder(id, newItem);
        } else {
          // Considérer que c'est un fichier
          // Convertir FileItem en FileCreateData
          const fileData = {
            id: newItem.id,
            name: newItem.name,
            type: newItem.type,
            size: newItem.size,
            content:
              newItem.content instanceof ArrayBuffer ? Buffer.from(newItem.content) : undefined,
            date: newItem.date,
            description: newItem.description,
          };
          addedItem = await fileService.addFileToFolder(id, fileData);
        }

        setItems((prevItems) => [...prevItems, addedItem]);
        return addedItem;
      } catch (error: unknown) {
        console.error("Erreur lors de l'ajout de l'élément:", error);
        toast.error("Erreur lors de l'ajout de l'élément");
        throw error;
      }
    },
    [id, setItems]
  );

  /**
   * Calcule récursivement le nombre total d'items et la taille d'un dossier
   */
  const calculateFolderContents = useCallback((folder: Folder): { count: number; size: number } => {
    let totalCount = 0;
    let totalSize = 0;

    if (!folder.items || folder.items.length === 0) {
      return { count: 0, size: 0 };
    }

    // Pour chaque item dans le dossier
    for (const itemOrId of folder.items) {
      // Si c'est un objet (Item)
      if (typeof itemOrId === 'object' && itemOrId !== null) {
        const itemObj = itemOrId as Item;
        totalCount++;

        if (isFolder(itemObj)) {
          // C'est un sous-dossier, calculer récursivement
          const subResult = calculateFolderContents(itemObj as Folder);
          totalCount += subResult.count;
          totalSize += subResult.size;
        } else {
          // C'est un fichier
          const fileItem = itemObj as FileItem;
          totalSize += fileItem.size || 0;
        }
      } else {
        // Si c'est juste un ID, on compte 1 mais on ne peut pas calculer la taille
        totalCount++;
      }
    }

    return { count: totalCount, size: totalSize };
  }, []);

  /**
   * Obtient les items d'un dossier sous forme d'objets Item
   */
  const getFolderItems = useCallback((folder: Folder): Item[] => {
    if (!folder.items || folder.items.length === 0) {
      return [];
    }

    return folder.items
      .map((itemOrId) => {
        // Si c'est déjà un objet Item, le retourner
        if (typeof itemOrId === 'object' && itemOrId !== null) {
          return itemOrId as Item;
        }
        return null;
      })
      .filter((item): item is Item => item !== null);
  }, []);

  /**
   * Supprime un élément du dossier
   * @param item - Élément à supprimer
   * @param onConfirm - Callback optionnel pour confirmation (pour les dossiers avec contenu)
   */
  const deleteItem = useCallback(
    async (
      item: Item,
      onConfirm?: (info: FolderDeletionInfo) => Promise<boolean>
    ): Promise<void> => {
      try {
        // Si c'est un dossier avec des items, demander confirmation via le callback
        if (isFolder(item) && onConfirm) {
          const folder = item as Folder;
          const directItems = getFolderItems(folder);

          if (directItems.length > 0) {
            // Calculer les statistiques
            const { count: totalItemCount, size: totalSize } = calculateFolderContents(folder);

            const deletionInfo: FolderDeletionInfo = {
              folderName: item.name,
              items: directItems,
              totalItemCount,
              totalSize,
              noteCount: 0,
            };

            // Appeler le callback de confirmation
            const confirmed = await onConfirm(deletionInfo);

            if (!confirmed) {
              return;
            }
          } else {
            // Dossier vide, confirmation simple
            if (
              !window.confirm(`Êtes-vous sûr de vouloir supprimer le dossier vide "${item.name}" ?`)
            ) {
              return;
            }
          }
        } else if (!isFolder(item)) {
          // Pour les fichiers, confirmation simple
          if (!window.confirm(`Êtes-vous sûr de vouloir supprimer "${item.name}" ?`)) {
            return;
          }
        }

        // Procéder à la suppression
        if (isFolder(item)) {
          // C'est un dossier
          await folderService.removeItemFromFolder(id, item.id);
        } else {
          // C'est un fichier
          await fileService.deleteFile(id, item.id);
        }

        setItems((prevItems) => prevItems.filter((i) => i.id !== item.id));
        await loadFolder();
        toast.success(`"${item.name}" a été supprimé avec succès`);
      } catch (error: unknown) {
        console.error('[FOLDER OPERATIONS] deleteItem - error:', error);
        toast.error("Erreur lors de la suppression de l'élément");
      }
    },
    [id, setItems, loadFolder, calculateFolderContents, getFolderItems]
  );

  /**
   * Renomme un élément
   * @param item - Élément à renommer
   * @param newName - Nouveau nom
   */
  const renameItem = useCallback(
    async (item: Item, newName: string): Promise<void> => {
      try {
        if ('items' in item) {
          // C'est un dossier
          await folderService.renameItem(id, item.id, newName);
        } else {
          // Considérer que c'est un fichier
          await fileService.renameFile(id, item.id, newName);
        }

        setItems((prevItems) =>
          prevItems.map((i) => (i.id === item.id ? { ...i, name: newName } : i))
        );

        await loadFolder();
      } catch (error: unknown) {
        console.error('Erreur lors du renommage:', error);
        toast.error("Erreur lors du renommage de l'élément");
      }
    },
    [id, setItems, loadFolder]
  );

  /**
   * Ouvre un fichier
   * @param item - Fichier à ouvrir
   */
  const openFile = useCallback(
    async (item: Item): Promise<void> => {
      try {
        if ('items' in item) {
          // Naviguer vers le dossier plutôt que l'ouvrir
          // Cette fonctionnalité devrait être gérée par le composant parent
          return;
        }

        await fileService.openFile(id, item.name);
      } catch (error: unknown) {
        console.error("Erreur lors de l'ouverture du fichier:", error);
        const message = error instanceof Error ? error.message : 'Unknown error';
        toast.error(`Erreur lors de l'ouverture du fichier: ${message}`);
      }
    },
    [id]
  );

  /**
   * Télécharge un fichier
   * @param item - Fichier à télécharger
   * @param password - Mot de passe (si le fichier est protégé)
   */
  const downloadFile = useCallback(
    async (item: Item, password: string | null = null): Promise<void> => {
      try {
        setDownloadProgress((prev) => ({
          ...prev,
          [item.id]: 0,
        }));

        const result: DownloadResult = await fileService.downloadFile(id, item.id, password);

        if (result.success) {
          setDownloadProgress((prev) => ({
            ...prev,
            [item.id]: 100,
          }));

          toast.success(`Téléchargement de ${item.name} terminé`);

          // Nettoyer la barre de progression après un délai
          const timerId = setTimeout(() => {
            setDownloadProgress((prev) => {
              const newProgress = { ...prev };
              delete newProgress[item.id];
              return newProgress;
            });
            timerRefs.current.delete(item.id);
          }, 2000);

          // Clear any existing timer for this item
          if (timerRefs.current.has(item.id)) {
            clearTimeout(timerRefs.current.get(item.id));
          }
          timerRefs.current.set(item.id, timerId);
        } else if (result.canceled) {
          setDownloadProgress((prev) => {
            const newProgress = { ...prev };
            delete newProgress[item.id];
            return newProgress;
          });
        } else {
          setDownloadProgress((prev) => ({
            ...prev,
            [item.id]: -1, // Indique une erreur
          }));

          toast.error(`Erreur lors du téléchargement de ${item.name}`);
        }
      } catch (error: unknown) {
        console.error('Erreur lors du téléchargement:', error);
        const message = error instanceof Error ? error.message : 'Unknown error';
        toast.error(`Erreur lors du téléchargement: ${message}`);

        setDownloadProgress((prev) => ({
          ...prev,
          [item.id]: -1, // Indique une erreur
        }));
      }
    },
    [id]
  );

  return {
    addItem,
    deleteItem,
    renameItem,
    openFile,
    downloadFile,
    uploadProgress,
    setUploadProgress,
    downloadProgress,
    setDownloadProgress,
  };
};

export default useFolderOperations;
