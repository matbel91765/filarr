/**
 * relations — Filarr Notes / bases inline
 *
 * Moteur PUR des relations entre bases et des agrégats qui les suivent.
 * Aucun React, aucun DOM, AUCUN RÉSEAU : une relation ne fait que rapprocher
 * deux blocs qui vivent déjà dans les notes de l'utilisateur, donc chiffrés et
 * synchronisés avec elles.
 *
 * Trois règles gouvernent tout ce fichier :
 *  - une cible introuvable n'est PAS une valeur perdue : les identifiants
 *    stockés restent intacts, l'affichage dit simplement « base indisponible » ;
 *  - un agrégat impossible (type incompatible, propriété disparue) rend « vide »,
 *    jamais une erreur ni un zéro trompeur ;
 *  - un agrégat n'est JAMAIS écrit dans les données : il se recalcule à chaque
 *    lecture depuis la relation et la base visée.
 *
 * RÉTROLIENS (relation de sens `in`) — le choix d'architecture le plus lourd de
 * ce fichier. Notion crée, dans la base d'en face, une propriété MIROIR qu'il
 * tient à jour des deux côtés. Ici une base vit dans une NOTE : écrire ce miroir
 * demanderait de modifier une autre note à chaque lien posé, sans transaction,
 * sur des notes qui se synchronisent chacune de leur côté — un lien créé hors
 * ligne des deux côtés donnerait deux miroirs divergents que rien ne pourrait
 * réconcilier. Le sens inverse est donc CALCULÉ : la colonne ne stocke rien, et
 * se relit à chaque affichage depuis la relation d'en face. Elle ne peut donc
 * jamais mentir, il n'y a rien à réparer, et une note en lecture seule (coffre
 * verrouillé, note d'un partage) se laisse quand même rétro-lier.
 */

import type { DbAggregate, DbProperty, DbRow, PropertyType } from './types';
import { formatDbDate, formatDbTimestamp, relationIds } from './types';
import {
  cellValueFor,
  isEmptyCellBase,
  isNumericType,
  numberOf,
  selectedOptionIds,
  textOf,
} from './cellValues';

/** Une base visée, telle que l'index des notes la rend */
export interface DbTarget {
  properties: DbProperty[];
  rows: DbRow[];
  /**
   * Note qui PORTE la base. Facultatif (l'export et les tests s'en passent) :
   * sans elle, une pastille reste lisible, elle n'ouvre simplement rien.
   */
  noteId?: string;
  noteTitle?: string;
  /** Titre du bloc visé, à défaut celui de sa note */
  label?: string;
}

/**
 * Résolution d'une identité de base. L'implémentation vit dans la couche React
 * (index mémoïsé des notes) ; le moteur ne connaît que ce contrat, ce qui le
 * rend testable sans store.
 */
export interface DbLinkContext {
  getDb(dbId: string): DbTarget | undefined;
  /**
   * Table `id de ligne → ligne` de la base visée. Facultatif : sans elle, la
   * résolution rebâtit la table. C'est ce que fait `makeLinkContext`, parce que
   * la table serait sinon reconstruite à CHAQUE cellule rendue, à chaque
   * agrégat et à chaque ligne filtrée.
   */
  getRowIndex?(dbId: string): Map<string, DbRow> | undefined;
  /**
   * Index INVERSE d'une relation de la base `dbId` : `id de ligne visée →
   * lignes qui la visent`. Même raison que ci-dessus, en plus aigu — un
   * rétrolien parcourt TOUTES les lignes de la base d'en face, et il est calculé
   * une fois par cellule affichée.
   */
  getBackIndex?(dbId: string, propertyId: string): Map<string, DbRow[]> | undefined;
  /**
   * Identité de la base DEPUIS LAQUELLE on lit. Portée par le contexte plutôt
   * que par l'environnement parce que le contexte est fabriqué une seule fois,
   * dans le bloc : les vues, le board et l'export la reçoivent alors sans
   * qu'aucun d'eux ait à la connaître. Un rétrolien s'en sert pour vérifier que
   * la relation d'en face pointe bien ICI.
   */
  selfDbId?: string;
}

/**
 * Index inverse d'une propriété relation : pour chaque ligne VISÉE, les lignes
 * qui la visent, dans l'ordre de la base source.
 */
