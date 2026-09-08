/**
 * viewEngine — Filarr Notes / bases inline
 *
 * Moteur PUR des vues enregistrées : familles d'opérateurs, filtrage, tri
 * multi-niveaux, migration des bases d'avant les vues, et nettoyage des vues
 * quand le schéma bouge. Aucun React, aucun DOM : tout est testable seul.
 *
 * Deux règles gouvernent les comparaisons :
 *  - le filtre est d'accord avec ce qu'on VOIT (une valeur d'un type inattendu
 *    s'affiche vide dans la table, elle est donc vide pour le moteur) ;
 *  - un filtre incomplet est inerte (il ne masque rien) — jamais destructeur.
 */

import type {
  DbFilter,
  DbFilterOp,
  DbProperty,
  DbRow,
  DbSort,
  DbView,
  DbViewType,
  InlineDbData,
  PropertyType,
} from './types';
import { makeDefaultView } from './types';
import type { BoardSettings } from './boardLayout';
import { isSummarizable } from './boardLayout';
import type { FilterFamily } from './cellValues';
import {
  cellValueFor,
  dayStamp,
  filterFamily,
  fullStamp,
  isEmptyCellBase,
  numberOf,
  optionIds,
  selectedOptionIds,
  textOf,
} from './cellValues';
import type { DbEnv, DbLinkContext } from './relations';
import { relationText, resolveRelation, rollupNumber } from './relations';

// ==================== Familles de types ====================

/**
 * Les lecteurs de cellules vivent dans `cellValues` (partagés avec le moteur
 * des relations) ; ils restent exportés d'ici, qui est le point d'entrée connu
 * des vues.
 */
export type { FilterFamily, DbEnv, DbLinkContext };
export { filterFamily, cellValueFor };

/**
 * « vide » et « non vide » vont à TOUTES les familles sauf la case à cocher,
 * qui est toujours dans un état (cf. le contrat de DbFilterOp) : le moteur les
 * traite génériquement par `isEmptyCell`, la table doit donc les proposer.
 *
 * `relation` : `contient` porte sur les TITRES des lignes liées — le même geste
 * mental que le « contient » du texte, et le seul qui se saisisse sans ouvrir
 * la base visée. `rollup` : un agrégat se compare comme le nombre qu'il est.
 */
export const FAMILY_OPS: Record<FilterFamily, readonly DbFilterOp[]> = {
  text: ['contains', 'notContains', 'equals', 'isEmpty', 'isNotEmpty'],
  number: ['eq', 'neq', 'gt', 'lt', 'gte', 'lte', 'isEmpty', 'isNotEmpty'],
  select: ['is', 'isNot', 'isEmpty', 'isNotEmpty'],
  multiSelect: ['contains', 'notContains', 'isEmpty', 'isNotEmpty'],
  checkbox: ['isChecked', 'isUnchecked'],
  date: ['before', 'after', 'on', 'isEmpty', 'isNotEmpty'],
  relation: ['contains', 'notContains', 'isEmpty', 'isNotEmpty'],
  rollup: ['eq', 'neq', 'gt', 'lt', 'gte', 'lte', 'isEmpty', 'isNotEmpty'],
};

const LINK_ONLY_OPS: readonly DbFilterOp[] = ['isEmpty', 'isNotEmpty'];

/** Opérateurs proposés pour un type — l'UI et le nettoyage lisent la même table */
export function opsForType(type: PropertyType): readonly DbFilterOp[] {
  const family = filterFamily(type);
  return family ? FAMILY_OPS[family] : LINK_ONLY_OPS;
}

export function isOpValidForType(type: PropertyType, op: DbFilterOp): boolean {
  return opsForType(type).includes(op);
}

/** Opérateurs sans terme de comparaison (l'UI n'affiche alors aucun champ) */
export function opNeedsValue(op: DbFilterOp): boolean {
  return op !== 'isEmpty' && op !== 'isNotEmpty' && op !== 'isChecked' && op !== 'isUnchecked';
}

/** Types dont on peut trier (le lien vers une note ne porte qu'un id opaque) */
export function isSortableType(type: PropertyType): boolean {
  return type !== 'note';
}

// ==================== Lecture douce des cellules ====================

