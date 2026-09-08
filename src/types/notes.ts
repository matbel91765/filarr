/**
 * Filarr Notes — Types
 *
 * Data models for the knowledge-layer note system.
 */

// ==================== CORE NOTE TYPES ====================

/**
 * Un commentaire de note — ENFIN un modèle de données.
 *
 * Le texte des commentaires vivait dans un useState de l'éditeur : effacé au
 * changement de note, jamais persisté, pendant que les MARQUES TipTap
 * (data-comment-id), elles, étaient persistées — orphelines par construction.
 * La perte de données était systématique : fermer la note perdait chaque
 * commentaire jamais écrit.
 */
export interface NoteComment {
  id: string;
  text: string;
  author: string;
  createdAt: string;
  resolved: boolean;
}

export interface Note {
  id: string;
  title: string;
  /** TipTap JSON document content */
  content: string;
  /**
   * Les commentaires, par identifiant de marque. Voyage avec la note dans la
   * persistance et la fusion nuage sans migration : le disque range le payload
   * tel quel, la fusion travaille au grain de la note entière.
   */
  comments?: Record<string, NoteComment>;
  /** Plain-text extract for search indexing */
  plainText: string;
  /** Parent folder ID — notes live alongside files */
  parentId: string | null;
  /** Outgoing wiki-links to other notes */
  linkedNoteIds: string[];
  /** Outgoing wiki-links to files */
  linkedFileIds: string[];
  /** Outgoing wiki-links to folders */
  linkedFolderIds: string[];
  /** Whether this is an auto-generated daily note */
  isDaily: boolean;
  /** ISO date string for daily notes (YYYY-MM-DD) */
  dailyDate?: string;
  /**
   * Calendar-scheduled date (YYYY-MM-DD), set when a non-daily note is
   * dragged onto a day in CalendarView. Kept separate from `createdAt`
   * so the original creation timestamp (and chronology elsewhere in the
   * app) remains untouched. Daily notes use `dailyDate` instead.
   */
  scheduledDate?: string;
  /** Template ID used to create this note */
  templateId?: string;
  /**
   * Icon for display. Accepts three encodings:
   *   - raw emoji character(s) — legacy, e.g. `"📝"`
   *   - `lucide:<IconName>` — icon from the Lucide set (react-icons/lu)
   *   - `img:<dataUrl>` — user-uploaded image, 64×64 recommended
   */
  icon?: string;
  /**
   * @deprecated Use `coverPresetId` for presets or `coverImage` for custom
   * images. Kept on the type so old notes keep rendering after upgrade —
   * see `resolveLegacyCoverColor` in `coverPresets.ts`.
   */
  coverColor?: string;
  /** Id of a preset from `coverPresets.ts` (solid, gradient, mesh…). */
  coverPresetId?: string;
  /**
   * User-uploaded cover image as a data URL. Kept inline on the note
   * because covers are usually small (~200 KB compressed) and this
   * avoids managing a separate asset store.
   */
  coverImage?: string;
  /**
   * Vertical position of the cover image, 0-100 (%). Only meaningful
   * when `coverImage` is set AND `coverScale` > 100 (otherwise the
   * image fills the banner exactly and there is no overflow to
   * reposition). Defaults to 50 (center) when absent.
   */
  coverPosition?: number;
  /**
   * Horizontal position of the cover image, 0-100 (%). Same semantics
   * as `coverPosition` but for the X axis.
   */
  coverPositionX?: number;
  /**
   * Scale of the cover image as a percentage. 100 fills the banner
   * exactly; higher values crop the image (user controls which area
   * is visible via the position fields). 100-300 is the expected
   * range in the UI.
   */
  coverScale?: number;
  /**
   * Per-view canvas-style coordinates, keyed by view name (`sticky`,
   * `canvas`, …). Lives outside `coverColor` so position data can't
   * collide with cover-color data. Each entry is the top-left of the
   * note in that view's coordinate space.
   */
  viewPositions?: Record<string, { x: number; y: number }>;
  /**
   * Per-view canvas-style sizes, keyed by view name. Each entry is the
   * note's drawn box in that view's coordinate space. Optional — views
   * fall back to their default size when absent.
   */
  viewSizes?: Record<string, { w: number; h: number }>;
  /** Word count cache */
  wordCount: number;
  /** Tags associated with this note */
  tagIds: string[];
  /** Notebook this note belongs to */
  notebookId?: string;
  /**
   * Kanban column this note belongs to in the Kanban view. Separate from
   * `icon` so that changing a note's Kanban column doesn't clobber the
   * user-chosen display icon. Stores the column id (e.g. `'inbox'`,
   * `'in-progress'`, custom kebab-case ids created via "Add column").
   */
  kanbanStatus?: string;
  /**
   * User-controlled position within the Kanban column. Lower values
   * appear higher in the column. Set when a card is dragged to reorder
   * within or across columns. Cards without a value sort to the bottom
   * (treated as +Infinity), preserving the global filter sort as a
   * tie-breaker for unordered groups.
   */
  kanbanOrder?: number;
  /**
   * User-controlled position in the notes list when sorting is set to
   * `'manual'`. Lower values appear first. Notes without a value sort to the
   * bottom (treated as +Infinity) and fall back to the most-recent order, so
   * a brand-new note never disappears into the middle of a hand-made list.
   */
  manualOrder?: number;
  /** Pinned to top of list */
  isPinned: boolean;
  /** Freehand drawing overlay strokes (JSON-encoded Stroke[]) */
  drawingStrokes?: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
  /**
   * Id de la note dont cette note est une COPIE DE CONFLIT. Écrit par la fusion
   * seule (`applyConflictCopies`), jamais par l'éditeur : c'est la signature qui
   * permet à `findSuspectNotes` de retrouver les copies, même renommées.
   */
  conflictOfId?: string;
  /** Instant où la fusion a fabriqué la copie (ISO). */
  conflictSavedAt?: string;
  /** `updatedAt` de la version perdante au moment de la copie, `null` si illisible. */
  conflictOriginalUpdatedAt?: string | null;
  /**
   * D'où venait la version PERDANTE. `local` : elle était sur l'appareil qui a
   * fusionné, et le nuage portait plus récent. `remote` : elle venait du nuage,
   * et c'est la version de cet appareil qui l'a emporté. Absent sur les copies
   * fabriquées avant que la fusion ne l'inscrive.
   */
  conflictSide?: 'local' | 'remote';
  /**
   * Appareil qui a FUSIONNÉ et fabriqué la copie (`web`, `desktop`). Le magasin
   * ne porte aucune identité d'appareil : c'est la plateforme, rien de plus —
   * assez pour dire « cette version-là venait de ton ordinateur », jamais assez
   * pour désigner une machine.
   */
  conflictDevice?: string | null;
  /** `updatedAt` de la version CONSERVÉE au moment de la copie, `null` si illisible. */
  conflictKeptUpdatedAt?: string | null;
  /**
   * Les coffres partagés où cette note a été DÉPOSÉE — voir `NoteShareRef`.
   *
   * Un TABLEAU, parce qu'une même note peut partir dans plusieurs coffres (un
   * par équipe, un par client) et que chaque dépôt est un élément distinct, avec
   * son propre identifiant, sa propre clé et sa propre corbeille. Optionnel :
   * absent sur toute note écrite avant l'existence du partage, ce qui se lit
   * « jamais déposée » — zéro migration, même patron que `conflictOfId`.
   */
  sharedTo?: NoteShareRef[];
}

