/**
 * rewrapStaleItems — RENDRE SON HISTOIRE À UN COFFRE QUI L'AVAIT PERDUE.
 *
 * LE DÉFAUT, VU EN PRODUCTION. Un coffre tourne de clé (époque 1 → 2) parce
 * qu'on retire quelqu'un ; ses éléments restent scellés sous l'époque 1 — le
 * re-key est PARESSEUX par conception. Une personne ajoutée APRÈS ne reçoit que
 * la clé de l'époque courante : elle lit « N éléments n'ont pas pu être
 * déchiffrés », et rien ne lève jamais cet état.
 *
 * CE QUE CETTE SUITE PROTÈGE, dans l'ordre de ce qui ferait le plus mal :
 *   · ON NE DEVINE JAMAIS UNE CLÉ QU'ON N'A PAS. Un élément dont l'époque ne
 *     s'ouvre pas ici est SAUTÉ et COMPTÉ, jamais envoyé : une enveloppe
 *     fabriquée sans la clé rendrait l'élément illisible pour TOUT LE MONDE —
 *     le défaut qu'on répare, rendu irréversible.
 *   · L'ENVELOPPE EST REFERMÉE AVEC LA CLÉ COURANTE, et l'époque déclarée au
 *     serveur est celle-là. Se tromper d'une époque grave un blob que plus
 *     personne n'ouvre.
 *   · K_item NE SURVIT PAS À SON USAGE (`.fill(0)`).
 *   · LES CLÉS D'ÉPOQUES ANCIENNES SE VONT CHERCHER (`ensureEpochKeys`), sans
 *     quoi le geste refuserait sur un coffre parfaitement déverrouillé.
 *   · UN CONFLIT DE VERSION SE REPREND, BORNÉ ; une ROTATION concurrente
 *     s'arrête et le dit, plutôt que de laisser croire à un succès.
 *
 *   npx vitest run src/store/slices/__tests__/rewrapStaleItems.vitest.ts
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { configureStore } from '@reduxjs/toolkit';

interface ItemDTO {
  id: string;
  vaultId: string;
  ownerUserId: string;
  itemType: string;
  wrappedItemKey: string;
  wrappedUnderEpoch: number;
  encryptedMeta: string;
  encryptedMetaIv: string;
  totalChunks: number;
  sizeBytes: number;
  status: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

const h = vi.hoisted(() => ({
  /** Les époques dont K_vault est réellement en cache sur cet appareil. */
  deverrouillees: new Set<number>(),
  /** L'historique servi par le serveur — ce qu'`ensureEpochKeys` va chercher. */
  wraps: [] as Array<{ epoch: number; wrappedVaultKey: string }>,
  /** Chaque lot parti au serveur, tel quel. */
  lots: [] as Array<{ wrappedUnderEpoch: number; items: Array<Record<string, unknown>> }>,
  /** Ce que le serveur répond, lot après lot. */
  reponses: [] as Array<{
    rewrapped: number;
    conflicts: Array<{ itemId: string; serverVersion: number }>;
  }>,
  /** Chaque K_item rendu par `unwrapItemKey` — pour vérifier l'effacement. */
  kItems: [] as Uint8Array[],
  listes: 0,
  echec: null as unknown,
}));

const itemDTO = (id: string, epoch: number, version: number): ItemDTO => ({
  id,
  vaultId: 'vault1',
  ownerUserId: 'me',
  itemType: 'note',
  wrappedItemKey: `WRAP_${id}`,
  wrappedUnderEpoch: epoch,
  encryptedMeta: 'M',
  encryptedMetaIv: 'IV',
  totalChunks: 0,
  sizeBytes: 0,
  status: 'ready',
  version,
  createdAt: '',
  updatedAt: '',
});

const h2 = vi.hoisted(() => ({ items: [] as unknown[] }));

vi.mock('../../../services/vault/vaultApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/vault/vaultApi')>();
  return {
    ...actual,
    apiListVaults: vi.fn(async () => []),
    apiListVaultItems: vi.fn(async () => {
      h.listes += 1;
      return h2.items;
    }),
    apiGetVaultKeyWraps: vi.fn(async () => h.wraps),
    apiRewrapVaultItems: vi.fn(
      async (
        _v: string,
        body: { wrappedUnderEpoch: number; items: Array<Record<string, unknown>> }
      ) => {
        h.lots.push(body);
        if (h.echec) throw h.echec;
        return h.reponses.shift() ?? { rewrapped: body.items.length, conflicts: [] };
      }
    ),
  };
});

/**
 * Un cache de clés qui DISTINGUE LES ÉPOQUES : la clé de l'époque N est
 * `Uint8Array([N, …])`. Un bouchon qui rendrait la même clé pour toutes ne
 * pourrait pas attraper la faute la plus grave — refermer sous la mauvaise.
 */
