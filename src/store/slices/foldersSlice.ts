/**
 * Redux Slice pour les dossiers
 *
 * Gère tout l'état relatif aux dossiers dans l'application,
 * incluant le chargement, la création, la mise à jour et la suppression.
 */

import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import { folderService } from '../../services';
import errorService from '../../services/platform/errorService';
import { addFileToFolder, deleteFile, renameFile } from './filesSlice';
import type { Folder, FolderCreateData } from '../../types';
import type { RootState } from '../index';

/**
 * Throw if `folderId` isn't part of the active profile's folder map.
 *
 * Defense-in-depth against cross-profile mutations: if a stale folder ID
 * leaks into the UI (orphan tab, stale tooltip, etc.), refuse to forward
 * the mutation to the IPC layer. After `resetAppData()` on profile switch,
 * `state.folders.byId` only contains the active profile's folders, so any
 * folderId not present here is foreign.
 */
function assertOwnedFolder(state: RootState, folderId: string, op: string): void {
  if (!state.folders.byId[folderId]) {
    throw new Error(`Refused ${op} on folder ${folderId}: not owned by the active profile`);
  }
}

// Types pour l'état des dossiers
export interface FoldersState {
  byId: Record<string, Folder>; // Map des dossiers indexés par ID
  allIds: string[]; // Liste des IDs de tous les dossiers
  currentFolderId: string | null; // ID du dossier actuellement sélectionné/ouvert
  loading: boolean; // Indicateur de chargement
  error: SerializedError | null; // Erreur éventuelle
  lastModified: string | null; // Date de dernière modification pour le tri/synchronisation
}

// Type pour les erreurs sérialisées (compatible Redux)
export interface SerializedError {
  name?: string;
  message?: string;
  details?: any;
  type?: string;
}

// Type pour les paramètres de mise à jour
interface UpdateFolderParams {
  folderId: string;
  folderData: Partial<FolderCreateData>;
}

// Type pour les paramètres de déplacement de dossier
interface MoveFolderOrderParams {
  sourceIndex: number;
  targetIndex: number;
}

// État initial
const initialState: FoldersState = {
  byId: {}, // Map des dossiers indexés par ID
  allIds: [], // Liste des IDs de tous les dossiers
  currentFolderId: null, // ID du dossier actuellement sélectionné/ouvert
  loading: false, // Indicateur de chargement
  error: null, // Erreur éventuelle
  lastModified: null, // Date de dernière modification pour le tri/synchronisation
};

// Thunks (actions asynchrones)
// -----------------------------

/**
 * Récupère tous les dossiers
 */
export const fetchFolders = createAsyncThunk<Folder[], void, { rejectValue: SerializedError }>(
  'folders/fetchAll',
  async (_, { rejectWithValue }) => {
    try {
      const folders = await folderService.getFolders();
      return folders;
    } catch (error) {
      const appError = errorService.createFromError(
        error as Error,
        'Erreur lors du chargement des dossiers',
        errorService.ErrorTypes.STORAGE
      );
      errorService.logError(appError, 'fetchFolders');
      return rejectWithValue({
        name: appError.name,
        message: appError.message,
        details: appError.metadata,
        type: appError.type,
      });
    }
  }
);

/**
 * Récupère un dossier spécifique par son ID
 */
export const fetchFolder = createAsyncThunk<Folder, string, { rejectValue: SerializedError }>(
  'folders/fetchOne',
  async (folderId, { rejectWithValue }) => {
    try {
      const folder = await folderService.getFolder(folderId);
      return folder;
    } catch (error) {
      const appError = errorService.createFromError(
        error as Error,
        `Impossible de charger le dossier ${folderId}`,
        errorService.ErrorTypes.STORAGE
      );
      errorService.logError(appError, 'fetchFolder');
      return rejectWithValue({
        name: appError.name,
        message: appError.message,
        details: appError.metadata,
        type: appError.type,
      });
    }
  }
);

/**
 * Crée un nouveau dossier
 */
export const createFolder = createAsyncThunk<
  Folder,
  FolderCreateData,
  { rejectValue: SerializedError }
>('folders/create', async (folderData, { rejectWithValue }) => {
  try {
    const newFolder = await folderService.createFolder(folderData);

    return newFolder;
  } catch (error) {
    const appError = errorService.createFromError(
      error as Error,
      'Impossible de créer le dossier',
      errorService.ErrorTypes.STORAGE
    );
    errorService.logError(appError, 'createFolder');
    return rejectWithValue({
      name: appError.name,
      message: appError.message,
      details: appError.metadata,
      type: appError.type,
    });
  }
});

/**
 * Met à jour un dossier existant
 */
