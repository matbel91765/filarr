/**
 * Grille du calendrier.
 *
 * Le piège de cette vue est simple à énoncer et facile à commettre : une ligne
 * sans date qu'on ne range nulle part DISPARAÎT. La moitié d'une base peut
 * s'évaporer d'un affichage sans que rien ne le signale.
 */

import { describe, it, expect } from 'vitest';
import {
  buildCalendarMonth,
  cellDate,
  firstDateProperty,
  isoOf,
  shiftMonth,
  weekdayLabels,
} from '../calendarLayout';
import type { DbProperty, DbRow } from '../types';

const rows: DbRow[] = [
  { id: 'a', cells: { d: '2026-03-05' } },
  { id: 'b', cells: { d: '2026-03-05T14:00' } },
  { id: 'c', cells: { d: '2026-02-28' } },
  { id: 'd', cells: {} },
  { id: 'e', cells: { d: 'bientôt' } },
];

const march = () => buildCalendarMonth(rows, 'd', 2026, 2);

describe('buildCalendarMonth', () => {
  it('fait TOUJOURS six semaines de sept jours', () => {
    // Hauteur stable : un mois de cinq semaines ferait sauter le bloc et
    // danser le contenu de la note à chaque changement de mois.
    const month = march();
    expect(month.weeks).toHaveLength(6);
    for (const week of month.weeks) expect(week).toHaveLength(7);
  });

  it('range les lignes au bon jour, heure comprise', () => {
    const month = march();
    const day = month.weeks.flat().find((cell) => cell.iso === '2026-03-05')!;
    expect(day.rows.map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('N AVALE PAS les lignes sans date exploitable', () => {
    const month = march();
    expect(month.undated.map((r) => r.id)).toEqual(['d', 'e']);
  });

  it('montre les jours des mois voisins, marqués comme tels', () => {
    const month = march();
    const feb = month.weeks.flat().find((cell) => cell.iso === '2026-02-28');
    expect(feb?.inMonth).toBe(false);
    expect(feb?.rows.map((r) => r.id)).toEqual(['c']);
    expect(month.weeks.flat().find((c) => c.iso === '2026-03-05')?.inMonth).toBe(true);
  });

  it('commence la semaine le lundi par défaut', () => {
    const month = march();
    // 1er mars 2026 est un dimanche : la grille démarre donc le lundi 23/02.
    expect(month.weeks[0][0].iso).toBe('2026-02-23');
  });

  it('sans colonne de date, TOUT est « sans date » — rien n est perdu', () => {
    const month = buildCalendarMonth(rows, '', 2026, 2);
    expect(month.undated).toHaveLength(rows.length);
  });
});

describe('utilitaires', () => {
  it('isoOf ne passe pas par UTC (qui décalerait d un jour)', () => {
    expect(isoOf(2026, 0, 1)).toBe('2026-01-01');
    expect(isoOf(2026, 11, 31)).toBe('2026-12-31');
  });

  it('cellDate ne garde que la partie date', () => {
    expect(cellDate('2026-03-05T14:00')).toBe('2026-03-05');
    expect(cellDate('demain')).toBeNull();
    expect(cellDate(42)).toBeNull();
  });

  it('shiftMonth ne fabrique jamais un mois 12', () => {
    expect(shiftMonth(2026, 11, 1)).toEqual({ year: 2027, month: 0 });
    expect(shiftMonth(2026, 0, -1)).toEqual({ year: 2025, month: 11 });
    expect(shiftMonth(2026, 5, -12)).toEqual({ year: 2025, month: 5 });
  });

  it('firstDateProperty ne prend qu une vraie colonne de date', () => {
    const props = [
      { id: 't', name: 't', type: 'text' },
      { id: 'd', name: 'd', type: 'date' },
    ] as DbProperty[];
    expect(firstDateProperty(props)?.id).toBe('d');
    expect(firstDateProperty([props[0]])).toBeNull();
  });

  it('les jours de semaine suivent la langue et l ordre de la grille', () => {
    const labels = weekdayLabels('fr-FR');
    expect(labels).toHaveLength(7);
    expect(labels[0].toLowerCase()).toContain('lun');
    expect(weekdayLabels('fr-FR', 0)[0].toLowerCase()).toContain('dim');
  });
});
