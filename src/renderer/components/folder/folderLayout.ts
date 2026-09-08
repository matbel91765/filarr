/**
 * Dossiers personnalisables — LE PONT entre un dossier et le conteneur de mise
 * en page.
 *
 * ── RIEN N'EST ÉCRIT TANT QUE RIEN N'EST DEMANDÉ ────────────────────────────
 *
 * C'est LA contrainte qui commande tout ce fichier. Un compte a couramment
 * plusieurs milliers de dossiers ; si ouvrir un dossier écrivait ne serait-ce
 * qu'une vue vide dans `layout.enc`, le conteneur chiffré et SYNCHRONISÉ
 * gagnerait autant d'entrées que l'utilisateur a de dossiers — pour ne décrire
 * nulle part autre chose que « le réglage par défaut ». D'où :
 *
 *   · l'ABSENCE de vue `folder:<uuid>` est un état légitime, et c'est même le
 *     seul état par défaut. Elle se lit « Comme partout » ;
 *   · revenir à « Comme partout » RETIRE la vue au lieu d'y écrire un marqueur.
 *
 * ── LES TROIS PORTÉES ───────────────────────────────────────────────────────
 *
 *   · `global`  — « Comme partout ». Aucune vue. Le dossier suit les réglages
 *                 généraux et reste rigoureusement identique à ce qu'il était
 *                 avant que ce chantier existe.
 *   · `inherit` — « Comme le dossier parent ». Le BANDEAU et les PRÉFÉRENCES
 *                 D'AFFICHAGE viennent du premier ancêtre en portée `own`.
 *                 L'en-tête (icône, couverture) et la note d'accueil, eux,
 *                 restent PROPRES au dossier : ce sont son identité et son
 *                 contenu, pas des outils — hériter la couverture de son parent
 *                 rendrait douze sous-dossiers indiscernables les uns des autres.
 *   · `own`     — « Propre à ce dossier ». Tout vient de sa vue à lui.
 *
 * ── LE FORMAT N'A PAS BOUGÉ ─────────────────────────────────────────────────
 *
 * `layoutTypes` était DÉJÀ prêt : `LayoutViewId` est une chaîne libre et son
 * commentaire nomme `folder:<uuid>`. Rien n'a donc été ajouté au protocole, et
 * `electron/sync/layoutMergeCore.ts` — la source de vérité du FORMAT — n'a pas
 * à être porté.
 *
 * Les réglages qui ne sont pas des blocs (portée, en-tête, note d'accueil,
 * affichage) voyagent dans un EMPLACEMENT RÉSERVÉ, `folder-config`, rangé comme
 * les autres dans `LayoutView.slots`. Ce n'est pas un détournement : un
 * emplacement porte un `type` résolu contre le registre, et un type que le
 * registre ne connaît pas doit — c'est le contrat écrit dans `widgetRegistry` —
 * être CONSERVÉ tel quel. Une version plus ancienne de Filarr affichera donc un
 * dossier non personnalisé sans jamais perdre les réglages de la plus récente.
 * Sa géométrie est nulle et il est retiré de ce qu'on donne à la grille : il
 * n'occupe aucune case et ne peut ni être déplacé, ni sélectionné, ni retiré.
 */

import type {
  LayoutSlot,
  LayoutTemplate,
  LayoutView,
  LayoutViewId,
} from '../../../services/layout/layoutTypes';
import type { SortDirection, SortOption, ViewMode } from '../../../types';

// ==================== Identité de la vue ====================

/** Le préfixe qui dit la famille — voir `LayoutViewId`. */
export const FOLDER_VIEW_PREFIX = 'folder:';

/** La vue d'un dossier dans le document de mise en page. */
export function folderViewId(folderId: string): LayoutViewId {
  return `${FOLDER_VIEW_PREFIX}${folderId}`;
}

// ==================== L'emplacement réservé ====================

/**
 * Type de l'emplacement réservé. Il n'est PAS dans le registre de widgets, et
 * c'est volontaire : il ne s'affiche pas, ne s'insère pas depuis la palette et
 * n'a pas de format. Le registre reste la liste de ce qui se DESSINE.
 */
export const FOLDER_CONFIG_TYPE = 'folder-config';

/** Rôle symbolique, pour un gabarit qui traverserait `toTemplate`. */
export const FOLDER_CONFIG_ROLE = 'folder-config';

