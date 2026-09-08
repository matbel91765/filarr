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
import type {
  Note,
  NoteComment,
  NoteShareRef,
  NotesState,
  NoteTemplate,
  Notebook,
} from '../../types/notes';
// Module PUR : la tenue de la liste des dépôts en coffre ne connaît pas Redux
import { removeShareRef, upsertShareRef } from '../../services/notes/noteShareModel';
import {
  createNote,
  createDailyNote,
  countWords,
  resolveLinks,
  getBuiltInTemplates,
  applyTemplateVariables,
  getTodayDateString,
} from '../../services/notes/noteService';
import { compareNotebookSiblings } from '../../services/notes/notebookOrder';
import { findSuspectNotes } from '../../services/notes/ghostNotes';
import type { SuspectNote } from '../../services/notes/ghostNotes';
import { listConflictResolutions } from '../../services/notes/conflictResolution';
import type { ConflictResolution } from '../../services/notes/conflictResolution';
import type { RootState } from '../index';
// Module PUR (aucune dépendance) : la constante est importée plutôt que
// recopiée pour que la fenêtre d'oubli des pierres tombales ne puisse pas
// diverger entre le producteur (ce slice) et le consommateur (la fusion).
import { PURGE_TOMBSTONE_TTL_MS } from '../../platform/web/sync/notesMerge';
// Module PUR lui aussi : la collecte des bases inline ne connaît ni Redux ni React
import {
  createInlineDbCollector,
  restampCopiedDbIds,
} from '../../renderer/components/notes/extensions/inlineDatabase/dbIndex';
import type { InlineDbIndexEntry } from '../../renderer/components/notes/extensions/inlineDatabase/dbIndex';

// ==================== Purge tombstones ====================

/**
 * Inscrit des ids au registre des suppressions DÉFINITIVES et oublie les
 * pierres périmées.
 *
 * Un vrai `delete` ne laisse aucune trace : la fusion avec le nuage réunit les
 * deux stores et fait revenir la note au cycle suivant, indéfiniment. La pierre
 * dit « purgée à telle heure » ; la fusion écarte alors l'entrée d'en face si
 * elle est plus ancienne que la purge (voir notesMerge). Sans expiration, le
 * registre grossirait à chaque suppression définitive, pour toujours.
 */
function markPurged(registry: Record<string, string>, ids: Iterable<string>, nowIso: string): void {
  const floor = Date.parse(nowIso) - PURGE_TOMBSTONE_TTL_MS;
  for (const [id, at] of Object.entries(registry)) {
    const ms = Date.parse(at);
    if (Number.isNaN(ms) || ms < floor) delete registry[id];
  }
  for (const id of ids) registry[id] = nowIso;
}

// ==================== Dépôts en coffre ====================
//
// AUCUN RETRAIT AUTOMATIQUE d'un dépôt (`sharedTo`) quand un élément de coffre
// est supprimé — c'est une décision, pas un oubli. Une première version
// écoutait `vaults/deleteItem/fulfilled` et `vaults/deleteItems/fulfilled` pour
// retirer le marqueur ; or ces thunks sont une suppression DOUCE (corbeille du
// coffre, 30 jours, `apiRestoreVaultItem` la ressuscite) : un marqueur retiré à
// ce moment-là ne serait jamais recréé par la restauration, et la note aurait
// perdu son lien pour un geste réversible. Le badge, lui, sait déjà dire
// « copie manquante » tant que l'élément est en corbeille (il quitte
// `itemsByVault`, et le serveur ne le liste plus) et revient à « visible » dès
// qu'il en sort — sans qu'on touche à la note (`noteShareModel`, règle 6).
//
// La purge DÉFINITIVE n'a pas d'action côté client : c'est un cron du Worker
// (`gcDeletedVaultItems`) qui détruit les octets à l'expiration du sursis. Il
// n'existe donc aucun événement Redux auquel accrocher un retrait — le seul
// chemin reste le geste manuel `removeNoteShareRef`, ou la disparition
// constatée par le badge (`copyMissing`) que l'utilisateur tranche lui-même.

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
  filterUnfiled: false,
  filterShared: false,
  notebooks: {},
  filterNotebookId: null,
  visitHistory: [],
  saveStatus: 'synced',
  lastSavedAt: null,
  pendingScrollToHeading: null,
  purged: {},
  purgedNotebooks: {},
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
      // Les modèles INTÉGRÉS sont relus à neuf : leur contenu est traduit à la
      // construction, et celui figé dans l'état peut dater d'avant un
      // changement de langue. Les modèles de l'utilisateur, eux, ne vivent que
      // dans l'état — d'où le repli.
      const template =
        getBuiltInTemplates().find((t) => t.id === payload.templateId) ??
        state.notes.templates.find((t) => t.id === payload.templateId);
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
      // Note dupliquée ou modèle appliqué : le contenu est une COPIE, et deux
      // bases de données inline ne peuvent pas porter la même identité — une
      // relation viserait l'une et lirait l'autre. Sans base inline dedans, le
      // contenu ressort tel quel.
      content: restampCopiedDbIds(content),
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
    /** Registres de purge — doivent faire l'aller-retour, sinon la prochaine
     *  sauvegarde les efface du disque et les notes purgées ressuscitent. */
    purged?: Record<string, string>;
    purgedNotebooks?: Record<string, string>;
  } | null;
});

/**
 * Save notes to encrypted disk storage (debounced externally).
 *
 * `skipVersioning` is for bulk writers only (external import): snapshotting
 * thousands of freshly imported notes costs a hash-and-write per note for a
 * "previous version" that never existed. Normal edits must leave it unset.
 *
 * `delta` — LA SEULE OPTIMISATION QUI COMPTE ICI. Sans elle, chaque écriture
 * envoie le coffre ENTIER : sur 70 Mo (images en data-URL), la sérialisation est
 * payée deux fois côté renderer (contextBridge puis IPC) et fige le fil
 * d'exécution ~100 ms, pile pendant le clic qui suit un glissement (le debounce
 * de 2 s de l'auto-save d'App.tsx tombe là). Avec elle, seules les notes
 * réellement touchées traversent le pont — quelques Ko pour un déplacement.
 *
 * Le format du fichier ne change PAS : le processus principal applique le delta
 * à sa copie du coffre et rescelle le même objet complet. Et si quoi que ce soit
 * l'en empêche (pas encore de fichier, base illisible, canal absent d'un preload
 * plus ancien), il répond `needsFull` et on retombe SUR-LE-CHAMP sur l'écriture
 * pleine : jamais d'état partiel sur le disque.
 */
