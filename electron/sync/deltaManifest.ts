/**
 * deltaManifest.ts — Pure delta-sync manifest + diff engine (V4).
 *
 * This module is the SYNC-LAYER data structure + set-arithmetic core for
 * block-level delta sync. It is deliberately PURE:
 *   - NO network, NO Electron, NO filesystem.
 *   - node:crypto is used for HASHING ONLY (SHA-256 hex of caller-supplied
 *     bytes) — never for random material, key derivation, or ciphering.
 *
 * The crypto/transport concerns (HKDF deltaKey, AES-256-GCM block objects,
 * R2 upload/download, FEK manifest encryption) live in the sibling
 * deltaSync.ts / worker routes. This file only knows about ordered block
 * metadata {index, hash, size}, the versioned manifest JSON, the fixed
 * 8 MiB-boundary diff, quota arithmetic, and stable (de)serialization.
 *
 * MANIFEST SCHEMA (plaintext JSON, before FEK encryption elsewhere):
 *   {
 *     fmt: "filarr-delta-manifest",   // magic; mismatch/absent => legacy
 *     v: 4,                           // FORMAT version; v<4 => legacy
 *     fileId, algo: "AES-256-GCM",
 *     blockSize: 8388608,             // FIXED 8 MiB plaintext boundary
 *     totalSize,                      // sum of block sizes == V3 origSize
 *     blockCount,
 *     kdf: { name: "HKDF-SHA256", salt: <b64 16B>, info: "filarr-delta-v4" },
 *     plaintextChecksum: <sha256 hex of whole plaintext>,
 *     blocks: [ { i, h, s }, ... ],   // ORDERED by i; last s may be < blockSize
 *     createdAt, device?
 *   }
 *
 * The OPTIMISTIC-LOCK / sync version is SERVER-authoritative (D1 file_deltas)
 * and is DELIBERATELY NOT stored in this JSON — mirroring the global manifest
 * pattern. The `v` field here is the immutable FORMAT version only.
 */

import { createHash } from 'node:crypto';

// ── Constants (locked in code — do not diverge from the V4 design) ───────────

/** Magic string identifying a delta manifest JSON. */
export const DELTA_MANIFEST_FMT = 'filarr-delta-manifest';
/** Manifest FORMAT version. Anything < this on read is legacy => no delta. */
export const DELTA_MANIFEST_VERSION = 4;
/** Fixed 8 MiB plaintext block boundary (== V3_CHUNK_SIZE so V3 chunks align 1:1). */
export const DELTA_BLOCK_SIZE = 8 * 1024 * 1024;
/** HKDF info string for the per-file delta key (domain-separated from V3). */
export const DELTA_HKDF_INFO = 'filarr-delta-v4';
/** Block cipher algorithm recorded in the manifest. */
export const DELTA_ALGO = 'AES-256-GCM';
/**
 * Per stored block object overhead: version(1) + nonce(12) + tag(16) = 29 bytes.
 * Stored (encrypted) object size E = plaintextSize + DELTA_BLOCK_OVERHEAD.
 */
export const DELTA_BLOCK_OVERHEAD = 29;
/** Opt-in floor: delta only engages for files >= 64 MiB (== MULTIPART_THRESHOLD). */
export const DELTA_THRESHOLD = 64 * 1024 * 1024;
/** Block address = lowercase SHA-256 hex (64 chars). */
export const DELTA_BLOCK_HASH_RE = /^[0-9a-f]{64}$/;

// ── Error strings (ASCII-safe French, matching streamCrypto.ts convention) ───

const ERR_MANIFEST_PARSE = 'Manifeste delta illisible (JSON invalide)';
const ERR_MANIFEST_INVALID = 'Manifeste delta invalide';
const ERR_HASH_FORMAT = 'Hash de bloc invalide (SHA-256 hex attendu)';
const ERR_INDEX_ORDER = 'Blocs du manifeste delta non ordonnes/contigus';
const ERR_SIZE_MISMATCH = 'Taille totale incoherente dans le manifeste delta';

// ── Types ────────────────────────────────────────────────────────────────────

