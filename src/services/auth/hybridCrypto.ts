/**
 * Hybrid Crypto Module
 *
 * Manages the File Encryption Key (FEK) for local-first hybrid storage.
 * The FEK is a random 256-bit AES key used to encrypt all file content locally.
 * It is "wrapped" (encrypted) with a Key Encryption Key (KEK) derived from
 * the user's password via PBKDF2-SHA-512, 600k iterations.
 *
 * This allows multi-device access: each device derives the same KEK from the
 * password and can unwrap the FEK. Password changes only re-wrap the FEK —
 * no files need to be re-encrypted.
 *
 * File encryption: AES-256-GCM with a random 12-byte IV per file.
 * Format: IV(12) || ciphertext || tag(16)
 */

import { deflate, inflate } from 'pako';
import { isExtensionPrecompressed } from '../../constants/limits';
import { normalizeRecoveryPhrase, clearUserKeypair } from './userKeypair';
import { clearVaultKeys } from '../vault/vaultKeyCache';

const PBKDF2_ITERATIONS = 600_000;
const KEY_LENGTH = 256; // bits
const IV_LENGTH = 12; // bytes — GCM recommended
const SALT_LENGTH = 16; // bytes — for KEK derivation

// ── On-disk / on-wire blob format ──────────────────────────────────────────
// The first byte of every encrypted blob is a version marker so old data
// keeps decrypting after we change the pipeline. Layout after the marker
// depends on the version:
//
//   FORMAT_V0 (0x00) — legacy, no marker byte: raw IV(12) || ciphertext.
//     Detected by elimination — anything that doesn't start with a known
//     marker byte AND fits the legacy length pattern is treated as v0.
//   FORMAT_V1 (0x01) — marker || IV(12) || ciphertext, plaintext = raw bytes.
//   FORMAT_V2 (0x02) — marker || IV(12) || ciphertext, plaintext = zlib(raw).
//
// Backward read compatibility is permanent: we never re-key files just to
// change the marker. Forward writes always use the latest format the
// caller picked.
const FORMAT_V1_PLAIN = 0x01;
const FORMAT_V2_DEFLATE = 0x02;

// Compression cutoff. Below this size deflate's framing + dictionary
// overhead can actually inflate the payload, and the CPU cost isn't
// worth the saved bytes. Files under this are stored plain (v1).
const COMPRESSION_MIN_BYTES = 1024; // 1 KB

// Compression level — pako follows zlib's 0..9 scale.
// 6 is the deflate default (balanced); we drop to 5 because we're called
// on the UI thread and a 20% speed bump matters more than the last 2%
// of ratio. Empirically: 5 lands within a few percent of 6 on JSON/text
// while halving CPU on big payloads.
const COMPRESSION_LEVEL = 5;

// Magic-byte detector for content that's already compressed. Catches the
// common case where a .pdf or .docx is read into a Buffer without the
// caller passing the filename through — extension-based detection in
// limits.ts is the first line of defence; this is the second.
function looksAlreadyCompressed(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;
  const b0 = bytes[0],
    b1 = bytes[1],
    b2 = bytes[2],
    b3 = bytes[3];
  // PNG: 89 50 4E 47, JPEG: FF D8 FF, GIF: 47 49 46, PDF: 25 50 44 46,
  // ZIP/.docx/.xlsx/.jar: 50 4B 03 04, 7z: 37 7A BC AF, gzip: 1F 8B,
  // zstd: 28 B5 2F FD, brotli (no fixed magic, skip), lz4: 04 22 4D 18,
  // mp4 starts with size+ftyp (offset 4) — we approximate via 4..7 below,
  // webp: RIFF then WEBP (offset 8), mp3: ID3 or FF FB, flac: 66 4C 61 43.
  if (b0 === 0x89 && b1 === 0x50 && b2 === 0x4e && b3 === 0x47) return true; // PNG
  if (b0 === 0xff && b1 === 0xd8 && b2 === 0xff) return true; // JPEG
  if (b0 === 0x47 && b1 === 0x49 && b2 === 0x46) return true; // GIF
  if (b0 === 0x25 && b1 === 0x50 && b2 === 0x44 && b3 === 0x46) return true; // PDF
  if (b0 === 0x50 && b1 === 0x4b && (b2 === 0x03 || b2 === 0x05) && b3 === 0x04) return true; // ZIP
  if (b0 === 0x37 && b1 === 0x7a && b2 === 0xbc && b3 === 0xaf) return true; // 7z
  if (b0 === 0x1f && b1 === 0x8b) return true; // gzip
  if (b0 === 0x28 && b1 === 0xb5 && b2 === 0x2f && b3 === 0xfd) return true; // zstd
  if (b0 === 0x04 && b1 === 0x22 && b2 === 0x4d && b3 === 0x18) return true; // lz4
  if (b0 === 0x49 && b1 === 0x44 && b2 === 0x33) return true; // ID3 (mp3)
  if (b0 === 0xff && (b1 & 0xe0) === 0xe0) return true; // mp3 frame sync
  if (b0 === 0x66 && b1 === 0x4c && b2 === 0x61 && b3 === 0x43) return true; // flac
  return false;
}

export interface WrappedKeyData {
  wrappedFek: string; // base64(IV || wrappedKey)
  kekSalt: string; // base64(salt)
  version: number;
  /** FEK wrapped with a key derived from the recovery phrase (optional) */
  recoveryWrappedFek?: string; // base64(IV || wrappedKey)
  recoverySalt?: string; // base64(salt)
  // ── Hardware security key (WebAuthn PRF) — feature #7 ──────────────────────
  // These fields are intentionally LOCAL-ONLY: they are persisted in the
  // on-disk wrapped_fek.json but never pushed to the cloud and never folded
  // into computeWrappedKeyDigest(). A hardware key is physically bound to one
  // device, so cloud-syncing its wrap buys nothing and would force a server
  // schema + digest change. Password + recovery phrase remain the only
  // cloud-portable recovery paths. See WRAPPED_KEY_SCENARIOS.md.
  /** FEK wrapped with a KEK derived from the authenticator's PRF/hmac-secret output */
  hwWrappedFek?: string; // base64(IV || wrappedKey)
  /** Per-credential random salt fed to the PRF extension (`prf.eval.first`) */
  hwSalt?: string; // base64(salt)
  /** Opaque WebAuthn credential id (base64url) — a public handle, not secret */
  hwCredentialId?: string;
  // ── Device-bound key (E5-4, SSO unlock) ───────────────────────────────────
  // 1Password-style: the FEK wrapped under a KEK derived from a random 256-bit
  // DEVICE key that lives in the OS keychain (safeStorage, `.device_key_safe`),
  // NOT in this file. After an SSO login (the IdP federates the session but never
  // sees a key), the app unlocks the FEK via this wrap + the device key — no
  // vault password. LOCAL-ONLY: never pushed to the cloud, never in the digest;
  // the device key never leaves the machine. Device-theft tradeoff disclosed in E5-8.
  /** FEK wrapped with a KEK derived (HKDF) from the safeStorage device key */
  deviceWrappedFek?: string; // base64(IV || wrappedKey)
  /** Salt fed to the HKDF over the device key */
  deviceSalt?: string; // base64(salt)
  /** Random id for this enrollment (reference / deprovisioning), not secret */
  deviceKeyId?: string;
  // ── Hidden vault / decoy mode — feature #6 ────────────────────────────────
  // A SEPARATE decoy FEK (not the real one) wrapped by the duress password.
  // Unlocking the main profile with the duress password loads this FEK and
  // switches the app to the hidden decoy profile `altProfileId`, which holds
  // its own bland files. Local-only (excluded from computeWrappedKeyDigest):
  // syncing the decoy is a future hardening step that needs server columns.
  // Plausible deniability here is INTENTIONALLY LIMITED — see HIDDEN_VAULT docs.
  /** Decoy FEK wrapped with a KEK derived from the duress password */
  altWrappedFek?: string; // base64(IV || wrappedKey)
  /** Salt for the duress-password KEK derivation */
  altKekSalt?: string; // base64(salt)
  /** Id of the hidden decoy profile to switch to when the duress password matches */
  altProfileId?: string;
}

/** Result of a dual-vault unlock attempt — which password matched, if any. */
export type VaultUnlockMatch = 'real' | 'decoy' | null;

// Module-level state — lives in memory only
let _fek: CryptoKey | null = null;
let _fekRaw: ArrayBuffer | null = null; // raw key bytes for safeStorage export

/**
 * CLÉS RETIRÉES — anciennes clés de coffre, LECTURE SEULE.
 *
 * POURQUOI ELLES EXISTENT ICI. La migration « publier ce coffre sur le compte »
 * ne rescelle RIEN localement : après une bascule, tous les fichiers déjà
 * présents sont encore scellés sous l'ancienne clé. Or c'est le RENDERER qui
 * déchiffre les blobs de profil hybride — sans ces clés, un coffre migré
 * paraîtrait vide alors que tout est intact sur le disque.
 *
 * ELLES NE SERVENT JAMAIS À ÉCRIRE. `encryptFileContent` ne les regarde pas :
 * un fichier NEUF est toujours scellé sous `_fek`, c'est-à-dire sous la clé du
 * compte. Le seul chemin qui les consulte est `decryptFileContent`, et
 * seulement après l'échec de la clé active.
 */
let _retiredFeks: CryptoKey[] = [];
/**
 * A-t-on DÉJÀ interrogé le process principal ? Distinct de « la liste est
 * vide » : la quasi-totalité des coffres n'a aucune clé retirée, et il ne faut
 * pas refaire un aller-retour IPC à chaque fichier réellement corrompu.
 */
let _retiredLoaded = false;

/**
 * Recharge les clés retirées depuis le process principal.
 *
 * Appelée à chaque installation de la FEK ET juste après une bascule de clé
 * (événement `publish:key-adopted`) : c'est exactement l'instant où la clé
 * active cesse d'ouvrir le contenu déjà là.
 */
export async function refreshRetiredFeks(): Promise<void> {
  if (!window.electron?.ipcRenderer) return;
  _retiredLoaded = true;
  try {
    const raw: number[][] | null =
      await window.electron.ipcRenderer.invoke('publish:getRetiredKeys');
    if (!Array.isArray(raw) || raw.length === 0) {
      _retiredFeks = [];
      return;
    }
    _retiredFeks = await Promise.all(
      raw.map((bytes) =>
        crypto.subtle.importKey(
          'raw',
          new Uint8Array(bytes),
          { name: 'AES-GCM', length: KEY_LENGTH },
          false,
          ['decrypt']
        )
      )
    );
  } catch {
    // Aucune clé retirée n'est un état parfaitement normal (coffre jamais
    // migré). On ne lève pas : lever ici casserait l'ouverture du coffre.
    _retiredFeks = [];
  }
}