/**
 * « Vide » au sens de l'AFFICHAGE : une valeur d'un type inattendu, ou une
 * option supprimée, n'apparaît nulle part — elle est donc vide ici aussi.
 *
 * Toujours jugé sur la VRAIE ligne, jamais sur une cellule isolée : un agrégat
 * ne lit pas sa propre cellule (rien n'y est stocké), il suit la relation
 * VOISINE — une ligne de circonstance qui ne porterait que la cellule jugée
 * ferait donc rendre 0 à un `count`, et déclarerait la cellule vide à tort.
 *
 * Relations et agrégats se jugent sur ce qu'ils montrent, d'où l'environnement :
 *  - une relation dont plus aucune ligne visée n'existe est vide, MAIS une
 *    relation dont la base est introuvable ne l'est pas : elle garde des
 *    identifiants, et la table affiche « base indisponible » ;
 *  - un agrégat est vide dès qu'il ne rend pas de nombre.
 */
export function isEmptyCell(prop: DbProperty, row: DbRow, env?: DbEnv | null): boolean {
  return isEmptyCellForRow(prop, row, cellValueFor(prop, row), env);
}

/** Même décision, la valeur de la cellule étant déjà lue (chemin du filtrage) */
function isEmptyCellForRow(
  prop: DbProperty,
  row: DbRow,
  value: unknown,
  env?: DbEnv | null
): boolean {
  if (prop.type === 'relation') {
    const res = resolveRelation(prop, row, env);
    // Cible introuvable : la valeur EXISTE toujours, elle est seulement
    // illisible — la dire vide inviterait un filtre à l'effacer de la vue
    if (res.status === 'unavailable') return res.ids.length === 0;
    if (res.status === 'unset') return isEmptyCellBase(prop, value);
    return res.links.length === 0;
  }
  if (prop.type === 'rollup') return rollupNumber(prop, row, env) === null;
  return isEmptyCellBase(prop, value);
}

// ==================== Filtrage ====================

/** Vrai = la ligne passe. Un filtre inapplicable ou incomplet ne masque rien. */
export function matchesFilter(
  prop: DbProperty | undefined,
  row: DbRow,
  filter: DbFilter,
  env?: DbEnv | null
): boolean {
  // Propriété disparue ou opérateur d'une autre famille : filtre inerte
  if (!prop || !isOpValidForType(prop.type, filter.op)) return true;

  const value = cellValueFor(prop, row);

  switch (filter.op) {
    case 'isEmpty':
      return isEmptyCellForRow(prop, row, value, env);
    case 'isNotEmpty':
      return !isEmptyCellForRow(prop, row, value, env);
    case 'isChecked':
      return value === true;
    case 'isUnchecked':
      return value !== true;
    default:
      break;
  }

  switch (filterFamily(prop.type)) {
    case 'relation': {
      const needle = typeof filter.value === 'string' ? filter.value.trim().toLowerCase() : '';
      if (needle === '') return true;
      const hay = relationText(prop, row, env);
      // Base visée inconnue : on ne sait rien des titres, le filtre est inerte
      if (hay === null) return true;
      const found = hay.toLowerCase().includes(needle);
      return filter.op === 'contains' ? found : !found;
    }
    case 'rollup': {
      const target = numberOf(filter.value);
      if (target === null) return true;
      const n = rollupNumber(prop, row, env);
      // Comme un nombre vide : ni égal, ni comparable — seul « ≠ » l'accepte
      if (n === null) return filter.op === 'neq';
      switch (filter.op) {
        case 'eq':
          return n === target;
        case 'neq':
          return n !== target;
        case 'gt':
          return n > target;
        case 'lt':
          return n < target;
        case 'gte':
          return n >= target;
        case 'lte':
          return n <= target;
        default:
          return true;
      }
    }
    case 'text': {
      const needle = typeof filter.value === 'string' ? filter.value.trim().toLowerCase() : '';
      if (needle === '') return true;
      const hay = textOf(value).toLowerCase();
      if (filter.op === 'contains') return hay.includes(needle);
      if (filter.op === 'notContains') return !hay.includes(needle);
      if (filter.op === 'equals') return hay === needle;
      return true;
    }
    case 'number': {
      const target = numberOf(filter.value);
      if (target === null) return true;
      const n = numberOf(value);
      // Une cellule vide n'est ni égale ni comparable : seul « ≠ » l'accepte
      if (n === null) return filter.op === 'neq';
      switch (filter.op) {
        case 'eq':
          return n === target;
        case 'neq':
          return n !== target;
        case 'gt':
          return n > target;
        case 'lt':
          return n < target;
        case 'gte':
          return n >= target;
        case 'lte':
          return n <= target;
        default:
          return true;
      }
    }
    case 'select': {
      const target = typeof filter.value === 'string' ? filter.value : '';
      if (target === '') return true;
      // Comparaison par IDENTIFIANT d'option (renommer une option ne change rien)
      const current = typeof value === 'string' && optionIds(prop).has(value) ? value : '';
      return filter.op === 'is' ? current === target : current !== target;
    }
    case 'multiSelect': {
      const target = typeof filter.value === 'string' ? filter.value : '';
      if (target === '') return true;
      const ids = selectedOptionIds(prop, value);
      return filter.op === 'contains' ? ids.includes(target) : !ids.includes(target);
    }
    case 'date': {
      const target = dayStamp(filter.value);
      if (target === null) return true;
      const day = dayStamp(value);
      // Une date absente n'est ni avant, ni après, ni « le »
      if (day === null) return false;
      if (filter.op === 'before') return day < target;
      if (filter.op === 'after') return day > target;
      if (filter.op === 'on') return day === target;
      return true;
    }
    default:
      return true;
  }
}