export function buildBackIndex(rows: DbRow[], propertyId: string): Map<string, DbRow[]> {
  const index = new Map<string, DbRow[]>();
  for (const row of rows) {
    for (const id of relationIds(row.cells[propertyId])) {
      const bucket = index.get(id);
      if (bucket) bucket.push(row);
      else index.set(id, [row]);
    }
  }
  return index;
}

/**
 * Contexte de liaison à tables d'index mémoïsées. À fabriquer là où le résultat
 * est déjà mémoïsé (le `useMemo` du bloc) : le cache vit exactement aussi
 * longtemps que les données dont il est tiré, et disparaît avec elles.
 */
export function makeLinkContext(
  getDb: (dbId: string) => DbTarget | undefined,
  selfDbId?: string
): DbLinkContext {
  const targets = new Map<string, DbTarget | undefined>();
  const indexes = new Map<string, Map<string, DbRow> | undefined>();
  const backIndexes = new Map<string, Map<string, DbRow[]> | undefined>();
  // Une cible introuvable est mémoïsée elle aussi : la chercher encore ne
  // rendrait pas autre chose tant que le contexte vit
  const resolve = (dbId: string): DbTarget | undefined => {
    if (targets.has(dbId)) return targets.get(dbId);
    const target = getDb(dbId);
    targets.set(dbId, target);
    return target;
  };
  return {
    getDb: resolve,
    getRowIndex: (dbId: string) => {
      if (indexes.has(dbId)) return indexes.get(dbId);
      const target = resolve(dbId);
      const index = target ? new Map(target.rows.map((r) => [r.id, r])) : undefined;
      indexes.set(dbId, index);
      return index;
    },
    getBackIndex: (dbId: string, propertyId: string) => {
      // Séparateur impossible dans un identifiant : deux clés ne peuvent pas
      // se confondre quel que soit le contenu des ids
      const key = `${dbId}\n${propertyId}`;
      if (backIndexes.has(key)) return backIndexes.get(key);
      const target = resolve(dbId);
      const index = target ? buildBackIndex(target.rows, propertyId) : undefined;
      backIndexes.set(key, index);
      return index;
    },
    ...(selfDbId !== undefined && selfDbId !== '' ? { selfDbId } : {}),
  };
}

/** Environnement d'évaluation d'une ligne : ses voisines de schéma + les cibles */
export interface DbEnv {
  /** Propriétés de LA base qui contient la ligne (pour retrouver la relation d'un rollup) */
  properties: DbProperty[];
  ctx?: DbLinkContext;
}

// ==================== Titre d'une ligne ====================

/**
 * Propriété qui fait office de titre : la PREMIÈRE propriété texte du schéma.
 * Même convention que la vue board (`titleProp`) et que la recherche des
 * connecteurs — une base n'a pas de colonne « titre » déclarée.
 */
export function titlePropertyOf(properties: DbProperty[]): DbProperty | undefined {
  return properties.find((p) => p.type === 'text');
}

/** Titre affichable d'une ligne ('' quand la base n'a pas de colonne texte ou que la cellule est vide) */
export function rowTitleOf(properties: DbProperty[], row: DbRow): string {
  const prop = titlePropertyOf(properties);
  if (!prop) return '';
  return textOf(row.cells[prop.id]);
}

// ==================== Lecture affichable d'une cellule ====================

/**
 * Texte d'une cellule tel qu'un HUMAIN la lit : le libellé d'une option (pas
 * son identifiant), une case cochée rendue par sa coche, un horodatage rendu
 * dans la langue de l'app. Sert deux fois : les propriétés secondaires du
 * sélecteur de lignes, et l'agrégat « liste des valeurs ».
 *
 * Rend '' — jamais un identifiant interne — dès que la valeur ne se lit pas
 * (lien vers une note, agrégat imbriqué, type inattendu).
 */
