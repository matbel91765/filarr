/**
 * Plateau kanban — LOGIQUE PURE (répartition, couloirs, plafonds, résumés).
 *
 * Le kanban de Filarr n'était qu'un « board » : des colonnes, des cartes, un
 * glisser-déposer. Il lui manquait ce qui fait justement un kanban — le PLAFOND
 * d'en-cours par colonne, la lecture d'un coup d'œil de ce qui reste à faire, et
 * un second axe de lecture. Tout cela se calcule sans React, donc ici.
 *
 * RÈGLE QUI TRAVERSE LE FICHIER : rien ne disparaît en silence. Une ligne dont
 * la valeur de regroupement ne désigne plus rien atterrit dans « Sans valeur »
 * plutôt que de s'évaporer ; une colonne vide reste visible tant qu'on n'a pas
 * demandé le contraire ; un résumé qui n'a rien à résumer rend `null` — jamais
 * un « 0 % » inventé qu'on lirait comme un fait.
 */

import type { DbProperty, DbRow } from './types';

/** Colonne (ou couloir) des lignes que la propriété de regroupement ne classe pas. */
export const BOARD_NONE = '__none__';

export type BoardCardSize = 'compact' | 'regular' | 'tall';

export const BOARD_CARD_SIZES: readonly BoardCardSize[] = ['compact', 'regular', 'tall'];

/**
 * Réglages du plateau, propres à UNE vue.
 *
 * Réglage de vue et non de base : la même base peut avoir une vue « par statut,
 * plafonnée » pour le pilotage et une vue « par personne » pour la répartition.
 */
export interface BoardSettings {
  /** Second axe : une bande horizontale par option de cette propriété select. */
  swimlaneBy?: string;
  /** Propriété résumée en tête de colonne (progression, nombre ou case). */
  summaryBy?: string;
  /** Plafond d'en-cours, par identifiant de colonne. */
  wipLimits?: Record<string, number>;
  /** Colonnes repliées (réglage persistant : on replie ce qu'on ne pilote pas). */
  collapsed?: string[];
  /** Masquer les colonnes sans aucune carte. */
  hideEmpty?: boolean;
  /** Teinter les cartes de la couleur de leur colonne. */
  colorCards?: boolean;
  cardSize?: BoardCardSize;
}

export interface BoardColumn {
  id: string;
  label: string;
  /** Couleur de l'option ; `null` pour « Sans valeur ». */
  color: string | null;
}

export interface BoardLane {
  id: string;
  label: string;
  color: string | null;
}

/**
 * Colonnes du plateau : une par option, puis « Sans valeur ».
 *
 * « Sans valeur » est TOUJOURS en dernier et TOUJOURS présent quand elle porte
 * des cartes — c'est la colonne des lignes qu'on n'a pas encore triées, et la
 * masquer les rendrait invisibles sans les supprimer.
 */
export function boardColumns(
  groupProp: DbProperty | undefined,
  noneLabel: string,
  colorOf: (colorId: string) => string
): BoardColumn[] {
  const options = groupProp?.options ?? [];
  return [
    ...options.map((option) => ({
      id: option.id,
      label: option.label,
      color: colorOf(option.color),
    })),
    { id: BOARD_NONE, label: noneLabel, color: null },
  ];
}

/**
 * Répartit des lignes par colonne.
 *
 * Une valeur qui ne correspond à aucune option (option supprimée, donnée venue
 * d'un import) tombe dans « Sans valeur » : la ligne existe, elle doit se voir.
 */
export function splitByColumn(
  rows: readonly DbRow[],
  groupProp: DbProperty | undefined,
  columns: readonly BoardColumn[]
): Record<string, DbRow[]> {
  const map: Record<string, DbRow[]> = {};
  for (const column of columns) map[column.id] = [];
  if (!map[BOARD_NONE]) map[BOARD_NONE] = [];
  for (const row of rows) {
    const value = groupProp ? row.cells[groupProp.id] : undefined;
    if (typeof value === 'string' && map[value]) map[value].push(row);
    else map[BOARD_NONE].push(row);
  }
  return map;
}

/**
 * Couloirs (second axe). Sans propriété désignée, UN seul couloir anonyme
 * contient tout : le plateau se lit alors exactement comme avant.
 */
export function boardLanes(
  laneProp: DbProperty | undefined,
  noneLabel: string,
  colorOf: (colorId: string) => string
): BoardLane[] {
  if (!laneProp) return [{ id: BOARD_NONE, label: '', color: null }];
  return [
    ...(laneProp.options ?? []).map((option) => ({
      id: option.id,
      label: option.label,
      color: colorOf(option.color),
    })),
    { id: BOARD_NONE, label: noneLabel, color: null },
  ];
}

/** Lignes d'un couloir donné (mêmes règles de repli que les colonnes). */
export function rowsInLane(
  rows: readonly DbRow[],
  laneProp: DbProperty | undefined,
  laneId: string
): DbRow[] {
  if (!laneProp) return [...rows];
  const known = new Set((laneProp.options ?? []).map((option) => option.id));
  return rows.filter((row) => {
    const value = row.cells[laneProp.id];
    const belongs = typeof value === 'string' && known.has(value) ? value : BOARD_NONE;
    return belongs === laneId;
  });
}

