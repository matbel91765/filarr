/**
 * Redux Slice pour la gestion des versions de fichiers
 *
 * Gere l'etat des versions incluant:
 * - Liste des versions par fichier
 * - Version selectionnee
 * - Comparaisons de versions
 * - Configuration du versionnement
 */

import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import versionService, {
  FileVersion,
  VersionDiff,
  VersionConfig,
  VersionRestoreResult,
} from '../../services/core/versionService';
import errorService from '../../services/platform/errorService';

// ==================== TYPES ====================

export interface SerializedError {
  name?: string;
  message?: string;
  details?: any;
  type?: string;
}

export interface VersionsState {
  // Versions par fileId
  byFileId: Record<string, FileVersion[]>;
  // Version selectionnee pour affichage
  selectedVersionId: string | null;
  // Comparaison en cours
  currentDiff: VersionDiff | null;
  // IDs des versions comparees
  compareVersionIds: [string | null, string | null];
  // Configuration
  config: VersionConfig;
  // Etats de chargement
  loading: boolean;
  loadingVersionId: string | null;
  comparing: boolean;
  restoring: boolean;
  // Erreurs
  error: SerializedError | null;
  // Panel ouvert pour quel fichier
  panelOpenForFileId: string | null;
  // Statistiques
  totalVersionsSize: number;
}

// ==================== INITIAL STATE ====================

const initialState: VersionsState = {
  byFileId: {},
  selectedVersionId: null,
  currentDiff: null,
  compareVersionIds: [null, null],
  config: {
    maxVersions: 10,
    autoVersionOnSave: true,
    excludeExtensions: ['.tmp', '.bak', '.swp'],
    minTimeBetweenVersions: 60,
  },
  loading: false,
  loadingVersionId: null,
  comparing: false,
  restoring: false,
  error: null,
  panelOpenForFileId: null,
  totalVersionsSize: 0,
};

// ==================== ASYNC THUNKS ====================

/**
 * Charge les versions d'un fichier
 */
export const fetchVersions = createAsyncThunk<
  { fileId: string; versions: FileVersion[] },
  string,
  { rejectValue: SerializedError }
>(
  'versions/fetchVersions',
  async (fileId, { rejectWithValue }) => {
    try {
      const versions = await versionService.getVersions(fileId);
      return { fileId, versions };
    } catch (error) {
      const appError = errorService.createFromError(
        error as Error,
        `Impossible de charger les versions du fichier ${fileId}`,
        errorService.ErrorTypes.FILE_SYSTEM
      );
      return rejectWithValue({
        name: appError.name,
        message: appError.message,
        type: appError.type,
      });
    }
  }
);

/**
 * Cree une nouvelle version
 */
export const createVersion = createAsyncThunk<
  { fileId: string; version: FileVersion },
  { folderId: string; fileId: string; fileName: string; comment?: string; size?: number; force?: boolean },
  { rejectValue: SerializedError }
>(
  'versions/createVersion',
  async ({ folderId, fileId, fileName, comment, size, force }, { rejectWithValue }) => {
    try {
      const version = await versionService.createVersion(folderId, fileId, fileName, comment, size, force);
      return { fileId, version };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Erreur inconnue';
      const name = error instanceof Error ? error.name : 'Error';
      console.error('[VERSIONS] createVersion error:', message);
      return rejectWithValue({
        name,
        message,
        type: 'FILE_SYSTEM',
      });
    }
  }
);

/**
 * Compare deux versions
 */
export const compareVersions = createAsyncThunk<
  { diff: VersionDiff; versionIdA: string; versionIdB: string },
  { versionIdA: string; versionIdB: string },
  { rejectValue: SerializedError }
>(
  'versions/compareVersions',
  async ({ versionIdA, versionIdB }, { rejectWithValue }) => {
    try {
      const diff = await versionService.compareVersions(versionIdA, versionIdB);
      return { diff, versionIdA, versionIdB };
    } catch (error) {
      const appError = errorService.createFromError(
        error as Error,
        'Impossible de comparer les versions',
        errorService.ErrorTypes.FILE_SYSTEM
      );
      return rejectWithValue({
        name: appError.name,
        message: appError.message,
        type: appError.type,
      });
    }
  }
);

