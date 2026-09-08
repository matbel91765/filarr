/**
 * deltaGcSweep.vitest.ts — Rattrapage du ramasse-miettes des blocs delta.
 *
 * Ce qui est defendu :
 *  1. UN GC RATE FINIT PAR REPASSER. C est tout l objet du module : sans lui,
 *     les orphelins d un fichier ecrit une fois attendent un televersement qui
 *     ne viendra jamais.
 *  2. UN COMMIT REOUVRE LE BESOIN. Il vient de creer des orphelins et de
 *     changer la version dont la garde du serveur depend.
 *  3. LE RATTRAPAGE NE SATURE PAS LA LIMITE DE DEBIT. Sinon il ferait echouer
 *     les GC normaux et fabriquerait les orphelins qu il ramasse.
 */

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_MAX_BACKOFF_MS,
  DEFAULT_MIN_RETRY_MS,
  DEFAULT_SWEEP_BUDGET,
  afterAttempt,
  afterCommit,
  backoffFor,
  initialState,
  needsSweep,
  pendingCount,
  selectForSweep,
  type GcFileState,
} from '../deltaGcSweep';

const T0 = 1_757_000_000_000;
const HEURE = 60 * 60 * 1000;

describe('etat initial', () => {
  it('un fichier tout juste televerse attend son ramassage', () => {
    const s = initialState('f1', 3);
    expect(s.lastAttemptOk).toBe(false);
    expect(s.lastAttemptAt).toBeNull();
    expect(needsSweep(s, T0)).toBe(true);
  });
});

describe('decision de reprise', () => {
  it('un ramassage REUSSI ne se refait pas', () => {
    // Les orphelins de ce fichier sont partis, et le prochain commit relancera
    // un GC de toute facon.
    const s = afterAttempt(initialState('f1', 3), true, T0);
    expect(needsSweep(s, T0 + 10 * HEURE)).toBe(false);
  });

  it('un ramassage rate repasse apres le delai', () => {
    // Un echec porte deja `consecutiveFailures = 1`, donc le recul vaut
    // `2 x minRetry` et non `minRetry` : le premier delai est celui d un
    // fichier qui n a jamais echoue, pas celui qui suit un echec.
    const s = afterAttempt(initialState('f1', 3), false, T0);
    const attendu = backoffFor(1);
    expect(attendu).toBe(DEFAULT_MIN_RETRY_MS * 2);
    expect(needsSweep(s, T0 + attendu - 1)).toBe(false);
    expect(needsSweep(s, T0 + attendu)).toBe(true);
  });

  it('une date dans le FUTUR force une reprise', () => {
    // Horloge qui a recule. Attendre un delai calcule depuis une date future
    // pourrait ne jamais s ecouler.
    const s = afterAttempt(initialState('f1', 3), false, T0 + 10 * HEURE);
    expect(needsSweep(s, T0)).toBe(true);
  });
});

describe('recul exponentiel', () => {
  it('double a chaque echec', () => {
    expect(backoffFor(0)).toBe(DEFAULT_MIN_RETRY_MS);
    expect(backoffFor(1)).toBe(DEFAULT_MIN_RETRY_MS * 2);
    expect(backoffFor(3)).toBe(DEFAULT_MIN_RETRY_MS * 8);
  });

  it('plafonne — un fichier condamne ne mange pas le budget des autres', () => {
    expect(backoffFor(50)).toBe(DEFAULT_MAX_BACKOFF_MS);
    expect(backoffFor(1000)).toBe(DEFAULT_MAX_BACKOFF_MS);
  });

  it('ne deborde pas sur un compteur absurde', () => {
    // 2 ** 1000 vaut Infinity : sans le plafonnement de l exposant, le delai
    // deviendrait NaN ou Infinity et le fichier ne serait plus jamais repris.
    expect(Number.isFinite(backoffFor(Number.MAX_SAFE_INTEGER))).toBe(true);
  });

  it('un echec de plus espace la reprise', () => {
    let s = initialState('f1', 3);
    s = afterAttempt(s, false, T0);
    // 1 echec -> 2 h de recul.
    expect(needsSweep(s, T0 + HEURE)).toBe(false);
    expect(needsSweep(s, T0 + 2 * HEURE)).toBe(true);

    s = afterAttempt(s, false, T0 + 2 * HEURE);
    // 2 echecs -> 4 h. Le meme delai qu avant ne suffit plus : c est tout
    // l interet du recul.
    expect(needsSweep(s, T0 + 4 * HEURE)).toBe(false);
    expect(needsSweep(s, T0 + 6 * HEURE)).toBe(true);
  });
});

describe('un commit reouvre le besoin', () => {
  it('meme apres un ramassage reussi', () => {
    // Un nouveau commit vient de creer des orphelins — les blocs de l ancienne
    // version. Conserver « deja ramasse » ferait sauter ce fichier pour
    // toujours.
    let s = afterAttempt(initialState('f1', 3), true, T0);
    expect(needsSweep(s, T0 + HEURE)).toBe(false);
    s = afterCommit(s, 4);
    expect(needsSweep(s, T0 + HEURE)).toBe(true);
    expect(s.committedVersion).toBe(4);
  });

  it('remet le compteur d echecs a zero', () => {
    let s = initialState('f1', 3);
    for (let i = 0; i < 5; i++) s = afterAttempt(s, false, T0 + i * DEFAULT_MAX_BACKOFF_MS);
    expect(s.consecutiveFailures).toBe(5);
    s = afterCommit(s, 9);
    expect(s.consecutiveFailures).toBe(0);
    expect(s.lastAttemptAt).toBeNull();
  });

  it('la version est celle que la garde du serveur comparera', () => {
    const s = afterCommit(initialState('f1', 3), 12);
    expect(s.committedVersion).toBe(12);
  });
});