/**
 * Une note DÉPOSÉE dans un coffre partagé : le lien entre la note locale et
 * l'élément de coffre qui en est né.
 *
 * SÉMANTIQUE : COPIE DIVERGENTE, jamais « synchronisée ». Au moment `at`, le
 * contenu de la note a été chiffré sous la clé du coffre et téléversé comme
 * élément `itemId` ; à partir de là les deux vies sont indépendantes — éditer
 * la note ne touche pas la copie, éditer la copie (par n'importe quel membre)
 * ne touche pas la note. Le marqueur ne dit donc PAS « cette note est dans le
 * coffre », il dit « une copie de cette note y est partie tel jour ». Toute
 * interface qui le rend doit garder cette nuance : un badge « partagée »
 * lu comme « à jour » est un mensonge, et un mensonge sur un coffre partagé se
 * paie en membres qui lisent une version périmée en toute confiance.
 *
 * `mode` retient le geste d'origine : `copy` — la note reste ici, à côté de sa
 * copie ; `move` — l'utilisateur voulait que le coffre devienne la seule
 * demeure, et la note locale est allée à la corbeille dans la foulée (le
 * marqueur y survit : la restaurer ne doit pas faire oublier où la copie est).
 *
 * Le marqueur voyage avec la note (disque, fusion nuage) et se propage par
 * `updatedAt` comme tout autre champ : les réducteurs qui l'écrivent bousculent
 * l'horloge, sinon l'appareil d'en face n'en saurait jamais rien.
 */
