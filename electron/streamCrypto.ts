/**
 * streamCrypto.ts — V3 chunked streaming encryption core (pure Node, no Electron).
 *
 * V3 on-disk format:
 *   Header (50 bytes):
 *     [ 0..12)  magic  ASCII "FILARRENCV3\0"
 *     [12]      version = 3
 *     [13]      reserved = 0
 *     [14..18)  chunkSize  (u32 LE)
 *     [18..26)  origSize   (u64 LE)
 *     [26..42)  salt       (16 bytes)
 *     [42..50)  noncePrefix (8 bytes)
 *   Chunks (i = 0..nChunks-1), no per-chunk length fields:
 *     AES-256-GCM ciphertext (plaintext length = chunkSize, except last chunk
 *     = origSize mod chunkSize, or chunkSize if divisible and origSize > 0),
 *     followed by the 16-byte GCM tag.
 *     nonce = noncePrefix(8B) || u32BE(i)
 *     AAD   = magic(12B) || versionByte(1B) || u64LE(origSize) || u32BE(i)
 *   Empty files (origSize = 0) are written as exactly one empty chunk so the
 *   header/AAD is still authenticated: total length = 50 + 16.
 *   Expected total file length = 50 + nChunks * 16 + origSize.
 *
 * fileKey = HKDF-SHA256(ikm = profile master key, salt = header salt,
 *                       info = "filarr-file-v3", length = 32). No PBKDF2:
 * the master key is already high-entropy.
 *
 * The AAD binds chunk index and file size, so chunk reorder, splice from
 * another file, and truncation always fail authentication.
 */

import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto';
import { open, stat, unlink } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { Readable } from 'node:stream';

export const V3_MAGIC: Buffer = Buffer.from('FILARRENCV3\0', 'ascii'); // 12 bytes
export const V3_CHUNK_SIZE: number = 8 * 1024 * 1024; // 8 MiB

const V3_VERSION = 3;
const HEADER_SIZE = 50;
const TAG_SIZE = 16;
const SALT_SIZE = 16;
const NONCE_PREFIX_SIZE = 8;
const KEY_SIZE = 32;
const MIN_CHUNK_SIZE = 64 * 1024; // 64 KiB
const MAX_CHUNK_SIZE = 64 * 1024 * 1024; // 64 MiB
const MAX_FILE_SIZE = 5 * 1024 * 1024 * 1024; // 5 GiB
const HKDF_INFO = 'filarr-file-v3';
const AAD_SIZE = 12 + 1 + 8 + 4; // magic + version + u64 origSize + u32 index

const ERR_CORRUPT = 'Fichier chiffre corrompu - dechiffrement impossible';
const ERR_TOO_LARGE = 'Fichier trop volumineux (max 5 Go)';
const ERR_TOO_LARGE_PREVIEW = 'Fichier trop volumineux pour un apercu';
const ERR_SOURCE_READ = 'Erreur de lecture du fichier source';
const ERR_RANGE = 'Plage de lecture invalide';
const ERR_READER_CLOSED = 'Lecteur de fichier ferme';
const ERR_BASE_PREFIX = 'Prefixe de conteneur invalide';

/**
 * Optional positioning for V3 payloads embedded inside a larger container
 * (.filarr protected boxes): the V3 header + chunks start at `baseOffset`
 * instead of 0. Default 0 keeps every existing call site bit-identical.
 */
export interface V3OffsetOptions {
  baseOffset?: number;
}

function resolveBaseOffset(opts?: V3OffsetOptions): number {
  const baseOffset = opts?.baseOffset ?? 0;
  if (!Number.isSafeInteger(baseOffset) || baseOffset < 0) {
    throw new Error(ERR_RANGE);
  }
  return baseOffset;
}

export interface V3Header {
  chunkSize: number;
  origSize: number;
  salt: Buffer;
  noncePrefix: Buffer;
}

/** Returns true when the buffer starts with the V3 magic (needs >= 12 bytes). */
export function isV3Buffer(head: Buffer): boolean {
  return head.length >= V3_MAGIC.length && head.subarray(0, V3_MAGIC.length).equals(V3_MAGIC);
}

/** Reads only the first 12 bytes of the file to detect the V3 magic. */
export async function isV3File(filePath: string): Promise<boolean> {
  const handle = await open(filePath, 'r');
  try {
    const head = Buffer.allocUnsafe(V3_MAGIC.length);
    const { bytesRead } = await handle.read(head, 0, V3_MAGIC.length, 0);
    return bytesRead === V3_MAGIC.length && isV3Buffer(head);
  } finally {
    await handle.close().catch(() => undefined);
  }
}

