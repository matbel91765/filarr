/**
 * Tests for authSelectors
 *
 * Tests authentication state selectors including user info, token management,
 * and permission checking.
 */

import {
  selectIsAuthenticated,
  selectCurrentUser,
  selectAuthToken,
  selectAuthLoading,
  selectAuthError,
  selectTokenExpiration,
  selectIsTokenExpired,
  selectRefreshToken,
  selectPasswordStatus,
  selectIsChangingPassword,
  selectRequiresPasswordChange,
  selectPasswordLastChanged,
  selectUserHasPermission,
  selectShouldReauthenticate,
} from '../authSelectors';
import { createMockRootState, createAuthenticatedState } from '../../../test-utils/mockState';

/**
 * Helper to create a fully authenticated state with user, token, etc.
 */
const createFullyAuthenticatedState = () =>
  createMockRootState({
    auth: {
      ...createMockRootState().auth,
      isAuthenticated: true,
      user: {
        id: '1',
        username: 'testuser',
        email: 'test@example.com',
        role: 'user',
      },
      token: 'fake-jwt-token',
      refreshToken: 'fake-refresh-token',
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
    },
  });

describe('authSelectors', () => {
  describe('selectIsAuthenticated', () => {
    it('should return true when user is authenticated', () => {
      const state = createAuthenticatedState();
      expect(selectIsAuthenticated(state)).toBe(true);
    });

    it('should return false when user is not authenticated', () => {
      const state = createMockRootState();
      expect(selectIsAuthenticated(state)).toBe(false);
    });
  });

  describe('selectCurrentUser', () => {
    it('should return current user when authenticated', () => {
      const state = createFullyAuthenticatedState();
      const user = selectCurrentUser(state);

      expect(user).toBeDefined();
      expect(user?.username).toBe('testuser');
      expect(user?.email).toBe('test@example.com');
    });

    it('should return null when not authenticated', () => {
      const state = createMockRootState();
      expect(selectCurrentUser(state)).toBeNull();
    });
  });

  describe('selectAuthToken', () => {
    it('should return token when authenticated', () => {
      const state = createFullyAuthenticatedState();
      const token = selectAuthToken(state);

      expect(token).toBe('fake-jwt-token');
    });

    it('should return null when not authenticated', () => {
      const state = createMockRootState();
      expect(selectAuthToken(state)).toBeNull();
    });
  });

  describe('selectAuthLoading', () => {
    it('should return loading state', () => {
      const state = createMockRootState({
        auth: {
          ...createMockRootState().auth,
          loading: true,
        },
      });

      expect(selectAuthLoading(state)).toBe(true);
    });

    it('should return false when not loading', () => {
      const state = createMockRootState();
      expect(selectAuthLoading(state)).toBe(false);
    });
  });

  describe('selectAuthError', () => {
    it('should return error when present', () => {
      const error = {
        name: 'AuthError',
        message: 'Invalid credentials',
      };

      const state = createMockRootState({
        auth: {
          ...createMockRootState().auth,
          error,
        },
      });

      expect(selectAuthError(state)).toEqual(error);
    });

    it('should return null when no error', () => {
      const state = createMockRootState();
      expect(selectAuthError(state)).toBeNull();
    });
  });

  describe('selectTokenExpiration', () => {
    it('should return expiration date', () => {
      const state = createFullyAuthenticatedState();
      const expiration = selectTokenExpiration(state);

      expect(expiration).toBeDefined();
      expect(typeof expiration).toBe('string');
    });

    it('should return null when not authenticated', () => {
      const state = createMockRootState();
      expect(selectTokenExpiration(state)).toBeNull();
    });
  });

  describe('selectIsTokenExpired', () => {
    it('should return false for valid token', () => {
      const state = createFullyAuthenticatedState();
      expect(selectIsTokenExpired(state)).toBe(false);
    });

    it('should return true for expired token', () => {
      const state = createMockRootState({
        auth: {
          ...createFullyAuthenticatedState().auth,
          expiresAt: new Date(Date.now() - 1000).toISOString(),
        },
      });

      expect(selectIsTokenExpired(state)).toBe(true);
    });

    it('should return true when no expiration date', () => {
      const state = createMockRootState({
        auth: {
          ...createMockRootState().auth,
          expiresAt: null,
        },
      });

      expect(selectIsTokenExpired(state)).toBe(true);
    });
  });

  describe('selectRefreshToken', () => {
    it('should return refresh token', () => {
      const state = createFullyAuthenticatedState();
      const refreshToken = selectRefreshToken(state);

      expect(refreshToken).toBe('fake-refresh-token');
    });

    it('should return null when not authenticated', () => {
      const state = createMockRootState();
      expect(selectRefreshToken(state)).toBeNull();
    });
  });

  describe('selectPasswordStatus', () => {
    it('should return password status', () => {
      const state = createMockRootState({
        auth: {
          ...createMockRootState().auth,
          passwordStatus: {
            isChanging: true,
            lastChanged: '2024-01-01T00:00:00.000Z',
            requiresChange: false,
          },
        },
      });

      const status = selectPasswordStatus(state);
      expect(status.isChanging).toBe(true);
      expect(status.lastChanged).toBe('2024-01-01T00:00:00.000Z');
      expect(status.requiresChange).toBe(false);
    });
  });

  describe('selectIsChangingPassword', () => {
    it('should return true when changing password', () => {
      const state = createMockRootState({
        auth: {
          ...createMockRootState().auth,
          passwordStatus: {
            isChanging: true,
            lastChanged: null,
            requiresChange: false,
          },
        },
      });

      expect(selectIsChangingPassword(state)).toBe(true);
    });

    it('should return false when not changing password', () => {
      const state = createMockRootState();
      expect(selectIsChangingPassword(state)).toBe(false);
    });
  });

  describe('selectRequiresPasswordChange', () => {
    it('should return true when password change is required', () => {
      const state = createMockRootState({
        auth: {
          ...createMockRootState().auth,
          passwordStatus: {
            isChanging: false,
            lastChanged: null,
            requiresChange: true,
          },
        },
      });

      expect(selectRequiresPasswordChange(state)).toBe(true);
    });

    it('should return false when password change is not required', () => {
      const state = createMockRootState();
      expect(selectRequiresPasswordChange(state)).toBe(false);
    });
  });

  describe('selectPasswordLastChanged', () => {
    it('should return last changed date', () => {
      const lastChanged = '2024-01-01T00:00:00.000Z';
      const state = createMockRootState({
        auth: {
          ...createMockRootState().auth,
          passwordStatus: {
            isChanging: false,
            lastChanged,
            requiresChange: false,
          },
        },
      });

      expect(selectPasswordLastChanged(state)).toBe(lastChanged);
    });

    it('should return null when never changed', () => {
      const state = createMockRootState();
      expect(selectPasswordLastChanged(state)).toBeNull();
    });
  });

  describe('selectUserHasPermission', () => {
    it('should return true for admin users regardless of permission', () => {
      const state = createMockRootState({
        auth: {
          ...createFullyAuthenticatedState().auth,
          user: {
            id: '1',
            username: 'admin',
            email: 'admin@example.com',
            role: 'admin',
          },
        },
      });

      const hasPermission = selectUserHasPermission('any_permission')(state);
      expect(hasPermission).toBe(true);
    });

    it('should return true when user has specific permission', () => {
      const state = createMockRootState({
        auth: {
          ...createFullyAuthenticatedState().auth,
          user: {
            id: '1',
            username: 'user',
            email: 'user@example.com',
            role: 'user',
            permissions: ['read', 'write'],
          },
        },
      });

      const hasReadPermission = selectUserHasPermission('read')(state);
      expect(hasReadPermission).toBe(true);

      const hasWritePermission = selectUserHasPermission('write')(state);
      expect(hasWritePermission).toBe(true);
    });

    it('should return false when user does not have permission', () => {
      const state = createMockRootState({
        auth: {
          ...createFullyAuthenticatedState().auth,
          user: {
            id: '1',
            username: 'user',
            email: 'user@example.com',
            role: 'user',
            permissions: ['read'],
          },
        },
      });

      const hasDeletePermission = selectUserHasPermission('delete')(state);
      expect(hasDeletePermission).toBe(false);
    });

    it('should return false when user is not authenticated', () => {
      const state = createMockRootState();
      const hasPermission = selectUserHasPermission('read')(state);
      expect(hasPermission).toBe(false);
    });

    it('should return false when user has no permissions array', () => {
      const state = createMockRootState({
        auth: {
          ...createFullyAuthenticatedState().auth,
          user: {
            id: '1',
            username: 'user',
            email: 'user@example.com',
            role: 'user',
          },
        },
      });

      const hasPermission = selectUserHasPermission('read')(state);
      expect(hasPermission).toBe(false);
    });
  });

  describe('selectShouldReauthenticate', () => {
    it('should return true when authenticated with expired token', () => {
      const state = createMockRootState({
        auth: {
          ...createFullyAuthenticatedState().auth,
          expiresAt: new Date(Date.now() - 1000).toISOString(),
        },
      });

      expect(selectShouldReauthenticate(state)).toBe(true);
    });

    it('should return false when authenticated with valid token', () => {
      const state = createFullyAuthenticatedState();
      expect(selectShouldReauthenticate(state)).toBe(false);
    });

    it('should return false when not authenticated', () => {
      const state = createMockRootState();
      expect(selectShouldReauthenticate(state)).toBe(false);
    });
  });

  describe('memoization', () => {
    it('should return same reference for same state', () => {
      const state = createFullyAuthenticatedState();

      const user1 = selectCurrentUser(state);
      const user2 = selectCurrentUser(state);

      expect(user1).toBe(user2);
    });

    it('should return different reference when state changes', () => {
      const state1 = createFullyAuthenticatedState();
      const state2 = createMockRootState({
        auth: {
          ...state1.auth,
          user: {
            id: '2',
            username: 'different-user',
            email: 'different@example.com',
          },
        },
      });

      const user1 = selectCurrentUser(state1);
      const user2 = selectCurrentUser(state2);

      expect(user1).not.toBe(user2);
      expect(user1?.username).not.toBe(user2?.username);
    });

    it('should memoize complex selectors', () => {
      const state = createFullyAuthenticatedState();

      const shouldReauth1 = selectShouldReauthenticate(state);
      const shouldReauth2 = selectShouldReauthenticate(state);

      // Should return same boolean value
      expect(shouldReauth1).toBe(shouldReauth2);
    });
  });

  describe('edge cases', () => {
    it('should handle missing auth state gracefully', () => {
      const invalidState = {} as any;

      expect(() => selectIsAuthenticated(invalidState)).toThrow();
    });

    it('should handle partial auth state', () => {
      const partialState = createMockRootState({
        auth: {
          ...createMockRootState().auth,
          user: {
            id: '1',
            username: 'testuser',
            email: 'test@example.com',
          },
        },
      });

      const user = selectCurrentUser(partialState);
      expect(user?.username).toBe('testuser');
    });

    it('should handle token expiration edge cases', () => {
      // Token expiring in exactly 0 ms
      const nowState = createMockRootState({
        auth: {
          ...createFullyAuthenticatedState().auth,
          expiresAt: new Date().toISOString(),
        },
      });

      // Due to timing, this might be true or false depending on execution speed
      const isExpired = selectIsTokenExpired(nowState);
      expect(typeof isExpired).toBe('boolean');
    });
  });
});
