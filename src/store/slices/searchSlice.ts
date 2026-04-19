/**
 * Redux Slice pour la recherche
 *
 * Gère les fonctionnalités de recherche dans l'application, incluant
 * les requêtes de recherche, les résultats et les filtres.
 */

import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import errorService from '../../services/platform/errorService';
import searchService from '../../services/search/searchService';
import type { Note } from '../../types/notes';
import type { RootState } from '../index';

// Types pour la recherche
export interface SearchState {
  query: string;
  results: SearchResult[];
  selectedResultId: string | null;
  loading: boolean;
  error: SerializedError | null;
  filters: SearchFilters;
  searchOptions: SearchOptions;
  history: string[];
  sortOrder: SortOrder;
  pagination: Pagination;
}

export interface SerializedError {
  name?: string;
  message?: string;
  details?: any;
  type?: string;
}

export interface SearchResult {
  id: string;
  name: string;
  type: 'file' | 'folder' | 'note' | 'setting';
  path: string;
  lastModified: string;
  size: number | null;
  relevance: number;
  excerpt: string | null;
  tags: string[];
  /** Route to navigate to when clicking this result */
  route?: string;
}

export interface SearchFilters {
  type: 'all' | 'files' | 'folders';
  dateRange: {
    start: string | null;
    end: string | null;
  };
  tags: string[];
  extensions: string[];
  size: {
    min: number | null;
    max: number | null;
  };
}

export interface SearchOptions {
  searchContent: boolean;
  caseSensitive: boolean;
  exactMatch: boolean;
  includeArchived: boolean;
}

export interface SortOrder {
  field: 'relevance' | 'name' | 'date' | 'size';
  direction: 'asc' | 'desc';
}

export interface Pagination {
  page: number;
  itemsPerPage: number;
  totalItems: number;
  totalPages: number;
}

interface SearchResponse {
  items: SearchResult[];
  pagination: Pagination;
}

// État initial
const initialState: SearchState = {
  query: '',
  results: [],
  selectedResultId: null,
  loading: false,
  error: null,
  filters: {
    type: 'all',
    dateRange: {
      start: null,
      end: null,
    },
    tags: [],
    extensions: [],
    size: {
      min: null,
      max: null,
    },
  },
  searchOptions: {
    searchContent: false,
    caseSensitive: false,
    exactMatch: false,
    includeArchived: false,
  },
  history: [],
  sortOrder: {
    field: 'relevance',
    direction: 'desc',
  },
  pagination: {
    page: 1,
    itemsPerPage: 20,
    totalItems: 0,
    totalPages: 0,
  },
};

/**
 * Convertir les résultats du searchService vers le format SearchResult
 */
const convertSearchResults = (
  results: import('../../types').SearchResult[],
  sortOrder: SortOrder
): SearchResult[] => {
  const converted = results.map((result) => ({
    id: result.id,
    name: result.item.name,
    type: result.type,
    path: searchService.getIndexedFolderPath(result.id),
    lastModified: result.item.updatedAt || result.item.createdAt || new Date().toISOString(),
    size: 'size' in result.item ? result.item.size : null,
    relevance: result.relevance,
    excerpt: result.matches.length > 0 ? result.matches[0].value.substring(0, 100) : null,
    tags: [],
  }));

  // Apply sorting
  return converted.sort((a, b) => {
    const field = sortOrder.field;
    const direction = sortOrder.direction === 'asc' ? 1 : -1;

    if (field === 'relevance') {
      return direction * (b.relevance - a.relevance);
    } else if (field === 'name') {
      return direction * a.name.localeCompare(b.name);
    } else if (field === 'date' && a.lastModified && b.lastModified) {
      return direction * (new Date(a.lastModified).getTime() - new Date(b.lastModified).getTime());
    } else if (field === 'size' && a.size != null && b.size != null) {
      return direction * (a.size - b.size);
    }

    return 0;
  });
};

