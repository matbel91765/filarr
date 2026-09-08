/**
 * updateVaultItem (E3-12) — the client half of "vault notes are editable".
 *
 * Two things are worth proving here, and only these:
 *   · CHIFFREMENT — what leaves the renderer is ciphertext. The plaintext must not
 *     appear in the staged chunk NOR anywhere in the commit body, and the staged
 *     bytes must decrypt back to it with the K_item the commit wrapped. Real
 *     WebCrypto, no crypto mocks: mocking it here would prove nothing.
 *   · CONFLIT — a 409 must reach the caller as a structured conflict carrying the
 *     server's version, and the store must be LEFT ALONE: the user's item, its
 *     version and the cached note body all unchanged, because the UI still holds
 *     the user's text and is about to offer them the choice.
 *
 * The network and the K_vault cache are stubbed (there is no server and no keypair
 * in a unit test); everything between them is the real code path.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { configureStore } from '@reduxjs/toolkit';

const K_VAULT = new Uint8Array(32).fill(7);

// ── Stubs: network + K_vault cache ───────────────────────────────────────────

const declared: Array<{ revisionId: string; totalChunks: number; sizeBytes: number }> = [];
const staged: Array<{ revisionId: string; chunkIndex: number; bytes: Uint8Array }> = [];
let commitBody: Record<string, unknown> | null = null;
let commitBehaviour: 'ok' | 'conflict' = 'ok';
let declareBehaviour: 'ok' | 'refused' = 'ok';
let conflictServerVersion: number | null = 9;
let conflictServerItem: Record<string, unknown> | null = null;

vi.mock('../../../services/vault/vaultApi', async () => {
  /**
   * LE CLASSEMENT D'ÉCHEC EST REPRIS EN VRAI, PAS BOUCHONNÉ.
   *
   * `classifyVaultFailure` est une fonction PURE (elle lit la forme d'une erreur
   * axios, sans I/O), et c'est elle qui distingue « le coffre a refusé » de « la
   * requête n'a rencontré personne » — la distinction dont dépend, à l'écran, le
   * message hors ligne et la reprise. L'omettre de ce double la laissait à
   * `undefined` : le `catch` du thunk plantait sur un appel de non-fonction, et
   * le motif de rejet disparaissait purement et simplement.
   */
  const reel = await vi.importActual<typeof import('../../../services/vault/vaultApi')>(
    '../../../services/vault/vaultApi'
  );
  class VaultItemVersionConflictError extends Error {
    constructor(
      public readonly serverVersion: number | null,
      public readonly serverItem: unknown
    ) {
      super('item_version_conflict');
      this.name = 'VaultItemVersionConflictError';
    }
  }
  return {
    classifyVaultFailure: reel.classifyVaultFailure,
    serverErrorCode: reel.serverErrorCode,
    VaultItemVersionConflictError,
    apiDeclareVaultItemRevision: vi.fn(
      async (
        _vaultId: string,
        _itemId: string,
        body: { revisionId: string; totalChunks: number; sizeBytes: number }
      ) => {
        if (declareBehaviour === 'refused') throw new Error('pooled_quota_exceeded');
        declared.push(body);
      }
    ),
    apiUploadVaultItemRevisionChunk: vi.fn(
      async (
        _vaultId: string,
        _itemId: string,
        revisionId: string,
        chunkIndex: number,
        bytes: Uint8Array
      ) => {
        staged.push({ revisionId, chunkIndex, bytes: new Uint8Array(bytes) });
      }
    ),
    apiUpdateVaultItem: vi.fn(
      async (vaultId: string, itemId: string, body: Record<string, unknown>) => {
        commitBody = body;
        if (commitBehaviour === 'conflict') {
          throw new VaultItemVersionConflictError(conflictServerVersion, conflictServerItem);
        }
        // Echo the opaque blobs back exactly as a real Worker would.
        return {
          id: itemId,
          vaultId,
          ownerUserId: 'me',
          itemType: 'note',
          wrappedItemKey: body.wrappedItemKey,
          wrappedUnderEpoch: body.wrappedUnderEpoch,
          encryptedMeta: body.encryptedMeta,
          encryptedMetaIv: body.encryptedMetaIv,
          totalChunks: body.totalChunks,
          sizeBytes: body.sizeBytes,
          status: 'ready',
          version: (body.expectedVersion as number) + 1,
          createdAt: '',
          updatedAt: '',
        };
      }
    ),
    // Unused by this suite but imported by the slice module.
    apiListVaults: vi.fn(),
    apiCreateVault: vi.fn(),
    apiListVaultItems: vi.fn(),
    apiCreateVaultItem: vi.fn(),
    apiUploadVaultItemChunk: vi.fn(),
    apiFinalizeVaultItem: vi.fn(),
    apiDownloadVaultItemChunk: vi.fn(),
    apiDeleteVaultItem: vi.fn(),
    apiGetMemberPublicKey: vi.fn(),
    apiGetKeyLog: vi.fn(async () => []),
    // E3-6 : sans grant vivant, le commit passe sans rescellement.
    apiListItemGrants: vi.fn(async () => []),
    apiCreateItemGrant: vi.fn(),
    apiRevokeItemGrant: vi.fn(),
    GrantSetMismatchError: class GrantSetMismatchError extends Error {
      constructor(public readonly grants: Array<{ grantId: string; granteeUserId: string }>) {
        super('grant_set_mismatch');
        this.name = 'GrantSetMismatchError';
      }
    },
    apiInviteVaultMember: vi.fn(),
    apiJoinVault: vi.fn(),
    apiLeaveVault: vi.fn(),
    apiListVaultMembers: vi.fn(),
    apiGetVaultKeyWraps: vi.fn(),
    apiRotateVault: vi.fn(),
  };
});