/** One block entry as stored in the manifest JSON. `i` index, `h` sha256 hex, `s` plaintext size. */
export interface BlockEntry {
  i: number;
  h: string;
  s: number;
}

/** KDF descriptor stored in the manifest (salt is per-file, base64 16B). */
export interface DeltaKdf {
  name: string;
  salt: string;
  info: string;
}

/**
 * The versioned delta manifest.
 *
 * The index signature makes the type forward-compatible: a future client may
 * add top-level fields; they ride along at runtime and are preserved by
 * serialize/deserialize without an older client dropping them. Known fields
 * keep their precise declared types (the index only governs *undeclared* keys).
 */
export interface DeltaManifest {
  fmt: string;
  v: number;
  fileId: string;
  algo: string;
  blockSize: number;
  totalSize: number;
  blockCount: number;
  kdf: DeltaKdf;
  plaintextChecksum: string;
  blocks: BlockEntry[];
  createdAt: string;
  device?: string;
  [extra: string]: unknown;
}

/** Ergonomic external shape for a locally-hashed chunk (pass to buildManifest / diffManifests). */
export interface LocalBlock {
  index: number;
  hash: string;
  size: number;
}

/** Optional non-positional fields for buildManifest. */
export interface BuildManifestOptions {
  /** Plaintext block boundary. Defaults to DELTA_BLOCK_SIZE (8 MiB). */
  blockSize?: number;
  /** Cipher algorithm string. Defaults to DELTA_ALGO. */
  algo?: string;
  /** Per-file HKDF salt, base64 (16 raw bytes). Supplied by the crypto layer. */
  saltB64?: string;
  /** HKDF info string. Defaults to DELTA_HKDF_INFO. */
  hkdfInfo?: string;
  /** SHA-256 hex of the WHOLE plaintext (end-to-end reassembly verify + change detection). */
  plaintextChecksum?: string;
  /** ISO timestamp. Defaults to now. */
  createdAt?: string;
  /** Informational device id. */
  device?: string;
}

/** A unique block to encrypt+upload (deduped: one entry per unique hash). */
export interface UploadBlock {
  index: number; // a representative index (first occurrence) of this hash
  hash: string;
  size: number;
}

/** A block referenced by the new manifest at a given ordered position. */
export interface ReferenceBlock {
  index: number;
  hash: string;
}

/** Result of diffing local chunks against a remote manifest. */
export interface DiffResult {
  /** Unique local hashes NOT present remotely — each uploaded once. */
  toUpload: UploadBlock[];
  /** Full ordered local block list (becomes manifest.blocks) — {index, hash}. */
  toReference: ReferenceBlock[];
  /** Number of local block POSITIONS whose hash already exists remotely. */
  unchangedCount: number;
  /**
   * True when the ordered local (hash, size) sequence differs from the remote
   * one (or remote is null) — i.e. a new manifest must be committed even if
   * `toUpload` is empty (covers pure reorders). False only when the file is
   * byte-for-byte identical to the remote manifest.
   */
  manifestChanged: boolean;
}

/** Block-object quota change for an edit (manifest-object delta handled by the worker). */
export interface QuotaDelta {
  addedBytes: number;
  removedBytes: number;
}

// ── Hashing helper (the only node:crypto use) ────────────────────────────────

/** Lowercase SHA-256 hex of the given bytes. */
export function sha256Hex(data: Buffer | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

// ── Internal guards ──────────────────────────────────────────────────────────

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function isFiniteInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && Number.isInteger(v);
}

function isString(v: unknown): v is string {
  return typeof v === 'string';
}

// ── buildManifest ────────────────────────────────────────────────────────────

/**
 * Build a versioned delta manifest from an ordered list of locally-hashed
 * chunks. `chunks` order defines the plaintext order; it is sorted defensively
 * by `index` and validated to be contiguous 0..n-1.
 *
 * @param fileId    real file id (bound into block AAD by the crypto layer)
 * @param chunks    ordered local block metadata {index, hash, size}
 * @param totalSize sum of block sizes (== V3 origSize); cross-checked
 * @param version   manifest FORMAT version (defaults/pins to 4). The sync
 *                  optimistic-lock version lives in D1, NOT here.
 * @param options   salt / plaintextChecksum / device / createdAt / blockSize
 * @throws French error if hashes are malformed or the cross-checks fail.
 */