/**
 * Parses and validates a V3 header from the first 50 bytes of a file.
 * Throws the French corrupt-file error on any inconsistency.
 */
export function readV3HeaderSync(head: Buffer): V3Header {
  if (head.length < HEADER_SIZE || !isV3Buffer(head)) {
    throw new Error(ERR_CORRUPT);
  }
  const version = head.readUInt8(12);
  const reserved = head.readUInt8(13);
  if (version !== V3_VERSION || reserved !== 0) {
    throw new Error(ERR_CORRUPT);
  }
  const chunkSize = head.readUInt32LE(14);
  if (chunkSize < MIN_CHUNK_SIZE || chunkSize > MAX_CHUNK_SIZE) {
    throw new Error(ERR_CORRUPT);
  }
  const origSizeBig = head.readBigUInt64LE(18);
  if (origSizeBig > BigInt(MAX_FILE_SIZE)) {
    throw new Error(ERR_CORRUPT);
  }
  const origSize = Number(origSizeBig);
  const salt = Buffer.from(head.subarray(26, 26 + SALT_SIZE));
  const noncePrefix = Buffer.from(head.subarray(42, 42 + NONCE_PREFIX_SIZE));
  return { chunkSize, origSize, salt, noncePrefix };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function deriveFileKey(masterKey: Buffer, salt: Buffer): Buffer {
  return Buffer.from(hkdfSync('sha256', masterKey, salt, HKDF_INFO, KEY_SIZE));
}

/** Empty files still carry one (empty) authenticated chunk. */
function chunkCount(origSize: number, chunkSize: number): number {
  return origSize === 0 ? 1 : Math.ceil(origSize / chunkSize);
}

/** Plaintext length of chunk `index` given the file layout. */
function chunkPlainLength(index: number, nChunks: number, origSize: number, chunkSize: number): number {
  if (index < nChunks - 1) {
    return chunkSize;
  }
  return origSize - (nChunks - 1) * chunkSize;
}

/**
 * Byte offset of chunk `index` inside the encrypted file. `baseOffset` shifts
 * the whole V3 layout when the container is embedded after a prefix (e.g. a
 * `.filarr` protected-container header) — 0 for standalone V3 files.
 */
function encryptedChunkPos(index: number, chunkSize: number, baseOffset = 0): number {
  return baseOffset + HEADER_SIZE + index * (chunkSize + TAG_SIZE);
}

/**
 * Validates a requested plaintext range and clamps it to [0, origSize).
 * Returns `start`/`end` (end exclusive); `end <= start` means an empty read.
 */
function clampRange(origSize: number, offset: number, length: number): { start: number; end: number } {
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 0) {
    throw new Error(ERR_RANGE);
  }
  const start = Math.min(offset, origSize);
  const end = Math.min(offset + length, origSize);
  return { start, end };
}

function buildNonce(noncePrefix: Buffer, index: number): Buffer {
  const nonce = Buffer.allocUnsafe(NONCE_PREFIX_SIZE + 4);
  noncePrefix.copy(nonce, 0);
  nonce.writeUInt32BE(index, NONCE_PREFIX_SIZE);
  return nonce;
}

function buildAad(origSize: number, index: number): Buffer {
  const aad = Buffer.allocUnsafe(AAD_SIZE);
  V3_MAGIC.copy(aad, 0);
  aad.writeUInt8(V3_VERSION, 12);
  aad.writeBigUInt64LE(BigInt(origSize), 13);
  aad.writeUInt32BE(index, 21);
  return aad;
}

function buildHeader(chunkSize: number, origSize: number, salt: Buffer, noncePrefix: Buffer): Buffer {
  const header = Buffer.alloc(HEADER_SIZE);
  V3_MAGIC.copy(header, 0);
  header.writeUInt8(V3_VERSION, 12);
  header.writeUInt8(0, 13); // reserved
  header.writeUInt32LE(chunkSize, 14);
  header.writeBigUInt64LE(BigInt(origSize), 18);
  salt.copy(header, 26);
  noncePrefix.copy(header, 42);
  return header;
}

/** Reads exactly `length` bytes at `position` into `target` (offset 0). */
async function readExact(handle: FileHandle, target: Buffer, length: number, position: number, errMessage: string): Promise<void> {
  let done = 0;
  while (done < length) {
    const { bytesRead } = await handle.read(target, done, length - done, position + done);
    if (bytesRead <= 0) {
      throw new Error(errMessage);
    }
    done += bytesRead;
  }
}

