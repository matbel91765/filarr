import { describe, it, expect, beforeEach, vi } from 'vitest';
import { configureStore } from '@reduxjs/toolkit';

/**
 * LA CORBEILLE DES COFFRES — la moitié manquante de la suppression.
 *
 * Supprimer un coffre partagé est réversible pendant trente jours : le serveur
 * pose `revoked_at`, l'accès tombe dans la seconde, et rien n'est détruit avant
 * la purge. La route de restauration existait. L'appel client existait. Et rien
 * ne pouvait dire À QUEL COFFRE l'adresser — la liste ordinaire écarte les
 * supprimés, par construction. Deux écrans promettaient donc une récupération
 * qu'aucun chemin ne rendait possible.
 *
 * Ce fichier éprouve les deux gestes qui ferment le circuit, et le troisième qui
 * décide de ce que l'écran affiche quand l'un des deux échoue.
 */

const server = vi.hoisted(() => ({
  deleted: [] as unknown[],
  restoreFails: false,
  listCalls: 0,
  restoreCalls: [] as string[],
}));

vi.mock('../../../services/network/apiClient', () => ({
  default: {},
  getOrgContextId: () => 'org1',
  getImplicitOrg: () => 'org1',
  setImplicitOrg: vi.fn(),
  setActiveOrg: vi.fn(),
  rememberVaultOrg: vi.fn(),
  getRememberedVaultOrg: () => 'org1',
  forgetVaultOrg: vi.fn(),
  forgetVaultOrgs: vi.fn(),
}));

vi.mock('../../../services/vault/vaultApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/vault/vaultApi')>();
  return {
    ...actual,
    apiListDeletedVaults: vi.fn(async () => {
      server.listCalls++;
      return server.deleted;
    }),
    apiRestoreVault: vi.fn(async (vaultId: string) => {
      server.restoreCalls.push(vaultId);
      if (server.restoreFails) throw new Error('vault_restore_failed');
    }),
    apiListVaults: vi.fn(async () => []),
    apiEnsurePersonalSpace: vi.fn(async () => ({ orgId: 'org1' })),
  };
});

vi.mock('../../../services/vault/vaultKeyCache', () => ({
  getVaultKey: () => null,
  unlockVault: vi.fn(async () => new Uint8Array(32)),
  isVaultUnlocked: () => false,
  lockVault: vi.fn(),
  lockVaultEverywhere: vi.fn(),
  putVaultKey: vi.fn(),
  clearAllVaultKeys: vi.fn(),
}));

vi.mock('../../../services/vault/vaultCrypto', () => ({
  decryptVaultName: vi.fn(async (enc: string) => {
    if (enc === 'ILLISIBLE') throw new Error('bad key');
    return `nom:${enc}`;
  }),
  unwrapItemKey: vi.fn(),
  decryptItemMeta: vi.fn(),
  decryptItemChunk: vi.fn(),
  generateItemKey: vi.fn(),
  encryptItemMeta: vi.fn(),
  encryptItemChunk: vi.fn(),
  wrapItemKey: vi.fn(),
  generateVaultKey: vi.fn(),
  encryptVaultName: vi.fn(),
  wrapVaultKey: vi.fn(),
  unwrapVaultKey: vi.fn(),
}));

vi.mock('../../../services/collab/collabSession', () => ({ purgeVaultCollab: vi.fn() }));

import vaultsReducer, {
  loadDeletedVaults,
  restoreVault,
  selectDeletedVaults,
} from '../vaultsSlice';
import { clearCloudAuth } from '../authSlice';
import { apiRestoreVault } from '../../../services/vault/vaultApi';

function deletedVault(o: Record<string, unknown> = {}) {
  return {
    id: 'v1',
    organizationId: 'org1',
    ownerUserId: 'moi',
    nameEncrypted: 'SECRET',
    nameIv: 'IV',
    currentKeyEpoch: 1,
    role: 'owner',
    wrappedVaultKey: 'W',
    wrappedVaultKeyEpoch: 1,
    createdAt: '2026-01-01T00:00:00Z',
    deletedAt: '2026-08-01T00:00:00Z',
    restorableUntil: '2026-08-31T00:00:00Z',
    ...o,
  };
}

