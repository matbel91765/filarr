/**
 * Contrat des valeurs par défaut des bases inline.
 *
 * Trois subtilités faciles à casser au refactor et invisibles à la compilation :
 * `undefined` dans les overrides EFFACE la cellule (le board impose ainsi sa
 * colonne « Sans valeur »), multiSelect reçoit un tableau et non l'id nu, et un
 * défaut pointant une option supprimée ne remplit rien.
 */

import { describe, it, expect } from 'vitest';
import type { DbProperty } from '../types';
import { defaultCells, newRow, parseDbData, serializeDbData } from '../types';

const statut: DbProperty = {
  id: 'p-statut',
  name: 'Statut',
  type: 'select',
  options: [
    { id: 'o-todo', label: 'À voir', color: 'gray' },
    { id: 'o-done', label: 'Vu', color: 'green' },
  ],
  defaultOptionId: 'o-todo',
};

const genres: DbProperty = {
  id: 'p-genres',
  name: 'Genres',
  type: 'multiSelect',
  options: [{ id: 'o-sf', label: 'SF', color: 'blue' }],
  defaultOptionId: 'o-sf',
};

const titre: DbProperty = { id: 'p-titre', name: 'Titre', type: 'text' };

describe('defaultCells', () => {
  it('pose l’id nu pour select et un tableau pour multiSelect', () => {
    expect(defaultCells([statut, genres, titre])).toEqual({
      'p-statut': 'o-todo',
      'p-genres': ['o-sf'],
    });
  });

  it('ignore un défaut pointant une option supprimée', () => {
    const orphelin: DbProperty = { ...statut, options: [statut.options![1]] };
    expect(defaultCells([orphelin])).toEqual({});
  });

  it('ignore le défaut d’un type sans options', () => {
    expect(defaultCells([{ ...titre, defaultOptionId: 'o-todo' }])).toEqual({});
  });

  it('rend un tableau distinct par appel (pas de partage entre lignes)', () => {
    const a = defaultCells([genres])['p-genres'] as string[];
    const b = defaultCells([genres])['p-genres'] as string[];
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });
});

describe('newRow', () => {
  it('applique les défauts du schéma et horodate la création', () => {
    const row = newRow([statut, titre]);
    expect(row.cells['p-statut']).toBe('o-todo');
    expect(row.createdAt).toBeTruthy();
    expect(row.updatedAt).toBeUndefined();
  });

  it('les overrides gagnent sur les défauts (colonne du kanban)', () => {
    expect(newRow([statut], { 'p-statut': 'o-done' }).cells['p-statut']).toBe('o-done');
  });

  it('un override undefined efface la cellule (colonne « Sans valeur »)', () => {
    expect('p-statut' in newRow([statut], { 'p-statut': undefined }).cells).toBe(false);
  });

  it('donne des identifiants distincts à deux lignes', () => {
    expect(newRow([statut]).id).not.toBe(newRow([statut]).id);
  });
});

describe('parseDbData', () => {
  it('préserve defaultOptionId au round-trip', () => {
    const data = { properties: [statut], rows: [newRow([statut])] };
    expect(parseDbData(serializeDbData(data)).properties[0].defaultOptionId).toBe('o-todo');
  });

  it('ignore un defaultOptionId non-string', () => {
    const json = JSON.stringify({
      properties: [{ ...statut, defaultOptionId: 42 }],
      rows: [],
    });
    expect(parseDbData(json).properties[0].defaultOptionId).toBeUndefined();
  });

  it('rend une base vide sur données corrompues', () => {
    expect(parseDbData('pas du json')).toEqual({ properties: [], rows: [] });
  });
});
