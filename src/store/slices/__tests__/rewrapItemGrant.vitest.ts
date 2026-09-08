/**
 * rewrapItemGrant (F17) — « Réparer » un accès né sous une ÉPOQUE ANTÉRIEURE.
 *
 * LE CAS EST LA RÈGLE, PAS L'EXCEPTION. Un grant devient `stale` sur un élément
 * qu'on ne touche plus : c'est précisément celui qui n'a pas été réenregistré
 * depuis la dernière rotation de clé, donc celui dont le `wrappedUnderEpoch` est
 * une époque ancienne. Or les clés d'époques anciennes ne sont PAS en cache au
 * démarrage — elles s'obtiennent par l'historique des wraps (`ensureEpochKeys`),
 * exactement ce que `loadVaultItems` fait avant de déchiffrer. Sans cette
 * garantie, « Réparer » répondait `vault_locked` sur un coffre parfaitement
 * déverrouillé, et l'écran affichait un message FAUX sur le seul geste qui
 * pouvait redonner l'accès.
 *
 *   npx vitest run src/store/slices/__tests__/rewrapItemGrant.vitest.ts
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { configureStore } from '@reduxjs/toolkit';

const h = vi.hoisted(() => ({
  /** Les époques dont K_vault est réellement en cache sur cet appareil. */
  deverrouillees: new Set<number>(),
  /** L'historique servi par le serveur — ce qu'`ensureEpochKeys` va chercher. */
  wraps: [] as Array<{ epoch: number; wrappedVaultKey: string }>,
  rescellements: [] as Array<{ itemId: string; grantId: string; itemVersion: number }>,
  wrapsLus: 0,
}));

vi.mock('../../../services/vault/vaultApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/vault/vaultApi')>();
  return {
    ...actual,
    apiListVaultItems: vi.fn(async () => [
      {
        id: 'i1',
        vaultId: 'vault1',
        ownerUserId: 'me',
        itemType: 'file',
        wrappedItemKey: 'W',
        // L'élément qu'on ne touche plus : scellé sous l'époque 1, alors que le
        // coffre en est à la 2.
        wrappedUnderEpoch: 1,
        encryptedMeta: 'M',
        encryptedMetaIv: 'IV',
        totalChunks: 0,
        sizeBytes: 0,
        status: 'ready',
        version: 7,
        createdAt: '',
        updatedAt: '',
      },
    ]),
    apiGetVaultKeyWraps: vi.fn(async () => {
      h.wrapsLus += 1;
      return h.wraps;
    }),
    apiGetMemberPublicKey: vi.fn(async () => ({
      encPublicKey: 'PK',
      fingerprint: 'FP',
      version: 1,
    })),
    apiRewrapItemGrant: vi.fn(
      async (
        _v: string,
        itemId: string,
        grantId: string,
        body: { wrappedItemKey: string; itemVersion: number }
      ) => {
        h.rescellements.push({ itemId, grantId, itemVersion: body.itemVersion });
      }
    ),
  };
});

vi.mock('../../../services/vault/vaultCrypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/vault/vaultCrypto')>();
  return {
    ...actual,
    unwrapItemKey: vi.fn(async () => new Uint8Array(32)),
    wrapItemKeyForRecipient: vi.fn(async () => 'WRAPPED'),
  };
});

vi.mock('../../../services/vault/keyTransparency', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/vault/keyTransparency')>();
  return {
    ...actual,
    // Pair jamais épinglé : la cérémonie n'est pas le sujet de cette suite.
    getTofuFingerprint: vi.fn(() => null),
  };
});

/**
 * Un cache de clés qui DISTINGUE LES ÉPOQUES — c'est tout l'objet du test. Un
 * bouchon qui rendrait la même clé pour n'importe quelle époque (comme celui de
 * `createItemGrants`) ne pourrait rien attraper ici.
 */
