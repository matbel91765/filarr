/**
 * Mise en page modulaire — état renderer.
 *
 * ── LA SOURCE DE VÉRITÉ N'EST PAS ICI ───────────────────────────────────────
 * C'est `layout.enc`, le conteneur chiffré du profil (voir
 * `electron/sync/layoutStore.ts`). Ce slice n'en est qu'une PROJECTION en
 * mémoire. D'où deux règles qui tiennent tout le reste :
 *
 *  1. `layout` est BLACKLISTÉ de redux-persist (`store/index.ts`). Persister la
 *     disposition dans le blob redux en ferait une seconde vérité, désynchronisée
 *     du fichier dès la première fusion venue d'un autre appareil.
 *  2. `layout` n'est PAS dans la liste préservée par `resetAppData` : il est
 *     effacé au changement de profil, puis réhydraté depuis le disque du NOUVEAU
 *     profil. Sans cela la mise en page fuirait d'un profil à l'autre — et avec
 *     elle les identifiants de dossiers qu'elle cite.
 *
 * ── HORLOGES ────────────────────────────────────────────────────────────────
 * Chaque vue porte SA PROPRE horloge `updatedAt`, et c'est la seule chose que la
 * fusion arbitre (LWW strict, au grain de la vue). Tout reducer qui modifie une
 * vue DOIT donc la redater : une modification sans horloge neuve serait
 * silencieusement écrasée par la version distante au premier cycle.
 */

import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import {
  createEmptyLayoutDocument,
  type LayoutDocument,
  type LayoutSeedHints,
  type LayoutSlot,
  type LayoutTemplate,
  type LayoutView,
  type LayoutViewId,
} from '../../services/layout/layoutTypes';

/**
 * ── LE MODE ÉDITION EST UN BROUILLON, PAS UNE SUITE D'ÉCRITURES ─────────────
 *
 * Ranger son accueil, c'est vingt gestes en deux minutes. Si chacun redatait la
 * vue, chacun partirait en synchronisation : vingt versions du même rangement,
 * vingt occasions qu'un autre appareil arbitre au milieu, et une pile de
 * dispositions « écartées » que personne n'a demandée.
 *
 * Le mode édition travaille donc sur une COPIE (`edit.slots`) qui ne touche
 * jamais `document`. Un seul commit part à la SORTIE (`commitLayoutEdit`), et il
 * emporte l'état d'AVANT dans `lastCommit` — c'est ce qui rend le « Annuler » du
 * toast possible sans rien réinventer.
 */

/** Profondeur de la pile d'annulation. Au-delà, les plus vieux pas tombent. */
export const LAYOUT_EDIT_UNDO_LIMIT = 50;

/** Ce que le panneau latéral montre quand aucun bloc n'est sélectionné. */
export type LayoutEditPanelMode = 'add' | 'templates';

export interface LayoutEditSession {
  viewId: LayoutViewId;
  /** La disposition telle qu'elle était à l'entrée. Cible du « Annuler ». */
  baseline: LayoutSlot[];
  /** Le brouillon courant — ce que la grille affiche pendant l'édition. */
  slots: LayoutSlot[];
  past: LayoutSlot[][];
  future: LayoutSlot[][];
  /** Gabarit posé PENDANT la session, s'il y en a eu un. */
  templateId?: string;
  /** Le bloc dont l'inspecteur est ouvert. */
  selectedSlotId: string | null;
  panelOpen: boolean;
  panelMode: LayoutEditPanelMode;
  /** Le bloc qui vient d'être posé, à faire clignoter pour qu'on le retrouve. */
  flashSlotId: string | null;
}

/**
 * La trace du dernier commit d'édition. Elle ne vit que le temps du toast : sans
 * elle, « Annuler » n'aurait rien à restaurer — avec elle qui traîne, un clic
 * tardif ressusciterait une disposition vieille de dix minutes.
 */
export interface LayoutCommitTrace {
  viewId: LayoutViewId;
  before: LayoutSlot[];
}

export interface LayoutState {
  document: LayoutDocument;
  /**
   * `pending-remote` : le nuage porte une mise en page qui n'est pas encore
   * descendue. Le document est vide et PROVISOIRE — ne rien écrire par-dessus,
   * et surtout ne rien proposer d'irréversible à l'utilisateur.
   */
  status: 'idle' | 'loading' | 'ready' | 'pending-remote' | 'error';
  error: string | null;
  lastLoadedAt: string | null;
  /** Une écriture disque est en vol (le débit réel est piloté par l'appelant). */
  saving: boolean;
  /** Session d'édition en cours, ou `null` au repos. */
  edit: LayoutEditSession | null;
  /** De quoi défaire le dernier commit d'édition. */
  lastCommit: LayoutCommitTrace | null;
}

