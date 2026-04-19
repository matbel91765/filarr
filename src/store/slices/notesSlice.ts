/**
 * Notes Redux Slice — Filarr Notes
 *
 * Manages state for the knowledge-layer note system including:
 * - CRUD operations for notes
 * - Link resolution and backlinks
 * - Daily notes and templates
 * - Search, sort, and filter
 */

import { createSlice, createAsyncThunk, createSelector, PayloadAction } from '@reduxjs/toolkit';
import type { Note, NotesState, NoteTemplate, Notebook } from '../../types/notes';
import {
  createNote,
  createDailyNote,
  countWords,
  resolveLinks,
  getBuiltInTemplates,
  applyTemplateVariables,
  getTodayDateString,
} from '../../services/notes/noteService';
import type { RootState } from '../index';

// ==================== Initial State ====================

const initialState: NotesState = {
  byId: {},
  allIds: [],
  selectedNoteId: null,
  editingNoteId: null,
  templates: getBuiltInTemplates(),
  isLoading: false,
  error: null,
  viewMode: 'list',
  searchQuery: '',
  sortBy: 'updatedAt',
  sortOrder: 'desc',
  filterFolderId: null,
  filterDaily: false,
  notebooks: {},
  filterNotebookId: null,
  visitHistory: [],
};

// ==================== Async Thunks ====================

/** Create a new note */
export const createNewNote = createAsyncThunk(
  'notes/createNew',
  async (
    payload: {
      title?: string;
      parentId?: string | null;
      templateId?: string;
      variables?: Record<string, string>;
      content?: string;
    },
    { getState }
  ) => {
    const state = getState() as RootState;
    let content = payload.content || '';

    if (payload.templateId) {
      const template = state.notes.templates.find((t) => t.id === payload.templateId);
      if (template) {
        const vars = {
          title: payload.title || 'Untitled',
          date: new Date().toLocaleDateString('fr-FR'),
          ...payload.variables,
        };
        content = applyTemplateVariables(template.content, vars);
      }
    }

    const note = createNote({
      title: payload.title || '',
      parentId: payload.parentId ?? null,
      content,
      templateId: payload.templateId,
    });

    return note;
  }
);

/** Get or create today's daily note, carrying over incomplete tasks from yesterday */
export const getOrCreateDailyNote = createAsyncThunk(
  'notes/getOrCreateDaily',
  async (_: void, { getState }) => {
    const state = getState() as RootState;
    const today = getTodayDateString();

    // Check if a daily note already exists for today
    const existing = Object.values(state.notes.byId).find(
      (n) => n.isDaily && n.dailyDate === today && !n.deletedAt
    );

    if (existing) return existing;

    const note = createDailyNote(today);

    // Find the most recent previous daily note to carry over tasks
    const previousDailies = Object.values(state.notes.byId)
      .filter((n) => n.isDaily && n.dailyDate && n.dailyDate < today && !n.deletedAt)
      .sort((a, b) => (b.dailyDate || '').localeCompare(a.dailyDate || ''));

    const prevDaily = previousDailies[0];
    if (prevDaily?.content) {
      try {
        const doc = JSON.parse(prevDaily.content);
        // Extract unchecked taskItems from the previous daily note
        const uncheckedTasks: Array<{ type: string; content: any[] }> = [];
        const walkNodes = (nodes: any[]) => {
          for (const node of nodes) {
            if (node.type === 'taskItem' && node.attrs?.checked === false) {
              uncheckedTasks.push(node);
            }
            if (node.content) walkNodes(node.content);
          }
        };
        if (doc.content) walkNodes(doc.content);

        if (uncheckedTasks.length > 0) {
          // Build content with carried-over tasks
          const carryOverContent = {
            type: 'doc',
            content: [
              ...(JSON.parse(note.content || '{"type":"doc","content":[]}').content || []),
              {
                type: 'heading',
                attrs: { level: 2 },
                content: [{ type: 'text', text: 'Carried Over' }],
              },
              { type: 'taskList', content: uncheckedTasks },
            ],
          };
          note.content = JSON.stringify(carryOverContent);
        }
      } catch {
        // If parsing fails, create without carry-over
      }
    }

    return note;
  }
);

/** Load notes from encrypted disk storage */
export const loadNotesFromDisk = createAsyncThunk('notes/loadFromDisk', async () => {
  const data = await window.electron.ipcRenderer.invoke('notes:load');
  return data as {
    byId: Record<string, Note>;
    allIds: string[];
    templates?: NoteTemplate[];
    notebooks?: Record<string, Notebook>;
  } | null;
});

