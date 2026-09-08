/**
 * Plateau kanban — répartition, couloirs, plafonds, résumés.
 *
 *   npx vitest run src/renderer/components/notes/extensions/inlineDatabase/__tests__/boardLayout.vitest.ts
 *
 * Ce que ces cas protègent : RIEN NE DISPARAÎT. Une carte dont la valeur de
 * regroupement ne désigne plus rien reste visible, un plateau entièrement vide
 * garde ses colonnes, et un résumé sans matière dit « rien » plutôt que « zéro ».
 */

import { describe, it, expect } from 'vitest';
import type { DbProperty, DbRow } from '../types';
import {
  BOARD_NONE,
  boardColumns,
  boardLanes,
  clampProgress,
  columnSummary,
  isSummarizable,
  progressFromPointer,
  rowsInLane,
  splitByColumn,
  visibleColumns,
  visibleLanes,
  wipStatus,
} from '../boardLayout';

const colorOf = (id: string) => `color:${id}`;

const status: DbProperty = {
  id: 'st',
  name: 'Statut',
  type: 'select',
  options: [
    { id: 'todo', label: 'À faire', color: 'blue' },
    { id: 'doing', label: 'En cours', color: 'amber' },
  ],
};

const owner: DbProperty = {
  id: 'ow',
  name: 'Responsable',
  type: 'select',
  options: [{ id: 'ana', label: 'Ana', color: 'green' }],
};

const progress: DbProperty = { id: 'pr', name: 'Avancement', type: 'progress' };
const load: DbProperty = { id: 'ld', name: 'Charge', type: 'number' };
const done: DbProperty = { id: 'dn', name: 'Fini', type: 'checkbox' };

const row = (id: string, cells: Record<string, unknown>): DbRow => ({ id, cells });

describe('boardColumns', () => {
  it('range « Sans valeur » en dernier, toujours', () => {
    const columns = boardColumns(status, 'Sans valeur', colorOf);
    expect(columns.map((c) => c.id)).toEqual(['todo', 'doing', BOARD_NONE]);
    expect(columns[columns.length - 1].color).toBeNull();
  });

  it('sans propriété de regroupement, il reste la colonne des non-triées', () => {
    expect(boardColumns(undefined, 'Sans valeur', colorOf).map((c) => c.id)).toEqual([BOARD_NONE]);
  });
});

