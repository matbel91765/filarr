/**
 * Share service — renderer
 *
 * Orchestrates the full share-creation pipeline:
 *   1. Read the file plaintext from disk via the existing decrypt path
 *      (handles both HybridCrypto and StorageService formats transparently)
 *   2. Setup share crypto (generate K_share, encrypt manifest)
 *   3. Create the share row on the server
 *   4. For each chunk: encrypt with K_share, upload via IPC
 *   5. Finalize the share (flips status to 'ready')
 *   6. Compose the public URL with K_share in the fragment
 *
 * Designed so an interrupted upload leaves a 'pending' share row on the
 * server. The next sync's GC sweep cleans up rows older than 24 h.
 */

import { readFile } from '../core/fileService';
import {
  setupShareCrypto,
  encryptShareChunk,
  buildShareUrl,
  SHARE_CHUNK_SIZE,
  SHARE_CHUNK_BINDING_V2,
  type ShareManifestPlain,
} from './shareCrypto';

const PUBLIC_BASE_URL = 'https://filarr.com';

// ── K_share local recovery store ───────────────────────────────────────────
//
// The share URL is unique to each share and contains K_share in its
// fragment. We never send K_share to the server, so if the owner closes
// the modal without copying the URL the link is unrecoverable. To avoid
// that footgun we cache `{ shareId: kShareBase64Url }` in localStorage
// after a successful create — the SharesManagementPanel re-composes the
// URL from this map on demand.
//
// Security: this localStorage entry is plaintext. The user's machine
// already holds the FEK + the file plaintext, so storing K_share in the
// same trust boundary is fine — losing the device leaks everything
// regardless. We do NOT sync this map across devices (would defeat the
// "key never leaves origin device" property).

const LOCAL_SHARES_KEY = 'filarr-shares-keys-v1';

interface LocalShareEntry {
  k: string; // base64url(K_share)
  createdAt: number;
}

