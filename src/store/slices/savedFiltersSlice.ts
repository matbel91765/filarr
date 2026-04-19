/**
 * Redux Slice pour les Filtres Sauvegardes
 *
 * Gere les filtres sauvegardes avec conditions multiples,
 * logique AND/OR et application rapide.
 */

import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import filterService, {
  SavedFilter,
  FilterGroup,
  FilterCriteria,
  FilterResult,
} from '../../services/search/filterService';
import type { Item } from '../../types';

// ==================== TYPES ====================

/**
 * Etat du slice savedFilters
 */
export interface SavedFiltersState {
  // Donnees
  filters: SavedFilter[];
  presetFilters: SavedFilter[];
  customFilters: SavedFilter[];

  // Filtre actif
  activeFilterId: string | null;
  activeFilterResult: FilterResult | null;

  // UI State
  isBuilderOpen: boolean;
  editingFilter: SavedFilter | null;
  isPinPanelExpanded: boolean;

  // Loading states
  loading: boolean;
  applying: boolean;
  error: string | null;
}

// ==================== INITIAL STATE ====================

const initialState: SavedFiltersState = {
  filters: filterService.getAllFilters(),
  presetFilters: filterService.getPresetFilters(),
  customFilters: filterService.getCustomFilters(),
  activeFilterId: null,
  activeFilterResult: null,
  isBuilderOpen: false,
  editingFilter: null,
  isPinPanelExpanded: true,
  loading: false,
  applying: false,
  error: null,
};

// ==================== ASYNC THUNKS ====================

/**
 * Charger tous les filtres
 */
export const loadFilters = createAsyncThunk(
  'savedFilters/loadFilters',
  async (_: void, { rejectWithValue }) => {
    try {
      const filters = filterService.getAllFilters();
      const presets = filterService.getPresetFilters();
      const custom = filterService.getCustomFilters();
      return { filters, presets, custom };
    } catch (error) {
      return rejectWithValue((error as Error).message);
    }
  }
);

/**
 * Creer un nouveau filtre
 */
export const createFilter = createAsyncThunk(
  'savedFilters/createFilter',
  async (
    data: {
      name: string;
      description?: string;
      icon?: string;
      color?: string;
      group: FilterGroup;
    },
    { rejectWithValue }
  ) => {
    try {
      const filter = filterService.createFilter(data);
      return filter;
    } catch (error) {
      return rejectWithValue((error as Error).message);
    }
  }
);

/**
 * Mettre a jour un filtre
 */
export const updateFilter = createAsyncThunk(
  'savedFilters/updateFilter',
  async (
    { id, updates }: { id: string; updates: Partial<SavedFilter> },
    { rejectWithValue }
  ) => {
    try {
      const filter = filterService.updateFilter(id, updates);
      if (!filter) {
        throw new Error('Filter not found or cannot be modified');
      }
      return filter;
    } catch (error) {
      return rejectWithValue((error as Error).message);
    }
  }
);

/**
 * Supprimer un filtre
 */
export const deleteFilter = createAsyncThunk(
  'savedFilters/deleteFilter',
  async (id: string, { rejectWithValue }) => {
    try {
      const success = filterService.deleteFilter(id);
      if (!success) {
        throw new Error('Cannot delete filter (may be a preset)');
      }
      return id;
    } catch (error) {
      return rejectWithValue((error as Error).message);
    }
  }
);

/**
 * Dupliquer un filtre
 */
export const duplicateFilter = createAsyncThunk(
  'savedFilters/duplicateFilter',
  async (
    { id, newName }: { id: string; newName?: string },
    { rejectWithValue }
  ) => {
    try {
      const filter = filterService.duplicateFilter(id, newName);
      if (!filter) {
        throw new Error('Failed to duplicate filter');
      }
      return filter;
    } catch (error) {
      return rejectWithValue((error as Error).message);
    }
  }
);

/**
 * Appliquer un filtre a des items
 */
export const applyFilter = createAsyncThunk(
  'savedFilters/applyFilter',
  async (
    { filterId, items }: { filterId: string; items: Item[] },
    { rejectWithValue }
  ) => {
    try {
      const result = filterService.applyFilter(filterId, items);
      return { filterId, result };
    } catch (error) {
      return rejectWithValue((error as Error).message);
    }
  }
);

/**
 * Basculer l'epinglage d'un filtre
 */
export const toggleFilterPinned = createAsyncThunk(
  'savedFilters/toggleFilterPinned',
  async (id: string, { rejectWithValue }) => {
    try {
      const isPinned = filterService.togglePinned(id);
      return { id, isPinned };
    } catch (error) {
      return rejectWithValue((error as Error).message);
    }
  }
);