function makeStore() {
  return configureStore({
    reducer: {
      vaults: vaultsReducer,
      org: () => ({ orgs: [], currentOrgId: 'org1', spaceMode: 'personal' }),
      auth: () => ({ cloudUser: { subscriptionTier: 'pro' } }),
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  server.deleted = [];
  server.restoreFails = false;
  server.listCalls = 0;
  server.restoreCalls = [];
});

describe('loadDeletedVaults — voir ce qu’on a supprimé', () => {
  it('rend les coffres supprimés, nom déchiffré et échéance comprise', async () => {
    server.deleted = [deletedVault()];
    const store = makeStore();

    await store.dispatch(loadDeletedVaults());

    const trash = selectDeletedVaults(store.getState() as never);
    expect(trash).toHaveLength(1);
    expect(trash[0]).toMatchObject({
      id: 'v1',
      name: 'nom:SECRET',
      restorableUntil: '2026-08-31T00:00:00Z',
      deletedAt: '2026-08-01T00:00:00Z',
    });
  });

  it('garde un coffre dont le nom ne s’ouvre pas — c’est un coffre à récupérer', async () => {
    // Le laisser tomber serait la pire réponse possible : le seul écran d'où on
    // peut le reprendre serait aussi celui qui refuse de l'afficher.
    server.deleted = [deletedVault({ nameEncrypted: 'ILLISIBLE' })];
    const store = makeStore();

    await store.dispatch(loadDeletedVaults());

    const trash = selectDeletedVaults(store.getState() as never);
    expect(trash).toHaveLength(1);
    expect(trash[0].name).toBe('');
  });

  it('n’expose pas les coffres VIVANTS — la corbeille et la liste sont deux choses', async () => {
    server.deleted = [];
    const store = makeStore();
    await store.dispatch(loadDeletedVaults());
    expect(selectDeletedVaults(store.getState() as never)).toEqual([]);
  });

  it('un échec de chargement VIDE la corbeille au lieu de laisser la précédente', async () => {
    server.deleted = [deletedVault()];
    const store = makeStore();
    await store.dispatch(loadDeletedVaults());
    expect(selectDeletedVaults(store.getState() as never)).toHaveLength(1);

    server.deleted = null as never; // provoque une levée dans le thunk
    await store.dispatch(loadDeletedVaults());

    expect(selectDeletedVaults(store.getState() as never)).toEqual([]);
  });
});

describe('restoreVault — rétracter le geste', () => {
  it('appelle le serveur puis RECHARGE la liste vivante', async () => {
    // La reconstruction locale du coffre serait une devinette : sa clé, ses
    // éléments et son époque viennent du serveur, pas de ce qu'on avait gardé.
    server.deleted = [deletedVault()];
    const store = makeStore();
    await store.dispatch(loadDeletedVaults());

    await store.dispatch(restoreVault({ vaultId: 'v1' }));

    expect(apiRestoreVault).toHaveBeenCalledWith('v1');
    expect(store.getState().vaults.loading).toBe(false);
    expect(selectDeletedVaults(store.getState() as never)).toEqual([]);
  });

  it('un refus LAISSE le coffre dans la corbeille', async () => {
    // Le faire disparaître sur un échec dirait « c'est fait » exactement quand ça
    // ne l'est pas — et retirerait le seul bouton permettant de réessayer.
    server.deleted = [deletedVault()];
    server.restoreFails = true;
    const store = makeStore();
    await store.dispatch(loadDeletedVaults());

    const result = await store.dispatch(restoreVault({ vaultId: 'v1' }));

    expect(restoreVault.rejected.match(result)).toBe(true);
    expect(selectDeletedVaults(store.getState() as never)).toHaveLength(1);
  });
});

describe('la corbeille appartient au compte connecté', () => {
  it('la déconnexion la vide', async () => {
    // Elle porte des noms de coffres DÉCHIFFRÉS. Les laisser en place les
    // afficherait au compte suivant sur cette machine.
    server.deleted = [deletedVault()];
    const store = makeStore();
    await store.dispatch(loadDeletedVaults());
    expect(selectDeletedVaults(store.getState() as never)).toHaveLength(1);

    store.dispatch(clearCloudAuth());

    expect(selectDeletedVaults(store.getState() as never)).toEqual([]);
  });
});
