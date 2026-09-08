/**
 * Multipart transfer engine — resumable large-file upload/download for sync.
 *
 * Pure Node module (no Electron imports) so the whole state machine is
 * unit-testable against an in-memory HTTP fake:
 *  - upload: reads the ALREADY-ENCRYPTED blob from disk in fixed-size slices
 *    (one reused buffer — flat memory), PUTs each part with retry/backoff,
 *    persists {token, uploadId, key, completedParts} after every part so a
 *    crash resumes at the next part, completes at the end;
 *  - download: fetches fixed-size ranges into a temp file with a streaming
 *    sha256 (never the whole blob in RAM), tolerating servers that ignore
 *    Range (full-body 200 fallback);
 *  - the HTTP layer is injected (MultipartTransport / RangeSource) — the real
 *    implementations live in syncR2Client.ts against the Worker routes.
 *
 * The resume state NEVER contains key material — only opaque upload tokens,
 * R2 keys and part etags.
 */

import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as crypto from 'crypto';
import { cheminDeStaging } from '../atomicStaging';

// ── Constants ───────────────────────────────────────────────────────────────

// 64 MiB parts: well under the Worker's 96 MiB per-request ceiling, above
// R2's 5 MiB multipart minimum, and uniform across all non-final parts as
// R2 requires. Used ONLY by the legacy proxied path (bytes flow through the
// Worker, so the per-request ceiling caps the part size). The direct-to-R2
// path bypasses the Worker entirely and uses computePartSize() instead.
export const PART_SIZE = 64 * 1024 * 1024;

// Ranged download slice — bounded memory per range read.
export const DOWNLOAD_CHUNK_SIZE = 64 * 1024 * 1024;

// ── Dynamic part sizing (direct-to-R2 path) ─────────────────────────────────
// R2/S3 allow at most 10 000 parts per multipart upload and 5 MiB..5 GiB per
// part. We target ~9000 parts so a change in file size never overruns the cap,
// then clamp into the legal per-part window. For any file up to the R2 5 TiB
// hard cap the part count stays comfortably < 10 000 (and even a hypothetical
// ~48 TiB would still fit). Below ~72 GiB the floor of 8 MiB wins (fewer,
// bigger parts than the 9000-target would give, which is fine — fewer round
// trips). Recording the chosen size in the resume state means a formula change
// on upgrade invalidates in-flight sessions cleanly rather than corrupting them.
export const MIN_DIRECT_PART_SIZE = 8 * 1024 * 1024; // 8 MiB (>= R2 5 MiB min)
export const MAX_DIRECT_PART_SIZE = 5 * 1024 * 1024 * 1024; // 5 GiB (R2 per-part max)
export const TARGET_PART_COUNT = 9000;

/**
 * Dynamic part size = clamp(ceil(totalBytes / 9000), 8 MiB, 5 GiB). Keeps the
 * part count < 10 000 for any supported file size while never dropping below
 * R2's 5 MiB minimum. Deterministic (pure function of size) so both create and
 * every per-part presign agree on the exact byte length of each part.
 */
export function computePartSize(totalBytes: number): number {
  const target = Math.ceil(Math.max(1, totalBytes) / TARGET_PART_COUNT);
  return Math.min(MAX_DIRECT_PART_SIZE, Math.max(MIN_DIRECT_PART_SIZE, target));
}

// Bounded parallelism for the direct path. Peak resident memory is
// concurrency * partSize (one part-sized buffer per in-flight worker), so the
// two are jointly bounded: when a large part size would blow the budget the
// effective concurrency is reduced (see clampConcurrency).
export const DEFAULT_UPLOAD_CONCURRENCY = 4;
export const DEFAULT_DOWNLOAD_CONCURRENCY = 4;
// Joint cap on in-flight bytes (concurrency * partSize). 512 MiB keeps 8 MiB
// parts at full 4-wide concurrency while forcing giant multi-hundred-MiB parts
// down to fewer concurrent workers so the main-process heap stays bounded.
export const MAX_INFLIGHT_BYTES = 512 * 1024 * 1024;

