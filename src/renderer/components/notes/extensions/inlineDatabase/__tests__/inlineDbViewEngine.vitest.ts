/**
 * Moteur des vues enregistrées : filtres, tris, migration, cohérence.
 *
 * Ce qui est vérifié ici ne se voit pas à la compilation : chaque opérateur de
 * chaque famille, le sort des valeurs manquantes (jamais une exception, jamais
 * un masquage silencieux), la stabilité du tri, et surtout la MIGRATION des
 * bases d'avant les vues — le seul chemin où une régression perdrait du travail
 * utilisateur.
 */

import { describe, it, expect, afterEach } from 'vitest';
import type { DbFilter, DbProperty, DbRow, DbView, InlineDbData } from '../types';
import {
  newRow,
  parseDbData,
  readActiveViewPref,
  serializeDbData,
  viewPrefKey,
  writeActiveViewPref,
} from '../types';
import {
  applyFilters,
  applySorts,
  applyView,
  countFilters,
  ensureViews,
  isEmptyCell,
  isOpValidForType,
  legacyAttrsFor,
  matchesFilter,
  opNeedsValue,
  opsForType,
  prefillCellsForView,
  resolveActiveView,
  sanitizeViews,
} from '../viewEngine';

/* ==================== Fixtures ==================== */

const titre: DbProperty = { id: 'p-titre', name: 'Titre', type: 'text' };
const lien: DbProperty = { id: 'p-lien', name: 'Lien', type: 'url' };
const nombre: DbProperty = { id: 'p-nb', name: 'Pages', type: 'number' };
const note5: DbProperty = { id: 'p-note', name: 'Note', type: 'rating' };
const avancement: DbProperty = { id: 'p-prog', name: 'Avancement', type: 'progress' };
const statut: DbProperty = {
  id: 'p-statut',
  name: 'Statut',
  type: 'select',
  options: [
    { id: 'o-todo', label: 'À faire', color: 'gray' },
    { id: 'o-doing', label: 'En cours', color: 'blue' },
    { id: 'o-done', label: 'Fait', color: 'green' },
  ],
};
const genres: DbProperty = {
  id: 'p-genres',
  name: 'Genres',
  type: 'multiSelect',
  options: [
    { id: 'o-sf', label: 'SF', color: 'blue' },
    { id: 'o-doc', label: 'Doc', color: 'green' },
  ],
};
const coche: DbProperty = { id: 'p-coche', name: 'Lu', type: 'checkbox' };
const jour: DbProperty = { id: 'p-jour', name: 'Échéance', type: 'date' };
const cree: DbProperty = { id: 'p-cree', name: 'Créé', type: 'createdTime' };
const lienNote: DbProperty = { id: 'p-note-ref', name: 'Note liée', type: 'note' };

const ALL_PROPS = [
  titre,
  lien,
  nombre,
  note5,
  avancement,
  statut,
  genres,
  coche,
  jour,
  cree,
  lienNote,
];

function row(id: string, cells: Record<string, unknown>, extra: Partial<DbRow> = {}): DbRow {
  return { id, cells, ...extra };
}

function dataOf(properties: DbProperty[], rows: DbRow[]): InlineDbData {
  return { properties, rows };
}

function view(filters: DbFilter[] = [], sorts: DbView['sorts'] = []): DbView {
  return { id: 'v-1', name: 'Vue', type: 'table', filters, sorts };
}

function f(propertyId: string, op: DbFilter['op'], value?: DbFilter['value']): DbFilter {
  return { id: `f-${propertyId}-${op}`, propertyId, op, ...(value === undefined ? {} : { value }) };
}

/** Identifiants des lignes qui passent — la forme la plus lisible des attentes */
function ids(rows: DbRow[]): string[] {
  return rows.map((r) => r.id);
}

function keep(properties: DbProperty[], rows: DbRow[], filter: DbFilter): string[] {
  return ids(applyFilters(dataOf(properties, rows), [filter]));
}

/* ==================== Familles d'opérateurs ==================== */

describe('familles d’opérateurs', () => {
  it('donne les opérateurs de la famille du type, pas d’une autre', () => {
    expect(opsForType('text')).toEqual([
      'contains',
      'notContains',
      'equals',
      'isEmpty',
      'isNotEmpty',
    ]);
    expect(opsForType('email')).toEqual(opsForType('text'));
    expect(opsForType('phone')).toEqual(opsForType('text'));
    expect(opsForType('url')).toEqual(opsForType('text'));
    expect(opsForType('number')).toEqual([
      'eq',
      'neq',
      'gt',
      'lt',
      'gte',
      'lte',
      'isEmpty',
      'isNotEmpty',
    ]);
    expect(opsForType('rating')).toEqual(opsForType('number'));
    expect(opsForType('progress')).toEqual(opsForType('number'));
    expect(opsForType('select')).toEqual(['is', 'isNot', 'isEmpty', 'isNotEmpty']);
    expect(opsForType('multiSelect')).toEqual(['contains', 'notContains', 'isEmpty', 'isNotEmpty']);
    expect(opsForType('checkbox')).toEqual(['isChecked', 'isUnchecked']);
    expect(opsForType('date')).toEqual(['before', 'after', 'on', 'isEmpty', 'isNotEmpty']);
    expect(opsForType('createdTime')).toEqual(opsForType('date'));
    expect(opsForType('updatedTime')).toEqual(opsForType('date'));
    expect(opsForType('note')).toEqual(['isEmpty', 'isNotEmpty']);
  });

  it('offre « vide » ET « non vide » à toute famille sauf la case à cocher', () => {
    // Le contrat de DbFilterOp l'annonce et le moteur l'implémente par
    // `isEmptyCell` : la table des opérateurs doit tenir la même promesse,
    // sinon l'UI cache une condition que le moteur sait faire.
    for (const prop of ALL_PROPS) {
      const ops = opsForType(prop.type);
      if (prop.type === 'checkbox') {
        expect(ops).not.toContain('isEmpty');
        expect(ops).not.toContain('isNotEmpty');
      } else {
        expect(ops).toContain('isEmpty');
        expect(ops).toContain('isNotEmpty');
      }
    }
  });

  it('« non vide » filtre vraiment dans les familles qui l’ont gagné', () => {
    // Avant, l'opérateur n'était pas dans la table : `isOpValidForType` le
    // refusait et le filtre restait INERTE — il ne masquait rien.
    const nombres = [row('r-a', { 'p-nb': 0 }), row('r-b', {})];
    expect(keep([nombre], nombres, f('p-nb', 'isNotEmpty'))).toEqual(['r-a']);

    const choix = [
      row('r-a', { 'p-statut': 'o-todo' }),
      row('r-b', {}),
      row('r-c', { 'p-statut': 'o-supprimee' }),
    ];
    expect(keep([statut], choix, f('p-statut', 'isNotEmpty'))).toEqual(['r-a']);

    const multi = [row('r-a', { 'p-genres': ['o-sf'] }), row('r-b', { 'p-genres': [] })];
    expect(keep([genres], multi, f('p-genres', 'isNotEmpty'))).toEqual(['r-a']);

    const jours = [row('r-a', { 'p-jour': '2026-02-10' }), row('r-b', { 'p-jour': 'bancal' })];
    expect(keep([jour], jours, f('p-jour', 'isNotEmpty'))).toEqual(['r-a']);
  });

  it('refuse un opérateur d’une autre famille', () => {
    expect(isOpValidForType('number', 'contains')).toBe(false);
    expect(isOpValidForType('text', 'gt')).toBe(false);
    expect(isOpValidForType('select', 'contains')).toBe(false);
    expect(isOpValidForType('checkbox', 'isEmpty')).toBe(false);
    expect(isOpValidForType('date', 'equals')).toBe(false);
  });

  it('sait quels opérateurs demandent un terme de comparaison', () => {
    expect(opNeedsValue('contains')).toBe(true);
    expect(opNeedsValue('isEmpty')).toBe(false);
    expect(opNeedsValue('isNotEmpty')).toBe(false);
    expect(opNeedsValue('isChecked')).toBe(false);
    expect(opNeedsValue('isUnchecked')).toBe(false);
  });
});

