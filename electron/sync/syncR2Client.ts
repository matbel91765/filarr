/**
 * Sync R2 Client — Electron Main Process
 *
 * Wraps the Cloudflare Worker sync API for file upload/download and manifest operations.
 * Uses token-based proxy pattern:
 *   1. Authenticated call to Worker → gets a short-lived token
 *   2. Direct call with token → performs the R2 operation
 *
 * All data is opaque encrypted blobs — zero knowledge.
 */

import log from 'electron-log';
import { isMachineV3WriteEnabled, setServerMachineV3Write } from '../machineContainerV3';
import { isDeltaV5WriteEnabled, setServerDeltaV5Write } from './deltaFormat';
import {
  API_BASE,
  authenticatedApiCall,
  fetchWithTimeout,
  getAccessToken,
} from '../authService';
import {
  MultipartSessionInvalidError,
  createFileResumeStore,
  createMutex,
  computePartSize,
  uploadFileMultipart,
  uploadFileMultipartParallel,
  downloadToFileRanged,
  downloadToFileParallel,
  DEFAULT_UPLOAD_CONCURRENCY,
  DEFAULT_DOWNLOAD_CONCURRENCY,
  type MultipartTransport,
  type RangeSource,
} from './multipartTransfer';
import {
  DirectUploadUnavailableError,
  ByosSyncError,
  createDirectMultipartTransport,
  isClearlyTransientError,
  mapDirectControlError,
  mapDirectCompleteError,
  type DirectControlPlane,
  type DirectFetch,
} from './directTransport';
import {
  DeltaManifestConflictError,
  DeltaBlocksMissingOnCommitError,
  type DeltaTransport,
} from './deltaSync';

// ── Constants ───────────────────────────────────────────────────────────────

const CHUNK_TIMEOUT = 30_000; // 30s per chunk upload/download
const MULTIPART_PART_TIMEOUT = 5 * 60_000; // 5 min per part — bigger parts, slower links

// Files at or above this size use the multipart-upload path. Below it,
// we stick to the original single-PUT presign flow — simpler, fewer
// round-trips, fewer R2 Class A operations billed.
export const MULTIPART_THRESHOLD = 64 * 1024 * 1024; // 64 MB

// ── Types ───────────────────────────────────────────────────────────────────

export class SyncConflictError extends Error {
  serverVersion: number;
  constructor(serverVersion: number) {
    super('Manifest version conflict');
    this.name = 'SyncConflictError';
    this.serverVersion = serverVersion;
  }
}

export interface SyncStatus {
  storageUsed: number;
  storageLimit: number;
  lastSyncAt: string | null;
  manifestVersion: number;
}

// ── Upload ──────────────────────────────────────────────────────────────────

/**
 * Televerse UN morceau par URL presignee — le chemin du magasin LOCAL.
 *
 * Deux echanges : on demande une signature au worker, puis on PUT les octets
 * directement dans le magasin. Le worker ne voit passer aucun octet.
 */
async function uploadChunkPresigned(
  profileId: string,
  fileId: string,
  chunkIndex: number,
  encryptedBuffer: Buffer
): Promise<{ key: string; size: number }> {
  const signed = await authenticatedApiCall<{ url: string; key: string }>(
    '/sync/presign/upload-direct',
    {
      method: 'POST',
      body: JSON.stringify({ profileId, fileId, chunkIndex }),
    }
  );
  if (!signed.success || !signed.data) {
    throw new Error(signed.error || 'Failed to presign chunk upload');
  }

  const response = await fetchWithTimeout(
    signed.data.url,
    {
      method: 'PUT',
      body: encryptedBuffer,
      headers: { 'Content-Type': 'application/octet-stream' },
    },
    CHUNK_TIMEOUT
  );

  if (!response.ok) {
    /*
      LE CORPS D'ERREUR N'EST PAS REMONTE TEL QUEL.

      Il vient du magasin de l'utilisateur, pas de nous : un MinIO renvoie du
      XML, un NAS renvoie parfois une page HTML entiere. La recopier dans un
      message d'erreur remplirait les journaux d'un contenu qui n'apprend rien.
      Le STATUT, lui, est ce qui distingue « signature expiree » (403) de
      « magasin injoignable » (echec de fetch, deja traite ci-dessus).
    */
    throw new Error(`Chunk upload failed: HTTP ${response.status}`);
  }

  log.info(`[syncR2] Uploaded chunk ${fileId}/${chunkIndex} (presigned, ${encryptedBuffer.byteLength} bytes)`);
  return { key: signed.data.key, size: encryptedBuffer.byteLength };
}

/**
 * Upload an encrypted chunk to R2 via the Worker proxy.
 */
export async function uploadChunk(
  profileId: string,
  fileId: string,
  chunkIndex: number,
  encryptedBuffer: Buffer
): Promise<{ key: string; size: number }> {
  /*
    MAGASIN LOCAL : ON NE PASSE PAS PAR LE RELAIS.

    Le chemin ordinaire ci-dessous fait transiter les octets PAR LE WORKER
    (`PUT /sync/upload/:token`), qui les ecrit ensuite dans le magasin. Un NAS
    sur le reseau de l'utilisateur, le worker ne l'atteint jamais : ce chemin
    echouerait sur un delai reseau, a chaque morceau.

    En local, le worker se contente donc de SIGNER une URL (calcul HMAC hors
    ligne, aucune sortie reseau de sa part) et c'est CE processus — qui, lui,
    est sur le reseau — qui televerse. Le secret du magasin ne descend jamais
    ici : on ne recoit qu'une URL signee, valable pour cette clé et ce verbe.
  */
  if (await isLocalStore()) {
    return uploadChunkPresigned(profileId, fileId, chunkIndex, encryptedBuffer);
  }

  // 1. Get upload token
  const tokenResult = await authenticatedApiCall<{
    uploadUrl: string;
    key: string;
  }>('/sync/presign/upload', {
    method: 'POST',
    body: JSON.stringify({
      profileId,
      fileId,
      chunkIndex,
      size: encryptedBuffer.byteLength,
    }),
  });

  if (!tokenResult.success || !tokenResult.data) {
    throw new Error(tokenResult.error || 'Failed to get upload token');
  }

  // 2. Upload directly via token endpoint
  const uploadUrl = `${API_BASE}${tokenResult.data.uploadUrl}`;
  const response = await fetchWithTimeout(
    uploadUrl,
    {
      method: 'PUT',
      body: encryptedBuffer,
      headers: { 'Content-Type': 'application/octet-stream' },
    },
    CHUNK_TIMEOUT
  );

  if (!response.ok) {
    const err = await response.text().catch(() => 'Upload failed');
    throw new Error(`Chunk upload failed: ${err}`);
  }

  const result = await response.json() as { success: boolean; data?: { key: string; size: number }; error?: string };
  if (!result.success || !result.data) {
    throw new Error(result.error || 'Upload confirmation failed');
  }

  log.info(`[syncR2] Uploaded chunk ${fileId}/${chunkIndex} (${result.data.size} bytes)`);
  return result.data;
}

// ── Download ────────────────────────────────────────────────────────────────

/**
 * Recupere UN morceau par URL de lecture presignee — le chemin du magasin LOCAL.
 *
 * `presign/download-direct` existait deja pour les lectures par plages du plan
 * direct : la meme signature sert ici a lire l'objet ENTIER, sans en-tete Range.
 * Aucune route nouvelle n'a ete necessaire.
 */