export function buildManifest(
  fileId: string,
  chunks: LocalBlock[],
  totalSize: number,
  version: number = DELTA_MANIFEST_VERSION,
  options: BuildManifestOptions = {}
): DeltaManifest {
  if (!isString(fileId) || fileId.length === 0) {
    throw new Error(ERR_MANIFEST_INVALID);
  }
  if (!isFiniteInt(totalSize) || totalSize < 0) {
    throw new Error(ERR_SIZE_MISMATCH);
  }
  if (!isFiniteInt(version) || version < DELTA_MANIFEST_VERSION) {
    throw new Error(ERR_MANIFEST_INVALID);
  }

  const ordered = [...chunks].sort((a, b) => a.index - b.index);
  const blocks: BlockEntry[] = [];
  let sum = 0;
  for (let k = 0; k < ordered.length; k++) {
    const c = ordered[k];
    if (!isFiniteInt(c.index) || c.index !== k) {
      throw new Error(ERR_INDEX_ORDER);
    }
    if (!isString(c.hash) || !DELTA_BLOCK_HASH_RE.test(c.hash)) {
      throw new Error(ERR_HASH_FORMAT);
    }
    if (!isFiniteInt(c.size) || c.size < 0) {
      throw new Error(ERR_SIZE_MISMATCH);
    }
    blocks.push({ i: c.index, h: c.hash, s: c.size });
    sum += c.size;
  }

  if (sum !== totalSize) {
    throw new Error(ERR_SIZE_MISMATCH);
  }

  const kdf: DeltaKdf = {
    name: 'HKDF-SHA256',
    salt: options.saltB64 ?? '',
    info: options.hkdfInfo ?? DELTA_HKDF_INFO,
  };

  const manifest: DeltaManifest = {
    fmt: DELTA_MANIFEST_FMT,
    v: version,
    fileId,
    algo: options.algo ?? DELTA_ALGO,
    blockSize: options.blockSize ?? DELTA_BLOCK_SIZE,
    totalSize,
    blockCount: blocks.length,
    kdf,
    plaintextChecksum: options.plaintextChecksum ?? '',
    blocks,
    createdAt: options.createdAt ?? new Date().toISOString(),
  };
  if (options.device !== undefined) {
    manifest.device = options.device;
  }
  return manifest;
}

// ── diffManifests ────────────────────────────────────────────────────────────

/**
 * Ordered fixed-boundary diff of local chunks against a remote manifest.
 *
 * - remote null (first upload / legacy / fmt-mismatch) => every unique local
 *   hash is new; toUpload = distinct(local hashes), unchangedCount = 0.
 * - toUpload dedupes: a hash present at multiple local indices is uploaded
 *   ONCE (represented by its first occurrence).
 * - toReference is the FULL ordered local list ({index, hash}) — it becomes
 *   the new manifest.blocks. Order == plaintext order.
 * - unchangedCount counts local POSITIONS whose hash already exists remotely.
 * - manifestChanged is true whenever the ordered (hash,size) sequence differs
 *   from remote (covers pure reorders where toUpload is empty).
 */
export function diffManifests(
  localChunks: LocalBlock[],
  remoteManifest: DeltaManifest | null
): DiffResult {
  const ordered = [...localChunks].sort((a, b) => a.index - b.index);

  const remoteBlocks = remoteManifest?.blocks ?? [];
  const remoteHashes = new Set<string>();
  for (const b of remoteBlocks) remoteHashes.add(b.h);

  const toReference: ReferenceBlock[] = [];
  const toUpload: UploadBlock[] = [];
  const seenUpload = new Set<string>();
  let unchangedCount = 0;

  for (const c of ordered) {
    toReference.push({ index: c.index, hash: c.hash });

    const presentRemotely = remoteHashes.has(c.hash);
    if (presentRemotely) {
      unchangedCount++;
    } else if (!seenUpload.has(c.hash)) {
      seenUpload.add(c.hash);
      toUpload.push({ index: c.index, hash: c.hash, size: c.size });
    }
    // A hash that is new but already queued (identical adjacent/duplicate
    // block) is neither re-queued (dedup) nor counted as unchanged.
  }

  const manifestChanged = orderedSequenceChanged(ordered, remoteBlocks, remoteManifest !== null);

  return { toUpload, toReference, unchangedCount, manifestChanged };
}