/* ==================== Texte / url / email / téléphone ==================== */

describe('filtres texte', () => {
  const rows = [
    row('r-a', { 'p-titre': 'Dune' }),
    row('r-b', { 'p-titre': 'dune messiah' }),
    row('r-c', { 'p-titre': '   ' }),
    row('r-d', {}),
    row('r-e', { 'p-titre': 42 }), // type inattendu : lu comme vide
  ];

  it('contient est insensible à la casse', () => {
    expect(keep([titre], rows, f('p-titre', 'contains', 'DUNE'))).toEqual(['r-a', 'r-b']);
  });

  it('ne contient pas garde les vides', () => {
    expect(keep([titre], rows, f('p-titre', 'notContains', 'messiah'))).toEqual([
      'r-a',
      'r-c',
      'r-d',
      'r-e',
    ]);
  });

  it('égal compare la valeur entière, pas un fragment', () => {
    expect(keep([titre], rows, f('p-titre', 'equals', 'dune'))).toEqual(['r-a']);
  });

  it('vide attrape blancs, absence et type inattendu', () => {
    expect(keep([titre], rows, f('p-titre', 'isEmpty'))).toEqual(['r-c', 'r-d', 'r-e']);
    expect(keep([titre], rows, f('p-titre', 'isNotEmpty'))).toEqual(['r-a', 'r-b']);
  });

  it('un filtre sans terme est inerte (il ne masque rien)', () => {
    expect(keep([titre], rows, f('p-titre', 'contains'))).toEqual(ids(rows));
    expect(keep([titre], rows, f('p-titre', 'contains', '   '))).toEqual(ids(rows));
  });

  it('s’applique pareil à url, email et téléphone', () => {
    const urls = [row('r-1', { 'p-lien': 'https://filarr.com/a' }), row('r-2', {})];
    expect(keep([lien], urls, f('p-lien', 'contains', 'filarr'))).toEqual(['r-1']);
    expect(keep([lien], urls, f('p-lien', 'isEmpty'))).toEqual(['r-2']);
  });
});

/* ==================== Nombre / évaluation / progression ==================== */

describe('filtres numériques', () => {
  const rows = [
    row('r-0', { 'p-nb': 0 }),
    row('r-5', { 'p-nb': 5 }),
    row('r-10', { 'p-nb': 10 }),
    row('r-vide', {}),
    row('r-texte', { 'p-nb': '7' }), // type inattendu : lu comme vide
  ];

  it('couvre les six comparaisons', () => {
    expect(keep([nombre], rows, f('p-nb', 'eq', 5))).toEqual(['r-5']);
    expect(keep([nombre], rows, f('p-nb', 'gt', 5))).toEqual(['r-10']);
    expect(keep([nombre], rows, f('p-nb', 'lt', 5))).toEqual(['r-0']);
    expect(keep([nombre], rows, f('p-nb', 'gte', 5))).toEqual(['r-5', 'r-10']);
    expect(keep([nombre], rows, f('p-nb', 'lte', 5))).toEqual(['r-0', 'r-5']);
  });

  it('zéro n’est pas vide', () => {
    expect(keep([nombre], rows, f('p-nb', 'isEmpty'))).toEqual(['r-vide', 'r-texte']);
  });

  it('≠ accepte les cellules vides, les autres comparaisons non', () => {
    expect(keep([nombre], rows, f('p-nb', 'neq', 5))).toEqual(['r-0', 'r-10', 'r-vide', 'r-texte']);
  });

  it('un terme absent rend le filtre inerte', () => {
    expect(keep([nombre], rows, f('p-nb', 'gt'))).toEqual(ids(rows));
  });

  it('vaut aussi pour évaluation et progression', () => {
    const mixte = [
      row('r-a', { 'p-note': 4, 'p-prog': 80 }),
      row('r-b', { 'p-note': 2, 'p-prog': 10 }),
    ];
    expect(keep([note5], mixte, f('p-note', 'gte', 4))).toEqual(['r-a']);
    expect(keep([avancement], mixte, f('p-prog', 'lt', 50))).toEqual(['r-b']);
  });
});

/* ==================== Sélection / multi-sélection ==================== */

