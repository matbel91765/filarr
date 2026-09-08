/**
 * Grammaire des cellules date et nombre des bases inline.
 *
 * Ce que ces suites protègent, et qu'aucun typage ne rattrape : la date se lit
 * et s'écrit dans la LANGUE DE L'APP (le 08/09 n'est pas le même jour en
 * français et en anglais), la grille du mois tient ses bords (années
 * bissextiles, passage décembre → janvier, semaines commençant lundi ou
 * dimanche), et une valeur effacée reste vide — jamais un « 1970 » surgi d'une
 * analyse trop généreuse.
 */

import { describe, it, expect } from 'vitest';
import {
  daysInMonth,
  formatDecimal,
  formatDecimalPlain,
  formatDisplayDate,
  formatTypedDate,
  isValidIso,
  monthGrid,
  parseDecimal,
  parseLocalDate,
  resolveDateCommit,
  resolveLocale,
  shiftIsoDays,
  shiftMonth,
  toIso,
  todayIso,
  weekStartFor,
  weekdayLabels,
} from '../cellFormats';

const FR = 'fr-FR';
const EN = 'en-US';
/** Mois affiché par le popover pendant les tests : août 2026 */
const CTX = { year: 2026, month: 7 };

describe('parseLocalDate — la langue décide de l’ordre des champs', () => {
  it('lit le même texte comme deux jours différents selon la langue', () => {
    expect(parseLocalDate('08/09/2026', FR, CTX)).toBe('2026-09-08');
    expect(parseLocalDate('08/09/2026', EN, CTX)).toBe('2026-08-09');
  });

  it('accepte l’ISO quelle que soit la langue (c’est le format de stockage)', () => {
    expect(parseLocalDate('2026-08-15', FR, CTX)).toBe('2026-08-15');
    expect(parseLocalDate('2026-08-15', EN, CTX)).toBe('2026-08-15');
    // Année en tête même mal séparée : personne n'écrit le jour en premier ici
    expect(parseLocalDate('2026/8/15', FR, CTX)).toBe('2026-08-15');
  });

  it('accepte les séparateurs courants et les nombres à un chiffre', () => {
    expect(parseLocalDate('5.3.2026', FR, CTX)).toBe('2026-03-05');
    expect(parseLocalDate('5-3-2026', FR, CTX)).toBe('2026-03-05');
    expect(parseLocalDate('3 5 2026', EN, CTX)).toBe('2026-03-05');
  });

  it('complète l’année à deux chiffres sur le pivot POSIX', () => {
    expect(parseLocalDate('15/08/26', FR, CTX)).toBe('2026-08-15');
    expect(parseLocalDate('15/08/99', FR, CTX)).toBe('1999-08-15');
  });

  it('sans année, prend celle du mois affiché', () => {
    expect(parseLocalDate('15/08', FR, CTX)).toBe('2026-08-15');
    expect(parseLocalDate('08/15', EN, CTX)).toBe('2026-08-15');
  });

  it('un quantième seul se lit dans le mois sous les yeux', () => {
    expect(parseLocalDate('3', FR, CTX)).toBe('2026-08-03');
    expect(parseLocalDate('31', FR, { year: 2026, month: 1 })).toBeNull();
  });

  it('lit une suite de chiffres collés dans l’ordre de la langue', () => {
    expect(parseLocalDate('15082026', FR, CTX)).toBe('2026-08-15');
    expect(parseLocalDate('08152026', EN, CTX)).toBe('2026-08-15');
    expect(parseLocalDate('150826', FR, CTX)).toBe('2026-08-15');
  });

  it('refuse ce qu’elle ne comprend pas plutôt que d’inventer un jour', () => {
    expect(parseLocalDate('', FR, CTX)).toBeNull();
    expect(parseLocalDate('   ', FR, CTX)).toBeNull();
    expect(parseLocalDate('demain', FR, CTX)).toBeNull();
    expect(parseLocalDate('31/02/2026', FR, CTX)).toBeNull();
    expect(parseLocalDate('15/13/2026', FR, CTX)).toBeNull();
    expect(parseLocalDate('2026-02-30', FR, CTX)).toBeNull();
    expect(parseLocalDate('1/2/3/4', FR, CTX)).toBeNull();
  });

  it('accepte le 29 février d’une année bissextile et refuse celui d’une année commune', () => {
    expect(parseLocalDate('29/02/2024', FR, CTX)).toBe('2024-02-29');
    expect(parseLocalDate('29/02/2026', FR, CTX)).toBeNull();
  });
});

