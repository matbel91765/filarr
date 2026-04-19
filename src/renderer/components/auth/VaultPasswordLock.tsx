/**
 * VaultPasswordLock
 *
 * Full-screen overlay shown when the app is locked and the user
 * has no PIN configured. Requires the vault password to unlock
 * (re-initializes hybrid crypto from wrapped_fek.json).
 */

import React, { useState, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector, useDispatch } from 'react-redux';
import ProfileAvatar from '../profiles/ProfileAvatar';
import { FilarrLogo } from '../ui/FilarrLogo';
import type { RootState, AppDispatch } from '../../../store';
import { unlockApp } from '../../../store/slices/authSlice';
import { fetchFolders } from '../../../store/slices/foldersSlice';
import { loadNotesFromDisk } from '../../../store/slices/notesSlice';

export const VaultPasswordLock: React.FC = () => {
  const { t } = useTranslation();
  const dispatch = useDispatch<AppDispatch>();
  const localProfile = useSelector((state: RootState) => state.auth.localProfile);
  const manifest = useSelector((state: RootState) => state.profiles.manifest);
  const activeProfileMeta = manifest?.profiles.find((p) => p.id === manifest.activeProfileId);

  const displayName = activeProfileMeta?.name || localProfile?.name || 'User';
  const avatarColor = activeProfileMeta?.avatarColor || localProfile?.avatarColor || '#4682B4';

  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = useCallback(
    async (e?: React.FormEvent) => {
      if (e) e.preventDefault();
      if (!password || checking) return;

      setChecking(true);
      setError('');

      try {
        const { initHybridCrypto } = await import('../../../services/auth/hybridCrypto');
        await initHybridCrypto(password);
        dispatch(unlockApp());
        // Reload folders + notes after unlock. When Enhanced Lock forced
        // the lock screen at startup, handleProfileSelected skipped these
        // loads (the app was locked, loading them would have raced with
        // the unlock). We must trigger them now to populate the UI.
        dispatch(fetchFolders());
        dispatch(loadNotesFromDisk());
      } catch {
        setError(t('vaultLock.wrongPassword', 'Mot de passe incorrect. Veuillez réessayer.'));
        setPassword('');
        inputRef.current?.focus();
      } finally {
        setChecking(false);
      }
    },
    [password, checking, dispatch, t]
  );

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-[var(--color-background)]">
      <div className="flex flex-col items-center max-w-sm w-full px-6">
        {/* Logo Filarr — marque l'app, pas juste une icône générique */}
        <FilarrLogo size={48} className="mb-6" />

        {/* Avatar du profil actif */}
        <ProfileAvatar
          name={displayName}
          avatarColor={avatarColor}
          avatarImage={activeProfileMeta?.avatarImage}
          size={64}
          className="mb-3"
        />

        <p className="text-lg font-semibold text-[var(--color-text-primary)] mb-1">{displayName}</p>
        <p className="text-sm text-[var(--color-text-tertiary)] mb-6">
          {t('vaultLock.subtitle', 'Saisissez votre mot de passe vault pour déverrouiller')}
        </p>

        {/* Password form */}
        <form onSubmit={handleSubmit} className="w-full">
          <input
            ref={inputRef}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t('vaultLock.placeholder', 'Mot de passe vault')}
            autoFocus
            disabled={checking}
            className="w-full px-4 py-3 rounded-xl text-sm outline-none mb-3"
            style={{
              backgroundColor: 'var(--color-surface)',
              border: error ? '2px solid #f87171' : '2px solid var(--color-border)',
              color: 'var(--color-text-primary)',
              opacity: checking ? 0.5 : 1,
            }}
          />

          {error && <p className="text-sm text-red-500 mb-3 text-center">{error}</p>}

          <button
            type="submit"
            disabled={!password || checking}
            className="w-full py-3 rounded-xl text-sm font-semibold text-white
              bg-[var(--color-primary-600)] hover:bg-[var(--color-primary-700)]
              disabled:opacity-50 transition-all"
          >
            {checking
              ? t('vaultLock.unlocking', 'Déverrouillage...')
              : t('vaultLock.unlock', 'Déverrouiller')}
          </button>
        </form>
      </div>
    </div>
  );
};

export default VaultPasswordLock;