export function rowDisplayText(prop: DbProperty, row: DbRow, env?: DbEnv | null): string {
  switch (prop.type) {
    case 'createdTime':
      return formatDbTimestamp(row.createdAt);
    case 'updatedTime':
      return formatDbTimestamp(row.updatedAt);
    case 'date':
      // Même mise en forme que la cellule : une pastille de relation ne doit
      // pas montrer un ISO brut là où la table montre « 15 août 2026 »
      return formatDbDate(textOf(row.cells[prop.id]));
    case 'checkbox':
      return row.cells[prop.id] === true ? '✓' : '';
    case 'select': {
      const id = row.cells[prop.id];
      const opt = (prop.options ?? []).find((o) => o.id === id);
      return opt ? opt.label : '';
    }
    case 'multiSelect': {
      const ids = selectedOptionIds(prop, row.cells[prop.id]);
      const options = prop.options ?? [];
      return ids
        .map((id) => options.find((o) => o.id === id)?.label ?? '')
        .filter((s) => s !== '')
        .join(' · ');
    }
    case 'number':
    case 'rating':
    case 'progress': {
      const n = numberOf(row.cells[prop.id]);
      return n === null ? '' : String(n);
    }
    case 'relation': {
      // Un cran de profondeur, jamais deux : les titres liés se lisent avec le
      // schéma de LEUR base, et un titre est du texte — la descente s'arrête là
      const text = relationText(prop, row, env);
      return text ?? '';
    }
    case 'rollup':
      // Rien n'est stocké et le recalculer demanderait l'environnement d'une
      // AUTRE base : un agrégat ne se liste pas
      return '';
    case 'note':
      // Un lien vers une note ne porte qu'un identifiant : le résoudre
      // demanderait le store, et l'afficher brut serait pire que rien
      return '';
    default:
      return textOf(row.cells[prop.id]);
  }
}

/**
 * Ordre de préférence des propriétés SECONDAIRES d'une ligne : ce qui se
 * reconnaît d'un coup d'œil d'abord (une pastille de statut, une date), le
 * texte libre en dernier. `note`, `relation` et `rollup` en sont absents : un
 * lien opaque ou un calcul qui dépend d'une autre base n'aide pas à choisir.
 */
const SECONDARY_PRIORITY: readonly PropertyType[] = [
  'select',
  'date',
  'multiSelect',
  'rating',
  'checkbox',
  'progress',
  'number',
  'createdTime',
  'updatedTime',
  'text',
  'url',
  'email',
  'phone',
];

/**
 * Propriétés à montrer SOUS le titre d'une ligne dans le sélecteur (deux au
 * plus). À priorité égale, l'ordre du schéma tranche : deux bases construites
 * pareil se présentent pareil.
 */
export function secondaryPropertiesOf(properties: DbProperty[], max = 2): DbProperty[] {
  const title = titlePropertyOf(properties);
  const ranked = properties
    .map((prop, index) => ({ prop, index, rank: SECONDARY_PRIORITY.indexOf(prop.type) }))
    .filter((c) => c.rank >= 0 && c.prop.id !== title?.id);
  ranked.sort((a, b) => (a.rank !== b.rank ? a.rank - b.rank : a.index - b.index));
  return ranked.slice(0, Math.max(0, max)).map((c) => c.prop);
}

// ==================== Relations ====================

export interface RelationLink {
  rowId: string;
  title: string;
}

export type RelationResolution =
  /** Aucune base visée : la propriété n'est pas encore configurée */
  | { status: 'unset' }
  /**
   * Base visée introuvable (note supprimée, bloc effacé, note pas encore
   * chargée). `ids` reste EXACTEMENT ce que la cellule stocke.
   */
  | { status: 'unavailable'; ids: string[] }
  | {
      status: 'ok';
      ids: string[];
      /** Lignes retrouvées, dans l'ordre de la cellule */
      links: RelationLink[];
      rows: DbRow[];
      /** Identifiants stockés qui ne désignent plus aucune ligne (conservés) */
      missing: string[];
      target: DbTarget;
    };

/**
 * Lignes visées par une cellule relation — dans un sens comme dans l'autre.
 *
 * Sans contexte de résolution (moteur appelé hors React, tests, export), la
 * cible est déclarée indisponible : c'est le même état qu'une base supprimée,
 * et il ne fait rien perdre.
 */
export function resolveRelation(
  prop: DbProperty,
  row: DbRow,
  env?: DbEnv | null
): RelationResolution {
  if (prop.type !== 'relation') return { status: 'unset' };
  const targetDbId = typeof prop.targetDbId === 'string' ? prop.targetDbId : '';
  if (targetDbId === '') return { status: 'unset' };
  return prop.direction === 'in'
    ? resolveBacklinks(prop, row, targetDbId, env)
    : resolveForwardLinks(prop, row, targetDbId, env);
}