/** Save notes to encrypted disk storage (debounced externally) */
export const saveNotesToDisk = createAsyncThunk(
  'notes/saveToDisk',
  async (_: void, { getState }) => {
    const state = getState() as RootState;
    const { byId, allIds, templates, notebooks } = state.notes;
    await window.electron.ipcRenderer.invoke('notes:save', { byId, allIds, templates, notebooks });
  }
);

/**
 * Extract raw text (preserving [[wiki-links]]) from TipTap JSON content.
 * plainText has brackets stripped, so we need the raw text for link resolution.
 */
function extractRawTextFromContent(contentJson: string): string {
  try {
    const doc = JSON.parse(contentJson);
    const texts: string[] = [];
    function walk(node: any) {
      if (node.text) texts.push(node.text);
      if (node.content) node.content.forEach(walk);
    }
    walk(doc);
    return texts.join(' ');
  } catch {
    return '';
  }
}

/** Resolve all links in a note after content change */
export const resolveNoteLinks = createAsyncThunk(
  'notes/resolveLinks',
  async (noteId: string, { getState }) => {
    const state = getState() as RootState;
    const note = state.notes.byId[noteId];
    if (!note) throw new Error('Note not found');

    // Use raw text from TipTap JSON (preserves [[...]] brackets)
    // instead of plainText (which has brackets stripped by stripWikiLinks)
    const rawText = extractRawTextFromContent(note.content);

    const links = resolveLinks(rawText, state.notes.byId, state.files.byId, state.folders.byId);

    return { noteId, ...links };
  }
);

// ==================== Slice ====================

