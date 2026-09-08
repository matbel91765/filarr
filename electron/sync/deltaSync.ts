/**
 * deltaSync.ts — CLIENT block-level delta sync orchestrator.
 *
 * Wires the pure crypto (deltaChunkCrypto) + pure diff/manifest engine
 * (deltaManifest) + the V3 streaming primitives (streamCrypto) + injected
 * worker/transport + FEK-crypto dependencies into the two flows syncService
 * drives: uploadDelta / downloadDelta.
 *
 * SYNC-LAYER ONLY. The local on-disk V3 format is never migrated: a delta file
 * is read as a normal V3-FEK container, split into fixed 8 MiB plaintext blocks,
 * and only the CHANGED blocks are (independently) AES-256-GCM encrypted and
 * uploaded as content-addressed cloud objects. Reassembly fetches the block
 * objects, decrypts+verifies each, and re-encrypts the plaintext straight into
 * a fresh V3-FEK blob — no plaintext ever touches disk.
 *
 * No Electron imports: all I/O beyond the local V3 file (reader) and the
 * ciphertext staging file goes through the injected `DeltaTransport`
 * (worker routes) and `DeltaCrypto` (FEK manifest E2EE + raw FEK). That keeps
 * the whole flow unit-testable against in-memory fakes.
 *
 * ── Content-addressing vs the block AAD index (KEY DECISION) ────────────────
 * deltaChunkCrypto.encryptBlock/decryptBlock bind a `chunkIndex` into the block
 * AAD. A content-addressed object (blocks/{hash}.enc) may be referenced at
 * MANY manifest positions and its position can move between versions while the
 * stored ciphertext (skipped by dedup) never changes — so the AAD index CANNOT
 * be the manifest position, or a skipped block would become undecryptable after
 * an edit shifts it. We therefore encrypt AND decrypt EVERY block with a single
 * CONSTANT AAD index (DELTA_AAD_INDEX = 0). Position/order integrity is carried
 * entirely by the FEK-authenticated, ordered manifest.blocks[]; after decrypt
 * we re-assert SHA-256(plaintext) == manifest.blocks[i].h (== the object key).
 * fileId + hash + size stay bound in the AAD, defeating cross-file splicing,
 * substitution and truncation. This reconciles deltaChunkCrypto's index binding
 * with cross-index dedup + cross-version skip.
 */

import { hkdfSync, createHash } from 'node:crypto';
import { rename, unlink } from 'node:fs/promises';
import { V3FileReader, encryptStreamToFileV3 } from '../streamCrypto';
import {
  DeltaBlockMissingError,
  deriveDeltaKeyShared,
  deterministicSaltB64Shared,
} from './deltaShared';
import { isDeltaV5WriteEnabled } from './deltaFormat';
import { downloadDeltaV5, uploadDeltaV5 } from './deltaSyncV5';
import { readManifest } from './deltaManifestV5';
import { MANIFEST_V5 } from './deltaManifestShared';
import {
  chunkLocalV3,
  encryptBlock,
  decryptBlock,
  DELTA_BLOCK_SIZE,
} from './deltaChunkCrypto';
import {
  buildManifest,
  diffManifests,
  serializeManifest,
  deserializeManifest,
  tryDeserializeManifest,
  DELTA_HKDF_INFO,
  DELTA_MANIFEST_VERSION,
  type DeltaManifest,
  type LocalBlock,
  type UploadBlock,
} from './deltaManifest';

// ── Constants ─────────────────────────────────────────────────────────────────

/** Fixed AAD index used for EVERY delta block (see file header — content-address). */
const DELTA_AAD_INDEX = 0;
/** Per stored block wire overhead: nonce(12) + tag(16) = 28 (no on-wire version byte). */
const DELTA_WIRE_OVERHEAD = 28;
/** Per-file HKDF salt length (bytes). */
const DELTA_SALT_BYTES = 16;
/** Info string domain-separating the per-file salt derivation. */
const DELTA_SALT_INFO = 'filarr-delta-salt';
/** Bounded parallelism for block PUT/GET (mirrors the direct-transport default). */
const DEFAULT_DELTA_CONCURRENCY = 4;
/** Commit retries on an optimistic-lock conflict before escalating. */
const MAX_COMMIT_RETRIES = 5;