/** Sens sortant : les identifiants stockés dans la cellule, résolus en lignes */
function resolveForwardLinks(
  prop: DbProperty,
  row: DbRow,
  targetDbId: string,
  env?: DbEnv | null
): RelationResolution {
  const ids = relationIds(row.cells[prop.id]);
  const target = env?.ctx?.getDb(targetDbId);
  if (!target) return { status: 'unavailable', ids };

  // Table d'index du contexte quand il en tient une (cf. `makeLinkContext`) :
  // cette résolution est appelée par cellule rendue, par agrégat et par ligne
  // filtrée — la rebâtir à chaque fois coûterait un parcours des lignes visées
  // à chacun de ces appels.
  const byId = env?.ctx?.getRowIndex?.(targetDbId) ?? new Map(target.rows.map((r) => [r.id, r]));
  const links: RelationLink[] = [];
  const rows: DbRow[] = [];
  const missing: string[] = [];
  for (const id of ids) {
    const found = byId.get(id);
    if (!found) {
      missing.push(id);
      continue;
    }
    rows.push(found);
    links.push({ rowId: id, title: rowTitleOf(target.properties, found) });
  }
  return { status: 'ok', ids, links, rows, missing, target };
}

/**
 * La relation d'en face pointe-t-elle bien ICI ? Elle doit être une relation
 * SORTANTE (un rétrolien de rétrolien ne désignerait rien) et, quand le
 * contexte sait de quelle base on lit, viser précisément celle-là — sinon une
 * relation re-dirigée ailleurs continuerait de nous renvoyer ses lignes.
 *
 * Contexte sans identité (export, tests) : on s'en tient à l'appartenance des
 * identifiants de lignes, qui suffit en pratique — deux bases n'ont pas les
 * mêmes ids de lignes.
 */
function pointsBackHere(sourceProp: DbProperty, env?: DbEnv | null): boolean {
  if (sourceProp.type !== 'relation' || sourceProp.direction === 'in') return false;
  const selfDbId = env?.ctx?.selfDbId;
  if (selfDbId === undefined || selfDbId === '') return true;
  return sourceProp.targetDbId === selfDbId;
}

/**
 * Sens entrant (rétroliens) : les lignes de la base source dont la relation
 * choisie pointe sur CETTE ligne. Rien n'est lu dans `cells` — une colonne de
 * rétroliens ne stocke rien, jamais.
 */
function resolveBacklinks(
  prop: DbProperty,
  row: DbRow,
  sourceDbId: string,
  env?: DbEnv | null
): RelationResolution {
  const sourcePropId = typeof prop.sourcePropertyId === 'string' ? prop.sourcePropertyId : '';
  // Source pas encore choisie : la colonne n'est pas configurée
  if (sourcePropId === '') return { status: 'unset' };

  const target = env?.ctx?.getDb(sourceDbId);
  if (!target) return { status: 'unavailable', ids: [] };

  const sourceProp = target.properties.find((p) => p.id === sourcePropId);
  // Relation d'en face disparue, devenue un autre type, ou re-dirigée ailleurs :
  // aucun rétrolien, ce qui est la vérité — surtout pas une erreur
  if (!sourceProp || !pointsBackHere(sourceProp, env)) {
    return { status: 'ok', ids: [], links: [], rows: [], missing: [], target };
  }

  const back =
    env?.ctx?.getBackIndex?.(sourceDbId, sourcePropId) ?? buildBackIndex(target.rows, sourcePropId);
  const rows = back.get(row.id) ?? [];
  return {
    status: 'ok',
    ids: rows.map((r) => r.id),
    links: rows.map((r) => ({ rowId: r.id, title: rowTitleOf(target.properties, r) })),
    rows,
    // Un rétrolien ne peut pas désigner une ligne absente : il est calculé
    // depuis les lignes elles-mêmes
    missing: [],
    target,
  };
}

/** Texte comparable d'une cellule relation : les titres liés, mis bout à bout */
export function relationText(prop: DbProperty, row: DbRow, env?: DbEnv | null): string | null {
  const res = resolveRelation(prop, row, env);
  // Cible inconnue : on ne SAIT pas ce que la cellule contient — ni vide, ni plein
  if (res.status !== 'ok') return null;
  return res.links
    .map((l) => l.title)
    .filter((s) => s !== '')
    .join(' ');
}