/**
 * Restaure une version
 */
export const restoreVersion = createAsyncThunk<
  { fileId: string; result: VersionRestoreResult },
  { versionId: string; fileId: string },
  { rejectValue: SerializedError }
>(
  'versions/restoreVersion',
  async ({ versionId, fileId }, { rejectWithValue, dispatch }) => {
    try {
      const result = await versionService.restoreVersion(versionId);

      // Recharger les versions apres restauration
      dispatch(fetchVersions(fileId));

      return { fileId, result };
    } catch (error) {
      const appError = errorService.createFromError(
        error as Error,
        `Impossible de restaurer la version ${versionId}`,
        errorService.ErrorTypes.FILE_SYSTEM
      );
      return rejectWithValue({
        name: appError.name,
        message: appError.message,
        type: appError.type,
      });
    }
  }
);

/**
 * Supprime une version
 */
export const deleteVersion = createAsyncThunk<
  { fileId: string; versionId: string },
  { fileId: string; versionId: string },
  { rejectValue: SerializedError }
>(
  'versions/deleteVersion',
  async ({ fileId, versionId }, { rejectWithValue }) => {
    try {
      await versionService.deleteVersion(versionId);
      return { fileId, versionId };
    } catch (error) {
      const appError = errorService.createFromError(
        error as Error,
        `Impossible de supprimer la version ${versionId}`,
        errorService.ErrorTypes.FILE_SYSTEM
      );
      return rejectWithValue({
        name: appError.name,
        message: appError.message,
        type: appError.type,
      });
    }
  }
);

/**
 * Met a jour la configuration
 */
export const updateConfig = createAsyncThunk<
  VersionConfig,
  Partial<VersionConfig>,
  { rejectValue: SerializedError }
>(
  'versions/updateConfig',
  async (config, { rejectWithValue }) => {
    try {
      return await versionService.saveConfig(config);
    } catch (error) {
      const appError = errorService.createFromError(
        error as Error,
        'Impossible de sauvegarder la configuration',
        errorService.ErrorTypes.FILE_SYSTEM
      );
      return rejectWithValue({
        name: appError.name,
        message: appError.message,
        type: appError.type,
      });
    }
  }
);

/**
 * Exporte une version
 */
export const exportVersion = createAsyncThunk<
  { versionId: string; path: string },
  { versionId: string; targetPath?: string },
  { rejectValue: SerializedError }
>(
  'versions/exportVersion',
  async ({ versionId, targetPath }, { rejectWithValue }) => {
    try {
      const path = await versionService.exportVersion(versionId, targetPath);
      return { versionId, path };
    } catch (error) {
      const appError = errorService.createFromError(
        error as Error,
        `Impossible d'exporter la version ${versionId}`,
        errorService.ErrorTypes.FILE_SYSTEM
      );
      return rejectWithValue({
        name: appError.name,
        message: appError.message,
        type: appError.type,
      });
    }
  }
);

/**
 * Charge la taille totale des versions
 */
export const fetchTotalVersionsSize = createAsyncThunk<
  number,
  void,
  { rejectValue: SerializedError }
>(
  'versions/fetchTotalSize',
  async (_, { rejectWithValue }) => {
    try {
      return await versionService.getTotalVersionsSize();
    } catch (error) {
      return rejectWithValue({
        message: 'Impossible de calculer la taille des versions',
      });
    }
  }
);

// ==================== SLICE ====================

