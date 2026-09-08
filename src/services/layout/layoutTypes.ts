/**
 * Modèle de données de la MISE EN PAGE MODULAIRE — côté renderer.
 *
 * ⚠ PORTAGE À L'IDENTIQUE de `electron/sync/layoutMergeCore.ts`, qui reste la
 * source de vérité du FORMAT et porte la règle de fusion. La duplication est
 * délibérée : `electron/tsconfig.json` a pour racine `electron/`, donc importer
 * un module de `src/` déplacerait toute l'arborescence émise dans
 * `dist-electron` et casserait `package.json#main` — exactement la raison qui
 * fait coexister `notesMergeCore.ts` et `src/platform/web/sync/notesMerge.ts`.
 * Toute évolution du format doit être portée DES DEUX CÔTÉS.
 *
 * ── LA DISTINCTION QUI COMMANDE TOUT LE RESTE ───────────────────────────────
 *
 *  · L'INSTANCE (`LayoutView`) est ce que CET utilisateur a posé sur CETTE vue.
 *    Elle cite des identifiants LOCAUX (dossiers, notes) dans `binding`. Elle se
 *    synchronise entre ses appareils, et elle ne s'exporte JAMAIS telle quelle :
 *    la donner à quelqu'un d'autre lui livrerait des uuid qui ne désignent rien
 *    chez lui — et, pire, la structure de son coffre à lui.
 *
 *  · Le GABARIT (`LayoutTemplate`) est une disposition PARTAGEABLE. Chacun de
 *    ses emplacements porte un RÔLE SYMBOLIQUE (`recents`, `favorites`,
 *    `folder-grid`, `stats`…) et rien d'autre. C'est ce qu'on publie, ce qu'on
 *    installe, ce qui alimentera la place de marché.
 *
 * `instantiate(gabarit, contexte)` est le pont entre les deux, et le seul.
 */

// ── Constantes de protocole (miroir de layoutMergeCore) ─────────────────────

export const LAYOUT_SCHEMA_VERSION = 1;

/** Horloge des vues issues de l'amorçage — voir `layoutMergeCore`. */
export const LAYOUT_SEED_CLOCK = '1970-01-01T00:00:00.000Z';

/** Rôles connus à ce jour — liste INDICATIVE, jamais contraignante. */
export const KNOWN_SLOT_ROLES = [
  'recents',
  'favorites',
  'folder-grid',
  'stats',
  'notes',
  'tasks',
  'calendar',
  'quick-actions',
  'search',
  'storage',
] as const;

// ── Types ───────────────────────────────────────────────────────────────────

export type LayoutSlotRole = string;

/** `home` | `folder:<uuid>` | `home:alt` — le préfixe dit la famille. */
export type LayoutViewId = string;

export interface LayoutSlot {
  /** Identité stable du bloc DANS la vue — pas un identifiant de dossier. */
  id: string;
  role: LayoutSlotRole;
  type: string;
  x: number;
  y: number;
  w: number;
  h: number;
  options?: Record<string, unknown>;
  /** Attaches LOCALES — c'est ce champ qui interdit d'exporter une instance. */
  binding?: Record<string, string>;
}

export interface SupersededLayout {
  slots: LayoutSlot[];
  updatedAt: string;
  savedAt: string;
  side: 'local' | 'remote';
}

export interface LayoutView {
  id: LayoutViewId;
  slots: LayoutSlot[];
  /** Horloge PROPRE à cette entrée : le seul arbitre de la fusion. */
  updatedAt: string;
  templateId?: string;
  /** Dispositions écartées par un arbitrage, conservées 30 jours. */
  superseded?: SupersededLayout[];
}

export interface LayoutTemplateSlot {
  role: LayoutSlotRole;
  type: string;
  x: number;
  y: number;
  w: number;
  h: number;
  options?: Record<string, unknown>;
}

export interface LayoutTemplate {
  id: string;
  name: string;
  slots: LayoutTemplateSlot[];
  updatedAt: string;
  version?: number;
  author?: string;
}

export interface LayoutDocument {
  schema: number;
  views: Record<LayoutViewId, LayoutView>;
  templates: Record<string, LayoutTemplate>;
  /** Amorçage fait — marqué dans le conteneur, pas en `localStorage`. */
  seededAt?: string;
  updatedAt?: string;
}