function propertyIndex(properties: DbProperty[]): Map<string, DbProperty> {
  return new Map(properties.map((p) => [p.id, p]));
}

/**
 * Environnement d'évaluation d'une base : son schéma (une propriété rollup a
 * besoin de retrouver la relation qu'elle suit) et, quand la couche React le
 * fournit, l'index des bases visées. Sans lui, relations et agrégats sont
 * simplement illisibles — donc inertes, jamais faussement vides.
 */
function envFor(data: InlineDbData, ctx?: DbLinkContext | null): DbEnv {
  return { properties: data.properties, ...(ctx ? { ctx } : {}) };
}

export function applyFilters(
  data: InlineDbData,
  filters: DbFilter[],
  ctx?: DbLinkContext | null
): DbRow[] {
  if (filters.length === 0) return data.rows;
  const props = propertyIndex(data.properties);
  const env = envFor(data, ctx);
  // Combinaison ET uniquement (v1) : une seule condition fausse suffit à masquer
  return data.rows.filter((row) =>
    filters.every((f) => matchesFilter(props.get(f.propertyId), row, f, env))
  );
}

// ==================== Tri ====================

interface SortKey {
  empty: boolean;
  num: number | null;
  str: string | null;
}

const EMPTY_KEY: SortKey = { empty: true, num: null, str: null };

let collatorCache: Intl.Collator | null = null;
function collator(): Intl.Collator {
  if (!collatorCache) {
    // numeric : « Item 2 » avant « Item 10 » ; base : accents et casse ignorés
    collatorCache = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  }
  return collatorCache;
}

function sortKeyFor(prop: DbProperty, row: DbRow, env?: DbEnv | null): SortKey {
  const value = cellValueFor(prop, row);
  switch (prop.type) {
    case 'relation': {
      // Trié sur ce qu'on LIT : les titres liés, mis bout à bout. Cible inconnue
      // (base indisponible) → vide, donc rejeté en fin de tri sans faux ordre.
      const text = relationText(prop, row, env);
      return text === null || text === '' ? EMPTY_KEY : { empty: false, num: null, str: text };
    }
    case 'rollup': {
      const n = rollupNumber(prop, row, env);
      return n === null ? EMPTY_KEY : { empty: false, num: n, str: null };
    }
    case 'checkbox':
      // Jamais vide : décochée d'abord en ordre croissant
      return { empty: false, num: value === true ? 1 : 0, str: null };
    case 'number':
    case 'rating':
    case 'progress': {
      const n = numberOf(value);
      return n === null ? EMPTY_KEY : { empty: false, num: n, str: null };
    }
    case 'date': {
      const d = dayStamp(value);
      return d === null ? EMPTY_KEY : { empty: false, num: d, str: null };
    }
    case 'createdTime':
    case 'updatedTime': {
      const t = fullStamp(value);
      return t === null ? EMPTY_KEY : { empty: false, num: t, str: null };
    }
    case 'select': {
      // Ordre du SCHÉMA (comme les colonnes du board), pas ordre alphabétique
      const idx = (prop.options ?? []).findIndex((o) => o.id === value);
      return idx < 0 ? EMPTY_KEY : { empty: false, num: idx, str: null };
    }
    case 'multiSelect': {
      const ids = selectedOptionIds(prop, value);
      if (ids.length === 0) return EMPTY_KEY;
      const options = prop.options ?? [];
      const idx = Math.min(...ids.map((id) => options.findIndex((o) => o.id === id)));
      return { empty: false, num: idx, str: null };
    }
    default: {
      const s = textOf(value);
      return s === '' ? EMPTY_KEY : { empty: false, num: null, str: s };
    }
  }
}