/**
 * Identité STABLE de l'emplacement réservé. Déterministe et non un uuid : si
 * deux appareils écrivent la configuration du même dossier, la fusion doit y
 * reconnaître un seul emplacement, pas deux empilés.
 */
export const FOLDER_CONFIG_SLOT_ID = 'folder:config';

// ==================== Le modèle ====================

export type FolderScope = 'global' | 'inherit' | 'own';

/** Les préférences d'affichage de la LISTE, surchargées par dossier. */
export interface FolderDisplay {
  viewMode: ViewMode;
  sortField: SortOption;
  sortOrder: SortDirection;
  groupField: 'none' | 'type' | 'date' | 'firstLetter';
  groupEnabled: boolean;
}

export interface FolderConfig {
  scope: FolderScope;
  /** Encodage brut de `Note.icon` (emoji | `lucide:id` | `img:dataUrl`). */
  icon?: string;
  coverPresetId?: string;
  coverImage?: string;
  coverPosition?: number;
  coverPositionX?: number;
  coverScale?: number;
  /** La note épinglée en haut du dossier — l'équivalent du README. */
  readmeNoteId?: string;
  /** Le pli de la note d'accueil. Dépliée par défaut : on l'a demandée. */
  readmeCollapsed?: boolean;
  /**
   * Le pli du bandeau. REPLIÉ par défaut, et c'est la loi nº1 : un dossier qui
   * n'a rien configuré ne doit pas gagner deux rangées de blocs.
   */
  bandCollapsed?: boolean;
  /** Préférences de liste propres au dossier, ou absentes ⇒ celles de partout. */
  display?: FolderDisplay;
}

/** La configuration d'un dossier qui n'a rien demandé. */
export const DEFAULT_FOLDER_CONFIG: FolderConfig = { scope: 'global' };

// ==================== Lecture DÉFENSIVE ====================
//
// `LayoutSlot.options` est un `Record<string, unknown>` qui a pu voyager :
// document fusionné depuis un autre appareil, version plus récente, fichier
// trafiqué. Rien de ce qui sort d'ici n'est cru sur parole.

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function readOneOf<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
}

const SCOPES: readonly FolderScope[] = ['global', 'inherit', 'own'];
const VIEW_MODES: readonly ViewMode[] = ['grid', 'list'];
const SORT_FIELDS: readonly SortOption[] = ['name', 'date', 'size', 'type'];
const SORT_ORDERS: readonly SortDirection[] = ['asc', 'desc'];
const GROUP_FIELDS = ['none', 'type', 'date', 'firstLetter'] as const;

function readDisplay(value: unknown): FolderDisplay | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  const viewMode = readOneOf(raw.viewMode, VIEW_MODES);
  const sortField = readOneOf(raw.sortField, SORT_FIELDS);
  const sortOrder = readOneOf(raw.sortOrder, SORT_ORDERS);
  const groupField = readOneOf(raw.groupField, GROUP_FIELDS);
  // Tout ou rien : une surcharge d'affichage à moitié lisible produirait une
  // liste triée par un champ et groupée par un autre sans que personne ne l'ait
  // demandé. Mieux vaut retomber sur les réglages de partout.
  if (!viewMode || !sortField || !sortOrder || !groupField) return undefined;
  return {
    viewMode,
    sortField,
    sortOrder,
    groupField,
    groupEnabled: readBoolean(raw.groupEnabled) ?? groupField !== 'none',
  };
}

// ==================== Vue ⇄ configuration ====================

/** L'emplacement réservé d'une vue, ou `undefined`. */
export function findConfigSlot(slots: readonly LayoutSlot[] | undefined): LayoutSlot | undefined {
  return slots?.find((slot) => slot.type === FOLDER_CONFIG_TYPE);
}

/**
 * La configuration portée par une vue, ou `null` si la vue n'existe pas / ne
 * porte pas d'emplacement réservé.
 *
 * Une vue SANS emplacement réservé mais AVEC des blocs (cas d'un document écrit
 * par une version future, ou d'un gabarit installé) se lit en portée `own` :
 * elle décrit bien quelque chose de propre à ce dossier.
 */
export function readFolderConfig(view: LayoutView | undefined): FolderConfig | null {
  return view ? readFolderConfigFromSlots(view.slots) : null;
}

