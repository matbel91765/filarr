/**
 * Selecteurs pour l'authentification (mode local)
 */

import { createSelector } from '@reduxjs/toolkit';
import type { RootState } from '../index';

const selectAuthState = (state: RootState) => state.auth;

export const selectIsAuthenticated = createSelector(
  [selectAuthState],
  auth => auth.isAuthenticated
);

export const selectAuthLoading = createSelector(
  [selectAuthState],
  auth => auth.loading
);

export const selectLocalProfile = createSelector(
  [selectAuthState],
  auth => auth.localProfile
);

export const selectIsLocked = createSelector(
  [selectAuthState],
  auth => auth.isLocked
);
