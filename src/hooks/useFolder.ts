/**
 * Hook personnalisé pour la gestion des dossiers avec Redux
 *
 * Ce hook encapsule la logique métier et d'état relative aux dossiers,
 * permettant aux composants d'interagir facilement avec le store Redux.
 */

import { useCallback } from 'react';
import { useDispatch, useSelector, useStore } from 'react-redux';
import {
  fetchFolders,
  fetchFolder,
  createFolder,
  updateFolder,
  deleteFolder,
  setCurrentFolder,
} from '../store/slices/foldersSlice';
import { addFileToFolder, deleteFile, renameFile, downloadFile } from '../store/slices/filesSlice';
import {
  selectAllFolders,
  selectFolderById,
  selectCurrentFolder,
  selectIsLoadingFolders,
  selectFoldersError,
  selectFolderPathById,
} from '../store/selectors/folderSelectors';
import { showSuccessNotification, showErrorNotification } from '../store/slices/uiSlice';
import type { SerializedError } from '@reduxjs/toolkit';
import type { RootState, AppDispatch } from '../store';
import type { Folder, FolderCreateData, PathItem } from '../types';

/**
 * Return type for useFolder hook
 */
export interface UseFolderReturn {
  // Données
  folders: Folder[];
  folder: Folder | null;
  currentFolder: Folder | null;
  items: string[]; // IDs des items, pas les objets Item complets
  isLoading: boolean;
  error: SerializedError | null;

  // Méthodes dossiers
  loadFolders: () => Promise<boolean>;
  loadFolder: (id: string) => Promise<boolean>;
  loadFolderPath: (id: string) => Promise<PathItem[]>;
  setActiveFolder: (id: string | null) => void;
  addFolder: (folderData: FolderCreateData) => Promise<Folder | null>;
  editFolder: (id: string, folderData: Partial<FolderCreateData>) => Promise<Folder | null>;
  removeFolder: (id: string) => Promise<boolean>;

  // Méthodes fichiers
  uploadFile: (folderId: string, file: File) => Promise<any>;
  removeFile: (folderId: string, fileId: string) => Promise<boolean>;
  renameFile: (folderId: string, fileId: string, newName: string) => Promise<boolean>;
  downloadFile: (folderId: string, fileId: string, password?: string) => Promise<boolean>;
}

/**
 * Hook personnalisé pour gérer les opérations sur les dossiers
 * @param folderId - ID du dossier (optionnel)
 * @returns Méthodes et données pour gérer les dossiers
 */
