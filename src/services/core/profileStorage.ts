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

let currentProfileId: string | null = null;

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
    localStorage.setItem('filarr-active-profile', profileId);
  } else {
    localStorage.removeItem('filarr-active-profile');
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
  setItem,
  removeItem,
  clearProfile,
  setActiveProfile,
  getActiveProfileId,
  profilePersistStorage,
};