function compareKeys(a: SortKey, b: SortKey): number {
  if (a.num !== null && b.num !== null) return a.num < b.num ? -1 : a.num > b.num ? 1 : 0;
  return collator().compare(a.str ?? '', b.str ?? '');
}

/** Tri STABLE, multi-niveaux, vides toujours en dernier quel que soit le sens */
export function applySorts(
  data: InlineDbData,
  rows: DbRow[],
  sorts: DbSort[],
  ctx?: DbLinkContext | null
): DbRow[] {
  if (sorts.length === 0) return rows;
  const props = propertyIndex(data.properties);
  const env = envFor(data, ctx);
  const active = sorts
    .map((s) => ({ prop: props.get(s.propertyId), direction: s.direction }))
    .filter((s): s is { prop: DbProperty; direction: DbSort['direction'] } => !!s.prop);
  if (active.length === 0) return rows;

  // Décoration : index d'origine (stabilité garantie sans dépendre du moteur) ET
  // clés de tri calculées UNE fois par ligne et par niveau. Les rebâtir dans le
  // comparateur en referait deux par comparaison — donc O(n log n) reparsages de
  // date au lieu de O(n), soit des dizaines de milliers sur quelques milliers de
  // lignes.
  const decorated = rows.map((row, index) => ({
    row,
    index,
    keys: active.map((a) => sortKeyFor(a.prop, row, env)),
  }));

  decorated.sort((a, b) => {
    for (let level = 0; level < active.length; level += 1) {
      const ka = a.keys[level];
      const kb = b.keys[level];
      // Deux vides ne se départagent pas : on passe au critère suivant
      if (ka.empty && kb.empty) continue;
      if (ka.empty) return 1;
      if (kb.empty) return -1;
      const c = compareKeys(ka, kb);
      if (c !== 0) return active[level].direction === 'desc' ? -c : c;
    }
    return a.index - b.index;
  });

  return decorated.map((d) => d.row);
}

/** Filtre PUIS trie — le seul point d'entrée du rendu */
export function applyView(
  data: InlineDbData,
  view: DbView,
  ctx?: DbLinkContext | null,
  /** Recherche rapide, EPHEMERE : elle ne s'ecrit jamais dans le document. */
  search?: string
): DbRow[] {
  // La recherche s'applique APRES les filtres et AVANT les tris : elle
  // restreint ce que la vue montre, sans jamais changer son ordre.
  const filtered = applySearch(
    applyFilters(data, view.filters, ctx),
    data.properties,
    search ?? ''
  );
  return applySorts(data, filtered, view.sorts, ctx);
}

// ==================== Vues : migration et cohérence ====================

/**
 * Vue affichée. L'onglet choisi LOCALEMENT (préférence de cet appareil, cf.
 * `viewPrefKey`) prime, mais seulement s'il désigne encore une vue : un onglet
 * supprimé ailleurs ne doit pas figer l'affichage. Repli ensuite sur l'onglet
 * enregistré dans le document, puis sur la première vue.
 */
/**
 * Colonnes AFFICHEES par une vue, dans son ordre.
 *
 * Deux garde-fous, et ce sont eux qui comptent :
 *  - une propriete absente de `propertyOrder` n'est pas perdue, elle passe a la
 *    fin. Une colonne ajoutee apres coup disparaitrait sinon de toutes les vues
 *    deja reglees, sans que rien ne le dise ;
 *  - un identifiant qui ne designe plus rien (colonne supprimee) est ignore.
 */
export function orderedVisibleProperties(
  properties: DbProperty[],
  view: Pick<DbView, 'hiddenPropertyIds' | 'propertyOrder'> | null | undefined
): DbProperty[] {
  if (!view) return properties;
  const hidden = new Set(view.hiddenPropertyIds ?? []);
  const order = view.propertyOrder ?? [];

  const byId = new Map(properties.map((prop) => [prop.id, prop]));
  const ordered: DbProperty[] = [];
  const placed = new Set<string>();

  for (const id of order) {
    const prop = byId.get(id);
    if (prop && !placed.has(id)) {
      ordered.push(prop);
      placed.add(id);
    }
  }
  for (const prop of properties) {
    if (!placed.has(prop.id)) ordered.push(prop);
  }

  return ordered.filter((prop) => !hidden.has(prop.id));
}

