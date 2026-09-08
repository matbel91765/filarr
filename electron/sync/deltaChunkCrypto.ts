/**
 * deltaChunkCrypto.ts — per-block cipher + streaming chunker for BLOCK-LEVEL
 * DELTA SYNC (pure Node, no Electron / DOM imports).
 *
 * SYNC-LAYER ONLY. The on-disk V3 format (streamCrypto.ts) is never touched:
 * a delta block is an INDEPENDENT AES-256-GCM authenticated object built in RAM
 * from one 8 MiB plaintext chunk and uploaded to a content-addressed cloud key
 * (files/{fileId}/blocks/{plaintextHash}.enc). Skipping unchanged blocks is
 * decided by PLAINTEXT-HASH equality (in the E2EE manifest), never by ciphertext
 * equality — every block gets a fresh random nonce so the wire never carries
 * deterministic ciphertext.
 *
 * Stored block object (what `encryptBlock` returns / `decryptBlock` consumes):
 *   [ 0 .. 12)     nonce      = 12 random bytes, FRESH per encryption (no (key,nonce) reuse)
 *   [ 12 .. 12+N)  ciphertext = N bytes, N == plaintext length (GCM: |ct| == |pt|)
 *   [ 12+N .. +16) GCM auth tag (16 bytes)
 * Total = N + 28 bytes.
 *
 * AAD (authenticated, NOT stored — recomputed by the reader):
 *   magic "FILRDLT4" (8 ASCII)
 *   || version (1 byte) = 0x04
 *   || u16BE(fileIdByteLen) || fileId (UTF-8)     binds block to this file
 *   || u32BE(index)                                binds block to its position
 *   || plaintextHash (32 raw bytes)               binds block to its content identity
 *   || u32BE(size)                                 binds exact plaintext length
 * The magic+version encode the format identity inside the AAD, so no separate
 * on-wire version byte is needed. fileId + index + hash + size in the AAD defeat
 * cross-file splicing, reorder, wrong-length truncation and object substitution.
 *
 * `key` is the already-derived per-file delta key (HKDF over the FEK happens in
 * the sync layer, not here) — always 32 bytes.
 *
 * E2EE invariant: the key never touches disk or logs; plaintext exists only one
 * 8 MiB block at a time in RAM, never a plaintext temp file.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { Readable } from 'node:stream';
import { createDecryptReadStreamV3, V3_CHUNK_SIZE } from '../streamCrypto';

/** Fixed 8 MiB plaintext boundary — aligns 1:1 with the V3 chunk size. */
export const DELTA_BLOCK_SIZE: number = V3_CHUNK_SIZE;

/** Format magic bound in every block's AAD ("4" encodes the v4 format). */
export const DELTA_BLOCK_MAGIC: Buffer = Buffer.from('FILRDLT4', 'ascii'); // 8 bytes
/** Block format version, bound in the AAD. */
export const DELTA_BLOCK_VERSION = 0x04;

const NONCE_SIZE = 12;
const TAG_SIZE = 16;
const KEY_SIZE = 32;
const HASH_HEX_LEN = 64;
const HASH_BYTES = 32;
const MAX_U32 = 0xffffffff;
const HEX_HASH_RE = /^[0-9a-f]{64}$/i;

/** French corrupt-data error — identical wording to streamCrypto's ERR_CORRUPT. */
const ERR_CORRUPT = 'Fichier chiffre corrompu - dechiffrement impossible';
const ERR_BAD_KEY = 'Cle de bloc delta invalide (32 octets requis)';

/** Ordered block metadata for the delta manifest (`blocks: [{index,hash,size}]`). */
export interface DeltaChunkMeta {
  /** 0-based position of the block in the plaintext stream. */
  index: number;
  /** Lowercase SHA-256 hex (64 chars) of the block's plaintext. */
  hash: string;
  /** Exact plaintext length of the block (1..DELTA_BLOCK_SIZE; last may be shorter). */
  size: number;
}

/** Result of streaming a local V3 file into fixed 8 MiB plaintext blocks. */
export interface ChunkLocalV3Result {
  /** Ordered block metadata (array order == plaintext order). */
  chunks: DeltaChunkMeta[];
  /** Sum of block sizes == plaintext (V3 origSize) total. */
  totalSize: number;
}

/** SHA-256 hex (lowercase, 64 chars) of a plaintext block — the content address. */
export function hashPlaintextChunk(plain: Buffer): string {
  return createHash('sha256').update(plain).digest('hex');
}

/** Decodes a 64-char lowercase-hex SHA-256 into its 32 raw bytes. */
function hexHashToBytes(hash: string): Buffer {
  if (hash.length !== HASH_HEX_LEN || !HEX_HASH_RE.test(hash)) {
    throw new Error(ERR_CORRUPT);
  }
  return Buffer.from(hash, 'hex');
}

function assertU32(value: number): void {
  if (!Number.isInteger(value) || value < 0 || value > MAX_U32) {
    throw new Error(ERR_CORRUPT);
  }
}

/**
 * Builds the additional-authenticated-data for a block. Bound fields:
 * magic, version, fileId (length-prefixed UTF-8), index, plaintextHash, size.
 * Any input that cannot be represented (bad hash, oversize fileId, non-u32
 * index/size) throws — surfaced as the French corrupt error on the read path.
 */