/** Oublie les clés retirées — suit la FEK hors mémoire au verrouillage. */
function clearRetiredFeks(): void {
  _retiredFeks = [];
  _retiredLoaded = false;
}

/**
 * Pousse une copie de la FEK vers le process main (`sync:setSessionKey`) pour
 * les opérations de chiffrement V3 en streaming des profils hybrides (gros
 * fichiers : hybrid:saveFromPath / hybrid:readDecryptedV3, sondes de
 * portabilité du sync). Main la garde en mémoire uniquement (zéroïsée au
 * lock / changement de profil / quit — jamais écrite sur disque).
 * Appelée à CHAQUE installation de _fek, y compris l'unlock leurre (#6) où
 * `.fek_safe` contient encore la clé du vrai profil : la clé de session est
 * donc toujours celle de la session ACTIVE.
 */
function pushSessionKeyToMain(): void {
  if (!window.electron?.ipcRenderer || !_fekRaw) return;
  void window.electron.ipcRenderer
    .invoke('sync:setSessionKey', new Uint8Array(_fekRaw))
    .catch(() => {
      /* best effort — les sondes sync retombent sur .fek_safe côté main */
    });
}

/**
 * SHA-256 hex of the concatenated wrapped blobs, matching the server's
 * `sha256HexOfWrappedBlobs` — used for compare-and-set on pushes.
 */
async function computeWrappedKeyDigest(data: {
  wrappedFek: string;
  recoveryWrappedFek?: string;
}): Promise<string> {
  const encoded = new TextEncoder().encode(data.wrappedFek + (data.recoveryWrappedFek ?? ''));
  const buf = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * The cloud-portable subset of a wrapped-key blob. STRIPS every LOCAL-ONLY wrap — the hardware-key
 * (#7), hidden-vault decoy (#6) and device-key (E5-4) wraps are all device-bound and must never
 * leave the machine. Every cloud push goes through this projection so the local-only invariant holds
 * by construction at the client, not by trusting the server to drop unknown fields.
 */
export function cloudPortableWrap(data: WrappedKeyData): {
  wrappedFek: string;
  kekSalt: string;
  version: number;
  recoveryWrappedFek?: string;
  recoverySalt?: string;
} {
  return {
    wrappedFek: data.wrappedFek,
    kekSalt: data.kekSalt,
    version: data.version,
    ...(data.recoveryWrappedFek
      ? { recoveryWrappedFek: data.recoveryWrappedFek, recoverySalt: data.recoverySalt }
      : {}),
  };
}

/**
 * Push the wrapped FEK to the server (ciphertext-at-rest, opaque to server).
 *
 * Uses the compare-and-set protocol: caller either passes `expectedPreviousDigest`
 * explicitly (when they know the prior state), or omits it — in which case we
 * fetch the current server blob and compute the digest just-in-time. A 409
 * response means the server's state has moved since we observed it, which
 * callers may want to surface or retry.
 *
 * Returns true on success, false on any failure (including 409). Best-effort
 * for non-critical call sites — callers that need strict semantics should use
 * the returned boolean.
 */
async function pushWrappedKeyToCloud(
  data: WrappedKeyData,
  expectedPreviousDigest?: string
): Promise<boolean> {
  if (!window.electron?.ipcRenderer) return false;

  let digest = expectedPreviousDigest;
  if (!digest) {
    // Fetch-then-compute-digest: covers the common "just loaded local, about
    // to backfill" path where we haven't seen the server state yet.
    const current = await fetchWrappedKeyFromCloud();
    digest = current
      ? await computeWrappedKeyDigest({
          wrappedFek: current.wrappedFek,
          recoveryWrappedFek: current.recoveryWrappedFek,
        })
      : 'initial';
  }

  try {
    // Project to the cloud-portable shape so LOCAL-ONLY wraps NEVER leave the machine — by
    // construction at this single chokepoint, not by trusting the server to drop them.
    const result = await window.electron.ipcRenderer.invoke('hybrid:pushWrappedKeyToCloud', {
      ...cloudPortableWrap(data),
      expectedPreviousDigest: digest,
    });
    if (result && result.success === false) {
      if (process.env.NODE_ENV === 'development') {
        console.warn('[HybridCrypto] pushWrappedKeyToCloud rejected:', result.error);
      }
      return false;
    }
    return true;
  } catch (err) {
    if (process.env.NODE_ENV === 'development') {
      console.warn('[HybridCrypto] pushWrappedKeyToCloud failed (non-fatal):', err);
    }
    return false;
  }
}

/**
 * Fetch the server-side copy of the wrapped FEK (if any). Used when a fresh
 * install has no local `wrapped_fek.json` — e.g. new device login, or the
 * user wiped their local profile. Returns null if the server has nothing.
 */
async function fetchWrappedKeyFromCloud(): Promise<WrappedKeyData | null> {
  if (!window.electron?.ipcRenderer) return null;
  try {
    const data: WrappedKeyData | null = await window.electron.ipcRenderer.invoke(
      'hybrid:fetchWrappedKeyFromCloud'
    );
    return data ?? null;
  } catch (err) {
    if (process.env.NODE_ENV === 'development') {
      console.warn('[HybridCrypto] fetchWrappedKeyFromCloud failed:', err);
    }
    return null;
  }
}

/**
 * One-shot backfill for pre-existing cloud accounts: if the server has no
 * wrapped-key row yet (account created before the deploy), push up the local
 * blob so future new-device logins can skip the pairing flow. We do a GET first
 * to avoid overwriting on every launch.
 *
 * Also reconciles a MISSING recovery wrap: if the server already holds the same
 * FEK but never got the recovery-phrase wrap (a transient failure of
 * applyRecoveryPhrase's push at onboarding/regeneration), re-push it now. The
 * same-FEK guard ensures we only attach our recovery copy to our own row — never
 * stomp a genuinely diverged server blob — and the server digest gates the push
 * (compare-and-set 409s on a concurrent change). This is the self-heal that makes
 * cloud phrase-recovery eventually consistent after a transient publish miss.
 */
async function backfillWrappedKeyToCloudIfMissing(data: WrappedKeyData): Promise<void> {
  const existing = await fetchWrappedKeyFromCloud();
  if (!existing) {
    // Server has none → explicit 'initial' digest skips the redundant fetch.
    await pushWrappedKeyToCloud(data, 'initial');
    if (process.env.NODE_ENV === 'development') {
      console.log('[HybridCrypto] backfilled wrappedKey to server');
    }
    return;
  }
  if (
    data.recoveryWrappedFek &&
    existing.wrappedFek === data.wrappedFek &&
    !existing.recoveryWrappedFek
  ) {
    const serverDigest = await computeWrappedKeyDigest({
      wrappedFek: existing.wrappedFek,
      recoveryWrappedFek: existing.recoveryWrappedFek,
    });
    await pushWrappedKeyToCloud(data, serverDigest);
    if (process.env.NODE_ENV === 'development') {
      console.log('[HybridCrypto] reconciled missing recovery wrap to server');
    }
  }
}

/**
 * Derive a KEK (Key Encryption Key) from a password and salt.
 */
async function deriveKEK(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-512',
    },
    keyMaterial,
    { name: 'AES-GCM', length: KEY_LENGTH },
    false,
    ['wrapKey', 'unwrapKey']
  );
}

/**
 * Generate a new random FEK and wrap it with the user's password.
 * Called on first login when no wrapped_fek.json exists.
 */
export async function generateAndWrapFEK(password: string): Promise<WrappedKeyData> {
  // Generate random FEK
  const fek = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: KEY_LENGTH },
    true, // extractable — needed for wrapping
    ['encrypt', 'decrypt']
  );

  // Derive KEK from password
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const kek = await deriveKEK(password, salt);

  // Wrap (encrypt) the FEK with the KEK
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const wrappedFekBuffer = await crypto.subtle.wrapKey('raw', fek, kek, {
    name: 'AES-GCM',
    iv,
  });

  // Pack: IV(12) || wrappedKey
  const packed = new Uint8Array(IV_LENGTH + wrappedFekBuffer.byteLength);
  packed.set(iv, 0);
  packed.set(new Uint8Array(wrappedFekBuffer), IV_LENGTH);

  // Store the FEK in memory for encryption/decryption
  // Re-import as non-extractable for security
  const fekRawBuf = await crypto.subtle.exportKey('raw', fek);
  _fekRaw = fekRawBuf.slice(0); // keep a copy for safeStorage export
  _fek = await crypto.subtle.importKey(
    'raw',
    fekRawBuf,
    { name: 'AES-GCM', length: KEY_LENGTH },
    false, // not extractable
    ['encrypt', 'decrypt']
  );
  pushSessionKeyToMain();

  return {
    wrappedFek: uint8ToBase64(packed),
    kekSalt: uint8ToBase64(salt),
    version: 1,
  };
}

/**
 * Unwrap (decrypt) the FEK from stored wrapped data using the user's password.
 * Called at login when wrapped_fek.json exists.
 */
async function unwrapFEK(password: string, wrappedData: WrappedKeyData): Promise<CryptoKey> {
  const salt = base64ToUint8(wrappedData.kekSalt);
  const kek = await deriveKEK(password, salt);

  const packed = base64ToUint8(wrappedData.wrappedFek);
  const iv = packed.slice(0, IV_LENGTH);
  const wrappedKeyBuffer = packed.slice(IV_LENGTH);

  // Unwrap as extractable so we can export raw bytes for safeStorage
  return crypto.subtle.unwrapKey(
    'raw',
    wrappedKeyBuffer,
    kek,
    { name: 'AES-GCM', iv },
    { name: 'AES-GCM', length: KEY_LENGTH },
    true, // extractable — needed for safeStorage export
    ['encrypt', 'decrypt']
  );
}

/**
 * Initialize hybrid crypto: derive KEK from password, unwrap or generate FEK.
 * Must be called after successful login in server mode.
 */
