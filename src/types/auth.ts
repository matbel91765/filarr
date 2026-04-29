/**
 * Cloud Auth Types — Filarr Sync V2
 *
 * These types are shared between the renderer (React) and main process (Electron).
 * Tokens are NEVER included here — they live exclusively in safeStorage.
 */

export interface UserDTO {
  id: string;
  email: string;
  emailVerified: boolean;
  subscriptionTier: 'free' | 'solo' | 'pro';
  subscriptionExpiresAt: string | null;
  createdAt: string;
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
