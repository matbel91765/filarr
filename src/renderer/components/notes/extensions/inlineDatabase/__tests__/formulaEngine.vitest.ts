/**
 * Moteur de formules.
 *
 * Deux exigences valent tout le reste :
 *  - une formule ne rend JAMAIS un zéro silencieux. Référence inconnue,
 *    division par zéro, cycle : le motif s'affiche, parce qu'un zéro se lit
 *    comme une donnée et qu'on décide dessus ;
 *  - l'évaluation ne peut pas boucler. Deux formules qui se citent rendent une
 *    erreur de cycle, elles ne figent pas l'application.
 */

import { describe, it, expect } from 'vitest';
import { checkFormula, evaluateFormula, formatFormulaValue, parseFormula } from '../formulaEngine';
import type { DbProperty, DbRow } from '../types';

const props: DbProperty[] = [
  { id: 'p-qte', name: 'Quantité', type: 'number' },
  { id: 'p-prix', name: 'Prix', type: 'number' },
  { id: 'p-nom', name: 'Nom', type: 'text' },
  { id: 'p-fait', name: 'Fait', type: 'checkbox' },
  { id: 'p-due', name: 'Échéance', type: 'date' },
  {
    id: 'p-statut',
    name: 'Statut',
    type: 'select',
    options: [
      { id: 'o-1', label: 'En cours', color: 'blue' },
      { id: 'o-2', label: 'Terminé', color: 'green' },
    ],
  },
  { id: 'p-total', name: 'Total', type: 'formula', formula: 'prop("Quantité") * prop("Prix")' },
];

const row: DbRow = {
  id: 'r1',
  cells: {
    'p-qte': 3,
    'p-prix': 12.5,
    'p-nom': 'Vis',
    'p-fait': true,
    'p-due': '2026-03-10',
    'p-statut': 'o-1',
  },
};

const run = (formula: string, over: DbProperty[] = props, target: DbRow = row) =>
  evaluateFormula(formula, { properties: over, row: target, now: new Date(2026, 2, 5) });

describe('arithmétique et références', () => {
  it('multiplie deux colonnes', () => {
    expect(run('prop("Quantité") * prop("Prix")')).toEqual({ ok: true, value: 37.5 });
  });

  it('accepte un nom de colonne sans guillemets quand il est simple', () => {
    expect(run('Prix + 1')).toEqual({ ok: true, value: 13.5 });
  });

  it('respecte les priorités et les parenthèses', () => {
    expect(run('2 + 3 * 4')).toEqual({ ok: true, value: 14 });
    expect(run('(2 + 3) * 4')).toEqual({ ok: true, value: 20 });
    expect(run('-Prix + 1')).toEqual({ ok: true, value: -11.5 });
  });

  it('lit une colonne de choix par son LIBELLÉ, pas par son identifiant', () => {
    expect(run('prop("Statut")')).toEqual({ ok: true, value: 'En cours' });
    expect(run('prop("Statut") == "En cours"')).toEqual({ ok: true, value: true });
  });
});

describe('erreurs — jamais un zéro muet', () => {
  it('dit quand une colonne n existe pas', () => {
    const result = run('prop("Marge")');
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error.message).toContain('Marge');
  });

  it('refuse la division par zéro', () => {
    const result = run('1 / 0');
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error.message).toContain('zero');
  });

  it('dit quand une fonction est inconnue', () => {
    const result = run('sommeDeTout(1)');
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error.message).toContain('Unknown function');
  });

  it('signale une parenthèse manquante à l analyse', () => {
    expect('node' in parseFormula('round(1')).toBe(false);
    expect('node' in parseFormula('1 +')).toBe(false);
  });

  it('signale une chaîne non fermée', () => {
    expect('node' in parseFormula('concat("a)')).toBe(false);
  });

  it('n explose pas sur une formule vide', () => {
    expect(run('')).toEqual({ ok: true, value: null });
    expect(run('   ')).toEqual({ ok: true, value: null });
  });
});

