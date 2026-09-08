/**
 * moveVaultItems — la boucle N-PATCH des dossiers, sous vrai WebCrypto.
 *
 * Quatre propriétés, dans l'ordre où elles saigneraient :
 *   · CHIFFREMENT — ce qui part au serveur ne contient NI le chemin NI un nom
 *     de dossier en clair, et se déchiffre vers la méta attendue avec K_item ;
 *   · ÉCHEC SYSTÉMIQUE — un refus qui condamne tout le lot (espace gelé…)
 *     BREAK : l'élément suivant n'est jamais tenté, le rapport est structuré
 *     {applied, failed} en FULFILLED (jamais rejected pour un partiel) ;
 *   · 409 LOCAL — un conflit de version sur UN élément n'arrête pas les
 *     autres, et la liste est rechargée à la fin ;
 *   · REPRISE — replanifier depuis l'état post-échec ne produit que le reste.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { configureStore } from '@reduxjs/toolkit';

const K_VAULT = new Uint8Array(32).fill(7);

// ── Stubs réseau ─────────────────────────────────────────────────────────────

type RenameCall = {
  itemId: string;
  body: { expectedVersion: number; encryptedMeta: string; encryptedMetaIv: string };
};
const renameCalls: RenameCall[] = [];
/** Comportement par élément : ok (écho) | conflit 409 | code systémique. */
let behaviourById: Record<string, 'ok' | 'conflict' | string> = {};
let listCalls = 0;

vi.mock('../../../services/vault/vaultApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/vault/vaultApi')>();
  return {
    ...actual,
    apiRenameVaultItem: vi.fn(
      async (
        _vaultId: string,
        itemId: string,
        body: { expectedVersion: number; encryptedMeta: string; encryptedMetaIv: string }
      ) => {
        renameCalls.push({ itemId, body });
        const behaviour = behaviourById[itemId] ?? 'ok';
        if (behaviour === 'conflict') {
          throw new actual.VaultItemVersionConflictError(99, null);
        }
        if (behaviour !== 'ok') throw new Error(behaviour);
        // Écho serveur : mêmes blobs opaques, version bumpée.
        const item = fixtures.find((f) => f.summary.id === itemId)!;
        return {
          id: itemId,
          vaultId: 'vault1',
          ownerUserId: 'me',
          itemType: 'note',
          wrappedItemKey: item.summary.wrappedItemKey,
          wrappedUnderEpoch: 2,
          encryptedMeta: body.encryptedMeta,
          encryptedMetaIv: body.encryptedMetaIv,
          totalChunks: 0,
          sizeBytes: 0,
          status: 'ready',
          version: body.expectedVersion + 1,
          createdAt: '',
          updatedAt: '',
        };
      }
    ),
    apiListVaultItems: vi.fn(async () => {
      listCalls++;
      return [];
    }),
    apiGetVaultKeyWraps: vi.fn(async () => []),
  };
});

vi.mock('../../../services/vault/vaultKeyCache', () => ({
  getVaultKey: (_vaultId: string, epoch: number) => (epoch === 2 ? K_VAULT : null),
  unlockVault: vi.fn(),
  isVaultUnlocked: () => true,
  lockVault: vi.fn(),
  lockVaultEverywhere: vi.fn(),
}));

vi.mock('../../../services/auth/userKeypair', () => ({
  hasUserKeypair: () => false,
  getOwnPublicKey: vi.fn(),
  sealToPublicKey: vi.fn(),
  openSealed: vi.fn(),
  verifyKeypairIntegrity: vi.fn(),
  isKeyAlgoSupported: () => true,
}));

import vaultsReducer, {
  moveVaultItems,
  type VaultsState,
  type VaultItemSummary,
  type VaultItemMeta,
} from '../vaultsSlice';
import * as vaultApi from '../../../services/vault/vaultApi';
import {
  generateItemKey,
  wrapItemKey,
  unwrapItemKey,
  decryptItemMeta,
} from '../../../services/vault/vaultCrypto';
import { planFolderRename } from '../../../services/vault/vaultPaths';

// ── Fixtures : de VRAIS scellés, pour que la boucle déchiffre vraiment ───────

let fixtures: Array<{ summary: VaultItemSummary; kItem: Uint8Array }> = [];

async function makeItem(
  id: string,
  meta: VaultItemMeta,
  epoch = 2
): Promise<{ summary: VaultItemSummary; kItem: Uint8Array }> {
  const kItem = generateItemKey();
  const wrappedItemKey = await wrapItemKey(kItem, K_VAULT);
  return {
    kItem,
    summary: {
      id,
      vaultId: 'vault1',
      ownerUserId: 'me',
      itemType: 'note',
      meta,
      wrappedItemKey,
      wrappedUnderEpoch: epoch,
      totalChunks: 0,
      sizeBytes: 0,
      status: 'ready',
      version: 5,
      createdAt: '',
      updatedAt: '',
    },
  };
}