/**
 * Deplace `propertyId` A LA PLACE de `targetId` (glisser-deposer).
 *
 * Le deplacement porte sur l'ordre COMPLET, colonnes masquees comprises :
 * reordonner a partir des seules colonnes visibles ferait sauter les masquees a
 * une place arbitraire des qu'on les reaffiche.
 */
export function reorderPropertyInView(
  view: DbView,
  properties: DbProperty[],
  propertyId: string,
  targetId: string
): DbView {
  const full = orderedVisibleProperties(properties, { propertyOrder: view.propertyOrder });
  const ids = full.map((prop) => prop.id);
  const from = ids.indexOf(propertyId);
  const to = ids.indexOf(targetId);
  if (from < 0 || to < 0 || from === to) return view;
  ids.splice(from, 1);
  ids.splice(to, 0, propertyId);
  return { ...view, propertyOrder: ids };
}

/**
 * Tout afficher, ou tout masquer SAUF la premiere.
 *
 * « Tout masquer » garde une colonne : une table sans aucune colonne n'affiche
 * plus rien, et l'utilisateur n'aurait alors plus aucun moyen de revenir en
 * arriere depuis la table elle-meme.
 */
export function setAllPropertiesVisible(
  view: DbView,
  properties: DbProperty[],
  visible: boolean
): DbView {
  if (visible) return { ...view, hiddenPropertyIds: undefined };
  const ordered = orderedVisibleProperties(properties, { propertyOrder: view.propertyOrder });
  const hidden = ordered.slice(1).map((prop) => prop.id);
  return {
    ...view,
    ...(hidden.length > 0 ? { hiddenPropertyIds: hidden } : { hiddenPropertyIds: undefined }),
  };
}

/**
 * Rend la vue avec `propertyId` masquee ou reaffichee.
 *
 * La DERNIERE colonne visible ne peut pas etre masquee : une table sans aucune
 * colonne n'affiche plus rien, et l'utilisateur n'a alors plus aucun moyen de
 * revenir en arriere depuis la table elle-meme.
 */
export function togglePropertyVisibility(
  view: DbView,
  properties: DbProperty[],
  propertyId: string
): DbView {
  const hidden = new Set(view.hiddenPropertyIds ?? []);
  if (hidden.has(propertyId)) {
    hidden.delete(propertyId);
  } else {
    if (orderedVisibleProperties(properties, view).length <= 1) return view;
    hidden.add(propertyId);
  }
  const next = Array.from(hidden);
  return {
    ...view,
    ...(next.length > 0 ? { hiddenPropertyIds: next } : { hiddenPropertyIds: undefined }),
  };
}

/** Deplace une propriete d'un cran dans l'ordre de la vue. */
export function movePropertyInView(
  view: DbView,
  properties: DbProperty[],
  propertyId: string,
  delta: -1 | 1
): DbView {
  // On part de l'ordre EFFECTIF (schema complet, ordre de la vue applique) :
  // reordonner a partir d'une liste partielle melangerait les colonnes
  // masquees avec les autres.
  const full = orderedVisibleProperties(properties, { propertyOrder: view.propertyOrder });
  const from = full.findIndex((prop) => prop.id === propertyId);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= full.length) return view;
  const ids = full.map((prop) => prop.id);
  const [moved] = ids.splice(from, 1);
  ids.splice(to, 0, moved);
  return { ...view, propertyOrder: ids };
}

/**
 * Texte cherchable d'une ligne : toutes ses cellules, mises a plat.
 *
 * On cherche sur les valeurs BRUTES et non sur l'affichage : une recherche doit
 * trouver « 2026-03-05 » comme « 5 mars », et l'affichage depend de la langue.
 * Les identifiants d'option sont traduits en libelles, sans quoi chercher
 * « urgent » ne trouverait rien dans une colonne de choix.
 */
function rowHaystack(row: DbRow, properties: DbProperty[]): string {
  const parts: string[] = [];
  for (const prop of properties) {
    const value = row.cells[prop.id];
    if (value === undefined || value === null) continue;
    if (prop.type === 'select' || prop.type === 'multiSelect') {
      const ids = Array.isArray(value) ? value : [value];
      for (const id of ids) {
        const label = prop.options?.find((option) => option.id === id)?.label;
        if (label) parts.push(label);
      }
      continue;
    }
    if (Array.isArray(value)) parts.push(value.join(' '));
    else parts.push(String(value));
  }
  return parts.join(' ');
}

