import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * PERDRE LA FEK, C'EST TROIS GESTES — et la déconnexion n'en faisait qu'un.
 *
 * Quatre chemins perdent la clé de fichiers : le verrouillage automatique,
 * l'effacement à distance, la veille de politique, et la déconnexion. Les trois
 * premiers écrivaient la séquence complète à la main. Le quatrième appelait
 * `clearHybridCrypto()` et s'arrêtait là, ce qui laissait derrière lui :
 *
 *   · les clés de salle collab, qui DÉRIVENT de la FEK — de quoi déchiffrer le
 *     trafic d'un coffre dont on vient de partir — plus les sessions vivantes,
 *     leurs sockets et leurs minuteurs, battant pour un compte absent ;
 *   · une session « authentifiée, déverrouillée » SANS clé : l'écran de
 *     déverrouillage ne s'ouvrait pas, personne ne redérivait rien, et tout
 *     déchiffrement local échouait en silence.
 *
 * La séquence a maintenant un seul endroit. Ce fichier vérifie qu'elle les fait
 * tous, et dans le bon ordre.
 *
 * Un QUATRIÈME geste est venu s'ajouter en tête, et c'est le seul qui écrit :
 * purger la sauvegarde de notes que le debounce retient. Il passe AVANT les
 * trois autres parce que la porte du main (`vaultLockState`) refuse désormais
 * `notes:save` sur un coffre verrouillé — écrire après aurait perdu la frappe.
 */

const spies = vi.hoisted(() => ({
  ordre: [] as string[],
}));

vi.mock('../hybridCrypto', () => ({
  clearHybridCrypto: vi.fn(() => {
    spies.ordre.push('crypto');
  }),
}));

vi.mock('../../collab/collabSession', () => ({
  purgeCollabOnKeyLoss: vi.fn(() => {
    spies.ordre.push('collab');
  }),
}));

vi.mock('../../../store/notesAutosaveFlush', () => ({
  flushPendingNotesSave: vi.fn(async () => {
    spies.ordre.push('flush');
  }),
}));

import { forgetSessionSecrets } from '../sessionTeardown';
import { clearHybridCrypto } from '../hybridCrypto';
import { purgeCollabOnKeyLoss } from '../../collab/collabSession';
import { flushPendingNotesSave } from '../../../store/notesAutosaveFlush';
import { lockApp } from '../../../store/slices/authSlice';

beforeEach(() => {
  vi.clearAllMocks();
  spies.ordre = [];
});

describe('forgetSessionSecrets', () => {
  it('efface la crypto, purge la collab, ET verrouille', async () => {
    const dispatch = vi.fn(() => {
      spies.ordre.push('lock');
    });

    await forgetSessionSecrets(dispatch);

    expect(clearHybridCrypto).toHaveBeenCalledTimes(1);
    expect(purgeCollabOnKeyLoss).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith(lockApp());
  });

  it('purge la collab APRÈS la crypto — ce qui dérive part après sa source', async () => {
    const dispatch = vi.fn(() => {
      spies.ordre.push('lock');
    });

    await forgetSessionSecrets(dispatch);

    expect(spies.ordre).toEqual(['flush', 'crypto', 'collab', 'lock']);
  });

  it("ÉCRIT AVANT D'EFFACER — sinon le debounce de l'auto-save perd la frappe", async () => {
    // RÉGRESSION : la porte du main (`vaultLockState`) refuse `notes:save` dès
    // que le coffre est verrouillé. L'écriture que le debounce retenait doit
    // donc partir tant qu'une clé existe — c'est-à-dire AVANT clearHybridCrypto
    // et AVANT que `lockApp` fasse rapporter l'état au main.
    const dispatch = vi.fn(() => {
      spies.ordre.push('lock');
    });

    await forgetSessionSecrets(dispatch, 'auto-lock');

    expect(flushPendingNotesSave).toHaveBeenCalledTimes(1);
    expect(spies.ordre[0]).toBe('flush');
    expect(dispatch).toHaveBeenCalledWith(lockApp('auto-lock'));
  });

  it('sans dispatch, oublie tout de même les secrets — et sans écrire', async () => {
    // Le seul appelant sans écran est l'effacement à distance, qui recharge la
    // fenêtre juste après. Les DEUX effacements doivent quand même avoir lieu :
    // le rechargement n'est pas garanti immédiat, et rien ne doit survivre.
    //
    // Mais PAS la purge d'écriture : écrire sur le disque juste avant de le
    // détruire n'a aucun sens, et courrait après le rechargement.
    await forgetSessionSecrets(null);

    expect(clearHybridCrypto).toHaveBeenCalledTimes(1);
    expect(purgeCollabOnKeyLoss).toHaveBeenCalledTimes(1);
    expect(flushPendingNotesSave).not.toHaveBeenCalled();
    expect(spies.ordre).toEqual(['crypto', 'collab']);
  });
});