const ERR_CORRUPT = 'Fichier chiffre corrompu - dechiffrement impossible';
const ERR_CONFLICT_EXHAUSTED = 'Conflit de manifeste delta persistant - reessai au prochain cycle';

// ── Errors ──────────────────────────────────────────────────────────────────

/**
 * The delta path is not usable for this file/cycle (capability off, no remote
 * delta manifest where one was expected, unexpected non-V3 shape). Signals
 * syncService to FALL BACK to the existing multipart/legacy path.
 */
export class DeltaUnavailableError extends Error {
  constructor(message = 'Synchronisation delta indisponible') {
    super(message);
    this.name = 'DeltaUnavailableError';
  }
}

/** Optimistic-lock conflict committing the delta manifest (mirrors SyncConflictError). */
export class DeltaManifestConflictError extends Error {
  serverVersion: number;
  constructor(serverVersion: number) {
    super('Conflit de version du manifeste delta');
    this.name = 'DeltaManifestConflictError';
    this.serverVersion = serverVersion;
  }
}

/**
 * Un bloc reference par le manifeste est absent de R2 (404).
 *
 * ⚠ REEXPORTEE depuis `deltaShared`, JAMAIS redeclaree ici.
 *
 * Elle l'a ete, et c'etait un bogue : deux classes du meme nom sont deux
 * IDENTITES differentes. `deltaSyncV5` levait celle de `deltaShared` pendant
 * que `syncService` testait `err instanceof deltaSync.DeltaBlockMissingError`
 * — le test etait donc toujours FAUX, et le repli sur un objet herite ne se
 * serait jamais declenche pour un fichier v5.
 *
 * Latent tant que l'ecriture v5 est eteinte, prêt a mordre le jour ou on
 * l'allume : exactement le genre de defaut qu'une bascule revele, et le pire
 * moment pour le decouvrir. La garde « attrapee donc produite » ne pouvait pas
 * le voir — elle compare des NOMS, et les deux classes en partageaient un.
 * D'ou le controle de declaration unique dans `deadHandling.vitest.ts`.
 */
export { DeltaBlockMissingError };

/**
 * The commit was REFUSED because one or more blocks it references are absent on
 * R2 (worker 409 with `data.missing[]`). Distinct from DeltaManifestConflictError:
 * a version conflict is resolved by re-diffing, but a missing referenced block —
 * typically an UNCHANGED block the diff never re-queues, lost to R2 durability or
 * a GC-past-grace — is resolved by FORCE re-uploading those hashes from the local
 * V3 file (which still holds the plaintext) and retrying. Carries the missing set.
 */
export class DeltaBlocksMissingOnCommitError extends Error {
  missing: string[];
  constructor(missing: string[]) {
    super('Le commit delta reference des blocs absents du cloud');
    this.name = 'DeltaBlocksMissingOnCommitError';
    this.missing = missing;
  }
}

// ── Injected dependencies ─────────────────────────────────────────────────────

/** Worker delta routes (/sync/blocks/*, /sync/delta-manifest/*). Injected for testability. */
export interface DeltaTransport {
  /** POST /sync/blocks/exists → the subset of `hashes` already present on R2. */
  blocksExist(profileId: string, fileId: string, hashes: string[]): Promise<string[]>;
  /** PUT one encrypted block object (content-addressed by `hash`). Quota-atomic; idempotent (deduped). */
  putBlock(
    profileId: string,
    fileId: string,
    hash: string,
    body: Buffer
  ): Promise<{ deduped: boolean; size: number }>;
  /** GET one encrypted block object by hash. Rejects (any error) when the object is absent. */
  getBlock(profileId: string, fileId: string, hash: string): Promise<Buffer>;
  /** GET the encrypted delta manifest + its server (D1) version. `manifest` null on first upload. */
  getDeltaManifest(
    profileId: string,
    fileId: string
  ): Promise<{ manifest: Buffer | null; version: number }>;
  /**
   * Commit the encrypted delta manifest under optimistic lock (single-step:
   * the worker also validates every `liveHashes` entry is present on R2, so the
   * commit can never reference a missing block). Throws DeltaManifestConflictError
   * on a version mismatch (re-diffed + retried) and DeltaBlocksMissingOnCommitError
   * when a referenced block is absent on R2 (force re-uploaded from local + retried).
   */
  putDeltaManifest(
    profileId: string,
    fileId: string,
    encrypted: Buffer,
    liveHashes: string[],
    expectedVersion: number
  ): Promise<{ version: number }>;
  /** POST /sync/blocks/gc — mark-sweep orphan blocks against the just-committed live set. */
  gc(
    profileId: string,
    fileId: string,
    liveHashes: string[],
    committedVersion: number
  ): Promise<{ skipped: boolean; deletedBytes: number }>;
}

