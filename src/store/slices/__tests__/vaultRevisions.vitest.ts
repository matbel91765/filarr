import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * L'HISTORIQUE qu'on payait sans pouvoir le lire.
 *
 * Le serveur conserve les trois dernières versions de chaque élément, les compte
 * dans le quota mutualisé de l'espace, et expose depuis toujours deux routes pour
 * les lister et les télécharger. Aucun client ne les appelait. Un mauvais
 * enregistrement était donc irrécupérable — alors que le modèle de permissions
 * d'un coffre partagé, où un membre peut écraser le travail d'un autre, ne tient
 * que si l'on peut revenir en arrière.
 *
 * Deux propriétés portent tout le reste : chaque révision s'ouvre avec la clé de
 * SON époque (une rotation n'a jamais re-scellé l'historique), et restaurer ÉCRIT
 * une nouvelle version au lieu de rembobiner l'histoire.
 */

const keys = vi.hoisted(() => ({
  byEpoch: new Map<number, Uint8Array>(),
}));

vi.mock('../../../services/vault/vaultKeyCache', () => ({
  getVaultKey: (_vaultId: string, epoch: number) => keys.byEpoch.get(epoch) ?? null,
  lockVaultEverywhere: vi.fn(),
  putVaultKey: vi.fn(),
  lockVault: vi.fn(),
  clearAllVaultKeys: vi.fn(),
}));

vi.mock('../../../services/vault/vaultCrypto', () => ({
  unwrapItemKey: vi.fn(async (wrapped: string) => new TextEncoder().encode(`k:${wrapped}`)),
  decryptItemMeta: vi.fn(async (meta: string) => {
    if (meta === 'BROKEN') throw new Error('bad meta');
    return JSON.parse(meta) as Record<string, unknown>;
  }),
  decryptItemChunk: vi.fn(async (enc: Uint8Array) => enc),
  generateItemKey: vi.fn(() => new Uint8Array(32)),
  encryptItemMeta: vi.fn(),
  encryptItemChunk: vi.fn(),
  wrapItemKey: vi.fn(),
  generateVaultKey: vi.fn(),
  encryptVaultName: vi.fn(),
  decryptVaultName: vi.fn(),
  wrapVaultKey: vi.fn(),
  unwrapVaultKey: vi.fn(),
}));

const api = vi.hoisted(() => ({
  revisions: [] as unknown[],
  chunks: new Map<string, Uint8Array>(),
  listCalls: [] as string[],
}));

vi.mock('../../../services/vault/vaultApi', () => ({
  apiListVaultItemRevisions: vi.fn(async (vaultId: string, itemId: string) => {
    api.listCalls.push(`${vaultId}/${itemId}`);
    return api.revisions;
  }),
  apiDownloadVaultRevisionChunk: vi.fn(
    async (_v: string, _i: string, revId: string, idx: number) =>
      api.chunks.get(`${revId}:${idx}`) ?? new Uint8Array()
  ),
  apiListVaults: vi.fn(),
  apiListVaultItems: vi.fn(),
  apiDownloadVaultItemChunk: vi.fn(),
  apiCreateVault: vi.fn(),
  apiCreateVaultItem: vi.fn(),
  apiUploadVaultItemChunk: vi.fn(),
  apiFinalizeVaultItem: vi.fn(),
  apiDeleteVaultItem: vi.fn(),
  apiDeleteVault: vi.fn(),
  apiLeaveVault: vi.fn(),
  apiListVaultMembers: vi.fn(),
  apiListVaultDirectory: vi.fn(),
  apiInviteVaultMember: vi.fn(),
  apiInviteToVaultSpace: vi.fn(),
  apiGetVaultSeats: vi.fn(),
  apiJoinVault: vi.fn(),
  apiRotateVaultKey: vi.fn(),
  apiGetVaultKeyWraps: vi.fn(),
  apiEnsurePersonalSpace: vi.fn(),
  apiGetMemberPublicKey: vi.fn(),
  apiGetKeyLog: vi.fn(),
  apiGetOrgInvitationPreview: vi.fn(),
  apiListVaultInvites: vi.fn(),
  apiRevokeVaultInvite: vi.fn(),
  apiTransferVaultOwnership: vi.fn(),
  apiRestoreVault: vi.fn(),
  apiStageVaultItemRevision: vi.fn(),
  apiUploadVaultRevisionChunk: vi.fn(),
  apiCommitVaultItemRevision: vi.fn(),
  classifyVaultFailure: vi.fn(() => null),
  serverErrorCode: vi.fn(() => null),
}));

