/**
 * cellValues — Filarr Notes / bases inline
 *
 * Lecture DOUCE d'une cellule : familles de types et lecteurs typés, extraits
 * de `viewEngine` pour que le moteur des relations (`relations.ts`) les partage
 * sans nouer de cycle d'imports (viewEngine → relations → cellValues).
 *
 * Règle unique : une valeur d'un type inattendu s'affiche vide dans la table,
 * elle est donc vide ici aussi — jamais une exception, jamais une conversion
 * silencieuse.
 */

import type { DbProperty, DbRow, PropertyType } from './types';
import { relationIds } from './types';

export type FilterFamily =
  | 'text'
  | 'number'
  | 'select'
  | 'multiSelect'
  | 'checkbox'
  | 'date'
  | 'relation'
  | 'rollup';

/**
 * `note` (lien vers une note) n'a pas de famille : son contenu est un
 * identifiant opaque, aucune comparaison de valeur n'aurait de sens. Il ne
 * porte donc que « vide / non vide » (LINK_ONLY_OPS) et n'est pas triable.
 */
export function filterFamily(type: PropertyType): FilterFamily | null {
  switch (type) {
    case 'text':
    case 'url':
    case 'email':
    case 'phone':
    case 'person':
      // Une colonne PERSONNE se filtre comme du texte : « contient Ada » est le
      // geste attendu, et sans annuaire il n'y a pas d'identite a comparer.
      // (Commentaire placé APRÈS l'étiquette : entre deux `case`, il rendrait
      // le premier non vide aux yeux de `no-fallthrough`, qui refuserait.)
      return 'text';
    case 'number':
    case 'rating':
    case 'progress':
      return 'number';
    case 'select':
      return 'select';
    case 'multiSelect':
      return 'multiSelect';
    case 'checkbox':
      return 'checkbox';
    case 'date':
    case 'createdTime':
    case 'updatedTime':
      return 'date';
    case 'relation':
      return 'relation';
    case 'rollup':
      return 'rollup';
    default:
      return null;
  }
}

/** Types dont la valeur se compare comme un nombre (agrégats sum/avg/min/max) */
export function isNumericType(type: PropertyType): boolean {
  return type === 'number' || type === 'rating' || type === 'progress';
}

export const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function textOf(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

export function numberOf(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Ms du minuit LOCAL du jour porté par la valeur (accord avec l'affichage) */
export function dayStamp(v: unknown): number | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (s === '') return null;
  const m = DATE_RE.exec(s);
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    const t = new Date(y, mo - 1, d).getTime();
    return Number.isNaN(t) ? null : t;
  }
  // Horodatage ISO (créé/modifié) : ramené à son jour local
  const parsed = new Date(s);
  const t = parsed.getTime();
  if (Number.isNaN(t)) return null;
  return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate()).getTime();
}

/** Ms pleines (tri des colonnes créé/modifié : deux modifs du même jour se départagent) */
export function fullStamp(v: unknown): number | null {
  if (typeof v !== 'string' || v.trim() === '') return null;
  const t = new Date(v).getTime();
  return Number.isNaN(t) ? null : t;
}

export function optionIds(prop: DbProperty): Set<string> {
  return new Set((prop.options ?? []).map((o) => o.id));
}

/** Ids d'options RÉELLEMENT sélectionnés (une option supprimée ne compte plus) */
export function selectedOptionIds(prop: DbProperty, v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const known = optionIds(prop);
  return v.filter((x): x is string => typeof x === 'string' && known.has(x));
}

/**
 * Valeur comparable d'une propriété : les colonnes créé/modifié vivent sur la
 * LIGNE, pas dans `cells` — les oublier ferait des filtres toujours vides.
 */
export function cellValueFor(prop: DbProperty, row: DbRow): unknown {
  if (prop.type === 'createdTime') return row.createdAt;
  if (prop.type === 'updatedTime') return row.updatedAt;
  return row.cells[prop.id];
}

/**
 * « Vide » au sens du STOCKAGE : une valeur d'un type inattendu, ou une option
 * supprimée, n'apparaît nulle part — elle est donc vide ici aussi.
 *
 * Les relations et les agrégats se jugent sur ce qu'ils RÉSOLVENT, pas sur ce
 * qu'ils stockent : `viewEngine.isEmptyCell` les traite à part, avec le
 * contexte des bases visées. Ici, une relation est vide quand elle ne porte
 * aucun identifiant, et un agrégat — jamais stocké — est toujours vide.
 */
export function isEmptyCellBase(prop: DbProperty, value: unknown): boolean {
  switch (filterFamily(prop.type)) {
    case 'text':
      return textOf(value) === '';
    case 'number':
      return numberOf(value) === null;
    case 'select':
      return typeof value !== 'string' || !optionIds(prop).has(value);
    case 'multiSelect':
      return selectedOptionIds(prop, value).length === 0;
    case 'checkbox':
      // Une case est toujours dans un état : elle n'est jamais « vide »
      return false;
    case 'date':
      return dayStamp(value) === null;
    case 'relation':
      return relationIds(value).length === 0;
    case 'rollup':
      // Rien n'est stocké : sans contexte, il n'y a rien à lire
      return true;
    default:
      // note : un lien est vide tant qu'aucune note n'est accrochée
      return textOf(value) === '';
  }
}
