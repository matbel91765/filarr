/**
 * E2EE share crypto — runs in the renderer
 *
 * v2 flow:
 *   1. Generate K_share (32 random bytes)
 *   2. Encrypt the share manifest with K_actual (= K_share, or HKDF-derived
 *      if password-protected)
 *   3. For each plaintext chunk: encrypt with K_actual using AES-GCM
 *      → output layout = IV(12) || ciphertext+tag
 *   4. Ship K_share in the URL fragment (#k=...) — never to the server
 *
 * No FEK in the share payload anymore. The renderer reads the file
 * plaintext locally (via the existing decrypt pipeline), re-encrypts each
 * chunk with K_share specifically for this share, and uploads. The
 * recipient only needs K_share to decrypt everything.
 *
 * Format choice: a uniform IV(12) || ciphertext+tag layout for every share
 * chunk eliminates the magic-byte versioning the recipient needed for
 * vault-format files. The recipient's decryption is just one
 * crypto.subtle.decrypt call per chunk.
 */

import { encryptChunk, CHUNK_SIZE } from '../crypto/chunkPipeline';

// ── Constants ───────────────────────────────────────────────────────────────

const IV_LENGTH = 12; // AES-GCM recommended
const K_SHARE_LENGTH = 32; // 256-bit key
const PASSWORD_SALT_LENGTH = 16; // for HKDF when password-protected
const HKDF_INFO = new TextEncoder().encode('filarr-share-v1');

// Plaintext chunk size before encryption — the shared pipeline constant (E3-6),
// re-exported so existing share callers keep importing SHARE_CHUNK_SIZE.
export const SHARE_CHUNK_SIZE = CHUNK_SIZE;

// ── Types ───────────────────────────────────────────────────────────────────

export interface ShareManifestPlain {
  fileName: string;
  mimeType: string;
  size: number;
  totalChunks: number;
  /**
   * Format des fragments. `2` = chaque fragment est lié par AAD à
   * (shareId, index, totalChunks) : un stockage compromis ne peut plus les
   * réordonner, dupliquer ou substituer sans faire échouer le déchiffrement.
   * Absent = v1 (fragments non liés — les partages créés avant 3.0.7).
   * Le manifeste étant lui-même authentifié sous K_actual, le serveur ne peut
   * pas retirer ce champ. Miroir de src/lib/share-crypto.ts (site web), seul
   * récepteur : il accepte v1 et v2.
   */
  chunkBinding?: 1 | 2;
}

export const SHARE_CHUNK_BINDING_V2 = 2 as const;

/** Ce à quoi un fragment v2 est lié. */
export interface ShareChunkBinding {
  shareId: string;
  chunkIndex: number;
  totalChunks: number;
}

const CHUNK_AAD_PREFIX = 'filarr-share-v2';

/** AAD (UTF-8) = `filarr-share-v2|${shareId}|${chunkIndex}|${totalChunks}`. */
export function shareChunkAad(binding: ShareChunkBinding): Uint8Array {
  return new TextEncoder().encode(
    `${CHUNK_AAD_PREFIX}|${binding.shareId}|${binding.chunkIndex}|${binding.totalChunks}`
  );
}

export interface ShareCryptoSetup {
  /** Opaque base64 blobs to ship to the server in POST /sync/share */
  encryptedManifest: string;
  encryptedManifestIv: string;
  passwordSalt: string | null;
  /** Held by the caller to compose the public URL — never sent to server */
  kShareBase64Url: string;
  /** AES-GCM key used to encrypt each chunk — kept in renderer memory only */
  kActualKey: CryptoKey;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Generate K_share, derive K_actual (with optional password), and encrypt
 * the manifest. Returns the opaque blobs + the K_actual CryptoKey the
 * caller uses to encrypt every chunk in the same session.
 */
export async function setupShareCrypto(
  manifest: ShareManifestPlain,
  password: string | null
): Promise<ShareCryptoSetup> {
  // K_share — the URL fragment key. Never leaves the originating device
  // except encoded in the URL the user copies.
  const kShare = crypto.getRandomValues(new Uint8Array(K_SHARE_LENGTH));

  // K_actual: same as K_share with no password; HKDF-derived with one.
  let kActual: Uint8Array;
  let passwordSalt: Uint8Array | null = null;
  if (password) {
    passwordSalt = crypto.getRandomValues(new Uint8Array(PASSWORD_SALT_LENGTH));
    kActual = await deriveKActual(kShare, password, passwordSalt);
  } else {
    kActual = kShare;
  }

  // Import K_actual as an AES-GCM key. We re-use this for the manifest
  // and every chunk — same key, different IVs per encrypt call. GCM is
  // safe under key reuse provided IVs never repeat for the same key,
  // which is statistically guaranteed by 12 bytes of crypto-random.
  const kActualKey = await crypto.subtle.importKey(
    'raw',
    kActual as BufferSource,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt']
  );

  // Encrypt the manifest with the same key as the chunks (one key → one
  // wrap step on the recipient side, simpler code).
  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));
  const manifestIv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const encryptedManifest = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: manifestIv }, kActualKey, manifestBytes)
  );

  return {
    encryptedManifest: uint8ToBase64(encryptedManifest),
    encryptedManifestIv: uint8ToBase64(manifestIv),
    passwordSalt: passwordSalt ? uint8ToBase64(passwordSalt) : null,
    kShareBase64Url: uint8ToBase64Url(kShare),
    kActualKey,
  };
}