import { listVaultItemRevisions, downloadVaultRevisionContent } from '../vaultsSlice';

function revision(o: Record<string, unknown> = {}) {
  return {
    id: 'rev1',
    itemId: 'item1',
    itemVersion: 3,
    wrappedItemKey: 'W1',
    wrappedUnderEpoch: 1,
    encryptedMeta: JSON.stringify({ title: 'Brouillon' }),
    encryptedMetaIv: 'IV',
    totalChunks: 1,
    sizeBytes: 12,
    // Millisecondes epoch, comme le serveur les envoie — la fixture décrivait
    // jusqu'ici un contrat imaginaire, et couvrait donc un affichage cassé.
    createdAt: Date.UTC(2026, 1, 1, 10, 0, 0),
    ...o,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  keys.byEpoch.clear();
  keys.byEpoch.set(1, new Uint8Array(32));
  api.revisions = [];
  api.chunks.clear();
  api.listCalls = [];
});

describe('listVaultItemRevisions — l’historique, déchiffré pour l’écran', () => {
  it('rend les révisions avec leurs métadonnées en clair', async () => {
    api.revisions = [revision(), revision({ id: 'rev2', itemVersion: 2 })];

    const out = await listVaultItemRevisions('v1', 'item1');

    expect(api.listCalls).toEqual(['v1/item1']);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ id: 'rev1', itemVersion: 3, readable: true });
    expect(out[0].meta).toEqual({ title: 'Brouillon' });
  });

  it('MONTRE une révision dont l’époque n’est plus en cache, marquée illisible', async () => {
    // Une rotation de K_vault n'a jamais re-scellé l'historique : chaque révision
    // porte l'époque sous laquelle elle a été écrite. La taire ferait disparaître
    // de l'historique une version qui existe — pire que dire qu'on ne peut pas
    // l'ouvrir.
    api.revisions = [revision({ wrappedUnderEpoch: 99 })];

    const out = await listVaultItemRevisions('v1', 'item1');

    expect(out).toHaveLength(1);
    expect(out[0].readable).toBe(false);
    expect(out[0].meta).toEqual({});
  });

  it('des métadonnées corrompues ne font pas disparaître la révision', async () => {
    api.revisions = [revision({ encryptedMeta: 'BROKEN' })];

    const out = await listVaultItemRevisions('v1', 'item1');

    expect(out).toHaveLength(1);
    expect(out[0].readable).toBe(false);
  });

  it('une liste vide reste une liste vide', async () => {
    expect(await listVaultItemRevisions('v1', 'item1')).toEqual([]);
  });
});

describe('downloadVaultRevisionContent — la clé de SON époque', () => {
  it('assemble les morceaux dans l’ordre', async () => {
    const rev = revision({ totalChunks: 3 });
    api.chunks.set('rev1:0', new Uint8Array([1, 2]));
    api.chunks.set('rev1:1', new Uint8Array([3]));
    api.chunks.set('rev1:2', new Uint8Array([4, 5]));

    const bytes = await downloadVaultRevisionContent('v1', 'item1', {
      ...rev,
      meta: {},
      readable: true,
    } as never);

    expect(Array.from(bytes)).toEqual([1, 2, 3, 4, 5]);
  });

  it('refuse quand la clé de l’époque de la révision manque', async () => {
    const rev = revision({ wrappedUnderEpoch: 42 });

    await expect(
      downloadVaultRevisionContent('v1', 'item1', { ...rev, meta: {}, readable: false } as never)
    ).rejects.toThrow(/locked/i);
  });
});
