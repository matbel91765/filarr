/**
 * Share service — Electron main process
 *
 * v2 flow:
 *   1. createShare(metadata)            → returns shareId
 *   2. uploadShareChunk(shareId, i, enc) × N
 *   3. finalizeShare(shareId)           → flips status to 'ready'
 *   4. renderer builds the user-facing URL with K_share in the fragment
 *
 * The renderer reads the file plaintext locally (via the regular decrypt
 * pipeline), splits + re-encrypts every chunk with K_share, and ships the
 * opaque ciphertext through this main-process bridge. Main forwards to the
 * Worker; the Worker stores under a share-specific R2 prefix.
 *
 * Why through main? The bearer token lives in main's encrypted store, the
 * Worker base URL is configured once here, and 401-refresh is handled by
 * authenticatedApiCall.
 */

import log from 'electron-log';
import {
  API_BASE,
  authenticatedApiCall,
  fetchWithTimeout,
  getAccessToken,
} from './authService';

// ── Types ───────────────────────────────────────────────────────────────────

export interface CreateShareInput {
  profileId: string;
  fileId: string;
  totalChunks: number;
  sizeBytes: number;
  encryptedManifest: string;
  encryptedManifestIv: string;
  expiresInSeconds: number;
  maxViews: number | null;
  passwordSalt: string | null;
  oneDownloadPerIp: boolean;
  /**
   * K_share scellée sur la clé publique de custody du compte (migration 0074).
   * Opaque pour main comme pour le serveur : le renderer la scelle, personne
   * d'autre ne peut l'ouvrir. Null quand le compte n'a pas encore de coffre —
   * le partage se crée quand même, il ne sera simplement pas récupérable
   * depuis un autre appareil.
   */
  wrappedSecret?: string | null;
}

export interface CreateShareResult {
  shareId: string;
  expiresAt: number;
  r2KeyPrefix: string;
  publicPath: string;
}

export interface ShareListItem {
  shareId: string;
  profileId: string;
  fileId: string;
  sizeBytes: number;
  totalChunks: number;
  passwordProtected: boolean;
  expiresAt: number;
  maxViews: number | null;
  /** Downloads — number of times chunk_0 was fetched */
  viewCount: number;
  /** Page visits — number of times the recipient hit /info (loaded the share page) */
  infoViewCount: number;
  /** When true, each /16 subnet can only download once */
  oneDownloadPerIp: boolean;
  revokedAt: number | null;
  createdAt: number;
  status: string;
  active: boolean;
}

const CHUNK_UPLOAD_TIMEOUT = 5 * 60 * 1000; // 5 min per chunk

// ── API ────────────────────────────────────────────────────────────────────

