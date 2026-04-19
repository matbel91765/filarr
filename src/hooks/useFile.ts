/**
 * Hook personnalisé pour la gestion des fichiers avec Redux
 *
 * Ce hook encapsule la logique métier et d'état relative aux fichiers,
 * permettant aux composants d'interagir facilement avec le store Redux.
 */

import { useCallback } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
  addFileToFolder,
  readFile,
  deleteFile,
  renameFile,
  updateFileMetadata,
  downloadFile,
  selectFile,
  unselectFile,
  clearSelection
} from '../store/slices/filesSlice';
import {
  selectAllFiles,
  selectFileById,
  selectSelectedFiles,
  selectIsLoadingFiles,
  selectFilesError,
  selectUploadProgress,
  selectDownloadProgress,
} from '../store/selectors/fileSelectors';
import { fileService } from '../services';
import {
  showSuccessNotification,
  showErrorNotification
} from '../store/slices/uiSlice';
import type { SerializedError } from '@reduxjs/toolkit';
import type { RootState, AppDispatch } from '../store';
import type { FileItem } from '../types';

/**
 * Return type for useFile hook
 */
export interface UseFileReturn {
  // Données
  files: FileItem[];
  file: FileItem | null;
  selectedFiles: FileItem[];
  isLoading: boolean;
  error: SerializedError | null;
  uploadProgress: number;
  downloadProgress: number;

  // Méthodes
  addFile: (folderId: string, file: File) => Promise<any>;
  getFileContent: (folderId: string, fileName: string) => Promise<any>;
  openFileWithSystem: (folderId: string, fileName: string) => Promise<string | null>;
  removeFile: (folderId: string, fileId: string) => Promise<boolean>;
  renameFile: (folderId: string, fileId: string, newName: string) => Promise<boolean>;
  updateMetadata: (folderId: string, fileId: string, metadata: any) => Promise<any>;
  download: (folderId: string, fileId: string, password?: string | undefined) => Promise<any>;
  select: (fileId: string) => void;
  unselect: (fileId: string) => void;
  clearAllSelections: () => void;
  isSelected: (fileId: string) => boolean;
}

/**
 * Hook personnalisé pour gérer les opérations sur les fichiers
 * @param fileId - ID du fichier (optionnel)
 * @returns Méthodes et données pour gérer les fichiers
 */
export default function useFile(fileId: string | null = null): UseFileReturn {
  const dispatch = useDispatch<AppDispatch>();

  // Sélecteurs de données
  const allFiles = useSelector(selectAllFiles);
  const file = useSelector((state: RootState) =>
    fileId ? selectFileById(fileId)(state) : null
  );
  const selectedFiles = useSelector(selectSelectedFiles);
  const isLoading = useSelector(selectIsLoadingFiles);
  const error = useSelector(selectFilesError);

  // Progression de téléchargement/upload spécifique au fichier si fileId est fourni
  const uploadProgress = useSelector((state: RootState) =>
    fileId ? selectUploadProgress(fileId)(state) : 0
  );
  const downloadProgress = useSelector((state: RootState) =>
    fileId ? selectDownloadProgress(fileId)(state) : 0
  );

  // Ajouter un fichier à un dossier
  const addFile = useCallback(async (folderId: string, file: File): Promise<any> => {
    try {
      const result = await dispatch(addFileToFolder({ folderId, file })).unwrap();
      dispatch(showSuccessNotification(`Le fichier ${file.name} a été ajouté avec succès`));
      return result;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      dispatch(showErrorNotification(`Erreur lors de l'ajout du fichier: ${message}`));
      return null;
    }
  }, [dispatch]);

  // Lire le contenu d'un fichier
  const getFileContent = useCallback(async (folderId: string, fileName: string): Promise<any> => {
    try {
      const result = await dispatch(readFile({ folderId, fileName })).unwrap();
      return result.content;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      dispatch(showErrorNotification(`Erreur lors de la lecture du fichier: ${message}`));
      return null;
    }
  }, [dispatch]);

  // Supprimer un fichier
  const removeFile = useCallback(async (folderId: string, fileId: string): Promise<boolean> => {
    try {
      await dispatch(deleteFile({ folderId, fileId })).unwrap();
      dispatch(showSuccessNotification('Fichier supprimé avec succès'));
      return true;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      dispatch(showErrorNotification(`Erreur lors de la suppression du fichier: ${message}`));
      return false;
    }
  }, [dispatch]);

  // Renommer un fichier
  const renameFileById = useCallback(async (
    folderId: string,
    fileId: string,
    newName: string
  ): Promise<boolean> => {
    try {
      await dispatch(renameFile({ folderId, fileId, newName })).unwrap();
      dispatch(showSuccessNotification(`Fichier renommé en "${newName}" avec succès`));
      return true;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      dispatch(showErrorNotification(`Erreur lors du renommage du fichier: ${message}`));
      return false;
    }
  }, [dispatch]);

  // Mettre à jour les métadonnées d'un fichier
  const updateMetadata = useCallback(async (
    folderId: string,
    fileId: string,
    metadata: any
  ): Promise<any> => {
    try {
      const result = await dispatch(updateFileMetadata({ folderId, fileId, metadata })).unwrap();
      dispatch(showSuccessNotification('Métadonnées du fichier mises à jour avec succès'));
      return result;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      dispatch(showErrorNotification(`Erreur lors de la mise à jour des métadonnées: ${message}`));
      return null;
    }
  }, [dispatch]);

  // Télécharger un fichier
  const download = useCallback(async (
    folderId: string,
    fileId: string,
    password: string | undefined = undefined
  ): Promise<any> => {
    try {
      const result = await dispatch(downloadFile({ folderId, fileId, password })).unwrap();
      dispatch(showSuccessNotification('Fichier téléchargé avec succès'));
      return result;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      dispatch(showErrorNotification(`Erreur lors du téléchargement du fichier: ${message}`));
      return null;
    }
  }, [dispatch]);

  // Sélectionner un fichier
  const select = useCallback((fileId: string) => {
    dispatch(selectFile(fileId));
  }, [dispatch]);

  // Désélectionner un fichier
  const unselect = useCallback((fileId: string) => {
    dispatch(unselectFile(fileId));
  }, [dispatch]);

  // Effacer toutes les sélections
  const clearAllSelections = useCallback(() => {
    dispatch(clearSelection());
  }, [dispatch]);

  // Vérifier si un fichier est sélectionné
  const isSelected = useCallback((fileId: string): boolean => {
    return selectedFiles.some((file: FileItem) => file.id === fileId);
  }, [selectedFiles]);

  // Ouvrir un fichier avec l'application système
  const openFileWithSystem = useCallback(async (
    folderId: string,
    fileName: string
  ): Promise<string | null> => {
    try {
      const filePath = await fileService.openFile(folderId, fileName);
      // No specific success notification here as the file should just open.
      // Error will be caught by the service or component.
      return filePath; // Path to temporary decrypted file, if applicable
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      dispatch(showErrorNotification(`Erreur lors de l'ouverture du fichier ${fileName}: ${message}`));
      return null;
    }
  }, [dispatch]);

  // Retourner les données et les méthodes
  return {
    // Données
    files: allFiles,
    file,
    selectedFiles,
    isLoading,
    error,
    uploadProgress,
    downloadProgress,

    // Méthodes
    addFile,
    getFileContent,
    openFileWithSystem,
    removeFile,
    renameFile: renameFileById,
    updateMetadata,
    download,
    select,
    unselect,
    clearAllSelections,
    isSelected
  };
}
