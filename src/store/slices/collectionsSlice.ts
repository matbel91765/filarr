/**
 * Collections Redux Slice
 *
 * Manages state for virtual collections feature including:
 * - Manual collections (user-selected files)
 * - Smart collections (criteria-based)
 * - Collection sharing and export
 */

import { createSlice, createAsyncThunk, PayloadAction, SerializedError } from '@reduxjs/toolkit';
import errorService from '../../services/platform/errorService';

// Stub collectionService (module removed) — all methods throw so callers get proper rejectWithValue
const collectionService = {
  getAllCollections: (): any[] => [],
  createManualCollection: (..._args: any[]): any => { throw new Error('collectionService not available'); },
  createSmartCollection: (..._args: any[]): any => { throw new Error('collectionService not available'); },
  updateCollection: (..._args: any[]): any => { throw new Error('collectionService not available'); },
  deleteCollection: (..._args: any[]): boolean => { throw new Error('collectionService not available'); },
  addFilesToCollection: (..._args: any[]): any => { throw new Error('collectionService not available'); },
  removeFilesFromCollection: (..._args: any[]): any => { throw new Error('collectionService not available'); },
  reorderFiles: (..._args: any[]): any => { throw new Error('collectionService not available'); },
  evaluateSmartCollection: (..._args: any[]): any[] => [],
  exportCollection: (..._args: any[]): any => { throw new Error('collectionService not available'); },
  duplicateCollection: (..._args: any[]): any => { throw new Error('collectionService not available'); },
};
import type {
  VirtualCollection,
  SmartCollectionCriteria,
  SmartCollectionRule,
  CollectionExportOptions,
  CollectionShareSettings,
  FileItem,
} from '../../types';

/**
 * Collections State Interface
 */
export interface CollectionsState {
  // Collections
  collections: VirtualCollection[];
  selectedCollectionId: string | null;

  // Smart collection evaluation cache
  smartCollectionResults: Record<string, string[]>; // collectionId -> fileIds

  // Share settings
  shareSettings: Record<string, CollectionShareSettings>;

  // UI State
  isLoading: boolean;
  error: SerializedError | null;

  // Operations
  activeOperation: {
    type: 'create' | 'update' | 'delete' | 'export' | 'share' | null;
    collectionId: string | null;
    progress: number;
  };

  // Filters and sorting
  filterType: 'all' | 'manual' | 'smart';
  sortBy: 'name' | 'dateCreated' | 'dateModified' | 'fileCount';
  sortOrder: 'asc' | 'desc';
}

/**
 * Initial State
 */
const initialState: CollectionsState = {
  collections: [],
  selectedCollectionId: null,
  smartCollectionResults: {},
  shareSettings: {},
  isLoading: false,
  error: null,
  activeOperation: {
    type: null,
    collectionId: null,
    progress: 0,
  },
  filterType: 'all',
  sortBy: 'dateModified',
  sortOrder: 'desc',
};

/**
 * Async Thunks
 */

// Load all collections
export const loadCollections = createAsyncThunk<
  VirtualCollection[],
  void,
  { rejectValue: SerializedError }
>('collections/loadAll', async (_, { rejectWithValue }) => {
  try {
    return collectionService.getAllCollections();
  } catch (error) {
    const appError = errorService.createFromError(
      error as Error,
      'Failed to load collections',
      errorService.ErrorTypes.STORAGE
    );
    return rejectWithValue({ name: appError.name, message: appError.message });
  }
});

// Create manual collection
export const createManualCollection = createAsyncThunk<
  VirtualCollection,
  { name: string; description?: string; fileIds?: string[]; color?: string },
  { rejectValue: SerializedError }
>(
  'collections/createManual',
  async ({ name, description, fileIds, color }, { rejectWithValue }) => {
    try {
      return collectionService.createManualCollection(name, description, fileIds, color);
    } catch (error) {
      const appError = errorService.createFromError(
        error as Error,
        'Failed to create collection',
        errorService.ErrorTypes.VALIDATION
      );
      return rejectWithValue({ name: appError.name, message: appError.message });
    }
  }
);

// Create smart collection
export const createSmartCollection = createAsyncThunk<
  VirtualCollection,
  { name: string; criteria: SmartCollectionCriteria; description?: string; color?: string },
  { rejectValue: SerializedError }
