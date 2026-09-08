import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * SUPPRIMER UN PROFIL : L'ORDRE DES DEUX EFFACEMENTS EST UNE QUESTION DE DONNÉES.
 *
 * Depuis que la connexion restaure les profils du compte, supprimer un profil
 * doit aussi le retirer du nuage — sans quoi il revient à la connexion suivante,
 * et le ménage est impossible à tenir.
 *
 * Mais `profileManager.deleteProfile` LÈVE dans deux cas : profil introuvable,
 * et dernier profil restant. Purger le nuage EN PREMIER ferait donc qu'un de ces
 * refus détruise définitivement le contenu distant tout en laissant le profil à
 * l'écran — une perte de données sur un geste qui vient d'échouer. L'écran masque
 * bien le bouton sur le dernier profil, mais faire dépendre l'intégrité des
 * données d'une condition d'affichage n'est pas une garantie.
 *
 * Dans le bon ordre, le pire cas est bénin : si le nettoyage distant échoue, le
 * profil disparaît de cette machine et revient à la prochaine connexion. Rien
 * n'est perdu — son contenu est resté dans le nuage, précisément.
 */

const h = vi.hoisted(() => ({
  appels: [] as string[],
  echecLocal: null as string | null,
  echecNuage: null as string | null,
}));

if (typeof (globalThis as { window?: unknown }).window === 'undefined') {
  (globalThis as { window?: unknown }).window = globalThis;
}

vi.mock('../../../services/vault/vaultKeyCache', () => ({
  getVaultKey: () => null,
  unlockVault: vi.fn(),
  isVaultUnlocked: () => false,
  lockVault: vi.fn(),
  lockVaultEverywhere: vi.fn(),
  putVaultKey: vi.fn(),
  clearAllVaultKeys: vi.fn(),
}));

import { deleteProfile } from '../profilesSlice';

function poserLePont() {
  (window as unknown as { electron?: unknown }).electron = {
    ipcRenderer: {
      invoke: vi.fn(async (canal: string) => {
        h.appels.push(canal);
        if (canal === 'profile:delete' && h.echecLocal) throw new Error(h.echecLocal);
        if (canal === 'sync:deleteCloudProfile' && h.echecNuage) throw new Error(h.echecNuage);
        return { success: true };
      }),
    },
  };
}

/** Le thunk hors magasin : on n'éprouve que sa séquence d'effets. */
async function lancer() {
  const action = deleteProfile('p1');
  return action(vi.fn() as never, (() => ({})) as never, undefined as never);
}

beforeEach(() => {
  h.appels = [];
  h.echecLocal = null;
  h.echecNuage = null;
  poserLePont();
});

describe('deleteProfile — l’ordre des effacements', () => {
  it('efface le DISQUE d’abord, le nuage ensuite', async () => {
    await lancer();

    expect(h.appels).toEqual(['profile:delete', 'sync:deleteCloudProfile']);
  });

  it('un refus LOCAL laisse le nuage intact', async () => {
    // Les deux refus que `profileManager.deleteProfile` oppose — profil
    // introuvable, dernier profil restant — ne doivent jamais survenir APRÈS
    // avoir détruit le contenu distant.
    h.echecLocal = 'Cannot delete the last profile';

    await lancer();

    expect(h.appels).toEqual(['profile:delete']);
    expect(h.appels).not.toContain('sync:deleteCloudProfile');
  });

  it('un échec DISTANT ne remet pas le profil sur la machine', async () => {
    // Hors ligne ou déconnecté, on doit pouvoir retirer un profil de sa propre
    // machine. Il reviendra à la prochaine connexion — défaut connu, et bien
    // moins grave qu'un profil dont on ne peut plus se défaire.
    h.echecNuage = 'Network error';

    const out = await lancer();

    expect(h.appels).toEqual(['profile:delete', 'sync:deleteCloudProfile']);
    expect(out.payload ?? out).toBeDefined();
  });
});