describe('filtres de sélection', () => {
  const rows = [
    row('r-todo', { 'p-statut': 'o-todo' }),
    row('r-done', { 'p-statut': 'o-done' }),
    row('r-vide', {}),
    row('r-fantome', { 'p-statut': 'o-supprimee' }), // option disparue : lue comme vide
  ];

  it('est / n’est pas comparent par identifiant d’option', () => {
    expect(keep([statut], rows, f('p-statut', 'is', 'o-todo'))).toEqual(['r-todo']);
    expect(keep([statut], rows, f('p-statut', 'isNot', 'o-todo'))).toEqual([
      'r-done',
      'r-vide',
      'r-fantome',
    ]);
  });

  it('renommer une option ne change rien au filtre', () => {
    const renomme: DbProperty = {
      ...statut,
      options: (statut.options ?? []).map((o) =>
        o.id === 'o-todo' ? { ...o, label: 'Autre libellé' } : o
      ),
    };
    expect(keep([renomme], rows, f('p-statut', 'is', 'o-todo'))).toEqual(['r-todo']);
  });

  it('une option supprimée compte comme vide', () => {
    expect(keep([statut], rows, f('p-statut', 'isEmpty'))).toEqual(['r-vide', 'r-fantome']);
  });

  it('viser une option supprimée ne ressuscite pas la ligne qui la porte', () => {
    // La cellule n'affiche plus rien : le filtre doit voir la même chose
    expect(keep([statut], rows, f('p-statut', 'is', 'o-supprimee'))).toEqual([]);
    expect(keep([statut], rows, f('p-statut', 'isNot', 'o-supprimee'))).toEqual(ids(rows));
  });

  it('multi-sélection : contient / ne contient pas / vide', () => {
    const multi = [
      row('r-a', { 'p-genres': ['o-sf', 'o-doc'] }),
      row('r-b', { 'p-genres': ['o-doc'] }),
      row('r-c', { 'p-genres': [] }),
      row('r-d', {}),
      row('r-e', { 'p-genres': 'o-sf' }), // pas un tableau : lu comme vide
      row('r-f', { 'p-genres': ['o-supprimee'] }), // option disparue : lue comme vide
    ];
    expect(keep([genres], multi, f('p-genres', 'contains', 'o-sf'))).toEqual(['r-a']);
    expect(keep([genres], multi, f('p-genres', 'notContains', 'o-sf'))).toEqual([
      'r-b',
      'r-c',
      'r-d',
      'r-e',
      'r-f',
    ]);
    expect(keep([genres], multi, f('p-genres', 'isEmpty'))).toEqual(['r-c', 'r-d', 'r-e', 'r-f']);
    // Une option supprimée ne rend visible aucune ligne, même celle qui la garde
    expect(keep([genres], multi, f('p-genres', 'contains', 'o-supprimee'))).toEqual([]);
  });
});

/* ==================== Case à cocher ==================== */

describe('filtres case à cocher', () => {
  const rows = [
    row('r-oui', { 'p-coche': true }),
    row('r-non', { 'p-coche': false }),
    row('r-absent', {}),
    row('r-truthy', { 'p-coche': 'oui' }), // seul `true` vaut cochée
  ];

  it('cochée / décochée partagent toutes les lignes', () => {
    expect(keep([coche], rows, f('p-coche', 'isChecked'))).toEqual(['r-oui']);
    expect(keep([coche], rows, f('p-coche', 'isUnchecked'))).toEqual([
      'r-non',
      'r-absent',
      'r-truthy',
    ]);
  });

  it('une case n’est jamais « vide »', () => {
    expect(isEmptyCell(coche, row('r-absent', {}))).toBe(false);
  });
});

/* ==================== Dates ==================== */

describe('filtres de date', () => {
  const rows = [
    row('r-avant', { 'p-jour': '2026-01-05' }),
    row('r-pile', { 'p-jour': '2026-02-10' }),
    row('r-apres', { 'p-jour': '2026-12-31' }),
    row('r-vide', {}),
    row('r-cassee', { 'p-jour': 'pas-une-date' }),
  ];

  it('avant / après / le comparent des dates, pas des chaînes', () => {
    expect(keep([jour], rows, f('p-jour', 'before', '2026-02-10'))).toEqual(['r-avant']);
    expect(keep([jour], rows, f('p-jour', 'after', '2026-02-10'))).toEqual(['r-apres']);
    expect(keep([jour], rows, f('p-jour', 'on', '2026-02-10'))).toEqual(['r-pile']);
  });

  it('une date absente ou illisible n’est ni avant ni après', () => {
    expect(keep([jour], rows, f('p-jour', 'before', '2030-01-01'))).toEqual([
      'r-avant',
      'r-pile',
      'r-apres',
    ]);
    expect(keep([jour], rows, f('p-jour', 'isEmpty'))).toEqual(['r-vide', 'r-cassee']);
  });

  it('un mois ou un jour hors bornes est illisible, pas décalé', () => {
    expect(isEmptyCell(jour, row('r-mois', { 'p-jour': '2026-13-01' }))).toBe(true);
    expect(isEmptyCell(jour, row('r-jour', { 'p-jour': '2026-02-00' }))).toBe(true);
  });

  it('créé / modifié se filtrent depuis la LIGNE, pas depuis les cellules', () => {
    const horodatees = [
      row('r-vieux', {}, { createdAt: new Date(2026, 0, 5, 9, 30).toISOString() }),
      row('r-neuf', {}, { createdAt: new Date(2026, 5, 5, 9, 30).toISOString() }),
      row('r-sans', {}),
    ];
    expect(keep([cree], horodatees, f('p-cree', 'after', '2026-03-01'))).toEqual(['r-neuf']);
    expect(keep([cree], horodatees, f('p-cree', 'on', '2026-01-05'))).toEqual(['r-vieux']);
    expect(keep([cree], horodatees, f('p-cree', 'isEmpty'))).toEqual(['r-sans']);
  });
});

/* ==================== Lien vers une note ==================== */

describe('filtres de lien vers une note', () => {
  it('ne propose que vide / non vide', () => {
    const rows = [row('r-a', { 'p-note-ref': 'note-1' }), row('r-b', {})];
    expect(keep([lienNote], rows, f('p-note-ref', 'isNotEmpty'))).toEqual(['r-a']);
    expect(keep([lienNote], rows, f('p-note-ref', 'isEmpty'))).toEqual(['r-b']);
  });
});

/* ==================== Robustesse ==================== */