/** Normalise pour une comparaison insensible a la casse ET aux accents. */
export function normalizeSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/** Lignes dont une cellule contient la recherche. */
export function applySearch(rows: DbRow[], properties: DbProperty[], search: string): DbRow[] {
  const needle = normalizeSearch(search);
  if (needle === '') return rows;
  return rows.filter((row) => normalizeSearch(rowHaystack(row, properties)).includes(needle));
}

export function resolveActiveView(data: InlineDbData, localViewId?: string | null): DbView {
  const views = data.views ?? [];
  return (
    views.find((v) => v.id === localViewId) ??
    views.find((v) => v.id === data.activeViewId) ??
    views[0] ??
    makeDefaultView('table')
  );
}

/** Vue affichée sans préférence locale (repli sur la première si l'id actif ne pointe sur rien) */
export function activeViewOf(data: InlineDbData): DbView {
  return resolveActiveView(data, null);
}

/**
 * Attrs hérités à réécrire à chaque commit, en MIROIR de la vue active : un
 * client d'avant les vues ne lit que `view`/`groupBy` et reste utilisable
 * (il affichera la vue active, sans ses filtres). C'est le prix de la
 * compatibilité descendante, et il est payé à chaque écriture.
 */
export function legacyAttrsFor(data: InlineDbData): { view: DbViewType; groupBy: string } {
  const active = activeViewOf(data);
  return { view: active.type, groupBy: active.groupBy ?? '' };
}

/**
 * Retire des vues ce que le schéma ne porte plus : filtres et tris d'une
 * propriété supprimée, filtres dont l'opérateur ne va plus au type (changement
 * de type), filtres visant une option de sélection supprimée, groupBy qui ne
 * désigne plus une propriété select. Les LIGNES ne sont jamais touchées.
 */
/**
 * Réglages de plateau qui ne visent plus rien.
 *
 * Un second axe posé sur une colonne supprimée découperait le plateau en un
 * unique couloir « Sans valeur » — soit exactement l'aspect d'un bug. Un résumé
 * dont la propriété a changé de type afficherait, lui, une somme de rien.
 * Les PLAFONDS, eux, ne sont pas touchés : ils désignent des options, et une
 * option momentanément absente (base en cours de chargement) ne doit pas coûter
 * un réglage qu'on avait posé à la main.
 */
function sanitizeBoard(
  board: BoardSettings | undefined,
  props: Map<string, DbProperty>
): BoardSettings | undefined {
  if (!board) return undefined;
  const swimlaneProp = board.swimlaneBy ? props.get(board.swimlaneBy) : undefined;
  const summaryProp = board.summaryBy ? props.get(board.summaryBy) : undefined;
  const next: BoardSettings = {
    ...board,
    ...(swimlaneProp && swimlaneProp.type === 'select'
      ? { swimlaneBy: board.swimlaneBy }
      : { swimlaneBy: undefined }),
    ...(summaryProp && isSummarizable(summaryProp)
      ? { summaryBy: board.summaryBy }
      : { summaryBy: undefined }),
  };
  return Object.values(next).some((value) => value !== undefined) ? next : undefined;
}

export function sanitizeViews(data: InlineDbData): InlineDbData {
  const props = propertyIndex(data.properties);
  const source = data.views && data.views.length > 0 ? data.views : [makeDefaultView('table')];

  const views = source.map((view) => {
    const filters = view.filters.filter((f) => {
      const prop = props.get(f.propertyId);
      if (!prop) return false;
      if (!isOpValidForType(prop.type, f.op)) return false;
      if (
        (prop.type === 'select' || prop.type === 'multiSelect') &&
        opNeedsValue(f.op) &&
        typeof f.value === 'string' &&
        f.value !== '' &&
        !optionIds(prop).has(f.value)
      ) {
        return false;
      }
      return true;
    });
    const seen = new Set<string>();
    const sorts = view.sorts.filter((s) => {
      const prop = props.get(s.propertyId);
      // Un seul tri par propriété : le premier niveau gagne
      if (!prop || !isSortableType(prop.type) || seen.has(s.propertyId)) return false;
      seen.add(s.propertyId);
      return true;
    });
    const groupProp = view.groupBy ? props.get(view.groupBy) : undefined;
    const groupBy = groupProp && groupProp.type === 'select' ? view.groupBy : undefined;
    return {
      ...view,
      filters,
      sorts,
      ...(groupBy ? { groupBy } : { groupBy: undefined }),
      board: sanitizeBoard(view.board, props),
    };
  });

  const activeViewId = views.some((v) => v.id === data.activeViewId)
    ? data.activeViewId
    : views[0].id;

  return { ...data, views, activeViewId };
}

