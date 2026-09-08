/**
 * filarrContainer.ts — `.filarr` protected container ("FilarrBox" v1) core.
 * Pure Node (no Electron/DOM), unit-testable. Wave 2 "protéger sur place":
 * a real file/folder on disk becomes ONE opaque encrypted `.filarr` file,
 * openable only through Filarr.
 *
 * On-disk layout (integers little-endian):
 *   [BoxHeader 16 B, plaintext]
 *     [ 0..10)  magic  ASCII "FILARRBOX\0"  (distinct from V3 "FILARRENCV3\0"
 *               and from '{' — the plaintext JSON note backup that shares the
 *               .filarr extension)
 *     [10]      u8 version = 1
 *     [11]      u8 kind: 0 = single file, 1 = folder (tar payload)
 *     [12..16)  u32 metaLen = byte length of the EncryptedMetadata block
 *   [EncryptedMetadata metaLen B — metadata is NEVER plaintext]
 *     salt(16) || nonce(12) || ciphertext(metaLen-44) || gcmTag(16)
 *     metaKey = HKDF-SHA256(ikm = same master key as the payload, salt,
 *               info = "filarr-box-meta-v1", len = 32)
 *     AES-256-GCM, AAD = the 16 BoxHeader bytes (binds magic/version/kind/
 *     metaLen — flipping the kind byte fails authentication)
 *     plaintext = UTF-8 JSON { v:1, name, size, createdAt, entryCount? }
 *   [V3 payload — byte-verbatim streamCrypto container at baseOffset 16+metaLen]
 *     single file: the raw file bytes; folder: a ustar stream (tarStream.ts)
 *
 * Key model mirrors the app vault: write with the session FEK when unlocked
 * hybrid, else the machine master key; nothing in the container records which.
 * Readers PROBE candidate keys against the metadata GCM (44+ bytes, cheap)
 * — the first key that authenticates is used for the payload HKDF.
 *
 * Validation ladder (French messages, locked):
 *   1. structural damage → ERR_BOX_CORRUPT
 *   2. version > 1      → ERR_BOX_NEWER
 *   3. no key authenticates the metadata → ERR_BOX_WRONG_KEY (distinct!)
 *   4. payload chunk GCM failure → surfaced as ERR_BOX_CORRUPT
 */

import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto';
import { open, lstat, stat, unlink } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import {
  V3FileReader,
  decryptFileToFileV3,
  encryptFileToFileV3,
  encryptStreamToFileV3,
  hashV3Plaintext,
  statV3File,
} from './streamCrypto';
import { createTarChunkProducer, scanFolderForTar, walkTarIndex, ERR_TAR_CORRUPT } from './tarStream';

export const BOX_MAGIC: Buffer = Buffer.from('FILARRBOX\0', 'ascii'); // 10 bytes
export const BOX_VERSION = 1;
export const BOX_KIND_FILE = 0;
export const BOX_KIND_FOLDER = 1;

const BOX_HEADER_SIZE = 16;
const META_SALT_SIZE = 16;
const META_NONCE_SIZE = 12;
const META_TAG_SIZE = 16;
const META_OVERHEAD = META_SALT_SIZE + META_NONCE_SIZE + META_TAG_SIZE; // 44
const META_MIN_LEN = META_OVERHEAD + 1; // 45
const META_MAX_LEN = 65536;
const META_HKDF_INFO = 'filarr-box-meta-v1';
const KEY_SIZE = 32;
const V3_HEADER_SIZE = 50;
const MAX_PAYLOAD_SIZE = 5 * 1024 * 1024 * 1024; // 5 GiB — mirrors V3 cap
const EXTRACT_SLICE = 8 * 1024 * 1024; // aligned with the V3 chunk cache

/** streamCrypto's corrupt-file message (not exported there) — mapped to the box message. */
const V3_ERR_CORRUPT = 'Fichier chiffre corrompu - dechiffrement impossible';

export const ERR_BOX_CORRUPT = 'Conteneur .filarr corrompu ou tronqué — ouverture impossible';
export const ERR_BOX_NEWER =
  "Ce conteneur provient d'une version plus récente de Filarr — mettez à jour l'application.";
export const ERR_BOX_WRONG_KEY =
  'Ce conteneur a été protégé sur un autre appareil ou un autre profil — impossible de le déchiffrer ici.';
