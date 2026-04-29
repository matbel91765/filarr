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

const PBKDF2_ITERATIONS = 600_000;
const KEY_LENGTH = 256; // bits
const IV_LENGTH = 12; // bytes — GCM recommended
const SALT_LENGTH = 16; // bytes — for KEK derivation

export interface WrappedKeyData {
  wrappedFek: string; // base64(IV || wrappedKey)
  kekSalt: string; // base64(salt)
  version: number;
  /** FEK wrapped with a key derived from the recovery phrase (optional) */
  recoveryWrappedFek?: string; // base64(IV || wrappedKey)
  recoverySalt?: string; // base64(salt)
}

// Module-level state — lives in memory only
let _fek: CryptoKey | null = null;
let _fekRaw: ArrayBuffer | null = null; // raw key bytes for safeStorage export

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
    const result = await window.electron.ipcRenderer.invoke('hybrid:pushWrappedKeyToCloud', {
      ...data,
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
 * blob so future new-device logins can skip the pairing flow. No-op once the
 * server has any row — we do a GET first to avoid overwriting on every launch.
 */
async function backfillWrappedKeyToCloudIfMissing(data: WrappedKeyData): Promise<void> {
  const existing = await fetchWrappedKeyFromCloud();
  if (existing) return;
  // Server has none → explicit 'initial' digest skips the redundant fetch.
  await pushWrappedKeyToCloud(data, 'initial');
  if (process.env.NODE_ENV === 'development') {
    console.log('[HybridCrypto] backfilled wrappedKey to server');
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
}

/**
 * Encrypt file content with the FEK (AES-256-GCM, random IV).
 * Returns: IV(12) || ciphertext || tag(16)
 */
export async function encryptFileContent(plaintext: ArrayBuffer): Promise<Uint8Array> {
  if (!_fek) {
    throw new Error('Hybrid crypto not initialized — call initHybridCrypto first');
  }

  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, _fek, plaintext);

  // Pack: IV(12) || ciphertext+tag
  const result = new Uint8Array(IV_LENGTH + ciphertext.byteLength);
  result.set(iv, 0);
  result.set(new Uint8Array(ciphertext), IV_LENGTH);
  return result;
}

/**
 * Decrypt file content with the FEK.
 * Input format: IV(12) || ciphertext || tag(16)
 */
export async function decryptFileContent(encrypted: Uint8Array): Promise<ArrayBuffer> {
  if (!_fek) {
    throw new Error('Hybrid crypto not initialized — call initHybridCrypto first');
  }

  const iv = encrypted.slice(0, IV_LENGTH);
  const ciphertext = encrypted.slice(IV_LENGTH);

  return crypto.subtle.decrypt({ name: 'AES-GCM', iv }, _fek, ciphertext);
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

  const newWrappedData: WrappedKeyData = {
    wrappedFek: uint8ToBase64(newPacked),
    kekSalt: uint8ToBase64(newSalt),
    version: existingWrapped.version,
  };

  // Save locally + push updated ciphertext to server. The digest is derived
  // from what we just unwrapped — the server will 409 if a concurrent
  // rewrap has happened on another device since we loaded this blob.
  await window.electron.ipcRenderer.invoke('hybrid:saveWrappedKey', newWrappedData);
  const prevDigest = await computeWrappedKeyDigest({
    wrappedFek: existingWrapped.wrappedFek,
    recoveryWrappedFek: existingWrapped.recoveryWrappedFek,
  });
  await pushWrappedKeyToCloud(newWrappedData, prevDigest);

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
 */
export async function exportFEKRaw(): Promise<Uint8Array | null> {
  if (!_fek) return null;

  // We need an extractable copy to export — re-import as extractable temporarily
  // Since _fek is non-extractable, we can't export directly.
  // Instead, we'll use a workaround: encrypt a known plaintext and store the
  // wrapped FEK from the persisted wrapped_fek.json instead.
  // Actually, the simplest approach: at init time, keep a copy of the raw bytes.
  return _fekRaw ? new Uint8Array(_fekRaw) : null;
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
}

/**
 * Clear the FEK from memory (on logout / disconnect).
 */
export function clearHybridCrypto(): void {
  _fek = null;
  _fekRaw = null;
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
  const kek = await deriveKEK(recoveryPhrase, salt);
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

  // Unwrap FEK with recovery phrase
  const recoverySalt = base64ToUint8(existingWrapped.recoverySalt);
  const recoveryKek = await deriveKEK(recoveryPhrase, recoverySalt);

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
  const { resetToken, wrappedKey } = verifyResult.data;
  if (!wrappedKey?.recoveryWrappedFek || !wrappedKey?.recoverySalt) {
    throw new Error('Account has no recovery-wrapped FEK — cannot recover from phrase alone');
  }

  // Step 2: unwrap FEK with the phrase-derived KEK.
  const recoverySalt = base64ToUint8(wrappedKey.recoverySalt);
  const recoveryKek = await deriveKEK(recoveryPhrase, recoverySalt);
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
  const rotRecoveryKek = await deriveKEK(recoveryPhrase, rotRecoverySalt);
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

  // Step 5: commit on the server atomically — password hash, wrapped key,
  // refresh token wipe. The user must log in afresh with the new password.
  const completeResult = await window.electron.ipcRenderer.invoke('auth:recoverComplete', {
    resetToken,
    newPassword,
    wrappedFek: newWrappedData.wrappedFek,
    kekSalt: newWrappedData.kekSalt,
    version: newWrappedData.version,
    recoveryWrappedFek: newWrappedData.recoveryWrappedFek,
    recoverySalt: newWrappedData.recoverySalt,
  });
  if (!completeResult?.success) {
    throw new Error(completeResult?.error || 'Recovery commit failed');
  }

  // Step 6: persist locally and load FEK into memory so the next login is
  // instant (no round-trip to fetch the blob we just pushed).
  await window.electron.ipcRenderer.invoke('hybrid:saveWrappedKey', newWrappedData);
  _fekRaw = await crypto.subtle.exportKey('raw', extractableFek);
  _fek = await crypto.subtle.importKey(
    'raw',
    _fekRaw,
    { name: 'AES-GCM', length: KEY_LENGTH },
    false,
    ['encrypt', 'decrypt']
  );
  if (_fekRaw) {
    const rawBytes = Array.from(new Uint8Array(_fekRaw));
    await window.electron.ipcRenderer.invoke('hybrid:storeFEK', rawBytes);
  }
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
