/**
 * FORMAT v2 DES FRAGMENTS DE PARTAGE : CE QUE L'APP CHIFFRE, LE SITE DOIT
 * L'OUVRIR — ET UNIQUEMENT À SA PLACE.
 *
 * Le site (src/lib/share-crypto.ts) est le seul récepteur. En v2 il déchiffre
 * chaque fragment avec l'AAD `filarr-share-v2|shareId|index|totalChunks` ; un
 * fragment déplacé, dupliqué ou pris d'un autre partage échoue au tag GCM. Le
 * test reproduit littéralement l'ouverture côté site (pas nos propres
 * helpers) pour que le moindre écart de format saute ici, pas chez un
 * destinataire.
 */

import { describe, expect, it } from 'vitest';
import { encryptShareChunk, shareChunkAad, SHARE_CHUNK_BINDING_V2 } from './shareCrypto';

const IV_LENGTH = 12;

async function freshKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

/** Copie littérale de decryptFileChunk (site) avec binding v2. */
async function siteDecryptV2(
  chunk: Uint8Array,
  key: CryptoKey,
  binding: { shareId: string; chunkIndex: number; totalChunks: number }
): Promise<Uint8Array> {
  const aad = new TextEncoder().encode(
    `filarr-share-v2|${binding.shareId}|${binding.chunkIndex}|${binding.totalChunks}`
  );
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: chunk.slice(0, IV_LENGTH), additionalData: aad },
    key,
    chunk.slice(IV_LENGTH)
  );
  return new Uint8Array(plain);
}

/** Copie littérale de decryptFileChunk (site) SANS binding (v1). */
async function siteDecryptV1(chunk: Uint8Array, key: CryptoKey): Promise<Uint8Array> {
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: chunk.slice(0, IV_LENGTH) },
    key,
    chunk.slice(IV_LENGTH)
  );
  return new Uint8Array(plain);
}

describe('encryptShareChunk — format v2 (AAD)', () => {
  const binding = { shareId: 'shr_abc123', chunkIndex: 3, totalChunks: 7 };
  const plaintext = new TextEncoder().encode('fragment numéro trois');

  it('produit exactement l’AAD attendu par le site', () => {
    expect(new TextDecoder().decode(shareChunkAad(binding))).toBe('filarr-share-v2|shr_abc123|3|7');
    expect(SHARE_CHUNK_BINDING_V2).toBe(2);
  });

  it('s’ouvre côté site avec le même binding', async () => {
    const key = await freshKey();
    const chunk = await encryptShareChunk(plaintext, key, binding);
    expect(chunk.byteLength).toBe(IV_LENGTH + plaintext.byteLength + 16);
    expect(await siteDecryptV2(chunk, key, binding)).toEqual(plaintext);
  });

  it('refuse un fragment déplacé, compté autrement ou d’un autre partage', async () => {
    const key = await freshKey();
    const chunk = await encryptShareChunk(plaintext, key, binding);
    await expect(siteDecryptV2(chunk, key, { ...binding, chunkIndex: 4 })).rejects.toThrow();
    await expect(siteDecryptV2(chunk, key, { ...binding, totalChunks: 8 })).rejects.toThrow();
    await expect(siteDecryptV2(chunk, key, { ...binding, shareId: 'shr_other' })).rejects.toThrow();
    // Et un fragment v2 ne passe pas pour du v1 : le manifeste dit v2, le site
    // exige l'AAD.
    await expect(siteDecryptV1(chunk, key)).rejects.toThrow();
  });

  it('sans binding, reste le format v1 (partages anciens)', async () => {
    const key = await freshKey();
    const chunk = await encryptShareChunk(plaintext, key);
    expect(await siteDecryptV1(chunk, key)).toEqual(plaintext);
  });
});