async function downloadChunkPresigned(
  profileId: string,
  fileId: string,
  chunkIndex: number
): Promise<Buffer> {
  const signed = await authenticatedApiCall<{ url: string }>('/sync/presign/download-direct', {
    method: 'POST',
    body: JSON.stringify({ profileId, fileId, chunkIndex }),
  });
  if (!signed.success || !signed.data) {
    throw new Error(signed.error || 'Failed to presign chunk download');
  }

  const response = await fetchWithTimeout(signed.data.url, { method: 'GET' }, CHUNK_TIMEOUT);
  if (!response.ok) {
    // Statut seulement : le corps vient du magasin de l'utilisateur (XML MinIO,
    // page HTML d'un NAS) et n'apprendrait rien de plus dans un journal.
    throw new Error(`Chunk download failed: ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  log.info(`[syncR2] Downloaded chunk ${fileId}/${chunkIndex} (presigned, ${arrayBuffer.byteLength} bytes)`);
  return Buffer.from(arrayBuffer);
}

/**
 * Download an encrypted chunk from R2 via the Worker proxy.
 */
export async function downloadChunk(
  profileId: string,
  fileId: string,
  chunkIndex: number
): Promise<Buffer> {
  /*
    MAGASIN LOCAL : meme raison qu'a l'envoi. Le chemin ci-dessous fait LIRE le
    worker dans le magasin puis relaie les octets ; il ne peut pas joindre un
    NAS. On demande donc une URL de lecture signee et on va chercher les octets
    nous-memes.
  */
  if (await isLocalStore()) {
    return downloadChunkPresigned(profileId, fileId, chunkIndex);
  }

  // 1. Get download token
  const tokenResult = await authenticatedApiCall<{
    downloadUrl: string;
  }>('/sync/presign/download', {
    method: 'POST',
    body: JSON.stringify({ profileId, fileId, chunkIndex }),
  });

  if (!tokenResult.success || !tokenResult.data) {
    throw new Error(tokenResult.error || 'Failed to get download token');
  }

  // 2. Download via token endpoint
  const downloadUrl = `${API_BASE}${tokenResult.data.downloadUrl}`;
  const response = await fetchWithTimeout(
    downloadUrl,
    { method: 'GET' },
    CHUNK_TIMEOUT
  );

  if (!response.ok) {
    throw new Error(`Chunk download failed: ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  log.info(`[syncR2] Downloaded chunk ${fileId}/${chunkIndex} (${arrayBuffer.byteLength} bytes)`);
  return Buffer.from(arrayBuffer);
}

// ── Multipart upload (for files > MULTIPART_THRESHOLD) ──────────────────────

export interface MultipartCreateResult {
  token: string;
  uploadId: string;
  key: string;
  partSize: number;
}

export interface UploadedPart {
  partNumber: number;
  etag: string;
}

/**
 * Open a multipart upload session on the Worker. The returned `partSize`
 * is the upload chunk size the server prefers — callers should slice
 * the encrypted blob into parts of exactly this size (except the last
 * part, which may be smaller). Persist `token` + the parts list to disk
 * so the upload can resume after a crash.
 */
export async function createMultipartUpload(
  profileId: string,
  fileId: string,
  expectedTotalBytes: number
): Promise<MultipartCreateResult> {
  const result = await authenticatedApiCall<MultipartCreateResult>(
    '/sync/multipart/create',
    {
      method: 'POST',
      body: JSON.stringify({ profileId, fileId, expectedTotalBytes }),
    }
  );
  if (!result.success || !result.data) {
    throw new Error(result.error || 'Failed to open multipart upload');
  }
  return result.data;
}

/**
 * Upload a single part. Idempotent on the client side: callers may
 * retry the same partNumber freely — R2 will simply overwrite the part
 * data and return a fresh etag.
 */
export async function uploadMultipartPart(
  token: string,
  partNumber: number,
  body: Buffer
): Promise<UploadedPart> {
  const accessToken = await getAccessToken();
  if (!accessToken) throw new Error('Not authenticated');

  const response = await fetchWithTimeout(
    `${API_BASE}/sync/multipart/part/${token}/${partNumber}`,
    {
      method: 'PUT',
      body,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/octet-stream',
      },
    },
    MULTIPART_PART_TIMEOUT
  );

  if (!response.ok) {
    const txt = await response.text().catch(() => '');
    // 404 = the KV `mpu:` intent expired or was consumed; 403 = the token
    // belongs to another account. Either way the SESSION is dead — signal it
    // as such so the resumable-upload engine aborts + restarts instead of
    // retrying a part that can never land.
    if (response.status === 404 || response.status === 403) {
      throw new MultipartSessionInvalidError(
        `Multipart part ${partNumber} rejected: HTTP ${response.status}`
      );
    }
    throw new Error(`Multipart part ${partNumber} failed: HTTP ${response.status} ${txt}`);
  }

  const result = (await response.json()) as {
    success: boolean;
    data?: UploadedPart;
    error?: string;
  };
  if (!result.success || !result.data) {
    throw new Error(result.error || 'Multipart part confirmation failed');
  }
  return result.data;
}

/**
 * Finalize the multipart upload. Must include every part in order; the
 * server reassembles them into a single R2 object at the file's chunk_0
 * key (replacing any prior single-chunk upload).
 */
export async function completeMultipartUpload(
  token: string,
  parts: UploadedPart[]
): Promise<{ key: string; size: number }> {
  const result = await authenticatedApiCall<{ key: string; size: number }>(
    '/sync/multipart/complete',
    {
      method: 'POST',
      body: JSON.stringify({ token, parts }),
    }
  );
  if (!result.success || !result.data) {
    const error = result.error || 'Failed to complete multipart upload';
    // Structural rejections are session-fatal — map them to the typed error
    // so the resumable engine aborts + restarts cleanly instead of keeping a
    // resume state that can never complete (fail-forever wedge):
    //  - 403 "Invalid or expired multipart token" / "Forbidden": session gone;
    //  - 400 "Invalid part entry" / "Too many parts": poisoned parts list;
    //  - 400 "Invalid multipart parts or etags": R2 rejected the parts at
    //    complete() (etag mismatch, unknown part — e.g. stale resume state).
    if (
      /invalid or expired/i.test(error) ||
      /forbidden/i.test(error) ||
      /invalid.*part/i.test(error) ||
      /too many parts/i.test(error)
    ) {
      throw new MultipartSessionInvalidError(error);
    }
    throw new Error(error);
  }
  return result.data;
}

/**
 * Cancel an in-progress multipart upload. Best-effort — failures are
 * logged but not surfaced because the server-side R2 garbage collector
 * eventually reclaims abandoned uploads anyway.
 */
export async function abortMultipartUpload(token: string): Promise<void> {
  try {
    await authenticatedApiCall('/sync/multipart/abort', {
      method: 'POST',
      body: JSON.stringify({ token }),
    });
  } catch (err) {
    log.warn('[syncR2] abortMultipartUpload failed:', err);
  }
}

/**
 * High-level helper: upload an already-encrypted Buffer via multipart,
 * with parallelism = 3 to balance throughput against memory pressure.
 * Returns the parts list so callers can persist progress between calls.
 */
export async function uploadViaMultipart(
  profileId: string,
  fileId: string,
  encryptedBuffer: Buffer,
  options: { onProgress?: (uploadedBytes: number) => void } = {}
): Promise<{ key: string; size: number }> {
  const total = encryptedBuffer.byteLength;
  const created = await createMultipartUpload(profileId, fileId, total);
  const partSize = created.partSize;
  const numParts = Math.ceil(total / partSize);

  try {
    const parts: UploadedPart[] = new Array(numParts);
    let uploadedBytes = 0;
    const PARALLELISM = 3;
    let nextPartIdx = 0;

    async function worker(): Promise<void> {
      // Pull-based parallelism: each worker grabs the next available
      // part index until exhausted. Simpler than a queue + scheduler
      // and avoids the head-of-line blocking that a fixed-batch loop
      // would have.
      while (true) {
        const idx = nextPartIdx++;
        if (idx >= numParts) return;
        const start = idx * partSize;
        const end = Math.min(start + partSize, total);
        const slice = encryptedBuffer.subarray(start, end);
        const uploaded = await uploadMultipartPart(created.token, idx + 1, slice);
        parts[idx] = uploaded;
        uploadedBytes += end - start;
        options.onProgress?.(uploadedBytes);
      }
    }

    await Promise.all(Array.from({ length: PARALLELISM }, () => worker()));

    const done = await completeMultipartUpload(created.token, parts);
    log.info(
      `[syncR2] Multipart uploaded ${fileId} (${numParts} parts, ${done.size} bytes)`
    );
    return done;
  } catch (err) {
    // Free the in-progress R2 state so we don't leak storage / cost.
    await abortMultipartUpload(created.token);
    throw err;
  }
}

// ── Multipart from disk (resumable, flat memory) ────────────────────────────

/** Real HTTP transport for the resumable multipart engine (Worker routes). */
export function createMultipartTransport(): MultipartTransport {
  return {
    create: (profileId, fileId, expectedTotalBytes) =>
      createMultipartUpload(profileId, fileId, expectedTotalBytes),
    uploadPart: (token, partNumber, body) => uploadMultipartPart(token, partNumber, body),
    complete: (token, parts) => completeMultipartUpload(token, parts),
    abort: (token) => abortMultipartUpload(token),
  };
}

/**
 * Uploads an already-encrypted on-disk blob via multipart WITHOUT buffering
 * it whole: 64 MiB slices read into one reused buffer, per-part retry with
 * backoff, and crash resume through a JSON state file (`resumeStorePath`,
 * lives next to the sync manifest — never contains key material).
 */
export async function uploadViaMultipartFromPath(
  profileId: string,
  fileId: string,
  filePath: string,
  totalBytes: number,
  fileChecksum: string,
  resumeStorePath: string,
  options: { onProgress?: (doneBytes: number, totalBytes: number) => void } = {}
): Promise<{ key: string; size: number }> {
  const store = createFileResumeStore(resumeStorePath);
  const result = await uploadFileMultipart(
    createMultipartTransport(),
    store,
    { profileId, fileId, filePath, totalBytes, fileChecksum },
    { onProgress: options.onProgress }
  );
  log.info(`[syncR2] Multipart (from disk) uploaded ${fileId} (${result.size} bytes)`);
  return result;
}

// ── Direct-to-R2 multipart (presigned parts, bytes bypass the Worker) ────────

// Re-export so syncService can classify failures / catch the unavailable case
// without importing directTransport directly.
export { DirectUploadUnavailableError, ByosSyncError, isClearlyTransientError };

// The direct PUT/GET can carry a dynamically-sized part (up to R2's 5 GiB/part)
// so the fixed 5-min part timeout is far too short. Scale the AbortController
// budget with the byte count assuming a conservative >=256 KiB/s floor, clamped
// to a 5-min floor and a 6-hour ceiling.
const DIRECT_MIN_THROUGHPUT_BPS = 256 * 1024;
const DIRECT_TIMEOUT_FLOOR_MS = 5 * 60_000;
const DIRECT_TIMEOUT_CEIL_MS = 6 * 60 * 60_000;
function computeDirectTimeout(bytes: number): number {
  const est = Math.ceil((Math.max(0, bytes) / DIRECT_MIN_THROUGHPUT_BPS) * 1000);
  return Math.min(DIRECT_TIMEOUT_CEIL_MS, Math.max(DIRECT_TIMEOUT_FLOOR_MS, est));
}

// ── Capability probe (cached per session) ────────────────────────────────────

let cachedDirectCapability: boolean | null = null;
let cachedDeltaCapability: boolean | null = null;
let cachedStorageMode: 'filarr' | 'byos' | null = null;
/**
 * Localite du magasin BYOS — `'local'` = NAS/MinIO sur le reseau de
 * l'utilisateur, que le worker ne joint pas.
 *
 * CE QU'ELLE CHANGE ICI. En local, le worker ne peut ni relayer les octets ni
 * executer le multipart : il ne fait que SIGNER. Le bureau doit donc envoyer
 * par URL presignee et, pour les gros fichiers, decouper en morceaux plutot que
 * de demander un multipart que personne ne pourra finaliser.
 */
let cachedStorageLocality: 'public' | 'local' | null = null;
// Le PROFIL que la sonde interroge : depuis les cibles PAR PROFIL, le mode de
// stockage (et donc les capacités direct/delta) peut différer d'un profil à
// l'autre du même compte. Posé par syncService à chaque cycle, avant la sonde.
let capabilityProfileId: string | null = null;

/** Fixe le profil sondé ; s'il change, le cache ne parle plus de lui — purge. */
export function setCapabilityScope(profileId: string | null): void {
  if (capabilityProfileId === profileId) return;
  capabilityProfileId = profileId;
  resetDirectCapabilityCache();
}

/**
 * Probe /sync/capabilities once and populate both capability caches. The
 * Worker advertises directUpload/deltaSync only when its R2_* S3 secrets are
 * present + the routes are deployed; any probe error degrades both to false.
 */
async function fetchCapabilities(): Promise<void> {
  try {
    const res = await authenticatedApiCall<{
      directUpload?: boolean;
      deltaSync?: boolean;
      storageMode?: 'filarr' | 'byos';
      byosLocality?: 'public' | 'local';
      machineContainerV3Write?: boolean;
      deltaV5Write?: boolean;
    }>(
      capabilityProfileId
        ? `/sync/capabilities?profileId=${encodeURIComponent(capabilityProfileId)}`
        : '/sync/capabilities'
    );
    cachedDirectCapability = !!(res.success && res.data?.directUpload);
    cachedDeltaCapability = !!(res.success && res.data?.deltaSync);
    cachedStorageMode = res.success && res.data?.storageMode === 'byos' ? 'byos' : 'filarr';
    // Absent = `public`. Un worker anterieur a BYOS Local n'envoie pas ce champ,
    // et son magasin est forcement joignable : le comportement ne change pas.
    cachedStorageLocality = res.success && res.data?.byosLocality === 'local' ? 'local' : 'public';
    // Interrupteurs d'ÉCRITURE des nouveaux formats, tenus par le serveur : un
    // `wrangler deploy` les bascule pour tous les bureaux à jour, dans les deux
    // sens, sans nouvelle version. Absents ou faux → on écrit comme avant.
    setServerMachineV3Write(!!(res.success && res.data?.machineContainerV3Write));
    setServerDeltaV5Write(!!(res.success && res.data?.deltaV5Write));
  } catch {
    cachedDirectCapability = false;
    cachedDeltaCapability = false;
    cachedStorageMode = 'filarr';
    cachedStorageLocality = 'public';
    setServerMachineV3Write(false);
    setServerDeltaV5Write(false);
  }
  log.info(
    `[syncR2] capabilities: directUpload=${cachedDirectCapability} deltaSync=${cachedDeltaCapability} ` +
      `storageMode=${cachedStorageMode} v3Write=${isMachineV3WriteEnabled('all')} v5Write=${isDeltaV5WriteEnabled()}`
  );
}

/**
 * Feature-detect the direct-to-R2 data plane. Cached for the process lifetime —
 * the capability is a stable Worker-config property.
 */
/**
 * Sonde les capacités MAINTENANT (une requête), sans attendre qu'une remontée
 * en ait besoin. Au début du cycle : les interrupteurs d'écriture serveur
 * (conteneur v3, delta v5) doivent être connus AVANT la première écriture du
 * cycle — et avant que `notes:load` décide s'il migre le coffre. La 3.1.1 ne
 * sondait qu'au hasard d'une remontée : un bureau qui ne remontait rien
 * n'apprenait jamais qu'on l'avait allumé. Un échec dégrade en « faux ».
 */
export async function refreshCapabilities(): Promise<void> {
  await fetchCapabilities();
}

export async function getDirectUploadCapability(): Promise<boolean> {
  if (cachedDirectCapability === null) await fetchCapabilities();
  return cachedDirectCapability ?? false;
}

/**
 * Feature-detect block-level delta sync (/sync/blocks/* + /sync/delta-manifest/*).
 * The client only takes the delta path when this is true; otherwise the existing
 * multipart/legacy path handles the file unchanged.
 */
export async function getDeltaSyncCapability(): Promise<boolean> {
  if (cachedDeltaCapability === null) await fetchCapabilities();
  return cachedDeltaCapability ?? false;
}

export async function getStorageMode(): Promise<'filarr' | 'byos'> {
  if (cachedStorageMode === null) await fetchCapabilities();
  return cachedStorageMode ?? 'filarr';
}

/**
 * Le magasin est-il sur le RESEAU LOCAL de l'utilisateur ?
 *
 * En cas de doute, on repond `false` : c'est le comportement d'avant ce lot
 * (relais par le worker), qui echoue proprement au lieu de tenter un envoi
 * presigne vers un magasin qui n'en attend pas.
 */
export async function isLocalStore(): Promise<boolean> {
  if (cachedStorageLocality === null) await fetchCapabilities();
  return cachedStorageLocality === 'local';
}

/** Force the direct capability off for the rest of the session (e.g. routes 404). */
export function markDirectUnavailable(): void {
  cachedDirectCapability = false;
}

/** Reset the cached capabilities (called on profile switch / session end / each cycle). */
export function resetDirectCapabilityCache(): void {
  cachedDirectCapability = null;
  cachedDeltaCapability = null;
  cachedStorageMode = null;
  cachedStorageLocality = null;
  // Les interrupteurs serveur suivent la sonde : tant qu'elle n'a pas reparlé,
  // on écrit comme avant.
  setServerMachineV3Write(false);
  setServerDeltaV5Write(false);
}

// ── Real control-plane + fetch dependencies ──────────────────────────────────

const directControlPlane: DirectControlPlane = {
  createDirect: async (profileId, fileId, expectedTotalBytes, partSize) => {
    // The engine speaks an opaque `token`; the direct S3 lifecycle keys on the
    // R2 uploadId, so token === uploadId on this path. partCount is derived
    // EXACTLY as the engine slices the file (ceil(total / partSize)) so the
    // Worker signs each UploadPart URL for the right byte length (parts 1..N-1
    // are partSize, the final part is the remainder).
    const partCount = Math.max(1, Math.ceil(expectedTotalBytes / partSize));
    const r = await authenticatedApiCall<{
      uploadId: string;
      key: string;
      partSize: number;
      partCount: number;
    }>('/sync/multipart-direct/create', {
      method: 'POST',
      body: JSON.stringify({
        profileId,
        fileId,
        totalSize: expectedTotalBytes,
        partSize,
        partCount,
      }),
    });
    if (!r.success || !r.data) throw mapDirectControlError(r.error, 'create', r.code);
    return {
      token: r.data.uploadId,
      uploadId: r.data.uploadId,
      key: r.data.key,
      partSize: r.data.partSize,
    };
  },
  // token === uploadId. The Worker recomputes the exact signed Content-Length
  // server-side from its stored intent — the client only names the part, so
  // there's no way for client/server to disagree on a part's length.
  signPart: async (token, partNumber) => {
    const r = await authenticatedApiCall<{ url: string }>('/sync/multipart-direct/sign', {
      method: 'POST',
      body: JSON.stringify({ uploadId: token, partNumber }),
    });
    if (!r.success || !r.data) throw mapDirectControlError(r.error, 'sign', r.code);
    return { url: r.data.url };
  },
  completeDirect: async (token, parts) => {
    const r = await authenticatedApiCall<{ key: string; size: number }>('/sync/multipart-direct/complete', {
      method: 'POST',
      body: JSON.stringify({ uploadId: token, parts }),
    });
    if (!r.success || !r.data) throw mapDirectCompleteError(r.error, r.code);
    return r.data;
  },
  abortDirect: async (token) => {
    try {
      // The Worker route is a DELETE (sync.delete) carrying a JSON body.
      await authenticatedApiCall('/sync/multipart-direct/abort', {
        method: 'DELETE',
        body: JSON.stringify({ uploadId: token }),
      });
    } catch (err) {
      log.warn('[syncR2] abortDirect failed:', err);
    }
  },
};

// Direct HTTP to R2. A WHATWG Response is structurally assignable to
// DirectFetchResponse; the timeout scales with the part size.
const directFetch: DirectFetch = async (url, init) => {
  const bytes = init.body ? init.body.length : 0;
  return fetchWithTimeout(
    url,
    { method: init.method, body: init.body, headers: init.headers },
    computeDirectTimeout(bytes)
  );
};

/**
 * Upload an already-encrypted on-disk blob DIRECTLY to R2 via presigned
 * multipart parts, with bounded parallelism (default 4), dynamic part sizing
 * and crash resume (mode:'direct' in the resume state; presigns re-requested
 * on resume, never persisted).
 */
export async function uploadViaMultipartDirectFromPath(
  profileId: string,
  fileId: string,
  filePath: string,
  totalBytes: number,
  fileChecksum: string,
  resumeStorePath: string,
  options: { onProgress?: (doneBytes: number, totalBytes: number) => void } = {}
): Promise<{ key: string; size: number }> {
  const store = createFileResumeStore(resumeStorePath);
  const transport = createDirectMultipartTransport(directControlPlane, directFetch);
  const result = await uploadFileMultipartParallel(
    transport,
    store,
    { profileId, fileId, filePath, totalBytes, fileChecksum },
    {
      partSize: computePartSize(totalBytes),
      concurrency: DEFAULT_UPLOAD_CONCURRENCY,
      onProgress: options.onProgress,
    }
  );
  log.info(`[syncR2] Direct multipart uploaded ${fileId} (${result.size} bytes)`);
  return result;
}

/**
 * Abort + clear any DIRECT resume session for `fileId` (used before falling
 * back to the proxied path so the S3 upload doesn't leak). No-op if the stored
 * session isn't a direct one.
 */
export async function abortDirectSession(fileId: string, resumeStorePath: string): Promise<void> {
  const store = createFileResumeStore(resumeStorePath);
  const state = await store.load(fileId);
  if (state && state.mode === 'direct') {
    await directControlPlane.abortDirect(state.token).catch(() => undefined);
    await store.clear(fileId);
  }
}

/**
 * Parallel ranged download straight from R2 via a single reusable presigned GET
 * URL. Re-presigns transparently (once per expiry window, mutex-guarded) when a
 * range GET comes back 403, so a multi-hour download survives URL expiry.
 */
export async function downloadChunkToFileDirectRanged(
  profileId: string,
  fileId: string,
  chunkIndex: number,
  totalSize: number,
  destPath: string,
  options: { onProgress?: (doneBytes: number, totalBytes: number) => void } = {}
): Promise<{ checksum: string; size: number }> {
  let currentUrl: string | null = null;
  const urlMutex = createMutex();

  const presign = async (): Promise<string> => {
    const r = await authenticatedApiCall<{ url: string }>(
      '/sync/presign/download-direct',
      { method: 'POST', body: JSON.stringify({ profileId, fileId, chunkIndex }) }
    );
    if (!r.success || !r.data?.url) throw mapDirectControlError(r.error, 'presign-download', r.code);
    return r.data.url;
  };
  const getUrl = async (): Promise<string> =>
    urlMutex(async () => {
      if (!currentUrl) currentUrl = await presign();
      return currentUrl;
    });
  // Re-presign only if nobody else already refreshed past `stale`.
  const refreshUrl = async (stale: string): Promise<string> =>
    urlMutex(async () => {
      if (currentUrl === stale || currentUrl === null) currentUrl = await presign();
      return currentUrl;
    });

  const source: RangeSource = {
    read: async (offset, length) => {
      const header = { Range: `bytes=${offset}-${offset + length - 1}` };
      const timeout = computeDirectTimeout(length);
      let url = await getUrl();
      let res = await fetchWithTimeout(url, { method: 'GET', headers: header }, timeout);
      if (res.status === 403) {
        url = await refreshUrl(url);
        res = await fetchWithTimeout(url, { method: 'GET', headers: header }, timeout);
      }
      if (res.status === 206) {
        return { data: Buffer.from(await res.arrayBuffer()), complete: false };
      }
      if (res.status === 200) {
        return { data: Buffer.from(await res.arrayBuffer()), complete: true };
      }
      if (res.status === 404) {
        throw new Error('Objet R2 introuvable pour le telechargement direct (HTTP 404)');
      }
      throw new Error(`Telechargement direct R2 echoue (HTTP ${res.status})`);
    },
  };

  const result = await downloadToFileParallel(source, totalSize, destPath, {
    onProgress: options.onProgress,
    concurrency: DEFAULT_DOWNLOAD_CONCURRENCY,
  });
  log.info(`[syncR2] Direct ranged download ${fileId}/${chunkIndex} (${result.size} bytes)`);
  return result;
}

// The full-body fallback (server without Range support answers 200) has to
// buffer the entire response — refuse it beyond this size instead of letting
// a multi-GB blob blow up main-process memory. The deployed Worker with
// Range support never triggers this path.
const RANGED_FALLBACK_MAX_BYTES = 500 * 1024 * 1024;

/**
 * Downloads one blob (chunkIndex, normally 0 for multipart-uploaded files)
 * of known encrypted size into `destPath` via 64 MiB ranged GETs — flat
 * memory, streaming sha256. Each ranged read presigns its own single-use
 * token (the Worker deletes the token on first consumption, ranged or not).
 * Returns the sha256 (hex) of the written bytes for checksum comparison.
 */
export async function downloadChunkToFileRanged(
  profileId: string,
  fileId: string,
  chunkIndex: number,
  totalSize: number,
  destPath: string,
  options: { onProgress?: (doneBytes: number, totalBytes: number) => void } = {}
): Promise<{ checksum: string; size: number }> {
  const source: RangeSource = {
    read: async (offset, length) => {
      const tokenResult = await authenticatedApiCall<{ downloadUrl: string }>(
        '/sync/presign/download',
        {
          method: 'POST',
          body: JSON.stringify({ profileId, fileId, chunkIndex }),
        }
      );
      if (!tokenResult.success || !tokenResult.data) {
        throw new Error(tokenResult.error || 'Failed to get download token');
      }
      const downloadUrl = `${API_BASE}${tokenResult.data.downloadUrl}`;
      const response = await fetchWithTimeout(
        downloadUrl,
        {
          method: 'GET',
          headers: { Range: `bytes=${offset}-${offset + length - 1}` },
        },
        MULTIPART_PART_TIMEOUT
      );
      if (response.status === 206) {
        return { data: Buffer.from(await response.arrayBuffer()), complete: false };
      }
      if (response.status === 200) {
        // Server ignored the Range header (pre-Range Worker) — full body.
        if (totalSize > RANGED_FALLBACK_MAX_BYTES) {
          throw new Error(
            'Le serveur ne prend pas encore en charge le telechargement par plages - fichier trop volumineux'
          );
        }
        return { data: Buffer.from(await response.arrayBuffer()), complete: true };
      }
      throw new Error(`Ranged chunk download failed: HTTP ${response.status}`);
    },
  };
  const result = await downloadToFileRanged(source, totalSize, destPath, {
    onProgress: options.onProgress,
  });
  log.info(`[syncR2] Ranged download ${fileId}/${chunkIndex} (${result.size} bytes)`);
  return result;
}

/** Build the proxied per-range RangeSource (one single-use token per range). */
function createProxiedRangeSource(
  profileId: string,
  fileId: string,
  chunkIndex: number,
  totalSize: number
): RangeSource {
  return {
    read: async (offset, length) => {
      const tokenResult = await authenticatedApiCall<{ downloadUrl: string }>(
        '/sync/presign/download',
        { method: 'POST', body: JSON.stringify({ profileId, fileId, chunkIndex }) }
      );
      if (!tokenResult.success || !tokenResult.data) {
        throw new Error(tokenResult.error || 'Failed to get download token');
      }
      const downloadUrl = `${API_BASE}${tokenResult.data.downloadUrl}`;
      const response = await fetchWithTimeout(
        downloadUrl,
        { method: 'GET', headers: { Range: `bytes=${offset}-${offset + length - 1}` } },
        MULTIPART_PART_TIMEOUT
      );
      if (response.status === 206) {
        return { data: Buffer.from(await response.arrayBuffer()), complete: false };
      }
      if (response.status === 200) {
        if (totalSize > RANGED_FALLBACK_MAX_BYTES) {
          throw new Error(
            'Le serveur ne prend pas encore en charge le telechargement par plages - fichier trop volumineux'
          );
        }
        return { data: Buffer.from(await response.arrayBuffer()), complete: true };
      }
      throw new Error(`Ranged chunk download failed: HTTP ${response.status}`);
    },
  };
}

/**
 * Parallel proxied ranged download: same per-range single-use-token model as
 * downloadChunkToFileRanged, but with bounded concurrency and out-of-order
 * positioned writes. The initial probe still tolerates a full-body 200 from a
 * pre-Range Worker (capped at RANGED_FALLBACK_MAX_BYTES).
 */
export async function downloadChunkToFileRangedParallel(
  profileId: string,
  fileId: string,
  chunkIndex: number,
  totalSize: number,
  destPath: string,
  options: { onProgress?: (doneBytes: number, totalBytes: number) => void } = {}
): Promise<{ checksum: string; size: number }> {
  const source = createProxiedRangeSource(profileId, fileId, chunkIndex, totalSize);
  const result = await downloadToFileParallel(source, totalSize, destPath, {
    onProgress: options.onProgress,
    concurrency: DEFAULT_DOWNLOAD_CONCURRENCY,
  });
  log.info(`[syncR2] Parallel ranged download ${fileId}/${chunkIndex} (${result.size} bytes)`);
  return result;
}

// ── Delete File ─────────────────────────────────────────────────────────────

/**
 * Efface les morceaux d'un fichier par URL presignees — chemin du magasin LOCAL.
 *
 * Un 404 sur un morceau n'est PAS une erreur : il signifie que l'objet n'est
 * deja plus la, ce qui est le resultat recherche. Seul un refus (403, ou une
 * signature expiree) doit remonter, sinon on effacerait l'entree du manifeste
 * en laissant les octets dans le bucket.
 */
async function deleteFilePresigned(
  profileId: string,
  fileId: string,
  chunkCount: number
): Promise<void> {
  for (let chunkIndex = 0; chunkIndex < Math.max(1, chunkCount); chunkIndex++) {
    const signed = await authenticatedApiCall<{ url: string }>('/sync/presign/delete-direct', {
      method: 'POST',
      body: JSON.stringify({ profileId, fileId, chunkIndex }),
    });
    if (!signed.success || !signed.data) {
      throw new Error(signed.error || 'Failed to presign chunk delete');
    }
    const response = await fetchWithTimeout(signed.data.url, { method: 'DELETE' }, CHUNK_TIMEOUT);
    // S3 rend 204 sur une suppression reussie et 404 quand l'objet n'existait
    // deja plus — les deux sont un succes de notre point de vue.
    if (!response.ok && response.status !== 404) {
      throw new Error(`Chunk delete failed: HTTP ${response.status}`);
    }
  }
  log.info(`[syncR2] Deleted file ${fileId} (presigned, ${chunkCount} chunk(s))`);
}

/**
 * Delete all chunks of a file from R2.
 */
export async function deleteFile(
  profileId: string,
  fileId: string,
  chunkCount = 1
): Promise<void> {
  /*
    MAGASIN LOCAL : LA SUPPRESSION SE FAIT D'ICI, MORCEAU PAR MORCEAU.

    La route serveur enumere le prefixe et efface — deux choses qu'un worker ne
    peut pas faire sur un NAS qu'il ne joint pas. Sans ce chemin, les objets
    supprimes resteraient a jamais dans le bucket de l'utilisateur : une fuite
    d'espace SILENCIEUSE, sur un stockage qu'il paie lui-meme.

    On ne peut pas lister depuis ici (aucune signature de listing n'est emise,
    volontairement : elle exposerait tout le prefixe). On efface donc les
    indices que le MANIFESTE connait — c'est-a-dire exactement ce que ce client
    a ecrit. `chunkCount` vient de `entry.chunks.length`.
  */
  if (await isLocalStore()) {
    return deleteFilePresigned(profileId, fileId, chunkCount);
  }
  // Même reprise que la suppression de profil : au-delà du budget de
  // sous-requêtes du Worker, la purge est PARTIELLE et le dit (409
  // `deletion_incomplete`). On relance jusqu'à ce que le préfixe soit vide.
  const MAX_PASSES = 40;
  let result: Awaited<ReturnType<typeof authenticatedApiCall>> | undefined;
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    result = await authenticatedApiCall(`/sync/file/${profileId}/${fileId}`, { method: 'DELETE' });
    if (result.success) break;
    if (result.code !== 'deletion_incomplete') break;
    log.info(`[syncR2] deleteFile ${fileId}: passe ${pass + 1} partielle, on continue`);
  }

  if (!result?.success) {
    throw new Error(result?.error || 'Failed to delete file');
  }

  log.info(`[syncR2] Deleted file ${fileId} from R2`);
}

