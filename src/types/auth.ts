/**
 * Cloud Auth Types — Filarr Sync V2
 *
 * These types are shared between the renderer (React) and main process (Electron).
 * Tokens are NEVER included here — they live exclusively in safeStorage.
 */

/** Personal tiers plus the org (per-seat) tiers a user can operate under. */
export type SubscriptionTier = 'free' | 'solo' | 'pro' | 'teams' | 'enterprise';

export interface UserDTO {
  id: string;
  email: string;
  emailVerified: boolean;
  subscriptionTier: SubscriptionTier;
  subscriptionExpiresAt: string | null;
  createdAt: string;
  /**
   * Strict account type (0059). A 'personal' account can never belong to an
   * organization; enterprise is a distinct account. Fixed at registration.
   */
  accountType?: 'personal' | 'enterprise';
  /** Nom d'affichage (0092). Absent = personne n'en a choisi ; l'adresse fait office. */
  displayName?: string;
}

export interface RegisterResult {
  user: UserDTO;
  recoveryCodes: string[];
}

export interface AuthStatus {
  isAuthenticated: boolean;
  user: UserDTO | null;
  accountMode: 'local' | 'cloud';
  syncPaused?: boolean;
}

export interface DeviceInfo {
  id: string;
  name: string;
  os: string;
  lastSeenAt: string;
  createdAt: string;
}

export interface AuthError {
  code: string;
  message: string;
}