describe('splitByColumn', () => {
  const columns = boardColumns(status, 'Sans valeur', colorOf);

  it('classe chaque ligne dans sa colonne', () => {
    const map = splitByColumn(
      [row('a', { st: 'todo' }), row('b', { st: 'doing' })],
      status,
      columns
    );
    expect(map.todo.map((r) => r.id)).toEqual(['a']);
    expect(map.doing.map((r) => r.id)).toEqual(['b']);
  });

  it('récupère une valeur ORPHELINE au lieu de perdre la carte', () => {
    // Option supprimée, donnée venue d'un import : la ligne existe, elle doit
    // se voir quelque part. C'est le défaut le plus coûteux d'un plateau.
    const map = splitByColumn([row('a', { st: 'disparu' }), row('b', {})], status, columns);
    expect(map[BOARD_NONE].map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('crée une entrée pour chaque colonne, même vide', () => {
    const map = splitByColumn([], status, columns);
    expect(Object.keys(map).sort()).toEqual([BOARD_NONE, 'doing', 'todo'].sort());
  });
});

describe('couloirs', () => {
  it('sans second axe, un unique couloir contient tout', () => {
    const lanes = boardLanes(undefined, 'Sans valeur', colorOf);
    expect(lanes).toHaveLength(1);
    expect(rowsInLane([row('a', {}), row('b', {})], undefined, lanes[0].id)).toHaveLength(2);
  });

  it('classe par option, et récupère les orphelines dans « Sans valeur »', () => {
    const rows = [row('a', { ow: 'ana' }), row('b', { ow: 'parti' }), row('c', {})];
    expect(rowsInLane(rows, owner, 'ana').map((r) => r.id)).toEqual(['a']);
    expect(rowsInLane(rows, owner, BOARD_NONE).map((r) => r.id)).toEqual(['b', 'c']);
  });

  it('n’affiche « Sans valeur » que s’il porte des cartes', () => {
    // Une bande vide sous chaque plateau bien rangé n'apprend rien et coûte de
    // la hauteur d'écran.
    const lanes = boardLanes(owner, 'Sans valeur', colorOf);
    expect(visibleLanes(lanes, [row('a', { ow: 'ana' })], owner).map((l) => l.id)).toEqual(['ana']);
    expect(visibleLanes(lanes, [row('a', {})], owner).map((l) => l.id)).toEqual([
      'ana',
      BOARD_NONE,
    ]);
  });

  it('garde les couloirs NOMMÉS même vides — ce sont des cases à remplir', () => {
    const lanes = boardLanes(owner, 'Sans valeur', colorOf);
    expect(visibleLanes(lanes, [], owner).map((l) => l.id)).toEqual(['ana']);
  });
});

describe('wipStatus', () => {
  it('distingue sous le plafond, au plafond et au-dessus', () => {
    expect(wipStatus(2, 3)).toBe('under');
    expect(wipStatus(3, 3)).toBe('full');
    expect(wipStatus(4, 3)).toBe('over');
  });

  it('sans plafond, aucun état — et donc aucune couleur', () => {
    expect(wipStatus(9, undefined)).toBeNull();
    expect(wipStatus(9, 0)).toBeNull();
    expect(wipStatus(9, Number.NaN)).toBeNull();
  });
});

describe('progressFromPointer', () => {
  const rect = { left: 100, width: 200 };

  it('aimante au multiple de 5 — personne ne vise 63 %', () => {
    expect(progressFromPointer(200, rect)).toBe(50);
    expect(progressFromPointer(226, rect)).toBe(65);
  });

  it('reste dans 0-100 même hors de la barre', () => {
    expect(progressFromPointer(0, rect)).toBe(0);
    expect(progressFromPointer(9999, rect)).toBe(100);
  });

  it('ne divise pas par zéro sur une barre pas encore mesurée', () => {
    expect(progressFromPointer(120, { left: 100, width: 0 })).toBe(0);
  });
});

describe('clampProgress', () => {
  it('ramène dans les bornes et neutralise NaN', () => {
    expect(clampProgress(-4)).toBe(0);
    expect(clampProgress(140)).toBe(100);
    expect(clampProgress(Number.NaN)).toBe(0);
  });
});

describe('columnSummary', () => {
  it('progression : la moyenne, avec sa barre', () => {
    const summary = columnSummary([row('a', { pr: 40 }), row('b', { pr: 80 })], progress);
    expect(summary).toEqual({ kind: 'progress', value: 60, ratio: 60, contributing: 2 });
  });

  it('nombre : la somme, SANS barre', () => {
    // Une somme n'a pas de maximum connu ; en inventer un donnerait une jauge
    // qui bouge quand une autre colonne change.
    const summary = columnSummary([row('a', { ld: 3 }), row('b', { ld: 5 })], load);
    expect(summary).toEqual({ kind: 'number', value: 8, ratio: null, contributing: 2 });
  });

  it('case à cocher : combien de cochées sur combien', () => {
    const summary = columnSummary([row('a', { dn: true }), row('b', {}), row('c', {})], done);
    expect(summary).toEqual({ kind: 'checkbox', value: 1, ratio: 33, contributing: 3 });
  });

  it('rien à résumer → « rien », jamais « zéro »', () => {
    // La différence entre « aucune donnée » et « 0 % » est celle entre une
    // colonne vierge et une colonne à l'arrêt.
    expect(columnSummary([], progress)).toBeNull();
    expect(columnSummary([row('a', {})], progress)).toBeNull();
    expect(columnSummary([row('a', { ld: 'douze' })], load)).toBeNull();
  });

  it('ignore les valeurs illisibles au lieu de fausser la moyenne', () => {
    const summary = columnSummary([row('a', { pr: 50 }), row('b', { pr: 'beaucoup' })], progress);
    expect(summary?.value).toBe(50);
    expect(summary?.contributing).toBe(1);
  });

  it('sans propriété désignée, pas de résumé', () => {
    expect(columnSummary([row('a', { pr: 50 })], undefined)).toBeNull();
  });

  it('ne prétend pas résumer un type qu’il ne sait pas lire', () => {
    expect(isSummarizable(status)).toBe(false);
    expect(columnSummary([row('a', { st: 'todo' })], status)).toBeNull();
    expect([progress, load, done].every(isSummarizable)).toBe(true);
  });
});

describe('visibleColumns', () => {
  const columns = boardColumns(status, 'Sans valeur', colorOf);

  it('masque les colonnes vides quand on le demande', () => {
    const byColumn = splitByColumn([row('a', { st: 'todo' })], status, columns);
    expect(visibleColumns(columns, byColumn, true).map((c) => c.id)).toEqual(['todo']);
  });

  it('ne masque rien quand le réglage est éteint', () => {
    const byColumn = splitByColumn([row('a', { st: 'todo' })], status, columns);
    expect(visibleColumns(columns, byColumn, false)).toHaveLength(3);
  });

  it('un plateau ENTIÈREMENT vide garde ses colonnes', () => {
    // Sinon il ne resterait aucun endroit où déposer la première carte, et la
    // vue passerait pour cassée.
    const byColumn = splitByColumn([], status, columns);
    expect(visibleColumns(columns, byColumn, true)).toHaveLength(3);
  });
});