// ── Manifest: Read ──────────────────────────────────────────────────────────

/**
 * Fetch the encrypted manifest from R2.
 * Returns null manifest if none exists yet (first sync).
 *
 * Pass `knownVersion` to perform a conditional GET — if the server's
 * manifest_version still matches, the Worker returns 304 and we yield
 * `notModified: true` so callers can skip the decrypt/merge work. This
 * is the common case once a profile is in steady state.
 */
export async function getManifest(
  profileId: string,
  knownVersion?: number
): Promise<{ manifest: Buffer | null; version: number; notModified?: boolean }> {
  // Use a direct fetch instead of authenticatedApiCall here because a 304
  // response has no body — apiCall's "non-JSON response" guard would
  // misclassify it as an error. We still need the Bearer auth header.
  const accessToken = await getAccessToken();
  if (!accessToken) {
    throw new Error('Not authenticated');
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };
  if (typeof knownVersion === 'number') {
    headers['If-None-Match'] = `W/"v${knownVersion}"`;
  }

  const response = await fetchWithTimeout(
    `${API_BASE}/sync/manifest/${profileId}`,
    { method: 'GET', headers },
    CHUNK_TIMEOUT
  );

  if (response.status === 304) {
    // Server says nothing changed since `knownVersion` — skip the heavy
    // decrypt path in the caller. We return version=knownVersion since
    // that's what the ETag was issued against.
    return { manifest: null, version: knownVersion ?? 0, notModified: true };
  }

  if (!response.ok) {
    const txt = await response.text().catch(() => '');
    throw new Error(`Failed to fetch manifest: HTTP ${response.status} ${txt}`);
  }

  const body = (await response.json()) as {
    success: boolean;
    data?: { manifest: string | null; version: number };
    error?: string;
  };
  if (!body.success || !body.data) {
    throw new Error(body.error || 'Failed to fetch manifest');
  }

  if (body.data.manifest === null) {
    // CEINTURE ET BRETELLES. Le serveur rend maintenant 503 quand il n'a pas
    // pu LIRE le magasin, mais l'invariant se vérifie aussi ici : un profil
    // dont la version a déjà avancé NE PEUT PAS être sans manifeste. Prendre
    // cette réponse pour « nuage vide » fait fusionner le local dans du vide,
    // puis écraser le vrai manifeste — les fichiers des autres appareils avec.
    // Vaut aussi pour le chemin Filarr Cloud, qui avait la même faille.
    if (body.data.version > 0) {
      throw new Error(
        `Manifeste absent alors que la version distante est ${body.data.version} — ` +
          'magasin incohérent, cycle interrompu'
      );
    }
    return { manifest: null, version: body.data.version };
  }

  const buffer = Buffer.from(body.data.manifest, 'base64');
  return { manifest: buffer, version: body.data.version };
}

