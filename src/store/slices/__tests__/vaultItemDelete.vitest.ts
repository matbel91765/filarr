/**
 * deleteVaultItems — la boucle N-DELETE de la suppression récursive.
 *
 * LE point de convention verrouillé ici : apiDeleteVaultItem laisse remonter
 * l'AxiosError BRUT (pas de throwWithCode) — le thunk classifie via
 * classifyVaultFailure (e.response.data.code), jamais via e.message. Les mocks
 * jettent donc des erreurs FORME AXIOS, comme la réalité.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { configureStore } from '@reduxjs/toolkit';

const h = vi.hoisted(() => ({
  behaviourById: {} as Record<string, string>, // itemId -> code d'enveloppe Worker
  calls: [] as string[],
  listCalls: 0,
}));

/** Une erreur telle que l'intercepteur la laisse remonter : forme axios. */
function axiosError(code: string, status = 409): Error {
  const e = new Error(`Request failed with status code ${status}`);
  (e as never as { isAxiosError: boolean }).isAxiosError = true;
  (e as never as { response: unknown }).response = { status, data: { code } };
  return e;
}

vi.mock('../../../services/vault/vaultApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/vault/vaultApi')>();
  return {
    ...actual,
    apiDeleteVaultItem: vi.fn(async (_v: string, itemId: string) => {
      h.calls.push(itemId);
      const code = h.behaviourById[itemId];
      if (code) throw axiosError(code, code === 'item_not_found' ? 404 : 409);
    }),
    apiListVaultItems: vi.fn(async () => {
      h.listCalls++;
      return [];
    }),
    apiGetVaultKeyWraps: vi.fn(async () => []),
  };
});

vi.mock('../../../services/vault/vaultKeyCache', () => ({
  getVaultKey: () => new Uint8Array(32),
  unlockVault: vi.fn(),
  isVaultUnlocked: () => true,
  lockVault: vi.fn(),
  lockVaultEverywhere: vi.fn(),
}));

import vaultsReducer, { deleteVaultItems, type VaultsState } from '../vaultsSlice';

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
            itemType: 'note',
            meta: { title: id },
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
    noteContentByRef: { 'vault1:i1': 'CLAIR', 'vault1:i3': 'AUSSI' },
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
  h.behaviourById = {};
  h.calls = [];
  h.listCalls = 0;
});

describe('deleteVaultItems', () => {
  it('lot complet : fulfilled, store épuré, clair purgé du cache, pas de reload', async () => {
    const store = makeStore();
    const r = await store.dispatch(deleteVaultItems({ vaultId: 'vault1', itemIds: ['i1', 'i3'] }));
    expect(deleteVaultItems.fulfilled.match(r)).toBe(true);
    expect(r.payload).toEqual({ vaultId: 'vault1', applied: ['i1', 'i3'], failed: [] });
    const st = store.getState().vaults;
    expect(st.itemsByVault.vault1.map((i) => i.id)).toEqual(['i2']);
    expect(st.noteContentByRef).toEqual({});
    expect(h.listCalls).toBe(0);
  });

  it('item_not_found (forme AXIOS) = SUCCÈS — la reprise est idempotente', async () => {
    h.behaviourById = { i1: 'item_not_found' };
    const store = makeStore();
    const r = await store.dispatch(deleteVaultItems({ vaultId: 'vault1', itemIds: ['i1', 'i2'] }));
    const payload = (r as { payload: { applied: string[]; failed: unknown[] } }).payload;
    expect(payload.applied).toEqual(['i1', 'i2']);
    expect(payload.failed).toEqual([]);
  });

  it('legal_hold_active (forme AXIOS) est SYSTÉMIQUE : break, l’élément suivant jamais tenté', async () => {
    h.behaviourById = { i2: 'legal_hold_active' };
    const store = makeStore();
    const r = await store.dispatch(
      deleteVaultItems({ vaultId: 'vault1', itemIds: ['i1', 'i2', 'i3'] })
    );
    const payload = (
      r as { payload: { applied: string[]; failed: Array<{ itemId: string; error: string }> } }
    ).payload;
    expect(payload.applied).toEqual(['i1']);
    expect(payload.failed).toEqual([{ itemId: 'i2', error: 'legal_hold_active' }]);
    expect(h.calls).toEqual(['i1', 'i2']); // i3 jamais tenté
    expect(h.listCalls).toBeGreaterThan(0); // l'état a divergé → rechargé
  });

  it('une erreur NON-axios (réseau muet) devient item_delete_failed, jamais e.message brut', async () => {
    h.behaviourById = {};
    const store = makeStore();
    const api = await import('../../../services/vault/vaultApi');
    vi.mocked(api.apiDeleteVaultItem).mockRejectedValueOnce(new Error('socket hang up'));
    const r = await store.dispatch(deleteVaultItems({ vaultId: 'vault1', itemIds: ['i1'] }));
    const payload = (r as { payload: { failed: Array<{ error: string }> } }).payload;
    expect(payload.failed[0].error).toBe('item_delete_failed');
  });
});