export async function initHybridCrypto(password: string): Promise<void> {
  if (process.env.NODE_ENV === 'development') console.log('[HybridCrypto] initHybridCrypto called');
  if (!window.electron?.ipcRenderer) {
    throw new Error('Hybrid crypto requires Electron IPC');
  }

  // Try local first, fall back to cloud copy (new-device bootstrap), then
  // generate a fresh FEK as last resort (true first-time onboarding).
  let wrappedData: WrappedKeyData | null =
    await window.electron.ipcRenderer.invoke('hybrid:loadWrappedKey');
  // Track where the blob came from so we only backfill the server when the
  // local copy is authoritative (loading from cloud means server already has it).
  const loadedFromLocal = !!wrappedData;

  if (!wrappedData) {
    const cloudCopy = await fetchWrappedKeyFromCloud();
    if (cloudCopy) {
      wrappedData = cloudCopy;
      // Persist locally so future launches skip the network round-trip.
      await window.electron.ipcRenderer.invoke('hybrid:saveWrappedKey', cloudCopy);
      if (process.env.NODE_ENV === 'development') {
        console.log('[HybridCrypto] wrappedData bootstrapped from cloud');
      }
    }
  }

  if (process.env.NODE_ENV === 'development') {
    console.log('[HybridCrypto] wrappedData:', wrappedData ? 'found' : 'null (first time)');
  }

  if (wrappedData) {
    // Unwrap existing FEK (extractable for raw export)
    const extractableFek = await unwrapFEK(password, wrappedData);
    // Export raw bytes for safeStorage persistence
    _fekRaw = await crypto.subtle.exportKey('raw', extractableFek);
    // Re-import as non-extractable for runtime security
    _fek = await crypto.subtle.importKey(
      'raw',
      _fekRaw,
      { name: 'AES-GCM', length: KEY_LENGTH },
      false,
      ['encrypt', 'decrypt']
    );
    pushSessionKeyToMain();
    // Backfill: accounts created before the server-side wrapped-key deploy
    // have a local blob but no server copy. Push it up only when we loaded
    // from local (authoritative) — not when we just bootstrapped from cloud,
    // since in that case the server already has exactly this blob. Missing
    // auth (local-only mode) makes the push a silent no-op.
    if (loadedFromLocal) {
      await backfillWrappedKeyToCloudIfMissing(wrappedData);
    }
    if (process.env.NODE_ENV === 'development') console.log('[HybridCrypto] FEK loaded');
  } else {
    // First time: generate new FEK + wrap it + push to cloud.
    // We just observed the server has nothing — pass 'initial' so the push
    // is rejected with 409 if a concurrent device seeded a row between our
    // check and our push (prevents stomping their FEK with a fresh one).
    const newWrappedData = await generateAndWrapFEK(password);
    await window.electron.ipcRenderer.invoke('hybrid:saveWrappedKey', newWrappedData);
    await pushWrappedKeyToCloud(newWrappedData, 'initial');
    if (process.env.NODE_ENV === 'development') console.log('[HybridCrypto] New FEK generated');
  }

  // Persist raw FEK via OS keychain (safeStorage) for seamless restart
  if (_fekRaw) {
    const rawBytes = Array.from(new Uint8Array(_fekRaw));
    await window.electron.ipcRenderer.invoke('hybrid:storeFEK', rawBytes);
    if (process.env.NODE_ENV === 'development') console.log('[HybridCrypto] FEK persisted');
  }

  // E2-4: orchestrate the per-user keypair alongside the FEK (eager generation /
  // fetch-and-unwrap). Best-effort — a keypair issue must never break login; the
  // lazy path (E2-6) is the retry safety net.
  try {
    const { initUserKeypair } = await import('./userKeypairSync');
    await initUserKeypair(password);
  } catch (e) {
    console.warn('[HybridCrypto] user keypair init failed (non-fatal):', e);
  }
}

/**
 * Encrypt file content with the FEK (AES-256-GCM, random IV).
 *
 * Pipeline: optional deflate → AES-256-GCM → blob with version marker.
 *
 * Compression is applied when:
 *   - plaintext is at least COMPRESSION_MIN_BYTES, AND
 *   - the filename extension isn't on the "already compressed" list, AND
 *   - the bytes don't look like a known compressed format by magic header.
 *
 * Compress-then-encrypt is the right order for at-rest file storage: doing
 * it the other way round produces near-incompressible ciphertext. The
 * CRIME/BREACH side-channel attacks that motivate "encrypt-then-compress"
 * advice don't apply here — they require attacker-controlled plaintext
 * shared with a secret in the same compressed payload, which Filarr never
 * does (each user's files live in their own FEK domain).
 *
 * Output layout: marker(1) || IV(12) || ciphertext+tag
 */
export async function encryptFileContent(
  plaintext: ArrayBuffer,
  options?: { fileName?: string; compress?: boolean }
): Promise<Uint8Array> {
  if (!_fek) {
    throw new Error('Hybrid crypto not initialized — call initHybridCrypto first');
  }

  const raw = new Uint8Array(plaintext);
  const shouldTryCompress =
    options?.compress !== false &&
    raw.byteLength >= COMPRESSION_MIN_BYTES &&
    !(options?.fileName && isExtensionPrecompressed(options.fileName)) &&
    !looksAlreadyCompressed(raw);

  let bytesToEncrypt: Uint8Array;
  let marker: number;

  if (shouldTryCompress) {
    const deflated = deflate(raw, { level: COMPRESSION_LEVEL });
    // Only keep the compressed form if it actually saves space. On
    // already-entropic content deflate can grow the payload by a few
    // bytes of framing — falling through to v1 avoids that loss.
    if (deflated.byteLength + 1 < raw.byteLength) {
      bytesToEncrypt = deflated;
      marker = FORMAT_V2_DEFLATE;
    } else {
      bytesToEncrypt = raw;
      marker = FORMAT_V1_PLAIN;
    }
  } else {
    bytesToEncrypt = raw;
    marker = FORMAT_V1_PLAIN;
  }

  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    _fek,
    bytesToEncrypt as BufferSource
  );

  // Pack: marker(1) || IV(12) || ciphertext+tag
  const result = new Uint8Array(1 + IV_LENGTH + ciphertext.byteLength);
  result[0] = marker;
  result.set(iv, 1);
  result.set(new Uint8Array(ciphertext), 1 + IV_LENGTH);
  return result;
}

/**
 * Decrypt file content with the FEK.
 *
 * Accepts three on-disk formats:
 *   - V0 (legacy, no marker): IV(12) || ciphertext+tag
 *   - V1 (marker 0x01): marker || IV(12) || ciphertext+tag (plain plaintext)
 *   - V2 (marker 0x02): marker || IV(12) || ciphertext+tag (deflated plaintext)
 *
 * Format detection is by the first byte. Because legacy files don't have a
 * marker, we treat anything that doesn't start with a known marker as V0
 * — safe because the marker space (0x01, 0x02) doesn't collide with the
 * uniform-random IV distribution often enough to matter, and the GCM tag
 * check will fail loudly if we guess wrong.
 */
export async function decryptFileContent(encrypted: Uint8Array): Promise<ArrayBuffer> {
  if (!_fek) {
    throw new Error('Hybrid crypto not initialized — call initHybridCrypto first');
  }

  if (encrypted.byteLength < IV_LENGTH + 16) {
    throw new Error('Encrypted blob too short to be valid');
  }

  const marker = encrypted[0];
  const looksTagged = marker === FORMAT_V1_PLAIN || marker === FORMAT_V2_DEFLATE;

  /** Une tentative complète (tagged puis V0 hérité) sous UNE clé donnée. */
  const tryKey = async (key: CryptoKey): Promise<ArrayBuffer | null> => {
    // First try the tagged-format interpretation when the first byte matches
    // a known marker. The 12-byte IV is uniformly random though, so ~0.8% of
    // legacy V0 blobs will also start with 0x01/0x02 by chance — for those,
    // GCM authentication will fail and we fall back to V0 below.
    if (looksTagged) {
      try {
        const iv = encrypted.slice(1, 1 + IV_LENGTH);
        const ciphertext = encrypted.slice(1 + IV_LENGTH);
        const plaintextBuffer = await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv },
          key,
          ciphertext
        );
        if (marker === FORMAT_V2_DEFLATE) {
          const inflated = inflate(new Uint8Array(plaintextBuffer));
          return inflated.buffer.slice(
            inflated.byteOffset,
            inflated.byteOffset + inflated.byteLength
          ) as ArrayBuffer;
        }
        return plaintextBuffer;
      } catch {
        // Tag mismatch — this was actually a legacy V0 blob whose IV happened
        // to start with a marker-shaped byte. Fall through.
      }
    }

    // Legacy v0 (no marker): IV(12) || ciphertext+tag, no compression.
    try {
      const iv = encrypted.slice(0, IV_LENGTH);
      const ciphertext = encrypted.slice(IV_LENGTH);
      return await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
    } catch {
      return null;
    }
  };

  const withActiveKey = await tryKey(_fek);
  if (withActiveKey) return withActiveKey;

  // LA CLÉ ACTIVE N'OUVRE PAS — on essaie les clés RETIRÉES.
  //
  // Ce n'est pas une rustine : après une bascule de clé, c'est le cas NOMINAL
  // pour tout fichier antérieur à la migration, puisque la migration ne
  // rescelle rien localement. L'ordre compte — la clé active d'abord, pour que
  // le chemin fréquent ne paie rien — et l'écriture, elle, n'a jamais accès à
  // ces clés.
  //
  // Le chargement paresseux couvre TOUS les chemins de déverrouillage (mot de
  // passe, trousseau, clé matérielle, coffre leurre…) sans qu'aucun n'ait à
  // penser à le faire — un oubli sur l'un d'eux ferait paraître le coffre vide.
  if (!_retiredLoaded) await refreshRetiredFeks();

  for (const retired of _retiredFeks) {
    const withRetired = await tryKey(retired);
    if (withRetired) return withRetired;
  }

  throw new Error(
    'Déchiffrement impossible : aucune clé disponible n’ouvre ce fichier (clé active ni clés retenues).'
  );
}

/**
 * Re-wrap the FEK with a new password (after password change).
 * Requires the old password to unwrap first, then wraps with the new one.
 * No files need to be re-encrypted.
 */