// ==================== Agrégats (rollup) ====================

/** Unité d'un agrégat chiffré (absente = un nombre nu) */
export type RollupUnit = 'percent';

export type RollupResult =
  | { status: 'ok'; value: number; unit?: RollupUnit }
  /**
   * Agrégat TEXTUEL (« liste des valeurs ») : `count` porte le nombre de
   * valeurs mises bout à bout, seule lecture numérique honnête de cette
   * colonne — c'est elle que le tri et les filtres compareront.
   */
  | { status: 'text'; text: string; count: number }
  /** Rien à agréger : relation absente, types incompatibles, aucune valeur */
  | { status: 'empty' }
  /** Base visée introuvable — on ne montre pas un zéro qui mentirait */
  | { status: 'unavailable' };

const EMPTY: RollupResult = { status: 'empty' };
const UNAVAILABLE: RollupResult = { status: 'unavailable' };

/**
 * Valeur d'une cellule rollup. Toujours dérivée, jamais lue dans `cells` :
 * une base qui aurait gardé une vieille valeur (propriété convertie en rollup)
 * ne peut donc pas afficher un chiffre périmé.
 */
export function computeRollup(prop: DbProperty, row: DbRow, env?: DbEnv | null): RollupResult {
  if (prop.type !== 'rollup') return EMPTY;

  const via = (env?.properties ?? []).find((p) => p.id === prop.viaPropertyId);
  // Relation disparue ou devenue un autre type : agrégat sans objet
  if (!via || via.type !== 'relation') return EMPTY;

  const res = resolveRelation(via, row, env);
  if (res.status === 'unavailable') return UNAVAILABLE;
  if (res.status === 'unset') return EMPTY;

  const aggregate: DbAggregate = prop.aggregate ?? 'count';
  // Compter n'a besoin d'aucune propriété cible : une ligne liée est une ligne
  // liée, même dans une base sans colonne comparable
  if (aggregate === 'count') return { status: 'ok', value: res.rows.length };

  const targetProp = res.target.properties.find((p) => p.id === prop.targetPropertyId);
  if (!targetProp) return EMPTY;

  switch (aggregate) {
    case 'checked': {
      // Une case à cocher, et rien d'autre : ailleurs, « coché » n'a pas de sens
      if (targetProp.type !== 'checkbox') return EMPTY;
      let n = 0;
      for (const r of res.rows) if (r.cells[targetProp.id] === true) n += 1;
      return { status: 'ok', value: n };
    }
    case 'percentChecked': {
      if (targetProp.type !== 'checkbox') return EMPTY;
      // Aucune ligne liée : pas « 0 % », rien du tout — un pourcentage sans
      // population est un chiffre inventé
      if (res.rows.length === 0) return EMPTY;
      let n = 0;
      for (const r of res.rows) if (r.cells[targetProp.id] === true) n += 1;
      return { status: 'ok', value: (n * 100) / res.rows.length, unit: 'percent' };
    }
    case 'list': {
      // Doublons gardés et ordre des liens respecté : la colonne montre CE QUI
      // est lié, pas un ensemble de valeurs distinctes
      const targetEnv: DbEnv = {
        properties: res.target.properties,
        ...(env?.ctx ? { ctx: env.ctx } : {}),
      };
      const parts: string[] = [];
      for (const r of res.rows) {
        const text = rowDisplayText(targetProp, r, targetEnv);
        if (text !== '') parts.push(text);
      }
      if (parts.length === 0) return EMPTY;
      return { status: 'text', text: parts.join(', '), count: parts.length };
    }
    case 'notEmpty': {
      let n = 0;
      for (const r of res.rows) {
        if (!isEmptyCellBase(targetProp, cellValueFor(targetProp, r))) n += 1;
      }
      return { status: 'ok', value: n };
    }
    default: {
      // sum/avg/min/max : seule une colonne numérique se somme
      if (!isNumericType(targetProp.type)) return EMPTY;
      const values: number[] = [];
      for (const r of res.rows) {
        // Cellules d'un autre type dans une colonne numérique (types mélangés
        // venus d'un import ou d'une conversion) : ignorées, jamais coercées
        const n = numberOf(r.cells[targetProp.id]);
        if (n !== null) values.push(n);
      }
      // Aucune ligne liée, ou aucune valeur lisible : vide (surtout pas 0)
      if (values.length === 0) return EMPTY;
      if (aggregate === 'sum') return { status: 'ok', value: values.reduce((a, b) => a + b, 0) };
      if (aggregate === 'avg') {
        return { status: 'ok', value: values.reduce((a, b) => a + b, 0) / values.length };
      }
      if (aggregate === 'min') return { status: 'ok', value: Math.min(...values) };
      if (aggregate === 'max') return { status: 'ok', value: Math.max(...values) };
      return EMPTY;
    }
  }
}

