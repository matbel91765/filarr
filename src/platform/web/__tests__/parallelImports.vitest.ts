/**
 * Imports concurrents — la fiche de CHAQUE fichier doit survivre.
 *
 * Le défaut réel (web, 2026-09-01) : « Upload Files » avec cinq photos, une
 * seule visible. `addItemToFolder` fait lire-modifier-écrire la MÊME valeur
 * IndexedDB (« folders ») en plusieurs await ; lancés de front, chaque appel
 * relisait la carte d'avant les autres et la réécrivait ENTIÈRE — le dernier
 * écrivain gagnait, les blobs chiffrés des perdants restaient orphelins.
 *
 * Le store simulé CÈDE LA MAIN entre lecture et écriture (setTimeout 0) :
 * sans ce délai, les doublures instantanées masquent l'entrelacement et le
 * test passerait même sans verrou.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { store } = vi.hoisted(() => ({ store: new Map<string, unknown>() }));

const yieldTick = () => new Promise((r) => setTimeout(r, 0));

vi.mock('../webStore', () => ({
  // CLONE STRUCTUREL, comme le vrai IndexedDB : chaque lecture rend une COPIE
  // indépendante. Une doublure qui rend la même référence fait muter le même
  // objet par tous les appelants — la course devient invisible et le test
  // passerait même sans verrou (vérifié : c'est arrivé).
  storeGet: async (key: string) => {
    await yieldTick(); // fenêtre de course : un concurrent peut s'intercaler ici
    return store.has(key) ? structuredClone(store.get(key)) : null;
  },
  storePut: async (key: string, value: unknown) => {
    await yieldTick();
    store.set(key, structuredClone(value));
  },
  storeDelete: async (key: string) => {
    store.delete(key);
  },
  getActiveProfileId: async () => 'profil-test',
}));

vi.mock('../../../services/auth/hybridCrypto', () => ({
  encryptFileContent: async (buf: ArrayBuffer) => new Uint8Array(buf),
  decryptFileContent: async (bytes: Uint8Array) =>
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
}));

vi.mock('../sync/readSync', () => ({
  deriveFileId: async (folderId: string, fileName: string) => `f:${folderId}/${fileName}`,
  fetchCloudFile: async () => null,
  getSyncState: async () => null,
  getCachedManifest: () => null,
  pullFromCloud: async () => ({ state: 'idle' }),
  isNotesPushAllowed: async () => true,
}));

import { webFileHandlers } from '../handlers/webFileHandlers';

interface FolderRow {
  items?: Array<{ id: string; name: string }>;
}

beforeEach(() => {
  store.clear();
  store.set('folders', {
    dossier: { id: 'dossier', name: 'Photos', items: [], createdAt: '', updatedAt: '' },
  });
});

describe('addItemToFolder — mutations concurrentes', () => {
  it('cinq ajouts lancés de front laissent CINQ fiches, pas une', async () => {
    const add = webFileHandlers.addItemToFolder as (f: unknown, i: unknown) => Promise<FolderRow>;
    await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        add('dossier', {
          id: `fichier-${i}`,
          name: `photo-${i}.jpg`,
          type: 'image/jpeg',
          content: new Uint8Array([i]),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
      )
    );
    const folders = store.get('folders') as Record<string, FolderRow>;
    const names = (folders.dossier.items ?? []).map((it) => it.name).sort();
    expect(names).toEqual([
      'photo-0.jpg',
      'photo-1.jpg',
      'photo-2.jpg',
      'photo-3.jpg',
      'photo-4.jpg',
    ]);
  });

  it('un ajout qui ÉCHOUE ne bloque pas les suivants (le verrou se libère)', async () => {
    const add = webFileHandlers.addItemToFolder as (f: unknown, i: unknown) => Promise<FolderRow>;
    await expect(add('dossier-inexistant', { id: 'x', name: 'x.jpg' })).rejects.toThrow(
      /not found/
    );
    await add('dossier', {
      id: 'ok',
      name: 'apres-echec.jpg',
      createdAt: '',
      updatedAt: '',
    });
    const folders = store.get('folders') as Record<string, FolderRow>;
    expect((folders.dossier.items ?? []).map((it) => it.name)).toContain('apres-echec.jpg');
  });
});
