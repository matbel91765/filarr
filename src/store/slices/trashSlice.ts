/**
 * Redux Slice pour la corbeille
 *
 * Gère tout l'état relatif à la corbeille dans l'application,
 * incluant les opérations de suppression douce, restauration et vidage.
 */

import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import errorService from '../../services/platform/errorService';
import type { Item } from '../../types';
import profileStorage from '../../services/core/profileStorage';
import { fetchFolders } from './foldersSlice';

// Types pour l'état de la corbeille
export interface TrashState {
  items: TrashItem[];
  loading: boolean;
  error: SerializedError | null;
  lastEmptied: string | null;
}

export interface TrashItem {
  id: string;
  name: string;
  type: 'file' | 'folder';
  size?: number;
  deletedAt: string;
  parentFolderId?: string;
  parentFolderName?: string;
  originalItem: Item;
}

// Type pour les erreurs sérialisées (compatible Redux)
export interface SerializedError {
  name?: string;
  message?: string;
  details?: any;
  type?: string;
}

// Types pour les paramètres des thunks
interface MoveToTrashParams {
  itemId: string;
  itemType: 'file' | 'folder';
  folderId?: string;
}

interface RestoreFromTrashParams {
  itemId: string;
}

interface PermanentlyDeleteParams {
  itemId: string;
  folderId?: string;
}

interface EmptyTrashParams {
  olderThanDays?: number;
}

// État initial
const initialState: TrashState = {
  items: [],
  loading: false,
  error: null,
  lastEmptied: null,
};

// Storage key for web mode fallback
const TRASH_STORAGE_KEY = 'filarr_trash_items';

// Helper to check if running in Electron
const isElectron = (): boolean => {
  return (
    typeof window !== 'undefined' &&
    typeof window.electron !== 'undefined' &&
    typeof window.electron.ipcRenderer !== 'undefined'
  );
};

