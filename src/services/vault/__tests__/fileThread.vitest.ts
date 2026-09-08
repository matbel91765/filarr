/**
 * fileThread — le sidecar de discussion d'un fichier, avec sa reprise au 409.
 *
 * Ce qui se prouve : création au premier commentaire, update ensuite, UNE
 * reprise par FUSION-PAR-UNION au conflit (les tombstones tiennent), la
 * RECRÉATION quand le serveur ne détient plus rien (serverVersion null), et
 * jamais de boucle (un second 409 remonte).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const h = vi.hoisted(() => ({
  updateBehaviour: [] as Array<'ok' | 'conflict' | 'conflict-null'>,
  updateCalls: [] as Array<{
    expectedVersion: number;
    content: Uint8Array;
    meta: Record<string, unknown>;
  }>,
  addCalls: [] as Array<{ meta: Record<string, unknown>; content: Uint8Array }>,
  serverBytes: null as Uint8Array | null,
}));

vi.mock('../../../store/slices/vaultsSlice', () => {
  class ConflictError extends Error {
    code = 'item_version_conflict';
    constructor(
      public serverVersion: number | null,
      public serverItem: unknown
    ) {
      super('item_version_conflict');
    }
  }
  return {
    __conflict: ConflictError,
    isVaultItemConflict: (e: unknown) => e instanceof ConflictError,
    addVaultItem: Object.assign(
      (args: { meta: Record<string, unknown>; content: Uint8Array }) => ({
        type: 'add',
        payload: args,
      }),
      { typePrefix: 'add' }
    ),
    updateVaultItem: Object.assign(
      (args: { expectedVersion: number; content: Uint8Array }) => ({
        type: 'update',
        payload: args,
      }),
      { typePrefix: 'update' }
    ),
  };
});

import {
  saveFileThread,
  parseFileThread,
  serializeFileThread,
  findThreadItem,
} from '../fileThread';
import * as slice from '../../../store/slices/vaultsSlice';
import type { VaultComment } from '../vaultComments';

const ConflictError = (
  slice as unknown as { __conflict: new (v: number | null, i: unknown) => Error }
).__conflict;

function comment(id: string, o: Partial<VaultComment> = {}): VaultComment {
  return {
    id,
    parentId: null,
    text: `texte-${id}`,
    authorName: 'alice@x.com',
    authorId: 'u1',
    createdAt: '2026-08-01T00:00:00.000Z',
    resolved: false,
    ...o,
  };
}

const FILE = { id: 'file-1', meta: { fileName: 'rapport.pdf' } } as never;
const SIDECAR = { id: 'side-1', version: 4, meta: { threadFor: 'file-1', title: '' } } as never;

/** Un dispatch factice : exécute l'« action » et rend {unwrap}. */
const dispatch = ((action: { type: string; payload: never }) => {
  if (action.type === 'add') {
    h.addCalls.push(action.payload);
    return {
      unwrap: async () => ({
        id: 'side-neuf',
        version: 1,
        meta: (action.payload as { meta: unknown }).meta,
      }),
    };
  }
  const behaviour = h.updateBehaviour.shift() ?? 'ok';
  h.updateCalls.push(action.payload);
  return {
    unwrap: async () => {
      if (behaviour === 'conflict') {
        throw new ConflictError(9, { id: 'side-1' });
      }
      if (behaviour === 'conflict-null') {
        throw new ConflictError(null, null);
      }
      const p = action.payload as { expectedVersion: number };
      return { item: { id: 'side-1', version: p.expectedVersion + 1 } };
    },
  };
}) as never;

beforeEach(() => {
  h.updateBehaviour = [];
  h.updateCalls = [];
  h.addCalls = [];
  h.serverBytes = null;
});

describe('parse/serialize', () => {
  it('round-trip exact, format inconnu → {}', () => {
    const comments = { a: comment('a'), mort: comment('mort', { deleted: true }) };
    expect(parseFileThread(serializeFileThread('file-1', comments))).toEqual(comments);
    expect(parseFileThread(new TextEncoder().encode('{PAS DU JSON'))).toEqual({});
    expect(parseFileThread(new TextEncoder().encode('{"format":"autre","v":1}'))).toEqual({});
  });

  it('findThreadItem trouve par meta.threadFor', () => {
    const items = [FILE, SIDECAR] as never[];
    expect(findThreadItem(items as never, 'file-1')).toBe(SIDECAR);
    expect(findThreadItem(items as never, 'autre')).toBeNull();
  });
});

