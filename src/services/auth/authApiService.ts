/**
 * Auth API Service - Type Definitions
 *
 * OFFLINE-ONLY: Seules les definitions de types sont conservees.
 */

export interface RegisterRequest {
  email: string;
  username: string;
  password: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface AuthResponse {
  user: {
    id: string;
    email: string;
    username: string;
    role?: string;
  };
  accessToken: string;
  refreshToken: string;
}

export interface RefreshTokenResponse {
  accessToken: string;
  refreshToken: string;
}

export interface UserProfile {
  id: string;
  email: string;
  username: string;
  role?: string;
  createdAt?: string;
  updatedAt?: string;
}