const versionsSlice = createSlice({
  name: 'versions',
  initialState,
  reducers: {
    // Selectionner une version
    selectVersion(state, action: PayloadAction<string | null>) {
      state.selectedVersionId = action.payload;
    },

    // Ouvrir/fermer le panel pour un fichier
    openVersionPanel(state, action: PayloadAction<string>) {
      state.panelOpenForFileId = action.payload;
    },

    closeVersionPanel(state) {
      state.panelOpenForFileId = null;
      state.selectedVersionId = null;
      state.currentDiff = null;
      state.compareVersionIds = [null, null];
    },

    // Definir les versions a comparer
    setCompareVersions(state, action: PayloadAction<[string | null, string | null]>) {
      state.compareVersionIds = action.payload;
    },

    // Effacer la comparaison
    clearDiff(state) {
      state.currentDiff = null;
      state.compareVersionIds = [null, null];
    },

    // Effacer les erreurs
    clearVersionErrors(state) {
      state.error = null;
    },

    // Mise a jour de la config localement
    setConfig(state, action: PayloadAction<Partial<VersionConfig>>) {
      state.config = { ...state.config, ...action.payload };
    },
  },

  extraReducers: (builder) => {
    builder
      // fetchVersions
      .addCase(fetchVersions.pending, (state, action) => {
        state.loading = true;
        state.loadingVersionId = action.meta.arg;
        state.error = null;
      })
      .addCase(fetchVersions.fulfilled, (state, action) => {
        state.loading = false;
        state.loadingVersionId = null;
        state.byFileId[action.payload.fileId] = action.payload.versions;
      })
      .addCase(fetchVersions.rejected, (state, action) => {
        state.loading = false;
        state.loadingVersionId = null;
        state.error = action.payload ?? null;
      })

      // createVersion
      .addCase(createVersion.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(createVersion.fulfilled, (state, action) => {
        state.loading = false;
        const { fileId, version } = action.payload;

        // Ajouter la version au debut (plus recente)
        if (!state.byFileId[fileId]) {
          state.byFileId[fileId] = [];
        }
        state.byFileId[fileId].unshift(version);

        // Limiter au nombre max de versions
        if (state.byFileId[fileId].length > state.config.maxVersions) {
          state.byFileId[fileId] = state.byFileId[fileId].slice(0, state.config.maxVersions);
        }
      })
      .addCase(createVersion.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload ?? null;
      })

      // compareVersions
      .addCase(compareVersions.pending, (state) => {
        state.comparing = true;
        state.error = null;
      })
      .addCase(compareVersions.fulfilled, (state, action) => {
        state.comparing = false;
        state.currentDiff = action.payload.diff;
        state.compareVersionIds = [action.payload.versionIdA, action.payload.versionIdB];
      })
      .addCase(compareVersions.rejected, (state, action) => {
        state.comparing = false;
        state.error = action.payload ?? null;
      })

      // restoreVersion
      .addCase(restoreVersion.pending, (state) => {
        state.restoring = true;
        state.error = null;
      })
      .addCase(restoreVersion.fulfilled, (state, action) => {
        state.restoring = false;
        // Les versions seront rechargees par le dispatch dans le thunk
      })
      .addCase(restoreVersion.rejected, (state, action) => {
        state.restoring = false;
        state.error = action.payload ?? null;
      })

      // deleteVersion
      .addCase(deleteVersion.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(deleteVersion.fulfilled, (state, action) => {
        state.loading = false;
        const { fileId, versionId } = action.payload;

        if (state.byFileId[fileId]) {
          state.byFileId[fileId] = state.byFileId[fileId].filter(v => v.id !== versionId);
        }

        // Deselectionner si c'etait la version selectionnee
        if (state.selectedVersionId === versionId) {
          state.selectedVersionId = null;
        }
      })
      .addCase(deleteVersion.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload ?? null;
      })

      // updateConfig
      .addCase(updateConfig.fulfilled, (state, action) => {
        state.config = action.payload;
      })
      .addCase(updateConfig.rejected, (state, action) => {
        state.error = action.payload ?? null;
      })

      // exportVersion
      .addCase(exportVersion.pending, (state) => {
        state.loading = true;
      })
      .addCase(exportVersion.fulfilled, (state) => {
        state.loading = false;
      })
      .addCase(exportVersion.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload ?? null;
      })

      // fetchTotalVersionsSize
      .addCase(fetchTotalVersionsSize.fulfilled, (state, action) => {
        state.totalVersionsSize = action.payload;
      });
  },
});

// ==================== EXPORTS ====================

export const {
  selectVersion,
  openVersionPanel,
  closeVersionPanel,
  setCompareVersions,
  clearDiff,
  clearVersionErrors,
  setConfig,
} = versionsSlice.actions;

export default versionsSlice.reducer;
