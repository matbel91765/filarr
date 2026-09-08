/**
 * shareIndex — le cache d'agrégats de partage, éprouvé sur ses quatre
 * promesses :
 *
 *   · AUCUN appel hors nuage : la `condition` bloque même le `pending`.
 *   · UNE requête par coffre par minute : TTL sur `summaryLoadedAt`, et dédup
 *     en vol pour deux dispatchs dans le même tick.
 *   · Invalidation CROISÉE par les actions de vaultsSlice, dispatchées ici
 *     FABRIQUÉES avec leurs types en dur — c'est précisément ce que la slice
 *     écoute, sans importer vaultsSlice (ni sa crypto, ni son HTTP).
 *   · Sélecteurs mémoïsés : la Map d'un coffre garde sa référence tant que rien
 *     n'a bougé, et n'est recalculée que quand ça bouge.
 *
 * Les API sont bouchonnées EN BLOC (pas d'importOriginal) : la slice n'a
 * besoin que des deux clients d'agrégat, et charger le vrai module tirerait
 * axios pour rien.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { configureStore } from '@reduxjs/toolkit';

const heads = vi.fn<() => Promise<Array<{ vaultId: string; memberCount: number }> | null>>();
const summary =
  vi.fn<
    (
      vaultId: string
    ) => Promise<{ memberCount: number; grants: Array<{ itemId: string; count: number }> } | null>
  >();

vi.mock('../../../services/vault/vaultApi', () => ({
  apiGetVaultShareHeads: (...a: []) => heads(...a),
  apiGetVaultShareSummary: (vaultId: string) => summary(vaultId),
}));

import shareIndexReducer, {
  loadShareHeads,
  loadVaultShareSummary,
  invalidateVaultShareSummary,
  grantCountKey,
  SHARE_SUMMARY_TTL_MS,
} from '../shareIndexSlice';
import {
  selectVaultMemberCount,
  selectGrantCountMap,
  selectShareIndexReady,
  selectVaultSummaryLoaded,
} from '../../selectors/shareIndexSelectors';

function makeStore(accountMode: 'cloud' | 'local' = 'cloud') {
  return configureStore({
    reducer: {
      shareIndex: shareIndexReducer,
      auth: () => ({ accountMode }),
    },
  });
}

/** Une action de vaultsSlice, fabriquée avec son type EN DUR. */
const fabricated = (type: string, payload?: unknown) => ({ type, payload });