describe('robustesse du filtrage', () => {
  it('un filtre sur une propriété disparue ne masque rien', () => {
    const rows = [row('r-a', {}), row('r-b', {})];
    expect(keep([titre], rows, f('p-inconnue', 'contains', 'x'))).toEqual(['r-a', 'r-b']);
  });

  it('un opérateur d’une autre famille ne masque rien', () => {
    const rows = [row('r-a', { 'p-nb': 3 })];
    expect(keep([nombre], rows, f('p-nb', 'contains', '3'))).toEqual(['r-a']);
  });

  it('aucune valeur bizarre ne fait lever d’exception', () => {
    const bizarres = [
      row('r-1', { 'p-titre': null }),
      row('r-2', { 'p-nb': Number.NaN }),
      row('r-3', { 'p-jour': {} }),
      row('r-4', { 'p-genres': [1, 2, null] }),
      row('r-5', { 'p-statut': 12 }),
    ];
    for (const prop of ALL_PROPS) {
      for (const op of opsForType(prop.type)) {
        for (const r of bizarres) {
          expect(() => matchesFilter(prop, r, f(prop.id, op, 'x'))).not.toThrow();
        }
      }
    }
  });

  it('combine les filtres en ET (aucun OU en v1)', () => {
    const rows = [
      row('r-a', { 'p-titre': 'Dune', 'p-statut': 'o-done' }),
      row('r-b', { 'p-titre': 'Dune', 'p-statut': 'o-todo' }),
      row('r-c', { 'p-titre': 'Autre', 'p-statut': 'o-done' }),
    ];
    const kept = applyFilters(dataOf([titre, statut], rows), [
      f('p-titre', 'contains', 'dune'),
      f('p-statut', 'is', 'o-done'),
    ]);
    expect(ids(kept)).toEqual(['r-a']);
  });
});

/* ==================== Tris ==================== */

describe('tris', () => {
  it('trie les nombres, vides en dernier dans LES DEUX sens', () => {
    const rows = [
      row('r-vide', {}),
      row('r-3', { 'p-nb': 3 }),
      row('r-1', { 'p-nb': 1 }),
      row('r-2', { 'p-nb': 2 }),
    ];
    const data = dataOf([nombre], rows);
    expect(ids(applySorts(data, rows, [{ propertyId: 'p-nb', direction: 'asc' }]))).toEqual([
      'r-1',
      'r-2',
      'r-3',
      'r-vide',
    ]);
    expect(ids(applySorts(data, rows, [{ propertyId: 'p-nb', direction: 'desc' }]))).toEqual([
      'r-3',
      'r-2',
      'r-1',
      'r-vide',
    ]);
  });

  it('trie le texte sans tenir compte de la casse', () => {
    const rows = [
      row('r-b', { 'p-titre': 'banane' }),
      row('r-a', { 'p-titre': 'Abricot' }),
      row('r-c', { 'p-titre': 'cerise' }),
    ];
    expect(
      ids(applySorts(dataOf([titre], rows), rows, [{ propertyId: 'p-titre', direction: 'asc' }]))
    ).toEqual(['r-a', 'r-b', 'r-c']);
  });

  it('trie les sélections dans l’ordre du schéma, pas alphabétiquement', () => {
    const rows = [
      row('r-done', { 'p-statut': 'o-done' }),
      row('r-todo', { 'p-statut': 'o-todo' }),
      row('r-doing', { 'p-statut': 'o-doing' }),
    ];
    expect(
      ids(applySorts(dataOf([statut], rows), rows, [{ propertyId: 'p-statut', direction: 'asc' }]))
    ).toEqual(['r-todo', 'r-doing', 'r-done']);
  });

  it('trie les dates comme des dates', () => {
    const rows = [
      row('r-2', { 'p-jour': '2026-02-01' }),
      row('r-1', { 'p-jour': '2025-12-31' }),
      row('r-3', { 'p-jour': '2026-10-01' }),
    ];
    expect(
      ids(applySorts(dataOf([jour], rows), rows, [{ propertyId: 'p-jour', direction: 'asc' }]))
    ).toEqual(['r-1', 'r-2', 'r-3']);
  });

  it('trie les cases : décochées d’abord en croissant', () => {
    const rows = [
      row('r-oui', { 'p-coche': true }),
      row('r-non', { 'p-coche': false }),
      row('r-absent', {}),
    ];
    expect(
      ids(applySorts(dataOf([coche], rows), rows, [{ propertyId: 'p-coche', direction: 'asc' }]))
    ).toEqual(['r-non', 'r-absent', 'r-oui']);
  });

  it('enchaîne les niveaux dans l’ordre donné', () => {
    const rows = [
      row('r-1', { 'p-statut': 'o-todo', 'p-nb': 2 }),
      row('r-2', { 'p-statut': 'o-done', 'p-nb': 1 }),
      row('r-3', { 'p-statut': 'o-todo', 'p-nb': 1 }),
      row('r-4', { 'p-statut': 'o-done', 'p-nb': 2 }),
    ];
    const sorted = applySorts(dataOf([statut, nombre], rows), rows, [
      { propertyId: 'p-statut', direction: 'asc' },
      { propertyId: 'p-nb', direction: 'desc' },
    ]);
    expect(ids(sorted)).toEqual(['r-1', 'r-3', 'r-4', 'r-2']);
  });

  it('deux vides au 1er niveau se départagent au 2e', () => {
    const rows = [row('r-b', { 'p-titre': 'b' }), row('r-a', { 'p-titre': 'a' })];
    const sorted = applySorts(dataOf([nombre, titre], rows), rows, [
      { propertyId: 'p-nb', direction: 'asc' },
      { propertyId: 'p-titre', direction: 'asc' },
    ]);
    expect(ids(sorted)).toEqual(['r-a', 'r-b']);
  });

  it('est stable : à égalité, l’ordre d’origine tient', () => {
    const rows = Array.from({ length: 12 }, (_, i) => row(`r-${i}`, { 'p-statut': 'o-todo' }));
    const sorted = applySorts(dataOf([statut], rows), rows, [
      { propertyId: 'p-statut', direction: 'desc' },
    ]);
    expect(ids(sorted)).toEqual(ids(rows));
  });

  it('ignore un tri sur une propriété disparue', () => {
    const rows = [row('r-a', {}), row('r-b', {})];
    expect(
      ids(applySorts(dataOf([titre], rows), rows, [{ propertyId: 'p-fantome', direction: 'asc' }]))
    ).toEqual(['r-a', 'r-b']);
  });

  it('ne modifie jamais le tableau reçu', () => {
    const rows = [row('r-2', { 'p-nb': 2 }), row('r-1', { 'p-nb': 1 })];
    applySorts(dataOf([nombre], rows), rows, [{ propertyId: 'p-nb', direction: 'asc' }]);
    expect(ids(rows)).toEqual(['r-2', 'r-1']);
  });

  it('ne lit chaque cellule qu’UNE fois par niveau, pas à chaque comparaison', () => {
    // Décoration : les clés sont calculées une fois, puis comparées. Les bâtir
    // dans le comparateur en referait deux par comparaison — soit O(n log n)
    // reparsages de date au lieu de O(n).
    const reads = { jour: 0, nb: 0 };
    const rows = Array.from({ length: 64 }, (_, i) => {
      const cells: Record<string, unknown> = {};
      Object.defineProperty(cells, 'p-jour', {
        enumerable: true,
        get: () => {
          reads.jour += 1;
          return `2026-01-${String((i % 28) + 1).padStart(2, '0')}`;
        },
      });
      Object.defineProperty(cells, 'p-nb', {
        enumerable: true,
        get: () => {
          reads.nb += 1;
          return 64 - i;
        },
      });
      return row(`r-${i}`, cells);
    });
    const sorted = applySorts(dataOf([jour, nombre], rows), rows, [
      { propertyId: 'p-jour', direction: 'asc' },
      { propertyId: 'p-nb', direction: 'asc' },
    ]);
    expect(reads.jour).toBe(64);
    expect(reads.nb).toBe(64);
    // Et le tri reste juste : même jour → départagé par le nombre croissant
    expect(sorted[0].id).toBe('r-56');
    expect(sorted[1].id).toBe('r-28');
    expect(sorted[2].id).toBe('r-0');
  });
});

