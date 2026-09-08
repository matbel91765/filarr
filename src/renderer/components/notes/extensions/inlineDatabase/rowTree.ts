/**
 * SOUS-ÉLÉMENTS : une ligne peut en porter d'autres.
 *
 * Trois règles gouvernent ce fichier, et elles découlent toutes du même
 * principe — rien ne disparaît en silence :
 *
 *  1. **L'imbrication survit au tri.** Un tri classe les FRÈRES entre eux ; il
 *     ne détache jamais un enfant de son parent. Un sous-élément qui sauterait
 *     ailleurs dès qu'on trie ne serait plus fiable, et on cesserait de s'en
 *     servir.
 *  2. **Un enfant dont le parent est filtré REMONTE à la racine.** Le faire
 *     disparaître avec lui masquerait une ligne qui répond pourtant au filtre,
 *     à cause d'une AUTRE ligne — un vide qu'on ne saurait pas expliquer.
 *  3. **Un cycle ne fait pas boucler.** Un parent qui redescend de son propre
 *     enfant (document abîmé, aller-retour de synchronisation) est traité comme
 *     orphelin : la ligne s'affiche à la racine, elle n'est jamais perdue.
 *
 * Module PUR : ni React, ni DOM.
 */

import type { DbRow } from './types';

/** Une ligne prête à être rendue, avec sa profondeur. */
export interface TreeRow {
  row: DbRow;
  /** 0 = racine. Borné par `MAX_DEPTH`. */
  depth: number;
  /** A des enfants VISIBLES (donc un chevron à afficher). */
  hasChildren: boolean;
}

/**
 * Profondeur maximale rendue.
 *
 * Au-delà, l'indentation mange la colonne et la table devient illisible. Les
 * lignes plus profondes ne sont pas perdues : elles s'affichent au dernier
 * niveau autorisé.
 */
export const MAX_DEPTH = 6;

/** Ligne dont on peut lire le parent, quel que soit l'état du document. */
function parentOf(row: DbRow): string | undefined {
  const parent = (row as DbRow & { parentId?: unknown }).parentId;
  return typeof parent === 'string' && parent !== '' ? parent : undefined;
}

/**
 * Est-ce que `candidate` descend de `rowId` ? Sert à interdire un cycle AVANT
 * de l'écrire (choisir son propre enfant comme parent).
 */
export function isDescendantOf(rows: DbRow[], candidateId: string, rowId: string): boolean {
  const byId = new Map(rows.map((row) => [row.id, row]));
  let current = byId.get(candidateId);
  let guard = 0;
  while (current && guard < 1000) {
    const parentId = parentOf(current);
    if (!parentId) return false;
    if (parentId === rowId) return true;
    current = byId.get(parentId);
    guard += 1;
  }
  return false;
}

/** Parents possibles pour une ligne : ni elle-même, ni sa descendance. */
export function eligibleParents(rows: DbRow[], rowId: string): DbRow[] {
  return rows.filter((row) => row.id !== rowId && !isDescendantOf(rows, row.id, rowId));
}

/**
 * Met à plat l'arbre des lignes VISIBLES, dans l'ordre d'affichage.
 *
 * `visibleRows` porte déjà l'ordre décidé par la vue (filtres puis tris) : on
 * ne le recalcule pas, on le respecte à chaque niveau.
 *
 * `collapsed` contient les identifiants des lignes repliées ; leur descendance
 * n'est pas rendue — mais elle reste comptée dans `hasChildren`, sinon le
 * chevron disparaîtrait au moment même où on veut le rouvrir.
 */
export function buildRowTree(visibleRows: DbRow[], collapsed: Set<string> = new Set()): TreeRow[] {
  const visibleIds = new Set(visibleRows.map((row) => row.id));

  const childrenOf = new Map<string, DbRow[]>();
  const roots: DbRow[] = [];

  for (const row of visibleRows) {
    const parentId = parentOf(row);
    // Parent absent de la vue (filtré, supprimé, ou cycle) → la ligne remonte
    // à la racine plutôt que de disparaître avec lui.
    const attached =
      parentId !== undefined &&
      visibleIds.has(parentId) &&
      parentId !== row.id &&
      !isDescendantOf(visibleRows, parentId, row.id);

    if (!attached) {
      roots.push(row);
      continue;
    }
    const bucket = childrenOf.get(parentId!);
    if (bucket) bucket.push(row);
    else childrenOf.set(parentId!, [row]);
  }

  const out: TreeRow[] = [];
  const walk = (row: DbRow, depth: number): void => {
    const children = childrenOf.get(row.id) ?? [];
    out.push({ row, depth: Math.min(depth, MAX_DEPTH), hasChildren: children.length > 0 });
    if (collapsed.has(row.id)) return;
    for (const child of children) walk(child, depth + 1);
  };

  for (const root of roots) walk(root, 0);
  return out;
}

/**
 * Retire une ligne en REMONTANT ses enfants d'un cran.
 *
 * Supprimer en cascade effacerait des lignes que l'utilisateur n'a pas
 * désignées — et une suppression en cascade ne se voit qu'après coup.
 */
export function removeRowKeepingChildren(rows: DbRow[], rowId: string): DbRow[] {
  const target = rows.find((row) => row.id === rowId);
  if (!target) return rows;
  const grandParent = parentOf(target);

  return rows
    .filter((row) => row.id !== rowId)
    .map((row) => (parentOf(row) === rowId ? withParent(row, grandParent) : row));
}

/** Rend la ligne avec un nouveau parent (ou sans parent si `undefined`). */
export function withParent(row: DbRow, parentId: string | undefined): DbRow {
  const next = { ...row } as DbRow & { parentId?: string };
  if (parentId === undefined) delete next.parentId;
  else next.parentId = parentId;
  return next;
}

/** Le parent d'une ligne, tel que le document le porte. */
export function parentIdOf(row: DbRow): string | undefined {
  return parentOf(row);
}
