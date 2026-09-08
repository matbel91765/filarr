/**
 * Ergonomie de la vue table : largeurs de colonnes rangées PAR VUE,
 * réordonnancement des lignes et résolution des touches de la grille.
 *
 * Ce que ces cas gardent, parce que ça se casse en silence :
 *  - une largeur appartient à UNE vue et ne déborde pas sur les autres ;
 *  - un geste qui ne change rien ne produit aucune écriture (la note ne se
 *    salit pas pour un simple clic) ;
 *  - un déplacement se calcule sur l'ordre RÉEL des lignes, même quand la vue
 *    n'en montre qu'une partie ;
 *  - la grille ne retient pas la tabulation (aucun piège à focus).
 */

import { describe, it, expect } from 'vitest';
import type { DbRow, DbView } from '../types';
import { clampColumnWidth, DB_COL_MAX_WIDTH, DB_COL_MIN_WIDTH, parseDbData } from '../types';
import {
  columnWidthOf,
  columnWidthsEqual,
  defaultColumnWidth,
  fitColumnWidth,
  moveRowByOffset,
  reorderRows,
  resolveGridMove,
  withColumnWidth,
} from '../tableErgonomics';

const view = (over: Partial<DbView> = {}): DbView => ({
  id: 'v-1',
  name: 'Vue',
  type: 'table',
  filters: [],
  sorts: [],
  ...over,
});

const rows: DbRow[] = [
  { id: 'r1', cells: {} },
  { id: 'r2', cells: {} },
  { id: 'r3', cells: {} },
  { id: 'r4', cells: {} },
];

const ids = (list: DbRow[] | null): string[] => (list ?? []).map((r) => r.id);

describe('largeurs de colonnes', () => {
  it('retombe sur la largeur du type quand la vue n’en range aucune', () => {
    expect(columnWidthOf(view(), 'p-1', 'checkbox')).toBe(defaultColumnWidth('checkbox'));
    expect(columnWidthOf(undefined, 'p-1', 'text')).toBe(defaultColumnWidth('text'));
  });

  it('préfère la largeur rangée dans la vue, bornes appliquées', () => {
    const v = view({ columnWidths: { 'p-1': 320, 'p-2': 5, 'p-3': 5000 } });
    expect(columnWidthOf(v, 'p-1', 'text')).toBe(320);
    expect(columnWidthOf(v, 'p-2', 'text')).toBe(DB_COL_MIN_WIDTH);
    expect(columnWidthOf(v, 'p-3', 'text')).toBe(DB_COL_MAX_WIDTH);
  });

  it('range une largeur sans toucher aux autres colonnes', () => {
    const v = view({ columnWidths: { 'p-1': 200 } });
    expect(withColumnWidth(v, 'p-2', 300)).toEqual({ 'p-1': 200, 'p-2': 300 });
    // La vue d'origine n'est pas modifiée en place
    expect(v.columnWidths).toEqual({ 'p-1': 200 });
  });

  it('rend une colonne à sa largeur d’office (et efface la table devenue vide)', () => {
    expect(withColumnWidth(view({ columnWidths: { 'p-1': 200 } }), 'p-1', null)).toBeUndefined();
    expect(withColumnWidth(view({ columnWidths: { 'p-1': 200, 'p-2': 90 } }), 'p-1', null)).toEqual(
      {
        'p-2': 90,
      }
    );
  });

  it('reconnaît deux tables identiques (aucune écriture pour un clic sans glissé)', () => {
    expect(columnWidthsEqual({ a: 100 }, { a: 100 })).toBe(true);
    expect(columnWidthsEqual(undefined, undefined)).toBe(true);
    expect(columnWidthsEqual({ a: 100 }, { a: 101 })).toBe(false);
    expect(columnWidthsEqual({ a: 100 }, { a: 100, b: 90 })).toBe(false);
    expect(columnWidthsEqual(undefined, { a: 100 })).toBe(false);
  });

  it('réajuste au contenu, et retombe sur le type quand il n’y a rien à mesurer', () => {
    expect(fitColumnWidth([120, 260, 90], 'text')).toBe(260);
    expect(fitColumnWidth([], 'checkbox')).toBe(defaultColumnWidth('checkbox'));
    expect(fitColumnWidth([12], 'text')).toBe(DB_COL_MIN_WIDTH);
    expect(fitColumnWidth([5000], 'text')).toBe(DB_COL_MAX_WIDTH);
  });

  it('clampColumnWidth arrondit et supporte une valeur illisible', () => {
    expect(clampColumnWidth(200.6)).toBe(201);
    expect(clampColumnWidth(Number.NaN)).toBe(DB_COL_MIN_WIDTH);
  });
});