>(
  'collections/createSmart',
  async ({ name, criteria, description, color }, { rejectWithValue }) => {
    try {
      return collectionService.createSmartCollection(name, criteria, description, color);
    } catch (error) {
      const appError = errorService.createFromError(
        error as Error,
        'Failed to create smart collection',
        errorService.ErrorTypes.VALIDATION
      );
      return rejectWithValue({ name: appError.name, message: appError.message });
    }
  }
);

// Update collection
export const updateCollection = createAsyncThunk<
  VirtualCollection,
  { id: string; updates: Partial<VirtualCollection> },
  { rejectValue: SerializedError }
>('collections/update', async ({ id, updates }, { rejectWithValue }) => {
  try {
    const updated = collectionService.updateCollection(id, updates);
    if (!updated) {
      throw new Error('Collection not found');
    }
    return updated;
  } catch (error) {
    const appError = errorService.createFromError(
      error as Error,
      'Failed to update collection',
      errorService.ErrorTypes.VALIDATION
    );
    return rejectWithValue({ name: appError.name, message: appError.message });
  }
});

// Delete collection
export const deleteCollection = createAsyncThunk<
  string,
  string,
  { rejectValue: SerializedError }
>('collections/delete', async (id, { rejectWithValue }) => {
  try {
    const deleted = collectionService.deleteCollection(id);
    if (!deleted) {
      throw new Error('Collection not found');
    }
    return id;
  } catch (error) {
    const appError = errorService.createFromError(
      error as Error,
      'Failed to delete collection',
      errorService.ErrorTypes.VALIDATION
    );
    return rejectWithValue({ name: appError.name, message: appError.message });
  }
});

// Add files to collection
export const addFilesToCollection = createAsyncThunk<
  VirtualCollection,
  { collectionId: string; fileIds: string[] },
  { rejectValue: SerializedError }
>('collections/addFiles', async ({ collectionId, fileIds }, { rejectWithValue }) => {
  try {
    const updated = collectionService.addFilesToCollection(collectionId, fileIds);
    if (!updated) {
      throw new Error('Collection not found or is not a manual collection');
    }
    return updated;
  } catch (error) {
    const appError = errorService.createFromError(
      error as Error,
      'Failed to add files to collection',
      errorService.ErrorTypes.VALIDATION
    );
    return rejectWithValue({ name: appError.name, message: appError.message });
  }
});

// Remove files from collection
export const removeFilesFromCollection = createAsyncThunk<
  VirtualCollection,
  { collectionId: string; fileIds: string[] },
  { rejectValue: SerializedError }
>('collections/removeFiles', async ({ collectionId, fileIds }, { rejectWithValue }) => {
  try {
    const updated = collectionService.removeFilesFromCollection(collectionId, fileIds);
    if (!updated) {
      throw new Error('Collection not found or is not a manual collection');
    }
    return updated;
  } catch (error) {
    const appError = errorService.createFromError(
      error as Error,
      'Failed to remove files from collection',
      errorService.ErrorTypes.VALIDATION
    );
    return rejectWithValue({ name: appError.name, message: appError.message });
  }
});

// Reorder files in collection
export const reorderCollectionFiles = createAsyncThunk<
  VirtualCollection,
  { collectionId: string; newOrder: string[] },
  { rejectValue: SerializedError }
>('collections/reorderFiles', async ({ collectionId, newOrder }, { rejectWithValue }) => {
  try {
    const updated = collectionService.reorderFiles(collectionId, newOrder);
    if (!updated) {
      throw new Error('Collection not found');
    }
    return updated;
  } catch (error) {
    const appError = errorService.createFromError(
      error as Error,
      'Failed to reorder files',
      errorService.ErrorTypes.VALIDATION
    );
    return rejectWithValue({ name: appError.name, message: appError.message });
  }
});

// Evaluate smart collection
export const evaluateSmartCollection = createAsyncThunk<
  { collectionId: string; fileIds: string[] },
  { collectionId: string; files: FileItem[]; fileTags: Map<string, string[]>; favoriteFileIds?: Set<string> },
  { rejectValue: SerializedError }
>(
  'collections/evaluateSmart',
  async ({ collectionId, files, fileTags, favoriteFileIds }, { rejectWithValue, getState }) => {
    try {
      const state = getState() as { collections: CollectionsState };
      const collection = state.collections.collections.find((c) => c.id === collectionId);

      if (!collection || collection.type !== 'smart' || !collection.criteria) {
        throw new Error('Invalid smart collection');
      }

      const matchedFiles = collectionService.evaluateSmartCollection(
        collection.criteria,
        files,
        fileTags,
        favoriteFileIds || new Set()
      );

      return {
        collectionId,
        fileIds: matchedFiles.map((f) => f.id),
      };
    } catch (error) {
      const appError = errorService.createFromError(
        error as Error,
        'Failed to evaluate smart collection',
        errorService.ErrorTypes.VALIDATION
      );
      return rejectWithValue({ name: appError.name, message: appError.message });
    }
  }
);

