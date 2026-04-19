/**
 * Filarr Notes — Types
 *
 * Data models for the knowledge-layer note system.
 */

// ==================== CORE NOTE TYPES ====================

export interface Note {
  id: string;
  title: string;
  /** TipTap JSON document content */
  content: string;
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
  /** Word count cache */
  wordCount: number;
  /** Tags associated with this note */
  tagIds: string[];
  /** Notebook this note belongs to */
  notebookId?: string;
  /** Pinned to top of list */
  isPinned: boolean;
  /** Freehand drawing overlay strokes (JSON-encoded Stroke[]) */
  drawingStrokes?: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
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
  createdAt: string;
  updatedAt: string;
}

// ==================== GRAPH TYPES ====================

export interface GraphNode {
  id: string;
  label: string;
  type: 'note' | 'file' | 'folder';
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
  type: 'note-note' | 'note-file' | 'note-folder';
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
  /** Current view mode */
  viewMode:
    | 'list'
    | 'grid'
    | 'graph'
    | 'masonry'
    | 'kanban'
    | 'sticky'
    | 'database'
    | 'tasks'
    | 'mindmap';
  /** Search within notes */
  searchQuery: string;
  /** Sort configuration */
  sortBy: 'title' | 'updatedAt' | 'createdAt' | 'wordCount';
  sortOrder: 'asc' | 'desc';
  /** Filter by parent folder */
  filterFolderId: string | null;
  /** Show only daily notes */
  filterDaily: boolean;
  /** Notebooks for grouping notes */
  notebooks: Record<string, Notebook>;
  /** Filter by notebook */
  filterNotebookId: string | null;
  /** Breadcrumb: recently visited note IDs (most recent last) */
  visitHistory: string[];
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
