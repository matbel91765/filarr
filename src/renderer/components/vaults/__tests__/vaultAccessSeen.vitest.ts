import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * LE REGISTRE « DÉJÀ VU » DES COFFRES — ce qui décide, au lancement suivant,
 * qu'un coffre est nouveau pour moi.
 *
 * CE QUE CES TESTS GARDENT VRAIMENT : le drapeau `seeded` doit SURVIVRE au
 * disque. Un registre relu sans lui vaudrait « jamais semé », et le premier
 * chargement re-sèmerait en silence — supportable — mais un registre relu avec
 * un `seeded` faussement vrai sur une liste jamais vue ferait l'inverse : la
 * salve d'annonces du premier lancement, celle qu'on existe pour éviter.
 *
 * Et il ne contient QUE des identifiants opaques : jamais un nom de coffre, qui
 * est chiffré de bout en bout et n'existe déchiffré que le temps d'un rendu.
 */

const disque = new Map<string, string>();

vi.mock('../../../../services/core/profileStorage', () => ({
  getItem: (k: string) => disque.get(k) ?? null,
  setItem: (k: string, v: string) => {
    disque.set(k, v);
  },
}));

import { readKnownVaults, writeKnownVaults } from '../vaultAccessSeen';

beforeEach(() => disque.clear());

describe('vaultAccessSeen', () => {
  it('rien d’écrit = « jamais semé », pas « aucun coffre vu »', () => {
    expect(readKnownVaults('u1')).toBeNull();
  });

  it('aller-retour : les identifiants ET le drapeau de semis survivent', () => {
    writeKnownVaults('u1', { ids: ['v1', 'v2'], seeded: true });
    expect(readKnownVaults('u1')).toEqual({ ids: ['v1', 'v2'], seeded: true });
  });

  it('un registre semé mais VIDE se relit semé — sinon le prochain coffre serait tu', () => {
    // Le cas d'un compte qui n'a encore aucun coffre : le semis a bien eu lieu,
    // et le tout premier coffre qui arrivera est un vrai neuf à annoncer.
    writeKnownVaults('u1', { ids: [], seeded: true });
    expect(readKnownVaults('u1')).toEqual({ ids: [], seeded: true });
  });

  it('chaque compte a SON registre : celui de l’un ne répond pas pour l’autre', () => {
    writeKnownVaults('u1', { ids: ['v1'], seeded: true });
    expect(readKnownVaults('u2')).toBeNull();
  });

  it('un contenu illisible vaut « jamais semé » — jamais une salve', () => {
    disque.set('filarr-vaults-known:u1', 'pas du json');
    expect(readKnownVaults('u1')).toBeNull();
    disque.set('filarr-vaults-known:u1', '{"ids":"pas un tableau","seeded":true}');
    expect(readKnownVaults('u1')).toBeNull();
  });

  it('`seeded` doit être VRAI explicitement : une forme inconnue ne l’invente pas', () => {
    disque.set('filarr-vaults-known:u1', '{"ids":["v1"]}');
    expect(readKnownVaults('u1')).toEqual({ ids: ['v1'], seeded: false });
  });

  it('n’écrit que des identifiants — aucun nom de coffre ne peut s’y glisser', () => {
    writeKnownVaults('u1', { ids: ['v1'], seeded: true });
    const brut = disque.get('filarr-vaults-known:u1') ?? '';
    expect(JSON.parse(brut)).toEqual({ ids: ['v1'], seeded: true });
  });
});