export async function rewrapFEK(oldPassword: string, newPassword: string): Promise<WrappedKeyData> {
  if (!window.electron?.ipcRenderer) {
    throw new Error('Hybrid crypto requires Electron IPC');
  }

  const existingWrapped: WrappedKeyData | null =
    await window.electron.ipcRenderer.invoke('hybrid:loadWrappedKey');
  if (!existingWrapped) {
    throw new Error('No wrapped FEK found — cannot rewrap');
  }

  // Unwrap with old password (get extractable key for re-wrapping)
  const oldSalt = base64ToUint8(existingWrapped.kekSalt);
  const oldKek = await deriveKEK(oldPassword, oldSalt);

  const packed = base64ToUint8(existingWrapped.wrappedFek);
  const oldIv = packed.slice(0, IV_LENGTH);
  const wrappedKeyBuffer = packed.slice(IV_LENGTH);

  // Unwrap as extractable so we can re-wrap
  const extractableFek = await crypto.subtle.unwrapKey(
    'raw',
    wrappedKeyBuffer,
    oldKek,
    { name: 'AES-GCM', iv: oldIv },
    { name: 'AES-GCM', length: KEY_LENGTH },
    true, // extractable for re-wrapping
    ['encrypt', 'decrypt']
  );

  // Wrap with new password
  const newSalt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const newKek = await deriveKEK(newPassword, newSalt);
  const newIv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));

  const newWrappedBuffer = await crypto.subtle.wrapKey('raw', extractableFek, newKek, {
    name: 'AES-GCM',
    iv: newIv,
  });

  const newPacked = new Uint8Array(IV_LENGTH + newWrappedBuffer.byteLength);
  newPacked.set(newIv, 0);
  newPacked.set(new Uint8Array(newWrappedBuffer), IV_LENGTH);

  // Update in-memory FEK (re-import as non-extractable)
  _fekRaw = await crypto.subtle.exportKey('raw', extractableFek);
  _fek = await crypto.subtle.importKey(
    'raw',
    _fekRaw,
    { name: 'AES-GCM', length: KEY_LENGTH },
    false,
    ['encrypt', 'decrypt']
  );
  pushSessionKeyToMain();

  const newWrappedData: WrappedKeyData = {
    wrappedFek: uint8ToBase64(newPacked),
    kekSalt: uint8ToBase64(newSalt),
    version: existingWrapped.version,
    // The recovery wrap protects the SAME FEK under the recovery phrase — a
    // password change must carry it over. Omitting it here made the cloud
    // upsert NULL recovery_wrapped_fek (PUT /account/wrapped-key coalesces to
    // null), silently killing phrase recovery after every password change.
    // Mirror of the keypair path (userKeypairSync rewrapKeypairForPasswordChange).
    ...(existingWrapped.recoveryWrappedFek
      ? {
          recoveryWrappedFek: existingWrapped.recoveryWrappedFek,
          recoverySalt: existingWrapped.recoverySalt,
        }
      : {}),
  };

  // Save locally + push updated ciphertext to server. The digest is derived
  // from what we just unwrapped — the server will 409 if a concurrent
  // rewrap has happened on another device since we loaded this blob.
  //
  // The hardware-key wrap (#7) is local-only and survives a password change
  // unchanged (it wraps the same FEK), so carry it over into the on-disk copy.
  // The cloud push deliberately omits it.
  // Both local-only wraps (hardware key #7, device key E5-4) wrap the SAME FEK, so
  // they survive a password change unchanged — carry them into the on-disk copy.
  // The cloud push (newWrappedData) deliberately omits both.
  const localData: WrappedKeyData = {
    ...newWrappedData,
    ...(existingWrapped.hwWrappedFek
      ? {
          hwWrappedFek: existingWrapped.hwWrappedFek,
          hwSalt: existingWrapped.hwSalt,
          hwCredentialId: existingWrapped.hwCredentialId,
        }
      : {}),
    ...(existingWrapped.deviceWrappedFek
      ? {
          deviceWrappedFek: existingWrapped.deviceWrappedFek,
          deviceSalt: existingWrapped.deviceSalt,
          deviceKeyId: existingWrapped.deviceKeyId,
        }
      : {}),
  };
  await window.electron.ipcRenderer.invoke('hybrid:saveWrappedKey', localData);
  const prevDigest = await computeWrappedKeyDigest({
    wrappedFek: existingWrapped.wrappedFek,
    recoveryWrappedFek: existingWrapped.recoveryWrappedFek,
  });
  await pushWrappedKeyToCloud(newWrappedData, prevDigest);

  // E2-5: re-wrap the per-user keypair under the new password too, so the
  // asymmetric identity (and shared-vault access) survives the password change.
  // The public key/fingerprint are unchanged. Best-effort — never block the
  // password change on it.
  try {
    const { rewrapKeypairForPasswordChange } = await import('./userKeypairSync');
    await rewrapKeypairForPasswordChange(newPassword);
  } catch (e) {
    console.warn('[HybridCrypto] keypair re-wrap on password change failed (non-fatal):', e);
  }

  return newWrappedData;
}

/**
 * Try to restore the FEK from OS keychain (safeStorage) on app restart.
 * Returns true if the FEK was successfully restored, false otherwise.
 * This avoids requiring the user to re-enter their password after restart.
 */
export async function tryRestoreFEKFromSafeStorage(): Promise<boolean> {
  if (_fek) return true; // already loaded

  if (!window.electron?.ipcRenderer) return false;

  try {
    const rawBytes: number[] | null = await window.electron.ipcRenderer.invoke('hybrid:loadFEK');
    if (!rawBytes || rawBytes.length === 0) {
      return false;
    }

    await importFEKRaw(new Uint8Array(rawBytes));
    return true;
  } catch (error) {
    console.error('[HybridCrypto] Failed to restore FEK from safeStorage:', error);
    return false;
  }
}

/**
 * Check if the hybrid encryption key is available.
 */
export function hasHybridKey(): boolean {
  return _fek !== null;
}

/**
 * Export the raw FEK bytes (for secure storage via Electron safeStorage).
 * Returns null if no FEK is loaded.
 *
 * COPIE DÉFENSIVE, et c'est vital. `new Uint8Array(_fekRaw)` rendait une VUE sur
 * l'ArrayBuffer du module, pas une copie : tout appelant qui effaçait « sa »
 * copie derrière lui (`fek.fill(0)`, l'hygiène habituelle sur du matériel de
 * clé) mettait la FEK MAÎTRE à zéro. C'est arrivé — la dérivation d'une clé de
 * salle de collaboration (`collabKeys.getRoomKey`) le faisait dès la première
 * note ouverte en session, et tout le chemin conteneur-FEK (manifeste de sync)
 * échouait ensuite silencieusement : bouton de synchronisation rouge, cycle
 * refusé, sans aucun rapport apparent avec la collaboration.
 */
export async function exportFEKRaw(): Promise<Uint8Array | null> {
  if (!_fek) return null;
  // Le brut est gardé à l'import (`_fekRaw`) : la clé importée n'étant pas
  // extractible, c'est la seule façon de le rendre.
  return _fekRaw ? new Uint8Array(_fekRaw.slice(0)) : null;
}

/**
 * Import a raw FEK (from secure storage on app restart).
 * This avoids needing the password to unwrap.
 */
export async function importFEKRaw(raw: Uint8Array): Promise<void> {
  const buf = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer;
  _fek = await crypto.subtle.importKey('raw', buf, { name: 'AES-GCM', length: KEY_LENGTH }, false, [
    'encrypt',
    'decrypt',
  ]);
  _fekRaw = buf.slice(0);
  pushSessionKeyToMain();
  // Les clés retirées suivent la clé active : sur un appareil migré, elles sont
  // les SEULES à ouvrir le contenu antérieur à la bascule.
  void refreshRetiredFeks();
}

/**
 * Clear the FEK from memory (on logout / disconnect / auto-lock).
 */
export function clearHybridCrypto(): void {
  _fek = null;
  _fekRaw = null;
  clearRetiredFeks();
  // La clé de session côté main suit la FEK hors mémoire à chaque lock /
  // changement de profil / logout (main zéroïse le Buffer).
  if (window.electron?.ipcRenderer) {
    void window.electron.ipcRenderer.invoke('sync:clearSessionKey').catch(() => {
      /* best effort */
    });
  }
  // E2-9: the per-user keypair is a first-class memory secret on the same paths
  // as the FEK, so it must follow the FEK out of memory on every lock — not just
  // on a duress unlock. Zeroes _encPriv/_signPriv (pure, no IPC).
  clearUserKeypair();
  // E3-3: unlocked vault keys (K_vault) are equally session secrets — purge them
  // on every lock too (zeroes the cached buffers).
  clearVaultKeys();
}

// ==================== Recovery Phrase ====================

/**
 * Wrap the current FEK with a recovery phrase (called once during onboarding).
 * The phrase is used as a "password" for PBKDF2 derivation, producing
 * an independent wrapped copy of the FEK stored alongside the password-wrapped one.
 */
export async function wrapFEKWithRecoveryPhrase(recoveryPhrase: string): Promise<{
  recoveryWrappedFek: string;
  recoverySalt: string;
}> {
  if (!_fekRaw) {
    throw new Error('No FEK in memory — call initHybridCrypto first');
  }

  // Re-import as extractable temporarily for wrapping
  const extractableFek = await crypto.subtle.importKey(
    'raw',
    _fekRaw,
    { name: 'AES-GCM', length: KEY_LENGTH },
    true,
    ['encrypt', 'decrypt']
  );

  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  // Normalize the phrase so the wrap KEK matches what unwrap (recoverCloudAccount /
  // recoverWithPhrase) derives and what the server verifies (toLowerCase().trim()).
  const kek = await deriveKEK(normalizeRecoveryPhrase(recoveryPhrase), salt);
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));

  const wrappedBuffer = await crypto.subtle.wrapKey('raw', extractableFek, kek, {
    name: 'AES-GCM',
    iv,
  });

  const packed = new Uint8Array(IV_LENGTH + wrappedBuffer.byteLength);
  packed.set(iv, 0);
  packed.set(new Uint8Array(wrappedBuffer), IV_LENGTH);

  return {
    recoveryWrappedFek: uint8ToBase64(packed),
    recoverySalt: uint8ToBase64(salt),
  };
}

/**
 * Whether phrase-based recovery is set up (the FEK has a recovery wrap). Accounts
 * created before the recovery-wrap fix — notably existing cloud accounts — have
 * none; the Settings UI uses this to nudge the user to configure recovery. Reads
 * the local blob (kept in sync for an authenticated user); a missing/unknown blob
 * returns true so we never nag spuriously.
 */
export async function isRecoveryPhraseConfigured(): Promise<boolean> {
  const ipc = window.electron?.ipcRenderer;
  if (!ipc) return true;
  const data = (await ipc.invoke('hybrid:loadWrappedKey')) as WrappedKeyData | null;
  if (!data) return true; // no vault locally → nothing to nag about
  return !!data.recoveryWrappedFek;
}