// ── Manifest: Write ─────────────────────────────────────────────────────────

/**
 * Upload a new encrypted manifest to R2 with optimistic locking.
 * Throws SyncConflictError if the server version doesn't match.
 */
export async function putManifest(
  profileId: string,
  encryptedManifest: Buffer,
  currentVersion: number
): Promise<number> {
  // 1. Request upload token with version check
  const tokenResult = await authenticatedApiCall<{
    uploadUrl: string;
    newVersion: number;
  }>(`/sync/manifest/${profileId}`, {
    method: 'PUT',
    body: JSON.stringify({ version: currentVersion }),
  });

  if (!tokenResult.success || !tokenResult.data) {
    // Check for 409 conflict
    if (tokenResult.error?.includes('conflict') || tokenResult.error?.includes('Conflict')) {
      const serverVersion = (tokenResult as any).data?.serverVersion ?? currentVersion + 1;
      throw new SyncConflictError(serverVersion);
    }
    throw new Error(tokenResult.error || 'Failed to get manifest upload token');
  }

  // 2. Upload manifest via token
  const uploadUrl = `${API_BASE}${tokenResult.data.uploadUrl}`;
  const response = await fetchWithTimeout(
    uploadUrl,
    {
      method: 'PUT',
      body: encryptedManifest,
      headers: { 'Content-Type': 'application/octet-stream' },
    },
    CHUNK_TIMEOUT
  );

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    if (response.status === 409) {
      throw new SyncConflictError(currentVersion + 1);
    }
    throw new Error(`Manifest upload failed: ${text}`);
  }

  const result = await response.json() as { success: boolean; data?: { version: number }; error?: string };
  if (!result.success || !result.data) {
    throw new Error(result.error || 'Manifest confirmation failed');
  }

  const newVersion = result.data.version;
  log.info(`[syncR2] Manifest uploaded, version ${currentVersion} → ${newVersion}`);
  return newVersion;
}

