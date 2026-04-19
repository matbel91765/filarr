/**
 * Redux Slice pour les Favoris et Epingles
 *
 * Gere les fichiers/dossiers favoris, les elements epingles dans la sidebar,
 * les fichiers recents et les raccourcis clavier Ctrl+1-9.
 */

import { createSlice, createSelector, PayloadAction } from '@reduxjs/toolkit';
import type { FileItem, Folder, Item } from '../../types';
import profileStorage from '../../services/core/profileStorage';

// ==================== TYPES ====================

/**
 * Element favori/epingle
 */
export interface FavoriteItem {
  id: string;
  itemId: string;
  itemType: 'file' | 'folder';
  name: string;
  path?: string;
  color?: string;
  icon?: string;
  order: number;
  pinnedAt: string;
  shortcutKey?: number; // 1-9 for Ctrl+1-9 shortcuts
}

/**
 * Element recent
 */
export interface RecentItem {
  id: string;
  itemId: string;
  itemType: 'file' | 'folder';
  name: string;
  path?: string;
  accessedAt: string;
  accessCount: number;
}

/**
 * Etat du slice favoris
 */
export interface FavoritesState {
  // Favoris/Epingles
  favorites: FavoriteItem[];

  // Fichiers recents
  recentFiles: RecentItem[];
  maxRecentFiles: number;

  // UI State
  isDragging: boolean;
  draggedItemId: string | null;
  dropTargetIndex: number | null;

  // Settings
  showRecent: boolean;
  showFavorites: boolean;

  // Persistence
  lastPersisted: string | null;
}

// ==================== INITIAL STATE ====================

const STORAGE_KEY = 'filarr_favorites';
const RECENT_STORAGE_KEY = 'filarr_recent_files';

/**
 * Charger les favoris depuis localStorage
 */
