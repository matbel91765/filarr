/**
 * Token Storage Utility
 *
 * Handles secure storage and retrieval of JWT tokens.
 * Uses sessionStorage so tokens are cleared when the app closes,
 * preventing persistent token leakage on disk.
 */

const ACCESS_TOKEN_KEY = 'filarr_access_token';
const REFRESH_TOKEN_KEY = 'filarr_refresh_token';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

/**
 * Store access token
 */
export const setAccessToken = (token: string): void => {
  try {
    sessionStorage.setItem(ACCESS_TOKEN_KEY, token);
  } catch (error) {
    console.error('Failed to store access token:', error);
  }
};

/**
 * Get access token
 */
export const getAccessToken = (): string | null => {
  try {
    return sessionStorage.getItem(ACCESS_TOKEN_KEY);
  } catch (error) {
    console.error('Failed to retrieve access token:', error);
    return null;
  }
};

/**
 * Store refresh token
 */
export const setRefreshToken = (token: string): void => {
  try {
    sessionStorage.setItem(REFRESH_TOKEN_KEY, token);
  } catch (error) {
    console.error('Failed to store refresh token:', error);
  }
};

/**
 * Get refresh token
 */
export const getRefreshToken = (): string | null => {
  try {
    return sessionStorage.getItem(REFRESH_TOKEN_KEY);
  } catch (error) {
    console.error('Failed to retrieve refresh token:', error);
    return null;
  }
};

/**
 * Store both tokens
 */
export const setTokens = (accessToken: string, refreshToken: string): void => {
  setAccessToken(accessToken);
  setRefreshToken(refreshToken);
};

/**
 * Get both tokens
 */
export const getTokens = (): TokenPair | null => {
  const accessToken = getAccessToken();
  const refreshToken = getRefreshToken();

  if (!accessToken || !refreshToken) {
    return null;
  }

  return { accessToken, refreshToken };
};

/**
 * Clear all tokens (logout)
 */
export const clearTokens = (): void => {
  try {
    sessionStorage.removeItem(ACCESS_TOKEN_KEY);
    sessionStorage.removeItem(REFRESH_TOKEN_KEY);
  } catch (error) {
    console.error('Failed to clear tokens:', error);
  }
};

/**
 * Check if user has valid tokens
 */
export const hasTokens = (): boolean => {
  return !!(getAccessToken() && getRefreshToken());
};

export default {
  setAccessToken,
  getAccessToken,
  setRefreshToken,
  getRefreshToken,
  setTokens,
  getTokens,
  clearTokens,
  hasTokens,
};
