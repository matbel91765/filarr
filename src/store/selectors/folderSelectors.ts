/**
 * Sélecteurs pour les dossiers
 *
 * Ces sélecteurs optimisent l'accès aux données des dossiers dans le store Redux,
 * en utilisant la memoization pour éviter les calculs redondants.
 */

import { createSelector } from '@reduxjs/toolkit';
import type { RootState } from '../index';
import type { Folder } from '../../types';

// Sélecteurs de base (non-memoized)
const selectFoldersState = (state: RootState) => state.folders;
const selectFilesState = (state: RootState) => state.files;
const selectUiState = (state: RootState) => state.ui;

// Sélecteurs memoized pour les dossiers
export const selectAllFolders = createSelector(
  [selectFoldersState],
  folders => (folders.allIds || []).map(id => folders.byId[id]).filter(folder => folder && !folder.deletedAt)
);

// Sélecteur pour tous les dossiers incluant ceux supprimés
export const selectAllFoldersIncludingDeleted = createSelector(
  [selectFoldersState],
  folders => (folders.allIds || []).map(id => folders.byId[id]).filter(Boolean)
);

export const selectFolderById = (id: string) => createSelector(
  [selectFoldersState],
  folders => (folders.byId && folders.byId[id]) || null
);

export const selectFolderItems = (folderId: string) => createSelector(
  [selectFoldersState, selectFilesState],
  (folders, files) => {
    if (!folders.byId || !files.byId) return [];
    const folder = folders.byId[folderId];
    if (!folder || !folder.items) return [];

    // folder.items peut être soit string[] (IDs) soit Item[] (objets complets)
    // On gère les deux cas pour compatibilité
    // IMPORTANT: toujours préférer les données à jour de files.byId / folders.byId
    const seen = new Set<string>();
    return folder.items.map((item: any) => {
      // Extraire l'ID, que l'item soit un objet ou un string
      const itemId = typeof item === 'object' && item !== null && item.id
        ? item.id
        : typeof item === 'string' ? item : null;
      if (!itemId || seen.has(itemId)) return null;
      seen.add(itemId);

      // Toujours préférer les données à jour des slices respectives
      if (files.byId[itemId]) {
        return { ...files.byId[itemId], itemType: 'file' };
      }
      if (folders.byId[itemId]) {
        return { ...folders.byId[itemId], itemType: 'folder' };
      }

      // Fallback: utiliser l'objet inline s'il n'est pas trouvé dans les slices
      if (typeof item === 'object' && item !== null && item.id) {
        const itemType = item.items !== undefined ? 'folder' : 'file';
        return { ...item, itemType };
      }

      return null;
    }).filter(item => item !== null);
  }
);

export const selectCurrentFolder = createSelector(
  [selectFoldersState],
  folders => (folders.currentFolderId && folders.byId) ? folders.byId[folders.currentFolderId] : null
);

export const selectCurrentFolderItems = createSelector(
  [selectFoldersState, selectFilesState],
  (folders, files) => {
    if (!folders.byId || !files.byId) return [];
    const currentFolderId = folders.currentFolderId;
    if (!currentFolderId) return [];

    const folder = folders.byId[currentFolderId];
    if (!folder || !folder.items) return [];

    const seen = new Set<string>();
    return folder.items.map(itemId => {
      if (seen.has(itemId)) return null;
      seen.add(itemId);
      if (files.byId[itemId]) {
        return { ...files.byId[itemId], itemType: 'file' };
      } else if (folders.byId[itemId]) {
        return { ...folders.byId[itemId], itemType: 'folder' };
      }
      return null;
    }).filter(item => item !== null);
  }
);

export const selectIsLoadingFolders = createSelector(
  [selectFoldersState],
  folders => folders.loading
);

export const selectFoldersError = createSelector(
  [selectFoldersState],
  folders => folders.error
);

export const selectSortedFolders = createSelector(
  [selectAllFolders, selectUiState],
  (folders, ui) => {
    const { field, order } = ui.sortBy;
    const direction = order === 'asc' ? 1 : -1;
    
    return [...folders].sort((a, b) => {
      if (field === 'name') {
        return direction * a.name.localeCompare(b.name);
      } else if (field === 'date' && a.date && b.date) {
        return direction * (new Date(a.date).getTime() - new Date(b.date).getTime());
      } else if (field === 'size') {
        const aSize = a.items ? a.items.length : 0;
        const bSize = b.items ? b.items.length : 0;
        return direction * (aSize - bSize);
      }
      return 0;
    });
  }
);

export const selectFolderTree = createSelector(
  [selectFoldersState],
  folders => {
    // Construire une arborescence de dossiers basée sur la relation parent-enfant
    // Ici nous supposons que chaque dossier a une propriété parentId (sauf les dossiers racine)

    if (!folders.byId || !folders.allIds) return [];

    // Crée une map de tous les dossiers
    const folderMap = { ...folders.byId };

    // Identifie les dossiers racines (ceux sans parentId)
    const rootFolders = folders.allIds
      .filter(id => folderMap[id] && !folderMap[id].parentId)
      .map(id => ({
        ...folderMap[id],
        children: []
      }));

    // Fonction récursive pour construire l'arbre
    const buildTree = (foldersList: Array<Folder & { children: any[] }>) => {
      foldersList.forEach((folder: Folder & { children: any[] }) => {
        // Trouve tous les enfants directs
        const children = folders.allIds
          .filter(id => folderMap[id] && folderMap[id].parentId === folder.id)
          .map(id => ({
            ...folderMap[id],
            children: []
          }));

        // Assigne les enfants au dossier actuel
        folder.children = children;

        // Traite récursivement les enfants
        if (children.length > 0) {
          buildTree(children);
        }
      });

      return foldersList;
    };

    // Construire et retourner l'arbre complet
    return buildTree(rootFolders);
  }
);

export const selectFolderPathById = (folderId: string) => createSelector(
  [selectFoldersState],
  folders => {
    if (!folderId || !folders.byId || !folders.byId[folderId]) return [];

    const path = [];
    let currentId: string | null | undefined = folderId;

    // Remonter l'arborescence des dossiers jusqu'à la racine
    while (currentId) {
      const folder: Folder | undefined = folders.byId[currentId];
      if (folder) {
        path.unshift(folder);
        currentId = folder.parentId;
      } else {
        currentId = null;
      }
    }

    return path;
  }
);

export const selectFilteredFolders = (searchTerm: string) => createSelector(
  [selectAllFolders],
  folders => {
    if (!searchTerm || searchTerm.trim() === '') {
      return folders;
    }
    
    const normalizedSearchTerm = searchTerm.toLowerCase().trim();
    
    return folders.filter(folder => 
      folder.name.toLowerCase().includes(normalizedSearchTerm)
    );
  }
);