// Export collection
export const exportCollection = createAsyncThunk<
  { data: any; filename: string },
  { collectionId: string; files: FileItem[]; options: CollectionExportOptions },
  { rejectValue: SerializedError }
>(
  'collections/export',
  async ({ collectionId, files, options }, { rejectWithValue }) => {
    try {
      return await collectionService.exportCollection(collectionId, files, options);
    } catch (error) {
      const appError = errorService.createFromError(
        error as Error,
        'Failed to export collection',
        errorService.ErrorTypes.STORAGE
      );
      return rejectWithValue({ name: appError.name, message: appError.message });
    }
  }
);

// Duplicate collection
export const duplicateCollection = createAsyncThunk<
  VirtualCollection,
  { collectionId: string; newName?: string },
  { rejectValue: SerializedError }
>('collections/duplicate', async ({ collectionId, newName }, { rejectWithValue }) => {
  try {
    const duplicate = collectionService.duplicateCollection(collectionId, newName);
    if (!duplicate) {
      throw new Error('Collection not found');
    }
    return duplicate;
  } catch (error) {
    const appError = errorService.createFromError(
      error as Error,
      'Failed to duplicate collection',
      errorService.ErrorTypes.VALIDATION
    );
    return rejectWithValue({ name: appError.name, message: appError.message });
  }
});

/**
 * Collections Slice
 */
