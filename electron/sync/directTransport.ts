/**
 * Direct-to-R2 multipart transport (pure Node — no Electron imports).
 *
 * The Worker never sees file bytes on this path: it runs only the S3 control
 * plane (CreateMultipartUpload / presign UploadPart / CompleteMultipartUpload /
 * AbortMultipartUpload) and the DESKTOP client PUTs each part straight to R2.
 * This module turns injected control-plane + fetch dependencies into the
 * `MultipartTransport` the resumable engine (multipartTransfer.ts) drives, so
 * the whole flow is unit-testable against in-memory fakes with zero Electron.
 *
 * Contract with the Worker (Bearer-authenticated control routes):
 *   POST /sync/multipart-direct/create   → { token, uploadId, key, partSize }
 *   POST /sync/multipart-direct/sign      → { url }                (per part)
 *   POST /sync/multipart-direct/complete  → { key, size }
 *   POST /sync/multipart-direct/abort     → {}
 *   GET  /sync/capabilities               → { directUpload: boolean }
 * The client PUTs each part to the presigned `url`, reads the ETag from the R2
 * response header, and sends the {partNumber, etag} list to complete.
 *
 * NEVER handles secrets: presigned URLs arrive from the Worker; the client only
 * PUTs/GETs them.
 */

import {
  MultipartSessionInvalidError,
  computePartSize,
  type MultipartTransport,
  type MultipartCreateResult,
  type UploadedPart,
} from './multipartTransfer';

// ── Errors ──────────────────────────────────────────────────────────────────

/**
 * The direct-to-R2 plane is not usable (secrets absent server-side, routes not
 * deployed, or a capability/config mismatch). Signals the caller to FALL BACK
 * to the proxied multipart path rather than retry — it is not transient.
 */
export class DirectUploadUnavailableError extends Error {
  constructor(message = 'Televersement direct indisponible') {
    super(message);
    this.name = 'DirectUploadUnavailableError';
  }
}

/**
 * BYOS : le data plane Filarr (proxy R2) est INTERDIT. Ne pas traduire
 * ceci en DirectUploadUnavailableError — le caller tomberait sur filarr-sync.
 */
export class ByosSyncError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = 'ByosSyncError';
    this.code = code;
  }
}

const BYOS_ERROR_CODES = new Set([
  'upgrade_required',
  'subscription_inactive',
  'byos_direct_required',
  'byos_delta_unsupported',
]);

// ── Injected dependencies ─────────────────────────────────────────────────────

/** S3 control-plane calls (Worker routes) — injected so tests can fake them. */
export interface DirectControlPlane {
  createDirect(
    profileId: string,
    fileId: string,
    expectedTotalBytes: number,
    partSize: number
  ): Promise<MultipartCreateResult>;
  /** Presign an UploadPart URL bound to the exact key+uploadId+partNumber+length. */
  signPart(token: string, partNumber: number, contentLength: number): Promise<{ url: string }>;
  completeDirect(token: string, parts: UploadedPart[]): Promise<{ key: string; size: number }>;
  abortDirect(token: string): Promise<void>;
}

/** Minimal response shape (a WHATWG `Response` is structurally assignable). */
export interface DirectFetchResponse {
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/** Direct HTTP to R2 (Node fetch from the main process — no CORS, no Bearer). */
export type DirectFetch = (
  url: string,
  init: { method: string; body?: Buffer; headers?: Record<string, string> }
) => Promise<DirectFetchResponse>;

// ── ETag handling ─────────────────────────────────────────────────────────────

/**
 * R2/S3 return the per-part ETag as a QUOTED string header (e.g. `"<md5hex>"`),
 * sometimes weak (`W/"..."`). CompleteMultipartUpload expects the value R2
 * returned; the engine re-quotes it in the XML, so we strip the surrounding
 * quotes (and any weak prefix) to a bare token here.
 */
export function stripEtagQuotes(raw: string): string {
  let t = raw.trim();
  if (t.startsWith('W/') || t.startsWith('w/')) t = t.slice(2).trim();
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) t = t.slice(1, -1);
  return t;
}

// ── Error mapping ─────────────────────────────────────────────────────────────

/**
 * Map a control-plane error envelope to a typed error:
 *  - route missing / not configured / capability off → DirectUploadUnavailable
 *    (caller falls back to proxied);
 *  - expired/forbidden token → MultipartSessionInvalid (engine restarts once);
 *  - otherwise a plain Error (transient text like "HTTP 5xx" is preserved so
 *    the transient classifier and quota detector can see it).
 */