// ---- Settings search entries (static, searched client-side) ----
const SETTINGS_ENTRIES: Array<{ id: string; name: string; keywords: string; route: string }> = [
  {
    id: 'settings-profile',
    name: 'Profil',
    keywords: 'profil avatar nom pin code',
    route: '/settings?section=profile',
  },
  {
    id: 'settings-appearance',
    name: 'Apparence',
    keywords: 'theme sombre clair couleur accent dark light apparence',
    route: '/settings?section=appearance',
  },
  {
    id: 'settings-language',
    name: 'Langue',
    keywords: 'langue language francais anglais english french',
    route: '/settings?section=language',
  },
  {
    id: 'settings-notifications',
    name: 'Notifications',
    keywords: 'notifications son alerte',
    route: '/settings?section=notifications',
  },
  {
    id: 'settings-security',
    name: 'Securite',
    keywords: 'securite chiffrement mot de passe password encryption fek',
    route: '/settings?section=security',
  },
  {
    id: 'settings-export',
    name: 'Export',
    keywords: 'export backup sauvegarde vault',
    route: '/settings?section=export',
  },
  {
    id: 'settings-feedback',
    name: 'Feedback',
    keywords: 'feedback bug idee suggestion retour',
    route: '/settings?section=feedback',
  },
  {
    id: 'settings-about',
    name: 'A propos',
    keywords: 'version licence about credits',
    route: '/settings?section=about',
  },
];

function searchNotes(notes: Note[], query: string): SearchResult[] {
  const q = query.toLowerCase();
  return notes
    .filter((n) => {
      const title = (n.title || '').toLowerCase();
      const text = (n.plainText || '').toLowerCase();
      return title.includes(q) || text.includes(q);
    })
    .map((n) => {
      const title = (n.title || '').toLowerCase();
      const titleMatch = title.includes(q);
      // Extract snippet around match
      let excerpt: string | null = null;
      if (n.plainText) {
        const idx = n.plainText.toLowerCase().indexOf(q);
        if (idx >= 0) {
          const start = Math.max(0, idx - 40);
          const end = Math.min(n.plainText.length, idx + q.length + 60);
          excerpt =
            (start > 0 ? '...' : '') +
            n.plainText.slice(start, end) +
            (end < n.plainText.length ? '...' : '');
        }
      }
      return {
        id: n.id,
        name: n.title || 'Sans titre',
        type: 'note' as const,
        path: 'Notes',
        lastModified: n.updatedAt || n.createdAt || new Date().toISOString(),
        size: null,
        relevance: titleMatch ? 0.9 : 0.6,
        excerpt,
        tags: [],
        route: '/notes',
      };
    })
    .slice(0, 10); // Limit to 10 note results
}

function searchSettings(query: string): SearchResult[] {
  const q = query.toLowerCase();
  return SETTINGS_ENTRIES.filter(
    (s) => s.name.toLowerCase().includes(q) || s.keywords.includes(q)
  ).map((s) => ({
    id: s.id,
    name: s.name,
    type: 'setting' as const,
    path: 'Parametres',
    lastModified: '',
    size: null,
    relevance: s.name.toLowerCase().includes(q) ? 0.85 : 0.5,
    excerpt: null,
    tags: [],
    route: s.route,
  }));
}

// Thunks
export const executeSearch = createAsyncThunk<
  SearchResponse,
  void,
  { state: RootState; rejectValue: SerializedError }