/**
 * Make `recoveryPhrase` the account's recovery secret: wrap the in-memory FEK
 * (and the per-user keypair) under it, persist locally, and publish to the cloud
 * broker (compare-and-set; a no-op when unauthenticated). Safe to call again to
 * ROTATE to a new phrase — the server's recovery code_hash and the wrapped blobs
 * MUST rotate together, otherwise recoverCloudAccount would verify the new phrase
 * but fail to unwrap a blob still wrapped under the old one.
 *
 * Closes the cloud-account gap: cloud accounts receive a server-generated recovery
 * phrase at signup, but the FEK was never wrapped under it, so phrase recovery was
 * impossible. Call this at cloud onboarding and on every recovery-phrase
 * regeneration. Requires the FEK in memory (throws otherwise — callers treat it as
 * best-effort).
 *
 * `unlockPassword` (the account/vault password) lets the keypair half re-wrap even
 * after a safeStorage-only restart, where the FEK is restored but the keypair's
 * private keys aren't in memory yet.
 *
 * Returns whether the FEK recovery wrap reached the CLOUD. A cloud caller
 * (regeneration) MUST surface `false` to the user: the server's recovery code_hash
 * has already rotated, so a failed publish leaves recovery unable to unwrap (the
 * blob is still under the old phrase). `false` is expected/benign for local-only
 * accounts (no cloud to push to).
 */
export async function applyRecoveryPhrase(
  recoveryPhrase: string,
  unlockPassword?: string
): Promise<boolean> {
  const recoveryData = await wrapFEKWithRecoveryPhrase(recoveryPhrase); // throws if no FEK
  const ipc = window.electron?.ipcRenderer;
  if (!ipc) return false;

  const existing = (await ipc.invoke('hybrid:loadWrappedKey')) as WrappedKeyData | null;
  if (!existing) return false;
  // Spread preserves the LOCAL-ONLY hw/alt wraps; only the recovery fields change.
  const next: WrappedKeyData = { ...existing, ...recoveryData };
  const prevDigest = await computeWrappedKeyDigest({
    wrappedFek: existing.wrappedFek,
    recoveryWrappedFek: existing.recoveryWrappedFek,
  });
  await ipc.invoke('hybrid:saveWrappedKey', next); // local-first
  let pushed = await pushWrappedKeyToCloud(next, prevDigest);
  if (!pushed) {
    // The eager 'initial' FEK push at onboarding may have failed transiently,
    // leaving the server with no row while local has the blob — our hex prevDigest
    // then 409s. Re-seed only when the server genuinely has no row (a real
    // conflict, i.e. a different server blob, must NOT be stomped).
    const server = await fetchWrappedKeyFromCloud();
    if (!server) pushed = await pushWrappedKeyToCloud(next, 'initial');
  }

  // Keep the keypair's recovery wrap in lockstep (E2-5). Non-fatal: the FEK is the
  // user's files; the keypair is for shared vaults (E3, not yet shipped).
  try {
    const { rotateKeypairRecoveryWrap } = await import('./userKeypairSync');
    await rotateKeypairRecoveryWrap(recoveryPhrase, unlockPassword);
  } catch (e) {
    console.warn(
      '[HybridCrypto] keypair recovery wrap (applyRecoveryPhrase) failed (non-fatal):',
      e
    );
  }
  return pushed;
}

/**
 * Recover access using the recovery phrase: unwrap FEK, then re-wrap with a new password.
 * Called when the user has forgotten their encryption password.
 */
export async function recoverWithPhrase(
  recoveryPhrase: string,
  newPassword: string
): Promise<WrappedKeyData> {
  if (!window.electron?.ipcRenderer) {
    throw new Error('Hybrid crypto requires Electron IPC');
  }

  const existingWrapped: WrappedKeyData | null =
    await window.electron.ipcRenderer.invoke('hybrid:loadWrappedKey');
  if (!existingWrapped?.recoveryWrappedFek || !existingWrapped?.recoverySalt) {
    throw new Error('No recovery data found — recovery phrase was not set up');
  }

  // Unwrap FEK with recovery phrase (normalized to match the wrap side + server)
  const recoverySalt = base64ToUint8(existingWrapped.recoverySalt);
  const recoveryKek = await deriveKEK(normalizeRecoveryPhrase(recoveryPhrase), recoverySalt);

  const packed = base64ToUint8(existingWrapped.recoveryWrappedFek);
  const iv = packed.slice(0, IV_LENGTH);
  const wrappedKeyBuffer = packed.slice(IV_LENGTH);

  const extractableFek = await crypto.subtle.unwrapKey(
    'raw',
    wrappedKeyBuffer,
    recoveryKek,
    { name: 'AES-GCM', iv },
    { name: 'AES-GCM', length: KEY_LENGTH },
    true,
    ['encrypt', 'decrypt']
  );

  // Now re-wrap with the new password
  const newSalt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const newKek = await deriveKEK(newPassword, newSalt);
  const newIv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));

  const newWrappedBuffer = await crypto.subtle.wrapKey('raw', extractableFek, newKek, {
    name: 'AES-GCM',
    iv: newIv,
  });

  const newPacked = new Uint8Array(IV_LENGTH + newWrappedBuffer.byteLength);
  newPacked.set(newIv, 0);
  newPacked.set(new Uint8Array(newWrappedBuffer), IV_LENGTH);

  // Store FEK in memory
  _fekRaw = await crypto.subtle.exportKey('raw', extractableFek);
  _fek = await crypto.subtle.importKey(
    'raw',
    _fekRaw,
    { name: 'AES-GCM', length: KEY_LENGTH },
    false,
    ['encrypt', 'decrypt']
  );
  pushSessionKeyToMain();

  // Re-wrap recovery as well (phrase stays the same but we need it in the new data)
  const recoveryData = await wrapFEKWithRecoveryPhrase(recoveryPhrase);

  const newWrappedData: WrappedKeyData = {
    wrappedFek: uint8ToBase64(newPacked),
    kekSalt: uint8ToBase64(newSalt),
    version: existingWrapped.version,
    recoveryWrappedFek: recoveryData.recoveryWrappedFek,
    recoverySalt: recoveryData.recoverySalt,
  };

  await window.electron.ipcRenderer.invoke('hybrid:saveWrappedKey', newWrappedData);
  const prevDigest = await computeWrappedKeyDigest({
    wrappedFek: existingWrapped.wrappedFek,
    recoveryWrappedFek: existingWrapped.recoveryWrappedFek,
  });
  await pushWrappedKeyToCloud(newWrappedData, prevDigest);

  // Persist FEK to safeStorage
  if (_fekRaw) {
    const rawBytes = Array.from(new Uint8Array(_fekRaw));
    await window.electron.ipcRenderer.invoke('hybrid:storeFEK', rawBytes);
  }

  // E2-5: the keypair follows the FEK through recovery — re-wrap the local
  // keypair under the new password from its recovery wrap and publish it.
  // Best-effort: a keypair issue must never block FEK (file) recovery.
  try {
    const { recoverKeypairFromLocalPhrase } = await import('./userKeypairSync');
    await recoverKeypairFromLocalPhrase(recoveryPhrase, newPassword);
  } catch (e) {
    console.warn('[HybridCrypto] keypair recovery (local) failed (non-fatal):', e);
  }

  return newWrappedData;
}

/**
 * Full cloud-account recovery via the recovery phrase.
 *
 * Fetches the server-side wrapped FEK (unauthenticated, gated by the phrase),
 * unwraps locally with the phrase-derived KEK, rewraps with the new password
 * AND rewraps the recovery copy with the same phrase (rotating salts/IVs),
 * then commits password hash + wrapped key + refresh-token invalidation in a
 * single server transaction. On success the FEK is loaded into memory and
 * the new wrapped blob is persisted locally so the subsequent login is
 * instant.
 *
 * Unlike `recoverWithPhrase` which only operates on the local device and
 * leaves `users.password_hash` out of sync, this function produces a fully
 * coherent cloud account state — the user can log in on any device afterward.
 */
export async function recoverCloudAccount(
  email: string,
  recoveryPhrase: string,
  newPassword: string
): Promise<void> {
  if (!window.electron?.ipcRenderer) {
    throw new Error('Cloud recovery requires Electron IPC');
  }

  // Step 1: verify the phrase with the server; receive the wrapped FEK blob
  // so we can unwrap locally (server cannot do it — no access to the phrase).
  const verifyResult = await window.electron.ipcRenderer.invoke(
    'auth:recoverPhraseVerify',
    email,
    recoveryPhrase
  );
  if (!verifyResult?.success || !verifyResult.data?.resetToken) {
    throw new Error(verifyResult?.error || 'Phrase verification failed');
  }
  const { resetToken, wrappedKey, userKey } = verifyResult.data;
  if (!wrappedKey?.recoveryWrappedFek || !wrappedKey?.recoverySalt) {
    throw new Error('Account has no recovery-wrapped FEK — cannot recover from phrase alone');
  }

  // Step 2: unwrap FEK with the phrase-derived KEK (normalized — see wrap side).
  const recoverySalt = base64ToUint8(wrappedKey.recoverySalt);
  const recoveryKek = await deriveKEK(normalizeRecoveryPhrase(recoveryPhrase), recoverySalt);
  const packed = base64ToUint8(wrappedKey.recoveryWrappedFek);
  const iv = packed.slice(0, IV_LENGTH);
  const wrappedBytes = packed.slice(IV_LENGTH);
  const extractableFek = await crypto.subtle.unwrapKey(
    'raw',
    wrappedBytes,
    recoveryKek,
    { name: 'AES-GCM', iv },
    { name: 'AES-GCM', length: KEY_LENGTH },
    true,
    ['encrypt', 'decrypt']
  );

  // Step 3: rewrap FEK with the new password.
  const newKekSalt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const newKek = await deriveKEK(newPassword, newKekSalt);
  const newIv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const newWrappedBuffer = await crypto.subtle.wrapKey('raw', extractableFek, newKek, {
    name: 'AES-GCM',
    iv: newIv,
  });
  const newPacked = new Uint8Array(IV_LENGTH + newWrappedBuffer.byteLength);
  newPacked.set(newIv, 0);
  newPacked.set(new Uint8Array(newWrappedBuffer), IV_LENGTH);

  // Step 4: rewrap the recovery copy with a fresh salt/IV so the blob on the
  // server rotates even though the phrase stays the same.
  const rotRecoverySalt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const rotRecoveryKek = await deriveKEK(normalizeRecoveryPhrase(recoveryPhrase), rotRecoverySalt);
  const rotRecoveryIv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const rotRecoveryBuffer = await crypto.subtle.wrapKey('raw', extractableFek, rotRecoveryKek, {
    name: 'AES-GCM',
    iv: rotRecoveryIv,
  });
  const rotRecoveryPacked = new Uint8Array(IV_LENGTH + rotRecoveryBuffer.byteLength);
  rotRecoveryPacked.set(rotRecoveryIv, 0);
  rotRecoveryPacked.set(new Uint8Array(rotRecoveryBuffer), IV_LENGTH);

  const newWrappedData: WrappedKeyData = {
    wrappedFek: uint8ToBase64(newPacked),
    kekSalt: uint8ToBase64(newKekSalt),
    version: wrappedKey.version,
    recoveryWrappedFek: uint8ToBase64(rotRecoveryPacked),
    recoverySalt: uint8ToBase64(rotRecoverySalt),
  };

  // Step 4b (E2-5): re-wrap the keypair under the new password from its recovery
  // wrap so it commits in the SAME atomic transaction as the FEK + password hash
  // (criterion: password_hash, wrapped_fek AND wrapped_private_key updated
  // together). buildRecoveredKeypair unwraps with the phrase, rewraps under the
  // new password, rotates the recovery copy, and loads the private keys into
  // memory. null for accounts with no recovery-wrapped keypair. Best-effort: a
  // keypair issue must not abort the user's file (FEK) recovery.
  let recoveredKeypair: import('./userKeypairSync').StoredKeypair | undefined;
  try {
    const { buildRecoveredKeypair } = await import('./userKeypairSync');
    const kp = await buildRecoveredKeypair(recoveryPhrase, newPassword, userKey ?? null);
    if (kp) recoveredKeypair = kp;
  } catch (e) {
    console.warn('[HybridCrypto] keypair recovery build failed (non-fatal):', e);
  }

  // Step 5: commit on the server atomically — password hash, wrapped key,
  // re-wrapped keypair, refresh token wipe. The user must log in afresh with the
  // new password.
  const completeResult = await window.electron.ipcRenderer.invoke('auth:recoverComplete', {
    resetToken,
    newPassword,
    wrappedFek: newWrappedData.wrappedFek,
    kekSalt: newWrappedData.kekSalt,
    version: newWrappedData.version,
    recoveryWrappedFek: newWrappedData.recoveryWrappedFek,
    recoverySalt: newWrappedData.recoverySalt,
    userKey: recoveredKeypair,
  });
  if (!completeResult?.success) {
    throw new Error(completeResult?.error || 'Recovery commit failed');
  }

  // Step 6: persist locally and load FEK into memory so the next login is
  // instant (no round-trip to fetch the blob we just pushed).
  await window.electron.ipcRenderer.invoke('hybrid:saveWrappedKey', newWrappedData);
  if (recoveredKeypair) {
    await window.electron.ipcRenderer.invoke('keypair:saveLocal', recoveredKeypair);
  }
  _fekRaw = await crypto.subtle.exportKey('raw', extractableFek);
  _fek = await crypto.subtle.importKey(
    'raw',
    _fekRaw,
    { name: 'AES-GCM', length: KEY_LENGTH },
    false,
    ['encrypt', 'decrypt']
  );
  pushSessionKeyToMain();
  if (_fekRaw) {
    const rawBytes = Array.from(new Uint8Array(_fekRaw));
    await window.electron.ipcRenderer.invoke('hybrid:storeFEK', rawBytes);
  }
}