export async function createShare(
  input: CreateShareInput
): Promise<{ success: true; data: CreateShareResult } | { success: false; error: string }> {
  const result = await authenticatedApiCall<CreateShareResult>('/sync/share', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  if (!result.success) {
    log.warn('[shareService] createShare failed:', result.error);
    return { success: false, error: result.error || 'Failed to create share' };
  }
  if (!result.data) {
    return { success: false, error: 'Empty share response' };
  }
  return { success: true, data: result.data };
}

/**
 * Clé PUBLIQUE de custody du compte, ou null si le coffre n'a pas encore été
 * créé. Le renderer en a besoin pour sceller K_share avant d'appeler
 * createShare — c'est ce qui rend un partage app récupérable depuis un autre
 * appareil, comme l'est déjà un Filarr Send.
 *
 * On ne renvoie QUE la partie publique : la clé privée enveloppée n'a rien à
 * faire ici, l'app ne déscelle jamais (c'est le tableau de bord web qui le
 * fait, après saisie de la phrase de récupération).
 */
export async function getCustodyPublicKey(): Promise<
  { success: true; data: string | null } | { success: false; error: string }
> {
  const result = await authenticatedApiCall<{ custodyPublicKey?: string } | null>(
    '/account/custody-key',
    { method: 'GET' }
  );
  if (!result.success) {
    log.warn('[shareService] getCustodyPublicKey failed:', result.error);
    return { success: false, error: result.error || 'Failed to read custody key' };
  }
  return { success: true, data: result.data?.custodyPublicKey ?? null };
}

/**
 * Upload one encrypted chunk for a share. Body is the raw bytes
 * (IV(12) || ciphertext+tag). Owner-only — the Worker checks the bearer
 * matches the share's owner_user_id.
 *
 * We use a direct fetch (not authenticatedApiCall) because:
 *   - the body is binary, not JSON
 *   - we don't want apiCall's "must be JSON" guard rejecting the response
 */
export async function uploadShareChunk(
  shareId: string,
  chunkIndex: number,
  encryptedBlob: Buffer
): Promise<{ success: true } | { success: false; error: string }> {
  const accessToken = await getAccessToken();
  if (!accessToken) {
    return { success: false, error: 'Not authenticated' };
  }

  const url = `${API_BASE}/sync/share/${encodeURIComponent(shareId)}/upload/${chunkIndex}`;
  let response: Response;
  try {
    response = await fetchWithTimeout(
      url,
      {
        method: 'PUT',
        body: encryptedBlob,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/octet-stream',
        },
      },
      CHUNK_UPLOAD_TIMEOUT
    );
  } catch (err) {
    log.warn(`[shareService] uploadShareChunk(${shareId}/${chunkIndex}) network error:`, err);
    return { success: false, error: err instanceof Error ? err.message : 'Network error' };
  }

  if (!response.ok) {
    let errText = `HTTP ${response.status}`;
    try {
      // Try parse JSON error, fall back to status code if the body is empty
      // or non-JSON (e.g. a Cloudflare challenge page).
      const json = await response.json() as { error?: string };
      if (json?.error) errText = json.error;
    } catch {
      /* ignore */
    }
    log.warn(`[shareService] uploadShareChunk(${shareId}/${chunkIndex}) failed: ${errText}`);
    return { success: false, error: errText };
  }

  return { success: true };
}

export async function finalizeShare(
  shareId: string
): Promise<{ success: true; status: string } | { success: false; error: string; missing?: number[] }> {
  const result = await authenticatedApiCall<{ status: string; missing?: number[] }>(
    `/sync/share/${encodeURIComponent(shareId)}/finalize`,
    { method: 'POST' }
  );
  if (!result.success) {
    return {
      success: false,
      error: result.error || 'Failed to finalize share',
      missing: result.data?.missing,
    };
  }
  return { success: true, status: result.data?.status ?? 'ready' };
}

export async function listShares(): Promise<
  { success: true; data: ShareListItem[] } | { success: false; error: string }
> {
  const result = await authenticatedApiCall<{ shares: ShareListItem[] }>(
    '/sync/share',
    { method: 'GET' }
  );
  if (!result.success) {
    return { success: false, error: result.error || 'Failed to list shares' };
  }
  return { success: true, data: result.data?.shares ?? [] };
}

export async function revokeShare(
  shareId: string
): Promise<{ success: true; revoked: boolean } | { success: false; error: string }> {
  const result = await authenticatedApiCall<{ revoked: boolean }>(
    `/sync/share/${encodeURIComponent(shareId)}`,
    { method: 'DELETE' }
  );
  if (!result.success) {
    return { success: false, error: result.error || 'Failed to revoke share' };
  }
  return { success: true, revoked: result.data?.revoked ?? false };
}

// ── Audit log ──────────────────────────────────────────────────────────────

export interface ShareView {
  viewedAt: number;
  country: string | null;
  ipSubnet: string | null;
}

export async function listShareViews(
  shareId: string
): Promise<{ success: true; data: ShareView[] } | { success: false; error: string }> {
  const result = await authenticatedApiCall<{ views: ShareView[] }>(
    `/sync/share/${encodeURIComponent(shareId)}/views`,
    { method: 'GET' }
  );
  if (!result.success) {
    return { success: false, error: result.error || 'Failed to fetch share views' };
  }
  return { success: true, data: result.data?.views ?? [] };
}