vi.mock('../../../services/vault/vaultKeyCache', () => ({
  getVaultKey: (_v: string, epoch: number) => {
    if (!h.deverrouillees.has(epoch)) return null;
    const k = new Uint8Array(32);
    k[0] = epoch;
    return k;
  },
  isVaultUnlocked: (_v: string, epoch?: number) =>
    epoch === undefined ? h.deverrouillees.size > 0 : h.deverrouillees.has(epoch),
  unlockVault: vi.fn(async (_v: string, epoch: number) => {
    h.deverrouillees.add(epoch);
  }),
  lockVault: vi.fn(),
  lockVaultEverywhere: vi.fn(),
  clearVaultKeys: vi.fn(),
}));

vi.mock('../../../services/vault/vaultCrypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/vault/vaultCrypto')>();
  return {
    ...actual,
    // K_item « déchiffré » depuis l'enveloppe : un tableau distinct par appel,
    // conservé pour vérifier qu'il a bien été effacé après usage.
    unwrapItemKey: vi.fn(async (wrapped: string) => {
      const k = new Uint8Array(32).fill(wrapped.length % 251 || 7);
      h.kItems.push(k);
      return k;
    }),
    // L'enveloppe rendue PORTE l'époque de la clé qui l'a refermée.
    wrapItemKey: vi.fn(async (_kItem: Uint8Array, kVault: Uint8Array) => `SEALED_${kVault[0]}`),
    decryptItemMeta: vi.fn(async () => ({ title: 'x' })),
  };
});

import vaultsReducer, {
  rewrapStaleItems,
  type VaultItemSummary,
  type VaultsState,
} from '../vaultsSlice';

function summary(id: string, epoch: number, version: number): VaultItemSummary {
  return {
    id,
    vaultId: 'vault1',
    ownerUserId: 'me',
    itemType: 'note',
    meta: { title: id },
    wrappedItemKey: `WRAP_${id}`,
    wrappedUnderEpoch: epoch,
    totalChunks: 0,
    sizeBytes: 0,
    status: 'ready',
    version,
    createdAt: '',
    updatedAt: '',
  } as VaultItemSummary;
}