// ==================== Hardware Security Key (WebAuthn PRF) — feature #7 ====================
//
// A hardware authenticator (YubiKey, Windows Hello, Touch ID via passkey) that
// supports the WebAuthn PRF / hmac-secret extension can produce a stable, secret
// 32-byte output for a fixed salt. We run that output through HKDF to derive a
// KEK and wrap the SAME FEK with it — an independent unlock path that sits
// alongside the password and recovery-phrase wraps.
//
// The browser-side WebAuthn dance (navigator.credentials.create/get) lives in
// `src/services/auth/hardwareKey.ts`; this module only handles the key crypto so
// the FEK never leaves hybridCrypto and the non-extractable invariant holds.
//
// Persistence is LOCAL-ONLY (see WrappedKeyData doc above): a hardware key is
// physically tied to one device, so the wrap is never pushed to the cloud and
// never folded into computeWrappedKeyDigest().

/** Domain-separation label for the HKDF that turns a PRF output into a wrap key. */
const HKDF_INFO_HWKEY = 'filarr.hwkey.wrap.v1';

/**
 * Derive an AES-GCM KEK from a WebAuthn PRF output via HKDF-SHA-256.
 * The same (prfOutput, salt) pair must be reproduced at unlock to recover the KEK.
 */
async function deriveKEKFromPrf(prfOutput: Uint8Array, salt: Uint8Array): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey('raw', prfOutput as BufferSource, 'HKDF', false, [
    'deriveKey',
  ]);
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: salt as BufferSource,
      info: new TextEncoder().encode(HKDF_INFO_HWKEY),
    },
    baseKey,
    { name: 'AES-GCM', length: KEY_LENGTH },
    false,
    // wrapKey/unwrapKey for the FEK CryptoKey; encrypt/decrypt for the keypair's
    // raw private-key bytes (E2-9). Same KEK, same salt — one derivation per path.
    ['wrapKey', 'unwrapKey', 'encrypt', 'decrypt']
  );
}

/**
 * Attach a hardware key to the current vault. Requires the FEK to be unlocked
 * already (the user proves possession of the password/PIN first, then enrolls).
 *
 * The caller (hardwareKey.ts) generates `salt`, feeds it to the authenticator's
 * PRF extension to obtain `prfOutput`, and passes both here along with the
 * credential id. Returns the updated wrapped-key blob (already persisted locally).
 */
export async function enrollHardwareKey(
  prfOutput: Uint8Array,
  credentialId: string,
  salt: Uint8Array
): Promise<WrappedKeyData> {
  if (!window.electron?.ipcRenderer) {
    throw new Error('Hardware key enrollment requires Electron IPC');
  }
  if (!_fekRaw) {
    throw new Error('No FEK in memory — unlock the vault before enrolling a hardware key');
  }

  // Re-import the FEK as extractable just long enough to wrap it.
  const extractableFek = await crypto.subtle.importKey(
    'raw',
    _fekRaw,
    { name: 'AES-GCM', length: KEY_LENGTH },
    true,
    ['encrypt', 'decrypt']
  );

  const kek = await deriveKEKFromPrf(prfOutput, salt);
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const wrappedBuffer = await crypto.subtle.wrapKey('raw', extractableFek, kek, {
    name: 'AES-GCM',
    iv,
  });

  const packed = new Uint8Array(IV_LENGTH + wrappedBuffer.byteLength);
  packed.set(iv, 0);
  packed.set(new Uint8Array(wrappedBuffer), IV_LENGTH);

  const existing: WrappedKeyData | null =
    await window.electron.ipcRenderer.invoke('hybrid:loadWrappedKey');
  if (!existing) {
    throw new Error('No wrapped FEK on disk — cannot attach a hardware key');
  }

  const updated: WrappedKeyData = {
    ...existing,
    hwWrappedFek: uint8ToBase64(packed),
    hwSalt: uint8ToBase64(salt),
    hwCredentialId: credentialId,
  };
  // LOCAL-ONLY: persist to disk, never push to cloud.
  await window.electron.ipcRenderer.invoke('hybrid:saveWrappedKey', updated);

  // E2-9: wrap the keypair under the SAME PRF KEK so it follows the FEK onto the
  // hardware key (LOCAL-ONLY, stored in the keypair blob). Best-effort — a keypair
  // hiccup must never block FEK hardware enrollment.
  try {
    const { wrapKeypairUnderHardwareKey } = await import('./userKeypairSync');
    await wrapKeypairUnderHardwareKey(kek, uint8ToBase64(salt), credentialId);
  } catch (e) {
    console.warn('[HybridCrypto] keypair hardware-key wrap failed (non-fatal):', e);
  }

  return updated;
}

/**
 * Unlock the vault using a hardware key. The caller reproduces the PRF output
 * for the stored salt (via navigator.credentials.get) and passes it here.
 * Loads the FEK into memory + safeStorage exactly like the password path.
 */
export async function initFromHardwareKey(prfOutput: Uint8Array): Promise<void> {
  if (!window.electron?.ipcRenderer) {
    throw new Error('Hardware key unlock requires Electron IPC');
  }
  const wrapped: WrappedKeyData | null =
    await window.electron.ipcRenderer.invoke('hybrid:loadWrappedKey');
  if (!wrapped?.hwWrappedFek || !wrapped?.hwSalt) {
    throw new Error('No hardware-key-wrapped FEK found on this device');
  }

  const salt = base64ToUint8(wrapped.hwSalt);
  const kek = await deriveKEKFromPrf(prfOutput, salt);
  const packed = base64ToUint8(wrapped.hwWrappedFek);
  const iv = packed.slice(0, IV_LENGTH);
  const wrappedKeyBuffer = packed.slice(IV_LENGTH);

  const extractableFek = await crypto.subtle.unwrapKey(
    'raw',
    wrappedKeyBuffer,
    kek,
    { name: 'AES-GCM', iv },
    { name: 'AES-GCM', length: KEY_LENGTH },
    true,
    ['encrypt', 'decrypt']
  );

  _fekRaw = await crypto.subtle.exportKey('raw', extractableFek);
  _fek = await crypto.subtle.importKey(
    'raw',
    _fekRaw,
    { name: 'AES-GCM', length: KEY_LENGTH },
    false,
    ['encrypt', 'decrypt']
  );
  pushSessionKeyToMain();

  const rawBytes = Array.from(new Uint8Array(_fekRaw));
  await window.electron.ipcRenderer.invoke('hybrid:storeFEK', rawBytes);

  // E2-9: unwrap the keypair via the SAME PRF KEK (the keypair shares the FEK's hw
  // salt) and load it into memory — no password. Best-effort: the hardware-key
  // unlock of the FEK must still succeed even if the keypair half can't load.
  try {
    const { unwrapKeypairFromHardwareKey } = await import('./userKeypairSync');
    await unwrapKeypairFromHardwareKey(kek);
  } catch (e) {
    console.warn('[HybridCrypto] keypair hardware-key unwrap failed (non-fatal):', e);
  }
}

// ── Device-bound key (E5-4): SSO unlock without a password ────────────────────
//
// After an SSO login the IdP has federated the SESSION but the app has no FEK.
// We unlock it from a random 256-bit DEVICE key in the OS keychain (safeStorage,
// `.device_key_safe`) + a wrap of the SAME FEK under a KEK HKDF-derived from it.
// The device key never leaves the machine and is never derived from the IdP/server,
// preserving zero-knowledge. Enrolment happens once, after a normal (password/PIN)
// unlock. Like the hardware-key wrap, this is LOCAL-ONLY: never pushed to the cloud,
// never folded into computeWrappedKeyDigest(). Device-theft tradeoff disclosed (E5-8).

const HKDF_INFO_DEVICEKEY = 'filarr.devicekey.wrap.v1';