/**
 * Couloirs qui MÉRITENT d'être affichés.
 *
 * Le couloir « Sans valeur » ne s'affiche que s'il porte des cartes : un second
 * axe complet ajouterait sinon une bande vide sous chaque plateau bien rangé.
 * Les couloirs nommés, eux, restent — ce sont des cases à remplir.
 */
export function visibleLanes(
  lanes: readonly BoardLane[],
  rows: readonly DbRow[],
  laneProp: DbProperty | undefined
): BoardLane[] {
  if (!laneProp) return [...lanes];
  return lanes.filter(
    (lane) => lane.id !== BOARD_NONE || rowsInLane(rows, laneProp, BOARD_NONE).length > 0
  );
}

export type WipStatus = 'under' | 'full' | 'over';

/**
 * État d'un plafond d'en-cours.
 *
 * Il ne bloque RIEN : dépasser reste possible, et c'est voulu. Un plafond qui
 * refuse le dépôt fait perdre la carte qu'on tenait ; un plafond qui l'affiche
 * en rouge fait exactement ce qu'on lui demande — rendre le dépassement visible.
 */
export function wipStatus(count: number, limit: number | undefined): WipStatus | null {
  if (limit === undefined || !Number.isFinite(limit) || limit <= 0) return null;
  if (count > limit) return 'over';
  if (count === limit) return 'full';
  return 'under';
}

export function clampProgress(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(Math.max(0, Math.min(100, value)));
}

/**
 * Progression visée par un clic (ou un glissement) sur une barre.
 *
 * Aimantée au multiple de 5 le plus proche : personne ne vise 63 %, et sans
 * cette grille deux cartes « aux trois quarts » afficheraient 74 et 76.
 */
export function progressFromPointer(
  clientX: number,
  rect: { left: number; width: number }
): number {
  if (!Number.isFinite(rect.width) || rect.width <= 0) return 0;
  const ratio = (clientX - rect.left) / rect.width;
  return clampProgress(Math.round((ratio * 100) / 5) * 5);
}

export type ColumnSummaryKind = 'progress' | 'number' | 'checkbox';

export interface ColumnSummary {
  kind: ColumnSummaryKind;
  /** Valeur affichée en toutes lettres (moyenne, somme, « 3 / 8 »). */
  value: number;
  /** Part remplie de la barre, 0-100 ; `null` quand une barre n'a pas de sens. */
  ratio: number | null;
  /** Nombre de lignes qui ont réellement contribué. */
  contributing: number;
}

/**
 * Résumé d'une colonne selon le TYPE de la propriété choisie — une seule
 * commande, trois lectures utiles :
 *  - progression : la moyenne, avec sa barre ;
 *  - nombre : la somme (charge, points, budget) ;
 *  - case à cocher : combien de cochées sur combien.
 *
 * `null` quand rien ne contribue. C'est la différence entre « aucune donnée » et
 * « zéro », et la confondre ferait lire une colonne vierge comme une colonne à
 * l'arrêt.
 */
export function columnSummary(
  rows: readonly DbRow[],
  prop: DbProperty | undefined
): ColumnSummary | null {
  if (!prop) return null;

  if (prop.type === 'progress') {
    const values = rows
      .map((row) => row.cells[prop.id])
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    if (values.length === 0) return null;
    const avg = values.reduce((sum, value) => sum + clampProgress(value), 0) / values.length;
    return {
      kind: 'progress',
      value: Math.round(avg),
      ratio: Math.round(avg),
      contributing: values.length,
    };
  }

  if (prop.type === 'number') {
    const values = rows
      .map((row) => row.cells[prop.id])
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    if (values.length === 0) return null;
    const total = values.reduce((sum, value) => sum + value, 0);
    // Pas de barre : une somme n'a pas de maximum connu, et en inventer un
    // (« sur le total du plateau ») donnerait une jauge qui bouge quand une
    // autre colonne change.
    return { kind: 'number', value: total, ratio: null, contributing: values.length };
  }

  if (prop.type === 'checkbox') {
    if (rows.length === 0) return null;
    const checked = rows.filter((row) => row.cells[prop.id] === true).length;
    return {
      kind: 'checkbox',
      value: checked,
      ratio: Math.round((checked / rows.length) * 100),
      contributing: rows.length,
    };
  }

  return null;
}

/** Propriétés qu'un résumé de colonne sait traiter. */
export function isSummarizable(prop: DbProperty): boolean {
  return prop.type === 'progress' || prop.type === 'number' || prop.type === 'checkbox';
}

/**
 * Colonnes à afficher, une fois « masquer les colonnes vides » appliqué.
 *
 * Garde-fou : si TOUT est vide, on montre le plateau entier plutôt qu'une page
 * blanche — un plateau sans colonne n'offre aucun endroit où déposer la
 * première carte, et donne l'impression que la vue est cassée.
 */
export function visibleColumns(
  columns: readonly BoardColumn[],
  byColumn: Record<string, DbRow[]>,
  hideEmpty: boolean
): BoardColumn[] {
  if (!hideEmpty) return [...columns];
  const kept = columns.filter((column) => (byColumn[column.id]?.length ?? 0) > 0);
  return kept.length > 0 ? kept : [...columns];
}