// ── Status ──────────────────────────────────────────────────────────────────

/**
 * Get sync status for a profile (storage usage, version, last sync).
 */
export async function getSyncStatus(profileId: string): Promise<SyncStatus> {
  const result = await authenticatedApiCall<SyncStatus>(
    `/sync/status/${profileId}`
  );

  if (!result.success || !result.data) {
    throw new Error(result.error || 'Failed to get sync status');
  }

  return result.data;
}

/**
 * Recompute storage_used_bytes for a profile from actual R2 objects.
 * Best-effort: failure is logged but not thrown, as stale counters are a
 * display-only issue and shouldn't block sync.
 */
export async function recalculateStorage(
  profileId: string
): Promise<{ storageUsed: number; storageLimit: number } | null> {
  try {
    const result = await authenticatedApiCall<{
      storageUsed: number;
      storageLimit: number;
    }>(`/sync/recalculate/${profileId}`, { method: 'POST' });
    return result.success && result.data ? result.data : null;
  } catch (err) {
    log.warn('[sync] recalculateStorage failed:', err);
    return null;
  }
}

/** Ce que l'inventaire du profil rapporte. Les octets, pas les noms. */
/**
 * UN REFUS N'EST PAS UN INVENTAIRE VIDE, d'ou un type a part.
 *
 * Des champs optionnels sur l'inventaire auraient laisse un appelant lire
 * `orphanBytes` a zero sur un refus et conclure « rien a liberer » — la pire
 * reponse fausse ici, puisqu'elle ferme la question au lieu de la poser.
 */