/** Deux promesses qu'on tient en main pour observer la dédup. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

beforeEach(() => {
  heads.mockReset();
  summary.mockReset();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-08-27T10:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('loadShareHeads', () => {
  it('écrit les effectifs et date les têtes', async () => {
    const store = makeStore();
    heads.mockResolvedValue([
      { vaultId: 'v1', memberCount: 3 },
      { vaultId: 'v2', memberCount: 1 },
    ]);
    expect(selectShareIndexReady(store.getState())).toBe(false);
    await store.dispatch(loadShareHeads());
    expect(heads).toHaveBeenCalledTimes(1);
    expect(selectVaultMemberCount(store.getState(), 'v1')).toBe(3);
    expect(selectVaultMemberCount(store.getState(), 'v2')).toBe(1);
    expect(selectShareIndexReady(store.getState())).toBe(true);
    expect(store.getState().shareIndex.headsLoadedAt).toBe(Date.now());
  });

  it('no-op hors nuage : aucun appel, aucune action dans le store', async () => {
    const store = makeStore('local');
    const r = await store.dispatch(loadShareHeads());
    expect(heads).not.toHaveBeenCalled();
    // La condition refuse : rien n'a été écrit, l'état est resté initial.
    expect(loadShareHeads.fulfilled.match(r)).toBe(false);
    expect(store.getState().shareIndex.headsLoadedAt).toBeNull();
  });

  it('null (agrégat illisible) : ne touche à rien, ne plante pas', async () => {
    const store = makeStore();
    heads.mockResolvedValue([{ vaultId: 'v1', memberCount: 2 }]);
    await store.dispatch(loadShareHeads());
    heads.mockResolvedValue(null);
    await store.dispatch(loadShareHeads());
    expect(selectVaultMemberCount(store.getState(), 'v1')).toBe(2);
  });
});

describe('loadVaultShareSummary', () => {
  it('écrit effectif + grants (zéro par absence) et date le coffre', async () => {
    const store = makeStore();
    summary.mockResolvedValue({
      memberCount: 4,
      grants: [
        { itemId: 'i1', count: 2 },
        { itemId: 'i2', count: 0 },
      ],
    });
    await store.dispatch(loadVaultShareSummary('v1'));
    expect(summary).toHaveBeenCalledWith('v1');
    const s = store.getState();
    expect(selectVaultMemberCount(s, 'v1')).toBe(4);
    expect(s.shareIndex.grantCountByItem).toEqual({ [grantCountKey('v1', 'i1')]: 2 });
    expect(selectVaultSummaryLoaded(s, 'v1')).toBe(true);
    expect(s.shareIndex.summaryLoadedAt.v1).toBe(Date.now());
  });

  it('TTL : pas de second appel avant 60 s, un seul après', async () => {
    const store = makeStore();
    summary.mockResolvedValue({ memberCount: 1, grants: [] });
    await store.dispatch(loadVaultShareSummary('v1'));
    vi.advanceTimersByTime(SHARE_SUMMARY_TTL_MS - 1);
    await store.dispatch(loadVaultShareSummary('v1'));
    expect(summary).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    await store.dispatch(loadVaultShareSummary('v1'));
    expect(summary).toHaveBeenCalledTimes(2);
  });

  it('le TTL est PAR coffre', async () => {
    const store = makeStore();
    summary.mockResolvedValue({ memberCount: 1, grants: [] });
    await store.dispatch(loadVaultShareSummary('v1'));
    await store.dispatch(loadVaultShareSummary('v2'));
    expect(summary).toHaveBeenCalledTimes(2);
  });

  it('dédup en vol : deux dispatchs dans le même tick = une requête', async () => {
    const store = makeStore();
    const d = deferred<{ memberCount: number; grants: [] }>();
    summary.mockReturnValue(d.promise);
    const p1 = store.dispatch(loadVaultShareSummary('v1'));
    const p2 = store.dispatch(loadVaultShareSummary('v1'));
    expect(summary).toHaveBeenCalledTimes(1);
    d.resolve({ memberCount: 7, grants: [] });
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(loadVaultShareSummary.fulfilled.match(r1)).toBe(true);
    expect(loadVaultShareSummary.fulfilled.match(r2)).toBe(true);
    expect(selectVaultMemberCount(store.getState(), 'v1')).toBe(7);
    // La carte est vidée : hors TTL, la demande suivante repart au réseau.
    vi.advanceTimersByTime(SHARE_SUMMARY_TTL_MS);
    summary.mockResolvedValue({ memberCount: 8, grants: [] });
    await store.dispatch(loadVaultShareSummary('v1'));
    expect(summary).toHaveBeenCalledTimes(2);
    expect(selectVaultMemberCount(store.getState(), 'v1')).toBe(8);
  });

  it('null : rien écrit, pas daté → la relance suivante réessaie', async () => {
    const store = makeStore();
    summary.mockResolvedValue(null);
    await store.dispatch(loadVaultShareSummary('v1'));
    expect(selectVaultSummaryLoaded(store.getState(), 'v1')).toBe(false);
    expect(selectVaultMemberCount(store.getState(), 'v1')).toBeUndefined();
    summary.mockResolvedValue({ memberCount: 2, grants: [] });
    await store.dispatch(loadVaultShareSummary('v1'));
    expect(summary).toHaveBeenCalledTimes(2);
    expect(selectVaultMemberCount(store.getState(), 'v1')).toBe(2);
  });

  it('no-op hors nuage', async () => {
    const store = makeStore('local');
    await store.dispatch(loadVaultShareSummary('v1'));
    expect(summary).not.toHaveBeenCalled();
    expect(store.getState().shareIndex).toEqual({
      memberCountByVault: {},
      grantCountByItem: {},
      summaryLoadedAt: {},
      headsLoadedAt: null,
    });
  });

  it('un rechargement repart de zéro sur le préfixe du coffre', async () => {
    const store = makeStore();
    summary.mockResolvedValue({
      memberCount: 1,
      grants: [
        { itemId: 'i1', count: 1 },
        { itemId: 'i2', count: 1 },
      ],
    });
    await store.dispatch(loadVaultShareSummary('v1'));
    vi.advanceTimersByTime(SHARE_SUMMARY_TTL_MS);
    // i2 a été révoqué ailleurs : le serveur ne le renvoie plus.
    summary.mockResolvedValue({ memberCount: 1, grants: [{ itemId: 'i1', count: 1 }] });
    await store.dispatch(loadVaultShareSummary('v1'));
    expect([...selectGrantCountMap(store.getState(), 'v1').keys()]).toEqual(['i1']);
  });
});

describe('invalidations croisées (types en dur de vaultsSlice / authSlice)', () => {
  it('createItemGrant.fulfilled → +1 sur la clé (depuis l’absence aussi)', () => {
    const store = makeStore();
    store.dispatch(fabricated('vaults/createItemGrant/fulfilled', { vaultId: 'v1', itemId: 'i1' }));
    store.dispatch(fabricated('vaults/createItemGrant/fulfilled', { vaultId: 'v1', itemId: 'i1' }));
    expect(store.getState().shareIndex.grantCountByItem).toEqual({ 'v1:i1': 2 });
  });

  it('revokeItemGrant.fulfilled → remainingGrants du serveur quand il est là', () => {
    const store = makeStore();
    for (let i = 0; i < 3; i++) {
      store.dispatch(
        fabricated('vaults/createItemGrant/fulfilled', { vaultId: 'v1', itemId: 'i1' })
      );
    }
    store.dispatch(
      fabricated('vaults/revokeItemGrant/fulfilled', {
        vaultId: 'v1',
        itemId: 'i1',
        grantId: 'g',
        remainingGrants: 1,
      })
    );
    expect(store.getState().shareIndex.grantCountByItem).toEqual({ 'v1:i1': 1 });
  });

  it('revokeItemGrant.fulfilled sans remainingGrants → −1 plancher 0, clé retirée à zéro', () => {
    const store = makeStore();
    store.dispatch(fabricated('vaults/createItemGrant/fulfilled', { vaultId: 'v1', itemId: 'i1' }));
    store.dispatch(
      fabricated('vaults/revokeItemGrant/fulfilled', { vaultId: 'v1', itemId: 'i1', grantId: 'g' })
    );
    expect(store.getState().shareIndex.grantCountByItem).toEqual({});
    // Plancher : révoquer un élément déjà à zéro ne crée pas de négatif.
    store.dispatch(
      fabricated('vaults/revokeItemGrant/fulfilled', { vaultId: 'v1', itemId: 'i1', grantId: 'g' })
    );
    expect(store.getState().shareIndex.grantCountByItem).toEqual({});
  });

  it('inviteMember / removeMember .fulfilled → périme le coffre, garde l’effectif affiché', async () => {
    const store = makeStore();
    summary.mockResolvedValue({ memberCount: 2, grants: [] });
    await store.dispatch(loadVaultShareSummary('v1'));
    store.dispatch(fabricated('vaults/invite/fulfilled', { vaultId: 'v1', inviteeEmail: 'a@b' }));
    expect(selectVaultSummaryLoaded(store.getState(), 'v1')).toBe(false);
    expect(selectVaultMemberCount(store.getState(), 'v1')).toBe(2);
    // Périmé = la prochaine demande repart au réseau, TTL ou pas.
    summary.mockResolvedValue({ memberCount: 3, grants: [] });
    await store.dispatch(loadVaultShareSummary('v1'));
    expect(summary).toHaveBeenCalledTimes(2);
    expect(selectVaultMemberCount(store.getState(), 'v1')).toBe(3);

    store.dispatch(
      fabricated('vaults/removeMember/fulfilled', { vaultId: 'v1', removedUserId: 'u' })
    );
    expect(selectVaultSummaryLoaded(store.getState(), 'v1')).toBe(false);
    expect(selectVaultMemberCount(store.getState(), 'v1')).toBe(3);
  });

  it('leaveVault.fulfilled → purge tout ce que l’on savait de CE coffre seulement', async () => {
    const store = makeStore();
    summary.mockResolvedValue({ memberCount: 2, grants: [{ itemId: 'i1', count: 1 }] });
    await store.dispatch(loadVaultShareSummary('v1'));
    await store.dispatch(loadVaultShareSummary('v2'));
    store.dispatch(fabricated('vaults/leave/fulfilled', { vaultId: 'v1' }));
    const s = store.getState();
    expect(selectVaultMemberCount(s, 'v1')).toBeUndefined();
    expect(selectVaultSummaryLoaded(s, 'v1')).toBe(false);
    expect(selectGrantCountMap(s, 'v1').size).toBe(0);
    expect(selectVaultMemberCount(s, 'v2')).toBe(2);
    expect(selectGrantCountMap(s, 'v2').get('i1')).toBe(1);
  });

  it('clearCloudAuth → état initial', async () => {
    const store = makeStore();
    heads.mockResolvedValue([{ vaultId: 'v1', memberCount: 2 }]);
    summary.mockResolvedValue({ memberCount: 2, grants: [{ itemId: 'i1', count: 1 }] });
    await store.dispatch(loadShareHeads());
    await store.dispatch(loadVaultShareSummary('v1'));
    store.dispatch(fabricated('auth/clearCloudAuth'));
    expect(store.getState().shareIndex).toEqual({
      memberCountByVault: {},
      grantCountByItem: {},
      summaryLoadedAt: {},
      headsLoadedAt: null,
    });
  });

  it('loadVaultItems.fulfilled → RIEN (même référence d’état)', () => {
    const store = makeStore();
    store.dispatch(fabricated('vaults/createItemGrant/fulfilled', { vaultId: 'v1', itemId: 'i1' }));
    const before = store.getState().shareIndex;
    store.dispatch(fabricated('vaults/loadItems/fulfilled', { vaultId: 'v1', items: [] }));
    expect(store.getState().shareIndex).toBe(before);
  });

  it('invalidateVaultShareSummary (geste explicite) → périme sans effacer', async () => {
    const store = makeStore();
    summary.mockResolvedValue({ memberCount: 5, grants: [] });
    await store.dispatch(loadVaultShareSummary('v1'));
    store.dispatch(invalidateVaultShareSummary('v1'));
    expect(selectVaultSummaryLoaded(store.getState(), 'v1')).toBe(false);
    expect(selectVaultMemberCount(store.getState(), 'v1')).toBe(5);
  });
});

describe('sélecteurs mémoïsés', () => {
  it('selectGrantCountMap : même référence tant que rien ne bouge, nouvelle quand ça bouge', async () => {
    const store = makeStore();
    summary.mockResolvedValue({
      memberCount: 1,
      grants: [
        { itemId: 'i1', count: 2 },
        { itemId: 'i2', count: 1 },
      ],
    });
    await store.dispatch(loadVaultShareSummary('v1'));
    const a = selectGrantCountMap(store.getState(), 'v1');
    expect(a).toEqual(
      new Map([
        ['i1', 2],
        ['i2', 1],
      ])
    );
    // Une action qui n'écrit pas dans grantCountByItem ne recrée pas la Map.
    store.dispatch(fabricated('vaults/invite/fulfilled', { vaultId: 'v1', inviteeEmail: 'x' }));
    expect(selectGrantCountMap(store.getState(), 'v1')).toBe(a);
    // Un grant de plus : nouvelle Map, contenu à jour.
    store.dispatch(fabricated('vaults/createItemGrant/fulfilled', { vaultId: 'v1', itemId: 'i3' }));
    const b = selectGrantCountMap(store.getState(), 'v1');
    expect(b).not.toBe(a);
    expect(b.get('i3')).toBe(1);
  });

  it('selectGrantCountMap ne mélange pas les coffres (préfixe strict)', () => {
    const store = makeStore();
    store.dispatch(fabricated('vaults/createItemGrant/fulfilled', { vaultId: 'v1', itemId: 'i1' }));
    store.dispatch(
      fabricated('vaults/createItemGrant/fulfilled', { vaultId: 'v10', itemId: 'i1' })
    );
    expect([...selectGrantCountMap(store.getState(), 'v1').keys()]).toEqual(['i1']);
    expect(selectGrantCountMap(store.getState(), 'v1').size).toBe(1);
  });

  it('selectShareIndexReady ne bascule qu’avec des têtes reçues', async () => {
    const store = makeStore();
    summary.mockResolvedValue({ memberCount: 1, grants: [] });
    await store.dispatch(loadVaultShareSummary('v1'));
    expect(selectShareIndexReady(store.getState())).toBe(false);
    heads.mockResolvedValue(null);
    await store.dispatch(loadShareHeads());
    expect(selectShareIndexReady(store.getState())).toBe(false);
    heads.mockResolvedValue([]);
    await store.dispatch(loadShareHeads());
    expect(selectShareIndexReady(store.getState())).toBe(true);
  });
});