/** FEK-side crypto: raw account FEK + manifest E2EE (mirrors StorageService). */
export interface DeltaCrypto {
  /** Raw 32-byte account FEK (throws the French locked error when unavailable). */
  getFek(): Promise<Buffer>;
  /** FEK-encrypt a manifest buffer (StorageService.encryptWithFEK). */
  encryptManifest(plain: Buffer): Promise<Buffer>;
  /** Auto-decrypt a FEK/legacy manifest buffer (StorageService.decryptManifestAuto). */
  decryptManifest(encrypted: Buffer): Promise<Buffer>;
}

// ── Params / results ──────────────────────────────────────────────────────────

export interface DeltaUploadParams {
  profileId: string;
  fileId: string;
  /** Local V3-FEK (portable) blob path. */
  localPath: string;
  transport: DeltaTransport;
  crypto: DeltaCrypto;
  /** Informational device id stored in the manifest. */
  device?: string;
  concurrency?: number;
  /** Reports bytes ACTUALLY transferred (uploaded block objects), not file size. */
  onProgress?: (transferredBytes: number, totalTransferBytes: number) => void;
}

export interface DeltaUploadResult {
  /** New server manifest version (unchanged when `skipped`). */
  version: number;
  blockCount: number;
  /** Plaintext total (== V3 origSize). */
  totalSize: number;
  plaintextChecksum: string;
  /** Bytes actually pushed to R2 (sum of newly-uploaded encrypted block objects). */
  transferredBytes: number;
  blocksUploaded: number;
  /** True when the file was already byte-identical remotely (no commit performed). */
  skipped: boolean;
}

export interface DeltaDownloadParams {
  profileId: string;
  fileId: string;
  /** Final V3 blob path (installed via atomic rename). */
  destPath: string;
  /** Staging ciphertext path (V3 blob is written here first). */
  tmpPath: string;
  transport: DeltaTransport;
  crypto: DeltaCrypto;
  concurrency?: number;
  onProgress?: (doneBytes: number, totalBytes: number) => void;
}

export interface DeltaDownloadResult {
  version: number;
  blockCount: number;
  /** Plaintext total (== V3 origSize of the reassembled blob). */
  totalSize: number;
  plaintextChecksum: string;
}

// ── Key derivation ────────────────────────────────────────────────────────────

/**
 * Per-file delta key = HKDF-SHA256(FEK, salt, "filarr-delta-v4", 32).
 * Domain-separated from the V3 file key ("filarr-file-v3"). ALL blocks of one
 * file share this key; the salt is per-file, stored in the manifest, and NEVER
 * rotated for the life of the file's block store (rotating it would orphan the
 * skipped blocks encrypted under the old key).
 */
export function deriveDeltaKey(fek: Buffer, saltB64: string): Buffer {
  // Une seule implementation, dans `deltaShared` : deux copies de la meme
  // derivation de cle finiraient par diverger, et une divergence ici rend des
  // fichiers indechiffrables sans qu'aucun test ne rougisse.
  return deriveDeltaKeyShared(fek, saltB64);
}

/**
 * DETERMINISTIC per-file HKDF salt = HKDF-SHA256(FEK, fileId, "filarr-delta-salt",
 * 16). Derived from the FEK (not random) so it is reproducible across a crash
 * that uploaded blocks BEFORE committing any manifest — the resume regenerates
 * the identical deltaKey and the pre-crash blocks stay decryptable. Every
 * committer/version derives the same salt, so it is inherently stable; the
 * manifest still stores it for the reader. HKDF's salt need not be secret or
 * random for security, and it stays private (FEK-derived) regardless.
 */
export function deterministicSaltB64(fek: Buffer, fileId: string): string {
  return deterministicSaltB64Shared(fek, fileId);
}

// ── Bounded parallel map ──────────────────────────────────────────────────────

