/**
 * ProfilePicker — Full-screen profile selection
 *
 * Displays at app launch (after onboarding) to let the user pick a profile.
 * Contextual greeting based on time of day. Subtle gradient background.
 * Auto-selects if only 1 profile without PIN.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector, useDispatch } from 'react-redux';
import type { RootState, AppDispatch } from '../../../store';
import {
  fetchManifest,
  activateProfile,
  verifyPin,
  clearPinError,
} from '../../../store/slices/profilesSlice';
import { setActiveProfile } from '../../../services/core/profileStorage';
import { canCreateProfile } from '../../../services/core/profileLimits';
import type { ProfileMetadata } from '../../../types/profiles';
import ProfileCard from './ProfileCard';
import PinOverlay from './PinOverlay';
import CreateProfileModal from './CreateProfileModal';
import ManageProfilesModal from './ManageProfilesModal';

interface ProfilePickerProps {
  onProfileSelected: (profileId: string) => void;
  /** When true, always show the picker (don't auto-select single profile) */
  skipAutoSelect?: boolean;
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'profiles.goodMorning';
  if (hour < 18) return 'profiles.goodAfternoon';
  return 'profiles.goodEvening';
}

function getGradient(): string {
  const hour = new Date().getHours();
  if (hour < 7) return 'from-indigo-950/20 via-transparent to-transparent';
  if (hour < 12) return 'from-amber-50/30 via-transparent to-transparent';
  if (hour < 18) return 'from-sky-50/20 via-transparent to-transparent';
  return 'from-indigo-950/10 via-transparent to-transparent';
}

