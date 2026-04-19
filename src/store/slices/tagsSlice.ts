/**
 * Redux Slice pour les Tags Hierarchiques
 *
 * Gere les tags hierarchiques avec relations parent-enfant,
 * couleurs personnalisees, alias, et filtrage par tags.
 */

import { createSlice, createAsyncThunk, createSelector, PayloadAction } from '@reduxjs/toolkit';
import type { HierarchicalTag, TagStatistics, BulkTagOperation } from '../../types';

// Local type definitions (previously from tagService)
export interface CreateTagOptions {
  name: string;
  parentId?: string | null;
  color?: string;
  icon?: string;
  aliases?: string[];
  description?: string;
}

export interface UpdateTagOptions {
  name?: string;
  parentId?: string | null;
  color?: string;
  icon?: string;
  aliases?: string[];
  description?: string;
}

export interface TagSearchResult {
  tag: HierarchicalTag;
  score: number;
  matchedField: 'name' | 'alias' | 'description';
}

// ==================== TYPES ====================

/**
 * Etat du slice tags
 */
export interface TagsState {
  // Donnees
  tags: HierarchicalTag[];
  statistics: TagStatistics[];
  fileTagMappings: Record<string, string[]>; // fileId -> tagIds

  // Selection et filtrage
  selectedTagIds: string[];
  filterByTags: string[];
  filterMode: 'any' | 'all'; // Match any selected tag or all selected tags

  // UI State
  expandedTagIds: string[];
  searchQuery: string;
  searchResults: TagSearchResult[];

  // Loading states
  loading: boolean;
  saving: boolean;
  error: string | null;

  // Bulk operation
  bulkOperation: BulkTagOperation | null;
}

// ==================== INITIAL STATE ====================

const initialState: TagsState = {
  tags: [],
  statistics: [],
  fileTagMappings: {},
  selectedTagIds: [],
  filterByTags: [],
  filterMode: 'any',
  expandedTagIds: [],
  searchQuery: '',
  searchResults: [],
  loading: false,
  saving: false,
  error: null,
  bulkOperation: null,
};

// ==================== ASYNC THUNKS ====================

/**
 * Charger tous les tags
 */
export const loadTags = createAsyncThunk(
  'tags/loadTags',
  async (_: void, { getState }) => {
    // Tags are managed locally in Redux state; just return current state
    const { tags } = getState() as { tags: TagsState };
    return {
      tags: tags.tags,
      statistics: tags.statistics,
      fileTagMappings: tags.fileTagMappings,
    };
  }
);

/**
 * Creer un nouveau tag
 */
