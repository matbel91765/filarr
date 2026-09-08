/**
 * File Password Service
 *
 * Service for managing password protection on files and folders.
 * Uses bcrypt for password hashing and localStorage for persistence.
 *
 * Features:
 * - Set/remove password protection on files/folders
 * - Verify passwords
 * - Session-based unlock management
 * - Password strength evaluation
 */

import { isWebPlatform } from '../platform/isWebPlatform';

/**
 * bcrypt lives in the MAIN process (Node) : the renderer reaches it over IPC.
 *
 * On app.filarr.com `window.electron.ipcRenderer` is the web dispatcher, which
 * has no handler for `crypto:hashPassword` / `crypto:verifyPassword` and THROWS.
 * Testing the bridge alone therefore chose the dead branch on the web and
 * shadowed the browser fallback written for exactly that case: no password
 * could be set or checked on a file there. The web must take the fallback.
 */
function hasNativeBcrypt(): boolean {
  return !!window.electron?.ipcRenderer && !isWebPlatform();
}

/**
 * Same cost factor as the main-process handler (electron/main.ts,
 * `crypto:hashPassword`): a hash produced here verifies there, and vice versa.
 */
const BCRYPT_COST = 12;

/**
 * bcrypt IN THE BROWSER — `bcryptjs` is pure JavaScript and already a
 * dependency (main uses it). Loaded lazily: only a password gesture pays the
 * ~30 KB, never the first paint.
 *
 * WHY NOT KEEP PBKDF2 FOR NEW HASHES. A `$pbkdf2$` hash is readable by nobody
 * but this fallback: main's `crypto:verifyPassword` is bcrypt-only, so a
 * password set on the web could never be checked on the desktop. bcrypt on both
 * sides makes the hashes one format. `$pbkdf2$` stays accepted on READ for the
 * hashes the old fallback produced.
 */
async function browserBcrypt() {
  return (await import('bcryptjs')).default;
}

// Password hashing via IPC to main process (bcrypt runs in Node, not renderer)
async function hashPassword(password: string): Promise<string> {
  if (hasNativeBcrypt()) {
    return window.electron.ipcRenderer.invoke('crypto:hashPassword', password);
  }
  // Fallback: bcrypt in the browser (same format and cost as main)
  if (isWebPlatform()) {
    const bcrypt = await browserBcrypt();
    return bcrypt.hash(password, BCRYPT_COST);
  }
  // Legacy fallback: PBKDF2 via Web Crypto (no bridge at all, e.g. a bare dev page)
  const encoder = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const derivedBits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 600000, hash: 'SHA-256' },
    keyMaterial,
    256
  );
  const saltHex = Array.from(salt)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  const hashHex = Array.from(new Uint8Array(derivedBits))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `$pbkdf2$${saltHex}$${hashHex}`;
}

/**
 * Constant-time string comparison — avoids leaking hash prefix via timing.
 * Returns false for differing lengths without early-exit leaking the length
 * difference beyond what is already observable.
 */
function timingSafeStringEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  // Pad shorter string so the loop always runs max(|a|, |b|) times and
  // exits only at the end. Bail out on length mismatch AFTER the loop.
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

async function comparePassword(password: string, hash: string): Promise<boolean> {
  if (hasNativeBcrypt()) {
    return window.electron.ipcRenderer.invoke('crypto:verifyPassword', password, hash);
  }
  // bcrypt hashes — set on the desktop (`$2a$`/`$2b$`/`$2y$`) or by the web
  // fallback above — verify in the browser too.
  if (/^\$2[aby]\$/.test(hash)) {
    const bcrypt = await browserBcrypt();
    return bcrypt.compare(password, hash);
  }
  // Legacy fallback: PBKDF2 via Web Crypto
  if (hash.startsWith('$pbkdf2$')) {
    const parts = hash.split('$');
    const saltHex = parts[2];
    const salt = new Uint8Array(saltHex.match(/.{2}/g)!.map((b) => parseInt(b, 16)));
    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      encoder.encode(password),
      'PBKDF2',
      false,
      ['deriveBits']
    );
    const derivedBits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt, iterations: 600000, hash: 'SHA-256' },
      keyMaterial,
      256
    );
    const hashHex = Array.from(new Uint8Array(derivedBits))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    return timingSafeStringEqual(hashHex, parts[3]);
  }
  // Legacy SHA-256 comparison — kept for migration of pre-v2 password hashes
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const legacyHash = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return timingSafeStringEqual(legacyHash, hash);
}

