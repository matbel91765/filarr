/**
 * Sélecteurs pour les fichiers
 *
 * Ces sélecteurs optimisent l'accès aux données des fichiers dans le store Redux,
 * en utilisant la memoization pour éviter les calculs redondants.
 */

import { createSelector } from '@reduxjs/toolkit';
import type { RootState } from '../index';

// Sélecteurs de base (non-memoized)
const selectFilesState = (state: RootState) => state.files;
const selectUiState = (state: RootState) => state.ui;
const selectFoldersState = (state: RootState) => state.folders;

// Sélecteurs memoized pour les fichiers
export const selectAllFiles = createSelector(
  [selectFilesState],
  files => (files.allIds || []).map(id => files.byId[id]).filter(file => file && !file.deletedAt)
);

// Sélecteur pour tous les fichiers incluant ceux supprimés
export const selectAllFilesIncludingDeleted = createSelector(
  [selectFilesState],
  files => (files.allIds || []).map(id => files.byId[id]).filter(Boolean)
);

export const selectFileById = (id: string) => createSelector(
  [selectFilesState],
  files => (files.byId && files.byId[id]) || null
);

export const selectSelectedFiles = createSelector(
  [selectFilesState],
  files => (files.selectedIds || []).map(id => files.byId[id]).filter(file => file)
);

export const selectIsFileSelected = (id: string) => createSelector(
  [selectFilesState],
  files => (files.selectedIds || []).includes(id)
);

export const selectFilesInFolder = (folderId: string) => createSelector(
  [selectFilesState, selectFoldersState],
  (files, folders) => {
    const folder = folders.byId[folderId];
    if (!folder || !folder.items) return [];

    return folder.items
      .map(id => files.byId[id])
      .filter(file => file && file.type !== 'folder' && !file.deletedAt); // Filtrer les sous-dossiers et fichiers supprimés
  }
);

export const selectSortedFiles = (folderId: string) => createSelector(
  [selectFilesInFolder(folderId), selectUiState],
  (files, ui) => {
    const { field, order } = ui.sortBy;
    const direction = order === 'asc' ? 1 : -1;
    
    return [...files].sort((a, b) => {
      if (field === 'name') {
        return direction * a.name.localeCompare(b.name);
      } else if (field === 'date' && a.date && b.date) {
        return direction * (new Date(a.date).getTime() - new Date(b.date).getTime());
      } else if (field === 'size') {
        const aSize = a.size || 0;
        const bSize = b.size || 0;
        return direction * (aSize - bSize);
      } else if (field === 'type') {
        return direction * a.type.localeCompare(b.type);
      }
      return 0;
    });
  }
);

export const selectFilteredFiles = (searchTerm: string, filterOptions: any = {}) => createSelector(
  [selectAllFiles],
  files => {
    if (!searchTerm || searchTerm.trim() === '') {
      return files;
    }
    
    const normalizedSearchTerm = searchTerm.toLowerCase().trim();
    
    return files.filter(file => {
      // Filtrage par nom
      const nameMatch = file.name.toLowerCase().includes(normalizedSearchTerm);
      
      // Si des options de filtrage supplémentaires sont fournies
      if (filterOptions.type && file.type !== filterOptions.type) {
        return false;
      }
      
      if (filterOptions.minSize !== undefined && (file.size || 0) < filterOptions.minSize) {
        return false;
      }
      
      if (filterOptions.maxSize !== undefined && (file.size || 0) > filterOptions.maxSize) {
        return false;
      }
      
      if (filterOptions.dateRange && file.date) {
        const fileDate = new Date(file.date);
        if (filterOptions.dateRange.start && fileDate < new Date(filterOptions.dateRange.start)) {
          return false;
        }
        if (filterOptions.dateRange.end && fileDate > new Date(filterOptions.dateRange.end)) {
          return false;
        }
      }
      
      return nameMatch;
    });
  }
);

export const selectFilesByType = (type: string) => createSelector(
  [selectAllFiles],
  files => files.filter(file => file.type === type)
);

export const selectRecentFiles = (limit: number = 10) => createSelector(
  [selectAllFiles],
  files => {
    // Trie les fichiers par date de modification décroissante
    return [...files]
      .filter(file => file.date)
      .sort((a, b) => new Date(b.date!).getTime() - new Date(a.date!).getTime())
      .slice(0, limit);
  }
);

export const selectFilesStats = createSelector(
  [selectAllFiles],
  files => {
    // Calculs de statistiques sur les fichiers
    const totalSize = files.reduce((sum, file) => sum + (file.size || 0), 0);
    const typeCount = files.reduce((counts: Record<string, number>, file) => {
      const type = file.type || 'unknown';
      counts[type] = (counts[type] || 0) + 1;
      return counts;
    }, {});

    return {
      totalCount: files.length,
      totalSize,
      averageSize: files.length > 0 ? totalSize / files.length : 0,
      typeDistribution: typeCount
    };
  }
);

export const selectUploadProgress = (fileId: string) => createSelector(
  [selectFilesState],
  files => files.uploadProgress[fileId] || 0
);

export const selectDownloadProgress = (fileId: string) => createSelector(
  [selectFilesState],
  files => files.downloadProgress[fileId] || 0
);

export const selectIsLoadingFiles = createSelector(
  [selectFilesState],
  files => files.loading
);

export const selectFilesError = createSelector(
  [selectFilesState],
  files => files.error
);

// Sélecteur pour trouver des fichiers similaires à un fichier donné
export const selectSimilarFiles = (fileId: string) => createSelector(
  [selectFilesState],
  files => {
    if (!files.byId || !files.allIds) return [];
    const file = files.byId[fileId];
    if (!file) return [];

    // Logique pour trouver des fichiers similaires par type, nom ou autres critères
    const similarByType = files.allIds
      .filter(id => id !== fileId && files.byId[id] && files.byId[id].type === file.type)
      .map(id => files.byId[id]);

    const nameWithoutExtension = file.name.split('.').slice(0, -1).join('.');
    const similarByName = files.allIds
      .filter(id => {
        const otherFile = files.byId[id];
        if (!otherFile) return false;
        const otherFileName = otherFile.name.split('.').slice(0, -1).join('.');
        return id !== fileId && otherFileName.includes(nameWithoutExtension);
      })
      .map(id => files.byId[id]);

    // Combinaison des résultats (sans doublons)
    const combined = [...new Set([...similarByType, ...similarByName])];

    // Limiter à 5 résultats
    return combined.slice(0, 5);
  }
);