describe('rendu des dates', () => {
  it('met la date en forme dans la langue de l’app', () => {
    expect(formatTypedDate('2026-08-15', FR)).toBe('15/08/2026');
    expect(formatTypedDate('2026-08-15', EN)).toBe('08/15/2026');
    expect(formatDisplayDate('2026-08-15', FR)).toContain('2026');
    expect(formatDisplayDate('2026-08-15', FR)).not.toBe(formatDisplayDate('2026-08-15', EN));
  });

  it('une valeur effacée reste vide (aucune date de repli)', () => {
    expect(formatDisplayDate('', FR)).toBe('');
    expect(formatTypedDate('', FR)).toBe('');
    expect(formatDisplayDate('pas une date', FR)).toBe('');
    expect(formatDisplayDate('2026-02-30', FR)).toBe('');
  });

  it('ce qui est rendu se retape à l’identique', () => {
    for (const locale of [FR, EN]) {
      const typed = formatTypedDate('2026-08-15', locale);
      expect(parseLocalDate(typed, locale, CTX)).toBe('2026-08-15');
    }
  });

  it('résout une langue vide sans lancer', () => {
    expect(resolveLocale('')).toBe('en-US');
    expect(resolveLocale(undefined)).toBe('en-US');
    expect(resolveLocale('fr')).toBe('fr');
  });
});