// Storage keys
const STORAGE_KEY_SESSION_UNLOCKS = 'filarr_session_unlocks';

// ==================== TYPES ====================

export interface PasswordProtection {
  itemId: string;
  itemType: 'file' | 'folder';
  passwordHash: string;
  createdAt: string;
  updatedAt: string;
  hint?: string;
}

export interface SessionUnlock {
  itemId: string;
  unlockedAt: string;
  expiresAt: string | null; // null = never expires (session-only)
}

export type PasswordStrength = 'weak' | 'fair' | 'good' | 'strong';

export interface PasswordStrengthResult {
  strength: PasswordStrength;
  score: number; // 0-100
  feedback: string[];
}

// ==================== PRIVATE HELPERS ====================

// In-memory cache — populated from the encrypted IPC store on first access
let _hashesCache: Record<string, PasswordProtection> | null = null;
let _hashesCacheLoaded = false;
let _unlocksCache: Record<string, SessionUnlock> | null = null;

/**
 * Load password hashes from secure IPC store (encrypted on disk via main process).
 * Falls back to legacy localStorage and migrates automatically.
 */
async function loadPasswordHashesAsync(): Promise<Record<string, PasswordProtection>> {
  if (_hashesCache && _hashesCacheLoaded) return _hashesCache;

  try {
    if (window.electron?.ipcRenderer) {
      const stored = await window.electron.ipcRenderer.invoke('secureStore:getPasswordHashes');
      _hashesCache = stored && typeof stored === 'object' ? stored : {};

      // Migrate legacy localStorage data if present
      try {
        const legacy = localStorage.getItem('filarr_password_hashes');
        if (legacy) {
          const legacyData = JSON.parse(legacy) as Record<string, PasswordProtection>;
          if (Object.keys(legacyData).length > 0) {
            _hashesCache = { ..._hashesCache, ...legacyData };
            await savePasswordHashesAsync(_hashesCache);
            localStorage.removeItem('filarr_password_hashes');
          }
        }
      } catch {
        /* ignore migration errors */
      }

      _hashesCacheLoaded = true;
      return _hashesCache!;
    }
  } catch {
    // IPC unavailable — fall through
  }

  // Fallback: localStorage (non-Electron or IPC error)
  try {
    const stored = localStorage.getItem('filarr_password_hashes');
    _hashesCache = stored ? JSON.parse(stored) : {};
  } catch {
    _hashesCache = {};
  }
  _hashesCacheLoaded = true;
  return _hashesCache!;
}

/**
 * Synchronous accessor — returns cache if loaded, empty otherwise.
 * Use loadPasswordHashesAsync() for first load.
 */
function loadPasswordHashes(): Record<string, PasswordProtection> {
  if (_hashesCache) return _hashesCache;
  // If cache not loaded yet, trigger async load in background
  loadPasswordHashesAsync().catch(() => {});
  return {};
}

/**
 * Save password hashes to secure IPC store (updates cache)
 */
async function savePasswordHashesAsync(hashes: Record<string, PasswordProtection>): Promise<void> {
  _hashesCache = hashes;
  try {
    if (window.electron?.ipcRenderer) {
      await window.electron.ipcRenderer.invoke('secureStore:setPasswordHashes', hashes);
      return;
    }
  } catch {
    /* fall through */
  }
  // Fallback
  try {
    localStorage.setItem('filarr_password_hashes', JSON.stringify(hashes));
  } catch {
    /* ignore */
  }
}

/**
 * Sync wrapper — fire-and-forget save
 */
function savePasswordHashes(hashes: Record<string, PasswordProtection>): void {
  _hashesCache = hashes;
  savePasswordHashesAsync(hashes).catch(() => {});
}