describe('cycles', () => {
  it('deux formules qui se citent rendent une ERREUR, pas une boucle', () => {
    const cyclic: DbProperty[] = [
      { id: 'a', name: 'A', type: 'formula', formula: 'prop("B") + 1' },
      { id: 'b', name: 'B', type: 'formula', formula: 'prop("A") + 1' },
    ];
    const result = evaluateFormula('prop("A")', {
      properties: cyclic,
      row: { id: 'r', cells: {} },
    });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error.message).toContain('Circular');
  });

  it('une formule peut en citer une autre, sans cycle', () => {
    // « Total » est lui-même une formule : la chaîne doit se dérouler.
    expect(run('prop("Total") + 0')).toEqual({ ok: true, value: 37.5 });
  });
});

describe('fonctions', () => {
  it('if() n évalue QUE la branche retenue', () => {
    // Sinon `if(Total == 0, "—", 10 / Total)` remonterait la division par zéro
    // de la branche qu'on n'a pas prise — c'est le cas d'usage même de if().
    expect(run('if(Prix == 0, "—", 10 / Prix)')).toEqual({ ok: true, value: 0.8 });
    expect(run('if(1 == 1, "oui", 1 / 0)')).toEqual({ ok: true, value: 'oui' });
  });

  it('arrondit avec le nombre de décimales demandé', () => {
    expect(run('round(1.2345, 2)')).toEqual({ ok: true, value: 1.23 });
    expect(run('round(1.6)')).toEqual({ ok: true, value: 2 });
    expect(run('floor(1.9)')).toEqual({ ok: true, value: 1 });
    expect(run('ceil(1.1)')).toEqual({ ok: true, value: 2 });
    expect(run('abs(0 - 4)')).toEqual({ ok: true, value: 4 });
  });

  it('assemble du texte', () => {
    expect(run('concat(Nom, " × ", Quantité)')).toEqual({ ok: true, value: 'Vis × 3' });
    expect(run('Nom + " !"')).toEqual({ ok: true, value: 'Vis !' });
    expect(run('upper(Nom)')).toEqual({ ok: true, value: 'VIS' });
    expect(run('length(Nom)')).toEqual({ ok: true, value: 3 });
    expect(run('contains(Nom, "Vi")')).toEqual({ ok: true, value: true });
  });

  it('compte les jours entre deux dates', () => {
    expect(run('dateDiff(prop("Échéance"), today())')).toEqual({ ok: true, value: 5 });
  });

  it('logique booléenne', () => {
    expect(run('Fait && Prix > 10')).toEqual({ ok: true, value: true });
    expect(run('not(Fait)')).toEqual({ ok: true, value: false });
    expect(run('min(3, 9, 1)')).toEqual({ ok: true, value: 1 });
    expect(run('max(3, 9, 1)')).toEqual({ ok: true, value: 9 });
  });

  it('une cellule vide vaut « rien », pas zéro', () => {
    const empty: DbRow = { id: 'r2', cells: {} };
    expect(run('isEmpty(prop("Prix"))', props, empty)).toEqual({ ok: true, value: true });
    // Une somme sur du vide n'est pas un nombre : on le dit.
    expect(run('prop("Prix") + 1', props, empty).ok).toBe(false);
  });
});

describe('checkFormula — vérification à la saisie', () => {
  it('accepte une formule correcte', () => {
    expect(checkFormula('prop("Prix") * 2', props)).toBeNull();
    expect(checkFormula('', props)).toBeNull();
  });

  it('nomme la colonne inconnue AVANT d évaluer la moindre ligne', () => {
    const problem = checkFormula('prop("Marge") + prop("Taxe")', props);
    expect(problem?.message).toContain('Marge');
    expect(problem?.message).toContain('Taxe');
  });

  it('signale une syntaxe invalide', () => {
    expect(checkFormula('round(', props)).not.toBeNull();
  });
});

describe('affichage', () => {
  it('met en forme selon la langue, et rend le motif d erreur tel quel', () => {
    expect(formatFormulaValue({ ok: true, value: 1234.5 }, 'en')).toBe('1,234.5');
    expect(formatFormulaValue({ ok: true, value: true }, 'en')).toBe('✓');
    expect(formatFormulaValue({ ok: true, value: null }, 'en')).toBe('');
    expect(formatFormulaValue({ ok: false, error: { message: 'Boom' } }, 'en')).toBe('Boom');
  });
});