function buildBlockAad(fileId: string, index: number, hashBytes: Buffer, size: number): Buffer {
  assertU32(index);
  assertU32(size);
  const fileIdBytes = Buffer.from(fileId, 'utf8');
  if (fileIdBytes.length > 0xffff) {
    throw new Error(ERR_CORRUPT);
  }
  const aad = Buffer.allocUnsafe(
    DELTA_BLOCK_MAGIC.length + 1 + 2 + fileIdBytes.length + 4 + HASH_BYTES + 4
  );
  let o = 0;
  o += DELTA_BLOCK_MAGIC.copy(aad, o);
  o = aad.writeUInt8(DELTA_BLOCK_VERSION, o);
  o = aad.writeUInt16BE(fileIdBytes.length, o);
  o += fileIdBytes.copy(aad, o);
  o = aad.writeUInt32BE(index, o);
  o += hashBytes.copy(aad, o);
  o = aad.writeUInt32BE(size, o);
  return aad;
}

/**
 * Encrypts one plaintext block into an independent authenticated object.
 * Fresh random 12-byte nonce per call guarantees no (key,nonce) reuse.
 * Returns nonce || ciphertext || tag.
 */
export function encryptBlock(
  key: Buffer,
  fileId: string,
  index: number,
  plaintextHash: string,
  plain: Buffer
): Buffer {
  if (key.length !== KEY_SIZE) {
    throw new Error(ERR_BAD_KEY);
  }
  const hashBytes = hexHashToBytes(plaintextHash);
  const aad = buildBlockAad(fileId, index, hashBytes, plain.length);
  const nonce = randomBytes(NONCE_SIZE);
  const cipher = createCipheriv('aes-256-gcm', key, nonce, { authTagLength: TAG_SIZE });
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([nonce, ciphertext, tag]);
}

/**
 * Decrypts and fully verifies one block object (nonce || ciphertext || tag).
 * Verifies: GCM tag + AAD (fileId, index, plaintextHash, size), exact plaintext
 * length == expectedSize, AND SHA-256(plaintext) == plaintextHash (content-address
 * integrity). Any mismatch throws the French corrupt error.
 */
export function decryptBlock(
  key: Buffer,
  fileId: string,
  index: number,
  plaintextHash: string,
  expectedSize: number,
  blob: Buffer
): Buffer {
  try {
    if (key.length !== KEY_SIZE) {
      throw new Error(ERR_CORRUPT);
    }
    if (blob.length < NONCE_SIZE + TAG_SIZE) {
      throw new Error(ERR_CORRUPT);
    }
    assertU32(expectedSize);
    const hashBytes = hexHashToBytes(plaintextHash);
    const nonce = blob.subarray(0, NONCE_SIZE);
    const ciphertext = blob.subarray(NONCE_SIZE, blob.length - TAG_SIZE);
    const tag = blob.subarray(blob.length - TAG_SIZE);
    if (ciphertext.length !== expectedSize) {
      throw new Error(ERR_CORRUPT);
    }
    const aad = buildBlockAad(fileId, index, hashBytes, expectedSize);
    const decipher = createDecipheriv('aes-256-gcm', key, nonce, { authTagLength: TAG_SIZE });
    decipher.setAAD(aad);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    if (plain.length !== expectedSize) {
      throw new Error(ERR_CORRUPT);
    }
    if (hashPlaintextChunk(plain) !== plaintextHash.toLowerCase()) {
      throw new Error(ERR_CORRUPT);
    }
    return plain;
  } catch {
    throw new Error(ERR_CORRUPT);
  }
}

/**
 * Streams a local V3 file's plaintext into fixed DELTA_BLOCK_SIZE (8 MiB)
 * blocks with FLAT memory: it re-buffers the decrypted stream to exact 8 MiB
 * boundaries (independent of how the underlying stream delivers bytes), hashes
 * each block, invokes `onChunk(index, plain, hash)` (awaited, so backpressure is
 * preserved — only one block is live at a time), and returns the ordered block
 * metadata + total plaintext size.
 *
 * `plain` passed to `onChunk` is a view into a single reused accumulator and is
 * valid ONLY for the duration of that call (the accumulator is refilled once the
 * awaited call resolves) — consumers that need it later must copy it. The real
 * upload caller encrypts the block synchronously inside `onChunk`, so no copy is
 * needed. Keeping one accumulator is what holds memory flat: peak live plaintext
 * is ~2 blocks regardless of file size.
 * A 0-byte file yields zero blocks and totalSize 0.
 */
export async function chunkLocalV3(
  masterKey: Buffer,
  srcPath: string,
  onChunk: (index: number, plain: Buffer, hash: string) => Promise<void>
): Promise<ChunkLocalV3Result> {
  const stream: Readable = await createDecryptReadStreamV3(masterKey, srcPath);
  const chunks: DeltaChunkMeta[] = [];
  let totalSize = 0;
  let index = 0;

  // One persistent 8 MiB accumulator, reused for every block (no per-block
  // allocation), so peak live plaintext stays ~2 blocks regardless of file size.
  const acc = Buffer.allocUnsafe(DELTA_BLOCK_SIZE);
  let accFill = 0;

  const emit = async (): Promise<void> => {
    const plain = acc.subarray(0, accFill); // view; valid only during onChunk
    const hash = hashPlaintextChunk(plain);
    chunks.push({ index, hash, size: plain.length });
    totalSize += plain.length;
    await onChunk(index, plain, hash);
    index += 1;
    accFill = 0;
  };

  try {
    for await (const piece of stream as AsyncIterable<Buffer>) {
      let off = 0;
      while (off < piece.length) {
        const take = Math.min(DELTA_BLOCK_SIZE - accFill, piece.length - off);
        piece.copy(acc, accFill, off, off + take);
        accFill += take;
        off += take;
        if (accFill === DELTA_BLOCK_SIZE) {
          await emit();
        }
      }
    }
    if (accFill > 0) {
      await emit();
    }
  } finally {
    if (!stream.destroyed) {
      stream.destroy();
    }
  }

  return { chunks, totalSize };
}