/** True if the local ordered (hash,size) sequence differs from remote's. */
function orderedSequenceChanged(
  local: LocalBlock[],
  remote: BlockEntry[],
  remoteExists: boolean
): boolean {
  if (!remoteExists) return true;
  if (local.length !== remote.length) return true;
  for (let k = 0; k < local.length; k++) {
    if (local[k].hash !== remote[k].h || local[k].size !== remote[k].s) {
      return true;
    }
  }
  return false;
}

// ── computeQuotaDelta ────────────────────────────────────────────────────────

/**
 * Block-object quota change from oldManifest -> newManifest, counted over
 * UNIQUE block hashes (content-addressed store):
 *   - a hash referenced by BOTH manifests: net 0 (already present, still live);
 *   - a hash only in new: added (its stored size E);
 *   - a hash only in old: removed (reclaimable by GC after commit).
 *
 * `blockSizeByHash` provides the authoritative STORED (encrypted) object size
 * per hash. When a hash is absent from the map, the stored size is derived from
 * whichever manifest carries it (plaintext s + DELTA_BLOCK_OVERHEAD).
 *
 * The manifest-object size delta is accounted separately by the worker and is
 * intentionally NOT included here.
 */
export function computeQuotaDelta(
  oldManifest: DeltaManifest | null,
  newManifest: DeltaManifest | null,
  blockSizeByHash: ReadonlyMap<string, number>
): QuotaDelta {
  const oldHashes = uniqueHashes(oldManifest);
  const newHashes = uniqueHashes(newManifest);

  let addedBytes = 0;
  for (const h of newHashes) {
    if (!oldHashes.has(h)) {
      addedBytes += storedSizeOf(h, blockSizeByHash, newManifest, oldManifest);
    }
  }

  let removedBytes = 0;
  for (const h of oldHashes) {
    if (!newHashes.has(h)) {
      removedBytes += storedSizeOf(h, blockSizeByHash, oldManifest, newManifest);
    }
  }

  return { addedBytes, removedBytes };
}

function uniqueHashes(manifest: DeltaManifest | null): Set<string> {
  const set = new Set<string>();
  if (!manifest) return set;
  for (const b of manifest.blocks) set.add(b.h);
  return set;
}

function storedSizeOf(
  hash: string,
  blockSizeByHash: ReadonlyMap<string, number>,
  primary: DeltaManifest | null,
  secondary: DeltaManifest | null
): number {
  const explicit = blockSizeByHash.get(hash);
  if (explicit !== undefined) return explicit;
  const fromPrimary = plaintextSizeFromManifest(hash, primary);
  if (fromPrimary !== null) return fromPrimary + DELTA_BLOCK_OVERHEAD;
  const fromSecondary = plaintextSizeFromManifest(hash, secondary);
  if (fromSecondary !== null) return fromSecondary + DELTA_BLOCK_OVERHEAD;
  return 0;
}

function plaintextSizeFromManifest(hash: string, manifest: DeltaManifest | null): number | null {
  if (!manifest) return null;
  for (const b of manifest.blocks) {
    if (b.h === hash) return b.s;
  }
  return null;
}

// ── Ordered accessor ─────────────────────────────────────────────────────────

/** Returns manifest.blocks sorted by index (defensive copy). */
export function orderedBlocks(manifest: DeltaManifest): BlockEntry[] {
  return [...manifest.blocks].sort((a, b) => a.i - b.i);
}

// ── Serialize / Deserialize (stable, versioned, forward-compatible) ──────────

/**
 * Deterministic JSON serialization: top-level and nested object keys are sorted
 * (arrays keep their order, so blocks[] stays in plaintext order). Unknown
 * top-level fields present at runtime are preserved.
 */