/* ==================== applyView ==================== */

describe('applyView', () => {
  it('filtre PUIS trie', () => {
    const rows = [
      row('r-a', { 'p-titre': 'Dune', 'p-nb': 3 }),
      row('r-b', { 'p-titre': 'Autre', 'p-nb': 1 }),
      row('r-c', { 'p-titre': 'Dune 2', 'p-nb': 1 }),
    ];
    const data = dataOf([titre, nombre], rows);
    const v = view([f('p-titre', 'contains', 'dune')], [{ propertyId: 'p-nb', direction: 'asc' }]);
    expect(ids(applyView(data, v))).toEqual(['r-c', 'r-a']);
  });

  it('ne supprime jamais une ligne : la source reste entière', () => {
    const rows = [row('r-a', { 'p-titre': 'x' }), row('r-b', {})];
    const data = dataOf([titre], rows);
    expect(ids(applyView(data, view([f('p-titre', 'isNotEmpty')])))).toEqual(['r-a']);
    expect(data.rows).toHaveLength(2);
  });

  it('une vue sans filtre ni tri rend les lignes telles quelles', () => {
    const rows = [row('r-b', {}), row('r-a', {})];
    const data = dataOf([titre], rows);
    expect(applyView(data, view())).toBe(data.rows);
  });

  it('compte les filtres pour le badge de la barre', () => {
    expect(countFilters(view([f('p-titre', 'isEmpty'), f('p-nb', 'gt', 1)]))).toBe(2);
  });
});

/* ==================== MIGRATION (bases d'avant les vues) ==================== */

describe('migration des bases sans vues', () => {
  const legacyRows = [row('r-a', { 'p-titre': 'A' }), row('r-b', { 'p-titre': 'B' })];

  it('fabrique une vue par défaut depuis les attrs du nœud', () => {
    const migrated = ensureViews(dataOf([titre, statut], legacyRows), {
      view: 'board',
      groupBy: 'p-statut',
    });
    expect(migrated.views).toHaveLength(1);
    const [v] = migrated.views ?? [];
    expect(v.type).toBe('board');
    expect(v.groupBy).toBe('p-statut');
    expect(v.filters).toEqual([]);
    expect(v.sorts).toEqual([]);
    expect(v.name).toBeTruthy();
    expect(migrated.activeViewId).toBe(v.id);
  });

  it('ne touche NI aux propriétés NI aux lignes', () => {
    const source = dataOf([titre, statut], legacyRows);
    const migrated = ensureViews(source, { view: 'table', groupBy: '' });
    expect(migrated.properties).toEqual(source.properties);
    expect(migrated.rows).toEqual(source.rows);
    expect(migrated.rows).toHaveLength(2);
  });

  it('retombe sur table quand l’attr de vue est absent ou inconnu', () => {
    expect(ensureViews(dataOf([titre], []), {}).views?.[0].type).toBe('table');
    expect(ensureViews(dataOf([titre], []), { view: 'galerie' }).views?.[0].type).toBe('table');
  });

  it('laisse tomber un groupBy vide ou qui ne pointe pas une sélection', () => {
    expect(
      ensureViews(dataOf([titre], []), { view: 'board', groupBy: '' }).views?.[0].groupBy
    ).toBeUndefined();
    expect(
      ensureViews(dataOf([titre], []), { view: 'board', groupBy: 'p-titre' }).views?.[0].groupBy
    ).toBeUndefined();
    expect(
      ensureViews(dataOf([titre], []), { view: 'board', groupBy: 'p-disparue' }).views?.[0].groupBy
    ).toBeUndefined();
  });

  it('est idempotente : deux passages ne créent pas deux vues', () => {
    const once = ensureViews(dataOf([titre, statut], legacyRows), {
      view: 'board',
      groupBy: 'p-statut',
    });
    const twice = ensureViews(once, { view: 'table', groupBy: '' });
    expect(twice.views).toHaveLength(1);
    // Les attrs hérités ne réécrivent PAS une vue déjà enregistrée
    expect(twice.views?.[0]).toEqual(once.views?.[0]);
    expect(twice.activeViewId).toBe(once.activeViewId);
  });

  it('reconstruit une vue quand le tableau enregistré est vide', () => {
    const migrated = ensureViews({ ...dataOf([titre], legacyRows), views: [] }, { view: 'board' });
    expect(migrated.views).toHaveLength(1);
    expect(migrated.views?.[0].type).toBe('board');
  });

  it('survit à un aller-retour JSON complet (attrs hérités → vues → relecture)', () => {
    const legacyJson = JSON.stringify({ properties: [titre, statut], rows: legacyRows });
    const migrated = ensureViews(parseDbData(legacyJson), { view: 'board', groupBy: 'p-statut' });
    const reread = parseDbData(serializeDbData(migrated));
    expect(reread.views).toEqual(migrated.views);
    expect(reread.activeViewId).toBe(migrated.activeViewId);
    expect(reread.rows).toEqual(legacyRows);
  });

  it('réécrit les attrs hérités en miroir de la vue active (client antérieur)', () => {
    const kanban: DbView = {
      id: 'v-k',
      name: 'Kanban',
      type: 'board',
      filters: [],
      sorts: [],
      groupBy: 'p-statut',
    };
    const table: DbView = { id: 'v-t', name: 'Table', type: 'table', filters: [], sorts: [] };
    const data: InlineDbData = {
      ...dataOf([titre, statut], legacyRows),
      views: [table, kanban],
      activeViewId: 'v-k',
    };
    expect(legacyAttrsFor(data)).toEqual({ view: 'board', groupBy: 'p-statut' });
    expect(legacyAttrsFor({ ...data, activeViewId: 'v-t' })).toEqual({
      view: 'table',
      groupBy: '',
    });
  });

  it('remet l’id actif en place s’il ne désigne aucune vue', () => {
    const v: DbView = { id: 'v-2', name: 'X', type: 'table', filters: [], sorts: [] };
    const fixed = ensureViews({ ...dataOf([titre], []), views: [v], activeViewId: 'v-perdue' }, {});
    expect(fixed.activeViewId).toBe('v-2');
  });
});