vi.mock('../../../services/vault/vaultKeyCache', () => ({
  getVaultKey: (_v: string, epoch: number) =>
    h.deverrouillees.has(epoch) ? new Uint8Array(32) : null,
  isVaultUnlocked: (_v: string, epoch?: number) =>
    epoch === undefined ? h.deverrouillees.size > 0 : h.deverrouillees.has(epoch),
  unlockVault: vi.fn(async (_v: string, epoch: number) => {
    h.deverrouillees.add(epoch);
  }),
  lockVault: vi.fn(),
  lockVaultEverywhere: vi.fn(),
}));

import vaultsReducer, { rewrapItemGrant, type VaultsState } from '../vaultsSlice';

function makeStore() {
  const vaults: VaultsState = {
    vaults: {
      vault1: {
        id: 'vault1',
        organizationId: 'org1',
        ownerUserId: 'me',
        name: 'Coffre',
        currentKeyEpoch: 2,
        wrappedVaultKeyEpoch: 2,
        role: 'admin',
        createdAt: '',
      },
    },
    vaultIds: ['vault1'],
    itemsByVault: {},
    decryptStatusByVault: {},
    loadFailureByVault: {},
    rewrapProgress: {},
    noteContentByRef: {},
    unlockedVaultIds: ['vault1'],
    activityHeads: [],
    activitySeenVersion: 0,
    deletedVaults: [],
    deletedVaultsLoading: false,
    myInvitations: [],
    myInvitationsLoading: false,
    awaitingHost: [],
    blockedGrants: [],
    loading: false,
    error: null,
    initialLoadRequested: false,
    listLoadedOnce: false,
    lastLoadHadKeypair: false,
  };
  return configureStore({
    reducer: { vaults: vaultsReducer },
    preloadedState: { vaults },
    middleware: (gdm) => gdm({ serializableCheck: false, immutableCheck: false }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  h.deverrouillees = new Set<number>([2]); // seule l'époque COURANTE est en cache
  h.wraps = [{ epoch: 1, wrappedVaultKey: 'W1' }];
  h.rescellements = [];
  h.wrapsLus = 0;
});

describe('rewrapItemGrant et les époques anciennes', () => {
  it('va CHERCHER la clé de l’époque de l’élément au lieu de dire « coffre verrouillé »', async () => {
    const store = makeStore();
    const r = await store.dispatch(
      rewrapItemGrant({
        vaultId: 'vault1',
        itemId: 'i1',
        grantId: 'g1',
        granteeUserId: 'bob',
      })
    );
    expect(rewrapItemGrant.fulfilled.match(r)).toBe(true);
    expect(h.wrapsLus).toBe(1);
    // La version rescellée est celle du DTO frais, jamais celle du store.
    expect(h.rescellements).toEqual([{ itemId: 'i1', grantId: 'g1', itemVersion: 7 }]);
  });

  it('l’époque déjà en cache n’entraîne AUCUNE lecture d’historique', async () => {
    h.deverrouillees = new Set<number>([1, 2]);
    const store = makeStore();
    const r = await store.dispatch(
      rewrapItemGrant({
        vaultId: 'vault1',
        itemId: 'i1',
        grantId: 'g1',
        granteeUserId: 'bob',
      })
    );
    expect(rewrapItemGrant.fulfilled.match(r)).toBe(true);
    expect(h.wrapsLus).toBe(0);
  });

  it('un historique qui ne rend RIEN laisse le refus honnête (vault_locked)', async () => {
    h.wraps = [];
    const store = makeStore();
    const r = await store.dispatch(
      rewrapItemGrant({
        vaultId: 'vault1',
        itemId: 'i1',
        grantId: 'g1',
        granteeUserId: 'bob',
      })
    );
    expect(rewrapItemGrant.rejected.match(r)).toBe(true);
    expect(r.payload).toBe('vault_locked');
    expect(h.rescellements).toEqual([]);
  });
});