export function mapDirectControlError(
  error: string | undefined,
  op: string,
  code?: string
): Error {
  const msg = error || `Direct ${op} a echoue`;
  if (code && BYOS_ERROR_CODES.has(code)) {
    return new ByosSyncError(msg, code);
  }
  if (/byos_direct_required|subscription_inactive|upgrade_required|byos_delta/i.test(msg)) {
    const inferred = /subscription_inactive/i.test(msg)
      ? 'subscription_inactive'
      : /upgrade_required/i.test(msg)
        ? 'upgrade_required'
        : /byos_delta/i.test(msg)
          ? 'byos_delta_unsupported'
          : 'byos_direct_required';
    return new ByosSyncError(msg, inferred);
  }
  if (/HTTP 404|not found|not configured|non configur|unavailable|indisponible|direct.?upload/i.test(msg)) {
    return new DirectUploadUnavailableError(msg);
  }
  if (/invalid or expired|expir|forbidden|interdit|HTTP 403/i.test(msg)) {
    return new MultipartSessionInvalidError(msg);
  }
  return new Error(msg);
}

/** Complete-route error mapping (mirrors the proxied completeMultipartUpload). */
export function mapDirectCompleteError(error: string | undefined, code?: string): Error {
  const msg = error || 'Echec de finalisation du televersement direct';
  if (code && BYOS_ERROR_CODES.has(code)) {
    return new ByosSyncError(msg, code);
  }
  if (/byos_direct_required|subscription_inactive|upgrade_required|byos_delta/i.test(msg)) {
    return new ByosSyncError(msg, code || 'byos_direct_required');
  }
  if (/HTTP 404|not configured|non configur|unavailable|indisponible/i.test(msg)) {
    return new DirectUploadUnavailableError(msg);
  }
  if (
    /invalid or expired|expir|forbidden|interdit|invalid.*part|partie.*invalide|too many parts|HTTP 403/i.test(
      msg
    )
  ) {
    return new MultipartSessionInvalidError(msg);
  }
  // Quota (413/quota text) and other errors flow through unchanged so the
  // engine's isQuotaError / transient classifier can still recognize them.
  return new Error(msg);
}

/**
 * Whether a direct-mode failure is CLEARLY transient (retry the direct path
 * next cycle) versus a reason to fall back to the proxied path. Session-invalid
 * (after the engine's one restart) and direct-unavailable are NOT transient —
 * both fall back. Network/timeout/5xx/429 are transient. Quota is NOT transient.
 */
export function isClearlyTransientError(err: unknown): boolean {
  if (err instanceof DirectUploadUnavailableError) return false;
  if (err instanceof ByosSyncError) return false;
  if (err instanceof MultipartSessionInvalidError) return false;
  if (err instanceof Error && err.name === 'AbortError') return true; // fetch timeout
  const msg = err instanceof Error ? err.message : String(err);
  if (/quota|\b413\b/i.test(msg)) return false;
  return /network|fetch failed|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|EPIPE|socket hang up|HTTP 5\d\d|\b429\b|timeout|temporair|temporarily/i.test(
    msg
  );
}

// ── Transport factory ─────────────────────────────────────────────────────────

/**
 * Build the direct-to-R2 `MultipartTransport`. Presigning happens FRESH inside
 * every `uploadPart` call, so a withRetry re-attempt after a presign expiry
 * (R2 → HTTP 403) naturally re-signs — the S3 session is never restarted for an
 * expired URL. A 404 from R2 means the S3 upload itself is gone → session-fatal.
 */
export function createDirectMultipartTransport(
  cp: DirectControlPlane,
  doFetch: DirectFetch
): MultipartTransport {
  return {
    create: (profileId, fileId, expectedTotalBytes, partSize) =>
      cp.createDirect(profileId, fileId, expectedTotalBytes, partSize ?? computePartSize(expectedTotalBytes)),

    uploadPart: async (token, partNumber, body): Promise<UploadedPart> => {
      const contentLength = body.length;
      // Fresh presign each attempt — this is what makes expiry self-healing.
      const { url } = await cp.signPart(token, partNumber, contentLength);
      const res = await doFetch(url, { method: 'PUT', body });
      if (res.status >= 200 && res.status < 300) {
        const raw = res.headers.get('etag') ?? res.headers.get('ETag');
        if (!raw) {
          throw new Error(`ETag absente de la reponse R2 pour la partie ${partNumber}`);
        }
        return { partNumber, etag: stripEtagQuotes(raw) };
      }
      if (res.status === 403) {
        // Expired/invalid presigned URL (SignatureDoesNotMatch / AccessDenied
        // on expiry). TRANSIENT: withRetry re-invokes → fresh presign → success.
        throw new Error(`R2 PUT partie ${partNumber} refuse (HTTP 403, URL presignee expiree)`);
      }
      if (res.status === 404) {
        // NoSuchUpload — the S3 multipart session no longer exists.
        throw new MultipartSessionInvalidError(
          `Televersement R2 introuvable (partie ${partNumber}, HTTP 404)`
        );
      }
      const detail = await res.text().catch(() => '');
      throw new Error(
        `Echec du televersement direct de la partie ${partNumber}: HTTP ${res.status} ${detail}`.trim()
      );
    },

    complete: (token, parts) => cp.completeDirect(token, parts),
    abort: (token) => cp.abortDirect(token),
  };
}