const notesSlice = createSlice({
  name: 'notes',
  initialState,
  reducers: {
    // ---- CRUD ----
    addNote(state, action: PayloadAction<Note>) {
      const note = action.payload;
      state.byId[note.id] = note;
      if (!state.allIds.includes(note.id)) {
        state.allIds.push(note.id);
      }
    },

    addNotesBatch(state, action: PayloadAction<Note[]>) {
      const existingIds = new Set(state.allIds);
      for (const note of action.payload) {
        state.byId[note.id] = note;
        if (!existingIds.has(note.id)) {
          state.allIds.push(note.id);
          existingIds.add(note.id);
        }
      }
    },

    updateNote(state, action: PayloadAction<{ id: string; changes: Partial<Note> }>) {
      const { id, changes } = action.payload;
      const note = state.byId[id];
      if (!note) return;

      Object.assign(note, changes, { updatedAt: new Date().toISOString() });

      // Update word count if content changed
      if (changes.plainText !== undefined) {
        note.wordCount = countWords(changes.plainText);
      }
    },

    updateNoteContent(
      state,
      action: PayloadAction<{ id: string; content: string; plainText: string }>
    ) {
      const { id, content, plainText } = action.payload;
      const note = state.byId[id];
      if (!note) return;

      note.content = content;
      note.plainText = plainText;
      note.wordCount = countWords(plainText);
      note.updatedAt = new Date().toISOString();
    },

    deleteNote(state, action: PayloadAction<string>) {
      const id = action.payload;
      const note = state.byId[id];
      if (!note) return;

      // Soft delete
      note.deletedAt = new Date().toISOString();

      if (state.selectedNoteId === id) state.selectedNoteId = null;
      if (state.editingNoteId === id) state.editingNoteId = null;
    },

    deleteAllNotes(state) {
      state.byId = {};
      state.allIds = [];
      state.selectedNoteId = null;
      state.editingNoteId = null;
    },

    deleteNotesBatch(state, action: PayloadAction<string[]>) {
      const idsToDelete = new Set(action.payload);
      for (const id of idsToDelete) {
        delete state.byId[id];
      }
      state.allIds = state.allIds.filter((id) => !idsToDelete.has(id));
      if (state.selectedNoteId && idsToDelete.has(state.selectedNoteId))
        state.selectedNoteId = null;
      if (state.editingNoteId && idsToDelete.has(state.editingNoteId)) state.editingNoteId = null;
    },

    permanentlyDeleteNote(state, action: PayloadAction<string>) {
      const id = action.payload;
      delete state.byId[id];
      state.allIds = state.allIds.filter((nid) => nid !== id);

      if (state.selectedNoteId === id) state.selectedNoteId = null;
      if (state.editingNoteId === id) state.editingNoteId = null;
    },

    permanentlyDeleteAllNotes(state) {
      state.byId = {};
      state.allIds = [];
      state.selectedNoteId = null;
      state.editingNoteId = null;
    },

    deleteNotesByFolder(state, action: PayloadAction<string>) {
      const folderId = action.payload;
      for (const note of Object.values(state.byId)) {
        if (note.parentId === folderId && !note.deletedAt) {
          note.deletedAt = new Date().toISOString();
        }
      }
      if (state.selectedNoteId && state.byId[state.selectedNoteId]?.parentId === folderId) {
        state.selectedNoteId = null;
        state.editingNoteId = null;
      }
    },

    permanentlyDeleteNotesByFolder(state, action: PayloadAction<string>) {
      const folderId = action.payload;
      const toRemove = Object.keys(state.byId).filter((id) => state.byId[id].parentId === folderId);
      for (const id of toRemove) {
        delete state.byId[id];
      }
      state.allIds = state.allIds.filter((id) => !toRemove.includes(id));
      if (state.selectedNoteId && toRemove.includes(state.selectedNoteId)) {
        state.selectedNoteId = null;
        state.editingNoteId = null;
      }
    },

    restoreNote(state, action: PayloadAction<string>) {
      const note = state.byId[action.payload];
      if (note) {
        delete note.deletedAt;
      }
    },

    // ---- Selection / Editing ----
    selectNote(state, action: PayloadAction<string | null>) {
      state.selectedNoteId = action.payload;
    },

    setEditingNote(state, action: PayloadAction<string | null>) {
      state.editingNoteId = action.payload;
      // Track visit history for breadcrumb navigation
      if (action.payload) {
        if (!state.visitHistory) state.visitHistory = [];
        const filtered = state.visitHistory.filter((id) => id !== action.payload);
        filtered.push(action.payload);
        // Keep last 10
        state.visitHistory = filtered.slice(-10);
      }
    },

    // ---- Pin ----
    togglePinNote(state, action: PayloadAction<string>) {
      const note = state.byId[action.payload];
      if (note) note.isPinned = !note.isPinned;
    },

    // ---- Links ----
    setNoteLinks(
      state,
      action: PayloadAction<{
        noteId: string;
        linkedNoteIds: string[];
        linkedFileIds: string[];
        linkedFolderIds: string[];
      }>
    ) {
      const { noteId, linkedNoteIds, linkedFileIds, linkedFolderIds } = action.payload;
      const note = state.byId[noteId];
      if (!note) return;
      note.linkedNoteIds = linkedNoteIds;
      note.linkedFileIds = linkedFileIds;
      note.linkedFolderIds = linkedFolderIds;
    },

    // ---- View / Filters ----
    setNotesViewMode(state, action: PayloadAction<NotesState['viewMode']>) {
      state.viewMode = action.payload;
    },

    setNotesSearchQuery(state, action: PayloadAction<string>) {
      state.searchQuery = action.payload;
    },

    setNotesSortBy(state, action: PayloadAction<NotesState['sortBy']>) {
      state.sortBy = action.payload;
    },

    setNotesSortOrder(state, action: PayloadAction<NotesState['sortOrder']>) {
      state.sortOrder = action.payload;
    },

    setNotesFilterFolderId(state, action: PayloadAction<string | null>) {
      state.filterFolderId = action.payload;
    },

    setNotesFilterDaily(state, action: PayloadAction<boolean>) {
      state.filterDaily = action.payload;
    },

    // ---- Tags ----
    addTagToNote(state, action: PayloadAction<{ noteId: string; tagId: string }>) {
      const note = state.byId[action.payload.noteId];
      if (!note) return;
      if (!note.tagIds) note.tagIds = [];
      if (!note.tagIds.includes(action.payload.tagId)) {
        note.tagIds.push(action.payload.tagId);
        note.updatedAt = new Date().toISOString();
      }
    },

    removeTagFromNote(state, action: PayloadAction<{ noteId: string; tagId: string }>) {
      const note = state.byId[action.payload.noteId];
      if (!note || !note.tagIds) return;
      note.tagIds = note.tagIds.filter((id) => id !== action.payload.tagId);
      note.updatedAt = new Date().toISOString();
    },

    // ---- Notebooks ----
    addNotebook(state, action: PayloadAction<{ name: string; color?: string; icon?: string }>) {
      const id = `nb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      state.notebooks[id] = {
        id,
        name: action.payload.name,
        color: action.payload.color,
        icon: action.payload.icon,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    },

    updateNotebook(state, action: PayloadAction<{ id: string; changes: Partial<Notebook> }>) {
      const nb = state.notebooks[action.payload.id];
      if (nb) Object.assign(nb, action.payload.changes, { updatedAt: new Date().toISOString() });
    },

    deleteNotebook(state, action: PayloadAction<string>) {
      delete state.notebooks[action.payload];
      for (const note of Object.values(state.byId)) {
        if (note.notebookId === action.payload) note.notebookId = undefined;
      }
      if (state.filterNotebookId === action.payload) state.filterNotebookId = null;
    },

    setNoteNotebook(state, action: PayloadAction<{ noteId: string; notebookId: string | null }>) {
      const note = state.byId[action.payload.noteId];
      if (note) {
        note.notebookId = action.payload.notebookId || undefined;
        note.updatedAt = new Date().toISOString();
      }
    },

    setNotesFilterNotebook(state, action: PayloadAction<string | null>) {
      state.filterNotebookId = action.payload;
    },

    // ---- Templates ----
    addTemplate(state, action: PayloadAction<NoteTemplate>) {
      state.templates.push(action.payload);
    },

    removeTemplate(state, action: PayloadAction<string>) {
      state.templates = state.templates.filter((t) => t.id !== action.payload);
    },
  },

  extraReducers: (builder) => {
    builder
      // createNewNote
      .addCase(createNewNote.fulfilled, (state, action) => {
        const note = action.payload;
        state.byId[note.id] = note;
        if (!state.allIds.includes(note.id)) {
          state.allIds.push(note.id);
        }
        state.selectedNoteId = note.id;
        state.editingNoteId = note.id;
      })

      // getOrCreateDailyNote
      .addCase(getOrCreateDailyNote.fulfilled, (state, action) => {
        const note = action.payload;
        if (!state.byId[note.id]) {
          state.byId[note.id] = note;
          if (!state.allIds.includes(note.id)) {
            state.allIds.push(note.id);
          }
        }
        state.selectedNoteId = note.id;
        state.editingNoteId = note.id;
      })

      // resolveNoteLinks
      .addCase(resolveNoteLinks.fulfilled, (state, action) => {
        const { noteId, linkedNoteIds, linkedFileIds, linkedFolderIds } = action.payload;
        const note = state.byId[noteId];
        if (!note) return;
        note.linkedNoteIds = linkedNoteIds;
        note.linkedFileIds = linkedFileIds;
        note.linkedFolderIds = linkedFolderIds;
      })

      // loadNotesFromDisk
      .addCase(loadNotesFromDisk.pending, (state) => {
        state.isLoading = true;
      })
      .addCase(loadNotesFromDisk.fulfilled, (state, action) => {
        state.isLoading = false;
        if (action.payload) {
          state.byId = action.payload.byId ?? {};
          state.allIds = action.payload.allIds ?? [];
          if (action.payload.templates?.length) {
            // Merge: keep built-in templates, add user-saved ones
            const builtInIds = new Set(getBuiltInTemplates().map((t) => t.id));
            const userTemplates = action.payload.templates.filter((t) => !builtInIds.has(t.id));
            state.templates = [...getBuiltInTemplates(), ...userTemplates];
          }
          if (action.payload.notebooks) {
            state.notebooks = action.payload.notebooks;
          }
        }
        // Only clear the open-note pointers if the note the user is
        // currently looking at doesn't exist anymore in the reloaded
        // set. Nulling them unconditionally would unmount NoteEditor
        // on every sync tick — losing transient UI state like the
        // version-history panel.
        if (state.selectedNoteId && !state.byId[state.selectedNoteId]) {
          state.selectedNoteId = null;
        }
        if (state.editingNoteId && !state.byId[state.editingNoteId]) {
          state.editingNoteId = null;
        }
      })
      .addCase(loadNotesFromDisk.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.error.message || 'Failed to load notes';
      });
  },
});

// ==================== Exports ====================

export const {
  addNote,
  addNotesBatch,
  updateNote,
  updateNoteContent,
  deleteNote,
  deleteAllNotes,
  deleteNotesBatch,
  permanentlyDeleteNote,
  permanentlyDeleteAllNotes,
  deleteNotesByFolder,
  permanentlyDeleteNotesByFolder,
  restoreNote,
  selectNote,
  setEditingNote,
  togglePinNote,
  setNoteLinks,
  setNotesViewMode,
  setNotesSearchQuery,
  setNotesSortBy,
  setNotesSortOrder,
  setNotesFilterFolderId,
  setNotesFilterDaily,
  addTagToNote,
  removeTagFromNote,
  addNotebook,
  updateNotebook,
  deleteNotebook,
  setNoteNotebook,
  setNotesFilterNotebook,
  addTemplate,
  removeTemplate,
} = notesSlice.actions;

// ==================== Selectors ====================

const selectNotesById = (state: RootState) => state.notes.byId;
const selectNotesAllIds = (state: RootState) => state.notes.allIds;
const selectNotesSearchQuery = (state: RootState) => state.notes.searchQuery;
const selectNotesFilterFolderId = (state: RootState) => state.notes.filterFolderId;
const selectNotesFilterDaily = (state: RootState) => state.notes.filterDaily;
const selectNotesSortBy = (state: RootState) => state.notes.sortBy;
const selectNotesSortOrder = (state: RootState) => state.notes.sortOrder;

export const selectAllNotes = createSelector(
  [selectNotesById, selectNotesAllIds],
  (byId, allIds): Note[] =>
    allIds.map((id) => byId[id]).filter((n): n is Note => !!n && !n.deletedAt)
);

export const selectNoteById = (state: RootState, id: string): Note | undefined =>
  state.notes.byId[id];

export const selectSelectedNote = createSelector(
  [selectNotesById, (state: RootState) => state.notes.selectedNoteId],
  (byId, selectedNoteId): Note | undefined => (selectedNoteId ? byId[selectedNoteId] : undefined)
);

export const selectEditingNote = createSelector(
  [selectNotesById, (state: RootState) => state.notes.editingNoteId],
  (byId, editingNoteId): Note | undefined => (editingNoteId ? byId[editingNoteId] : undefined)
);

const selectNotesFilterNotebookId = (state: RootState) => state.notes.filterNotebookId;

export const selectFilteredNotes = createSelector(
  [
    selectAllNotes,
    selectNotesSearchQuery,
    selectNotesFilterFolderId,
    selectNotesFilterDaily,
    selectNotesSortBy,
    selectNotesSortOrder,
    selectNotesFilterNotebookId,
  ],
  (
    allNotes,
    searchQuery,
    filterFolderId,
    filterDaily,
    sortBy,
    sortOrder,
    filterNotebookId
  ): Note[] => {
    let notes = allNotes;

    if (filterNotebookId) {
      notes = notes.filter((n) => n.notebookId === filterNotebookId);
    }

    if (filterFolderId) {
      notes = notes.filter((n) => n.parentId === filterFolderId);
    }

    if (filterDaily) {
      notes = notes.filter((n) => n.isDaily);
    }

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      notes = notes.filter(
        (n) => n.title.toLowerCase().includes(q) || n.plainText.toLowerCase().includes(q)
      );
    }

    // Sort — pinned always first
    const sorted = [...notes].sort((a, b) => {
      if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;

      let cmp = 0;
      switch (sortBy) {
        case 'title':
          cmp = a.title.localeCompare(b.title);
          break;
        case 'createdAt':
          cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
          break;
        case 'wordCount':
          cmp = a.wordCount - b.wordCount;
          break;
        case 'updatedAt':
        default:
          cmp = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
          break;
      }
      return sortOrder === 'asc' ? cmp : -cmp;
    });

    return sorted;
  }
);

export const selectDailyNotes = createSelector([selectAllNotes], (allNotes): Note[] =>
  allNotes.filter((n) => n.isDaily)
);

export const selectNotesCount = createSelector(
  [selectAllNotes],
  (allNotes): number => allNotes.length
);

export const selectNoteTemplates = (state: RootState): NoteTemplate[] => state.notes.templates;

/** Select notes that have no incoming or outgoing note links */
export const selectOrphanNoteIds = createSelector(
  [selectNotesById, selectNotesAllIds],
  (byId, allIds): Set<string> => {
    const orphans = new Set<string>();
    const activeNotes = allIds.filter((id) => byId[id] && !byId[id].deletedAt);

    for (const id of activeNotes) {
      const note = byId[id];
      if (!note) continue;
      // Has outgoing note links?
      if (note.linkedNoteIds.length > 0) continue;
      // Has incoming note links?
      const hasBacklink = activeNotes.some(
        (otherId) => otherId !== id && byId[otherId]?.linkedNoteIds.includes(id)
      );
      if (!hasBacklink) orphans.add(id);
    }
    return orphans;
  }
);

/** Select breadcrumb visit history as Note objects */
export const selectVisitHistory = createSelector(
  [selectNotesById, (state: RootState) => state.notes.visitHistory],
  (byId, history): Note[] =>
    (history || []).map((id) => byId[id]).filter((n): n is Note => !!n && !n.deletedAt)
);

/** Select all notebooks sorted by name */
export const selectAllNotebooks = createSelector(
  [(state: RootState) => state.notes.notebooks],
  (notebooks): Notebook[] => Object.values(notebooks).sort((a, b) => a.name.localeCompare(b.name))
);

export type { NotesState };
export default notesSlice.reducer;