export const saveNotesToDisk = createAsyncThunk(
  'notes/saveToDisk',
  async (
    options: {
      skipVersioning?: boolean;
      delta?: {
        dirtyIds: string[];
        removedIds: string[];
        /**
         * Par note sale, l'`updatedAt` dont la modification est partie. Le main
         * s'en sert pour REFUSER une écriture que le disque a devancée — voir
         * `selectStaleDeltaEntries`. Omis = aucune garde (comportement d'avant).
         */
        baseUpdatedAt?: Record<string, string | null>;
      };
    } | void,
    { getState }
  ) => {
    const state = getState() as RootState;
    const { byId, allIds, templates, notebooks, purged, purgedNotebooks } = state.notes;
    // Registres de purge omis tant qu'ils sont vides : ajouter un champ que
    // le payload d'en face n'a pas fait voir une différence à chaque fusion.
    const registres = {
      ...(purged && Object.keys(purged).length > 0 ? { purged } : {}),
      ...(purgedNotebooks && Object.keys(purgedNotebooks).length > 0 ? { purgedNotebooks } : {}),
    };
    const skipVersioning = options?.skipVersioning === true;

    const delta = options?.delta;
    if (delta) {
      // On relit l'état COURANT : entre le moment où une note a été marquée sale
      // et cette écriture, elle a pu être modifiée encore (on envoie la dernière
      // version) ou supprimée définitivement (elle sort d'elle-même).
      const dirtyById: Record<string, Note> = {};
      for (const id of delta.dirtyIds) {
        const note = byId[id];
        if (note) dirtyById[id] = note;
      }
      // Une « suppression » dont la note est revenue (recréation du même id)
      // n'en est pas une : elle est alors dans `dirtyById` et sera réécrite.
      const removedIds = delta.removedIds.filter((id) => !byId[id]);
      // Une base ne voyage QUE si sa note part avec : `dirtyIds` peut citer une
      // note disparue de `byId` entre le marquage et l'écriture, et déclarer une
      // base pour une note absente du delta n'aurait aucun sens côté main.
      const baseUpdatedAt: Record<string, string | null> = {};
      if (delta.baseUpdatedAt) {
        for (const id of Object.keys(dirtyById)) {
          if (Object.prototype.hasOwnProperty.call(delta.baseUpdatedAt, id)) {
            baseUpdatedAt[id] = delta.baseUpdatedAt[id];
          }
        }
      }
      try {
        const result = (await window.electron.ipcRenderer.invoke('notes:saveDelta', {
          dirtyById,
          removedIds,
          baseUpdatedAt,
          allIds,
          templates,
          notebooks,
          ...registres,
          skipVersioning,
        })) as { ok?: boolean; needsFull?: boolean } | undefined;
        if (result?.ok) return;
        // REFUS DÉLIBÉRÉ du main (garde anti-vidage). Rien n'est parti sur le
        // disque : il faut le DIRE. Rendre ici comme si tout allait bien
        // affichait « Enregistré » sur une note non écrite, ET faisait oublier
        // les marques de saleté — la modification n'était même plus retentée.
        if (result && result.ok === false && result.needsFull !== true) {
          throw new Error('notes:saveDelta refused (anti-wipe guard)');
        }
      } catch {
        /* canal indisponible (preload antérieur) → écriture pleine ci-dessous */
      }
    }

    // Le principal rend `false` quand il REFUSE d'écrire (état vide face à un
    // notes.enc plein). Ignorer ce retour — ce que ce code faisait — revenait à
    // annoncer un enregistrement qui n'a pas eu lieu.
    const written = await window.electron.ipcRenderer.invoke('notes:save', {
      byId,
      allIds,
      templates,
      notebooks,
      ...registres,
      skipVersioning,
    });
    if (written === false) {
      throw new Error('notes:save refused (anti-wipe guard)');
    }
  }
);

/**
 * Extract raw text (preserving [[wiki-links]]) from TipTap JSON content.
 * plainText has brackets stripped, so we need the raw text for link resolution.
 * Exporté : GraphView s'en sert pour détecter les cibles de liens NON
 * résolues avec exactement la même extraction que `resolveNoteLinks`.
 */