describe('persistance des largeurs dans le document', () => {
  it('relit les largeurs vue par vue, en jetant ce qui n’est pas un nombre', () => {
    const json = JSON.stringify({
      properties: [],
      rows: [],
      views: [
        {
          id: 'v-1',
          name: 'A',
          type: 'table',
          filters: [],
          sorts: [],
          columnWidths: { 'p-1': 300 },
        },
        {
          id: 'v-2',
          name: 'B',
          type: 'table',
          filters: [],
          sorts: [],
          columnWidths: { 'p-1': 'large', 'p-2': 4000 },
        },
        { id: 'v-3', name: 'C', type: 'table', filters: [], sorts: [] },
      ],
    });
    const parsed = parseDbData(json);
    expect(parsed.views?.[0].columnWidths).toEqual({ 'p-1': 300 });
    // Valeur illisible jetée, valeur démesurée ramenée dans les bornes
    expect(parsed.views?.[1].columnWidths).toEqual({ 'p-2': DB_COL_MAX_WIDTH });
    expect(parsed.views?.[2].columnWidths).toBeUndefined();
  });

  it('une largeur réglée ici ne déborde pas sur la vue d’à côté', () => {
    const a = view({ id: 'v-1', columnWidths: { 'p-1': 300 } });
    const b = view({ id: 'v-2' });
    expect(columnWidthOf(a, 'p-1', 'text')).toBe(300);
    expect(columnWidthOf(b, 'p-1', 'text')).toBe(defaultColumnWidth('text'));
  });
});

describe('réordonnancement des lignes', () => {
  it('dépose avant ou après la ligne visée', () => {
    expect(ids(reorderRows(rows, 'r4', 'r1', 'before'))).toEqual(['r4', 'r1', 'r2', 'r3']);
    expect(ids(reorderRows(rows, 'r1', 'r3', 'after'))).toEqual(['r2', 'r3', 'r1', 'r4']);
  });

  it('ne produit rien quand l’ordre ne bouge pas', () => {
    expect(reorderRows(rows, 'r1', 'r1', 'after')).toBeNull();
    // Déposée juste après celle qui la précède déjà : même ordre
    expect(reorderRows(rows, 'r2', 'r1', 'after')).toBeNull();
    expect(reorderRows(rows, 'r2', 'r3', 'before')).toBeNull();
  });

  it('ignore une ligne inconnue plutôt que de bousculer l’ordre', () => {
    expect(reorderRows(rows, 'fantome', 'r1', 'after')).toBeNull();
    expect(reorderRows(rows, 'r1', 'fantome', 'after')).toBeNull();
  });

  it('ne perd ni ne duplique aucune ligne', () => {
    const next = reorderRows(rows, 'r3', 'r1', 'before');
    expect(next).not.toBeNull();
    expect(next).toHaveLength(rows.length);
    expect(new Set(ids(next)).size).toBe(rows.length);
  });

  it('déplace d’un cran dans l’ordre MONTRÉ, filtres compris', () => {
    // La vue masque r2 : monter r3 le fait passer devant r1, pas devant r2
    const visibles = ['r1', 'r3', 'r4'];
    expect(ids(moveRowByOffset(rows, visibles, 'r3', -1))).toEqual(['r3', 'r1', 'r2', 'r4']);
    expect(ids(moveRowByOffset(rows, visibles, 'r1', 1))).toEqual(['r2', 'r3', 'r1', 'r4']);
  });

  it('reste immobile aux extrémités et sur une ligne hors de la vue', () => {
    const visibles = ['r1', 'r3', 'r4'];
    expect(moveRowByOffset(rows, visibles, 'r1', -1)).toBeNull();
    expect(moveRowByOffset(rows, visibles, 'r4', 1)).toBeNull();
    expect(moveRowByOffset(rows, visibles, 'r2', 1)).toBeNull();
  });
});