/**
 * Valeur numérique d'un rollup pour le tri et les filtres (null = rien à
 * comparer). Un agrégat TEXTUEL se compare par son NOMBRE de valeurs : c'est la
 * seule lecture chiffrée qui ne mente pas, et surtout elle garde « vide / non
 * vide » d'accord avec ce que la cellule montre — une liste qui affiche trois
 * titres ne doit pas passer pour une case vide aux yeux d'un filtre.
 */
export function rollupNumber(prop: DbProperty, row: DbRow, env?: DbEnv | null): number | null {
  const res = computeRollup(prop, row, env);
  if (res.status === 'ok') return res.value;
  if (res.status === 'text') return res.count;
  return null;
}

/**
 * Rendu texte d'un agrégat chiffré. Deux décimales au plus (une moyenne tombe
 * rarement juste) et pas de zéros inutiles ; aucune dépendance i18n, donc
 * testable tel quel. Le pourcentage porte son signe : sans lui, « 66 » dans une
 * colonne « Avancement » se lirait comme un décompte.
 */
export function formatRollupValue(value: number, unit?: RollupUnit): string {
  if (!Number.isFinite(value)) return '';
  const rounded = String(Math.round(value * 100) / 100);
  return unit === 'percent' ? `${rounded}%` : rounded;
}

/** Rendu texte d'un agrégat, quel que soit ce qu'il a produit ('' = rien à montrer) */
export function formatRollupResult(res: RollupResult): string {
  if (res.status === 'ok') return formatRollupValue(res.value, res.unit);
  if (res.status === 'text') return res.text;
  return '';
}

// ==================== Cardinalité (« un seul lien ») ====================

/** Lignes dont cette relation porte PLUS d'un identifiant */
export function countMultiLinkRows(rows: DbRow[], propId: string): number {
  let n = 0;
  for (const row of rows) if (relationIds(row.cells[propId]).length > 1) n += 1;
  return n;
}

/**
 * Ne garde que le PREMIER lien de chaque ligne. Appelé UNIQUEMENT sur un geste
 * explicite : passer une colonne en « un seul lien » ne détruit rien de
 * lui-même — les liens déjà posés restent affichés, et c'est le prochain choix
 * qui remplace. Réduire pour de bon reste une décision de l'utilisateur.
 */
export function trimToSingleLinks(
  rows: DbRow[],
  propId: string
): { rows: DbRow[]; changed: number } {
  let changed = 0;
  const next = rows.map((row) => {
    const ids = relationIds(row.cells[propId]);
    if (ids.length <= 1) return row;
    changed += 1;
    return { ...row, cells: { ...row.cells, [propId]: [ids[0]] } };
  });
  return changed > 0 ? { rows: next, changed } : { rows, changed: 0 };
}

// ==================== Rétroliens : sources possibles ====================

/** Une relation d'une AUTRE base (ou de celle-ci) qui pointe vers la base courante */
export interface BacklinkSource {
  dbId: string;
  propertyId: string;
}

/**
 * Toutes les relations du coffre qui visent `selfDbId` : c'est exactement la
 * liste qu'une colonne de rétroliens peut suivre. Une base sans relation vers
 * ici n'y figure pas — on ne propose jamais une source qui ne rendrait rien.
 */
export function backlinkSourcesFor(
  entries: readonly { dbId: string; properties: DbProperty[] }[],
  selfDbId: string
): BacklinkSource[] {
  if (selfDbId === '') return [];
  const out: BacklinkSource[] = [];
  for (const entry of entries) {
    for (const prop of entry.properties) {
      if (prop.type !== 'relation' || prop.direction === 'in') continue;
      if (prop.targetDbId !== selfDbId) continue;
      out.push({ dbId: entry.dbId, propertyId: prop.id });
    }
  }
  return out;
}