/**
 * Load session unlocks from storage (cached)
 */
function loadSessionUnlocks(): Record<string, SessionUnlock> {
  if (_unlocksCache) return _unlocksCache;
  try {
    const stored = sessionStorage.getItem(STORAGE_KEY_SESSION_UNLOCKS);
    _unlocksCache = stored ? JSON.parse(stored) : {};
    return _unlocksCache!;
  } catch {
    return {};
  }
}

/**
 * Save session unlocks to storage (updates cache)
 */
function saveSessionUnlocks(unlocks: Record<string, SessionUnlock>): void {
  _unlocksCache = unlocks;
  try {
    sessionStorage.setItem(STORAGE_KEY_SESSION_UNLOCKS, JSON.stringify(unlocks));
  } catch {
    // Silently fail — cache is still updated
  }
}

// ==================== PUBLIC API ====================

/**
 * Set password protection on a file or folder
 */
export async function setPassword(
  itemId: string,
  itemType: 'file' | 'folder',
  password: string,
  hint?: string
): Promise<PasswordProtection> {
  // Hash the password via IPC (bcrypt in main process)
  const passwordHash = await hashPassword(password);
  const now = new Date().toISOString();

  const protection: PasswordProtection = {
    itemId,
    itemType,
    passwordHash,
    createdAt: now,
    updatedAt: now,
    hint,
  };

  // Save to storage
  const hashes = loadPasswordHashes();
  hashes[itemId] = protection;
  savePasswordHashes(hashes);

  return protection;
}

/**
 * Verify a password for a protected item
 */
export async function verifyPassword(itemId: string, password: string): Promise<boolean> {
  const hashes = loadPasswordHashes();
  const protection = hashes[itemId];

  if (!protection) {
    return false;
  }

  const isValid = await comparePassword(password, protection.passwordHash);
  return isValid;
}

/**
 * Remove password protection from an item
 */
export function removePassword(itemId: string): boolean {
  const hashes = loadPasswordHashes();

  if (!hashes[itemId]) {
    return false;
  }

  delete hashes[itemId];
  savePasswordHashes(hashes);

  // Also remove any session unlock
  const unlocks = loadSessionUnlocks();
  delete unlocks[itemId];
  saveSessionUnlocks(unlocks);

  return true;
}

/**
 * Check if an item is password protected
 */
export function isProtected(itemId: string): boolean {
  const hashes = loadPasswordHashes();
  return !!hashes[itemId];
}

/**
 * Get password protection info for an item
 */
export function getProtectionInfo(itemId: string): PasswordProtection | null {
  const hashes = loadPasswordHashes();
  const protection = hashes[itemId];

  if (!protection) return null;

  // Return info without the actual hash
  return {
    ...protection,
    passwordHash: '[REDACTED]',
  };
}

/**
 * Unlock an item for the current session
 */
export function unlockForSession(itemId: string, rememberDuration?: number): void {
  const unlocks = loadSessionUnlocks();
  const now = new Date();

  unlocks[itemId] = {
    itemId,
    unlockedAt: now.toISOString(),
    expiresAt: rememberDuration ? new Date(now.getTime() + rememberDuration).toISOString() : null,
  };

  saveSessionUnlocks(unlocks);
}

/**
 * Check if an item is unlocked for the current session
 */
export function isUnlockedForSession(itemId: string): boolean {
  const unlocks = loadSessionUnlocks();
  const unlock = unlocks[itemId];

  if (!unlock) return false;

  // Check if expired
  if (unlock.expiresAt) {
    const expiresAt = new Date(unlock.expiresAt);
    if (expiresAt < new Date()) {
      // Expired, remove unlock
      delete unlocks[itemId];
      saveSessionUnlocks(unlocks);
      return false;
    }
  }

  return true;
}

/**
 * Lock an item (remove session unlock)
 */
export function lockItem(itemId: string): void {
  const unlocks = loadSessionUnlocks();
  delete unlocks[itemId];
  saveSessionUnlocks(unlocks);
}