/* ==================== Parse tolérant des vues ==================== */

describe('parse des vues', () => {
  it('conserve filtres, tris et groupBy au round-trip', () => {
    const v: DbView = {
      id: 'v-1',
      name: 'Vue',
      type: 'board',
      filters: [f('p-titre', 'contains', 'dune')],
      sorts: [{ propertyId: 'p-nb', direction: 'desc' }],
      groupBy: 'p-statut',
    };
    const data: InlineDbData = {
      ...dataOf([titre, nombre, statut], []),
      views: [v],
      activeViewId: 'v-1',
    };
    expect(parseDbData(serializeDbData(data)).views).toEqual([v]);
  });

  it('jette une vue sans identifiant et un filtre à opérateur inconnu', () => {
    const json = JSON.stringify({
      properties: [titre],
      rows: [],
      views: [
        { name: 'sans id', type: 'table' },
        {
          id: 'v-ok',
          name: 'ok',
          type: 'table',
          filters: [
            { id: 'f-1', propertyId: 'p-titre', op: 'contains', value: 'x' },
            { id: 'f-2', propertyId: 'p-titre', op: 'ressemble-a' },
            { propertyId: 'p-titre', op: 'contains' },
          ],
          sorts: [
            { propertyId: 'p-titre', direction: 'asc' },
            { propertyId: 'p-titre', direction: 'aleatoire' },
          ],
        },
      ],
    });
    const parsed = parseDbData(json);
    expect(parsed.views).toHaveLength(1);
    expect(parsed.views?.[0].filters).toEqual([
      { id: 'f-1', propertyId: 'p-titre', op: 'contains', value: 'x' },
    ]);
    expect(parsed.views?.[0].sorts).toEqual([{ propertyId: 'p-titre', direction: 'asc' }]);
  });

  it('un champ views qui n’est pas un tableau vaut absence', () => {
    const json = JSON.stringify({ properties: [], rows: [], views: 'oui' });
    expect(parseDbData(json).views).toBeUndefined();
  });
});

/* ==================== Cohérence quand le schéma bouge ==================== */

describe('cohérence des vues', () => {
  const twoViews: DbView[] = [
    {
      id: 'v-1',
      name: 'Une',
      type: 'table',
      filters: [f('p-titre', 'contains', 'x'), f('p-statut', 'is', 'o-todo')],
      sorts: [{ propertyId: 'p-titre', direction: 'asc' }],
    },
    {
      id: 'v-2',
      name: 'Deux',
      type: 'board',
      filters: [f('p-statut', 'is', 'o-done')],
      sorts: [{ propertyId: 'p-statut', direction: 'desc' }],
      groupBy: 'p-statut',
    },
  ];

  it('supprimer une propriété retire ses filtres et ses tris de TOUTES les vues', () => {
    const sane = sanitizeViews({
      ...dataOf([statut], []),
      views: twoViews,
      activeViewId: 'v-1',
    });
    expect(sane.views?.[0].filters.map((x) => x.propertyId)).toEqual(['p-statut']);
    expect(sane.views?.[0].sorts).toEqual([]);
    expect(sane.views?.[1].filters).toHaveLength(1);
  });

  it('supprimer une option nettoie les filtres qui la visent, partout', () => {
    const ampute: DbProperty = {
      ...statut,
      options: (statut.options ?? []).filter((o) => o.id !== 'o-todo'),
    };
    const sane = sanitizeViews({
      ...dataOf([titre, ampute], []),
      views: twoViews,
      activeViewId: 'v-1',
    });
    expect(sane.views?.[0].filters.map((x) => x.op)).toEqual(['contains']);
    // L'autre vue vise une option encore vivante : elle garde son filtre
    expect(sane.views?.[1].filters).toHaveLength(1);
  });

  it('changer le type d’une propriété emporte les filtres devenus absurdes', () => {
    const devenuNombre: DbProperty = { id: 'p-titre', name: 'Titre', type: 'number' };
    const sane = sanitizeViews({
      ...dataOf([devenuNombre, statut], []),
      views: twoViews,
      activeViewId: 'v-1',
    });
    expect(sane.views?.[0].filters.map((x) => x.propertyId)).toEqual(['p-statut']);
    // Le tri, lui, reste valable quel que soit le type
    expect(sane.views?.[0].sorts).toEqual([{ propertyId: 'p-titre', direction: 'asc' }]);
  });

  it('un groupBy qui ne désigne plus une sélection tombe', () => {
    const sane = sanitizeViews({
      ...dataOf([titre], []),
      views: twoViews,
      activeViewId: 'v-2',
    });
    expect(sane.views?.[1].groupBy).toBeUndefined();
  });

  it('ne garde qu’un tri par propriété', () => {
    const sane = sanitizeViews({
      ...dataOf([titre], []),
      views: [
        {
          id: 'v-1',
          name: 'x',
          type: 'table',
          filters: [],
          sorts: [
            { propertyId: 'p-titre', direction: 'asc' },
            { propertyId: 'p-titre', direction: 'desc' },
          ],
        },
      ],
    });
    expect(sane.views?.[0].sorts).toEqual([{ propertyId: 'p-titre', direction: 'asc' }]);
  });

  it('ne touche jamais aux lignes', () => {
    const rows = [row('r-a', { 'p-titre': 'x' })];
    const sane = sanitizeViews({ ...dataOf([], rows), views: twoViews });
    expect(sane.rows).toEqual(rows);
    expect(sane.properties).toEqual([]);
  });
});