export const updateFolder = createAsyncThunk<
  Folder,
  UpdateFolderParams,
  { rejectValue: SerializedError; state: RootState }
>('folders/update', async ({ folderId, folderData }, { rejectWithValue, getState }) => {
  try {
    assertOwnedFolder(getState(), folderId, 'updateFolder');
    // Convertir FolderCreateData en Partial<Folder> si nécessaire
    const folderUpdate: Partial<Folder> = {
      ...folderData,
      items: undefined, // items sera géré séparément via addItemToFolder/removeItemFromFolder
    };
    const updatedFolder = await folderService.updateFolder(folderId, folderUpdate);

    return updatedFolder;
  } catch (error) {
    const appError = errorService.createFromError(
      error as Error,
      `Impossible de mettre à jour le dossier ${folderId}`,
      errorService.ErrorTypes.STORAGE
    );
    errorService.logError(appError, 'updateFolder');
    return rejectWithValue({
      name: appError.name,
      message: appError.message,
      details: appError.metadata,
      type: appError.type,
    });
  }
});

/**
 * Supprime un dossier
 */
export const deleteFolder = createAsyncThunk<
  string,
  string,
  { rejectValue: SerializedError; state: RootState }
>('folders/delete', async (folderId, { rejectWithValue, getState }) => {
  try {
    assertOwnedFolder(getState(), folderId, 'deleteFolder');
    await folderService.deleteFolder(folderId);

    return folderId;
  } catch (error) {
    const appError = errorService.createFromError(
      error as Error,
      `Impossible de supprimer le dossier ${folderId}`,
      errorService.ErrorTypes.STORAGE
    );
    errorService.logError(appError, 'deleteFolder');
    return rejectWithValue({
      name: appError.name,
      message: appError.message,
      details: appError.metadata,
      type: appError.type,
    });
  }
});