/**
 * Exporter les filtres
 */
export const exportFilters = createAsyncThunk(
  'savedFilters/exportFilters',
  async (_: void, { rejectWithValue }) => {
    try {
      const jsonString = filterService.exportFilters();
      return jsonString;
    } catch (error) {
      return rejectWithValue((error as Error).message);
    }
  }
);

/**
 * Importer des filtres
 */
export const importFilters = createAsyncThunk(
  'savedFilters/importFilters',
  async (jsonString: string, { rejectWithValue }) => {
    try {
      const count = filterService.importFilters(jsonString);
      const filters = filterService.getAllFilters();
      return { count, filters };
    } catch (error) {
      return rejectWithValue((error as Error).message);
    }
  }
);

// ==================== SLICE ====================

const savedFiltersSlice = createSlice({
  name: 'savedFilters',
  initialState,
  reducers: {
    // ===== FILTER BUILDER =====

    /**
     * Ouvrir le constructeur de filtres
     */
    openBuilder(state, action: PayloadAction<SavedFilter | undefined>) {
      state.isBuilderOpen = true;
      state.editingFilter = action.payload || null;
    },

    /**
     * Fermer le constructeur de filtres
     */
    closeBuilder(state) {
      state.isBuilderOpen = false;
      state.editingFilter = null;
    },

    // ===== ACTIVE FILTER =====

    /**
     * Definir le filtre actif
     */
    setActiveFilter(state, action: PayloadAction<string | null>) {
      state.activeFilterId = action.payload;
      if (!action.payload) {
        state.activeFilterResult = null;
      }
    },

    /**
     * Effacer le filtre actif
     */
    clearActiveFilter(state) {
      state.activeFilterId = null;
      state.activeFilterResult = null;
    },

    // ===== UI STATE =====

    /**
     * Basculer l'expansion du panneau des filtres epingles
     */
    togglePinPanelExpanded(state) {
      state.isPinPanelExpanded = !state.isPinPanelExpanded;
    },

    /**
     * Definir l'expansion du panneau des filtres epingles
     */
    setPinPanelExpanded(state, action: PayloadAction<boolean>) {
      state.isPinPanelExpanded = action.payload;
    },

    // ===== ERROR HANDLING =====

    /**
     * Effacer l'erreur
     */
    clearError(state) {
      state.error = null;
    },

    // ===== REFRESH =====

    /**
     * Rafraichir les filtres depuis le service
     */
    refreshFilters(state) {
      state.filters = filterService.getAllFilters();
      state.presetFilters = filterService.getPresetFilters();
      state.customFilters = filterService.getCustomFilters();
    },
  },

  extraReducers: (builder) => {
    // Load filters
    builder
      .addCase(loadFilters.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(loadFilters.fulfilled, (state, action) => {
        state.loading = false;
        state.filters = action.payload.filters;
        state.presetFilters = action.payload.presets;
        state.customFilters = action.payload.custom;
      })
      .addCase(loadFilters.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload as string;
      });

    // Create filter
    builder
      .addCase(createFilter.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(createFilter.fulfilled, (state, action) => {
        state.loading = false;
        state.filters.push(action.payload);
        state.customFilters.push(action.payload);
        state.isBuilderOpen = false;
        state.editingFilter = null;
      })
      .addCase(createFilter.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload as string;
      });

    // Update filter
    builder
      .addCase(updateFilter.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(updateFilter.fulfilled, (state, action) => {
        state.loading = false;
        const index = state.filters.findIndex(f => f.id === action.payload.id);
        if (index !== -1) {
          state.filters[index] = action.payload;
        }
        const customIndex = state.customFilters.findIndex(f => f.id === action.payload.id);
        if (customIndex !== -1) {
          state.customFilters[customIndex] = action.payload;
        }
        state.isBuilderOpen = false;
        state.editingFilter = null;
      })
      .addCase(updateFilter.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload as string;
      });

    // Delete filter
    builder
      .addCase(deleteFilter.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(deleteFilter.fulfilled, (state, action) => {
        state.loading = false;
        state.filters = state.filters.filter(f => f.id !== action.payload);
        state.customFilters = state.customFilters.filter(f => f.id !== action.payload);
        if (state.activeFilterId === action.payload) {
          state.activeFilterId = null;
          state.activeFilterResult = null;
        }
      })
      .addCase(deleteFilter.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload as string;
      });

    // Duplicate filter
    builder
      .addCase(duplicateFilter.fulfilled, (state, action) => {
        state.filters.push(action.payload);
        state.customFilters.push(action.payload);
      });

    // Apply filter
    builder
      .addCase(applyFilter.pending, (state) => {
        state.applying = true;
        state.error = null;
      })
      .addCase(applyFilter.fulfilled, (state, action) => {
        state.applying = false;
        state.activeFilterId = action.payload.filterId;
        state.activeFilterResult = action.payload.result;
      })
      .addCase(applyFilter.rejected, (state, action) => {
        state.applying = false;
        state.error = action.payload as string;
      });

    // Toggle pinned
    builder
      .addCase(toggleFilterPinned.fulfilled, (state, action) => {
        const filter = state.filters.find(f => f.id === action.payload.id);
        if (filter) {
          filter.isPinned = action.payload.isPinned;
        }
        const presetFilter = state.presetFilters.find(f => f.id === action.payload.id);
        if (presetFilter) {
          presetFilter.isPinned = action.payload.isPinned;
        }
        const customFilter = state.customFilters.find(f => f.id === action.payload.id);
        if (customFilter) {
          customFilter.isPinned = action.payload.isPinned;
        }
      });

    // Import filters
    builder
      .addCase(importFilters.fulfilled, (state, action) => {
        state.filters = action.payload.filters;
        state.presetFilters = filterService.getPresetFilters();
        state.customFilters = filterService.getCustomFilters();
      });
  },
});