/* ==================== Nouvelle ligne dans une vue filtrée ==================== */

describe('pré-remplissage d’une nouvelle ligne', () => {
  const props = [titre, nombre, note5, avancement, statut, genres, coche, jour, cree];

  function visibleAfterAdd(v: DbView, cells: Record<string, unknown>): boolean {
    const created = row('r-neuve', cells);
    return ids(applyView(dataOf(props, [created]), v)).includes('r-neuve');
  }

  it('remplit ce qui rend la ligne visible, pour chaque famille', () => {
    const v = view([
      f('p-titre', 'contains', 'Dune'),
      f('p-nb', 'gte', 10),
      f('p-statut', 'is', 'o-done'),
      f('p-genres', 'contains', 'o-sf'),
      f('p-coche', 'isChecked'),
      f('p-jour', 'on', '2026-02-10'),
    ]);
    const cells = prefillCellsForView(v, props);
    expect(cells).toEqual({
      'p-titre': 'Dune',
      'p-nb': 10,
      'p-statut': 'o-done',
      'p-genres': ['o-sf'],
      'p-coche': true,
      'p-jour': '2026-02-10',
    });
    expect(visibleAfterAdd(v, cells)).toBe(true);
  });

  it('décale d’un jour pour « avant » et « après »', () => {
    const v = view([f('p-jour', 'after', '2026-02-10')]);
    expect(prefillCellsForView(v, props)['p-jour']).toBe('2026-02-11');
    expect(visibleAfterAdd(v, prefillCellsForView(v, props))).toBe(true);
    const w = view([f('p-jour', 'before', '2026-03-01')]);
    expect(prefillCellsForView(w, props)['p-jour']).toBe('2026-02-28');
    expect(visibleAfterAdd(w, prefillCellsForView(w, props))).toBe(true);
  });

  it('choisit une valeur strictement de part et d’autre pour > et <', () => {
    expect(prefillCellsForView(view([f('p-nb', 'gt', 4)]), props)['p-nb']).toBe(5);
    expect(prefillCellsForView(view([f('p-nb', 'lt', 4)]), props)['p-nb']).toBe(3);
  });

  it('borne l’évaluation et la progression', () => {
    expect(prefillCellsForView(view([f('p-note', 'gte', 9)]), props)['p-note']).toBe(5);
    expect(prefillCellsForView(view([f('p-prog', 'gte', 300)]), props)['p-prog']).toBe(100);
  });

  it('efface la cellule pour « vide » et « décochée » (undefined = effacer)', () => {
    const cells = prefillCellsForView(
      view([f('p-titre', 'isEmpty'), f('p-coche', 'isUnchecked')]),
      props
    );
    expect(cells).toHaveProperty('p-titre');
    expect(cells['p-titre']).toBeUndefined();
    expect(cells['p-coche']).toBeUndefined();
  });

  it('ne remplit rien pour les opérateurs déjà satisfaits par une cellule vide', () => {
    // Sans défaut de schéma, une cellule vide satisfait déjà la négation : rien
    // à écrire. Le cas AVEC défaut est traité juste en dessous.
    expect(prefillCellsForView(view([f('p-titre', 'notContains', 'x')]), props)).toEqual({});
    expect(prefillCellsForView(view([f('p-nb', 'neq', 3)]), props)).toEqual({});
    expect(prefillCellsForView(view([f('p-statut', 'isNot', 'o-todo')]), props)).toEqual({});
    expect(prefillCellsForView(view([f('p-genres', 'notContains', 'o-sf')]), props)).toEqual({});
  });

  it('n’invente pas de contenu pour « non vide »', () => {
    expect(prefillCellsForView(view([f('p-titre', 'isNotEmpty')]), props)).toEqual({});
  });

  it('n’écrit jamais dans une colonne créé/modifié (posée par l’app)', () => {
    expect(prefillCellsForView(view([f('p-cree', 'on', '2026-02-10')]), props)).toEqual({});
  });

  it('ignore une option supprimée et une propriété disparue', () => {
    expect(prefillCellsForView(view([f('p-statut', 'is', 'o-morte')]), props)).toEqual({});
    expect(prefillCellsForView(view([f('p-fantome', 'contains', 'x')]), props)).toEqual({});
  });
});

/* ==================== Filtre négatif vs défaut du schéma ==================== */