describe('bornes du calendrier', () => {
  it('rend toujours six semaines pleines (hauteur constante du popover)', () => {
    expect(monthGrid(2026, 7, 1)).toHaveLength(42);
    // Février 2026 tient en quatre semaines : la grille reste tout de même à 42
    expect(monthGrid(2026, 1, 0)).toHaveLength(42);
  });

  it('démarre la grille sur le premier jour de semaine demandé', () => {
    const monday = monthGrid(2026, 7, 1);
    const sunday = monthGrid(2026, 7, 0);
    expect(new Date(monday[0].year, monday[0].month, monday[0].day).getDay()).toBe(1);
    expect(new Date(sunday[0].year, sunday[0].month, sunday[0].day).getDay()).toBe(0);
  });

  it('contient tout le mois demandé, une seule fois', () => {
    const inMonth = monthGrid(2026, 7, 1).filter((d) => d.inCurrentMonth);
    expect(inMonth).toHaveLength(31);
    expect(inMonth[0].iso).toBe('2026-08-01');
    expect(inMonth[30].iso).toBe('2026-08-31');
  });

  it('donne 29 jours à février d’une année bissextile', () => {
    expect(monthGrid(2024, 1, 1).filter((d) => d.inCurrentMonth)).toHaveLength(29);
    expect(daysInMonth(2024, 1)).toBe(29);
    expect(daysInMonth(2026, 1)).toBe(28);
  });

  it('emprunte les jours voisins aux mois d’à côté, année comprise', () => {
    const jan = monthGrid(2026, 0, 1);
    expect(jan[0].year).toBe(2025);
    expect(jan[0].month).toBe(11);
    const dec = monthGrid(2026, 11, 1);
    expect(dec[41].year).toBe(2027);
    expect(dec[41].month).toBe(0);
  });

  it('passe l’année en changeant de mois aux extrémités', () => {
    expect(shiftMonth(2026, 0, -1)).toEqual({ year: 2025, month: 11 });
    expect(shiftMonth(2026, 11, 1)).toEqual({ year: 2027, month: 0 });
    expect(shiftMonth(2026, 7, -12)).toEqual({ year: 2025, month: 7 });
  });

  it('décale d’un jour par-dessus les frontières de mois et d’année', () => {
    expect(shiftIsoDays('2026-08-31', 1)).toBe('2026-09-01');
    expect(shiftIsoDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(shiftIsoDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(shiftIsoDays('pas une date', 1)).toBe('');
  });

  it('nomme les jours dans la langue et dans l’ordre de la semaine', () => {
    const fr = weekdayLabels(FR, 1);
    const en = weekdayLabels(EN, 0);
    expect(fr).toHaveLength(7);
    expect(en).toHaveLength(7);
    expect(fr[0].long).not.toBe(en[0].long);
    // Premier libellé = premier jour de la semaine de la locale
    expect(fr[0].long.toLowerCase()).toContain('lun');
    expect(en[0].long.toLowerCase()).toContain('sun');
  });

  it('fait commencer la semaine le dimanche en anglais, le lundi ailleurs', () => {
    expect(weekStartFor(EN)).toBe(0);
    expect(weekStartFor(FR)).toBe(1);
  });

  it('valide les valeurs ISO stockées', () => {
    expect(isValidIso('2026-08-15')).toBe(true);
    expect(isValidIso('2026-8-15')).toBe(false);
    expect(isValidIso('2026-02-31')).toBe(false);
    expect(isValidIso('')).toBe(false);
    expect(toIso(2026, 7, 5)).toBe('2026-08-05');
    expect(todayIso(new Date(2026, 7, 15, 23, 59))).toBe('2026-08-15');
  });
});

describe('nombres : séparateur décimal de la langue', () => {
  it('lit la virgule comme la décimale en français', () => {
    expect(parseDecimal('12,5', FR)).toBe(12.5);
    expect(parseDecimal('12.5', FR)).toBe(12.5);
    expect(parseDecimal('12.5', EN)).toBe(12.5);
  });

  it('démêle les milliers de la décimale', () => {
    expect(parseDecimal('1 234,56', FR)).toBe(1234.56);
    expect(parseDecimal('1,234.56', EN)).toBe(1234.56);
    expect(parseDecimal('1,234', EN)).toBe(1234);
    expect(parseDecimal('1.234', FR)).toBe(1234);
    expect(parseDecimal('1,5', EN)).toBe(1.5);
  });

  it('ce qui est affiché se retape à l’identique', () => {
    for (const locale of [FR, EN]) {
      expect(parseDecimal(formatDecimal(1234567.89, locale), locale)).toBe(1234567.89);
      expect(parseDecimal(formatDecimalPlain(-42.75, locale), locale)).toBe(-42.75);
    }
  });

  it('n’insère pas de groupes dans la valeur que l’on édite', () => {
    expect(formatDecimalPlain(1234567, FR)).toBe('1234567');
    expect(formatDecimal(1234567, EN)).toBe('1,234,567');
    expect(formatDecimal(Number.NaN, FR)).toBe('');
  });

  it('rend null sur une saisie vide ou non numérique (la cellule reste vide)', () => {
    expect(parseDecimal('', FR)).toBeNull();
    expect(parseDecimal('   ', FR)).toBeNull();
    expect(parseDecimal('douze', FR)).toBeNull();
    expect(parseDecimal('12px', FR)).toBeNull();
    expect(parseDecimal('-', FR)).toBeNull();
  });
});

/* ==================== Écriture d'une date : ne rien écrire pour rien ==================== */

describe('resolveDateCommit — regarder une date ne salit pas la note', () => {
  it('ne commite RIEN quand la saisie vaut déjà la cellule', () => {
    // Le cas réel : le popover est ouvert, on clique une flèche de mois,
    // « Aujourd'hui » ou une case — le champ perd le focus AVANT, et son blur
    // recommiterait la même valeur. Une transaction, une entrée d'annulation,
    // une note marquée modifiée et une remontée nuage pour un geste inerte.
    expect(resolveDateCommit('15/08/2026', '2026-08-15', FR, CTX)).toEqual({ action: 'none' });
    expect(resolveDateCommit('08/15/2026', '2026-08-15', EN, CTX)).toEqual({ action: 'none' });
    // Même valeur écrite autrement (ISO tapé, zéros absents) : toujours rien
    expect(resolveDateCommit('2026-08-15', '2026-08-15', FR, CTX)).toEqual({ action: 'none' });
    expect(resolveDateCommit('15/8/26', '2026-08-15', FR, CTX)).toEqual({ action: 'none' });
    // Espaces autour : la même date, donc rien non plus
    expect(resolveDateCommit('  15/08/2026 ', '2026-08-15', FR, CTX)).toEqual({ action: 'none' });
  });

  it('commite dès que la date DIFFÈRE', () => {
    expect(resolveDateCommit('16/08/2026', '2026-08-15', FR, CTX)).toEqual({
      action: 'commit',
      iso: '2026-08-16',
    });
    // Cellule vide au départ : la première date posée est bien une écriture
    expect(resolveDateCommit('16/08/2026', '', FR, CTX)).toEqual({
      action: 'commit',
      iso: '2026-08-16',
    });
    // La langue tranche : le même texte n'est pas le même jour
    expect(resolveDateCommit('08/09/2026', '2026-08-15', EN, CTX)).toEqual({
      action: 'commit',
      iso: '2026-08-09',
    });
  });

  it('n’efface que ce qui existait', () => {
    expect(resolveDateCommit('', '2026-08-15', FR, CTX)).toEqual({ action: 'clear' });
    expect(resolveDateCommit('   ', '2026-08-15', FR, CTX)).toEqual({ action: 'clear' });
    // Cellule déjà vide : vider le champ n'efface rien, donc n'écrit rien
    expect(resolveDateCommit('', '', FR, CTX)).toEqual({ action: 'none' });
    // Valeur stockée illisible : elle ne compte pas comme une date à effacer
    expect(resolveDateCommit('', '2026-02-30', FR, CTX)).toEqual({ action: 'none' });
  });

  it('signale une saisie non comprise, sans toucher la cellule', () => {
    expect(resolveDateCommit('demain', '2026-08-15', FR, CTX)).toEqual({ action: 'invalid' });
    expect(resolveDateCommit('32/13/2026', '2026-08-15', FR, CTX)).toEqual({ action: 'invalid' });
  });
});
