/**
 * Selectors pour la corbeille
 *
 * Ces selectors permettent de filtrer et récupérer les éléments de la corbeille
 */

import { createSelector } from '@reduxjs/toolkit';
import type { RootState } from '../index';
import type { TrashItem } from '../slices/trashSlice';

// Sélecteur de base pour l'état de la corbeille
export const selectTrashState = (state: RootState) => state.trash;

// Sélecteur pour tous les items de la corbeille
export const selectAllTrashItems = createSelector(
  [selectTrashState],
  (trashState) => trashState.items
);

// Sélecteur pour le statut de chargement
export const selectTrashLoading = createSelector(
  [selectTrashState],
  (trashState) => trashState.loading
);

// Sélecteur pour les erreurs
export const selectTrashError = createSelector(
  [selectTrashState],
  (trashState) => trashState.error
);

// Sélecteur pour la dernière date de vidage
export const selectTrashLastEmptied = createSelector(
  [selectTrashState],
  (trashState) => trashState.lastEmptied
);

// Sélecteur pour les fichiers dans la corbeille
export const selectTrashFiles = createSelector(
  [selectAllTrashItems],
  (items) => items.filter(item => item.type === 'file')
);

// Sélecteur pour les dossiers dans la corbeille
export const selectTrashFolders = createSelector(
  [selectAllTrashItems],
  (items) => items.filter(item => item.type === 'folder')
);

// Sélecteur pour le nombre total d'items dans la corbeille
export const selectTrashItemsCount = createSelector(
  [selectAllTrashItems],
  (items) => items.length
);

// Sélecteur pour la taille totale des fichiers dans la corbeille
export const selectTrashTotalSize = createSelector(
  [selectTrashFiles],
  (files) => files.reduce((total, file) => total + (file.size || 0), 0)
);

// Sélecteur pour les items supprimés il y a plus de X jours
export const selectTrashItemsOlderThan = (days: number) =>
  createSelector(
    [selectAllTrashItems],
    (items) => {
      const now = new Date();
      const cutoffDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

      return items.filter(item => {
        const deletedDate = new Date(item.deletedAt);
        return deletedDate < cutoffDate;
      });
    }
  );

// Sélecteur pour les items supprimés récemment (moins de 7 jours)
export const selectRecentTrashItems = createSelector(
  [selectAllTrashItems],
  (items) => {
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    return items.filter(item => {
      const deletedDate = new Date(item.deletedAt);
      return deletedDate >= sevenDaysAgo;
    });
  }
);

// Sélecteur pour un item spécifique de la corbeille par ID
export const selectTrashItemById = (itemId: string) =>
  createSelector(
    [selectAllTrashItems],
    (items) => items.find(item => item.id === itemId)
  );

// Sélecteur pour vérifier si la corbeille est vide
export const selectIsTrashEmpty = createSelector(
  [selectTrashItemsCount],
  (count) => count === 0
);

// Sélecteur pour grouper les items par date de suppression
export const selectTrashItemsByDate = createSelector(
  [selectAllTrashItems],
  (items) => {
    const grouped: Record<string, TrashItem[]> = {
      today: [],
      yesterday: [],
      thisWeek: [],
      thisMonth: [],
      older: []
    };

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
    const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
    const monthAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);

    items.forEach(item => {
      const deletedDate = new Date(item.deletedAt);

      if (deletedDate >= today) {
        grouped.today.push(item);
      } else if (deletedDate >= yesterday) {
        grouped.yesterday.push(item);
      } else if (deletedDate >= weekAgo) {
        grouped.thisWeek.push(item);
      } else if (deletedDate >= monthAgo) {
        grouped.thisMonth.push(item);
      } else {
        grouped.older.push(item);
      }
    });

    return grouped;
  }
);