function encryptChunk(fileKey: Buffer, noncePrefix: Buffer, origSize: number, index: number, plain: Buffer): { ciphertext: Buffer; tag: Buffer } {
  const cipher = createCipheriv('aes-256-gcm', fileKey, buildNonce(noncePrefix, index), { authTagLength: TAG_SIZE });
  cipher.setAAD(buildAad(origSize, index));
  const ciphertext = cipher.update(plain);
  cipher.final();
  return { ciphertext, tag: cipher.getAuthTag() };
}

function decryptChunk(fileKey: Buffer, noncePrefix: Buffer, origSize: number, index: number, ciphertext: Buffer, tag: Buffer): Buffer {
  try {
    const decipher = createDecipheriv('aes-256-gcm', fileKey, buildNonce(noncePrefix, index), { authTagLength: TAG_SIZE });
    decipher.setAAD(buildAad(origSize, index));
    decipher.setAuthTag(tag);
    const plain = decipher.update(ciphertext);
    decipher.final();
    return plain;
  } catch {
    throw new Error(ERR_CORRUPT);
  }
}

/**
 * Shared streaming encryption loop. `readChunk` must return exactly
 * `plainLen` plaintext bytes for chunk `index` (it may return a subarray of a
 * reused buffer — the bytes are consumed before the next call).
 *
 * baseOffset contract (.filarr protected containers):
 *  - baseOffset === 0 (default): destPath is opened 'w' (truncate) and a
 *    partial write is unlinked on failure — today's behavior, unchanged.
 *  - baseOffset > 0: the CALLER has already written exactly `baseOffset`
 *    prefix bytes (box header + encrypted metadata) to destPath; it is
 *    opened 'r+' (validated via stat) and on failure the file is NOT
 *    unlinked — the caller owns the staging file and its cleanup.
 */
async function encryptCore(
  masterKey: Buffer,
  origSize: number,
  destPath: string,
  readChunk: (index: number, plainLen: number) => Promise<Buffer>,
  onProgress?: (doneBytes: number, totalBytes: number) => void,
  baseOffset: number = 0
): Promise<void> {
  if (origSize > MAX_FILE_SIZE) {
    throw new Error(ERR_TOO_LARGE);
  }
  const salt = randomBytes(SALT_SIZE);
  const noncePrefix = randomBytes(NONCE_PREFIX_SIZE);
  const fileKey = deriveFileKey(masterKey, salt);
  const chunkSize = V3_CHUNK_SIZE;
  const nChunks = chunkCount(origSize, chunkSize);

  let dest: FileHandle | undefined;
  let ok = false;
  try {
    if (baseOffset > 0) {
      dest = await open(destPath, 'r+');
      const { size } = await dest.stat();
      if (size !== baseOffset) {
        throw new Error(ERR_BASE_PREFIX);
      }
    } else {
      dest = await open(destPath, 'w');
    }
    // Explicit positions throughout: with 'r+' the implicit file position
    // starts at 0 and would clobber the caller's prefix.
    let writePos = baseOffset;
    const header = buildHeader(chunkSize, origSize, salt, noncePrefix);
    await dest.write(header, 0, HEADER_SIZE, writePos);
    writePos += HEADER_SIZE;

    let doneBytes = 0;
    for (let i = 0; i < nChunks; i++) {
      const plainLen = chunkPlainLength(i, nChunks, origSize, chunkSize);
      const plain = await readChunk(i, plainLen);
      const { ciphertext, tag } = encryptChunk(fileKey, noncePrefix, origSize, i, plain);
      if (ciphertext.length > 0) {
        await dest.write(ciphertext, 0, ciphertext.length, writePos);
        writePos += ciphertext.length;
      }
      await dest.write(tag, 0, TAG_SIZE, writePos);
      writePos += TAG_SIZE;
      doneBytes += plainLen;
      if (onProgress) {
        onProgress(doneBytes, origSize);
      }
    }
    ok = true;
  } finally {
    if (dest) {
      await dest.close().catch(() => undefined);
    }
    if (!ok && baseOffset === 0) {
      await unlink(destPath).catch(() => undefined);
    }
  }
}

/**
 * Opens a V3 file, validates its header and its total length
 * (baseOffset + 50 + nChunks * 16 + origSize) BEFORE any decryption work.
 * `baseOffset` positions a V3 payload embedded inside a .filarr protected
 * container (header read at baseOffset instead of 0). Caller must close the
 * returned handle.
 */