export interface ProfileGcRefusal {
  failed: true;
  code: string;
  message: string | null;
}

export interface ProfileGcInventory {
  totalBytes: number;
  liveBytes: number;
  manifestBytes: number;
  orphanBytes: number;
  orphanCount: number;
  /** Morceaux / blocs / manifestes delta — c'est ce qui designe la cause. */
  orphanByPiece: Record<'chunk' | 'block' | 'delta-manifest', { count: number; bytes: number }>;
  orphanFileCount: number;
  orphanFileIds: string[];
  youngCount: number;
  youngBytes: number;
  unknown: string[];
  unknownCount: number;
  unknownBytes: number;
  counterBytes: number;
  executed: boolean;
  complete: boolean;
  skipped?: boolean;
  reason?: string;
  deletedCount?: number;
  deletedBytes?: number;
}

/**
 * POST /sync/gc-profile — CE QUI NE SERT PLUS À RIEN DANS LE NUAGE.
 *
 * `/sync/delta/gc` ramasse les blocs orphelins à l'intérieur d'un fichier
 * VIVANT ; `DELETE /sync/file` purge celui qu'on supprime. Aucun des deux ne
 * visite un fichier DISPARU du manifeste sans être passé par le DELETE — les
 * deux itèrent sur ce qui est encore là. `scanLocalFiles` en fabrique à chaque
 * migration de clés héritées.
 *
 * `execute` ABSENT = ON REGARDE. Il faut l'écrire pour supprimer, et c'est le
 * bon sens de l'oubli : un appel malformé inventorie, il n'efface pas.
 *
 * L'ENSEMBLE VIVANT VIENT D'ICI parce qu'il ne peut venir de nulle part
 * ailleurs : le manifeste est chiffré de bout en bout, et le serveur ne sait
 * pas quels fichiers existent encore. Il refuse d'ailleurs un ensemble vide et
 * revérifie la version du manifeste avant de toucher à quoi que ce soit.
 *
 * BEST-EFFORT : un échec est journalisé, jamais propagé. Un ramassage qui
 * ferait échouer une synchronisation réussie serait absurde.
 */
