/**
 * tableErgonomics — Filarr Notes / bases inline
 *
 * Fonctions PURES de l'ergonomie de la vue table : largeurs de colonnes
 * (défaut par type, lecture et écriture dans la vue), réordonnancement des
 * lignes, résolution des déplacements clavier dans la grille.
 *
 * Aucune ne touche au DOM ni aux données du document : la vue les appelle et
 * commite le résultat au point unique habituel. C'est ce qui les rend
 * testables sans rendu — et ce qui garde DatabaseTableView lisible.
 */

import type { DbRow, DbView, PropertyType } from './types';
import { clampColumnWidth, DB_COL_MIN_WIDTH } from './types';

// ==================== Largeurs de colonnes ====================

/**
 * Largeur d'office d'une colonne selon son type. Une base neuve doit être
 * lisible AVANT tout réglage : une case à cocher n'a pas besoin de 200 px, une
 * multi-sélection en veut plus qu'un nombre.
 */
export function defaultColumnWidth(type: PropertyType): number {
  switch (type) {
    case 'checkbox':
      return 90;
    case 'number':
      return 120;
    case 'rating':
      return 130;
    case 'rollup':
      return 130;
    case 'progress':
      return 150;
    case 'date':
      return 150;
    case 'createdTime':
    case 'updatedTime':
      return 170;
    case 'select':
      return 160;
    case 'note':
      return 180;
    case 'multiSelect':
    case 'relation':
    case 'url':
    case 'email':
    case 'phone':
      return 200;
    default:
      // texte : la colonne qui porte le titre, la plus large par défaut
      return 220;
  }
}

/** Largeur retenue pour une colonne : celle de la vue, sinon celle du type */
export function columnWidthOf(
  view: Pick<DbView, 'columnWidths'> | undefined | null,
  propId: string,
  type: PropertyType
): number {
  const stored = view?.columnWidths?.[propId];
  return typeof stored === 'number' && Number.isFinite(stored)
    ? clampColumnWidth(stored)
    : defaultColumnWidth(type);
}

/**
 * Largeurs de la vue après réglage d'une colonne. `null` REND la colonne à sa
 * largeur d'office (l'entrée disparaît au lieu d'être figée sur la valeur
 * calculée : changer le type de la colonne la remet alors d'aplomb tout seul).
 */
export function withColumnWidth(
  view: Pick<DbView, 'columnWidths'>,
  propId: string,
  px: number | null
): Record<string, number> | undefined {
  const next: Record<string, number> = { ...(view.columnWidths ?? {}) };
  if (px === null) delete next[propId];
  else next[propId] = clampColumnWidth(px);
  return Object.keys(next).length > 0 ? next : undefined;
}

/** Deux tables de largeurs identiques → aucune écriture (un clic sans glissé ne salit pas la note) */
export function columnWidthsEqual(
  a: Record<string, number> | undefined,
  b: Record<string, number> | undefined
): boolean {
  const ka = Object.keys(a ?? {});
  const kb = Object.keys(b ?? {});
  if (ka.length !== kb.length) return false;
  return ka.every((k) => (a as Record<string, number>)[k] === (b ?? {})[k]);
}

/**
 * Largeur d'un réajustement au contenu : la plus large des mesures, bornée.
 * Les mesures viennent du DOM (texte des cellules), la décision est ici pour
 * rester vérifiable — une colonne vide retombe sur sa largeur d'office.
 */
export function fitColumnWidth(measures: readonly number[], type: PropertyType): number {
  const usable = measures.filter((m) => Number.isFinite(m) && m > 0);
  if (usable.length === 0) return defaultColumnWidth(type);
  return clampColumnWidth(Math.max(DB_COL_MIN_WIDTH, ...usable));
}

// ==================== Réordonnancement des lignes ====================

export type DropPlace = 'before' | 'after';

/**
 * Ligne déplacée avant ou après une autre, dans l'ordre RÉEL des données (pas
 * dans celui de la vue) : c'est le seul ordre qui se conserve. Rend `null`
 * quand rien ne bouge — le geste ne coûte alors aucune écriture.
 */
export function reorderRows(
  rows: readonly DbRow[],
  draggedId: string,
  targetId: string,
  place: DropPlace
): DbRow[] | null {
  if (draggedId === targetId) return null;
  const dragged = rows.find((r) => r.id === draggedId);
  if (!dragged || !rows.some((r) => r.id === targetId)) return null;
  const without = rows.filter((r) => r.id !== draggedId);
  const at = without.findIndex((r) => r.id === targetId);
  const index = place === 'before' ? at : at + 1;
  const next = [...without.slice(0, index), dragged, ...without.slice(index)];
  // Déposée de part et d'autre de sa propre place : l'ordre est le même
  if (next.every((r, i) => r.id === rows[i].id)) return null;
  return next;
}

/**
 * Repli clavier du glissé-déposé : la ligne échange sa place avec la
 * précédente ou la suivante TELLES QUE LA VUE LES MONTRE (une ligne masquée par
 * un filtre ne fait pas trébucher le déplacement).
 */
export function moveRowByOffset(
  rows: readonly DbRow[],
  visibleIds: readonly string[],
  rowId: string,
  delta: -1 | 1
): DbRow[] | null {
  const i = visibleIds.indexOf(rowId);
  if (i < 0) return null;
  const j = i + delta;
  if (j < 0 || j >= visibleIds.length) return null;
  return reorderRows(rows, rowId, visibleIds[j], delta < 0 ? 'before' : 'after');
}

// ==================== Navigation clavier dans la grille ====================

export interface GridPos {
  row: number;
  col: number;
}

export interface GridSize {
  rows: number;
  cols: number;
}

export type GridMove = GridPos;

/**
 * Cellule visée par une touche, ou `null` quand la touche ne concerne pas la
 * grille (l'appelant n'intercepte alors rien). Aucun enroulement sur les
 * flèches : arrivé au bord, on y reste — c'est le comportement d'un tableur.
 *
 * LA TABULATION N'EST PAS À NOUS. C'est le patron habituel d'une grille : les
 * FLÈCHES déplacent d'une cellule (une seule est tabulable à la fois, cf. le
 * tabindex tournant de la vue), et Tab rend la main au reste de la page. La
 * retenir cellule par cellule — même en la relâchant aux deux coins extrêmes —
 * enferme le focus dans un tableau de trois cents lignes.
 */
export function resolveGridMove(
  key: string,
  mods: { shift?: boolean; ctrl?: boolean },
  cur: GridPos,
  size: GridSize
): GridMove | null {
  const { rows, cols } = size;
  if (rows <= 0 || cols <= 0) return null;
  const row = Math.max(0, Math.min(cur.row, rows - 1));
  const col = Math.max(0, Math.min(cur.col, cols - 1));

  switch (key) {
    case 'ArrowRight':
      return col + 1 < cols ? { row, col: col + 1 } : null;
    case 'ArrowLeft':
      return col > 0 ? { row, col: col - 1 } : null;
    case 'ArrowDown':
      return row + 1 < rows ? { row: row + 1, col } : null;
    case 'ArrowUp':
      return row > 0 ? { row: row - 1, col } : null;
    case 'Home':
      return mods.ctrl ? { row: 0, col: 0 } : col > 0 ? { row, col: 0 } : null;
    case 'End':
      return mods.ctrl
        ? { row: rows - 1, col: cols - 1 }
        : col < cols - 1
          ? { row, col: cols - 1 }
          : null;
    default:
      // Tab compris : la grille ne le retient pas
      return null;
  }
}
