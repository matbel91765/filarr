/**
 * Le lot séquentiel d'« Ajouter au coffre » : ORDRE strict, un envoi à la fois,
 * ARRÊT à la première erreur (rien après elle n'est tenté), et une progression
 * qui compte les réussites — jamais les tentatives.
 */

import { describe, expect, it } from 'vitest';

import { runSequentially } from '../addToVaultBatch';

describe('runSequentially', () => {
  it('traite les éléments dans l’ordre, un seul à la fois', async () => {
    const vus: string[] = [];
    let enCours = 0;
    let maxEnCours = 0;
    const n = await runSequentially(['a', 'b', 'c'], async (x) => {
      enCours++;
      maxEnCours = Math.max(maxEnCours, enCours);
      await new Promise((r) => setTimeout(r, 1));
      vus.push(x);
      enCours--;
    });
    expect(vus).toEqual(['a', 'b', 'c']);
    expect(maxEnCours).toBe(1);
    expect(n).toBe(3);
  });

  it('s’arrête à la première erreur et la laisse remonter telle quelle', async () => {
    const vus: string[] = [];
    const progression: Array<[number, number]> = [];
    const echec = new Error('quota_exceeded');
    await expect(
      runSequentially(
        ['a', 'b', 'c'],
        async (x) => {
          if (x === 'b') throw echec;
          vus.push(x);
        },
        (done, total) => progression.push([done, total])
      )
    ).rejects.toBe(echec);
    // « c » n'a jamais été tenté ; la jauge s'est arrêtée sur la dernière réussite.
    expect(vus).toEqual(['a']);
    expect(progression).toEqual([
      [0, 3],
      [1, 3],
    ]);
  });

  it('annonce 0/total avant le premier envoi puis chaque réussite', async () => {
    const progression: Array<[number, number]> = [];
    await runSequentially(
      [1, 2],
      async () => {},
      (d, t) => progression.push([d, t])
    );
    expect(progression).toEqual([
      [0, 2],
      [1, 2],
      [2, 2],
    ]);
  });

  it('un lot vide rend 0 sans appeler l’étape', async () => {
    let appels = 0;
    const n = await runSequentially([], async () => {
      appels++;
    });
    expect(n).toBe(0);
    expect(appels).toBe(0);
  });
});
