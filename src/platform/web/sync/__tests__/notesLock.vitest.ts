/**
 * Verrou du store de notes — le primitif qui empêche la MISE À JOUR PERDUE.
 *
 * Patron de panne : `installNotes` (lire → déchiffrer → fusionner → chiffrer →
 * écrire) et `notes:save` (garde anti-vidage, qui LIT, puis écriture) touchent
 * le même blob avec plusieurs `await` entre leur lecture et leur écriture. Sans
 * sérialisation, celle qui écrit en dernier reconstruit son résultat à partir
 * d'une lecture périmée : la sauvegarde de l'autre disparaît sans un bruit.
 *
 * Second patron : la chaîne de promesses est une variable de MODULE, donc
 * aveugle aux autres ONGLETS — qui partagent pourtant le même IndexedDB et font
 * tourner le même ordonnanceur. D'où le Web Lock nommé, éprouvé ici avec deux
 * instances distinctes du module.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { withNotesLock } from '../notesLock';

describe('withNotesLock', () => {
  it('sérialise des lire-modifier-écrire concurrents (aucune mise à jour perdue)', async () => {
    let store = 0;
    const readModifyWrite = () =>
      withNotesLock(async () => {
        const read = store;
        await new Promise((resolve) => setTimeout(resolve, 5));
        store = read + 1;
      });

    await Promise.all([readModifyWrite(), readModifyWrite(), readModifyWrite()]);

    // Sans verrou, les trois lisent 0 et écrivent 1 : deux écritures perdues.
    expect(store).toBe(3);
  });

  it('respecte l’ordre d’arrivée', async () => {
    const ordre: string[] = [];
    const tache = (nom: string, attente: number) =>
      withNotesLock(async () => {
        await new Promise((resolve) => setTimeout(resolve, attente));
        ordre.push(nom);
      });

    // La première est la plus LENTE : sans verrou, elle finirait la dernière.
    await Promise.all([tache('a', 20), tache('b', 1), tache('c', 1)]);
    expect(ordre).toEqual(['a', 'b', 'c']);
  });

  it('une tâche qui échoue ne fige pas la file', async () => {
    await expect(
      withNotesLock(async () => {
        throw new Error('boum');
      })
    ).rejects.toThrow('boum');

    await expect(withNotesLock(async () => 'suivante')).resolves.toBe('suivante');
  });
});

describe('exclusion INTER-ONGLETS (navigator.locks)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  /** Faux LockManager : une vraie file, comme celle du navigateur. */
  function fauxVerrous(): { locks: unknown; noms: string[] } {
    const noms: string[] = [];
    let file: Promise<unknown> = Promise.resolve();
    return {
      noms,
      locks: {
        request(nom: string, callback: () => Promise<unknown>) {
          noms.push(nom);
          const run = file.then(() => callback());
          file = run.then(
            () => undefined,
            () => undefined
          );
          return run;
        },
      },
    };
  }

  it('deux onglets (deux instances du module) ne se perdent pas d’écriture', async () => {
    const { locks, noms } = fauxVerrous();
    vi.stubGlobal('navigator', { locks });

    vi.resetModules();
    const ongletA = await import('../notesLock');
    vi.resetModules();
    const ongletB = await import('../notesLock');
    // Deux instances : chacune a SA chaîne de promesses, comme deux onglets.
    expect(ongletA.withNotesLock).not.toBe(ongletB.withNotesLock);

    let store = 0;
    const lireModifierEcrire = (onglet: typeof ongletA) =>
      onglet.withNotesLock(async () => {
        const lu = store;
        await new Promise((resolve) => setTimeout(resolve, 5));
        store = lu + 1;
      });

    await Promise.all([lireModifierEcrire(ongletA), lireModifierEcrire(ongletB)]);

    // Sans verrou partagé, les deux lisent 0 et écrivent 1 : une perdue.
    expect(store).toBe(2);
    expect(noms).toEqual(['filarr-notes', 'filarr-notes']);
  });

  it('sans l’API (test, contexte non sécurisé) : repli sur la chaîne locale', async () => {
    vi.stubGlobal('navigator', {});
    vi.resetModules();
    const onglet = await import('../notesLock');

    let store = 0;
    const lireModifierEcrire = () =>
      onglet.withNotesLock(async () => {
        const lu = store;
        await new Promise((resolve) => setTimeout(resolve, 5));
        store = lu + 1;
      });

    await Promise.all([lireModifierEcrire(), lireModifierEcrire()]);
    expect(store).toBe(2);
  });
});