export const ERR_BOX_UNREADABLE = 'Conteneur .filarr introuvable ou illisible';
export const ERR_BOX_SOURCE_MISSING = 'Fichier ou dossier source introuvable';
export const ERR_BOX_SOURCE_SYMLINK = 'Les liens symboliques ne peuvent pas être protégés';
export const ERR_BOX_SOURCE_NOT_FILE = "Le chemin source n'est pas un fichier";
export const ERR_BOX_SOURCE_NOT_DIR = "Le chemin source n'est pas un dossier";
export const ERR_BOX_FILE_TOO_LARGE = 'Fichier trop volumineux (max 5 Go)';
export const ERR_BOX_DEST_EXISTS = 'Un fichier existe déjà à cet emplacement';
export const ERR_BOX_NOT_A_FILE_BOX = "Ce conteneur est un dossier protégé — ouverture en mini-coffre requise";
export const ERR_BOX_NOT_A_FOLDER_BOX = "Ce conteneur est un fichier protégé — pas un dossier";
export const ERR_BOX_ENTRY_NOT_FOUND = 'Entrée introuvable dans le conteneur';
const ERR_BOX_META_TOO_LARGE = 'Métadonnées du conteneur trop volumineuses';

export type BoxKind = typeof BOX_KIND_FILE | typeof BOX_KIND_FOLDER;

export interface BoxMetadata {
  v: 1;
  /** Original basename ("Rapport.pdf", "MonDossier"). */
  name: string;
  /** Plaintext payload bytes (folders: tar byte size). */
  size: number;
  /** ISO-8601 creation timestamp. */
  createdAt: string;
  /** Folders only: number of regular files. */
  entryCount?: number;
}

export interface BoxHeaderInfo {
  version: number;
  kind: BoxKind;
  metaLen: number;
  /** 16 + metaLen — where the embedded V3 payload starts. */
  payloadOffset: number;
  /** Plaintext byte size of the V3 payload (validated, not decrypted). */
  payloadSize: number;
  /** Total on-disk container size. */
  containerSize: number;
}

export interface PackContainerResult {
  destPath: string;
  kind: BoxKind;
  metadata: BoxMetadata;
  /** SHA-256 (hex) of the plaintext payload, streamed BEFORE/DURING encryption
   *  — compare with hashContainerPlaintextHex() for verify-before-delete. */
  sourceSha256Hex: string;
  /** Folders only: symlinks/junctions skipped (never followed). */
  skippedSymlinks?: number;
}

export interface BoxFolderEntry {
  /** '/'-separated path inside the container (no trailing slash). */
  path: string;
  size: number;
  isDir: boolean;
}

/** One key or an ordered candidate list (machine key, then session FEK). */
export type BoxKeyInput = Buffer | readonly Buffer[];

export type BoxProgress = (doneBytes: number, totalBytes: number) => void;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function candidateKeys(input: BoxKeyInput): readonly Buffer[] {
  const list = Buffer.isBuffer(input) ? [input] : input;
  return list.filter((k) => Buffer.isBuffer(k) && k.length > 0);
}

function deriveMetaKey(masterKey: Buffer, salt: Buffer): Buffer {
  return Buffer.from(hkdfSync('sha256', masterKey, salt, META_HKDF_INFO, KEY_SIZE));
}

/** Payload-level errors surface as the box corrupt message (ladder rule 4). */
function mapPayloadError(error: unknown): Error {
  if (error instanceof Error && (error.message === V3_ERR_CORRUPT || error.message === ERR_TAR_CORRUPT)) {
    return new Error(ERR_BOX_CORRUPT);
  }
  return error instanceof Error ? error : new Error(String(error));
}

async function readExactAt(handle: FileHandle, position: number, length: number): Promise<Buffer> {
  const target = Buffer.allocUnsafe(length);
  let done = 0;
  while (done < length) {
    const { bytesRead } = await handle.read(target, done, length - done, position + done);
    if (bytesRead <= 0) {
      throw new Error(ERR_BOX_CORRUPT);
    }
    done += bytesRead;
  }
  return target;
}