/**
 * Reduce the requested worker count so `concurrency * partSize <= inflightCap`
 * (at least 1) and never exceed the number of parts. Keeps peak resident
 * buffers bounded regardless of how large dynamic sizing pushes the part size.
 */
export function clampConcurrency(
  requested: number,
  partSize: number,
  totalUnits: number,
  inflightCap: number = MAX_INFLIGHT_BYTES
): number {
  const byBudget = Math.floor(inflightCap / Math.max(1, partSize)) || 1;
  return Math.max(1, Math.min(requested, byBudget, Math.max(1, totalUnits)));
}

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_BASE_DELAY_MS = 1000;

const ERR_PART_READ = 'Erreur de lecture du fichier a synchroniser';
const ERR_RANGE_SHORT = 'Telechargement incomplet - reponse partielle inattendue';
const ERR_RANGE_FULL_MIDSTREAM = 'Telechargement incoherent - reponse complete en milieu de plage';

// ── Errors ──────────────────────────────────────────────────────────────────

/**
 * Thrown by transports when the server no longer recognizes the upload
 * session (expired/consumed token, foreign uploadId). The engine reacts by
 * aborting the stale session and restarting the upload from scratch once —
 * this error is never retried in place.
 */
export class MultipartSessionInvalidError extends Error {
  constructor(message = 'Session de televersement expiree') {
    super(message);
    this.name = 'MultipartSessionInvalidError';
  }
}

// ── Types ───────────────────────────────────────────────────────────────────

export interface UploadedPart {
  partNumber: number;
  etag: string;
}

export interface MultipartCreateResult {
  token: string;
  uploadId: string;
  key: string;
  partSize: number;
}

/**
 * Which upload lifecycle a resume state belongs to. `proxied` = bytes stream
 * through the Worker (legacy path); `direct` = bytes go straight to R2 via
 * presigned URLs. The two use DIFFERENT, non-interchangeable multipart
 * sessions (Worker-binding uploadId vs S3 uploadId), so a resume state must
 * only ever be continued by the same lifecycle that created it.
 */
export type MultipartMode = 'proxied' | 'direct';

/** HTTP layer for the multipart upload routes (injected for testability). */
export interface MultipartTransport {
  /**
   * Open a session. `partSize` is the client-chosen dynamic part size — the
   * proxied transport ignores it (the Worker dictates its own), the direct
   * transport forwards it so every presigned part is signed for the exact
   * byte length.
   */
  create(
    profileId: string,
    fileId: string,
    expectedTotalBytes: number,
    partSize?: number
  ): Promise<MultipartCreateResult>;
  uploadPart(token: string, partNumber: number, body: Buffer): Promise<UploadedPart>;
  complete(token: string, parts: UploadedPart[]): Promise<{ key: string; size: number }>;
  abort(token: string): Promise<void>;
}

/** Persisted between app runs so a crashed upload resumes at the next part. */
export interface MultipartResumeState {
  token: string;
  uploadId: string;
  key: string;
  partSize: number;
  totalBytes: number;
  /** sha256 (hex) of the encrypted blob — invalidates resume if the file changed. */
  fileChecksum: string;
  completedParts: UploadedPart[];
  /**
   * Lifecycle that owns this session. Absent on states written by older builds
   * → treated as 'proxied'. A mismatch with the current attempt's mode forces a
   * clean abort + restart (presigns are NEVER persisted — re-requested on
   * resume — so only the opaque token/uploadId/etags live here).
   */
  mode?: MultipartMode;
}

export interface ResumeStateStore {
  load(fileId: string): Promise<MultipartResumeState | null>;
  save(fileId: string, state: MultipartResumeState): Promise<void>;
  clear(fileId: string): Promise<void>;
}