async function openV3ForRead(srcPath: string, baseOffset: number = 0): Promise<{ src: FileHandle; header: V3Header; nChunks: number }> {
  const src = await open(srcPath, 'r');
  try {
    const head = Buffer.allocUnsafe(HEADER_SIZE);
    const { bytesRead } = await src.read(head, 0, HEADER_SIZE, baseOffset);
    if (bytesRead !== HEADER_SIZE) {
      throw new Error(ERR_CORRUPT);
    }
    const header = readV3HeaderSync(head);
    const nChunks = chunkCount(header.origSize, header.chunkSize);
    const expectedLength = baseOffset + HEADER_SIZE + nChunks * TAG_SIZE + header.origSize;
    const { size } = await src.stat();
    if (size !== expectedLength) {
      throw new Error(ERR_CORRUPT);
    }
    return { src, header, nChunks };
  } catch (error) {
    await src.close().catch(() => undefined);
    throw error;
  }
}

/**
 * Shared streaming decryption loop. Verifies every GCM tag; total plaintext
 * output is origSize by construction (asserted). `sink` receives each
 * decrypted chunk in order.
 */
async function decryptCore(
  masterKey: Buffer,
  srcPath: string,
  sink: (plain: Buffer, index: number) => Promise<void>,
  onProgress?: (doneBytes: number, totalBytes: number) => void,
  baseOffset: number = 0
): Promise<V3Header> {
  const { src, header, nChunks } = await openV3ForRead(srcPath, baseOffset);
  try {
    const fileKey = deriveFileKey(masterKey, header.salt);
    const readBuf = Buffer.allocUnsafe(header.chunkSize + TAG_SIZE);
    let srcPos = baseOffset + HEADER_SIZE;
    let doneBytes = 0;
    for (let i = 0; i < nChunks; i++) {
      const plainLen = chunkPlainLength(i, nChunks, header.origSize, header.chunkSize);
      await readExact(src, readBuf, plainLen + TAG_SIZE, srcPos, ERR_CORRUPT);
      srcPos += plainLen + TAG_SIZE;
      const plain = decryptChunk(
        fileKey,
        header.noncePrefix,
        header.origSize,
        i,
        readBuf.subarray(0, plainLen),
        readBuf.subarray(plainLen, plainLen + TAG_SIZE)
      );
      if (plain.length !== plainLen) {
        throw new Error(ERR_CORRUPT);
      }
      await sink(plain, i);
      doneBytes += plainLen;
      if (onProgress) {
        onProgress(doneBytes, header.origSize);
      }
    }
    if (doneBytes !== header.origSize) {
      throw new Error(ERR_CORRUPT);
    }
    return header;
  } finally {
    await src.close().catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Encrypts srcPath (plaintext) to destPath in V3 format with flat memory. */
export async function encryptFileToFileV3(
  masterKey: Buffer,
  srcPath: string,
  destPath: string,
  onProgress?: (doneBytes: number, totalBytes: number) => void,
  opts?: V3OffsetOptions
): Promise<{ origSize: number }> {
  const baseOffset = resolveBaseOffset(opts);
  const { size: origSize } = await stat(srcPath);
  if (origSize > MAX_FILE_SIZE) {
    throw new Error(ERR_TOO_LARGE);
  }
  const src = await open(srcPath, 'r');
  try {
    const plainBuf = Buffer.allocUnsafe(V3_CHUNK_SIZE);
    await encryptCore(
      masterKey,
      origSize,
      destPath,
      async (index, plainLen) => {
        await readExact(src, plainBuf, plainLen, index * V3_CHUNK_SIZE, ERR_SOURCE_READ);
        return plainBuf.subarray(0, plainLen);
      },
      onProgress,
      baseOffset
    );
  } finally {
    await src.close().catch(() => undefined);
  }
  return { origSize };
}

/** Encrypts an in-memory buffer to destPath in V3 format. */
export async function encryptBufferToFileV3(masterKey: Buffer, data: Buffer, destPath: string): Promise<void> {
  await encryptCore(masterKey, data.length, destPath, async (index, plainLen) => {
    const start = index * V3_CHUNK_SIZE;
    return data.subarray(start, start + plainLen);
  });
}

/**
 * Streams plaintext produced ON DEMAND into a fresh V3 container, one chunk at
 * a time (flat memory) — the caller supplies each 8 MiB plaintext chunk through
 * `readChunk(index, plainLen)`, which MUST return exactly `plainLen` bytes for
 * chunk `index` (V3_CHUNK_SIZE, except the last chunk). No plaintext is ever
 * written to disk: `readChunk`'s buffer is encrypted in RAM and only the
 * ciphertext reaches `destPath`.
 *
 * This is the reassembly sink for block-level delta sync: fetched+decrypted
 * plaintext blocks are re-encrypted straight into a portable V3-FEK blob
 * without a plaintext temp file. Chunk boundaries align 1:1 with the delta
 * block size (both 8 MiB), so `readChunk(i, plainLen)` maps to delta block `i`.
 * A partial write is unlinked on failure (encryptCore's contract).
 */
export async function encryptStreamToFileV3(
  masterKey: Buffer,
  origSize: number,
  destPath: string,
  readChunk: (index: number, plainLen: number) => Promise<Buffer>,
  onProgress?: (doneBytes: number, totalBytes: number) => void,
  opts?: V3OffsetOptions
): Promise<{ origSize: number }> {
  await encryptCore(masterKey, origSize, destPath, readChunk, onProgress, resolveBaseOffset(opts));
  return { origSize };
}

/** Decrypts a V3 file to destPath (plaintext) with flat memory. */
export async function decryptFileToFileV3(
  masterKey: Buffer,
  srcPath: string,
  destPath: string,
  onProgress?: (doneBytes: number, totalBytes: number) => void,
  opts?: V3OffsetOptions
): Promise<void> {
  const baseOffset = resolveBaseOffset(opts);
  let dest: FileHandle | undefined;
  let ok = false;
  try {
    dest = await open(destPath, 'w');
    const destHandle = dest;
    await decryptCore(
      masterKey,
      srcPath,
      async (plain) => {
        if (plain.length > 0) {
          await destHandle.write(plain, 0, plain.length);
        }
      },
      onProgress,
      baseOffset
    );
    ok = true;
  } finally {
    if (dest) {
      await dest.close().catch(() => undefined);
    }
    if (!ok) {
      await unlink(destPath).catch(() => undefined);
    }
  }
}

/**
 * Decrypts a V3 file fully into memory (for previews). Throws the French
 * "too large for preview" error when origSize exceeds maxBytes.
 */
export async function decryptFileToBufferV3(
  masterKey: Buffer,
  srcPath: string,
  maxBytes: number,
  opts?: V3OffsetOptions
): Promise<Buffer> {
  const baseOffset = resolveBaseOffset(opts);
  const { src, header } = await openV3ForRead(srcPath, baseOffset);
  await src.close().catch(() => undefined);
  if (header.origSize > maxBytes) {
    throw new Error(ERR_TOO_LARGE_PREVIEW);
  }
  const out = Buffer.allocUnsafe(header.origSize);
  let offset = 0;
  await decryptCore(
    masterKey,
    srcPath,
    async (plain) => {
      // decryptCore re-opens and re-validates the file; if it changed between
      // the two opens the sizes may disagree with `out`. Never return a
      // partially-filled allocUnsafe buffer (uninitialized memory leak).
      if (offset + plain.length > out.length) {
        throw new Error(ERR_CORRUPT);
      }
      plain.copy(out, offset);
      offset += plain.length;
    },
    undefined,
    baseOffset
  );
  if (offset !== out.length) {
    throw new Error(ERR_CORRUPT);
  }
  return out;
}

/**
 * Re-encrypts a V3 file with a fresh salt and noncePrefix (for copy /
 * duplicate), transcoding chunk-by-chunk in RAM — plaintext never touches
 * disk. Accepts a V3 source only. The destination keeps the source chunk
 * size so chunks map 1:1.
 */
export async function reencryptFileV3(masterKey: Buffer, srcPath: string, destPath: string): Promise<void> {
  const { src, header, nChunks } = await openV3ForRead(srcPath);
  let dest: FileHandle | undefined;
  let ok = false;
  try {
    const srcKey = deriveFileKey(masterKey, header.salt);
    const newSalt = randomBytes(SALT_SIZE);
    const newNoncePrefix = randomBytes(NONCE_PREFIX_SIZE);
    const destKey = deriveFileKey(masterKey, newSalt);

    dest = await open(destPath, 'w');
    const newHeader = buildHeader(header.chunkSize, header.origSize, newSalt, newNoncePrefix);
    await dest.write(newHeader, 0, HEADER_SIZE);

    const readBuf = Buffer.allocUnsafe(header.chunkSize + TAG_SIZE);
    let srcPos = HEADER_SIZE;
    let doneBytes = 0;
    for (let i = 0; i < nChunks; i++) {
      const plainLen = chunkPlainLength(i, nChunks, header.origSize, header.chunkSize);
      await readExact(src, readBuf, plainLen + TAG_SIZE, srcPos, ERR_CORRUPT);
      srcPos += plainLen + TAG_SIZE;
      const plain = decryptChunk(
        srcKey,
        header.noncePrefix,
        header.origSize,
        i,
        readBuf.subarray(0, plainLen),
        readBuf.subarray(plainLen, plainLen + TAG_SIZE)
      );
      const { ciphertext, tag } = encryptChunk(destKey, newNoncePrefix, header.origSize, i, plain);
      if (ciphertext.length > 0) {
        await dest.write(ciphertext, 0, ciphertext.length);
      }
      await dest.write(tag, 0, TAG_SIZE);
      doneBytes += plainLen;
    }
    if (doneBytes !== header.origSize) {
      throw new Error(ERR_CORRUPT);
    }
    ok = true;
  } finally {
    await src.close().catch(() => undefined);
    if (dest) {
      await dest.close().catch(() => undefined);
    }
    if (!ok) {
      await unlink(destPath).catch(() => undefined);
    }
  }
}

/**
 * Transcodes a V3 container encrypted under `srcKey` into a fresh V3 container
 * encrypted under `destKey` (a DIFFERENT master key), chunk-by-chunk in RAM —
 * plaintext never touches disk. Used to re-key a machine-key blob to the
 * account FEK (portable-hybrid migration). Every source chunk is GCM-verified
 * on read; the running SHA-256 of the WHOLE plaintext is returned so the caller
 * can prove the transcode preserved the content byte-for-byte. A partial write
 * is unlinked on failure (the destination is a caller-owned staging path).
 */
export async function transcodeV3File(
  srcKey: Buffer,
  destKey: Buffer,
  srcPath: string,
  destPath: string,
  onProgress?: (doneBytes: number, totalBytes: number) => void
): Promise<{ origSize: number; plaintextSha256: Buffer }> {
  const { src, header, nChunks } = await openV3ForRead(srcPath);
  const hash = createHash('sha256');
  let dest: FileHandle | undefined;
  let srcFileKey: Buffer | undefined;
  let destFileKey: Buffer | undefined;
  let ok = false;
  try {
    srcFileKey = deriveFileKey(srcKey, header.salt);
    const newSalt = randomBytes(SALT_SIZE);
    const newNoncePrefix = randomBytes(NONCE_PREFIX_SIZE);
    destFileKey = deriveFileKey(destKey, newSalt);

    dest = await open(destPath, 'w');
    const newHeader = buildHeader(header.chunkSize, header.origSize, newSalt, newNoncePrefix);
    await dest.write(newHeader, 0, HEADER_SIZE);

    const readBuf = Buffer.allocUnsafe(header.chunkSize + TAG_SIZE);
    let srcPos = HEADER_SIZE;
    let doneBytes = 0;
    for (let i = 0; i < nChunks; i++) {
      const plainLen = chunkPlainLength(i, nChunks, header.origSize, header.chunkSize);
      await readExact(src, readBuf, plainLen + TAG_SIZE, srcPos, ERR_CORRUPT);
      srcPos += plainLen + TAG_SIZE;
      const plain = decryptChunk(
        srcFileKey,
        header.noncePrefix,
        header.origSize,
        i,
        readBuf.subarray(0, plainLen),
        readBuf.subarray(plainLen, plainLen + TAG_SIZE)
      );
      if (plain.length !== plainLen) {
        throw new Error(ERR_CORRUPT);
      }
      hash.update(plain);
      const { ciphertext, tag } = encryptChunk(destFileKey, newNoncePrefix, header.origSize, i, plain);
      if (ciphertext.length > 0) {
        await dest.write(ciphertext, 0, ciphertext.length);
      }
      await dest.write(tag, 0, TAG_SIZE);
      doneBytes += plainLen;
      if (onProgress) {
        onProgress(doneBytes, header.origSize);
      }
    }
    if (doneBytes !== header.origSize) {
      throw new Error(ERR_CORRUPT);
    }
    ok = true;
    return { origSize: header.origSize, plaintextSha256: hash.digest() };
  } finally {
    await src.close().catch(() => undefined);
    if (dest) {
      await dest.close().catch(() => undefined);
    }
    if (srcFileKey) srcFileKey.fill(0);
    if (destFileKey) destFileKey.fill(0);
    if (!ok) {
      await unlink(destPath).catch(() => undefined);
    }
  }
}

/**
 * Streams a V3 file's decrypted plaintext through SHA-256 (flat memory, every
 * chunk GCM-verified) and returns the digest WITHOUT materializing the
 * plaintext. Used to verify a freshly transcoded blob decrypts under a given
 * key and that its content matches the source.
 */
export async function hashV3Plaintext(
  masterKey: Buffer,
  srcPath: string,
  opts?: V3OffsetOptions
): Promise<Buffer> {
  const baseOffset = resolveBaseOffset(opts);
  const hash = createHash('sha256');
  await decryptCore(
    masterKey,
    srcPath,
    async (plain) => {
      hash.update(plain);
    },
    undefined,
    baseOffset
  );
  return hash.digest();
}

// ---------------------------------------------------------------------------
// Streaming READ primitives (random access + plaintext Readable)
// ---------------------------------------------------------------------------

export interface V3FileStat {
  /** Plaintext size in bytes. */
  origSize: number;
  /** Plaintext bytes per chunk (last chunk may be shorter). */
  chunkSize: number;
  /** Number of chunks (>= 1, empty files carry one empty chunk). */
  nChunks: number;
  /** Expected (and validated) on-disk encrypted size. */
  encryptedSize: number;
}

/**
 * Reads and validates the V3 header + total file length without decrypting
 * anything. Gives the plaintext size (e.g. Content-Length for range serving)
 * at the cost of a 50-byte read.
 */
export async function statV3File(srcPath: string, opts?: V3OffsetOptions): Promise<V3FileStat> {
  const baseOffset = resolveBaseOffset(opts);
  const { src, header, nChunks } = await openV3ForRead(srcPath, baseOffset);
  await src.close().catch(() => undefined);
  return {
    origSize: header.origSize,
    chunkSize: header.chunkSize,
    nChunks,
    encryptedSize: HEADER_SIZE + nChunks * TAG_SIZE + header.origSize,
  };
}

/**
 * Random-access reader over a V3 file: keeps the handle open across reads and
 * caches the last decrypted chunk, so many small reads inside the same 8 MiB
 * chunk (ZIP central directory walks, media container probing) decrypt it
 * only once.
 *
 * Guarantees: every byte returned by `read()` comes from a chunk whose GCM
 * tag was verified (AAD binds file size + chunk index). Chunks the requested
 * range does not touch are NOT verified — use decryptFileToFileV3/BufferV3
 * for whole-file integrity. The file is assumed immutable while open (header
 * and total length are validated at open time).
 *
 * Reads are clamped at end-of-file (a read past origSize returns fewer bytes,
 * possibly an empty buffer), matching fs.read semantics. Callers must
 * `close()` the reader when done.
 */
export class V3FileReader {
  private cache: { index: number; plain: Buffer } | null = null;
  private closed = false;

  private constructor(
    private readonly src: FileHandle,
    private readonly header: V3Header,
    private readonly nChunks: number,
    private readonly fileKey: Buffer,
    private readonly baseOffset: number
  ) {}

  /** Opens srcPath, validates header + total length, derives the file key. */
  static async open(masterKey: Buffer, srcPath: string, opts?: V3OffsetOptions): Promise<V3FileReader> {
    const baseOffset = resolveBaseOffset(opts);
    const { src, header, nChunks } = await openV3ForRead(srcPath, baseOffset);
    try {
      const fileKey = deriveFileKey(masterKey, header.salt);
      return new V3FileReader(src, header, nChunks, fileKey, baseOffset);
    } catch (error) {
      await src.close().catch(() => undefined);
      throw error;
    }
  }

  /** Plaintext size in bytes. */
  get origSize(): number {
    return this.header.origSize;
  }

  /** Plaintext bytes per chunk (last chunk may be shorter). */
  get chunkSize(): number {
    return this.header.chunkSize;
  }

  /**
   * Decrypts and returns plaintext bytes [offset, offset + length), clamped
   * to the file size. Always returns a fresh Buffer (never a view on the
   * internal cache). Throws the French range error on negative or
   * non-integer arguments, the corrupt-file error on authentication failure.
   */
  async read(offset: number, length: number): Promise<Buffer> {
    if (this.closed) {
      throw new Error(ERR_READER_CLOSED);
    }
    const { start, end } = clampRange(this.header.origSize, offset, length);
    if (end <= start) {
      return Buffer.alloc(0);
    }
    const out = Buffer.allocUnsafe(end - start);
    const firstChunk = Math.floor(start / this.header.chunkSize);
    const lastChunk = Math.floor((end - 1) / this.header.chunkSize);
    let outPos = 0;
    for (let i = firstChunk; i <= lastChunk; i++) {
      const plain = await this.getChunk(i);
      const chunkStart = i * this.header.chunkSize;
      const from = Math.max(start - chunkStart, 0);
      const to = Math.min(end - chunkStart, plain.length);
      if (to <= from) {
        throw new Error(ERR_CORRUPT);
      }
      outPos += plain.copy(out, outPos, from, to);
    }
    if (outPos !== out.length) {
      throw new Error(ERR_CORRUPT);
    }
    return out;
  }

  /** Closes the handle and zeroizes the derived file key. Idempotent. */
  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.cache = null;
    this.fileKey.fill(0);
    await this.src.close().catch(() => undefined);
  }

  /** Reads, authenticates and returns chunk `index` (cached, do not mutate). */
  private async getChunk(index: number): Promise<Buffer> {
    const cached = this.cache;
    if (cached && cached.index === index) {
      return cached.plain;
    }
    const plainLen = chunkPlainLength(index, this.nChunks, this.header.origSize, this.header.chunkSize);
    const buf = Buffer.allocUnsafe(plainLen + TAG_SIZE);
    await readExact(this.src, buf, plainLen + TAG_SIZE, encryptedChunkPos(index, this.header.chunkSize) + this.baseOffset, ERR_CORRUPT);
    const plain = decryptChunk(
      this.fileKey,
      this.header.noncePrefix,
      this.header.origSize,
      index,
      buf.subarray(0, plainLen),
      buf.subarray(plainLen, plainLen + TAG_SIZE)
    );
    if (plain.length !== plainLen) {
      throw new Error(ERR_CORRUPT);
    }
    this.cache = { index, plain };
    return plain;
  }
}

/**
 * One-shot authenticated random-access read: decrypts only the chunks
 * overlapping [offset, offset + length) and returns the clamped plaintext
 * range. Open/close per call — use V3FileReader for repeated reads.
 */
export async function decryptRangeToBufferV3(
  masterKey: Buffer,
  srcPath: string,
  offset: number,
  length: number
): Promise<Buffer> {
  const reader = await V3FileReader.open(masterKey, srcPath);
  try {
    return await reader.read(offset, length);
  } finally {
    await reader.close();
  }
}

/**
 * Returns a byte-mode Readable emitting the decrypted plaintext of
 * [offset, offset + length) (both optional: default = whole file), clamped
 * to the file size, with flat memory (one chunk at a time) and backpressure.
 *
 * The header, total length and range arguments are validated eagerly (the
 * returned promise rejects on a corrupt file or invalid range); decryption
 * errors after that surface as 'error' events on the stream. The underlying
 * handle is opened lazily on first pull and released when the stream ends,
 * errors, or is destroyed. Every emitted byte comes from a GCM-verified
 * chunk.
 */
export async function createDecryptReadStreamV3(
  masterKey: Buffer,
  srcPath: string,
  opts?: { offset?: number; length?: number }
): Promise<Readable> {
  const offset = opts?.offset ?? 0;
  const lengthOpt = opts?.length;

  // Eager validation: corrupt file / bad range fail here, before any stream
  // is handed out (lets callers answer HTTP range requests cleanly).
  const probe = await openV3ForRead(srcPath);
  await probe.src.close().catch(() => undefined);
  clampRange(
    probe.header.origSize,
    offset,
    lengthOpt ?? Math.max(0, probe.header.origSize - Math.min(offset, probe.header.origSize))
  );

  // The generator owns its own handle: opened on first pull, closed in
  // finally (Readable.from calls return() on destroy). It revalidates the
  // file so a swap between probe and consumption cannot desync the layout.
  async function* plainChunks(): AsyncGenerator<Buffer> {
    const { src, header, nChunks } = await openV3ForRead(srcPath);
    try {
      const len = lengthOpt ?? Math.max(0, header.origSize - Math.min(offset, header.origSize));
      const { start, end } = clampRange(header.origSize, offset, len);
      if (end <= start) {
        return;
      }
      const fileKey = deriveFileKey(masterKey, header.salt);
      const firstChunk = Math.floor(start / header.chunkSize);
      const lastChunk = Math.floor((end - 1) / header.chunkSize);
      const readBuf = Buffer.allocUnsafe(header.chunkSize + TAG_SIZE);
      for (let i = firstChunk; i <= lastChunk; i++) {
        const plainLen = chunkPlainLength(i, nChunks, header.origSize, header.chunkSize);
        await readExact(src, readBuf, plainLen + TAG_SIZE, encryptedChunkPos(i, header.chunkSize), ERR_CORRUPT);
        const plain = decryptChunk(
          fileKey,
          header.noncePrefix,
          header.origSize,
          i,
          readBuf.subarray(0, plainLen),
          readBuf.subarray(plainLen, plainLen + TAG_SIZE)
        );
        if (plain.length !== plainLen) {
          throw new Error(ERR_CORRUPT);
        }
        const chunkStart = i * header.chunkSize;
        const from = Math.max(start - chunkStart, 0);
        const to = Math.min(end - chunkStart, plain.length);
        if (to > from) {
          // `plain` is a fresh buffer per chunk, so the slice stays valid
          // after we loop (readBuf reuse does not touch it).
          yield plain.subarray(from, to);
        }
      }
    } finally {
      await src.close().catch(() => undefined);
    }
  }

  return Readable.from(plainChunks(), { objectMode: false });
}
