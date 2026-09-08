/**
 * Calculs en pied de colonne.
 *
 * La règle que ces tests protègent : **jamais de chiffre inventé**. Un « 0 »
 * affiché là où il n'y a rien à calculer est pire qu'une case vide — on le lit
 * comme une donnée, et on décide dessus.
 */

import { describe, it, expect } from 'vitest';
import {
  calculationsForType,
  computeColumnCalculation,
  formatCalculation,
  isCalculation,
} from '../columnCalculations';
import { parseDbData, serializeDbData, makeDefaultView } from '../types';
import type { DbProperty, DbRow, InlineDbData } from '../types';

const prop = (id: string, type: DbProperty['type']) => ({ id, name: id, type }) as DbProperty;

const NUM = prop('n', 'number');
const CHECK = prop('c', 'checkbox');
const DATE = prop('d', 'date');
const TEXT = prop('t', 'text');

const rows: DbRow[] = [
  { id: '1', cells: { n: 10, c: true, d: '2026-03-05', t: 'a' } },
  { id: '2', cells: { n: 20, c: false, d: '2026-01-02', t: 'a' } },
  { id: '3', cells: { n: 30, c: true, t: '' } },
  { id: '4', cells: {} },
];

const value = (p: DbProperty, calc: Parameters<typeof computeColumnCalculation>[2]) =>
  computeColumnCalculation(p, rows, calc);

describe('calculs numériques', () => {
  it('somme, moyenne, médiane, min, max, étendue', () => {
    expect(value(NUM, 'sum')).toEqual({ kind: 'number', value: 60 });
    expect(value(NUM, 'avg')).toEqual({ kind: 'number', value: 20 });
    expect(value(NUM, 'median')).toEqual({ kind: 'number', value: 20 });
    expect(value(NUM, 'min')).toEqual({ kind: 'number', value: 10 });
    expect(value(NUM, 'max')).toEqual({ kind: 'number', value: 30 });
    expect(value(NUM, 'range')).toEqual({ kind: 'number', value: 20 });
  });

  it('la moyenne ignore les cellules vides, elle ne les compte pas comme des zéros', () => {
    // 60/3 et non 60/4 : une cellule vide n'est pas une valeur nulle.
    expect(value(NUM, 'avg')).toEqual({ kind: 'number', value: 20 });
  });

  it('médiane sur un nombre pair de valeurs', () => {
    const pair: DbRow[] = [
      { id: '1', cells: { n: 1 } },
      { id: '2', cells: { n: 4 } },
    ];
    expect(computeColumnCalculation(NUM, pair, 'median')).toEqual({ kind: 'number', value: 2.5 });
  });

  it('ne rend RIEN quand aucune valeur numérique n existe', () => {
    expect(computeColumnCalculation(NUM, [{ id: '1', cells: {} }], 'sum')).toEqual({
      kind: 'none',
    });
  });

  it('refuse une somme sur une colonne de texte', () => {
    expect(value(TEXT, 'sum')).toEqual({ kind: 'none' });
  });
});

describe('comptages', () => {
  it('compte toutes les lignes, les vides et les non vides', () => {
    expect(value(TEXT, 'count')).toEqual({ kind: 'number', value: 4 });
    expect(value(TEXT, 'notEmpty')).toEqual({ kind: 'number', value: 2 });
    // La chaîne blanche compte comme vide, comme la cellule absente.
    expect(value(TEXT, 'empty')).toEqual({ kind: 'number', value: 2 });
  });

  it('compte les valeurs distinctes', () => {
    expect(value(TEXT, 'unique')).toEqual({ kind: 'number', value: 1 });
  });

  it('pourcentage sans population = rien du tout', () => {
    expect(computeColumnCalculation(TEXT, [], 'percentNotEmpty')).toEqual({ kind: 'none' });
    expect(computeColumnCalculation(CHECK, [], 'percentChecked')).toEqual({ kind: 'none' });
  });
});

describe('cases à cocher', () => {
  it('compte les cochées et leur part', () => {
    expect(value(CHECK, 'checked')).toEqual({ kind: 'number', value: 2 });
    expect(value(CHECK, 'percentChecked')).toEqual({ kind: 'percent', value: 50 });
  });

  it('« cochées » n a aucun sens hors d une case à cocher', () => {
    expect(value(NUM, 'checked')).toEqual({ kind: 'none' });
  });
});

describe('dates', () => {
  it('rend la plus ancienne et la plus récente', () => {
    expect(value(DATE, 'min')).toEqual({ kind: 'date', value: '2026-01-02' });
    expect(value(DATE, 'max')).toEqual({ kind: 'date', value: '2026-03-05' });
  });
});

describe('calculs proposés par type', () => {
  it('ne propose que ce qui a du sens', () => {
    expect(calculationsForType('number')).toContain('sum');
    expect(calculationsForType('text')).not.toContain('sum');
    expect(calculationsForType('checkbox')).toContain('percentChecked');
    expect(calculationsForType('text')).not.toContain('percentChecked');
    expect(calculationsForType('date')).toContain('max');
    expect(calculationsForType('date')).not.toContain('avg');
  });

  it('« aucun » est toujours proposé — on doit pouvoir retirer un calcul', () => {
    for (const type of ['text', 'number', 'checkbox', 'date'] as const) {
      expect(calculationsForType(type)[0]).toBe('none');
    }
  });
});

describe('affichage', () => {
  it('borne les décimales et suffixe les pourcentages', () => {
    expect(formatCalculation({ kind: 'number', value: 1 / 3 }, 'en')).toBe('0.33');
    expect(formatCalculation({ kind: 'percent', value: 66.6 }, 'en')).toBe('67 %');
    expect(formatCalculation({ kind: 'none' }, 'en')).toBe('');
  });
});

describe('persistance', () => {
  it('le calcul d une colonne survit à un aller-retour', () => {
    const data: InlineDbData = {
      properties: [NUM],
      rows: [],
      views: [{ ...makeDefaultView('table'), calculations: { n: 'sum' } }],
    };
    expect(parseDbData(serializeDbData(data)).views?.[0].calculations).toEqual({ n: 'sum' });
  });

  it('écarte une valeur inconnue plutôt que de la garder', () => {
    const raw = JSON.stringify({
      properties: [],
      rows: [],
      views: [
        {
          id: 'v',
          name: 'v',
          type: 'table',
          filters: [],
          sorts: [],
          calculations: { a: 'sum', b: 'inventé', c: 'none' },
        },
      ],
    });
    // « none » n'est pas un calcul à garder : c'est l'absence de calcul.
    expect(parseDbData(raw).views?.[0].calculations).toEqual({ a: 'sum' });
    expect(isCalculation('inventé')).toBe(false);
  });
});