export interface UploadFileParams {
  profileId: string;
  fileId: string;
  filePath: string;
  totalBytes: number;
  fileChecksum: string;
}

export interface TransferOptions {
  partSize?: number;
  maxAttempts?: number;
  retryBaseDelayMs?: number;
  onProgress?: (doneBytes: number, totalBytes: number) => void;
}

/** TransferOptions plus bounded-parallelism knobs (direct path). */
export interface ParallelTransferOptions extends TransferOptions {
  /** Max concurrent in-flight parts/ranges (default 4). */
  concurrency?: number;
  /** Joint cap on concurrency * partSize resident bytes (default 512 MiB). */
  maxInflightBytes?: number;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Minimal async mutex: serializes the critical sections that mutate shared
 * resume state (completedParts.push + store.save) across parallel workers, so
 * concurrent atomic writeAll() calls never race/tear. Rejections are contained
 * so one failed section doesn't wedge the queue.
 */
export type Mutex = <T>(fn: () => Promise<T>) => Promise<T>;
export function createMutex(): Mutex {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(fn: () => Promise<T>): Promise<T> => {
    const run = tail.then(() => fn());
    tail = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  };
}

/**
 * Retries transient failures with exponential backoff. Structural failures
 * propagate immediately so the caller can react instead of retrying in
 * place:
 *  - MultipartSessionInvalidError → abort + restart once;
 *  - quota rejections → abort + clear (retrying cannot succeed, and on the
 *    complete route the server deletes its token alongside the 413 — a
 *    blind retry would come back 403 and masquerade as a session loss,
 *    triggering a pointless full re-upload).
 */
async function withRetry<T>(fn: () => Promise<T>, maxAttempts: number, baseDelayMs: number): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof MultipartSessionInvalidError || isQuotaError(error)) {
        throw error;
      }
      lastError = error;
      if (attempt < maxAttempts) {
        await sleep(baseDelayMs * 2 ** (attempt - 1));
      }
    }
  }
  throw lastError;
}

function isQuotaError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /quota/i.test(message) || message.includes('413');
}

/**
 * Structural validation of a persisted resume state against the file being
 * uploaded. A poisoned/corrupted state (hand-edited file, partial write,
 * clock rollback restoring an old backup...) must be treated exactly like a
 * stale one — abort the server session and restart clean — instead of being
 * trusted: out-of-range partNumbers would sail to complete() and wedge the
 * upload in a fail-forever loop, in-range fake entries would skip real part
 * uploads.
 */
function isResumeStateCoherent(state: MultipartResumeState): boolean {
  if (state.partSize <= 0 || state.totalBytes <= 0) return false;
  const expectedParts = Math.max(1, Math.ceil(state.totalBytes / state.partSize));
  if (state.completedParts.length > expectedParts) return false;
  const seen = new Set<number>();
  for (const part of state.completedParts) {
    if (
      !part ||
      typeof part !== 'object' ||
      !Number.isInteger(part.partNumber) ||
      part.partNumber < 1 ||
      part.partNumber > expectedParts ||
      typeof part.etag !== 'string' ||
      part.etag.length === 0 ||
      part.etag.length > 256 ||
      seen.has(part.partNumber)
    ) {
      return false;
    }
    seen.add(part.partNumber);
  }
  return true;
}