/** Derive an AES-GCM KEK from the raw device key via HKDF-SHA-256 (domain-separated). */
async function deriveKEKFromDeviceKey(deviceKey: Uint8Array, salt: Uint8Array): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey('raw', deviceKey as BufferSource, 'HKDF', false, [
    'deriveKey',
  ]);
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: salt as BufferSource,
      info: new TextEncoder().encode(HKDF_INFO_DEVICEKEY),
    },
    baseKey,
    { name: 'AES-GCM', length: KEY_LENGTH },
    false,
    ['wrapKey', 'unwrapKey']
  );
}

/**
 * Enrol this device for password-less SSO unlock. Requires the FEK in memory (the
 * user just proved possession via password/PIN/hardware key). Generates a random
 * device key, stores it in the OS keychain, and writes a wrap of the FEK under it.
 * LOCAL-ONLY (never pushed to cloud). Idempotent-ish: re-enrolling rotates the key.
 */
export async function enrollDeviceKey(): Promise<WrappedKeyData> {
  if (!window.electron?.ipcRenderer) {
    throw new Error('Device-key enrollment requires Electron IPC');
  }
  if (!_fekRaw) {
    throw new Error('No FEK in memory — unlock the vault before enrolling the device key');
  }
  const existing: WrappedKeyData | null =
    await window.electron.ipcRenderer.invoke('hybrid:loadWrappedKey');
  if (!existing) {
    throw new Error('No wrapped FEK on disk — cannot enrol the device key');
  }

  const deviceKey = crypto.getRandomValues(new Uint8Array(32));
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  try {
    // Persist the device key in the OS keychain FIRST; refuse if safeStorage is
    // unavailable (the IPC throws → we surface it) so we never write a wrap whose
    // key we can't store.
    const stored: boolean = await window.electron.ipcRenderer.invoke(
      'hybrid:storeDeviceKey',
      Array.from(deviceKey)
    );
    if (!stored) throw new Error('Could not store the device key in the OS keychain');

    const extractableFek = await crypto.subtle.importKey(
      'raw',
      _fekRaw,
      { name: 'AES-GCM', length: KEY_LENGTH },
      true,
      ['encrypt', 'decrypt']
    );
    const kek = await deriveKEKFromDeviceKey(deviceKey, salt);
    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
    const wrappedBuffer = await crypto.subtle.wrapKey('raw', extractableFek, kek, {
      name: 'AES-GCM',
      iv,
    });
    const packed = new Uint8Array(IV_LENGTH + wrappedBuffer.byteLength);
    packed.set(iv, 0);
    packed.set(new Uint8Array(wrappedBuffer), IV_LENGTH);

    const updated: WrappedKeyData = {
      ...existing,
      deviceWrappedFek: uint8ToBase64(packed),
      deviceSalt: uint8ToBase64(salt),
      deviceKeyId: uint8ToBase64(crypto.getRandomValues(new Uint8Array(8))),
    };
    await window.electron.ipcRenderer.invoke('hybrid:saveWrappedKey', updated); // LOCAL-ONLY
    return updated;
  } finally {
    deviceKey.fill(0);
  }
}

/**
 * Unlock the FEK from the device key (E5-4) — the password-less path used after an
 * SSO login. Loads the device key from the OS keychain, derives the KEK, unwraps the
 * FEK into memory + the safeStorage cache. Throws if this device isn't enrolled.
 */
export async function initFromDeviceKey(): Promise<void> {
  if (!window.electron?.ipcRenderer) {
    throw new Error('Device-key unlock requires Electron IPC');
  }
  const wrapped: WrappedKeyData | null =
    await window.electron.ipcRenderer.invoke('hybrid:loadWrappedKey');
  if (!wrapped?.deviceWrappedFek || !wrapped?.deviceSalt) {
    throw new Error('No device-key-wrapped FEK on this device');
  }
  const rawKey: number[] | null = await window.electron.ipcRenderer.invoke('hybrid:loadDeviceKey');
  if (!rawKey || rawKey.length === 0) {
    throw new Error('Device key not found in the OS keychain (re-enrolment needed)');
  }
  const deviceKey = new Uint8Array(rawKey);
  try {
    const salt = base64ToUint8(wrapped.deviceSalt);
    const kek = await deriveKEKFromDeviceKey(deviceKey, salt);
    const packed = base64ToUint8(wrapped.deviceWrappedFek);
    const iv = packed.slice(0, IV_LENGTH);
    const wrappedKeyBuffer = packed.slice(IV_LENGTH);
    const extractableFek = await crypto.subtle.unwrapKey(
      'raw',
      wrappedKeyBuffer,
      kek,
      { name: 'AES-GCM', iv },
      { name: 'AES-GCM', length: KEY_LENGTH },
      true,
      ['encrypt', 'decrypt']
    );
    _fekRaw = await crypto.subtle.exportKey('raw', extractableFek);
    _fek = await crypto.subtle.importKey(
      'raw',
      _fekRaw,
      { name: 'AES-GCM', length: KEY_LENGTH },
      false,
      ['encrypt', 'decrypt']
    );
    pushSessionKeyToMain();
    await window.electron.ipcRenderer.invoke(
      'hybrid:storeFEK',
      Array.from(new Uint8Array(_fekRaw))
    );
  } finally {
    deviceKey.fill(0);
  }
}

/**
 * Lock-screen probe (no FEK needed): is this device enrolled for password-less SSO
 * unlock? True only if BOTH the on-disk wrap AND the keychain device key are present.
 */
export async function hasDeviceKeyWrap(): Promise<boolean> {
  if (!window.electron?.ipcRenderer) return false;
  try {
    const wrapped: WrappedKeyData | null =
      await window.electron.ipcRenderer.invoke('hybrid:loadWrappedKey');
    if (!wrapped?.deviceWrappedFek || !wrapped?.deviceSalt) return false;
    const rawKey: number[] | null =
      await window.electron.ipcRenderer.invoke('hybrid:loadDeviceKey');
    return !!rawKey && rawKey.length > 0;
  } catch {
    return false;
  }
}

/**
 * Remove this device's enrollment (E5-7 deprovision / "forget this device"): wipe the
 * keychain device key and strip the wrap fields from the on-disk blob. Idempotent.
 */
export async function clearDeviceKeyEnrollment(): Promise<void> {
  if (!window.electron?.ipcRenderer) return;
  try {
    await window.electron.ipcRenderer.invoke('hybrid:clearDeviceKey');
    const wrapped: WrappedKeyData | null =
      await window.electron.ipcRenderer.invoke('hybrid:loadWrappedKey');
    if (wrapped?.deviceWrappedFek) {
      const { deviceWrappedFek: _d, deviceSalt: _s, deviceKeyId: _i, ...rest } = wrapped;
      await window.electron.ipcRenderer.invoke('hybrid:saveWrappedKey', rest as WrappedKeyData);
    }
  } catch (e) {
    console.warn('[HybridCrypto] clearDeviceKeyEnrollment failed (non-fatal):', e);
  }
}

/**
 * Lightweight read of the hardware-key state on this device, safe to call on the
 * lock screen before the FEK is available. Returns the credential id + salt so
 * the caller can target the right authenticator with navigator.credentials.get.
 */
export async function getHardwareKeyInfo(): Promise<{
  enrolled: boolean;
  credentialId?: string;
  salt?: string;
}> {
  if (!window.electron?.ipcRenderer) return { enrolled: false };
  try {
    const wrapped: WrappedKeyData | null =
      await window.electron.ipcRenderer.invoke('hybrid:loadWrappedKey');
    if (wrapped?.hwWrappedFek && wrapped?.hwSalt && wrapped?.hwCredentialId) {
      return { enrolled: true, credentialId: wrapped.hwCredentialId, salt: wrapped.hwSalt };
    }
  } catch {
    /* fall through to not-enrolled */
  }
  return { enrolled: false };
}

/**
 * Detach the hardware key from this vault (strips the hw-* fields from the local
 * wrapped-key blob). The password and recovery phrase are untouched.
 */
export async function removeHardwareKey(): Promise<void> {
  if (!window.electron?.ipcRenderer) {
    throw new Error('Hardware key removal requires Electron IPC');
  }
  const wrapped: WrappedKeyData | null =
    await window.electron.ipcRenderer.invoke('hybrid:loadWrappedKey');
  if (!wrapped) return;
  // Drop the hw-* fields; keep everything else (password + recovery wraps).
  const { hwWrappedFek: _h, hwSalt: _s, hwCredentialId: _c, ...rest } = wrapped;
  void _h;
  void _s;
  void _c;
  await window.electron.ipcRenderer.invoke('hybrid:saveWrappedKey', rest as WrappedKeyData);

  // E2-9: mirror on the keypair — strip its stale hardware wrap too, so the keypair
  // blob doesn't keep advertising a removed authenticator. Best-effort.
  try {
    const { stripKeypairHardwareWrap } = await import('./userKeypairSync');
    await stripKeypairHardwareWrap();
  } catch (e) {
    console.warn('[HybridCrypto] keypair hardware-wrap strip failed (non-fatal):', e);
  }
}

// ==================== Hidden Vault / Decoy Mode — feature #6 ====================
//
// Two passwords on the same profile: the REAL password unwraps the real FEK and
// keeps the user on this profile; the DURESS password unwraps an INDEPENDENT
// decoy FEK and the caller then switches the app to the hidden profile
// `altProfileId` (its own bland files, encrypted under the decoy FEK).
//
// Safety contract: the decoy branch is INERT unless `altWrappedFek` is present.
// With no hidden vault configured, `tryUnlockDualVault` is exactly the normal
// single-password unlock. The decoy wrap is local-only (never pushed to cloud,
// excluded from the digest), so the existing sync/compare-and-set is untouched.
//
// Honest limitation (documented to users): plausible deniability is WEAK — total
// vault size, sync timing and usage patterns can still hint that a second vault
// exists. This is decoy-on-coercion convenience, not a cryptographic guarantee.

/** Generic unwrap of an `IV || wrappedKey` blob with a password-derived KEK. */
async function unwrapFekBlob(
  password: string,
  packedB64: string,
  saltB64: string
): Promise<CryptoKey> {
  const salt = base64ToUint8(saltB64);
  const kek = await deriveKEK(password, salt);
  const packed = base64ToUint8(packedB64);
  const iv = packed.slice(0, IV_LENGTH);
  const wrappedKeyBuffer = packed.slice(IV_LENGTH);
  return crypto.subtle.unwrapKey(
    'raw',
    wrappedKeyBuffer,
    kek,
    { name: 'AES-GCM', iv },
    { name: 'AES-GCM', length: KEY_LENGTH },
    true, // extractable — needed for safeStorage export
    ['encrypt', 'decrypt']
  );
}