function makeStore() {
  const vaults: VaultsState = {
    vaults: {
      vault1: {
        id: 'vault1',
        organizationId: 'org1',
        ownerUserId: 'me',
        name: 'Design',
        currentKeyEpoch: 2,
        wrappedVaultKeyEpoch: 2,
        role: 'member',
        createdAt: '',
      },
    },
    vaultIds: ['vault1'],
    itemsByVault: { vault1: fixtures.map((f) => f.summary) },
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

beforeEach(async () => {
  vi.clearAllMocks();
  renameCalls.length = 0;
  behaviourById = {};
  listCalls = 0;
  fixtures = [
    await makeItem('i1', { title: 'un', path: 'Contrats' }),
    await makeItem('i2', { title: 'deux', path: 'Contrats/2026' }),
    await makeItem('i3', { title: 'trois', path: 'Contrats' }),
  ];
});

const movesFor = (renamed: string) =>
  planFolderRename(
    fixtures.map((f) => ({ id: f.summary.id, meta: f.summary.meta })),
    'Contrats',
    renamed
  ) as Array<{ itemId: string; meta: VaultItemMeta }>;

describe('moveVaultItems — chiffrement', () => {
  it('rien du chemin ne part en clair, et la méta chiffrée se déchiffre vers le plan', async () => {
    const store = makeStore();
    const res = await store.dispatch(
      moveVaultItems({ vaultId: 'vault1', moves: movesFor('Archives') })
    );
    expect(moveVaultItems.fulfilled.match(res)).toBe(true);
    const payload = (res as { payload: { applied: unknown[]; failed: unknown[] } }).payload;
    expect(payload.failed).toEqual([]);
    expect(renameCalls).toHaveLength(3);

    for (const call of renameCalls) {
      const brut = JSON.stringify(call.body);
      expect(brut).not.toContain('Contrats');
      expect(brut).not.toContain('Archives');
      // Et le scellé se rouvre vers la méta PLANIFIÉE, avec le K_item de CET item.
      const fixture = fixtures.find((f) => f.summary.id === call.itemId)!;
      const meta = (await decryptItemMeta(
        call.body.encryptedMeta,
        call.body.encryptedMetaIv,
        fixture.kItem
      )) as VaultItemMeta;
      expect(meta.path).toMatch(/^Archives(\/|$)/);
    }
    // Aucun échec → pas de rechargement (rien n'a divergé).
    expect(listCalls).toBe(0);
    // Le store a appliqué les trois nouvelles versions.
    const items = store.getState().vaults.itemsByVault.vault1;
    expect(items.every((i) => i.version === 6)).toBe(true);
    expect(items.map((i) => i.meta.path).sort()).toEqual(['Archives', 'Archives', 'Archives/2026']);
  });

  it('la clé utilisée est celle de l’ÉPOQUE de l’item — une époque morte échoue LOCALEMENT', async () => {
    fixtures[1] = await makeItem('i2', { title: 'deux', path: 'Contrats/2026' }, 1); // époque 1 : getVaultKey → null
    const store = makeStore();
    const res = await store.dispatch(
      moveVaultItems({ vaultId: 'vault1', moves: movesFor('Archives') })
    );
    const payload = (
      res as { payload: { applied: unknown[]; failed: Array<{ itemId: string; error: string }> } }
    ).payload;
    expect(payload.failed).toEqual([{ itemId: 'i2', error: 'vault_locked' }]);
    // La boucle a CONTINUÉ : i1 et i3 sont passés.
    expect(renameCalls.map((c) => c.itemId).sort()).toEqual(['i1', 'i3']);
  });
});

describe('moveVaultItems — échec partiel structuré', () => {
  it('un refus SYSTÉMIQUE break : l’élément suivant n’est jamais tenté', async () => {
    behaviourById = { i2: 'org_read_only' };
    const store = makeStore();
    const res = await store.dispatch(
      moveVaultItems({ vaultId: 'vault1', moves: movesFor('Archives') })
    );
    expect(moveVaultItems.fulfilled.match(res)).toBe(true);
    const payload = (
      res as {
        payload: {
          applied: Array<{ id: string }>;
          failed: Array<{ itemId: string; error: string }>;
        };
      }
    ).payload;
    expect(payload.applied.map((a) => a.id)).toEqual(['i1']);
    expect(payload.failed).toEqual([{ itemId: 'i2', error: 'org_read_only' }]);
    // BREAK confirmé : i3 jamais tenté.
    expect(renameCalls.map((c) => c.itemId)).toEqual(['i1', 'i2']);
    // L'état serveur a divergé → rechargé.
    expect(listCalls).toBeGreaterThan(0);
  });

  it('un 409 est LOCAL : la boucle continue, la liste est rechargée', async () => {
    behaviourById = { i1: 'conflict' };
    const store = makeStore();
    const res = await store.dispatch(
      moveVaultItems({ vaultId: 'vault1', moves: movesFor('Archives') })
    );
    const payload = (
      res as {
        payload: {
          applied: Array<{ id: string }>;
          failed: Array<{ itemId: string; error: string }>;
        };
      }
    ).payload;
    expect(payload.failed).toEqual([{ itemId: 'i1', error: 'item_version_conflict' }]);
    expect(payload.applied.map((a) => a.id).sort()).toEqual(['i2', 'i3']);
    expect(renameCalls).toHaveLength(3);
    expect(listCalls).toBeGreaterThan(0);
    expect(vi.mocked(vaultApi.apiListVaultItems)).toHaveBeenCalled();
  });
});

describe('moveVaultItems — reprise', () => {
  it('replanifier depuis l’état partiel ne produit que le reste', async () => {
    // Premier passage : i2 échoue en systémique (break après i1).
    behaviourById = { i2: 'org_read_only' };
    const store = makeStore();
    await store.dispatch(moveVaultItems({ vaultId: 'vault1', moves: movesFor('Archives') }));

    // L'état « post-reload » : i1 déplacé, i2 et i3 encore sous l'ancien préfixe.
    const after = fixtures.map((f) =>
      f.summary.id === 'i1'
        ? { id: f.summary.id, meta: { ...f.summary.meta, path: 'Archives' } }
        : { id: f.summary.id, meta: f.summary.meta }
    );
    const resume = planFolderRename(after, 'Contrats', 'Archives');
    expect(resume.map((m) => m.itemId).sort()).toEqual(['i2', 'i3']);
  });
});