/** Streaming SHA-256 of a file — flat memory whatever the file size. */
export function streamingSha256(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fsSync.createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

// ── Resume state store (JSON file, one map per profile) ─────────────────────

/**
 * File-backed ResumeStateStore: a single JSON object mapping fileId → state,
 * written atomically (tmp + rename). Lives next to the sync manifest — never
 * contains key material.
 */
export function createFileResumeStore(stateFilePath: string): ResumeStateStore {
  async function readAll(): Promise<Record<string, MultipartResumeState>> {
    try {
      const raw = await fs.readFile(stateFilePath, 'utf-8');
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, MultipartResumeState>;
      }
      return {};
    } catch {
      return {};
    }
  }

  async function writeAll(all: Record<string, MultipartResumeState>): Promise<void> {
    // Nom de staging UNIQUE — voir `atomicStaging`. L'état est sauvé après
    // CHAQUE partie : deux parties qui se croisent partageaient leur staging.
    const tmpPath = cheminDeStaging(stateFilePath);
    await fs.writeFile(tmpPath, JSON.stringify(all), 'utf-8');
    // Windows: rename-over-existing transiently fails with EPERM/EACCES/EBUSY
    // when an AV scanner or the indexer briefly holds either file. The state
    // is saved after EVERY part, so a single transient failure would abort a
    // multi-GB upload cycle — retry with short backoff, then fall back to a
    // direct (non-atomic) write: readAll() already tolerates a torn file by
    // returning {} (worst case the upload restarts from scratch).
    const delays = [10, 50, 250, 1000];
    for (let attempt = 0; ; attempt++) {
      try {
        await fs.rename(tmpPath, stateFilePath);
        return;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        const transient = code === 'EPERM' || code === 'EACCES' || code === 'EBUSY';
        if (!transient || attempt >= delays.length) {
          await fs.writeFile(stateFilePath, JSON.stringify(all), 'utf-8');
          await fs.unlink(tmpPath).catch(() => undefined);
          return;
        }
        await sleep(delays[attempt]);
      }
    }
  }

  return {
    async load(fileId: string): Promise<MultipartResumeState | null> {
      const all = await readAll();
      const state = all[fileId];
      if (
        !state ||
        typeof state.token !== 'string' ||
        typeof state.uploadId !== 'string' ||
        typeof state.key !== 'string' ||
        !Number.isSafeInteger(state.partSize) ||
        !Number.isSafeInteger(state.totalBytes) ||
        typeof state.fileChecksum !== 'string' ||
        !Array.isArray(state.completedParts)
      ) {
        return null;
      }
      return state;
    },
    async save(fileId: string, state: MultipartResumeState): Promise<void> {
      const all = await readAll();
      all[fileId] = state;
      await writeAll(all);
    },
    async clear(fileId: string): Promise<void> {
      const all = await readAll();
      if (fileId in all) {
        delete all[fileId];
        await writeAll(all);
      }
    },
  };
}

// ── Upload ──────────────────────────────────────────────────────────────────

async function readExactAt(
  handle: fs.FileHandle,
  buffer: Buffer,
  length: number,
  position: number
): Promise<void> {
  let done = 0;
  while (done < length) {
    const { bytesRead } = await handle.read(buffer, done, length - done, position + done);
    if (bytesRead <= 0) {
      throw new Error(ERR_PART_READ);
    }
    done += bytesRead;
  }
}

/**
 * Uploads an already-encrypted blob via the multipart routes with flat
 * memory (one reused part-sized buffer), per-part retry and crash resume.
 *
 * Resume contract: after every successful part the state (token, uploadId,
 * completedParts) is persisted through `store`. A later call with the same
 * fileId and an unchanged file (same size + checksum) resumes at the first
 * missing part. A stale state (file changed) is aborted server-side and
 * discarded. If the SERVER no longer recognizes the session
 * (MultipartSessionInvalidError), the upload aborts the stale session and
 * restarts from scratch exactly once.
 *
 * On transient failure (network, 5xx after retries) the state is KEPT so the
 * next sync cycle resumes instead of re-uploading everything. On quota
 * rejection the session is aborted and the state cleared (resuming cannot
 * succeed until the user frees space — a fresh attempt re-checks quota).
 */
export async function uploadFileMultipart(
  transport: MultipartTransport,
  store: ResumeStateStore,
  params: UploadFileParams,
  opts?: TransferOptions
): Promise<{ key: string; size: number }> {
  return runUpload(transport, store, params, opts ?? {}, true);
}