const collectionsSlice = createSlice({
  name: 'collections',
  initialState,
  reducers: {
    // Select collection
    selectCollection(state, action: PayloadAction<string | null>) {
      state.selectedCollectionId = action.payload;
    },

    // Clear selection
    clearSelection(state) {
      state.selectedCollectionId = null;
    },

    // Set filter type
    setFilterType(state, action: PayloadAction<'all' | 'manual' | 'smart'>) {
      state.filterType = action.payload;
    },

    // Set sort options
    setSortOptions(
      state,
      action: PayloadAction<{
        sortBy?: 'name' | 'dateCreated' | 'dateModified' | 'fileCount';
        sortOrder?: 'asc' | 'desc';
      }>
    ) {
      if (action.payload.sortBy) {
        state.sortBy = action.payload.sortBy;
      }
      if (action.payload.sortOrder) {
        state.sortOrder = action.payload.sortOrder;
      }
    },

    // Update share settings
    updateShareSettings(
      state,
      action: PayloadAction<{ collectionId: string; settings: CollectionShareSettings }>
    ) {
      state.shareSettings[action.payload.collectionId] = action.payload.settings;
    },

    // Clear smart collection cache
    clearSmartCollectionCache(state, action: PayloadAction<string | undefined>) {
      if (action.payload) {
        delete state.smartCollectionResults[action.payload];
      } else {
        state.smartCollectionResults = {};
      }
    },

    // Clear error
    clearError(state) {
      state.error = null;
    },

    // Reset operation
    resetOperation(state) {
      state.activeOperation = {
        type: null,
        collectionId: null,
        progress: 0,
      };
    },
  },
  extraReducers: (builder) => {
    // Load collections
    builder
      .addCase(loadCollections.pending, (state) => {
        state.isLoading = true;
        state.error = null;
      })
      .addCase(loadCollections.fulfilled, (state, action) => {
        state.isLoading = false;
        state.collections = action.payload;
      })
      .addCase(loadCollections.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.payload || null;
      });

    // Create manual collection
    builder
      .addCase(createManualCollection.pending, (state) => {
        state.activeOperation = { type: 'create', collectionId: null, progress: 0 };
      })
      .addCase(createManualCollection.fulfilled, (state, action) => {
        state.collections.push(action.payload);
        state.selectedCollectionId = action.payload.id;
        state.activeOperation = { type: null, collectionId: null, progress: 100 };
      })
      .addCase(createManualCollection.rejected, (state, action) => {
        state.error = action.payload || null;
        state.activeOperation = { type: null, collectionId: null, progress: 0 };
      });

    // Create smart collection
    builder
      .addCase(createSmartCollection.pending, (state) => {
        state.activeOperation = { type: 'create', collectionId: null, progress: 0 };
      })
      .addCase(createSmartCollection.fulfilled, (state, action) => {
        state.collections.push(action.payload);
        state.selectedCollectionId = action.payload.id;
        state.activeOperation = { type: null, collectionId: null, progress: 100 };
      })
      .addCase(createSmartCollection.rejected, (state, action) => {
        state.error = action.payload || null;
        state.activeOperation = { type: null, collectionId: null, progress: 0 };
      });

    // Update collection
    builder
      .addCase(updateCollection.pending, (state, action) => {
        state.activeOperation = { type: 'update', collectionId: action.meta.arg.id, progress: 0 };
      })
      .addCase(updateCollection.fulfilled, (state, action) => {
        const index = state.collections.findIndex((c) => c.id === action.payload.id);
        if (index !== -1) {
          state.collections[index] = action.payload;
        }
        state.activeOperation = { type: null, collectionId: null, progress: 100 };
      })
      .addCase(updateCollection.rejected, (state, action) => {
        state.error = action.payload || null;
        state.activeOperation = { type: null, collectionId: null, progress: 0 };
      });

    // Delete collection
    builder
      .addCase(deleteCollection.pending, (state, action) => {
        state.activeOperation = { type: 'delete', collectionId: action.meta.arg, progress: 0 };
      })
      .addCase(deleteCollection.fulfilled, (state, action) => {
        state.collections = state.collections.filter((c) => c.id !== action.payload);
        if (state.selectedCollectionId === action.payload) {
          state.selectedCollectionId = null;
        }
        delete state.smartCollectionResults[action.payload];
        delete state.shareSettings[action.payload];
        state.activeOperation = { type: null, collectionId: null, progress: 100 };
      })
      .addCase(deleteCollection.rejected, (state, action) => {
        state.error = action.payload || null;
        state.activeOperation = { type: null, collectionId: null, progress: 0 };
      });

    // Add files to collection
    builder
      .addCase(addFilesToCollection.fulfilled, (state, action) => {
        const index = state.collections.findIndex((c) => c.id === action.payload.id);
        if (index !== -1) {
          state.collections[index] = action.payload;
        }
      })
      .addCase(addFilesToCollection.rejected, (state, action) => {
        state.error = action.payload || null;
      });

    // Remove files from collection
    builder
      .addCase(removeFilesFromCollection.fulfilled, (state, action) => {
        const index = state.collections.findIndex((c) => c.id === action.payload.id);
        if (index !== -1) {
          state.collections[index] = action.payload;
        }
      })
      .addCase(removeFilesFromCollection.rejected, (state, action) => {
        state.error = action.payload || null;
      });

    // Reorder files
    builder
      .addCase(reorderCollectionFiles.fulfilled, (state, action) => {
        const index = state.collections.findIndex((c) => c.id === action.payload.id);
        if (index !== -1) {
          state.collections[index] = action.payload;
        }
      })
      .addCase(reorderCollectionFiles.rejected, (state, action) => {
        state.error = action.payload || null;
      });

    // Evaluate smart collection
    builder
      .addCase(evaluateSmartCollection.fulfilled, (state, action) => {
        state.smartCollectionResults[action.payload.collectionId] = action.payload.fileIds;
      })
      .addCase(evaluateSmartCollection.rejected, (state, action) => {
        state.error = action.payload || null;
      });

    // Export collection
    builder
      .addCase(exportCollection.pending, (state, action) => {
        state.activeOperation = {
          type: 'export',
          collectionId: action.meta.arg.collectionId,
          progress: 0,
        };
      })
      .addCase(exportCollection.fulfilled, (state) => {
        state.activeOperation = { type: null, collectionId: null, progress: 100 };
      })
      .addCase(exportCollection.rejected, (state, action) => {
        state.error = action.payload || null;
        state.activeOperation = { type: null, collectionId: null, progress: 0 };
      });

    // Duplicate collection
    builder
      .addCase(duplicateCollection.fulfilled, (state, action) => {
        state.collections.push(action.payload);
      })
      .addCase(duplicateCollection.rejected, (state, action) => {
        state.error = action.payload || null;
      });
  },
});

// Export actions
export const {
  selectCollection,
  clearSelection,
  setFilterType,
  setSortOptions,
  updateShareSettings,
  clearSmartCollectionCache,
  clearError,
  resetOperation,
} = collectionsSlice.actions;

// Export reducer
export default collectionsSlice.reducer;