export interface NoteShareRef {
  vaultId: string;
  itemId: string;
  mode: 'copy' | 'move';
  /** Instant du dépôt (ISO). */
  at: string;
}

// ==================== WIKI-LINK TYPES ====================

export type WikiLinkType = 'note' | 'file' | 'folder';

export interface WikiLink {
  type: WikiLinkType;
  targetId: string;
  targetName: string;
  /** Display alias — [[target|alias]] */
  alias?: string;
}

export interface ParsedLink {
  raw: string;
  type: WikiLinkType;
  target: string;
  alias?: string;
  /** Whether this is an embed (![[...]]) */
  isEmbed: boolean;
  start: number;
  end: number;
}

// ==================== BACKLINK TYPES ====================

export interface Backlink {
  sourceNoteId: string;
  sourceNoteTitle: string;
  /** Text context around the link */
  context: string;
}

// ==================== TEMPLATE TYPES ====================

export interface NoteTemplate {
  id: string;
  name: string;
  description: string;
  icon: string;
  /** TipTap JSON content with {{variable}} placeholders */
  content: string;
  /** Available variables for this template */
  variables: TemplateVariable[];
  isBuiltIn: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TemplateVariable {
  name: string;
  label: string;
  type: 'text' | 'date' | 'folder' | 'tags';
  defaultValue?: string;
}

// ==================== NOTEBOOK TYPES ====================

export interface Notebook {
  id: string;
  name: string;
  /** Display color */
  color?: string;
  /** Emoji icon */
  icon?: string;
  /**
   * Parent notebook, enabling nesting. `null`/absent means top level.
   * Absent on every notebook created before nesting existed, which reads
   * as top level — no migration needed.
   */
  parentId?: string | null;
  /**
   * RANG MANUEL DANS LA FRATRIE — écrit par le TÉLÉPHONE seulement.
   *
   * Le mobile offre un glissé dans l'arbre des carnets et s'en souvient ici
   * (`filarr-mobile/src/services/notes/notebooks/model.ts`). Le bureau LE LIT
   * (`compareNotebookSiblings`, `selectNotebookTree`) et ne l'ÉCRIT jamais :
   * `addNotebook` énumère ses champs sans lui, donc un carnet né ici produit
   * exactement les octets d'avant. Absent = « range-moi par nom ».
   */
  order?: number;
  createdAt: string;
  updatedAt: string;
}

// ==================== GRAPH TYPES ====================

export interface GraphNode {
  id: string;
  label: string;
  /**
   * `tag` = nœud balise (#tag) relié aux notes qui la portent ;
   * `unresolved` = cible de wiki-link sans note correspondante (grisé,
   * non navigable) — parité Obsidian.
   */
  type: 'note' | 'file' | 'folder' | 'notebook' | 'tag' | 'unresolved';
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Number of connections */
  connections: number;
  color?: string;
}

export interface GraphEdge {
  source: string;
  target: string;
  type:
    | 'note-note'
    | 'note-file'
    | 'note-folder'
    | 'notebook-note'
    | 'note-tag'
    | 'note-unresolved';
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// ==================== STATE TYPES ====================

export interface NotesState {
  byId: Record<string, Note>;
  allIds: string[];
  selectedNoteId: string | null;
  editingNoteId: string | null;
  templates: NoteTemplate[];
  isLoading: boolean;
  error: string | null;
  /**
   * Disk save state, surfaced in the editor as a small "Synced /
   * Saving / Save failed" indicator. UI infers "Pending changes" when
   * `saveStatus === 'synced'` but a note's updatedAt is newer than
   * `lastSavedAt` (debounce hasn't fired yet).
   */
  saveStatus?: 'synced' | 'saving' | 'error';
  /** ISO timestamp of the last successful disk save. */
  lastSavedAt?: string | null;
  /**
   * Transient "the editor should scroll to this heading on next mount /
   * refresh" signal. Carries the doc-children index of the target node
   * (not a ProseMirror position — the editor resolves the PM offset
   * itself once it has the editor instance). Cleared by the editor as
   * soon as it acts on it. Used by MindMap clicks to drill from a
   * heading node directly to its position in the body.
   */
  pendingScrollToHeading?: { noteId: string; index: number } | null;
  /**
   * Mode d'affichage courant.
   *
   * `'grid'` a été retiré : aucun bouton de la barre de modes ne le proposait
   * et aucune branche de rendu ne le traitait — la cascade retombait
   * silencieusement sur la vue liste. Une valeur fantôme dans une union est
   * une promesse compilable qui n'est jamais tenue ; c'est la même famille que
   * la vue « canevas » supprimée le 2026-08-26.
   */
  viewMode:
    | 'list'
    | 'graph'
    | 'masonry'
    | 'kanban'
    | 'sticky'
    | 'database'
    | 'tasks'
    | 'mindmap'
    | 'calendar';
  /** Search within notes */
  searchQuery: string;
  /** Sort configuration */
  sortBy: 'title' | 'updatedAt' | 'createdAt' | 'wordCount' | 'manual';
  sortOrder: 'asc' | 'desc';
  /** Filter by parent folder */
  filterFolderId: string | null;
  /** Show only daily notes */
  filterDaily: boolean;
  /**
   * Show only notes that live in NO folder (`parentId === null`) and are not
   * daily notes. The accueil surfaces those notes in a "Notes sans dossier"
   * section; without this filter its "see all" button landed on an unfiltered
   * list where the very notes it was pointing at were lost again.
   */
  filterUnfiled: boolean;
  /**
   * Ne montrer que les notes DÉPOSÉES dans au moins un coffre partagé
   * (`sharedTo` non vide). Troisième vue exclusive de la barre latérale, à côté
   * de « Sans dossier » et des carnets : la palette (« Notes partagées ») y
   * atterrit, et c'est la seule porte pour retrouver d'un coup tout ce qui a
   * une copie quelque part.
   */
  filterShared: boolean;
  /** Notebooks for grouping notes */
  notebooks: Record<string, Notebook>;
  /** Filter by notebook */
  filterNotebookId: string | null;
  /** Breadcrumb: recently visited note IDs (most recent last) */
  visitHistory: string[];
  /**
   * Durable tombstones for PERMANENT deletions (`noteId → purgedAt` ISO).
   * A hard `delete` leaves no trace, so cloud merge re-unions the note back in
   * on the next cycle, forever. The tombstone lets the merge subtract it (see
   * platform/web/sync/notesMerge). Entries older than 90 days are forgotten so
   * the registry cannot grow without end.
   */
  purged?: Record<string, string>;
  /** Same, for notebooks (which have no trash — deletion is always permanent). */
  purgedNotebooks?: Record<string, string>;
}

// ==================== SUGGESTION TYPES ====================

export interface LinkSuggestion {
  id: string;
  title: string;
  type: WikiLinkType;
  /** Secondary info (folder name, file type, etc.) */
  subtitle?: string;
  icon?: string;
}
