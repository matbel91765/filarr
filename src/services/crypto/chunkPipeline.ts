/**
 * chunkPipeline.ts (E3-6) — the ONE per-chunk AES-256-GCM format, shared by every
 * E2EE content path so there's a single chunk codec to maintain.
 *
 * Layout: IV(12) || ciphertext+tag. No marker byte, no magic numbers — just the
 * standard WebCrypto AES-GCM output prefixed by its random IV, the exact bytes a
 * recipient decrypts verbatim. Used by:
 *   - external shares (shareCrypto.ts): the key is K_actual (from the URL fragment),
 *   - team-vault items (vaultCrypto.ts): the key is K_item (wrapped under K_vault).
 * The SEMANTIC difference (where the key lives) stays in those modules; only the
 * byte format + crypto call live here. Because the format is identical, a vault
 * item's K_item can be re-wrapped to a K_share and re-shared externally with no
 * re-encryption of the chunks (E3-6 bonus, wired by the UI in E3-8).
 *
 * Pure: WebCrypto only, no app deps — unit-testable in isolation (node/vitest).
 */

/** AES-GCM IV length (bytes). The recipient slices exactly this prefix. */
export const CHUNK_IV_LENGTH = 12;

/** Plaintext bytes per chunk before encryption. 16 MB is the AWS multipart sweet
 *  spot and fits comfortably under the Cloudflare Workers 100 MB request cap once
 *  the 28-byte (IV+tag) per-chunk overhead is added. */
export const CHUNK_SIZE = 16 * 1024 * 1024;

/** Import a raw 32-byte AES-256 key for chunk encrypt/decrypt. */
export function importChunkKey(keyBytes: Uint8Array, usages: KeyUsage[]): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    keyBytes as BufferSource,
    { name: 'AES-GCM', length: 256 },
    false,
    usages
  );
}

/** Encrypt one plaintext chunk → IV(12) || ciphertext+tag. */
export async function encryptChunk(plaintext: Uint8Array, key: CryptoKey): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(CHUNK_IV_LENGTH));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext as BufferSource)
  );
  const out = new Uint8Array(CHUNK_IV_LENGTH + ciphertext.byteLength);
  out.set(iv, 0);
  out.set(ciphertext, CHUNK_IV_LENGTH);
  return out;
}

/** Decrypt one chunk (IV(12) || ciphertext+tag). Throws on a wrong key / tamper. */
export async function decryptChunk(chunk: Uint8Array, key: CryptoKey): Promise<Uint8Array> {
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: chunk.slice(0, CHUNK_IV_LENGTH) },
    key,
    chunk.slice(CHUNK_IV_LENGTH) as BufferSource
  );
  return new Uint8Array(plaintext);
}