// ==================== SELECTORS ====================

/**
 * Obtenir tous les filtres
 */
export const selectAllFilters = (state: { savedFilters: SavedFiltersState }): SavedFilter[] =>
  state.savedFilters.filters;

/**
 * Obtenir les filtres predefinis
 */
export const selectPresetFilters = (state: { savedFilters: SavedFiltersState }): SavedFilter[] =>
  state.savedFilters.presetFilters;

/**
 * Obtenir les filtres personnalises
 */
export const selectCustomFilters = (state: { savedFilters: SavedFiltersState }): SavedFilter[] =>
  state.savedFilters.customFilters;

/**
 * Obtenir les filtres epingles
 */
export const selectPinnedFilters = (state: { savedFilters: SavedFiltersState }): SavedFilter[] =>
  state.savedFilters.filters.filter(f => f.isPinned);

/**
 * Obtenir un filtre par ID
 */
export const selectFilterById = (
  state: { savedFilters: SavedFiltersState },
  id: string
): SavedFilter | undefined =>
  state.savedFilters.filters.find(f => f.id === id);

/**
 * Obtenir le filtre actif
 */
export const selectActiveFilter = (
  state: { savedFilters: SavedFiltersState }
): SavedFilter | undefined => {
  if (!state.savedFilters.activeFilterId) return undefined;
  return state.savedFilters.filters.find(f => f.id === state.savedFilters.activeFilterId);
};

/**
 * Obtenir le resultat du filtre actif
 */
export const selectActiveFilterResult = (
  state: { savedFilters: SavedFiltersState }
): FilterResult | null =>
  state.savedFilters.activeFilterResult;

/**
 * Verifier si le constructeur est ouvert
 */
export const selectIsBuilderOpen = (state: { savedFilters: SavedFiltersState }): boolean =>
  state.savedFilters.isBuilderOpen;

/**
 * Obtenir le filtre en cours d'edition
 */
export const selectEditingFilter = (
  state: { savedFilters: SavedFiltersState }
): SavedFilter | null =>
  state.savedFilters.editingFilter;

/**
 * Verifier si le panneau des filtres epingles est etendu
 */
export const selectIsPinPanelExpanded = (state: { savedFilters: SavedFiltersState }): boolean =>
  state.savedFilters.isPinPanelExpanded;

/**
 * Obtenir l'etat de chargement
 */
export const selectFiltersLoading = (state: { savedFilters: SavedFiltersState }): boolean =>
  state.savedFilters.loading || state.savedFilters.applying;

/**
 * Obtenir l'erreur
 */
export const selectFiltersError = (state: { savedFilters: SavedFiltersState }): string | null =>
  state.savedFilters.error;

// ==================== EXPORTS ====================

export const {
  openBuilder,
  closeBuilder,
  setActiveFilter,
  clearActiveFilter,
  togglePinPanelExpanded,
  setPinPanelExpanded,
  clearError,
  refreshFilters,
} = savedFiltersSlice.actions;

export type { SavedFilter, FilterGroup, FilterCriteria, FilterResult };

export default savedFiltersSlice.reducer;