describe('saveFileThread', () => {
  const download = async () => h.serverBytes ?? new Uint8Array(0);

  it('premier commentaire : CRÉE le sidecar (meta.threadFor, titre vide, TAMPON)', async () => {
    const saved = await saveFileThread(dispatch, {
      vaultId: 'v1',
      file: FILE,
      existing: null,
      comments: { a: comment('a') },
      downloadContent: download,
    });
    expect(h.addCalls).toHaveLength(1);
    expect(h.addCalls[0].meta).toEqual({
      threadFor: 'file-1',
      title: '',
      // LE TAMPON, dès la création : sans lui, la liste ne peut annoncer
      // qu'« une discussion existe », sans nombre (voir `threadStamp`).
      threadStats: { open: 1, total: 1, at: '2026-08-01T00:00:00.000Z' },
    });
    expect((saved as { id: string }).id).toBe('side-neuf');
  });

  it('sidecar existant : UPDATE avec la version fraîche, méta reprise TELLE QUELLE', async () => {
    await saveFileThread(dispatch, {
      vaultId: 'v1',
      file: FILE,
      existing: SIDECAR,
      comments: { a: comment('a') },
      downloadContent: download,
    });
    expect(h.updateCalls).toHaveLength(1);
    expect(h.updateCalls[0].expectedVersion).toBe(4);
    // `threadFor` survit — le perdre rendrait le fil visible comme une note
    // fantôme — et le tampon est RECALCULÉ, pas recopié.
    expect(h.updateCalls[0].meta.threadFor).toBe('file-1');
    expect(h.updateCalls[0].meta.threadStats).toEqual({
      open: 1,
      total: 1,
      at: '2026-08-01T00:00:00.000Z',
    });
  });

  /**
   * LE DÉFAUT HISTORIQUE, ÉPINGLÉ. La méta repartait de `{ ...existing.meta }`
   * : un tampon écrit par un téléphone survivait à toutes les écritures du
   * bureau, en annonçant un compte que plus personne ne vérifiait.
   */
  it('un tampon PÉRIMÉ dans la méta existante est ÉCRASÉ, pas recopié', async () => {
    const perime = {
      id: 'side-1',
      version: 4,
      meta: {
        threadFor: 'file-1',
        title: '',
        threadStats: { open: 9, total: 12, at: '2020-01-01T00:00:00.000Z' },
      },
    } as never;
    await saveFileThread(dispatch, {
      vaultId: 'v1',
      file: FILE,
      existing: perime,
      comments: { a: comment('a'), b: comment('b', { resolved: true }) },
      downloadContent: download,
    });
    expect(h.updateCalls[0].meta.threadStats).toEqual({
      open: 1,
      total: 2,
      at: '2026-08-01T00:00:00.000Z',
    });
  });

  it('un fil VIDÉ RETIRE la clé au lieu de laisser un fil fantôme', async () => {
    const avecTampon = {
      id: 'side-1',
      version: 4,
      meta: {
        threadFor: 'file-1',
        title: '',
        threadStats: { open: 1, total: 1, at: '2026-08-01T00:00:00.000Z' },
      },
    } as never;
    await saveFileThread(dispatch, {
      vaultId: 'v1',
      file: FILE,
      existing: avecTampon,
      comments: { a: comment('a', { deleted: true } as Partial<VaultComment>) },
      downloadContent: download,
    });
    expect('threadStats' in h.updateCalls[0].meta).toBe(false);
    expect(h.updateCalls[0].meta.threadFor).toBe('file-1');
  });

  it('409 : UNE reprise, fusion-par-union — le tombstone de l’autre tient', async () => {
    h.updateBehaviour = ['conflict', 'ok'];
    h.serverBytes = serializeFileThread('file-1', {
      a: comment('a', { deleted: true }),
      b: comment('b'),
    });
    await saveFileThread(dispatch, {
      vaultId: 'v1',
      file: FILE,
      existing: SIDECAR,
      comments: { a: comment('a'), c: comment('c') },
      downloadContent: download,
    });
    expect(h.updateCalls).toHaveLength(2);
    expect(h.updateCalls[1].expectedVersion).toBe(9);
    const merged = parseFileThread(h.updateCalls[1].content);
    expect(Object.keys(merged).sort()).toEqual(['a', 'b', 'c']);
    expect(merged.a.deleted).toBe(true);
  });

  it('409 avec serverVersion NULL : le sidecar n’existe plus — on RECRÉE', async () => {
    h.updateBehaviour = ['conflict-null'];
    const saved = await saveFileThread(dispatch, {
      vaultId: 'v1',
      file: FILE,
      existing: SIDECAR,
      comments: { a: comment('a') },
      downloadContent: download,
    });
    expect(h.addCalls).toHaveLength(1);
    expect((saved as { id: string }).id).toBe('side-neuf');
  });

  it('un SECOND 409 remonte — jamais de boucle', async () => {
    h.updateBehaviour = ['conflict', 'conflict'];
    h.serverBytes = serializeFileThread('file-1', {});
    await expect(
      saveFileThread(dispatch, {
        vaultId: 'v1',
        file: FILE,
        existing: SIDECAR,
        comments: { a: comment('a') },
        downloadContent: download,
      })
    ).rejects.toThrow('item_version_conflict');
    expect(h.updateCalls).toHaveLength(2);
  });
});