function loadLocalShareKeys(): Record<string, LocalShareEntry> {
  try {
    const raw = window.localStorage.getItem(LOCAL_SHARES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function saveLocalShareKey(shareId: string, kShareBase64Url: string): void {
  try {
    const map = loadLocalShareKeys();
    map[shareId] = { k: kShareBase64Url, createdAt: Date.now() };
    window.localStorage.setItem(LOCAL_SHARES_KEY, JSON.stringify(map));
  } catch {
    // Quota / SecurityError on private modes — non-fatal, the user just
    // can't recover the URL later from the manage-shares panel.
  }
}

export function removeLocalShareKey(shareId: string): void {
  try {
    const map = loadLocalShareKeys();
    if (shareId in map) {
      delete map[shareId];
      window.localStorage.setItem(LOCAL_SHARES_KEY, JSON.stringify(map));
    }
  } catch {
    /* non-fatal */
  }
}

/**
 * Look up the K_share for a given shareId from local cache. Returns null
 * if the share was created on a different device, or the cache was
 * cleared, or the share is old enough that we expired it.
 */
export function getLocalShareUrl(shareId: string): string | null {
  const map = loadLocalShareKeys();
  const entry = map[shareId];
  if (!entry) return null;
  return buildShareUrl(PUBLIC_BASE_URL, shareId, entry.k);
}

/**
 * Purger les clés K_share des liens que le serveur déclare EXPLICITEMENT morts.
 *
 * L'ancienne règle — « supprime toute clé ABSENTE de la liste » — détruisait des
 * données : le listing serveur ne montrait que sept jours, si bien qu'ouvrir
 * « Mes partages » au huitième jour effaçait la clé d'un lien encore actif.
 * Sous E2EE, cette clé n'existe nulle part ailleurs : l'URL était perdue pour
 * toujours, alors que le lien, lui, restait ouvert.
 *
 * La règle devient : on ne purge que sur PREUVE — un identifiant présent dans la
 * réponse du serveur ET déclaré inactif (révoqué, expiré, vues épuisées).
 * L'absence n'est jamais une preuve : elle peut venir d'une liste partielle,
 * d'une erreur, d'un vieux serveur. Une clé orpheline qui traîne coûte quelques
 * octets de localStorage ; une clé détruite à tort coûte le lien.
 */
export function pruneDeadShareKeys(deadShareIds: Set<string>): void {
  try {
    const map = loadLocalShareKeys();
    let changed = false;
    for (const id of Object.keys(map)) {
      if (deadShareIds.has(id)) {
        delete map[id];
        changed = true;
      }
    }
    if (changed) {
      window.localStorage.setItem(LOCAL_SHARES_KEY, JSON.stringify(map));
    }
  } catch {
    /* non-fatal */
  }
}

// ── Types ──────────────────────────────────────────────────────────────────

export interface CreateShareOptions {
  /** Folder ID this file lives in (used to read it from local disk). */
  folderId: string;
  /** File name on disk. */
  fileName: string;
  /** MIME type for the encrypted manifest. */
  mimeType: string;
  expiresInSeconds: number;
  maxViews: number | null;
  password: string | null;
  /** When true, the same /16 subnet can only download this share once. */
  oneDownloadPerIp: boolean;
  /** Reported back to the caller during upload so the UI can show progress. */
  onProgress?: (bytesUploaded: number, totalBytes: number) => void;
}

export interface CreatedShare {
  shareId: string;
  publicUrl: string;
  expiresAt: number;
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
  /** Page visits — number of times the recipient hit /info */
  infoViewCount: number;
  /** When true, each /16 subnet can only download once */
  oneDownloadPerIp: boolean;
  revokedAt: number | null;
  createdAt: number;
  status: string;
  active: boolean;
}

// ── Public API ─────────────────────────────────────────────────────────────

export async function createShare(opts: CreateShareOptions): Promise<CreatedShare> {
  if (!window.electron?.ipcRenderer) {
    throw new Error('Share requires Electron IPC');
  }

  // Step 1 — read the plaintext from local disk. readFile uses the right
  // decrypt pipeline (HybridStorage / StorageService / cloud) based on
  // the current app config, so we don't care here whether the bytes on
  // disk are FEK-encrypted or legacy v2:-prefixed.
  const plaintext = await readFile(opts.folderId, opts.fileName, true);
  const opaqueFileId = await deriveOpaqueFileId(opts.folderId, opts.fileName);
  return createShareFromBytes(plaintext, { ...opts, fileId: opaqueFileId });
}

export interface CreateShareFromBytesOptions extends Omit<CreateShareOptions, 'folderId'> {
  /** Identifiant opaque rangé côté serveur (comptabilité du propriétaire). */
  fileId: string;
}

/**
 * Créer un lien à partir d'OCTETS EN MÉMOIRE — la moitié du partage qui ne
 * présume pas d'où vient le fichier.
 *
 * CE QUE CETTE EXTRACTION DÉBLOQUE : le partage d'un élément de COFFRE. Le
 * membre détient K_item, donc les octets ; le Worker ingère des chunks opaques
 * sans se soucier de leur provenance ; seul le client savait exiger un chemin
 * disque. Le lien produit est un INSTANTANÉ re-chiffré sous une K_share
 * fraîche : les éditions ultérieures du coffre ne s'y propagent pas — c'est à
 * l'interface de le dire, et c'est aussi ce qui rend le lien révocable sans
 * toucher au coffre.
 */
export async function createShareFromBytes(
  plaintext: Uint8Array,
  opts: CreateShareFromBytesOptions
): Promise<CreatedShare> {
  if (!window.electron?.ipcRenderer) {
    throw new Error('Share requires Electron IPC');
  }
  const totalBytes = plaintext.byteLength;
  if (totalBytes <= 0) {
    throw new Error('File is empty');
  }
  const totalChunks = Math.max(1, Math.ceil(totalBytes / SHARE_CHUNK_SIZE));

  // Step 2 — generate K_share + encrypt the manifest. The manifest carries
  // the filename + mimetype the recipient displays before download.
  const manifest: ShareManifestPlain = {
    fileName: opts.fileName,
    mimeType: opts.mimeType,
    size: totalBytes,
    totalChunks,
    // Format v2 : fragments liés à (shareId, index, total) — voir shareCrypto.
    chunkBinding: SHARE_CHUNK_BINDING_V2,
  };
  const setup = await setupShareCrypto(manifest, opts.password);
  const opaqueFileId = opts.fileId;

  // Sceller K_share sur le coffre du compte AVANT de créer la ligne.
  //
  // Sans ça, K_share n'existe que dans le localStorage de cet appareil : un
  // lien encore vivant devenait irrécupérable pour son auteur dès qu'il
  // changeait de machine, et le tableau de bord web ne pouvait ni afficher son
  // nom ni reconstituer son URL. Le blob est opaque pour le serveur ; seule la
  // phrase de récupération l'ouvre.
  //
  // Meilleur effort ASSUMÉ : pas de coffre configuré, ou l'API ne répond pas,
  // et on crée quand même le partage sans scellement — refuser l'envoi
  // punirait l'utilisateur pour une commodité de récupération. La ligne sera
  // simplement listée sans nom ni lien copiable sur le web, exactement comme
  // les partages créés avant cet incrément.
  let wrappedSecret: string | null = null;
  try {
    const custody = await window.electron.ipcRenderer.invoke('share:custodyKey');
    if (custody?.success && custody.data) {
      const { sealKShareToCustodyKey } = await import('./custodySeal');
      wrappedSecret = await sealKShareToCustodyKey(setup.kShareBase64Url, custody.data);
    }
  } catch {
    /* récupération cross-appareil indisponible — le partage reste valide */
  }

  // Step 3 — create the share row server-side. Returns shareId; status is
  // 'pending' until we finalize.
  const created = await window.electron.ipcRenderer.invoke('share:create', {
    profileId: window.localStorage.getItem('filarr-active-profile') || 'default',
    fileId: opaqueFileId,
    totalChunks,
    sizeBytes: totalBytes,
    encryptedManifest: setup.encryptedManifest,
    encryptedManifestIv: setup.encryptedManifestIv,
    expiresInSeconds: opts.expiresInSeconds,
    maxViews: opts.maxViews,
    passwordSalt: setup.passwordSalt,
    oneDownloadPerIp: opts.oneDownloadPerIp,
    wrappedSecret,
  });
  if (!created?.success) {
    throw new Error(created?.error || 'Failed to create share');
  }
  const { shareId, expiresAt } = created.data;

  // Step 4 — upload each chunk. Each one is read from the plaintext buffer,
  // encrypted with K_actual, and shipped to the Worker via IPC. We do this
  // sequentially rather than parallel-with-backoff because Cloudflare D1
  // doesn't love concurrent writes to the same row and we want clear
  // progress for the UI.
  //
  // If any chunk upload fails we don't bother revoking the share — the
  // server-side GC cleans up 'pending' shares older than 24 h. We just
  // surface the error.
  let bytesUploaded = 0;
  for (let i = 0; i < totalChunks; i++) {
    const start = i * SHARE_CHUNK_SIZE;
    const end = Math.min(start + SHARE_CHUNK_SIZE, totalBytes);
    const plainChunk = new Uint8Array(plaintext.buffer, plaintext.byteOffset + start, end - start);
    // Le shareId n'existe qu'après share:create, mais les fragments ne sont
    // chiffrés qu'ici : le binding v2 est donc toujours disponible.
    const encrypted = await encryptShareChunk(plainChunk, setup.kActualKey, {
      shareId,
      chunkIndex: i,
      totalChunks,
    });

    const uploadResult = await window.electron.ipcRenderer.invoke(
      'share:uploadChunk',
      shareId,
      i,
      encrypted
    );
    if (!uploadResult?.success) {
      throw new Error(uploadResult?.error || `Failed to upload chunk ${i}`);
    }

    bytesUploaded = end;
    opts.onProgress?.(bytesUploaded, totalBytes);
  }

  // Step 5 — finalize. The server verifies every chunk_{0..N-1}.enc is on
  // R2 before flipping status to 'ready'. If anything's missing we get a
  // 409 here with the indices we need to retry.
  const finalized = await window.electron.ipcRenderer.invoke('share:finalize', shareId);
  if (!finalized?.success) {
    throw new Error(finalized?.error || 'Failed to finalize share');
  }

  // Step 6 — compose the URL. K_share lives in the fragment so the server
  // never sees it; this is the ONLY moment K_share meets shareId.
  const publicUrl = buildShareUrl(PUBLIC_BASE_URL, shareId, setup.kShareBase64Url);

  // Step 7 — cache K_share locally so the owner can re-display the URL
  // later from the manage-shares panel. Without this, closing the modal
  // before copying = URL is lost forever (K_share is single-source).
  saveLocalShareKey(shareId, setup.kShareBase64Url);

  return { shareId, publicUrl, expiresAt };
}

export async function listShares(): Promise<ShareListItem[]> {
  if (!window.electron?.ipcRenderer) return [];
  const result = await window.electron.ipcRenderer.invoke('share:list');
  if (!result?.success) {
    throw new Error(result?.error || 'Failed to list shares');
  }
  // Ceinture et bretelles : un pont qui rend autre chose qu'un tableau ne doit
  // pas emporter la page de réglages avec lui (`items.filter is not a
  // function`). Une liste vide est un état que l'écran sait déjà peindre.
  return Array.isArray(result.data) ? result.data : [];
}

export async function revokeShare(shareId: string): Promise<boolean> {
  if (!window.electron?.ipcRenderer) return false;
  const result = await window.electron.ipcRenderer.invoke('share:revoke', shareId);
  if (!result?.success) {
    throw new Error(result?.error || 'Failed to revoke share');
  }
  // Drop the cached K_share too — there's no scenario where re-displaying
  // a revoked share's URL is useful, and keeping the entry would clutter
  // the panel.
  removeLocalShareKey(shareId);
  return result.revoked === true;
}

// ── Audit log ──────────────────────────────────────────────────────────────

export interface ShareView {
  viewedAt: number;
  country: string | null;
  ipSubnet: string | null;
}

export async function listShareViews(shareId: string): Promise<ShareView[]> {
  if (!window.electron?.ipcRenderer) return [];
  const result = await window.electron.ipcRenderer.invoke('share:listViews', shareId);
  if (!result?.success) {
    throw new Error(result?.error || 'Failed to fetch share views');
  }
  return Array.isArray(result.data) ? result.data : [];
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Derive the same opaque fileId syncService uses for manifest keys —
 * sha256(`${folderId}/${fileName}`) truncated to 32 hex chars. We need
 * this only as a bookkeeping reference; the share's actual storage lives
 * under a separate R2 prefix.
 */
async function deriveOpaqueFileId(folderId: string, fileName: string): Promise<string> {
  const path = `${folderId}/${fileName}`;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(path));
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return hex.slice(0, 32);
}
