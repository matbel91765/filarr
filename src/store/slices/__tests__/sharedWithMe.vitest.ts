/**
 * sharedWithMe — l'écran du destinataire, sous VRAI WebCrypto.
 *
 * Ce qui se prouve : le titre se déchiffre avec le K_item qui NOUS est scellé
 * (pas un mock de crypto — le scellé est réel) ; un wrap en retard est marqué
 * `needsRewrap` sans être caché ; une entrée indéchiffrable est comptée et
 * SAUTÉE, jamais fatale ; et sans paire de clés, la liste est LUE quand même
 * ('locked' + compte) — l'écran ne demande le déverrouillage que s'il y a
 * quelque chose à lire, et la relecture à l'arrivée de la clé lève l'attente.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { configureStore } from '@reduxjs/toolkit';

const listMock = vi.hoisted(() => ({ current: [] as unknown[] }));

vi.mock('../../../services/vault/vaultApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/vault/vaultApi')>();
  return {
    ...actual,
    apiListSharedWithMe: vi.fn(async () => listMock.current),
    apiDownloadSharedChunk: vi.fn(),
  };
});

import sharedWithMeReducer, {
  fetchSharedWithMe,
  selectSharedWithMeVisible,
} from '../sharedWithMeSlice';
import {
  generateItemKey,
  encryptItemMeta,
  wrapItemKeyForRecipient,
} from '../../../services/vault/vaultCrypto';
import {
  generateAndWrapKeypair,
  unwrapPrivateKey,
  clearUserKeypair,
  type GeneratedKeypair,
} from '../../../services/auth/userKeypair';

function makeStore() {
  return configureStore({ reducer: { sharedWithMe: sharedWithMeReducer } });
}

async function sealedEntry(
  me: GeneratedKeypair,
  o: Partial<{
    grantId: string;
    title: string;
    wrappedForVersion: number;
    itemVersion: number;
  }> = {}
) {
  const kItem = generateItemKey();
  const wrapped = await wrapItemKeyForRecipient(kItem, {
    encPublicKey: me.encPublicKey,
    signPublicKey: me.signPublicKey,
    encPublicKeySig: me.encPublicKeySig,
    fingerprint: me.fingerprint,
    keyAlgo: me.keyAlgo,
  });
  const { encryptedMeta, encryptedMetaIv } = await encryptItemMeta(
    { title: o.title ?? 'CONTRAT-SECRET.pdf' },
    kItem
  );
  kItem.fill(0);
  return {
    grantId: o.grantId ?? 'g1',
    itemId: 'item1',
    vaultId: 'vault1',
    itemType: 'file',
    wrappedItemKey: wrapped,
    wrappedForVersion: o.wrappedForVersion ?? 3,
    itemVersion: o.itemVersion ?? 3,
    encryptedMeta,
    encryptedMetaIv,
    totalChunks: 1,
    sizeBytes: 40,
    grantedByUserId: 'hote',
    grantedByEmail: 'hote@x.com',
    expiresAt: null,
    createdAt: '',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  listMock.current = [];
  clearUserKeypair();
});

describe('fetchSharedWithMe', () => {
  it('déchiffre les titres avec le K_item scellé pour NOUS, et marque le retard', async () => {
    const me = await generateAndWrapKeypair('mon-mdp'); // charge la clé privée
    listMock.current = [
      await sealedEntry(me, { grantId: 'g1', title: 'rapport.pdf' }),
      await sealedEntry(me, {
        grantId: 'g2',
        title: 'plan.docx',
        wrappedForVersion: 2,
        itemVersion: 3,
      }),
    ];
    const store = makeStore();
    await store.dispatch(fetchSharedWithMe() as never);
    const st = store.getState().sharedWithMe;
    expect(st.status).toBe('ready');
    expect(st.entries.map((e) => e.meta.title)).toEqual(['rapport.pdf', 'plan.docx']);
    expect(st.entries.map((e) => e.needsRewrap)).toEqual([false, true]);
    expect(st.entries[0].grantedByEmail).toBe('hote@x.com');
  });

  it('une entrée indéchiffrable est comptée et sautée — jamais fatale', async () => {
    const me = await generateAndWrapKeypair('mon-mdp');
    const bonne = await sealedEntry(me, { grantId: 'g1', title: 'lisible.txt' });
    const corrompue = { ...(await sealedEntry(me, { grantId: 'g2' })), wrappedItemKey: 'Q0FTU0U=' };
    listMock.current = [corrompue, bonne];
    const store = makeStore();
    await store.dispatch(fetchSharedWithMe() as never);
    const st = store.getState().sharedWithMe;
    expect(st.status).toBe('ready');
    expect(st.entries).toHaveLength(1);
    expect(st.entries[0].meta.title).toBe('lisible.txt');
    expect(st.undecryptable).toBe(1);
  });

  it("sans paire de clés : 'locked' avec le COMPTE — la liste est lue, rien n'est déchiffré", async () => {
    const me = await generateAndWrapKeypair('mon-mdp');
    listMock.current = [
      await sealedEntry(me, { grantId: 'g1' }),
      await sealedEntry(me, { grantId: 'g2' }),
    ];
    clearUserKeypair(); // le compte est connu sans clé : les enveloppes sont pour nous
    const store = makeStore();
    await store.dispatch(fetchSharedWithMe() as never);
    const st = store.getState().sharedWithMe;
    expect(st.status).toBe('locked');
    expect(st.lockedCount).toBe(2);
    expect(st.entries).toEqual([]);
    expect(st.error).toBeNull();
    expect(selectSharedWithMeVisible(store.getState())).toBe(true);
  });

  it("sans clé ET sans partage : 'locked' à zéro — la section n'existe pas", async () => {
    const store = makeStore();
    await store.dispatch(fetchSharedWithMe() as never);
    const st = store.getState().sharedWithMe;
    expect(st.status).toBe('locked');
    expect(st.lockedCount).toBe(0);
    // C'était le bandeau « déverrouillez » à chaque lancement, sans rien à lire.
    expect(selectSharedWithMeVisible(store.getState())).toBe(false);
  });

  it("l'arrivée de la clé lève 'locked' : la relecture déchiffre et remet le compte à zéro", async () => {
    const me = await generateAndWrapKeypair('mon-mdp');
    listMock.current = [await sealedEntry(me, { grantId: 'g1', title: 'apres.pdf' })];
    clearUserKeypair();
    const store = makeStore();
    await store.dispatch(fetchSharedWithMe() as never);
    expect(store.getState().sharedWithMe.status).toBe('locked');
    expect(store.getState().sharedWithMe.lockedCount).toBe(1);

    await unwrapPrivateKey('mon-mdp', me, me.keyAlgo); // la clé arrive (gate / mot de passe)
    await store.dispatch(fetchSharedWithMe() as never);
    const st = store.getState().sharedWithMe;
    expect(st.status).toBe('ready');
    expect(st.lockedCount).toBe(0);
    expect(st.entries.map((e) => e.meta.title)).toEqual(['apres.pdf']);
  });

  it("une lecture déjà en vol n'est pas doublée (deux émetteurs à l'arrivée de la clé)", async () => {
    await generateAndWrapKeypair('mon-mdp');
    const store = makeStore();
    const first = store.dispatch(fetchSharedWithMe() as never);
    const second = store.dispatch(fetchSharedWithMe() as never);
    await Promise.all([first, second]);
    const list = await import('../../../services/vault/vaultApi');
    expect(list.apiListSharedWithMe).toHaveBeenCalledTimes(1);
    expect(store.getState().sharedWithMe.status).toBe('ready');
  });
});
