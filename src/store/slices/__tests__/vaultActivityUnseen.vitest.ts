/**
 * La pastille « activité nouvelle » des cartes de l'accueil (lot A, C4) :
 * `loadVaultActivityHeads` (têtes, catch silencieux), `vaultActivitySeen`
 * (le compteur qui réveille) et `selectUnseenVaultIds` (mémoïsé).
 *
 * L'invariant dur : le curseur « vu » vit dans localStorage, que Redux ne voit
 * pas. Le sélecteur DOIT donc rendre la même référence tant que rien n'a
 * bougé — et se recalculer dès que `vaultActivitySeen` a été dispatché, sans
 * quoi une pastille resterait allumée sur un fil déjà lu.
 *
 *   npx vitest run src/store/slices/__tests__/vaultActivityUnseen.vitest.ts
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { configureStore } from '@reduxjs/toolkit';

// Un localStorage de nœud nu : `getSeenCursor` / `setSeenCursor` le lisent
// derrière un try/catch, donc sans ce bouchon tout serait « jamais vu ».
const bucket = new Map<string, string>();
(globalThis as unknown as { localStorage: unknown }).localStorage = {
  getItem: (k: string) => bucket.get(k) ?? null,
  setItem: (k: string, v: string) => {
    bucket.set(k, v);
  },
  removeItem: (k: string) => {
    bucket.delete(k);
  },
};

vi.mock('../../../services/vault/vaultApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/vault/vaultApi')>();
  return {
    ...actual,
    apiGetVaultActivityHeads: vi.fn(async () => ({ recorded: true, heads: [] })),
  };
});

import * as vaultApi from '../../../services/vault/vaultApi';
import vaultsReducer, {
  loadVaultActivityHeads,
  vaultActivitySeen,
  selectUnseenVaultIds,
} from '../vaultsSlice';
import { setSeenCursor } from '../../../renderer/components/vaults/vaultActivitySeen';

function makeStore(userId: string | null = 'me') {
  return configureStore({
    reducer: {
      vaults: vaultsReducer,
      auth: () => ({ cloudUser: userId ? { id: userId } : null }),
    },
  });
}

const heads = [
  { vaultId: 'v1', occurredAt: 1_000, id: 10 },
  { vaultId: 'v2', occurredAt: 2_000, id: 20 },
];

beforeEach(() => {
  vi.clearAllMocks();
  bucket.clear();
});

describe('loadVaultActivityHeads', () => {
  it('range les têtes ; un échec réseau GARDE les têtes précédentes', async () => {
    vi.mocked(vaultApi.apiGetVaultActivityHeads).mockResolvedValueOnce({
      recorded: true,
      heads,
    });
    const store = makeStore();
    await store.dispatch(loadVaultActivityHeads());
    expect(store.getState().vaults.activityHeads).toEqual(heads);

    vi.mocked(vaultApi.apiGetVaultActivityHeads).mockRejectedValueOnce(new Error('offline'));
    const r = await store.dispatch(loadVaultActivityHeads());
    // Catch silencieux : jamais de `rejected`, et les pastilles justes restent.
    expect(loadVaultActivityHeads.fulfilled.match(r)).toBe(true);
    expect(store.getState().vaults.activityHeads).toEqual(heads);
  });
});

describe('selectUnseenVaultIds', () => {
  it('sans curseur, chaque tête est neuve ; sans utilisateur, rien ne l’est', async () => {
    vi.mocked(vaultApi.apiGetVaultActivityHeads).mockResolvedValueOnce({
      recorded: true,
      heads,
    });
    const store = makeStore();
    await store.dispatch(loadVaultActivityHeads());
    expect([...selectUnseenVaultIds(store.getState())].sort()).toEqual(['v1', 'v2']);

    const anonymous = makeStore(null);
    await anonymous.dispatch(loadVaultActivityHeads());
    expect(selectUnseenVaultIds(anonymous.getState()).size).toBe(0);
  });

  it('rend la MÊME référence tant que rien n’a bougé (les cartes mémoïsées en dépendent)', async () => {
    vi.mocked(vaultApi.apiGetVaultActivityHeads).mockResolvedValueOnce({
      recorded: true,
      heads,
    });
    const store = makeStore();
    await store.dispatch(loadVaultActivityHeads());
    const a = selectUnseenVaultIds(store.getState());
    const b = selectUnseenVaultIds(store.getState());
    expect(b).toBe(a);
  });

  it('le curseur écrit en localStorage ne compte qu’une fois `vaultActivitySeen` réveille le cache', async () => {
    vi.mocked(vaultApi.apiGetVaultActivityHeads).mockResolvedValueOnce({
      recorded: true,
      heads,
    });
    const store = makeStore();
    await store.dispatch(loadVaultActivityHeads());
    const before = selectUnseenVaultIds(store.getState());
    expect(before.has('v1')).toBe(true);

    // La lecture du fil : le curseur avance HORS de Redux…
    setSeenCursor('me', 'v1', { occurredAt: 1_000, id: 10 });
    // …et le sélecteur, mémoïsé, ne peut pas le savoir tout seul.
    expect(selectUnseenVaultIds(store.getState())).toBe(before);

    store.dispatch(vaultActivitySeen('v1'));
    const after = selectUnseenVaultIds(store.getState());
    expect(after).not.toBe(before);
    expect(after.has('v1')).toBe(false);
    expect(after.has('v2')).toBe(true);
  });

  it('le couple (occurredAt, id) départage deux évènements à la même milliseconde', async () => {
    vi.mocked(vaultApi.apiGetVaultActivityHeads).mockResolvedValueOnce({
      recorded: true,
      heads: [{ vaultId: 'v1', occurredAt: 1_000, id: 11 }],
    });
    const store = makeStore();
    setSeenCursor('me', 'v1', { occurredAt: 1_000, id: 10 });
    await store.dispatch(loadVaultActivityHeads());
    expect(selectUnseenVaultIds(store.getState()).has('v1')).toBe(true);
  });

  it('le curseur est indexé par UTILISATEUR : celui d’un autre compte ne compte pas', async () => {
    vi.mocked(vaultApi.apiGetVaultActivityHeads).mockResolvedValueOnce({
      recorded: true,
      heads,
    });
    setSeenCursor('someone-else', 'v1', { occurredAt: 9_999, id: 99 });
    const store = makeStore('me');
    await store.dispatch(loadVaultActivityHeads());
    expect(selectUnseenVaultIds(store.getState()).has('v1')).toBe(true);
  });
});
