/**
 * Colonne PERSONNE.
 *
 * Ce que ces tests protègent surtout, c'est l'honnêteté du type : il stocke des
 * NOMS, pas des comptes. Pas d'annuaire, pas de mention, pas de droit d'accès —
 * et donc aucune promesse que l'application ne pourrait pas tenir hors ligne.
 */

import { describe, it, expect } from 'vitest';
import { initialsOf, knownPeople, peopleOf, personColorIndex, writePeople } from '../people';
import type { DbProperty, DbRow } from '../types';

const prop = { id: 'p', name: 'Responsable', type: 'person' } as DbProperty;

describe('peopleOf', () => {
  it('lit une liste de noms', () => {
    expect(peopleOf(['Ada', 'Grace'])).toEqual(['Ada', 'Grace']);
  });

  it('lit aussi une valeur HÉRITÉE en une seule chaîne', () => {
    // Un import (ou une saisie ancienne) écrit « Ada, Grace » : deux
    // personnes, pas un nom à rallonge.
    expect(peopleOf('Ada Lovelace, Grace Hopper')).toEqual(['Ada Lovelace', 'Grace Hopper']);
  });

  it('ignore le vide et ce qui n est pas du texte', () => {
    expect(peopleOf(undefined)).toEqual([]);
    expect(peopleOf('   ')).toEqual([]);
    expect(peopleOf([1, 'Ada', ''])).toEqual(['Ada']);
  });
});

describe('writePeople', () => {
  it('nettoie, dédoublonne sans tenir compte de la casse', () => {
    expect(writePeople([' Ada ', 'ada', 'Grace'])).toEqual(['Ada', 'Grace']);
  });

  it('rend `undefined` plutôt qu un tableau vide — la cellule est effacée', () => {
    expect(writePeople([])).toBeUndefined();
    expect(writePeople(['  ', ''])).toBeUndefined();
  });
});

describe('initialsOf', () => {
  it('prend la première et la dernière initiale', () => {
    expect(initialsOf('Ada Lovelace')).toBe('AL');
    expect(initialsOf('  jean-pierre  martin ')).toBe('JM');
  });

  it('un nom d un seul mot rend UNE lettre', () => {
    // Deux lettres du même mot se ressembleraient toutes.
    expect(initialsOf('Ada')).toBe('A');
  });

  it('ne casse pas sur un nom vide ou en emoji', () => {
    expect(initialsOf('   ')).toBe('?');
    expect(initialsOf('🙂 Bob')).toBe('🙂B');
  });
});

describe('personColorIndex', () => {
  it('est STABLE pour un nom donné', () => {
    // La couleur ne doit pas changer d'une session ni d'un appareil à l'autre,
    // sans que rien ne soit stocké.
    expect(personColorIndex('Ada', 8)).toBe(personColorIndex('Ada', 8));
    expect(personColorIndex('ADA', 8)).toBe(personColorIndex('ada', 8));
  });

  it('reste dans la palette', () => {
    for (const name of ['Ada', 'Grace', 'Katherine', 'Alan', 'Ève']) {
      const index = personColorIndex(name, 8);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(8);
    }
  });
});

describe('knownPeople — le seul annuaire disponible hors ligne', () => {
  const rows: DbRow[] = [
    { id: '1', cells: { p: ['Ada', 'Grace'] } },
    { id: '2', cells: { p: ['Ada'] } },
    { id: '3', cells: {} },
  ];

  it('classe du plus fréquent au moins fréquent', () => {
    expect(knownPeople(rows, prop)).toEqual(['Ada', 'Grace']);
  });

  it('ne rend rien quand la colonne est vide', () => {
    expect(knownPeople([{ id: '1', cells: {} }], prop)).toEqual([]);
  });
});