/**
 * Install an unwrapped (extractable) FEK into module memory, optionally
 * persisting to the OS keychain. Persistence is skipped on the decoy branch:
 * `hybrid:storeFEK` writes into the ACTIVE profile's dir, and at unlock time
 * that is still the REAL profile — persisting the decoy FEK there would poison
 * the real profile's cached key. The caller persists explicitly AFTER
 * switching profiles via persistFekToSafeStorage().
 */
async function installExtractableFek(
  extractableFek: CryptoKey,
  options?: { persist?: boolean }
): Promise<void> {
  _fekRaw = await crypto.subtle.exportKey('raw', extractableFek);
  _fek = await crypto.subtle.importKey(
    'raw',
    _fekRaw,
    { name: 'AES-GCM', length: KEY_LENGTH },
    false,
    ['encrypt', 'decrypt']
  );
  pushSessionKeyToMain();
  if (options?.persist !== false && window.electron?.ipcRenderer && _fekRaw) {
    const rawBytes = Array.from(new Uint8Array(_fekRaw));
    await window.electron.ipcRenderer.invoke('hybrid:storeFEK', rawBytes);
  }
}

/**
 * Persist the in-memory FEK to the OS keychain of the CURRENTLY ACTIVE
 * profile. Used by the decoy unlock flow after `profile:activate` has switched
 * the base dir to the decoy profile.
 */
export async function persistFekToSafeStorage(): Promise<void> {
  if (!window.electron?.ipcRenderer || !_fekRaw) return;
  const rawBytes = Array.from(new Uint8Array(_fekRaw));
  await window.electron.ipcRenderer.invoke('hybrid:storeFEK', rawBytes);
}

/** Wrap an extractable key with a password-derived KEK → base64(IV || wrapped). */
async function wrapKeyWithPassword(
  key: CryptoKey,
  password: string
): Promise<{ wrapped: string; salt: string }> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const kek = await deriveKEK(password, salt);
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const wrappedBuffer = await crypto.subtle.wrapKey('raw', key, kek, { name: 'AES-GCM', iv });
  const packed = new Uint8Array(IV_LENGTH + wrappedBuffer.byteLength);
  packed.set(iv, 0);
  packed.set(new Uint8Array(wrappedBuffer), IV_LENGTH);
  return { wrapped: uint8ToBase64(packed), salt: uint8ToBase64(salt) };
}

/**
 * Attach a hidden decoy vault to the current profile. The caller must have the
 * real vault unlocked (proves ownership) and must pass a duress password that
 * differs from the real one (enforced in the UI). Generates a brand-new decoy
 * FEK — never the real one — then:
 *   1. writes the alt* fields into the REAL profile's wrapped blob (so the
 *      lock screen's try-both unlock can detect the duress password), and
 *   2. seeds the DECOY profile's own wrapped_fek.json via IPC (so once
 *      switched, the decoy profile unlocks with the duress password like any
 *      normal profile).
 * Both writes are local-only; key material never leaves this module.
 */
export async function setupDecoyVault(
  duressPassword: string,
  decoyProfileId: string
): Promise<void> {
  if (!window.electron?.ipcRenderer) {
    throw new Error('Decoy vault setup requires Electron IPC');
  }
  if (!_fekRaw) {
    throw new Error('Unlock the real vault before configuring a hidden vault');
  }

  const existing: WrappedKeyData | null =
    await window.electron.ipcRenderer.invoke('hybrid:loadWrappedKey');
  if (!existing) {
    throw new Error('No wrapped FEK on disk — cannot configure a hidden vault');
  }

  // Guard: the duress password must NOT unlock the real vault, or the decoy
  // branch could never be reached and the user would believe a protection
  // exists that doesn't. One PBKDF2 derivation — acceptable in a setup flow.
  let duressUnlocksReal = false;
  try {
    await unwrapFekBlob(duressPassword, existing.wrappedFek, existing.kekSalt);
    duressUnlocksReal = true;
  } catch {
    // GCM auth failure = the passwords differ — exactly what we want.
  }
  if (duressUnlocksReal) {
    throw new Error('The duress password must be different from your vault password');
  }

  // INDEPENDENT decoy FEK. This is the crux of #6: the duress password must
  // never be able to reach the real files, so it gets its own key domain.
  const decoyFek = await crypto.subtle.generateKey({ name: 'AES-GCM', length: KEY_LENGTH }, true, [
    'encrypt',
    'decrypt',
  ]);

  // Two independent wraps of the same decoy FEK (fresh salt/IV each): one for
  // the real profile's alt* fields, one to seed the decoy profile's own blob.
  const altWrap = await wrapKeyWithPassword(decoyFek, duressPassword);
  const seedWrap = await wrapKeyWithPassword(decoyFek, duressPassword);

  const updated: WrappedKeyData = {
    ...existing,
    altWrappedFek: altWrap.wrapped,
    altKekSalt: altWrap.salt,
    altProfileId: decoyProfileId,
  };
  await window.electron.ipcRenderer.invoke('hybrid:saveWrappedKey', updated); // LOCAL-ONLY

  const decoySeed: WrappedKeyData = {
    wrappedFek: seedWrap.wrapped,
    kekSalt: seedWrap.salt,
    version: 1,
  };

  // E2-9 deniability: the decoy profile gets its OWN INDEPENDENT keypair under the
  // duress password — NEVER a wrap of the real private key. Generated detached so
  // the real keypair stays loaded in memory here on the real profile. Seeded into
  // the decoy profile so that, once switched, it unlocks like any normal profile.
  let decoyKeypair: import('./userKeypairSync').StoredKeypair | undefined;
  try {
    const { generateDetachedKeypairBlob } = await import('./userKeypairSync');
    decoyKeypair = await generateDetachedKeypairBlob(duressPassword);
  } catch (e) {
    console.warn('[HybridCrypto] decoy keypair generation failed (non-fatal):', e);
  }

  await window.electron.ipcRenderer.invoke('hidden-vault:seedDecoy', {
    profileId: decoyProfileId,
    wrappedKeyData: decoySeed,
    keypairData: decoyKeypair,
  });
}

/**
 * Unlock attempt that transparently supports a hidden vault. Tries the real
 * password first, then — only if a decoy is configured — the duress password,
 * running both unwraps so the matched branch doesn't leak via timing. Installs
 * whichever FEK matched and returns which vault it was so the caller can switch
 * to `altProfileId` on a 'decoy' result.
 *
 * Returns null if neither password matched (wrong password).
 */
export async function tryUnlockDualVault(password: string): Promise<VaultUnlockMatch> {
  if (!window.electron?.ipcRenderer) {
    throw new Error('Vault unlock requires Electron IPC');
  }
  const wrapped: WrappedKeyData | null =
    await window.electron.ipcRenderer.invoke('hybrid:loadWrappedKey');
  if (!wrapped) {
    throw new Error('No wrapped FEK found — cannot unlock');
  }

  let realFek: CryptoKey | null = null;
  let decoyFek: CryptoKey | null = null;

  try {
    realFek = await unwrapFekBlob(password, wrapped.wrappedFek, wrapped.kekSalt);
  } catch {
    realFek = null;
  }

  // Decoy branch is inert unless explicitly configured.
  if (wrapped.altWrappedFek && wrapped.altKekSalt) {
    try {
      decoyFek = await unwrapFekBlob(password, wrapped.altWrappedFek, wrapped.altKekSalt);
    } catch {
      decoyFek = null;
    }
  }

  if (realFek) {
    await installExtractableFek(realFek);
    return 'real';
  }
  if (decoyFek) {
    // In-memory only: the active profile is still the REAL one here, so a
    // safeStorage write would land in the wrong profile dir. The caller
    // switches to altProfileId first, then calls persistFekToSafeStorage().
    await installExtractableFek(decoyFek, { persist: false });
    // E2-9 deniability: the duress password must NOT leave the real asymmetric
    // identity in memory. Drop any loaded real keypair. The decoy profile has its
    // OWN seeded keypair blob (user_keypair.json under the duress password); after
    // the caller's profile switch + reload it loads LAZILY (ensureUserKeypair, or
    // the next full password unlock) — the reload restores only the FEK from
    // safeStorage, so no keypair is eagerly loaded here.
    try {
      const { clearUserKeypairMemory } = await import('./userKeypairSync');
      clearUserKeypairMemory();
    } catch {
      /* non-fatal */
    }
    // E3-3: K_vault cached from a prior REAL session is an equally sensitive
    // real-identity secret (it decrypts vault content). Scrub it on the duress
    // branch too, consistently with the keypair purge above — defence in depth so
    // a decoy session never runs on top of resident real vault keys.
    clearVaultKeys();
    return 'decoy';
  }
  return null;
}

/** Whether a hidden vault is configured on this device, and its decoy profile id. */
export async function getDecoyVaultInfo(): Promise<{ enabled: boolean; altProfileId?: string }> {
  if (!window.electron?.ipcRenderer) return { enabled: false };
  try {
    const wrapped: WrappedKeyData | null =
      await window.electron.ipcRenderer.invoke('hybrid:loadWrappedKey');
    if (wrapped?.altWrappedFek && wrapped?.altKekSalt && wrapped?.altProfileId) {
      return { enabled: true, altProfileId: wrapped.altProfileId };
    }
  } catch {
    /* fall through */
  }
  return { enabled: false };
}

/** Remove the hidden vault wrap from this profile (does not delete decoy files). */
export async function removeDecoyVault(): Promise<void> {
  if (!window.electron?.ipcRenderer) {
    throw new Error('Decoy vault removal requires Electron IPC');
  }
  const wrapped: WrappedKeyData | null =
    await window.electron.ipcRenderer.invoke('hybrid:loadWrappedKey');
  if (!wrapped) return;
  const { altWrappedFek: _a, altKekSalt: _ak, altProfileId: _ap, ...rest } = wrapped;
  void _a;
  void _ak;
  void _ap;
  await window.electron.ipcRenderer.invoke('hybrid:saveWrappedKey', rest as WrappedKeyData);
}

// --- Helpers ---

function uint8ToBase64(data: Uint8Array): string {
  // Chunked conversion to avoid stack overflow on large buffers
  const CHUNK = 8192;
  let binary = '';
  for (let i = 0; i < data.length; i += CHUNK) {
    const chunk = data.subarray(i, i + CHUNK);
    binary += String.fromCharCode.apply(null, chunk as unknown as number[]);
  }
  return btoa(binary);
}

function base64ToUint8(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}