/**
 * Lock all items (clear all session unlocks)
 */
export function lockAllItems(): void {
  sessionStorage.removeItem(STORAGE_KEY_SESSION_UNLOCKS);
}

/**
 * Get all protected item IDs
 */
export function getProtectedItemIds(): string[] {
  const hashes = loadPasswordHashes();
  return Object.keys(hashes);
}

/**
 * Get all unlocked item IDs for current session
 */
export function getUnlockedItemIds(): string[] {
  const unlocks = loadSessionUnlocks();
  return Object.entries(unlocks)
    .filter(([, unlock]) => {
      if (unlock.expiresAt) {
        return new Date(unlock.expiresAt) > new Date();
      }
      return true;
    })
    .map(([id]) => id);
}

/**
 * Change password for an item
 */
export async function changePassword(
  itemId: string,
  currentPassword: string,
  newPassword: string,
  hint?: string
): Promise<boolean> {
  // Verify current password
  const isValid = await verifyPassword(itemId, currentPassword);
  if (!isValid) {
    return false;
  }

  // Get existing protection info
  const hashes = loadPasswordHashes();
  const existing = hashes[itemId];

  // Set new password via IPC (bcrypt in main process)
  const passwordHash = await hashPassword(newPassword);

  hashes[itemId] = {
    ...existing,
    passwordHash,
    updatedAt: new Date().toISOString(),
    hint: hint ?? existing.hint,
  };

  savePasswordHashes(hashes);

  return true;
}

/**
 * Get password hint for an item
 */
export function getPasswordHint(itemId: string): string | null {
  const hashes = loadPasswordHashes();
  const protection = hashes[itemId];
  return protection?.hint ?? null;
}

/**
 * Evaluate password strength
 */
export function evaluatePasswordStrength(password: string): PasswordStrengthResult {
  const feedback: string[] = [];
  let score = 0;

  // Length check
  if (password.length >= 8) {
    score += 20;
  } else {
    feedback.push('Le mot de passe doit contenir au moins 8 caracteres');
  }

  if (password.length >= 12) {
    score += 10;
  }

  if (password.length >= 16) {
    score += 10;
  }

  // Character variety checks
  if (/[a-z]/.test(password)) {
    score += 10;
  } else {
    feedback.push('Ajouter des lettres minuscules');
  }

  if (/[A-Z]/.test(password)) {
    score += 15;
  } else {
    feedback.push('Ajouter des lettres majuscules');
  }

  if (/\d/.test(password)) {
    score += 15;
  } else {
    feedback.push('Ajouter des chiffres');
  }

  if (/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password)) {
    score += 20;
  } else {
    feedback.push('Ajouter des caracteres speciaux');
  }

  // Determine strength level
  let strength: PasswordStrength;
  if (score < 30) {
    strength = 'weak';
  } else if (score < 50) {
    strength = 'fair';
  } else if (score < 70) {
    strength = 'good';
  } else {
    strength = 'strong';
  }

  return { strength, score: Math.min(score, 100), feedback };
}

/**
 * Apply password protection to folder contents
 */
export async function protectFolderContents(
  folderId: string,
  password: string,
  childItemIds: string[],
  hint?: string
): Promise<void> {
  // Protect the folder itself
  await setPassword(folderId, 'folder', password, hint);

  // Protect each child item
  for (const itemId of childItemIds) {
    // Determine if it's a file or folder based on whether it's already in the protected list
    // For simplicity, we'll mark them as files (the actual type doesn't affect the protection)
    await setPassword(itemId, 'file', password, hint);
  }
}

/**
 * Remove password protection from folder contents
 */
export function unprotectFolderContents(folderId: string, childItemIds: string[]): void {
  // Remove protection from the folder
  removePassword(folderId);

  // Remove protection from each child item
  for (const itemId of childItemIds) {
    removePassword(itemId);
  }
}

/**
 * Export for testing
 */
export const __testing = {
  loadPasswordHashes,
  savePasswordHashes,
  loadSessionUnlocks,
  saveSessionUnlocks,
};