vi.mock('../../../services/vault/vaultKeyCache', () => ({
  getVaultKey: (_vaultId: string, epoch: number) => (epoch === 2 ? K_VAULT : null),
  unlockVault: vi.fn(),
  isVaultUnlocked: () => true,
  lockVault: vi.fn(),
}));

vi.mock('../../../services/auth/userKeypair', () => ({
  hasUserKeypair: () => false,
  getOwnPublicKey: vi.fn(),
  sealToPublicKey: vi.fn(async () => 'U0NFTExF'),
  openSealed: vi.fn(),
  verifyKeypairIntegrity: vi.fn(async () => true),
  isKeyAlgoSupported: () => true,
}));

import vaultsReducer, {
  updateVaultItem,
  isVaultItemConflict,
  type VaultsState,
  type VaultItemSummary,
} from '../vaultsSlice';
import * as vaultApi from '../../../services/vault/vaultApi';
import {
  unwrapItemKey,
  decryptItemChunk,
  generateItemKey,
  wrapItemKey,
  encryptItemMeta,
} from '../../../services/vault/vaultCrypto';

/**
 * A server-shaped item DTO another member could have written: real wraps under the
 * SAME K_vault, so the conflict path has something it can actually decrypt.
 */
async function serverDto(version: number, title: string): Promise<Record<string, unknown>> {
  const kItem = generateItemKey();
  const wrappedItemKey = await wrapItemKey(kItem, K_VAULT);
  const { encryptedMeta, encryptedMetaIv } = await encryptItemMeta({ title }, kItem);
  kItem.fill(0);
  return {
    id: 'item1',
    vaultId: 'vault1',
    ownerUserId: 'other',
    itemType: 'note',
    wrappedItemKey,
    wrappedUnderEpoch: 2,
    encryptedMeta,
    encryptedMetaIv,
    totalChunks: 1,
    sizeBytes: 10,
    status: 'ready',
    version,
    createdAt: '',
    updatedAt: '',
  };
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

const PLAINTEXT = JSON.stringify({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'CONFIDENTIEL-ROQUEFORT' }] }],
});