/**
 * La même lecture, à partir des emplacements seuls — c'est ce que voit le
 * BROUILLON d'une session d'édition, qui n'a pas de vue à lui.
 */
export function readFolderConfigFromSlots(
  slots: readonly LayoutSlot[] | undefined
): FolderConfig | null {
  if (!slots) return null;
  const slot = findConfigSlot(slots);
  if (!slot) return slots.length > 0 ? { scope: 'own' } : null;
  const options = slot.options ?? {};
  return {
    scope: readOneOf(options.scope, SCOPES) ?? 'own',
    icon: readString(options.icon),
    coverPresetId: readString(options.coverPresetId),
    coverImage: readString(options.coverImage),
    coverPosition: readNumber(options.coverPosition),
    coverPositionX: readNumber(options.coverPositionX),
    coverScale: readNumber(options.coverScale),
    readmeNoteId: readString(slot.binding?.noteId),
    readmeCollapsed: readBoolean(options.readmeCollapsed),
    bandCollapsed: readBoolean(options.bandCollapsed),
    display: readDisplay(options.display),
  };
}

/** Les blocs du BANDEAU : tout sauf l'emplacement réservé. */
export function bandSlots(slots: readonly LayoutSlot[] | undefined): LayoutSlot[] {
  return (slots ?? []).filter((slot) => slot.type !== FOLDER_CONFIG_TYPE);
}

/** L'emplacement réservé, fabriqué à partir d'une configuration. */
function toConfigSlot(config: FolderConfig): LayoutSlot {
  const options: Record<string, unknown> = { scope: config.scope };
  if (config.icon !== undefined) options.icon = config.icon;
  if (config.coverPresetId !== undefined) options.coverPresetId = config.coverPresetId;
  if (config.coverImage !== undefined) options.coverImage = config.coverImage;
  if (config.coverPosition !== undefined) options.coverPosition = config.coverPosition;
  if (config.coverPositionX !== undefined) options.coverPositionX = config.coverPositionX;
  if (config.coverScale !== undefined) options.coverScale = config.coverScale;
  if (config.readmeCollapsed !== undefined) options.readmeCollapsed = config.readmeCollapsed;
  if (config.bandCollapsed !== undefined) options.bandCollapsed = config.bandCollapsed;
  if (config.display !== undefined) options.display = { ...config.display };

  const slot: LayoutSlot = {
    id: FOLDER_CONFIG_SLOT_ID,
    role: FOLDER_CONFIG_ROLE,
    type: FOLDER_CONFIG_TYPE,
    // Géométrie NULLE : cet emplacement ne va jamais à la grille, mais s'il y
    // arrivait un jour par un chemin qu'on n'a pas prévu, il n'y prendrait
    // aucune case au lieu d'ouvrir un trou d'une rangée.
    x: 0,
    y: 0,
    w: 0,
    h: 0,
    options,
  };
  // La note d'accueil est une ATTACHE LOCALE, comme toute citation d'un
  // identifiant du coffre : elle voyage dans `binding`, donc `toTemplate`
  // l'efface — un gabarit publié ne peut pas emporter l'identifiant d'une note.
  if (config.readmeNoteId) slot.binding = { noteId: config.readmeNoteId };
  return slot;
}

/**
 * Repose une configuration sur une liste de blocs. L'emplacement réservé passe
 * EN TÊTE : il ne coûte rien à la grille (qui ne le voit jamais) et il rend le
 * document lisible à l'œil nu quand on l'inspecte.
 */
export function withFolderConfig(slots: readonly LayoutSlot[], config: FolderConfig): LayoutSlot[] {
  return [toConfigSlot(config), ...bandSlots(slots)];
}

/**
 * Remplace les BLOCS d'une vue en gardant son emplacement réservé tel quel.
 * C'est le geste d'un gabarit : il décrit des blocs, pas le dossier — un modèle
 * qui effacerait la couverture et la note d'accueil en même temps que la
 * disposition serait un piège.
 */
export function replaceBand(
  slots: readonly LayoutSlot[],
  band: readonly LayoutSlot[]
): LayoutSlot[] {
  const reserved = slots.filter((slot) => slot.type === FOLDER_CONFIG_TYPE);
  return [...reserved, ...bandSlots(band)];
}