/**
 * Encrypt one plaintext chunk for a share. Returns a single blob of
 * IV(12) || ciphertext+tag — the exact bytes the recipient will receive
 * verbatim from the public chunk endpoint.
 *
 * Caller must pass the same `kActualKey` that was returned by
 * setupShareCrypto for this share session.
 *
 * With `binding` (format v2), the chunk is authenticated together with its
 * (shareId, index, totalChunks) as AES-GCM additional data, and the manifest
 * MUST carry `chunkBinding: 2`. Without it the chunk is v1 (legacy layout,
 * no AAD), still accepted by the web recipient.
 */
export async function encryptShareChunk(
  plaintext: Uint8Array,
  kActualKey: CryptoKey,
  binding?: ShareChunkBinding
): Promise<Uint8Array> {
  // The IV(12)||ct+tag format lives in the shared chunk pipeline (E3-6), so shares
  // and vault items can't drift apart. The recipient decrypts it verbatim.
  if (!binding) return encryptChunk(plaintext, kActualKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: shareChunkAad(binding) as BufferSource },
      kActualKey,
      plaintext as BufferSource
    )
  );
  const out = new Uint8Array(iv.byteLength + ciphertext.byteLength);
  out.set(iv, 0);
  out.set(ciphertext, iv.byteLength);
  return out;
}

/**
 * Compose the final public URL the owner shares with the recipient.
 * Format: https://filarr.com/s/{shareId}#k={base64url(K_share)}
 *
 * The fragment is mandatory — without it the recipient has no key.
 */
export function buildShareUrl(
  publicBaseUrl: string,
  shareId: string,
  kShareBase64Url: string
): string {
  const base = publicBaseUrl.replace(/\/+$/, '');
  return `${base}/s/${shareId}#k=${kShareBase64Url}`;
}

// ── Internal helpers ────────────────────────────────────────────────────────

/**
 * HKDF-SHA-256 derivation of K_actual from K_share + password + salt.
 *
 * Must match the recipient-side derivation exactly. The public page (Next.js
 * on filarr.com/s/[id]) re-implements the same call — keep both sides aligned.
 */
async function deriveKActual(
  kShare: Uint8Array,
  password: string,
  salt: Uint8Array
): Promise<Uint8Array> {
  const passwordBytes = new TextEncoder().encode(password);
  // HKDF treats its input as a uniform secret. Prepending K_share to the
  // password ensures both must be known to derive K_actual.
  const ikm = new Uint8Array(kShare.length + passwordBytes.length);
  ikm.set(kShare, 0);
  ikm.set(passwordBytes, kShare.length);

  const keyMaterial = await crypto.subtle.importKey('raw', ikm as BufferSource, 'HKDF', false, [
    'deriveBits',
  ]);
  const derived = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: salt as BufferSource,
      info: HKDF_INFO as BufferSource,
    },
    keyMaterial,
    256
  );
  return new Uint8Array(derived);
}

function uint8ToBase64(data: Uint8Array): string {
  const CHUNK = 8192;
  let binary = '';
  for (let i = 0; i < data.length; i += CHUNK) {
    const chunk = data.subarray(i, i + CHUNK);
    binary += String.fromCharCode.apply(null, chunk as unknown as number[]);
  }
  return btoa(binary);
}

function uint8ToBase64Url(data: Uint8Array): string {
  return uint8ToBase64(data).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
