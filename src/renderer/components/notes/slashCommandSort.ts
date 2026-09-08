/**
 * Classement du menu « / » — Filarr Notes
 *
 * Logique PURE (aucun JSX, aucun DOM) pour que le tri soit testable seul :
 * `SlashCommandMenu.tsx` ne fait que rendre l'ordre calculé ici.
 *
 * Deux régimes, parce que l'utilisateur ne cherche pas la même chose :
 *  - sans requête, le menu est un CATALOGUE → sections thématiques, ordre de
 *    déclaration à l'intérieur (le plus courant en premier), précédées des
 *    commandes récemment utilisées ;
 *  - avec une requête, le menu est un MOTEUR DE RECHERCHE → liste à plat
 *    classée par pertinence, la meilleure correspondance en tête pour que
 *    « Entrée » tombe juste.
 */

// ==================== Groupes ====================

export type SlashGroup = 'basic' | 'format' | 'layout' | 'callout' | 'media' | 'pages' | 'advanced';

/** Ordre d'affichage des sections. */
export const SLASH_GROUP_ORDER: SlashGroup[] = [
  'basic',
  'format',
  'layout',
  'callout',
  'media',
  'pages',
  'advanced',
];

/** Libellés anglais de repli (les traductions vivent sous `notes.slash.group.*`). */
export const SLASH_GROUP_FALLBACK_LABELS: Record<SlashGroup, string> = {
  basic: 'Basic blocks',
  format: 'Format',
  layout: 'Layout',
  callout: 'Callouts',
  media: 'Media',
  pages: 'Pages & links',
  advanced: 'Advanced',
};

/** Clé de la section des récents (jamais un `SlashGroup` : elle est transverse). */
export const SLASH_RECENT_SECTION = 'recent' as const;

export type SlashSectionKey = SlashGroup | typeof SLASH_RECENT_SECTION;

// ==================== Contrat minimal ====================

/**
 * Ce que le tri consomme réellement d'une commande. Volontairement plus étroit
 * que `SlashCommandItem` (qui porte une icône React et une action) : ça garde
 * ce module hors de tout arbre React.
 */
export interface SortableSlashItem {
  id: string;
  aliases?: string[];
  group: SlashGroup;
}

/** Libellé et description RÉSOLUS (i18n) — injectés, jamais devinés ici. */
export interface SlashText {
  label: string;
  description: string;
}

export interface SlashSortContext<T extends SortableSlashItem> {
  /** Résolution i18n du couple libellé/description. */
  resolve: (item: T) => SlashText;
  /** Identifiants récemment utilisés, du plus récent au plus ancien. */
  recents?: string[];
  /** Ordre canonique (déclaration) — départage à score égal. */
  order?: (item: T) => number;
}

// ==================== Score ====================

/**
 * Pertinence d'une commande pour une requête déjà normalisée (minuscules,
 * espaces coupés). Les paliers sont larges (20 points) pour que la récence,
 * qui vaut au plus 5, ne renverse JAMAIS un palier : elle départage entre
 * égaux, elle ne remonte pas une correspondance faible au-dessus d'une forte.
 */
export function scoreSlashItem(item: SortableSlashItem, query: string, text: SlashText): number {
  if (!query) return 0;

  const label = text.label.toLowerCase();
  const description = text.description.toLowerCase();
  const aliases = (item.aliases ?? []).map((a) => a.toLowerCase());

  if (label === query || aliases.includes(query)) return 100;
  if (label.startsWith(query)) return 80;
  if (aliases.some((a) => a.startsWith(query))) return 60;
  if (label.includes(query)) return 40;
  if (aliases.some((a) => a.includes(query))) return 30;
  if (description.includes(query)) return 10;
  return 0;
}

/** Bonus de récence : 5 pour la dernière commande utilisée, dégressif, 0 au-delà. */
function recencyBonus(id: string, recents: string[]): number {
  const rank = recents.indexOf(id);
  if (rank < 0) return 0;
  return Math.max(0, 5 - rank);
}

// ==================== Tri ====================

/**
 * Rend une COPIE triée. Le tableau d'entrée est déjà filtré par l'extension :
 * ce tri n'élimine rien, il ordonne.
 */
export function sortSlashItems<T extends SortableSlashItem>(
  items: T[],
  query: string,
  ctx: SlashSortContext<T>
): T[] {
  const q = query.trim().toLowerCase();
  const recents = ctx.recents ?? [];
  const declared = new Map(items.map((item, index) => [item.id, ctx.order?.(item) ?? index]));
  const rank = (item: T) => declared.get(item.id) ?? 0;

  if (!q) {
    // Catalogue : sections dans l'ordre canonique, déclaration à l'intérieur.
    // Les récents ne sont PAS retirés de leur section — ils y sont juste
    // dupliqués en tête (voir `buildSlashSections`), pour que la mémoire
    // musculaire « la table est dans Mise en page » reste vraie.
    return [...items].sort((a, b) => {
      const ga = SLASH_GROUP_ORDER.indexOf(a.group);
      const gb = SLASH_GROUP_ORDER.indexOf(b.group);
      if (ga !== gb) return ga - gb;
      return rank(a) - rank(b);
    });
  }

  const scored = items.map((item) => ({
    item,
    score: scoreSlashItem(item, q, ctx.resolve(item)) + recencyBonus(item.id, recents),
  }));

  return scored
    .sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score;
      return rank(a.item) - rank(b.item);
    })
    .map((entry) => entry.item);
}

// ==================== Sections ====================

/** Onglet « tout », en tête du rail pendant une recherche. */
export const SLASH_ALL_SECTION = 'all' as const;

export type SlashRailKey = SlashSectionKey | typeof SLASH_ALL_SECTION;

export interface SlashSection<T> {
  key: SlashSectionKey;
  items: T[];
}

/**
 * Découpe la liste TRIÉE en catégories affichables (le rail de gauche).
 *
 * Une seule règle change entre les deux régimes : « Récents » n'apparaît que
 * sans requête — pendant une recherche, la pertinence a déjà classé, et une
 * catégorie transverse ne ferait qu'ajouter des doublons en haut du rail.
 * L'ordre à l'intérieur d'une catégorie est celui de `sorted` : déclaration
 * sans requête, pertinence avec.
 */
export function buildSlashSections<T extends SortableSlashItem>(
  sorted: T[],
  query: string,
  recents: string[] = [],
  recentLimit = 5
): SlashSection<T>[] {
  const sections: SlashSection<T>[] = [];

  if (!query.trim()) {
    const byId = new Map(sorted.map((item) => [item.id, item]));
    const recentItems = recents
      .map((id) => byId.get(id))
      .filter((item): item is T => item !== undefined)
      .slice(0, recentLimit);
    if (recentItems.length > 0) sections.push({ key: SLASH_RECENT_SECTION, items: recentItems });
  }

  for (const group of SLASH_GROUP_ORDER) {
    const groupItems = sorted.filter((item) => item.group === group);
    if (groupItems.length > 0) sections.push({ key: group, items: groupItems });
  }
  return sections;
}

// ==================== Récents ====================

/**
 * Fusion d'un usage dans la liste des récents (le plus récent en tête, sans
 * doublon, plafonnée). Ici plutôt que dans le module de stockage : c'est la
 * seule partie testable sans `localStorage`.
 */
export function mergeRecent(recents: string[], id: string, max: number): string[] {
  return [id, ...recents.filter((entry) => entry !== id)].slice(0, max);
}