export async function gcProfile(
  profileId: string,
  liveFileIds: string[],
  manifestVersion: number,
  execute = false
): Promise<ProfileGcInventory | ProfileGcRefusal | null> {
  try {
    const result = await authenticatedApiCall<ProfileGcInventory>('/sync/gc-profile', {
      method: 'POST',
      body: JSON.stringify({ profileId, liveFileIds, manifestVersion, execute }),
    });
    if (result.success && result.data) return result.data;
    /*
      LA RAISON REMONTE, ELLE NE SE PERD PAS.

      `authenticatedApiCall` NE JETTE PAS : il rend `{ success: false, error,
      code }`. Rendre `null` ici avalait donc la cause en silence — limite de
      debit, session expiree, corps refuse — et l'ecran affichait « analyse
      impossible » sans qu'AUCUNE trace n'existe nulle part.

      Signale par Mathis le 2026-09-07 : le bouton refusait, le journal ne
      portait pas une ligne sur le sujet. Un message d'echec qui ne dit pas
      pourquoi ne laisse a personne — ni a l'utilisateur, ni a celui qui lira
      les journaux — de quoi agir.
    */
    const code = result.code || 'gc_failed';
    log.warn(`[sync] gcProfile refuse (${code}) : ${result.error ?? 'sans message'}`);
    return { failed: true, code, message: result.error ?? null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn('[sync] gcProfile a jete :', message);
    return { failed: true, code: 'gc_threw', message };
  }
}

// ── Block-level delta sync transport (/sync/delta/*) ──────────────────────────
//
// The real HTTP implementation of the DeltaTransport that deltaSync.ts drives.
// Route shapes match the deployed Worker (infra/cloudflare-worker sync.ts
// /sync/delta/*). Blocks are small (<= 8 MiB + 28 B) so they never need
// multipart — a single quota-atomic proxied PUT per block, and a presigned
// direct-R2 GET (proxied GET fallback) per block on download. Exercised
// end-to-end only at deploy time (real R2); the client unit tests drive a fake
// transport that models the same contract.

const BLOCK_TIMEOUT = 60_000; // 60s per block PUT/GET (<= 8 MiB objects)
const DELTA_BLOCK_HASH_RE = /^[0-9a-f]{64}$/;

function assertBlockHash(hash: string): void {
  if (!DELTA_BLOCK_HASH_RE.test(hash)) {
    throw new Error(`Hash de bloc delta invalide: ${hash.slice(0, 16)}`);
  }
}

/**
 * POST /sync/delta/blocks-exist → the subset of `hashes` already on R2.
 * The Worker returns the MISSING set; we invert it to PRESENT for the diff.
 */
export async function blocksExist(
  profileId: string,
  fileId: string,
  hashes: string[]
): Promise<string[]> {
  if (hashes.length === 0) return [];
  const result = await authenticatedApiCall<{ missing: string[] }>('/sync/delta/blocks-exist', {
    method: 'POST',
    body: JSON.stringify({ profileId, fileId, hashes }),
  });
  if (!result.success || !result.data) {
    throw new Error(result.error || 'Echec de la verification des blocs delta');
  }
  const missing = new Set(result.data.missing);
  return hashes.filter((h) => !missing.has(h));
}

/**
 * PUT one encrypted block object (proxied, quota-atomic). Content-addressed
 * idempotency: an already-present block returns { deduped:true } with no re-put
 * and no quota change; a fresh store returns { stored:true }. The body is opaque
 * ciphertext — the Worker never decrypts it.
 */
export async function putBlock(
  profileId: string,
  fileId: string,
  hash: string,
  body: Buffer
): Promise<{ deduped: boolean; size: number }> {
  assertBlockHash(hash);
  const accessToken = await getAccessToken();
  if (!accessToken) throw new Error('Not authenticated');
  const response = await fetchWithTimeout(
    `${API_BASE}/sync/delta/block/${profileId}/${fileId}/${hash}`,
    {
      method: 'PUT',
      body,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/octet-stream',
      },
    },
    BLOCK_TIMEOUT
  );
  if (!response.ok) {
    const txt = await response.text().catch(() => '');
    throw new Error(`Block upload failed: HTTP ${response.status} ${txt}`.trim());
  }
  const result = (await response.json()) as {
    success: boolean;
    data?: { deduped?: boolean; stored?: boolean; size?: number };
    error?: string;
  };
  if (!result.success || !result.data) {
    throw new Error(result.error || 'Block upload confirmation failed');
  }
  return { deduped: !!result.data.deduped, size: result.data.size ?? body.byteLength };
}

