/**
 * createItemGrants — le LOT de grants (un dossier, une sélection → une personne).
 *
 * Ce que ces tests verrouillent : la boucle est SÉQUENTIELLE et passe par le
 * thunk unitaire (ses `fulfilled` sont ce que l'index des badges écoute) ;
 * `already_granted` est un SAUT, pas une panne ; toute autre erreur ARRÊTE la
 * file avec le compte de ce qui est passé, et l'élément suivant n'est jamais
 * tenté.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { configureStore, createReducer } from '@reduxjs/toolkit';

const h = vi.hoisted(() => ({
  behaviourById: {} as Record<string, string>, // itemId -> code d'erreur (message)
  calls: [] as string[],
}));

vi.mock('../../../services/vault/vaultApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/vault/vaultApi')>();
  return {
    ...actual,
    apiGetMemberPublicKey: vi.fn(async () => ({
      encPublicKey: 'PK',
      fingerprint: 'FP',
      version: 1,
    })),
    apiGetKeyLog: vi.fn(async () => []),
    apiCreateItemGrant: vi.fn(async (_v: string, itemId: string) => {
      h.calls.push(itemId);
      const code = h.behaviourById[itemId];
      // apiCreateItemGrant passe par throwWithCode : le CODE est le message.
      if (code) throw new Error(code);
      return {
        id: `g-${itemId}`,
        granteeUserId: 'bob',
        granteeEmail: 'bob@x.io',
        role: 'viewer',
        wrappedForVersion: 1,
        stale: false,
        expiresAt: null,
        createdAt: '',
      };
    }),
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
    // Une clé déjà vue, inchangée : la cérémonie a eu lieu à l'écran.
    checkPeerKeyTransparency: vi.fn(async () => 'unchanged'),
  };
});

vi.mock('../../../services/vault/vaultKeyCache', () => ({
  getVaultKey: () => new Uint8Array(32),
  unlockVault: vi.fn(),
  isVaultUnlocked: () => true,
  lockVault: vi.fn(),
  lockVaultEverywhere: vi.fn(),
}));

import vaultsReducer, { createItemGrants, createItemGrant, type VaultsState } from '../vaultsSlice';

/**
 * Un témoin : compte les `createItemGrant.fulfilled` — c'est CE signal que
 * `shareIndexSlice` écoute pour +1 sur le badge de chaque élément. Un lot qui
 * court-circuiterait le thunk unitaire laisserait ce compteur à zéro.
 */
const unitFulfilled = createReducer(0, (b) => {
  b.addCase(createItemGrant.fulfilled, (n) => n + 1);
});

function makeStore() {
  const vaults: VaultsState = {
    vaults: {
      vault1: {
        id: 'vault1',
        organizationId: 'org1',
        ownerUserId: 'me',
        name: 'Coffre',
        currentKeyEpoch: 1,
        wrappedVaultKeyEpoch: 1,
        role: 'admin',
        createdAt: '',
      },
    },
    vaultIds: ['vault1'],
    itemsByVault: {
      vault1: ['i1', 'i2', 'i3'].map(
        (id) =>
          ({
            id,
            vaultId: 'vault1',
            ownerUserId: 'me',
            itemType: 'file',
            meta: { fileName: `${id}.pdf`, path: 'Contrats' },
            wrappedItemKey: 'W',
            wrappedUnderEpoch: 1,
            totalChunks: 0,
            sizeBytes: 0,
            status: 'ready',
            version: 1,
            createdAt: '',
            updatedAt: '',
          }) as never
      ),
    },
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
    reducer: { vaults: vaultsReducer, unitFulfilled },
    preloadedState: { vaults },
    middleware: (gdm) => gdm({ serializableCheck: false, immutableCheck: false }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  h.behaviourById = {};
  h.calls = [];
});

describe('createItemGrants', () => {
  it('lot complet : N scellements EN ORDRE, un fulfilled unitaire par élément', async () => {
    const store = makeStore();
    const r = await store.dispatch(
      createItemGrants({ vaultId: 'vault1', itemIds: ['i1', 'i2', 'i3'], granteeUserId: 'bob' })
    );
    expect(createItemGrants.fulfilled.match(r)).toBe(true);
    expect(r.payload).toEqual({
      vaultId: 'vault1',
      granteeUserId: 'bob',
      granted: ['i1', 'i2', 'i3'],
      skipped: [],
      total: 3,
    });
    expect(h.calls).toEqual(['i1', 'i2', 'i3']);
    expect(store.getState().unitFulfilled).toBe(3);
  });

  it('already_granted est un SAUT : la file continue, l’élément est compté à part', async () => {
    h.behaviourById = { i2: 'already_granted' };
    const store = makeStore();
    const r = await store.dispatch(
      createItemGrants({ vaultId: 'vault1', itemIds: ['i1', 'i2', 'i3'], granteeUserId: 'bob' })
    );
    expect(createItemGrants.fulfilled.match(r)).toBe(true);
    const payload = (r as { payload: { granted: string[]; skipped: string[] } }).payload;
    expect(payload.granted).toEqual(['i1', 'i3']);
    expect(payload.skipped).toEqual(['i2']);
    expect(store.getState().unitFulfilled).toBe(2);
  });

  it('toute autre erreur ARRÊTE la file : bilan jusqu’à l’échec, le suivant jamais tenté', async () => {
    h.behaviourById = { i2: 'vault_locked' };
    const store = makeStore();
    const r = await store.dispatch(
      createItemGrants({ vaultId: 'vault1', itemIds: ['i1', 'i2', 'i3'], granteeUserId: 'bob' })
    );
    expect(createItemGrants.rejected.match(r)).toBe(true);
    expect(r.payload).toEqual({
      vaultId: 'vault1',
      granteeUserId: 'bob',
      granted: ['i1'],
      skipped: [],
      total: 3,
      code: 'vault_locked',
      failedItemId: 'i2',
    });
    expect(h.calls).toEqual(['i1', 'i2']);
    expect(store.getState().unitFulfilled).toBe(1);
  });

  it('un élément absent du store (supprimé entre-temps) arrête aussi, avec son code', async () => {
    const store = makeStore();
    const r = await store.dispatch(
      createItemGrants({ vaultId: 'vault1', itemIds: ['i1', 'fantome'], granteeUserId: 'bob' })
    );
    expect(createItemGrants.rejected.match(r)).toBe(true);
    const payload = (r as { payload: { code: string; granted: string[] } }).payload;
    expect(payload.code).toBe('item_not_found');
    expect(payload.granted).toEqual(['i1']);
  });

  it('lot vide : fulfilled à zéro, aucun appel réseau', async () => {
    const store = makeStore();
    const r = await store.dispatch(
      createItemGrants({ vaultId: 'vault1', itemIds: [], granteeUserId: 'bob' })
    );
    expect(createItemGrants.fulfilled.match(r)).toBe(true);
    expect(h.calls).toEqual([]);
  });
});