function baseItem(o: Partial<VaultItemSummary> = {}): VaultItemSummary {
  return {
    id: 'item1',
    vaultId: 'vault1',
    ownerUserId: 'me',
    itemType: 'note',
    meta: { title: 'Ancien titre' },
    wrappedItemKey: 'OLD',
    wrappedUnderEpoch: 2,
    totalChunks: 1,
    sizeBytes: 42,
    status: 'ready',
    version: 5,
    createdAt: '',
    updatedAt: '',
    ...o,
  };
}

function makeStore(item = baseItem()) {
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
    itemsByVault: { vault1: [item, baseItem({ id: 'item2', meta: { title: 'Autre' } })] },
    decryptStatusByVault: {},
    loadFailureByVault: {},
    rewrapProgress: {},
    noteContentByRef: { 'vault1:item1': 'ANCIEN CORPS' },
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
  declared.length = 0;
  staged.length = 0;
  commitBody = null;
  commitBehaviour = 'ok';
  declareBehaviour = 'ok';
  conflictServerVersion = 9;
  conflictServerItem = null;
});

// ── Chiffrement ──────────────────────────────────────────────────────────────

describe('updateVaultItem — chiffrement', () => {
  it('stages ciphertext only: the plaintext is in neither the chunk nor the commit body', async () => {
    const store = makeStore();
    await store
      .dispatch(
        updateVaultItem({
          vaultId: 'vault1',
          itemId: 'item1',
          expectedVersion: 5,
          meta: { title: 'Nouveau titre' },
          content: new TextEncoder().encode(PLAINTEXT),
        })
      )
      .unwrap();

    expect(staged).toHaveLength(1);
    const wire = new TextDecoder().decode(staged[0].bytes);
    expect(wire).not.toContain('CONFIDENTIEL-ROQUEFORT');
    expect(wire).not.toContain('paragraph');
    // The TITLE is E2EE too — encrypted meta, never a clear field on the wire.
    expect(JSON.stringify(commitBody)).not.toContain('Nouveau titre');
    expect(JSON.stringify(commitBody)).not.toContain('CONFIDENTIEL-ROQUEFORT');
  });

  it('the staged chunk decrypts back to the plaintext with the wrapped K_item', async () => {
    const store = makeStore();
    await store
      .dispatch(
        updateVaultItem({
          vaultId: 'vault1',
          itemId: 'item1',
          expectedVersion: 5,
          meta: { title: 'Nouveau titre' },
          content: new TextEncoder().encode(PLAINTEXT),
        })
      )
      .unwrap();

    // A member holding K_vault opens the new wrap, then the chunk — the exact path
    // another member's client takes to read the edit.
    const kItem = await unwrapItemKey(commitBody!.wrappedItemKey as string, K_VAULT);
    const plain = await decryptItemChunk(staged[0].bytes, kItem);
    expect(new TextDecoder().decode(plain)).toBe(PLAINTEXT);
  });

  it('uses a FRESH K_item per revision (the retired chunks are not readable with it)', async () => {
    const store = makeStore();
    const run = () =>
      store
        .dispatch(
          updateVaultItem({
            vaultId: 'vault1',
            itemId: 'item1',
            expectedVersion: 5,
            meta: { title: 'T' },
            content: new TextEncoder().encode(PLAINTEXT),
          })
        )
        .unwrap();

    await run();
    const firstWrap = commitBody!.wrappedItemKey as string;
    const firstChunk = staged[0].bytes;
    await run();
    const secondWrap = commitBody!.wrappedItemKey as string;

    expect(secondWrap).not.toBe(firstWrap);
    const kItem2 = await unwrapItemKey(secondWrap, K_VAULT);
    // The previous revision's chunk fails the GCM tag under the new key.
    await expect(decryptItemChunk(firstChunk, kItem2)).rejects.toBeTruthy();
  });

  it('sends the version it was given and the vault CURRENT epoch, under one revision id', async () => {
    const store = makeStore();
    await store
      .dispatch(
        updateVaultItem({
          vaultId: 'vault1',
          itemId: 'item1',
          expectedVersion: 5,
          meta: { title: 'T' },
          content: new TextEncoder().encode(PLAINTEXT),
        })
      )
      .unwrap();

    expect(commitBody!.expectedVersion).toBe(5);
    expect(commitBody!.wrappedUnderEpoch).toBe(2);
    expect(commitBody!.revisionId).toBe(staged[0].revisionId);
    expect(String(commitBody!.revisionId)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
  });

  it('refuses to encrypt anything when the vault is locked', async () => {
    const store = makeStore();
    // Epoch 3 has no cached K_vault in the stub → locked for writing.
    store.getState().vaults.vaults.vault1.currentKeyEpoch = 3;
    const res = await store.dispatch(
      updateVaultItem({
        vaultId: 'vault1',
        itemId: 'item1',
        expectedVersion: 5,
        meta: {},
        content: new TextEncoder().encode(PLAINTEXT),
      })
    );
    expect(res.type).toBe('vaults/updateItem/rejected');
    expect(staged).toHaveLength(0);
    expect(commitBody).toBeNull();
  });
});

// ── Succès : l'état suit ─────────────────────────────────────────────────────

describe('updateVaultItem — état après succès', () => {
  it('replaces the item IN PLACE, bumps its version and refreshes the note cache', async () => {
    const store = makeStore();
    await store
      .dispatch(
        updateVaultItem({
          vaultId: 'vault1',
          itemId: 'item1',
          expectedVersion: 5,
          meta: { title: 'Nouveau titre' },
          content: new TextEncoder().encode(PLAINTEXT),
        })
      )
      .unwrap();

    const list = store.getState().vaults.itemsByVault.vault1;
    expect(list.map((i) => i.id)).toEqual(['item1', 'item2']); // order untouched
    expect(list[0].version).toBe(6);
    // The title round-tripped through encrypted meta and came back decrypted.
    expect(list[0].meta.title).toBe('Nouveau titre');
    // Open transclusions see the save instead of a stale body.
    expect(store.getState().vaults.noteContentByRef['vault1:item1']).toBe(PLAINTEXT);
  });
});

// ── Conflit : proposer, jamais écraser ───────────────────────────────────────

describe('updateVaultItem — conflit de version', () => {
  it('surfaces a structured conflict with the server version and touches NOTHING', async () => {
    commitBehaviour = 'conflict';
    conflictServerVersion = 9;
    const store = makeStore();

    const res = await store.dispatch(
      updateVaultItem({
        vaultId: 'vault1',
        itemId: 'item1',
        expectedVersion: 5,
        meta: { title: 'Ma version' },
        content: new TextEncoder().encode(PLAINTEXT),
      })
    );

    expect(res.type).toBe('vaults/updateItem/rejected');
    expect(isVaultItemConflict(res.payload)).toBe(true);
    expect((res.payload as { serverVersion: number }).serverVersion).toBe(9);

    // The user's work is NOT lost and the other version is NOT adopted behind
    // their back: the store is exactly as it was.
    const list = store.getState().vaults.itemsByVault.vault1;
    expect(list[0].version).toBe(5);
    expect(list[0].meta.title).toBe('Ancien titre');
    expect(store.getState().vaults.noteContentByRef['vault1:item1']).toBe('ANCIEN CORPS');
  });

  it('a deliberate retry at the server version goes through (the "keep mine" path)', async () => {
    commitBehaviour = 'conflict';
    const store = makeStore();
    const first = await store.dispatch(
      updateVaultItem({
        vaultId: 'vault1',
        itemId: 'item1',
        expectedVersion: 5,
        meta: { title: 'Ma version' },
        content: new TextEncoder().encode(PLAINTEXT),
      })
    );
    const serverVersion = (first.payload as { serverVersion: number }).serverVersion;

    commitBehaviour = 'ok';
    await store
      .dispatch(
        updateVaultItem({
          vaultId: 'vault1',
          itemId: 'item1',
          expectedVersion: serverVersion, // re-based on what the server holds
          meta: { title: 'Ma version' },
          content: new TextEncoder().encode(PLAINTEXT),
        })
      )
      .unwrap();

    expect(commitBody!.expectedVersion).toBe(9);
    const list = store.getState().vaults.itemsByVault.vault1;
    expect(list[0].version).toBe(10);
    expect(list[0].meta.title).toBe('Ma version');
  });

  it('isVaultItemConflict rejects a plain error message (no false positives)', () => {
    expect(isVaultItemConflict('Failed to update item')).toBe(false);
    expect(isVaultItemConflict(null)).toBe(false);
    expect(isVaultItemConflict({ code: 'vault_epoch_conflict' })).toBe(false);
  });

  it('carries the server’s item DECRYPTED, so the UI can show what it would have overwritten', async () => {
    // The Worker pays to put its current item in the 409; dropping it on the floor
    // is what left the user with "someone saved first" and no way to look.
    commitBehaviour = 'conflict';
    conflictServerItem = await serverDto(9, 'Leur titre');
    const store = makeStore();

    const res = await store.dispatch(
      updateVaultItem({
        vaultId: 'vault1',
        itemId: 'item1',
        expectedVersion: 5,
        meta: { title: 'Ma version' },
        content: new TextEncoder().encode(PLAINTEXT),
      })
    );

    const payload = res.payload as {
      serverItem: { meta: { title?: string }; version: number } | null;
    };
    expect(payload.serverItem).not.toBeNull();
    expect(payload.serverItem!.version).toBe(9);
    expect(payload.serverItem!.meta.title).toBe('Leur titre');
    // …and it carries the wrap, so the body can be downloaded + decrypted next.
    expect(
      (payload.serverItem as unknown as { wrappedItemKey: string }).wrappedItemKey
    ).toBeTruthy();
  });

  it('an undecryptable server item does not swallow the conflict', async () => {
    commitBehaviour = 'conflict';
    conflictServerItem = { ...(await serverDto(9, 'x')), wrappedItemKey: 'bm9wZQ==' };
    const store = makeStore();
    const res = await store.dispatch(
      updateVaultItem({
        vaultId: 'vault1',
        itemId: 'item1',
        expectedVersion: 5,
        meta: {},
        content: new TextEncoder().encode(PLAINTEXT),
      })
    );
    expect(isVaultItemConflict(res.payload)).toBe(true);
    expect((res.payload as { serverItem: unknown }).serverItem).toBeNull();
  });

  it('refreshes the item list on a conflict (no member left on a dead cache)', async () => {
    commitBehaviour = 'conflict';
    conflictServerItem = await serverDto(9, 'Leur titre');
    vi.mocked(vaultApi.apiGetVaultKeyWraps).mockResolvedValue([]);
    vi.mocked(vaultApi.apiListVaultItems).mockResolvedValue([
      (await serverDto(9, 'Leur titre')) as never,
    ]);
    const store = makeStore();

    await store.dispatch(
      updateVaultItem({
        vaultId: 'vault1',
        itemId: 'item1',
        expectedVersion: 5,
        meta: { title: 'Ma version' },
        content: new TextEncoder().encode(PLAINTEXT),
      })
    );

    await vi.waitFor(() => {
      expect(store.getState().vaults.itemsByVault.vault1[0].version).toBe(9);
    });
    expect(store.getState().vaults.itemsByVault.vault1[0].meta.title).toBe('Leur titre');
  });
});

// ── Mise en attente déclarée ─────────────────────────────────────────────────

describe('updateVaultItem — déclaration de la révision', () => {
  it('declares the revision BEFORE staging a single chunk, with the size it will occupy', async () => {
    const store = makeStore();
    await store
      .dispatch(
        updateVaultItem({
          vaultId: 'vault1',
          itemId: 'item1',
          expectedVersion: 5,
          meta: { title: 'T' },
          content: new TextEncoder().encode(PLAINTEXT),
        })
      )
      .unwrap();

    expect(declared).toHaveLength(1);
    expect(declared[0].revisionId).toBe(staged[0].revisionId);
    expect(declared[0].totalChunks).toBe(1);
    expect(declared[0].sizeBytes).toBeGreaterThan(0);
    // The commit no longer re-sends what the declaration already fixed (and what the
    // server measures itself) — a field that validates and then means nothing.
    expect(commitBody).not.toHaveProperty('sizeBytes');
    expect(commitBody).not.toHaveProperty('totalChunks');
  });

  it('a refused declaration uploads NOTHING (the quota gate is upstream of the bytes)', async () => {
    declareBehaviour = 'refused';
    const store = makeStore();
    const res = await store.dispatch(
      updateVaultItem({
        vaultId: 'vault1',
        itemId: 'item1',
        expectedVersion: 5,
        meta: {},
        content: new TextEncoder().encode(PLAINTEXT),
      })
    );
    expect(res.type).toBe('vaults/updateItem/rejected');
    expect(staged).toHaveLength(0);
    expect(commitBody).toBeNull();
    // Le refus est NOMMÉ : c'est ce qui lui vaut sa propre phrase à l'écran
    // plutôt que le repli générique de l'appelant.
    expect(res.payload).toBe('pooled_quota_exceeded');
  });

  it('UNE REQUÊTE QUI N’A RENCONTRÉ PERSONNE LE DIT — et ne se déguise pas en refus', () => {
    /**
     * LA CAUSE RACINE DU MESSAGE « rien n'a été modifié dans le coffre » HORS
     * LIGNE. Ce thunk renvoyait `(e as Error).message` : l'écran recevait le
     * message brut d'axios (« Network Error »), qu'aucune table ne traduit, et
     * servait donc son repli — littéralement vrai, et faux de sens : le coffre
     * n'avait rien refusé, il n'avait pas été atteint.
     *
     * On éprouve la classification À LA SOURCE : une erreur axios SANS objet
     * `response` n'a reçu aucune réponse. C'est un fait sur la requête, et non
     * une lecture de `navigator.onLine`.
     */
    const coupure = Object.assign(new Error('Network Error'), {
      isAxiosError: true,
      response: undefined,
    });
    expect(vaultApi.classifyVaultFailure(coupure)).toBe('network_unavailable');
    // …et un refus, lui, garde son code : le tri n'écrase pas les verdicts.
    const refus = Object.assign(new Error('Request failed with status code 403'), {
      isAxiosError: true,
      response: { status: 403, data: { code: 'vault_frozen' } },
    });
    expect(vaultApi.classifyVaultFailure(refus)).toBe('vault_frozen');
  });
});

describe('updateVaultItem — le rescellement des grants au commit (E3-6)', () => {
  const PEER = {
    userId: 'bob',
    encPublicKey: 'PEER-ENC',
    signPublicKey: 'PEER-SIGN',
    encPublicKeySig: 'PEER-SIG',
    fingerprint: 'FP-BOB',
    keyAlgo: 'x25519-xsalsa20poly1305+ed25519',
  };
  const TOFU_KEY = 'filarr.kt.fp.bob';
  const savedLS = (globalThis as { localStorage?: Storage }).localStorage;

  beforeEach(() => {
    vi.mocked(vaultApi.apiListItemGrants).mockResolvedValue([
      { id: 'g1', granteeUserId: 'bob', expiresAt: null },
    ] as never);
    vi.mocked(vaultApi.apiGetMemberPublicKey).mockResolvedValue(PEER as never);
  });

  afterEach(() => {
    if (savedLS === undefined) delete (globalThis as { localStorage?: Storage }).localStorage;
    else (globalThis as { localStorage?: Storage }).localStorage = savedLS;
  });

  it('chaque grant vivant repart rescellé dans le body du commit', async () => {
    const store = makeStore();
    const r = await store.dispatch(
      updateVaultItem({
        vaultId: 'vault1',
        itemId: 'item1',
        expectedVersion: 5,
        meta: { title: 'Titre' },
        content: new TextEncoder().encode(PLAINTEXT),
      })
    );
    expect(updateVaultItem.fulfilled.match(r)).toBe(true);
    expect(commitBody?.grantRewraps).toEqual([{ grantId: 'g1', wrappedItemKey: 'U0NFTExF' }]);
  });

  it('TOFU divergent → rejet grantee_key_changed, RIEN ne part', async () => {
    const store = new Map<string, string>([[TOFU_KEY, 'FP-AUTRE']]);
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    } as Storage;
    const st = makeStore();
    const r = await st.dispatch(
      updateVaultItem({
        vaultId: 'vault1',
        itemId: 'item1',
        expectedVersion: 5,
        meta: { title: 'Titre' },
        content: new TextEncoder().encode(PLAINTEXT),
      })
    );
    expect(updateVaultItem.rejected.match(r)).toBe(true);
    expect(r.payload).toBe('grantee_key_changed');
    expect(commitBody).toBeNull();
  });

  it('grant_set_mismatch → reconstruit depuis data.grants et rejoue UNE fois', async () => {
    let calls = 0;
    const realUpdate = vi.mocked(vaultApi.apiUpdateVaultItem).getMockImplementation();
    vi.mocked(vaultApi.apiUpdateVaultItem).mockImplementation(async (v, i, body) => {
      calls++;
      if (calls === 1) {
        throw new vaultApi.GrantSetMismatchError([
          { grantId: 'g1', granteeUserId: 'bob' },
          { grantId: 'g-né-pendant', granteeUserId: 'eve' },
        ]);
      }
      return realUpdate!(v, i, body);
    });
    const store = makeStore();
    const r = await store.dispatch(
      updateVaultItem({
        vaultId: 'vault1',
        itemId: 'item1',
        expectedVersion: 5,
        meta: { title: 'Titre' },
        content: new TextEncoder().encode(PLAINTEXT),
      })
    );
    expect(updateVaultItem.fulfilled.match(r)).toBe(true);
    expect(calls).toBe(2);
    expect((commitBody?.grantRewraps as unknown[]).length).toBe(2);
  });
});

describe('updateVaultItem — le SIDECAR de fil (meta.threadFor) reste hors du store', () => {
  it('un update avec meta.threadFor ne remplit JAMAIS noteContentByRef', async () => {
    const store = makeStore(baseItem({ meta: { threadFor: 'fichier-1', title: '' } }));
    const r = await store.dispatch(
      updateVaultItem({
        vaultId: 'vault1',
        itemId: 'item1',
        expectedVersion: 5,
        meta: { threadFor: 'fichier-1', title: '' },
        content: new TextEncoder().encode('{"format":"filarr.file-thread","v":1,"comments":{}}'),
      })
    );
    expect(updateVaultItem.fulfilled.match(r)).toBe(true);
    // Ni dans le payload (pipeline d'actions), ni dans le cache du store —
    // l'entrée préexistante de la fixture reste INTACTE, jamais remplacée par
    // le JSON du fil.
    expect((r as { payload: { noteText?: string } }).payload.noteText).toBeUndefined();
    const cache = store.getState().vaults.noteContentByRef;
    expect(cache['vault1:item1']).toBe('ANCIEN CORPS');
    expect(JSON.stringify(cache)).not.toContain('filarr.file-thread');
  });
});