const initialState: LayoutState = {
  document: createEmptyLayoutDocument(),
  status: 'idle',
  error: null,
  lastLoadedAt: null,
  saving: false,
  edit: null,
  lastCommit: null,
};

/**
 * Préférences DÉJÀ exprimées, relevées pour l'amorçage. On les LIT, on ne les
 * efface jamais : les anciens écrans continuent de s'en servir tant que
 * l'interface modulaire ne les a pas remplacés.
 */
function collectSeedHints(state: unknown): LayoutSeedHints {
  const root = state as {
    ui?: { homeRecentNotes?: boolean };
    settings?: { display?: LayoutSeedHints['display'] };
  };
  let dashboardCollapsed: boolean | undefined;
  try {
    // Clé écrite par `DashboardStats` en localStorage BRUT (pas profileStorage) :
    // on la relit exactement comme elle est écrite, sinon l'amorçage déplierait
    // un bandeau que l'utilisateur avait replié.
    dashboardCollapsed = localStorage.getItem('filarr-dashboard-collapsed') === 'true';
  } catch {
    dashboardCollapsed = undefined;
  }
  return {
    homeRecentNotes: root.ui?.homeRecentNotes,
    dashboardCollapsed,
    display: root.settings?.display,
  };
}

/** Lit (et amorce au premier appel du profil) le conteneur de mise en page. */
export const loadLayoutFromDisk = createAsyncThunk(
  'layout/loadFromDisk',
  async (_: void, { getState }) => {
    const bridge = window.electron?.ipcRenderer;
    if (!bridge) return { document: createEmptyLayoutDocument(), seeded: true };
    const result = await bridge.invoke('layout:load', collectSeedHints(getState()));
    return (result ?? { document: createEmptyLayoutDocument(), seeded: false }) as {
      document: LayoutDocument;
      seeded: boolean;
    };
  }
);

/** Scelle le document courant. Le processus principal marque la remontée. */
export const saveLayoutToDisk = createAsyncThunk(
  'layout/saveToDisk',
  async (_: void, { getState }) => {
    const bridge = window.electron?.ipcRenderer;
    if (!bridge) return false;
    const { layout } = getState() as { layout: LayoutState };
    return (await bridge.invoke('layout:save', layout.document)) === true;
  }
);

const nowIso = (): string => new Date().toISOString();