/** Runs `fn` over `items` with at most `concurrency` in flight (pull-based). */
async function mapBounded<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  if (items.length === 0) return;
  const limit = Math.max(1, Math.min(concurrency, items.length));
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const idx = next++;
      if (idx >= items.length) return;
      await fn(items[idx]);
    }
  };
  await Promise.all(Array.from({ length: limit }, () => worker()));
}

// ── Upload ────────────────────────────────────────────────────────────────────

/**
 * Delta upload: two flat-memory passes over the local V3 file.
 *  Pass 1 — hash every 8 MiB plaintext block (+ running whole-plaintext hash).
 *  Diff  — against the remote manifest, then confirm which "new" hashes are
 *          genuinely absent on R2 (covers GC races / uploaded-but-unmanifested).
 *  Pass 2 — encrypt+upload ONLY the still-missing blocks (bounded parallel).
 *  Commit — build + FEK-encrypt the manifest and PUT it under the version lock
 *           (409 → re-fetch + re-diff + retry; uploaded blocks dedup). NEVER
 *           commit a manifest that references a not-yet-uploaded block.
 *  GC     — reclaim orphan blocks against the just-committed live set.
 * A partial block set with no commit is always safe (old manifest + blocks
 * intact; GC only runs post-commit and never deletes a live block).
 */