export function serializeManifest(manifest: DeltaManifest): string {
  return JSON.stringify(sortKeysDeep(manifest));
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      out[key] = sortKeysDeep(obj[key]);
    }
    return out;
  }
  return value;
}

/**
 * Strict parse + validate. Tolerates unknown fields and future format versions
 * (v > 4), preserving unknown top-level fields on the returned object.
 * @throws French error on malformed JSON or a structurally-invalid manifest
 *         (including legacy fmt mismatch or v < 4).
 */
export function deserializeManifest(json: string): DeltaManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error(ERR_MANIFEST_PARSE);
  }
  const manifest = validateManifest(parsed);
  if (!manifest) {
    throw new Error(ERR_MANIFEST_INVALID);
  }
  return manifest;
}

/**
 * Tolerant parse: returns null for anything that is not a valid v>=4 delta
 * manifest — null/empty input, malformed JSON, fmt mismatch, or v < 4 (legacy).
 * Used by the diff pipeline so a legacy/absent remote is treated as "no delta"
 * (=> full first upload) instead of throwing.
 */
export function tryDeserializeManifest(json: string | null | undefined): DeltaManifest | null {
  if (json === null || json === undefined || json.length === 0) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  return validateManifest(parsed);
}

/**
 * Validate an already-parsed value as a DeltaManifest. Returns the (extras-
 * preserving) manifest, or null if it is not a structurally-valid v>=4 delta
 * manifest. Cross-checks blockCount / totalSize / contiguous ordering.
 */
function validateManifest(parsed: unknown): DeltaManifest | null {
  const raw = asRecord(parsed);
  if (!raw) return null;

  if (raw.fmt !== DELTA_MANIFEST_FMT) return null;
  if (!isFiniteInt(raw.v) || raw.v < DELTA_MANIFEST_VERSION) return null;

  if (!isString(raw.fileId) || raw.fileId.length === 0) return null;
  if (!isString(raw.algo)) return null;
  if (!isFiniteInt(raw.blockSize) || raw.blockSize <= 0) return null;
  if (!isFiniteInt(raw.totalSize) || raw.totalSize < 0) return null;
  if (!isFiniteInt(raw.blockCount) || raw.blockCount < 0) return null;
  if (!isString(raw.plaintextChecksum)) return null;
  if (!isString(raw.createdAt)) return null;

  const kdfRaw = asRecord(raw.kdf);
  if (!kdfRaw || !isString(kdfRaw.name) || !isString(kdfRaw.salt) || !isString(kdfRaw.info)) {
    return null;
  }
  const kdf: DeltaKdf = { name: kdfRaw.name, salt: kdfRaw.salt, info: kdfRaw.info };

  if (!Array.isArray(raw.blocks)) return null;
  const blocks: BlockEntry[] = [];
  let sum = 0;
  for (let k = 0; k < raw.blocks.length; k++) {
    const b = asRecord(raw.blocks[k]);
    if (!b) return null;
    if (!isFiniteInt(b.i) || b.i !== k) return null; // ordered + contiguous
    if (!isString(b.h) || !DELTA_BLOCK_HASH_RE.test(b.h)) return null;
    if (!isFiniteInt(b.s) || b.s < 0) return null;
    blocks.push({ i: b.i, h: b.h, s: b.s });
    sum += b.s;
  }

  if (blocks.length !== raw.blockCount) return null; // count cross-check
  if (sum !== raw.totalSize) return null; // total size cross-check

  // Rebuild with normalized known fields while preserving any unknown extras
  // (forward compatibility): spread raw first, then override validated fields.
  const manifest: DeltaManifest = {
    ...raw,
    fmt: DELTA_MANIFEST_FMT,
    v: raw.v,
    fileId: raw.fileId,
    algo: raw.algo,
    blockSize: raw.blockSize,
    totalSize: raw.totalSize,
    blockCount: raw.blockCount,
    kdf,
    plaintextChecksum: raw.plaintextChecksum,
    blocks,
    createdAt: raw.createdAt,
  };

  if (isString(raw.device)) {
    manifest.device = raw.device;
  } else {
    delete manifest.device;
  }

  return manifest;
}