const layoutSlice = createSlice({
  name: 'layout',
  initialState,
  reducers: {
    /**
     * Remplace la disposition d'une vue ENTIÈRE — c'est le grain de la fusion,
     * donc c'est aussi le grain de l'écriture. Redate la vue : sans horloge
     * neuve, le prochain cycle la croirait inchangée et la remplacerait.
     */
    setViewSlots(
      state,
      action: PayloadAction<{ viewId: LayoutViewId; slots: LayoutSlot[]; templateId?: string }>
    ) {
      const { viewId, slots, templateId } = action.payload;
      const existing = state.document.views[viewId];
      const next: LayoutView = {
        id: viewId,
        slots,
        updatedAt: nowIso(),
      };
      if (templateId !== undefined) next.templateId = templateId;
      else if (existing?.templateId !== undefined) next.templateId = existing.templateId;
      // Les dispositions perdantes survivent à une réédition : elles ne sont
      // retirées que par un geste explicite (ou par leurs 30 jours).
      if (existing?.superseded) next.superseded = existing.superseded;
      state.document.views[viewId] = next;
    },

    /** Pose une vue complète (instanciation d'un gabarit, import, restauration). */
    setView(state, action: PayloadAction<LayoutView>) {
      state.document.views[action.payload.id] = {
        ...action.payload,
        updatedAt: nowIso(),
      };
    },

    /**
     * Retire une vue. NOTE : la fusion étant une UNION, la vue reviendra du
     * nuage tant qu'un autre appareil la porte — la suppression durable relève
     * d'une pierre tombale, qui n'est pas de ce chantier.
     */
    removeView(state, action: PayloadAction<LayoutViewId>) {
      delete state.document.views[action.payload];
    },

    /** Installe ou met à jour un gabarit (place de marché, import, publication). */
    upsertTemplate(state, action: PayloadAction<LayoutTemplate>) {
      state.document.templates[action.payload.id] = {
        ...action.payload,
        updatedAt: nowIso(),
      };
    },

    removeTemplate(state, action: PayloadAction<string>) {
      delete state.document.templates[action.payload];
    },

    /**
     * « Prendre l'autre » : la disposition perdante d'un arbitrage redevient la
     * disposition active, et celle qu'elle remplace prend sa place dans la
     * pile. Rien n'est détruit, l'échange est réversible.
     */
    restoreSuperseded(state, action: PayloadAction<{ viewId: LayoutViewId; index: number }>) {
      const view = state.document.views[action.payload.viewId];
      const candidate = view?.superseded?.[action.payload.index];
      if (!view || !candidate) return;
      const replaced = {
        slots: view.slots,
        updatedAt: view.updatedAt,
        savedAt: nowIso(),
        side: 'local' as const,
      };
      const rest = view.superseded!.filter((_, i) => i !== action.payload.index);
      view.slots = candidate.slots;
      view.updatedAt = nowIso();
      view.superseded = [replaced, ...rest];
    },

    /** « Garder celui-ci » : la pile de dispositions écartées est vidée. */
    clearSuperseded(state, action: PayloadAction<LayoutViewId>) {
      const view = state.document.views[action.payload];
      if (view) delete view.superseded;
    },

    /**
     * Adoption du document venu du DISQUE après une fusion (`layout-updated`).
     * Aucune horloge n'est touchée ici : ce sont celles que la fusion a arrêtées.
     */
    applyLayoutDocument(state, action: PayloadAction<LayoutDocument>) {
      state.document = action.payload;
      state.status = 'ready';
      state.error = null;
      state.lastLoadedAt = nowIso();
      // La trace du dernier commit ne décrit plus rien : le document qu'elle
      // prétendait pouvoir restaurer vient d'être remplacé. La garder ferait
      // d'« Annuler » une machine à écraser une fusion.
      state.lastCommit = null;
    },

    // ==================== Le mode édition ====================

    /**
     * Ouvre une session. La disposition affichée est recopiée telle quelle :
     * `baseline` et `slots` partent égales, et c'est leur écart qui dira, à la
     * sortie, s'il y a quelque chose à écrire.
     *
     * `baseline` peut être fournie À PART : un dossier qui HÉRITE son bandeau
     * édite une COPIE prise en main (`slots`, portée « propre ») alors que ce
     * qui est réellement stocké pour lui est autre chose (rien, ou une portée
     * « comme le parent »). C'est le stocké que le « Annuler » du toast doit
     * restaurer — pas la copie, qui n'a jamais existé sur disque.
     */
    beginLayoutEdit(
      state,
      action: PayloadAction<{ viewId: LayoutViewId; slots: LayoutSlot[]; baseline?: LayoutSlot[] }>
    ) {
      state.edit = {
        viewId: action.payload.viewId,
        baseline: action.payload.baseline ?? action.payload.slots,
        slots: action.payload.slots,
        past: [],
        future: [],
        selectedSlotId: null,
        panelOpen: false,
        panelMode: 'add',
        flashSlotId: null,
      };
    },

    /**
     * Un pas d'édition. TOUT passe par ici — glissement, format, réglage, ajout,
     * retrait, gabarit — parce que c'est le seul endroit qui empile l'annulation.
     * Un chemin d'écriture qui contournerait ce reducer serait un geste qu'on ne
     * peut pas défaire, et l'utilisateur n'aurait aucun moyen de savoir lequel.
     */
    pushLayoutDraft(state, action: PayloadAction<{ slots: LayoutSlot[]; templateId?: string }>) {
      const edit = state.edit;
      if (!edit) return;
      edit.past.push(edit.slots);
      // La pile est bornée par le haut : cinquante pas couvrent une session de
      // rangement, et une pile sans fin garderait en mémoire autant de copies de
      // la disposition qu'on a fait de gestes.
      if (edit.past.length > LAYOUT_EDIT_UNDO_LIMIT) edit.past.shift();
      edit.future = [];
      edit.slots = action.payload.slots;
      if (action.payload.templateId !== undefined) edit.templateId = action.payload.templateId;
      // Un bloc retiré ne peut pas rester sélectionné : l'inspecteur montrerait
      // les réglages d'un emplacement qui n'existe plus.
      if (edit.selectedSlotId && !action.payload.slots.some((s) => s.id === edit.selectedSlotId)) {
        edit.selectedSlotId = null;
      }
    },

    undoLayoutDraft(state) {
      const edit = state.edit;
      if (!edit) return;
      const previous = edit.past.pop();
      if (!previous) return;
      edit.future.unshift(edit.slots);
      if (edit.future.length > LAYOUT_EDIT_UNDO_LIMIT) edit.future.pop();
      edit.slots = previous;
      if (edit.selectedSlotId && !previous.some((s) => s.id === edit.selectedSlotId)) {
        edit.selectedSlotId = null;
      }
    },

    redoLayoutDraft(state) {
      const edit = state.edit;
      if (!edit) return;
      const next = edit.future.shift();
      if (!next) return;
      edit.past.push(edit.slots);
      if (edit.past.length > LAYOUT_EDIT_UNDO_LIMIT) edit.past.shift();
      edit.slots = next;
      if (edit.selectedSlotId && !next.some((s) => s.id === edit.selectedSlotId)) {
        edit.selectedSlotId = null;
      }
    },

    /** Sélectionner un bloc ouvre le panneau : l'inspecteur EST le panneau. */
    selectLayoutSlot(state, action: PayloadAction<string | null>) {
      const edit = state.edit;
      if (!edit) return;
      edit.selectedSlotId = action.payload;
      if (action.payload !== null) edit.panelOpen = true;
    },

    setLayoutPanel(state, action: PayloadAction<{ open: boolean; mode?: LayoutEditPanelMode }>) {
      const edit = state.edit;
      if (!edit) return;
      edit.panelOpen = action.payload.open;
      if (action.payload.mode) edit.panelMode = action.payload.mode;
      // Ouvrir « Ajouter » ou « Modèles » désélectionne : sans ça, le panneau
      // rouvrirait sur l'inspecteur du bloc d'avant.
      if (action.payload.mode) edit.selectedSlotId = null;
    },

    flashLayoutSlot(state, action: PayloadAction<string | null>) {
      if (state.edit) state.edit.flashSlotId = action.payload;
    },

    /**
     * LA sortie qui écrit. Un seul commit pour toute la session, avec une horloge
     * neuve — sans elle, la fusion croirait la vue inchangée et la remplacerait
     * par celle du premier appareil qui parle.
     */
    commitLayoutEdit(state) {
      const edit = state.edit;
      if (!edit) return;
      const existing = state.document.views[edit.viewId];
      const next: LayoutView = {
        id: edit.viewId,
        slots: edit.slots,
        updatedAt: nowIso(),
      };
      const templateId = edit.templateId ?? existing?.templateId;
      if (templateId !== undefined) next.templateId = templateId;
      if (existing?.superseded) next.superseded = existing.superseded;
      state.document.views[edit.viewId] = next;
      state.lastCommit = { viewId: edit.viewId, before: edit.baseline };
      state.edit = null;
    },

    /** Sortie SANS écrire — le document n'est pas arrêté, ou la fenêtre a rétréci. */
    cancelLayoutEdit(state) {
      state.edit = null;
    },

    /**
     * « Annuler » du toast : la disposition d'avant la session revient. Elle
     * revient avec une horloge NEUVE, parce que c'est une décision de
     * l'utilisateur, pas un retour en arrière du temps — les autres appareils
     * doivent l'adopter, pas la considérer comme périmée.
     */
    revertLayoutCommit(state) {
      const trace = state.lastCommit;
      if (!trace) return;
      const existing = state.document.views[trace.viewId];
      const next: LayoutView = {
        id: trace.viewId,
        slots: trace.before,
        updatedAt: nowIso(),
      };
      if (existing?.templateId !== undefined) next.templateId = existing.templateId;
      if (existing?.superseded) next.superseded = existing.superseded;
      state.document.views[trace.viewId] = next;
      state.lastCommit = null;
    },

    /** Le toast est parti : plus rien à défaire. */
    clearLayoutCommit(state) {
      state.lastCommit = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(loadLayoutFromDisk.pending, (state) => {
        state.status = state.status === 'ready' ? 'ready' : 'loading';
        state.error = null;
      })
      .addCase(loadLayoutFromDisk.fulfilled, (state, action) => {
        state.document = action.payload.document ?? createEmptyLayoutDocument();
        // Amorçage retenu : le nuage a la réponse, elle n'est pas arrivée.
        state.status = action.payload.seeded ? 'ready' : 'pending-remote';
        state.lastLoadedAt = nowIso();
        // Un brouillon d'édition décrit la disposition qu'on vient de remplacer
        // (changement de profil, première lecture) : le commiter écrirait
        // l'accueil d'un profil par-dessus celui d'un autre.
        state.edit = null;
        state.lastCommit = null;
      })
      .addCase(loadLayoutFromDisk.rejected, (state, action) => {
        state.status = 'error';
        state.error = action.error.message ?? 'layout load failed';
      })
      .addCase(saveLayoutToDisk.pending, (state) => {
        state.saving = true;
      })
      .addCase(saveLayoutToDisk.fulfilled, (state) => {
        state.saving = false;
      })
      .addCase(saveLayoutToDisk.rejected, (state, action) => {
        state.saving = false;
        state.error = action.error.message ?? 'layout save failed';
      });
  },
});

export const {
  setViewSlots,
  setView,
  removeView,
  upsertTemplate,
  removeTemplate,
  restoreSuperseded,
  clearSuperseded,
  applyLayoutDocument,
  beginLayoutEdit,
  pushLayoutDraft,
  undoLayoutDraft,
  redoLayoutDraft,
  selectLayoutSlot,
  setLayoutPanel,
  flashLayoutSlot,
  commitLayoutEdit,
  cancelLayoutEdit,
  revertLayoutCommit,
  clearLayoutCommit,
} = layoutSlice.actions;

export default layoutSlice.reducer;