export async function uploadDelta(params: DeltaUploadParams): Promise<DeltaUploadResult> {
  /*
    LA BASCULE v5, ET ELLE NE PORTE QUE SUR L ECRITURE.

    Eteindre le drapeau fait repartir les NOUVEAUX fichiers en v4 ; ceux deja
    ecrits en v5 restent parfaitement lisibles, parce que la lecture, elle,
    n est derriere aucun drapeau (voir `downloadDelta`). C est ce qui rend le
    retour en arriere gratuit — gater la lecture le transformerait en perte de
    donnees.

    Par defaut ETEINT. L allumer est une decision, pas un effet de bord d un
    deploiement : contrat de parite
    `.filarr-parity/ledger/2026-09-05-blocs-delta-cdc-compression.md`.
  */
  if (isDeltaV5WriteEnabled()) {
    const v5 = await uploadDeltaV5({
      profileId: params.profileId,
      fileId: params.fileId,
      localPath: params.localPath,
      transport: params.transport,
      crypto: params.crypto,
      device: params.device,
      concurrency: params.concurrency,
    });
    return {
      version: v5.version,
      blockCount: v5.blockCount,
      totalSize: v5.totalSize,
      plaintextChecksum: v5.plaintextChecksum,
      transferredBytes: v5.transferredBytes,
      blocksUploaded: v5.blocksUploaded,
      skipped: false,
    };
  }

  const { profileId, fileId, localPath, transport, crypto } = params;
  const concurrency = params.concurrency ?? DEFAULT_DELTA_CONCURRENCY;
  const fek = await crypto.getFek();

  // Pass 1 — chunk + hash the whole local plaintext (flat memory).
  const wholeHash = createHash('sha256');
  const { chunks: localChunks, totalSize } = await chunkLocalV3(
    fek,
    localPath,
    async (_index, plain) => {
      wholeHash.update(plain);
    }
  );
  const plaintextChecksum = wholeHash.digest('hex');
  const blockCount = localChunks.length;
  const distinctLocalHashes = distinctHashes(localChunks);

  // First occurrence (index, size) of each hash — the representative read site.
  const repByHash = new Map<string, { index: number; size: number }>();
  for (const c of localChunks) {
    if (!repByHash.has(c.hash)) repByHash.set(c.hash, { index: c.index, size: c.size });
  }

  let transferredBytes = 0;
  let blocksUploaded = 0;

  // Hashes a prior commit attempt reported MISSING on R2 (worker 409). They are
  // UNCHANGED blocks the diff never re-queues, so we carry them across retries and
  // force-re-upload them from the local V3 (self-heal against durability loss / a
  // GC-past-grace). Every entry is by construction a local block, so it is always
  // recoverable from `repByHash`.
  const forceReupload = new Set<string>();

  for (let attempt = 0; attempt <= MAX_COMMIT_RETRIES; attempt++) {
    // Fetch + decrypt the remote manifest (null / legacy => first delta upload).
    const remote = await transport.getDeltaManifest(profileId, fileId);
    const remoteManifest = await decryptRemoteManifest(remote.manifest, crypto);

    // Salt is stable for the file's block store: reuse the remote one when a
    // manifest exists, else derive the SAME deterministic salt (reproducible on
    // a crash-resume that uploaded blocks before any commit). Both converge to
    // deterministicSaltB64, so the already-uploaded blocks stay decryptable.
    const saltB64 = remoteManifest?.kdf.salt || deterministicSaltB64(fek, fileId);
    const deltaKey = deriveDeltaKey(fek, saltB64);

    const diff = diffManifests(localChunks, remoteManifest);

    // Candidate uploads: the diff's genuinely-new blocks PLUS any hash a prior
    // commit attempt reported missing on R2 (self-heal). Merging the forced set in
    // BEFORE the existence check lets a peer that healed it meanwhile filter it out.
    const candidates: UploadBlock[] = [...diff.toUpload];
    if (forceReupload.size > 0) {
      const queued = new Set(candidates.map((b) => b.hash));
      for (const hash of forceReupload) {
        if (queued.has(hash)) continue;
        const rep = repByHash.get(hash);
        if (rep) candidates.push({ index: rep.index, hash, size: rep.size });
      }
    }

    // Confirm which candidate hashes are genuinely absent on R2 before uploading.
    let toUpload = candidates;
    if (toUpload.length > 0) {
      const present = new Set(
        await transport.blocksExist(
          profileId,
          fileId,
          toUpload.map((b) => b.hash)
        )
      );
      toUpload = toUpload.filter((b) => !present.has(b.hash));
    }

    // Nothing to upload AND the ordered block sequence is identical => the file
    // is already byte-for-byte on the cloud; no commit needed.
    if (toUpload.length === 0 && !diff.manifestChanged && forceReupload.size === 0) {
      deltaKey.fill(0);
      return {
        version: remote.version,
        blockCount,
        totalSize,
        plaintextChecksum,
        transferredBytes,
        blocksUploaded,
        skipped: true,
      };
    }

    const totalTransfer = toUpload.reduce((n, b) => n + b.size + DELTA_WIRE_OVERHEAD, 0);

    // Pass 2 — encrypt + upload ONLY the missing blocks (bounded parallel).
    if (toUpload.length > 0) {
      const reader = await V3FileReader.open(fek, localPath);
      try {
        await mapBounded(toUpload, concurrency, async (b) => {
          const rep = repByHash.get(b.hash);
          const index = rep ? rep.index : b.index;
          const size = rep ? rep.size : b.size;
          const plain = await reader.read(index * DELTA_BLOCK_SIZE, size);
          if (plain.length !== size) {
            throw new Error(ERR_CORRUPT);
          }
          const encrypted = encryptBlock(deltaKey, fileId, DELTA_AAD_INDEX, b.hash, plain);
          const res = await transport.putBlock(profileId, fileId, b.hash, encrypted);
          if (!res.deduped) {
            transferredBytes += encrypted.length;
            blocksUploaded += 1;
            params.onProgress?.(transferredBytes, totalTransfer);
          }
        });
      } finally {
        await reader.close();
      }
    }

    // Build + FEK-encrypt the manifest ONLY after every block is confirmed on R2.
    const manifest = buildManifest(fileId, localChunks, totalSize, DELTA_MANIFEST_VERSION, {
      saltB64,
      plaintextChecksum,
      device: params.device,
    });
    const encryptedManifest = await crypto.encryptManifest(
      Buffer.from(serializeManifest(manifest), 'utf-8')
    );
    deltaKey.fill(0);

    try {
      const { version: newVersion } = await transport.putDeltaManifest(
        profileId,
        fileId,
        encryptedManifest,
        distinctLocalHashes,
        remote.version
      );
      // GC is best-effort: version-guarded + grace-windowed server-side.
      await transport
        .gc(profileId, fileId, distinctLocalHashes, newVersion)
        .catch(() => undefined);

      return {
        version: newVersion,
        blockCount,
        totalSize,
        plaintextChecksum,
        transferredBytes,
        blocksUploaded,
        skipped: false,
      };
    } catch (err) {
      if (err instanceof DeltaManifestConflictError) {
        // A peer committed between our GET and our PUT — re-fetch, re-diff (the
        // blocks we already pushed dedup), retry. Loop.
        continue;
      }
      if (err instanceof DeltaBlocksMissingOnCommitError) {
        // The manifest references blocks absent on R2 (durability loss / GC race).
        // They are local blocks: mark them for a forced re-upload from the V3 file
        // on the next iteration, then retry. Bounded by the same attempt budget, so
        // a persistently-failing store escalates to ERR_CONFLICT_EXHAUSTED instead
        // of looping forever.
        for (const hash of err.missing) forceReupload.add(hash);
        continue;
      }
      throw err;
    }
  }

  throw new Error(ERR_CONFLICT_EXHAUSTED);
}

