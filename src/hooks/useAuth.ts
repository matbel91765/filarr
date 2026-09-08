/**
 * useAuth — React hook for authentication
 *
 * Exposes auth state from Redux and action dispatchers.
 * All network operations go through IPC → main process.
 */

import { useCallback } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import type { RootState, AppDispatch } from '../store';
import type { UserDTO } from '../types/auth';
import {
  setCloudAuth,
  clearCloudAuth,
  setAuthLoading,
  setAuthError,
  setSyncEnabled,
} from '../store/slices/authSlice';
import { clearOrgs } from '../store/slices/orgSlice';
import * as authApi from '../services/auth/authApi';
import { publishDeviceLimitPrompt } from '../services/auth/deviceLimitPrompt';
import { forgetSessionSecrets } from '../services/auth/sessionTeardown';
import { restoreCloudProfiles } from '../services/core/cloudProfileRestore';

export function useAuth() {
  const dispatch = useDispatch<AppDispatch>();
  const auth = useSelector((state: RootState) => state.auth);

  const login = useCallback(
    async (email: string, password: string, revokeDeviceId?: string) => {
      dispatch(setAuthLoading(true));
      dispatch(setAuthError(null));

      try {
        const result = await authApi.login(email, password, revokeDeviceId);
        if (result.success && result.user) {
          dispatch(setCloudAuth(result.user));
          await authApi.setSyncEnabled(true);
          dispatch(setSyncEnabled(true));
          /**
           * RAMENER LES PROFILS DU COMPTE — le geste qui manquait ici.
           *
           * Se connecter depuis les Réglages, sur une installation déjà en
           * place, n'avait AUCUN chemin de restauration : la seule fonction
           * capable de ramener les profils du nuage vivait dans le protocole
           * d'appairage, et l'onboarding était le seul à pouvoir l'emprunter.
           * On se connectait donc à un compte dont les profils existaient
           * pourtant côté serveur, et l'on ne voyait rien arriver.
           *
           * Après `setSyncEnabled`, pour que le démon soit déjà armé quand les
           * profils apparaissent. Best-effort : une restauration qui échoue
           * (hors ligne, coffre encore verrouillé, donc manifestes
           * indéchiffrables) ne doit pas faire échouer une connexion par
           * ailleurs réussie — la prochaine tentera de nouveau.
           */
          await restoreCloudProfiles();
        } else if (result.code === 'device_limit_reached') {
          /**
           * CE REFUS N'EST PAS UNE ERREUR À AFFICHER, C'EST UN CHOIX À OFFRIR.
           *
           * Le poser dans `authError` mettrait « Too many active devices » en
           * rouge sous le formulaire, et l'utilisateur n'aurait AUCUN moyen
           * d'agir : la connexion vient d'échouer, donc il n'existe aucune
           * session avec laquelle aller déconnecter quoi que ce soit.
           *
           * `retry` est une FERMETURE sur les identifiants de cette
           * tentative-ci : rien de secret ne quitte cette fonction, et rien ne
           * survit à la fermeture du dialogue.
           */
          publishDeviceLimitPrompt({
            cap: result.data?.cap ?? 0,
            sessions: result.data?.sessions ?? [],
            retry: async (deviceId: string) => {
              await login(email, password, deviceId);
            },
          });
        } else {
          dispatch(setAuthError(result.error || 'Login failed'));
        }
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Login failed';
        dispatch(setAuthError(message));
        return { success: false, error: message };
      } finally {
        dispatch(setAuthLoading(false));
      }
    },
    [dispatch]
  );

  const register = useCallback(
    async (email: string, password: string) => {
      dispatch(setAuthLoading(true));
      dispatch(setAuthError(null));

      try {
        const result = await authApi.register(email, password);
        if (!result.success) {
          dispatch(setAuthError(result.error || 'Registration failed'));
        }
        // Don't set cloud auth yet — email not verified
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Registration failed';
        dispatch(setAuthError(message));
        return { success: false, error: message };
      } finally {
        dispatch(setAuthLoading(false));
      }
    },
    [dispatch]
  );

  const logout = useCallback(async () => {
    dispatch(setAuthLoading(true));
    try {
      await authApi.logout();
      // Stop the daemon first — avoids a stray sync fired in-between logout
      // and the next user's login that would carry the wrong identity.
      await authApi.setSyncEnabled(false);
      /**
       * LES SECRETS DE SESSION SORTENT DE LA MÉMOIRE. `clearHybridCrypto` fait
       * déjà tout le travail — FEK, clé de session du main, paire de clés de
       * l'utilisateur, K_vault déverrouillées — et il était appelé au
       * verrouillage automatique, à l'effacement à distance, à la veille de
       * politique et au changement de profil. La déconnexion était la seule
       * porte à ne pas le faire.
       *
       * Ce que ça coûtait sur un poste partagé : le collègue qui se connecte
       * ensuite hérite de mes K_vault en mémoire, de ma clé privée, et — si son
       * propre chargement échoue — lit MES noms de coffres à l'écran, puisque
       * `loadVaults.rejected` ne purge rien.
       */
      await forgetSessionSecrets(dispatch, 'logout');
      dispatch(clearCloudAuth());
      // Tenancy belongs to the ACCOUNT, not the profile: leaving it behind means the
      // next sign-in in this same profile keeps sending the previous account's
      // X-Org-Id until something remounts. clearOrgs also drops the apiClient headers.
      dispatch(clearOrgs());
      dispatch(setSyncEnabled(false));
    } finally {
      dispatch(setAuthLoading(false));
    }
  }, [dispatch]);

  const refreshUser = useCallback(async () => {
    const result = await authApi.getMe();
    if (result.success && result.user) {
      dispatch(setCloudAuth(result.user));
    }
    return result;
  }, [dispatch]);

  return {
    // State
    isAuthenticated: auth.isAuthenticated,
    user: auth.cloudUser,
    accountMode: auth.accountMode,
    syncEnabled: auth.syncEnabled,
    isLoading: auth.loading,
    error: auth.cloudError,
    localProfile: auth.localProfile,

    // Actions
    login,
    register,
    logout,
    refreshUser,
    recoverPhraseVerify: authApi.recoverPhraseVerify,
    recoverComplete: authApi.recoverComplete,
    verifyEmail: authApi.verifyEmail,
  };
}