async function runUpload(
  transport: MultipartTransport,
  store: ResumeStateStore,
  params: UploadFileParams,
  opts: TransferOptions,
  allowRestart: boolean
): Promise<{ key: string; size: number }> {
  const partSize = opts.partSize ?? PART_SIZE;
  const maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const baseDelayMs = opts.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS;
  const { profileId, fileId, filePath, totalBytes, fileChecksum } = params;
  const numParts = Math.max(1, Math.ceil(totalBytes / partSize));

  // 1. Try to resume; discard (and abort server-side) a stale or
  //    structurally incoherent (poisoned/corrupted) session.
  let state = await store.load(fileId);
  if (
    state &&
    (state.totalBytes !== totalBytes ||
      state.fileChecksum !== fileChecksum ||
      state.partSize !== partSize ||
      // A resume state from the DIRECT lifecycle carries an S3 uploadId this
      // proxied path can't drive — abort + restart proxied from scratch.
      (state.mode ?? 'proxied') !== 'proxied' ||
      !isResumeStateCoherent(state))
  ) {
    await transport.abort(state.token).catch(() => undefined);
    await store.clear(fileId);
    state = null;
  }

  // 2. Fresh session when there is nothing to resume.
  if (!state) {
    const created = await withRetry(
      () => transport.create(profileId, fileId, totalBytes),
      maxAttempts,
      baseDelayMs
    );
    state = {
      token: created.token,
      uploadId: created.uploadId,
      key: created.key,
      partSize,
      totalBytes,
      fileChecksum,
      mode: 'proxied',
      completedParts: [],
    };
    await store.save(fileId, state);
  }

  const activeToken = state.token;
  try {
    const completedNumbers = new Set(state.completedParts.map((p) => p.partNumber));
    let uploadedBytes = 0;
    for (const part of state.completedParts) {
      const start = (part.partNumber - 1) * partSize;
      uploadedBytes += Math.min(partSize, totalBytes - start);
    }

    // 3. Sequential parts with one reused buffer — flat memory.
    const handle = await fs.open(filePath, 'r');
    try {
      const reuseBuffer = Buffer.allocUnsafe(Math.min(partSize, Math.max(1, totalBytes)));
      for (let partNumber = 1; partNumber <= numParts; partNumber++) {
        if (completedNumbers.has(partNumber)) {
          continue;
        }
        const start = (partNumber - 1) * partSize;
        const length = Math.min(partSize, totalBytes - start);
        await readExactAt(handle, reuseBuffer, length, start);
        const body = reuseBuffer.subarray(0, length);
        const uploaded = await withRetry(
          () => transport.uploadPart(activeToken, partNumber, body),
          maxAttempts,
          baseDelayMs
        );
        state.completedParts.push(uploaded);
        await store.save(fileId, state);
        uploadedBytes += length;
        opts.onProgress?.(uploadedBytes, totalBytes);
      }
    } finally {
      await handle.close().catch(() => undefined);
    }

    // 4. Complete with the parts in order.
    const parts = [...state.completedParts].sort((a, b) => a.partNumber - b.partNumber);
    const result = await withRetry(() => transport.complete(activeToken, parts), maxAttempts, baseDelayMs);
    await store.clear(fileId);
    return result;
  } catch (error) {
    if (error instanceof MultipartSessionInvalidError && allowRestart) {
      // The server forgot this session (expired KV token, foreign uploadId):
      // clean up and start over ONCE with a fresh session.
      await transport.abort(activeToken).catch(() => undefined);
      await store.clear(fileId);
      return runUpload(transport, store, params, opts, false);
    }
    if (isQuotaError(error)) {
      // Retrying a quota rejection cannot succeed — free the server-side
      // session and drop the resume state.
      await transport.abort(activeToken).catch(() => undefined);
      await store.clear(fileId);
    }
    // Transient failure: state stays on disk, the next cycle resumes.
    throw error;
  }
}

// ── Parallel upload (direct-to-R2 path) ─────────────────────────────────────