describe('navigation clavier dans la grille', () => {
  const size = { rows: 3, cols: 4 };
  const at = (row: number, col: number) => ({ row, col });

  it('déplace d’une cellule avec les flèches', () => {
    expect(resolveGridMove('ArrowRight', {}, at(1, 1), size)).toEqual(at(1, 2));
    expect(resolveGridMove('ArrowLeft', {}, at(1, 1), size)).toEqual(at(1, 0));
    expect(resolveGridMove('ArrowDown', {}, at(1, 1), size)).toEqual(at(2, 1));
    expect(resolveGridMove('ArrowUp', {}, at(1, 1), size)).toEqual(at(0, 1));
  });

  it('n’enroule pas sur les bords (comportement de tableur)', () => {
    expect(resolveGridMove('ArrowLeft', {}, at(0, 0), size)).toBeNull();
    expect(resolveGridMove('ArrowUp', {}, at(0, 0), size)).toBeNull();
    expect(resolveGridMove('ArrowRight', {}, at(2, 3), size)).toBeNull();
    expect(resolveGridMove('ArrowDown', {}, at(2, 3), size)).toBeNull();
  });

  it('Début/Fin bornent la ligne, avec Ctrl la grille entière', () => {
    expect(resolveGridMove('Home', {}, at(2, 3), size)).toEqual(at(2, 0));
    expect(resolveGridMove('End', {}, at(2, 0), size)).toEqual(at(2, 3));
    expect(resolveGridMove('Home', { ctrl: true }, at(2, 3), size)).toEqual(at(0, 0));
    expect(resolveGridMove('End', { ctrl: true }, at(0, 0), size)).toEqual(at(2, 3));
  });

  it('ne retient JAMAIS la tabulation (patron habituel d’une grille)', () => {
    // Retenue cellule par cellule, elle enfermait le focus dans le tableau :
    // seuls les deux coins extrêmes le laissaient sortir
    expect(resolveGridMove('Tab', {}, at(0, 3), size)).toBeNull();
    expect(resolveGridMove('Tab', { shift: true }, at(1, 0), size)).toBeNull();
    expect(resolveGridMove('Tab', {}, at(1, 1), size)).toBeNull();
    expect(resolveGridMove('Tab', { shift: true }, at(1, 1), size)).toBeNull();
    // Y compris aux extrémités, où l'ancien code rendait 'exit'
    expect(resolveGridMove('Tab', {}, at(2, 3), size)).toBeNull();
    expect(resolveGridMove('Tab', { shift: true }, at(0, 0), size)).toBeNull();
  });

  it('laisse passer ce qui ne la concerne pas', () => {
    expect(resolveGridMove('Enter', {}, at(0, 0), size)).toBeNull();
    expect(resolveGridMove('a', {}, at(0, 0), size)).toBeNull();
    expect(resolveGridMove('ArrowRight', {}, at(0, 0), { rows: 0, cols: 0 })).toBeNull();
  });

  it('ramène une position devenue hors bornes (colonne supprimée)', () => {
    expect(resolveGridMove('ArrowLeft', {}, at(9, 9), size)).toEqual(at(2, 2));
  });
});