/**
 * La CEINTURE de la sortie du mode édition : si le brouillon a perdu son
 * emplacement réservé (un chemin qui remplace les emplacements en bloc, comme
 * le sélecteur de modèles d'accueil), on le refabrique à partir de ce qui
 * était STOCKÉ, en portée « propre » — c'est ce que la session décrivait. Un
 * brouillon qui l'a encore est rendu tel quel, identité comprise.
 */
export function ensureFolderConfig(
  slots: LayoutSlot[],
  stored: readonly LayoutSlot[]
): LayoutSlot[] {
  // Rendu TEL QUEL (même référence) : l'appelant s'en sert pour savoir s'il a
  // quelque chose de nouveau à empiler dans le brouillon.
  if (findConfigSlot(slots)) return slots;
  const fallback = readFolderConfigFromSlots(stored) ?? DEFAULT_FOLDER_CONFIG;
  return withFolderConfig(slots, { ...fallback, scope: 'own' });
}

/**
 * Rien de personnalisé ? Alors il n'y a RIEN à écrire, et l'appelant doit
 * retirer la vue plutôt que d'y ranger un enregistrement qui ne dit rien.
 */
export function isFolderPersonalized(config: FolderConfig, band: readonly LayoutSlot[]): boolean {
  if (config.scope === 'inherit') return true;
  if (config.scope === 'global') return false;
  return (
    band.length > 0 ||
    config.icon !== undefined ||
    config.coverPresetId !== undefined ||
    config.coverImage !== undefined ||
    config.readmeNoteId !== undefined ||
    config.display !== undefined ||
    config.bandCollapsed === false
  );
}

// ==================== Le catalogue de la palette ====================

/** Le préfixe des blocs écrits pour un dossier — voir `widgetRegistry`. */
export const FOLDER_WIDGET_PREFIX = 'folder-';

/**
 * Ce que le bandeau n'offre PAS. « Tous les dossiers » est un bloc de PAGE
 * (12×6, 608 px) : posé dans un bandeau borné à 368 px il défile dans son
 * cadre, et ses cartes glissables sont branchées ici sur des rappels muets.
 * Il reste SERVI si une disposition le porte — seule la palette le tait.
 */
export const FOLDER_BAND_EXCLUDED_TYPES: readonly string[] = ['folder-grid'];

/**
 * Le catalogue de la palette d'un DOSSIER : blocs « de ce dossier » en tête,
 * le reste dans l'ordre du registre, sans les retirés ni les blocs de page.
 * Le registre range les blocs contextuels en FIN de liste pour que la palette
 * de l'accueil n'ouvre pas sur six blocs qui parlent d'« ici » — dans un
 * dossier c'est l'inverse qu'on veut, et le tri stable garde l'ordre écrit à
 * l'intérieur de chaque famille.
 */
export function folderPaletteCatalog<T extends { type: string; retired?: true }>(
  definitions: readonly T[]
): T[] {
  const offered = definitions.filter(
    (definition) => !definition.retired && !FOLDER_BAND_EXCLUDED_TYPES.includes(definition.type)
  );
  const contextual = offered.filter((definition) =>
    definition.type.startsWith(FOLDER_WIDGET_PREFIX)
  );
  const others = offered.filter((definition) => !definition.type.startsWith(FOLDER_WIDGET_PREFIX));
  return [...contextual, ...others];
}

// ==================== Les gabarits de bandeau ====================

/**
 * UNE RANGÉE, DEUX BLOCS. C'est la forme que prend un bandeau qu'on n'a pas
 * réglé, et elle porte la règle du chantier : « une à deux rangées AU-DESSUS de
 * la liste, jamais à la place ». Un gabarit de six blocs aurait repoussé le
 * premier fichier sous la ligne de flottaison dès le premier clic, et la
 * personnalisation se serait annoncée comme une gêne.
 *
 * Horloge fixe à l'époque : ces gabarits sont du CODE, pas des données. Une
 * horloge vivante les ferait gagner contre un gabarit que l'utilisateur a
 * réellement modifié.
 */