/**
 * GET one encrypted block object by hash. Prefers a presigned direct-R2 GET
 * (bytes bypass the Worker) when the direct plane is up; falls back to the
 * proxied GET. Rejects when the object is absent (404) so deltaSync surfaces
 * corruption (DeltaBlockMissingError).
 */
export async function getBlock(
  profileId: string,
  fileId: string,
  hash: string
): Promise<Buffer> {
  assertBlockHash(hash);
  const direct = await getDirectUploadCapability();
  if (direct) {
    try {
      return await getBlockDirect(profileId, fileId, hash);
    } catch (err) {
      if (isClearlyTransientError(err)) throw err;
      if (err instanceof ByosSyncError) throw err;
      // Le repli proxy est désormais sûr en BYOS aussi : GET /sync/delta/block lit
      // le bucket de l'UTILISATEUR (objectStore), plus jamais le R2 Filarr.
      if (err instanceof DirectUploadUnavailableError) markDirectUnavailable();
      log.warn(`[syncR2] Direct block GET failed for ${hash.slice(0, 12)}, using proxied`);
    }
  }
  return getBlockProxied(profileId, fileId, hash);
}

async function getBlockDirect(profileId: string, fileId: string, hash: string): Promise<Buffer> {
  const r = await authenticatedApiCall<{ url: string }>('/sync/delta/block-presign-get', {
    method: 'POST',
    body: JSON.stringify({ profileId, fileId, hash }),
  });
  if (!r.success || !r.data?.url) throw mapDirectControlError(r.error, 'presign-block', r.code);
  const res = await fetchWithTimeout(r.data.url, { method: 'GET' }, BLOCK_TIMEOUT);
  if (res.status === 404) {
    throw new Error('Bloc delta introuvable sur R2 (HTTP 404)');
  }
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`Telechargement de bloc delta echoue (HTTP ${res.status})`);
  }
  return Buffer.from(await res.arrayBuffer());
}

async function getBlockProxied(profileId: string, fileId: string, hash: string): Promise<Buffer> {
  const accessToken = await getAccessToken();
  if (!accessToken) throw new Error('Not authenticated');
  const res = await fetchWithTimeout(
    `${API_BASE}/sync/delta/block/${profileId}/${fileId}/${hash}`,
    { method: 'GET', headers: { Authorization: `Bearer ${accessToken}` } },
    BLOCK_TIMEOUT
  );
  if (res.status === 404) {
    throw new Error('Bloc delta introuvable sur R2 (HTTP 404)');
  }
  if (!res.ok) {
    throw new Error(`Telechargement de bloc delta echoue (HTTP ${res.status})`);
  }
  return Buffer.from(await res.arrayBuffer());
}

/** GET /sync/delta/manifest/:profileId/:fileId → { manifest: Buffer|null, version }. */
export async function getDeltaManifest(
  profileId: string,
  fileId: string
): Promise<{ manifest: Buffer | null; version: number }> {
  const result = await authenticatedApiCall<{ manifest: string | null; version: number }>(
    `/sync/delta/manifest/${profileId}/${fileId}`
  );
  if (!result.success || !result.data) {
    throw new Error(result.error || 'Echec de recuperation du manifeste delta');
  }
  const manifest =
    result.data.manifest === null ? null : Buffer.from(result.data.manifest, 'base64');
  return { manifest, version: result.data.version };
}

/**
 * PUT the encrypted delta manifest (single-step, optimistic lock). The Worker
 * ALSO validates that every `liveHashes` entry is present on R2 and refuses
 * (409) otherwise, so a committed manifest can never reference a missing block.
 * A version conflict maps to DeltaManifestConflictError (re-diff + retry); a
 * missing-block 409 (echoing `data.missing[]`) maps to the DISTINCT
 * DeltaBlocksMissingOnCommitError, so deltaSync force re-uploads those hashes from
 * the local V3 and retries instead of looping the version-conflict path forever.
 */
export async function putDeltaManifest(
  profileId: string,
  fileId: string,
  encrypted: Buffer,
  liveHashes: string[],
  expectedVersion: number
): Promise<{ version: number }> {
  const result = await authenticatedApiCall<{
    version?: number;
    serverVersion?: number;
    missing?: string[];
  }>(`/sync/delta/manifest/${profileId}/${fileId}`, {
    method: 'PUT',
    body: JSON.stringify({
      version: expectedVersion,
      blocks: liveHashes,
      manifest: encrypted.toString('base64'),
    }),
  });
  if (!result.success || result.data?.version == null) {
    const data = (result as { data?: { serverVersion?: number; missing?: string[] } }).data;
    // A missing-block 409 carries data.missing[] — distinct from a version conflict.
    if (Array.isArray(data?.missing) && data.missing.length > 0) {
      throw new DeltaBlocksMissingOnCommitError(data.missing);
    }
    const err = result.error || '';
    if (/conflict/i.test(err) || /missing block/i.test(err)) {
      const serverVersion = data?.serverVersion ?? expectedVersion;
      throw new DeltaManifestConflictError(serverVersion);
    }
    throw new Error(result.error || 'Delta manifest commit failed');
  }
  return { version: result.data.version };
}

/** POST /sync/delta/gc — reclaim orphan blocks against the just-committed live set. */
export async function gcBlocks(
  profileId: string,
  fileId: string,
  liveHashes: string[],
  committedVersion: number
): Promise<{ skipped: boolean; deletedBytes: number }> {
  const result = await authenticatedApiCall<{ skipped?: boolean; deletedBytes?: number }>(
    '/sync/delta/gc',
    {
      method: 'POST',
      body: JSON.stringify({ profileId, fileId, liveHashes, committedVersion }),
    }
  );
  if (!result.success || !result.data) {
    throw new Error(result.error || 'Echec du GC des blocs delta');
  }
  return { skipped: !!result.data.skipped, deletedBytes: result.data.deletedBytes ?? 0 };
}

/** Build the real HTTP DeltaTransport that deltaSync consumes. */
export function createDeltaTransport(): DeltaTransport {
  return {
    blocksExist,
    putBlock,
    getBlock,
    getDeltaManifest,
    putDeltaManifest,
    gc: gcBlocks,
  };
}