// ── Download ──────────────────────────────────────────────────────────────────

/**
 * Delta download: fetch + decrypt the manifest, then reassemble in index order,
 * fetching+decrypting each block ON DEMAND (with a bounded look-ahead window) and
 * re-encrypting the ordered plaintext straight into a fresh V3-FEK blob at
 * `tmpPath` (no plaintext temp file) before an atomic-rename into `destPath`.
 *
 * MEMORY: blocks are NOT all decrypted up front. A small hash-keyed cache holds
 * only the look-ahead window plus any duplicate whose reference span is still open,
 * evicting each block right after its LAST referencing index is written — so a hash
 * referenced N times is still fetched exactly once, and peak resident plaintext is
 * O(window + open duplicates), never O(file size). The whole-plaintext checksum is
 * verified before the rename. A referenced block missing on R2 throws
 * DeltaBlockMissingError.
 */
export async function downloadDelta(params: DeltaDownloadParams): Promise<DeltaDownloadResult> {
  const { profileId, fileId, destPath, tmpPath, transport, crypto } = params;
  const concurrency = params.concurrency ?? DEFAULT_DELTA_CONCURRENCY;
  const fek = await crypto.getFek();

  const remote = await transport.getDeltaManifest(profileId, fileId);
  if (!remote.manifest) {
    /*
      « AUCUN MANIFESTE » N'EST PAS « DES OCTETS ABIMES ».

      Ce site levait `DeltaBlockMissingError('delta-manifest')`, en annoncant
      pourtant vouloir un repli. Deux consequences, toutes deux fausses :

      1. `syncService` ne se replie sur `DeltaBlockMissingError` que s'il reste
         des objets herites (`chunks` sans `/blocks/`). Or un fichier ne en
         delta porte `chunks: []` — le repli ne se declenchait donc JAMAIS pour
         lui, et l'erreur remontait telle quelle.
      2. Le message rendu a l'utilisateur devenait « Bloc delta introuvable sur
         le cloud (delta-manife...) » : il annonce une donnee endommagee la ou
         il n'y a qu'un index absent, sur un stockage parfaitement sain.

      `DeltaUnavailableError` existe precisement pour ce cas — sa
      documentation, quinze lignes plus haut, dit « absent delta manifest where
      one was expected […] Signals syncService to FALL BACK » — et elle n'etait
      levee NULLE PART. Le gestionnaire etait ecrit, le declencheur manquait.
      Troisieme occurrence de ce motif dans ce chantier, signalee par la session
      mobile qui a rencontre exactement le meme piege de son cote.
    */
    throw new DeltaUnavailableError('Manifeste delta absent pour ce fichier');
  }
  const decrypted = await crypto.decryptManifest(remote.manifest);
  const json = decrypted.toString('utf-8');

  /*
    LA LECTURE DU v5 N EST DERRIERE AUCUN DRAPEAU.

    Un lecteur doit savoir lire ce qu un autre appareil a pu ecrire, meme si
    LUI n ecrit pas ce format. Gater la lecture rendrait illisibles, au moindre
    retour en arriere, les fichiers deja ecrits en v5 — c est le piege classique
    des drapeaux de format, et il transforme une bascule reversible en perte de
    donnees.

    Le format est lu dans le manifeste, jamais devine : `readManifest` valide
    la structure et rend la version, ou leve.
  */
  let v5Manifest: ReturnType<typeof readManifest> | null = null;
  try {
    const normalise = readManifest(json);
    if (normalise.version === MANIFEST_V5) v5Manifest = normalise;
  } catch {
    // Illisible pour le lecteur v5 : on laisse le chemin v4 se prononcer, avec
    // son propre message. Deux diagnostics valent mieux qu un seul tronque.
    v5Manifest = null;
  }
  if (v5Manifest) {
    return downloadDeltaV5(
      {
        profileId,
        fileId,
        destPath,
        tmpPath,
        transport,
        crypto,
        onProgress: params.onProgress,
      },
      v5Manifest,
      remote.version
    );
  }

  const manifest = deserializeManifest(json);

  const deltaKey = deriveDeltaKey(fek, manifest.kdf.salt);
  try {
    const blocks = manifest.blocks; // ORDERED by index (validated on deserialize).

    // Size per distinct hash (first block carrying it) for AAD/length checks.
    const sizeByHash = new Map<string, number>();
    // Reference COUNT per hash (positions referencing it) — refcounted down as each
    // referencing index is consumed; the block is EVICTED when it hits zero, i.e.
    // right after its LAST referencing index is written. A hash shared across indices
    // is thus fetched exactly once and held only until its final use.
    const refCount = new Map<string, number>();
    for (const b of blocks) {
      if (!sizeByHash.has(b.h)) sizeByHash.set(b.h, b.s);
      refCount.set(b.h, (refCount.get(b.h) ?? 0) + 1);
    }

    // Resident/in-flight block plaintexts keyed by hash. An entry stays only while
    // refCount[hash] > 0, so peak resident plaintext is bounded to O(prefetch window
    // + duplicates whose reference span is still open) — NOT O(file size).
    const inflight = new Map<string, Promise<Buffer>>();

    // Start (or reuse) the fetch+decrypt of one block. The stored promise is awaited
    // by the consuming index; a `.catch` marks a prefetched rejection handled so a
    // block that fails BEFORE its index is reached does not raise an unhandled
    // rejection (the real await at consume time still observes and throws it).
    const fetchBlock = (hash: string): Promise<Buffer> => {
      const existing = inflight.get(hash);
      if (existing) return existing;
      const size = sizeByHash.get(hash) ?? 0;
      const p = (async (): Promise<Buffer> => {
        let encrypted: Buffer;
        try {
          encrypted = await transport.getBlock(profileId, fileId, hash);
        } catch {
          throw new DeltaBlockMissingError(hash);
        }
        // Verifies GCM tag + AAD(fileId, DELTA_AAD_INDEX, hash, size), exact length
        // AND SHA-256(plaintext) == hash. Any failure => French corrupt error.
        return decryptBlock(deltaKey, fileId, DELTA_AAD_INDEX, hash, size, encrypted);
      })();
      p.catch(() => undefined);
      inflight.set(hash, p);
      return p;
    };

    // Bounded look-ahead: keep fetches started for every index in
    // [consume, consume + window]. Duplicate hashes dedup via `inflight`.
    const prefetchWindow = Math.max(1, concurrency);
    let scheduled = 0;
    const scheduleUpTo = (indexExclusive: number): void => {
      const target = Math.min(blocks.length, indexExclusive);
      while (scheduled < target) {
        fetchBlock(blocks[scheduled].h);
        scheduled += 1;
      }
    };

    // Re-encrypt the ordered plaintext straight into a V3-FEK blob (bounded memory,
    // no plaintext temp file), verifying the whole-plaintext checksum en route. Each
    // block is fetched+decrypted ON DEMAND (with look-ahead), not all up front.
    const wholeHash = createHash('sha256');
    await encryptStreamToFileV3(
      fek,
      manifest.totalSize,
      tmpPath,
      async (index, plainLen) => {
        const entry = blocks[index];
        if (!entry || entry.s !== plainLen) {
          throw new Error(ERR_CORRUPT);
        }
        // Ensure this index and the look-ahead window are fetching, then await ours.
        scheduleUpTo(index + 1 + prefetchWindow);
        const plain = await fetchBlock(entry.h);
        if (plain.length !== plainLen) {
          throw new Error(ERR_CORRUPT);
        }
        wholeHash.update(plain);
        // Consume: drop one reference; evict once this was the block's LAST index.
        const remaining = (refCount.get(entry.h) ?? 1) - 1;
        if (remaining <= 0) {
          refCount.delete(entry.h);
          inflight.delete(entry.h); // free the resident plaintext
        } else {
          refCount.set(entry.h, remaining);
        }
        return plain;
      },
      params.onProgress
    );

    if (wholeHash.digest('hex') !== manifest.plaintextChecksum) {
      await unlink(tmpPath).catch(() => undefined);
      throw new Error(ERR_CORRUPT);
    }

    await rename(tmpPath, destPath);

    return {
      version: remote.version,
      blockCount: manifest.blockCount,
      totalSize: manifest.totalSize,
      plaintextChecksum: manifest.plaintextChecksum,
    };
  } finally {
    deltaKey.fill(0);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Distinct block hashes in first-seen order. */
function distinctHashes(chunks: LocalBlock[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of chunks) {
    if (!seen.has(c.hash)) {
      seen.add(c.hash);
      out.push(c.hash);
    }
  }
  return out;
}

/**
 * Decrypt + tolerantly parse the remote delta manifest.
 *
 * Returns null (=> "no delta baseline", diff treats every local block as new,
 * a FRESH HKDF salt is minted) ONLY for:
 *   - no remote object at all (first upload), or
 *   - a decryptable-but-legacy/format-mismatched manifest (v<4 / wrong fmt) —
 *     which by definition has no v4 blocks keyed to a salt, so rotating is safe.
 *
 * A remote object that FAILS TO DECRYPT is NOT swallowed: it propagates as
 * corruption. Silently returning null there would rotate the per-file salt and
 * orphan the keys of every already-uploaded block (they were encrypted under
 * the old salt's deltaKey) — the file would become undecryptable. The salt must
 * stay stable for the life of the block store.
 */
async function decryptRemoteManifest(
  encrypted: Buffer | null,
  crypto: DeltaCrypto
): Promise<DeltaManifest | null> {
  if (!encrypted) return null;
  const decrypted = await crypto.decryptManifest(encrypted);
  return tryDeserializeManifest(decrypted.toString('utf-8'));
}

/**
 * REJOUE le ramassage des blocs orphelins d'un fichier, sans le téléverser.
 *
 * ── POURQUOI CETTE FONCTION EXISTE ───────────────────────────────────────────
 * Le ramassage normal suit chaque commit de manifeste, et il est AU MIEUX :
 *
 *     await transport.gc(...).catch(() => undefined);
 *
 * C'est le bon choix — un ramasse-miettes qui ferait échouer une synchronisation
 * réussie serait absurde. Mais la conséquence est qu'un GC raté ne repasse
 * jamais de lui-même : les orphelins de ce fichier attendent son prochain
 * téléversement complet, et pour un fichier écrit une fois puis jamais retouché,
 * « prochain téléversement » veut dire jamais.
 *
 * ── POURQUOI LE SERVEUR NE PEUT PAS LE FAIRE SEUL ────────────────────────────
 * Le manifeste est chiffré de bout en bout : le worker ignore quels blocs sont
 * encore référencés. Seul un client détenant la FEK peut le lui dire. On relit
 * donc le manifeste, on en extrait l'ensemble vivant, et on rappelle la route —
 * qui reste protégée par sa garde de version et sa fenêtre de grâce.
 *
 * Rend `skipped: true` quand il n'y a rien à ramasser ou quand la garde de
 * version du serveur refuse (un manifeste plus récent a été validé entre-temps,
 * donc notre ensemble vivant est périmé — abandonner est le comportement sûr).
 */
export async function retryGcForFile(
  profileId: string,
  fileId: string,
  transport: DeltaTransport,
  crypto: DeltaCrypto
): Promise<{ skipped: boolean; deletedBytes: number }> {
  const remote = await transport.getDeltaManifest(profileId, fileId);
  if (!remote.manifest) {
    // Pas de manifeste : soit le fichier n'est pas en delta, soit il a été
    // supprimé. Dans les deux cas il n'y a pas d'ensemble vivant à annoncer, et
    // envoyer une liste vide ferait TOUT supprimer.
    return { skipped: true, deletedBytes: 0 };
  }
  const json = (await crypto.decryptManifest(remote.manifest)).toString('utf-8');

  // Lit le v4 comme le v5 : le rattrapage ne doit pas dépendre du format.
  let hashes: string[];
  try {
    hashes = [...new Set(readManifest(json).blocks.map((b) => b.h))];
  } catch {
    // Manifeste illisible : on ne devine pas un ensemble vivant. Ramasser sur
    // une supposition supprimerait des blocs référencés.
    return { skipped: true, deletedBytes: 0 };
  }
  if (hashes.length === 0) return { skipped: true, deletedBytes: 0 };

  return transport.gc(profileId, fileId, hashes, remote.version);
}
