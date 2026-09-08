/**
 * Profile-scoped localStorage wrapper
 *
 * Prefixes all keys with `p:{profileId}:` so each profile
 * gets its own isolated namespace in localStorage.
 * Global keys (theme, device id, onboarding) are exempted from prefixing.
 */

// Keys that are shared across all profiles (never prefixed)
const GLOBAL_KEYS = new Set([
  'theme',
  'filarr-onboarding-complete',
  'filarr_device_id',
  'filarr-active-profile',
  'filarr-local-profile',
]);

const ACTIVE_PROFILE_KEY = 'filarr-active-profile';

/** Safe read of the global pointer — localStorage can be absent (SSR, tests). */
function readStoredProfileId(): string | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage.getItem(ACTIVE_PROFILE_KEY);
  } catch {
    return null;
  }
}

// Seeded at module load, not at the first setActiveProfile() call: modules that
// read their preferences while being imported (uiSlice builds its initialState
// at evaluation time) run BEFORE store/index.ts restores the pointer, and would
// otherwise read the un-prefixed keys of no profile at all.
let currentProfileId: string | null = readStoredProfileId();

function prefixKey(key: string): string {
  if (GLOBAL_KEYS.has(key) || !currentProfileId) {
    return key;
  }
  return `p:${currentProfileId}:${key}`;
}

/**
 * Set the active profile ID. All subsequent get/set calls
 * will be scoped to this profile.
 */
export function setActiveProfile(profileId: string | null): void {
  currentProfileId = profileId;
  // Persist to global key so we can restore before PersistGate rehydrates
  if (profileId) {
    localStorage.setItem(ACTIVE_PROFILE_KEY, profileId);
  } else {
    localStorage.removeItem(ACTIVE_PROFILE_KEY);
  }
}

/**
 * Get the current active profile ID.
 */
export function getActiveProfileId(): string | null {
  return currentProfileId;
}

/**
 * Profile-scoped getItem
 */
export function getItem(key: string): string | null {
  return localStorage.getItem(prefixKey(key));
}

/**
 * Profile-scoped setItem
 */
export function setItem(key: string, value: string): void {
  localStorage.setItem(prefixKey(key), value);
}

/**
 * Profile-scoped removeItem
 */
export function removeItem(key: string): void {
  localStorage.removeItem(prefixKey(key));
}

/**
 * Profile-scoped read with a one-way fallback on the legacy un-prefixed key.
 *
 * Display preferences (theme, bars mode, viewports, collapsed panes…) used to
 * be written straight to `localStorage`, so two profiles on the same machine
 * shared them — a decoy profile was distinguishable by its chrome alone. They
 * are now scoped, and this reader lets the value already on disk survive the
 * move: the prefixed key wins, the bare key answers only while the prefixed
 * one has never been written.
 *
 * The legacy key is NEVER written back (see `setItem`), so the first save under
 * any profile ends the sharing for that profile and leaves the other profiles'
 * inherited value untouched until they save in turn.
 *
 * Returns null when nothing is stored — callers keep their own default.
 */
export function getItemWithLegacyFallback(key: string): string | null {
  try {
    const scoped = prefixKey(key);
    const value = localStorage.getItem(scoped);
    if (value !== null) return value;
    // No profile active (or a global key): `scoped` IS the legacy key already.
    if (scoped === key) return null;
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * Le `key` d'un StorageEvent porte le nom RÉEL écrit dans localStorage, donc
 * la clé préfixée. Un écouteur qui compare à sa constante nue ne reconnaîtrait
 * plus rien. On accepte les deux formes : la clé du profil actif, et l'ancienne
 * clé nue (qu'une version antérieure encore ouverte pourrait écrire).
 */
export function matchesKey(eventKey: string | null, key: string): boolean {
  if (!eventKey) return false;
  return eventKey === prefixKey(key) || eventKey === key;
}

/**
 * Clear all keys for the current profile only.
 * Global keys are preserved.
 */
export function clearProfile(): void {
  if (!currentProfileId) return;

  const prefix = `p:${currentProfileId}:`;
  const keysToRemove: string[] = [];

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(prefix)) {
      keysToRemove.push(key);
    }
  }

  keysToRemove.forEach((k) => localStorage.removeItem(k));
}

/**
 * Redux-persist compatible storage engine.
 * Use this as the `storage` option in persistConfig.
 */
export const profilePersistStorage = {
  getItem: (key: string): Promise<string | null> => {
    return Promise.resolve(getItem(key));
  },
  setItem: (key: string, value: string): Promise<void> => {
    setItem(key, value);
    return Promise.resolve();
  },
  removeItem: (key: string): Promise<void> => {
    removeItem(key);
    return Promise.resolve();
  },
};

export default {
  getItem,
  getItemWithLegacyFallback,
  matchesKey,
  setItem,
  removeItem,
  clearProfile,
  setActiveProfile,
  getActiveProfileId,
  profilePersistStorage,
};
