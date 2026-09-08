/**
 * Profile System Types
 *
 * Multi-profile support: each profile is an isolated data container
 * with its own folders, files, settings, and encryption key.
 */

export interface ProfileMetadata {
  id: string; // UUIDv4
  name: string; // Display name (max 50 chars)
  avatarColor: string; // Hex color (#4682B4)
  avatarEmoji?: string; // Optional emoji (future)
  avatarImage?: string; // Custom avatar image (base64 data URL, max 128KB)
  pinHash?: string; // PBKDF2-SHA256 hash
  pinSalt?: string; // 16-byte hex salt for PIN
  pinAttempts: number; // Current failed attempt count
  pinLockedUntil?: number; // Epoch ms lockout expiry
  allowPinReset?: boolean; // If true, PIN can be reset via "Forgot PIN" flow
  createdAt: string; // ISO 8601
  lastAccessedAt: string; // ISO 8601
  isDefault: boolean; // First profile created is default
  order: number; // Display order (0-indexed)
  /**
   * Cloud account bound to this profile (null/undefined = local-only).
   * Populated by authService after login; used to render badges in
   * ProfilePicker and disambiguate which account is active per profile.
   */
  cloudAccount?: {
    email: string;
    tier: string;
    linkedAt: string;
    /** Strict account type (0059) — the reliable pre-activation space signal. */
    accountType?: 'personal' | 'enterprise';
  } | null;
  /**
   * Last-known workspace space for this profile. Denormalized from the
   * authoritative per-profile .space file so the pre-activation ProfilePicker
   * can badge/default the space without an active profile. The .space file
   * remains the source of truth; this is only a hint. Defaults to 'personal'.
   */
  spaceMode?: 'personal' | 'enterprise';
  /**
   * Last-known list of REAL (non-personal) organizations this profile's cloud
   * account belongs to. Lets the picker decide whether to offer the Enterprise
   * toggle at all, before any network call. Refreshed on each org:list fetch.
   */
  orgs?: import('./org').OrgHint[];
}

export interface ProfilesManifest {
  version: 1; // Schema version for future migrations
  activeProfileId: string | null; // Last active profile (for auto-select)
  profiles: ProfileMetadata[];
  plan?: string; // deprecated — kept for backward compat, ignored
  maxProfiles: number; // Hardcoded to 10
  migratedFromLegacy: boolean; // True after v1 migration
}

/** Data needed to create a new profile */
export interface CreateProfileParams {
  name: string;
  avatarColor: string;
  pin?: string; // Raw 4-digit PIN (hashed before storage)
  allowPinReset?: boolean; // Allow PIN reset via name confirmation
}

/** Data for updating an existing profile */
export interface UpdateProfileParams {
  name?: string;
  avatarColor?: string;
  avatarImage?: string | null; // base64 data URL or null to remove
  pin?: string | null; // null = remove PIN, string = new PIN, undefined = no change
  allowPinReset?: boolean; // Toggle PIN reset capability
}