export function extractRawTextFromContent(contentJson: string): string {
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

      // L'HORLOGE NE BOUGE QUE SI QUELQUE CHOSE BOUGE. `updatedAt` est ce que
      // la fusion nuage compare, appareil contre appareil : ré-estampiller une
      // note inchangée la fait GAGNER contre une version réellement plus
      // récente d'en face — un vieux contenu daté d'aujourd'hui écrase une
      // vraie modification, sans conflit ni trace. Voir aussi
      // updateNoteContent.
      const touched = Object.entries(changes).some(
        ([key, value]) =>
          key !== 'updatedAt' && !Object.is((note as Record<string, unknown>)[key], value)
      );
      if (!touched) return;

      Object.assign(note, changes, { updatedAt: new Date().toISOString() });

      // Update word count if content changed
      if (changes.plainText !== undefined) {
        note.wordCount = countWords(changes.plainText);
      }
    },

    /**
     * GÉOMÉTRIE D'ÉCRAN ≠ ÉDITION.
     *
     * Position et taille d'une note sur un canevas (vue sticky) ne sont pas du
     * contenu. Les faire passer par `updateNote` bousculait `updatedAt` à chaque
     * relâchement de souris, avec quatre conséquences bien réelles :
     *  - le tri par défaut de la liste EST `updatedAt` : déplacer une note la
     *    faisait sauter en tête et re-empilait tout l'ordre z sous le curseur ;
     *  - chaque déplacement traversait l'historique de versions (hachage +
     *    écriture) alors que rien du texte n'avait bougé ;
     *  - chaque déplacement partait vers le nuage ;
     *  - dans l'arbitrage LWW du nuage, un simple glissement GAGNAIT contre une
     *    vraie édition faite ailleurs.
     *
     * Contrepartie assumée : sans `updatedAt`, un déplacement seul ne se
     * propage pas aux autres appareils tant qu'aucune édition réelle ne suit.
     * La sauvegarde sur disque part quand même — l'auto-save observe `byId`,
     * dont Immer renouvelle l'identité dès qu'une note est touchée.
     */
    setNoteViewGeometry(
      state,
      action: PayloadAction<{
        id: string;
        viewPositions?: Record<string, { x: number; y: number }>;
        viewSizes?: Record<string, { w: number; h: number }>;
      }>
    ) {
      const { id, viewPositions, viewSizes } = action.payload;
      const note = state.byId[id];
      if (!note) return;
      if (viewPositions) note.viewPositions = viewPositions;
      if (viewSizes) note.viewSizes = viewSizes;
    },

    /**
     * La MÊME chose, pour plusieurs notes à la fois — mêmes garanties, au mot
     * près : n'écrit QUE la géométrie, ne touche JAMAIS `updatedAt` (voir
     * `setNoteViewGeometry` ci-dessus pour les quatre dégâts que cela évite).
     *
     * Existe parce qu'un glissement de GROUPE ou un « Ranger le tableau » doit
     * atterrir en UNE action : cinquante `setNoteViewGeometry` d'affilée, c'est
     * cinquante notifications d'abonnés, cinquante rendus de la vue et cinquante
     * entrées dans l'outil de développement pour un seul relâchement de souris.
     */
    setManyNoteViewGeometry(
      state,
      action: PayloadAction<
        Array<{
          id: string;
          viewPositions?: Record<string, { x: number; y: number }>;
          viewSizes?: Record<string, { w: number; h: number }>;
        }>
      >
    ) {
      for (const entry of action.payload) {
        const note = state.byId[entry.id];
        if (!note) continue;
        if (entry.viewPositions) note.viewPositions = entry.viewPositions;
        if (entry.viewSizes) note.viewSizes = entry.viewSizes;
      }
    },

    updateNoteContent(
      state,
      action: PayloadAction<{ id: string; content: string; plainText: string }>
    ) {
      const { id, content, plainText } = action.payload;
      const note = state.byId[id];
      if (!note) return;
      // Même contenu, même texte : rien n'a bougé, l'horloge non plus.
      // L'éditeur repasse par ici sans changement (normalisations à
      // l'ouverture, purge au blur, rejeu) : chacun de ces passages datait la
      // note d'aujourd'hui et lui faisait gagner l'arbitrage contre une
      // version plus récente venue d'un autre appareil.
      if (note.content === content && note.plainText === plainText) return;

      note.content = content;
      note.plainText = plainText;
      note.wordCount = countWords(plainText);
      note.updatedAt = new Date().toISOString();
    },

    /**
     * LES COMMENTAIRES SONT DES DONNÉES, pas de l'état d'écran. Chacune de ces
     * trois mutations bouscule `updatedAt` : c'est l'horloge que la fusion
     * nuage compare — un commentaire posé sans elle se fait écraser par
     * l'appareil d'en face au cycle suivant.
     */
    upsertNoteComment(state, action: PayloadAction<{ noteId: string; comment: NoteComment }>) {
      const note = state.byId[action.payload.noteId];
      if (!note) return;
      note.comments = {
        ...(note.comments ?? {}),
        [action.payload.comment.id]: action.payload.comment,
      };
      note.updatedAt = new Date().toISOString();
    },

    resolveNoteComment(state, action: PayloadAction<{ noteId: string; commentId: string }>) {
      const note = state.byId[action.payload.noteId];
      const comment = note?.comments?.[action.payload.commentId];
      if (!note || !comment) return;
      note.comments = { ...note.comments, [comment.id]: { ...comment, resolved: true } };
      note.updatedAt = new Date().toISOString();
    },

    deleteNoteComment(state, action: PayloadAction<{ noteId: string; commentId: string }>) {
      const note = state.byId[action.payload.noteId];
      if (!note?.comments?.[action.payload.commentId]) return;
      const { [action.payload.commentId]: _retire, ...reste } = note.comments;
      note.comments = reste;
      note.updatedAt = new Date().toISOString();
    },

    deleteNote(state, action: PayloadAction<string>) {
      const id = action.payload;
      const note = state.byId[id];
      if (!note) return;

      // Suppression douce. `updatedAt` est bousculé EN MÊME TEMPS que
      // `deletedAt` : c'est l'horloge que la synchronisation compare d'un
      // appareil à l'autre, et une mutation qui la laisse en arrière se fait
      // annuler par l'état d'en face au cycle suivant.
      const now = new Date().toISOString();
      note.deletedAt = now;
      note.updatedAt = now;

      if (state.selectedNoteId === id) state.selectedNoteId = null;
      if (state.editingNoteId === id) state.editingNoteId = null;
    },

    deleteAllNotes(state) {
      state.byId = {};
      state.allIds = [];
      state.selectedNoteId = null;
      state.editingNoteId = null;
    },

    /**
     * Soft-delete a batch of notes — sets `deletedAt` on each so they
     * disappear from default views but can still be restored from the
     * trash. Previously this reducer hard-deleted via
     * `delete state.byId[id]`, which silently destroyed user data on
     * multi-select delete and bypassed the `restoreNote` flow.
     */
    deleteNotesBatch(state, action: PayloadAction<string[]>) {
      const idsToDelete = new Set(action.payload);
      const now = new Date().toISOString();
      for (const id of idsToDelete) {
        const note = state.byId[id];
        if (note && !note.deletedAt) {
          note.deletedAt = now;
          note.updatedAt = now; // horloge de synchronisation — voir deleteNote
        }
      }
      if (state.selectedNoteId && idsToDelete.has(state.selectedNoteId))
        state.selectedNoteId = null;
      if (state.editingNoteId && idsToDelete.has(state.editingNoteId)) state.editingNoteId = null;
    },

    /**
     * Permanently delete a batch of notes — for use from the trash UI
     * after the user explicitly confirms. Mirrors `permanentlyDeleteNote`
     * but for many ids at once.
     */
    permanentlyDeleteNotesBatch(state, action: PayloadAction<string[]>) {
      const idsToDelete = new Set(action.payload);
      for (const id of idsToDelete) {
        delete state.byId[id];
      }
      if (!state.purged) state.purged = {};
      markPurged(state.purged, idsToDelete, new Date().toISOString());
      state.allIds = state.allIds.filter((id) => !idsToDelete.has(id));
      if (state.selectedNoteId && idsToDelete.has(state.selectedNoteId))
        state.selectedNoteId = null;
      if (state.editingNoteId && idsToDelete.has(state.editingNoteId)) state.editingNoteId = null;
    },

    permanentlyDeleteNote(state, action: PayloadAction<string>) {
      const id = action.payload;
      delete state.byId[id];
      // Pierre tombale DURABLE : sans elle, la fusion avec le nuage réunit les
      // deux stores et la note purgée revient au cycle suivant.
      if (!state.purged) state.purged = {};
      markPurged(state.purged, [id], new Date().toISOString());
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
      const now = new Date().toISOString();
      for (const note of Object.values(state.byId)) {
        if (note.parentId === folderId && !note.deletedAt) {
          note.deletedAt = now;
          note.updatedAt = now; // horloge de synchronisation — voir deleteNote
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
      if (!state.purged) state.purged = {};
      markPurged(state.purged, toRemove, new Date().toISOString());
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
        // La restauration DOIT bousculer l'horloge : sinon la tombstone d'en
        // face (dont l'horloge inclut son `deletedAt`) reste la plus récente et
        // la note repart à la corbeille au cycle de synchronisation suivant —
        // la restauration était purement locale et éphémère.
        note.updatedAt = new Date().toISOString();
      }
    },

    // ---- Dépôt en coffre partagé ----

    /**
     * Inscrit un dépôt sur la note (voir `NoteShareRef` : copie DIVERGENTE,
     * jamais synchronisée). Dédoublonné par (vaultId, itemId) via le module pur.
     *
     * `updatedAt` est BOUSCULÉ, comme dans `deleteNote` : c'est l'horloge que la
     * fusion nuage compare, et un marqueur posé sans elle ne quitte jamais cet
     * appareil — l'état d'en face, plus « récent », l'écraserait au cycle
     * suivant, et l'autre ordinateur ne saurait jamais que la note vit aussi
     * dans un coffre. Le prix (la note remonte en tête du tri par date) est
     * juste : déposer une note dans un coffre EST un acte sur cette note.
     */
    markNoteSharedToVault(state, action: PayloadAction<{ noteId: string } & NoteShareRef>) {
      const { noteId, vaultId, itemId, mode, at } = action.payload;
      const note = state.byId[noteId];
      if (!note) return;
      note.sharedTo = upsertShareRef(note.sharedTo, { vaultId, itemId, mode, at });
      note.updatedAt = new Date().toISOString();
    },

    /**
     * Retire un dépôt (l'utilisateur a supprimé la copie depuis l'écran des
     * coffres, ou veut simplement oublier le lien). Si c'était le dernier, le
     * champ disparaît : « plus déposée nulle part » se persiste comme « jamais
     * déposée », par l'absence — un tableau vide serait une troisième forme à
     * gérer partout. Horloge bousculée pour la même raison que ci-dessus.
     */
    removeNoteShareRef(
      state,
      action: PayloadAction<{ noteId: string; vaultId: string; itemId: string }>
    ) {
      const { noteId, vaultId, itemId } = action.payload;
      const note = state.byId[noteId];
      if (!note?.sharedTo) return;
      const next = removeShareRef(note.sharedTo, { vaultId, itemId });
      if (next.length === note.sharedTo.length) return; // rien à retirer : pas de coup d'horloge
      if (next.length === 0) delete note.sharedTo;
      else note.sharedTo = next;
      note.updatedAt = new Date().toISOString();
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

    /**
     * Ne montrer que les notes rangées NULLE PART (aucun dossier, et pas une
     * note quotidienne). C'est la destination du bouton « Voir les N notes sans
     * dossier » de l'accueil : sans lui, ce bouton menait à la liste complète,
     * où les notes qu'il désignait redevenaient introuvables.
     */
    setNotesFilterUnfiled(state, action: PayloadAction<boolean>) {
      state.filterUnfiled = action.payload;
      // Même exclusivité que carnet ↔ sans dossier : « sans dossier » ET
      // « partagées » actifs ensemble donneraient leur intersection.
      if (action.payload) state.filterShared = false;
    },

    /**
     * Ne montrer que les notes DÉPOSÉES dans un coffre (`sharedTo` non vide).
     * Troisième vue EXCLUSIVE de la barre latérale : l'activer quitte le carnet
     * et la vue « sans dossier », et inversement — la palette la déclenche
     * seule, sans que l'hôte ait à défaire les autres filtres avant.
     */
    setNotesFilterShared(state, action: PayloadAction<boolean>) {
      state.filterShared = action.payload;
      if (action.payload) {
        state.filterUnfiled = false;
        state.filterNotebookId = null;
      }
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
    addNotebook(
      state,
      action: PayloadAction<{
        name: string;
        color?: string;
        icon?: string;
        parentId?: string | null;
      }>
    ) {
      const id = `nb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const parentId = action.payload.parentId ?? null;
      state.notebooks[id] = {
        id,
        name: action.payload.name,
        color: action.payload.color,
        icon: action.payload.icon,
        // Ignore a parent that no longer exists rather than creating an
        // orphan the sidebar would never render.
        parentId: parentId && state.notebooks[parentId] ? parentId : null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    },

    updateNotebook(state, action: PayloadAction<{ id: string; changes: Partial<Notebook> }>) {
      const nb = state.notebooks[action.payload.id];
      if (!nb) return;
      const changes = { ...action.payload.changes };

      // Re-parenting must not create a cycle: a notebook cannot become a
      // descendant of itself, which would make the sidebar recurse forever.
      if ('parentId' in changes) {
        const next = changes.parentId ?? null;
        if (next === action.payload.id || (next && !state.notebooks[next])) {
          delete changes.parentId;
        } else if (next) {
          let cursor: string | null | undefined = next;
          const seen = new Set<string>();
          while (cursor && !seen.has(cursor)) {
            if (cursor === action.payload.id) {
              delete changes.parentId;
              break;
            }
            seen.add(cursor);
            cursor = state.notebooks[cursor]?.parentId ?? null;
          }
        }
      }

      Object.assign(nb, changes, { updatedAt: new Date().toISOString() });
    },

    deleteNotebook(state, action: PayloadAction<string>) {
      const removed = state.notebooks[action.payload];
      const grandparent = removed?.parentId ?? null;
      const now = new Date().toISOString();
      delete state.notebooks[action.payload];
      // Suppression DÉFINITIVE (les carnets n'ont pas de corbeille) : sans
      // pierre tombale, la fusion le fait revenir du nuage au cycle suivant.
      if (!state.purgedNotebooks) state.purgedNotebooks = {};
      markPurged(state.purgedNotebooks, [action.payload], now);
      // Promote the children instead of stranding them: an orphaned notebook
      // would vanish from the sidebar while still owning its notes.
      for (const nb of Object.values(state.notebooks)) {
        if (nb.parentId === action.payload) nb.parentId = grandparent;
      }
      for (const note of Object.values(state.byId)) {
        if (note.notebookId === action.payload) {
          note.notebookId = undefined;
          // Le déclassement est une MUTATION de la note : sans coup d'horloge,
          // la version d'en face (encore rangée dans le carnet) reste la plus
          // récente et le rangement revient au cycle suivant.
          note.updatedAt = now;
        }
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
      // Choisir un carnet, c'est QUITTER la vue « sans dossier » : la barre
      // latérale les présente comme deux entrées exclusives, et laisser les deux
      // filtres actifs donnerait leur intersection — une liste que personne n'a
      // demandée, sous une entrée qui prétend montrer un carnet entier.
      state.filterUnfiled = false;
      state.filterShared = false;
    },

    // ---- Kanban ----
    setKanbanStatus(state, action: PayloadAction<{ noteId: string; status: string | null }>) {
      const note = state.byId[action.payload.noteId];
      if (!note) return;
      if (action.payload.status) {
        note.kanbanStatus = action.payload.status;
      } else {
        note.kanbanStatus = undefined;
      }
      note.updatedAt = new Date().toISOString();
    },

    /**
     * Move a Kanban card to a specific position within (or across) columns.
     * `beforeNoteId === null` drops at the end of the column, otherwise the
     * dragged card lands immediately above the target note. After insertion
     * the column's cards are re-numbered 0..n-1 — simple and correct,
     * O(n) per reorder which is fine for typical board sizes.
     */
    reorderKanbanCard(
      state,
      action: PayloadAction<{
        noteId: string;
        columnId: string;
        beforeNoteId: string | null;
      }>
    ) {
      const { noteId, columnId, beforeNoteId } = action.payload;
      const note = state.byId[noteId];
      if (!note) return;

      // Always update the column — handles cross-column drops in the same step.
      note.kanbanStatus = columnId;
      note.updatedAt = new Date().toISOString();

      // Collect every other card in the target column, sorted by current order.
      const colCards = state.allIds
        .map((id) => state.byId[id])
        .filter(
          (n): n is NonNullable<typeof n> =>
            !!n && n.id !== noteId && !n.deletedAt && (n.kanbanStatus || 'inbox') === columnId
        )
        .sort(
          (a, b) =>
            (a.kanbanOrder ?? Number.MAX_SAFE_INTEGER) - (b.kanbanOrder ?? Number.MAX_SAFE_INTEGER)
        );

      // Where to insert the moving card.
      let insertAt = colCards.length;
      if (beforeNoteId) {
        const idx = colCards.findIndex((c) => c.id === beforeNoteId);
        if (idx >= 0) insertAt = idx;
      }

      // Renumber the column densely so subsequent reorders compute against
      // a clean monotonic sequence.
      const ordered = [...colCards.slice(0, insertAt), note, ...colCards.slice(insertAt)];
      ordered.forEach((card, i) => {
        const target = state.byId[card.id];
        if (target) target.kanbanOrder = i;
      });
    },

    /**
     * Move a note to a specific position in the manual ordering used by the
     * "All notes" list. `beforeNoteId === null` drops at the end, otherwise
     * the dragged note lands immediately above the target.
     *
     * `visibleIds` is the list currently on screen, in the order the user is
     * looking at. Renumbering against that — rather than against every note —
     * is what makes dragging inside a filtered or searched list behave the
     * way it looks: notes that are not on screen keep their relative order.
     */
    reorderNote(
      state,
      action: PayloadAction<{
        noteId: string;
        beforeNoteId: string | null;
        visibleIds: string[];
      }>
    ) {
      const { noteId, beforeNoteId, visibleIds } = action.payload;
      const note = state.byId[noteId];
      if (!note || noteId === beforeNoteId) return;

      const others = visibleIds.filter((id) => id !== noteId && state.byId[id]);
      let insertAt = others.length;
      if (beforeNoteId) {
        const idx = others.indexOf(beforeNoteId);
        if (idx >= 0) insertAt = idx;
      }

      const ordered = [...others.slice(0, insertAt), noteId, ...others.slice(insertAt)];
      ordered.forEach((id, i) => {
        const target = state.byId[id];
        if (target) target.manualOrder = i;
      });
      note.updatedAt = new Date().toISOString();
    },

    /**
     * One-shot migration: before `kanbanStatus` existed, KanbanView wrote
     * column ids into `icon` on drop, corrupting the display icon (you'd
     * see "in-progress" or "done" rendered where an emoji belonged).
     * Move any icon that looks like a kebab-case column id to
     * `kanbanStatus` and clear `icon`. Heuristic is safe because real
     * icons are either emoji (non-ASCII), `lucide:Name` (colon + case),
     * or `img:<dataUrl>` (colon) — none match `/^[a-z0-9-]+$/`.
     */
    migrateKanbanIconPollution(state) {
      const kebabRe = /^[a-z0-9][a-z0-9-]*$/;
      for (const note of Object.values(state.byId)) {
        if (note.kanbanStatus) continue;
        if (!note.icon) continue;
        if (kebabRe.test(note.icon)) {
          note.kanbanStatus = note.icon;
          note.icon = undefined;
        }
      }
    },

    /**
     * One-shot migration: before `viewPositions` existed, the Sticky view
     * encoded x,y coordinates as `"<x>,<y>"` strings inside `coverColor`,
     * the field meant to hold a note's cover color. Two consequences:
     * - any change of cover color wiped the sticky position
     * - any drag of a sticky note broke the cover color
     *
     * Move "<num>,<num>" coverColor values to viewPositions.sticky and
     * clear the legacy field. Real cover colors are CSS values (#hex,
     * rgb(), hsl(), named colors, presets like "solid:slate-500") — none
     * match the `<int>,<int>` shape, so the heuristic is safe. Idempotent:
     * re-running does nothing because matching values have already been
     * cleared from coverColor.
     */
    migrateStickyPositionPollution(state) {
      const positionRe = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/;
      for (const note of Object.values(state.byId)) {
        if (!note.coverColor) continue;
        const m = note.coverColor.match(positionRe);
        if (!m) continue;
        const x = Number(m[1]);
        const y = Number(m[2]);
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        if (!note.viewPositions) note.viewPositions = {};
        // Don't overwrite a position the user has already set via the
        // new field — only fill if missing.
        if (!note.viewPositions.sticky) {
          note.viewPositions.sticky = { x, y };
        }
        note.coverColor = undefined;
      }
    },

    /**
     * ANCRER les notes que personne n'a encore posées sur le canevas sticky.
     *
     * La vue savait afficher une note sans coordonnées en lui calculant une case
     * de grille à la volée, d'après son rang parmi les notes « non posées ». Ce
     * rang est une APPARTENANCE, pas seulement un ordre : au premier
     * déplacement, la note commitée quitte l'ensemble des non-posées et TOUTES
     * celles créées après elle reculaient d'une case — un mouvement résiduel
     * déterministe, visible à chaque relâchement de souris.
     *
     * On matérialise donc la case : chaque note visée reçoit une vraie
     * `viewPositions.sticky`, une fois pour toutes. L'ordre est `createdAt` puis
     * `id` (jamais `updatedAt`, que la vue ne doit pas suivre), et la grille se
     * pose SOUS la boîte englobante de ce qui est déjà placé, pour ne rien
     * recouvrir. `updatedAt` n'est pas touché — c'est de la géométrie, voir
     * `setNoteViewGeometry`. Idempotent : une note déjà posée est ignorée, donc
     * un second passage n'écrit rien et l'auto-save ne part même pas.
     *
     * La charge utile est la liste des ids à considérer (les notes que la vue
     * affiche vraiment) : matérialiser tout le coffre à l'ouverture de la vue
     * réécrirait des milliers de notes pour des cases que personne ne regarde.
     */
    materializeStickyPositions(state, action: PayloadAction<string[]>) {
      // Mêmes nombres que StickyNotesView : DEFAULT_SIZE + 20 de gouttière.
      const CELL_W = 220;
      const CELL_H = 180;
      const DEFAULT_H = 160;
      const COLS = 4;
      const ORIGIN = 40;
      const legacyPositionRe = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/;

      // Boîte englobante de TOUT ce qui est déjà posé — y compris les notes que
      // le filtre courant masque, sinon la grille viendrait par-dessus elles.
      let minX = Infinity;
      let maxY = -Infinity;
      for (const note of Object.values(state.byId)) {
        const p = note.viewPositions?.sticky;
        if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
        const h = note.viewSizes?.sticky?.h ?? DEFAULT_H;
        if (p.x < minX) minX = p.x;
        if (p.y + h > maxY) maxY = p.y + h;
      }
      const startX = Number.isFinite(minX) ? minX : ORIGIN;
      const startY = Number.isFinite(maxY) ? maxY + 40 : ORIGIN;

      const pending: Array<(typeof state.byId)[string]> = [];
      for (const id of action.payload) {
        const note = state.byId[id];
        if (!note || note.deletedAt) continue;
        if (note.viewPositions?.sticky) continue;
        // Position héritée logée dans `coverColor` : `migrateStickyPositionPollution`
        // la déplacera telle quelle. Lui donner une case de grille ici effacerait
        // le placement que l'utilisateur avait fait avant le schéma #19.
        if (note.coverColor && legacyPositionRe.test(note.coverColor)) continue;
        pending.push(note);
      }
      if (pending.length === 0) return;

      pending.sort((a, b) => {
        const cmp = (a.createdAt || '').localeCompare(b.createdAt || '');
        return cmp !== 0 ? cmp : a.id.localeCompare(b.id);
      });

      pending.forEach((note, i) => {
        if (!note.viewPositions) note.viewPositions = {};
        note.viewPositions.sticky = {
          x: startX + (i % COLS) * CELL_W,
          y: startY + Math.floor(i / COLS) * CELL_H,
        };
      });
    },

    // ---- Mind map → editor navigation ----
    requestScrollToHeading(state, action: PayloadAction<{ noteId: string; index: number }>) {
      state.pendingScrollToHeading = action.payload;
    },
    clearScrollToHeading(state) {
      state.pendingScrollToHeading = null;
    },

    // ---- Templates ----
    addTemplate(state, action: PayloadAction<NoteTemplate>) {
      state.templates.push(action.payload);
    },

    removeTemplate(state, action: PayloadAction<string>) {
      state.templates = state.templates.filter((t) => t.id !== action.payload);
    },

    /**
     * Reconstruit les modèles INTÉGRÉS après un changement de langue.
     *
     * POURQUOI — les six modèles du pack « projet » sont résolus par `i18n.t`
     * À LA CONSTRUCTION : nom, description, mais aussi les titres, encadrés,
     * noms de colonnes et libellés d'options de leur CONTENU. Or `templates`
     * n'était bâti qu'une fois, à l'initialisation du module, puis au
     * chargement du disque. Basculer la langue dans les Réglages (qui appelle
     * `i18n.changeLanguage` sans recharger) laissait donc ces six-là en
     * français dans une interface anglaise — et une note créée depuis l'un
     * d'eux figeait la mauvaise langue DANS le document persisté.
     *
     * Les modèles de l'utilisateur ne sont pas touchés : ils portent le nom
     * qu'il a choisi, dans la langue qu'il a choisie.
     */
    rebuildBuiltInTemplates(state) {
      const rebuilt = getBuiltInTemplates();
      const builtInIds = new Set(rebuilt.map((t) => t.id));
      const userTemplates = state.templates.filter((t) => !builtInIds.has(t.id));
      state.templates = [...rebuilt, ...userTemplates];
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
          // Les registres de purge repartent au disque à la prochaine
          // sauvegarde : ne pas les relire ici les effacerait, et les notes
          // définitivement supprimées reviendraient du nuage.
          if (action.payload.purged) state.purged = action.payload.purged;
          if (action.payload.purgedNotebooks) {
            state.purgedNotebooks = action.payload.purgedNotebooks;
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
      })

      // saveNotesToDisk — drives the editor's save-state indicator (#38).
      .addCase(saveNotesToDisk.pending, (state) => {
        state.saveStatus = 'saving';
      })
      .addCase(saveNotesToDisk.fulfilled, (state) => {
        state.saveStatus = 'synced';
        state.lastSavedAt = new Date().toISOString();
      })
      .addCase(saveNotesToDisk.rejected, (state) => {
        state.saveStatus = 'error';
      });
    // Pas de matcher sur `vaults/deleteItem(s)/fulfilled` : voir « Dépôts en
    // coffre » en tête de fichier — suppression douce, marqueur conservé.
  },
});

// ==================== Exports ====================

export const {
  addNote,
  addNotesBatch,
  updateNote,
  setNoteViewGeometry,
  setManyNoteViewGeometry,
  updateNoteContent,
  upsertNoteComment,
  resolveNoteComment,
  deleteNoteComment,
  markNoteSharedToVault,
  removeNoteShareRef,
  deleteNote,
  deleteAllNotes,
  deleteNotesBatch,
  permanentlyDeleteNotesBatch,
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
  setNotesFilterUnfiled,
  setNotesFilterShared,
  addTagToNote,
  removeTagFromNote,
  addNotebook,
  updateNotebook,
  deleteNotebook,
  setNoteNotebook,
  setNotesFilterNotebook,
  setKanbanStatus,
  reorderNote,
  reorderKanbanCard,
  migrateKanbanIconPollution,
  migrateStickyPositionPollution,
  materializeStickyPositions,
  requestScrollToHeading,
  clearScrollToHeading,
  addTemplate,
  rebuildBuiltInTemplates,
  removeTemplate,
} = notesSlice.actions;

/**
 * E9-2: permanently purge notes that have been in the trash longer than `olderThanDays`. Driven by an
 * org governance retention policy (useRetentionSweep). Best-effort + client-applied; persists the
 * result to disk. A non-positive window is a no-op (never purge when retention is unset).
 */
export const purgeExpiredTrashedNotes = createAsyncThunk<number, number, { state: RootState }>(
  'notes/purgeExpiredTrash',
  async (olderThanDays, { getState, dispatch }) => {
    if (!(olderThanDays > 0)) return 0;
    const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
    const { byId, allIds } = getState().notes;
    const expired = allIds.filter((id) => {
      const n = byId[id];
      if (!n?.deletedAt) return false;
      const t = Date.parse(n.deletedAt);
      return Number.isFinite(t) && t < cutoff;
    });
    if (expired.length === 0) return 0;
    dispatch(permanentlyDeleteNotesBatch(expired));
    await dispatch(saveNotesToDisk()); // persist the purge to notes.db
    return expired.length;
  }
);

// ==================== Selectors ====================

const selectNotesById = (state: RootState) => state.notes.byId;
const selectNotesAllIds = (state: RootState) => state.notes.allIds;
const selectNotesSearchQuery = (state: RootState) => state.notes.searchQuery;
const selectNotesFilterFolderId = (state: RootState) => state.notes.filterFolderId;
const selectNotesFilterDaily = (state: RootState) => state.notes.filterDaily;
const selectNotesFilterUnfiled = (state: RootState) => state.notes.filterUnfiled;
const selectNotesFilterShared = (state: RootState) => state.notes.filterShared;
const selectNotesSortBy = (state: RootState) => state.notes.sortBy;
const selectNotesSortOrder = (state: RootState) => state.notes.sortOrder;

export const selectAllNotes = createSelector(
  [selectNotesById, selectNotesAllIds],
  (byId, allIds): Note[] =>
    allIds.map((id) => byId[id]).filter((n): n is Note => !!n && !n.deletedAt)
);

/**
 * All soft-deleted notes — used by the notes trash view to surface
 * recoverable items, sorted by deletion date (most recent first so the
 * user sees what they just deleted at the top).
 */
export const selectTrashedNotes = createSelector(
  [selectNotesById, selectNotesAllIds],
  (byId, allIds): Note[] =>
    allIds
      .map((id) => byId[id])
      .filter((n): n is Note => !!n && !!n.deletedAt)
      .sort((a, b) => (b.deletedAt ?? '').localeCompare(a.deletedAt ?? ''))
);

/**
 * Notes PARASITES — copies de conflit fabriquées en boucle et notes miroir nées
 * d'un éditeur remonté sur la mauvaise note. Rapport de suspicion PUR (voir
 * `ghostNotes.ts`) : rien n'est supprimé ici, l'écran de nettoyage montre et
 * l'utilisateur tranche.
 */
export const selectSuspectNotes = createSelector([selectAllNotes], (notes): SuspectNote[] =>
  findSuspectNotes(notes)
);

/**
 * Copies de CONFLIT en attente d'arbitrage humain, avec de quoi les trancher
 * (les deux versions, les horodatages, la provenance).
 *
 * Contrairement à `selectSuspectNotes`, ce rapport est bâti sur les notes À LA
 * CORBEILLE COMPRISES : une copie dont l'original a été jeté doit pouvoir se
 * dire « original à la corbeille » (donc restaurable) plutôt que « original
 * disparu », ce qui n'ouvre pas les mêmes issues. Les copies elles-mêmes déjà à
 * la corbeille sont écartées par `listConflictResolutions`.
 */
export const selectConflictResolutions = createSelector(
  [selectNotesById, selectNotesAllIds],
  (byId, allIds): ConflictResolution[] =>
    listConflictResolutions(allIds.map((id) => byId[id]).filter((n): n is Note => !!n))
);

/**
 * Memoised lowercase-title → noteId map used by the transclusion input rule
 * (`![[Note]]` resolution). O(1) lookups instead of `Object.values().find` on
 * every keystroke. Recomputed only when the note map identity changes.
 *
 * Duplicate titles: last write wins (rare in practice — notes default to
 * unique titles via the editor — but worth noting if a user creates two
 * notes called "Untitled").
 */
export const selectNoteIdByTitle = createSelector(
  [selectAllNotes],
  (notes): Map<string, string> => {
    const map = new Map<string, string>();
    for (const n of notes) {
      if (n.title) map.set(n.title.toLowerCase(), n.id);
    }
    return map;
  }
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
    selectNotesFilterUnfiled,
    selectNotesFilterShared,
  ],
  (
    allNotes,
    searchQuery,
    filterFolderId,
    filterDaily,
    sortBy,
    sortOrder,
    filterNotebookId,
    filterUnfiled,
    filterShared
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

    // Rangées nulle part. Les notes quotidiennes sont écartées : elles n'ont pas
    // de dossier non plus, mais elles naissent seules et remplissent la liste
    // chaque jour — ce qu'on cherche ici, c'est ce qui a été ÉCRIT sans être
    // classé.
    if (filterUnfiled) {
      notes = notes.filter((n) => !n.parentId && !n.isDaily);
    }

    // Déposées dans un coffre — le même critère que `selectSharedNoteIds`
    // (marqueur `sharedTo` non vide), pour que le compte de la barre latérale
    // et la liste qu'il ouvre disent le même nombre.
    if (filterShared) {
      notes = notes.filter((n) => (n.sharedTo?.length ?? 0) > 0);
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
        case 'manual': {
          // Hand-made order. Notes never dragged have no value and sink to
          // the bottom, most-recent first — a note created after the list was
          // arranged appears where it can be found, not buried mid-list.
          const ao = a.manualOrder ?? Number.MAX_SAFE_INTEGER;
          const bo = b.manualOrder ?? Number.MAX_SAFE_INTEGER;
          if (ao !== bo) {
            // Manual order is absolute: `sortOrder` must not invert it, or
            // dragging a note up would move it down.
            return ao - bo;
          }
          return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
        }
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

/**
 * Carte enfant → parent dérivée des blocs sous-page (nœuds TipTap `subPage`)
 * présents dans le contenu de chaque note. Premier parent rencontré retenu.
 */
export const selectSubPageParentMap = createSelector(
  [selectNotesById, selectNotesAllIds],
  (byId, allIds): Map<string, string> => {
    const parentOf = new Map<string, string>();
    for (const id of allIds) {
      const note = byId[id];
      // Préfiltre : n'analyser que les notes contenant un bloc sous-page
      if (!note || note.deletedAt || !note.content || !note.content.includes('"subPage"')) continue;
      try {
        const stack: unknown[] = [JSON.parse(note.content)];
        while (stack.length) {
          const node = stack.pop() as {
            type?: string;
            attrs?: { noteId?: string };
            content?: unknown[];
          } | null;
          if (!node || typeof node !== 'object') continue;
          const childId = node.type === 'subPage' ? node.attrs?.noteId : undefined;
          if (childId && childId !== id && !parentOf.has(childId)) {
            parentOf.set(childId, id);
          }
          if (Array.isArray(node.content)) stack.push(...node.content);
        }
      } catch {
        // Contenu illisible : note ignorée
      }
    }
    return parentOf;
  }
);

/**
 * Index des bases de données inline du coffre (`dbId → base`), dérivé du
 * contenu TipTap des notes — même technique que `selectSubPageParentMap`
 * ci-dessus : préfiltre par chaîne, parcours tolérant, mémoïsation.
 *
 * C'est ce qui permet à une relation de viser une base qui vit dans une AUTRE
 * note. La collecte elle-même est pure (`collectNoteDbs`), donc testable sans
 * store ; ici, seul l'abonnement Redux.
 *
 * La mémoïsation de `createSelector` ne suffirait pas : elle tombe à la moindre
 * frappe, dans n'importe quelle note. Le collecteur, lui, garde le résultat
 * NOTE PAR NOTE et ne relit que celles dont le contenu ou le titre a bougé — et
 * rend l'index précédent à l'identique quand rien n'a changé, ce qui évite de
 * re-rendre tous les blocs base du coffre à chaque caractère tapé.
 */
const collectInlineDbIndex = createInlineDbCollector();

export const selectInlineDbIndex = createSelector(
  [selectNotesById, selectNotesAllIds],
  (byId, allIds): Map<string, InlineDbIndexEntry> =>
    collectInlineDbIndex(
      (function* () {
        for (const id of allIds) {
          const note = byId[id];
          if (note) yield note;
        }
      })()
    )
);

/** Select all notebooks sorted by name */
export const selectAllNotebooks = createSelector(
  [(state: RootState) => state.notes.notebooks],
  (notebooks): Notebook[] => Object.values(notebooks).sort((a, b) => a.name.localeCompare(b.name))
);

/** A notebook plus its position in the nesting tree. */
export interface NotebookTreeEntry {
  notebook: Notebook;
  /** 0 for a top-level notebook, +1 per level of nesting. */
  depth: number;
  hasChildren: boolean;
}

/**
 * Notebooks flattened depth-first, each carrying its nesting depth.
 *
 * A flat list keeps the sidebar rendering a single `.map` (no recursive
 * component) while still drawing the hierarchy through indentation.
 *
 * A notebook whose parent is missing is treated as top level rather than
 * dropped, so a broken link can never make notebooks disappear from the UI.
 *
 * L'ORDRE DE LA FRATRIE honore le rang manuel `order` que le TÉLÉPHONE écrit
 * (voir `services/notes/notebookOrder`). Il était ignoré : un rangement fait
 * au téléphone traversait la synchronisation intact et redevenait alphabétique
 * ici, sans rien pour dire qu'il existait toujours. Sans rang — donc pour toute
 * bibliothèque née au bureau — la liste est celle d'avant, au caractère près.
 */
export const selectNotebookTree = createSelector(
  [(state: RootState) => state.notes.notebooks],
  (notebooks): NotebookTreeEntry[] => {
    const all = Object.values(notebooks);
    const childrenOf = new Map<string | null, Notebook[]>();

    for (const nb of all) {
      const parentId = nb.parentId && notebooks[nb.parentId] ? nb.parentId : null;
      const siblings = childrenOf.get(parentId);
      if (siblings) siblings.push(nb);
      else childrenOf.set(parentId, [nb]);
    }
    for (const siblings of childrenOf.values()) {
      siblings.sort(compareNotebookSiblings);
    }

    const out: NotebookTreeEntry[] = [];
    const visited = new Set<string>();
    const walk = (parentId: string | null, depth: number) => {
      for (const nb of childrenOf.get(parentId) ?? []) {
        // Defensive: a cycle that slipped past `updateNotebook` must not hang
        // the renderer.
        if (visited.has(nb.id)) continue;
        visited.add(nb.id);
        out.push({ notebook: nb, depth, hasChildren: (childrenOf.get(nb.id) ?? []).length > 0 });
        walk(nb.id, depth + 1);
      }
    };
    walk(null, 0);
    return out;
  }
);

export type { NotesState };
export default notesSlice.reducer;