describe('selection', () => {
  const etats = (n: number, lastAt: (i: number) => number | null): GcFileState[] =>
    Array.from({ length: n }, (_, i) => ({
      fileId: `f${i}`,
      committedVersion: 1,
      lastAttemptAt: lastAt(i),
      lastAttemptOk: false,
      consecutiveFailures: 0,
    }));

  it('BORNE le nombre de reprises par passage', () => {
    // Le serveur limite le ramassage a 120 appels par 300 s. Saturer cette
    // limite ferait echouer les GC NORMAUX, ceux qui suivent un commit : on
    // fabriquerait les orphelins qu on essaie de ramasser.
    const s = selectForSweep(etats(500, () => null), T0);
    expect(s.length).toBe(DEFAULT_SWEEP_BUDGET);
    expect(DEFAULT_SWEEP_BUDGET).toBeLessThan(120);
  });

  it('respecte un budget explicite', () => {
    expect(selectForSweep(etats(50, () => null), T0, { budget: 5 })).toHaveLength(5);
    expect(selectForSweep(etats(50, () => null), T0, { budget: 0 })).toHaveLength(0);
  });

  it('priorise ceux qui n ont JAMAIS ete essayes', () => {
    // Un fichier dont le ramassage n a jamais tourne porte, statistiquement, le
    // plus d orphelins.
    const melange: GcFileState[] = [
      { fileId: 'vieux', committedVersion: 1, lastAttemptAt: T0 - 10 * HEURE, lastAttemptOk: false, consecutiveFailures: 0 },
      { fileId: 'jamais', committedVersion: 1, lastAttemptAt: null, lastAttemptOk: false, consecutiveFailures: 0 },
      { fileId: 'recent', committedVersion: 1, lastAttemptAt: T0 - 2 * HEURE, lastAttemptOk: false, consecutiveFailures: 0 },
    ];
    const choix = selectForSweep(melange, T0, { budget: 3 });
    expect(choix.map((c) => c.fileId)).toEqual(['jamais', 'vieux', 'recent']);
  });

  it('ecarte ceux qui ont deja reussi', () => {
    const melange: GcFileState[] = [
      afterAttempt(initialState('ok', 1), true, T0 - 10 * HEURE),
      initialState('rate', 1),
    ];
    expect(selectForSweep(melange, T0).map((c) => c.fileId)).toEqual(['rate']);
  });

  it('ecarte ceux dont le delai n est pas ecoule', () => {
    const s = afterAttempt(initialState('f1', 1), false, T0);
    expect(selectForSweep([s], T0 + HEURE / 2)).toHaveLength(0);
  });

  it('rend une liste vide sur une entree vide', () => {
    expect(selectForSweep([], T0)).toEqual([]);
  });
});

describe('immuabilite', () => {
  it('afterAttempt ne mute pas son entree', () => {
    const s = initialState('f1', 3);
    const apres = afterAttempt(s, false, T0);
    expect(s.lastAttemptAt).toBeNull();
    expect(s.consecutiveFailures).toBe(0);
    expect(apres.lastAttemptAt).toBe(T0);
    expect(apres.consecutiveFailures).toBe(1);
  });

  it('afterCommit ne mute pas son entree', () => {
    const s = afterAttempt(initialState('f1', 3), true, T0);
    const apres = afterCommit(s, 4);
    expect(s.committedVersion).toBe(3);
    expect(s.lastAttemptOk).toBe(true);
    expect(apres.committedVersion).toBe(4);
    expect(apres.lastAttemptOk).toBe(false);
  });
});

describe('diagnostic', () => {
  it('compte ce qui attend, sans borne de budget', () => {
    const etats = Array.from({ length: 42 }, (_, i) => initialState(`f${i}`, 1));
    expect(pendingCount(etats, T0)).toBe(42);
    // La selection, elle, reste bornee : les deux chiffres ne disent pas la
    // meme chose et c est voulu.
    expect(selectForSweep(etats, T0)).toHaveLength(DEFAULT_SWEEP_BUDGET);
  });
});

describe('le scenario que ce module existe pour empecher', () => {
  it('un fichier ecrit UNE FOIS dont le GC a rate finit par etre ramasse', () => {
    // Sans rattrapage : le GC echoue, `.catch(() => undefined)` l avale, et les
    // orphelins attendent un prochain televersement qui ne viendra jamais.
    let s = initialState('rapport-annuel', 1);
    s = afterAttempt(s, false, T0); // coupure reseau au commit

    // Le fichier n est plus jamais modifie. Sans ce module, fin de l histoire.
    let now = T0;
    let repris = 0;
    for (let jour = 1; jour <= 30; jour++) {
      now = T0 + jour * 24 * HEURE;
      if (selectForSweep([s], now).length > 0) {
        repris++;
        s = afterAttempt(s, repris >= 2, now); // la deuxieme tentative passe
      }
    }
    expect(repris).toBeGreaterThanOrEqual(2);
    expect(s.lastAttemptOk).toBe(true);
  });
});