export default function useFolder(folderId: string | null = null): UseFolderReturn {
  const dispatch = useDispatch<AppDispatch>();
  const store = useStore<RootState>();

  // Load folder path for breadcrumbs navigation
  const loadFolderPath = useCallback(
    async (id: string): Promise<PathItem[]> => {
      // Get the current state and use the selector to build the path
      const state = store.getState();
      const folderPath = selectFolderPathById(id)(state);

      // Convert Folder[] to PathItem[] (only id and name needed for breadcrumbs)
      const pathItems: PathItem[] = folderPath.map((folder) => ({
        id: folder.id,
        name: folder.name,
      }));

      return Promise.resolve(pathItems);
    },
    [store]
  );

  // Sélecteurs de données
  const allFolders = useSelector(selectAllFolders);
  const folder = useSelector((state: RootState) =>
    folderId ? selectFolderById(folderId)(state) : null
  );
  const currentFolder = useSelector(selectCurrentFolder);
  const isLoading = useSelector(selectIsLoadingFolders);
  const error = useSelector(selectFoldersError);

  // Charger tous les dossiers
  const loadFolders = useCallback(async (): Promise<boolean> => {
    try {
      await dispatch(fetchFolders()).unwrap();
      return true;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      dispatch(showErrorNotification(`Erreur lors du chargement des dossiers: ${message}`));
      return false;
    }
  }, [dispatch]);

  // Charger un dossier spécifique
  const loadFolder = useCallback(
    async (id: string): Promise<boolean> => {
      try {
        await dispatch(fetchFolder(id)).unwrap();
        return true;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        dispatch(showErrorNotification(`Erreur lors du chargement du dossier: ${message}`));
        return false;
      }
    },
    [dispatch]
  );

  // Définir le dossier courant
  const setActiveFolder = useCallback(
    (id: string | null) => {
      dispatch(setCurrentFolder(id));
    },
    [dispatch]
  );

  // Créer un nouveau dossier
  const addFolder = useCallback(
    async (folderData: FolderCreateData): Promise<Folder | null> => {
      try {
        const result = await dispatch(createFolder(folderData)).unwrap();
        dispatch(showSuccessNotification('Dossier créé avec succès'));

        // Si un sous-dossier est créé (a un parentId), recharger le dossier parent pour afficher le nouveau sous-dossier
        if (folderData.parentId) {
          await dispatch(fetchFolder(folderData.parentId));
        } else {
          // Sinon, recharger tous les dossiers racine
          await dispatch(fetchFolders());
        }

        return result;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        dispatch(showErrorNotification(`Erreur lors de la création du dossier: ${message}`));
        return null;
      }
    },
    [dispatch]
  );

  // Mettre à jour un dossier
  const editFolder = useCallback(
    async (id: string, folderData: Partial<FolderCreateData>): Promise<Folder | null> => {
      try {
        const result = await dispatch(
          updateFolder({
            folderId: id,
            folderData,
          })
        ).unwrap();
        dispatch(showSuccessNotification('Dossier mis à jour avec succès'));
        return result;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        dispatch(showErrorNotification(`Erreur lors de la mise à jour du dossier: ${message}`));
        return null;
      }
    },
    [dispatch]
  );

  // Supprimer un dossier
  const removeFolder = useCallback(
    async (id: string): Promise<boolean> => {
      try {
        await dispatch(deleteFolder(id)).unwrap();
        dispatch(showSuccessNotification('Dossier supprimé avec succès'));
        return true;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        dispatch(showErrorNotification(`Erreur lors de la suppression du dossier: ${message}`));
        return false;
      }
    },
    [dispatch]
  );

  // ========== GESTION DES FICHIERS ==========

  // Ajouter un fichier à un dossier
  const uploadFile = useCallback(
    async (folderId: string, file: File): Promise<any> => {
      try {
        const result = await dispatch(addFileToFolder({ folderId, file })).unwrap();
        dispatch(showSuccessNotification('Fichier uploadé avec succès'));
        return result;
      } catch (error: unknown) {
        // unwrap() d'un thunk rejeté via rejectWithValue lance le payload brut
        // (objet { name, message, ... }, PAS une instance d'Error) — lire
        // .message dans les deux cas pour faire remonter le détail français
        // du main process (ex. refus > 5 Go de l'import V3) jusqu'au toast.
        const rawMessage = (error as { message?: unknown } | null)?.message;
        const message =
          typeof rawMessage === 'string' && rawMessage ? rawMessage : 'Erreur inconnue';
        dispatch(showErrorNotification(`Erreur lors de l'upload: ${message}`));
        return null;
      }
    },
    [dispatch]
  );

  // Supprimer un fichier
  const removeFile = useCallback(
    async (folderId: string, fileId: string): Promise<boolean> => {
      try {
        await dispatch(deleteFile({ folderId, fileId })).unwrap();
        dispatch(showSuccessNotification('Fichier supprimé avec succès'));
        return true;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        dispatch(showErrorNotification(`Erreur lors de la suppression du fichier: ${message}`));
        return false;
      }
    },
    [dispatch]
  );

  // Renommer un fichier
  const renameFileItem = useCallback(
    async (folderId: string, fileId: string, newName: string): Promise<boolean> => {
      try {
        await dispatch(renameFile({ folderId, fileId, newName })).unwrap();
        dispatch(showSuccessNotification('Fichier renommé avec succès'));
        return true;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        dispatch(showErrorNotification(`Erreur lors du renommage: ${message}`));
        return false;
      }
    },
    [dispatch]
  );

  // Télécharger un fichier
  const downloadFileItem = useCallback(
    async (folderId: string, fileId: string, password?: string): Promise<boolean> => {
      try {
        const result = await dispatch(downloadFile({ folderId, fileId, password })).unwrap();
        if (!result.canceled) {
          dispatch(showSuccessNotification('Fichier téléchargé avec succès'));
        }
        return true;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        dispatch(showErrorNotification(`Erreur lors du téléchargement: ${message}`));
        return false;
      }
    },
    [dispatch]
  );

  // Récupérer les fichiers d'un dossier (depuis l'état folder)
  const items = folder?.items || [];

  // Retourner les données et les méthodes
  return {
    // Données
    folders: allFolders,
    folder,
    currentFolder,
    items,
    isLoading,
    error,

    // Méthodes dossiers
    loadFolders,
    loadFolder,
    loadFolderPath,
    setActiveFolder,
    addFolder,
    editFolder,
    removeFolder,

    // Méthodes fichiers
    uploadFile,
    removeFile,
    renameFile: renameFileItem,
    downloadFile: downloadFileItem,
  };
}
