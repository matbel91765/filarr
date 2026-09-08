import { describe, it, expect } from 'vitest';
import { encryptChunk, decryptChunk, importChunkKey, CHUNK_IV_LENGTH } from './chunkPipeline';
import { encryptShareChunk } from '../sharing/shareCrypto';
import { encryptItemChunk, decryptItemChunk } from '../vault/vaultCrypto';

function randKey(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}

describe('chunkPipeline (E3-6)', () => {
  it('round-trips a chunk and uses a fresh IV each call', async () => {
    const raw = randKey();
    const data = crypto.getRandomValues(new Uint8Array(5000));
    const enc1 = await encryptChunk(data, await importChunkKey(raw, ['encrypt']));
    const enc2 = await encryptChunk(data, await importChunkKey(raw, ['encrypt']));
    expect(Array.from(enc1.slice(0, CHUNK_IV_LENGTH))).not.toEqual(
      Array.from(enc2.slice(0, CHUNK_IV_LENGTH))
    );
    expect(Array.from(await decryptChunk(enc1, await importChunkKey(raw, ['decrypt'])))).toEqual(
      Array.from(data)
    );
  });

  it('a different key cannot decrypt (AES-GCM tag mismatch)', async () => {
    const enc = await encryptChunk(
      new Uint8Array([1, 2, 3]),
      await importChunkKey(randKey(), ['encrypt'])
    );
    await expect(
      decryptChunk(enc, await importChunkKey(randKey(), ['decrypt']))
    ).rejects.toBeTruthy();
  });

  it('SHARE and VAULT chunks are byte-compatible (one format, re-share foundation)', async () => {
    const raw = randKey();
    const data = new TextEncoder().encode('the same bytes either way');

    // Encrypt as a SHARE chunk → decrypt as a VAULT item chunk.
    const shareEnc = await encryptShareChunk(data, await importChunkKey(raw, ['encrypt']));
    expect(new TextDecoder().decode(await decryptItemChunk(shareEnc, raw))).toBe(
      'the same bytes either way'
    );

    // Encrypt as a VAULT item chunk → decrypt with the shared pipeline (the share path).
    const vaultEnc = await encryptItemChunk(data, raw);
    expect(
      new TextDecoder().decode(await decryptChunk(vaultEnc, await importChunkKey(raw, ['decrypt'])))
    ).toBe('the same bytes either way');
  });
});