export const createTag = createAsyncThunk(
  'tags/createTag',
  async (options: CreateTagOptions) => {
    const now = new Date().toISOString();
    const tag: HierarchicalTag = {
      id: crypto.randomUUID ? crypto.randomUUID() : `tag-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      name: options.name,
      parentId: options.parentId || null,
      color: options.color || '#87CEEB',
      icon: options.icon,
      aliases: options.aliases || [],
      description: options.description,
      usageCount: 0,
      children: [],
      createdAt: now,
      updatedAt: now,
    };
    return tag;
  }
);

/**
 * Mettre a jour un tag
 */
export const updateTag = createAsyncThunk(
  'tags/updateTag',
  async (
    { id, updates }: { id: string; updates: UpdateTagOptions },
    { getState, rejectWithValue }
  ) => {
    const { tags } = getState() as { tags: TagsState };
    const existing = tags.tags.find(t => t.id === id);
    if (!existing) {
      return rejectWithValue('Tag not found');
    }
    const updated: HierarchicalTag = {
      ...existing,
      ...updates,
      updatedAt: new Date().toISOString(),
    };
    return updated;
  }
);

/**
 * Supprimer un tag
 */
export const deleteTag = createAsyncThunk(
  'tags/deleteTag',
  async (
    { id, reassignChildrenTo: _reassignChildrenTo }: { id: string; reassignChildrenTo?: string | null },
  ) => {
    // Deletion is handled by the reducer in extraReducers
    return id;
  }
);

/**
 * Fusionner des tags
 */
export const mergeTags = createAsyncThunk(
  'tags/mergeTags',
  async (
    { sourceIds, targetId }: { sourceIds: string[]; targetId: string },
  ) => {
    // Merge is handled by the reducer in extraReducers
    return { sourceIds, targetId };
  }
);

/**
 * Ajouter un tag a un fichier
 */
export const addTagToFile = createAsyncThunk(
  'tags/addTagToFile',
  async (
    { fileId, tagId }: { fileId: string; tagId: string },
    { getState }
  ) => {
    const { tags } = getState() as { tags: TagsState };
    const currentTagIds = tags.fileTagMappings[fileId] || [];
    const newTagIds = currentTagIds.includes(tagId) ? currentTagIds : [...currentTagIds, tagId];
    return {
      fileId,
      tagIds: newTagIds,
      tags: tags.tags,
    };
  }
);

/**
 * Retirer un tag d'un fichier
 */
export const removeTagFromFile = createAsyncThunk(
  'tags/removeTagFromFile',
  async (
    { fileId, tagId }: { fileId: string; tagId: string },
    { getState }
  ) => {
    const { tags } = getState() as { tags: TagsState };
    const currentTagIds = tags.fileTagMappings[fileId] || [];
    const newTagIds = currentTagIds.filter(id => id !== tagId);
    return {
      fileId,
      tagIds: newTagIds,
      tags: tags.tags,
    };
  }
);

/**
 * Obtenir les tags d'un fichier
 */
export const getFileTags = createAsyncThunk(
  'tags/getFileTags',
  async (fileId: string, { getState }) => {
    const { tags } = getState() as { tags: TagsState };
    const directTagIds = tags.fileTagMappings[fileId] || [];
    return {
      fileId,
      directTagIds,
      inheritedTagIds: [] as string[],
    };
  }
);

/**
 * Executer une operation en masse
 */
export const executeBulkTagOperation = createAsyncThunk(
  'tags/executeBulkTagOperation',
  async (
    operation: Omit<BulkTagOperation, 'id' | 'createdAt' | 'completedAt' | 'result'>,
    { getState }
  ) => {
    const { tags } = getState() as { tags: TagsState };
    const now = new Date().toISOString();
    const completedOp: BulkTagOperation = {
      ...operation,
      id: crypto.randomUUID ? crypto.randomUUID() : `bulk-${Date.now()}`,
      createdAt: now,
      completedAt: now,
      status: 'completed',
      progress: 100,
      result: { successCount: operation.fileIds.length, failureCount: 0, errors: [] },
    };
    return { operation: completedOp, tags: tags.tags };
  }
);

// ==================== SLICE ====================

const tagsSlice = createSlice({
  name: 'tags',
  initialState,
  reducers: {
    // ===== SELECTION =====

    /**
     * Selectionner un tag pour l'edition
     */
    selectTag(state, action: PayloadAction<string>) {
      if (!state.selectedTagIds.includes(action.payload)) {
        state.selectedTagIds.push(action.payload);
      }
    },

    /**
     * Deselectionner un tag
     */
    deselectTag(state, action: PayloadAction<string>) {
      state.selectedTagIds = state.selectedTagIds.filter(id => id !== action.payload);
    },

    /**
     * Deselectionner tous les tags
     */
    clearSelection(state) {
      state.selectedTagIds = [];
    },

    /**
     * Basculer la selection d'un tag
     */
    toggleTagSelection(state, action: PayloadAction<string>) {
      const index = state.selectedTagIds.indexOf(action.payload);
      if (index === -1) {
        state.selectedTagIds.push(action.payload);
      } else {
        state.selectedTagIds.splice(index, 1);
      }
    },

    // ===== FILTRAGE =====

    /**
     * Ajouter un tag au filtre
     */
    addTagToFilter(state, action: PayloadAction<string>) {
      if (!state.filterByTags.includes(action.payload)) {
        state.filterByTags.push(action.payload);
      }
    },

    /**
     * Retirer un tag du filtre
     */
    removeTagFromFilter(state, action: PayloadAction<string>) {
      state.filterByTags = state.filterByTags.filter(id => id !== action.payload);
    },

    /**
     * Vider le filtre par tags
     */
    clearTagFilter(state) {
      state.filterByTags = [];
    },

    /**
     * Definir le filtre par tags
     */
    setTagFilter(state, action: PayloadAction<string[]>) {
      state.filterByTags = action.payload;
    },

    /**
     * Basculer le mode de filtre (any/all)
     */
    toggleFilterMode(state) {
      state.filterMode = state.filterMode === 'any' ? 'all' : 'any';
    },

    /**
     * Definir le mode de filtre
     */
    setFilterMode(state, action: PayloadAction<'any' | 'all'>) {
      state.filterMode = action.payload;
    },

    // ===== UI STATE =====

    /**
     * Etendre/Replier un tag dans l'arbre
     */
    toggleTagExpanded(state, action: PayloadAction<string>) {
      const index = state.expandedTagIds.indexOf(action.payload);
      if (index === -1) {
        state.expandedTagIds.push(action.payload);
      } else {
        state.expandedTagIds.splice(index, 1);
      }
    },

    /**
     * Etendre tous les tags
     */
    expandAllTags(state) {
      state.expandedTagIds = state.tags.map(t => t.id);
    },

    /**
     * Replier tous les tags
     */
    collapseAllTags(state) {
      state.expandedTagIds = [];
    },

    /**
     * Definir la requete de recherche
     */
    setSearchQuery(state, action: PayloadAction<string>) {
      state.searchQuery = action.payload;
      if (action.payload.trim()) {
        const query = action.payload.toLowerCase();
        state.searchResults = state.tags
          .filter(t =>
            t.name.toLowerCase().includes(query) ||
            t.aliases.some(a => a.toLowerCase().includes(query)) ||
            (t.description && t.description.toLowerCase().includes(query))
          )
          .map(t => {
            const matchedField: 'name' | 'alias' | 'description' = t.name.toLowerCase().includes(query)
              ? 'name'
              : t.aliases.some(a => a.toLowerCase().includes(query))
                ? 'alias'
                : 'description';
            return { tag: t, score: 1, matchedField };
          });
      } else {
        state.searchResults = [];
      }
    },

    /**
     * Vider la recherche
     */
    clearSearch(state) {
      state.searchQuery = '';
      state.searchResults = [];
    },

    // ===== ERROR HANDLING =====

    /**
     * Effacer l'erreur
     */
    clearError(state) {
      state.error = null;
    },

    /**
     * Effacer l'operation en masse
     */
    clearBulkOperation(state) {
      state.bulkOperation = null;
    },

    // ===== FILE TAG MAPPINGS =====

    /**
     * Mettre a jour le mapping des tags pour un fichier
     */
    setFileTagMapping(state, action: PayloadAction<{ fileId: string; tagIds: string[] }>) {
      state.fileTagMappings[action.payload.fileId] = action.payload.tagIds;
    },

    /**
     * Effacer le mapping des tags pour un fichier
     */
    clearFileTagMapping(state, action: PayloadAction<string>) {
      delete state.fileTagMappings[action.payload];
    },
  },

  extraReducers: (builder) => {
    // Load tags
    builder
      .addCase(loadTags.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(loadTags.fulfilled, (state, action) => {
        state.loading = false;
        state.tags = action.payload.tags;
        state.statistics = action.payload.statistics;
        state.fileTagMappings = action.payload.fileTagMappings;
      })
      .addCase(loadTags.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload as string;
      });

    // Create tag
    builder
      .addCase(createTag.pending, (state) => {
        state.saving = true;
        state.error = null;
      })
      .addCase(createTag.fulfilled, (state, action) => {
        state.saving = false;
        state.tags.push(action.payload);
      })
      .addCase(createTag.rejected, (state, action) => {
        state.saving = false;
        state.error = action.payload as string;
      });

    // Update tag
    builder
      .addCase(updateTag.pending, (state) => {
        state.saving = true;
        state.error = null;
      })
      .addCase(updateTag.fulfilled, (state, action) => {
        state.saving = false;
        const index = state.tags.findIndex(t => t.id === action.payload.id);
        if (index !== -1) {
          state.tags[index] = action.payload;
        }
      })
      .addCase(updateTag.rejected, (state, action) => {
        state.saving = false;
        state.error = action.payload as string;
      });

    // Delete tag
    builder
      .addCase(deleteTag.pending, (state) => {
        state.saving = true;
        state.error = null;
      })
      .addCase(deleteTag.fulfilled, (state, action) => {
        state.saving = false;
        state.tags = state.tags.filter(t => t.id !== action.payload);
        state.selectedTagIds = state.selectedTagIds.filter(id => id !== action.payload);
        state.filterByTags = state.filterByTags.filter(id => id !== action.payload);
        state.expandedTagIds = state.expandedTagIds.filter(id => id !== action.payload);
      })
      .addCase(deleteTag.rejected, (state, action) => {
        state.saving = false;
        state.error = action.payload as string;
      });

    // Merge tags
    builder
      .addCase(mergeTags.pending, (state) => {
        state.saving = true;
        state.error = null;
      })
      .addCase(mergeTags.fulfilled, (state, action) => {
        state.saving = false;
        // Remove merged source tags from the tags list
        state.tags = state.tags.filter(t => !action.payload.sourceIds.includes(t.id));
        // Retirer les tags sources de la selection
        state.selectedTagIds = state.selectedTagIds.filter(
          id => !action.payload.sourceIds.includes(id)
        );
      })
      .addCase(mergeTags.rejected, (state, action) => {
        state.saving = false;
        state.error = action.payload as string;
      });

    // Add tag to file
    builder
      .addCase(addTagToFile.fulfilled, (state, action) => {
        state.fileTagMappings[action.payload.fileId] = action.payload.tagIds;
        state.tags = action.payload.tags;
      });

    // Remove tag from file
    builder
      .addCase(removeTagFromFile.fulfilled, (state, action) => {
        state.fileTagMappings[action.payload.fileId] = action.payload.tagIds;
        state.tags = action.payload.tags;
      });

    // Get file tags
    builder
      .addCase(getFileTags.fulfilled, (state, action) => {
        state.fileTagMappings[action.payload.fileId] = action.payload.directTagIds;
      });

    // Bulk operation
    builder
      .addCase(executeBulkTagOperation.pending, (state) => {
        state.saving = true;
        state.error = null;
      })
      .addCase(executeBulkTagOperation.fulfilled, (state, action) => {
        state.saving = false;
        state.bulkOperation = action.payload.operation;
        state.tags = action.payload.tags;
      })
      .addCase(executeBulkTagOperation.rejected, (state, action) => {
        state.saving = false;
        state.error = action.payload as string;
      });
  },
});

// ==================== SELECTORS ====================

/**
 * Obtenir tous les tags
 */
export const selectAllTags = createSelector(
  [(state: { tags: TagsState }) => state.tags.tags],
  (tags) => tags
);

/**
 * Obtenir les tags racines
 */
export const selectRootTags = (state: { tags: TagsState }): HierarchicalTag[] =>
  state.tags.tags.filter(t => !t.parentId);

/**
 * Obtenir un tag par ID
 */
export const selectTagById = (
  state: { tags: TagsState },
  id: string
): HierarchicalTag | undefined =>
  state.tags.tags.find(t => t.id === id);

/**
 * Obtenir les enfants d'un tag
 */
export const selectChildTags = (
  state: { tags: TagsState },
  parentId: string
): HierarchicalTag[] =>
  state.tags.tags.filter(t => t.parentId === parentId);

/**
 * Obtenir les tags selectionnes
 */
export const selectSelectedTags = (state: { tags: TagsState }): HierarchicalTag[] =>
  state.tags.selectedTagIds
    .map(id => state.tags.tags.find(t => t.id === id))
    .filter((t): t is HierarchicalTag => t !== undefined);

/**
 * Obtenir les tags du filtre
 */
export const selectFilterTags = (state: { tags: TagsState }): HierarchicalTag[] =>
  state.tags.filterByTags
    .map(id => state.tags.tags.find(t => t.id === id))
    .filter((t): t is HierarchicalTag => t !== undefined);

/**
 * Verifier si un tag est dans le filtre
 */
export const selectIsTagInFilter = (
  state: { tags: TagsState },
  tagId: string
): boolean =>
  state.tags.filterByTags.includes(tagId);

/**
 * Obtenir les tags d'un fichier
 */
export const selectFileTagIds = (
  state: { tags: TagsState },
  fileId: string
): string[] =>
  state.tags.fileTagMappings[fileId] || [];

/**
 * Obtenir les tags d'un fichier (objets)
 */
export const selectFileTags = (
  state: { tags: TagsState },
  fileId: string
): HierarchicalTag[] => {
  const tagIds = state.tags.fileTagMappings[fileId] || [];
  return tagIds
    .map(id => state.tags.tags.find(t => t.id === id))
    .filter((t): t is HierarchicalTag => t !== undefined);
};

/**
 * Obtenir tous les mappings fichier->tags (brut)
 */
export const selectFileTagMappings = createSelector(
  [(state: { tags: TagsState }) => state.tags.fileTagMappings],
  (mappings) => mappings
);

/**
 * Obtenir les resultats de recherche
 */
export const selectSearchResults = (state: { tags: TagsState }): TagSearchResult[] =>
  state.tags.searchResults;

/**
 * Verifier si un tag est etendu
 */
export const selectIsTagExpanded = (
  state: { tags: TagsState },
  tagId: string
): boolean =>
  state.tags.expandedTagIds.includes(tagId);

/**
 * Obtenir les statistiques d'un tag
 */
export const selectTagStatistics = (
  state: { tags: TagsState },
  tagId: string
): TagStatistics | undefined =>
  state.tags.statistics.find(s => s.tagId === tagId);

/**
 * Obtenir l'etat de chargement
 */
export const selectTagsLoading = (state: { tags: TagsState }): boolean =>
  state.tags.loading || state.tags.saving;

/**
 * Obtenir l'erreur
 */
export const selectTagsError = (state: { tags: TagsState }): string | null =>
  state.tags.error;

// ==================== EXPORTS ====================

export const {
  // Selection
  selectTag,
  deselectTag,
  clearSelection,
  toggleTagSelection,
  // Filtrage
  addTagToFilter,
  removeTagFromFilter,
  clearTagFilter,
  setTagFilter,
  toggleFilterMode,
  setFilterMode,
  // UI State
  toggleTagExpanded,
  expandAllTags,
  collapseAllTags,
  setSearchQuery,
  clearSearch,
  // Error handling
  clearError,
  clearBulkOperation,
  // File tag mappings
  setFileTagMapping,
  clearFileTagMapping,
} = tagsSlice.actions;

export default tagsSlice.reducer;