/** Windows-safe temp file name component derived from the original name. */
function sanitizeTempName(name: string): string {
  const cleaned = name
    .replace(/[\\/]/g, '_')
    .replace(/[<>:"|?*\u0000-\u001f]/g, '_')
    .replace(/^\.+/, '_')
    .slice(0, 120)
    .trim();
  return cleaned.length > 0 ? cleaned : 'fichier';
}

function buildTempPath(tempDir: string, name: string): string {
  return path.join(tempDir, `filarrbox_${Date.now()}_${randomBytes(3).toString('hex')}_${sanitizeTempName(name)}`);
}

/** Streaming SHA-256 (hex) of a plaintext file — flat memory. */
async function sha256FileHex(filePath: string): Promise<string> {
  const handle = await open(filePath, 'r');
  try {
    const hash = createHash('sha256');
    const buf = Buffer.allocUnsafe(1024 * 1024);
    let position = 0;
    for (;;) {
      const { bytesRead } = await handle.read(buf, 0, buf.length, position);
      if (bytesRead <= 0) {
        break;
      }
      hash.update(buf.subarray(0, bytesRead));
      position += bytesRead;
    }
    return hash.digest('hex');
  } finally {
    await handle.close().catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// Header + metadata (read side)
// ---------------------------------------------------------------------------

/**
 * Structural validation ladder (NO key needed): magic, version, kind, metaLen
 * bounds, then the embedded V3 payload's own header + total-length equation
 * (containerSize === 16 + metaLen + 50 + nChunks*16 + origSize). Throws
 * ERR_BOX_CORRUPT / ERR_BOX_NEWER / ERR_BOX_UNREADABLE in French.
 */
export async function readContainerHeader(boxPath: string): Promise<BoxHeaderInfo> {
  let containerSize: number;
  try {
    const st = await stat(boxPath);
    if (!st.isFile()) {
      throw new Error(ERR_BOX_UNREADABLE);
    }
    containerSize = st.size;
  } catch (error) {
    throw error instanceof Error && error.message === ERR_BOX_UNREADABLE ? error : new Error(ERR_BOX_UNREADABLE);
  }
  if (containerSize < BOX_HEADER_SIZE) {
    throw new Error(ERR_BOX_CORRUPT);
  }
  let head: Buffer;
  const handle = await open(boxPath, 'r').catch(() => {
    throw new Error(ERR_BOX_UNREADABLE);
  });
  try {
    head = await readExactAt(handle, 0, BOX_HEADER_SIZE);
  } finally {
    await handle.close().catch(() => undefined);
  }
  if (!head.subarray(0, BOX_MAGIC.length).equals(BOX_MAGIC)) {
    throw new Error(ERR_BOX_CORRUPT);
  }
  const version = head.readUInt8(10);
  if (version === 0) {
    throw new Error(ERR_BOX_CORRUPT);
  }
  if (version > BOX_VERSION) {
    throw new Error(ERR_BOX_NEWER);
  }
  const kindByte = head.readUInt8(11);
  if (kindByte > BOX_KIND_FOLDER) {
    throw new Error(ERR_BOX_CORRUPT);
  }
  const metaLen = head.readUInt32LE(12);
  if (metaLen < META_MIN_LEN || metaLen > META_MAX_LEN) {
    throw new Error(ERR_BOX_CORRUPT);
  }
  const payloadOffset = BOX_HEADER_SIZE + metaLen;
  if (payloadOffset + V3_HEADER_SIZE > containerSize) {
    throw new Error(ERR_BOX_CORRUPT);
  }
  let payloadSize: number;
  try {
    const v3 = await statV3File(boxPath, { baseOffset: payloadOffset });
    payloadSize = v3.origSize;
  } catch {
    throw new Error(ERR_BOX_CORRUPT);
  }
  return {
    version,
    kind: kindByte === BOX_KIND_FOLDER ? BOX_KIND_FOLDER : BOX_KIND_FILE,
    metaLen,
    payloadOffset,
    payloadSize,
    containerSize,
  };
}

function parseMetadataJson(plain: Buffer, header: BoxHeaderInfo): BoxMetadata {
  let raw: unknown;
  try {
    raw = JSON.parse(plain.toString('utf8'));
  } catch {
    throw new Error(ERR_BOX_CORRUPT);
  }
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(ERR_BOX_CORRUPT);
  }
  const record = raw as Record<string, unknown>;
  const { v, name, size, createdAt, entryCount } = record;
  if (v !== 1 || typeof name !== 'string' || name.length === 0 || typeof createdAt !== 'string') {
    throw new Error(ERR_BOX_CORRUPT);
  }
  if (typeof size !== 'number' || !Number.isSafeInteger(size) || size < 0 || size !== header.payloadSize) {
    throw new Error(ERR_BOX_CORRUPT);
  }
  const metadata: BoxMetadata = { v: 1, name, size, createdAt };
  if (entryCount !== undefined) {
    if (typeof entryCount !== 'number' || !Number.isSafeInteger(entryCount) || entryCount < 0) {
      throw new Error(ERR_BOX_CORRUPT);
    }
    metadata.entryCount = entryCount;
  }
  return metadata;
}

/**
 * Reads the header, then probes each candidate key against the metadata GCM
 * (cheap — tens of bytes, cryptographically equivalent to a payload probe:
 * a wrong key fails the tag). Returns the authenticated metadata and the
 * winning key (a reference into the caller's candidates, NOT a copy).
 * Structure valid + no key authenticates → ERR_BOX_WRONG_KEY (ladder 3).
 */
export async function readContainerMetadata(
  keyInput: BoxKeyInput,
  boxPath: string
): Promise<{ header: BoxHeaderInfo; metadata: BoxMetadata; key: Buffer }> {
  const header = await readContainerHeader(boxPath);
  const handle = await open(boxPath, 'r').catch(() => {
    throw new Error(ERR_BOX_UNREADABLE);
  });
  let headBytes: Buffer;
  let metaBlock: Buffer;
  try {
    headBytes = await readExactAt(handle, 0, BOX_HEADER_SIZE);
    metaBlock = await readExactAt(handle, BOX_HEADER_SIZE, header.metaLen);
  } finally {
    await handle.close().catch(() => undefined);
  }
  const salt = metaBlock.subarray(0, META_SALT_SIZE);
  const nonce = metaBlock.subarray(META_SALT_SIZE, META_SALT_SIZE + META_NONCE_SIZE);
  const ciphertext = metaBlock.subarray(META_SALT_SIZE + META_NONCE_SIZE, header.metaLen - META_TAG_SIZE);
  const tag = metaBlock.subarray(header.metaLen - META_TAG_SIZE, header.metaLen);

  for (const key of candidateKeys(keyInput)) {
    const metaKey = deriveMetaKey(key, salt);
    try {
      const decipher = createDecipheriv('aes-256-gcm', metaKey, nonce, { authTagLength: META_TAG_SIZE });
      decipher.setAAD(headBytes);
      decipher.setAuthTag(tag);
      const plain = decipher.update(ciphertext);
      decipher.final();
      return { header, metadata: parseMetadataJson(plain, header), key };
    } catch (error) {
      // Authenticated-but-malformed metadata is corruption, not a key issue.
      if (error instanceof Error && (error.message === ERR_BOX_CORRUPT || error.message === ERR_BOX_NEWER)) {
        throw error;
      }
      // GCM auth failure → try the next candidate.
    } finally {
      metaKey.fill(0);
    }
  }
  throw new Error(ERR_BOX_WRONG_KEY);
}

// ---------------------------------------------------------------------------
// Pack (write side)
// ---------------------------------------------------------------------------

/** BoxHeader + EncryptedMetadata bytes (AAD = the 16 header bytes). */
function buildBoxPrefix(masterKey: Buffer, kind: BoxKind, metadata: BoxMetadata): Buffer {
  const plain = Buffer.from(JSON.stringify(metadata), 'utf8');
  const metaLen = META_OVERHEAD + plain.length;
  if (metaLen > META_MAX_LEN) {
    throw new Error(ERR_BOX_META_TOO_LARGE);
  }
  const head = Buffer.alloc(BOX_HEADER_SIZE);
  BOX_MAGIC.copy(head, 0);
  head.writeUInt8(BOX_VERSION, 10);
  head.writeUInt8(kind, 11);
  head.writeUInt32LE(metaLen, 12);
  const salt = randomBytes(META_SALT_SIZE);
  const nonce = randomBytes(META_NONCE_SIZE);
  const metaKey = deriveMetaKey(masterKey, salt);
  try {
    const cipher = createCipheriv('aes-256-gcm', metaKey, nonce, { authTagLength: META_TAG_SIZE });
    cipher.setAAD(head);
    const ciphertext = cipher.update(plain);
    cipher.final();
    return Buffer.concat([head, salt, nonce, ciphertext, cipher.getAuthTag()]);
  } finally {
    metaKey.fill(0);
  }
}

/** Writes the prefix exclusively ('wx' — never overwrite an existing box). */
async function writePrefixExclusive(destPath: string, prefix: Buffer): Promise<void> {
  let handle: FileHandle;
  try {
    handle = await open(destPath, 'wx');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    throw new Error(code === 'EEXIST' ? ERR_BOX_DEST_EXISTS : ERR_BOX_UNREADABLE);
  }
  try {
    await handle.write(prefix, 0, prefix.length, 0);
  } finally {
    await handle.close().catch(() => undefined);
  }
}

/**
 * Packs ONE file into a `.filarr` container at destPath (typically a staging
 * path in the destination directory — same-volume atomic rename is the
 * caller's job). The source SHA-256 is streamed BEFORE encryption (mutation
 * detector); verify with hashContainerPlaintextHex() before anything
 * destructive. On any failure destPath is removed and the source untouched.
 */
export async function packFileContainer(
  masterKey: Buffer,
  srcPath: string,
  destPath: string,
  onProgress?: BoxProgress,
  opts?: {
    /**
     * Metadata name to record instead of basename(srcPath) — the
     * rewrite-on-save watcher repacks from a mangled temp copy but must
     * keep the container's original name.
     */
    nameOverride?: string;
  }
): Promise<PackContainerResult> {
  let st;
  try {
    st = await lstat(srcPath);
  } catch {
    throw new Error(ERR_BOX_SOURCE_MISSING);
  }
  if (st.isSymbolicLink()) {
    throw new Error(ERR_BOX_SOURCE_SYMLINK);
  }
  if (!st.isFile()) {
    throw new Error(ERR_BOX_SOURCE_NOT_FILE);
  }
  if (st.size > MAX_PAYLOAD_SIZE) {
    throw new Error(ERR_BOX_FILE_TOO_LARGE);
  }
  const sourceSha256Hex = await sha256FileHex(srcPath);
  const metadata: BoxMetadata = {
    v: 1,
    name: opts?.nameOverride ?? path.basename(srcPath),
    size: st.size,
    createdAt: new Date().toISOString(),
  };
  const prefix = buildBoxPrefix(masterKey, BOX_KIND_FILE, metadata);
  // Only unlink a file WE created: an EEXIST refusal must never destroy a
  // pre-existing container at destPath.
  let created = false;
  let ok = false;
  try {
    await writePrefixExclusive(destPath, prefix);
    created = true;
    await encryptFileToFileV3(masterKey, srcPath, destPath, onProgress, { baseOffset: prefix.length });
    ok = true;
  } finally {
    if (!ok && created) {
      await unlink(destPath).catch(() => undefined);
    }
  }
  return { destPath, kind: BOX_KIND_FILE, metadata, sourceSha256Hex };
}

/**
 * Packs a FOLDER into a single `.filarr` container: lstat-only scan (5 GiB /
 * 50 000 entry caps, ustar path limits, symlinks skipped), then the tar
 * stream is produced on demand straight into V3 encryption — the plaintext
 * tar never exists on disk or in RAM. Returns the tar SHA-256 for
 * verify-before-delete. On any failure destPath is removed.
 */
export async function packFolderContainer(
  masterKey: Buffer,
  srcDir: string,
  destPath: string,
  onProgress?: BoxProgress
): Promise<PackContainerResult> {
  let st;
  try {
    st = await lstat(srcDir);
  } catch {
    throw new Error(ERR_BOX_SOURCE_MISSING);
  }
  if (st.isSymbolicLink()) {
    throw new Error(ERR_BOX_SOURCE_SYMLINK);
  }
  if (!st.isDirectory()) {
    throw new Error(ERR_BOX_SOURCE_NOT_DIR);
  }
  const scan = await scanFolderForTar(srcDir);
  const metadata: BoxMetadata = {
    v: 1,
    name: path.basename(srcDir),
    size: scan.tarSize,
    createdAt: new Date().toISOString(),
    entryCount: scan.fileCount,
  };
  const prefix = buildBoxPrefix(masterKey, BOX_KIND_FOLDER, metadata);
  const producer = createTarChunkProducer(srcDir, scan.entries);
  // Only unlink a file WE created: an EEXIST refusal must never destroy a
  // pre-existing container at destPath.
  let created = false;
  let ok = false;
  try {
    await writePrefixExclusive(destPath, prefix);
    created = true;
    await encryptStreamToFileV3(masterKey, scan.tarSize, destPath, producer.readChunk, onProgress, {
      baseOffset: prefix.length,
    });
    ok = true;
  } finally {
    if (!ok && created) {
      await unlink(destPath).catch(() => undefined);
    }
  }
  return {
    destPath,
    kind: BOX_KIND_FOLDER,
    metadata,
    sourceSha256Hex: producer.sha256Hex(),
    skippedSymlinks: scan.skippedSymlinks,
  };
}

// ---------------------------------------------------------------------------
// Open / list / extract (read side)
// ---------------------------------------------------------------------------

/**
 * Decrypts a SINGLE-FILE container to a temp file (flat memory, every chunk
 * GCM-verified) and returns its path — the caller registers it for tracked
 * purge and opens it. The winning key is returned for the re-encrypt-on-save
 * watcher. Wrong key → clean French error, no temp file is ever created.
 */
export async function openContainerToTemp(
  keyInput: BoxKeyInput,
  boxPath: string,
  opts?: { tempDir?: string; onProgress?: BoxProgress }
): Promise<{ tempPath: string; metadata: BoxMetadata; key: Buffer }> {
  const { header, metadata, key } = await readContainerMetadata(keyInput, boxPath);
  if (header.kind !== BOX_KIND_FILE) {
    throw new Error(ERR_BOX_NOT_A_FILE_BOX);
  }
  const tempPath = buildTempPath(opts?.tempDir ?? tmpdir(), metadata.name);
  try {
    await decryptFileToFileV3(key, boxPath, tempPath, opts?.onProgress, { baseOffset: header.payloadOffset });
  } catch (error) {
    // decryptFileToFileV3 already unlinked its partial temp output.
    throw mapPayloadError(error);
  }
  return { tempPath, metadata, key };
}

/**
 * Lists a FOLDER container without materializing any file data: the tar
 * index is walked through an authenticated V3 window (headers only, 512 B
 * reads served from the reader's 8 MiB chunk cache).
 */
export async function listFolderContainer(
  keyInput: BoxKeyInput,
  boxPath: string
): Promise<{ metadata: BoxMetadata; entries: BoxFolderEntry[]; key: Buffer }> {
  const { header, metadata, key } = await readContainerMetadata(keyInput, boxPath);
  if (header.kind !== BOX_KIND_FOLDER) {
    throw new Error(ERR_BOX_NOT_A_FOLDER_BOX);
  }
  const reader = await V3FileReader.open(key, boxPath, { baseOffset: header.payloadOffset });
  try {
    const index = await walkTarIndex((offset, length) => reader.read(offset, length), header.payloadSize);
    return {
      metadata,
      entries: index.map((e) => ({ path: e.path, size: e.size, isDir: e.isDir })),
      key,
    };
  } catch (error) {
    throw mapPayloadError(error);
  } finally {
    await reader.close();
  }
}

/**
 * Extracts ONE file entry of a FOLDER container to a temp file (streamed in
 * 8 MiB authenticated slices — flat memory). `entryPath` must exactly match
 * a file entry from listFolderContainer(). Read-only mini-vault semantics:
 * the temp copy is never re-packed into the container.
 */
export async function extractOneEntryToTemp(
  keyInput: BoxKeyInput,
  boxPath: string,
  entryPath: string,
  opts?: { tempDir?: string; onProgress?: BoxProgress }
): Promise<{ tempPath: string; size: number; metadata: BoxMetadata }> {
  const { header, metadata, key } = await readContainerMetadata(keyInput, boxPath);
  if (header.kind !== BOX_KIND_FOLDER) {
    throw new Error(ERR_BOX_NOT_A_FOLDER_BOX);
  }
  const reader = await V3FileReader.open(key, boxPath, { baseOffset: header.payloadOffset });
  try {
    const index = await walkTarIndex((offset, length) => reader.read(offset, length), header.payloadSize);
    const entry = index.find((e) => !e.isDir && e.path === entryPath);
    if (!entry) {
      throw new Error(ERR_BOX_ENTRY_NOT_FOUND);
    }
    const parts = entry.path.split('/');
    const tempPath = buildTempPath(opts?.tempDir ?? tmpdir(), parts[parts.length - 1]);
    const out = await open(tempPath, 'wx');
    let ok = false;
    try {
      let position = 0;
      while (position < entry.size) {
        const want = Math.min(EXTRACT_SLICE, entry.size - position);
        const slice = await reader.read(entry.offset + position, want);
        if (slice.length !== want) {
          throw new Error(ERR_BOX_CORRUPT);
        }
        await out.write(slice, 0, want, position);
        position += want;
        if (opts?.onProgress) {
          opts.onProgress(position, entry.size);
        }
      }
      ok = true;
    } finally {
      await out.close().catch(() => undefined);
      if (!ok) {
        await unlink(tempPath).catch(() => undefined);
      }
    }
    return { tempPath, size: entry.size, metadata };
  } catch (error) {
    throw mapPayloadError(error);
  } finally {
    await reader.close();
  }
}

// ---------------------------------------------------------------------------
// Verify (move flow) + disambiguation sniff
// ---------------------------------------------------------------------------

/**
 * Streams the container's decrypted payload through SHA-256 (every chunk
 * GCM-verified, flat memory, no plaintext on disk) — the verify half of
 * "protéger sur place" before the original may be secure-deleted.
 */
export async function hashContainerPlaintextHex(keyInput: BoxKeyInput, boxPath: string): Promise<string> {
  const { header, key } = await readContainerMetadata(keyInput, boxPath);
  try {
    const digest = await hashV3Plaintext(key, boxPath, { baseOffset: header.payloadOffset });
    return digest.toString('hex');
  } catch (error) {
    throw mapPayloadError(error);
  }
}

/**
 * True only when the container re-parses (header + metadata GCM) AND its
 * decrypted payload hashes to `expectedSha256Hex`. Never throws — any
 * failure is a verification failure (the caller keeps the original).
 */
export async function verifyContainerHash(
  keyInput: BoxKeyInput,
  boxPath: string,
  expectedSha256Hex: string
): Promise<boolean> {
  try {
    const actual = await hashContainerPlaintextHex(keyInput, boxPath);
    return actual === expectedSha256Hex.toLowerCase();
  } catch {
    return false;
  }
}

export type FilarrFileType = 'box' | 'note' | 'unknown';

/**
 * First-bytes disambiguation for the shared `.filarr` extension:
 *   - "FILARRBOX\0"                     → 'box'  (encrypted container)
 *   - optional BOM/whitespace then '{'  → 'note' (plaintext JSON note backup)
 *   - anything else (incl. a renamed raw V3 blob) → 'unknown'
 * A box NEVER reaches the JSON note importer and vice versa.
 */
export async function sniffFilarrFile(filePath: string): Promise<FilarrFileType> {
  let handle: FileHandle;
  try {
    handle = await open(filePath, 'r');
  } catch {
    return 'unknown';
  }
  let head: Buffer;
  try {
    const buf = Buffer.allocUnsafe(4096);
    const { bytesRead } = await handle.read(buf, 0, buf.length, 0);
    head = buf.subarray(0, Math.max(0, bytesRead));
  } catch {
    return 'unknown';
  } finally {
    await handle.close().catch(() => undefined);
  }
  if (head.length >= BOX_MAGIC.length && head.subarray(0, BOX_MAGIC.length).equals(BOX_MAGIC)) {
    return 'box';
  }
  let i = 0;
  if (head.length >= 3 && head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf) {
    i = 3; // UTF-8 BOM
  }
  while (i < head.length && (head[i] === 0x20 || head[i] === 0x09 || head[i] === 0x0a || head[i] === 0x0d)) {
    i++;
  }
  if (i < head.length && head[i] === 0x7b) {
    return 'note';
  }
  return 'unknown';
}