/**
 * COHÉRENCE DU SCHÉMA, appliquée au commit (jamais à la lecture : lire ne doit
 * rien écrire). Ce qui est nettoyé :
 *  - un agrégat qui suivait une relation supprimée — ou devenue un autre type —
 *    perd sa relation ET sa propriété cible : il redevient un agrégat à
 *    configurer, visiblement vide, plutôt qu'un chiffre qui ne veut plus rien dire ;
 *  - une propriété qui n'est plus une relation lâche sa cible, une propriété qui
 *    n'est plus un agrégat lâche sa configuration (conversion de type propre).
 *
 * Ce qui n'est JAMAIS touché :
 *  - `targetDbId` d'une relation vivante, même quand la base visée est absente
 *    de l'index : une note pas encore chargée n'est pas une base supprimée ;
 *  - les LIGNES. Changer la cible d'une relation laisse les identifiants en
 *    place : ceux qui ne désignent plus rien s'affichent en « introuvables »
 *    (et le sélecteur propose de les retirer), et re-viser l'ancienne base les
 *    fait tous revenir. Un nettoyage automatique, lui, serait irréversible et
 *    se déclencherait au moindre index momentanément incomplet.
 */
export function sanitizeSchema(data: InlineDbData): InlineDbData {
  const byId = propertyIndex(data.properties);
  let changed = false;

  const properties = data.properties.map((prop) => {
    const next: DbProperty = { ...prop };
    let touched = false;

    if (next.type !== 'relation' && next.targetDbId !== undefined) {
      next.targetDbId = undefined;
      touched = true;
    }

    if (next.type === 'rollup') {
      const via = next.viaPropertyId ? byId.get(next.viaPropertyId) : undefined;
      if (next.viaPropertyId && (!via || via.type !== 'relation')) {
        next.viaPropertyId = undefined;
        next.targetPropertyId = undefined;
        touched = true;
      }
    } else if (
      next.viaPropertyId !== undefined ||
      next.targetPropertyId !== undefined ||
      next.aggregate !== undefined
    ) {
      next.viaPropertyId = undefined;
      next.targetPropertyId = undefined;
      next.aggregate = undefined;
      touched = true;
    }

    if (!touched) return prop;
    changed = true;
    return next;
  });

  return changed ? { ...data, properties } : data;
}

/**
 * MIGRATION SANS PERTE des bases d'avant les vues : `views` absent → on
 * fabrique « Vue principale » à partir des attrs de nœud `view`/`groupBy`, sans
 * toucher aux propriétés ni aux lignes. Idempotent (rappelé à chaque lecture).
 */
export function ensureViews(
  data: InlineDbData,
  legacy: { view?: string; groupBy?: string }
): InlineDbData {
  if (data.views && data.views.length > 0) return sanitizeViews(data);
  const type = legacy.view === 'board' ? 'board' : 'table';
  const groupBy =
    typeof legacy.groupBy === 'string' && legacy.groupBy !== '' ? legacy.groupBy : undefined;
  const view = makeDefaultView(type, groupBy);
  return sanitizeViews({ ...data, views: [view], activeViewId: view.id });
}

// ==================== Nouvelle ligne dans une vue filtrée ====================

const MS_PER_DAY = 86400000;