function makeStore(items: VaultItemSummary[]) {
  const vaults: VaultsState = {
    vaults: {
      vault1: {
        id: 'vault1',
        organizationId: 'org1',
        ownerUserId: 'me',
        name: 'Coffre',
        currentKeyEpoch: 3,
        wrappedVaultKeyEpoch: 3,
        role: 'admin',
        createdAt: '',
      },
    },
    vaultIds: ['vault1'],
    itemsByVault: { vault1: items },
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
  } as unknown as VaultsState;
  return configureStore({
    reducer: { vaults: vaultsReducer },
    preloadedState: { vaults },
    middleware: (gdm) => gdm({ serializableCheck: false, immutableCheck: false }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  h.deverrouillees = new Set<number>([3]); // seule l'époque COURANTE est en cache
  h.wraps = [
    { epoch: 1, wrappedVaultKey: 'W1' },
    { epoch: 2, wrappedVaultKey: 'W2' },
  ];
  h.lots = [];
  h.reponses = [];
  h.kItems = [];
  h.listes = 0;
  h.echec = null;
  h2.items = [];
});

describe('rewrapStaleItems — ce qui part au serveur', () => {
  it('rescelle les éléments en retard, sous la clé COURANTE, avec leur version', async () => {
    const store = makeStore([summary('a', 1, 4), summary('b', 2, 9), summary('c', 3, 1)]);
    const r = await store.dispatch(rewrapStaleItems({ vaultId: 'vault1' }));

    expect(rewrapStaleItems.fulfilled.match(r)).toBe(true);
    expect(h.lots).toHaveLength(1);
    // L'époque DÉCLARÉE est la courante — le serveur la vérifie contre la sienne.
    expect(h.lots[0].wrappedUnderEpoch).toBe(3);
    // `c` est déjà à jour : il n'a rien à faire dans le lot.
    expect(h.lots[0].items).toEqual([
      { itemId: 'a', version: 4, wrappedItemKey: 'SEALED_3' },
      { itemId: 'b', version: 9, wrappedItemKey: 'SEALED_3' },
    ]);
    expect((r.payload as { rewrapped: number }).rewrapped).toBe(2);
  });

  it('va CHERCHER les clés des époques anciennes au lieu de refuser', async () => {
    // Rien d'ancien n'est en cache : sans `ensureEpochKeys`, tout serait sauté.
    const store = makeStore([summary('a', 1, 1)]);
    const r = await store.dispatch(rewrapStaleItems({ vaultId: 'vault1' }));
    expect(rewrapStaleItems.fulfilled.match(r)).toBe(true);
    expect(h.lots[0].items).toHaveLength(1);
  });

  it('K_item est EFFACÉ après usage — il ne reste pas en mémoire du renderer', async () => {
    const store = makeStore([summary('a', 1, 1), summary('b', 2, 1)]);
    await store.dispatch(rewrapStaleItems({ vaultId: 'vault1' }));
    expect(h.kItems).toHaveLength(2);
    for (const k of h.kItems) expect([...k].every((o) => o === 0)).toBe(true);
  });

  it('l’écran est rechargé à la fin : c’est l’état qui fait tomber le compteur', async () => {
    const store = makeStore([summary('a', 1, 1)]);
    await store.dispatch(rewrapStaleItems({ vaultId: 'vault1' }));
    expect(h.listes).toBeGreaterThanOrEqual(1);
  });

  it('un coffre déjà à jour n’envoie RIEN et ne recharge rien', async () => {
    const store = makeStore([summary('a', 3, 1)]);
    const r = await store.dispatch(rewrapStaleItems({ vaultId: 'vault1' }));
    expect(rewrapStaleItems.fulfilled.match(r)).toBe(true);
    expect(h.lots).toEqual([]);
    expect(h.listes).toBe(0);
  });
});

describe('rewrapStaleItems — ce qu’on saute plutôt que de le deviner', () => {
  it('une époque introuvable même dans l’historique : SAUTÉE et comptée, jamais envoyée', async () => {
    // Le serveur ne nous garde aucun wrap pour l'époque 1 : personne ne nous l'a
    // jamais scellée. Elle ne se devine pas.
    h.wraps = [{ epoch: 2, wrappedVaultKey: 'W2' }];
    const store = makeStore([summary('a', 1, 1), summary('b', 2, 1)]);
    const r = await store.dispatch(rewrapStaleItems({ vaultId: 'vault1' }));

    expect(rewrapStaleItems.fulfilled.match(r)).toBe(true);
    expect(h.lots[0].items.map((i) => i.itemId)).toEqual(['b']);
    const payload = r.payload as { skipped: number; skippedEpochs: number[] };
    expect(payload.skipped).toBe(1);
    expect(payload.skippedEpochs).toEqual([1]);
  });

  it('sans la clé COURANTE, rien n’est envoyé et le refus est nommé', async () => {
    h.deverrouillees = new Set<number>([1]);
    h.wraps = [];
    const store = makeStore([summary('a', 1, 1)]);
    const r = await store.dispatch(rewrapStaleItems({ vaultId: 'vault1' }));
    expect(rewrapStaleItems.rejected.match(r)).toBe(true);
    expect(r.payload).toBe('vault_locked');
    expect(h.lots).toEqual([]);
  });

  it('une enveloppe qui ne s’ouvre pas est COMPTÉE, pas remplacée à l’aveugle', async () => {
    const crypto = await import('../../../services/vault/vaultCrypto');
    vi.mocked(crypto.unwrapItemKey).mockRejectedValueOnce(new Error('tag mismatch'));
    const store = makeStore([summary('a', 1, 1), summary('b', 2, 1)]);
    const r = await store.dispatch(rewrapStaleItems({ vaultId: 'vault1' }));

    expect(rewrapStaleItems.fulfilled.match(r)).toBe(true);
    expect((r.payload as { unreadable: number }).unreadable).toBe(1);
    expect(h.lots[0].items.map((i) => i.itemId)).toEqual(['b']);
  });
});

describe('rewrapStaleItems — les lots et les reprises', () => {
  it('découpe au plafond du serveur (200) et suit l’avancement', async () => {
    const items = Array.from({ length: 201 }, (_, i) => summary(`i${i}`, 1, 1));
    // Après le rechargement de fin, la liste revient vide : le tour suivant
    // n'aurait rien à faire de toute façon.
    const store = makeStore(items);
    await store.dispatch(rewrapStaleItems({ vaultId: 'vault1' }));

    expect(h.lots.map((l) => l.items.length)).toEqual([200, 1]);
    // L'avancement est effacé à la fin : une barre figée raconterait un travail
    // qui dure encore.
    expect(store.getState().vaults.rewrapProgress.vault1).toBeUndefined();
  });

  it('un conflit de version fait UN tour de plus, puis s’arrête', async () => {
    h.reponses = [
      { rewrapped: 0, conflicts: [{ itemId: 'a', serverVersion: 5 }] },
      { rewrapped: 1, conflicts: [] },
    ];
    // Le rechargement rend l'élément à sa VRAIE version : le tour suivant
    // repropose la bonne.
    h2.items = [itemDTO('a', 1, 5)];
    const store = makeStore([summary('a', 1, 4)]);
    const r = await store.dispatch(rewrapStaleItems({ vaultId: 'vault1' }));

    expect(rewrapStaleItems.fulfilled.match(r)).toBe(true);
    expect(h.lots).toHaveLength(2);
    expect(h.lots[0].items[0]).toMatchObject({ version: 4 });
    expect(h.lots[1].items[0]).toMatchObject({ version: 5 });
    expect((r.payload as { conflictsLeft: number }).conflictsLeft).toBe(0);
  });

  it('une ROTATION concurrente s’arrête et le dit — jamais un faux succès', async () => {
    h.echec = { response: { status: 409, data: { code: 'vault_epoch_conflict' } } };
    const store = makeStore([summary('a', 1, 1)]);
    const r = await store.dispatch(rewrapStaleItems({ vaultId: 'vault1' }));
    expect(rewrapStaleItems.rejected.match(r)).toBe(true);
    expect(r.payload).toBe('vault_epoch_conflict');
  });
});