// Slice
const foldersSlice = createSlice({
  name: 'folders',
  initialState,
  reducers: {
    // Actions synchrones (non-async)
    setCurrentFolder(state, action: PayloadAction<string | null>) {
      state.currentFolderId = action.payload;
    },

    clearFolderErrors(state) {
      state.error = null;
    },

    // Optimistic Updates pour le drag-and-drop
    moveFolderOrder(state, action: PayloadAction<MoveFolderOrderParams>) {
      const { sourceIndex, targetIndex } = action.payload;
      // Déplacer l'ID dans la liste des IDs
      const [movedId] = state.allIds.splice(sourceIndex, 1);
      state.allIds.splice(targetIndex, 0, movedId);
      state.lastModified = new Date().toISOString();
    },

    // Sync: Apply a folder from remote sync (create or update) — idempotent
    syncApplyFolder(state, action: PayloadAction<Partial<Folder> & { id: string }>) {
      const data = action.payload;
      const existing = state.byId[data.id];
      if (existing) {
        state.byId[data.id] = { ...existing, ...data };
      } else {
        state.byId[data.id] = {
          name: 'Untitled',
          color: '#87CEEB',
          items: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          ...data,
        } as Folder;
        if (!state.allIds.includes(data.id)) {
          state.allIds.push(data.id);
        }
      }
      state.lastModified = new Date().toISOString();
    },

    // Sync: Add a file reference to a folder's items array — idempotent
    syncAddFileToFolder(state, action: PayloadAction<{ folderId: string; fileId: string }>) {
      const { folderId, fileId } = action.payload;
      const folder = state.byId[folderId];
      if (folder) {
        if (!folder.items) {
          folder.items = [];
        }
        // Check if file ID is already in items (as string or object)
        const exists = folder.items.some(
          (item: any) =>
            (typeof item === 'string' && item === fileId) ||
            (typeof item === 'object' && item?.id === fileId)
        );
        if (!exists) {
          folder.items.push({ id: fileId } as any);
          state.lastModified = new Date().toISOString();
        }
      }
    },

    // Sync: Remove a file reference from a folder's items array — idempotent
    syncRemoveFileFromFolder(state, action: PayloadAction<{ folderId: string; fileId: string }>) {
      const { folderId, fileId } = action.payload;
      const folder = state.byId[folderId];
      if (folder && folder.items) {
        folder.items = folder.items.filter(
          (item: any) =>
            !(typeof item === 'string' && item === fileId) &&
            !(typeof item === 'object' && item?.id === fileId)
        );
        state.lastModified = new Date().toISOString();
      }
    },

    // Sync: Remove a folder from remote sync (delete) — idempotent
    syncRemoveFolder(state, action: PayloadAction<string>) {
      const folderId = action.payload;
      delete state.byId[folderId];
      state.allIds = state.allIds.filter((id) => id !== folderId);
      if (state.currentFolderId === folderId) {
        state.currentFolderId = null;
      }
      state.lastModified = new Date().toISOString();
    },
  },
  // Extra reducers pour gérer les actions asynchrones
  extraReducers: (builder) => {
    builder
      // Gestion de fetchFolders
      .addCase(fetchFolders.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchFolders.fulfilled, (state, action) => {
        state.loading = false;

        // Normalisation des données pour une recherche optimisée
        const byId: Record<string, Folder> = {};
        const allIds: string[] = [];

        action.payload.forEach((folder) => {
          byId[folder.id] = folder;
          allIds.push(folder.id);
        });

        state.byId = byId;
        state.allIds = allIds;
        state.lastModified = new Date().toISOString();
      })
      .addCase(fetchFolders.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload ?? null;
      })

      // Gestion de fetchFolder
      .addCase(fetchFolder.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchFolder.fulfilled, (state, action) => {
        state.loading = false;
        const folder = action.payload;

        // Ajouter/mettre à jour le dossier dans le state
        state.byId[folder.id] = folder;
        if (!state.allIds.includes(folder.id)) {
          state.allIds.push(folder.id);
        }
      })
      .addCase(fetchFolder.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload ?? null;
      })

      // Gestion de createFolder
      .addCase(createFolder.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(createFolder.fulfilled, (state, action) => {
        state.loading = false;
        const newFolder = action.payload;

        // Ajouter le nouveau dossier
        state.byId[newFolder.id] = newFolder;
        state.allIds.push(newFolder.id);
        state.lastModified = new Date().toISOString();
      })
      .addCase(createFolder.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload ?? null;
      })

      // Gestion de updateFolder
      .addCase(updateFolder.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(updateFolder.fulfilled, (state, action) => {
        state.loading = false;
        const updatedFolder = action.payload;

        // Mettre à jour le dossier existant
        state.byId[updatedFolder.id] = updatedFolder;
        state.lastModified = new Date().toISOString();
      })
      .addCase(updateFolder.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload ?? null;
      })

      // Gestion de deleteFolder
      .addCase(deleteFolder.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(deleteFolder.fulfilled, (state, action) => {
        state.loading = false;
        const deletedFolderId = action.payload;

        // Supprimer le dossier
        delete state.byId[deletedFolderId];
        state.allIds = state.allIds.filter((id) => id !== deletedFolderId);

        // Si le dossier supprimé était le dossier courant, réinitialiser currentFolderId
        if (state.currentFolderId === deletedFolderId) {
          state.currentFolderId = null;
        }

        state.lastModified = new Date().toISOString();
      })
      .addCase(deleteFolder.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload ?? null;
      })

      // Écouter les actions de filesSlice pour mettre à jour les dossiers
      .addCase(addFileToFolder.fulfilled, (state, action) => {
        // action.payload contient le dossier mis à jour avec le nouveau fichier
        const updatedFolder = action.payload;
        if (updatedFolder && updatedFolder.id) {
          state.byId[updatedFolder.id] = updatedFolder;
          state.lastModified = new Date().toISOString();
        }
      })
      .addCase(deleteFile.fulfilled, (state, action) => {
        // Supprimer le fichier du dossier immédiatement
        const { folderId, fileId } = action.meta.arg;
        if (folderId && state.byId[folderId] && state.byId[folderId].items) {
          // Filtrer le fichier supprimé - items peut être string[] (IDs) ou Item[] (objets)
          state.byId[folderId].items = state.byId[folderId].items.filter((item: any) => {
            // Si item est un objet, comparer item.id
            if (typeof item === 'object' && item !== null) {
              return item.id !== fileId;
            }
            // Si item est un ID (string), comparer directement
            return item !== fileId;
          });
          state.lastModified = new Date().toISOString();
        }
      })
      .addCase(renameFile.fulfilled, (state, action) => {
        // Note: Le renommage de fichier ne modifie pas la liste des items du dossier
        // car items est un tableau de string[] (IDs uniquement).
        // Le nom du fichier est géré dans le filesSlice.
        // On met simplement à jour la date de modification du dossier si le fichier appartient à ce dossier
        const { folderId } = action.meta.arg;
        if (folderId && state.byId[folderId]) {
          state.lastModified = new Date().toISOString();
        }
      });
  },
});

// Exporter les actions synchrones du slice
export const {
  setCurrentFolder,
  clearFolderErrors,
  moveFolderOrder,
  syncApplyFolder,
  syncAddFileToFolder,
  syncRemoveFileFromFolder,
  syncRemoveFolder,
} = foldersSlice.actions;

// Exporter le reducer
export default foldersSlice.reducer;