function shiftDay(value: string, days: number): string | undefined {
  const stamp = dayStamp(value);
  if (stamp === null) return undefined;
  const d = new Date(stamp + days * MS_PER_DAY);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/**
 * Un filtre négatif de sélection écarte-t-il PRÉCISÉMENT l'option que le schéma
 * pose d'office ? Si oui, la ligne naîtrait avec la valeur exclue et serait
 * masquée à l'instant même de sa création (« Statut ≠ À faire » où « À faire »
 * est le défaut). Une cellule déjà décidée par un autre filtre de la vue n'est
 * pas touchée : c'est ce choix-là qui rend la ligne visible.
 */
function excludesSchemaDefault(
  prop: DbProperty,
  value: DbFilter['value'],
  cells: Record<string, unknown>
): boolean {
  if (typeof value !== 'string' || prop.id in cells) return false;
  return prop.defaultOptionId === value && optionIds(prop).has(value);
}

/**
 * Cellules à poser sur une ligne créée DANS cette vue, pour qu'elle y soit
 * visible (sinon on ajoute une ligne qu'on ne voit pas). `undefined` = effacer
 * la cellule (contrat de `newRow`), ce que demande un filtre « vide » — et
 * aussi un filtre NÉGATIF qui exclut justement la valeur par défaut du schéma.
 *
 * Seul `non vide` reste sans réponse, quelle que soit la famille : on ne peut
 * pas inventer un contenu à la place de l'utilisateur (poser d'office une
 * option de sélection serait un choix, pas un remplissage). La ligne existe
 * alors bel et bien, simplement masquée ici tant qu'elle est vide — le compteur
 * de lignes masquées de la barre de vues le dit.
 */
export function prefillCellsForView(
  view: DbView,
  properties: DbProperty[]
): Record<string, unknown> {
  const props = propertyIndex(properties);
  const cells: Record<string, unknown> = {};

  for (const f of view.filters) {
    const prop = props.get(f.propertyId);
    if (!prop || !isOpValidForType(prop.type, f.op)) continue;
    // Un agrégat ne s'écrit jamais (il se calcule) et on n'invente pas un lien
    // à la place de l'utilisateur : ces deux colonnes n'ont rien à pré-remplir.
    if (prop.type === 'rollup' || prop.type === 'relation') continue;

    if (f.op === 'isEmpty') {
      cells[prop.id] = undefined;
      continue;
    }
    if (f.op === 'isChecked') {
      cells[prop.id] = true;
      continue;
    }
    if (f.op === 'isUnchecked') {
      cells[prop.id] = undefined;
      continue;
    }
    if (f.op === 'isNotEmpty') continue;

    switch (filterFamily(prop.type)) {
      case 'text': {
        // « contient » et « égal » se satisfont du terme lui-même ;
        // « ne contient pas » l'est déjà par une cellule vide
        if ((f.op === 'contains' || f.op === 'equals') && typeof f.value === 'string') {
          const v = f.value.trim();
          if (v !== '') cells[prop.id] = v;
        }
        break;
      }
      case 'number': {
        const target = numberOf(f.value);
        if (target === null) break;
        let n: number | undefined;
        if (f.op === 'eq' || f.op === 'gte' || f.op === 'lte') n = target;
        else if (f.op === 'gt') n = target + 1;
        else if (f.op === 'lt') n = target - 1;
        // « ≠ » est déjà satisfait par une cellule vide
        if (n === undefined) break;
        if (prop.type === 'rating') n = Math.max(0, Math.min(5, Math.round(n)));
        if (prop.type === 'progress') n = Math.max(0, Math.min(100, n));
        cells[prop.id] = n;
        break;
      }
      case 'select':
        if (f.op === 'is' && typeof f.value === 'string' && optionIds(prop).has(f.value)) {
          cells[prop.id] = f.value;
        } else if (f.op === 'isNot' && excludesSchemaDefault(prop, f.value, cells)) {
          cells[prop.id] = undefined;
        }
        break;
      case 'multiSelect':
        if (f.op === 'contains' && typeof f.value === 'string' && optionIds(prop).has(f.value)) {
          cells[prop.id] = [f.value];
        } else if (f.op === 'notContains' && excludesSchemaDefault(prop, f.value, cells)) {
          cells[prop.id] = undefined;
        }
        break;
      case 'date': {
        // créé/modifié ne s'écrivent pas : ces colonnes sont posées par l'app
        if (prop.type !== 'date') break;
        if (typeof f.value !== 'string') break;
        const v =
          f.op === 'on'
            ? dayStamp(f.value) === null
              ? undefined
              : f.value.trim()
            : f.op === 'before'
              ? shiftDay(f.value, -1)
              : f.op === 'after'
                ? shiftDay(f.value, 1)
                : undefined;
        if (v !== undefined) cells[prop.id] = v;
        break;
      }
      default:
        break;
    }
  }

  return cells;
}

/** Nombre de filtres portés par la vue (compteur du bouton Filtres) */
export function countFilters(view: DbView): number {
  return view.filters.length;
}