const loadFavoritesFromStorage = (): FavoriteItem[] => {
  try {
    const stored = profileStorage.getItem(STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (error) {
    console.error('Failed to load favorites from storage:', error);
  }
  return [];
};

/**
 * Charger les fichiers recents depuis localStorage
 */
const loadRecentFromStorage = (): RecentItem[] => {
  try {
    const stored = profileStorage.getItem(RECENT_STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (error) {
    console.error('Failed to load recent files from storage:', error);
  }
  return [];
};

/**
 * Sauvegarder les favoris dans localStorage
 */
const saveFavoritesToStorage = (favorites: FavoriteItem[]): void => {
  try {
    profileStorage.setItem(STORAGE_KEY, JSON.stringify(favorites));
  } catch (error) {
    console.error('Failed to save favorites to storage:', error);
  }
};

/**
 * Sauvegarder les fichiers recents dans localStorage
 */
const saveRecentToStorage = (recentFiles: RecentItem[]): void => {
  try {
    profileStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(recentFiles));
  } catch (error) {
    console.error('Failed to save recent files to storage:', error);
  }
};

const initialState: FavoritesState = {
  favorites: loadFavoritesFromStorage(),
  recentFiles: loadRecentFromStorage(),
  maxRecentFiles: 20,
  isDragging: false,
  draggedItemId: null,
  dropTargetIndex: null,
  showRecent: true,
  showFavorites: true,
  lastPersisted: null,
};

// ==================== SLICE ====================

const favoritesSlice = createSlice({
  name: 'favorites',
  initialState,
  reducers: {
    // ===== FAVORITES ACTIONS =====

    /**
     * Ajouter un element aux favoris
     */
    addFavorite(
      state,
      action: PayloadAction<{
        item: Item;
        path?: string;
      }>
    ) {
      const { item, path } = action.payload;

      // Verifier si deja en favoris
      if (state.favorites.some((f) => f.itemId === item.id)) {
        return;
      }

      const isFolder = 'items' in item && Array.isArray(item.items);

      const newFavorite: FavoriteItem = {
        id: `fav_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        itemId: item.id,
        itemType: isFolder ? 'folder' : 'file',
        name: item.name,
        path: path,
        color: isFolder ? (item as Folder).color : undefined,
        order: state.favorites.length,
        pinnedAt: new Date().toISOString(),
      };

      state.favorites.push(newFavorite);
      saveFavoritesToStorage(state.favorites);
      state.lastPersisted = new Date().toISOString();
    },

    /**
     * Retirer un element des favoris
     */
    removeFavorite(state, action: PayloadAction<string>) {
      const itemId = action.payload;
      const index = state.favorites.findIndex((f) => f.itemId === itemId);

      if (index !== -1) {
        state.favorites.splice(index, 1);

        // Reordonner les elements restants
        state.favorites.forEach((fav, idx) => {
          fav.order = idx;
        });

        saveFavoritesToStorage(state.favorites);
        state.lastPersisted = new Date().toISOString();
      }
    },

    /**
     * Reordonner les favoris (drag and drop)
     */
    reorderFavorites(
      state,
      action: PayloadAction<{
        sourceIndex: number;
        destinationIndex: number;
      }>
    ) {
      const { sourceIndex, destinationIndex } = action.payload;

      if (sourceIndex === destinationIndex) return;

      const [removed] = state.favorites.splice(sourceIndex, 1);
      state.favorites.splice(destinationIndex, 0, removed);

      // Mettre a jour les ordres
      state.favorites.forEach((fav, idx) => {
        fav.order = idx;
      });

      saveFavoritesToStorage(state.favorites);
      state.lastPersisted = new Date().toISOString();
    },

    /**
     * Assigner un raccourci clavier a un favori
     */
    assignShortcut(
      state,
      action: PayloadAction<{
        favoriteId: string;
        shortcutKey: number | null;
      }>
    ) {
      const { favoriteId, shortcutKey } = action.payload;

      // Retirer le raccourci existant si deja utilise
      if (shortcutKey !== null) {
        state.favorites.forEach((fav) => {
          if (fav.shortcutKey === shortcutKey) {
            fav.shortcutKey = undefined;
          }
        });
      }

      // Assigner le nouveau raccourci
      const favorite = state.favorites.find((f) => f.id === favoriteId);
      if (favorite) {
        favorite.shortcutKey = shortcutKey ?? undefined;
      }

      saveFavoritesToStorage(state.favorites);
      state.lastPersisted = new Date().toISOString();
    },

    /**
     * Mettre a jour un favori
     */
    updateFavorite(
      state,
      action: PayloadAction<{
        favoriteId: string;
        updates: Partial<FavoriteItem>;
      }>
    ) {
      const { favoriteId, updates } = action.payload;
      const favorite = state.favorites.find((f) => f.id === favoriteId);

      if (favorite) {
        Object.assign(favorite, updates);
        saveFavoritesToStorage(state.favorites);
        state.lastPersisted = new Date().toISOString();
      }
    },

    // ===== RECENT FILES ACTIONS =====

    /**
     * Ajouter/mettre a jour un fichier recent
     */
    addRecentFile(
      state,
      action: PayloadAction<{
        item: Item;
        path?: string;
      }>
    ) {
      const { item, path } = action.payload;
      const isFolder = 'items' in item && Array.isArray(item.items);

      // Chercher si deja present
      const existingIndex = state.recentFiles.findIndex((r) => r.itemId === item.id);

      if (existingIndex !== -1) {
        // Mettre a jour l'acces
        const existing = state.recentFiles[existingIndex];
        existing.accessedAt = new Date().toISOString();
        existing.accessCount += 1;

        // Deplacer en premiere position
        state.recentFiles.splice(existingIndex, 1);
        state.recentFiles.unshift(existing);
      } else {
        // Ajouter nouveau
        const newRecent: RecentItem = {
          id: `recent_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          itemId: item.id,
          itemType: isFolder ? 'folder' : 'file',
          name: item.name,
          path: path,
          accessedAt: new Date().toISOString(),
          accessCount: 1,
        };

        state.recentFiles.unshift(newRecent);
      }

      // Limiter le nombre de fichiers recents
      if (state.recentFiles.length > state.maxRecentFiles) {
        state.recentFiles = state.recentFiles.slice(0, state.maxRecentFiles);
      }

      saveRecentToStorage(state.recentFiles);
      state.lastPersisted = new Date().toISOString();
    },

    /**
     * Retirer un fichier des recents
     */
    removeRecentFile(state, action: PayloadAction<string>) {
      const itemId = action.payload;
      state.recentFiles = state.recentFiles.filter((r) => r.itemId !== itemId);
      saveRecentToStorage(state.recentFiles);
      state.lastPersisted = new Date().toISOString();
    },

    /**
     * Vider la liste des fichiers recents
     */
    clearRecentFiles(state) {
      state.recentFiles = [];
      saveRecentToStorage(state.recentFiles);
      state.lastPersisted = new Date().toISOString();
    },

    /**
     * Definir le nombre maximum de fichiers recents
     */
    setMaxRecentFiles(state, action: PayloadAction<number>) {
      state.maxRecentFiles = Math.max(1, Math.min(100, action.payload));

      // Tronquer si necessaire
      if (state.recentFiles.length > state.maxRecentFiles) {
        state.recentFiles = state.recentFiles.slice(0, state.maxRecentFiles);
        saveRecentToStorage(state.recentFiles);
      }
    },

    // ===== DRAG AND DROP ACTIONS =====

    /**
     * Commencer le drag
     */
    startDrag(state, action: PayloadAction<string>) {
      state.isDragging = true;
      state.draggedItemId = action.payload;
    },

    /**
     * Definir la cible du drop
     */
    setDropTarget(state, action: PayloadAction<number | null>) {
      state.dropTargetIndex = action.payload;
    },

    /**
     * Terminer le drag
     */
    endDrag(state) {
      state.isDragging = false;
      state.draggedItemId = null;
      state.dropTargetIndex = null;
    },

    // ===== UI ACTIONS =====

    /**
     * Basculer l'affichage des recents
     */
    toggleShowRecent(state) {
      state.showRecent = !state.showRecent;
    },

    /**
     * Basculer l'affichage des favoris
     */
    toggleShowFavorites(state) {
      state.showFavorites = !state.showFavorites;
    },

    /**
     * Charger les donnees depuis le storage
     */
    loadFromStorage(state) {
      state.favorites = loadFavoritesFromStorage();
      state.recentFiles = loadRecentFromStorage();
    },

    /**
     * Importer des favoris
     */
    importFavorites(state, action: PayloadAction<FavoriteItem[]>) {
      state.favorites = action.payload.map((fav, idx) => ({
        ...fav,
        order: idx,
      }));
      saveFavoritesToStorage(state.favorites);
      state.lastPersisted = new Date().toISOString();
    },

    /**
     * Vider tous les favoris
     */
    clearFavorites(state) {
      state.favorites = [];
      saveFavoritesToStorage(state.favorites);
      state.lastPersisted = new Date().toISOString();
    },
  },
});

// ==================== SELECTORS ====================

/**
 * Obtenir tous les favoris tries par ordre
 */
export const selectFavorites = createSelector(
  (state: { favorites: FavoritesState }) => state.favorites.favorites,
  (favorites): FavoriteItem[] => [...favorites].sort((a, b) => a.order - b.order)
);

/**
 * Obtenir les favoris avec raccourcis (1-9)
 */
export const selectFavoritesWithShortcuts = (state: {
  favorites: FavoritesState;
}): FavoriteItem[] =>
  state.favorites.favorites
    .filter((f) => f.shortcutKey !== undefined)
    .sort((a, b) => (a.shortcutKey || 0) - (b.shortcutKey || 0));

/**
 * Obtenir un favori par sa touche de raccourci
 */
export const selectFavoriteByShortcut = (
  state: { favorites: FavoritesState },
  shortcutKey: number
): FavoriteItem | undefined => state.favorites.favorites.find((f) => f.shortcutKey === shortcutKey);

/**
 * Verifier si un element est en favoris
 */
export const selectIsFavorite = (state: { favorites: FavoritesState }, itemId: string): boolean =>
  state.favorites.favorites.some((f) => f.itemId === itemId);

/**
 * Obtenir les fichiers recents
 */
export const selectRecentFiles = (state: { favorites: FavoritesState }): RecentItem[] =>
  state.favorites.recentFiles;

/**
 * Obtenir les N fichiers les plus recents
 */
export const selectTopRecentFiles = (
  state: { favorites: FavoritesState },
  count: number = 10
): RecentItem[] => state.favorites.recentFiles.slice(0, count);

/**
 * Obtenir l'etat du drag and drop
 */
export const selectDragState = createSelector(
  (state: { favorites: FavoritesState }) => state.favorites.isDragging,
  (state: { favorites: FavoritesState }) => state.favorites.draggedItemId,
  (state: { favorites: FavoritesState }) => state.favorites.dropTargetIndex,
  (isDragging, draggedItemId, dropTargetIndex) => ({ isDragging, draggedItemId, dropTargetIndex })
);

/**
 * Obtenir les preferences d'affichage
 */
export const selectDisplayPreferences = createSelector(
  (state: { favorites: FavoritesState }) => state.favorites.showRecent,
  (state: { favorites: FavoritesState }) => state.favorites.showFavorites,
  (showRecent, showFavorites) => ({ showRecent, showFavorites })
);

// ==================== EXPORTS ====================

export const {
  // Favorites
  addFavorite,
  removeFavorite,
  reorderFavorites,
  assignShortcut,
  updateFavorite,
  clearFavorites,
  importFavorites,

  // Recent Files
  addRecentFile,
  removeRecentFile,
  clearRecentFiles,
  setMaxRecentFiles,

  // Drag and Drop
  startDrag,
  setDropTarget,
  endDrag,

  // UI
  toggleShowRecent,
  toggleShowFavorites,
  loadFromStorage,
} = favoritesSlice.actions;

export default favoritesSlice.reducer;