// Helper to get trash items from localStorage (web mode fallback)
const getTrashFromLocalStorage = (): TrashItem[] => {
  try {
    const stored = profileStorage.getItem(TRASH_STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
};

// Helper to save trash items to localStorage (web mode fallback)
const saveTrashToLocalStorage = (items: TrashItem[]): void => {
  try {
    profileStorage.setItem(TRASH_STORAGE_KEY, JSON.stringify(items));
  } catch (error) {
    console.error('[TRASH] Failed to save to localStorage:', error);
  }
};

// Thunks (actions asynchrones)
// -----------------------------

/**
 * Récupère tous les éléments de la corbeille
 */
export const fetchTrashItems = createAsyncThunk<
  TrashItem[],
  void,
  { rejectValue: SerializedError }
>('trash/fetchItems', async (_, { rejectWithValue }) => {
  try {
    // Web mode fallback - use localStorage
    if (!isElectron()) {
      const items = getTrashFromLocalStorage();
      return items;
    }

    // Appel via l'API Electron
    const items = await window.electron.ipcRenderer.invoke('storage:getTrashItems');
    const mappedItems = items.map((item: any) => ({
      id: item.id,
      name: item.name,
      type: item.itemType || item.type,
      size: item.size,
      deletedAt: item.deletedAt,
      parentFolderId: item.parentFolderId,
      parentFolderName: item.parentFolderName,
      originalItem: item,
    }));
    return mappedItems;
  } catch (error) {
    console.error('[TRASH SLICE] fetchTrashItems error:', error);
    const appError = errorService.createFromError(
      error as Error,
      'Impossible de charger les éléments de la corbeille',
      errorService.ErrorTypes.STORAGE
    );
    errorService.logError(appError, 'fetchTrashItems');
    return rejectWithValue({
      name: appError.name,
      message: appError.message,
      details: appError.metadata,
      type: appError.type,
    });
  }
});

/**
 * Déplace un élément vers la corbeille (soft delete)
 */
export const moveToTrash = createAsyncThunk<
  void,
  MoveToTrashParams,
  { rejectValue: SerializedError }
>('trash/moveToTrash', async ({ itemId, itemType, folderId }, { rejectWithValue, dispatch }) => {
  try {
    if (itemType === 'folder') {
      await window.electron.ipcRenderer.invoke('storage:deleteFolder', itemId, false);
    } else {
      if (!folderId) {
        throw new Error('folderId is required for files');
      }
      await window.electron.ipcRenderer.invoke('storage:deleteFile', folderId, itemId, false);
    }
    // Re-fetch trash items after move completes
    await dispatch(fetchTrashItems()).unwrap();
    return;
  } catch (error) {
    console.error('[TRASH SLICE] moveToTrash error:', error);
    const appError = errorService.createFromError(
      error as Error,
      `Impossible de déplacer l'élément ${itemId} vers la corbeille`,
      errorService.ErrorTypes.STORAGE
    );
    errorService.logError(appError, 'moveToTrash');
    return rejectWithValue({
      name: appError.name,
      message: appError.message,
      details: appError.metadata,
      type: appError.type,
    });
  }
});

/**
 * Restaure un élément de la corbeille
 */
export const restoreFromTrash = createAsyncThunk<
  void,
  RestoreFromTrashParams,
  { rejectValue: SerializedError }
>('trash/restore', async ({ itemId }, { rejectWithValue, dispatch }) => {
  try {
    await window.electron.ipcRenderer.invoke('storage:restoreItem', itemId);
    // Re-fetch trash + folders after restore completes
    await Promise.all([dispatch(fetchTrashItems()).unwrap(), dispatch(fetchFolders()).unwrap()]);
    return;
  } catch (error) {
    const appError = errorService.createFromError(
      error as Error,
      `Impossible de restaurer l'élément ${itemId}`,
      errorService.ErrorTypes.STORAGE
    );
    errorService.logError(appError, 'restoreFromTrash');
    return rejectWithValue({
      name: appError.name,
      message: appError.message,
      details: appError.metadata,
      type: appError.type,
    });
  }
});

/**
 * Supprime définitivement un élément de la corbeille
 */
export const permanentlyDelete = createAsyncThunk<
  void,
  PermanentlyDeleteParams,
  { rejectValue: SerializedError }
>('trash/permanentlyDelete', async ({ itemId, folderId }, { rejectWithValue, dispatch }) => {
  try {
    await window.electron.ipcRenderer.invoke('storage:permanentlyDeleteItem', itemId, folderId);
    // Re-fetch trash after permanent delete completes
    await dispatch(fetchTrashItems()).unwrap();
    return;
  } catch (error) {
    console.error('[TRASH SLICE] permanentlyDelete error:', error);
    const appError = errorService.createFromError(
      error as Error,
      `Impossible de supprimer définitivement l'élément ${itemId}`,
      errorService.ErrorTypes.STORAGE
    );
    errorService.logError(appError, 'permanentlyDelete');
    return rejectWithValue({
      name: appError.name,
      message: appError.message,
      details: appError.metadata,
      type: appError.type,
    });
  }
});

/**
 * Vide la corbeille
 */
export const emptyTrash = createAsyncThunk<
  number,
  EmptyTrashParams,
  { rejectValue: SerializedError }
>('trash/empty', async ({ olderThanDays = 0 }, { rejectWithValue }) => {
  try {
    // Web mode fallback
    if (!isElectron()) {
      const items = getTrashFromLocalStorage();
      const now = Date.now();
      const cutoffDate = olderThanDays > 0 ? now - olderThanDays * 24 * 60 * 60 * 1000 : 0;

      const remainingItems =
        olderThanDays > 0
          ? items.filter((item) => {
              // Keep anything newer than the cutoff. A malformed deletedAt parses to NaN — RETAIN it
              // (never delete data we can't age); matches purgeExpiredTrashedNotes' guard.
              const t = new Date(item.deletedAt).getTime();
              return !Number.isFinite(t) || t > cutoffDate;
            })
          : [];

      const deletedCount = items.length - remainingItems.length;
      saveTrashToLocalStorage(remainingItems);
      return deletedCount;
    }

    const deletedCount = await window.electron.ipcRenderer.invoke(
      'storage:emptyTrash',
      olderThanDays
    );

    return deletedCount;
  } catch (error) {
    console.error('[TRASH SLICE] emptyTrash error:', error);
    const appError = errorService.createFromError(
      error as Error,
      'Impossible de vider la corbeille',
      errorService.ErrorTypes.STORAGE
    );
    errorService.logError(appError, 'emptyTrash');
    return rejectWithValue({
      name: appError.name,
      message: appError.message,
      details: appError.metadata,
      type: appError.type,
    });
  }
});

/**
 * Auto-cleanup: supprime les éléments plus vieux que 30 jours
 */
export const autoCleanupTrash = createAsyncThunk<number, void, { rejectValue: SerializedError }>(
  'trash/autoCleanup',
  async (_, { rejectWithValue }) => {
    try {
      const deletedCount = await window.electron.ipcRenderer.invoke('storage:autoCleanupTrash');

      return deletedCount;
    } catch (error) {
      const appError = errorService.createFromError(
        error as Error,
        'Erreur lors du nettoyage automatique de la corbeille',
        errorService.ErrorTypes.STORAGE
      );
      errorService.logError(appError, 'autoCleanupTrash');
      return rejectWithValue({
        name: appError.name,
        message: appError.message,
        details: appError.metadata,
        type: appError.type,
      });
    }
  }
);

// Slice
const trashSlice = createSlice({
  name: 'trash',
  initialState,
  reducers: {
    // Actions synchrones
    clearTrashErrors(state) {
      state.error = null;
    },
  },
  // Extra reducers pour gérer les actions asynchrones
  extraReducers: (builder) => {
    builder
      // Gestion de fetchTrashItems
      .addCase(fetchTrashItems.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchTrashItems.fulfilled, (state, action) => {
        state.loading = false;
        state.items = action.payload;
      })
      .addCase(fetchTrashItems.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload ?? null;
      })

      // Gestion de moveToTrash
      .addCase(moveToTrash.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(moveToTrash.fulfilled, (state) => {
        state.loading = false;
      })
      .addCase(moveToTrash.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload ?? null;
      })

      // Gestion de restoreFromTrash
      .addCase(restoreFromTrash.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(restoreFromTrash.fulfilled, (state) => {
        state.loading = false;
      })
      .addCase(restoreFromTrash.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload ?? null;
      })

      // Gestion de permanentlyDelete
      .addCase(permanentlyDelete.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(permanentlyDelete.fulfilled, (state) => {
        state.loading = false;
      })
      .addCase(permanentlyDelete.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload ?? null;
      })

      // Gestion de emptyTrash
      .addCase(emptyTrash.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(emptyTrash.fulfilled, (state) => {
        state.loading = false;
        state.items = [];
        state.lastEmptied = new Date().toISOString();
      })
      .addCase(emptyTrash.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload ?? null;
      })

      // Gestion de autoCleanupTrash
      .addCase(autoCleanupTrash.fulfilled, (state) => {
        state.lastEmptied = new Date().toISOString();
      });
  },
});

// Exporter les actions synchrones du slice
export const { clearTrashErrors } = trashSlice.actions;

// Exporter le reducer
export default trashSlice.reducer;