describe('nouvelle ligne dans une vue qui exclut le défaut du schéma', () => {
  // « Statut ≠ À faire », où « À faire » est justement l'option posée d'office
  // sur toute nouvelle ligne : sans correction, la ligne naît masquée.
  const statutDefautTodo: DbProperty = { ...statut, defaultOptionId: 'o-todo' };
  const statutDefautDoing: DbProperty = { ...statut, defaultOptionId: 'o-doing' };
  const genresDefautSf: DbProperty = { ...genres, defaultOptionId: 'o-sf' };

  /** Le chemin RÉEL : défauts du schéma, puis pré-remplissage de la vue. */
  function visibleAfterAdd(properties: DbProperty[], v: DbView): boolean {
    const created = newRow(properties, prefillCellsForView(v, properties));
    return ids(applyView(dataOf(properties, [created]), v)).includes(created.id);
  }

  it('efface la sélection quand « n’est pas » vise le défaut', () => {
    const p = [statutDefautTodo];
    const v = view([f('p-statut', 'isNot', 'o-todo')]);
    const cells = prefillCellsForView(v, p);
    expect('p-statut' in cells).toBe(true);
    expect(cells['p-statut']).toBeUndefined();
    expect(newRow(p, cells).cells).not.toHaveProperty('p-statut');
    expect(visibleAfterAdd(p, v)).toBe(true);
  });

  it('efface la multi-sélection quand « ne contient pas » vise le défaut', () => {
    const p = [genresDefautSf];
    const v = view([f('p-genres', 'notContains', 'o-sf')]);
    expect(prefillCellsForView(v, p)['p-genres']).toBeUndefined();
    expect(visibleAfterAdd(p, v)).toBe(true);
  });

  it('laisse le défaut tranquille quand il n’est pas celui qu’on exclut', () => {
    const p = [statutDefautDoing];
    const v = view([f('p-statut', 'isNot', 'o-todo')]);
    expect(prefillCellsForView(v, p)).toEqual({});
    // La ligne naît « En cours » : elle passe le filtre sans qu'on touche à rien
    expect(visibleAfterAdd(p, v)).toBe(true);
  });

  it('n’efface pas un choix qu’un autre filtre de la vue a déjà posé', () => {
    const p = [statutDefautTodo];
    for (const filters of [
      [f('p-statut', 'is', 'o-done'), f('p-statut', 'isNot', 'o-todo')],
      [f('p-statut', 'isNot', 'o-todo'), f('p-statut', 'is', 'o-done')],
    ]) {
      const v = view(filters);
      expect(prefillCellsForView(v, p)['p-statut']).toBe('o-done');
      expect(visibleAfterAdd(p, v)).toBe(true);
    }
  });

  it('ne réveille pas un défaut qui pointe une option supprimée', () => {
    // `defaultCells` ne pose rien : il n'y a donc rien à effacer non plus
    const ampute: DbProperty = { ...statut, defaultOptionId: 'o-morte' };
    expect(prefillCellsForView(view([f('p-statut', 'isNot', 'o-morte')]), [ampute])).toEqual({});
  });

  it('deux exclusions à la suite ne se marchent pas dessus', () => {
    const p = [statutDefautTodo];
    const v = view([f('p-statut', 'isNot', 'o-doing'), f('p-statut', 'isNot', 'o-todo')]);
    expect(prefillCellsForView(v, p)['p-statut']).toBeUndefined();
    expect(visibleAfterAdd(p, v)).toBe(true);
  });
});

/* ==================== Onglet regardé (préférence locale) ==================== */

/**
 * Changer d'onglet est une NAVIGATION : le choix vit sur l'appareil, pas dans le
 * document (sinon Ctrl+Z défait un changement d'onglet, la note est marquée
 * modifiée et remonte au nuage pour une simple consultation). Ce qui se teste
 * ici est le contrat que le NodeView pose dessus : quelle vue s'affiche, et
 * quelle identité locale porte la préférence.
 */
describe('onglet regardé', () => {
  const vA: DbView = { id: 'v-a', name: 'A', type: 'table', filters: [], sorts: [] };
  const vB: DbView = { id: 'v-b', name: 'B', type: 'board', filters: [], sorts: [] };
  const base: InlineDbData = { ...dataOf([titre], []), views: [vA, vB], activeViewId: 'v-a' };

  it('le choix local prime sur celui enregistré dans le document', () => {
    expect(resolveActiveView(base, 'v-b').id).toBe('v-b');
    expect(resolveActiveView(base, null).id).toBe('v-a');
    expect(resolveActiveView(base, undefined).id).toBe('v-a');
  });

  it('un choix local qui ne désigne plus rien retombe sur le document', () => {
    // Vue supprimée depuis un autre appareil : l'affichage ne doit pas se figer
    expect(resolveActiveView(base, 'v-disparue').id).toBe('v-a');
    expect(resolveActiveView({ ...base, activeViewId: 'v-perdue' }, 'v-morte').id).toBe('v-a');
  });

  it('rend toujours une vue, même sans aucune enregistrée', () => {
    expect(resolveActiveView(dataOf([titre], []), 'v-a').type).toBe('table');
  });

  it('l’identité locale sort des ids de vues, jamais d’un attr à écrire', () => {
    // Écrire un identifiant de bloc dans le document serait l'écriture même
    // qu'on cherche à supprimer : la clé se dérive donc de la première vue.
    expect(viewPrefKey([vA, vB])).toBe(viewPrefKey([vA]));
    expect(viewPrefKey([vB])).not.toBe(viewPrefKey([vA]));
    expect(viewPrefKey([])).toBe('');
    expect(viewPrefKey(undefined)).toBe('');
  });

  describe('mémoire locale', () => {
    afterEach(() => {
      delete (globalThis as Record<string, unknown>).localStorage;
    });

    function stubLocalStorage(): Map<string, string> {
      const store = new Map<string, string>();
      (globalThis as Record<string, unknown>).localStorage = {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
      };
      return store;
    }

    it('retient l’onglet d’une session à l’autre, par bloc', () => {
      stubLocalStorage();
      const keyA = viewPrefKey([vA, vB]);
      const keyB = viewPrefKey([vB]);
      writeActiveViewPref(keyA, 'v-b');
      expect(readActiveViewPref(keyA)).toBe('v-b');
      // Un autre bloc garde son propre onglet
      expect(readActiveViewPref(keyB)).toBeNull();
      expect(resolveActiveView(base, readActiveViewPref(keyA)).id).toBe('v-b');
    });

    it('n’écrit ni ne lit rien sans identité de bloc', () => {
      const store = stubLocalStorage();
      writeActiveViewPref('', 'v-b');
      expect(store.size).toBe(0);
      expect(readActiveViewPref('')).toBeNull();
    });

    it('survit à un stockage local indisponible (web durci, mode privé)', () => {
      // Aucun localStorage global ici : lire rend null, écrire ne lève pas
      expect(readActiveViewPref('filarr-inline-db-view:v-a')).toBeNull();
      expect(() => writeActiveViewPref('filarr-inline-db-view:v-a', 'v-b')).not.toThrow();
    });
  });
});
