/**
 * convertFileToVaultShortcut — la moitié PERSONNELLE de « déplacer vers le
 * coffre en laissant un raccourci », vue du store.
 *
 * Ce qu'on prouve : après le geste, l'état ne connaît plus AUCUN octet du
 * fichier (`encryptedData`/`iv` partis — un `{...ancien, ...nouveau}` les
 * aurait gardés), `vaultRef` est posé avec un `movedAt` pris au moment du
 * geste, et un échec du service arrive sous forme d'erreur SÉRIALISÉE, la
 * fiche d'origine intacte.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { configureStore } from '@reduxjs/toolkit';

const convertMock = vi.fn();

vi.mock('../../../services', () => ({
  fileService: {
    convertFileToVaultShortcut: (...args: unknown[]) => convertMock(...args),
  },
}));
vi.mock('../../../services/platform/errorService', () => {
  class AppError extends Error {
    type: string;
    metadata: unknown;
    constructor(message: string, type: string, metadata?: unknown) {
      super(message);
      this.name = 'AppError';
      this.type = type;
      this.metadata = metadata;
    }
  }
  return {
    default: {
      ErrorTypes: { FILE_SYSTEM: 'FILE_SYSTEM' },
      createFromError: (error: Error, message: string, type: string) =>
        new AppError(`${message}: ${error.message}`, type, { cause: error.message }),
      logError: () => {},
    },
  };
});
vi.mock('../../../services/search/searchService', () => ({
  default: { indexItem: () => {}, buildFuseIndex: () => {}, removeItem: () => {} },
}));
vi.mock('../../../services/search/pdfTextExtractor', () => ({ indexPdfContent: async () => {} }));

import filesReducer, { convertFileToVaultShortcut, syncApplyFile } from '../filesSlice';

const fiche = {
  id: 'f-42',
  name: 'contrat.pdf',
  type: 'application/pdf',
  size: 1234,
  encryptedData: 'AAAA',
  iv: 'BBBB',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
};

function makeStore() {
  const store = configureStore({ reducer: { files: filesReducer } });
  store.dispatch(syncApplyFile(fiche));
  return store;
}

describe('convertFileToVaultShortcut', () => {
  beforeEach(() => {
    convertMock.mockReset();
  });

  it('fulfilled : remplace la fiche — vaultRef posé, plus aucun octet', async () => {
    convertMock.mockImplementation(async (folderId: string, fileId: string, ref: unknown) => {
      const { encryptedData: _e, iv: _i, ...reste } = fiche;
      return {
        id: folderId,
        name: 'Dossier',
        items: [{ ...reste, id: fileId, vaultRef: ref, updatedAt: '2026-08-28T10:00:01.000Z' }],
      };
    });
    const store = makeStore();
    const avant = Date.now();

    const result = await store.dispatch(
      convertFileToVaultShortcut({
        folderId: 'd-1',
        fileId: 'f-42',
        vaultId: 'v-1',
        itemId: 'it-9',
      })
    );

    expect(result.type).toBe('files/convertToVaultShortcut/fulfilled');
    expect(convertMock).toHaveBeenCalledTimes(1);
    const [folderId, fileId, ref] = convertMock.mock.calls[0] as [
      string,
      string,
      { movedAt: string },
    ];
    expect(folderId).toBe('d-1');
    expect(fileId).toBe('f-42');
    expect(Date.parse(ref.movedAt)).toBeGreaterThanOrEqual(avant - 1);

    const file = store.getState().files.byId['f-42'];
    expect(file.vaultRef).toEqual({ vaultId: 'v-1', itemId: 'it-9', movedAt: ref.movedAt });
    expect(file).not.toHaveProperty('encryptedData');
    expect(file).not.toHaveProperty('iv');
    expect(file.name).toBe('contrat.pdf');
    expect(file.size).toBe(1234);
    expect(store.getState().files.loading).toBe(false);
    expect(store.getState().files.error).toBeNull();
  });

  it('rejected : erreur sérialisée, fiche d’origine intacte', async () => {
    convertMock.mockRejectedValue(new Error('EACCES: disque en lecture seule'));
    const store = makeStore();

    const result = await store.dispatch(
      convertFileToVaultShortcut({
        folderId: 'd-1',
        fileId: 'f-42',
        vaultId: 'v-1',
        itemId: 'it-9',
      })
    );

    expect(result.type).toBe('files/convertToVaultShortcut/rejected');
    const err = store.getState().files.error;
    expect(err).not.toBeNull();
    expect(err?.type).toBe('FILE_SYSTEM');
    expect(err?.message).toMatch(/raccourci/);
    expect(err?.message).toMatch(/EACCES/);
    // Sérialisable : rien qu'un objet plat, pas d'instance d'Error dans le store.
    expect(JSON.parse(JSON.stringify(err))).toEqual(err);
    expect(store.getState().files.byId['f-42']).toEqual(fiche);
    expect(store.getState().files.byId['f-42'].vaultRef).toBeUndefined();
  });

  it('rejected : le service rend un dossier sans la fiche → erreur, jamais une fiche inventée', async () => {
    convertMock.mockResolvedValue({ id: 'd-1', name: 'Dossier', items: [] });
    const store = makeStore();

    const result = await store.dispatch(
      convertFileToVaultShortcut({
        folderId: 'd-1',
        fileId: 'f-42',
        vaultId: 'v-1',
        itemId: 'it-9',
      })
    );

    expect(result.type).toBe('files/convertToVaultShortcut/rejected');
    expect(store.getState().files.byId['f-42']).toEqual(fiche);
  });
});