/**
 * Uploads an already-encrypted on-disk blob with BOUNDED PARALLELISM and crash
 * resume, for the direct-to-R2 transport (each `transport.uploadPart` presigns
 * fresh and PUTs the part straight to R2, so a presign that expired mid-upload
 * is simply re-signed on the withRetry attempt — no session restart).
 *
 * Memory is bounded to `concurrency * partSize`: each worker owns ONE
 * part-sized buffer and reads its slice from disk on demand (positioned reads
 * on a shared handle — pread semantics, safe for concurrency). completedParts
 * mutation + resume persistence are serialized through a mutex so parallel
 * completions never tear the atomically-written state file; progress bytes
 * accumulate monotonically even under out-of-order completion.
 *
 * Same resume/abort contract as the sequential path: a stale/foreign/direct-vs-
 * proxied-mismatched state is aborted + restarted; MultipartSessionInvalidError
 * aborts + restarts once; quota aborts + clears; a transient failure keeps the
 * state on disk for the next cycle.
 */
export async function uploadFileMultipartParallel(
  transport: MultipartTransport,
  store: ResumeStateStore,
  params: UploadFileParams,
  opts?: ParallelTransferOptions
): Promise<{ key: string; size: number }> {
  return runUploadParallel(transport, store, params, opts ?? {}, true);
}

async function runUploadParallel(
  transport: MultipartTransport,
  store: ResumeStateStore,
  params: UploadFileParams,
  opts: ParallelTransferOptions,
  allowRestart: boolean
): Promise<{ key: string; size: number }> {
  const { profileId, fileId, filePath, totalBytes, fileChecksum } = params;
  const partSize = opts.partSize ?? computePartSize(totalBytes);
  const maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const baseDelayMs = opts.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS;
  const numParts = Math.max(1, Math.ceil(totalBytes / partSize));
  const concurrency = clampConcurrency(
    opts.concurrency ?? DEFAULT_UPLOAD_CONCURRENCY,
    partSize,
    numParts,
    opts.maxInflightBytes ?? MAX_INFLIGHT_BYTES
  );

  // 1. Resume only a coherent, same-file, same-partSize, DIRECT session.
  let state = await store.load(fileId);
  if (
    state &&
    (state.totalBytes !== totalBytes ||
      state.fileChecksum !== fileChecksum ||
      state.partSize !== partSize ||
      (state.mode ?? 'proxied') !== 'direct' ||
      !isResumeStateCoherent(state))
  ) {
    await transport.abort(state.token).catch(() => undefined);
    await store.clear(fileId);
    state = null;
  }

  // 2. Fresh session (forward the chosen partSize so presigns match).
  if (!state) {
    const created = await withRetry(
      () => transport.create(profileId, fileId, totalBytes, partSize),
      maxAttempts,
      baseDelayMs
    );
    state = {
      token: created.token,
      uploadId: created.uploadId,
      key: created.key,
      partSize,
      totalBytes,
      fileChecksum,
      mode: 'direct',
      completedParts: [],
    };
    await store.save(fileId, state);
  }

  const activeState = state;
  const activeToken = activeState.token;
  try {
    const completedNumbers = new Set(activeState.completedParts.map((p) => p.partNumber));
    let uploadedBytes = 0;
    for (const part of activeState.completedParts) {
      const start = (part.partNumber - 1) * partSize;
      uploadedBytes += Math.min(partSize, totalBytes - start);
    }

    const handle = await fs.open(filePath, 'r');
    const saveMutex = createMutex();
    let nextPartNumber = 1;
    let firstError: unknown = null;

    const worker = async (): Promise<void> => {
      // One part-sized buffer per worker — the ONLY resident copy of a part.
      const buffer = Buffer.allocUnsafe(Math.min(partSize, Math.max(1, totalBytes)));
      for (;;) {
        if (firstError) return;
        // Claim the next part index atomically (no await between read+bump).
        const partNumber = nextPartNumber++;
        if (partNumber > numParts) return;
        if (completedNumbers.has(partNumber)) continue;

        const start = (partNumber - 1) * partSize;
        const length = Math.min(partSize, totalBytes - start);
        try {
          await readExactAt(handle, buffer, length, start);
          const body = buffer.subarray(0, length);
          const uploaded = await withRetry(
            () => transport.uploadPart(activeToken, partNumber, body),
            maxAttempts,
            baseDelayMs
          );
          // Serialize the durable-progress write: push the etag and persist the
          // full in-memory state before any worker can crash the process.
          await saveMutex(async () => {
            activeState.completedParts.push(uploaded);
            uploadedBytes += length;
            await store.save(fileId, activeState);
          });
          opts.onProgress?.(uploadedBytes, totalBytes);
        } catch (err) {
          if (!firstError) firstError = err;
          return;
        }
      }
    };

    try {
      await Promise.all(Array.from({ length: concurrency }, () => worker()));
    } finally {
      await handle.close().catch(() => undefined);
    }
    if (firstError) throw firstError;

    const parts = [...activeState.completedParts].sort((a, b) => a.partNumber - b.partNumber);
    const result = await withRetry(() => transport.complete(activeToken, parts), maxAttempts, baseDelayMs);
    await store.clear(fileId);
    return result;
  } catch (error) {
    if (error instanceof MultipartSessionInvalidError && allowRestart) {
      await transport.abort(activeToken).catch(() => undefined);
      await store.clear(fileId);
      return runUploadParallel(transport, store, params, opts, false);
    }
    if (isQuotaError(error)) {
      await transport.abort(activeToken).catch(() => undefined);
      await store.clear(fileId);
    }
    throw error;
  }
}