const ProfilePicker: React.FC<ProfilePickerProps> = ({
  onProfileSelected,
  skipAutoSelect = false,
}) => {
  const { t } = useTranslation();
  const dispatch = useDispatch<AppDispatch>();

  const manifest = useSelector((state: RootState) => state.profiles.manifest);
  const profiles = manifest?.profiles ?? [];
  const pinError = useSelector((state: RootState) => state.profiles.pinError);
  const pinLockedUntil = useSelector((state: RootState) => state.profiles.pinLockedUntil);
  const pinVerifying = useSelector((state: RootState) => state.profiles.pinVerifying);

  const [selectedProfile, setSelectedProfile] = useState<ProfileMetadata | null>(null);
  const [showPin, setShowPin] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [showManage, setShowManage] = useState(false);
  const [ready, setReady] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetPassword, setResetPassword] = useState('');
  const [resetError, setResetError] = useState('');
  const [resetVerifying, setResetVerifying] = useState(false);
  // Recovery flow: forgot encryption password → enter phrase → new password
  const [showRecovery, setShowRecovery] = useState(false);
  const [recoveryPhrase, setRecoveryPhrase] = useState('');
  const [recoveryNewPassword, setRecoveryNewPassword] = useState('');
  const [recoveryNewPasswordConfirm, setRecoveryNewPasswordConfirm] = useState('');
  const [recoveryError, setRecoveryError] = useState('');
  const [recoveryVerifying, setRecoveryVerifying] = useState(false);

  const handleActivate = useCallback(
    async (profileId: string) => {
      try {
        setActiveProfile(profileId);
        await dispatch(activateProfile(profileId)).unwrap();
        onProfileSelected(profileId);
      } catch (err) {
        console.error('Failed to activate profile:', err);
      }
    },
    [dispatch, onProfileSelected]
  );

  // Fetch manifest on mount
  useEffect(() => {
    dispatch(fetchManifest()).then(() => setReady(true));
  }, [dispatch]);

  // Auto-select: 1 profile without PIN → skip picker (only on first launch, not on switch)
  useEffect(() => {
    if (!ready || !manifest || skipAutoSelect) return;
    if (profiles.length === 1 && !profiles[0].pinHash) {
      handleActivate(profiles[0].id);
    }
  }, [ready, manifest, profiles, handleActivate, skipAutoSelect]);

  const handleProfileClick = useCallback(
    (profile: ProfileMetadata) => {
      if (profile.pinHash) {
        setSelectedProfile(profile);
        setShowPin(true);
        dispatch(clearPinError());
      } else {
        handleActivate(profile.id);
      }
    },
    [handleActivate, dispatch]
  );

  const handlePinSubmit = useCallback(
    async (pin: string) => {
      if (!selectedProfile) return;
      try {
        await dispatch(verifyPin({ profileId: selectedProfile.id, pin })).unwrap();
        handleActivate(selectedProfile.id);
      } catch {
        // Error handled by Redux state
      }
    },
    [selectedProfile, dispatch, handleActivate]
  );

  const handleForgotPin = useCallback(() => {
    if (!selectedProfile) return;
    setResetPassword('');
    setResetError('');
    setShowResetConfirm(true);
  }, [selectedProfile]);

  const handleConfirmResetPin = useCallback(async () => {
    if (!selectedProfile || !resetPassword.trim()) return;
    setResetVerifying(true);
    setResetError('');
    try {
      // Verify the encryption password by attempting to unwrap the FEK
      const { initHybridCrypto } = await import('../../../services/auth/hybridCrypto');
      await initHybridCrypto(resetPassword.trim());

      // Password is correct — reset the PIN
      await window.electron.ipcRenderer.invoke(
        'profile:resetPin',
        selectedProfile.id,
        selectedProfile.name
      );
      await dispatch(fetchManifest());
      setShowPin(false);
      setShowResetConfirm(false);
      setSelectedProfile(null);
    } catch (err) {
      setResetError(
        t('profiles.wrongEncryptionPassword', 'Mot de passe de chiffrement incorrect.')
      );
    } finally {
      setResetVerifying(false);
    }
  }, [selectedProfile, resetPassword, dispatch, t]);

  const handleRecoverWithPhrase = useCallback(async () => {
    if (!selectedProfile || !recoveryPhrase.trim() || !recoveryNewPassword.trim()) return;
    if (recoveryNewPassword !== recoveryNewPasswordConfirm) {
      setRecoveryError(t('onboarding.passwordMismatch', 'Les mots de passe ne correspondent pas'));
      return;
    }
    if (recoveryNewPassword.length < 8) {
      setRecoveryError(t('profiles.passwordTooShort', '8 caractères minimum'));
      return;
    }
    setRecoveryVerifying(true);
    setRecoveryError('');
    try {
      const { recoverWithPhrase } = await import('../../../services/auth/hybridCrypto');
      await recoverWithPhrase(recoveryPhrase.trim(), recoveryNewPassword.trim());

      // Recovery successful — also reset the PIN
      await window.electron.ipcRenderer.invoke(
        'profile:resetPin',
        selectedProfile.id,
        selectedProfile.name
      );
      await dispatch(fetchManifest());
      setShowPin(false);
      setShowResetConfirm(false);
      setShowRecovery(false);
      setSelectedProfile(null);
    } catch {
      setRecoveryError(t('profiles.wrongRecoveryPhrase', 'Phrase de récupération incorrecte.'));
    } finally {
      setRecoveryVerifying(false);
    }
  }, [
    selectedProfile,
    recoveryPhrase,
    recoveryNewPassword,
    recoveryNewPasswordConfirm,
    dispatch,
    t,
  ]);

  const handlePinCancel = useCallback(() => {
    setShowPin(false);
    setSelectedProfile(null);
    dispatch(clearPinError());
  }, [dispatch]);

  const canAdd = manifest ? canCreateProfile(null, profiles.length) : false;

  // Loading / auto-select state
  if (!ready) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center
        bg-[var(--color-background)]"
      >
        <div
          className="w-8 h-8 border-2 border-[var(--color-primary-300)] border-t-transparent
          rounded-full animate-spin"
        />
      </div>
    );
  }

  // Auto-selecting single profile (show spinner while redirecting)
  if (!skipAutoSelect && profiles.length === 1 && !profiles[0].pinHash) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center
        bg-[var(--color-background)]"
      >
        <div
          className="w-8 h-8 border-2 border-[var(--color-primary-300)] border-t-transparent
          rounded-full animate-spin"
        />
      </div>
    );
  }

  // PIN overlay
  if (showPin && selectedProfile) {
    return (
      <>
        <PinOverlay
          profileName={selectedProfile.name}
          avatarColor={selectedProfile.avatarColor}
          onSubmit={handlePinSubmit}
          onCancel={handlePinCancel}
          onForgotPin={handleForgotPin}
          allowPinReset={selectedProfile.allowPinReset}
          error={pinError}
          lockedUntil={pinLockedUntil}
          verifying={pinVerifying}
        />
        {showResetConfirm && (
          <div
            className="fixed inset-0 z-[60] flex items-center justify-center"
            style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
            onClick={() => setShowResetConfirm(false)}
          >
            <div
              className="rounded-xl p-5 w-full max-w-sm mx-4"
              style={{
                backgroundColor: 'var(--color-surface, #fff)',
                border: '1px solid var(--color-border)',
                boxShadow: '0 16px 40px rgba(0,0,0,0.2)',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <h3
                className="text-base font-semibold mb-1"
                style={{ color: 'var(--color-text-primary)' }}
              >
                {t('profiles.resetPinTitle', 'Réinitialiser le PIN')}
              </h3>
              <p className="text-sm mb-3" style={{ color: 'var(--color-text-secondary)' }}>
                {t(
                  'profiles.resetPinDesc',
                  'Entrez votre mot de passe de chiffrement pour prouver votre identité.'
                )}
              </p>
              <input
                type="password"
                value={resetPassword}
                onChange={(e) => {
                  setResetPassword(e.target.value);
                  setResetError('');
                }}
                placeholder={t(
                  'profiles.encryptionPasswordPlaceholder',
                  'Mot de passe de chiffrement'
                )}
                autoFocus
                className="w-full px-3 py-2 rounded-lg text-sm mb-1"
                style={{
                  backgroundColor: 'var(--color-background)',
                  border: `1px solid ${resetError ? '#ef4444' : 'var(--color-border)'}`,
                  color: 'var(--color-text-primary)',
                  outline: 'none',
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleConfirmResetPin();
                  if (e.key === 'Escape') setShowResetConfirm(false);
                }}
              />
              {resetError && (
                <p className="text-xs mb-2" style={{ color: '#ef4444' }}>
                  {resetError}
                </p>
              )}
              {!resetError && <div style={{ height: 8 }} />}
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setShowResetConfirm(false)}
                  className="px-3 py-1.5 text-sm rounded-lg"
                  style={{
                    border: '1px solid var(--color-border)',
                    backgroundColor: 'transparent',
                    color: 'var(--color-text-secondary)',
                    cursor: 'pointer',
                  }}
                >
                  {t('common.cancel', 'Annuler')}
                </button>
                <button
                  onClick={handleConfirmResetPin}
                  disabled={!resetPassword.trim() || resetVerifying}
                  className="px-3 py-1.5 text-sm rounded-lg font-medium"
                  style={{
                    backgroundColor:
                      resetPassword.trim() && !resetVerifying
                        ? 'var(--color-primary-600, #4682b4)'
                        : 'var(--color-background-secondary)',
                    color:
                      resetPassword.trim() && !resetVerifying
                        ? '#fff'
                        : 'var(--color-text-tertiary)',
                    border: 'none',
                    cursor: resetPassword.trim() && !resetVerifying ? 'pointer' : 'not-allowed',
                  }}
                >
                  {resetVerifying
                    ? t('profiles.verifying', 'Vérification...')
                    : t('profiles.resetPin', 'Réinitialiser le PIN')}
                </button>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowResetConfirm(false);
                  setShowRecovery(true);
                  setRecoveryPhrase('');
                  setRecoveryNewPassword('');
                  setRecoveryNewPasswordConfirm('');
                  setRecoveryError('');
                }}
                className="w-full mt-3 text-xs text-center"
                style={{
                  color: 'var(--color-primary-600)',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  textDecoration: 'underline',
                }}
              >
                {t('profiles.forgotEncryptionPassword', 'Mot de passe de chiffrement oublié ?')}
              </button>
            </div>
          </div>
        )}
        {/* Recovery: forgot encryption password → enter phrase + new password */}
        {showRecovery && (
          <div
            className="fixed inset-0 z-[60] flex items-center justify-center"
            style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
            onClick={() => setShowRecovery(false)}
          >
            <div
              className="rounded-xl p-5 w-full max-w-md mx-4"
              style={{
                backgroundColor: 'var(--color-surface, #fff)',
                border: '1px solid var(--color-border)',
                boxShadow: '0 16px 40px rgba(0,0,0,0.2)',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <h3
                className="text-base font-semibold mb-1"
                style={{ color: 'var(--color-text-primary)' }}
              >
                {t('profiles.recoveryTitle', 'Récupération par phrase')}
              </h3>
              <p className="text-sm mb-4" style={{ color: 'var(--color-text-secondary)' }}>
                {t(
                  'profiles.recoveryDesc',
                  'Entrez les 12 mots de votre phrase de récupération, puis choisissez un nouveau mot de passe de chiffrement.'
                )}
              </p>

              <label
                className="text-xs font-medium mb-1 block"
                style={{ color: 'var(--color-text-secondary)' }}
              >
                {t('profiles.recoveryPhraseLabel', 'Phrase de récupération (12 mots)')}
              </label>
              <textarea
                value={recoveryPhrase}
                onChange={(e) => {
                  setRecoveryPhrase(e.target.value);
                  setRecoveryError('');
                }}
                placeholder="apple arrow beach blade bloom brave..."
                rows={2}
                autoFocus
                className="w-full px-3 py-2 rounded-lg text-sm mb-3 font-mono"
                style={{
                  backgroundColor: 'var(--color-background)',
                  border: `1px solid ${recoveryError && !recoveryNewPassword ? '#ef4444' : 'var(--color-border)'}`,
                  color: 'var(--color-text-primary)',
                  outline: 'none',
                  resize: 'none',
                }}
              />

              <label
                className="text-xs font-medium mb-1 block"
                style={{ color: 'var(--color-text-secondary)' }}
              >
                {t('profiles.newEncryptionPassword', 'Nouveau mot de passe de chiffrement')}
              </label>
              <input
                type="password"
                value={recoveryNewPassword}
                onChange={(e) => {
                  setRecoveryNewPassword(e.target.value);
                  setRecoveryError('');
                }}
                placeholder={t('profiles.newPasswordPlaceholder', '8 caractères minimum')}
                className="w-full px-3 py-2 rounded-lg text-sm mb-2"
                style={{
                  backgroundColor: 'var(--color-background)',
                  border: '1px solid var(--color-border)',
                  color: 'var(--color-text-primary)',
                  outline: 'none',
                }}
              />
              <input
                type="password"
                value={recoveryNewPasswordConfirm}
                onChange={(e) => {
                  setRecoveryNewPasswordConfirm(e.target.value);
                  setRecoveryError('');
                }}
                placeholder={t('profiles.confirmNewPassword', 'Confirmer le mot de passe')}
                className="w-full px-3 py-2 rounded-lg text-sm mb-1"
                style={{
                  backgroundColor: 'var(--color-background)',
                  border: `1px solid ${recoveryNewPasswordConfirm && recoveryNewPassword !== recoveryNewPasswordConfirm ? '#ef4444' : 'var(--color-border)'}`,
                  color: 'var(--color-text-primary)',
                  outline: 'none',
                }}
              />

              {recoveryError && (
                <p className="text-xs mb-2" style={{ color: '#ef4444' }}>
                  {recoveryError}
                </p>
              )}
              {!recoveryError && <div style={{ height: 8 }} />}

              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setShowRecovery(false)}
                  className="px-3 py-1.5 text-sm rounded-lg"
                  style={{
                    border: '1px solid var(--color-border)',
                    backgroundColor: 'transparent',
                    color: 'var(--color-text-secondary)',
                    cursor: 'pointer',
                  }}
                >
                  {t('common.cancel', 'Annuler')}
                </button>
                <button
                  onClick={handleRecoverWithPhrase}
                  disabled={
                    !recoveryPhrase.trim() ||
                    !recoveryNewPassword.trim() ||
                    recoveryNewPassword !== recoveryNewPasswordConfirm ||
                    recoveryVerifying
                  }
                  className="px-3 py-1.5 text-sm rounded-lg font-medium"
                  style={{
                    backgroundColor:
                      recoveryPhrase.trim() &&
                      recoveryNewPassword.trim() &&
                      recoveryNewPassword === recoveryNewPasswordConfirm &&
                      !recoveryVerifying
                        ? 'var(--color-primary-600, #4682b4)'
                        : 'var(--color-background-secondary)',
                    color:
                      recoveryPhrase.trim() && recoveryNewPassword.trim() && !recoveryVerifying
                        ? '#fff'
                        : 'var(--color-text-tertiary)',
                    border: 'none',
                    cursor:
                      recoveryPhrase.trim() && recoveryNewPassword.trim() && !recoveryVerifying
                        ? 'pointer'
                        : 'not-allowed',
                  }}
                >
                  {recoveryVerifying
                    ? t('profiles.verifying', 'Vérification...')
                    : t('profiles.recoverAccess', "Récupérer l'accès")}
                </button>
              </div>
            </div>
          </div>
        )}
      </>
    );
  }

  return (
    <div
      className={`fixed inset-0 z-50 flex flex-col items-center justify-center
      bg-[var(--color-background)] bg-gradient-to-b ${getGradient()}`}
    >
      {/* Greeting */}
      <div className="text-center mb-10 animate-fadeIn">
        <h1 className="text-3xl font-light text-[var(--color-text-primary)] mb-2">
          {t(getGreeting())}
        </h1>
        <p className="text-base text-[var(--color-text-tertiary)]">{t('profiles.whoIsUsing')}</p>
      </div>

      {/* Profile cards */}
      <div
        className="flex items-center gap-6 flex-wrap justify-center max-w-3xl px-8
        animate-fadeIn"
        style={{ animationDelay: '100ms' }}
      >
        {profiles.map((profile) => (
          <ProfileCard
            key={profile.id}
            profile={profile}
            isActive={manifest?.activeProfileId === profile.id}
            onClick={() => handleProfileClick(profile)}
          />
        ))}

        {/* Add profile button */}
        <button
          onClick={() => (canAdd ? setShowCreate(true) : undefined)}
          disabled={!canAdd}
          className="flex flex-col items-center gap-2 p-4 rounded-2xl
            transition-all duration-200 ease-out cursor-pointer
            hover:scale-105
            focus:outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)] focus:ring-offset-2
            disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100"
          title={!canAdd ? t('profiles.maxReached') : t('profiles.addProfile')}
        >
          <div
            className="w-20 h-20 rounded-full border-2 border-dashed
            border-[var(--color-border-strong)]
            flex items-center justify-center
            transition-colors duration-200
            group-hover:border-[var(--color-primary-400)]"
          >
            <svg
              width="28"
              height="28"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--color-text-tertiary)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </div>
          <span className="text-sm font-medium text-[var(--color-text-tertiary)]">
            {t('profiles.add')}
          </span>
        </button>
      </div>

      {/* Footer links */}
      <div
        className="mt-12 flex items-center gap-6 text-sm animate-fadeIn"
        style={{ animationDelay: '200ms' }}
      >
        <button
          onClick={() => setShowManage(true)}
          className="text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]
            transition-colors"
        >
          {t('profiles.manage')}
        </button>
      </div>

      {/* Modals */}
      <CreateProfileModal
        isOpen={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={() => dispatch(fetchManifest())}
      />
      <ManageProfilesModal
        isOpen={showManage}
        onClose={() => {
          setShowManage(false);
          dispatch(fetchManifest());
        }}
      />

      {/* Inline fade animation */}
      <style>{`
        .animate-fadeIn {
          animation: fadeIn 400ms ease-out both;
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
};

export default ProfilePicker;