/** Réponse du canal `layout:load`. */
export interface LayoutLoadResult {
  document: LayoutDocument;
  /**
   * `false` = rien n'a encore été amorcé pour ce profil parce que le nuage
   * porte une mise en page qui n'est pas descendue. Le document rendu est vide
   * et PROVISOIRE : ne rien écrire par-dessus, réessayer après `layout-updated`.
   */
  seeded: boolean;
}

/** Préférences relevées par le renderer pour l'amorçage (jamais effacées). */
export interface LayoutSeedHints {
  homeRecentNotes?: boolean;
  dashboardCollapsed?: boolean;
  display?: {
    compactMode?: boolean;
    gridSize?: 'small' | 'medium' | 'large';
    defaultViewMode?: string;
  };
}

// ── Gabarit → instance ──────────────────────────────────────────────────────

/**
 * Ce qu'il faut savoir de l'appareil et du coffre pour poser un gabarit.
 * `resolveBinding` traduit un RÔLE en attaches locales : c'est le seul endroit
 * où un identifiant de dossier entre dans une disposition.
 */
export interface InstantiateContext {
  /** Vue cible (`home`, `folder:<uuid>`…). */
  viewId: LayoutViewId;
  /** Fabrique d'identifiants d'emplacement (injectée pour rester pure/testable). */
  newSlotId: () => string;
  /** Horloge de la vue produite. */
  now: string;
  /**
   * Attaches locales pour un rôle donné, ou `undefined` si le rôle n'en
   * réclame aucune. Un rôle que le contexte ne sait pas résoudre est CONSERVÉ
   * sans attache : le bloc s'affichera vide plutôt que de disparaître en
   * silence d'une disposition que l'utilisateur vient de choisir.
   */
  resolveBinding?: (role: LayoutSlotRole, index: number) => Record<string, string> | undefined;
}

/**
 * Transforme un GABARIT en INSTANCE. Fonction PURE : elle ne lit rien, n'écrit
 * rien, et tout ce qui varie (identifiants, horloge, attaches) lui est donné.
 *
 * Ce qui traverse : la géométrie, le rôle, le type, les options.
 * Ce qui NAÎT ici : l'identité de chaque emplacement et ses attaches locales.
 * Ce qui ne traverse JAMAIS dans l'autre sens : `binding` — un gabarit publié à
 * partir d'une instance doit repasser par `toTemplate`, qui les efface.
 */
export function instantiate(template: LayoutTemplate, context: InstantiateContext): LayoutView {
  const slots: LayoutSlot[] = template.slots.map((slot, index) => {
    const instance: LayoutSlot = {
      id: context.newSlotId(),
      role: slot.role,
      type: slot.type,
      x: slot.x,
      y: slot.y,
      w: slot.w,
      h: slot.h,
    };
    if (slot.options) instance.options = { ...slot.options };
    const binding = context.resolveBinding?.(slot.role, index);
    if (binding && Object.keys(binding).length > 0) instance.binding = binding;
    return instance;
  });

  return {
    id: context.viewId,
    slots,
    updatedAt: context.now,
    templateId: template.id,
  };
}

/**
 * Le chemin inverse : une instance redevient un gabarit PARTAGEABLE. Les
 * attaches et les identités d'emplacement sont retirées — c'est précisément ce
 * qui rend le résultat publiable.
 */
export function toTemplate(
  view: LayoutView,
  meta: { id: string; name: string; now: string; version?: number; author?: string }
): LayoutTemplate {
  const template: LayoutTemplate = {
    id: meta.id,
    name: meta.name,
    updatedAt: meta.now,
    slots: view.slots.map((slot) => {
      const out: LayoutTemplateSlot = {
        role: slot.role,
        type: slot.type,
        x: slot.x,
        y: slot.y,
        w: slot.w,
        h: slot.h,
      };
      if (slot.options) out.options = { ...slot.options };
      return out;
    }),
  };
  if (meta.version !== undefined) template.version = meta.version;
  if (meta.author !== undefined) template.author = meta.author;
  return template;
}

/** Document vide — miroir de `createEmptyLayoutDocument` côté principal. */
export function createEmptyLayoutDocument(): LayoutDocument {
  return { schema: LAYOUT_SCHEMA_VERSION, views: {}, templates: {} };
}