// ── Ranged download ─────────────────────────────────────────────────────────

export interface RangeChunk {
  data: Buffer;
  /**
   * True when the server ignored the Range header and returned the FULL
   * object (plain 200) — legal per RFC 9110 and what pre-Range Workers do.
   * Only meaningful on the first read (offset 0).
   */
  complete: boolean;
}

/** HTTP layer for ranged blob reads (injected for testability). */
export interface RangeSource {
  read(offset: number, length: number): Promise<RangeChunk>;
}

/**
 * Downloads a blob of known size in fixed-size ranges into `destPath`
 * (callers pass a temp path and rename after), hashing as it goes — the
 * whole blob never sits in RAM. Each range read is retried with backoff.
 * Returns the streaming sha256 (hex) of the written bytes.
 */
export async function downloadToFileRanged(
  source: RangeSource,
  totalSize: number,
  destPath: string,
  opts?: TransferOptions & { chunkSize?: number }
): Promise<{ checksum: string; size: number }> {
  const chunkSize = opts?.chunkSize ?? DOWNLOAD_CHUNK_SIZE;
  const maxAttempts = opts?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const baseDelayMs = opts?.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS;

  const hash = crypto.createHash('sha256');
  const handle = await fs.open(destPath, 'w');
  try {
    let offset = 0;
    while (offset < totalSize) {
      const length = Math.min(chunkSize, totalSize - offset);
      const chunk = await withRetry(() => source.read(offset, length), maxAttempts, baseDelayMs);
      if (chunk.complete) {
        // Full-body fallback (server without Range support): only coherent
        // as the very first response, and it must carry the whole object.
        if (offset !== 0 || chunk.data.length !== totalSize) {
          throw new Error(ERR_RANGE_FULL_MIDSTREAM);
        }
        await handle.write(chunk.data, 0, chunk.data.length, 0);
        hash.update(chunk.data);
        offset = totalSize;
        break;
      }
      if (chunk.data.length !== length) {
        throw new Error(ERR_RANGE_SHORT);
      }
      await handle.write(chunk.data, 0, chunk.data.length, offset);
      hash.update(chunk.data);
      offset += length;
      opts?.onProgress?.(offset, totalSize);
    }
    await handle.sync().catch(() => undefined);
  } finally {
    await handle.close().catch(() => undefined);
  }
  return { checksum: hash.digest('hex'), size: totalSize };
}