export const FOLDER_BAND_TEMPLATES: readonly LayoutTemplate[] = [
  {
    id: 'filarr.folder.essential',
    name: 'Essentiel du dossier',
    updatedAt: '1970-01-01T00:00:00.000Z',
    version: 1,
    author: 'Filarr',
    slots: [
      { role: 'recents', type: 'folder-recents', x: 0, y: 0, w: 6, h: 2 },
      { role: 'activity', type: 'folder-activity', x: 6, y: 0, w: 6, h: 2 },
    ],
  },
  {
    id: 'filarr.folder.workspace',
    name: 'Espace de travail',
    updatedAt: '1970-01-01T00:00:00.000Z',
    version: 1,
    author: 'Filarr',
    slots: [
      { role: 'tasks', type: 'folder-tasks', x: 0, y: 0, w: 6, h: 2 },
      { role: 'favorites', type: 'folder-pinned', x: 6, y: 0, w: 6, h: 2 },
      { role: 'storage', type: 'folder-storage', x: 0, y: 2, w: 3, h: 1 },
    ],
  },
];

// ==================== Résolution avec héritage ====================

export interface ResolvedFolderLayout {
  /** La portée DÉCLARÉE par ce dossier (jamais celle de son ancêtre). */
  scope: FolderScope;
  /** La configuration propre au dossier : en-tête et note d'accueil. */
  own: FolderConfig;
  /** Les blocs du bandeau, éventuellement HÉRITÉS. */
  band: LayoutSlot[];
  /** Les préférences de liste, éventuellement HÉRITÉES, ou `null`. */
  display: FolderDisplay | null;
  /** Le pli du bandeau, éventuellement HÉRITÉ. Replié par défaut. */
  bandCollapsed: boolean;
  /** Le dossier d'où viennent `band`/`display`, s'il n'est pas celui-ci. */
  inheritedFrom: string | null;
}

/**
 * Ce qu'il faut afficher pour un dossier, héritage résolu.
 *
 * `ancestorIds` va du PARENT direct vers la racine. La remontée s'arrête au
 * premier ancêtre en portée `own` : un ancêtre lui-même en `inherit` n'a rien à
 * transmettre qu'il n'ait d'abord reçu, et la chaîne est donc parcourue une
 * seule fois, sans récursion et sans risque de cycle (un cycle dans l'arbre des
 * dossiers ferait au pire une remontée bornée par la longueur de la liste).
 */
export function resolveFolderLayout(
  views: Record<LayoutViewId, LayoutView>,
  folderId: string,
  ancestorIds: readonly string[]
): ResolvedFolderLayout {
  const own = readFolderConfig(views[folderViewId(folderId)]) ?? DEFAULT_FOLDER_CONFIG;

  const empty: ResolvedFolderLayout = {
    scope: own.scope,
    own,
    band: [],
    display: null,
    bandCollapsed: true,
    inheritedFrom: null,
  };

  if (own.scope === 'global') return empty;

  if (own.scope === 'own') {
    const view = views[folderViewId(folderId)];
    return {
      ...empty,
      band: bandSlots(view?.slots),
      display: own.display ?? null,
      bandCollapsed: own.bandCollapsed ?? true,
    };
  }

  // ── « Comme le dossier parent » ─────────────────────────────────────────
  for (const ancestorId of ancestorIds) {
    const view = views[folderViewId(ancestorId)];
    const config = readFolderConfig(view);
    if (!config || config.scope !== 'own') continue;
    return {
      ...empty,
      band: bandSlots(view?.slots),
      // Même règle que le pli : l'affichage PROPRE du dossier prime, celui de
      // l'ancêtre ne sert que s'il n'a rien dit. C'est dans le dossier COURANT
      // que la barre de tri écrit — un affichage écrit ici et lu chez l'ancêtre
      // serait enregistré à chaque geste puis ignoré au rendu suivant.
      display: own.display ?? config.display ?? null,
      // Le PLI est une préférence de vue, pas un réglage transmis : replier le
      // bandeau ici ne doit pas le replier chez le parent, ni chez les onze
      // autres dossiers qui héritent du même. Celui du dossier prime donc, et on
      // ne retombe sur celui de l'ancêtre que s'il n'a rien dit.
      bandCollapsed: own.bandCollapsed ?? config.bandCollapsed ?? true,
      inheritedFrom: ancestorId,
    };
  }

  // Aucun ancêtre n'a de réglage propre : « comme le parent » vaut alors
  // « comme partout ». On ne remonte PAS à un défaut inventé, et on n'écrit
  // rien pour autant — la portée déclarée reste `inherit`, et elle recommencera
  // à hériter le jour où un ancêtre sera personnalisé.
  return empty;
}