>('search/execute', async (_, { getState, rejectWithValue }) => {
  try {
    const state = getState();
    const { search } = state;

    // Si la requête est vide, retourner un tableau vide
    if (!search.query.trim()) {
      return {
        items: [],
        pagination: {
          page: 1,
          itemsPerPage: search.pagination.itemsPerPage,
          totalItems: 0,
          totalPages: 0,
        },
      };
    }

    // --- File/folder search ---
    const serviceFilters: import('../../types').SearchFilters = {
      type:
        search.filters.type === 'files'
          ? 'file'
          : search.filters.type === 'folders'
            ? 'folder'
            : search.filters.type === 'all'
              ? 'all'
              : undefined,
      dateFrom: search.filters.dateRange.start || undefined,
      dateTo: search.filters.dateRange.end || undefined,
      tags: search.filters.tags,
      sizeMin: search.filters.size.min || undefined,
      sizeMax: search.filters.size.max || undefined,
    };

    const serviceOptions = {
      caseSensitive: search.searchOptions.caseSensitive,
      wholeWord: search.searchOptions.exactMatch,
      regex: false,
      includeContent: search.searchOptions.searchContent,
    };

    const fileResults = searchService.search(search.query, serviceFilters, serviceOptions);
    const convertedFileResults = convertSearchResults(fileResults, search.sortOrder);

    // --- Notes search ---
    const allNotes: Note[] = state.notes?.byId
      ? Object.values(state.notes.byId).filter((n): n is Note => !!n && !n.deletedAt)
      : [];
    const noteResults = searchNotes(allNotes, search.query);

    // --- Settings search ---
    const settingResults = searchSettings(search.query);

    // --- Merge all results, sorted by relevance ---
    const allResults = [...convertedFileResults, ...noteResults, ...settingResults].sort(
      (a, b) => b.relevance - a.relevance
    );

    const startIndex = (search.pagination.page - 1) * search.pagination.itemsPerPage;
    const endIndex = startIndex + search.pagination.itemsPerPage;
    const paginatedResults = allResults.slice(startIndex, endIndex);

    return {
      items: paginatedResults,
      pagination: {
        page: search.pagination.page,
        itemsPerPage: search.pagination.itemsPerPage,
        totalItems: allResults.length,
        totalPages: Math.ceil(allResults.length / search.pagination.itemsPerPage),
      },
    };
  } catch (error) {
    const appError = errorService.createFromError(
      error as Error,
      'Erreur lors de la recherche',
      errorService.ErrorTypes.UNKNOWN
    );
    errorService.logError(appError, 'executeSearch');
    return rejectWithValue({
      name: appError.name,
      message: appError.message,
      details: appError.metadata,
      type: appError.type,
    });
  }
});

// Slice
const searchSlice = createSlice({
  name: 'search',
  initialState,
  reducers: {
    // Actions synchrones
    setQuery(state, action: PayloadAction<string>) {
      state.query = action.payload;
    },

    clearSearch(state) {
      state.query = '';
      state.results = [];
      state.selectedResultId = null;
      state.loading = false;
      state.error = null;
    },

    selectResult(state, action: PayloadAction<string>) {
      state.selectedResultId = action.payload;
    },

    setFilters(state, action: PayloadAction<Partial<SearchFilters>>) {
      state.filters = {
        ...state.filters,
        ...action.payload,
      };
    },

    resetFilters(state) {
      state.filters = initialState.filters;
    },

    setSearchOptions(state, action: PayloadAction<Partial<SearchOptions>>) {
      state.searchOptions = {
        ...state.searchOptions,
        ...action.payload,
      };
    },

    addToHistory(state, action: PayloadAction<string>) {
      // Éviter les doublons
      if (!state.history.includes(action.payload) && action.payload.trim()) {
        // Limiter l'historique à 10 éléments
        if (state.history.length >= 10) {
          state.history.pop();
        }

        // Ajouter la nouvelle requête au début
        state.history.unshift(action.payload);
      }
    },

    clearHistory(state) {
      state.history = [];
    },

    setSortOrder(state, action: PayloadAction<SortOrder>) {
      state.sortOrder = action.payload;
    },

    setPage(state, action: PayloadAction<number>) {
      state.pagination.page = action.payload;
    },

    setItemsPerPage(state, action: PayloadAction<number>) {
      state.pagination.itemsPerPage = action.payload;
      // Réinitialiser la page courante pour éviter de sortir des limites
      state.pagination.page = 1;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(executeSearch.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(executeSearch.fulfilled, (state, action) => {
        state.loading = false;
        state.results = action.payload.items;
        state.pagination = action.payload.pagination;

        // Si la requête n'était pas vide, l'ajouter à l'historique
        if (state.query.trim()) {
          // Utiliser un ensemble pour éviter les doublons
          const uniqueHistory = new Set([state.query, ...state.history]);
          state.history = Array.from(uniqueHistory).slice(0, 10);
        }
      })
      .addCase(executeSearch.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload ?? null;
        state.results = [];
      });
  },
});

// Exporter les actions
export const {
  setQuery,
  clearSearch,
  selectResult,
  setFilters,
  resetFilters,
  setSearchOptions,
  addToHistory,
  clearHistory,
  setSortOrder,
  setPage,
  setItemsPerPage,
} = searchSlice.actions;

// Actions personnalisées
export const performSearch = (query: string) => (dispatch: any) => {
  dispatch(setQuery(query));
  dispatch(setPage(1)); // Réinitialiser la pagination
  dispatch(executeSearch());
};

// Exporter le reducer
export default searchSlice.reducer;
