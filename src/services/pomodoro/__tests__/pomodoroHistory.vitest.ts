/**
 * LE JOURNAL DU MINUTEUR — une entrée par jour, et les PAUSES comptent enfin.
 *
 * LE DÉFAUT. `recordFocusCompletion` n'entrait au journal que les sessions de
 * concentration : une pause menée à son terme ne laissait aucune trace, et le
 * chiffre « Pauses 2 » que le téléphone affiche était impossible à produire
 * ici. Le champ est additif, local (stockage de profil, aucune route ne le
 * transporte) et absent des entrées écrites avant — il se lit donc toujours
 * avec un repli.
 */

import { describe, it, expect } from 'vitest';

import {
  HISTORY_MAX_DAYS,
  pomodoroDayKey,
  pomodoroDayStats,
  recordPomodoroCompletion,
  type PomodoroHistoryEntry,
} from '../pomodoroHistory';

const JOUR = '2026-09-03';
const VEILLE = '2026-09-02';

describe('la clé du jour', () => {
  it('est le jour CIVIL local, sur deux chiffres', () => {
    expect(pomodoroDayKey(new Date(2026, 8, 3, 23, 59))).toBe('2026-09-03');
    expect(pomodoroDayKey(new Date(2026, 0, 1, 0, 0))).toBe('2026-01-01');
  });
});

describe('une concentration terminée', () => {
  it('crée l’entrée du jour quand il n’y en a pas', () => {
    const out = recordPomodoroCompletion([], { day: JOUR, isFocus: true, minutes: 25 });
    expect(out).toEqual([{ date: JOUR, focusCount: 1, totalFocusMinutes: 25, breakCount: 0 }]);
  });

  it('cumule dans l’entrée du jour, sans en créer une seconde', () => {
    let out = recordPomodoroCompletion([], { day: JOUR, isFocus: true, minutes: 25 });
    out = recordPomodoroCompletion(out, { day: JOUR, isFocus: true, minutes: 25 });
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({ date: JOUR, focusCount: 2, totalFocusMinutes: 50, breakCount: 0 });
  });

  it('ne touche pas aux autres jours', () => {
    const veille: PomodoroHistoryEntry = {
      date: VEILLE,
      focusCount: 3,
      totalFocusMinutes: 75,
      breakCount: 2,
    };
    const out = recordPomodoroCompletion([veille], { day: JOUR, isFocus: true, minutes: 25 });
    expect(out[0]).toEqual(veille);
    expect(out).toHaveLength(2);
  });

  it('rend un tableau NEUF — le journal d’entrée n’est jamais muté', () => {
    const avant: PomodoroHistoryEntry[] = [{ date: JOUR, focusCount: 1, totalFocusMinutes: 25 }];
    const copie = JSON.parse(JSON.stringify(avant));
    const out = recordPomodoroCompletion(avant, { day: JOUR, isFocus: true, minutes: 25 });
    expect(avant).toEqual(copie);
    expect(out).not.toBe(avant);
    expect(out[0]).not.toBe(avant[0]);
  });
});

describe('une PAUSE terminée — ce que le bureau ne comptait pas', () => {
  it('incrémente breakCount et RIEN d’autre', () => {
    const out = recordPomodoroCompletion([], { day: JOUR, isFocus: false, minutes: 5 });
    expect(out).toEqual([{ date: JOUR, focusCount: 0, totalFocusMinutes: 0, breakCount: 1 }]);
  });

  it('les minutes d’une pause ne gonflent PAS le temps concentré', () => {
    let out = recordPomodoroCompletion([], { day: JOUR, isFocus: true, minutes: 25 });
    out = recordPomodoroCompletion(out, { day: JOUR, isFocus: false, minutes: 5 });
    expect(out[0]).toEqual({ date: JOUR, focusCount: 1, totalFocusMinutes: 25, breakCount: 1 });
  });

  it('part de zéro sur une entrée écrite AVANT que le compteur existe', () => {
    // Pas de migration : `breakCount` est simplement absent de ces entrées.
    const ancienne: PomodoroHistoryEntry = { date: JOUR, focusCount: 4, totalFocusMinutes: 100 };
    const out = recordPomodoroCompletion([ancienne], { day: JOUR, isFocus: false, minutes: 5 });
    expect(out[0].breakCount).toBe(1);
    expect(out[0].focusCount).toBe(4);
  });
});

describe('la borne s’applique à l’ÉCRITURE', () => {
  it('ne garde que les 90 derniers jours, et les plus RÉCENTS', () => {
    const vieux: PomodoroHistoryEntry[] = Array.from({ length: HISTORY_MAX_DAYS }, (_, i) => ({
      date: `vieux-${i}`,
      focusCount: i,
      totalFocusMinutes: i,
    }));
    const out = recordPomodoroCompletion(vieux, { day: JOUR, isFocus: true, minutes: 25 });
    expect(out).toHaveLength(HISTORY_MAX_DAYS);
    expect(out[out.length - 1].date).toBe(JOUR);
    expect(out[0].date).toBe('vieux-1');
  });
});

describe('ce qu’un jour raconte', () => {
  it('rend des zéros pour un jour vide plutôt que undefined', () => {
    expect(pomodoroDayStats([], JOUR)).toEqual({ focusCount: 0, focusMinutes: 0, breakCount: 0 });
  });

  it('lit une entrée sans breakCount comme zéro pause', () => {
    const history: PomodoroHistoryEntry[] = [{ date: JOUR, focusCount: 2, totalFocusMinutes: 50 }];
    expect(pomodoroDayStats(history, JOUR)).toEqual({
      focusCount: 2,
      focusMinutes: 50,
      breakCount: 0,
    });
  });

  it('ne confond pas deux jours', () => {
    const history: PomodoroHistoryEntry[] = [
      { date: VEILLE, focusCount: 9, totalFocusMinutes: 225, breakCount: 8 },
      { date: JOUR, focusCount: 1, totalFocusMinutes: 25, breakCount: 1 },
    ];
    expect(pomodoroDayStats(history, JOUR).focusCount).toBe(1);
    expect(pomodoroDayStats(history, VEILLE).breakCount).toBe(8);
  });
});