/**
 * Parallel ranged download into `destPath` with bounded concurrency. Each
 * worker reads a range and writes it at its correct offset (positioned pwrite —
 * safe for concurrency); because ranges complete out of order the sha256 cannot
 * be computed in stream, so it is taken in a single flat-memory pass over the
 * finished file at the end.
 *
 * Peak memory is bounded to `concurrency * chunkSize`. A server that ignores
 * Range (returns a plain 200 full body) is tolerated ONLY on the initial probe
 * at offset 0 — a full body mid-stream (offset > 0) is incoherent and rejected.
 */
export async function downloadToFileParallel(
  source: RangeSource,
  totalSize: number,
  destPath: string,
  opts?: ParallelTransferOptions & { chunkSize?: number }
): Promise<{ checksum: string; size: number }> {
  const chunkSize = opts?.chunkSize ?? DOWNLOAD_CHUNK_SIZE;
  const maxAttempts = opts?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const baseDelayMs = opts?.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS;
  const numChunks = Math.max(1, Math.ceil(Math.max(1, totalSize) / chunkSize));
  const concurrency = clampConcurrency(
    opts?.concurrency ?? DEFAULT_DOWNLOAD_CONCURRENCY,
    chunkSize,
    numChunks,
    opts?.maxInflightBytes ?? MAX_INFLIGHT_BYTES
  );

  const handle = await fs.open(destPath, 'w');
  let writtenBytes = 0;
  try {
    if (totalSize > 0) {
      // Probe the first range: distinguishes a Range-honoring server (206,
      // partial) from one that returns the whole object (200) in one shot.
      const firstLen = Math.min(chunkSize, totalSize);
      const first = await withRetry(() => source.read(0, firstLen), maxAttempts, baseDelayMs);
      if (first.complete) {
        if (first.data.length !== totalSize) {
          throw new Error(ERR_RANGE_FULL_MIDSTREAM);
        }
        await handle.write(first.data, 0, first.data.length, 0);
        writtenBytes = totalSize;
        opts?.onProgress?.(writtenBytes, totalSize);
      } else {
        if (first.data.length !== firstLen) {
          throw new Error(ERR_RANGE_SHORT);
        }
        await handle.write(first.data, 0, first.data.length, 0);
        writtenBytes = firstLen;
        opts?.onProgress?.(writtenBytes, totalSize);

        let nextOffset = firstLen;
        let firstError: unknown = null;
        const worker = async (): Promise<void> => {
          for (;;) {
            if (firstError) return;
            // Claim the next offset atomically (no await between read+bump).
            const offset = nextOffset;
            if (offset >= totalSize) return;
            const length = Math.min(chunkSize, totalSize - offset);
            nextOffset += length;
            try {
              const chunk = await withRetry(() => source.read(offset, length), maxAttempts, baseDelayMs);
              if (chunk.complete) {
                throw new Error(ERR_RANGE_FULL_MIDSTREAM);
              }
              if (chunk.data.length !== length) {
                throw new Error(ERR_RANGE_SHORT);
              }
              await handle.write(chunk.data, 0, chunk.data.length, offset);
              writtenBytes += length; // += is atomic in single-threaded JS
              opts?.onProgress?.(writtenBytes, totalSize);
            } catch (err) {
              if (!firstError) firstError = err;
              return;
            }
          }
        };
        await Promise.all(Array.from({ length: concurrency }, () => worker()));
        if (firstError) throw firstError;
      }
    }
    await handle.sync().catch(() => undefined);
  } finally {
    await handle.close().catch(() => undefined);
  }

  // Out-of-order writes preclude an in-stream hash — take it now, flat memory.
  const checksum = await streamingSha256(destPath);
  return { checksum, size: totalSize };
}
